import { describe,it,expect } from "vitest";
import { hashText,parseLocalLedger,ledgerStorageKey,storedLedger,compareRevision,localLedgerReceipt,summarizeLocalLedger,possibleLocalRepeats,LOCAL_LEDGER_PROTOCOL } from "./localCupLedger";
import { saveLocalLedger,readLocalLedger,LedgerConflict,type LocalLedgerBlobStore } from "./localCupLedgerStorage";
const DEVICE="00000000-0000-4000-8000-000000000001";
const DAY="2026-01-20";
function observation(index=1){
 const sourceEventId=`1768940000.123456-cup${index}`;
 return {schema:"ojala_local_cup_observation_v1",observationId:hashText(DEVICE+"/handoff/"+sourceEventId),deviceId:DEVICE,cameraName:"handoff",sourceEventId,businessDate:DAY,startedAt:"2026-01-20T23:00:00+00:00",endedAt:null as string|null,detectorModelSha256:"a".repeat(64),detectorScore:.8,targetBox:[.4,.5,.08,.1],enteredHandoffZone:true,sourceFalsePositive:false,verification:"detector_track_only",size:"unknown",sizeBasis:"local_model_has_no_size_classes",physicalDeliveryConfirmed:false,salesCreated:false,sameFrameEvidence:null as any,sourceDetectorModelHash:null,sourceDetectorType:"openvino"};
}
function envelope(rows=[observation()],sequence=1,revision=1){
 const doc={schemaVersion:1,protocol:LOCAL_LEDGER_PROTOCOL,deviceId:DEVICE,cameraName:"handoff",businessDate:DAY,records:rows.map(o=>{const payloadJson=JSON.stringify(o);return {revision,payloadJson,payloadSha256:hashText(payloadJson)};})};
 const documentJson=JSON.stringify(doc);return {sequence,documentJson,documentSha256:hashText(documentJson)};
}
const parse=(e= envelope())=>parseLocalLedger(e,"America/Mazatlan");
function withProof(){const o=observation();o.verification="same_frame_local_cv";o.sameFrameEvidence={imageSha256:"b".repeat(64),capturedAt:"2026-01-20T23:00:01+00:00",sourceMetadataSha256:"c".repeat(64),sourceZoneSha256:"d".repeat(64),targetBox:[.4,.5,.08,.1],cupScore:.8,personDetections:1,gateVersion:"test-local",inferenceLocation:"local_beelink",generativeAiUsed:false};return o;}
class MemoryStore implements LocalLedgerBlobStore {
 rows=new Map<string,{text:string,etag:string}>();writes=0;loseWrite=false;race=false;
 async read(k:string){return this.rows.get(k)??null;}
 async compareAndPut(k:string,text:string,etag:string|null){
  if((this.rows.get(k)?.etag??null)!==etag)throw new LedgerConflict("conflict");
  if(this.loseWrite)return;
  this.writes++;this.rows.set(k,{text,etag:`"v${this.writes}"`});
  if(this.race)throw new LedgerConflict("conflict_after_identical_write");
 }
}

describe("native local cup ledger validation",()=>{
 it("accepts a source detection without pretending it is a delivery",()=>{const p=parse();expect(p.observations).toHaveLength(1);expect(p.observations[0].physicalDeliveryConfirmed).toBe(false);});
 it("verifies the outer bytes rather than trusting counts",()=>{const e=envelope();e.documentSha256="f".repeat(64);expect(()=>parse(e)).toThrow("checksum");});
 it("rejects per-record checksum changes",()=>{const e=envelope();const d=JSON.parse(e.documentJson);d.records[0].payloadSha256="f".repeat(64);e.documentJson=JSON.stringify(d);e.documentSha256=hashText(e.documentJson);expect(()=>parse(e)).toThrow("observation_checksum");});
 it("deduplicates by source identity, not photo cardinality",()=>{expect(()=>parse(envelope([observation(),observation()]))).toThrow("duplicate_source_identity");});
 it("preserves three simultaneous distinct detector targets",()=>{expect(parse(envelope([observation(1),observation(2),observation(3)])).observations).toHaveLength(3);});
 it("rejects a forged derived observation id",()=>{const o=observation();o.observationId="f".repeat(64);expect(()=>parse(envelope([o]))).toThrow("observation_identity");});
 it("rejects cross-device observations",()=>{const o=observation();o.deviceId="00000000-0000-4000-8000-000000000002";expect(()=>parse(envelope([o]))).toThrow("observation_scope");});
 it("does not accept local-calendar/UTC confusion",()=>{const o=observation();o.startedAt="2026-01-20T02:00:00Z";expect(()=>parse(envelope([o]))).toThrow("observation_date");});
 it("requires timezone-bearing timestamps",()=>{const o=observation();o.startedAt="2026-01-20T23:00:00";expect(()=>parse(envelope([o]))).toThrow();});
 it("rejects end before start",()=>{const o=observation();o.endedAt="2026-01-20T22:00:00Z";expect(()=>parse(envelope([o]))).toThrow("observation_end");});
 it("rejects unsupported size claims from single-class v4",()=>{const o=observation();o.size="pint";expect(()=>parse(envelope([o]))).toThrow();});
 it("rejects converting a detection into an approved delivery",()=>{const o=observation();o.physicalDeliveryConfirmed=true;expect(()=>parse(envelope([o]))).toThrow();});
 it("rejects unaudited local confirmation without evidence",()=>{const o=observation();o.verification="same_frame_local_cv";expect(()=>parse(envelope([o]))).toThrow("verification_without_evidence");});
 it("rejects inconsistent false-positive state",()=>{const o=observation();o.sourceFalsePositive=true;expect(()=>parse(envelope([o]))).toThrow("rejected_source_scope");});
 it("accepts a source-rejected object as rejected, not a cup count",()=>{const o=observation();o.sourceFalsePositive=true;o.verification="detector_rejected";expect(parse(envelope([o])).observations[0].verification).toBe("detector_rejected");});
 it("accepts local proof without calling a language model",()=>{expect(parse(envelope([withProof()])).observations[0].sameFrameEvidence?.generativeAiUsed).toBe(false);});
 it("rejects external-AI proof labelled as local",()=>{const o=withProof();o.sameFrameEvidence.generativeAiUsed=true;expect(()=>parse(envelope([o]))).toThrow();});
 it("rejects local image evidence captured after the track ended",()=>{const o=withProof();o.endedAt="2026-01-20T23:00:02Z";o.sameFrameEvidence.capturedAt="2026-01-20T23:00:10Z";expect(()=>parse(envelope([o]))).toThrow("local_evidence_time");});
 it("scopes storage by store and device",()=>{expect(ledgerStorageKey(1,DEVICE,DAY)).not.toBe(ledgerStorageKey(2,DEVICE,DAY));});
 it("rejects storage traversal",()=>{expect(()=>ledgerStorageKey(1,"../../other",DAY)).toThrow();});
 it("rejects client-provided store selection inside document",()=>{const e=envelope();const d=JSON.parse(e.documentJson);d.storeId=2;e.documentJson=JSON.stringify(d);e.documentSha256=hashText(e.documentJson);expect(()=>parse(e)).toThrow();});
 it("preserves unknown size in summary without manual sales",()=>{const s=summarizeLocalLedger(parse(envelope([withProof()])),new Date().toISOString());expect(s.sizeBreakdown.unknown).toBe(1);expect(s.uniquePhysicalDeliveries).toBeNull();expect(s.manualOrSalesCountsUsed).toBe(false);});
});

describe("versioned local ledger storage and receipts",()=>{
 it("confirms only a fresh persisted readback",async()=>{const store=new MemoryStore();const p=parse();const result=await saveLocalLedger(store,p,1,"America/Mazatlan");expect(result.receipt.persisted).toBe(true);expect(result.receipt.externalAiInvoked).toBe(false);expect(store.writes).toBe(1);});
 it("repeated identical submission does not write or duplicate",async()=>{const store=new MemoryStore();const p=parse();await saveLocalLedger(store,p,1,"America/Mazatlan");const r=await saveLocalLedger(store,p,1,"America/Mazatlan");expect(r.disposition).toBe("already_persisted");expect(store.writes).toBe(1);});
 it("a successful PUT without a stored document is not a receipt",async()=>{const store=new MemoryStore();store.loseWrite=true;await expect(saveLocalLedger(store,parse(),1,"America/Mazatlan")).rejects.toThrow("persisted_ledger_missing");});
 it("handles a concurrent identical write with real readback",async()=>{const store=new MemoryStore();store.race=true;const r=await saveLocalLedger(store,parse(),1,"America/Mazatlan");expect(r.receipt.persisted).toBe(true);});
 it("a new sequence cannot delete old observations",()=>{const before=storedLedger(parse(envelope([observation(1),observation(2)])),1);expect(()=>compareRevision(before,parse(envelope([observation(2)],2)))).toThrow("previous_observation_omitted");});
 it("a stale ledger sequence cannot overwrite a newer one",()=>{expect(()=>compareRevision(storedLedger(parse(envelope([observation()],2)),1),parse())).toThrow("stale_ledger_revision");});
 it("same sequence with altered bytes is a conflict",()=>{expect(()=>compareRevision(storedLedger(parse(),1),parse(envelope([observation(2)])))).toThrow("ledger_revision_conflict");});
 it("source identity is immutable across updates",()=>{const old=observation();const changed={...old,startedAt:"2026-01-20T23:00:00.001Z"};expect(()=>compareRevision(storedLedger(parse(envelope([old])),1),parse(envelope([changed],2,2)))).toThrow("historical_identity_changed");});
 it("confirmed evidence may not disappear in the next snapshot",()=>{expect(()=>compareRevision(storedLedger(parse(envelope([withProof()])),1),parse(envelope([observation()],2,2)))).toThrow("historical_image_changed");});
 it("a closed source track cannot reopen",()=>{const old=observation();old.endedAt="2026-01-20T23:00:02Z";expect(()=>compareRevision(storedLedger(parse(envelope([old])),1),parse(envelope([observation()],2,2)))).toThrow("closed_track_reopened");});
 it("a changed record requires its own revision increment",()=>{const changed=observation();changed.endedAt="2026-01-20T23:00:02Z";expect(()=>compareRevision(storedLedger(parse(),1),parse(envelope([changed],2,1)))).toThrow("observation_revision_conflict");});
 it("persisted receipts cannot masquerade as daily deliveries",()=>{const p=parse();const r=localLedgerReceipt(storedLedger(p,1),p);expect(r.physicalDeliveryCountCreated).toBe(false);expect(r.countsAreSales).toBe(false);});
 it("a different stored snapshot cannot acknowledge this request",()=>{const p=parse();const stored=storedLedger(parse(envelope([observation(2)])),1);expect(()=>localLedgerReceipt(stored,p)).toThrow("readback_mismatch");});
 it("one store cannot read another store's ledger",async()=>{const s=new MemoryStore();await saveLocalLedger(s,parse(),1,"America/Mazatlan");expect(await readLocalLedger(s,2,DEVICE,DAY,"America/Mazatlan")).toBeNull();});
 it("missing ledger is null, not zero physical cups",async()=>{expect(await readLocalLedger(new MemoryStore(),1,DEVICE,DAY,"America/Mazatlan")).toBeNull();});
 it("the stored observation list survives a transport restart",async()=>{const s=new MemoryStore();await saveLocalLedger(s,parse(envelope([observation(1),observation(2)])),1,"America/Mazatlan");const r=await readLocalLedger(s,1,DEVICE,DAY,"America/Mazatlan");expect(r?.records).toHaveLength(2);expect(r?.withoutSameFrameEvidence).toBe(2);});
});

describe("cross-track repetition warnings",()=>{
 it("marks a short gap in the same place without reducing records",()=>{const a=observation(1);a.endedAt="2026-01-20T23:00:02Z";const b=observation(2);b.startedAt="2026-01-20T23:00:05Z";const p=parse(envelope([a,b]));const s=summarizeLocalLedger(p,new Date().toISOString());expect(s.potentialRepeatedTracks).toBe(1);expect(s.detectedTracks).toBe(2);expect(s.uniquePhysicalDeliveries).toBeNull();});
 it("does not merge simultaneously visible source tracks",()=>{const a=observation(1);a.endedAt="2026-01-20T23:00:20Z";const b=observation(2);b.startedAt="2026-01-20T23:00:05Z";expect(possibleLocalRepeats(parse(envelope([a,b])).observations)).toEqual({});});
 it("does not identify new servings after a long gap as duplicates",()=>{const a=observation(1);a.endedAt="2026-01-20T23:00:02Z";const b=observation(2);b.startedAt="2026-01-20T23:05:00Z";expect(possibleLocalRepeats(parse(envelope([a,b])).observations)).toEqual({});});
});
