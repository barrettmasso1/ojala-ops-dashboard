import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { encodeCupReviewNotes, parseCupReviewNotes } from "../shared/cupDescriptions";
const fixture = vi.hoisted(() => ({row:null as any, affectedRows:1, writes:[] as any[], wheres:[] as any[], foreign:false, storedMismatch:false}));
vi.mock("drizzle-orm/mysql2", () => ({drizzle:()=>({
 select:()=>({from:()=>({where:(condition:any)=>({limit:async()=>{fixture.wheres.push(condition);return fixture.foreign?[]:fixture.row?[{...fixture.row}]:[];}})})}),
 update:(table:any)=>({set:(changes:any)=>({where:async(condition:any)=>{
   fixture.wheres.push(condition);fixture.writes.push({table,changes});
   if(fixture.affectedRows===1 && !fixture.storedMismatch)fixture.row={...fixture.row,...changes};
   return [{affectedRows:fixture.affectedRows}];
 }})}),
})}));
process.env.DATABASE_URL="mysql://test_fixture_no_network";
const {saveHandoffCupDescriptions,reviewHandoffVisualEvent,cupDescriptionRevision}=await import("./db");
const now="2026-10-22T00:00:00Z";
const items=[{slot:1,size:"pint" as const,note:""}];
const request=()=>({id:930001,storeId:2,userId:99,expectedRevision:cupDescriptionRevision(fixture.row.reviewNotes),items});
beforeEach(()=>{fixture.row={id:930001,storeId:2,reviewNotes:"Preserve original note",imageKey:null,visibleCupCount:1,analysisStatus:"approved_by_ai",imageSha256:"a".repeat(64)};fixture.affectedRows=1;fixture.writes=[];fixture.wheres=[];fixture.foreign=false;fixture.storedMismatch=false;});
describe("persisted sizes use existing notes safely without migrations",()=>{
 it("writes only annotations and reads them back",async()=>{const out=await saveHandoffCupDescriptions(request());expect(out.cupDescriptions[0].size).toBe("pint");expect(out.reviewNotes).toBe("Preserve original note");expect(Object.keys(fixture.writes[0].changes)).toEqual(["reviewNotes"]);expect(out.analysisStatus).toBe("approved_by_ai");expect(out.imageSha256).toBe("a".repeat(64));});
 it("scopes all reads and writes to the authenticated store",async()=>{await saveHandoffCupDescriptions(request());for(const w of fixture.wheres){const q=new MySqlDialect().sqlToQuery(w);expect(q.sql).toContain('storeId');expect(q.params).toContain(2);expect(q.params).toContain(930001);}});
 it("does not update a foreign event",async()=>{fixture.foreign=true;await expect(saveHandoffCupDescriptions(request())).rejects.toThrow("not found");expect(fixture.writes).toHaveLength(0);});
 it("stale edit is rejected before writing",async()=>{await expect(saveHandoffCupDescriptions({...request(),expectedRevision:"f".repeat(64)})).rejects.toThrow("changed");expect(fixture.writes).toHaveLength(0);});
 it("compare-and-swap conflict is rejected",async()=>{fixture.affectedRows=0;await expect(saveHandoffCupDescriptions(request())).rejects.toThrow("changed");});
 it("successful SQL without matching readback is not called success",async()=>{fixture.storedMismatch=true;await expect(saveHandoffCupDescriptions(request())).rejects.toThrow("readback");});
 it("null legacy notes are supported",async()=>{fixture.row.reviewNotes=null;const out=await saveHandoffCupDescriptions(request());expect(out.reviewNotes).toBe("");expect(out.cupDescriptions[0].size).toBe("pint");});
 it("manager approval preserves saved descriptions and size attribution",async()=>{fixture.row.reviewNotes=encodeCupReviewNotes("old",items,88,now);const out=await reviewHandoffVisualEvent({id:930001,storeId:2,reviewedByUserId:99,decision:"approved_by_manager",reviewNotes:"new note"});expect(out.cupDescriptions[0].size).toBe("pint");expect(out.reviewNotes).toBe("new note");expect(parseCupReviewNotes(fixture.row.reviewNotes).annotation?.updatedByUserId).toBe(88);});
});
