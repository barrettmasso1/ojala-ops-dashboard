import { and, eq, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import { getBusinessDate, isFutureBusinessDate } from "../shared/businessDate";
import {
  checklistQuestions,
  closingChecklists,
  endOfDayReports,
  openingChecklists,
  readyMadeGelatoWeights,
  submissionHistoryEntries,
  type InsertClosingChecklist,
  type InsertEndOfDayReport,
  type InsertReadyMadeGelatoWeight,
  type InsertSubmissionHistoryEntry,
} from "../drizzle/schema";
import { getDb, hasImpossibleReadyMadeGrossWeights, resolveReadyMadeGrossWeights } from "./db";

type ChecklistAnswer = {
  questionId: number;
  sectionTitle: string;
  prompt: string;
  answer: "Yes" | "No";
  detail?: string;
};

type WeightEntry = {
  flavor: string;
  smallPanCount: number;
  smallGrossWeightKg?: number;
  largePanCount: number;
  largeGrossWeightKg?: number;
  combinedGrossWeightKg?: number;
};

type ReportInput = {
  staffName: string;
  cups4ozHere: number;
  cups4ozToGo: number;
  cups8ozHere: number;
  cups8ozToGo: number;
  cupsPintHere: number;
  cupsPintToGo: number;
  cupsLiterHere: number;
  cupsLiterToGo: number;
  cashTotal: number;
  cardTotal: number;
  zelleTotal: number;
  venmoTotal: number;
  cashCounted: number;
  cashMatchesSystem: "Yes" | "No";
  sampleOunces: number;
  wasteOunces: number;
  wasteNotes?: string;
  lowItemNotes?: string;
  generalNotes?: string;
};

export type RetroactiveClosingMode = "weights_only" | "complete";

export type RetroactiveClosingInput = {
  storeId: number;
  submittedByUserId: number;
  businessDate: string;
  timeZone: string;
  mode: RetroactiveClosingMode;
  expectedRevision: string;
  reason: string;
  source: "original_closing_form" | "operator_statement" | "historical_ledger";
  staffName: string;
  checklistAnswers: ChecklistAnswer[];
  report?: ReportInput;
  weights: WeightEntry[];
};

function normalizeFlavor(flavor: string) {
  return flavor.trim().toLocaleLowerCase();
}

function assertPastBusinessDate(date: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A valid business date is required.");
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || getBusinessDate(parsed, "UTC") !== date) {
    throw new Error("A valid business date is required.");
  }
  const current = getBusinessDate(new Date(), timeZone);
  if (isFutureBusinessDate(date, new Date(), timeZone) || date >= current) {
    throw new Error("Retroactive capture is limited to a past business date.");
  }
}

function assertNonNegativeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a whole number of zero or more.`);
}

function assertCompleteWeights(weights: WeightEntry[]) {
  if (weights.length === 0) throw new Error("At least one real historical weight entry is required.");
  const seen = new Set<string>();
  for (const entry of weights) {
    const flavor = entry.flavor.trim();
    if (!flavor) throw new Error("Every historical weight entry needs a flavor.");
    const key = normalizeFlavor(flavor);
    if (seen.has(key)) throw new Error("Each flavor may appear only once in the historical weight capture.");
    seen.add(key);
    assertNonNegativeInteger(entry.smallPanCount, `${flavor} small-pan count`);
    assertNonNegativeInteger(entry.largePanCount, `${flavor} large-pan count`);
    const smallGross = entry.smallGrossWeightKg ?? 0;
    const largeGross = entry.largeGrossWeightKg ?? 0;
    const combined = entry.combinedGrossWeightKg ?? 0;
    if (![smallGross, largeGross, combined].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0)) {
      throw new Error(`${flavor} needs non-negative gross weights supplied from the original record.`);
    }
    if (entry.smallPanCount > 0 && smallGross <= 0 && combined <= 0) throw new Error(`${flavor} needs a measured small-pan gross weight.`);
    if (entry.largePanCount > 0 && largeGross <= 0 && combined <= 0) throw new Error(`${flavor} needs a measured large-pan gross weight.`);
    if (entry.smallPanCount + entry.largePanCount <= 0 || smallGross + largeGross + combined <= 0) {
      throw new Error(`${flavor} needs a real pan count and measured weight; zero is not a substitute for missing data.`);
    }
    const raw = {
      flavor,
      smallPanCount: entry.smallPanCount,
      smallGrossWeightKg: smallGross.toFixed(3),
      largePanCount: entry.largePanCount,
      largeGrossWeightKg: largeGross.toFixed(3),
      combinedGrossWeightKg: combined > 0 ? combined.toFixed(3) : undefined,
    };
    if (hasImpossibleReadyMadeGrossWeights(raw)) throw new Error(`${flavor} has an impossible gross weight for the selected pan setup.`);
  }
}

function assertCompleteReport(report: ReportInput | undefined) {
  if (!report) throw new Error("Complete closing mode requires the original closing report values; no values were supplied.");
  if (!report.staffName.trim()) throw new Error("Complete closing mode requires the original staff name.");
  for (const [key, value] of Object.entries(report)) {
    if (["staffName", "cashMatchesSystem", "wasteNotes", "lowItemNotes", "generalNotes"].includes(key)) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Complete closing report field ${key} is missing or invalid.`);
  }
}

function revisionFor(status: Omit<RetroactiveClosingStatus, "revision">) {
  return createHash("sha256").update(JSON.stringify(status)).digest("hex");
}

export type RetroactiveClosingStatus = {
  storeId: number;
  businessDate: string;
  isPastBusinessDate: true;
  openingCount: number;
  closingCount: number;
  reportCount: number;
  closingWeightCount: number;
  closingHistoryCount: number;
  closingIds: number[];
  reportIds: number[];
  closingWeightIds: number[];
  closingHistoryIds: number[];
  revision: string;
};

export async function getRetroactiveClosingStatus(input: { storeId: number; businessDate: string; timeZone: string }): Promise<RetroactiveClosingStatus> {
  assertPastBusinessDate(input.businessDate, input.timeZone);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [closingRows, reportRows, weightRows, historyRows, openingRows] = await Promise.all([
    db.select({ id: closingChecklists.id }).from(closingChecklists).where(and(eq(closingChecklists.storeId, input.storeId), eq(closingChecklists.businessDate, input.businessDate))),
    db.select({ id: endOfDayReports.id }).from(endOfDayReports).where(and(eq(endOfDayReports.storeId, input.storeId), eq(endOfDayReports.businessDate, input.businessDate))),
    db.select({ id: readyMadeGelatoWeights.id }).from(readyMadeGelatoWeights).where(and(eq(readyMadeGelatoWeights.storeId, input.storeId), eq(readyMadeGelatoWeights.businessDate, input.businessDate), eq(readyMadeGelatoWeights.shiftType, "closing"))),
    db.select({ id: submissionHistoryEntries.id }).from(submissionHistoryEntries).where(and(eq(submissionHistoryEntries.storeId, input.storeId), eq(submissionHistoryEntries.businessDate, input.businessDate), or(eq(submissionHistoryEntries.submissionType, "closing"), eq(submissionHistoryEntries.submissionType, "inventory")))),
    db.select({ id: openingChecklists.id }).from(openingChecklists).where(and(eq(openingChecklists.storeId, input.storeId), eq(openingChecklists.businessDate, input.businessDate))),
  ]);
  const statusWithoutRevision = {
    storeId: input.storeId,
    businessDate: input.businessDate,
    isPastBusinessDate: true as const,
    openingCount: openingRows.length,
    closingCount: closingRows.length,
    reportCount: reportRows.length,
    closingWeightCount: weightRows.length,
    closingHistoryCount: historyRows.length,
    closingIds: closingRows.map(row => row.id).sort((a, b) => a - b),
    reportIds: reportRows.map(row => row.id).sort((a, b) => a - b),
    closingWeightIds: weightRows.map(row => row.id).sort((a, b) => a - b),
    closingHistoryIds: historyRows.map(row => row.id).sort((a, b) => a - b),
  };
  return { ...statusWithoutRevision, revision: revisionFor(statusWithoutRevision) };
}

export async function saveRetroactiveClosing(input: RetroactiveClosingInput) {
  assertPastBusinessDate(input.businessDate, input.timeZone);
  if (!/^[a-f0-9]{64}$/.test(input.expectedRevision)) throw new Error("A current retroactive closing revision is required.");
  if (input.reason.trim().length < 12) throw new Error("A specific reason is required for a retroactive capture.");
  if (!input.staffName.trim()) throw new Error("The submitting admin name is required.");
  assertCompleteWeights(input.weights);
  if (input.mode === "complete") assertCompleteReport(input.report);

  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const created = await db.transaction(async tx => {
    const [openingRows, closingRows, reportRows, weightRows, historyRows, activeQuestions] = await Promise.all([
      tx.select({ id: openingChecklists.id }).from(openingChecklists).where(and(eq(openingChecklists.storeId, input.storeId), eq(openingChecklists.businessDate, input.businessDate))),
      tx.select({ id: closingChecklists.id }).from(closingChecklists).where(and(eq(closingChecklists.storeId, input.storeId), eq(closingChecklists.businessDate, input.businessDate))),
      tx.select({ id: endOfDayReports.id }).from(endOfDayReports).where(and(eq(endOfDayReports.storeId, input.storeId), eq(endOfDayReports.businessDate, input.businessDate))),
      tx.select({ id: readyMadeGelatoWeights.id }).from(readyMadeGelatoWeights).where(and(eq(readyMadeGelatoWeights.storeId, input.storeId), eq(readyMadeGelatoWeights.businessDate, input.businessDate), eq(readyMadeGelatoWeights.shiftType, "closing"))),
      tx.select({ id: submissionHistoryEntries.id }).from(submissionHistoryEntries).where(and(eq(submissionHistoryEntries.storeId, input.storeId), eq(submissionHistoryEntries.businessDate, input.businessDate), or(eq(submissionHistoryEntries.submissionType, "closing"), eq(submissionHistoryEntries.submissionType, "inventory")))),
      tx.select({ id: checklistQuestions.id, sectionTitle: checklistQuestions.sectionTitle, prompt: checklistQuestions.prompt }).from(checklistQuestions).where(and(eq(checklistQuestions.storeId, input.storeId), eq(checklistQuestions.checklistType, "closing"), eq(checklistQuestions.isActive, 1))),
    ]);
    const currentWithoutRevision = {
      storeId: input.storeId,
      businessDate: input.businessDate,
      isPastBusinessDate: true as const,
      openingCount: openingRows.length,
      closingCount: closingRows.length,
      reportCount: reportRows.length,
      closingWeightCount: weightRows.length,
      closingHistoryCount: historyRows.length,
      closingIds: closingRows.map(row => row.id).sort((a, b) => a - b),
      reportIds: reportRows.map(row => row.id).sort((a, b) => a - b),
      closingWeightIds: weightRows.map(row => row.id).sort((a, b) => a - b),
      closingHistoryIds: historyRows.map(row => row.id).sort((a, b) => a - b),
    };
    if (revisionFor(currentWithoutRevision) !== input.expectedRevision) throw new Error("The selected date changed; reload its status before saving.");
    if (closingRows.length || reportRows.length || weightRows.length || historyRows.length) throw new Error("This store/date already has closing data; nothing was overwritten.");
    if (input.mode === "complete") {
      const answerIds = new Set(input.checklistAnswers.map(answer => answer.questionId));
      if (activeQuestions.some(question => !answerIds.has(question.id))) throw new Error("Complete closing mode requires every active closing checklist answer.");
      if (input.checklistAnswers.length !== answerIds.size) throw new Error("Complete closing mode cannot contain duplicate checklist answers.");
      const report = input.report!;
      const answersBySection = input.checklistAnswers.reduce<Record<string, string[]>>((acc, answer) => {
        const line = `${answer.prompt}: ${answer.answer}${answer.detail ? ` — ${answer.detail}` : ""}`;
        acc[answer.sectionTitle] = [...(acc[answer.sectionTitle] ?? []), line];
        return acc;
      }, {});
      const closingValues: InsertClosingChecklist = {
        storeId: input.storeId,
        businessDate: input.businessDate,
        staffName: report.staffName.trim(),
        cashCounted: report.cashCounted.toFixed(2),
        cashMatchesSystem: report.cashMatchesSystem,
        cleaningStatus: (answersBySection.Cleaning ?? []).join("\n") || "No cleaning responses provided",
        productStorageStatus: [...(answersBySection.Product ?? []), ...(answersBySection.Final ?? [])].join("\n") || "No product responses provided",
        storeClosedStatus: input.checklistAnswers.find(answer => answer.prompt === "Store closed properly")?.answer ?? "No",
        responseJson: JSON.stringify(input.checklistAnswers),
        notes: [input.reason.trim(), report.generalNotes?.trim()].filter(Boolean).join("\n\n"),
        submittedByUserId: input.submittedByUserId,
      };
      const reportValues: InsertEndOfDayReport = {
        storeId: input.storeId,
        businessDate: input.businessDate,
        staffName: report.staffName.trim(),
        cups4oz: report.cups4ozHere + report.cups4ozToGo,
        cups4ozHere: report.cups4ozHere,
        cups4ozToGo: report.cups4ozToGo,
        cups8oz: report.cups8ozHere + report.cups8ozToGo,
        cups8ozHere: report.cups8ozHere,
        cups8ozToGo: report.cups8ozToGo,
        cupsPint: report.cupsPintHere + report.cupsPintToGo,
        cupsPintHere: report.cupsPintHere,
        cupsPintToGo: report.cupsPintToGo,
        cupsLiter: report.cupsLiterHere + report.cupsLiterToGo,
        cupsLiterHere: report.cupsLiterHere,
        cupsLiterToGo: report.cupsLiterToGo,
        cashTotal: report.cashTotal.toFixed(2),
        cardTotal: report.cardTotal.toFixed(2),
        zelleTotal: report.zelleTotal.toFixed(2),
        venmoTotal: report.venmoTotal.toFixed(2),
        sampleOunces: report.sampleOunces.toFixed(2),
        wasteOunces: report.wasteOunces.toFixed(2),
        wasteNotes: report.wasteNotes?.trim() ?? "",
        lowItemNotes: report.lowItemNotes?.trim() ?? "",
        generalNotes: report.generalNotes?.trim() ?? "",
        submittedByUserId: input.submittedByUserId,
      };
      const closingInsert = await tx.insert(closingChecklists).values(closingValues);
      const reportInsert = await tx.insert(endOfDayReports).values(reportValues);
      const weightInsertIds = await insertClosingWeights(tx, input);
      const audit = await insertAudit(tx, input, "closing", {
        kind: "retroactive_admin_closing_v1",
        mode: input.mode,
        source: input.source,
        reason: input.reason.trim(),
        businessDate: input.businessDate,
        closingId: Number(closingInsert[0]?.insertId ?? 0),
        reportId: Number(reportInsert[0]?.insertId ?? 0),
        weightIds: weightInsertIds,
        physicalDeliveryCountCreated: false,
        inventoryCurrentQuantityChanged: false,
      });
      return { closingId: Number(closingInsert[0]?.insertId ?? 0), reportId: Number(reportInsert[0]?.insertId ?? 0), weightIds: weightInsertIds, auditId: audit };
    }

    const weightIds = await insertClosingWeights(tx, input);
    const auditId = await insertAudit(tx, input, "inventory", {
      kind: "retroactive_admin_weights_only_v1",
      mode: input.mode,
      source: input.source,
      reason: input.reason.trim(),
      businessDate: input.businessDate,
      weightIds,
      physicalDeliveryCountCreated: false,
      inventoryCurrentQuantityChanged: false,
    });
    return { closingId: null, reportId: null, weightIds, auditId };
  });

  return {
    success: true as const,
    ...created,
    status: await getRetroactiveClosingStatus({ storeId: input.storeId, businessDate: input.businessDate, timeZone: input.timeZone }),
  };
}

async function insertClosingWeights(tx: any, input: RetroactiveClosingInput) {
  const values: InsertReadyMadeGelatoWeight[] = input.weights.map(entry => {
    const resolved = resolveReadyMadeGrossWeights({
      flavor: entry.flavor.trim(),
      smallPanCount: entry.smallPanCount,
      smallGrossWeightKg: entry.smallGrossWeightKg,
      largePanCount: entry.largePanCount,
      largeGrossWeightKg: entry.largeGrossWeightKg,
      combinedGrossWeightKg: entry.combinedGrossWeightKg,
    });
    const netWeightKg = Math.max(0, resolved.smallGrossWeightKg - entry.smallPanCount * 0.286) + Math.max(0, resolved.largeGrossWeightKg - entry.largePanCount * 0.4);
    return {
      storeId: input.storeId,
      businessDate: input.businessDate,
      flavor: entry.flavor.trim(),
      shiftType: "closing" as const,
      smallPanCount: entry.smallPanCount,
      smallGrossWeightKg: resolved.smallGrossWeightKg.toFixed(2),
      largePanCount: entry.largePanCount,
      largeGrossWeightKg: resolved.largeGrossWeightKg.toFixed(2),
      weightKg: netWeightKg.toFixed(2),
      submittedByUserId: input.submittedByUserId,
    };
  });
  if (!values.length) throw new Error("No historical weights were supplied.");
  const ids: number[] = [];
  for (const value of values) {
    const result = await tx.insert(readyMadeGelatoWeights).values(value);
    const id = Number(result[0]?.insertId ?? 0);
    if (id > 0) ids.push(id);
  }
  if (ids.length !== values.length) throw new Error("Historical weight readback could not identify every inserted row.");
  return ids;
}

async function insertAudit(tx: any, input: RetroactiveClosingInput, submissionType: "closing" | "inventory", payload: Record<string, unknown>) {
  const values: InsertSubmissionHistoryEntry = {
    storeId: input.storeId,
    businessDate: input.businessDate,
    submissionType,
    staffName: input.staffName.trim(),
    payloadJson: JSON.stringify(payload),
    submittedByUserId: input.submittedByUserId,
  };
  const result = await tx.insert(submissionHistoryEntries).values(values);
  return Number(result[0]?.insertId ?? 0);
}
