import { describe, expect, it } from "vitest";
import { DEFAULT_INVENTORY_ITEMS, DEFAULT_RECIPE_ITEMS } from "./opsCatalog";

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

  it("includes cookbook rows for the core gelato flavors", () => {
    const recipeNames = new Set(DEFAULT_RECIPE_ITEMS.map(item => item.recipeName));

    expect(recipeNames.has("Vanilla")).toBe(true);
    expect(recipeNames.has("Chocolate")).toBe(true);
    expect(recipeNames.has("Strawberry")).toBe(true);
    expect(recipeNames.has("Pistachio")).toBe(true);
  });
});
