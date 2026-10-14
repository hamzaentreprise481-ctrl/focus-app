"""PILOT — "Every answer carries a signal." (8 s, 192 frames @ 24 fps)

The student's test sheet lies on a desk. The circled error wakes up, the ink
lifts off the paper as light, the paper disintegrates and the camera dives
through the floating handwriting into a 3D network of evidence.

Usage:
  python build_pilot.py [--res 1920x1080] [--samples 64] [--out ../blender/FOCUS_pilot.blend]
"""
import argparse
import os
import faulthandler
faulthandler.dump_traceback_later(int(os.environ.get("FOCUS_HANG_DUMP", "0")) or 10**7, exit=True)
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

ap = argparse.ArgumentParser()
ap.add_argument("--res", default="1920x1080")
ap.add_argument("--samples", type=int, default=64)
ap.add_argument("--out", default=os.path.join(HERE, "FOCUS_pilot.blend"))
ap.add_argument("--renders", default="//../renders/pilot/f_####")
ap.add_argument("--n-ink", type=int, default=90000)
ap.add_argument("--n-dust", type=int, default=22000)
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
RES = tuple(int(v) for v in args.res.split("x"))

rng = np.random.default_rng(11)
layout = json.load(open(os.path.join(ASSETS, "copy_layout.json")))
PX = layout["px_per_mm"]

# ------------------------------------------------------------------ timing
F_END = 192
F_GLOW0, VG = 34, 0.0045      # glow front (m / frame) radiating from the error
F_REL0, VR = 64, 0.0042       # ink release front
F_DIS0, VD = 88, 0.0052       # paper dissolve front (impact at f90 = film 13.75 s)
F_LD0, VLD = 110, 0.0052      # Seyes lines dissolve front
F_DESK0, VDESK = 96, 0.010    # desk / props fade


def mm2w(mx, my):
    return np.asarray(mx) / 1000.0 - 0.105, 0.1485 - np.asarray(my) / 1000.0


def zpaper(x, y):
    return 0.0012 * (np.asarray(x) / 0.105) ** 2 + 0.0006 * ((np.asarray(y) + 0.1485) / 0.297) ** 3


ex, ey = mm2w(*layout["error_center_mm"])
E = np.array([ex, ey, float(zpaper(ex, ey))])
e2x, e2y = mm2w(*layout["error2_center_mm"])
E2 = np.array([e2x, e2y, float(zpaper(e2x, e2y))])

scn = fl.reset_scene()
fl.setup_render(scn, res=RES, samples=args.samples, frames=(1, F_END), out_dir=args.renders)

# ================================================================= MATERIALS


def img_node(nt, fname, noncolor=False, loc=(-900, 0)):
    n = nt.nodes.new("ShaderNodeTexImage")
    im = bpy.data.images.load(os.path.join(ASSETS, fname), check_existing=True)
    if noncolor:
        im.colorspace_settings.name = "Non-Color"
    n.image = im
    n.interpolation = "Linear"
    n.location = loc
    return n


def dist_to_E(nt, loc=(-1000, 400)):
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    geo.location = (loc[0] - 200, loc[1])
    dv = nt.nodes.new("ShaderNodeVectorMath")
    dv.operation = "DISTANCE"
    dv.location = loc
    nt.links.new(geo.outputs["Position"], dv.inputs[0])
    dv.inputs[1].default_value = tuple(E)
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 160.0
    noise.inputs["Detail"].default_value = 1.0
    noise.location = (loc[0], loc[1] - 250)
    nt.links.new(geo.outputs["Position"], noise.inputs["Vector"])
    return dv.outputs["Value"], noise.outputs["Fac"], geo


def front(nt, frame, d, n, f0, speed, noise_amp, width, loc=(0, 0)):
    """0 before the radial front reaches the point, 1 after (smooth)."""
    fr = fl.math_node(nt, "MULTIPLY", fl.math_node(nt, "SUBTRACT", frame, f0).outputs[0], speed, loc=loc)
    x = fl.math_node(nt, "SUBTRACT", fr.outputs[0], d, loc=(loc[0] + 150, loc[1]))
    nn = fl.math_node(nt, "MULTIPLY", fl.math_node(nt, "SUBTRACT", n, 0.5).outputs[0], noise_amp)
    x2 = fl.math_node(nt, "ADD", x.outputs[0], nn.outputs[0], loc=(loc[0] + 300, loc[1]))
    return fl.map_range(nt, x2.outputs[0], 0.0, width, loc=(loc[0] + 450, loc[1])).outputs[0]


def vscale(nt, vec, s):
    n = nt.nodes.new("ShaderNodeVectorMath")
    n.operation = "SCALE"
    if isinstance(vec, tuple):
        n.inputs[0].default_value = vec
    else:
        nt.links.new(vec, n.inputs[0])
    if isinstance(s, (int, float)):
        n.inputs["Scale"].default_value = s
    else:
        nt.links.new(s, n.inputs["Scale"])
    return n.outputs[0]


def vadd(nt, a, b):
    n = nt.nodes.new("ShaderNodeVectorMath")
    n.operation = "ADD"
    nt.links.new(a, n.inputs[0])
    nt.links.new(b, n.inputs[1])
    return n.outputs[0]


INK_BLUE = (0.42, 0.72, 1.0)
INK_RED = (1.0, 0.42, 0.30)
LINE_BLUE = (0.30, 0.55, 1.0)
RIM_BLUE = (0.55, 0.80, 1.0)


def paper_material():
    m, nt, out = fl.new_mat("Paper_Copy")
    uv = nt.nodes.new("ShaderNodeTexCoord")
    col = img_node(nt, "copy_color.png", loc=(-900, 300))
    ink = img_node(nt, "copy_ink.png", True, loc=(-900, 0))
    red = img_node(nt, "copy_red.png", True, loc=(-900, -300))
    lines = img_node(nt, "copy_lines.png", True, loc=(-900, -600))
    for t in (col, ink, red, lines):
        nt.links.new(uv.outputs["UV"], t.inputs["Vector"])
    frame = fl.frame_value_node(nt).outputs[0]
    d, n, _ = dist_to_E(nt)
    glow = front(nt, frame, d, n, F_GLOW0, VG, 0.010, 0.025)
    rel = front(nt, frame, d, n, F_REL0, VR, 0.0, 0.003)
    dis = front(nt, frame, d, n, F_DIS0, VD, 0.022, 0.012)
    dis2 = front(nt, frame, d, n, F_LD0, VLD, 0.022, 0.010)
    inkv = ink.outputs["Color"]
    # remove released ink from the paper albedo
    inkrel = fl.math_node(nt, "MULTIPLY", inkv, rel)
    mixc = nt.nodes.new("ShaderNodeMix")
    mixc.data_type = "RGBA"
    nt.links.new(inkrel.outputs[0], mixc.inputs["Factor"])
    nt.links.new(col.outputs["Color"], mixc.inputs[6])
    mixc.inputs[7].default_value = (0.90, 0.885, 0.85, 1)
    # emission: glowing ink (blue / warm red), lines, dissolve rim
    redfrac = fl.math_node(nt, "DIVIDE", red.outputs["Color"], fl.math_node(nt, "ADD", inkv, 0.02).outputs[0], clamp=True)
    inkcol = nt.nodes.new("ShaderNodeMix")
    inkcol.data_type = "RGBA"
    nt.links.new(redfrac.outputs[0], inkcol.inputs["Factor"])
    inkcol.inputs[6].default_value = (*INK_BLUE, 1)
    inkcol.inputs[7].default_value = (*INK_RED, 1)
    ink_em = fl.math_node(nt, "MULTIPLY", fl.math_node(nt, "MULTIPLY", inkv, glow).outputs[0],
                          fl.math_node(nt, "SUBTRACT", 1.0, rel).outputs[0])
    ink_em = fl.math_node(nt, "MULTIPLY", ink_em.outputs[0], 2.6)
    line_em = fl.math_node(nt, "MULTIPLY", fl.math_node(nt, "MULTIPLY", lines.outputs["Color"], glow).outputs[0], 0.35)
    rim = fl.math_node(nt, "MULTIPLY", dis, fl.math_node(nt, "SUBTRACT", 1.0, dis).outputs[0])
    rim_em = fl.math_node(nt, "MULTIPLY", rim.outputs[0], 3.0)
    emc = vadd(nt, vadd(nt, vscale(nt, inkcol.outputs[2], ink_em.outputs[0]), vscale(nt, LINE_BLUE, line_em.outputs[0])),
               vscale(nt, RIM_BLUE, rim_em.outputs[0]))
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(mixc.outputs[2], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.78
    bsdf.inputs["Sheen Weight"].default_value = 0.15
    nt.links.new(emc, bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0
    # paper grain bump
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.04
    bump.inputs["Distance"].default_value = 0.0002
    gn = nt.nodes.new("ShaderNodeTexNoise")
    gn.inputs["Scale"].default_value = 900.0
    gn.inputs["Detail"].default_value = 2.0
    nt.links.new(gn.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    # dissolved area: only the glowing ruling survives a little longer
    lines_alpha = fl.math_node(nt, "MULTIPLY", lines.outputs["Color"], fl.math_node(nt, "SUBTRACT", 1.0, dis2).outputs[0])
    lem = nt.nodes.new("ShaderNodeEmission")
    lem.inputs["Color"].default_value = (*LINE_BLUE, 1)
    lstr = fl.math_node(nt, "MULTIPLY", glow, 0.7)
    nt.links.new(lstr.outputs[0], lem.inputs["Strength"])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    lmix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lines_alpha.outputs[0], lmix.inputs[0])
    nt.links.new(tr.outputs[0], lmix.inputs[1])
    nt.links.new(lem.outputs[0], lmix.inputs[2])
    fmix = nt.nodes.new("ShaderNodeMixShader")
    keep = fl.math_node(nt, "SUBTRACT", 1.0, dis)
    nt.links.new(keep.outputs[0], fmix.inputs[0])
    nt.links.new(lmix.outputs[0], fmix.inputs[1])
    nt.links.new(bsdf.outputs[0], fmix.inputs[2])
    nt.links.new(fmix.outputs[0], out.inputs["Surface"])
    return m


def fade_wrap(m, nt, out, shader_out, f0, speed, width=0.08, noise_amp=0.06):
    frame = fl.frame_value_node(nt).outputs[0]
    d, n, _ = dist_to_E(nt, loc=(-1000, -900))
    dis = front(nt, frame, d, n, f0, speed, noise_amp, width, loc=(-400, -900))
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(dis, mix.inputs[0])
    nt.links.new(shader_out, mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])


def desk_material():
    m, nt, out = fl.new_mat("Desk")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 9.0
    nz.inputs["Detail"].default_value = 4.0
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.016, 0.018, 0.022, 1)
    ramp.color_ramp.elements[1].color = (0.034, 0.037, 0.044, 1)
    nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    rough = fl.map_range(nt, nz.outputs["Fac"], 0.3, 0.7, 0.34, 0.55, interp="LINEAR")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(rough.outputs[0], bsdf.inputs["Roughness"])
    bsdf.inputs["Specular IOR Level"].default_value = 0.45
    fade_wrap(m, nt, out, bsdf.outputs[0], F_DESK0, VDESK)
    return m


def sheet_material():
    m, nt, out = fl.new_mat("Paper_Blank")
    uv = nt.nodes.new("ShaderNodeTexCoord")
    lines = img_node(nt, "copy_lines.png", True)
    nt.links.new(uv.outputs["UV"], lines.inputs["Vector"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(lines.outputs["Color"], mix.inputs["Factor"])
    mix.inputs[6].default_value = (0.86, 0.85, 0.82, 1)
    mix.inputs[7].default_value = (0.52, 0.48, 0.70, 1)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.8
    fade_wrap(m, nt, out, bsdf.outputs[0], F_DESK0 - 6, VDESK)
    return m


def pen_materials():
    mats = {}
    for name, col, metal, rough in (("Pen_Body", (0.012, 0.02, 0.06), 0.0, 0.28),
                                    ("Pen_Metal", (0.75, 0.76, 0.78), 1.0, 0.22),
                                    ("Pen_Cap", (0.02, 0.025, 0.035), 0.0, 0.4)):
        m, nt, out = fl.new_mat(name)
        b = nt.nodes.new("ShaderNodeBsdfPrincipled")
        b.inputs["Base Color"].default_value = (*col, 1)
        b.inputs["Metallic"].default_value = metal
        b.inputs["Roughness"].default_value = rough
        b.inputs["Coat Weight"].default_value = 0.3 if metal == 0 else 0.0
        fade_wrap(m, nt, out, b.outputs[0], F_DESK0, VDESK)
        mats[name] = m
    return mats


# ================================================================== GEOMETRY


def build_paper(mat):
    nx, ny = 150, 212
    xs = np.linspace(-0.105, 0.105, nx)
    ys = np.linspace(-0.1485, 0.1485, ny)
    X, Y = np.meshgrid(xs, ys)
    Z = zpaper(X, Y)
    verts = np.stack([X, Y, Z], -1).reshape(-1, 3)
    faces = []
    for j in range(ny - 1):
        for i in range(nx - 1):
            a = j * nx + i
            faces.append((a, a + 1, a + nx + 1, a + nx))
    me = bpy.data.meshes.new("Copy")
    me.from_pydata(verts.tolist(), [], faces)
    uvl = me.uv_layers.new(name="UVMap")
    uvs = np.zeros((len(me.loops), 2), np.float32)
    lv = np.zeros(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    uvs[:, 0] = (verts[lv, 0] + 0.105) / 0.21
    uvs[:, 1] = (verts[lv, 1] + 0.1485) / 0.297
    uvl.data.foreach_set("uv", uvs.ravel())
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    ob = bpy.data.objects.new("Copy", me)
    scn.collection.objects.link(ob)
    return ob


def build_plane(name, sx, sy, mat, loc, rot_z=0.0, uv=True):
    me = bpy.data.meshes.new(name)
    v = [(-sx / 2, -sy / 2, 0), (sx / 2, -sy / 2, 0), (sx / 2, sy / 2, 0), (-sx / 2, sy / 2, 0)]
    me.from_pydata(v, [], [(0, 1, 2, 3)])
    if uv:
        uvl = me.uv_layers.new(name="UVMap")
        uvl.data.foreach_set("uv", [0, 0, 1, 0, 1, 1, 0, 1])
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    scn.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    return ob


def build_pen(mats):
    import bmesh
    from mathutils import Matrix
    parts = [("body", 0.0042, 0.0042, 0.118, 0.0, "Pen_Body"),
             ("grip", 0.0045, 0.0038, 0.022, -0.069, "Pen_Cap"),
             ("tip", 0.0036, 0.0006, 0.010, -0.085, "Pen_Metal"),
             ("cap", 0.0046, 0.0046, 0.006, 0.062, "Pen_Metal")]
    me = bpy.data.meshes.new("Pen")
    bm = bmesh.new()
    for i, (nm, r1, r2, depth, off, matname) in enumerate(parts):
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=r1, radius2=r2, depth=depth,
                                    matrix=Matrix.Translation((0, 0, off)))
        for f in {f for v in res["verts"] for f in v.link_faces}:
            f.material_index = i
            f.smooth = True
    bm.to_mesh(me)
    bm.free()
    for nm, *_, matname in parts:
        me.materials.append(mats[matname])
    ob = bpy.data.objects.new("Pen", me)
    scn.collection.objects.link(ob)
    ob.rotation_euler = (math.radians(90), 0, math.radians(-28))
    ob.location = (E[0] + 0.085, E[1] - 0.05, 0.0046)
    sub = ob.modifiers.new("Bevel", "BEVEL")
    sub.width = 0.0004
    sub.segments = 2
    return ob


paper = build_paper(paper_material())
desk = build_plane("Desk", 4.0, 4.0, desk_material(), (0, 0, -0.0004), uv=False)
sheet = build_plane("Sheet_Under", 0.21, 0.297, sheet_material(), (0.035, -0.03, -0.0002), rot_z=math.radians(9))
pen = build_pen(pen_materials())

# ============================================================== INK PARTICLES
ink = np.asarray(Image.open(os.path.join(ASSETS, "copy_ink.png")), np.float32) / 255.0
red = np.asarray(Image.open(os.path.join(ASSETS, "copy_red.png")), np.float32) / 255.0
h, w = ink.shape
prob = (ink.ravel() ** 1.5).astype(np.float64)
prob /= prob.sum()
N = args.n_ink
idx = rng.choice(prob.size, N, p=prob)
py, px = np.divmod(idx, w)
px = px + rng.random(N)
py = py + rng.random(N)
mx, my = px / PX, py / PX
x, y = mm2w(mx, my)
z = zpaper(x, y) + 0.00025
start = np.stack([x, y, z], -1)
isred = red.ravel()[idx] > 0.45 * np.maximum(ink.ravel()[idx], 1e-3)
del prob
d = np.hypot(x - E[0], y - E[1])
t_rel = F_REL0 + d / VR

col = np.zeros((N, 4), np.float32)
col[:, :3] = INK_BLUE
col[isred, :3] = INK_RED
col[:, 3] = 1
col[:, :3] *= (0.75 + 0.5 * rng.random(N))[:, None]

ecx, ecy = layout["error_center_mm"]
gA = (mx > ecx - 14) & (mx < ecx + 44) & (my > ecy - 6.8) & (my < ecy + 5.6)
e2x_mm, e2y_mm = layout["error2_center_mm"]
gB = (mx > 47) & (mx < 86) & (my > e2y_mm - 6.0) & (my < e2y_mm + 6.5)
others = ~(gA | gB)


def rot_x(v, ang):
    c, s = math.cos(ang), math.sin(ang)
    out = v.copy()
    out[:, 1] = v[:, 1] * c - v[:, 2] * s
    out[:, 2] = v[:, 1] * s + v[:, 2] * c
    return out


p1 = start.copy()
p2 = start.copy()
target = start.copy()
hover = np.zeros_like(start)
t_move = np.full(N, 1e5)
dur = np.full(N, 40.0)
amp = np.zeros(N)
rad = np.where(isred, 0.00018, 0.00015) * (0.8 + 0.4 * rng.random(N))

GROUPS = {}
for g, off, tm, ang in ((gA, np.array([-0.024, 0.010, 0.034]), 92, 0.42), (gB, np.array([-0.016, -0.006, 0.024]), 98, 0.36)):
    c = start[g].mean(0)
    rel_v = start[g] - c
    tgt = rot_x(rel_v, ang) + c + off
    mid = rot_x(rel_v, ang * 0.5) + c + off * 0.55 + np.array([0, 0, 0.008])
    p1[g] = start[g] + np.array([0, 0, 0.006])
    p2[g] = mid
    target[g] = tgt
    t_move[g] = tm
    dur[g] = 46
    hover[g] = (0, 0, 0.0015)
    rad[g] *= 1.25
    GROUPS[len(GROUPS)] = (c, c + off, tm)

# ---------------------------------------------------------- network layout
C = E + np.array([0.0, 0.17, -0.50])
nodes = [E + np.array([0.0, 0.17, -0.34])]
while len(nodes) < 14:
    p = C + rng.normal(0, 1, 3) * np.array([0.30, 0.28, 0.24])
    if p[2] > -0.16:
        continue
    if min(np.linalg.norm(p - q) for q in nodes) < 0.13:
        continue
    nodes.append(p)
nodes = np.array(nodes)
node_r = 0.003 + 0.0035 * rng.random(len(nodes))
node_r[0] = 0.0055
shell_r = node_r * 4.2 + 0.012
edges = set()
for i in range(len(nodes)):
    dd = np.linalg.norm(nodes - nodes[i], axis=1)
    for j in np.argsort(dd)[1:3 + (i % 2)]:
        edges.add(tuple(sorted((i, int(j)))))
edges = sorted(edges)
arcs = {e: fl.arc_points(nodes[e[0]], nodes[e[1]], 0.12 * (1 if (e[0] + e[1]) % 2 else -1), n=48) for e in edges}

# targets for the free ink
oi = np.where(others)[0]
k = len(oi)
on_edge = rng.random(k) < 0.28
tg = np.zeros((k, 3))
# shells: weight node 0 (closest to camera) more
wts = np.ones(len(nodes))
wts[0] = 3.0
wts /= wts.sum()
ni = rng.choice(len(nodes), k, p=wts)
dirs = rng.normal(0, 1, (k, 3))
dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
tg[:] = nodes[ni] + dirs * (shell_r[ni] * (0.85 + 0.3 * rng.random(k)))[:, None]
ekeys = list(arcs.keys())
ei = rng.integers(0, len(ekeys), k)
tt = rng.random(k)
for q in np.where(on_edge)[0]:
    pts = arcs[ekeys[ei[q]]]
    u = tt[q] * (len(pts) - 1)
    a = int(u)
    b = min(a + 1, len(pts) - 1)
    tg[q] = pts[a] + (pts[b] - pts[a]) * (u - a) + rng.normal(0, 0.0025, 3)
# teacher annotations (red ink) converge on one dedicated node
d0 = np.linalg.norm(nodes - nodes[0], axis=1)
T_NODE = int(np.argsort(d0)[2])
red_o = isred[oi]
nr = int(red_o.sum())
rd = rng.normal(0, 1, (nr, 3))
rd /= np.linalg.norm(rd, axis=1, keepdims=True)
tg[red_o] = nodes[T_NODE] + rd * (shell_r[T_NODE] * (0.9 + 0.2 * rng.random(nr)))[:, None]
target[oi] = tg
# coherent lift: whole words float up together (smooth function of position)
lift = 0.0035 + 0.0025 * np.sin(start[oi, 0] * 90.0 + 1.3) * np.cos(start[oi, 1] * 70.0)
hover[oi] = np.stack([np.zeros(k), np.zeros(k), lift], -1)
# the writing floats briefly, then pours down into the depth well ahead of the
# camera (fast, early), so the camera never flies through the particle stream
t_move[oi] = t_rel[oi] + 16 + 14 * rng.random(k)
dur[oi] = 26 + 16 * rng.random(k)
p1[oi] = start[oi] + hover[oi] + np.array([0, 0, 0.006])
lat = rng.normal(0, 1, (k, 3)) * np.array([0.03, 0.03, 0.0])
p2[oi] = start[oi] + (tg - start[oi]) * 0.55 + lat
amp[oi] = 0.002 + 0.004 * rng.random(k)
drift = np.full(N, 0.00012)
# ink outside the camera's view does not travel: it simply evaporates after release
life = np.full(N, 1e6)
far = others & (d >= 0.09)
t_move[far] = 1e5
life[far] = rng.uniform(16, 36, int(far.sum()))
hover[far] = hover[far] * 0.5

ink_mat = fl.point_mat("Ink_Glow", strength=4.4, near_fade=(0.012, 0.05))
ink_obj = fl.flow_points_object("InkFlow", {
    "start": start, "p1": p1, "p2": p2, "target": target, "hover": hover,
    "t_rel": t_rel, "t_move": t_move, "dur": dur, "life": life,
    "rad": rad, "amp": amp, "drift": drift, "col": col}, ink_mat)

# ------------------------------------------------------- paper dust (dissolve)
ND = args.n_dust
dx = rng.uniform(-0.105, 0.105, ND)
dy = rng.uniform(-0.1485, 0.1485, ND)
dz = zpaper(dx, dy) + 0.0002
ds = np.stack([dx, dy, dz], -1)
dd = np.hypot(dx - E[0], dy - E[1])
dt_rel = F_DIS0 + dd / VD + rng.uniform(-2, 3, ND)
dtgt = ds + np.stack([rng.normal(0, 0.006, ND), rng.normal(0, 0.006, ND), -rng.uniform(0.004, 0.035, ND)], -1)
dcol = np.zeros((ND, 4), np.float32)
dcol[:, :3] = (0.55, 0.72, 1.0)
dcol[:, :3] *= (0.25 + 0.5 * rng.random(ND))[:, None]
dcol[:, 3] = 1
dust_mat = fl.point_mat("PaperDust_Glow", strength=1.2, near_fade=(0.012, 0.05))
fl.flow_points_object("PaperDust", {
    "start": ds, "p1": ds + np.array([0, 0, 0.004]), "p2": ds + (dtgt - ds) * 0.5, "target": dtgt,
    "hover": np.zeros_like(ds), "t_rel": dt_rel, "t_move": dt_rel + 2, "dur": rng.uniform(50, 90, ND),
    "life": rng.uniform(12, 28, ND), "rad": rng.uniform(0.00006, 0.00014, ND), "amp": rng.uniform(0.002, 0.006, ND),
    "col": dcol}, dust_mat)

# -------------------------------------------------------------- space dust
NS = 7000
sp = np.stack([rng.uniform(E[0] - 0.7, E[0] + 0.7, NS), rng.uniform(E[1] - 0.4, E[1] + 1.0, NS), rng.uniform(-1.4, -0.03, NS)], -1)
scol = np.zeros((NS, 4), np.float32)
scol[:, :3] = (0.6, 0.78, 1.0)
scol[:, :3] *= (0.15 + 0.6 * rng.random(NS) ** 2)[:, None]
scol[:, 3] = 1
space_mat = fl.point_mat("SpaceDust_Glow", strength=2.2, near_fade=(0.02, 0.08))
fl.flow_points_object("SpaceDust", {
    "start": sp, "p1": sp, "p2": sp, "target": sp, "hover": np.zeros_like(sp),
    "t_rel": np.full(NS, -50.0), "t_move": np.full(NS, 1e5), "dur": np.full(NS, 1.0), "life": np.full(NS, 1e6),
    "rad": rng.uniform(0.0004, 0.0016, NS), "amp": np.zeros(NS), "drift": rng.uniform(0.01, 0.03, NS), "col": scol}, space_mat)

# ------------------------------------------------------------ network objects
core_mat = fl.emission_mat("Node_Core", (0.75, 0.88, 1.0), 7.0, prop="glow")
edge_mat = fl.emission_mat("Edge_Glow", (0.35, 0.62, 1.0), 2.4, prop="glow")
ring_mat = fl.emission_mat("Ring_Glow", (0.45, 0.70, 1.0), 1.1, prop="glow")
appear = {}
order = np.argsort(np.linalg.norm(nodes - nodes[0], axis=1))
for rank, i in enumerate(order):
    f0 = 120 + rank * 3.2 + rng.uniform(0, 3)
    appear[i] = f0
    ob = fl.icosphere(f"Node_{i:02d}", node_r[i], 3, core_mat, loc=nodes[i])
    fl.key_prop(ob, "glow", [(1, 0.0), (f0, 0.0), (f0 + 5, 1.6), (f0 + 14, 1.0)])
    ob.scale = (0.01, 0.01, 0.01)
    ob.keyframe_insert("scale", frame=1)
    ob.keyframe_insert("scale", frame=int(f0))
    ob.scale = (1.15, 1.15, 1.15)
    ob.keyframe_insert("scale", frame=int(f0) + 6)
    ob.scale = (1, 1, 1)
    ob.keyframe_insert("scale", frame=int(f0) + 12)
    if rank % 2 == 0:
        R = shell_r[i] * 1.5
        ang = np.linspace(0, 2 * np.pi, 97)[:-1]
        ring = fl.poly_curve(f"Ring_{i:02d}", np.stack([R * np.cos(ang), R * np.sin(ang), 0 * ang], -1), 0.0003, ring_mat, cyclic=True)
        ring.location = nodes[i]
        ring.rotation_euler = tuple(rng.uniform(0, math.pi, 3))
        ring.keyframe_insert("rotation_euler", frame=1)
        ring.rotation_euler[2] += 0.9
        ring.keyframe_insert("rotation_euler", frame=F_END)
        fl.set_linear(ring)
        fl.key_prop(ring, "glow", [(1, 0.0), (f0 + 4, 0.0), (f0 + 16, 1.0)])

for e, pts in arcs.items():
    ob = fl.poly_curve(f"Edge_{e[0]:02d}_{e[1]:02d}", pts, 0.0004, edge_mat)
    f0 = max(appear[e[0]], appear[e[1]]) + 4 + rng.uniform(0, 8)
    ob.data.bevel_factor_mapping_end = "SPLINE"
    ob.data.bevel_factor_end = 0.0
    ob.data.keyframe_insert("bevel_factor_end", frame=1)
    ob.data.keyframe_insert("bevel_factor_end", frame=int(f0))
    ob.data.bevel_factor_end = 1.0
    ob.data.keyframe_insert("bevel_factor_end", frame=int(f0) + 18)
    fl.key_prop(ob, "glow", [(1, 0.0), (int(f0), 0.0), (int(f0) + 3, 1.0)])

# ==================================================================== LIGHTS


def area(name, loc, size, energy, color, target):
    ld = bpy.data.lights.new(name, "AREA")
    ld.shape = "RECTANGLE"
    ld.size, ld.size_y = size
    ld.energy = energy
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    scn.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = fl.look_rotation(loc, target, (0, 0, 1))
    return ob, ld


key_ob, key_l = area("Key_Window", (E[0] - 1.25, E[1] + 0.75, 1.05), (1.4, 0.9), 34.0, (0.90, 0.95, 1.0), E)
fill_ob, fill_l = area("Fill_Warm", (E[0] + 0.85, E[1] - 1.0, 0.45), (0.7, 0.5), 3.0, (1.0, 0.80, 0.62), E)
for ld, vals in ((key_l, [(1, 34.0), (52, 34.0), (100, 0.8), (130, 0.0)]),
                 (fill_l, [(1, 3.0), (52, 3.0), (96, 0.0)])):
    for f, v in vals:
        ld.energy = v
        ld.keyframe_insert("energy", frame=f)

sig_ld = bpy.data.lights.new("Signal_Light", "POINT")
sig_ld.color = (0.45, 0.68, 1.0)
sig_ld.shadow_soft_size = 0.004
sig_ob = bpy.data.objects.new("Signal_Light", sig_ld)
scn.collection.objects.link(sig_ob)
sig_ob.location = (E[0], E[1], E[2] + 0.02)
for f, v in ((1, 0.0), (34, 0.0), (58, 0.006), (96, 0.004), (130, 0.0)):
    sig_ld.energy = v
    sig_ld.keyframe_insert("energy", frame=f)

world = scn.world
if world.node_tree is None:
    world.use_nodes = True
wnt = world.node_tree
bg = wnt.nodes.get("Background") or wnt.nodes.new("ShaderNodeBackground")
wout = wnt.nodes.get("World Output") or wnt.nodes.new("ShaderNodeOutputWorld")
wnt.links.new(bg.outputs[0], wout.inputs["Surface"])
bg.inputs["Color"].default_value = (0.010, 0.013, 0.022, 1)
fl.key_socket(bg.inputs["Strength"], [(1, 1.0), (56, 1.0), (104, 0.0)])

# ==================================================================== CAMERA
cam_d = bpy.data.cameras.new("Cam")
cam_d.sensor_width = 36.0
cam_d.dof.use_dof = True
cam_d.dof.aperture_fstop = 3.2
cam_d.dof.aperture_blades = 9
cam_d.dof.aperture_rotation = 0.3
cam_d.clip_start = 0.001
cam_d.clip_end = 20
cam = bpy.data.objects.new("Cam", cam_d)
scn.collection.objects.link(cam)
scn.camera = cam

V = lambda *a: np.array(a, float)  # noqa: E731
keys_pos = [(1, E + V(0.048, -0.205, 0.165)), (48, E + V(0.036, -0.168, 0.150)), (84, E + V(0.020, -0.112, 0.148)),
            (112, E + V(0.006, -0.060, 0.122)), (124, E + V(0.002, -0.028, 0.060)), (136, E + V(0.000, 0.004, -0.030)),
            (164, E + V(0.002, 0.040, -0.105)), (192, E + V(0.004, 0.062, -0.150))]
keys_tgt = [(1, E + V(0.012, 0.004, 0)), (48, E + V(0.006, 0.004, 0)), (84, E + V(0.0, 0.006, 0.006)),
            (112, E + V(-0.006, 0.014, 0.0)), (124, E + V(-0.002, 0.03, -0.06)), (136, E + V(0.0, 0.07, -0.20)),
            (164, E + V(0.0, 0.13, -0.38)), (192, C)]
keys_lens = [(1, 70.0), (48, 70.0), (84, 62.0), (112, 50.0), (124, 42.0), (136, 36.0), (164, 32.0), (192, 30.0)]
frames = list(range(1, F_END + 1))
pos = fl.catmull(keys_pos, frames)
tgt = fl.catmull(keys_tgt, frames)
lens = fl.catmull([(f, np.array([v])) for f, v in keys_lens], frames)[:, 0]
cA0, cA1, tmA = GROUPS[0]


def groupA_center(f):
    u = np.clip((f - tmA) / 46.0, 0, 1)  # group A travel (dur 46)
    u = u * u * u * (u * (6 * u - 15) + 10)
    return cA0 + (cA1 - cA0) * u


focus = []
for i, f in enumerate(frames):
    d_look = np.linalg.norm(tgt[i] - pos[i])
    d_A = np.linalg.norm(groupA_center(f) - pos[i])
    d_N = np.linalg.norm(nodes[0] - pos[i])
    wA = np.clip((f - 84) / 20, 0, 1) * (1 - np.clip((f - 114) / 10, 0, 1))
    wN = np.clip((f - 126) / 16, 0, 1)
    fd = d_look * (1 - wA) + d_A * wA
    fd = fd * (1 - wN) + d_N * wN
    focus.append(fd)
fstops = [3.2 if f < 120 else 3.2 + 2.8 * min((f - 120) / 30, 1) for f in frames]
fl.animate_camera(cam, frames, pos, tgt, lens, focus, fstops)
for ob in scn.objects:
    if ob.type in {"MESH", "CURVE"}:
        ob.cycles.use_motion_blur = False   # camera blur only (GN points: 3x BVH otherwise)

# ===================================================================== SAVE
fl.save_blend(args.out)
print("SAVED", args.out, "points:", N, ND, NS, "nodes", len(nodes), "edges", len(edges))
