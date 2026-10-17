import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { handoffZoneConfigSha256, parseHandoffZoneGeometry, serializeHandoffZoneGeometry } from "./handoffZoneGeometry";
import type { HandoffCaptureMetadata } from "./handoffVisualPayload";

export type VerifiedZoneNormalizationProof = {
  adapter: "beelink_object_v3";
  sourceMetadataJson: string;
  sourceMetadataSha256: string;
  sourceZoneCanonicalJson: string;
};

export type VerifiedZoneNormalizationAudit = VerifiedZoneNormalizationProof & {
  sourceZoneConfigSha256: string;
  normalizedZoneConfigSha256: string;
  previousCaptureMetadataJson?: string;
};

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const requireCondition = (value: unknown, message: string) => {
  if (!value) throw new Error(`Invalid zone normalization proof: ${message}`);
};

/** Validate original bytes and meaning BEFORE adapting a descriptive worker zone.
 * The server's configured polygon remains an independent authorization boundary.
 * No approximation to a newer zone, image substitution, or count is permitted.
 */
export function validateVerifiedZoneNormalization(
  proof: VerifiedZoneNormalizationProof,
  metadata: HandoffCaptureMetadata,
): VerifiedZoneNormalizationAudit {
  requireCondition(proof.adapter === "beelink_object_v3", "unsupported adapter");
  requireCondition(proof.sourceMetadataJson.length <= 65_536 && proof.sourceZoneCanonicalJson.length <= 8_192,
    "source is too large");
  requireCondition(hash(proof.sourceMetadataJson) === proof.sourceMetadataSha256, "source metadata checksum");
  const source = JSON.parse(proof.sourceMetadataJson);
  const zone = source.zone_geometry;
  const serializedZone = JSON.parse(proof.sourceZoneCanonicalJson);
  requireCondition(zone && typeof zone === "object" && !Array.isArray(zone), "worker zone object required");
  requireCondition(isDeepStrictEqual(zone, serializedZone), "zone bytes do not describe original zone");
  requireCondition(Object.keys(zone).sort().join(",") ===
    "coordinate_system,membership_rule,name,polygon,reference_height,reference_width", "zone fields");
  requireCondition(zone.name === "handoff_zone" && zone.coordinate_system === "normalized"
    && zone.membership_rule === "box_bottom_center", "zone meaning changed");
  requireCondition(hash(proof.sourceZoneCanonicalJson) === source.zone_config_sha256, "original zone checksum");
  requireCondition(source.schema_version === 3 && metadata.schemaVersion === 3
    && source.camera === metadata.camera && source.cup_zone === metadata.cupZone
    && source.cup_event_id === metadata.cupEventId
    && source.image_sha256 === metadata.imageSha256
    && source.captured_at_utc === metadata.capturedAtUtc, "capture identity changed");
  requireCondition(isDeepStrictEqual(source.image_dimensions, metadata.imageDimensions)
    && zone.reference_width === metadata.imageDimensions?.width
    && zone.reference_height === metadata.imageDimensions?.height, "reference dimensions changed");
  requireCondition(Array.isArray(zone.polygon) && zone.polygon.every((p: unknown) => Array.isArray(p) && p.length === 2),
    "invalid polygon");
  const geometry = parseHandoffZoneGeometry(zone.polygon.map((p: number[]) => ({ x: p[0], y: p[1] })));
  const normalizedHash = handoffZoneConfigSha256(geometry);
  requireCondition(serializeHandoffZoneGeometry(geometry) === serializeHandoffZoneGeometry(metadata.capturedZoneGeometry!)
    && normalizedHash === metadata.capturedZoneConfigSha256, "normalized zone does not match original polygon");
  return { ...proof, sourceZoneConfigSha256: source.zone_config_sha256,
    normalizedZoneConfigSha256: normalizedHash };
}

/** Only the known object-to-array serialization mismatch may be repaired.
 * Existing reviewed decisions are protected separately by the DB compare-and-swap.
 */
export function metadataWithNormalizationAudit(
  previousJson: string,
  normalizedJson: string,
  audit: VerifiedZoneNormalizationAudit,
): string | null {
  const previous = JSON.parse(previousJson);
  const normalized = JSON.parse(normalizedJson);
  for (const field of ["schema_version", "camera", "cup_zone", "cup_event_id", "captured_at_utc", "image_sha256", "image_dimensions"]) {
    requireCondition(isDeepStrictEqual(previous[field], normalized[field]), `stored ${field} changed`);
  }
  requireCondition(isDeepStrictEqual(previous.zone_geometry, normalized.zone_geometry), "stored polygon changed");
  if (previous.zone_config_sha256 === normalized.zone_config_sha256) return null;
  requireCondition(previous.zone_config_sha256 === audit.sourceZoneConfigSha256
    && normalized.zone_config_sha256 === audit.normalizedZoneConfigSha256, "stored hash is not the known mismatch");
  const serialized = JSON.stringify({ ...normalized,
    normalization_audit: { ...audit, previousCaptureMetadataJson: previousJson } });
  requireCondition(Buffer.byteLength(serialized, "utf8") <= 60_000, "audit exceeds storage limit");
  return serialized;
}
