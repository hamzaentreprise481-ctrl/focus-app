"""Objective checks for voice-over takes: pitch (F0), pacing, and intelligibility
(automatic transcription with Whisper base.en via sherpa-onnx, offline)."""
import glob, os, sys
import numpy as np
import librosa
import sherpa_onnx

ASR = "/opt/asr/sherpa-onnx-whisper-base.en"
rec = sherpa_onnx.OfflineRecognizer.from_whisper(
    encoder=f"{ASR}/base.en-encoder.int8.onnx", decoder=f"{ASR}/base.en-decoder.int8.onnx",
    tokens=f"{ASR}/base.en-tokens.txt", language="en", task="transcribe", num_threads=4)

def transcribe(y, sr):
    if sr != 16000:
        y = librosa.resample(y, orig_sr=sr, target_sr=16000)
    st = rec.create_stream()
    st.accept_waveform(16000, y.astype(np.float32))
    rec.decode_stream(st)
    return st.result.text.strip()

for f in sys.argv[1:]:
    y, sr = librosa.load(f, sr=None)
    f0, vflag, _ = librosa.pyin(y, fmin=60, fmax=300, sr=sr, frame_length=1024)
    f0v = f0[vflag]
    rms = librosa.feature.rms(y=y)[0]
    silent = (rms < 0.01).mean()
    print(f"{os.path.basename(f):18s} dur={len(y)/sr:4.2f}s F0 median={np.nanmedian(f0v):5.1f}Hz "
          f"range(p10-p90)={np.nanpercentile(f0v,10):5.1f}-{np.nanpercentile(f0v,90):5.1f} "
          f"silence={silent:.2f} | ASR: {transcribe(y, sr)}")
