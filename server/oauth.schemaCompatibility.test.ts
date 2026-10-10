import { describe, expect, it } from "vitest";
import { users } from "../drizzle/schema";

describe("OAuth schema compatibility", () => {
  it("requires the Phase 1 storeId column before an OAuth identity can be authorized", () => {
    expect("storeId" in users).toBe(true);
  });
});
