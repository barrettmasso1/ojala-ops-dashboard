import { bigint, decimal, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const staffAttendanceNameEnum = mysqlEnum("staffAttendanceName", ["Karol", "Anhec", "Jesse", "Esme"]);

export const stores = mysqlTable("stores", {
  id: int("id").autoincrement().primaryKey(),
  nombre: varchar("nombre", { length: 160 }).notNull(),
  timezone: varchar("timezone", { length: 64 }).notNull(),
  isActive: int("isActive").notNull().default(1),
  horarioApertura: varchar("horario_apertura", { length: 8 }),
  horarioCierre: varchar("horario_cierre", { length: 8 }),
  duenoEmail: varchar("dueno_email", { length: 320 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * Server-resolved credentials for non-OAuth staff and machine integrations.
 * Human staff passwords use scrypt verifiers; Frigate machine keys use a
 * SHA-256 lookup hash. Plain credentials are never persisted.
 */
export const storeCredentials = mysqlTable("storeCredentials", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().references(() => stores.id, { onDelete: "restrict", onUpdate: "cascade" }),
  credentialType: mysqlEnum("storeCredentialType", ["staff_portal", "frigate"]).notNull(),
  verifierFormat: mysqlEnum("storeCredentialVerifierFormat", ["scrypt_v1", "sha256_v1"]).notNull(),
  credentialVerifier: varchar("credentialVerifier", { length: 512 }).notNull(),
  label: varchar("label", { length: 160 }).notNull().default(""),
  revokedAt: timestamp("revokedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  storeIndex: index("idx_storeCredentials_storeId").on(table.storeId),
  credentialLookup: uniqueIndex("storeCredentials_type_verifier_unique").on(table.credentialType, table.credentialVerifier),
}));

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().default(1).references(() => stores.id, { onDelete: "restrict", onUpdate: "cascade" }),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
}, table => ({
  storeIndex: index("idx_users_storeId").on(table.storeId),
}));

export const checklistQuestions = mysqlTable("checklistQuestions", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().default(1).references(() => stores.id, { onDelete: "restrict", onUpdate: "cascade" }),
  checklistType: mysqlEnum("checklistType", ["opening", "closing"]).notNull(),
  sectionTitle: varchar("sectionTitle", { length: 80 }).notNull(),
  prompt: text("prompt").notNull(),
  detailPrompt: text("detailPrompt"),
  detailTrigger: mysqlEnum("detailTrigger", ["Yes", "No", "Never"]).notNull().default("Never"),
  displayOrder: int("displayOrder").notNull().default(0),
  isActive: int("isActive").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  storeIndex: index("idx_checklistQuestions_storeId").on(table.storeId),
}));

export const openingChecklists = mysqlTable("openingChecklists", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().default(1).references(() => stores.id, { onDelete: "restrict", onUpdate: "cascade" }),
  businessDate: varchar("businessDate", { length: 10 }).notNull(),
  staffName: varchar("staffName", { length: 160 }).notNull(),
  equipmentStatus: text("equipmentStatus").notNull(),
  cleanlinessStatus: text("cleanlinessStatus").notNull(),
  setupStatus: text("setupStatus").notNull(),
  startingCash: decimal("startingCash", { precision: 10, scale: 2 }).notNull(),
  cashMatchesSystem: varchar("cashMatchesSystem", { length: 3 }).notNull(),
  storeReadyStatus: varchar("storeReadyStatus", { length: 3 }).notNull(),
  responseJson: text("responseJson"),
  notes: text("notes"),
  submittedByUserId: int("submittedByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  storeIndex: index("idx_openingChecklists_storeId").on(table.storeId),
}));

export const closingChecklists = mysqlTable("closingChecklists", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().default(1).references(() => stores.id, { onDelete: "restrict", onUpdate: "cascade" }),
  businessDate: varchar("businessDate", { length: 10 }).notNull(),
  staffName: varchar("staffName", { length: 160 }).notNull(),
  cashCounted: decimal("cashCounted", { precision: 10, scale: 2 }).notNull(),
  cashMatchesSystem: varchar("cashMatchesSystem", { length: 3 }).notNull(),
  cleaningStatus: text("cleaningStatus").notNull(),
  productStorageStatus: text("productStorageStatus").notNull(),
  storeClosedStatus: varchar("storeClosedStatus", { length: 3 }).notNull(),
  responseJson: text("responseJson"),
  notes: text("notes"),
  submittedByUserId: int("submittedByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  storeIndex: index("idx_closingChecklists_storeId").on(table.storeId),
}));

export const endOfDayReports = mysqlTable("endOfDayReports", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().default(1).references(() => stores.id, { onDelete: "restrict", onUpdate: "cascade" }),
  businessDate: varchar("businessDate", { length: 10 }).notNull(),
  staffName: varchar("staffName", { length: 160 }).notNull(),
  cups4oz: int("cups4oz").notNull().default(0),
  cups4ozHere: int("cups4ozHere").notNull().default(0),
  cups4ozToGo: int("cups4ozToGo").notNull().default(0),
  cups8oz: int("cups8oz").notNull().default(0),
  cups8ozHere: int("cups8ozHere").notNull().default(0),
  cups8ozToGo: int("cups8ozToGo").notNull().default(0),
  cupsPint: int("cupsPint").notNull().default(0),
  cupsPintHere: int("cupsPintHere").notNull().default(0),
  cupsPintToGo: int("cupsPintToGo").notNull().default(0),
  cupsLiter: int("cupsLiter").notNull().default(0),
  cupsLiterHere: int("cupsLiterHere").notNull().default(0),
  cupsLiterToGo: int("cupsLiterToGo").notNull().default(0),
  cashTotal: decimal("cashTotal", { precision: 10, scale: 2 }).notNull().default("0.00"),
  cardTotal: decimal("cardTotal", { precision: 10, scale: 2 }).notNull().default("0.00"),
  zelleTotal: decimal("zelleTotal", { precision: 10, scale: 2 }).notNull().default("0.00"),
  venmoTotal: decimal("venmoTotal", { precision: 10, scale: 2 }).notNull().default("0.00"),
  sampleOunces: decimal("sampleOunces", { precision: 10, scale: 2 }).notNull().default("0.00"),
  wasteOunces: decimal("wasteOunces", { precision: 10, scale: 2 }).notNull().default("0.00"),
  wasteNotes: text("wasteNotes"),
  lowItemNotes: text("lowItemNotes"),
  generalNotes: text("generalNotes"),
  submittedByUserId: int("submittedByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  storeIndex: index("idx_endOfDayReports_storeId").on(table.storeId),
}));

export const inventoryItems = mysqlTable("inventoryItems", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().default(1).references(() => stores.id, { onDelete: "restrict", onUpdate: "cascade" }),
  department: varchar("department", { length: 48 }).notNull().default("Ingredients"),
  category: varchar("category", { length: 48 }).notNull(),
  itemName: varchar("itemName", { length: 160 }).notNull(),
  unitType: varchar("unitType", { length: 64 }).notNull().default("units"),
  packSize: varchar("packSize", { length: 128 }).notNull().default(""),
  costPerUnit: decimal("costPerUnit", { precision: 10, scale: 2 }).notNull().default("0.00"),
  currentQuantity: decimal("currentQuantity", { precision: 10, scale: 2 }).notNull().default("0.00"),
  parLevel: decimal("parLevel", { precision: 10, scale: 2 }).notNull().default("0.00"),
  reorderQuantity: decimal("reorderQuantity", { precision: 10, scale: 2 }).notNull().default("0.00"),
  supplier: varchar("supplier", { length: 160 }).notNull().default(""),
  supplierContact: varchar("supplierContact", { length: 160 }).notNull().default(""),
  lastCountDate: varchar("lastCountDate", { length: 10 }).notNull().default(""),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  storeIndex: index("idx_inventoryItems_storeId").on(table.storeId),
}));

export const readyMadeGelatoWeights = mysqlTable("readyMadeGelatoWeights", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().default(1).references(() => stores.id, { onDelete: "restrict", onUpdate: "cascade" }),
  businessDate: varchar("businessDate", { length: 10 }).notNull(),
  flavor: varchar("flavor", { length: 160 }).notNull(),
  shiftType: mysqlEnum("readyMadeGelatoShiftType", ["opening", "closing"]).notNull().default("opening"),
  smallPanCount: int("smallPanCount").notNull().default(0),
  smallGrossWeightKg: decimal("smallGrossWeightKg", { precision: 10, scale: 2 }).notNull().default("0.00"),
  largePanCount: int("largePanCount").notNull().default(0),
  largeGrossWeightKg: decimal("largeGrossWeightKg", { precision: 10, scale: 2 }).notNull().default("0.00"),
  weightKg: decimal("weightKg", { precision: 10, scale: 2 }).notNull().default("0.00"),
  submittedByUserId: int("submittedByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  storeIndex: index("idx_readyMadeGelatoWeights_storeId").on(table.storeId),
}));

export const submissionHistoryEntries = mysqlTable("submissionHistoryEntries", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().default(1).references(() => stores.id, { onDelete: "restrict", onUpdate: "cascade" }),
  businessDate: varchar("businessDate", { length: 10 }).notNull(),
  submissionType: mysqlEnum("submissionHistoryType", ["opening", "closing", "inventory"]).notNull(),
  staffName: varchar("staffName", { length: 160 }).notNull(),
  payloadJson: text("payloadJson").notNull(),
  submittedByUserId: int("submittedByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  storeIndex: index("idx_submissionHistoryEntries_storeId").on(table.storeId),
}));

export const staffAttendance = mysqlTable("staffAttendance", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().default(1).references(() => stores.id, { onDelete: "restrict", onUpdate: "cascade" }),
  businessDate: varchar("businessDate", { length: 10 }).notNull(),
  staffName: staffAttendanceNameEnum.notNull(),
  clockInAt: bigint("clockInAt", { mode: "number" }).notNull(),
  clockOutAt: bigint("clockOutAt", { mode: "number" }),
  submittedByUserId: int("submittedByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  storeIndex: index("idx_staffAttendance_storeId").on(table.storeId),
}));

export const frigateCupCounts = mysqlTable("frigateCupCounts", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().default(1).references(() => stores.id, { onDelete: "restrict", onUpdate: "cascade" }),
  businessDate: varchar("businessDate", { length: 10 }).notNull(),
  cameraName: varchar("cameraName", { length: 64 }).notNull().default("handoff"),
  cupsDetected: int("cupsDetected").notNull().default(0),
  peopleEntries: int("peopleEntries").notNull().default(0),
  sourceDetail: text("sourceDetail"),
  sourceEventId: varchar("sourceEventId", { length: 128 }).notNull(),
  sourceEventAt: timestamp("sourceEventAt").notNull(),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  storeIndex: index("idx_frigateCupCounts_storeId").on(table.storeId),
  storeDateCameraUnique: uniqueIndex("frigateCupCounts_store_date_camera_unique").on(table.storeId, table.businessDate, table.cameraName),
}));

/**
 * Verified stills submitted by the handoff sender. These records are visual
 * evidence only: no state here may change cups sold, deliveries, or revenue.
 */
export const frigateHandoffVisualEvents = mysqlTable("frigateHandoffVisualEvents", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().references(() => stores.id, { onDelete: "restrict", onUpdate: "cascade" }),
  businessDate: varchar("businessDate", { length: 10 }).notNull(),
  cameraName: varchar("cameraName", { length: 64 }).notNull().default("handoff"),
  cupEventId: varchar("cupEventId", { length: 128 }).notNull(),
  capturedAt: timestamp("capturedAt").notNull(),
  imageKey: varchar("imageKey", { length: 512 }),
  imageMimeType: varchar("imageMimeType", { length: 64 }).notNull(),
  sourceDetail: text("sourceDetail"),
  analysisStatus: mysqlEnum("analysisStatus", ["pending_review", "approved_by_ai", "discarded", "approved_by_manager", "discarded_by_manager"]).notNull().default("pending_review"),
  analysisModel: varchar("analysisModel", { length: 96 }).notNull().default("platform-default-vision"),
  personPresent: int("personPresent").notNull().default(0),
  gelatoCupPresent: int("gelatoCupPresent").notNull().default(0),
  cupInHandoffZone: int("cupInHandoffZone").notNull().default(0),
  visibleCupCount: int("visibleCupCount").notNull().default(0),
  confidence: mysqlEnum("confidence", ["high", "medium", "low"]).notNull().default("low"),
  analysisReason: text("analysisReason"),
  analysisAttempts: int("analysisAttempts").notNull().default(0),
  nextRetryAt: timestamp("nextRetryAt"),
  analysisLeaseUntil: timestamp("analysisLeaseUntil"),
  lastAnalysisError: text("lastAnalysisError"),
  reviewedAt: timestamp("reviewedAt"),
  reviewedByUserId: int("reviewedByUserId"),
  reviewNotes: text("reviewNotes"),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  storeIndex: index("idx_frigateHandoffVisualEvents_storeId").on(table.storeId),
  storeCameraEventUnique: uniqueIndex("frigateHandoffVisualEvents_store_camera_event_unique").on(table.storeId, table.cameraName, table.cupEventId),
  reviewQueueIndex: index("idx_frigateHandoffVisualEvents_review_queue").on(table.storeId, table.analysisStatus, table.nextRetryAt),
  capturedAtIndex: index("idx_frigateHandoffVisualEvents_capturedAt").on(table.storeId, table.capturedAt),
}));

export const recipes = mysqlTable("recipes", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().default(1).references(() => stores.id, { onDelete: "restrict", onUpdate: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  batchYieldOunces: decimal("batchYieldOunces", { precision: 10, scale: 2 }).notNull().default("0.00"),
  notes: text("notes"),
  processSteps: text("processSteps"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  storeIndex: index("idx_recipes_storeId").on(table.storeId),
  storeNameUnique: uniqueIndex("recipes_store_name_unique").on(table.storeId, table.name),
}));

export const recipeIngredients = mysqlTable("recipeIngredients", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull().default(1).references(() => stores.id, { onDelete: "restrict", onUpdate: "cascade" }),
  recipeId: int("recipeId").notNull(),
  inventoryItemId: int("inventoryItemId"),
  ingredientName: varchar("ingredientName", { length: 160 }).notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull().default("0.00"),
  unitType: varchar("unitType", { length: 64 }).notNull().default("units"),
  costPerUnit: decimal("costPerUnit", { precision: 10, scale: 2 }).notNull().default("0.00"),
  totalCost: decimal("totalCost", { precision: 10, scale: 2 }).notNull().default("0.00"),
  sortOrder: int("sortOrder").notNull().default(0),
  processSteps: text("processSteps"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  storeIndex: index("idx_recipeIngredients_storeId").on(table.storeId),
}));

export type Store = typeof stores.$inferSelect;
export type InsertStore = typeof stores.$inferInsert;
export type StoreCredential = typeof storeCredentials.$inferSelect;
export type InsertStoreCredential = typeof storeCredentials.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ChecklistQuestion = typeof checklistQuestions.$inferSelect;
export type InsertChecklistQuestion = typeof checklistQuestions.$inferInsert;
export type OpeningChecklist = typeof openingChecklists.$inferSelect;
export type InsertOpeningChecklist = typeof openingChecklists.$inferInsert;
export type ClosingChecklist = typeof closingChecklists.$inferSelect;
export type InsertClosingChecklist = typeof closingChecklists.$inferInsert;
export type EndOfDayReport = typeof endOfDayReports.$inferSelect;
export type InsertEndOfDayReport = typeof endOfDayReports.$inferInsert;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InsertInventoryItem = typeof inventoryItems.$inferInsert;
export type ReadyMadeGelatoWeight = typeof readyMadeGelatoWeights.$inferSelect;
export type InsertReadyMadeGelatoWeight = typeof readyMadeGelatoWeights.$inferInsert;
export type SubmissionHistoryEntry = typeof submissionHistoryEntries.$inferSelect;
export type InsertSubmissionHistoryEntry = typeof submissionHistoryEntries.$inferInsert;
export type StaffAttendance = typeof staffAttendance.$inferSelect;
export type InsertStaffAttendance = typeof staffAttendance.$inferInsert;
export type Recipe = typeof recipes.$inferSelect;
export type InsertRecipe = typeof recipes.$inferInsert;
export type RecipeIngredient = typeof recipeIngredients.$inferSelect;
export type InsertRecipeIngredient = typeof recipeIngredients.$inferInsert;
export type FrigateCupCount = typeof frigateCupCounts.$inferSelect;
export type InsertFrigateCupCount = typeof frigateCupCounts.$inferInsert;
export type FrigateHandoffVisualEvent = typeof frigateHandoffVisualEvents.$inferSelect;
export type InsertFrigateHandoffVisualEvent = typeof frigateHandoffVisualEvents.$inferInsert;
