import { useAuth } from "@/_core/hooks/useAuth";
import { type PortalLanguage, translateErrorMessage, translatePortalText } from "@/lib/employeePortalI18n";
import { getOpeningNapkinsQuestion, groupOpeningQuestionsForPortal } from "@/lib/openingSetup";
import { clearPortalDraft, loadPortalDraft, savePortalDraft } from "@/lib/portalDrafts";
import { trpc } from "@/lib/trpc";
import { ArrowRight, ClipboardCheck, House, LogOut, MoonStar, Package2, ReceiptText, Save, SunMedium } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
import { READY_MADE_GELATO_FLAVORS } from "../../../shared/opsCatalog";

type YesNo = "Yes" | "No";
type PortalView = "hub" | "opening" | "closing" | "inventory";

type SubmissionNotice = {
  view: Exclude<PortalView, "hub">;
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

type OpeningDraft = {
  form: OpeningForm;
  answers: ChecklistAnswerState;
  gelatoOpening: Record<string, ReadyMadeGelatoShiftState>;
};

type ClosingDraft = {
  form: ClosingForm;
  answers: ChecklistAnswerState;
  serviceInventoryCounts: Record<number, string>;
  gelatoClosing: Record<string, ReadyMadeGelatoShiftState>;
};

type InventoryDraft = {
  serviceInventoryCounts: Record<number, string>;
  gelatoOpening: Record<string, ReadyMadeGelatoShiftState>;
};

type DraftSavedAtState = Partial<Record<Exclude<PortalView, "hub">, number>>;

type PairedInputConfig = {
  label: string;
  stockKey?: keyof OpeningStockCounts;
  itemName?: string;
};

export const GELATO_WEIGHT_INPUT_STEP = "0.001";
export const GELATO_WEIGHT_INPUT_MODE = "decimal" as const;

const openingDraftKey = "opening" as const;
const closingDraftKey = "closing" as const;
const inventoryDraftKey = "inventory" as const;

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function displayNumberValue(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return "";
  return String(value);
}

function cloneShiftState(shift?: Partial<ReadyMadeGelatoShiftState>): ReadyMadeGelatoShiftState {
  return {
    smallPanCount: shift?.smallPanCount ?? "",
    smallGrossWeightKg: shift?.smallGrossWeightKg ?? "",
    largePanCount: shift?.largePanCount ?? "",
    largeGrossWeightKg: shift?.largeGrossWeightKg ?? "",
  };
}

function extractGelatoShiftDraft(readyMadeGelato: ReadyMadeGelatoState, shiftType: ReadyMadeGelatoShiftKey) {
  return Object.fromEntries(
    Object.entries(readyMadeGelato.flavors).map(([flavor, shifts]) => [flavor, cloneShiftState(shifts[shiftType])]),
  ) as Record<string, ReadyMadeGelatoShiftState>;
}

function applyGelatoShiftDraft(
  current: ReadyMadeGelatoState,
  shiftType: ReadyMadeGelatoShiftKey,
  draftFlavors: Record<string, ReadyMadeGelatoShiftState>,
  businessDate: string,
) {
  return {
    ...current,
    businessDate,
    flavors: Object.fromEntries(
      Array.from(new Set([...Object.keys(current.flavors), ...Object.keys(draftFlavors)])).map(flavor => [
        flavor,
        {
          ...(current.flavors[flavor] ?? {
            opening: initialReadyMadeGelatoShiftState(),
            closing: initialReadyMadeGelatoShiftState(),
          }),
          [shiftType]: cloneShiftState(draftFlavors[flavor]),
        },
      ]),
    ) as Record<string, ReadyMadeGelatoFlavorState>,
  };
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
  const { defaultView } = props as { defaultView?: PortalView };
  const { loading, logout } = useAuth({ redirectOnUnauthenticated: true, redirectPath: "/staff-login" });
  const utils = trpc.useUtils();
  const [location] = useLocation();
  const [language, setLanguage] = useState<PortalLanguage>("en");
  const t = (text: string) => translatePortalText(text, language);
  const currentBusinessDate = todayValue();
  const portalView: PortalView =
    defaultView ??
    (location.endsWith("/inventory") ? "inventory" : location.endsWith("/closing") ? "closing" : location.endsWith("/opening") ? "opening" : "hub");

  const [openingForm, setOpeningForm] = useState<OpeningForm>(initialOpeningForm);
  const [closingForm, setClosingForm] = useState<ClosingForm>(initialClosingForm);
  const [openingAnswers, setOpeningAnswers] = useState<ChecklistAnswerState>({});
  const [closingAnswers, setClosingAnswers] = useState<ChecklistAnswerState>({});
  const [serviceInventoryCounts, setServiceInventoryCounts] = useState<Record<number, string>>({});
  const [readyMadeGelato, setReadyMadeGelato] = useState<ReadyMadeGelatoState>(() => initialReadyMadeGelatoState());
  const [otherFlavorName, setOtherFlavorName] = useState("");
  const [submissionNotice, setSubmissionNotice] = useState<SubmissionNotice | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<DraftSavedAtState>({});
  const openingStaffNameRef = useRef<HTMLInputElement | null>(null);
  const closingStaffNameRef = useRef<HTMLInputElement | null>(null);
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
  const inventorySummaryMutation = trpc.forms.submitInventorySubmissionSummary.useMutation({
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
    const seeded = READY_MADE_GELATO_FLAVORS.filter(flavor => flavor in readyMadeGelato.flavors);
    const custom = Object.keys(readyMadeGelato.flavors).filter(
      flavor => !READY_MADE_GELATO_FLAVORS.includes(flavor as (typeof READY_MADE_GELATO_FLAVORS)[number]),
    );
    return [...seeded, ...custom];
  }, [readyMadeGelato.flavors]);

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
    if (inventoryItems.length === 0) return;
    if ((portalView === "closing" && hasClosingDraftRestored.current) || (portalView === "inventory" && hasInventoryDraftRestored.current)) {
      return;
    }
    setServiceInventoryCounts(Object.fromEntries(inventoryItems.map(item => [item.id, displayNumberValue(item.currentQuantity)])));
  }, [inventoryItems, portalView]);

  useEffect(() => {
    if (!readyMadeGelatoQuery.data) return;
    if (
      (portalView === "opening" && hasOpeningDraftRestored.current) ||
      (portalView === "closing" && hasClosingDraftRestored.current) ||
      (portalView === "inventory" && hasInventoryDraftRestored.current)
    ) {
      return;
    }

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
  }, [currentBusinessDate, portalView, readyMadeGelatoQuery.data]);

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

  function addCustomFlavor() {
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
    setDraftSavedAt(current => ({ ...current, inventory: draft.savedAt }));
    toast.success(t("Saved inventory draft restored."));
  }, [currentBusinessDate, portalView, t]);

  function updateInventoryItem(itemId: number, value: string) {
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
    });
    if (!savedDraft) return;

    hasOpeningDraftRestored.current = true;
    setDraftSavedAt(current => ({ ...current, opening: savedDraft.savedAt }));
    toast.success(t("Opening draft saved."));
  }

  function saveClosingDraft() {
    const savedDraft = savePortalDraft<ClosingDraft>(closingDraftKey, currentBusinessDate, {
      form: { ...closingForm, businessDate: currentBusinessDate, staffName: getNormalizedStaffName(closingForm.staffName, closingStaffNameRef.current?.value) },
      answers: closingAnswers,
      serviceInventoryCounts,
      gelatoClosing: extractGelatoShiftDraft(readyMadeGelato, "closing"),
    });
    if (!savedDraft) return;

    hasClosingDraftRestored.current = true;
    setDraftSavedAt(current => ({ ...current, closing: savedDraft.savedAt }));
    toast.success(t("Closing draft saved."));
  }

  function saveInventoryDraft() {
    const savedDraft = savePortalDraft<InventoryDraft>(inventoryDraftKey, currentBusinessDate, {
      serviceInventoryCounts,
      gelatoOpening: extractGelatoShiftDraft(readyMadeGelato, "opening"),
    });
    if (!savedDraft) return;

    hasInventoryDraftRestored.current = true;
    setDraftSavedAt(current => ({ ...current, inventory: savedDraft.savedAt }));
    toast.success(t("Inventory draft saved."));
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

  async function handleOpeningSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedStaffName = getNormalizedStaffName(openingForm.staffName, openingStaffNameRef.current?.value);
    if (!validateStaffName(normalizedStaffName, openingStaffNameRef)) return;
    if (normalizedStaffName !== openingForm.staffName) {
      setOpeningForm(current => ({ ...current, staffName: normalizedStaffName }));
    }

    try {
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
          lids4oz: Number(openingForm.stockCounts.lids4oz || 0),
          lids8oz: Number(openingForm.stockCounts.lids8oz || 0),
          lidsPint: Number(openingForm.stockCounts.lidsPint || 0),
          lidsLiter: Number(openingForm.stockCounts.lidsLiter || 0),
          spoons: Number(openingForm.stockCounts.spoons || 0),
        },
        notes: openingForm.notes,
        checklistAnswers: buildAnswersPayload(openingQuestions, openingAnswers),
        origin: submissionOrigin,
      });

      await readyMadeGelatoMutation.mutateAsync({
        businessDate: currentBusinessDate,
        shiftType: "opening",
        notifyOwner: false,
        entries: buildReadyMadeEntries("opening"),
      });
      await submitInventoryPayloads(buildLimitedInventoryPayloads("opening").map(payload => ({ ...payload, notifyOwner: false })));

      toast.success(t("Opening form submitted."));
      showSubmissionNotice("opening", t("Opening form submitted."), `${t("Saved for")} ${normalizedStaffName} · ${currentBusinessDate}. ${t("Managers can review it in the dashboard.")}`);
      clearPortalDraft(openingDraftKey);
      hasOpeningDraftRestored.current = false;
      setDraftSavedAt(current => ({ ...current, opening: undefined }));
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
      await closingMutation.mutateAsync({
        businessDate: currentBusinessDate,
        staffName: normalizedStaffName,
        cashCounted: Number(closingForm.cashCounted || 0),
        cashMatchesSystem: closingForm.cashMatchesSystem,
        notes: closingForm.notes,
        notifyOwner: false,
        checklistAnswers: buildAnswersPayload(closingQuestions, closingAnswers),
      });

      await readyMadeGelatoMutation.mutateAsync({
        businessDate: currentBusinessDate,
        shiftType: "closing",
        notifyOwner: false,
        entries: buildReadyMadeEntries("closing"),
      });
      await submitInventoryPayloads(buildLimitedInventoryPayloads("closing").map(payload => ({ ...payload, notifyOwner: false })));
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

      toast.success(t("Closing form submitted."));
      showSubmissionNotice("closing", t("Closing form submitted."), `${t("Saved for")} ${normalizedStaffName} · ${currentBusinessDate}. ${t("Managers can review it in the dashboard.")}`);
      clearPortalDraft(closingDraftKey);
      hasClosingDraftRestored.current = false;
      setDraftSavedAt(current => ({ ...current, closing: undefined }));
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
      const updatedItems = await submitInventoryPayloads(
        buildFullInventoryPayloads().map(payload => ({ ...payload, notifyOwner: false }))
      );
      const gelatoResult = await readyMadeGelatoMutation.mutateAsync({
        businessDate: currentBusinessDate,
        shiftType: "opening",
        notifyOwner: false,
        entries: buildReadyMadeEntries("opening"),
      });
      await inventorySummaryMutation.mutateAsync({
        businessDate: currentBusinessDate,
        staffName: "Ojala Staff",
        gelatoEntryCount: gelatoResult.records.length,
        itemSummaries: updatedItems,
        origin: submissionOrigin,
      });
      toast.success(t("Inventory and ready-made gelato updated."));
      showSubmissionNotice("inventory", t("Inventory and ready-made gelato updated."), `${t("Saved for")} ${currentBusinessDate}. ${t("Managers can review it in the dashboard.")}`);
      clearPortalDraft(inventoryDraftKey);
      hasInventoryDraftRestored.current = false;
      setDraftSavedAt(current => ({ ...current, inventory: undefined }));
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
        <div className="grid gap-4 lg:grid-cols-2">
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(86,111,104,0.10),_transparent_26%),linear-gradient(180deg,_#fbf8f2_0%,_#f4eee4_46%,_#f8f4ec_100%)] pb-16">
      <div className="container max-w-[1440px] px-4 pt-6 sm:px-6 md:pt-10 lg:px-8">
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
                  <Link href="/portal/photo-pilot" className="inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white/88 px-5 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-white">
                    {t("Photo Pilot")}
                  </Link>
                  <Link href="/portal" className="inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white/88 px-5 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-white">
                    {t("Portal Home")}
                  </Link>
                  <Link href="/" className="inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white/88 px-5 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-white">
                    <House className="h-4 w-4" />
                    {t("Back home")}
                  </Link>
                </div>
              </div>

              <div className="flex flex-col gap-3">
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
                  icon={<Package2 className="h-5 w-5" />}
                  title={t("Photo Pilot")}
                  description={t("Test the separate photo-assisted gelato workflow by uploading pan-on-scale images, reviewing the extracted values, and saving only the verified weights.")}
                >
                  <div>
                    <Link href="/portal/photo-pilot" className="inline-flex items-center gap-2 rounded-full bg-[#52665f] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#41534d]">
                      {t("Open Photo Pilot")}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </SectionCard>
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
                  {draftSavedAt.opening ? <p className="mt-3 text-xs text-[#7d756b]">{t("Draft saved on this device for today.")}</p> : null}
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
                  {draftSavedAt.closing ? <p className="mt-3 text-xs text-[#7d756b]">{t("Draft saved on this device for today.")}</p> : null}
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
                  {draftSavedAt.inventory ? <p className="mt-3 text-xs text-[#7d756b]">{t("Draft saved on this device for today.")}</p> : null}
                </SectionCard>
              </form>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
