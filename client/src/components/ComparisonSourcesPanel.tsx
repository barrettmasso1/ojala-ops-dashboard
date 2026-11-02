import React, { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import type { ComparisonCategory, ComparisonSourcesView } from "../../../server/comparisonSources";
import { trpc } from "@/lib/trpc";
import { sizeCategoryValue } from "@/lib/localLedgerPresentation";
import { businessDateForStoreInstant, buildManualComparisonDraft, COMPARISON_CATEGORY_LABELS, comparisonViewMatchesScope, intervalsHaveExactCommonCoverage, parseOptionalNonNegativeInteger, storeLocalDateTimeToIso } from "@/lib/comparisonSourcesUi";

const CATEGORY_KEYS: ComparisonCategory[] = ["chico_here", "chico_togo", "mediano_here", "mediano_togo", "pint_togo", "litro_togo"];
type SourceForm = { sourceName: string; startedAt: string; endedAt: string; categories: Record<ComparisonCategory, string> };
type IntervalForm = Pick<SourceForm, "sourceName" | "startedAt" | "endedAt">;
const emptyForm = (): SourceForm => ({ sourceName: "", startedAt: "", endedAt: "", categories: { chico_here: "", chico_togo: "", mediano_here: "", mediano_togo: "", pint_togo: "", litro_togo: "" } });

function displayCount(value: number | null | undefined) { return value == null ? "Sin dato" : String(value); }
function formatTime(value: string, timeZone: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("es-MX", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(date) : "Intervalo no verificable";
}
function toInterval(form: IntervalForm, timeZone: string, businessDate: string) {
  const startedAt = storeLocalDateTimeToIso(form.startedAt, timeZone);
  const endedAt = storeLocalDateTimeToIso(form.endedAt, timeZone);
  if (!startedAt || !endedAt || Date.parse(startedAt) >= Date.parse(endedAt) || Date.parse(endedAt) > Date.now()) return null;
  if (businessDateForStoreInstant(startedAt, timeZone) !== businessDate || businessDateForStoreInstant(endedAt, timeZone) !== businessDate) return null;
  return { startedAt, endedAt };
}
function resolvedCounts(form: SourceForm) {
  const parsed = CATEGORY_KEYS.map(key => [key, parseOptionalNonNegativeInteger(form.categories[key])] as const);
  return { valid: parsed.every(([, item]) => item.valid), categories: Object.fromEntries(parsed.map(([key, item]) => [key, item.value])) as Record<ComparisonCategory, number | null> };
}
function matchesSourceScope(document: ComparisonSourcesView | undefined, storeId: number | undefined, businessDate: string) {
  return comparisonViewMatchesScope(document, storeId, businessDate);
}

function SourceCounts({ title, source, timeZone }: { title: string; source: NonNullable<ComparisonSourcesView["document"]>["manualIndependent"]; timeZone: string }) {
  if (!source) return <p className="mt-3 text-sm text-[#68716b]">Sin registro para esta fuente en la fecha seleccionada.</p>;
  return <div className="mt-3">
    <p className="text-sm font-medium text-[#31423d]">{title}: {source.sourceName}</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {COMPARISON_CATEGORY_LABELS.map(item => <div key={item.key} className="rounded-xl border border-[#e5ddd0] bg-white px-3 py-2"><p className="text-xs text-[#68716b]">{item.label}</p><p className="mt-1 font-semibold text-[#24332f]">{displayCount(source.categories[item.key])}</p></div>)}
    </div>
    <p className="mt-3 text-xs leading-5 text-[#68716b]">Intervalo local de tienda: {formatTime(source.interval.startedAt, timeZone)} – {formatTime(source.interval.endedAt, timeZone)}.</p>
    <p className="mt-1 break-all text-xs leading-5 text-[#68716b]">{source.sourceKind === "shopify_csv" ? "SHA-256 del contenido CSV" : "SHA-256 de la declaración (no prueba la fuente física)"}: <code>{source.contentSha256}</code></p>
  </div>;
}

function StoreInterval({ sourceName, startedAt, endedAt, timeZone, onSourceName, onStartedAt, onEndedAt }: {
  sourceName: string; startedAt: string; endedAt: string; timeZone: string;
  onSourceName: (value: string) => void; onStartedAt: (value: string) => void; onEndedAt: (value: string) => void;
}) {
  const inputClass = "mt-1 w-full rounded-lg border border-[#d7cec0] bg-white px-3 py-2 text-sm text-[#24332f] focus:outline-none focus:ring-2 focus:ring-[#7d9a8d]";
  return <div className="grid gap-3 sm:grid-cols-3">
    <label className="text-xs font-medium text-[#52665f]">Fuente original o nombre descriptivo<input className={inputClass} value={sourceName} maxLength={160} onChange={event => onSourceName(event.target.value)} placeholder="Ej. libreta del turno / Shopify export" /></label>
    <label className="text-xs font-medium text-[#52665f]">Inicio del intervalo · {timeZone}<input className={inputClass} type="datetime-local" step="1" value={startedAt} onChange={event => onStartedAt(event.target.value)} /></label>
    <label className="text-xs font-medium text-[#52665f]">Fin del intervalo · {timeZone}<input className={inputClass} type="datetime-local" step="1" value={endedAt} onChange={event => onEndedAt(event.target.value)} /></label>
  </div>;
}

export function ComparisonSourcesPanel({ businessDate, storeId, timeZone }: { businessDate: string; storeId?: number; timeZone: string }) {
  const utils = trpc.useUtils();
  const [manual, setManual] = useState<SourceForm>(emptyForm);
  const [shopify, setShopify] = useState({ sourceName: "", startedAt: "", endedAt: "" });
  const [fileError, setFileError] = useState<string | null>(null);
  const sourcesQuery = trpc.dashboard.comparisonSources.useQuery({ businessDate }, { enabled: storeId != null, refetchInterval: 5000, refetchOnWindowFocus: true, refetchOnReconnect: true, refetchIntervalInBackground: true, retry: false });
  const cameraQuery = trpc.dashboard.localCupLedger.useQuery({ businessDate, deviceId: "38395f07-90c9-4ab4-a47e-a8881a3498fb" }, { enabled: storeId != null, refetchInterval: 5000, refetchOnWindowFocus: true, refetchOnReconnect: true, refetchIntervalInBackground: true, retry: false });
  useEffect(() => {
    setManual(emptyForm());
    setShopify({ sourceName: "", startedAt: "", endedAt: "" });
    setFileError(null);
    if (storeId != null) {
      void sourcesQuery.refetch();
      void cameraQuery.refetch();
    }
  }, [businessDate, storeId, timeZone]);
  const saveManualMutation = trpc.dashboard.saveIndependentManualComparison.useMutation({ onSuccess: async () => { toast.success("Tally manual independiente guardado y leído de vuelta."); await utils.dashboard.comparisonSources.invalidate({ businessDate }); }, onError: error => toast.error(error.message) });
  const saveShopifyMutation = trpc.dashboard.saveShopifyComparison.useMutation({ onSuccess: async () => { toast.success("Agregados Shopify guardados y leídos de vuelta; el CSV no se conserva."); setFileError(null); await utils.dashboard.comparisonSources.invalidate({ businessDate }); }, onError: error => { setFileError(error.message); toast.error(error.message); } });

  const sourceData = matchesSourceScope(sourcesQuery.data, storeId, businessDate) ? sourcesQuery.data : undefined;
  const cameraAbsent = cameraQuery.data === null && storeId != null;
  const cameraData = cameraQuery.data?.storeId === storeId && cameraQuery.data?.businessDate === businessDate ? cameraQuery.data : undefined;
  const sourceScopeMismatch = Boolean(sourcesQuery.data && !sourceData);
  const cameraScopeMismatch = Boolean(cameraQuery.data && !cameraData);
  const sourcesStale = Boolean(sourcesQuery.error && sourceData);
  const cameraStale = Boolean(cameraQuery.error && cameraData);
  const sourceReadFailed = Boolean(sourcesQuery.error || sourceData?.availability === "unavailable" || sourceScopeMismatch);
  const sourceReadPending = !storeId || (sourcesQuery.isLoading && !sourceData);
  const manualSourceAbsent = sourceData?.availability === "absent" || (sourceData?.availability === "available" && !sourceData.document?.manualIndependent);
  const shopifySourceAbsent = sourceData?.availability === "absent" || (sourceData?.availability === "available" && !sourceData.document?.shopify);
  const manualCounts = useMemo(() => resolvedCounts(manual), [manual]);
  const manualDraft = useMemo(() => buildManualComparisonDraft({ businessDate, timeZone, ...manual }), [businessDate, manual, timeZone]);
  const shopifyInterval = useMemo(() => toInterval(shopify, timeZone, businessDate), [shopify, timeZone, businessDate]);
  const canCreateIfMissing = sourceData?.availability === "absent" || sourceData?.availability === "unavailable" || Boolean(sourcesQuery.error);
  const expectedRevision = sourceData?.availability === "available" && !sourcesQuery.error ? sourceData.revision : null;

  async function saveManual() {
    if (!storeId || !manualDraft) return;
    await saveManualMutation.mutateAsync({ ...manualDraft, expectedRevision: expectedRevision ?? null });
  }

  async function handleShopifyUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 1_000_000) throw new Error("El CSV excede el límite de 1 MB.");
      const interval = shopifyInterval;
      if (!storeId || !interval) throw new Error("Completa un intervalo válido en hora local de tienda antes de cargar el CSV.");
      const csvText = await file.text();
      await saveShopifyMutation.mutateAsync({ businessDate, expectedRevision: expectedRevision ?? null, sourceName: shopify.sourceName.trim() || file.name, interval, csvText });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo leer o guardar el CSV Shopify.";
      setFileError(message);
      toast.error(message);
    } finally {
      event.target.value = "";
      saveShopifyMutation.reset();
    }
  }

  const intervalMatch = intervalsHaveExactCommonCoverage(sourceData?.document?.manualIndependent?.interval, sourceData?.document?.shopify?.interval);

  return <section aria-label="Comparación persistida de tally manual, Shopify y cámara" className="mt-6 rounded-[1.5rem] border border-[#d8e2da] bg-[#fcfaf6] p-5 shadow-sm">
    <p className="text-xs uppercase tracking-[0.2em] text-[#52665f]">Comparación por fuente · {businessDate}</p>
    <h3 className="mt-2 font-serif text-2xl text-[#1f2b27]">Manual independiente · Shopify · cámara</h3>
    <p className="mt-2 text-sm leading-6 text-[#65716b]">El tally manual es una declaración del operador, no se rellena con el cierre EOD y su hash no certifica la exactitud de las rayitas. Shopify es un CSV importado. La cámara aporta observaciones y clasificaciones, nunca ventas ni entregas únicas; no asigna aquí/para llevar.</p>

    {sourcesQuery.isLoading && !sourceData ? <p className="mt-4 text-sm text-[#68716b]">Consultando comparación persistida…</p> : null}
    {sourcesStale ? <p role="status" className="mt-4 rounded-xl border border-[#e5d3a8] bg-[#fff7e5] p-3 text-sm text-[#735825]">Lectura actual fallida; se conservan solamente datos cacheados de esta misma tienda y fecha.</p> : null}
    {sourceScopeMismatch ? <p role="status" className="mt-4 rounded-xl border border-[#e9caca] bg-[#fff4f4] p-3 text-sm text-[#8a4343]">Respuesta de comparación de otra tienda o fecha descartada; no se muestran sus valores.</p> : null}
    {sourcesQuery.error && !sourceData ? <p role="status" className="mt-4 rounded-xl border border-[#e9caca] bg-[#fff4f4] p-3 text-sm text-[#8a4343]">Falló la lectura de la comparación; no se puede concluir que falte el registro ni mostrar ceros. Se permite intentar una creación condicional segura; si ya existe, no se sobrescribe y puede requerir recargar.</p> : null}
    {sourceData?.availability === "unavailable" && !sourcesQuery.error ? <p role="status" className="mt-4 rounded-xl border border-[#e9caca] bg-[#fff4f4] p-3 text-sm text-[#8a4343]">Lectura del storage no disponible; no equivale a ausencia ni a ceros. El primer guardado es create-only; un conflicto requiere volver a consultar.</p> : null}
    {sourceData?.availability === "absent" ? <p className="mt-4 text-sm text-[#68716b]">No hay documento persistido para esta tienda/fecha. Los campos vacíos significan no capturado, no cero.</p> : null}

    <div className="mt-5 grid gap-4 xl:grid-cols-3">
      <article className="rounded-2xl border border-[#e5ddd0] bg-white/90 p-4">
        <h4 className="font-medium text-[#24332f]">Tally manual independiente</h4>
        {sourceData?.document?.manualIndependent ? <SourceCounts title="Fuente declarada" source={sourceData.document.manualIndependent} timeZone={timeZone} /> : sourceReadFailed ? <p className="mt-2 text-sm text-[#8a4343]">Lectura no confirmada; no puede afirmarse si hay un tally guardado.</p> : sourceReadPending ? <p className="mt-2 text-sm text-[#68716b]">{storeId ? "Consultando tally…" : "Esperando contexto de tienda…"}</p> : manualSourceAbsent ? <p className="mt-2 text-sm text-[#68716b]">En la última lectura confirmada: sin tally manual independiente guardado. El cierre EOD declarado por personal es otra fuente y no se importa aquí.</p> : null}
      </article>
      <article className="rounded-2xl border border-[#e5ddd0] bg-white/90 p-4">
        <h4 className="font-medium text-[#24332f]">Importación Shopify</h4>
        {sourceData?.document?.shopify ? <SourceCounts title="Export agregado" source={sourceData.document.shopify} timeZone={timeZone} /> : sourceReadFailed ? <p className="mt-2 text-sm text-[#8a4343]">Lectura no confirmada; no puede afirmarse si hay importación guardada.</p> : sourceReadPending ? <p className="mt-2 text-sm text-[#68716b]">{storeId ? "Consultando Shopify…" : "Esperando contexto de tienda…"}</p> : shopifySourceAbsent ? <p className="mt-2 text-sm text-[#68716b]">En la última lectura confirmada: sin importación Shopify guardada para esta tienda/fecha; no significa cero ventas.</p> : null}
        {sourceData?.document?.shopify?.unmapped ? <div className="mt-3 rounded-xl bg-[#f7f2ea] p-3 text-xs leading-5 text-[#65716b]">Excepciones/unmapped: {sourceData.document.shopify.unmapped.rowCount} filas; {sourceData.document.shopify.unmapped.knownNetItemsSold} unidades conocidas y {sourceData.document.shopify.unmapped.rowsWithUnknownItemCount} con cantidad no verificable. No se guardan SKU, títulos ni filas.</div> : null}
      </article>
      <article className="rounded-2xl border border-[#d8e2da] bg-[#f4f8f3] p-4">
        <h4 className="font-medium text-[#24332f]">Observaciones de cámara</h4>
        {cameraQuery.isLoading && !cameraData ? <p className="mt-2 text-sm text-[#68716b]">Consultando registro nativo…</p> : null}
        {cameraStale ? <p role="status" className="mt-2 text-xs text-[#735825]">Respuesta conservada del mismo día; la consulta actual falló.</p> : null}
        {cameraScopeMismatch ? <p role="status" className="mt-2 text-xs text-[#8a4343]">Respuesta nativa de otra tienda o fecha descartada.</p> : null}
        {cameraQuery.error && !cameraData ? <p className="mt-2 text-sm text-[#8a4343]">Lectura fallida; no se puede concluir ausencia ni cero.</p> : null}
        {!cameraQuery.error && cameraAbsent ? <p className="mt-2 text-sm text-[#68716b]">Sin registro nativo recibido para esta fecha; no significa cero observaciones.</p> : null}
        {cameraData ? <>
          <p className="mt-2 text-sm text-[#65716b]">{cameraData.detectedTracks} seguimientos de detector; {cameraData.locallyVerifiedTargets} objetivos verificados por CV local. No es conteo de vasos físicos únicos.</p>
          <p className="mt-1 text-xs text-[#68716b]">Registro recibido: {formatTime(cameraData.receivedAt, timeZone)}.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          {[{ label: "Chico", value: sizeCategoryValue(cameraData.sizeBreakdown.chico, cameraData.sizeBreakdown.unknown, false) }, { label: "Mediano", value: sizeCategoryValue(cameraData.sizeBreakdown.mediano, cameraData.sizeBreakdown.unknown, false) }, { label: "Pint", value: sizeCategoryValue(cameraData.sizeBreakdown.pint, cameraData.sizeBreakdown.unknown, false) }, { label: "Litro", value: sizeCategoryValue(cameraData.sizeBreakdown.litro, cameraData.sizeBreakdown.unknown, false) }, { label: "Sin clasificar", value: sizeCategoryValue(cameraData.sizeBreakdown.unknown, cameraData.sizeBreakdown.unknown, true) }].map(row => <div key={row.label} className="rounded-xl border border-[#d8e2da] bg-white px-3 py-2"><p className="text-xs text-[#68716b]">{row.label}</p><p className="mt-1 font-semibold text-[#24332f]">{row.value}</p></div>)}
          </div>
          <p className="mt-3 text-xs leading-5 text-[#68716b]">Los valores son clasificaciones/observaciones ligadas a tracks. La cámara no distingue aquí/para llevar ni acredita ventas o entregas únicas.</p>
        </> : null}
      </article>
    </div>

    {sourceData?.document ? <div className="mt-4 rounded-xl border border-[#e5ddd0] bg-white/80 p-3 text-sm text-[#65716b]">Intervalos manual/Shopify: {intervalMatch ? "coinciden exactamente" : "no coinciden o falta intervalo"}. No se calcula diferencia ni porcentaje contra cámara: no hay conteo físico validado de cobertura común.</div> : null}

    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <div className="rounded-2xl border border-[#e5ddd0] bg-white p-4">
        <h4 className="font-medium text-[#24332f]">Registrar tally manual independiente</h4>
        <p className="my-2 text-xs leading-5 text-[#68716b]">Deja vacío lo no disponible; escribe 0 sólo si ese cero fue anotado explícitamente. La marca de tiempo es hora local de {timeZone}.</p>
        <StoreInterval sourceName={manual.sourceName} startedAt={manual.startedAt} endedAt={manual.endedAt} timeZone={timeZone}
          onSourceName={value => setManual(current => ({ ...current, sourceName: value }))}
          onStartedAt={value => setManual(current => ({ ...current, startedAt: value }))}
          onEndedAt={value => setManual(current => ({ ...current, endedAt: value }))} />
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {COMPARISON_CATEGORY_LABELS.map(item => <label key={item.key} className="text-xs font-medium text-[#52665f]">{item.label}<input type="number" min="0" step="1" inputMode="numeric" className="mt-1 w-full rounded-lg border border-[#d7cec0] bg-white px-3 py-2 text-sm" value={manual.categories[item.key]} onChange={event => setManual(current => ({ ...current, categories: { ...current.categories, [item.key]: event.target.value } }))} /></label>)}
        </div>
        {!manualCounts.valid ? <p role="alert" className="mt-2 text-xs text-[#8a4343]">Usa enteros no negativos; las fracciones no se guardan.</p> : null}
        {!manualDraft && (manual.sourceName || manual.startedAt || manual.endedAt || CATEGORY_KEYS.some(key => manual.categories[key])) ? <p role="alert" className="mt-2 text-xs text-[#8a4343]">Completa un nombre de fuente, un intervalo pasado del día seleccionado en hora local de tienda y por lo menos un conteo explícito. Deja en blanco las categorías no disponibles.</p> : null}
        <button type="button" className="mt-4 rounded-full bg-[#2f2a26] px-5 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={!storeId || !manualDraft || saveManualMutation.isPending || sourcesQuery.isLoading || (!sourceData && !sourcesQuery.error)} onClick={() => void saveManual()}>
          {saveManualMutation.isPending ? "Guardando…" : canCreateIfMissing ? "Guardar con creación condicional" : "Guardar tally independiente"}
        </button>
        {saveManualMutation.error ? <p role="alert" className="mt-2 text-xs text-[#8a4343]">No confirmado: {saveManualMutation.error.message}</p> : null}
      </div>

      <div className="rounded-2xl border border-[#e5ddd0] bg-white p-4">
        <h4 className="font-medium text-[#24332f]">Importar CSV Shopify</h4>
        <p className="my-2 text-xs leading-5 text-[#68716b]">Se persisten sólo agregados de las seis categorías, hash SHA-256, nombre de fuente, intervalo y excepciones agregadas. No se guardan bytes del CSV, SKU, títulos, importes ni filas.</p>
        <StoreInterval sourceName={shopify.sourceName} startedAt={shopify.startedAt} endedAt={shopify.endedAt} timeZone={timeZone}
          onSourceName={value => setShopify(current => ({ ...current, sourceName: value }))}
          onStartedAt={value => setShopify(current => ({ ...current, startedAt: value }))}
          onEndedAt={value => setShopify(current => ({ ...current, endedAt: value }))} />
        <label className="mt-4 inline-flex cursor-pointer items-center justify-center rounded-full border border-[#2f2a26] bg-[#2f2a26] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          {saveShopifyMutation.isPending ? "Analizando y guardando…" : canCreateIfMissing ? "Seleccionar CSV · creación condicional" : "Seleccionar CSV Shopify"}
          <input type="file" accept=".csv,text/csv" className="sr-only" disabled={!storeId || !shopifyInterval || saveShopifyMutation.isPending || sourcesQuery.isLoading || (!sourceData && !sourcesQuery.error)} onChange={event => void handleShopifyUpload(event)} />
        </label>
        {fileError ? <p role="alert" className="mt-3 rounded-xl border border-[#e9caca] bg-[#fff4f4] p-3 text-sm text-[#8a4343]">{fileError}</p> : null}
        {saveShopifyMutation.error ? <p role="alert" className="mt-2 text-xs text-[#8a4343]">No confirmado: {saveShopifyMutation.error.message}</p> : null}
      </div>
    </div>
  </section>;
}
