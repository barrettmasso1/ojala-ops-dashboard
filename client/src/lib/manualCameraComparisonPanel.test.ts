import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ query: {} as any }));
vi.mock("@/lib/trpc", () => ({ trpc: { dashboard: { manualCameraComparison: { useQuery: () => state.query } } } }));
vi.mock("wouter", () => ({ Link: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement("a", { href }, children) }));
import { ManualCameraComparisonPanel } from "../components/ManualCameraComparisonPanel";

const day = "2026-10-23";
function fixture() {
  return {
    selectedDate: day,
    manual: { businessDate: day, reportCount: 1, cups: { "4oz": 12, "8oz": 4, Pint: 3, Liter: 0 }, cupsHere: { "4oz": 5, "8oz": 1, Pint: 0, Liter: 0 }, cupsToGo: { "4oz": 7, "8oz": 3, Pint: 3, Liter: 0 } },
    nativeLedgerState: "received" as const,
    nativeLedger: { businessDate: day, scope: "detector_tracks_not_certified_unique_deliveries", detectedTracks: 57, locallyVerifiedTargets: 21, withoutSameFrameEvidence: 0, ownerExcludedTargets: 0, potentialRepeatedTracks: 2, sizeBreakdown: { chico: 2, mediano: 5, pint: 0, litro: 0, unknown: 14 } },
    reviewedPhysicalCount: null,
  };
}
function render() { return renderToStaticMarkup(React.createElement(ManualCameraComparisonPanel, { businessDate: day })); }

beforeEach(() => { state.query = { data: fixture(), isLoading: false, error: null }; });

describe("ManualCameraComparisonPanel", () => {
  it("shows six manual categories, unknown native size, unavailable comparison and evidence link", () => {
    const html = render();
    for (const label of ["Chico · Aquí", "Chico · Para llevar", "Mediano · Aquí", "Mediano · Para llevar", "Pint · Para llevar", "Litro · Para llevar", "Sin clasificar"]) expect(html).toContain(label);
    expect(html).toContain("Capacidad no confirmada; no se reparte entre tamaños.");
    expect(html).toContain("No disponible: las observaciones de cámara no son vasos físicos deduplicados ni ventas.");
    expect(html).toContain("/dashboard/handoff-review?date=2026-10-23");
    expect(html).not.toContain("useMutation");
  });

  it("keeps a same-day response visible with an explicit stale-query warning", () => {
    state.query.error = new Error("temporary");
    const html = render();
    expect(html).toContain("Datos conservados; la consulta actual no se confirmó.");
    expect(html).toContain("57 seguimientos");
  });

  it("does not display missing source data as zero", () => {
    state.query.data = null;
    state.query.error = new Error("temporary");
    const html = render();
    expect(html).toContain("No se pudo cargar la comparación");
    expect(html).not.toContain("57 seguimientos");
  });

  it("renders a genuine manual zero distinctly when a closing record exists", () => {
    Object.assign(state.query.data.manual, { cups: { "4oz": 0, "8oz": 0, Pint: 0, Liter: 0 }, cupsHere: { "4oz": 0, "8oz": 0, Pint: 0, Liter: 0 }, cupsToGo: { "4oz": 0, "8oz": 0, Pint: 0, Liter: 0 } });
    const html = render();
    expect(html).toContain("Cierre manual</p><p class=\"mt-3 text-2xl font-semibold text-[#24332f]\">0</p>");
  });
});
