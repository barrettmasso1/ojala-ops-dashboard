import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseVerifiedSnapshotImportJson } from "./handoffVerifiedSnapshotImport";

const frameBytes = Buffer.from("verified-snapshot-fixture");
const frameHash = createHash("sha256").update(frameBytes).digest("hex");
const zoneHash = "3f9c98b00a0fc36f1a3009fcaf3340910ff157f774d7531e6ac4353a12bce0e1";

function verifiedSnapshotExport(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    businessDate: "2026-10-16",
    packageReference: "OJALA_EVIDENCIA_16OCT_1743.zip",
    intendedProcedure: "dashboard.importVerifiedSnapshotHandoffFrame",
    requiresAuthenticatedAdmin: true,
    productionCountsEligible: false,
    transport: "manus_official_api_administrative_review",
    items: [{
      imageDataUrl: `data:image/jpeg;base64,${frameBytes.toString("base64")}`,
      capture: {
        schema_version: 3,
        camera: "handoff",
        cup_zone: "handoff_zone",
        cup_event_id: "1792184419.505434-vz87p4",
        captured_at_utc: "2026-10-16T21:00:25.612741+00:00",
        image_sha256: frameHash,
        zone_geometry: [
          { x: 0.45, y: 0.55 },
          { x: 0.609, y: 0.564 },
          { x: 0.605, y: 0.685 },
          { x: 0.453, y: 0.675 },
        ],
        zone_config_sha256: zoneHash,
        image_dimensions: { width: 2304, height: 1296 },
      },
    }],
    ...overrides,
  });
}

describe("verified snapshot import", () => {
  it("accepts a checksum-matched original snapshot with the no-count safety flags", async () => {
    const parsed = await parseVerifiedSnapshotImportJson(verifiedSnapshotExport(), "2026-10-16");
    expect(parsed).toMatchObject({
      businessDate: "2026-10-16",
      packageReference: "OJALA_EVIDENCIA_16OCT_1743.zip",
      items: [{ capture: { cup_event_id: "1792184419.505434-vz87p4", image_sha256: frameHash } }],
    });
  });

  it("rejects a changed image before it can be sent to the administrative mutation", async () => {
    const exportValue = JSON.parse(verifiedSnapshotExport());
    exportValue.items[0].imageDataUrl = `data:image/jpeg;base64,${Buffer.from("changed-image").toString("base64")}`;
    await expect(parseVerifiedSnapshotImportJson(JSON.stringify(exportValue), "2026-10-16"))
      .rejects.toThrow("does not match its declared image_sha256");
  });

  it("rejects a recovery event identity and a caller-selected store", async () => {
    const recovery = JSON.parse(verifiedSnapshotExport());
    recovery.items[0].capture.cup_event_id = "rec-20261016-1792184419.505434-vz87p4";
    await expect(parseVerifiedSnapshotImportJson(JSON.stringify(recovery), "2026-10-16"))
      .rejects.toThrow("original non-recovery cup_event_id");

    await expect(parseVerifiedSnapshotImportJson(verifiedSnapshotExport({ storeId: 2 }), "2026-10-16"))
      .rejects.toThrow("must not select a store");
  });

  it("rejects an import for a date other than the manager-selected date", async () => {
    await expect(parseVerifiedSnapshotImportJson(verifiedSnapshotExport(), "2026-10-15"))
      .rejects.toThrow("select that same business date");
  });
});
