"""Original score for the FOCUS brand film — composed in code, synchronised to src/timeline.json.

D minor, 100 BPM (beat = 0.6 s, bar = 2.4 s), first bar at the title card (13.0 s).
  - piano + strings: FluidSynth with the MuseScore General soundfont (MIT / public-domain piano)
  - pad, pulse, sub bass, kick, ticks, risers, impacts: synthesised with numpy (dsp.py)
Writes WAV stems to <out_dir>/stems/*.wav (48 kHz stereo, film-length).

Usage: python score.py <timeline.json> <out_dir> [soundfont.sf3]
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import mido
import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).parent))
import dsp  # noqa: E402
from dsp import SR  # noqa: E402

TL = json.loads(Path(sys.argv[1]).read_text())
OUT = Path(sys.argv[2]) / "stems"
OUT.mkdir(parents=True, exist_ok=True)
SF = sys.argv[3] if len(sys.argv) > 3 else "/usr/share/sounds/sf3/MuseScore_General.sf3"
DUR = TL["duration"]
N = int(DUR * SR)
T0 = TL["music"]["start"]
BEAT = 60 / TL["music"]["bpm"]
BAR = 4 * BEAT
rng = np.random.default_rng(2026)


def bar(n, b=0.0):
    return T0 + n * BAR + b * BEAT


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ----------------------------------------------------------------------------- harmony
CH = {
    "Dm9": dict(bass=38, pad=[50, 57, 64, 65, 69], arp=[62, 69, 76, 69, 65, 69, 76, 72]),
    "Bb": dict(bass=34, pad=[46, 53, 57, 60, 62], arp=[58, 65, 72, 65, 62, 65, 69, 65]),
    "F": dict(bass=41, pad=[53, 57, 60, 67, 69], arp=[65, 72, 79, 72, 69, 72, 76, 72]),
    "FA": dict(bass=33, pad=[53, 57, 60, 67, 69], arp=[65, 72, 79, 72, 69, 72, 76, 72]),
    "C": dict(bass=36, pad=[48, 55, 62, 64, 67], arp=[60, 67, 74, 67, 64, 67, 74, 71]),
}
# one chord per bar (bar index -> chord), bars 0..22
PROG = ["Dm9", "Dm9", "Bb", "F", "Bb", "C", "Dm9", "Bb", "F", "C", "Dm9", "Bb", "F", "C", "Dm9", "Bb", "C",
        "Dm9", "Bb", "F", "C", "Bb", "C"]
APEX_END = TL["music"]["stop"]  # 68.2 — the groove stops, resolution to F major


# ----------------------------------------------------------------------------- MIDI parts (FluidSynth)
def render_midi(notes, program, gain=0.7, name="part"):
    """notes: list of (start_s, dur_s, midi, velocity). Returns stereo float array (film length)."""
    mid = mido.MidiFile(ticks_per_beat=480)
    tr = mido.MidiTrack()
    mid.tracks.append(tr)
    tr.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(TL["music"]["bpm"])))
    tr.append(mido.Message("program_change", program=program, channel=0))
    tr.append(mido.Message("control_change", control=91, value=0, channel=0))  # no internal reverb
    tr.append(mido.Message("control_change", control=93, value=0, channel=0))
    tps = 480 / BEAT  # ticks per second
    ev = []
    for s, d, m, v in notes:
        ev.append((int(round(s * tps)), 1, mido.Message("note_on", note=int(m), velocity=int(v), channel=0)))
        ev.append((int(round((s + d) * tps)), 0, mido.Message("note_off", note=int(m), velocity=0, channel=0)))
    ev.sort(key=lambda e: (e[0], e[1]))
    last = 0
    for tick, _, msg in ev:
        msg.time = tick - last
        last = tick
        tr.append(msg)
    with tempfile.TemporaryDirectory() as td:
        mp, wp = Path(td) / f"{name}.mid", Path(td) / f"{name}.wav"
        mid.save(mp)
        subprocess.run(["fluidsynth", "-ni", "-q", "-R", "0", "-C", "0", "-g", str(gain), "-r", str(SR), "-F", str(wp), SF, str(mp)],
                       check=True, capture_output=True)
        y, sr = sf.read(wp, always_2d=True)
    assert sr == SR
    out = np.zeros((N, 2))
    out[: min(N, len(y))] = y[:N]
    return out


def piano_part():
    n = []
    # Title: a single low octave opens the music, then a high answer
    n += [(bar(0), 6.0, 38, 58), (bar(0), 6.0, 50, 52), (bar(0, 2.5), 3.0, 76, 30)]
    # Analysis: sparse, questioning
    n += [(bar(1), 2.0, 69, 40), (bar(1, 2), 2.0, 65, 34), (bar(2), 2.4, 62, 38), (bar(2, 2), 1.6, 65, 32),
          (bar(3), 2.0, 64, 36), (bar(3, 2), 2.4, 60, 32)]
    # Three words: one chord each (Comprendre / Identifier / Accompagner)
    for (b, ch, vel) in [(cue_bar("words", 0), "Bb", 52), (cue_bar("words", 1), "FA", 54), (cue_bar("words", 2), "C", 58)]:
        for m in CH[ch]["pad"][1:]:
            n.append((b, 1.15 if ch != "C" else 1.2, m, vel - 8))
        n.append((b, 1.2, CH[ch]["bass"] + 12, vel))
    # Logo: full Dm9 bloom
    li = TL["cues"]["logoImpact"]
    n += [(li, 4.0, 38, 70), (li, 4.0, 50, 56), (li, 4.0, 57, 50), (li, 4.0, 64, 50), (li, 4.0, 69, 46), (li + 0.6, 3.0, 76, 40)]
    # Act III melody (bars 6..16), a calm, confident line
    mel = {6: [(0, 69), (2, 65), (3, 64)], 7: [(0, 62), (2, 65)], 8: [(0, 72), (1.5, 69), (3, 67)], 9: [(0, 64), (2, 67), (3, 74)],
           10: [(0, 69), (2, 65), (3, 64)], 11: [(0, 74), (1.5, 72), (2, 69)], 12: [(0, 72), (2, 69), (3, 67)], 13: [(0, 76), (2, 74)],
           14: [(0, 77), (1, 76), (2, 74), (3, 69)], 15: [(0, 74), (2, 72)], 16: [(0, 76), (2, 79)]}
    for b, notes in mel.items():
        for (bt, m) in notes:
            vel = 40 + int((b - 6) * 2.2)
            n.append((bar(b, bt), 1.4, m, vel))
        # left hand: open fifth on the downbeat
        r = CH[PROG[b]]["bass"] + 12
        n += [(bar(b), 2.3, r, 36 + (b - 6)), (bar(b), 2.3, r + 7, 30 + (b - 6))]
    # Act IV: melody an octave up, stronger, with chord stabs on beats 1 & 3
    mel4 = {17: [(0, 81), (2, 77), (3, 76)], 18: [(0, 74), (2, 77)], 19: [(0, 84), (1.5, 81), (3, 79)], 20: [(0, 76), (2, 79), (3, 86)]}
    for b, notes in mel4.items():
        for (bt, m) in notes:
            n.append((bar(b, bt), 1.2, m, 62))
        for bt in (0, 2):
            for m in CH[PROG[b]]["pad"][1:4]:
                n.append((bar(b, bt), 0.9, m + 12, 44))
    # Apex
    n += [(bar(21), 2.4, 46, 80), (bar(21), 2.4, 58, 72), (bar(21), 2.4, 65, 70), (bar(21), 2.4, 77, 74), (bar(21, 2), 1.2, 81, 66),
          (bar(22), 1.2, 48, 76), (bar(22), 2.4, 60, 70), (bar(22), 1.2, 76, 70), (bar(22, 2), 1.2, 79, 68)]
    # Resolution (68.2): F major, music slows
    r = APEX_END
    n += [(r, 7.0, 29, 60), (r, 7.0, 41, 56), (r, 7.0, 60, 44), (r, 7.0, 64, 40), (r, 7.0, 67, 38), (r, 7.0, 69, 36)]
    # Signature: the piano answers the voice between its phrases, then the final chord
    n += [(71.25, 2.0, 81, 32), (72.9, 2.0, 77, 28), (74.8, 6.0, 41, 50), (74.8, 6.0, 53, 40), (74.8, 6.0, 72, 36), (74.8, 6.0, 76, 34),
          (74.8, 6.0, 79, 30)]
    return n


def cue_bar(k, i):
    return TL["cues"][k][i]


def strings_part():
    n = []
    # enter under the concept panel (bar 11), build to the apex
    for b in range(11, 23):
        ch = CH[PROG[b]]
        vel = int(np.interp(b, [11, 16, 17, 21, 22], [44, 70, 74, 104, 100]))
        for m in ch["pad"][:4]:
            n.append((bar(b), BAR + 0.15, m + (12 if b >= 17 else 0), vel))
        n.append((bar(b), BAR + 0.15, ch["bass"] + 12, vel - 6))
    # resolution chord, long
    for m in [53, 57, 60, 65, 69]:
        n.append((APEX_END, 6.5, m, 64))
    return n


# ----------------------------------------------------------------------------- synths
def adsr(n, a, d, s, r, sr=SR):
    env = np.ones(n) * s
    na, nd, nr = int(a * sr), int(d * sr), int(r * sr)
    na = min(na, n)
    env[:na] = np.linspace(0, 1, na)
    if nd:
        e = min(n, na + nd)
        env[na:e] = np.linspace(1, s, e - na)
    if nr:
        env[-nr:] *= np.linspace(1, 0, nr)
    return env


def saw(freq, n, phase=0.0):
    ph = (phase + np.arange(n) * freq / SR) % 1.0
    return 2 * ph - 1


def lowpass_sweep(x, cut_fn, q=0.7):
    """Block-wise time-varying low-pass (cut_fn: sample index array -> Hz)."""
    from scipy import signal
    y = np.zeros_like(x)
    zi = np.zeros(2)
    blk = 512
    for i in range(0, len(x), blk):
        c = float(np.clip(cut_fn(i), 80, 18000))
        b, a = dsp.biquad("lowpass", c, SR, q)
        if i == 0:
            zi = signal.lfilter_zi(b, a) * x[0]
        y[i:i + blk], zi = signal.lfilter(b, a, x[i:i + blk], zi=zi)
    return y


def section_bright(t):
    return float(np.interp(t, [13, 27.4, 34.6, 49.0, 53.8, 63.4, 68.2, 72], [700, 900, 1300, 1700, 2600, 3600, 1200, 800]))


def pad_stem():
    out = np.zeros((N, 2))
    events = [(bar(b), BAR, PROG[b]) for b in range(0, 23)]
    events.append((APEX_END, 8.0, "F"))
    for (s, d, chn) in events:
        notes = CH[chn]["pad"]
        length = int((d + 1.6) * SR)
        i0 = int(s * SR)
        if i0 >= N:
            continue
        length = min(length, N - i0)
        mix = np.zeros((length, 2))
        for m in notes:
            f = midi_hz(m)
            for v in range(5):
                det = (v - 2) * 0.09  # semitone cents spread
                fv = f * 2 ** (det / 12)
                w = saw(fv, length, rng.random())
                pan = (v - 2) / 2.2
                mix += dsp.pan(w, pan) * 0.06
        env = adsr(length, 0.9 if s < 27 else 0.45, 0.4, 0.85, 1.4)
        mix *= env[:, None]
        bright = section_bright(s)
        for c in range(2):
            mix[:, c] = lowpass_sweep(mix[:, c], lambda i: bright * (0.75 + 0.25 * np.sin(2 * np.pi * 0.07 * (s + i / SR))), q=0.6)
        out[i0:i0 + length] += mix
    # first swell is slower and quieter
    gain = np.interp(np.arange(N) / SR, [12.9, 13.0, 16, 27.4, 49, 53.8, 63.4, 68.2, 70, 79.5], [0, 0.35, 0.6, 0.7, 0.8, 0.9, 1.0, 0.8, 0.7, 0])
    return out * gain[:, None]


def pulse_stem():
    out = np.zeros((N, 2))
    for b in range(7, 23):
        arp = CH[PROG[b]]["arp"]
        for i in range(8):
            s = bar(b, i * 0.5)
            m = arp[i] + (12 if b >= 17 else 0)
            f = midi_hz(m)
            L = int(0.42 * SR)
            i0 = int(s * SR)
            w = 0.55 * saw(f, L) + 0.45 * np.sign(np.sin(2 * np.pi * f * np.arange(L) / SR))
            env = np.exp(-np.arange(L) / (0.16 * SR))
            env[: int(0.003 * SR)] *= np.linspace(0, 1, int(0.003 * SR))
            bright = section_bright(s) * 1.4
            cut = lambda k, bright=bright: bright * (0.35 + 0.65 * np.exp(-k / (0.07 * SR)))  # noqa: E731
            w = lowpass_sweep(w * env, cut, q=1.1)
            accent = 1.0 if i % 2 == 0 else 0.72
            out[i0:i0 + L] += dsp.pan(w * accent, 0.35 if i % 2 else -0.35)[: max(0, min(L, N - i0))]
    gain = np.interp(np.arange(N) / SR, [29.6, 29.8, 34.6, 49.0, 53.8, 63.4, 68.15, 68.25], [0, 0.18, 0.26, 0.34, 0.44, 0.5, 0.5, 0])
    return out * gain[:, None]


def bass_stem():
    out = np.zeros(N)
    for b in range(9, 23):
        root = CH[PROG[b]]["bass"]
        f = midi_hz(root)
        if b < 17:
            s, L = bar(b), int((BAR + 0.1) * SR)
            t = np.arange(L) / SR
            w = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
            w *= adsr(L, 0.08, 0.3, 0.8, 0.4)
            i0 = int(s * SR)
            out[i0:i0 + L] += w[: max(0, min(L, N - i0))]
        else:  # 8th-note octave pumping in the montage
            for i in range(8):
                s = bar(b, i * 0.5)
                L = int(0.29 * SR)
                t = np.arange(L) / SR
                ff = f * (2 if i % 2 else 1)
                w = np.sin(2 * np.pi * ff * t) + 0.3 * np.sin(4 * np.pi * ff * t)
                w *= adsr(L, 0.004, 0.08, 0.6, 0.1)
                i0 = int(s * SR)
                out[i0:i0 + L] += w[: max(0, min(L, N - i0))]
    # resolution: long low F
    L = int(9 * SR)
    t = np.arange(L) / SR
    i0 = int(APEX_END * SR)
    out[i0:i0 + L] += (np.sin(2 * np.pi * midi_hz(29) * t) * adsr(L, 0.05, 1.0, 0.6, 4.0))[: N - i0]
    out = np.tanh(out * 1.3) * 0.5
    gain = np.interp(np.arange(N) / SR, [34.5, 34.6, 49, 53.8, 63.4, 68.2, 75, 79.5], [0, 0.32, 0.4, 0.5, 0.56, 0.4, 0.3, 0])
    return dsp.to_stereo(out * gain)


def kick(L=0.5, f0=110, f1=42, amp=1.0):
    n = int(L * SR)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.18)
    click = rng.standard_normal(n) * np.exp(-t / 0.003) * 0.25
    return (body + dsp.eq(click, "lowpass", 3000)) * amp


def drums_stem():
    out = np.zeros(N)
    hat = np.zeros(N)
    for b in range(10, 23):
        if b < 15:
            beats, amp = [0], 0.45
        elif b < 17:
            beats, amp = [0, 2], 0.6
        else:
            beats, amp = [0, 1, 2, 3], 0.78
        for bt in beats:
            k = kick(amp=amp * (1.0 if bt == 0 else 0.85))
            i0 = int(bar(b, bt) * SR)
            out[i0:i0 + len(k)] += k[: max(0, min(len(k), N - i0))]
        if b >= 15:
            steps = 8 if b < 17 else 16
            for i in range(steps):
                s = bar(b, i * 4 / steps)
                L = int(0.05 * SR)
                nz = rng.standard_normal(L) * np.exp(-np.arange(L) / (0.008 * SR))
                nz = dsp.eq(nz, "highpass", 7000)
                acc = 1.0 if i % (steps // 4) == 0 else 0.5
                i0 = int(s * SR)
                hat[i0:i0 + L] += (nz * acc * 0.12)[: max(0, min(L, N - i0))]
    # cut everything at the apex end
    cut = np.arange(N) / SR < APEX_END
    out *= cut
    hat *= cut
    return dsp.to_stereo(out) * 0.7 + dsp.pan(hat, 0.25)


def riser(t0, t1, kind="noise"):
    n = int((t1 - t0) * SR)
    t = np.arange(n) / SR
    p = t / (t1 - t0)
    nz = rng.standard_normal(n)
    from scipy import signal
    y = np.zeros(n)
    zi = np.zeros(2)
    blk = 512
    for i in range(0, n, blk):
        fc = 300 * (25 ** p[i])
        b, a = dsp.biquad("bandpass", fc, SR, 1.2)
        y[i:i + blk], zi = signal.lfilter(b, a, nz[i:i + blk], zi=zi)
    y *= p ** 2.2
    tone = np.sin(2 * np.pi * np.cumsum(110 * 2 ** (2 * p)) / SR) * p ** 3 * 0.15
    return y * 0.5 + tone


def impact(amp=1.0, L=3.0):
    n = int(L * SR)
    t = np.arange(n) / SR
    f = 34 + 30 * np.exp(-t / 0.12)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9)
    thump = dsp.eq(rng.standard_normal(n), "lowpass", 160) * np.exp(-t / 0.08) * 0.8
    air = dsp.eq(rng.standard_normal(n), "highpass", 5000) * np.exp(-t / 0.7) * 0.05
    return (boom + thump + air) * amp


def fx_stem():
    out = np.zeros(N)

    def put(sig, at):
        i0 = int(at * SR)
        out[i0:i0 + len(sig)] += sig[: max(0, min(len(sig), N - i0))]

    put(impact(0.55), TL["cues"]["logoImpact"])
    put(riser(51.4, 53.8), 51.4)
    put(impact(0.5, 2.5), 53.8)
    put(riser(61.2, 63.4) * 1.1, 61.2)
    put(impact(0.9, 4.0), 63.4)
    put(riser(66.4, 68.2) * 0.7, 66.4)
    sq = TL["cues"]["square"]
    swell = riser(sq[0] - 0.5, sq[1] - 0.25) * 0.45
    put(dsp.eq(swell, "lowpass", 5000), sq[0] - 0.5)
    put(impact(0.32, 4.0), sq[1] - 0.25)
    return dsp.to_stereo(out)


# ----------------------------------------------------------------------------- write stems
stems = {
    "piano": render_midi(piano_part(), program=0, gain=0.9, name="piano"),
    "strings": render_midi(strings_part(), program=49, gain=0.8, name="strings"),
    "pad": pad_stem(),
    "pulse": pulse_stem(),
    "bass": bass_stem(),
    "drums": drums_stem(),
    "fx": fx_stem(),
}
# Piano: felt-like softening
p = stems["piano"]
p = dsp.eq(p, "lowpass", 5200, q=0.6)
p = dsp.eq(p, "lowshelf", 220, gain_db=1.5)
stems["piano"] = p
for name, y in stems.items():
    sf.write(OUT / f"{name}.wav", y.astype(np.float32), SR, subtype="FLOAT")
    print(name, "peak", round(float(np.max(np.abs(y))), 3))
