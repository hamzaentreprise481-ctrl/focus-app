"""Small DSP toolkit shared by the voice, score, SFX and mix scripts (numpy/scipy only)."""
import numpy as np
from scipy import signal

SR = 48000


def db(x):
    return 10 ** (x / 20)


def biquad(kind, f0, sr=SR, q=0.707, gain_db=0.0):
    """RBJ audio-EQ-cookbook biquad -> (b, a)."""
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / sr
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2 * q)
    if kind == "lowpass":
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "highpass":
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "bandpass":
        b = [alpha, 0, -alpha]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "peak":
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]
        a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind == "lowshelf":
        sa = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) - (A - 1) * cw + sa), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sa)]
        a = [(A + 1) + (A - 1) * cw + sa, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sa]
    elif kind == "highshelf":
        sa = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * cw + sa), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sa)]
        a = [(A + 1) - (A - 1) * cw + sa, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sa]
    else:
        raise ValueError(kind)
    b, a = np.array(b), np.array(a)
    return b / a[0], a / a[0]


def eq(x, kind, f0, q=0.707, gain_db=0.0, sr=SR):
    b, a = biquad(kind, f0, sr, q, gain_db)
    return signal.lfilter(b, a, x, axis=0)


def envelope(x, attack_s, release_s, sr=SR):
    """Peak-ish envelope follower (mono input)."""
    ga, gr = np.exp(-1 / (attack_s * sr)), np.exp(-1 / (release_s * sr))
    env = np.zeros_like(x)
    e = 0.0
    ax = np.abs(x)
    for i, v in enumerate(ax):
        g = ga if v > e else gr
        e = g * e + (1 - g) * v
        env[i] = e
    return env


def compress(x, threshold_db=-20, ratio=3.0, attack=0.005, release=0.12, makeup_db=0.0, sr=SR):
    mono = x if x.ndim == 1 else np.max(np.abs(x), axis=1)
    env = envelope(mono, attack, release, sr) + 1e-9
    lvl = 20 * np.log10(env)
    over = np.maximum(lvl - threshold_db, 0)
    gain = db(-over * (1 - 1 / ratio) + makeup_db)
    return x * (gain if x.ndim == 1 else gain[:, None])


def fade(x, fin_s=0.0, fout_s=0.0, sr=SR):
    y = x.copy()
    n_in, n_out = int(fin_s * sr), int(fout_s * sr)
    if n_in:
        r = np.sin(np.linspace(0, np.pi / 2, n_in)) ** 2
        y[:n_in] *= r if y.ndim == 1 else r[:, None]
    if n_out:
        r = np.cos(np.linspace(0, np.pi / 2, n_out)) ** 2
        y[-n_out:] *= r if y.ndim == 1 else r[:, None]
    return y


def resample(x, sr_in, sr_out=SR):
    if sr_in == sr_out:
        return x
    g = np.gcd(sr_in, sr_out)
    return signal.resample_poly(x, sr_out // g, sr_in // g, axis=0)


def reverb_ir(seconds=2.8, sr=SR, predelay=0.012, damp_hz=6500, seed=7, width=1.0):
    """Synthetic stereo hall impulse response: decorrelated noise, exponential decay,
    frequency-dependent damping (highs decay faster)."""
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    t = np.arange(n) / sr
    ir = np.zeros((n, 2))
    for ch in range(2):
        noise = rng.standard_normal(n)
        lo = eq(noise, "lowpass", 900, q=0.5)
        hi = noise - lo
        decay_lo = np.exp(-6.9 * t / seconds)
        decay_hi = np.exp(-6.9 * t / (seconds * 0.45))
        ir[:, ch] = lo * decay_lo + hi * decay_hi
        ir[:, ch] = eq(ir[:, ch], "lowpass", damp_hz, q=0.5)
    mid = ir.mean(axis=1, keepdims=True)
    ir = mid + (ir - mid) * width
    pd = int(predelay * sr)
    ir = np.vstack([np.zeros((pd, 2)), ir])
    # soften the onset so the tail blooms rather than clicks
    ir[: pd + int(0.02 * sr)] *= np.linspace(0, 1, pd + int(0.02 * sr))[:, None]
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


def convolve_reverb(x, ir):
    """x: mono or stereo -> stereo wet signal (same length + tail)."""
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    out = np.stack([signal.fftconvolve(x[:, c], ir[:, c]) for c in range(2)], axis=1)
    return out


def to_stereo(x):
    return np.stack([x, x], axis=1) if x.ndim == 1 else x


def pan(x, p):
    """p in [-1, 1], equal-power."""
    x = x if x.ndim == 1 else x.mean(axis=1)
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1)


def soft_limit(x, ceiling_db=-1.0):
    c = db(ceiling_db)
    return np.tanh(x / c) * c
