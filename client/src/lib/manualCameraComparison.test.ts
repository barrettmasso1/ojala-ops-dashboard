import { describe, expect, it } from "vitest";
import { buildManualCameraComparison, type ManualCameraComparisonInput } from "./manualCameraComparison";

const day = "2026-10-23";
const base = (): ManualCameraComparisonInput => ({
  selectedDate: day,
  manual: {
    businessDate: day, reportCount: 1,
    cups: { "4oz": 12, "8oz": 4, Pint: 3, Liter: 0 },
    cupsHere: { "4oz": 5, "8oz": 1, Pint: 0, Liter: 0 },
    cupsToGo: { "4oz": 7, "8oz": 3, Pint: 3, Liter: 0 },
  },
  nativeLedgerState: "received",
  nativeLedger: {
    businessDate: day, scope: "detector_tracks_not_certified_unique_deliveries",
    detectedTracks: 57, locallyVerifiedTargets: 21, withoutSameFrameEvidence: 0,
    ownerExcludedTargets: 0, potentialRepeatedTracks: 3,
    sizeBreakdown: { chico: 2, mediano: 5, pint: 0, litro: 0, unknown: 14 },
  },
  reviewedPhysicalCount: null,
});

describe("manual-camera comparison", () => {
  it("keeps the manual closing, camera observations, unknowns, and service mode semantically separate", () => {
    const view = buildManualCameraComparison(base());
    expect(view.manual).toMatchObject({ available: true, total: 19 });
    expect(view.manual.rows).toEqual(expect.arrayContaining([expect.objectContaining({ key: "chico-here", value: 5 }), expect.objectContaining({ key: "litro-togo", value: 0 })]));
    expect(view.native).toMatchObject({ received: true, detectedTracks: 57, usableObservations: 21, sizes: { chico: 2, mediano: 5, unknown: 14 } });
    expect(view.native).toMatchObject({ serviceMode: expect.stringContaining("No disponible") });
    expect(view.sizeRows.find(row => row.key === "mediano")).toMatchObject({ manual: 4, nativeObservations: 5, difference: null, percentage: null });
    expect(view.sizeRows.find(row => row.key === "chico")?.reason).toContain("no son vasos físicos deduplicados");
    expect(view.difference).toBeNull();
    expect(view.percentage).toBeNull();
  });

  it("compares only a complete reviewed physical count for the same business date", () => {
    const input = base();
    input.reviewedPhysicalCount = {
      businessDate: day, cameraName: "handoff", cupsDetected: 21,
      sourceDetail: JSON.stringify({ basis: "reviewed_unique_physical_cups", coverage: "complete", recordSha256: "a".repeat(64) }),
    };
    const view = buildManualCameraComparison(input);
    expect(view.physical).toMatchObject({ state: "comparable", value: 21, comparable: true });
    expect(view.difference).toBe(2);
    expect(view.percentage).toBeCloseTo(2 / 19);
  });

  it("preserves a real manual zero but never invents a percentage when its denominator is zero", () => {
    const input = base();
    input.manual = {
      businessDate: day, reportCount: 1,
      cups: { "4oz": 0, "8oz": 0, Pint: 0, Liter: 0 },
      cupsHere: { "4oz": 0, "8oz": 0, Pint: 0, Liter: 0 },
      cupsToGo: { "4oz": 0, "8oz": 0, Pint: 0, Liter: 0 },
    };
    input.reviewedPhysicalCount = { businessDate: day, cameraName: "handoff", cupsDetected: 0, sourceDetail: JSON.stringify({ basis: "reviewed_unique_physical_cups", coverage: "complete", recordSha256: "a".repeat(64) }) };
    const view = buildManualCameraComparison(input);
    expect(view.manual).toMatchObject({ available: true, total: 0 });
    expect(view.difference).toBe(0);
    expect(view.percentage).toBeNull();
  });

  it("does not convert absent, duplicated, or inconsistent manual records to zero", () => {
    for (const change of [
      { reportCount: 0 },
      { reportCount: 2 },
      { cupsHere: { "4oz": 2, "8oz": 1, Pint: 0, Liter: 0 } },
    ]) {
      const input = base();
      input.manual = { ...input.manual, ...change };
      const view = buildManualCameraComparison(input);
      expect(view.manual.available).toBe(false);
      expect(view.manual.total).toBeNull();
      expect(view.difference).toBeNull();
    }
  });

  it("does not mix another date's native observations or physical row", () => {
    const input = base();
    input.nativeLedger = { ...input.nativeLedger!, businessDate: "2026-10-22" };
    input.reviewedPhysicalCount = { businessDate: "2026-10-22", cameraName: "handoff", cupsDetected: 19, sourceDetail: JSON.stringify({ basis: "reviewed_unique_physical_cups", coverage: "complete", recordSha256: "a".repeat(64) }) };
    const view = buildManualCameraComparison(input);
    expect(view.native).toMatchObject({ received: false, reason: expect.stringContaining("otra fecha") });
    expect(view.physical).toMatchObject({ state: "invalid", value: null, comparable: false });
    expect(view.difference).toBeNull();
  });

  it("keeps unavailable native data and incomplete physical coverage unavailable rather than zero", () => {
    const input = base();
    input.nativeLedgerState = "unavailable";
    input.nativeLedger = null;
    input.reviewedPhysicalCount = { businessDate: day, cameraName: "handoff", cupsDetected: 9, sourceDetail: JSON.stringify({ basis: "reviewed_unique_physical_cups", coverage: "partial", recordSha256: "a".repeat(64) }) };
    const view = buildManualCameraComparison(input);
    expect(view.native).toMatchObject({ received: false, reason: expect.stringContaining("no está disponible") });
    expect(view.physical).toMatchObject({ state: "unconfirmed", value: 9, comparable: false });
    expect(view.difference).toBeNull();
    expect(view.shopify).toMatchObject({ available: false, reason: expect.stringContaining("No disponible") });
  });
});
