import { describe, expect, it, vi } from "vitest";
import { PlatformDirectionalHandoffStore, type BlobRead } from "./localCupLedgerStorage";
import { DIRECTIONAL_HANDOFF_PROTOCOL, hashText, parseDirectionalHandoffDocument } from "./directionalHandoff";

const storageMocks = vi.hoisted(() => ({ storageGetSignedUrl: vi.fn() }));
const envMocks = vi.hoisted(() => ({ forgeApiUrl: "https://forge.test/", forgeApiKey: "test-only-key" }));
vi.mock("./storage", () => storageMocks);
vi.mock("./_core/env", () => ({ ENV: envMocks }));

const DEVICE = "38395f07-90c9-4ab4-a47e-a8881a3498fb";
const DAY = "2026-10-24";
const BASE = Date.parse("2026-10-24T20:00:00.000Z");
const MODEL = "a".repeat(64);
const ZONE = "b".repeat(64);
const IMAGE = "d".repeat(64);
const nativeUrl = "https://d36hbw14aib5lz.cloudfront.net/native.json?X-Amz-Signature=fixture";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function policy() {
  return {
    schema: "ojala_directional_policy_v1", storeId: 1, deviceId: DEVICE, cameraName: "handoff", timezone: "America/Mazatlan",
    detectorModelSha256: MODEL, sourceZoneSha256: ZONE, referenceImageSha256: "c".repeat(64), geometryCalibration: "provisional_visual_orientation",
    commercialAccuracyValidated: false, minimumSamplesPerZone: 2, maxSampleGapSeconds: 1.5, minimumScore: 0.45, width: 2304, height: 1296,
    zones: { origin: [[0.3, 0.7], [0.7, 0.7], [0.7, 0.9], [0.3, 0.9]], handoff: [[0.3, 0.45], [0.7, 0.45], [0.7, 0.65], [0.3, 0.65]], destination: [[0.3, 0.1], [0.7, 0.1], [0.7, 0.4], [0.3, 0.4]] },
  } as const;
}

function sample(sourceEventId: string, offset: number, y: number) {
  const metadata = canonical({ schema: "ojala_directional_sample_v1", deviceId: DEVICE, cameraName: "handoff", sourceEventId, at: new Date(BASE + offset).toISOString(), box: [0.47, y, 0.06, 0.05], score: 0.8, falsePositive: false });
  return { metadataJson: metadata, metadataSha256: hashText(metadata) };
}

function documents() {
  const sourceEventId = "real-adapter-0001";
  const currentPolicy = policy();
  const policyJson = canonical(currentPolicy);
  const policySha256 = hashText(policyJson);
  const observationId = hashText(`${DEVICE}/handoff/${sourceEventId}`);
  const capturedAt = new Date(BASE + 900).toISOString();
  const localPayload = {
    schema: "ojala_local_cup_observation_v1", observationId, deviceId: DEVICE, cameraName: "handoff", sourceEventId, businessDate: DAY,
    startedAt: new Date(BASE).toISOString(), endedAt: new Date(BASE + 1_000).toISOString(), detectorModelSha256: MODEL, detectorScore: 0.8,
    targetBox: [0.47, 0.5, 0.06, 0.05], enteredHandoffZone: true, sourceFalsePositive: false, verification: "same_frame_local_cv",
    size: "unknown", sizeBasis: "local_model_has_no_size_classes", physicalDeliveryConfirmed: false, salesCreated: false,
    sameFrameEvidence: { imageSha256: IMAGE, capturedAt, sourceMetadataSha256: "e".repeat(64), sourceZoneSha256: ZONE, targetBox: [0.47, 0.5, 0.06, 0.05], cupScore: 0.8, personDetections: 1, gateVersion: "fixture", inferenceLocation: "local_beelink", generativeAiUsed: false },
    sourceDetectorModelHash: null, sourceDetectorType: "local",
  };
  const payloadJson = JSON.stringify(localPayload);
  const localDocumentJson = JSON.stringify({ schemaVersion: 1, protocol: "ojala_local_cup_ledger_v1", deviceId: DEVICE, cameraName: "handoff", businessDate: DAY, records: [{ revision: 1, payloadJson, payloadSha256: hashText(payloadJson) }] });
  const localStored = JSON.stringify({ schemaVersion: 1, storeId: 1, sequence: 1, documentJson: localDocumentJson, documentSha256: hashText(localDocumentJson), receivedAt: new Date(BASE + 2_000).toISOString() });
  const samples = [sample(sourceEventId, 0, 0.75), sample(sourceEventId, 200, 0.75), sample(sourceEventId, 400, 0.5), sample(sourceEventId, 600, 0.5), sample(sourceEventId, 800, 0.2), sample(sourceEventId, 1_000, 0.2)];
  const eventId = hashText(`${DEVICE}/handoff/${sourceEventId}/${policySha256}`);
  const directionalDocument = {
    protocol: DIRECTIONAL_HANDOFF_PROTOCOL, deviceId: DEVICE, cameraName: "handoff", businessDate: DAY, policyJson, policySha256,
    windows: [{ from: new Date(BASE).toISOString(), until: new Date(BASE + 1_000).toISOString(), frames: 6, droppedFrames: 0 }],
    records: [{ eventId, sourceEventId, businessDate: DAY, completedAt: new Date(BASE + 1_000).toISOString(), status: "estimated", size: "unknown", samples, localEvidence: { observationId, imageSha256: IMAGE, capturedAt, size: "unknown", sizeBasis: "local_model_has_no_size_classes" }, possibleDuplicateOf: null }],
    scope: "directional_handoff_estimates_not_sales", requiresPerImageApproval: false, generativeAiUsed: false, commercialAccuracyValidated: false, coversWholeBusinessDay: false, physicalUniqueCountCertified: false,
  };
  const documentJson = JSON.stringify(directionalDocument);
  return { documentJson, documentSha256: hashText(documentJson), localStored };
}

describe("directional parser through real platform adapter", () => {
  it("reads the native ledger namespace for proof but rejects native writes", async () => {
    const fixture = documents();
    storageMocks.storageGetSignedUrl.mockImplementation(async (key: string) => key.startsWith("local-cup-ledger/") ? nativeUrl : "https://d36hbw14aib5lz.cloudfront.net/directional.json?X-Amz-Signature=fixture");
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url) === nativeUrl) return new Response(fixture.localStored, { status: 200, headers: { etag: '"native-v1"' } });
      throw new Error("unexpected_directional_read");
    }));
    const store = new PlatformDirectionalHandoffStore();
    const result = await parseDirectionalHandoffDocument({ sequence: 1, documentJson: fixture.documentJson, documentSha256: fixture.documentSha256 }, 1, "America/Mazatlan", store, new Date(BASE + 3_000));
    expect(result.estimatedHandoffs).toBe(1);
    await expect(store.compareAndPut(`local-cup-ledger/v1/store-1/${DEVICE}/${DAY}.json`, "must-not-write", null)).rejects.toThrow("invalid_directional_storage_write");
    expect(storageMocks.storageGetSignedUrl).toHaveBeenCalledWith(`local-cup-ledger/v1/store-1/${DEVICE}/${DAY}.json`);
    vi.unstubAllGlobals();
  });
});
