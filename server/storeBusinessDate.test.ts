import { describe, expect, it } from "vitest";
import { getPacificBusinessDate, isFuturePacificBusinessDate, withStoreTimeZone } from "./storeBusinessDate";

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
});
