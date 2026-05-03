import { describe, expect, it } from "vitest";
import { calculateCompressedDimensions } from "./imageCompression";

describe("image compression helpers", () => {
  it("keeps images under the configured max dimension while preserving aspect ratio", () => {
    expect(calculateCompressedDimensions(3000, 2000, 1600)).toEqual({ width: 1600, height: 1067 });
    expect(calculateCompressedDimensions(1800, 3200, 1600)).toEqual({ width: 900, height: 1600 });
  });

  it("leaves smaller images unchanged", () => {
    expect(calculateCompressedDimensions(1200, 900, 1600)).toEqual({ width: 1200, height: 900 });
  });
});
