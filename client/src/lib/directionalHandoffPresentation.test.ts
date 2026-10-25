import { describe, expect, it } from "vitest";
import { buildDirectionalHandoffPanelModel } from "./directionalHandoffPresentation";
import type { DirectionalAdminView } from "../../../server/directionalHandoff";

function view(overrides: Partial<DirectionalAdminView> = {}): DirectionalAdminView {
  return {
    protocol: "ojala_directional_handoffs_receipt_v1",
    persisted: true,
    storeId: 1,
    deviceId: "38395f07-90c9-4ab4-a47e-a8881a3498fb",
    businessDate: "2026-10-24",
    cameraName: "handoff",
    sequence: 1,
    documentSha256: "a".repeat(64),
    receivedAt: "2026-10-25T20:00:00.000Z",
    recordsPersisted: 0,
    estimatedHandoffs: 0,
    sizeBreakdown: { chico: 0, mediano: 0, pint: 0, litro: 0, unknown: 0 },
    observedFrom: "2026-10-25T20:00:00.000Z",
    observedUntil: "2026-10-25T20:01:00.000Z",
    partial: true,
    countsAreSales: false,
    physicalUniqueCountCertified: false,
    externalAiInvoked: false,
    requiredHumanAction: false,
    windows: [{ from: "2026-10-25T20:00:00.000Z", until: "2026-10-25T20:01:00.000Z", frames: 6, droppedFrames: 0 }],
    heldCandidateCount: 0,
    statusCounts: {
      awaiting_local_evidence: 0,
      estimated: 0,
      source_rejected: 0,
      owner_excluded: 0,
      evidence_conflict: 0,
      evidence_not_at_crossing: 0,
      identity_ambiguous: 0,
    },
    geometryCalibration: "provisional_visual_orientation",
    sourcePolicySha256: "b".repeat(64),
    records: [],
    ...overrides,
  };
}

describe("directional handoff panel presentation", () => {
  it("keeps no data as No observado and never invents zero or bucket values", () => {
    const result = buildDirectionalHandoffPanelModel(null, "2026-10-24", "America/Mazatlan", "empty", 0);
    expect(result.label).toBe("No observado");
    expect(result.value).toBe("—");
    expect(result.sizeRows.map(row => row.value)).toEqual(["—", "—", "—", "—", "—"]);
    expect(result.warning).toContain("no validada");
  });

  it("shows a real zero only for a partial observed interval and keeps all five sizes", () => {
    const result = buildDirectionalHandoffPanelModel(view(), "2026-10-24", "America/Mazatlan", "live", 1000);
    expect(result.label).toBe("Intervalo observado parcial");
    expect(result.value).toBe("0");
    expect(result.sizeRows.map(row => row.label)).toEqual(["Chico", "Mediano", "Pint", "Litro", "Sin clasificar"]);
    expect(result.interval).not.toBe("—");
    expect(result.connection).toBe("Recibiendo consulta");
  });

  it("does not display another day's response after a date switch", () => {
    const result = buildDirectionalHandoffPanelModel(view({ businessDate: "2026-10-23" }), "2026-10-24", "America/Mazatlan", "stale", 1000);
    expect(result.label).toBe("No observado");
    expect(result.value).toBe("—");
    expect(result.interval).toBe("—");
  });

  it("exposes identity holds and gaps without treating them as accepted estimates", () => {
    const data = view({
      windows: [{ from: "2026-10-25T20:00:00.000Z", until: "2026-10-25T20:01:00.000Z", frames: 6, droppedFrames: 1 }],
      heldCandidateCount: 2,
      statusCounts: { awaiting_local_evidence: 0, estimated: 1, source_rejected: 0, owner_excluded: 0, evidence_conflict: 0, evidence_not_at_crossing: 1, identity_ambiguous: 2 },
      estimatedHandoffs: 1,
      recordsPersisted: 4,
      records: [{ eventId: "a".repeat(64), sourceEventId: "source-001", businessDate: "2026-10-24", completedAt: "2026-10-25T20:01:00.000Z", status: "identity_ambiguous", size: "unknown", effectiveStatus: "identity_ambiguous", effectiveSize: "unknown", contributes: false, sampleCount: 6, localEvidence: null, possibleDuplicateOf: "b".repeat(64) }],
    });
    const result = buildDirectionalHandoffPanelModel(data, "2026-10-24", "America/Mazatlan", "live", 1000);
    expect(result.value).toBe("1");
    expect(result.identityHolds).toBe("2");
    expect(result.gaps).toBe("1 frames descartados; el intervalo queda fragmentado");
    expect(result.records).toBe("1");
  });
});
