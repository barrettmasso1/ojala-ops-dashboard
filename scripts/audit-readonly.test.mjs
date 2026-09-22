import { test } from "node:test";
import assert from "node:assert/strict";
import { assertAuditRead, beginAudit, databaseFingerprint, guardedAuditConnection } from "./audit-readonly.mjs";

test("writes, SQL batches, locking reads, and file operations are rejected", () => {
  for (const sql of ["DELETE FROM users", "ALTER TABLE users ADD x INT", "COMMIT", "SELECT 1; DELETE FROM users", "SELECT 1 INTO OUTFILE '/tmp/x'", "SELECT * FROM users FOR UPDATE", "SELECT GET_LOCK('x', 1)", "SELECT LOAD_FILE('/etc/passwd')", "SELECT 1 /* comment */", "SELECT @x:=1"]) assert.throws(() => assertAuditRead(sql));
  for (const sql of ["SELECT COUNT(*) AS rowCount FROM `users`", "SHOW CREATE TABLE `users`", "START TRANSACTION READ ONLY", "ROLLBACK"]) assert.doesNotThrow(() => assertAuditRead(sql));
});

test("guard covers query and prepared execution before reaching driver", async () => {
  let calls = 0;
  const db = guardedAuditConnection({ query: async () => { calls++; return []; }, execute: async () => { calls++; return []; } });
  assert.throws(() => db.query("DELETE FROM users"));
  assert.throws(() => db.execute("UPDATE users SET role = ?", ["admin"]));
  assert.equal(calls, 0);
  await db.execute("SELECT COUNT(*) FROM users WHERE id = ?", [1]);
  assert.equal(calls, 1);
});

test("ordinary MySQL uses database-enforced read-only transaction", async () => {
  const calls = [];
  assert.equal(await beginAudit({query: async sql => { calls.push(sql); }}), "database-read-only-and-client-guard");
  assert.deepEqual(calls, ["START TRANSACTION READ ONLY"]);
});

test("fallback requires TiDB and its unsupported-feature error", async () => {
  const error = Object.assign(new Error("unsupported"), { code: "ER_NOT_SUPPORTED_YET" });
  for (const version of ["8.0.11-TiDB-v7.5.0", "8.0.30-MySQL"]) {
    const calls = [];
    const db = {query: async sql => {
      calls.push(sql);
      if (sql === "START TRANSACTION READ ONLY") throw error;
      if (sql === "SELECT VERSION() AS version") return [[{version}]];
    }};
    if (version.includes("TiDB")) {
      assert.equal(await beginAudit(db), "tidb-client-read-guard-and-rollback");
      assert.equal(calls.at(-1), "START TRANSACTION");
    } else {
      await assert.rejects(beginAudit(db), error);
      assert.ok(!calls.includes("START TRANSACTION"));
    }
  }
});

test("connection and permission errors never enable fallback", async () => {
  let calls = 0;
  const error = Object.assign(new Error("denied"), {code: "ER_ACCESS_DENIED_ERROR"});
  await assert.rejects(beginAudit({query: async () => { calls++; throw error; }}), error);
  assert.equal(calls, 1);
});

test("database fingerprint excludes credentials and distinguishes databases", () => {
  const a = databaseFingerprint("mysql://alice:secret@host/shop");
  assert.equal(a, databaseFingerprint("mysql://bob:other@host:3306/shop"));
  assert.notEqual(a, databaseFingerprint("mysql://alice:secret@host/other"));
  assert.match(a, /^[a-f0-9]{64}$/);
});
