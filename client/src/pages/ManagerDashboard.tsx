import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getLoginUrl } from "@/const";
import { normalizeGelatoFlavorName } from "@/lib/gelatoFlavorAliases";
import { getHistoryGelatoRowVolumeBreakdown } from "@/lib/historyGelato";
import { buildManagerReconciliationSnapshot, MANAGER_INVENTORY_TABS, type ManagerInventoryView } from "@/lib/managerReconciliation";
import { buildShopifyVarianceSnapshot, summarizeShopifySalesCsv, type ShopifySalesImportSummary } from "@/lib/shopifySalesCsv";
import { trpc } from "@/lib/trpc";
import { applyAnalyzedPhotoPanSetup, getAnalyzedPhotoCombinedGrossWeightKg, getAnalyzedPhotoPanSetup } from "./EmployeePortal";
import { formatPacificCalendarDate, formatPacificTime, getPacificBusinessDate, getPacificSundayWeekStart, getPacificWeekStart } from "../../../shared/businessDate";
import {
  AlertTriangle,
  CalendarRange,
  ClipboardCheck,
  CupSoda,
  PackagePlus,
  Trash2,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { useLocation } from "wouter";

function todayValue() {
  return getPacificBusinessDate();
}

function roundTo(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatPercent(value: number) {
  return `${Math.round((value || 0) * 100)}%`;
}

function formatCount(value: number | null | undefined) {
  if (value == null) return "—";
  return Math.round(value).toLocaleString("en-US");
}

function formatWholeOunces(value: number | null | undefined) {
  if (value == null) return "—";
  return `${formatCount(value)} oz`;
}

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatTimeOnly(value: number | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

type DailyStaffActivityRowInput = {
  staffName: string;
  totalHoursToday: number;
  todayEntries: Array<{
    clockInAt: number;
    clockOutAt: number | null;
  }>;
  activeEntry?: {
    clockInAt: number;
    clockOutAt: number | null;
  } | null;
};

export function buildSelectedDayStaffActivityRows(staff: DailyStaffActivityRowInput[]) {
  return staff
    .map(member => {
      const entries = [...(member.todayEntries ?? [])].sort((left, right) => left.clockInAt - right.clockInAt);
      const firstClockIn = entries[0]?.clockInAt ?? member.activeEntry?.clockInAt ?? null;
      const closedEntries = entries.filter(entry => entry.clockOutAt != null);
      const lastClockOut = closedEntries.length > 0 ? closedEntries[closedEntries.length - 1]?.clockOutAt ?? null : null;
      const hasWorked = entries.length > 0 || member.totalHoursToday > 0 || Boolean(member.activeEntry);

      return {
        staffName: member.staffName,
        hasWorked,
        checkInLabel: formatTimeOnly(firstClockIn),
        checkOutLabel: member.activeEntry && member.activeEntry.clockOutAt == null ? "Open shift" : formatTimeOnly(lastClockOut),
        totalHoursLabel: `${member.totalHoursToday.toFixed(2)} hrs`,
        shiftCountLabel: `${entries.length} shift${entries.length === 1 ? "" : "s"}`,
      };
    })
    .filter(member => member.hasWorked)
    .sort((left, right) => left.staffName.localeCompare(right.staffName));
}

function addDaysToBusinessDate(dateString: string, dayOffset: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  const utcMidday = new Date(Date.UTC(year, month - 1, day, 12));
  utcMidday.setUTCDate(utcMidday.getUTCDate() + dayOffset);
  return utcMidday.toISOString().slice(0, 10);
}

function buildBusinessDateRange(startDate: string, endDate: string) {
  if (!startDate || !endDate || startDate > endDate) return [] as string[];
  const dates: string[] = [];
  let current = startDate;

  while (current <= endDate && dates.length < 31) {
    dates.push(current);
    current = addDaysToBusinessDate(current, 1);
  }

  return dates;
}

function formatFieldLabel(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, character => character.toUpperCase());
}

export function getCompactSnapshotName(name: string | null | undefined) {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return "—";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return trimmed;
  return parts[0] ?? trimmed;
}

export function getSnapshotValueClassName(value: string) {
  return value.length > 10
    ? "mt-3 font-serif text-[clamp(1.75rem,3vw,2.85rem)] leading-[0.95] tracking-tight text-[#1f2b27]"
    : "mt-3 font-serif text-[clamp(2rem,4vw,3.5rem)] leading-none tracking-tight text-[#1f2b27]";
}

export function normalizeFlavorPreviewKey(flavor: string) {
  return normalizeGelatoFlavorName(flavor).trim().toLowerCase();
}

type SubmissionHistoryPhoto = {
  fileName: string;
  imageUrl: string;
  imageKey?: string;
  flavor: string;
  smallPanCount: number;
  largePanCount: number;
  combinedGrossWeightKg: number;
  confidence: "high" | "medium" | "low";
  warning?: string;
};

type SubmissionHistoryEntryRecord = {
  id: number;
  businessDate: string;
  submissionType: "opening" | "closing" | "inventory";
  staffName: string;
  createdAt: string | Date;
  payload: {
    form?: Record<string, unknown>;
    checklistAnswers?: Array<{ sectionTitle: string; prompt: string; answer: string; detail?: string }>;
    gelatoEntries?: Array<{ flavor: string; smallPanCount: number; smallGrossWeightKg: number; largePanCount: number; largeGrossWeightKg: number }>;
    gelatoEntryMode?: string;
    analyzedPhotos?: SubmissionHistoryPhoto[];
    inventoryItems?: Array<{ itemName: string; currentQuantity: number; unitType: string; department?: string }>;
    notes?: Record<string, string>;
  };
};

type SubmissionGelatoEditorRow = {
  flavor: string;
  smallPanCount: string;
  smallGrossWeightKg: string;
  largePanCount: string;
  largeGrossWeightKg: string;
};

type SubmissionPhotoEditorRow = SubmissionHistoryPhoto & {
  combinedGrossWeightInput: string;
};

type SubmissionEditMode = "manual" | "photo";

type FlavorPhotoPreviewMap = Map<string, SubmissionHistoryPhoto>;

export function buildFlavorPhotoPreviewMap(submissionHistory: SubmissionHistoryEntryRecord[]) {
  const previewMap: FlavorPhotoPreviewMap = new Map();

  submissionHistory.forEach(entry => {
    if (entry.submissionType !== "opening" && entry.submissionType !== "closing") return;
    (entry.payload.analyzedPhotos ?? []).forEach(photo => {
      if (!photo.imageUrl) return;
      const normalizedFlavor = normalizeFlavorPreviewKey(photo.flavor);
      if (!normalizedFlavor) return;
      const key = `${entry.submissionType}:${normalizedFlavor}`;
      if (!previewMap.has(key)) {
        previewMap.set(key, photo);
      }
    });
  });

  return previewMap;
}

export function allocateEstimatedFlavorSoldOunces(distributedVolumeOunces: number[], totalSoldOunces: number, incrementOunces = 2) {
  const normalizedDistributed = distributedVolumeOunces.map(value => Math.max(0, value || 0));
  const normalizedIncrement = Math.max(1, Math.round(incrementOunces));
  const normalizedTotalSold = Math.max(0, Math.round(totalSoldOunces / normalizedIncrement) * normalizedIncrement);
  const totalDistributed = normalizedDistributed.reduce((sum, value) => sum + value, 0);

  if (normalizedTotalSold <= 0 || totalDistributed <= 0 || normalizedDistributed.length === 0) {
    return normalizedDistributed.map(() => 0);
  }

  const totalBlocks = Math.round(normalizedTotalSold / normalizedIncrement);
  const exactBlocks = normalizedDistributed.map(value => (value / totalDistributed) * totalBlocks);
  const baseBlocks = exactBlocks.map(value => Math.floor(value));
  let remainingBlocks = totalBlocks - baseBlocks.reduce((sum, value) => sum + value, 0);

  const rankedRemainders = exactBlocks
    .map((value, index) => ({
      index,
      remainder: value - baseBlocks[index],
      weight: normalizedDistributed[index],
    }))
    .sort((left, right) => right.remainder - left.remainder || right.weight - left.weight || left.index - right.index);

  for (let index = 0; index < rankedRemainders.length && remainingBlocks > 0; index += 1) {
    baseBlocks[rankedRemainders[index].index] += 1;
    remainingBlocks -= 1;
  }

  return baseBlocks.map(value => value * normalizedIncrement);
}

function toDisplayString(value: unknown) {
  if (value == null || value === "") return "—";
  return String(value);
}

type SubmissionFormValueField = {
  key: string;
  label: string;
  value: string;
};

type SubmissionFormEditorField = SubmissionFormValueField & {
  kind: "number" | "text" | "yesno";
};

type AttendanceEditorState = {
  entryId?: number;
  staffName: string;
  businessDate: string;
  clockInTime: string;
  clockOutTime: string;
};

const nestedOpeningStockCountKeys = new Set(["cups4oz", "cups8oz", "cupsPint", "cupsLiter", "lids4oz", "lids8oz", "lidsPint", "lidsLiter", "spoons"]);
const numericSubmissionFormKeys = new Set([
  "startingCash",
  "cashCounted",
  "cashTotal",
  "cardTotal",
  "zelleTotal",
  "venmoTotal",
  "cups4ozHere",
  "cups4ozToGo",
  "cups8ozHere",
  "cups8ozToGo",
  "cupsPint",
  "cupsPintHere",
  "cupsPintToGo",
  "cupsLiter",
  "cupsLiterHere",
  "cupsLiterToGo",
  "cups4oz",
  "cups8oz",
  "lids4oz",
  "lids8oz",
  "lidsPint",
  "lidsLiter",
  "spoons",
]);

function getSubmissionFormPrimitiveEntries(form: Record<string, unknown>) {
  const primitiveEntries = Object.entries(form).filter(([, value]) => typeof value !== "object");
  const stockCounts = form.stockCounts;

  if (stockCounts && typeof stockCounts === "object" && !Array.isArray(stockCounts)) {
    Object.entries(stockCounts).forEach(([key, value]) => {
      if (typeof value === "object") return;
      primitiveEntries.push([key, value]);
    });
  }

  return primitiveEntries;
}

export function createSubmissionFormEditorFields(form: Record<string, unknown>) {
  return getSubmissionFormPrimitiveEntries(form)
    .filter(([key]) => key !== "businessDate")
    .map(([key, value]) => ({
      key,
      label: formatFieldLabel(key),
      value: value == null ? "" : String(value),
      kind: value === "Yes" || value === "No" ? "yesno" : numericSubmissionFormKeys.has(key) ? "number" : "text",
    })) satisfies SubmissionFormEditorField[];
}

export function rebuildSubmissionFormFromEditor(form: Record<string, unknown>, editorFields: SubmissionFormEditorField[]) {
  const nextForm: Record<string, unknown> = { ...form };
  const nextStockCounts = form.stockCounts && typeof form.stockCounts === "object" && !Array.isArray(form.stockCounts)
    ? { ...(form.stockCounts as Record<string, unknown>) }
    : {};

  editorFields.forEach(field => {
    const normalizedValue = field.kind === "number"
      ? Number(field.value || 0)
      : field.kind === "yesno"
        ? (field.value === "Yes" ? "Yes" : "No")
        : field.value;

    if (nestedOpeningStockCountKeys.has(field.key)) {
      nextStockCounts[field.key] = Number.isFinite(Number(normalizedValue)) ? Number(normalizedValue) : 0;
      return;
    }

    nextForm[field.key] = normalizedValue;
  });

  if (Object.keys(nextStockCounts).length > 0) {
    nextForm.stockCounts = nextStockCounts;
  }

  return nextForm;
}

function buildTimeInputValue(value: number | null | undefined) {
  if (value == null) return "";
  return new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Los_Angeles",
  }).format(new Date(value));
}

export function buildSubmissionFormValueRows(form: Record<string, unknown>) {
  const primitiveEntries = getSubmissionFormPrimitiveEntries(form);
  const valueByKey = new Map(primitiveEntries);
  const consumedKeys = new Set<string>();
  const rows: SubmissionFormValueField[][] = [];
  const hasClosingCupBreakdown = valueByKey.has("cups4ozHere") || valueByKey.has("cups4ozToGo") || valueByKey.has("cups8ozHere") || valueByKey.has("cups8ozToGo");
  const hasOpeningStockCounts = ["cups4oz", "cups8oz", "cupsPint", "cupsLiter", "lids8oz", "lidsPint", "lidsLiter", "spoons"].some(key => valueByKey.has(key));

  const addRow = (keys: string[]) => {
    const row = keys
      .filter(key => valueByKey.has(key))
      .map(key => {
        consumedKeys.add(key);
        return {
          key,
          label: formatFieldLabel(key),
          value: toDisplayString(valueByKey.get(key)),
        };
      });

    if (row.length > 0) {
      rows.push(row);
    }
  };

  if (hasClosingCupBreakdown) {
    addRow(["businessDate", "staffName"]);
    addRow(["cashCounted", "cashMatchesSystem"]);
    addRow(["notes"]);
    addRow(["cups4ozHere", "cups4ozToGo"]);
    addRow(["cups8ozHere", "cups8ozToGo"]);

    const pintTotal = valueByKey.has("cupsPint") ? valueByKey.get("cupsPint") : valueByKey.get("cupsPintToGo");
    const literTotal = valueByKey.has("cupsLiter") ? valueByKey.get("cupsLiter") : valueByKey.get("cupsLiterToGo");
    consumedKeys.add("cupsPintHere");
    consumedKeys.add("cupsPintToGo");
    consumedKeys.add("cupsLiterHere");
    consumedKeys.add("cupsLiterToGo");

    rows.push(
      [
        {
          key: "cupsPint",
          label: "Cups Pint",
          value: toDisplayString(pintTotal),
        },
        {
          key: "cupsLiter",
          label: "Cups Liter",
          value: toDisplayString(literTotal),
        },
      ].filter(field => field.value !== "—" || field.key === "cupsPint" || field.key === "cupsLiter")
    );

    addRow(["cashTotal"]);
    addRow(["cardTotal", "zelleTotal"]);
    addRow(["venmoTotal", "wasteNotes"]);
    addRow(["lowItemNotes", "generalNotes"]);
  } else if (hasOpeningStockCounts) {
    addRow(["businessDate", "staffName"]);
    addRow(["startingCash", "cashCountedAndCorrect"]);
    addRow(["storeReadyToOpen", "notes"]);
    addRow(["cups4oz", "cups8oz"]);
    addRow(["cupsPint", "cupsLiter"]);
    addRow(["lids8oz", "lidsPint"]);
    addRow(["lidsLiter", "spoons"]);
    consumedKeys.add("lids4oz");
  }

  primitiveEntries.forEach(([key, value]) => {
    if (consumedKeys.has(key)) return;
    rows.push([
      {
        key,
        label: formatFieldLabel(key),
        value: toDisplayString(value),
      },
    ]);
  });

  return rows.filter(row => row.length > 0);
}

function getSubmissionEditMode(entry: SubmissionHistoryEntryRecord): SubmissionEditMode {
  return entry.payload.gelatoEntryMode === "photo" && (entry.payload.analyzedPhotos?.length ?? 0) > 0 ? "photo" : "manual";
}

function createSubmissionPhotoEditorRows(entry: SubmissionHistoryEntryRecord): SubmissionPhotoEditorRow[] {
  return (entry.payload.analyzedPhotos ?? []).map(photo => ({
    ...photo,
    combinedGrossWeightInput: photo.combinedGrossWeightKg > 0 ? String(photo.combinedGrossWeightKg) : "",
  }));
}

function createSubmissionGelatoEditorRows(entry: SubmissionHistoryEntryRecord): SubmissionGelatoEditorRow[] {
  if (!entry.payload.gelatoEntries || entry.payload.gelatoEntries.length === 0) {
    return [
      {
        flavor: "",
        smallPanCount: "",
        smallGrossWeightKg: "",
        largePanCount: "",
        largeGrossWeightKg: "",
      },
    ];
  }

  return entry.payload.gelatoEntries.map(row => ({
    flavor: row.flavor,
    smallPanCount: String(row.smallPanCount || ""),
    smallGrossWeightKg: row.smallGrossWeightKg > 0 ? String(row.smallGrossWeightKg) : "",
    largePanCount: String(row.largePanCount || ""),
    largeGrossWeightKg: row.largeGrossWeightKg > 0 ? String(row.largeGrossWeightKg) : "",
  }));
}

function SurfaceCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-[2rem] border border-white/70 bg-white/82 p-6 shadow-[0_24px_70px_rgba(88,83,72,0.10)] backdrop-blur ${className}`}>{children}</section>;
}

function StatePanel({
  title,
  description,
  tone = "default",
}: {
  title: string;
  description: string;
  tone?: "default" | "warning" | "error";
}) {
  const toneClasses = {
    default: "border-[#ddd2c3] bg-[#fcfaf6] text-[#68716b]",
    warning: "border-[#ead9b8] bg-[#f8f1df] text-[#745a2b]",
    error: "border-[#efc6c6] bg-[#fbefef] text-[#8a4343]",
  } as const;

  return (
    <div className={`rounded-[1.5rem] border p-5 shadow-sm ${toneClasses[tone]}`}>
      <p className="font-medium">{title}</p>
      <p className="mt-2 text-sm leading-6">{description}</p>
    </div>
  );
}

function inventoryFieldClassName() {
  return "h-11 rounded-2xl border border-[#dbd2c5] bg-[#fcfaf6] px-4 text-sm text-[#24332f] shadow-sm outline-none transition focus:border-[#52665f] focus:ring-4 focus:ring-[#52665f]/10";
}

function formatSignedValue(value: number | null | undefined) {
  if (value == null) return "—";
  if (Math.abs(value) < 0.5) return "0";
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function classifyDifference(value: number) {
  const absolute = Math.abs(value);
  if (absolute < 0.5) return "Aligned";
  if (absolute < 3) return "Review";
  return value > 0 ? "Over" : "Under";
}

const AWAITING_CLOSING_FORM_LABEL = "Awaiting closing form";
const AWAITING_CLOSING_TEXT = "Awaiting closing";
const FLAVOR_PREVIEW_VIEWPORT_MARGIN_PX = 16;
const FLAVOR_PREVIEW_OFFSET_PX = 12;
const FLAVOR_PREVIEW_MAX_WIDTH_PX = 352;
const FLAVOR_PREVIEW_MIN_WIDTH_PX = 260;
const FLAVOR_PREVIEW_APPROX_HEIGHT_PX = 420;

export function getFlavorPreviewPosition(clientX: number, clientY: number, viewportWidth: number, viewportHeight: number) {
  const safeViewportWidth = Math.max(FLAVOR_PREVIEW_MIN_WIDTH_PX + FLAVOR_PREVIEW_VIEWPORT_MARGIN_PX * 2, viewportWidth || 0);
  const safeViewportHeight = Math.max(FLAVOR_PREVIEW_APPROX_HEIGHT_PX + FLAVOR_PREVIEW_VIEWPORT_MARGIN_PX * 2, viewportHeight || 0);
  const width = Math.max(
    FLAVOR_PREVIEW_MIN_WIDTH_PX,
    Math.min(FLAVOR_PREVIEW_MAX_WIDTH_PX, safeViewportWidth - FLAVOR_PREVIEW_VIEWPORT_MARGIN_PX * 2),
  );
  const maxLeft = Math.max(FLAVOR_PREVIEW_VIEWPORT_MARGIN_PX, safeViewportWidth - width - FLAVOR_PREVIEW_VIEWPORT_MARGIN_PX);
  const left = Math.min(
    Math.max(clientX - width / 2, FLAVOR_PREVIEW_VIEWPORT_MARGIN_PX),
    maxLeft,
  );
  const preferredTop = clientY + FLAVOR_PREVIEW_OFFSET_PX;
  const maxTop = Math.max(
    FLAVOR_PREVIEW_VIEWPORT_MARGIN_PX,
    safeViewportHeight - FLAVOR_PREVIEW_APPROX_HEIGHT_PX - FLAVOR_PREVIEW_VIEWPORT_MARGIN_PX,
  );
  const top = preferredTop <= maxTop
    ? preferredTop
    : Math.max(FLAVOR_PREVIEW_VIEWPORT_MARGIN_PX, clientY - FLAVOR_PREVIEW_APPROX_HEIGHT_PX - FLAVOR_PREVIEW_OFFSET_PX);

  return { left, top, width };
}

type FlavorWeightCellProps = {
  value: string;
  photo?: SubmissionHistoryPhoto;
};

function FlavorWeightCell({ value, photo }: FlavorWeightCellProps) {
  const [previewPosition, setPreviewPosition] = useState<{ left: number; top: number; width: number } | null>(null);

  if (!photo) {
    return <span>{value}</span>;
  }

  function showPreview(clientX: number, clientY: number) {
    const viewportWidth = typeof window === "undefined" ? FLAVOR_PREVIEW_MAX_WIDTH_PX + FLAVOR_PREVIEW_VIEWPORT_MARGIN_PX * 2 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? FLAVOR_PREVIEW_APPROX_HEIGHT_PX + FLAVOR_PREVIEW_VIEWPORT_MARGIN_PX * 2 : window.innerHeight;
    setPreviewPosition(getFlavorPreviewPosition(clientX, clientY, viewportWidth, viewportHeight));
  }

  const previewCard = previewPosition && typeof document !== "undefined"
    ? createPortal(
        <div
          className="pointer-events-none fixed z-[9999] rounded-[1.35rem] border border-[#e5ddd0] bg-white p-4 shadow-2xl"
          style={{ left: `${previewPosition.left}px`, top: `${previewPosition.top}px`, width: `${previewPosition.width}px` }}
        >
          <img src={photo.imageUrl} alt={`${photo.flavor} scale preview`} loading="lazy" decoding="async" className="h-56 w-full rounded-[1rem] bg-[#f6f1e8] object-contain" />
          <p className="mt-3 text-sm font-medium text-[#24332f]">{photo.fileName}</p>
          <p className="mt-1 text-xs leading-5 text-[#66706a]">{photo.flavor} · {photo.combinedGrossWeightKg.toFixed(3)} kg gross</p>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <span
        className="inline-flex cursor-default border-b border-dashed border-[#cbbba6] text-[#24332f] outline-none focus-visible:ring-2 focus-visible:ring-[#cbbba6] focus-visible:ring-offset-2"
        tabIndex={0}
        onMouseEnter={event => showPreview(event.clientX, event.currentTarget.getBoundingClientRect().bottom)}
        onMouseMove={event => showPreview(event.clientX, event.currentTarget.getBoundingClientRect().bottom)}
        onMouseLeave={() => setPreviewPosition(null)}
        onFocus={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          showPreview(rect.left + rect.width / 2, rect.bottom);
        }}
        onBlur={() => setPreviewPosition(null)}
      >
        {value}
      </span>
      {previewCard}
    </>
  );
}

function renderFlavorWeightCell(value: string, photo?: SubmissionHistoryPhoto) {
  return <FlavorWeightCell value={value} photo={photo} />;
}

export default function ManagerDashboard() {
  const [location, setLocation] = useLocation();
  const isInventoryWorkspaceRoute = location.startsWith("/dashboard/inventory");
  const isTimeBookRoute = location.startsWith("/dashboard/time-book");
  const isCookbookRoute = location.startsWith("/cookbook");
  const isFormsRoute = location.startsWith("/dashboard/forms");
  const isHistoryRoute = location.startsWith("/dashboard/history") || location.startsWith("/dashboard/analysis");
  const isOverviewRoute = !isInventoryWorkspaceRoute && !isTimeBookRoute && !isCookbookRoute && !isFormsRoute && !isHistoryRoute;
  const redirectPath = isInventoryWorkspaceRoute
    ? "/dashboard/inventory"
    : isTimeBookRoute
      ? "/dashboard/time-book"
      : isCookbookRoute
        ? "/cookbook"
        : isFormsRoute
          ? "/dashboard/forms"
          : isHistoryRoute
            ? "/dashboard/history"
            : "/dashboard";

  const { user, loading } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: getLoginUrl(redirectPath),
  });
  const utils = trpc.useUtils();
  const [liveNow, setLiveNow] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(todayValue());
  const [hoursRangeStart, setHoursRangeStart] = useState(() => getPacificSundayWeekStart(todayValue()));
  const [hoursRangeEnd, setHoursRangeEnd] = useState(todayValue());
  const currentPacificDateLabel = useMemo(() => formatPacificCalendarDate(liveNow, "en-US"), [liveNow]);
  const currentPacificTimeLabel = useMemo(() => formatPacificTime(liveNow, "en-US"), [liveNow]);
  const currentPacificDateTimeLabel = useMemo(() => `${currentPacificDateLabel} · ${currentPacificTimeLabel}`, [currentPacificDateLabel, currentPacificTimeLabel]);
  const [inventoryDashboardView, setInventoryDashboardView] = useState<ManagerInventoryView>("product");
  const [inventoryForm, setInventoryForm] = useState({
    id: undefined as number | undefined,
    department: "Ingredients",
    category: "Base",
    itemName: "",
    unitType: "units",
    packSize: "",
    costPerUnit: "0",
    currentQuantity: "0",
    parLevel: "0",
    reorderQuantity: "0",
    supplier: "",
    supplierContact: "",
    lastCountDate: "",
    notes: "",
  });
  const [checklistForm, setChecklistForm] = useState({
    id: undefined as number | undefined,
    checklistType: "opening" as "opening" | "closing",
    sectionTitle: "Equipment",
    prompt: "",
    detailPrompt: "If no, explain the issue.",
    detailTrigger: "No" as "Yes" | "No" | "Never",
    displayOrder: "1",
  });
  const [editingSubmissionId, setEditingSubmissionId] = useState<number | null>(null);
  const [editingSubmissionMode, setEditingSubmissionMode] = useState<SubmissionEditMode | null>(null);
  const [submissionGelatoEditorRows, setSubmissionGelatoEditorRows] = useState<SubmissionGelatoEditorRow[]>([]);
  const [submissionPhotoEditorRows, setSubmissionPhotoEditorRows] = useState<SubmissionPhotoEditorRow[]>([]);
  const [editingSubmissionFormId, setEditingSubmissionFormId] = useState<number | null>(null);
  const [submissionFormEditorFields, setSubmissionFormEditorFields] = useState<SubmissionFormEditorField[]>([]);
  const [attendanceEditor, setAttendanceEditor] = useState<AttendanceEditorState | null>(null);
  const [shopifyImportSummary, setShopifyImportSummary] = useState<ShopifySalesImportSummary | null>(null);
  const [shopifyImportFileName, setShopifyImportFileName] = useState("");
  const [shopifyImportError, setShopifyImportError] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";
  const maxBusinessDate = todayValue();

  useEffect(() => {
    if (!loading && user && !isAdmin) {
      setLocation("/portal");
    }
  }, [isAdmin, loading, setLocation, user]);

  useEffect(() => {
    if (selectedDate > maxBusinessDate) {
      setSelectedDate(maxBusinessDate);
    }

    if (hoursRangeEnd > maxBusinessDate) {
      setHoursRangeEnd(maxBusinessDate);
    }

    if (hoursRangeStart > hoursRangeEnd) {
      setHoursRangeStart(getPacificSundayWeekStart(hoursRangeEnd));
    }

    if (inventoryForm.lastCountDate && inventoryForm.lastCountDate > maxBusinessDate) {
      setInventoryForm(current => ({ ...current, lastCountDate: maxBusinessDate }));
    }
  }, [hoursRangeEnd, hoursRangeStart, inventoryForm.lastCountDate, maxBusinessDate, selectedDate]);

  useEffect(() => {
    const interval = window.setInterval(() => setLiveNow(new Date()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setShopifyImportSummary(null);
    setShopifyImportFileName("");
    setShopifyImportError(null);
  }, [selectedDate]);

  const dailyQuery = trpc.dashboard.daily.useQuery(
    { businessDate: selectedDate },
    { enabled: isAdmin, refetchOnWindowFocus: false }
  );
  const trendQuery = trpc.dashboard.salesTrend.useQuery({ days: 28 }, { enabled: isAdmin, refetchOnWindowFocus: false });
  const wowQuery = trpc.dashboard.weekOverWeek.useQuery(undefined, { enabled: isAdmin, refetchOnWindowFocus: false });
  const alertsQuery = trpc.dashboard.inventoryAlerts.useQuery(undefined, { enabled: isAdmin, refetchOnWindowFocus: false });
  const inventoryItemsQuery = trpc.dashboard.inventoryItems.useQuery(undefined, { enabled: isAdmin, refetchOnWindowFocus: false });
  const recipesQuery = trpc.dashboard.recipes.useQuery(undefined, { enabled: isAdmin, refetchOnWindowFocus: false });
  const openingChecklistQuery = trpc.dashboard.checklistQuestions.useQuery({ checklistType: "opening" }, { enabled: isAdmin, refetchOnWindowFocus: false });
  const closingChecklistQuery = trpc.dashboard.checklistQuestions.useQuery({ checklistType: "closing" }, { enabled: isAdmin, refetchOnWindowFocus: false });
  const notesQuery = trpc.dashboard.recentNotes.useQuery({ limit: 10 }, { enabled: isAdmin, refetchOnWindowFocus: false });
  const submissionHistoryQuery = trpc.dashboard.submissionHistory.useQuery({ businessDate: selectedDate }, { enabled: isAdmin, refetchOnWindowFocus: false });
  const selectedDayStaffQuery = trpc.timeclock.todayStatus.useQuery(
    { businessDate: selectedDate },
    { enabled: isAdmin && isOverviewRoute, refetchOnWindowFocus: false }
  );
  const payrollHoursQuery = trpc.timeclock.weeklyHours.useQuery(
    { startDate: hoursRangeStart, endDate: hoursRangeEnd },
    { enabled: isAdmin && isTimeBookRoute, refetchOnWindowFocus: false }
  );
  const timeBookQuery = trpc.timeclock.timeBook.useQuery(
    { startDate: hoursRangeStart, endDate: hoursRangeEnd },
    { enabled: isAdmin && isTimeBookRoute, refetchOnWindowFocus: false }
  );

  const saveInventoryMutation = trpc.dashboard.saveInventoryItem.useMutation({
    onSuccess: async () => {
      toast.success("Inventory item saved.");
      setInventoryForm({
        id: undefined,
        department: "Ingredients",
        category: "Base",
        itemName: "",
        unitType: "units",
        packSize: "",
        costPerUnit: "0",
        currentQuantity: "0",
        parLevel: "0",
        reorderQuantity: "0",
        supplier: "",
        supplierContact: "",
        lastCountDate: "",
        notes: "",
      });
      await Promise.all([utils.dashboard.inventoryItems.invalidate(), utils.dashboard.inventoryAlerts.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });

  const saveChecklistMutation = trpc.dashboard.saveChecklistQuestion.useMutation({
    onSuccess: async () => {
      toast.success("Checklist question saved.");
      setChecklistForm({
        id: undefined,
        checklistType: "opening",
        sectionTitle: "Equipment",
        prompt: "",
        detailPrompt: "If no, explain the issue.",
        detailTrigger: "No",
        displayOrder: "1",
      });
      await Promise.all([
        utils.dashboard.checklistQuestions.invalidate({ checklistType: "opening" }),
        utils.dashboard.checklistQuestions.invalidate({ checklistType: "closing" }),
        utils.forms.checklistQuestions.invalidate({ checklistType: "opening" }),
        utils.forms.checklistQuestions.invalidate({ checklistType: "closing" }),
      ]);
    },
    onError: error => toast.error(error.message),
  });

  const removeChecklistMutation = trpc.dashboard.removeChecklistQuestion.useMutation({
    onSuccess: async () => {
      toast.success("Checklist question removed.");
      await Promise.all([
        utils.dashboard.checklistQuestions.invalidate({ checklistType: "opening" }),
        utils.dashboard.checklistQuestions.invalidate({ checklistType: "closing" }),
        utils.forms.checklistQuestions.invalidate({ checklistType: "opening" }),
        utils.forms.checklistQuestions.invalidate({ checklistType: "closing" }),
      ]);
    },
    onError: error => toast.error(error.message),
  });

  const updateSubmissionGelatoMutation = trpc.dashboard.updateSubmissionGelato.useMutation({
    onSuccess: async () => {
      toast.success("Saved submission updated.");
      setEditingSubmissionId(null);
      setEditingSubmissionMode(null);
      setSubmissionGelatoEditorRows([]);
      setSubmissionPhotoEditorRows([]);
      await Promise.all([
        utils.dashboard.submissionHistory.invalidate({ businessDate: selectedDate }),
        utils.dashboard.daily.invalidate({ businessDate: selectedDate }),
        utils.forms.readyMadeGelatoWeights.invalidate({ businessDate: selectedDate }),
      ]);
    },
    onError: error => toast.error(error.message),
  });

  const updateSubmissionFormMutation = trpc.dashboard.updateSubmissionForm.useMutation({
    onSuccess: async () => {
      toast.success("Saved form values updated.");
      setEditingSubmissionFormId(null);
      setSubmissionFormEditorFields([]);
      await Promise.all([
        utils.dashboard.submissionHistory.invalidate({ businessDate: selectedDate }),
        utils.dashboard.daily.invalidate({ businessDate: selectedDate }),
      ]);
    },
    onError: error => toast.error(error.message),
  });

  const saveAttendanceEntryMutation = trpc.timeclock.saveEntry.useMutation({
    onSuccess: async () => {
      toast.success("Attendance entry saved.");
      setAttendanceEditor(null);
      await Promise.all([
        utils.timeclock.timeBook.invalidate({ startDate: hoursRangeStart, endDate: hoursRangeEnd }),
        utils.timeclock.weeklyHours.invalidate({ startDate: hoursRangeStart, endDate: hoursRangeEnd }),
        utils.timeclock.todayStatus.invalidate({ businessDate: selectedDate }),
      ]);
    },
    onError: error => toast.error(error.message),
  });

  const recentNotes = useMemo(
    () =>
      (notesQuery.data ?? []).filter(
        (
          note
        ): note is {
          type: string;
          businessDate: string;
          staffName: string;
          detail: string;
          createdAt: Date;
        } => Boolean(note)
      ),
    [notesQuery.data]
  );

  const submissionHistory = useMemo(() => (submissionHistoryQuery.data ?? []) as SubmissionHistoryEntryRecord[], [submissionHistoryQuery.data]);
  const flavorPhotoPreviewMap = useMemo(() => buildFlavorPhotoPreviewMap(submissionHistory), [submissionHistory]);
  const selectedDayStaffRows = useMemo(() => buildSelectedDayStaffActivityRows(selectedDayStaffQuery.data?.staff ?? []), [selectedDayStaffQuery.data]);
  const payrollDateRange = useMemo(() => buildBusinessDateRange(hoursRangeStart, hoursRangeEnd), [hoursRangeStart, hoursRangeEnd]);
  const payrollSummary = payrollHoursQuery.data;
  const timeBook = timeBookQuery.data;

  function startSubmissionGelatoEdit(entry: SubmissionHistoryEntryRecord) {
    const nextMode = getSubmissionEditMode(entry);
    setEditingSubmissionId(entry.id);
    setEditingSubmissionMode(nextMode);
    setSubmissionGelatoEditorRows(nextMode === "manual" ? createSubmissionGelatoEditorRows(entry) : []);
    setSubmissionPhotoEditorRows(nextMode === "photo" ? createSubmissionPhotoEditorRows(entry) : []);
  }

  function cancelSubmissionGelatoEdit() {
    setEditingSubmissionId(null);
    setEditingSubmissionMode(null);
    setSubmissionGelatoEditorRows([]);
    setSubmissionPhotoEditorRows([]);
  }

  function startSubmissionFormEdit(entry: SubmissionHistoryEntryRecord) {
    setEditingSubmissionFormId(entry.id);
    setSubmissionFormEditorFields(createSubmissionFormEditorFields(entry.payload.form ?? {}));
  }

  function cancelSubmissionFormEdit() {
    setEditingSubmissionFormId(null);
    setSubmissionFormEditorFields([]);
  }

  function updateSubmissionFormEditorField(index: number, value: string) {
    setSubmissionFormEditorFields(current => current.map((field, fieldIndex) => (fieldIndex === index ? { ...field, value } : field)));
  }

  function startAttendanceEdit(input: AttendanceEditorState) {
    setAttendanceEditor(input);
  }

  function cancelAttendanceEdit() {
    setAttendanceEditor(null);
  }

  function updateSubmissionGelatoEditorRow(index: number, field: keyof SubmissionGelatoEditorRow, value: string) {
    setSubmissionGelatoEditorRows(current => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  }

  function updateSubmissionPhotoEditorRow(index: number, updater: (row: SubmissionPhotoEditorRow) => SubmissionPhotoEditorRow) {
    setSubmissionPhotoEditorRows(current => current.map((row, rowIndex) => (rowIndex === index ? updater(row) : row)));
  }

  function addSubmissionGelatoEditorRow() {
    setSubmissionGelatoEditorRows(current => [
      ...current,
      { flavor: "", smallPanCount: "", smallGrossWeightKg: "", largePanCount: "", largeGrossWeightKg: "" },
    ]);
  }

  function removeSubmissionGelatoEditorRow(index: number) {
    setSubmissionGelatoEditorRows(current => {
      const nextRows = current.filter((_, rowIndex) => rowIndex !== index);
      return nextRows.length > 0
        ? nextRows
        : [{ flavor: "", smallPanCount: "", smallGrossWeightKg: "", largePanCount: "", largeGrossWeightKg: "" }];
    });
  }

  async function saveSubmissionGelatoEdits() {
    if (!editingSubmissionId) return;

    if (editingSubmissionMode === "photo") {
      const cleanedPhotos = submissionPhotoEditorRows
        .map(photo => {
          const flavor = photo.flavor.trim();
          const smallPanCount = Math.max(0, Math.trunc(photo.smallPanCount));
          const largePanCount = Math.max(0, Math.trunc(photo.largePanCount));
          const combinedGrossWeightKg = getAnalyzedPhotoCombinedGrossWeightKg({
            combinedGrossWeightKg: photo.combinedGrossWeightKg,
            combinedGrossWeightInput: photo.combinedGrossWeightInput,
          });

          if (!flavor) return { error: "Enter a flavor for every reviewed photo." } as const;
          if (smallPanCount <= 0 && largePanCount <= 0) return { error: "Choose a pan setup for every reviewed photo before saving." } as const;
          if (!Number.isFinite(combinedGrossWeightKg) || combinedGrossWeightKg <= 0) {
            return { error: "Enter a valid total kilogram reading for every reviewed photo before saving." } as const;
          }

          return {
            fileName: photo.fileName,
            imageUrl: photo.imageUrl,
            imageKey: photo.imageKey,
            flavor,
            smallPanCount,
            largePanCount,
            combinedGrossWeightKg,
            confidence: photo.confidence,
            warning: photo.warning,
          };
        });

      const photoError = cleanedPhotos.find(photo => "error" in photo);
      if (photoError) {
        toast.error(photoError.error);
        return;
      }

      const reviewedPhotos = cleanedPhotos.filter((photo): photo is {
        fileName: string;
        imageUrl: string;
        imageKey?: string;
        flavor: string;
        smallPanCount: number;
        largePanCount: number;
        combinedGrossWeightKg: number;
        confidence: "high" | "medium" | "low";
        warning?: string;
      } => !("error" in photo));

      if (reviewedPhotos.length === 0) {
        toast.error("Review at least one photo before saving the submission edit.");
        return;
      }

      await updateSubmissionGelatoMutation.mutateAsync({
        entryId: editingSubmissionId,
        gelatoEntryMode: "photo",
        analyzedPhotos: reviewedPhotos,
        gelatoEntries: reviewedPhotos.map(photo => ({
          flavor: photo.flavor,
          smallPanCount: photo.smallPanCount,
          largePanCount: photo.largePanCount,
          combinedGrossWeightKg: photo.combinedGrossWeightKg,
        })),
      });
      return;
    }

    const gelatoEntries = submissionGelatoEditorRows
      .map(row => {
        const flavor = row.flavor.trim();
        const smallPanCount = Math.max(0, Math.trunc(Number(row.smallPanCount || 0)));
        const largePanCount = Math.max(0, Math.trunc(Number(row.largePanCount || 0)));
        const smallGrossWeightKg = row.smallGrossWeightKg.trim() === "" ? undefined : Number(row.smallGrossWeightKg);
        const largeGrossWeightKg = row.largeGrossWeightKg.trim() === "" ? undefined : Number(row.largeGrossWeightKg);

        if (!flavor) return null;
        if ((smallPanCount <= 0 && largePanCount <= 0) && smallGrossWeightKg == null && largeGrossWeightKg == null) return null;
        if ((smallGrossWeightKg != null && !Number.isFinite(smallGrossWeightKg)) || (largeGrossWeightKg != null && !Number.isFinite(largeGrossWeightKg))) {
          return { error: true } as const;
        }

        return {
          flavor,
          smallPanCount,
          smallGrossWeightKg,
          largePanCount,
          largeGrossWeightKg,
        };
      });

    if (gelatoEntries.some(entry => entry && "error" in entry)) {
      toast.error("Please enter valid kilogram values before saving.");
      return;
    }

    const cleanedEntries = gelatoEntries.filter((entry): entry is {
      flavor: string;
      smallPanCount: number;
      smallGrossWeightKg?: number;
      largePanCount: number;
      largeGrossWeightKg?: number;
    } => entry != null && !("error" in entry));

    if (cleanedEntries.length === 0) {
      toast.error("Add at least one gelato row before saving the submission edit.");
      return;
    }

    await updateSubmissionGelatoMutation.mutateAsync({
      entryId: editingSubmissionId,
      gelatoEntryMode: "manual",
      gelatoEntries: cleanedEntries,
    });
  }

  async function saveSubmissionFormEdits() {
    if (!editingSubmissionFormId) return;
    const currentEntry = submissionHistory.find(entry => entry.id === editingSubmissionFormId);
    if (!currentEntry?.payload.form) return;

    await updateSubmissionFormMutation.mutateAsync({
      entryId: editingSubmissionFormId,
      form: rebuildSubmissionFormFromEditor(currentEntry.payload.form, submissionFormEditorFields),
    });
  }

  async function saveAttendanceEdits() {
    if (!attendanceEditor || !attendanceEditor.clockInTime) {
      toast.error("Enter a valid check-in time before saving.");
      return;
    }

    await saveAttendanceEntryMutation.mutateAsync({
      entryId: attendanceEditor.entryId,
      staffName: attendanceEditor.staffName as "Karol" | "Anhec" | "Jesse" | "Esme",
      businessDate: attendanceEditor.businessDate,
      clockInTime: attendanceEditor.clockInTime,
      clockOutTime: attendanceEditor.clockOutTime || null,
    });
  }

  async function handleShopifyFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const csvText = await file.text();
      const summary = summarizeShopifySalesCsv(csvText);
      setShopifyImportSummary(summary);
      setShopifyImportFileName(file.name);
      setShopifyImportError(null);
      toast.success(`Imported ${summary.totalSoldVolumeOunces.toFixed(1)} Shopify sold oz from ${file.name}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read the Shopify CSV.";
      setShopifyImportSummary(null);
      setShopifyImportFileName(file.name);
      setShopifyImportError(message);
      toast.error(message);
    } finally {
      event.target.value = "";
    }
  }

  const daily = dailyQuery.data;
  const reconciliationSnapshot = buildManagerReconciliationSnapshot(daily);
  const shopifyVarianceSnapshot = useMemo(() => {
    if (!reconciliationSnapshot.gelato || !shopifyImportSummary) return null;
    return buildShopifyVarianceSnapshot(
      reconciliationSnapshot.gelato.distributedVolumeOunces,
      shopifyImportSummary.totalSoldVolumeOunces
    );
  }, [reconciliationSnapshot.gelato, shopifyImportSummary]);
  const flavorRows = useMemo(() => {
    if (!reconciliationSnapshot.gelato) return [];

    const gelatoAwaitingClosing = reconciliationSnapshot.gelato.discrepancyLabel === AWAITING_CLOSING_FORM_LABEL;
    const soldOunceAllocations = allocateEstimatedFlavorSoldOunces(
      reconciliationSnapshot.gelato.flavors.map(item => item.usedVolumeOunces),
      reconciliationSnapshot.gelato.soldVolumeOunces,
      2
    );

    return reconciliationSnapshot.gelato.flavors.map((item, index) => {
      const normalizedFlavor = normalizeFlavorPreviewKey(item.flavor);
      const openingOunces = roundTo(item.opening.totalVolumeOunces, 0);
      const closingOunces = roundTo(item.closing.totalVolumeOunces, 0);
      const openingWeightKg = roundTo(item.opening.combinedGrossWeightKg, 3);
      const closingWeightKg = roundTo(item.closing.combinedGrossWeightKg, 3);
      const distributedOunces = roundTo(item.usedVolumeOunces, 0);
      const soldOunces = soldOunceAllocations[index] ?? 0;
      const differenceOunces = roundTo(distributedOunces - soldOunces, 0);

      return {
        flavor: item.flavor,
        openingWeightKg,
        closingWeightKg,
        openingPhotoPreview: flavorPhotoPreviewMap.get(`opening:${normalizedFlavor}`),
        closingPhotoPreview: flavorPhotoPreviewMap.get(`closing:${normalizedFlavor}`),
        openingOunces,
        closingOunces,
        distributedOunces,
        soldOunces,
        differenceOunces,
        awaitingClosing: gelatoAwaitingClosing,
        status: gelatoAwaitingClosing ? AWAITING_CLOSING_TEXT : classifyDifference(differenceOunces),
      };
    });
  }, [flavorPhotoPreviewMap, reconciliationSnapshot]);

  if (loading || (user && !isAdmin)) {
    return <div className="min-h-screen bg-[#f7f2ea]" />;
  }

  const totalCups = (daily?.cups["4oz"] ?? 0) + (daily?.cups["8oz"] ?? 0) + (daily?.cups.Pint ?? 0) + (daily?.cups.Liter ?? 0);
  const totalForHereCups = (daily?.cupsHere?.["4oz"] ?? 0) + (daily?.cupsHere?.["8oz"] ?? 0) + (daily?.cupsHere?.Pint ?? 0) + (daily?.cupsHere?.Liter ?? 0);
  const totalToGoCups = (daily?.cupsToGo?.["4oz"] ?? 0) + (daily?.cupsToGo?.["8oz"] ?? 0) + (daily?.cupsToGo?.Pint ?? 0) + (daily?.cupsToGo?.Liter ?? 0);
  const totalToGoCupsUsed = reconciliationSnapshot.packaging?.toGoCupUsedCount ?? null;
  const hasZelleSales = (daily?.sales.zelle ?? 0) > 0;
  const hasVenmoSales = (daily?.sales.venmo ?? 0) > 0;
  const trendData = trendQuery.data ?? [];
  const wowData = wowQuery.data ?? [];
  const inventoryAlerts = alertsQuery.data ?? [];
  const inventoryItems = inventoryItemsQuery.data ?? [];
  const recipes = recipesQuery.data ?? [];
  const openingChecklistQuestions = openingChecklistQuery.data ?? [];
  const closingChecklistQuestions = closingChecklistQuery.data ?? [];
  const filteredManagerInventoryItems = inventoryItems
    .filter(item =>
      inventoryDashboardView === "ingredients"
        ? item.department === "Ingredients"
        : inventoryDashboardView === "utensils"
          ? item.department === "Utensils & Cleaning"
          : false
    )
    .sort((a, b) => a.category.localeCompare(b.category) || a.itemName.localeCompare(b.itemName));

  const heroTitle = isInventoryWorkspaceRoute
    ? "A dedicated space for inventory setup, alerts, and manager-maintained counts."
    : isTimeBookRoute
      ? "Attendance logs and payroll hours live in their own manager workspace."
      : isCookbookRoute
        ? "Recipe and ingredient details live here instead of crowding the daily dashboard."
        : isFormsRoute
          ? "Manage opening and closing checklist questions in their own workspace."
          : isHistoryRoute
            ? "Review every submitted form, photo, and note for the selected business date."
            : "A quick daily glance at sales, form completion, and reconciliation.";

  const heroCopy = isInventoryWorkspaceRoute
    ? "Maintain ingredient and utensil records, review reorder pressure, and keep setup work separate from the manager's at-a-glance dashboard."
    : isTimeBookRoute
      ? "Use Time Book to audit every punch, confirm each day's hours, and review payroll totals across a Sunday-through-Saturday work week or any custom date range you choose."
      : isCookbookRoute
        ? "Use the cookbook to review flavor formulas, ingredient costs, and yield placeholders without putting recipe details on the main dashboard."
        : isFormsRoute
          ? "Adjust checklist prompts in one place so the staff forms stay current without mixing setup work into the manager overview."
          : isHistoryRoute
            ? "Use this workspace to audit exactly what staff submitted, including gelato analysis photos, editable values, inventory updates, and notes, all grouped under the selected Pacific business date."
            : "Use this page to answer the core questions fast: what sold, whether opening and closing were completed, how much volume started and ended the day, and where the differences landed.";

  const latestSubmissionFullName = submissionHistory[0]?.staffName ?? "—";
  const latestSubmissionDisplayName = getCompactSnapshotName(latestSubmissionFullName);

  const snapshotCards = isInventoryWorkspaceRoute
    ? [
        { label: "Ingredients tracked", value: inventoryItems.filter(item => item.department === "Ingredients").length.toString(), helper: "Manager-maintained ingredient records." },
        { label: "Utensils & cleaning", value: inventoryItems.filter(item => item.department === "Utensils & Cleaning").length.toString(), helper: "Tracked non-gelato inventory items." },
        { label: "Reorder now", value: inventoryAlerts.length.toString(), helper: "Items at or below par." },
      ]
      : isTimeBookRoute
        ? [
            { label: "Payroll period", value: `${hoursRangeStart} → ${hoursRangeEnd}`, helper: "Selected attendance window." },
            { label: "Total hours", value: `${(timeBook?.totalHours ?? 0).toFixed(2)} hrs`, helper: "All staff hours in the selected range." },
            { label: "Shifts logged", value: (timeBook?.totalShiftCount ?? 0).toString(), helper: "Clock-in records captured in the selected range." },
            { label: "Open shifts", value: (timeBook?.openShiftCount ?? 0).toString(), helper: "Punches still waiting for a sign-out." },
            { label: "Staff with hours", value: (timeBook?.staff.filter(staffMember => staffMember.totalShiftCount > 0).length ?? 0).toString(), helper: "Team members with activity in the selected range." },
          ]
      : isCookbookRoute
      ? [
          { label: "Recipes loaded", value: recipes.length.toString(), helper: "Recipe workbook rows currently available." },
          { label: "Pending yield", value: recipes.filter(recipe => recipe.batchYieldOunces <= 0).length.toString(), helper: "Recipes still missing batch yield." },
          { label: "Missing costs", value: recipes.reduce((sum, recipe) => sum + recipe.missingCostCount, 0).toString(), helper: "Ingredient rows still waiting on cost data." },
        ]

      : isFormsRoute
        ? [
            { label: "Opening questions", value: openingChecklistQuestions.length.toString(), helper: "Current prompts shown on the opening checklist." },
            { label: "Closing questions", value: closingChecklistQuestions.length.toString(), helper: "Current prompts shown on the closing checklist." },
            { label: "Selected day", value: selectedDate, helper: "Reference date for manager review." },
          ]
        : isHistoryRoute
          ? [
              { label: "Submissions", value: submissionHistory.length.toString(), helper: "Opening, closing, and inventory history records available for review." },
              { label: "Photo uploads", value: submissionHistory.reduce((sum, entry) => sum + (entry.payload.analyzedPhotos?.length ?? 0), 0).toString(), helper: "Submitted gelato evidence saved with those records." },
              { label: "Latest submission", value: latestSubmissionDisplayName, helper: "Most recent staff member recorded on the selected date.", valueTitle: latestSubmissionFullName },
            ]
          : [
              { label: "Total sales", value: formatCurrency(daily?.sales.total ?? 0), helper: "What sold today." },
              { label: "Cash sales", value: formatCurrency(daily?.sales.cash ?? 0), helper: "Cash collected for the selected day." },
              { label: "Card sales", value: formatCurrency(daily?.sales.card ?? 0), helper: "Card collected for the selected day." },
              ...(hasVenmoSales ? [{ label: "Venmo sales", value: formatCurrency(daily?.sales.venmo ?? 0), helper: "Only shown when Venmo sales were reported." }] : []),
              ...(hasZelleSales ? [{ label: "Zelle sales", value: formatCurrency(daily?.sales.zelle ?? 0), helper: "Only shown when Zelle sales were reported." }] : []),
              { label: "Total ounces sold", value: formatWholeOunces(reconciliationSnapshot.gelato?.soldVolumeOunces ?? daily?.soldVolumeOunces), helper: "Cup sales converted into sold gelato ounces." },
              { label: "Total ounces distributed", value: formatWholeOunces(reconciliationSnapshot.gelato?.distributedVolumeOunces), helper: "Morning gelato ounces minus closing gelato ounces." },
              { label: "For-here cups sold", value: formatCount(totalForHereCups), helper: "All dine-in cups sold across sizes." },
              { label: "To-go cups sold", value: formatCount(totalToGoCups), helper: "All to-go cups sold across sizes." },
              { label: "Total to-go cups used", value: formatCount(totalToGoCupsUsed), helper: "Morning to-go cup count minus closing to-go cup count." },
            ];

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-[1440px] space-y-8">
        <SurfaceCard className="overflow-hidden p-0">
          <div className="grid gap-0">
            <div className="border-b border-[#e4dccf] p-8 lg:p-10">
              <p className="text-xs uppercase tracking-[0.28em] text-[#7f857d]">
                  {isOverviewRoute
                    ? "Owner / Manager dashboard"
                    : isInventoryWorkspaceRoute
                      ? "Owner / Manager inventory workspace"
                      : isTimeBookRoute
                        ? "Owner / Manager time book"
                        : isCookbookRoute
                          ? "Owner / Manager cookbook"
                          : isFormsRoute
                            ? "Owner / Manager form setup"
                            : "Owner / Manager submission history"}


              </p>
              <h1 className="mt-4 font-serif text-4xl tracking-tight text-[#1f2b27] md:text-5xl">{heroTitle}</h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-[#65716b]">{heroCopy}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                {isTimeBookRoute ? (
                  <div className="grid flex-1 gap-3 md:grid-cols-2 xl:max-w-[560px]">
                    <div className="relative">
                      <CalendarRange className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7d847d]" />
                      <input
                        type="date"
                        value={hoursRangeStart}
                        max={hoursRangeEnd}
                        onChange={event => setHoursRangeStart(event.target.value > hoursRangeEnd ? hoursRangeEnd : event.target.value)}
                        className="h-12 w-full rounded-full border border-[#ddd4c7] bg-[#fcfaf6] pl-11 pr-4 text-sm text-[#24332f] shadow-sm outline-none transition focus:border-[#52665f] focus:ring-4 focus:ring-[#52665f]/10"
                      />
                    </div>
                    <div className="relative">
                      <CalendarRange className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7d847d]" />
                      <input
                        type="date"
                        value={hoursRangeEnd}
                        min={hoursRangeStart}
                        max={maxBusinessDate}
                        onChange={event => setHoursRangeEnd(event.target.value > maxBusinessDate ? maxBusinessDate : event.target.value)}
                        className="h-12 w-full rounded-full border border-[#ddd4c7] bg-[#fcfaf6] pl-11 pr-4 text-sm text-[#24332f] shadow-sm outline-none transition focus:border-[#52665f] focus:ring-4 focus:ring-[#52665f]/10"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="relative max-w-xs flex-1">
                    <CalendarRange className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7d847d]" />
                    <input
                      type="date"
                      value={selectedDate}
                      max={maxBusinessDate}
                      onChange={event => setSelectedDate(event.target.value > maxBusinessDate ? maxBusinessDate : event.target.value)}
                      className="h-12 w-full rounded-full border border-[#ddd4c7] bg-[#fcfaf6] pl-11 pr-4 text-sm text-[#24332f] shadow-sm outline-none transition focus:border-[#52665f] focus:ring-4 focus:ring-[#52665f]/10"
                    />
                  </div>
                )}
                <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#ded5c8] bg-white/80 px-4 py-3 text-sm text-[#66706a] shadow-sm md:whitespace-nowrap">
                  <CalendarRange className="h-4 w-4 shrink-0 text-[#52665f]" />
                  <span className="min-w-0 break-words md:overflow-hidden md:text-ellipsis">
                    {isTimeBookRoute
                      ? `Payroll period ${hoursRangeStart} through ${hoursRangeEnd}.`
                      : isOverviewRoute
                        ? `Quick day view active for ${selectedDate}.`
                        : `Manager workspace filtered by ${selectedDate}.`}
                  </span>
                </div>
                <div className="inline-flex w-max max-w-full shrink-0 flex-col rounded-[1.75rem] border border-[#ded5c8] bg-white/80 px-6 py-3 text-sm text-[#4f5b55] shadow-sm">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-[#8b9088]">Live Pacific time</p>
                  <p className="mt-1 whitespace-nowrap font-medium text-[#24332f]">{currentPacificDateTimeLabel}</p>
                </div>
              </div>
            </div>
            <div className="p-8 lg:p-10">
              <div className="rounded-[1.75rem] border border-[#e5ddd0] bg-[#f9f4ec] p-6">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#8b9088] md:text-xs md:tracking-[0.24em]">
                  {isOverviewRoute ? `Daily snapshot for ${selectedDate}` : isTimeBookRoute ? "Time Book summary" : "Workspace snapshot"}
                </p>
                {dailyQuery.isLoading && isOverviewRoute ? (
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div key={index} className="h-28 animate-pulse rounded-2xl bg-white/75" />
                    ))}
                  </div>
                ) : dailyQuery.error && isOverviewRoute ? (
                  <div className="mt-5">
                    <StatePanel title="Unable to load the selected-day snapshot" description="The daily report data could not be loaded right now. Try another date or refresh shortly." tone="error" />
                  </div>
                ) : (
                  <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                    {snapshotCards.map(card => (
                      <div key={card.label} className="min-w-0 rounded-2xl bg-white/80 px-5 py-4 shadow-sm md:px-6 md:py-5">
                        <p className="text-[0.95rem] leading-snug text-[#6f776f] md:text-base" title={card.label}>{card.label}</p>
                        <p className={getSnapshotValueClassName(card.value)} title={"valueTitle" in card ? card.valueTitle : card.value}>{card.value}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </SurfaceCard>

        {isOverviewRoute ? (
          <>
            <div className="grid gap-8 xl:grid-cols-[0.9fr_1.1fr]">
              <SurfaceCard>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-[#8a9089]">Daily status</p>
                    <h2 className="mt-3 font-serif text-3xl tracking-tight text-[#1f2b27]">Forms and service completion</h2>
                  </div>
                  <div className="rounded-full bg-[#f1e8da] px-4 py-2 text-sm text-[#566863]">{daily?.reportCount ?? 0} report entries</div>
                </div>
                <div className="mt-6">
                  {dailyQuery.isLoading ? (
                    <StatePanel title="Loading the daily report" description="Pulling sales totals, payment breakdowns, cup counts, and checklist completion for the selected day." />
                  ) : dailyQuery.error ? (
                    <StatePanel title="Unable to load the daily report" description="The selected day could not be loaded right now. Please try again in a moment." tone="error" />
                  ) : !daily ? (
                    <StatePanel title="No report data found for this day" description="Once employees submit their daily forms, the searchable report will appear here automatically." tone="warning" />
                  ) : (
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {[
                          { label: "4oz", value: daily.cups["4oz"] ?? 0 },
                          { label: "8oz", value: daily.cups["8oz"] ?? 0 },
                          { label: "Pint", value: daily.cups.Pint ?? 0 },
                          { label: "Liter", value: daily.cups.Liter ?? 0 },
                        ].map(item => (
                          <div key={item.label} className="rounded-2xl border border-[#e5ddd0] bg-[#fbf7f0] p-5 shadow-sm">
                            <div className="flex items-center justify-between">
                              <p className="text-xs uppercase tracking-[0.22em] text-[#8b9088]">{item.label}</p>
                              <CupSoda className="h-4 w-4 text-[#52665f]" />
                            </div>
                            <p className="mt-4 font-serif text-3xl text-[#1f2b27]">{item.value}</p>
                          </div>
                        ))}
                      </div>

                      <div className="overflow-hidden rounded-[1.5rem] border border-[#e4dccf] bg-[#fcfaf6]">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-[#f4ede2] text-[#60706b]">
                            <tr>
                              <th className="px-4 py-3 font-medium">Metric</th>
                              <th className="px-4 py-3 font-medium">Value</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#ece4d8] text-[#24332f]">
                            <tr>
                              <td className="px-4 py-3">Opening submissions</td>
                              <td className="px-4 py-3">{daily.openingSubmissionCount}</td>
                            </tr>
                            <tr>
                              <td className="px-4 py-3">Closing submissions</td>
                              <td className="px-4 py-3">{daily.closingSubmissionCount}</td>
                            </tr>
                            <tr>
                              <td className="px-4 py-3">Latest report staff</td>
                              <td className="px-4 py-3">{daily.latestReportStaff ?? "—"}</td>
                            </tr>
                            <tr>
                              <td className="px-4 py-3">Checklist completion</td>
                              <td className="px-4 py-3">Opening {formatPercent(daily.checklistCompletion.opening)} / Closing {formatPercent(daily.checklistCompletion.closing)}</td>
                            </tr>
                            <tr>
                              <td className="px-4 py-3">Opening gelato volume ounces</td>
                              <td className="px-4 py-3">{formatCount(daily.gelato.openingVolumeOunces)}</td>
                            </tr>
                            <tr>
                              <td className="px-4 py-3">Closing gelato volume ounces</td>
                              <td className="px-4 py-3">{formatCount(daily.gelato.closingVolumeOunces)}</td>
                            </tr>
                            <tr>
                              <td className="px-4 py-3">Measured distributed volume ounces</td>
                              <td className="px-4 py-3">{formatCount(daily.gelato.actualDistributedVolumeOunces)}</td>
                            </tr>
                            <tr>
                              <td className="px-4 py-3">Sold volume ounces</td>
                              <td className="px-4 py-3">{formatCount(daily.gelato.soldVolumeOunces)}</td>
                            </tr>
                            <tr>
                              <td className="px-4 py-3">Gelato discrepancy</td>
                              <td className="px-4 py-3">{formatSignedValue(daily.gelato.varianceVolumeOunces)} oz · {daily.gelato.discrepancyLabel}</td>
                            </tr>
                            <tr>
                              <td className="px-4 py-3">Packaging discrepancy</td>
                              <td className="px-4 py-3">{daily.packaging.varianceCount == null ? "Awaiting counts" : `${formatSignedValue(daily.packaging.varianceCount)} units`} · {daily.packaging.discrepancyLabel}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </SurfaceCard>

              <SurfaceCard>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-[#8a9089]">Staff activity</p>
                    <h2 className="mt-3 font-serif text-3xl tracking-tight text-[#1f2b27]">Who worked on {selectedDate}</h2>
                    <p className="mt-3 text-sm leading-7 text-[#6b6258]">This section only shows the selected day’s staffing activity, including first check-in, final check-out, and total hours worked.</p>
                  </div>
                  <div className="rounded-full bg-[#f1e8da] px-4 py-2 text-sm text-[#566863]">{selectedDayStaffRows.length} staff worked</div>
                </div>
                <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-[#e4dccf] bg-[#fcfaf6]">
                  {selectedDayStaffQuery.isLoading ? (
                    <div className="p-5">
                      <StatePanel title="Loading selected-day staffing" description="Pulling who worked, their punch times, and total hours for the chosen business date." />
                    </div>
                  ) : selectedDayStaffQuery.error ? (
                    <div className="p-5">
                      <StatePanel title="Unable to load selected-day staffing" description="The staff activity summary could not be loaded right now." tone="error" />
                    </div>
                  ) : selectedDayStaffRows.length === 0 ? (
                    <div className="p-5">
                      <StatePanel title="No staff activity recorded for this day" description="When staff clock in and out on the selected business date, their activity will appear here automatically." tone="warning" />
                    </div>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead className="bg-[#f4ede2] text-[#60706b]">
                        <tr>
                          <th className="px-4 py-3 font-medium">Staff</th>
                          <th className="px-4 py-3 font-medium">Checked in</th>
                          <th className="px-4 py-3 font-medium">Checked out</th>
                          <th className="px-4 py-3 font-medium">Hours worked</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#ece4d8] text-[#24332f]">
                        {selectedDayStaffRows.map(staffMember => (
                          <tr key={staffMember.staffName}>
                            <td className="px-4 py-3 font-medium">
                              <div>{staffMember.staffName}</div>
                              <div className="text-xs text-[#7d756b]">{staffMember.shiftCountLabel}</div>
                            </td>
                            <td className="px-4 py-3">{staffMember.checkInLabel}</td>
                            <td className="px-4 py-3">{staffMember.checkOutLabel}</td>
                            <td className="px-4 py-3 font-medium">{staffMember.totalHoursLabel}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </SurfaceCard>
            </div>

            <SurfaceCard className="relative z-20 overflow-visible">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-[#8a9089]">Flavor reconciliation</p>
                <h2 className="mt-3 font-serif text-3xl tracking-tight text-[#1f2b27]">Flavors</h2>
              </div>
              <div className="mt-6 rounded-[1.5rem] border border-[#e4dccf] bg-[#fcfaf6]">
                {dailyQuery.isLoading ? (
                  <div className="p-5">
                    <StatePanel title="Loading flavor reconciliation" description="Building the opening, closing, distributed, sold, and difference view for each flavor." />
                  </div>
                ) : dailyQuery.error || !reconciliationSnapshot.gelato ? (
                  <div className="p-5">
                    <StatePanel title="Unable to load flavor reconciliation" description="The selected day could not be reconciled right now." tone="error" />
                  </div>
                ) : flavorRows.length === 0 ? (
                  <div className="p-5">
                    <StatePanel title="No gelato measurements found" description="Once opening and closing gelato counts are submitted, each flavor will appear here automatically." tone="warning" />
                  </div>
                ) : (
                  <table className="w-full table-fixed text-left text-sm">
                    <thead className="bg-[#f4ede2] text-[#60706b]">
                      <tr>
                        <th className="w-[17%] px-4 py-3 font-medium">Flavor</th>
                        <th className="w-[12%] px-4 py-3 font-medium">Starting weight</th>
                        <th className="w-[12%] px-4 py-3 font-medium">Ending weight</th>
                        <th className="w-[10%] px-4 py-3 font-medium">Starting oz</th>
                        <th className="w-[10%] px-4 py-3 font-medium">Ending oz</th>
                        <th className="w-[10%] px-4 py-3 font-medium">Distributed oz</th>
                        <th className="w-[8%] px-4 py-3 font-medium">Sold oz</th>
                        <th className="w-[13%] px-4 py-3 font-medium">Difference</th>
                        <th className="w-[8%] px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#ece4d8] text-[#24332f]">
                      {flavorRows.map(item => (
                        <tr key={item.flavor}>
                          <td className="px-4 py-3 align-top break-words font-medium">{item.flavor}</td>
                          <td className="px-4 py-3 align-top break-words">{renderFlavorWeightCell(`${item.openingWeightKg.toFixed(3)} kg`, item.openingPhotoPreview)}</td>
                          <td className="px-4 py-3 align-top break-words">{item.awaitingClosing ? AWAITING_CLOSING_TEXT : renderFlavorWeightCell(`${item.closingWeightKg.toFixed(3)} kg`, item.closingPhotoPreview)}</td>
                          <td className="px-4 py-3 align-top break-words">{item.openingOunces.toFixed(2)}</td>
                          <td className="px-4 py-3 align-top break-words">{item.awaitingClosing ? AWAITING_CLOSING_TEXT : item.closingOunces.toFixed(2)}</td>
                          <td className="px-4 py-3 align-top break-words">{item.awaitingClosing ? AWAITING_CLOSING_TEXT : item.distributedOunces.toFixed(2)}</td>
                          <td className="px-4 py-3 align-top break-words">{item.soldOunces.toFixed(2)}</td>
                          <td className="px-4 py-3 align-top break-words">{item.awaitingClosing ? AWAITING_CLOSING_TEXT : formatSignedValue(item.differenceOunces)}</td>
                          <td className="px-4 py-3 align-top">
                            <span className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ${
                              item.status === "Aligned"
                                ? "bg-[#e8f0ec] text-[#4d655d]"
                                : item.status === "Review"
                                  ? "bg-[#f5e7d3] text-[#805e2f]"
                                  : item.status === "Over"
                                    ? "bg-[#efe4dc] text-[#8b5a47]"
                                    : "bg-[#f1ebe2] text-[#7a6553]"
                            }`}>
                              {item.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </SurfaceCard>

            <SurfaceCard>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-[#8a9089]">Packaging reconciliation</p>
                  <h2 className="mt-3 font-serif text-3xl tracking-tight text-[#1f2b27]">Opening units, closing units, distributed units, sold units, and difference</h2>
                </div>
                <div className="rounded-full bg-[#f1e8da] px-4 py-2 text-sm text-[#566863]">Goal: 0.00 units difference</div>
              </div>
              <div className="mt-6 overflow-x-auto rounded-[1.5rem] border border-[#e4dccf] bg-[#fcfaf6]">
                {dailyQuery.isLoading ? (
                  <div className="p-5">
                    <StatePanel title="Loading packaging reconciliation" description="Reviewing cups, lids, and spoons against opening and closing counts." />
                  </div>
                ) : dailyQuery.error || !reconciliationSnapshot.packaging ? (
                  <div className="p-5">
                    <StatePanel title="Unable to load packaging reconciliation" description="The packaging comparison is temporarily unavailable." tone="error" />
                  </div>
                ) : (
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-[#f4ede2] text-[#60706b]">
                      <tr>
                        <th className="px-4 py-3 font-medium">Item</th>
                        <th className="px-4 py-3 font-medium">Starting</th>
                        <th className="px-4 py-3 font-medium">Ending</th>
                        <th className="px-4 py-3 font-medium">Distributed</th>
                        <th className="px-4 py-3 font-medium">Sold</th>
                        <th className="px-4 py-3 font-medium">Difference</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#ece4d8] text-[#24332f]">
                      {reconciliationSnapshot.packaging.items.map(item => (
                        <tr key={item.key}>
                          <td className="px-4 py-3 font-medium">{item.label}</td>
                          <td className="px-4 py-3">{item.openingQuantity.toFixed(2)}</td>
                          <td className="px-4 py-3">{item.closingQuantity == null ? (item.discrepancyLabel === AWAITING_CLOSING_FORM_LABEL ? AWAITING_CLOSING_TEXT : "Awaiting count") : item.closingQuantity.toFixed(2)}</td>
                          <td className="px-4 py-3">{item.actualUsed == null ? (item.discrepancyLabel === AWAITING_CLOSING_FORM_LABEL ? AWAITING_CLOSING_TEXT : "Awaiting count") : item.actualUsed.toFixed(2)}</td>
                          <td className="px-4 py-3">{item.expectedUsed.toFixed(2)}</td>
                          <td className="px-4 py-3">{item.variance == null ? (item.discrepancyLabel === AWAITING_CLOSING_FORM_LABEL ? AWAITING_CLOSING_TEXT : "Awaiting count") : formatSignedValue(item.variance)}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ${
                              item.discrepancyLabel === "Aligned"
                                ? "bg-[#e8f0ec] text-[#4d655d]"
                                : item.discrepancyLabel.includes("minor") || item.discrepancyLabel.includes("Minor")
                                  ? "bg-[#f5e7d3] text-[#805e2f]"
                                  : "bg-[#efe4dc] text-[#8b5a47]"
                            }`}>
                              {item.discrepancyLabel}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </SurfaceCard>
          </>
        ) : null}

        {isTimeBookRoute ? (
          <SurfaceCard>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-[#8a9089]">Punch logs</p>
                <h2 className="mt-3 font-serif text-3xl tracking-tight text-[#1f2b27]">Manager-corrected sign-in, sign-out, and hours worked</h2>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-[#66706a]">Review the selected payroll range, then edit a missed punch or add a manual shift directly inside each staff member’s daily log.</p>
              </div>
              <div className="rounded-[1.5rem] border border-[#e3d8ca] bg-[#fbf7f0] px-4 py-3 text-sm text-[#68716c]">
                {timeBookQuery.isLoading ? "Loading punch logs…" : `${timeBook?.dailyTotals.length ?? 0} day records in range.`}
              </div>
            </div>
            <div className="mt-6 grid gap-5 xl:grid-cols-2">
              {timeBookQuery.isLoading ? (
                Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-[1.6rem] bg-[#f4ede2]" />)
              ) : timeBookQuery.error ? (
                <div className="xl:col-span-2">
                  <StatePanel title="Unable to load punch logs" description="The detailed attendance log is temporarily unavailable." tone="error" />
                </div>
              ) : !timeBook ? (
                <div className="xl:col-span-2">
                  <StatePanel title="No attendance summary available" description="Select a date range or wait for staff punches to begin appearing here." tone="warning" />
                </div>
              ) : (
                timeBook.staff.map(staffMember => (
                  <article key={staffMember.staffName} className="rounded-[1.6rem] border border-[#e4dccf] bg-[#fcfaf6] p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-[#8a9089]">{staffMember.staffName}</p>
                        <h3 className="mt-2 font-serif text-3xl text-[#1f2b27]">{staffMember.totalHours.toFixed(2)} hrs</h3>
                        <p className="mt-2 text-sm text-[#66706a]">{staffMember.totalShiftCount} shift{staffMember.totalShiftCount === 1 ? "" : "s"} recorded · {staffMember.openShiftCount} open</p>
                      </div>
                    </div>
                    <div className="mt-5 space-y-4">
                      {staffMember.dailyLogs.length === 0 ? (
                        <StatePanel title="No punches in this range" description="This staff member has no clock-in records for the selected period." tone="warning" />
                      ) : (
                        staffMember.dailyLogs.map(day => {
                          const isAddingManualShift = attendanceEditor?.entryId == null && attendanceEditor?.staffName === staffMember.staffName && attendanceEditor?.businessDate === day.businessDate;
                          return (
                            <div key={`${staffMember.staffName}-${day.businessDate}`} className="rounded-[1.35rem] border border-[#e4dccf] bg-white/90 p-4">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <p className="text-xs uppercase tracking-[0.2em] text-[#8a9089]">{day.businessDate}</p>
                                  <p className="mt-1 text-sm text-[#66706a]">{day.shiftCount} shift{day.shiftCount === 1 ? "" : "s"} · {day.openShiftCount} open</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-3">
                                  <div className="rounded-full bg-[#f1e8da] px-3 py-2 text-sm font-medium text-[#43554f]">{day.totalHours.toFixed(2)} hrs</div>
                                  <button
                                    type="button"
                                    onClick={() => startAttendanceEdit({ entryId: undefined, staffName: staffMember.staffName, businessDate: day.businessDate, clockInTime: "09:00", clockOutTime: "17:00" })}
                                    className="rounded-full border border-[#d7cec0] bg-white/90 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[#31423d] shadow-sm transition hover:bg-white"
                                  >
                                    Add manual shift
                                  </button>
                                </div>
                              </div>
                              <div className="mt-4 overflow-hidden rounded-[1.1rem] border border-[#ebe2d6] bg-[#fbf7f0]">
                                <table className="w-full text-left text-sm">
                                  <thead className="bg-[#f4ede2] text-[#60706b]">
                                    <tr>
                                      <th className="px-4 py-3 font-medium">Sign in</th>
                                      <th className="px-4 py-3 font-medium">Sign out</th>
                                      <th className="px-4 py-3 font-medium">Hours</th>
                                      <th className="px-4 py-3 font-medium">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-[#ece4d8] text-[#24332f]">
                                    {day.entries.map(entry => {
                                      const isEditingEntry = attendanceEditor?.entryId === entry.id;
                                      return (
                                        <Fragment key={entry.id}>
                                          <tr>
                                            <td className="px-4 py-3">{formatTimeOnly(entry.clockInAt)}</td>
                                            <td className="px-4 py-3">{formatTimeOnly(entry.clockOutAt)}</td>
                                            <td className="px-4 py-3">{entry.hoursWorked.toFixed(2)}</td>
                                            <td className="px-4 py-3">
                                              <button
                                                type="button"
                                                onClick={() => startAttendanceEdit({ entryId: entry.id, staffName: staffMember.staffName, businessDate: day.businessDate, clockInTime: buildTimeInputValue(entry.clockInAt), clockOutTime: buildTimeInputValue(entry.clockOutAt) })}
                                                className="rounded-full border border-[#d7cec0] bg-white/90 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[#31423d] shadow-sm transition hover:bg-white"
                                              >
                                                Edit punch
                                              </button>
                                            </td>
                                          </tr>
                                          {isEditingEntry ? (
                                            <tr className="bg-white/80">
                                              <td className="px-4 py-3">
                                                <input className={`${inventoryFieldClassName()} h-11 w-full`} type="time" value={attendanceEditor.clockInTime} onChange={event => setAttendanceEditor(current => current ? { ...current, clockInTime: event.target.value } : current)} />
                                              </td>
                                              <td className="px-4 py-3">
                                                <input className={`${inventoryFieldClassName()} h-11 w-full`} type="time" value={attendanceEditor.clockOutTime} onChange={event => setAttendanceEditor(current => current ? { ...current, clockOutTime: event.target.value } : current)} />
                                              </td>
                                              <td className="px-4 py-3 text-xs leading-6 text-[#66706a]">Leave sign-out blank only when the shift should stay open.</td>
                                              <td className="px-4 py-3">
                                                <div className="flex flex-col gap-2 sm:flex-row">
                                                  <button type="button" onClick={saveAttendanceEdits} disabled={saveAttendanceEntryMutation.isPending} className="rounded-full bg-[#24332f] px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-white transition hover:bg-[#1d2925] disabled:cursor-not-allowed disabled:opacity-60">Save</button>
                                                  <button type="button" onClick={cancelAttendanceEdit} className="rounded-full border border-[#d7cec0] bg-white/90 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[#31423d] shadow-sm transition hover:bg-white">Cancel</button>
                                                </div>
                                              </td>
                                            </tr>
                                          ) : null}
                                        </Fragment>
                                      );
                                    })}
                                    {isAddingManualShift ? (
                                      <tr className="bg-white/80">
                                        <td className="px-4 py-3"><input className={`${inventoryFieldClassName()} h-11 w-full`} type="time" value={attendanceEditor.clockInTime} onChange={event => setAttendanceEditor(current => current ? { ...current, clockInTime: event.target.value } : current)} /></td>
                                        <td className="px-4 py-3"><input className={`${inventoryFieldClassName()} h-11 w-full`} type="time" value={attendanceEditor.clockOutTime} onChange={event => setAttendanceEditor(current => current ? { ...current, clockOutTime: event.target.value } : current)} /></td>
                                        <td className="px-4 py-3 text-xs leading-6 text-[#66706a]">Create a manual shift for this business date when both punches were missed.</td>
                                        <td className="px-4 py-3">
                                          <div className="flex flex-col gap-2 sm:flex-row">
                                            <button type="button" onClick={saveAttendanceEdits} disabled={saveAttendanceEntryMutation.isPending} className="rounded-full bg-[#24332f] px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-white transition hover:bg-[#1d2925] disabled:cursor-not-allowed disabled:opacity-60">Save</button>
                                            <button type="button" onClick={cancelAttendanceEdit} className="rounded-full border border-[#d7cec0] bg-white/90 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[#31423d] shadow-sm transition hover:bg-white">Cancel</button>
                                          </div>
                                        </td>
                                      </tr>
                                    ) : null}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          </SurfaceCard>
        ) : null}

        {isInventoryWorkspaceRoute ? (
          <SurfaceCard>
            <p className="text-xs uppercase tracking-[0.24em] text-[#8a9089]">Inventory setup and alerts</p>
            <h2 className="mt-3 font-serif text-3xl tracking-tight text-[#1f2b27]">Manager-maintained inventory</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {[
                { label: "Ingredients tracked", count: inventoryItems.filter(item => item.department === "Ingredients").length },
                { label: "Utensils & cleaning tracked", count: inventoryItems.filter(item => item.department === "Utensils & Cleaning").length },
                { label: "Need reorder now", count: inventoryAlerts.length },
              ].map(item => (
                <div key={item.label} className="rounded-2xl border border-[#e5ddd0] bg-[#fbf7f0] p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.22em] text-[#8b9088]">{item.label}</p>
                  <p className="mt-3 font-serif text-3xl text-[#1f2b27]">{item.count}</p>
                </div>
              ))}
            </div>

            <form
              className="mt-6 grid gap-4 rounded-[1.5rem] border border-[#e4dccf] bg-[#fcfaf6] p-5"
              onSubmit={event => {
                event.preventDefault();
                saveInventoryMutation.mutate({
                  id: inventoryForm.id,
                  department: inventoryForm.department,
                  category: inventoryForm.category,
                  itemName: inventoryForm.itemName,
                  unitType: inventoryForm.unitType,
                  packSize: inventoryForm.packSize,
                  costPerUnit: Number(inventoryForm.costPerUnit || 0),
                  currentQuantity: Number(inventoryForm.currentQuantity || 0),
                  parLevel: Number(inventoryForm.parLevel || 0),
                  reorderQuantity: Number(inventoryForm.reorderQuantity || 0),
                  supplier: inventoryForm.supplier,
                  supplierContact: inventoryForm.supplierContact,
                  lastCountDate: inventoryForm.lastCountDate,
                  notes: inventoryForm.notes,
                });
              }}
            >
              <div className="flex items-center gap-3 text-[#52665f]">
                <PackagePlus className="h-5 w-5" />
                <p className="text-sm font-medium uppercase tracking-[0.22em]">Add or set up an inventory item</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <select className={inventoryFieldClassName()} value={inventoryForm.department} onChange={event => setInventoryForm(current => ({ ...current, department: event.target.value, category: event.target.value === "Ingredients" ? "Base" : "Utensil" }))}>
                  <option value="Ingredients">Ingredients</option>
                  <option value="Utensils & Cleaning">Utensils & Cleaning</option>
                </select>
                <input className={inventoryFieldClassName()} placeholder="Category" value={inventoryForm.category} onChange={event => setInventoryForm(current => ({ ...current, category: event.target.value }))} />
                <input className={inventoryFieldClassName()} placeholder="Item name" value={inventoryForm.itemName} onChange={event => setInventoryForm(current => ({ ...current, itemName: event.target.value }))} />
                <input className={inventoryFieldClassName()} placeholder="Unit type" value={inventoryForm.unitType} onChange={event => setInventoryForm(current => ({ ...current, unitType: event.target.value }))} />
                <input className={inventoryFieldClassName()} placeholder="Pack size" value={inventoryForm.packSize} onChange={event => setInventoryForm(current => ({ ...current, packSize: event.target.value }))} />
                <input className={inventoryFieldClassName()} type="number" min="0" step="0.01" placeholder="Cost per unit" value={inventoryForm.costPerUnit} onChange={event => setInventoryForm(current => ({ ...current, costPerUnit: event.target.value }))} />
                <input className={inventoryFieldClassName()} type="number" min="0" step="0.01" placeholder="Current inventory" value={inventoryForm.currentQuantity} onChange={event => setInventoryForm(current => ({ ...current, currentQuantity: event.target.value }))} />
                <input className={inventoryFieldClassName()} type="number" min="0" step="0.01" placeholder="Par level" value={inventoryForm.parLevel} onChange={event => setInventoryForm(current => ({ ...current, parLevel: event.target.value }))} />
                <input className={inventoryFieldClassName()} type="number" min="0" step="0.01" placeholder="Reorder quantity" value={inventoryForm.reorderQuantity} onChange={event => setInventoryForm(current => ({ ...current, reorderQuantity: event.target.value }))} />
                <input className={inventoryFieldClassName()} placeholder="Supplier" value={inventoryForm.supplier} onChange={event => setInventoryForm(current => ({ ...current, supplier: event.target.value }))} />
                <input className={inventoryFieldClassName()} placeholder="Supplier contact" value={inventoryForm.supplierContact} onChange={event => setInventoryForm(current => ({ ...current, supplierContact: event.target.value }))} />
                <input className={inventoryFieldClassName()} type="date" max={maxBusinessDate} value={inventoryForm.lastCountDate} onChange={event => setInventoryForm(current => ({ ...current, lastCountDate: event.target.value > maxBusinessDate ? maxBusinessDate : event.target.value }))} />
                <input className={inventoryFieldClassName()} placeholder="Notes" value={inventoryForm.notes} onChange={event => setInventoryForm(current => ({ ...current, notes: event.target.value }))} />
              </div>
              <div className="flex justify-end">
                <div className="flex items-center gap-3">
                  {inventoryForm.id ? (
                    <button
                      type="button"
                      onClick={() =>
                        setInventoryForm({
                          id: undefined,
                          department: "Ingredients",
                          category: "Base",
                          itemName: "",
                          unitType: "units",
                          packSize: "",
                          costPerUnit: "0",
                          currentQuantity: "0",
                          parLevel: "0",
                          reorderQuantity: "0",
                          supplier: "",
                          supplierContact: "",
                          lastCountDate: "",
                          notes: "",
                        })
                      }
                      className="rounded-full border border-[#d7cec0] bg-white/80 px-5 py-3 text-sm font-medium text-[#31423d] shadow-sm transition hover:bg-white"
                    >
                      Cancel Edit
                    </button>
                  ) : null}
                  <button disabled={saveInventoryMutation.isPending} className="rounded-full bg-[#52665f] px-5 py-3 text-sm font-medium text-white shadow-lg shadow-[#52665f]/20 transition hover:bg-[#43554f] disabled:cursor-not-allowed disabled:opacity-60">
                    {saveInventoryMutation.isPending ? "Saving..." : inventoryForm.id ? "Update Inventory Item" : "Save Inventory Item"}
                  </button>
                </div>
              </div>
            </form>

            <div className="mt-6 space-y-3">
              {alertsQuery.isLoading ? (
                <StatePanel title="Loading inventory alerts" description="Reviewing ingredients, packaging, utensils, and cleaning items against their par levels." />
              ) : alertsQuery.error ? (
                <StatePanel title="Unable to load inventory alerts" description="Inventory alerts could not be loaded right now. Try again shortly." tone="error" />
              ) : inventoryAlerts.length === 0 ? (
                <StatePanel title="No active inventory alerts" description="Any item at or below par will surface here automatically once pricing and count targets are in place." tone="warning" />
              ) : (
                inventoryAlerts.slice(0, 8).map(item => (
                  <div key={item.id} className="flex items-start justify-between gap-4 rounded-2xl border border-[#eadfcf] bg-[#fcfaf6] p-4 shadow-sm">
                    <div>
                      <p className="font-medium text-[#24332f]">{item.itemName}</p>
                      <p className="mt-1 text-sm text-[#69726c]">{item.department} · {item.category} · {item.currentQuantity} {item.unitType} on hand · par {item.parLevel}</p>
                      <p className="mt-1 text-sm text-[#69726c]">Suggested reorder: {item.reorderAmount} {item.unitType}</p>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-[#f5e7d3] px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[#805e2f]">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Reorder
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-6 rounded-[1.5rem] border border-[#e4dccf] bg-[#fcfaf6] p-4 sm:p-5">
              <div className="flex flex-wrap gap-3">
                {MANAGER_INVENTORY_TABS.map(tab => {
                  const active = inventoryDashboardView === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setInventoryDashboardView(tab.key)}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition ${active ? "bg-[#2f2a26] text-white shadow-lg shadow-[#2f2a26]/20" : "border border-[#d7cec0] bg-white/80 text-[#31423d] shadow-sm hover:bg-white"}`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {inventoryDashboardView === "reconciliation" ? (
                <div className="mt-4 rounded-[1.25rem] border border-[#e4dccf] bg-white/80 p-4 sm:p-5">
                  {dailyQuery.isLoading ? (
                    <div className="p-4 text-sm text-[#68716b]">Loading reconciliation data...</div>
                  ) : dailyQuery.error || !daily || !reconciliationSnapshot.gelato || !reconciliationSnapshot.packaging ? (
                    <div className="p-4 text-sm text-[#8a4343]">Unable to load reconciliation data for the selected date.</div>
                  ) : (
                    <>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <div className="rounded-[1.5rem] border border-[#e4dccf] bg-[#fcfaf6] p-5 shadow-sm">
                          <p className="text-xs uppercase tracking-[0.22em] text-[#8b9088]">Gelato target</p>
                          <p className="mt-3 font-serif text-2xl text-[#1f2b27]">Opening oz − closing oz = distributed oz. Distributed oz − sold oz = difference.</p>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                            {[
                              { label: "Opening", value: `${reconciliationSnapshot.gelato.openingVolumeOunces.toFixed(2)} oz` },
                              { label: "Closing", value: `${reconciliationSnapshot.gelato.closingVolumeOunces.toFixed(2)} oz` },
                              { label: "Distributed", value: `${reconciliationSnapshot.gelato.distributedVolumeOunces.toFixed(2)} oz` },
                              { label: "Sold", value: `${reconciliationSnapshot.gelato.soldVolumeOunces.toFixed(2)} oz` },
                              { label: "Difference", value: `${formatSignedValue(reconciliationSnapshot.gelato.differenceVolumeOunces)} oz` },
                            ].map(item => (
                              <div key={item.label} className="rounded-2xl border border-[#e5ddd0] bg-white/80 p-4">
                                <p className="text-xs uppercase tracking-[0.18em] text-[#8b9088]">{item.label}</p>
                                <p className="mt-2 font-medium text-[#1f2b27]">{item.value}</p>
                              </div>
                            ))}
                          </div>
                          <p className="mt-4 text-sm leading-6 text-[#66706a]">Goal: 0.00 oz difference. Current review: {reconciliationSnapshot.gelato.discrepancyLabel}.</p>
                        </div>
                        <div className="rounded-[1.5rem] border border-[#e4dccf] bg-[#fcfaf6] p-5 shadow-sm">
                          <p className="text-xs uppercase tracking-[0.22em] text-[#8b9088]">Packaging target</p>
                          <p className="mt-3 font-serif text-2xl text-[#1f2b27]">Opening units − closing units = distributed units. Distributed units − sold units = difference.</p>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                            {[
                              { label: "Opening", value: `${reconciliationSnapshot.packaging.openingCount.toFixed(2)} units` },
                              { label: "Closing", value: reconciliationSnapshot.packaging.closingCount == null ? "Awaiting counts" : `${reconciliationSnapshot.packaging.closingCount.toFixed(2)} units` },
                              { label: "Distributed", value: reconciliationSnapshot.packaging.distributedCount == null ? "Awaiting counts" : `${reconciliationSnapshot.packaging.distributedCount.toFixed(2)} units` },
                              { label: "Sold", value: `${reconciliationSnapshot.packaging.soldCount.toFixed(2)} units` },
                              { label: "Difference", value: reconciliationSnapshot.packaging.differenceCount == null ? "Awaiting counts" : `${formatSignedValue(reconciliationSnapshot.packaging.differenceCount)} units` },
                            ].map(item => (
                              <div key={item.label} className="rounded-2xl border border-[#e5ddd0] bg-white/80 p-4">
                                <p className="text-xs uppercase tracking-[0.18em] text-[#8b9088]">{item.label}</p>
                                <p className="mt-2 font-medium text-[#1f2b27]">{item.value}</p>
                              </div>
                            ))}
                          </div>
                          <p className="mt-4 text-sm leading-6 text-[#66706a]">Goal: 0.00 units difference. Current review: {reconciliationSnapshot.packaging.discrepancyLabel}.</p>
                        </div>
                      </div>

                      <div className="mt-6 rounded-[1.5rem] border border-[#e4dccf] bg-[#fcfaf6] p-5 shadow-sm">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="max-w-3xl">
                            <p className="text-xs uppercase tracking-[0.22em] text-[#8b9088]">Shopify sales import</p>
                            <p className="mt-3 font-serif text-2xl text-[#1f2b27]">Upload a Shopify product sales CSV to compare sold ounces against the selected day’s distributed gelato ounces.</p>
                            <p className="mt-3 text-sm leading-6 text-[#66706a]">The importer maps Small, Medium, Pint, and Liter Shopify products into 4 oz, 8 oz, 16 oz, and 32 oz sold volume. Non-gelato rows stay excluded for review instead of affecting the variance.</p>
                          </div>
                          <div className="flex w-full max-w-sm flex-col gap-3 lg:items-end">
                            <label className="inline-flex cursor-pointer items-center justify-center rounded-full border border-[#2f2a26] bg-[#2f2a26] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18]">
                              Upload Shopify CSV
                              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={handleShopifyFileUpload} />
                            </label>
                            <p className="text-xs leading-5 text-[#7a827d]">Selected date: {selectedDate}. Upload one Shopify daily product report at a time.</p>
                            {shopifyImportFileName ? <p className="text-xs leading-5 text-[#7a827d]">Latest file: {shopifyImportFileName}</p> : null}
                          </div>
                        </div>

                        {shopifyImportError ? (
                          <div className="mt-4 rounded-[1.25rem] border border-[#e7c7c2] bg-[#fff4f2] px-4 py-3 text-sm text-[#8a4343]">{shopifyImportError}</div>
                        ) : null}

                        {shopifyImportSummary && shopifyVarianceSnapshot ? (
                          <>
                            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                              {[
                                { label: "Distributed", value: `${shopifyVarianceSnapshot.distributedVolumeOunces.toFixed(1)} oz` },
                                { label: "Shopify sold", value: `${shopifyVarianceSnapshot.soldVolumeOunces.toFixed(1)} oz` },
                                { label: "Difference", value: `${formatSignedValue(shopifyVarianceSnapshot.differenceVolumeOunces)} oz` },
                                { label: "% of sold", value: shopifyVarianceSnapshot.differencePercentOfSold == null ? "—" : `${shopifyVarianceSnapshot.differencePercentOfSold > 0 ? "+" : ""}${shopifyVarianceSnapshot.differencePercentOfSold.toFixed(1)}%` },
                                { label: "% of distributed", value: shopifyVarianceSnapshot.differencePercentOfDistributed == null ? "—" : `${shopifyVarianceSnapshot.differencePercentOfDistributed > 0 ? "+" : ""}${shopifyVarianceSnapshot.differencePercentOfDistributed.toFixed(1)}%` },
                                { label: "Status", value: shopifyVarianceSnapshot.status === "within-tolerance" ? "Within tolerance" : shopifyVarianceSnapshot.status === "review" ? "Review" : shopifyVarianceSnapshot.status === "major" ? "Major discrepancy" : "Awaiting data" },
                              ].map(item => (
                                <div key={item.label} className="rounded-2xl border border-[#e5ddd0] bg-white/80 p-4">
                                  <p className="text-xs uppercase tracking-[0.18em] text-[#8b9088]">{item.label}</p>
                                  <p className="mt-2 font-medium text-[#1f2b27]">{item.value}</p>
                                </div>
                              ))}
                            </div>

                            <div className="mt-4 rounded-[1.25rem] border border-[#e5ddd0] bg-white/85 p-4 text-sm leading-6 text-[#5f6a64]">
                              The uploaded Shopify report mapped <strong>{shopifyImportSummary.totalNetItemsSold.toFixed(0)}</strong> gelato servings across <strong>{shopifyImportSummary.includedProductCount}</strong> Shopify product rows. Excluded rows remain visible below so managers can verify non-gelato or unmapped products before trusting the variance.
                            </div>

                            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
                              <div className="overflow-hidden rounded-[1.25rem] border border-[#e4dccf] bg-white/90">
                                <div className="border-b border-[#ece4d8] bg-[#f4ede2] px-4 py-3 text-sm font-medium text-[#31423d]">Mapped Shopify gelato rows</div>
                                <table className="w-full text-left text-sm">
                                  <thead className="bg-[#fbf7f0] text-[#60706b]">
                                    <tr>
                                      <th className="px-4 py-3 font-medium">Product</th>
                                      <th className="px-4 py-3 font-medium">Units</th>
                                      <th className="px-4 py-3 font-medium">Size</th>
                                      <th className="px-4 py-3 font-medium">Sold oz</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-[#ece4d8] text-[#24332f]">
                                    {shopifyImportSummary.soldRows.map(row => (
                                      <tr key={`${row.productTitle}-${row.serviceMode}-${row.variantTitle}`}>
                                        <td className="px-4 py-3 font-medium">{row.productTitle}</td>
                                        <td className="px-4 py-3">{row.netItemsSold}</td>
                                        <td className="px-4 py-3">{row.ouncesEach} oz</td>
                                        <td className="px-4 py-3">{row.soldVolumeOunces.toFixed(1)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              <div className="overflow-hidden rounded-[1.25rem] border border-[#e4dccf] bg-white/90">
                                <div className="border-b border-[#ece4d8] bg-[#f4ede2] px-4 py-3 text-sm font-medium text-[#31423d]">Excluded Shopify rows</div>
                                {shopifyImportSummary.excludedRows.length === 0 ? (
                                  <div className="px-4 py-4 text-sm text-[#68716b]">All rows were mapped into gelato serving sizes.</div>
                                ) : (
                                  <table className="w-full text-left text-sm">
                                    <thead className="bg-[#fbf7f0] text-[#60706b]">
                                      <tr>
                                        <th className="px-4 py-3 font-medium">Product</th>
                                        <th className="px-4 py-3 font-medium">Units</th>
                                        <th className="px-4 py-3 font-medium">Reason</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#ece4d8] text-[#24332f]">
                                      {shopifyImportSummary.excludedRows.map(row => (
                                        <tr key={`${row.productTitle}-${row.variantTitle}-excluded`}>
                                          <td className="px-4 py-3 font-medium">{row.productTitle}</td>
                                          <td className="px-4 py-3">{row.netItemsSold}</td>
                                          <td className="px-4 py-3">{row.reason}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="mt-4 rounded-[1.25rem] border border-dashed border-[#d8cfc2] bg-white/60 px-4 py-6 text-sm leading-6 text-[#68716b]">
                            Upload the same kind of Shopify CSV you shared here, and the dashboard will calculate sold ounces, compare them with distributed ounces, and show the variance for the selected business date.
                          </div>
                        )}
                      </div>

                      <Tabs defaultValue="gelato" className="mt-6 w-full gap-4">
                        <TabsList className="h-auto w-full flex-wrap rounded-[1.25rem] border border-[#ddd4c7] bg-[#f4ede2] p-1.5">
                          <TabsTrigger value="gelato" className="rounded-[1rem] px-4 py-2 data-[state=active]:bg-white data-[state=active]:text-[#1f2b27]">Gelato ounces</TabsTrigger>
                          <TabsTrigger value="packaging" className="rounded-[1rem] px-4 py-2 data-[state=active]:bg-white data-[state=active]:text-[#1f2b27]">Cups, lids, and spoons</TabsTrigger>
                        </TabsList>
                        <TabsContent value="gelato" className="mt-4 overflow-hidden rounded-[1.25rem] border border-[#e4dccf] bg-[#fcfaf6]">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-[#f4ede2] text-[#60706b]">
                              <tr>
                                <th className="px-4 py-3 font-medium">Flavor</th>
                                <th className="px-4 py-3 font-medium">Opening oz</th>
                                <th className="px-4 py-3 font-medium">Closing oz</th>
                                <th className="px-4 py-3 font-medium">Distributed oz</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#ece4d8] text-[#24332f]">
                              {reconciliationSnapshot.gelato.flavors.map(item => (
                                <tr key={item.flavor}>
                                  <td className="px-4 py-3 font-medium">{item.flavor}</td>
                                  <td className="px-4 py-3">{item.opening.totalVolumeOunces.toFixed(2)}</td>
                                  <td className="px-4 py-3">{item.closing.totalVolumeOunces.toFixed(2)}</td>
                                  <td className="px-4 py-3">{item.usedVolumeOunces.toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </TabsContent>
                        <TabsContent value="packaging" className="mt-4 overflow-hidden rounded-[1.25rem] border border-[#e4dccf] bg-[#fcfaf6]">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-[#f4ede2] text-[#60706b]">
                              <tr>
                                <th className="px-4 py-3 font-medium">Item</th>
                                <th className="px-4 py-3 font-medium">Opening</th>
                                <th className="px-4 py-3 font-medium">Closing</th>
                                <th className="px-4 py-3 font-medium">Distributed</th>
                                <th className="px-4 py-3 font-medium">Sold</th>
                                <th className="px-4 py-3 font-medium">Difference</th>
                                <th className="px-4 py-3 font-medium">Goal</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#ece4d8] text-[#24332f]">
                              {reconciliationSnapshot.packaging.items.map(item => (
                                <tr key={item.key}>
                                  <td className="px-4 py-3 font-medium">{item.label}</td>
                                  <td className="px-4 py-3">{item.openingQuantity.toFixed(2)}</td>
                                  <td className="px-4 py-3">{item.closingQuantity == null ? "Awaiting count" : item.closingQuantity.toFixed(2)}</td>
                                  <td className="px-4 py-3">{item.actualUsed == null ? "Awaiting count" : item.actualUsed.toFixed(2)}</td>
                                  <td className="px-4 py-3">{item.expectedUsed.toFixed(2)}</td>
                                  <td className="px-4 py-3">{item.variance == null ? "Awaiting count" : formatSignedValue(item.variance)}</td>
                                  <td className="px-4 py-3">0.00</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </TabsContent>
                      </Tabs>
                    </>
                  )}
                </div>
              ) : inventoryDashboardView === "product" ? (
                <div className="mt-4 overflow-hidden rounded-[1.25rem] border border-[#e4dccf] bg-white/80">
                  {dailyQuery.isLoading ? (
                    <div className="p-4 text-sm text-[#68716b]">Loading product inventory...</div>
                  ) : dailyQuery.error || !daily ? (
                    <div className="p-4 text-sm text-[#8a4343]">Unable to load ready-made gelato inventory for the selected date.</div>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead className="bg-[#f4ede2] text-[#60706b]">
                        <tr>
                          <th className="px-4 py-3 font-medium">Flavor</th>
                          <th className="px-4 py-3 font-medium">Opening pans</th>
                          <th className="px-4 py-3 font-medium">Opening kg</th>
                          <th className="px-4 py-3 font-medium">Closing pans</th>
                          <th className="px-4 py-3 font-medium">Closing kg</th>
                          <th className="px-4 py-3 font-medium">Used oz</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#ece4d8] text-[#24332f]">
                        {daily.gelato.flavors.map(item => (
                          <tr key={item.flavor}>
                            <td className="px-4 py-3 font-medium">{item.flavor}</td>
                            <td className="px-4 py-3">{item.opening.smallPanCount + item.opening.largePanCount}</td>
                            <td className="px-4 py-3">{(item.opening.smallGrossWeightKg + item.opening.largeGrossWeightKg).toFixed(2)}</td>
                            <td className="px-4 py-3">{item.closing.smallPanCount + item.closing.largePanCount}</td>
                            <td className="px-4 py-3">{(item.closing.smallGrossWeightKg + item.closing.largeGrossWeightKg).toFixed(2)}</td>
                            <td className="px-4 py-3">{item.usedVolumeOunces.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : (
                <div className="mt-4 overflow-hidden rounded-[1.25rem] border border-[#e4dccf] bg-white/80">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#f4ede2] text-[#60706b]">
                      <tr>
                        <th className="px-4 py-3 font-medium">Category</th>
                        <th className="px-4 py-3 font-medium">Item</th>
                        <th className="px-4 py-3 font-medium">Current</th>
                        <th className="px-4 py-3 font-medium">Par</th>
                        <th className="px-4 py-3 font-medium">Reorder</th>
                        <th className="px-4 py-3 font-medium">Last count</th>
                        <th className="px-4 py-3 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#ece4d8] text-[#24332f]">
                      {inventoryItemsQuery.isLoading ? (
                        <tr>
                          <td className="px-4 py-4 text-[#68716b]" colSpan={7}>Loading inventory setup...</td>
                        </tr>
                      ) : inventoryItemsQuery.error ? (
                        <tr>
                          <td className="px-4 py-4 text-[#8a4343]" colSpan={7}>Unable to load inventory items right now.</td>
                        </tr>
                      ) : filteredManagerInventoryItems.length === 0 ? (
                        <tr>
                          <td className="px-4 py-4 text-[#68716b]" colSpan={7}>No items are configured in this inventory group yet.</td>
                        </tr>
                      ) : (
                        filteredManagerInventoryItems.map(item => (
                          <tr key={item.id}>
                            <td className="px-4 py-3">{item.category}</td>
                            <td className="px-4 py-3 font-medium">{item.itemName}</td>
                            <td className="px-4 py-3">{item.currentQuantity} {item.unitType}</td>
                            <td className="px-4 py-3">{item.parLevel}</td>
                            <td className="px-4 py-3">{item.reorderQuantity}</td>
                            <td className="px-4 py-3">{item.lastCountDate || "—"}</td>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() =>
                                  setInventoryForm({
                                    id: item.id,
                                    department: item.department,
                                    category: item.category,
                                    itemName: item.itemName,
                                    unitType: item.unitType,
                                    packSize: item.packSize,
                                    costPerUnit: String(item.costPerUnit),
                                    currentQuantity: String(item.currentQuantity),
                                    parLevel: String(item.parLevel),
                                    reorderQuantity: String(item.reorderQuantity),
                                    supplier: item.supplier ?? "",
                                    supplierContact: item.supplierContact ?? "",
                                    lastCountDate: item.lastCountDate ?? "",
                                    notes: item.notes ?? "",
                                  })
                                }
                                className="rounded-full border border-[#d7cec0] bg-white/80 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[#31423d] shadow-sm transition hover:bg-white"
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </SurfaceCard>
        ) : null}

        {isCookbookRoute ? (
          <SurfaceCard>
            <section>
              <p className="text-xs uppercase tracking-[0.24em] text-[#8a9089]">Recipe book</p>
              <h2 className="mt-3 font-serif text-3xl tracking-tight text-[#1f2b27]">Flavor formulas, ingredient costs, and yield placeholders</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-[#6b6258]">This cookbook organizes every flavor from the provided workbook with its ingredients, quantities, unit of measurement, current cost information, and placeholders for yield and cost per ounce until those final numbers are available.</p>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                {[
                  { label: "Recipes loaded", value: recipes.length },
                  { label: "Recipes pending yield", value: recipes.filter(recipe => recipe.batchYieldOunces <= 0).length },
                  { label: "Ingredients with missing costs", value: recipes.reduce((sum, recipe) => sum + recipe.missingCostCount, 0) },
                ].map(item => (
                  <div key={item.label} className="rounded-2xl border border-[#e5ddd0] bg-[#fbf7f0] p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.22em] text-[#8b9088]">{item.label}</p>
                    <p className="mt-3 font-serif text-3xl text-[#1f2b27]">{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-6 space-y-4">
                {recipesQuery.isLoading ? (
                  <StatePanel title="Loading recipe workbook" description="Pulling cookbook recipes and ingredient rows into the workspace." />
                ) : recipesQuery.error ? (
                  <StatePanel title="Unable to load cookbook data" description="The cookbook data is temporarily unavailable." tone="error" />
                ) : recipes.length === 0 ? (
                  <StatePanel title="No cookbook recipes yet" description="Recipes will appear here once the workbook seed data is available." tone="warning" />
                ) : (
                  recipes.map(recipe => (
                    <article key={recipe.id} className="rounded-[1.5rem] border border-[#e4dccf] bg-[#fcfaf6] p-5 shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="text-xs uppercase tracking-[0.22em] text-[#8a9089]">Flavor recipe</p>
                          <h3 className="mt-2 text-2xl font-medium tracking-[-0.03em] text-[#24332f]">{recipe.name}</h3>
                          <p className="mt-2 text-sm text-[#69726c]">Known ingredient cost total: <span className="font-medium text-[#24332f]">${recipe.batchCost.toFixed(2)}</span></p>
                          <p className="mt-1 text-sm text-[#69726c]">Cost per ounce: <span className="font-medium text-[#24332f]">{recipe.costPerOunce == null ? "Pending yield input" : `$${recipe.costPerOunce.toFixed(2)}/oz`}</span></p>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl border border-[#e4dccf] bg-white/90 px-4 py-3 text-sm text-[#52665f]">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a9089]">Yield</p>
                            <p className="mt-2 font-medium text-[#24332f]">{recipe.batchYieldOunces > 0 ? `${recipe.batchYieldOunces} oz` : "Pending"}</p>
                          </div>
                          <div className="rounded-2xl border border-[#eadfcf] bg-[#f5e7d3] px-4 py-3 text-sm text-[#805e2f]">
                            <p className="text-[11px] uppercase tracking-[0.18em]">Missing costs</p>
                            <p className="mt-2 font-medium">{recipe.missingCostCount}</p>
                          </div>
                          <div className="rounded-2xl border border-[#e4dccf] bg-white/90 px-4 py-3 text-sm text-[#52665f]">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a9089]">Ingredients</p>
                            <p className="mt-2 font-medium text-[#24332f]">{recipe.ingredients.length}</p>
                          </div>
                          <div className="rounded-2xl border border-[#e4dccf] bg-white/90 px-4 py-3 text-sm text-[#52665f]">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a9089]">Reorder-linked items</p>
                            <p className="mt-2 font-medium text-[#24332f]">{recipe.ingredients.filter(ingredient => {
                              const matchedItem = inventoryItems.find(item => item.id === ingredient.inventoryItemId || item.itemName === ingredient.inventoryItemName);
                              return Boolean(matchedItem?.reorderNeeded);
                            }).length}</p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 overflow-x-auto rounded-2xl border border-[#e8dfd3] bg-white/80">
                        <table className="w-full min-w-[920px] text-left text-sm">
                          <thead className="bg-[#f4ede2] text-[#60706b]">
                            <tr>
                              <th className="px-4 py-3 font-medium">Ingredient</th>
                              <th className="px-4 py-3 font-medium">Units</th>
                              <th className="px-4 py-3 font-medium">Unit of measurement</th>
                              <th className="px-4 py-3 font-medium">Cost per unit</th>
                              <th className="px-4 py-3 font-medium">Ingredient cost</th>
                              <th className="px-4 py-3 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#ece4d8] text-[#24332f]">
                            {recipe.ingredients.map(ingredient => {
                              const matchedItem = inventoryItems.find(item => item.id === ingredient.inventoryItemId || item.itemName === ingredient.inventoryItemName);
                              const purchasingStatus = ingredient.costSource === "missing"
                                ? "Need cost"
                                : matchedItem?.reorderNeeded
                                  ? "Needs reorder"
                                  : matchedItem
                                    ? "Cost linked"
                                    : "Recipe only";

                              return (
                                <tr key={ingredient.id}>
                                  <td className="px-4 py-3 align-top">
                                    <div>
                                      <p className="font-medium">{ingredient.ingredientName}</p>
                                      <p className="mt-1 text-xs text-[#7a827d]">{ingredient.inventoryItemName ? `Inventory match: ${ingredient.inventoryItemName}` : "No inventory match yet"}</p>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 align-top">{ingredient.quantity}</td>
                                  <td className="px-4 py-3 align-top">{ingredient.unitType || "—"}</td>
                                  <td className="px-4 py-3 align-top">${ingredient.costPerUnit.toFixed(2)}</td>
                                  <td className="px-4 py-3 align-top">${ingredient.totalCost.toFixed(2)}</td>
                                  <td className="px-4 py-3 align-top">
                                    <span className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ${
                                      purchasingStatus === "Needs reorder"
                                        ? "bg-[#f5e7d3] text-[#805e2f]"
                                        : purchasingStatus === "Need cost"
                                          ? "bg-[#efe4dc] text-[#8b5a47]"
                                          : purchasingStatus === "Recipe only"
                                            ? "bg-[#f1ebe2] text-[#7a6553]"
                                            : "bg-[#e8f0ec] text-[#4d655d]"
                                    }`}>
                                      {purchasingStatus}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          </SurfaceCard>
        ) : null}

        {isFormsRoute ? (
          <SurfaceCard>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-[#8a9089]">Checklist management</p>
                <h2 className="mt-3 text-3xl font-medium tracking-[-0.04em] text-[#2d2925]">Opening and closing question control</h2>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-[#6b6258]">Add new accountability questions or remove ones that no longer belong. Staff forms update from this structure instead of depending on hard-coded fields.</p>
              </div>
            </div>

            <form
              className="mt-6 grid gap-4 rounded-[1.5rem] border border-[#e4dccf] bg-[#fcfaf6] p-5"
              onSubmit={event => {
                event.preventDefault();
                saveChecklistMutation.mutate({
                  id: checklistForm.id,
                  checklistType: checklistForm.checklistType,
                  sectionTitle: checklistForm.sectionTitle,
                  prompt: checklistForm.prompt,
                  detailPrompt: checklistForm.detailPrompt,
                  detailTrigger: checklistForm.detailTrigger,
                  displayOrder: Number(checklistForm.displayOrder || 0),
                });
              }}
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <select className={inventoryFieldClassName()} value={checklistForm.checklistType} onChange={event => setChecklistForm(current => ({ ...current, checklistType: event.target.value as "opening" | "closing", sectionTitle: event.target.value === "opening" ? "Equipment" : "Cleaning" }))}>
                  <option value="opening">Opening Checklist</option>
                  <option value="closing">Closing Checklist</option>
                </select>
                <input className={inventoryFieldClassName()} placeholder="Section title" value={checklistForm.sectionTitle} onChange={event => setChecklistForm(current => ({ ...current, sectionTitle: event.target.value }))} />
                <input className={inventoryFieldClassName()} type="number" min="0" step="1" placeholder="Display order" value={checklistForm.displayOrder} onChange={event => setChecklistForm(current => ({ ...current, displayOrder: event.target.value }))} />
                <input className={inventoryFieldClassName()} placeholder="Question prompt" value={checklistForm.prompt} onChange={event => setChecklistForm(current => ({ ...current, prompt: event.target.value }))} />
                <input className={inventoryFieldClassName()} placeholder="Conditional detail prompt" value={checklistForm.detailPrompt} onChange={event => setChecklistForm(current => ({ ...current, detailPrompt: event.target.value }))} />
                <select className={inventoryFieldClassName()} value={checklistForm.detailTrigger} onChange={event => setChecklistForm(current => ({ ...current, detailTrigger: event.target.value as "Yes" | "No" | "Never" }))}>
                  <option value="No">Require details when answer is No</option>
                  <option value="Yes">Require details when answer is Yes</option>
                  <option value="Never">No follow-up detail field</option>
                </select>
              </div>
              <div className="flex justify-end gap-3">
                {checklistForm.id ? (
                  <button
                    type="button"
                    onClick={() =>
                      setChecklistForm({
                        id: undefined,
                        checklistType: "opening",
                        sectionTitle: "Equipment",
                        prompt: "",
                        detailPrompt: "If no, explain the issue.",
                        detailTrigger: "No",
                        displayOrder: "1",
                      })
                    }
                    className="rounded-full border border-[#d7cec0] bg-white/80 px-5 py-3 text-sm font-medium text-[#31423d] shadow-sm transition hover:bg-white"
                  >
                    Cancel Edit
                  </button>
                ) : null}
                <button disabled={saveChecklistMutation.isPending} className="rounded-full bg-[#2f2a26] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18] disabled:cursor-not-allowed disabled:opacity-60">
                  {saveChecklistMutation.isPending ? "Saving..." : checklistForm.id ? "Update Question" : "Add Question"}
                </button>
              </div>
            </form>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              {[
                { title: "Opening Checklist", items: openingChecklistQuestions, loading: openingChecklistQuery.isLoading, error: openingChecklistQuery.error },
                { title: "Closing Checklist", items: closingChecklistQuestions, loading: closingChecklistQuery.isLoading, error: closingChecklistQuery.error },
              ].map(group => (
                <div key={group.title} className="rounded-[1.5rem] border border-[#e4dccf] bg-[#fcfaf6] p-5">
                  <p className="text-xs uppercase tracking-[0.24em] text-[#8a9089]">{group.title}</p>
                  {group.loading ? (
                    <div className="mt-4"><StatePanel title="Loading checklist questions" description="Pulling the current question set for this checklist." /></div>
                  ) : group.error ? (
                    <div className="mt-4"><StatePanel title="Unable to load checklist questions" description="Please try again in a moment." tone="error" /></div>
                  ) : group.items.length === 0 ? (
                    <div className="mt-4"><StatePanel title="No questions configured" description="Add a question above to build this checklist." tone="warning" /></div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {group.items.map(question => (
                        <div key={question.id} className="rounded-2xl border border-[#e7ddd1] bg-white p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-xs uppercase tracking-[0.22em] text-[#8b9088]">{question.sectionTitle}</p>
                              <p className="mt-2 font-medium text-[#24332f]">{question.prompt}</p>
                              <p className="mt-2 text-sm leading-6 text-[#68716b]">Trigger: {question.detailTrigger}. {question.detailPrompt || "No follow-up detail prompt."}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setChecklistForm({
                                    id: question.id,
                                    checklistType: question.checklistType,
                                    sectionTitle: question.sectionTitle,
                                    prompt: question.prompt,
                                    detailPrompt: question.detailPrompt ?? "",
                                    detailTrigger: question.detailTrigger,
                                    displayOrder: String(question.displayOrder),
                                  })
                                }
                                className="rounded-full border border-[#d7cec0] bg-white/80 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[#31423d] shadow-sm transition hover:bg-white"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => removeChecklistMutation.mutate({ id: question.id })}
                                className="inline-flex items-center gap-2 rounded-full border border-[#ead4d4] bg-[#fff6f6] px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[#8a4343] shadow-sm transition hover:bg-white"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </SurfaceCard>
        ) : null}

        {isHistoryRoute ? (
          <>
            <SurfaceCard>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-[#8a9089]">Submission history</p>
                  <h2 className="mt-3 font-serif text-3xl tracking-tight text-[#1f2b27]">Original records for {selectedDate}</h2>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-[#66706a]">Review the exact opening, closing, and inventory submissions that staff saved on the selected Pacific business date, including the analyzed gelato photos and entered values behind each record.</p>
                </div>
                <div className="rounded-[1.5rem] border border-[#e3d8ca] bg-[#fbf7f0] px-4 py-3 text-sm text-[#68716c]">
                  {submissionHistoryQuery.isLoading ? "Loading submission records…" : `${submissionHistory.length} records available on ${selectedDate}.`}
                </div>
              </div>
              <div className="mt-6 grid gap-5">
                {submissionHistoryQuery.isLoading ? (
                  <StatePanel title="Loading submission history" description="Gathering the saved opening, closing, and inventory records for the selected date." />
                ) : submissionHistoryQuery.error ? (
                  <StatePanel title="Unable to load submission history" description="The saved form records could not be loaded right now." tone="error" />
                ) : submissionHistory.length === 0 ? (
                  <StatePanel title="No submissions saved for this date" description="Once staff submit opening, closing, or inventory records, they will appear here with the related photo evidence." tone="warning" />
                ) : (
                  submissionHistory.map(entry => (
                    <article key={entry.id} className="rounded-[1.6rem] border border-[#e4dccf] bg-[#fcfaf6] p-5 shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="rounded-full bg-[#ece3d5] px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-[#5f6e68]">{entry.submissionType}</span>
                            <span className="rounded-full bg-white px-3 py-1 text-sm text-[#66706a]">{entry.staffName || "Staff member"}</span>
                          </div>
                          <p className="mt-3 text-sm text-[#66706a]">Saved {formatDateTime(entry.createdAt)} · Business date {entry.businessDate}</p>
                        </div>
                        <div className="flex flex-col items-start gap-3 lg:items-end">
                          <div className="rounded-[1.2rem] border border-[#e4dccf] bg-white/90 px-4 py-3 text-sm text-[#52665f]">
                            {entry.payload.gelatoEntryMode ? `Gelato entry: ${entry.payload.gelatoEntryMode}` : "Manual form record"}
                          </div>
                          {entry.payload.form ? (
                            <button
                              type="button"
                              onClick={() => editingSubmissionFormId === entry.id ? cancelSubmissionFormEdit() : startSubmissionFormEdit(entry)}
                              className="rounded-full border border-[#d7cec0] bg-white/90 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[#31423d] shadow-sm transition hover:bg-white"
                            >
                              {editingSubmissionFormId === entry.id ? "Cancel form correction" : "Edit form values"}
                            </button>
                          ) : null}
                          {entry.payload.gelatoEntries && entry.payload.gelatoEntries.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => editingSubmissionId === entry.id ? cancelSubmissionGelatoEdit() : startSubmissionGelatoEdit(entry)}
                              className="rounded-full border border-[#d7cec0] bg-white/90 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[#31423d] shadow-sm transition hover:bg-white"
                            >
                              {editingSubmissionId === entry.id ? "Cancel submission edit" : "Edit gelato submission"}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {editingSubmissionId === entry.id ? (
                        <div className="mt-5 rounded-[1.5rem] border border-[#d8d0c2] bg-white/90 p-5 shadow-sm">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <p className="text-xs uppercase tracking-[0.22em] text-[#8a9089]">Manager correction</p>
                              <h3 className="mt-2 text-xl font-medium tracking-[-0.03em] text-[#24332f]">{editingSubmissionMode === "photo" ? "Review saved photo submission" : "Edit saved gelato rows"}</h3>
                              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#66706a]">{editingSubmissionMode === "photo" ? "Review each saved scale photo, confirm the total kilogram reading, adjust the pan setup if needed, and save. The dashboard totals will recalculate from those reviewed photo corrections." : "Use this editor to correct the saved pan setup and kilogram values for this submission. Saving here updates the stored gelato rows used by the dashboard totals for this business date."}</p>
                            </div>
                            <div className="rounded-2xl bg-[#f7f2ea] px-4 py-3 text-xs leading-6 text-[#625b53]">
                              {editingSubmissionMode === "photo" ? "Each reviewed photo keeps its original image while you correct the pan setup and total weight reading." : "Original photo evidence stays visible below for reference while you correct the saved gelato rows."}
                            </div>
                          </div>
                          {editingSubmissionMode === "photo" ? (
                            <div className="mt-5 space-y-4">
                              {submissionPhotoEditorRows.map((photo, index) => {
                                const panSetup = getAnalyzedPhotoPanSetup(photo);
                                const combinedWeightValue = photo.combinedGrossWeightInput || (photo.combinedGrossWeightKg > 0 ? String(photo.combinedGrossWeightKg) : "");
                                return (
                                  <div key={`${entry.id}-edit-photo-${index}`} className="overflow-hidden rounded-[1.35rem] border border-[#e5ddd0] bg-[#fcfaf6] p-4 shadow-sm">
                                    <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                                      <div className="overflow-hidden rounded-[1.2rem] border border-[#e5ddd0] bg-white">
                                        <img src={photo.imageUrl} alt={photo.fileName} loading="lazy" decoding="async" className="h-full min-h-40 w-full bg-[#f6f1e8] object-contain" />
                                      </div>
                                      <div className="grid gap-4">
                                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                          <div>
                                            <p className="text-sm font-medium text-[#24332f]">{photo.fileName}</p>
                                            <p className="mt-1 text-xs uppercase tracking-[0.22em] text-[#8a9089]">Photo-based correction</p>
                                          </div>
                                          <span className="rounded-full border border-[#d7cec0] bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[#52665f]">{photo.confidence} confidence</span>
                                        </div>
                                        <div className="grid gap-3 md:grid-cols-3">
                                          <div>
                                            <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a9089]">Flavor</p>
                                            <input
                                              className={`${inventoryFieldClassName()} mt-2 w-full`}
                                              value={photo.flavor}
                                              onChange={event => updateSubmissionPhotoEditorRow(index, current => ({ ...current, flavor: event.target.value }))}
                                              placeholder="Flavor"
                                            />
                                          </div>
                                          <div>
                                            <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a9089]">Pan setup</p>
                                            <select
                                              className={`${inventoryFieldClassName()} mt-2 w-full`}
                                              value={panSetup}
                                              onChange={event => updateSubmissionPhotoEditorRow(index, current => ({ ...current, ...applyAnalyzedPhotoPanSetup(event.target.value as ReturnType<typeof getAnalyzedPhotoPanSetup>) }))}
                                            >
                                              <option value="needs_review">Needs review</option>
                                              <option value="small">Small pan</option>
                                              <option value="large">Large pan</option>
                                              <option value="double_small">Two small pans</option>
                                              <option value="double_large">Two large pans</option>
                                              <option value="small_large">Small + large</option>
                                            </select>
                                          </div>
                                          <div>
                                            <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a9089]">Total kg on scale</p>
                                            <input
                                              className={`${inventoryFieldClassName()} mt-2 w-full`}
                                              type="number"
                                              min="0"
                                              step="0.001"
                                              value={combinedWeightValue}
                                              onChange={event => updateSubmissionPhotoEditorRow(index, current => ({
                                                ...current,
                                                combinedGrossWeightInput: event.target.value,
                                                combinedGrossWeightKg: getAnalyzedPhotoCombinedGrossWeightKg({
                                                  combinedGrossWeightKg: current.combinedGrossWeightKg,
                                                  combinedGrossWeightInput: event.target.value,
                                                }),
                                              }))}
                                            />
                                          </div>
                                        </div>
                                        <div className="rounded-[1.2rem] border border-[#e5ddd0] bg-white/90 px-4 py-3 text-sm text-[#5f6a64]">
                                          <p>{photo.smallPanCount} small pan · {photo.largePanCount} large pan · {(combinedWeightValue || "0")} kg total</p>
                                        </div>
                                        {photo.warning ? (
                                          <p className="rounded-[1.2rem] border border-[#efd7cf] bg-[#fff5f1] px-4 py-3 text-sm leading-6 text-[#7c3428]">{photo.warning}</p>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="mt-5 space-y-4">
                              {submissionGelatoEditorRows.map((row, index) => (
                                <div key={`${entry.id}-edit-row-${index}`} className="rounded-[1.35rem] border border-[#e5ddd0] bg-[#fcfaf6] p-4">
                                  <div className="grid gap-3 lg:grid-cols-[1.3fr_repeat(4,minmax(0,1fr))_auto] lg:items-end">
                                    <div>
                                      <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a9089]">Flavor</p>
                                      <input
                                        className={`${inventoryFieldClassName()} mt-2 w-full`}
                                        value={row.flavor}
                                        onChange={event => updateSubmissionGelatoEditorRow(index, "flavor", event.target.value)}
                                        placeholder="Flavor"
                                      />
                                    </div>
                                    <div>
                                      <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a9089]">Small pans</p>
                                      <input
                                        className={`${inventoryFieldClassName()} mt-2 w-full`}
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={row.smallPanCount}
                                        onChange={event => updateSubmissionGelatoEditorRow(index, "smallPanCount", event.target.value)}
                                      />
                                    </div>
                                    <div>
                                      <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a9089]">Small kg</p>
                                      <input
                                        className={`${inventoryFieldClassName()} mt-2 w-full`}
                                        type="number"
                                        min="0"
                                        step="0.001"
                                        value={row.smallGrossWeightKg}
                                        onChange={event => updateSubmissionGelatoEditorRow(index, "smallGrossWeightKg", event.target.value)}
                                      />
                                    </div>
                                    <div>
                                      <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a9089]">Large pans</p>
                                      <input
                                        className={`${inventoryFieldClassName()} mt-2 w-full`}
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={row.largePanCount}
                                        onChange={event => updateSubmissionGelatoEditorRow(index, "largePanCount", event.target.value)}
                                      />
                                    </div>
                                    <div>
                                      <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a9089]">Large kg</p>
                                      <input
                                        className={`${inventoryFieldClassName()} mt-2 w-full`}
                                        type="number"
                                        min="0"
                                        step="0.001"
                                        value={row.largeGrossWeightKg}
                                        onChange={event => updateSubmissionGelatoEditorRow(index, "largeGrossWeightKg", event.target.value)}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => removeSubmissionGelatoEditorRow(index)}
                                      className="inline-flex h-11 items-center justify-center rounded-full border border-[#ead4d4] bg-[#fff6f6] px-4 text-xs font-medium uppercase tracking-[0.16em] text-[#8a4343] shadow-sm transition hover:bg-white"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            {editingSubmissionMode === "manual" ? (
                              <button
                                type="button"
                                onClick={addSubmissionGelatoEditorRow}
                                className="rounded-full border border-[#d7cec0] bg-white/90 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[#31423d] shadow-sm transition hover:bg-white"
                              >
                                Add gelato row
                              </button>
                            ) : (
                              <p className="text-sm leading-6 text-[#66706a]">Save after you finish confirming each photo’s flavor, pan setup, and total scale weight.</p>
                            )}
                            <div className="flex flex-col gap-3 sm:flex-row">
                              <button
                                type="button"
                                onClick={cancelSubmissionGelatoEdit}
                                className="rounded-full border border-[#d7cec0] bg-white/90 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[#31423d] shadow-sm transition hover:bg-white"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => void saveSubmissionGelatoEdits()}
                                disabled={updateSubmissionGelatoMutation.isPending}
                                className="rounded-full bg-[#52665f] px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-white shadow-lg shadow-[#52665f]/20 transition hover:bg-[#43554f] disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {updateSubmissionGelatoMutation.isPending ? "Saving correction..." : "Save submission correction"}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {entry.payload.analyzedPhotos && entry.payload.analyzedPhotos.length > 0 ? (
                        <div className="mt-5">
                          <p className="text-xs uppercase tracking-[0.22em] text-[#8a9089]">Submitted photo evidence</p>
                          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {entry.payload.analyzedPhotos.map((photo, index) => (
                              <div key={`${entry.id}-photo-${index}`} className="overflow-hidden rounded-[1.4rem] border border-[#e5ddd0] bg-white shadow-sm">
                                <img src={photo.imageUrl} alt={photo.fileName} loading="lazy" decoding="async" className="h-48 w-full bg-[#f6f1e8] object-contain" />
                                <div className="space-y-2 p-4 text-sm text-[#5f6a64]">
                                  <p className="font-medium text-[#24332f]">{photo.fileName}</p>
                                  <p>{photo.flavor}</p>
                                  <p>{photo.smallPanCount} small pan · {photo.largePanCount} large pan</p>
                                  <p>{photo.combinedGrossWeightKg} kg combined</p>
                                  <p className="uppercase tracking-[0.18em] text-[#7d847d]">Confidence {photo.confidence}</p>
                                  {photo.warning ? <p className="text-[#8a5b38]">{photo.warning}</p> : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {editingSubmissionFormId === entry.id ? (
                        <div className="mt-5 rounded-[1.5rem] border border-[#d8d0c2] bg-white/90 p-5 shadow-sm">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <p className="text-xs uppercase tracking-[0.22em] text-[#8a9089]">Manager correction</p>
                              <h3 className="mt-2 text-xl font-medium tracking-[-0.03em] text-[#24332f]">Edit saved form values</h3>
                              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#66706a]">Correct the saved counts, payment amounts, or checklist-level form values for this submission. The related dashboard totals refresh from these corrected values after saving.</p>
                            </div>
                            <div className="rounded-2xl bg-[#f7f2ea] px-4 py-3 text-xs leading-6 text-[#625b53]">Opening stock counts and closing cup totals can both be corrected here without asking staff to resubmit the full form.</div>
                          </div>
                          <div className="mt-5 grid gap-4 md:grid-cols-2">
                            {submissionFormEditorFields.map((field, index) => (
                              <div key={`${entry.id}-form-edit-${field.key}`} className="rounded-[1.25rem] border border-[#e5ddd0] bg-[#fcfaf6] p-4">
                                <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a9089]">{field.label}</p>
                                {field.kind === "yesno" ? (
                                  <select className={`${inventoryFieldClassName()} mt-2 w-full`} value={field.value} onChange={event => updateSubmissionFormEditorField(index, event.target.value)}>
                                    <option value="Yes">Yes</option>
                                    <option value="No">No</option>
                                  </select>
                                ) : (
                                  <input
                                    className={`${inventoryFieldClassName()} mt-2 w-full`}
                                    type={field.kind === "number" ? "number" : "text"}
                                    min={field.kind === "number" ? "0" : undefined}
                                    step={field.kind === "number" ? "0.01" : undefined}
                                    value={field.value}
                                    onChange={event => updateSubmissionFormEditorField(index, event.target.value)}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
                            <button type="button" onClick={cancelSubmissionFormEdit} className="rounded-full border border-[#d7cec0] bg-white/90 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[#31423d] shadow-sm transition hover:bg-white">Cancel</button>
                            <button type="button" onClick={() => void saveSubmissionFormEdits()} disabled={updateSubmissionFormMutation.isPending} className="rounded-full bg-[#24332f] px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-white transition hover:bg-[#1d2925] disabled:cursor-not-allowed disabled:opacity-60">Save corrections</button>
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-5 grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
                        <div className="space-y-4">
                          {entry.payload.form ? (
                              <div className="rounded-[1.35rem] border border-[#e5ddd0] bg-white/90 p-4">
                              <p className="text-xs uppercase tracking-[0.22em] text-[#8a9089]">Form values</p>
                              <div className="mt-3 space-y-3">
                                {buildSubmissionFormValueRows(entry.payload.form).map((row, rowIndex) => (
                                  <div key={`${entry.id}-form-row-${rowIndex}`} className={`grid gap-3 ${row.length > 1 ? "sm:grid-cols-2" : ""}`}>
                                    {row.map(field => (
                                      <div key={`${entry.id}-${field.key}`} className="rounded-2xl bg-[#f7f2ea] px-4 py-3 text-sm text-[#5f6a64]">
                                        <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a9089]">{field.label}</p>
                                        <p className="mt-2 font-medium text-[#24332f]">{field.value}</p>
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            </div>

                          ) : null}

                          {entry.payload.checklistAnswers && entry.payload.checklistAnswers.length > 0 ? (
                            <div className="rounded-[1.35rem] border border-[#e5ddd0] bg-white/90 p-4">
                              <p className="text-xs uppercase tracking-[0.22em] text-[#8a9089]">Checklist answers</p>
                              <div className="mt-3 space-y-3">
                                {entry.payload.checklistAnswers.map((answer, index) => (
                                  <div key={`${entry.id}-answer-${index}`} className="rounded-2xl bg-[#f7f2ea] px-4 py-3 text-sm text-[#5f6a64]">
                                    <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a9089]">{answer.sectionTitle}</p>
                                    <p className="mt-1 font-medium text-[#24332f]">{answer.prompt}</p>
                                    <p className="mt-2">{answer.answer}{answer.detail ? ` — ${answer.detail}` : ""}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <div className="space-y-4">
                          {entry.payload.gelatoEntries && entry.payload.gelatoEntries.length > 0 ? (
                            <div className="rounded-[1.35rem] border border-[#e5ddd0] bg-white/90 p-4">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-xs uppercase tracking-[0.22em] text-[#8a9089]">Gelato rows</p>
                                <p className="text-xs leading-5 text-[#7d847d]">Managers can now correct the saved pan setup and kilogram values directly from this history card.</p>
                              </div>
                              <div className="mt-3 space-y-3">
                                {entry.payload.gelatoEntries.map((row, index) => {
                                  const volumeBreakdown = getHistoryGelatoRowVolumeBreakdown(row);
                                  return (
                                    <div key={`${entry.id}-gelato-${index}`} className="rounded-2xl bg-[#f7f2ea] px-4 py-3 text-sm text-[#5f6a64]">
                                      <p className="font-medium text-[#24332f]">{row.flavor}</p>
                                      <p className="mt-2">Small pans: {row.smallPanCount} · {row.smallGrossWeightKg} kg · {volumeBreakdown.smallVolumeOunces.toFixed(1)} oz volume</p>
                                      <p>Large pans: {row.largePanCount} · {row.largeGrossWeightKg} kg · {volumeBreakdown.largeVolumeOunces.toFixed(1)} oz volume</p>
                                      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[#7d847d]">Estimated total volume {volumeBreakdown.totalVolumeOunces.toFixed(1)} oz</p>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}

                          {entry.payload.inventoryItems && entry.payload.inventoryItems.length > 0 ? (
                            <div className="rounded-[1.35rem] border border-[#e5ddd0] bg-white/90 p-4">
                              <p className="text-xs uppercase tracking-[0.22em] text-[#8a9089]">Inventory updates</p>
                              <div className="mt-3 space-y-3">
                                {entry.payload.inventoryItems.map((item, index) => (
                                  <div key={`${entry.id}-inventory-${index}`} className="rounded-2xl bg-[#f7f2ea] px-4 py-3 text-sm text-[#5f6a64]">
                                    <p className="font-medium text-[#24332f]">{item.itemName}</p>
                                    <p className="mt-2">{item.currentQuantity} {item.unitType}{item.department ? ` · ${item.department}` : ""}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {entry.payload.notes && Object.keys(entry.payload.notes).length > 0 ? (
                            <div className="rounded-[1.35rem] border border-[#e5ddd0] bg-white/90 p-4">
                              <p className="text-xs uppercase tracking-[0.22em] text-[#8a9089]">Notes</p>
                              <div className="mt-3 space-y-3">
                                {Object.entries(entry.payload.notes)
                                  .filter(([, value]) => Boolean(value))
                                  .map(([key, value]) => (
                                    <div key={`${entry.id}-note-${key}`} className="rounded-2xl bg-[#f7f2ea] px-4 py-3 text-sm text-[#5f6a64]">
                                      <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a9089]">{formatFieldLabel(key)}</p>
                                      <p className="mt-2 leading-6 text-[#24332f]">{value}</p>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </SurfaceCard>

            <div className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
              <SurfaceCard>
                <p className="text-xs uppercase tracking-[0.24em] text-[#8a9089]">Sales trend</p>
                <h2 className="mt-3 font-serif text-3xl tracking-tight text-[#1f2b27]">Daily sales across the last four weeks</h2>
                <div className="mt-8 h-[320px]">
                  {trendQuery.isLoading ? (
                    <StatePanel title="Loading daily sales trend" description="Pulling recent daily totals for the last four weeks." />
                  ) : trendQuery.error ? (
                    <StatePanel title="Unable to load the sales trend" description="The recent sales history is temporarily unavailable." tone="error" />
                  ) : trendData.length === 0 ? (
                    <StatePanel title="No trend data yet" description="Sales trend lines will appear after employees begin submitting End-of-Day Reports." tone="warning" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trendData}>
                        <defs>
                          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#5e766d" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#5e766d" stopOpacity={0.04} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#e8e0d4" vertical={false} />
                        <XAxis dataKey="businessDate" tick={{ fill: "#7a8077", fontSize: 12 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fill: "#7a8077", fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={value => `$${value}`} />
                        <Tooltip formatter={value => formatCurrency(Number(value))} labelStyle={{ color: "#24332f" }} contentStyle={{ borderRadius: 18, borderColor: "#e4dccf", backgroundColor: "rgba(255,255,255,0.96)" }} />
                        <Area type="monotone" dataKey="totalSales" stroke="#52665f" strokeWidth={3} fill="url(#salesFill)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </SurfaceCard>

              <SurfaceCard>
                <p className="text-xs uppercase tracking-[0.24em] text-[#8a9089]">Week-over-week comparison</p>
                <h2 className="mt-3 font-serif text-3xl tracking-tight text-[#1f2b27]">Weekly momentum</h2>
                <div className="mt-8 h-[320px]">
                  {wowQuery.isLoading ? (
                    <StatePanel title="Loading weekly comparison" description="Calculating week-over-week sales changes." />
                  ) : wowQuery.error ? (
                    <StatePanel title="Unable to load the weekly comparison" description="The week-over-week chart is temporarily unavailable." tone="error" />
                  ) : wowData.length === 0 ? (
                    <StatePanel title="No weekly comparison data yet" description="As daily reports accumulate, weekly sales comparisons will appear here." tone="warning" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={wowData}>
                        <CartesianGrid stroke="#e8e0d4" vertical={false} />
                        <XAxis dataKey="weekStart" tick={{ fill: "#7a8077", fontSize: 12 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fill: "#7a8077", fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={value => `$${value}`} />
                        <Tooltip formatter={value => formatCurrency(Number(value))} labelStyle={{ color: "#24332f" }} contentStyle={{ borderRadius: 18, borderColor: "#e4dccf", backgroundColor: "rgba(255,255,255,0.96)" }} />
                        <Bar dataKey="totalSales" fill="#52665f" radius={[12, 12, 4, 4]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </SurfaceCard>
            </div>

            <SurfaceCard>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-[#8a9089]">Recent notes feed</p>
                  <h2 className="mt-3 font-serif text-3xl tracking-tight text-[#1f2b27]">Latest operational notes from all submissions</h2>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#e3d8ca] bg-[#fbf7f0] px-4 py-2 text-sm text-[#68716c]">
                  <ClipboardCheck className="h-4 w-4 text-[#52665f]" />
                  Low-item alerts, waste notes, closing notes, and general notes
                </div>
              </div>
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {notesQuery.isLoading ? (
                  <div className="lg:col-span-2">
                    <StatePanel title="Loading the recent notes feed" description="Gathering low-item alerts, waste notes, closing notes, and general notes from the latest submissions." />
                  </div>
                ) : notesQuery.error ? (
                  <div className="lg:col-span-2">
                    <StatePanel title="Unable to load the recent notes feed" description="The aggregated notes feed is temporarily unavailable." tone="error" />
                  </div>
                ) : recentNotes.length === 0 ? (
                  <div className="lg:col-span-2">
                    <StatePanel title="No notes have been submitted yet" description="Notes will appear here as soon as employees submit low-item alerts, waste notes, closing notes, or general notes." tone="warning" />
                  </div>
                ) : (
                  recentNotes.map((note, index) => (
                    <article key={`${note.type}-${note.businessDate}-${index}`} className="rounded-[1.5rem] border border-[#e6ddcf] bg-[#fcfaf6] p-5 shadow-sm">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-xs uppercase tracking-[0.22em] text-[#8a9089]">{note.type}</p>
                          <h3 className="mt-2 font-medium text-[#24332f]">{note.staffName || "Staff member"}</h3>
                        </div>
                        <div className="rounded-full bg-[#f1e8da] px-3 py-2 text-xs text-[#66706a]">{note.businessDate}</div>
                      </div>
                      <p className="mt-4 text-sm leading-7 text-[#68716b]">{note.detail}</p>
                    </article>
                  ))
                )}
              </div>
            </SurfaceCard>
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
