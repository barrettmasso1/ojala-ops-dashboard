import { describe, expect, it } from "vitest";

import { buildFlavorPhotoPreviewMap, getCompactSnapshotName, getSnapshotValueClassName } from "./ManagerDashboard";

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

  it("maps analyzed photo evidence to opening and closing flavor previews for reconciliation hover cards", () => {
    const previewMap = buildFlavorPhotoPreviewMap([
      {
        id: 1,
        businessDate: "2026-05-10",
        submissionType: "opening",
        staffName: "Karol",
        createdAt: "2026-05-10T16:00:00.000Z",
        payload: {
          analyzedPhotos: [
            {
              fileName: "opening-vanilla.jpg",
              imageUrl: "/manus-storage/opening-vanilla.jpg",
              flavor: "Vanilla",
              smallPanCount: 1,
              largePanCount: 1,
              combinedGrossWeightKg: 5.432,
              confidence: "high",
            },
          ],
        },
      },
      {
        id: 2,
        businessDate: "2026-05-10",
        submissionType: "closing",
        staffName: "Karol",
        createdAt: "2026-05-11T05:00:00.000Z",
        payload: {
          analyzedPhotos: [
            {
              fileName: "closing-bananas.jpg",
              imageUrl: "/manus-storage/closing-bananas.jpg",
              flavor: "Bananas",
              smallPanCount: 0,
              largePanCount: 1,
              combinedGrossWeightKg: 2.345,
              confidence: "medium",
            },
          ],
        },
      },
    ]);

    expect(previewMap.get("opening:vanilla")?.fileName).toBe("opening-vanilla.jpg");
    expect(previewMap.get("closing:banana")?.fileName).toBe("closing-bananas.jpg");
  });
});
