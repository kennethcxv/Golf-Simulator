"""Build the Pinehollow industrial workbench (with pegboard hutch) asset.

Run from the repository root:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
        --background --factory-startup \
        --python tools/blender/build_workbench.py -- render

Modelled from a single isolated reference of a heavy-duty workbench: a warm
walnut butcher-block worktop and lower/upper shelves (with baked grain) on a
near-black steel frame — four legs with two-tier cast feet and rivets, a solid
apron skirt with two flush bar-pull drawers, and a tan pegboard back panel
(tiled hole grid + hooks + wire basket) under a bracketed top shelf.

Authored in metres. Saves a traceable .blend under asset_sources/blender/clubhouse/
and exports a GLB into vendor/models/clubhouse/. No third-party assets imported.

Convention:  X width, Y depth (-Y = player/front side), Z up.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
import bmesh

SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[2]
SOURCE_DIR = ROOT / "asset_sources" / "blender" / "clubhouse"
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
PREVIEW_DIR = ROOT / "qa" / "workbench"
for d in (SOURCE_DIR, EXPORT_DIR):
    d.mkdir(parents=True, exist_ok=True)

BUILD_VERSION = 2
ASSET_ID = "workbench"

BW, BD = 1.30, 0.62
TOP_Z, TOP_T = 0.860, 0.058
TOP_TOP = TOP_Z + TOP_T / 2
LEG_X, LEG_Y = 0.570, 0.235
FOOT_H = 0.070

PALETTE = {
    "walnut_dk": (0.090, 0.046, 0.024, 1.0),
    "black":     (0.028, 0.030, 0.035, 1.0),
    "bolt":      (0.085, 0.095, 0.105, 1.0),
    "collision": (1.0, 0.0, 1.0, 0.0),
}


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.length_unit = "METERS"
    sc["asset_build_script"] = str(SCRIPT.relative_to(ROOT)).replace("\\", "/")
    sc["units"] = "meters"


def mat(name, color, *, roughness=0.6, metallic=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = color
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = color
    b.inputs["Roughness"].default_value = roughness
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Alpha"].default_value = color[3]
    if color[3] < 1.0 and hasattr(m, "surface_render_method"):
        m.surface_render_method = "DITHERED"
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


def _new_image(name, w, h):
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    return bpy.data.images.new(name, width=w, height=h, alpha=False)


def pegboard_dot_image(name="PegDotTile", size=128):
    """One crisp, high-res pegboard cell: warm hardboard with a sharp round hole."""
    import numpy as np
    img = _new_image(name, size, size)
    base = np.array([0.63, 0.45, 0.275], np.float32)
    hole = np.array([0.082, 0.060, 0.046], np.float32)
    ring = np.array([0.40, 0.28, 0.17], np.float32)
    yy, xx = np.mgrid[0:size, 0:size]
    c = (size - 1) / 2.0
    d = np.sqrt((xx - c) ** 2 + (yy - c) ** 2)
    r = size * 0.135
    mask = np.clip((r - d) * 2.2 + 0.5, 0.0, 1.0)[..., None].astype(np.float32)
    rim = (np.clip(1.4 - abs(d - r) / 2.2, 0.0, 1.0) * 0.5)[..., None].astype(np.float32)
    rng = np.random.default_rng(3)
    grain = rng.random((size, size)).astype(np.float32)[..., None]
    rgb = base * (1 - mask) + hole * mask
    rgb = rgb * (1 - rim) + ring * rim
    rgb = rgb * (0.955 + 0.045 * grain)
    rgba = np.concatenate([rgb, np.ones((size, size, 1), np.float32)], axis=2)
    img.colorspace_settings.name = "sRGB"
    img.pixels[:] = rgba.ravel().tolist()
    img.update()
    img.pack()
    return img


def wood_image(name="WoodGrain", w=1024, h=512):
    """A high-res walnut board with organic, domain-warped grain (value noise),
    plank-to-plank tone variation and a fine pore layer — a real butcher-block read."""
    import numpy as np
    img = _new_image(name, w, h)
    rng = np.random.default_rng(11)

    def vnoise(nx, ny):
        g = rng.random((ny + 1, nx + 1)).astype(np.float32)
        yy = np.linspace(0, ny, h, endpoint=False)
        xx = np.linspace(0, nx, w, endpoint=False)
        y0 = np.floor(yy).astype(int)
        x0 = np.floor(xx).astype(int)
        fy = (yy - y0)[:, None].astype(np.float32)
        fx = (xx - x0)[None, :].astype(np.float32)
        fy = fy * fy * (3 - 2 * fy)
        fx = fx * fx * (3 - 2 * fx)
        g00 = g[y0][:, x0]
        g01 = g[y0][:, x0 + 1]
        g10 = g[y0 + 1][:, x0]
        g11 = g[y0 + 1][:, x0 + 1]
        return (g00 * (1 - fx) + g01 * fx) * (1 - fy) + (g10 * (1 - fx) + g11 * fx) * fy

    V = np.linspace(0, 1, h, dtype=np.float32)[:, None] * np.ones((1, w), np.float32)
    warp = (vnoise(20, 6) - 0.5) * 2.2 + (vnoise(48, 12) - 0.5) * 0.7
    grain = (0.5 + 0.5 * np.sin((V * 24.0 + warp) * 2 * np.pi)) ** 2.3
    fine = vnoise(300, 100)
    plank = vnoise(5, 4)[..., None]
    base = np.array([0.200, 0.106, 0.055], np.float32)
    dark = np.array([0.090, 0.045, 0.023], np.float32)
    light = np.array([0.260, 0.150, 0.088], np.float32)
    tone = base[None, None, :] * (1 - plank) + light[None, None, :] * plank
    col = tone * (1 - 0.5 * grain[..., None]) + dark[None, None, :] * (0.5 * grain[..., None])
    col = np.clip(col * (0.90 + 0.10 * fine[..., None]), 0.0, 1.0).astype(np.float32)
    rgba = np.concatenate([col, np.ones((h, w, 1), np.float32)], axis=2)
    img.colorspace_settings.name = "sRGB"
    img.pixels[:] = rgba.ravel().tolist()
    img.update()
    img.pack()
    return img


def metal_image(name="Gunmetal", w=256, h=256):
    """A subtle brushed gunmetal-charcoal: low-contrast streaks + soft mottle so the
    steel reads as real powder-coated metal with life, not a dead-flat fill colour."""
    import numpy as np
    img = _new_image(name, w, h)
    rng = np.random.default_rng(5)
    streak = np.repeat((rng.random((1, w)).astype(np.float32) - 0.5), h, axis=0) * 0.045

    def vn(nx, ny):
        g = rng.random((ny + 1, nx + 1)).astype(np.float32)
        yy = np.linspace(0, ny, h, endpoint=False)
        xx = np.linspace(0, nx, w, endpoint=False)
        y0 = np.floor(yy).astype(int)
        x0 = np.floor(xx).astype(int)
        fy = (yy - y0)[:, None].astype(np.float32)
        fx = (xx - x0)[None, :].astype(np.float32)
        fy = fy * fy * (3 - 2 * fy)
        fx = fx * fx * (3 - 2 * fx)
        return (g[y0][:, x0] * (1 - fx) + g[y0][:, x0 + 1] * fx) * (1 - fy) + (g[y0 + 1][:, x0] * (1 - fx) + g[y0 + 1][:, x0 + 1] * fx) * fy

    mottle = (vn(10, 10) - 0.5) * 0.05
    fine = (rng.random((h, w)).astype(np.float32) - 0.5) * 0.012
    val = np.clip(0.086 + streak + mottle + fine, 0.03, 0.22)[..., None]
    rgb = np.clip(val * np.array([0.90, 0.96, 1.08], np.float32), 0.0, 1.0)
    rgba = np.concatenate([rgb, np.ones((h, w, 1), np.float32)], axis=2)
    img.colorspace_settings.name = "sRGB"
    img.pixels[:] = rgba.ravel().tolist()
    img.update()
    img.pack()
    return img


def materials():
    return {
        "walnut": mat_tex("M_BenchWalnut", wood_image(), roughness=0.44),
        "walnut_dk": mat("M_BenchWalnutDk", PALETTE["walnut_dk"], roughness=0.5),
        # gunmetal-charcoal satin steel: lifted off pure black so the 3D form and its
        # highlights actually read, instead of crushing to a flat 90s-looking silhouette.
        "black": mat_tex("M_BenchSteel", metal_image(), roughness=0.40, metallic=0.62),
        "bolt": mat("M_BenchBolt", (0.120, 0.130, 0.146, 1.0), roughness=0.28, metallic=0.85),
        "peg": mat_tex("M_BenchPegboard", pegboard_dot_image(), roughness=0.82),
        "collision": mat("M_Collision", PALETTE["collision"], roughness=1.0),
    }


def activate(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def finish_mesh(obj, material, *, bevel_width=0.0, uv=True):
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel_width > 0:
        md = obj.modifiers.new("EdgeSoftening", "BEVEL")
        md.width = bevel_width
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
        bpy.ops.object.shade_auto_smooth(angle=math.radians(38))
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
    o.empty_display_size = 0.10
    parent_keep(o, parent)
    for k, v in (props or {}).items():
        o[k] = v
    return o


def box(name, dims, loc, material, *, rot=(0, 0, 0), bevel=0.004, parent=None, props=None):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.dimensions = dims
    activate(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.rotation_euler = rot
    o.location = loc
    finish_mesh(o, material, bevel_width=(min(bevel, min(dims) * 0.24) if bevel else 0.0))
    parent_keep(o, parent)
    for k, v in (props or {}).items():
        o[k] = v
    return o


def cyl(name, radius, depth, loc, material, *, rot=(0, 0, 0), verts=14, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    finish_mesh(o, material, bevel_width=min(0.0012, radius * 0.3), uv=False)
    parent_keep(o, parent)
    return o


def frustum(name, r1, r2, depth, loc, material, *, segments=4, parent=None):
    from mathutils import Matrix
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
    me.materials.append(material)
    parent_keep(o, parent)
    return o


def wood_slab(name, dims, loc, material, *, parent=None, bevel=0.006, tile_x=1.45):
    """A wood plank with explicit UVs so the grain runs along its length (X),
    mapped once across the board so there is no visible texture repeat."""
    w, d, h = dims
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= w
        v.co.y *= d
        v.co.z *= h
    uv = bm.loops.layers.uv.new("UVMap")
    nx = max(1.0, w / tile_x)
    for f in bm.faces:
        n = f.normal
        for lp in f.loops:
            c = lp.vert.co
            if abs(n.z) > 0.5:
                lp[uv].uv = ((c.x / w + 0.5) * nx, (c.y / d + 0.5))
            elif abs(n.y) > 0.5:
                lp[uv].uv = ((c.x / w + 0.5) * nx, (c.z / h + 0.5) * 2.5)
            else:
                lp[uv].uv = ((c.y / d + 0.5), (c.z / h + 0.5) * 2.5)
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
    o = box(name, dims, loc, M["collision"], bevel=0.0, parent=parent,
            props={"collision_proxy": True, "shape": "box"})
    o.display_type = "WIRE"
    o.hide_render = True
    return o


def rivet(name, loc, M, parent, *, r=0.008, d=0.012, face="y"):
    rot = {"y": (math.radians(90), 0, 0), "x": (0, math.radians(90), 0), "z": (0, 0, 0)}[face]
    return cyl(name, r, d, loc, M["bolt"], rot=rot, parent=parent)


def hook(name, x, z, ypeg, M, parent, *, double=False):
    """A thin black pegboard hook (single or double prong), curling up at the tip."""
    yb = ypeg - 0.006
    for i, ox in enumerate((-0.011, 0.011) if double else (0.0,)):
        cyl(f"{name}_stem{i}", 0.0035, 0.042, (x + ox, yb - 0.021, z), M["black"], rot=(math.radians(90), 0, 0), parent=parent)
        cyl(f"{name}_tip{i}", 0.0035, 0.020, (x + ox, yb - 0.041, z + 0.009), M["black"], parent=parent)


def build_drawer(tag, cx, front_y, apron_z, M, parent, *, width, height, depth, travel):
    """A real drawer TRAY (front + two sides + back + plywood bottom + handle),
    fused into one movable node that slides along -Y out of its carcass cavity."""
    fy = front_y - 0.004                       # front panel plane (nearly flush in the opening)
    inner_z = apron_z - 0.004
    parts = [
        box(f"Dw{tag}Front", (width, 0.015, height), (cx, fy, apron_z), M["black"], bevel=0.004),
        box(f"Dw{tag}Back", (width - 0.024, 0.012, height - 0.016), (cx, fy + 0.010 + depth, inner_z), M["black"], bevel=0.002),
        box(f"Dw{tag}Bottom", (width - 0.020, depth, 0.008), (cx, fy + 0.010 + depth / 2, inner_z - height / 2 + 0.008), M["walnut_dk"], bevel=0.002),
        box(f"Dw{tag}Handle", (0.205, 0.028, 0.019), (cx, fy - 0.020, apron_z), M["black"], bevel=0.006),
    ]
    for ex in (-1, 1):
        parts.append(box(f"Dw{tag}Side{ex}", (0.012, depth, height - 0.014), (cx + ex * (width / 2 - 0.008), fy + 0.010 + depth / 2, inner_z), M["black"], bevel=0.002))
        parts.append(box(f"Dw{tag}HFoot{ex}", (0.016, 0.020, 0.019), (cx + ex * 0.094, fy - 0.010, apron_z), M["black"], bevel=0.004))
        for cz in (-1, 1):
            parts.append(rivet(f"Dw{tag}Riv{ex}{cz}", (cx + ex * (width / 2 - 0.028), fy - 0.005, apron_z + cz * (height / 2 - 0.020)), M, None, r=0.006, d=0.010))
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    drawer = parts[0]
    drawer.name = f"Drawer_{tag}"
    # origin at the closed drawer-front centre -> a clean slide reference for the game
    from mathutils import Vector
    bpy.context.scene.cursor.location = Vector((cx, fy, apron_z))
    activate(drawer)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    bpy.context.scene.cursor.location = Vector((0, 0, 0))
    drawer["movable"] = "drawer"
    drawer["slide_axis"] = "-Y"
    drawer["open_travel_m"] = travel
    parent_keep(drawer, parent)
    return drawer


def build_workbench(M):
    root = empty(ASSET_ID, props={
        "asset_id": ASSET_ID, "asset_version": BUILD_VERSION, "units": "meters",
        "front": "-Y (player side)", "target_dimensions_m": [BW, BD, 1.45],
        "source": "Original Pinehollow Golf asset generated in-repository",
        "license": "Project-owned / UNLICENSED",
    })

    # ---- legs with two-tier cast feet, strap panels, rivets ----------------------
    leg_top = TOP_Z - TOP_T / 2
    leg_h = leg_top - FOOT_H
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * LEG_X, sy * LEG_Y
            tag = f"{'L' if sx < 0 else 'R'}{'F' if sy < 0 else 'B'}"
            box(f"FootPlate_{tag}", (0.150, 0.150, 0.016), (x, y, 0.008), M["black"], bevel=0.004, parent=root)
            frustum(f"FootTierA_{tag}", 0.100, 0.082, 0.022, (x, y, 0.027), M["black"], parent=root)
            frustum(f"FootTierB_{tag}", 0.076, 0.052, 0.040, (x, y, 0.058), M["black"], parent=root)
            box(f"Leg_{tag}", (0.072, 0.076, leg_h), (x, y, FOOT_H + leg_h / 2), M["black"], bevel=0.004, parent=root)
            box(f"LegStrapY_{tag}", (0.052, 0.006, leg_h * 0.92), (x, y - sy * 0.041, FOOT_H + leg_h / 2), M["black"], bevel=0.002, parent=root)
            box(f"LegStrapX_{tag}", (0.006, 0.054, leg_h * 0.92), (x + sx * 0.039, y, FOOT_H + leg_h / 2), M["black"], bevel=0.002, parent=root)
            for bx, bz in ((-0.017, 0.15), (0.017, 0.15), (-0.017, 0.10), (0.017, 0.10)):
                rivet(f"RivFoot_{tag}_{bx}_{bz}", (x + bx, y - sy * 0.044, bz), M, root, r=0.007)
            if sy < 0:
                for k, rz in enumerate((0.30, 0.46, leg_top - 0.10)):
                    rivet(f"RivCol_{tag}_{k}", (x, y - 0.044, rz), M, root, r=0.007)

    # ---- worktop: thick walnut butcher-block slab with baked grain ---------------
    wood_slab("Worktop", (BW, BD, TOP_T), (0, 0, TOP_Z), M["walnut"], bevel=0.010, parent=root)

    # ---- cabinet carcass with two REAL, openable drawers -------------------------
    apron_h = 0.156
    apron_z = TOP_Z - TOP_T / 2 - apron_h / 2 - 0.004
    span = 2 * LEG_X + 0.016
    front_y = -LEG_Y - 0.030
    carc_depth = 2 * LEG_Y + 0.050
    # carcass shell: back, sides, floor, and a full-depth centre divider (two bays)
    box("CarcBack", (span, 0.022, apron_h), (0, LEG_Y + 0.030, apron_z), M["black"], bevel=0.004, parent=root)
    for sx in (-1, 1):
        box(f"CarcSide_{sx}", (0.022, carc_depth, apron_h), (sx * (LEG_X + 0.024), 0.02, apron_z), M["black"], bevel=0.004, parent=root)
    box("CarcFloor", (span - 0.02, carc_depth, 0.014), (0, 0.02, apron_z - apron_h / 2 + 0.007), M["black"], bevel=0.003, parent=root)
    box("CarcDivider", (0.030, carc_depth, apron_h - 0.02), (0, 0.02, apron_z), M["black"], bevel=0.003, parent=root)
    # face frame (front): top & bottom rails, end stiles, a centre stile -> two openings
    fr = 0.022
    box("FrameTopRail", (span, fr, 0.028), (0, front_y, apron_z + apron_h / 2 - 0.014), M["black"], bevel=0.003, parent=root)
    box("FrameBotRail", (span, fr, 0.028), (0, front_y, apron_z - apron_h / 2 + 0.014), M["black"], bevel=0.003, parent=root)
    box("FrameCtrStile", (0.050, fr, apron_h - 0.028), (0, front_y, apron_z), M["black"], bevel=0.003, parent=root)
    for sx in (-1, 1):
        box(f"FrameEndStile_{sx}", (0.030, fr, apron_h - 0.028), (sx * (span / 2 - 0.015), front_y, apron_z), M["black"], bevel=0.003, parent=root)
    for sx in (-1, 1):
        for cz in (apron_z + apron_h / 2 - 0.030, apron_z - apron_h / 2 + 0.030):
            rivet(f"FrameRiv_{sx}_{cz:.2f}", (sx * (span / 2 - 0.014), front_y - 0.008, cz), M, root, r=0.007)
    # the drawers: separate movable nodes that slide out of their bays along -Y
    open_h = apron_h - 0.056
    for tag, sx in (("Left", -1), ("Right", 1)):
        build_drawer(tag, sx * 0.286, front_y, apron_z, M, root, width=0.505, height=open_h - 0.006, depth=0.40, travel=0.30)

    # ---- base rails + lower walnut shelf -----------------------------------------
    rail_z = 0.150
    box("BaseRailFront", (BW - 0.14, 0.040, 0.055), (0, -LEG_Y, rail_z), M["black"], bevel=0.004, parent=root)
    box("BaseRailBack", (BW - 0.14, 0.040, 0.055), (0, LEG_Y, rail_z), M["black"], bevel=0.004, parent=root)
    for sx in (-1, 1):
        box(f"BaseRailSide_{sx}", (0.040, 2 * LEG_Y - 0.02, 0.055), (sx * LEG_X, 0, rail_z), M["black"], bevel=0.004, parent=root)
    wood_slab("LowerShelf", (2 * LEG_X - 0.02, 2 * LEG_Y + 0.06, 0.028), (0, 0, rail_z + 0.030), M["walnut"], bevel=0.005, parent=root)

    # ---- pegboard hutch: posts, framed tan pegboard, hooks + wire basket ---------
    post_h = 0.520
    post_zc = TOP_TOP + post_h / 2
    post_y = BD / 2 - 0.045
    for sx in (-1, 1):
        box(f"PegPost_{sx}", (0.045, 0.055, post_h), (sx * (BW / 2 - 0.05), post_y, post_zc), M["black"], bevel=0.004, parent=root)
        box(f"PegGusset_{sx}", (0.026, 0.150, 0.030), (sx * (BW / 2 - 0.05), post_y - 0.085, TOP_TOP + post_h - 0.045),
            M["black"], rot=(math.radians(-20), 0, 0), bevel=0.003, parent=root)
        for k, rz in enumerate((TOP_TOP + 0.05, post_zc, TOP_TOP + post_h - 0.06)):
            rivet(f"PegRivet_{sx}_{k}", (sx * (BW / 2 - 0.05), post_y - 0.030, rz), M, root, r=0.009)
    peg_w, peg_h = BW - 0.19, 0.420
    peg_zc = TOP_TOP + 0.055 + peg_h / 2
    peg_y = BD / 2 - 0.075
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= peg_w
        v.co.y *= 0.014
        v.co.z *= peg_h
    uv = bm.loops.layers.uv.new("UVMap")
    nx, nz = 30, 12
    for f in bm.faces:
        n = f.normal
        for lp in f.loops:
            c = lp.vert.co
            lp[uv].uv = ((c.x / peg_w + 0.5) * nx, (c.z / peg_h + 0.5) * nz) if abs(n.y) > 0.5 else (0.16, 0.16)
    me = bpy.data.meshes.new("Pegboard")
    bm.to_mesh(me)
    bm.free()
    pegobj = bpy.data.objects.new("Pegboard", me)
    bpy.context.collection.objects.link(pegobj)
    pegobj.location = (0, peg_y, peg_zc)
    me.materials.append(M["peg"])
    parent_keep(pegobj, root)
    box("PegFrameTop", (peg_w + 0.03, 0.030, 0.028), (0, peg_y, peg_zc + peg_h / 2 + 0.005), M["black"], bevel=0.004, parent=root)
    box("PegFrameBot", (peg_w + 0.03, 0.030, 0.028), (0, peg_y, peg_zc - peg_h / 2 - 0.005), M["black"], bevel=0.004, parent=root)
    for fx in (-1, 1):
        for tagz, frameZ in (("t", peg_zc + peg_h / 2 + 0.005), ("b", peg_zc - peg_h / 2 - 0.005)):
            rivet(f"PegFrameRiv_{fx}_{tagz}", (fx * (peg_w / 2 - 0.02), peg_y - 0.020, frameZ), M, root, r=0.007)
    # varied hooks (single + double) across the board, echoing the reference
    for i, (hx, hz, dbl) in enumerate([
        (-0.42, 0.10, False), (-0.30, 0.10, False), (-0.18, 0.10, False),
        (0.10, 0.10, True), (0.20, 0.10, True), (0.30, 0.10, True),
        (-0.20, -0.05, False), (0.24, -0.06, True), (0.10, -0.06, True),
    ]):
        hook(f"Hook_{i}", hx, peg_zc + hz, peg_y - 0.007, M, root, double=dbl)
    # small wire basket, bottom-left
    bx, bzc, bw_, bd_, bh_ = -0.40, peg_zc - 0.13, 0.11, 0.05, 0.09
    for ez in (bh_ / 2, -bh_ / 2):
        box(f"BasketH_{ez:.2f}", (bw_, 0.004, 0.006), (bx, peg_y - 0.028, bzc + ez), M["black"], bevel=0.0, parent=root)
    box("BasketBase", (bw_, bd_, 0.005), (bx, peg_y - 0.028 - bd_ / 2, bzc - bh_ / 2), M["black"], bevel=0.0, parent=root)
    for ex in (-1, 1):
        box(f"BasketV_{ex}", (0.005, 0.004, bh_), (bx + ex * bw_ / 2, peg_y - 0.028, bzc), M["black"], bevel=0.0, parent=root)
        box(f"BasketD_{ex}", (0.005, bd_, 0.005), (bx + ex * bw_ / 2, peg_y - 0.028 - bd_ / 2, bzc - bh_ / 2), M["black"], bevel=0.0, parent=root)
    for wx in (-0.03, 0.0, 0.03):
        box(f"BasketW_{wx:.2f}", (0.004, 0.004, bh_), (bx + wx, peg_y - 0.028, bzc), M["black"], bevel=0.0, parent=root)

    # ---- top shelf: walnut resting on the posts, front edge overhanging ----------
    shelf_y = 0.165
    shelf_z = TOP_TOP + post_h + 0.020
    wood_slab("TopShelf", (BW + 0.03, 0.235, 0.040), (0, shelf_y, shelf_z), M["walnut"], bevel=0.006, parent=root)
    for sx in (-1, 1):
        box(f"TopShelfCap_{sx}", (0.028, 0.235, 0.054), (sx * (BW / 2 + 0.002), shelf_y, shelf_z), M["black"], bevel=0.004, parent=root)

    # ---- collision proxies -------------------------------------------------------
    collision_box("COL_BenchBody", (BW, BD, TOP_TOP), (0, 0, TOP_TOP / 2), M, parent=root)
    collision_box("COL_BenchHutch", (BW, 0.14, post_h + 0.06), (0, BD / 2 - 0.05, TOP_TOP + (post_h + 0.06) / 2), M, parent=root)
    return root


def descendants(root):
    out = [root]
    stack = list(root.children)
    while stack:
        o = stack.pop(0)
        out.append(o)
        stack.extend(o.children)
    return out


def join_static(root):
    bpy.ops.object.select_all(action="DESELECT")
    bodies = [o for o in descendants(root) if o.type == "MESH"
              and not o.get("collision_proxy") and not o.get("movable")]
    if len(bodies) < 2:
        return
    for o in bodies:
        o.select_set(True)
    target = bodies[0]
    target.name = "workbench_body"
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()


def save_and_export(root):
    txt = bpy.data.texts.new("BUILD_INFO.txt")
    txt.write(f"Pinehollow Golf industrial workbench\nasset_id: {ASSET_ID}\n"
              f"builder: {SCRIPT.relative_to(ROOT).as_posix()}\nunits: metres\n"
              "source: original in-repository geometry; no third-party downloads\n")
    blend_path = SOURCE_DIR / f"{ASSET_ID}.blend"
    glb_path = EXPORT_DIR / f"{ASSET_ID}.glb"
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
    print(f"BUILT|{ASSET_ID}|source={blend_path}|export={glb_path}|nodes={len(sel)}")


def render_preview(root, open_drawers=False):
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    sc = bpy.context.scene
    if open_drawers:
        for o in bpy.data.objects:
            if o.get("movable") == "drawer":
                o.location.y -= o.get("open_travel_m", 0.30) * 0.8
    box("PreviewFloor", (16, 16, 0.05), (0, 0, -0.025),
        mat("M_PreviewFloor", (0.58, 0.58, 0.60, 1.0), roughness=0.9))
    world = bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.74, 0.74, 0.77, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.62
    sc.world = world

    def light(name, loc, energy, size, rot):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.size = size
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        ob.rotation_euler = rot
        bpy.context.collection.objects.link(ob)
    light("Key", (2.6, -3.4, 3.6), 700, 4.2, (math.radians(50), 0, math.radians(38)))
    light("Fill", (-3.4, -2.0, 2.2), 240, 5.0, (math.radians(64), 0, math.radians(-52)))
    light("Rim", (-1.0, 3.4, 2.8), 380, 3.0, (math.radians(120), 0, math.radians(200)))
    light("Softbox", (0.3, -2.9, 2.1), 240, 6.5, (math.radians(56), 0, 0))   # big frontal card -> metal highlights
    light("Top", (0.2, 0.1, 4.3), 300, 5.5, (0, 0, 0))                        # broad overhead sweep
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 62
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    cam.location = (2.35, -2.75, 1.55)
    cam.rotation_euler = (math.radians(74), 0, math.radians(40))
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
    sc.render.filepath = str(PREVIEW_DIR / ("preview_open.png" if open_drawers else "preview.png"))
    bpy.ops.render.render(write_still=True)
    print(f"RENDER|{sc.render.filepath}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    reset_scene()
    M = materials()
    root = build_workbench(M)
    if "nojoin" not in argv:
        join_static(root)
    save_and_export(root)
    if "render" in argv:
        render_preview(root, open_drawers=("open" in argv))
    print(f"COMPLETE|asset={ASSET_ID}")


if __name__ == "__main__":
    main()
