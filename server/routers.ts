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
  listInventoryItems,
  saveInventoryItem,
} from "./db";

const openingChecklistSchema = z.object({
  businessDate: z.string().optional(),
  staffName: z.string().min(1),
  equipmentStatus: z.string().min(1),
  cleanlinessStatus: z.string().min(1),
  setupStatus: z.string().min(1),
  startingCash: z.number().min(0),
  cashMatchesSystem: z.enum(["Yes", "No"]),
  storeReadyStatus: z.enum(["Yes", "No"]),
  notes: z.string().optional().default(""),
});

const closingChecklistSchema = z.object({
  businessDate: z.string().optional(),
  staffName: z.string().min(1),
  cashCounted: z.number().min(0),
  cashMatchesSystem: z.enum(["Yes", "No"]),
  cleaningStatus: z.string().min(1),
  productStorageStatus: z.string().min(1),
  storeClosedStatus: z.enum(["Yes", "No"]),
  notes: z.string().optional().default(""),
});

const endOfDayReportSchema = z.object({
  businessDate: z.string().min(1),
  shift: z.enum(["AM", "PM", "Full Day"]),
  staffName: z.string().min(1),
  cups4oz: z.number().int().min(0),
  cups8oz: z.number().int().min(0),
  cupsPint: z.number().int().min(0),
  cupsLiter: z.number().int().min(0),
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
    submitOpening: protectedProcedure.input(openingChecklistSchema).mutation(async ({ ctx, input }) => {
      const record = await createOpeningChecklist({
        ...input,
        businessDate: input.businessDate ?? new Date().toISOString().slice(0, 10),
        startingCash: input.startingCash.toFixed(2),
        notes: input.notes ?? "",
        submittedByUserId: ctx.user.id,
      });

      await notifyOwner({
        title: `Opening Checklist submitted for ${record.businessDate}`,
        content: `${record.staffName} submitted the opening checklist. Cash match: ${record.cashMatchesSystem}. Store ready: ${record.storeReadyStatus}.`,
      });

      return { success: true } as const;
    }),
    submitClosing: protectedProcedure.input(closingChecklistSchema).mutation(async ({ ctx, input }) => {
      const record = await createClosingChecklist({
        ...input,
        businessDate: input.businessDate ?? new Date().toISOString().slice(0, 10),
        cashCounted: input.cashCounted.toFixed(2),
        notes: input.notes ?? "",
        submittedByUserId: ctx.user.id,
      });

      await notifyOwner({
        title: `Closing Checklist submitted for ${record.businessDate}`,
        content: `${record.staffName} submitted the closing checklist. Cash match: ${record.cashMatchesSystem}. Store closed: ${record.storeClosedStatus}.`,
      });

      return { success: true } as const;
    }),
    submitEndOfDay: protectedProcedure.input(endOfDayReportSchema).mutation(async ({ ctx, input }) => {
      const record = await createEndOfDayReport({
        ...input,
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
        content: `${record.staffName} submitted the end-of-day report for the ${record.shift} shift. Total sales: $${totalSales.toFixed(2)}.`,
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
