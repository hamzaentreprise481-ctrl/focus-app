// Gross capture problems are refused in the browser before anything is sent;
// thresholds sit far from the hardest still-readable fixture copies.

import { test } from "node:test";
import assert from "node:assert/strict";
import { photoQuality, photoVerdict, PHOTO_LIMITS } from "../lib/scan-photos";

function image(width: number, height: number, pixel: (x: number, y: number) => number) {
  const gray = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) gray[y * width + x] = pixel(x, y);
  return photoQuality(gray, width, height);
}
// White paper with dark, crisp 2-px strokes every 12 px.
const sharp = image(200, 280, (x, y) => ((x % 12 < 2 && y % 40 < 30) || (y % 40 === 10 && x % 30 < 20) ? 30 : 240));
// Strokes smeared over tens of pixels: contrast remains, edges are gone.
const blurred = image(200, 280, (x, y) => 200 - 60 * Math.cos((x / 48) * Math.PI * 2) * Math.cos((y / 64) * Math.PI * 2));

test("photo quality: brightness, contrast and Laplacian sharpness", () => {
  const uniform = image(100, 100, () => 128);
  assert.equal(uniform.brightness, 128);
  assert.equal(uniform.contrast, 0);
  assert.equal(uniform.sharpness, 0);
  assert.ok(sharp.sharpness > PHOTO_LIMITS.warn.sharpness, String(sharp.sharpness));
  assert.ok(blurred.sharpness < PHOTO_LIMITS.refuse.sharpness, String(blurred.sharpness));
});

test("unreadable captures are refused with a reason a teacher can act on; doubtful ones only warn", () => {
  assert.equal(photoVerdict(sharp, 1).refuse, null);
  assert.deepEqual(photoVerdict(sharp, 1).warnings, []);
  assert.match(photoVerdict(blurred, 2).refuse!, /^Photo 2 : trop floue/);
  assert.match(photoVerdict({ brightness: 38, contrast: 2.3, sharpness: 25.9 }, 1).refuse!, /beaucoup trop sombre/);
  assert.match(photoVerdict({ brightness: 240, contrast: 3, sharpness: 30 }, 1).refuse!, /presque uniforme/);
  // Level-D fixtures measured 126–134 sharpness, brightness ≈ 160: accepted.
  assert.equal(photoVerdict({ brightness: 160, contrast: 42, sharpness: 126 }, 1).refuse, null);
  assert.deepEqual(photoVerdict({ brightness: 70, contrast: 40, sharpness: 50 }, 3).warnings, [
    "Photo 3 : plutôt sombre, certains passages risquent d’être illisibles.",
    "Photo 3 : peu nette, certains passages risquent d’être illisibles.",
  ]);
});
