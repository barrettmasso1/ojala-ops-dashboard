import { describe, expect, it } from "vitest";
import { resolveReadyMadeGrossWeights } from "./db";

describe("resolveReadyMadeGrossWeights", () => {
  it("keeps a single small-pan combined weight as the small gross weight", () => {
    expect(
      resolveReadyMadeGrossWeights({
        smallPanCount: 1,
        largePanCount: 0,
        combinedGrossWeightKg: 1.95,
      })
    ).toEqual({
      smallGrossWeightKg: 1.95,
      largeGrossWeightKg: 0,
      combinedGrossWeightKg: 1.95,
    });
  });

  it("splits a small-plus-large combined weight into a deterministic estimated storage shape while preserving the combined total", () => {
    const resolved = resolveReadyMadeGrossWeights({
      smallPanCount: 1,
      largePanCount: 1,
      combinedGrossWeightKg: 3.95,
    });

    expect(resolved.combinedGrossWeightKg).toBe(3.95);
    expect(resolved.smallGrossWeightKg).toBeGreaterThan(0.286);
    expect(resolved.largeGrossWeightKg).toBeGreaterThan(0.4);
    expect(Number((resolved.smallGrossWeightKg + resolved.largeGrossWeightKg).toFixed(2))).toBe(3.95);
  });
});
