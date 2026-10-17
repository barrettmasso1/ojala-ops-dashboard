export type VerifiedSnapshotImportCapture = {
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

export type VerifiedSnapshotImportItem = {
  imageDataUrl: string;
  capture: VerifiedSnapshotImportCapture;
  normalizationProof?: {
    adapter: "beelink_object_v3";
    sourceMetadataJson: string;
    sourceMetadataSha256: string;
    sourceZoneCanonicalJson: string;
  };
};

export type VerifiedSnapshotImportBatch = {
  businessDate: string;
  packageReference: string;
  items: VerifiedSnapshotImportItem[];
};

const MAX_DATA_URL_LENGTH = 12 * 1024 * 1024;
const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PACKAGE_REFERENCE = /^[A-Za-z0-9._-]{8,160}$/;

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
  const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error("Each verified snapshot must use a JPEG, PNG, or WebP base64 data URL");
  if (value.length > MAX_DATA_URL_LENGTH) throw new Error("A verified snapshot exceeds the 12 MiB import limit");
  const binary = atob(match[1]);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function sha256(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function parseCapture(value: unknown): VerifiedSnapshotImportCapture {
  const source = asRecord(value, "Each verified snapshot requires capture metadata");
  if (source.schema_version !== 3) throw new Error("Verified snapshots require schema_version 3 metadata");
  if (source.camera !== "handoff" || source.cup_zone !== "handoff_zone") {
    throw new Error("Verified snapshots must target the handoff camera and handoff_zone");
  }

  const cupEventId = asString(source.cup_event_id, "Verified snapshot cup_event_id is required");
  if (!EVENT_ID.test(cupEventId) || cupEventId.startsWith("rec-")) {
    throw new Error("Verified snapshots require an original non-recovery cup_event_id");
  }
  const capturedAt = asString(source.captured_at_utc, "Verified snapshot captured_at_utc is required");
  if (Number.isNaN(Date.parse(capturedAt))) throw new Error("Verified snapshot captured_at_utc is invalid");
  const imageSha256 = asString(source.image_sha256, "Verified snapshot image_sha256 is required");
  const zoneConfigSha256 = asString(source.zone_config_sha256, "Verified snapshot zone_config_sha256 is required");
  if (!SHA256.test(imageSha256) || !SHA256.test(zoneConfigSha256)) {
    throw new Error("Verified snapshot SHA-256 values must be lowercase hexadecimal hashes");
  }

  if (!Array.isArray(source.zone_geometry) || source.zone_geometry.length < 3 || source.zone_geometry.length > 16) {
    throw new Error("Verified snapshot zone_geometry must contain 3–16 normalized points");
  }
  const zoneGeometry = source.zone_geometry.map((point, index) => {
    const item = asRecord(point, `Zone point ${index + 1} is invalid`);
    const x = asFiniteNumber(item.x, `Zone point ${index + 1} x is invalid`);
    const y = asFiniteNumber(item.y, `Zone point ${index + 1} y is invalid`);
    if (x < 0 || x > 1 || y < 0 || y > 1) throw new Error(`Zone point ${index + 1} must be normalized between 0 and 1`);
    return { x: Number(x.toFixed(6)), y: Number(y.toFixed(6)) };
  });
  if (new Set(zoneGeometry.map(point => `${point.x}:${point.y}`)).size !== zoneGeometry.length) {
    throw new Error("Verified snapshot zone points must be distinct");
  }

  const dimensions = asRecord(source.image_dimensions, "Verified snapshot image_dimensions are required");
  const width = asFiniteNumber(dimensions.width, "Verified snapshot image width is invalid");
  const height = asFiniteNumber(dimensions.height, "Verified snapshot image height is invalid");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16_384 || height > 16_384) {
    throw new Error("Verified snapshot image dimensions are invalid");
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
 * Validates an authenticated administrative import of original Beelink snapshots.
 * It keeps this flow separate from recording-frame recovery: source identity stays
 * verified_snapshot, the server derives the store, and this document cannot create
 * sales, deliveries, inventory movements, or camera counts.
 */
export async function parseVerifiedSnapshotImportJson(text: string, selectedBusinessDate: string): Promise<VerifiedSnapshotImportBatch> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The verified snapshot import file is not valid JSON");
  }
  const document = asRecord(raw, "The verified snapshot import file must be a JSON object");
  if (document.schemaVersion !== 1) throw new Error("Unsupported verified snapshot import schemaVersion");
  if (document.intendedProcedure !== "dashboard.importVerifiedSnapshotHandoffFrame") {
    throw new Error("This file is not a verified-snapshot import");
  }
  if (document.requiresAuthenticatedAdmin !== true || document.productionCountsEligible !== false) {
    throw new Error("Verified snapshot import safety flags are missing or invalid");
  }
  if (document.transport !== "manus_official_api_administrative_review") {
    throw new Error("Verified snapshot import transport is not the approved administrative review channel");
  }
  if ("storeId" in document || "store_id" in document) {
    throw new Error("Verified snapshot import must not select a store; the server derives the authenticated store");
  }

  const businessDate = asString(document.businessDate, "Verified snapshot import businessDate is required");
  if (!BUSINESS_DATE.test(businessDate) || businessDate !== selectedBusinessDate) {
    throw new Error(`Verified snapshot import is for ${businessDate}; select that same business date before importing`);
  }
  const packageReference = asString(document.packageReference, "Verified snapshot packageReference is required");
  if (!PACKAGE_REFERENCE.test(packageReference)) throw new Error("Verified snapshot packageReference is invalid");
  if (!Array.isArray(document.items) || document.items.length < 1 || document.items.length > 25) {
    throw new Error("A verified snapshot import must contain between 1 and 25 images");
  }

  const eventIds = new Set<string>();
  const items = await Promise.all(document.items.map(async (entry, index) => {
    const item = asRecord(entry, `Verified snapshot item ${index + 1} is invalid`);
    const imageDataUrl = asString(item.imageDataUrl, `Verified snapshot item ${index + 1} image is required`);
    const capture = parseCapture(item.capture);
    const zoneHash = await sha256(new TextEncoder().encode(JSON.stringify(capture.zone_geometry)));
    if (zoneHash !== capture.zone_config_sha256) {
      throw new Error("Zone fingerprint does not match the canonical polygon; regenerate this import with the audited Beelink exporter");
    }
    if (eventIds.has(capture.cup_event_id)) throw new Error("Every verified snapshot must use a distinct cup_event_id");
    eventIds.add(capture.cup_event_id);
    const submittedHash = await sha256(bytesFromDataUrl(imageDataUrl));
    if (submittedHash !== capture.image_sha256) {
      throw new Error(`Verified snapshot ${capture.cup_event_id} does not match its declared image_sha256`);
    }
    let normalizationProof: VerifiedSnapshotImportItem["normalizationProof"];
    if (item.normalizationProof !== undefined) {
      const proof = asRecord(item.normalizationProof, "Invalid normalization proof");
      if (proof.adapter !== "beelink_object_v3") throw new Error("Unsupported normalization adapter");
      const sourceMetadataJson = asString(proof.sourceMetadataJson, "Original sidecar is required");
      const sourceMetadataSha256 = asString(proof.sourceMetadataSha256, "Original sidecar hash is required");
      const sourceZoneCanonicalJson = asString(proof.sourceZoneCanonicalJson, "Original zone bytes are required");
      if (sourceMetadataJson.length > 65_536 || sourceZoneCanonicalJson.length > 8_192
          || await sha256(new TextEncoder().encode(sourceMetadataJson)) !== sourceMetadataSha256) {
        throw new Error("Original sidecar checksum or size is invalid");
      }
      normalizationProof = { adapter: "beelink_object_v3", sourceMetadataJson, sourceMetadataSha256, sourceZoneCanonicalJson };
    }
    return { imageDataUrl, capture, ...(normalizationProof ? { normalizationProof } : {}) };
  }));

  return { businessDate, packageReference, items };
}
