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

import colorsys
import hashlib
import json
import math
import random
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector, noise

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
OUT_DIR = ROOT / "vendor" / "models" / "flora"
SRC_DIR = ROOT / "asset_sources" / "blender" / "flora"
QA_DIR = ROOT / "qa" / "flora"

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

# The opening-hole planting recipe uses this deliberately small near-course set.
# Background/fill species remain untouched when the script is run with `hero`.
HERO_IDS = (
    "oak_a", "oak_b", "maple_a", "shade_a", "pine_a", "spruce_a",
    "shrub_round", "bush_native", "rock_s", "rock_m",
)

# Lightweight geometry used by src/render3d/floraLod.js outside the hero band.
# These preserve the hero kit's branch/crown language at a fraction of its cost.
PROXY_IDS = ("fill_a", "fill_b", "birch_a", "pine_b", "cedar_a", "pine_far")

PROXY_TARGETS = {
    "fill_a": ["oak_a"],
    "fill_b": ["oak_b", "shade_a"],
    "birch_a": ["maple_a"],
    "pine_b": [],
    "cedar_a": [],
    "pine_far": ["pine_a", "spruce_a", "pine_b", "cedar_a"],
}

PROXY_LEGACY_BASELINE = {
    "fill_a": {"tris": 152, "dimensions_m": [2.77586, 2.65830, 2.98944], "base_z_m": 1.11000},
    "fill_b": {"tris": 132, "dimensions_m": [2.45947, 1.53717, 2.94597], "base_z_m": 1.08750},
    "birch_a": {"tris": 180, "dimensions_m": [1.31282, 1.33358, 3.47036], "base_z_m": 1.10450},
    "pine_b": {"tris": 276, "dimensions_m": [1.50299, 1.49976, 2.88703], "base_z_m": 0.38400},
    "cedar_a": {"tris": 456, "dimensions_m": [0.97749, 0.97466, 2.71209], "base_z_m": 0.38400},
    # Exact Three.js fallback bounds before unit-height normalization; no file existed.
    "pine_far": {"tris": 56, "dimensions_m": [0.43301, 0.50000, 0.98000], "base_z_m": 0.00000,
                 "source": "runtime-derived fallback (no GLB)"},
}

ASSET_ORIGIN = "Original procedural geometry generated in-repository; no external assets."
PIPELINE_VERSION = 3


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


def stable_seed(value):
    """Stable across Python/Blender processes (unlike the built-in hash())."""
    return int.from_bytes(hashlib.blake2s(value.encode("utf8"), digest_size=4).digest(), "big")


def tapered_limb(name, start, end, radius_start, radius_end, verts=8):
    """Low-poly tapered cylinder aligned between two world-space points."""
    start = Vector(start)
    end = Vector(end)
    delta = end - start
    length = max(0.001, delta.length)
    obj = cone(name, radius_start, radius_end, length, (start + end) * 0.5, verts=verts)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = delta.to_track_quat("Z", "Y")
    return obj


def organic_lobe(name, rng, loc, radii, *, subdiv=1, roughness=0.14, yaw=0.0, pitch=0.0):
    """An asymmetric leaf/needle mass, intentionally smaller than a crown."""
    obj = ico(name, 1.0, loc, subdiv=subdiv)
    seed_offset = Vector((rng.random() * 17.0, rng.random() * 29.0, rng.random() * 41.0))
    for vertex in obj.data.vertices:
        direction = vertex.co.normalized()
        sample = vertex.co * 1.75 + seed_offset
        wobble = noise.noise(sample) * 0.68 + noise.noise(sample * 2.13) * 0.32
        # Keep a readable angular silhouette without collapsing any pad.
        vertex.co *= 1.0 + roughness * wobble
        vertex.co.x += direction.z * roughness * 0.08
    obj.scale = Vector(radii)
    obj.rotation_euler = (0.0, pitch, yaw)
    return obj


def organic_octa_lobe(name, rng, loc, radii, *, yaw=0.0, pitch=0.0):
    """Eight-triangle companion spray for foliage-rich but cheap LOD silhouettes."""
    rx, ry, rz = radii
    verts = [
        (rx * rng.uniform(0.90, 1.08), 0.0, 0.0),
        (-rx * rng.uniform(0.90, 1.08), 0.0, 0.0),
        (0.0, ry * rng.uniform(0.90, 1.08), 0.0),
        (0.0, -ry * rng.uniform(0.90, 1.08), 0.0),
        (0.0, 0.0, rz * rng.uniform(0.92, 1.10)),
        (0.0, 0.0, -rz * rng.uniform(0.90, 1.05)),
    ]
    faces = [
        (4, 0, 2), (4, 2, 1), (4, 1, 3), (4, 3, 0),
        (5, 2, 0), (5, 1, 2), (5, 3, 1), (5, 0, 3),
    ]
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update(calc_edges=True)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = Vector(loc)
    obj.rotation_euler = (0.0, pitch, yaw)
    return obj


def irregular_canopy_skirt(name, rng, loc, radii, height, *, yaw=0.0, segments=7):
    """Closed three-ring evergreen mass with an uneven, non-conical outline."""
    rx, ry = radii
    angles = [i * math.tau / segments + rng.uniform(-0.075, 0.075) for i in range(segments)]
    top_shift = Vector((rng.uniform(-0.10, 0.10) * rx, rng.uniform(-0.10, 0.10) * ry, 0.0))
    ring_specs = (
        (-height * 0.50, 0.82, Vector((rng.uniform(-0.035, 0.035) * rx, rng.uniform(-0.035, 0.035) * ry, 0.0))),
        (-height * 0.08, 1.00, Vector((0.0, 0.0, 0.0))),
        (height * 0.50, 0.26, top_shift),
    )
    verts = []
    for z, scale, shift in ring_specs:
        for angle in angles:
            jitter = rng.uniform(0.88, 1.12)
            verts.append((
                shift.x + math.cos(angle) * rx * scale * jitter,
                shift.y + math.sin(angle) * ry * scale * rng.uniform(0.90, 1.10),
                z + rng.uniform(-0.025, 0.025) * height,
            ))
    faces = [tuple(reversed(range(segments))), tuple(range(segments * 2, segments * 3))]
    for ring in range(2):
        start = ring * segments
        next_start = (ring + 1) * segments
        for index in range(segments):
            nxt = (index + 1) % segments
            faces.append((start + index, start + nxt, next_start + nxt, next_start + index))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update(calc_edges=True)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = Vector(loc)
    obj.rotation_euler = (0.0, 0.0, yaw)
    return obj


def leaf_palette(base_hsv, full_height, seed):
    """Readable deep-golf greens with a protected shadow floor."""
    h0, s0, v0 = base_hsv
    offset = Vector((seed * 0.013, seed * 0.021, seed * 0.034))

    def fn(co, _i):
        t = clamp01(co.z / max(0.001, full_height))
        n = noise.noise(co * 0.42 + offset)
        h = (h0 + 0.012 * n) % 1.0
        s = clamp01(s0 * (0.98 - 0.10 * t) + 0.025 * n)
        # Previous assets bottomed out near 0.18 value, which crushed to black
        # under course shadows. The authored floor is now roughly 0.38-0.44.
        v = clamp01(v0 * (0.77 + 0.25 * t) * (0.96 + 0.07 * n))
        return colorsys.hsv_to_rgb(h, s, v)

    return fn


def hero_bark_palette(full_height, seed, base=(0.34, 0.225, 0.13)):
    offset = Vector((seed * 0.017, seed * 0.009, seed * 0.027))

    def fn(co, _i):
        t = clamp01(co.z / max(0.001, full_height))
        n = noise.noise(co * 1.65 + offset)
        k = 0.72 + 0.18 * t + 0.08 * n
        return tuple(clamp01(channel * k) for channel in base)

    return fn


def rock_palette(full_height, seed, base=(0.43, 0.42, 0.36)):
    offset = Vector((seed * 0.007, seed * 0.019, seed * 0.011))

    def fn(co, _i):
        t = clamp01(co.z / max(0.001, full_height))
        n = noise.noise(co * 2.2 + offset)
        k = 0.72 + 0.25 * t + 0.10 * n
        return tuple(clamp01(channel * k) for channel in base)

    return fn


def bake_rebase_and_size(obj, *, target_height, target_width=None, target_depth=None):
    """Bake transforms, center XY, put the true mesh foot and origin at Z=0."""
    world = obj.matrix_world.copy()
    for vertex in obj.data.vertices:
        vertex.co = world @ vertex.co
    obj.matrix_world = Matrix.Identity(4)

    def bounds():
        xs = [v.co.x for v in obj.data.vertices]
        ys = [v.co.y for v in obj.data.vertices]
        zs = [v.co.z for v in obj.data.vertices]
        return min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)

    xmin, xmax, ymin, ymax, zmin, zmax = bounds()
    cx = (xmin + xmax) * 0.5
    cy = (ymin + ymax) * 0.5
    for vertex in obj.data.vertices:
        vertex.co.x -= cx
        vertex.co.y -= cy
        vertex.co.z -= zmin

    xmin, xmax, ymin, ymax, zmin, zmax = bounds()
    sx = (target_width / max(0.001, xmax - xmin)) if target_width else 1.0
    sy = (target_depth / max(0.001, ymax - ymin)) if target_depth else sx
    sz = target_height / max(0.001, zmax - zmin)
    for vertex in obj.data.vertices:
        vertex.co.x *= sx
        vertex.co.y *= sy
        vertex.co.z *= sz

    # Scaling an asymmetric crown can move its bbox center slightly; make the
    # authored pivot exactly the ground-contact center after the final size pass.
    xmin, xmax, ymin, ymax, zmin, _zmax = bounds()
    cx = (xmin + xmax) * 0.5
    cy = (ymin + ymax) * 0.5
    for vertex in obj.data.vertices:
        vertex.co.x -= cx
        vertex.co.y -= cy
        vertex.co.z -= zmin
    obj.location = (0.0, 0.0, 0.0)
    obj.rotation_mode = "XYZ"
    obj.rotation_euler = (0.0, 0.0, 0.0)
    obj.scale = (1.0, 1.0, 1.0)
    obj.data.validate(verbose=True)
    obj.data.update(calc_edges=True)
    return obj


def mesh_dimensions(obj):
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    return [max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)]


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


# ---------------------------------------------------------- H1 hero builders --

def build_hero_deciduous(vid, rng, *, height, canopy_w, canopy_d, trunk_r,
                         branches, leaf_hsv, openness=0.5):
    """Mature parkland tree with readable limbs and deliberate crown windows."""
    seed = stable_seed(vid)
    bark_fn = hero_bark_palette(height, seed)
    leaf_fn = leaf_palette(leaf_hsv, height, seed)
    bark_parts = []
    leaf_parts = []

    lean_angle = rng.uniform(0.0, math.tau)
    lean = Vector((math.cos(lean_angle), math.sin(lean_angle), 0.0)) * height * rng.uniform(0.025, 0.05)
    trunk_nodes = [
        Vector((0.0, 0.0, 0.0)),
        Vector((lean.x * 0.16, lean.y * 0.16, height * 0.27)),
        Vector((lean.x * 0.48, lean.y * 0.48, height * 0.48)),
        Vector((lean.x * 0.88, lean.y * 0.88, height * 0.66)),
    ]
    radii = (trunk_r, trunk_r * 0.72, trunk_r * 0.48, trunk_r * 0.28)
    for i in range(len(trunk_nodes) - 1):
        bark_parts.append(tapered_limb(
            f"Trunk_{i:02d}", trunk_nodes[i], trunk_nodes[i + 1], radii[i], radii[i + 1], verts=9,
        ))

    # Low buttress roots visually seat the trunk and make the asset base obvious.
    root_phase = rng.uniform(0.0, math.tau)
    for i in range(5):
        angle = root_phase + i * math.tau / 5.0 + rng.uniform(-0.18, 0.18)
        root_len = trunk_r * rng.uniform(2.4, 3.4)
        bark_parts.append(tapered_limb(
            f"Root_{i:02d}",
            (0.0, 0.0, trunk_r * 0.48),
            (math.cos(angle) * root_len, math.sin(angle) * root_len, 0.025),
            trunk_r * 0.62, trunk_r * 0.08, verts=7,
        ))

    branch_phase = rng.uniform(0.0, math.tau)
    crown_tips = []
    for i in range(branches):
        angle = branch_phase + i * math.tau / branches + rng.uniform(-0.24, 0.24)
        radial = Vector((math.cos(angle), math.sin(angle), 0.0))
        tangent = Vector((-math.sin(angle), math.cos(angle), 0.0))
        attach_t = 0.30 + (i % 4) * 0.055 + rng.uniform(-0.025, 0.025)
        start = Vector((lean.x * attach_t, lean.y * attach_t, height * attach_t))
        reach = canopy_w * rng.uniform(0.34, 0.46)
        lift = height * rng.uniform(0.16, 0.27)
        elbow = start + radial * reach * 0.52 + tangent * rng.uniform(-0.05, 0.05) * canopy_w
        elbow.z += lift * 0.46
        tip = start + radial * reach + tangent * rng.uniform(-0.08, 0.08) * canopy_w
        tip.z += lift
        branch_radius = trunk_r * rng.uniform(0.34, 0.48)
        bark_parts.append(tapered_limb(
            f"Limb_{i:02d}_A", start, elbow, branch_radius, branch_radius * 0.67, verts=8,
        ))
        bark_parts.append(tapered_limb(
            f"Limb_{i:02d}_B", elbow, tip, branch_radius * 0.68, branch_radius * 0.22, verts=7,
        ))
        crown_tips.append((tip, angle))

        inner_center = elbow.lerp(tip, rng.uniform(0.02, 0.18))
        inner_center.z += height * rng.uniform(0.025, 0.055)
        leaf_parts.append(organic_lobe(
            f"LeafInner_{i:02d}", rng, inner_center,
            (canopy_w * rng.uniform(0.09, 0.12), canopy_d * rng.uniform(0.075, 0.105), height * 0.058),
            subdiv=1, roughness=0.18, yaw=angle + rng.uniform(-0.38, 0.38),
        ))

        # Every other limb forks beyond the central crown. The small offset pad
        # gives branching rhythm without sealing all the negative space.
        if i % 2 == 0:
            fork_dir = (radial * 0.55 + tangent * rng.choice((-1.0, 1.0)) * 0.48).normalized()
            fork_tip = elbow + fork_dir * reach * rng.uniform(0.42, 0.58)
            fork_tip.z += height * rng.uniform(0.10, 0.17)
            bark_parts.append(tapered_limb(
                f"Fork_{i:02d}", elbow, fork_tip,
                branch_radius * 0.48, branch_radius * 0.13, verts=7,
            ))
            fork_lobe = organic_lobe(
                f"LeafFork_{i:02d}", rng, fork_tip,
                (canopy_w * 0.105, canopy_d * 0.095, height * 0.060),
                subdiv=1, roughness=0.18, yaw=angle + rng.uniform(-0.4, 0.4),
            )
            leaf_parts.append(fork_lobe)

    # Branch-end foliage pads leave air between masses; they do not overlap into
    # the old spherical crown. Slight size variation avoids a scalloped ring.
    for i, (tip, angle) in enumerate(crown_tips):
        radial = Vector((math.cos(angle), math.sin(angle), 0.0))
        tangent = Vector((-math.sin(angle), math.cos(angle), 0.0))
        for cluster in range(2):
            center = tip.copy()
            if cluster:
                center += tangent * rng.choice((-1.0, 1.0)) * canopy_d * rng.uniform(0.075, 0.12)
                center -= radial * canopy_w * rng.uniform(0.015, 0.055)
                center.z += height * rng.uniform(-0.015, 0.045)
            lobe = organic_lobe(
                f"LeafPad_{i:02d}_{cluster:02d}", rng, center,
                (canopy_w * rng.uniform(0.105, 0.15),
                 canopy_d * rng.uniform(0.09, 0.135),
                 height * rng.uniform(0.058, 0.082)),
                subdiv=2 if cluster == 0 and i % 4 == 0 else 1,
                roughness=0.17 + openness * 0.045,
                yaw=angle + rng.uniform(-0.42, 0.42),
                pitch=rng.uniform(-0.15, 0.15),
            )
            leaf_parts.append(lobe)

    # A split crown, instead of a centered ball, resolves as a mature tree from
    # the player camera and keeps a narrow cleft through the upper silhouette.
    crown_angle = branch_phase + math.pi * 0.5
    for i in range(4):
        angle = crown_angle + i * math.tau / 4.0 + rng.uniform(-0.2, 0.2)
        loc = lean + Vector((math.cos(angle), math.sin(angle), 0.0)) * canopy_w * rng.uniform(0.06, 0.14)
        loc.z = height * rng.uniform(0.82, 0.91)
        bark_parts.append(tapered_limb(
            f"CrownLimb_{i:02d}", trunk_nodes[-1], loc,
            trunk_r * 0.18, trunk_r * 0.045, verts=6,
        ))
        leaf_parts.append(organic_lobe(
            f"Crown_{i:02d}", rng, loc,
            (canopy_w * rng.uniform(0.10, 0.14), canopy_d * rng.uniform(0.09, 0.13), height * 0.07),
            subdiv=1, roughness=0.19, yaw=angle + rng.uniform(-0.3, 0.3),
        ))

    for obj in bark_parts:
        set_colors(obj, bark_fn)
        shade(obj, smooth=True)
    for obj in leaf_parts:
        set_colors(obj, leaf_fn)
        shade(obj, smooth=True)
    tree = join(bark_parts + leaf_parts, vid)
    return bake_rebase_and_size(
        tree, target_height=height, target_width=canopy_w, target_depth=canopy_d,
    )


def build_hero_conifer(vid, rng, *, height, base_w, canopy_d, tiers, arms,
                       leaf_hsv, lower_clear=0.18, droop=0.04):
    """Whorled limbs and needle pads replace the former stack of solid cones."""
    seed = stable_seed(vid)
    bark_fn = hero_bark_palette(height, seed, base=(0.29, 0.19, 0.105))
    leaf_fn = leaf_palette(leaf_hsv, height, seed)
    bark_parts = []
    leaf_parts = []

    trunk_r = base_w * 0.065
    trunk_top = height * 0.93
    trunk_nodes = (
        Vector((0.0, 0.0, 0.0)),
        Vector((height * 0.006, -height * 0.004, trunk_top * 0.48)),
        Vector((-height * 0.004, height * 0.006, trunk_top)),
    )
    bark_parts.append(tapered_limb("Trunk_00", trunk_nodes[0], trunk_nodes[1], trunk_r, trunk_r * 0.55, verts=9))
    bark_parts.append(tapered_limb("Trunk_01", trunk_nodes[1], trunk_nodes[2], trunk_r * 0.56, trunk_r * 0.12, verts=8))

    tier_phase = rng.uniform(0.0, math.tau)
    for tier in range(tiers):
        t = tier / max(1, tiers - 1)
        z = height * (lower_clear + t * 0.61) + rng.uniform(-0.016, 0.016) * height
        radius = base_w * (0.46 - 0.31 * t) * rng.uniform(0.91, 1.07)
        tier_arms = max(3, arms - (1 if tier == tiers - 1 else 0))
        phase = tier_phase + tier * 0.63 + rng.uniform(-0.18, 0.18)
        for arm in range(tier_arms):
            angle = phase + arm * math.tau / tier_arms + rng.uniform(-0.12, 0.12)
            radial = Vector((math.cos(angle), math.sin(angle), 0.0))
            tangent = Vector((-math.sin(angle), math.cos(angle), 0.0))
            arm_z = z + rng.uniform(-0.022, 0.022) * height
            arm_radius = radius * rng.uniform(0.86, 1.12)
            start = Vector((0.0, 0.0, arm_z))
            tip = start + radial * arm_radius + tangent * rng.uniform(-0.055, 0.055) * base_w
            tip.z -= height * droop * 1.4 * (1.0 - t)
            limb_r = trunk_r * (0.34 - 0.13 * t)
            bark_parts.append(tapered_limb(
                f"Whorl_{tier:02d}_{arm:02d}", start, tip, limb_r, limb_r * 0.10, verts=7,
            ))

            # Two compact sprays follow each woody limb. This reads as layered
            # boughs (not a diamond paddle) while keeping daylight between tiers.
            for spray in range(2):
                along = 0.38 if spray == 0 else 0.76
                spray_center = start.lerp(tip, along)
                spray_center += tangent * base_w * rng.uniform(-0.025, 0.025)
                spray_center.z += height * rng.uniform(0.002, 0.014)
                leaf_parts.append(organic_lobe(
                    f"Spray_{tier:02d}_{arm:02d}_{spray:02d}", rng, spray_center,
                    (arm_radius * rng.uniform(0.20, 0.27),
                     base_w * (0.075 + 0.022 * (1.0 - t)),
                     height * (0.030 + 0.009 * (1.0 - t))),
                    subdiv=1, roughness=0.15, yaw=angle + rng.uniform(-0.18, 0.18),
                ))

        # Small core needles hide the branch junction without joining adjacent
        # tiers into a solid cone.
        leaf_parts.append(organic_lobe(
            f"Core_{tier:02d}", rng, (0.0, 0.0, z + height * 0.006),
            (base_w * (0.12 - 0.045 * t), base_w * (0.11 - 0.04 * t), height * 0.035),
            subdiv=1, roughness=0.14, yaw=phase,
        ))

    # Narrow irregular leader tufts finish the top without a cone cap.
    for i in range(3):
        z = height * (0.78 + i * 0.075)
        loc = Vector((rng.uniform(-0.025, 0.025) * base_w, rng.uniform(-0.025, 0.025) * base_w, z))
        leaf_parts.append(organic_lobe(
            f"Leader_{i:02d}", rng, loc,
            (base_w * (0.12 - i * 0.018), base_w * (0.10 - i * 0.012), height * 0.075),
            subdiv=1, roughness=0.13, yaw=rng.uniform(0.0, math.tau),
        ))

    for obj in bark_parts:
        set_colors(obj, bark_fn)
        shade(obj, smooth=True)
    for obj in leaf_parts:
        set_colors(obj, leaf_fn)
        shade(obj, smooth=False)
    tree = join(bark_parts + leaf_parts, vid)
    return bake_rebase_and_size(
        tree, target_height=height, target_width=base_w, target_depth=canopy_d,
    )


def build_hero_shrub(vid, rng, *, width, depth, height, leaf_hsv, branches=7):
    """Twig-supported shrub with small leaf pads and visible interior gaps."""
    seed = stable_seed(vid)
    bark_fn = hero_bark_palette(height, seed, base=(0.25, 0.17, 0.095))
    leaf_fn = leaf_palette(leaf_hsv, height, seed)
    bark_parts = []
    leaf_parts = []
    phase = rng.uniform(0.0, math.tau)
    for i in range(branches):
        angle = phase + i * math.tau / branches + rng.uniform(-0.28, 0.28)
        radial = Vector((math.cos(angle), math.sin(angle), 0.0))
        start = Vector((rng.uniform(-0.04, 0.04) * width, rng.uniform(-0.04, 0.04) * depth, 0.02))
        reach = width * rng.uniform(0.22, 0.42)
        tip = start + Vector((radial.x * reach, radial.y * reach * depth / width, height * rng.uniform(0.52, 0.91)))
        elbow = start.lerp(tip, 0.52)
        elbow += Vector((-radial.y, radial.x, 0.0)) * rng.uniform(-0.04, 0.04) * width
        bark_parts.append(tapered_limb(f"Twig_{i:02d}_A", start, elbow, height * 0.025, height * 0.014, verts=6))
        bark_parts.append(tapered_limb(f"Twig_{i:02d}_B", elbow, tip, height * 0.015, height * 0.005, verts=5))
        leaf_parts.append(organic_lobe(
            f"LeafPad_{i:02d}", rng, tip,
            (width * rng.uniform(0.14, 0.19), depth * rng.uniform(0.14, 0.20), height * rng.uniform(0.14, 0.20)),
            subdiv=1, roughness=0.20, yaw=angle + rng.uniform(-0.35, 0.35),
        ))
    for obj in bark_parts:
        set_colors(obj, bark_fn)
        shade(obj, smooth=True)
    for obj in leaf_parts:
        set_colors(obj, leaf_fn)
        shade(obj, smooth=True)
    shrub = join(bark_parts + leaf_parts, vid)
    return bake_rebase_and_size(shrub, target_height=height, target_width=width, target_depth=depth)


def build_hero_rock(vid, rng, *, width, depth, height, tone=(0.43, 0.42, 0.36)):
    """Warm, fractured course rock with a stable flat ground contact."""
    seed = stable_seed(vid)
    rock = ico(vid, 1.0, (0.0, 0.0, 0.0), subdiv=2)
    offset = Vector((rng.random() * 23.0, rng.random() * 37.0, rng.random() * 17.0))
    for vertex in rock.data.vertices:
        direction = vertex.co.normalized()
        wobble = noise.noise(vertex.co * 1.35 + offset) * 0.22
        vertex.co *= 1.0 + wobble
        vertex.co.x += direction.z * width * 0.035
        if vertex.co.z < -0.18:
            vertex.co.z = -0.18 + (vertex.co.z + 0.18) * 0.08
    rock.scale = (width * 0.5, depth * 0.5, height * 0.68)
    bpy.context.view_layer.objects.active = rock
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    set_colors(rock, rock_palette(height, seed, base=tone))
    shade(rock, smooth=False)
    return bake_rebase_and_size(rock, target_height=height, target_width=width, target_depth=depth)


# --------------------------------------------------------- LOD proxy builders --

def build_proxy_deciduous(vid, rng, *, height, canopy_w, canopy_d, trunk_r,
                          branches, leaf_hsv, bark_base=(0.34, 0.225, 0.13)):
    """Low-cost parkland silhouette sharing the hero kit's visible branching."""
    seed = stable_seed(vid)
    bark_fn = hero_bark_palette(height, seed, base=bark_base)
    leaf_fn = leaf_palette(leaf_hsv, height, seed)
    bark_parts = []
    leaf_parts = []

    lean_angle = rng.uniform(0.0, math.tau)
    lean = Vector((math.cos(lean_angle), math.sin(lean_angle), 0.0)) * height * rng.uniform(0.018, 0.035)
    trunk_nodes = (
        Vector((0.0, 0.0, 0.0)),
        Vector((lean.x * 0.35, lean.y * 0.35, height * 0.38)),
        Vector((lean.x, lean.y, height * 0.64)),
    )
    bark_parts.append(tapered_limb(
        "Trunk_00", trunk_nodes[0], trunk_nodes[1], trunk_r, trunk_r * 0.58, verts=5,
    ))
    bark_parts.append(tapered_limb(
        "Trunk_01", trunk_nodes[1], trunk_nodes[2], trunk_r * 0.59, trunk_r * 0.24, verts=4,
    ))

    phase = rng.uniform(0.0, math.tau)
    for i in range(branches):
        angle = phase + i * math.tau / branches + rng.uniform(-0.22, 0.22)
        radial = Vector((math.cos(angle), math.sin(angle), 0.0))
        tangent = Vector((-math.sin(angle), math.cos(angle), 0.0))
        attach = 0.34 + (i % 3) * 0.055 + rng.uniform(-0.018, 0.018)
        start = Vector((lean.x * attach, lean.y * attach, height * attach))
        reach = canopy_w * rng.uniform(0.36, 0.46)
        tip = start + radial * reach + tangent * canopy_d * rng.uniform(-0.045, 0.045)
        tip.z += height * rng.uniform(0.20, 0.30)
        bark_parts.append(tapered_limb(
            f"Limb_{i:02d}", start, tip,
            trunk_r * rng.uniform(0.28, 0.38), trunk_r * 0.055, verts=4,
        ))
        leaf_parts.append(organic_lobe(
            f"LeafTip_{i:02d}", rng, tip,
            (canopy_w * rng.uniform(0.170, 0.220), canopy_d * rng.uniform(0.150, 0.190),
             height * rng.uniform(0.090, 0.110)),
            subdiv=1, roughness=0.19, yaw=angle + rng.uniform(-0.32, 0.32),
        ))

    crown_phase = phase + math.pi * 0.35
    for i in range(2):
        angle = crown_phase + i * math.pi + rng.uniform(-0.15, 0.15)
        loc = lean + Vector((math.cos(angle), math.sin(angle), 0.0)) * canopy_w * rng.uniform(0.04, 0.10)
        loc.z = height * rng.uniform(0.83, 0.90)
        bark_parts.append(tapered_limb(
            f"CrownLimb_{i:02d}", trunk_nodes[-1], loc, trunk_r * 0.15, trunk_r * 0.035, verts=4,
        ))
        leaf_parts.append(organic_lobe(
            f"Crown_{i:02d}", rng, loc,
            (canopy_w * rng.uniform(0.150, 0.190), canopy_d * rng.uniform(0.135, 0.180),
             height * rng.uniform(0.085, 0.105)),
            subdiv=1, roughness=0.19, yaw=angle,
        ))

    for obj in bark_parts:
        set_colors(obj, bark_fn)
        shade(obj, smooth=True)
    for obj in leaf_parts:
        set_colors(obj, leaf_fn)
        shade(obj, smooth=True)
    tree = join(bark_parts + leaf_parts, vid)
    return bake_rebase_and_size(
        tree, target_height=height, target_width=canopy_w, target_depth=canopy_d,
    )


def build_proxy_conifer(vid, rng, *, height, base_w, canopy_d, tiers, arms,
                        leaf_hsv, lower_clear=0.16, droop=0.035):
    """Sparse irregular boughs approximate hero conifers without cone stacks."""
    seed = stable_seed(vid)
    bark_fn = hero_bark_palette(height, seed, base=(0.29, 0.19, 0.105))
    leaf_fn = leaf_palette(leaf_hsv, height, seed)
    bark_parts = []
    leaf_parts = []
    trunk_r = base_w * 0.060
    trunk_nodes = (
        Vector((0.0, 0.0, 0.0)),
        Vector((height * 0.004, -height * 0.003, height * 0.52)),
        Vector((-height * 0.003, height * 0.004, height * 0.93)),
    )
    bark_parts.append(tapered_limb(
        "Trunk_00", trunk_nodes[0], trunk_nodes[1], trunk_r, trunk_r * 0.52, verts=7,
    ))
    bark_parts.append(tapered_limb(
        "Trunk_01", trunk_nodes[1], trunk_nodes[2], trunk_r * 0.53, trunk_r * 0.10, verts=6,
    ))

    phase = rng.uniform(0.0, math.tau)
    for tier in range(tiers):
        t = tier / max(1, tiers - 1)
        z = height * (lower_clear + t * 0.62) + rng.uniform(-0.015, 0.015) * height
        tier_arms = max(1, arms + (1 if tier == 0 else 0) - (1 if tier == tiers - 1 else 0))
        radius = base_w * (0.47 - 0.31 * t)
        tier_phase = phase + tier * 0.71 + rng.uniform(-0.16, 0.16)
        for arm in range(tier_arms):
            angle = tier_phase + arm * math.tau / tier_arms + rng.uniform(-0.13, 0.13)
            radial = Vector((math.cos(angle), math.sin(angle), 0.0))
            tangent = Vector((-math.sin(angle), math.cos(angle), 0.0))
            arm_radius = radius * rng.uniform(0.84, 1.12)
            start = Vector((0.0, 0.0, z + rng.uniform(-0.018, 0.018) * height))
            tip = start + radial * arm_radius + tangent * base_w * rng.uniform(-0.04, 0.04)
            tip.z -= height * droop * (1.2 - 0.5 * t)
            bark_parts.append(tapered_limb(
                f"Bough_{tier:02d}_{arm:02d}", start, tip,
                trunk_r * (0.29 - 0.10 * t), trunk_r * 0.045, verts=5,
            ))
            inner_pad = start.lerp(tip, rng.uniform(0.34, 0.43))
            inner_pad += tangent * base_w * rng.uniform(-0.025, 0.025)
            inner_pad.z += height * 0.008
            leaf_parts.append(organic_octa_lobe(
                f"NeedlesInner_{tier:02d}_{arm:02d}", rng, inner_pad,
                (arm_radius * rng.uniform(0.16, 0.21), base_w * (0.072 + 0.014 * (1.0 - t)),
                 height * (0.027 + 0.006 * (1.0 - t))),
                yaw=angle + rng.uniform(-0.12, 0.12),
            ))
            pad = start.lerp(tip, rng.uniform(0.72, 0.80))
            pad.z += height * 0.008
            leaf_parts.append(organic_lobe(
                f"Needles_{tier:02d}_{arm:02d}", rng, pad,
                (arm_radius * rng.uniform(0.31, 0.38), base_w * (0.098 + 0.020 * (1.0 - t)),
                 height * (0.038 + 0.008 * (1.0 - t))),
                subdiv=1, roughness=0.15, yaw=angle + rng.uniform(-0.14, 0.14),
            ))
        leaf_parts.append(organic_lobe(
            f"Core_{tier:02d}", rng, (0.0, 0.0, z + height * 0.008),
            (base_w * (0.105 - 0.035 * t), base_w * (0.095 - 0.03 * t), height * 0.034),
            subdiv=1, roughness=0.14, yaw=tier_phase,
        ))

    for i in range(2):
        loc = Vector((rng.uniform(-0.018, 0.018) * base_w, rng.uniform(-0.018, 0.018) * base_w,
                      height * (0.83 + i * 0.09)))
        leaf_parts.append(organic_lobe(
            f"Leader_{i:02d}", rng, loc,
            (base_w * (0.09 - i * 0.015), base_w * (0.08 - i * 0.01), height * 0.066),
            subdiv=1, roughness=0.14, yaw=rng.uniform(0.0, math.tau),
        ))

    for obj in bark_parts:
        set_colors(obj, bark_fn)
        shade(obj, smooth=True)
    for obj in leaf_parts:
        set_colors(obj, leaf_fn)
        shade(obj, smooth=False)
    tree = join(bark_parts + leaf_parts, vid)
    return bake_rebase_and_size(
        tree, target_height=height, target_width=base_w, target_depth=canopy_d,
    )


def build_far_conifer(vid, rng, *, height, base_w, canopy_d, tiers, arms,
                      leaf_hsv, lower_clear=0.15, droop=0.03):
    """Broad irregular horizon evergreen built from overlapping faceted skirts."""
    seed = stable_seed(vid)
    bark_fn = hero_bark_palette(height, seed, base=(0.29, 0.19, 0.105))
    leaf_fn = leaf_palette(leaf_hsv, height, seed)
    bark_parts = []
    leaf_parts = []
    trunk_r = base_w * 0.050
    bend = Vector((rng.uniform(-0.012, 0.012) * height, rng.uniform(-0.012, 0.012) * height, 0.0))
    trunk_nodes = (
        Vector((0.0, 0.0, 0.0)),
        Vector((bend.x * 0.42, bend.y * 0.42, height * 0.52)),
        Vector((bend.x, bend.y, height * 0.94)),
    )
    bark_parts.append(tapered_limb(
        "Trunk_00", trunk_nodes[0], trunk_nodes[1], trunk_r, trunk_r * 0.50, verts=5,
    ))
    bark_parts.append(tapered_limb(
        "Trunk_01", trunk_nodes[1], trunk_nodes[2], trunk_r * 0.51, trunk_r * 0.09, verts=4,
    ))

    skirt_specs = (
        (0.23, 0.27, 0.50, 0.50),
        (0.39, 0.26, 0.44, 0.44),
        (0.55, 0.24, 0.37, 0.38),
        (0.70, 0.22, 0.29, 0.31),
        (0.855, 0.24, 0.19, 0.22),
    )
    phase = rng.uniform(0.0, math.tau)
    for tier, (z_ratio, h_ratio, width_ratio, depth_ratio) in enumerate(skirt_specs):
        z = height * z_ratio
        loc = Vector((
            bend.x * z_ratio + rng.uniform(-0.035, 0.035) * base_w,
            bend.y * z_ratio + rng.uniform(-0.035, 0.035) * canopy_d,
            z,
        ))
        leaf_parts.append(irregular_canopy_skirt(
            f"CanopySkirt_{tier:02d}", rng, loc,
            (base_w * width_ratio, canopy_d * depth_ratio), height * h_ratio,
            yaw=phase + tier * 0.53 + rng.uniform(-0.16, 0.16), segments=5,
        ))

    for obj in bark_parts:
        set_colors(obj, bark_fn)
        shade(obj, smooth=True)
    for obj in leaf_parts:
        set_colors(obj, leaf_fn)
        shade(obj, smooth=False)
    tree = join(bark_parts + leaf_parts, vid)
    return bake_rebase_and_size(
        tree, target_height=height, target_width=base_w, target_depth=canopy_d,
    )


# ------------------------------------------------------------------- catalog ---

def V(vid, kind, builder, hmin, hmax, *, tri_budget=None, **kw):
    return {
        "id": vid, "kind": kind, "builder": builder, "h": (hmin, hmax),
        "tri_budget": tri_budget, "kw": kw,
    }


CATALOG = [
    # deciduous — leaf HSV around 0.24-0.31 (yellow-green .. green)
    V("oak_a", "deciduous", "hero_deciduous", 13, 17, tri_budget=1500,
      height=15.2, canopy_w=12.6, canopy_d=11.3, trunk_r=0.52,
      branches=7, leaf_hsv=(0.272, 0.58, 0.53), openness=0.68),
    V("oak_b", "deciduous", "hero_deciduous", 11, 14, tri_budget=1350,
      height=12.8, canopy_w=10.4, canopy_d=9.4, trunk_r=0.45,
      branches=6, leaf_hsv=(0.302, 0.62, 0.47), openness=0.60),
    V("maple_a", "deciduous", "hero_deciduous", 11, 14, tri_budget=1250,
      height=12.4, canopy_w=9.2, canopy_d=8.5, trunk_r=0.39,
      branches=5, leaf_hsv=(0.225, 0.61, 0.61), openness=0.56),
    V("birch_a", "deciduous", "proxy_deciduous", 10, 13, tri_budget=220,
      height=12.8, canopy_w=9.0, canopy_d=8.2, trunk_r=0.30, branches=3,
      leaf_hsv=(0.225, 0.57, 0.59), bark_base=(0.52, 0.44, 0.31)),
    V("shade_a", "deciduous", "hero_deciduous", 12, 15, tri_budget=1500,
      height=14.0, canopy_w=13.8, canopy_d=12.2, trunk_r=0.50,
      branches=7, leaf_hsv=(0.315, 0.65, 0.44), openness=0.75),
    V("flower_a", "ornamental", "deciduous", 5, 7, lobes=6, height=2.2, canopy_w=2.3, canopy_squash=0.86,
      trunk_r=0.08, leaf_hsv=(0.955, 0.30, 0.80), branches=2, subdiv=2, amp=0.24),
    # Hero-family LOD proxies: sparse branch structure, broad readable crowns.
    V("fill_a", "deciduous", "proxy_deciduous", 10, 15, tri_budget=220,
      height=13.8, canopy_w=10.8, canopy_d=9.8, trunk_r=0.44, branches=3,
      leaf_hsv=(0.272, 0.57, 0.52)),
    V("fill_b", "deciduous", "proxy_deciduous", 10, 15, tri_budget=240,
      height=12.8, canopy_w=11.0, canopy_d=9.8, trunk_r=0.43, branches=4,
      leaf_hsv=(0.305, 0.61, 0.46)),
    # evergreen
    V("pine_a", "evergreen", "hero_conifer", 14, 18, tri_budget=1600,
      tiers=5, arms=4, height=15.4, base_w=6.4, canopy_d=5.8,
      lower_clear=0.22, droop=0.020, leaf_hsv=(0.355, 0.64, 0.43)),
    V("pine_b", "evergreen", "proxy_conifer", 12, 15, tri_budget=750,
      tiers=4, arms=3, height=14.2, base_w=5.8, canopy_d=5.3,
      lower_clear=0.18, droop=0.028, leaf_hsv=(0.355, 0.62, 0.42)),
    V("pine_far", "evergreen", "far_conifer", 12, 16, tri_budget=180,
      tiers=4, arms=2, height=14.0, base_w=5.8, canopy_d=5.3,
      lower_clear=0.17, droop=0.030, leaf_hsv=(0.358, 0.60, 0.43)),
    V("spruce_a", "evergreen", "hero_conifer", 12, 16, tri_budget=1850,
      tiers=6, arms=4, height=13.8, base_w=5.8, canopy_d=5.5,
      lower_clear=0.13, droop=0.040, leaf_hsv=(0.382, 0.56, 0.40)),
    V("cedar_a", "evergreen", "proxy_conifer", 9, 12, tri_budget=650,
      tiers=5, arms=2, height=11.0, base_w=4.5, canopy_d=4.3,
      lower_clear=0.12, droop=0.035, leaf_hsv=(0.34, 0.56, 0.43)),
    # shrubs / ground
    V("shrub_round", "shrub", "hero_shrub", 1.4, 2.2, tri_budget=450,
      width=1.65, depth=1.5, height=1.15, branches=7, leaf_hsv=(0.31, 0.50, 0.54)),
    V("shrub_flower", "shrub", "shrub", 1.2, 1.8, lobes=3, width=1.4, height=1.0, leaf_hsv=(0.93, 0.22, 0.62), amp=0.24),
    V("bush_native", "shrub", "hero_shrub", 1.5, 2.6, tri_budget=500,
      width=2.0, depth=1.65, height=1.55, branches=8, leaf_hsv=(0.235, 0.52, 0.57)),
    V("reed_clump", "reed", "blades", 1.6, 2.4, blades=15, height=1.5, spread=0.5, hsv=(0.20, 0.5, 0.42), w=0.035),
    V("grass_clump", "reed", "blades", 0.9, 1.4, blades=12, height=0.8, spread=0.45, hsv=(0.23, 0.55, 0.4), tip_droop=0.5, w=0.05),
    # rocks
    V("rock_s", "rock", "hero_rock", 0.5, 0.9, tri_budget=100,
      width=0.68, depth=0.54, height=0.40, tone=(0.44, 0.425, 0.37)),
    V("rock_m", "rock", "hero_rock", 0.9, 1.6, tri_budget=100,
      width=1.12, depth=0.86, height=0.64, tone=(0.42, 0.405, 0.35)),
    V("boulder_a", "rock", "rock", 1.6, 2.8, width=1.6, height=1.1, tone=0.42, amp=0.55),
    V("shore_rock", "rock", "rock", 0.6, 1.2, width=1.1, height=0.45, tone=0.40, amp=0.34),
]


def build_variant(spec):
    reset_scene()
    rng = random.Random(stable_seed(spec["id"]))
    mat = vertex_color_material(f"M_{spec['id']}")
    b = spec["builder"]
    if b == "hero_deciduous":
        obj = build_hero_deciduous(spec["id"], rng, **spec["kw"])
    elif b == "hero_conifer":
        obj = build_hero_conifer(spec["id"], rng, **spec["kw"])
    elif b == "hero_shrub":
        obj = build_hero_shrub(spec["id"], rng, **spec["kw"])
    elif b == "hero_rock":
        obj = build_hero_rock(spec["id"], rng, **spec["kw"])
    elif b == "proxy_deciduous":
        obj = build_proxy_deciduous(spec["id"], rng, **spec["kw"])
    elif b == "proxy_conifer":
        obj = build_proxy_conifer(spec["id"], rng, **spec["kw"])
    elif b == "far_conifer":
        obj = build_far_conifer(spec["id"], rng, **spec["kw"])
    elif b == "deciduous":
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
    while obj.data.uv_layers:
        obj.data.uv_layers.remove(obj.data.uv_layers[0])
    if spec["kind"] == "reed":
        mat.use_backface_culling = False
    # New-kit builders already do this; repeating the pass also repairs every
    # legacy catalog asset when the complete kit is regenerated.
    world_points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    world_x = [point.x for point in world_points]
    world_y = [point.y for point in world_points]
    world_z = [point.z for point in world_points]
    bake_rebase_and_size(
        obj,
        target_width=max(world_x) - min(world_x),
        target_depth=max(world_y) - min(world_y),
        target_height=max(world_z) - min(world_z),
    )
    obj.name = spec["id"]
    obj.data.name = f"{spec['id']}_Mesh"
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if spec.get("tri_budget") is not None and tris > spec["tri_budget"]:
        raise RuntimeError(f"{spec['id']} exceeds triangle budget: {tris} > {spec['tri_budget']}")
    dimensions = mesh_dimensions(obj)
    obj["asset_id"] = spec["id"]
    obj["source_dimensions_m"] = dimensions
    obj["triangle_count"] = tris
    obj["origin_policy"] = "ground-contact center at 0,0,0"
    obj["asset_origin"] = ASSET_ORIGIN

    SRC_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
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
    print(
        f"BUILT|{spec['id']}|tris={tris}|"
        f"dimensions_m={dimensions[0]:.3f},{dimensions[1]:.3f},{dimensions[2]:.3f}|glb={glb}"
    )
    entry = {
        "id": spec["id"], "kind": spec["kind"],
        "height": list(spec["h"]), "tris": tris,
        "triangle_budget": spec.get("tri_budget"),
        "source_dimensions_m": [round(value, 4) for value in dimensions],
        "source_blend": f"asset_sources/blender/flora/{spec['id']}.blend",
        "glb": f"vendor/models/flora/{spec['id']}.glb",
        "mesh_count": 1, "material_count": 1,
        "vertex_color_attribute": "Col",
        "origin": [0.0, 0.0, 0.0],
    }
    if spec["id"] in PROXY_TARGETS:
        entry["lod_proxy_for"] = PROXY_TARGETS[spec["id"]]
    return entry


def imported_meshes(glb):
    bpy.ops.import_scene.gltf(filepath=str(glb))
    return [obj for obj in bpy.context.selected_objects if obj.type == "MESH"]


def reimport_metrics(spec, expected):
    """Reimport the shipped GLB and validate its runtime-relevant contract."""
    reset_scene()
    glb = OUT_DIR / f"{spec['id']}.glb"
    meshes = imported_meshes(glb)
    scene_objects = list(bpy.context.scene.objects)
    bpy.context.view_layer.update()
    points = []
    tris = 0
    material_names = set()
    color_attributes = set()
    finite = True
    origin_error = 0.0
    rotation_error = 0.0
    scale_error = 0.0
    image_texture_nodes = 0
    uv_layer_count = 0
    for obj in meshes:
        world = obj.matrix_world
        origin_error = max(origin_error, world.translation.length)
        rotation_error = max(rotation_error, abs(world.to_quaternion().angle))
        world_scale = world.to_scale()
        scale_error = max(scale_error, *(abs(world_scale[i] - 1.0) for i in range(3)))
        for vertex in obj.data.vertices:
            point = world @ vertex.co
            points.append(point)
            finite = finite and all(math.isfinite(value) for value in point)
        tris += sum(len(poly.vertices) - 2 for poly in obj.data.polygons)
        material_names.update(mat.name for mat in obj.data.materials if mat)
        color_attributes.update(attr.name for attr in obj.data.color_attributes)
        uv_layer_count += len(obj.data.uv_layers)
        for mat in obj.data.materials:
            if mat and mat.use_nodes:
                image_texture_nodes += sum(node.type == "TEX_IMAGE" for node in mat.node_tree.nodes)
    if points:
        bounds_min = [min(point[i] for point in points) for i in range(3)]
        bounds_max = [max(point[i] for point in points) for i in range(3)]
        dimensions = [bounds_max[i] - bounds_min[i] for i in range(3)]
    else:
        bounds_min = bounds_max = dimensions = [0.0, 0.0, 0.0]
    center_error = max(abs((bounds_min[0] + bounds_max[0]) * 0.5), abs((bounds_min[1] + bounds_max[1]) * 0.5))
    dimensions_error = max(
        abs(dimensions[i] - expected["source_dimensions_m"][i]) for i in range(3)
    )
    checks = {
        "single_mesh": len(meshes) == 1,
        "single_material": len(material_names) == 1,
        "vertex_colors": bool(color_attributes),
        "triangle_match": tris == expected["tris"],
        "within_triangle_budget": spec.get("tri_budget") is None or tris <= spec["tri_budget"],
        "finite_vertices": finite,
        "ground_contact": abs(bounds_min[2]) <= 0.001,
        "centered_origin": center_error <= 0.001,
        "exported_origin_zero": origin_error <= 0.001,
        "rotation_scale_applied": rotation_error <= 0.0001 and scale_error <= 0.0001,
        "dimensions_roundtrip": dimensions_error <= 0.002,
        "no_cameras_or_lights": not any(obj.type in {"CAMERA", "LIGHT"} for obj in scene_objects),
        "no_textures_or_uvs": len(bpy.data.images) == 0 and image_texture_nodes == 0 and uv_layer_count == 0,
    }
    return {
        "id": spec["id"],
        "glb": str(glb.relative_to(ROOT)).replace("\\", "/"),
        "status": "pass" if all(checks.values()) else "fail",
        "checks": checks,
        "mesh_count": len(meshes),
        "material_count": len(material_names),
        "materials": sorted(material_names),
        "color_attributes": sorted(color_attributes),
        "tris": tris,
        "triangle_budget": spec.get("tri_budget"),
        "bounds_m": {
            "min": [round(value, 5) for value in bounds_min],
            "max": [round(value, 5) for value in bounds_max],
        },
        "dimensions_m": [round(value, 5) for value in dimensions],
        "dimension_error_m": round(dimensions_error, 6),
        "base_error_m": round(abs(bounds_min[2]), 6),
        "horizontal_center_error_m": round(center_error, 6),
        "object_origin_error_m": round(origin_error, 6),
        "object_rotation_error_rad": round(rotation_error, 6),
        "object_scale_error": round(scale_error, 6),
        "scene_object_count": len(scene_objects),
        "camera_count": sum(obj.type == "CAMERA" for obj in scene_objects),
        "light_count": sum(obj.type == "LIGHT" for obj in scene_objects),
        "image_count": len(bpy.data.images),
        "image_texture_node_count": image_texture_nodes,
        "uv_layer_count": uv_layer_count,
        "file_bytes": glb.stat().st_size,
        "sha256": hashlib.sha256(glb.read_bytes()).hexdigest(),
    }


def validate_exports(specs, expected_by_id, *, label="hero"):
    QA_DIR.mkdir(parents=True, exist_ok=True)
    results = [reimport_metrics(spec, expected_by_id[spec["id"]]) for spec in specs]
    if label == "proxy":
        for result in results:
            legacy = PROXY_LEGACY_BASELINE[result["id"]]
            result["legacy_baseline"] = legacy
            result["change_from_legacy"] = {
                "tris": result["tris"] - legacy["tris"],
                "dimensions_m": [
                    round(result["dimensions_m"][axis] - legacy["dimensions_m"][axis], 5)
                    for axis in range(3)
                ],
                "base_z_m": round(result["bounds_m"]["min"][2] - legacy["base_z_m"], 5),
            }
    report = {
        "pipeline_version": PIPELINE_VERSION,
        "asset_origin": ASSET_ORIGIN,
        "selection": [spec["id"] for spec in specs],
        "status": "pass" if all(result["status"] == "pass" for result in results) else "fail",
        "requirements": {
            "mesh": "one mesh per GLB",
            "material": "one vertex-color material per GLB",
            "pivot": "ground-contact center at local origin",
            "transforms": "applied; exported scale 1 and rotation 0",
            "collision": "runtime analytic tree/obstacle collision; no mesh proxy exported",
            "uv": "not applicable: textureless vertex-color assets",
            "export_exclusions": "no cameras, lights, images, texture nodes, or UV layers",
        },
        "assets": results,
    }
    path = QA_DIR / f"{label}_flora_reimport_report.json"
    path.write_text(json.dumps(report, indent=2), encoding="utf8")
    print(f"VALIDATE|{path}|status={report['status']}|assets={len(results)}")
    if report["status"] != "pass":
        failures = [result["id"] for result in results if result["status"] != "pass"]
        raise RuntimeError(f"GLB reimport validation failed: {', '.join(failures)}")
    return report


def display_import(glb, location, *, display_height=None, uniform_scale=None):
    meshes = imported_meshes(glb)
    if len(meshes) != 1:
        raise RuntimeError(f"contact-sheet import expected one mesh: {glb}")
    obj = meshes[0]
    world = obj.matrix_world.copy()
    for vertex in obj.data.vertices:
        vertex.co = world @ vertex.co
    obj.matrix_world = Matrix.Identity(4)
    dims = mesh_dimensions(obj)
    scale = uniform_scale if uniform_scale is not None else display_height / max(0.001, dims[2])
    for vertex in obj.data.vertices:
        vertex.co *= scale
    xs = [vertex.co.x for vertex in obj.data.vertices]
    ys = [vertex.co.y for vertex in obj.data.vertices]
    zs = [vertex.co.z for vertex in obj.data.vertices]
    shift = Vector((location[0] - (min(xs) + max(xs)) * 0.5,
                    location[1] - (min(ys) + max(ys)) * 0.5,
                    -min(zs)))
    for vertex in obj.data.vertices:
        vertex.co += shift
    obj.data.update()
    return obj


def qa_material(name, color, *, roughness=0.9, emission=None):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        try:
            bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
            bsdf.inputs["Emission Strength"].default_value = 0.35
        except KeyError:
            pass
    return mat


def add_label(body, location, size, material):
    bpy.ops.object.text_add(location=location, rotation=(math.radians(90), 0.0, 0.0))
    label = bpy.context.active_object
    label.data.body = body
    label.data.align_x = "CENTER"
    label.data.align_y = "CENTER"
    label.data.size = size
    label.data.space_line = 0.82
    label.data.extrude = 0.004
    label.data.materials.append(material)
    if hasattr(label, "visible_shadow"):
        label.visible_shadow = False
    return label


def configure_qa_scene(*, camera_location, camera_target, resolution, output_path, floor_size,
                       orthographic_scale=None):
    scene = bpy.context.scene
    world = bpy.data.worlds.new("QA_World")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs[0].default_value = (0.16, 0.20, 0.17, 1.0)
    background.inputs[1].default_value = 0.65
    scene.world = world

    ground_mat = qa_material("QA_Ground", (0.115, 0.17, 0.085), roughness=0.96)
    bpy.ops.mesh.primitive_plane_add(size=floor_size, location=(0.0, 0.0, -0.012))
    bpy.context.active_object.data.materials.append(ground_mat)

    sun_data = bpy.data.lights.new("QA_Sun", "SUN")
    sun_data.energy = 2.4
    sun_data.angle = math.radians(8.0)
    sun = bpy.data.objects.new("QA_Sun", sun_data)
    sun.rotation_euler = (math.radians(48.0), math.radians(-18.0), math.radians(-34.0))
    bpy.context.collection.objects.link(sun)
    area_data = bpy.data.lights.new("QA_Fill", "AREA")
    area_data.energy = 850.0
    area_data.shape = "DISK"
    area_data.size = 8.0
    area = bpy.data.objects.new("QA_Fill", area_data)
    area.location = (-8.0, -10.0, 14.0)
    area.rotation_euler = (Vector((0.0, 0.0, 3.0)) - area.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(area)

    camera_data = bpy.data.cameras.new("QA_Camera")
    camera_data.lens = 53
    if orthographic_scale is not None:
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = orthographic_scale
    camera = bpy.data.objects.new("QA_Camera", camera_data)
    camera.location = camera_location
    camera.rotation_euler = (Vector(camera_target) - Vector(camera_location)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output_path)
    scene.render.film_transparent = False
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    bpy.ops.render.render(write_still=True)
    print(f"RENDER|{output_path}")


def render_contact_sheets(metrics_by_id):
    """Player-readable silhouette, branching, palette, and ground-contact QA."""
    QA_DIR.mkdir(parents=True, exist_ok=True)
    text_color = (0.84, 0.79, 0.61)

    reset_scene()
    label_mat = qa_material("QA_Label", text_color, roughness=0.8, emission=text_color)
    tree_ids = HERO_IDS[:6]
    for index, asset_id in enumerate(tree_ids):
        x = (index - 2.5) * 7.25
        y = 0.0
        display_import(OUT_DIR / f"{asset_id}.glb", (x, y), display_height=7.4)
        metrics = metrics_by_id[asset_id]
        dims = metrics["source_dimensions_m"]
        add_label(
            f"{asset_id}\n{dims[2]:.1f} m high  |  {metrics['tris']} tris",
            (x, y - 1.55, 0.45), 0.28, label_mat,
        )
    configure_qa_scene(
        camera_location=(0.0, -35.0, 7.2), camera_target=(0.0, 0.0, 3.6),
        resolution=(2400, 700), output_path=QA_DIR / "hero_trees_contact_sheet.png", floor_size=44.0,
        orthographic_scale=45.0,
    )

    reset_scene()
    label_mat = qa_material("QA_Label", text_color, roughness=0.8, emission=text_color)
    support_ids = HERO_IDS[6:]
    for index, asset_id in enumerate(support_ids):
        x = (index - 1.5) * 3.25
        display_import(OUT_DIR / f"{asset_id}.glb", (x, 0.0), uniform_scale=2.1)
        metrics = metrics_by_id[asset_id]
        dims = metrics["source_dimensions_m"]
        add_label(
            f"{asset_id}\n{dims[0]:.2f} x {dims[1]:.2f} x {dims[2]:.2f} m  |  {metrics['tris']} tris",
            (x, -1.22, 0.25), 0.18, label_mat,
        )
    configure_qa_scene(
        camera_location=(0.0, -14.0, 3.4), camera_target=(0.0, 0.0, 1.1),
        resolution=(1800, 720), output_path=QA_DIR / "h1_support_flora_contact_sheet.png", floor_size=16.0,
        orthographic_scale=13.5,
    )


def render_proxy_contact_sheet(metrics_by_id):
    """Normalized silhouette preview for the five runtime LOD families."""
    QA_DIR.mkdir(parents=True, exist_ok=True)
    text_color = (0.84, 0.79, 0.61)
    reset_scene()
    label_mat = qa_material("QA_Label", text_color, roughness=0.8, emission=text_color)
    for index, asset_id in enumerate(PROXY_IDS):
        x = (index - 2.5) * 6.2
        display_import(OUT_DIR / f"{asset_id}.glb", (x, 0.0), display_height=7.2)
        metrics = metrics_by_id[asset_id]
        dims = metrics["source_dimensions_m"]
        add_label(
            f"{asset_id}\n{dims[0]:.1f} x {dims[1]:.1f} x {dims[2]:.1f} m  |  {metrics['tris']} tris",
            (x, -1.55, 0.42), 0.24, label_mat,
        )
    configure_qa_scene(
        camera_location=(0.0, -32.0, 7.0), camera_target=(0.0, 0.0, 3.45),
        resolution=(2300, 760), output_path=QA_DIR / "proxy_flora_contact_sheet.png", floor_size=42.0,
        orthographic_scale=39.5,
    )


def main():
    if "proxy" in ARGV:
        selected_ids = set(PROXY_IDS)
        selection_label = "proxy"
    elif "hero" in ARGV:
        selected_ids = set(HERO_IDS)
        selection_label = "hero"
    else:
        selected_ids = {spec["id"] for spec in CATALOG}
        selection_label = "all"
    selected_specs = [spec for spec in CATALOG if spec["id"] in selected_ids]
    existing = {}
    manifest_path = OUT_DIR / "_manifest.json"
    if manifest_path.exists():
        existing_manifest = json.loads(manifest_path.read_text(encoding="utf8"))
        existing = {variant["id"]: variant for variant in existing_manifest.get("variants", [])}

    built = [build_variant(spec) for spec in selected_specs]
    built_by_id = {entry["id"]: entry for entry in built}
    variants = []
    for spec in CATALOG:
        if spec["id"] in built_by_id:
            variants.append(built_by_id[spec["id"]])
        elif spec["id"] in existing:
            variants.append(existing[spec["id"]])
        else:
            raise RuntimeError(f"missing unbuilt manifest entry for {spec['id']}")
    manifest = {
        "comment": "Course flora kit. Loader keeps authored vertex colors. Runtime heights are in yards; source dimensions are meters.",
        "pipeline_version": PIPELINE_VERSION,
        "asset_origin": ASSET_ORIGIN,
        "variants": variants,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf8")
    total = sum(int(variant["tris"]) for variant in variants)
    print(f"MANIFEST|{manifest_path}|variants={len(variants)}|tris_total={total}")

    if "validate" in ARGV:
        validate_exports(selected_specs, built_by_id, label=selection_label)
    if "render" in ARGV:
        if selection_label in {"hero", "all"}:
            render_contact_sheets(built_by_id)
        if selection_label in {"proxy", "all"}:
            render_proxy_contact_sheet(built_by_id)


main()
