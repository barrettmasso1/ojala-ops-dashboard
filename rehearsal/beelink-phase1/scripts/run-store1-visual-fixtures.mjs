import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const expected = "mysql://root@127.0.0.1:4000/ojala_phase1_rehearsal";
assert.equal(process.env.DATABASE_URL, expected, "Only the isolated rehearsal database is allowed");
process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.VITE_APP_ID = "isolated-pr13-fixture";
process.env.OAUTH_SERVER_URL = "http://127.0.0.1:1";
process.env.FRIGATE_API_KEY = "";
process.env.STAFF_PORTAL_PASSWORD = "";
process.env.BUILT_IN_FORGE_API_KEY = "";
console.log = (...args) => console.error(...args);
const { appRouter } = await import("../../../server/routers.ts");
const db = await import("../../../server/db.ts");
const { generateFrigateApiKey, hashFrigateApiKey } = await import("../../../server/storeCredentials.ts");
const { handoffZoneConfigSha256, isHandoffCaptureZoneCoherent } = await import("../../../server/handoffZoneGeometry.ts");
const { parseHandoffCaptureMetadata } = await import("../../../server/handoffVisualPayload.ts");

const resultsPath = process.argv[2];
assert(resultsPath, "Pass the private rehearsal result directory");
const sample = JSON.parse(readFileSync(resultsPath + "/sample-adapted-capture.json", "utf8"));
const connection = await mysql.createConnection({ host:"127.0.0.1",port:4000,user:"root",database:"ojala_phase1_rehearsal" });
const marker = "pr13-isolated-" + randomBytes(6).toString("hex");
const day = "2026-10-07";
const report = { isolatedOnly: true, checks: {}, cleanup: false, liveAiInvoked: false, productionTouched: false };
let secondStore;
let fixtureZoneId;
let targetVerified=false;
const context = user => ({ user, req: { protocol:"http", headers:{"x-forwarded-for":"127.0.0.1"} }, res:{ cookie(){}, clearCookie(){} } });
const check = (name, condition) => { report.checks[name] = Boolean(condition); assert(condition, name); };
try {
  const [[identity]] = await connection.query("SELECT VERSION() AS version, DATABASE() AS db");
  assert(identity.version.includes("TiDB") && identity.db === "ojala_phase1_rehearsal");
  targetVerified=true;
  const [[prior]] = await connection.execute("SELECT COUNT(*) AS n FROM frigateCupCounts WHERE storeId=1 AND businessDate=? AND cameraName='handoff'", [day]);
  assert.equal(Number(prior.n), 0, "Fixture date must be unused");
  const [[priorZone]] = await connection.query("SELECT COUNT(*) AS n FROM frigateCameraZones WHERE storeId=1");
  assert.equal(Number(priorZone.n), 0, "Do not overwrite existing zone fixtures");
  await connection.execute("INSERT INTO users (storeId,openId,name,role) VALUES (1,?,?,'admin')", [marker+"-admin1",marker]);
  const [[admin1]] = await connection.execute("SELECT * FROM users WHERE openId=?", [marker+"-admin1"]);
  await connection.execute("INSERT INTO stores (nombre,timezone) VALUES (?,?)", [marker,"America/Mazatlan"]);
  const [[store2]] = await connection.execute("SELECT id FROM stores WHERE nombre=?", [marker]);
  secondStore=Number(store2.id);
  await connection.execute("INSERT INTO users (storeId,openId,name,role) VALUES (?,?,?,'admin')", [secondStore,marker+"-admin2",marker]);
  const [[admin2]] = await connection.execute("SELECT * FROM users WHERE openId=?", [marker+"-admin2"]);
  const c1=appRouter.createCaller(context(admin1)), c2=appRouter.createCaller(context(admin2));
  const publicCaller=appRouter.createCaller(context(null));

  const key=generateFrigateApiKey();
  await db.createStoreCredential({storeId:1,credentialType:"frigate",verifierFormat:"sha256_v1",credentialVerifier:hashFrigateApiKey(key),label:marker});
  const resolved=await db.resolveActiveStoreCredential({credentialType:"frigate",secret:key});
  check("managedCredentialResolvesStore1",resolved?.store.id===1);
  const [[credential]] = await connection.execute("SELECT credentialVerifier FROM storeCredentials WHERE label=?", [marker]);
  check("credentialStoredHashed",credential.credentialVerifier!==key && credential.credentialVerifier===hashFrigateApiKey(key));

  const geometry={points:sample.capture.zone_geometry};
  const zone=await c1.storeAdmin.saveHandoffZone(geometry);
  const [[fixtureZone]]=await connection.query("SELECT id FROM frigateCameraZones WHERE storeId=1 AND cameraName='handoff' AND zoneName='handoff_zone'");
  fixtureZoneId=Number(fixtureZone.id);
  check("configuredActualGeometry",JSON.stringify(zone.geometry)===JSON.stringify(geometry));
  check("geometryHashMatchesAdaptedCapture",handoffZoneConfigSha256(zone.geometry)===sample.capture.zone_config_sha256);
  check("otherStoreCannotReadZone",(await c2.storeAdmin.handoffZone())===null);

  const cap=sample.capture;
  const parsed=parseHandoffCaptureMetadata({camera:cap.camera,cupZone:cap.cup_zone,cupEventId:cap.cup_event_id,capturedAtUtc:cap.captured_at_utc,imageSha256:cap.image_sha256,schemaVersion:cap.schema_version,zoneGeometry:cap.zone_geometry,zoneConfigSha256:cap.zone_config_sha256,imageDimensions:cap.image_dimensions});
  check("realAdaptedMetadataAccepted",Boolean(parsed));
  check("captureMatchesServerZone",isHandoffCaptureZoneCoherent({capturedGeometry:geometry,capturedConfigSha256:cap.zone_config_sha256,serverGeometry:zone.geometry}));

  const at=new Date(Math.floor((Date.now()-60000)/1000)*1000+900).toISOString();
  const count={apiKey:key,businessDate:day,cameraName:"handoff",cupsDetected:3,peopleEntries:0,sourceDetail:marker,sourceEventId:marker+"-count",sourceEventAt:at};
  const first=await publicCaller.frigate.submitCounts(count);
  const replay=await publicCaller.frigate.submitCounts(count);
  check("countEventApplyAndReplay",first.disposition==="apply" && replay.disposition==="replay");
  const stale=await publicCaller.frigate.submitCounts({...count,cupsDetected:77,sourceEventId:marker+"-older-same-second",sourceEventAt:at.replace(".900Z", ".800Z")});
  check("olderSameSecondRejected",stale.disposition==="stale");
  const stored=await db.getFrigateCupCountForDate(day,"handoff",1);
  check("countOrderingFieldsPersisted",stored?.cupsDetected===3 && stored.sourceEventId===count.sourceEventId && new Date(stored.sourceEventAt).getTime()===Math.floor(new Date(at).getTime()/1000)*1000);
  const before=await c1.dashboard.daily({businessDate:day});

  const eventInput={storeId:1,businessDate:day,cameraName:"handoff",cupEventId:marker+"-visual",capturedAt:new Date(at),imageSha256:cap.image_sha256,captureMetadataJson:JSON.stringify({...cap,cup_event_id:marker+"-visual",captured_at_utc:at}),zoneGeometryJson:JSON.stringify(geometry.points),sourceDetail:marker};
  const event=await db.reserveHandoffVisualEvent(eventInput);
  const duplicate=await db.reserveHandoffVisualEvent(eventInput);
  check("visualEventDeduplicated",event.created && !duplicate.created && event.event.id===duplicate.event.id);
  const rows=await c1.dashboard.handoffVisualEvents({businessDate:day,status:"all"});
  const hidden=await c2.dashboard.handoffVisualEvents({businessDate:day,status:"all"});
  check("visualRowsScoped",rows.some(r=>r.id===event.event.id) && !hidden.some(r=>r.id===event.event.id));
  let denied=false;
  try { await c2.dashboard.reviewHandoffVisualEvent({id:event.event.id,decision:"approved_by_manager"}); }
  catch(error) {denied=error.code==="NOT_FOUND";}
  check("crossStoreVisualReviewDenied",denied);
  await c1.dashboard.reviewHandoffVisualEvent({id:event.event.id,decision:"approved_by_manager",reviewNotes:"Synthetic isolated schema fixture; no image or AI approval"});
  const after=await c1.dashboard.daily({businessDate:day});
  check("reviewDoesNotAlterCameraOrSales",JSON.stringify(before.frigateCounts)===JSON.stringify(after.frigateCounts) && JSON.stringify(before.sales)===JSON.stringify(after.sales) && JSON.stringify(before.cups)===JSON.stringify(after.cups));
} finally {
  if(targetVerified) {
  await connection.execute("DELETE FROM frigateHandoffVisualEvents WHERE sourceDetail=?", [marker]);
  await connection.execute("DELETE FROM frigateCupCounts WHERE sourceDetail=?", [marker]);
  if(fixtureZoneId)await connection.execute("DELETE FROM frigateCameraZones WHERE id=? AND storeId=1",[fixtureZoneId]);
  await connection.execute("DELETE FROM storeCredentials WHERE label=?", [marker]);
  await connection.execute("DELETE FROM users WHERE openId IN (?,?)",[marker+"-admin1",marker+"-admin2"]);
  if(secondStore)await connection.execute("DELETE FROM stores WHERE id=? AND nombre=?",[secondStore,marker]);
  report.cleanup=true;
  }
  await connection.end();
  const appDb=await db.getDb();if(appDb?.$client){const client=appDb.$client;await (typeof client.promise==="function"?client.promise().end():client.end());}
  writeFileSync(resultsPath+"/store1-visual-fixtures.json",JSON.stringify(report,null,2)+"\n");
  process.stdout.write(JSON.stringify(report,null,2)+"\n");
}
