"""Procedural sound design for the FOCUS film (no third-party samples)."""
import numpy as np
from scipy import signal

import dsp
from dsp import SR

_rng = np.random.default_rng(81)


def _t(n):
    return np.arange(n) / SR


def pen(duration, strokes_per_s=7.0, intensity=1.0, seed=None):
    """Ballpoint on paper: band-limited friction noise, modulated by stroke rhythm and micro-roughness."""
    rng = np.random.default_rng(seed) if seed is not None else _rng
    n = int(duration * SR)
    t = _t(n)
    nz = rng.standard_normal(n)
    body = dsp.eq(nz, "bandpass", 3400, q=0.7) * 1.0 + dsp.eq(nz, "bandpass", 1300, q=1.6) * 0.45
    body += dsp.eq(nz, "highpass", 7500) * 0.18
    # stroke rhythm: lifted pen between strokes
    phase = np.cumsum((strokes_per_s * (0.8 + 0.4 * rng.random(n) ** 8)) / SR)
    stroke = 0.5 - 0.5 * np.cos(2 * np.pi * phase)
    stroke = stroke ** 0.6
    rough = 1 + 0.35 * dsp.eq(rng.standard_normal(n), "lowpass", 60)
    env = np.minimum(1, t / 0.012) * np.minimum(1, (duration - t) / 0.03)
    y = body * stroke * rough * env * intensity
    # tiny contact thump at pen-down
    k = int(0.02 * SR)
    y[:k] += dsp.eq(rng.standard_normal(k), "lowpass", 500)[:k] * np.exp(-_t(k) / 0.004) * 0.6 * intensity
    return y * 0.22


def tick_mark(duration=0.3, seed=None):
    """A quick teacher tick/check: two fast strokes."""
    return pen(duration, strokes_per_s=5.5, intensity=1.1, seed=seed)


def click(press_release_gap=0.075, amp=1.0):
    n = int((press_release_gap + 0.06) * SR)
    y = np.zeros(n)
    for off, a in ((0, 1.0), (press_release_gap, 0.55)):
        i0 = int(off * SR)
        m = int(0.03 * SR)
        tt = _t(m)
        c = (np.sin(2 * np.pi * 2300 * tt) * np.exp(-tt / 0.004) * 0.6
             + np.sin(2 * np.pi * 950 * tt) * np.exp(-tt / 0.007) * 0.4
             + dsp.eq(_rng.standard_normal(m), "highpass", 2500) * np.exp(-tt / 0.0015) * 0.5)
        y[i0:i0 + m] += c * a
    return y * 0.5 * amp


def ui_tick(freq=2100, amp=1.0):
    m = int(0.06 * SR)
    tt = _t(m)
    y = np.sin(2 * np.pi * freq * tt) * np.exp(-tt / 0.012) + 0.4 * np.sin(2 * np.pi * freq * 1.5 * tt) * np.exp(-tt / 0.008)
    return y * 0.12 * amp


def whoosh(duration=0.7, f0=500, f1=3000, amp=1.0, seed=None):
    rng = np.random.default_rng(seed) if seed is not None else _rng
    n = int(duration * SR)
    p = np.linspace(0, 1, n)
    nz = rng.standard_normal(n)
    y = np.zeros(n)
    zi = np.zeros(2)
    for i in range(0, n, 256):
        fc = f0 * (f1 / f0) ** p[i]
        b, a = dsp.biquad("bandpass", fc, SR, 0.9)
        y[i:i + 256], zi = signal.lfilter(b, a, nz[i:i + 256], zi=zi)
    env = np.sin(np.pi * p) ** 1.6
    return y * env * 0.35 * amp


def glint(amp=1.0):
    n = int(1.2 * SR)
    tt = _t(n)
    y = sum(np.sin(2 * np.pi * f * tt) * np.exp(-tt / d) * g for f, d, g in ((2637, 0.5, 1), (3951, 0.35, 0.5), (5274, 0.25, 0.3), (1318, 0.6, 0.25)))
    y *= np.minimum(1, tt / 0.004)
    return y * 0.05 * amp


def chime(amp=1.0):
    """Soft confirmation (two notes, a fifth apart)."""
    n = int(1.4 * SR)
    tt = _t(n)
    y = np.zeros(n)
    for off, f in ((0.0, 1046.5), (0.09, 1568.0)):
        i0 = int(off * SR)
        m = n - i0
        x = _t(m)
        y[i0:] += (np.sin(2 * np.pi * f * x) + 0.25 * np.sin(2 * np.pi * 2 * f * x)) * np.exp(-x / 0.45) * np.minimum(1, x / 0.003)
    return y * 0.05 * amp


def shimmer(duration=1.2, amp=1.0):
    n = int(duration * SR)
    p = np.linspace(0, 1, n)
    nz = dsp.eq(_rng.standard_normal(n), "highpass", 6000)
    tones = sum(np.sin(2 * np.pi * f * _t(n) + _rng.random() * 6) for f in (2093, 3136, 4186, 5274)) * 0.25
    env = np.sin(np.pi * p) ** 2
    return (nz * 0.15 + tones * 0.6) * env * 0.05 * amp


def room_tone(duration, amp=1.0):
    n = int(duration * SR)
    b = _rng.standard_normal(n)
    b = dsp.eq(b, "lowpass", 900, q=0.5)
    b = dsp.eq(b, "lowpass", 900, q=0.5)
    b += dsp.eq(_rng.standard_normal(n), "bandpass", 3000, q=0.5) * 0.04  # faint air
    return b * 0.02 * amp


def clock(duration, amp=1.0, start_phase=0.0):
    n = int(duration * SR)
    y = np.zeros(n)
    t = start_phase
    k = 0
    while t < duration:
        i0 = int(t * SR)
        m = int(0.05 * SR)
        tt = _t(m)
        f = 2600 if k % 2 == 0 else 2200
        c = dsp.eq(_rng.standard_normal(m), "bandpass", f, q=4) * np.exp(-tt / 0.004)
        c += np.sin(2 * np.pi * 1150 * tt) * np.exp(-tt / 0.006) * 0.3
        y[i0:i0 + m] += c[: max(0, min(m, n - i0))]
        t += 1.0
        k += 1
    return y * 0.05 * amp


def paper(duration=0.5, amp=1.0):
    n = int(duration * SR)
    p = np.linspace(0, 1, n)
    nz = _rng.standard_normal(n)
    crack = (np.abs(_rng.standard_normal(n)) > 2.6) * _rng.standard_normal(n)
    y = dsp.eq(nz, "bandpass", 2500, q=0.6) * 0.5 + dsp.eq(crack, "bandpass", 4000, q=1.0) * 1.5
    return y * np.sin(np.pi * p) ** 1.2 * 0.12 * amp
