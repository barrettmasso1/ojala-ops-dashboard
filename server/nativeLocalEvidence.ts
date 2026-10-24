import {z} from "zod";
import {hashText,type LocalObservation} from "./localCupLedger";
import {parseHandoffCaptureMetadata} from "./handoffVisualPayload";
import {validateVerifiedZoneNormalization} from "./handoffZoneNormalization";
import type {PersistedHandoffRow} from "./handoffDurableReceipt";
export const NATIVE_EVIDENCE_PROTOCOL="ojala_local_cup_evidence_v1";
export const NATIVE_EVIDENCE_RECEIPT="ojala_local_cup_evidence_receipt_v1";
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const nativeEvidenceIdentity=z.object({deviceId:z.string().uuid(),businessDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),observationId:sha}).strict();
export const nativeEvidenceUpload=nativeEvidenceIdentity.extend({
 imageDataUrl:z.string().min(32).max(12*1024*1024).startsWith("data:image/jpeg;base64,"),
 normalizationProof:z.object({adapter:z.literal("beelink_object_v3"),sourceMetadataJson:z.string().min(2).max(65536),sourceMetadataSha256:sha,sourceZoneCanonicalJson:z.string().min(2).max(8192)}).strict(),
 capture:z.object({schema_version:z.literal(3),camera:z.literal("handoff"),cup_zone:z.literal("handoff_zone"),cup_event_id:z.string().regex(/^[A-Za-z0-9_.-]{8,128}$/),captured_at_utc:z.string().min(20).max(45),image_sha256:sha,
  zone_geometry:z.array(z.object({x:z.number(),y:z.number()})).min(3).max(16),zone_config_sha256:sha,image_dimensions:z.object({width:z.number().int(),height:z.number().int()})}).strict(),
}).strict();
export function requireEvidenceObservation(o:LocalObservation|null,input:z.infer<typeof nativeEvidenceIdentity>,upload=false){
 if(!o||o.deviceId!==input.deviceId||o.businessDate!==input.businessDate||o.observationId!==input.observationId||o.cameraName!=="handoff"||!o.sameFrameEvidence)throw Error("persisted_local_evidence_required");
 if(upload&&(o.verification!=="same_frame_local_cv"||o.sourceFalsePositive||o.ownerSizeReview?.label==="not_cup"))throw Error("local_observation_not_eligible");
 return o;
}
export function validateNativeEvidence(o:LocalObservation,input:z.infer<typeof nativeEvidenceUpload>){
 requireEvidenceObservation(o,input,true);const proof=o.sameFrameEvidence!;
 const metadata=parseHandoffCaptureMetadata({camera:input.capture.camera,cupZone:input.capture.cup_zone,cupEventId:input.capture.cup_event_id,capturedAtUtc:input.capture.captured_at_utc,imageSha256:input.capture.image_sha256,schemaVersion:3,zoneGeometry:input.capture.zone_geometry,zoneConfigSha256:input.capture.zone_config_sha256,imageDimensions:input.capture.image_dimensions});
 if(metadata.cupEventId!==o.sourceEventId||metadata.imageSha256!==proof.imageSha256||metadata.capturedAtUtc!==proof.capturedAt
  ||!proof.originalSidecarSha256||input.normalizationProof.sourceMetadataSha256!==proof.originalSidecarSha256
  ||hashText(input.normalizationProof.sourceMetadataJson)!==proof.originalSidecarSha256
  ||hashText(input.normalizationProof.sourceZoneCanonicalJson)!==proof.sourceZoneSha256)throw Error("native_evidence_binding_mismatch");
 metadata.normalizationAudit=validateVerifiedZoneNormalization(input.normalizationProof,metadata);
 return metadata;
}
export function localEvidenceSource(o:LocalObservation){return `native_local_cv_only_v1:${o.observationId}`;}
export function nativeEvidenceReceipt(row:PersistedHandoffRow|null,o:LocalObservation,storeId:number){
 if(!row||!row.imageKey)return null;
 const proof=o.sameFrameEvidence;if(!proof)throw Error("native_evidence_missing");
 let capture:Record<string,unknown>;try{capture=JSON.parse(row.captureMetadataJson??"{}");}catch{throw Error("stored_metadata_unreadable");}
 if(!Number.isSafeInteger(row.id)||row.id<=0||row.storeId!==storeId||row.businessDate!==o.businessDate||row.cameraName!==o.cameraName||row.cupEventId!==o.sourceEventId||row.imageSha256!==proof.imageSha256||capture.captured_at_utc!==proof.capturedAt||row.evidenceOrigin!=="verified_snapshot"||!(row.receivedAt instanceof Date)||!Number.isFinite(row.receivedAt.getTime()))throw Error("native_evidence_receipt_mismatch");
 return {protocol:NATIVE_EVIDENCE_RECEIPT,persisted:true as const,storeId,deviceId:o.deviceId,businessDate:o.businessDate,cameraName:o.cameraName,observationId:o.observationId,sourceEventId:o.sourceEventId,imageSha256:proof.imageSha256,capturedAt:proof.capturedAt,eventId:row.id,receivedAt:row.receivedAt.toISOString(),evidenceOrigin:"verified_snapshot" as const,externalAiInvoked:false as const,physicalDeliveryCountCreated:false as const,countsAreSales:false as const,analysisStatus:row.analysisStatus};
}
