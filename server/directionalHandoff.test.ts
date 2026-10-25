import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DIRECTIONAL_HANDOFF_PROTOCOL,
  directionalHandoffStorageKey,
  hashText,
  parseDirectionalHandoffDocument,
  saveDirectionalHandoffs,
  type DirectionalCounterDocument,
} from "./directionalHandoff";
import { LedgerConflict, type BlobRead, type LocalLedgerBlobStore } from "./localCupLedgerStorage";

const DEVICE = "38395f07-90c9-4ab4-a47e-a8881a3498fb";
const DAY = "2026-10-24";
const MODEL = "a".repeat(64);
const ZONE = "b".repeat(64);
const IMAGE = "d".repeat(64);
const TIME_ZONE = "America/Mazatlan";
const BASE = Date.parse("2026-10-24T20:00:00.000Z");

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

class FakeStore implements LocalLedgerBlobStore {
  objects = new Map<string, { text: string; etag: string }>();
  async read(key: string): Promise<BlobRead | null> {
    return this.objects.get(key) ?? null;
  }
  async compareAndPut(key: string, text: string, expectedEtag: string | null): Promise<void> {
    const current = this.objects.get(key);
    if (expectedEtag === null) {
      if (current) throw new LedgerConflict("exists");
    } else if (!current || current.etag !== expectedEtag) {
      throw new LedgerConflict("changed");
    }
    this.objects.set(key, { text, etag: `"${hashText(text).slice(0, 32)}"` });
  }
}

function policy() {
  return {
    schema: "ojala_directional_policy_v1",
    storeId: 1,
    deviceId: DEVICE,
    cameraName: "handoff",
    timezone: TIME_ZONE,
    detectorModelSha256: MODEL,
    sourceZoneSha256: ZONE,
    referenceImageSha256: "c".repeat(64),
    geometryCalibration: "provisional_visual_orientation",
    commercialAccuracyValidated: false,
    minimumSamplesPerZone: 2,
    maxSampleGapSeconds: 1.5,
    minimumScore: 0.45,
    width: 2304,
    height: 1296,
    zones: {
      origin: [[0.3, 0.7], [0.7, 0.7], [0.7, 0.9], [0.3, 0.9]],
      handoff: [[0.3, 0.45], [0.7, 0.45], [0.7, 0.65], [0.3, 0.65]],
      destination: [[0.3, 0.1], [0.7, 0.1], [0.7, 0.4], [0.3, 0.4]],
    },
  } as const;
}

function sample(sourceEventId: string, atOffset: number, zone: "origin" | "handoff" | "destination") {
  const y = { origin: 0.75, handoff: 0.5, destination: 0.2 }[zone];
  const metadata = {
    schema: "ojala_directional_sample_v1",
    deviceId: DEVICE,
    cameraName: "handoff",
    sourceEventId,
    at: new Date(BASE + atOffset).toISOString(),
    box: [0.47, y, 0.06, 0.05] as [number, number, number, number],
    score: 0.8,
    falsePositive: false,
  };
  const metadataJson = canonical(metadata);
  return { metadataJson, metadataSha256: hashText(metadataJson) };
}

function localObservation(sourceEventId: string, size: "unknown" | "mediano" = "unknown") {
  const observationId = hashText(`${DEVICE}/handoff/${sourceEventId}`);
  const capturedAt = new Date(BASE + 900).toISOString();
  const payload = {
    schema: "ojala_local_cup_observation_v1",
    observationId,
    deviceId: DEVICE,
    cameraName: "handoff",
    sourceEventId,
    businessDate: DAY,
    startedAt: new Date(BASE).toISOString(),
    endedAt: new Date(BASE + 1_000).toISOString(),
    detectorModelSha256: MODEL,
    detectorScore: 0.8,
    targetBox: [0.47, 0.5, 0.06, 0.05] as [number, number, number, number],
    enteredHandoffZone: true,
    sourceFalsePositive: false,
    verification: "same_frame_local_cv",
    size,
    sizeBasis: size === "unknown" ? "local_model_has_no_size_classes" : "local_reference_estimate",
    physicalDeliveryConfirmed: false,
    salesCreated: false,
    sameFrameEvidence: {
      imageSha256: IMAGE,
      capturedAt,
      sourceMetadataSha256: "e".repeat(64),
      sourceZoneSha256: ZONE,
      targetBox: [0.47, 0.5, 0.06, 0.05] as [number, number, number, number],
      cupScore: 0.8,
      personDetections: 1,
      gateVersion: "fixture",
      inferenceLocation: "local_beelink",
      generativeAiUsed: false,
    },
  };
  const payloadJson = JSON.stringify(payload);
  const document = {
    schemaVersion: 1,
    protocol: "ojala_local_cup_ledger_v1",
    deviceId: DEVICE,
    cameraName: "handoff",
    businessDate: DAY,
    records: [{ revision: 1, payloadJson, payloadSha256: hashText(payloadJson) }],
  };
  const documentJson = JSON.stringify(document);
  return { documentJson, documentSha256: hashText(documentJson), observationId, capturedAt };
}

function directionalDocument(sourceEventId = "test-object-0001", recordOverrides: Record<string, unknown> = {}): DirectionalCounterDocument {
  const currentPolicy = policy();
  const policyJson = canonical(currentPolicy);
  const policySha256 = hashText(policyJson);
  const samples = [
    sample(sourceEventId, 0, "origin"),
    sample(sourceEventId, 200, "origin"),
    sample(sourceEventId, 400, "handoff"),
    sample(sourceEventId, 600, "handoff"),
    sample(sourceEventId, 800, "destination"),
    sample(sourceEventId, 1_000, "destination"),
  ];
  const eventId = hashText(`${DEVICE}/handoff/${sourceEventId}/${policySha256}`);
  return {
    protocol: DIRECTIONAL_HANDOFF_PROTOCOL,
    deviceId: DEVICE,
    cameraName: "handoff",
    businessDate: DAY,
    policyJson,
    policySha256,
    windows: [{ from: new Date(BASE).toISOString(), until: new Date(BASE + 1_000).toISOString(), frames: 6, droppedFrames: 0 }],
    records: [{
      eventId,
      sourceEventId,
      businessDate: DAY,
      completedAt: new Date(BASE + 1_000).toISOString(),
      status: "estimated",
      size: "unknown",
      samples,
      localEvidence: null,
      possibleDuplicateOf: null,
      ...recordOverrides,
    }],
    scope: "directional_handoff_estimates_not_sales",
    requiresPerImageApproval: false,
    generativeAiUsed: false,
    commercialAccuracyValidated: false,
    coversWholeBusinessDay: false,
    physicalUniqueCountCertified: false,
  };
}

function input(document: DirectionalCounterDocument, sequence = 1) {
  const documentJson = JSON.stringify(document);
  return { sequence, documentJson, documentSha256: hashText(documentJson) };
}

function installNativeLedger(store: FakeStore, sourceEventId: string, size: "unknown" | "mediano" = "unknown") {
  const observation = localObservation(sourceEventId, size);
  const key = `local-cup-ledger/v1/store-1/${DEVICE}/${DAY}.json`;
  const document = JSON.parse(observation.documentJson) as { records: unknown[] };
  store.objects.set(key, { text: JSON.stringify({ schemaVersion: 1, storeId: 1, sequence: 1, documentJson: observation.documentJson, documentSha256: observation.documentSha256, receivedAt: new Date(BASE + 2_000).toISOString() }), etag: '"native-fixture-etag"' });
  return observation;
}

describe("directional handoff server contract", () => {
  it("returns no total or sizes for an empty observation window", async () => {
    const store = new FakeStore();
    const document = directionalDocument();
    document.windows = [];
    document.records = [];
    const result = await parseDirectionalHandoffDocument(input(document), 1, TIME_ZONE, store, new Date(BASE + 3_000));
    expect(result.estimatedHandoffs).toBeNull();
    expect(result.sizeBreakdown).toBeNull();
    expect(result.observedFrom).toBeNull();
    expect(result.observedUntil).toBeNull();
  });

  it("preserves the exact timezone-bearing window strings from Counter.document", async () => {
    const store = new FakeStore();
    const document = directionalDocument();
    document.windows[0] = {
      from: "2026-10-24T19:59:59.123456+00:00",
      until: "2026-10-24T20:00:01.654321+00:00",
      frames: 6,
      droppedFrames: 0,
    };
    document.records[0]!.status = "awaiting_local_evidence";
    const result = await parseDirectionalHandoffDocument(input(document), 1, TIME_ZONE, store, new Date(BASE + 3_000));
    expect(result.observedFrom).toBe("2026-10-24T19:59:59.123456+00:00");
    expect(result.observedUntil).toBe("2026-10-24T20:00:01.654321+00:00");
  });

  it("recomputes an eligible estimate from the authenticated local ledger observation", async () => {
    const store = new FakeStore();
    const observation = installNativeLedger(store, "test-object-0001");
    const document = directionalDocument("test-object-0001", {
      localEvidence: { observationId: observation.observationId, imageSha256: IMAGE, capturedAt: observation.capturedAt, size: "unknown", sizeBasis: "local_model_has_no_size_classes" },
    });
    const result = await parseDirectionalHandoffDocument(input(document), 1, TIME_ZONE, store, new Date(BASE + 3_000));
    expect(result.estimatedHandoffs).toBe(1);
    expect(result.sizeBreakdown).toEqual({ chico: 0, mediano: 0, pint: 0, litro: 0, unknown: 1 });
    expect(result.records[0]).toMatchObject({ effectiveStatus: "estimated", effectiveSize: "unknown", contributes: true });
  });

  it("never trusts a client mediano when the persisted native observation remains unknown", async () => {
    const store = new FakeStore();
    const observation = installNativeLedger(store, "test-object-0001", "unknown");
    const document = directionalDocument("test-object-0001", {
      size: "mediano",
      localEvidence: { observationId: observation.observationId, imageSha256: IMAGE, capturedAt: observation.capturedAt, size: "mediano", sizeBasis: "local_reference_estimate" },
    });
    await expect(parseDirectionalHandoffDocument(input(document), 1, TIME_ZONE, store, new Date(BASE + 3_000))).rejects.toThrow("native_evidence_invalid_for_estimate");
  });

  it("rejects tampered metadata bytes before any reconciliation result", async () => {
    const store = new FakeStore();
    const document = directionalDocument();
    document.records[0]!.samples[0]!.metadataJson += " ";
    await expect(parseDirectionalHandoffDocument(input(document), 1, TIME_ZONE, store, new Date(BASE + 3_000))).rejects.toThrow("sample_metadata_hash_mismatch");
  });

  it("rejects wrong direction, insufficient samples, and duplicate source IDs", async () => {
    const store = new FakeStore();
    const wrong = directionalDocument();
    wrong.records[0]!.samples = [
      sample("test-object-0001", 0, "destination"), sample("test-object-0001", 200, "destination"),
      sample("test-object-0001", 400, "handoff"), sample("test-object-0001", 600, "handoff"),
      sample("test-object-0001", 800, "origin"), sample("test-object-0001", 1_000, "origin"),
    ];
    await expect(parseDirectionalHandoffDocument(input(wrong), 1, TIME_ZONE, store, new Date(BASE + 3_000))).rejects.toThrow("route_not_directional");

    const incomplete = directionalDocument();
    incomplete.records[0]!.samples = incomplete.records[0]!.samples.slice(0, 5);
    await expect(parseDirectionalHandoffDocument(input(incomplete), 1, TIME_ZONE, store, new Date(BASE + 3_000))).rejects.toThrow();

    const duplicate = directionalDocument();
    duplicate.records.push({ ...duplicate.records[0]!, eventId: hashText("other-event"), sourceEventId: duplicate.records[0]!.sourceEventId });
    await expect(parseDirectionalHandoffDocument(input(duplicate), 1, TIME_ZONE, store, new Date(BASE + 3_000))).rejects.toThrow("duplicate_directional_identity");
  });

  it("enforces store/device/day and persisted readback CAS for submissions", async () => {
    const store = new FakeStore();
    const document = directionalDocument();
    document.records[0]!.status = "awaiting_local_evidence";
    const result = await saveDirectionalHandoffs(store, input(document), 1, TIME_ZONE, new Date(BASE + 3_000));
    expect(result.receipt.persisted).toBe(true);
    expect(result.receipt.estimatedHandoffs).toBe(0);
    expect(result.receipt.countsAreSales).toBe(false);
    const key = directionalHandoffStorageKey(1, DEVICE, DAY);
    expect(store.objects.has(key)).toBe(true);
    await expect(saveDirectionalHandoffs(store, input(document), 1, TIME_ZONE, new Date(BASE + 3_000))).resolves.toMatchObject({ disposition: "already_persisted" });
    await expect(parseDirectionalHandoffDocument(input(document), 2, TIME_ZONE, store, new Date(BASE + 3_000))).rejects.toThrow("policy_scope");
  });
});
