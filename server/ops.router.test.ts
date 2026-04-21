import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  createOpeningChecklist: vi.fn(),
  createClosingChecklist: vi.fn(),
  createEndOfDayReport: vi.fn(),
  getDailyOperationsSnapshot: vi.fn(),
  getInventoryAlerts: vi.fn(),
  getRecentNotes: vi.fn(),
  getSalesTrend: vi.fn(),
  getWeekOverWeekSales: vi.fn(),
  listInventoryItems: vi.fn(),
}));

const notificationMocks = vi.hoisted(() => ({
  notifyOwner: vi.fn(),
}));

vi.mock("./db", () => dbMocks);
vi.mock("./_core/notification", () => notificationMocks);

const { appRouter } = await import("./routers");

type Role = "admin" | "user";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(role: Role): TrpcContext {
  const user: AuthenticatedUser = {
    id: role === "admin" ? 99 : 1,
    openId: `${role}-user`,
    email: `${role}@example.com`,
    name: role === "admin" ? "Manager" : "Employee",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("operations router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationMocks.notifyOwner.mockResolvedValue(true);
  });

  it("submits an opening checklist and notifies the owner", async () => {
    dbMocks.createOpeningChecklist.mockResolvedValue({
      businessDate: "2026-04-21",
      staffName: "Ava",
      cashMatchesSystem: "Yes",
      storeReadyStatus: "Yes",
    });

    const caller = appRouter.createCaller(createContext("user"));
    const result = await caller.forms.submitOpening({
      businessDate: "2026-04-21",
      staffName: "Ava",
      equipmentStatus: "Machines running",
      cleanlinessStatus: "Counters clean",
      setupStatus: "Cups stocked",
      startingCash: 120,
      cashMatchesSystem: "Yes",
      storeReadyStatus: "Yes",
      notes: "All clear",
    });

    expect(result).toEqual({ success: true });
    expect(dbMocks.createOpeningChecklist).toHaveBeenCalledWith(
      expect.objectContaining({
        businessDate: "2026-04-21",
        staffName: "Ava",
        startingCash: "120.00",
        submittedByUserId: 1,
      })
    );
    expect(notificationMocks.notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Opening Checklist submitted for 2026-04-21",
      })
    );
  });

  it("submits an end-of-day report with exact payment fields and notifies the owner", async () => {
    dbMocks.createEndOfDayReport.mockResolvedValue({
      businessDate: "2026-04-21",
      shift: "PM",
      staffName: "Marco",
    });

    const caller = appRouter.createCaller(createContext("user"));
    const result = await caller.forms.submitEndOfDay({
      businessDate: "2026-04-21",
      shift: "PM",
      staffName: "Marco",
      cups4oz: 12,
      cups8oz: 18,
      cupsPint: 6,
      cupsLiter: 2,
      cashTotal: 250,
      cardTotal: 410,
      zelleTotal: 80,
      venmoTotal: 60,
      wasteNotes: "Two lids cracked",
      lowItemNotes: "Need spoons",
      generalNotes: "Steady evening traffic",
    });

    expect(result).toEqual({ success: true });
    expect(dbMocks.createEndOfDayReport).toHaveBeenCalledWith(
      expect.objectContaining({
        cashTotal: "250.00",
        cardTotal: "410.00",
        zelleTotal: "80.00",
        venmoTotal: "60.00",
        cups4oz: 12,
        cups8oz: 18,
        cupsPint: 6,
        cupsLiter: 2,
      })
    );
    expect(notificationMocks.notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "End-of-Day Report submitted for 2026-04-21",
        content: expect.stringContaining("Total sales: $800.00"),
      })
    );
  });

  it("allows only admin users to query the dashboard daily snapshot", async () => {
    dbMocks.getDailyOperationsSnapshot.mockResolvedValue({
      businessDate: "2026-04-21",
      reportCount: 1,
      openingSubmissionCount: 1,
      closingSubmissionCount: 1,
      sales: {
        total: 800,
        cash: 250,
        card: 410,
        zelle: 80,
        venmo: 60,
      },
      cups: { "4oz": 12, "8oz": 18, Pint: 6, Liter: 2 },
      checklistCompletion: { opening: 1, closing: 1 },
      latestReportStaff: "Marco",
    });

    const adminCaller = appRouter.createCaller(createContext("admin"));
    await expect(adminCaller.dashboard.daily({ businessDate: "2026-04-21" })).resolves.toEqual(
      expect.objectContaining({
        businessDate: "2026-04-21",
        reportCount: 1,
      })
    );

    const employeeCaller = appRouter.createCaller(createContext("user"));
    await expect(employeeCaller.dashboard.daily({ businessDate: "2026-04-21" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
