import { describe, expect, it } from "vitest";

import { getCompactSnapshotName, getSnapshotValueClassName } from "./ManagerDashboard";

describe("manager dashboard layout helpers", () => {
  it("keeps short names intact but collapses long staff names to the first name for snapshot cards", () => {
    expect(getCompactSnapshotName("Karol")).toBe("Karol");
    expect(getCompactSnapshotName("Karol Mendez")).toBe("Karol");
    expect(getCompactSnapshotName("Marco Antonio Rivera")).toBe("Marco");
    expect(getCompactSnapshotName(" ")).toBe("—");
  });

  it("uses a more compact snapshot value class for longer card values", () => {
    expect(getSnapshotValueClassName("17")).toContain("text-[clamp(2rem,4vw,3.5rem)]");
    expect(getSnapshotValueClassName("Karol Mendez")).toContain("text-[clamp(1.75rem,3vw,2.85rem)]");
  });
});
