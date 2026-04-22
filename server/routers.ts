import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { notifyOwner } from "./_core/notification";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  createClosingChecklist,
  createEndOfDayReport,
  createOpeningChecklist,
  getDailyOperationsSnapshot,
  getInventoryAlerts,
  getRecentNotes,
  getSalesTrend,
  getWeekOverWeekSales,
  listChecklistQuestions,
  listInventoryItems,
  removeChecklistQuestion,
  saveChecklistQuestion,
  saveInventoryItem,
  updateInventoryCount,
} from "./db";

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
});

const closingChecklistSchema = z.object({
  businessDate: z.string().optional(),
  staffName: z.string().min(1),
  cashCounted: z.number().min(0),
  cashMatchesSystem: z.enum(["Yes", "No"]),
  checklistAnswers: z.array(checklistAnswerSchema).min(1),
  notes: z.string().optional().default(""),
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
});

const inventoryItemSchema = z.object({
  id: z.number().int().positive().optional(),
  category: z.enum(["Ingredients", "Supplies", "Utensils"]),
  itemName: z.string().min(1),
  unitLabel: z.string().min(1),
  currentQuantity: z.number().min(0),
  parLevel: z.number().min(0),
  notes: z.string().optional().default(""),
});

const inventoryUpdateSchema = z.object({
  id: z.number().int().positive(),
  currentQuantity: z.number().min(0),
  notes: z.string().optional().default(""),
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

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
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
    submitInventoryUpdate: protectedProcedure.input(inventoryUpdateSchema).mutation(async ({ ctx, input }) => {
      const item = await updateInventoryCount({
        id: input.id,
        currentQuantity: input.currentQuantity.toFixed(2),
        notes: input.notes ?? "",
      });

      await notifyOwner({
        title: `Inventory updated: ${item.itemName}`,
        content: `${ctx.user.name || "A team member"} updated ${item.itemName} to ${item.currentQuantity} ${item.unitLabel}.`,
      });

      return { success: true, item } as const;
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
      await notifyOwner({
        title: `Opening Checklist submitted for ${record.businessDate}`,
        content: `${record.staffName} submitted the opening checklist. Cash counted and correct: ${record.cashMatchesSystem}. Store ready: ${record.storeReadyStatus}. Failed confirmations: ${failedItems}.`,
      });

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
      await notifyOwner({
        title: `Closing Checklist submitted for ${record.businessDate}`,
        content: `${record.staffName} submitted the closing checklist. Cash match: ${record.cashMatchesSystem}. Store closed: ${record.storeClosedStatus}. Failed confirmations: ${failedItems}.`,
      });

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
      await notifyOwner({
        title: `End-of-Day Report submitted for ${record.businessDate}`,
        content: `${record.staffName} submitted the end-of-day report. Total sales: $${totalSales.toFixed(2)}.`,
      });

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
    checklistQuestions: adminProcedure.input(z.object({ checklistType: checklistTypeSchema })).query(async ({ input }) => listChecklistQuestions(input.checklistType)),
    saveChecklistQuestion: adminProcedure.input(checklistQuestionSchema).mutation(async ({ input }) => {
      const question = await saveChecklistQuestion(input);
      return { success: true, question } as const;
    }),
    removeChecklistQuestion: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => removeChecklistQuestion(input.id)),
    saveInventoryItem: adminProcedure.input(inventoryItemSchema).mutation(async ({ input }) => {
      const item = await saveInventoryItem({
        ...input,
        currentQuantity: input.currentQuantity.toFixed(2),
        parLevel: input.parLevel.toFixed(2),
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
  }),
});

export type AppRouter = typeof appRouter;
