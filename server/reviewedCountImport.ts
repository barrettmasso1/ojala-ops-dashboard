import { createHash } from "node:crypto";
import { parseReviewedCountImport } from "../shared/reviewedCountImport";
import { getBusinessDate } from "../shared/businessDate";
import { normalizeFrigateEventAt } from "./frigateEventOrder";

export function prepareReviewedCountImport(text: string, actor: {
  storeId: number; userId: number; timezone: string;
}, now = new Date()) {
  const { record, recordJson } = parseReviewedCountImport(text);
  if (record.storeId !== actor.storeId) throw new Error("This count belongs to a different store");
  if (record.businessDate > getBusinessDate(now, actor.timezone)) throw new Error("Future business date");
  const approval = new Date(record.approvedAt);
  if (approval.getTime() > now.getTime() + 5 * 60_000
    || getBusinessDate(approval, actor.timezone) < record.businessDate) {
    throw new Error("Invalid approval timestamp");
  }
  const sourceEventAt = normalizeFrigateEventAt(approval.toISOString());
  if (!sourceEventAt) throw new Error("Invalid source timestamp");
  const recordSha256 = createHash("sha256").update(recordJson).digest("hex");
  const sourceEventId = `daily-reviewed-${record.businessDate}-${recordSha256.slice(0, 32)}`;
  const sourceDetail = JSON.stringify({
    basis: record.countBasis, recordSha256, coverage: record.coverage,
    gaps: (record.gapsDescription ?? "").slice(0, 500),
    ingestionMethod: "authenticated_admin_import", importedByUserId: actor.userId,
    importedAt: now.toISOString(), reviewedBy: record.reviewedBy,
    evidenceReferences: record.evidenceReferences,
  });
  if (Buffer.byteLength(sourceDetail, "utf8") > 60000) throw new Error("Evidence references exceed the storage limit");
  return {
    recordSha256,
    coverage: record.coverage,
    row: {
      storeId: actor.storeId,
      businessDate: record.businessDate,
      cameraName: record.cameraName,
      cupsDetected: record.cupsDetected,
      peopleEntries: 0,
      sourceEventId,
      sourceEventAt,
      sourceDetail,
    },
  };
}
