import { useAuth } from "@/_core/hooks/useAuth";
import { type PortalLanguage, translateErrorMessage, translatePortalText } from "@/lib/employeePortalI18n";
import { compressImageFileToDataUrl } from "@/lib/imageCompression";
import { getOpeningNapkinsQuestion, groupOpeningQuestionsForPortal } from "@/lib/openingSetup";
import { savePortalDraft, loadPortalDraft, clearPortalDraft } from "@/lib/portalDrafts";
import { normalizeGelatoFlavorName } from "@/lib/gelatoFlavorAliases";
import { getReplacementConfirmationMessage, getResubmissionReplacementDescription, type SubmissionViewKey } from "@/lib/submissionReplacement";
import { formatPacificCalendarDate, formatPacificTime, getPacificBusinessDate } from "../../../shared/businessDate";
import { trpc } from "@/lib/trpc";
import { ArrowRight, ClipboardCheck, House, LoaderCircle, LogOut, MoonStar, Package2, ReceiptText, Save, SunMedium, Upload, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
import { READY_MADE_GELATO_FLAVORS } from "../../../shared/opsCatalog";

type YesNo = "Yes" | "No";
type PortalView = "hub" | "opening" | "closing" | "inventory";
type TimeClockStaffName = "Karol" | "Anhec" | "Jesse" | "Esme";

type SubmissionNotice = {
  view: SubmissionViewKey;
  title: string;
  detail: string;
};

type ChecklistQuestion = {
  id: number;
  checklistType: "opening" | "closing";
  sectionTitle: string;
  prompt: string;
  detailPrompt: string | null;
  detailTrigger: "Yes" | "No" | "Never";
  displayOrder: number;
  isActive: number;
};

type ChecklistAnswerState = Record<number, { answer: YesNo; detail: string }>;

type OpeningStockCounts = {
  cups4oz: string;
  cups8oz: string;
  cupsPint: string;
  cupsLiter: string;
  lids4oz: string;
  lids8oz: string;
  lidsPint: string;
  lidsLiter: string;
  spoons: string;
};

type OpeningForm = {
  businessDate: string;
  staffName: string;
  startingCash: string;
  cashCountedAndCorrect: YesNo;
  stockCounts: OpeningStockCounts;
  notes: string;
};

type ClosingForm = {
  businessDate: string;
  staffName: string;
  cashCounted: string;
  cashMatchesSystem: YesNo;
  notes: string;
  cups4ozHere: string;
  cups4ozToGo: string;
  cups8ozHere: string;
  cups8ozToGo: string;
  cupsPintHere: string;
  cupsPintToGo: string;
  cupsLiterHere: string;
  cupsLiterToGo: string;
  cashTotal: string;
  cardTotal: string;
  zelleTotal: string;
  venmoTotal: string;
  wasteNotes: string;
  lowItemNotes: string;
  generalNotes: string;
};

type ReadyMadeGelatoShiftKey = "opening" | "closing";

type ReadyMadeGelatoShiftState = {
  smallPanCount: string;
  smallGrossWeightKg: string;
  largePanCount: string;
  largeGrossWeightKg: string;
};

type ReadyMadeGelatoFlavorState = {
  opening: ReadyMadeGelatoShiftState;
  closing: ReadyMadeGelatoShiftState;
};

type ReadyMadeGelatoState = {
  businessDate: string;
  flavors: Record<string, ReadyMadeGelatoFlavorState>;
};

type GelatoEntryMode = "manual" | "photo";
type AnalyzedPhotoPanSetup = "small" | "large" | "small_large" | "double_small" | "double_large" | "needs_review";

type ExtractedGelatoPhoto = {
  fileName: string;
  imageUrl: string;
  imageKey?: string;
  flavor: string;
  smallPanCount: number;
  largePanCount: number;
  combinedGrossWeightKg: number;
  combinedGrossWeightInput?: string;
  confidence: "high" | "medium" | "low";
  warning: string;
};

type OpeningDraft = {
  form: OpeningForm;
  answers: ChecklistAnswerState;
  gelatoOpening: Record<string, ReadyMadeGelatoShiftState>;
  gelatoOpeningMode?: GelatoEntryMode;
  gelatoOpeningPhotos?: ExtractedGelatoPhoto[];
};

type ClosingDraft = {
  form: ClosingForm;
  answers: ChecklistAnswerState;
  serviceInventoryCounts: Record<number, string>;
  gelatoClosing: Record<string, ReadyMadeGelatoShiftState>;
  gelatoClosingMode?: GelatoEntryMode;
  gelatoClosingPhotos?: ExtractedGelatoPhoto[];
};

type InventoryDraft = {
  serviceInventoryCounts: Record<number, string>;
  gelatoOpening: Record<string, ReadyMadeGelatoShiftState>;
  gelatoOpeningMode?: GelatoEntryMode;
  gelatoOpeningPhotos?: ExtractedGelatoPhoto[];
};

type DraftSavedAtState = Partial<Record<Exclude<PortalView, "hub">, number>>;

type DeviceDraftSummary = {
  view: Exclude<PortalView, "hub">;
  href: string;
  label: string;
  savedAt: number;
  savedAtLabel: string;
  draftKey: typeof openingDraftKey | typeof closingDraftKey | typeof inventoryDraftKey;
};

type PairedInputConfig = {
  label: string;
  stockKey?: keyof OpeningStockCounts;
  itemName?: string;
};

export const GELATO_WEIGHT_INPUT_STEP = "0.001";
export const GELATO_WEIGHT_INPUT_MODE = "decimal" as const;
export const GELATO_PHOTO_UPLOAD_LIMIT = 20;

const KG_TO_WEIGHT_OUNCES = 35.27396195;
const SMALL_PAN_EMPTY_KG = 0.286;
const LARGE_PAN_EMPTY_KG = 0.4;
const SMALL_PAN_FULL_GROSS_KG = 3.5;
const LARGE_PAN_FULL_GROSS_KG = 4.5;
const SMALL_PAN_FULL_WEIGHT_OUNCES = (SMALL_PAN_FULL_GROSS_KG - SMALL_PAN_EMPTY_KG) * KG_TO_WEIGHT_OUNCES;
const LARGE_PAN_FULL_WEIGHT_OUNCES = (LARGE_PAN_FULL_GROSS_KG - LARGE_PAN_EMPTY_KG) * KG_TO_WEIGHT_OUNCES;
const SMALL_PAN_FULL_VOLUME_OUNCES = 112;
const LARGE_PAN_FULL_VOLUME_OUNCES = 160;

const openingDraftKey = "opening" as const;
const closingDraftKey = "closing" as const;
const inventoryDraftKey = "inventory" as const;
const TIME_CLOCK_STAFF_NAMES: TimeClockStaffName[] = ["Karol", "Anhec", "Jesse", "Esme"];

function todayValue(date = new Date()) {
  return getPacificBusinessDate(date);
}

function displayNumberValue(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return "";
  return String(value);
}

function roundTo(value: number, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatTimeClockLabel(timestamp: number | null | undefined, locale: Intl.LocalesArgument) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat(locale, {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function limitGelatoPhotoBatch<T>(items: T[]) {
  return items.slice(0, GELATO_PHOTO_UPLOAD_LIMIT);
}

export function getAnalyzedPhotoCombinedGrossWeightKg(
  photo: Pick<ExtractedGelatoPhoto, "combinedGrossWeightKg" | "combinedGrossWeightInput">
) {
  if (typeof photo.combinedGrossWeightInput === "string") {
    const trimmed = photo.combinedGrossWeightInput.trim();
    if (!trimmed) return 0;
    const normalized = trimmed.replace(/,/g, ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  return Number.isFinite(photo.combinedGrossWeightKg) && photo.combinedGrossWeightKg >= 0 ? photo.combinedGrossWeightKg : 0;
}

export function resolveAnalyzedPhotoGrossWeights(photo: Pick<ExtractedGelatoPhoto, "smallPanCount" | "largePanCount" | "combinedGrossWeightKg" | "combinedGrossWeightInput">) {
  const smallPanCount = Math.max(0, Math.trunc(photo.smallPanCount));
  const largePanCount = Math.max(0, Math.trunc(photo.largePanCount));
  const combinedGrossWeightKg = Math.max(0, getAnalyzedPhotoCombinedGrossWeightKg(photo));

  if (combinedGrossWeightKg <= 0 || (smallPanCount === 0 && largePanCount === 0)) {
    return {
      smallPanCount,
      smallGrossWeightKg: 0,
      largePanCount,
      largeGrossWeightKg: 0,
    };
  }

  const totalNetWeightKg = Math.max(
    0,
    combinedGrossWeightKg - smallPanCount * SMALL_PAN_EMPTY_KG - largePanCount * LARGE_PAN_EMPTY_KG
  );
  const smallCapacityWeightKg = smallPanCount * (SMALL_PAN_FULL_WEIGHT_OUNCES / KG_TO_WEIGHT_OUNCES);
  const largeCapacityWeightKg = largePanCount * (LARGE_PAN_FULL_WEIGHT_OUNCES / KG_TO_WEIGHT_OUNCES);
  const totalCapacityWeightKg = smallCapacityWeightKg + largeCapacityWeightKg;
  const smallNetWeightKg =
    totalCapacityWeightKg > 0 ? totalNetWeightKg * (smallCapacityWeightKg / totalCapacityWeightKg) : 0;
  const largeNetWeightKg = Math.max(0, totalNetWeightKg - smallNetWeightKg);

  return {
    smallPanCount,
    smallGrossWeightKg: roundTo(smallPanCount * SMALL_PAN_EMPTY_KG + smallNetWeightKg),
    largePanCount,
    largeGrossWeightKg: roundTo(largePanCount * LARGE_PAN_EMPTY_KG + largeNetWeightKg),
  };
}

export function getAnalyzedPhotoPanSetup(photo: Pick<ExtractedGelatoPhoto, "smallPanCount" | "largePanCount">): AnalyzedPhotoPanSetup {
  if (photo.smallPanCount > 0 && photo.largePanCount > 0) return "small_large";
  if (photo.smallPanCount >= 2) return "double_small";
  if (photo.largePanCount >= 2) return "double_large";
  if (photo.smallPanCount > 0) return "small";
  if (photo.largePanCount > 0) return "large";
  return "needs_review";
}

export function applyAnalyzedPhotoPanSetup(setup: AnalyzedPhotoPanSetup) {
  if (setup === "small") {
    return { smallPanCount: 1, largePanCount: 0 };
  }

  if (setup === "large") {
    return { smallPanCount: 0, largePanCount: 1 };
  }

  if (setup === "small_large") {
    return { smallPanCount: 1, largePanCount: 1 };
  }

  if (setup === "double_small") {
    return { smallPanCount: 2, largePanCount: 0 };
  }

  if (setup === "double_large") {
    return { smallPanCount: 0, largePanCount: 2 };
  }

  return { smallPanCount: 0, largePanCount: 0 };
}

function analyzedPhotoConfidenceClassName(confidence: ExtractedGelatoPhoto["confidence"]) {
  if (confidence === "high") return "bg-[#dbe9df] text-[#244233]";
  if (confidence === "medium") return "bg-[#f4e6c9] text-[#6c4f1f]";
  return "bg-[#f7d8d2] text-[#7c3428]";
}

export function applyAnalyzedPhotosToGelatoState(
  current: ReadyMadeGelatoState,
  shiftType: ReadyMadeGelatoShiftKey,
  photos: ExtractedGelatoPhoto[]
) {
  const summarizedByFlavor = new Map<string, ReturnType<typeof resolveAnalyzedPhotoGrossWeights>>();

  for (const photo of photos) {
    const flavor = normalizeGelatoFlavorName(photo.flavor);
    if (!flavor) continue;

    const resolved = resolveAnalyzedPhotoGrossWeights(photo);
    const existing = summarizedByFlavor.get(flavor);

    summarizedByFlavor.set(flavor, {
      smallPanCount: (existing?.smallPanCount ?? 0) + resolved.smallPanCount,
      smallGrossWeightKg: roundTo((existing?.smallGrossWeightKg ?? 0) + resolved.smallGrossWeightKg),
      largePanCount: (existing?.largePanCount ?? 0) + resolved.largePanCount,
      largeGrossWeightKg: roundTo((existing?.largeGrossWeightKg ?? 0) + resolved.largeGrossWeightKg),
    });
  }

  if (summarizedByFlavor.size === 0) return current;

  const nextFlavors = { ...current.flavors };

  for (const [flavor, resolved] of Array.from(summarizedByFlavor.entries())) {
    nextFlavors[flavor] = {
      ...(nextFlavors[flavor] ?? {
        opening: initialReadyMadeGelatoShiftState(),
        closing: initialReadyMadeGelatoShiftState(),
      }),
      [shiftType]: {
        smallPanCount: displayNumberValue(resolved.smallPanCount),
        smallGrossWeightKg: displayNumberValue(resolved.smallGrossWeightKg),
        largePanCount: displayNumberValue(resolved.largePanCount),
        largeGrossWeightKg: displayNumberValue(resolved.largeGrossWeightKg),
      },
    };
  }

  return {
    ...current,
    flavors: nextFlavors,
  };
}

export function removePhotoAtIndex<T>(items: T[], indexToRemove: number) {
  return items.filter((_, index) => index !== indexToRemove);
}

export function replaceAnalyzedPhotosInGelatoState(
  current: ReadyMadeGelatoState,
  shiftType: ReadyMadeGelatoShiftKey,
  photos: ExtractedGelatoPhoto[]
) {
  const resetFlavors = Object.fromEntries(
    Object.entries(current.flavors).map(([flavor, shifts]) => [
      flavor,
      {
        ...shifts,
        [shiftType]: initialReadyMadeGelatoShiftState(),
      },
    ])
  ) as Record<string, ReadyMadeGelatoFlavorState>;

  return applyAnalyzedPhotosToGelatoState(
    {
      ...current,
      flavors: resetFlavors,
    },
    shiftType,
    photos,
  );
}

function cloneShiftState(shift?: Partial<ReadyMadeGelatoShiftState>): ReadyMadeGelatoShiftState {
  return {
    smallPanCount: shift?.smallPanCount ?? "",
    smallGrossWeightKg: shift?.smallGrossWeightKg ?? "",
    largePanCount: shift?.largePanCount ?? "",
    largeGrossWeightKg: shift?.largeGrossWeightKg ?? "",
  };
}

function mergeShiftState(
  existing: ReadyMadeGelatoShiftState | undefined,
  incoming: ReadyMadeGelatoShiftState | undefined,
): ReadyMadeGelatoShiftState {
  return {
    smallPanCount: existing?.smallPanCount || incoming?.smallPanCount || "",
    smallGrossWeightKg: existing?.smallGrossWeightKg || incoming?.smallGrossWeightKg || "",
    largePanCount: existing?.largePanCount || incoming?.largePanCount || "",
    largeGrossWeightKg: existing?.largeGrossWeightKg || incoming?.largeGrossWeightKg || "",
  };
}

function normalizeGelatoFlavorStateMap(
  flavors: Record<string, ReadyMadeGelatoFlavorState>,
): Record<string, ReadyMadeGelatoFlavorState> {
  const normalized: Record<string, ReadyMadeGelatoFlavorState> = {};

  for (const [flavor, shifts] of Object.entries(flavors)) {
    const normalizedFlavor = normalizeGelatoFlavorName(flavor);
    if (!normalizedFlavor) continue;

    normalized[normalizedFlavor] = {
      opening: mergeShiftState(normalized[normalizedFlavor]?.opening, cloneShiftState(shifts.opening)),
      closing: mergeShiftState(normalized[normalizedFlavor]?.closing, cloneShiftState(shifts.closing)),
    };
  }

  return normalized;
}

function extractGelatoShiftDraft(readyMadeGelato: ReadyMadeGelatoState, shiftType: ReadyMadeGelatoShiftKey) {
  return Object.fromEntries(
    Object.entries(readyMadeGelato.flavors).map(([flavor, shifts]) => [flavor, cloneShiftState(shifts[shiftType])]),
  ) as Record<string, ReadyMadeGelatoShiftState>;
}

export function applyGelatoShiftDraft(
  current: ReadyMadeGelatoState,
  shiftType: ReadyMadeGelatoShiftKey,
  draftFlavors: Record<string, ReadyMadeGelatoShiftState>,
  businessDate: string,
) {
  const normalizedCurrentFlavors = normalizeGelatoFlavorStateMap(current.flavors);
  const normalizedDraftFlavors = Object.fromEntries(
    Object.entries(draftFlavors)
      .map(([flavor, shift]) => [normalizeGelatoFlavorName(flavor), cloneShiftState(shift)] as const)
      .filter(([flavor]) => Boolean(flavor)),
  ) as Record<string, ReadyMadeGelatoShiftState>;

  return {
    ...current,
    businessDate,
    flavors: Object.fromEntries(
      Array.from(new Set([...Object.keys(normalizedCurrentFlavors), ...Object.keys(normalizedDraftFlavors)])).map(flavor => [
        flavor,
        {
          ...(normalizedCurrentFlavors[flavor] ?? {
            opening: initialReadyMadeGelatoShiftState(),
            closing: initialReadyMadeGelatoShiftState(),
          }),
          [shiftType]: cloneShiftState(normalizedDraftFlavors[flavor]),
        },
      ]),
    ) as Record<string, ReadyMadeGelatoFlavorState>,
  };
}

export function summarizeAnalyzedPhotosForSubmission(photos: ExtractedGelatoPhoto[]) {
  const photoTotalsByFlavor = new Map<string, {
    smallPanCount: number;
    smallGrossWeightKg: number;
    largePanCount: number;
    largeGrossWeightKg: number;
    combinedGrossWeightKg: number;
  }>();

  for (const photo of photos) {
    const flavor = normalizeGelatoFlavorName(photo.flavor);
    if (!flavor) continue;

    const resolved = resolveAnalyzedPhotoGrossWeights(photo);
    const existing = photoTotalsByFlavor.get(flavor);
    photoTotalsByFlavor.set(flavor, {
      smallPanCount: (existing?.smallPanCount ?? 0) + resolved.smallPanCount,
      smallGrossWeightKg: roundTo((existing?.smallGrossWeightKg ?? 0) + resolved.smallGrossWeightKg),
      largePanCount: (existing?.largePanCount ?? 0) + resolved.largePanCount,
      largeGrossWeightKg: roundTo((existing?.largeGrossWeightKg ?? 0) + resolved.largeGrossWeightKg),
      combinedGrossWeightKg: roundTo((existing?.combinedGrossWeightKg ?? 0) + resolved.smallGrossWeightKg + resolved.largeGrossWeightKg),
    });
  }

  return photoTotalsByFlavor;
}

export function getAnalyzedPhotoPanTareKg(photo: Pick<ExtractedGelatoPhoto, "smallPanCount" | "largePanCount">) {
  const smallPanCount = Math.max(0, Math.trunc(photo.smallPanCount));
  const largePanCount = Math.max(0, Math.trunc(photo.largePanCount));
  return roundTo(smallPanCount * SMALL_PAN_EMPTY_KG + largePanCount * LARGE_PAN_EMPTY_KG);
}

export function estimateAnalyzedPhotoNetWeightKg(
  photo: Pick<ExtractedGelatoPhoto, "smallPanCount" | "largePanCount" | "combinedGrossWeightKg" | "combinedGrossWeightInput">
) {
  return roundTo(Math.max(0, getAnalyzedPhotoCombinedGrossWeightKg(photo) - getAnalyzedPhotoPanTareKg(photo)));
}

export function estimateAnalyzedPhotoVolumeOunces(
  photo: Pick<ExtractedGelatoPhoto, "smallPanCount" | "largePanCount" | "combinedGrossWeightKg" | "combinedGrossWeightInput">
) {
  const resolved = resolveAnalyzedPhotoGrossWeights(photo);
  const smallNetWeightKg = Math.max(0, resolved.smallGrossWeightKg - resolved.smallPanCount * SMALL_PAN_EMPTY_KG);
  const largeNetWeightKg = Math.max(0, resolved.largeGrossWeightKg - resolved.largePanCount * LARGE_PAN_EMPTY_KG);
  const smallWeightOunces = smallNetWeightKg * KG_TO_WEIGHT_OUNCES;
  const largeWeightOunces = largeNetWeightKg * KG_TO_WEIGHT_OUNCES;

  return roundTo(
    smallWeightOunces * (SMALL_PAN_FULL_VOLUME_OUNCES / SMALL_PAN_FULL_WEIGHT_OUNCES) +
      largeWeightOunces * (LARGE_PAN_FULL_VOLUME_OUNCES / LARGE_PAN_FULL_WEIGHT_OUNCES)
  );
}

const initialOpeningStockCounts = (): OpeningStockCounts => ({
  cups4oz: "",
  cups8oz: "",
  cupsPint: "",
  cupsLiter: "",
  lids4oz: "",
  lids8oz: "",
  lidsPint: "",
  lidsLiter: "",
  spoons: "",
});

const initialOpeningForm = (): OpeningForm => ({
  businessDate: todayValue(),
  staffName: "",
  startingCash: "",
  cashCountedAndCorrect: "No",
  stockCounts: initialOpeningStockCounts(),
  notes: "",
});

const initialClosingForm = (): ClosingForm => ({
  businessDate: todayValue(),
  staffName: "",
  cashCounted: "",
  cashMatchesSystem: "No",
  notes: "",
  cups4ozHere: "",
  cups4ozToGo: "",
  cups8ozHere: "",
  cups8ozToGo: "",
  cupsPintHere: "",
  cupsPintToGo: "",
  cupsLiterHere: "",
  cupsLiterToGo: "",
  cashTotal: "",
  cardTotal: "",
  zelleTotal: "",
  venmoTotal: "",
  wasteNotes: "",
  lowItemNotes: "",
  generalNotes: "",
});

export const initialReadyMadeGelatoShiftState = (): ReadyMadeGelatoShiftState => ({
  smallPanCount: "",
  smallGrossWeightKg: "",
  largePanCount: "",
  largeGrossWeightKg: "",
});

export const initialReadyMadeGelatoState = (businessDate = todayValue()): ReadyMadeGelatoState => ({
  businessDate,
  flavors: Object.fromEntries(
    READY_MADE_GELATO_FLAVORS.map(flavor => [
      flavor,
      {
        opening: initialReadyMadeGelatoShiftState(),
        closing: initialReadyMadeGelatoShiftState(),
      },
    ]),
  ) as Record<string, ReadyMadeGelatoFlavorState>,
});

export const serviceInventoryPairs: Array<{ left: PairedInputConfig; right?: PairedInputConfig }> = [
  {
    left: { label: "4oz Cups", stockKey: "cups4oz", itemName: "4oz To-Go Cups" },
  },
  {
    left: { label: "8oz Cups", stockKey: "cups8oz", itemName: "8oz To-Go Cups" },
    right: { label: "8oz Lids", stockKey: "lids8oz", itemName: "8oz To-Go Lids" },
  },
  {
    left: { label: "16oz Cups", stockKey: "cupsPint", itemName: "16oz To-Go Cups" },
    right: { label: "16oz Lids", stockKey: "lidsPint", itemName: "16oz To-Go Lids" },
  },
  {
    left: { label: "32oz Cups", stockKey: "cupsLiter", itemName: "32oz To-Go Cups" },
    right: { label: "32oz Lids", stockKey: "lidsLiter", itemName: "32oz To-Go Lids" },
  },
  {
    left: { label: "Bamboo Spoons", stockKey: "spoons", itemName: "Bamboo To-Go Spoons" },
    right: { label: "Edible Spoons", itemName: "Edible Spoons" },
  },
  {
    left: { label: "Dine-In Spoons", itemName: "Dine-In Metal Spoons" },
    right: { label: "To-Go Bags", itemName: "To-Go Bags" },
  },
];

const endOfDayCupRows: Array<{
  label: string;
  hereKey: keyof ClosingForm;
  toGoKey: keyof ClosingForm;
}> = [
  { label: "4oz", hereKey: "cups4ozHere", toGoKey: "cups4ozToGo" },
  { label: "8oz", hereKey: "cups8ozHere", toGoKey: "cups8ozToGo" },
  { label: "Pint", hereKey: "cupsPintHere", toGoKey: "cupsPintToGo" },
  { label: "Liter", hereKey: "cupsLiterHere", toGoKey: "cupsLiterToGo" },
];

function inputClassName() {
  return "h-12 rounded-2xl border border-[#dbd2c5] bg-[#fcfaf6] px-4 text-sm text-[#2f2a26] shadow-sm outline-none transition focus:border-[#5b5045] focus:ring-4 focus:ring-[#5b5045]/10";
}

function smallInputClassName() {
  return "h-10 w-full rounded-xl border border-[#dbd2c5] bg-[#fcfaf6] px-3 text-sm text-[#2f2a26] shadow-sm outline-none transition focus:border-[#5b5045] focus:ring-4 focus:ring-[#5b5045]/10";
}

function textareaClassName() {
  return "min-h-[120px] rounded-2xl border border-[#dbd2c5] bg-[#fcfaf6] px-4 py-3 text-sm text-[#2f2a26] shadow-sm outline-none transition focus:border-[#5b5045] focus:ring-4 focus:ring-[#5b5045]/10";
}

const SectionCard = memo(function SectionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-[2rem] border border-white/70 bg-white p-6 shadow-[0_16px_40px_rgba(88,83,72,0.07)] md:p-8">
      <div className="mb-6 flex min-w-0 items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ece4d7] text-[#5d544a]">{icon}</div>
        <div>
          <h2 className="text-2xl font-medium tracking-[-0.04em] text-[#2d2925]">{title}</h2>
          {description ? <p className="mt-2 max-w-3xl text-sm leading-7 text-[#6b6258]">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
});

const Field = memo(function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-[#2f2a26]">{label}</span>
      {children}
      {hint ? <span className="text-xs text-[#8b8176]">{hint}</span> : null}
    </label>
  );
});

const ToggleField = memo(function ToggleField({
  label,
  value,
  onChange,
  language,
}: {
  label: string;
  value: YesNo;
  onChange: (next: YesNo) => void;
  language: PortalLanguage;
  }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-[#2f2a26]">{label}</span>
      <div className="flex gap-2">
        {(["Yes", "No"] as const).map(option => {
          const active = value === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                active ? "bg-[#2f2a26] text-white" : "border border-[#ddd4c8] bg-white text-[#2f2a26] hover:bg-[#f5eee5]"
              }`}
            >
              {translatePortalText(option, language)}
            </button>
          );
        })}
      </div>
    </div>
  );
});

const ChecklistQuestionRow = memo(function ChecklistQuestionRow({

  question,
  state,
  onChange,
  language,
}: {
  question: ChecklistQuestion;
  state: { answer: YesNo; detail: string };
  onChange: (next: { answer: YesNo; detail: string }) => void;
  language: PortalLanguage;
}) {
  const showDetail = question.detailTrigger !== "Never" && state.answer === question.detailTrigger;

  return (
    <div className="rounded-[1.5rem] border border-[#e8ddd0] bg-[#fbf7f1] p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-medium text-[#2f2a26]">{translatePortalText(question.prompt, language)}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.24em] text-[#8a8176]">{translatePortalText(question.sectionTitle, language)}</p>
        </div>
        <div className="flex gap-2">
          {(["Yes", "No"] as const).map(option => {
            const active = state.answer === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onChange({ ...state, answer: option })}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  active ? "bg-[#2f2a26] text-white" : "border border-[#ddd4c8] bg-white text-[#2f2a26] hover:bg-[#f5eee5]"
                }`}
              >
                {translatePortalText(option, language)}
              </button>
            );
          })}
        </div>
      </div>
      {showDetail ? (
        <div className="mt-4">
          <Field label={translatePortalText(question.detailPrompt || "Please explain", language)}>
            <textarea
              className={textareaClassName()}
              value={state.detail}
              onChange={event => onChange({ ...state, detail: event.target.value })}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
});

function buildAnswersPayload(questions: ChecklistQuestion[], answers: ChecklistAnswerState) {
  return questions.map(question => ({
    questionId: question.id,
    sectionTitle: question.sectionTitle,
    prompt: question.prompt,
    answer: answers[question.id]?.answer ?? "No",
    detail: answers[question.id]?.detail ?? "",
  }));
}

export default function EmployeePortal(props: any) {
  const { defaultView } = props as { defaultView?: PortalView };
  const { loading, logout } = useAuth({ redirectOnUnauthenticated: true, redirectPath: "/staff-login" });
  const utils = trpc.useUtils();
  const [location] = useLocation();
  const [language, setLanguage] = useState<PortalLanguage>("en");
  const [liveNow, setLiveNow] = useState(() => new Date());
  const t = (text: string) => translatePortalText(text, language);
  const locale = language === "es" ? "es-US" : "en-US";
  const currentBusinessDate = useMemo(() => todayValue(liveNow), [liveNow]);
  const currentPacificDateLabel = useMemo(() => formatPacificCalendarDate(liveNow, locale), [liveNow, locale]);
  const currentPacificTimeLabel = useMemo(() => formatPacificTime(liveNow, locale), [liveNow, locale]);
  const portalView: PortalView =
    defaultView ??
    (location.endsWith("/inventory") ? "inventory" : location.endsWith("/closing") ? "closing" : location.endsWith("/opening") ? "opening" : "hub");

  const [openingForm, setOpeningForm] = useState<OpeningForm>(initialOpeningForm);
  const [closingForm, setClosingForm] = useState<ClosingForm>(initialClosingForm);
  const [openingAnswers, setOpeningAnswers] = useState<ChecklistAnswerState>({});
  const [closingAnswers, setClosingAnswers] = useState<ChecklistAnswerState>({});
  const [serviceInventoryCounts, setServiceInventoryCounts] = useState<Record<number, string>>({});
  const [readyMadeGelato, setReadyMadeGelato] = useState<ReadyMadeGelatoState>(() => initialReadyMadeGelatoState());
  const [gelatoEntryMode, setGelatoEntryMode] = useState<Record<ReadyMadeGelatoShiftKey, GelatoEntryMode>>({
    opening: "manual",
    closing: "manual",
  });
  const [gelatoPhotoFiles, setGelatoPhotoFiles] = useState<Record<ReadyMadeGelatoShiftKey, File[]>>({
    opening: [],
    closing: [],
  });
  const [gelatoAnalyzedPhotos, setGelatoAnalyzedPhotos] = useState<Record<ReadyMadeGelatoShiftKey, ExtractedGelatoPhoto[]>>({
    opening: [],
    closing: [],
  });
  const [otherFlavorName, setOtherFlavorName] = useState("");
  const [submissionNotice, setSubmissionNotice] = useState<SubmissionNotice | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<DraftSavedAtState>({});
  const [selectedClockStaffName, setSelectedClockStaffName] = useState<TimeClockStaffName | null>(null);
  const currentDeviceDrafts: DeviceDraftSummary[] = [
    { view: "opening" as const, href: "/portal/opening", label: t("Opening Form"), record: loadPortalDraft<OpeningDraft>(openingDraftKey, currentBusinessDate) },
    { view: "closing" as const, href: "/portal/closing", label: t("Closing Form"), record: loadPortalDraft<ClosingDraft>(closingDraftKey, currentBusinessDate) },
    { view: "inventory" as const, href: "/portal/inventory", label: t("Inventory Form"), record: loadPortalDraft<InventoryDraft>(inventoryDraftKey, currentBusinessDate) },
  ]
    .flatMap(draft =>
      draft.record
        ? [{
            view: draft.view,
            href: draft.href,
            label: draft.label,
            draftKey: draft.view === "opening" ? openingDraftKey : draft.view === "closing" ? closingDraftKey : inventoryDraftKey,
            savedAt: draft.record.savedAt,
            savedAtLabel: new Date(draft.record.savedAt).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }),
          }]
        : []
    )
    .sort((left, right) => right.savedAt - left.savedAt);
  const openingStaffNameRef = useRef<HTMLInputElement | null>(null);
  const closingStaffNameRef = useRef<HTMLInputElement | null>(null);
  const openingPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const closingPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const didAttemptOpeningDraftRestore = useRef(false);
  const didAttemptClosingDraftRestore = useRef(false);
  const didAttemptInventoryDraftRestore = useRef(false);
  const hasOpeningDraftRestored = useRef(false);
  const hasClosingDraftRestored = useRef(false);
  const hasInventoryDraftRestored = useRef(false);

  const openingQuestionsQuery = trpc.forms.checklistQuestions.useQuery({ checklistType: "opening" });
  const closingQuestionsQuery = trpc.forms.checklistQuestions.useQuery({ checklistType: "closing" });
  const inventoryItemsQuery = trpc.forms.inventoryItems.useQuery();
  const readyMadeGelatoQuery = trpc.forms.readyMadeGelatoWeights.useQuery({ businessDate: currentBusinessDate });
  const submissionStatusQuery = trpc.forms.submissionStatus.useQuery(
    { businessDate: currentBusinessDate },
    { refetchOnWindowFocus: false }
  );
  const timeclockStatusQuery = trpc.timeclock.todayStatus.useQuery(
    { businessDate: currentBusinessDate },
    { refetchOnWindowFocus: false }
  );

  const openingMutation = trpc.forms.submitOpening.useMutation({
    onError: error => toast.error(translateErrorMessage(error.message, language)),
  });
  const closingMutation = trpc.forms.submitClosing.useMutation({
    onError: error => toast.error(translateErrorMessage(error.message, language)),
  });
  const endOfDayMutation = trpc.forms.submitEndOfDay.useMutation({
    onError: error => toast.error(translateErrorMessage(error.message, language)),
  });
  const inventoryMutation = trpc.forms.submitInventoryUpdate.useMutation({
    onError: error => toast.error(translateErrorMessage(error.message, language)),
  });
  const extractGelatoPhotosMutation = trpc.forms.extractGelatoPhotos.useMutation({
    onError: error => toast.error(translateErrorMessage(error.message, language)),
  });
  const readyMadeGelatoMutation = trpc.forms.submitReadyMadeGelato.useMutation({
    onError: error => toast.error(translateErrorMessage(error.message, language)),
  });
  const inventorySummaryMutation = trpc.forms.submitInventorySubmissionSummary.useMutation({
    onError: error => toast.error(translateErrorMessage(error.message, language)),
  });
  const submissionHistoryMutation = trpc.forms.submitSubmissionHistory.useMutation({
    onError: error => toast.error(translateErrorMessage(error.message, language)),
  });
  const clockInMutation = trpc.timeclock.clockIn.useMutation({
    onSuccess: async () => {
      toast.success(t("Signed in successfully."));
      await utils.timeclock.todayStatus.invalidate({ businessDate: currentBusinessDate });
    },
    onError: error => toast.error(translateErrorMessage(error.message, language)),
  });
  const clockOutMutation = trpc.timeclock.clockOut.useMutation({
    onSuccess: async () => {
      toast.success(t("Signed out successfully."));
      await utils.timeclock.todayStatus.invalidate({ businessDate: currentBusinessDate });
    },
    onError: error => toast.error(translateErrorMessage(error.message, language)),
  });
  const submissionOrigin = typeof window === "undefined" ? undefined : window.location.origin;

  const openingQuestions = openingQuestionsQuery.data ?? [];
  const closingQuestions = closingQuestionsQuery.data ?? [];
  const inventoryItems = inventoryItemsQuery.data ?? [];
  const serviceInventoryItems = useMemo(
    () => inventoryItems.filter(item => item.department !== "Ingredients").sort((a, b) => a.itemName.localeCompare(b.itemName)),
    [inventoryItems],
  );
  const fullInventoryItems = useMemo(() => [...inventoryItems].sort((a, b) => a.department.localeCompare(b.department) || a.itemName.localeCompare(b.itemName)), [inventoryItems]);

  const inventoryByName = useMemo(() => new Map(inventoryItems.map(item => [item.itemName, item])), [inventoryItems]);

  const inventoryGroups = useMemo(() => {
    return fullInventoryItems.reduce<Record<string, typeof fullInventoryItems>>((acc, item) => {
      acc[item.department] = [...(acc[item.department] ?? []), item];
      return acc;
    }, {});
  }, [fullInventoryItems]);

  const readyMadeGelatoFlavorNames = useMemo(() => {
    const normalizedFlavors = normalizeGelatoFlavorStateMap(readyMadeGelato.flavors);
    const seeded = READY_MADE_GELATO_FLAVORS.filter(flavor => flavor in normalizedFlavors);
    const custom = Object.keys(normalizedFlavors).filter(
      flavor => !READY_MADE_GELATO_FLAVORS.includes(flavor as (typeof READY_MADE_GELATO_FLAVORS)[number]),
    );
    return [...seeded, ...custom];
  }, [readyMadeGelato.flavors]);
  const timeclockStaff = timeclockStatusQuery.data?.staff ?? [];
  const selectedClockStaffStatus = selectedClockStaffName
    ? timeclockStaff.find(entry => entry.staffName === selectedClockStaffName) ?? null
    : null;
  const isTimeclockActionPending = clockInMutation.isPending || clockOutMutation.isPending || timeclockStatusQuery.isLoading;

  const openingNapkinsQuestion = useMemo(() => getOpeningNapkinsQuestion(openingQuestions), [openingQuestions]);
  const storeReadyQuestion = useMemo(() => openingQuestions.find(question => question.prompt === "Store ready to open"), [openingQuestions]);

  const groupedOpeningQuestions = useMemo(
    () => groupOpeningQuestionsForPortal(openingQuestions, openingNapkinsQuestion?.id),
    [openingQuestions, openingNapkinsQuestion],
  );

  const groupedClosingQuestions = useMemo(() => {
    return closingQuestions.reduce<Record<string, ChecklistQuestion[]>>((acc, question) => {
      acc[question.sectionTitle] = [...(acc[question.sectionTitle] ?? []), question];
      return acc;
    }, {});
  }, [closingQuestions]);

  const totalSales = useMemo(() => {
    return [closingForm.cashTotal, closingForm.cardTotal, closingForm.zelleTotal, closingForm.venmoTotal]
      .map(value => Number(value || 0))
      .reduce((sum, value) => sum + value, 0);
  }, [closingForm.cashTotal, closingForm.cardTotal, closingForm.zelleTotal, closingForm.venmoTotal]);

  useEffect(() => {
    setOpeningForm(current => ({ ...current, businessDate: currentBusinessDate }));
    setClosingForm(current => ({ ...current, businessDate: currentBusinessDate }));
    setReadyMadeGelato(current => ({ ...current, businessDate: currentBusinessDate }));
  }, [currentBusinessDate]);

  useEffect(() => {
    const interval = window.setInterval(() => setLiveNow(new Date()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (inventoryItems.length === 0) return;
    if ((portalView === "closing" && hasClosingDraftRestored.current) || (portalView === "inventory" && hasInventoryDraftRestored.current)) {
      return;
    }
    setServiceInventoryCounts(Object.fromEntries(inventoryItems.map(item => [item.id, displayNumberValue(item.currentQuantity)])));
  }, [inventoryItems, portalView]);

  function updateGelatoField(shiftType: ReadyMadeGelatoShiftKey, flavor: string, field: keyof ReadyMadeGelatoShiftState, value: string) {
    const normalizedFlavor = normalizeGelatoFlavorName(flavor);
    if (!normalizedFlavor) return;

    setReadyMadeGelato(current => ({
      ...current,
      flavors: normalizeGelatoFlavorStateMap({
        ...current.flavors,
        [normalizedFlavor]: {
          ...(current.flavors[normalizedFlavor] ?? {
            opening: initialReadyMadeGelatoShiftState(),
            closing: initialReadyMadeGelatoShiftState(),
          }),
          [shiftType]: {
            ...(current.flavors[normalizedFlavor]?.[shiftType] ?? initialReadyMadeGelatoShiftState()),
            [field]: value,
          },
        },
      }),
    }));
  }

  function addCustomFlavor() {
    const nextFlavor = normalizeGelatoFlavorName(otherFlavorName);
    const normalizedFlavors = normalizeGelatoFlavorStateMap(readyMadeGelato.flavors);
    if (!nextFlavor || normalizedFlavors[nextFlavor]) return;
    setReadyMadeGelato(current => ({
      ...current,
      flavors: normalizeGelatoFlavorStateMap({
        ...current.flavors,
        [nextFlavor]: {
          opening: initialReadyMadeGelatoShiftState(),
          closing: initialReadyMadeGelatoShiftState(),
        },
      }),
    }));
    setOtherFlavorName("");
  }

  useEffect(() => {
    if (portalView !== "opening" || didAttemptOpeningDraftRestore.current) return;
    didAttemptOpeningDraftRestore.current = true;

    const draft = loadPortalDraft<OpeningDraft>(openingDraftKey, currentBusinessDate);
    if (!draft) return;

    hasOpeningDraftRestored.current = true;
    setOpeningForm({ ...draft.data.form, businessDate: currentBusinessDate });
    setOpeningAnswers(draft.data.answers ?? {});
    setReadyMadeGelato(current => applyGelatoShiftDraft(current, "opening", draft.data.gelatoOpening ?? {}, currentBusinessDate));
    setGelatoEntryMode(current => ({ ...current, opening: draft.data.gelatoOpeningMode ?? "manual" }));
    setGelatoAnalyzedPhotos(current => ({ ...current, opening: draft.data.gelatoOpeningPhotos ?? [] }));
    setDraftSavedAt(current => ({ ...current, opening: draft.savedAt }));
    toast.success(t("Saved opening draft restored."));
  }, [currentBusinessDate, portalView, t]);

  useEffect(() => {
    if (portalView !== "closing" || didAttemptClosingDraftRestore.current) return;
    didAttemptClosingDraftRestore.current = true;

    const draft = loadPortalDraft<ClosingDraft>(closingDraftKey, currentBusinessDate);
    if (!draft) return;

    hasClosingDraftRestored.current = true;
    setClosingForm({ ...draft.data.form, businessDate: currentBusinessDate });
    setClosingAnswers(draft.data.answers ?? {});
    setServiceInventoryCounts(draft.data.serviceInventoryCounts ?? {});
    setReadyMadeGelato(current => applyGelatoShiftDraft(current, "closing", draft.data.gelatoClosing ?? {}, currentBusinessDate));
    setGelatoEntryMode(current => ({ ...current, closing: draft.data.gelatoClosingMode ?? "manual" }));
    setGelatoAnalyzedPhotos(current => ({ ...current, closing: draft.data.gelatoClosingPhotos ?? [] }));
    setDraftSavedAt(current => ({ ...current, closing: draft.savedAt }));
    toast.success(t("Saved closing draft restored."));
  }, [currentBusinessDate, portalView, t]);

  useEffect(() => {
    if (portalView !== "inventory" || didAttemptInventoryDraftRestore.current) return;
    didAttemptInventoryDraftRestore.current = true;

    const draft = loadPortalDraft<InventoryDraft>(inventoryDraftKey, currentBusinessDate);
    if (!draft) return;

    hasInventoryDraftRestored.current = true;
    setServiceInventoryCounts(draft.data.serviceInventoryCounts ?? {});
    setReadyMadeGelato(current => applyGelatoShiftDraft(current, "opening", draft.data.gelatoOpening ?? {}, currentBusinessDate));
    setGelatoEntryMode(current => ({ ...current, opening: draft.data.gelatoOpeningMode ?? "manual" }));
    setGelatoAnalyzedPhotos(current => ({ ...current, opening: draft.data.gelatoOpeningPhotos ?? [] }));
    setDraftSavedAt(current => ({ ...current, inventory: draft.savedAt }));
    toast.success(t("Saved inventory draft restored."));
  }, [currentBusinessDate, portalView, t]);

  function updateInventoryItem(itemId: number, value: string) {
    setServiceInventoryCounts(current => ({ ...current, [itemId]: value }));
  }

  function buildReadyMadeEntries(shiftType: ReadyMadeGelatoShiftKey) {
    const entryMode = gelatoEntryMode[shiftType] ?? "manual";
    const analyzedPhotos = gelatoAnalyzedPhotos[shiftType] ?? [];
    const flavorNames = Array.from(
      new Set([...readyMadeGelatoFlavorNames, ...Object.keys(readyMadeGelato.flavors), ...analyzedPhotos.map(photo => photo.flavor.trim()).filter(Boolean)])
    );

    if (entryMode === "photo" && analyzedPhotos.length > 0) {
      const photoTotalsByFlavor = summarizeAnalyzedPhotosForSubmission(analyzedPhotos);

      return Array.from(photoTotalsByFlavor.entries()).map(([flavor, totals]) => ({
        flavor,
        smallPanCount: totals.smallPanCount,
        smallGrossWeightKg: totals.smallGrossWeightKg,
        largePanCount: totals.largePanCount,
        largeGrossWeightKg: totals.largeGrossWeightKg,
        combinedGrossWeightKg: totals.combinedGrossWeightKg,
      }));
    }

    return flavorNames.map(flavor => {
      const entry = readyMadeGelato.flavors[flavor]?.[shiftType] ?? initialReadyMadeGelatoShiftState();
      return {
        flavor,
        smallPanCount: Number(entry.smallPanCount || 0),
        smallGrossWeightKg: Number(entry.smallGrossWeightKg || 0),
        largePanCount: Number(entry.largePanCount || 0),
        largeGrossWeightKg: Number(entry.largeGrossWeightKg || 0),
      };
    });
  }

  function buildLimitedInventoryPayloads(mode: "opening" | "closing") {
    const payloads = new Map<number, { id: number; currentQuantity: number; notes: string }>();

    for (const pair of serviceInventoryPairs) {
      for (const config of [pair.left, pair.right].filter(Boolean) as PairedInputConfig[]) {
        if (!config.itemName) continue;
        const item = inventoryByName.get(config.itemName);
        if (!item) continue;
        const rawValue = mode === "opening" && config.stockKey ? openingForm.stockCounts[config.stockKey] : serviceInventoryCounts[item.id] ?? "";
        payloads.set(item.id, {
          id: item.id,
          currentQuantity: Number(rawValue || 0),
          notes: "",
        });
      }
    }

    return Array.from(payloads.values());
  }

  function buildFullInventoryPayloads() {
    return fullInventoryItems.map(item => ({
      id: item.id,
      currentQuantity: Number(serviceInventoryCounts[item.id] || 0),
      notes: "",
    }));
  }

  async function refreshAfterSubmission() {
    await Promise.all([
      inventoryItemsQuery.refetch(),
      readyMadeGelatoQuery.refetch(),
      utils.dashboard.daily.invalidate(),
      utils.dashboard.salesTrend.invalidate(),
      utils.dashboard.weekOverWeek.invalidate(),
      utils.dashboard.recentNotes.invalidate(),
      utils.dashboard.inventoryAlerts.invalidate(),
    ]);
  }

  function getNormalizedStaffName(rawName: string, fallbackValue?: string | null) {
    return rawName.trim() || fallbackValue?.trim() || "";
  }

  function validateStaffName(name: string, ref?: React.RefObject<HTMLInputElement | null>) {
    if (name.trim()) return true;
    ref?.current?.focus();
    toast.error(t("Please enter a first name before submitting."));
    return false;
  }

  function showSubmissionNotice(view: Exclude<PortalView, "hub">, title: string, detail: string) {
    setSubmissionNotice({ view, title, detail });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function saveOpeningDraft() {
    const savedDraft = savePortalDraft<OpeningDraft>(openingDraftKey, currentBusinessDate, {
      form: { ...openingForm, businessDate: currentBusinessDate, staffName: getNormalizedStaffName(openingForm.staffName, openingStaffNameRef.current?.value) },
      answers: openingAnswers,
      gelatoOpening: extractGelatoShiftDraft(readyMadeGelato, "opening"),
      gelatoOpeningMode: gelatoEntryMode.opening,
      gelatoOpeningPhotos: gelatoAnalyzedPhotos.opening,
    });
    if (!savedDraft) return;

    hasOpeningDraftRestored.current = true;
    setDraftSavedAt(current => ({ ...current, opening: savedDraft.savedAt }));
    toast.success(`${t("Opening draft saved.")} ${t("Use Drafts on Portal Home to reopen it on this device.")}`);
  }

  function saveClosingDraft() {
    const savedDraft = savePortalDraft<ClosingDraft>(closingDraftKey, currentBusinessDate, {
      form: { ...closingForm, businessDate: currentBusinessDate, staffName: getNormalizedStaffName(closingForm.staffName, closingStaffNameRef.current?.value) },
      answers: closingAnswers,
      serviceInventoryCounts,
      gelatoClosing: extractGelatoShiftDraft(readyMadeGelato, "closing"),
      gelatoClosingMode: gelatoEntryMode.closing,
      gelatoClosingPhotos: gelatoAnalyzedPhotos.closing,
    });
    if (!savedDraft) return;

    hasClosingDraftRestored.current = true;
    setDraftSavedAt(current => ({ ...current, closing: savedDraft.savedAt }));
    toast.success(`${t("Closing draft saved.")} ${t("Use Drafts on Portal Home to reopen it on this device.")}`);
  }
  function saveInventoryDraft() {
    const savedDraft = savePortalDraft<InventoryDraft>(inventoryDraftKey, currentBusinessDate, {
      serviceInventoryCounts,
      gelatoOpening: extractGelatoShiftDraft(readyMadeGelato, "opening"),
      gelatoOpeningMode: gelatoEntryMode.opening,
      gelatoOpeningPhotos: gelatoAnalyzedPhotos.opening,
    });

    if (!savedDraft) return;

    hasInventoryDraftRestored.current = true;
    setDraftSavedAt(current => ({ ...current, inventory: savedDraft.savedAt }));
    toast.success(`${t("Inventory draft saved.")} ${t("Use Drafts on Portal Home to reopen it on this device.")}`);
  }

  function deleteSavedDraft(view: Exclude<PortalView, "hub">, draftKey: typeof openingDraftKey | typeof closingDraftKey | typeof inventoryDraftKey) {
    clearPortalDraft(draftKey);
    setDraftSavedAt(current => {
      const next = { ...current };
      delete next[view];
      return next;
    });

    if (view === "opening") {
      hasOpeningDraftRestored.current = false;
    } else if (view === "closing") {
      hasClosingDraftRestored.current = false;
    } else {
      hasInventoryDraftRestored.current = false;
    }

    toast.success(t("Draft deleted."));
  }

  async function handleTimeClockAction() {
    if (!selectedClockStaffName || isTimeclockActionPending) return;

    if (selectedClockStaffStatus?.isClockedIn) {
      await clockOutMutation.mutateAsync({ staffName: selectedClockStaffName });
      return;
    }

    await clockInMutation.mutateAsync({ staffName: selectedClockStaffName });
  }

  function clearGelatoPhotoSelection(shiftType: ReadyMadeGelatoShiftKey) {
    setGelatoPhotoFiles(current => ({ ...current, [shiftType]: [] }));
    const inputRef = shiftType === "opening" ? openingPhotoInputRef : closingPhotoInputRef;
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function clearGelatoAnalyzedPhotos(shiftType: ReadyMadeGelatoShiftKey) {
    setGelatoAnalyzedPhotos(current => ({ ...current, [shiftType]: [] }));
  }

  function getLimitedGelatoPhotoFiles(files: File[]) {
    if (files.length <= GELATO_PHOTO_UPLOAD_LIMIT) return files;

    toast.error(t(`Only the first ${GELATO_PHOTO_UPLOAD_LIMIT} photos were kept for this batch.`));
    return limitGelatoPhotoBatch(files);
  }

  function removeSelectedGelatoPhoto(shiftType: ReadyMadeGelatoShiftKey, photoIndex: number) {
    setGelatoPhotoFiles(current => ({
      ...current,
      [shiftType]: removePhotoAtIndex(current[shiftType] ?? [], photoIndex),
    }));

    const inputRef = shiftType === "opening" ? openingPhotoInputRef : closingPhotoInputRef;
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function replaceShiftAnalyzedPhotos(shiftType: ReadyMadeGelatoShiftKey, photos: ExtractedGelatoPhoto[]) {
    setGelatoAnalyzedPhotos(current => ({ ...current, [shiftType]: photos }));
    setReadyMadeGelato(current => replaceAnalyzedPhotosInGelatoState(current, shiftType, photos));
  }

  function updateAnalyzedPhotoReview(
    shiftType: ReadyMadeGelatoShiftKey,
    photoIndex: number,
    updater: (photo: ExtractedGelatoPhoto) => ExtractedGelatoPhoto,
  ) {
    const nextPhotos = (gelatoAnalyzedPhotos[shiftType] ?? []).map((photo, index) =>
      index === photoIndex ? updater(photo) : photo
    );

    replaceShiftAnalyzedPhotos(shiftType, nextPhotos);
  }

  function removeAnalyzedPhotoReview(shiftType: ReadyMadeGelatoShiftKey, photoIndex: number) {
    replaceShiftAnalyzedPhotos(shiftType, removePhotoAtIndex(gelatoAnalyzedPhotos[shiftType] ?? [], photoIndex));
  }

  async function analyzeGelatoPhotos(shiftType: ReadyMadeGelatoShiftKey) {
    const selectedFiles = gelatoPhotoFiles[shiftType] ?? [];
    if (selectedFiles.length === 0) {
      toast.error(t("Add at least one scale photo before analyzing."));
      return;
    }

    try {
      const photos = await Promise.all(
        selectedFiles.map(async file => ({
          fileName: file.name,
          mimeType: "image/jpeg",
          dataUrl: await compressImageFileToDataUrl(file),
        }))
      );

      const result = await extractGelatoPhotosMutation.mutateAsync({ shiftType, photos });
      const nextAnalyzedPhotos = [...(gelatoAnalyzedPhotos[shiftType] ?? []), ...result.extractedPhotos];
      replaceShiftAnalyzedPhotos(shiftType, nextAnalyzedPhotos);
      clearGelatoPhotoSelection(shiftType);

      const analyzedCount = result.extractedPhotos.length;
      toast.success(
        t(
          `Applied ${analyzedCount} analyzed photo${analyzedCount === 1 ? "" : "s"} to the gelato fields below. Review and adjust anything before submitting.`
        )
      );
    } catch {
      // Shared mutation handlers surface the error toast.
    }
  }

  async function submitInventoryPayloads(payloads: Array<{ id: number; currentQuantity: number; notes: string; notifyOwner?: boolean }>) {
    const updatedItems: Array<{ itemName: string; currentQuantity: number; unitType: string; department: string }> = [];

    for (const payload of payloads) {
      const result = await inventoryMutation.mutateAsync(payload);
      updatedItems.push({
        itemName: result.item.itemName,
        currentQuantity: Number(result.item.currentQuantity || 0),
        unitType: result.item.unitType,
        department: result.item.department,
      });
    }

    return updatedItems;
  }

  async function confirmReplacementIfNeeded(view: SubmissionViewKey) {
    const latestStatus = submissionStatusQuery.data?.businessDate === currentBusinessDate
      ? submissionStatusQuery.data
      : (await submissionStatusQuery.refetch()).data;

    const alreadyExists = view === "opening"
      ? latestStatus?.openingExists
      : view === "closing"
        ? latestStatus?.closingExists
        : latestStatus?.inventoryExists;

    if (!alreadyExists) return true;

    return window.confirm(getReplacementConfirmationMessage(view, t));
  }

  async function handleOpeningSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedStaffName = getNormalizedStaffName(openingForm.staffName, openingStaffNameRef.current?.value);
    if (!validateStaffName(normalizedStaffName, openingStaffNameRef)) return;
    if (normalizedStaffName !== openingForm.staffName) {
      setOpeningForm(current => ({ ...current, staffName: normalizedStaffName }));
    }

    try {
      const shouldReplace = await confirmReplacementIfNeeded("opening");
      if (!shouldReplace) return;

      const openingChecklistPayload = buildAnswersPayload(openingQuestions, openingAnswers);
      const openingGelatoEntries = buildReadyMadeEntries("opening");
      const failedItems = openingChecklistPayload.filter(item => item.answer === "No").length;

      await openingMutation.mutateAsync({
        businessDate: currentBusinessDate,
        staffName: normalizedStaffName,
        startingCash: Number(openingForm.startingCash || 0),
        cashCountedAndCorrect: openingForm.cashCountedAndCorrect,
        storeReadyToOpen: openingAnswers[storeReadyQuestion?.id ?? -1]?.answer ?? "No",
        stockCounts: {
          cups4oz: Number(openingForm.stockCounts.cups4oz || 0),
          cups8oz: Number(openingForm.stockCounts.cups8oz || 0),
          cupsPint: Number(openingForm.stockCounts.cupsPint || 0),
          cupsLiter: Number(openingForm.stockCounts.cupsLiter || 0),
          lids4oz: 0,
          lids8oz: Number(openingForm.stockCounts.lids8oz || 0),
          lidsPint: Number(openingForm.stockCounts.lidsPint || 0),
          lidsLiter: Number(openingForm.stockCounts.lidsLiter || 0),
          spoons: Number(openingForm.stockCounts.spoons || 0),
        },
        notes: openingForm.notes,
        checklistAnswers: openingChecklistPayload,
        notifyOwner: false,
        origin: submissionOrigin,
      });

      await readyMadeGelatoMutation.mutateAsync({
        businessDate: currentBusinessDate,
        shiftType: "opening",
        notifyOwner: false,
        entries: openingGelatoEntries,
      });
      const openingInventoryItems = await submitInventoryPayloads(buildLimitedInventoryPayloads("opening").map(payload => ({ ...payload, notifyOwner: false })));
      await submissionHistoryMutation.mutateAsync({
        businessDate: currentBusinessDate,
        submissionType: "opening",
        staffName: normalizedStaffName,
        notifyOwner: true,
        origin: submissionOrigin,
        notificationSummary: {
          title: `Opening form submitted for ${currentBusinessDate}`,
          summary: `${normalizedStaffName} submitted the opening form. Cash counted and correct: ${openingForm.cashCountedAndCorrect}. Store ready: ${openingAnswers[storeReadyQuestion?.id ?? -1]?.answer ?? "No"}. Failed confirmations: ${failedItems}.`,
        },
        payload: {
          form: { ...openingForm, businessDate: currentBusinessDate, staffName: normalizedStaffName },
          checklistAnswers: openingChecklistPayload,
          gelatoEntries: openingGelatoEntries,
          gelatoEntryMode: gelatoEntryMode.opening,
          analyzedPhotos: gelatoAnalyzedPhotos.opening,
          inventoryItems: openingInventoryItems,
          notes: { general: openingForm.notes || "" },
        },
      });

      toast.success(t("Opening form submitted."));
      showSubmissionNotice("opening", t("Opening form submitted."), `${t("Saved for")} ${normalizedStaffName} · ${currentBusinessDate}. ${t("Managers can review it in the dashboard.")}`);
      clearPortalDraft(openingDraftKey);
      hasOpeningDraftRestored.current = false;
      setDraftSavedAt(current => ({ ...current, opening: undefined }));
      clearGelatoPhotoSelection("opening");
      clearGelatoAnalyzedPhotos("opening");
      setGelatoEntryMode(current => ({ ...current, opening: "manual" }));
      setOpeningForm(initialOpeningForm());
      setOpeningAnswers({});
      await refreshAfterSubmission();
    } catch {
      // Shared mutation handlers surface the error toast.
    }
  }

  async function handleClosingSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedStaffName = getNormalizedStaffName(closingForm.staffName, closingStaffNameRef.current?.value);
    if (!validateStaffName(normalizedStaffName, closingStaffNameRef)) return;
    if (normalizedStaffName !== closingForm.staffName) {
      setClosingForm(current => ({ ...current, staffName: normalizedStaffName }));
    }

    try {
      const shouldReplace = await confirmReplacementIfNeeded("closing");
      if (!shouldReplace) return;

      const closingChecklistPayload = buildAnswersPayload(closingQuestions, closingAnswers);
      const closingGelatoEntries = buildReadyMadeEntries("closing");

      await closingMutation.mutateAsync({
        businessDate: currentBusinessDate,
        staffName: normalizedStaffName,
        cashCounted: Number(closingForm.cashCounted || 0),
        cashMatchesSystem: closingForm.cashMatchesSystem,
        notes: closingForm.notes,
        notifyOwner: false,
        checklistAnswers: closingChecklistPayload,
      });

      await readyMadeGelatoMutation.mutateAsync({
        businessDate: currentBusinessDate,
        shiftType: "closing",
        notifyOwner: false,
        entries: closingGelatoEntries,
      });
      const closingInventoryItems = await submitInventoryPayloads(buildLimitedInventoryPayloads("closing").map(payload => ({ ...payload, notifyOwner: false })));
      await endOfDayMutation.mutateAsync({
        businessDate: currentBusinessDate,
        staffName: normalizedStaffName,
        notifyOwner: true,
        cups4ozHere: Number(closingForm.cups4ozHere || 0),
        cups4ozToGo: Number(closingForm.cups4ozToGo || 0),
        cups8ozHere: Number(closingForm.cups8ozHere || 0),
        cups8ozToGo: Number(closingForm.cups8ozToGo || 0),
        cupsPintHere: Number(closingForm.cupsPintHere || 0),
        cupsPintToGo: Number(closingForm.cupsPintToGo || 0),
        cupsLiterHere: Number(closingForm.cupsLiterHere || 0),
        cupsLiterToGo: Number(closingForm.cupsLiterToGo || 0),
        cashTotal: Number(closingForm.cashTotal || 0),
        cardTotal: Number(closingForm.cardTotal || 0),
        zelleTotal: Number(closingForm.zelleTotal || 0),
        venmoTotal: Number(closingForm.venmoTotal || 0),
        wasteNotes: closingForm.wasteNotes,
        lowItemNotes: closingForm.lowItemNotes,
        generalNotes: closingForm.generalNotes,
        origin: submissionOrigin,
      });
      await submissionHistoryMutation.mutateAsync({
        businessDate: currentBusinessDate,
        submissionType: "closing",
        staffName: normalizedStaffName,
        payload: {
          form: { ...closingForm, businessDate: currentBusinessDate, staffName: normalizedStaffName },
          checklistAnswers: closingChecklistPayload,
          gelatoEntries: closingGelatoEntries,
          gelatoEntryMode: gelatoEntryMode.closing,
          analyzedPhotos: gelatoAnalyzedPhotos.closing,
          inventoryItems: closingInventoryItems,
          notes: {
            closing: closingForm.notes || "",
            waste: closingForm.wasteNotes || "",
            lowItems: closingForm.lowItemNotes || "",
            general: closingForm.generalNotes || "",
          },
        },
      });

      toast.success(t("Closing form submitted."));
      showSubmissionNotice("closing", t("Closing form submitted."), `${t("Saved for")} ${normalizedStaffName} · ${currentBusinessDate}. ${t("Managers can review it in the dashboard.")}`);
      clearPortalDraft(closingDraftKey);
      hasClosingDraftRestored.current = false;
      setDraftSavedAt(current => ({ ...current, closing: undefined }));
      clearGelatoPhotoSelection("closing");
      clearGelatoAnalyzedPhotos("closing");
      setGelatoEntryMode(current => ({ ...current, closing: "manual" }));
      setClosingForm(initialClosingForm());
      setClosingAnswers({});
      await refreshAfterSubmission();
    } catch {
      // Shared mutation handlers surface the error toast.
    }
  }

  async function handleInventorySubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      const shouldReplace = await confirmReplacementIfNeeded("inventory");
      if (!shouldReplace) return;

      const inventoryGelatoEntries = buildReadyMadeEntries("opening");
      const updatedItems = await submitInventoryPayloads(
        buildFullInventoryPayloads().map(payload => ({ ...payload, notifyOwner: false }))
      );
      const gelatoResult = await readyMadeGelatoMutation.mutateAsync({
        businessDate: currentBusinessDate,
        shiftType: "opening",
        notifyOwner: false,
        entries: inventoryGelatoEntries,
      });
      await inventorySummaryMutation.mutateAsync({
        businessDate: currentBusinessDate,
        staffName: "Ojala Staff",
        gelatoEntryCount: gelatoResult.records.length,
        itemSummaries: updatedItems,
        origin: submissionOrigin,
      });
      await submissionHistoryMutation.mutateAsync({
        businessDate: currentBusinessDate,
        submissionType: "inventory",
        staffName: "Ojala Staff",
        payload: {
          gelatoEntries: inventoryGelatoEntries,
          gelatoEntryMode: gelatoEntryMode.opening,
          analyzedPhotos: gelatoAnalyzedPhotos.opening,
          inventoryItems: updatedItems,
          notes: { summary: `Inventory submission saved with ${gelatoResult.records.length} ready-made gelato entries.` },
        },
      });
      toast.success(t("Inventory and ready-made gelato updated."));
      showSubmissionNotice("inventory", t("Inventory and ready-made gelato updated."), `${t("Saved for")} ${currentBusinessDate}. ${t("Managers can review it in the dashboard.")}`);
      clearPortalDraft(inventoryDraftKey);
      hasInventoryDraftRestored.current = false;
      setDraftSavedAt(current => ({ ...current, inventory: undefined }));
      clearGelatoAnalyzedPhotos("opening");
      clearGelatoPhotoSelection("opening");
      setGelatoEntryMode(current => ({ ...current, opening: "manual" }));
      await refreshAfterSubmission();
    } catch {
      // Shared mutation handlers surface the error toast.
    }
  }

  function renderLimitedInventoryInput(config?: PairedInputConfig, mode: "opening" | "closing" = "opening") {
    if (!config) return <div className="hidden md:block" />;

    if (mode === "opening" && config.stockKey) {
      return (
        <Field label={t(config.label)}>
          <input
            className={smallInputClassName()}
            type="number"
            min="0"
            step="1"
            value={openingForm.stockCounts[config.stockKey]}
            onChange={event =>
              setOpeningForm(current => ({
                ...current,
                stockCounts: { ...current.stockCounts, [config.stockKey!]: event.target.value },
              }))
            }
          />
        </Field>
      );
    }

    const item = config.itemName ? inventoryByName.get(config.itemName) : undefined;
    if (!item) return <div className="hidden md:block" />;

    return (
      <Field label={t(config.label)} hint={`${t("Par level")}: ${item.parLevel}`}>
        <input
          className={smallInputClassName()}
          type="number"
          min="0"
          step="1"
          value={serviceInventoryCounts[item.id] ?? ""}
          onChange={event => updateInventoryItem(item.id, event.target.value)}
        />
      </Field>
    );
  }

  function renderGelatoSection(shiftType: ReadyMadeGelatoShiftKey, allowAddFlavor = false, descriptionText?: string, weightLabel?: string) {
    const entryMode = gelatoEntryMode[shiftType] ?? "manual";
    const selectedFiles = gelatoPhotoFiles[shiftType] ?? [];
    const analyzedPhotos = gelatoAnalyzedPhotos[shiftType] ?? [];
    const photoInputRef = shiftType === "opening" ? openingPhotoInputRef : closingPhotoInputRef;
    const isAnalyzingPhotos = extractGelatoPhotosMutation.isPending;

    return (
      <SectionCard
        icon={<Package2 className="h-5 w-5" />}
        title={t("Ready-Made Gelato")}
        description={
          descriptionText ??
          (shiftType === "opening"
            ? t("Count ready-made gelato for the morning form before moving into the utensil inventory section.")
            : t("Count ready-made gelato for the closing form before finishing the nightly inventory section."))
        }
      >
        <div className="min-w-0 rounded-[1.5rem] border border-[#e8ddd0] bg-[#fbf7f1] p-4 shadow-sm">
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.26em] text-[#8a8176]">{t("Entry method")}</p>
              <h3 className="mt-2 text-lg font-medium tracking-[-0.03em] text-[#2d2925]">
                {entryMode === "photo" ? t("Photo-assisted inventory") : t("Manual inventory")}
              </h3>
              <p className="mt-2 max-w-2xl min-w-0 text-sm leading-7 text-[#625b53]">
                {entryMode === "photo"
                  ? t("Upload one or more scale photos, analyze them, and review the matching flavor fields below before you submit.")
                  : t("Enter the pan counts and gross weights by hand, or switch to photo mode if staff want help filling the gelato fields.")}
              </p>
            </div>
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setGelatoEntryMode(current => ({ ...current, [shiftType]: "manual" }))}
                className={`rounded-full px-5 py-3 text-sm font-medium transition ${entryMode === "manual" ? "bg-[#2f2a26] text-white" : "border border-[#ddd4c8] bg-white text-[#2f2a26] hover:bg-[#f5eee5]"}`}
              >
                {t("Manual entry")}
              </button>
              <button
                type="button"
                onClick={() => setGelatoEntryMode(current => ({ ...current, [shiftType]: "photo" }))}
                className={`rounded-full px-5 py-3 text-sm font-medium transition ${entryMode === "photo" ? "bg-[#52665f] text-white" : "border border-[#ddd4c8] bg-white text-[#2f2a26] hover:bg-[#f5eee5]"}`}
              >
                {t("Use photos")}
              </button>
            </div>
          </div>

          {entryMode === "photo" ? (
            <div className="mt-5 min-w-0 rounded-[1.25rem] border border-dashed border-[#d7cec0] bg-white p-4">
              <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <label className="grid min-w-0 gap-2 text-sm font-medium text-[#453f39]">
                  {t("Scale photos")}
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={event =>
                      setGelatoPhotoFiles(current => ({
                        ...current,
                        [shiftType]: getLimitedGelatoPhotoFiles(Array.from(event.target.files ?? [])),
                      }))
                    }
                    className="block w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-dashed border-[#d7cec0] bg-[#fcfaf6] px-4 py-4 text-sm text-[#4b443d] file:mr-4 file:rounded-full file:border-0 file:bg-[#2f2a26] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#1f1b18]"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => analyzeGelatoPhotos(shiftType)}
                  disabled={isAnalyzingPhotos}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#52665f] px-5 text-sm font-medium text-white transition hover:bg-[#41534d] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isAnalyzingPhotos ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {isAnalyzingPhotos ? t("Analyzing photos...") : t("Analyze photos")}
                </button>
              </div>

              {selectedFiles.length > 0 ? (
                <div className="mt-4 flex min-w-0 flex-wrap gap-2">
                  {selectedFiles.map((file, index) => (
                    <span
                      key={`${shiftType}-${file.name}-${file.size}-${index}`}
                      className="inline-flex max-w-full items-center gap-2 rounded-full bg-[#f3ece2] px-3 py-2 text-xs font-medium text-[#5c544c]"
                    >
                      <span className="max-w-[16rem] truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => removeSelectedGelatoPhoto(shiftType, index)}
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#d8cfc3] bg-white text-[#5c544c] transition hover:bg-[#efe6da]"
                        aria-label={t("Remove photo")}
                        title={t("Remove photo")}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              <p className="mt-4 text-sm leading-7 text-[#625b53]">
                {t(`You can analyze up to ${GELATO_PHOTO_UPLOAD_LIMIT} photos at a time. Remove any extras or run another batch after this one finishes.`)}
              </p>
            </div>
          ) : null}
        </div>

        {entryMode === "photo" ? (
          <div className="mt-4 space-y-4">
            <datalist id={`gelato-flavor-options-${shiftType}`}>
              {READY_MADE_GELATO_FLAVORS.map(flavor => (
                <option key={`${shiftType}-flavor-option-${flavor}`} value={flavor} />
              ))}
            </datalist>
            {analyzedPhotos.length === 0 ? (
              <div className="rounded-[1.4rem] border border-[#e5ddd0] bg-[#fcfaf6] px-5 py-4 text-sm leading-7 text-[#625b53] shadow-sm">
                {t("Analyze one or more scale photos to review each uploaded image and its extracted flavor, pan setup, and kilogram reading here before you submit.")}
              </div>
            ) : (
              <div className="grid gap-4">
                {analyzedPhotos.map((photo, index) => {
                  const panSetup = getAnalyzedPhotoPanSetup(photo);
                  const panTareKg = getAnalyzedPhotoPanTareKg(photo);
                  const netGelatoWeightKg = estimateAnalyzedPhotoNetWeightKg(photo);
                  const volumeOunces = estimateAnalyzedPhotoVolumeOunces(photo);
                  return (
                    <article key={`${shiftType}-${photo.fileName}-${index}`} className="min-w-0 overflow-hidden rounded-[1.5rem] border border-[#e8ddd0] bg-[#fbf7f1] shadow-sm">
                      <div className="grid min-w-0 gap-4 p-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                        <div className="min-w-0 overflow-hidden rounded-[1.25rem] border border-[#e5ddd0] bg-white">
                          <img src={photo.imageUrl} alt={photo.fileName} loading="lazy" decoding="async" className="h-full min-h-40 w-full bg-[#f6f1e8] object-contain" />
                        </div>
                        <div className="grid min-w-0 gap-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <p className="text-sm font-medium text-[#2d2925]">{photo.fileName}</p>
                              <p className="mt-1 text-xs uppercase tracking-[0.22em] text-[#8a8176]">{t("Photo review")}</p>
                            </div>
                            <div className="flex items-center gap-2 self-start">
                              <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] ${analyzedPhotoConfidenceClassName(photo.confidence)}`}>
                                {photo.confidence}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeAnalyzedPhotoReview(shiftType, index)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#ddd4c8] bg-white text-[#5c544c] transition hover:bg-[#f5eee5]"
                                aria-label={t("Remove photo")}
                                title={t("Remove photo")}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                          <div className="grid gap-3 md:grid-cols-3">
                            <Field label={t("Flavor")}>
                              <input
                                className={smallInputClassName()}
                                value={photo.flavor}
                                list={`gelato-flavor-options-${shiftType}`}
                                onChange={event =>
                                  updateAnalyzedPhotoReview(shiftType, index, current => ({
                                    ...current,
                                    flavor: event.target.value,
                                  }))
                                }
                              />
                            </Field>
                            <Field label={t("Pan setup")}>
                              <select
                                className={smallInputClassName()}
                                value={panSetup}
                                onChange={event => {
                                  const nextSetup = event.target.value as AnalyzedPhotoPanSetup;
                                  updateAnalyzedPhotoReview(shiftType, index, current => ({
                                    ...current,
                                    ...applyAnalyzedPhotoPanSetup(nextSetup),
                                  }));
                                }}
                              >
                                <option value="needs_review">{t("Needs review")}</option>
                                <option value="small">{t("Small pan")}</option>
                                <option value="large">{t("Large pan")}</option>
                                <option value="double_small">{t("Two small pans")}</option>
                                <option value="double_large">{t("Two large pans")}</option>
                                <option value="small_large">{t("Small + large")}</option>
                              </select>
                            </Field>
                            <Field label={t("Combined Gross Weight kg")}>
                              <input
                                className={smallInputClassName()}
                                type="text"
                                inputMode={GELATO_WEIGHT_INPUT_MODE}
                                value={photo.combinedGrossWeightInput ?? displayNumberValue(photo.combinedGrossWeightKg)}
                                onChange={event =>
                                  updateAnalyzedPhotoReview(shiftType, index, current => ({
                                    ...current,
                                    combinedGrossWeightInput: event.target.value,
                                    combinedGrossWeightKg: getAnalyzedPhotoCombinedGrossWeightKg({
                                      combinedGrossWeightKg: current.combinedGrossWeightKg,
                                      combinedGrossWeightInput: event.target.value,
                                    }),
                                  }))
                                }
                              />
                            </Field>
                          </div>
                          <div className="rounded-[1.25rem] border border-[#e5ddd0] bg-white/80 px-4 py-3 text-sm text-[#5f6a64]">
                            <p>
                              {photo.smallPanCount} {t("small pan")} · {photo.largePanCount} {t("large pan")} · {(photo.combinedGrossWeightInput ?? displayNumberValue(photo.combinedGrossWeightKg)) || "0"} kg
                            </p>
                          </div>
                          <div className="rounded-[1.25rem] border border-[#dfe7de] bg-[#f8fbf8] px-4 py-3 text-sm leading-7 text-[#355044]">
                            <p>
                              {t("Net gelato weight")}: {(photo.combinedGrossWeightInput ?? displayNumberValue(photo.combinedGrossWeightKg)) || "0"} kg − {panTareKg.toFixed(3)} kg {t("pan tare")} = {netGelatoWeightKg.toFixed(3)} kg
                            </p>
                            <p className="mt-1">
                              {t("Estimated volume ounces")}: {volumeOunces.toFixed(1)} oz
                            </p>
                          </div>
                          {photo.warning ? (
                            <p className="rounded-[1.25rem] border border-[#efd7cf] bg-[#fff5f1] px-4 py-3 text-sm leading-6 text-[#7c3428]">
                              {photo.warning}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {readyMadeGelatoFlavorNames.map(flavor => {
              const shift = readyMadeGelato.flavors[flavor]?.[shiftType] ?? initialReadyMadeGelatoShiftState();
              return (
                <div key={`${shiftType}-${flavor}`} className="rounded-[1.5rem] border border-[#e8ddd0] bg-[#fbf7f1] p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-lg font-medium tracking-[-0.03em] text-[#2d2925]">{t(flavor)}</h3>
                    <span className="text-[11px] uppercase tracking-[0.26em] text-[#8a8176]">{weightLabel ?? t(shiftType === "opening" ? "Opening weights" : "Closing weights")}</span>
                  </div>
                  <div className="grid gap-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label={t("Small Pans")}>
                        <input className={smallInputClassName()} type="number" min="0" step="1" value={shift.smallPanCount} onChange={event => updateGelatoField(shiftType, flavor, "smallPanCount", event.target.value)} />
                      </Field>
                      <Field label={t("Small Gross Weight kg")}>
                        <input className={smallInputClassName()} type="number" min="0" step={GELATO_WEIGHT_INPUT_STEP} inputMode={GELATO_WEIGHT_INPUT_MODE} value={shift.smallGrossWeightKg} onChange={event => updateGelatoField(shiftType, flavor, "smallGrossWeightKg", event.target.value)} />
                      </Field>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label={t("Large Pans")}>
                        <input className={smallInputClassName()} type="number" min="0" step="1" value={shift.largePanCount} onChange={event => updateGelatoField(shiftType, flavor, "largePanCount", event.target.value)} />
                      </Field>
                      <Field label={t("Large Gross Weight kg")}>
                        <input className={smallInputClassName()} type="number" min="0" step={GELATO_WEIGHT_INPUT_STEP} inputMode={GELATO_WEIGHT_INPUT_MODE} value={shift.largeGrossWeightKg} onChange={event => updateGelatoField(shiftType, flavor, "largeGrossWeightKg", event.target.value)} />
                      </Field>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {allowAddFlavor ? (
          <div className="mt-6 flex justify-end">
            <div className="flex w-full flex-col gap-2 md:max-w-sm md:flex-row">
              <input
                className={inputClassName()}
                value={otherFlavorName}
                onChange={event => setOtherFlavorName(event.target.value)}
                placeholder={t("Add custom flavor")}
              />
              <button
                type="button"
                onClick={addCustomFlavor}
                className="rounded-full border border-[#ddd4c8] bg-white px-5 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-[#f5eee5]"
              >
                {t("Add flavor")}
              </button>
            </div>
          </div>
        ) : null}
      </SectionCard>
    );
  }

  if (loading) {
    return <div className="min-h-screen bg-[#f8f4ed]" />;
  }

  const navLinks = [
    { href: "/portal/opening", label: t("Opening Form"), active: portalView === "opening" },
    { href: "/portal/closing", label: t("Closing Form"), active: portalView === "closing" },
    { href: "/portal/inventory", label: t("Inventory Form"), active: portalView === "inventory" },
  ];

  const portalTitle =
    portalView === "opening"
      ? t("Opening Form")
      : portalView === "closing"
        ? t("Closing Form")
        : portalView === "inventory"
          ? t("Inventory Form")
          : t("Staff forms");

  const portalDescription =
    portalView === "opening"
      ? t("Start with the date and first name, then move through opening questions, opening cash, and the limited morning inventory.")
      : portalView === "closing"
        ? t("Start with the date and first name, then move through closing questions, nightly money and report details, and the limited evening inventory.")
        : portalView === "inventory"
          ? t("Use the separate inventory form for the full business inventory, including ingredients, utensils, packaging, and ready-made gelato.")
          : t("Choose one of the three staff forms: opening, closing, or the separate full inventory form.");

  return (
    <div className="min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,_#fbf8f2_0%,_#f4eee4_46%,_#f8f4ec_100%)] pb-16">
      <div className="container max-w-[1440px] px-4 pt-6 sm:px-6 md:pt-10 lg:px-8">
        <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/90 shadow-[0_20px_56px_rgba(88,83,72,0.08)]">
          <div className="border-b border-[#eadfce] p-6 md:p-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-[11px] uppercase tracking-[0.34em] text-[#7d756b]">{t("Staff portal")}</p>
                <h1 className="mt-3 text-3xl font-light tracking-[-0.05em] text-[#2d2925] md:text-4xl">{portalTitle}</h1>
                <p className="mt-4 text-sm leading-7 text-[#625b53] md:text-base">{portalDescription}</p>
                <div className="mt-5 flex flex-wrap gap-3">
                  {navLinks.map(link => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition ${
                        link.active ? "bg-[#2f2a26] text-white" : "border border-[#ddd4c8] bg-white/88 text-[#2f2a26] hover:bg-white"
                      }`}
                    >
                      {link.label}
                    </Link>
                  ))}
                  <Link href="/portal" className="inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white/88 px-5 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-white">
                    {t("Drafts")}
                  </Link>
                  <Link href="/" className="inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white/88 px-5 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-white">
                    <House className="h-4 w-4" />
                    {t("Back home")}
                  </Link>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="rounded-[1.5rem] border border-[#d8cec1] bg-white/88 px-4 py-3 text-sm shadow-sm">
                  <p className="text-[10px] uppercase tracking-[0.28em] text-[#8a8177]">{t("Live Pacific time")}</p>
                  <p className="mt-2 text-sm font-medium text-[#2d2925]">{currentPacificDateLabel}</p>
                  <p className="mt-1 text-lg font-semibold tracking-[-0.03em] text-[#2f2a26]">{currentPacificTimeLabel}</p>
                  <p className="mt-2 text-xs text-[#7d756b]">{t("Business day")}: {currentBusinessDate}</p>
                </div>
                <div className="rounded-[1.5rem] border border-[#e5ddd0] bg-[#f9f4ec] p-3 shadow-sm">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-[#7d756b]">{t("Language")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {([
                      { value: "en", label: "English" },
                      { value: "es", label: "Spanish" },
                    ] as const).map(option => {
                      const active = language === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setLanguage(option.value)}
                          className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                            active ? "bg-[#2f2a26] text-white" : "border border-[#ddd4c8] bg-white text-[#2f2a26] hover:bg-[#f5eee5]"
                          }`}
                        >
                          {t(option.label)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-[#ddd4c8] bg-white/90 px-5 py-3 text-sm font-medium text-[#2f2a26] shadow-sm transition hover:bg-white"
                >
                  <LogOut className="h-4 w-4" />
                  {t("Sign out")}
                </button>
              </div>
            </div>
          </div>

          <div className="p-6 md:p-8">
            {portalView === "hub" ? (
              <div className="grid gap-5">
                <SectionCard
                  icon={<ReceiptText className="h-5 w-5" />}
                  title={t("Time Clock")}
                  description={t("Choose your name to record your arrival or departure for today's shift.")}
                >
                  <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
                    <div className="space-y-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-[#8a8176]">{t("Select your name")}</p>
                        <div className="mt-3 flex flex-wrap gap-3">
                          {TIME_CLOCK_STAFF_NAMES.map(staffName => {
                            const isSelected = selectedClockStaffName === staffName;
                            return (
                              <button
                                key={staffName}
                                type="button"
                                onClick={() => setSelectedClockStaffName(staffName)}
                                className={`rounded-full px-4 py-2.5 text-sm font-medium transition ${
                                  isSelected
                                    ? "bg-[#2f2a26] text-white shadow-[0_10px_24px_rgba(47,42,38,0.18)]"
                                    : "border border-[#ddd4c8] bg-[#fcfaf6] text-[#2f2a26] hover:bg-white"
                                }`}
                              >
                                {staffName}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <p className="text-sm leading-6 text-[#6b6258]">{t("Tap Sign In when you arrive and Sign Out when you leave.")}</p>
                    </div>
                    <div className="rounded-[1.5rem] border border-[#e2d7c9] bg-[#fbf7f0] p-5 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.24em] text-[#8a8176]">{selectedClockStaffName ?? t("Select your name")}</p>
                      <div className="mt-3 space-y-2 text-sm text-[#5f584f]">
                        {selectedClockStaffStatus ? (
                          <>
                            <p>
                              {selectedClockStaffStatus.isClockedIn
                                ? `${t("Currently signed in since")} ${formatTimeClockLabel(selectedClockStaffStatus.activeEntry?.clockInAt, locale)}`
                                : selectedClockStaffStatus.latestEntry?.clockOutAt
                                  ? `${t("Signed out at")} ${formatTimeClockLabel(selectedClockStaffStatus.latestEntry.clockOutAt, locale)}`
                                  : t("Not signed in yet.")}
                            </p>
                            <p className="text-xs uppercase tracking-[0.16em] text-[#8a8176]">
                              {t("Today's hours")}: {selectedClockStaffStatus.totalHoursToday.toFixed(2)}
                            </p>
                            {selectedClockStaffStatus.activeEntry ? (
                              <p className="text-xs text-[#7d756b]">{t("Signed in at")} {formatTimeClockLabel(selectedClockStaffStatus.activeEntry.clockInAt, locale)}</p>
                            ) : null}
                          </>
                        ) : (
                          <p>{t("Not signed in yet.")}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleTimeClockAction()}
                        disabled={!selectedClockStaffName || isTimeclockActionPending}
                        className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#52665f] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#41534d] disabled:cursor-not-allowed disabled:bg-[#b8b0a4]"
                      >
                        {isTimeclockActionPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                        {selectedClockStaffStatus?.isClockedIn ? t("Sign Out") : t("Sign In")}
                      </button>
                    </div>
                  </div>
                </SectionCard>
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                  <SectionCard
                    icon={<SunMedium className="h-5 w-5" />}
                    title={t("Opening Form")}
                    description={t("Start the day with opening checklist questions, opening cash, and the limited utensil and ready-made gelato inventory.")}
                  >
                    <div>
                      <Link href="/portal/opening" className="inline-flex items-center gap-2 rounded-full bg-[#2f2a26] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18]">
                        {t("Open Opening Form")}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </SectionCard>

                  <SectionCard
                    icon={<MoonStar className="h-5 w-5" />}
                    title={t("Closing Form")}
                    description={t("End the day with closing checklist questions, nightly money and report details, and the same limited inventory counts.")}
                  >
                    <div>
                      <Link href="/portal/closing" className="inline-flex items-center gap-2 rounded-full bg-[#2f2a26] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18]">
                        {t("Open Closing Form")}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </SectionCard>

                  <SectionCard
                    icon={<Package2 className="h-5 w-5" />}
                    title={t("Inventory Form")}
                    description={t("Use the independent inventory form when the team needs the full store count beyond the opening and closing workflows.")}
                  >
                    <div>
                      <Link href="/portal/inventory" className="inline-flex items-center gap-2 rounded-full bg-[#2f2a26] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18]">
                        {t("Open Inventory Form")}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </SectionCard>

                  <SectionCard
                    icon={<Save className="h-5 w-5" />}
                    title={t("Drafts")}
                    description={t("Reopen saved opening, closing, or inventory work from this device for today's business date.")}
                  >
                    {currentDeviceDrafts.length > 0 ? (
                      <div className="flex flex-col gap-3">
                        {currentDeviceDrafts.map(draft => (
                          <div
                            key={draft.view}
                            className="flex flex-col gap-3 rounded-[1.35rem] border border-[#ddd4c8] bg-white/90 p-3 text-sm text-[#2f2a26] sm:flex-row sm:items-center sm:justify-between"
                          >
                            <Link
                              href={draft.href}
                              className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-[1.1rem] px-1 py-1 transition hover:bg-white/80"
                            >
                              <span className="min-w-0">
                                <span className="block font-medium">{draft.label}</span>
                                <span className="mt-1 block text-xs leading-5 text-[#7d756b]">{t("Saved on this device at")} {draft.savedAtLabel}</span>
                              </span>
                              <span className="shrink-0 rounded-full bg-[#2f2a26] px-3 py-2 text-xs font-medium text-white">{t("Resume draft")}</span>
                            </Link>
                            <button
                              type="button"
                              onClick={() => deleteSavedDraft(draft.view, draft.draftKey)}
                              className="inline-flex items-center justify-center gap-2 self-start rounded-full border border-[#ddd4c8] bg-white px-3 py-2 text-xs font-medium text-[#6f3b3b] transition hover:border-[#cfa8a8] hover:bg-[#fff5f5] sm:self-center"
                              aria-label={`${t("Delete draft")} ${draft.label}`}
                            >
                              <X className="h-3.5 w-3.5" />
                              {t("Delete draft")}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm leading-6 text-[#6c645a]">{t("No drafts saved on this device for today.")}</p>
                    )}
                  </SectionCard>
                </div>
              </div>
            ) : null}

            {portalView === "opening" ? (
              <form className="grid gap-6" noValidate onSubmit={handleOpeningSubmit}>
                {submissionNotice?.view === "opening" ? (
                  <div className="rounded-[1.75rem] border border-emerald-200 bg-emerald-50 px-5 py-4 text-[#1f4d3b] shadow-sm">
                    <p className="text-sm font-semibold tracking-[-0.02em]">{submissionNotice.title}</p>
                    <p className="mt-2 text-sm leading-6 text-[#2c5b49]">{submissionNotice.detail}</p>
                  </div>
                ) : null}
                <SectionCard
                  icon={<SunMedium className="h-5 w-5" />}
                  title={t("Opening Form")}
                  description={t("Start with the date and first name, then complete the opening checklist, opening cash, and the limited inventory counts.")}
                >
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field label={t("Business Date")}>
                      <div className="flex h-12 items-center rounded-2xl border border-[#d7cec0] bg-white px-4 text-sm font-medium text-[#2d2925]">{currentBusinessDate}</div>
                    </Field>
                    <Field label={t("First Name")}>
                      <input ref={openingStaffNameRef} className={inputClassName()} type="text" autoComplete="given-name" value={openingForm.staffName} onChange={event => setOpeningForm(current => ({ ...current, staffName: event.target.value }))} />
                    </Field>
                  </div>
                </SectionCard>

                <SectionCard
                  icon={<ClipboardCheck className="h-5 w-5" />}
                  title={t("Opening Checklist")}
                  description={t("Answer the opening checklist questions before moving into cash and inventory.")}
                >
                  {openingQuestionsQuery.isLoading ? <p className="text-sm text-[#625b53]">{t("Loading opening questions…")}</p> : null}
                  <div className="space-y-6">
                    {Object.entries(groupedOpeningQuestions).map(([sectionTitle, questions]) => (
                      <div key={sectionTitle} className="rounded-[1.6rem] border border-[#eadfce] bg-[#fcfaf6] p-5">
                        <h3 className="text-lg font-medium tracking-[-0.03em] text-[#2d2925]">{t(sectionTitle)}</h3>
                        <div className="mt-4 space-y-4">
                          {questions.map(question => (
                            <ChecklistQuestionRow
                              key={question.id}
                              question={question}
                              state={openingAnswers[question.id] ?? { answer: "No", detail: "" }}
                              onChange={next => setOpeningAnswers(state => ({ ...state, [question.id]: next }))}
                              language={language}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6">
                    <Field label={t("Notes / issues")}>
                      <textarea className={textareaClassName()} value={openingForm.notes} onChange={event => setOpeningForm(current => ({ ...current, notes: event.target.value }))} />
                    </Field>
                  </div>
                </SectionCard>

                <SectionCard
                  icon={<ReceiptText className="h-5 w-5" />}
                  title={t("Opening Cash")}
                  description={t("Confirm the drawer amount before moving into the morning inventory counts.")}
                >
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field label={t("Starting cash amount")}>
                      <input className={inputClassName()} type="number" min="0" step="0.01" value={openingForm.startingCash} onChange={event => setOpeningForm(current => ({ ...current, startingCash: event.target.value }))} />
                    </Field>
                    <ToggleField
                      label={t("Cash counted and correct")}
                      value={openingForm.cashCountedAndCorrect}
                      onChange={next => setOpeningForm(current => ({ ...current, cashCountedAndCorrect: next }))}
                      language={language}
                    />
                  </div>
                </SectionCard>

                {renderGelatoSection("opening", true)}

                <SectionCard
                  icon={<Package2 className="h-5 w-5" />}
                  title={t("Utensil and Counter Inventory")}
                  description={t("Count the morning utensil and front-counter items that belong in the opening form only.")}
                >
                  <div className="space-y-4">
                    {serviceInventoryPairs.map(pair => (
                      <div key={pair.left.label} className="grid gap-4 md:grid-cols-2">
                        {renderLimitedInventoryInput(pair.left, "opening")}
                        {renderLimitedInventoryInput(pair.right, "opening")}
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 grid gap-3 md:grid-cols-2">
                    <button type="button" onClick={saveOpeningDraft} disabled={openingMutation.isPending || inventoryMutation.isPending || readyMadeGelatoMutation.isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#ddd4c8] bg-white px-6 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60">
                      <Save className="h-4 w-4" />
                      {t("Save progress")}
                    </button>
                    <button type="submit" disabled={openingMutation.isPending || inventoryMutation.isPending || readyMadeGelatoMutation.isPending} className="w-full rounded-full bg-[#2f2a26] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18] disabled:cursor-not-allowed disabled:opacity-60">
                      {openingMutation.isPending || inventoryMutation.isPending || readyMadeGelatoMutation.isPending ? t("Submitting...") : t("Submit Opening Form")}
                    </button>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-[#7d756b]">{getResubmissionReplacementDescription("opening", t)}</p>
                  {draftSavedAt.opening ? (
                    <div className="mt-2 flex flex-col gap-2 text-xs leading-5 text-[#7d756b]">
                      <p>{t("Draft saved on this device for today. Reopen this same form on this device to keep working.")}</p>
                      <div>
                        <Link href="/portal" className="inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white px-4 py-2 text-xs font-medium text-[#2f2a26] transition hover:bg-[#f5eee5]">
                          {t("Open Drafts")}
                        </Link>
                      </div>
                    </div>
                  ) : null}
                </SectionCard>
              </form>
            ) : null}

            {portalView === "closing" ? (
              <form className="grid gap-6" noValidate onSubmit={handleClosingSubmit}>
                {submissionNotice?.view === "closing" ? (
                  <div className="rounded-[1.75rem] border border-emerald-200 bg-emerald-50 px-5 py-4 text-[#1f4d3b] shadow-sm">
                    <p className="text-sm font-semibold tracking-[-0.02em]">{submissionNotice.title}</p>
                    <p className="mt-2 text-sm leading-6 text-[#2c5b49]">{submissionNotice.detail}</p>
                  </div>
                ) : null}
                <SectionCard
                  icon={<MoonStar className="h-5 w-5" />}
                  title={t("Closing Form")}
                  description={t("Start with the date and first name, then complete the closing checklist, nightly money and report details, and the limited inventory counts.")}
                >
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field label={t("Business Date")}>
                      <div className="flex h-12 items-center rounded-2xl border border-[#d7cec0] bg-white px-4 text-sm font-medium text-[#2d2925]">{currentBusinessDate}</div>
                    </Field>
                    <Field label={t("First Name")}>
                      <input ref={closingStaffNameRef} className={inputClassName()} type="text" autoComplete="given-name" value={closingForm.staffName} onChange={event => setClosingForm(current => ({ ...current, staffName: event.target.value }))} />
                    </Field>
                  </div>
                </SectionCard>

                <SectionCard
                  icon={<ClipboardCheck className="h-5 w-5" />}
                  title={t("Closing Checklist")}
                  description={t("Answer the closing checklist questions before finishing the nightly report and inventory.")}
                >
                  {closingQuestionsQuery.isLoading ? <p className="text-sm text-[#625b53]">{t("Loading closing questions…")}</p> : null}
                  <div className="space-y-6">
                    {Object.entries(groupedClosingQuestions).map(([sectionTitle, questions]) => (
                      <div key={sectionTitle} className="rounded-[1.6rem] border border-[#eadfce] bg-[#fcfaf6] p-5">
                        <h3 className="text-lg font-medium tracking-[-0.03em] text-[#2d2925]">{t(sectionTitle)}</h3>
                        <div className="mt-4 space-y-4">
                          {questions.map(question => (
                            <ChecklistQuestionRow
                              key={question.id}
                              question={question}
                              state={closingAnswers[question.id] ?? { answer: "No", detail: "" }}
                              onChange={next => setClosingAnswers(state => ({ ...state, [question.id]: next }))}
                              language={language}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard
                  icon={<ReceiptText className="h-5 w-5" />}
                  title={t("Nightly Money and Report")}
                  description={t("Record counted cash, payment totals, and nightly report details before the closing inventory section.")}
                >
                  <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                    <Field label={t("Cash total counted")}>
                      <input className={inputClassName()} type="number" min="0" step="0.01" value={closingForm.cashCounted} onChange={event => setClosingForm(current => ({ ...current, cashCounted: event.target.value }))} />
                    </Field>
                    <ToggleField label={t("Matches system?")} value={closingForm.cashMatchesSystem} onChange={next => setClosingForm(current => ({ ...current, cashMatchesSystem: next }))} language={language} />
                    <Field label={t("Cash")}><input className={inputClassName()} type="number" min="0" step="0.01" value={closingForm.cashTotal} onChange={event => setClosingForm(current => ({ ...current, cashTotal: event.target.value }))} /></Field>
                    <Field label={t("Card")}><input className={inputClassName()} type="number" min="0" step="0.01" value={closingForm.cardTotal} onChange={event => setClosingForm(current => ({ ...current, cardTotal: event.target.value }))} /></Field>
                    <Field label={t("Venmo")}><input className={inputClassName()} type="number" min="0" step="0.01" value={closingForm.venmoTotal} onChange={event => setClosingForm(current => ({ ...current, venmoTotal: event.target.value }))} /></Field>
                    <Field label={t("Zelle")}><input className={inputClassName()} type="number" min="0" step="0.01" value={closingForm.zelleTotal} onChange={event => setClosingForm(current => ({ ...current, zelleTotal: event.target.value }))} /></Field>
                    <Field label={t("Total Sales")}><input className={inputClassName()} type="text" value={`$${totalSales.toFixed(2)}`} readOnly /></Field>
                  </div>

                  <div className="mt-6 rounded-[1.5rem] border border-[#e8ddd0] bg-[#fbf7f1] p-5">
                    <div className="grid gap-4 md:grid-cols-[minmax(120px,180px)_minmax(0,1fr)_minmax(0,1fr)] md:items-end">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.24em] text-[#8a8176]">{t("Cup counts sold")}</p>
                        <h3 className="mt-2 text-xl font-medium tracking-[-0.03em] text-[#2d2925]">{t("Here and To Go")}</h3>
                      </div>
                      <span className="text-sm font-medium uppercase tracking-[0.22em] text-[#8a8176] md:text-center">{t("Here")}</span>
                      <span className="text-sm font-medium uppercase tracking-[0.22em] text-[#8a8176] md:text-center">{t("To Go")}</span>
                    </div>
                    <div className="mt-5 space-y-3">
                      {endOfDayCupRows.map(row => (
                        <div key={row.label} className="grid gap-3 rounded-2xl border border-[#eadfce] bg-white/80 p-3 md:grid-cols-[minmax(120px,180px)_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                          <span className="text-sm font-medium text-[#2f2a26]">{row.label}</span>
                          <input className={smallInputClassName()} type="number" min="0" step="1" value={closingForm[row.hereKey]} onChange={event => setClosingForm(current => ({ ...current, [row.hereKey]: event.target.value }))} />
                          <input className={smallInputClassName()} type="number" min="0" step="1" value={closingForm[row.toGoKey]} onChange={event => setClosingForm(current => ({ ...current, [row.toGoKey]: event.target.value }))} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-6 grid gap-5 xl:grid-cols-2">
                    <Field label={t("Waste Notes")}><textarea className={textareaClassName()} value={closingForm.wasteNotes} onChange={event => setClosingForm(current => ({ ...current, wasteNotes: event.target.value }))} /></Field>
                    <Field label={t("Low-Item Notes")}><textarea className={textareaClassName()} value={closingForm.lowItemNotes} onChange={event => setClosingForm(current => ({ ...current, lowItemNotes: event.target.value }))} /></Field>
                  </div>
                  <div className="mt-5 grid gap-5">
                    <Field label={t("General Notes")}><textarea className={textareaClassName()} value={closingForm.generalNotes} onChange={event => setClosingForm(current => ({ ...current, generalNotes: event.target.value }))} /></Field>
                    <Field label={t("Notes / issues")}><textarea className={textareaClassName()} value={closingForm.notes} onChange={event => setClosingForm(current => ({ ...current, notes: event.target.value }))} /></Field>
                  </div>
                </SectionCard>

                {renderGelatoSection("closing")}

                <SectionCard
                  icon={<Package2 className="h-5 w-5" />}
                  title={t("Utensil and Counter Inventory")}
                  description={t("Count the evening utensil and front-counter items that belong in the closing form only.")}
                >
                  <div className="space-y-4">
                    {serviceInventoryPairs.map(pair => (
                      <div key={pair.left.label} className="grid gap-4 md:grid-cols-2">
                        {renderLimitedInventoryInput(pair.left, "closing")}
                        {renderLimitedInventoryInput(pair.right, "closing")}
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 grid gap-3 md:grid-cols-2">
                    <button type="button" onClick={saveClosingDraft} disabled={closingMutation.isPending || endOfDayMutation.isPending || inventoryMutation.isPending || readyMadeGelatoMutation.isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#ddd4c8] bg-white px-6 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60">
                      <Save className="h-4 w-4" />
                      {t("Save progress")}
                    </button>
                    <button type="submit" disabled={closingMutation.isPending || endOfDayMutation.isPending || inventoryMutation.isPending || readyMadeGelatoMutation.isPending} className="w-full rounded-full bg-[#2f2a26] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18] disabled:cursor-not-allowed disabled:opacity-60">
                      {closingMutation.isPending || endOfDayMutation.isPending || inventoryMutation.isPending || readyMadeGelatoMutation.isPending ? t("Submitting...") : t("Submit Closing Form")}
                    </button>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-[#7d756b]">{getResubmissionReplacementDescription("closing", t)}</p>
                  {draftSavedAt.closing ? (
                    <div className="mt-2 flex flex-col gap-2 text-xs leading-5 text-[#7d756b]">
                      <p>{t("Draft saved on this device for today. Reopen this same form on this device to keep working.")}</p>
                      <div>
                        <Link href="/portal" className="inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white px-4 py-2 text-xs font-medium text-[#2f2a26] transition hover:bg-[#f5eee5]">
                          {t("Open Drafts")}
                        </Link>
                      </div>
                    </div>
                  ) : null}
                </SectionCard>
              </form>
            ) : null}

            {portalView === "inventory" ? (
              <form className="grid gap-6" onSubmit={handleInventorySubmit}>
                {submissionNotice?.view === "inventory" ? (
                  <div className="rounded-[1.75rem] border border-emerald-200 bg-emerald-50 px-5 py-4 text-[#1f4d3b] shadow-sm">
                    <p className="text-sm font-semibold tracking-[-0.02em]">{submissionNotice.title}</p>
                    <p className="mt-2 text-sm leading-6 text-[#2c5b49]">{submissionNotice.detail}</p>
                  </div>
                ) : null}
                <SectionCard
                  icon={<Package2 className="h-5 w-5" />}
                  title={t("Inventory Form")}
                  description={t("Use this separate form for the full business inventory, including ingredients, utensils, packaging, and ready-made gelato.")}
                >
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field label={t("Business Date")}>
                      <div className="flex h-12 items-center rounded-2xl border border-[#d7cec0] bg-white px-4 text-sm font-medium text-[#2d2925]">{currentBusinessDate}</div>
                    </Field>
                    <div className="rounded-[1.5rem] border border-[#e8ddd0] bg-[#fbf7f1] p-4 text-sm leading-7 text-[#625b53]">
                      {t("This full inventory form is separate from the opening and closing forms so the team can count the full store only when needed.")}
                    </div>
                  </div>
                </SectionCard>

                {renderGelatoSection(
                  "opening",
                  true,
                  t("Count ready-made gelato in this separate inventory form before saving the full-store inventory."),
                  t("Inventory snapshot"),
                )}

                <SectionCard
                  icon={<Package2 className="h-5 w-5" />}
                  title={t("Full Store Inventory")}
                  description={t("Count every inventory department here, including ingredients, packaging, utensils, and cleaning supplies.")}
                >
                  <div className="space-y-6">
                    {Object.entries(inventoryGroups).map(([department, items]) => (
                      <div key={department} className="rounded-[1.6rem] border border-[#eadfce] bg-[#fcfaf6] p-5">
                        <h3 className="text-lg font-medium tracking-[-0.03em] text-[#2d2925]">{t(department)}</h3>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                          {items.map(item => (
                            <Field key={item.id} label={t(item.itemName)} hint={`${t("Par level")}: ${item.parLevel}`}>
                              <input className={smallInputClassName()} type="number" min="0" step="0.01" value={serviceInventoryCounts[item.id] ?? ""} onChange={event => updateInventoryItem(item.id, event.target.value)} />
                            </Field>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 grid gap-3 md:grid-cols-2">
                    <button type="button" onClick={saveInventoryDraft} disabled={inventoryMutation.isPending || readyMadeGelatoMutation.isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#ddd4c8] bg-white px-6 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60">
                      <Save className="h-4 w-4" />
                      {t("Save progress")}
                    </button>
                    <button type="submit" disabled={inventoryMutation.isPending || readyMadeGelatoMutation.isPending} className="w-full rounded-full bg-[#2f2a26] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18] disabled:cursor-not-allowed disabled:opacity-60">
                      {inventoryMutation.isPending || readyMadeGelatoMutation.isPending ? t("Saving inventory and gelato...") : t("Save inventory and gelato updates")}
                    </button>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-[#7d756b]">{getResubmissionReplacementDescription("inventory", t)}</p>
                  {draftSavedAt.inventory ? (
                    <div className="mt-3 flex flex-col gap-2 text-xs leading-5 text-[#7d756b]">
                      <p>{t("Draft saved on this device for today. Reopen this same form on this device to keep working.")}</p>
                      <div>
                        <Link href="/portal" className="inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white px-4 py-2 text-xs font-medium text-[#2f2a26] transition hover:bg-[#f5eee5]">
                          {t("Open Drafts")}
                        </Link>
                      </div>
                    </div>
                  ) : null}
                </SectionCard>
              </form>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
