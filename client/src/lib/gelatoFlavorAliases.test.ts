import { describe, expect, it } from "vitest";
import { normalizeGelatoFlavorName } from "./gelatoFlavorAliases";

describe("gelato flavor aliases", () => {
  it("normalizes legacy Bananas labels to Banana", () => {
    expect(normalizeGelatoFlavorName("Bananas")).toBe("Banana");
    expect(normalizeGelatoFlavorName(" bananas ")).toBe("Banana");
  });

  it("preserves non-aliased flavor names", () => {
    expect(normalizeGelatoFlavorName("Banana")).toBe("Banana");
    expect(normalizeGelatoFlavorName("Vanilla")).toBe("Vanilla");
  });
});
