"""Shared production library for Pinehollow clubhouse / pro-shop props.

Every asset script imports this and composes its geometry from the documented
helpers, so all assets share one high-quality material set, texture pipeline,
collision + export convention, and an auto-framed studio render.

Typical asset script:

    import sys; sys.path.insert(0, "tools/blender")
    import lib_props as L

    def build(M):
        root = L.asset_root("cart", (0.9, 0.5, 0.9))
        L.box("Body", (0.8, 0.4, 0.1), (0, 0, 0.5), M["steel"], parent=root)
        ...
        L.collision_box("COL", (0.9, 0.5, 0.9), (0, 0, 0.45), M, parent=root)
        return root

    L.run("cart", build)          # handles reset/materials/join/export/render

Run:  "<blender>" --background --factory-startup --python tools/blender/build_cart.py -- render
Convention:  X width, Y depth (-Y = front/player side), Z up, metres, base on Z=0.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector, Matrix

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
BUILD_VERSION = 1


# ============================================================ scene / images =====

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.length_unit = "METERS"


def _img(name, w, h):
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    return bpy.data.images.new(name, width=w, height=h, alpha=False)


def _write(img, rgba):
    img.colorspace_settings.name = "sRGB"
    img.pixels[:] = rgba.ravel().tolist()   # slice-assign: the only method that sticks headless
    img.update()
    img.pack()


def lin2srgb(c):
    """Encode a linear albedo field to sRGB.  _write tags images sRGB, so a texture
    must be authored in linear then encoded here or the render decodes it ~10x too dark."""
    import numpy as np
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055).astype("float32")


def _vnoise(rng, w, h, nx, ny):
    import numpy as np
    g = rng.random((ny + 1, nx + 1)).astype("float32")
    yy = np.linspace(0, ny, h, endpoint=False)
    xx = np.linspace(0, nx, w, endpoint=False)
    y0 = np.floor(yy).astype(int)
    x0 = np.floor(xx).astype(int)
    fy = (yy - y0)[:, None].astype("float32")
    fx = (xx - x0)[None, :].astype("float32")
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    return (g[y0][:, x0] * (1 - fx) + g[y0][:, x0 + 1] * fx) * (1 - fy) + \
           (g[y0 + 1][:, x0] * (1 - fx) + g[y0 + 1][:, x0 + 1] * fx) * fy


def _fbm(rng, w, h, cx, cy, octaves=5, gain=0.55):
    """Fractal (multi-octave) value noise — natural fine grain instead of blocky blobs."""
    import numpy as np
    out = np.zeros((h, w), "float32")
    amp, total = 1.0, 0.0
    ax, ay = float(cx), float(cy)
    for _ in range(octaves):
        out = out + amp * _vnoise(rng, w, h, max(1, int(round(ax))), max(1, int(round(ay))))
        total += amp
        amp *= gain
        ax *= 2.0
        ay *= 2.0
    return out / total


def wood_image(name, tone="walnut", w=1024, h=512):
    """Realistic timber: soft parallel growth-ring bands (gently undulating, never a
    zigzag moire) + fine pore streaks along the grain.  Grain runs along U.  Authored
    in linear then sRGB-encoded so it renders as warm medium wood, not near-black."""
    import numpy as np
    rng = np.random.default_rng(11 if tone == "walnut" else 23)
    img = _img(name, w, h)
    V = np.linspace(0, 1, h, dtype="float32")[:, None] * np.ones((1, w), "float32")
    # gentle, long-wavelength undulation of the ring lines (small amplitude => no moire)
    warp = (_vnoise(rng, w, h, 6, 2) - 0.5) * 0.11 + (_vnoise(rng, w, h, 14, 3) - 0.5) * 0.045
    rings = V * 8.5 + warp
    grain = (0.5 - 0.5 * np.cos(rings * 2 * np.pi)) ** 1.9          # soft, subtle thin lines
    # broad heartwood streaks along the grain (figure) + fine pore streaks
    heart = np.clip(0.5 + (_vnoise(rng, w, h, 3, 55) - 0.5) * 2.0, 0.0, 1.0)
    pore = (_vnoise(rng, w, h, 9, 240) - 0.5) * 1.25 + (_vnoise(rng, w, h, 4, 110) - 0.5) * 0.7
    pore = np.clip(0.5 + pore, 0.0, 1.0)
    drift = _vnoise(rng, w, h, 5, 2)[..., None]                     # broad tone drift
    if tone == "oak":
        base = np.array([0.238, 0.155, 0.085], "float32")
        dark = np.array([0.158, 0.100, 0.052], "float32")
        light = np.array([0.306, 0.212, 0.126], "float32")
    else:  # walnut — warm, rich medium brown (linear)
        base = np.array([0.162, 0.086, 0.041], "float32")
        dark = np.array([0.082, 0.041, 0.020], "float32")
        light = np.array([0.208, 0.120, 0.062], "float32")
    tonemix = base[None, None, :] * (1 - drift) + light[None, None, :] * drift
    col = tonemix * (1 - 0.22 * grain[..., None]) + dark[None, None, :] * (0.22 * grain[..., None])
    col = col * (1 - 0.06 * heart[..., None])                       # subtle heartwood figure
    col = np.clip(col * (0.93 + 0.10 * pore[..., None]), 0, 1)
    _write(img, np.concatenate([lin2srgb(col), np.ones((h, w, 1), "float32")], axis=2))
    return img


def metal_image(name="Gunmetal", w=256, h=256):
    """Subtle brushed gunmetal-charcoal."""
    import numpy as np
    img = _img(name, w, h)
    rng = np.random.default_rng(5)
    streak = np.repeat((rng.random((1, w)).astype("float32") - 0.5), h, axis=0) * 0.045
    mottle = (_vnoise(rng, w, h, 10, 10) - 0.5) * 0.05
    fine = (rng.random((h, w)).astype("float32") - 0.5) * 0.012
    val = np.clip(0.086 + streak + mottle + fine, 0.03, 0.22)[..., None]
    rgb = np.clip(val * np.array([0.90, 0.96, 1.08], "float32"), 0, 1)
    _write(img, np.concatenate([rgb, np.ones((h, w, 1), "float32")], axis=2))
    return img


def leather_image(name, rgb=(0.06, 0.16, 0.10), w=256, h=256):
    """Low-contrast pebbled leather in a given tone (green nameplate, cream, etc.)."""
    import numpy as np
    img = _img(name, w, h)
    rng = np.random.default_rng(9)
    base = np.array(rgb, "float32")
    peb = (_vnoise(rng, w, h, 60, 60) - 0.5) * 0.10
    fine = (rng.random((h, w)).astype("float32") - 0.5) * 0.03
    val = np.clip(1.0 + peb + fine, 0.6, 1.35)[..., None]
    _write(img, np.concatenate([np.clip(base * val, 0, 1), np.ones((h, w, 1), "float32")], axis=2))
    return img


def slat_image(name="Slatwall", w=64, h=256):
    """A cream slatwall cell: horizontal groove lines on a warm off-white board."""
    import numpy as np
    img = _img(name, w, h)
    base = np.array([0.80, 0.75, 0.63], "float32")
    groove = np.array([0.52, 0.47, 0.38], "float32")
    y = np.linspace(0, 1, h)[:, None]
    g = np.clip(1.0 - abs(((y * 6) % 1.0) - 0.5) * 9.0, 0.0, 1.0)   # a groove near each band edge
    g = (g ** 3)[..., None].astype("float32")
    rng = np.random.default_rng(1)
    n = (rng.random((h, w)).astype("float32") - 0.5)[..., None] * 0.03
    rgb = np.clip(base * (1 - g) + groove * g + n, 0, 1)
    _write(img, np.concatenate([rgb, np.ones((h, w, 1), "float32")], axis=2))
    return img


def granite_image(name="Granite", w=512, h=512):
    """Dark honed granite: charcoal base with fine mineral speckle."""
    import numpy as np
    img = _img(name, w, h)
    rng = np.random.default_rng(4)
    base = np.array([0.055, 0.058, 0.063], "float32")
    broad = (_vnoise(rng, w, h, 8, 8) - 0.5) * 0.04
    spq = rng.random((h, w)).astype("float32")
    speck = np.where(spq > 0.985, 0.22, 0.0) + np.where(spq < 0.02, -0.02, 0.0)
    val = np.clip(1.0 + broad + speck, 0.6, 4.0)[..., None]
    rgb = np.clip(base * val, 0, 1)
    _write(img, np.concatenate([rgb, np.ones((h, w, 1), "float32")], axis=2))
    return img


# ==================================================================== materials ===

def mat(name, color, *, roughness=0.6, metallic=0.0, alpha=1.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    c = (*color[:3], alpha)
    m.diffuse_color = c
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = c
    b.inputs["Roughness"].default_value = roughness
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Alpha"].default_value = alpha
    if alpha < 1.0:
        try:
            b.inputs["Transmission Weight"].default_value = 0.9
        except Exception:
            pass
        if hasattr(m, "surface_render_method"):
            m.surface_render_method = "BLENDED"
        m.use_backface_culling = False
    return m


def mat_tex(name, image, *, roughness=0.5, metallic=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    b.inputs["Roughness"].default_value = roughness
    b.inputs["Metallic"].default_value = metallic
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.extension = "REPEAT"
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    return m


def materials():
    return {
        "walnut": mat_tex("M_Walnut", wood_image("WalnutGrain", "walnut"), roughness=0.44),
        "oak": mat_tex("M_Oak", wood_image("OakGrain", "oak"), roughness=0.46),
        "walnut_dk": mat("M_WalnutDk", (0.092, 0.048, 0.026), roughness=0.5),
        "steel": mat_tex("M_Steel", metal_image(), roughness=0.40, metallic=0.62),
        "black": mat("M_Black", (0.030, 0.032, 0.036), roughness=0.45, metallic=0.35),
        "bolt": mat("M_Bolt", (0.120, 0.130, 0.146), roughness=0.28, metallic=0.85),
        "brass": mat("M_Brass", (0.620, 0.450, 0.170), roughness=0.26, metallic=0.92),
        "brass_dk": mat("M_BrassDk", (0.42, 0.30, 0.11), roughness=0.34, metallic=0.9),
        "cream": mat("M_Cream", (0.80, 0.75, 0.63), roughness=0.6),
        "slat": mat_tex("M_Slatwall", slat_image(), roughness=0.62),
        "green": mat_tex("M_Green", leather_image("GreenLeather", (0.055, 0.150, 0.098)), roughness=0.5),
        "green_felt": mat("M_GreenFelt", (0.045, 0.130, 0.085), roughness=0.85),
        "olive": mat("M_Olive", (0.112, 0.148, 0.068), roughness=0.55, metallic=0.0),
        "granite": mat_tex("M_Granite", granite_image(), roughness=0.32),
        "acrylic": mat("M_Acrylic", (0.85, 0.92, 0.95), roughness=0.06, alpha=0.22),
        "rubber": mat("M_Rubber", (0.028, 0.030, 0.034), roughness=0.85),
        "gold": mat("M_Gold", (0.74, 0.58, 0.24), roughness=0.22, metallic=0.95),
        # authoring/validator aid only — fully transparent so it never renders as
        # a solid box in a raw GLB viewer (in-game it is also hidden by COL_ name)
        "collision": mat("M_Collision", (1.0, 0.0, 1.0), roughness=1.0, alpha=0.0),
    }


# ===================================================================== helpers ====

def activate(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def _finish(obj, material, *, bevel=0.0, uv=True, smooth=38):
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel > 0:
        md = obj.modifiers.new("bev", "BEVEL")
        md.width = bevel
        md.segments = 2
        md.limit_method = "ANGLE"
        md.angle_limit = math.radians(38)
        activate(obj)
        bpy.ops.object.modifier_apply(modifier=md.name)
    if material:
        obj.data.materials.clear()
        obj.data.materials.append(material)
    if uv and obj.data.polygons:
        activate(obj)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")
    activate(obj)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(smooth))
    except Exception:
        pass
    return obj


def parent_keep(obj, parent):
    if parent is None:
        return obj
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_parent_inverse = parent.matrix_world.inverted()
    obj.matrix_world = world
    bpy.context.view_layer.update()
    return obj


def empty(name, loc=(0, 0, 0), *, parent=None, props=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.empty_display_size = 0.1
    parent_keep(o, parent)
    for k, v in (props or {}).items():
        o[k] = v
    return o


def asset_root(asset_id, dims):
    return empty(asset_id, props={
        "asset_id": asset_id, "asset_version": BUILD_VERSION, "units": "meters",
        "front": "-Y (player side)", "target_dimensions_m": list(dims),
        "source": "Original Pinehollow Golf asset generated in-repository",
        "license": "Project-owned / UNLICENSED",
    })


def box(name, dims, loc, material, *, rot=(0, 0, 0), bevel=0.004, parent=None, props=None, uv=True):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.dimensions = dims
    activate(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.rotation_euler = rot
    o.location = loc
    _finish(o, material, bevel=(min(bevel, min(dims) * 0.24) if bevel else 0.0), uv=uv)
    parent_keep(o, parent)
    for k, v in (props or {}).items():
        o[k] = v
    return o


def cyl(name, radius, depth, loc, material, *, rot=(0, 0, 0), verts=18, parent=None, bevel=None, uv=False):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    _finish(o, material, bevel=(bevel if bevel is not None else min(0.0015, radius * 0.3)), uv=uv)
    parent_keep(o, parent)
    return o


def sphere(name, radius, loc, material, *, parent=None, segs=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=max(6, segs // 2), radius=radius, location=loc)
    o = bpy.context.active_object
    o.name = name
    _finish(o, material, uv=False)
    parent_keep(o, parent)
    return o


def torus(name, R, r, loc, material, *, rot=(0, 0, 0), parent=None, mj=20, mn=10):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=mj, minor_segments=mn, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    _finish(o, material, uv=False)
    parent_keep(o, parent)
    return o


def frustum(name, r1, r2, depth, loc, material, *, segments=4, rot=(0, 0, 0), parent=None, uv=False, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=r1, radius2=r2, depth=depth)
    if segments == 4:
        bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.radians(45), 3, "Z"))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = rot
    if uv or bevel > 0:
        _finish(o, material, bevel=bevel, uv=uv)
    else:
        me.materials.append(material)
    parent_keep(o, parent)
    return o


def rounded_box(name, dims, loc, material, *, corner=0.03, parent=None, segments=6, bevel=0.004, uv=True, rot=(0, 0, 0)):
    """A rounded-rectangle prism — the four vertical edges rounded by `corner`.
    Set corner = min(w,d)/2 for a stadium/racetrack (oval) footprint."""
    w, d, h = dims
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= w
        v.co.y *= d
        v.co.z *= h
    bm.normal_update()
    c = min(corner, min(w, d) * 0.499)
    if c > 0:
        vedges = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > h * 0.4]
        bmesh.ops.bevel(bm, geom=vedges, offset=c, segments=segments, profile=0.5, affect="EDGES")
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.rotation_euler = rot
    o.location = loc
    _finish(o, material, bevel=bevel, uv=uv)
    parent_keep(o, parent)
    return o


def wood_slab(name, dims, loc, material, *, parent=None, bevel=0.006, grain="x"):
    """A wood plank whose grain runs along its length, mapped once (no repeat)."""
    w, d, h = dims
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= w
        v.co.y *= d
        v.co.z *= h
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        n = f.normal
        for lp in f.loops:
            c = lp.vert.co
            if abs(n.z) > 0.5:
                lp[uv].uv = (c.x / w + 0.5, c.y / d + 0.5) if grain == "x" else (c.y / d + 0.5, c.x / w + 0.5)
            elif abs(n.y) > 0.5:
                lp[uv].uv = (c.x / w + 0.5, (c.z / h + 0.5) * 2.5)
            else:
                lp[uv].uv = (c.y / d + 0.5, (c.z / h + 0.5) * 2.5)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.location = loc
    me.materials.append(material)
    if bevel > 0:
        activate(o)
        md = o.modifiers.new("bev", "BEVEL")
        md.width = min(bevel, min(dims) * 0.24)
        md.segments = 2
        md.limit_method = "ANGLE"
        md.angle_limit = math.radians(38)
        activate(o)
        bpy.ops.object.modifier_apply(modifier=md.name)
    try:
        activate(o)
        bpy.ops.object.shade_auto_smooth(angle=math.radians(38))
    except Exception:
        pass
    parent_keep(o, parent)
    return o


def collision_box(name, dims, loc, M, *, parent=None):
    o = box(name, dims, loc, M["collision"], bevel=0.0, parent=parent, uv=False,
            props={"collision_proxy": True, "shape": "box"})
    o.display_type = "WIRE"
    o.hide_render = True
    return o


def rivet(name, loc, M, parent, *, r=0.008, d=0.012, face="y"):
    rot = {"y": (math.radians(90), 0, 0), "x": (0, math.radians(90), 0), "z": (0, 0, 0)}[face]
    return cyl(name, r, d, loc, M["bolt"], rot=rot, parent=parent)


# ============================================================== sub-assemblies ====

def brass_bar_pull(name, cx, y, z, width, M, parent, *, r=0.008, stand=0.028):
    """A horizontal brass bar pull on two little stand-offs (faces -Y)."""
    cyl(f"{name}_bar", r, width, (cx, y - stand, z), M["brass"], rot=(0, math.radians(90), 0), parent=parent)
    for ex in (-1, 1):
        cyl(f"{name}_leg{ex}", r * 0.8, stand, (cx + ex * width / 2 * 0.86, y - stand / 2, z), M["brass"], rot=(math.radians(90), 0, 0), parent=parent)


def brass_cup_pull(name, cx, y, z, M, parent, *, w=0.09):
    """A brass cup/bin pull: two end mounts + a horizontal shell scoop proud of the face."""
    for ex in (-1, 1):
        box(f"{name}_end{ex}", (0.014, 0.022, 0.034), (cx + ex * w / 2, y - 0.003, z), M["brass"], bevel=0.003, parent=parent)
    cyl(f"{name}_cup", 0.016, w - 0.006, (cx, y - 0.014, z - 0.004), M["brass"], rot=(0, math.radians(90), 0), verts=18, parent=parent)


def finial(name, x, y, z, M, parent, *, r=0.018):
    sphere(f"{name}_ball", r, (x, y, z + r), M["brass"], parent=parent)


def corner_bracket(name, x, y, z, M, parent, *, s=0.05):
    """A little black corner cap plate with a brass rivet (decorative case corner)."""
    box(f"{name}_plate", (s, 0.010, s), (x, y - 0.005, z), M["black"], bevel=0.003, parent=parent)
    rivet(f"{name}_riv", (x, y - 0.012, z), M, parent, r=0.006)


def caster(name, x, y, floor_z, M, parent, *, wheel_r=0.05, brake=True):
    """A swivel caster: rubber tyre + hub, a gunmetal fork/leg, optional brass brake.
    Returns the top mount z so posts can sit on it."""
    cyl(f"{name}_tyre", wheel_r, 0.026, (x, y, floor_z + wheel_r), M["rubber"], rot=(0, math.radians(90), 0), parent=parent, verts=20)
    cyl(f"{name}_hub", wheel_r * 0.45, 0.030, (x, y, floor_z + wheel_r), M["olive"], rot=(0, math.radians(90), 0), parent=parent, verts=16)
    fork_z = floor_z + wheel_r * 2 + 0.02
    for ex in (-1, 1):
        box(f"{name}_fork{ex}", (0.010, 0.014, wheel_r * 1.5), (x + ex * 0.02, y, floor_z + wheel_r + 0.02), M["steel"], bevel=0.002, parent=parent)
    cyl(f"{name}_swivel", 0.016, 0.03, (x, y, fork_z + 0.014), M["steel"], parent=parent, verts=16)
    box(f"{name}_plate", (0.05, 0.05, 0.012), (x, y, fork_z + 0.03), M["steel"], bevel=0.003, parent=parent)
    if brake:
        box(f"{name}_brake", (0.018, 0.03, 0.010), (x, y - wheel_r - 0.01, floor_z + 0.03), M["brass"], bevel=0.003, parent=parent, rot=(math.radians(20), 0, 0))
    return fork_z + 0.036


def sign_panel(name, cx, cz, w, h, M, parent, *, y=0.0, arched=False, thick=0.02):
    """A deep-green nameplate with a brass border on a walnut/black backing."""
    box(f"{name}_back", (w, thick, h), (cx, y, cz), M["walnut"], bevel=0.004, parent=parent)
    box(f"{name}_face", (w - 0.05, thick * 0.5, h - 0.05), (cx, y - thick * 0.55, cz), M["green"], bevel=0.003, parent=parent)
    # brass inner border (four thin bars just proud of the green)
    yb = y - thick * 0.75
    for (bw, bh, bz) in [(w - 0.05, 0.008, cz + (h - 0.05) / 2 - 0.006), (w - 0.05, 0.008, cz - (h - 0.05) / 2 + 0.006)]:
        box(f"{name}_bh{bz:.2f}", (bw, 0.004, bh), (cx, yb, bz), M["brass"], bevel=0.0, parent=parent)
    for ex in (-1, 1):
        box(f"{name}_bv{ex}", (0.008, 0.004, h - 0.05), (cx + ex * (w - 0.05) / 2, yb, cz), M["brass"], bevel=0.0, parent=parent)
    if arched:
        pz = cz + (h - 0.05) / 2 + 0.03
        box(f"{name}_ped", (w - 0.10, thick, 0.085), (cx, y, pz), M["walnut"], bevel=0.042, parent=parent)
        box(f"{name}_pedG", (w - 0.19, thick * 0.5, 0.055), (cx, y - thick * 0.55, pz + 0.004), M["green"], bevel=0.026, parent=parent)


def cabinet_door(name, cx, cz, w, h, M, parent, *, y=0.0, pull="knob", thick=0.02, material=None):
    """A shaker cabinet door (rail/stile frame + recessed panel) with a brass pull."""
    material = material or M["walnut"]
    box(f"{name}_slab", (w, thick, h), (cx, y, cz), material, bevel=0.004, parent=parent)
    box(f"{name}_panel", (w - 0.09, thick * 0.5, h - 0.09), (cx, y + thick * 0.4, cz), material, bevel=0.006, parent=parent)
    if pull == "knob":
        cyl(f"{name}_knob", 0.012, 0.03, (cx + w / 2 - 0.05, y - thick, cz), M["brass"], rot=(math.radians(90), 0, 0), parent=parent, verts=14)
    elif pull == "cup":
        brass_cup_pull(f"{name}_pull", cx, y - thick / 2, cz, M, parent)
    else:
        brass_bar_pull(f"{name}_pull", cx + w / 2 - 0.05, y - thick / 2, cz, min(0.16, h * 0.55), M, parent)


def plinth(name, w, d, h, M, parent, *, cx=0.0, cy=0.0, toe="walnut"):
    """A base plinth: a slightly-inset toe box + a top cap lip."""
    toe_mat = M["black"] if toe == "black" else M["walnut"]
    box(f"{name}_toe", (w - 0.03, d - 0.03, h - 0.02), (cx, cy, h / 2 - 0.01), toe_mat, bevel=0.004, parent=parent)
    box(f"{name}_cap", (w, d, 0.02), (cx, cy, h - 0.01), M["walnut"], bevel=0.004, parent=parent)
    if toe == "black":
        for sx in (-1, 1):
            corner_bracket(f"{name}_cnr{sx}", sx * (w / 2 - 0.03), -d / 2 + 0.015, h / 2, M, parent, s=0.045)


def sign_text(name, text, cx, cz, height, M, parent, *, y=0.0, depth=0.006):
    """Extruded gold lettering for a nameplate (kept shallow, brass material)."""
    bpy.ops.object.text_add(location=(cx, y, cz))
    o = bpy.context.active_object
    o.name = name
    o.data.body = text
    o.data.align_x = "CENTER"
    o.data.align_y = "CENTER"
    o.data.size = height
    o.data.extrude = depth
    o.rotation_euler = (math.radians(90), 0, 0)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    o.data.materials.clear()
    o.data.materials.append(M["gold"])
    parent_keep(o, parent)
    return o


# ================================================================ join / export ===

def descendants(root):
    out = [root]
    stack = list(root.children)
    while stack:
        o = stack.pop(0)
        out.append(o)
        stack.extend(o.children)
    return out


def join_static(root):
    """Fuse all static visible meshes into one body; leave movable + collision alone."""
    bpy.ops.object.select_all(action="DESELECT")
    bodies = [o for o in descendants(root) if o.type == "MESH"
              and not o.get("collision_proxy") and not o.get("movable")]
    if len(bodies) < 2:
        return
    for o in bodies:
        o.select_set(True)
    target = bodies[0]
    target.name = f"{root.name}_body"
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()


def save_and_export(asset_id, root, *, subdir="clubhouse"):
    src_dir = ROOT / "asset_sources" / "blender" / subdir
    src_dir.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    blend_path = src_dir / f"{asset_id}.blend"
    glb_path = EXPORT_DIR / f"{asset_id}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.object.select_all(action="DESELECT")
    sel = descendants(root)
    for o in sel:
        o.hide_viewport = False
        o.hide_render = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path), export_format="GLB", use_selection=True,
        export_apply=True, export_yup=True, export_normals=True, export_texcoords=True,
        export_materials="EXPORT", export_extras=True, export_cameras=False, export_lights=False,
    )
    print(f"BUILT|{asset_id}|nodes={len(sel)}|glb={glb_path}")
    return glb_path


def _world_bounds(root):
    mins = [1e9, 1e9, 1e9]
    maxs = [-1e9, -1e9, -1e9]
    for o in descendants(root):
        if o.type != "MESH" or o.get("collision_proxy"):
            continue
        for corner in o.bound_box:
            w = o.matrix_world @ Vector(corner)
            for i in range(3):
                mins[i] = min(mins[i], w[i])
                maxs[i] = max(maxs[i], w[i])
    return mins, maxs


def render_preview(asset_id, root, *, open_drawers=False, azimuth=40, elevation=30):
    out = ROOT / "qa" / asset_id
    out.mkdir(parents=True, exist_ok=True)
    for o in bpy.data.objects:            # collision proxies must never appear in the preview
        if o.get("collision_proxy"):
            o.hide_render = True
    if open_drawers:
        for o in bpy.data.objects:
            if o.get("movable") == "drawer":
                o.location.y -= o.get("open_travel_m", 0.3) * 0.8
    mins, maxs = _world_bounds(root)
    C = Vector(((mins[0] + maxs[0]) / 2, (mins[1] + maxs[1]) / 2, (mins[2] + maxs[2]) / 2))
    S = max(maxs[i] - mins[i] for i in range(3))
    sc = bpy.context.scene
    box("PreviewFloor", (max(20, S * 8), max(20, S * 8), 0.04), (C.x, C.y, -0.02),
        mat("M_Floor", (0.58, 0.58, 0.60), roughness=0.9))
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.72, 0.72, 0.74, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.45
    sc.world = world

    def sun(name, energy, rot):
        d = bpy.data.lights.new(name, "SUN")
        d.energy = energy
        d.angle = math.radians(4)
        ob = bpy.data.objects.new(name, d)
        ob.rotation_euler = rot
        bpy.context.collection.objects.link(ob)
    sun("Key", 1.6, (math.radians(52), 0, math.radians(30)))
    sun("Fill", 0.6, (math.radians(58), 0, math.radians(-70)))
    sun("Rim", 1.0, (math.radians(120), 0, math.radians(190)))
    softd = bpy.data.lights.new("Soft", "AREA")
    softd.energy = 32 * S * S + 20
    softd.size = S * 2.2
    softob = bpy.data.objects.new("Soft", softd)
    az = math.radians(azimuth)
    softob.location = C + Vector((math.sin(az) * 0.4, -1.0, 0.7)) * (S * 1.6)
    softob.rotation_euler = (math.radians(55), 0, az)
    bpy.context.collection.objects.link(softob)

    az = math.radians(azimuth)
    el = math.radians(elevation)
    dist = S * 2.05 + 0.6
    cam_pos = C + Vector((math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el))) * dist
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 62
    cam = bpy.data.objects.new("Cam", cam_data)
    cam.location = cam_pos
    cam.rotation_euler = (C - cam_pos).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(cam)
    sc.camera = cam
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            sc.render.engine = eng
            break
        except Exception:
            continue
    try:
        sc.view_settings.view_transform = "AgX"
    except Exception:
        pass
    sc.render.resolution_x = 1200
    sc.render.resolution_y = 1200
    sc.render.filepath = str(out / ("preview_open.png" if open_drawers else "preview.png"))
    bpy.ops.render.render(write_still=True)
    print(f"RENDER|{sc.render.filepath}")


def run(asset_id, build_fn, *, subdir="clubhouse"):
    """One-call entry point: reset -> materials -> build -> join -> export -> render."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    reset_scene()
    M = materials()
    root = build_fn(M)
    if "nojoin" not in argv:
        join_static(root)
    save_and_export(asset_id, root, subdir=subdir)
    if "render" in argv:
        render_preview(asset_id, root, open_drawers=("open" in argv))
    print(f"COMPLETE|{asset_id}")
