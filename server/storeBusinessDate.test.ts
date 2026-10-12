import { describe, expect, it } from "vitest";
import { getBusinessDateTimeTimestamp, getPacificBusinessDate, isFuturePacificBusinessDate, withStoreTimeZone } from "./storeBusinessDate";

describe("store business dates", () => {
  const winterBoundary = new Date("2026-12-15T07:30:00.000Z");

  it("uses the authenticated store zone at a day boundary", () => {
    expect(withStoreTimeZone("America/Mazatlan", () => getPacificBusinessDate(winterBoundary))).toBe("2026-12-15");
    expect(withStoreTimeZone("America/Los_Angeles", () => getPacificBusinessDate(winterBoundary))).toBe("2026-12-14");
    expect(withStoreTimeZone("Asia/Tokyo", () => isFuturePacificBusinessDate("2026-12-16", winterBoundary))).toBe(true);
  });

  it("keeps request time zones separate across concurrent asynchronous work", async () => {
    const results = await Promise.all([
      withStoreTimeZone("America/Mazatlan", async () => { await Promise.resolve(); return getPacificBusinessDate(winterBoundary); }),
      withStoreTimeZone("America/Los_Angeles", async () => { await Promise.resolve(); return getPacificBusinessDate(winterBoundary); }),
    ]);
    expect(results).toEqual(["2026-12-15", "2026-12-14"]);
    expect(getPacificBusinessDate(winterBoundary)).toBe("2026-12-14");
  });

  it("converts manual punches and 22:00 clock-outs in the authenticated store zone", () => {
    expect(withStoreTimeZone("America/Mazatlan", () => getBusinessDateTimeTimestamp("2026-12-15", "09:00"))).toBe(Date.parse("2026-12-15T16:00:00.000Z"));
    expect(withStoreTimeZone("America/Los_Angeles", () => getBusinessDateTimeTimestamp("2026-12-15", "09:00"))).toBe(Date.parse("2026-12-15T17:00:00.000Z"));
    expect(withStoreTimeZone("America/Mazatlan", () => getBusinessDateTimeTimestamp("2026-12-15", "22:00"))).toBe(Date.parse("2026-12-16T05:00:00.000Z"));
  });

  it("rejects nonexistent DST times and uses the post-transition offset for late shifts", () => {
    expect(() => withStoreTimeZone("America/Los_Angeles", () => getBusinessDateTimeTimestamp("2026-03-08", "02:30"))).toThrow("Invalid local time");
    expect(withStoreTimeZone("America/Los_Angeles", () => getBusinessDateTimeTimestamp("2026-03-08", "22:00"))).toBe(Date.parse("2026-03-09T05:00:00.000Z"));
  });
});
