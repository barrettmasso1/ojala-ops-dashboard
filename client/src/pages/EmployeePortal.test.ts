import { describe, expect, it } from "vitest";
import { GELATO_WEIGHT_INPUT_MODE, GELATO_WEIGHT_INPUT_STEP } from "./EmployeePortal";

describe("employee portal gelato weight input settings", () => {
  it("accepts three-decimal kilogram entries for ready-made gelato weights", () => {
    expect(GELATO_WEIGHT_INPUT_STEP).toBe("0.001");
    expect(GELATO_WEIGHT_INPUT_MODE).toBe("decimal");
  });
});
