import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const inputIndex = process.argv.indexOf("--before");
if (inputIndex < 0 || !process.argv[inputIndex + 1]) throw new Error("Usage: node verify-row-fingerprints.mjs --before before-row-fingerprints.json");
const before = JSON.parse(await readFile(process.argv[inputIndex + 1], "utf8"));
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

function stableValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}
function hash(value) { return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex"); }

const connection = await mysql.createConnection(databaseUrl);
try {
  const [identity] = await connection.query("SELECT VERSION() AS version, DATABASE() AS databaseName");
  if (!/tidb/i.test(String(identity[0]?.version ?? "")) || identity[0]?.databaseName !== "ojala_phase1_rehearsal") throw new Error("Refusing non-local rehearsal database");
  const failures = [];
  for (const [table, expected] of Object.entries(before.tables)) {
    const columns = expected.columns;
    const [rows] = await connection.query(`SELECT ${columns.map(name => `\`${name}\``).join(", ")} FROM \`${table}\` ORDER BY \`id\``);
    const actual = rows.map(row => ({ id: String(row.id), hash: hash(row) }));
    if (JSON.stringify(actual) !== JSON.stringify(expected.rows)) failures.push(table);
  }
  const result = { rowLevelPreservationPassed: failures.length === 0, failures };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (failures.length) process.exitCode = 2;
} finally {
  await connection.end();
}
