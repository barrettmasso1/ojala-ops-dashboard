import { describe, expect, it } from "vitest";

import {
  allocateEstimatedFlavorSoldOunces,
  buildFlavorPhotoPreviewMap,
  buildSelectedDayStaffActivityRows,
  buildSubmissionFormValueRows,
  createSubmissionFormEditorFields,
  getCompactSnapshotName,
  getSnapshotValueClassName,
  rebuildSubmissionFormFromEditor,
} from "./ManagerDashboard";

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

  it("allocates estimated flavor sold ounces in 2-ounce increments so impossible values like 3 oz never appear", () => {
    const allocation = allocateEstimatedFlavorSoldOunces([2, 10, 14], 20, 2);

    expect(allocation).toEqual([2, 8, 10]);
    expect(allocation.every(value => value % 2 === 0)).toBe(true);
    expect(allocation.reduce((sum, value) => sum + value, 0)).toBe(20);
  });

  it("groups closing form values so 4 oz and 8 oz stay paired while pint and liter render without invalid here fields", () => {
    const rows = buildSubmissionFormValueRows({
      businessDate: "2026-05-09",
      staffName: "Karol Mendez",
      cups4ozHere: 11,
      cups4ozToGo: 0,
      cups8ozHere: 8,
      cups8ozToGo: 13,
      cupsPintHere: 0,
      cupsPintToGo: 3,
      cupsLiterHere: 0,
      cupsLiterToGo: 1,
      cashTotal: 1820,
    });

    expect(rows.some(row => row.some(field => field.key === "cupsPintHere" || field.key === "cupsLiterHere"))).toBe(false);
    expect(rows).toContainEqual([
      { key: "cups4ozHere", label: "Cups4oz Here", value: "11" },
      { key: "cups4ozToGo", label: "Cups4oz To Go", value: "0" },
    ]);
    expect(rows).toContainEqual([
      { key: "cups8ozHere", label: "Cups8oz Here", value: "8" },
      { key: "cups8ozToGo", label: "Cups8oz To Go", value: "13" },
    ]);
    expect(rows).toContainEqual([
      { key: "cupsPint", label: "Cups Pint", value: "3" },
      { key: "cupsLiter", label: "Cups Liter", value: "1" },
    ]);
  });

  it("builds editable form fields from opening stock counts so managers can correct saved count entries", () => {
    const fields = createSubmissionFormEditorFields({
      businessDate: "2026-05-09",
      staffName: "Karol Mendez",
      startingCash: 420,
      cashCountedAndCorrect: "Yes",
      stockCounts: {
        cups4oz: 12,
        cups8oz: 22,
        spoons: 150,
      },
    });

    expect(fields.find(field => field.key === "businessDate")).toBeUndefined();
    expect(fields.find(field => field.key === "cups4oz")).toMatchObject({ value: "12", kind: "number" });
    expect(fields.find(field => field.key === "cashCountedAndCorrect")).toMatchObject({ value: "Yes", kind: "yesno" });
  });

  it("rebuilds corrected form values back into the stored opening payload shape", () => {
    const originalForm = {
      businessDate: "2026-05-09",
      staffName: "Karol Mendez",
      stockCounts: {
        cups4oz: 12,
        cups8oz: 22,
        spoons: 150,
      },
    };

    const updatedForm = rebuildSubmissionFormFromEditor(originalForm, [
      { key: "staffName", label: "Staff Name", value: "Karol", kind: "text" },
      { key: "cups4oz", label: "Cups4oz", value: "18", kind: "number" },
      { key: "spoons", label: "Spoons", value: "175", kind: "number" },
    ]);

    expect(updatedForm).toMatchObject({
      staffName: "Karol",
      stockCounts: {
        cups4oz: 18,
        cups8oz: 22,
        spoons: 175,
      },
    });
  });

  it("builds selected-day staffing rows only for team members who actually worked the chosen day", () => {
    const rows = buildSelectedDayStaffActivityRows([
      {
        staffName: "Karol",
        totalHoursToday: 7.5,
        todayEntries: [{ clockInAt: Date.parse("2026-05-10T16:00:00.000Z"), clockOutAt: Date.parse("2026-05-10T23:30:00.000Z") }],
        activeEntry: null,
      },
      {
        staffName: "Anhec",
        totalHoursToday: 0,
        todayEntries: [],
        activeEntry: null,
      },
      {
        staffName: "Esme",
        totalHoursToday: 2,
        todayEntries: [{ clockInAt: Date.parse("2026-05-10T19:00:00.000Z"), clockOutAt: null }],
        activeEntry: { clockInAt: Date.parse("2026-05-10T19:00:00.000Z"), clockOutAt: null },
      },
    ]);

    expect(rows.map(row => row.staffName)).toEqual(["Esme", "Karol"]);
    expect(rows[0]).toMatchObject({
      checkOutLabel: "Open shift",
      totalHoursLabel: "2.00 hrs",
      shiftCountLabel: "1 shift",
    });
    expect(rows[1].checkInLabel).not.toBe("—");
    expect(rows[1].checkOutLabel).not.toBe("—");
  });
});
