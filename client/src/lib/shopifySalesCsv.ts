type ShopifyCsvRecord = Record<string, string>;

export type ShopifySalesImportRow = {
  productTitle: string;
  variantTitle: string;
  sku: string;
  netItemsSold: number;
  grossSales: number;
  discounts: number;
  returns: number;
  netSales: number;
  taxes: number;
  totalSales: number;
};

export type ShopifyGelatoSoldRow = ShopifySalesImportRow & {
  normalizedKey: string;
  ouncesEach: number;
  soldVolumeOunces: number;
  sizeLabel: "4oz" | "8oz" | "Pint" | "Liter";
  serviceMode: "for-here" | "to-go" | "unknown";
};

export type ShopifyExcludedRow = ShopifySalesImportRow & {
  reason: string;
};

export type ShopifySalesImportSummary = {
  soldRows: ShopifyGelatoSoldRow[];
  excludedRows: ShopifyExcludedRow[];
  totalSoldVolumeOunces: number;
  totalNetItemsSold: number;
  includedProductCount: number;
};

const SIZE_MAPPINGS: Array<{
  match: (normalizedKey: string) => boolean;
  ouncesEach: number;
  sizeLabel: ShopifyGelatoSoldRow["sizeLabel"];
}> = [
  {
    match: normalizedKey => normalizedKey.startsWith("small "),
    ouncesEach: 4,
    sizeLabel: "4oz",
  },
  {
    match: normalizedKey => normalizedKey.startsWith("medium "),
    ouncesEach: 8,
    sizeLabel: "8oz",
  },
  {
    match: normalizedKey => normalizedKey.startsWith("pint "),
    ouncesEach: 16,
    sizeLabel: "Pint",
  },
  {
    match: normalizedKey => normalizedKey.startsWith("liter "),
    ouncesEach: 32,
    sizeLabel: "Liter",
  },
];

function roundTo(value: number, decimals = 1) {
  return Number(value.toFixed(decimals));
}

function normalizeProductKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function inferServiceMode(normalizedKey: string): ShopifyGelatoSoldRow["serviceMode"] {
  if (normalizedKey.includes("for here")) return "for-here";
  if (normalizedKey.includes("to go")) return "to-go";
  return "unknown";
}

function parseNumber(value: string | undefined) {
  if (!value) return 0;
  const cleaned = value.replace(/[$,\s]/g, "").trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
        continue;
      }

      insideQuotes = !insideQuotes;
      continue;
    }

    if (character === "," && !insideQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
}

export function parseShopifySalesCsv(csvText: string) {
  const lines = csvText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("Upload a Shopify CSV with a header row and at least one sales row.");
  }

  const header = parseCsvLine(lines[0]);
  const records = lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    return header.reduce<ShopifyCsvRecord>((record, key, index) => {
      record[key] = values[index] ?? "";
      return record;
    }, {});
  });

  return records.map<ShopifySalesImportRow>(record => ({
    productTitle: record["Product title"] ?? "",
    variantTitle: record["Product variant title"] ?? "",
    sku: record["Product variant SKU"] ?? "",
    netItemsSold: parseNumber(record["Net items sold"]),
    grossSales: parseNumber(record["Gross sales"]),
    discounts: parseNumber(record["Discounts"]),
    returns: parseNumber(record["Returns"]),
    netSales: parseNumber(record["Net sales"]),
    taxes: parseNumber(record["Taxes"]),
    totalSales: parseNumber(record["Total sales"]),
  }));
}

export function summarizeShopifySalesCsv(csvText: string): ShopifySalesImportSummary {
  const rows = parseShopifySalesCsv(csvText);
  const soldRows: ShopifyGelatoSoldRow[] = [];
  const excludedRows: ShopifyExcludedRow[] = [];

  rows.forEach(row => {
    const normalizedKey = normalizeProductKey(row.productTitle);
    const sizeMapping = SIZE_MAPPINGS.find(candidate => candidate.match(normalizedKey));

    if (!sizeMapping) {
      excludedRows.push({
        ...row,
        reason: "Not mapped to a gelato serving size",
      });
      return;
    }

    soldRows.push({
      ...row,
      normalizedKey,
      ouncesEach: sizeMapping.ouncesEach,
      soldVolumeOunces: roundTo(row.netItemsSold * sizeMapping.ouncesEach),
      sizeLabel: sizeMapping.sizeLabel,
      serviceMode: inferServiceMode(normalizedKey),
    });
  });

  return {
    soldRows,
    excludedRows,
    totalSoldVolumeOunces: roundTo(soldRows.reduce((sum, row) => sum + row.soldVolumeOunces, 0)),
    totalNetItemsSold: roundTo(soldRows.reduce((sum, row) => sum + row.netItemsSold, 0)),
    includedProductCount: soldRows.length,
  };
}

export function buildShopifyVarianceSnapshot(distributedVolumeOunces: number, totalSoldVolumeOunces: number) {
  const distributed = Math.max(0, distributedVolumeOunces || 0);
  const sold = Math.max(0, totalSoldVolumeOunces || 0);
  const differenceVolumeOunces = roundTo(distributed - sold);
  const differencePercentOfSold = sold > 0 ? roundTo((differenceVolumeOunces / sold) * 100, 1) : null;
  const differencePercentOfDistributed = distributed > 0 ? roundTo((differenceVolumeOunces / distributed) * 100, 1) : null;
  const absolutePercentOfDistributed = distributed > 0 ? Math.abs((differenceVolumeOunces / distributed) * 100) : null;

  const status = absolutePercentOfDistributed == null
    ? "awaiting-data"
    : absolutePercentOfDistributed <= 10
      ? "within-tolerance"
      : absolutePercentOfDistributed <= 25
        ? "review"
        : "major";

  return {
    distributedVolumeOunces: roundTo(distributed),
    soldVolumeOunces: roundTo(sold),
    differenceVolumeOunces,
    differencePercentOfSold,
    differencePercentOfDistributed,
    status,
  };
}
