import React from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { LOCAL_CAMERA_DEVICE_ID } from "@/lib/localLedgerPresentation";
import { buildManualCameraComparison } from "@/lib/manualCameraComparison";

function display(value: number | null | undefined) {
  return value == null ? "No disponible" : String(value);
}

function signed(value: number | null) {
  return value == null ? "No disponible" : `${value > 0 ? "+" : ""}${value}`;
}

/** Read-only reconciliation. Camera observations never become sales or physical cups here. */
export function ManualCameraComparisonPanel({ businessDate }: { businessDate: string }) {
  const query = trpc.dashboard.manualCameraComparison.useQuery(
    { businessDate, deviceId: LOCAL_CAMERA_DEVICE_ID },
    { refetchInterval: 5000, refetchOnWindowFocus: true, refetchOnReconnect: true, refetchIntervalInBackground: true, retry: false },
  );
  const data = query.data ? buildManualCameraComparison(query.data) : null;
  const preserved = Boolean(query.error && data);

  return (
    <section aria-label="Comparativa de cierre manual y cámara" className="rounded-[2rem] border border-[#d8e2da] bg-white/90 p-6 shadow-sm md:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[#52665f]">Comparativa operativa · {businessDate}</p>
          <h2 className="mt-3 font-serif text-3xl text-[#1f2b27]">Cierre manual y cámara, lado a lado</h2>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-[#65716b]">El cierre manual conserva sus unidades y modos de servicio. La cámara nativa conserva observaciones; no son ventas, entregas ni vasos físicos deduplicados. La actualización es automática cada 5 segundos y no modifica registros.</p>
        </div>
        {preserved && <span role="status" className="w-fit rounded-full border border-[#e5d3a8] bg-[#fff7e5] px-4 py-2 text-sm text-[#735825]">Datos conservados; la consulta actual no se confirmó.</span>}
      </div>

      {query.isLoading && !data ? <p className="mt-6 text-sm text-[#65716b]">Consultando fuentes existentes…</p> :
        query.error && !data ? <p role="status" className="mt-6 rounded-xl border border-[#e9caca] bg-[#fff4f4] p-4 text-sm text-[#8a4343]">No se pudo cargar la comparación. No se muestran ceros en sustitución de las fuentes pendientes.</p> :
          data ? <>
            <div className="mt-6 grid gap-4 xl:grid-cols-3">
              <article className="rounded-2xl border border-[#e5ddd0] bg-[#fbf7f0] p-5">
                <p className="text-xs uppercase tracking-[0.16em] text-[#8b9088]">Cierre manual</p>
                <p className="mt-3 text-2xl font-semibold text-[#24332f]">{display(data.manual.total)}</p>
                <p className="mt-2 text-sm leading-6 text-[#65716b]">Unidades registradas en el cierre manual. No se afirma conexión a POS o Shopify.</p>
              </article>
              <article className="rounded-2xl border border-[#d8e2da] bg-[#f4f8f3] p-5">
                <p className="text-xs uppercase tracking-[0.16em] text-[#52665f]">Cámara nativa</p>
                <p className="mt-3 text-2xl font-semibold text-[#24332f]">{data.native.received ? data.native.usableObservations : "No disponible"}</p>
                <p className="mt-2 text-sm leading-6 text-[#65716b]">{data.native.received ? `${data.native.detectedTracks} seguimientos; ${data.native.possibleRepeats} posibles repeticiones sin fusionar.` : data.native.reason}</p>
              </article>
              <article className="rounded-2xl border border-[#e5ddd0] bg-[#fbf7f0] p-5">
                <p className="text-xs uppercase tracking-[0.16em] text-[#8b9088]">Conteo físico revisado</p>
                <p className="mt-3 text-2xl font-semibold text-[#24332f]">{display(data.physical.value)}</p>
                <p className="mt-2 text-sm leading-6 text-[#65716b]">{data.physical.reason}</p>
              </article>
            </div>

            <div className="mt-6 rounded-2xl border border-[#d8e2da] bg-[#f7fbf7] p-5">
              <h3 className="font-medium text-[#24332f]">Seis categorías del cierre manual</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {data.manual.rows.map(row => <div key={row.key} className="rounded-xl border border-[#d8e2da] bg-white px-4 py-3"><p className="text-xs text-[#65716b]">{row.label}</p><p className="mt-1 text-xl font-semibold">{display(row.value)}</p></div>)}
              </div>
              {!data.manual.available && <p className="mt-4 text-sm text-[#805e2f]">No se completa con valores de la cámara cuando falta, se duplica o no es consistente el cierre manual.</p>}
            </div>

            <div className="mt-6 overflow-x-auto rounded-2xl border border-[#e5ddd0]">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-[#fbf7f0] text-[#52665f]"><tr><th className="p-4">Tamaño</th><th className="p-4">Cierre manual</th><th className="p-4">Observaciones nativas</th><th className="p-4">Diferencia / %</th><th className="p-4">Estado</th></tr></thead>
                <tbody>
                  {data.sizeRows.map(row => <tr key={row.key} className="border-t border-[#e5ddd0]"><td className="p-4 font-medium text-[#24332f]">{row.label}</td><td className="p-4">{display(row.manual)}</td><td className="p-4">{display(row.nativeObservations)}</td><td className="p-4">No disponible</td><td className="p-4 text-[#65716b]">{row.reason}</td></tr>)}
                  <tr className="border-t border-[#e5ddd0]"><td className="p-4 font-medium text-[#24332f]">Sin clasificar</td><td className="p-4">No aplica</td><td className="p-4">{data.native.received && data.native.sizes ? data.native.sizes.unknown : "No disponible"}</td><td className="p-4">No disponible</td><td className="p-4 text-[#65716b]">Capacidad no confirmada; no se reparte entre tamaños.</td></tr>
                  <tr className="border-t border-[#e5ddd0]"><td className="p-4 font-medium text-[#24332f]">Modo de servicio cámara</td><td className="p-4">Aquí / Para llevar</td><td className="p-4">No disponible</td><td className="p-4">No disponible</td><td className="p-4 text-[#65716b]">{data.native.received ? data.native.serviceMode : "No disponible sin registro nativo verificable."}</td></tr>
                </tbody>
              </table>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl bg-[#f7f2ea] p-5"><p className="text-xs uppercase tracking-[0.16em] text-[#8b9088]">Diferencia comparable</p><p className="mt-3 text-3xl font-semibold text-[#1f2b27]">{signed(data.difference)}</p><p className="mt-2 text-sm leading-6 text-[#65716b]">{data.comparisonReason}</p>{data.percentage !== null && <p className="mt-2 text-sm text-[#52665f]">{(data.percentage * 100).toFixed(1)}% del cierre manual.</p>}</div>
              <div className="rounded-2xl bg-[#f7f2ea] p-5"><p className="text-xs uppercase tracking-[0.16em] text-[#8b9088]">Shopify</p><p className="mt-3 text-xl font-semibold text-[#1f2b27]">No disponible</p><p className="mt-2 text-sm leading-6 text-[#65716b]">{data.shopify.reason}</p></div>
            </div>
            <div className="mt-6"><Link href={data.evidenceHref} className="inline-flex rounded-full border border-[#52665f] px-5 py-3 text-sm font-medium text-[#43554f] hover:bg-[#f4f8f3]">Ver detalle de evidencias</Link></div>
          </> : null}
    </section>
  );
}
