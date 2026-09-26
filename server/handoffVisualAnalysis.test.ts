import { describe, expect, it } from "vitest";
import {
  classifyHandoffVisualResult,
  getHandoffVisualRetryDelayMs,
  withHandoffVisualAnalysisTimeout,
} from "./handoffVisualAnalysis";
import {
  decodeHandoffImageDataUrl,
  handoffImageExtension,
  parseHandoffCaptureMetadata,
} from "./handoffVisualPayload";

describe("handoff visual classifier", () => {
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
});
