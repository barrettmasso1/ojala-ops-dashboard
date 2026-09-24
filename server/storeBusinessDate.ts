import { AsyncLocalStorage } from "node:async_hooks";
import {
  PACIFIC_TIME_ZONE,
  formatBusinessDateTime, getBusinessDate, isFutureBusinessDate,
  getPacificSundayWeekStart, getPacificWeekStart,
} from "../shared/businessDate";

const storeZone = new AsyncLocalStorage<string>();

export function withStoreTimeZone<T>(timeZone: string | undefined, operation: () => T): T {
  return storeZone.run(timeZone || PACIFIC_TIME_ZONE, operation);
}

export function getCurrentBusinessTimeZone() {
  return storeZone.getStore() ?? PACIFIC_TIME_ZONE;
}

function getUtcOffsetMinutes(date: Date, timeZone: string) {
  const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(date).find(part => part.type === "timeZoneName")?.value;
  if (offset === "GMT" || offset === "UTC") return 0;
  const match = offset?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/i);
  if (!match) throw new Error(`Cannot resolve store time zone offset: ${offset ?? "missing"}`);
  return (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

/** Convert a shop's wall-clock time into UTC, rejecting nonexistent DST times. */
export function getBusinessDateTimeTimestamp(businessDate: string, timeValue: string) {
  const [year, month, day] = businessDate.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hours, minutes);
  const timeZone = getCurrentBusinessTimeZone();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const target = `${businessDate} ${timeValue}`;
  const offsets = new Set([localAsUtc - 86_400_000, localAsUtc, localAsUtc + 86_400_000]
    .map(value => getUtcOffsetMinutes(new Date(value), timeZone)));
  const candidates = [...offsets].map(offset => localAsUtc - offset * 60_000).sort((a, b) => a - b);
  const match = candidates.find(candidate => {
    const parts = formatter.formatToParts(new Date(candidate));
    const value = (type: string) => parts.find(part => part.type === type)?.value;
    return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}` === target;
  });
  if (match === undefined) throw new Error(`Invalid local time for store time zone: ${target}`);
  return match;
}

// The legacy names remain for existing call sites while a request runs with
// its authenticated store's zone. Direct calls keep their previous default.
export function getPacificBusinessDate(date = new Date()) {
  return getBusinessDate(date, getCurrentBusinessTimeZone());
}

export function isFuturePacificBusinessDate(date: string, referenceDate = new Date()) {
  return isFutureBusinessDate(date, referenceDate, getCurrentBusinessTimeZone());
}

export function formatPacificDateTime(date = new Date(), locale: Intl.LocalesArgument = "en-US", options?: Intl.DateTimeFormatOptions) {
  return formatBusinessDateTime(date, locale, options, getCurrentBusinessTimeZone());
}

export { getPacificSundayWeekStart, getPacificWeekStart };
