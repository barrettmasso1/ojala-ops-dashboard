import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { getRetroactiveClosingDraftKey, loadRetroactiveClosingDraft, saveRetroactiveClosingDraft } from "./retroactiveClosingDrafts";
import { populatedWeightRows, weightRowHasMeasurements } from "../components/AdminRetroactiveClosingPanel";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

describe("retroactive closing drafts", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date("2026-10-24T22:00:00Z")));

  it("keeps each store/date draft in a separate key", () => {
    const target = storage();
    const first = saveRetroactiveClosingDraft(1, "2026-10-22", { reason: "Thursday" }, target);
    const second = saveRetroactiveClosingDraft(1, "2026-10-23", { reason: "Friday" }, target);
    const otherStore = saveRetroactiveClosingDraft(2, "2026-10-22", { reason: "Other store" }, target);
    expect(first?.data).toEqual({ reason: "Thursday" });
    expect(second?.data).toEqual({ reason: "Friday" });
    expect(otherStore?.data).toEqual({ reason: "Other store" });
    expect(loadRetroactiveClosingDraft(1, "2026-10-22", target)?.data).toEqual({ reason: "Thursday" });
    expect(loadRetroactiveClosingDraft(1, "2026-10-23", target)?.data).toEqual({ reason: "Friday" });
    expect(loadRetroactiveClosingDraft(2, "2026-10-22", target)?.data).toEqual({ reason: "Other store" });
    expect(target.setItem).toHaveBeenCalledWith(getRetroactiveClosingDraftKey(1, "2026-10-22"), expect.any(String));
  });

  it("drops malformed records only for the selected store/date", () => {
    const target = storage();
    target.setItem(getRetroactiveClosingDraftKey(1, "2026-10-22"), "not-json");
    saveRetroactiveClosingDraft(1, "2026-10-23", { reason: "Friday" }, target);
    expect(loadRetroactiveClosingDraft(1, "2026-10-22", target)).toBeNull();
    expect(loadRetroactiveClosingDraft(1, "2026-10-23", target)?.data).toEqual({ reason: "Friday" });
  });

  it("omits preset flavor rows without any recorded measurements instead of requiring invented zeros", () => {
    const rows = [
      { flavor: "Vanilla", smallPanCount: "", smallGrossWeightKg: "", largePanCount: "", largeGrossWeightKg: "", combinedGrossWeightKg: "" },
      { flavor: "Chocolate", smallPanCount: "0", smallGrossWeightKg: "", largePanCount: "0", largeGrossWeightKg: "", combinedGrossWeightKg: "" },
      { flavor: "", smallPanCount: "", smallGrossWeightKg: "1.25", largePanCount: "", largeGrossWeightKg: "", combinedGrossWeightKg: "" },
    ];
    expect(weightRowHasMeasurements(rows[0])).toBe(false);
    expect(weightRowHasMeasurements(rows[1])).toBe(true);
    expect(populatedWeightRows(rows)).toHaveLength(2);
    expect(populatedWeightRows(rows)[0]?.flavor).toBe("Chocolate");
  });

  it("resets the selected-date form before loading a different date draft", () => {
    const source = readFileSync(new URL("../components/AdminRetroactiveClosingPanel.tsx", import.meta.url), "utf8");
    const resetAt = source.indexOf('setReason("");');
    const loadAt = source.indexOf("loadRetroactiveClosingDraft", resetAt);
    expect(resetAt).toBeGreaterThan(0);
    expect(loadAt).toBeGreaterThan(resetAt);
    expect(source.slice(resetAt, loadAt)).toContain("setWeights(initialWeights())");
    expect(source.slice(resetAt, loadAt)).toContain("setAnswers({})");
    expect(source.slice(resetAt, loadAt)).toContain("setDraftSavedAt(null)");
  });
});
