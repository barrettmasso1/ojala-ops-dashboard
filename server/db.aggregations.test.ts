import { describe, expect, it } from "vitest";
import { buildDailySnapshot, buildRecentNotesFeed, buildRecipeCostSummaries, buildWeekOverWeekSeries } from "./db";

describe("db aggregation helpers", () => {
  it("builds a daily snapshot with sales totals, cup totals, gelato reconciliation, and checklist completion", () => {
    const snapshot = buildDailySnapshot(
      [
        {
          staffName: "Ava",
          equipmentStatus: "Ready",
          cleanlinessStatus: "Clean",
          setupStatus: "Stocked",
          startingCash: "120.00",
          cashMatchesSystem: "Yes",
          storeReadyStatus: "Yes",
          responseJson: JSON.stringify({
            stockCounts: {
              cups4oz: 40,
              cups8oz: 35,
              cupsPint: 12,
              cupsLiter: 8,
              lids4oz: 38,
              lids8oz: 35,
              lidsPint: 12,
              lidsLiter: 8,
              spoons: 60,
            },
          }),
          createdAt: new Date("2026-04-21T08:00:00Z"),
        },
      ],
      [
        {
          staffName: "Marco",
          cashCounted: "180.00",
          cashMatchesSystem: "Yes",
          cleaningStatus: "Done",
          productStorageStatus: "Stored",
          storeClosedStatus: "Yes",
          createdAt: new Date("2026-04-21T22:00:00Z"),
        },
      ],
      [
        {
          businessDate: "2026-04-21",
          staffName: "Marco",
          cups4oz: 10,
          cups4ozHere: 3,
          cups4ozToGo: 7,
          cups8oz: 12,
          cups8ozHere: 5,
          cups8ozToGo: 7,
          cupsPint: 4,
          cupsPintHere: 2,
          cupsPintToGo: 2,
          cupsLiter: 1,
          cupsLiterHere: 0,
          cupsLiterToGo: 1,
          cashTotal: "200.00",
          cardTotal: "300.00",
          zelleTotal: "50.00",
          venmoTotal: "25.00",
          createdAt: new Date("2026-04-21T22:15:00Z"),
        },
        {
          businessDate: "2026-04-21",
          staffName: "Sofia",
          cups4oz: 5,
          cups4ozHere: 1,
          cups4ozToGo: 4,
          cups8oz: 7,
          cups8ozHere: 3,
          cups8ozToGo: 4,
          cupsPint: 2,
          cupsPintHere: 0,
          cupsPintToGo: 2,
          cupsLiter: 1,
          cupsLiterHere: 1,
          cupsLiterToGo: 0,
          cashTotal: "150.00",
          cardTotal: "100.00",
          zelleTotal: "20.00",
          venmoTotal: "30.00",
          createdAt: new Date("2026-04-21T23:15:00Z"),
        },
      ],
      [
        {
          id: 1,
          businessDate: "2026-04-21",
          flavor: "Vanilla",
          shiftType: "opening" as const,
          smallPanCount: 1,
          smallGrossWeightKg: "1.90",
          largePanCount: 1,
          largeGrossWeightKg: "4.30",
        },
        {
          id: 2,
          businessDate: "2026-04-21",
          flavor: "Vanilla",
          shiftType: "closing" as const,
          smallPanCount: 1,
          smallGrossWeightKg: "1.61",
          largePanCount: 1,
          largeGrossWeightKg: "4.00",
        },
        {
          id: 3,
          businessDate: "2026-04-21",
          flavor: "Flavor of the Day",
          shiftType: "opening" as const,
          smallPanCount: 1,
          smallGrossWeightKg: "1.90",
          largePanCount: 0,
          largeGrossWeightKg: "0.00",
        },
        {
          id: 4,
          businessDate: "2026-04-21",
          flavor: "Flavor of the Day",
          shiftType: "closing" as const,
          smallPanCount: 1,
          smallGrossWeightKg: "1.75",
          largePanCount: 0,
          largeGrossWeightKg: "0.00",
        },
      ],
      [
        { itemName: "4oz To-Go Cups", currentQuantity: "34", lastCountDate: "2026-04-21" },
        { itemName: "8oz To-Go Cups", currentQuantity: "16", lastCountDate: "2026-04-21" },
        { itemName: "8oz To-Go Lids", currentQuantity: "16", lastCountDate: "2026-04-21" },
        { itemName: "16oz To-Go Cups", currentQuantity: "6", lastCountDate: "2026-04-21" },
        { itemName: "16oz To-Go Lids", currentQuantity: "6", lastCountDate: "2026-04-21" },
        { itemName: "32oz To-Go Cups", currentQuantity: "6", lastCountDate: "2026-04-21" },
        { itemName: "32oz To-Go Lids", currentQuantity: "6", lastCountDate: "2026-04-21" },
        { itemName: "Bamboo To-Go Spoons", currentQuantity: "44", lastCountDate: "2026-04-21" },
        { itemName: "Edible Spoons", currentQuantity: "10", lastCountDate: "2026-04-21" },
      ],
      "2026-04-21"
    );

    expect(snapshot.sales).toMatchObject({
      total: 875,
      cash: 350,
      card: 400,
      zelle: 70,
      venmo: 55,
    });
    expect(snapshot.cups).toEqual({ "4oz": 15, "8oz": 19, Pint: 6, Liter: 2 });
    expect(snapshot.cupsHere).toEqual({ "4oz": 4, "8oz": 8, Pint: 2, Liter: 1 });
    expect(snapshot.cupsToGo).toEqual({ "4oz": 11, "8oz": 11, Pint: 4, Liter: 1 });
    expect(snapshot.soldVolumeOunces).toBe(372);
    expect(snapshot.gelato.openingVolumeOunces).toBeCloseTo(264.68, 2);
    expect(snapshot.gelato.closingVolumeOunces).toBeCloseTo(237.65, 2);
    expect(snapshot.gelato.actualDistributedVolumeOunces).toBeCloseTo(27.03, 2);
    expect(snapshot.gelato.actualDistributedVolumeOunces).toBeCloseTo(snapshot.gelato.openingVolumeOunces - snapshot.gelato.closingVolumeOunces, 2);
    expect(snapshot.gelato.varianceVolumeOunces).toBeCloseTo(-344.97, 2);
    expect(snapshot.gelato.varianceVolumeOunces).toBeCloseTo(snapshot.gelato.actualDistributedVolumeOunces - snapshot.gelato.soldVolumeOunces, 2);
    expect(snapshot.gelato.discrepancyStatus).toBe("major");
    expect(snapshot.gelato.discrepancyLabel).toBe("Major discrepancy");
    expect(snapshot.gelato.flavors.find(item => item.flavor === "Vanilla")).toMatchObject({
      usedVolumeOunces: expect.closeTo(21.81, 2),
    });
    expect(snapshot.gelato.flavors.find(item => item.flavor === "Flavor of the Day")).toMatchObject({
      usedVolumeOunces: expect.closeTo(5.22, 2),
    });
    expect(snapshot.packaging.varianceCount).toBeCloseTo(-4, 2);
    expect(snapshot.packaging.discrepancyStatus).toBe("major");
    expect(snapshot.packaging.discrepancyLabel).toBe("Major discrepancy");
    expect(snapshot.packaging.items.find(item => item.key === "cups8oz")).toMatchObject({
      expectedUsed: 11,
      actualUsed: 19,
      variance: 8,
      discrepancyStatus: "major",
    });
    expect(snapshot.packaging.items.find(item => item.key === "lids4oz")).toBeUndefined();
    const comparablePackagingItems = snapshot.packaging.items.filter(item => item.actualUsed != null && item.variance != null && item.closingQuantity != null);
    const packagingOpeningTotal = comparablePackagingItems.reduce((sum, item) => sum + item.openingQuantity, 0);
    const packagingClosingTotal = comparablePackagingItems.reduce((sum, item) => sum + (item.closingQuantity ?? 0), 0);
    const packagingDistributedTotal = comparablePackagingItems.reduce((sum, item) => sum + (item.actualUsed ?? 0), 0);
    const packagingSoldTotal = comparablePackagingItems.reduce((sum, item) => sum + item.expectedUsed, 0);
    const packagingDifferenceTotal = comparablePackagingItems.reduce((sum, item) => sum + (item.variance ?? 0), 0);
    expect(packagingDistributedTotal).toBeCloseTo(packagingOpeningTotal - packagingClosingTotal, 2);
    expect(packagingDifferenceTotal).toBeCloseTo(packagingDistributedTotal - packagingSoldTotal, 2);
    expect(snapshot.packaging.items.find(item => item.key === "spoons")).toMatchObject({
      expectedUsed: 27,
      actualUsed: 6,
      variance: -21,
      discrepancyStatus: "major",
    });
    expect(snapshot.checklistCompletion).toEqual({ opening: 1, closing: 1 });
    expect(snapshot.latestReportStaff).toBe("Sofia");
  });

  it("classifies small gelato reconciliation gaps as sample or minor discrepancies", () => {
    const snapshot = buildDailySnapshot(
      [],
      [{ businessDate: "2026-04-21", staffName: "Marco", createdAt: new Date("2026-04-21T23:00:00Z") }],
      [
        {
          businessDate: "2026-04-21",
          staffName: "Marco",
          cups4oz: 0,
          cups4ozToGo: 0,
          cups8oz: 1,
          cups8ozToGo: 1,
          cupsPint: 0,
          cupsPintToGo: 0,
          cupsLiter: 0,
          cupsLiterToGo: 0,
          cashTotal: "0.00",
          cardTotal: "0.00",
          zelleTotal: "0.00",
          venmoTotal: "0.00",
          createdAt: new Date("2026-04-21T23:15:00Z"),
        },
      ],
      [
        {
          businessDate: "2026-04-21",
          flavor: "Chocolate",
          shiftType: "opening" as const,
          smallPanCount: 1,
          smallGrossWeightKg: "1.90",
          largePanCount: 0,
          largeGrossWeightKg: "0.00",
        },
        {
          businessDate: "2026-04-21",
          flavor: "Chocolate",
          shiftType: "closing" as const,
          smallPanCount: 1,
          smallGrossWeightKg: "1.85",
          largePanCount: 0,
          largeGrossWeightKg: "0.00",
        },
      ],
      [
        {
          itemName: "8oz To-Go Cups",
          currentQuantity: "11",
          lastCountDate: "2026-04-20",
        },
        {
          itemName: "8oz To-Go Lids",
          currentQuantity: "11",
          lastCountDate: "2026-04-20",
        },
      ],
      "2026-04-21"
    );
    expect(snapshot.soldVolumeOunces).toBe(8);
    expect(snapshot.gelato.actualDistributedVolumeOunces).toBeCloseTo(1.74, 2);
    expect(snapshot.gelato.actualDistributedVolumeOunces).toBeCloseTo(snapshot.gelato.openingVolumeOunces - snapshot.gelato.closingVolumeOunces, 2);
    expect(snapshot.gelato.varianceVolumeOunces).toBeCloseTo(-6.26, 2);
    expect(snapshot.gelato.varianceVolumeOunces).toBeCloseTo(snapshot.gelato.actualDistributedVolumeOunces - snapshot.gelato.soldVolumeOunces, 2);
    expect(snapshot.gelato.discrepancyStatus).toBe("minor");
    expect(snapshot.gelato.discrepancyLabel).toBe("Sample / minor discrepancy");
    expect(snapshot.packaging.items.find(item => item.key === "cups8oz")).toMatchObject({
      discrepancyStatus: "pending",
      discrepancyLabel: "Awaiting same-day closing inventory count",
    });
    expect(snapshot.packaging.discrepancyStatus).toBe("pending");
    expect(snapshot.packaging.discrepancyLabel).toBe("Awaiting same-day closing inventory count");
  });

  it("keeps gelato distributed ounces at zero until closing gelato measurements exist", () => {
    const snapshot = buildDailySnapshot(
      [],
      [],
      [],
      [
        {
          businessDate: "2026-04-21",
          flavor: "Cookies and Cream",
          shiftType: "opening" as const,
          smallPanCount: 1,
          smallGrossWeightKg: "1.75",
          largePanCount: 0,
          largeGrossWeightKg: "0.00",
        },
      ],
      [],
      "2026-04-21"
    );

    expect(snapshot.gelato.openingVolumeOunces).toBeGreaterThan(0);
    expect(snapshot.gelato.closingVolumeOunces).toBe(0);
    expect(snapshot.gelato.actualDistributedVolumeOunces).toBe(0);
    expect(snapshot.gelato.varianceVolumeOunces).toBe(0);
    expect(snapshot.gelato.discrepancyStatus).toBe("pending");
    expect(snapshot.gelato.discrepancyLabel).toBe("Awaiting closing form");
    expect(snapshot.gelato.flavors.find(item => item.flavor === "Cookies and Cream")).toMatchObject({
      usedVolumeOunces: 0,
    });
    expect(snapshot.packaging.discrepancyLabel).toBe("Awaiting closing form");
  });

  it("builds week-over-week sales series with previous week and delta values", () => {
    const series = buildWeekOverWeekSeries([
      { businessDate: "2026-04-06", cashTotal: "100.00", cardTotal: "200.00", zelleTotal: "20.00", venmoTotal: "30.00" },
      { businessDate: "2026-04-08", cashTotal: "50.00", cardTotal: "100.00", zelleTotal: "0.00", venmoTotal: "0.00" },
      { businessDate: "2026-04-15", cashTotal: "200.00", cardTotal: "250.00", zelleTotal: "40.00", venmoTotal: "10.00" },
    ]);

    expect(series).toEqual([
      {
        weekStart: "2026-04-06",
        totalSales: 500,
        previousWeekSales: 0,
        delta: 500,
      },
      {
        weekStart: "2026-04-13",
        totalSales: 500,
        previousWeekSales: 500,
        delta: 0,
      },
    ]);
  });

  it("builds recipe cost summaries with inventory matches, recipe-cost fallback, missing-cost handling, and cost per ounce", () => {
    const recipes = buildRecipeCostSummaries(
      [{ id: 1, name: "Vanilla", batchYieldOunces: "160", notes: "", processSteps: "Blend and freeze" }],
      [
        { id: 1, recipeId: 1, ingredientName: "Vanilla extract", quantity: "2", unitType: "cups", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
        { id: 2, recipeId: 1, ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" },
        { id: 3, recipeId: 1, ingredientName: "Water", quantity: "3", unitType: "liters", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
        { id: 4, recipeId: 1, ingredientName: "Sea Salt", quantity: "1", unitType: "tsp", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
      ],
      [
        { id: 10, itemName: "Vanilla", unitType: "cups", costPerUnit: "4.50", currentQuantity: "1", parLevel: "2", reorderQuantity: "3" },
        { id: 11, itemName: "Base", unitType: "bags", costPerUnit: "0.00", currentQuantity: "1", parLevel: "2", reorderQuantity: "3" },
        { id: 12, itemName: "Watermelon", unitType: "liters", costPerUnit: "2.00", currentQuantity: "1", parLevel: "2", reorderQuantity: "3" },
      ]
    );

    expect(recipes).toHaveLength(1);
    expect(recipes[0].batchCost).toBe(359);
    expect(recipes[0].costPerOunce).toBeCloseTo(2.24375, 5);
    expect(recipes[0].missingCostCount).toBe(2);
    expect(recipes[0].ingredients[0]).toMatchObject({
      inventoryItemName: "Vanilla",
      costSource: "inventory",
      totalCost: 9,
    });
    expect(recipes[0].ingredients[1]).toMatchObject({
      inventoryItemName: "Base",
      costSource: "recipe",
      costPerUnit: 350,
      totalCost: 350,
    });
    expect(recipes[0].ingredients[2]).toMatchObject({
      inventoryItemName: null,
      costSource: "missing",
      totalCost: 0,
    });
    expect(recipes[0].ingredients[3]).toMatchObject({
      costSource: "missing",
      totalCost: 0,
    });
  });

  it("keeps cost per ounce pending until yield is provided", () => {
    const recipes = buildRecipeCostSummaries(
      [{ id: 1, name: "Chocolate", batchYieldOunces: null, notes: "", processSteps: "" }],
      [{ id: 1, recipeId: 1, ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" }],
      []
    );

    expect(recipes[0]).toMatchObject({
      batchYieldOunces: 0,
      batchCost: 350,
      costPerOunce: null,
      missingCostCount: 0,
    });
    expect(recipes[0].ingredients[0]).toMatchObject({
      costSource: "recipe",
      costPerUnit: 350,
      totalCost: 350,
    });
  });

  it("automatically calculates cost per ounce when yield data is supplied later", () => {
    const recipes = buildRecipeCostSummaries(
      [{ id: 1, name: "Chocolate", batchYieldOunces: "140", notes: "", processSteps: "" }],
      [{ id: 1, recipeId: 1, ingredientName: "Base", quantity: "1", unitType: "bag", costPerUnit: "350.00", totalCost: "350.00", processSteps: "" }],
      []
    );

    expect(recipes[0]).toMatchObject({
      batchYieldOunces: 140,
      batchCost: 350,
      missingCostCount: 0,
    });
    expect(recipes[0].costPerOunce).toBeCloseTo(2.5, 5);
  });

  it("builds a recent-notes feed from low-item, waste, general, and closing notes in descending order", () => {
    const notes = buildRecentNotesFeed(
      [
        {
          businessDate: "2026-04-21",
          staffName: "Ava",
          lowItemNotes: "Need more spoons",
          wasteNotes: "One cracked pint lid",
          generalNotes: "Steady lunch crowd",
          createdAt: new Date("2026-04-21T19:00:00Z"),
        },
      ],
      [
        {
          businessDate: "2026-04-21",
          staffName: "Marco",
          notes: "Floors mopped and freezer checked",
          createdAt: new Date("2026-04-21T22:30:00Z"),
        },
      ],
      4
    );

    expect(notes).toHaveLength(4);
    expect(notes.map(note => note?.type)).toEqual([
      "Closing note",
      "Low-item alert",
      "Waste note",
      "General note",
    ]);
    expect(notes[0]).toMatchObject({ detail: "Floors mopped and freezer checked" });
  });
  it("keeps sold ounces correct and caps impossible gelato weights to pan capacity", () => {
    const snapshot = buildDailySnapshot(
      [],
      [],
      [
        {
          businessDate: "2026-04-29",
          staffName: "Karol",
          cups4oz: 8,
          cups4ozHere: 8,
          cups4ozToGo: 0,
          cups8oz: 52,
          cups8ozHere: 16,
          cups8ozToGo: 36,
          cupsPint: 50,
          cupsPintHere: 38,
          cupsPintToGo: 12,
          cupsLiter: 38,
          cupsLiterHere: 32,
          cupsLiterToGo: 6,
          cashTotal: "2050.00",
          cardTotal: "1350.00",
          zelleTotal: "0.00",
          venmoTotal: "0.00",
          createdAt: new Date("2026-04-29T08:26:34Z"),
        },
      ],
      [
        {
          businessDate: "2026-04-29",
          flavor: "Lemon",
          shiftType: "opening" as const,
          smallPanCount: 1,
          smallGrossWeightKg: "2694.00",
          largePanCount: 1,
          largeGrossWeightKg: "3.94",
        },
        {
          businessDate: "2026-04-29",
          flavor: "Lemon",
          shiftType: "closing" as const,
          smallPanCount: 1,
          smallGrossWeightKg: "2.62",
          largePanCount: 0,
          largeGrossWeightKg: "0.00",
        },
      ],
      [],
      "2026-04-29"
    );

    expect(snapshot.soldVolumeOunces).toBe(2464);
    expect(snapshot.gelato.openingVolumeOunces).toBeCloseTo(274.19, 2);
    expect(snapshot.gelato.closingVolumeOunces).toBeCloseTo(81.33, 2);
    expect(snapshot.gelato.actualDistributedVolumeOunces).toBeCloseTo(192.86, 2);
    expect(snapshot.gelato.actualDistributedVolumeOunces).toBeLessThan(500);
  });
});
