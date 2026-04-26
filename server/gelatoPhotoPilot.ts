import { invokeLLM } from "./_core/llm";
import { storageGetSignedUrl, storagePut } from "./storage";
import { READY_MADE_GELATO_FLAVORS } from "../shared/opsCatalog";

export type GelatoPhotoUploadInput = {
  fileName: string;
  mimeType: string;
  dataUrl: string;
};

export type GelatoPhotoPanSize = "small" | "large" | "unknown";
export type GelatoPhotoConfidence = "high" | "medium" | "low";

export type ExtractedGelatoPhoto = {
  fileName: string;
  imageUrl: string;
  flavor: string;
  panSize: GelatoPhotoPanSize;
  grossWeightKg: number;
  confidence: GelatoPhotoConfidence;
  warning: string;
};

export type GroupedGelatoEntry = {
  flavor: string;
  smallPanCount: number;
  smallGrossWeightKg: number;
  largePanCount: number;
  largeGrossWeightKg: number;
};

function roundTo(value: number, decimals = 3) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function decodeDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image upload format");
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

function normalizeFlavorName(rawFlavor: string) {
  const trimmed = rawFlavor.trim();
  if (!trimmed) return "Unknown flavor";

  const canonical = READY_MADE_GELATO_FLAVORS.find(
    flavor => flavor.toLowerCase() === trimmed.toLowerCase()
  );

  return canonical ?? trimmed;
}

function normalizePanSize(rawPanSize: string): GelatoPhotoPanSize {
  const normalized = rawPanSize.trim().toLowerCase();
  if (normalized === "small" || normalized === "large") return normalized;
  return "unknown";
}

function normalizeConfidence(rawConfidence: string): GelatoPhotoConfidence {
  const normalized = rawConfidence.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium") return normalized;
  return "low";
}

export function buildGroupedGelatoEntries(
  extractedPhotos: ExtractedGelatoPhoto[]
): GroupedGelatoEntry[] {
  const grouped = new Map<string, GroupedGelatoEntry>();

  for (const photo of extractedPhotos) {
    if (photo.panSize === "unknown" || photo.grossWeightKg <= 0) continue;

    const existing =
      grouped.get(photo.flavor) ?? {
        flavor: photo.flavor,
        smallPanCount: 0,
        smallGrossWeightKg: 0,
        largePanCount: 0,
        largeGrossWeightKg: 0,
      };

    if (photo.panSize === "small") {
      existing.smallPanCount += 1;
      existing.smallGrossWeightKg = roundTo(
        existing.smallGrossWeightKg + photo.grossWeightKg
      );
    }

    if (photo.panSize === "large") {
      existing.largePanCount += 1;
      existing.largeGrossWeightKg = roundTo(
        existing.largeGrossWeightKg + photo.grossWeightKg
      );
    }

    grouped.set(photo.flavor, existing);
  }

  return Array.from(grouped.values()).sort((left, right) =>
    left.flavor.localeCompare(right.flavor)
  );
}

type LlmExtractionResult = {
  flavor: string;
  pan_size: "small" | "large" | "unknown";
  gross_weight_kg: number;
  confidence: "high" | "medium" | "low";
  warning: string;
};

async function extractSinglePhoto(
  photo: GelatoPhotoUploadInput,
  index: number
): Promise<ExtractedGelatoPhoto> {
  const decoded = decodeDataUrl(photo.dataUrl);
  const uploaded = await storagePut(
    `gelato-photo-pilot/${Date.now()}-${index}-${photo.fileName}`,
    decoded.buffer,
    photo.mimeType || decoded.mimeType
  );
  const signedImageUrl = await storageGetSignedUrl(uploaded.key);

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "You extract gelato inventory data from a single photo. Read only what is visible. Return one flavor name, one pan size, and one gross weight in kilograms. If anything is unclear, lower confidence and explain briefly in warning.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `This is a single gelato pan photo for a pilot inventory workflow. Identify the flavor label, read the scale display in kilograms, and classify the pan as small, large, or unknown. Known common flavors include: ${READY_MADE_GELATO_FLAVORS.join(", ")}. Use a custom flavor only when the label clearly shows something else. If the scale or label is unreadable, return the best visible answer, set confidence to low, and explain the problem in warning.`,
          },
          {
            type: "image_url",
            image_url: {
              url: signedImageUrl,
              detail: "high",
            },
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "gelato_photo_extraction",
        strict: true,
        schema: {
          type: "object",
          properties: {
            flavor: { type: "string" },
            pan_size: {
              type: "string",
              enum: ["small", "large", "unknown"],
            },
            gross_weight_kg: {
              type: "number",
              minimum: 0,
            },
            confidence: {
              type: "string",
              enum: ["high", "medium", "low"],
            },
            warning: { type: "string" },
          },
          required: [
            "flavor",
            "pan_size",
            "gross_weight_kg",
            "confidence",
            "warning",
          ],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message.content;
  if (typeof content !== "string") {
    throw new Error("Image extraction returned an unexpected response");
  }

  const parsed = JSON.parse(content) as LlmExtractionResult;

  return {
    fileName: photo.fileName,
    imageUrl: uploaded.url,
    flavor: normalizeFlavorName(parsed.flavor),
    panSize: normalizePanSize(parsed.pan_size),
    grossWeightKg: roundTo(parsed.gross_weight_kg),
    confidence: normalizeConfidence(parsed.confidence),
    warning: parsed.warning.trim(),
  };
}

export async function extractGelatoPhotos(
  photos: GelatoPhotoUploadInput[]
): Promise<{
  extractedPhotos: ExtractedGelatoPhoto[];
  groupedEntries: GroupedGelatoEntry[];
}> {
  const extractedPhotos: ExtractedGelatoPhoto[] = [];

  for (let index = 0; index < photos.length; index += 1) {
    extractedPhotos.push(await extractSinglePhoto(photos[index], index));
  }

  return {
    extractedPhotos,
    groupedEntries: buildGroupedGelatoEntries(extractedPhotos),
  };
}
