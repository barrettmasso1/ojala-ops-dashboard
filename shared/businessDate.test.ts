import { describe, expect, it } from "vitest";
import { getPacificBusinessDate, getPacificSundayWeekStart, getPacificWeekStart, isFuturePacificBusinessDate } from "./businessDate";

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

  it("returns the Pacific Sunday for payroll week rollups", () => {
    expect(getPacificSundayWeekStart("2026-04-29")).toBe("2026-04-26");
    expect(getPacificSundayWeekStart("2026-05-03")).toBe("2026-05-03");
  });

  it("flags business dates that are ahead of the current Pacific day", () => {
    const reference = new Date("2026-05-02T20:30:00.000Z");
    expect(isFuturePacificBusinessDate("2026-05-03", reference)).toBe(true);
    expect(isFuturePacificBusinessDate("2026-05-02", reference)).toBe(false);
  });

  it("treats malformed business dates as non-future values for validation helpers", () => {
    expect(isFuturePacificBusinessDate("05/03/2026", new Date("2026-05-02T20:30:00.000Z"))).toBe(false);
  });
});
