import { describe, expect, it } from "vitest";
import { buildGroupedGelatoEntries, normalizeSinglePanPhotoCounts, type ExtractedGelatoPhoto } from "./gelatoPhotoPilot";

describe("normalizeSinglePanPhotoCounts", () => {
  it("defaults any single detected pan to the small-pan workflow", () => {
    expect(normalizeSinglePanPhotoCounts({ smallPanCount: 0, largePanCount: 1 })).toEqual({
      smallPanCount: 1,
      largePanCount: 0,
    });
    expect(normalizeSinglePanPhotoCounts({ smallPanCount: 1, largePanCount: 0 })).toEqual({
      smallPanCount: 1,
      largePanCount: 0,
    });
    expect(normalizeSinglePanPhotoCounts({ smallPanCount: 1, largePanCount: 1 })).toEqual({
      smallPanCount: 1,
      largePanCount: 1,
    });
  });
});

describe("buildGroupedGelatoEntries", () => {
  it("groups same-flavor single-pan and combined small-plus-large photos by flavor", () => {
    const extractedPhotos: ExtractedGelatoPhoto[] = [
      {
        fileName: "vanilla-pair.jpg",
        imageUrl: "/manus-storage/one",
        flavor: "Vanilla",
        smallPanCount: 1,
        largePanCount: 1,
        combinedGrossWeightKg: 3.95,
        confidence: "high",
        warning: "",
      },
      {
        fileName: "vanilla-large.jpg",
        imageUrl: "/manus-storage/two",
        flavor: "Vanilla",
        smallPanCount: 0,
        largePanCount: 1,
        combinedGrossWeightKg: 3.42,
        confidence: "high",
        warning: "",
      },
      {
        fileName: "chocolate-small.jpg",
        imageUrl: "/manus-storage/three",
        flavor: "Chocolate",
        smallPanCount: 1,
        largePanCount: 0,
        combinedGrossWeightKg: 1.52,
        confidence: "medium",
        warning: "",
      },
    ];

    expect(buildGroupedGelatoEntries(extractedPhotos)).toEqual([
      {
        flavor: "Chocolate",
        smallPanCount: 1,
        largePanCount: 0,
        combinedGrossWeightKg: 1.52,
      },
      {
        flavor: "Vanilla",
        smallPanCount: 1,
        largePanCount: 2,
        combinedGrossWeightKg: 7.37,
      },
    ]);
  });

  it("ignores unreadable photos until a user corrects them", () => {
    const extractedPhotos: ExtractedGelatoPhoto[] = [
      {
        fileName: "unclear.jpg",
        imageUrl: "/manus-storage/five",
        flavor: "Unknown flavor",
        smallPanCount: 0,
        largePanCount: 0,
        combinedGrossWeightKg: 0,
        confidence: "low",
        warning: "Scale display was not fully readable.",
      },
      {
        fileName: "mint-chip.jpg",
        imageUrl: "/manus-storage/six",
        flavor: "Mint Chip",
        smallPanCount: 1,
        largePanCount: 0,
        combinedGrossWeightKg: 1.11,
        confidence: "medium",
        warning: "",
      },
    ];

    expect(buildGroupedGelatoEntries(extractedPhotos)).toEqual([
      {
        flavor: "Mint Chip",
        smallPanCount: 1,
        largePanCount: 0,
        combinedGrossWeightKg: 1.11,
      },
    ]);
  });
});
