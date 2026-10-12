import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeHandoffVisualImage,
  classifyHandoffVisualResult,
  getHandoffVisualRetryDelayMs,
  HANDOFF_VISUAL_MODEL,
  withHandoffVisualAnalysisTimeout,
} from "./handoffVisualAnalysis";
import {
  decodeHandoffImageDataUrl,
  handoffImageExtension,
  parseHandoffCaptureMetadata,
} from "./handoffVisualPayload";

describe("handoff visual classifier", () => {
  it("uses the scoped Gemini Pro model instead of changing the application default", () => {
    expect(HANDOFF_VISUAL_MODEL).toBe("gemini-3.1-pro-preview");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BUILT_IN_FORGE_API_KEY;
    delete process.env.BUILT_IN_FORGE_API_URL;
  });

  it("sends only this filter through Gemini Pro with strict structured visual evidence", async () => {
    process.env.BUILT_IN_FORGE_API_KEY = "test-only-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: HANDOFF_VISUAL_MODEL,
        choices: [{ message: { content: JSON.stringify({
          person_present: true,
          gelato_cup_present: true,
          cup_in_handoff_zone: true,
          visible_cup_count: 1,
          confidence: "high",
          ambiguous: false,
          discard_reason: "",
          review_reason: "",
          person_boxes: [],
          gelato_cup_boxes: [],
        }) } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await analyzeHandoffVisualImage({
      imageUrl: "https://storage.example.test/private.jpg",
      cameraName: "handoff",
      handoffZonePolygon: [{ x: 0.45, y: 0.55 }, { x: 0.6, y: 0.55 }, { x: 0.6, y: 0.7 }],
      handoffZoneGeometryVersion: 1,
    });

    expect(result.model).toBe(HANDOFF_VISUAL_MODEL);
    const [url, request] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toMatch(/\/v1\/chat\/completions$/);
    expect(JSON.parse(request.body)).toMatchObject({
      model: HANDOFF_VISUAL_MODEL,
      max_tokens: 16_384,
      response_format: { type: "json_schema" },
    });
  });

  it("approves only a confident person-plus-cup observation inside the configured handoff zone", () => {
    expect(classifyHandoffVisualResult({
      person_present: true,
      gelato_cup_present: true,
      cup_in_handoff_zone: true,
      visible_cup_count: 2,
      confidence: "high",
      ambiguous: false,
      discard_reason: "",
      review_reason: "",
    })).toMatchObject({
      status: "approved_by_ai",
      visibleCupCount: 2,
      personPresent: true,
      cupInHandoffZone: true,
    });
  });

  it("discards lamps, arms, and other non-cup evidence without changing operational counts", () => {
    expect(classifyHandoffVisualResult({
      person_present: true,
      gelato_cup_present: false,
      cup_in_handoff_zone: false,
      visible_cup_count: 0,
      confidence: "high",
      ambiguous: false,
      discard_reason: "Only an arm and an overhead lamp are visible.",
      review_reason: "",
    })).toEqual(expect.objectContaining({
      status: "discarded",
      visibleCupCount: 0,
      reason: "Only an arm and an overhead lamp are visible.",
    }));
  });

  it("routes uncertain or contradictory evidence to human review", () => {
    expect(classifyHandoffVisualResult({
      person_present: true,
      gelato_cup_present: true,
      cup_in_handoff_zone: false,
      visible_cup_count: 1,
      confidence: "low",
      ambiguous: true,
      discard_reason: "",
      review_reason: "The handoff zone boundary is obscured.",
    })).toEqual(expect.objectContaining({
      status: "pending_review",
      reason: "The handoff zone boundary is obscured.",
    }));
  });

  it("caps backoff and does not produce unbounded retries", () => {
    expect(getHandoffVisualRetryDelayMs(1)).toBe(60_000);
    expect(getHandoffVisualRetryDelayMs(2)).toBe(120_000);
    expect(getHandoffVisualRetryDelayMs(99)).toBe(60 * 60 * 1_000);
  });

  it("times out a stuck model request so the durable queue can retry", async () => {
    await expect(withHandoffVisualAnalysisTimeout(new Promise<never>(() => undefined), 5))
      .rejects.toThrow("timed out");
  });
});

describe("handoff image and capture metadata", () => {
  const SHA = "a".repeat(64);
  const capture = {
    camera: "handoff",
    cupZone: "handoff_zone",
    cupEventId: "verified-cup-event-001",
    capturedAtUtc: "2026-09-26T20:15:30.000Z",
    imageSha256: SHA,
  };

  it("accepts a supported image data URL with a matching image signature", () => {
    const decoded = decodeHandoffImageDataUrl("data:image/jpeg;base64,/9j/2Q==");
    expect(decoded.mimeType).toBe("image/jpeg");
    expect(decoded.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(handoffImageExtension(decoded.mimeType)).toBe("jpg");
  });

  it("rejects corrupt declared image data before storage", () => {
    expect(() => decodeHandoffImageDataUrl("data:image/jpeg;base64,bm90LWFuLWltYWdl"))
      .toThrow("corrupt");
  });

  it("requires original capture identity, UTC time, zone, and checksum from the sidecar", () => {
    expect(parseHandoffCaptureMetadata(capture)).toMatchObject({
      camera: "handoff",
      cupZone: "handoff_zone",
      cupEventId: "verified-cup-event-001",
      imageSha256: SHA,
    });
    expect(() => parseHandoffCaptureMetadata({ ...capture, cupZone: "other" })).toThrow("cup_zone");
    expect(() => parseHandoffCaptureMetadata({ ...capture, capturedAtUtc: "2026-09-26T20:15:30-07:00" })).toThrow("UTC");
  });

  it("accepts a +00:00 UTC sidecar and preserves its microsecond timestamp text", () => {
    const parsed = parseHandoffCaptureMetadata({
      ...capture,
      cupEventId: "verified-cup-event-offset-001",
      capturedAtUtc: "2026-09-26T21:58:33.230890+00:00",
    });

    expect(parsed.capturedAtUtc).toBe("2026-09-26T21:58:33.230890+00:00");
    expect(parsed.capturedAt.toISOString()).toBe("2026-09-26T21:58:33.230Z");
  });
});
