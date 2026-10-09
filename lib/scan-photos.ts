// Browser-side preparation of photos of copies (one photo per page): the
// photo is decoded with its EXIF orientation applied, reduced to at most
// 2400 px on its long side, checked for gross capture problems, and all the
// pages are assembled into one PDF that follows the existing scan import.
// A photo that is far too dark or too blurred to be read reliably is refused
// here with a clear reason instead of being sent to the reader; the reader
// still reports the quality of every page it receives.

export const MAX_PHOTO_SIDE = 2400;

export interface PhotoQuality {
  /** Mean luminance, 0–255. */
  brightness: number;
  /** Luminance standard deviation (≈ 0 for a uniform image). */
  contrast: number;
  /** Variance of the Laplacian at 512 px: low means blurred. */
  sharpness: number;
}

/**
 * Thresholds measured on FOCUS's fixture copies (tests/fixtures/handwriting):
 * a heavily blurred photo scores 2, a very dark one 26 (mean 38), while the
 * hardest still-readable copies (level D) score 126–134 and clean ones
 * 330–790. Refusal stays far below anything readable; warnings in between.
 */
export const PHOTO_LIMITS = {
  refuse: { sharpness: 25, brightness: 45, contrast: 6 },
  warn: { sharpness: 60, brightness: 80 },
};

export function photoQuality(gray: Uint8ClampedArray | Float32Array | number[], width: number, height: number): PhotoQuality {
  let sum = 0;
  for (let i = 0; i < width * height; i++) sum += gray[i];
  const mean = sum / (width * height);
  let variance = 0;
  for (let i = 0; i < width * height; i++) variance += (gray[i] - mean) ** 2;
  let lapSum = 0;
  let lapSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      lapSum += lap;
      lapSq += lap * lap;
      count++;
    }
  const lapMean = count ? lapSum / count : 0;
  return {
    brightness: mean,
    contrast: Math.sqrt(variance / (width * height)),
    sharpness: count ? lapSq / count - lapMean * lapMean : 0,
  };
}

/** Refusal reason, or warnings, for one photo (1-indexed page). */
export function photoVerdict(quality: PhotoQuality, page: number): { refuse: string | null; warnings: string[] } {
  const label = `Photo ${page}`;
  if (quality.brightness < PHOTO_LIMITS.refuse.brightness)
    return { refuse: `${label} : beaucoup trop sombre pour être lue de façon fiable. Reprenez-la avec plus de lumière.`, warnings: [] };
  if (quality.sharpness < PHOTO_LIMITS.refuse.sharpness)
    return { refuse: `${label} : trop floue pour être lue de façon fiable. Reprenez-la en faisant la mise au point sur l’écriture.`, warnings: [] };
  if (quality.contrast < PHOTO_LIMITS.refuse.contrast)
    return { refuse: `${label} : l’image est presque uniforme (page vide, objectif masqué ?). Reprenez la photo.`, warnings: [] };
  const warnings: string[] = [];
  if (quality.brightness < PHOTO_LIMITS.warn.brightness) warnings.push(`${label} : plutôt sombre, certains passages risquent d’être illisibles.`);
  if (quality.sharpness < PHOTO_LIMITS.warn.sharpness) warnings.push(`${label} : peu nette, certains passages risquent d’être illisibles.`);
  return { refuse: null, warnings };
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("PHOTO_CANVAS");
  return { canvas, context };
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("PHOTO_FORMAT");
  }
}

function measure(bitmap: ImageBitmap) {
  const scale = 512 / Math.max(bitmap.width, bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const { context } = canvasOf(width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return photoQuality(gray, width, height);
}

async function toJpeg(bitmap: ImageBitmap) {
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const { canvas, context } = canvasOf(width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("PHOTO_ENCODE");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}

/**
 * Photos → one PDF, one page per photo, in the order chosen. Throws
 * PHOTO_FORMAT for an image the browser cannot decode (e.g. HEIC outside
 * Safari) and PHOTO_REFUSED (with the reason) for an unreadable capture.
 */
export async function photosToPdf(files: File[]): Promise<{ pdf: Blob; pages: number; warnings: string[] }> {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const warnings: string[] = [];
  for (const [index, file] of files.entries()) {
    const bitmap = await decode(file);
    try {
      const verdict = photoVerdict(measure(bitmap), index + 1);
      if (verdict.refuse) throw Object.assign(new Error("PHOTO_REFUSED"), { reason: verdict.refuse });
      warnings.push(...verdict.warnings);
      const jpeg = await toJpeg(bitmap);
      const image = await pdf.embedJpg(jpeg.bytes);
      // Long side ≈ A4 (842 pt): the reader receives the full resolution.
      const ratio = 842 / Math.max(jpeg.width, jpeg.height);
      const page = pdf.addPage([jpeg.width * ratio, jpeg.height * ratio]);
      page.drawImage(image, { x: 0, y: 0, width: jpeg.width * ratio, height: jpeg.height * ratio });
    } finally {
      bitmap.close();
    }
  }
  const bytes = await pdf.save();
  return { pdf: new Blob([bytes as BlobPart], { type: "application/pdf" }), pages: files.length, warnings };
}
