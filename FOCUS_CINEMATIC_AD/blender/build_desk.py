"""SEQUENCES 1 & 5 — the human side, without synthetic humans.

No CG people are shown (a deliberate choice: no photorealistic human generator
is available in this environment and fake 3D humans would cheapen the film).
The student and the teacher are present through point-of-view framing and
their own cast shadows (invisible proxies that only cast shadows), the light
of their moment of the day, and the objects on their desks.

  --set student : morning sun, classroom.  Shots 1A (f1-72), 1B (f73-150), 5B (f151-210)
  --set teacher : evening, warm practical.  Shots 1C (f1-90), 5A (f91-150)
"""
import argparse
import json
import math
import os
import sys

import bpy  # noqa: I001  (bpy must be imported before bmesh)
import bmesh
import numpy as np
from mathutils import Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import focus_lib as fl  # noqa: E402

ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "assets")

ap = argparse.ArgumentParser()
ap.add_argument("--set", required=True, choices=["student", "teacher", "laptop"])
ap.add_argument("--screen-seq", default="", help="first PNG of the network frames shown on the laptop screen (4A)")
ap.add_argument("--res", default="1920x1080")
ap.add_argument("--samples", type=int, default=16)
ap.add_argument("--out", default="")
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
RES = tuple(int(v) for v in args.res.split("x"))
OUT = args.out or os.path.join(HERE, f"FOCUS_desk_{args.set}.blend")
F_END = {"student": 210, "teacher": 150, "laptop": 80}[args.set]

rng = np.random.default_rng(31)
layout = json.load(open(os.path.join(ASSETS, "copy_layout.json")))
scn = fl.reset_scene()
fl.setup_render(scn, res=RES, samples=args.samples, frames=(1, F_END), out_dir=f"//../renders/desk_{args.set}/f_####")
scn.camera = None
V = lambda *a: np.array(a, float)  # noqa: E731


def mm2local(mx, my):
    return mx / 1000.0 - 0.105, 0.1485 - my / 1000.0


# ================================================================= materials


def image_mat(name, fname, rough=0.8, noncolor=False, bump=True):
    m, nt, out = fl.new_mat(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(os.path.join(ASSETS, fname), check_existing=True)
    tex.interpolation = "Linear"
    nt.links.new(tc.outputs["UV"], tex.inputs["Vector"])
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    b.inputs["Sheen Weight"].default_value = 0.12
    if bump:
        bp = nt.nodes.new("ShaderNodeBump")
        bp.inputs["Strength"].default_value = 0.04
        bp.inputs["Distance"].default_value = 0.0002
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 900.0
        nz.inputs["Detail"].default_value = 2.0
        nt.links.new(nz.outputs["Fac"], bp.inputs["Height"])
        nt.links.new(bp.outputs["Normal"], b.inputs["Normal"])
    nt.links.new(b.outputs[0], out.inputs["Surface"])
    return m


def blank_sheet_mat(name):
    m, nt, out = fl.new_mat(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tex = nt.nodes.new("ShaderNodeTexImage")
    im = bpy.data.images.load(os.path.join(ASSETS, "copy_lines.png"), check_existing=True)
    im.colorspace_settings.name = "Non-Color"
    tex.image = im
    nt.links.new(tc.outputs["UV"], tex.inputs["Vector"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(tex.outputs["Color"], mix.inputs["Factor"])
    mix.inputs[6].default_value = (0.86, 0.85, 0.82, 1)
    mix.inputs[7].default_value = (0.52, 0.48, 0.70, 1)
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(mix.outputs[2], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.8
    nt.links.new(b.outputs[0], out.inputs["Surface"])
    return m


def principled(name, col, rough=0.5, metal=0.0, coat=0.0, spec=0.5):
    m, nt, out = fl.new_mat(name)
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Specular IOR Level"].default_value = spec
    nt.links.new(b.outputs[0], out.inputs["Surface"])
    return m


def wood_mat(name, light=True):
    """Laminate desk top: fine stretched grain, low contrast (no zebra stripes)."""
    m, nt, out = fl.new_mat(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (2.0, 40.0, 2.0)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 6.0
    nz.inputs["Detail"].default_value = 6.0
    nz.inputs["Roughness"].default_value = 0.55
    nt.links.new(mp.outputs[0], nz.inputs["Vector"])
    big = nt.nodes.new("ShaderNodeTexNoise")
    big.inputs["Scale"].default_value = 3.0
    nt.links.new(tc.outputs["Object"], big.inputs["Vector"])
    mixf = fl.math_node(nt, "ADD", fl.math_node(nt, "MULTIPLY", nz.outputs["Fac"], 0.7).outputs[0],
                        fl.math_node(nt, "MULTIPLY", big.outputs["Fac"], 0.3).outputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.3
    ramp.color_ramp.elements[1].position = 0.7
    if light:
        ramp.color_ramp.elements[0].color = (0.42, 0.33, 0.24, 1)
        ramp.color_ramp.elements[1].color = (0.55, 0.44, 0.32, 1)
    else:
        ramp.color_ramp.elements[0].color = (0.016, 0.018, 0.022, 1)
        ramp.color_ramp.elements[1].color = (0.034, 0.037, 0.044, 1)
    nt.links.new(mixf.outputs[0], ramp.inputs["Fac"])
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.38 if light else 0.4
    b.inputs["Coat Weight"].default_value = 0.2 if light else 0.1
    b.inputs["Coat Roughness"].default_value = 0.3
    nt.links.new(b.outputs[0], out.inputs["Surface"])
    return m


# ================================================================== geometry


def box(name, size, loc, mat, bevel=0.002, rot=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    scn.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    if bevel:
        bv = ob.modifiers.new("Bevel", "BEVEL")
        bv.width = bevel
        bv.segments = 3
    return ob


def cylinder(name, r1, r2, depth, loc, mat, rot=(0, 0, 0), seg=48):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=depth)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    scn.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def sheet(name, mat, loc, rot_z=0.0, curl=0.0012, nx=60, ny=84):
    xs = np.linspace(-0.105, 0.105, nx)
    ys = np.linspace(-0.1485, 0.1485, ny)
    X, Y = np.meshgrid(xs, ys)
    Z = curl * (X / 0.105) ** 2 + 0.6 * curl * ((Y + 0.1485) / 0.297) ** 3
    verts = np.stack([X, Y, Z], -1).reshape(-1, 3)
    faces = [(j * nx + i, j * nx + i + 1, (j + 1) * nx + i + 1, (j + 1) * nx + i) for j in range(ny - 1) for i in range(nx - 1)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces)
    uvl = me.uv_layers.new(name="UVMap")
    lv = np.zeros(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    uv = np.stack([(verts[lv, 0] + 0.105) / 0.21, (verts[lv, 1] + 0.1485) / 0.297], -1)
    uvl.data.foreach_set("uv", uv.astype(np.float32).ravel())
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    scn.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    return ob


def pen(name, body_col, loc, rot_z, cap_on=True):
    body = principled(name + "_Body", body_col, 0.3, coat=0.3)
    metal = principled(name + "_Metal", (0.75, 0.76, 0.78), 0.22, metal=1.0)
    capm = principled(name + "_Cap", tuple(c * 0.8 for c in body_col), 0.35)
    parts = [(0.0042, 0.0042, 0.118, 0.0, 0), (0.0045, 0.0038, 0.022, -0.069, 2), (0.0036, 0.0006, 0.010, -0.085, 1)]
    if cap_on:
        parts.append((0.0049, 0.0049, 0.05, 0.035, 2))
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for r1, r2, depth, off, mi in parts:
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=40, radius1=r1, radius2=r2, depth=depth, matrix=Matrix.Translation((0, 0, off)))
        for f in {f for v in res["verts"] for f in v.link_faces}:
            f.material_index = mi
            f.smooth = True
    bm.to_mesh(me)
    bm.free()
    for mm_ in (body, metal, capm):
        me.materials.append(mm_)
    ob = bpy.data.objects.new(name, me)
    scn.collection.objects.link(ob)
    ob.rotation_euler = (math.radians(90), 0, rot_z)
    ob.location = loc
    return ob


def shadow_figure(name, head_pos, bun=False, scale=1.0):
    """Invisible head + shoulders that only cast a shadow (person off-frame)."""
    root = bpy.data.objects.new(name, None)
    scn.collection.objects.link(root)
    root.location = head_pos
    mat = principled(name + "_mat", (0.2, 0.2, 0.2), 0.8)
    parts = [("head", (0.155, 0.19, 0.225), (0, 0, 0)),
             ("neck", (0.11, 0.11, 0.14), (0, 0.02, -0.15)),
             ("shoulders", (0.44, 0.17, 0.16), (0, 0.05, -0.27)),
             ("torso", (0.38, 0.2, 0.45), (0, 0.07, -0.5))]
    if bun:
        parts.append(("bun", (0.085, 0.085, 0.085), (0, 0.10, 0.06)))
    else:
        parts.append(("hair", (0.165, 0.2, 0.12), (0, 0.005, 0.07)))
    for pn, sz, off in parts:
        me = bpy.data.meshes.new(f"{name}_{pn}")
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=0.5)
        bmesh.ops.scale(bm, vec=sz, verts=bm.verts)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat)
        ob = bpy.data.objects.new(f"{name}_{pn}", me)
        scn.collection.objects.link(ob)
        ob.parent = root
        ob.location = off
        ob.visible_camera = False
        ob.visible_diffuse = False
        ob.visible_glossy = False
        ob.visible_transmission = False
        ob.visible_volume_scatter = False
        ob.visible_shadow = True
    root.scale = (scale, scale, scale)
    return root


def show_between(ob, f0, f1):
    """Render-visible only for frames f0..f1 (shot-specific props)."""
    for f, hide in ((1, f0 > 1), (f0, False), (f1 + 1, True)):
        if f < 1:
            continue
        ob.hide_render = hide
        ob.keyframe_insert("hide_render", frame=f)
    for ch in ob.children:
        show_between(ch, f0, f1)


def sun(direction_to_sun, strength, color, angle_deg=1.2):
    ld = bpy.data.lights.new("Sun", "SUN")
    ld.energy = strength
    ld.color = color
    ld.angle = math.radians(angle_deg)
    ob = bpy.data.objects.new("Sun", ld)
    scn.collection.objects.link(ob)
    d = np.asarray(direction_to_sun, float)
    d /= np.linalg.norm(d)
    ob.rotation_euler = fl.look_rotation((0, 0, 0), tuple(-d), (0, 0, 1))
    return ob


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
    return ob


def world(color, strength):
    w = scn.world
    if w.node_tree is None:
        w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (*color, 1)
    bg.inputs["Strength"].default_value = strength


def shot(name, f0, f1, pos_keys, tgt_keys, lens, fstop, focus_keys=None, power=1.4, up=(0, 0, 1)):
    frames = list(range(f0, f1 + 1))
    eased = fl.ease_frames(frames, f0, f1, power)
    pos = fl.catmull(pos_keys, eased)
    tgt = fl.catmull(tgt_keys, eased)
    ln = fl.catmull([(k, np.array([v])) for k, v in lens], eased)[:, 0]
    fo_pts = fl.catmull(focus_keys, eased) if focus_keys else tgt
    focus = [float(np.linalg.norm(t - p)) for p, t in zip(pos, fo_pts)]
    return fl.shot_camera(scn, name, f0, frames, pos, tgt, ln, focus, [fstop] * len(frames), up_hint=up)


# copy placement helpers (copy sheet local -> world)
def on_copy(ob_loc, rot_z, mx, my, z=0.0):
    lx, ly = mm2local(mx, my)
    c, s = math.cos(rot_z), math.sin(rot_z)
    return V(ob_loc[0] + lx * c - ly * s, ob_loc[1] + lx * s + ly * c, ob_loc[2] + z)


ERR = layout["error_center_mm"]
GRADE = layout["grade_center_mm"]

# ==================================================================== LAPTOP


def build_laptop_and_shot():
    """Generic laptop (no brand) whose screen shows the network, then the REAL
    FOCUS dashboard captured from the prototype (assets/ui/dashboard.png)."""
    alu = principled("Laptop_Alu", (0.17, 0.175, 0.18), 0.32, metal=1.0)
    alu.node_tree.nodes["Principled BSDF"].inputs["Anisotropic"].default_value = 0.4
    keym = principled("Laptop_Keys", (0.012, 0.012, 0.013), 0.55)
    well = principled("Laptop_Well", (0.03, 0.03, 0.032), 0.5)
    pad = principled("Laptop_Pad", (0.11, 0.115, 0.12), 0.25, metal=0.6)
    bez = principled("Laptop_Bezel", (0.005, 0.005, 0.006), 0.12, spec=0.6)
    B = V(0.10, 0.12, 0.0)
    W, D, T = 0.304, 0.215, 0.012
    box("Laptop_Base", (W, D, T), tuple(B + V(0, 0, T / 2)), alu, 0.004)
    box("Laptop_KeyWell", (W - 0.03, 0.105, 0.001), tuple(B + V(0, 0.035, T + 0.0002)), well, 0.002)
    # keys: one mesh
    me = bpy.data.meshes.new("Laptop_KeysMesh")
    bm = bmesh.new()
    kw, gap = 0.0155, 0.0032
    rows = [(14, 0.0), (14, 0.0), (13, 0.004), (12, 0.008), (11, 0.0)]
    for r, (n, off) in enumerate(rows):
        y = 0.075 - r * (kw + gap)
        x0 = -((n * kw + (n - 1) * gap) / 2) + off
        for c in range(n):
            res = bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, vec=(kw, kw, 0.0012), verts=res["verts"])
            bmesh.ops.translate(bm, vec=(x0 + c * (kw + gap) + kw / 2, y, 0), verts=res["verts"])
    res = bmesh.ops.create_cube(bm, size=1.0)  # space bar
    bmesh.ops.scale(bm, vec=(0.09, kw, 0.0012), verts=res["verts"])
    bmesh.ops.translate(bm, vec=(0, 0.075 - 5 * (kw + gap), 0), verts=res["verts"])
    bm.to_mesh(me)
    bm.free()
    me.materials.append(keym)
    keys = bpy.data.objects.new("Laptop_Keys", me)
    scn.collection.objects.link(keys)
    keys.location = tuple(B + V(0, -0.005, T + 0.0008))
    box("Laptop_Trackpad", (0.115, 0.072, 0.0006), tuple(B + V(0, -0.062, T + 0.0001)), pad, 0.003)
    # lid, tilted 15 deg back
    tilt = math.radians(15)
    u = V(0, math.sin(tilt), math.cos(tilt))
    n = V(0, -math.cos(tilt), math.sin(tilt))
    hinge = B + V(0, D / 2 - 0.004, T)
    lid_c = hinge + u * 0.106 + n * 0.0
    box("Laptop_Lid", (W, 0.006, 0.212), tuple(lid_c - n * 0.003), alu, 0.004, rot=(-tilt, 0, 0))
    box("Laptop_Bezel", (W - 0.006, 0.0008, 0.206), tuple(lid_c + n * 0.0004), bez, 0.003, rot=(-tilt, 0, 0))
    cylinder("Laptop_Hinge", 0.0055, 0.0055, W - 0.06, tuple(hinge + V(0, 0, 0.001)), alu, rot=(0, math.radians(90), 0))
    # screen: real UI (and the network frames first)
    sw, sh = 0.286, 0.17875
    sc = lid_c + n * 0.0009 + u * 0.004
    m, nt, out = fl.new_mat("Screen")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    dash = nt.nodes.new("ShaderNodeTexImage")
    dash.image = bpy.data.images.load(os.path.join(ASSETS, "ui", "dashboard.png"), check_existing=True)
    nt.links.new(tc.outputs["UV"], dash.inputs["Vector"])
    net = nt.nodes.new("ShaderNodeTexImage")
    if args.screen_seq and os.path.exists(args.screen_seq):
        im = bpy.data.images.load(args.screen_seq)
        im.source = "SEQUENCE"
        net.image = im
        net.image_user.frame_duration = 60   # seq3 frames 361-420
        net.image_user.frame_start = 1
        net.image_user.frame_offset = 360           # file f_0361.png at shot frame 1
        net.image_user.use_auto_refresh = True
        # 16:9 frames on a 16:10 screen: scale V so the image covers the panel
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Location"].default_value = (0.05, 0.0, 0)      # centre crop: 90 % of the width
        mp.inputs["Scale"].default_value = (0.9, 1.0, 1)
        nt.links.new(tc.outputs["UV"], mp.inputs["Vector"])
        nt.links.new(mp.outputs[0], net.inputs["Vector"])
    else:
        net.image = dash.image
        nt.links.new(tc.outputs["UV"], net.inputs["Vector"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(net.outputs["Color"], mix.inputs[6])
    nt.links.new(dash.outputs["Color"], mix.inputs[7])
    fl.key_socket(mix.inputs["Factor"], [(1, 0.0), (26, 0.0), (46, 1.0)])
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(mix.outputs[2], em.inputs["Color"])
    fl.key_socket(em.inputs["Strength"], [(1, 1.0), (26, 1.0), (46, 0.5)])
    gl = nt.nodes.new("ShaderNodeBsdfPrincipled")
    gl.inputs["Base Color"].default_value = (0, 0, 0, 1)
    gl.inputs["Roughness"].default_value = 0.32
    gl.inputs["Specular IOR Level"].default_value = 0.25
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(em.outputs[0], add.inputs[0])
    nt.links.new(gl.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs["Surface"])
    me = bpy.data.meshes.new("Screen")
    me.from_pydata([(-sw / 2, 0, -sh / 2), (sw / 2, 0, -sh / 2), (sw / 2, 0, sh / 2), (-sw / 2, 0, sh / 2)], [], [(0, 1, 2, 3)])
    me.uv_layers.new(name="UVMap").data.foreach_set("uv", [0, 0, 1, 0, 1, 1, 0, 1])
    me.materials.append(m)
    scr = bpy.data.objects.new("Screen", me)
    scn.collection.objects.link(scr)
    scr.location = tuple(sc)
    scr.rotation_euler = (-tilt, 0, 0)
    # screen light spill on the keyboard/desk
    spill = bpy.data.lights.new("Screen_Spill", "AREA")
    spill.shape = "RECTANGLE"
    spill.size, spill.size_y = sw, sh
    spill.energy = 2.2
    spill.color = (0.86, 0.9, 1.0)
    so = bpy.data.objects.new("Screen_Spill", spill)
    scn.collection.objects.link(so)
    so.location = tuple(sc + n * 0.002)
    so.rotation_euler = fl.look_rotation(tuple(sc), tuple(sc + n), (0, 0, 1))
    # 4A: from "inside" the screen (network fills the frame) back to the desk
    d0 = (0.5 * 0.2860) / math.tan(math.atan(18 / 34.0))   # screen width == frame width at 34 mm
    shot("Cam_4A", 1, 80,
         [(1, sc + n * d0), (34, sc + n * (d0 + 0.12) + V(0.02, 0, 0.01)), (80, sc + n * 0.78 + V(0.24, 0, 0.16))],
         [(1, sc), (34, sc), (80, sc + V(0.0, -0.02, -0.06))],
         [(1, 34.0), (80, 36.0)], 2.8, power=1.8, up=tuple(u))


# =================================================================== STUDENT
if args.set == "student":
    world((0.30, 0.42, 0.62), 0.22)
    sun_dir = V(-0.42, -0.80, 0.50)                   # low morning sun behind the student's left shoulder
    sun(sun_dir, 2.4, (1.0, 0.80, 0.60), 0.8)
    area("Room_Bounce", (1.2, 1.6, 1.4), (2.5, 1.5), 14.0, (0.80, 0.88, 1.0), (0, 0, 0))
    deskm = wood_mat("Desk_Laminate", light=True)
    metal = principled("Desk_Frame", (0.08, 0.09, 0.1), 0.45, metal=0.8)
    floor = principled("Floor", (0.18, 0.17, 0.16), 0.6)
    wall = principled("Wall", (0.62, 0.62, 0.60), 0.9)
    board = principled("Whiteboard", (0.82, 0.84, 0.86), 0.25, coat=0.3)
    # student desk + room
    box("Desk", (1.20, 0.55, 0.026), (0, 0.04, -0.013), deskm)
    for sx in (-0.56, 0.56):
        box(f"Leg_{sx}", (0.03, 0.5, 0.72), (sx, 0.04, -0.39), metal, 0.003)
    box("Floor", (12, 12, 0.02), (0, 0, -0.76), floor, 0)
    for i in range(3):
        for j in range(3):
            if i == 0 and j == 1:
                continue
            x = (j - 1) * 1.55
            y = 0.04 + (i + 1) * 1.25
            box(f"BgDesk_{i}_{j}", (1.2, 0.55, 0.026), (x, y, -0.013), deskm)
            box(f"BgChair_{i}_{j}", (0.42, 0.04, 0.38), (x, y - 0.42, 0.12), metal, 0.006)
    box("FrontWall", (12, 0.1, 3.2), (0, 5.2, 0.8), wall, 0)
    box("Whiteboard", (2.6, 0.03, 1.1), (0.2, 5.14, 0.75), board, 0.004)
    box("LeftWall", (0.1, 12, 3.2), (-2.6, 0, 0.8), wall, 0)
    # window mullions in the left wall: their shadows stripe the room
    for k in range(4):
        box(f"Mullion_{k}", (0.12, 0.06, 2.0), (-2.55, -1.6 + k * 1.1, 0.9), metal, 0)
    # props on the student's desk
    ROT = math.radians(-6)
    CP = V(0.02, 0.03, 0.0013)        # above the flat-ish sheet underneath (no interpenetration)
    s_ungraded = sheet("Copy_Ungraded", image_mat("Copy_Ungraded", "copy_ungraded_color.png"), tuple(CP), ROT)
    s_graded = sheet("Copy_Graded", image_mat("Copy_Graded", "copy_color.png"), tuple(CP), ROT)
    s_reprise = sheet("Copy_Reprise", image_mat("Copy_Reprise", "reprise_color.png"), tuple(CP), ROT)
    sheet("Sheet_Under", blank_sheet_mat("Sheet_Under"), (0.06, 0.07, 0.0002), math.radians(4), curl=0.0006)
    show_between(s_ungraded, 1, 72)
    show_between(s_graded, 73, 150)
    show_between(s_reprise, 151, 210)
    pen("Pen_Blue", (0.012, 0.02, 0.06), (0.10, -0.06, 0.0058), math.radians(-30))
    case = box("PencilCase", (0.21, 0.07, 0.05), (0.40, 0.19, 0.025), principled("Case", (0.03, 0.05, 0.10), 0.8), 0.018,
               rot=(0, 0, math.radians(14)))
    box("Eraser", (0.045, 0.02, 0.012), (0.27, 0.13, 0.006), principled("Eraser", (0.92, 0.92, 0.9), 0.6), 0.002)
    calc = box("Calculator", (0.085, 0.17, 0.016), (-0.33, 0.12, 0.008), principled("Calc", (0.025, 0.027, 0.03), 0.4), 0.006,
               rot=(0, 0, math.radians(8)))
    # dust motes in the sun
    ND = 2500
    dp = np.stack([rng.uniform(-0.4, 0.5, ND), rng.uniform(-0.3, 0.9, ND), rng.uniform(0.02, 0.5, ND)], -1)
    dm, dnt, dout = fl.new_mat("Dust_Lit")
    db = dnt.nodes.new("ShaderNodeBsdfPrincipled")
    db.inputs["Base Color"].default_value = (1, 1, 1, 1)
    db.inputs["Roughness"].default_value = 1.0
    dnt.links.new(db.outputs[0], dout.inputs["Surface"])
    fl.flow_points_object("DustMotes", {
        "start": dp, "p1": dp, "p2": dp, "target": dp, "hover": np.zeros_like(dp), "t_rel": np.full(ND, -50.0),
        "t_move": np.full(ND, 1e5), "dur": np.ones(ND), "life": np.full(ND, 1e6), "rad": rng.uniform(0.00012, 0.0003, ND),
        "amp": np.zeros(ND), "drift": rng.uniform(0.01, 0.03, ND), "col": np.ones((ND, 4))}, dm)
    # the student, present through his shadow only (leaning over the desk)
    shadow_center = V(-0.15, 0.10, 0.0)
    head = shadow_center + sun_dir / np.linalg.norm(sun_dir) * 0.5
    stu = shadow_figure("Student_Shadow", tuple(head))
    stu.rotation_euler = (math.radians(-18), 0, math.radians(-8))
    for f, dz, rx in ((1, 0.0, -18), (40, -0.01, -20), (72, 0.0, -19), (73, 0.05, -10), (150, 0.06, -9),
                      (151, -0.005, -20), (180, -0.012, -22), (210, -0.004, -19)):
        stu.location = tuple(head + V(0, 0, dz))
        stu.rotation_euler[0] = math.radians(rx)
        stu.keyframe_insert("location", frame=f)
        stu.keyframe_insert("rotation_euler", frame=f)
    # ---- cameras (point of view of the student: he is behind the lens)
    centre = on_copy(CP, ROT, 105, 120)
    err = on_copy(CP, ROT, *ERR)
    grade = on_copy(CP, ROT, *GRADE)
    shot("Cam_1A", 1, 72,
         [(1, err + V(0.11, -0.19, 0.20)), (72, err + V(0.06, -0.14, 0.16))],
         [(1, err + V(0.03, -0.035, 0)), (72, err + V(0.015, -0.01, 0))],
         [(1, 50.0), (72, 55.0)], 3.2)
    shot("Cam_1B", 73, 150,
         [(73, grade + V(0.03, -0.17, 0.12)), (110, grade + V(-0.03, -0.17, 0.12)), (150, err + V(0.03, -0.15, 0.12))],
         [(73, grade), (110, grade + (err - grade) * 0.45), (150, err)],
         [(73, 75.0), (150, 75.0)], 2.8,
         focus_keys=[(73, grade), (105, grade), (125, err), (150, err)])
    rep_a = on_copy(CP, ROT, 75, 84)
    shot("Cam_5B", 151, 210,
         [(151, rep_a + V(0.04, -0.13, 0.10)), (210, rep_a + V(0.05, -0.22, 0.20))],
         [(151, rep_a), (210, rep_a + V(0.0, 0.03, 0))],
         [(151, 60.0), (210, 50.0)], 3.2)

# =================================================================== TEACHER (+ LAPTOP)
else:
    LAPTOP = args.set == "laptop"
    STK = V(-0.36, -0.04, 0.0) if LAPTOP else V(0.0, 0.0, 0.0)
    world((0.05, 0.07, 0.12), 0.25)
    desk = box("Desk", (1.6, 0.8, 0.03), (0, 0.1, -0.015), wood_mat("Desk_Dark", light=False))
    # warm practical behind-left of the teacher (casts her shadow onto the copies)
    lamp_ld = bpy.data.lights.new("Practical_Warm", "SPOT")
    lamp_ld.energy = 14.0
    lamp_ld.color = (1.0, 0.70, 0.45)
    lamp_ld.shadow_soft_size = 0.03
    lamp_ld.spot_size = math.radians(80)
    lamp_ld.spot_blend = 0.6
    lamp = bpy.data.objects.new("Practical_Warm", lamp_ld)
    scn.collection.objects.link(lamp)
    LAMP = V(-0.42, -0.52, 0.62)
    lamp.location = tuple(LAMP)
    lamp.rotation_euler = fl.look_rotation(tuple(LAMP), (0.0, 0.08, 0.0), (0, 0, 1))
    area("Window_Dusk", (0.9, 1.4, 0.9), (1.4, 1.0), 9.0, (0.55, 0.68, 1.0), (0, 0, 0))
    area("Fill", (-1.0, 0.6, 0.6), (0.6, 0.6), 1.5, (0.8, 0.85, 1.0), (0, 0, 0))
    # stack of copies
    blank = blank_sheet_mat("Sheet_Blank")
    for k in range(7):                 # flat stack, bottom (k=0) to top
        sheet(f"Stack_{k}", blank, tuple(STK + V(0.004 * rng.normal(), 0.004 * rng.normal(), 0.0003 + k * 0.0004)),
              math.radians(rng.normal(0, 2.2)) + (0.35 if LAPTOP else 0.0), curl=0.0, nx=4, ny=4)
    CP = STK + V(0.0, 0.0, 0.0031)
    ROT = 0.35 if LAPTOP else 0.0
    top = sheet("Copy_Graded", image_mat("Copy_Graded", "copy_color.png"), tuple(CP), ROT)
    pen("Pen_Red", (0.45, 0.02, 0.03), tuple(STK + V(0.16, -0.06, 0.0049 + 0.0035)), math.radians(-35), cap_on=False)
    cyl = cylinder("PenCap_Red", 0.0049, 0.0049, 0.05, tuple(STK + V(0.20, 0.11, 0.0049 + 0.0035)), principled("Cap_Red", (0.36, 0.02, 0.03), 0.35),
                   rot=(math.radians(90), 0, math.radians(70)))
    MUG = V(0.42, 0.02, 0.0) if LAPTOP else V(-0.36, 0.26, 0.0)
    mug = cylinder("Mug", 0.042, 0.04, 0.095, tuple(MUG + V(0, 0, 0.0475)), principled("Mug", (0.03, 0.05, 0.11), 0.25, coat=0.6), seg=64)
    cylinder("MugCoffee", 0.038, 0.038, 0.002, tuple(MUG + V(0, 0, 0.088)), principled("Coffee", (0.03, 0.015, 0.008), 0.05, coat=1.0))
    # distant desk lamp: a warm out-of-focus glow in the background
    shade = cylinder("DeskLamp_Shade", 0.075, 0.04, 0.09, (0.62, 0.62, 0.36), principled("Lamp_Black", (0.02, 0.02, 0.02), 0.5),
                     rot=(math.radians(-25), 0, 0))
    bulb = fl.icosphere("DeskLamp_Bulb", 0.02, 3, fl.emission_mat("Bulb", (1.0, 0.75, 0.5), 30.0), loc=(0.62, 0.63, 0.33))
    cylinder("DeskLamp_Arm", 0.008, 0.008, 0.36, (0.62, 0.70, 0.18), principled("Lamp_Arm", (0.02, 0.02, 0.02), 0.4))
    blp = bpy.data.lights.new("DeskLamp_Light", "POINT")
    blp.energy = 6.0
    blp.color = (1.0, 0.72, 0.45)
    blp.shadow_soft_size = 0.02
    blo = bpy.data.objects.new("DeskLamp_Light", blp)
    scn.collection.objects.link(blo)
    blo.location = (0.62, 0.61, 0.30)
    # sticky note (only in 5A)
    note_m = image_mat("Sticky", "sticky_note.png", rough=0.6, bump=False)
    me = bpy.data.meshes.new("Sticky")
    me.from_pydata([(-0.038, -0.038, 0), (0.038, -0.038, 0), (0.038, 0.038, 0.0015), (-0.038, 0.038, 0.0015)], [], [(0, 1, 2, 3)])
    me.uv_layers.new(name="UVMap").data.foreach_set("uv", [0, 0, 1, 0, 1, 1, 0, 1])
    me.materials.append(note_m)
    note = bpy.data.objects.new("Sticky", me)
    scn.collection.objects.link(note)
    note.location = tuple(on_copy(CP, ROT, 150, 92, 0.0006))
    note.rotation_euler = (0, 0, math.radians(5))
    show_between(note, 91, 150)
    if LAPTOP:
        note.hide_render = True
    # the teacher, through her shadow (lamp behind-left)
    head = V(-0.20, -0.33, 0.36)
    tea = shadow_figure("Teacher_Shadow", tuple(head), bun=True)
    for f, off, rx in ((1, V(0, 0, 0), -12), (45, V(0.01, 0.025, -0.015), -20), (90, V(0.015, 0.04, -0.02), -24),
                       (91, V(0.0, 0.02, -0.01), -18), (150, V(-0.02, -0.04, 0.01), -8)):
        tea.location = tuple(head + off)
        tea.rotation_euler = (math.radians(rx), 0, math.radians(-10))
        tea.keyframe_insert("location", frame=f)
        tea.keyframe_insert("rotation_euler", frame=f)
    err = on_copy(CP, ROT, *ERR)
    if LAPTOP:
        build_laptop_and_shot()
    # 1C ends on the exact framing of the pilot's first frame (match cut into sequence 2)
    if not LAPTOP:
      shot("Cam_1C", 1, 90,
         [(1, err + V(0.11, -0.33, 0.30)), (90, err + V(0.048, -0.205, 0.165))],
         [(1, err + V(0.04, 0.0, 0.0)), (90, err + V(0.012, 0.004, 0.0))],
         [(1, 55.0), (90, 70.0)], 3.2, power=1.25, up=(0, 0.85, 0.53))
    note_c = V(*note.location)
    if not LAPTOP:
      shot("Cam_5A", 91, 150,
         [(91, note_c + V(0.05, -0.20, 0.17)), (150, note_c + V(-0.06, -0.26, 0.20))],
         [(91, note_c + V(0.0, 0.0, 0)), (150, err + (note_c - err) * 0.5)],
         [(91, 62.0), (150, 55.0)], 3.0,
         focus_keys=[(91, note_c), (150, note_c + (err - note_c) * 0.3)])

for ob in scn.objects:
    if ob.type in {"MESH", "CURVE"}:
        ob.cycles.use_motion_blur = False
fl.save_blend(OUT)
print("SAVED", OUT)
