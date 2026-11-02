import { describe, expect, it } from "vitest";
import { businessDateForStoreInstant, buildManualComparisonDraft, comparisonViewMatchesScope, intervalsHaveExactCommonCoverage, parseOptionalNonNegativeInteger, storeLocalDateTimeToIso } from "./comparisonSourcesUi";

const DAY = "2026-10-31";
const scoped = (storeId: number, businessDate: string) => ({ storeId, businessDate, availability: "absent" as const, revision: null, document: null });

describe("comparison source presentation safety", () => {
  it("keeps a typed zero distinct from blank, fractional, negative and unsafe inputs", () => {
    expect(parseOptionalNonNegativeInteger("0")).toEqual({ value: 0, valid: true });
    expect(parseOptionalNonNegativeInteger("")).toEqual({ value: null, valid: true });
    expect(parseOptionalNonNegativeInteger("  ")).toEqual({ value: null, valid: true });
    expect(parseOptionalNonNegativeInteger("1.5")).toEqual({ value: null, valid: false });
    expect(parseOptionalNonNegativeInteger("-1")).toEqual({ value: null, valid: false });
    expect(parseOptionalNonNegativeInteger("9007199254740992")).toEqual({ value: null, valid: false });
  });

  it("builds the manual save payload with zero/null distinction and rejects invalid or empty drafts", () => {
    const input = {
      businessDate: DAY, timeZone: "America/Mazatlan", sourceName: "  libreta  ",
      startedAt: `${DAY}T10:00`, endedAt: `${DAY}T11:00`,
      categories: { chico_here: "0", chico_togo: "", mediano_here: "", mediano_togo: "2", pint_togo: "", litro_togo: "" },
    };
    expect(buildManualComparisonDraft(input)).toEqual({
      businessDate: DAY, sourceName: "libreta",
      interval: { startedAt: "2026-10-31T17:00:00.000Z", endedAt: "2026-10-31T18:00:00.000Z" },
      categories: { chico_here: 0, chico_togo: null, mediano_here: null, mediano_togo: 2, pint_togo: null, litro_togo: null },
    });
    expect(buildManualComparisonDraft({ ...input, categories: { chico_here: "", chico_togo: "", mediano_here: "", mediano_togo: "", pint_togo: "", litro_togo: "" } })).toBeNull();
    expect(buildManualComparisonDraft({ ...input, startedAt: `${DAY}T23:30`, endedAt: "2026-11-01T00:30" })).toBeNull();
    expect(buildManualComparisonDraft({ ...input, categories: { ...input.categories, chico_here: "0.5" } })).toBeNull();
  });

  it("converts datetime-local wall time to a timezone-bearing UTC instant in the configured store zone", () => {
    expect(storeLocalDateTimeToIso(`${DAY}T10:00`, "America/Mazatlan")).toBe("2026-10-31T17:00:00.000Z");
    expect(storeLocalDateTimeToIso(`${DAY}T10:00:30`, "America/Mazatlan")).toBe("2026-10-31T17:00:30.000Z");
    expect(storeLocalDateTimeToIso(`${DAY}T25:00`, "America/Mazatlan")).toBeNull();
    expect(storeLocalDateTimeToIso("not-a-date", "America/Mazatlan")).toBeNull();
  });

  it("derives the business date in the store zone, not by truncating UTC", () => {
    expect(businessDateForStoreInstant("2026-11-01T06:30:00Z", "America/Mazatlan")).toBe("2026-10-31");
    expect(businessDateForStoreInstant("2026-10-31T06:30:00Z", "America/Mazatlan")).toBe("2026-10-30");
  });

  it("only marks exact, timezone-bearing, identical intervals as common coverage", () => {
    expect(intervalsHaveExactCommonCoverage({ startedAt: `${DAY}T10:00:00-07:00`, endedAt: `${DAY}T11:00:00-07:00` }, { startedAt: "2026-10-31T17:00:00Z", endedAt: "2026-10-31T18:00:00Z" })).toBe(true);
    expect(intervalsHaveExactCommonCoverage({ startedAt: `${DAY}T10:00:00-07:00`, endedAt: `${DAY}T11:00:00-07:00` }, { startedAt: `${DAY}T10:00:00-07:00`, endedAt: `${DAY}T11:01:00-07:00` })).toBe(false);
    expect(intervalsHaveExactCommonCoverage({ startedAt: `${DAY}T10:00:00`, endedAt: `${DAY}T11:00:00` }, { startedAt: `${DAY}T10:00:00-07:00`, endedAt: `${DAY}T11:00:00-07:00` })).toBe(false);
    expect(intervalsHaveExactCommonCoverage(null, null)).toBe(false);
  });

  it("rejects a cached response from another store or day before rendering", () => {
    expect(comparisonViewMatchesScope(scoped(1, DAY), 1, DAY)).toBe(true);
    expect(comparisonViewMatchesScope(scoped(2, DAY), 1, DAY)).toBe(false);
    expect(comparisonViewMatchesScope(scoped(1, "2026-10-30"), 1, DAY)).toBe(false);
    expect(comparisonViewMatchesScope(undefined, 1, DAY)).toBe(false);
  });
});
