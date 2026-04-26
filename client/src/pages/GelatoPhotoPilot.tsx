import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { ArrowRight, Camera, House, LoaderCircle, LogOut, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { READY_MADE_GELATO_FLAVORS } from "../../../shared/opsCatalog";

type ShiftType = "opening" | "closing";

type ExtractedPhoto = {
  fileName: string;
  imageUrl: string;
  flavor: string;
  panSize: "small" | "large" | "unknown";
  grossWeightKg: number;
  confidence: "high" | "medium" | "low";
  warning: string;
};

type DraftEntry = {
  id: string;
  flavor: string;
  smallPanCount: number;
  smallGrossWeightKg: number;
  largePanCount: number;
  largeGrossWeightKg: number;
};

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function newDraftEntry(): DraftEntry {
  return {
    id: crypto.randomUUID(),
    flavor: "",
    smallPanCount: 0,
    smallGrossWeightKg: 0,
    largePanCount: 0,
    largeGrossWeightKg: 0,
  };
}

function inputClassName() {
  return "h-12 rounded-2xl border border-[#dbd2c5] bg-[#fcfaf6] px-4 text-sm text-[#2f2a26] shadow-sm outline-none transition focus:border-[#5b5045] focus:ring-4 focus:ring-[#5b5045]/10";
}

function numberOrZero(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function confidenceClassName(confidence: ExtractedPhoto["confidence"]) {
  if (confidence === "high") return "bg-[#dbe9df] text-[#244233]";
  if (confidence === "medium") return "bg-[#f4e6c9] text-[#6c4f1f]";
  return "bg-[#f7d8d2] text-[#7c3428]";
}

export default function GelatoPhotoPilot() {
  const { logout } = useAuth({ redirectOnUnauthenticated: true, redirectPath: "/staff-login" });
  const [shiftType, setShiftType] = useState<ShiftType>("opening");
  const [businessDate, setBusinessDate] = useState(todayValue());
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [extractedPhotos, setExtractedPhotos] = useState<ExtractedPhoto[]>([]);
  const [draftEntries, setDraftEntries] = useState<DraftEntry[]>([]);

  const extractMutation = trpc.forms.extractGelatoPhotos.useMutation({
    onSuccess: result => {
      setExtractedPhotos(result.extractedPhotos);
      setDraftEntries(
        result.groupedEntries.map(entry => ({
          id: crypto.randomUUID(),
          flavor: entry.flavor,
          smallPanCount: entry.smallPanCount,
          smallGrossWeightKg: entry.smallGrossWeightKg,
          largePanCount: entry.largePanCount,
          largeGrossWeightKg: entry.largeGrossWeightKg,
        }))
      );
      toast.success("Photo pilot values are ready for review.");
    },
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

  const usableEntryCount = useMemo(
    () => draftEntries.filter(entry => entry.flavor.trim().length > 0).length,
    [draftEntries]
  );

  async function handleAnalyze() {
    if (selectedFiles.length === 0) {
      toast.error("Add at least one scale photo before running the pilot.");
      return;
    }

    const photos = await Promise.all(
      selectedFiles.map(async file => ({
        fileName: file.name,
        mimeType: file.type || "image/jpeg",
        dataUrl: await readFileAsDataUrl(file),
      }))
    );

    extractMutation.mutate({ shiftType, photos });
  }

  async function handleSave() {
    const cleanedEntries = draftEntries
      .map(entry => ({
        flavor: entry.flavor.trim(),
        smallPanCount: entry.smallPanCount,
        smallGrossWeightKg: entry.smallGrossWeightKg,
        largePanCount: entry.largePanCount,
        largeGrossWeightKg: entry.largeGrossWeightKg,
      }))
      .filter(
        entry =>
          entry.flavor.length > 0 &&
          (entry.smallPanCount > 0 || entry.largePanCount > 0 || entry.smallGrossWeightKg > 0 || entry.largeGrossWeightKg > 0)
      );

    if (cleanedEntries.length === 0) {
      toast.error("Review at least one extracted flavor before saving.");
      return;
    }

    await saveMutation.mutateAsync({
      businessDate,
      shiftType,
      notifyOwner: false,
      entries: cleanedEntries,
    });
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f7f1e8_0%,_#f3ece2_50%,_#f7f2ea_100%)] text-[#2d2925]">
      <div className="container py-8 md:py-10">
        <div className="rounded-[2.4rem] border border-white/70 bg-white/82 p-6 shadow-[0_26px_90px_rgba(95,84,69,0.10)] backdrop-blur md:p-8 lg:p-10">
          <div className="flex flex-col gap-5 border-b border-[#e8ddd0] pb-6 md:flex-row md:items-start md:justify-between">
            <div className="max-w-3xl">
              <p className="text-[11px] uppercase tracking-[0.34em] text-[#7d756b]">PHOTO-ASSISTED GELATO PILOT</p>
              <h1 className="mt-4 text-4xl font-light tracking-[-0.06em] text-[#2b2622] md:text-5xl">
                Upload scale photos, verify the extraction, then save the confirmed gelato weights.
              </h1>
              <p className="mt-4 text-base leading-8 text-[#625b53] md:text-lg">
                This pilot is separate from the current manual workflow. Staff can test whether photo-based extraction makes opening and closing gelato counts easier without replacing the existing forms yet.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/portal" className="inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white px-5 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-[#faf5ec]">
                <House className="h-4 w-4" />
                Portal home
              </Link>
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white px-5 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-[#faf5ec]"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </div>

          <div className="mt-8 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <section className="rounded-[2rem] border border-[#e7ddd1] bg-[#fbf7f1] p-6 shadow-sm">
              <div className="flex items-center gap-3 text-[#5d544a]">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#ece4d7]">
                  <Camera className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-2xl font-medium tracking-[-0.04em] text-[#2d2925]">Pilot setup</h2>
                  <p className="mt-1 text-sm leading-7 text-[#655d55]">
                    Upload one pan-on-scale photo per image. Make sure the flavor label, scale digits, and pan size are all visible before running extraction.
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
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
                    onChange={event => setBusinessDate(event.target.value)}
                    className={inputClassName()}
                  />
                </label>
              </div>

              <label className="mt-6 flex flex-col gap-2 text-sm font-medium text-[#453f39]">
                Scale photos
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={event => setSelectedFiles(Array.from(event.target.files ?? []))}
                  className="rounded-2xl border border-dashed border-[#d7cec0] bg-white px-4 py-4 text-sm text-[#4b443d] file:mr-4 file:rounded-full file:border-0 file:bg-[#2f2a26] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#1f1b18]"
                />
              </label>

              <div className="mt-4 rounded-[1.5rem] border border-[#e6dccf] bg-white/90 p-4 text-sm leading-7 text-[#635a51]">
                <p>
                  The pilot saves only the values you verify here. It does not auto-submit anything from the photos, and your team can still use the current opening or closing form while testing this upload workflow.
                </p>
                {selectedFiles.length > 0 ? (
                  <p className="mt-2 text-xs uppercase tracking-[0.28em] text-[#8a8176]">
                    {selectedFiles.length} photo{selectedFiles.length === 1 ? "" : "s"} selected
                  </p>
                ) : null}
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={extractMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-full bg-[#2f2a26] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {extractMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {extractMutation.isPending ? "Analyzing photos..." : "Analyze uploaded photos"}
                </button>
                <Link
                  href={shiftType === "opening" ? "/portal/opening" : "/portal/closing"}
                  className="inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white px-5 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-[#faf5ec]"
                >
                  Continue to the {shiftType} form
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </section>

            <section className="rounded-[2rem] border border-[#e7ddd1] bg-[#faf6ef] p-6 shadow-sm">
              <h2 className="text-2xl font-medium tracking-[-0.04em] text-[#2d2925]">What to expect</h2>
              <div className="mt-5 grid gap-4">
                {[
                  "The pilot reads one photo at a time and estimates the flavor, pan size, and gross weight in kilograms.",
                  "Every extracted value stays editable before it becomes official inventory data.",
                  "Warnings and confidence labels help staff spot blurry or uncertain reads before saving.",
                  "The goal is to reduce typing mistakes, not to remove employee review.",
                ].map(item => (
                  <div key={item} className="rounded-[1.4rem] border border-[#e6dccf] bg-white/92 p-4 text-sm leading-7 text-[#645c53] shadow-sm">
                    {item}
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="mt-8 rounded-[2rem] border border-[#e7ddd1] bg-[#fbf7f1] p-6 shadow-sm">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-2xl font-medium tracking-[-0.04em] text-[#2d2925]">Photo-by-photo extraction</h2>
                <p className="mt-2 text-sm leading-7 text-[#655d55]">
                  Review the raw photo reads first. Low-confidence items or unknown pan sizes should be corrected in the editable verification table below.
                </p>
              </div>
            </div>

            {extractedPhotos.length === 0 ? (
              <div className="mt-6 rounded-[1.5rem] border border-dashed border-[#d8cfbf] bg-white/85 p-6 text-sm leading-7 text-[#6d645a]">
                No photos have been analyzed yet. Upload at least one image and run the pilot to populate this review area.
              </div>
            ) : (
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {extractedPhotos.map(photo => (
                  <article key={`${photo.fileName}-${photo.imageUrl}`} className="rounded-[1.5rem] border border-[#e6dccf] bg-white/94 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-[#2f2a26]">{photo.fileName}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.24em] text-[#8a8176]">{shiftType} pilot image</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] ${confidenceClassName(photo.confidence)}`}>
                        {photo.confidence}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-3 text-sm text-[#4f473f] md:grid-cols-3">
                      <div className="rounded-2xl bg-[#faf3e9] px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.24em] text-[#8a8176]">Flavor</p>
                        <p className="mt-2 font-medium text-[#2f2a26]">{photo.flavor}</p>
                      </div>
                      <div className="rounded-2xl bg-[#faf3e9] px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.24em] text-[#8a8176]">Pan size</p>
                        <p className="mt-2 font-medium capitalize text-[#2f2a26]">{photo.panSize}</p>
                      </div>
                      <div className="rounded-2xl bg-[#faf3e9] px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.24em] text-[#8a8176]">Gross weight</p>
                        <p className="mt-2 font-medium text-[#2f2a26]">{photo.grossWeightKg.toFixed(3)} kg</p>
                      </div>
                    </div>
                    {photo.warning ? (
                      <p className="mt-4 rounded-2xl border border-[#efd7cf] bg-[#fff5f1] px-4 py-3 text-sm leading-7 text-[#7c3428]">
                        {photo.warning}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="mt-8 rounded-[2rem] border border-[#e7ddd1] bg-[#fbf7f1] p-6 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-2xl font-medium tracking-[-0.04em] text-[#2d2925]">Verification table</h2>
                <p className="mt-2 text-sm leading-7 text-[#655d55]">
                  This is the editable version that becomes the official saved data. Adjust any flavor names, pan counts, or weights here before you save the pilot result.
                </p>
              </div>
              <div className="rounded-full border border-[#e1d7ca] bg-white px-4 py-2 text-sm font-medium text-[#50473f] shadow-sm">
                {usableEntryCount} verified flavor row{usableEntryCount === 1 ? "" : "s"}
              </div>
            </div>

            <datalist id="pilot-flavor-options">
              {READY_MADE_GELATO_FLAVORS.map(flavor => (
                <option key={flavor} value={flavor} />
              ))}
            </datalist>

            <div className="mt-6 grid gap-4">
              {draftEntries.length === 0 ? (
                <div className="rounded-[1.5rem] border border-dashed border-[#d8cfbf] bg-white/85 p-6 text-sm leading-7 text-[#6d645a]">
                  Once the photos are analyzed, the grouped flavor rows will appear here for confirmation.
                </div>
              ) : (
                draftEntries.map(entry => (
                  <div key={entry.id} className="rounded-[1.5rem] border border-[#e6dccf] bg-white/94 p-4 shadow-sm">
                    <div className="grid gap-4 lg:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))_auto]">
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
                        Small pans
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={entry.smallPanCount}
                          onChange={event =>
                            setDraftEntries(current =>
                              current.map(item =>
                                item.id === entry.id
                                  ? { ...item, smallPanCount: numberOrZero(event.target.value) }
                                  : item
                              )
                            )
                          }
                          className={inputClassName()}
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-sm font-medium text-[#453f39]">
                        Small kg
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          inputMode="decimal"
                          value={entry.smallGrossWeightKg}
                          onChange={event =>
                            setDraftEntries(current =>
                              current.map(item =>
                                item.id === entry.id
                                  ? { ...item, smallGrossWeightKg: numberOrZero(event.target.value) }
                                  : item
                              )
                            )
                          }
                          className={inputClassName()}
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-sm font-medium text-[#453f39]">
                        Large pans
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={entry.largePanCount}
                          onChange={event =>
                            setDraftEntries(current =>
                              current.map(item =>
                                item.id === entry.id
                                  ? { ...item, largePanCount: numberOrZero(event.target.value) }
                                  : item
                              )
                            )
                          }
                          className={inputClassName()}
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-sm font-medium text-[#453f39]">
                        Large kg
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          inputMode="decimal"
                          value={entry.largeGrossWeightKg}
                          onChange={event =>
                            setDraftEntries(current =>
                              current.map(item =>
                                item.id === entry.id
                                  ? { ...item, largeGrossWeightKg: numberOrZero(event.target.value) }
                                  : item
                              )
                            )
                          }
                          className={inputClassName()}
                        />
                      </label>
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() =>
                            setDraftEntries(current => current.filter(item => item.id !== entry.id))
                          }
                          className="h-12 rounded-full border border-[#ddd4c8] bg-white px-4 text-sm font-medium text-[#2f2a26] transition hover:bg-[#faf5ec]"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setDraftEntries(current => [...current, newDraftEntry()])}
                className="inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white px-5 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-[#faf5ec]"
              >
                Add flavor row
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="inline-flex items-center gap-2 rounded-full bg-[#52665f] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#41534d] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saveMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {saveMutation.isPending ? "Saving verified weights..." : `Save verified ${shiftType} gelato weights`}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
