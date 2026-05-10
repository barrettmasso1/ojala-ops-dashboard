export type ManagerInventoryView = "product" | "utensils" | "ingredients" | "reconciliation";

export const MANAGER_INVENTORY_TABS: Array<{ key: ManagerInventoryView; label: string }> = [
  { key: "product", label: "Product inventory" },
  { key: "utensils", label: "Utensil inventory" },
  { key: "ingredients", label: "Ingredient inventory" },
  { key: "reconciliation", label: "Reconciliation" },
];

type GelatoFlavorSnapshot = {
  flavor: string;
  opening: {
    totalVolumeOunces: number;
    combinedGrossWeightKg: number;
  };
  closing: {
    totalVolumeOunces: number;
    combinedGrossWeightKg: number;
  };
  usedVolumeOunces: number;
};

type PackagingItemSnapshot = {
  key: string;
  label: string;
  openingQuantity: number;
  closingQuantity: number | null;
  expectedUsed: number;
  actualUsed: number | null;
  variance: number | null;
  discrepancyLabel: string;
};

function summarizePackagingCounts(items: PackagingItemSnapshot[], hasPendingCounts: boolean) {
  return {
    openingCount: roundTo(items.reduce((sum, item) => sum + item.openingQuantity, 0)),
    soldCount: roundTo(items.reduce((sum, item) => sum + item.expectedUsed, 0)),
    closingCount: hasPendingCounts ? null : roundTo(items.reduce((sum, item) => sum + (item.closingQuantity ?? 0), 0)),
    distributedCount: hasPendingCounts ? null : roundTo(items.reduce((sum, item) => sum + (item.actualUsed ?? 0), 0)),
    differenceCount: hasPendingCounts ? null : roundTo(items.reduce((sum, item) => sum + (item.variance ?? 0), 0)),
  };
}

type DailySnapshotLike = {
  gelato: {
    openingVolumeOunces: number;
    closingVolumeOunces: number;
    actualDistributedVolumeOunces: number;
    soldVolumeOunces: number;
    varianceVolumeOunces: number;
    discrepancyLabel: string;
    flavors: GelatoFlavorSnapshot[];
  };
  packaging: {
    varianceCount: number | null;
    discrepancyLabel: string;
    items: PackagingItemSnapshot[];
  };
};

function roundTo(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

export function buildManagerReconciliationSnapshot(daily?: DailySnapshotLike | null) {
  if (!daily) {
    return {
      gelato: null,
      packaging: null,
    };
  }

  const packagingItems = daily.packaging.items ?? [];
  const packagingHasPendingCounts = packagingItems.some(item => item.actualUsed == null || item.closingQuantity == null || item.variance == null);
  const packagingCounts = summarizePackagingCounts(packagingItems, packagingHasPendingCounts);
  const cupPackagingItems = packagingItems.filter(item => item.key.startsWith("cups"));
  const cupPackagingCounts = summarizePackagingCounts(cupPackagingItems, packagingHasPendingCounts);

  return {
    gelato: {
      openingVolumeOunces: roundTo(daily.gelato.openingVolumeOunces),
      closingVolumeOunces: roundTo(daily.gelato.closingVolumeOunces),
      distributedVolumeOunces: roundTo(daily.gelato.actualDistributedVolumeOunces),
      soldVolumeOunces: roundTo(daily.gelato.soldVolumeOunces),
      differenceVolumeOunces: roundTo(daily.gelato.varianceVolumeOunces),
      goalVolumeOunces: 0,
      discrepancyLabel: daily.gelato.discrepancyLabel,
      flavors: daily.gelato.flavors,
    },
    packaging: {
      ...packagingCounts,
      toGoCupOpeningCount: cupPackagingCounts.openingCount,
      toGoCupClosingCount: cupPackagingCounts.closingCount,
      toGoCupUsedCount: cupPackagingCounts.distributedCount,
      toGoCupSoldCount: cupPackagingCounts.soldCount,
      toGoCupDifferenceCount: cupPackagingCounts.differenceCount,
      goalCount: 0,
      discrepancyLabel: daily.packaging.discrepancyLabel,
      hasPendingCounts: packagingHasPendingCounts,
      items: packagingItems,
    },
  };
}
