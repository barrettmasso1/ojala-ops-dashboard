import { describe, expect, it } from "vitest";
import { users } from "../drizzle/schema";

describe("OAuth schema compatibility", () => {
  it("does not require the unapplied Phase 1 storeId column when creating a user session", () => {
    expect("storeId" in users).toBe(false);
  });
});
