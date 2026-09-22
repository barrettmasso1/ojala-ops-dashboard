import { describe, expect, it } from "vitest";
import { compareFrigateEventOrder, normalizeFrigateEventAt } from "./frigateEventOrder";

describe("Frigate source event ordering", () => {
  const stored = {
    sourceEventId: "event-newer-0001",
    sourceEventAt: new Date("2026-09-22T19:00:00.000Z"),
  };

  it("accepts a later source timestamp even if the corrected absolute count is lower", () => {
    expect(compareFrigateEventOrder(stored, {
      sourceEventId: "event-correction-0002",
      sourceEventAt: new Date("2026-09-22T19:01:00.000Z"),
    })).toBe("apply");
  });

  it("identifies an exact event ID as a safe retry", () => {
    expect(compareFrigateEventOrder(stored, { ...stored })).toBe("replay");
  });

  it("rejects an older retry after a newer event was recorded", () => {
    expect(compareFrigateEventOrder(stored, {
      sourceEventId: "event-old-0000",
      sourceEventAt: new Date("2026-09-22T18:59:00.000Z"),
    })).toBe("stale");
  });

  it("requires a UTC ISO source timestamp", () => {
    expect(normalizeFrigateEventAt("2026-09-22T19:00:00.000Z")?.toISOString()).toBe("2026-09-22T19:00:00.000Z");
    expect(normalizeFrigateEventAt("2026-09-22T19:00:00-07:00")).toBeNull();
    expect(normalizeFrigateEventAt("not-a-time")).toBeNull();
  });
});
