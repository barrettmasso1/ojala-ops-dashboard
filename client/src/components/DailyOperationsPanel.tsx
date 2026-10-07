import { Link } from "wouter";
import type { DailyOperationsView } from "@/lib/dailyOperations";

function receivedLabel(value: string | Date | null) {
  if (!value) return "Not available";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mazatlan",
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(date);
}

export default function DailyOperationsPanel({ view }: { view: DailyOperationsView }) {
  return (
    <section aria-labelledby="daily-operations-title" className="rounded-[2rem] border border-[#ded5c8] bg-white/90 p-6 shadow-sm md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[#65716b]">Daily operations · {view.businessDate}</p>
          <h2 id="daily-operations-title" className="mt-3 font-serif text-3xl text-[#1f2b27]">Sales &amp; camera evidence</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#65716b]">Use available evidence while keeping missing data and review work visible.</p>
        </div>
        <span className="w-fit rounded-full bg-[#f1e8da] px-4 py-2 text-sm font-medium text-[#52665f]">{view.cameraLabel}</span>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl bg-[#f7f2ea] p-5">
          <h3 className="text-sm text-[#52665f]">Sales entered at closing</h3>
          <p className="mt-3 text-3xl font-semibold text-[#1f2b27]">{view.salesCount ?? "—"}</p>
          <p className="mt-3 text-sm leading-6 text-[#65716b]">{view.salesCount === null ? "No valid closing count for this date." : "Reported containers across sizes. No automatic POS connection is implied."}</p>
        </div>
        <div className="rounded-2xl bg-[#f7f2ea] p-5">
          <h3 className="text-sm text-[#52665f]">Camera evidence</h3>
          <p className="mt-3 text-3xl font-semibold text-[#1f2b27]">{view.cameraValue}</p>
          <p className="mt-3 text-sm leading-6 text-[#65716b]">{view.cameraMessage}</p>
        </div>
        <div className="rounded-2xl bg-[#f7f2ea] p-5">
          <h3 className="text-sm text-[#52665f]">Difference to review</h3>
          <p className="mt-3 text-3xl font-semibold text-[#1f2b27]">{view.difference === null ? "—" : `${view.difference > 0 ? "+" : ""}${view.difference}`}</p>
          <p className="mt-3 text-sm leading-6 text-[#65716b]">{view.differenceMessage}</p>
        </div>
      </div>
      {view.gaps && <p className="mt-4 rounded-xl border border-[#e5d3a8] bg-[#fff7e5] p-4 text-sm leading-6 text-[#735825]"><strong>Coverage notes: </strong>{view.gaps}</p>}
      <div className="mt-5 flex flex-col gap-2 text-sm text-[#65716b]">
        <p>Last camera upload: {receivedLabel(view.receivedAt)} · America/Mazatlan. Upload time does not establish that the camera is online.</p>
        <p>{view.manualReference}</p>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/portal/closing" className="rounded-full bg-[#52665f] px-5 py-3 text-sm font-medium text-white">Open closing form</Link>
        <Link href="/dashboard/history" className="rounded-full border border-[#ded5c8] px-5 py-3 text-sm font-medium text-[#52665f]">Review saved reports</Link>
      </div>
    </section>
  );
}
