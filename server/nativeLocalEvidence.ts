import {z} from "zod";
import {getBusinessDate} from "../shared/businessDate";
import {hashText,type LocalObservation} from "./localCupLedger";
import {parseHandoffCaptureMetadata} from "./handoffVisualPayload";
import {isHandoffCaptureZoneCoherent,parseStoredHandoffZoneGeometry} from "./handoffZoneGeometry";
import {validateVerifiedZoneNormalization} from "./handoffZoneNormalization";
import type {PersistedHandoffRow} from "./handoffDurableReceipt";

export const NATIVE_EVIDENCE_PROTOCOL="ojala_local_cup_evidence_v1";
export const NATIVE_EVIDENCE_RECEIPT="ojala_local_cup_evidence_receipt_v1";
export const NATIVE_LOCAL_EVIDENCE_SOURCE_PREFIX="native_local_cv_only_v1:";
export const NATIVE_AUTOMATIC_VALIDATION_PROTOCOL="ojala_local_automatic_validation_v1";
export const NATIVE_LOCAL_PROOF_MODEL="ojala_local_cv_proof_v1";
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const eventId=z.string().regex(/^[A-Za-z0-9_.-]{8,128}$/);
const iso=z.string().max(45).refine(s=>/(?:Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s)),"Timezone-bearing timestamp required");
const box=z.tuple([z.number().min(0).max(1),z.number().min(0).max(1),z.number().positive().max(1),z.number().positive().max(1)]);

export const nativeEvidenceIdentity=z.object({deviceId:z.string().uuid(),businessDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),observationId:sha}).strict();
export const nativeEvidenceUpload=nativeEvidenceIdentity.extend({
 imageDataUrl:z.string().min(32).max(12*1024*1024).startsWith("data:image/jpeg;base64,"),
 normalizationProof:z.object({adapter:z.literal("beelink_object_v3"),sourceMetadataJson:z.string().min(2).max(65536),sourceMetadataSha256:sha,sourceZoneCanonicalJson:z.string().min(2).max(8192)}).strict(),
 capture:z.object({schema_version:z.literal(3),camera:z.literal("handoff"),cup_zone:z.literal("handoff_zone"),cup_event_id:eventId,captured_at_utc:z.string().min(20).max(45),image_sha256:sha,
  zone_geometry:z.array(z.object({x:z.number(),y:z.number()})).min(3).max(16),zone_config_sha256:sha,image_dimensions:z.object({width:z.number().int(),height:z.number().int()})}).strict(),
}).strict();

const nativeAutomaticValidationProofSchema=z.object({
 protocol:z.literal(NATIVE_AUTOMATIC_VALIDATION_PROTOCOL),status:z.literal("verified"),method:z.literal("persisted_local_cv_proof"),
 analysisStatus:z.literal("approved_by_ai"),analysisModel:z.literal(NATIVE_LOCAL_PROOF_MODEL),sourceDetail:z.string().startsWith(NATIVE_LOCAL_EVIDENCE_SOURCE_PREFIX).max(160),
 deviceId:z.string().uuid(),businessDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),observationId:sha,sourceEventId:eventId,
 imageSha256:sha,capturedAt:iso,verification:z.literal("same_frame_local_cv"),detectorModelSha256:sha,sourceMetadataSha256:sha,sourceZoneSha256:sha,
 originalSidecarSha256:sha,targetBox:box,detectorScore:z.number().min(0).max(1),cupScore:z.number().min(0.45).max(1),personDetections:z.number().int().min(1).max(100),
 gateVersion:z.string().min(1).max(100),inferenceLocation:z.literal("local_beelink"),generativeAiUsed:z.literal(false),externalAiInvoked:z.literal(false),
 physicalDeliveryCountCreated:z.literal(false),countsAreSales:z.literal(false),evidenceOrigin:z.literal("verified_snapshot"),imageKey:z.string().min(1).max(512),
 sourceDetectorModelHash:z.string().max(100).nullable(),sourceDetectorType:z.string().max(50).nullable(),validatedAt:iso,
}).strict();
export type NativeAutomaticValidationProof=z.infer<typeof nativeAutomaticValidationProofSchema>;
export function parseNativeAutomaticValidationProof(value:unknown){return nativeAutomaticValidationProofSchema.parse(value);}

export function requireEvidenceObservation(o:LocalObservation|null,input:z.infer<typeof nativeEvidenceIdentity>,upload=false){
 if(!o||o.deviceId!==input.deviceId||o.businessDate!==input.businessDate||o.observationId!==input.observationId||o.cameraName!=="handoff"||!o.sameFrameEvidence)throw Error("persisted_local_evidence_required");
 if(upload&&(o.verification!=="same_frame_local_cv"||o.sourceFalsePositive||o.ownerSizeReview?.label==="not_cup"))throw Error("local_observation_not_eligible");
 return o;
}
export function validateNativeEvidence(o:LocalObservation,input:z.infer<typeof nativeEvidenceUpload>,timeZone:string){
 requireEvidenceObservation(o,input,true);const proof=o.sameFrameEvidence!;
 const metadata=parseHandoffCaptureMetadata({camera:input.capture.camera,cupZone:input.capture.cup_zone,cupEventId:input.capture.cup_event_id,capturedAtUtc:input.capture.captured_at_utc,imageSha256:input.capture.image_sha256,schemaVersion:3,zoneGeometry:input.capture.zone_geometry,zoneConfigSha256:input.capture.zone_config_sha256,imageDimensions:input.capture.image_dimensions});
 if(metadata.cupEventId!==o.sourceEventId||metadata.imageSha256!==proof.imageSha256||metadata.capturedAtUtc!==proof.capturedAt
  ||!proof.originalSidecarSha256||input.normalizationProof.sourceMetadataSha256!==proof.originalSidecarSha256
  ||hashText(input.normalizationProof.sourceMetadataJson)!==proof.originalSidecarSha256
  ||hashText(input.normalizationProof.sourceZoneCanonicalJson)!==proof.sourceZoneSha256)throw Error("native_evidence_binding_mismatch");
 if(getBusinessDate(metadata.capturedAt,timeZone)!==o.businessDate)throw Error("native_evidence_tenant_day_mismatch");
 metadata.normalizationAudit=validateVerifiedZoneNormalization(input.normalizationProof,metadata);
 return metadata;
}
export function localEvidenceSource(o:LocalObservation){return `${NATIVE_LOCAL_EVIDENCE_SOURCE_PREFIX}${o.observationId}`;}
/** Native photos are stored proof only; no generative visual path may process them. */
export function isNativeLocalEvidenceSource(value:string|null|undefined){return typeof value==="string"&&value.startsWith(NATIVE_LOCAL_EVIDENCE_SOURCE_PREFIX);}

function parseStoredCapture(row:PersistedHandoffRow){
 try{return JSON.parse(row.captureMetadataJson??"{}");}catch{throw Error("stored_metadata_unreadable");}
}
/** SQL TIMESTAMP(0) rounds by default or truncates in TIME_TRUNCATE_FRACTIONAL mode; exact time remains in original metadata. */
export function nativeCaptureTimeMatchesStorage(stored:Date,original:Date){
 const a=stored instanceof Date?stored.getTime():NaN,b=original instanceof Date?original.getTime():NaN;
 return Number.isFinite(a)&&Number.isFinite(b)&&(a===b||a===Math.floor(b/1000)*1000||a===Math.round(b/1000)*1000);
}
function requireNativeRowIdentity(row:PersistedHandoffRow,o:LocalObservation,timeZone:string){
 const proof=o.sameFrameEvidence;
 if(!proof||!row.imageKey||row.sourceDetail!==localEvidenceSource(o)||row.storeId<=0||row.businessDate!==o.businessDate||row.cameraName!==o.cameraName||row.cupEventId!==o.sourceEventId||row.imageSha256!==proof.imageSha256||row.evidenceOrigin!=="verified_snapshot"||!(row.receivedAt instanceof Date)||!Number.isFinite(row.receivedAt.getTime()))throw Error("native_evidence_identity_mismatch");
 const saved=parseStoredCapture(row);
 const metadata=parseHandoffCaptureMetadata({camera:saved.camera,cupZone:saved.cup_zone,cupEventId:saved.cup_event_id,capturedAtUtc:saved.captured_at_utc,imageSha256:saved.image_sha256,schemaVersion:saved.schema_version,zoneGeometry:saved.zone_geometry,zoneConfigSha256:saved.zone_config_sha256,imageDimensions:saved.image_dimensions});
 if(metadata.cupEventId!==o.sourceEventId||metadata.imageSha256!==proof.imageSha256||metadata.capturedAtUtc!==proof.capturedAt||getBusinessDate(metadata.capturedAt,timeZone)!==o.businessDate||metadata.schemaVersion!==3||!nativeCaptureTimeMatchesStorage(row.capturedAt,metadata.capturedAt))throw Error("native_evidence_capture_mismatch");
 if(!row.zoneId||!row.zoneGeometryVersion||!row.zoneGeometryJson||!metadata.capturedZoneGeometry||!metadata.capturedZoneConfigSha256||!isHandoffCaptureZoneCoherent({capturedGeometry:metadata.capturedZoneGeometry,capturedConfigSha256:metadata.capturedZoneConfigSha256,serverGeometry:parseStoredHandoffZoneGeometry(row.zoneGeometryJson)}))throw Error("native_evidence_zone_mismatch");
 const audit=saved.normalization_audit;
 if(!audit||audit.sourceMetadataSha256!==proof.originalSidecarSha256||audit.sourceZoneConfigSha256!==proof.sourceZoneSha256||hashText(audit.sourceZoneCanonicalJson)!==proof.sourceZoneSha256)throw Error("native_evidence_normalization_audit_missing");
 return {saved,metadata,proof};
}

/** Build proof solely from the authenticated ledger observation and reread database row. */
export function buildNativeAutomaticValidationProof(o:LocalObservation,row:PersistedHandoffRow,timeZone:string,validatedAt=new Date()):NativeAutomaticValidationProof{
 requireEvidenceObservation(o,{deviceId:o.deviceId,businessDate:o.businessDate,observationId:o.observationId},true);
 const identity=requireNativeRowIdentity(row,o,timeZone);const p=identity.proof;
 const value={protocol:NATIVE_AUTOMATIC_VALIDATION_PROTOCOL,status:"verified",method:"persisted_local_cv_proof",analysisStatus:"approved_by_ai",analysisModel:NATIVE_LOCAL_PROOF_MODEL,sourceDetail:localEvidenceSource(o),deviceId:o.deviceId,businessDate:o.businessDate,observationId:o.observationId,sourceEventId:o.sourceEventId,imageSha256:p.imageSha256,capturedAt:p.capturedAt,verification:o.verification,detectorModelSha256:o.detectorModelSha256,sourceMetadataSha256:p.originalSidecarSha256,sourceZoneSha256:p.sourceZoneSha256,originalSidecarSha256:p.originalSidecarSha256,targetBox:p.targetBox,detectorScore:o.detectorScore,cupScore:p.cupScore,personDetections:p.personDetections,gateVersion:p.gateVersion,inferenceLocation:p.inferenceLocation,generativeAiUsed:false,externalAiInvoked:false,physicalDeliveryCountCreated:false,countsAreSales:false,evidenceOrigin:"verified_snapshot",imageKey:row.imageKey!,sourceDetectorModelHash:o.sourceDetectorModelHash??null,sourceDetectorType:o.sourceDetectorType??null,validatedAt:validatedAt.toISOString()};
 return parseNativeAutomaticValidationProof(value);
}

function publicAutomaticValidation(proof:NativeAutomaticValidationProof){return {protocol:proof.protocol,status:proof.status,requiredHumanAction:false as const,observationId:proof.observationId,imageSha256:proof.imageSha256,externalAiInvoked:false as const,method:proof.method,analysisModel:proof.analysisModel,validatedAt:proof.validatedAt};}
export function nativeAutomaticValidationView(row:PersistedHandoffRow){
 if(!isNativeLocalEvidenceSource(row.sourceDetail)||row.analysisAttempts!==1||row.analysisModel!==NATIVE_LOCAL_PROOF_MODEL||!row.analysisEvidenceJson)return null;
 try{return publicAutomaticValidation(parseNativeAutomaticValidationProof(JSON.parse(row.analysisEvidenceJson)));}catch{return null;}
}
function rowProof(row:PersistedHandoffRow,o:LocalObservation){
 if(!row.analysisEvidenceJson)return null;
 let parsed:unknown;try{parsed=JSON.parse(row.analysisEvidenceJson);}catch{throw Error("native_evidence_proof_unreadable");}
 const proof=parseNativeAutomaticValidationProof(parsed);
 if(proof.sourceDetail!==localEvidenceSource(o)||proof.deviceId!==o.deviceId||proof.businessDate!==o.businessDate||proof.observationId!==o.observationId||proof.sourceEventId!==o.sourceEventId||proof.imageSha256!==row.imageSha256||proof.analysisModel!==NATIVE_LOCAL_PROOF_MODEL||row.analysisModel!==NATIVE_LOCAL_PROOF_MODEL||row.analysisAttempts!==1||proof.analysisStatus!=="approved_by_ai")throw Error("native_evidence_proof_binding_mismatch");
 return proof;
}

export function requireNativeEvidenceSource(row:(PersistedHandoffRow&{analysisAttempts?:number})|null,o:LocalObservation){
 if(row && row.sourceDetail!==localEvidenceSource(o))throw Error("native_evidence_source_conflict");
 if(row && (row.analysisAttempts??0)>1)throw Error("native_evidence_source_conflict");
 if(row && row.analysisStatus==="approved_by_ai" && (row.analysisModel!==NATIVE_LOCAL_PROOF_MODEL || row.analysisAttempts!==1 || !row.analysisEvidenceJson))throw Error("native_evidence_source_conflict");
}
export function nativeEvidenceReceipt(row:(PersistedHandoffRow&{analysisAttempts?:number})|null,o:LocalObservation,storeId:number){
 requireNativeEvidenceSource(row,o);
 if(!row||!row.imageKey)return null;
 const proof=o.sameFrameEvidence;if(!proof)throw Error("native_evidence_missing");
 let capture:Record<string,unknown>;try{capture=JSON.parse(row.captureMetadataJson??"{}");}catch{throw Error("stored_metadata_unreadable");}
 if(!Number.isSafeInteger(row.id)||row.id<=0||row.storeId!==storeId||row.businessDate!==o.businessDate||row.cameraName!==o.cameraName||row.cupEventId!==o.sourceEventId||row.imageSha256!==proof.imageSha256||capture.captured_at_utc!==proof.capturedAt||row.evidenceOrigin!=="verified_snapshot"||!(row.receivedAt instanceof Date)||!Number.isFinite(row.receivedAt.getTime()))throw Error("native_evidence_receipt_mismatch");
 const attempts=row.analysisAttempts??0;
 if(row.analysisStatus==="discarded"||(attempts===1&&row.analysisStatus!=="approved_by_ai"&&row.analysisStatus!=="approved_by_manager"&&row.analysisStatus!=="discarded_by_manager"))throw Error("native_evidence_source_conflict");
 const auto=attempts===1?rowProof(row,o):null;
 if(row.analysisStatus==="approved_by_ai"&&!auto)throw Error("native_evidence_proof_required");
 const reviewedAt=row.reviewedAt??null;const reviewedByUserId=row.reviewedByUserId??null;
 if((reviewedAt===null)!==(reviewedByUserId===null))throw Error("native_evidence_review_binding_mismatch");
 return {protocol:NATIVE_EVIDENCE_RECEIPT,persisted:true as const,storeId,deviceId:o.deviceId,businessDate:o.businessDate,cameraName:o.cameraName,observationId:o.observationId,sourceEventId:o.sourceEventId,imageSha256:proof.imageSha256,capturedAt:proof.capturedAt,eventId:row.id,receivedAt:row.receivedAt.toISOString(),evidenceOrigin:"verified_snapshot" as const,externalAiInvoked:false as const,physicalDeliveryCountCreated:false as const,countsAreSales:false,analysisStatus:row.analysisStatus,automaticValidation:auto?publicAutomaticValidation(auto):null,unreviewed:reviewedAt===null,reviewedAt:reviewedAt?.toISOString()??null,reviewedByUserId};
}
