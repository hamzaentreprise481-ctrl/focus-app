"""SEQUENCE 3 — "FOCUS connects evidence to understanding." (film 17.5–32.5 s)

A conceptual visualisation (not the product UI): the two pieces of evidence
lifted from the student's sheet ("x² + 9" and "x² − 25", same misconception)
are linked, feed a concept node — (a + b)² = a² + 2ab + b² —, light up a skill
in a wider constellation, open a path to a next step, and end on a teacher
review node: the analysis stays a proposal that the teacher confirms.

Six camera shots (markers bind cameras):
  3A   1– 60  evidence pair, lateral dolly            (EVIDENCE title at f61 in post)
  3B  61–120  streams rise into the concept node
  3C 121–180  wide: skill constellation              (UNDERSTANDING at f121)
  3D 181–240  fly along the path to the next step    (NEXT STEP at f181)
  3E 241–300  teacher review node closes its ring
  3F 301–420  pull-back; 361–420 also feeds the laptop screen in sequence 4
"""
import argparse
import json
import math
import os
import sys

import bpy
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import focus_lib as fl  # noqa: E402

ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "assets")
FONT_MED = os.path.join(ASSETS, "fonts", "Inter-Medium.otf")
FONT_REG = os.path.join(ASSETS, "fonts", "Inter-Regular.otf")

ap = argparse.ArgumentParser()
ap.add_argument("--res", default="1920x1080")
ap.add_argument("--samples", type=int, default=20)
ap.add_argument("--out", default=os.path.join(HERE, "FOCUS_seq3_network.blend"))
ap.add_argument("--renders", default="//../renders/seq3/f_####")
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
RES = tuple(int(v) for v in args.res.split("x"))
F_END = 420

rng = np.random.default_rng(23)
layout = json.load(open(os.path.join(ASSETS, "copy_layout.json")))
PX = layout["px_per_mm"]

scn = fl.reset_scene()
fl.setup_render(scn, res=RES, samples=args.samples, frames=(1, F_END), out_dir=args.renders)
scn.camera = None
world = scn.world
if world.node_tree is None:
    world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = (0.0015, 0.0022, 0.0045, 1)

INK_BLUE = (0.42, 0.72, 1.0)
INK_RED = (1.0, 0.42, 0.30)
WARM = (1.0, 0.62, 0.32)
V = lambda *a: np.array(a, float)  # noqa: E731

# ------------------------------------------------------------------ materials
core_mat = fl.emission_mat("Core", (0.78, 0.9, 1.0), 4.0, prop="glow")
warm_core = fl.emission_mat("Core_Warm", WARM, 4.0, prop="glow")
edge_mat = fl.emission_mat("Edge", (0.32, 0.58, 1.0), 1.6, prop="glow")
edge_dim = fl.emission_mat("Edge_Dim", (0.25, 0.45, 0.9), 0.5, prop="glow")
beam_mat = fl.emission_mat("Beam", (0.6, 0.82, 1.0), 4.0, prop="glow")
ring_warm = fl.emission_mat("Ring_Warm", WARM, 3.0, prop="glow")
link_mat = fl.emission_mat("Link_Warm", (1.0, 0.55, 0.40), 2.2, prop="glow")
label_mat = fl.emission_mat("Label", (0.82, 0.9, 1.0), 1.4, prop="glow")
label_warm = fl.emission_mat("Label_Warm", (1.0, 0.78, 0.6), 1.4, prop="glow")
pts_mat = fl.point_mat("Pts", strength=4.0, near_fade=(0.03, 0.12))
dust_mat = fl.point_mat("Dust", strength=2.0, near_fade=(0.05, 0.2))


def appear(ob, f0, f1=None, peak=1.4, base=1.0, prop="glow"):
    f1 = f1 or f0 + 10
    fl.key_prop(ob, prop, [(1, 0.0), (f0, 0.0), (f0 + (f1 - f0) * 0.5, peak), (f1, base)])


def grow_curve(ob, f0, f1):
    cu = ob.data
    cu.bevel_factor_mapping_end = "SPLINE"
    cu.bevel_factor_end = 0.0
    cu.keyframe_insert("bevel_factor_end", frame=1)
    cu.keyframe_insert("bevel_factor_end", frame=int(f0))
    cu.bevel_factor_end = 1.0
    cu.keyframe_insert("bevel_factor_end", frame=int(f1))


# accumulators for one big static point cloud and one big flow cloud
STATIC = {k: [] for k in ("start", "rad", "col", "drift", "t_rel")}
FLOW = {k: [] for k in ("start", "p1", "p2", "target", "t_rel", "t_move", "dur", "rad", "amp", "col")}


def add_static(pos, rad, col, drift=0.002, t_rel=-50.0):
    n = len(pos)
    STATIC["start"].append(np.asarray(pos, float))
    STATIC["rad"].append(np.broadcast_to(rad, n).astype(float))
    c = np.ones((n, 4))
    c[:, :3] = col
    STATIC["col"].append(c)
    STATIC["drift"].append(np.broadcast_to(drift, n).astype(float))
    STATIC["t_rel"].append(np.broadcast_to(t_rel, n).astype(float))


def add_flow(start, target, t0, spread, dur, rad, col, bend=0.25, amp=0.004):
    n = len(start)
    start = np.asarray(start, float)
    target = np.asarray(target, float)
    d = target - start
    side = rng.normal(0, 1, (n, 3)) * bend * np.linalg.norm(d, axis=1, keepdims=True) * 0.35
    FLOW["start"].append(start)
    FLOW["p1"].append(start + d * 0.25 + side)
    FLOW["p2"].append(start + d * 0.7 + side * 0.5)
    FLOW["target"].append(target)
    tr = t0 + rng.random(n) * spread
    FLOW["t_rel"].append(tr)
    FLOW["t_move"].append(tr + 1)
    FLOW["dur"].append(dur[0] + rng.random(n) * (dur[1] - dur[0]))
    FLOW["rad"].append(np.broadcast_to(rad, n).astype(float))
    c = np.ones((n, 4))
    c[:, :3] = col
    c[:, :3] *= (0.7 + 0.6 * rng.random(n))[:, None]
    FLOW["col"].append(c)
    FLOW["amp"].append(np.full(n, amp))


def sphere_pts(n, r, thick=0.15):
    v = rng.normal(0, 1, (n, 3))
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    return v * (r * (1 - thick / 2 + thick * rng.random(n)))[:, None]


def node(name, pos, r, mat=core_mat, f0=1, shell=0, shell_r=None, col=INK_BLUE):
    ob = fl.icosphere(name, r * 0.75, 3, mat, loc=tuple(pos))
    appear(ob, f0)
    if shell:
        add_static(np.asarray(pos) + sphere_pts(shell, shell_r or r * 5), 0.0006, col, drift=0.0015, t_rel=f0)
    return ob


# ------------------------------------------------- the two pieces of evidence
ink = np.asarray(Image.open(os.path.join(ASSETS, "copy_ink.png")), np.float32) / 255.0
red = np.asarray(Image.open(os.path.join(ASSETS, "copy_red.png")), np.float32) / 255.0
SCALE = 3.0


def glyph_cluster(x0, x1, y0, y1, center, n):
    sub = ink[int(y0 * PX):int(y1 * PX), int(x0 * PX):int(x1 * PX)]
    rsub = red[int(y0 * PX):int(y1 * PX), int(x0 * PX):int(x1 * PX)]
    p = (sub.ravel() ** 1.5).astype(np.float64)
    p /= p.sum()
    idx = rng.choice(p.size, n, p=p)
    yy, xx = np.divmod(idx, sub.shape[1])
    mx = (xx + rng.random(n)) / PX
    my = (yy + rng.random(n)) / PX
    u = (mx - (x1 - x0) / 2) / 1000 * SCALE
    v = -(my - (y1 - y0) / 2) / 1000 * SCALE
    pos = np.asarray(center) + np.stack([u, rng.normal(0, 0.0008, n), v], -1)
    isred = rsub.ravel()[idx] > 0.45 * np.maximum(sub.ravel()[idx], 1e-3)
    return pos, isred


ecx, ecy = layout["error_center_mm"]
e2x, e2y = layout["error2_center_mm"]
A_C, B_C = V(-0.075, 0.0, 0.0), V(0.075, 0.03, -0.035)
posA, redA = glyph_cluster(ecx - 14, ecx + 44, ecy - 4.2, ecy + 5.6, A_C + V(0.035, 0, 0), 26000)
posB, redB = glyph_cluster(47, 86, e2y - 6.0, e2y + 6.5, B_C, 18000)
for pos, isr in ((posA, redA), (posB, redB)):
    add_static(pos[~isr], 0.00042, INK_BLUE, drift=0.0006)
    add_static(pos[isr], 0.00048, INK_RED, drift=0.0006)

link = fl.poly_curve("Link_SamePattern", fl.arc_points(A_C + V(0.02, 0, -0.03), B_C + V(-0.03, 0, -0.025), -0.35, n=60, normal=(0, 1, 0)), 0.00045, link_mat)
grow_curve(link, 10, 40)
appear(link, 10, 22, 1.6)
lab = fl.text_obj("Label_Pattern", "same pattern × 2", FONT_REG, 0.0075, label_warm, tuple(V(0.0, 0.01, -0.075)), face_to=(0.0, -0.3, 0.03))
appear(lab, 30, 44, 1.0)
la = fl.text_obj("Label_A", "answer A", FONT_REG, 0.0065, label_mat, tuple(A_C + V(0.0, 0, 0.035)), face_to=(-0.1, -0.3, 0.03))
lb = fl.text_obj("Label_C", "answer C", FONT_REG, 0.0065, label_mat, tuple(B_C + V(0.0, 0, 0.035)), face_to=(0.1, -0.3, 0.03))
appear(la, 6, 18, 1.0)
appear(lb, 18, 30, 1.0)

# ---------------------------------------------------------------- concept node
C1 = V(0.0, 0.45, 0.13)
node("Concept", C1, 0.009, shell=2500, shell_r=0.045, f0=70)
srcA = posA[rng.choice(len(posA), 2600)]
srcB = posB[rng.choice(len(posB), 1800)]
tgt = C1 + sphere_pts(4400, 0.045)
add_flow(np.vstack([srcA, srcB]), tgt, 62, 40, (30, 52), 0.0005, (0.55, 0.8, 1.0), bend=0.35)
ident = fl.text_obj("Identity", "(a + b)² = a² + 2ab + b²", FONT_REG, 0.022, label_mat, tuple(C1 + V(0, -0.02, 0.095)), face_to=(0.0, -0.15, 0.22))
appear(ident, 84, 104, 1.3)
cl = fl.text_obj("Label_Concept", "concept", FONT_REG, 0.009, label_mat, tuple(C1 + V(0, -0.02, 0.064)), face_to=(0.0, -0.15, 0.22))
appear(cl, 92, 108, 0.8, 0.7)

# ---------------------------------------------------------- skill constellation
S0 = V(0.0, 2.3, 0.35)
SKILLS = ["Algebraic expressions", "Expanding", "Factoring", "Equations", "Linear functions", "Vectors", "Coordinates", "Statistics"]
skill_pos = []
for i, nm in enumerate(SKILLS):
    a = math.radians(115 + i * 45)
    p = S0 + V(0.95 * math.cos(a), 0.15 * math.sin(i * 1.7), 0.62 * math.sin(a))
    skill_pos.append(p)
    hot = nm == "Expanding"
    node(f"Skill_{i}", p, 0.022 if hot else 0.016, shell=1600 if hot else 900, shell_r=0.10 if hot else 0.075, f0=40 + i * 4)
    # the highlighted skill's label sits to the left of its node (no overlap with its neighbour's label)
    t = fl.text_obj(f"Label_Skill_{i}", nm, FONT_MED, 0.07, label_mat,
                    tuple(p + (V(-0.13, -0.02, -0.02) if hot else V(0, -0.02, -0.16))),
                    face_to=tuple(S0 + V(1.5, -2.4, 0.9)), align="RIGHT" if hot else "CENTER")
    appear(t, 125 + i * 3, 140 + i * 3, 1.0, 0.85)
skill_pos = np.array(skill_pos)
for i in range(len(SKILLS)):
    for j in (i + 1, i + 3):
        j %= len(SKILLS)
        e = fl.poly_curve(f"SkillEdge_{i}_{j}", fl.arc_points(skill_pos[i], skill_pos[j], 0.12, n=40, normal=(0, 1, 0)), 0.0018, edge_mat)
        grow_curve(e, 121 + i * 2, 150 + i * 2)
        appear(e, 121 + i * 2, 135 + i * 2, 1.2)
EXP = skill_pos[1]
# hub to every skill + the evidence stream lighting "Expanding"
hub = node("Skill_Hub", S0, 0.012, f0=120)
add_flow(C1 + sphere_pts(5000, 0.045), EXP + sphere_pts(5000, 0.10), 128, 28, (30, 48), 0.0011, (0.6, 0.85, 1.0), bend=0.2)
exp_ob = bpy.data.objects["Skill_1"]
fl.key_prop(exp_ob, "glow", [(1, 0.0), (44, 0.0), (52, 1.4), (60, 1.0), (158, 1.0), (166, 3.0), (180, 2.0)])

# -------------------------------------------------------------- next step path
NS = EXP + V(0.55, 1.6, -0.15)
node("NextStep", NS, 0.02, shell=1800, shell_r=0.09, f0=205)
beam_pts = fl.arc_points(EXP, NS, 0.10, n=80, normal=(0, 0, 1))
beam = fl.poly_curve("Beam_NextStep", beam_pts, 0.0022, beam_mat)
grow_curve(beam, 178, 214)
appear(beam, 178, 190, 1.5)
# light running along the beam
for k in range(6):
    n = 900
    st = np.repeat(EXP[None], n, 0) + rng.normal(0, 0.01, (n, 3))
    tg = np.repeat(NS[None], n, 0) + sphere_pts(n, 0.09)
    add_flow(st, tg, 180 + k * 6, 6, (26, 40), 0.0012, (0.7, 0.9, 1.0), bend=0.05, amp=0.01)
ns_l = fl.text_obj("Label_NextStep", "review (a + b)²", FONT_REG, 0.03, label_mat, tuple(NS + V(0.13, -0.02, -0.01)), face_to=tuple(NS + V(-0.12, -0.42, 0.06)), align="LEFT")
appear(ns_l, 214, 230, 1.0)

# ------------------------------------------------------------ teacher review
T = NS + V(0.28, 0.55, 0.06)
tcore = node("TeacherReview", T, 0.016, mat=warm_core, shell=1400, shell_r=0.07, f0=236, col=WARM)
ang = np.linspace(0, 2 * np.pi, 161)
R = 0.11
ring = fl.poly_curve("Ring_TeacherReview", np.stack([R * np.cos(ang), np.zeros_like(ang), R * np.sin(ang)], -1), 0.0016, ring_warm)
ring.location = tuple(T)
ring.rotation_euler = (0, math.radians(90), 0)
grow_curve(ring, 252, 286)
appear(ring, 252, 262, 1.4)
link2 = fl.poly_curve("Link_ToTeacher", fl.arc_points(NS, T, 0.15, n=50, normal=(0, 0, 1)), 0.0016, edge_mat)
grow_curve(link2, 232, 252)
appear(link2, 232, 240, 1.3)
t1 = fl.text_obj("Label_Teacher", "teacher review", FONT_MED, 0.022, label_warm, tuple(T + V(0.14, -0.01, 0.012)), face_to=tuple(T + V(-0.12, -0.44, 0.05)), align="LEFT")
t2 = fl.text_obj("Label_Confidence", "evidence: moderate · to be confirmed", FONT_REG, 0.0125, label_mat, tuple(T + V(0.14, -0.01, -0.022)), face_to=tuple(T + V(-0.12, -0.44, 0.05)), align="LEFT")
appear(t1, 262, 278, 1.0)
appear(t2, 272, 288, 0.9, 0.8)

# rough samples of all camera paths (keys below), used to keep clutter away
CAM_SAMPLES = np.vstack([np.linspace(a, b, 20) for a, b in (
    (V(-0.20, -0.34, 0.035), V(0.12, -0.30, 0.06)), (V(0.02, -0.55, 0.02), V(-0.05, -0.12, 0.24)),
    (S0 + V(1.9, -2.6, 1.05), S0 + V(1.25, -2.15, 0.8)), (EXP + V(-0.16, -0.48, 0.10), NS + V(-0.12, -0.42, 0.06)),
    (T + V(-0.32, -0.40, 0.02), T + V(0.06, -0.44, 0.08)), (T + V(0.05, -0.55, 0.1), V(0.6, -1.6, 1.0)))])

# ------------------------------------------------- background network + dust
bgn = []
while len(bgn) < 110:
    p = V(rng.uniform(-2.6, 2.8), rng.uniform(-0.6, 4.6), rng.uniform(-1.5, 1.8))
    if np.linalg.norm(p - C1) < 0.25 or np.linalg.norm(p - S0) < 1.1 or np.linalg.norm(p[:2] - V(0, 0)[:2]) < 0.35:
        continue
    if bgn and min(np.linalg.norm(p - q) for q in bgn) < 0.35:
        continue
    if np.min(np.linalg.norm(CAM_SAMPLES - p, axis=1)) < 0.45:
        continue
    bgn.append(p)
bgn = np.array(bgn)
order = np.argsort(np.linalg.norm(bgn - V(0, 0.3, 0), axis=1))
for rank, i in enumerate(order):
    f0 = 1 if rank < 40 else 100 + rank
    node(f"Bg_{i:03d}", bgn[i], 0.004 + 0.006 * rng.random(), shell=120, shell_r=0.03, f0=f0)
for i in range(len(bgn)):
    dd = np.linalg.norm(bgn - bgn[i], axis=1)
    for j in np.argsort(dd)[1:3]:
        if i < j:
            e = fl.poly_curve(f"BgEdge_{i}_{j}", fl.arc_points(bgn[i], bgn[j], 0.1, n=24), 0.0012, edge_dim)
            appear(e, 1, 12, 1.0)
            # pulses
            if rng.random() < 0.5:
                n = 6
                st = np.repeat(bgn[i][None], n, 0)
                tg = np.repeat(bgn[j][None], n, 0)
                add_flow(st, tg, rng.uniform(1, 300), 120, (40, 70), 0.0025, (0.6, 0.85, 1.0), bend=0.0, amp=0.0)
ND = 16000
dp = np.stack([rng.uniform(-3.0, 3.2, ND), rng.uniform(-1.2, 5.2, ND), rng.uniform(-1.8, 2.0, ND)], -1)
from scipy.spatial import cKDTree  # noqa: E402
dkeep = cKDTree(CAM_SAMPLES).query(dp)[0] > 0.12
dp = dp[dkeep]
ND = len(dp)
add_static(dp, rng.uniform(0.0006, 0.0022, ND), (0.55, 0.72, 1.0), drift=0.02)
STATIC["col"][-1][:, :3] *= (0.15 + 0.55 * rng.random(ND) ** 2)[:, None]

# ------------------------------------------------------------- build clouds
S = {k: np.concatenate(v) for k, v in STATIC.items()}
ns = len(S["start"])
fl.flow_points_object("StaticPoints", {
    "start": S["start"], "p1": S["start"], "p2": S["start"], "target": S["start"], "hover": np.zeros((ns, 3)),
    "t_rel": S["t_rel"], "t_move": np.full(ns, 1e5), "dur": np.ones(ns), "life": np.full(ns, 1e6),
    "rad": S["rad"], "amp": np.zeros(ns), "drift": S["drift"], "col": S["col"]}, pts_mat)
Fd = {k: np.concatenate(v) for k, v in FLOW.items()}
nf = len(Fd["start"])
fl.flow_points_object("FlowPoints", {
    "start": Fd["start"], "p1": Fd["p1"], "p2": Fd["p2"], "target": Fd["target"], "hover": np.zeros((nf, 3)),
    "t_rel": Fd["t_rel"], "t_move": Fd["t_move"], "dur": Fd["dur"], "life": np.full(nf, 1e6),
    "rad": Fd["rad"], "amp": Fd["amp"], "drift": np.full(nf, 0.0004), "col": Fd["col"]}, pts_mat)
print("points static", ns, "flow", nf)

# ===================================================================== CAMERAS


def path(keys, frames):
    return fl.catmull(keys, frames)


def make_shot(name, f0, f1, pos_keys, tgt_keys, lens_keys, fstop, focus_on=None):
    frames = list(range(f0, f1 + 1))
    eased = fl.ease_frames(frames, f0, f1, 1.6)
    pos = path(pos_keys, eased)
    tgt = path(tgt_keys, eased)
    lens = path([(f, np.array([v])) for f, v in lens_keys], eased)[:, 0]
    if focus_on is None:
        focus = [np.linalg.norm(t - p) for p, t in zip(pos, tgt)]
    else:
        fo = path(focus_on, eased)
        focus = [np.linalg.norm(t - p) for p, t in zip(pos, fo)]
    fst = [fstop] * len(frames)
    return fl.shot_camera(scn, name, f0, frames, pos, tgt, lens, focus, fst)


make_shot("Cam_3A", 1, 60,
          [(1, V(-0.20, -0.34, 0.035)), (60, V(0.12, -0.30, 0.06))],
          [(1, A_C + V(0.02, 0, 0)), (60, B_C)],
          [(1, 50.0), (60, 50.0)], 2.8,
          focus_on=[(1, A_C + V(0.02, 0, 0)), (40, A_C + V(0.06, 0, 0)), (60, B_C)])
make_shot("Cam_3B", 61, 120,
          [(61, V(0.02, -0.55, 0.02)), (120, V(-0.05, -0.12, 0.24))],
          [(61, V(0.0, 0.05, 0.0)), (120, C1)],
          [(61, 35.0), (120, 32.0)], 3.5)
make_shot("Cam_3C", 121, 180,
          [(121, S0 + V(1.9, -2.6, 1.05)), (180, S0 + V(1.25, -2.15, 0.8))],
          [(121, S0 + V(0.0, 0.0, 0.0)), (180, S0 + V(0.18, 0.0, -0.02))],
          [(121, 30.0), (180, 30.0)], 8.0)
make_shot("Cam_3D", 181, 240,
          [(181, EXP + V(-0.16, -0.48, 0.10)), (214, EXP + (NS - EXP) * 0.55 + V(-0.16, -0.30, 0.14)), (240, NS + V(-0.16, -0.62, 0.08))],
          [(181, EXP + (NS - EXP) * 0.3), (214, NS), (240, NS + V(0.10, 0, 0))],
          [(181, 24.0), (240, 30.0)], 11.0)
make_shot("Cam_3E", 241, 300,
          [(241, T + V(-0.26, -0.52, 0.04)), (300, T + V(0.12, -0.54, 0.06))],
          [(241, T + V(0.09, 0, -0.03)), (300, T + V(0.12, 0, -0.02))],
          [(241, 36.0), (300, 38.0)], 3.2)
make_shot("Cam_3F", 301, 420,
          [(301, T + V(0.05, -0.55, 0.1)), (360, V(0.6, -1.6, 1.0)), (420, V(0.5, -3.6, 1.3))],
          [(301, T), (360, V(0.3, 1.6, 0.25)), (420, V(0.3, 1.8, 0.2))],
          [(301, 40.0), (420, 28.0)], 6.0)

for ob in scn.objects:
    if ob.type in {"MESH", "CURVE", "FONT"}:
        ob.cycles.use_motion_blur = False
fl.save_blend(args.out)
print("SAVED", args.out)
