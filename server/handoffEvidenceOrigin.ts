import type { NormalizedHandoffVisualAnalysis } from "./handoffVisualAnalysis";

export const HANDOFF_EVIDENCE_ORIGINS = [
  "verified_snapshot",
  "recording_extracted_frame",
] as const;

export type HandoffEvidenceOrigin = (typeof HANDOFF_EVIDENCE_ORIGINS)[number];

export function isRecordingExtractedFrame(origin: HandoffEvidenceOrigin) {
  return origin === "recording_extracted_frame";
}

/**
 * A frame extracted after the original Frigate detector missed a scene is
 * valuable review evidence, but it must never appear as an automatic Frigate
 * success. Preserve a model suggestion separately and require a manager to
 * decide any positive suggestion.
 */
export function applyEvidenceOriginPolicy(input: {
  origin: HandoffEvidenceOrigin;
  analysis: NormalizedHandoffVisualAnalysis;
}) {
  const aiSuggestedStatus = input.analysis.status;
  if (isRecordingExtractedFrame(input.origin) && input.analysis.status === "approved_by_ai") {
    return {
      analysis: {
        ...input.analysis,
        status: "pending_review" as const,
        reason: "AI found a person, gelato cup, and handoff zone in a recording-extracted frame. This is recovery evidence, not an automatic Frigate event; manager review is required.",
      },
      aiSuggestedStatus,
    };
  }

  return { analysis: input.analysis, aiSuggestedStatus };
}

export function handoffEvidenceOriginLabel(origin: HandoffEvidenceOrigin) {
  return origin === "recording_extracted_frame"
    ? "Recording-extracted frame — manual review only"
    : "Automatic verified snapshot";
}
