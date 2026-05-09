import { describe, expect, it } from "vitest";
import {
  applyAnalyzedPhotoPanSetup,
  applyAnalyzedPhotosToGelatoState,
  GELATO_PHOTO_UPLOAD_LIMIT,
  GELATO_WEIGHT_INPUT_MODE,
  GELATO_WEIGHT_INPUT_STEP,
  getAnalyzedPhotoPanSetup,
  limitGelatoPhotoBatch,
  estimateAnalyzedPhotoNetWeightKg,
  estimateAnalyzedPhotoVolumeOunces,
  getAnalyzedPhotoCombinedGrossWeightKg,
  getAnalyzedPhotoPanTareKg,
  removePhotoAtIndex,
  replaceAnalyzedPhotosInGelatoState,
  resolveAnalyzedPhotoGrossWeights,
  summarizeAnalyzedPhotosForSubmission,
} from "./EmployeePortal";
import { getReplacementConfirmationMessage, getResubmissionReplacementDescription } from "@/lib/submissionReplacement";

describe("employee portal gelato helpers", () => {
  it("describes opening resubmissions as replacements instead of additive duplicates", () => {
    expect(getResubmissionReplacementDescription("opening")).toBe(
      "Submitting again for this business date replaces the previous opening record instead of adding a duplicate."
    );
  });

  it("builds a replacement confirmation prompt for same-day opening resubmissions", () => {
    expect(getReplacementConfirmationMessage("opening")).toBe(
      "Replace existing submission?\n\nAn opening submission already exists for this business date. Do you want to replace it with this new opening form?"
    );
  });

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

  it("maps photo-review pan setup selections back to single-pan, same-size two-pan, and mixed-pan counts", () => {
    expect(applyAnalyzedPhotoPanSetup("small")).toEqual({ smallPanCount: 1, largePanCount: 0 });
    expect(applyAnalyzedPhotoPanSetup("large")).toEqual({ smallPanCount: 0, largePanCount: 1 });
    expect(applyAnalyzedPhotoPanSetup("double_small")).toEqual({ smallPanCount: 2, largePanCount: 0 });
    expect(applyAnalyzedPhotoPanSetup("double_large")).toEqual({ smallPanCount: 0, largePanCount: 2 });
    expect(applyAnalyzedPhotoPanSetup("small_large")).toEqual({ smallPanCount: 1, largePanCount: 1 });
    expect(getAnalyzedPhotoPanSetup({ smallPanCount: 1, largePanCount: 0 })).toBe("small");
    expect(getAnalyzedPhotoPanSetup({ smallPanCount: 0, largePanCount: 1 })).toBe("large");
    expect(getAnalyzedPhotoPanSetup({ smallPanCount: 2, largePanCount: 0 })).toBe("double_small");
    expect(getAnalyzedPhotoPanSetup({ smallPanCount: 0, largePanCount: 2 })).toBe("double_large");
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

  it("summarizes analyzed photos by flavor for integrated photo-mode submission using combined weights", () => {
    const summarized = summarizeAnalyzedPhotosForSubmission([
      {
        fileName: "pb-small.jpg",
        imageUrl: "/pb-small",
        flavor: "Peanut Butter",
        smallPanCount: 1,
        largePanCount: 0,
        combinedGrossWeightKg: 1.61,
        confidence: "high",
        warning: "",
      },
      {
        fileName: "pb-large.jpg",
        imageUrl: "/pb-large",
        flavor: "Peanut Butter",
        smallPanCount: 0,
        largePanCount: 1,
        combinedGrossWeightKg: 3.74,
        confidence: "medium",
        warning: "",
      },
      {
        fileName: "blank.jpg",
        imageUrl: "/blank",
        flavor: "   ",
        smallPanCount: 1,
        largePanCount: 0,
        combinedGrossWeightKg: 1.2,
        confidence: "low",
        warning: "",
      },
    ]);

    expect(Array.from(summarized.keys())).toEqual(["Peanut Butter"]);
    expect(summarized.get("Peanut Butter")).toEqual({
      smallPanCount: 1,
      smallGrossWeightKg: 1.61,
      largePanCount: 1,
      largeGrossWeightKg: 3.74,
      combinedGrossWeightKg: 5.35,
    });
  });

  it("preserves raw decimal photo input like 6.02 while still parsing it for calculations", () => {
    expect(
      getAnalyzedPhotoCombinedGrossWeightKg({
        combinedGrossWeightKg: 6,
        combinedGrossWeightInput: "6.02",
      })
    ).toBe(6.02);

    expect(
      getAnalyzedPhotoCombinedGrossWeightKg({
        combinedGrossWeightKg: 6,
        combinedGrossWeightInput: "6,02",
      })
    ).toBe(6.02);
  });

  it("calculates pan tare, net gelato weight, and volume ounces for photo review cards", () => {
    const analyzedPhoto = {
      smallPanCount: 1,
      largePanCount: 1,
      combinedGrossWeightKg: 3.95,
    };

    expect(getAnalyzedPhotoPanTareKg(analyzedPhoto)).toBe(0.686);
    expect(estimateAnalyzedPhotoNetWeightKg(analyzedPhoto)).toBe(3.264);
    expect(estimateAnalyzedPhotoVolumeOunces(analyzedPhoto)).toBeGreaterThan(120);
    expect(estimateAnalyzedPhotoVolumeOunces(analyzedPhoto)).toBeLessThan(200);
  });
});
