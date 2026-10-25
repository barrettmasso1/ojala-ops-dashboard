import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashText, parseLocalLedger, storedLedger, LOCAL_LEDGER_PROTOCOL } from "./localCupLedger";
import {
  LedgerConflict,
  LedgerStorageError,
  LOCAL_LEDGER_READ_HOST,
  PlatformCounterPickupStore,
  PlatformDirectionalHandoffStore,
  PlatformLocalLedgerStore,
  saveLocalLedger,
  type BlobRead,
  type LocalLedgerBlobStore,
} from "./localCupLedgerStorage";

const storageMocks = vi.hoisted(() => ({ storageGetSignedUrl: vi.fn() }));
const envMocks = vi.hoisted(() => ({
  forgeApiUrl: "https://forge.test",
  forgeApiKey: "test-only-key",
}));
vi.mock("./storage", () => storageMocks);
vi.mock("./_core/env", () => ({ ENV: envMocks }));

const DEVICE = "00000000-0000-4000-8000-000000000001";
const DAY = "2026-01-20";
const KEY = `local-cup-ledger/v1/store-1/${DEVICE}/${DAY}.json`;
const DIRECTIONAL_KEY = `directional-handoffs/v1/store-1/${DEVICE}/${DAY}.json`;
const COUNTER_PICKUP_KEY = `counter-pickups/v1/store-1/${DEVICE}/${DAY}.json`;
const signedReadUrl = `https://${LOCAL_LEDGER_READ_HOST}/bucket/object.json?X-Amz-Algorithm=fixture&X-Amz-Signature=fixture`;

function observation(index = 1) {
  const sourceEventId = `1768940000.123456-cup${index}`;
  return {
    schema: "ojala_local_cup_observation_v1" as const,
    observationId: hashText(`${DEVICE}/handoff/${sourceEventId}`),
    deviceId: DEVICE,
    cameraName: "handoff" as const,
    sourceEventId,
    businessDate: DAY,
    startedAt: "2026-01-20T23:00:00+00:00",
    endedAt: null as string | null,
    detectorModelSha256: "a".repeat(64),
    detectorScore: 0.8,
    targetBox: [0.4, 0.5, 0.08, 0.1] as [number, number, number, number],
    enteredHandoffZone: true,
    sourceFalsePositive: false,
    verification: "detector_track_only" as const,
    size: "unknown" as const,
    sizeBasis: "local_model_has_no_size_classes" as const,
    physicalDeliveryConfirmed: false as const,
    salesCreated: false as const,
    sameFrameEvidence: null,
    sourceDetectorModelHash: null,
    sourceDetectorType: "openvino",
  };
}

function envelope(rows = [observation()], sequence = 1, revision = 1) {
  const document = {
    schemaVersion: 1 as const,
    protocol: LOCAL_LEDGER_PROTOCOL,
    deviceId: DEVICE,
    cameraName: "handoff" as const,
    businessDate: DAY,
    records: rows.map((row) => {
      const payloadJson = JSON.stringify(row);
      return { revision, payloadJson, payloadSha256: hashText(payloadJson) };
    }),
  };
  const documentJson = JSON.stringify(document);
  return { sequence, documentJson, documentSha256: hashText(documentJson) };
}

const parsed = (input = envelope()) => parseLocalLedger(input, "America/Mazatlan");
function ownerReference() {
  const o = observation() as any;
  o.startedAt = "2026-01-21T02:00:00Z";
  o.verification = "same_frame_local_cv";
  o.sameFrameEvidence = { imageSha256: "b".repeat(64), capturedAt: "2026-01-21T02:00:01Z", sourceMetadataSha256: "c".repeat(64), sourceZoneSha256: "d".repeat(64), targetBox: o.targetBox, cupScore: .8, personDetections: 1, gateVersion: "test", inferenceLocation: "local_beelink", generativeAiUsed: false };
  o.ownerSizeReview = { protocol: "ojala_owner_size_review_v1", annotationSha256: "e".repeat(64), manifestSha256: "f".repeat(64), sampleId: "1".repeat(64), sourceEventId: o.sourceEventId, imageSha256: "b".repeat(64), label: "chico", labelSource: "owner_confirmed_capacity", confirmedAt: "2026-01-21T03:00:00Z", targetBox: o.targetBox, binding: { deviceId: DEVICE, cameraName: "handoff", zoneSha256: "d".repeat(64), detectorModelSha256: "a".repeat(64) } };
  o.size = "chico"; o.sizeBasis = "owner_confirmed_reference";
  return o;
}
function provisionalFrom(reference: any) {
  const o = observation(2) as any;
  o.sourceEventId = "1768940000.123456-cup2"; o.observationId = hashText(`${DEVICE}/handoff/${o.sourceEventId}`); o.verification = "same_frame_local_cv";
  o.sameFrameEvidence = { imageSha256: "c".repeat(64), capturedAt: "2026-01-20T23:00:01Z", sourceMetadataSha256: "9".repeat(64), sourceZoneSha256: "d".repeat(64), targetBox: o.targetBox, cupScore: .8, personDetections: 1, gateVersion: "test", inferenceLocation: "local_beelink", generativeAiUsed: false };
  o.size = "chico"; o.sizeBasis = "local_reference_estimate"; o.sizeAssessment = { size: "chico", status: "classified", reason: "matched_owner_labeled_local_references", basis: "local_reference_estimate", modelSha256: "1".repeat(64), classifierVersion: "ojala_body_templates_v1", imageSha256: "c".repeat(64), referenceImageHashes: ["b".repeat(64)], distance: .1, margin: .08, externalAiUsed: false, notACertifiedVolume: true, provisional: true, generalizationValidated: false, referenceImages: 1, referenceScenes: 1, validationLevel: "single_reference_only", annotationSha256: "e".repeat(64), extractor: "bottom_body_hog_070", referenceObservationId: reference.observationId, referenceSourceEventId: reference.sourceEventId, referenceBusinessDate: reference.businessDate, referenceOwnerLabel: "chico", referenceAnnotationSha256: "e".repeat(64) };
  return o;
}
const response = (status: number, body = "", headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

class ScriptedBlobStore implements LocalLedgerBlobStore {
  current: BlobRead | null = null;
  calls: Array<{ type: "read" | "put"; expectedEtag?: string | null; text?: string }> = [];
  createError: Error | null = null;
  updateError: Error | null = null;
  readError: Error | null = null;
  forbidReadBeforeCreate = false;
  writeDivergent = false;
  divergent: BlobRead | null = null;

  async read(_key: string) {
    this.calls.push({ type: "read" });
    if (this.readError) throw this.readError;
    if (this.forbidReadBeforeCreate && !this.current) throw new LedgerStorageError("ledger_storage_read_failed_403", "object_get", 403);
    return this.current;
  }

  async compareAndPut(_key: string, text: string, expectedEtag: string | null) {
    this.calls.push({ type: "put", expectedEtag, text });
    if (expectedEtag === null && this.createError) throw this.createError;
    if (expectedEtag !== null && this.updateError) throw this.updateError;
    if (expectedEtag !== null && this.current?.etag !== expectedEtag) throw new LedgerConflict("etag_conflict");
    const document = this.writeDivergent && this.divergent ? this.divergent : { text, etag: `"etag-${this.calls.length}"` };
    this.current = document;
  }
}

describe("PlatformLocalLedgerStore read adapter", () => {
  beforeEach(() => {
    storageMocks.storageGetSignedUrl.mockReset();
    storageMocks.storageGetSignedUrl.mockResolvedValue(signedReadUrl);
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("preserves the exact signed CloudFront URL and query while using no-store reads", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(response(200, "ledger", { etag: '"v1"' }));
    const result = await new PlatformLocalLedgerStore().read(KEY);
    expect(result).toEqual({ text: "ledger", etag: '"v1"' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(signedReadUrl);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ "Accept-Encoding": "identity", "Cache-Control": "no-cache, no-store, max-age=0" });
  });

  it.each([
    `https://${LOCAL_LEDGER_READ_HOST}.evil.example/object?signature=fixture`,
    "https://other.cloudfront.net/object?signature=fixture",
    "http://d36hbw14aib5lz.cloudfront.net/object?signature=fixture",
    "https://user@d36hbw14aib5lz.cloudfront.net/object?signature=fixture",
    "https://d36hbw14aib5lz.cloudfront.net:444/object?signature=fixture",
  ])("rejects an untrusted or altered read destination: %s", async (url) => {
    storageMocks.storageGetSignedUrl.mockResolvedValueOnce(url);
    await expect(new PlatformLocalLedgerStore().read(KEY)).rejects.toThrow("untrusted_storage_url");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500])("keeps GET HTTP %s as an error, not absence", async (status) => {
    vi.mocked(fetch).mockResolvedValue(response(status));
    await expect(new PlatformLocalLedgerStore().read(KEY)).rejects.toMatchObject({
      message: `ledger_storage_read_failed_${status}`,
      stage: "object_get",
      status,
    } satisfies Partial<LedgerStorageError>);
  });

  it("keeps a GET timeout as an error, not absence", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("timeout"));
    await expect(new PlatformLocalLedgerStore().read(KEY)).rejects.toThrow("timeout");
  });

  it("returns null only for a real GET 404", async () => {
    vi.mocked(fetch).mockResolvedValue(response(404));
    await expect(new PlatformLocalLedgerStore().read(KEY)).resolves.toBeNull();
  });

  it("rejects a 200 object without an ETag", async () => {
    vi.mocked(fetch).mockResolvedValue(response(200, "ledger"));
    await expect(new PlatformLocalLedgerStore().read(KEY)).rejects.toMatchObject({
      message: "ledger_storage_etag_missing",
      stage: "object_get",
      status: 200,
    });
  });

  it.each(['W/"v1"', "v1", '""'])("rejects a weak or malformed ETag before any CAS can use it: %s", async (etag) => {
    vi.mocked(fetch).mockResolvedValue(response(200, "ledger", { etag }));
    await expect(new PlatformLocalLedgerStore().read(KEY)).rejects.toMatchObject({
      message: "ledger_storage_etag_not_strong",
      stage: "object_get",
      status: 200,
    });
  });

  it("rejects a transformed response even when its ETag is strong", async () => {
    vi.mocked(fetch).mockResolvedValue(response(200, "ledger", { etag: '"v1"', "content-encoding": "br" }));
    await expect(new PlatformLocalLedgerStore().read(KEY)).rejects.toMatchObject({
      message: "ledger_storage_content_encoding_present",
      stage: "object_get",
      status: 200,
    });
  });

  it("rejects redirects instead of following them", async () => {
    vi.mocked(fetch).mockResolvedValue(response(302, "", { location: signedReadUrl }));
    await expect(new PlatformLocalLedgerStore().read(KEY)).rejects.toMatchObject({ status: 302 });
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
  });

  it("enforces the object body limit", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name === "content-length" ? String(13 * 1024 * 1024) : name === "etag" ? '"v1"' : null },
      body: { getReader: () => ({ read: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined) }) },
    } as unknown as Response);
    await expect(new PlatformLocalLedgerStore().read(KEY)).rejects.toThrow("storage_object_too_large");
  });

  it("does not permit the CloudFront read host as a PUT destination", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(200, JSON.stringify({ url: signedReadUrl }), { "content-type": "application/json" }));
    await expect(new PlatformLocalLedgerStore().compareAndPut(KEY, "ledger", null)).rejects.toThrow("untrusted_storage_url");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized PUT before asking for a presign", async () => {
    await expect(new PlatformLocalLedgerStore().compareAndPut(KEY, "x".repeat(13 * 1024 * 1024), null)).rejects.toThrow("invalid_ledger_storage_write");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("keeps a PUT 403 as an error", async () => {
    const putUrl = "https://bucket.s3.amazonaws.com/object.json?X-Amz-Signature=fixture";
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(200, JSON.stringify({ url: putUrl }), { "content-type": "application/json" }))
      .mockResolvedValueOnce(response(403));
    await expect(new PlatformLocalLedgerStore().compareAndPut(KEY, "ledger", null)).rejects.toMatchObject({
      message: "ledger_storage_write_failed_403",
      stage: "object_put",
      status: 403,
    });
  });

  it("keeps a PUT timeout as an error", async () => {
    const putUrl = "https://bucket.s3.amazonaws.com/object.json?X-Amz-Signature=fixture";
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(200, JSON.stringify({ url: putUrl }), { "content-type": "application/json" }))
      .mockRejectedValueOnce(new Error("timeout"));
    await expect(new PlatformLocalLedgerStore().compareAndPut(KEY, "ledger", null)).rejects.toThrow("timeout");
  });

  it("keeps conditional PUT headers and exact signed S3 URL intact", async () => {
    const putUrl = "https://bucket.s3.amazonaws.com/object.json?X-Amz-Signature=fixture";
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(200, JSON.stringify({ url: putUrl }), { "content-type": "application/json" }))
      .mockResolvedValueOnce(response(200));
    await new PlatformLocalLedgerStore().compareAndPut(KEY, "ledger", null);
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toBe(putUrl);
    expect(vi.mocked(fetch).mock.calls[1]?.[1]).toMatchObject({ method: "PUT", redirect: "error" });
    expect(vi.mocked(fetch).mock.calls[1]?.[1]?.headers).toMatchObject({ "If-None-Match": "*" });

    vi.mocked(fetch).mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(200, JSON.stringify({ url: putUrl }), { "content-type": "application/json" }))
      .mockResolvedValueOnce(response(200));
    await new PlatformLocalLedgerStore().compareAndPut(KEY, "ledger", '"old"');
    expect(vi.mocked(fetch).mock.calls[1]?.[1]?.headers).toMatchObject({ "If-Match": '"old"' });
  });
});

describe("PlatformDirectionalHandoffStore adapter", () => {
  beforeEach(() => {
    storageMocks.storageGetSignedUrl.mockReset();
    storageMocks.storageGetSignedUrl.mockResolvedValue(signedReadUrl);
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the exact signed read URL and identity representation", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(response(200, "directional", { etag: '"directional-v1"' }));
    await expect(new PlatformDirectionalHandoffStore().read(DIRECTIONAL_KEY)).resolves.toEqual({ text: "directional", etag: '"directional-v1"' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(signedReadUrl);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "Accept-Encoding": "identity" });
  });

  it.each([401, 403, 500])("keeps directional GET HTTP %s as an error", async status => {
    vi.mocked(fetch).mockResolvedValue(response(status));
    await expect(new PlatformDirectionalHandoffStore().read(DIRECTIONAL_KEY)).rejects.toMatchObject({ message: `directional_storage_read_failed_${status}`, stage: "object_get", status });
  });

  it("rejects weak ETag, transformed representation and oversized directional objects", async () => {
    vi.mocked(fetch).mockResolvedValue(response(200, "directional", { etag: 'W/"weak"' }));
    await expect(new PlatformDirectionalHandoffStore().read(DIRECTIONAL_KEY)).rejects.toThrow("directional_storage_etag_not_strong");
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValue(response(200, "directional", { etag: '"strong"', "content-encoding": "br" }));
    await expect(new PlatformDirectionalHandoffStore().read(DIRECTIONAL_KEY)).rejects.toThrow("directional_storage_content_encoding_present");
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, headers: { get: (name: string) => name === "content-length" ? String(13 * 1024 * 1024) : name === "etag" ? '"strong"' : null }, body: { getReader: () => ({ read: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined) }) } } as unknown as Response);
    await expect(new PlatformDirectionalHandoffStore().read(DIRECTIONAL_KEY)).rejects.toThrow("storage_object_too_large");
  });

  it("uses create-only and CAS headers without changing the signed PUT URL", async () => {
    const putUrl = "https://bucket.s3.amazonaws.com/directional.json?X-Amz-Signature=fixture";
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(200, JSON.stringify({ url: putUrl }), { "content-type": "application/json" }))
      .mockResolvedValueOnce(response(200));
    await new PlatformDirectionalHandoffStore().compareAndPut(DIRECTIONAL_KEY, "directional", null);
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toBe(putUrl);
    expect(vi.mocked(fetch).mock.calls[1]?.[1]?.headers).toMatchObject({ "If-None-Match": "*" });
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(200, JSON.stringify({ url: putUrl }), { "content-type": "application/json" }))
      .mockResolvedValueOnce(response(200));
    await new PlatformDirectionalHandoffStore().compareAndPut(DIRECTIONAL_KEY, "directional", '"old"');
    expect(vi.mocked(fetch).mock.calls[1]?.[1]?.headers).toMatchObject({ "If-Match": '"old"' });
  });

  it("delegates native-prefix reads but never permits native-prefix writes", async () => {
    const nativeKey = `local-cup-ledger/v1/store-1/${DEVICE}/${DAY}.json`;
    vi.mocked(fetch).mockResolvedValue(response(200, "native", { etag: '"native-v1"' }));
    await expect(new PlatformDirectionalHandoffStore().read(nativeKey)).resolves.toEqual({ text: "native", etag: '"native-v1"' });
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe(signedReadUrl);
    vi.mocked(fetch).mockReset();
    await expect(new PlatformDirectionalHandoffStore().compareAndPut(nativeKey, "must-not-write", null)).rejects.toThrow("invalid_directional_storage_write");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("normalizes a forge URL that already ends with a slash", async () => {
    envMocks.forgeApiUrl = "https://forge.test/";
    const putUrl = "https://bucket.s3.amazonaws.com/directional.json?X-Amz-Signature=fixture";
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(200, JSON.stringify({ url: putUrl }), { "content-type": "application/json" }))
      .mockResolvedValueOnce(response(200));
    await new PlatformDirectionalHandoffStore().compareAndPut(DIRECTIONAL_KEY, "directional", null);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe("https://forge.test/v1/storage/presign/put?path=" + encodeURIComponent(DIRECTIONAL_KEY));
    envMocks.forgeApiUrl = "https://forge.test";
  });
});

describe("PlatformCounterPickupStore adapter", () => {
  beforeEach(() => {
    storageMocks.storageGetSignedUrl.mockReset();
    storageMocks.storageGetSignedUrl.mockResolvedValue(signedReadUrl);
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads its private document with identity representation and delegates only native-ledger reads", async () => {
    vi.mocked(fetch).mockResolvedValue(response(200, "pickup", { etag: '"pickup-v1"' }));
    await expect(new PlatformCounterPickupStore().read(COUNTER_PICKUP_KEY)).resolves.toEqual({ text: "pickup", etag: '"pickup-v1"' });
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValue(response(200, "native", { etag: '"native-v1"' }));
    await expect(new PlatformCounterPickupStore().read(KEY)).resolves.toEqual({ text: "native", etag: '"native-v1"' });
  });

  it("uses create-only/CAS for counter objects but rejects directional and native writes before presign", async () => {
    const putUrl = "https://bucket.s3.amazonaws.com/pickup.json?X-Amz-Signature=fixture";
    vi.mocked(fetch).mockResolvedValueOnce(response(200, JSON.stringify({ url: putUrl }), { "content-type": "application/json" })).mockResolvedValueOnce(response(200));
    await new PlatformCounterPickupStore().compareAndPut(COUNTER_PICKUP_KEY, "pickup", null);
    expect(vi.mocked(fetch).mock.calls[1]?.[1]?.headers).toMatchObject({ "If-None-Match": "*" });
    vi.mocked(fetch).mockReset();
    await expect(new PlatformCounterPickupStore().compareAndPut(KEY, "forbidden", null)).rejects.toThrow("invalid_counter_pickup_storage_write");
    await expect(new PlatformCounterPickupStore().compareAndPut(DIRECTIONAL_KEY, "forbidden", null)).rejects.toThrow("invalid_counter_pickup_storage_write");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe("saveLocalLedger create-only and readback protocol", () => {
  it("accepts a provisional update only when its reference is owner-confirmed in the native ledger", async () => {
    const store = new ScriptedBlobStore();
    const reference = ownerReference();
    store.current = { text: JSON.stringify(storedLedger(parsed(envelope([reference])), 1)), etag: '"reference"' };
    store.createError = new LedgerConflict("if_none_match");
    const provisional = provisionalFrom(reference);
    const next = parsed(envelope([reference, provisional], 2, 2));
    await expect(saveLocalLedger(store, next, 1, "America/Mazatlan")).resolves.toMatchObject({ disposition: "update" });
    expect(store.calls.filter(call => call.type === "put")).toHaveLength(2);
  });

  it("rejects an unlisted provisional reference before any write", async () => {
    const store = new ScriptedBlobStore();
    const provisional = provisionalFrom(ownerReference());
    provisional.sizeAssessment.referenceObservationId = "9".repeat(64);
    await expect(saveLocalLedger(store, parsed(envelope([provisional])), 1, "America/Mazatlan")).rejects.toThrow("provisional_reference_not_owner_confirmed");
    expect(store.calls).toEqual([{ type: "read" }]);
  });

  it("creates when a pre-read would be 403 and confirms only after a 200 readback", async () => {
    const store = new ScriptedBlobStore();
    store.forbidReadBeforeCreate = true;
    const result = await saveLocalLedger(store, parsed(), 1, "America/Mazatlan");
    expect(result.disposition).toBe("create");
    expect(store.calls.map((call) => call.type)).toEqual(["put", "read"]);
    expect(store.calls[0]).toMatchObject({ type: "put", expectedEtag: null });
  });

  it("never blindly overwrites an existing object; it reads then uses its ETag", async () => {
    const store = new ScriptedBlobStore();
    store.current = { text: JSON.stringify(storedLedger(parsed(), 1)), etag: '"old"' };
    store.createError = new LedgerConflict("if_none_match");
    const next = parsed(envelope([observation()], 2, 2));
    const result = await saveLocalLedger(store, next, 1, "America/Mazatlan");
    expect(result.disposition).toBe("update");
    expect(store.calls.map((call) => call.type)).toEqual(["put", "read", "put", "read"]);
    expect(store.calls[0]).toMatchObject({ expectedEtag: null });
    expect(store.calls[2]).toMatchObject({ expectedEtag: '"old"' });
  });

  it("supports a second and third update with successive conditional readbacks", async () => {
    const store = new ScriptedBlobStore();
    await expect(saveLocalLedger(store, parsed(envelope([observation(1)], 2, 2)), 1, "America/Mazatlan")).resolves.toMatchObject({ disposition: "create" });
    store.createError = new LedgerConflict("if_none_match");
    await expect(saveLocalLedger(store, parsed(envelope([observation(1), observation(2)], 3, 3)), 1, "America/Mazatlan")).resolves.toMatchObject({ disposition: "update" });
    await expect(saveLocalLedger(store, parsed(envelope([observation(1), observation(2), observation(3)], 4, 4)), 1, "America/Mazatlan")).resolves.toMatchObject({ disposition: "update" });
    expect(store.calls.filter((call) => call.type === "put").map((call) => call.expectedEtag)).toEqual([null, null, '"etag-1"', null, '"etag-5"']);
  });

  it("requires a read and validation after a create conflict before any CAS update", async () => {
    const store = new ScriptedBlobStore();
    store.createError = new LedgerConflict("precondition");
    store.current = { text: JSON.stringify(storedLedger(parsed(), 2)), etag: '"foreign"' };
    await expect(saveLocalLedger(store, parsed(), 1, "America/Mazatlan")).rejects.toThrow("stored_store_mismatch");
    expect(store.calls.map((call) => call.type)).toEqual(["put", "read"]);
  });

  it.each([
    new LedgerStorageError("ledger_storage_write_failed_403", "object_put", 403),
    new Error("timeout"),
  ])("does not confirm a failed initial PUT: %s", async (error) => {
    const store = new ScriptedBlobStore();
    store.createError = error;
    await expect(saveLocalLedger(store, parsed(), 1, "America/Mazatlan")).rejects.toBe(error);
    expect(store.calls.map((call) => call.type)).toEqual(["put"]);
  });

  it("does not destroy history or write CAS for a stale request", async () => {
    const store = new ScriptedBlobStore();
    store.current = { text: JSON.stringify(storedLedger(parsed(envelope([observation()], 2, 2)), 1)), etag: '"newer"' };
    store.createError = new LedgerConflict("if_none_match");
    await expect(saveLocalLedger(store, parsed(envelope(), 1, 1), 1, "America/Mazatlan")).rejects.toThrow("stale_ledger_revision");
    expect(store.calls.map((call) => call.type)).toEqual(["put", "read"]);
    expect(store.current?.etag).toBe('"newer"');
  });

  it("does not acknowledge a divergent readback after an accepted create", async () => {
    const store = new ScriptedBlobStore();
    store.divergent = { text: JSON.stringify(storedLedger(parsed(envelope([observation(2)])), 1)), etag: '"other"' };
    store.writeDivergent = true;
    await expect(saveLocalLedger(store, parsed(), 1, "America/Mazatlan")).rejects.toThrow("readback_mismatch");
  });

  it("does not acknowledge when the mandatory readback is still forbidden", async () => {
    const store = new ScriptedBlobStore();
    store.readError = new LedgerStorageError("ledger_storage_read_failed_403", "object_get", 403);
    await expect(saveLocalLedger(store, parsed(), 1, "America/Mazatlan")).rejects.toMatchObject({ status: 403 });
    expect(store.calls.map((call) => call.type)).toEqual(["put", "read"]);
  });
});
