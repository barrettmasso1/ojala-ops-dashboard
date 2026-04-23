import { describe, expect, it } from "vitest";
import { DEFAULT_INVENTORY_ITEMS, DEFAULT_RECIPE_ITEMS } from "../shared/opsCatalog";

describe("ops catalog seed data", () => {
  it("includes the main inventory groups from the provided screenshots", () => {
    const itemNames = DEFAULT_INVENTORY_ITEMS.map(item => item.itemName);

    expect(itemNames).toContain("Almond Base");
    expect(itemNames).toContain("Coco Base");
    expect(itemNames).toContain("Napkins");
    expect(itemNames).toContain("4oz To-Go Cups");
    expect(itemNames).toContain("Bamboo To-Go Spoons");
  });

  it("covers both ingredient and utensils-cleaning departments", () => {
    const departments = new Set(DEFAULT_INVENTORY_ITEMS.map(item => item.department));

    expect(departments.has("Ingredients")).toBe(true);
    expect(departments.has("Utensils & Cleaning")).toBe(true);
  });

  it("seeds all 15 visible workbook recipe names", () => {
    const recipeNames = Array.from(new Set(DEFAULT_RECIPE_ITEMS.map(item => item.recipeName))).sort();

    expect(recipeNames).toHaveLength(15);
    expect(recipeNames).toEqual([
      "Avocado",
      "Choco Mint",
      "Chocolate",
      "Cinnamon",
      "Coffee",
      "Cookies & Cream",
      "Lemon",
      "Orange Cacao",
      "Peanut Butter",
      "Pistachio",
      "Strawberry",
      "Sweet Potato",
      "Vanilla",
      "Watermelon & Lime",
      "Wine",
    ]);
  });

  it("preserves representative workbook ingredient rows, measurements, and seeded base costs", () => {
    expect(DEFAULT_RECIPE_ITEMS).toContainEqual(expect.objectContaining({
      recipeName: "Watermelon & Lime",
      ingredientName: "Watermelon",
      quantity: "8.5",
      unitType: "kilos",
    }));
    expect(DEFAULT_RECIPE_ITEMS).toContainEqual(expect.objectContaining({
      recipeName: "Watermelon & Lime",
      ingredientName: "Lime",
      quantity: "18",
      unitType: "limes",
    }));
    expect(DEFAULT_RECIPE_ITEMS).toContainEqual(expect.objectContaining({
      recipeName: "Orange Cacao",
      ingredientName: "Orange Juice",
      quantity: "1",
      unitType: "liters",
    }));
    expect(DEFAULT_RECIPE_ITEMS).toContainEqual(expect.objectContaining({
      recipeName: "Orange Cacao",
      ingredientName: "Orange Zest",
      quantity: "80",
      unitType: "g",
    }));
    expect(DEFAULT_RECIPE_ITEMS).toContainEqual(expect.objectContaining({
      recipeName: "Wine",
      ingredientName: "Wine",
      quantity: "800",
      unitType: "ml",
    }));
    expect(DEFAULT_RECIPE_ITEMS).toContainEqual(expect.objectContaining({
      recipeName: "Choco Mint",
      ingredientName: "Base",
      quantity: "1",
      unitType: "bag",
      costPerUnit: "350.00",
      totalCost: "350.00",
    }));
  });
});
