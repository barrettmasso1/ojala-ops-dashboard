import { createHash } from "node:crypto";
import { z } from "zod";
import { getBusinessDate } from "../shared/businessDate";
import { readLocalEvidenceObservation, type LocalLedgerBlobStore } from "./localCupLedgerStorage";
import type { LocalObservation } from "./localCupLedger";
import { LedgerConflict } from "./localCupLedgerStorage";

export const DIRECTIONAL_HANDOFF_PROTOCOL = "ojala_directional_handoffs_v1";
export const DIRECTIONAL_HANDOFF_RECEIPT_PROTOCOL = "ojala_directional_handoffs_receipt_v1";
export const DIRECTIONAL_HANDOFF_STORAGE_PREFIX = "directional-handoffs/v1";
export const DIRECTIONAL_SIZES = ["chico", "mediano", "pint", "litro", "unknown"] as const;
export type DirectionalSize = (typeof DIRECTIONAL_SIZES)[number];
export const DIRECTIONAL_STATUSES = [
  "awaiting_local_evidence",
  "estimated",
  "source_rejected",
  "owner_excluded",
  "evidence_conflict",
  "evidence_not_at_crossing",
  "identity_ambiguous",
] as const;
export type DirectionalStatus = (typeof DIRECTIONAL_STATUSES)[number];
export const DIRECTIONAL_MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const eventId = z.string().regex(/^[A-Za-z0-9_.-]{8,128}$/);
const timestamp = z.string().min(20).max(45).refine(value => /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), "timezone_timestamp_required");
const point = z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)]);
const polygon = z.array(point).min(3).max(16);
const box = z.tuple([
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
  z.number().finite().positive().max(1),
  z.number().finite().positive().max(1),
]).refine(value => value[0] + value[2] <= 1.001 && value[1] + value[3] <= 1.001, "normalized_box_bounds");

const policySchema = z.object({
  schema: z.literal("ojala_directional_policy_v1"),
  storeId: z.number().int().positive(),
  deviceId: z.string().uuid(),
  cameraName: z.literal("handoff"),
  timezone: z.string().min(1),
  detectorModelSha256: sha256,
  sourceZoneSha256: sha256,
  referenceImageSha256: sha256,
  geometryCalibration: z.literal("provisional_visual_orientation"),
  commercialAccuracyValidated: z.literal(false),
  minimumSamplesPerZone: z.literal(2),
  maxSampleGapSeconds: z.literal(1.5),
  minimumScore: z.literal(0.45),
  width: z.literal(2304),
  height: z.literal(1296),
  zones: z.object({ origin: polygon, handoff: polygon, destination: polygon }).strict(),
}).strict();
type DirectionalPolicy = z.infer<typeof policySchema>;

const sampleMetadataSchema = z.object({
  schema: z.literal("ojala_directional_sample_v1"),
  deviceId: z.string().uuid(),
  cameraName: z.literal("handoff"),
  sourceEventId: eventId,
  at: timestamp,
  box,
  score: z.number().finite().min(0.45).max(1),
  falsePositive: z.literal(false),
}).strict();
type DirectionalSampleMetadata = z.infer<typeof sampleMetadataSchema>;

const sampleSchema = z.object({ metadataJson: z.string().min(2).max(4_000), metadataSha256: sha256 }).strict();
type DirectionalSample = z.infer<typeof sampleSchema>;

const localEvidenceSchema = z.object({
  observationId: sha256,
  imageSha256: sha256,
  capturedAt: timestamp,
  size: z.enum(DIRECTIONAL_SIZES),
  sizeBasis: z.enum(["local_model_has_no_size_classes", "local_reference_estimate", "owner_confirmed_reference"]),
}).strict();
export type DirectionalLocalEvidence = z.infer<typeof localEvidenceSchema>;

const recordSchema = z.object({
  eventId: sha256,
  sourceEventId: eventId,
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  completedAt: timestamp,
  status: z.enum(DIRECTIONAL_STATUSES),
  size: z.enum(DIRECTIONAL_SIZES),
  samples: z.array(sampleSchema).min(6).max(160),
  localEvidence: localEvidenceSchema.nullable(),
  possibleDuplicateOf: sha256.nullable(),
}).strict();
export type DirectionalHandoffRecord = z.infer<typeof recordSchema>;

const windowSchema = z.object({
  from: timestamp,
  until: timestamp,
  frames: z.number().int().positive(),
  droppedFrames: z.number().int().nonnegative(),
}).strict();
export type DirectionalObservationWindow = z.infer<typeof windowSchema>;

const documentSchema = z.object({
  protocol: z.literal(DIRECTIONAL_HANDOFF_PROTOCOL),
  deviceId: z.string().uuid(),
  cameraName: z.literal("handoff"),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  policyJson: z.string().min(2).max(50_000),
  policySha256: sha256,
  windows: z.array(windowSchema).max(2_000),
  records: z.array(recordSchema).max(2_000),
  scope: z.literal("directional_handoff_estimates_not_sales"),
  requiresPerImageApproval: z.literal(false),
  generativeAiUsed: z.literal(false),
  commercialAccuracyValidated: z.literal(false),
  coversWholeBusinessDay: z.literal(false),
  physicalUniqueCountCertified: z.literal(false),
}).strict();
export type DirectionalCounterDocument = z.infer<typeof documentSchema>;

export const directionalHandoffInputSchema = z.object({
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  documentJson: z.string().min(2).max(DIRECTIONAL_MAX_DOCUMENT_BYTES),
  documentSha256: sha256,
}).strict();
export type DirectionalHandoffInput = z.infer<typeof directionalHandoffInputSchema>;

export type StoredDirectionalHandoffs = {
  schemaVersion: 1;
  storeId: number;
  sequence: number;
  documentJson: string;
  documentSha256: string;
  receivedAt: string;
};

type ParsedSample = { envelope: DirectionalSample; metadata: DirectionalSampleMetadata; atMs: number; region: "origin" | "handoff" | "destination" };
type ParsedRecord = { record: DirectionalHandoffRecord; samples: ParsedSample[]; handoffTimes: number[] };

type ReconciledRecord = {
  record: DirectionalHandoffRecord;
  effectiveStatus: DirectionalStatus;
  effectiveSize: DirectionalSize;
  contributes: boolean;
};

export type DirectionalStatusCounts = Record<DirectionalStatus, number>;

export type DirectionalReconciliation = {
  document: DirectionalCounterDocument;
  policy: DirectionalPolicy;
  parsedRecords: ParsedRecord[];
  records: ReconciledRecord[];
  estimatedHandoffs: number | null;
  sizeBreakdown: { chico: number; mediano: number; pint: number; litro: number; unknown: number } | null;
  heldCandidateCount: number;
  statusCounts: DirectionalStatusCounts;
  observedFrom: string | null;
  observedUntil: string | null;
};

export type DirectionalParseOptions = {
  /** Submit rejects an estimated row without currently valid local proof. */
  strictEstimates?: boolean;
};

export type DirectionalReceipt = {
  protocol: typeof DIRECTIONAL_HANDOFF_RECEIPT_PROTOCOL;
  persisted: true;
  storeId: number;
  deviceId: string;
  businessDate: string;
  cameraName: "handoff";
  sequence: number;
  documentSha256: string;
  receivedAt: string;
  recordsPersisted: number;
  estimatedHandoffs: number | null;
  sizeBreakdown: DirectionalReconciliation["sizeBreakdown"];
  observedFrom: string | null;
  observedUntil: string | null;
  partial: true;
  countsAreSales: false;
  physicalUniqueCountCertified: false;
  externalAiInvoked: false;
  requiredHumanAction: false;
};

export type DirectionalAdminView = DirectionalReceipt & {
  windows: DirectionalObservationWindow[];
  heldCandidateCount: number;
  statusCounts: DirectionalStatusCounts;
  geometryCalibration: "provisional_visual_orientation";
  sourcePolicySha256: string;
  records: Array<{
    eventId: string;
    sourceEventId: string;
    businessDate: string;
    completedAt: string;
    status: DirectionalStatus;
    size: DirectionalSize;
    effectiveStatus: DirectionalStatus;
    effectiveSize: DirectionalSize;
    contributes: boolean;
    sampleCount: number;
    localEvidence: DirectionalLocalEvidence | null;
    possibleDuplicateOf: string | null;
  }>;
};

export const hashText = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function pointInside(pointValue: [number, number], polygonValue: Array<[number, number]>) {
  const [x, y] = pointValue;
  let result = false;
  for (let index = 0; index < polygonValue.length; index += 1) {
    const [ax, ay] = polygonValue[index]!;
    const [bx, by] = polygonValue[(index + 1) % polygonValue.length]!;
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (Math.abs(cross) < 1e-10 && Math.min(ax, bx) <= x && x <= Math.max(ax, bx) && Math.min(ay, by) <= y && y <= Math.max(ay, by)) return true;
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) result = !result;
  }
  return result;
}

function regionForBox(value: [number, number, number, number], policy: DirectionalPolicy) {
  const center: [number, number] = [value[0] + value[2] / 2, value[1] + value[3]];
  const regions = (Object.entries(policy.zones) as Array<["origin" | "handoff" | "destination", Array<[number, number]>]>)
    .filter(([, polygonValue]) => pointInside(center, polygonValue)).map(([name]) => name);
  return regions.length === 1 ? regions[0] : null;
}

function parsePolicy(document: DirectionalCounterDocument, storeId: number) {
  if (hashText(document.policyJson) !== document.policySha256) throw new Error("policy_hash_mismatch");
  let raw: unknown;
  try { raw = JSON.parse(document.policyJson); } catch { throw new Error("policy_json_invalid"); }
  const policy = policySchema.parse(raw);
  if (canonicalJson(policy) !== document.policyJson) throw new Error("policy_json_not_canonical");
  if (policy.storeId !== storeId || policy.deviceId !== document.deviceId || policy.cameraName !== document.cameraName) throw new Error("policy_scope");
  for (const polygonValue of Object.values(policy.zones)) {
    const area = polygonValue.reduce((total, current, index) => {
      const next = polygonValue[(index + 1) % polygonValue.length]!;
      return total + current[0] * next[1] - next[0] * current[1];
    }, 0);
    if (Math.abs(area) <= 1e-7) throw new Error("policy_polygon_area");
  }
  try { new Intl.DateTimeFormat("en-US", { timeZone: policy.timezone }).format(); } catch { throw new Error("policy_timezone"); }
  return policy;
}

function parseSample(sample: DirectionalSample, record: DirectionalHandoffRecord, policy: DirectionalPolicy, businessDate: string, nowMs: number): ParsedSample {
  if (hashText(sample.metadataJson) !== sample.metadataSha256) throw new Error("sample_metadata_hash_mismatch");
  let raw: unknown;
  try { raw = JSON.parse(sample.metadataJson); } catch { throw new Error("sample_metadata_json_invalid"); }
  const metadata = sampleMetadataSchema.parse(raw);
  if (metadata.deviceId !== policy.deviceId || metadata.cameraName !== "handoff" || metadata.sourceEventId !== record.sourceEventId) throw new Error("sample_scope");
  const atMs = Date.parse(metadata.at);
  if (atMs > nowMs + 120_000) throw new Error("sample_not_live_at_receiver");
  if (getBusinessDate(new Date(atMs), policy.timezone) !== businessDate) throw new Error("sample_business_date");
  const region = regionForBox(metadata.box, policy);
  if (!region) throw new Error("sample_region_not_exactly_one");
  return { envelope: sample, metadata, atMs, region };
}

function parseWindows(document: DirectionalCounterDocument, policy: DirectionalPolicy, nowMs: number) {
  let previousUntil = -Infinity;
  for (const window of document.windows) {
    const from = Date.parse(window.from);
    const until = Date.parse(window.until);
    if (until < from || from < previousUntil) throw new Error("window_order");
    if (from > nowMs + 120_000 || until > nowMs + 120_000) throw new Error("window_not_live_at_receiver");
    if (getBusinessDate(new Date(from), policy.timezone) !== document.businessDate || getBusinessDate(new Date(until), policy.timezone) !== document.businessDate) throw new Error("window_business_date");
    previousUntil = until;
  }
  if (document.records.length > 0 && document.windows.length === 0) throw new Error("records_without_observed_window");
}

function parseRecord(record: DirectionalHandoffRecord, document: DirectionalCounterDocument, policy: DirectionalPolicy, windows: DirectionalObservationWindow[], nowMs: number): ParsedRecord {
  if (record.businessDate !== document.businessDate) throw new Error("record_business_date");
  const samples = record.samples.map(sample => parseSample(sample, record, policy, document.businessDate, nowMs));
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index]!.atMs <= samples[index - 1]!.atMs) throw new Error("sample_time_not_increasing");
    if (samples[index]!.atMs - samples[index - 1]!.atMs > 1_500) throw new Error("sample_gap_exceeds_limit");
  }
  if (samples[samples.length - 1]!.metadata.at !== record.completedAt) throw new Error("completed_at_mismatch");
  if (samples[samples.length - 1]!.atMs - samples[0]!.atMs > 30_000) throw new Error("route_duration_exceeds_limit");
  const firstAt = samples[0]!.atMs;
  const lastAt = samples[samples.length - 1]!.atMs;
  const containingWindows = windows.filter(window => firstAt >= Date.parse(window.from) && lastAt <= Date.parse(window.until));
  if (containingWindows.length !== 1) throw new Error("route_not_within_single_observed_window");
  if (containingWindows[0]!.frames < samples.length) throw new Error("window_frames_less_than_samples");
  const regions = samples.map(sample => sample.region);
  const handoffCount = regions.filter(region => region === "handoff").length;
  if (regions[0] !== "origin" || regions[1] !== "origin" || regions.at(-1) !== "destination" || regions.at(-2) !== "destination" || handoffCount < 2 || regions.slice(2, -2).some(region => region !== "handoff")) throw new Error("route_not_directional");
  const expectedEventId = hashText(`${policy.deviceId}/handoff/${record.sourceEventId}/${document.policySha256}`);
  if (record.eventId !== expectedEventId) throw new Error("event_identity_mismatch");
  return { record, samples, handoffTimes: samples.filter(sample => sample.region === "handoff").map(sample => sample.atMs) };
}

function emptyStatusCounts(): DirectionalStatusCounts {
  return Object.fromEntries(DIRECTIONAL_STATUSES.map(status => [status, 0])) as DirectionalStatusCounts;
}

async function reconcileRecord(parsed: ParsedRecord, policy: DirectionalPolicy, storeId: number, timeZone: string, store: LocalLedgerBlobStore): Promise<ReconciledRecord> {
  const { record } = parsed;
  if (record.status !== "estimated") return { record, effectiveStatus: record.status, effectiveSize: record.size, contributes: false };
  if (record.possibleDuplicateOf !== null) return { record, effectiveStatus: "identity_ambiguous", effectiveSize: "unknown", contributes: false };
  if (!record.localEvidence) return { record, effectiveStatus: "awaiting_local_evidence", effectiveSize: "unknown", contributes: false };
  const evidence = record.localEvidence;
  const observation = await readLocalEvidenceObservation(store, storeId, policy.deviceId, record.businessDate, evidence.observationId, timeZone);
  if (!observation) return { record, effectiveStatus: "awaiting_local_evidence", effectiveSize: "unknown", contributes: false };
  const invalidEvidence = validateLocalEvidence(observation, evidence, record, parsed, policy);
  if (invalidEvidence) return { record, effectiveStatus: invalidEvidence, effectiveSize: "unknown", contributes: false };
  return { record, effectiveStatus: "estimated", effectiveSize: evidence.size, contributes: true };
}

function validateLocalEvidence(observation: LocalObservation, evidence: DirectionalLocalEvidence, record: DirectionalHandoffRecord, parsed: ParsedRecord, policy: DirectionalPolicy): DirectionalStatus | null {
  if (observation.sourceEventId !== record.sourceEventId || observation.deviceId !== policy.deviceId || observation.cameraName !== "handoff") return "evidence_conflict";
  if (observation.sourceFalsePositive || observation.verification !== "same_frame_local_cv" || !observation.sameFrameEvidence) return "source_rejected";
  if (observation.ownerSizeReview?.label === "not_cup") return "owner_excluded";
  if (observation.detectorModelSha256 !== policy.detectorModelSha256 || observation.sameFrameEvidence.sourceZoneSha256 !== policy.sourceZoneSha256) return "evidence_conflict";
  if (observation.observationId !== evidence.observationId || observation.sameFrameEvidence.imageSha256 !== evidence.imageSha256 || observation.sameFrameEvidence.capturedAt !== evidence.capturedAt) return "evidence_conflict";
  if (observation.size !== evidence.size || observation.sizeBasis !== evidence.sizeBasis || record.size !== evidence.size) return "evidence_conflict";
  const capturedAt = Date.parse(evidence.capturedAt);
  const firstHandoff = parsed.handoffTimes[0]!;
  const lastHandoff = parsed.handoffTimes[parsed.handoffTimes.length - 1]!;
  if (capturedAt < firstHandoff - 2_000 || capturedAt > lastHandoff + 2_000) return "evidence_not_at_crossing";
  return null;
}

export async function parseDirectionalHandoffDocument(input: DirectionalHandoffInput, storeId: number, timeZone: string, store: LocalLedgerBlobStore, now = new Date(), options: DirectionalParseOptions = {}): Promise<DirectionalReconciliation> {
  directionalHandoffInputSchema.parse(input);
  if (Buffer.byteLength(input.documentJson, "utf8") > DIRECTIONAL_MAX_DOCUMENT_BYTES || hashText(input.documentJson) !== input.documentSha256) throw new Error("document_checksum_or_size");
  let raw: unknown;
  try { raw = JSON.parse(input.documentJson); } catch { throw new Error("document_json_invalid"); }
  const document = documentSchema.parse(raw);
  const policy = parsePolicy(document, storeId);
  if (document.businessDate > getBusinessDate(now, policy.timezone) || policy.timezone !== timeZone) throw new Error("document_business_date");
  if (document.deviceId !== policy.deviceId) throw new Error("document_device_scope");
  parseWindows(document, policy, now.getTime());
  const seenSource = new Set<string>();
  const seenEvent = new Set<string>();
  const parsedRecords = document.records.map(record => {
    if (seenSource.has(record.sourceEventId) || seenEvent.has(record.eventId)) throw new Error("duplicate_directional_identity");
    seenSource.add(record.sourceEventId); seenEvent.add(record.eventId);
    return parseRecord(record, document, policy, document.windows, now.getTime());
  });
  const records: ReconciledRecord[] = [];
  for (const parsed of parsedRecords) records.push(await reconcileRecord(parsed, policy, storeId, timeZone, store));
  if (options.strictEstimates !== false && records.some(row => row.record.status === "estimated" && !row.contributes)) throw new Error("native_evidence_invalid_for_estimate");
  const statusCounts = emptyStatusCounts();
  for (const row of records) statusCounts[row.effectiveStatus] += 1;
  const observedFrom = document.windows[0]?.from ?? null;
  const observedUntil = document.windows.at(-1)?.until ?? null;
  const sizeBreakdown = document.windows.length > 0 ? { chico: 0, mediano: 0, pint: 0, litro: 0, unknown: 0 } : null;
  for (const row of records) if (row.contributes && sizeBreakdown) sizeBreakdown[row.effectiveSize] += 1;
  return {
    document,
    policy,
    parsedRecords,
    records,
    estimatedHandoffs: document.windows.length > 0 ? records.filter(row => row.contributes).length : null,
    sizeBreakdown,
    heldCandidateCount: records.filter(row => !row.contributes).length,
    statusCounts,
    observedFrom,
    observedUntil,
  };
}

export function directionalHandoffStorageKey(storeId: number, deviceId: string, businessDate: string) {
  if (!Number.isSafeInteger(storeId) || storeId <= 0 || !z.string().uuid().safeParse(deviceId).success || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) throw new Error("directional_storage_scope");
  return `${DIRECTIONAL_HANDOFF_STORAGE_PREFIX}/store-${storeId}/${deviceId}/${businessDate}.json`;
}

function storedDirectional(reconciled: DirectionalReconciliation, storeId: number, sequence: number, documentJson: string, documentSha256: string, receivedAt = new Date().toISOString()): StoredDirectionalHandoffs {
  directionalHandoffStorageKey(storeId, reconciled.document.deviceId, reconciled.document.businessDate);
  return { schemaVersion: 1, storeId, sequence, documentJson, documentSha256, receivedAt };
}

function checkStoredDirectional(value: unknown, storeId: number, deviceId: string, businessDate: string) {
  const stored = z.object({ schemaVersion: z.literal(1), storeId: z.number().int().positive(), sequence: z.number().int().positive(), documentJson: z.string(), documentSha256: sha256, receivedAt: timestamp }).strict().parse(value) as StoredDirectionalHandoffs;
  if (stored.storeId !== storeId || stored.documentSha256 !== hashText(stored.documentJson)) throw new Error("stored_directional_checksum");
  if (stored.sequence <= 0) throw new Error("stored_directional_sequence");
  const raw = JSON.parse(stored.documentJson) as DirectionalCounterDocument;
  if (raw.deviceId !== deviceId || raw.businessDate !== businessDate) throw new Error("stored_directional_scope");
  return stored;
}

function compareDirectionalRevision(previous: StoredDirectionalHandoffs, next: DirectionalReconciliation, nextInput: DirectionalHandoffInput) {
  if (nextInput.sequence < previous.sequence) throw new Error("stale_directional_revision");
  if (nextInput.sequence === previous.sequence) {
    if (nextInput.documentSha256 !== previous.documentSha256) throw new Error("directional_revision_conflict");
    return "already_persisted" as const;
  }
  const oldDocument = documentSchema.parse(JSON.parse(previous.documentJson));
  if (oldDocument.policySha256 !== next.document.policySha256 || oldDocument.deviceId !== next.document.deviceId || oldDocument.businessDate !== next.document.businessDate) throw new Error("directional_policy_or_scope_changed");
  const nextByEvent = new Map(next.document.records.map(record => [record.eventId, record]));
  for (const oldRecord of oldDocument.records) {
    const current = nextByEvent.get(oldRecord.eventId);
    if (!current || current.sourceEventId !== oldRecord.sourceEventId || current.completedAt !== oldRecord.completedAt || canonicalJson(current.samples) !== canonicalJson(oldRecord.samples)) throw new Error("directional_route_changed_or_omitted");
  }
  if (next.document.windows.length < oldDocument.windows.length) throw new Error("directional_windows_omitted");
  oldDocument.windows.forEach((oldWindow, index) => {
    const current = next.document.windows[index];
    if (!current || current.from !== oldWindow.from || current.until < oldWindow.until || current.frames < oldWindow.frames || current.droppedFrames < oldWindow.droppedFrames) throw new Error("directional_window_not_monotone");
  });
  return "update" as const;
}

function receiptFor(reconciled: DirectionalReconciliation, stored: StoredDirectionalHandoffs): DirectionalReceipt {
  return {
    protocol: DIRECTIONAL_HANDOFF_RECEIPT_PROTOCOL,
    persisted: true,
    storeId: stored.storeId,
    deviceId: reconciled.document.deviceId,
    businessDate: reconciled.document.businessDate,
    cameraName: "handoff",
    sequence: stored.sequence,
    documentSha256: stored.documentSha256,
    receivedAt: stored.receivedAt,
    recordsPersisted: reconciled.document.records.length,
    estimatedHandoffs: reconciled.estimatedHandoffs,
    sizeBreakdown: reconciled.sizeBreakdown,
    observedFrom: reconciled.observedFrom,
    observedUntil: reconciled.observedUntil,
    partial: true,
    countsAreSales: false,
    physicalUniqueCountCertified: false,
    externalAiInvoked: false,
    requiredHumanAction: false,
  };
}

export async function saveDirectionalHandoffs(store: LocalLedgerBlobStore, input: DirectionalHandoffInput, storeId: number, timeZone: string, now = new Date()) {
  const parsed = await parseDirectionalHandoffDocument(input, storeId, timeZone, store, now);
  const key = directionalHandoffStorageKey(storeId, parsed.document.deviceId, parsed.document.businessDate);
  const next = storedDirectional(parsed, storeId, input.sequence, input.documentJson, input.documentSha256);
  let disposition: "create" | "update" | "already_persisted";
  try {
    await store.compareAndPut(key, JSON.stringify(next), null);
    disposition = "create";
  } catch (error) {
    if (!(error instanceof LedgerConflict)) throw error;
    const before = await store.read(key);
    if (!before) throw new Error("directional_create_conflict_without_existing");
    const previous = checkStoredDirectional(JSON.parse(before.text), storeId, parsed.document.deviceId, parsed.document.businessDate);
    disposition = compareDirectionalRevision(previous, parsed, input);
    if (disposition === "update") {
      await store.compareAndPut(key, JSON.stringify(next), before.etag);
    }
  }
  const actual = await store.read(key);
  if (!actual) throw new Error("directional_readback_missing");
  const persisted = checkStoredDirectional(JSON.parse(actual.text), storeId, parsed.document.deviceId, parsed.document.businessDate);
  if (persisted.sequence !== input.sequence || persisted.documentSha256 !== input.documentSha256) throw new LedgerConflict("directional_readback_conflict");
  const checked = await parseDirectionalHandoffDocument({ sequence: persisted.sequence, documentJson: persisted.documentJson, documentSha256: persisted.documentSha256 }, storeId, timeZone, store, now);
  return { success: true as const, disposition, receipt: receiptFor(checked, persisted) };
}

export async function readDirectionalHandoffs(store: LocalLedgerBlobStore, storeId: number, deviceId: string, businessDate: string, timeZone: string, now = new Date()): Promise<DirectionalAdminView | null> {
  const actual = await store.read(directionalHandoffStorageKey(storeId, deviceId, businessDate));
  if (!actual) return null;
  const persisted = checkStoredDirectional(JSON.parse(actual.text), storeId, deviceId, businessDate);
  const reconciled = await parseDirectionalHandoffDocument({ sequence: persisted.sequence, documentJson: persisted.documentJson, documentSha256: persisted.documentSha256 }, storeId, timeZone, store, now, { strictEstimates: false });
  const receipt = receiptFor(reconciled, persisted);
  return {
    ...receipt,
    windows: reconciled.document.windows,
    heldCandidateCount: reconciled.heldCandidateCount,
    statusCounts: reconciled.statusCounts,
    geometryCalibration: reconciled.policy.geometryCalibration,
    sourcePolicySha256: reconciled.document.policySha256,
    records: reconciled.records.map(row => ({
      eventId: row.record.eventId,
      sourceEventId: row.record.sourceEventId,
      businessDate: row.record.businessDate,
      completedAt: row.record.completedAt,
      status: row.record.status,
      size: row.record.size,
      effectiveStatus: row.effectiveStatus,
      effectiveSize: row.effectiveSize,
      contributes: row.contributes,
      sampleCount: row.record.samples.length,
      localEvidence: row.record.localEvidence,
      possibleDuplicateOf: row.record.possibleDuplicateOf,
    })),
  };
}

export async function readDirectionalHandoffReceipt(store: LocalLedgerBlobStore, storeId: number, deviceId: string, businessDate: string, timeZone: string, now = new Date()) {
  const view = await readDirectionalHandoffs(store, storeId, deviceId, businessDate, timeZone, now);
  return view ? receiptFromAdminView(view) : null;
}

function receiptFromAdminView(view: DirectionalAdminView): DirectionalReceipt {
  const { windows: _windows, heldCandidateCount: _held, statusCounts: _statuses, geometryCalibration: _geometry, sourcePolicySha256: _policy, records: _records, ...receipt } = view;
  return receipt;
}
