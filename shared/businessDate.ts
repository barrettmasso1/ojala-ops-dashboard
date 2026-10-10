const BUSINESS_TIME_ZONE = "America/Los_Angeles";

function getDateParts(date: Date, timeZone = BUSINESS_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find(part => part.type === "year")?.value ?? "0000";
  const month = parts.find(part => part.type === "month")?.value ?? "01";
  const day = parts.find(part => part.type === "day")?.value ?? "01";

  return { year, month, day };
}

export function getPacificBusinessDate(date = new Date()) {
  return getBusinessDate(date);
}

export function getBusinessDate(date = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  const { year, month, day } = getDateParts(date, timeZone);
  return `${year}-${month}-${day}`;
}

export function formatPacificDateTime(
  date = new Date(),
  locale: Intl.LocalesArgument = "en-US",
  options?: Intl.DateTimeFormatOptions,
) {
  return formatBusinessDateTime(date, locale, options);
}

export function formatBusinessDateTime(date = new Date(), locale: Intl.LocalesArgument = "en-US", options?: Intl.DateTimeFormatOptions, timeZone = BUSINESS_TIME_ZONE) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: "full",
    timeStyle: "short",
    ...options,
  }).format(date);
}

export function formatPacificTime(date = new Date(), locale: Intl.LocalesArgument = "en-US") {
  return formatBusinessTime(date, locale);
}

export function formatBusinessTime(date = new Date(), locale: Intl.LocalesArgument = "en-US", timeZone = BUSINESS_TIME_ZONE) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatPacificCalendarDate(date = new Date(), locale: Intl.LocalesArgument = "en-US") {
  return formatBusinessCalendarDate(date, locale);
}

export function formatBusinessCalendarDate(date = new Date(), locale: Intl.LocalesArgument = "en-US", timeZone = BUSINESS_TIME_ZONE) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function isFuturePacificBusinessDate(dateString: string, referenceDate = new Date()) {
  return isFutureBusinessDate(dateString, referenceDate);
}

export function isFutureBusinessDate(dateString: string, referenceDate = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false;
  return dateString > getBusinessDate(referenceDate, timeZone);
}

export function getPacificWeekStart(dateString: string) {
  const [year, month, day] = dateString.split("-").map(value => Number(value));
  const pacificMiddayUtc = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = pacificMiddayUtc.getUTCDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  pacificMiddayUtc.setUTCDate(pacificMiddayUtc.getUTCDate() + diff);
  return getPacificBusinessDate(pacificMiddayUtc);
}

export function getPacificSundayWeekStart(dateString: string) {
  const [year, month, day] = dateString.split("-").map(value => Number(value));
  const pacificMiddayUtc = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = pacificMiddayUtc.getUTCDay();
  pacificMiddayUtc.setUTCDate(pacificMiddayUtc.getUTCDate() - weekday);
  return getPacificBusinessDate(pacificMiddayUtc);
}

export const PACIFIC_TIME_ZONE = BUSINESS_TIME_ZONE;
