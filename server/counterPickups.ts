import { createHash } from "node:crypto";
import { z } from "zod";
import { getBusinessDate } from "../shared/businessDate";
import type { LocalObservation } from "./localCupLedger";
import { readLocalEvidenceObservation, type LocalLedgerBlobStore, LedgerConflict } from "./localCupLedgerStorage";
import { localEvidenceSource } from "./nativeLocalEvidence";

export const COUNTER_PICKUP_PROTOCOL = "ojala_counter_pickups_v1";
export const COUNTER_PICKUP_RECEIPT_PROTOCOL = "ojala_counter_pickups_receipt_v1";
export const COUNTER_PICKUP_STORAGE_PREFIX = "counter-pickups/v1";
export const COUNTER_PICKUP_MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const COUNTER_PICKUP_SIZES = ["chico", "mediano", "pint", "litro", "unknown"] as const;
export type CounterPickupSize = (typeof COUNTER_PICKUP_SIZES)[number];
export const COUNTER_PICKUP_STATUSES = [
  "pickup_estimate",
  "tracking_unavailable",
  "no_accepted_exit",
  "path_ambiguous",
  "source_rejected",
  "owner_excluded",
  "manager_rejected",
  "identity_uncertain",
] as const;
export type CounterPickupStatus = (typeof COUNTER_PICKUP_STATUSES)[number];

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const eventId = z.string().regex(/^[A-Za-z0-9_.-]{8,128}$/);
const businessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().min(20).max(45).refine(value => /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), "timezone_timestamp_required");
const number = z.number().finite();
const point = z.tuple([number.min(0).max(1), number.min(0).max(1)]);
const polygon = z.array(point).min(3).max(16);
const box = z.tuple([number.min(0).max(1), number.min(0).max(1), number.positive().max(1), number.positive().max(1)])
  .refine(value => value[0] + value[2] <= 1.001 && value[1] + value[3] <= 1.001, "normalized_box_bounds");

const policySchema = z.object({
  schema: z.literal("ojala_optical_pickup_policy_v1"),
  cameraName: z.literal("handoff"),
  deviceId: z.string().uuid(),
  timezone: z.string().min(1),
  detectorModelSha256: sha256,
  sourceZoneSha256: sha256,
  referenceImageSha256: sha256,
  geometryCalibration: z.literal("provisional_visual_orientation"),
  commercialAccuracyValidated: z.literal(false),
  width: z.literal(2304),
  height: z.literal(1296),
  recordingWidth: z.literal(1280),
  recordingHeight: z.literal(720),
  minimumFeatures: z.literal(8),
  minimumRetainedFraction: z.literal(0.2),
  maxSampleGapSeconds: z.literal(0.45),
  minimumStableSeconds: z.literal(0.4),
  minimumOutsideSamples: z.literal(2),
  minimumMotionHeights: z.literal(0.5),
  maximumDurationSeconds: z.literal(24),
  maximumForwardBackwardError: z.literal(1),
  maximumMotionResidual: z.literal(3),
  zones: z.object({ handoff: polygon, customer: polygon }).strict(),
}).strict();
type CounterPickupPolicy = z.infer<typeof policySchema>;

const sampleSchema = z.object({
  at: timestamp,
  box,
  features: z.number().int().min(8).max(50),
  retainedFraction: number.min(0.2).max(1),
  forwardBackwardError: number.min(0).max(1),
  motionResidual: number.min(0).max(3),
  frameSha256: sha256,
}).strict();
type CounterPickupSample = z.infer<typeof sampleSchema>;

const segmentPath = /^\/media\/frigate\/recordings\/\d{4}-\d{2}-\d{2}\/\d{2}\/handoff\/\d{2}\.\d{2}\.mp4$/;
const segmentSchema = z.object({
  path: z.string().max(180).refine(value => segmentPath.test(value), "recording_segment_path"),
  start: number.positive(),
  end: number.positive(),
  sha256,
}).strict().refine(value => value.end > value.start, "recording_segment_range");
export type CounterPickupSegment = z.infer<typeof segmentSchema>;

const recordSchema = z.object({
  eventId: sha256,
  sourceEventId: eventId,
  observationId: sha256,
  businessDate: businessDateSchema,
  imageSha256: sha256,
  seedCapturedAt: timestamp,
  samples: z.array(sampleSchema).max(121),
  segments: z.array(segmentSchema).max(8),
  stopReason: z.string().min(1).max(120).regex(/^[a-z0-9_:-]+$/),
  source: z.literal("recorded_video_optical_flow"),
  algorithm: z.literal("sparse_lk_forward_backward_v1"),
}).strict();
export type CounterPickupRecord = z.infer<typeof recordSchema>;

const documentSchema = z.object({
  protocol: z.literal(COUNTER_PICKUP_PROTOCOL),
  deviceId: z.string().uuid(),
  cameraName: z.literal("handoff"),
  businessDate: businessDateSchema,
  policyJson: z.string().min(2).max(50_000),
  policySha256: sha256,
  records: z.array(recordSchema).max(2_000),
  scope: z.literal("recording_optical_pickup_estimates_not_sales"),
  coverage: z.literal("candidate_recording_windows_not_continuous_day"),
  requiresPerImageApproval: z.literal(false),
  generativeAiUsed: z.literal(false),
  coversWholeBusinessDay: z.literal(false),
  physicalUniqueCountCertified: z.literal(false),
}).strict();
export type CounterPickupDocument = z.infer<typeof documentSchema>;

export const counterPickupInputSchema = z.object({
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  documentJson: z.string().min(2).max(COUNTER_PICKUP_MAX_DOCUMENT_BYTES),
  documentSha256: sha256,
}).strict();
export type CounterPickupInput = z.infer<typeof counterPickupInputSchema>;

export type CounterPickupPhoto = {
  storeId: number;
  businessDate: string;
  cameraName: string;
  cupEventId: string;
  imageSha256: string;
  imageKey: string | null;
  captureMetadataJson: string | null;
  sourceDetail: string | null;
  evidenceOrigin: string;
  analysisStatus: string;
  reviewedAt: Date | null;
  reviewedByUserId: number | null;
};
export type CounterPickupPhotoReader = (input: { storeId: number; businessDate: string; cameraName: "handoff"; sourceEventId: string }) => Promise<CounterPickupPhoto | null>;

type ParsedRecord = { record: CounterPickupRecord; samples: Array<CounterPickupSample & { atMs: number }>; seedMs: number };
type ReconciledRecord = {
  record: CounterPickupRecord;
  effectiveStatus: CounterPickupStatus;
  effectiveSize: CounterPickupSize;
  completedAt: string | null;
  contributes: boolean;
  sourceEligible: boolean;
  possibleDuplicateOf: string | null;
};
export type CounterPickupStatusCounts = Record<CounterPickupStatus, number>;
export type CounterPickupReconciliation = {
  document: CounterPickupDocument;
  policy: CounterPickupPolicy;
  parsedRecords: ParsedRecord[];
  records: ReconciledRecord[];
  estimatedPickups: number | null;
  sizeBreakdown: Record<CounterPickupSize, number> | null;
  unresolvedCount: number;
  statusCounts: CounterPickupStatusCounts;
  candidateWindows: Array<{ from: string; until: string }>;
};

export type StoredCounterPickups = {
  schemaVersion: 1;
  storeId: number;
  sequence: number;
  documentJson: string;
  documentSha256: string;
  receivedAt: string;
};

export type CounterPickupReceipt = {
  protocol: typeof COUNTER_PICKUP_RECEIPT_PROTOCOL;
  persisted: true;
  storeId: number;
  deviceId: string;
  businessDate: string;
  cameraName: "handoff";
  sequence: number;
  documentSha256: string;
  receivedAt: string;
  recordsPersisted: number;
  partial: true;
  countsAreSales: false;
  physicalUniqueCountCertified: false;
  externalAiInvoked: false;
  requiredHumanAction: false;
};

export type CounterPickupAdminView = CounterPickupReceipt & {
  estimatedPickups: number | null;
  sizeBreakdown: Record<CounterPickupSize, number> | null;
  unresolvedCount: number;
  statusCounts: CounterPickupStatusCounts;
  candidateWindows: Array<{ from: string; until: string }>;
  geometryCalibration: "provisional_visual_orientation";
  sourcePolicySha256: string;
  records: Array<{
    eventId: string;
    sourceEventId: string;
    observationId: string;
    businessDate: string;
    imageSha256: string;
    effectiveStatus: CounterPickupStatus;
    effectiveSize: CounterPickupSize;
    completedAt: string | null;
    contributes: boolean;
    sampleCount: number;
    stopReason: string;
    possibleDuplicateOf: string | null;
  }>;
};

export const hashText = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function hasDuplicateJsonObjectKeys(text: string) {
  let position = 0;
  const stringEnd = (start: number) => {
    let escaped = false;
    for (let index = start + 1; index < text.length; index += 1) {
      const character = text[index]!;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') return index + 1;
    }
    return -1;
  };
  const value = (): boolean => {
    const character = text[position];
    if (character === '"') { const end = stringEnd(position); if (end < 0) return false; position = end; return true; }
    if (character === "{") {
      position += 1;
      const keys = new Set<string>();
      if (text[position] === "}") { position += 1; return true; }
      while (true) {
        if (text[position] !== '"') return false;
        const end = stringEnd(position); if (end < 0) return false;
        let key: unknown; try { key = JSON.parse(text.slice(position, end)); } catch { return false; }
        if (typeof key !== "string" || keys.has(key)) return false;
        keys.add(key); position = end;
        if (text[position++] !== ":" || !value()) return false;
        if (text[position] === "}") { position += 1; return true; }
        if (text[position++] !== ",") return false;
      }
    }
    if (character === "[") {
      position += 1;
      if (text[position] === "]") { position += 1; return true; }
      while (true) {
        if (!value()) return false;
        if (text[position] === "]") { position += 1; return true; }
        if (text[position++] !== ",") return false;
      }
    }
    const rest = text.slice(position);
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(rest);
    if (!match) return false;
    position += match[0].length;
    return true;
  };
  return !value() || position !== text.length;
}

/** Python's canonical json keeps a source float such as 1.0 while JS would stringify it as 1.
 * Validate compact canonical structure without replacing the signed source bytes. */
function isPythonCompatibleCanonicalJson(text: string) {
  let quoted = false;
  let escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (/\s/.test(character)) return false;
  }
  if (quoted || escaped) return false;
  if (hasDuplicateJsonObjectKeys(text)) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return false; }
  const keysSorted = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.every(keysSorted);
    if (!value || typeof value !== "object") return true;
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.some((key, index) => key !== [...keys].sort()[index])) return false;
    return Object.values(value as Record<string, unknown>).every(keysSorted);
  };
  if (!keysSorted(parsed)) return false;
  const stripped = text.replace(/"(?:\\.|[^"\\])*"|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, (_part, number: string | undefined) => {
    if (!number) return "";
    const [mantissa] = number.toLowerCase().split("e");
    if (mantissa.includes(".")) {
      const fraction = mantissa.split(".")[1]!;
      if (fraction.length > 1 && fraction.endsWith("0")) return "#";
    }
    return "";
  });
  return !stripped.includes("#");
}

function pointInside(value: [number, number], area: Array<[number, number]>) {
  const [x, y] = value;
  let inside = false;
  for (let index = 0; index < area.length; index += 1) {
    const [ax, ay] = area[index]!;
    const [bx, by] = area[(index + 1) % area.length]!;
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (Math.abs(cross) < 1e-10 && Math.min(ax, bx) <= x && x <= Math.max(ax, bx) && Math.min(ay, by) <= y && y <= Math.max(ay, by)) return true;
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function boxPoint(value: [number, number, number, number]): [number, number] {
  return [value[0] + value[2] / 2, value[1] + value[3]];
}

function validatePolicy(document: CounterPickupDocument, storeId: number, timeZone: string) {
  if (hashText(document.policyJson) !== document.policySha256) throw new Error("pickup_policy_hash_mismatch");
  let raw: unknown;
  try { raw = JSON.parse(document.policyJson); } catch { throw new Error("pickup_policy_json_invalid"); }
  const policy = policySchema.parse(raw);
  if (!isPythonCompatibleCanonicalJson(document.policyJson)) throw new Error("pickup_policy_json_not_canonical");
  if (policy.deviceId !== document.deviceId || policy.cameraName !== document.cameraName || policy.timezone !== timeZone || storeId <= 0) throw new Error("pickup_policy_scope");
  for (const area of Object.values(policy.zones)) {
    const signedArea = area.reduce((total, current, index) => {
      const next = area[(index + 1) % area.length]!;
      return total + current[0] * next[1] - next[0] * current[1];
    }, 0);
    if (Math.abs(signedArea) <= 1e-7) throw new Error("pickup_policy_polygon_area");
  }
  try { new Intl.DateTimeFormat("en-US", { timeZone: policy.timezone }).format(); } catch { throw new Error("pickup_policy_timezone"); }
  return policy;
}

function sampleInSegment(atSeconds: number, segments: CounterPickupSegment[]) {
  return segments.some(segment => atSeconds >= segment.start && atSeconds <= segment.end);
}

function parseRecord(record: CounterPickupRecord, document: CounterPickupDocument, policy: CounterPickupPolicy, nowMs: number): ParsedRecord {
  if (record.businessDate !== document.businessDate) throw new Error("pickup_record_business_date");
  const expectedEventId = hashText(`${policy.deviceId}/optical-pickup/${record.sourceEventId}/${document.policySha256}`);
  if (record.eventId !== expectedEventId) throw new Error("pickup_event_identity_mismatch");
  const seedMs = Date.parse(record.seedCapturedAt);
  if (seedMs > nowMs + 120_000 || getBusinessDate(new Date(seedMs), policy.timezone) !== document.businessDate) throw new Error("pickup_seed_business_date");
  if (record.samples.length > 0 && record.segments.length === 0) throw new Error("pickup_samples_without_segments");
  let previousSegmentEnd = -Infinity;
  let previousSegmentStart = -Infinity;
  const segmentPaths = new Set<string>();
  for (const segment of record.segments) {
    if (segment.start <= previousSegmentStart || segment.start < previousSegmentEnd - 0.5 || segmentPaths.has(segment.path)) throw new Error("pickup_segment_order");
    previousSegmentStart = segment.start;
    segmentPaths.add(segment.path);
    if (segment.start * 1_000 > nowMs + 120_000 || segment.end * 1_000 > nowMs + 120_000
        || getBusinessDate(new Date(segment.start * 1_000), policy.timezone) !== document.businessDate
        || getBusinessDate(new Date(segment.end * 1_000), policy.timezone) !== document.businessDate) {
      throw new Error("pickup_segment_business_date");
    }
    previousSegmentEnd = segment.end;
  }
  const samples = record.samples.map(sample => ({ ...sample, atMs: Date.parse(sample.at) }));
  let previousAt = -Infinity;
  for (const sample of samples) {
    if (sample.atMs > nowMs + 120_000 || getBusinessDate(new Date(sample.atMs), policy.timezone) !== document.businessDate) throw new Error("pickup_sample_business_date");
    if (sample.atMs < seedMs - 400 || sample.atMs > seedMs + 24_500) throw new Error("pickup_sample_time_window");
    if (previousAt !== -Infinity && (sample.atMs <= previousAt || sample.atMs - previousAt > 450)) throw new Error("pickup_sample_gap");
    previousAt = sample.atMs;
    if (!sampleInSegment(sample.atMs / 1_000, record.segments)) throw new Error("pickup_sample_not_in_segment");
  }
  return { record, samples, seedMs };
}

function emptyStatusCounts(): CounterPickupStatusCounts {
  return Object.fromEntries(COUNTER_PICKUP_STATUSES.map(status => [status, 0])) as CounterPickupStatusCounts;
}

function sourceEligibility(observation: LocalObservation | null, record: CounterPickupRecord, policy: CounterPickupPolicy, storeId: number, photo: CounterPickupPhoto | null) {
  if (!observation || observation.deviceId !== policy.deviceId || observation.cameraName !== "handoff" || observation.businessDate !== record.businessDate || observation.observationId !== record.observationId || observation.sourceEventId !== record.sourceEventId) throw new Error("pickup_persisted_observation_missing_or_mismatch");
  if (!photo || photo.storeId !== storeId || photo.businessDate !== record.businessDate || photo.cameraName !== "handoff" || photo.cupEventId !== record.sourceEventId || photo.imageSha256 !== record.imageSha256 || !photo.imageKey || photo.evidenceOrigin !== "verified_snapshot" || photo.sourceDetail !== localEvidenceSource(observation)) throw new Error("pickup_persisted_photo_missing_or_mismatch");
  let originalCapture: unknown;
  try { originalCapture = JSON.parse(photo.captureMetadataJson ?? "{}").captured_at_utc; } catch { throw new Error("pickup_persisted_photo_metadata_invalid"); }
  if (originalCapture !== record.seedCapturedAt) throw new Error("pickup_persisted_photo_capture_mismatch");
  if ((photo.reviewedAt === null) !== (photo.reviewedByUserId === null)) throw new Error("pickup_human_review_binding_mismatch");
  if (observation.sourceFalsePositive || observation.verification === "detector_rejected" || photo.analysisStatus === "discarded") return { eligible: false, status: "source_rejected" as const, observation };
  const proof = observation.sameFrameEvidence;
  if (!proof) throw new Error("pickup_persisted_local_evidence_missing");
  if (observation.detectorModelSha256 !== policy.detectorModelSha256 || proof.sourceZoneSha256 !== policy.sourceZoneSha256 || proof.imageSha256 !== record.imageSha256 || proof.capturedAt !== record.seedCapturedAt) throw new Error("pickup_native_binding_mismatch");
  if (observation.ownerSizeReview?.label === "not_cup") return { eligible: false, status: "owner_excluded" as const, observation };
  if (photo.analysisStatus === "discarded_by_manager") return { eligible: false, status: "manager_rejected" as const, observation };
  return { eligible: true, status: null, observation };
}

function assessTrajectory(parsed: ParsedRecord, observation: LocalObservation, policy: CounterPickupPolicy): Pick<ReconciledRecord, "effectiveStatus" | "effectiveSize" | "completedAt" | "contributes"> {
  const { samples } = parsed;
  if (samples.length === 0) return { effectiveStatus: "tracking_unavailable", effectiveSize: "unknown", completedAt: null, contributes: false };
  const proof = observation.sameFrameEvidence!;
  const first = samples[0]!;
  if (first.atMs < Date.parse(proof.capturedAt) - 400 || first.atMs > Date.parse(proof.capturedAt) + 400 || first.box.some((value, index) => Math.abs(value - proof.targetBox[index]!) >= 1e-6)) throw new Error("pickup_seed_box_mismatch");
  const start = boxPoint(first.box);
  if (!pointInside(start, policy.zones.handoff) || pointInside(start, policy.zones.customer)) throw new Error("pickup_seed_not_on_counter");
  let stableStart: number | null = null;
  let armed = false;
  const outside: CounterPickupSample[] = [];
  let accepted: CounterPickupSample | null = null;
  for (const sample of samples) {
    const point = boxPoint(sample.box);
    const onCounter = pointInside(point, policy.zones.handoff) && !pointInside(point, policy.zones.customer);
    const onCustomer = pointInside(point, policy.zones.customer) && !pointInside(point, policy.zones.handoff);
    if (onCounter) {
      if (stableStart === null) stableStart = Date.parse(sample.at);
      if (Date.parse(sample.at) - stableStart >= 400 - 1e-6) armed = true;
      if (accepted) return { effectiveStatus: "path_ambiguous", effectiveSize: "unknown", completedAt: null, contributes: false };
      outside.length = 0;
      continue;
    }
    if (onCustomer && armed) {
      const displacement = Math.hypot(point[0] - start[0], point[1] - start[1]);
      if (displacement >= proof.targetBox[3] * 0.5) {
        outside.push(sample);
        if (outside.length >= 2 && !accepted) accepted = sample;
      } else {
        outside.length = 0;
      }
      continue;
    }
    return { effectiveStatus: "path_ambiguous", effectiveSize: "unknown", completedAt: null, contributes: false };
  }
  if (!accepted) return { effectiveStatus: "no_accepted_exit", effectiveSize: "unknown", completedAt: null, contributes: false };
  return { effectiveStatus: "pickup_estimate", effectiveSize: observation.size, completedAt: accepted.at, contributes: true };
}

async function reconcileRecord(parsed: ParsedRecord, policy: CounterPickupPolicy, storeId: number, timeZone: string, store: LocalLedgerBlobStore, photoReader: CounterPickupPhotoReader): Promise<ReconciledRecord> {
  const observation = await readLocalEvidenceObservation(store, storeId, policy.deviceId, parsed.record.businessDate, parsed.record.observationId, timeZone);
  const photo = await photoReader({ storeId, businessDate: parsed.record.businessDate, cameraName: "handoff", sourceEventId: parsed.record.sourceEventId });
  const source = sourceEligibility(observation, parsed.record, policy, storeId, photo);
  if (!source.eligible) return { record: parsed.record, effectiveStatus: source.status!, effectiveSize: "unknown", completedAt: null, contributes: false, sourceEligible: false, possibleDuplicateOf: null };
  const assessed = assessTrajectory(parsed, source.observation, policy);
  return { record: parsed.record, ...assessed, sourceEligible: true, possibleDuplicateOf: null };
}

function candidateWindows(records: CounterPickupRecord[]) {
  const seen = new Set<string>();
  return records.flatMap(record => record.segments.map(segment => ({ from: new Date(segment.start * 1_000).toISOString(), until: new Date(segment.end * 1_000).toISOString() })))
    .filter(window => { const key = `${window.from}/${window.until}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
}

export async function parseCounterPickupDocument(input: CounterPickupInput, storeId: number, timeZone: string, store: LocalLedgerBlobStore, photoReader: CounterPickupPhotoReader, now = new Date()) {
  counterPickupInputSchema.parse(input);
  if (Buffer.byteLength(input.documentJson, "utf8") > COUNTER_PICKUP_MAX_DOCUMENT_BYTES || hashText(input.documentJson) !== input.documentSha256) throw new Error("pickup_document_checksum_or_size");
  let raw: unknown;
  try { raw = JSON.parse(input.documentJson); } catch { throw new Error("pickup_document_json_invalid"); }
  const document = documentSchema.parse(raw);
  if (!isPythonCompatibleCanonicalJson(input.documentJson)) throw new Error("pickup_document_json_not_canonical");
  const policy = validatePolicy(document, storeId, timeZone);
  if (document.businessDate > getBusinessDate(now, policy.timezone)) throw new Error("pickup_document_business_date");
  const sources = new Set<string>(); const events = new Set<string>(); const observations = new Set<string>(); const images = new Set<string>();
  const parsedRecords = document.records.map(record => {
    if (sources.has(record.sourceEventId) || events.has(record.eventId) || observations.has(record.observationId) || images.has(record.imageSha256)) throw new Error("pickup_duplicate_identity");
    sources.add(record.sourceEventId); events.add(record.eventId); observations.add(record.observationId); images.add(record.imageSha256);
    return parseRecord(record, document, policy, now.getTime());
  });
  const records: ReconciledRecord[] = [];
  for (const parsed of parsedRecords) records.push(await reconcileRecord(parsed, policy, storeId, timeZone, store, photoReader));
  const accepted = records.filter(row => row.contributes).sort((a, b) => Date.parse(a.completedAt!) - Date.parse(b.completedAt!) || a.record.eventId.localeCompare(b.record.eventId));
  for (let index = 0; index < accepted.length; index += 1) {
    const current = accepted[index]!;
    const currentSample = current.record.samples.find(sample => sample.at === current.completedAt)!;
    const point = boxPoint(currentSample.box);
    for (const prior of accepted.slice(0, index)) {
      if (!prior.contributes || prior.completedAt === null) continue;
      const priorSample = prior.record.samples.find(sample => sample.at === prior.completedAt)!;
      const priorPoint = boxPoint(priorSample.box);
      if (Math.abs(Date.parse(current.completedAt!) - Date.parse(prior.completedAt!)) <= 2_000 && Math.hypot(point[0] - priorPoint[0], point[1] - priorPoint[1]) < 0.025) {
        current.effectiveStatus = "identity_uncertain";
        current.effectiveSize = "unknown";
        current.completedAt = null;
        current.contributes = false;
        current.possibleDuplicateOf = prior.record.eventId;
        break;
      }
    }
  }
  const statusCounts = emptyStatusCounts();
  for (const record of records) statusCounts[record.effectiveStatus] += 1;
  const windows = candidateWindows(document.records);
  const sizeBreakdown = windows.length === 0 ? null : { chico: 0, mediano: 0, pint: 0, litro: 0, unknown: 0 };
  for (const record of records) if (record.contributes && sizeBreakdown) sizeBreakdown[record.effectiveSize] += 1;
  return {
    document,
    policy,
    parsedRecords,
    records,
    estimatedPickups: windows.length === 0 ? null : records.filter(record => record.contributes).length,
    sizeBreakdown,
    unresolvedCount: records.filter(record => !["pickup_estimate", "source_rejected", "owner_excluded", "manager_rejected"].includes(record.effectiveStatus)).length,
    statusCounts,
    candidateWindows: windows,
  } satisfies CounterPickupReconciliation;
}

export function counterPickupStorageKey(storeId: number, deviceId: string, businessDate: string) {
  if (!Number.isSafeInteger(storeId) || storeId <= 0 || !z.string().uuid().safeParse(deviceId).success || !businessDateSchema.safeParse(businessDate).success) throw new Error("counter_pickup_storage_scope");
  return `${COUNTER_PICKUP_STORAGE_PREFIX}/store-${storeId}/${deviceId}/${businessDate}.json`;
}

function storedCounterPickups(reconciled: CounterPickupReconciliation, storeId: number, input: CounterPickupInput, receivedAt = new Date().toISOString()): StoredCounterPickups {
  counterPickupStorageKey(storeId, reconciled.document.deviceId, reconciled.document.businessDate);
  return { schemaVersion: 1, storeId, sequence: input.sequence, documentJson: input.documentJson, documentSha256: input.documentSha256, receivedAt };
}

function checkStored(value: unknown, storeId: number, deviceId: string, businessDate: string) {
  const stored = z.object({ schemaVersion: z.literal(1), storeId: z.number().int().positive(), sequence: z.number().int().positive(), documentJson: z.string(), documentSha256: sha256, receivedAt: timestamp }).strict().parse(value) as StoredCounterPickups;
  if (stored.storeId !== storeId || stored.documentSha256 !== hashText(stored.documentJson)) throw new Error("stored_counter_pickup_checksum");
  const document = documentSchema.parse(JSON.parse(stored.documentJson));
  if (document.deviceId !== deviceId || document.businessDate !== businessDate) throw new Error("stored_counter_pickup_scope");
  return stored;
}

function compareRevision(previous: StoredCounterPickups, next: CounterPickupReconciliation, input: CounterPickupInput) {
  if (input.sequence < previous.sequence) throw new Error("stale_counter_pickup_revision");
  if (input.sequence === previous.sequence) {
    if (input.documentSha256 !== previous.documentSha256) throw new Error("counter_pickup_revision_conflict");
    return "already_persisted" as const;
  }
  const old = documentSchema.parse(JSON.parse(previous.documentJson));
  if (old.policySha256 !== next.document.policySha256 || old.deviceId !== next.document.deviceId || old.businessDate !== next.document.businessDate) throw new Error("counter_pickup_policy_or_scope_changed");
  const byEvent = new Map(next.document.records.map(record => [record.eventId, record]));
  for (const oldRecord of old.records) {
    const current = byEvent.get(oldRecord.eventId);
    if (!current || canonicalJson(current) !== canonicalJson(oldRecord)) throw new Error("counter_pickup_record_changed_or_omitted");
  }
  return "update" as const;
}

function receiptFor(reconciled: CounterPickupReconciliation, stored: StoredCounterPickups): CounterPickupReceipt {
  return {
    protocol: COUNTER_PICKUP_RECEIPT_PROTOCOL,
    persisted: true,
    storeId: stored.storeId,
    deviceId: reconciled.document.deviceId,
    businessDate: reconciled.document.businessDate,
    cameraName: "handoff",
    sequence: stored.sequence,
    documentSha256: stored.documentSha256,
    receivedAt: stored.receivedAt,
    recordsPersisted: reconciled.document.records.length,
    partial: true,
    countsAreSales: false,
    physicalUniqueCountCertified: false,
    externalAiInvoked: false,
    requiredHumanAction: false,
  };
}

function ensureNewRecordsEligible(reconciled: CounterPickupReconciliation, existingEvents: Set<string>) {
  if (reconciled.records.some(record => !existingEvents.has(record.record.eventId) && !record.sourceEligible)) throw new Error("counter_pickup_native_evidence_invalid");
}

export async function saveCounterPickups(store: LocalLedgerBlobStore, input: CounterPickupInput, storeId: number, timeZone: string, photoReader: CounterPickupPhotoReader, now = new Date()) {
  const reconciled = await parseCounterPickupDocument(input, storeId, timeZone, store, photoReader, now);
  const key = counterPickupStorageKey(storeId, reconciled.document.deviceId, reconciled.document.businessDate);
  const next = storedCounterPickups(reconciled, storeId, input);
  let disposition: "create" | "update" | "already_persisted";
  const hasCurrentlyInvalidSource = reconciled.records.some(record => !record.sourceEligible);
  if (hasCurrentlyInvalidSource) {
    const before = await store.read(key);
    if (!before) {
      ensureNewRecordsEligible(reconciled, new Set());
      throw new Error("counter_pickup_native_evidence_invalid");
    }
    const previous = checkStored(JSON.parse(before.text), storeId, reconciled.document.deviceId, reconciled.document.businessDate);
    disposition = compareRevision(previous, reconciled, input);
    // A same-sequence receipt read is safe; any new sequence with an invalid
    // estimated source must not write a revision until the native source is corrected.
    if (disposition !== "already_persisted") throw new Error("counter_pickup_native_evidence_invalid");
  } else {
    ensureNewRecordsEligible(reconciled, new Set());
    try {
      await store.compareAndPut(key, JSON.stringify(next), null);
      disposition = "create";
    } catch (error) {
      if (!(error instanceof LedgerConflict)) throw error;
      const before = await store.read(key);
      if (!before) throw new Error("counter_pickup_create_conflict_without_existing");
      const previous = checkStored(JSON.parse(before.text), storeId, reconciled.document.deviceId, reconciled.document.businessDate);
      disposition = compareRevision(previous, reconciled, input);
      ensureNewRecordsEligible(reconciled, new Set(documentSchema.parse(JSON.parse(previous.documentJson)).records.map(record => record.eventId)));
      if (disposition === "update") await store.compareAndPut(key, JSON.stringify(next), before.etag);
    }
  }
  const actual = await store.read(key);
  if (!actual) throw new Error("counter_pickup_readback_missing");
  const persisted = checkStored(JSON.parse(actual.text), storeId, reconciled.document.deviceId, reconciled.document.businessDate);
  if (persisted.sequence !== input.sequence || persisted.documentSha256 !== input.documentSha256) throw new LedgerConflict("counter_pickup_readback_conflict");
  const checked = await parseCounterPickupDocument({ sequence: persisted.sequence, documentJson: persisted.documentJson, documentSha256: persisted.documentSha256 }, storeId, timeZone, store, photoReader, now);
  return { success: true as const, disposition, receipt: receiptFor(checked, persisted) };
}

export async function readCounterPickups(store: LocalLedgerBlobStore, storeId: number, deviceId: string, businessDate: string, timeZone: string, photoReader: CounterPickupPhotoReader, now = new Date()): Promise<CounterPickupAdminView | null> {
  const actual = await store.read(counterPickupStorageKey(storeId, deviceId, businessDate));
  if (!actual) return null;
  const persisted = checkStored(JSON.parse(actual.text), storeId, deviceId, businessDate);
  const reconciled = await parseCounterPickupDocument({ sequence: persisted.sequence, documentJson: persisted.documentJson, documentSha256: persisted.documentSha256 }, storeId, timeZone, store, photoReader, now);
  return {
    ...receiptFor(reconciled, persisted),
    estimatedPickups: reconciled.estimatedPickups,
    sizeBreakdown: reconciled.sizeBreakdown,
    unresolvedCount: reconciled.unresolvedCount,
    statusCounts: reconciled.statusCounts,
    candidateWindows: reconciled.candidateWindows,
    geometryCalibration: reconciled.policy.geometryCalibration,
    sourcePolicySha256: reconciled.document.policySha256,
    records: reconciled.records.map(record => ({
      eventId: record.record.eventId,
      sourceEventId: record.record.sourceEventId,
      observationId: record.record.observationId,
      businessDate: record.record.businessDate,
      imageSha256: record.record.imageSha256,
      effectiveStatus: record.effectiveStatus,
      effectiveSize: record.effectiveSize,
      completedAt: record.completedAt,
      contributes: record.contributes,
      sampleCount: record.record.samples.length,
      stopReason: record.record.stopReason,
      possibleDuplicateOf: record.possibleDuplicateOf,
    })),
  };
}

export async function readCounterPickupReceipt(store: LocalLedgerBlobStore, storeId: number, deviceId: string, businessDate: string, timeZone: string, photoReader: CounterPickupPhotoReader, now = new Date()) {
  const view = await readCounterPickups(store, storeId, deviceId, businessDate, timeZone, photoReader, now);
  if (!view) return null;
  const { estimatedPickups: _estimated, sizeBreakdown: _sizes, unresolvedCount: _unresolved, statusCounts: _statuses, candidateWindows: _windows, geometryCalibration: _calibration, sourcePolicySha256: _policy, records: _records, ...receipt } = view;
  return receipt;
}
