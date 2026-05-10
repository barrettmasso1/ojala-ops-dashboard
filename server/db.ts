import { and, count, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  checklistQuestions,
  closingChecklists,
  endOfDayReports,
  InsertChecklistQuestion,
  InsertClosingChecklist,
  InsertEndOfDayReport,
  InsertOpeningChecklist,
  InsertRecipe,
  InsertRecipeIngredient,
  InsertReadyMadeGelatoWeight,
  InsertStaffAttendance,
  InsertSubmissionHistoryEntry,
  InsertUser,
  inventoryItems,
  openingChecklists,
  readyMadeGelatoWeights,
  recipeIngredients,
  recipes,
  staffAttendance,
  submissionHistoryEntries,
  users,
} from "../drizzle/schema";
import { PACIFIC_TIME_ZONE, getPacificBusinessDate, getPacificSundayWeekStart, getPacificWeekStart, isFuturePacificBusinessDate } from "../shared/businessDate";
import { DEFAULT_INVENTORY_ITEMS, DEFAULT_RECIPE_ITEMS, READY_MADE_GELATO_FLAVORS } from "../shared/opsCatalog";
import { ENV } from "./_core/env";
import { storageGetSignedUrl } from "./storage";

let _db: ReturnType<typeof drizzle> | null = null;

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const normalized = value.trim().replace(/,/g, ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeDate(date?: string) {
  const normalized = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getPacificBusinessDate();
  if (isFuturePacificBusinessDate(normalized)) {
    throw new Error("Future business dates are not allowed.");
  }
  return normalized;
}

const KG_TO_WEIGHT_OUNCES = 35.27396195;
const SMALL_PAN_EMPTY_KG = 0.286;
const LARGE_PAN_EMPTY_KG = 0.4;
const SMALL_PAN_FULL_GROSS_KG = 3.5;
const LARGE_PAN_FULL_GROSS_KG = 4.5;
const SMALL_PAN_MAX_GROSS_KG = 4;
const LARGE_PAN_MAX_GROSS_KG = 5;
const SMALL_PAN_FULL_WEIGHT_OUNCES = (SMALL_PAN_FULL_GROSS_KG - SMALL_PAN_EMPTY_KG) * KG_TO_WEIGHT_OUNCES;
const LARGE_PAN_FULL_WEIGHT_OUNCES = (LARGE_PAN_FULL_GROSS_KG - LARGE_PAN_EMPTY_KG) * KG_TO_WEIGHT_OUNCES;
const SMALL_PAN_FULL_VOLUME_OUNCES = 112;
const LARGE_PAN_FULL_VOLUME_OUNCES = 160;
const MINOR_GELATO_DISCREPANCY_VOLUME_OUNCES = 8;
const MINOR_SERVICE_ITEM_DISCREPANCY_COUNT = 2;
const AUTO_CLOCK_OUT_HOUR_PACIFIC = 22;
const AWAITING_CLOSING_FORM_LABEL = "Awaiting closing form";
const AWAITING_SAME_DAY_CLOSING_COUNT_LABEL = "Awaiting same-day closing inventory count";
const READY_MADE_GELATO_FLAVOR_POSITION = new Map(READY_MADE_GELATO_FLAVORS.map((flavor, index) => [normalizeKey(flavor), index]));

type ReadyMadeShiftType = "opening" | "closing";
type SubmissionHistoryType = "opening" | "closing" | "inventory";
type StaffAttendanceName = "Karol" | "Anhec" | "Jesse" | "Esme";

export const STAFF_ATTENDANCE_NAMES: StaffAttendanceName[] = ["Karol", "Anhec", "Jesse", "Esme"];

type StaffAttendanceRecord = {
  id: number;
  businessDate: string;
  staffName: StaffAttendanceName;
  clockInAt: number;
  clockOutAt: number | null;
  submittedByUserId: number;
  createdAt: Date;
  updatedAt: Date;
};

export type StaffAttendanceStatus = {
  staffName: StaffAttendanceName;
  isClockedIn: boolean;
  activeEntry: StaffAttendanceRecord | null;
  latestEntry: StaffAttendanceRecord | null;
  todayEntries: StaffAttendanceRecord[];
  totalHoursToday: number;
};

export type WeeklyAttendanceSummaryRow = {
  businessDate: string;
  hours: number;
  shiftCount: number;
  openShiftCount: number;
};

export type WeeklyAttendanceSummary = {
  startDate: string;
  endDate: string;
  staff: Array<{
    staffName: StaffAttendanceName;
    weeklyHours: number;
    totalShiftCount: number;
    openShiftCount: number;
    dailyHours: WeeklyAttendanceSummaryRow[];
  }>;
};

export type TimeBookAttendanceEntry = StaffAttendanceRecord & {
  hoursWorked: number;
};

export type TimeBookAttendanceDay = {
  businessDate: string;
  totalHours: number;
  shiftCount: number;
  openShiftCount: number;
  entries: TimeBookAttendanceEntry[];
};

export type TimeBookAttendanceSummary = {
  startDate: string;
  endDate: string;
  totalHours: number;
  totalShiftCount: number;
  openShiftCount: number;
  dailyTotals: Array<{
    businessDate: string;
    totalHours: number;
    shiftCount: number;
    openShiftCount: number;
  }>;
  staff: Array<{
    staffName: StaffAttendanceName;
    totalHours: number;
    totalShiftCount: number;
    openShiftCount: number;
    dailyLogs: TimeBookAttendanceDay[];
  }>;
};

function safeParseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

type ReadyMadeMeasurementRow = {
  id?: number;
  businessDate?: string;
  flavor?: string;
  shiftType?: ReadyMadeShiftType;
  smallPanCount?: number | string | null;
  smallGrossWeightKg?: number | string | null;
  largePanCount?: number | string | null;
  largeGrossWeightKg?: number | string | null;
  combinedGrossWeightKg?: number | string | null;
  weightKg?: number | string | null;
  submittedByUserId?: number | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
};

type OpeningStockCountsSummary = {
  cups4oz: number;
  cups8oz: number;
  cupsPint: number;
  cupsLiter: number;
  lids4oz: number;
  lids8oz: number;
  lidsPint: number;
  lidsLiter: number;
  spoons: number;
};

function roundTo(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function convertKgToWeightOunces(weightKg: number) {
  return weightKg * KG_TO_WEIGHT_OUNCES;
}

function convertSalesToVolumeOunces(cups: { cups4oz: number; cups8oz: number; cupsPint: number; cupsLiter: number }) {
  return cups.cups4oz * 4 + cups.cups8oz * 8 + cups.cupsPint * 16 + cups.cupsLiter * 32;
}

function shouldResolveReadyMadeFromCombinedGrossWeight(row?: ReadyMadeMeasurementRow) {
  const providedSmallGrossWeightKg = Math.max(0, toNumber(row?.smallGrossWeightKg));
  const providedLargeGrossWeightKg = Math.max(0, toNumber(row?.largeGrossWeightKg));
  const combinedGrossWeightKg = Math.max(0, toNumber(row?.combinedGrossWeightKg));
  return combinedGrossWeightKg > 0 && providedSmallGrossWeightKg <= 0 && providedLargeGrossWeightKg <= 0;
}

export function resolveReadyMadeGrossWeights(row?: ReadyMadeMeasurementRow) {
  const smallPanCount = Math.max(0, Math.trunc(toNumber(row?.smallPanCount)));
  const largePanCount = Math.max(0, Math.trunc(toNumber(row?.largePanCount)));
  const providedSmallGrossWeightKg = Math.max(0, toNumber(row?.smallGrossWeightKg));
  const providedLargeGrossWeightKg = Math.max(0, toNumber(row?.largeGrossWeightKg));
  const combinedGrossWeightKg = Math.max(0, toNumber(row?.combinedGrossWeightKg));

  if (!shouldResolveReadyMadeFromCombinedGrossWeight(row)) {
    return {
      smallGrossWeightKg: providedSmallGrossWeightKg,
      largeGrossWeightKg: providedLargeGrossWeightKg,
      combinedGrossWeightKg: roundTo(providedSmallGrossWeightKg + providedLargeGrossWeightKg),
    };
  }

  if (combinedGrossWeightKg <= 0) {
    return {
      smallGrossWeightKg: providedSmallGrossWeightKg,
      largeGrossWeightKg: providedLargeGrossWeightKg,
      combinedGrossWeightKg: roundTo(providedSmallGrossWeightKg + providedLargeGrossWeightKg),
    };
  }

  if (smallPanCount > 0 && largePanCount === 0) {
    return {
      smallGrossWeightKg: roundTo(combinedGrossWeightKg),
      largeGrossWeightKg: 0,
      combinedGrossWeightKg: roundTo(combinedGrossWeightKg),
    };
  }

  if (largePanCount > 0 && smallPanCount === 0) {
    return {
      smallGrossWeightKg: 0,
      largeGrossWeightKg: roundTo(combinedGrossWeightKg),
      combinedGrossWeightKg: roundTo(combinedGrossWeightKg),
    };
  }

  if (smallPanCount === 0 && largePanCount === 0) {
    return {
      smallGrossWeightKg: providedSmallGrossWeightKg,
      largeGrossWeightKg: providedLargeGrossWeightKg,
      combinedGrossWeightKg: roundTo(combinedGrossWeightKg),
    };
  }

  const totalNetWeightKg = Math.max(
    0,
    combinedGrossWeightKg - smallPanCount * SMALL_PAN_EMPTY_KG - largePanCount * LARGE_PAN_EMPTY_KG
  );
  const smallCapacityWeightKg =
    smallPanCount * (SMALL_PAN_FULL_WEIGHT_OUNCES / KG_TO_WEIGHT_OUNCES);
  const largeCapacityWeightKg =
    largePanCount * (LARGE_PAN_FULL_WEIGHT_OUNCES / KG_TO_WEIGHT_OUNCES);
  const totalCapacityWeightKg = smallCapacityWeightKg + largeCapacityWeightKg;
  const smallNetWeightKg =
    totalCapacityWeightKg > 0
      ? totalNetWeightKg * (smallCapacityWeightKg / totalCapacityWeightKg)
      : 0;
  const largeNetWeightKg = Math.max(0, totalNetWeightKg - smallNetWeightKg);

  return {
    smallGrossWeightKg: roundTo(smallPanCount * SMALL_PAN_EMPTY_KG + smallNetWeightKg),
    largeGrossWeightKg: roundTo(largePanCount * LARGE_PAN_EMPTY_KG + largeNetWeightKg),
    combinedGrossWeightKg: roundTo(combinedGrossWeightKg),
  };
}

function getReadyMadeGrossWeightToleranceKg(smallPanCount: number, largePanCount: number) {
  const totalPanCount = smallPanCount + largePanCount;
  if (totalPanCount <= 0) return 0.03;
  return roundTo(0.03 + totalPanCount * 0.08);
}

function clampGrossWeightToCapacity(grossWeightKg: number, panCount: number, maxGrossPerPanKg: number, toleranceKg = 0) {
  if (panCount <= 0) return 0;
  return Math.min(Math.max(0, grossWeightKg), roundTo(panCount * maxGrossPerPanKg + toleranceKg));
}

export function hasImpossibleReadyMadeGrossWeights(row?: ReadyMadeMeasurementRow) {
  const smallPanCount = Math.max(0, Math.trunc(toNumber(row?.smallPanCount)));
  const largePanCount = Math.max(0, Math.trunc(toNumber(row?.largePanCount)));
  const resolvedWeights = resolveReadyMadeGrossWeights(row);
  const maxSmallGrossWeightKg = roundTo(smallPanCount * SMALL_PAN_MAX_GROSS_KG);
  const maxLargeGrossWeightKg = roundTo(largePanCount * LARGE_PAN_MAX_GROSS_KG);
  const maxCombinedGrossWeightKg = roundTo(maxSmallGrossWeightKg + maxLargeGrossWeightKg);
  const toleranceKg = getReadyMadeGrossWeightToleranceKg(smallPanCount, largePanCount);
  const shouldValidateCombinedGrossWeight = shouldResolveReadyMadeFromCombinedGrossWeight(row);

  return (
    resolvedWeights.smallGrossWeightKg > maxSmallGrossWeightKg + toleranceKg ||
    resolvedWeights.largeGrossWeightKg > maxLargeGrossWeightKg + toleranceKg ||
    (shouldValidateCombinedGrossWeight && resolvedWeights.combinedGrossWeightKg > maxCombinedGrossWeightKg + toleranceKg)
  );
}

function calculateReadyMadeMeasurement(row?: ReadyMadeMeasurementRow, defaultShiftType: ReadyMadeShiftType = "opening") {
  const smallPanCount = Math.max(0, Math.trunc(toNumber(row?.smallPanCount)));
  const largePanCount = Math.max(0, Math.trunc(toNumber(row?.largePanCount)));
  const resolvedWeights = resolveReadyMadeGrossWeights(row);
  const toleranceKg = getReadyMadeGrossWeightToleranceKg(smallPanCount, largePanCount);
  const smallGrossWeightKg = clampGrossWeightToCapacity(resolvedWeights.smallGrossWeightKg, smallPanCount, SMALL_PAN_MAX_GROSS_KG, toleranceKg);
  const largeGrossWeightKg = clampGrossWeightToCapacity(resolvedWeights.largeGrossWeightKg, largePanCount, LARGE_PAN_MAX_GROSS_KG, toleranceKg);
  const combinedGrossWeightKg = roundTo(smallGrossWeightKg + largeGrossWeightKg);
  const smallNetWeightKg = Math.max(0, smallGrossWeightKg - smallPanCount * SMALL_PAN_EMPTY_KG);
  const largeNetWeightKg = Math.max(0, largeGrossWeightKg - largePanCount * LARGE_PAN_EMPTY_KG);
  const totalNetWeightKg = roundTo(smallNetWeightKg + largeNetWeightKg);
  const smallWeightOunces = convertKgToWeightOunces(smallNetWeightKg);
  const largeWeightOunces = convertKgToWeightOunces(largeNetWeightKg);
  const totalWeightOunces = roundTo(smallWeightOunces + largeWeightOunces);
  const totalVolumeOunces = roundTo(
    smallWeightOunces * (SMALL_PAN_FULL_VOLUME_OUNCES / SMALL_PAN_FULL_WEIGHT_OUNCES) +
      largeWeightOunces * (LARGE_PAN_FULL_VOLUME_OUNCES / LARGE_PAN_FULL_WEIGHT_OUNCES)
  );

  return {
    id: row?.id ?? null,
    businessDate: row?.businessDate ?? normalizeDate(),
    flavor: row?.flavor ?? "",
    shiftType: row?.shiftType ?? defaultShiftType,
    smallPanCount,
    smallGrossWeightKg: roundTo(smallGrossWeightKg),
    largePanCount,
    largeGrossWeightKg: roundTo(largeGrossWeightKg),
    combinedGrossWeightKg,
    smallNetWeightKg: roundTo(smallNetWeightKg),
    largeNetWeightKg: roundTo(largeNetWeightKg),
    netWeightKg: totalNetWeightKg,
    totalWeightOunces,
    totalVolumeOunces,
    submittedByUserId: row?.submittedByUserId ?? null,
    createdAt: row?.createdAt ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

function classifyGelatoDiscrepancy(varianceVolumeOunces: number) {
  const absoluteVariance = Math.abs(varianceVolumeOunces);
  if (absoluteVariance < 0.5) {
    return { status: "aligned" as const, label: "Aligned" };
  }

  if (absoluteVariance <= MINOR_GELATO_DISCREPANCY_VOLUME_OUNCES) {
    return { status: "minor" as const, label: "Sample / minor discrepancy" };
  }

  return { status: "major" as const, label: "Major discrepancy" };
}

function emptyOpeningStockCounts(): OpeningStockCountsSummary {
  return {
    cups4oz: 0,
    cups8oz: 0,
    cupsPint: 0,
    cupsLiter: 0,
    lids4oz: 0,
    lids8oz: 0,
    lidsPint: 0,
    lidsLiter: 0,
    spoons: 0,
  };
}

function getReadyMadeGelatoFlavorList(rows: ReadyMadeMeasurementRow[]) {
  const seeded = [...READY_MADE_GELATO_FLAVORS];
  const seen = new Set(seeded.map(flavor => normalizeKey(flavor)));
  const custom = rows
    .map(row => row.flavor?.trim() ?? "")
    .filter(Boolean)
    .filter(flavor => {
      const key = normalizeKey(flavor);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.localeCompare(b));

  return [...seeded, ...custom];
}

function readOpeningStockCounts(responseJson?: string | null): OpeningStockCountsSummary {
  if (!responseJson) return emptyOpeningStockCounts();

  try {
    const parsed = JSON.parse(responseJson) as { stockCounts?: Partial<Record<keyof OpeningStockCountsSummary, unknown>> };
    const stockCounts = parsed?.stockCounts ?? {};
    return {
      cups4oz: toNumber(stockCounts.cups4oz),
      cups8oz: toNumber(stockCounts.cups8oz),
      cupsPint: toNumber(stockCounts.cupsPint),
      cupsLiter: toNumber(stockCounts.cupsLiter),
      lids4oz: toNumber(stockCounts.lids4oz),
      lids8oz: toNumber(stockCounts.lids8oz),
      lidsPint: toNumber(stockCounts.lidsPint),
      lidsLiter: toNumber(stockCounts.lidsLiter),
      spoons: toNumber(stockCounts.spoons),
    };
  } catch {
    return emptyOpeningStockCounts();
  }
}

function classifyServiceItemDiscrepancy(varianceCount: number) {
  const absoluteVariance = Math.abs(varianceCount);
  if (absoluteVariance < 0.5) {
    return { status: "aligned" as const, label: "Aligned" };
  }

  if (absoluteVariance <= MINOR_SERVICE_ITEM_DISCREPANCY_COUNT) {
    return { status: "minor" as const, label: "Minor discrepancy" };
  }

  return { status: "major" as const, label: "Major discrepancy" };
}

function buildReadyMadeGelatoReconciliation(rows: ReadyMadeMeasurementRow[], soldVolumeOunces: number, hasClosingSubmission = false) {
  const rowByFlavorShift = new Map(rows.map(row => [`${normalizeKey(row.flavor ?? "")}:${row.shiftType}`, row]));
  const hasClosingMeasurements =
    hasClosingSubmission &&
    rows.some(
      row =>
        row.shiftType === "closing" &&
        (toNumber(row.smallPanCount) > 0 ||
          toNumber(row.largePanCount) > 0 ||
          toNumber(row.smallGrossWeightKg) > 0 ||
          toNumber(row.largeGrossWeightKg) > 0 ||
          toNumber(row.combinedGrossWeightKg) > 0 ||
          toNumber(row.weightKg) > 0)
    );
  const flavors = getReadyMadeGelatoFlavorList(rows).map(flavor => {
    const flavorKey = normalizeKey(flavor);
    const opening = calculateReadyMadeMeasurement(rowByFlavorShift.get(`${flavorKey}:opening`), "opening");
    const closing = calculateReadyMadeMeasurement(rowByFlavorShift.get(`${flavorKey}:closing`), "closing");
    const usedVolumeOunces = hasClosingMeasurements ? roundTo(opening.totalVolumeOunces - closing.totalVolumeOunces) : 0;

    return {
      flavor,
      opening,
      closing,
      usedVolumeOunces,
    };
  });

  const openingVolumeOunces = roundTo(flavors.reduce((sum, flavor) => sum + flavor.opening.totalVolumeOunces, 0));
  const closingVolumeOunces = roundTo(flavors.reduce((sum, flavor) => sum + flavor.closing.totalVolumeOunces, 0));
  const actualDistributedVolumeOunces = hasClosingMeasurements ? roundTo(openingVolumeOunces - closingVolumeOunces) : 0;
  const varianceVolumeOunces = hasClosingMeasurements ? roundTo(actualDistributedVolumeOunces - soldVolumeOunces) : 0;
  const discrepancy = hasClosingMeasurements ? classifyGelatoDiscrepancy(varianceVolumeOunces) : null;

  return {
    flavors,
    hasClosingMeasurements,
    openingVolumeOunces,
    closingVolumeOunces,
    actualDistributedVolumeOunces,
    soldVolumeOunces: roundTo(soldVolumeOunces),
    varianceVolumeOunces,
    discrepancyStatus: discrepancy?.status ?? "pending",
    discrepancyLabel: discrepancy?.label ?? AWAITING_CLOSING_FORM_LABEL,
    minorDiscrepancyThresholdOunces: MINOR_GELATO_DISCREPANCY_VOLUME_OUNCES,
  };
}

function buildServicePackagingReconciliation(
  openingEntries: Array<{ staffName: string; responseJson?: string | null; createdAt?: Date }>,
  reports: Array<{ cups4ozToGo?: number; cups8ozToGo?: number; cupsPintToGo?: number; cupsLiterToGo?: number }>,
  inventoryRows: Array<{ itemName: string; currentQuantity: string | number; lastCountDate?: string | null }>,
  businessDate: string,
  hasClosingSubmission = false
) {
  const latestOpening = [...openingEntries].sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0))[0];
  const openingStockCounts = readOpeningStockCounts(latestOpening?.responseJson ?? null);
  const soldToGo = reports.reduce(
    (acc, report) => {
      acc.cups4oz += toNumber(report.cups4ozToGo);
      acc.cups8oz += toNumber(report.cups8ozToGo);
      acc.cupsPint += toNumber(report.cupsPintToGo);
      acc.cupsLiter += toNumber(report.cupsLiterToGo);
      return acc;
    },
    { cups4oz: 0, cups8oz: 0, cupsPint: 0, cupsLiter: 0 }
  );
  const totalToGoServings = soldToGo.cups4oz + soldToGo.cups8oz + soldToGo.cupsPint + soldToGo.cupsLiter;
  const inventoryByName = new Map(inventoryRows.map(item => [normalizeKey(item.itemName), item]));

  const resolveClosingQuantity = (itemNames: string[]) => {
    if (!hasClosingSubmission) return null;
    const matched = itemNames.map(name => inventoryByName.get(normalizeKey(name))).filter(Boolean) as Array<{ currentQuantity: string | number; lastCountDate?: string | null }>;
    if (matched.length === 0) return null;
    if (matched.some(item => (item.lastCountDate ?? "") !== businessDate)) return null;
    return roundTo(matched.reduce((sum, item) => sum + toNumber(item.currentQuantity), 0));
  };

  const items = [
    {
      key: "cups4oz",
      label: "4oz To-Go Cups",
      openingQuantity: openingStockCounts.cups4oz,
      expectedUsed: soldToGo.cups4oz,
      closingQuantity: resolveClosingQuantity(["4oz To-Go Cups"]),
    },
    {
      key: "cups8oz",
      label: "8oz To-Go Cups",
      openingQuantity: openingStockCounts.cups8oz,
      expectedUsed: soldToGo.cups8oz,
      closingQuantity: resolveClosingQuantity(["8oz To-Go Cups"]),
    },
    {
      key: "lids8oz",
      label: "8oz To-Go Lids",
      openingQuantity: openingStockCounts.lids8oz,
      expectedUsed: soldToGo.cups8oz,
      closingQuantity: resolveClosingQuantity(["8oz To-Go Lids"]),
    },
    {
      key: "cupsPint",
      label: "16oz To-Go Cups",
      openingQuantity: openingStockCounts.cupsPint,
      expectedUsed: soldToGo.cupsPint,
      closingQuantity: resolveClosingQuantity(["16oz To-Go Cups"]),
    },
    {
      key: "lidsPint",
      label: "16oz To-Go Lids",
      openingQuantity: openingStockCounts.lidsPint,
      expectedUsed: soldToGo.cupsPint,
      closingQuantity: resolveClosingQuantity(["16oz To-Go Lids"]),
    },
    {
      key: "cupsLiter",
      label: "32oz To-Go Cups",
      openingQuantity: openingStockCounts.cupsLiter,
      expectedUsed: soldToGo.cupsLiter,
      closingQuantity: resolveClosingQuantity(["32oz To-Go Cups"]),
    },
    {
      key: "lidsLiter",
      label: "32oz To-Go Lids",
      openingQuantity: openingStockCounts.lidsLiter,
      expectedUsed: soldToGo.cupsLiter,
      closingQuantity: resolveClosingQuantity(["32oz To-Go Lids"]),
    },
    {
      key: "spoons",
      label: "To-Go Spoons",
      openingQuantity: openingStockCounts.spoons,
      expectedUsed: totalToGoServings,
      closingQuantity: resolveClosingQuantity(["Bamboo To-Go Spoons", "Edible Spoons"]),
    },
  ].map(item => {
    if (item.closingQuantity === null) {
      return {
        ...item,
        actualUsed: null,
        variance: null,
        discrepancyStatus: "pending" as const,
        discrepancyLabel: hasClosingSubmission ? AWAITING_SAME_DAY_CLOSING_COUNT_LABEL : AWAITING_CLOSING_FORM_LABEL,
      };
    }

    const actualUsed = roundTo(item.openingQuantity - item.closingQuantity);
    const variance = roundTo(actualUsed - item.expectedUsed);
    const discrepancy = classifyServiceItemDiscrepancy(variance);

    return {
      ...item,
      actualUsed,
      variance,
      discrepancyStatus: discrepancy.status,
      discrepancyLabel: discrepancy.label,
    };
  });

  const comparableItems = items.filter(item => item.variance !== null);
  const varianceCount = comparableItems.length ? roundTo(comparableItems.reduce((sum, item) => sum + (item.variance ?? 0), 0)) : null;
  const discrepancy = varianceCount === null ? null : classifyServiceItemDiscrepancy(varianceCount);

  return {
    openingRecorded: Boolean(latestOpening),
    latestOpeningStaff: latestOpening?.staffName ?? null,
    soldToGo,
    totalToGoServings,
    items,
    varianceCount,
    discrepancyStatus: discrepancy?.status ?? "pending",
    discrepancyLabel: discrepancy?.label ?? (hasClosingSubmission ? AWAITING_SAME_DAY_CLOSING_COUNT_LABEL : AWAITING_CLOSING_FORM_LABEL),
    minorDiscrepancyThresholdCount: MINOR_SERVICE_ITEM_DISCREPANCY_COUNT,
  };
}

function getWeekStart(dateString: string) {
  return getPacificWeekStart(dateString);
}

const defaultChecklistQuestions: Array<InsertChecklistQuestion> = [
  { checklistType: "opening", sectionTitle: "Equipment", prompt: "Freezers ON and cold", detailPrompt: "If no, what is wrong?", detailTrigger: "No", displayOrder: 1, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Equipment", prompt: "Display freezer stocked", detailPrompt: "If no, what needs to be stocked?", detailTrigger: "No", displayOrder: 2, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Equipment", prompt: "Gelato texture checked", detailPrompt: "If no, what texture issue did you notice?", detailTrigger: "No", displayOrder: 3, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Equipment", prompt: "Machines running properly", detailPrompt: "If no, describe the issue.", detailTrigger: "No", displayOrder: 4, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Cleanliness", prompt: "Counters clean", detailPrompt: "If no, what still needs to be cleaned?", detailTrigger: "No", displayOrder: 5, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Cleanliness", prompt: "Floors clean", detailPrompt: "If no, what still needs attention?", detailTrigger: "No", displayOrder: 6, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Cleanliness", prompt: "Sink clean", detailPrompt: "If no, what still needs attention?", detailTrigger: "No", displayOrder: 7, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Cleanliness", prompt: "All trash is emptied", detailPrompt: "If no, explain why.", detailTrigger: "No", displayOrder: 8, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Setup", prompt: "Napkins stocked", detailPrompt: "If no, what is missing?", detailTrigger: "No", displayOrder: 9, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Employee Preparation", prompt: "Employee ready for work", detailPrompt: "If no, explain what is incomplete.", detailTrigger: "No", displayOrder: 10, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Employee Preparation", prompt: "Shirt clean and ironed", detailPrompt: "If no, explain the issue.", detailTrigger: "No", displayOrder: 11, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Employee Preparation", prompt: "Specified uniform worn correctly", detailPrompt: "If no, explain the issue.", detailTrigger: "No", displayOrder: 12, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Employee Preparation", prompt: "Presentation clean and professional", detailPrompt: "If no, explain the issue.", detailTrigger: "No", displayOrder: 13, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Final", prompt: "Store ready to open", detailPrompt: "If no, what is still pending?", detailTrigger: "No", displayOrder: 14, isActive: 1 },
  { checklistType: "closing", sectionTitle: "Cleaning", prompt: "Counters cleaned", detailPrompt: "If no, what remains?", detailTrigger: "No", displayOrder: 1, isActive: 1 },
  { checklistType: "closing", sectionTitle: "Cleaning", prompt: "Floors cleaned", detailPrompt: "If no, what remains?", detailTrigger: "No", displayOrder: 2, isActive: 1 },
  { checklistType: "closing", sectionTitle: "Cleaning", prompt: "Utensils washed", detailPrompt: "If no, what remains?", detailTrigger: "No", displayOrder: 3, isActive: 1 },
  { checklistType: "closing", sectionTitle: "Cleaning", prompt: "Trash taken out", detailPrompt: "If no, explain why.", detailTrigger: "No", displayOrder: 4, isActive: 1 },
  { checklistType: "closing", sectionTitle: "Product", prompt: "Gelato stored properly", detailPrompt: "If no, explain the issue.", detailTrigger: "No", displayOrder: 5, isActive: 1 },
  { checklistType: "closing", sectionTitle: "Product", prompt: "Freezers closed and working", detailPrompt: "If no, explain the issue.", detailTrigger: "No", displayOrder: 6, isActive: 1 },
  { checklistType: "closing", sectionTitle: "Final", prompt: "Store closed properly", detailPrompt: "If no, explain the issue.", detailTrigger: "No", displayOrder: 7, isActive: 1 },
];

const retiredChecklistPrompts = new Set([
  "Cups stocked",
  "Lids stocked",
  "Spoons stocked",
  "Toppings filled",
]);

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeUnit(value?: string) {
  const raw = normalizeKey(value ?? "");
  if (!raw) return "";
  const aliases: Record<string, string> = {
    bag: "bag",
    bags: "bag",
    box: "box",
    boxes: "box",
    pack: "pack",
    packs: "pack",
    set: "set",
    unit: "unit",
    units: "unit",
    g: "g",
    gram: "g",
    grams: "g",
    kg: "kg",
    kilo: "kg",
    kilos: "kg",
    kilogram: "kg",
    kilograms: "kg",
    l: "l",
    liter: "l",
    liters: "l",
    litre: "l",
    litres: "l",
    ml: "ml",
    cup: "cup",
    cups: "cup",
    tsp: "tsp",
    teaspoon: "tsp",
    teaspoons: "tsp",
    tbsp: "tbsp",
    tablespoon: "tbsp",
    tablespoons: "tbsp",
    lime: "lime",
    limes: "lime",
  };
  return aliases[raw] ?? raw;
}

const recipeIngredientInventoryAliases: Record<string, string> = {
  "cacao powder": "cacao",
  "lemon juice": "lemon",
  "lemon zest": "lemon",
  "strawberry blended": "strawberry",
  "vanilla extract": "vanilla",
};

function findInventoryMatchByName<T extends { id?: number; itemName: string; unitType?: string; costPerUnit?: string | number }>(name: string, items: T[]) {
  const normalized = normalizeKey(name);
  const aliasTarget = recipeIngredientInventoryAliases[normalized];

  return items.find(item => normalizeKey(item.itemName) === normalized)
    ?? (aliasTarget ? items.find(item => normalizeKey(item.itemName) === aliasTarget) : undefined);
}

async function ensureInventorySeeded() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db.select().from(inventoryItems).limit(1);
  if (existing.length > 0) return;

  await db.insert(inventoryItems).values(
    DEFAULT_INVENTORY_ITEMS.map(item => ({
      department: item.department,
      category: item.category,
      itemName: item.itemName,
      unitType: item.unitType,
      packSize: item.packSize,
      costPerUnit: item.costPerUnit,
      currentQuantity: item.currentInventory,
      parLevel: item.parLevel,
      reorderQuantity: item.reorderQuantity,
      supplier: item.supplier,
      supplierContact: item.supplierContact,
      lastCountDate: "",
      notes: item.notes,
    }))
  );
}

async function ensureRecipesSeeded() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db.select().from(recipes).limit(1);
  if (existing.length > 0) return;

  const recipeNames = Array.from(new Set(DEFAULT_RECIPE_ITEMS.map(item => item.recipeName)));
  if (recipeNames.length === 0) return;

  const recipeRows: InsertRecipe[] = recipeNames.map(name => ({
    name,
    batchYieldOunces: "0.00",
    notes: "",
    processSteps: "",
  }));

  await db.insert(recipes).values(recipeRows);
  const insertedRecipes = await db.select().from(recipes).orderBy(recipes.name);
  const recipeIdByName = new Map(insertedRecipes.map(recipe => [recipe.name, recipe.id]));

  const ingredientRows: InsertRecipeIngredient[] = DEFAULT_RECIPE_ITEMS.map((item, index) => ({
    recipeId: recipeIdByName.get(item.recipeName) ?? 0,
    inventoryItemId: null,
    ingredientName: item.ingredientName,
    quantity: item.quantity || "0",
    unitType: item.unitType || "units",
    costPerUnit: item.costPerUnit || "0.00",
    totalCost: item.totalCost || "0.00",
    sortOrder: index + 1,
    processSteps: item.processSteps || "",
  })).filter(item => item.recipeId > 0);

  if (ingredientRows.length > 0) {
    await db.insert(recipeIngredients).values(ingredientRows);
  }
}

function calculateOpeningCompletion(entry: {
  staffName: string;
  equipmentStatus: string;
  cleanlinessStatus: string;
  setupStatus: string;
  startingCash: unknown;
  cashMatchesSystem: string;
  storeReadyStatus: string;
}) {
  const checks = [
    Boolean(entry.staffName?.trim()),
    Boolean(entry.equipmentStatus?.trim()),
    Boolean(entry.cleanlinessStatus?.trim()),
    Boolean(entry.setupStatus?.trim()),
    toNumber(entry.startingCash) >= 0,
    entry.cashMatchesSystem === "Yes",
    entry.storeReadyStatus === "Yes",
  ];
  return checks.filter(Boolean).length / checks.length;
}

function calculateClosingCompletion(entry: {
  staffName: string;
  cashCounted: unknown;
  cashMatchesSystem: string;
  cleaningStatus: string;
  productStorageStatus: string;
  storeClosedStatus: string;
}) {
  const checks = [
    Boolean(entry.staffName?.trim()),
    toNumber(entry.cashCounted) >= 0,
    entry.cashMatchesSystem === "Yes",
    Boolean(entry.cleaningStatus?.trim()),
    Boolean(entry.productStorageStatus?.trim()),
    entry.storeClosedStatus === "Yes",
  ];
  return checks.filter(Boolean).length / checks.length;
}

export function buildDailySnapshot(
  openingEntries: Array<{
    staffName: string;
    equipmentStatus: string;
    cleanlinessStatus: string;
    setupStatus: string;
    startingCash: unknown;
    cashMatchesSystem: string;
    storeReadyStatus: string;
    responseJson?: string | null;
    createdAt?: Date;
  }>,
  closingEntries: Array<{
    staffName: string;
    cashCounted: unknown;
    cashMatchesSystem: string;
    cleaningStatus: string;
    productStorageStatus: string;
    storeClosedStatus: string;
    createdAt?: Date;
  }>,
  reports: Array<{
    businessDate: string;
    staffName: string;
    cups4oz: number;
    cups4ozHere?: number;
    cups4ozToGo?: number;
    cups8oz: number;
    cups8ozHere?: number;
    cups8ozToGo?: number;
    cupsPint: number;
    cupsPintHere?: number;
    cupsPintToGo?: number;
    cupsLiter: number;
    cupsLiterHere?: number;
    cupsLiterToGo?: number;
    cashTotal: unknown;
    cardTotal: unknown;
    zelleTotal: unknown;
    venmoTotal: unknown;
    createdAt?: Date;
  }>,
  gelatoRows: ReadyMadeMeasurementRow[],
  inventoryRowsOrBusinessDate: Array<{ itemName: string; currentQuantity: string | number; lastCountDate?: string | null }> | string,
  businessDateArg?: string
) {
  const inventoryRows = Array.isArray(inventoryRowsOrBusinessDate) ? inventoryRowsOrBusinessDate : [];
  const businessDate = typeof inventoryRowsOrBusinessDate === "string" ? inventoryRowsOrBusinessDate : businessDateArg ?? normalizeDate();

  const sales = reports.reduce(
    (acc, report) => {
      acc.cash += toNumber(report.cashTotal);
      acc.card += toNumber(report.cardTotal);
      acc.zelle += toNumber(report.zelleTotal);
      acc.venmo += toNumber(report.venmoTotal);
      acc.total += toNumber(report.cashTotal) + toNumber(report.cardTotal) + toNumber(report.zelleTotal) + toNumber(report.venmoTotal);
      acc.cups4oz += report.cups4oz;
      acc.cups8oz += report.cups8oz;
      acc.cupsPint += report.cupsPint;
      acc.cupsLiter += report.cupsLiter;
      acc.cups4ozHere += toNumber(report.cups4ozHere);
      acc.cups4ozToGo += toNumber(report.cups4ozToGo);
      acc.cups8ozHere += toNumber(report.cups8ozHere);
      acc.cups8ozToGo += toNumber(report.cups8ozToGo);
      acc.cupsPintHere += toNumber(report.cupsPintHere);
      acc.cupsPintToGo += toNumber(report.cupsPintToGo);
      acc.cupsLiterHere += toNumber(report.cupsLiterHere);
      acc.cupsLiterToGo += toNumber(report.cupsLiterToGo);
      return acc;
    },
    {
      total: 0,
      cash: 0,
      card: 0,
      zelle: 0,
      venmo: 0,
      cups4oz: 0,
      cups8oz: 0,
      cupsPint: 0,
      cupsLiter: 0,
      cups4ozHere: 0,
      cups4ozToGo: 0,
      cups8ozHere: 0,
      cups8ozToGo: 0,
      cupsPintHere: 0,
      cupsPintToGo: 0,
      cupsLiterHere: 0,
      cupsLiterToGo: 0,
    }
  );

  const soldVolumeOunces = convertSalesToVolumeOunces(sales);
  const hasClosingSubmission = closingEntries.length > 0;
  const hasClosingGelatoSubmission =
    hasClosingSubmission ||
    gelatoRows.some(
      row =>
        row.shiftType === "closing" &&
        (toNumber(row.smallPanCount) > 0 ||
          toNumber(row.largePanCount) > 0 ||
          toNumber(row.smallGrossWeightKg) > 0 ||
          toNumber(row.largeGrossWeightKg) > 0 ||
          toNumber(row.combinedGrossWeightKg) > 0 ||
          toNumber(row.weightKg) > 0)
    );
  const gelato = buildReadyMadeGelatoReconciliation(gelatoRows, soldVolumeOunces, hasClosingGelatoSubmission);
  const packaging = buildServicePackagingReconciliation(openingEntries, reports, inventoryRows, businessDate, hasClosingSubmission);
  const openingCompletionRate = openingEntries.length
    ? openingEntries.reduce((sum, entry) => sum + calculateOpeningCompletion(entry), 0) / openingEntries.length
    : 0;
  const closingCompletionRate = closingEntries.length
    ? closingEntries.reduce((sum, entry) => sum + calculateClosingCompletion(entry), 0) / closingEntries.length
    : 0;

  const latestReport = [...reports].sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0))[0];

  return {
    businessDate,
    reportCount: reports.length,
    openingSubmissionCount: openingEntries.length,
    closingSubmissionCount: closingEntries.length,
    sales,
    soldVolumeOunces,
    cups: {
      "4oz": sales.cups4oz,
      "8oz": sales.cups8oz,
      Pint: sales.cupsPint,
      Liter: sales.cupsLiter,
    },
    cupsHere: {
      "4oz": sales.cups4ozHere,
      "8oz": sales.cups8ozHere,
      Pint: sales.cupsPintHere,
      Liter: sales.cupsLiterHere,
    },
    cupsToGo: {
      "4oz": sales.cups4ozToGo,
      "8oz": sales.cups8ozToGo,
      Pint: sales.cupsPintToGo,
      Liter: sales.cupsLiterToGo,
    },
    gelato,
    packaging,
    checklistCompletion: {
      opening: openingCompletionRate,
      closing: closingCompletionRate,
    },
    latestReportStaff: latestReport?.staffName ?? null,
  };
}

export function buildWeekOverWeekSeries(
  reports: Array<{
    businessDate: string;
    cashTotal: unknown;
    cardTotal: unknown;
    zelleTotal: unknown;
    venmoTotal: unknown;
  }>
) {
  const weekly = new Map<string, number>();

  for (const report of reports) {
    const weekStart = getWeekStart(report.businessDate);
    const totalSales = toNumber(report.cashTotal) + toNumber(report.cardTotal) + toNumber(report.zelleTotal) + toNumber(report.venmoTotal);
    weekly.set(weekStart, (weekly.get(weekStart) ?? 0) + totalSales);
  }

  const series = Array.from(weekly.entries())
    .map(([weekStart, totalSales]) => ({ weekStart, totalSales }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  return series.slice(-8).map((entry, index, arr) => ({
    ...entry,
    previousWeekSales: index > 0 ? arr[index - 1]?.totalSales ?? 0 : 0,
    delta: index > 0 ? entry.totalSales - (arr[index - 1]?.totalSales ?? 0) : entry.totalSales,
  }));
}

export function buildRecentNotesFeed(
  reports: Array<{
    businessDate: string;
    staffName: string;
    lowItemNotes?: string | null;
    wasteNotes?: string | null;
    generalNotes?: string | null;
    createdAt: Date;
  }>,
  closings: Array<{
    businessDate: string;
    staffName: string;
    notes?: string | null;
    createdAt: Date;
  }>,
  limit = 12
) {
  return [
    ...reports.flatMap(report => [
      report.lowItemNotes?.trim()
        ? {
            type: "Low-item alert",
            businessDate: report.businessDate,
            staffName: report.staffName,
            detail: report.lowItemNotes,
            createdAt: report.createdAt,
          }
        : null,
      report.wasteNotes?.trim()
        ? {
            type: "Waste note",
            businessDate: report.businessDate,
            staffName: report.staffName,
            detail: report.wasteNotes,
            createdAt: report.createdAt,
          }
        : null,
      report.generalNotes?.trim()
        ? {
            type: "General note",
            businessDate: report.businessDate,
            staffName: report.staffName,
            detail: report.generalNotes,
            createdAt: report.createdAt,
          }
        : null,
    ]),
    ...closings.map(entry =>
      entry.notes?.trim()
        ? {
            type: "Closing note",
            businessDate: entry.businessDate,
            staffName: entry.staffName,
            detail: entry.notes,
            createdAt: entry.createdAt,
          }
        : null
    ),
  ]
    .filter(Boolean)
    .sort((a, b) => (b?.createdAt?.getTime?.() ?? 0) - (a?.createdAt?.getTime?.() ?? 0))
    .slice(0, limit);
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;

  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) {
    values.lastSignedIn = new Date();
  }
  if (Object.keys(updateSet).length === 0) {
    updateSet.lastSignedIn = new Date();
  }

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function createOpeningChecklist(input: InsertOpeningChecklist) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const values: InsertOpeningChecklist = {
    ...input,
    businessDate: normalizeDate(input.businessDate),
  };

  await db.delete(openingChecklists).where(eq(openingChecklists.businessDate, values.businessDate));
  await db.insert(openingChecklists).values(values);
  return values;
}

export async function createClosingChecklist(input: InsertClosingChecklist) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const values: InsertClosingChecklist = {
    ...input,
    businessDate: normalizeDate(input.businessDate),
  };

  await db.delete(closingChecklists).where(eq(closingChecklists.businessDate, values.businessDate));
  await db.insert(closingChecklists).values(values);
  return values;
}

export async function createEndOfDayReport(input: InsertEndOfDayReport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const values: InsertEndOfDayReport = {
    ...input,
    businessDate: normalizeDate(input.businessDate),
  };

  await db.delete(endOfDayReports).where(eq(endOfDayReports.businessDate, values.businessDate));
  await db.insert(endOfDayReports).values(values);
  return values;
}

export async function listChecklistQuestions(checklistType: "opening" | "closing") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(checklistQuestions)
    .where(eq(checklistQuestions.checklistType, checklistType))
    .orderBy(checklistQuestions.displayOrder, checklistQuestions.id);

  if (existing.length > 0) {
    return existing.filter(item => item.isActive === 1 && !retiredChecklistPrompts.has(item.prompt));
  }

  const defaults = defaultChecklistQuestions.filter(item => item.checklistType === checklistType);
  if (defaults.length > 0) {
    await db.insert(checklistQuestions).values(defaults);
  }

  return db
    .select()
    .from(checklistQuestions)
    .where(eq(checklistQuestions.checklistType, checklistType))
    .orderBy(checklistQuestions.displayOrder, checklistQuestions.id);
}

export async function saveChecklistQuestion(input: {
  id?: number;
  checklistType: "opening" | "closing";
  sectionTitle: string;
  prompt: string;
  detailPrompt?: string;
  detailTrigger: "Yes" | "No" | "Never";
  displayOrder: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (input.id) {
    await db
      .update(checklistQuestions)
      .set({
        checklistType: input.checklistType,
        sectionTitle: input.sectionTitle,
        prompt: input.prompt,
        detailPrompt: input.detailPrompt ?? "",
        detailTrigger: input.detailTrigger,
        displayOrder: input.displayOrder,
        isActive: 1,
      })
      .where(eq(checklistQuestions.id, input.id));

    const updated = await db.select().from(checklistQuestions).where(eq(checklistQuestions.id, input.id)).limit(1);
    return updated[0];
  }

  const result = await db.insert(checklistQuestions).values({
    checklistType: input.checklistType,
    sectionTitle: input.sectionTitle,
    prompt: input.prompt,
    detailPrompt: input.detailPrompt ?? "",
    detailTrigger: input.detailTrigger,
    displayOrder: input.displayOrder,
    isActive: 1,
  });

  const inserted = await db.select().from(checklistQuestions).where(eq(checklistQuestions.id, Number(result[0]?.insertId ?? 0))).limit(1);
  return inserted[0];
}

export async function removeChecklistQuestion(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(checklistQuestions).set({ isActive: 0 }).where(eq(checklistQuestions.id, id));
  return { success: true } as const;
}

export async function listInventoryItems() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await ensureInventorySeeded();

  const items = await db.select().from(inventoryItems).orderBy(inventoryItems.department, inventoryItems.category, inventoryItems.itemName);
  return items.map(item => ({
    ...item,
    currentQuantity: toNumber(item.currentQuantity),
    parLevel: toNumber(item.parLevel),
    reorderQuantity: toNumber(item.reorderQuantity),
    costPerUnit: toNumber(item.costPerUnit),
    reorderNeeded: toNumber(item.currentQuantity) <= toNumber(item.parLevel),
  }));
}

export async function saveInventoryItem(input: {
  id?: number;
  department: string;
  category: string;
  itemName: string;
  unitType: string;
  packSize: string;
  costPerUnit: string;
  currentQuantity: string;
  parLevel: string;
  reorderQuantity: string;
  supplier?: string;
  supplierContact?: string;
  lastCountDate?: string;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const values = {
    department: input.department,
    category: input.category,
    itemName: input.itemName,
    unitType: input.unitType,
    packSize: input.packSize,
    costPerUnit: input.costPerUnit,
    currentQuantity: input.currentQuantity,
    parLevel: input.parLevel,
    reorderQuantity: input.reorderQuantity,
    supplier: input.supplier ?? "",
    supplierContact: input.supplierContact ?? "",
    lastCountDate: input.lastCountDate ?? "",
    notes: input.notes ?? "",
  };

  if (input.id) {
    await db.update(inventoryItems).set(values).where(eq(inventoryItems.id, input.id));
    const updated = await db.select().from(inventoryItems).where(eq(inventoryItems.id, input.id)).limit(1);
    return updated[0];
  }

  const result = await db.insert(inventoryItems).values(values);
  const inserted = await db.select().from(inventoryItems).where(eq(inventoryItems.id, Number(result[0]?.insertId ?? 0))).limit(1);
  return inserted[0];
}

export async function updateInventoryCount(input: {
  id: number;
  currentQuantity: string;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db.select().from(inventoryItems).where(eq(inventoryItems.id, input.id)).limit(1);
  const current = existing[0];
  if (!current) {
    throw new Error("Inventory item not found");
  }

  await db
    .update(inventoryItems)
    .set({
      currentQuantity: input.currentQuantity,
      notes: input.notes ?? current.notes ?? "",
      lastCountDate: normalizeDate(),
    })
    .where(eq(inventoryItems.id, input.id));

  const updated = await db.select().from(inventoryItems).where(eq(inventoryItems.id, input.id)).limit(1);
  return updated[0];
}

export async function listReadyMadeGelatoWeights(businessDate?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalizedDate = normalizeDate(businessDate);
  const rows = await db
    .select()
    .from(readyMadeGelatoWeights)
    .where(eq(readyMadeGelatoWeights.businessDate, normalizedDate))
    .orderBy(readyMadeGelatoWeights.flavor, readyMadeGelatoWeights.shiftType);

  const rowByFlavorShift = new Map(rows.map(row => [`${normalizeKey(row.flavor)}:${row.shiftType}`, row]));

  return getReadyMadeGelatoFlavorList(rows).map(flavor => {
    const flavorKey = normalizeKey(flavor);
    return {
      businessDate: normalizedDate,
      flavor,
      opening: calculateReadyMadeMeasurement(rowByFlavorShift.get(`${flavorKey}:opening`), "opening"),
      closing: calculateReadyMadeMeasurement(rowByFlavorShift.get(`${flavorKey}:closing`), "closing"),
    };
  });
}

export async function saveReadyMadeGelatoWeights(input: {
  businessDate?: string;
  shiftType: ReadyMadeShiftType;
  submittedByUserId: number;
  entries: Array<{
    flavor: string;
    smallPanCount: number;
    smallGrossWeightKg?: string;
    largePanCount: number;
    largeGrossWeightKg?: string;
    combinedGrossWeightKg?: string;
  }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalizedDate = normalizeDate(input.businessDate);
  const savedRows: Array<ReturnType<typeof calculateReadyMadeMeasurement>> = [];

  for (const entry of input.entries) {
    const flavor = entry.flavor.trim();
    if (!flavor) continue;

    const normalizedCombinedGrossWeightKg = toNumber(entry.combinedGrossWeightKg);
    const rawEntry = {
      businessDate: normalizedDate,
      flavor,
      shiftType: input.shiftType,
      smallPanCount: entry.smallPanCount,
      smallGrossWeightKg: entry.smallGrossWeightKg,
      largePanCount: entry.largePanCount,
      largeGrossWeightKg: entry.largeGrossWeightKg,
      combinedGrossWeightKg: normalizedCombinedGrossWeightKg > 0 ? normalizedCombinedGrossWeightKg : entry.combinedGrossWeightKg,
      submittedByUserId: input.submittedByUserId,
    };

    if (hasImpossibleReadyMadeGrossWeights(rawEntry)) {
      throw new Error(`${flavor} has an impossible pan weight for the selected pan setup. Please double-check the kilograms entered.`);
    }

    const calculated = calculateReadyMadeMeasurement(rawEntry, input.shiftType);

    const values: InsertReadyMadeGelatoWeight = {
      businessDate: normalizedDate,
      flavor,
      shiftType: input.shiftType,
      smallPanCount: calculated.smallPanCount,
      smallGrossWeightKg: calculated.smallGrossWeightKg.toFixed(2),
      largePanCount: calculated.largePanCount,
      largeGrossWeightKg: calculated.largeGrossWeightKg.toFixed(2),
      weightKg: calculated.netWeightKg.toFixed(2),
      submittedByUserId: input.submittedByUserId,
    };

    const existing = await db
      .select()
      .from(readyMadeGelatoWeights)
      .where(
        and(
          eq(readyMadeGelatoWeights.businessDate, normalizedDate),
          eq(readyMadeGelatoWeights.flavor, flavor),
          eq(readyMadeGelatoWeights.shiftType, input.shiftType)
        )
      )
      .limit(1);

    if (existing[0]) {
      await db.update(readyMadeGelatoWeights).set(values).where(eq(readyMadeGelatoWeights.id, existing[0].id));
      savedRows.push({ ...calculated, id: existing[0].id });
      continue;
    }

    const result = await db.insert(readyMadeGelatoWeights).values(values);
    savedRows.push({ ...calculated, id: Number(result[0]?.insertId ?? 0) });
  }

  return savedRows;
}

export async function updateSubmissionHistoryGelato(input: {
  entryId: number;
  submittedByUserId: number;
  gelatoEntries: Array<{
    flavor: string;
    smallPanCount: number;
    smallGrossWeightKg?: string;
    largePanCount: number;
    largeGrossWeightKg?: string;
    combinedGrossWeightKg?: string;
  }>;
  gelatoEntryMode?: "manual" | "photo";
  analyzedPhotos?: Array<{
    fileName: string;
    imageUrl: string;
    imageKey?: string;
    flavor: string;
    smallPanCount: number;
    largePanCount: number;
    combinedGrossWeightKg: number;
    confidence: "high" | "medium" | "low";
    warning?: string;
  }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(submissionHistoryEntries)
    .where(eq(submissionHistoryEntries.id, input.entryId))
    .limit(1);

  const currentEntry = existing[0];
  if (!currentEntry) {
    throw new Error("Saved submission could not be found.");
  }

  const businessDate = normalizeDate(currentEntry.businessDate);
  const submissionType = currentEntry.submissionType as SubmissionHistoryType;
  const shiftType: ReadyMadeShiftType = submissionType === "closing" ? "closing" : "opening";
  const currentPayload = safeParseJson<Record<string, unknown>>(currentEntry.payloadJson, {});

  await db.delete(readyMadeGelatoWeights).where(
    and(
      eq(readyMadeGelatoWeights.businessDate, businessDate),
      eq(readyMadeGelatoWeights.shiftType, shiftType)
    )
  );

  const savedRows = await saveReadyMadeGelatoWeights({
    businessDate,
    shiftType,
    submittedByUserId: input.submittedByUserId,
    entries: input.gelatoEntries,
  });

  const nextPayload = {
    ...currentPayload,
    gelatoEntries: savedRows.map(row => ({
      flavor: row.flavor,
      smallPanCount: row.smallPanCount,
      smallGrossWeightKg: row.smallGrossWeightKg,
      largePanCount: row.largePanCount,
      largeGrossWeightKg: row.largeGrossWeightKg,
    })),
    gelatoEntryMode: input.gelatoEntryMode ?? currentPayload.gelatoEntryMode,
    analyzedPhotos: input.analyzedPhotos ?? currentPayload.analyzedPhotos,
  };

  await db.update(submissionHistoryEntries).set({
    payloadJson: JSON.stringify(nextPayload),
    submittedByUserId: input.submittedByUserId,
  }).where(eq(submissionHistoryEntries.id, input.entryId));

  return {
    id: currentEntry.id,
    businessDate,
    submissionType,
    staffName: currentEntry.staffName,
    payload: nextPayload,
  };
}

export async function createSubmissionHistoryEntry(input: {
  businessDate?: string;
  submissionType: SubmissionHistoryType;
  staffName: string;
  submittedByUserId: number;
  payload: unknown;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const values: InsertSubmissionHistoryEntry = {
    businessDate: normalizeDate(input.businessDate),
    submissionType: input.submissionType,
    staffName: input.staffName.trim() || "Staff member",
    payloadJson: JSON.stringify(input.payload ?? {}),
    submittedByUserId: input.submittedByUserId,
  };

  await db.delete(submissionHistoryEntries).where(
    and(
      eq(submissionHistoryEntries.businessDate, values.businessDate),
      eq(submissionHistoryEntries.submissionType, values.submissionType)
    )
  );

  const result = await db.insert(submissionHistoryEntries).values(values);

  return {
    id: Number(result[0]?.insertId ?? 0),
    ...values,
    payload: input.payload ?? {},
  };
}

export async function listSubmissionHistoryEntries(businessDate?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalizedDate = normalizeDate(businessDate);
  const rows = await db
    .select()
    .from(submissionHistoryEntries)
    .where(eq(submissionHistoryEntries.businessDate, normalizedDate))
    .orderBy(desc(submissionHistoryEntries.createdAt), desc(submissionHistoryEntries.id));

  return Promise.all(
    rows.map(async row => {
      const payload = safeParseJson<Record<string, unknown>>(row.payloadJson, {});
      const analyzedPhotos = Array.isArray(payload.analyzedPhotos)
        ? await Promise.all(
            payload.analyzedPhotos.map(async photo => {
              if (!photo || typeof photo !== "object") return photo;

              const imageKey = typeof (photo as { imageKey?: unknown }).imageKey === "string"
                ? (photo as { imageKey: string }).imageKey
                : "";

              if (!imageKey) return photo;

              try {
                return {
                  ...photo,
                  imageUrl: await storageGetSignedUrl(imageKey),
                };
              } catch {
                return photo;
              }
            })
          )
        : payload.analyzedPhotos;

      return {
        ...row,
        payload: {
          ...payload,
          analyzedPhotos,
        },
      };
    })
  );
}

export async function getSubmissionStatusForBusinessDate(businessDate?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalizedDate = normalizeDate(businessDate);
  const [openingRows, closingRows, inventoryRows, openingChecklistRows, closingChecklistRows, reportRows] = await Promise.all([
    db
      .select({ total: count() })
      .from(submissionHistoryEntries)
      .where(and(eq(submissionHistoryEntries.businessDate, normalizedDate), eq(submissionHistoryEntries.submissionType, "opening"))),
    db
      .select({ total: count() })
      .from(submissionHistoryEntries)
      .where(and(eq(submissionHistoryEntries.businessDate, normalizedDate), eq(submissionHistoryEntries.submissionType, "closing"))),
    db
      .select({ total: count() })
      .from(submissionHistoryEntries)
      .where(and(eq(submissionHistoryEntries.businessDate, normalizedDate), eq(submissionHistoryEntries.submissionType, "inventory"))),
    db.select({ total: count() }).from(openingChecklists).where(eq(openingChecklists.businessDate, normalizedDate)),
    db.select({ total: count() }).from(closingChecklists).where(eq(closingChecklists.businessDate, normalizedDate)),
    db.select({ total: count() }).from(endOfDayReports).where(eq(endOfDayReports.businessDate, normalizedDate)),
  ]);

  const openingCount = Number(openingRows[0]?.total ?? 0) + Number(openingChecklistRows[0]?.total ?? 0);
  const closingCount = Number(closingRows[0]?.total ?? 0) + Number(closingChecklistRows[0]?.total ?? 0);
  const inventoryCount = Number(inventoryRows[0]?.total ?? 0) + Number(reportRows[0]?.total ?? 0);

  return {
    businessDate: normalizedDate,
    openingExists: openingCount > 0,
    closingExists: closingCount > 0,
    inventoryExists: inventoryCount > 0,
  } as const;
}

function normalizeStaffAttendanceRecord(row: typeof staffAttendance.$inferSelect): StaffAttendanceRecord {
  return {
    id: row.id,
    businessDate: row.businessDate,
    staffName: row.staffName as StaffAttendanceName,
    clockInAt: Number(row.clockInAt),
    clockOutAt: row.clockOutAt == null ? null : Number(row.clockOutAt),
    submittedByUserId: row.submittedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function getPacificUtcOffsetMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const offsetValue = parts.find(part => part.type === "timeZoneName")?.value ?? "GMT-8";
  const match = offsetValue.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/i);
  if (!match) return -8 * 60;
  const sign = match[1] === "+" ? 1 : -1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

export function getPacificBusinessDateAutoClockOutAt(businessDate: string) {
  const [year, month, day] = businessDate.split("-").map(value => Number(value));
  const pacificMiddayUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const offsetMinutes = getPacificUtcOffsetMinutes(pacificMiddayUtc);
  return Date.UTC(year, month - 1, day, AUTO_CLOCK_OUT_HOUR_PACIFIC, 0, 0, 0) - offsetMinutes * 60 * 1000;
}

export function getEffectiveAttendanceClockOutAt(record: Pick<StaffAttendanceRecord, "businessDate" | "clockInAt" | "clockOutAt">, referenceTime = Date.now()) {
  if (record.clockOutAt != null) {
    return Math.max(record.clockOutAt, record.clockInAt);
  }

  const forcedClockOutAt = Math.max(getPacificBusinessDateAutoClockOutAt(record.businessDate), record.clockInAt);
  if (referenceTime >= forcedClockOutAt) {
    return forcedClockOutAt;
  }

  return null;
}

async function forceClockOutExpiredOpenShifts(db: ReturnType<typeof drizzle>, referenceTime = Date.now()) {
  const openRows = await db
    .select()
    .from(staffAttendance)
    .where(isNull(staffAttendance.clockOutAt))
    .orderBy(desc(staffAttendance.clockInAt), desc(staffAttendance.id));

  for (const row of openRows) {
    const record = normalizeStaffAttendanceRecord(row);
    const forcedClockOutAt = getEffectiveAttendanceClockOutAt(record, referenceTime);
    if (forcedClockOutAt == null) continue;
    await db.update(staffAttendance).set({ clockOutAt: forcedClockOutAt }).where(eq(staffAttendance.id, record.id));
  }
}

export function calculateAttendanceHours(record: Pick<StaffAttendanceRecord, "businessDate" | "clockInAt" | "clockOutAt">, referenceTime = Date.now()) {
  const end = getEffectiveAttendanceClockOutAt(record, referenceTime) ?? referenceTime;
  if (!Number.isFinite(record.clockInAt) || !Number.isFinite(end)) return 0;
  return roundTo(Math.max(0, end - record.clockInAt) / (1000 * 60 * 60), 2);
}

export async function clockInStaff(input: {
  staffName: StaffAttendanceName;
  submittedByUserId: number;
  clockInAt?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await forceClockOutExpiredOpenShifts(db);
  const clockInAt = Number(input.clockInAt ?? Date.now());
  const openEntry = await db
    .select()
    .from(staffAttendance)
    .where(and(eq(staffAttendance.staffName, input.staffName), isNull(staffAttendance.clockOutAt)))
    .orderBy(desc(staffAttendance.clockInAt), desc(staffAttendance.id))
    .limit(1);

  if (openEntry[0]) {
    return normalizeStaffAttendanceRecord(openEntry[0]);
  }

  const values: InsertStaffAttendance = {
    businessDate: getPacificBusinessDate(new Date(clockInAt)),
    staffName: input.staffName,
    clockInAt,
    clockOutAt: null,
    submittedByUserId: input.submittedByUserId,
  };

  const result = await db.insert(staffAttendance).values(values);
  const inserted = await db
    .select()
    .from(staffAttendance)
    .where(eq(staffAttendance.id, Number(result[0]?.insertId ?? 0)))
    .limit(1);

  if (!inserted[0]) {
    throw new Error("Clock-in record could not be created.");
  }

  return normalizeStaffAttendanceRecord(inserted[0]);
}

export async function clockOutStaff(input: {
  staffName: StaffAttendanceName;
  submittedByUserId?: number;
  clockOutAt?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await forceClockOutExpiredOpenShifts(db, Number(input.clockOutAt ?? Date.now()));
  const clockOutAt = Number(input.clockOutAt ?? Date.now());
  const openEntry = await db
    .select()
    .from(staffAttendance)
    .where(and(eq(staffAttendance.staffName, input.staffName), isNull(staffAttendance.clockOutAt)))
    .orderBy(desc(staffAttendance.clockInAt), desc(staffAttendance.id))
    .limit(1);

  if (!openEntry[0]) {
    throw new Error(`${input.staffName} is not currently clocked in.`);
  }

  const openRecord = normalizeStaffAttendanceRecord(openEntry[0]);
  const resolvedClockOutAt = Math.max(clockOutAt, openRecord.clockInAt);

  await db.update(staffAttendance).set({ clockOutAt: resolvedClockOutAt }).where(eq(staffAttendance.id, openRecord.id));

  return {
    ...openRecord,
    clockOutAt: resolvedClockOutAt,
  } satisfies StaffAttendanceRecord;
}

export async function getTodayAttendance(businessDate?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await forceClockOutExpiredOpenShifts(db);
  const normalizedDate = normalizeDate(businessDate);
  const rows = await db
    .select()
    .from(staffAttendance)
    .where(and(gte(staffAttendance.businessDate, normalizedDate), lte(staffAttendance.businessDate, normalizedDate)));
  const openRows = await db
    .select()
    .from(staffAttendance)
    .where(isNull(staffAttendance.clockOutAt))
    .orderBy(desc(staffAttendance.clockInAt), desc(staffAttendance.id));

  const recordsById = new Map<number, StaffAttendanceRecord>();
  for (const row of [...rows, ...openRows]) {
    const record = normalizeStaffAttendanceRecord(row);
    recordsById.set(record.id, record);
  }

  const records = Array.from(recordsById.values()).sort((left, right) => right.clockInAt - left.clockInAt || right.id - left.id);

  return STAFF_ATTENDANCE_NAMES.map(staffName => {
    const staffRecords = records.filter(record => record.staffName === staffName);
    const todayEntries = staffRecords.filter(record => record.businessDate === normalizedDate);
    const activeEntry = staffRecords.find(record => record.clockOutAt == null) ?? null;

      return {
        staffName,
        isClockedIn: Boolean(activeEntry),
        activeEntry,
        latestEntry: staffRecords[0] ?? null,
        todayEntries,
        totalHoursToday: roundTo(todayEntries.reduce((sum, record) => sum + calculateAttendanceHours(record), 0), 2),
      } satisfies StaffAttendanceStatus;

  });
}

export async function getWeeklyAttendanceSummary(input?: {
  startDate?: string;
  endDate?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await forceClockOutExpiredOpenShifts(db);
  const endDate = normalizeDate(input?.endDate);
  const startDate = normalizeDate(input?.startDate ?? getPacificSundayWeekStart(endDate));
  const rows = await db
    .select()
    .from(staffAttendance)
    .where(and(gte(staffAttendance.businessDate, startDate), lte(staffAttendance.businessDate, endDate)))
    .orderBy(desc(staffAttendance.businessDate), desc(staffAttendance.clockInAt), desc(staffAttendance.id));

  const normalizedRows = rows.map(normalizeStaffAttendanceRecord);

  return {
    startDate,
    endDate,
    staff: STAFF_ATTENDANCE_NAMES.map(staffName => {
      const staffRows = normalizedRows.filter(row => row.staffName === staffName);
      const groupedByDay = new Map<string, WeeklyAttendanceSummaryRow>();

      for (const row of staffRows) {
        const current = groupedByDay.get(row.businessDate) ?? {
          businessDate: row.businessDate,
          hours: 0,
          shiftCount: 0,
          openShiftCount: 0,
        };

        current.hours = roundTo(current.hours + calculateAttendanceHours(row), 2);
        current.shiftCount += 1;
        current.openShiftCount += row.clockOutAt == null ? 1 : 0;
        groupedByDay.set(row.businessDate, current);
      }

      const dailyHours = Array.from(groupedByDay.values()).sort((left, right) => left.businessDate.localeCompare(right.businessDate));

      return {
        staffName,
        weeklyHours: roundTo(dailyHours.reduce((sum, day) => sum + day.hours, 0), 2),
        totalShiftCount: staffRows.length,
        openShiftCount: staffRows.filter(row => row.clockOutAt == null).length,
        dailyHours,
      };
    }),
  } satisfies WeeklyAttendanceSummary;
}

export async function getAttendanceTimeBook(input?: {
  startDate?: string;
  endDate?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await forceClockOutExpiredOpenShifts(db);
  const endDate = normalizeDate(input?.endDate);
  const startDate = normalizeDate(input?.startDate ?? getPacificSundayWeekStart(endDate));
  const rows = await db
    .select()
    .from(staffAttendance)
    .where(and(gte(staffAttendance.businessDate, startDate), lte(staffAttendance.businessDate, endDate)))
    .orderBy(desc(staffAttendance.businessDate), desc(staffAttendance.clockInAt), desc(staffAttendance.id));

  const normalizedRows = rows.map(normalizeStaffAttendanceRecord);
  const dailyTotals = new Map<string, { businessDate: string; totalHours: number; shiftCount: number; openShiftCount: number }>();

  const staff = STAFF_ATTENDANCE_NAMES.map(staffName => {
    const staffRows = normalizedRows.filter(row => row.staffName === staffName);
    const groupedByDay = new Map<string, TimeBookAttendanceDay>();

    for (const row of staffRows) {
      const hoursWorked = calculateAttendanceHours(row);
      const day = groupedByDay.get(row.businessDate) ?? {
        businessDate: row.businessDate,
        totalHours: 0,
        shiftCount: 0,
        openShiftCount: 0,
        entries: [],
      };

      day.entries.push({ ...row, hoursWorked });
      day.totalHours = roundTo(day.totalHours + hoursWorked, 2);
      day.shiftCount += 1;
      day.openShiftCount += row.clockOutAt == null ? 1 : 0;
      groupedByDay.set(row.businessDate, day);

      const dailyTotal = dailyTotals.get(row.businessDate) ?? {
        businessDate: row.businessDate,
        totalHours: 0,
        shiftCount: 0,
        openShiftCount: 0,
      };
      dailyTotal.totalHours = roundTo(dailyTotal.totalHours + hoursWorked, 2);
      dailyTotal.shiftCount += 1;
      dailyTotal.openShiftCount += row.clockOutAt == null ? 1 : 0;
      dailyTotals.set(row.businessDate, dailyTotal);
    }

    const dailyLogs = Array.from(groupedByDay.values())
      .map(day => ({
        ...day,
        entries: day.entries.sort((left, right) => left.clockInAt - right.clockInAt || left.id - right.id),
      }))
      .sort((left, right) => right.businessDate.localeCompare(left.businessDate));

    return {
      staffName,
      totalHours: roundTo(dailyLogs.reduce((sum, day) => sum + day.totalHours, 0), 2),
      totalShiftCount: staffRows.length,
      openShiftCount: staffRows.filter(row => row.clockOutAt == null).length,
      dailyLogs,
    };
  });

  const orderedDailyTotals = Array.from(dailyTotals.values()).sort((left, right) => left.businessDate.localeCompare(right.businessDate));

  return {
    startDate,
    endDate,
    totalHours: roundTo(orderedDailyTotals.reduce((sum, day) => sum + day.totalHours, 0), 2),
    totalShiftCount: orderedDailyTotals.reduce((sum, day) => sum + day.shiftCount, 0),
    openShiftCount: orderedDailyTotals.reduce((sum, day) => sum + day.openShiftCount, 0),
    dailyTotals: orderedDailyTotals,
    staff,
  } satisfies TimeBookAttendanceSummary;
}

export function buildRecipeCostSummaries(
  recipeRows: Array<{ id: number; name: string; batchYieldOunces: string | number | null; notes?: string | null; processSteps?: string | null }>,
  ingredientRows: Array<{ id: number; recipeId: number; ingredientName: string; quantity: string | number | null; unitType: string; inventoryItemId?: number | null; costPerUnit?: string | number | null; totalCost?: string | number | null; processSteps?: string | null }>,
  inventoryRows: Array<{ id: number; itemName: string; unitType: string; costPerUnit: string | number; currentQuantity?: string | number | null; parLevel?: string | number | null; reorderQuantity?: string | number | null }>,
) {
  return recipeRows.map(recipe => {
    const ingredients = ingredientRows
      .filter(item => item.recipeId === recipe.id)
      .map(item => {
        const matchedInventoryItem = findInventoryMatchByName(item.ingredientName, inventoryRows);
        const recipeUnit = normalizeUnit(item.unitType);
        const inventoryUnit = normalizeUnit(matchedInventoryItem?.unitType);
        const canUseInventoryCost = Boolean(matchedInventoryItem) && recipeUnit !== "" && recipeUnit === inventoryUnit;
        const inventoryCostPerUnit = canUseInventoryCost ? toNumber(matchedInventoryItem?.costPerUnit) : 0;
        const recipeCostPerUnit = toNumber(item.costPerUnit);
        const resolvedCostPerUnit = inventoryCostPerUnit > 0
          ? inventoryCostPerUnit
          : recipeCostPerUnit;
        const calculatedTotalCost = resolvedCostPerUnit > 0
          ? toNumber(item.quantity) * resolvedCostPerUnit
          : toNumber(item.totalCost);
        const costSource = inventoryCostPerUnit > 0
          ? "inventory"
          : recipeCostPerUnit > 0
            ? "recipe"
            : "missing";

        return {
          id: item.id,
          ingredientName: item.ingredientName,
          quantity: toNumber(item.quantity),
          unitType: item.unitType,
          inventoryItemId: matchedInventoryItem?.id ?? item.inventoryItemId ?? null,
          inventoryItemName: matchedInventoryItem?.itemName ?? null,
          matchedInventoryUnit: matchedInventoryItem?.unitType ?? null,
          costPerUnit: resolvedCostPerUnit,
          totalCost: calculatedTotalCost,
          costSource,
          processSteps: item.processSteps ?? "",
        };
      });

    const batchCost = ingredients.reduce((sum, item) => sum + item.totalCost, 0);
    const batchYieldOunces = toNumber(recipe.batchYieldOunces);

    return {
      id: recipe.id,
      name: recipe.name,
      batchYieldOunces,
      batchCost,
      costPerOunce: batchYieldOunces > 0 ? batchCost / batchYieldOunces : null,
      notes: recipe.notes ?? "",
      processSteps: recipe.processSteps ?? "",
      ingredients,
      missingCostCount: ingredients.filter(item => item.costSource === "missing").length,
    };
  });
}

export async function listRecipesWithCosts() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await ensureInventorySeeded();
  await ensureRecipesSeeded();

  const [recipeRows, ingredientRows, inventoryRows] = await Promise.all([
    db.select().from(recipes).orderBy(recipes.name),
    db.select().from(recipeIngredients).orderBy(recipeIngredients.recipeId, recipeIngredients.sortOrder, recipeIngredients.id),
    db.select().from(inventoryItems),
  ]);

  return buildRecipeCostSummaries(recipeRows, ingredientRows, inventoryRows);
}

export async function getDailyOperationsSnapshot(businessDate?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalizedDate = normalizeDate(businessDate);
  const [openingEntries, closingEntries, reports, gelatoRows, inventoryRows] = await Promise.all([
    db.select().from(openingChecklists).where(eq(openingChecklists.businessDate, normalizedDate)).orderBy(desc(openingChecklists.createdAt)),
    db.select().from(closingChecklists).where(eq(closingChecklists.businessDate, normalizedDate)).orderBy(desc(closingChecklists.createdAt)),
    db.select().from(endOfDayReports).where(eq(endOfDayReports.businessDate, normalizedDate)).orderBy(desc(endOfDayReports.createdAt)),
    db.select().from(readyMadeGelatoWeights).where(eq(readyMadeGelatoWeights.businessDate, normalizedDate)).orderBy(readyMadeGelatoWeights.flavor, readyMadeGelatoWeights.shiftType),
    db.select().from(inventoryItems),
  ]);

  return buildDailySnapshot(openingEntries, closingEntries, reports, gelatoRows, inventoryRows, normalizedDate);
}

export async function getSalesTrend(days = 28) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const reports = await db.select().from(endOfDayReports).orderBy(endOfDayReports.businessDate, endOfDayReports.createdAt);
  const perDay = new Map<string, { businessDate: string; totalSales: number }>();

  for (const report of reports) {
    const totalSales = toNumber(report.cashTotal) + toNumber(report.cardTotal) + toNumber(report.zelleTotal) + toNumber(report.venmoTotal);
    const current = perDay.get(report.businessDate) ?? { businessDate: report.businessDate, totalSales: 0 };
    current.totalSales += totalSales;
    perDay.set(report.businessDate, current);
  }

  return Array.from(perDay.values()).slice(-days);
}

export async function getWeekOverWeekSales() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const reports = await db.select().from(endOfDayReports).orderBy(endOfDayReports.businessDate);
  return buildWeekOverWeekSeries(reports);
}

export async function getInventoryAlerts() {
  const items = await listInventoryItems();
  return items
    .filter(item => item.reorderNeeded)
    .map(item => ({
      id: item.id,
      department: item.department,
      category: item.category,
      itemName: item.itemName,
      unitType: item.unitType,
      packSize: item.packSize,
      currentQuantity: item.currentQuantity,
      parLevel: item.parLevel,
      reorderQuantity: item.reorderQuantity,
      reorderAmount: Math.max(item.reorderQuantity || item.parLevel - item.currentQuantity, 0),
      supplier: item.supplier,
      supplierContact: item.supplierContact,
      notes: item.notes ?? "",
    }));
}

export async function getRecentNotes(limit = 12) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [reports, closings] = await Promise.all([
    db.select().from(endOfDayReports).orderBy(desc(endOfDayReports.createdAt)).limit(50),
    db.select().from(closingChecklists).orderBy(desc(closingChecklists.createdAt)).limit(50),
  ]);

  return buildRecentNotesFeed(reports, closings, limit);
}
