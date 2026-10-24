import {and,eq,isNull,sql} from "drizzle-orm";
import {frigateHandoffVisualEvents} from "../drizzle/schema";
import {getDb,getHandoffVisualEventById} from "./db";
import {parseAutoCupSizes,sizeObservationEligible,type AutoCupSizeAssessment} from "../shared/autoCupSizes";
import {parseCupReviewNotes} from "../shared/cupDescriptions";
import {storageGetSignedUrl} from "./storage";
import {analyzeCupSizes} from "./autoCupSizeAnalysis";
import {isNativeLocalEvidenceSource} from "./nativeLocalEvidence";
function object(raw:string|null){if(!raw)return {};const x=JSON.parse(raw);if(!x||typeof x!=="object"||Array.isArray(x))throw Error("Stored analysis evidence is malformed");return x as Record<string,unknown>;}
export async function classifyHandoffCupSizes(input:{id:number;storeId:number}){
	 const db=await getDb();if(!db)throw Error("Database not available");
	 const row=await getHandoffVisualEventById(input);if(!row)throw Error("Handoff visual event was not found in this store");
	 if(isNativeLocalEvidenceSource(row.sourceDetail))return {eventId:row.id,status:"native_local_only"};
	 const annotation=parseCupReviewNotes(row.reviewNotes);if(annotation.malformed)throw Error("Stored descriptions malformed");
 if(annotation.annotation)return {eventId:row.id,status:"manual_preserved"};
 if(!sizeObservationEligible(row))return {eventId:row.id,status:"excluded_visual_state"};
 if(!row.imageKey)throw Error("Image storage pending");
 const previous=parseAutoCupSizes(row.analysisEvidenceJson);const now=Date.now();
 if(previous?.imageSha256===row.imageSha256){
  if(previous.status==="completed")return {eventId:row.id,status:"completed",assessment:previous};
  if(previous.status==="running"&&Date.parse(previous.leaseUntil||"")>now)return {eventId:row.id,status:"running"};
  if(previous.attempts>=3)return {eventId:row.id,status:"failed_attempt_limit"};
  if(previous.retryAfter&&Date.parse(previous.retryAfter)>now)return {eventId:row.id,status:"retry_wait"};
 }
 const base=object(row.analysisEvidenceJson);
 const lease:AutoCupSizeAssessment={version:1,status:"running",imageSha256:row.imageSha256,items:[],attempts:(previous?.attempts||0)+1,leaseUntil:new Date(now+120000).toISOString()};
 const claimed=JSON.stringify({...base,autoCupSizes:lease});
 const scope=(value:string|null)=>and(eq(frigateHandoffVisualEvents.id,input.id),eq(frigateHandoffVisualEvents.storeId,input.storeId),eq(frigateHandoffVisualEvents.imageSha256,row.imageSha256),value===null?isNull(frigateHandoffVisualEvents.analysisEvidenceJson):sql`BINARY ${frigateHandoffVisualEvents.analysisEvidenceJson} = BINARY ${value}`,row.reviewNotes===null?isNull(frigateHandoffVisualEvents.reviewNotes):sql`BINARY ${frigateHandoffVisualEvents.reviewNotes} = BINARY ${row.reviewNotes}`);
 const change=await db.update(frigateHandoffVisualEvents).set({analysisEvidenceJson:claimed}).where(scope(row.analysisEvidenceJson));
 if(change[0].affectedRows!==1)return {eventId:row.id,status:"concurrent_change"};
 let result:AutoCupSizeAssessment;
 try {const image=await storageGetSignedUrl(row.imageKey);const analyzed=await analyzeCupSizes(image,JSON.parse(row.zoneGeometryJson||"[]"));result={...lease,status:"completed",leaseUntil:undefined,items:analyzed.items,model:analyzed.model,completedAt:new Date().toISOString()};}
 catch {result={...lease,status:"failed",leaseUntil:undefined,retryAfter:new Date(Date.now()+lease.attempts*300000).toISOString(),error:"size_analysis_unavailable"};}
 const stored=JSON.stringify({...base,autoCupSizes:result});
 const write=await db.update(frigateHandoffVisualEvents).set({analysisEvidenceJson:stored}).where(scope(claimed));
 if(write[0].affectedRows!==1)return {eventId:row.id,status:"concurrent_change"};
 const after=await getHandoffVisualEventById(input);if(!after||after.analysisEvidenceJson!==stored)throw Error("Size analysis readback mismatch");
 return {eventId:row.id,status:result.status,assessment:result,physicalCountChanged:false,salesChanged:false};
}
