import type { HandoffCaptureMetadata } from "./handoffVisualPayload";

/** Server-owned envelope. Original provenance is retained, not replaced. */
export const HANDOFF_RECEIPT_PROTOCOL = "handoff_persisted_receipt_v1";
export const DEFERRED_SOURCE_PREFIX = '{"ingestionProtocol":"handoff_persisted_receipt_v1",';
export const MAX_DEFERRED_ANALYSIS_ATTEMPTS = 3;

export function deferredHandoffSource(originalSourceDetail: string): string {
  return JSON.stringify({ ingestionProtocol: HANDOFF_RECEIPT_PROTOCOL, originalSourceDetail });
}

export function isDeferredHandoffSource(value: string | null | undefined): boolean {
  if (!value || value.length > 4000 || !value.startsWith(DEFERRED_SOURCE_PREFIX)) return false;
  try {
    const parsed = JSON.parse(value);
    return parsed.ingestionProtocol === HANDOFF_RECEIPT_PROTOCOL && typeof parsed.originalSourceDetail === "string";
  } catch { return false; }
}

export type PersistedHandoffRow = {
  id: number; storeId: number; businessDate: string; cameraName: string;
  cupEventId: string; imageSha256: string | null; imageKey: string | null;
  capturedAt: Date; receivedAt: Date; captureMetadataJson?: string | null;
  evidenceOrigin: string; analysisStatus: string; sourceDetail?: string | null;
  analysisModel?: string | null; analysisEvidenceJson?: string | null; analysisAttempts?: number;
  reviewedAt?: Date | null; reviewedByUserId?: number | null; reviewNotes?: string | null;
  zoneId?: number | null; zoneGeometryVersion?: number | null; zoneGeometryJson?: string | null;
};

/** A positive receipt is built from a freshly read persisted row, never input alone. */
export function persistedHandoffReceipt(row: PersistedHandoffRow, expected: {
  storeId: number; businessDate: string; metadata: HandoffCaptureMetadata;
}) {
  const capture = expected.metadata;
  let savedCaptureTime: unknown;
  try { savedCaptureTime = JSON.parse(row.captureMetadataJson ?? "{}").captured_at_utc; }
  catch { throw new Error("Stored capture metadata is unreadable"); }
  if (!Number.isSafeInteger(row.id) || row.id <= 0 || row.storeId !== expected.storeId
      || row.businessDate !== expected.businessDate || row.cameraName !== capture.camera
      || row.cupEventId !== capture.cupEventId || row.imageSha256 !== capture.imageSha256
      || savedCaptureTime !== capture.capturedAtUtc || row.evidenceOrigin !== "verified_snapshot"
      || !row.imageKey || !(row.receivedAt instanceof Date) || !Number.isFinite(row.receivedAt.getTime())) {
    throw new Error("Persisted handoff record does not match this capture");
  }
  return {
    protocol: HANDOFF_RECEIPT_PROTOCOL,
    storeId: row.storeId, cameraName: row.cameraName, businessDate: row.businessDate,
    eventId: row.id, cupEventId: row.cupEventId, capturedAt: capture.capturedAtUtc,
    imageSha256: row.imageSha256, receivedAt: row.receivedAt.toISOString(),
    evidenceOrigin: row.evidenceOrigin,
    evidencePersisted: true as const,
    physicalCupCountCreated: false as const,
    analysisStatus: row.analysisStatus,
    deferredAnalysisRequested: isDeferredHandoffSource(row.sourceDetail),
  };
}

/** Pending human ambiguity is not an automatic retry; legacy imports are excluded. */
export function isDeferredAnalysisDue(event: {
  sourceDetail?: string | null; analysisStatus: string; imageKey: string | null;
  zoneId: number | null; zoneGeometryVersion: number | null; zoneGeometryJson: string | null;
  analysisAttempts: number; analysisLeaseUntil: Date | null; nextRetryAt: Date | null;
  lastAnalysisError?: string | null; reviewedAt?: Date | null;
}, now: Date): boolean {
  if (event.reviewedAt || !isDeferredHandoffSource(event.sourceDetail) || event.analysisStatus !== "pending_review"
      || !event.imageKey || !event.zoneId || !event.zoneGeometryVersion || !event.zoneGeometryJson
      || event.analysisAttempts >= MAX_DEFERRED_ANALYSIS_ATTEMPTS) return false;
  const time = now.getTime();
  if (event.analysisLeaseUntil && event.analysisLeaseUntil.getTime() > time) return false;
  if (event.nextRetryAt && event.nextRetryAt.getTime() > time) return false;
  if (event.lastAnalysisError && !event.nextRetryAt && !event.analysisLeaseUntil) return false;
  return event.analysisAttempts === 0
    || Boolean(event.nextRetryAt && event.nextRetryAt.getTime() <= time)
    || Boolean(event.analysisLeaseUntil && event.analysisLeaseUntil.getTime() <= time);
}
