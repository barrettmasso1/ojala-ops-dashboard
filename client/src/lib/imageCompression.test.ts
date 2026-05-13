import { describe, expect, it } from "vitest";

import { calculateCompressedDimensions, estimateDataUrlByteSize } from "./imageCompression";

describe("image compression helpers", () => {
  it("keeps images under the configured max dimension while preserving aspect ratio", () => {
    expect(calculateCompressedDimensions(3000, 2000, 1600)).toEqual({ width: 1600, height: 1067 });
    expect(calculateCompressedDimensions(1800, 3200, 1600)).toEqual({ width: 900, height: 1600 });
  });

  it("leaves smaller images unchanged", () => {
    expect(calculateCompressedDimensions(1200, 900, 1600)).toEqual({ width: 1200, height: 900 });
  });

  it("estimates the decoded byte size of a data URL payload", () => {
    expect(estimateDataUrlByteSize("data:image/jpeg;base64,Zm9v")).toBe(3);
    expect(estimateDataUrlByteSize("not-a-data-url")).toBe(0);
  });
});
