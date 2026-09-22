import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const tables = ["users", "checklistQuestions", "openingChecklists", "closingChecklists", "endOfDayReports", "inventoryItems", "readyMadeGelatoWeights", "submissionHistoryEntries", "staffAttendance", "frigateCupCounts", "recipes", "recipeIngredients"];
const outputIndex = process.argv.indexOf("--output");
if (outputIndex < 0 || !process.argv[outputIndex + 1]) throw new Error("Usage: node capture-row-fingerprints.mjs --output file.json");
const output = process.argv[outputIndex + 1];
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
  const report = { generatedAt: new Date().toISOString(), database: "ojala_phase1_rehearsal", tables: {} };
  for (const table of tables) {
    const [columns] = await connection.query(`SHOW COLUMNS FROM \`${table}\``);
    const names = columns.map(column => column.Field);
    const [rows] = await connection.query(`SELECT ${names.map(name => `\`${name}\``).join(", ")} FROM \`${table}\` ORDER BY \`id\``);
    report.tables[table] = {
      columns: names,
      rows: rows.map(row => ({ id: String(row.id), hash: hash(row) })),
      aggregateHash: hash(rows),
    };
  }
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  process.stdout.write(JSON.stringify({ captured: true, output, tables: tables.length }, null, 2) + "\n");
} finally {
  await connection.end();
}
