import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { ClipboardCheck, MoonStar, ReceiptText, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

type OpeningForm = {
  businessDate: string;
  staffName: string;
  equipmentStatus: string;
  cleanlinessStatus: string;
  setupStatus: string;
  startingCash: string;
  cashMatchesSystem: "Yes" | "No";
  storeReadyStatus: "Yes" | "No";
  notes: string;
};

type ClosingForm = {
  businessDate: string;
  staffName: string;
  cashCounted: string;
  cashMatchesSystem: "Yes" | "No";
  cleaningStatus: string;
  productStorageStatus: string;
  storeClosedStatus: "Yes" | "No";
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

const initialOpeningForm = (): OpeningForm => ({
  businessDate: todayValue(),
  staffName: "",
  equipmentStatus: "",
  cleanlinessStatus: "",
  setupStatus: "",
  startingCash: "",
  cashMatchesSystem: "Yes",
  storeReadyStatus: "Yes",
  notes: "",
});

const initialClosingForm = (): ClosingForm => ({
  businessDate: todayValue(),
  staffName: "",
  cashCounted: "",
  cashMatchesSystem: "Yes",
  cleaningStatus: "",
  productStorageStatus: "",
  storeClosedStatus: "Yes",
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
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-[0_24px_70px_rgba(88,83,72,0.10)] backdrop-blur md:p-8">
      <div className="mb-6 flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ece4d7] text-[#52665f]">{icon}</div>
        <div>
          <h2 className="font-serif text-2xl tracking-tight text-[#1f2b27]">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#69716c]">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-[#31423d]">{label}</span>
      {children}
      {hint ? <span className="text-xs text-[#8a9089]">{hint}</span> : null}
    </label>
  );
}

function inputClassName() {
  return "h-12 rounded-2xl border border-[#dbd2c5] bg-[#fcfaf6] px-4 text-sm text-[#24332f] shadow-sm outline-none transition focus:border-[#52665f] focus:ring-4 focus:ring-[#52665f]/10";
}

function textareaClassName() {
  return "min-h-[120px] rounded-2xl border border-[#dbd2c5] bg-[#fcfaf6] px-4 py-3 text-sm text-[#24332f] shadow-sm outline-none transition focus:border-[#52665f] focus:ring-4 focus:ring-[#52665f]/10";
}

export default function EmployeePortal() {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true });
  const utils = trpc.useUtils();
  const [openingForm, setOpeningForm] = useState<OpeningForm>(initialOpeningForm);
  const [closingForm, setClosingForm] = useState<ClosingForm>(initialClosingForm);
  const [endOfDayForm, setEndOfDayForm] = useState<EndOfDayForm>(initialEndOfDayForm);

  const openingMutation = trpc.forms.submitOpening.useMutation({
    onSuccess: async () => {
      toast.success("Opening Checklist submitted.");
      setOpeningForm(initialOpeningForm());
      await utils.dashboard.daily.invalidate();
      await utils.dashboard.recentNotes.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const closingMutation = trpc.forms.submitClosing.useMutation({
    onSuccess: async () => {
      toast.success("Closing Checklist submitted.");
      setClosingForm(initialClosingForm());
      await utils.dashboard.daily.invalidate();
      await utils.dashboard.recentNotes.invalidate();
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

  const isBusy = openingMutation.isPending || closingMutation.isPending || endOfDayMutation.isPending;
  const introName = useMemo(() => user?.name?.split(" ")[0] ?? "team", [user?.name]);

  if (loading) {
    return <div className="min-h-screen bg-[#f8f4ed]" />;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(82,102,95,0.12),_transparent_34%),linear-gradient(180deg,_#fbf8f2_0%,_#f3ece1_50%,_#f9f5ee_100%)] pb-16">
      <div className="container pt-8 md:pt-12">
        <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/65 shadow-[0_28px_80px_rgba(88,83,72,0.12)] backdrop-blur">
          <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="border-b border-[#e4dccf] p-8 lg:border-b-0 lg:border-r lg:p-10">
              <p className="text-xs uppercase tracking-[0.28em] text-[#7f857d]">Daily operations portal</p>
              <h1 className="mt-4 font-serif text-4xl tracking-tight text-[#1f2b27] md:text-5xl">
                Clean submissions for calm, reliable operations.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-[#64706a]">
                Welcome back, {introName}. Use this workspace to complete the Opening Checklist, Closing Checklist, and End-of-Day Report with clarity and speed.
              </p>
              <div className="mt-8 grid gap-4 md:grid-cols-3">
                {[
                  { label: "Opening Checklist", value: "Start the day with confidence" },
                  { label: "Closing Checklist", value: "Close cleanly and accurately" },
                  { label: "End-of-Day Report", value: "Capture the full sales picture" },
                ].map(item => (
                  <div key={item.label} className="rounded-2xl border border-white/80 bg-[#fbf7f0] p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.22em] text-[#8a9089]">Workflow</p>
                    <p className="mt-2 font-medium text-[#253630]">{item.label}</p>
                    <p className="mt-2 text-sm text-[#67706a]">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-8 lg:p-10">
              <div className="rounded-[1.75rem] border border-[#e5ddd0] bg-[#f9f4ec] p-6">
                <div className="flex items-center gap-3 text-[#52665f]">
                  <Sparkles className="h-5 w-5" />
                  <p className="text-sm font-medium uppercase tracking-[0.24em]">Submission guidance</p>
                </div>
                <div className="mt-4 space-y-4 text-sm leading-6 text-[#66706a]">
                  <p>Complete each form only once the work is actually finished so the dashboard reflects reality, not intention.</p>
                  <p>For payment totals, use the exact labels <strong>Cash</strong>, <strong>Card</strong>, <strong>Zelle</strong>, and <strong>Venmo</strong>.</p>
                  <p>For cup counts, use the exact labels <strong>4oz</strong>, <strong>8oz</strong>, <strong>Pint</strong>, and <strong>Liter</strong>.</p>
                </div>
                <div className="mt-6 rounded-2xl bg-white/75 p-4 text-sm text-[#52615c] shadow-sm">
                  {user?.role === "admin"
                    ? "You are signed in with manager access, so you can use this portal and also review the dashboard."
                    : "You are signed in with employee access, so only form workflows and submissions are available."}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-8">
          <SectionCard
            icon={<ClipboardCheck className="h-5 w-5" />}
            title="Opening Checklist"
            description="Capture equipment status, cleanliness, setup, starting cash, store-ready status, and any issues that need follow-up before service begins."
          >
            <form
              className="grid gap-5 md:grid-cols-2"
              onSubmit={event => {
                event.preventDefault();
                openingMutation.mutate({
                  ...openingForm,
                  startingCash: Number(openingForm.startingCash || 0),
                });
              }}
            >
              <Field label="Business Date">
                <input className={inputClassName()} type="date" value={openingForm.businessDate} onChange={event => setOpeningForm(current => ({ ...current, businessDate: event.target.value }))} />
              </Field>
              <Field label="Staff Name">
                <input className={inputClassName()} value={openingForm.staffName} onChange={event => setOpeningForm(current => ({ ...current, staffName: event.target.value }))} />
              </Field>
              <Field label="Equipment Status" hint="Equipment status and any issues observed.">
                <textarea className={textareaClassName()} value={openingForm.equipmentStatus} onChange={event => setOpeningForm(current => ({ ...current, equipmentStatus: event.target.value }))} />
              </Field>
              <Field label="Cleanliness" hint="Counters, floors, sink, and overall presentation.">
                <textarea className={textareaClassName()} value={openingForm.cleanlinessStatus} onChange={event => setOpeningForm(current => ({ ...current, cleanlinessStatus: event.target.value }))} />
              </Field>
              <div className="md:col-span-2">
                <Field label="Setup" hint="Stocking, merchandising, and store-readiness details.">
                  <textarea className={textareaClassName()} value={openingForm.setupStatus} onChange={event => setOpeningForm(current => ({ ...current, setupStatus: event.target.value }))} />
                </Field>
              </div>
              <Field label="Starting Cash">
                <input className={inputClassName()} type="number" min="0" step="0.01" value={openingForm.startingCash} onChange={event => setOpeningForm(current => ({ ...current, startingCash: event.target.value }))} />
              </Field>
              <Field label="Cash Matches System">
                <select className={inputClassName()} value={openingForm.cashMatchesSystem} onChange={event => setOpeningForm(current => ({ ...current, cashMatchesSystem: event.target.value as "Yes" | "No" }))}>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </Field>
              <Field label="Store Ready Status">
                <select className={inputClassName()} value={openingForm.storeReadyStatus} onChange={event => setOpeningForm(current => ({ ...current, storeReadyStatus: event.target.value as "Yes" | "No" }))}>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </Field>
              <div className="md:col-span-2">
                <Field label="Notes">
                  <textarea className={textareaClassName()} value={openingForm.notes} onChange={event => setOpeningForm(current => ({ ...current, notes: event.target.value }))} />
                </Field>
              </div>
              <div className="md:col-span-2 flex justify-end">
                <button disabled={openingMutation.isPending || isBusy} className="rounded-full bg-[#52665f] px-6 py-3 text-sm font-medium text-white shadow-lg shadow-[#52665f]/20 transition hover:bg-[#43554f] disabled:cursor-not-allowed disabled:opacity-60">
                  {openingMutation.isPending ? "Submitting..." : "Submit Opening Checklist"}
                </button>
              </div>
            </form>
          </SectionCard>

          <SectionCard
            icon={<MoonStar className="h-5 w-5" />}
            title="Closing Checklist"
            description="Record closing cash, system match confirmation, cleaning completion, product storage status, store-closed status, staff name, and notes before the day ends."
          >
            <form
              className="grid gap-5 md:grid-cols-2"
              onSubmit={event => {
                event.preventDefault();
                closingMutation.mutate({
                  ...closingForm,
                  cashCounted: Number(closingForm.cashCounted || 0),
                });
              }}
            >
              <Field label="Business Date">
                <input className={inputClassName()} type="date" value={closingForm.businessDate} onChange={event => setClosingForm(current => ({ ...current, businessDate: event.target.value }))} />
              </Field>
              <Field label="Staff Name">
                <input className={inputClassName()} value={closingForm.staffName} onChange={event => setClosingForm(current => ({ ...current, staffName: event.target.value }))} />
              </Field>
              <Field label="Cash Counted">
                <input className={inputClassName()} type="number" min="0" step="0.01" value={closingForm.cashCounted} onChange={event => setClosingForm(current => ({ ...current, cashCounted: event.target.value }))} />
              </Field>
              <Field label="Cash Matches System">
                <select className={inputClassName()} value={closingForm.cashMatchesSystem} onChange={event => setClosingForm(current => ({ ...current, cashMatchesSystem: event.target.value as "Yes" | "No" }))}>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </Field>
              <Field label="Cleaning">
                <textarea className={textareaClassName()} value={closingForm.cleaningStatus} onChange={event => setClosingForm(current => ({ ...current, cleaningStatus: event.target.value }))} />
              </Field>
              <Field label="Product Storage">
                <textarea className={textareaClassName()} value={closingForm.productStorageStatus} onChange={event => setClosingForm(current => ({ ...current, productStorageStatus: event.target.value }))} />
              </Field>
              <Field label="Store Closed Status">
                <select className={inputClassName()} value={closingForm.storeClosedStatus} onChange={event => setClosingForm(current => ({ ...current, storeClosedStatus: event.target.value as "Yes" | "No" }))}>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </Field>
              <div className="md:col-span-2">
                <Field label="Notes">
                  <textarea className={textareaClassName()} value={closingForm.notes} onChange={event => setClosingForm(current => ({ ...current, notes: event.target.value }))} />
                </Field>
              </div>
              <div className="md:col-span-2 flex justify-end">
                <button disabled={closingMutation.isPending || isBusy} className="rounded-full bg-[#52665f] px-6 py-3 text-sm font-medium text-white shadow-lg shadow-[#52665f]/20 transition hover:bg-[#43554f] disabled:cursor-not-allowed disabled:opacity-60">
                  {closingMutation.isPending ? "Submitting..." : "Submit Closing Checklist"}
                </button>
              </div>
            </form>
          </SectionCard>

          <SectionCard
            icon={<ReceiptText className="h-5 w-5" />}
            title="End-of-Day Report"
            description="Log the operating date, shift, staff name, cups sold by size, payment totals, waste notes, low-item notes, and general notes to complete the business record for the day."
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
                <select className={inputClassName()} value={endOfDayForm.shift} onChange={event => setEndOfDayForm(current => ({ ...current, shift: event.target.value as "AM" | "PM" | "Full Day" }))}>
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                  <option value="Full Day">Full Day</option>
                </select>
              </Field>
              <Field label="Staff Name">
                <input className={inputClassName()} value={endOfDayForm.staffName} onChange={event => setEndOfDayForm(current => ({ ...current, staffName: event.target.value }))} />
              </Field>
              <div className="rounded-2xl border border-[#e5ddd0] bg-[#f8f2e8] px-4 py-3 text-sm text-[#657069] xl:col-span-1">
                Payment method labels are fixed as <strong>Cash</strong>, <strong>Card</strong>, <strong>Zelle</strong>, and <strong>Venmo</strong>.
              </div>

              <Field label="4oz">
                <input className={inputClassName()} type="number" min="0" step="1" value={endOfDayForm.cups4oz} onChange={event => setEndOfDayForm(current => ({ ...current, cups4oz: event.target.value }))} />
              </Field>
              <Field label="8oz">
                <input className={inputClassName()} type="number" min="0" step="1" value={endOfDayForm.cups8oz} onChange={event => setEndOfDayForm(current => ({ ...current, cups8oz: event.target.value }))} />
              </Field>
              <Field label="Pint">
                <input className={inputClassName()} type="number" min="0" step="1" value={endOfDayForm.cupsPint} onChange={event => setEndOfDayForm(current => ({ ...current, cupsPint: event.target.value }))} />
              </Field>
              <Field label="Liter">
                <input className={inputClassName()} type="number" min="0" step="1" value={endOfDayForm.cupsLiter} onChange={event => setEndOfDayForm(current => ({ ...current, cupsLiter: event.target.value }))} />
              </Field>

              <Field label="Cash">
                <input className={inputClassName()} type="number" min="0" step="0.01" value={endOfDayForm.cashTotal} onChange={event => setEndOfDayForm(current => ({ ...current, cashTotal: event.target.value }))} />
              </Field>
              <Field label="Card">
                <input className={inputClassName()} type="number" min="0" step="0.01" value={endOfDayForm.cardTotal} onChange={event => setEndOfDayForm(current => ({ ...current, cardTotal: event.target.value }))} />
              </Field>
              <Field label="Zelle">
                <input className={inputClassName()} type="number" min="0" step="0.01" value={endOfDayForm.zelleTotal} onChange={event => setEndOfDayForm(current => ({ ...current, zelleTotal: event.target.value }))} />
              </Field>
              <Field label="Venmo">
                <input className={inputClassName()} type="number" min="0" step="0.01" value={endOfDayForm.venmoTotal} onChange={event => setEndOfDayForm(current => ({ ...current, venmoTotal: event.target.value }))} />
              </Field>

              <div className="xl:col-span-2">
                <Field label="Waste Notes">
                  <textarea className={textareaClassName()} value={endOfDayForm.wasteNotes} onChange={event => setEndOfDayForm(current => ({ ...current, wasteNotes: event.target.value }))} />
                </Field>
              </div>
              <div className="xl:col-span-2">
                <Field label="Low-Item Notes">
                  <textarea className={textareaClassName()} value={endOfDayForm.lowItemNotes} onChange={event => setEndOfDayForm(current => ({ ...current, lowItemNotes: event.target.value }))} />
                </Field>
              </div>
              <div className="xl:col-span-4">
                <Field label="General Notes">
                  <textarea className={textareaClassName()} value={endOfDayForm.generalNotes} onChange={event => setEndOfDayForm(current => ({ ...current, generalNotes: event.target.value }))} />
                </Field>
              </div>
              <div className="xl:col-span-4 flex justify-end">
                <button disabled={endOfDayMutation.isPending || isBusy} className="rounded-full bg-[#52665f] px-6 py-3 text-sm font-medium text-white shadow-lg shadow-[#52665f]/20 transition hover:bg-[#43554f] disabled:cursor-not-allowed disabled:opacity-60">
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
