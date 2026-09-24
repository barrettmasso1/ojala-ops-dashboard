import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc";
import { ENV } from "./_core/env";
import {
  getStoreProfile, listStoreCredentials, listStoreDrafts, provisionStoreDraft,
  rotateStoreCredential, updateStoreProfile,
} from "./storeAdminDb";

const businessHours = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();
const posType = z.enum(["none", "square", "toast", "shopify", "other"]);
const commonProfile = z.object({
  nombre: z.string().trim().min(2).max(160),
  horarioApertura: businessHours,
  horarioCierre: businessHours,
  duenoEmail: z.email().max(320),
  posType,
}).refine(value => (value.horarioApertura === null) === (value.horarioCierre === null), {
  message: "Set both opening and closing hours together",
});

const draftProfile = commonProfile.safeExtend({
  timezone: z.string().max(64).refine(value => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; }
    catch { return false; }
  }, "Invalid IANA time zone"),
  cupSizes: z.array(z.string().trim().min(1).max(32)).min(1).max(8).refine(
    values => new Set(values.map(value => value.toLowerCase())).size === values.length,
    "Cup sizes must be unique",
  ),
  ownerOpenId: z.string().trim().min(1).max(64),
  ownerName: z.string().trim().min(1).max(160),
});

function requirePlatformOwner(user: { openId: string; storeId: number }) {
  if (!ENV.ownerOpenId || user.openId !== ENV.ownerOpenId || user.storeId !== 1) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Platform provisioning requires the configured owner" });
  }
}

export const storeAdminRouter = router({
  profile: adminProcedure.query(({ ctx }) => getStoreProfile(ctx.user.storeId)),
  updateProfile: adminProcedure.input(commonProfile).mutation(({ ctx, input }) => updateStoreProfile(ctx.user.storeId, input)),
  credentials: adminProcedure.query(({ ctx }) => listStoreCredentials(ctx.user.storeId)),
  rotateCredential: adminProcedure.input(z.object({ type: z.enum(["staff_portal", "frigate"]) })).mutation(
    ({ ctx, input }) => rotateStoreCredential(ctx.user.storeId, input.type),
  ),
  canProvision: adminProcedure.query(({ ctx }) => Boolean(ENV.ownerOpenId && ctx.user.openId === ENV.ownerOpenId && ctx.user.storeId === 1)),
  drafts: adminProcedure.query(({ ctx }) => {
    requirePlatformOwner(ctx.user);
    return listStoreDrafts();
  }),
  createDraft: adminProcedure.input(draftProfile).mutation(({ ctx, input }) => {
    requirePlatformOwner(ctx.user);
    return provisionStoreDraft(input);
  }),
});
