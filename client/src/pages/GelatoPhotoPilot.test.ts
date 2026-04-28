import { describe, expect, it } from "vitest";
import {
  appendExtractedDraftEntries,
  applyPanSetup,
  estimateVolumeOunces,
  getPanSetup,
} from "./GelatoPhotoPilot";

describe("gelato photo pilot helpers", () => {
  it("appends newly analyzed photos instead of replacing existing review rows", () => {
    const initial = appendExtractedDraftEntries([], [
      {
        fileName: "watermelon-pair.jpg",
        imageUrl: "/one",
        flavor: "Watermelon",
        smallPanCount: 1,
        largePanCount: 1,
        combinedGrossWeightKg: 3.95,
        confidence: "high",
        warning: "",
      },
    ]);

    const appended = appendExtractedDraftEntries(initial, [
      {
        fileName: "chocolate-large.jpg",
        imageUrl: "/two",
        flavor: "Chocolate",
        smallPanCount: 0,
        largePanCount: 1,
        combinedGrossWeightKg: 3.1,
        confidence: "medium",
        warning: "",
      },
    ]);

    expect(initial).toHaveLength(1);
    expect(appended).toHaveLength(2);
    expect(appended.map(entry => entry.flavor)).toEqual(["Watermelon", "Chocolate"]);
  });

  it("maps editable pan setup selections to the expected counts", () => {
    expect(applyPanSetup("small")).toEqual({ smallPanCount: 1, largePanCount: 0 });
    expect(applyPanSetup("large")).toEqual({ smallPanCount: 0, largePanCount: 1 });
    expect(applyPanSetup("small_large")).toEqual({ smallPanCount: 1, largePanCount: 1 });
    expect(getPanSetup({ smallPanCount: 1, largePanCount: 1 })).toBe("small_large");
  });

  it("estimates positive total volume ounces for a same-flavor small-plus-large combined reading", () => {
    const volumeOunces = estimateVolumeOunces({
      smallPanCount: 1,
      largePanCount: 1,
      combinedGrossWeightKg: 3.95,
    });

    expect(volumeOunces).toBeGreaterThan(0);
    expect(Math.round(volumeOunces)).toBeGreaterThan(100);
  });
});
