import { describe, expect, it } from "vitest";

import { buildShopifyVarianceSnapshot, parseCsvLine, summarizeShopifySalesCsv } from "./shopifySalesCsv";

describe("shopify sales csv helper", () => {
  it("parses quoted csv fields without breaking product titles", () => {
    expect(parseCsvLine('"Pint (To go)","Default Title",,7,1260,-180,0,1080,0,1080')).toEqual([
      "Pint (To go)",
      "Default Title",
      "",
      "7",
      "1260",
      "-180",
      "0",
      "1080",
      "0",
      "1080",
    ]);
  });

  it("maps supported Shopify gelato products into sold ounces and excludes unmapped rows", () => {
    const summary = summarizeShopifySalesCsv(`"Product title","Product variant title","Product variant SKU","Net items sold","Gross sales","Discounts","Returns","Net sales","Taxes","Total sales"
"Pint (To go)","Default Title",,7,1260,-180,0,1080,0,1080
"Medium (To go)","Default Title",,10,1100,-100,-100,900,0,900
"Small (To go)","Default Title",,9,630,0,0,630,0,630
"Small (for here)","Default Title",,8,560,0,0,560,0,560
"Liter (To go)","Default Title",,1,360,0,0,360,0,360
"Kambucha (ginger)","Default Title",,1,90,0,0,90,0,90
"Medium (for here)","Default Title",,1,100,-100,0,0,0,0`);

    expect(summary.totalSoldVolumeOunces).toBe(300);
    expect(summary.totalNetItemsSold).toBe(36);
    expect(summary.includedProductCount).toBe(6);
    expect(summary.soldRows.map(row => ({ productTitle: row.productTitle, soldVolumeOunces: row.soldVolumeOunces }))).toEqual([
      { productTitle: "Pint (To go)", soldVolumeOunces: 112 },
      { productTitle: "Medium (To go)", soldVolumeOunces: 80 },
      { productTitle: "Small (To go)", soldVolumeOunces: 36 },
      { productTitle: "Small (for here)", soldVolumeOunces: 32 },
      { productTitle: "Liter (To go)", soldVolumeOunces: 32 },
      { productTitle: "Medium (for here)", soldVolumeOunces: 8 },
    ]);
    expect(summary.excludedRows).toEqual([
      expect.objectContaining({ productTitle: "Kambucha (ginger)", reason: "Not mapped to a gelato serving size" }),
    ]);
  });

  it("classifies a large gap between distributed and sold ounces as a major discrepancy", () => {
    expect(buildShopifyVarianceSnapshot(540.9, 300)).toEqual({
      distributedVolumeOunces: 540.9,
      soldVolumeOunces: 300,
      differenceVolumeOunces: 240.9,
      differencePercentOfSold: 80.3,
      differencePercentOfDistributed: 44.5,
      status: "major",
    });
  });

  it("keeps normal sample loss within tolerance when the gap is small", () => {
    expect(buildShopifyVarianceSnapshot(500, 470).status).toBe("within-tolerance");
    expect(buildShopifyVarianceSnapshot(500, 420).status).toBe("review");
  });
});
