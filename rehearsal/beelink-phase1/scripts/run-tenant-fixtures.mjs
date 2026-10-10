import { createHash, randomBytes } from "node:crypto";
import mysql from "mysql2/promise";

const target = { host: "127.0.0.1", port: 4000, user: "root", database: "ojala_phase1_rehearsal" };
const expectedUrl = `mysql://${target.user}@${target.host}:${target.port}/${target.database}`;
const configured = new URL(process.env.DATABASE_URL ?? "");
if (configured.hostname !== target.host || Number(configured.port || 3306) !== target.port || decodeURIComponent(configured.pathname.slice(1)) !== target.database) {
  throw new Error("Refusing fixture checks: DATABASE_URL is not the fixed local rehearsal database");
}

// Use fresh local session material, never inherited production secrets.
process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.VITE_APP_ID = "ojala-local-rehearsal";
process.env.OAUTH_SERVER_URL = "http://127.0.0.1:1";
process.env.STAFF_PORTAL_PASSWORD = "";
process.env.FRIGATE_API_KEY = "";
// Keep machine-readable evidence on stdout; application diagnostics go to stderr.
console.log = (...args) => console.error(...args);
const { appRouter } = await import("../../../server/routers.ts");
const { sdk } = await import("../../../server/_core/sdk.ts");
const {
  getDb,
  createStoreCredential,
  getActiveUserByOpenId,
  getFrigateCupCountForDate,
  resolveActiveStoreCredential,
} = await import("../../../server/db.ts");
const { createStaffPasswordVerifier, generateFrigateApiKey, hashFrigateApiKey } = await import("../../../server/storeCredentials.ts");

const marker = "phase1-rehearsal-fixture";
const fixtureUser = "phase1-fixture-store-2-user";
const fixtureEventPrefix = "phase1-fixture-event";
const fixtureCamera = "phase1-fixture-camera";
const staffPassword = `phase1-${randomBytes(24).toString("base64url")}`;
const frigateKey = generateFrigateApiKey();
const businessDate = new Date().toISOString().slice(0, 10);
const connection = await mysql.createConnection(target);
const report = { target, executed: false, tests: {}, cleanup: false };

function context(user) {
  return {
    user,
    req: { protocol: "http", headers: { "x-forwarded-for": "127.0.0.1" } },
    res: { cookie() {}, clearCookie() {} },
  };
}

try {
  const [versionRows] = await connection.query("SELECT VERSION() AS version, DATABASE() AS databaseName");
  if (!/tidb/i.test(String(versionRows[0]?.version ?? "")) || versionRows[0]?.databaseName !== target.database) {
    throw new Error("Refusing fixture checks: TiDB rehearsal target verification failed");
  }
  await connection.execute(
    "INSERT INTO stores (nombre, timezone, horario_apertura, horario_cierre, dueno_email) VALUES (?, ?, NULL, NULL, NULL)",
    [marker, "America/Mazatlan"],
  );
  const [[storeRow]] = await connection.execute("SELECT id FROM stores WHERE nombre = ?", [marker]);
  const store2Id = Number(storeRow.id);
  await connection.execute(
    "INSERT INTO users (storeId, openId, name, email, loginMethod, role) VALUES (?, ?, ?, NULL, ?, 'user')",
    [store2Id, fixtureUser, marker, "fixture"],
  );
  const [[userRow]] = await connection.execute("SELECT id, storeId, openId, role, createdAt, updatedAt, lastSignedIn FROM users WHERE openId = ?", [fixtureUser]);
  const store2User = { ...userRow, id: Number(userRow.id), storeId: Number(userRow.storeId) };

  await createStoreCredential({
    storeId: store2Id,
    credentialType: "staff_portal",
    verifierFormat: "scrypt_v1",
    credentialVerifier: await createStaffPasswordVerifier(staffPassword),
    label: marker,
  });
  await createStoreCredential({
    storeId: store2Id,
    credentialType: "frigate",
    verifierFormat: "sha256_v1",
    credentialVerifier: hashFrigateApiKey(frigateKey),
    label: marker,
  });

  const resolvedStaff = await resolveActiveStoreCredential({ credentialType: "staff_portal", secret: staffPassword });
  const resolvedFrigate = await resolveActiveStoreCredential({ credentialType: "frigate", secret: frigateKey });
  const provisionedUser = await getActiveUserByOpenId(fixtureUser);
  report.tests.credentialResolution = Boolean(resolvedStaff?.store.id === store2Id && resolvedFrigate?.store.id === store2Id);
  report.tests.preprovisionedUser = Boolean(provisionedUser?.storeId === store2Id && provisionedUser?.openId === fixtureUser);

  let sessionCookie;
  const loginContext = context(null);
  loginContext.res.cookie = (_name, value) => { sessionCookie = value; };
  const loginCaller = appRouter.createCaller(loginContext);
  const login = await loginCaller.auth.staffPortalLogin({ password: staffPassword, storeId: 1 });
  const session = await sdk.verifySession(sessionCookie);
  const sessionUser = session && await getActiveUserByOpenId(session.openId);
  report.tests.staffLoginSession = login.success === true && sessionUser?.storeId === store2Id;

  const store2Caller = appRouter.createCaller(context(store2User));
  const store2Items = await store2Caller.forms.inventoryItems();
  const store1Items = await connection.query("SELECT id, currentQuantity FROM inventoryItems WHERE storeId = 1 ORDER BY id LIMIT 1");
  const store1Item = store1Items[0][0];
  if (!store1Item || store2Items.some(item => item.storeId === 1)) throw new Error("Fixture setup could not establish read isolation");
  let crossWriteDenied = false;
  try {
    await store2Caller.forms.submitInventoryUpdate({ id: Number(store1Item.id), currentQuantity: 999, notes: marker, notifyOwner: false });
  } catch (error) {
    crossWriteDenied = String(error).includes("Inventory item not found");
  }
  const [[unchangedStore1Item]] = await connection.query("SELECT currentQuantity FROM inventoryItems WHERE id = ? AND storeId = 1", [store1Item.id]);
  report.tests.crossStoreRead = true;
  report.tests.crossStoreWriteDenied = crossWriteDenied && String(unchangedStore1Item.currentQuantity) === String(store1Item.currentQuantity);

  const frigateCaller = appRouter.createCaller(context(null));
  const firstAt = new Date(Date.now() - 120_000).toISOString();
  const correctionAt = new Date(Date.now() - 60_000).toISOString();
  const staleAt = new Date(Date.now() - 90_000).toISOString();
  const first = await frigateCaller.frigate.submitCounts({
    apiKey: frigateKey, businessDate, cameraName: fixtureCamera, cupsDetected: 12, peopleEntries: 1,
    sourceDetail: marker, sourceEventId: `${fixtureEventPrefix}-first`, sourceEventAt: firstAt,
  });
  const correction = await frigateCaller.frigate.submitCounts({
    apiKey: frigateKey, businessDate, cameraName: fixtureCamera, cupsDetected: 9, peopleEntries: 1,
    sourceDetail: marker, sourceEventId: `${fixtureEventPrefix}-correction`, sourceEventAt: correctionAt,
  });
  const stale = await frigateCaller.frigate.submitCounts({
    apiKey: frigateKey, businessDate, cameraName: fixtureCamera, cupsDetected: 99, peopleEntries: 1,
    sourceDetail: marker, sourceEventId: `${fixtureEventPrefix}-stale`, sourceEventAt: staleAt,
  });
  const storedCount = await getFrigateCupCountForDate(businessDate, fixtureCamera, store2Id);
  report.tests.frigateOrdering = first.disposition === "apply" && correction.disposition === "apply" && stale.disposition === "stale" && storedCount?.cupsDetected === 9 && storedCount?.sourceEventId === `${fixtureEventPrefix}-correction`;

  await connection.execute("UPDATE storeCredentials SET revokedAt = NOW() WHERE storeId = ?", [store2Id]);
  report.tests.revokedCredentialsRejected = !(await resolveActiveStoreCredential({ credentialType: "staff_portal", secret: staffPassword })) && !(await resolveActiveStoreCredential({ credentialType: "frigate", secret: frigateKey }));
  let revokedLoginDenied = false;
  try { await loginCaller.auth.staffPortalLogin({ password: staffPassword }); }
  catch (error) { revokedLoginDenied = String(error).includes("Invalid staff portal password"); }
  report.tests.revokedStaffLoginDenied = revokedLoginDenied;

  report.executed = Object.values(report.tests).every(Boolean);
  report.fixtureStoreId = store2Id;
  report.fixtureIdentifierFingerprint = createHash("sha256").update(fixtureUser).digest("hex");
} finally {
  await connection.query("DELETE FROM frigateCupCounts WHERE sourceDetail = ?", [marker]);
  await connection.query("DELETE FROM inventoryItems WHERE storeId IN (SELECT id FROM stores WHERE nombre = ?)", [marker]);
  await connection.query("DELETE FROM storeCredentials WHERE label = ?", [marker]);
  await connection.query("DELETE FROM users WHERE storeId IN (SELECT id FROM stores WHERE nombre = ?)", [marker]);
  await connection.query("DELETE FROM stores WHERE nombre = ?", [marker]);
  await connection.end();
  const appDb = await getDb();
  if (appDb?.$client) {
    const client = appDb.$client;
    await (typeof client.promise === "function" ? client.promise().end() : client.end());
  }
  report.cleanup = true;
  if (!report.executed) process.exitCode = 2;
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
