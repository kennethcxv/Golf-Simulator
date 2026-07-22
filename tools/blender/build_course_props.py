"""Golf-course props production kit — flagstick, cup, tee markers, signage,
benches, ball washer, bunker rake, cart-path bridge (Pinehollow course dressing).

One GLB per asset to vendor/models/course/ plus _manifest.json listing every
shipped stem (the renderer only probes GLBs named in the manifest).  Composed
from lib_props (shared material/texture pipeline, export + QA render).

Run:
  "<blender>" --background --factory-startup --python tools/blender/build_course_props.py -- render
Optionally name asset ids after `--` to rebuild a subset:
  ... -- render flagstick bench_course

Convention: metres, Z up, base resting on Z=0, origin centred on the footprint,
-Y = front.  No collision proxies: the course loader draws every mesh in the GLB.
No real-world branding.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
import bmesh

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import lib_props as L

# CRITICAL: lib_props defaults to the clubhouse folder — course props live elsewhere.
L.EXPORT_DIR = L.ROOT / "vendor" / "models" / "course"

ARGV = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


# ==================================================================== materials ===

def course_mats():
    """Course-specific flat materials (linear colors — L.mat takes linear as-is)."""
    return {
        "c_white": L.mat("M_CrsWhite", (0.780, 0.780, 0.790), roughness=0.36),
        "c_flag": L.mat("M_CrsFlagRed", (0.60, 0.055, 0.045), roughness=0.72),
        "c_band": L.mat("M_CrsBandRed", (0.50, 0.10, 0.08), roughness=0.38),
        "c_green": L.mat("M_CrsGreen", (0.035, 0.102, 0.058), roughness=0.44, metallic=0.12),
        "c_unit": L.mat("M_CrsUnitGreen", (0.10, 0.20, 0.12), roughness=0.40, metallic=0.08),
        "c_sand": L.mat("M_CrsSand", (0.76, 0.66, 0.47), roughness=0.92),
        "c_alum": L.mat("M_CrsAlum", (0.52, 0.54, 0.57), roughness=0.40, metallic=0.90),
        "c_stone": L.mat("M_CrsStone", (0.050, 0.052, 0.056), roughness=0.60),
        "c_cup": L.mat("M_CrsCupDark", (0.015, 0.017, 0.015), roughness=0.88),
        "c_black": L.mat("M_CrsBlack", (0.030, 0.032, 0.036), roughness=0.55),
        "c_bronze": L.mat("M_CrsBronze", (0.36, 0.22, 0.09), roughness=0.32, metallic=0.95),
        "c_plast": L.mat("M_CrsPlastic", (0.048, 0.115, 0.065), roughness=0.50),
        "tee_gold": L.mat("M_TeeGold", (0.30, 0.145, 0.018), roughness=0.42, metallic=0.15),
        "tee_silver": L.mat("M_TeeSilver", (0.42, 0.43, 0.46), roughness=0.36, metallic=0.30),
        "tee_blue": L.mat("M_TeeBlue", (0.10, 0.22, 0.48), roughness=0.35, metallic=0.05),
        "tee_red": L.mat("M_TeeRed", (0.50, 0.10, 0.08), roughness=0.35, metallic=0.05),
    }


# ===================================================================== helpers ====

def _waving_flag(name, x0, z_top, length, height, mat_, parent):
    """A curved cloth sheet: grid displaced by two gentle sine waves along its
    length (amplitude ramping from 0 at the pole), solidified for a cloth edge."""
    nx, nz = 16, 6
    bm = bmesh.new()
    grid = []
    for i in range(nx + 1):
        u = i / nx
        ramp = u ** 0.85
        col = []
        for j in range(nz + 1):
            v = j / nz
            y = (0.040 * math.sin(6.2 * u + 0.45 + 0.55 * v)
                 + 0.019 * math.sin(11.3 * u + 2.1 + 0.8 * v)) * ramp
            x = x0 + u * length
            z = z_top - height + v * height - 0.028 * u * u  # slight fly-end droop
            col.append(bm.verts.new((x, y, z)))
        grid.append(col)
    for i in range(nx):
        for j in range(nz):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    L.activate(o)
    md = o.modifiers.new("sol", "SOLIDIFY")
    md.thickness = 0.006
    md.offset = 0.0
    bpy.ops.object.modifier_apply(modifier=md.name)
    me = o.data
    me.materials.append(mat_)
    for p in me.polygons:
        p.material_index = 0
        p.use_smooth = True
    L.parent_keep(o, parent)
    return o


def _wedge(name, x0, x1, zc, hh, t, mat_, parent):
    """A triangular prism pointing +X (arrow head): triangle in XZ, thickness 2t in Y."""
    bm = bmesh.new()
    tri = []
    for sy in (-t, t):
        a = bm.verts.new((x0, sy, zc - hh))
        b = bm.verts.new((x0, sy, zc + hh))
        c = bm.verts.new((x1, sy, zc))
        tri.append((a, b, c))
    (a1, b1, c1), (a2, b2, c2) = tri
    bm.faces.new((a1, b1, c1))
    bm.faces.new((a2, c2, b2))
    bm.faces.new((a1, a2, b2, b1))
    bm.faces.new((b1, b2, c2, c1))
    bm.faces.new((a1, c1, c2, a2))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    me.materials.append(mat_)
    L.parent_keep(o, parent)
    return o


def _flatten(obj, sz):
    """Squash an already-built object on Z and bake the scale."""
    obj.scale = (1.0, 1.0, sz)
    L.activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def _rot(obj, rot):
    """Set a post-hoc rotation and bake it into the mesh (keeps every object's
    local frame axis-aligned, so joined bound boxes stay truthful)."""
    obj.rotation_euler = rot
    L.activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return obj


# ===================================================================== builders ===

def build_flagstick(M):
    root = L.asset_root("flagstick", (0.60, 0.12, 2.44))
    L.cyl("Ferrule", 0.016, 0.06, (0, 0, 0.03), M["c_black"], verts=12, bevel=0.002, parent=root)
    L.frustum("Pole", 0.0125, 0.009, 2.35, (0, 0, 1.225), M["c_white"], segments=12, parent=root)
    for k, zz in enumerate((0.62, 1.32)):  # two thin red bands
        L.cyl(f"Band{k}", 0.014, 0.05, (0, 0, zz), M["c_band"], verts=12, bevel=0, parent=root)
    L.cyl("Sleeve", 0.0155, 0.42, (0, 0, 2.16), M["c_white"], verts=12, bevel=0, parent=root)
    L.sphere("Finial", 0.02, (0, 0, 2.415), M["gold"], segs=14, parent=root)
    _waving_flag("Flag", 0.017, 2.34, 0.55, 0.38, M["c_flag"], root)
    return root


def build_cup(M):
    root = L.asset_root("cup_flag_base", (0.11, 0.11, 0.02))
    L.cyl("Ring", 0.054, 0.02, (0, 0, 0.01), M["c_white"], verts=18, parent=root)
    L.cyl("Inner", 0.047, 0.014, (0, 0, 0.005), M["c_cup"], verts=18, bevel=0, parent=root)
    return root


def make_tee_marker(aid, key):
    def build(M):
        root = L.asset_root(aid, (0.22, 0.22, 0.14))
        L.cyl("Base", 0.11, 0.02, (0, 0, 0.01), M["c_stone"], verts=18, bevel=0.004, parent=root)
        s = L.sphere("Marker", 0.09, (0, 0, 0.073), M[key], segs=18, parent=root)
        _flatten(s, 0.75)
        return root
    return build


def build_tee_sign(M):
    root = L.asset_root("tee_sign", (0.53, 0.30, 1.20))
    L.box("Post", (0.06, 0.06, 1.15), (0, 0, 0.575), M["c_green"], bevel=0.004, parent=root)
    L.frustum("Cap", 0.052, 0.018, 0.05, (0, 0, 1.175), M["c_green"], segments=4, parent=root)
    a = math.radians(-18)  # panel tilted back 18 degrees
    ca, sa = math.cos(a), math.sin(a)
    P = (0.0, -0.075, 1.0)

    def tp(dy, dz):
        return (P[1] + dy * ca - dz * sa, P[2] + dy * sa + dz * ca)

    rot = (a, 0, 0)
    y, z = tp(0, 0)
    panel = L.wood_slab("Panel", (0.52, 0.03, 0.36), (0, y, z), M["walnut"], parent=root)
    _rot(panel, rot)
    for dz in (-0.175, 0.175):  # thin gold frame border
        y, z = tp(-0.019, dz)
        L.box(f"FrameH{dz:+.2f}", (0.53, 0.012, 0.02), (0, y, z), M["gold"], rot=rot, bevel=0, parent=root)
    y, z = tp(-0.019, 0)
    for sx in (-1, 1):
        L.box(f"FrameV{sx}", (0.02, 0.012, 0.345), (sx * 0.255, y, z), M["gold"], rot=rot, bevel=0, parent=root)
    y, z = tp(-0.024, 0.095)  # hole-number plate
    L.box("Plate", (0.13, 0.010, 0.085), (0, y, z), M["cream"], rot=rot, bevel=0.002, parent=root)
    # one mounting bracket low, hidden between the panel back and the post
    _, z = tp(0.028, -0.10)
    L.box("Bracket", (0.032, 0.08, 0.035), (0, -0.065, z), M["c_green"], rot=rot, bevel=0, parent=root)
    return root


def build_yardage(M):
    root = L.asset_root("yardage_marker", (0.11, 0.11, 0.51))
    L.cyl("Post", 0.05, 0.48, (0, 0, 0.24), M["cream"], verts=16, bevel=0.008, parent=root)
    d = L.sphere("Dome", 0.05, (0, 0, 0.48), M["cream"], segs=16, parent=root)
    _flatten(d, 0.55)
    L.cyl("Band", 0.053, 0.06, (0, 0, 0.415), M["c_band"], verts=16, bevel=0, parent=root)
    return root


def build_ball_washer(M):
    root = L.asset_root("ball_washer", (0.32, 0.19, 1.21))
    L.box("Post", (0.05, 0.05, 0.93), (0, 0, 0.465), M["c_green"], bevel=0.004, parent=root)
    L.cyl("Unit", 0.09, 0.28, (0, 0, 1.03), M["c_unit"], verts=18, bevel=0.004, parent=root)
    L.cyl("Lid", 0.096, 0.024, (0, 0, 1.176), M["c_green"], verts=18, bevel=0.003, parent=root)
    L.cyl("LidKnob", 0.018, 0.02, (0, 0, 1.196), M["steel"], verts=12, bevel=0, parent=root)
    # stainless crank on the +X face
    L.cyl("CrankAxle", 0.008, 0.07, (0.115, 0, 1.09), M["steel"], rot=(0, math.radians(90), 0), verts=10, bevel=0, parent=root)
    L.box("CrankArm", (0.014, 0.014, 0.075), (0.146, 0, 1.06), M["steel"], bevel=0.002, parent=root)
    L.cyl("CrankKnob", 0.011, 0.036, (0.158, 0, 1.022), M["c_black"], rot=(0, math.radians(90), 0), verts=10, bevel=0, parent=root)
    # towel bar on the -Y face (arms rooted in the 0.05-wide post)
    for sx in (-1, 1):
        L.box(f"TowelArm{sx}", (0.012, 0.055, 0.012), (sx * 0.018, -0.048, 0.72), M["c_green"], bevel=0, parent=root)
    L.cyl("TowelBar", 0.007, 0.09, (0, -0.068, 0.72), M["c_alum"], rot=(0, math.radians(90), 0), verts=10, bevel=0, parent=root)
    return root


def build_bench(M):
    root = L.asset_root("bench_course", (1.60, 0.50, 0.88))
    g = M["c_green"]
    tilt = math.radians(-8)
    for sx in (-1, 1):
        x = sx * 0.75
        L.box(f"LegF{sx}", (0.055, 0.06, 0.42), (x, -0.16, 0.21), g, bevel=0.004, parent=root)
        L.box(f"LegB{sx}", (0.055, 0.06, 0.42), (x, 0.17, 0.21), g, bevel=0.004, parent=root)
        L.box(f"Rail{sx}", (0.055, 0.47, 0.06), (x, 0.0, 0.40), g, bevel=0.004, parent=root)
        L.box(f"BackPost{sx}", (0.055, 0.06, 0.47), (x, 0.198, 0.645), g, rot=(tilt, 0, 0), bevel=0.004, parent=root)
        L.box(f"FootF{sx}", (0.075, 0.08, 0.024), (x, -0.16, 0.012), g, bevel=0, parent=root)
        L.box(f"FootB{sx}", (0.075, 0.08, 0.024), (x, 0.17, 0.012), g, bevel=0, parent=root)
    L.box("Stretcher", (1.46, 0.05, 0.045), (0, 0.17, 0.16), g, bevel=0, parent=root)
    for k, yy in enumerate((-0.168, -0.084, 0.0, 0.084, 0.168)):  # 5 seat slats
        L.wood_slab(f"Seat{k}", (1.60, 0.078, 0.030), (0, yy, 0.445), M["walnut"], parent=root)
    for k, zz in enumerate((0.575, 0.675, 0.775)):  # 3 back slats
        yb = 0.198 + (zz - 0.645) * math.tan(-tilt)
        s = L.wood_slab(f"Back{k}", (1.60, 0.030, 0.088), (0, yb, zz), M["walnut"], parent=root)
        _rot(s, (tilt, 0, 0))
    return root


def build_trash(M):
    root = L.asset_root("trash_course", (0.55, 0.55, 0.75))
    L.cyl("Core", 0.225, 0.66, (0, 0, 0.36), M["c_black"], verts=12, bevel=0, parent=root)
    for k in range(8):  # 8 vertical wood slats around the core
        ang = k * math.pi / 4
        s = L.wood_slab(f"Slat{k}", (0.64, 0.028, 0.155),
                        (math.cos(ang) * 0.246, math.sin(ang) * 0.246, 0.37), M["walnut"], parent=root)
        _rot(s, (0, math.radians(-90), ang + math.pi / 2))
    for k, zz in enumerate((0.16, 0.55)):
        L.cyl(f"Strap{k}", 0.257, 0.035, (0, 0, zz), M["c_green"], verts=12, bevel=0, parent=root)
    L.cyl("Rim", 0.268, 0.06, (0, 0, 0.72), M["c_green"], verts=12, bevel=0.004, parent=root)
    L.cyl("Mouth", 0.20, 0.03, (0, 0, 0.738), M["c_cup"], verts=12, bevel=0, parent=root)
    L.cyl("BasePlate", 0.24, 0.04, (0, 0, 0.02), M["c_green"], verts=12, bevel=0, parent=root)
    return root


def build_rake(M):
    root = L.asset_root("rake_prop", (1.58, 0.36, 0.06))
    lean = 0.023  # handle end rests on the ground, head end lifted by the teeth
    L.cyl("Handle", 0.014, 1.40, (-0.06, 0, 0.031), M["c_alum"],
          rot=(0, math.radians(90) - lean, 0), verts=12, bevel=0, parent=root)
    L.sphere("HandleCap", 0.0145, (-0.76, 0, 0.0155), M["c_alum"], segs=10, parent=root)
    L.box("Neck", (0.10, 0.028, 0.020), (0.685, 0, 0.046), M["c_plast"], bevel=0.002, parent=root)
    L.box("Head", (0.05, 0.35, 0.028), (0.745, 0, 0.042), M["c_plast"], bevel=0.003, parent=root)
    for k in range(8):  # 8 short teeth angled down to the sand
        yk = -0.1505 + k * 0.043
        L.box(f"Tooth{k}", (0.055, 0.014, 0.012), (0.788, yk, 0.024), M["c_plast"],
              rot=(0, math.radians(32), 0), bevel=0, parent=root)
    return root


def build_bridge(M):
    root = L.asset_root("bridge_path", (4.6, 2.8, 1.24))
    H, A, N = 0.22, 2.3, 6
    seg = 4.6 / N

    def arc(x):
        return H * (1.0 - (x / A) ** 2)

    for i in range(N):
        xc = -2.3 + (i + 0.5) * seg
        b = math.atan(2 * H * xc / (A * A))  # plank tangent to the arc
        rot = (0, b, 0)
        p = L.wood_slab(f"Deck{i}", (seg + 0.012, 2.8, 0.05), (xc, 0, arc(xc) + 0.205),
                        M["walnut"], grain="y", parent=root, bevel=0.005)
        _rot(p, rot)
        for sy in (-1, 1):
            L.box(f"Str{i}{sy}", (seg + 0.04, 0.13, 0.18), (xc, sy * 1.05, arc(xc) + 0.095),
                  M["walnut_dk"], rot=rot, bevel=0, parent=root)
            L.box(f"Curb{i}{sy}", (seg + 0.02, 0.09, 0.07), (xc, sy * 1.315, arc(xc) + 0.265),
                  M["walnut_dk"], rot=rot, bevel=0, parent=root)
    # top rail: 6 chords per side, running post-to-post only (never past them)
    rail_span, rail_n = 2.05, 6
    rseg = 2 * rail_span / rail_n
    for i in range(rail_n):
        xm = -rail_span + (i + 0.5) * rseg
        rb = math.atan(2 * H * xm / (A * A))
        for sy in (-1, 1):
            L.box(f"Rail{i}{sy}", (rseg + 0.02, 0.055, 0.05), (xm, sy * 1.315, arc(xm) + 1.005),
                  M["walnut"], rot=(0, rb, 0), bevel=0, parent=root)
    zb = arc(2.02) + 0.23
    for sx in (-1, 1):
        for sy in (-1, 1):
            L.box(f"Post{sx}{sy}", (0.09, 0.09, 0.82), (sx * 2.02, sy * 1.315, zb + 0.38),
                  M["c_green"], bevel=0.005, parent=root)
            L.frustum(f"PostCap{sx}{sy}", 0.075, 0.028, 0.05, (sx * 2.02, sy * 1.315, zb + 0.815),
                      M["c_green"], segments=4, parent=root)
        L.box(f"Abut{sx}", (0.42, 2.72, 0.16), (sx * 2.09, 0, 0.08), M["granite"], bevel=0.003, parent=root)
    return root


def build_stake(M):
    root = L.asset_root("stake_boundary", (0.05, 0.05, 0.95))
    L.cyl("Shaft", 0.025, 0.88, (0, 0, 0.44), M["c_white"], verts=12, bevel=0, parent=root)
    L.frustum("Top", 0.025, 0.009, 0.07, (0, 0, 0.915), M["c_white"], segments=12, parent=root)
    return root


def build_sign_dir(M):
    root = L.asset_root("sign_directional", (0.60, 0.07, 1.33))
    L.box("Post", (0.055, 0.055, 1.28), (0, 0, 0.64), M["c_green"], bevel=0.004, parent=root)
    L.frustum("Cap", 0.048, 0.016, 0.045, (0, 0, 1.3025), M["c_green"], segments=4, parent=root)
    L.box("Board", (0.34, 0.036, 0.16), (-0.02, 0, 1.13), M["c_green"], bevel=0.004, parent=root)
    _wedge("Head", 0.148, 0.30, 1.13, 0.105, 0.018, M["c_green"], root)
    L.box("Plate", (0.15, 0.012, 0.10), (-0.105, -0.0215, 1.13), M["cream"], bevel=0.002, parent=root)
    L.box("Collar", (0.072, 0.072, 0.028), (0, 0, 1.03), M["c_green"], bevel=0.002, parent=root)
    return root


def build_divot(M):
    root = L.asset_root("divot_box", (0.45, 0.30, 0.29))
    for sy in (-1, 1):
        L.wood_slab(f"WallY{sy}", (0.45, 0.028, 0.27), (0, sy * 0.136, 0.135), M["walnut"], parent=root)
    for sx in (-1, 1):
        L.wood_slab(f"WallX{sx}", (0.028, 0.244, 0.27), (sx * 0.211, 0, 0.135), M["walnut"], parent=root)
    for sx in (-1, 1):
        for sy in (-1, 1):
            L.box(f"Corner{sx}{sy}", (0.036, 0.036, 0.29), (sx * 0.207, sy * 0.132, 0.145),
                  M["walnut_dk"], bevel=0.004, parent=root)
    L.box("Sand", (0.40, 0.25, 0.03), (0, 0, 0.245), M["c_sand"], bevel=0, parent=root)
    return root


def build_bell(M):
    root = L.asset_root("bell_post", (0.50, 0.20, 1.51))
    post = L.wood_slab("Post", (1.46, 0.075, 0.075), (0, 0, 0.73), M["walnut"], parent=root)
    _rot(post, (0, math.radians(-90), 0))  # vertical grain
    L.frustum("Cap", 0.062, 0.02, 0.05, (0, 0, 1.485), M["c_green"], segments=4, parent=root)
    L.box("Arm", (0.34, 0.05, 0.05), (0.145, 0, 1.40), M["walnut_dk"], bevel=0.004, parent=root)
    L.box("Brace", (0.030, 0.030, 0.24), (0.115, 0, 1.295), M["walnut_dk"],
          rot=(0, math.radians(42), 0), bevel=0, parent=root)
    L.cyl("Hanger", 0.006, 0.08, (0.26, 0, 1.3375), M["c_bronze"], verts=8, bevel=0, parent=root)
    # bell: squashed sphere crown over a flared cone skirt, torus lip at the mouth
    crown = L.sphere("BellCrown", 0.042, (0.26, 0, 1.293), M["c_bronze"], segs=14, parent=root)
    _flatten(crown, 0.80)
    skirt = L.frustum("BellSkirt", 0.086, 0.034, 0.11, (0.26, 0, 1.245), M["c_bronze"],
                      segments=16, parent=root)
    L.activate(skirt)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    except Exception:
        pass
    L.torus("BellLip", 0.084, 0.012, (0.26, 0, 1.192), M["c_bronze"], parent=root, mj=18, mn=8)
    L.sphere("Clapper", 0.016, (0.26, 0, 1.176), M["c_black"], segs=10, parent=root)
    return root


# ====================================================================== catalog ===

CATALOG = [
    ("flagstick", build_flagstick, 2.44),
    ("cup_flag_base", build_cup, 0.02),
    ("tee_marker_gold", make_tee_marker("tee_marker_gold", "tee_gold"), 0.14),
    ("tee_marker_silver", make_tee_marker("tee_marker_silver", "tee_silver"), 0.14),
    ("tee_marker_blue", make_tee_marker("tee_marker_blue", "tee_blue"), 0.14),
    ("tee_marker_red", make_tee_marker("tee_marker_red", "tee_red"), 0.14),
    ("tee_sign", build_tee_sign, 1.20),
    ("yardage_marker", build_yardage, 0.51),
    ("ball_washer", build_ball_washer, 1.21),
    ("bench_course", build_bench, 0.88),
    ("trash_course", build_trash, 0.75),
    ("rake_prop", build_rake, 0.056),
    ("bridge_path", build_bridge, 1.24),
    ("stake_boundary", build_stake, 0.95),
    ("sign_directional", build_sign_dir, 1.325),
    ("divot_box", build_divot, 0.29),
    ("bell_post", build_bell, 1.51),
]

EXPECTED_HEIGHTS = {aid: h for aid, _, h in CATALOG}


def _tris(root):
    t = 0
    for o in L.descendants(root):
        if o.type == "MESH" and not o.get("collision_proxy"):
            t += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return t


def _write_manifest():
    ids = [aid for aid, _, _ in CATALOG if (L.EXPORT_DIR / f"{aid}.glb").exists()]
    manifest = {
        "comment": "GLBs present in this folder, by object type. The renderer only attempts "
                   "to load types listed here; everything else uses its procedural stand-in. "
                   "Add the filename stem when you drop in a real model. Built by "
                   "tools/blender/build_course_props.py (metres, base on Z=0).",
        "available": ids,
    }
    path = L.EXPORT_DIR / "_manifest.json"
    path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"MANIFEST|{path}|available={len(ids)}")


def main():
    only = [a for a in ARGV if a not in ("render", "nojoin", "open")]
    do_render = "render" in ARGV
    for aid, fn, hexp in CATALOG:
        if only and aid not in only:
            continue
        L.reset_scene()
        M = {**L.materials(), **course_mats()}
        root = fn(M)
        if "debug" in ARGV:
            from mathutils import Vector
            for o in L.descendants(root):
                if o.type == "MESH":
                    zs = [(o.matrix_world @ Vector(c)).z for c in o.bound_box]
                    print(f"DEBUG|{aid}|{o.name}|z={min(zs):.4f}..{max(zs):.4f}")
        L.join_static(root)
        tris = _tris(root)
        mins, maxs = L._world_bounds(root)
        L.save_and_export(aid, root, subdir="course")
        print(f"STATS|{aid}|tris={tris}|minz={mins[2]:.4f}|maxz={maxs[2]:.3f}|expected_h={hexp}")
        if do_render:
            L.render_preview(aid, root)
        print(f"COMPLETE|{aid}")
    _write_manifest()


main()
