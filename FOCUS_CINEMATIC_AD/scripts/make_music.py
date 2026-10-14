"""Original score + sound design for "FOCUS — See beyond the grade" (55 s).

Composed programmatically and rendered locally:
  * orchestral layers (piano, strings, tremolo strings, choir, celesta, timpani)
    -> MIDI written with mido, rendered by FluidSynth with the MuseScore General
       SoundFont (MIT; samples CC0 / public domain);
  * electronic layers (sub pulse, bass, arpeggiator, ticks, risers, impacts)
    -> synthesised with numpy/numba;
  * convolution reverb with a synthetic impulse response.

D minor, 96 BPM (one bar = 2.5 s). All cue times below are film seconds and
match the edit (see EDL in assemble_film.py).

Outputs (audio/):
  score_orch.wav, score_synth.wav, sfx.wav, score.wav (orch+synth premix)
"""
import json
import os
import subprocess

import mido
import numpy as np
import soundfile as sf
from numba import njit
from scipy.signal import butter, fftconvolve, sosfilt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUD = os.path.join(ROOT, "audio")
TMP = os.path.join(AUD, "_stems")
os.makedirs(TMP, exist_ok=True)
SF2 = "/usr/share/sounds/sf2/MuseScore_General_Full.sf2"
SR = 48000
DUR = 55.0
N = int(DUR * SR)
BEAT = 0.625
BAR = 2.5
rng = np.random.default_rng(5)

NOTE = {n: i for i, n in enumerate(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])}
NOTE.update({"Db": 1, "Eb": 3, "Gb": 6, "Ab": 8, "Bb": 10})


def m(name):
    """'D5' -> midi number"""
    p, o = name[:-1], int(name[-1])
    return 12 * (o + 1) + NOTE[p]


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


# ============================================================ EVENT TIMELINE
CUES = {
    "seq2": 10.0, "impact1": 13.75, "punch": 15.6, "seq3": 17.5,
    "w_evidence": 20.0, "w_understanding": 22.5, "w_next": 25.0, "verify": 27.5,
    "seq4": 32.5, "seq5": 45.0, "cut": 50.0, "reveal": 50.5, "end": 55.0,
}

# chord per bar (root, chord tones as midi numbers)
CH = {
    "Dm": ["D2", ["D3", "F3", "A3", "D4"]], "Bb": ["Bb1", ["Bb2", "D3", "F3", "Bb3"]],
    "F": ["F2", ["F3", "A3", "C4", "F4"]], "C": ["C2", ["C3", "E3", "G3", "C4"]],
    "Gm": ["G1", ["G2", "Bb2", "D3", "G3"]], "Am": ["A1", ["A2", "C3", "E3", "A3"]],
}
# bars 7..12 (17.5-32.5) and 13..17 (32.5-45) and 18..19 (45-50)
PROG = {7: "Dm", 8: "Bb", 9: "F", 10: "C", 11: "Dm", 12: "Bb",
        13: "F", 14: "C", 15: "Dm", 16: "Bb", 17: "F", 18: "Bb", 19: "C"}

# =================================================================== MIDI


class Track:
    def __init__(self, program, channel=0):
        self.ev = []          # (time_s, msg)
        self.ch = channel
        self.ev.append((0.0, mido.Message("program_change", program=program, channel=channel)))
        self.cc(0.0, 7, 110)
        self.cc(0.0, 11, 100)

    def note(self, t, n, dur, vel):
        n = m(n) if isinstance(n, str) else n
        self.ev.append((t, mido.Message("note_on", note=n, velocity=int(max(1, min(127, vel))), channel=self.ch)))
        self.ev.append((t + dur, mido.Message("note_off", note=n, velocity=0, channel=self.ch)))

    def cc(self, t, ctl, val):
        self.ev.append((t, mido.Message("control_change", control=ctl, value=int(max(0, min(127, val))), channel=self.ch)))

    def ramp(self, t0, t1, v0, v1, ctl=11, steps=None):
        steps = steps or max(int((t1 - t0) * 20), 2)
        for i in range(steps + 1):
            u = i / steps
            self.cc(t0 + (t1 - t0) * u, ctl, v0 + (v1 - v0) * u)

    def save(self, path):
        mid = mido.MidiFile(ticks_per_beat=960)
        tr = mido.MidiTrack()
        mid.tracks.append(tr)
        tempo = mido.bpm2tempo(96)
        tr.append(mido.MetaMessage("set_tempo", tempo=tempo, time=0))
        ev = sorted(self.ev, key=lambda e: (e[0], 0 if e[1].type == "note_off" else 1))
        last = 0
        for t, msg in ev:
            tick = int(round(mido.second2tick(t, 960, tempo)))
            tr.append(msg.copy(time=max(tick - last, 0)))
            last = max(tick, last)
        mid.save(path)


def render_midi(track, name, gain=0.7):
    mid = os.path.join(TMP, f"{name}.mid")
    wav = os.path.join(TMP, f"{name}.wav")
    track.save(mid)
    subprocess.run(["fluidsynth", "-ni", "-q", "-R", "0", "-C", "0", "-r", str(SR), "-g", str(gain),
                    "-F", wav, SF2, mid], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    y, sr = sf.read(wav)
    assert sr == SR
    if y.ndim == 1:
        y = np.stack([y, y], 1)
    out = np.zeros((N, 2))
    k = min(N, len(y))
    out[:k] = y[:k]
    return out


# ---------------------------------------------------------------- piano
piano = Track(0)
piano.cc(0.0, 64, 127)            # sustain pedal for a soft resonant piano
motif1 = [(1.0, "D5", 1.8, 50), (1.85, "A4", 1.5, 41), (2.5, "F4", 1.3, 38), (3.15, "E4", 2.0, 37)]
motif2 = [(5.0, "D5", 1.4, 47), (5.62, "A4", 1.2, 39), (6.25, "G4", 1.0, 37), (6.88, "F4", 1.0, 35), (7.5, "E4", 2.2, 40)]
for t, n, d, v in motif1 + motif2:
    piano.note(t, n, d, v)
piano.note(0.6, "D3", 4.2, 34)
piano.note(0.6, "A3", 4.2, 28)
piano.note(5.0, "Bb2", 2.4, 32)
piano.note(7.5, "A2", 2.6, 33)
piano.note(8.75, "C#5", 1.3, 30)
piano.cc(9.95, 64, 0)
piano.cc(10.0, 64, 127)
# verification moment (human hand) 27.5-32.5: the motif returns, higher and calmer
for t, n, d, v in [(27.5, "A5", 1.2, 42), (28.1, "F5", 1.0, 36), (28.75, "E5", 1.0, 35), (29.4, "D5", 1.8, 40),
                   (30.0, "D4", 2.4, 30), (30.6, "A5", 0.9, 34), (31.25, "G5", 0.9, 33), (31.9, "F5", 1.2, 34)]:
    piano.note(t, n, d, v)
piano.cc(32.45, 64, 0)
piano.cc(32.5, 64, 127)
# product section: gentle broken chords
for bar in range(13, 18):
    root, tones = CH[PROG[bar]]
    t0 = bar * BAR
    pat = [tones[0], tones[2], tones[3], tones[1] if bar % 2 else tones[2]]
    for i, n in enumerate(pat):
        piano.note(t0 + i * BEAT, m(n) + 12, BEAT * 1.6, 34 + (6 if i == 0 else 0))
    piano.cc(t0 + BAR - 0.03, 64, 0)
    piano.cc(t0 + BAR, 64, 127)
# human section melody
for t, n, d, v in [(45.0, "F5", 1.2, 46), (45.62, "D5", 0.9, 40), (46.25, "C5", 1.0, 40), (46.88, "D5", 1.2, 44),
                   (47.5, "E5", 1.2, 46), (48.12, "G5", 0.9, 44), (48.75, "A5", 1.2, 50), (49.38, "C6", 0.6, 52)]:
    piano.note(t, n, d, v)
piano.cc(49.98, 64, 0)
# reveal: two high notes over the final chord
piano.cc(50.5, 64, 127)
piano.note(50.55, "A5", 3.5, 46)
piano.note(52.2, "C6", 2.8, 40)
piano.note(52.2, "F4", 2.8, 30)

# ---------------------------------------------------------------- strings (slow)
strings = Track(49)
strings.cc(0, 11, 25)
for n in ("D3", "A3"):
    strings.note(0.3, n, 9.6, 60)
strings.note(5.0, "F3", 4.9, 52)
strings.note(5.0, "Bb2", 2.5, 55)
strings.note(7.5, "A2", 2.4, 55)
strings.ramp(0.3, 9.5, 25, 70)
strings.ramp(9.5, 10.0, 70, 40)
# after the impact: Bb major bloom, then C major lead-in
for n in ("Bb2", "F3", "D4", "F4"):
    strings.note(13.75, n, 2.45, 72)
for n in ("C3", "G3", "E4", "G4"):
    strings.note(16.25, n, 1.25, 70)
strings.ramp(13.75, 14.6, 40, 92)
strings.ramp(14.6, 17.4, 92, 80)
# intelligence section sustained chords
for bar in range(7, 13):
    root, tones = CH[PROG[bar]]
    for n in tones[1:]:
        strings.note(bar * BAR, n, BAR - 0.02, 58)
strings.ramp(17.5, 27.5, 60, 88)
strings.ramp(27.5, 29.0, 88, 62)
strings.ramp(29.0, 32.4, 62, 84)
# product: warm, lower
for bar in range(13, 18):
    root, tones = CH[PROG[bar]]
    for n in (tones[0], tones[2]):
        strings.note(bar * BAR, n, BAR - 0.02, 52)
strings.ramp(32.5, 33.5, 50, 64)
strings.ramp(33.5, 45.0, 64, 66)

# ---------------------------------------------------------------- full strings (human swell + reveal)
tutti = Track(48)
tutti.cc(0, 11, 50)
for n in ("Bb2", "F3", "D4", "F4", "Bb4"):
    tutti.note(45.0, n, 2.5, 74)
for n in ("C3", "G3", "E4", "G4", "C5"):
    tutti.note(47.5, n, 2.5, 82)
tutti.ramp(45.0, 49.95, 50, 124)
tutti.cc(49.98, 11, 0)
tutti.cc(50.5, 11, 40)
for n in ("F2", "C3", "A3", "E4", "G4"):
    tutti.note(50.5, n, 4.3, 70)
tutti.ramp(50.5, 51.8, 40, 92)
tutti.ramp(51.8, 54.8, 92, 30)
# marcato low hit on the transformation impact
for n in ("D2", "D3", "A3"):
    tutti.note(13.75, n, 0.7, 118)

# ---------------------------------------------------------------- tremolo tension into the impact
trem = Track(44)
trem.cc(0, 11, 30)
for n in ("D3", "A3", "D4"):
    trem.note(11.25, n, 2.48, 80)
trem.ramp(11.25, 13.7, 30, 115)
for n in ("A2", "E3", "A3"):                # 31.25: tension before the screen transition
    trem.note(31.25, n, 1.22, 70)
trem.ramp(31.25, 32.45, 20, 100)

# ---------------------------------------------------------------- choir
choir = Track(52)
choir.cc(0, 11, 30)
for n in ("D4", "A4"):
    choir.note(14.0, n, 3.4, 52)
choir.ramp(14.0, 15.5, 30, 75)
choir.ramp(15.5, 17.4, 75, 40)
for n in ("F4", "A4", "C5"):
    choir.note(50.6, n, 4.2, 54)
choir.ramp(50.6, 52.0, 25, 80)
choir.ramp(52.0, 54.8, 80, 20)
for n in ("D4", "F4"):
    choir.note(45.0, n, 4.9, 45)
choir.ramp(45.0, 49.9, 30, 85)

# ---------------------------------------------------------------- celesta glass arpeggio (signal)
cel = Track(8)
arp = ["D5", "A5", "E5", "F5", "A5", "D6", "C6", "A5"]
t = 10.0
i = 0
while t < 13.7:
    u = (t - 10.0) / 3.7
    cel.note(t, arp[i % len(arp)], 0.5, 26 + 40 * u)
    t += BEAT / 2
    i += 1
# word hits
for tt, n in ((20.0, "A6"), (22.5, "F6"), (25.0, "D6")):
    cel.note(tt, n, 1.5, 62)
    cel.note(tt + 0.01, m(n) - 12, 1.5, 50)

# ---------------------------------------------------------------- timpani
timp = Track(47)
timp.note(13.75, "D2", 1.5, 120)
timp.note(32.5, "A1", 1.5, 96)
tt = 48.75
while tt < 49.95:                       # roll into the cut
    u = (tt - 48.75) / 1.2
    timp.note(tt, "C2", 0.2, 50 + 70 * u)
    tt += 0.06
timp.note(50.5, "F1", 2.5, 112)

stems = {
    "piano": render_midi(piano, "piano", 0.9) * 0.9,
    "strings": render_midi(strings, "strings", 0.8),
    "tutti": render_midi(tutti, "tutti", 0.8),
    "trem": render_midi(trem, "trem", 0.7) * 0.8,
    "choir": render_midi(choir, "choir", 0.6) * 0.65,
    "celesta": render_midi(cel, "celesta", 0.7) * 0.75,
    "timp": render_midi(timp, "timp", 0.8),
}

# ================================================================= SYNTHESIS


@njit(cache=True)
def svf(x, cutoff, q, sr):
    """Chamberlin/Simper state-variable low-pass with per-sample cutoff."""
    y = np.zeros_like(x)
    ic1 = 0.0
    ic2 = 0.0
    k = 1.0 / q
    for i in range(x.shape[0]):
        g = np.tan(np.pi * min(cutoff[i], sr * 0.45) / sr)
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        y[i] = v2
    return y


def saw(freq, n, detune=0.0, phase=0.0):
    t = np.arange(n) / SR
    out = np.zeros(n)
    for d in ((-detune, 0.0, detune) if detune else (0.0,)):
        f = freq * (2 ** (d / 1200))
        ph = (t * f + phase + rng.random()) % 1.0
        # PolyBLEP-free approximation is fine once low-passed
        out += 2 * ph - 1
    return out / (3 if detune else 1)


def env_adsr(n, a, d, s, r, sus_len=None):
    a, d, r = int(a * SR), int(d * SR), int(r * SR)
    sus_len = n - a - d - r if sus_len is None else int(sus_len * SR)
    sus_len = max(sus_len, 0)
    e = np.concatenate([np.linspace(0, 1, max(a, 1)), np.linspace(1, s, max(d, 1)), np.full(sus_len, s),
                        np.linspace(s, 0, max(r, 1))])
    return np.pad(e, (0, max(n - len(e), 0)))[:n]


def place(buf, t, sig, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= len(buf):
        return
    sig = sig[: len(buf) - i]
    if sig.ndim == 1:
        lg, rg = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        buf[i:i + len(sig), 0] += sig * gain * lg * 1.414
        buf[i:i + len(sig), 1] += sig * gain * rg * 1.414
    else:
        buf[i:i + len(sig)] += sig * gain


def lp(x, fc, order=2):
    return sosfilt(butter(order, fc, "low", fs=SR, output="sos"), x, axis=0)


def hp(x, fc, order=2):
    return sosfilt(butter(order, fc, "high", fs=SR, output="sos"), x, axis=0)


def bp(x, f1, f2, order=2):
    return sosfilt(butter(order, [f1, f2], "band", fs=SR, output="sos"), x, axis=0)


synth = np.zeros((N, 2))
sfx = np.zeros((N, 2))


def chord_at(t):
    bar = int(t // BAR)
    return PROG.get(bar, "Dm")


# ---- sub "heartbeat" on beats in the intelligence + product sections
def sub_thump(f0=52, length=0.5):
    n = int(length * SR)
    tt = np.arange(n) / SR
    f = f0 * (1 + 1.2 * np.exp(-tt * 40))
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-tt * 7) * (1 - np.exp(-tt * 400))


t = CUES["seq3"]
while t < CUES["seq5"] - 0.01:
    sec4 = t >= CUES["seq4"]
    g = 0.30 if not sec4 else 0.18
    if CUES["verify"] <= t < CUES["seq4"] - 2.5:
        g = 0.16
    root = m(CH[chord_at(t)][0])
    place(synth, t, sub_thump(hz(root + 12) if hz(root + 12) < 70 else hz(root)), g)
    t += BEAT

# ---- bass: filtered saw 8ths following the progression (17.5 - 45)
bass = np.zeros(N)
cut = np.full(N, 200.0)
t = CUES["seq3"]
while t < CUES["seq5"] - 0.01:
    root = m(CH[chord_at(t)][0])
    n = int(BEAT / 2 * SR)
    note = saw(hz(root + 12), n, detune=8) * env_adsr(n, 0.004, 0.12, 0.55, 0.05)
    i = int(t * SR)
    bass[i:i + n] += note[: max(0, min(n, N - i))]
    t += BEAT / 2
tt = np.arange(N) / SR
cut = np.interp(tt, [17.5, 27.5, 30.0, 32.4, 32.5, 45.0], [260, 1100, 600, 1400, 500, 700])
bass = svf(bass, cut, 0.9, SR) * 0.35
bass[tt < 17.5] = 0
# sidechain-style pump from the beat
pump = 1 - 0.55 * np.exp(-((tt - 17.5) % BEAT) * 9)
bass *= pump
place(synth, 0, np.stack([bass, bass], 1))

# ---- arpeggiator plucks (15.0 - 45), stereo ping-pong delay
arp_sig = np.zeros((N, 2))
t = 15.0
step = 0
while t < CUES["seq5"] - 0.01:
    name = chord_at(t) if t >= 17.5 else ("Bb" if t < 16.25 else "C")
    tones = [m(x) for x in CH[name][1]]
    pat = [tones[0] + 12, tones[2] + 12, tones[1] + 24, tones[2] + 12, tones[3] + 12, tones[1] + 12, tones[2] + 24, tones[3]]
    note_m = pat[step % len(pat)]
    n = int(0.28 * SR)
    sig = saw(hz(note_m), n, detune=6)
    fc = np.linspace(4200, 600, n)
    sig = svf(sig, fc, 1.3, SR) * np.exp(-np.arange(n) / SR * 14)
    vel = 0.10 + 0.05 * (step % 4 == 0)
    if t < 17.5:
        vel *= (t - 15.0) / 2.5
    if CUES["seq4"] <= t:
        vel *= 0.55
    if CUES["verify"] <= t < 30.0:
        vel *= 0.5
    place(arp_sig, t, sig, vel, pan=-0.35 if step % 2 else 0.35)
    t += BEAT / 4
    step += 1
dl = int(BEAT * 0.75 * SR)
delayed = np.zeros_like(arp_sig)
delayed[dl:, 0] = arp_sig[:-dl, 1] * 0.35
delayed[2 * dl:, 1] = arp_sig[:-2 * dl, 0] * 0.25
arp_sig = arp_sig + lp(delayed, 3000)
synth += arp_sig

# ---- ticks (digital hats) on 16ths in the intelligence section
t = CUES["seq3"] + BAR
k = 0
while t < CUES["seq4"] - 0.01:
    n = int(0.03 * SR)
    noise = hp(rng.normal(0, 1, n), 7000) * np.exp(-np.arange(n) / SR * 160)
    acc = 1.0 if k % 4 == 2 else 0.45
    if CUES["verify"] <= t < 30.0:
        acc *= 0.4
    place(synth, t, noise, 0.035 * acc, pan=0.25 if k % 2 else -0.25)
    t += BEAT / 4
    k += 1

# ---- low drone D1 under section A + reveal pad shimmer
n = int(10.2 * SR)
dr = np.sin(2 * np.pi * hz(m("D1")) * np.arange(n) / SR) + 0.3 * np.sin(2 * np.pi * hz(m("D2")) * np.arange(n) / SR)
dr *= env_adsr(n, 3.0, 1.0, 1.0, 0.8) * 0.03
place(synth, 0.0, dr)
n = int(4.5 * SR)
pad = np.zeros(n)
for nm in ("F3", "C4", "A4", "E5", "G5"):
    pad += saw(hz(m(nm)), n, detune=10)
pad = lp(pad, 2400) * env_adsr(n, 0.6, 0.5, 0.8, 2.5) * 0.05
place(synth, 50.5, np.stack([pad, np.roll(pad, 371)], 1))

# ================================================================== SOUND DESIGN


def impact(length=4.0, f_hi=90, f_lo=30, noise_amt=0.6, bright=2500):
    n = int(length * SR)
    tt = np.arange(n) / SR
    f = f_lo + (f_hi - f_lo) * np.exp(-tt * 6)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 1.6)
    crack = lp(rng.normal(0, 1, n), bright) * np.exp(-tt * 18) * noise_amt
    body = lp(rng.normal(0, 1, n), 300) * np.exp(-tt * 3.5) * 0.8
    s = boom + crack + body
    return s / np.max(np.abs(s))


def riser(length, f0=200, f1=2400, noise=True):
    n = int(length * SR)
    tt = np.arange(n) / SR
    u = tt / length
    fc = f0 * (f1 / f0) ** (u ** 1.6)
    nz = rng.normal(0, 1, n)
    s = svf(nz, fc, 3.5, SR) * 0.7 if noise else np.zeros(n)
    tone = saw(1.0, n) * 0
    f = 110 * 2 ** (u * 2)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25 + np.sin(2 * np.pi * np.cumsum(f * 1.5) / SR) * 0.12
    e = u ** 2.2
    return (s + tone) * e


def whoosh(length=1.2, peak=0.55, f_lo=300, f_hi=3500):
    n = int(length * SR)
    tt = np.arange(n) / SR
    u = tt / length
    shape = np.exp(-((u - peak) ** 2) / 0.03)
    fc = f_lo + (f_hi - f_lo) * shape
    l = svf(rng.normal(0, 1, n), fc, 1.2, SR) * shape
    r = svf(rng.normal(0, 1, n), fc * 1.1, 1.2, SR) * shape
    return np.stack([l, r], 1)


def blip(freq, length=0.25, fm=3.0):
    n = int(length * SR)
    tt = np.arange(n) / SR
    mod = np.sin(2 * np.pi * freq * fm * tt) * np.exp(-tt * 30) * 2.5
    return np.sin(2 * np.pi * freq * tt + mod) * np.exp(-tt * 18) * (1 - np.exp(-tt * 2000))


def reverse_swell(length=1.6):
    n = int(length * SR)
    s = impact(length, 400, 200, 1.0, 6000)[::-1]
    return hp(s, 300) * np.linspace(0, 1, n) ** 2


# section A: exam-room ambience — clock ticks + pencil scratching + room tone
room = lp(rng.normal(0, 1, (int(10.4 * SR), 2)), 900) * 0.006
room *= env_adsr(len(room), 0.4, 0.1, 1.0, 1.0)[:, None]
place(sfx, 0.0, room)
for k in range(10):
    tk = 0.45 + k * 1.0
    n = int(0.04 * SR)
    click = bp(rng.normal(0, 1, n), 1800, 5000) * np.exp(-np.arange(n) / SR * 120)
    place(sfx, tk, click, 0.05 if k % 2 == 0 else 0.035, pan=0.55)
for t0, length in ((0.2, 1.1), (2.0, 0.8), (3.4, 1.3), (6.1, 0.9), (7.6, 1.0)):     # pencil writing gestures
    n = int(length * SR)
    tt = np.arange(n) / SR
    strokes = 0.5 + 0.5 * np.sin(2 * np.pi * (5 + 3 * np.sin(tt * 3)) * tt) ** 2
    s = bp(rng.normal(0, 1, n), 2500, 9000) * strokes * env_adsr(n, 0.05, 0.1, 0.9, 0.15)
    place(sfx, t0, s, 0.03, pan=-0.2)

# transformation: reverse swell -> impact
place(sfx, CUES["impact1"] - 1.6, reverse_swell(1.6), 0.22)
place(sfx, 11.2, riser(2.55, 150, 3000), 0.08)
imp = impact(4.5)
place(sfx, CUES["impact1"], imp, 0.55)
# camera punch-through the floating handwriting
place(sfx, CUES["punch"] - 0.65, whoosh(1.3, 0.5, 250, 4200), 0.22)
# network nodes appearing: soft digital blips (pentatonic on D)
for i, tb in enumerate(np.linspace(15.2, 17.2, 9)):
    f = hz(m(["D6", "F6", "A6", "C7", "D7"][i % 5]))
    place(sfx, tb + rng.uniform(-0.03, 0.03), blip(f, 0.3), 0.035, pan=rng.uniform(-0.6, 0.6))
# "signal" link between the two errors
place(sfx, 16.3, blip(hz(m("A5")), 0.8, 2.0), 0.05)
# words EVIDENCE / UNDERSTANDING / NEXT STEP: low hit + air
for key in ("w_evidence", "w_understanding", "w_next"):
    tw = CUES[key]
    place(sfx, tw, impact(2.0, 120, 45, 0.25, 1500), 0.18)
    place(sfx, tw - 0.35, whoosh(0.7, 0.6, 600, 5000), 0.06)
# verification: soft confirming tone
place(sfx, 29.4, blip(hz(m("D5")), 1.0, 1.0), 0.05)
place(sfx, 29.9, blip(hz(m("A5")), 1.0, 1.0), 0.04)
# transition to the screen
place(sfx, 30.9, riser(1.6, 300, 5000), 0.08)
place(sfx, CUES["seq4"] - 0.45, whoosh(1.0, 0.45, 300, 3800), 0.2)
place(sfx, CUES["seq4"], impact(3.0, 80, 35, 0.4, 2000), 0.3)
# UI interactions in product section: subtle ticks on cuts
for tu in (35.0, 37.5, 40.0, 42.5):
    place(sfx, tu - 0.3, whoosh(0.6, 0.5, 800, 5000), 0.05)
    place(sfx, tu, blip(hz(m("A6")), 0.12, 2.0), 0.02)
# human section: return to the room
room2 = lp(rng.normal(0, 1, (int(5.2 * SR), 2)), 900) * 0.005 * env_adsr(int(5.2 * SR), 0.5, 0.1, 1.0, 0.3)[:, None]
place(sfx, 44.9, room2)
place(sfx, CUES["seq5"] - 0.5, whoosh(1.0, 0.5, 200, 2000), 0.08)
# final rise -> cut -> reveal
place(sfx, 47.5, riser(2.5, 200, 6000), 0.11)
place(sfx, CUES["reveal"], impact(4.5, 70, 28, 0.35, 1800), 0.6)
shimmer = np.zeros((int(4.4 * SR), 2))
for nm in ("A6", "C7", "E7", "G7"):
    s = blip(hz(m(nm)), 4.0, 0.5) * 0
    tt = np.arange(int(4.4 * SR)) / SR
    s = np.sin(2 * np.pi * hz(m(nm)) * tt) * np.exp(-tt * 1.1) * (1 - np.exp(-tt * 30))
    shimmer[:, 0] += s * 0.5
    shimmer[:, 1] += np.roll(s, 240) * 0.5
place(sfx, CUES["reveal"] + 0.05, shimmer, 0.035)

# ================================================================== REVERB


def make_ir(length=3.2, damp=2200.0, pre=0.012):
    n = int(length * SR)
    tt = np.arange(n) / SR
    ir = rng.normal(0, 1, (n, 2)) * np.exp(-tt * 6.9 / length)[:, None]
    # darker tail: crossfade toward a low-passed version over time
    dark = lp(ir, damp)
    w = np.clip(tt / length * 1.5, 0, 1)[:, None]
    ir = ir * (1 - w) + dark * w
    ir = np.concatenate([np.zeros((int(pre * SR), 2)), ir])
    return ir / np.sqrt((ir ** 2).sum(0))


IR_HALL = make_ir(3.4, 2400)
IR_ROOM = make_ir(0.9, 4000, 0.004)


def reverb(x, ir, wet):
    y = np.stack([fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], 1)
    return x * (1 - wet) + y * wet


orch = (stems["piano"] * 0.9 + stems["strings"] * 1.0 + stems["tutti"] * 0.95 + stems["trem"] * 0.75
        + stems["choir"] * 0.8 + stems["celesta"] * 0.7 + stems["timp"] * 0.85)
orch = reverb(orch, IR_HALL, 0.32) * 3.0
synth = reverb(synth, IR_HALL, 0.18) * 0.75
sfx = reverb(sfx, IR_HALL, 0.22)

# the brief "music stops" moment: hard gate 50.0 -> 50.5 (tails included)
tt = np.arange(N) / SR
gate = np.ones(N)
g0, g1 = int(CUES["cut"] * SR), int(CUES["reveal"] * SR)
fade = int(0.06 * SR)
gate[g0 - fade:g0] = np.linspace(1, 0, fade)
gate[g0:g1] = 0
for arr in (orch, synth):
    arr *= gate[:, None]
sfx_gate = gate.copy()
sfx_gate[: g0 - fade] = 1
sfx[g0:g1] *= 0
# end fade
end_fade = np.clip((DUR - tt) / 1.2, 0, 1) ** 1.5
for arr in (orch, synth, sfx):
    arr *= end_fade[:, None]

score = orch + synth
peak = max(np.abs(score).max(), np.abs(sfx).max(), 1e-9)
norm = 0.85 / peak
sf.write(os.path.join(AUD, "score_orch.wav"), (orch * norm).astype(np.float32), SR)
sf.write(os.path.join(AUD, "score_synth.wav"), (synth * norm).astype(np.float32), SR)
sf.write(os.path.join(AUD, "score.wav"), (score * norm).astype(np.float32), SR)
sf.write(os.path.join(AUD, "sfx.wav"), (sfx * norm).astype(np.float32), SR)
json.dump(CUES, open(os.path.join(AUD, "cues.json"), "w"), indent=2)
print("score peak", np.abs(score * norm).max(), "sfx peak", np.abs(sfx * norm).max())
