"""Convert raw Playwright PNG captures to lossless WebP for the Remotion project.
Usage: python optimize.py <raw_dir> <public_captures_dir>"""
import json, shutil, sys
from pathlib import Path
from PIL import Image

raw, dst = Path(sys.argv[1]), Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)
for png in sorted(raw.glob("*/*.png")):
    out = dst / png.parent.name / (png.stem + ".webp")
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.open(png).convert("RGB").save(out, "WEBP", lossless=True, method=6)
    print(f"{out.relative_to(dst)}  {png.stat().st_size//1024} KB -> {out.stat().st_size//1024} KB")
shutil.copy(raw / "manifest.json", dst / "manifest.json")
