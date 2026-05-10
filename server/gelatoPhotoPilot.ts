import { invokeLLM } from "./_core/llm";
import { storageGetSignedUrl, storagePut } from "./storage";
import { READY_MADE_GELATO_FLAVORS } from "../shared/opsCatalog";

export type GelatoPhotoUploadInput = {
  fileName: string;
  mimeType: string;
  dataUrl: string;
};

export type GelatoPhotoConfidence = "high" | "medium" | "low";

export type ExtractedGelatoPhoto = {
  fileName: string;
  imageUrl: string;
  imageKey: string;
  flavor: string;
  smallPanCount: number;
  largePanCount: number;
  combinedGrossWeightKg: number;
  confidence: GelatoPhotoConfidence;
  warning: string;
};

export type GroupedGelatoEntry = {
  flavor: string;
  smallPanCount: number;
  largePanCount: number;
  combinedGrossWeightKg: number;
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

function sanitizePhotoFileName(fileName: string) {
  const trimmed = fileName.trim() || "gelato-photo.jpeg";
  const lastDot = trimmed.lastIndexOf(".");
  const baseName = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const extension = lastDot > 0 ? trimmed.slice(lastDot).toLowerCase() : ".jpeg";
  const safeBaseName = baseName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "gelato-photo";
  const safeExtension = extension.replace(/[^a-z0-9.]+/g, "") || ".jpeg";
  return `${safeBaseName}${safeExtension.startsWith(".") ? safeExtension : `.${safeExtension}`}`;
}

function normalizeConfidence(rawConfidence: string): GelatoPhotoConfidence {
  const normalized = rawConfidence.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium") return normalized;
  return "low";
}

function normalizePanCount(rawCount: number) {
  if (!Number.isFinite(rawCount) || rawCount <= 0) return 0;
  return Math.min(2, Math.trunc(rawCount));
}

export function normalizeSinglePanPhotoCounts(input: Pick<ExtractedGelatoPhoto, "smallPanCount" | "largePanCount">) {
  const smallPanCount = normalizePanCount(input.smallPanCount);
  const largePanCount = normalizePanCount(input.largePanCount);
  const totalPanCount = smallPanCount + largePanCount;

  if (totalPanCount === 1) {
    return {
      smallPanCount: 1,
      largePanCount: 0,
    };
  }

  if (totalPanCount === 2) {
    return {
      smallPanCount: 1,
      largePanCount: 1,
    };
  }

  return {
    smallPanCount,
    largePanCount,
  };
}

export function buildGroupedGelatoEntries(
  extractedPhotos: ExtractedGelatoPhoto[]
): GroupedGelatoEntry[] {
  const grouped = new Map<string, GroupedGelatoEntry>();

  for (const photo of extractedPhotos) {
    if (
      photo.combinedGrossWeightKg <= 0 ||
      (photo.smallPanCount <= 0 && photo.largePanCount <= 0)
    ) {
      continue;
    }

    const existing =
      grouped.get(photo.flavor) ?? {
        flavor: photo.flavor,
        smallPanCount: 0,
        largePanCount: 0,
        combinedGrossWeightKg: 0,
      };

    existing.smallPanCount += photo.smallPanCount;
    existing.largePanCount += photo.largePanCount;
    existing.combinedGrossWeightKg = roundTo(
      existing.combinedGrossWeightKg + photo.combinedGrossWeightKg
    );

    grouped.set(photo.flavor, existing);
  }

  return Array.from(grouped.values()).sort((left, right) =>
    left.flavor.localeCompare(right.flavor)
  );
}

type LlmExtractionResult = {
  flavor: string;
  small_pan_count: number;
  large_pan_count: number;
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
    `gelato-photo-pilot/${Date.now()}-${index}-${sanitizePhotoFileName(photo.fileName)}`,
    decoded.buffer,
    photo.mimeType || decoded.mimeType
  );
  const previewUrl = await storageGetSignedUrl(uploaded.key);

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "You extract gelato inventory data from a single photo. Each photo can show one pan, two pans of the same flavor, or one small pan plus one large pan of the same flavor on a single scale. When exactly one pan is visible, default it to a small pan unless the image is unmistakably a large pan. When two pans are visible, report whether they are two small pans, two large pans, or one small plus one large. Return one flavor name, the small-pan count, the large-pan count, and the combined gross weight in kilograms. If anything is unclear, lower confidence and explain briefly in warning.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `This is a single gelato pan photo for a pilot inventory workflow. Identify the flavor label, read the scale display in kilograms, and count whether the image shows one small pan, one large pan, two small pans, two large pans, or one small plus one large pan of the same flavor. Known common flavors include: ${READY_MADE_GELATO_FLAVORS.join(", ")}. Use a custom flavor only when the label clearly shows something else. If the scale, label, or pan sizes are unclear, return the best visible answer, set confidence to low, and explain the problem in warning.`,
          },
          {
            type: "image_url",
            image_url: {
              url: photo.dataUrl,
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
            small_pan_count: {
              type: "number",
              minimum: 0,
              maximum: 2,
            },
            large_pan_count: {
              type: "number",
              minimum: 0,
              maximum: 2,
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
            "small_pan_count",
            "large_pan_count",
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
  const normalizedCounts = normalizeSinglePanPhotoCounts({
    smallPanCount: parsed.small_pan_count,
    largePanCount: parsed.large_pan_count,
  });

  return {
    fileName: photo.fileName,
    imageUrl: previewUrl,
    imageKey: uploaded.key,
    flavor: normalizeFlavorName(parsed.flavor),
    smallPanCount: normalizedCounts.smallPanCount,
    largePanCount: normalizedCounts.largePanCount,
    combinedGrossWeightKg: roundTo(parsed.gross_weight_kg),
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
