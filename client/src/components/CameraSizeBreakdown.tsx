import {trpc} from "@/lib/trpc";
import {CUP_SIZE_KEYS,CUP_SIZE_LABELS} from "@shared/cupDescriptions";
export function CameraSizeBreakdown({businessDate}:{businessDate:string}) {
 const query=trpc.dashboard.cameraSizeBreakdown.useQuery({businessDate},{refetchInterval:15000,refetchIntervalInBackground:true,refetchOnWindowFocus:true});
 const s=query.data;
 return <section className="rounded-[1.5rem] border border-[#d8e2da] bg-[#f4f8f3] p-5" aria-label="Desglose automático de cámara por tamaño">
  <h2 className="font-serif text-2xl text-[#24332f]">Archivo de etiquetas de fotografías (ruta anterior)</h2>
  <p className="mt-2 text-sm text-[#56635d]">{businessDate} · Observaciones de las fotos recibidas, no vasos únicos entregados. La misma copa puede aparecer en varias fotos. No se suma al registro manual ni a ventas.</p>
  {query.isLoading?<p className="mt-4">Consultando archivo de fotografías…</p>:query.error?<p className="mt-4" role="alert">Clasificación no disponible; no se sustituyen datos por ceros.</p>:!s||s.receivedImages===0?<p className="mt-4">Sin fotografías recibidas en esta ruta para esta fecha. Consulta arriba el registro local de detecciones y tamaños; este archivo no lo reemplaza.</p>:<>
   <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-[#ccd7ce]"><th className="p-2">Tamaño</th><th className="p-2">Capacidad leída</th><th className="p-2">Estimación IA</th><th className="p-2">Corregido en foto</th><th className="p-2">Total de observaciones</th></tr></thead><tbody>{CUP_SIZE_KEYS.map(key=>{const c=s.counts[key];return <tr key={key} className="border-b border-[#e0e7df]"><th className="p-2">{CUP_SIZE_LABELS[key]}</th><td className="p-2">{key==="unknown"?"—":s.includedImages?c.printed:"Sin clasificación de foto"}</td><td className="p-2">{key==="unknown"?"—":s.includedImages?c.estimated:"Sin clasificación de foto"}</td><td className="p-2">{s.includedImages?c.manual:"Sin clasificación de foto"}</td><td className="p-2 font-semibold">{s.includedImages?c.total:"Sin clasificación de foto"}</td></tr>;})}</tbody></table></div>
   <p className="mt-3 text-xs leading-5">{s.includedImages} imágenes clasificadas · {s.pendingImages} esperando clasificación · {s.excludedImages} excluidas por estado visual · {s.duplicateImages} imágenes idénticas no repetidas · {s.recoveredImages} recuperadas de video.</p>
   <p className="mt-2 text-xs leading-5">Las estimaciones por apariencia no están calibradas. “Sin clasificar” es un resultado automático válido cuando falta evidencia. Una foto sin recipientes de servicio no prueba cero ventas. Actualización cada 15 segundos.</p>
  </>}
 </section>;
}
