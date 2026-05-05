import { describe, expect, it } from "vitest";
import { translateErrorMessage, translatePortalText } from "./employeePortalI18n";

describe("employee portal translations", () => {
  it("returns original text for English", () => {
    expect(translatePortalText("Opening Form", "en")).toBe("Opening Form");
  });

  it("translates the rebuilt three-form staff workflow copy into Spanish", () => {
    expect(translatePortalText("Portal Home", "es")).toBe("Inicio del portal");
    expect(translatePortalText("Drafts", "es")).toBe("Borradores");
    expect(translatePortalText("Opening Form", "es")).toBe("Formulario de apertura");
    expect(translatePortalText("Closing Form", "es")).toBe("Formulario de cierre");
    expect(translatePortalText("Inventory Form", "es")).toBe("Formulario de inventario");
    expect(translatePortalText("Open Inventory Form", "es")).toBe("Abrir formulario de inventario");
    expect(translatePortalText("Sign out", "es")).toBe("Cerrar sesión");
    expect(translatePortalText("First Name", "es")).toBe("Nombre");
    expect(translatePortalText("Please enter a first name before submitting.", "es")).toBe("Ingresa un nombre antes de enviar.");
    expect(translatePortalText("Saved for", "es")).toBe("Guardado para");
    expect(translatePortalText("Managers can review it in the dashboard.", "es")).toBe("La gerencia puede revisarlo en el panel.");
    expect(translatePortalText("Remove photo", "es")).toBe("Quitar foto");
    expect(translatePortalText("Net gelato weight", "es")).toBe("Peso neto del gelato");
    expect(translatePortalText("pan tare", "es")).toBe("tara de charolas");
    expect(translatePortalText("Estimated volume ounces", "es")).toBe("Onzas de volumen estimadas");
    expect(translatePortalText("Only the first 20 photos were kept for this batch.", "es")).toBe("Solo se conservaron las primeras 20 fotos para este lote.");
    expect(translatePortalText("You can analyze up to 20 photos at a time. Remove any extras or run another batch after this one finishes.", "es")).toBe("Puedes analizar hasta 20 fotos a la vez. Quita las sobrantes o ejecuta otro lote cuando este termine.");
    expect(translatePortalText("Save progress", "es")).toBe("Guardar progreso");
    expect(translatePortalText("Opening draft saved.", "es")).toBe("Borrador de apertura guardado.");
    expect(translatePortalText("Saved inventory draft restored.", "es")).toBe("Borrador guardado de inventario restaurado.");
    expect(translatePortalText("Draft saved on this device for today. Reopen this same form on this device to keep working.", "es")).toBe("El borrador de hoy quedó guardado en este dispositivo. Vuelve a abrir este mismo formulario en este dispositivo para seguir trabajando.");
    expect(translatePortalText("Use Drafts on Portal Home to reopen it on this device.", "es")).toBe("Usa Borradores en el inicio del portal para volver a abrirlo en este dispositivo.");
    expect(translatePortalText("Open Drafts", "es")).toBe("Abrir borradores");
    expect(translatePortalText("Resume draft", "es")).toBe("Continuar borrador");
    expect(translatePortalText("Delete draft", "es")).toBe("Eliminar borrador");
    expect(translatePortalText("Draft deleted.", "es")).toBe("Borrador eliminado.");
    expect(translatePortalText("Opening Cash", "es")).toBe("Caja de apertura");
    expect(translatePortalText("Nightly Money and Report", "es")).toBe("Dinero y reporte nocturnos");
    expect(translatePortalText("Utensil and Counter Inventory", "es")).toBe("Inventario de utensilios y mostrador");
    expect(translatePortalText("Full Store Inventory", "es")).toBe("Inventario completo de la tienda");
    expect(translatePortalText("Time Clock", "es")).toBe("Reloj de entrada y salida");
    expect(translatePortalText("Select your name", "es")).toBe("Selecciona tu nombre");
    expect(translatePortalText("Tap Sign In when you arrive and Sign Out when you leave.", "es")).toBe("Toca Iniciar turno cuando llegues y Finalizar turno cuando te vayas.");
    expect(translatePortalText("Sign In", "es")).toBe("Iniciar turno");
    expect(translatePortalText("Sign Out", "es")).toBe("Finalizar turno");
    expect(translatePortalText("Currently signed in since", "es")).toBe("Turno activo desde las");
    expect(translatePortalText("Today's hours", "es")).toBe("Horas de hoy");
    expect(translatePortalText("Signed in successfully.", "es")).toBe("Inicio de turno registrado.");
    expect(translatePortalText("Signed out successfully.", "es")).toBe("Salida de turno registrada.");
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

  it("translates dynamic full-inventory labels and prompt variants into Spanish", () => {
    expect(translatePortalText("Ingredients", "es")).toBe("Ingredientes");
    expect(translatePortalText("Utensils & Cleaning", "es")).toBe("Utensilios y limpieza");
    expect(translatePortalText("Almond Base", "es")).toBe("Base de almendra");
    expect(translatePortalText("Cacao Butter", "es")).toBe("Manteca de cacao");
    expect(translatePortalText("Bamboo To-Go Spoons", "es")).toBe("Cucharas de bambú para llevar");
    expect(translatePortalText("Dine-In Metal Spoons", "es")).toBe("Cucharas metálicas para comer aquí");
    expect(translatePortalText("4oz To-Go Cups", "es")).toBe("Vasos para llevar de 4oz");
    expect(translatePortalText("If no, explain the issue", "es")).toBe("Si no, describe el problema.");
    expect(translatePortalText("If no, explain the issue. ", "es")).toBe("Si no, describe el problema.");
  });

  it("falls back to the original text for unknown strings and error messages", () => {
    expect(translatePortalText("Unmapped phrase", "es")).toBe("Unmapped phrase");
    expect(translateErrorMessage("Server unavailable", "es")).toBe("Server unavailable");
  });
});
