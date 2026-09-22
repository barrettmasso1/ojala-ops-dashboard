import { createHash } from "node:crypto";

export function assertAuditRead(sql) {
  if (typeof sql !== "string" || /;|--|\/\*|\*\/|#|:=/.test(sql)) throw new Error("AUDIT_SQL_REJECTED");
  if (sql === "START TRANSACTION READ ONLY" || sql === "START TRANSACTION" || sql === "ROLLBACK") return;
  if (/^SHOW CREATE TABLE `[A-Za-z][A-Za-z0-9]*`$/.test(sql)) return;
  if (!/^SELECT\s/i.test(sql) || /\b(INTO|OUTFILE|DUMPFILE|FOR\s+UPDATE|LOCK|INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|CALL|SLEEP|BENCHMARK|GET_LOCK|RELEASE_LOCK|LOAD_FILE)\b/i.test(sql)) throw new Error("AUDIT_SQL_REJECTED");
}

export function guardedAuditConnection(raw) {
  return {
    query(sql, params) { assertAuditRead(sql); return raw.query(sql, params); },
    execute(sql, params) { assertAuditRead(sql); return raw.execute(sql, params); },
    rollback() { return raw.query("ROLLBACK"); },
    end() { return raw.end(); },
  };
}

export async function beginAudit(connection) {
  try {
    await connection.query("START TRANSACTION READ ONLY");
    return "database-read-only-and-client-guard";
  } catch (error) {
    if (error?.code !== "ER_NOT_SUPPORTED_YET") throw error;
    const [[row]] = await connection.query("SELECT VERSION() AS version");
    if (!/tidb/i.test(String(row.version))) throw error;
    await connection.query("START TRANSACTION");
    return "tidb-client-read-guard-and-rollback";
  }
}

export function databaseFingerprint(connectionUrl) {
  const url = new URL(connectionUrl);
  // Exclude credentials. Equal fingerprints identify the same configured endpoint/database,
  // not necessarily the same deployed application or a database behind a different alias.
  return createHash("sha256").update(JSON.stringify({host: url.hostname.toLowerCase(), port: url.port || "3306", database: decodeURIComponent(url.pathname.slice(1))})).digest("hex");
}
