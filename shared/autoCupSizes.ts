import { CUP_SIZE_KEYS, isCupSize, parseCupReviewNotes, type CupSize, type CupDescriptionView } from "./cupDescriptions";
export const AUTO_CUP_SIZE_VERSION = 1;
export type AutoCupSizeItem = {slot:number;size:CupSize;confidence:"high"|"medium"|"low";basis:"printed_capacity"|"visual_estimate"|"unknown";reason:string};
export type AutoCupSizeAssessment = {version:1;status:"running"|"completed"|"failed";imageSha256:string;items:AutoCupSizeItem[];attempts:number;leaseUntil?:string;retryAfter?:string;completedAt?:string;model?:string;error?:string};
export function parseAutoCupSizes(raw?:string|null):AutoCupSizeAssessment|null {
 try {const x=JSON.parse(raw||"{}").autoCupSizes;if(!x||x.version!==1||!["running","completed","failed"].includes(x.status)||!Array.isArray(x.items)||!Number.isInteger(x.attempts)||x.attempts<1||!/^([a-f0-9]{64})$/.test(x.imageSha256))return null;
 if(x.status==="completed" && (x.items.length>8||x.items.some((i:any,n:number)=>i.slot!==n+1||!isCupSize(i.size)||!["high","medium","low"].includes(i.confidence)||!["printed_capacity","visual_estimate","unknown"].includes(i.basis)||typeof i.reason!=="string")))return null;return x;
 } catch{return null;}
}
export function normalizeAutoCupSizes(raw:unknown):AutoCupSizeItem[] {
 if(!Array.isArray(raw)||raw.length>8)throw Error("Invalid automatic size observations");
 return raw.map((entry,index)=>{
  if(!entry||typeof entry!=="object"||Array.isArray(entry))throw Error("Invalid size item");
  const x=entry as Record<string,unknown>;const confidence=x.confidence==="high"||x.confidence==="medium"?x.confidence:"low";
  const reason=typeof x.reason==="string"?x.reason.trim().slice(0,240):"";
  const known=isCupSize(x.size)&&x.size!=="unknown"&&reason.length>0&&confidence!=="low";
  const printed=known&&confidence==="high"&&x.basis==="printed_capacity";
  const estimate=known&&x.basis==="visual_estimate";
  return {slot:index+1,size:printed||estimate?x.size as CupSize:"unknown",confidence,basis:printed?"printed_capacity":estimate?"visual_estimate":"unknown",reason};
 });
}
export function sizeObservationEligible(row:{analysisStatus?:string;aiSuggestedStatus?:string|null}) {
 return row.analysisStatus==="approved_by_ai"||row.analysisStatus==="approved_by_manager"||(row.analysisStatus==="pending_review"&&row.aiSuggestedStatus==="approved_by_ai");
}
export function automaticDescriptionView(assessment:AutoCupSizeAssessment):CupDescriptionView[] {
 return assessment.items.map(i=>({slot:i.slot,size:i.size,source:i.size==="unknown"?"unknown":i.basis==="visual_estimate"?"ai_estimate":"ai_suggestion",note:i.reason.slice(0,160)}));
}
export function summarizeCameraSizes(rows:Array<{id:number;storeId:number;cameraName:string;cupEventId:string;imageSha256:string;analysisStatus:string;aiSuggestedStatus?:string|null;analysisEvidenceJson?:string|null;reviewNotes?:string|null}>) {
 const counts=Object.fromEntries(CUP_SIZE_KEYS.map(k=>[k,{manual:0,printed:0,estimated:0,unknown:0,total:0}])) as Record<CupSize,{manual:number;printed:number;estimated:number;unknown:number;total:number}>;
 const seen=new Set<string>();let includedImages=0,excludedImages=0,pendingImages=0,duplicateImages=0,malformedImages=0,recoveredImages=0;
 for(const row of rows){
  const identity=row.storeId+"/"+row.cameraName+"/"+row.imageSha256;
  if(seen.has(identity)){duplicateImages++;continue;}seen.add(identity);
  if(!sizeObservationEligible(row)){excludedImages++;continue;}
  const manual=parseCupReviewNotes(row.reviewNotes);if(manual.malformed){malformedImages++;continue;}
  const auto=parseAutoCupSizes(row.analysisEvidenceJson);
  const items=manual.annotation?.items??(auto?.status==="completed"&&auto.imageSha256===row.imageSha256?auto.items:null);
  if(!items){pendingImages++;continue;}includedImages++;
  if(row.cupEventId.startsWith("rec-"))recoveredImages++;
  for(const item of items){const c=counts[item.size];c.total++;if(manual.annotation)c.manual++;else if(item.size==="unknown")c.unknown++;else if((item as AutoCupSizeItem).basis==="printed_capacity")c.printed++;else c.estimated++;}
 }
 return {scope:"image_observations_not_unique_deliveries" as const,counts,receivedImages:rows.length,includedImages,excludedImages,pendingImages,duplicateImages,malformedImages,recoveredImages,physicalCupCount:null,usesManualSalesToFillCamera:false};
}
