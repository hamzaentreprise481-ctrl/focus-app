"""Pre-generates the film's textures (so Remotion can wait for them like any image).
  public/textures/grain_<n>.png  — 8 film-grain tiles (256², neutral grey, used with mix-blend overlay)
  public/textures/paper.webp     — paper fibre texture (1024², multiply)"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

out = Path(sys.argv[1] if len(sys.argv) > 1 else "public/textures")
out.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(2026)
for i in range(8):
    g = rng.standard_normal((256, 256))
    g = ndimage.gaussian_filter(g, 0.6, mode="wrap")
    g = 128 + g / g.std() * 34
    Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), "L").save(out / f"grain_{i}.png", optimize=True)
n = 1024
base = ndimage.gaussian_filter(rng.standard_normal((n, n)), 1.2, mode="wrap")
fib = ndimage.gaussian_filter(rng.standard_normal((n, n)), (0.6, 7), mode="wrap")  # elongated fibres
blot = ndimage.gaussian_filter(rng.standard_normal((n, n)), 40, mode="wrap")
v = base / base.std() * 0.5 + fib / fib.std() * 0.35 + blot / blot.std() * 0.25
lum = 255 - np.clip(np.abs(v) * 14, 0, 60)  # mostly white, faint darker fibres
rgb = np.stack([lum, lum * 0.985, lum * 0.96], axis=-1)
Image.fromarray(rgb.astype(np.uint8), "RGB").save(out / "paper.webp", quality=90)
print("ok")
