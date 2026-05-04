import { useAuth } from "@/_core/hooks/useAuth";
import { compressImageFileToDataUrl } from "@/lib/imageCompression";
import { clearPortalDraft, loadPortalDraft, savePortalDraft } from "@/lib/portalDrafts";
import { getPacificBusinessDate } from "../../../shared/businessDate";
import { trpc } from "@/lib/trpc";
import { ArrowRight, House, LoaderCircle, LogOut, Save, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { READY_MADE_GELATO_FLAVORS } from "../../../shared/opsCatalog";

type ShiftType = "opening" | "closing";
type PanSetup = "small" | "large" | "small_large" | "double_small" | "double_large" | "needs_review";
type PilotDraftView = "pilot-opening" | "pilot-closing";

type ExtractedPhoto = {
  fileName: string;
  imageUrl: string;
  imageKey?: string;
  flavor: string;
  smallPanCount: number;
  largePanCount: number;
  combinedGrossWeightKg: number;
  confidence: "high" | "medium" | "low";
  warning: string;
};

type DraftEntry = {
  id: string;
  fileName: string;
  imageUrl: string;
  flavor: string;
  smallPanCount: number;
  largePanCount: number;
  combinedGrossWeightKgInput: string;
  confidence: ExtractedPhoto["confidence"];
  warning: string;
};

type PilotDraftEntry = Omit<DraftEntry, "id" | "imageUrl">;

type PilotDraft = {
  entries: PilotDraftEntry[];
};

const KG_TO_WEIGHT_OUNCES = 35.27396195;
const SMALL_PAN_EMPTY_KG = 0.286;
const LARGE_PAN_EMPTY_KG = 0.4;
const SMALL_PAN_FULL_WEIGHT_OUNCES = (1.9 - SMALL_PAN_EMPTY_KG) * KG_TO_WEIGHT_OUNCES;
const LARGE_PAN_FULL_WEIGHT_OUNCES = (4.3 - LARGE_PAN_EMPTY_KG) * KG_TO_WEIGHT_OUNCES;
const SMALL_PAN_FULL_VOLUME_OUNCES = 112;
const LARGE_PAN_FULL_VOLUME_OUNCES = 160;

function todayValue() {
  return getPacificBusinessDate();
}

function roundTo(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function newDraftEntry(): DraftEntry {
  return {
    id: crypto.randomUUID(),
    fileName: "Manual entry",
    imageUrl: "",
    flavor: "",
    smallPanCount: 0,
    largePanCount: 0,
    combinedGrossWeightKgInput: "",
    confidence: "medium",
    warning: "",
  };
}

export function buildDraftEntry(photo: ExtractedPhoto): DraftEntry {
  return {
    id: crypto.randomUUID(),
    fileName: photo.fileName,
    imageUrl: photo.imageUrl,
    flavor: photo.flavor,
    smallPanCount: photo.smallPanCount,
    largePanCount: photo.largePanCount,
    combinedGrossWeightKgInput:
      photo.combinedGrossWeightKg > 0 ? String(roundTo(photo.combinedGrossWeightKg, 3)) : "",
    confidence: photo.confidence,
    warning: photo.warning,
  };
}

export function getPanSetup(entry: Pick<DraftEntry, "smallPanCount" | "largePanCount">): PanSetup {
  if (entry.smallPanCount > 0 && entry.largePanCount > 0) return "small_large";
  if (entry.smallPanCount >= 2) return "double_small";
  if (entry.largePanCount >= 2) return "double_large";
  if (entry.smallPanCount > 0) return "small";
  if (entry.largePanCount > 0) return "large";
  return "needs_review";
}

function panSetupLabel(entry: Pick<DraftEntry, "smallPanCount" | "largePanCount">) {
  const setup = getPanSetup(entry);
  if (setup === "small_large") return "Small + large";
  if (setup === "double_small") return "Two small pans";
  if (setup === "double_large") return "Two large pans";
  if (setup === "small") return "Small pan";
  if (setup === "large") return "Large pan";
  return "Needs review";
}

export function applyPanSetup(setup: PanSetup) {
  if (setup === "small") {
    return { smallPanCount: 1, largePanCount: 0 };
  }
  if (setup === "large") {
    return { smallPanCount: 0, largePanCount: 1 };
  }
  if (setup === "small_large") {
    return { smallPanCount: 1, largePanCount: 1 };
  }
  if (setup === "double_small") {
    return { smallPanCount: 2, largePanCount: 0 };
  }
  if (setup === "double_large") {
    return { smallPanCount: 0, largePanCount: 2 };
  }
  return { smallPanCount: 0, largePanCount: 0 };
}

function inputClassName() {
  return "h-12 rounded-2xl border border-[#dbd2c5] bg-[#fcfaf6] px-4 text-sm text-[#2f2a26] shadow-sm outline-none transition focus:border-[#5b5045] focus:ring-4 focus:ring-[#5b5045]/10";
}

function confidenceClassName(confidence: ExtractedPhoto["confidence"]) {
  if (confidence === "high") return "bg-[#dbe9df] text-[#244233]";
  if (confidence === "medium") return "bg-[#f4e6c9] text-[#6c4f1f]";
  return "bg-[#f7d8d2] text-[#7c3428]";
}

export function getCombinedGrossWeightKg(entry: { combinedGrossWeightKgInput: string | number }) {
  const rawValue = entry.combinedGrossWeightKgInput;

  if (typeof rawValue === "number") {
    return Number.isFinite(rawValue) && rawValue >= 0 ? rawValue : 0;
  }

  const trimmedValue = rawValue.trim();
  if (!trimmedValue) return 0;

  const parsed = Number(trimmedValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function isDraftEntryReady(
  entry: Pick<DraftEntry, "flavor" | "smallPanCount" | "largePanCount" | "combinedGrossWeightKgInput">
) {
  return (
    entry.flavor.trim().length > 0 &&
    (entry.smallPanCount > 0 || entry.largePanCount > 0) &&
    getCombinedGrossWeightKg(entry) > 0
  );
}

export function estimateVolumeOunces(
  entry: Pick<DraftEntry, "smallPanCount" | "largePanCount" | "combinedGrossWeightKgInput">
) {
  const smallPanCount = Math.max(0, Math.trunc(entry.smallPanCount));
  const largePanCount = Math.max(0, Math.trunc(entry.largePanCount));
  const combinedGrossWeightKg = getCombinedGrossWeightKg(entry);

  if (combinedGrossWeightKg <= 0 || (smallPanCount <= 0 && largePanCount <= 0)) {
    return 0;
  }

  const totalNetWeightKg = Math.max(
    0,
    combinedGrossWeightKg - smallPanCount * SMALL_PAN_EMPTY_KG - largePanCount * LARGE_PAN_EMPTY_KG
  );

  const smallCapacityWeightKg = smallPanCount * (SMALL_PAN_FULL_WEIGHT_OUNCES / KG_TO_WEIGHT_OUNCES);
  const largeCapacityWeightKg = largePanCount * (LARGE_PAN_FULL_WEIGHT_OUNCES / KG_TO_WEIGHT_OUNCES);
  const totalCapacityWeightKg = smallCapacityWeightKg + largeCapacityWeightKg;

  const smallNetWeightKg =
    totalCapacityWeightKg > 0 ? totalNetWeightKg * (smallCapacityWeightKg / totalCapacityWeightKg) : 0;
  const largeNetWeightKg = Math.max(0, totalNetWeightKg - smallNetWeightKg);

  const smallWeightOunces = smallNetWeightKg * KG_TO_WEIGHT_OUNCES;
  const largeWeightOunces = largeNetWeightKg * KG_TO_WEIGHT_OUNCES;

  return roundTo(
    smallWeightOunces * (SMALL_PAN_FULL_VOLUME_OUNCES / SMALL_PAN_FULL_WEIGHT_OUNCES) +
      largeWeightOunces * (LARGE_PAN_FULL_VOLUME_OUNCES / LARGE_PAN_FULL_WEIGHT_OUNCES)
  );
}

export function appendExtractedDraftEntries(current: DraftEntry[], photos: ExtractedPhoto[]) {
  return [...current, ...photos.map(buildDraftEntry)];
}

export function serializePilotDraftEntries(entries: DraftEntry[]): PilotDraftEntry[] {
  return entries.map(({ id: _id, imageUrl: _imageUrl, ...entry }) => ({ ...entry }));
}

export function restorePilotDraftEntries(entries: PilotDraftEntry[]) {
  return entries.map(entry => ({
    ...entry,
    id: crypto.randomUUID(),
    imageUrl: "",
  }));
}

function getPilotDraftView(shiftType: ShiftType): PilotDraftView {
  return shiftType === "opening" ? "pilot-opening" : "pilot-closing";
}

export default function GelatoPhotoPilot() {
  const { logout } = useAuth({ redirectOnUnauthenticated: true, redirectPath: "/staff-login" });
  const [shiftType, setShiftType] = useState<ShiftType>("opening");
  const [businessDate, setBusinessDate] = useState(todayValue());
  const maxBusinessDate = todayValue();
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [draftEntries, setDraftEntries] = useState<DraftEntry[]>([]);
  const [draftSavedAt, setDraftSavedAt] = useState<number | undefined>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const restoredDraftKeyRef = useRef<string | null>(null);

  const draftView = getPilotDraftView(shiftType);
  const draftRestoreKey = `${draftView}:${businessDate}`;

  const extractMutation = trpc.forms.extractGelatoPhotos.useMutation({
    onError: error => {
      toast.error(error.message || "The photos could not be analyzed.");
    },
  });

  const saveMutation = trpc.forms.submitReadyMadeGelato.useMutation({
    onSuccess: () => {
      toast.success(`Verified ${shiftType} gelato entries saved.`);
    },
    onError: error => {
      toast.error(error.message || "The verified gelato entries could not be saved.");
    },
  });

  useEffect(() => {
    if (businessDate > maxBusinessDate) {
      setBusinessDate(maxBusinessDate);
      return;
    }

    if (restoredDraftKeyRef.current === draftRestoreKey) return;
    restoredDraftKeyRef.current = draftRestoreKey;

    const draft = loadPortalDraft<PilotDraft>(draftView, businessDate);
    if (!draft) {
      setDraftSavedAt(undefined);
      setDraftEntries([]);
      return;
    }

    setDraftEntries(restorePilotDraftEntries(draft.data.entries ?? []));
    setSelectedFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setDraftSavedAt(draft.savedAt);
    toast.success(`Saved ${shiftType} photo pilot draft restored.`);
  }, [businessDate, draftRestoreKey, draftView, maxBusinessDate, shiftType]);

  const usableEntryCount = useMemo(
    () => draftEntries.filter(entry => isDraftEntryReady(entry)).length,
    [draftEntries]
  );

  async function handleAnalyze() {
    if (selectedFiles.length === 0) {
      toast.error("Add at least one scale photo before running the pilot.");
      return;
    }

    try {
      const photos = await Promise.all(
        selectedFiles.map(async file => ({
          fileName: file.name,
          mimeType: "image/jpeg",
          dataUrl: await compressImageFileToDataUrl(file),
        }))
      );

      const result = await extractMutation.mutateAsync({ shiftType, photos });
      const nextDrafts = result.extractedPhotos.map(buildDraftEntry);

      setDraftEntries(current => appendExtractedDraftEntries(current, result.extractedPhotos));
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      toast.success(
        `Added ${nextDrafts.length} analyzed photo${nextDrafts.length === 1 ? "" : "s"} below for review.`
      );
    } catch {
      // Handled in mutation callbacks.
    }
  }

  function handleSaveProgress() {
    const serializableEntries = serializePilotDraftEntries(draftEntries);

    if (serializableEntries.length === 0) {
      toast.error("Add or analyze at least one row before saving progress.");
      return;
    }

    const savedDraft = savePortalDraft<PilotDraft>(draftView, businessDate, {
      entries: serializableEntries,
    });

    if (!savedDraft) return;

    setDraftSavedAt(savedDraft.savedAt);
    toast.success(`${shiftType === "opening" ? "Opening" : "Closing"} photo pilot draft saved.`);
  }

  async function handleSubmit() {
    const cleanedEntries = draftEntries
      .map(entry => ({
        flavor: entry.flavor.trim(),
        smallPanCount: entry.smallPanCount,
        largePanCount: entry.largePanCount,
        combinedGrossWeightKg: getCombinedGrossWeightKg(entry),
      }))
      .filter(
        entry =>
          entry.flavor.length > 0 &&
          (entry.smallPanCount > 0 || entry.largePanCount > 0) &&
          entry.combinedGrossWeightKg > 0
      );

    if (cleanedEntries.length === 0) {
      toast.error("Review at least one analyzed photo before saving.");
      return;
    }

    await saveMutation.mutateAsync({
      businessDate,
      shiftType,
      notifyOwner: false,
      entries: cleanedEntries,
    });

    clearPortalDraft(draftView);
    setDraftSavedAt(undefined);
    setDraftEntries([]);
    setSelectedFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <div className="min-h-screen bg-[#f6f1e8] text-[#2d2925]">
      <div className="container py-5 md:py-8">
        <div className="mx-auto max-w-6xl space-y-4 md:space-y-6">
          <section className="rounded-[2rem] border border-[#e7ddd1] bg-white p-5 shadow-sm md:p-7">
            <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
              <div className="max-w-3xl">
                <p className="text-[11px] uppercase tracking-[0.34em] text-[#7d756b]">PHOTO-ASSISTED GELATO PILOT</p>
                <h1 className="mt-3 text-3xl font-light tracking-[-0.06em] text-[#2b2622] md:text-5xl">
                  Analyze gelato scale photos, review the results, then submit when everything looks right.
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-[#625b53] md:text-base">
                  Each time you tap Analyze, the new photos are added below as editable rows. Staff can save progress,
                  come back later on the same device, and only submit once the flavor, pan setup, and estimated volume
                  ounces all look right.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row md:flex-col lg:flex-row">
                <Link
                  href="/portal"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-[#ddd4c8] bg-white px-5 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-[#faf5ec]"
                >
                  <House className="h-4 w-4" />
                  Portal home
                </Link>
                <button
                  type="button"
                  onClick={logout}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-[#ddd4c8] bg-white px-5 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-[#faf5ec]"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-[#e7ddd1] bg-white p-5 shadow-sm md:p-7">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-medium text-[#453f39]">
                  Shift
                  <select
                    value={shiftType}
                    onChange={event => setShiftType(event.target.value as ShiftType)}
                    className={inputClassName()}
                  >
                    <option value="opening">Opening</option>
                    <option value="closing">Closing</option>
                  </select>
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium text-[#453f39]">
                  Business date
                  <input
                    type="date"
                    value={businessDate}
                    max={maxBusinessDate}
                    onChange={event => setBusinessDate(event.target.value > maxBusinessDate ? maxBusinessDate : event.target.value)}
                    className={inputClassName()}
                  />
                </label>
              </div>
              <Link
                href={shiftType === "opening" ? "/portal/opening" : "/portal/closing"}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-[#ddd4c8] bg-[#fcfaf6] px-5 text-sm font-medium text-[#2f2a26] transition hover:bg-[#faf5ec]"
              >
                Continue to the {shiftType} form
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <label className="mt-5 flex flex-col gap-2 text-sm font-medium text-[#453f39]">
              Scale photos
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={event => setSelectedFiles(Array.from(event.target.files ?? []))}
                className="rounded-2xl border border-dashed border-[#d7cec0] bg-[#fcfaf6] px-4 py-4 text-sm text-[#4b443d] file:mr-4 file:rounded-full file:border-0 file:bg-[#2f2a26] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#1f1b18]"
              />
            </label>

            {selectedFiles.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {selectedFiles.map(file => (
                  <span
                    key={`${file.name}-${file.size}`}
                    className="rounded-full bg-[#f3ece2] px-3 py-2 text-xs font-medium text-[#5c544c]"
                  >
                    {file.name}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={extractMutation.isPending}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#2f2a26] px-5 text-sm font-medium text-white transition hover:bg-[#1f1b18] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {extractMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {extractMutation.isPending ? "Analyzing photos..." : "Analyze photos"}
              </button>
              <div className="flex min-h-12 items-center rounded-2xl bg-[#fcfaf6] px-4 text-sm leading-6 text-[#625b53]">
                Analyze adds new photo results below. Nothing is submitted until you use the final save-and-submit button.
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-[#e7ddd1] bg-white p-5 shadow-sm md:p-7">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-2xl font-medium tracking-[-0.04em] text-[#2d2925]">Reviewed photo entries</h2>
                <p className="mt-2 text-sm leading-7 text-[#655d55]">
                  Each analyzed photo becomes one editable row. Fix the flavor, pan setup, or kilograms if needed,
                  then save progress or submit everything together at the end.
                </p>
              </div>
              <div className="rounded-full bg-[#f3ece2] px-4 py-2 text-sm font-medium text-[#50473f]">
                {usableEntryCount} ready to save
              </div>
            </div>

            <datalist id="pilot-flavor-options">
              {READY_MADE_GELATO_FLAVORS.map(flavor => (
                <option key={flavor} value={flavor} />
              ))}
            </datalist>

            {draftEntries.length === 0 ? (
              <div className="mt-5 rounded-[1.5rem] border border-dashed border-[#d8cfbf] bg-[#fcfaf6] p-6 text-sm leading-7 text-[#6d645a]">
                No analyzed photos yet. Upload one or more scale images, tap Analyze, and the editable results will
                appear here.
              </div>
            ) : (
              <div className="mt-5 grid gap-4">
                {draftEntries.map(entry => {
                  const volumeOunces = estimateVolumeOunces(entry);
                  return (
                    <article key={entry.id} className="rounded-[1.5rem] border border-[#e6dccf] bg-[#fcfaf6] p-4">
                      <div className="grid gap-4 lg:grid-cols-[112px_minmax(0,1fr)]">
                        <div className="overflow-hidden rounded-[1.25rem] border border-[#e8ded2] bg-white">
                          {entry.imageUrl ? (
                            <img
                              src={entry.imageUrl}
                              alt={entry.fileName}
                              loading="lazy"
                              decoding="async"
                              className="h-full min-h-28 w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full min-h-28 items-center justify-center px-3 text-center text-xs font-medium uppercase tracking-[0.24em] text-[#8a8176]">
                              Saved draft row
                            </div>
                          )}
                        </div>

                        <div className="space-y-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-[#2f2a26]">{entry.fileName}</p>
                              <p className="mt-1 text-xs uppercase tracking-[0.24em] text-[#8a8176]">
                                Detected {panSetupLabel(entry)}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <span
                                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] ${confidenceClassName(entry.confidence)}`}
                              >
                                {entry.confidence}
                              </span>
                              {volumeOunces > 0 ? (
                                <span className="rounded-full bg-[#efe6d9] px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-[#5a5249]">
                                  {Math.round(volumeOunces)} oz
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto]">
                            <label className="flex flex-col gap-2 text-sm font-medium text-[#453f39]">
                              Flavor
                              <input
                                list="pilot-flavor-options"
                                value={entry.flavor}
                                onChange={event =>
                                  setDraftEntries(current =>
                                    current.map(item =>
                                      item.id === entry.id ? { ...item, flavor: event.target.value } : item
                                    )
                                  )
                                }
                                className={inputClassName()}
                                placeholder="Flavor name"
                              />
                            </label>

                            <label className="flex flex-col gap-2 text-sm font-medium text-[#453f39]">
                              Pan setup
                              <select
                                value={getPanSetup(entry)}
                                onChange={event => {
                                  const nextSetup = event.target.value as PanSetup;
                                  const nextCounts = applyPanSetup(nextSetup);
                                  setDraftEntries(current =>
                                    current.map(item =>
                                      item.id === entry.id ? { ...item, ...nextCounts } : item
                                    )
                                  );
                                }}
                                className={inputClassName()}
                              >
                                <option value="needs_review">Needs review</option>
                                <option value="small">Small pan</option>
                                <option value="large">Large pan</option>
                                <option value="double_small">Two small pans</option>
                                <option value="double_large">Two large pans</option>
                                <option value="small_large">Small + large</option>
                              </select>
                            </label>

                            <label className="flex flex-col gap-2 text-sm font-medium text-[#453f39]">
                              Combined kg
                              <input
                                type="number"
                                min="0"
                                step="0.001"
                                inputMode="decimal"
                                value={entry.combinedGrossWeightKgInput}
                                onChange={event =>
                                  setDraftEntries(current =>
                                    current.map(item =>
                                      item.id === entry.id
                                        ? { ...item, combinedGrossWeightKgInput: event.target.value }
                                        : item
                                    )
                                  )
                                }
                                className={inputClassName()}
                              />
                            </label>

                            <div className="flex flex-col justify-end gap-2">
                              <div className="flex h-12 items-center rounded-2xl bg-white px-4 text-sm font-medium text-[#2f2a26] shadow-sm">
                                {volumeOunces > 0 ? `${Math.round(volumeOunces)} volume oz` : "Volume pending"}
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setDraftEntries(current => current.filter(item => item.id !== entry.id))
                                }
                                className="h-10 rounded-full border border-[#ddd4c8] bg-white px-4 text-sm font-medium text-[#2f2a26] transition hover:bg-[#faf5ec]"
                              >
                                Remove
                              </button>
                            </div>
                          </div>

                          {entry.warning ? (
                            <p className="rounded-2xl border border-[#efd7cf] bg-[#fff5f1] px-4 py-3 text-sm leading-6 text-[#7c3428]">
                              {entry.warning}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            <div className="mt-5 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setDraftEntries(current => [...current, newDraftEntry()])}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-[#ddd4c8] bg-white px-5 text-sm font-medium text-[#2f2a26] transition hover:bg-[#faf5ec]"
              >
                Add manual row
              </button>

              <div className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={handleSaveProgress}
                  disabled={saveMutation.isPending || extractMutation.isPending}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-[#ddd4c8] bg-white px-5 text-sm font-medium text-[#2f2a26] transition hover:bg-[#faf5ec] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  Save progress
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={saveMutation.isPending || extractMutation.isPending}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#52665f] px-5 text-sm font-medium text-white transition hover:bg-[#41534d] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saveMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {saveMutation.isPending ? "Saving verified weights..." : `Save verified ${shiftType} gelato weights`}
                </button>
              </div>

              {draftSavedAt ? (
                <p className="text-xs text-[#7d756b]">Draft saved on this device for today.</p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
