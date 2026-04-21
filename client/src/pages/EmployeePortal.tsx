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

type OpeningForm = {
  businessDate: string;
  staffName: string;
  startingCash: string;
  cashCountedAndCorrect: YesNo;
  storeReadyToOpen: YesNo;
  notes: string;
};

type ClosingForm = {
  businessDate: string;
  staffName: string;
  cashCounted: string;
  cashMatchesSystem: YesNo;
  storeClosedProperly: YesNo;
  notes: string;
};

type EndOfDayForm = {
  businessDate: string;
  shift: "AM" | "PM" | "Full Day";
  staffName: string;
  cups4oz: string;
  cups8oz: string;
  cupsPint: string;
  cupsLiter: string;
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

const initialOpeningForm = (): OpeningForm => ({
  businessDate: todayValue(),
  staffName: "",
  startingCash: "",
  cashCountedAndCorrect: "Yes",
  storeReadyToOpen: "Yes",
  notes: "",
});

const initialClosingForm = (): ClosingForm => ({
  businessDate: todayValue(),
  staffName: "",
  cashCounted: "",
  cashMatchesSystem: "Yes",
  storeClosedProperly: "Yes",
  notes: "",
});

const initialEndOfDayForm = (): EndOfDayForm => ({
  businessDate: todayValue(),
  shift: "AM",
  staffName: "",
  cups4oz: "0",
  cups8oz: "0",
  cupsPint: "0",
  cupsLiter: "0",
  cashTotal: "0",
  cardTotal: "0",
  zelleTotal: "0",
  venmoTotal: "0",
  wasteNotes: "",
  lowItemNotes: "",
  generalNotes: "",
});

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
          <p className="mt-2 max-w-2xl text-sm leading-7 text-[#6b6258]">{description}</p>
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
    answer: answers[question.id]?.answer ?? "Yes",
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

  const groupedOpeningQuestions = useMemo(() => {
    return openingQuestions.reduce<Record<string, ChecklistQuestion[]>>((acc, question) => {
      acc[question.sectionTitle] = [...(acc[question.sectionTitle] ?? []), question];
      return acc;
    }, {});
  }, [openingQuestions]);

  const groupedClosingQuestions = useMemo(() => {
    return closingQuestions.reduce<Record<string, ChecklistQuestion[]>>((acc, question) => {
      acc[question.sectionTitle] = [...(acc[question.sectionTitle] ?? []), question];
      return acc;
    }, {});
  }, [closingQuestions]);

  if (loading) {
    return <div className="min-h-screen bg-[#f8f4ed]" />;
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f7f1e8_0%,_#f3ece2_50%,_#f7f2ea_100%)] pb-16">
      <div className="container pt-8 md:pt-12">
        <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/70 shadow-[0_28px_80px_rgba(88,83,72,0.12)] backdrop-blur">
          <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="border-b border-[#e4dccf] p-8 lg:border-b-0 lg:border-r lg:p-10">
              <p className="text-[11px] uppercase tracking-[0.34em] text-[#7d756b]">Staff portal</p>
              <h1 className="mt-4 text-4xl font-light tracking-[-0.05em] text-[#2d2925] md:text-5xl">
                Clear daily accountability for calm operations.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-[#6a6158]">
                Welcome back, {introName}. Each checklist now asks for clear confirmation that required opening and closing actions were actually completed.
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
                  <p className="text-sm font-medium uppercase tracking-[0.24em]">Submission guidance</p>
                </div>
                <div className="mt-4 space-y-4 text-sm leading-7 text-[#6b6258]">
                  <p>Use <strong>Yes</strong> or <strong>No</strong> to confirm each required action. If something is not complete, explain it before you submit.</p>
                  <p>For payment totals, use the exact labels <strong>Cash</strong>, <strong>Card</strong>, <strong>Zelle</strong>, and <strong>Venmo</strong>.</p>
                  <p>For cup counts, use the exact labels <strong>4oz</strong>, <strong>8oz</strong>, <strong>Pint</strong>, and <strong>Liter</strong>.</p>
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
            description="Confirm each opening action explicitly so the day starts with verified readiness, not assumptions."
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
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
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
                    {questions.map(question => (
                      <ChecklistQuestionRow
                        key={question.id}
                        question={question}
                        state={openingAnswers[question.id] ?? { answer: "Yes", detail: "" }}
                        onChange={next => setOpeningAnswers(state => ({ ...state, [question.id]: next }))}
                      />
                    ))}
                  </div>
                </div>
              ))}

              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Store ready to open">
                  <select className={inputClassName()} value={openingForm.storeReadyToOpen} onChange={event => setOpeningForm(current => ({ ...current, storeReadyToOpen: event.target.value as YesNo }))}>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                </Field>
                <Field label="Notes / issues">
                  <textarea className={textareaClassName()} value={openingForm.notes} onChange={event => setOpeningForm(current => ({ ...current, notes: event.target.value }))} />
                </Field>
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
            description="Use clear yes-or-no confirmations to verify the close instead of leaving room for ambiguity."
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
                  storeClosedProperly: closingForm.storeClosedProperly,
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
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
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
                        state={closingAnswers[question.id] ?? { answer: "Yes", detail: "" }}
                        onChange={next => setClosingAnswers(state => ({ ...state, [question.id]: next }))}
                      />
                    ))}
                  </div>
                </div>
              ))}

              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Store closed properly">
                  <select className={inputClassName()} value={closingForm.storeClosedProperly} onChange={event => setClosingForm(current => ({ ...current, storeClosedProperly: event.target.value as YesNo }))}>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                </Field>
                <Field label="Notes / issues">
                  <textarea className={textareaClassName()} value={closingForm.notes} onChange={event => setClosingForm(current => ({ ...current, notes: event.target.value }))} />
                </Field>
              </div>

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
            description="Capture the structured sales picture for the day with the fixed payment and cup labels required by the dashboard."
          >
            <form
              className="grid gap-5 md:grid-cols-2 xl:grid-cols-4"
              onSubmit={event => {
                event.preventDefault();
                endOfDayMutation.mutate({
                  ...endOfDayForm,
                  cups4oz: Number(endOfDayForm.cups4oz || 0),
                  cups8oz: Number(endOfDayForm.cups8oz || 0),
                  cupsPint: Number(endOfDayForm.cupsPint || 0),
                  cupsLiter: Number(endOfDayForm.cupsLiter || 0),
                  cashTotal: Number(endOfDayForm.cashTotal || 0),
                  cardTotal: Number(endOfDayForm.cardTotal || 0),
                  zelleTotal: Number(endOfDayForm.zelleTotal || 0),
                  venmoTotal: Number(endOfDayForm.venmoTotal || 0),
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
              <div className="rounded-2xl border border-[#e5ddd0] bg-[#f8f2e8] px-4 py-3 text-sm leading-7 text-[#6a6158] xl:col-span-1">
                Payment method labels are fixed as <strong>Cash</strong>, <strong>Card</strong>, <strong>Zelle</strong>, and <strong>Venmo</strong>.
              </div>

              <Field label="4oz"><input className={inputClassName()} type="number" min="0" step="1" value={endOfDayForm.cups4oz} onChange={event => setEndOfDayForm(current => ({ ...current, cups4oz: event.target.value }))} /></Field>
              <Field label="8oz"><input className={inputClassName()} type="number" min="0" step="1" value={endOfDayForm.cups8oz} onChange={event => setEndOfDayForm(current => ({ ...current, cups8oz: event.target.value }))} /></Field>
              <Field label="Pint"><input className={inputClassName()} type="number" min="0" step="1" value={endOfDayForm.cupsPint} onChange={event => setEndOfDayForm(current => ({ ...current, cupsPint: event.target.value }))} /></Field>
              <Field label="Liter"><input className={inputClassName()} type="number" min="0" step="1" value={endOfDayForm.cupsLiter} onChange={event => setEndOfDayForm(current => ({ ...current, cupsLiter: event.target.value }))} /></Field>

              <Field label="Cash"><input className={inputClassName()} type="number" min="0" step="0.01" value={endOfDayForm.cashTotal} onChange={event => setEndOfDayForm(current => ({ ...current, cashTotal: event.target.value }))} /></Field>
              <Field label="Card"><input className={inputClassName()} type="number" min="0" step="0.01" value={endOfDayForm.cardTotal} onChange={event => setEndOfDayForm(current => ({ ...current, cardTotal: event.target.value }))} /></Field>
              <Field label="Zelle"><input className={inputClassName()} type="number" min="0" step="0.01" value={endOfDayForm.zelleTotal} onChange={event => setEndOfDayForm(current => ({ ...current, zelleTotal: event.target.value }))} /></Field>
              <Field label="Venmo"><input className={inputClassName()} type="number" min="0" step="0.01" value={endOfDayForm.venmoTotal} onChange={event => setEndOfDayForm(current => ({ ...current, venmoTotal: event.target.value }))} /></Field>

              <div className="xl:col-span-2"><Field label="Waste Notes"><textarea className={textareaClassName()} value={endOfDayForm.wasteNotes} onChange={event => setEndOfDayForm(current => ({ ...current, wasteNotes: event.target.value }))} /></Field></div>
              <div className="xl:col-span-2"><Field label="Low-Item Notes"><textarea className={textareaClassName()} value={endOfDayForm.lowItemNotes} onChange={event => setEndOfDayForm(current => ({ ...current, lowItemNotes: event.target.value }))} /></Field></div>
              <div className="xl:col-span-4"><Field label="General Notes"><textarea className={textareaClassName()} value={endOfDayForm.generalNotes} onChange={event => setEndOfDayForm(current => ({ ...current, generalNotes: event.target.value }))} /></Field></div>
              <div className="xl:col-span-4 flex justify-end">
                <button disabled={endOfDayMutation.isPending} className="rounded-full bg-[#2f2a26] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18] disabled:cursor-not-allowed disabled:opacity-60">
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
