import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { parseReviewedCountImport, REVIEWED_COUNT_IMPORT_LIMIT } from "@shared/reviewedCountImport";

export default function ReviewedCountImport({ businessDate }: { businessDate: string }) {
  const utils = trpc.useUtils();
  const [loaded, setLoaded] = useState<{ text: string; count: number; coverage: string; reviewer: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const mutation = trpc.dashboard.importReviewedCameraCount.useMutation();

  async function load(file?: File) {
    setLoaded(null); setConfirmed(false); setMessage(""); mutation.reset();
    if (!file) return;
    try {
      if (file.size > REVIEWED_COUNT_IMPORT_LIMIT) throw new Error("El archivo supera 256 KiB.");
      const text = await file.text();
      const { record } = parseReviewedCountImport(text);
      if (record.businessDate !== businessDate) throw new Error(`Selecciona primero la fecha ${record.businessDate}.`);
      setLoaded({ text, count: record.cupsDetected, coverage: record.coverage, reviewer: record.reviewedBy });
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo leer el archivo."); }
  }

  async function submit() {
    if (!loaded || !confirmed) return;
    try {
      const receipt = await mutation.mutateAsync({ importJson: loaded.text, evidenceReviewed: true });
      await utils.dashboard.daily.invalidate({ businessDate });
      setMessage(`Guardado y leído de vuelta: ${receipt.cupsDetected} vasos, cobertura ${receipt.coverage}. Fecha ${receipt.businessDate}.`);
      setLoaded(null); setConfirmed(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se confirmó la recepción. Conserva el archivo."); }
  }

  return <details className="rounded-3xl border border-[#dce3db] bg-white p-5">
    <summary className="cursor-pointer font-semibold text-[#244536]">Importar un conteo de cámara revisado</summary>
    <p className="my-3 text-sm text-[#65716b]">Carga el archivo de conteo revisado exportado por Beelink para {businessDate}. Conserva su fecha, tienda y procedencia. Las fotos y los tracks no son un conteo aprobado. Esta importación no confirma el envío automático.</p>
    <input aria-label="Archivo de conteo revisado" type="file" accept="application/json,.json" disabled={mutation.isPending} onChange={event => void load(event.target.files?.[0])} />
    {loaded && <div className="mt-3 space-y-3">
      <p>{loaded.count} vasos · Cobertura: {loaded.coverage} · Revisado por: {loaded.reviewer}</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={mutation.isPending} onChange={event => setConfirmed(event.target.checked)} />He comprobado el conteo y su evidencia. Entiendo que no registra ventas ni onzas.</label>
      <button className="rounded-full bg-[#244536] px-4 py-2 text-white disabled:opacity-50" disabled={!confirmed || mutation.isPending} onClick={() => void submit()}>{mutation.isPending ? "Guardando…" : "Importar conteo revisado"}</button>
    </div>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    {mutation.data && <button className="mt-3 underline" onClick={() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(mutation.data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `Ojala_acuse_importacion_${mutation.data!.businessDate}.json`; link.click(); URL.revokeObjectURL(url);
    }}>Descargar acuse</button>}
  </details>;
}
