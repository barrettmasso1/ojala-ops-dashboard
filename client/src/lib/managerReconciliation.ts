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
    totalVolumeOunces: number | null;
    combinedGrossWeightKg: number;
    registeredNetWeightKg?: number | null;
    volumeAvailable?: boolean;
    available?: boolean;
  };
  closing: {
    totalVolumeOunces: number | null;
    combinedGrossWeightKg: number;
    registeredNetWeightKg?: number | null;
    volumeAvailable?: boolean;
    available?: boolean;
  };
  usedVolumeOunces: number | null;
};

type PackagingItemSnapshot = {
  key: string;
  label: string;
  openingQuantity: number | null;
  closingQuantity: number | null;
  expectedUsed: number | null;
  actualUsed: number | null;
  variance: number | null;
  discrepancyLabel: string;
};

function summarizePackagingCounts(items: PackagingItemSnapshot[], hasPendingCounts: boolean) {
  return {
    openingCount: items.length > 0 && items.every(item => item.openingQuantity != null)
      ? roundTo(items.reduce((sum, item) => sum + (item.openingQuantity ?? 0), 0))
      : null,
    soldCount: items.length > 0 && items.every(item => item.expectedUsed != null)
      ? roundTo(items.reduce((sum, item) => sum + (item.expectedUsed ?? 0), 0))
      : null,
    closingCount: hasPendingCounts ? null : roundTo(items.reduce((sum, item) => sum + (item.closingQuantity ?? 0), 0)),
    distributedCount: hasPendingCounts ? null : roundTo(items.reduce((sum, item) => sum + (item.actualUsed ?? 0), 0)),
    differenceCount: hasPendingCounts ? null : roundTo(items.reduce((sum, item) => sum + (item.variance ?? 0), 0)),
  };
}

type DailySnapshotLike = {
  gelato: {
    openingVolumeOunces: number | null;
    closingVolumeOunces: number | null;
    actualDistributedVolumeOunces: number | null;
    soldVolumeOunces: number | null;
    varianceVolumeOunces: number | null;
    discrepancyLabel: string;
    flavors: GelatoFlavorSnapshot[];
  };
  packaging: {
    varianceCount: number | null;
    discrepancyLabel: string;
    items: PackagingItemSnapshot[];
  };
  dataAvailability?: {
    salesReport: "missing" | "partial" | "complete";
    gelatoOpening: "missing" | "partial" | "complete";
    gelatoClosing: "missing" | "partial" | "complete";
    gelatoReconciliation: "missing" | "partial" | "complete";
    packagingOpening: "missing" | "partial" | "complete";
    packagingClosing: "missing" | "partial" | "complete";
    packagingReconciliation: "missing" | "partial" | "complete";
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
  const packagingHasPendingCounts = packagingItems.some(item => item.openingQuantity == null || item.expectedUsed == null || item.actualUsed == null || item.closingQuantity == null || item.variance == null);
  const packagingCounts = summarizePackagingCounts(packagingItems, packagingHasPendingCounts);
  const cupPackagingItems = packagingItems.filter(item => item.key.startsWith("cups"));
  const cupPackagingCounts = summarizePackagingCounts(cupPackagingItems, packagingHasPendingCounts);

  const availability = daily.dataAvailability;
  const completeGelato = availability ? availability.gelatoReconciliation === "complete" : true;
  const completeSales = availability ? availability.salesReport === "complete" : true;
  const completePackagingOpening = availability ? availability.packagingOpening === "complete" : true;
  const completePackagingClosing = availability ? availability.packagingClosing === "complete" : true;
  const completePackaging = availability ? availability.packagingReconciliation === "complete" : true;

  return {
    gelato: {
      openingVolumeOunces: availability && availability.gelatoOpening !== "complete" ? null : daily.gelato.openingVolumeOunces == null ? null : roundTo(daily.gelato.openingVolumeOunces),
      closingVolumeOunces: availability && availability.gelatoClosing !== "complete" ? null : daily.gelato.closingVolumeOunces == null ? null : roundTo(daily.gelato.closingVolumeOunces),
      distributedVolumeOunces: availability && !completeGelato ? null : daily.gelato.actualDistributedVolumeOunces == null ? null : roundTo(daily.gelato.actualDistributedVolumeOunces),
      soldVolumeOunces: availability && !completeSales ? null : daily.gelato.soldVolumeOunces == null ? null : roundTo(daily.gelato.soldVolumeOunces),
      differenceVolumeOunces: availability && (!completeGelato || !completeSales) ? null : daily.gelato.varianceVolumeOunces == null ? null : roundTo(daily.gelato.varianceVolumeOunces),
      goalVolumeOunces: 0,
      discrepancyLabel: daily.gelato.discrepancyLabel,
      flavors: daily.gelato.flavors.map(item => ({
        ...item,
        opening: { ...item.opening, totalVolumeOunces: item.opening.totalVolumeOunces == null ? null : roundTo(item.opening.totalVolumeOunces) },
        closing: { ...item.closing, totalVolumeOunces: item.closing.totalVolumeOunces == null ? null : roundTo(item.closing.totalVolumeOunces) },
      })),
    },
    packaging: {
      ...packagingCounts,
      toGoCupOpeningCount: cupPackagingCounts.openingCount,
      toGoCupClosingCount: cupPackagingCounts.closingCount,
      toGoCupUsedCount: cupPackagingCounts.distributedCount,
      toGoCupSoldCount: cupPackagingCounts.soldCount,
      toGoCupDifferenceCount: cupPackagingCounts.differenceCount,
      openingCount: completePackagingOpening ? packagingCounts.openingCount : null,
      closingCount: completePackagingClosing ? packagingCounts.closingCount : null,
      distributedCount: completePackaging ? packagingCounts.distributedCount : null,
      soldCount: completeSales ? packagingCounts.soldCount : null,
      differenceCount: completePackaging ? packagingCounts.differenceCount : null,
      goalCount: 0,
      discrepancyLabel: daily.packaging.discrepancyLabel,
      hasPendingCounts: packagingHasPendingCounts,
      items: packagingItems,
    },
  };
}
