import {describe,it,expect} from "vitest";
import {hashText,type LocalObservation} from "./localCupLedger";
import {nativeEvidenceIdentity,nativeEvidenceUpload,requireEvidenceObservation,validateNativeEvidence,localEvidenceSource,nativeEvidenceReceipt,isNativeLocalEvidenceSource} from "./nativeLocalEvidence";
import {isDeferredHandoffSource} from "./handoffDurableReceipt";
const deviceId="00000000-0000-4000-8000-000000000001",day="2026-07-18",event="fixture-cup-photo-001";
function fixture(){
 const points=[{x:.1,y:.2},{x:.8,y:.2},{x:.8,y:.9}];
 const zone={coordinate_system:"normalized",membership_rule:"box_bottom_center",name:"handoff_zone",polygon:points.map(p=>[p.x,p.y]),reference_height:1080,reference_width:1920};
 const zoneJson=JSON.stringify(zone),at="2026-07-18T22:03:00.000Z";
 const source={schema_version:3,camera:"handoff",cup_zone:"handoff_zone",cup_event_id:event,captured_at_utc:at,image_sha256:"a".repeat(64),zone_geometry:zone,zone_config_sha256:hashText(zoneJson),image_dimensions:{width:1920,height:1080}};
 const raw=JSON.stringify(source),observationId=hashText(deviceId+"/handoff/"+event);
 const observation={deviceId,observationId,businessDate:day,cameraName:"handoff",sourceEventId:event,sourceFalsePositive:false,verification:"same_frame_local_cv",sameFrameEvidence:{imageSha256:source.image_sha256,capturedAt:at,originalSidecarSha256:hashText(raw),sourceZoneSha256:hashText(zoneJson)}} as unknown as LocalObservation;
 const upload={deviceId,businessDate:day,observationId,imageDataUrl:"data:image/jpeg;base64,/9j/AAAAAAAAAAAA",normalizationProof:{adapter:"beelink_object_v3" as const,sourceMetadataJson:raw,sourceMetadataSha256:hashText(raw),sourceZoneCanonicalJson:zoneJson},capture:{...source,schema_version:3 as const,camera:"handoff" as const,cup_zone:"handoff_zone" as const,zone_geometry:points,zone_config_sha256:hashText(JSON.stringify(points))}};
 const row={id:123,storeId:1,businessDate:day,cameraName:"handoff",cupEventId:event,imageSha256:source.image_sha256,imageKey:"existing-private.jpg",capturedAt:new Date(at),receivedAt:new Date("2026-07-18T22:04:00Z"),captureMetadataJson:JSON.stringify(upload.capture),evidenceOrigin:"verified_snapshot",analysisStatus:"pending_review",sourceDetail:localEvidenceSource(observation)};
 return {observation,upload,row};
}
describe("native original photo proof and receipt",()=>{
 it("accepts original normalized proof without calling a model",()=>{const f=fixture();nativeEvidenceUpload.parse(f.upload);expect(validateNativeEvidence(f.observation,f.upload,"America/Mazatlan").normalizationAudit).toBeDefined();});
 it("never requests the deferred AI worker",()=>expect(isDeferredHandoffSource(localEvidenceSource(fixture().observation))).toBe(false));
 it("marks only the native prefix as local-only evidence",()=>{const source=localEvidenceSource(fixture().observation);expect(isNativeLocalEvidenceSource(source)).toBe(true);expect(isNativeLocalEvidenceSource("verified_snapshot")).toBe(false);});
 it.each(["deviceId","businessDate","observationId"] as const)("rejects wrong %s before storage",key=>{const f=fixture();(f.upload as any)[key]="other";expect(()=>requireEvidenceObservation(f.observation,f.upload,true)).toThrow();});
 it("requires a persisted original observation",()=>expect(()=>requireEvidenceObservation(null,fixture().upload,true)).toThrow());
 it("rejects missing same-frame proof",()=>{const f=fixture();f.observation.sameFrameEvidence=null;expect(()=>validateNativeEvidence(f.observation,f.upload,"America/Mazatlan")).toThrow();});
 it("owner-excluded noncups cannot be newly uploaded",()=>{const f=fixture();f.observation.ownerSizeReview={label:"not_cup"} as any;expect(()=>requireEvidenceObservation(f.observation,f.upload,true)).toThrow();});
 it("a receipt may still identify earlier evidence later excluded",()=>{const f=fixture();f.observation.ownerSizeReview={label:"not_cup"} as any;expect(requireEvidenceObservation(f.observation,f.upload)).toBe(f.observation);});
 it("source rejection cannot be uploaded as valid",()=>{const f=fixture();f.observation.sourceFalsePositive=true;expect(()=>validateNativeEvidence(f.observation,f.upload,"America/Mazatlan")).toThrow();});
 it("different image cannot reuse an observation",()=>{const f=fixture();f.upload.capture.image_sha256="b".repeat(64);expect(()=>validateNativeEvidence(f.observation,f.upload,"America/Mazatlan")).toThrow();});
 it("different capture time cannot reuse an observation",()=>{const f=fixture();f.upload.capture.captured_at_utc="2026-07-18T22:03:10Z";expect(()=>validateNativeEvidence(f.observation,f.upload,"America/Mazatlan")).toThrow();});
 it("original metadata bytes must match the ledger proof",()=>{const f=fixture();f.upload.normalizationProof.sourceMetadataJson+=" ";expect(()=>validateNativeEvidence(f.observation,f.upload,"America/Mazatlan")).toThrow();});
 it("original geometry cannot be silently replaced",()=>{const f=fixture();f.upload.normalizationProof.sourceZoneCanonicalJson="{}";expect(()=>validateNativeEvidence(f.observation,f.upload,"America/Mazatlan")).toThrow();});
 it("upload schema rejects client-selected tenant",()=>{const f=fixture();expect(()=>nativeEvidenceUpload.parse({...f.upload,storeId:2})).toThrow();});
 it("receipt-only schema cannot contain image bytes",()=>expect(()=>nativeEvidenceIdentity.parse(fixture().upload)).toThrow());
 it("no receipt until a real image key exists",()=>{const f=fixture();expect(nativeEvidenceReceipt({...f.row,imageKey:null},f.observation,1)).toBeNull();expect(nativeEvidenceReceipt(null,f.observation,1)).toBeNull();});
 it.each(["storeId","businessDate","cameraName","cupEventId","imageSha256","evidenceOrigin"] as const)("rejects saved row with wrong %s",key=>{const f=fixture();const row={...f.row,[key]:key==="storeId"?2:"wrong"};expect(()=>nativeEvidenceReceipt(row as any,f.observation,1)).toThrow();});
 it("valid receipt never creates sales or physical cups",()=>{const f=fixture();expect(nativeEvidenceReceipt(f.row,f.observation,1)).toMatchObject({persisted:true,externalAiInvoked:false,physicalDeliveryCountCreated:false,countsAreSales:false,eventId:123});});
 it("preserves an existing manager decision",()=>{const f=fixture();f.row.analysisStatus="approved_by_manager";expect(nativeEvidenceReceipt(f.row,f.observation,1)?.analysisStatus).toBe("approved_by_manager");});
 it("invalid stored timestamp does not acknowledge",()=>{const f=fixture();f.row.receivedAt=new Date("bad");expect(()=>nativeEvidenceReceipt(f.row,f.observation,1)).toThrow();});
});

describe("native receipt preserves immutable route provenance",()=>{
 it.each(["verified_snapshot","official_administrative_snapshot:original","",null])("does not bless another source %s",source=>{const f=fixture();expect(()=>nativeEvidenceReceipt({...f.row,sourceDetail:source},f.observation,1)).toThrow("source_conflict");});
 it("rejects another route even before an image exists",()=>{const f=fixture();expect(()=>nativeEvidenceReceipt({...f.row,sourceDetail:"legacy",imageKey:null},f.observation,1)).toThrow("source_conflict");});
 it("rejects already analyzed evidence instead of claiming no external AI",()=>{const f=fixture();expect(()=>nativeEvidenceReceipt({...f.row,analysisStatus:"approved_by_ai",analysisAttempts:1},f.observation,1)).toThrow("source_conflict");});
 it("rejects evidence with a prior failed generative attempt",()=>{const f=fixture();expect(()=>nativeEvidenceReceipt({...f.row,analysisAttempts:1},f.observation,1)).toThrow("source_conflict");});
 it("uses the authenticated tenant timezone at the capture boundary",()=>{const f=fixture();expect(()=>validateNativeEvidence(f.observation,f.upload,"Asia/Tokyo")).toThrow("tenant_day_mismatch");});
 it("accepts another timezone only when its business day matches",()=>{const f=fixture();expect(validateNativeEvidence(f.observation,f.upload,"UTC")).toBeDefined();});
});
