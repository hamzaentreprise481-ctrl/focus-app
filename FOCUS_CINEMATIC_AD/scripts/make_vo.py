"""Final voice-over lines: Kokoro-82M voice am_michael (Apache-2.0), one file per
line so the edit can place each one precisely. Light broadcast processing
(gentle formant-preserving deepening, EQ, compression) is applied with FFmpeg."""
import os, subprocess
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "audio", "vo")
VOICE = "am_michael"
LINES = {
    "01_grade": ("A grade shows a result.", 0.90),
    "02_story": ("But not the whole story.", 0.88),
    "03_signal": ("Every answer carries a signal.", 0.90),
    "04_connects": ("Focus connects evidence to understanding.", 0.90),
    "05_teachers": ("Helping teachers see what comes next.", 0.91),
    "06_students": ("And helping every student move forward.", 0.91),
    "07_end": ("Focus... See beyond the grade.", 0.85),
}
k = Kokoro("/opt/kokoro/kokoro-v1.0.onnx", "/opt/kokoro/voices-v1.0.bin")
for name, (text, speed) in LINES.items():
    s, sr = k.create(text, voice=VOICE, speed=speed, lang="en-us")
    # trim leading/trailing silence (keep 40 ms)
    env = np.abs(s) > 0.008
    i0 = max(np.argmax(env) - int(0.04 * sr), 0)
    i1 = min(len(s) - np.argmax(env[::-1]) + int(0.08 * sr), len(s))
    raw = os.path.join(OUT, f"{name}_raw.wav")
    sf.write(raw, s[i0:i1], sr)
    out = os.path.join(OUT, f"{name}.wav")
    af = ("aresample=48000,"
          "rubberband=pitch=0.955:formant=preserved:pitchq=quality,"
          "highpass=f=70,equalizer=f=140:t=q:w=1.0:g=2.5,equalizer=f=3200:t=q:w=1.2:g=1.5,"
          "equalizer=f=7000:t=q:w=2:g=-2,"
          "acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=2,"
          "alimiter=limit=0.89")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-af", af, "-ac", "1", out], check=True)
    os.remove(raw)
    d = sf.info(out).duration
    print(f"{name}: {d:.2f}s  '{text}'")

# Split the closing take at its longest pause: "Focus." | "See beyond the grade."
# (an isolated "Focus." take is articulated poorly by the model; the full
# sentence is clean, so both halves come from the same natural take.)
y, sr = sf.read(os.path.join(OUT, "07_end.wav"))
win = int(0.02 * sr)
rms = np.sqrt(np.convolve(y ** 2, np.ones(win) / win, mode="same"))
quiet = rms < 0.012
best, cur, start = (0, 0), 0, 0
for i, q in enumerate(quiet):
    if q:
        if cur == 0:
            start = i
        cur += 1
        if cur > best[1] - best[0] and start > int(0.3 * sr) and i < len(y) - int(0.3 * sr):
            best = (start, i)
    else:
        cur = 0
cut = (best[0] + best[1]) // 2
fade = int(0.01 * sr)
a = y[: best[0] + int(0.05 * sr)].copy()
b = y[max(best[1] - int(0.04 * sr), 0):].copy()
a[-fade:] *= np.linspace(1, 0, fade)
b[:fade] *= np.linspace(0, 1, fade)
sf.write(os.path.join(OUT, "07_focus.wav"), a, sr)
sf.write(os.path.join(OUT, "08_tagline.wav"), b, sr)
os.remove(os.path.join(OUT, "07_end.wav"))
print(f"split closing line at {cut / sr:.2f}s (pause {(best[1] - best[0]) / sr:.2f}s)")
