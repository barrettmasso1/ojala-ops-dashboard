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
