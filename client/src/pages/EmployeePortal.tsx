import { useAuth } from "@/_core/hooks/useAuth";
import { type PortalLanguage, translateErrorMessage, translatePortalText } from "@/lib/employeePortalI18n";
import { getOpeningNapkinsQuestion, groupOpeningQuestionsForPortal } from "@/lib/openingSetup";
import { trpc } from "@/lib/trpc";
import { ArrowRight, ClipboardCheck, House, MoonStar, Package2, ReceiptText, SunMedium } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
import { READY_MADE_GELATO_FLAVORS } from "../../../shared/opsCatalog";

type YesNo = "Yes" | "No";

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

type PairedInputConfig = {
  label: string;
  stockKey?: keyof OpeningStockCounts;
  itemName?: string;
};

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function displayNumberValue(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return "";
  return String(value);
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

const initialReadyMadeGelatoShiftState = (): ReadyMadeGelatoShiftState => ({
  smallPanCount: "",
  smallGrossWeightKg: "",
  largePanCount: "",
  largeGrossWeightKg: "",
});

const initialReadyMadeGelatoState = (businessDate = todayValue()): ReadyMadeGelatoState => ({
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

const serviceInventoryPairs: Array<{ left: PairedInputConfig; right?: PairedInputConfig }> = [
  {
    left: { label: "4oz Cups", stockKey: "cups4oz", itemName: "4oz To-Go Cups" },
    right: { label: "4oz Lids", stockKey: "lids4oz", itemName: "4oz To-Go Lids" },
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

function SectionCard({
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
    <section className="rounded-[2rem] border border-white/70 bg-white/82 p-6 shadow-[0_24px_70px_rgba(88,83,72,0.10)] backdrop-blur md:p-8">
      <div className="mb-6 flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ece4d7] text-[#5d544a]">{icon}</div>
        <div>
          <h2 className="text-2xl font-medium tracking-[-0.04em] text-[#2d2925]">{title}</h2>
          {description ? <p className="mt-2 max-w-3xl text-sm leading-7 text-[#6b6258]">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-[#2f2a26]">{label}</span>
      {children}
      {hint ? <span className="text-xs text-[#8b8176]">{hint}</span> : null}
    </label>
  );
}

function ToggleField({
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
}

function ChecklistQuestionRow({
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
}

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
  const { defaultView } = props as { defaultView?: "hub" | "opening" | "closing" };
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true, redirectPath: "/staff-login" });
  const utils = trpc.useUtils();
  const [location] = useLocation();
  const [language, setLanguage] = useState<PortalLanguage>("en");
  const t = (text: string) => translatePortalText(text, language);
  const currentBusinessDate = todayValue();
  const portalView = defaultView ?? (location.endsWith("/closing") ? "closing" : location.endsWith("/opening") ? "opening" : "hub");

  const [openingForm, setOpeningForm] = useState<OpeningForm>(initialOpeningForm);
  const [closingForm, setClosingForm] = useState<ClosingForm>(initialClosingForm);
  const [openingAnswers, setOpeningAnswers] = useState<ChecklistAnswerState>({});
  const [closingAnswers, setClosingAnswers] = useState<ChecklistAnswerState>({});
  const [serviceInventoryCounts, setServiceInventoryCounts] = useState<Record<number, string>>({});
  const [readyMadeGelato, setReadyMadeGelato] = useState<ReadyMadeGelatoState>(() => initialReadyMadeGelatoState());
  const [otherFlavorName, setOtherFlavorName] = useState("");

  const openingQuestionsQuery = trpc.forms.checklistQuestions.useQuery({ checklistType: "opening" });
  const closingQuestionsQuery = trpc.forms.checklistQuestions.useQuery({ checklistType: "closing" });
  const inventoryItemsQuery = trpc.forms.inventoryItems.useQuery();
  const readyMadeGelatoQuery = trpc.forms.readyMadeGelatoWeights.useQuery({ businessDate: currentBusinessDate });

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
  const readyMadeGelatoMutation = trpc.forms.submitReadyMadeGelato.useMutation({
    onError: error => toast.error(translateErrorMessage(error.message, language)),
  });

  const openingQuestions = openingQuestionsQuery.data ?? [];
  const closingQuestions = closingQuestionsQuery.data ?? [];
  const inventoryItems = inventoryItemsQuery.data ?? [];
  const serviceInventoryItems = useMemo(
    () => inventoryItems.filter(item => item.department !== "Ingredients").sort((a, b) => a.itemName.localeCompare(b.itemName)),
    [inventoryItems],
  );

  const inventoryByName = useMemo(
    () => new Map(serviceInventoryItems.map(item => [item.itemName, item])),
    [serviceInventoryItems],
  );

  const readyMadeGelatoFlavorNames = useMemo(() => {
    const seeded = READY_MADE_GELATO_FLAVORS.filter(flavor => flavor in readyMadeGelato.flavors);
    const custom = Object.keys(readyMadeGelato.flavors)
      .filter(flavor => !READY_MADE_GELATO_FLAVORS.includes(flavor as (typeof READY_MADE_GELATO_FLAVORS)[number]))
      .sort((a, b) => a.localeCompare(b));
    return [...seeded, ...custom];
  }, [readyMadeGelato.flavors]);

  const openingNapkinsQuestion = useMemo(() => getOpeningNapkinsQuestion(openingQuestions), [openingQuestions]);
  const storeReadyQuestion = useMemo(
    () => openingQuestions.find(question => question.prompt === "Store ready to open"),
    [openingQuestions],
  );

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
    if (serviceInventoryItems.length === 0) return;
    setServiceInventoryCounts(
      Object.fromEntries(serviceInventoryItems.map(item => [item.id, displayNumberValue(item.currentQuantity)])),
    );
  }, [serviceInventoryItems]);

  useEffect(() => {
    if (!readyMadeGelatoQuery.data) return;
    setReadyMadeGelato(current => ({
      ...current,
      businessDate: currentBusinessDate,
      flavors: {
        ...current.flavors,
        ...(Object.fromEntries(
          readyMadeGelatoQuery.data.map(item => [
            item.flavor,
            {
              opening: {
                smallPanCount: displayNumberValue(item.opening.smallPanCount),
                smallGrossWeightKg: displayNumberValue(item.opening.smallGrossWeightKg),
                largePanCount: displayNumberValue(item.opening.largePanCount),
                largeGrossWeightKg: displayNumberValue(item.opening.largeGrossWeightKg),
              },
              closing: {
                smallPanCount: displayNumberValue(item.closing.smallPanCount),
                smallGrossWeightKg: displayNumberValue(item.closing.smallGrossWeightKg),
                largePanCount: displayNumberValue(item.closing.largePanCount),
                largeGrossWeightKg: displayNumberValue(item.closing.largeGrossWeightKg),
              },
            },
          ]),
        ) as Record<string, ReadyMadeGelatoFlavorState>),
      },
    }));
  }, [currentBusinessDate, readyMadeGelatoQuery.data]);

  function updateGelatoField(shiftType: ReadyMadeGelatoShiftKey, flavor: string, field: keyof ReadyMadeGelatoShiftState, value: string) {
    setReadyMadeGelato(current => ({
      ...current,
      flavors: {
        ...current.flavors,
        [flavor]: {
          ...(current.flavors[flavor] ?? {
            opening: initialReadyMadeGelatoShiftState(),
            closing: initialReadyMadeGelatoShiftState(),
          }),
          [shiftType]: {
            ...(current.flavors[flavor]?.[shiftType] ?? initialReadyMadeGelatoShiftState()),
            [field]: value,
          },
        },
      },
    }));
  }

  function updateServiceInventory(itemId: number, value: string) {
    setServiceInventoryCounts(current => ({ ...current, [itemId]: value }));
  }

  function buildReadyMadeEntries(shiftType: ReadyMadeGelatoShiftKey) {
    return readyMadeGelatoFlavorNames.map(flavor => {
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

  function buildOpeningInventoryPayloads() {
    const payloads = new Map<number, { id: number; currentQuantity: number; notes: string }>();

    for (const pair of serviceInventoryPairs) {
      for (const config of [pair.left, pair.right].filter(Boolean) as PairedInputConfig[]) {
        if (!config.itemName) continue;
        const item = inventoryByName.get(config.itemName);
        if (!item) continue;
        const rawValue = config.stockKey ? openingForm.stockCounts[config.stockKey] : serviceInventoryCounts[item.id] ?? "";
        payloads.set(item.id, {
          id: item.id,
          currentQuantity: Number(rawValue || 0),
          notes: "",
        });
      }
    }

    return Array.from(payloads.values());
  }

  function buildClosingInventoryPayloads() {
    return serviceInventoryItems.map(item => ({
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

  async function handleOpeningSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await openingMutation.mutateAsync({
        businessDate: currentBusinessDate,
        staffName: openingForm.staffName,
        startingCash: Number(openingForm.startingCash || 0),
        cashCountedAndCorrect: openingForm.cashCountedAndCorrect,
        storeReadyToOpen: openingAnswers[storeReadyQuestion?.id ?? -1]?.answer ?? "No",
        stockCounts: {
          cups4oz: Number(openingForm.stockCounts.cups4oz || 0),
          cups8oz: Number(openingForm.stockCounts.cups8oz || 0),
          cupsPint: Number(openingForm.stockCounts.cupsPint || 0),
          cupsLiter: Number(openingForm.stockCounts.cupsLiter || 0),
          lids4oz: Number(openingForm.stockCounts.lids4oz || 0),
          lids8oz: Number(openingForm.stockCounts.lids8oz || 0),
          lidsPint: Number(openingForm.stockCounts.lidsPint || 0),
          lidsLiter: Number(openingForm.stockCounts.lidsLiter || 0),
          spoons: Number(openingForm.stockCounts.spoons || 0),
        },
        notes: openingForm.notes,
        checklistAnswers: buildAnswersPayload(openingQuestions, openingAnswers),
      });

      await Promise.all([
        readyMadeGelatoMutation.mutateAsync({
          businessDate: currentBusinessDate,
          shiftType: "opening",
          entries: buildReadyMadeEntries("opening"),
        }),
        ...buildOpeningInventoryPayloads().map(payload => inventoryMutation.mutateAsync(payload)),
      ]);

      toast.success(t("Opening form submitted."));
      setOpeningForm(initialOpeningForm());
      setOpeningAnswers({});
      await refreshAfterSubmission();
    } catch {
      // Shared mutation handlers surface the error toast.
    }
  }

  async function handleClosingSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await closingMutation.mutateAsync({
        businessDate: currentBusinessDate,
        staffName: closingForm.staffName,
        cashCounted: Number(closingForm.cashCounted || 0),
        cashMatchesSystem: closingForm.cashMatchesSystem,
        notes: closingForm.notes,
        checklistAnswers: buildAnswersPayload(closingQuestions, closingAnswers),
      });

      await Promise.all([
        readyMadeGelatoMutation.mutateAsync({
          businessDate: currentBusinessDate,
          shiftType: "closing",
          entries: buildReadyMadeEntries("closing"),
        }),
        ...buildClosingInventoryPayloads().map(payload => inventoryMutation.mutateAsync(payload)),
        endOfDayMutation.mutateAsync({
          businessDate: currentBusinessDate,
          staffName: closingForm.staffName,
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
        }),
      ]);

      toast.success(t("Closing form submitted."));
      setClosingForm(initialClosingForm());
      setClosingAnswers({});
      await refreshAfterSubmission();
    } catch {
      // Shared mutation handlers surface the error toast.
    }
  }

  if (loading) {
    return <div className="min-h-screen bg-[#f8f4ed]" />;
  }

  const navLinks = [
    { href: "/portal", label: t("Portal Home"), active: portalView === "hub" },
    { href: "/portal/opening", label: t("Opening Form"), active: portalView === "opening" },
    { href: "/portal/closing", label: t("Closing Form"), active: portalView === "closing" },
  ];

  const portalTitle = portalView === "opening" ? t("Opening Form") : portalView === "closing" ? t("Closing Form") : t("Staff portal");
  const portalDescription =
    portalView === "opening"
      ? t("Record drawer cash, readiness checks, gelato opening weights, and front counter stock in one short form.")
      : portalView === "closing"
        ? t("Record closing weights, stock counts, checklist completion, sales, and payment totals in one final form.")
        : t("Choose the opening or closing workflow to keep staff submissions short on iPad and phone.");

  function renderInventoryInput(config?: PairedInputConfig, mode: "opening" | "closing" = "opening") {
    if (!config) {
      return <div className="hidden md:block" />;
    }

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
    if (!item) {
      return <div className="hidden md:block" />;
    }

    return (
      <Field label={t(config.label)} hint={`${t("Par level")}: ${item.parLevel}`}>
        <input
          className={smallInputClassName()}
          type="number"
          min="0"
          step="1"
          value={serviceInventoryCounts[item.id] ?? ""}
          onChange={event => updateServiceInventory(item.id, event.target.value)}
        />
      </Field>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(86,111,104,0.10),_transparent_26%),linear-gradient(180deg,_#fbf8f2_0%,_#f4eee4_46%,_#f8f4ec_100%)] pb-16">
      <div className="container pt-8 md:pt-12">
        <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/70 shadow-[0_28px_80px_rgba(88,83,72,0.12)] backdrop-blur">
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
                  <Link href="/" className="inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white/88 px-5 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-white">
                    <House className="h-4 w-4" />
                    {t("Back home")}
                  </Link>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-[#e5ddd0] bg-[#f9f4ec] p-3 shadow-sm">
                <p className="text-[11px] uppercase tracking-[0.28em] text-[#7d756b]">{t("Language")}</p>
                <div className="mt-3 flex gap-2">
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
            </div>
          </div>

          <div className="p-6 md:p-8">
            {portalView === "hub" ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <SectionCard
                  icon={<SunMedium className="h-5 w-5" />}
                  title={t("Opening Form")}
                  description={t("Record drawer cash, cleanliness checks, gelato opening weights, and cups or spoon counts before service starts.")}
                >
                  <div className="space-y-4">
                    <div className="rounded-[1.5rem] border border-[#e8ddd0] bg-[#fbf7f1] p-5">
                      <p className="text-[11px] uppercase tracking-[0.28em] text-[#7d756b]">{t("Includes")}</p>
                      <p className="mt-3 text-sm leading-7 text-[#625b53]">
                        {t("Starting cash, readiness checklist, ready-made gelato opening weights, and side-by-side front counter stock counts.")}
                      </p>
                    </div>
                    <Link href="/portal/opening" className="inline-flex items-center gap-2 rounded-full bg-[#2f2a26] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18]">
                      {t("Open Opening Form")}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </SectionCard>

                <SectionCard
                  icon={<MoonStar className="h-5 w-5" />}
                  title={t("Closing Form")}
                  description={t("Finish the shift with closing weights, closing counts, checklist completion, sales totals, and payment totals in one place.")}
                >
                  <div className="space-y-4">
                    <div className="rounded-[1.5rem] border border-[#e8ddd0] bg-[#fbf7f1] p-5">
                      <p className="text-[11px] uppercase tracking-[0.28em] text-[#7d756b]">{t("Includes")}</p>
                      <p className="mt-3 text-sm leading-7 text-[#625b53]">
                        {t("Gelato closing weights, utensil counts, cash review, closing checklist, cup sales by size, and payment totals.")}
                      </p>
                    </div>
                    <Link href="/portal/closing" className="inline-flex items-center gap-2 rounded-full bg-[#2f2a26] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18]">
                      {t("Open Closing Form")}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </SectionCard>
              </div>
            ) : null}

            {portalView === "opening" ? (
              <form className="grid gap-6" onSubmit={handleOpeningSubmit}>
                <SectionCard
                  icon={<ClipboardCheck className="h-5 w-5" />}
                  title={t("Opening Form")}
                  description={t("One opening form for drawer cash, readiness checks, gelato opening weights, and front counter stock.")}
                >
                  <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                    <Field label={t("Business Date")}>
                      <div className="flex h-12 items-center rounded-2xl border border-[#d7cec0] bg-white px-4 text-sm font-medium text-[#2d2925]">{currentBusinessDate}</div>
                    </Field>
                    <Field label={t("Staff Name")}>
                      <input
                        className={inputClassName()}
                        value={openingForm.staffName}
                        onChange={event => setOpeningForm(current => ({ ...current, staffName: event.target.value }))}
                      />
                    </Field>
                    <Field label={t("Starting cash amount")}>
                      <input
                        className={inputClassName()}
                        type="number"
                        min="0"
                        step="0.01"
                        value={openingForm.startingCash}
                        onChange={event => setOpeningForm(current => ({ ...current, startingCash: event.target.value }))}
                      />
                    </Field>
                    <ToggleField
                      label={t("Cash counted and correct")}
                      value={openingForm.cashCountedAndCorrect}
                      onChange={next => setOpeningForm(current => ({ ...current, cashCountedAndCorrect: next }))}
                      language={language}
                    />
                  </div>
                </SectionCard>

                <SectionCard
                  icon={<Package2 className="h-5 w-5" />}
                  title={t("Ready-Made Gelato")}
                  description={t("Record opening counts and gross pan weights with the small and large pan fields on the same row.")}
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                    <div>
                      <p className="text-sm leading-7 text-[#625b53]">{t("Use gross pan weight in kilograms. Leave unused pan fields blank instead of clearing a zero.")}</p>
                    </div>
                    <div className="flex w-full flex-col gap-2 md:max-w-sm md:flex-row">
                      <input
                        className={inputClassName()}
                        value={otherFlavorName}
                        onChange={event => setOtherFlavorName(event.target.value)}
                        placeholder={t("Add custom flavor")}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const nextFlavor = otherFlavorName.trim();
                          if (!nextFlavor || readyMadeGelato.flavors[nextFlavor]) return;
                          setReadyMadeGelato(current => ({
                            ...current,
                            flavors: {
                              ...current.flavors,
                              [nextFlavor]: {
                                opening: initialReadyMadeGelatoShiftState(),
                                closing: initialReadyMadeGelatoShiftState(),
                              },
                            },
                          }));
                          setOtherFlavorName("");
                        }}
                        className="rounded-full border border-[#ddd4c8] bg-white px-5 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-[#f5eee5]"
                      >
                        {t("Add flavor")}
                      </button>
                    </div>
                  </div>
                  <div className="mt-6 grid gap-4 xl:grid-cols-2">
                    {readyMadeGelatoFlavorNames.map(flavor => {
                      const shift = readyMadeGelato.flavors[flavor]?.opening ?? initialReadyMadeGelatoShiftState();
                      return (
                        <div key={flavor} className="rounded-[1.5rem] border border-[#e8ddd0] bg-[#fbf7f1] p-4 shadow-sm">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <h3 className="text-lg font-medium tracking-[-0.03em] text-[#2d2925]">{t(flavor)}</h3>
                            <span className="text-[11px] uppercase tracking-[0.26em] text-[#8a8176]">{t("Opening weights")}</span>
                          </div>
                          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                            <Field label={t("Small Pans")}>
                              <input className={smallInputClassName()} type="number" min="0" step="1" value={shift.smallPanCount} onChange={event => updateGelatoField("opening", flavor, "smallPanCount", event.target.value)} />
                            </Field>
                            <Field label={t("Small Gross Weight kg")}>
                              <input className={smallInputClassName()} type="number" min="0" step="0.01" value={shift.smallGrossWeightKg} onChange={event => updateGelatoField("opening", flavor, "smallGrossWeightKg", event.target.value)} />
                            </Field>
                            <Field label={t("Large Pans")}>
                              <input className={smallInputClassName()} type="number" min="0" step="1" value={shift.largePanCount} onChange={event => updateGelatoField("opening", flavor, "largePanCount", event.target.value)} />
                            </Field>
                            <Field label={t("Large Gross Weight kg")}>
                              <input className={smallInputClassName()} type="number" min="0" step="0.01" value={shift.largeGrossWeightKg} onChange={event => updateGelatoField("opening", flavor, "largeGrossWeightKg", event.target.value)} />
                            </Field>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>

                <SectionCard
                  icon={<Package2 className="h-5 w-5" />}
                  title={t("Front Counter Stock")}
                  description={t("Keep cups, lids, spoons, and bags side by side so the form stays short on iPad and phone.")}
                >
                  <div className="space-y-4">
                    {serviceInventoryPairs.map(pair => (
                      <div key={pair.left.label} className="grid gap-4 md:grid-cols-2">
                        {renderInventoryInput(pair.left, "opening")}
                        {renderInventoryInput(pair.right, "opening")}
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard
                  icon={<ClipboardCheck className="h-5 w-5" />}
                  title={t("Opening Checklist")}
                  description={t("Confirm the shop is clean, stocked, and ready to open before service begins.")}
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
                  <div className="mt-6 flex w-full">
                    <button disabled={openingMutation.isPending || inventoryMutation.isPending || readyMadeGelatoMutation.isPending} className="w-full rounded-full bg-[#2f2a26] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18] disabled:cursor-not-allowed disabled:opacity-60">
                      {openingMutation.isPending || inventoryMutation.isPending || readyMadeGelatoMutation.isPending ? t("Submitting...") : t("Submit Opening Form")}
                    </button>
                  </div>
                </SectionCard>
              </form>
            ) : null}

            {portalView === "closing" ? (
              <form className="grid gap-6" onSubmit={handleClosingSubmit}>
                <SectionCard
                  icon={<MoonStar className="h-5 w-5" />}
                  title={t("Closing Form")}
                  description={t("One closing form for closing counts, final checklist confirmation, sales, and payment totals.")}
                >
                  <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                    <Field label={t("Business Date")}>
                      <div className="flex h-12 items-center rounded-2xl border border-[#d7cec0] bg-white px-4 text-sm font-medium text-[#2d2925]">{currentBusinessDate}</div>
                    </Field>
                    <Field label={t("Staff Name")}>
                      <input className={inputClassName()} value={closingForm.staffName} onChange={event => setClosingForm(current => ({ ...current, staffName: event.target.value }))} />
                    </Field>
                    <Field label={t("Cash total counted")}>
                      <input className={inputClassName()} type="number" min="0" step="0.01" value={closingForm.cashCounted} onChange={event => setClosingForm(current => ({ ...current, cashCounted: event.target.value }))} />
                    </Field>
                    <ToggleField label={t("Matches system?")} value={closingForm.cashMatchesSystem} onChange={next => setClosingForm(current => ({ ...current, cashMatchesSystem: next }))} language={language} />
                  </div>
                </SectionCard>

                <SectionCard
                  icon={<Package2 className="h-5 w-5" />}
                  title={t("Ready-Made Gelato")}
                  description={t("Record closing counts and gross pan weights with the small and large pan fields on the same row.")}
                >
                  <div className="grid gap-4 xl:grid-cols-2">
                    {readyMadeGelatoFlavorNames.map(flavor => {
                      const shift = readyMadeGelato.flavors[flavor]?.closing ?? initialReadyMadeGelatoShiftState();
                      return (
                        <div key={flavor} className="rounded-[1.5rem] border border-[#e8ddd0] bg-[#fbf7f1] p-4 shadow-sm">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <h3 className="text-lg font-medium tracking-[-0.03em] text-[#2d2925]">{t(flavor)}</h3>
                            <span className="text-[11px] uppercase tracking-[0.26em] text-[#8a8176]">{t("Closing weights")}</span>
                          </div>
                          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                            <Field label={t("Small Pans")}>
                              <input className={smallInputClassName()} type="number" min="0" step="1" value={shift.smallPanCount} onChange={event => updateGelatoField("closing", flavor, "smallPanCount", event.target.value)} />
                            </Field>
                            <Field label={t("Small Gross Weight kg")}>
                              <input className={smallInputClassName()} type="number" min="0" step="0.01" value={shift.smallGrossWeightKg} onChange={event => updateGelatoField("closing", flavor, "smallGrossWeightKg", event.target.value)} />
                            </Field>
                            <Field label={t("Large Pans")}>
                              <input className={smallInputClassName()} type="number" min="0" step="1" value={shift.largePanCount} onChange={event => updateGelatoField("closing", flavor, "largePanCount", event.target.value)} />
                            </Field>
                            <Field label={t("Large Gross Weight kg")}>
                              <input className={smallInputClassName()} type="number" min="0" step="0.01" value={shift.largeGrossWeightKg} onChange={event => updateGelatoField("closing", flavor, "largeGrossWeightKg", event.target.value)} />
                            </Field>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>

                <SectionCard
                  icon={<Package2 className="h-5 w-5" />}
                  title={t("Closing Stock Counts")}
                  description={t("Record the final cups, lids, spoon, and bag counts before the night ends.")}
                >
                  <div className="space-y-4">
                    {serviceInventoryPairs.map(pair => (
                      <div key={pair.left.label} className="grid gap-4 md:grid-cols-2">
                        {renderInventoryInput(pair.left, "closing")}
                        {renderInventoryInput(pair.right, "closing")}
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard
                  icon={<ClipboardCheck className="h-5 w-5" />}
                  title={t("Closing Checklist")}
                  description={t("Confirm cleaning, trash, freezer, and store close tasks before sending the nightly report.")}
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
                  title={t("Sales Entry")}
                  description={t("Enter here and to-go sales counts, payment totals, and notes without opening a second report page.")}
                >
                  <div className="rounded-[1.5rem] border border-[#e8ddd0] bg-[#fbf7f1] p-5">
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

                  <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
                    <Field label={t("Cash")}><input className={inputClassName()} type="number" min="0" step="0.01" value={closingForm.cashTotal} onChange={event => setClosingForm(current => ({ ...current, cashTotal: event.target.value }))} /></Field>
                    <Field label={t("Card")}><input className={inputClassName()} type="number" min="0" step="0.01" value={closingForm.cardTotal} onChange={event => setClosingForm(current => ({ ...current, cardTotal: event.target.value }))} /></Field>
                    <Field label={t("Venmo")}><input className={inputClassName()} type="number" min="0" step="0.01" value={closingForm.venmoTotal} onChange={event => setClosingForm(current => ({ ...current, venmoTotal: event.target.value }))} /></Field>
                    <Field label={t("Zelle")}><input className={inputClassName()} type="number" min="0" step="0.01" value={closingForm.zelleTotal} onChange={event => setClosingForm(current => ({ ...current, zelleTotal: event.target.value }))} /></Field>
                    <Field label={t("Total Sales")}><input className={inputClassName()} type="text" value={`$${totalSales.toFixed(2)}`} readOnly /></Field>
                  </div>

                  <div className="mt-6 grid gap-5 xl:grid-cols-2">
                    <Field label={t("Waste Notes")}><textarea className={textareaClassName()} value={closingForm.wasteNotes} onChange={event => setClosingForm(current => ({ ...current, wasteNotes: event.target.value }))} /></Field>
                    <Field label={t("Low-Item Notes")}><textarea className={textareaClassName()} value={closingForm.lowItemNotes} onChange={event => setClosingForm(current => ({ ...current, lowItemNotes: event.target.value }))} /></Field>
                  </div>
                  <div className="mt-5 grid gap-5">
                    <Field label={t("General Notes")}><textarea className={textareaClassName()} value={closingForm.generalNotes} onChange={event => setClosingForm(current => ({ ...current, generalNotes: event.target.value }))} /></Field>
                    <Field label={t("Notes / issues")}><textarea className={textareaClassName()} value={closingForm.notes} onChange={event => setClosingForm(current => ({ ...current, notes: event.target.value }))} /></Field>
                  </div>

                  <div className="mt-6 flex w-full">
                    <button disabled={closingMutation.isPending || endOfDayMutation.isPending || inventoryMutation.isPending || readyMadeGelatoMutation.isPending} className="w-full rounded-full bg-[#2f2a26] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18] disabled:cursor-not-allowed disabled:opacity-60">
                      {closingMutation.isPending || endOfDayMutation.isPending || inventoryMutation.isPending || readyMadeGelatoMutation.isPending ? t("Submitting...") : t("Submit Closing Form")}
                    </button>
                  </div>
                </SectionCard>
              </form>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
