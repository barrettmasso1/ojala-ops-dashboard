import type { DirectionalAdminView, DirectionalSize } from "../../../server/directionalHandoff";

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
  label: "Intervalo observado parcial" | "No observado";
  message: string;
  warning: string;
  sizeRows: Array<{ key: DirectionalSize; label: string; value: string }>;
  interval: string;
  latestFrame: string;
  lastReceipt: string;
  connection: string;
  identityHolds: string;
  gaps: string;
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
  return dataUpdatedAt > 0 ? "Recibiendo consulta" : "Consultando";
}

export function buildDirectionalHandoffPanelModel(
  data: DirectionalAdminView | null | undefined,
  businessDate: string,
  timeZone: string,
  queryState: DirectionalQueryState,
  dataUpdatedAt: number,
): DirectionalHandoffPanelModel {
  const rows = (Object.keys(DIRECTIONAL_SIZE_LABELS) as DirectionalSize[]).map(key => ({
    key,
    label: DIRECTIONAL_SIZE_LABELS[key],
    value: data?.sizeBreakdown ? String(data.sizeBreakdown[key]) : "—",
  }));
  const observed = Boolean(data?.observedFrom && data.observedUntil && data.businessDate === businessDate);
  const records = data?.records ?? [];
  const identityHolds = data?.statusCounts.identity_ambiguous ?? 0;
  const droppedFrames = data?.windows.reduce((total, window) => total + window.droppedFrames, 0) ?? 0;
  const latestFrame = data?.observedUntil ?? null;

  if (!data || data.businessDate !== businessDate || !observed) {
    return {
      businessDate,
      title: "Conteo automático provisional de entregas",
      value: "—",
      label: "No observado",
      message: "No hay intervalo observado para esta fecha. No se presenta cero ni se reconstruye el día a partir de snapshots o tracks terminados.",
      warning: "Estimación geométrica provisional; precisión comercial no validada. No son ventas ni entregas certificadas.",
      sizeRows: rows.map(row => ({ ...row, value: "—" })),
      interval: "—",
      latestFrame: "—",
      lastReceipt: "—",
      connection: queryLabel(queryState, dataUpdatedAt),
      identityHolds: String(identityHolds),
      gaps: String(droppedFrames),
      records: String(records.length),
      observed: false,
    };
  }

  const gapText = droppedFrames === 0 ? "Sin frames descartados en ventanas observadas" : `${droppedFrames} frames descartados; el intervalo queda fragmentado`;
  return {
    businessDate,
    title: "Conteo automático provisional de entregas",
    value: data.estimatedHandoffs == null ? "—" : String(data.estimatedHandoffs),
    label: "Intervalo observado parcial",
    message: "El valor es solo del intervalo observado. Cero aquí no significa cero entregas del día.",
    warning: "Estimación geométrica provisional; precisión comercial no validada. No modifica cierres, ventas ni conteos físicos revisados.",
    sizeRows: rows,
    interval: `${dateTimeLabel(data.observedFrom, timeZone)} → ${dateTimeLabel(data.observedUntil, timeZone)}`,
    latestFrame: dateTimeLabel(latestFrame, timeZone),
    lastReceipt: dateTimeLabel(data.receivedAt, timeZone),
    connection: queryLabel(queryState, dataUpdatedAt),
    identityHolds: String(identityHolds),
    gaps: gapText,
    records: String(records.length),
    observed: true,
  };
}
