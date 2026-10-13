#!/usr/bin/env bash
# Laptop: dimmer screen spill (palm rest was burnt). Re-renders frames 31-80 after the other passes.
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${PY:-/opt/focusenv/venv/bin/python}
LOG=renders/queue.log
while [ ! -f renders/MILESTONE_fixes ]; do
  pgrep -f "render_fixes.sh|render_queue.sh" > /dev/null || { echo "fix pass not running" >> "$LOG"; exit 1; }
  sleep 30
done
echo "[$(date -u +%H:%M:%S)] laptop fix pass" >> "$LOG"
$PY blender/build_desk.py --set laptop --samples 16 --screen-seq "$(pwd)/renders/graded/seq3/f_0361.png" >> "$LOG" 2>&1
for f in $(seq 31 80); do rm -f "renders/desk_laptop/f_$(printf %04d "$f").exr"; done
$PY scripts/render_blend.py blender/FOCUS_desk_laptop.blend --range 1-80 --out renders/desk_laptop/f_ >> renders/laptop.log 2>&1
$PY scripts/post.py renders/desk_laptop renders/graded/laptop --exposure 1.3 --workers 3 >> "$LOG" 2>&1
touch renders/MILESTONE_fixes2
echo "[$(date -u +%H:%M:%S)] laptop fix pass done" >> "$LOG"
