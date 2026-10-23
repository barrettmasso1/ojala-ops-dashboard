import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { CUP_DESCRIPTION_LIMIT, CUP_SIZE_KEYS, CUP_SIZE_LABELS, type CupDescription, type CupDescriptionView, type CupSize } from "@shared/cupDescriptions";

export function CupDescriptionSummary({ items }: { items?: CupDescriptionView[] }) {
  if (!items?.length) return <p className="mt-2 text-xs text-[#68716b]">Tamaño: sin clasificar; cantidad visible sin describir.</p>;
  return <div className="mt-3 space-y-1" aria-label="Descripción de los vasos de la imagen">
    {items.map(item => <p key={item.slot} className="text-sm text-[#43554f]">
      <strong>Vaso {item.slot}:</strong> {CUP_SIZE_LABELS[item.size]}{item.source === "ai_estimate" ? " · estimación automática" : item.source === "ai_suggestion" ? " · capacidad leída por IA" : item.source === "manual" ? " · registrado manualmente" : ""}
      {item.note ? <span className="block text-xs">{item.note}</span> : null}
    </p>)}
  </div>;
}

export function CupDescriptionsEditor({ eventId, businessDate, items, revision, malformed = false }: {
  eventId: number; businessDate: string; items: CupDescriptionView[]; revision: string; malformed?: boolean;
}) {
  const asDraft = (values: CupDescriptionView[]): CupDescription[] => values.map(({slot, size, note}) => ({slot, size, note}));
  const [draft, setDraft] = useState(() => asDraft(items));
  const [baseRevision, setBaseRevision] = useState(revision);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const utils = trpc.useUtils();
  const conflict = dirty && baseRevision !== revision;
  const signature = JSON.stringify(items);
  useEffect(() => {
    if (!dirty) { setDraft(asDraft(JSON.parse(signature))); setBaseRevision(revision); }
  }, [revision, signature, dirty]);
  const save = trpc.dashboard.saveHandoffCupDescriptions.useMutation({
    onSuccess: async row => {
      setDraft(asDraft(row.cupDescriptions)); setBaseRevision(row.cupDescriptionRevision); setDirty(false);
      setNotice("Descripciones guardadas. No se modificaron ventas ni conteos diarios.");
      await Promise.all([
        utils.dashboard.handoffVisualEvents.invalidate({businessDate, status: "all", limit: 100}),
        utils.dashboard.handoffVisualEvidenceOverview.invalidate({businessDate}),
      ]);
    }, onError: error => setNotice(error.message),
  });
  const edit = (next: CupDescription[]) => { setDraft(next); setDirty(true); setNotice(""); };
  const disabled = save.isPending || malformed;
  return <section className="mt-4 rounded-2xl border border-[#d8e2da] bg-[#f4f8f3] p-4" aria-label={`Tamaños de vasos de la foto ${eventId}`}>
    <h3 className="font-medium text-[#24332f]">Descripción de cada vaso</h3>
    <p className="mt-1 text-xs leading-5 text-[#65716b]">De izquierda a derecha. La clasificación se procesa automáticamente. Las estimaciones no son capacidades medidas; sin evidencia suficiente se conserva “Sin clasificar”. Corregir aquí es opcional. Estas descripciones pertenecen a esta foto, no a entregas únicas.</p>
    {draft.map((item, index) => <div key={item.slot} className="mt-3 grid items-end gap-2 sm:grid-cols-[140px_minmax(120px,1fr)_auto]">
      <label className="text-sm">Vaso {item.slot}
        <select aria-label={`Tamaño del vaso ${item.slot} en foto ${eventId}`} value={item.size} disabled={disabled}
          onChange={e => edit(draft.map((r,i) => i === index ? {...r, size: e.target.value as CupSize} : r))}
          className="mt-1 h-10 w-full rounded-lg border border-[#dbd2c5] bg-white px-2">
          {CUP_SIZE_KEYS.map(size => <option key={size} value={size}>{CUP_SIZE_LABELS[size]}</option>)}
        </select>
      </label>
      <label className="text-sm">Detalle opcional
        <input aria-label={`Detalle del vaso ${item.slot} en foto ${eventId}`} value={item.note} maxLength={160} disabled={disabled}
          onChange={e => edit(draft.map((r,i) => i === index ? {...r, note: e.target.value} : r))}
          className="mt-1 h-10 w-full rounded-lg border border-[#dbd2c5] bg-white px-3" />
      </label>
      <button type="button" disabled={disabled} onClick={() => edit(draft.filter((_,i) => i !== index).map((r,i) => ({...r, slot:i+1})))} className="h-10 rounded-lg border px-3 text-xs">Quitar descripción</button>
    </div>)}
    {!draft.length ? <p className="mt-3 text-sm">Sin vasos descritos. Esto no significa cero entregas.</p> : null}
    {malformed ? <p role="alert" className="mt-3 text-sm text-red-700">La descripción guardada requiere revisión técnica; no se sobrescribirá.</p> : null}
    {conflict ? <p role="alert" className="mt-3 text-sm text-red-700">Otra sesión modificó la descripción. Recarga los valores antes de guardar.</p> : null}
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" disabled={disabled || draft.length >= CUP_DESCRIPTION_LIMIT} onClick={() => edit([...draft, {slot:draft.length+1, size:"unknown", note:""}])} className="rounded-full border border-[#52665f] px-4 py-2 text-sm">Añadir descripción</button>
      <button type="button" disabled={disabled || !dirty || conflict} onClick={() => save.mutate({id:eventId, expectedRevision:baseRevision, items:draft})} className="rounded-full bg-[#52665f] px-4 py-2 text-sm text-white disabled:opacity-50">{save.isPending ? "Guardando…" : "Guardar tamaños"}</button>
      {dirty ? <button type="button" disabled={disabled} onClick={() => {setDraft(asDraft(items));setBaseRevision(revision);setDirty(false);setNotice("");}} className="rounded-full border px-4 py-2 text-sm">Recargar valores</button> : null}
    </div>
    {notice ? <p role="status" className="mt-3 text-sm">{notice}</p> : null}
  </section>;
}
