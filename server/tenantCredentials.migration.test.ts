import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
const migration = readFileSync("drizzle/0013_tenant_credential_boundaries.sql", "utf8");
const parts = migration.split("--> statement-breakpoint").map(part => part.trim()).filter(Boolean);

describe("tenant credential migration packaging", () => {
  it("registers a separate migration after Phase 1 without changing 0012", () => {
    const entry = journal.entries.find((item: { tag: string }) => item.tag === "0013_tenant_credential_boundaries");
    expect(entry).toBeDefined();
    expect(readMigrationFiles({ migrationsFolder: "drizzle" }).find(item => item.folderMillis === entry.when)?.sql.join("\n"))
      .toContain("CREATE TABLE `storeCredentials`");
    expect(readFileSync("drizzle/0012_multi_tenant_v1.sql", "utf8")).toContain("Phase 1 multi-tenant migration");
  });

  it("is non-destructive and adds an active-store control plus hashed credential storage", () => {
    expect(migration).toContain("ALTER TABLE `stores` ADD `isActive` int DEFAULT 1 NOT NULL");
    expect(migration).toContain("`credentialHash` varchar(64) NOT NULL");
    expect(migration).toContain("`revokedAt` timestamp");
    expect(migration).toContain("ON DELETE restrict");
    expect(migration).not.toMatch(/DROP\s+TABLE|TRUNCATE|DELETE\s+FROM/i);
    expect(migration).not.toMatch(/password|apiKey|secret/i);
  });

  it("contains one SQL statement per Drizzle execution part", () => {
    for (const part of parts) {
      expect(part.split(";").filter(statement => statement.trim())).toHaveLength(1);
    }
  });
});
