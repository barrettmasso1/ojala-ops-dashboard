import { describe, expect, it } from "vitest";
import { buildDailySnapshot, buildRecentNotesFeed, buildRecipeCostSummaries, buildWeekOverWeekSeries } from "./db";

describe("db aggregation helpers", () => {
  it("builds a daily snapshot with sales totals, cup totals, and checklist completion", () => {
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
          cups8oz: 12,
          cupsPint: 4,
          cupsLiter: 1,
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
          cups8oz: 7,
          cupsPint: 2,
          cupsLiter: 1,
          cashTotal: "150.00",
          cardTotal: "100.00",
          zelleTotal: "20.00",
          venmoTotal: "30.00",
          createdAt: new Date("2026-04-21T23:15:00Z"),
        },
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
    expect(snapshot.checklistCompletion).toEqual({ opening: 1, closing: 1 });
    expect(snapshot.latestReportStaff).toBe("Sofia");
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

  it("builds recipe cost summaries with inventory-linked costs, missing-cost handling, and cost per ounce", () => {
    const recipes = buildRecipeCostSummaries(
      [{ id: 1, name: "Vanilla", batchYieldOunces: "160", notes: "", processSteps: "Blend and freeze" }],
      [
        { id: 1, recipeId: 1, ingredientName: "Vanilla", quantity: "2", unitType: "cups", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
        { id: 2, recipeId: 1, ingredientName: "Sea Salt", quantity: "1", unitType: "tsp", costPerUnit: "0.00", totalCost: "0.00", processSteps: "" },
      ],
      [{ id: 10, itemName: "Vanilla", unitType: "cups", costPerUnit: "4.50", currentQuantity: "1", parLevel: "2", reorderQuantity: "3" }]
    );

    expect(recipes).toHaveLength(1);
    expect(recipes[0].batchCost).toBe(9);
    expect(recipes[0].costPerOunce).toBeCloseTo(0.05625, 5);
    expect(recipes[0].missingCostCount).toBe(1);
    expect(recipes[0].ingredients[0]).toMatchObject({
      inventoryItemName: "Vanilla",
      costSource: "inventory",
      totalCost: 9,
    });
    expect(recipes[0].ingredients[1]).toMatchObject({
      costSource: "missing",
      totalCost: 0,
    });
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
});
