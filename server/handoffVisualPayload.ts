import { createHash } from "node:crypto";

const ACCEPTED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_HANDOFF_IMAGE_BYTES = 8 * 1024 * 1024;

export type DecodedHandoffImage = {
  buffer: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  checksum: string;
};

export function decodeHandoffImageDataUrl(dataUrl: string): DecodedHandoffImage {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match || !ACCEPTED_IMAGE_MIME_TYPES.has(match[1])) {
    throw new Error("A JPEG, PNG, or WebP handoff image is required");
  }

  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length || buffer.length > MAX_HANDOFF_IMAGE_BYTES) {
    throw new Error("Handoff image must be between 1 byte and 8 MB");
  }

  return {
    buffer,
    mimeType: match[1] as DecodedHandoffImage["mimeType"],
    checksum: createHash("sha256").update(buffer).digest("hex"),
  };
}

export function handoffImageExtension(mimeType: DecodedHandoffImage["mimeType"]) {
  return mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
}
