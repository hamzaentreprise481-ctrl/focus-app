"""Generate voice-over candidates with Kokoro-82M (Apache-2.0) via kokoro-onnx."""
import os, sys
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "audio", "vo_candidates")
k = Kokoro("/opt/kokoro/kokoro-v1.0.onnx", "/opt/kokoro/voices-v1.0.bin")
print("voices:", [v for v in k.get_voices() if v[1] == "m"])
TEXT = "A grade shows a result. But not the whole story."
for v in sys.argv[1:]:
    lang = "en-gb" if v.startswith("b") else "en-us"
    s, sr = k.create(TEXT, voice=v, speed=0.92, lang=lang)
    sf.write(os.path.join(OUT, f"{v}.wav"), s, sr)
    print(v, sr, len(s) / sr)
