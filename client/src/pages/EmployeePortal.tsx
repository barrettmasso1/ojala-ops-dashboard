import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { ClipboardCheck, MoonStar, Package2, ReceiptText, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
  storeReadyToOpen: YesNo;
  stockCounts: OpeningStockCounts;
  notes: string;
};

type ClosingForm = {
  businessDate: string;
  staffName: string;
  cashCounted: string;
  cashMatchesSystem: YesNo;
  notes: string;
};

type EndOfDayForm = {
  businessDate: string;
  shift: "AM" | "PM" | "Full Day";
  staffName: string;
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

type InventoryUpdateState = Record<number, { currentQuantity: string; notes: string }>;

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

const initialOpeningStockCounts = (): OpeningStockCounts => ({
  cups4oz: "0",
  cups8oz: "0",
  cupsPint: "0",
  cupsLiter: "0",
  lids4oz: "0",
  lids8oz: "0",
  lidsPint: "0",
  lidsLiter: "0",
  spoons: "0",
});

const initialOpeningForm = (): OpeningForm => ({
  businessDate: todayValue(),
  staffName: "",
  startingCash: "",
  cashCountedAndCorrect: "No",
  storeReadyToOpen: "No",
  stockCounts: initialOpeningStockCounts(),
  notes: "",
});

const initialClosingForm = (): ClosingForm => ({
  businessDate: todayValue(),
  staffName: "",
  cashCounted: "",
  cashMatchesSystem: "No",
  notes: "",
});

const initialEndOfDayForm = (): EndOfDayForm => ({
  businessDate: todayValue(),
  shift: "AM",
  staffName: "",
  cups4ozHere: "0",
  cups4ozToGo: "0",
  cups8ozHere: "0",
  cups8ozToGo: "0",
  cupsPintHere: "0",
  cupsPintToGo: "0",
  cupsLiterHere: "0",
  cupsLiterToGo: "0",
  cashTotal: "0",
  cardTotal: "0",
  zelleTotal: "0",
  venmoTotal: "0",
  wasteNotes: "",
  lowItemNotes: "",
  generalNotes: "",
});

const openingStockFields: Array<{ key: keyof OpeningStockCounts; label: string; group: string }> = [
  { key: "cups4oz", label: "Cups 4oz", group: "Cup counts" },
  { key: "cups8oz", label: "Cups 8oz", group: "Cup counts" },
  { key: "cupsPint", label: "Cups Pint", group: "Cup counts" },
  { key: "cupsLiter", label: "Cups Liter", group: "Cup counts" },
  { key: "lids4oz", label: "Lids 4oz", group: "Lid counts" },
  { key: "lids8oz", label: "Lids 8oz", group: "Lid counts" },
  { key: "lidsPint", label: "Lids Pint", group: "Lid counts" },
  { key: "lidsLiter", label: "Lids Liter", group: "Lid counts" },
  { key: "spoons", label: "Spoons stocked", group: "Utensils" },
];

const endOfDayCupRows: Array<{
  label: string;
  hereKey: keyof EndOfDayForm;
  toGoKey: keyof EndOfDayForm;
}> = [
  { label: "4oz", hereKey: "cups4ozHere", toGoKey: "cups4ozToGo" },
  { label: "8oz", hereKey: "cups8ozHere", toGoKey: "cups8ozToGo" },
  { label: "Pint", hereKey: "cupsPintHere", toGoKey: "cupsPintToGo" },
  { label: "Liter", hereKey: "cupsLiterHere", toGoKey: "cupsLiterToGo" },
];

function SectionCard({
  id,
  icon,
  title,
  description,
  children,
}: {
  id?: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="rounded-[2rem] border border-white/70 bg-white/82 p-6 shadow-[0_24px_70px_rgba(88,83,72,0.10)] backdrop-blur md:p-8">
      <div className="mb-6 flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ece4d7] text-[#5d544a]">{icon}</div>
        <div>
          <h2 className="text-2xl font-medium tracking-[-0.04em] text-[#2d2925]">{title}</h2>
          {description ? <p className="mt-2 max-w-2xl text-sm leading-7 text-[#6b6258]">{description}</p> : null}
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

function inputClassName() {
  return "h-12 rounded-2xl border border-[#dbd2c5] bg-[#fcfaf6] px-4 text-sm text-[#2f2a26] shadow-sm outline-none transition focus:border-[#5b5045] focus:ring-4 focus:ring-[#5b5045]/10";
}

function smallInputClassName() {
  return "h-10 w-full rounded-xl border border-[#dbd2c5] bg-[#fcfaf6] px-3 text-sm text-[#2f2a26] shadow-sm outline-none transition focus:border-[#5b5045] focus:ring-4 focus:ring-[#5b5045]/10";
}

function textareaClassName() {
  return "min-h-[120px] rounded-2xl border border-[#dbd2c5] bg-[#fcfaf6] px-4 py-3 text-sm text-[#2f2a26] shadow-sm outline-none transition focus:border-[#5b5045] focus:ring-4 focus:ring-[#5b5045]/10";
}

function ChecklistQuestionRow({
  question,
  state,
  onChange,
}: {
  question: ChecklistQuestion;
  state: { answer: YesNo; detail: string };
  onChange: (next: { answer: YesNo; detail: string }) => void;
}) {
  const showDetail = question.detailTrigger !== "Never" && state.answer === question.detailTrigger;

  return (
    <div className="rounded-[1.5rem] border border-[#e8ddd0] bg-[#fbf7f1] p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-medium text-[#2f2a26]">{question.prompt}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.24em] text-[#8a8176]">{question.sectionTitle}</p>
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
                {option}
              </button>
            );
          })}
        </div>
      </div>
      {showDetail ? (
        <div className="mt-4">
          <Field label={question.detailPrompt || "Please explain"}>
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

export default function EmployeePortal() {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true });
  const utils = trpc.useUtils();

  const [openingForm, setOpeningForm] = useState<OpeningForm>(initialOpeningForm);
  const [closingForm, setClosingForm] = useState<ClosingForm>(initialClosingForm);
  const [endOfDayForm, setEndOfDayForm] = useState<EndOfDayForm>(initialEndOfDayForm);
  const [openingAnswers, setOpeningAnswers] = useState<ChecklistAnswerState>({});
  const [closingAnswers, setClosingAnswers] = useState<ChecklistAnswerState>({});
  const [inventoryUpdates, setInventoryUpdates] = useState<InventoryUpdateState>({});

  const openingQuestionsQuery = trpc.forms.checklistQuestions.useQuery({ checklistType: "opening" });
  const closingQuestionsQuery = trpc.forms.checklistQuestions.useQuery({ checklistType: "closing" });
  const inventoryItemsQuery = trpc.forms.inventoryItems.useQuery();

  const openingMutation = trpc.forms.submitOpening.useMutation({
    onSuccess: async () => {
      toast.success("Opening Checklist submitted.");
      setOpeningForm(initialOpeningForm());
      setOpeningAnswers({});
      await Promise.all([utils.dashboard.daily.invalidate(), utils.dashboard.recentNotes.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });

  const closingMutation = trpc.forms.submitClosing.useMutation({
    onSuccess: async () => {
      toast.success("Closing Checklist submitted.");
      setClosingForm(initialClosingForm());
      setClosingAnswers({});
      await Promise.all([utils.dashboard.daily.invalidate(), utils.dashboard.recentNotes.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });

  const endOfDayMutation = trpc.forms.submitEndOfDay.useMutation({
    onSuccess: async () => {
      toast.success("End-of-Day Report submitted.");
      setEndOfDayForm(initialEndOfDayForm());
      await Promise.all([
        utils.dashboard.daily.invalidate(),
        utils.dashboard.salesTrend.invalidate(),
        utils.dashboard.weekOverWeek.invalidate(),
        utils.dashboard.recentNotes.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });

  const inventoryMutation = trpc.forms.submitInventoryUpdate.useMutation({
    onSuccess: async () => {
      toast.success("Inventory updated.");
      await Promise.all([inventoryItemsQuery.refetch(), utils.dashboard.inventoryAlerts.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });

  const introName = useMemo(() => user?.name?.split(" ")[0] ?? "team", [user?.name]);

  const openingQuestions = openingQuestionsQuery.data ?? [];
  const closingQuestions = closingQuestionsQuery.data ?? [];
  const inventoryItems = inventoryItemsQuery.data ?? [];

  const openingNapkinsQuestion = useMemo(
    () => openingQuestions.find(question => question.sectionTitle === "Setup" && question.prompt === "Napkins stocked"),
    [openingQuestions],
  );

  const groupedOpeningQuestions = useMemo(() => {
    return openingQuestions.reduce<Record<string, ChecklistQuestion[]>>((acc, question) => {
      if (question.id === openingNapkinsQuestion?.id) {
        return acc;
      }
      acc[question.sectionTitle] = [...(acc[question.sectionTitle] ?? []), question];
      return acc;
    }, {});
  }, [openingQuestions, openingNapkinsQuestion]);

  const groupedClosingQuestions = useMemo(() => {
    return closingQuestions.reduce<Record<string, ChecklistQuestion[]>>((acc, question) => {
      acc[question.sectionTitle] = [...(acc[question.sectionTitle] ?? []), question];
      return acc;
    }, {});
  }, [closingQuestions]);

  const totalSales = useMemo(() => {
    return [endOfDayForm.cashTotal, endOfDayForm.cardTotal, endOfDayForm.zelleTotal, endOfDayForm.venmoTotal]
      .map(value => Number(value || 0))
      .reduce((sum, value) => sum + value, 0);
  }, [endOfDayForm.cashTotal, endOfDayForm.cardTotal, endOfDayForm.zelleTotal, endOfDayForm.venmoTotal]);

  if (loading) {
    return <div className="min-h-screen bg-[#f8f4ed]" />;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(86,111,104,0.10),_transparent_26%),linear-gradient(180deg,_#fbf8f2_0%,_#f4eee4_46%,_#f8f4ec_100%)] pb-16">
      <div className="container pt-8 md:pt-12">
        <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/70 shadow-[0_28px_80px_rgba(88,83,72,0.12)] backdrop-blur">
          <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="border-b border-[#e4dccf] p-8 lg:border-b-0 lg:border-r lg:p-10">
              <p className="text-[11px] uppercase tracking-[0.34em] text-[#7d756b]">Staff portal</p>
              <h1 className="mt-4 text-4xl font-light tracking-[-0.05em] text-[#2d2925] md:text-5xl">
                Clear daily accountability for calm operations.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-[#6a6158]">
                Welcome back, {introName}. These forms now default to <strong>No</strong> so each task must be positively confirmed before a shift is considered ready or complete.
              </p>
              <div className="mt-8 grid gap-4 md:grid-cols-4">
                {[
                  { label: "Inventory", value: "Quick stock updates", href: "#inventory" },
                  { label: "Daily Report", value: "Sales and notes", href: "#end-of-day" },
                  { label: "Closing", value: "Lock in final checks", href: "#closing" },
                  { label: "Opening", value: "Start ready", href: "#opening" },
                ].map(item => (
                  <a key={item.label} href={item.href} className="rounded-2xl border border-white/80 bg-[#fbf7f0] p-4 shadow-sm transition hover:bg-white">
                    <p className="text-xs uppercase tracking-[0.22em] text-[#8a9089]">Direct link</p>
                    <p className="mt-2 font-medium text-[#253630]">{item.label}</p>
                    <p className="mt-2 text-sm text-[#67706a]">{item.value}</p>
                  </a>
                ))}
              </div>
            </div>
            <div className="p-8 lg:p-10">
              <div className="rounded-[1.75rem] border border-[#e5ddd0] bg-[#f9f4ec] p-6">
                <div className="flex items-center gap-3 text-[#5d544a]">
                  <Sparkles className="h-5 w-5" />
                  <p className="text-sm font-medium uppercase tracking-[0.24em]">Daily workflow</p>
                </div>
                <div className="mt-4 space-y-4 text-sm leading-7 text-[#6b6258]">
                  <p>Move through inventory, opening, closing, and reporting from one place designed to feel consistent with the rest of Ojalá.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-8">
          <SectionCard
            id="inventory"
            icon={<Package2 className="h-5 w-5" />}
            title="Inventory Input"
            description="Employees can quickly update counted quantities without entering the manager dashboard."
          >
            {inventoryItemsQuery.isLoading ? (
              <p className="text-sm text-[#6b6258]">Loading inventory items…</p>
            ) : inventoryItems.length === 0 ? (
              <p className="text-sm text-[#6b6258]">No inventory items have been set up yet by management.</p>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {inventoryItems.map(item => {
                  const current = inventoryUpdates[item.id] ?? {
                    currentQuantity: String(item.currentQuantity ?? "0"),
                    notes: String(item.notes ?? ""),
                  };
                  return (
                    <div key={item.id} className="rounded-[1.5rem] border border-[#e7ddd1] bg-[#fbf7f1] p-5 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.24em] text-[#8a8176]">{item.category}</p>
                      <h3 className="mt-2 text-xl font-medium tracking-[-0.03em] text-[#2d2925]">{item.itemName}</h3>
                      <p className="mt-1 text-sm text-[#6b6258]">Par level: {item.parLevel} {item.unitLabel}</p>
                      <div className="mt-4 grid gap-4">
                        <Field label={`Current quantity (${item.unitLabel})`}>
                          <input
                            className={inputClassName()}
                            type="number"
                            min="0"
                            step="0.01"
                            value={current.currentQuantity}
                            onChange={event =>
                              setInventoryUpdates(state => ({
                                ...state,
                                [item.id]: { ...current, currentQuantity: event.target.value },
                              }))
                            }
                          />
                        </Field>
                        <Field label="Notes">
                          <textarea
                            className={textareaClassName()}
                            value={current.notes}
                            onChange={event =>
                              setInventoryUpdates(state => ({
                                ...state,
                                [item.id]: { ...current, notes: event.target.value },
                              }))
                            }
                          />
                        </Field>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() =>
                              inventoryMutation.mutate({
                                id: item.id,
                                currentQuantity: Number(current.currentQuantity || 0),
                                notes: current.notes,
                              })
                            }
                            className="rounded-full bg-[#2f2a26] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18]"
                          >
                            Save inventory update
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          <SectionCard
            id="opening"
            icon={<ClipboardCheck className="h-5 w-5" />}
            title="Ojalá Opening Checklist"
            description=""
          >
            <form
              className="grid gap-6"
              onSubmit={event => {
                event.preventDefault();
                openingMutation.mutate({
                  businessDate: openingForm.businessDate,
                  staffName: openingForm.staffName,
                  startingCash: Number(openingForm.startingCash || 0),
                  cashCountedAndCorrect: openingForm.cashCountedAndCorrect,
                  storeReadyToOpen: openingForm.storeReadyToOpen,
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
                  checklistAnswers: buildAnswersPayload(openingQuestions, openingAnswers),
                  notes: openingForm.notes,
                });
              }}
            >
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Business Date">
                  <input className={inputClassName()} type="date" value={openingForm.businessDate} onChange={event => setOpeningForm(current => ({ ...current, businessDate: event.target.value }))} />
                </Field>
                <Field label="Staff Name">
                  <input className={inputClassName()} value={openingForm.staffName} onChange={event => setOpeningForm(current => ({ ...current, staffName: event.target.value }))} />
                </Field>
                <Field label="Starting cash amount">
                  <input className={inputClassName()} type="number" min="0" step="0.01" value={openingForm.startingCash} onChange={event => setOpeningForm(current => ({ ...current, startingCash: event.target.value }))} />
                </Field>
                <Field label="Cash counted and correct">
                  <select className={inputClassName()} value={openingForm.cashCountedAndCorrect} onChange={event => setOpeningForm(current => ({ ...current, cashCountedAndCorrect: event.target.value as YesNo }))}>
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                </Field>
              </div>

              {openingQuestionsQuery.isLoading ? <p className="text-sm text-[#6b6258]">Loading opening questions…</p> : null}
              {Object.entries(groupedOpeningQuestions).map(([section, questions]) => (
                <div key={section} className="space-y-4">
                  <div className="rounded-[1.5rem] border border-[#e8ddd0] bg-[#f7f0e7] px-5 py-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-[#8a8176]">Opening section</p>
                    <h3 className="mt-2 text-xl font-medium tracking-[-0.03em] text-[#2d2925]">{section}</h3>
                  </div>
                  <div className="grid gap-4">
                    {section === "Setup" ? (
                      <div className="rounded-[1.5rem] border border-[#e8ddd0] bg-[#f7f0e7] p-5">
                        <div>
                          <p className="text-xs uppercase tracking-[0.24em] text-[#8a8176]">Counted stock at opening</p>
                          <h4 className="mt-2 text-xl font-medium tracking-[-0.03em] text-[#2d2925]">Cups, lids, spoons, and napkins</h4>
                        </div>
                        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                          {openingStockFields.map(field => (
                            <Field key={field.key} label={field.label} hint={field.group}>
                              <input
                                className={inputClassName()}
                                type="number"
                                min="0"
                                step="1"
                                value={openingForm.stockCounts[field.key]}
                                onChange={event =>
                                  setOpeningForm(current => ({
                                    ...current,
                                    stockCounts: {
                                      ...current.stockCounts,
                                      [field.key]: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </Field>
                          ))}
                          {openingNapkinsQuestion ? (
                            <Field label={openingNapkinsQuestion.prompt} hint="Setup">
                              <select
                                className={inputClassName()}
                                value={openingAnswers[openingNapkinsQuestion.id]?.answer ?? "No"}
                                onChange={event =>
                                  setOpeningAnswers(state => ({
                                    ...state,
                                    [openingNapkinsQuestion.id]: {
                                      answer: event.target.value as YesNo,
                                      detail: state[openingNapkinsQuestion.id]?.detail ?? "",
                                    },
                                  }))
                                }
                              >
                                <option value="No">No</option>
                                <option value="Yes">Yes</option>
                              </select>
                            </Field>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {questions.map(question => (
                      <ChecklistQuestionRow
                        key={question.id}
                        question={question}
                        state={openingAnswers[question.id] ?? { answer: "No", detail: "" }}
                        onChange={next => setOpeningAnswers(state => ({ ...state, [question.id]: next }))}
                      />
                    ))}
                  </div>
                </div>
              ))}

              <div className="grid gap-5 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Field label="Notes / issues">
                    <textarea className={textareaClassName()} value={openingForm.notes} onChange={event => setOpeningForm(current => ({ ...current, notes: event.target.value }))} />
                  </Field>
                </div>
              </div>

              <div className="flex justify-end">
                <button disabled={openingMutation.isPending} className="rounded-full bg-[#2f2a26] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18] disabled:cursor-not-allowed disabled:opacity-60">
                  {openingMutation.isPending ? "Submitting..." : "Submit Opening Checklist"}
                </button>
              </div>
            </form>
          </SectionCard>

          <SectionCard
            id="closing"
            icon={<MoonStar className="h-5 w-5" />}
            title="Ojalá Closing Checklist"
            description=""
          >
            <form
              className="grid gap-6"
              onSubmit={event => {
                event.preventDefault();
                closingMutation.mutate({
                  businessDate: closingForm.businessDate,
                  staffName: closingForm.staffName,
                  cashCounted: Number(closingForm.cashCounted || 0),
                  cashMatchesSystem: closingForm.cashMatchesSystem,
                  checklistAnswers: buildAnswersPayload(closingQuestions, closingAnswers),
                  notes: closingForm.notes,
                });
              }}
            >
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Business Date">
                  <input className={inputClassName()} type="date" value={closingForm.businessDate} onChange={event => setClosingForm(current => ({ ...current, businessDate: event.target.value }))} />
                </Field>
                <Field label="Staff Name">
                  <input className={inputClassName()} value={closingForm.staffName} onChange={event => setClosingForm(current => ({ ...current, staffName: event.target.value }))} />
                </Field>
                <Field label="Cash total counted">
                  <input className={inputClassName()} type="number" min="0" step="0.01" value={closingForm.cashCounted} onChange={event => setClosingForm(current => ({ ...current, cashCounted: event.target.value }))} />
                </Field>
                <Field label="Matches system?">
                  <select className={inputClassName()} value={closingForm.cashMatchesSystem} onChange={event => setClosingForm(current => ({ ...current, cashMatchesSystem: event.target.value as YesNo }))}>
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                </Field>
              </div>

              {closingQuestionsQuery.isLoading ? <p className="text-sm text-[#6b6258]">Loading closing questions…</p> : null}
              {Object.entries(groupedClosingQuestions).map(([section, questions]) => (
                <div key={section} className="space-y-4">
                  <div className="rounded-[1.5rem] border border-[#e8ddd0] bg-[#f7f0e7] px-5 py-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-[#8a8176]">Closing section</p>
                    <h3 className="mt-2 text-xl font-medium tracking-[-0.03em] text-[#2d2925]">{section}</h3>
                  </div>
                  <div className="grid gap-4">
                    {questions.map(question => (
                      <ChecklistQuestionRow
                        key={question.id}
                        question={question}
                        state={closingAnswers[question.id] ?? { answer: "No", detail: "" }}
                        onChange={next => setClosingAnswers(state => ({ ...state, [question.id]: next }))}
                      />
                    ))}
                  </div>
                </div>
              ))}

              <Field label="Notes / issues">
                <textarea className={textareaClassName()} value={closingForm.notes} onChange={event => setClosingForm(current => ({ ...current, notes: event.target.value }))} />
              </Field>

              <div className="flex justify-end">
                <button disabled={closingMutation.isPending} className="rounded-full bg-[#2f2a26] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18] disabled:cursor-not-allowed disabled:opacity-60">
                  {closingMutation.isPending ? "Submitting..." : "Submit Closing Checklist"}
                </button>
              </div>
            </form>
          </SectionCard>

          <SectionCard
            id="end-of-day"
            icon={<ReceiptText className="h-5 w-5" />}
            title="End-of-Day Report"
            description=""
          >
            <form
              className="grid gap-5 md:grid-cols-2 xl:grid-cols-4"
              onSubmit={event => {
                event.preventDefault();
                endOfDayMutation.mutate({
                  businessDate: endOfDayForm.businessDate,
                  shift: endOfDayForm.shift,
                  staffName: endOfDayForm.staffName,
                  cups4ozHere: Number(endOfDayForm.cups4ozHere || 0),
                  cups4ozToGo: Number(endOfDayForm.cups4ozToGo || 0),
                  cups8ozHere: Number(endOfDayForm.cups8ozHere || 0),
                  cups8ozToGo: Number(endOfDayForm.cups8ozToGo || 0),
                  cupsPintHere: Number(endOfDayForm.cupsPintHere || 0),
                  cupsPintToGo: Number(endOfDayForm.cupsPintToGo || 0),
                  cupsLiterHere: Number(endOfDayForm.cupsLiterHere || 0),
                  cupsLiterToGo: Number(endOfDayForm.cupsLiterToGo || 0),
                  cashTotal: Number(endOfDayForm.cashTotal || 0),
                  cardTotal: Number(endOfDayForm.cardTotal || 0),
                  zelleTotal: Number(endOfDayForm.zelleTotal || 0),
                  venmoTotal: Number(endOfDayForm.venmoTotal || 0),
                  wasteNotes: endOfDayForm.wasteNotes,
                  lowItemNotes: endOfDayForm.lowItemNotes,
                  generalNotes: endOfDayForm.generalNotes,
                });
              }}
            >
              <Field label="Date">
                <input className={inputClassName()} type="date" value={endOfDayForm.businessDate} onChange={event => setEndOfDayForm(current => ({ ...current, businessDate: event.target.value }))} />
              </Field>
              <Field label="Shift">
                <select className={inputClassName()} value={endOfDayForm.shift} onChange={event => setEndOfDayForm(current => ({ ...current, shift: event.target.value as EndOfDayForm["shift"] }))}>
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                  <option value="Full Day">Full Day</option>
                </select>
              </Field>
              <Field label="Staff Name">
                <input className={inputClassName()} value={endOfDayForm.staffName} onChange={event => setEndOfDayForm(current => ({ ...current, staffName: event.target.value }))} />
              </Field>

              <div className="rounded-[1.5rem] border border-[#e8ddd0] bg-[#fbf7f1] p-5 md:col-span-2 xl:col-span-4">
                <div className="grid gap-4 md:grid-cols-[minmax(120px,180px)_minmax(0,1fr)_minmax(0,1fr)] md:items-end">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-[#8a8176]">Cup counts sold</p>
                    <h3 className="mt-2 text-xl font-medium tracking-[-0.03em] text-[#2d2925]">Here and To Go</h3>
                  </div>
                  <span className="text-sm font-medium uppercase tracking-[0.22em] text-[#8a8176] md:text-center">Here</span>
                  <span className="text-sm font-medium uppercase tracking-[0.22em] text-[#8a8176] md:text-center">To Go</span>
                </div>
                <div className="mt-5 space-y-3">
                  {endOfDayCupRows.map(row => (
                    <div key={row.label} className="grid gap-3 rounded-2xl border border-[#eadfce] bg-white/80 p-3 md:grid-cols-[minmax(120px,180px)_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                      <span className="text-sm font-medium text-[#2f2a26]">{row.label}</span>
                      <input
                        className={smallInputClassName()}
                        type="number"
                        min="0"
                        step="1"
                        value={endOfDayForm[row.hereKey]}
                        onChange={event => setEndOfDayForm(current => ({ ...current, [row.hereKey]: event.target.value }))}
                      />
                      <input
                        className={smallInputClassName()}
                        type="number"
                        min="0"
                        step="1"
                        value={endOfDayForm[row.toGoKey]}
                        onChange={event => setEndOfDayForm(current => ({ ...current, [row.toGoKey]: event.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <Field label="Cash"><input className={inputClassName()} type="number" min="0" step="0.01" value={endOfDayForm.cashTotal} onChange={event => setEndOfDayForm(current => ({ ...current, cashTotal: event.target.value }))} /></Field>
              <Field label="Card"><input className={inputClassName()} type="number" min="0" step="0.01" value={endOfDayForm.cardTotal} onChange={event => setEndOfDayForm(current => ({ ...current, cardTotal: event.target.value }))} /></Field>
              <Field label="Venmo"><input className={inputClassName()} type="number" min="0" step="0.01" value={endOfDayForm.venmoTotal} onChange={event => setEndOfDayForm(current => ({ ...current, venmoTotal: event.target.value }))} /></Field>
              <Field label="Zelle"><input className={inputClassName()} type="number" min="0" step="0.01" value={endOfDayForm.zelleTotal} onChange={event => setEndOfDayForm(current => ({ ...current, zelleTotal: event.target.value }))} /></Field>

              <Field label="Total Sales">
                <input className={inputClassName()} type="text" value={`$${totalSales.toFixed(2)}`} readOnly />
              </Field>
              <Field label="Waste Notes"><textarea className={textareaClassName()} value={endOfDayForm.wasteNotes} onChange={event => setEndOfDayForm(current => ({ ...current, wasteNotes: event.target.value }))} /></Field>
              <div className="xl:col-span-2"><Field label="Low-Item Notes"><textarea className={textareaClassName()} value={endOfDayForm.lowItemNotes} onChange={event => setEndOfDayForm(current => ({ ...current, lowItemNotes: event.target.value }))} /></Field></div>
              <div className="xl:col-span-4"><Field label="General Notes"><textarea className={textareaClassName()} value={endOfDayForm.generalNotes} onChange={event => setEndOfDayForm(current => ({ ...current, generalNotes: event.target.value }))} /></Field></div>
              <div className="xl:col-span-4 flex justify-center">
                <button disabled={endOfDayMutation.isPending} className="w-full rounded-full bg-[#2f2a26] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18] disabled:cursor-not-allowed disabled:opacity-60">
                  {endOfDayMutation.isPending ? "Submitting..." : "Submit End-of-Day Report"}
                </button>
              </div>
            </form>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
