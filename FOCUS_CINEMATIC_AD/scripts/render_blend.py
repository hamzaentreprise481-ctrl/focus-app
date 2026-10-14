"""Render frames of a .blend with the bpy module (headless, CPU Cycles).

  python render_blend.py scene.blend --frames 1,40,96 --out /path/prefix_ --res 640x360 --samples 16 --png
  python render_blend.py scene.blend --range 1-192 --out /path/f_ (EXR, resumable: skips existing frames)
"""
import argparse
import os
import sys
import time

import bpy

ap = argparse.ArgumentParser()
ap.add_argument("blend")
ap.add_argument("--frames", default="")
ap.add_argument("--range", default="")
ap.add_argument("--step", type=int, default=1)
ap.add_argument("--out", required=True)
ap.add_argument("--res", default="")
ap.add_argument("--samples", type=int, default=0)
ap.add_argument("--png", action="store_true", help="AgX-tonemapped PNG preview instead of linear EXR")
ap.add_argument("--no-mblur", action="store_true")
a = ap.parse_args()

bpy.ops.wm.open_mainfile(filepath=a.blend)
scn = bpy.context.scene
if a.res:
    scn.render.resolution_x, scn.render.resolution_y = (int(v) for v in a.res.split("x"))
if a.samples:
    scn.cycles.samples = a.samples
if a.no_mblur:
    scn.render.use_motion_blur = False
ims = scn.render.image_settings
if a.png:
    ims.media_type = "IMAGE"
    ims.file_format = "PNG"
    ims.color_depth = "8"
    ims.color_mode = "RGB"
    scn.view_settings.view_transform = "AgX"
    scn.view_settings.look = "AgX - Medium High Contrast"
ext = ".png" if a.png else ".exr"

if a.frames:
    frames = [int(f) for f in a.frames.split(",")]
else:
    f0, f1 = (int(v) for v in a.range.split("-"))
    frames = list(range(f0, f1 + 1, a.step))

os.makedirs(os.path.dirname(a.out), exist_ok=True)
t_all = time.time()
for f in frames:
    path = f"{a.out}{f:04d}{ext}"
    if os.path.exists(path) and os.path.getsize(path) > 0:
        continue
    scn.frame_set(f)
    scn.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"FRAME {f} {time.time() - t:.1f}s", flush=True)
print(f"DONE {len(frames)} frames in {time.time() - t_all:.0f}s", flush=True)
