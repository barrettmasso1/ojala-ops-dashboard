import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const target = {
  host: process.env.REHEARSAL_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.REHEARSAL_DB_PORT ?? "4000"),
  user: process.env.REHEARSAL_DB_USER ?? "root",
  database: "ojala_phase1_rehearsal",
};
const args = process.argv.slice(2);
const dumpIndex = args.indexOf("--dump");
const reset = args.includes("--reset");
if (dumpIndex < 0 || !args[dumpIndex + 1]) {
  throw new Error("Usage: node rehearsal/beelink-phase1/scripts/restore-isolated.mjs --dump /absolute/path/to/backup [--reset]");
}
if (target.host !== "127.0.0.1" || target.port !== 4000 || target.database !== "ojala_phase1_rehearsal") {
  throw new Error("Refusing restore: target must be the fixed local TiDB rehearsal endpoint");
}
const dump = path.resolve(args[dumpIndex + 1]);
if (!existsSync(dump)) throw new Error("Backup directory does not exist");
const sqlFiles = readdirSync(dump).filter(file => file.endsWith(".sql")).sort();
const schemaFiles = sqlFiles.filter(file => file.endsWith("-schema.sql") && !file.endsWith("-schema-create.sql"));
const dataFiles = sqlFiles.filter(file => /\.\d{9}\.sql$/.test(file));
if (schemaFiles.length === 0 || dataFiles.length === 0) throw new Error("Backup layout is missing schema or data SQL files");

const forbidden = /\b(CREATE|DROP|ALTER|USE)\s+DATABASE\b|`m6piugSRrMfjwvid4xHM78`|\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE)\s+(?:INTO\s+)?`[^`]+`\.`/i;
function safeSql(file) {
  const body = readFileSync(path.join(dump, file), "utf8");
  if (forbidden.test(body)) throw new Error(`Refusing unsafe dump directive in ${file}`);
  return body;
}

const connection = await mysql.createConnection({
  host: target.host,
  port: target.port,
  user: target.user,
  multipleStatements: true,
});
try {
  const [versionRows] = await connection.query("SELECT VERSION() AS version");
  if (!/tidb/i.test(String(versionRows[0]?.version ?? ""))) throw new Error("Refusing non-TiDB rehearsal target");
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${target.database}\``);
  const [tables] = await connection.query(`SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`, [target.database]);
  if (Number(tables[0]?.count ?? 0) > 0) {
    if (!reset) throw new Error("Rehearsal database is not empty; use --reset only for the fixed local rehearsal database");
    await connection.query(`DROP DATABASE \`${target.database}\``);
    await connection.query(`CREATE DATABASE \`${target.database}\``);
  }
  await connection.query(`USE \`${target.database}\``);
  for (const file of schemaFiles) await connection.query(safeSql(file));
  for (const file of dataFiles) await connection.query(safeSql(file));
  const [restoredTables] = await connection.query("SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()");
  const digest = createHash("sha256").update(sqlFiles.map(file => `${file}:${readFileSync(path.join(dump, file)).length}`).join("\n")).digest("hex");
  process.stdout.write(JSON.stringify({
    restored: true,
    target: { host: target.host, port: target.port, database: target.database },
    schemaFiles: schemaFiles.length,
    dataFiles: dataFiles.length,
    restoredTableCount: Number(restoredTables[0]?.count ?? 0),
    backupLayoutDigest: digest,
  }, null, 2) + "\n");
} finally {
  await connection.end();
}
