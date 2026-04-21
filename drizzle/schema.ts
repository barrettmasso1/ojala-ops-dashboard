import { decimal, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const openingChecklists = mysqlTable("openingChecklists", {
  id: int("id").autoincrement().primaryKey(),
  businessDate: varchar("businessDate", { length: 10 }).notNull(),
  staffName: varchar("staffName", { length: 160 }).notNull(),
  equipmentStatus: text("equipmentStatus").notNull(),
  cleanlinessStatus: text("cleanlinessStatus").notNull(),
  setupStatus: text("setupStatus").notNull(),
  startingCash: decimal("startingCash", { precision: 10, scale: 2 }).notNull(),
  cashMatchesSystem: varchar("cashMatchesSystem", { length: 3 }).notNull(),
  storeReadyStatus: varchar("storeReadyStatus", { length: 3 }).notNull(),
  notes: text("notes"),
  submittedByUserId: int("submittedByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const closingChecklists = mysqlTable("closingChecklists", {
  id: int("id").autoincrement().primaryKey(),
  businessDate: varchar("businessDate", { length: 10 }).notNull(),
  staffName: varchar("staffName", { length: 160 }).notNull(),
  cashCounted: decimal("cashCounted", { precision: 10, scale: 2 }).notNull(),
  cashMatchesSystem: varchar("cashMatchesSystem", { length: 3 }).notNull(),
  cleaningStatus: text("cleaningStatus").notNull(),
  productStorageStatus: text("productStorageStatus").notNull(),
  storeClosedStatus: varchar("storeClosedStatus", { length: 3 }).notNull(),
  notes: text("notes"),
  submittedByUserId: int("submittedByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const endOfDayReports = mysqlTable("endOfDayReports", {
  id: int("id").autoincrement().primaryKey(),
  businessDate: varchar("businessDate", { length: 10 }).notNull(),
  shift: varchar("shift", { length: 16 }).notNull(),
  staffName: varchar("staffName", { length: 160 }).notNull(),
  cups4oz: int("cups4oz").notNull().default(0),
  cups8oz: int("cups8oz").notNull().default(0),
  cupsPint: int("cupsPint").notNull().default(0),
  cupsLiter: int("cupsLiter").notNull().default(0),
  cashTotal: decimal("cashTotal", { precision: 10, scale: 2 }).notNull().default("0.00"),
  cardTotal: decimal("cardTotal", { precision: 10, scale: 2 }).notNull().default("0.00"),
  zelleTotal: decimal("zelleTotal", { precision: 10, scale: 2 }).notNull().default("0.00"),
  venmoTotal: decimal("venmoTotal", { precision: 10, scale: 2 }).notNull().default("0.00"),
  wasteNotes: text("wasteNotes"),
  lowItemNotes: text("lowItemNotes"),
  generalNotes: text("generalNotes"),
  submittedByUserId: int("submittedByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const inventoryItems = mysqlTable("inventoryItems", {
  id: int("id").autoincrement().primaryKey(),
  category: varchar("category", { length: 32 }).notNull(),
  itemName: varchar("itemName", { length: 160 }).notNull(),
  unitLabel: varchar("unitLabel", { length: 64 }).notNull(),
  currentQuantity: decimal("currentQuantity", { precision: 10, scale: 2 }).notNull().default("0.00"),
  parLevel: decimal("parLevel", { precision: 10, scale: 2 }).notNull().default("0.00"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type OpeningChecklist = typeof openingChecklists.$inferSelect;
export type InsertOpeningChecklist = typeof openingChecklists.$inferInsert;
export type ClosingChecklist = typeof closingChecklists.$inferSelect;
export type InsertClosingChecklist = typeof closingChecklists.$inferInsert;
export type EndOfDayReport = typeof endOfDayReports.$inferSelect;
export type InsertEndOfDayReport = typeof endOfDayReports.$inferInsert;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InsertInventoryItem = typeof inventoryItems.$inferInsert;
