import { describe, expect, it } from "vitest";
import {
  applyAnalyzedPhotosToGelatoState,
  GELATO_WEIGHT_INPUT_MODE,
  GELATO_WEIGHT_INPUT_STEP,
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
});
