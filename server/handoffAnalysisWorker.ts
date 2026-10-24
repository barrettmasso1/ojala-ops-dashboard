import { getHandoffVisualEventById, listDueDeferredHandoffVisualEvents,
  getActiveStoreById, queueHandoffVisualForZoneMismatch } from "./db";
import { analyzePersistedHandoffVisual } from "./handoffPersistedAnalysis";
import { parseHandoffCaptureMetadata } from "./handoffVisualPayload";
import { isHandoffCaptureZoneCoherent, parseStoredHandoffZoneGeometry } from "./handoffZoneGeometry";
import { isDeferredAnalysisDue, MAX_DEFERRED_ANALYSIS_ATTEMPTS } from "./handoffDurableReceipt";
import { isNativeLocalEvidenceSource } from "./nativeLocalEvidence";

let running = false;
let timer: ReturnType<typeof setInterval> | undefined;
let lastWarningAt = 0;

/** Bounded, restart-safe queue: the database, not this timer, owns pending work. */
export async function runHandoffAnalysisCycle() {
  if (running) return { status: "already_running" as const };
  running = true;
  const result = { status: "checked" as const, selected: 0, processed: 0, held: 0, errors: 0 };
  try {
    const rows = await listDueDeferredHandoffVisualEvents(5);
    result.selected = rows.length;
    for (const candidate of rows) {
      try {
        // Re-read scoped identity and store status after selection; do not use a stale list row.
        const event = await getHandoffVisualEventById({ id: candidate.id, storeId: candidate.storeId });
        if (event && isNativeLocalEvidenceSource(event.sourceDetail)) { result.held++; continue; }
        if (!event || !isDeferredAnalysisDue(event, new Date())) continue;
        if (!(await getActiveStoreById(event.storeId))) { result.held++; continue; }
        let coherent = false;
        try {
          const saved = JSON.parse(event.captureMetadataJson);
          const metadata = parseHandoffCaptureMetadata({
            camera: saved.camera, cupZone: saved.cup_zone, cupEventId: saved.cup_event_id,
            capturedAtUtc: saved.captured_at_utc, imageSha256: saved.image_sha256,
            schemaVersion: saved.schema_version, zoneGeometry: saved.zone_geometry,
            zoneConfigSha256: saved.zone_config_sha256, imageDimensions: saved.image_dimensions,
          });
          coherent = metadata.cupEventId === event.cupEventId && metadata.imageSha256 === event.imageSha256
            && event.cameraName === metadata.camera && (metadata.schemaVersion !== 3 || isHandoffCaptureZoneCoherent({
              capturedGeometry: metadata.capturedZoneGeometry!, capturedConfigSha256: metadata.capturedZoneConfigSha256!,
              serverGeometry: parseStoredHandoffZoneGeometry(event.zoneGeometryJson!),
            }));
        } catch { coherent = false; }
        if (!coherent) {
          await queueHandoffVisualForZoneMismatch({ id: event.id, storeId: event.storeId });
          result.held++; continue;
        }
        await analyzePersistedHandoffVisual(event, { storeId: event.storeId, cameraName: event.cameraName }, MAX_DEFERRED_ANALYSIS_ATTEMPTS);
        result.processed++;
      } catch {
        // Do not log signed URLs, captured images, credentials, or raw provider errors.
        // A claimed job stays recoverable through its expiring database lease.
        result.errors++;
      }
    }
    return result;
  } finally { running = false; }
}

export function startHandoffAnalysisWorker() {
  if (timer || process.env.HANDOFF_DEFERRED_ANALYSIS_WORKER === "disabled") return;
  const tick = () => { void runHandoffAnalysisCycle().catch(() => {
    if (Date.now() - lastWarningAt >= 60_000) {
      lastWarningAt = Date.now();
      console.warn("[Handoff worker] Queue unavailable; persisted evidence remains pending.");
    }
  }); };
  timer = setInterval(tick, 5000);
  timer.unref();
  tick();
}

export function stopHandoffAnalysisWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
