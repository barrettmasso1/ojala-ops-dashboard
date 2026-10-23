import type { CupDescriptionView } from "@shared/cupDescriptions";
export type HandoffVisualEvidenceStatusCounts = {
  pendingReview: number;
  approvedByAi: number;
  approvedByManager: number;
  discardedByAi: number;
  discardedByManager: number;
};

export type HandoffVisualEvidenceThumbnail = {
  id: number;
  cupEventId: string;
  analysisStatus: "pending_review" | "approved_by_ai" | "discarded" | "approved_by_manager" | "discarded_by_manager";
  evidenceOrigin: "verified_snapshot" | "recording_extracted_frame";
  receivedAt: string | Date | null;
  imageUrl: string | null;
  cupDescriptions?: CupDescriptionView[];
};

export type HandoffVisualEvidenceOverview = {
  total: number;
  statusCounts: HandoffVisualEvidenceStatusCounts;
  latestReceivedAt: string | Date | null;
  thumbnails: HandoffVisualEvidenceThumbnail[];
};

export type HandoffVisualEvidencePresentation =
  | { state: "loading" }
  | { state: "error" }
  | { state: "empty"; summary: HandoffVisualEvidenceOverview }
  | { state: "ready"; summary: HandoffVisualEvidenceOverview };

const emptyStatusCounts: HandoffVisualEvidenceStatusCounts = {
  pendingReview: 0,
  approvedByAi: 0,
  approvedByManager: 0,
  discardedByAi: 0,
  discardedByManager: 0,
};

function safeCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * Builds a presentation model for visual evidence only. This deliberately has
 * no dependency on a daily physical-count row: images and AI labels never
 * become cups, sales, deliveries, or a camera-count fallback.
 */
export function buildHandoffVisualEvidencePresentation(input: {
  isLoading: boolean;
  hasError: boolean;
  summary?: HandoffVisualEvidenceOverview | null;
}): HandoffVisualEvidencePresentation {
  if (input.isLoading) return { state: "loading" };
  if (input.hasError) return { state: "error" };

  const source = input.summary;
  const summary: HandoffVisualEvidenceOverview = {
    total: safeCount(source?.total),
    statusCounts: {
      pendingReview: safeCount(source?.statusCounts?.pendingReview),
      approvedByAi: safeCount(source?.statusCounts?.approvedByAi),
      approvedByManager: safeCount(source?.statusCounts?.approvedByManager),
      discardedByAi: safeCount(source?.statusCounts?.discardedByAi),
      discardedByManager: safeCount(source?.statusCounts?.discardedByManager),
    },
    latestReceivedAt: source?.latestReceivedAt ?? null,
    thumbnails: (source?.thumbnails ?? []).filter(thumbnail => Boolean(thumbnail.imageUrl)).slice(0, 4),
  };

  return summary.total > 0 ? { state: "ready", summary } : { state: "empty", summary };
}

/** A date is carried explicitly when leaving the overview for Handoff Review. */
export function handoffReviewHref(businessDate: string) {
  return `/dashboard/handoff-review?date=${encodeURIComponent(businessDate)}`;
}

/**
 * Only accepts the ordinary YYYY-MM-DD query value used by the dashboard.
 * Wouter's useSearch() returns the query string without a leading question
 * mark, while accepting a full URL here keeps this helper easy to test.
 */
export function requestedDashboardBusinessDate(search: string) {
  const queryIndex = search.indexOf("?");
  const query = queryIndex >= 0 ? search.slice(queryIndex + 1) : search.replace(/^\?/, "");
  const value = new URLSearchParams(query).get("date");
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
