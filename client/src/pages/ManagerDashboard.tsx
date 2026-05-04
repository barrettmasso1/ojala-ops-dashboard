import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getLoginUrl } from "@/const";
import { buildManagerReconciliationSnapshot, MANAGER_INVENTORY_TABS, type ManagerInventoryView } from "@/lib/managerReconciliation";
import { trpc } from "@/lib/trpc";
import { formatPacificCalendarDate, formatPacificTime, getPacificBusinessDate } from "../../../shared/businessDate";
import {
  AlertTriangle,
  CalendarRange,
  ClipboardCheck,
  CupSoda,
  PackagePlus,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

function formatFieldLabel(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, character => character.toUpperCase());
}

type SubmissionHistoryPhoto = {
  fileName: string;
  imageUrl: string;
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

export default function ManagerDashboard() {
  const [location, setLocation] = useLocation();
  const isInventoryWorkspaceRoute = location.startsWith("/dashboard/inventory");
  const isCookbookRoute = location.startsWith("/cookbook");
  const isFormsRoute = location.startsWith("/dashboard/forms");
  const isHistoryRoute = location.startsWith("/dashboard/history") || location.startsWith("/dashboard/analysis");
  const isOverviewRoute = !isInventoryWorkspaceRoute && !isCookbookRoute && !isFormsRoute && !isHistoryRoute;
  const redirectPath = isInventoryWorkspaceRoute
    ? "/dashboard/inventory"
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
  const currentPacificDateLabel = useMemo(() => formatPacificCalendarDate(liveNow, "en-US"), [liveNow]);
  const currentPacificTimeLabel = useMemo(() => formatPacificTime(liveNow, "en-US"), [liveNow]);
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

    if (inventoryForm.lastCountDate && inventoryForm.lastCountDate > maxBusinessDate) {
      setInventoryForm(current => ({ ...current, lastCountDate: maxBusinessDate }));
    }
  }, [inventoryForm.lastCountDate, maxBusinessDate, selectedDate]);

  useEffect(() => {
    const interval = window.setInterval(() => setLiveNow(new Date()), 30000);
    return () => window.clearInterval(interval);
  }, []);

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

  const daily = dailyQuery.data;
  const reconciliationSnapshot = buildManagerReconciliationSnapshot(daily);
  const flavorRows = useMemo(() => {
    if (!reconciliationSnapshot.gelato) return [];

    const totalDistributed = reconciliationSnapshot.gelato.distributedVolumeOunces;
    const totalSold = reconciliationSnapshot.gelato.soldVolumeOunces;

    return reconciliationSnapshot.gelato.flavors.map(item => {
      const openingOunces = roundTo(item.opening.totalVolumeOunces, 0);
      const closingOunces = roundTo(item.closing.totalVolumeOunces, 0);
      const distributedOunces = roundTo(item.usedVolumeOunces, 0);
      const soldOunces = totalDistributed > 0 ? roundTo((item.usedVolumeOunces / totalDistributed) * totalSold, 0) : 0;
      const differenceOunces = roundTo(item.usedVolumeOunces - (totalDistributed > 0 ? (item.usedVolumeOunces / totalDistributed) * totalSold : 0), 0);

      return {
        flavor: item.flavor,
        openingOunces,
        closingOunces,
        distributedOunces,
        soldOunces,
        differenceOunces,
        status: classifyDifference(differenceOunces),
      };
    });
  }, [reconciliationSnapshot]);

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
    : isCookbookRoute
      ? "Recipe and ingredient details live here instead of crowding the daily dashboard."
      : isFormsRoute
        ? "Manage opening and closing checklist questions in their own workspace."
        : isHistoryRoute
          ? "Review every submitted form, photo, and note for the selected business date."
          : "A quick daily glance at sales, form completion, and reconciliation.";

  const heroCopy = isInventoryWorkspaceRoute
    ? "Maintain ingredient and utensil records, review reorder pressure, and keep setup work separate from the manager's at-a-glance dashboard."
    : isCookbookRoute
      ? "Use the cookbook to review flavor formulas, ingredient costs, and yield placeholders without putting recipe details on the main dashboard."
      : isFormsRoute
        ? "Adjust checklist prompts in one place so the staff forms stay current without mixing setup work into the manager overview."
        : isHistoryRoute
          ? "Use this workspace to audit exactly what staff submitted, including gelato analysis photos, editable values, inventory updates, and notes, all grouped under the selected Pacific business date."
          : "Use this page to answer the core questions fast: what sold, whether opening and closing were completed, how much volume started and ended the day, and where the differences landed.";

  const snapshotCards = isInventoryWorkspaceRoute
    ? [
        { label: "Ingredients tracked", value: inventoryItems.filter(item => item.department === "Ingredients").length.toString(), helper: "Manager-maintained ingredient records." },
        { label: "Utensils & cleaning", value: inventoryItems.filter(item => item.department === "Utensils & Cleaning").length.toString(), helper: "Tracked non-gelato inventory items." },
        { label: "Reorder now", value: inventoryAlerts.length.toString(), helper: "Items at or below par." },
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
              { label: "Submissions on selected day", value: submissionHistory.length.toString(), helper: "Opening, closing, and inventory history records available for review." },
              { label: "Photo uploads", value: submissionHistory.reduce((sum, entry) => sum + (entry.payload.analyzedPhotos?.length ?? 0), 0).toString(), helper: "Submitted gelato evidence saved with those records." },
              { label: "Latest submission", value: submissionHistory[0]?.staffName ?? "—", helper: "Most recent staff member recorded on the selected date." },
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
                    : isCookbookRoute
                      ? "Owner / Manager cookbook"
                        : isFormsRoute
                          ? "Owner / Manager form setup"
                          : "Owner / Manager submission history"}

              </p>
              <h1 className="mt-4 font-serif text-4xl tracking-tight text-[#1f2b27] md:text-5xl">{heroTitle}</h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-[#65716b]">{heroCopy}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
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
                <div className="inline-flex items-center gap-2 rounded-full border border-[#ded5c8] bg-white/80 px-4 py-3 text-sm text-[#66706a] shadow-sm">
                  <CalendarRange className="h-4 w-4 text-[#52665f]" />
                  {isOverviewRoute
                    ? `Quick day view active for ${selectedDate}.`
                    : `Manager workspace filtered by ${selectedDate}.`}
                </div>
                <div className="rounded-full border border-[#ded5c8] bg-white/80 px-4 py-3 text-sm text-[#4f5b55] shadow-sm">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-[#8b9088]">Live Pacific time</p>
                  <p className="mt-1 font-medium text-[#24332f]">{currentPacificDateLabel}</p>
                  <p className="mt-1 text-base font-semibold tracking-[-0.02em] text-[#1f2b27]">{currentPacificTimeLabel}</p>
                </div>
              </div>
            </div>
            <div className="p-8 lg:p-10">
              <div className="rounded-[1.75rem] border border-[#e5ddd0] bg-[#f9f4ec] p-6">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#8b9088] md:text-xs md:tracking-[0.24em]">
                  {isOverviewRoute ? `Daily snapshot for ${selectedDate}` : "Workspace snapshot"}
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
                        <p className="truncate text-[0.95rem] leading-tight text-[#6f776f] md:text-base" title={card.label}>{card.label}</p>
                        <p className="mt-3 whitespace-nowrap font-serif text-[clamp(2rem,4vw,3.5rem)] leading-none tracking-tight text-[#1f2b27]" title={card.value}>{card.value}</p>
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
                    <p className="text-xs uppercase tracking-[0.24em] text-[#8a9089]">Daily formula</p>
                    <h2 className="mt-3 font-serif text-3xl tracking-tight text-[#1f2b27]">Opening − closing = distributed. Distributed − sold = difference.</h2>
                    <p className="mt-3 text-sm leading-7 text-[#6b6258]">Goal: zero difference. The table below shows the flavor-by-flavor inventory picture clearly, while the packaging summary keeps cup, lid, and spoon variance visible.</p>
                  </div>
                </div>
                <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  {[
                    { label: "Opening", value: `${reconciliationSnapshot.gelato?.openingVolumeOunces.toFixed(2) ?? "0.00"} oz` },
                    { label: "Closing", value: `${reconciliationSnapshot.gelato?.closingVolumeOunces.toFixed(2) ?? "0.00"} oz` },
                    { label: "Distributed", value: `${reconciliationSnapshot.gelato?.distributedVolumeOunces.toFixed(2) ?? "0.00"} oz` },
                    { label: "Sold", value: `${reconciliationSnapshot.gelato?.soldVolumeOunces.toFixed(2) ?? "0.00"} oz` },
                    { label: "Difference", value: `${formatSignedValue(reconciliationSnapshot.gelato?.differenceVolumeOunces)} oz` },
                  ].map(item => (
                    <div key={item.label} className="rounded-2xl border border-[#e5ddd0] bg-[#fbf7f0] p-4 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#8b9088]">{item.label}</p>
                      <p className="mt-3 font-serif text-2xl text-[#1f2b27]">{item.value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-6 rounded-[1.5rem] border border-[#e5ddd0] bg-[#fbf7f0] p-4 text-sm leading-6 text-[#66706a]">
                  Flavor-level sold ounces are currently shown as an allocated share of the day's total sold volume, based on each flavor's measured distributed ounces, so managers can spot over/under patterns even before flavor-level sales tracking is added.
                </div>
              </SurfaceCard>
            </div>

            <SurfaceCard>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-[#8a9089]">Flavor reconciliation</p>
                  <h2 className="mt-3 font-serif text-3xl tracking-tight text-[#1f2b27]">Starting ounces, ending ounces, distributed ounces, sold ounces, and difference by flavor</h2>
                </div>
                <div className="rounded-full bg-[#f1e8da] px-4 py-2 text-sm text-[#566863]">Goal: 0.00 oz difference</div>
              </div>
              <div className="mt-6 overflow-x-auto rounded-[1.5rem] border border-[#e4dccf] bg-[#fcfaf6]">
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
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-[#f4ede2] text-[#60706b]">
                      <tr>
                        <th className="px-4 py-3 font-medium">Flavor</th>
                        <th className="px-4 py-3 font-medium">Starting oz</th>
                        <th className="px-4 py-3 font-medium">Ending oz</th>
                        <th className="px-4 py-3 font-medium">Distributed oz</th>
                        <th className="px-4 py-3 font-medium">Sold oz</th>
                        <th className="px-4 py-3 font-medium">Difference</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#ece4d8] text-[#24332f]">
                      {flavorRows.map(item => (
                        <tr key={item.flavor}>
                          <td className="px-4 py-3 font-medium">{item.flavor}</td>
                          <td className="px-4 py-3">{item.openingOunces.toFixed(2)}</td>
                          <td className="px-4 py-3">{item.closingOunces.toFixed(2)}</td>
                          <td className="px-4 py-3">{item.distributedOunces.toFixed(2)}</td>
                          <td className="px-4 py-3">{item.soldOunces.toFixed(2)}</td>
                          <td className="px-4 py-3">{formatSignedValue(item.differenceOunces)}</td>
                          <td className="px-4 py-3">
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
                          <td className="px-4 py-3">{item.closingQuantity == null ? "Awaiting count" : item.closingQuantity.toFixed(2)}</td>
                          <td className="px-4 py-3">{item.actualUsed == null ? "Awaiting count" : item.actualUsed.toFixed(2)}</td>
                          <td className="px-4 py-3">{item.expectedUsed.toFixed(2)}</td>
                          <td className="px-4 py-3">{item.variance == null ? "Awaiting count" : formatSignedValue(item.variance)}</td>
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
                        <div className="rounded-[1.2rem] border border-[#e4dccf] bg-white/90 px-4 py-3 text-sm text-[#52665f]">
                          {entry.payload.gelatoEntryMode ? `Gelato entry: ${entry.payload.gelatoEntryMode}` : "Manual form record"}
                        </div>
                      </div>

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

                      <div className="mt-5 grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
                        <div className="space-y-4">
                          {entry.payload.form ? (
                            <div className="rounded-[1.35rem] border border-[#e5ddd0] bg-white/90 p-4">
                              <p className="text-xs uppercase tracking-[0.22em] text-[#8a9089]">Form values</p>
                              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                {Object.entries(entry.payload.form)
                                  .filter(([, value]) => typeof value !== "object")
                                  .map(([key, value]) => (
                                    <div key={`${entry.id}-${key}`} className="rounded-2xl bg-[#f7f2ea] px-4 py-3 text-sm text-[#5f6a64]">
                                      <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a9089]">{formatFieldLabel(key)}</p>
                                      <p className="mt-2 font-medium text-[#24332f]">{String(value ?? "—")}</p>
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
                              <p className="text-xs uppercase tracking-[0.22em] text-[#8a9089]">Gelato rows</p>
                              <div className="mt-3 space-y-3">
                                {entry.payload.gelatoEntries.map((row, index) => (
                                  <div key={`${entry.id}-gelato-${index}`} className="rounded-2xl bg-[#f7f2ea] px-4 py-3 text-sm text-[#5f6a64]">
                                    <p className="font-medium text-[#24332f]">{row.flavor}</p>
                                    <p className="mt-2">Small pans: {row.smallPanCount} · {row.smallGrossWeightKg} kg</p>
                                    <p>Large pans: {row.largePanCount} · {row.largeGrossWeightKg} kg</p>
                                  </div>
                                ))}
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
