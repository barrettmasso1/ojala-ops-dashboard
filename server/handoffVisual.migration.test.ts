import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
const onboardingEntry = journal.entries.find((item: { tag: string }) => item.tag === "0014_glossy_silvermane");
const entry = journal.entries.find((item: { tag: string }) => item.tag === "0015_frigate_handoff_visual_filter");
const migration = readFileSync("drizzle/0015_frigate_handoff_visual_filter.sql", "utf8");
const parts = migration.split("--> statement-breakpoint").map(part => part.trim()).filter(Boolean);

describe("handoff visual migration packaging", () => {
  it("keeps the integrated onboarding 0014 intact and registers visual data as 0015", () => {
    expect(onboardingEntry).toBeDefined();
    expect(entry).toBeDefined();
    expect(journal.entries.filter((item: { tag: string }) => item.tag.startsWith("0014_")).map((item: { tag: string }) => item.tag))
      .toEqual(["0014_glossy_silvermane"]);
    expect(readMigrationFiles({ migrationsFolder: "drizzle" }).find(item => item.folderMillis === entry.when)?.sql.join("\n"))
      .toContain("CREATE TABLE `frigateHandoffVisualEvents`");
    expect(readFileSync("drizzle/0012_multi_tenant_v1.sql", "utf8")).toContain("Phase 1 multi-tenant migration");
    expect(readFileSync("drizzle/0013_tenant_credential_and_frigate_event_boundaries.sql", "utf8")).toContain("storeCredentials");
  });

  it("adds an explicit store-camera zone and immutable capture metadata without operational count writes", () => {
    expect(migration).toContain("CREATE TABLE `frigateCameraZones`");
    expect(migration).toContain("UNIQUE(`storeId`,`cameraName`,`zoneName`)");
    expect(migration).toContain("`captureMetadataJson` text NOT NULL");
    expect(migration).toContain("`imageSha256` varchar(64) NOT NULL");
    expect(migration).toContain("`analysisLeaseToken` varchar(64)");
    expect(migration).toContain("UNIQUE(`storeId`,`cameraName`,`cupEventId`)");
    expect(migration).not.toContain("frigateCupCounts");
    expect(migration).not.toMatch(/DROP\s+TABLE|TRUNCATE|DELETE\s+FROM/i);
  });

  it("contains one statement in every Drizzle execution part", () => {
    for (const part of parts) {
      expect(part.split(";").filter(statement => statement.trim())).toHaveLength(1);
    }
  });
});
