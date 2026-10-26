import type { DirectionalAdminView, DirectionalSize } from "../../../server/directionalHandoff";
import { getBusinessDate } from "../../../shared/businessDate";

export const DIRECTIONAL_SIZE_LABELS: Record<DirectionalSize, string> = {
  chico: "Chico",
  mediano: "Mediano",
  pint: "Pint",
  litro: "Litro",
  unknown: "Sin clasificar",
};

export type DirectionalQueryState = "loading" | "live" | "stale" | "offline" | "empty";

export type DirectionalHandoffPanelModel = {
  businessDate: string;
  title: "Conteo automático provisional de entregas";
  value: string;
  label: "Intervalo observado parcial" | "No observado" | "Fecha histórica" | "Sin recorrido concluyente";
  message: string;
  warning: string;
  sizeRows: Array<{ key: DirectionalSize; label: string; value: string }>;
  interval: string;
  latestFrame: string;
  lastReceipt: string;
  connection: string;
  freshness: "Fotogramas recientes" | "Sin fotogramas recientes" | "Fecha histórica" | "Sin observación";
  identityHolds: string;
  windowGaps: string;
  gapDuration: string;
  droppedFrames: string;
  records: string;
  observed: boolean;
};

function dateTimeLabel(value: string | null, timeZone: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function queryLabel(state: DirectionalQueryState, dataUpdatedAt: number) {
  if (state === "loading") return "Consultando";
  if (state === "offline") return "Sin conexión; último dato conservado";
  if (state === "stale") return "Consulta fallida; último dato conservado";
  if (state === "empty") return "Sin respuesta para esta fecha";
  return dataUpdatedAt > 0 ? "Consulta HTTP recibida" : "Consultando";
}

function durationLabel(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const totalSeconds = Math.round(milliseconds / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds}s`;
}

function observedGapSummary(data: DirectionalAdminView) {
  const windows = data.windows;
  if (windows.length < 2) return { count: "0", duration: "0s" };
  let duration = 0;
  for (let index = 1; index < windows.length; index += 1) {
    duration += Math.max(0, Date.parse(windows[index]!.from) - Date.parse(windows[index - 1]!.until));
  }
  return { count: String(windows.length - 1), duration: durationLabel(duration) };
}

function cameraFreshness(data: DirectionalAdminView, businessDate: string, timeZone: string, now: Date, staleAfterMs: number) {
  const today = getBusinessDate(now, timeZone);
  if (businessDate !== today) return "Fecha histórica" as const;
  const until = data.observedUntil ? Date.parse(data.observedUntil) : Number.NaN;
  if (!Number.isFinite(until) || now.getTime() - until > staleAfterMs) return "Sin fotogramas recientes" as const;
  return "Fotogramas recientes" as const;
}

export function buildDirectionalHandoffPanelModel(
  data: DirectionalAdminView | null | undefined,
  businessDate: string,
  timeZone: string,
  queryState: DirectionalQueryState,
  dataUpdatedAt: number,
  now = new Date(),
  staleAfterMs = 15_000,
): DirectionalHandoffPanelModel {
  const hasAcceptedEstimate = data?.businessDate === businessDate && typeof data.estimatedHandoffs === "number"
    && Number.isSafeInteger(data.estimatedHandoffs) && data.estimatedHandoffs > 0;
  const unresolved = data?.heldCandidateCount ?? 0;
  const unclassified = data?.sizeBreakdown?.unknown ?? 0;
  const rows = (Object.keys(DIRECTIONAL_SIZE_LABELS) as DirectionalSize[]).map(key => {
    const count = data?.sizeBreakdown?.[key];
    return {
      key,
      label: DIRECTIONAL_SIZE_LABELS[key],
      value: !hasAcceptedEstimate || count == null || !Number.isSafeInteger(count) || count < 0
        ? "No disponible"
        : count === 0 && (unresolved > 0 || (key !== "unknown" && unclassified > 0))
          ? "Sin asignación concluyente" : String(count),
    };
  });
  const observed = Boolean(data?.observedFrom && data.observedUntil && data.businessDate === businessDate);
  const records = data?.records ?? [];
  const identityHolds = data?.statusCounts.identity_ambiguous ?? 0;
  const latestFrame = data?.observedUntil ?? null;
  const today = getBusinessDate(now, timeZone);
  const historical = businessDate !== today;

  if (!data || data.businessDate !== businessDate || !observed) {
    return {
      businessDate,
      title: "Conteo automático provisional de entregas",
      value: "—",
      label: historical ? "Fecha histórica" : "No observado",
      message: historical
        ? "Fecha histórica. No hay intervalo observado para esta fecha; no se presenta cero ni se reconstruye el día."
        : "No hay intervalo observado para esta fecha. No se presenta cero ni se reconstruye el día a partir de snapshots o tracks terminados.",
      warning: "Estimación geométrica provisional; precisión comercial no validada. No son ventas ni entregas certificadas.",
      sizeRows: rows.map(row => ({ ...row, value: "—" })),
      interval: "—",
      latestFrame: "—",
      lastReceipt: "—",
      connection: queryLabel(queryState, dataUpdatedAt),
      freshness: historical ? "Fecha histórica" : "Sin observación",
      identityHolds: data?.businessDate === businessDate ? String(identityHolds) : "—",
      windowGaps: "—",
      gapDuration: "—",
      droppedFrames: "—",
      records: data?.businessDate === businessDate ? String(records.length) : "—",
      observed: false,
    };
  }

  const gapSummary = observedGapSummary(data);
  const droppedFrames = data.windows.reduce((total, window) => total + window.droppedFrames, 0);
  const gapDuration = gapSummary.duration;
  const gapText = historical
    ? "Fecha histórica"
    : `${gapSummary.count} entre ventanas`;
  return {
    businessDate,
    title: "Conteo automático provisional de entregas",
    value: hasAcceptedEstimate ? String(data.estimatedHandoffs) : "No disponible",
    label: historical ? "Fecha histórica" : hasAcceptedEstimate ? "Intervalo observado parcial" : "Sin recorrido concluyente",
    message: !hasAcceptedEstimate
      ? `${historical ? "Fecha histórica. " : ""}Llegan metadatos de cámara, pero no hay un recorrido de entrega concluyente. La recepción de fotogramas no demuestra cero entregas. No se sustituyen recorridos por fotos o detecciones.`
      : `${historical ? "Fecha histórica. " : ""}El valor solo corresponde al intervalo observado, no al total del día.${unresolved > 0 ? ` Quedan ${unresolved} candidatos sin resolver.` : ""}`,

    warning: "Estimación geométrica provisional; precisión comercial no validada. No modifica cierres, ventas ni conteos físicos revisados.",
    sizeRows: rows,
    interval: `${dateTimeLabel(data.observedFrom, timeZone)} → ${dateTimeLabel(data.observedUntil, timeZone)}`,
    latestFrame: dateTimeLabel(latestFrame, timeZone),
    lastReceipt: dateTimeLabel(data.receivedAt, timeZone),
    connection: queryLabel(queryState, dataUpdatedAt),
    freshness: cameraFreshness(data, businessDate, timeZone, now, staleAfterMs),
    identityHolds: String(identityHolds),
    windowGaps: gapText,
    gapDuration,
    droppedFrames: historical ? "Fecha histórica" : String(droppedFrames),
    records: String(records.length),
    observed: true,
  };
}
