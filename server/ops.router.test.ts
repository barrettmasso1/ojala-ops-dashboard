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
  listChecklistQuestions: vi.fn(),
  listInventoryItems: vi.fn(),
  listReadyMadeGelatoWeights: vi.fn(),
  removeChecklistQuestion: vi.fn(),
  saveChecklistQuestion: vi.fn(),
  saveInventoryItem: vi.fn(),
  saveReadyMadeGelatoWeights: vi.fn(),
  updateInventoryCount: vi.fn(),
  upsertUser: vi.fn(),
}));

const notificationMocks = vi.hoisted(() => ({
  notifyOwner: vi.fn(),
}));

const sdkMocks = vi.hoisted(() => ({
  sdk: {
    createSessionToken: vi.fn(),
  },
}));

vi.mock("./db", () => dbMocks);
vi.mock("./_core/notification", () => notificationMocks);
vi.mock("./_core/sdk", () => sdkMocks);

const { appRouter } = await import("./routers");

type Role = "admin" | "user";
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(role: Role | null): TrpcContext {
  const user: AuthenticatedUser | null = role
    ? {
        id: role === "admin" ? 99 : 1,
        openId: `${role}-user`,
        email: `${role}@example.com`,
        name: role === "admin" ? "Manager" : "Employee",
        loginMethod: "manus",
        role,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      }
    : null;

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("operations router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationMocks.notifyOwner.mockResolvedValue(true);
    sdkMocks.sdk.createSessionToken.mockResolvedValue("staff-session-token");
  });

  it("accepts the configured shared staff portal password and sets a staff session cookie", async () => {
    const context = createContext(null);
    const caller = appRouter.createCaller(context);

    const result = await caller.auth.staffPortalLogin({ password: "Ojalagelato727272" });

    expect(result).toEqual({ success: true, role: "user" });
    expect(dbMocks.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({
        openId: "ojala-shared-staff-portal",
        role: "user",
        loginMethod: "shared-password",
      }),
    );
    expect(sdkMocks.sdk.createSessionToken).toHaveBeenCalledWith(
      "ojala-shared-staff-portal",
      expect.objectContaining({ name: "Ojala Staff" }),
    );
    expect((context.res as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie).toHaveBeenCalled();
  });

  it("blocks non-admin sessions from manager dashboard queries", async () => {
    const caller = appRouter.createCaller(createContext("user"));

    await expect(caller.dashboard.daily({ businessDate: "2026-04-21" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(dbMocks.getDailyOperationsSnapshot).not.toHaveBeenCalled();
  });

  it("loads editable opening checklist questions for employees", async () => {
    dbMocks.listChecklistQuestions.mockResolvedValue([
      {
        id: 1,
        checklistType: "opening",
        sectionTitle: "Equipment",
        prompt: "Freezers ON and cold",
        detailPrompt: "If no, what is wrong?",
        detailTrigger: "No",
        displayOrder: 1,
        isActive: 1,
      },
    ]);

    const caller = appRouter.createCaller(createContext("user"));
    const result = await caller.forms.checklistQuestions({ checklistType: "opening" });

    expect(result).toHaveLength(1);
    expect(dbMocks.listChecklistQuestions).toHaveBeenCalledWith("opening");
  });

  it("submits an opening checklist with stock counts and structured yes-no answers", async () => {
    dbMocks.createOpeningChecklist.mockResolvedValue({
      businessDate: "2026-04-21",
      staffName: "Ava",
      cashMatchesSystem: "Yes",
      storeReadyStatus: "No",
    });

    const caller = appRouter.createCaller(createContext("user"));
    const result = await caller.forms.submitOpening({
      businessDate: "2026-04-21",
      staffName: "Ava",
      startingCash: 120,
      cashCountedAndCorrect: "Yes",
      storeReadyToOpen: "No",
      stockCounts: {
        cups4oz: 24,
        cups8oz: 18,
        cupsPint: 12,
        cupsLiter: 6,
        lids4oz: 24,
        lids8oz: 18,
        lidsPint: 12,
        lidsLiter: 6,
        spoons: 140,
      },
      checklistAnswers: [
        {
          questionId: 1,
          sectionTitle: "Equipment",
          prompt: "Freezers ON and cold",
          answer: "Yes",
          detail: "",
        },
        {
          questionId: 2,
          sectionTitle: "Employee Preparation",
          prompt: "Shirt clean and ironed",
          answer: "No",
          detail: "Need replacement shirt",
        },
      ],
      notes: "Opening concern logged",
      origin: "https://ojaladarsh-m6piugsr.manus.space",
    });

    expect(result).toEqual({ success: true });
    expect(dbMocks.createOpeningChecklist).toHaveBeenCalledWith(
      expect.objectContaining({
        businessDate: "2026-04-21",
        staffName: "Ava",
        startingCash: "120.00",
        cashMatchesSystem: "Yes",
        storeReadyStatus: "No",
        setupStatus: expect.stringContaining("Cup counts — 4oz: 24, 8oz: 18, Pint: 12, Liter: 6"),
        responseJson: expect.stringContaining("\"spoons\":140"),
        submittedByUserId: 1,
      })
    );
    expect(notificationMocks.notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Opening form submitted for 2026-04-21",
        content: expect.stringContaining("Failed confirmations: 1"),
      })
    );
    expect(notificationMocks.notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("https://ojaladarsh-m6piugsr.manus.space/dashboard"),
      })
    );
  });

  it("submits a closing checklist using the checklist confirmation for store closed properly", async () => {
    dbMocks.createClosingChecklist.mockResolvedValue({
      businessDate: "2026-04-21",
      staffName: "Marco",
      cashMatchesSystem: "No",
      storeClosedStatus: "Yes",
    });

    const caller = appRouter.createCaller(createContext("user"));
    const result = await caller.forms.submitClosing({
      businessDate: "2026-04-21",
      staffName: "Marco",
      cashCounted: 210,
      cashMatchesSystem: "No",
      checklistAnswers: [
        {
          questionId: 7,
          sectionTitle: "Cleaning",
          prompt: "Trash taken out",
          answer: "No",
          detail: "Waiting on pickup",
        },
        {
          questionId: 8,
          sectionTitle: "Final",
          prompt: "Store closed properly",
          answer: "Yes",
          detail: "",
        },
      ],
      notes: "Closing note",
      origin: "https://ojaladarsh-m6piugsr.manus.space",
    });

    expect(result).toEqual({ success: true });
    expect(dbMocks.createClosingChecklist).toHaveBeenCalledWith(
      expect.objectContaining({
        cashCounted: "210.00",
        cashMatchesSystem: "No",
        storeClosedStatus: "Yes",
        productStorageStatus: expect.stringContaining("Store closed properly: Yes"),
        responseJson: expect.stringContaining("Trash taken out"),
      })
    );
    expect(notificationMocks.notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Closing form submitted for 2026-04-21",
        content: expect.stringContaining("Failed confirmations: 1"),
      })
    );
    expect(notificationMocks.notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("https://ojaladarsh-m6piugsr.manus.space/dashboard"),
      })
    );
  });

  it("lets employees submit inventory updates and notifies the owner with the saved quantity", async () => {
    dbMocks.updateInventoryCount.mockResolvedValue({
      id: 41,
      itemName: "To-Go Bags",
      currentQuantity: 18,
      unitType: "units",
    });

    const caller = appRouter.createCaller(createContext("user"));
    const result = await caller.forms.submitInventoryUpdate({
      id: 41,
      currentQuantity: 18,
      notes: "Packaging restocked and counted by front counter",
    });

    expect(result).toEqual({
      success: true,
      item: {
        id: 41,
        itemName: "To-Go Bags",
        currentQuantity: 18,
        unitType: "units",
      },
    });
    expect(dbMocks.updateInventoryCount).toHaveBeenCalledWith({
      id: 41,
      currentQuantity: "18.00",
      notes: "Packaging restocked and counted by front counter",
    });
    expect(notificationMocks.notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Inventory updated: To-Go Bags",
        content: expect.stringContaining("updated To-Go Bags to 18 units"),
      })
    );
  });

  it("sends one consolidated owner alert for a full inventory submission summary", async () => {
    const caller = appRouter.createCaller(createContext("user"));
    const result = await caller.forms.submitInventorySubmissionSummary({
      businessDate: "2026-04-25",
      staffName: "Ojala Staff",
      gelatoEntryCount: 14,
      itemSummaries: [
        { itemName: "4oz To-Go Cups", currentQuantity: 88, unitType: "units", department: "Utensils & Cleaning" },
        { itemName: "Cane Sugar", currentQuantity: 12.5, unitType: "kg", department: "Ingredients" },
      ],
      origin: "https://ojaladarsh-m6piugsr.manus.space",
    });

    expect(result).toEqual({ success: true });
    expect(notificationMocks.notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Inventory updated for 2026-04-25",
        content: expect.stringContaining("submitted 2 inventory updates for 2026-04-25"),
      })
    );
    expect(notificationMocks.notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Ready-made gelato entries saved: 14."),
      })
    );
    expect(notificationMocks.notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Review: https://ojaladarsh-m6piugsr.manus.space/dashboard"),
      })
    );
  });

  it("lets employees save ready-made gelato opening measurements for the business date", async () => {
    dbMocks.saveReadyMadeGelatoWeights.mockResolvedValue([
      {
        id: 1,
        businessDate: "2026-04-22",
        flavor: "Vanilla",
        shiftType: "opening",
        smallPanCount: 1,
        smallGrossWeightKg: 1.9,
        largePanCount: 1,
        largeGrossWeightKg: 4.3,
        netWeightKg: 5.51,
        totalWeightOunces: 194.5,
        totalVolumeOunces: 272,
      },
      {
        id: 2,
        businessDate: "2026-04-22",
        flavor: "Chocolate",
        shiftType: "opening",
        smallPanCount: 1,
        smallGrossWeightKg: 1.8,
        largePanCount: 0,
        largeGrossWeightKg: 0,
        netWeightKg: 1.51,
        totalWeightOunces: 53.26,
        totalVolumeOunces: 104.79,
      },
    ]);

    const caller = appRouter.createCaller(createContext("user"));
    const result = await caller.forms.submitReadyMadeGelato({
      businessDate: "2026-04-22",
      shiftType: "opening",
      entries: [
        { flavor: "Vanilla", smallPanCount: 1, smallGrossWeightKg: 1.9, largePanCount: 1, largeGrossWeightKg: 4.3 },
        { flavor: "Chocolate", smallPanCount: 1, smallGrossWeightKg: 1.8, largePanCount: 0, largeGrossWeightKg: 0 },
      ],
    });

    expect(result).toEqual({
      success: true,
      records: [
        expect.objectContaining({ flavor: "Vanilla", shiftType: "opening", totalVolumeOunces: 272 }),
        expect.objectContaining({ flavor: "Chocolate", shiftType: "opening", totalVolumeOunces: 104.79 }),
      ],
    });
    expect(dbMocks.saveReadyMadeGelatoWeights).toHaveBeenCalledWith({
      businessDate: "2026-04-22",
      shiftType: "opening",
      submittedByUserId: 1,
      entries: [
        { flavor: "Vanilla", smallPanCount: 1, smallGrossWeightKg: "1.90", largePanCount: 1, largeGrossWeightKg: "4.30" },
        { flavor: "Chocolate", smallPanCount: 1, smallGrossWeightKg: "1.80", largePanCount: 0, largeGrossWeightKg: "0.00" },
      ],
    });
    expect(notificationMocks.notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Ready-made gelato opening saved: 2026-04-22",
        content: expect.stringContaining("saved 2 opening gelato measurements"),
      })
    );
  });

  it("allows only admin users to save checklist questions", async () => {
    dbMocks.saveChecklistQuestion.mockResolvedValue({
      id: 22,
      checklistType: "opening",
      sectionTitle: "Setup",
      prompt: "Menus visible and clean",
      detailPrompt: "If no, what is wrong?",
      detailTrigger: "No",
      displayOrder: 19,
      isActive: 1,
    });

    const adminCaller = appRouter.createCaller(createContext("admin"));
    await expect(
      adminCaller.dashboard.saveChecklistQuestion({
        checklistType: "opening",
        sectionTitle: "Setup",
        prompt: "Menus visible and clean",
        detailPrompt: "If no, what is wrong?",
        detailTrigger: "No",
        displayOrder: 19,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
      })
    );

    const employeeCaller = appRouter.createCaller(createContext("user"));
    await expect(
      employeeCaller.dashboard.saveChecklistQuestion({
        checklistType: "opening",
        sectionTitle: "Setup",
        prompt: "Menus visible and clean",
        detailPrompt: "If no, what is wrong?",
        detailTrigger: "No",
        displayOrder: 19,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("submits an end-of-day report with compact here-and-to-go cup counts and notifies the owner", async () => {
    dbMocks.createEndOfDayReport.mockResolvedValue({
      businessDate: "2026-04-21",
      staffName: "Marco",
    });

    const caller = appRouter.createCaller(createContext("user"));
    const result = await caller.forms.submitEndOfDay({
      businessDate: "2026-04-21",
      staffName: "Marco",
      cups4ozHere: 4,
      cups4ozToGo: 8,
      cups8ozHere: 6,
      cups8ozToGo: 12,
      cupsPintHere: 2,
      cupsPintToGo: 4,
      cupsLiterHere: 1,
      cupsLiterToGo: 1,
      cashTotal: 250,
      cardTotal: 410,
      zelleTotal: 80,
      venmoTotal: 60,
      wasteNotes: "Two lids cracked",
      lowItemNotes: "Need spoons",
      generalNotes: "Steady evening traffic",
      origin: "https://ojaladarsh-m6piugsr.manus.space",
    });

    expect(result).toEqual({ success: true });
    expect(dbMocks.createEndOfDayReport).toHaveBeenCalledWith(
      expect.objectContaining({
        cashTotal: "250.00",
        cardTotal: "410.00",
        zelleTotal: "80.00",
        venmoTotal: "60.00",
        cups4oz: 12,
        cups4ozHere: 4,
        cups4ozToGo: 8,
        cups8oz: 18,
        cups8ozHere: 6,
        cups8ozToGo: 12,
        cupsPint: 6,
        cupsPintHere: 2,
        cupsPintToGo: 4,
        cupsLiter: 2,
        cupsLiterHere: 1,
        cupsLiterToGo: 1,
      })
    );
    expect(notificationMocks.notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Closing submission recorded for 2026-04-21",
        content: expect.stringContaining("Total sales: $800.00"),
      })
    );
    expect(notificationMocks.notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("https://ojaladarsh-m6piugsr.manus.space/dashboard"),
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
