#!/usr/bin/env bash
# Sequential render queue (CPU-only machine: one Cycles job at a time).
# Every step is resumable: render_blend.py skips frames already on disk and
# post.py skips frames already graded.
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${PY:-/opt/focusenv/venv/bin/python}
LOG=renders/queue.log
mkdir -p renders
say() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG"; }

# 0. wait for the pilot render if it is still running
while pgrep -f "render_blend.py blender/FOCUS_pilot.blend" > /dev/null; do sleep 30; done
say "pilot render finished"

# 1. pilot: grade + assemble + audio -> output/FOCUS_PILOT_8S.mp4
$PY scripts/render_blend.py blender/FOCUS_pilot.blend --range 1-192 --out renders/pilot/f_ >> renders/pilot/render.log 2>&1
$PY scripts/post.py renders/pilot renders/graded/pilot --exposure 1.35 --workers 3 >> "$LOG" 2>&1
FOCUS_WORKERS=3 $PY scripts/assemble.py pilot >> "$LOG" 2>&1
touch renders/MILESTONE_pilot
say "pilot mp4 written"

# 2. sequence 3 (network) — 1600x900 internal, upscaled to 1080p in post
[ -f blender/FOCUS_seq3_network.blend ] || $PY blender/build_seq3.py --res 1600x900 --samples 18 >> "$LOG" 2>&1
$PY scripts/render_blend.py blender/FOCUS_seq3_network.blend --range 1-420 --out renders/seq3/f_ >> renders/seq3.log 2>&1
$PY scripts/post.py renders/seq3 renders/graded/seq3 --exposure 1.25 --workers 3 >> "$LOG" 2>&1
touch renders/MILESTONE_seq3
say "seq3 done"

# 3. laptop (needs graded seq3 frames 361-420 for its screen)
[ -f blender/FOCUS_desk_laptop.blend ] || $PY blender/build_desk.py --set laptop --samples 16 --screen-seq "$(pwd)/renders/graded/seq3/f_0361.png" >> "$LOG" 2>&1
$PY scripts/render_blend.py blender/FOCUS_desk_laptop.blend --range 1-80 --out renders/desk_laptop/f_ >> renders/laptop.log 2>&1
$PY scripts/post.py renders/desk_laptop renders/graded/laptop --exposure 1.3 --workers 3 >> "$LOG" 2>&1
say "laptop done"

# 4. desks (teacher, student) and logo
for SET in teacher student; do
  [ -f blender/FOCUS_desk_$SET.blend ] || $PY blender/build_desk.py --set $SET --samples 14 >> "$LOG" 2>&1
  N=$([ $SET = teacher ] && echo 150 || echo 210)
  $PY scripts/render_blend.py blender/FOCUS_desk_$SET.blend --range 1-$N --out renders/desk_$SET/f_ >> renders/desk_$SET.log 2>&1
  EXP=$([ $SET = teacher ] && echo 1.45 || echo 1.05)
  $PY scripts/post.py renders/desk_$SET renders/graded/desk_$SET --exposure $EXP --workers 3 >> "$LOG" 2>&1
  say "desk $SET done"
done
[ -f blender/FOCUS_logo.blend ] || $PY blender/build_logo.py --samples 20 >> "$LOG" 2>&1
$PY scripts/render_blend.py blender/FOCUS_logo.blend --range 1-108 --out renders/logo/f_ >> renders/logo.log 2>&1
$PY scripts/post.py renders/logo renders/graded/logo --exposure 1.6 --bloom 0.04 --workers 3 >> "$LOG" 2>&1
touch renders/MILESTONE_all_renders
say "all renders done"
