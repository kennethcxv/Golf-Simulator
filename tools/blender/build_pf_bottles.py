"""Prime Fairways bottle line (R08): squeeze / insulated / sport / slim.
Each: lathe body + cap hardware + cylindrical-UV label wrap with the PF
flag-on-mound crest ("PRIME FAIRWAYS / PRO SHOP")."""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import bmesh
import lib_props as L
import proshop_lib as P
import pf_brand as B

CREAM = (0.72, 0.68, 0.55)
SAGE = (0.30, 0.36, 0.26)
NAVY = (0.035, 0.055, 0.10)


def label_wrap(name, r, z0, z1, mat, parent, *, steps=36):
    """Open cylinder with cylindrical UVs; u=0.5 faces -Y (player)."""
    bm = bmesh.new()
    rings = []
    for z in (z0, z1):
        ring = []
        for i in range(steps + 1):
            a = 2 * math.pi * i / steps
            if i == steps:
                ring.append(None)
                continue
            ring.append(bm.verts.new((math.sin(a) * r, -math.cos(a) * r, z)))
        rings.append(ring)
    uvl = bm.loops.layers.uv.new("UVMap")
    faces = []
    for i in range(steps):
        a, b = rings[0][i], rings[0][(i + 1) % steps]
        c, d = rings[1][(i + 1) % steps], rings[1][i]
        f = bm.faces.new((a, b, c, d))
        us = (0.5 + i / steps, 0.5 + (i + 1) / steps)   # u=0.5 (art centre) faces -Y
        for lp, (uu, vv) in zip(f.loops, [(us[0], 0), (us[1], 0), (us[1], 1), (us[0], 1)]):
            lp[uvl].uv = (uu, vv)
        faces.append(f)
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    me.materials.append(mat)
    L.activate(o)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(50))
    except Exception:
        pass
    L.parent_keep(o, parent)
    return o


def bottle_label(name, base, ink, *, sub="PRO SHOP", w=1024, h=512):
    arr = P.canvas(base, w, h, ss=3, mottle=0.02, seed=43)
    cx = w // 2
    B.flag_mound(arr, cx, int(h * 0.36), int(h * 0.34), ink)
    P.draw_text(arr, "PRIME FAIRWAYS", cx, int(h * 0.62), 3, ink)
    P.draw_text(arr, sub, cx, int(h * 0.76), 2, ink)
    P.rect(arr, cx - 30, int(h * 0.86), cx + 30, int(h * 0.875), ink)
    return P.np_image(name, arr)


def cap_ribs(prefix, r, z, hgt, M, parent, *, n=14, mat=None):
    for i in range(n):
        a = 2 * math.pi * i / n
        L.box(f"{prefix}_rib{i}", (0.0022, 0.0035, hgt), (math.sin(a) * r, -math.cos(a) * r, z), mat or M["rubber"], bevel=0.0006, parent=parent, uv=False)


def build_squeeze(M):
    aid = "pf_bottle_squeeze"
    D, H = 0.073, 0.25
    r = D / 2
    root = P.asset_root(aid, (D, D, H), category="bottles")
    cream = P.m_flat("M_BtlCream", CREAM, rough=0.42)
    navy = P.m_flat("M_BtlNavy", NAVY, rough=0.45)
    green = P.m_flat("M_BtlGreen", (0.14, 0.24, 0.13), rough=0.4)
    prof = [(0.0, 0.0), (r * 0.86, 0.0), (r, 0.012), (r, 0.05), (r * 0.93, 0.075), (r * 0.93, 0.135),
            (r, 0.155), (r, 0.175), (r * 0.62, 0.205), (r * 0.56, 0.212), (0.0, 0.212)]
    P.lathe(f"{aid}_body", prof, (0, 0, 0), cream, steps=32, parent=root, uv=False)
    L.cyl(f"{aid}_baseband", r + 0.0006, 0.014, (0, 0, 0.008), navy, parent=root, verts=32)
    lbl = P.m_tex("M_LblSqueeze", bottle_label("LblSqueeze", CREAM, (0.30, 0.38, 0.27)), rough=0.42)
    label_wrap(f"{aid}_label", r * 0.936, 0.078, 0.132, lbl, root)
    # grip dimples zone: two side patches
    dim = P.m_flat("M_BtlDimple", (0.66, 0.62, 0.50), rough=0.6)
    for sx in (-1, 1):
        P.pillow(f"{aid}_grip{sx}", (0.012, 0.045, 0.052), (sx * (r * 0.90), 0, 0.105), dim, parent=root, round_frac=0.9, uv=False)
    L.cyl(f"{aid}_capring", 0.0225, 0.020, (0, 0, 0.220), navy, parent=root, verts=24)
    cap_ribs(f"{aid}_cr", 0.0225, 0.220, 0.018, M, root, mat=navy)
    L.cyl(f"{aid}_captop", 0.017, 0.008, (0, 0, 0.233), navy, parent=root, verts=24)
    L.cyl(f"{aid}_push", 0.0075, 0.016, (0, 0, 0.243), green, parent=root, verts=16)
    P.collision_box(f"COL_{aid}", (D, D, H), (0, 0, H / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.13))
    return root


def build_insulated(M):
    aid = "pf_bottle_insulated"
    D, H = 0.085, 0.285
    r = D / 2
    root = P.asset_root(aid, (D, D, H), category="bottles")
    sage = P.m_flat("M_BtlSage", SAGE, rough=0.38)
    prof = [(0.0, 0.0), (r * 0.9, 0.0), (r, 0.008), (r, 0.19), (r * 0.97, 0.208), (r * 0.62, 0.232), (r * 0.44, 0.238), (0.0, 0.238)]
    P.lathe(f"{aid}_body", prof, (0, 0, 0), sage, steps=36, parent=root, uv=False)
    L.cyl(f"{aid}_baseband", r + 0.0005, 0.016, (0, 0, 0.009), M["steel"], parent=root, verts=32)
    lbl = P.m_tex("M_LblInsul", bottle_label("LblInsul", SAGE, (0.85, 0.83, 0.74)), rough=0.38)
    label_wrap(f"{aid}_label", r + 0.0006, 0.06, 0.165, lbl, root)
    L.cyl(f"{aid}_cap", 0.0255, 0.034, (0, 0, 0.252), M["steel"], parent=root, verts=28)
    L.cyl(f"{aid}_capridge", 0.0262, 0.006, (0, 0, 0.242), M["steel"], parent=root, verts=28)
    # swing handle: black loop
    hdl = P.smooth_wire([(-0.020, 0, 0.268), (-0.024, 0, 0.292), (0, 0, 0.306), (0.024, 0, 0.292), (0.020, 0, 0.268)], n=18)
    P.tube_path(f"{aid}_handle", hdl, 0.0035, M["rubber"], parent=root)
    for sx in (-1, 1):
        L.cyl(f"{aid}_hpin{sx}", 0.005, 0.008, (sx * 0.021, 0, 0.266), M["rubber"], rot=(0, math.radians(90), 0), parent=root, verts=10)
    P.collision_box(f"COL_{aid}", (D, D, H + 0.022), (0, 0, (H + 0.022) / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.15), hang=(0, 0, 0.306))
    return root


def build_sport(M):
    aid = "pf_bottle_sport"
    D, H = 0.075, 0.26
    r = D / 2
    root = P.asset_root(aid, (D, D, H), category="bottles")
    navy = P.m_flat("M_BtlNavy2", NAVY, rough=0.42)
    green = P.m_flat("M_BtlGreen", (0.14, 0.24, 0.13), rough=0.4)
    prof = [(0.0, 0.0), (r * 0.88, 0.0), (r, 0.010), (r, 0.075), (r * 0.88, 0.105), (r * 0.88, 0.14),
            (r, 0.165), (r * 0.99, 0.195), (r * 0.60, 0.222), (0.0, 0.222)]
    P.lathe(f"{aid}_body", prof, (0, 0, 0), navy, steps=32, parent=root, uv=False)
    lbl = P.m_tex("M_LblSport", bottle_label("LblSport", NAVY, (0.60, 0.66, 0.55)), rough=0.42)
    label_wrap(f"{aid}_label", r * 0.886, 0.108, 0.138, lbl, root)
    L.cyl(f"{aid}_capring", 0.024, 0.022, (0, 0, 0.230), navy, parent=root, verts=24)
    cap_ribs(f"{aid}_cr", 0.024, 0.230, 0.02, M, root, mat=navy)
    L.cyl(f"{aid}_captop", 0.019, 0.007, (0, 0, 0.2445), navy, parent=root, verts=24)
    p2 = [(0.0, 0.0), (0.009, 0.0), (0.0065, 0.012), (0.0045, 0.0125), (0.0045, 0.0155), (0.0, 0.0155)]
    P.lathe(f"{aid}_push", p2, (0, 0, 0.248), green, steps=18, parent=root, uv=False)
    P.collision_box(f"COL_{aid}", (D, D, H + 0.004), (0, 0, H / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.13))
    return root


def build_slim(M):
    aid = "pf_bottle_slim"
    D, H = 0.071, 0.265
    r = D / 2
    root = P.asset_root(aid, (D, D, H), category="bottles")
    cream = P.m_flat("M_BtlCream", CREAM, rough=0.35)
    prof = [(0.0, 0.0), (r * 0.82, 0.0), (r, 0.014), (r, 0.15), (r * 0.90, 0.185), (r * 0.55, 0.215),
            (r * 0.52, 0.235), (0.0, 0.235)]
    P.lathe(f"{aid}_body", prof, (0, 0, 0), cream, steps=36, parent=root, uv=False)
    L.cyl(f"{aid}_baseband", r * 0.86, 0.008, (0, 0, 0.004), M["steel"], parent=root, verts=30)
    lbl = P.m_tex("M_LblSlim", bottle_label("LblSlim", CREAM, (0.10, 0.16, 0.28)), rough=0.35)
    label_wrap(f"{aid}_label", r + 0.0006, 0.055, 0.145, lbl, root)
    L.cyl(f"{aid}_cap", 0.0195, 0.026, (0, 0, 0.248), M["steel"], parent=root, verts=26)
    P.collision_box(f"COL_{aid}", (D, D, H), (0, 0, H / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.14))
    return root


REG = {
    "pf_bottle_squeeze": build_squeeze,
    "pf_bottle_insulated": build_insulated,
    "pf_bottle_sport": build_sport,
    "pf_bottle_slim": build_slim,
}

META = {
    "pf_bottle_squeeze": {"name": "PF Squeeze Bottle", "variant": "cream_navy", "price": 12.99, "fixture": "pf_fixture_snack_shelf", "slot_type": "shelf_bottle", "packaging": "none", "material": "HDPE"},
    "pf_bottle_insulated": {"name": "PF Insulated Flask", "variant": "sage_steel", "price": 34.99, "fixture": "pf_fixture_snack_shelf", "slot_type": "shelf_bottle", "packaging": "none", "material": "stainless"},
    "pf_bottle_sport": {"name": "PF Sport Bottle", "variant": "navy_green", "price": 14.99, "fixture": "pf_fixture_snack_shelf", "slot_type": "shelf_bottle", "packaging": "none", "material": "HDPE"},
    "pf_bottle_slim": {"name": "PF Slim Steel Bottle", "variant": "cream_steel", "price": 24.99, "fixture": "pf_fixture_snack_shelf", "slot_type": "shelf_bottle", "packaging": "none", "material": "stainless"},
}

P.run_batch(REG, kind="products", category_of=lambda a: "bottles", manifest_extra=lambda a: META.get(a))
