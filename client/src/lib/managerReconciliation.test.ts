import { describe, expect, it } from "vitest";
import { buildManagerReconciliationSnapshot, MANAGER_INVENTORY_TABS } from "./managerReconciliation";

describe("manager reconciliation helper", () => {
  it("exposes the dedicated reconciliation tab alongside the existing inventory views", () => {
    expect(MANAGER_INVENTORY_TABS).toEqual([
      { key: "product", label: "Product inventory" },
      { key: "utensils", label: "Utensil inventory" },
      { key: "ingredients", label: "Ingredient inventory" },
      { key: "reconciliation", label: "Reconciliation" },
    ]);
  });

  it("summarizes opening-minus-closing-minus-sold values for gelato and packaging", () => {
    const snapshot = buildManagerReconciliationSnapshot({
      gelato: {
        openingVolumeOunces: 209.53,
        closingVolumeOunces: 40.12,
        actualDistributedVolumeOunces: 169.41,
        soldVolumeOunces: 168,
        varianceVolumeOunces: 1.41,
        discrepancyLabel: "Sample / minor discrepancy",
        flavors: [
          {
            flavor: "Vanilla",
            opening: { totalVolumeOunces: 209.53 },
            closing: { totalVolumeOunces: 40.12 },
            usedVolumeOunces: 169.41,
          },
        ],
      },
      packaging: {
        varianceCount: 1,
        discrepancyLabel: "Minor discrepancy",
        items: [
          {
            key: "cups8oz",
            label: "8oz Cups",
            openingQuantity: 40,
            closingQuantity: 18,
            expectedUsed: 21,
            actualUsed: 22,
            variance: 1,
            discrepancyLabel: "Minor discrepancy",
          },
          {
            key: "lids8oz",
            label: "8oz Lids",
            openingQuantity: 40,
            closingQuantity: 18,
            expectedUsed: 21,
            actualUsed: 22,
            variance: 1,
            discrepancyLabel: "Minor discrepancy",
          },
        ],
      },
    });

    expect(snapshot.gelato).toMatchObject({
      openingVolumeOunces: 209.53,
      closingVolumeOunces: 40.12,
      distributedVolumeOunces: 169.41,
      soldVolumeOunces: 168,
      differenceVolumeOunces: 1.41,
      goalVolumeOunces: 0,
    });

    expect(snapshot.packaging).toMatchObject({
      openingCount: 80,
      closingCount: 36,
      distributedCount: 44,
      soldCount: 42,
      differenceCount: 2,
      toGoCupOpeningCount: 40,
      toGoCupClosingCount: 18,
      toGoCupUsedCount: 22,
      toGoCupSoldCount: 21,
      toGoCupDifferenceCount: 1,
      goalCount: 0,
      hasPendingCounts: false,
    });
  });

  it("keeps packaging totals pending until all closing counts exist", () => {
    const snapshot = buildManagerReconciliationSnapshot({
      gelato: {
        openingVolumeOunces: 0,
        closingVolumeOunces: 0,
        actualDistributedVolumeOunces: 0,
        soldVolumeOunces: 0,
        varianceVolumeOunces: 0,
        discrepancyLabel: "Aligned",
        flavors: [],
      },
      packaging: {
        varianceCount: null,
        discrepancyLabel: "Awaiting same-day closing inventory count",
        items: [
          {
            key: "cups4oz",
            label: "4oz Cups",
            openingQuantity: 20,
            closingQuantity: null,
            expectedUsed: 8,
            actualUsed: null,
            variance: null,
            discrepancyLabel: "Awaiting same-day closing inventory count",
          },
        ],
      },
    });

    expect(snapshot.packaging).toMatchObject({
      openingCount: 20,
      closingCount: null,
      distributedCount: null,
      soldCount: 8,
      differenceCount: null,
      toGoCupOpeningCount: 20,
      toGoCupClosingCount: null,
      toGoCupUsedCount: null,
      toGoCupSoldCount: 8,
      toGoCupDifferenceCount: null,
      hasPendingCounts: true,
    });
  });
});
