"""Golf-course flora production kit — trees, shrubs, reeds, rocks.

Self-contained (does not use lib_props furniture helpers): organic geometry
built from noise-displaced icospheres/cones with per-vertex colors, exported
one GLB per variant to vendor/models/flora/.

The in-game loader normalizes each tree to height 1 and scales at placement,
so SILHOUETTE and PROPORTION are what matter here, not absolute size.
Every mesh in a variant shares ONE vertex-colored material so the whole
variant instances as a single InstancedMesh part in three.js.

Run:
  "<blender>" --background --factory-startup --python tools/blender/build_course_flora.py -- render
"""

from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector, noise

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
OUT_DIR = ROOT / "vendor" / "models" / "flora"
SRC_DIR = ROOT / "asset_sources" / "blender" / "flora"
QA_DIR = ROOT / "qa" / "flora"

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


# ---------------------------------------------------------------- scene utils --

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def vertex_color_material(name):
    """One Principled material driven by the mesh Color attribute."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.88
    try:
        bsdf.inputs["Specular IOR Level"].default_value = 0.15
    except KeyError:
        pass
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def set_colors(obj, color_fn):
    """Per-vertex colors: color_fn(world_co, local_index) -> (r, g, b)."""
    me = obj.data
    attr = me.color_attributes.get("Col")
    if attr is None:
        attr = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    mw = obj.matrix_world
    for i, v in enumerate(me.vertices):
        r, g, b = color_fn(mw @ v.co, i)
        attr.data[i].color = (r, g, b, 1.0)


def shade(obj, smooth=True):
    for p in obj.data.polygons:
        p.use_smooth = smooth


def displace_radial(obj, amp, freq, seed, center=None):
    """Push verts along their radial direction by fBm noise — organic blobs."""
    me = obj.data
    c = center if center is not None else Vector((0, 0, 0))
    off = Vector((seed * 13.7, seed * 5.1, seed * 9.3))
    for v in me.vertices:
        d = (v.co - c)
        L = d.length
        if L < 1e-6:
            continue
        n = d / L
        p = v.co * freq + off
        f = noise.noise(p) * 0.65 + noise.noise(p * 2.1) * 0.35
        v.co = c + n * (L * (1.0 + amp * f))


def ico(name, radius, loc, subdiv=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=radius, location=loc)
    o = bpy.context.active_object
    o.name = name
    return o


def cone(name, r1, r2, depth, loc, verts=14):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc)
    o = bpy.context.active_object
    o.name = name
    return o


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    tgt = bpy.context.active_object
    tgt.name = name
    return tgt


def clamp01(x):
    return max(0.0, min(1.0, x))


def leaf_color_fn(rng, base_hsv, zmin, zmax, tint_noise=0.10):
    """Canopy shading: darker below/inner, lighter on top, hue jitter."""
    h0, s0, v0 = base_hsv

    def fn(co, i):
        t = clamp01((co.z - zmin) / max(0.001, zmax - zmin))
        p = co * 1.7
        j = noise.noise(Vector((p.x + 31.7, p.y - 12.3, p.z + 4.9)))
        v = v0 * (0.52 + 0.62 * t) * (1.0 + tint_noise * j)
        h = h0 + 0.015 * noise.noise(co * 0.9)
        s = s0 * (1.06 - 0.18 * t)
        import colorsys
        r, g, b = colorsys.hsv_to_rgb(h % 1.0, clamp01(s), clamp01(v))
        return (r, g, b)

    return fn


def bark_color_fn(base=(0.30, 0.225, 0.16), dark=0.55):
    def fn(co, i):
        t = clamp01(co.z / 3.0)
        k = dark + (1 - dark) * t
        j = 1.0 + 0.12 * noise.noise(co * 3.1)
        return (base[0] * k * j, base[1] * k * j, base[2] * k * j)

    return fn


# --------------------------------------------------------------- tree builders --

def trunk_with_branches(rng, h, r_base, r_top, branches, lean=0.0):
    """Tapered trunk + a few branch stubs reaching into the canopy."""
    parts = []
    t = cone("Trunk", r_base, r_top, h, (0, 0, h / 2), verts=12)
    if lean:
        t.rotation_euler = (lean, 0, rng.uniform(0, 6.28))
    parts.append(t)
    for i in range(branches):
        ang = rng.uniform(0, 2 * math.pi)
        tilt = rng.uniform(0.5, 0.9)
        bl = h * rng.uniform(0.28, 0.42)
        br = cone(f"Branch{i}", r_top * 1.1, r_top * 0.4, bl, (0, 0, 0), verts=8)
        br.rotation_euler = (tilt, 0, ang)
        zb = h * rng.uniform(0.55, 0.8)
        br.location = (math.sin(ang) * math.cos(tilt) * bl * 0.4,
                       -math.cos(ang) * math.cos(tilt) * bl * 0.4 * 0 + math.cos(ang) * math.sin(0) ,
                       zb)
        # place origin end near trunk axis
        br.location = (math.sin(ang) * bl * 0.30, math.cos(ang) * bl * 0.30, zb)
        parts.append(br)
    return parts


def lobed_canopy(rng, lobes, cz, spread, rz, amp, subdiv=2, squash=0.9, stack=False):
    """Multi-lobe blob canopy: overlapping displaced icospheres.

    Default mode scatters lobes on an asymmetric ring + crown so no tree reads
    as a single ball; stack mode piles slender lobes vertically (birch/poplar).
    """
    parts = []
    base_a = rng.uniform(0, 2 * math.pi)
    for i in range(lobes):
        if stack:
            t = i / max(1, lobes - 1)
            off = Vector((rng.uniform(-0.16, 0.16) * rz, rng.uniform(-0.16, 0.16) * rz,
                          (t - 0.35) * rz * 2.1))
            rr = rz * (1.0 - 0.38 * abs(t - 0.42) * 2)
        elif i == 0:
            # crown lobe, deliberately off-center — perfect symmetry reads fake
            off = Vector((rng.uniform(-0.22, 0.22) * rz, rng.uniform(-0.22, 0.22) * rz, rz * 0.30))
            rr = rz * rng.uniform(0.72, 0.85)
        else:
            a = base_a + (i - 1) * (2 * math.pi / max(1, lobes - 1)) + rng.uniform(-0.5, 0.5)
            d = spread * rng.uniform(0.62, 1.05)
            off = Vector((math.cos(a) * d, math.sin(a) * d, rng.uniform(-0.30, 0.22) * rz))
            rr = rz * rng.uniform(0.52, 0.78)
        o = ico(f"Lobe{i}", rr, (off.x, off.y, cz + off.z), subdiv=subdiv)
        o.scale = (rng.uniform(0.9, 1.12), rng.uniform(0.9, 1.12), squash * rng.uniform(0.9, 1.08))
        bpy.ops.object.transform_apply(scale=True)
        displace_radial(o, amp, 1.35 / rr, seed=rng.random() * 100, center=Vector((off.x, off.y, cz + off.z)))
        parts.append(o)
    return parts


def build_deciduous(vid, rng, *, lobes, height, canopy_w, canopy_squash, trunk_r,
                    leaf_hsv, subdiv=2, amp=0.24, branches=3, stack=False):
    h_can_center = height * 0.62
    rz = canopy_w / 2
    parts = trunk_with_branches(rng, h_can_center + rz * 0.3, trunk_r, trunk_r * 0.55, branches)
    canopy = lobed_canopy(rng, lobes, h_can_center, rz * 0.72, rz, amp, subdiv=subdiv,
                          squash=canopy_squash, stack=stack)
    tree = join(parts + canopy, vid)
    shade(tree, smooth=True)
    zs = [v.co.z for v in tree.data.vertices]
    zmin, zmax = min(zs), max(zs)
    leaf_fn = leaf_color_fn(rng, leaf_hsv, zmin + (zmax - zmin) * 0.25, zmax)
    bark_fn = bark_color_fn()
    canopy_floor = h_can_center - rz * canopy_squash * 1.05

    def color(co, i):
        if co.z < canopy_floor and (co.x * co.x + co.y * co.y) < (trunk_r * 6) ** 2:
            return bark_fn(co, i)
        # trunk/branch verts inside canopy still read bark if near axis and low
        return leaf_fn(co, i)

    set_colors(tree, color)
    return tree


def build_conifer(vid, rng, *, tiers, height, base_w, leaf_hsv, tip_lift=0.0, amp=0.05):
    parts = []
    trunk_h = height * 0.16
    parts.append(cone("Trunk", base_w * 0.10, base_w * 0.05, trunk_h * 1.6, (0, 0, trunk_h * 0.8), verts=10))
    z = trunk_h
    span = height - trunk_h
    for i in range(tiers):
        t = i / max(1, tiers - 1)
        r = (base_w / 2) * (1.0 - 0.72 * t) * rng.uniform(0.92, 1.08)
        th = span / tiers * rng.uniform(1.25, 1.45)
        c = cone(f"Tier{i}", r, r * 0.12, th, (0, 0, z + th / 2), verts=16)
        displace_radial(c, amp, 2.2 / max(0.2, r), seed=i * 7 + rng.random() * 10,
                        center=Vector((0, 0, z + th / 2)))
        parts.append(c)
        z += span / tiers * (0.82 + tip_lift * 0.1)
    tree = join(parts, vid)
    shade(tree, smooth=True)
    zs = [v.co.z for v in tree.data.vertices]
    zmin, zmax = min(zs), max(zs)
    leaf_fn = leaf_color_fn(rng, leaf_hsv, zmin, zmax, tint_noise=0.14)
    bark_fn = bark_color_fn()

    def color(co, i):
        if co.z < trunk_h and (co.x * co.x + co.y * co.y) < (base_w * 0.12) ** 2:
            return bark_fn(co, i)
        return leaf_fn(co, i)

    set_colors(tree, color)
    return tree


def build_shrub(vid, rng, *, lobes, width, height, leaf_hsv, amp=0.2, subdiv=2):
    parts = lobed_canopy(rng, lobes, height * 0.55, width * 0.3, height * 0.55, amp,
                         subdiv=subdiv, squash=height / max(0.001, width))
    sh = join(parts, vid)
    # drop base to z=0
    zmin = min(v.co.z for v in sh.data.vertices)
    for v in sh.data.vertices:
        v.co.z -= zmin
    shade(sh, smooth=True)
    zs = [v.co.z for v in sh.data.vertices]
    set_colors(sh, leaf_color_fn(rng, leaf_hsv, min(zs), max(zs)))
    return sh


def build_blade_clump(vid, rng, *, blades, height, spread, hsv, tip_droop=0.35, w=0.05):
    """Reeds / ornamental grass: fan of tapered double-sided blade strips."""
    me = bpy.data.meshes.new(vid)
    bm = bmesh.new()
    for b in range(blades):
        a = rng.uniform(0, 2 * math.pi)
        r0 = rng.uniform(0, spread * 0.25)
        hx = math.cos(a) * r0
        hy = math.sin(a) * r0
        hgt = height * rng.uniform(0.6, 1.15)
        lean = rng.uniform(0.05, tip_droop)
        dx, dy = math.cos(a) * lean * hgt, math.sin(a) * lean * hgt
        wd = w * rng.uniform(0.7, 1.2)
        px, py = -math.sin(a) * wd, math.cos(a) * wd
        segs = 3
        prev = None
        for sgi in range(segs + 1):
            t = sgi / segs
            cx = hx + dx * t * t
            cy = hy + dy * t * t
            cz = hgt * t
            wk = (1.0 - t * 0.85)
            v1 = bm.verts.new((cx - px * wk, cy - py * wk, cz))
            v2 = bm.verts.new((cx + px * wk, cy + py * wk, cz))
            if prev:
                bm.faces.new((prev[0], prev[1], v2, v1))
            prev = (v1, v2)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(vid, me)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    shade(obj, smooth=False)
    zs = [v.co.z for v in me.vertices]
    zmin, zmax = min(zs), max(zs)
    import colorsys

    def color(co, i):
        t = clamp01((co.z - zmin) / max(0.001, zmax - zmin))
        h0, s0, v0 = hsv
        r, g, b = colorsys.hsv_to_rgb(h0 + 0.02 * t, s0 * (1 - 0.25 * t), v0 * (0.55 + 0.65 * t))
        return (r, g, b)

    attr = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, v in enumerate(me.vertices):
        r, g, b = color(v.co, i)
        attr.data[i].color = (r, g, b, 1.0)
    return obj


def build_rock(vid, rng, *, width, height, tone=0.52, subdiv=2, amp=0.34):
    o = ico(vid, width / 2, (0, 0, height * 0.32), subdiv=subdiv)
    o.scale = (1.0, rng.uniform(0.75, 1.05), height / width * 1.4)
    bpy.ops.object.transform_apply(scale=True)
    displace_radial(o, amp, 1.6 / width, seed=rng.random() * 50, center=Vector((0, 0, height * 0.32)))
    # flatten the base so it sits into the ground
    for v in o.data.vertices:
        if v.co.z < 0.02:
            v.co.z = v.co.z * 0.25
    shade(o, smooth=False)

    def color(co, i):
        j = 0.86 + 0.24 * noise.noise(co * 2.4)
        base = tone * j
        warm = 0.94 + 0.10 * noise.noise(co * 0.8 + Vector((9, 1, 4)))
        k = clamp01(0.55 + co.z / max(0.001, height) * 0.5)  # darker toward the ground
        return (base * warm * k, base * k, base * 0.94 * k)

    set_colors(o, color)
    return o


# ------------------------------------------------------------------- catalog ---

def V(vid, kind, builder, hmin, hmax, **kw):
    return {"id": vid, "kind": kind, "builder": builder, "h": (hmin, hmax), "kw": kw}


CATALOG = [
    # deciduous — leaf HSV around 0.24-0.31 (yellow-green .. green)
    V("oak_a", "deciduous", "deciduous", 13, 17, lobes=7, height=3.0, canopy_w=2.9, canopy_squash=0.82,
      trunk_r=0.14, leaf_hsv=(0.265, 0.60, 0.36), branches=4, amp=0.26),
    V("oak_b", "deciduous", "deciduous", 11, 14, lobes=5, height=3.0, canopy_w=2.5, canopy_squash=0.85,
      trunk_r=0.12, leaf_hsv=(0.278, 0.58, 0.33), branches=3, amp=0.26),
    V("maple_a", "deciduous", "deciduous", 11, 14, lobes=5, height=3.0, canopy_w=2.3, canopy_squash=1.06,
      trunk_r=0.10, leaf_hsv=(0.245, 0.62, 0.38), branches=2, amp=0.22),
    V("birch_a", "deciduous", "deciduous", 10, 13, lobes=4, height=3.2, canopy_w=1.5, canopy_squash=1.15,
      trunk_r=0.06, leaf_hsv=(0.225, 0.55, 0.44), branches=2, subdiv=1, amp=0.24, stack=True),
    V("shade_a", "deciduous", "deciduous", 12, 15, lobes=6, height=2.8, canopy_w=3.3, canopy_squash=0.68,
      trunk_r=0.13, leaf_hsv=(0.29, 0.55, 0.32), branches=4, amp=0.24),
    V("flower_a", "ornamental", "deciduous", 5, 7, lobes=6, height=2.2, canopy_w=2.3, canopy_squash=0.86,
      trunk_r=0.08, leaf_hsv=(0.955, 0.30, 0.80), branches=2, subdiv=2, amp=0.24),
    # forest fill (cheap, subdiv 1)
    V("fill_a", "deciduous", "deciduous", 10, 15, lobes=4, height=3.0, canopy_w=2.4, canopy_squash=0.9,
      trunk_r=0.11, leaf_hsv=(0.272, 0.58, 0.33), branches=1, subdiv=1, amp=0.24),
    V("fill_b", "deciduous", "deciduous", 10, 15, lobes=3, height=3.0, canopy_w=2.1, canopy_squash=1.0,
      trunk_r=0.10, leaf_hsv=(0.255, 0.60, 0.35), branches=1, subdiv=1, amp=0.26),
    # evergreen
    V("pine_a", "evergreen", "conifer", 14, 18, tiers=5, height=3.4, base_w=1.5, leaf_hsv=(0.355, 0.52, 0.26)),
    V("pine_b", "evergreen", "conifer", 12, 15, tiers=4, height=3.0, base_w=1.6, leaf_hsv=(0.345, 0.5, 0.29)),
    V("spruce_a", "evergreen", "conifer", 12, 16, tiers=6, height=3.4, base_w=1.15, leaf_hsv=(0.38, 0.5, 0.24)),
    V("cedar_a", "evergreen", "conifer", 9, 12, tiers=7, height=3.0, base_w=0.95, leaf_hsv=(0.33, 0.45, 0.28)),
    # shrubs / ground
    V("shrub_round", "shrub", "shrub", 1.4, 2.2, lobes=2, width=1.5, height=1.1, leaf_hsv=(0.30, 0.55, 0.30)),
    V("shrub_flower", "shrub", "shrub", 1.2, 1.8, lobes=3, width=1.4, height=1.0, leaf_hsv=(0.93, 0.22, 0.62), amp=0.24),
    V("bush_native", "shrub", "shrub", 1.5, 2.6, lobes=3, width=1.8, height=1.2, leaf_hsv=(0.21, 0.48, 0.34), amp=0.3),
    V("reed_clump", "reed", "blades", 1.6, 2.4, blades=15, height=1.5, spread=0.5, hsv=(0.20, 0.5, 0.42), w=0.035),
    V("grass_clump", "reed", "blades", 0.9, 1.4, blades=12, height=0.8, spread=0.45, hsv=(0.23, 0.55, 0.4), tip_droop=0.5, w=0.05),
    # rocks
    V("rock_s", "rock", "rock", 0.5, 0.9, width=0.8, height=0.5, tone=0.46, amp=0.5),
    V("rock_m", "rock", "rock", 0.9, 1.6, width=1.2, height=0.75, tone=0.44, amp=0.52),
    V("boulder_a", "rock", "rock", 1.6, 2.8, width=1.6, height=1.1, tone=0.42, amp=0.55),
    V("shore_rock", "rock", "rock", 0.6, 1.2, width=1.1, height=0.45, tone=0.40, amp=0.34),
]


def build_variant(spec):
    reset_scene()
    rng = random.Random(hash(spec["id"]) & 0xFFFF)
    mat = vertex_color_material(f"M_{spec['id']}")
    b = spec["builder"]
    if b == "deciduous":
        obj = build_deciduous(spec["id"], rng, **spec["kw"])
    elif b == "conifer":
        obj = build_conifer(spec["id"], rng, **spec["kw"])
    elif b == "shrub":
        obj = build_shrub(spec["id"], rng, **spec["kw"])
    elif b == "blades":
        obj = build_blade_clump(spec["id"], rng, **spec["kw"])
    elif b == "rock":
        obj = build_rock(spec["id"], rng, **spec["kw"])
    else:
        raise ValueError(b)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    if spec["kind"] == "reed":
        mat.use_backface_culling = False
    # feet on z=0
    zmin = min(v.co.z for v in obj.data.vertices)
    for v in obj.data.vertices:
        v.co.z -= zmin
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)

    SRC_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(SRC_DIR / f"{spec['id']}.blend"), check_existing=False)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    glb = OUT_DIR / f"{spec['id']}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(glb), export_format="GLB", use_selection=True,
        export_apply=True, export_yup=True, export_normals=True,
        export_materials="EXPORT", export_cameras=False, export_lights=False,
    )
    print(f"BUILT|{spec['id']}|tris={tris}|glb={glb}")
    return tris


def render_contact_sheet():
    """All variants in one row-grid render for QA."""
    reset_scene()
    cols = 7
    SPACING = 8.0
    for i, spec in enumerate(CATALOG):
        glb = OUT_DIR / f"{spec['id']}.glb"
        if not glb.exists():
            continue
        bpy.ops.import_scene.gltf(filepath=str(glb))
        objs = [o for o in bpy.context.selected_objects if o.type == "MESH"]
        gx = (i % cols) * SPACING
        gy = -(i // cols) * SPACING
        for o in objs:
            o.location.x += gx
            o.location.y += gy
    sc = bpy.context.scene
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.75, 0.8, 0.9, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.7
    sc.world = world
    d = bpy.data.lights.new("Sun", "SUN")
    d.energy = 3.2
    d.angle = math.radians(6)
    sun = bpy.data.objects.new("Sun", d)
    sun.rotation_euler = (math.radians(48), 0, math.radians(35))
    bpy.context.collection.objects.link(sun)
    cx = (cols - 1) * SPACING / 2
    rows = (len(CATALOG) + cols - 1) // cols
    cy = -(rows - 1) * SPACING / 2
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 42
    cam = bpy.data.objects.new("Cam", cam_data)
    cam.location = (cx, cy - 44, 22)
    cam.rotation_euler = (Vector((cx, cy, 1.6)) - Vector(cam.location)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(cam)
    sc.camera = cam
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            sc.render.engine = eng
            break
        except Exception:
            continue
    QA_DIR.mkdir(parents=True, exist_ok=True)
    sc.render.resolution_x = 1800
    sc.render.resolution_y = 900
    sc.render.filepath = str(QA_DIR / "flora_contact_sheet.png")
    bpy.ops.render.render(write_still=True)
    print(f"RENDER|{sc.render.filepath}")


def main():
    manifest = {"comment": "Course flora kit. Loader keeps authored vertex colors. Heights in yards.",
                "variants": []}
    total = 0
    for spec in CATALOG:
        tris = build_variant(spec)
        total += tris
        manifest["variants"].append({
            "id": spec["id"], "kind": spec["kind"],
            "height": list(spec["h"]), "tris": tris,
        })
    (OUT_DIR / "_manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"MANIFEST|{OUT_DIR / '_manifest.json'}|variants={len(manifest['variants'])}|tris_total={total}")
    if "render" in ARGV:
        render_contact_sheet()


main()
