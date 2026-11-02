import { createHash } from "node:crypto";
import { z } from "zod";
import { getBusinessDate } from "../shared/businessDate";
import { summarizeShopifySalesCsv, type ShopifyGelatoSoldRow, type ShopifySalesImportSummary } from "../client/src/lib/shopifySalesCsv";
import { LedgerConflict, type LocalLedgerBlobStore } from "./localCupLedgerStorage";

export const COMPARISON_SOURCES_PROTOCOL = "ojala_comparison_sources_v1";
export const COMPARISON_SOURCES_STORAGE_PREFIX = "comparison-sources/v1";
export const COMPARISON_SOURCES_MAX_BYTES = 128 * 1024;
export const COMPARISON_CATEGORY_KEYS = ["chico_here", "chico_togo", "mediano_here", "mediano_togo", "pint_togo", "litro_togo"] as const;
export type ComparisonCategory = (typeof COMPARISON_CATEGORY_KEYS)[number];

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i);
export const comparisonBusinessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
function validCalendarDateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}
function validTimezoneTimestamp(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || !validCalendarDateParts(match[1]!)) return false;
  const hour = Number(match[2]), minute = Number(match[3]), second = Number(match[4]);
  const offsetHour = match[7] ? Number(match[7]) : 0, offsetMinute = match[8] ? Number(match[8]) : 0;
  return hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 23 && offsetMinute <= 59 && Number.isFinite(Date.parse(value));
}
const timezoneTimestamp = z.string().min(20).max(45).refine(
  validTimezoneTimestamp,
  "timezone_timestamp_required",
);
const nullableCount = z.number().int().min(0).refine(Number.isSafeInteger, "safe_integer_required").nullable();
const safeAggregateCount = z.number().int().min(0).max(10_000).refine(Number.isSafeInteger, "safe_integer_required");
const SHOPIFY_UNMAPPED_REASONS = ["Not mapped to a gelato serving size", "Mapped size/mode with missing, invalid, negative, or fractional item count", "Size or service mode is not mapped to one of the six comparison categories"] as const;
const countsSchema = z.object({
  chico_here: nullableCount,
  chico_togo: nullableCount,
  mediano_here: nullableCount,
  mediano_togo: nullableCount,
  pint_togo: nullableCount,
  litro_togo: nullableCount,
}).strict();
const intervalSchema = z.object({ startedAt: timezoneTimestamp, endedAt: timezoneTimestamp }).strict();
const unmappedReasonSchema = z.object({ reason: z.enum(SHOPIFY_UNMAPPED_REASONS), rowCount: safeAggregateCount, knownNetItemsSold: nullableCount.unwrap(), rowsWithUnknownItemCount: safeAggregateCount }).strict();
const unmappedSchema = z.object({ rowCount: safeAggregateCount, knownNetItemsSold: nullableCount.unwrap(), rowsWithUnknownItemCount: safeAggregateCount, reasons: z.array(unmappedReasonSchema).max(12) }).strict();

const sourceSchema = z.object({
  sourceKind: z.enum(["independent_manual_tally", "shopify_csv"]),
  sourceName: z.string().min(1).max(160),
  contentSha256: sha256,
  interval: intervalSchema,
  categories: countsSchema,
  unmapped: unmappedSchema.nullable(),
  sourceFingerprint: sha256,
}).strict();
export type ComparisonSource = z.infer<typeof sourceSchema>;

const documentSchema = z.object({
  schemaVersion: z.literal(1),
  protocol: z.literal(COMPARISON_SOURCES_PROTOCOL),
  storeId: z.number().int().positive(),
  businessDate: comparisonBusinessDateSchema,
  manualIndependent: sourceSchema.nullable(),
  shopify: sourceSchema.nullable(),
}).strict();
export type ComparisonSourcesDocument = z.infer<typeof documentSchema>;

const baseInputSchema = z.object({
  businessDate: comparisonBusinessDateSchema,
  expectedRevision: sha256.nullable(),
  sourceName: z.string().trim().min(1).max(160),
  interval: intervalSchema,
}).strict();
export const independentManualComparisonInputSchema = baseInputSchema.extend({ categories: countsSchema }).strict();
export type IndependentManualComparisonInput = z.infer<typeof independentManualComparisonInputSchema>;
export const shopifyComparisonInputSchema = baseInputSchema.extend({ csvText: z.string().min(2).max(1_000_000) }).strict();
export type ShopifyComparisonInput = z.infer<typeof shopifyComparisonInputSchema>;

export type ComparisonSourcesView = { storeId: number; businessDate: string; availability: "available" | "absent" | "unavailable"; revision: string | null; document: ComparisonSourcesDocument | null };

export class ComparisonSourcesConflict extends Error {
  constructor(message = "comparison_sources_revision_conflict") { super(message); this.name = "ComparisonSourcesConflict"; }
}

export const hashText = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export function comparisonSourcesStorageKey(storeId: number, businessDate: string) {
  return `${COMPARISON_SOURCES_STORAGE_PREFIX}/store-${storeId}/${businessDate}.json`;
}

function sourceFingerprint(value: Omit<ComparisonSource, "sourceFingerprint">) {
  return hashText(JSON.stringify(value));
}

function sanitizeSourceName(value: string) {
  const basename = value.trim().replace(/\\/g, "/").split("/").pop() ?? "";
  const digits = basename.match(/\d/g)?.length ?? 0;
  if (basename.includes("@") || digits >= 10) return "[redacted source]";
  const normalized = basename
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replace(/\s+/g, " ");
  if (!normalized || normalized.length > 160) throw Error("invalid_comparison_source_name");
  return normalized;
}

function validDate(value: string) {
  return comparisonBusinessDateSchema.safeParse(value).success && validCalendarDateParts(value);
}

function validateInterval(interval: { startedAt: string; endedAt: string }, businessDate: string, timeZone: string) {
  const start = Date.parse(interval.startedAt);
  const end = Date.parse(interval.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw Error("invalid_comparison_interval");
  if (start > Date.now() || end > Date.now()) throw Error("comparison_interval_in_future");
  if (getBusinessDate(new Date(start), timeZone) !== businessDate || getBusinessDate(new Date(end), timeZone) !== businessDate) {
    throw Error("comparison_interval_wrong_business_date");
  }
}

function validateBusinessDate(businessDate: string, timeZone: string) {
  if (!validDate(businessDate)) throw Error("invalid_comparison_business_date");
  if (businessDate > getBusinessDate(new Date(), timeZone)) throw Error("future_comparison_business_date");
}

function emptyCategories(): Record<ComparisonCategory, number | null> {
  return { chico_here: null, chico_togo: null, mediano_here: null, mediano_togo: null, pint_togo: null, litro_togo: null };
}

function mappedCategory(row: ShopifyGelatoSoldRow): ComparisonCategory | null {
  if (row.sizeLabel === "4oz" && row.serviceMode === "for-here") return "chico_here";
  if (row.sizeLabel === "4oz" && row.serviceMode === "to-go") return "chico_togo";
  if (row.sizeLabel === "8oz" && row.serviceMode === "for-here") return "mediano_here";
  if (row.sizeLabel === "8oz" && row.serviceMode === "to-go") return "mediano_togo";
  if (row.sizeLabel === "Pint" && row.serviceMode === "to-go") return "pint_togo";
  if (row.sizeLabel === "Liter" && row.serviceMode === "to-go") return "litro_togo";
  return null;
}

function safeCountSum(left: number, right: number) {
  const sum = left + right;
  if (!Number.isSafeInteger(sum) || sum < 0) throw Error("Shopify CSV aggregate exceeds safe integer precision.");
  return sum;
}

export function projectShopifyComparison(summary: ShopifySalesImportSummary) {
  const categories = emptyCategories();
  const seenCategories = new Set<ComparisonCategory>();
  const uncertainCategories = new Set<ComparisonCategory>();
  const reasons = new Map<(typeof SHOPIFY_UNMAPPED_REASONS)[number], { rowCount: number; knownNetItemsSold: number; rowsWithUnknownItemCount: number }>();
  const addReason = (reason: (typeof SHOPIFY_UNMAPPED_REASONS)[number], netItemsSold: number, countIsKnown: boolean) => {
    const existing = reasons.get(reason) ?? { rowCount: 0, knownNetItemsSold: 0, rowsWithUnknownItemCount: 0 };
    existing.rowCount += 1;
    if (countIsKnown) existing.knownNetItemsSold = safeCountSum(existing.knownNetItemsSold, netItemsSold);
    else existing.rowsWithUnknownItemCount += 1;
    reasons.set(reason, existing);
  };
  for (const row of summary.soldRows) {
    const category = mappedCategory(row);
    const countIsKnown = row.netItemsSoldStatus === "integer" && Number.isSafeInteger(row.netItemsSold) && row.netItemsSold >= 0;
    if (category) {
      if (!seenCategories.has(category)) categories[category] = 0;
      seenCategories.add(category);
      if (!countIsKnown) {
        uncertainCategories.add(category);
        categories[category] = null;
        addReason("Mapped size/mode with missing, invalid, negative, or fractional item count", 0, false);
      } else if (!uncertainCategories.has(category)) {
        categories[category] = safeCountSum(categories[category]!, row.netItemsSold);
      }
    } else {
      addReason("Size or service mode is not mapped to one of the six comparison categories", row.netItemsSold, countIsKnown);
    }
  }
  for (const row of summary.excludedRows) {
    const countIsKnown = row.netItemsSoldStatus === "integer" && Number.isSafeInteger(row.netItemsSold) && row.netItemsSold >= 0;
      addReason("Not mapped to a gelato serving size", row.netItemsSold, countIsKnown);
  }
  const grouped = Array.from(reasons.entries()).map(([reason, value]) => ({ reason, ...value })).sort((a, b) => a.reason.localeCompare(b.reason));
  return {
    categories,
    unmapped: {
      rowCount: grouped.reduce((sum, item) => sum + item.rowCount, 0),
      knownNetItemsSold: grouped.reduce((sum, item) => safeCountSum(sum, item.knownNetItemsSold), 0),
      rowsWithUnknownItemCount: grouped.reduce((sum, item) => sum + item.rowsWithUnknownItemCount, 0),
      reasons: grouped,
    },
  };
}

function prepareSource(
  sourceKind: ComparisonSource["sourceKind"], sourceName: string, contentSha256: string,
  interval: { startedAt: string; endedAt: string }, categories: Record<ComparisonCategory, number | null>, unmapped: ComparisonSource["unmapped"],
): ComparisonSource {
  const body = { sourceKind, sourceName: sanitizeSourceName(sourceName), contentSha256: contentSha256.toLowerCase(), interval, categories, unmapped };
  return { ...body, sourceFingerprint: sourceFingerprint(body) };
}

function manualDeclarationHash(sourceName: string, businessDate: string, interval: { startedAt: string; endedAt: string }, categories: Record<ComparisonCategory, number | null>) {
  return hashText(JSON.stringify({ protocol: COMPARISON_SOURCES_PROTOCOL, sourceKind: "independent_manual_tally", businessDate, sourceName: sanitizeSourceName(sourceName), interval, categories }));
}

function documentRevision(document: ComparisonSourcesDocument) { return hashText(JSON.stringify(document)); }

function parseDocument(text: string, storeId: number, businessDate: string, timeZone: string) {
  if (Buffer.byteLength(text) > COMPARISON_SOURCES_MAX_BYTES) throw Error("comparison_sources_too_large");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw Error("invalid_comparison_sources_document"); }
  const document = documentSchema.parse(parsed);
  if (document.storeId !== storeId || document.businessDate !== businessDate) throw Error("comparison_sources_scope_mismatch");
  validateBusinessDate(document.businessDate, timeZone);
  for (const source of [document.manualIndependent, document.shopify]) {
    if (!source) continue;
    validateInterval(source.interval, document.businessDate, timeZone);
    if (source.sourceName !== sanitizeSourceName(source.sourceName)) throw Error("comparison_source_name_not_sanitized");
    const expected = sourceFingerprint({ sourceKind: source.sourceKind, sourceName: source.sourceName, contentSha256: source.contentSha256, interval: source.interval, categories: source.categories, unmapped: source.unmapped });
    if (source.sourceFingerprint !== expected) throw Error("comparison_source_fingerprint_mismatch");
    if (source.sourceKind === "independent_manual_tally") {
      if (Object.values(source.categories).every(value => value === null)) throw Error("manual_tally_has_no_explicit_categories");
      if (source.unmapped !== null || source.contentSha256 !== manualDeclarationHash(source.sourceName, document.businessDate, source.interval, source.categories)) throw Error("comparison_manual_declaration_mismatch");
    } else {
      if (source.unmapped === null) throw Error("comparison_shopify_unmapped_missing");
      const { reasons, rowCount, knownNetItemsSold, rowsWithUnknownItemCount } = source.unmapped;
      if (reasons.reduce((sum, reason) => sum + reason.rowCount, 0) !== rowCount
        || reasons.reduce((sum, reason) => sum + reason.knownNetItemsSold, 0) !== knownNetItemsSold
        || reasons.reduce((sum, reason) => sum + reason.rowsWithUnknownItemCount, 0) !== rowsWithUnknownItemCount) throw Error("comparison_shopify_unmapped_inconsistent");
    }
  }
  if (document.manualIndependent && document.manualIndependent.sourceKind !== "independent_manual_tally") throw Error("comparison_source_kind_mismatch");
  if (document.shopify && document.shopify.sourceKind !== "shopify_csv") throw Error("comparison_source_kind_mismatch");
  return document;
}

function emptyDocument(storeId: number, businessDate: string): ComparisonSourcesDocument {
  return { schemaVersion: 1, protocol: COMPARISON_SOURCES_PROTOCOL, storeId, businessDate, manualIndependent: null, shopify: null };
}

async function currentDocument(store: LocalLedgerBlobStore, storeId: number, businessDate: string, timeZone: string) {
  const object = await store.read(comparisonSourcesStorageKey(storeId, businessDate));
  if (!object) return { object: null, document: null as ComparisonSourcesDocument | null, revision: null as string | null };
  const document = parseDocument(object.text, storeId, businessDate, timeZone);
  return { object, document, revision: documentRevision(document) };
}

function sameSource(left: ComparisonSource | null, right: ComparisonSource) { return left?.sourceFingerprint === right.sourceFingerprint; }

async function saveSource(store: LocalLedgerBlobStore, storeId: number, timeZone: string, businessDate: string, expectedRevision: string | null, slot: "manualIndependent" | "shopify", source: ComparisonSource) {
  validateBusinessDate(businessDate, timeZone);
  validateInterval(source.interval, businessDate, timeZone);
  const key = comparisonSourcesStorageKey(storeId, businessDate);
  const nextForCreate: ComparisonSourcesDocument = { ...emptyDocument(storeId, businessDate), [slot]: source };
  if (expectedRevision === null) {
    // Do not require an initial GET: the platform may deny reads of absent
    // objects. If-None-Match:* makes this a create-only attempt, never overwrite.
    try {
      await store.compareAndPut(key, JSON.stringify(nextForCreate), null);
    } catch (error) {
      if (!(error instanceof LedgerConflict)) throw error;
      const existing = await currentDocument(store, storeId, businessDate, timeZone);
      if (existing.document && sameSource(existing.document[slot], source)) {
        return { disposition: "already_persisted" as const, revision: existing.revision!, document: existing.document };
      }
      if (!existing.document) throw Error("comparison_create_conflict_without_readable_document");
      throw new ComparisonSourcesConflict();
    }
    const readback = await currentDocument(store, storeId, businessDate, timeZone);
    if (!readback.document || !readback.revision || !sameSource(readback.document[slot], source)) throw Error("comparison_sources_readback_mismatch");
    return { disposition: "saved" as const, revision: readback.revision, document: readback.document };
  }

  const before = await currentDocument(store, storeId, businessDate, timeZone);
  // Exact retries are idempotent even when another source slot was later updated.
  if (sameSource(before.document?.[slot] ?? null, source)) {
    return { disposition: "already_persisted" as const, revision: before.revision!, document: before.document! };
  }
  if (before.revision !== expectedRevision) throw new ComparisonSourcesConflict();
  const next: ComparisonSourcesDocument = { ...(before.document ?? emptyDocument(storeId, businessDate)), [slot]: source };
  try { await store.compareAndPut(key, JSON.stringify(next), before.object!.etag); }
  catch (error) {
    if (!(error instanceof LedgerConflict)) throw error;
    const current = await currentDocument(store, storeId, businessDate, timeZone);
    if (current.document && sameSource(current.document[slot], source)) {
      return { disposition: "already_persisted" as const, revision: current.revision!, document: current.document };
    }
    throw new ComparisonSourcesConflict();
  }
  // A successful PUT is not an acknowledgement until a strong-ETag readback validates the exact source.
  const after = await currentDocument(store, storeId, businessDate, timeZone);
  if (!after.document || !after.revision || !sameSource(after.document[slot], source)) throw Error("comparison_sources_readback_mismatch");
  return { disposition: "saved" as const, revision: after.revision, document: after.document };
}

export async function saveIndependentManualComparison(store: LocalLedgerBlobStore, storeId: number, timeZone: string, input: IndependentManualComparisonInput) {
  const parsed = independentManualComparisonInputSchema.parse(input);
  if (Object.values(parsed.categories).every(value => value === null)) throw Error("manual_tally_has_no_explicit_categories");
  const sourceName = sanitizeSourceName(parsed.sourceName);
  const contentSha256 = manualDeclarationHash(sourceName, parsed.businessDate, parsed.interval, parsed.categories);
  const source = prepareSource("independent_manual_tally", sourceName, contentSha256, parsed.interval, parsed.categories, null);
  return saveSource(store, storeId, timeZone, parsed.businessDate, parsed.expectedRevision, "manualIndependent", source);
}

export async function saveShopifyComparison(store: LocalLedgerBlobStore, storeId: number, timeZone: string, input: ShopifyComparisonInput) {
  const parsed = shopifyComparisonInputSchema.parse(input);
  const summary = summarizeShopifySalesCsv(parsed.csvText);
  const projection = projectShopifyComparison(summary);
  const contentSha256 = hashText(parsed.csvText);
  const source = prepareSource("shopify_csv", parsed.sourceName, contentSha256, parsed.interval, projection.categories, projection.unmapped);
  return saveSource(store, storeId, timeZone, parsed.businessDate, parsed.expectedRevision, "shopify", source);
}

export async function readComparisonSources(store: LocalLedgerBlobStore, storeId: number, businessDate: string, timeZone: string): Promise<ComparisonSourcesView> {
  validateBusinessDate(businessDate, timeZone);
  const current = await currentDocument(store, storeId, businessDate, timeZone);
  if (!current.document || !current.revision) return { storeId, businessDate, availability: "absent", revision: null, document: null };
  return { storeId, businessDate, availability: "available", revision: current.revision, document: current.document };
}
