import { createHash } from "node:crypto";

const ACCEPTED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_HANDOFF_IMAGE_BYTES = 8 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export type DecodedHandoffImage = {
  buffer: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  checksum: string;
};

export type HandoffCaptureMetadata = {
  camera: "handoff";
  cupZone: "handoff_zone";
  cupEventId: string;
  capturedAt: Date;
  capturedAtUtc: string;
  imageSha256: string;
};

function hasExpectedImageSignature(buffer: Buffer, mimeType: DecodedHandoffImage["mimeType"]) {
  if (mimeType === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
}

export function decodeHandoffImageDataUrl(dataUrl: string): DecodedHandoffImage {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match || !ACCEPTED_IMAGE_MIME_TYPES.has(match[1])) {
    throw new Error("A JPEG, PNG, or WebP handoff image is required");
  }

  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length || buffer.length > MAX_HANDOFF_IMAGE_BYTES) {
    throw new Error("Handoff image must be between 1 byte and 8 MB");
  }
  const mimeType = match[1] as DecodedHandoffImage["mimeType"];
  if (!hasExpectedImageSignature(buffer, mimeType)) {
    throw new Error("Handoff image is corrupt or does not match its declared format");
  }

  return {
    buffer,
    mimeType,
    checksum: createHash("sha256").update(buffer).digest("hex"),
  };
}

export function parseHandoffCaptureMetadata(input: {
  camera: string;
  cupZone: string;
  cupEventId: string;
  capturedAtUtc: string;
  imageSha256: string;
}): HandoffCaptureMetadata {
  if (input.camera !== "handoff") throw new Error("Capture metadata camera must be handoff");
  if (input.cupZone !== "handoff_zone") throw new Error("Capture metadata cup_zone must be handoff_zone");
  if (!EVENT_ID_PATTERN.test(input.cupEventId)) throw new Error("Capture metadata cup_event_id is invalid");
  if (!SHA256_PATTERN.test(input.imageSha256)) throw new Error("Capture metadata image_sha256 is invalid");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.capturedAtUtc)) {
    throw new Error("Capture metadata captured_at_utc must be an ISO-8601 UTC timestamp");
  }
  const capturedAt = new Date(input.capturedAtUtc);
  if (!Number.isFinite(capturedAt.getTime())) throw new Error("Capture metadata captured_at_utc is invalid");

  return {
    camera: "handoff",
    cupZone: "handoff_zone",
    cupEventId: input.cupEventId,
    capturedAt,
    capturedAtUtc: input.capturedAtUtc,
    imageSha256: input.imageSha256,
  };
}

export function handoffCaptureMetadataJson(metadata: HandoffCaptureMetadata) {
  return JSON.stringify({
    camera: metadata.camera,
    cup_zone: metadata.cupZone,
    cup_event_id: metadata.cupEventId,
    captured_at_utc: metadata.capturedAtUtc,
    image_sha256: metadata.imageSha256,
  });
}

export function handoffImageExtension(mimeType: DecodedHandoffImage["mimeType"]) {
  return mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
}
