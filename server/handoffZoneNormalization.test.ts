import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handoffCaptureMetadataJson, parseHandoffCaptureMetadata } from "./handoffVisualPayload";
import { metadataWithNormalizationAudit, validateVerifiedZoneNormalization } from "./handoffZoneNormalization";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const points = [{x: 0.45, y: 0.55}, {x: 0.609, y: 0.564}, {x: 0.605, y: 0.685}, {x: 0.453, y: 0.675}];
const zone = {coordinate_system: "normalized", membership_rule: "box_bottom_center", name: "handoff_zone",
  polygon: points.map(p => [p.x, p.y]), reference_height: 1296, reference_width: 2304};
const sourceZoneCanonicalJson = JSON.stringify(zone);
const source = {schema_version: 3, camera: "handoff", cup_zone: "handoff_zone", cup_event_id: "fixture-event-001",
  captured_at_utc: "2026-10-16T21:00:25.612741+00:00", image_sha256: "a".repeat(64),
  zone_geometry: zone, zone_config_sha256: hash(sourceZoneCanonicalJson), image_dimensions: {width:2304,height:1296}};
const metadata = parseHandoffCaptureMetadata({camera: source.camera, cupZone: source.cup_zone,
  cupEventId: source.cup_event_id, capturedAtUtc: source.captured_at_utc, imageSha256: source.image_sha256,
  schemaVersion:3, zoneGeometry: points, zoneConfigSha256:hash(JSON.stringify(points)), imageDimensions:source.image_dimensions});
const sourceMetadataJson = JSON.stringify(source);
const proof = {adapter:"beelink_object_v3" as const, sourceMetadataJson,
  sourceMetadataSha256:hash(sourceMetadataJson), sourceZoneCanonicalJson};

describe("audited worker-zone normalization", () => {
  it("reproduces both real Ojala zone fingerprints without changing the polygon", () => {
    const audit=validateVerifiedZoneNormalization(proof,metadata);
    expect(audit.sourceZoneConfigSha256).toBe("3f9c98b00a0fc36f1a3009fcaf3340910ff157f774d7531e6ac4353a12bce0e1");
    expect(audit.normalizedZoneConfigSha256).toBe("0c5239aac1c6d946af3a6f07319c91afcb1565acf58cb0433e18680c86e8d772");
    expect(audit.sourceMetadataJson).toBe(sourceMetadataJson);
  });
  it("rejects altered source bytes", () => {
    expect(()=>validateVerifiedZoneNormalization({...proof,sourceMetadataJson:sourceMetadataJson+" "},metadata))
      .toThrow("source metadata checksum");
  });
  it("rejects substituted zone bytes even with a valid JSON document", () => {
    expect(()=>validateVerifiedZoneNormalization({...proof,sourceZoneCanonicalJson:JSON.stringify({...zone,name:"other"})},metadata))
      .toThrow("original zone");
  });
  it.each(["cupEventId","imageSha256","capturedAtUtc"] as const)("rejects changed %s", field => {
    expect(()=>validateVerifiedZoneNormalization(proof,{...metadata,[field]:"changed"})).toThrow("capture identity");
  });
  it("rejects a changed polygon instead of blessing whatever the current server zone is", () => {
    expect(()=>validateVerifiedZoneNormalization(proof,{...metadata,capturedZoneGeometry:{points:[{x:.2,y:.2},...points.slice(1)]}}))
      .toThrow("original polygon");
  });
  it("preserves the exact previous stored metadata and source bytes in its audit", () => {
    const audit=validateVerifiedZoneNormalization(proof,metadata);
    const previous=JSON.stringify({...JSON.parse(handoffCaptureMetadataJson(metadata)),zone_config_sha256:source.zone_config_sha256});
    const corrected=JSON.parse(metadataWithNormalizationAudit(previous,handoffCaptureMetadataJson(metadata),audit)!);
    expect(corrected.normalization_audit.previousCaptureMetadataJson).toBe(previous);
    expect(corrected.normalization_audit.sourceMetadataJson).toBe(sourceMetadataJson);
    expect(corrected.cup_event_id).toBe(source.cup_event_id);
    expect(corrected.image_sha256).toBe(source.image_sha256);
    expect(metadataWithNormalizationAudit(JSON.stringify(corrected),handoffCaptureMetadataJson(metadata),audit)).toBeNull();
  });
  it("rejects an unrelated saved hash", () => {
    const previous=JSON.stringify({...JSON.parse(handoffCaptureMetadataJson(metadata)),zone_config_sha256:"b".repeat(64)});
    expect(()=>metadataWithNormalizationAudit(previous,handoffCaptureMetadataJson(metadata),validateVerifiedZoneNormalization(proof,metadata)))
      .toThrow("known mismatch");
  });
});
