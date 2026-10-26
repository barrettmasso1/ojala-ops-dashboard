import { describe, expect, it } from "vitest";
import { buildDailySnapshot, hasImpossibleReadyMadeGrossWeights, resolveReadyMadeGrossWeights } from "./db";

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

  it("accepts broader real-world pan variance without blocking submit", () => {
    expect(
      hasImpossibleReadyMadeGrossWeights({
        smallPanCount: 1,
        largePanCount: 1,
        combinedGrossWeightKg: 8.1,
      })
    ).toBe(false);
  });

  it("does not falsely reject manual mixed-pan entries when each side is within the updated gross limits", () => {
    expect(
      hasImpossibleReadyMadeGrossWeights({
        smallPanCount: 1,
        smallGrossWeightKg: 3.95,
        largePanCount: 1,
        largeGrossWeightKg: 4.95,
      })
    ).toBe(false);
  });

  it("accepts realistic manual entries with one small pan plus two large pans", () => {
    expect(
      hasImpossibleReadyMadeGrossWeights({
        smallPanCount: 1,
        smallGrossWeightKg: 3.2,
        largePanCount: 2,
        largeGrossWeightKg: 6.5,
      })
    ).toBe(false);
  });

  it("prefers explicit per-pan gross weights over combined totals when both are present", () => {
    expect(
      resolveReadyMadeGrossWeights({
        smallPanCount: 1,
        smallGrossWeightKg: 3.95,
        largePanCount: 1,
        largeGrossWeightKg: 4.95,
        combinedGrossWeightKg: 8.9,
      })
    ).toEqual({
      smallGrossWeightKg: 3.95,
      largeGrossWeightKg: 4.95,
      combinedGrossWeightKg: 8.9,
    });

    expect(
      hasImpossibleReadyMadeGrossWeights({
        smallPanCount: 1,
        smallGrossWeightKg: 3.95,
        largePanCount: 1,
        largeGrossWeightKg: 4.95,
        combinedGrossWeightKg: 8.9,
      })
    ).toBe(false);
  });


  it("still rejects clearly impossible combined gross weights", () => {
    expect(
      hasImpossibleReadyMadeGrossWeights({
        smallPanCount: 1,
        largePanCount: 1,
        combinedGrossWeightKg: 9.5,
      })
    ).toBe(true);
  });

  it("keeps a legacy net weight with no pan counts as registered weight without inventing gross volume", () => {
    const snapshot = buildDailySnapshot(
      [],
      [],
      [],
      [
        { flavor: "Legacy", shiftType: "opening", smallPanCount: 0, largePanCount: 0, smallGrossWeightKg: 0, largeGrossWeightKg: 0, weightKg: "2.21" },
        { flavor: "Legacy", shiftType: "closing", smallPanCount: 0, largePanCount: 0, smallGrossWeightKg: 0, largeGrossWeightKg: 0, weightKg: "1.20" },
      ],
      [],
      "2026-04-21"
    );
    const row = snapshot.gelato.flavors.find(item => item.flavor === "Legacy");
    expect(row?.opening.registeredNetWeightKg).toBe(2.21);
    expect(row?.opening.volumeAvailable).toBe(false);
    expect(row?.opening.totalVolumeOunces).toBeNull();
    expect(row?.usedVolumeOunces).toBeNull();
    expect(snapshot.gelato.actualDistributedVolumeOunces).toBeNull();
  });

  it("does not turn combined gross weight with zero pan counts into a pan assignment", () => {
    const snapshot = buildDailySnapshot(
      [],
      [],
      [],
      [
        { flavor: "Combined only", shiftType: "opening", smallPanCount: 0, largePanCount: 0, smallGrossWeightKg: 0, largeGrossWeightKg: 0, combinedGrossWeightKg: "2.50" },
        { flavor: "Combined only", shiftType: "closing", smallPanCount: 0, largePanCount: 0, smallGrossWeightKg: 0, largeGrossWeightKg: 0, combinedGrossWeightKg: "2.00" },
      ],
      [],
      "2026-04-21"
    );
    const row = snapshot.gelato.flavors.find(item => item.flavor === "Combined only");
    expect(row?.opening.registeredCombinedGrossWeightKg).toBe(2.5);
    expect(row?.opening.smallGrossWeightKg).toBe(0);
    expect(row?.opening.largeGrossWeightKg).toBe(0);
    expect(row?.opening.volumeAvailable).toBe(false);
    expect(row?.usedVolumeOunces).toBeNull();
  });

  it("preserves an explicit all-zero measurement as a real zero while keeping missing reports unavailable", () => {
    const snapshot = buildDailySnapshot(
      [],
      [],
      [],
      [
        { flavor: "Explicit zero", shiftType: "opening", smallPanCount: 0, largePanCount: 0, smallGrossWeightKg: 0, largeGrossWeightKg: 0, weightKg: 0 },
        { flavor: "Explicit zero", shiftType: "closing", smallPanCount: 0, largePanCount: 0, smallGrossWeightKg: 0, largeGrossWeightKg: 0, weightKg: 0 },
      ],
      [],
      "2026-04-21"
    );
    const row = snapshot.gelato.flavors.find(item => item.flavor === "Explicit zero");
    expect(row?.opening.available).toBe(true);
    expect(row?.opening.volumeAvailable).toBe(true);
    expect(row?.opening.totalVolumeOunces).toBe(0);
    expect(row?.usedVolumeOunces).toBe(0);
    expect(snapshot.gelato.actualDistributedVolumeOunces).toBe(0);
    expect(snapshot.gelato.varianceVolumeOunces).toBeNull();
  });
});
