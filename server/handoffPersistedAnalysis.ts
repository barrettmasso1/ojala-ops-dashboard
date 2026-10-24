import { claimHandoffVisualAnalysis, finalizeHandoffVisualAnalysis, deferHandoffVisualAnalysis,
  getHandoffVisualEventById } from "./db";
import { storageGetSignedUrl } from "./storage";
import { parseStoredHandoffZoneGeometry } from "./handoffZoneGeometry";
import { analyzeHandoffVisualImage, getHandoffVisualRetryDelayMs } from "./handoffVisualAnalysis";
import { applyEvidenceOriginPolicy } from "./handoffEvidenceOrigin";
import { isNativeLocalEvidenceSource } from "./nativeLocalEvidence";

export type PersistedAnalysisEvent = NonNullable<Awaited<ReturnType<typeof getHandoffVisualEventById>>>;

/** Analysis uses the existing atomic database lease; it never creates a cup count. */
export async function analyzePersistedHandoffVisual(event: PersistedAnalysisEvent, scope: { storeId: number; cameraName: string }, maxAttempts?: number) {
  if (isNativeLocalEvidenceSource(event.sourceDetail)) {
    return { eventId: event.id, status: event.analysisStatus, disposition: "native_local_only" as const, retryable: false };
  }
  const analysisLeaseToken = await claimHandoffVisualAnalysis({ id: event.id, storeId: scope.storeId, ...(maxAttempts ? { maxAttempts } : {}) });
  if (!analysisLeaseToken) {
    return {
      eventId: event.id,
      status: event.analysisStatus,
      disposition: "queued_or_replayed" as const,
      retryable: Boolean(event.nextRetryAt),
    };
  }

  try {
    const imageUrl = await storageGetSignedUrl(event.imageKey!);
    const geometry = parseStoredHandoffZoneGeometry(event.zoneGeometryJson!);
    const analysis = await analyzeHandoffVisualImage({
      imageUrl,
      cameraName: scope.cameraName,
      handoffZonePolygon: geometry.points,
      handoffZoneGeometryVersion: event.zoneGeometryVersion!,
    });
    const originPolicy = applyEvidenceOriginPolicy({ origin: event.evidenceOrigin, analysis });
    const completed = await finalizeHandoffVisualAnalysis({
      id: event.id,
      storeId: scope.storeId,
      analysisLeaseToken,
      analysis: originPolicy.analysis,
      aiSuggestedStatus: originPolicy.aiSuggestedStatus,
    });
    return { eventId: completed.id, status: completed.analysisStatus, disposition: "analyzed" as const, retryable: false };
  } catch {
    const deferred = await deferHandoffVisualAnalysis({
      id: event.id,
      storeId: scope.storeId,
      analysisLeaseToken,
      nextRetryAt: new Date(Date.now() + getHandoffVisualRetryDelayMs(event.analysisAttempts + 1)),
    });
    return {
      eventId: deferred.id,
      status: deferred.analysisStatus,
      disposition: deferred.analysisStatus === "pending_review" ? "queued_for_retry" as const : "already_reviewed" as const,
      retryable: deferred.analysisStatus === "pending_review",
    };
  }
}
