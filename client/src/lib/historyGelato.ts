export type SubmissionHistoryGelatoRow = {
  smallPanCount: number;
  smallGrossWeightKg: number;
  largePanCount: number;
  largeGrossWeightKg: number;
};

const KG_TO_WEIGHT_OUNCES = 35.27396195;
const SMALL_PAN_EMPTY_KG = 0.286;
const LARGE_PAN_EMPTY_KG = 0.4;
const SMALL_PAN_FULL_GROSS_KG = 3.5;
const LARGE_PAN_FULL_GROSS_KG = 4.5;
const SMALL_PAN_FULL_WEIGHT_OUNCES = (SMALL_PAN_FULL_GROSS_KG - SMALL_PAN_EMPTY_KG) * KG_TO_WEIGHT_OUNCES;
const LARGE_PAN_FULL_WEIGHT_OUNCES = (LARGE_PAN_FULL_GROSS_KG - LARGE_PAN_EMPTY_KG) * KG_TO_WEIGHT_OUNCES;
const SMALL_PAN_FULL_VOLUME_OUNCES = 112;
const LARGE_PAN_FULL_VOLUME_OUNCES = 160;

function roundTo(value: number, decimals = 1) {
  return Number(value.toFixed(decimals));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function estimateHistoryGelatoRowVolumeOunces(row: SubmissionHistoryGelatoRow) {
  const safeSmallPanCount = Math.max(0, Math.trunc(row.smallPanCount));
  const safeLargePanCount = Math.max(0, Math.trunc(row.largePanCount));
  const smallGrossWeightKg = Number.isFinite(row.smallGrossWeightKg) ? Math.max(0, row.smallGrossWeightKg) : 0;
  const largeGrossWeightKg = Number.isFinite(row.largeGrossWeightKg) ? Math.max(0, row.largeGrossWeightKg) : 0;

  const smallNetWeightKg = clamp(
    smallGrossWeightKg - safeSmallPanCount * SMALL_PAN_EMPTY_KG,
    0,
    safeSmallPanCount * (SMALL_PAN_FULL_WEIGHT_OUNCES / KG_TO_WEIGHT_OUNCES)
  );
  const largeNetWeightKg = clamp(
    largeGrossWeightKg - safeLargePanCount * LARGE_PAN_EMPTY_KG,
    0,
    safeLargePanCount * (LARGE_PAN_FULL_WEIGHT_OUNCES / KG_TO_WEIGHT_OUNCES)
  );

  const smallVolumeOunces = smallNetWeightKg * KG_TO_WEIGHT_OUNCES * (SMALL_PAN_FULL_VOLUME_OUNCES / SMALL_PAN_FULL_WEIGHT_OUNCES);
  const largeVolumeOunces = largeNetWeightKg * KG_TO_WEIGHT_OUNCES * (LARGE_PAN_FULL_VOLUME_OUNCES / LARGE_PAN_FULL_WEIGHT_OUNCES);

  return roundTo(smallVolumeOunces + largeVolumeOunces);
}

export function formatHistoryGelatoWeightLine(label: string, panCount: number, grossWeightKg: number, volumeOunces: number) {
  return `${label}: ${panCount} · ${grossWeightKg} kg · ${roundTo(volumeOunces)} oz volume`;
}

export function getHistoryGelatoRowVolumeBreakdown(row: SubmissionHistoryGelatoRow) {
  const safeSmallPanCount = Math.max(0, Math.trunc(row.smallPanCount));
  const safeLargePanCount = Math.max(0, Math.trunc(row.largePanCount));
  const smallOnlyVolume = estimateHistoryGelatoRowVolumeOunces({
    smallPanCount: safeSmallPanCount,
    smallGrossWeightKg: row.smallGrossWeightKg,
    largePanCount: 0,
    largeGrossWeightKg: 0,
  });
  const largeOnlyVolume = estimateHistoryGelatoRowVolumeOunces({
    smallPanCount: 0,
    smallGrossWeightKg: 0,
    largePanCount: safeLargePanCount,
    largeGrossWeightKg: row.largeGrossWeightKg,
  });

  return {
    smallVolumeOunces: smallOnlyVolume,
    largeVolumeOunces: largeOnlyVolume,
    totalVolumeOunces: roundTo(smallOnlyVolume + largeOnlyVolume),
  };
}
