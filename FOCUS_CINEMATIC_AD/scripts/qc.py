"""Automated quality control on a delivered MP4 (writes quality_control/qc_<name>.json
and contact sheets). Manual visual review notes go in quality_control/QC_REPORT.md.

  python qc.py output/FOCUS_CINEMATIC_FINAL.mp4
"""
import json
import os
import re
import subprocess
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QC = os.path.join(ROOT, "quality_control")


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def main(path):
    name = os.path.splitext(os.path.basename(path))[0]
    os.makedirs(os.path.join(QC, "frames"), exist_ok=True)
    rep = {"file": os.path.relpath(path, ROOT), "size_MB": round(os.path.getsize(path) / 1e6, 2)}
    pr = json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path]).stdout)
    v = next(s for s in pr["streams"] if s["codec_type"] == "video")
    a = next(s for s in pr["streams"] if s["codec_type"] == "audio")
    rep.update({
        "duration_s": float(pr["format"]["duration"]), "video_codec": v["codec_name"], "profile": v.get("profile"),
        "resolution": f'{v["width"]}x{v["height"]}', "fps": v["r_frame_rate"], "frames": int(v.get("nb_frames", 0)),
        "pix_fmt": v["pix_fmt"], "color": [v.get("color_space"), v.get("color_primaries"), v.get("color_transfer")],
        "video_kbps": round(int(v.get("bit_rate", 0)) / 1000), "audio_codec": a["codec_name"], "audio_channels": a["channels"],
        "audio_rate": int(a["sample_rate"]),
    })
    bd = run(["ffmpeg", "-hide_banner", "-i", path, "-vf", "blackdetect=d=0.08:pix_th=0.05", "-an", "-f", "null", "-"]).stderr
    rep["black_intervals"] = [(float(m.group(1)), float(m.group(2))) for m in re.finditer(r"black_start:([\d.]+) black_end:([\d.]+)", bd)]
    fz = run(["ffmpeg", "-hide_banner", "-i", path, "-vf", "freezedetect=n=0.0006:d=0.6", "-an", "-f", "null", "-"]).stderr
    rep["freeze_starts"] = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", fz)]
    lo = run(["ffmpeg", "-hide_banner", "-i", path, "-af", "ebur128=peak=true", "-vn", "-f", "null", "-"]).stderr
    summ = lo[lo.rfind("Summary"):]
    rep["loudness_LUFS"] = float(re.search(r"I:\s+(-?[\d.]+) LUFS", summ).group(1))
    rep["LRA_LU"] = float(re.search(r"LRA:\s+(-?[\d.]+) LU", summ).group(1))
    rep["true_peak_dBFS"] = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summ).group(1))
    # contact sheet: one frame per second
    dur = rep["duration_s"]
    sheet = os.path.join(QC, f"contact_{name}.jpg")
    cols = 6 if dur > 20 else 4
    n = int(np.ceil(dur))
    rows = int(np.ceil(n / cols))
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-vf", f"fps=1,scale=480:-1,tile={cols}x{rows}:padding=4", "-frames:v", "1", sheet])
    rep["contact_sheet"] = os.path.relpath(sheet, ROOT)
    # full-resolution stills at chosen times
    times = [float(t) for t in os.environ.get("QC_TIMES", "").split(",") if t] or list(np.linspace(0.5, dur - 0.3, 8))
    stills = []
    for t in times:
        out = os.path.join(QC, "frames", f"{name}_{t:05.2f}s.jpg")
        run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", path, "-frames:v", "1", "-q:v", "2", out])
        stills.append(os.path.relpath(out, ROOT))
    rep["stills"] = stills
    json.dump(rep, open(os.path.join(QC, f"qc_{name}.json"), "w"), indent=2)
    print(json.dumps(rep, indent=2))


if __name__ == "__main__":
    main(sys.argv[1])
