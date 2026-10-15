export type RecoveryImportCapture = {
  schema_version: 3;
  camera: "handoff";
  cup_zone: "handoff_zone";
  cup_event_id: string;
  captured_at_utc: string;
  image_sha256: string;
  zone_geometry: Array<{ x: number; y: number }>;
  zone_config_sha256: string;
  image_dimensions: { width: number; height: number };
};

export type RecoveryImportItem = {
  caseReference: string;
  imageDataUrl: string;
  capture: RecoveryImportCapture;
};

export type RecoveryImportBatch = {
  businessDate: string;
  items: RecoveryImportItem[];
};

const MAX_DATA_URL_LENGTH = 12 * 1024 * 1024;
const CASE_REFERENCE = /^[A-Za-z0-9._-]{8,128}$/;
const RECOVERED_EVENT = /^rec-\d{8}-[A-Za-z0-9._-]{4,112}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function asString(value: unknown, message: string) {
  if (typeof value !== "string" || !value) throw new Error(message);
  return value;
}

function asFiniteNumber(value: unknown, message: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(message);
  return value;
}

function bytesFromDataUrl(value: string) {
  const match = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error("Each recovered frame must use a JPEG or PNG base64 data URL");
  if (value.length > MAX_DATA_URL_LENGTH) throw new Error("A recovered frame exceeds the 12 MiB import limit");
  const binary = atob(match[1]);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function sha256(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function parseCapture(value: unknown): RecoveryImportCapture {
  const source = asRecord(value, "Each recovered frame requires capture metadata");
  if (source.schema_version !== 3) throw new Error("Recovered-frame imports require schema_version 3 metadata");
  if (source.camera !== "handoff" || source.cup_zone !== "handoff_zone") {
    throw new Error("Recovered-frame imports must target the handoff camera and handoff_zone");
  }

  const cupEventId = asString(source.cup_event_id, "Recovered-frame cup_event_id is required");
  if (!RECOVERED_EVENT.test(cupEventId)) {
    throw new Error("Recovered frames must use a distinct rec-YYYYMMDD- event ID; automatic capture IDs are not accepted");
  }
  const capturedAt = asString(source.captured_at_utc, "Recovered-frame captured_at_utc is required");
  if (Number.isNaN(Date.parse(capturedAt))) throw new Error("Recovered-frame captured_at_utc is invalid");
  const imageSha256 = asString(source.image_sha256, "Recovered-frame image_sha256 is required");
  const zoneConfigSha256 = asString(source.zone_config_sha256, "Recovered-frame zone_config_sha256 is required");
  if (!SHA256.test(imageSha256) || !SHA256.test(zoneConfigSha256)) {
    throw new Error("Recovered-frame SHA-256 values must be lowercase hexadecimal hashes");
  }

  if (!Array.isArray(source.zone_geometry) || source.zone_geometry.length < 3 || source.zone_geometry.length > 16) {
    throw new Error("Recovered-frame zone_geometry must contain 3–16 normalized points");
  }
  const zoneGeometry = source.zone_geometry.map((point, index) => {
    const item = asRecord(point, `Zone point ${index + 1} is invalid`);
    const x = asFiniteNumber(item.x, `Zone point ${index + 1} x is invalid`);
    const y = asFiniteNumber(item.y, `Zone point ${index + 1} y is invalid`);
    if (x < 0 || x > 1 || y < 0 || y > 1) throw new Error(`Zone point ${index + 1} must be normalized between 0 and 1`);
    return { x, y };
  });

  const dimensions = asRecord(source.image_dimensions, "Recovered-frame image_dimensions are required");
  const width = asFiniteNumber(dimensions.width, "Recovered-frame image width is invalid");
  const height = asFiniteNumber(dimensions.height, "Recovered-frame image height is invalid");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16_384 || height > 16_384) {
    throw new Error("Recovered-frame image dimensions are invalid");
  }

  return {
    schema_version: 3,
    camera: "handoff",
    cup_zone: "handoff_zone",
    cup_event_id: cupEventId,
    captured_at_utc: capturedAt,
    image_sha256: imageSha256,
    zone_geometry: zoneGeometry,
    zone_config_sha256: zoneConfigSha256,
    image_dimensions: { width, height },
  };
}

/**
 * Parses the Beelink recovery export before it reaches the protected mutation.
 * The server independently verifies the logged-in store, active zone and
 * origin; this browser-side check prevents accidental import of originals,
 * automatic event IDs, mismatched image bytes, or a report for another date.
 */
export async function parseRecoveryImportJson(text: string, selectedBusinessDate: string): Promise<RecoveryImportBatch> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The recovery import file is not valid JSON");
  }
  const document = asRecord(raw, "The recovery import file must be a JSON object");
  if (document.schemaVersion !== 1) throw new Error("Unsupported recovery import schemaVersion");
  if (document.intendedProcedure !== "dashboard.importRecordingExtractedHandoffFrame") {
    throw new Error("This file is not a recording-frame recovery import");
  }
  if (document.requiresAuthenticatedAdmin !== true || document.productionCountsEligible !== false) {
    throw new Error("Recovery import safety flags are missing or invalid");
  }
  const businessDate = asString(document.businessDate, "Recovery import businessDate is required");
  if (!BUSINESS_DATE.test(businessDate) || businessDate !== selectedBusinessDate) {
    throw new Error(`Recovery import is for ${businessDate}; select that same business date before importing`);
  }
  if (!Array.isArray(document.items) || document.items.length < 1 || document.items.length > 25) {
    throw new Error("A recovery import must contain between 1 and 25 frames");
  }

  const eventIds = new Set<string>();
  const items = await Promise.all(document.items.map(async (entry, index) => {
    const item = asRecord(entry, `Recovery item ${index + 1} is invalid`);
    const caseReference = asString(item.caseReference, `Recovery item ${index + 1} caseReference is required`);
    if (!CASE_REFERENCE.test(caseReference)) throw new Error(`Recovery item ${index + 1} has an invalid caseReference`);
    const imageDataUrl = asString(item.imageDataUrl, `Recovery item ${index + 1} image is required`);
    const capture = parseCapture(item.capture);
    if (eventIds.has(capture.cup_event_id)) throw new Error("Every recovered frame must use a distinct rec- event ID");
    eventIds.add(capture.cup_event_id);
    const submittedHash = await sha256(bytesFromDataUrl(imageDataUrl));
    if (submittedHash !== capture.image_sha256) {
      throw new Error(`Recovered frame ${capture.cup_event_id} does not match its declared image_sha256`);
    }
    return { caseReference, imageDataUrl, capture };
  }));

  return { businessDate, items };
}
