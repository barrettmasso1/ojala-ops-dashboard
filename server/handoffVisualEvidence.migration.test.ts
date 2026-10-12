import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
const sceneEntry = journal.entries.find((item: { tag: string }) => item.tag === "0016_handoff_scene_recovery_evidence");
const entry = journal.entries.find((item: { tag: string }) => item.tag === "0017_visual_analysis_evidence");
const migration = readFileSync("drizzle/0017_visual_analysis_evidence.sql", "utf8");

describe("visual analysis evidence migration packaging", () => {
  it("registers a new additive migration after recovered-scene provenance", () => {
    expect(sceneEntry).toBeDefined();
    expect(entry).toBeDefined();
    expect(entry.idx).toBeGreaterThan(sceneEntry.idx);
    expect(readMigrationFiles({ migrationsFolder: "drizzle" }).find(item => item.folderMillis === entry.when)?.sql.join("\n"))
      .toContain("analysisEvidenceJson");
  });

  it("adds only nullable visual audit evidence and does not mutate operational counts", () => {
    expect(migration).toBe("ALTER TABLE `frigateHandoffVisualEvents` ADD `analysisEvidenceJson` text;\n");
    expect(migration).not.toMatch(/DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|UPDATE\s+|frigateCupCounts/i);
  });
});
