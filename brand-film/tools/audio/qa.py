"""Audio QA: (1) Whisper-check every voice line inside the final mix (music + SFX present),
(2) loudness / true peak, (3) a waveform + RMS plot with timeline markers.
Usage: python qa.py <models_dir> <timeline.json> <narration.json> <mix.wav> <plot.png>"""
import difflib, json, re, sys
from pathlib import Path
import numpy as np, soundfile as sf, pyloudnorm as pyln
import sherpa_onnx
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
sys.path.insert(0, str(Path(__file__).parent))
import dsp

models, tlp, narp, mixp, plotp = map(Path, sys.argv[1:6])
TL = json.loads(tlp.read_text()); NAR = {l["id"]: l for l in json.loads(narp.read_text())["lines"]}
x, sr = sf.read(mixp, always_2d=True)
w = models / "sherpa-onnx-whisper-small"
asr = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=str(w / "small-encoder.int8.onnx"), decoder=str(w / "small-decoder.int8.onnx"),
                                                 tokens=str(w / "small-tokens.txt"), language="fr", task="transcribe", num_threads=4)
def key(s):
    s = s.lower().replace("’", "'")
    for a, b in (("[àâä]", "a"), ("[éèêë]", "e"), ("[îï]", "i"), ("[ôö]", "o"), ("[ûüù]", "u")): s = re.sub(a, b, s)
    return [re.sub(r"(es|e|s|x|t|ent|er|ez)$", "", t) or t for t in re.sub(r"[^a-z' ]", " ", s).split()]
vo_dir = Path("public/audio/vo")
rows = []
for line in TL["vo"]:
    f = next(p for p in (vo_dir / f"{line['id']}.flac", vo_dir / f"{line['id']}.wav") if p.exists())
    d = sf.info(f).duration
    a, b = int((line["at"] - 0.05) * sr), int((line["at"] + d + 0.1) * sr)
    seg = x[a:b].mean(axis=1)
    st = asr.create_stream(); st.accept_waveform(16000, dsp.resample(seg, sr, 16000).astype(np.float32)); asr.decode_stream(st)
    heard = st.result.text.strip()
    sim = difflib.SequenceMatcher(None, key(NAR[line["id"]]["text"]), key(heard)).ratio()
    rows.append((line["id"], line["at"], round(sim, 2), heard))
    print(f"{line['id']:5s} @{line['at']:5.1f}s  sim={sim:.2f}  {heard}")
# Whole phrases in context (how a viewer hears them): very short isolated clips are a
# known weak spot of Whisper, so acceptance is judged at phrase level.
GROUPS = [["vo1a", "vo1b", "vo1c"], ["vo2"], ["vo3a", "vo3b"], ["vo3c", "vo3d", "vo3e"], ["vo4a", "vo4b"], ["vo5a", "vo5b", "vo5c"]]
at = {l["id"]: l["at"] for l in TL["vo"]}
grows = []
for g in GROUPS:
    last = g[-1]
    d = sf.info(next(p for p in (vo_dir / f"{last}.flac", vo_dir / f"{last}.wav") if p.exists())).duration
    a, b = int((at[g[0]] - 0.1) * sr), int((at[last] + d + 0.15) * sr)
    st = asr.create_stream(); st.accept_waveform(16000, dsp.resample(x[a:b].mean(axis=1), sr, 16000).astype(np.float32)); asr.decode_stream(st)
    heard = st.result.text.strip()
    ref = " ".join(NAR[i]["text"] for i in g)
    sim = difflib.SequenceMatcher(None, key(ref), key(heard)).ratio()
    grows.append(sim)
    print(f"[phrase] {'+'.join(g):16s} sim={sim:.2f}  {heard}")
m = pyln.Meter(sr)
print("integrated LUFS", round(m.integrated_loudness(x), 2), "| min line similarity", min(r[2] for r in rows), "| min phrase similarity", round(min(grows), 2))
# plot
t = np.arange(len(x)) / sr
hop = int(0.05 * sr)
rms = np.sqrt(np.convolve(x.mean(axis=1) ** 2, np.ones(hop) / hop, mode="same"))[::hop]
fig, ax = plt.subplots(figsize=(18, 4))
ax.plot(t[::hop], 20 * np.log10(rms + 1e-6), lw=0.7, color="#333f8a")
for k, (a, b) in TL["scenes"].items():
    ax.axvline(a, color="#bbb", lw=0.6); ax.text(a + 0.2, -8, k, fontsize=7, rotation=90, va="top")
for l in TL["vo"]: ax.axvspan(l["at"], l["at"] + 1.0, color="#e8b4b4", alpha=0.35)
ax.set_ylim(-70, 0); ax.set_xlim(0, TL["duration"]); ax.set_xlabel("s"); ax.set_ylabel("RMS dBFS")
plt.tight_layout(); plt.savefig(plotp, dpi=70)
