import React from "react";
import { Link } from "wouter";
import type { DailyOperationsView } from "@/lib/dailyOperations";
import type { DirectionalHandoffPanelModel } from "@/lib/directionalHandoffPresentation";

function receivedLabel(value: string | Date | null, timeZone: string) {
  if (!value) return "Not available";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(date);
}

function DirectionalHandoffSection({ model }: { model: DirectionalHandoffPanelModel }) {
  return <section aria-labelledby="directional-handoff-title" className="mt-6 rounded-[1.6rem] border border-[#d8e2da] bg-[#f4f8f3] p-5 md:p-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[#52665f]">Observación local · sin IA generativa</p>
        <h3 id="directional-handoff-title" className="mt-2 font-serif text-2xl text-[#24332f]">{model.title}</h3>
        <p className="mt-2 text-sm leading-6 text-[#56635d]">{model.message}</p>
      </div>
      <span className="w-fit rounded-full border border-[#c4d6c9] bg-white px-3 py-2 text-sm font-medium text-[#52665f]">{model.label}</span>
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-2xl border border-[#d8e2da] bg-white p-4"><p className="text-xs text-[#52665f]">Trayectorias aceptadas</p><p className="mt-2 font-serif text-3xl text-[#24332f]">{model.value}</p><p className="mt-2 text-xs leading-5 text-[#66706a]">Solo intervalo observado; no es total diario.</p></div>
      <div className="rounded-2xl border border-[#d8e2da] bg-white p-4"><p className="text-xs text-[#52665f]">Intervalo observado</p><p className="mt-2 text-sm leading-6 text-[#24332f]">{model.interval}</p><p className="mt-2 text-xs text-[#66706a]">Último frame: {model.latestFrame}</p></div>
      <div className="rounded-2xl border border-[#d8e2da] bg-white p-4"><p className="text-xs text-[#52665f]">Consulta y cámara</p><p className="mt-2 text-sm leading-6 text-[#24332f]">{model.connection}</p><p className="mt-2 text-xs text-[#66706a]">{model.freshness} · Último recibo: {model.lastReceipt}</p></div>
      <div className="rounded-2xl border border-[#d8e2da] bg-white p-4"><p className="text-xs text-[#52665f]">Retenciones y huecos</p><p className="mt-2 text-sm leading-6 text-[#24332f]">Identidad: {model.identityHolds} · Huecos: {model.windowGaps}</p><p className="mt-2 text-xs text-[#66706a]">Duración huecos: {model.gapDuration} · Frames descartados: {model.droppedFrames} · Registros: {model.records}</p></div>
    </div>
    <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Tamaño</th><th className="p-2">Estimaciones provisionales</th></tr></thead><tbody>{model.sizeRows.map(row => <tr key={row.key} className="border-t border-[#d8e2da]"><td className="p-2">{row.label}</td><td className="p-2">{row.value}</td></tr>)}</tbody></table></div>
    <p className="mt-4 text-sm leading-6 text-[#8a4343]">{model.warning}</p>
    <p className="mt-2 text-xs leading-5 text-[#66706a]">No requiere aprobación de fotos ni llenado del cierre. No modifica ventas, POS, cierres manuales ni conteos físicos revisados. La identificación física única entre IDs no está certificada.</p>
  </section>;
}

export default function DailyOperationsPanel({ view, timeZone, businessDate, directional, closingUnavailable = false }: { view?: DailyOperationsView; timeZone: string; businessDate: string; directional?: DirectionalHandoffPanelModel; closingUnavailable?: boolean }) {
  const manualContent = <>
    {closingUnavailable ? <p role="alert" className="mt-6 rounded-xl border border-[#ead4d4] bg-[#fff5f5] p-4 text-sm leading-6 text-[#8a4343]">Cierre no disponible para esta consulta. Ventas, pesos y conteos físicos manuales no se rellenan con datos de la cámara.</p> : null}
    {view ? <div className="mt-6 grid gap-4 lg:grid-cols-3">
      <div className="rounded-2xl bg-[#f7f2ea] p-5">
        <h3 className="text-sm text-[#52665f]">Unidades registradas en el cierre</h3>
        <p className="mt-3 text-3xl font-semibold text-[#1f2b27]">{view.salesCount ?? "—"}</p>
        <p className="mt-3 text-sm leading-6 text-[#65716b]">{view.salesCount === null ? "Sin cierre manual registrado para esta fecha." : "Reported containers across sizes. No automatic POS connection is implied."}</p>
      </div>
      <div className="rounded-2xl bg-[#f7f2ea] p-5">
        <h3 className="text-sm text-[#52665f]">Vasos únicos revisados del turno</h3>
        <p className="mt-3 text-3xl font-semibold text-[#1f2b27]">{view.cameraValue}</p>
        <p className="mt-3 text-sm leading-6 text-[#65716b]">{view.cameraMessage}</p>
        <dl className="mt-4 space-y-2 text-sm leading-6 text-[#65716b]">
          <div><dt className="inline font-medium text-[#52665f]">Cobertura del conteo: </dt><dd className="inline">{view.cameraCoverage}</dd></div>
          <div><dt className="inline font-medium text-[#52665f]">Estado de revisión del conteo: </dt><dd className="inline">{view.cameraReviewStatus}</dd></div>
          <div><dt className="inline font-medium text-[#52665f]">Recepción del conteo: </dt><dd className="inline">{receivedLabel(view.receivedAt, timeZone)} · {timeZone}</dd></div>
        </dl>
      </div>
      <div className="rounded-2xl bg-[#f7f2ea] p-5">
        <h3 className="text-sm text-[#52665f]">Diferencia comparable</h3>
        <p className="mt-3 text-3xl font-semibold text-[#1f2b27]">{view.difference === null ? "—" : `${view.difference > 0 ? "+" : ""}${view.difference}`}</p>
        <p className="mt-3 text-sm leading-6 text-[#65716b]">{view.differenceMessage}</p>
      </div>
    </div> : null}
    {view ? <div className="mt-5 flex flex-col gap-2 text-sm text-[#65716b]">
      <p>{view.manualReference}</p>
      <p>Any future size and service-mode breakdown must keep unknown size and unknown here/to-go classification separate. Only evidence-backed nominal cup sizes may be converted to classified ounces.</p>
    </div> : null}
    {view ? <div className="mt-6 flex flex-wrap gap-3">
      <Link href="/portal/closing" className="rounded-full bg-[#52665f] px-5 py-3 text-sm font-medium text-white">Open closing form</Link>
      <Link href="/dashboard/history" className="rounded-full border border-[#ded5c8] px-5 py-3 text-sm font-medium text-[#52665f]">Review saved reports</Link>
    </div> : null}
  </>;

  return (
    <section aria-labelledby="daily-operations-title" className="rounded-[2rem] border border-[#ded5c8] bg-white/90 p-6 shadow-sm md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[#65716b]">Daily operations · {businessDate}</p>
          <h2 id="daily-operations-title" className="mt-3 font-serif text-3xl text-[#1f2b27]">{directional ? "Conteo automático del día y cierre" : "Cierre y conteo físico revisado"}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#65716b]">Daily physical counts and visual evidence are separate. Images and AI labels do not become cups, sales, or deliveries.</p>
        </div>
        <span className="w-fit rounded-full bg-[#f1e8da] px-4 py-2 text-sm font-medium text-[#52665f]">{directional ? `${directional.connection} · ${directional.label}` : view?.cameraLabel ?? "Cierre no disponible"}</span>
      </div>
      {directional ? <DirectionalHandoffSection model={directional} /> : null}
      {directional ? <details className="mt-6 rounded-2xl border border-[#ded5c8] bg-[#fcfaf6] p-5" aria-label="Cierre manual y conteo revisado (separados)">
        <summary className="cursor-pointer text-sm font-medium text-[#52665f]">Cierre manual y conteo revisado (separados)</summary>
        {manualContent}
      </details> : manualContent}
    </section>
  );
}
