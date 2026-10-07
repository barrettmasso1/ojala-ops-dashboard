export type DailyOperationsInput = {
  businessDate: string;
  reportCount: number;
  cups: { "4oz": number; "8oz": number; Pint: number; Liter: number };
  frigateCounts?: {
    businessDate: string;
    cameraName: string;
    cupsDetected: number;
    sourceDetail?: string | null;
    receivedAt?: string | Date | null;
  } | null;
};

export type CameraEvidenceState =
  | "missing"
  | "invalid"
  | "unclassified"
  | "partial"
  | "reviewed";

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function parseSource(value?: string | null): Record<string, unknown> {
  if (!value || value.length > 10_000) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/** Read-only presentation of existing records. Never creates sales or camera counts. */
export function buildDailyOperations(input: DailyOperationsInput, selectedDate: string) {
  const matchingDay = input.businessDate === selectedDate;
  const salesValues = Object.values(input.cups);
  const salesCount = matchingDay && input.reportCount > 0 && salesValues.every(isCount)
    && Number.isSafeInteger(salesValues.reduce((sum, n) => sum + n, 0))
    ? salesValues.reduce((sum, n) => sum + n, 0)
    : null;

  const record = input.frigateCounts;
  let state: CameraEvidenceState = "missing";
  let cameraCount: number | null = null;
  let cameraMessage = "No camera count received for this date. This does not mean zero cups.";
  let gaps = "";
  let receivedAt: string | Date | null = null;
  if (record) {
    if (!matchingDay || record.businessDate !== selectedDate
      || record.cameraName !== "handoff" || !isCount(record.cupsDetected)) {
      state = "invalid";
      cameraMessage = "The camera record does not match this date/camera or contains an invalid count.";
    } else {
      cameraCount = record.cupsDetected;
      receivedAt = record.receivedAt ?? null;
      const source = parseSource(record.sourceDetail);
      gaps = typeof source.gaps === "string" ? source.gaps.slice(0, 500).trim() : "";
      const reviewed = source.basis === "reviewed_unique_physical_cups"
        && typeof source.recordSha256 === "string"
        && /^[a-f0-9]{64}$/i.test(source.recordSha256);
      // Partial evidence is useful and remains visible; it is never a daily total.
      if (source.coverage === "partial") {
        state = "partial";
        cameraMessage = reviewed
          ? "Reviewed cups in partial evidence. The daily total is still unknown."
          : "Partial camera evidence; the counting method still needs review.";
      } else if (source.coverage === "complete" && reviewed && !gaps) {
        state = "reviewed";
        cameraMessage = "Reviewed unique cups; the source reports full coverage. This is not a certified delivery or sale.";
      } else {
        state = "unclassified";
        cameraMessage = gaps && source.coverage === "complete"
          ? "The source reports complete coverage but also lists gaps. Review before comparing."
          : "Camera record received. Confirm unique-cup counting and coverage before comparing.";
      }
    }
  }

  const difference = state === "reviewed" && cameraCount !== null && salesCount !== null
    ? cameraCount - salesCount
    : null;
  const differenceMessage = difference !== null
    ? "Camera minus sales entered at closing. A difference is a review prompt, not proof of loss or detection accuracy."
    : salesCount === null
      ? "Waiting for the sales closing record for this date."
      : "Waiting for a reviewed camera count with complete coverage.";
  const cameraLabel = {
    missing: "Awaiting data",
    invalid: "Check record",
    unclassified: "Method unconfirmed",
    partial: "Partial evidence",
    reviewed: "Reviewed count",
  }[state];
  return {
    businessDate: selectedDate,
    salesCount,
    cameraCount,
    cameraValue: cameraCount === null ? "—"
      : state === "partial" ? `${cameraCount} (partial)`
        : state === "unclassified" ? `${cameraCount} (unverified)` : String(cameraCount),
    state,
    cameraLabel,
    cameraMessage,
    gaps,
    receivedAt,
    difference,
    differenceMessage,
    manualReference: "Independent manual tally is not connected to this view yet.",
  };
}

export type DailyOperationsView = ReturnType<typeof buildDailyOperations>;
