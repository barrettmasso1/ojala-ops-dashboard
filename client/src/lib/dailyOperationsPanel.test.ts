import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({ Link: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement("a", { href }, children) }));

import DailyOperationsPanel from "../components/DailyOperationsPanel";

const view = {
  businessDate: "2026-10-24",
  salesCount: null,
  cameraCount: null,
  cameraValue: "—",
  state: "missing" as const,
  cameraLabel: "Conteo físico sin consolidar",
  cameraMessage: "Archivo anterior pendiente",
  cameraCoverage: "No disponible",
  cameraReviewStatus: "Awaiting a physical camera-count record",
  receivedAt: null,
  difference: null,
  differenceMessage: "Sin comparación",
  gaps: "",
  manualReference: "Referencia manual separada",
};

const directional = {
  businessDate: "2026-10-24",
  title: "Conteo automático provisional de entregas" as const,
  value: "0",
  label: "Intervalo observado parcial" as const,
  message: "Solo intervalo observado.",
  warning: "No son ventas ni entregas certificadas.",
  sizeRows: [
    { key: "chico" as const, label: "Chico", value: "0" },
    { key: "mediano" as const, label: "Mediano", value: "0" },
    { key: "pint" as const, label: "Pint", value: "0" },
    { key: "litro" as const, label: "Litro", value: "0" },
    { key: "unknown" as const, label: "Sin clasificar", value: "0" },
  ],
  interval: "Oct 24, 1:00 PM → Oct 24, 1:01 PM",
  latestFrame: "Oct 24, 1:01 PM",
  lastReceipt: "Oct 24, 1:01 PM",
  connection: "Consulta HTTP recibida",
  freshness: "Fotogramas recientes" as const,
  identityHolds: "0",
  windowGaps: "0 entre ventanas",
  gapDuration: "0s",
  droppedFrames: "0",
  records: "0",
  observed: true,
};

const counterPickups = {
  title: "Retiradas ópticas provisionales" as const,
  value: "0",
  label: "Ventanas de video parciales" as const,
  message: "Cero en esas ventanas no equivale a cero ventas ni a cero retiradas del día.",
  warning: "Movimiento óptico local provisional, no validado comercialmente.",
  sizeRows: [
    { key: "chico" as const, label: "Chico", value: "0" },
    { key: "mediano" as const, label: "Mediano", value: "0" },
    { key: "pint" as const, label: "Pint", value: "0" },
    { key: "litro" as const, label: "Litro", value: "0" },
    { key: "unknown" as const, label: "Sin clasificar", value: "0" },
  ],
  interval: "Oct 24, 1:00 PM → Oct 24, 1:01 PM",
  windowCount: "1",
  unresolved: "1",
  records: "1",
  receipt: "Oct 24, 1:01 PM",
  connection: "Consulta HTTP recibida",
  observed: true,
};

describe("DailyOperationsPanel automatic-first rendering", () => {
  it("shows the automatic table without opening the separated manual details", () => {
    const html = renderToStaticMarkup(React.createElement(DailyOperationsPanel, {
      view,
      timeZone: "America/Mazatlan",
      businessDate: "2026-10-24",
      directional,
    }));
    expect(html).toContain("Conteo automático del día y cierre");
    expect(html).toContain("Consulta HTTP recibida · Intervalo observado parcial");
    expect(html).toContain("Sin clasificar");
    expect(html).toContain("Cierre manual y conteo revisado (separados)");
    expect(html).not.toContain("<details open");
    expect(html.indexOf("Conteo automático del día y cierre")).toBeLessThan(html.indexOf("Cierre manual y conteo revisado (separados)"));
  });

  it("keeps the automatic section visible when the closing view is unavailable", () => {
    const html = renderToStaticMarkup(React.createElement(DailyOperationsPanel, {
      timeZone: "America/Mazatlan",
      businessDate: "2026-10-24",
      directional,
      closingUnavailable: true,
    }));
    expect(html).toContain("Conteo automático del día y cierre");
    expect(html).toContain("Cierre no disponible para esta consulta");
    expect(html).toContain("Trayectorias aceptadas");
    expect(html).not.toContain("Conteo físico sin consolidar");
  });

  it("prioritizes optical pickups without adding or relabeling the directional diagnostic", () => {
    const html = renderToStaticMarkup(React.createElement(DailyOperationsPanel, {
      timeZone: "America/Mazatlan",
      businessDate: "2026-10-24",
      directional,
      counterPickups,
      closingUnavailable: true,
    }));
    expect(html).toContain("Retiradas ópticas provisionales");
    expect(html).toContain("Ventanas de video parciales");
    expect(html).toContain("Diagnóstico direccional separado (no se suma)");
    expect(html).toContain("Cierre no disponible para esta consulta");
    expect(html).not.toContain("ventas cobradas");
    expect(html.indexOf("Retiradas ópticas provisionales")).toBeLessThan(html.indexOf("Diagnóstico direccional separado (no se suma)"));
  });
});
