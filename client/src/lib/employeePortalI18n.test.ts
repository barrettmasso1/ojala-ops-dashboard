import { describe, expect, it } from "vitest";

import { translateErrorMessage, translatePortalText } from "./employeePortalI18n";

describe("employee portal translations", () => {
  it("returns original text for English", () => {
    expect(translatePortalText("Opening Form", "en")).toBe("Opening Form");
  });

  it("translates the rebuilt staff workflow copy into Spanish", () => {
    expect(translatePortalText("Portal Home", "es")).toBe("Inicio del portal");
    expect(translatePortalText("Opening Form", "es")).toBe("Formulario de apertura");
    expect(translatePortalText("Closing Form", "es")).toBe("Formulario de cierre");
    expect(translatePortalText("Submit Opening Form", "es")).toBe("Enviar formulario de apertura");
    expect(translatePortalText("Submit Closing Form", "es")).toBe("Enviar formulario de cierre");
    expect(translatePortalText("Opening form submitted.", "es")).toBe("Formulario de apertura enviado.");
    expect(translatePortalText("Closing form submitted.", "es")).toBe("Formulario de cierre enviado.");
    expect(translatePortalText("Front Counter Stock", "es")).toBe("Inventario del mostrador");
    expect(translatePortalText("Closing Stock Counts", "es")).toBe("Conteos finales");
    expect(translatePortalText("Sales Entry", "es")).toBe("Registro de ventas");
  });

  it("translates the new side-by-side field labels and helper copy into Spanish", () => {
    expect(translatePortalText("Small Pans", "es")).toBe("Charolas pequeñas");
    expect(translatePortalText("Small Gross Weight kg", "es")).toBe("Peso bruto pequeño kg");
    expect(translatePortalText("Large Pans", "es")).toBe("Charolas grandes");
    expect(translatePortalText("Large Gross Weight kg", "es")).toBe("Peso bruto grande kg");
    expect(translatePortalText("4oz Cups", "es")).toBe("Vasos de 4oz");
    expect(translatePortalText("8oz Lids", "es")).toBe("Tapas de 8oz");
    expect(translatePortalText("Bamboo Spoons", "es")).toBe("Cucharas de bambú");
    expect(translatePortalText("To-Go Bags", "es")).toBe("Bolsas para llevar");
    expect(translatePortalText("Record opening counts and gross pan weights with the small and large pan fields on the same row.", "es")).toBe(
      "Registra conteos de apertura y pesos brutos con los campos de charola pequeña y grande en la misma fila.",
    );
  });

  it("falls back to the original text for unknown strings and error messages", () => {
    expect(translatePortalText("Unmapped phrase", "es")).toBe("Unmapped phrase");
    expect(translateErrorMessage("Server unavailable", "es")).toBe("Server unavailable");
  });
});
