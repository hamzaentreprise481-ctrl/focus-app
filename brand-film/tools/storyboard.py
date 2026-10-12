"""Extracts the storyboard frames (one per shot) from the final film into docs/storyboard/.
Usage: python tools/storyboard.py FOCUS_BRAND_FILM_2026.mp4 docs/storyboard"""
import subprocess
import sys
from pathlib import Path

# (shot number, time in seconds) — see docs/STORYBOARD.md
SHOTS = [
    (1, 0.8), (2, 3.6), (3, 7.6), (4, 9.1), (5, 11.8), (6, 14.4), (7, 20.6), (8, 25.6), (9, 27.6),
    (10, 31.4), (11, 36.2), (12, 38.2), (13, 41.4), (14, 42.8), (15, 45.6), (16, 48.2), (17, 50.2),
    (18, 55.0), (19, 57.0), (20, 57.9), (21, 60.4), (22, 62.4), (23, 65.5), (24, 69.6), (25, 77.0),
]

src, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
for n, t in SHOTS:
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{t}", "-i", str(src), "-frames:v", "1",
                    "-vf", "scale=640:360", "-q:v", "3", str(out / f"{n:02d}.jpg")], check=True)
print(f"{len(SHOTS)} frames -> {out}")
