import { describe, expect, it } from "vitest";

import { translateErrorMessage, translatePortalText } from "./employeePortalI18n";

describe("employee portal translations", () => {
  it("returns original text for English", () => {
    expect(translatePortalText("Inventory Input", "en")).toBe("Inventory Input");
  });

  it("translates known interface copy into Spanish", () => {
    expect(translatePortalText("Inventory Input", "es")).toBe("Ingreso de inventario");
    expect(translatePortalText("Save inventory and gelato updates", "es")).toBe("Guardar actualizaciones de inventario y gelato");
    expect(translatePortalText("Ready-Made Gelato", "es")).toBe("Gelato listo");
    expect(translatePortalText("Weight in kg", "es")).toBe("Peso en kg");
    expect(translatePortalText("Mint Chip", "es")).toBe("Menta con chispas");
    expect(translatePortalText("Submit Opening Checklist", "es")).toBe("Enviar lista de apertura");
    expect(translatePortalText("Napkins stocked", "es")).toBe("Servilletas abastecidas");
  });

  it("falls back to the original text for unknown strings and error messages", () => {
    expect(translatePortalText("Unmapped phrase", "es")).toBe("Unmapped phrase");
    expect(translateErrorMessage("Server unavailable", "es")).toBe("Server unavailable");
  });
});
