import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseRecoveryImportJson } from "./handoffRecoveryImport";

const frameBytes = Buffer.from("recovered-frame-fixture");
const frameHash = createHash("sha256").update(frameBytes).digest("hex");
const zoneHash = "0c5239aac1c6d946af3a6f07319c91afcb1565acf58cb0433e18680c86e8d772";

function recoveryExport(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    businessDate: "2026-10-14",
    intendedProcedure: "dashboard.importRecordingExtractedHandoffFrame",
    requiresAuthenticatedAdmin: true,
    productionCountsEligible: false,
    items: [{
      caseReference: "ojala-20261014-recovery-01",
      imageDataUrl: `data:image/jpeg;base64,${frameBytes.toString("base64")}`,
      capture: {
        schema_version: 3,
        camera: "handoff",
        cup_zone: "handoff_zone",
        cup_event_id: "rec-20261014-1792019074.201183-2920zx",
        captured_at_utc: "2026-10-14T23:36:51.000000Z",
        image_sha256: frameHash,
        zone_geometry: [
          { x: 0.45, y: 0.55 },
          { x: 0.609, y: 0.564 },
          { x: 0.605, y: 0.685 },
          { x: 0.453, y: 0.675 },
        ],
        zone_config_sha256: zoneHash,
        image_dimensions: { width: 1920, height: 1080 },
      },
    }],
    ...overrides,
  });
}

describe("recording-frame recovery import", () => {
  it("accepts a checksum-matched recovered frame with the explicit no-count safety flags", async () => {
    const parsed = await parseRecoveryImportJson(recoveryExport(), "2026-10-14");
    expect(parsed.businessDate).toBe("2026-10-14");
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      caseReference: "ojala-20261014-recovery-01",
      capture: { cup_event_id: "rec-20261014-1792019074.201183-2920zx", image_sha256: frameHash },
    });
  });

  it("rejects a changed image before it can be sent to the administrative mutation", async () => {
    const exportValue = JSON.parse(recoveryExport());
    exportValue.items[0].imageDataUrl = `data:image/jpeg;base64,${Buffer.from("changed-image").toString("base64")}`;
    await expect(parseRecoveryImportJson(JSON.stringify(exportValue), "2026-10-14"))
      .rejects.toThrow("does not match its declared image_sha256");
  });

  it("rejects automatic event identities so originals cannot be imported as recovered frames", async () => {
    const exportValue = JSON.parse(recoveryExport());
    exportValue.items[0].capture.cup_event_id = "1792019074.201183-2920zx";
    await expect(parseRecoveryImportJson(JSON.stringify(exportValue), "2026-10-14"))
      .rejects.toThrow("distinct rec-YYYYMMDD- event ID");
  });

  it("rejects a recovery report for a day other than the manager-selected day", async () => {
    await expect(parseRecoveryImportJson(recoveryExport(), "2026-10-13"))
      .rejects.toThrow("select that same business date");
  });

  it("requires explicit recovery safety flags", async () => {
    await expect(parseRecoveryImportJson(recoveryExport({ productionCountsEligible: true }), "2026-10-14"))
      .rejects.toThrow("safety flags");
  });
});
