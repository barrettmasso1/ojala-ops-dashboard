import { ENV } from "./_core/env";

export const HANDOFF_VISUAL_STATUSES = [
  "pending_review",
  "approved_by_ai",
  "discarded",
  "approved_by_manager",
  "discarded_by_manager",
] as const;

export type HandoffVisualStatus = (typeof HANDOFF_VISUAL_STATUSES)[number];
export type HandoffVisualConfidence = "high" | "medium" | "low";

export type HandoffVisualBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: HandoffVisualConfidence;
};

export type HandoffVisualModelResult = {
  person_present: boolean;
  gelato_cup_present: boolean;
  cup_in_handoff_zone: boolean;
  visible_cup_count: number;
  confidence: HandoffVisualConfidence;
  ambiguous: boolean;
  discard_reason: string;
  review_reason: string;
  person_boxes?: HandoffVisualBox[];
  gelato_cup_boxes?: HandoffVisualBox[];
};

export type NormalizedHandoffVisualAnalysis = {
  personPresent: boolean;
  gelatoCupPresent: boolean;
  cupInHandoffZone: boolean;
  visibleCupCount: number;
  confidence: HandoffVisualConfidence;
  status: Extract<HandoffVisualStatus, "pending_review" | "approved_by_ai" | "discarded">;
  reason: string;
  evidence: {
    personBoxes: HandoffVisualBox[];
    gelatoCupBoxes: HandoffVisualBox[];
  };
  model?: string;
};

const MAX_VISIBLE_CUPS = 8;
export const HANDOFF_VISUAL_ANALYSIS_TIMEOUT_MS = 45_000;
export const HANDOFF_VISUAL_MODEL = "gemini-3.1-pro-preview";

type HandoffVisualModelResponse = {
  model?: string;
  choices?: Array<{ message?: { content?: unknown } }>;
};

/**
 * A narrowly scoped Gemini Pro call so this safety filter can use high-detail
 * vision without changing model selection for other application workflows.
 */
async function invokeHandoffVisualModel(payload: Record<string, unknown>): Promise<HandoffVisualModelResponse> {
  const forgeApiKey = ENV.forgeApiKey || process.env.BUILT_IN_FORGE_API_KEY || "";
  const forgeApiUrl = ENV.forgeApiUrl || process.env.BUILT_IN_FORGE_API_URL || "";
  if (!forgeApiKey) throw new Error("Vision model credentials are not configured");
  const baseUrl = (forgeApiUrl || "https://forge.manus.im").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${forgeApiKey}`,
    },
    body: JSON.stringify({
      model: HANDOFF_VISUAL_MODEL,
      max_tokens: 16_384,
      ...payload,
    }),
  });
  if (!response.ok) throw new Error(`Handoff image analysis failed with ${response.status}`);
  return await response.json() as HandoffVisualModelResponse;
}

/**
 * The underlying request may finish after this timeout, but callers use a
 * lease token so that a late result cannot change a manager decision or a
 * newer retry state.
 */
export async function withHandoffVisualAnalysisTimeout<T>(operation: Promise<T>, timeoutMs = HANDOFF_VISUAL_ANALYSIS_TIMEOUT_MS): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Handoff image analysis timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

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

function normalizeCoordinate(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function normalizeBoxes(value: unknown): HandoffVisualBox[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_VISIBLE_CUPS).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const box = item as Record<string, unknown>;
    const width = normalizeCoordinate(box.width);
    const height = normalizeCoordinate(box.height);
    if (width === 0 || height === 0) return [];
    return [{
      x: normalizeCoordinate(box.x),
      y: normalizeCoordinate(box.y),
      width,
      height,
      confidence: normalizeConfidence(box.confidence),
    }];
  });
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
  const evidence = {
    personBoxes: normalizeBoxes(result.person_boxes),
    gelatoCupBoxes: normalizeBoxes(result.gelato_cup_boxes),
  };

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
      evidence,
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
      evidence,
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
    evidence,
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
  handoffZonePolygon: Array<{ x: number; y: number }>;
  handoffZoneGeometryVersion: number;
}): Promise<NormalizedHandoffVisualAnalysis> {
  const response = await withHandoffVisualAnalysisTimeout(invokeHandoffVisualModel({
    messages: [
      {
        role: "system",
        content:
          "You are a conservative visual safety filter for a gelato-shop handoff camera. Analyze one still image only. A valid handoff requires a visible person and one or more visible gelato cups in the same image, with the cup located inside the configured handoff polygon supplied by the server. Reject lamps, reflected lights, arms, hands without a cup, bags, lids, signage, bowls, cones, and any non-cup object. Do not infer a sale, delivery, payment, customer identity, or inventory movement. If zone boundaries, cup identity, person presence, or the number of cups cannot be seen clearly, mark the result ambiguous for human review.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Camera: ${input.cameraName}. The active handoff_zone is a normalized-image polygon (x,y in 0..1), version ${input.handoffZoneGeometryVersion}: ${JSON.stringify(input.handoffZonePolygon)}. Inspect this verified handoff snapshot. Report only visible evidence: whether a person is present, whether a gelato cup is present, whether the cup is inside that exact configured polygon, and the number of visible gelato cups. Return normalized x/y/width/height boxes for every person and cup you relied on (origin at the upper-left); boxes are audit evidence only, not a sale or delivery. Do not count lamps, arms, hands, reflections, or other objects as cups. If the polygon cannot be related to the visible image, mark the result ambiguous.`,
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
            person_boxes: {
              type: "array",
              maxItems: MAX_VISIBLE_CUPS,
              items: {
                type: "object",
                properties: {
                  x: { type: "number", minimum: 0, maximum: 1 },
                  y: { type: "number", minimum: 0, maximum: 1 },
                  width: { type: "number", minimum: 0, maximum: 1 },
                  height: { type: "number", minimum: 0, maximum: 1 },
                  confidence: { type: "string", enum: ["high", "medium", "low"] },
                },
                required: ["x", "y", "width", "height", "confidence"],
                additionalProperties: false,
              },
            },
            gelato_cup_boxes: {
              type: "array",
              maxItems: MAX_VISIBLE_CUPS,
              items: {
                type: "object",
                properties: {
                  x: { type: "number", minimum: 0, maximum: 1 },
                  y: { type: "number", minimum: 0, maximum: 1 },
                  width: { type: "number", minimum: 0, maximum: 1 },
                  height: { type: "number", minimum: 0, maximum: 1 },
                  confidence: { type: "string", enum: ["high", "medium", "low"] },
                },
                required: ["x", "y", "width", "height", "confidence"],
                additionalProperties: false,
              },
            },
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
            "person_boxes",
            "gelato_cup_boxes",
          ],
          additionalProperties: false,
        },
      },
    },
  }));

  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Handoff image analysis returned an unexpected response");
  }

  return {
    ...classifyHandoffVisualResult(JSON.parse(content) as HandoffVisualModelResult),
    // Persist the returned model identifier for later audit; this scoped
    // safety filter deliberately uses Gemini Pro rather than the app default.
    model: response.model || HANDOFF_VISUAL_MODEL,
  };
}
