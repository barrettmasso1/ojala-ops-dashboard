import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  allocateEstimatedFlavorSoldOunces,
  buildFlavorPhotoPreviewMap,
  buildSelectedDayStaffActivityRows,
  buildSubmissionFormValueRows,
  createSubmissionFormEditorFields,
  formatCurrency,
  formatPercent,
  getCompactSnapshotName,
  getFlavorPreviewPosition,
  getSnapshotValueClassName,
  nativePhotoEvidenceLabel,
  rebuildSubmissionFormFromEditor,
} from "./ManagerDashboard";

describe("manager dashboard layout helpers", () => {
  it("preserves explicit zero while keeping NaN and absent metrics unavailable", () => {
    expect(formatCurrency(0)).toBe("$0");
    expect(formatCurrency(Number.NaN)).toBe("—");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(Number.NaN)).toBe("—");
  });

  it("does not render source-error counters or a zero average when no trend days exist", () => {
    const source = readFileSync(new URL("./ManagerDashboard.tsx", import.meta.url), "utf8");

    expect(source).toContain('value: formatCurrency(latestTrendDay?.totalSales)');
    expect(source).toContain('const trailingSalesAverage = trendData.length > 0 ? trailingSalesTotal / trendData.length : null;');
    expect(source).toContain('"Report count unavailable"');
    expect(source).toContain('"Staff count unavailable"');
    expect(source).toContain('"Missing comparable measurements"');
    expect(source).toContain('"Missing opening measurements"');
    expect(source).toContain('"Missing closing measurements"');
    expect(source).toContain('"No samples/waste report"');
    expect(source).not.toContain('closingValue(');
    expect(source).not.toContain('formatCurrency(latestTrendDay?.totalSales ?? 0)');
    expect(source).not.toContain('trendData.length > 0 ? trailingSalesTotal / trendData.length : 0');
  });

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

  it("keeps the hover preview card inside the viewport while positioning it as a detached top-layer overlay", () => {
    expect(getFlavorPreviewPosition(32, 220, 390, 900)).toEqual({ left: 16, top: 232, width: 352 });
    expect(getFlavorPreviewPosition(360, 520, 390, 900)).toEqual({ left: 22, top: 88, width: 352 });
    expect(getFlavorPreviewPosition(700, 180, 1440, 1200)).toEqual({ left: 524, top: 192, width: 352 });
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

  it("shows a staff punch in the selected store's local time", () => {
    const staff = [{
      staffName: "Karol", totalHoursToday: 0,
      todayEntries: [{ clockInAt: Date.parse("2026-12-15T16:00:00Z"), clockOutAt: null }],
      activeEntry: null,
    }];
    expect(buildSelectedDayStaffActivityRows(staff, "America/Mazatlan")[0].checkInLabel).toContain("9:00");
    expect(buildSelectedDayStaffActivityRows(staff, "America/Los_Angeles")[0].checkInLabel).toContain("8:00");
  });

  it("presents strict native proof as local signals without claiming a computed visible quantity", () => {
    const native = nativePhotoEvidenceLabel("native_local_cv_only_v1:proof-observation", "approved_by_ai", { status: "verified" });

    expect(native).toMatchObject({
      observationId: "proof-observation",
      badge: "Locally verified",
      verifiedLocally: true,
      hasHumanDecision: false,
      proofSignal: "Validated by strict local proof",
    });
    expect(native?.status).toContain("no requiere aprobación humana");
  });

  it.each(["approved_by_manager", "discarded_by_manager"] as const)("prioritizes the actual human override %s over native pending or proof labels", status => {
    const native = nativePhotoEvidenceLabel("native_local_cv_only_v1:friday-reviewed", status, { status: "verified" });

    expect(native?.badge).toBe(status === "approved_by_manager" ? "Approved by manager" : "Discarded by manager");
    expect(native?.status).toContain("decisión humana conservada");
    expect(native?.badge).not.toContain("Local validation pending");
  });

  it("keeps a marker-linked native photo in native presentation while local proof is pending", () => {
    const native = nativePhotoEvidenceLabel("native_local_cv_only_v1:queued-observation", "pending_review", null);

    expect(native).toMatchObject({ badge: "Local validation pending", proofSignal: "Awaiting local proof", verifiedLocally: false });
    expect(native?.status).toContain("no requiere aprobación humana");
    expect(nativePhotoEvidenceLabel("verified_snapshot", "pending_review", { status: "verified" })).toBeNull();
  });

  it("gates native corrections inside closed details and never renders legacy cloud zero fields in the native signal branch", () => {
    const source = readFileSync(new URL("./ManagerDashboard.tsx", import.meta.url), "utf8");
    const signalsStart = source.indexOf('{nativeLabel ? (\n                            <div className="mt-5 grid');
    const signalsEnd = source.indexOf('\n                          ) : (\n                            <div className="mt-5 grid', signalsStart);
    const nativeSignals = source.slice(signalsStart, signalsEnd);
    const correctionsStart = source.indexOf('{nativeLabel ? (\n                            <details', signalsEnd);
    const correctionsEnd = source.indexOf('\n                          ) : <CupDescriptionsEditor', correctionsStart);
    const nativeCorrections = source.slice(correctionsStart, correctionsEnd);

    expect(nativeSignals).toContain("Total visible quantity: Not computed");
    for (const legacyField of ["event.personPresent", "event.gelatoCupPresent", "event.cupInHandoffZone", "event.visibleCupCount"]) {
      expect(nativeSignals).not.toContain(legacyField);
    }
    expect(source).toContain('const canReview = !nativeLabel');
    expect(nativeCorrections).toContain("<details");
    expect(nativeCorrections).not.toMatch(/<details[^>]*\bopen\b/);
    expect(nativeCorrections).toContain("Optional size-description corrections");
  });

  it("keeps the live overview on today, persists historical dates, and refreshes private data every five seconds", () => {
    const source = readFileSync(new URL("./ManagerDashboard.tsx", import.meta.url), "utf8");
    const liveState = readFileSync(new URL("../lib/dashboardLiveState.ts", import.meta.url), "utf8");

    expect(liveState).toContain("export const LIVE_CAMERA_REFRESH_MS = 5_000");
    expect(source).toContain("refetchOnReconnect: true");
    expect(source).toContain("dashboardDateHref(location, nextDate, maxBusinessDate)");
    expect(source).toContain("Volver a Hoy");
    expect(source).toContain("Última consulta exitosa");
    expect(source).not.toContain("shouldAutoFallbackToLatestOperationalDate");
    expect(source.indexOf("<LocalCupLedgerPanel")).toBeLessThan(source.indexOf("Daily snapshot for"));
  });
});
