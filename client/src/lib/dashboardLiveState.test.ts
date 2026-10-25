import { describe, expect, it } from "vitest";
import {
  advanceTodayMode,
  dashboardDateHref,
  latestSuccessfulQueryAt,
  liveQueryState,
  responseMatchesBusinessDate,
  resolveDashboardDate,
} from "./dashboardLiveState";

describe("live dashboard date and connectivity state", () => {
  it("keeps an unqualified dashboard on today even when today's data is absent", () => {
    expect(resolveDashboardDate(null, "2026-10-25")).toEqual({ date: "2026-10-25", explicit: false, mode: "today" });
    expect(resolveDashboardDate("2026-10-24", "2026-10-25")).toEqual({ date: "2026-10-24", explicit: true, mode: "history" });
  });

  it("rejects future and malformed URL dates without falling back to an older day", () => {
    expect(resolveDashboardDate("2026-10-26", "2026-10-25")).toEqual({ date: "2026-10-25", explicit: false, mode: "today" });
    expect(resolveDashboardDate("yesterday", "2026-10-25")).toEqual({ date: "2026-10-25", explicit: false, mode: "today" });
  });

  it("persists explicit history in the URL and removes it when returning to today", () => {
    expect(dashboardDateHref("/dashboard", "2026-10-24", "2026-10-25")).toBe("/dashboard?date=2026-10-24");
    expect(dashboardDateHref("/dashboard/handoff-review", "2026-10-25", "2026-10-25")).toBe("/dashboard/handoff-review");
  });

  it("advances across midnight only in today mode", () => {
    expect(advanceTodayMode({ selectedDate: "2026-10-24", today: "2026-10-25", explicit: false })).toBe("2026-10-25");
    expect(advanceTodayMode({ selectedDate: "2026-10-24", today: "2026-10-25", explicit: true })).toBe("2026-10-24");
  });

  it("rejects a stale response from another business date", () => {
    expect(responseMatchesBusinessDate("2026-10-24", "2026-10-25")).toBe(false);
    expect(responseMatchesBusinessDate("2026-10-25", "2026-10-25")).toBe(true);
    expect(responseMatchesBusinessDate(null, "2026-10-25")).toBe(true);
  });

  it("shows recovery as live, cached errors as stale, and no-data errors as offline", () => {
    expect(liveQueryState({ isLoading: false, hasData: true, hasError: false })).toBe("live");
    expect(liveQueryState({ isLoading: false, hasData: true, hasError: true })).toBe("stale");
    expect(liveQueryState({ isLoading: false, hasData: false, hasError: true })).toBe("offline");
  });

  it("separates the last successful query time from the last received event time", () => {
    expect(latestSuccessfulQueryAt([null, 1700000000000, 1700000005000])).toBe(1700000005000);
    expect(latestSuccessfulQueryAt([null, undefined])).toBeNull();
  });
});
