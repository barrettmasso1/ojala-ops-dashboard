import { useEffect, useMemo, useState } from "react";
import { CalendarClock, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { READY_MADE_GELATO_FLAVORS } from "../../../shared/opsCatalog";
import { getBusinessDate } from "../../../shared/businessDate";
import { trpc } from "@/lib/trpc";
import { loadRetroactiveClosingDraft, saveRetroactiveClosingDraft } from "@/lib/retroactiveClosingDrafts";

type ChecklistQuestion = {
  id: number;
  sectionTitle: string;
  prompt: string;
};

type WeightRow = {
  flavor: string;
  smallPanCount: string;
  smallGrossWeightKg: string;
  largePanCount: string;
  largeGrossWeightKg: string;
  combinedGrossWeightKg: string;
};

type ReportState = {
  staffName: string;
  cashCounted: string;
  cashMatchesSystem: "Yes" | "No";
  cups4ozHere: string; cups4ozToGo: string;
  cups8ozHere: string; cups8ozToGo: string;
  cupsPintHere: string; cupsPintToGo: string;
  cupsLiterHere: string; cupsLiterToGo: string;
  cashTotal: string; cardTotal: string; zelleTotal: string; venmoTotal: string;
  sampleOunces: string; wasteOunces: string;
  wasteNotes: string; lowItemNotes: string; generalNotes: string;
};

type Props = {
  storeId: number;
  adminName: string;
  currentBusinessDate: string;
  timeZone: string;
  closingQuestions: ChecklistQuestion[];
};

function previousDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day, 12));
  value.setUTCDate(value.getUTCDate() - 1);
  return getBusinessDate(value, "UTC");
}

function initialReport(adminName: string): ReportState {
  return {
    staffName: adminName, cashCounted: "", cashMatchesSystem: "Yes",
    cups4ozHere: "", cups4ozToGo: "", cups8ozHere: "", cups8ozToGo: "",
    cupsPintHere: "", cupsPintToGo: "", cupsLiterHere: "", cupsLiterToGo: "",
    cashTotal: "", cardTotal: "", zelleTotal: "", venmoTotal: "",
    sampleOunces: "", wasteOunces: "", wasteNotes: "", lowItemNotes: "", generalNotes: "",
  };
}

function initialWeights(): WeightRow[] {
  return READY_MADE_GELATO_FLAVORS.map(flavor => ({ flavor, smallPanCount: "", smallGrossWeightKg: "", largePanCount: "", largeGrossWeightKg: "", combinedGrossWeightKg: "" }));
}

function numeric(value: string, field: string) {
  if (value.trim() === "") throw new Error(`${field} is required.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${field} must be zero or greater.`);
  return parsed;
}

function integer(value: string, field: string) {
  const parsed = numeric(value, field);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} must be a whole number.`);
  return parsed;
}

export default function AdminRetroactiveClosingPanel({ storeId, adminName, currentBusinessDate, timeZone, closingQuestions }: Props) {
  const defaultDate = previousDate(currentBusinessDate);
  const [businessDate, setBusinessDate] = useState(defaultDate);
  const [mode, setMode] = useState<"weights_only" | "complete">("weights_only");
  const [reason, setReason] = useState("");
  const [source, setSource] = useState<"original_closing_form" | "operator_statement" | "historical_ledger">("operator_statement");
  const [report, setReport] = useState<ReportState>(() => initialReport(adminName));
  const [weights, setWeights] = useState<WeightRow[]>(initialWeights);
  const [answers, setAnswers] = useState<Record<number, { answer: "Yes" | "No"; detail: string }>>({});
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const statusQuery = trpc.forms.adminRetroactiveClosingStatus.useQuery({ businessDate }, { enabled: Boolean(storeId && businessDate), refetchOnWindowFocus: false });
  const saveMutation = trpc.forms.saveAdminRetroactiveClosing.useMutation({
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    setReport(initialReport(adminName));
  }, [adminName]);

  useEffect(() => {
    const draft = loadRetroactiveClosingDraft<{
      mode: "weights_only" | "complete";
      reason: string;
      source: "original_closing_form" | "operator_statement" | "historical_ledger";
      report: ReportState;
      weights: WeightRow[];
      answers: Record<number, { answer: "Yes" | "No"; detail: string }>;
    }>(storeId, businessDate);
    if (!draft) return;
    setMode(draft.data.mode); setReason(draft.data.reason); setSource(draft.data.source); setReport(draft.data.report); setWeights(draft.data.weights); setAnswers(draft.data.answers); setDraftSavedAt(draft.savedAt);
  }, [businessDate, storeId]);

  const groupedQuestions = useMemo(() => closingQuestions.reduce<Record<string, ChecklistQuestion[]>>((groups, question) => {
    groups[question.sectionTitle] = [...(groups[question.sectionTitle] ?? []), question];
    return groups;
  }, {}), [closingQuestions]);

  function updateReport<K extends keyof ReportState>(key: K, value: ReportState[K]) {
    setReport(current => ({ ...current, [key]: value }));
  }

  function updateWeight(index: number, key: keyof WeightRow, value: string) {
    setWeights(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  }

  function addFlavor() {
    setWeights(current => [...current, { flavor: "", smallPanCount: "", smallGrossWeightKg: "", largePanCount: "", largeGrossWeightKg: "", combinedGrossWeightKg: "" }]);
  }

  function buildWeights() {
    return weights.filter(row => row.flavor.trim() || row.smallPanCount || row.smallGrossWeightKg || row.largePanCount || row.largeGrossWeightKg || row.combinedGrossWeightKg).map((row, index) => ({
      flavor: row.flavor.trim(),
      smallPanCount: integer(row.smallPanCount, `Weight row ${index + 1} small-pan count`),
      smallGrossWeightKg: row.smallGrossWeightKg.trim() ? numeric(row.smallGrossWeightKg, `Weight row ${index + 1} small gross kg`) : undefined,
      largePanCount: integer(row.largePanCount, `Weight row ${index + 1} large-pan count`),
      largeGrossWeightKg: row.largeGrossWeightKg.trim() ? numeric(row.largeGrossWeightKg, `Weight row ${index + 1} large gross kg`) : undefined,
      combinedGrossWeightKg: row.combinedGrossWeightKg.trim() ? numeric(row.combinedGrossWeightKg, `Weight row ${index + 1} combined gross kg`) : undefined,
    }));
  }

  function buildReport() {
    return {
      staffName: report.staffName.trim(), cashCounted: numeric(report.cashCounted, "Cash counted"), cashMatchesSystem: report.cashMatchesSystem,
      cups4ozHere: integer(report.cups4ozHere, "4oz here"), cups4ozToGo: integer(report.cups4ozToGo, "4oz to-go"),
      cups8ozHere: integer(report.cups8ozHere, "8oz here"), cups8ozToGo: integer(report.cups8ozToGo, "8oz to-go"),
      cupsPintHere: integer(report.cupsPintHere, "Pint here"), cupsPintToGo: integer(report.cupsPintToGo, "Pint to-go"),
      cupsLiterHere: integer(report.cupsLiterHere, "Liter here"), cupsLiterToGo: integer(report.cupsLiterToGo, "Liter to-go"),
      cashTotal: numeric(report.cashTotal, "Cash sales"), cardTotal: numeric(report.cardTotal, "Card sales"), zelleTotal: numeric(report.zelleTotal, "Zelle sales"), venmoTotal: numeric(report.venmoTotal, "Venmo sales"),
      sampleOunces: numeric(report.sampleOunces, "Samples"), wasteOunces: numeric(report.wasteOunces, "Waste"),
      wasteNotes: report.wasteNotes, lowItemNotes: report.lowItemNotes, generalNotes: report.generalNotes,
    };
  }

  function saveDraft() {
    const record = saveRetroactiveClosingDraft(storeId, businessDate, { mode, reason, source, report, weights, answers });
    if (record) { setDraftSavedAt(record.savedAt); toast.success("Admin draft saved for this store/date."); }
  }

  async function submit() {
    try {
      if (!statusQuery.data) throw new Error("Read the selected date status before saving.");
      if (statusQuery.data.closingCount || statusQuery.data.reportCount || statusQuery.data.closingWeightCount || statusQuery.data.closingHistoryCount) throw new Error("This date already has closing data; no existing row can be overwritten.");
      const preparedWeights = buildWeights();
      const preparedReport = mode === "complete" ? buildReport() : undefined;
      const checklistAnswers = mode === "complete" ? closingQuestions.map(question => ({ questionId: question.id, sectionTitle: question.sectionTitle, prompt: question.prompt, answer: answers[question.id]?.answer ?? "No", detail: answers[question.id]?.detail ?? "" })) : [];
      await saveMutation.mutateAsync({ businessDate, mode, expectedRevision: statusQuery.data.revision, reason, source, staffName: adminName, checklistAnswers, report: preparedReport, weights: preparedWeights });
      toast.success(`Historical ${mode === "complete" ? "closing" : "weight-only"} capture saved for ${businessDate}.`);
      await statusQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to prepare the retroactive capture.");
    }
  }

  const status = statusQuery.data;
  const blockedByExisting = Boolean(status && (status.closingCount || status.reportCount || status.closingWeightCount || status.closingHistoryCount));
  const inputClass = "h-10 rounded-xl border border-[#d7cec0] bg-white px-3 text-sm text-[#2d2925]";
  const smallInput = (value: string, onChange: (value: string) => void, placeholder = "") => <input className={inputClass + " w-full"} type="number" min="0" step="0.01" value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />;

  return (
    <section className="rounded-[2rem] border border-[#cdbb9f] bg-[#fffaf0] p-5 shadow-sm md:p-7">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[#6d4d2c]"><ShieldCheck className="h-5 w-5" /><p className="text-xs font-semibold uppercase tracking-[0.22em]">Admin retroactive closing</p></div>
          <h2 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-[#2d2925]">Capture a past business date without touching today</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#625b53]">This path is admin-only, store-bound, create-only, and refuses to overwrite an existing closing, report, weight row, or audit. It never writes current inventory, sales, deliveries, camera data, or synthetic zeros.</p>
        </div>
        <CalendarClock className="hidden h-8 w-8 text-[#9a7447] md:block" />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <label className="grid gap-2 text-sm font-medium text-[#2f2a26]">Past business date<input className={inputClass} type="date" max={previousDate(currentBusinessDate)} value={businessDate} onChange={event => setBusinessDate(event.target.value)} /></label>
        <label className="grid gap-2 text-sm font-medium text-[#2f2a26]">Workflow<select className={inputClass} value={mode} onChange={event => setMode(event.target.value as "weights_only" | "complete")}><option value="weights_only">GUARDAR SOLO PESOS</option><option value="complete">Cierre COMPLETO</option></select></label>
        <label className="grid gap-2 text-sm font-medium text-[#2f2a26]">Evidence source<select className={inputClass} value={source} onChange={event => setSource(event.target.value as typeof source)}><option value="operator_statement">Operator statement</option><option value="original_closing_form">Original closing form</option><option value="historical_ledger">Historical ledger</option></select></label>
      </div>
      <p className="mt-3 text-xs leading-5 text-[#7d756b]">Store {storeId} · timezone {timeZone} · selected date is validated again on the server. Staff forms remain limited to the current business date.</p>

      <div className="mt-5 rounded-2xl border border-[#eadfce] bg-white/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-[#2f2a26]">Existing selected-date state</h3><button type="button" onClick={() => statusQuery.refetch()} className="inline-flex items-center gap-2 rounded-full border border-[#d7cec0] bg-white px-3 py-2 text-xs font-medium text-[#2f2a26]"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button></div>
        {statusQuery.isLoading ? <p className="mt-3 text-sm text-[#625b53]">Reading this store/date…</p> : null}
        {statusQuery.error ? <p className="mt-3 text-sm text-red-700">{statusQuery.error.message}</p> : null}
        {status ? <div className="mt-3 grid gap-2 text-sm text-[#625b53] sm:grid-cols-2 lg:grid-cols-5"><span>Opening rows: <b>{status.openingCount}</b></span><span>Closing rows: <b>{status.closingCount}</b></span><span>Report rows: <b>{status.reportCount}</b></span><span>Closing weights: <b>{status.closingWeightCount}</b></span><span>Closing audits: <b>{status.closingHistoryCount}</b></span></div> : null}
        {blockedByExisting ? <p className="mt-3 text-sm font-medium text-[#8a4b2e]">Existing closing data is preserved. This workflow is blocked for this date; Friday 23/10 must not be recreated.</p> : null}
      </div>

      <label className="mt-5 grid gap-2 text-sm font-medium text-[#2f2a26]">Specific admin reason (required)<textarea className="min-h-20 rounded-2xl border border-[#d7cec0] bg-white p-3 text-sm" value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain why the original close is being captured retroactively." /></label>

      {mode === "complete" ? (
        <>
          <div className="mt-5 space-y-5">
        <div className="rounded-2xl border border-[#eadfce] bg-white/70 p-4"><h3 className="font-semibold text-[#2f2a26]">Original closing checklist</h3><p className="mt-1 text-xs leading-5 text-[#7d756b]">Every active question is required. Answers are saved as an admin historical record, not as a generated event.</p>{Object.entries(groupedQuestions).map(([section, questions]) => <div key={section} className="mt-4"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8a8176]">{section}</p><div className="mt-2 space-y-2">{questions.map(question => <div key={question.id} className="grid gap-2 rounded-xl border border-[#eadfce] bg-white p-3 md:grid-cols-[minmax(0,1fr)_100px_minmax(0,1fr)] md:items-center"><span className="text-sm text-[#2f2a26]">{question.prompt}</span><select className={inputClass} value={answers[question.id]?.answer ?? "No"} onChange={event => setAnswers(current => ({ ...current, [question.id]: { answer: event.target.value as "Yes" | "No", detail: current[question.id]?.detail ?? "" } }))}><option value="Yes">Yes</option><option value="No">No</option></select><input className={inputClass} placeholder="Detail if needed" value={answers[question.id]?.detail ?? ""} onChange={event => setAnswers(current => ({ ...current, [question.id]: { answer: current[question.id]?.answer ?? "No", detail: event.target.value } }))} /></div>)}</div></div>)}</div></div>
        <div className="rounded-2xl border border-[#eadfce] bg-white/70 p-4"><h3 className="font-semibold text-[#2f2a26]">Original cash, sales and cup report</h3><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="grid gap-1 text-xs text-[#625b53]">Staff<input className={inputClass} value={report.staffName} onChange={event => updateReport("staffName", event.target.value)} /></label><label className="grid gap-1 text-xs text-[#625b53]">Cash counted{smallInput(report.cashCounted, value => updateReport("cashCounted", value))}</label><label className="grid gap-1 text-xs text-[#625b53]">Matches system<select className={inputClass} value={report.cashMatchesSystem} onChange={event => updateReport("cashMatchesSystem", event.target.value as "Yes" | "No")}><option>Yes</option><option>No</option></select></label>{([['4oz here','cups4ozHere'],['4oz to-go','cups4ozToGo'],['8oz here','cups8ozHere'],['8oz to-go','cups8ozToGo'],['Pint here','cupsPintHere'],['Pint to-go','cupsPintToGo'],['Liter here','cupsLiterHere'],['Liter to-go','cupsLiterToGo'],['Cash sales','cashTotal'],['Card sales','cardTotal'],['Zelle sales','zelleTotal'],['Venmo sales','venmoTotal']] as const).map(([label,key]) => <label key={key} className="grid gap-1 text-xs text-[#625b53]">{label}{smallInput(report[key], value => updateReport(key, value))}</label>)}</div><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs text-[#625b53]">Samples oz{smallInput(report.sampleOunces, value => updateReport("sampleOunces", value), "0 if explicitly recorded")}</label><label className="grid gap-1 text-xs text-[#625b53]">Waste oz{smallInput(report.wasteOunces, value => updateReport("wasteOunces", value), "0 if explicitly recorded")}</label></div><div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="grid gap-1 text-xs text-[#625b53]">Waste notes<textarea className="min-h-16 rounded-xl border border-[#d7cec0] bg-white p-2 text-sm" value={report.wasteNotes} onChange={event => updateReport("wasteNotes", event.target.value)} /></label><label className="grid gap-1 text-xs text-[#625b53]">Low-item notes<textarea className="min-h-16 rounded-xl border border-[#d7cec0] bg-white p-2 text-sm" value={report.lowItemNotes} onChange={event => updateReport("lowItemNotes", event.target.value)} /></label><label className="grid gap-1 text-xs text-[#625b53]">General notes<textarea className="min-h-16 rounded-xl border border-[#d7cec0] bg-white p-2 text-sm" value={report.generalNotes} onChange={event => updateReport("generalNotes", event.target.value)} /></label></div></div>
        </>
      ) : (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-[#6d4d2c]">Weights-only mode writes only the real historical closing weights and an audit row. It does not create a closing form, report, sales, deliveries, or current-inventory changes. Do not enter zeros for measurements you do not have.</div>
      )}

      <div className="mt-5 rounded-2xl border border-[#eadfce] bg-white/70 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-[#2f2a26]">Real closing weights</h3><p className="mt-1 text-xs leading-5 text-[#7d756b]">Enter only values from the original record. Gross kilograms are validated against pan setup; no size or sales inference is performed.</p></div><button type="button" onClick={addFlavor} className="rounded-full border border-[#d7cec0] bg-white px-3 py-2 text-xs font-medium text-[#2f2a26]">Add flavor</button></div><div className="mt-4 space-y-3">{weights.map((row, index) => <div key={`${index}-${row.flavor}`} className="grid gap-2 rounded-xl border border-[#eadfce] bg-white p-3 sm:grid-cols-6"><input className={inputClass} placeholder="Flavor" value={row.flavor} onChange={event => updateWeight(index, "flavor", event.target.value)} /><input className={inputClass} type="number" min="0" step="1" placeholder="Small pans" value={row.smallPanCount} onChange={event => updateWeight(index, "smallPanCount", event.target.value)} /><input className={inputClass} type="number" min="0" step="0.001" placeholder="Small gross kg" value={row.smallGrossWeightKg} onChange={event => updateWeight(index, "smallGrossWeightKg", event.target.value)} /><input className={inputClass} type="number" min="0" step="1" placeholder="Large pans" value={row.largePanCount} onChange={event => updateWeight(index, "largePanCount", event.target.value)} /><input className={inputClass} type="number" min="0" step="0.001" placeholder="Large gross kg" value={row.largeGrossWeightKg} onChange={event => updateWeight(index, "largeGrossWeightKg", event.target.value)} /><input className={inputClass} type="number" min="0" step="0.001" placeholder="Combined gross kg" value={row.combinedGrossWeightKg} onChange={event => updateWeight(index, "combinedGrossWeightKg", event.target.value)} /></div>)}</div></div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="text-xs leading-5 text-[#7d756b]">{draftSavedAt ? `Draft saved ${new Date(draftSavedAt).toLocaleString()}` : "Drafts are isolated by store and selected business date."}</div><div className="flex flex-wrap gap-3"><button type="button" onClick={saveDraft} className="inline-flex items-center gap-2 rounded-full border border-[#d7cec0] bg-white px-4 py-2.5 text-sm font-medium text-[#2f2a26]"><Save className="h-4 w-4" /> Save admin draft</button><button type="button" disabled={!status || statusQuery.isFetching || blockedByExisting || saveMutation.isPending} onClick={submit} className="inline-flex items-center gap-2 rounded-full bg-[#2f2a26] px-5 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">{saveMutation.isPending ? "Saving…" : "Save retroactive capture"}</button></div></div>
    </section>
  );
}
