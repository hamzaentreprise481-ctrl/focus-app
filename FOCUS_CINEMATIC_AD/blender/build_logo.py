"""SEQUENCE 6 — reveal (film 50.5–55.0 s, 108 frames).

A typographic signature only (no invented graphic logo): the word FOCUS in
dark brushed metal, revealed by a single grazing strip of light that sweeps
across it, with a faint cool rim. The tagline is set in post (2D, crisp).
"""
import argparse
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import focus_lib as fl  # noqa: E402

ROOT = os.path.dirname(HERE)
FONT = os.path.join(ROOT, "assets", "fonts", "InterDisplay-Medium.otf")

ap = argparse.ArgumentParser()
ap.add_argument("--res", default="1920x1080")
ap.add_argument("--samples", type=int, default=24)
ap.add_argument("--out", default=os.path.join(HERE, "FOCUS_logo.blend"))
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
RES = tuple(int(v) for v in args.res.split("x"))
F_END = 108

scn = fl.reset_scene()
fl.setup_render(scn, res=RES, samples=args.samples, frames=(1, F_END), out_dir="//../renders/logo/f_####")
w = scn.world
if w.node_tree is None:
    w.use_nodes = True
w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.0, 0.0, 0.0, 1)

# brushed dark metal
m, nt, out = fl.new_mat("Logo_Metal")
b = nt.nodes.new("ShaderNodeBsdfPrincipled")
b.inputs["Base Color"].default_value = (0.28, 0.295, 0.315, 1)
b.inputs["Metallic"].default_value = 1.0
b.inputs["Roughness"].default_value = 0.24
b.inputs["Anisotropic"].default_value = 0.55
nz = nt.nodes.new("ShaderNodeTexNoise")
nz.inputs["Scale"].default_value = 400.0
mp = nt.nodes.new("ShaderNodeMapping")
mp.inputs["Scale"].default_value = (1.0, 60.0, 1.0)
tc = nt.nodes.new("ShaderNodeTexCoord")
nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
nt.links.new(mp.outputs[0], nz.inputs["Vector"])
bp = nt.nodes.new("ShaderNodeBump")
bp.inputs["Strength"].default_value = 0.05
nt.links.new(nz.outputs["Fac"], bp.inputs["Height"])
nt.links.new(bp.outputs["Normal"], b.inputs["Normal"])
nt.links.new(b.outputs[0], out.inputs["Surface"])

cu = bpy.data.curves.new("FOCUS", "FONT")
cu.body = "FOCUS"
cu.font = bpy.data.fonts.load(FONT)
cu.size = 1.0
cu.align_x = "CENTER"
cu.align_y = "CENTER"
cu.space_character = 1.32
cu.extrude = 0.06
cu.bevel_depth = 0.012
cu.bevel_resolution = 4
cu.materials.append(m)
txt = bpy.data.objects.new("FOCUS", cu)
scn.collection.objects.link(txt)
txt.rotation_euler = (math.radians(90), 0, 0)      # stands up, faces -Y
txt.location = (0, 0, 0.0)

# backdrop (catches a faint gradient so the black is not flat)
bd, bnt, bout = fl.new_mat("Backdrop")
bb = bnt.nodes.new("ShaderNodeBsdfPrincipled")
bb.inputs["Base Color"].default_value = (0.003, 0.004, 0.006, 1)
bb.inputs["Roughness"].default_value = 0.9
bnt.links.new(bb.outputs[0], bout.inputs["Surface"])
me = bpy.data.meshes.new("Backdrop")
me.from_pydata([(-20, 0.6, -10), (20, 0.6, -10), (20, 0.6, 10), (-20, 0.6, 10)], [], [(0, 1, 2, 3)])
me.materials.append(bd)
bdo = bpy.data.objects.new("Backdrop", me)
scn.collection.objects.link(bdo)

# sweeping strip light (the "discrete light that reveals the name")
ld = bpy.data.lights.new("Strip", "AREA")
ld.shape = "RECTANGLE"
ld.size, ld.size_y = 0.08, 3.0
ld.color = (0.92, 0.96, 1.0)
strip = bpy.data.objects.new("Strip", ld)
scn.collection.objects.link(strip)
for f, x, e in ((1, -3.6, 0.0), (6, -3.2, 120.0), (40, 0.4, 160.0), (80, 2.6, 120.0), (108, 3.4, 100.0)):
    strip.location = (x, -1.1, 1.25)
    strip.rotation_euler = (math.radians(42), 0, 0)
    ld.energy = e
    strip.keyframe_insert("location", frame=f)
    ld.keyframe_insert("energy", frame=f)
# cool rim from behind / above
rl = bpy.data.lights.new("Rim", "AREA")
rl.size = 4.0
rl.color = (0.45, 0.65, 1.0)
rim = bpy.data.objects.new("Rim", rl)
scn.collection.objects.link(rim)
rim.location = (0, 0.5, 2.2)
rim.rotation_euler = fl.look_rotation((0, 0.5, 2.2), (0, -0.1, 0), (0, 1, 0))
for f, e in ((1, 0.0), (20, 0.0), (60, 90.0), (108, 110.0)):
    rl.energy = e
    rl.keyframe_insert("energy", frame=f)
# soft key that settles the final card
kl = bpy.data.lights.new("Key", "AREA")
kl.size = 3.0
kl.color = (0.85, 0.9, 1.0)
key = bpy.data.objects.new("Key", kl)
scn.collection.objects.link(key)
key.location = (-1.5, -3.0, 2.0)
key.rotation_euler = fl.look_rotation((-1.5, -3.0, 2.0), (0, 0, 0), (0, 0, 1))
for f, e in ((1, 0.0), (50, 0.0), (100, 150.0), (108, 165.0)):
    kl.energy = e
    kl.keyframe_insert("energy", frame=f)

frames = list(range(1, F_END + 1))
pos = fl.catmull([(1, np.array([0.0, -7.6, 0.05])), (108, np.array([0.0, -7.0, 0.02]))], frames)
tgt = [np.array([0.0, 0.0, -0.05])] * len(frames)
fl.shot_camera(scn, "Cam_Logo", 1, frames, pos, tgt, [55.0] * len(frames),
               [float(np.linalg.norm(p - t)) for p, t in zip(pos, tgt)], [5.6] * len(frames))
for ob in scn.objects:
    if ob.type in {"MESH", "FONT"}:
        ob.cycles.use_motion_blur = False
fl.save_blend(args.out)
print("SAVED", args.out)
