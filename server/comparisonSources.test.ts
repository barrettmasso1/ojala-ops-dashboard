import { describe, expect, it } from "vitest";
import {
  COMPARISON_CATEGORY_KEYS,
  COMPARISON_SOURCES_PROTOCOL,
  ComparisonSourcesConflict,
  comparisonSourcesStorageKey,
  hashText,
  projectShopifyComparison,
  readComparisonSources,
  saveIndependentManualComparison,
  saveShopifyComparison,
} from "./comparisonSources";
import { LedgerConflict, type BlobRead, type LocalLedgerBlobStore } from "./localCupLedgerStorage";
import { summarizeShopifySalesCsv } from "../client/src/lib/shopifySalesCsv";

const STORE = 1;
const TIME_ZONE = "America/Mazatlan";
const DAY = "2026-01-20";
const INTERVAL = { startedAt: `${DAY}T17:00:00-07:00`, endedAt: `${DAY}T18:00:00-07:00` };

class MemoryComparisonStore implements LocalLedgerBlobStore {
  current: BlobRead | null = null;
  calls: Array<{ key: string; expectedEtag: string | null; text: string }> = [];
  operations: string[] = [];
  readFailure: Error | null = null;
  readAfterPut: BlobRead | null | undefined;

  async read(key: string) {
    this.operations.push("read");
    if (this.readFailure) throw this.readFailure;
    if (this.readAfterPut !== undefined && this.calls.length > 0) return this.readAfterPut;
    return this.current;
  }
  async compareAndPut(key: string, text: string, expectedEtag: string | null) {
    this.operations.push("put");
    this.calls.push({ key, expectedEtag, text });
    if (expectedEtag === null && this.current) throw new LedgerConflict("exists");
    if (expectedEtag !== null && this.current?.etag !== expectedEtag) throw new LedgerConflict("etag changed");
    this.current = { text, etag: `"etag-${this.calls.length}"` };
  }
}

function blankCounts() {
  return { chico_here: null, chico_togo: null, mediano_here: null, mediano_togo: null, pint_togo: null, litro_togo: null };
}
function manualInput(overrides: Record<string, unknown> = {}) {
  return {
    businessDate: DAY,
    expectedRevision: null,
    sourceName: "libreta independiente",
    interval: INTERVAL,
    categories: { ...blankCounts(), chico_here: 0, mediano_togo: 3 },
    ...overrides,
  } as any;
}
const CSV = `Product title,Product variant title,Product variant SKU,Net items sold,Gross sales,Discounts,Returns,Net sales,Taxes,Total sales\nSmall (for here),Default Title,SKU-PRIVATE,2,20,0,0,20,0,20\nPint (for here),Default Title,SECRET-SKU,1,10,0,0,10,0,10\nKombucha,Default Title,OTHER-PRIVATE,4,8,0,0,8,0,8\nSmall (to go),Default Title,FRAC-SKU,1.5,10,0,0,10,0,10`;

function tomorrowInBusinessZone() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const date = new Date(`${today}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

describe("persisted comparison sources", () => {
  it("uses a tenant/date-only private key and exact six category contract", () => {
    expect(comparisonSourcesStorageKey(9, DAY)).toBe(`comparison-sources/v1/store-9/${DAY}.json`);
    expect(COMPARISON_CATEGORY_KEYS).toEqual(["chico_here", "chico_togo", "mediano_here", "mediano_togo", "pint_togo", "litro_togo"]);
    expect(COMPARISON_SOURCES_PROTOCOL).toBe("ojala_comparison_sources_v1");
  });

  it("preserves explicit zero separately from unavailable null and hashes the manual declaration server-side", async () => {
    const store = new MemoryComparisonStore();
    const result = await saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput());
    const source = result.document.manualIndependent!;
    expect(source.categories).toEqual({ ...blankCounts(), chico_here: 0, mediano_togo: 3 });
    expect(source.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.sourceKind).toBe("independent_manual_tally");
    expect(source.sourceName).toBe("libreta independiente");
    expect(source.contentSha256).not.toBe(hashText("0"));
    expect(store.calls[0]?.expectedEtag).toBeNull();
    expect(store.calls[0]?.key).toBe(comparisonSourcesStorageKey(STORE, DAY));
  });

  it("stores only a sanitized basename and redacts unnecessary contact data", async () => {
    const store = new MemoryComparisonStore();
    const saved = await saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput({ sourceName: "/private/path/tally-owner@example.test-555-123-4567.csv" }));
    expect(saved.document.manualIndependent?.sourceName).toBe("[redacted source]");
    expect(store.current?.text).not.toContain("owner@example.test");
    expect(store.current?.text).not.toContain("555-123-4567");
  });

  it("rejects an all-null manual tally so it cannot masquerade as a completed source", async () => {
    await expect(saveIndependentManualComparison(new MemoryComparisonStore(), STORE, TIME_ZONE, manualInput({ categories: blankCounts() }))).rejects.toThrow("manual_tally_has_no_explicit_categories");
  });

  it("starts a first save with create-only If-None-Match semantics and requires readback", async () => {
    const store = new MemoryComparisonStore();
    const result = await saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput());
    expect(result.disposition).toBe("saved");
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0]?.expectedEtag).toBeNull();
    expect(store.operations).toEqual(["put", "read"]);
    expect(await readComparisonSources(store, STORE, DAY, TIME_ZONE)).toMatchObject({ availability: "available", revision: result.revision });
  });

  it("rejects stale readback rather than acknowledging an unverified write", async () => {
    const store = new MemoryComparisonStore();
    store.readAfterPut = null;
    await expect(saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput())).rejects.toThrow("comparison_sources_readback_mismatch");
    expect(store.calls).toHaveLength(1);
  });

  it("treats exact duplicate imports as idempotent without another CAS write", async () => {
    const store = new MemoryComparisonStore();
    const first = await saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput());
    const duplicate = await saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput({ expectedRevision: first.revision }));
    expect(duplicate.disposition).toBe("already_persisted");
    expect(store.calls).toHaveLength(1);
  });

  it("requires the current document revision for a distinct update and uses If-Match", async () => {
    const store = new MemoryComparisonStore();
    const first = await saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput());
    await expect(saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput({ categories: { ...blankCounts(), chico_here: 4 } }))).rejects.toBeInstanceOf(ComparisonSourcesConflict);
    expect(store.calls).toHaveLength(2);
    expect(store.calls[1]?.expectedEtag).toBeNull();
    const changed = await saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput({ expectedRevision: first.revision, categories: { ...blankCounts(), chico_here: 4 } }));
    expect(changed.disposition).toBe("saved");
    expect(store.calls[2]?.expectedEtag).toBe('"etag-1"');
  });

  it("handles a create collision only after reading and verifying the existing document", async () => {
    const store = new MemoryComparisonStore();
    await saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput());
    const conflictStore = new MemoryComparisonStore();
    conflictStore.current = store.current;
    await expect(saveIndependentManualComparison(conflictStore, STORE, TIME_ZONE, manualInput({ categories: { ...blankCounts(), chico_here: 5 } }))).rejects.toBeInstanceOf(ComparisonSourcesConflict);
    expect(conflictStore.calls[0]?.expectedEtag).toBeNull();
  });

  it("does not turn a failed initial readback into absence or success", async () => {
    const store = new MemoryComparisonStore();
    store.readFailure = new Error("HTTP 403");
    await expect(saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput())).rejects.toThrow("HTTP 403");
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0]?.expectedEtag).toBeNull();
    expect(store.operations).toEqual(["put", "read"]);
    await expect(readComparisonSources(store, STORE, DAY, TIME_ZONE)).rejects.toThrow("HTTP 403");
  });

  it("rejects malformed, future, inverted, wrong-local-date and timezone-free intervals", async () => {
    const store = new MemoryComparisonStore();
    await expect(saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput({ interval: { startedAt: `${DAY}T17:00:00`, endedAt: `${DAY}T18:00:00-07:00` } }))).rejects.toThrow();
    await expect(saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput({ interval: { startedAt: `${DAY}T19:00:00-07:00`, endedAt: `${DAY}T18:00:00-07:00` } }))).rejects.toThrow("invalid_comparison_interval");
    const futureDay = tomorrowInBusinessZone();
    await expect(saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput({ businessDate: futureDay, interval: { startedAt: `${futureDay}T12:00:00-07:00`, endedAt: `${futureDay}T13:00:00-07:00` } }))).rejects.toThrow("future_comparison_business_date");
    await expect(saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput({ interval: { startedAt: "2026-01-21T12:00:00-07:00", endedAt: "2026-01-21T13:00:00-07:00" } }))).rejects.toThrow("comparison_interval_wrong_business_date");
    await expect(saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput({ interval: { startedAt: `${DAY}T23:30:00-07:00`, endedAt: "2026-01-21T00:30:00-07:00" } }))).rejects.toThrow("comparison_interval_wrong_business_date");
    await expect(readComparisonSources(store, STORE, "2026-02-30", TIME_ZONE)).rejects.toThrow("invalid_comparison_business_date");
  });

  it("rejects fractional, negative and missing category counts rather than rounding them", async () => {
    const store = new MemoryComparisonStore();
    for (const invalid of [1.2, -1, ""]) {
      await expect(saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput({ categories: { ...blankCounts(), chico_here: invalid } }))).rejects.toThrow();
    }
  });

  it("uses the existing Shopify parser, treats unsupported mode as unmapped, and persists no row data", async () => {
    const store = new MemoryComparisonStore();
    const saved = await saveShopifyComparison(store, STORE, TIME_ZONE, {
      businessDate: DAY, expectedRevision: null, sourceName: "daily-export.csv", interval: INTERVAL, csvText: CSV,
    });
    const json = store.current!.text;
    expect(saved.document.shopify?.categories).toEqual({ ...blankCounts(), chico_here: 2, chico_togo: null });
    expect(saved.document.shopify?.unmapped).toMatchObject({ rowCount: 3, knownNetItemsSold: 5, rowsWithUnknownItemCount: 1 });
    expect(json).not.toContain("SKU-PRIVATE");
    expect(json).not.toContain("SECRET-SKU");
    expect(json).not.toContain("FRAC-SKU");
    expect(json).not.toContain("Product title");
    expect(json).not.toContain("Kombucha");
    expect(saved.document.shopify?.contentSha256).toBe(hashText(CSV));
  });

  it("keeps an exact duplicate Shopify CSV import idempotent after a retry", async () => {
    const store = new MemoryComparisonStore();
    const input = { businessDate: DAY, expectedRevision: null, sourceName: "daily-export.csv", interval: INTERVAL, csvText: CSV };
    const first = await saveShopifyComparison(store, STORE, TIME_ZONE, input);
    const duplicate = await saveShopifyComparison(store, STORE, TIME_ZONE, { ...input, expectedRevision: first.revision });
    expect(duplicate.disposition).toBe("already_persisted");
    expect(store.calls).toHaveLength(1);
  });

  it("marks a mapped category unavailable if one mapped item row has an invalid fractional count", () => {
    const summary = summarizeShopifySalesCsv(`Product title,Product variant title,Product variant SKU,Net items sold\nSmall (to go),Default,anotherPrivateSku,1.5\nSmall (to go),Default,privateSku,2`);
    const projected = projectShopifyComparison(summary);
    expect(projected.categories.chico_togo).toBeNull();
    expect(projected.unmapped.rowsWithUnknownItemCount).toBe(1);
    expect(projected.unmapped.rowCount).toBe(1);
  });

  it("rejects mapped-row sums beyond safe integer precision rather than persisting a rounded aggregate", async () => {
    const csvText = "Product title,Net items sold\nSmall for here,9007199254740991\nSmall for here,1";
    await expect(saveShopifyComparison(new MemoryComparisonStore(), STORE, TIME_ZONE, { businessDate: DAY, expectedRevision: null, sourceName: "daily-export.csv", interval: INTERVAL, csvText })).rejects.toThrow("aggregate exceeds safe integer precision");
  });

  it("keeps ambiguous or negated Shopify service-mode titles unmapped", () => {
    const summary = summarizeShopifySalesCsv(`Product title,Product variant title,Product variant SKU,Net items sold\nSmall not for here,Default,one,1\nSmall for here and to go,Default,two,2`);
    const projected = projectShopifyComparison(summary);
    expect(summary.soldRows.map(row => row.serviceMode)).toEqual(["unknown", "unknown"]);
    expect(projected.categories.chico_here).toBeNull();
    expect(projected.categories.chico_togo).toBeNull();
    expect(projected.unmapped.rowCount).toBe(2);
    expect(projected.unmapped.knownNetItemsSold).toBe(3);
  });

  it("keeps exact read failures explicit and rejects documents bound to another tenant/date", async () => {
    const store = new MemoryComparisonStore();
    const written = await saveIndependentManualComparison(store, STORE, TIME_ZONE, manualInput());
    const wrongStore = await readComparisonSources(store, 2, DAY, TIME_ZONE).catch(error => error);
    expect(wrongStore).toMatchObject({ message: expect.stringContaining("comparison_sources_scope_mismatch") });
    const altered = JSON.parse(store.current!.text);
    altered.storeId = 2;
    store.current = { text: JSON.stringify(altered), etag: '"bad"' };
    await expect(readComparisonSources(store, STORE, DAY, TIME_ZONE)).rejects.toThrow("comparison_sources_scope_mismatch");
    expect(written.document.storeId).toBe(STORE);
  });
});
