/** Shared labels only. Never converts photos into physical counts or sales. */
export const CUP_SIZE_KEYS = ["chico", "mediano", "pint", "litro", "unknown"] as const;
export type CupSize = typeof CUP_SIZE_KEYS[number];
export const CUP_SIZE_LABELS: Record<CupSize, string> = {
  chico: "Chico (4 oz)", mediano: "Mediano (8 oz)", pint: "Pint", litro: "Litro", unknown: "Sin clasificar",
};
export const MANUAL_CUP_SIZE_LABELS: Record<string, string> = {
  "4oz": CUP_SIZE_LABELS.chico, "8oz": CUP_SIZE_LABELS.mediano,
  Pint: CUP_SIZE_LABELS.pint, Liter: CUP_SIZE_LABELS.litro,
};
export const CUP_DESCRIPTION_LIMIT = 8;
export type CupDescription = { slot: number; size: CupSize; note: string };
export type CupDescriptionView = CupDescription & { source: "manual" | "ai_suggestion" | "ai_estimate" | "unknown" };
export const CUP_NOTES_PREFIX = "OJALA_CUP_DESCRIPTIONS_V1\n";
export type CupDescriptionEnvelope = {
  kind: "ojala_cup_descriptions"; version: 1; notes: string;
  items: CupDescription[]; updatedAt: string; updatedByUserId: number;
};
export function isCupSize(value: unknown): value is CupSize {
  return typeof value === "string" && (CUP_SIZE_KEYS as readonly string[]).includes(value);
}
export function validateCupDescriptions(value: unknown): CupDescription[] {
  if (!Array.isArray(value) || value.length > CUP_DESCRIPTION_LIMIT) throw new Error("Invalid cup descriptions");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid cup description");
    const item = entry as Record<string, unknown>;
    if (item.slot !== index + 1 || !isCupSize(item.size) || typeof item.note !== "string" || item.note.length > 160) {
      throw new Error("Invalid cup description");
    }
    return { slot: index + 1, size: item.size, note: item.note.trim() };
  });
}
export function parseCupReviewNotes(raw: string | null | undefined) {
  const original = raw ?? "";
  if (!original.startsWith(CUP_NOTES_PREFIX)) return { notes: original, annotation: null, malformed: false };
  try {
    if (original.length > 16000) throw new Error("oversize");
    const x = JSON.parse(original.slice(CUP_NOTES_PREFIX.length)) as CupDescriptionEnvelope;
    if (x.kind !== "ojala_cup_descriptions" || x.version !== 1 || typeof x.notes !== "string"
      || x.notes.length > 4000 || !Number.isSafeInteger(x.updatedByUserId) || x.updatedByUserId <= 0
      || typeof x.updatedAt !== "string" || !/Z$|[+-]\d\d:\d\d$/.test(x.updatedAt) || !Number.isFinite(Date.parse(x.updatedAt))) {
      throw new Error("Invalid annotation metadata");
    }
    const annotation: CupDescriptionEnvelope = { ...x, items: validateCupDescriptions(x.items) };
    return { notes: annotation.notes, annotation, malformed: false };
  } catch { return { notes: original, annotation: null, malformed: true }; }
}
export function encodeCupReviewNotes(notes: string, items: CupDescription[], userId: number, at: string) {
  const raw = CUP_NOTES_PREFIX + JSON.stringify({ kind: "ojala_cup_descriptions", version: 1, notes,
    items: validateCupDescriptions(items), updatedAt: at, updatedByUserId: userId });
  if (parseCupReviewNotes(raw).malformed) throw new Error("Invalid cup review envelope");
  return raw;
}
export function preserveDescriptionsWithNote(raw: string | null | undefined, note: string) {
  if (note.startsWith(CUP_NOTES_PREFIX)) throw new Error("Reserved review note prefix");
  const old = parseCupReviewNotes(raw);
  if (old.malformed) throw new Error("Stored cup descriptions need review");
  if (!old.annotation) return note;
  return encodeCupReviewNotes(note, old.annotation.items, old.annotation.updatedByUserId, old.annotation.updatedAt);
}
/** Printed capacity and high confidence are required: pixel size is not capacity. */
export function normalizeCameraCupDescriptions(raw: unknown, visibleCount: number): CupDescriptionView[] {
  const n = Number.isInteger(visibleCount) && visibleCount >= 0 && visibleCount <= CUP_DESCRIPTION_LIMIT ? visibleCount : 0;
  const entries = Array.isArray(raw) && raw.length === n ? raw : [];
  return Array.from({ length: n }, (_, index) => {
    const item = entries[index] as Record<string, unknown> | undefined;
    const supported = item && isCupSize(item.size) && item.size !== "unknown" && item.confidence === "high"
      && item.basis === "printed_capacity" && typeof item.reason === "string" && item.reason.trim().length > 0;
    return { slot: index + 1, size: supported ? item.size as CupSize : "unknown",
      note: supported ? String(item.reason).trim().slice(0, 160) : "",
      source: supported ? "ai_suggestion" : "unknown" };
  });
}
export function describeCameraCups(input: { reviewNotes?: string | null; analysisEvidenceJson?: string | null; visibleCupCount?: number }) {
  const stored = parseCupReviewNotes(input.reviewNotes);
  if (stored.annotation) return stored.annotation.items.map(item => ({ ...item, source: "manual" as const }));
  let evidence: Record<string, unknown> = {};
  try { evidence = JSON.parse(input.analysisEvidenceJson || "{}"); } catch { /* old evidence remains unclassified */ }
  // Stored AI suggestions already passed the conservative model-result validator.
  const n = Number.isInteger(input.visibleCupCount) && input.visibleCupCount! >= 0 && input.visibleCupCount! <= CUP_DESCRIPTION_LIMIT ? input.visibleCupCount! : 0;
  const rows = Array.isArray(evidence?.cupDescriptions) && evidence.cupDescriptions.length === n ? evidence.cupDescriptions : [];
  return Array.from({ length: n }, (_, index): CupDescriptionView => {
    const r = rows[index];
    const supported = r && r.slot === index + 1 && isCupSize(r.size) && r.source === "ai_suggestion";
    return { slot: index + 1, size: supported ? r.size : "unknown", source: supported ? "ai_suggestion" : "unknown",
      note: supported && typeof r.note === "string" ? r.note.slice(0, 160) : "" };
  });
}
export function manualCupRows(cups: Record<string, number> | undefined, reportCount: number) {
  return Object.entries(MANUAL_CUP_SIZE_LABELS).map(([key, label]) => ({ key, label,
    count: reportCount > 0 && Number.isSafeInteger(cups?.[key]) && cups![key] >= 0 ? cups![key] : null }));
}
