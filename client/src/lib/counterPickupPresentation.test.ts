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
  it("does not equate unavailable tracking and zero accepted estimates with zero delivered cups", () => {
    const model = buildCounterPickupPanelModel(base, "2026-10-24", "America/Mazatlan", "live", 1, new Date("2026-10-24T21:00:00.000Z"));
    expect(model).toMatchObject({ value: "No disponible", label: "Sin resultado concluyente", observed: true, unresolved: "1" });
    expect(model.message).toContain("casos siguen sin resolver");
    expect(model.sizeRows.every(row => row.value === "No disponible")).toBe(true);
    expect(model.warning).toContain("no validado comercialmente");
  });

  it("keeps unavailable source as unknown rather than a false zero", () => {
    const model = buildCounterPickupPanelModel(undefined, "2026-10-24", "America/Mazatlan", "offline", 0, new Date("2026-10-24T21:00:00.000Z"));
    expect(model).toMatchObject({ value: "—", label: "No observado", observed: false });
    expect(model.sizeRows.every(row => row.value === "—")).toBe(true);
  });

  it("labels a private-registry failure explicitly without presenting an empty or zero observation", () => {
    const model = buildCounterPickupPanelModel(undefined, "2026-10-24", "America/Mazatlan", "unavailable", 0, new Date("2026-10-24T21:00:00.000Z"));
    expect(model).toMatchObject({ value: "—", label: "Registro no disponible", observed: false, connection: "Registro temporalmente no disponible" });
    expect(model.message).toContain("No se presenta cero");
    expect(model.records).toBe("—");
  });

  it("preserves unknown capacity separately and marks historical reads without pretending live coverage", () => {
    const model = buildCounterPickupPanelModel({ ...base, estimatedPickups: 1, sizeBreakdown: { ...base.sizeBreakdown, unknown: 1 } }, "2026-10-24", "America/Mazatlan", "live", 1, new Date("2026-10-25T21:00:00.000Z"));
    expect(model).toMatchObject({ label: "Fecha histórica", value: "1" });
    expect(model.sizeRows.find(row => row.key === "unknown")).toMatchObject({ label: "Sin clasificar", value: "1" });
  });
});

describe("incomplete optical zero regressions",()=>{
 const day="2026-10-24",tz="America/Mazatlan",now=new Date("2026-10-24T21:00:00Z");
 const render=(data:any,state:any="live")=>buildCounterPickupPanelModel(data,day,tz,state,1,now);
 it("does not show zeros for 18 inconclusive analyses",()=>{const m=render({...base,unresolvedCount:18,records:Array(18).fill(base.records[0])});expect(m.value).toBe("No disponible");expect(m.unresolved).toBe("18");expect(m.records).toBe("18");});
 it("preserves a positive partial result without filling unresolved categories",()=>{const m=render({...base,estimatedPickups:2,sizeBreakdown:{...base.sizeBreakdown,chico:2}});expect(m.value).toBe("2");expect(m.sizeRows.find(r=>r.key==="chico")?.value).toBe("2");expect(m.sizeRows.find(r=>r.key==="litro")?.value).toBe("Sin asignaci\u00f3n concluyente");});
 it("does not call a failed initial query an empty day",()=>{const m=render(undefined,"offline");expect(m.value).toBe("\u2014");expect(m.records).toBe("\u2014");});
 it("does not leak yesterday's zero or counters into today",()=>{const m=render({...base,businessDate:"2026-10-23"},"stale");expect(m.records).toBe("\u2014");expect(m.observed).toBe(false);});
 it("retains same-day partial results with an explicit query warning",()=>{const m=render({...base,estimatedPickups:2,sizeBreakdown:{...base.sizeBreakdown,chico:2}},"stale");expect(m.value).toBe("2");expect(m.connection).toContain("fallida");});
 it("does not turn unknown-sized estimates into zeros of all four capacities",()=>{const m=render({...base,estimatedPickups:1,unresolvedCount:0,sizeBreakdown:{...base.sizeBreakdown,unknown:1}});expect(m.sizeRows.find(r=>r.key==="unknown")?.value).toBe("1");expect(m.sizeRows.find(r=>r.key==="pint")?.value).toBe("Sin asignaci\u00f3n concluyente");});
 it("preserves real zero buckets when all recorded estimates are classified and resolved",()=>{const m=render({...base,estimatedPickups:1,unresolvedCount:0,sizeBreakdown:{...base.sizeBreakdown,chico:1}});expect(m.sizeRows.find(r=>r.key==="mediano")?.value).toBe("0");});
 it("does not mutate source counters",()=>{const before=JSON.stringify(base);render(base);expect(JSON.stringify(base)).toBe(before);});
});
