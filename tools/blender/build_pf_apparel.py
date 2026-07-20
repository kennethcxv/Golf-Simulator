"""Prime Fairways apparel v2 (R01, R15, R16) + reusable hangers.

Reference-fidelity ghost-mannequin garments: fold-over collars with tipping,
plackets/zips with pullers, shoulder + side seams, hem stitching, creases,
welt pockets, chest logos, fabric normal maps.

Hanging garments + hangers keep the HANGER HOOK CONTACT POINT at z=0 with the
garment below; folded items sit base-on-Z=0.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import lib_props as L
import proshop_lib as P
import pf_brand as B

CREAM = (0.72, 0.68, 0.57)
SAGE = (0.30, 0.36, 0.26)
NAVY = (0.042, 0.055, 0.105)
CHAR = (0.050, 0.053, 0.058)
KHAKI = (0.42, 0.33, 0.20)
VARIANT_NOTE = "apparel_cream,apparel_sage,apparel_navy,apparel_charcoal"


def seam_mat(base, name):
    return P.m_flat(name, tuple(c * 0.72 for c in base), rough=0.8)


def logo_patch(prefix, parent, loc, base, accent, *, s=0.026, rot=(0, 0, 0)):
    arr = P.canvas(base, 128, 128, ss=3, mottle=0.02, seed=131)
    B.arrow_mark(arr, 64, 56, 60, accent)
    P.draw_text(arr, "PF", 64, 106, 2, accent)
    m = P.m_tex(f"M_Logo_{prefix}", P.np_image(f"Logo_{prefix}", arr), rough=0.6)
    P.uv_box(f"{prefix}_logo", (s, 0.0022, s), loc, m, parent=parent, rot=rot, face_uv={"-Y": (0, 0, 1, 1)})


# ------------------------------------------------------------------ hangers ----

def hook(prefix, mat, parent, *, drop=0.055):
    pts = P.smooth_wire([(0, -0.016, -0.014), (0, -0.014, 0.002), (0, 0.0, 0.010), (0, 0.014, 0.002),
                         (0, 0.016, -0.014), (0, 0.006, -0.020), (0, 0.0, -drop)], n=22)
    P.tube_path(f"{prefix}_hook", pts, 0.0035, mat, parent=parent)


def build_hanger_wood(M):
    aid = "pf_hanger_wood"
    root = P.asset_root(aid, (0.445, 0.03, 0.24), category="apparel")
    wood = M["oak"]
    hook(aid, M["steel"], root)
    bar = P.smooth_wire([(-0.222, 0, -0.20), (-0.15, 0, -0.115), (0, 0, -0.062), (0.15, 0, -0.115), (0.222, 0, -0.20)], n=26)
    P.tube_path(f"{aid}_shoulders", bar, 0.0105, wood, parent=root)
    L.cyl(f"{aid}_crossbar", 0.006, 0.40, (0, 0, -0.196), wood, rot=(0, math.radians(90), 0), parent=root, verts=10)
    P.collision_box(f"COL_{aid}", (0.45, 0.035, 0.24), (0, 0, -0.11), M, root)
    P.product_sockets(root, pickup=(0, 0, -0.06), hang=(0, 0, 0))
    return root


def build_hanger_metal(M):
    aid = "pf_hanger_metal"
    root = P.asset_root(aid, (0.42, 0.02, 0.21), category="apparel")
    blk = P.m_flat("M_HangerBlack", (0.03, 0.031, 0.034), rough=0.35, metal=0.7)
    hook(aid, blk, root)
    bar = P.smooth_wire([(-0.21, 0, -0.185), (-0.13, 0, -0.105), (0, 0, -0.058), (0.13, 0, -0.105), (0.21, 0, -0.185)], n=26)
    P.tube_path(f"{aid}_shoulders", bar, 0.004, blk, parent=root)
    L.cyl(f"{aid}_crossbar", 0.0035, 0.385, (0, 0, -0.182), blk, rot=(0, math.radians(90), 0), parent=root, verts=8)
    P.collision_box(f"COL_{aid}", (0.43, 0.03, 0.21), (0, 0, -0.10), M, root)
    P.product_sockets(root, pickup=(0, 0, -0.06), hang=(0, 0, 0))
    return root


def build_hanger_clip(M):
    aid = "pf_hanger_clip"
    root = P.asset_root(aid, (0.36, 0.025, 0.16), category="apparel")
    wood = M["oak"]
    blk = P.m_flat("M_HangerBlack", (0.03, 0.031, 0.034), rough=0.35, metal=0.7)
    hook(aid, blk, root)
    L.cyl(f"{aid}_bar", 0.007, 0.34, (0, 0, -0.085), wood, rot=(0, math.radians(90), 0), parent=root, verts=10)
    for sx in (-1, 1):
        L.box(f"{aid}_clip{sx}", (0.018, 0.012, 0.045), (sx * 0.13, 0, -0.108), blk, bevel=0.002, parent=root, uv=False)
        L.box(f"{aid}_clipjaw{sx}", (0.014, 0.006, 0.02), (sx * 0.13, 0, -0.128), M["steel"], bevel=0.001, parent=root, uv=False)
    P.collision_box(f"COL_{aid}", (0.36, 0.03, 0.16), (0, 0, -0.08), M, root)
    P.product_sockets(root, pickup=(0, 0, -0.06), hang=(0, 0, 0))
    return root


# ------------------------------------------------------------------ garments ---

def torso(aid, mat, sm, parent, *, shoulder=0.21, hem_z=-0.66, chest=0.20, boxy=0.0, seams=True):
    """Garment body with drape, side seams, shoulder seams and hem stitching."""
    secs = [(0, 0.000, -0.095, shoulder, 0.050),
            (0, 0.002, -0.130, chest + 0.008 + boxy, 0.0555),
            (0, 0.004, -0.19, chest + 0.006 + boxy, 0.059),
            (0, 0.003, -0.30, chest + boxy, 0.0605 + boxy * 0.3),
            (0, 0.001, -0.40, chest - 0.008 + boxy, 0.059),
            (0, 0.000, -0.50, chest - 0.012 + boxy, 0.0575),
            (0, -0.002, hem_z + 0.05, chest - 0.006 + boxy, 0.0555),
            (0, -0.003, hem_z, chest - 0.002 + boxy, 0.054)]
    t = P.loft(f"{aid}_torso", secs, (0, 0, 0), mat, parent=parent, ring=22, uv=True, plane="xy")
    # soft hem wave
    for v in t.data.vertices:
        if v.co.z < hem_z + 0.03:
            v.co.z += math.sin(v.co.x * 55.0) * 0.0035 + math.cos(v.co.y * 40.0) * 0.002
    if seams:
        for sx in (-1, 1):  # side seams
            pts = [(sx * (chest + 0.007 + boxy), 0.004, -0.16), (sx * (chest + boxy + 0.001), 0.002, -0.32),
                   (sx * (chest - 0.010 + boxy), 0.0, -0.48), (sx * (chest - 0.004 + boxy), -0.002, hem_z + 0.02)]
            P.tube_path(f"{aid}_sideseam{sx}", P.smooth_wire(pts, n=12), 0.0009, sm, parent=parent, verts=4)
        for sx in (-1, 1):  # shoulder seams
            P.tube_path(f"{aid}_shoulderseam{sx}",
                        [(sx * 0.055, -0.006, -0.0955), (sx * 0.13, -0.002, -0.099), (sx * 0.185, 0.002, -0.104)],
                        0.0009, sm, parent=parent, verts=4)
    # hem stitch ring
    pts = [(math.cos(a) * (chest - 0.001 + boxy), math.sin(a) * 0.0545 - 0.003, hem_z + 0.012) for a in
           [2 * math.pi * i / 24 for i in range(25)]]
    P.tube_path(f"{aid}_hemstitch", pts, 0.0006, sm, parent=parent, verts=4)
    return t


def sleeve(aid, tag, mat, sm, parent, *, sx, length=0.20, r0=0.052, r1=0.040, angle=32, z0=-0.108, cuff=None):
    ca, sa = math.cos(math.radians(angle)) * 0.72, math.sin(math.radians(angle))
    x0 = sx * 0.158
    secs = []
    # rolled cuff is part of the loft: bulge ring near the opening, then close
    for t, rr in [(0.0, r0 * 1.04), (0.3, r0 * 0.97), (0.62, (r0 + r1) / 2), (0.90, r1),
                  (0.93, r1 * 1.06), (0.99, r1 * 1.05), (1.0, r1 * 0.55)]:
        secs.append((x0 + sx * length * t * ca, 0, z0 - length * t * sa - r0 * 0.25 * t, rr * 0.88, rr))
    P.loft(f"{aid}_slv{tag}", secs, (0, 0, 0), mat, parent=parent, ring=14, uv=False, plane="yz")
    ex = x0 + sx * length * 0.97 * ca
    ez = z0 - length * 0.97 * sa - r0 * 0.243
    return ex, ez


def collar_polo(aid, mat, tip_mat, parent):
    """Stand + fold-over collar with tipping stripe, open at the front placket."""
    arc = math.radians(318)
    stand = P.lathe(f"{aid}_collarstand", [(0.060, 0.0), (0.060, 0.020), (0.0545, 0.020), (0.0545, 0.0)],
                    (0, -0.002, -0.092), mat, steps=22, angle=arc, uv=False, smooth=60)
    fold = P.lathe(f"{aid}_collarfold", [(0.0605, 0.018), (0.078, -0.010), (0.0755, -0.0145), (0.058, 0.0125)],
                   (0, -0.002, -0.092), mat, steps=22, angle=arc, uv=False, smooth=60)
    for o in (stand, fold):
        from mathutils import Matrix
        cx = sum(v.co.x for v in o.data.vertices) / len(o.data.vertices)
        cy = sum(v.co.y for v in o.data.vertices) / len(o.data.vertices)
        o.data.transform(Matrix.Rotation(math.pi / 2 - math.atan2(cy, cx), 4, "Z"))
        L.parent_keep(o, parent)
    # tipping stripe along the fold edge
    pts = [(math.cos(a) * 0.0765, math.sin(a) * 0.0765 - 0.002, -0.092 - 0.011) for a in
           [math.pi / 2 + arc * (i / 20 - 0.5) for i in range(21)]]
    P.tube_path(f"{aid}_collartip", pts, 0.0016, tip_mat, parent=parent, verts=5)


def placket(aid, mat, sm, parent, *, z0=-0.112, ln=0.135, buttons=3, M=None):
    L.box(f"{aid}_placket", (0.032, 0.007, ln), (0, -0.0585, z0 - ln / 2), mat, bevel=0.0025, parent=parent, uv=False)
    for sx in (-1, 1):  # placket stitch lines
        P.tube_path(f"{aid}_plkstitch{sx}", [(sx * 0.0145, -0.0625, z0 - 0.006), (sx * 0.0145, -0.0625, z0 - ln + 0.01)],
                    0.0006, sm, parent=parent, verts=4)
    for i in range(buttons):
        L.cyl(f"{aid}_btn{i}", 0.0052, 0.0035, (0, -0.0632, z0 - 0.026 - i * 0.037), M["board"], rot=(math.radians(90), 0, 0), parent=parent, verts=12)
        L.cyl(f"{aid}_btnrim{i}", 0.0058, 0.0015, (0, -0.0625, z0 - 0.026 - i * 0.037), P.m_flat("M_BtnRim", (0.55, 0.53, 0.47), rough=0.5), rot=(math.radians(90), 0, 0), parent=parent, verts=12)


def zipper(aid, tag, parent, *, z_top, z_bot, y=-0.061, teeth_w=0.011, garage=True, M=None, accent=None):
    """Zip strip with knurled teeth normal + slider and puller."""
    zt = P.m_tex(f"M_ZipTeeth_{aid}_{tag}", P.np_image(f"ZipTeeth_{aid}_{tag}", P.base_arr((0.30, 0.31, 0.33), 64, 64, mottle=0.05, seed=133)),
                 rough=0.35, metal=0.8, normal=P.nrm_img("rib", strength=2.0), uvscale=6.0)
    tape = accent or P.m_flat(f"M_ZipTape_{aid}", (0.03, 0.03, 0.034), rough=0.6)
    L.box(f"{aid}_ziptape{tag}", (teeth_w + 0.008, 0.005, z_top - z_bot), (0, y + 0.001, (z_top + z_bot) / 2), tape, bevel=0.001, parent=parent, uv=False)
    L.box(f"{aid}_zipteeth{tag}", (teeth_w * 0.5, 0.0058, z_top - z_bot - 0.006), (0, y, (z_top + z_bot) / 2), zt, bevel=0.0008, parent=parent)
    if garage:
        L.box(f"{aid}_zipgarage{tag}", (teeth_w + 0.006, 0.008, 0.012), (0, y + 0.001, z_top - 0.005), tape, bevel=0.002, parent=parent, uv=False)
    L.box(f"{aid}_zipslider{tag}", (0.009, 0.008, 0.013), (0, y - 0.0015, z_top - 0.028), M["satin"], bevel=0.002, parent=parent, uv=False)
    pl = L.box(f"{aid}_zippull{tag}", (0.006, 0.0025, 0.022), (0, y - 0.004, z_top - 0.044), M["satin"], bevel=0.001, parent=parent, uv=False)
    pl.rotation_euler = (math.radians(12), 0, 0)


def build_polo(M):
    aid = "pf_polo_hanging"
    root = P.asset_root(aid, (0.47, 0.13, 0.70), category="apparel", extra={"material_variants": VARIANT_NOTE, "hanging": True})
    m = P.fabric_mat("M_PoloCreamV2", CREAM, "pique", rough=0.74, nstr=0.28, seed=171)
    sm = seam_mat(CREAM, "M_PoloSeam")
    tip = P.m_flat("M_PoloTip", (0.30, 0.38, 0.27), rough=0.7)
    torso(aid, m, sm, root)
    for sx in (-1, 1):
        sleeve(aid, "L" if sx < 0 else "R", m, sm, root, sx=sx, angle=56)
    collar_polo(aid, m, tip, root)
    placket(aid, m, sm, root, M=M)
    logo_patch(aid, root, (0.085, -0.0575, -0.185), CREAM, (0.30, 0.38, 0.27))
    P.collision_box(f"COL_{aid}", (0.48, 0.14, 0.70), (0, 0, -0.35), M, root)
    P.product_sockets(root, pickup=(0, 0, -0.3), hang=(0, 0, 0))
    return root


def build_quarterzip(M):
    aid = "pf_quarterzip_hanging"
    root = P.asset_root(aid, (0.50, 0.13, 0.72), category="apparel", extra={"material_variants": VARIANT_NOTE, "hanging": True})
    m = P.fabric_mat("M_QZSageV2", SAGE, "knit", rough=0.72, nstr=0.45, seed=173)
    sm = seam_mat(SAGE, "M_QZSeam")
    rib = P.m_tex("M_QZRib", P.np_image("QZRibAlb", P.fabric_arr(tuple(c * 0.88 for c in SAGE), 256, 256, kind="rib" if False else "knit", seed=175)),
                  rough=0.78, normal=P.nrm_img("rib", strength=1.8), uvscale=2.0)
    torso(aid, m, sm, root, hem_z=-0.64)
    for sx in (-1, 1):
        ex, ez = sleeve(aid, "L" if sx < 0 else "R", m, sm, root, sx=sx, length=0.50, r1=0.033, angle=72, cuff=rib)
    # stand collar (closed ring w/ front gap for the zip)
    c = P.loft(f"{aid}_collar", [(0, -0.002, -0.094, 0.061, 0.0525), (0, -0.004, -0.052, 0.0585, 0.050)],
               (0, 0, 0), m, parent=root, ring=18, uv=False, plane="xy", cap=False)
    P.loft(f"{aid}_collartop", [(0, -0.004, -0.054, 0.0585, 0.050), (0, -0.004, -0.050, 0.0555, 0.0475)],
           (0, 0, 0), m, parent=root, ring=18, uv=False, plane="xy", cap=False)
    zipper(aid, "front", root, z_top=-0.052, z_bot=-0.20, M=M)
    # raglan seams
    for sx in (-1, 1):
        P.tube_path(f"{aid}_raglan{sx}", P.smooth_wire([(sx * 0.045, -0.045, -0.098), (sx * 0.13, -0.028, -0.115), (sx * 0.195, 0.0, -0.135)], n=10),
                    0.0009, sm, parent=root, verts=4)
    # ribbed hem band
    P.loft(f"{aid}_hem", [(0, -0.002, -0.685, 0.194, 0.0545), (0, -0.003, -0.64, 0.198, 0.056)], (0, 0, 0), rib, parent=root, ring=20, uv=True, plane="xy")
    logo_patch(aid, root, (0.085, -0.058, -0.185), SAGE, (0.85, 0.85, 0.80))
    P.collision_box(f"COL_{aid}", (0.51, 0.14, 0.72), (0, 0, -0.36), M, root)
    P.product_sockets(root, pickup=(0, 0, -0.3), hang=(0, 0, 0))
    return root


def build_hoodie(M):
    aid = "pf_hoodie_hanging"
    root = P.asset_root(aid, (0.50, 0.17, 0.74), category="apparel", extra={"material_variants": VARIANT_NOTE, "hanging": True})
    m = P.fabric_mat("M_HoodieNavyV2", NAVY, "fleece", rough=0.85, nstr=0.5, seed=177)
    sm = seam_mat((0.10, 0.12, 0.2), "M_HoodieSeam")
    torso(aid, m, sm, root, hem_z=-0.68, boxy=0.008)
    for sx in (-1, 1):
        sleeve(aid, "L" if sx < 0 else "R", m, sm, root, sx=sx, length=0.52, r1=0.035, angle=72, cuff=m)
    # hood: shell + face-rim roll
    hood = L.sphere(f"{aid}_hood", 0.085, (0, 0.040, -0.095), m, parent=root, segs=18)
    hood.scale = (1.02, 0.80, 0.88)
    rim = []
    for i in range(13):
        a = math.pi * (i / 12) - math.pi / 2
        rim.append((math.sin(a) * 0.078, 0.040 - math.cos(a * 0.7) * 0.075, -0.095 + math.cos(a) * 0.062 - 0.01))
    P.tube_path(f"{aid}_hoodrim", P.smooth_wire(rim, n=18), 0.009, m, parent=root, verts=8)
    # drawstrings with aglets
    for sx in (-1, 1):
        pts = P.smooth_wire([(sx * 0.030, -0.064, -0.128), (sx * 0.034, -0.068, -0.21), (sx * 0.030, -0.064, -0.295)], n=8)
        P.tube_path(f"{aid}_string{sx}", pts, 0.0024, P.m_flat("M_String", (0.82, 0.82, 0.78), rough=0.8), parent=root, verts=6)
        L.cyl(f"{aid}_aglet{sx}", 0.003, 0.012, (sx * 0.030, -0.064, -0.30), M["satin"], parent=root, verts=8)
    # kangaroo pocket with stitch outline
    P.pillow(f"{aid}_pocket", (0.21, 0.026, 0.145), (0, -0.058, -0.55), m, round_frac=0.5, parent=root, uv=False)
    for sx in (-1, 1):
        P.tube_path(f"{aid}_pkstitch{sx}", [(sx * 0.105, -0.070, -0.48), (sx * 0.062, -0.072, -0.478)], 0.0007, sm, parent=root, verts=4)
    logo_patch(aid, root, (0.082, -0.060, -0.20), NAVY, (0.80, 0.79, 0.74))
    P.collision_box(f"COL_{aid}", (0.51, 0.18, 0.74), (0, 0, -0.37), M, root)
    P.product_sockets(root, pickup=(0, 0, -0.3), hang=(0, 0, 0))
    return root


def build_jacket(M):
    aid = "pf_jacket_hanging"
    root = P.asset_root(aid, (0.52, 0.17, 0.76), category="apparel", extra={"material_variants": VARIANT_NOTE, "hanging": True})
    m = P.fabric_mat("M_JacketCharV2", CHAR, "ripstop", rough=0.55, nstr=0.35, seed=179)
    sm = seam_mat((0.09, 0.095, 0.10), "M_JacketSeam")
    green = P.m_flat("M_ZipGreen", (0.25, 0.34, 0.14), rough=0.5)
    torso(aid, m, sm, root, hem_z=-0.72, boxy=0.012)
    for sx in (-1, 1):
        ex, ez = sleeve(aid, "L" if sx < 0 else "R", m, sm, root, sx=sx, length=0.54, r1=0.036, angle=73, cuff=m)
        L.box(f"{aid}_cufftab{sx}", (0.045, 0.013, 0.022), (sx * 0.235, -0.012, -0.565), P.m_flat("M_CuffDark", (0.025, 0.026, 0.03), rough=0.6), bevel=0.003, parent=root, uv=False)
    hood = L.sphere(f"{aid}_hood", 0.088, (0, 0.044, -0.096), m, parent=root, segs=18)
    hood.scale = (1.02, 0.82, 0.9)
    rim = []
    for i in range(13):
        a = math.pi * (i / 12) - math.pi / 2
        rim.append((math.sin(a) * 0.080, 0.044 - math.cos(a * 0.7) * 0.078, -0.096 + math.cos(a) * 0.064 - 0.01))
    P.tube_path(f"{aid}_hoodrim", P.smooth_wire(rim, n=18), 0.008, m, parent=root, verts=8)
    # full-length zip with green tape + storm flap
    zipper(aid, "front", root, z_top=-0.10, z_bot=-0.70, M=M, accent=green)
    L.box(f"{aid}_stormflap", (0.026, 0.005, 0.58), (-0.021, -0.0605, -0.40), m, bevel=0.002, parent=root, uv=False)
    # chest + hand zips (tilted, with pullers)
    for (cx, cz, ln, ang) in [(0.075, -0.215, 0.095, -12)]:
        zc = L.box(f"{aid}_chestzip", (ln, 0.005, 0.010), (cx, -0.0595, cz), sm, bevel=0.001, parent=root, uv=False)
        zc.rotation_euler = (0, math.radians(ang), 0)
        L.box(f"{aid}_chestpull", (0.005, 0.0025, 0.016), (cx + ln / 2 - 0.01, -0.0635, cz - 0.012), M["satin"], bevel=0.001, parent=root, uv=False)
    for sx in (-1, 1):
        zh = L.box(f"{aid}_handzip{sx}", (0.010, 0.005, 0.115), (sx * 0.135, -0.052, -0.545), sm, bevel=0.001, parent=root, uv=False)
        zh.rotation_euler = (0, math.radians(sx * 16), 0)
        L.box(f"{aid}_handpull{sx}", (0.005, 0.0025, 0.015), (sx * 0.125, -0.057, -0.492), M["satin"], bevel=0.001, parent=root, uv=False)
    logo_patch(aid, root, (-0.082, -0.059, -0.205), CHAR, (0.55, 0.62, 0.42))
    P.collision_box(f"COL_{aid}", (0.53, 0.18, 0.76), (0, 0, -0.38), M, root)
    P.product_sockets(root, pickup=(0, 0, -0.3), hang=(0, 0, 0))
    return root


def leg(aid, tag, mat, sm, parent, *, sx, z0=-0.10, length, r0=0.085, r1=0.058, crease=True):
    secs = [(sx * 0.088, 0.002, z0, r0, 0.047), (sx * 0.086, 0.004, z0 - length * 0.18, r0 * 0.92, 0.0445),
            (sx * 0.083, 0.002, z0 - length * 0.45, r0 * 0.80, 0.042), (sx * 0.080, 0.0, z0 - length * 0.72, r1 * 1.06, 0.040),
            (sx * 0.078, -0.002, z0 - length * 0.96, r1, 0.0385), (sx * 0.078, -0.002, z0 - length, r1 * 0.99, 0.038)]
    P.loft(f"{aid}_leg{tag}", secs, (0, 0, 0), mat, parent=parent, ring=16, uv=True, plane="xy")
    if crease:
        pts = [(sx * (0.088 - (0.088 - 0.078) * t), -0.045 + 0.004 * t, z0 - length * t) for t in (0.06, 0.35, 0.65, 0.97)]
        P.tube_path(f"{aid}_crease{tag}", P.smooth_wire(pts, n=12), 0.0011, mat, parent=parent, verts=4)
    # hem cuff stitch
    ring_pts = [(sx * 0.078 + math.cos(a) * r1 * 0.985, math.sin(a) * 0.0375 - 0.002, z0 - length + 0.012) for a in
                [2 * math.pi * i / 16 for i in range(17)]]
    P.tube_path(f"{aid}_hemstitch{tag}", ring_pts, 0.0006, sm, parent=parent, verts=4)


def waistband(aid, mat, sm, parent, *, M, z=-0.065, w=0.175, loops=5):
    P.loft(f"{aid}_waist", [(0, 0, z - 0.036, w, 0.051), (0, 0, z - 0.005, w + 0.002, 0.0515), (0, 0, z, w * 0.99, 0.050)],
           (0, 0, 0), mat, parent=parent, ring=20, uv=False, plane="xy")
    # waistband top stitch
    pts = [(math.cos(a) * w, math.sin(a) * 0.050 - 0.001, z - 0.033) for a in [2 * math.pi * i / 20 for i in range(21)]]
    P.tube_path(f"{aid}_wbstitch", pts, 0.0006, sm, parent=parent, verts=4)
    L.cyl(f"{aid}_button", 0.006, 0.0035, (0, -0.0505, z - 0.018), M["brass"], rot=(math.radians(90), 0, 0), parent=parent, verts=12)
    for i in range(loops):
        a = -math.pi / 2 + (i - (loops - 1) / 2) * 0.62
        bx, by = math.cos(a + math.pi / 2) * w * 0.92, math.sin(a + math.pi / 2) * 0.048
        lp = L.box(f"{aid}_loop{i}", (0.011, 0.0055, 0.030), (bx, by - 0.003 if by < 0 else by, z - 0.019), mat, bevel=0.0015, parent=parent, uv=False)
        lp.rotation_euler = (0, 0, a + math.pi / 2)
    # fly J-stitch
    P.tube_path(f"{aid}_fly", P.smooth_wire([(0.0135, -0.049, z - 0.038), (0.014, -0.047, z - 0.10), (0.006, -0.0455, z - 0.125)], n=8),
                0.0008, sm, parent=parent, verts=4)


def back_welts(aid, mat, sm, parent, *, z, w=0.175):
    for sx in (-1, 1):
        L.box(f"{aid}_welt{sx}", (0.062, 0.004, 0.011), (sx * 0.085, 0.0475, z), mat, bevel=0.0015, parent=parent, uv=False)
        P.tube_path(f"{aid}_weltstitch{sx}", [(sx * 0.085 - 0.031, 0.0498, z - 0.007), (sx * 0.085 + 0.031, 0.0498, z - 0.007)],
                    0.0005, sm, parent=parent, verts=4)


def build_pants_hanging(M):
    aid = "pf_pants_hanging"
    root = P.asset_root(aid, (0.36, 0.11, 1.02), category="apparel", extra={"material_variants": VARIANT_NOTE, "hanging": True})
    m = P.fabric_mat("M_PantsCreamV2", CREAM, "twill", rough=0.62, nstr=0.45, seed=181)
    sm = seam_mat(CREAM, "M_PantsSeam")
    waistband(aid, m, sm, root, M=M)
    for sx in (-1, 1):
        leg(aid, "L" if sx < 0 else "R", m, sm, root, sx=sx, length=0.86)
    back_welts(aid, m, sm, root, z=-0.135)
    P.collision_box(f"COL_{aid}", (0.37, 0.12, 1.02), (0, 0, -0.51), M, root)
    P.product_sockets(root, pickup=(0, 0, -0.4), hang=(0, 0, 0))
    return root


def build_shorts_hanging(M):
    aid = "pf_shorts_hanging"
    root = P.asset_root(aid, (0.37, 0.11, 0.46), category="apparel", extra={"material_variants": VARIANT_NOTE + ",apparel_khaki", "hanging": True})
    m = P.fabric_mat("M_ShortsNavyV2", NAVY, "twill", rough=0.62, nstr=0.45, seed=183)
    sm = seam_mat((0.10, 0.12, 0.20), "M_ShortsSeam")
    waistband(aid, m, sm, root, M=M)
    for sx in (-1, 1):
        leg(aid, "L" if sx < 0 else "R", m, sm, root, sx=sx, length=0.285, r0=0.088, r1=0.079, crease=False)
    back_welts(aid, m, sm, root, z=-0.13)
    # side pocket openings
    for sx in (-1, 1):
        P.tube_path(f"{aid}_pocket{sx}", [(sx * 0.155, -0.030, -0.105), (sx * 0.128, -0.042, -0.185)], 0.0011, sm, parent=root, verts=4)
    P.collision_box(f"COL_{aid}", (0.38, 0.12, 0.46), (0, 0, -0.23), M, root)
    P.product_sockets(root, pickup=(0, 0, -0.2), hang=(0, 0, 0))
    return root


def folded(aid, base, kind, dims, M, *, collar=False, waist=False, variants=VARIANT_NOTE):
    root = P.asset_root(aid, dims, category="apparel", extra={"material_variants": variants})
    m = P.fabric_mat(f"M_{aid}V2", base, kind, rough=0.72, nstr=0.35, seed=185)
    sm = seam_mat(base, f"M_{aid}Seam")
    W, D, H = dims
    P.pillow(f"{aid}_body", (W, D, H), (0, 0, H / 2), m, round_frac=0.5, parent=root)
    # folded-edge rolls left/right + fold seam grooves on top
    for sx in (-1, 1):
        L.cyl(f"{aid}_roll{sx}", H * 0.42, D * 0.86, (sx * (W / 2 - H * 0.18), 0, H * 0.52), m, rot=(math.radians(90), 0, 0), parent=root, verts=12)
        P.tube_path(f"{aid}_foldline{sx}", [(sx * W * 0.19, -D * 0.44, H * 1.005), (sx * W * 0.19, D * 0.44, H * 1.005)],
                    0.0012, sm, parent=root, verts=4)
    if collar:
        # folded sleeves peeking from under the sides
        for sx in (-1, 1):
            wg = P.pillow(f"{aid}_slvfold{sx}", (W * 0.24, D * 0.34, H * 0.5), (sx * W * 0.36, D * 0.12, H * 0.72), m, round_frac=0.8, parent=root, uv=False)
            wg.rotation_euler = (0, 0, math.radians(-sx * 16))
        # two-piece collar: band + folded points
        P.pillow(f"{aid}_collar", (W * 0.42, D * 0.20, H * 0.52), (0, -D * 0.315, H * 1.0), m, round_frac=0.7, parent=root, uv=False)
        for sx in (-1, 1):
            pt = P.pillow(f"{aid}_collarpt{sx}", (W * 0.13, D * 0.14, H * 0.34), (sx * W * 0.135, -D * 0.375, H * 0.92), m, round_frac=0.6, parent=root, uv=False)
            pt.rotation_euler = (0, 0, math.radians(sx * 22))
        for bi in (0, 1):
            L.cyl(f"{aid}_btn{bi}", 0.0045, 0.003, (0, -D * (0.40 - bi * 0.09), H * 0.86 - bi * 0.001), M["board"], rot=(math.radians(90), 0, 0), parent=root, verts=10)
        P.tube_path(f"{aid}_plk", [(0, -D * 0.44, H * 1.0), (0, -D * 0.22, H * 1.01)], 0.0011, sm, parent=root, verts=4)
    if waist:
        # waistband across the front edge + centre seat seam + creases
        P.pillow(f"{aid}_band", (W * 0.98, D * 0.24, H * 0.42), (0, -D * 0.35, H * 0.88), m, round_frac=0.6, parent=root, uv=False)
        L.cyl(f"{aid}_wbtn", 0.005, 0.003, (0, -D * 0.445, H * 0.88), M["brass"], rot=(math.radians(90), 0, 0), parent=root, verts=10)
        for lx in (-0.11, 0.11):
            lp = L.box(f"{aid}_loop{lx}", (0.010, 0.0045, 0.016), (lx * W, -D * 0.42, H * 0.90), m, bevel=0.001, parent=root, uv=False)
            lp.rotation_euler = (math.radians(90), 0, 0)
        P.tube_path(f"{aid}_seatseam", [(0, -D * 0.22, H * 1.008), (0, D * 0.44, H * 1.005)], 0.0012, sm, parent=root, verts=4)
        for sx in (-1, 1):
            P.tube_path(f"{aid}_crease{sx}", [(sx * W * 0.24, -D * 0.18, H * 1.004), (sx * W * 0.24, D * 0.42, H * 1.002)],
                        0.0009, sm, parent=root, verts=4)
    P.collision_box(f"COL_{aid}", (W + 0.004, D + 0.004, H + 0.004), (0, 0, H / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H * 0.6))
    return root


REG = {
    "pf_hanger_wood": build_hanger_wood,
    "pf_hanger_metal": build_hanger_metal,
    "pf_hanger_clip": build_hanger_clip,
    "pf_polo_hanging": build_polo,
    "pf_quarterzip_hanging": build_quarterzip,
    "pf_hoodie_hanging": build_hoodie,
    "pf_jacket_hanging": build_jacket,
    "pf_pants_hanging": build_pants_hanging,
    "pf_shorts_hanging": build_shorts_hanging,
    "pf_polo_folded": lambda M: folded("pf_polo_folded", CREAM, "pique", (0.27, 0.35, 0.028), M, collar=True),
    "pf_quarterzip_folded": lambda M: folded("pf_quarterzip_folded", SAGE, "knit", (0.27, 0.35, 0.030), M, collar=True),
    "pf_pants_folded": lambda M: folded("pf_pants_folded", CREAM, "twill", (0.29, 0.37, 0.032), M, waist=True),
    "pf_shorts_folded": lambda M: folded("pf_shorts_folded", KHAKI, "twill", (0.27, 0.32, 0.028), M, waist=True, variants=VARIANT_NOTE + ",apparel_khaki"),
}

META = {}
for _a in REG:
    hang = "_hanging" in _a or "hanger" in _a
    META[_a] = {
        "name": _a.replace("pf_", "PF ").replace("_", " ").title(),
        "variant": "base", "price": 64.99 if "hang" not in _a else 12.99,
        "fixture": "pf_fixture_apparel_wall" if hang else "pf_fixture_center_table",
        "slot_type": "hanger_slot" if ("_hanging" in _a or "hanger" in _a) else "folded_slot",
        "packaging": "none",
    }

P.run_batch(REG, kind="products", category_of=lambda a: "apparel", manifest_extra=lambda a: META.get(a))
