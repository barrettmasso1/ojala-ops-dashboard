import { describe, expect, it } from "vitest";
import { hashText, ledgerStorageKey, LOCAL_LEDGER_PROTOCOL, type LocalObservation } from "./localCupLedger";
import type { BlobRead, LocalLedgerBlobStore } from "./localCupLedgerStorage";
import {
  COUNTER_PICKUP_PROTOCOL,
  counterPickupStorageKey,
  parseCounterPickupDocument,
  readCounterPickups,
  saveCounterPickups,
  type CounterPickupDocument,
  type CounterPickupPhoto,
  type CounterPickupPhotoReader,
} from "./counterPickups";

const DEVICE = "38395f07-90c9-4ab4-a47e-a8881a3498fb";
const DAY = "2026-10-24";
const STORE = 1;
const ZONE = "b".repeat(64);
const MODEL = "a".repeat(64);
const IMAGE = "e".repeat(64);
const SOURCE = "1792868400.000-fixture";
const OBSERVATION = hashText(`${DEVICE}/handoff/${SOURCE}`);
const SEED = "2026-10-24T19:00:00.000Z";
const NOW = new Date("2026-10-25T01:00:00.000Z");

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

const policy = {
  schema: "ojala_optical_pickup_policy_v1" as const,
  cameraName: "handoff" as const,
  deviceId: DEVICE,
  timezone: "America/Mazatlan",
  detectorModelSha256: MODEL,
  sourceZoneSha256: ZONE,
  referenceImageSha256: "c".repeat(64),
  geometryCalibration: "provisional_visual_orientation" as const,
  commercialAccuracyValidated: false as const,
  width: 2304 as const,
  height: 1296 as const,
  recordingWidth: 1280 as const,
  recordingHeight: 720 as const,
  minimumFeatures: 8 as const,
  minimumRetainedFraction: 0.2 as const,
  maxSampleGapSeconds: 0.45 as const,
  minimumStableSeconds: 0.4 as const,
  minimumOutsideSamples: 2 as const,
  minimumMotionHeights: 0.5 as const,
  maximumDurationSeconds: 24 as const,
  maximumForwardBackwardError: 1 as const,
  maximumMotionResidual: 3 as const,
  zones: {
    handoff: [[0.4, 0.55], [0.65, 0.55], [0.65, 0.75], [0.4, 0.75]] as Array<[number, number]>,
    customer: [[0.4, 0.4], [0.65, 0.4], [0.65, 0.55], [0.4, 0.55]] as Array<[number, number]>,
  },
};
const policyJson = canonical(policy);
const policySha = hashText(policyJson);

function timestamp(offsetSeconds: number) {
  return new Date(Date.parse(SEED) + offsetSeconds * 1_000).toISOString();
}

function nativeObservation(overrides: Partial<LocalObservation> = {}): LocalObservation {
  return {
    schema: "ojala_local_cup_observation_v1",
    observationId: OBSERVATION,
    deviceId: DEVICE,
    cameraName: "handoff",
    sourceEventId: SOURCE,
    businessDate: DAY,
    startedAt: SEED,
    endedAt: null,
    detectorModelSha256: MODEL,
    detectorScore: 0.8,
    targetBox: [0.47, 0.55, 0.05, 0.08],
    enteredHandoffZone: true,
    sourceFalsePositive: false,
    verification: "same_frame_local_cv",
    size: "unknown",
    sizeBasis: "local_model_has_no_size_classes",
    physicalDeliveryConfirmed: false,
    salesCreated: false,
    sameFrameEvidence: {
      imageSha256: IMAGE,
      capturedAt: SEED,
      sourceMetadataSha256: "d".repeat(64),
      originalSidecarSha256: "d".repeat(64),
      sourceZoneSha256: ZONE,
      targetBox: [0.47, 0.55, 0.05, 0.08],
      cupScore: 0.8,
      personDetections: 1,
      gateVersion: "fixture",
      inferenceLocation: "local_beelink",
      generativeAiUsed: false,
    },
    sourceDetectorModelHash: null,
    sourceDetectorType: "openvino",
    ...overrides,
  };
}

function record(overrides: Partial<Record<string, unknown>> = {}) {
  const sourceEventId = String(overrides.sourceEventId ?? SOURCE);
  const observationId = String(overrides.observationId ?? OBSERVATION);
  const imageSha256 = String(overrides.imageSha256 ?? IMAGE);
  const seedCapturedAt = String(overrides.seedCapturedAt ?? SEED);
  const samples = overrides.samples ?? [0, 0.2, 0.4, 0.6, 0.8, 1, 1.2].map((offset, index) => ({
    at: timestamp(offset),
    box: [0.47, [0.55, 0.55, 0.55, 0.53, 0.49, 0.45, 0.44][index]!, 0.05, 0.08],
    features: 20,
    retainedFraction: 0.8,
    forwardBackwardError: 0.1,
    motionResidual: 0.1,
    frameSha256: String(index + 1).repeat(64),
  }));
  return {
    eventId: String(overrides.eventId ?? hashText(`${DEVICE}/optical-pickup/${sourceEventId}/${policySha}`)),
    sourceEventId,
    observationId,
    businessDate: String(overrides.businessDate ?? DAY),
    imageSha256,
    seedCapturedAt,
    samples,
    segments: overrides.segments ?? [{ path: "/media/frigate/recordings/2026-10-24/19/handoff/00.00.mp4", start: Date.parse(SEED) / 1_000, end: Date.parse(SEED) / 1_000 + 120, sha256: "f".repeat(64) }],
    stopReason: String(overrides.stopReason ?? "tracking_lost"),
    source: "recorded_video_optical_flow" as const,
    algorithm: "sparse_lk_forward_backward_v1" as const,
  };
}

function input(records = [record()], sequence = 1) {
  const document: CounterPickupDocument = {
    protocol: COUNTER_PICKUP_PROTOCOL,
    deviceId: DEVICE,
    cameraName: "handoff",
    businessDate: DAY,
    policyJson,
    policySha256: policySha,
    records: records as CounterPickupDocument["records"],
    scope: "recording_optical_pickup_estimates_not_sales",
    coverage: "candidate_recording_windows_not_continuous_day",
    requiresPerImageApproval: false,
    generativeAiUsed: false,
    coversWholeBusinessDay: false,
    physicalUniqueCountCertified: false,
  };
  const documentJson = canonical(document);
  return { sequence, documentJson, documentSha256: hashText(documentJson) };
}

class Store implements LocalLedgerBlobStore {
  readonly values = new Map<string, BlobRead>();
  readonly calls: Array<{ operation: "read" | "put"; key: string; etag?: string | null }> = [];
  async read(key: string) {
    this.calls.push({ operation: "read", key });
    return this.values.get(key) ?? null;
  }
  async compareAndPut(key: string, text: string, expectedEtag: string | null) {
    this.calls.push({ operation: "put", key, etag: expectedEtag });
    const previous = this.values.get(key);
    if (expectedEtag === null && previous) throw new (await import("./localCupLedgerStorage")).LedgerConflict("exists");
    if (expectedEtag !== null && previous?.etag !== expectedEtag) throw new (await import("./localCupLedgerStorage")).LedgerConflict("changed");
    this.values.set(key, { text, etag: `"v-${this.calls.length}"` });
  }
}

function installNativeLedger(store: Store, observation: LocalObservation) {
  const payloadJson = JSON.stringify(observation);
  const documentJson = JSON.stringify({
    schemaVersion: 1,
    protocol: LOCAL_LEDGER_PROTOCOL,
    deviceId: DEVICE,
    cameraName: "handoff",
    businessDate: DAY,
    records: [{ revision: 1, payloadJson, payloadSha256: hashText(payloadJson) }],
  });
  const stored = JSON.stringify({ schemaVersion: 1, storeId: STORE, sequence: 1, documentJson, documentSha256: hashText(documentJson), receivedAt: "2026-10-24T19:01:00.000Z" });
  store.values.set(ledgerStorageKey(STORE, DEVICE, DAY), { text: stored, etag: "\"native\"" });
}

function photo(overrides: Partial<CounterPickupPhoto> = {}): CounterPickupPhoto {
  return {
    storeId: STORE,
    businessDate: DAY,
    cameraName: "handoff",
    cupEventId: SOURCE,
    imageSha256: IMAGE,
    imageKey: "frigate-handoff-verified/store-1/fixture.jpg",
    captureMetadataJson: JSON.stringify({ captured_at_utc: SEED }),
    sourceDetail: `native_local_cv_only_v1:${OBSERVATION}`,
    evidenceOrigin: "verified_snapshot",
    analysisStatus: "approved_by_ai",
    reviewedAt: null,
    reviewedByUserId: null,
    ...overrides,
  };
}

describe("counter-to-customer optical pickup contract", () => {
  it("derives one provisional pickup from all validated samples and keeps unknown size", async () => {
    const store = new Store();
    installNativeLedger(store, nativeObservation());
    const parsed = await parseCounterPickupDocument(input(), STORE, "America/Mazatlan", store, async () => photo(), NOW);
    expect(parsed.estimatedPickups).toBe(1);
    expect(parsed.sizeBreakdown).toEqual({ chico: 0, mediano: 0, pint: 0, litro: 0, unknown: 1 });
    expect(parsed.records[0]).toMatchObject({ effectiveStatus: "pickup_estimate", contributes: true, effectiveSize: "unknown" });
  });

  it("accepts compact, key-sorted canonical JSON emitted by Python when an integral threshold is serialized as 1.0", async () => {
    const store = new Store();
    installNativeLedger(store, nativeObservation());
    const pythonPolicyJson = policyJson.replace('"maximumForwardBackwardError":1', '"maximumForwardBackwardError":1.0');
    const document = JSON.parse(input().documentJson) as CounterPickupDocument;
    document.policyJson = pythonPolicyJson;
    document.policySha256 = hashText(pythonPolicyJson);
    document.records[0]!.eventId = hashText(`${DEVICE}/optical-pickup/${SOURCE}/${document.policySha256}`);
    const documentJson = canonical(document);
    await expect(parseCounterPickupDocument({ sequence: 1, documentJson, documentSha256: hashText(documentJson) }, STORE, "America/Mazatlan", store, async () => photo(), NOW)).resolves.toMatchObject({ estimatedPickups: 1 });
  });

  it.each([
    ["outside recording segment", () => input([record({ segments: [{ path: "/media/frigate/recordings/2026-10-24/19/handoff/00.00.mp4", start: Date.parse(SEED) / 1_000 + 30, end: Date.parse(SEED) / 1_000 + 60, sha256: "f".repeat(64) }] })])],
    ["path traversal", () => input([record({ segments: [{ path: "/media/frigate/recordings/2026-10-24/19/handoff/../../secret.mp4", start: Date.parse(SEED) / 1_000, end: Date.parse(SEED) / 1_000 + 60, sha256: "f".repeat(64) }] })])],
    ["low quality later sample", () => input([record({ samples: (record().samples as Array<Record<string, unknown>>).map((sample, index) => index === 6 ? { ...sample, features: 7 } : sample) })])],
  ])("rejects all invalid sample/segment evidence: %s", async (_label, build) => {
    const store = new Store();
    installNativeLedger(store, nativeObservation());
    await expect(parseCounterPickupDocument(build(), STORE, "America/Mazatlan", store, async () => photo(), NOW)).rejects.toThrow();
  });

  it("validates a trailing sample after an otherwise accepted crossing before computing a pickup", async () => {
    const store = new Store();
    installNativeLedger(store, nativeObservation());
    const originalSamples = record().samples as Array<Record<string, unknown>>;
    const trailing = { ...originalSamples.at(-1)!, at: timestamp(1.4), features: 7, frameSha256: "9".repeat(64) };
    await expect(parseCounterPickupDocument(input([record({ samples: [...originalSamples, trailing] })]), STORE, "America/Mazatlan", store, async () => photo(), NOW)).rejects.toThrow();
  });

  it("rejects a submit whose new record lacks active native proof, without a write", async () => {
    const store = new Store();
    installNativeLedger(store, nativeObservation({ sourceFalsePositive: true, verification: "detector_rejected", sameFrameEvidence: null }));
    await expect(saveCounterPickups(store, input(), STORE, "America/Mazatlan", async () => photo(), NOW)).rejects.toThrow("counter_pickup_native_evidence_invalid");
    expect(store.calls.filter(call => call.operation === "put" && call.key.startsWith("counter-pickups/"))).toHaveLength(0);
  });

  it("keeps a persisted estimate readable but excluded after native rejection, then accepts a corrected revision", async () => {
    const store = new Store();
    let observation = nativeObservation();
    installNativeLedger(store, observation);
    const reader: CounterPickupPhotoReader = async () => photo();
    await expect(saveCounterPickups(store, input(), STORE, "America/Mazatlan", reader, NOW)).resolves.toMatchObject({ disposition: "create" });
    observation = nativeObservation({ sourceFalsePositive: true, verification: "detector_rejected", sameFrameEvidence: null });
    installNativeLedger(store, observation);
    const held = await readCounterPickups(store, STORE, DEVICE, DAY, "America/Mazatlan", reader, NOW);
    expect(held).toMatchObject({ estimatedPickups: 0, records: [expect.objectContaining({ effectiveStatus: "source_rejected", contributes: false })] });
    await expect(saveCounterPickups(store, input([record()], 2), STORE, "America/Mazatlan", reader, NOW)).rejects.toThrow("counter_pickup_native_evidence_invalid");
    observation = nativeObservation();
    installNativeLedger(store, observation);
    await expect(saveCounterPickups(store, input([record()], 2), STORE, "America/Mazatlan", reader, NOW)).resolves.toMatchObject({ disposition: "update", receipt: { sequence: 2 } });
  });

  it("preserves a manager rejection as an effective exclusion without relabeling the photo", async () => {
    const store = new Store();
    installNativeLedger(store, nativeObservation());
    const reader: CounterPickupPhotoReader = async () => photo({ analysisStatus: "discarded_by_manager", reviewedAt: new Date("2026-10-24T20:00:00Z"), reviewedByUserId: 42 });
    await expect(parseCounterPickupDocument(input(), STORE, "America/Mazatlan", store, reader, NOW)).resolves.toMatchObject({ estimatedPickups: 0, records: [expect.objectContaining({ effectiveStatus: "manager_rejected", contributes: false })] });
  });

  it("fails closed on cross-store photo evidence and never accepts caller totals or a duplicate identity", async () => {
    const store = new Store();
    installNativeLedger(store, nativeObservation());
    await expect(parseCounterPickupDocument(input(), STORE, "America/Mazatlan", store, async () => photo({ storeId: 2 }), NOW)).rejects.toThrow("pickup_persisted_photo_missing_or_mismatch");
    const duplicate = record({ sourceEventId: SOURCE, observationId: OBSERVATION, imageSha256: IMAGE });
    await expect(parseCounterPickupDocument(input([record(), duplicate]), STORE, "America/Mazatlan", store, async () => photo(), NOW)).rejects.toThrow("pickup_duplicate_identity");
    expect(input() as Record<string, unknown>).not.toHaveProperty("estimatedPickups");
  });

  it("uses create-only then strong revision readback without creating sales, counts, images, or review actions", async () => {
    const store = new Store();
    installNativeLedger(store, nativeObservation());
    const result = await saveCounterPickups(store, input(), STORE, "America/Mazatlan", async () => photo(), NOW);
    expect(result.receipt).toMatchObject({ persisted: true, partial: true, countsAreSales: false, physicalUniqueCountCertified: false, externalAiInvoked: false, requiredHumanAction: false });
    expect(store.calls.filter(call => call.operation === "put")).toEqual([expect.objectContaining({ key: counterPickupStorageKey(STORE, DEVICE, DAY), etag: null })]);
  });
});
