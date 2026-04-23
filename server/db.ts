import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  checklistQuestions,
  closingChecklists,
  endOfDayReports,
  InsertChecklistQuestion,
  InsertClosingChecklist,
  InsertEndOfDayReport,
  InsertOpeningChecklist,
  InsertRecipe,
  InsertRecipeIngredient,
  InsertReadyMadeGelatoWeight,
  InsertUser,
  inventoryItems,
  openingChecklists,
  readyMadeGelatoWeights,
  recipeIngredients,
  recipes,
  users,
} from "../drizzle/schema";
import { DEFAULT_INVENTORY_ITEMS, DEFAULT_RECIPE_ITEMS, READY_MADE_GELATO_FLAVORS } from "../shared/opsCatalog";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

function normalizeDate(date?: string) {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Date().toISOString().slice(0, 10);
}

function getWeekStart(dateString: string) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

const defaultChecklistQuestions: Array<InsertChecklistQuestion> = [
  { checklistType: "opening", sectionTitle: "Equipment", prompt: "Freezers ON and cold", detailPrompt: "If no, what is wrong?", detailTrigger: "No", displayOrder: 1, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Equipment", prompt: "Display freezer stocked", detailPrompt: "If no, what needs to be stocked?", detailTrigger: "No", displayOrder: 2, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Equipment", prompt: "Gelato texture checked", detailPrompt: "If no, what texture issue did you notice?", detailTrigger: "No", displayOrder: 3, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Equipment", prompt: "Machines running properly", detailPrompt: "If no, describe the issue.", detailTrigger: "No", displayOrder: 4, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Cleanliness", prompt: "Counters clean", detailPrompt: "If no, what still needs to be cleaned?", detailTrigger: "No", displayOrder: 5, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Cleanliness", prompt: "Floors clean", detailPrompt: "If no, what still needs attention?", detailTrigger: "No", displayOrder: 6, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Cleanliness", prompt: "Sink clean", detailPrompt: "If no, what still needs attention?", detailTrigger: "No", displayOrder: 7, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Cleanliness", prompt: "All trash is emptied", detailPrompt: "If no, explain why.", detailTrigger: "No", displayOrder: 8, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Setup", prompt: "Napkins stocked", detailPrompt: "If no, what is missing?", detailTrigger: "No", displayOrder: 9, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Employee Preparation", prompt: "Employee ready for work", detailPrompt: "If no, explain what is incomplete.", detailTrigger: "No", displayOrder: 10, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Employee Preparation", prompt: "Shirt clean and ironed", detailPrompt: "If no, explain the issue.", detailTrigger: "No", displayOrder: 11, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Employee Preparation", prompt: "Specified uniform worn correctly", detailPrompt: "If no, explain the issue.", detailTrigger: "No", displayOrder: 12, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Employee Preparation", prompt: "Presentation clean and professional", detailPrompt: "If no, explain the issue.", detailTrigger: "No", displayOrder: 13, isActive: 1 },
  { checklistType: "opening", sectionTitle: "Final", prompt: "Store ready to open", detailPrompt: "If no, what is still pending?", detailTrigger: "No", displayOrder: 14, isActive: 1 },
  { checklistType: "closing", sectionTitle: "Cleaning", prompt: "Counters cleaned", detailPrompt: "If no, what remains?", detailTrigger: "No", displayOrder: 1, isActive: 1 },
  { checklistType: "closing", sectionTitle: "Cleaning", prompt: "Floors cleaned", detailPrompt: "If no, what remains?", detailTrigger: "No", displayOrder: 2, isActive: 1 },
  { checklistType: "closing", sectionTitle: "Cleaning", prompt: "Utensils washed", detailPrompt: "If no, what remains?", detailTrigger: "No", displayOrder: 3, isActive: 1 },
  { checklistType: "closing", sectionTitle: "Cleaning", prompt: "Trash taken out", detailPrompt: "If no, explain why.", detailTrigger: "No", displayOrder: 4, isActive: 1 },
  { checklistType: "closing", sectionTitle: "Product", prompt: "Gelato stored properly", detailPrompt: "If no, explain the issue.", detailTrigger: "No", displayOrder: 5, isActive: 1 },
  { checklistType: "closing", sectionTitle: "Product", prompt: "Freezers closed and working", detailPrompt: "If no, explain the issue.", detailTrigger: "No", displayOrder: 6, isActive: 1 },
  { checklistType: "closing", sectionTitle: "Final", prompt: "Store closed properly", detailPrompt: "If no, explain the issue.", detailTrigger: "No", displayOrder: 7, isActive: 1 },
];

const retiredChecklistPrompts = new Set([
  "Cups stocked",
  "Lids stocked",
  "Spoons stocked",
  "Toppings filled",
]);

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeUnit(value?: string) {
  const raw = normalizeKey(value ?? "");
  if (!raw) return "";
  const aliases: Record<string, string> = {
    bag: "bag",
    bags: "bag",
    box: "box",
    boxes: "box",
    pack: "pack",
    packs: "pack",
    set: "set",
    unit: "unit",
    units: "unit",
    g: "g",
    gram: "g",
    grams: "g",
    kg: "kg",
    kilo: "kg",
    kilos: "kg",
    kilogram: "kg",
    kilograms: "kg",
    l: "l",
    liter: "l",
    liters: "l",
    litre: "l",
    litres: "l",
    ml: "ml",
    cup: "cup",
    cups: "cup",
    tsp: "tsp",
    teaspoon: "tsp",
    teaspoons: "tsp",
    tbsp: "tbsp",
    tablespoon: "tbsp",
    tablespoons: "tbsp",
    lime: "lime",
    limes: "lime",
  };
  return aliases[raw] ?? raw;
}

function findInventoryMatchByName<T extends { id?: number; itemName: string; unitType?: string; costPerUnit?: string | number }>(name: string, items: T[]) {
  const normalized = normalizeKey(name);
  return items.find(item => normalizeKey(item.itemName) === normalized)
    ?? items.find(item => normalizeKey(item.itemName).includes(normalized))
    ?? items.find(item => normalized.includes(normalizeKey(item.itemName)));
}

async function ensureInventorySeeded() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db.select().from(inventoryItems).limit(1);
  if (existing.length > 0) return;

  await db.insert(inventoryItems).values(
    DEFAULT_INVENTORY_ITEMS.map(item => ({
      department: item.department,
      category: item.category,
      itemName: item.itemName,
      unitType: item.unitType,
      packSize: item.packSize,
      costPerUnit: item.costPerUnit,
      currentQuantity: item.currentInventory,
      parLevel: item.parLevel,
      reorderQuantity: item.reorderQuantity,
      supplier: item.supplier,
      supplierContact: item.supplierContact,
      lastCountDate: "",
      notes: item.notes,
    }))
  );
}

async function ensureRecipesSeeded() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db.select().from(recipes).limit(1);
  if (existing.length > 0) return;

  const recipeNames = Array.from(new Set(DEFAULT_RECIPE_ITEMS.map(item => item.recipeName)));
  if (recipeNames.length === 0) return;

  const recipeRows: InsertRecipe[] = recipeNames.map(name => ({
    name,
    batchYieldOunces: "0.00",
    notes: "",
    processSteps: "",
  }));

  await db.insert(recipes).values(recipeRows);
  const insertedRecipes = await db.select().from(recipes).orderBy(recipes.name);
  const recipeIdByName = new Map(insertedRecipes.map(recipe => [recipe.name, recipe.id]));

  const ingredientRows: InsertRecipeIngredient[] = DEFAULT_RECIPE_ITEMS.map((item, index) => ({
    recipeId: recipeIdByName.get(item.recipeName) ?? 0,
    inventoryItemId: null,
    ingredientName: item.ingredientName,
    quantity: item.quantity || "0",
    unitType: item.unitType || "units",
    costPerUnit: item.costPerUnit || "0.00",
    totalCost: item.totalCost || "0.00",
    sortOrder: index + 1,
    processSteps: item.processSteps || "",
  })).filter(item => item.recipeId > 0);

  if (ingredientRows.length > 0) {
    await db.insert(recipeIngredients).values(ingredientRows);
  }
}

function calculateOpeningCompletion(entry: {
  staffName: string;
  equipmentStatus: string;
  cleanlinessStatus: string;
  setupStatus: string;
  startingCash: unknown;
  cashMatchesSystem: string;
  storeReadyStatus: string;
}) {
  const checks = [
    Boolean(entry.staffName?.trim()),
    Boolean(entry.equipmentStatus?.trim()),
    Boolean(entry.cleanlinessStatus?.trim()),
    Boolean(entry.setupStatus?.trim()),
    toNumber(entry.startingCash) >= 0,
    entry.cashMatchesSystem === "Yes",
    entry.storeReadyStatus === "Yes",
  ];
  return checks.filter(Boolean).length / checks.length;
}

function calculateClosingCompletion(entry: {
  staffName: string;
  cashCounted: unknown;
  cashMatchesSystem: string;
  cleaningStatus: string;
  productStorageStatus: string;
  storeClosedStatus: string;
}) {
  const checks = [
    Boolean(entry.staffName?.trim()),
    toNumber(entry.cashCounted) >= 0,
    entry.cashMatchesSystem === "Yes",
    Boolean(entry.cleaningStatus?.trim()),
    Boolean(entry.productStorageStatus?.trim()),
    entry.storeClosedStatus === "Yes",
  ];
  return checks.filter(Boolean).length / checks.length;
}

export function buildDailySnapshot(
  openingEntries: Array<{
    staffName: string;
    equipmentStatus: string;
    cleanlinessStatus: string;
    setupStatus: string;
    startingCash: unknown;
    cashMatchesSystem: string;
    storeReadyStatus: string;
    createdAt?: Date;
  }>,
  closingEntries: Array<{
    staffName: string;
    cashCounted: unknown;
    cashMatchesSystem: string;
    cleaningStatus: string;
    productStorageStatus: string;
    storeClosedStatus: string;
    createdAt?: Date;
  }>,
  reports: Array<{
    businessDate: string;
    staffName: string;
    cups4oz: number;
    cups8oz: number;
    cupsPint: number;
    cupsLiter: number;
    cashTotal: unknown;
    cardTotal: unknown;
    zelleTotal: unknown;
    venmoTotal: unknown;
    createdAt?: Date;
  }>,
  businessDate: string
) {
  const sales = reports.reduce(
    (acc, report) => {
      acc.cash += toNumber(report.cashTotal);
      acc.card += toNumber(report.cardTotal);
      acc.zelle += toNumber(report.zelleTotal);
      acc.venmo += toNumber(report.venmoTotal);
      acc.total += toNumber(report.cashTotal) + toNumber(report.cardTotal) + toNumber(report.zelleTotal) + toNumber(report.venmoTotal);
      acc.cups4oz += report.cups4oz;
      acc.cups8oz += report.cups8oz;
      acc.cupsPint += report.cupsPint;
      acc.cupsLiter += report.cupsLiter;
      return acc;
    },
    {
      total: 0,
      cash: 0,
      card: 0,
      zelle: 0,
      venmo: 0,
      cups4oz: 0,
      cups8oz: 0,
      cupsPint: 0,
      cupsLiter: 0,
    }
  );

  const openingCompletionRate = openingEntries.length
    ? openingEntries.reduce((sum, entry) => sum + calculateOpeningCompletion(entry), 0) / openingEntries.length
    : 0;
  const closingCompletionRate = closingEntries.length
    ? closingEntries.reduce((sum, entry) => sum + calculateClosingCompletion(entry), 0) / closingEntries.length
    : 0;

  const latestReport = [...reports].sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0))[0];

  return {
    businessDate,
    reportCount: reports.length,
    openingSubmissionCount: openingEntries.length,
    closingSubmissionCount: closingEntries.length,
    sales,
    cups: {
      "4oz": sales.cups4oz,
      "8oz": sales.cups8oz,
      Pint: sales.cupsPint,
      Liter: sales.cupsLiter,
    },
    checklistCompletion: {
      opening: openingCompletionRate,
      closing: closingCompletionRate,
    },
    latestReportStaff: latestReport?.staffName ?? null,
  };
}

export function buildWeekOverWeekSeries(
  reports: Array<{
    businessDate: string;
    cashTotal: unknown;
    cardTotal: unknown;
    zelleTotal: unknown;
    venmoTotal: unknown;
  }>
) {
  const weekly = new Map<string, number>();

  for (const report of reports) {
    const weekStart = getWeekStart(report.businessDate);
    const totalSales = toNumber(report.cashTotal) + toNumber(report.cardTotal) + toNumber(report.zelleTotal) + toNumber(report.venmoTotal);
    weekly.set(weekStart, (weekly.get(weekStart) ?? 0) + totalSales);
  }

  const series = Array.from(weekly.entries())
    .map(([weekStart, totalSales]) => ({ weekStart, totalSales }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  return series.slice(-8).map((entry, index, arr) => ({
    ...entry,
    previousWeekSales: index > 0 ? arr[index - 1]?.totalSales ?? 0 : 0,
    delta: index > 0 ? entry.totalSales - (arr[index - 1]?.totalSales ?? 0) : entry.totalSales,
  }));
}

export function buildRecentNotesFeed(
  reports: Array<{
    businessDate: string;
    staffName: string;
    lowItemNotes?: string | null;
    wasteNotes?: string | null;
    generalNotes?: string | null;
    createdAt: Date;
  }>,
  closings: Array<{
    businessDate: string;
    staffName: string;
    notes?: string | null;
    createdAt: Date;
  }>,
  limit = 12
) {
  return [
    ...reports.flatMap(report => [
      report.lowItemNotes?.trim()
        ? {
            type: "Low-item alert",
            businessDate: report.businessDate,
            staffName: report.staffName,
            detail: report.lowItemNotes,
            createdAt: report.createdAt,
          }
        : null,
      report.wasteNotes?.trim()
        ? {
            type: "Waste note",
            businessDate: report.businessDate,
            staffName: report.staffName,
            detail: report.wasteNotes,
            createdAt: report.createdAt,
          }
        : null,
      report.generalNotes?.trim()
        ? {
            type: "General note",
            businessDate: report.businessDate,
            staffName: report.staffName,
            detail: report.generalNotes,
            createdAt: report.createdAt,
          }
        : null,
    ]),
    ...closings.map(entry =>
      entry.notes?.trim()
        ? {
            type: "Closing note",
            businessDate: entry.businessDate,
            staffName: entry.staffName,
            detail: entry.notes,
            createdAt: entry.createdAt,
          }
        : null
    ),
  ]
    .filter(Boolean)
    .sort((a, b) => (b?.createdAt?.getTime?.() ?? 0) - (a?.createdAt?.getTime?.() ?? 0))
    .slice(0, limit);
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;

  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) {
    values.lastSignedIn = new Date();
  }
  if (Object.keys(updateSet).length === 0) {
    updateSet.lastSignedIn = new Date();
  }

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function createOpeningChecklist(input: InsertOpeningChecklist) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const values: InsertOpeningChecklist = {
    ...input,
    businessDate: normalizeDate(input.businessDate),
  };

  await db.insert(openingChecklists).values(values);
  return values;
}

export async function createClosingChecklist(input: InsertClosingChecklist) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const values: InsertClosingChecklist = {
    ...input,
    businessDate: normalizeDate(input.businessDate),
  };

  await db.insert(closingChecklists).values(values);
  return values;
}

export async function createEndOfDayReport(input: InsertEndOfDayReport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const values: InsertEndOfDayReport = {
    ...input,
    businessDate: normalizeDate(input.businessDate),
  };

  await db.insert(endOfDayReports).values(values);
  return values;
}

export async function listChecklistQuestions(checklistType: "opening" | "closing") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(checklistQuestions)
    .where(eq(checklistQuestions.checklistType, checklistType))
    .orderBy(checklistQuestions.displayOrder, checklistQuestions.id);

  if (existing.length > 0) {
    return existing.filter(item => item.isActive === 1 && !retiredChecklistPrompts.has(item.prompt));
  }

  const defaults = defaultChecklistQuestions.filter(item => item.checklistType === checklistType);
  if (defaults.length > 0) {
    await db.insert(checklistQuestions).values(defaults);
  }

  return db
    .select()
    .from(checklistQuestions)
    .where(eq(checklistQuestions.checklistType, checklistType))
    .orderBy(checklistQuestions.displayOrder, checklistQuestions.id);
}

export async function saveChecklistQuestion(input: {
  id?: number;
  checklistType: "opening" | "closing";
  sectionTitle: string;
  prompt: string;
  detailPrompt?: string;
  detailTrigger: "Yes" | "No" | "Never";
  displayOrder: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (input.id) {
    await db
      .update(checklistQuestions)
      .set({
        checklistType: input.checklistType,
        sectionTitle: input.sectionTitle,
        prompt: input.prompt,
        detailPrompt: input.detailPrompt ?? "",
        detailTrigger: input.detailTrigger,
        displayOrder: input.displayOrder,
        isActive: 1,
      })
      .where(eq(checklistQuestions.id, input.id));

    const updated = await db.select().from(checklistQuestions).where(eq(checklistQuestions.id, input.id)).limit(1);
    return updated[0];
  }

  const result = await db.insert(checklistQuestions).values({
    checklistType: input.checklistType,
    sectionTitle: input.sectionTitle,
    prompt: input.prompt,
    detailPrompt: input.detailPrompt ?? "",
    detailTrigger: input.detailTrigger,
    displayOrder: input.displayOrder,
    isActive: 1,
  });

  const inserted = await db.select().from(checklistQuestions).where(eq(checklistQuestions.id, Number(result[0]?.insertId ?? 0))).limit(1);
  return inserted[0];
}

export async function removeChecklistQuestion(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(checklistQuestions).set({ isActive: 0 }).where(eq(checklistQuestions.id, id));
  return { success: true } as const;
}

export async function listInventoryItems() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await ensureInventorySeeded();

  const items = await db.select().from(inventoryItems).orderBy(inventoryItems.department, inventoryItems.category, inventoryItems.itemName);
  return items.map(item => ({
    ...item,
    currentQuantity: toNumber(item.currentQuantity),
    parLevel: toNumber(item.parLevel),
    reorderQuantity: toNumber(item.reorderQuantity),
    costPerUnit: toNumber(item.costPerUnit),
    reorderNeeded: toNumber(item.currentQuantity) <= toNumber(item.parLevel),
  }));
}

export async function saveInventoryItem(input: {
  id?: number;
  department: string;
  category: string;
  itemName: string;
  unitType: string;
  packSize: string;
  costPerUnit: string;
  currentQuantity: string;
  parLevel: string;
  reorderQuantity: string;
  supplier?: string;
  supplierContact?: string;
  lastCountDate?: string;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const values = {
    department: input.department,
    category: input.category,
    itemName: input.itemName,
    unitType: input.unitType,
    packSize: input.packSize,
    costPerUnit: input.costPerUnit,
    currentQuantity: input.currentQuantity,
    parLevel: input.parLevel,
    reorderQuantity: input.reorderQuantity,
    supplier: input.supplier ?? "",
    supplierContact: input.supplierContact ?? "",
    lastCountDate: input.lastCountDate ?? "",
    notes: input.notes ?? "",
  };

  if (input.id) {
    await db.update(inventoryItems).set(values).where(eq(inventoryItems.id, input.id));
    const updated = await db.select().from(inventoryItems).where(eq(inventoryItems.id, input.id)).limit(1);
    return updated[0];
  }

  const result = await db.insert(inventoryItems).values(values);
  const inserted = await db.select().from(inventoryItems).where(eq(inventoryItems.id, Number(result[0]?.insertId ?? 0))).limit(1);
  return inserted[0];
}

export async function updateInventoryCount(input: {
  id: number;
  currentQuantity: string;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db.select().from(inventoryItems).where(eq(inventoryItems.id, input.id)).limit(1);
  const current = existing[0];
  if (!current) {
    throw new Error("Inventory item not found");
  }

  await db
    .update(inventoryItems)
    .set({
      currentQuantity: input.currentQuantity,
      notes: input.notes ?? current.notes ?? "",
      lastCountDate: normalizeDate(),
    })
    .where(eq(inventoryItems.id, input.id));

  const updated = await db.select().from(inventoryItems).where(eq(inventoryItems.id, input.id)).limit(1);
  return updated[0];
}

export async function listReadyMadeGelatoWeights(businessDate?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalizedDate = normalizeDate(businessDate);
  const rows = await db
    .select()
    .from(readyMadeGelatoWeights)
    .where(eq(readyMadeGelatoWeights.businessDate, normalizedDate))
    .orderBy(readyMadeGelatoWeights.flavor);

  const rowByFlavor = new Map(rows.map(row => [row.flavor, row]));

  return READY_MADE_GELATO_FLAVORS.map(flavor => {
    const row = rowByFlavor.get(flavor);
    return {
      id: row?.id ?? null,
      businessDate: normalizedDate,
      flavor,
      weightKg: toNumber(row?.weightKg),
      submittedByUserId: row?.submittedByUserId ?? null,
      createdAt: row?.createdAt ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export async function saveReadyMadeGelatoWeights(input: {
  businessDate?: string;
  submittedByUserId: number;
  entries: Array<{ flavor: string; weightKg: string }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalizedDate = normalizeDate(input.businessDate);
  const savedRows: Array<{ id: number; businessDate: string; flavor: string; weightKg: number }> = [];

  for (const flavor of READY_MADE_GELATO_FLAVORS) {
    const entry = input.entries.find(item => item.flavor === flavor);
    if (!entry) continue;

    const values: InsertReadyMadeGelatoWeight = {
      businessDate: normalizedDate,
      flavor,
      weightKg: entry.weightKg,
      submittedByUserId: input.submittedByUserId,
    };

    const existing = await db
      .select()
      .from(readyMadeGelatoWeights)
      .where(and(eq(readyMadeGelatoWeights.businessDate, normalizedDate), eq(readyMadeGelatoWeights.flavor, flavor)))
      .limit(1);

    if (existing[0]) {
      await db.update(readyMadeGelatoWeights).set(values).where(eq(readyMadeGelatoWeights.id, existing[0].id));
      savedRows.push({
        id: existing[0].id,
        businessDate: normalizedDate,
        flavor,
        weightKg: toNumber(entry.weightKg),
      });
      continue;
    }

    const result = await db.insert(readyMadeGelatoWeights).values(values);
    savedRows.push({
      id: Number(result[0]?.insertId ?? 0),
      businessDate: normalizedDate,
      flavor,
      weightKg: toNumber(entry.weightKg),
    });
  }

  return savedRows;
}

export function buildRecipeCostSummaries(
  recipeRows: Array<{ id: number; name: string; batchYieldOunces: string | number | null; notes?: string | null; processSteps?: string | null }>,
  ingredientRows: Array<{ id: number; recipeId: number; ingredientName: string; quantity: string | number | null; unitType: string; inventoryItemId?: number | null; costPerUnit?: string | number | null; totalCost?: string | number | null; processSteps?: string | null }>,
  inventoryRows: Array<{ id: number; itemName: string; unitType: string; costPerUnit: string | number; currentQuantity?: string | number | null; parLevel?: string | number | null; reorderQuantity?: string | number | null }>,
) {
  return recipeRows.map(recipe => {
    const ingredients = ingredientRows
      .filter(item => item.recipeId === recipe.id)
      .map(item => {
        const matchedInventoryItem = findInventoryMatchByName(item.ingredientName, inventoryRows);
        const recipeUnit = normalizeUnit(item.unitType);
        const inventoryUnit = normalizeUnit(matchedInventoryItem?.unitType);
        const canUseInventoryCost = Boolean(matchedInventoryItem) && recipeUnit !== "" && recipeUnit === inventoryUnit;
        const resolvedCostPerUnit = canUseInventoryCost
          ? toNumber(matchedInventoryItem?.costPerUnit)
          : toNumber(item.costPerUnit);
        const calculatedTotalCost = resolvedCostPerUnit > 0
          ? toNumber(item.quantity) * resolvedCostPerUnit
          : toNumber(item.totalCost);

        return {
          id: item.id,
          ingredientName: item.ingredientName,
          quantity: toNumber(item.quantity),
          unitType: item.unitType,
          inventoryItemId: matchedInventoryItem?.id ?? item.inventoryItemId ?? null,
          inventoryItemName: matchedInventoryItem?.itemName ?? null,
          matchedInventoryUnit: matchedInventoryItem?.unitType ?? null,
          costPerUnit: resolvedCostPerUnit,
          totalCost: calculatedTotalCost,
          costSource: canUseInventoryCost ? "inventory" : toNumber(item.costPerUnit) > 0 ? "recipe" : "missing",
          processSteps: item.processSteps ?? "",
        };
      });

    const batchCost = ingredients.reduce((sum, item) => sum + item.totalCost, 0);
    const batchYieldOunces = toNumber(recipe.batchYieldOunces);

    return {
      id: recipe.id,
      name: recipe.name,
      batchYieldOunces,
      batchCost,
      costPerOunce: batchYieldOunces > 0 ? batchCost / batchYieldOunces : null,
      notes: recipe.notes ?? "",
      processSteps: recipe.processSteps ?? "",
      ingredients,
      missingCostCount: ingredients.filter(item => item.costSource === "missing").length,
    };
  });
}

export async function listRecipesWithCosts() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await ensureInventorySeeded();
  await ensureRecipesSeeded();

  const [recipeRows, ingredientRows, inventoryRows] = await Promise.all([
    db.select().from(recipes).orderBy(recipes.name),
    db.select().from(recipeIngredients).orderBy(recipeIngredients.recipeId, recipeIngredients.sortOrder, recipeIngredients.id),
    db.select().from(inventoryItems),
  ]);

  return buildRecipeCostSummaries(recipeRows, ingredientRows, inventoryRows);
}

export async function getDailyOperationsSnapshot(businessDate?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalizedDate = normalizeDate(businessDate);
  const [openingEntries, closingEntries, reports] = await Promise.all([
    db.select().from(openingChecklists).where(eq(openingChecklists.businessDate, normalizedDate)).orderBy(desc(openingChecklists.createdAt)),
    db.select().from(closingChecklists).where(eq(closingChecklists.businessDate, normalizedDate)).orderBy(desc(closingChecklists.createdAt)),
    db.select().from(endOfDayReports).where(eq(endOfDayReports.businessDate, normalizedDate)).orderBy(desc(endOfDayReports.createdAt)),
  ]);

  return buildDailySnapshot(openingEntries, closingEntries, reports, normalizedDate);
}

export async function getSalesTrend(days = 28) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const reports = await db.select().from(endOfDayReports).orderBy(endOfDayReports.businessDate, endOfDayReports.createdAt);
  const perDay = new Map<string, { businessDate: string; totalSales: number }>();

  for (const report of reports) {
    const totalSales = toNumber(report.cashTotal) + toNumber(report.cardTotal) + toNumber(report.zelleTotal) + toNumber(report.venmoTotal);
    const current = perDay.get(report.businessDate) ?? { businessDate: report.businessDate, totalSales: 0 };
    current.totalSales += totalSales;
    perDay.set(report.businessDate, current);
  }

  return Array.from(perDay.values()).slice(-days);
}

export async function getWeekOverWeekSales() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const reports = await db.select().from(endOfDayReports).orderBy(endOfDayReports.businessDate);
  return buildWeekOverWeekSeries(reports);
}

export async function getInventoryAlerts() {
  const items = await listInventoryItems();
  return items
    .filter(item => item.reorderNeeded)
    .map(item => ({
      id: item.id,
      department: item.department,
      category: item.category,
      itemName: item.itemName,
      unitType: item.unitType,
      packSize: item.packSize,
      currentQuantity: item.currentQuantity,
      parLevel: item.parLevel,
      reorderQuantity: item.reorderQuantity,
      reorderAmount: Math.max(item.reorderQuantity || item.parLevel - item.currentQuantity, 0),
      supplier: item.supplier,
      supplierContact: item.supplierContact,
      notes: item.notes ?? "",
    }));
}

export async function getRecentNotes(limit = 12) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [reports, closings] = await Promise.all([
    db.select().from(endOfDayReports).orderBy(desc(endOfDayReports.createdAt)).limit(50),
    db.select().from(closingChecklists).orderBy(desc(closingChecklists.createdAt)).limit(50),
  ]);

  return buildRecentNotesFeed(reports, closings, limit);
}
