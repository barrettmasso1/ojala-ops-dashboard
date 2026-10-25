import { describe, expect, it } from "vitest";
import { buildCounterPickupPanelModel } from "./counterPickupPresentation";

const base = {
  protocol: "ojala_counter_pickups_receipt_v1" as const,
  persisted: true as const,
  storeId: 1,
  deviceId: "38395f07-90c9-4ab4-a47e-a8881a3498fb",
  businessDate: "2026-10-24",
  cameraName: "handoff" as const,
  sequence: 1,
  documentSha256: "a".repeat(64),
  receivedAt: "2026-10-24T20:00:00.000Z",
  recordsPersisted: 1,
  partial: true as const,
  countsAreSales: false as const,
  physicalUniqueCountCertified: false as const,
  externalAiInvoked: false as const,
  requiredHumanAction: false as const,
  estimatedPickups: 0,
  sizeBreakdown: { chico: 0, mediano: 0, pint: 0, litro: 0, unknown: 0 },
  unresolvedCount: 1,
  statusCounts: { pickup_estimate: 0, tracking_unavailable: 1, no_accepted_exit: 0, path_ambiguous: 0, source_rejected: 0, owner_excluded: 0, manager_rejected: 0, identity_uncertain: 0 },
  candidateWindows: [{ from: "2026-10-24T19:00:00.000Z", until: "2026-10-24T19:02:00.000Z" }],
  geometryCalibration: "provisional_visual_orientation" as const,
  sourcePolicySha256: "b".repeat(64),
  records: [{ eventId: "c".repeat(64), sourceEventId: "1792868400.000-fixture", observationId: "d".repeat(64), businessDate: "2026-10-24", imageSha256: "e".repeat(64), effectiveStatus: "tracking_unavailable" as const, effectiveSize: "unknown" as const, completedAt: null, contributes: false, sampleCount: 0, stopReason: "tracking_lost", possibleDuplicateOf: null }],
};

describe("counter pickup presentation", () => {
  it("shows a real zero only inside observed candidate windows and never calls it sales", () => {
    const model = buildCounterPickupPanelModel(base, "2026-10-24", "America/Mazatlan", "live", 1, new Date("2026-10-24T21:00:00.000Z"));
    expect(model).toMatchObject({ value: "0", label: "Ventanas de video parciales", observed: true, unresolved: "1" });
    expect(model.message).toContain("Cero");
    expect(model.warning).toContain("no validado comercialmente");
  });

  it("keeps unavailable source as unknown rather than a false zero", () => {
    const model = buildCounterPickupPanelModel(undefined, "2026-10-24", "America/Mazatlan", "offline", 0, new Date("2026-10-24T21:00:00.000Z"));
    expect(model).toMatchObject({ value: "—", label: "No observado", observed: false });
    expect(model.sizeRows.every(row => row.value === "—")).toBe(true);
  });

  it("preserves unknown capacity separately and marks historical reads without pretending live coverage", () => {
    const model = buildCounterPickupPanelModel({ ...base, estimatedPickups: 1, sizeBreakdown: { ...base.sizeBreakdown, unknown: 1 } }, "2026-10-24", "America/Mazatlan", "live", 1, new Date("2026-10-25T21:00:00.000Z"));
    expect(model).toMatchObject({ label: "Fecha histórica", value: "1" });
    expect(model.sizeRows.find(row => row.key === "unknown")).toMatchObject({ label: "Sin clasificar", value: "1" });
  });
});
