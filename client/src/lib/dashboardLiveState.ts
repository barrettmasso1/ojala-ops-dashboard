export const LIVE_CAMERA_REFRESH_MS = 5_000;

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type DashboardDateMode = "today" | "history";

export function resolveDashboardDate(requestedDate: string | null | undefined, today: string) {
  const usableHistory = typeof requestedDate === "string"
    && BUSINESS_DATE.test(requestedDate)
    && requestedDate <= today;
  return {
    date: usableHistory ? requestedDate : today,
    explicit: usableHistory,
    mode: usableHistory ? "history" as const : "today" as const,
  };
}

export function dashboardDateHref(pathname: string, date: string, today: string) {
  const path = pathname.split("?")[0] || "/dashboard";
  return date === today ? path : `${path}?date=${encodeURIComponent(date)}`;
}

export function advanceTodayMode(input: { selectedDate: string; today: string; explicit: boolean }) {
  return input.explicit ? input.selectedDate : input.today;
}

/** A response may update the view only when it is for the active business date. */
export function responseMatchesBusinessDate(dataDate: string | null | undefined, selectedDate: string) {
  return dataDate == null || dataDate === selectedDate;
}

export type LiveQueryState = "loading" | "live" | "stale" | "offline";

export function liveQueryState(input: { isLoading: boolean; hasData: boolean; hasError: boolean }): LiveQueryState {
  if (input.isLoading && !input.hasData) return "loading";
  if (input.hasError && input.hasData) return "stale";
  if (input.hasError) return "offline";
  return "live";
}

export function latestSuccessfulQueryAt(timestamps: Array<number | null | undefined>) {
  const valid = timestamps.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  return valid.length > 0 ? Math.max(...valid) : null;
}
