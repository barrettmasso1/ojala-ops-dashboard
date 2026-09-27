import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
const entry = journal.entries.find((item: { tag: string }) => item.tag === "0016_handoff_scene_recovery_evidence");
const migration = readFileSync("drizzle/0016_handoff_scene_recovery_evidence.sql", "utf8");
const parts = migration.split("--> statement-breakpoint").map(part => part.trim()).filter(Boolean);

describe("handoff scene recovery migration packaging", () => {
  it("adds provenance only after the intact visual evidence migration", () => {
    const visualEntry = journal.entries.find((item: { tag: string }) => item.tag === "0015_frigate_handoff_visual_filter");
    expect(visualEntry).toBeDefined();
    expect(entry).toBeDefined();
    expect(entry.idx).toBeGreaterThan(visualEntry.idx);
    expect(readMigrationFiles({ migrationsFolder: "drizzle" }).find(item => item.folderMillis === entry.when)?.sql.join("\n"))
      .toContain("evidenceOrigin");
    expect(readFileSync("drizzle/0015_frigate_handoff_visual_filter.sql", "utf8"))
      .toContain("CREATE TABLE `frigateHandoffVisualEvents`");
  });

  it("adds source provenance and AI suggestion without destructive or operational count statements", () => {
    expect(migration).toContain("`evidenceOrigin` enum('verified_snapshot','recording_extracted_frame')");
    expect(migration).toContain("`aiSuggestedStatus` enum('pending_review','approved_by_ai','discarded')");
    expect(migration).toContain("idx_frigateHandoffVisualEvents_origin");
    expect(migration).not.toContain("frigateCupCounts");
    expect(migration).not.toMatch(/DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|UPDATE\s+/i);
  });

  it("keeps one SQL statement in each Drizzle execution part", () => {
    for (const part of parts) {
      expect(part.split(";").filter(statement => statement.trim())).toHaveLength(1);
    }
  });
});
