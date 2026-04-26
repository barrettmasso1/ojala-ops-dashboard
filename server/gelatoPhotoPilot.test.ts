import { describe, expect, it } from "vitest";
import { buildGroupedGelatoEntries, type ExtractedGelatoPhoto } from "./gelatoPhotoPilot";

describe("buildGroupedGelatoEntries", () => {
  it("groups extracted small and large pans by flavor", () => {
    const extractedPhotos: ExtractedGelatoPhoto[] = [
      {
        fileName: "vanilla-small-1.jpg",
        imageUrl: "/manus-storage/one",
        flavor: "Vanilla",
        panSize: "small",
        grossWeightKg: 1.52,
        confidence: "high",
        warning: "",
      },
      {
        fileName: "vanilla-small-2.jpg",
        imageUrl: "/manus-storage/two",
        flavor: "Vanilla",
        panSize: "small",
        grossWeightKg: 1.43,
        confidence: "high",
        warning: "",
      },
      {
        fileName: "vanilla-large-1.jpg",
        imageUrl: "/manus-storage/three",
        flavor: "Vanilla",
        panSize: "large",
        grossWeightKg: 3.42,
        confidence: "medium",
        warning: "",
      },
      {
        fileName: "chocolate-large-1.jpg",
        imageUrl: "/manus-storage/four",
        flavor: "Chocolate",
        panSize: "large",
        grossWeightKg: 3.91,
        confidence: "high",
        warning: "",
      },
    ];

    expect(buildGroupedGelatoEntries(extractedPhotos)).toEqual([
      {
        flavor: "Chocolate",
        smallPanCount: 0,
        smallGrossWeightKg: 0,
        largePanCount: 1,
        largeGrossWeightKg: 3.91,
      },
      {
        flavor: "Vanilla",
        smallPanCount: 2,
        smallGrossWeightKg: 2.95,
        largePanCount: 1,
        largeGrossWeightKg: 3.42,
      },
    ]);
  });

  it("ignores unknown pan sizes and zero-value readings until a user corrects them", () => {
    const extractedPhotos: ExtractedGelatoPhoto[] = [
      {
        fileName: "unclear.jpg",
        imageUrl: "/manus-storage/five",
        flavor: "Unknown flavor",
        panSize: "unknown",
        grossWeightKg: 0,
        confidence: "low",
        warning: "Scale display was not fully readable.",
      },
      {
        fileName: "mint-chip.jpg",
        imageUrl: "/manus-storage/six",
        flavor: "Mint Chip",
        panSize: "small",
        grossWeightKg: 1.11,
        confidence: "medium",
        warning: "",
      },
    ];

    expect(buildGroupedGelatoEntries(extractedPhotos)).toEqual([
      {
        flavor: "Mint Chip",
        smallPanCount: 1,
        smallGrossWeightKg: 1.11,
        largePanCount: 0,
        largeGrossWeightKg: 0,
      },
    ]);
  });
});
