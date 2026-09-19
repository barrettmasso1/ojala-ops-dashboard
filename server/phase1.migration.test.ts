import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
const migration = readFileSync("drizzle/0012_multi_tenant_v1.sql", "utf8");
const parts = migration.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);
const tables = ["users", "checklistQuestions", "openingChecklists", "closingChecklists", "endOfDayReports", "inventoryItems", "readyMadeGelatoWeights", "submissionHistoryEntries", "staffAttendance", "frigateCupCounts", "recipes", "recipeIngredients"];

describe("Phase 1 migration packaging", () => {
  it("loads the registered migration with Drizzle", () => {
    const entry = journal.entries.find((e: {tag: string}) => e.tag === "0012_multi_tenant_v1");
    expect(entry).toBeDefined();
    const loaded = readMigrationFiles({ migrationsFolder: "drizzle" });
    expect(loaded.find(m => m.folderMillis === entry.when)?.sql.join("\n")).toContain("ADD `storeId`");
  });
  it("uses one SQL statement per driver execution", () => {
    for (const part of parts) expect(part.split(";").filter(s => s.trim())).toHaveLength(1);
  });
  it("seeds the legacy tenant before references without overwriting its configuration", () => {
    expect(migration.indexOf("INSERT INTO `stores`")).toBeLessThan(migration.indexOf("FOREIGN KEY"));
    expect(migration).toContain("ON DUPLICATE KEY UPDATE `id`=`id`");
    expect(migration).not.toMatch(/DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
  });
  it("records every tenant column, index, and foreign key in the snapshot", () => {
    const snapshot = JSON.parse(readFileSync("drizzle/meta/0012_snapshot.json", "utf8"));
    for (const name of tables) {
      const table = snapshot.tables[name];
      expect(table.columns.storeId.notNull).toBe(true);
      expect(table.indexes[`idx_${name}_storeId`].columns).toEqual(["storeId"]);
      expect(table.foreignKeys[`${name}_storeId_stores_id_fk`].tableTo).toBe("stores");
    }
  });
});
