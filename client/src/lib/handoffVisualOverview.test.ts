import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router, useSearch } from "wouter";
import { buildDailyOperations } from "./dailyOperations";
import { buildHandoffVisualEvidencePresentation, handoffReviewHref, requestedDashboardBusinessDate } from "./handoffVisualOverview";

const summary = {
  total: 12,
  statusCounts: {
    approvedByAi: 8,
    approvedByManager: 0,
    discardedByAi: 3,
    discardedByManager: 0,
    pendingReview: 1,
  },
  latestReceivedAt: "2026-10-18T22:41:19.000Z",
  thumbnails: [{
    id: 630001,
    cupEventId: "fixture-event",
    analysisStatus: "approved_by_ai" as const,
    evidenceOrigin: "verified_snapshot" as const,
    receivedAt: "2026-10-18T22:41:19.000Z",
    imageUrl: "/manus-storage/fixture.jpg",
  }],
};

describe("handoff visual evidence overview", () => {
  it("keeps real image evidence separate from a physical cup count", () => {
    const view = buildHandoffVisualEvidencePresentation({ isLoading: false, hasError: false, summary });
    expect(view).toMatchObject({ state: "ready", summary: { total: 12, statusCounts: { approvedByAi: 8, discardedByAi: 3, pendingReview: 1 } } });
    expect(view.state === "ready" && view.summary.latestReceivedAt).toBe("2026-10-18T22:41:19.000Z");
  });

  it("does not turn loading or an error into zero visual evidence", () => {
    expect(buildHandoffVisualEvidencePresentation({ isLoading: true, hasError: false, summary })).toEqual({ state: "loading" });
    expect(buildHandoffVisualEvidencePresentation({ isLoading: false, hasError: true, summary })).toEqual({ state: "error" });
  });

  it("renders an empty result only after a successful empty summary", () => {
    expect(buildHandoffVisualEvidencePresentation({ isLoading: false, hasError: false, summary: null })).toMatchObject({
      state: "empty",
      summary: { total: 0, latestReceivedAt: null, thumbnails: [] },
    });
  });

  it("keeps images and the physical daily count independent for every combination", () => {
    const day = "2026-10-18";
    const baseDaily = { businessDate: day, reportCount: 0, cups: { "4oz": 0, "8oz": 0, Pint: 0, Liter: 0 } };
    const physicalCount = {
      businessDate: day,
      cameraName: "handoff",
      cupsDetected: 2,
      sourceDetail: JSON.stringify({ basis: "reviewed_unique_physical_cups", recordSha256: "a".repeat(64), coverage: "partial" }),
    };
    const imagesOnly = buildHandoffVisualEvidencePresentation({ isLoading: false, hasError: false, summary });
    const noImages = buildHandoffVisualEvidencePresentation({ isLoading: false, hasError: false, summary: null });

    expect([buildDailyOperations(baseDaily, day).cameraCount, imagesOnly.state]).toEqual([null, "ready"]); // images without count
    expect([buildDailyOperations({ ...baseDaily, frigateCounts: physicalCount }, day).cameraCount, noImages.state]).toEqual([2, "empty"]); // count without images
    expect([buildDailyOperations(baseDaily, day).cameraCount, noImages.state]).toEqual([null, "empty"]); // neither
    expect([buildDailyOperations({ ...baseDaily, frigateCounts: physicalCount }, day).cameraCount, imagesOnly.state]).toEqual([2, "ready"]); // both
  });

  it("carries the selected business date into Handoff Review without inventing a filter", () => {
    expect(handoffReviewHref("2026-10-18")).toBe("/dashboard/handoff-review?date=2026-10-18");
    expect(requestedDashboardBusinessDate("/dashboard/handoff-review?date=2026-10-18")).toBe("2026-10-18");
    expect(requestedDashboardBusinessDate("date=2026-10-18")).toBe("2026-10-18");
    expect(requestedDashboardBusinessDate("/dashboard/handoff-review?review=20261018")).toBeNull();
  });

  it("reads a direct Handoff Review date through Wouter useSearch rather than the pathname", () => {
    function RequestedDateProbe() {
      return createElement("output", null, requestedDashboardBusinessDate(useSearch()) ?? "missing");
    }

    const markup = renderToStaticMarkup(createElement(
      Router,
      { ssrPath: "/dashboard/handoff-review", ssrSearch: "date=2026-10-18" },
      createElement(RequestedDateProbe),
    ));

    expect(markup).toContain("2026-10-18");
  });
});
