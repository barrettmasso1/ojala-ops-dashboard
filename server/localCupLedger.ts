import { createHash } from "node:crypto";
import { z } from "zod";
import { getBusinessDate } from "../shared/businessDate";

export const LOCAL_LEDGER_PROTOCOL = "ojala_local_cup_ledger_v1";
export const LOCAL_RECEIPT_PROTOCOL = "ojala_local_cup_ledger_receipt_v1";
export const MAX_LOCAL_LEDGER_BYTES = 4 * 1024 * 1024;
export const DEFAULT_OJALA_DEVICE = "38395f07-90c9-4ab4-a47e-a8881a3498fb";
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const device = z.string().uuid();
const eventId = z.string().regex(/^[A-Za-z0-9_.-]{8,128}$/);
const iso = z.string().max(45).refine(s => /(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s)), "Timezone-bearing timestamp required");
const box = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().positive().max(1), z.number().positive().max(1)])
  .refine(v => v[0]+v[2]<=1.001 && v[1]+v[3]<=1.001, "Box outside frame");
const proof = z.object({
  imageSha256: sha, capturedAt: iso, sourceMetadataSha256: sha, sourceZoneSha256: sha,
  targetBox: box, cupScore: z.number().min(0.45).max(1), personDetections: z.number().int().min(1).max(100),
  gateVersion: z.string().max(100), inferenceLocation: z.literal("local_beelink"), generativeAiUsed: z.literal(false),
  originalSidecarSha256: sha.optional(),
  storedImageRelativePath: z.string().max(180).optional(), storedSidecarRelativePath: z.string().max(180).optional(),
}).strict();
const validatedSizeAssessmentSchema = z.object({
  size:z.enum(["chico","mediano","pint","litro"]),status:z.literal("classified"),
  reason:z.literal("matched_owner_labeled_local_references"),basis:z.literal("local_reference_estimate"),
  modelSha256:sha,classifierVersion:z.literal("ojala_reference_sizes_v1"),imageSha256:sha,
  referenceImageHashes:z.array(sha).length(2).refine(v=>new Set(v).size===2,"Distinct reference images required"),
  distance:z.number().min(0).max(.28),margin:z.number().min(.04).max(1),
  externalAiUsed:z.literal(false),notACertifiedVolume:z.literal(true),
}).strict();
const provisionalSizeAssessmentSchema = z.object({
  size:z.enum(["chico","mediano","pint","litro"]),status:z.literal("classified"),
  reason:z.literal("matched_owner_labeled_local_references"),basis:z.literal("local_reference_estimate"),
  modelSha256:sha,classifierVersion:z.literal("ojala_body_templates_v1"),imageSha256:sha,
  referenceImageHashes:z.array(sha).length(1),distance:z.number().min(0).max(.28),margin:z.number().min(.04).max(1),
  externalAiUsed:z.literal(false),notACertifiedVolume:z.literal(true),provisional:z.literal(true),generalizationValidated:z.literal(false),
  referenceImages:z.number().int().min(1).max(200),referenceScenes:z.number().int().min(1).max(200),
  validationLevel:z.enum(["calibration_examples_only","single_reference_only","near_reference_only"]),
  annotationSha256:sha,extractor:z.literal("bottom_body_hog_070"),
  referenceObservationId:sha,referenceSourceEventId:eventId,referenceBusinessDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  referenceOwnerLabel:z.enum(["chico","mediano","pint","litro"]),referenceAnnotationSha256:sha,
}).strict().superRefine((v,ctx)=>{
  if(v.referenceScenes>v.referenceImages)ctx.addIssue({code:z.ZodIssueCode.custom,message:"reference_scene_count"});
  if(v.referenceOwnerLabel!==v.size)ctx.addIssue({code:z.ZodIssueCode.custom,message:"reference_label_scope"});
  if(v.referenceAnnotationSha256!==v.annotationSha256)ctx.addIssue({code:z.ZodIssueCode.custom,message:"reference_annotation_scope"});
  if(v.validationLevel==="single_reference_only"&&(v.referenceImages!==1||v.referenceScenes!==1||v.distance>.12))ctx.addIssue({code:z.ZodIssueCode.custom,message:"single_reference_scope"});
  if(v.validationLevel==="near_reference_only"&&v.distance>.12)ctx.addIssue({code:z.ZodIssueCode.custom,message:"near_reference_radius"});
  if(v.validationLevel==="calibration_examples_only"&&v.referenceScenes<3)ctx.addIssue({code:z.ZodIssueCode.custom,message:"insufficient_calibration_scenes"});
});
const localSizeAssessmentSchema=z.union([validatedSizeAssessmentSchema,provisionalSizeAssessmentSchema]);
const ownerSizeReviewSchema = z.object({
  protocol:z.literal("ojala_owner_size_review_v1"),annotationSha256:sha,manifestSha256:sha,sampleId:sha,
  sourceEventId:eventId,imageSha256:sha,label:z.enum(["chico","mediano","pint","litro","not_cup"]),
  labelSource:z.literal("owner_confirmed_capacity"),confirmedAt:iso,targetBox:box,
  binding:z.object({deviceId:device,cameraName:z.literal("handoff"),zoneSha256:sha,detectorModelSha256:sha}).strict(),
}).strict();
export const localObservationSchema = z.object({
  schema: z.literal("ojala_local_cup_observation_v1"), observationId: sha, deviceId: device,
  cameraName: z.literal("handoff"), sourceEventId: eventId, businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startedAt: iso, endedAt: iso.nullable(), detectorModelSha256: sha, detectorScore: z.number().min(0).max(1),
  targetBox: box, enteredHandoffZone: z.boolean(), sourceFalsePositive: z.boolean(),
  verification: z.enum(["detector_track_only","same_frame_local_cv","detector_rejected"]),
  size: z.enum(["chico","mediano","pint","litro","unknown"]), sizeBasis: z.enum(["local_model_has_no_size_classes","local_reference_estimate","owner_confirmed_reference"]),
  ownerSizeReview:ownerSizeReviewSchema.optional(),
  sizeAssessment:localSizeAssessmentSchema.optional(),
  physicalDeliveryConfirmed: z.literal(false), salesCreated: z.literal(false), sameFrameEvidence: proof.nullable(),
  sourceDetectorModelHash: z.string().max(100).nullable().optional(), sourceDetectorType: z.string().max(50).nullable().optional(),
}).strict();
export type LocalObservation = z.infer<typeof localObservationSchema>;
const record = z.object({revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), payloadJson:z.string().min(2).max(16000), payloadSha256:sha}).strict();
const docSchema = z.object({schemaVersion:z.literal(1), protocol:z.literal(LOCAL_LEDGER_PROTOCOL), deviceId:device,
  cameraName:z.literal("handoff"), businessDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/), records:z.array(record).max(2000)}).strict();
export const localLedgerInputSchema=z.object({sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),documentJson:z.string().min(2).max(MAX_LOCAL_LEDGER_BYTES),documentSha256:sha});
export type ParsedLocalLedger=ReturnType<typeof parseLocalLedger>;
export const hashText=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");

export function parseLocalLedger(input:z.infer<typeof localLedgerInputSchema>, timeZone:string, now=new Date()) {
  localLedgerInputSchema.parse(input);
  if(Buffer.byteLength(input.documentJson,"utf8")>MAX_LOCAL_LEDGER_BYTES || hashText(input.documentJson)!==input.documentSha256)throw Error("ledger_checksum_or_size");
  const doc=docSchema.parse(JSON.parse(input.documentJson));
  if(doc.businessDate>getBusinessDate(now,timeZone))throw Error("future_business_date");
  const seen=new Set<string>();
  const observations=doc.records.map(r=>{
    if(hashText(r.payloadJson)!==r.payloadSha256)throw Error("observation_checksum");
    const o=localObservationSchema.parse(JSON.parse(r.payloadJson));
    if(o.deviceId!==doc.deviceId || o.businessDate!==doc.businessDate || o.cameraName!==doc.cameraName)throw Error("observation_scope");
    if(o.observationId!==hashText(o.deviceId+"/handoff/"+o.sourceEventId))throw Error("observation_identity");
    if(seen.has(o.observationId))throw Error("duplicate_source_identity");seen.add(o.observationId);
    if(getBusinessDate(new Date(o.startedAt),timeZone)!==doc.businessDate || Date.parse(o.startedAt)>now.getTime()+120000)throw Error("observation_date");
    if(o.endedAt && (Date.parse(o.endedAt)<Date.parse(o.startedAt)||Date.parse(o.endedAt)>now.getTime()+120000))throw Error("observation_end");
    if(o.sourceFalsePositive !== (o.verification==="detector_rejected"))throw Error("rejected_source_scope");
    if(o.verification==="same_frame_local_cv" && !o.sameFrameEvidence)throw Error("verification_without_evidence");
    if(o.ownerSizeReview) {
      const review=o.ownerSizeReview;
      if(!o.sameFrameEvidence || o.sizeAssessment || o.sizeBasis!=="owner_confirmed_reference"
        || o.size!==(review.label==="not_cup"?"unknown":review.label)
        || review.sourceEventId!==o.sourceEventId || review.imageSha256!==o.sameFrameEvidence.imageSha256
        || JSON.stringify(review.targetBox)!==JSON.stringify(o.sameFrameEvidence.targetBox)
        || review.binding.deviceId!==o.deviceId || review.binding.cameraName!==o.cameraName
        || review.binding.detectorModelSha256!==o.detectorModelSha256 || review.binding.zoneSha256!==o.sameFrameEvidence.sourceZoneSha256
        || Date.parse(review.confirmedAt)>now.getTime()+120000)throw Error("owner_size_review_scope_mismatch");
    } else if(o.size!=="unknown") {
      if(o.verification!=="same_frame_local_cv" || !o.sameFrameEvidence || !o.sizeAssessment
          || o.sizeBasis!=="local_reference_estimate" || o.sizeAssessment.size!==o.size
          || o.sizeAssessment.imageSha256!==o.sameFrameEvidence.imageSha256)throw Error("size_calibration_provenance_required");
    } else if(o.sizeAssessment || o.sizeBasis!=="local_model_has_no_size_classes")throw Error("unknown_size_provenance_conflict");
    if(o.sameFrameEvidence){
      const at=Date.parse(o.sameFrameEvidence.capturedAt), start=Date.parse(o.startedAt);
      if(getBusinessDate(new Date(at),timeZone)!==doc.businessDate || at<start-2000 || at>start+600000 || (o.endedAt && at>Date.parse(o.endedAt)+2000))throw Error("local_evidence_time");
    }
    return o;
  });
  return {input,document:doc,observations};
}

export function ledgerStorageKey(storeId:number,deviceId:string,day:string) {
  if(!Number.isSafeInteger(storeId)||storeId<=0)throw Error("store_required");device.parse(deviceId);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error("invalid_day");
  return `local-cup-ledger/v1/store-${storeId}/${deviceId}/${day}.json`;
}
export type StoredLocalLedger={schemaVersion:1;storeId:number;sequence:number;documentJson:string;documentSha256:string;receivedAt:string};
export function storedLedger(parsed:ParsedLocalLedger,storeId:number,receivedAt=new Date()):StoredLocalLedger {
  ledgerStorageKey(storeId,parsed.document.deviceId,parsed.document.businessDate);
  return {schemaVersion:1,storeId,sequence:parsed.input.sequence,documentJson:parsed.input.documentJson,documentSha256:parsed.input.documentSha256,receivedAt:receivedAt.toISOString()};
}
export function checkStored(value:unknown,storeId:number,deviceId:string,day:string,timeZone:string) {
  const s=z.object({schemaVersion:z.literal(1),storeId:z.number().int().positive(),sequence:z.number().int().positive(),documentJson:z.string(),documentSha256:sha,receivedAt:iso}).strict().parse(value);
  if(s.storeId!==storeId)throw Error("stored_store_mismatch");
  const p=parseLocalLedger(s,timeZone);
  if(p.document.deviceId!==deviceId || p.document.businessDate!==day)throw Error("stored_scope_mismatch");
  return {stored:s,parsed:p};
}
export function compareRevision(previous:StoredLocalLedger|null,next:ParsedLocalLedger) {
  if(!previous)return "create" as const;
  if(next.input.sequence<previous.sequence)throw Error("stale_ledger_revision");
  if(next.input.sequence===previous.sequence){
    if(next.input.documentSha256!==previous.documentSha256)throw Error("ledger_revision_conflict");
    return "already_persisted" as const;
  }
  const oldDoc=docSchema.parse(JSON.parse(previous.documentJson));
  const byId=new Map(next.observations.map(o=>[o.observationId,o]));
  const nextRevisions=new Map(next.document.records.map(r=>[JSON.parse(r.payloadJson).observationId,r]));
  for(const r of oldDoc.records){
    const old=localObservationSchema.parse(JSON.parse(r.payloadJson));const value=byId.get(old.observationId);const nextR=nextRevisions.get(old.observationId);
    if(!value||!nextR)throw Error("previous_observation_omitted");
    if(value.startedAt!==old.startedAt || value.sourceEventId!==old.sourceEventId || value.detectorModelSha256!==old.detectorModelSha256)throw Error("historical_identity_changed");
    if(nextR.revision<r.revision || (nextR.revision===r.revision&&nextR.payloadSha256!==r.payloadSha256))throw Error("observation_revision_conflict");
    if(old.sameFrameEvidence && (!value.sameFrameEvidence || value.sameFrameEvidence.imageSha256!==old.sameFrameEvidence.imageSha256))throw Error("historical_image_changed");
    if(old.endedAt && !value.endedAt)throw Error("closed_track_reopened");
  }
  return "update" as const;
}
export function localLedgerReceipt(s:StoredLocalLedger,p:ParsedLocalLedger) {
  if(s.documentSha256!==p.input.documentSha256 || s.sequence!==p.input.sequence)throw Error("readback_mismatch");
  return {protocol:LOCAL_RECEIPT_PROTOCOL,persisted:true,storeId:s.storeId,deviceId:p.document.deviceId,
    businessDate:p.document.businessDate,cameraName:"handoff",sequence:s.sequence,documentSha256:s.documentSha256,
    receivedAt:s.receivedAt,observationsPersisted:p.observations.length,externalAiInvoked:false,
    physicalDeliveryCountCreated:false,countsAreSales:false};
}
export function possibleLocalRepeats(rows:LocalObservation[]) {
  const links:Record<string,string[]>={};const ordered=[...rows].sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt)||a.observationId.localeCompare(b.observationId));
  const iou=(a:number[],b:number[])=>{const area=Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]));return area?area/(a[2]*a[3]+b[2]*b[3]-area):0;};
  for(let index=0;index<ordered.length;index++){
    const current=ordered[index];
    for(const earlier of ordered.slice(0,index)){
      if(!earlier.endedAt||earlier.deviceId!==current.deviceId||earlier.businessDate!==current.businessDate||earlier.cameraName!==current.cameraName)continue;
      const gap=Date.parse(current.startedAt)-Date.parse(earlier.endedAt);
      if(gap>=0&&gap<=15000&&iou(earlier.targetBox,current.targetBox)>=0.75)(links[current.observationId]??=[]).push(earlier.observationId);
    }
  }
  return links;
}
export function summarizeLocalLedger(p:ParsedLocalLedger,receivedAt:string) {
  const rows=p.observations;const rawVerified=rows.filter(o=>o.verification==="same_frame_local_cv");const ownerExcluded=rawVerified.filter(o=>o.ownerSizeReview?.label==="not_cup");const verified=rawVerified.filter(o=>o.ownerSizeReview?.label!=="not_cup");const repeats=possibleLocalRepeats(rows);
  const sizeBreakdown={chico:0,mediano:0,pint:0,litro:0,unknown:0};
  for(const observation of verified)sizeBreakdown[observation.size]++;
  return {protocol:LOCAL_LEDGER_PROTOCOL,businessDate:p.document.businessDate,deviceId:p.document.deviceId,receivedAt,
    scope:"detector_tracks_not_certified_unique_deliveries",detectedTracks:rows.length,locallyVerifiedTargets:verified.length,
    withoutSameFrameEvidence:rows.filter(o=>o.verification==="detector_track_only").length,rejectedByDetector:rows.filter(o=>o.verification==="detector_rejected").length,
    potentialRepeatedTracks:Object.keys(repeats).length,repeatLinks:repeats,repeatFlagsAreNotAutomaticMerges:true,
    sizeBreakdown,localSizeClassifiedTargets:verified.filter(o=>o.size!=="unknown").length,
    rawLocallyVerifiedTargets:rawVerified.length,ownerExcludedTargets:ownerExcluded.length,
    ownerConfirmedSizeTargets:verified.filter(o=>o.ownerSizeReview&&o.size!=="unknown").length,
    automaticallyEstimatedSizeTargets:verified.filter(o=>o.sizeBasis==="local_reference_estimate"&&o.size!=="unknown").length,
    provisionalSizeTargets:verified.filter(o=>o.sizeAssessment?.classifierVersion==="ojala_body_templates_v1").length,
    uniquePhysicalDeliveries:null,externalAiRequired:false,manualOrSalesCountsUsed:false,
    records:rows.map(o=>({id:o.observationId,sourceEventId:o.sourceEventId,startedAt:o.startedAt,endedAt:o.endedAt,
      verification:o.verification,score:o.detectorScore,size:o.size,sizeBasis:o.sizeBasis,sizeModelSha256:o.sizeAssessment?.modelSha256??null,sizeProvisional:o.sizeAssessment?.classifierVersion==="ojala_body_templates_v1",sizeValidationLevel:o.sizeAssessment?.classifierVersion==="ojala_body_templates_v1"?o.sizeAssessment.validationLevel:null,enteredHandoffZone:o.enteredHandoffZone,
      ownerExcluded:o.ownerSizeReview?.label==="not_cup",ownerConfirmedSize:Boolean(o.ownerSizeReview&&o.ownerSizeReview.label!=="not_cup"),
      possibleRepeatOf:repeats[o.observationId]??[],imageSha256:o.sameFrameEvidence?.imageSha256??null}))};
}
