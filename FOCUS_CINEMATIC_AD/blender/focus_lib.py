"""Shared Blender helpers for the FOCUS commercial (Blender 5.2, bpy module).

Everything is procedural: materials, Geometry Nodes particle system, camera
paths. Animation is stored as real keyframes / drivers / Geometry Nodes so the
saved .blend files render on their own (`blender -b file.blend -a`).
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

# --------------------------------------------------------------------- scene


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    scn.name = "FOCUS"
    if scn.world is None:
        scn.world = bpy.data.worlds.new("World")
    return scn


def setup_render(scn, res=(1920, 1080), samples=64, fps=24, frames=(1, 192),
                 motion_blur=True, out_dir="//renders/", threshold=0.05):
    r = scn.render
    r.engine = "CYCLES"
    r.resolution_x, r.resolution_y = res
    r.resolution_percentage = 100
    r.fps = fps
    scn.frame_start, scn.frame_end = frames
    c = scn.cycles
    c.device = "CPU"
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = threshold
    c.use_denoising = True
    c.denoiser = "OPENIMAGEDENOISE"
    c.denoising_input_passes = "RGB_ALBEDO_NORMAL"
    c.max_bounces = 4
    c.diffuse_bounces = 2
    c.glossy_bounces = 2
    c.transmission_bounces = 2
    c.volume_bounces = 0
    c.transparent_max_bounces = 10
    c.sample_clamp_indirect = 4.0
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.blur_glossy = 1.0
    r.use_motion_blur = motion_blur
    r.motion_blur_shutter = 0.45
    r.film_transparent = False
    r.use_persistent_data = True
    r.use_overwrite = False          # resume-friendly: skip frames already on disk
    r.use_placeholder = True
    ims = r.image_settings
    ims.media_type = "IMAGE"
    ims.file_format = "OPEN_EXR"
    ims.color_depth = "16"
    ims.exr_codec = "DWAA"
    ims.color_mode = "RGB"
    r.filepath = out_dir
    scn.view_settings.view_transform = "Standard"
    scn.view_settings.look = "None"


def add_frame_driver(socket_owner, data_path="default_value", expr="frame"):
    fc = socket_owner.driver_add(data_path)
    fc.driver.type = "SCRIPTED"
    fc.driver.expression = expr
    return fc


def frame_value_node(nt, location=(-1200, 0)):
    n = nt.nodes.new("ShaderNodeValue")
    n.label = "frame"
    n.location = location
    add_frame_driver(n.outputs[0])
    return n


def key(obj, path, frame, value, index=-1, interp="BEZIER"):
    """Set + keyframe a property, returns the keyframe points' fcurve owner."""
    if index >= 0:
        getattr(obj, path)[index] = value
    else:
        setattr(obj, path, value)
    obj.keyframe_insert(data_path=path, frame=frame, index=index)
    ad = obj.animation_data
    if ad and ad.action:
        for fc in _fcurves(ad.action):
            if fc.data_path == path:
                for kp in fc.keyframe_points:
                    if abs(kp.co[0] - frame) < 1e-3:
                        kp.interpolation = interp


def _fcurves(action):
    """Blender 5.x layered actions: iterate every fcurve of every channelbag."""
    out = []
    if hasattr(action, "layers"):
        for layer in action.layers:
            for strip in layer.strips:
                for cb in getattr(strip, "channelbags", []):
                    out.extend(cb.fcurves)
    if hasattr(action, "fcurves"):
        try:
            out.extend(action.fcurves)
        except Exception:
            pass
    return out


def set_linear(obj):
    ad = obj.animation_data
    if ad and ad.action:
        for fc in _fcurves(ad.action):
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"


def key_prop(obj, prop, frames_values, interp="BEZIER"):
    """Keyframe a custom property obj[prop] at several frames."""
    for f, v in frames_values:
        obj[prop] = v
        obj.keyframe_insert(data_path=f'["{prop}"]', frame=f)
    ad = obj.animation_data
    if ad and ad.action:
        for fc in _fcurves(ad.action):
            if fc.data_path == f'["{prop}"]':
                for kp in fc.keyframe_points:
                    kp.interpolation = interp


def key_socket(sock, frames_values, interp="BEZIER"):
    for f, v in frames_values:
        sock.default_value = v
        sock.keyframe_insert("default_value", frame=f)


# ------------------------------------------------------------------ materials


def new_mat(name):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)
    return m, nt, out


def link(nt, a, b):
    nt.links.new(a, b)


def math_node(nt, op, a=None, b=None, loc=(0, 0), clamp=False):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    n.location = loc
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n


def map_range(nt, value, fmin, fmax, tmin=0.0, tmax=1.0, loc=(0, 0), interp="SMOOTHSTEP"):
    n = nt.nodes.new("ShaderNodeMapRange")
    n.interpolation_type = interp
    n.clamp = True
    n.location = loc
    for sock, v in (("From Min", fmin), ("From Max", fmax), ("To Min", tmin), ("To Max", tmax)):
        if isinstance(v, (int, float)):
            n.inputs[sock].default_value = v
        else:
            nt.links.new(v, n.inputs[sock])
    nt.links.new(value, n.inputs["Value"])
    return n


def emission_mat(name, color, strength, prop=None):
    """Emission material; strength optionally multiplied by object prop `prop`."""
    m, nt, out = new_mat(name)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*color, 1)
    em.inputs["Strength"].default_value = strength
    if prop:
        at = nt.nodes.new("ShaderNodeAttribute")
        at.attribute_type = "OBJECT"
        at.attribute_name = prop
        mul = math_node(nt, "MULTIPLY", at.outputs["Fac"], strength, loc=(-200, -100))
        link(nt, mul.outputs[0], em.inputs["Strength"])
    link(nt, em.outputs[0], out.inputs["Surface"])
    return m


def point_mat(name, strength=8.0, prop=None, tint=(1, 1, 1), near_fade=None):
    """Emission for GN point clouds: colour from 'col', intensity from 'glow'."""
    m, nt, out = new_mat(name)
    col = nt.nodes.new("ShaderNodeAttribute")
    col.attribute_name = "col"
    col.location = (-600, 100)
    glow = nt.nodes.new("ShaderNodeAttribute")
    glow.attribute_name = "glow"
    glow.location = (-600, -150)
    s = math_node(nt, "MULTIPLY", glow.outputs["Fac"], strength, loc=(-350, -150))
    if prop:
        at = nt.nodes.new("ShaderNodeAttribute")
        at.attribute_type = "OBJECT"
        at.attribute_name = prop
        at.location = (-600, -350)
        s = math_node(nt, "MULTIPLY", s.outputs[0], at.outputs["Fac"], loc=(-200, -250))
    tintn = nt.nodes.new("ShaderNodeMix")
    tintn.data_type = "RGBA"
    tintn.blend_type = "MULTIPLY"
    tintn.inputs["Factor"].default_value = 1.0
    link(nt, col.outputs["Color"], tintn.inputs[6])
    tintn.inputs[7].default_value = (*tint, 1)
    if near_fade:
        # fade points that get very close to the lens (avoids giant bokeh discs)
        camd = nt.nodes.new("ShaderNodeCameraData")
        nf = map_range(nt, camd.outputs["View Distance"], near_fade[0], near_fade[1], loc=(-350, -450))
        s = math_node(nt, "MULTIPLY", s.outputs[0], nf.outputs[0], loc=(-150, -350))
    em = nt.nodes.new("ShaderNodeEmission")
    link(nt, tintn.outputs[2], em.inputs["Color"])
    link(nt, s.outputs[0], em.inputs["Strength"])
    link(nt, em.outputs[0], out.inputs["Surface"])
    return m


# ------------------------------------------------------- GN particle system

FLOW_ATTRS = {
    # name: (domain data type, numpy columns)
    "start": ("FLOAT_VECTOR", 3),
    "p1": ("FLOAT_VECTOR", 3),
    "p2": ("FLOAT_VECTOR", 3),
    "target": ("FLOAT_VECTOR", 3),
    "hover": ("FLOAT_VECTOR", 3),
    "t_rel": ("FLOAT", 1),
    "t_move": ("FLOAT", 1),
    "dur": ("FLOAT", 1),
    "life": ("FLOAT", 1),
    "rad": ("FLOAT", 1),
    "amp": ("FLOAT", 1),
    "drift": ("FLOAT", 1),
    "col": ("FLOAT_COLOR", 4),
}


def flow_points_object(name, data, material, collection=None):
    """Create a vertex-only mesh carrying FLOW_ATTRS + the FlowPoints GN modifier.

    data: dict of numpy arrays keyed by FLOW_ATTRS names (N rows)."""
    n = len(data["start"])
    me = bpy.data.meshes.new(name)
    me.vertices.add(n)
    me.vertices.foreach_set("co", data["start"].astype(np.float32).ravel())
    for k, (dt, cols) in FLOW_ATTRS.items():
        arr = data.get(k)
        if arr is None:
            continue
        a = me.attributes.new(k, dt, "POINT")
        flat = np.asarray(arr, np.float32).reshape(n, -1)
        if dt == "FLOAT":
            a.data.foreach_set("value", flat[:, 0])
        elif dt == "FLOAT_VECTOR":
            a.data.foreach_set("vector", flat.ravel())
        else:
            a.data.foreach_set("color", flat.ravel())
    me.update()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    mod = ob.modifiers.new("FlowPoints", "NODES")
    # One group copy per material: a Material *input* on the modifier deadlocks
    # Blender 5.2 when running headless (gizmo inference locks the RNA mutex).
    base = flow_points_group()
    ng = base.copy()
    ng.name = f"FlowPoints_{material.name}"
    for nd in ng.nodes:
        if nd.bl_idname == "GeometryNodeSetMaterial":
            nd.inputs["Material"].default_value = material
    mod.node_group = ng
    return ob


def set_modifier_input(mod, name, value):
    """Blender 5.x: GN modifier inputs live in mod.properties.inputs[identifier]."""
    for it in mod.node_group.interface.items_tree:
        if getattr(it, "in_out", None) == "INPUT" and it.name == name:
            mod.properties.inputs[it.identifier] = value
            return
    raise KeyError(name)


def _sock(node, name, kind):
    for s in node.inputs:
        if s.name == name and s.type == kind and s.enabled:
            return s
    for s in node.inputs:
        if s.name == name and s.type == kind:
            return s
    raise KeyError((node.bl_idname, name, kind))


def flow_points_group():
    ng = bpy.data.node_groups.get("FlowPoints")
    if ng:
        return ng
    ng = bpy.data.node_groups.new("FlowPoints", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    N = ng.nodes
    L = ng.links
    gin = N.new("NodeGroupInput")
    gout = N.new("NodeGroupOutput")
    gin.location = (-2200, 0)
    gout.location = (1400, 0)

    def attr(name, dt):
        a = N.new("GeometryNodeInputNamedAttribute")
        a.data_type = dt
        a.inputs["Name"].default_value = name
        return a.outputs["Attribute"]

    def m(op, a, b=None, clamp=False):
        n = N.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L.new(v, n.inputs[i])
        return n.outputs[0]

    def vm(op, a, b=None, scale=None):
        n = N.new("ShaderNodeVectorMath")
        n.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (tuple, list)):
                n.inputs[i].default_value = v
            else:
                L.new(v, n.inputs[i])
        if scale is not None:
            if isinstance(scale, (int, float)):
                n.inputs["Scale"].default_value = scale
            else:
                L.new(scale, n.inputs["Scale"])
        return n.outputs["Vector"] if op != "DOT_PRODUCT" and op != "LENGTH" else n.outputs["Value"]

    def mixv(fac, a, b):
        n = N.new("ShaderNodeMix")
        n.data_type = "VECTOR"
        L.new(fac, _sock(n, "Factor", "VALUE"))
        L.new(a, _sock(n, "A", "VECTOR"))
        L.new(b, _sock(n, "B", "VECTOR"))
        return n.outputs["Result_Vector"] if "Result_Vector" in n.outputs else n.outputs[1]

    time = N.new("GeometryNodeInputSceneTime").outputs["Frame"]
    start = attr("start", "FLOAT_VECTOR")
    p1 = attr("p1", "FLOAT_VECTOR")
    p2 = attr("p2", "FLOAT_VECTOR")
    tgt = attr("target", "FLOAT_VECTOR")
    hover = attr("hover", "FLOAT_VECTOR")
    t_rel = attr("t_rel", "FLOAT")
    t_move = attr("t_move", "FLOAT")
    dur = attr("dur", "FLOAT")
    life = attr("life", "FLOAT")
    rad = attr("rad", "FLOAT")
    amp = attr("amp", "FLOAT")
    drift = attr("drift", "FLOAT")

    # visibility ramp (3 frames)
    since_rel = m("SUBTRACT", time, t_rel)
    vis = m("DIVIDE", since_rel, 3.0)
    vis = m("MINIMUM", m("MAXIMUM", vis, 0.0), 1.0)
    # hover ramp (24 frames, smooth)
    hv = m("MINIMUM", m("MAXIMUM", m("DIVIDE", since_rel, 24.0), 0.0), 1.0)
    hv = m("MULTIPLY", hv, m("MULTIPLY", hv, m("SUBTRACT", 3.0, m("MULTIPLY", hv, 2.0))))
    # travel parameter with smootherstep
    tau = m("DIVIDE", m("SUBTRACT", time, t_move), m("MAXIMUM", dur, 0.001))
    tau = m("MINIMUM", m("MAXIMUM", tau, 0.0), 1.0)
    t6 = m("SUBTRACT", m("MULTIPLY", tau, 6.0), 15.0)
    te = m("MULTIPLY", m("MULTIPLY", m("MULTIPLY", tau, tau), tau),
           m("ADD", m("MULTIPLY", tau, t6), 10.0))
    # de Casteljau cubic bezier
    a = mixv(te, start, p1)
    b = mixv(te, p1, p2)
    c = mixv(te, p2, tgt)
    d = mixv(te, a, b)
    e = mixv(te, b, c)
    pos = mixv(te, d, e)
    # hover offset fades out during travel
    inv_te = m("SUBTRACT", 1.0, te)
    pos = vm("ADD", pos, vm("SCALE", hover, scale=m("MULTIPLY", hv, inv_te)))
    # turbulence: 4D noise, amplitude grows mid-flight
    noise = N.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "4D"
    noise.inputs["Scale"].default_value = 6.0
    noise.inputs["Detail"].default_value = 1.0
    L.new(start, noise.inputs["Vector"])
    L.new(m("MULTIPLY", time, 0.012), noise.inputs["W"])
    nv = vm("SUBTRACT", noise.outputs["Color"], (0.5, 0.5, 0.5))
    sinp = m("SINE", m("MULTIPLY", te, math.pi))
    turb_amt = m("ADD", m("MULTIPLY", amp, sinp), drift)
    turb_amt = m("MULTIPLY", turb_amt, vis)
    pos = vm("ADD", pos, vm("SCALE", nv, scale=turb_amt))
    # life fade
    lf = m("SUBTRACT", 1.0, m("DIVIDE", since_rel, m("MAXIMUM", life, 0.001)))
    lf = m("MINIMUM", m("MAXIMUM", lf, 0.0), 1.0)
    radius = m("MULTIPLY", m("MULTIPLY", rad, vis), lf)
    # release flash -> glow attribute
    flash = m("EXPONENT", m("DIVIDE", m("MULTIPLY", m("MAXIMUM", since_rel, 0.0), -1.0), 5.0))
    glow = m("MULTIPLY", m("ADD", 1.0, m("MULTIPLY", flash, 1.5)), m("MULTIPLY", vis, lf))

    m2p = N.new("GeometryNodeMeshToPoints")
    L.new(gin.outputs["Geometry"], m2p.inputs["Mesh"])
    L.new(pos, m2p.inputs["Position"])
    L.new(radius, m2p.inputs["Radius"])
    # hide zero-radius points entirely
    sel = m("GREATER_THAN", radius, 1e-6)
    L.new(sel, m2p.inputs["Selection"])
    store = N.new("GeometryNodeStoreNamedAttribute")
    store.data_type = "FLOAT"
    store.domain = "POINT"
    store.inputs["Name"].default_value = "glow"
    L.new(m2p.outputs["Points"], store.inputs["Geometry"])
    L.new(glow, _sock(store, "Value", "VALUE"))
    setm = N.new("GeometryNodeSetMaterial")
    L.new(store.outputs["Geometry"], setm.inputs["Geometry"])
    L.new(setm.outputs["Geometry"], gout.inputs["Geometry"])
    return ng


# ------------------------------------------------------------------- geometry


def icosphere(name, radius, subdiv=3, mat=None, loc=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    if mat:
        me.materials.append(mat)
    return ob


def poly_curve(name, pts, bevel, mat=None, cyclic=False, res=2):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = bevel
    cu.bevel_resolution = res
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, co in zip(sp.points, pts):
        p.co = (co[0], co[1], co[2], 1.0)
    sp.use_cyclic_u = cyclic
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    if mat:
        cu.materials.append(mat)
    return ob


def arc_points(a, b, bulge, n=48, normal=(0, 0, 1)):
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    mid = (a + b) / 2
    d = b - a
    nrm = np.cross(d, np.asarray(normal, float))
    if np.linalg.norm(nrm) < 1e-9:
        nrm = np.cross(d, (1, 0, 0))
    nrm = nrm / np.linalg.norm(nrm)
    ctrl = mid + nrm * bulge * np.linalg.norm(d)
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * a + 2 * (1 - t) * t * ctrl + t ** 2 * b


# --------------------------------------------------------------------- camera


def look_rotation(pos, target, up_hint=(0, 0.85, 0.53), compat=None):
    f = Vector(target) - Vector(pos)
    f.normalize()
    up = Vector(up_hint).normalized()
    r = f.cross(up)
    if r.length < 1e-6:
        r = f.cross(Vector((0, 1, 0)))
    r.normalize()
    u = r.cross(f)
    # camera looks down -Z, +Y is up, +X right
    m = Matrix(((r.x, u.x, -f.x), (r.y, u.y, -f.y), (r.z, u.z, -f.z)))
    return m.to_euler("XYZ", compat) if compat is not None else m.to_euler()


def catmull(keys, frames):
    """keys: list of (frame, np.array). Smooth centripetal-ish Catmull-Rom with
    eased time between keys (cinematic ease in/out on first & last key)."""
    kf = np.array([k[0] for k in keys], float)
    kv = np.array([k[1] for k in keys], float)
    out = []
    for f in frames:
        i = int(np.clip(np.searchsorted(kf, f) - 1, 0, len(kf) - 2))
        t = (f - kf[i]) / (kf[i + 1] - kf[i])
        t = min(max(t, 0.0), 1.0)
        p0 = kv[max(i - 1, 0)]
        p1 = kv[i]
        p2 = kv[i + 1]
        p3 = kv[min(i + 2, len(kv) - 1)]
        if i == 0:
            p0 = p1 - (p2 - p1)
        if i + 2 > len(kv) - 1:
            p3 = p2 + (p2 - p1)
        t2, t3 = t * t, t * t * t
        v = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
        out.append(v)
    return np.array(out)


def ease_frames(frames, f0, f1, power=2.2):
    """Remap frame numbers for a global ease-in-out between f0 and f1."""
    out = []
    for f in frames:
        u = (f - f0) / (f1 - f0)
        u = min(max(u, 0.0), 1.0)
        e = u ** power / (u ** power + (1 - u) ** power)
        out.append(f0 + e * (f1 - f0))
    return out


def animate_camera(cam, frames, positions, targets, lenses, focus, fstops=None, up_hint=(0, 0.85, 0.53)):
    prev = None
    for i, f in enumerate(frames):
        cam.location = Vector(positions[i])
        prev = look_rotation(positions[i], targets[i], up_hint, prev)
        cam.rotation_euler = prev
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_euler", frame=f)
        cam.data.lens = float(lenses[i])
        cam.data.keyframe_insert("lens", frame=f)
        cam.data.dof.focus_distance = float(focus[i])
        cam.data.dof.keyframe_insert("focus_distance", frame=f)
        if fstops is not None:
            cam.data.dof.aperture_fstop = float(fstops[i])
            cam.data.dof.keyframe_insert("aperture_fstop", frame=f)
    set_linear(cam)
    set_linear(cam.data)


def save_blend(path):
    """Save without the OpenGL thumbnail (it deadlocks on GPU-less machines)."""
    try:
        bpy.context.preferences.filepaths.file_preview_type = "NONE"
    except Exception:
        pass
    bpy.ops.wm.save_as_mainfile(filepath=path, relative_remap=True, compress=True)


# ----------------------------------------------------------------- text / shots


def text_obj(name, body, font_path, size, mat, loc, face_to=None, up=(0, 0, 1), align="CENTER", tracking=1.0):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.font = bpy.data.fonts.load(font_path, check_existing=True)
    cu.size = size
    cu.align_x = align
    cu.align_y = "CENTER"
    cu.space_character = tracking
    cu.materials.append(mat)
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    if face_to is not None:
        # text is readable from +Z: point local -Z away from the viewer
        p = np.asarray(loc, float)
        away = 2 * p - np.asarray(face_to, float)
        ob.rotation_euler = look_rotation(tuple(p), tuple(away), up)
    return ob


def shot_camera(scn, name, frame_start, frames, positions, targets, lenses, focus, fstops=None, up_hint=(0, 0, 1)):
    cd = bpy.data.cameras.new(name)
    cd.sensor_width = 36.0
    cd.dof.use_dof = True
    cd.dof.aperture_blades = 9
    cd.clip_start = 0.002
    cd.clip_end = 60
    cam = bpy.data.objects.new(name, cd)
    scn.collection.objects.link(cam)
    animate_camera(cam, frames, positions, targets, lenses, focus, fstops, up_hint)
    mk = scn.timeline_markers.new(name, frame=frame_start)
    mk.camera = cam
    if scn.camera is None:
        scn.camera = cam
    return cam
