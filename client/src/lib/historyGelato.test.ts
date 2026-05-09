import { describe, expect, it } from "vitest";

import { getHistoryGelatoRowVolumeBreakdown } from "./historyGelato";

describe("history gelato helpers", () => {
  it("estimates per-row volume ounces for mixed small and large history entries", () => {
    const breakdown = getHistoryGelatoRowVolumeBreakdown({
      smallPanCount: 1,
      smallGrossWeightKg: 1.492,
      largePanCount: 1,
      largeGrossWeightKg: 3.313,
    });

    expect(breakdown.smallVolumeOunces).toBeGreaterThan(40);
    expect(breakdown.smallVolumeOunces).toBeLessThan(45);
    expect(breakdown.largeVolumeOunces).toBeGreaterThan(113);
    expect(breakdown.largeVolumeOunces).toBeLessThan(116);
    expect(breakdown.totalVolumeOunces).toBeCloseTo(
      breakdown.smallVolumeOunces + breakdown.largeVolumeOunces,
      1
    );
  });

  it("clamps impossible history weights to the configured pan capacities", () => {
    const breakdown = getHistoryGelatoRowVolumeBreakdown({
      smallPanCount: 1,
      smallGrossWeightKg: 9,
      largePanCount: 1,
      largeGrossWeightKg: 9,
    });

    expect(breakdown.smallVolumeOunces).toBe(112);
    expect(breakdown.largeVolumeOunces).toBe(160);
    expect(breakdown.totalVolumeOunces).toBe(272);
  });
});
