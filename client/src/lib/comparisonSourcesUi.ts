import type { ComparisonCategory, ComparisonSourcesView } from "../../../server/comparisonSources";

export const COMPARISON_CATEGORY_LABELS = [
  { key: "chico_here", label: "Chico · Aquí" },
  { key: "chico_togo", label: "Chico · Para llevar" },
  { key: "mediano_here", label: "Mediano · Aquí" },
  { key: "mediano_togo", label: "Mediano · Para llevar" },
  { key: "pint_togo", label: "Pint · Para llevar" },
  { key: "litro_togo", label: "Litro · Para llevar" },
] as const;

export function parseOptionalNonNegativeInteger(raw: string): { value: number | null; valid: boolean } {
  const value = raw.trim();
  if (!value) return { value: null, valid: true };
  if (!/^\d+$/.test(value)) return { value: null, valid: false };
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) return { value: null, valid: false };
  return { value: count, valid: true };
}

type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
function partsInZone(epochMs: number, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(epochMs));
  const get = (key: string) => Number(parts.find(part => part.type === key)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}
function wallClockEpoch(parts: DateParts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}
function sameParts(left: DateParts, right: DateParts) {
  return left.year === right.year && left.month === right.month && left.day === right.day && left.hour === right.hour && left.minute === right.minute && left.second === right.second;
}

export function businessDateForStoreInstant(instant: string, timeZone: string) {
  const timestamp = Date.parse(instant);
  if (!Number.isFinite(timestamp)) return null;
  const parts = partsInZone(timestamp, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** Convert a datetime-local value as displayed in the selected store's timezone into a UTC ISO instant. */
export function storeLocalDateTimeToIso(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const target: DateParts = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] ?? 0),
  };
  const sanity = new Date(wallClockEpoch(target));
  if (sanity.getUTCFullYear() !== target.year || sanity.getUTCMonth() + 1 !== target.month || sanity.getUTCDate() !== target.day || target.hour > 23 || target.minute > 59 || target.second > 59) return null;
  let epochMs = wallClockEpoch(target);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const represented = partsInZone(epochMs, timeZone);
    const delta = wallClockEpoch(target) - wallClockEpoch(represented);
    if (delta === 0) return new Date(epochMs).toISOString();
    epochMs += delta;
  }
  return sameParts(partsInZone(epochMs, timeZone), target) ? new Date(epochMs).toISOString() : null;
}

export function comparisonViewMatchesScope(data: ComparisonSourcesView | null | undefined, storeId: number | null | undefined, businessDate: string) {
  return Boolean(data && data.storeId === storeId && data.businessDate === businessDate && (!data.document || (data.document.storeId === storeId && data.document.businessDate === businessDate)));
}

export function intervalsHaveExactCommonCoverage(left: { startedAt: string; endedAt: string } | null | undefined, right: { startedAt: string; endedAt: string } | null | undefined) {
  if (!left || !right || !/(?:Z|[+-]\d\d:\d\d)$/.test(left.startedAt) || !/(?:Z|[+-]\d\d:\d\d)$/.test(left.endedAt) || !/(?:Z|[+-]\d\d:\d\d)$/.test(right.startedAt) || !/(?:Z|[+-]\d\d:\d\d)$/.test(right.endedAt)) return false;
  const leftStart = Date.parse(left.startedAt), leftEnd = Date.parse(left.endedAt);
  const rightStart = Date.parse(right.startedAt), rightEnd = Date.parse(right.endedAt);
  return Number.isFinite(leftStart) && Number.isFinite(leftEnd) && Number.isFinite(rightStart) && Number.isFinite(rightEnd)
    && leftStart < leftEnd && rightStart < rightEnd && leftStart === rightStart && leftEnd === rightEnd;
}

export function buildManualComparisonDraft(input: {
  businessDate: string;
  timeZone: string;
  sourceName: string;
  startedAt: string;
  endedAt: string;
  categories: Record<ComparisonCategory, string>;
}): { businessDate: string; sourceName: string; interval: { startedAt: string; endedAt: string }; categories: Record<ComparisonCategory, number | null> } | null {
  const sourceName = input.sourceName.trim();
  const startedAt = storeLocalDateTimeToIso(input.startedAt, input.timeZone);
  const endedAt = storeLocalDateTimeToIso(input.endedAt, input.timeZone);
  if (!sourceName || !startedAt || !endedAt || Date.parse(startedAt) >= Date.parse(endedAt) || Date.parse(endedAt) > Date.now()) return null;
  if (businessDateForStoreInstant(startedAt, input.timeZone) !== input.businessDate || businessDateForStoreInstant(endedAt, input.timeZone) !== input.businessDate) return null;
  const values = Object.entries(input.categories).map(([key, raw]) => [key, parseOptionalNonNegativeInteger(raw)] as const);
  if (values.some(([, parsed]) => !parsed.valid) || values.every(([, parsed]) => parsed.value === null)) return null;
  return {
    businessDate: input.businessDate,
    sourceName,
    interval: { startedAt, endedAt },
    categories: Object.fromEntries(values.map(([key, parsed]) => [key, parsed.value])) as Record<ComparisonCategory, number | null>,
  };
}
