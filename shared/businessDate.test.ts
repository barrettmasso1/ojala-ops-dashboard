import { describe, expect, it } from "vitest";
import { getPacificBusinessDate, getPacificWeekStart } from "./businessDate";

describe("businessDate helpers", () => {
  it("maps early-UTC timestamps to the previous Pacific business date", () => {
    expect(getPacificBusinessDate(new Date("2026-04-29T01:30:00.000Z"))).toBe("2026-04-28");
  });

  it("keeps midday-UTC timestamps on the same Pacific business date", () => {
    expect(getPacificBusinessDate(new Date("2026-04-29T20:30:00.000Z"))).toBe("2026-04-29");
  });

  it("returns the Pacific Monday for weekly rollups", () => {
    expect(getPacificWeekStart("2026-04-29")).toBe("2026-04-27");
    expect(getPacificWeekStart("2026-05-03")).toBe("2026-04-27");
  });
});
