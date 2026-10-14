#!/usr/bin/env bash
# Second pass on sequence 3 after review: label overlap + stray glyph fragments.
# Re-renders only the affected ranges (1-200, 301-360) once the main queue is done.
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${PY:-/opt/focusenv/venv/bin/python}
LOG=renders/queue.log
while [ ! -f renders/MILESTONE_all_renders ]; do
  pgrep -f render_queue.sh > /dev/null || { echo "queue not running" >> "$LOG"; exit 1; }
  sleep 30
done
echo "[$(date -u +%H:%M:%S)] seq3 fix pass: rebuild + re-render 1-200, 301-360" >> "$LOG"
$PY blender/build_seq3.py --res 1600x900 --samples 18 >> "$LOG" 2>&1
for f in $(seq 1 200) $(seq 301 360); do rm -f "renders/seq3/f_$(printf %04d "$f").exr"; done
$PY scripts/render_blend.py blender/FOCUS_seq3_network.blend --range 1-360 --out renders/seq3/f_ >> renders/seq3.log 2>&1
$PY scripts/post.py renders/seq3 renders/graded/seq3 --exposure 1.25 --workers 3 >> "$LOG" 2>&1
touch renders/MILESTONE_fixes
echo "[$(date -u +%H:%M:%S)] seq3 fix pass done" >> "$LOG"
