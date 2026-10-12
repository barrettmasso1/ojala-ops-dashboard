import { test } from "node:test";
import assert from "node:assert/strict";
import { requiredTables, verifyPhase1Evidence } from "./verify-phase1-evidence.mjs";
function fixture() {
  const report = {databaseFingerprint:"a".repeat(64), period:{from:"2026-07-01",to:"2026-09-22"}, readOnly:true, schemaReady:true, blockers:[], storeIds:[1], tables:requiredTables.map(table => ({table,exists:true,rowCount:2,storeIdColumn:{nullable:"NO"},hasStoreForeignKey:true,hasTenantLeadingIndex:true,orphanCount:0,tenantCounts:[{storeId:1,rowCount:2}],dailyCoverage:[{businessDate:"2026-08-25",rowCount:2}],allTimeRange:{firstBusinessDate:"2026-08-25",lastBusinessDate:"2026-08-25"}}))};
  return [structuredClone(report), structuredClone(report)];
}
test("matching aggregate evidence passes but never certifies production", () => {
  const result=verifyPhase1Evidence(...fixture());
  assert.equal(result.databaseChecksPassed,true);
  assert.equal(result.phase1Certified,false);
  assert.ok(result.remainingEvidence.length);
});
test("different environments or periods block acceptance", () => {
  for(const change of [r=>r.databaseFingerprint="b".repeat(64),r=>delete r.databaseFingerprint,r=>r.period.to="2026-09-23"]){const [a,b]=fixture();change(b);assert.equal(verifyPhase1Evidence(a,b).databaseChecksPassed,false);}
});
test("missing and reassigned rows block acceptance", () => {
  for(const change of [r=>r.tables[0].rowCount=1,r=>r.tables[0].tenantCounts[0].storeId=2,r=>delete r.tables[0].tenantCounts,r=>r.tables.pop(),r=>r.storeIds.push(2)]){const [a,b]=fixture();change(b);assert.equal(verifyPhase1Evidence(a,b).databaseChecksPassed,false);}
});
test("daily changes fail even when total row counts match", () => {
  const [a,b]=fixture();b.tables.find(t=>t.table==='openingChecklists').dailyCoverage[0].businessDate='2026-08-26';
  assert.equal(verifyPhase1Evidence(a,b).databaseChecksPassed,false);
});
test("incomplete schema evidence fails despite a schemaReady flag", () => {
  for(const change of [r=>r.tables[0].hasStoreForeignKey=false,r=>r.tables[0].orphanCount=1,r=>r.tables[0].storeIdColumn=null,r=>r.blockers=['missing index']]){const [a,b]=fixture();change(b);assert.equal(verifyPhase1Evidence(a,b).databaseChecksPassed,false);}
});
test("empty or malformed reports fail closed", () => {
  for(const report of [null,{}, {tables:[]}]) assert.equal(verifyPhase1Evidence(report,report).databaseChecksPassed,false);
});
