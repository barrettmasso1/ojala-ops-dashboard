import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
const entry = journal.entries.find((item: { tag: string }) => item.tag === "0014_frigate_handoff_visual_filter");
const migration = readFileSync("drizzle/0014_frigate_handoff_visual_filter.sql", "utf8");
const parts = migration.split("--> statement-breakpoint").map(part => part.trim()).filter(Boolean);

describe("handoff visual migration packaging", () => {
  it("registers a non-destructive migration after tenant credentials", () => {
    expect(entry).toBeDefined();
    expect(readMigrationFiles({ migrationsFolder: "drizzle" }).find(item => item.folderMillis === entry.when)?.sql.join("\n"))
      .toContain("CREATE TABLE `frigateHandoffVisualEvents`");
    expect(readFileSync("drizzle/0012_multi_tenant_v1.sql", "utf8")).toContain("Phase 1 multi-tenant migration");
    expect(readFileSync("drizzle/0013_tenant_credential_and_frigate_event_boundaries.sql", "utf8")).toContain("storeCredentials");
  });

  it("deduplicates scoped visual events and keeps them separate from operational cup counts", () => {
    expect(migration).toContain("UNIQUE(`storeId`,`cameraName`,`cupEventId`)");
    expect(migration).toContain("`analysisStatus` enum");
    expect(migration).toContain("`analysisLeaseUntil` timestamp");
    expect(migration).not.toContain("frigateCupCounts");
    expect(migration).not.toMatch(/DROP\s+TABLE|TRUNCATE|DELETE\s+FROM/i);
  });

  it("contains one statement in every Drizzle execution part", () => {
    for (const part of parts) {
      expect(part.split(";").filter(statement => statement.trim())).toHaveLength(1);
    }
  });
});
