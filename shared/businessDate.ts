const BUSINESS_TIME_ZONE = "America/Los_Angeles";

function getDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
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
  const { year, month, day } = getDateParts(date);
  return `${year}-${month}-${day}`;
}

export function isFuturePacificBusinessDate(dateString: string, referenceDate = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false;
  return dateString > getPacificBusinessDate(referenceDate);
}

export function getPacificWeekStart(dateString: string) {
  const [year, month, day] = dateString.split("-").map(value => Number(value));
  const pacificMiddayUtc = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = pacificMiddayUtc.getUTCDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  pacificMiddayUtc.setUTCDate(pacificMiddayUtc.getUTCDate() + diff);
  return getPacificBusinessDate(pacificMiddayUtc);
}

export const PACIFIC_TIME_ZONE = BUSINESS_TIME_ZONE;
