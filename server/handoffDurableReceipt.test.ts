import { describe, it, expect } from "vitest";
import { deferredHandoffSource, isDeferredHandoffSource, persistedHandoffReceipt,
  isDeferredAnalysisDue, HANDOFF_RECEIPT_PROTOCOL } from "./handoffDurableReceipt";
import { parseHandoffCaptureMetadata, handoffCaptureMetadataJson } from "./handoffVisualPayload";

const metadata = parseHandoffCaptureMetadata({ camera: "handoff", cupZone: "handoff_zone",
  cupEventId: "fixture-capture-001", capturedAtUtc: "2026-10-18T22:10:00.123456+00:00", imageSha256: "a".repeat(64) });
const expected = { storeId: 1, businessDate: "2026-10-18", metadata };
function row() { return { id: 123, storeId: 1, businessDate: "2026-10-18", cameraName: "handoff",
  cupEventId: metadata.cupEventId, imageSha256: metadata.imageSha256, imageKey: "private/image.jpg",
  capturedAt: metadata.capturedAt, captureMetadataJson: handoffCaptureMetadataJson(metadata),
  receivedAt: new Date("2026-10-18T22:10:02Z"), evidenceOrigin: "verified_snapshot",
  analysisStatus: "pending_review", sourceDetail: deferredHandoffSource("original source") }; }
function due() { return { ...row(), zoneId: 1, zoneGeometryVersion: 1, zoneGeometryJson: "{}",
  analysisAttempts: 0, analysisLeaseUntil: null as Date | null, nextRetryAt: null as Date | null,
  lastAnalysisError: null as string | null, reviewedAt: null as Date | null }; }
const now = new Date("2026-10-18T23:00:00Z");

describe("durable handoff receipt", () => {
  it("preserves original provenance in a server envelope", () => {
    const s = deferredHandoffSource('{"existing":"proof"}');
    expect(JSON.parse(s).originalSourceDetail).toBe('{"existing":"proof"}');
    expect(isDeferredHandoffSource(s)).toBe(true);
  });
  it.each([undefined, "verified_snapshot", "{broken", "[]", "x".repeat(5000)])("excludes legacy or malformed source %s", s => {
    expect(isDeferredHandoffSource(s)).toBe(false);
  });
  it("acknowledges persistence while AI remains pending and preserves sub-millisecond capture time", () => {
    const r = persistedHandoffReceipt(row(), expected);
    expect(r).toMatchObject({ protocol: HANDOFF_RECEIPT_PROTOCOL, evidencePersisted: true,
      physicalCupCountCreated: false, eventId: 123, analysisStatus: "pending_review", capturedAt: metadata.capturedAtUtc });
  });
  it.each([
    { id: 0 }, { storeId: 2 }, { businessDate: "2026-10-17" }, { cameraName: "other" },
    { cupEventId: "different-capture" }, { imageSha256: "b".repeat(64) }, { imageKey: null },
    { captureMetadataJson: "{}" }, { evidenceOrigin: "recording_extracted_frame" }, { receivedAt: new Date("invalid") },
  ])("refuses an incomplete or mismatched persisted row %j", change => {
    expect(() => persistedHandoffReceipt({ ...row(), ...change }, expected)).toThrow();
  });
});

describe("durable analysis eligibility", () => {
  it("admits a fresh opted-in item", () => expect(isDeferredAnalysisDue(due(), now)).toBe(true));
  it("does not process legacy records", () => expect(isDeferredAnalysisDue({ ...due(), sourceDetail: "verified_snapshot" }, now)).toBe(false));
  it("preserves manager decisions", () => expect(isDeferredAnalysisDue({ ...due(), analysisStatus: "approved_by_manager" }, now)).toBe(false));
  it("preserves explicitly reviewed ambiguous rows", () => expect(isDeferredAnalysisDue({ ...due(), reviewedAt: now }, now)).toBe(false));
  it("does not rerun ambiguous AI decisions", () => expect(isDeferredAnalysisDue({ ...due(), analysisAttempts: 1 }, now)).toBe(false));
  it("does not steal active leases", () => expect(isDeferredAnalysisDue({ ...due(), analysisLeaseUntil: new Date(now.getTime()+10000) }, now)).toBe(false));
  it("recovers an interrupted expired lease", () => expect(isDeferredAnalysisDue({ ...due(), analysisAttempts: 1, analysisLeaseUntil: new Date(now.getTime()-1000) }, now)).toBe(true));
  it("honors delayed retry", () => expect(isDeferredAnalysisDue({ ...due(), nextRetryAt: new Date(now.getTime()+10000) }, now)).toBe(false));
  it("allows a due transient retry", () => expect(isDeferredAnalysisDue({ ...due(), analysisAttempts: 1, nextRetryAt: new Date(now.getTime()-1000), lastAnalysisError: "temporary" }, now)).toBe(true));
  it("stops after three attempts", () => expect(isDeferredAnalysisDue({ ...due(), analysisAttempts: 3, nextRetryAt: new Date(now.getTime()-1000) }, now)).toBe(false));
  it("does not retry held geometry mismatch", () => expect(isDeferredAnalysisDue({ ...due(), lastAnalysisError: "zone mismatch" }, now)).toBe(false));
  it("requires image and real configured geometry", () => {
    expect(isDeferredAnalysisDue({ ...due(), imageKey: null }, now)).toBe(false);
    expect(isDeferredAnalysisDue({ ...due(), zoneId: null }, now)).toBe(false);
  });
});
