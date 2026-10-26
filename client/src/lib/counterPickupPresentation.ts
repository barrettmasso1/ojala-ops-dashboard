import type { CounterPickupAdminView, CounterPickupSize } from "../../../server/counterPickups";
import { getBusinessDate } from "../../../shared/businessDate";

export const COUNTER_PICKUP_SIZE_LABELS: Record<CounterPickupSize, string> = {
  chico: "Chico",
  mediano: "Mediano",
  pint: "Pint",
  litro: "Litro",
  unknown: "Sin clasificar",
};

export type CounterPickupQueryState = "loading" | "live" | "stale" | "offline" | "unavailable" | "empty";
export type CounterPickupPanelModel = {
  title: "Retiradas ópticas provisionales";
  value: string;
  label: "Ventanas de video parciales" | "No observado" | "Registro no disponible" | "Fecha histórica" | "Sin resultado concluyente";
  message: string;
  warning: string;
  sizeRows: Array<{ key: CounterPickupSize; label: string; value: string }>;
  interval: string;
  windowCount: string;
  unresolved: string;
  records: string;
  receipt: string;
  connection: string;
  observed: boolean;
};

function labelDate(value: string | null | undefined, timeZone: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(date);
}

function queryLabel(state: CounterPickupQueryState, dataUpdatedAt: number) {
  if (state === "loading") return "Recibiendo consulta";
  if (state === "unavailable") return "Registro temporalmente no disponible";
  if (state === "offline") return "Sin conexión; último dato conservado";
  if (state === "stale") return "Consulta fallida; último dato conservado";
  if (state === "empty") return "Sin respuesta para esta fecha";
  return dataUpdatedAt > 0 ? "Consulta HTTP recibida" : "Recibiendo consulta";
}

function intervalLabel(data: CounterPickupAdminView, timeZone: string) {
  const start = data.candidateWindows[0]?.from;
  const end = data.candidateWindows.at(-1)?.until;
  return start && end ? `${labelDate(start, timeZone)} → ${labelDate(end, timeZone)}` : "—";
}

export function buildCounterPickupPanelModel(
  data: CounterPickupAdminView | null | undefined,
  businessDate: string,
  timeZone: string,
  queryState: CounterPickupQueryState,
  dataUpdatedAt: number,
  now = new Date(),
): CounterPickupPanelModel {
  const historical = businessDate !== getBusinessDate(now, timeZone);
  const observed = Boolean(data && data.businessDate === businessDate && data.candidateWindows.length > 0);
  const hasAcceptedEstimate = observed && typeof data?.estimatedPickups === "number"
    && Number.isSafeInteger(data.estimatedPickups) && data.estimatedPickups > 0;
  const unresolved = data?.unresolvedCount ?? 0;
  const unclassified = data?.sizeBreakdown?.unknown ?? 0;
  const rows = (Object.keys(COUNTER_PICKUP_SIZE_LABELS) as CounterPickupSize[]).map(key => {
    const count = data?.sizeBreakdown?.[key];
    return {
      key,
      label: COUNTER_PICKUP_SIZE_LABELS[key],
      value: !hasAcceptedEstimate || count == null || !Number.isSafeInteger(count) || count < 0
        ? "No disponible"
        : count === 0 && (unresolved > 0 || (key !== "unknown" && unclassified > 0))
          ? "Sin asignación concluyente" : String(count),
    };
  });
  if (queryState === "unavailable") {
    return {
      title: "Retiradas ópticas provisionales",
      value: "—",
      label: "Registro no disponible",
      message: "El registro privado de retiradas ópticas no está disponible temporalmente. No se presenta cero ni se reconstruye el día.",
      warning: "La ausencia temporal del registro no equivale a cero ventas, cero retiradas ni un conteo físico único.",
      sizeRows: rows.map(row => ({ ...row, value: "—" })),
      interval: "—",
      windowCount: "—",
      unresolved: "—",
      records: "—",
      receipt: "—",
      connection: queryLabel(queryState, dataUpdatedAt),
      observed: false,
    };
  }
  if (!data || data.businessDate !== businessDate || !observed) {
    return {
      title: "Retiradas ópticas provisionales",
      value: "—",
      label: historical ? "Fecha histórica" : "No observado",
      message: historical
        ? "No hay ventanas de video observadas para esta fecha; no se reconstruye el día ni se presenta cero."
        : "No hay ventanas de video observadas para esta fecha. La ausencia no equivale a cero ventas ni a cero retiradas del día.",
      warning: "La geometría y el flujo óptico son provisionales; no son ventas, entregas certificadas ni conteo físico único.",
      sizeRows: rows.map(row => ({ ...row, value: "—" })),
      interval: "—",
      windowCount: "—",
      unresolved: "—",
      records: data?.businessDate === businessDate ? String(data.records.length) : "—",
      receipt: "—",
      connection: queryLabel(queryState, dataUpdatedAt),
      observed: false,
    };
  }
  return {
    title: "Retiradas ópticas provisionales",
    value: hasAcceptedEstimate ? String(data.estimatedPickups) : "No disponible",
    label: historical ? "Fecha histórica" : hasAcceptedEstimate ? "Ventanas de video parciales" : "Sin resultado concluyente",
    message: !hasAcceptedEstimate
      ? `${historical ? "Fecha histórica. " : ""}Se recibieron ${data.records.length} análisis de video, pero no hay una retirada concluyente. ${unresolved} casos siguen sin resolver. No es un conteo de cero entregas ni de cero ventas.`
      : `${historical ? "Fecha histórica. " : ""}Estimaciones aceptadas solo dentro de ventanas candidatas, no un total del día.${unresolved > 0 ? ` Quedan ${unresolved} casos sin resolver; el valor es incompleto.` : ""}`,

    warning: "Movimiento óptico local provisional, no validado comercialmente. No se suma al contador direccional, cierre manual, POS ni conteo físico revisado.",
    sizeRows: rows,
    interval: intervalLabel(data, timeZone),
    windowCount: String(data.candidateWindows.length),
    unresolved: String(data.unresolvedCount),
    records: String(data.records.length),
    receipt: labelDate(data.receivedAt, timeZone),
    connection: queryLabel(queryState, dataUpdatedAt),
    observed: true,
  };
}
