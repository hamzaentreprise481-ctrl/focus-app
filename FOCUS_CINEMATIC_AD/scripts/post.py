"""Shared look for every shot: linear EXR -> graded 8-bit PNG.

Steps (scene-linear): exposure -> bloom (multi-scale Gaussian pyramid) ->
filmic tone curve (ACES-like) -> grade (navy-lifted blacks, gentle contrast,
highlight desaturation) -> vignette -> fine luma grain.

  python post.py IN_DIR OUT_DIR [--exposure 1.0] [--bloom 0.06] [--grain 0.010]
"""
import argparse
import glob
import os
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import OpenEXR
from PIL import Image
from scipy.ndimage import gaussian_filter, zoom


def load_exr(path):
    with OpenEXR.File(path) as f:
        ch = f.channels()
        if "RGB" in ch:
            a = ch["RGB"].pixels
        elif "RGBA" in ch:
            a = ch["RGBA"].pixels[..., :3]
        else:
            a = np.stack([ch[c].pixels for c in ("R", "G", "B")], -1)
    return np.nan_to_num(a.astype(np.float32), nan=0.0, posinf=50.0)


def bloom(img, strength):
    if strength <= 0:
        return img
    h, w, _ = img.shape
    acc = np.zeros_like(img)
    small = img
    weights = (0.30, 0.25, 0.20, 0.15, 0.10)
    for i, wgt in enumerate(weights):
        small = zoom(small, (0.5, 0.5, 1), order=1)
        blurred = np.stack([gaussian_filter(small[..., c], 1.6) for c in range(3)], -1)
        up = zoom(blurred, (h / blurred.shape[0], w / blurred.shape[1], 1), order=1)
        acc += up * wgt
    return img + acc * strength * 4.0


def aces(x):
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    return np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0, 1)


def grade(x, lift=(0.010, 0.016, 0.030), contrast=1.06, sat=0.96):
    # highlight desaturation + global saturation
    lum = (x * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1, keepdims=True)
    hi = np.clip((lum - 0.75) / 0.25, 0, 1)
    x = lum + (x - lum) * (sat * (1 - 0.5 * hi))
    # contrast around mid-grey (in display space)
    x = np.clip(0.5 + (x - 0.5) * contrast, 0, 1)
    # navy lift in the shadows
    lift = np.array(lift, np.float32)
    x = x + lift * (1 - x) ** 3
    return np.clip(x, 0, 1)


def vignette(h, w, amount):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.sqrt(((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2) / np.sqrt(2)
    return (1 - amount * np.clip(r, 0, 1) ** 2.2)[..., None]


_VIG = {}


def process(path, out, exposure=1.0, bloom_amt=0.06, grain=0.010, vig=0.28, lift=(0.010, 0.016, 0.030),
            contrast=1.06, seed=0, size=None):
    img = load_exr(path) * exposure
    img = bloom(img, bloom_amt)
    x = aces(img)
    x = x ** (1 / 1.05)
    x = grade(x, lift, contrast)
    h, w, _ = x.shape
    key = (h, w, vig)
    if key not in _VIG:
        _VIG[key] = vignette(h, w, vig)
    x = x * _VIG[key]
    if grain > 0:
        rng = np.random.default_rng(seed)
        g = rng.normal(0, 1, (h, w)).astype(np.float32)
        g = gaussian_filter(g, 0.6)
        lum = x.mean(-1, keepdims=True)
        x = x + g[..., None] * grain * (0.6 + 0.8 * lum * (1 - lum) * 4)
    im = Image.fromarray((np.clip(x, 0, 1) ** (1 / 1.0) * 255 + 0.5).astype(np.uint8))
    if size and im.size != size:
        im = im.resize(size, Image.LANCZOS)
    im.save(out, compress_level=1)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp")
    ap.add_argument("out")
    ap.add_argument("--exposure", type=float, default=1.0)
    ap.add_argument("--bloom", type=float, default=0.06)
    ap.add_argument("--grain", type=float, default=0.010)
    ap.add_argument("--vignette", type=float, default=0.28)
    ap.add_argument("--contrast", type=float, default=1.06)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--size", default="1920x1080")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    size = tuple(int(v) for v in a.size.split("x"))
    files = sorted(glob.glob(os.path.join(a.inp, "*.exr")))
    jobs = []
    with ProcessPoolExecutor(a.workers) as ex:
        for f in files:
            o = os.path.join(a.out, os.path.basename(f).replace(".exr", ".png"))
            if os.path.exists(o) and os.path.getmtime(o) > os.path.getmtime(f):
                continue
            n = int("".join(c for c in os.path.basename(f) if c.isdigit()) or 0)
            jobs.append(ex.submit(process, f, o, a.exposure, a.bloom, a.grain, a.vignette, (0.010, 0.016, 0.030),
                                  a.contrast, n, size))
        for j in jobs:
            j.result()
    print("graded", len(jobs), "frames ->", a.out)


if __name__ == "__main__":
    main()
