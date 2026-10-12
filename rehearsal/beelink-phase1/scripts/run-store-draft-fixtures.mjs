import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";

const target = "mysql://root@127.0.0.1:4000/ojala_phase1_rehearsal";
if (process.env.DATABASE_URL !== target) throw new Error("Only the isolated local rehearsal target is permitted");
process.env.OWNER_OPEN_ID = "local-platform-operator";
process.env.OAUTH_SERVER_URL = "http://127.0.0.1:1";
console.log = (...args) => console.error(...args);

const { appRouter } = await import("../../../server/routers.ts");
const { getDb, resolveActiveStoreCredential } = await import("../../../server/db.ts");
const nonce = randomBytes(6).toString("hex");
const ownerOpenId = `local-draft-owner-${nonce}`;
const name = `Draft shop ${nonce}`;
const connection = await mysql.createConnection(target);
const results = { target: "isolated TiDB", checks: {}, cleanup: false };
let draftId;
const caller = user => appRouter.createCaller({ user, req: { protocol: "http", headers: {} }, res: { cookie() {}, clearCookie() {} } });
const platform = caller({ role: "admin", storeId: 1, openId: process.env.OWNER_OPEN_ID });
const unauthorized = caller({ role: "admin", storeId: 2, openId: "unrelated-manager" });
const input = {
  nombre: name, timezone: "America/Mazatlan", horarioApertura: "09:00", horarioCierre: "21:00",
  duenoEmail: `draft-${nonce}@example.test`, posType: "other", cupSizes: ["4oz", "8oz"],
  ownerOpenId, ownerName: "Local Draft Owner",
};
try {
  const [[identity]] = await connection.query("SELECT VERSION() AS version, DATABASE() AS name");
  if (!String(identity.version).includes("TiDB") || identity.name !== "ojala_phase1_rehearsal") throw new Error("Not isolated TiDB");
  let denied = false;
  try { await unauthorized.storeAdmin.createDraft(input); } catch (error) { denied = error.code === "FORBIDDEN"; }
  results.checks.platformOwnerOnly = denied;

  const created = await platform.storeAdmin.createDraft(input);
  draftId = created.storeId;
  const [[stored]] = await connection.query("SELECT timezone, isActive, posType, cupSizesJson FROM stores WHERE id = ?", [draftId]);
  const [[owner]] = await connection.query("SELECT storeId, role FROM users WHERE openId = ?", [ownerOpenId]);
  const [credentials] = await connection.query("SELECT credentialVerifier FROM storeCredentials WHERE storeId = ?", [draftId]);
  results.checks.atomicDraft = created.isActive === false && stored?.isActive === 0 && stored.posType === "other" && JSON.parse(stored.cupSizesJson).length === 2 && owner?.storeId === draftId && owner?.role === "admin" && credentials.length === 2;
  results.checks.noPlaintextSecret = credentials.every(row => row.credentialVerifier !== created.staffPassword && row.credentialVerifier !== created.frigateApiKey);
  results.checks.inactiveCredentialsRejected = !(await resolveActiveStoreCredential({ credentialType: "staff_portal", secret: created.staffPassword })) && !(await resolveActiveStoreCredential({ credentialType: "frigate", secret: created.frigateApiKey }));

  let duplicateRejected = false;
  try { await platform.storeAdmin.createDraft({ ...input, nombre: `${name} duplicate` }); } catch { duplicateRejected = true; }
  const [[duplicateCount]] = await connection.query("SELECT COUNT(*) AS count FROM stores WHERE nombre = ?", [`${name} duplicate`]);
  results.checks.duplicateOwnerRollsBack = duplicateRejected && duplicateCount.count === 0;

  // Activate only this disposable fixture to exercise the manager's own-store settings.
  await connection.query("UPDATE stores SET isActive = 1 WHERE id = ?", [draftId]);
  const ownerCaller = caller({ role: "admin", storeId: draftId, openId: ownerOpenId });
  const saved = await ownerCaller.storeAdmin.updateProfile({
    nombre: `${name} updated`, horarioApertura: "10:00", horarioCierre: "20:00",
    duenoEmail: input.duenoEmail, posType: "square",
  });
  results.checks.ownSettings = saved.id === draftId && saved.posType === "square" && saved.timezone === input.timezone;
  const ownCredentials = await ownerCaller.storeAdmin.credentials();
  results.checks.safeMetadata = ownCredentials.length === 2 && ownCredentials.every(row => !Object.hasOwn(row, "credentialVerifier"));
  const rotated = await ownerCaller.storeAdmin.rotateCredential({ type: "frigate" });
  results.checks.rotation = Boolean(await resolveActiveStoreCredential({ credentialType: "frigate", secret: rotated.secret })) && !(await resolveActiveStoreCredential({ credentialType: "frigate", secret: created.frigateApiKey }));
  const ownProfile = await ownerCaller.storeAdmin.profile();
  results.checks.tenantScoped = ownProfile.id === draftId && ownProfile.id !== 1;
  if (!Object.values(results.checks).every(Boolean)) process.exitCode = 2;
} finally {
  if (draftId) {
    await connection.query("DELETE FROM storeCredentials WHERE storeId = ?", [draftId]);
    await connection.query("DELETE FROM users WHERE storeId = ?", [draftId]);
    await connection.query("DELETE FROM stores WHERE id = ?", [draftId]);
  }
  await connection.end();
  const db = await getDb();
  if (db?.$client) {
    const client = db.$client;
    await (typeof client.promise === "function" ? client.promise().end() : client.end());
  }
  results.cleanup = true;
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
}
