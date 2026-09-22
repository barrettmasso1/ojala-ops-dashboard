// Read-only production audit. Never prints DATABASE_URL or user records.
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { beginAudit, databaseFingerprint, guardedAuditConnection } from "./audit-readonly.mjs";

const { values } = parseArgs({ options: {
  from: { type: "string", default: "2026-07-01" },
  to: { type: "string", default: new Date().toISOString().slice(0, 10) },
  output: { type: "string" },
  help: { type: "boolean", default: false },
} });
if (values.help) {
  console.log("DATABASE_URL=<existing environment> node scripts/audit-phase1.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--output report.json]\nRead-only: schema, row counts, tenant assignments, and daily data coverage. No credentials or personal records in output.");
  process.exit(0);
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
if (!validDate(values.from) || !validDate(values.to) || values.from > values.to) {
  console.error("Use valid --from and --to dates in YYYY-MM-DD order.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required in the environment; do not paste credentials into chat.");
  process.exit(1);
}

const expectedTables = ["users", "checklistQuestions", "openingChecklists", "closingChecklists", "endOfDayReports", "inventoryItems", "readyMadeGelatoWeights", "submissionHistoryEntries", "staffAttendance", "frigateCupCounts", "recipes", "recipeIngredients"];
const dailyTables = ["openingChecklists", "closingChecklists", "endOfDayReports", "readyMadeGelatoWeights", "submissionHistoryEntries", "staffAttendance", "frigateCupCounts"];
const tenantUnique = {
  frigateCupCounts: ["storeId", "businessDate", "cameraName"],
  recipes: ["storeId", "name"],
};

let connection;
let transactionStarted = false;
try {
  const mysql = await import("mysql2/promise");
  connection = guardedAuditConnection(await mysql.createConnection(process.env.DATABASE_URL));
  const readOnlyEnforcement = await beginAudit(connection);
  transactionStarted = true;
  const [columns] = await connection.query("SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()");
  const [indexes] = await connection.query("SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS sequence, COLUMN_NAME AS columnName FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX");
  const [foreignKeys] = await connection.query("SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, REFERENCED_TABLE_NAME AS referencedTable, REFERENCED_COLUMN_NAME AS referencedColumn FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL");
  const hasColumn = (table, column) => columns.some(row => row.tableName === table && row.columnName === column);
  const tables = [];
  const blockers = [];
  const storeTableReady = hasColumn("stores", "id");
  let storeIds = [];
  const schemaDefinitions = {};
  if (storeTableReady) {
    [storeIds] = await connection.query("SELECT id FROM stores ORDER BY id");
    const [[definition]] = await connection.query("SHOW CREATE TABLE `stores`");
    schemaDefinitions.stores = definition["Create Table"];
  }
  if (!storeIds.some(row => Number(row.id) === 1)) blockers.push("Ojala store id=1 is missing");

  for (const table of expectedTables) {
    // Identifiers are exclusively the fixed allowlist above, never CLI input.
    const exists = columns.some(row => row.tableName === table);
    const item = { table, exists };
    tables.push(item);
    if (!exists) { blockers.push(`${table}: table missing`); continue; }
    const [[definition]] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
    schemaDefinitions[table] = definition["Create Table"];
    const [[total]] = await connection.query(`SELECT COUNT(*) AS rowCount FROM \`${table}\``);
    item.rowCount = Number(total.rowCount);
    item.storeIdColumn = columns.find(row => row.tableName === table && row.columnName === "storeId") ?? null;
    if (!item.storeIdColumn) blockers.push(`${table}: storeId missing`);
    else {
      if (item.storeIdColumn.nullable !== "NO") blockers.push(`${table}: storeId is nullable`);
      const [assignments] = await connection.query(`SELECT storeId, COUNT(*) AS rowCount FROM \`${table}\` GROUP BY storeId ORDER BY storeId`);
      item.tenantCounts = assignments;
      if (assignments.some(row => row.storeId == null)) blockers.push(`${table}: unassigned rows`);
      if (storeTableReady) {
        const [[orphans]] = await connection.query(`SELECT COUNT(*) AS rowCount FROM \`${table}\` t LEFT JOIN stores s ON s.id=t.storeId WHERE t.storeId IS NOT NULL AND s.id IS NULL`);
        item.orphanCount = Number(orphans.rowCount);
        if (item.orphanCount) blockers.push(`${table}: orphan tenant assignments`);
      }
      item.hasStoreForeignKey = foreignKeys.some(row => row.tableName === table && row.columnName === "storeId" && row.referencedTable === "stores" && row.referencedColumn === "id");
      if (!item.hasStoreForeignKey) blockers.push(`${table}: store foreign key missing`);
      item.hasTenantLeadingIndex = indexes.some(row => row.tableName === table && Number(row.sequence) === 1 && row.columnName === "storeId");
      if (!item.hasTenantLeadingIndex) blockers.push(`${table}: tenant-leading index missing`);
    }
    if (tenantUnique[table]) {
      const grouped = new Map();
      for (const index of indexes.filter(row => row.tableName === table && Number(row.nonUnique) === 0)) {
        grouped.set(index.indexName, [...(grouped.get(index.indexName) ?? []), index.columnName]);
      }
      item.uniqueIndexes = Object.fromEntries(grouped);
      const required = tenantUnique[table];
      if (![...grouped.values()].some(keys => JSON.stringify(keys) === JSON.stringify(required))) blockers.push(`${table}: tenant-scoped unique index missing`);
      if ([...grouped.values()].some(keys => JSON.stringify(keys) === JSON.stringify(required.slice(1)))) blockers.push(`${table}: legacy global unique index still present`);
    }
    if (dailyTables.includes(table) && hasColumn(table, "businessDate")) {
      const [[range]] = await connection.query(`SELECT MIN(businessDate) AS firstBusinessDate, MAX(businessDate) AS lastBusinessDate FROM \`${table}\``);
      item.allTimeRange = range;
      const tenant = item.storeIdColumn ? ", storeId" : "";
      const [coverage] = await connection.execute(`SELECT businessDate${tenant}, COUNT(*) AS rowCount FROM \`${table}\` WHERE businessDate >= ? AND businessDate <= ? GROUP BY businessDate${tenant} ORDER BY businessDate${tenant}`, [values.from, values.to]);
      item.dailyCoverage = coverage;
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    period: { from: values.from, to: values.to },
    readOnly: true,
    readOnlyEnforcement,
    databaseFingerprint: databaseFingerprint(process.env.DATABASE_URL),
    environmentVerified: false,
    schemaDefinitions,
    schemaReady: blockers.length === 0,
    phase1Certified: false,
    outstandingEvidence: ["Compare historical row counts against the pre-migration backup", "Verify authenticated manager and staff login", "Verify store 2 cannot read or modify store 1 through every operational API", "Verify Frigate ingestion writes to the correct store"],
    blockers,
    storeIds: storeIds.map(row => row.id),
    tables,
  };
  await connection.rollback();
  transactionStarted = false;
  const output = JSON.stringify(report, null, 2) + "\n";
  if (values.output) {
    // Exclusive creation prevents overwriting a previous audit.
    await writeFile(values.output, output, { flag: "wx", mode: 0o600 });
    console.log("Read-only audit saved. Schema blockers:", blockers.length);
  } else console.log(output);
  if (blockers.length) process.exitCode = 2;
} catch (error) {
  // Driver error messages may contain connection details: emit only an error code.
  console.error("Audit failed; no application data was changed. Error code:", typeof error?.code === "string" ? error.code : "AUDIT_ERROR");
  process.exitCode = 1;
} finally {
  if (connection) {
    if (transactionStarted) await connection.rollback().catch(() => {});
    await connection.end();
  }
}
