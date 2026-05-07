import { describe, expect, it } from "vitest";
import { hasImpossibleReadyMadeGrossWeights, resolveReadyMadeGrossWeights } from "./db";

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

  it("flags impossible gross weights that exceed the selected pan capacity", () => {
    expect(
      hasImpossibleReadyMadeGrossWeights({
        smallPanCount: 1,
        smallGrossWeightKg: 2694,
        largePanCount: 1,
        largeGrossWeightKg: 3.94,
      })
    ).toBe(true);

    expect(
      hasImpossibleReadyMadeGrossWeights({
        smallPanCount: 1,
        smallGrossWeightKg: 1.82,
        largePanCount: 1,
        largeGrossWeightKg: 3.94,
      })
    ).toBe(false);
  });

  it("does not falsely reject normalized combined weights that round close to the pan limits", () => {
    expect(
      hasImpossibleReadyMadeGrossWeights({
        smallPanCount: 1,
        largePanCount: 1,
        combinedGrossWeightKg: 6.19,
      })
    ).toBe(false);
  });

  it("accepts locale-style comma decimals when validating combined gross weights", () => {
    expect(
      hasImpossibleReadyMadeGrossWeights({
        smallPanCount: 1,
        largePanCount: 1,
        combinedGrossWeightKg: "6,19" as unknown as number,
      })
    ).toBe(false);
  });

  it("accepts modest real-world pan variance without blocking submit", () => {
    expect(
      hasImpossibleReadyMadeGrossWeights({
        smallPanCount: 1,
        largePanCount: 1,
        combinedGrossWeightKg: 6.34,
      })
    ).toBe(false);
  });

  it("does not falsely reject manual mixed-pan entries when each side is within its allowed tolerance", () => {
    expect(
      hasImpossibleReadyMadeGrossWeights({
        smallPanCount: 1,
        smallGrossWeightKg: 1.98,
        largePanCount: 1,
        largeGrossWeightKg: 4.47,
      })
    ).toBe(false);
  });

  it("prefers explicit per-pan gross weights over combined totals when both are present", () => {
    expect(
      resolveReadyMadeGrossWeights({
        smallPanCount: 1,
        smallGrossWeightKg: 1.98,
        largePanCount: 1,
        largeGrossWeightKg: 4.47,
        combinedGrossWeightKg: 6.45,
      })
    ).toEqual({
      smallGrossWeightKg: 1.98,
      largeGrossWeightKg: 4.47,
      combinedGrossWeightKg: 6.45,
    });

    expect(
      hasImpossibleReadyMadeGrossWeights({
        smallPanCount: 1,
        smallGrossWeightKg: 1.98,
        largePanCount: 1,
        largeGrossWeightKg: 4.47,
        combinedGrossWeightKg: 6.45,
      })
    ).toBe(false);
  });

  it("still rejects clearly impossible combined gross weights", () => {
    expect(
      hasImpossibleReadyMadeGrossWeights({
        smallPanCount: 1,
        largePanCount: 1,
        combinedGrossWeightKg: 6.8,
      })
    ).toBe(true);
  });
});
