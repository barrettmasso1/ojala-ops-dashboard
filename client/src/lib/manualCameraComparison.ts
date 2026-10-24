export type ComparisonSize = "chico" | "mediano" | "pint" | "litro";

type ObservationPeriod = { startedAt: string; endedAt: string };

type ManualSnapshot = {
  observationPeriod?: ObservationPeriod | null;
  businessDate: string;
  reportCount: number;
  cups: Record<"4oz" | "8oz" | "Pint" | "Liter", unknown>;
  cupsHere: Record<"4oz" | "8oz" | "Pint" | "Liter", unknown>;
  cupsToGo: Record<"4oz" | "8oz" | "Pint" | "Liter", unknown>;
};

type NativeLedgerSummary = {
  businessDate: string;
  scope: string;
  detectedTracks: unknown;
  locallyVerifiedTargets: unknown;
  withoutSameFrameEvidence: unknown;
  ownerExcludedTargets: unknown;
  potentialRepeatedTracks: unknown;
  sizeBreakdown: Record<ComparisonSize | "unknown", unknown>;
} | null;

type ReviewedPhysicalCount = {
  businessDate: string;
  cameraName: string;
  cupsDetected: unknown;
  sourceDetail?: string | null;
} | null;

export type ManualCameraComparisonInput = {
  selectedDate: string;
  manual: ManualSnapshot;
  nativeLedger: NativeLedgerSummary;
  nativeLedgerState: "received" | "absent" | "unavailable";
  reviewedPhysicalCount: ReviewedPhysicalCount;
};

const SIZE_KEYS: Array<{ key: ComparisonSize; manualKey: "4oz" | "8oz" | "Pint" | "Liter"; label: string }> = [
  { key: "chico", manualKey: "4oz", label: "Chico (4 oz)" },
  { key: "mediano", manualKey: "8oz", label: "Mediano (8 oz)" },
  { key: "pint", manualKey: "Pint", label: "Pint" },
  { key: "litro", manualKey: "Liter", label: "Litro" },
];

const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
const isHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);

function safeSource(value: string | null | undefined): Record<string, unknown> {
  if (!value || value.length > 60_000) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function validManual(input: ManualSnapshot, selectedDate: string) {
  const values = [...Object.values(input.cups), ...Object.values(input.cupsHere), ...Object.values(input.cupsToGo)];
  const modesMatchTotals = SIZE_KEYS.every(({ manualKey }) =>
    input.cups[manualKey] === (input.cupsHere[manualKey] as number) + (input.cupsToGo[manualKey] as number)
  );
  return input.businessDate === selectedDate && isCount(input.reportCount) && input.reportCount === 1 && values.every(isCount) && modesMatchTotals;
}

function nativeReason(input: ManualCameraComparisonInput) {
  if (input.nativeLedgerState === "unavailable") return "El registro nativo no está disponible en esta consulta; no se presenta como cero.";
  if (input.nativeLedgerState !== "received" || !input.nativeLedger) return "Sin registro nativo recibido para esta fecha; no significa cero observaciones.";
  if (input.nativeLedger.businessDate !== input.selectedDate) return "La respuesta nativa corresponde a otra fecha; no se mezclan jornadas.";
  if (input.nativeLedger.scope !== "detector_tracks_not_certified_unique_deliveries") return "El alcance del registro nativo no es verificable para esta comparación.";
  const values = [input.nativeLedger.detectedTracks, input.nativeLedger.locallyVerifiedTargets, input.nativeLedger.withoutSameFrameEvidence, input.nativeLedger.ownerExcludedTargets, input.nativeLedger.potentialRepeatedTracks, ...Object.values(input.nativeLedger.sizeBreakdown)];
  if(!values.every(isCount))return "El registro nativo contiene valores no verificables; no se sustituyen por ceros.";
  const n=input.nativeLedger;
  const sizeTotal=SIZE_KEYS.reduce((sum,item)=>sum+(n.sizeBreakdown[item.key] as number),0)+(n.sizeBreakdown.unknown as number);
  if(sizeTotal!==n.locallyVerifiedTargets || (n.locallyVerifiedTargets as number)+(n.withoutSameFrameEvidence as number)+(n.ownerExcludedTargets as number)>(n.detectedTracks as number))return "El desglose nativo no coincide con sus totales; se requiere revisar la fuente.";
  return null;
}

function observedPeriod(value: unknown): [number, number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const period=value as Record<string, unknown>;
  const parsed=[period.startedAt,period.endedAt].map(v=>typeof v==="string" && /(?:Z|[+-]\d\d:\d\d)$/.test(v) ? Date.parse(v) : NaN);
  return parsed.every(Number.isFinite) && parsed[1]>parsed[0] ? [parsed[0],parsed[1]] : null;
}

function physicalView(input: ManualCameraComparisonInput) {
  const record = input.reviewedPhysicalCount;
  if (!record) return { value: null, state: "missing" as const, reason: "Sin conteo físico revisado registrado para esta fecha.", comparable: false };
  if (record.businessDate !== input.selectedDate || record.cameraName !== "handoff" || !isCount(record.cupsDetected)) {
    return { value: null, state: "invalid" as const, reason: "El conteo físico no corresponde a esta fecha/cámara o no es verificable.", comparable: false };
  }
  const source = safeSource(record.sourceDetail);
  const reviewed = source.basis === "reviewed_unique_physical_cups" && source.coverage === "complete" && !source.gaps && isHash(source.recordSha256);
  if (!reviewed) return { value: record.cupsDetected, state: "unconfirmed" as const, reason: "Conteo físico recibido, pero cobertura o método revisado no confirman una comparación.", comparable: false };
  const manualPeriod=observedPeriod(input.manual.observationPeriod);
  const cameraPeriod=observedPeriod(source.observationPeriod);
  if(!manualPeriod || !cameraPeriod)return {value:record.cupsDetected,state:"unconfirmed" as const,reason:"Falta el intervalo observado de una fuente; compartir fecha no prueba una cobertura comparable.",comparable:false};
  if(manualPeriod[0]!==cameraPeriod[0] || manualPeriod[1]!==cameraPeriod[1])return {value:record.cupsDetected,state:"unconfirmed" as const,reason:"Los intervalos observados del registro manual y de cámara no coinciden.",comparable:false};
  return { value: record.cupsDetected, state: "comparable" as const, reason: "Conteo físico revisado con cobertura completa del mismo intervalo observado.", comparable: true };
}

/** Pure display model. It never creates a sale, physical count, delivery, label, or receipt. */
export function buildManualCameraComparison(input: ManualCameraComparisonInput) {
  const manualAvailable = validManual(input.manual, input.selectedDate);
  const nativeIssue = nativeReason(input);
  const native = nativeIssue === null ? input.nativeLedger : null;
  const physical = physicalView(input);
  const manualTotal = manualAvailable ? SIZE_KEYS.reduce<number>((sum, item) => sum + (input.manual.cups[item.manualKey] as number), 0) : null;
  const comparable = manualAvailable && nativeIssue === null && physical.comparable && manualTotal !== null && physical.value !== null;
  const difference = comparable ? physical.value - manualTotal : null;
  const percentage = comparable && manualTotal > 0 ? difference! / manualTotal : null;
  const comparisonReason = comparable
    ? "Diferencia: conteo físico revisado menos unidades registradas manualmente. Es una señal de revisión, no ventas, entregas ni validación de recall."
    : !manualAvailable
      ? input.manual.businessDate !== input.selectedDate
        ? "No disponible: el cierre manual corresponde a otra fecha."
        : input.manual.reportCount !== 1
          ? "No disponible: falta un único cierre manual para comparar esta fecha."
          : "No disponible: el cierre manual no conserva un desglose completo y consistente por modo."
      : nativeIssue !== null
        ? `No disponible: ${nativeIssue}`
      : !physical.comparable
        ? `No disponible: ${physical.reason}`
        : "No disponible: no hay unidad o intervalo común verificable.";

  const manualRows = [
    { key: "chico-here", label: "Chico · Aquí", value: manualAvailable ? input.manual.cupsHere["4oz"] as number : null },
    { key: "chico-togo", label: "Chico · Para llevar", value: manualAvailable ? input.manual.cupsToGo["4oz"] as number : null },
    { key: "mediano-here", label: "Mediano · Aquí", value: manualAvailable ? input.manual.cupsHere["8oz"] as number : null },
    { key: "mediano-togo", label: "Mediano · Para llevar", value: manualAvailable ? input.manual.cupsToGo["8oz"] as number : null },
    { key: "pint-togo", label: "Pint · Para llevar", value: manualAvailable ? input.manual.cupsToGo.Pint as number : null },
    { key: "litro-togo", label: "Litro · Para llevar", value: manualAvailable ? input.manual.cupsToGo.Liter as number : null },
  ];

  const sizeRows = SIZE_KEYS.map(({ key, manualKey, label }) => ({
    key,
    label,
    manual: manualAvailable ? input.manual.cups[manualKey] as number : null,
    nativeObservations: native ? native.sizeBreakdown[key] as number : null,
    difference: null as number | null,
    percentage: null as number | null,
    reason: native
      ? "No disponible: las observaciones de cámara no son vasos físicos deduplicados ni ventas."
      : nativeIssue ?? "No disponible.",
  }));

  return {
    businessDate: input.selectedDate,
    manual: { available: manualAvailable, total: manualTotal, rows: manualRows },
    native: native ? {
      received: true,
      detectedTracks: native.detectedTracks as number,
      usableObservations: native.locallyVerifiedTargets as number,
      withoutSameFrameEvidence: native.withoutSameFrameEvidence as number,
      ownerExcluded: native.ownerExcludedTargets as number,
      possibleRepeats: native.potentialRepeatedTracks as number,
      sizes: native.sizeBreakdown as Record<ComparisonSize | "unknown", number>,
      serviceMode: "No disponible: la cámara no clasifica aquí/para llevar.",
    } : { received: false, reason: nativeIssue ?? "Sin registro nativo verificable." },
    physical,
    sizeRows,
    difference,
    percentage,
    comparisonReason,
    shopify: { available: false, reason: "No disponible: no hay conexión ni exportación de Shopify para esta fecha." },
    evidenceHref: `/dashboard/handoff-review?date=${encodeURIComponent(input.selectedDate)}`,
  };
}
