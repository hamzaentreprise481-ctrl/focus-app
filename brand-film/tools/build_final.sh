#!/usr/bin/env bash
# Full final build of the FOCUS brand film: score → mix → 60 fps picture → delivery MP4 → checks.
# Usage: PY=.venv/bin/python [REMOTION_BROWSER=...] [SKIP_RENDER=1] ./tools/build_final.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PY:-python3}"
OUT=out
mkdir -p "$OUT/audio"

echo "▸ score"
"$PY" tools/audio/score.py src/timeline.json "$OUT/audio"
echo "▸ mix"
"$PY" tools/audio/mix.py src/timeline.json "$OUT/audio/stems" public/audio/vo "$OUT/audio/FOCUS_mix.wav"
ffmpeg -y -v error -i "$OUT/audio/FOCUS_mix.wav" -c:a aac -b:a 256k public/audio/FOCUS_mix.m4a

if [[ "${SKIP_RENDER:-0}" != "1" ]]; then
  echo "▸ picture (60 fps master)"
  npx remotion render FocusBrandFilm "$OUT/final_video_master.mp4" --codec=h264 --crf=15 \
    --pixel-format=yuv420p --color-space=bt709 --image-format=png --x264-preset=slow --muted --concurrency=4
fi

echo "▸ delivery encode + mux"
ffmpeg -y -v error -i "$OUT/final_video_master.mp4" -i "$OUT/audio/FOCUS_mix.wav" \
  -map 0:v -map 1:a -c:v libx264 -preset slow -crf "${DELIVERY_CRF:-18}" -profile:v high -pix_fmt yuv420p \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv \
  -c:a aac -b:a 320k -ar 48000 -movflags +faststart -shortest FOCUS_BRAND_FILM_2026.mp4

echo "▸ checks"
ffprobe -v error -show_entries format=duration,size,bit_rate:stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,color_space,sample_rate,channels -of compact FOCUS_BRAND_FILM_2026.mp4
ffmpeg -v error -i FOCUS_BRAND_FILM_2026.mp4 -f null - && echo "decode: OK (no errors)"
ffmpeg -nostats -i FOCUS_BRAND_FILM_2026.mp4 -af ebur128=peak=true -f null - 2>&1 | grep -A12 "Summary:" | grep -E "I:|LRA:|Peak:"
