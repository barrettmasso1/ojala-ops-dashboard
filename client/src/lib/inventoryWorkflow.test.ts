import { describe, expect, it } from "vitest";

import { getPendingInventorySaves } from "./inventoryWorkflow";

describe("inventory workflow helper", () => {
  it("returns only the inventory rows whose quantities actually changed", () => {
    const result = getPendingInventorySaves(
      [
        { id: 1, currentQuantity: 5 },
        { id: 2, currentQuantity: 8 },
        { id: 3, currentQuantity: 0 },
      ],
      {
        1: { currentQuantity: "5.00" },
        2: { currentQuantity: "10" },
        3: { currentQuantity: "" },
      }
    );

    expect(result).toEqual([{ id: 2, currentQuantity: 10 }]);
  });

  it("treats blank edited values as zero when deciding what still needs saving", () => {
    const result = getPendingInventorySaves(
      [{ id: 9, currentQuantity: 3 }],
      { 9: { currentQuantity: "" } }
    );

    expect(result).toEqual([{ id: 9, currentQuantity: 0 }]);
  });
});
