import { invokeLLM } from "./_core/llm";

export const HANDOFF_VISUAL_STATUSES = [
  "pending_review",
  "approved_by_ai",
  "discarded",
  "approved_by_manager",
  "discarded_by_manager",
] as const;

export type HandoffVisualStatus = (typeof HANDOFF_VISUAL_STATUSES)[number];
export type HandoffVisualConfidence = "high" | "medium" | "low";

export type HandoffVisualModelResult = {
  person_present: boolean;
  gelato_cup_present: boolean;
  cup_in_handoff_zone: boolean;
  visible_cup_count: number;
  confidence: HandoffVisualConfidence;
  ambiguous: boolean;
  discard_reason: string;
  review_reason: string;
};

export type NormalizedHandoffVisualAnalysis = {
  personPresent: boolean;
  gelatoCupPresent: boolean;
  cupInHandoffZone: boolean;
  visibleCupCount: number;
  confidence: HandoffVisualConfidence;
  status: Extract<HandoffVisualStatus, "pending_review" | "approved_by_ai" | "discarded">;
  reason: string;
};

const MAX_VISIBLE_CUPS = 8;

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 2_000) : "";
}

function normalizeConfidence(value: unknown): HandoffVisualConfidence {
  return value === "high" || value === "medium" ? value : "low";
}

function normalizeCount(value: unknown) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.min(MAX_VISIBLE_CUPS, Math.max(0, numeric));
}

/**
 * Converts a strict vision-model response to a conservative workflow state.
 * A photo is never an order, sale, delivery, or inventory mutation.
 */
export function classifyHandoffVisualResult(result: HandoffVisualModelResult): NormalizedHandoffVisualAnalysis {
  const personPresent = Boolean(result.person_present);
  const gelatoCupPresent = Boolean(result.gelato_cup_present);
  const cupInHandoffZone = Boolean(result.cup_in_handoff_zone);
  const visibleCupCount = normalizeCount(result.visible_cup_count);
  const confidence = normalizeConfidence(result.confidence);
  const ambiguous = Boolean(result.ambiguous);
  const discardReason = normalizeText(result.discard_reason);
  const reviewReason = normalizeText(result.review_reason);

  if (
    ambiguous ||
    confidence === "low" ||
    (gelatoCupPresent && visibleCupCount === 0) ||
    (visibleCupCount > 0 && !gelatoCupPresent)
  ) {
    return {
      personPresent,
      gelatoCupPresent,
      cupInHandoffZone,
      visibleCupCount,
      confidence,
      status: "pending_review",
      reason: reviewReason || "The visual evidence is ambiguous and requires manager review.",
    };
  }

  if (personPresent && gelatoCupPresent && cupInHandoffZone && visibleCupCount > 0) {
    return {
      personPresent,
      gelatoCupPresent,
      cupInHandoffZone,
      visibleCupCount,
      confidence,
      status: "approved_by_ai",
      reason: "Person, gelato cup, and handoff zone were all confirmed in the same image.",
    };
  }

  return {
    personPresent,
    gelatoCupPresent,
    cupInHandoffZone,
    visibleCupCount,
    confidence,
    status: "discarded",
    reason: discardReason || "The image does not meet the handoff visual criteria.",
  };
}

/** Exponential retry delay for analysis outages; the source image remains queued. */
export function getHandoffVisualRetryDelayMs(attempts: number) {
  const normalizedAttempts = Math.max(1, Math.trunc(attempts));
  return Math.min(60 * 60 * 1_000, 60 * 1_000 * 2 ** Math.min(normalizedAttempts - 1, 6));
}

export async function analyzeHandoffVisualImage(input: {
  imageUrl: string;
  cameraName: string;
}): Promise<NormalizedHandoffVisualAnalysis> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "You are a conservative visual safety filter for a gelato-shop handoff camera. Analyze one still image only. A valid handoff requires a visible person and one or more visible gelato cups in the same image, with the cup located inside the configured handoff zone. Reject lamps, reflected lights, arms, hands without a cup, bags, lids, signage, bowls, cones, and any non-cup object. Do not infer a sale, delivery, payment, customer identity, or inventory movement. If zone boundaries, cup identity, person presence, or the number of cups cannot be seen clearly, mark the result ambiguous for human review.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Camera: ${input.cameraName}. Inspect this verified handoff snapshot. Report only visible evidence: whether a person is present, whether a gelato cup is present, whether the cup is inside handoff_zone, and the number of visible gelato cups. Do not count lamps, arms, hands, reflections, or other objects as cups.`,
          },
          {
            type: "image_url",
            image_url: {
              url: input.imageUrl,
              detail: "high",
            },
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "handoff_visual_filter",
        strict: true,
        schema: {
          type: "object",
          properties: {
            person_present: { type: "boolean" },
            gelato_cup_present: { type: "boolean" },
            cup_in_handoff_zone: { type: "boolean" },
            visible_cup_count: { type: "integer", minimum: 0, maximum: MAX_VISIBLE_CUPS },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            ambiguous: { type: "boolean" },
            discard_reason: { type: "string" },
            review_reason: { type: "string" },
          },
          required: [
            "person_present",
            "gelato_cup_present",
            "cup_in_handoff_zone",
            "visible_cup_count",
            "confidence",
            "ambiguous",
            "discard_reason",
            "review_reason",
          ],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message.content;
  if (typeof content !== "string") {
    throw new Error("Handoff image analysis returned an unexpected response");
  }

  return classifyHandoffVisualResult(JSON.parse(content) as HandoffVisualModelResult);
}
