import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prepareReviewedCountImport } from "./reviewedCountImport";
import { parseReviewedCountImport } from "../shared/reviewedCountImport";

const actor = { storeId: 1, userId: 91, timezone: "America/Mazatlan" };
const now = new Date("2026-10-15T03:00:00Z");
const record = {
  businessDate: "2026-10-14", cameraName: "handoff", storeId: 1,
  status: "approved", countBasis: "reviewed_unique_physical_cups",
  cupsDetected: 2, uniqueCupIds: ["fixture-a", "fixture-b"], reviewedBy: "Test reviewer",
  approvedAt: "2026-10-15T02:30:45.123456+00:00", coverage: "partial",
  gapsDescription: "Only two scenes were reviewed.",
  evidenceReferences: [{ path: "fixture/video.mp4", sha256: "a".repeat(64) }],
};
const envelope = (changes = {}) => JSON.stringify({ schemaVersion: 1,
  intendedProcedure: "dashboard.importReviewedCameraCount", recordJson: JSON.stringify({ ...record, ...changes }) });

describe("reviewed camera count import", () => {
  it("preserves the sender's exact hash/event identity and source approval time", () => {
    const text = envelope();
    const digest = createHash("sha256").update(JSON.parse(text).recordJson).digest("hex");
    const result = prepareReviewedCountImport(text, actor, now);
    expect(result.row.sourceEventId).toBe(`daily-reviewed-2026-10-14-${digest.slice(0, 32)}`);
    expect(result.row.sourceEventAt.toISOString()).toBe("2026-10-15T02:30:45.000Z");
    expect(result.row.storeId).toBe(1);
    expect(JSON.parse(result.row.sourceDetail)).toMatchObject({
      basis: "reviewed_unique_physical_cups", coverage: "partial", recordSha256: digest,
      ingestionMethod: "authenticated_admin_import", importedByUserId: 91,
    });
  });
  it("rejects a record for another store", () => {
    expect(() => prepareReviewedCountImport(envelope({ storeId: 2 }), actor, now)).toThrow("different store");
  });
  it.each([
    { status: "pending" }, { countBasis: "tracks" }, { cupsDetected: 29 },
    { cupsDetected: 1.5 }, { uniqueCupIds: ["same", "same"] }, { evidenceReferences: [] },
    { reviewedBy: "" }, { approvedAt: "2026-10-14T20:00:00" },
    { coverage: "partial", gapsDescription: "" }, { cupsDetected: 0, uniqueCupIds: [] },
    { coverage: "complete" }, { businessDate: "2026-02-30" },
  ])("rejects invalid or unreviewed evidence: %j", changes => {
    expect(() => prepareReviewedCountImport(envelope(changes), actor, now)).toThrow();
  });
  it("rejects future dates and approval before the observed day", () => {
    expect(() => prepareReviewedCountImport(envelope({ businessDate: "2026-10-16" }), actor, now)).toThrow("Future");
    expect(() => prepareReviewedCountImport(envelope({ approvedAt: "2026-10-13T12:00:00Z" }), actor, now)).toThrow("timestamp");
    expect(() => prepareReviewedCountImport(envelope({ approvedAt: "2026-10-16T12:00:00Z" }), actor, now)).toThrow("timestamp");
  });
  it("retains a genuine reviewed zero only with complete coverage", () => {
    expect(prepareReviewedCountImport(envelope({ cupsDetected: 0, uniqueCupIds: [], coverage: "complete", gapsDescription: "" }), actor, now).row.cupsDetected).toBe(0);
  });
  it("rejects private configuration and snapshot files without exposing their content", () => {
    for (const text of ['{"apiKey":"fixture-secret"}', '{"imageDataUrl":"fixture"}', 'not json']) {
      try { parseReviewedCountImport(text); throw new Error("unexpected pass"); }
      catch (error) { expect(String(error)).not.toContain("fixture-secret"); expect(String(error)).not.toContain("unexpected pass"); }
    }
  });
});
