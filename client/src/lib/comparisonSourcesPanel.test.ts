import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ sources: {} as any, camera: {} as any, manualError: null as any, shopifyError: null as any }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ dashboard: { comparisonSources: { invalidate: vi.fn() } } }),
    dashboard: {
      comparisonSources: { useQuery: () => state.sources },
      localCupLedger: { useQuery: () => state.camera },
      saveIndependentManualComparison: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: state.manualError }) },
      saveShopifyComparison: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: state.shopifyError }) },
    },
  },
}));
import { ComparisonSourcesPanel } from "../components/ComparisonSourcesPanel";

const DAY = "2026-10-31";
const interval = { startedAt: "2026-10-31T17:00:00.000Z", endedAt: "2026-10-31T18:00:00.000Z" };
const emptyCategories = { chico_here: null, chico_togo: null, mediano_here: null, mediano_togo: null, pint_togo: null, litro_togo: null };
function source(sourceKind: "independent_manual_tally" | "shopify_csv", sourceName: string, categories: typeof emptyCategories) {
  return { sourceKind, sourceName, contentSha256: "a".repeat(64), interval, categories, unmapped: sourceKind === "shopify_csv" ? { rowCount: 1, knownNetItemsSold: 1, rowsWithUnknownItemCount: 0, reasons: [{ reason: "not mapped", rowCount: 1, knownNetItemsSold: 1, rowsWithUnknownItemCount: 0 }] } : null, sourceFingerprint: "b".repeat(64) };
}
function sourcesView(businessDate = DAY, storeId = 1, availability: "available" | "absent" | "unavailable" = "available") {
  return {
    storeId, businessDate, availability, revision: "c".repeat(64),
    document: availability === "available" ? {
      schemaVersion: 1, protocol: "ojala_comparison_sources_v1", storeId, businessDate,
      manualIndependent: source("independent_manual_tally", "libreta turno", { ...emptyCategories, chico_here: 0 }),
      shopify: source("shopify_csv", "daily-report.csv", { ...emptyCategories, mediano_togo: 2 }),
    } : null,
  };
}
const cameraRecord = (businessDate = DAY, storeId = 1) => ({
  businessDate, storeId, scope: "detector_tracks_not_certified_unique_deliveries", detectedTracks: 8,
  locallyVerifiedTargets: 3, withoutSameFrameEvidence: 2, ownerExcludedTargets: 1, potentialRepeatedTracks: 0,
  sizeBreakdown: { chico: 1, mediano: 0, pint: 1, litro: 0, unknown: 1 }, receivedAt: "2026-10-31T19:00:00.000Z",
});
function render() { return renderToStaticMarkup(React.createElement(ComparisonSourcesPanel, { businessDate: DAY, storeId: 1, timeZone: "America/Mazatlan" })); }

beforeEach(() => {
  state.manualError = null;
  state.shopifyError = null;
  state.sources = { data: sourcesView(), isLoading: false, error: null };
  state.camera = { data: cameraRecord(), isLoading: false, error: null };
});

describe("ComparisonSourcesPanel rendering", () => {
  it("reloads persisted Shopify and manual aggregates rather than relying on a browser upload preview", () => {
    const html = render();
    expect(html).toContain("daily-report.csv");
    expect(html).toContain("libreta turno");
    expect(html).toContain("Mediano · Para llevar</p><p class=\"mt-1 font-semibold text-[#24332f]\">2</p>");
    expect(html).toContain("Importación Shopify");
    expect(html).not.toContain("SKU-PRIVATE");
    expect(html).not.toContain("anotherPrivateSku");
    expect(html).not.toContain("Product title");
  });

  it("renders explicit zero as zero and all missing categories as no data", () => {
    const html = render();
    expect(html).toContain("Chico · Aquí</p><p class=\"mt-1 font-semibold text-[#24332f]\">0</p>");
    expect(html).toContain("Chico · Para llevar</p><p class=\"mt-1 font-semibold text-[#24332f]\">Sin dato</p>");
  });

  it("shows successful absence distinctly and does not fill missing sources with zeros", () => {
    state.sources.data = sourcesView(DAY, 1, "absent");
    state.camera.data = null;
    const html = render();
    expect(html).toContain("No hay documento persistido");
    expect(html).toContain("sin tally manual independiente guardado");
    expect(html).toContain("Sin registro nativo recibido");
    expect(html).not.toContain("0 seguimientos");
  });

  it("keeps a resolved storage-unavailable state separate from no-record/zero", () => {
    state.sources.data = sourcesView(DAY, 1, "unavailable");
    state.camera.data = undefined;
    const html = render();
    expect(html).toContain("Lectura del storage no disponible");
    expect(html).toContain("no puede afirmarse si hay un tally guardado");
    expect(html).not.toContain("sin tally manual independiente guardado");
    expect(html).not.toContain("sin importación Shopify guardada");
  });

  it("preserves same-store, same-day cached sources as stale after a temporary read error", () => {
    state.sources.error = new Error("temporary");
    state.camera.error = new Error("temporary");
    const html = render();
    expect(html).toContain("Lectura actual fallida; se conservan solamente datos cacheados de esta misma tienda y fecha.");
    expect(html).toContain("Respuesta conservada del mismo día");
    expect(html).toContain("daily-report.csv");
    expect(html).toContain("8 seguimientos de detector");
  });

  it("shows failed manual/Shopify mutations as unconfirmed instead of a saved receipt", () => {
    state.manualError = new Error("storage CAS conflict");
    state.shopifyError = new Error("storage write failed");
    const html = render();
    expect(html).toContain("No confirmado: storage CAS conflict");
    expect(html).toContain("No confirmado: storage write failed");
    expect(html).not.toContain("Tally manual independiente guardado y leído de vuelta");
    expect(html).not.toContain("Agregados Shopify guardados y leídos de vuelta");
  });

  it("does not render cached values from another business date or store", () => {
    state.sources.data = sourcesView("2026-10-30", 1);
    state.camera.data = cameraRecord("2026-10-30", 1);
    const html = render();
    expect(html).not.toContain("daily-report.csv");
    expect(html).not.toContain("8 seguimientos de detector");
    expect(html).not.toContain("Sin registro nativo recibido");

    state.sources.data = sourcesView(DAY, 2);
    state.camera.data = cameraRecord(DAY, 2);
    const wrongStoreHtml = render();
    expect(wrongStoreHtml).not.toContain("daily-report.csv");
    expect(wrongStoreHtml).not.toContain("8 seguimientos de detector");
    expect(wrongStoreHtml).toContain("Respuesta de comparación de otra tienda o fecha descartada");
  });

  it("states that a failed read is not absence and exposes safe conditional creation instead of false zero", () => {
    state.sources.data = undefined;
    state.sources.error = new Error("403");
    state.sources.isLoading = false;
    state.camera.data = undefined;
    state.camera.error = new Error("403");
    const html = render();
    expect(html).toContain("Falló la lectura de la comparación");
    expect(html).toContain("no se puede concluir que falte el registro ni mostrar ceros");
    expect(html).toContain("creación condicional segura");
    expect(html).toContain("Lectura fallida; no se puede concluir ausencia ni cero");
  });

  it("does not calculate any percent/difference against camera and does not assign camera service mode", () => {
    const html = render();
    expect(html).toContain("no hay conteo físico validado de cobertura común");
    expect(html).toContain("no distingue aquí/para llevar");
    expect(html).toContain("nunca ventas ni entregas únicas");
    expect(html).not.toContain("% de cámara");
    expect(html).not.toContain("Diferencia de cámara");
  });

  it("does not label a zero camera size allocation when unclassified observations remain", () => {
    state.camera.data = { ...cameraRecord(), sizeBreakdown: { chico: 0, mediano: 0, pint: 0, litro: 0, unknown: 2 } };
    const html = render();
    expect(html).toContain("Sin asignación confirmada");
    expect(html).toContain("Sin clasificar</p><p class=\"mt-1 font-semibold text-[#24332f]\">2</p>");
  });
});
