import { describe, expect, it } from "vitest";
import { translateErrorMessage, translatePortalText } from "./employeePortalI18n";

describe("employee portal translations", () => {
  it("returns original text for English", () => {
    expect(translatePortalText("Opening Form", "en")).toBe("Opening Form");
  });

  it("translates the rebuilt three-form staff workflow copy into Spanish", () => {
    expect(translatePortalText("Portal Home", "es")).toBe("Inicio del portal");
    expect(translatePortalText("Opening Form", "es")).toBe("Formulario de apertura");
    expect(translatePortalText("Closing Form", "es")).toBe("Formulario de cierre");
    expect(translatePortalText("Inventory Form", "es")).toBe("Formulario de inventario");
    expect(translatePortalText("Open Inventory Form", "es")).toBe("Abrir formulario de inventario");
    expect(translatePortalText("First Name", "es")).toBe("Nombre");
    expect(translatePortalText("Please enter a first name before submitting.", "es")).toBe("Ingresa un nombre antes de enviar.");
    expect(translatePortalText("Saved for", "es")).toBe("Guardado para");
    expect(translatePortalText("Managers can review it in the dashboard.", "es")).toBe("La gerencia puede revisarlo en el panel.");
    expect(translatePortalText("Opening Cash", "es")).toBe("Caja de apertura");
    expect(translatePortalText("Nightly Money and Report", "es")).toBe("Dinero y reporte nocturnos");
    expect(translatePortalText("Utensil and Counter Inventory", "es")).toBe("Inventario de utensilios y mostrador");
    expect(translatePortalText("Full Store Inventory", "es")).toBe("Inventario completo de la tienda");
  });

  it("translates the revised opening and closing descriptions into Spanish", () => {
    expect(
      translatePortalText("Start with the date and first name, then complete the opening checklist, opening cash, and the limited inventory counts.", "es"),
    ).toBe("Comienza con la fecha y el nombre, luego completa la lista de apertura, la caja inicial y los conteos de inventario limitados.");
    expect(
      translatePortalText("Start with the date and first name, then complete the closing checklist, nightly money and report details, and the limited inventory counts.", "es"),
    ).toBe("Comienza con la fecha y el nombre, luego completa la lista de cierre, los detalles nocturnos de dinero y reporte, y los conteos de inventario limitados.");
    expect(
      translatePortalText("Use this separate form for the full business inventory, including ingredients, utensils, packaging, and ready-made gelato.", "es"),
    ).toBe("Usa este formulario separado para el inventario completo del negocio, incluidos ingredientes, utensilios, empaques y gelato listo.");
  });

  it("translates the side-by-side field labels into Spanish", () => {
    expect(translatePortalText("Small Pans", "es")).toBe("Charolas pequeñas");
    expect(translatePortalText("Small Gross Weight kg", "es")).toBe("Peso bruto pequeño kg");
    expect(translatePortalText("Large Pans", "es")).toBe("Charolas grandes");
    expect(translatePortalText("Large Gross Weight kg", "es")).toBe("Peso bruto grande kg");
    expect(translatePortalText("4oz Cups", "es")).toBe("Vasos de 4oz");
    expect(translatePortalText("8oz Lids", "es")).toBe("Tapas de 8oz");
    expect(translatePortalText("Bamboo Spoons", "es")).toBe("Cucharas de bambú");
    expect(translatePortalText("To-Go Bags", "es")).toBe("Bolsas para llevar");
  });

  it("falls back to the original text for unknown strings and error messages", () => {
    expect(translatePortalText("Unmapped phrase", "es")).toBe("Unmapped phrase");
    expect(translateErrorMessage("Server unavailable", "es")).toBe("Server unavailable");
  });
});
