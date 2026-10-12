"""Generate the French voice-over with Kokoro (open-source, Apache-2.0, voice ff_siwis).

Lines are synthesized paragraph by paragraph (better intonation than isolated
words), split back into individual lines at the longest pauses, then checked
with Whisper-small (sherpa-onnx): if a line is not recognised, the paragraph
is re-synthesized at another speed. Each line is then processed (EQ, gentle
compression, loudness normalisation) and written to public/audio/vo/<id>.wav.

Usage: python tts.py <models_dir> <narration.json> <out_dir>
"""
import difflib
import json
import re
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import pyloudnorm as pyln
import sherpa_onnx
from kokoro_onnx import Kokoro

sys.path.insert(0, str(Path(__file__).parent))
import dsp  # noqa: E402

models, narration_path, out_dir = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
out_dir.mkdir(parents=True, exist_ok=True)
lines = {l["id"]: l for l in json.loads(narration_path.read_text())["lines"]}

# Paragraphs: synthesized as one utterance, then split into their lines.
GROUPS = [
    ["vo1a", "vo1b", "vo1c"],
    ["vo2"],
    ["vo3a", "vo3b"],
    ["vo3c", "vo3d", "vo3e"],
    ["vo4a", "vo4b"],
    ["vo5a", "vo5b", "vo5c"],
]
SPEEDS = [0.9, 0.88, 0.92, 0.86, 0.94, 0.89, 0.91]
# Whisper often writes homophones ("à développer" / "a développé"): compare on a
# phonetic-ish key that ignores accents, final silent letters and "à/a".
def key(s):
    s = s.lower().replace("’", "'")
    s = re.sub(r"[àâä]", "a", s)
    s = re.sub(r"[éèêë]", "e", s)
    s = re.sub(r"[îï]", "i", s)
    s = re.sub(r"[ôö]", "o", s)
    s = re.sub(r"[ûüù]", "u", s)
    s = re.sub(r"[^a-z' ]", " ", s)
    words = []
    for w in s.split():
        w = re.sub(r"(es|e|s|x|t|ent|er|ez)$", "", w) or w
        words.append(w)
    return words


def similarity(a, b):
    return difflib.SequenceMatcher(None, key(a), key(b)).ratio()


kokoro = Kokoro(str(models / "kokoro-v1.0.onnx"), str(models / "voices-v1.0.bin"))
w = models / "sherpa-onnx-whisper-small"
asr = sherpa_onnx.OfflineRecognizer.from_whisper(
    encoder=str(w / "small-encoder.int8.onnx"), decoder=str(w / "small-decoder.int8.onnx"),
    tokens=str(w / "small-tokens.txt"), language="fr", task="transcribe", num_threads=4)


def transcribe(x, sr):
    x16 = dsp.resample(x, sr, 16000).astype(np.float32)
    st = asr.create_stream()
    st.accept_waveform(16000, x16)
    asr.decode_stream(st)
    return st.result.text.strip()


def split_at_pauses(x, sr, n_parts):
    """Cut a paragraph into n_parts at its n_parts-1 longest silences."""
    if n_parts == 1:
        return [x]
    hop = int(0.01 * sr)
    frames = np.array([np.sqrt(np.mean(x[i:i + hop] ** 2)) for i in range(0, len(x) - hop, hop)])
    thr = max(frames.max() * 0.02, 1e-4)
    silent = frames < thr
    runs, start = [], None
    for i, s in enumerate(silent):
        if s and start is None:
            start = i
        if (not s or i == len(silent) - 1) and start is not None:
            if start > 5 and i < len(silent) - 5:  # ignore leading / trailing silence
                runs.append((i - start, start, i))
            start = None
    runs = sorted(sorted(runs, reverse=True)[: n_parts - 1], key=lambda r: r[1])
    if len(runs) < n_parts - 1:
        return None
    cuts = [((a + b) // 2) * hop for _, a, b in runs]
    bounds = [0] + cuts + [len(x)]
    return [x[bounds[i]:bounds[i + 1]] for i in range(n_parts)]


def trim(x, sr, head=0.03, tail=0.12):
    a = np.abs(x)
    thr = a.max() * 0.015
    idx = np.where(a > thr)[0]
    s = max(0, idx[0] - int(head * sr))
    e = min(len(x), idx[-1] + int(tail * sr))
    return x[s:e]


def master_voice(x, sr):
    """Upsample to 48 kHz and give the synthetic voice a warmer, broadcast-style finish."""
    y = dsp.resample(x, sr, dsp.SR)
    y = dsp.eq(y, "highpass", 75, q=0.7)
    y = dsp.eq(y, "lowshelf", 180, gain_db=2.0)        # body
    y = dsp.eq(y, "peak", 420, q=1.0, gain_db=-1.5)     # less boxy
    y = dsp.eq(y, "peak", 3200, q=0.9, gain_db=1.5)     # presence
    y = dsp.eq(y, "peak", 7000, q=2.0, gain_db=-2.0)    # tame sibilance
    y = dsp.compress(y, threshold_db=-22, ratio=2.5, attack=0.004, release=0.15)
    meter = pyln.Meter(dsp.SR)
    loud = meter.integrated_loudness(np.concatenate([y, np.zeros(int(0.5 * dsp.SR))]))
    y = y * dsp.db(-20.0 - loud)                         # every line at -20 LUFS
    y = dsp.fade(y, 0.008, 0.06)
    return y.astype(np.float32)


report = {}
for group in GROUPS:
    text = " ".join(lines[i]["tts"] for i in group)
    best = None
    for speed in SPEEDS:
        audio, sr = kokoro.create(text, voice="ff_siwis", speed=speed, lang="fr-fr")
        parts = split_at_pauses(np.asarray(audio, dtype=np.float32), sr, len(group))
        if parts is None:
            print(f"  {group} @ {speed}: could not split")
            continue
        results = []
        for lid, part in zip(group, parts):
            part = trim(part, sr)
            heard = transcribe(part, sr)
            exact = difflib.SequenceMatcher(None, lines[lid]["text"].lower(), heard.lower()).ratio()
            results.append((lid, part, heard, round(similarity(lines[lid]["text"], heard), 3) + 0.001 * exact))
        score = min(r[3] for r in results)
        print(f"  {'+'.join(group)} @ speed {speed}: min similarity {score:.2f}  " +
              " | ".join(f"{r[0]}: {r[2]}" for r in results))
        mean = sum(r[3] for r in results) / len(results)
        if best is None or (score, mean) > (best[0], best[4]):
            best = (score, speed, results, sr, mean)
    score, speed, results, sr, _ = best
    for lid, part, heard, sim in results:
        y = master_voice(part, sr)
        sf.write(out_dir / f"{lid}.flac", y, dsp.SR, subtype="PCM_24")
        report[lid] = {"text": lines[lid]["text"], "speed": speed, "duration": round(len(y) / dsp.SR, 3),
                       "whisper": heard, "similarity": round(sim, 3)}

(out_dir / "vo_manifest.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
print(json.dumps({k: (v["duration"], v["similarity"]) for k, v in report.items()}, indent=1))
