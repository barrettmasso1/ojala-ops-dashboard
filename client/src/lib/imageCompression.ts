export type ImageCompressionOptions = {
  maxDimension?: number;
  quality?: number;
  outputType?: "image/jpeg" | "image/webp";
};

const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_QUALITY = 0.82;
const DEFAULT_OUTPUT_TYPE = "image/jpeg" satisfies ImageCompressionOptions["outputType"];

function loadImage(sourceUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode image."));
    image.src = sourceUrl;
  });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function calculateTargetSize(width: number, height: number, maxDimension: number) {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }

  const scale = Math.min(maxDimension / width, maxDimension / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function compressImageFileToDataUrl(file: File, options: ImageCompressionOptions = {}) {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(sourceDataUrl);
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const quality = options.quality ?? DEFAULT_QUALITY;
  const outputType = options.outputType ?? DEFAULT_OUTPUT_TYPE;
  const { width, height } = calculateTargetSize(image.naturalWidth || image.width, image.naturalHeight || image.height, maxDimension);

  if (width === image.naturalWidth && height === image.naturalHeight && sourceDataUrl.startsWith(`data:${outputType}`)) {
    return sourceDataUrl;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not prepare image compression canvas.");
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL(outputType, quality);
}

export function calculateCompressedDimensions(width: number, height: number, maxDimension = DEFAULT_MAX_DIMENSION) {
  return calculateTargetSize(width, height, maxDimension);
}
