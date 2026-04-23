import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  CalendarRange,
  ClipboardCheck,
  Coins,
  CupSoda,
  PackagePlus,
  Search,
  Trash2,
  TrendingUp,
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
  return new Date().toISOString().slice(0, 10);
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

function SurfaceCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-[2rem] border border-white/70 bg-white/82 p-6 shadow-[0_24px_70px_rgba(88,83,72,0.10)] backdrop-blur ${className}`}>{children}</section>;
}

function StatCard({
  label,
  value,
  helper,
  icon,
}: {
  label: string;
  value: string;
  helper: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-[1.75rem] border border-[#e5ddd0] bg-[#fbf7f0] p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-[#8a9089]">{label}</p>
          <p className="mt-3 font-serif text-3xl tracking-tight text-[#21312c]">{value}</p>
          <p className="mt-2 text-sm leading-6 text-[#65716a]">{helper}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#ece4d7] text-[#52665f]">{icon}</div>
      </div>
    </div>
  );
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

export default function ManagerDashboard() {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true });
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [selectedDate, setSelectedDate] = useState(todayValue());
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

  useEffect(() => {
    if (!loading && user && !isAdmin) {
      setLocation("/portal");
    }
  }, [isAdmin, loading, setLocation, user]);

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

  if (loading || (user && !isAdmin)) {
    return <div className="min-h-screen bg-[#f7f2ea]" />;
  }

  const daily = dailyQuery.data;
  const totalCups = (daily?.cups["4oz"] ?? 0) + (daily?.cups["8oz"] ?? 0) + (daily?.cups.Pint ?? 0) + (daily?.cups.Liter ?? 0);
  const trendData = trendQuery.data ?? [];
  const wowData = wowQuery.data ?? [];
  const inventoryAlerts = alertsQuery.data ?? [];
  const inventoryItems = inventoryItemsQuery.data ?? [];
  const recipes = recipesQuery.data ?? [];
  const openingChecklistQuestions = openingChecklistQuery.data ?? [];
  const closingChecklistQuestions = closingChecklistQuery.data ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <SurfaceCard className="overflow-hidden p-0">
          <div className="grid gap-0 lg:grid-cols-[1.12fr_0.88fr]">
            <div className="border-b border-[#e4dccf] p-8 lg:border-b-0 lg:border-r lg:p-10">
              <p className="text-xs uppercase tracking-[0.28em] text-[#7f857d]">Owner / Manager dashboard</p>
              <h1 className="mt-4 font-serif text-4xl tracking-tight text-[#1f2b27] md:text-5xl">A polished view of daily operations and sales performance.</h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-[#65716b]">
                Search by day, monitor checklist completion, compare weekly performance, and catch inventory risk before it affects service quality.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative max-w-xs flex-1">
                  <CalendarRange className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7d847d]" />
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={event => setSelectedDate(event.target.value)}
                    className="h-12 w-full rounded-full border border-[#ddd4c7] bg-[#fcfaf6] pl-11 pr-4 text-sm text-[#24332f] shadow-sm outline-none transition focus:border-[#52665f] focus:ring-4 focus:ring-[#52665f]/10"
                  />
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#ded5c8] bg-white/80 px-4 py-3 text-sm text-[#66706a] shadow-sm">
                  <Search className="h-4 w-4 text-[#52665f]" />
                  Day-by-day reporting is active for {selectedDate}.
                </div>
              </div>
            </div>
            <div className="p-8 lg:p-10">
              <div className="rounded-[1.75rem] border border-[#e5ddd0] bg-[#f9f4ec] p-6">
                <p className="text-xs uppercase tracking-[0.24em] text-[#8b9088]">Snapshot for {selectedDate}</p>
                {dailyQuery.isLoading ? (
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div key={index} className="h-28 rounded-2xl bg-white/75 animate-pulse" />
                    ))}
                  </div>
                ) : dailyQuery.error ? (
                  <div className="mt-5">
                    <StatePanel title="Unable to load the selected-day snapshot" description="The daily report data could not be loaded right now. Try another date or refresh shortly." tone="error" />
                  </div>
                ) : (
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
                      <p className="text-sm text-[#7c847d]">Total sales</p>
                      <p className="mt-2 font-serif text-3xl text-[#1f2b27]">{formatCurrency(daily?.sales.total ?? 0)}</p>
                    </div>
                    <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
                      <p className="text-sm text-[#7c847d]">Total cups sold</p>
                      <p className="mt-2 font-serif text-3xl text-[#1f2b27]">{totalCups}</p>
                    </div>
                    <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
                      <p className="text-sm text-[#7c847d]">Opening completion</p>
                      <p className="mt-2 font-serif text-3xl text-[#1f2b27]">{formatPercent(daily?.checklistCompletion.opening ?? 0)}</p>
                    </div>
                    <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
                      <p className="text-sm text-[#7c847d]">Closing completion</p>
                      <p className="mt-2 font-serif text-3xl text-[#1f2b27]">{formatPercent(daily?.checklistCompletion.closing ?? 0)}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </SurfaceCard>

        <div className="grid gap-5 xl:grid-cols-4">
          <StatCard label="Cash" value={formatCurrency(daily?.sales.cash ?? 0)} helper="Exact payment label preserved." icon={<Coins className="h-5 w-5" />} />
          <StatCard label="Card" value={formatCurrency(daily?.sales.card ?? 0)} helper="Card sales for the selected day." icon={<TrendingUp className="h-5 w-5" />} />
          <StatCard label="Zelle" value={formatCurrency(daily?.sales.zelle ?? 0)} helper="Zelle payment total captured from the report." icon={<Coins className="h-5 w-5" />} />
          <StatCard label="Venmo" value={formatCurrency(daily?.sales.venmo ?? 0)} helper="Venmo payment total captured from the report." icon={<Coins className="h-5 w-5" />} />
        </div>

        <div className="grid gap-8 xl:grid-cols-[1.2fr_0.8fr]">
          <SurfaceCard>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-[#8a9089]">Day-by-day searchable report</p>
                <h2 className="mt-3 font-serif text-3xl tracking-tight text-[#1f2b27]">Selected day performance</h2>
              </div>
              <div className="rounded-full bg-[#f1e8da] px-4 py-2 text-sm text-[#566863]">{daily?.reportCount ?? 0} end-of-day entries</div>
            </div>
            <div className="mt-6">
              {dailyQuery.isLoading ? (
                <StatePanel title="Loading the daily report" description="Pulling sales totals, payment breakdowns, cup counts, and checklist completion for the selected day." />
              ) : dailyQuery.error ? (
                <StatePanel title="Unable to load the daily report" description="The selected day could not be loaded right now. Please try again in a moment." tone="error" />
              ) : !daily ? (
                <StatePanel title="No report data found for this day" description="Once employees submit their daily forms, the searchable report will appear here automatically." tone="warning" />
              ) : (
                <>
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
                  <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-[#e4dccf] bg-[#fcfaf6]">
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
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </SurfaceCard>

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
                <input className={inventoryFieldClassName()} type="date" value={inventoryForm.lastCountDate} onChange={event => setInventoryForm(current => ({ ...current, lastCountDate: event.target.value }))} />
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

            <div className="mt-6 overflow-x-auto rounded-[1.5rem] border border-[#e4dccf] bg-[#fcfaf6]">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-[#f4ede2] text-[#60706b]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Department</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 font-medium">Pack size</th>
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
                      <td className="px-4 py-4 text-[#68716b]" colSpan={9}>Loading inventory setup...</td>
                    </tr>
                  ) : inventoryItemsQuery.error ? (
                    <tr>
                      <td className="px-4 py-4 text-[#8a4343]" colSpan={9}>Unable to load inventory items right now.</td>
                    </tr>
                  ) : inventoryItems.length === 0 ? (
                    <tr>
                      <td className="px-4 py-4 text-[#68716b]" colSpan={9}>No inventory items are configured yet.</td>
                    </tr>
                  ) : (
                    inventoryItems.map(item => (
                      <tr key={item.id}>
                        <td className="px-4 py-3">{item.department}</td>
                        <td className="px-4 py-3">{item.category}</td>
                        <td className="px-4 py-3">{item.itemName}</td>
                        <td className="px-4 py-3">{item.packSize || "—"}</td>
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
          </SurfaceCard>

          <SurfaceCard>
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
                <StatePanel title="Loading recipe workbook" description="Pulling cookbook recipes and ingredient rows into the dashboard." />
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
                            <th className="px-4 py-3 font-medium">Cost source</th>
                            <th className="px-4 py-3 font-medium">Cost per ingredient unit</th>
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
                                <td className="px-4 py-3 align-top capitalize">{ingredient.costSource}</td>
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
          </SurfaceCard>
        </div>

        <div className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
          <SurfaceCard className="xl:col-span-2">
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
                { title: "Opening Checklist", tone: "opening", items: openingChecklistQuestions, loading: openingChecklistQuery.isLoading, error: openingChecklistQuery.error },
                { title: "Closing Checklist", tone: "closing", items: closingChecklistQuestions, loading: closingChecklistQuery.isLoading, error: closingChecklistQuery.error },
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
      </div>
    </DashboardLayout>
  );
}
