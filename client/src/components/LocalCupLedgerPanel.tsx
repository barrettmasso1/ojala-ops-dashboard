import React from "react";
import { receptionView } from "@/lib/cameraReceptionPresentation";
import { liveQueryState } from "@/lib/dashboardLiveState";
import { sizeCategoryValue, LOCAL_CAMERA_DEVICE_ID } from "@/lib/localLedgerPresentation";
import { trpc } from "@/lib/trpc";
const labels={chico:"Chico (4 oz)",mediano:"Mediano (8 oz)",pint:"Pint",litro:"Litro",unknown:"Sin clasificar"} as const;
const verificationLabel=(value:string)=>value==="same_frame_local_cv"?"Copa y persona validadas localmente":value==="detector_rejected"?"Descartado por detector":"Detección pendiente de evidencia de la misma escena";

/** This panel never modifies sales, manual records, or certified daily counts. */
export function LocalCupLedgerPanel({businessDate}:{businessDate:string}) {
  const query=trpc.dashboard.localCupLedger.useQuery({businessDate,deviceId:LOCAL_CAMERA_DEVICE_ID},{refetchInterval:5000,refetchOnWindowFocus:true,refetchOnReconnect:true,refetchIntervalInBackground:true,retry:false});
  const view=receptionView(query.data,businessDate);
  const data=view.data;
  const preservedDuringError=Boolean(query.error && data);
  const queryState=liveQueryState({isLoading:query.isLoading,hasData:Boolean(data),hasError:Boolean(query.error)});
  const lastSuccessfulQueryAt=query.dataUpdatedAt>0?query.dataUpdatedAt:null;
  return <section id="camera-live-data" aria-label="Registro autónomo de detecciones locales" className="rounded-[1.6rem] border border-[#d8e2da] bg-[#f4f8f3] p-5 md:p-6">
    <p className="text-xs uppercase tracking-[0.2em] text-[#52665f]">Detector local · sin IA generativa</p>
    <h2 className="mt-2 font-serif text-2xl text-[#24332f]">Cámara: detecciones y tamaños recibidos</h2>
    <p className="mt-3 text-sm leading-6 text-[#56635d]">{businessDate} · Actualización automática cada 5 segundos. Estos registros no dependen del cierre manual. Una detección no demuestra una venta ni una entrega única.</p>
    {query.isLoading && !data?<p className="mt-4 text-sm">Consultando el registro local recibido…</p>:
     query.error && !data?<p role="status" className="mt-4 text-sm text-[#8a4343]">No se pudo verificar la sincronización del registro. Los datos locales se conservan; no se presentan como cero.</p>:
     !data?<p role="status" className="mt-4 text-sm text-[#805e2f]">{view.state==="wrong_date" ? "La respuesta corresponde a otra fecha; no se mezclan jornadas." : view.state==="invalid" ? "La respuesta de cámara no es verificable; no se sustituyen datos por ceros." : "Sin registro de detecciones recibido para esta fecha. Esto no significa cero copas."}</p>:<>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Estado del registro recibido">
       <span className="rounded-full border border-[#c4d6c9] bg-white px-3 py-2 text-sm">{preservedDuringError ? "Datos conservados; consulta actual sin confirmar" : "Registro recibido"}</span>
       <span className="rounded-full border border-[#c4d6c9] bg-white px-3 py-2 text-sm">Consulta: {queryState === "live" ? "recibiendo" : queryState === "stale" ? "último dato conservado" : queryState === "offline" ? "sin conexión" : "consultando"}</span>
       <span className="rounded-full border border-[#c4d6c9] bg-white px-3 py-2 text-sm">{view.state==="received" ? `${view.classified} observaciones con tamaño asignado` : ""}</span>
       <span className="rounded-full border border-[#c4d6c9] bg-white px-3 py-2 text-sm">{data.sizeBreakdown.unknown} sin tamaño identificado</span>
      </div>
      {preservedDuringError && <p role="alert" className="mt-3 text-sm text-[#8a4343]">La última consulta falló. Se conservan abajo los últimos datos recibidos de esta fecha, no una lectura actualizada.</p>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[['Detecciones registradas',data.detectedTracks],['Observaciones de copa utilizables',data.locallyVerifiedTargets],['Sin evidencia de la misma escena',data.withoutSameFrameEvidence],['Excluidos por tu revisión',data.ownerExcludedTargets]].map(([label,value])=><div key={label} className="rounded-2xl border border-[#d8e2da] bg-white p-4"><p className="text-xs text-[#52665f]">{label}</p><p className="mt-2 font-serif text-3xl">{value}</p></div>)}
      </div>
      <p className="mt-3 text-sm text-[#52665f]">Referencias de tamaño confirmadas por ti: {data.ownerConfirmedSizeTargets}. Estimaciones nuevas del clasificador local: {data.automaticallyEstimatedSizeTargets}. Objetos excluidos por tu revisión: {data.ownerExcludedTargets}. Las exclusiones conservan el registro original y no se suman como copas.</p>
      <p className="mt-3 text-xs leading-5 text-[#66706a]">Última consulta exitosa: {lastSuccessfulQueryAt ? new Date(lastSuccessfulQueryAt).toLocaleString('es-MX',{timeZone:'America/Mazatlan'}) : "—"} · Último evento recibido: {new Date(data.receivedAt).toLocaleString('es-MX',{timeZone:'America/Mazatlan'})} · America/Mazatlan. Registro versión {data.sequence}. El total diario de entregas permanece separado.</p>
      {data.potentialRepeatedTracks>0 && <p className="mt-3 text-sm text-[#805e2f]">{data.potentialRepeatedTracks} seguimientos podrían repetir una copa anterior. Se conservan como advertencias, sin restarlos ni fusionarlos automáticamente.</p>}
      <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Tamaño</th><th className="p-2">Observaciones utilizables por tamaño</th></tr></thead><tbody>{Object.entries(labels).map(([size,label])=><tr key={size} className="border-t border-[#d8e2da]"><td className="p-2">{label}</td><td className="p-2">{sizeCategoryValue(data.sizeBreakdown[size as keyof typeof labels],data.sizeBreakdown.unknown,size === "unknown")}</td></tr>)}</tbody></table></div>
      <p className="mt-3 text-xs leading-5 text-[#66706a]">Este es el desglose actual del registro local, independiente del archivo de fotografías. Las etiquetas que confirmaste se muestran como “Referencia confirmada”. Las clasificaciones de nuevas imágenes se muestran como “Estimación local”. Sin referencias suficientes o ante una coincidencia dudosa se conserva Sin clasificar. No se completa con ventas ni se convierte en entregas únicas. Las coincidencias por plantilla se identifican como provisionales; las clases con pocas referencias no tienen precisión general validada.</p>
      <details className="mt-5"><summary className="cursor-pointer text-sm font-medium">Ver cada detección ({data.records.length})</summary>
        <div className="mt-3 max-h-96 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Identificador original</th><th className="p-2">Inicio</th><th className="p-2">Estado</th><th className="p-2">Tamaño</th></tr></thead><tbody>{data.records.map(r=><tr key={r.id} className="border-t border-[#d8e2da]"><td className="p-2 font-mono">{r.sourceEventId}</td><td className="p-2">{new Date(r.startedAt).toLocaleTimeString('es-MX',{timeZone:'America/Mazatlan'})}</td><td className="p-2">{r.ownerExcluded ? "No es copa: excluido por tu revisión" : verificationLabel(r.verification)}{r.possibleRepeatOf.length>0 ? " · Posible repetición" : ""}</td><td className="p-2">{r.ownerExcluded ? "No aplica" : labels[r.size]}{r.ownerConfirmedSize ? " · referencia confirmada" : r.size !== "unknown" ? " · estimación local" : ""}</td></tr>)}</tbody></table></div>
      </details>
    </>}
  </section>;
}
