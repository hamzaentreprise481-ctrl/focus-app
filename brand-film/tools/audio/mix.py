"""Final mix of the FOCUS film: voice-over + score stems + sound design, all placed from src/timeline.json.

Usage: python mix.py <timeline.json> <stems_dir> <vo_dir> <out.wav> [--target -15]
Also writes <out>.report.json (loudness, true peak, cue list).
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import signal

import sys
sys.path.insert(0, str(Path(__file__).parent))
import dsp  # noqa: E402
import sfx  # noqa: E402
from dsp import SR  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("timeline")
ap.add_argument("stems")
ap.add_argument("vo")
ap.add_argument("out")
ap.add_argument("--target", type=float, default=-15.0)
args = ap.parse_args()

TL = json.loads(Path(args.timeline).read_text())
C = TL["cues"]
DUR = TL["duration"]
N = int(DUR * SR)
cues_log = []


def place(track, sig, at, gain_db=0.0, pan=0.0, label=None):
    s = dsp.pan(sig, pan) * dsp.db(gain_db) if sig.ndim == 1 else sig * dsp.db(gain_db)
    i0 = int(round(at * SR))
    if i0 >= N:
        return
    m = min(len(s), N - i0)
    track[i0:i0 + m] += s[:m]
    if label:
        cues_log.append({"t": round(at, 3), "sfx": label})


# ----------------------------------------------------------------------------- voice-over
vo = np.zeros((N, 2))
vo_mask = np.zeros(N)
for line in TL["vo"]:
    f = next((p for p in (Path(args.vo) / f"{line['id']}.flac", Path(args.vo) / f"{line['id']}.wav") if p.exists()))
    y, sr = sf.read(f)
    assert sr == SR, f
    place(vo, y, line["at"], 0.0, 0.0)
    i0 = int(line["at"] * SR)
    vo_mask[i0:i0 + len(y)] = 1
    cues_log.append({"t": line["at"], "vo": line["id"], "dur": round(len(y) / SR, 3)})
# a touch of room on the voice so it sits in the film, mostly dry
room = dsp.reverb_ir(0.7, predelay=0.008, damp_hz=5000, seed=3, width=0.6)
vo_wet = dsp.convolve_reverb(vo.mean(axis=1), room)[:N]
vo = vo + vo_wet * 0.07

# ----------------------------------------------------------------------------- score
stem = {}
for name in ["piano", "strings", "pad", "pulse", "bass", "drums", "fx"]:
    y, sr = sf.read(Path(args.stems) / f"{name}.wav", always_2d=True)
    stem[name] = np.zeros((N, 2))
    stem[name][: min(N, len(y))] = y[:N]
gains = {"piano": 1.25, "strings": 0.42, "pad": 0.38, "pulse": 0.62, "bass": 0.85, "drums": 0.5, "fx": 0.55}
sends = {"piano": 0.38, "strings": 0.3, "pad": 0.25, "pulse": 0.16, "bass": 0.0, "drums": 0.06, "fx": 0.3}
music_dry = sum(stem[k] * gains[k] for k in stem)
send = sum(stem[k] * gains[k] * sends[k] for k in stem)
hall = dsp.reverb_ir(3.2, predelay=0.025, damp_hz=6000, seed=11, width=1.0)
music = music_dry + dsp.convolve_reverb(send, hall)[:N] * 0.55
music = dsp.eq(music, "highpass", 32, q=0.7)
# Score dynamics: discreet under the product narration, building through the
# montage to the apex ("CHAQUE ERREUR…"), then receding into silence.
AUTO = [(0, -60), (12.95, -60), (13.0, -7), (22.6, -6), (27.4, -6.5), (34.6, -7.5), (44.2, -7), (49.0, -5),
        (53.8, -3.5), (61.0, -2.5), (63.4, 0), (68.2, -1), (70.4, -6), (75.0, -6), (79.4, -60)]
ta, ga = zip(*AUTO)
music *= dsp.db(np.interp(np.arange(N) / SR, ta, ga))[:, None]

# ----------------------------------------------------------------------------- sound design
fxt = np.zeros((N, 2))
rt = sfx.room_tone(12.7 - 0.3)
rt = dsp.fade(rt, 1.2, 0.03)
place(fxt, rt, 0.3, 0, 0, "room tone")
place(fxt, sfx.clock(12.7 - 1.4, amp=0.55, start_phase=0.35)[: int((12.7 - 1.4) * SR)], 1.4, 0, 0.35, "wall clock")
place(fxt, sfx.pen(C["penOpen"][1] - C["penOpen"][0], 6, 0.8, seed=1), C["penOpen"][0], 0, -0.1, "pen (black)")
place(fxt, sfx.tick_mark(C["tickA"][1] - C["tickA"][0], seed=2), C["tickA"][0], 0, 0.15, "tick A")
place(fxt, sfx.tick_mark(C["tickB"][1] - C["tickB"][0], seed=3), C["tickB"][0], 0, 0.2, "tick B")
place(fxt, sfx.paper(0.6, 0.8), C["copiesIn"] if "copiesIn" in C else TL["scenes"]["copies"][0], 0, 0, "paper")
rng = np.random.default_rng(5)
for i in range(C["gradesCount"]):
    at = C["gradesStart"] + i * C["gradesStep"]
    place(fxt, sfx.pen(0.26, 9, 0.75 - i * 0.03, seed=10 + i), at, -2 - i * 0.4, float(rng.uniform(-0.65, 0.65)))
cues_log.append({"t": C["gradesStart"], "sfx": f"{C['gradesCount']} grade strokes"})
place(fxt, sfx.pen(C["underline"][1] - C["underline"][0], 3.5, 1.0, seed=4), C["underline"][0], 0, 0.05, "underline")
g0, g1 = C["grade8"]
q = (g1 - g0) / 4
for i in range(4):
    place(fxt, sfx.pen(q * 0.92, 4.5 if i != 1 else 2.5, 1.05, seed=20 + i), g0 + i * q, 0, -0.05)
cues_log.append({"t": g0, "sfx": "8/20 strokes"})
place(fxt, sfx.pen(C["gradeCircle"][1] - C["gradeCircle"][0], 2.2, 0.9, seed=30), C["gradeCircle"][0], 0, 0, "circle")

# Act II
place(fxt, sfx.pen(C["handLine"][1] - C["handLine"][0], 8, 0.35, seed=31), C["handLine"][0], -3, 0, "trace")
place(fxt, sfx.whoosh(0.85, 700, 2400, 0.5), C["split"][0] - 0.05, 0, 0, "split")
place(fxt, sfx.ui_tick(1800, 0.8), C["arcGood"][0], 0, -0.2, "arc 3·x")
place(fxt, sfx.ui_tick(1400, 0.9), C["arcBad"][0], 0, 0.1, "arc 3·2")
place(fxt, sfx.ui_tick(1250, 0.8), C["arcBad"][1], 0, 0.3)
place(fxt, sfx.ui_tick(2400, 0.7), C["labels"][0], 0, -0.1, "labels")
place(fxt, sfx.ui_tick(2600, 0.7), C["labels"][0] + 0.45, 0, 0.1)
place(fxt, sfx.shimmer(1.6, 1.0), C["logoImpact"] + 0.05, 0, 0, "logo shimmer")
place(fxt, sfx.whoosh(0.9, 1500, 600, 0.4), C["dock"][0], 0, -0.3, "dock")

# Act III
for i in range(6):
    place(fxt, sfx.ui_tick(2000 + i * 60, 0.35), C["listIn"] + 0.02 + i * 0.07 + (0.1 if i else 0), 0, -0.2 + i * 0.08)
place(fxt, sfx.click(), C["clickRow"], 0, 0.1, "click row")
place(fxt, sfx.whoosh(0.5, 900, 2600, 0.35), C["detailIn"], 0, 0, "detail")
for i in range(7):
    place(fxt, sfx.ui_tick(1900 + i * 70, 0.3), C["detailIn"] + i * 0.1 + 0.05, 0, -0.3 + i * 0.1)
place(fxt, sfx.glint(1.0), C["skillHighlight"], 0, 0.2, "highlight skill")
place(fxt, sfx.whoosh(1.0, 400, 900, 0.25), C["scrollToStruggling"][0], 0, 0, "scroll")
place(fxt, sfx.glint(0.9), C["emmaSpotlight"], 0, 0, "Emma row")
place(fxt, sfx.whoosh(0.7, 600, 2600, 0.45), C["conceptIn"], 0, 0.3, "concept panel")
place(fxt, sfx.paper(0.4, 0.35), C["conceptIn"] + 0.1, 0, 0.3)
place(fxt, sfx.pen(0.45, 3.5, 0.45, seed=40), C["conceptError"], -2, 0.3, "concept underline")
place(fxt, sfx.ui_tick(2200, 0.7), C["notionTags"][0], 0, 0.3, "notion")
place(fxt, sfx.ui_tick(2600, 0.7), C["notionTags"][1], 0, 0.35)
place(fxt, sfx.whoosh(0.35, 2600, 900, 0.5), C["matchCut"] - 0.12, 0, 0, "match cut")
place(fxt, sfx.whoosh(0.6, 500, 1600, 0.3), 44.95, 0, 0.2, "lift analysis")
place(fxt, sfx.glint(0.7), 46.8, 0, 0.2, "actions")
place(fxt, sfx.whoosh(0.4, 2400, 800, 0.45), C["dashboardIn"] - 0.1, 0, 0, "dashboard")
for i in range(7):
    place(fxt, sfx.ui_tick(2000 + i * 50, 0.28), C["dashboardIn"] + i * 0.08 + 0.05, 0, -0.3 + i * 0.1)
place(fxt, sfx.glint(0.6), 49.75, 0, -0.1, "Emma in feed")

# Act IV
place(fxt, sfx.whoosh(0.5, 3000, 700, 0.4), TL["scenes"]["roster"][0] - 0.12, 0, 0.2, "roster")
place(fxt, sfx.whoosh(0.4, 2400, 900, 0.4), TL["scenes"]["dialog"][0] - 0.1, 0, -0.2, "dialog")
place(fxt, sfx.click(), C["dialogClick"], 0, 0.15, "click confirm")
place(fxt, sfx.chime(1.0), C["dialogClick"] + 0.17, 0, 0, "confirmation")
place(fxt, sfx.pen(C["writeLine"][1] - C["writeLine"][0], 7.5, 0.6, seed=50), C["writeLine"][0], 0, 0.1, "student writing")
place(fxt, sfx.whoosh(0.6, 400, 1800, 0.4), TL["scenes"]["laptop"][0] - 0.1, 0, 0, "laptop")

# Act V
place(fxt, sfx.shimmer(1.4, 0.8), C["dotGlow"], 0, 0, "dot glow")
place(fxt, sfx.shimmer(0.9, 1.1), C["lightSweep"][0], 0, 0.1, "light sweep")

fx_wet = dsp.convolve_reverb(fxt, dsp.reverb_ir(1.2, predelay=0.01, damp_hz=7000, seed=5))[:N]
fxt = fxt + fx_wet * 0.12

# ----------------------------------------------------------------------------- ducking (music under voice)
env = dsp.envelope(np.convolve(vo_mask, np.ones(int(0.01 * SR)) / int(0.01 * SR), mode="same"), 0.08, 0.45)
duck = dsp.db(-7.0 * np.clip(env, 0, 1))
music *= duck[:, None]
# dialogue priority: sound design also steps back while the voice speaks
fxt *= dsp.db(-6.0 * np.clip(env, 0, 1))[:, None]

# ----------------------------------------------------------------------------- master
mix = music * 0.9 + vo * 1.0 + fxt * 1.0
mix = dsp.eq(mix, "highpass", 28, q=0.7)
mix = dsp.compress(mix, threshold_db=-16, ratio=1.8, attack=0.02, release=0.25)

meter = pyln.Meter(SR)


def lookahead_limit(x, ceiling_db=-1.5, look=0.005, release=0.08):
    c = dsp.db(ceiling_db)
    up = signal.resample_poly(x, 4, 1, axis=0)  # true-peak estimate
    peak = np.max(np.abs(up), axis=1).reshape(-1, 4).max(axis=1)[: len(x)]
    need = np.minimum(1.0, c / np.maximum(peak, 1e-9))
    L = int(look * SR)
    from scipy.ndimage import minimum_filter1d
    g = minimum_filter1d(need, size=2 * L + 1)
    a = np.exp(-1 / (release * SR))
    out = np.empty_like(g)
    cur = 1.0
    for i, v in enumerate(g):
        cur = v if v < cur else a * cur + (1 - a) * v
        out[i] = cur
    return x * out[:, None]


for _ in range(3):
    lufs = meter.integrated_loudness(mix)
    mix = mix * dsp.db(args.target - lufs)
    mix = lookahead_limit(mix)
# elegant silence at the very end
end_i = int((DUR - 0.6) * SR)
mix[end_i:] = 0

lufs = meter.integrated_loudness(mix)
tp = 20 * np.log10(np.max(np.abs(signal.resample_poly(mix, 4, 1, axis=0))) + 1e-12)
out = Path(args.out)
out.parent.mkdir(parents=True, exist_ok=True)
sf.write(out, mix.astype(np.float32), SR, subtype="PCM_24")
# stems for re-mixing
stems_out = out.parent / "stems"
stems_out.mkdir(exist_ok=True)
report = {"integrated_lufs": round(lufs, 2), "true_peak_dbtp": round(tp, 2), "duration_s": DUR, "cues": sorted(cues_log, key=lambda c: c["t"])}
Path(str(out) + ".report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
print(json.dumps({k: v for k, v in report.items() if k != "cues"}))
for name, y in (("music", music), ("voice", vo), ("sfx", fxt)):
    sf.write(stems_out / f"{name}.wav", y.astype(np.float32), SR, subtype="FLOAT")
