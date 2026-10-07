import { describe, expect, it } from "vitest";
import { buildDailyOperations, type DailyOperationsInput } from "./dailyOperations";

const day = "2026-10-07";
function sample(overrides: Partial<DailyOperationsInput> = {}): DailyOperationsInput {
  return { businessDate: day, reportCount: 1, cups: { "4oz": 8, "8oz": 10, Pint: 1, Liter: 1 }, ...overrides };
}
function camera(coverage = "complete", extras = {}) {
  return {
    businessDate: day, cameraName: "handoff", cupsDetected: 18,
    sourceDetail: JSON.stringify({
      basis: "reviewed_unique_physical_cups", recordSha256: "a".repeat(64), coverage, gaps: "", ...extras,
    }),
  };
}

describe("daily operations evidence boundaries", () => {
  it("keeps an absent camera count unknown instead of creating zero", () => {
    expect(buildDailyOperations(sample(), day)).toMatchObject({ salesCount: 20, cameraCount: null, difference: null, state: "missing" });
  });
  it("preserves a reported zero closing while distinguishing no closing", () => {
    const zero = { "4oz": 0, "8oz": 0, Pint: 0, Liter: 0 };
    expect(buildDailyOperations(sample({ cups: zero }), day).salesCount).toBe(0);
    expect(buildDailyOperations(sample({ cups: zero, reportCount: 0 }), day).salesCount).toBeNull();
  });
  it("shows partial evidence without turning it into a full-day comparison", () => {
    const view = buildDailyOperations(sample({ frigateCounts: camera("partial", { gaps: "Morning recording unavailable" }) }), day);
    expect(view).toMatchObject({ cameraCount: 18, cameraValue: "18 (partial)", state: "partial", difference: null, gaps: "Morning recording unavailable" });
  });
  it("compares physical counts across sizes without converting cups to ounces", () => {
    expect(buildDailyOperations(sample({ frigateCounts: camera() }), day)).toMatchObject({ salesCount: 20, cameraCount: 18, difference: -2, state: "reviewed" });
  });
  it("preserves a reviewed zero camera count and its signed difference", () => {
    expect(buildDailyOperations(sample({ frigateCounts: { ...camera(), cupsDetected: 0 } }), day)).toMatchObject({ cameraCount: 0, difference: -20, state: "reviewed" });
  });
  it("does not label an unstructured legacy count or track count as reviewed cups", () => {
    for (const sourceDetail of ["legacy data", JSON.stringify({ basis: "frigate_tracks", coverage: "complete" }), "{bad", "null", "[]"]) {
      expect(buildDailyOperations(sample({ frigateCounts: { ...camera(), sourceDetail } }), day)).toMatchObject({ cameraCount: 18, cameraValue: "18 (unverified)", state: "unclassified", difference: null });
    }
  });
  it("does not treat a review label without provenance metadata as reviewed", () => {
    expect(buildDailyOperations(sample({ frigateCounts: camera("complete", { recordSha256: "" }) }), day)).toMatchObject({ state: "unclassified", difference: null });
  });
  it("does not compare partial track evidence even if the coverage is explicit", () => {
    expect(buildDailyOperations(sample({ frigateCounts: camera("partial", { basis: "tracks" }) }), day)).toMatchObject({ state: "partial", difference: null });
  });
  it("rejects a wrong date or wrong camera instead of showing a stale count", () => {
    for (const patch of [{ businessDate: "2026-10-06" }, { cameraName: "entrance" }]) {
      expect(buildDailyOperations(sample({ frigateCounts: { ...camera(), ...patch } }), day)).toMatchObject({ cameraCount: null, difference: null, state: "invalid" });
    }
  });
  it("does not show either side for a stale snapshot", () => {
    expect(buildDailyOperations(sample({ businessDate: "2026-10-06", frigateCounts: camera() }), day)).toMatchObject({ salesCount: null, cameraCount: null, difference: null });
  });
  it("rejects invalid or fractional physical counts", () => {
    for (const cupsDetected of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(buildDailyOperations(sample({ frigateCounts: { ...camera(), cupsDetected } }), day)).toMatchObject({ state: "invalid", cameraCount: null, difference: null });
    }
  });
  it("requires review when complete coverage conflicts with gaps", () => {
    expect(buildDailyOperations(sample({ frigateCounts: camera("complete", { gaps: "No recording 12:00–13:00" }) }), day)).toMatchObject({ state: "unclassified", difference: null });
  });
  it("does not compare against a missing or invalid closing", () => {
    for (const patch of [{ reportCount: 0 }, { cups: { "4oz": -1, "8oz": 0, Pint: 0, Liter: 0 } }]) {
      expect(buildDailyOperations(sample({ ...patch, frigateCounts: camera() }), day)).toMatchObject({ salesCount: null, difference: null });
    }
  });
});
