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
    receivedAt: "2026-10-24T20:01:00.000Z",
    recordsPersisted: 0,
    estimatedHandoffs: 0,
    sizeBreakdown: { chico: 0, mediano: 0, pint: 0, litro: 0, unknown: 0 },
    observedFrom: "2026-10-24T20:00:00.000Z",
    observedUntil: "2026-10-24T20:01:00.000Z",
    partial: true,
    countsAreSales: false,
    physicalUniqueCountCertified: false,
    externalAiInvoked: false,
    requiredHumanAction: false,
    windows: [{ from: "2026-10-24T20:00:00.000Z", until: "2026-10-24T20:01:00.000Z", frames: 6, droppedFrames: 0 }],
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
    const result = buildDirectionalHandoffPanelModel(null, "2026-10-24", "America/Mazatlan", "empty", 0, new Date("2026-10-24T20:01:00.000Z"));
    expect(result.label).toBe("No observado");
    expect(result.value).toBe("—");
    expect(result.sizeRows.map(row => row.value)).toEqual(["—", "—", "—", "—", "—"]);
    expect(result.warning).toContain("no validada");
  });

  it("separates frame reception from absent accepted delivery paths", () => {
    const result = buildDirectionalHandoffPanelModel(view(), "2026-10-24", "America/Mazatlan", "live", 1000, new Date("2026-10-24T20:01:05.000Z"));
    expect(result.label).toBe("Sin recorrido concluyente");
    expect(result.value).toBe("No disponible");
    expect(result.sizeRows.map(row => row.label)).toEqual(["Chico", "Mediano", "Pint", "Litro", "Sin clasificar"]);
    expect(result.freshness).toBe("Fotogramas recientes");
    expect(result.connection).toBe("Consulta HTTP recibida");
  });

  it("marks a same-day successful poll as camera-stale after 15 seconds", () => {
    const result = buildDirectionalHandoffPanelModel(view(), "2026-10-24", "America/Mazatlan", "live", 1000, new Date("2026-10-24T20:01:16.000Z"));
    expect(result.connection).toBe("Consulta HTTP recibida");
    expect(result.freshness).toBe("Sin fotogramas recientes");
    expect(result.value).toBe("No disponible");
  });

  it("labels a historical date separately even when the HTTP query succeeds", () => {
    const result = buildDirectionalHandoffPanelModel(view(), "2026-10-23", "America/Mazatlan", "live", 1000, new Date("2026-10-24T20:01:00.000Z"));
    expect(result.label).toBe("Fecha histórica");
    expect(result.freshness).toBe("Fecha histórica");
    expect(result.value).toBe("—");
  });

  it("does not display another day's response after a date switch", () => {
    const result = buildDirectionalHandoffPanelModel(view({ businessDate: "2026-10-23" }), "2026-10-24", "America/Mazatlan", "stale", 1000, new Date("2026-10-24T20:01:00.000Z"));
    expect(result.label).toBe("No observado");
    expect(result.value).toBe("—");
    expect(result.interval).toBe("—");
  });

  it("shows window gaps and dropped frames separately without treating them as accepted estimates", () => {
    const data = view({
      windows: [
        { from: "2026-10-24T20:00:00.000Z", until: "2026-10-24T20:01:00.000Z", frames: 6, droppedFrames: 2 },
        { from: "2026-10-24T20:01:05.000Z", until: "2026-10-24T20:02:00.000Z", frames: 6, droppedFrames: 1 },
      ],
      heldCandidateCount: 2,
      statusCounts: { awaiting_local_evidence: 0, estimated: 1, source_rejected: 0, owner_excluded: 0, evidence_conflict: 0, evidence_not_at_crossing: 1, identity_ambiguous: 2 },
      estimatedHandoffs: 1,
      recordsPersisted: 4,
      observedFrom: "2026-10-24T20:00:00.000Z",
      observedUntil: "2026-10-24T20:02:00.000Z",
      records: [{ eventId: "a".repeat(64), sourceEventId: "source-001", businessDate: "2026-10-24", completedAt: "2026-10-24T20:01:00.000Z", status: "identity_ambiguous", size: "unknown", effectiveStatus: "identity_ambiguous", effectiveSize: "unknown", contributes: false, sampleCount: 6, localEvidence: null, possibleDuplicateOf: "b".repeat(64) }],
    });
    const result = buildDirectionalHandoffPanelModel(data, "2026-10-24", "America/Mazatlan", "live", 1000, new Date("2026-10-24T20:02:05.000Z"));
    expect(result.value).toBe("1");
    expect(result.identityHolds).toBe("2");
    expect(result.windowGaps).toBe("1 entre ventanas");
    expect(result.gapDuration).toBe("5s");
    expect(result.droppedFrames).toBe("3");
  });
});

describe("directional unresolved and missing zero boundaries",()=>{
 const run=(data:any,state:any="live")=>buildDirectionalHandoffPanelModel(data,"2026-10-24","America/Mazatlan",state,1,new Date("2026-10-24T20:01:05Z"));
 it("receiving frames with no accepted paths is not a zero cup total",()=>{const r=run(view());expect(r.value).toBe("No disponible");expect(r.sizeRows.every(x=>x.value==="No disponible")).toBe(true);expect(r.message).toContain("metadatos");});
 it("missing data does not fabricate administrative zero counts",()=>{const r=run(undefined,"offline");expect(r.records).toBe("\u2014");expect(r.identityHolds).toBe("\u2014");});
 it("positive unclassified observations leave nominal capacities unavailable",()=>{const r=run(view({estimatedHandoffs:2,sizeBreakdown:{chico:0,mediano:0,pint:0,litro:0,unknown:2}}));expect(r.value).toBe("2");expect(r.sizeRows[0].value).toBe("Sin asignaci\u00f3n concluyente");expect(r.sizeRows[4].value).toBe("2");});
 it("positive classified buckets remain visible while other paths are unresolved",()=>{const r=run(view({estimatedHandoffs:1,heldCandidateCount:3,sizeBreakdown:{chico:1,mediano:0,pint:0,litro:0,unknown:0}}));expect(r.sizeRows[0].value).toBe("1");expect(r.sizeRows[1].value).toBe("Sin asignaci\u00f3n concluyente");});
 it("retains a real zero category in a resolved partial register",()=>{const r=run(view({estimatedHandoffs:1,sizeBreakdown:{chico:1,mediano:0,pint:0,litro:0,unknown:0}}));expect(r.sizeRows[1].value).toBe("0");});
});
