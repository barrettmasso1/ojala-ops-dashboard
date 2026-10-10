import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const requiredTables = ["users", "checklistQuestions", "openingChecklists", "closingChecklists", "endOfDayReports", "inventoryItems", "readyMadeGelatoWeights", "submissionHistoryEntries", "staffAttendance", "frigateCupCounts", "recipes", "recipeIngredients"];
const dailyTables = new Set(["openingChecklists", "closingChecklists", "endOfDayReports", "readyMadeGelatoWeights", "submissionHistoryEntries", "staffAttendance", "frigateCupCounts"]);
function validCount(value) { return Number.isSafeInteger(Number(value)) && Number(value) >= 0 && value !== null && value !== "" && value !== undefined; }
function coverage(rows) {
  if (!Array.isArray(rows)) return null;
  const map = new Map();
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.businessDate ?? "") || !validCount(row.rowCount)) return null;
    map.set(row.businessDate, (map.get(row.businessDate) ?? 0) + Number(row.rowCount));
  }
  return JSON.stringify([...map].sort(([a], [b]) => a.localeCompare(b)));
}

export function verifyPhase1Evidence(before, after) {
  const failures = [];
  if (!/^[a-f0-9]{64}$/.test(before?.databaseFingerprint ?? "") || before.databaseFingerprint !== after?.databaseFingerprint) failures.push("Database fingerprints missing or different");
  if (!before?.period?.from || !before?.period?.to || before.period.from !== after?.period?.from || before.period.to !== after?.period?.to) failures.push("Audit periods missing or different");
  if (after?.schemaReady !== true || !Array.isArray(after?.blockers) || after.blockers.length) failures.push("Post-migration schema has not passed the audit");
  for (const [label, report] of [["before", before], ["after", after]]) {
    if (!Array.isArray(report?.storeIds) || report.storeIds.length !== 1 || Number(report.storeIds[0]) !== 1) failures.push(`${label}: this legacy migration requires only store 1; audit separately if other stores already exist`);
    if (report?.readOnly !== true) failures.push(`${label}: read-only audit marker missing`);
  }
  const a = new Map((Array.isArray(before?.tables) ? before.tables : []).map(t => [t.table, t]));
  const b = new Map((Array.isArray(after?.tables) ? after.tables : []).map(t => [t.table, t]));
  for (const name of requiredTables) {
    const old = a.get(name), current = b.get(name);
    if (!old?.exists || !current?.exists || !validCount(old.rowCount) || !validCount(current.rowCount)) { failures.push(`${name}: missing table/count evidence`); continue; }
    if (Number(old.rowCount) !== Number(current.rowCount)) failures.push(`${name}: row count changed; reconcile writes or restore before certification`);
    if (current.storeIdColumn?.nullable !== "NO" || current.hasStoreForeignKey !== true || current.hasTenantLeadingIndex !== true || current.orphanCount !== 0) failures.push(`${name}: incomplete tenant schema/orphan evidence`);
    if (!Array.isArray(current.tenantCounts)) failures.push(`${name}: missing tenant counts`);
    else {
      const valid = current.tenantCounts.every(row => Number(row.storeId) === 1 && validCount(row.rowCount));
      const total = current.tenantCounts.reduce((n, row) => n + Number(row.rowCount), 0);
      if (!valid || total !== Number(current.rowCount)) failures.push(`${name}: historical rows are not fully assigned to store 1`);
    }
    if (dailyTables.has(name)) {
      const previous = coverage(old.dailyCoverage), next = coverage(current.dailyCoverage);
      if (previous === null || next === null || previous !== next) failures.push(`${name}: daily coverage changed or missing`);
      if (!old.allTimeRange || !current.allTimeRange || old.allTimeRange.firstBusinessDate !== current.allTimeRange.firstBusinessDate || old.allTimeRange.lastBusinessDate !== current.allTimeRange.lastBusinessDate) failures.push(`${name}: all-time date coverage changed or missing`);
    }
  }
  return {
    databaseChecksPassed: failures.length === 0,
    phase1Certified: false,
    failures,
    remainingEvidence: ["Verify the published deployment uses the audited database", "Verify a recoverable backup and row-level preservation separately", "Validate manager/staff authentication", "Validate store 2 cannot read or modify store 1 through operational APIs", "Validate Frigate ingestion and business counts"],
    limitation: "Aggregate comparisons cannot detect every row-level change. Equal counts are not proof of complete data preservation. Run within a controlled migration window or reconcile concurrent writes.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) { console.error("Usage: node scripts/verify-phase1-evidence.mjs before.json after.json"); process.exitCode = 1; }
  else try {
    const before = JSON.parse(await readFile(process.argv[2], "utf8"));
    const after = JSON.parse(await readFile(process.argv[3], "utf8"));
    const result = verifyPhase1Evidence(before, after);
    console.log(JSON.stringify(result, null, 2));
    if (!result.databaseChecksPassed) process.exitCode = 2;
  } catch { console.error("Cannot read valid audit reports. No database connection or write was attempted."); process.exitCode = 1; }
}
