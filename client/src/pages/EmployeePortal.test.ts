import { describe, expect, it } from "vitest";
import {
  applyAnalyzedPhotoPanSetup,
  applyAnalyzedPhotosToGelatoState,
  GELATO_PHOTO_UPLOAD_LIMIT,
  GELATO_WEIGHT_INPUT_MODE,
  GELATO_WEIGHT_INPUT_STEP,
  getAnalyzedPhotoPanSetup,
  limitGelatoPhotoBatch,
  removePhotoAtIndex,
  replaceAnalyzedPhotosInGelatoState,
  resolveAnalyzedPhotoGrossWeights,
} from "./EmployeePortal";

describe("employee portal gelato helpers", () => {
  it("accepts three-decimal kilogram entries for ready-made gelato weights", () => {
    expect(GELATO_WEIGHT_INPUT_STEP).toBe("0.001");
    expect(GELATO_WEIGHT_INPUT_MODE).toBe("decimal");
  });

  it("splits a combined analyzed photo weight across small and large pans", () => {
    const resolved = resolveAnalyzedPhotoGrossWeights({
      smallPanCount: 1,
      largePanCount: 1,
      combinedGrossWeightKg: 3.95,
    });

    expect(resolved.smallPanCount).toBe(1);
    expect(resolved.largePanCount).toBe(1);
    expect(resolved.smallGrossWeightKg).toBeGreaterThan(0.28);
    expect(resolved.largeGrossWeightKg).toBeGreaterThan(0.4);
    expect(Number((resolved.smallGrossWeightKg + resolved.largeGrossWeightKg).toFixed(3))).toBe(3.95);
  });

  it("caps the client-side gelato photo batch to the configured upload limit", () => {
    const files = Array.from({ length: GELATO_PHOTO_UPLOAD_LIMIT + 3 }, (_, index) => `photo-${index + 1}`);

    expect(limitGelatoPhotoBatch(files)).toHaveLength(GELATO_PHOTO_UPLOAD_LIMIT);
    expect(limitGelatoPhotoBatch(files).at(-1)).toBe(`photo-${GELATO_PHOTO_UPLOAD_LIMIT}`);
  });

  it("removes a selected or analyzed photo by index without disturbing the remaining order", () => {
    expect(removePhotoAtIndex(["one.jpg", "two.jpg", "three.jpg"], 1)).toEqual(["one.jpg", "three.jpg"]);
    expect(removePhotoAtIndex(["one.jpg"], 0)).toEqual([]);
  });

  it("maps photo-review pan setup selections back to single-pan and paired-pan counts", () => {
    expect(applyAnalyzedPhotoPanSetup("small")).toEqual({ smallPanCount: 1, largePanCount: 0 });
    expect(applyAnalyzedPhotoPanSetup("large")).toEqual({ smallPanCount: 0, largePanCount: 1 });
    expect(applyAnalyzedPhotoPanSetup("small_large")).toEqual({ smallPanCount: 1, largePanCount: 1 });
    expect(getAnalyzedPhotoPanSetup({ smallPanCount: 1, largePanCount: 0 })).toBe("small");
    expect(getAnalyzedPhotoPanSetup({ smallPanCount: 0, largePanCount: 1 })).toBe("large");
    expect(getAnalyzedPhotoPanSetup({ smallPanCount: 1, largePanCount: 1 })).toBe("small_large");
  });

  it("applies analyzed photo results into the existing portal flavor state and creates new flavors when needed", () => {
    const state = {
      businessDate: "2026-04-28",
      flavors: {
        "Ruby Port": {
          opening: {
            smallPanCount: "",
            smallGrossWeightKg: "",
            largePanCount: "",
            largeGrossWeightKg: "",
          },
          closing: {
            smallPanCount: "",
            smallGrossWeightKg: "",
            largePanCount: "",
            largeGrossWeightKg: "",
          },
        },
      },
    };

    const next = applyAnalyzedPhotosToGelatoState(state, "opening", [
      {
        fileName: "IMG_1.jpg",
        imageUrl: "/one",
        flavor: "Ruby Port",
        smallPanCount: 1,
        largePanCount: 0,
        combinedGrossWeightKg: 1.47,
        confidence: "high",
        warning: "",
      },
      {
        fileName: "IMG_2.jpg",
        imageUrl: "/two",
        flavor: "Chocolate",
        smallPanCount: 0,
        largePanCount: 1,
        combinedGrossWeightKg: 3.1,
        confidence: "medium",
        warning: "",
      },
    ]);

    expect(next.flavors["Ruby Port"].opening.smallPanCount).toBe("1");
    expect(next.flavors["Ruby Port"].opening.smallGrossWeightKg).toBe("1.47");
    expect(next.flavors["Chocolate"].opening.largePanCount).toBe("1");
    expect(Number(next.flavors["Chocolate"].opening.largeGrossWeightKg)).toBeGreaterThan(3);
    expect(next.flavors["Chocolate"].closing.largePanCount).toBe("");
  });

  it("replaces photo-derived shift values so stale manual rows do not stay hidden behind photo mode", () => {
    const state = {
      businessDate: "2026-05-02",
      flavors: {
        Vanilla: {
          opening: {
            smallPanCount: "2",
            smallGrossWeightKg: "2.84",
            largePanCount: "1",
            largeGrossWeightKg: "3.15",
          },
          closing: {
            smallPanCount: "",
            smallGrossWeightKg: "",
            largePanCount: "",
            largeGrossWeightKg: "",
          },
        },
        Chocolate: {
          opening: {
            smallPanCount: "1",
            smallGrossWeightKg: "1.48",
            largePanCount: "",
            largeGrossWeightKg: "",
          },
          closing: {
            smallPanCount: "",
            smallGrossWeightKg: "",
            largePanCount: "",
            largeGrossWeightKg: "",
          },
        },
      },
    };

    const next = replaceAnalyzedPhotosInGelatoState(state, "opening", [
      {
        fileName: "vanilla.jpg",
        imageUrl: "/vanilla",
        flavor: "Vanilla",
        smallPanCount: 1,
        largePanCount: 0,
        combinedGrossWeightKg: 1.52,
        confidence: "high",
        warning: "",
      },
    ]);

    expect(next.flavors.Vanilla.opening.smallPanCount).toBe("1");
    expect(next.flavors.Vanilla.opening.largePanCount).toBe("");
    expect(next.flavors.Chocolate.opening.smallPanCount).toBe("");
    expect(next.flavors.Chocolate.opening.smallGrossWeightKg).toBe("");
  });
});
