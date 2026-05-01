import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { notifyOwner } from "./_core/notification";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  createClosingChecklist,
  createEndOfDayReport,
  createOpeningChecklist,
  createSubmissionHistoryEntry,
  getDailyOperationsSnapshot,
  getInventoryAlerts,
  getRecentNotes,
  getSalesTrend,
  getWeekOverWeekSales,
  listSubmissionHistoryEntries,
  listChecklistQuestions,
  listInventoryItems,
  listReadyMadeGelatoWeights,
  listRecipesWithCosts,
  removeChecklistQuestion,
  saveChecklistQuestion,
  saveInventoryItem,
  saveReadyMadeGelatoWeights,
  updateInventoryCount,
  upsertUser,
} from "./db";
import { extractGelatoPhotos } from "./gelatoPhotoPilot";

const checklistAnswerSchema = z.object({
  questionId: z.number().int().positive(),
  sectionTitle: z.string().min(1),
  prompt: z.string().min(1),
  answer: z.enum(["Yes", "No"]),
  detail: z.string().optional().default(""),
});

const openingStockCountsSchema = z.object({
  cups4oz: z.number().int().min(0),
  cups8oz: z.number().int().min(0),
  cupsPint: z.number().int().min(0),
  cupsLiter: z.number().int().min(0),
  lids4oz: z.number().int().min(0),
  lids8oz: z.number().int().min(0),
  lidsPint: z.number().int().min(0),
  lidsLiter: z.number().int().min(0),
  spoons: z.number().int().min(0),
});

const openingChecklistSchema = z.object({
  businessDate: z.string().optional(),
  staffName: z.string().min(1),
  startingCash: z.number().min(0),
  cashCountedAndCorrect: z.enum(["Yes", "No"]),
  storeReadyToOpen: z.enum(["Yes", "No"]),
  stockCounts: openingStockCountsSchema,
  checklistAnswers: z.array(checklistAnswerSchema).min(1),
  notes: z.string().optional().default(""),
  notifyOwner: z.boolean().optional().default(true),
  origin: z.string().url().optional(),
});

const closingChecklistSchema = z.object({
  businessDate: z.string().optional(),
  staffName: z.string().min(1),
  cashCounted: z.number().min(0),
  cashMatchesSystem: z.enum(["Yes", "No"]),
  checklistAnswers: z.array(checklistAnswerSchema).min(1),
  notes: z.string().optional().default(""),
  notifyOwner: z.boolean().optional().default(true),
  origin: z.string().url().optional(),
});

const endOfDayReportSchema = z.object({
  businessDate: z.string().min(1),
  staffName: z.string().min(1),
  cups4ozHere: z.number().int().min(0),
  cups4ozToGo: z.number().int().min(0),
  cups8ozHere: z.number().int().min(0),
  cups8ozToGo: z.number().int().min(0),
  cupsPintHere: z.number().int().min(0),
  cupsPintToGo: z.number().int().min(0),
  cupsLiterHere: z.number().int().min(0),
  cupsLiterToGo: z.number().int().min(0),
  cashTotal: z.number().min(0),
  cardTotal: z.number().min(0),
  zelleTotal: z.number().min(0),
  venmoTotal: z.number().min(0),
  wasteNotes: z.string().optional().default(""),
  lowItemNotes: z.string().optional().default(""),
  generalNotes: z.string().optional().default(""),
  notifyOwner: z.boolean().optional().default(true),
  origin: z.string().url().optional(),
});

const inventoryItemSchema = z.object({
  id: z.number().int().positive().optional(),
  department: z.string().min(1),
  category: z.string().min(1),
  itemName: z.string().min(1),
  unitType: z.string().min(1),
  packSize: z.string().optional().default(""),
  costPerUnit: z.number().min(0),
  currentQuantity: z.number().min(0),
  parLevel: z.number().min(0),
  reorderQuantity: z.number().min(0),
  supplier: z.string().optional().default(""),
  supplierContact: z.string().optional().default(""),
  lastCountDate: z.string().optional().default(""),
  notes: z.string().optional().default(""),
});

const inventoryUpdateSchema = z.object({
  id: z.number().int().positive(),
  currentQuantity: z.number().min(0),
  notes: z.string().optional().default(""),
  notifyOwner: z.boolean().optional().default(true),
  origin: z.string().url().optional(),
});

const inventorySubmissionSummarySchema = z.object({
  businessDate: z.string().min(1),
  staffName: z.string().min(1),
  gelatoEntryCount: z.number().int().min(0).optional().default(0),
  itemSummaries: z.array(
    z.object({
      itemName: z.string().min(1),
      currentQuantity: z.number().min(0),
      unitType: z.string().min(1),
      department: z.string().optional().default(""),
    })
  ).min(1),
  notifyOwner: z.boolean().optional().default(true),
  origin: z.string().url().optional(),
});

const readyMadeGelatoShiftTypeSchema = z.enum(["opening", "closing"]);

const readyMadeGelatoEntrySchema = z.object({
  flavor: z.string().min(1),
  smallPanCount: z.number().int().min(0),
  smallGrossWeightKg: z.number().min(0).optional(),
  largePanCount: z.number().int().min(0),
  largeGrossWeightKg: z.number().min(0).optional(),
  combinedGrossWeightKg: z.number().min(0).optional(),
});

const readyMadeGelatoSchema = z.object({
  businessDate: z.string().optional(),
  shiftType: readyMadeGelatoShiftTypeSchema,
  entries: z.array(readyMadeGelatoEntrySchema).min(1),
  notifyOwner: z.boolean().optional().default(true),
  origin: z.string().url().optional(),
});

const gelatoPhotoUploadSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  dataUrl: z.string().min(1),
});

const extractGelatoPhotosSchema = z.object({
  shiftType: readyMadeGelatoShiftTypeSchema,
  photos: z.array(gelatoPhotoUploadSchema).min(1).max(12),
});

const submissionHistoryPhotoSchema = z.object({
  fileName: z.string().min(1),
  imageUrl: z.string().min(1),
  flavor: z.string().min(1),
  smallPanCount: z.number().int().min(0),
  largePanCount: z.number().int().min(0),
  combinedGrossWeightKg: z.number().min(0),
  confidence: z.enum(["high", "medium", "low"]),
  warning: z.string().optional().default(""),
});

const submissionHistorySchema = z.object({
  businessDate: z.string().optional(),
  submissionType: z.enum(["opening", "closing", "inventory"]),
  staffName: z.string().min(1),
  payload: z.object({
    form: z.record(z.string(), z.unknown()).optional(),
    checklistAnswers: z.array(checklistAnswerSchema).optional(),
    gelatoEntries: z.array(readyMadeGelatoEntrySchema).optional(),
    gelatoEntryMode: z.enum(["manual", "photo"]).optional(),
    analyzedPhotos: z.array(submissionHistoryPhotoSchema).optional(),
    inventoryItems: z.array(
      z.object({
        itemName: z.string().min(1),
        currentQuantity: z.number(),
        unitType: z.string().min(1),
        department: z.string().optional().default(""),
      })
    ).optional(),
    notes: z.record(z.string(), z.string()).optional(),
  }).passthrough(),
});

const checklistTypeSchema = z.enum(["opening", "closing"]);

const checklistQuestionSchema = z.object({
  id: z.number().int().positive().optional(),
  checklistType: checklistTypeSchema,
  sectionTitle: z.string().min(1),
  prompt: z.string().min(1),
  detailPrompt: z.string().optional().default(""),
  detailTrigger: z.enum(["Yes", "No", "Never"]),
  displayOrder: z.number().int().min(0),
});

function normalizeFrontendOrigin(origin?: string) {
  if (!origin) return "";

  try {
    return new URL(origin).origin;
  } catch {
    return "";
  }
}

function buildDashboardUrl(
  req: { protocol?: string; headers: Record<string, string | string[] | undefined>; get?: (name: string) => string | undefined },
  frontendOrigin?: string
) {
  const normalizedOrigin = normalizeFrontendOrigin(frontendOrigin);
  if (normalizedOrigin) {
    return `${normalizedOrigin}/dashboard`;
  }

  const forwardedProto = req.headers["x-forwarded-proto"];
  const forwardedHost = req.headers["x-forwarded-host"];
  const protocol =
    req.protocol === "https" || (Array.isArray(forwardedProto) ? forwardedProto.join(",") : forwardedProto ?? "").includes("https")
      ? "https"
      : req.protocol || "http";
  const host =
    (typeof req.get === "function" ? req.get("host") : undefined) ||
    (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ||
    req.headers.host ||
    "";

  return host ? `${protocol}://${host}/dashboard` : "/dashboard";
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    staffPortalLogin: publicProcedure.input(z.object({ password: z.string().min(1) })).mutation(async ({ ctx, input }) => {
      if (!ENV.staffPortalPassword || input.password !== ENV.staffPortalPassword) {
        throw new Error("Invalid staff portal password");
      }

      const sharedStaffOpenId = "ojala-shared-staff-portal";
      await upsertUser({
        openId: sharedStaffOpenId,
        name: "Ojala Staff",
        loginMethod: "shared-password",
        role: "user",
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(sharedStaffOpenId, {
        name: "Ojala Staff",
        expiresInMs: ONE_YEAR_MS,
      });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      return {
        success: true,
        role: "user",
      } as const;
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  forms: router({
    checklistQuestions: protectedProcedure.input(z.object({ checklistType: checklistTypeSchema })).query(async ({ input }) => listChecklistQuestions(input.checklistType)),
    inventoryItems: protectedProcedure.query(async () => listInventoryItems()),
    readyMadeGelatoWeights: protectedProcedure.input(z.object({ businessDate: z.string().optional() }).optional()).query(async ({ input }) => listReadyMadeGelatoWeights(input?.businessDate)),
    submitInventoryUpdate: protectedProcedure.input(inventoryUpdateSchema).mutation(async ({ ctx, input }) => {
      const item = await updateInventoryCount({
        id: input.id,
        currentQuantity: input.currentQuantity.toFixed(2),
        notes: input.notes ?? "",
      });

      if (input.notifyOwner) {
        await notifyOwner({
          title: `Inventory updated: ${item.itemName}`,
          content: `${ctx.user.name || "A team member"} updated ${item.itemName} to ${item.currentQuantity} ${item.unitType}. Review: ${buildDashboardUrl(ctx.req, input.origin)}`,
        });
      }

      return { success: true, item } as const;
    }),
    submitInventorySubmissionSummary: protectedProcedure.input(inventorySubmissionSummarySchema).mutation(async ({ ctx, input }) => {
      if (input.notifyOwner) {
        const previewItems = input.itemSummaries
          .slice(0, 10)
          .map(item => `${item.itemName}: ${item.currentQuantity} ${item.unitType}${item.department ? ` (${item.department})` : ""}`)
          .join("; ");
        const remainingCount = Math.max(input.itemSummaries.length - 10, 0);
        const remainingLabel = remainingCount > 0 ? `; plus ${remainingCount} more item${remainingCount === 1 ? "" : "s"}` : "";
        const gelatoLabel = input.gelatoEntryCount > 0 ? ` Ready-made gelato entries saved: ${input.gelatoEntryCount}.` : "";

        await notifyOwner({
          title: `Inventory updated for ${input.businessDate}`,
          content: `${input.staffName || ctx.user.name || "A team member"} submitted ${input.itemSummaries.length} inventory updates for ${input.businessDate}.${gelatoLabel} Updated items: ${previewItems}${remainingLabel}. Review: ${buildDashboardUrl(ctx.req, input.origin)}`,
        });
      }

      return { success: true } as const;
    }),
    submitSubmissionHistory: protectedProcedure.input(submissionHistorySchema).mutation(async ({ ctx, input }) => {
      const entry = await createSubmissionHistoryEntry({
        businessDate: input.businessDate,
        submissionType: input.submissionType,
        staffName: input.staffName,
        submittedByUserId: ctx.user.id,
        payload: input.payload,
      });

      return { success: true, entry } as const;
    }),
    extractGelatoPhotos: protectedProcedure.input(extractGelatoPhotosSchema).mutation(async ({ input }) => {
      const result = await extractGelatoPhotos(input.photos);

      return {
        success: true,
        shiftType: input.shiftType,
        extractedPhotos: result.extractedPhotos,
        groupedEntries: result.groupedEntries,
      } as const;
    }),
    submitReadyMadeGelato: protectedProcedure.input(readyMadeGelatoSchema).mutation(async ({ ctx, input }) => {
      const records = await saveReadyMadeGelatoWeights({
        businessDate: input.businessDate,
        shiftType: input.shiftType,
        submittedByUserId: ctx.user.id,
        entries: input.entries.map(entry => ({
          flavor: entry.flavor,
          smallPanCount: entry.smallPanCount,
          smallGrossWeightKg: entry.smallGrossWeightKg?.toFixed(2),
          largePanCount: entry.largePanCount,
          largeGrossWeightKg: entry.largeGrossWeightKg?.toFixed(2),
          combinedGrossWeightKg: entry.combinedGrossWeightKg?.toFixed(2),
        })),
      });

      if (input.notifyOwner) {
        await notifyOwner({
          title: `Ready-made gelato ${input.shiftType} saved: ${input.businessDate || new Date().toISOString().slice(0, 10)}`,
          content: `${ctx.user.name || "A team member"} saved ${records.length} ${input.shiftType} gelato measurements for ${input.businessDate || new Date().toISOString().slice(0, 10)}. Review: ${buildDashboardUrl(ctx.req, input.origin)}`,
        });
      }

      return { success: true, records } as const;
    }),
    submitOpening: protectedProcedure.input(openingChecklistSchema).mutation(async ({ ctx, input }) => {
      const answersBySection = input.checklistAnswers.reduce<Record<string, Array<string>>>((acc, answer) => {
        const line = `${answer.prompt}: ${answer.answer}${answer.detail ? ` — ${answer.detail}` : ""}`;
        acc[answer.sectionTitle] = [...(acc[answer.sectionTitle] ?? []), line];
        return acc;
      }, {});

      const record = await createOpeningChecklist({
        businessDate: input.businessDate ?? new Date().toISOString().slice(0, 10),
        staffName: input.staffName,
        equipmentStatus: (answersBySection.Equipment ?? []).join("\n") || "No equipment responses provided",
        cleanlinessStatus: (answersBySection.Cleanliness ?? []).join("\n") || "No cleanliness responses provided",
        setupStatus: [
          `Cup counts — 4oz: ${input.stockCounts.cups4oz}, 8oz: ${input.stockCounts.cups8oz}, Pint: ${input.stockCounts.cupsPint}, Liter: ${input.stockCounts.cupsLiter}`,
          `Lid counts — 4oz: ${input.stockCounts.lids4oz}, 8oz: ${input.stockCounts.lids8oz}, Pint: ${input.stockCounts.lidsPint}, Liter: ${input.stockCounts.lidsLiter}`,
          `Spoons stocked: ${input.stockCounts.spoons}`,
          ...(answersBySection.Setup ?? []),
          ...(answersBySection["Employee Preparation"] ?? []),
        ].join("\n") || "No setup responses provided",
        startingCash: input.startingCash.toFixed(2),
        cashMatchesSystem: input.cashCountedAndCorrect,
        storeReadyStatus: input.storeReadyToOpen,
        responseJson: JSON.stringify({
          checklistAnswers: input.checklistAnswers,
          stockCounts: input.stockCounts,
        }),
        notes: input.notes ?? "",
        submittedByUserId: ctx.user.id,
      });

      const failedItems = input.checklistAnswers.filter(item => item.answer === "No").length;
      if (input.notifyOwner) {
        await notifyOwner({
          title: `Opening form submitted for ${record.businessDate}`,
          content: `${record.staffName} submitted the opening form. Cash counted and correct: ${record.cashMatchesSystem}. Store ready: ${record.storeReadyStatus}. Failed confirmations: ${failedItems}. Review: ${buildDashboardUrl(ctx.req, input.origin)}`,
        });
      }

      return { success: true } as const;
    }),
    submitClosing: protectedProcedure.input(closingChecklistSchema).mutation(async ({ ctx, input }) => {
      const answersBySection = input.checklistAnswers.reduce<Record<string, Array<string>>>((acc, answer) => {
        const line = `${answer.prompt}: ${answer.answer}${answer.detail ? ` — ${answer.detail}` : ""}`;
        acc[answer.sectionTitle] = [...(acc[answer.sectionTitle] ?? []), line];
        return acc;
      }, {});
      const storeClosedAnswer = input.checklistAnswers.find(answer => answer.prompt === "Store closed properly")?.answer ?? "No";

      const record = await createClosingChecklist({
        businessDate: input.businessDate ?? new Date().toISOString().slice(0, 10),
        staffName: input.staffName,
        cashCounted: input.cashCounted.toFixed(2),
        cashMatchesSystem: input.cashMatchesSystem,
        cleaningStatus: (answersBySection.Cleaning ?? []).join("\n") || "No cleaning responses provided",
        productStorageStatus: [(answersBySection.Product ?? []).join("\n"), (answersBySection.Final ?? []).join("\n")]
          .filter(Boolean)
          .join("\n") || "No product responses provided",
        storeClosedStatus: storeClosedAnswer,
        responseJson: JSON.stringify(input.checklistAnswers),
        notes: input.notes ?? "",
        submittedByUserId: ctx.user.id,
      });

      const failedItems = input.checklistAnswers.filter(item => item.answer === "No").length;
      if (input.notifyOwner) {
        await notifyOwner({
          title: `Closing form submitted for ${record.businessDate}`,
          content: `${record.staffName} submitted the closing form. Cash match: ${record.cashMatchesSystem}. Store closed: ${record.storeClosedStatus}. Failed confirmations: ${failedItems}. Review: ${buildDashboardUrl(ctx.req, input.origin)}`,
        });
      }

      return { success: true } as const;
    }),
    submitEndOfDay: protectedProcedure.input(endOfDayReportSchema).mutation(async ({ ctx, input }) => {
      const record = await createEndOfDayReport({
        ...input,
        cups4oz: input.cups4ozHere + input.cups4ozToGo,
        cups8oz: input.cups8ozHere + input.cups8ozToGo,
        cupsPint: input.cupsPintHere + input.cupsPintToGo,
        cupsLiter: input.cupsLiterHere + input.cupsLiterToGo,
        cashTotal: input.cashTotal.toFixed(2),
        cardTotal: input.cardTotal.toFixed(2),
        zelleTotal: input.zelleTotal.toFixed(2),
        venmoTotal: input.venmoTotal.toFixed(2),
        wasteNotes: input.wasteNotes ?? "",
        lowItemNotes: input.lowItemNotes ?? "",
        generalNotes: input.generalNotes ?? "",
        submittedByUserId: ctx.user.id,
      });

      const totalSales = input.cashTotal + input.cardTotal + input.zelleTotal + input.venmoTotal;
      if (input.notifyOwner) {
        await notifyOwner({
          title: `Closing submission recorded for ${record.businessDate}`,
          content: `${record.staffName} submitted the closing sales report. Total sales: $${totalSales.toFixed(2)}. Review: ${buildDashboardUrl(ctx.req, input.origin)}`,
        });
      }

      return { success: true } as const;
    }),
  }),
  dashboard: router({
    daily: adminProcedure
      .input(
        z.object({
          businessDate: z.string().optional(),
        })
      )
      .query(async ({ input }) => getDailyOperationsSnapshot(input.businessDate)),
    salesTrend: adminProcedure
      .input(
        z.object({
          days: z.number().int().min(7).max(90).default(28),
        })
      )
      .query(async ({ input }) => getSalesTrend(input.days)),
    weekOverWeek: adminProcedure.query(async () => getWeekOverWeekSales()),
    inventoryAlerts: adminProcedure.query(async () => getInventoryAlerts()),
    inventoryItems: adminProcedure.query(async () => listInventoryItems()),
    recipes: adminProcedure.query(async () => listRecipesWithCosts()),
    checklistQuestions: adminProcedure.input(z.object({ checklistType: checklistTypeSchema })).query(async ({ input }) => listChecklistQuestions(input.checklistType)),
    saveChecklistQuestion: adminProcedure.input(checklistQuestionSchema).mutation(async ({ input }) => {
      const question = await saveChecklistQuestion(input);
      return { success: true, question } as const;
    }),
    removeChecklistQuestion: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => removeChecklistQuestion(input.id)),
    saveInventoryItem: adminProcedure.input(inventoryItemSchema).mutation(async ({ input }) => {
      const item = await saveInventoryItem({
        ...input,
        costPerUnit: input.costPerUnit.toFixed(2),
        currentQuantity: input.currentQuantity.toFixed(2),
        parLevel: input.parLevel.toFixed(2),
        reorderQuantity: input.reorderQuantity.toFixed(2),
        supplier: input.supplier ?? "",
        supplierContact: input.supplierContact ?? "",
        lastCountDate: input.lastCountDate ?? "",
        notes: input.notes ?? "",
      });

      return { success: true, item } as const;
    }),
    recentNotes: adminProcedure
      .input(
        z.object({
          limit: z.number().int().min(4).max(30).default(12),
        })
      )
      .query(async ({ input }) => getRecentNotes(input.limit)),
    submissionHistory: adminProcedure
      .input(
        z.object({
          businessDate: z.string().optional(),
        }).optional()
      )
      .query(async ({ input }) => listSubmissionHistoryEntries(input?.businessDate)),
  }),
});

export type AppRouter = typeof appRouter;
