"""Shared club-building parts for the Prime Fairways club lines.

Clubs are authored STANDING: grip butt at Z=0, shaft up +Z, head at the top
with its face toward -Y (as racked in R27, heads up).  Origin = grip butt.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import bmesh
import lib_props as L
import proshop_lib as P

GREEN = (0.30, 0.44, 0.12)


def grip_mat(vid="std"):
    return P.m_tex("M_ClubGrip", P.np_image("ClubGripTex", P.base_arr((0.020, 0.021, 0.023), 128, 256, mottle=0.12, seed=121)),
                   rough=0.82, normal=P.nrm_img("knurl", strength=1.0), uvscale=4.0)


def shaft_and_grip(aid, root, M, *, length, shaft="graphite", grip_len=0.26):
    """Vertical shaft: butt z=0 .. tip z=length.  Returns tip z."""
    smat = {"graphite": P.m_flat("M_ShaftGraphite", (0.035, 0.036, 0.040), rough=0.25, metal=0.6),
            "steel": P.m_flat("M_ShaftSteel", (0.52, 0.54, 0.57), rough=0.18, metal=1.0),
            "black": P.m_flat("M_ShaftBlack", (0.022, 0.023, 0.026), rough=0.3, metal=0.5)}[shaft]
    gm = grip_mat()
    # grip (slight taper, butt cap) — butt at bottom, taper down toward tip side
    L.frustum(f"{aid}_grip", 0.0135, 0.0122, grip_len, (0, 0, grip_len / 2), gm, segments=14, parent=root, uv=False)
    L.cyl(f"{aid}_buttcap", 0.0138, 0.006, (0, 0, 0.003), M["rubber"], parent=root, verts=14)
    L.cyl(f"{aid}_gripring", 0.0125, 0.004, (0, 0, grip_len + 0.002), P.m_flat("M_GripRing", GREEN, rough=0.4), parent=root, verts=14)
    sh_len = length - grip_len - 0.006
    L.frustum(f"{aid}_shaft", 0.0060, 0.0046, sh_len, (0, 0, grip_len + 0.006 + sh_len / 2), smat, segments=14, parent=root, uv=False)
    L.frustum(f"{aid}_ferrule", 0.0052, 0.0068, 0.014, (0, 0, length - 0.007), M["rubber"], segments=12, parent=root, uv=False)
    return length


def crown_decal(aid, text, loc, parent, *, col=(0.85, 0.84, 0.80), w=0.052, h=0.018, base=(0.015, 0.016, 0.018), rot=(0, 0, 0)):
    arr = P.canvas(base, 256, 96, ss=3, mottle=0.02, seed=123)
    P.draw_text(arr, text, 128, 40, 2, col)
    P.draw_text(arr, "PRIME FAIRWAYS", 128, 74, 1, (0.35, 0.42, 0.20))
    m = P.m_tex(f"M_Decal_{aid}", P.np_image(f"Decal_{aid}", arr), rough=0.3)
    P.uv_box(f"{aid}_decal", (w, h, 0.0012), loc, m, parent=parent, rot=rot,
             face_uv={"+Z": (0, 0, 1, 1), "-Z": (0, 0, 1, 1)})


def wood_head(aid, root, M, *, tip_z, size=1.0, style="x", name="AERO MAX", gloss=None, carbon=False):
    """A 460cc-style head (scaled by `size`), racked: crown faces -Y/up-tilted.
    Built under an IDENTITY holder (parent_keep preserves world transforms),
    then the holder is moved/rotated at the end so children follow."""
    holder = L.empty(f"{aid}_headroot", (0, 0, 0), parent=root)
    gloss = gloss or P.m_tex("M_HeadGloss", P.np_image("HeadGlossAlb", P.base_arr((0.014, 0.015, 0.018), 256, 256, mottle=0.02, seed=125)),
                             rough=0.08, metal=0.45, coat=1.0)
    crown_mat = M["carbon"] if carbon else gloss
    s = size
    # body loft: sections along Y (face at -Y, back at +Y)
    secs = [(0, -0.050 * s, 0.0, 0.052 * s, 0.0230 * s),
            (0, -0.030 * s, 0.0, 0.060 * s, 0.0285 * s),
            (0, 0.000 * s, 0.0, 0.0625 * s, 0.0305 * s),
            (0, 0.030 * s, 0.0, 0.057 * s, 0.0270 * s),
            (0, 0.052 * s, 0.0, 0.042 * s, 0.0200 * s)]
    P.loft(f"{aid}_head", secs, (0, 0, 0), crown_mat, parent=holder, ring=18, uv=True)
    # face plate (milled grooves)
    face = P.m_tex("M_FaceSteel", P.np_image("FaceSteelAlb", P.base_arr((0.30, 0.31, 0.33), 128, 128, mottle=0.03, seed=127)),
                   rough=0.32, metal=0.85, normal=P.nrm_img("rib", strength=1.2), uvscale=3.0)
    P.loft(f"{aid}_face", [(0, -0.0535 * s, 0, 0.049 * s, 0.0215 * s), (0, -0.049 * s, 0, 0.050 * s, 0.0225 * s)],
           (0, 0, 0), face, parent=holder, ring=16, uv=False)
    # sole accent + crown style geometry
    acc = P.m_flat(f"M_HeadAcc_{aid}", (0.55, 0.56, 0.58), rough=0.3, metal=0.8)
    grn = P.m_flat("M_HeadGreen", GREEN, rough=0.35)
    if style == "x":       # silver X blades on crown
        for sx in (-1, 1):
            b = P.pillow(f"{aid}_cx{sx}", (0.055 * s, 0.012 * s, 0.004), (sx * 0.02 * s, 0.004, 0.026 * s), acc, round_frac=0.9, parent=holder, uv=False)
            b.rotation_euler = (0, 0, math.radians(28 * sx))
    elif style == "v":     # V sweep
        for sx in (-1, 1):
            b = P.pillow(f"{aid}_cv{sx}", (0.048 * s, 0.010 * s, 0.004), (sx * 0.018 * s, 0.014, 0.026 * s), acc, round_frac=0.9, parent=holder, uv=False)
            b.rotation_euler = (0, 0, math.radians(-38 * sx))
    elif style == "y":     # chevron frame
        b = P.pillow(f"{aid}_cy", (0.052 * s, 0.010 * s, 0.004), (0, -0.004, 0.0265 * s), acc, round_frac=0.9, parent=holder, uv=False)
        for sx in (-1, 1):
            b2 = P.pillow(f"{aid}_cy{sx}", (0.036 * s, 0.009 * s, 0.004), (sx * 0.026 * s, 0.022, 0.024 * s), acc, round_frac=0.9, parent=holder, uv=False)
            b2.rotation_euler = (0, 0, math.radians(55 * sx))
    elif style == "wing":  # wing crown
        for sx in (-1, 1):
            b = P.pillow(f"{aid}_cw{sx}", (0.050 * s, 0.014 * s, 0.004), (sx * 0.024 * s, 0.006, 0.025 * s), acc, round_frac=0.9, parent=holder, uv=False)
            b.rotation_euler = (0, 0, math.radians(12 * sx))
    # green accent line at face-crown edge
    P.pillow(f"{aid}_accline", (0.085 * s, 0.004, 0.0035), (0, -0.0435 * s, 0.0275 * s), grn, round_frac=0.9, parent=holder, uv=False)
    # name decal on crown
    crown_decal(aid, name, (0, 0.008, 0.0315 * s), holder)
    # sole weight pad
    P.pillow(f"{aid}_soleplate", (0.05 * s, 0.05 * s, 0.006), (0, 0.012, -0.028 * s), acc, round_frac=0.7, parent=holder, uv=False)
    # hosel
    L.cyl(f"{aid}_hosel", 0.0062, 0.030, (0, -0.038 * s, 0.030 * s), gloss, rot=(math.radians(18), 0, 0), parent=holder, verts=12)
    bpy.context.view_layer.update()
    holder.rotation_euler = (math.radians(52), 0, 0)
    holder.location = (0, 0.012, tip_z - 0.012)
    return holder


def iron_head(aid, root, M, *, tip_z, kind="players", name="AERO FORGED"):
    """Racked iron: blade up, back (cavity) toward -Y viewer.  Identity-holder pattern."""
    holder = L.empty(f"{aid}_headroot", (0, 0, 0), parent=root)
    chrome = M["chrome"]
    satin = M["satin"]
    thick = {"players": 0.0075, "cavity": 0.010, "gameimp": 0.013, "distance": 0.015}[kind]
    W, Hh = 0.078, 0.052
    # blade silhouette (heel low -> toe high curve): rings in YZ, chained along X
    secs = []
    for t in [0.0, 0.22, 0.5, 0.78, 1.0]:
        x = -W * 0.44 + W * t
        hh = Hh * (0.55 + 0.5 * math.sin(min(1.0, t * 1.15) * math.pi * 0.5))
        secs.append((x, 0.0, hh * 0.5 - 0.004, thick * (0.7 + 0.5 * t) * 0.5, hh * 0.5))
    P.loft(f"{aid}_blade", secs, (0, 0, 0), chrome, parent=holder, ring=12, uv=False, plane="yz")
    # cavity badge on back
    if kind != "players":
        depth = {"cavity": 0.005, "gameimp": 0.007, "distance": 0.008}[kind]
        P.pillow(f"{aid}_badge", (W * 0.55, depth, Hh * 0.42), (0.004, thick * 0.55, Hh * 0.10), M["black"], round_frac=0.6, parent=holder, uv=False)
        arr = P.canvas((0.02, 0.021, 0.024), 192, 96, ss=3, mottle=0.03, seed=127)
        P.draw_text(arr, name.split()[0], 96, 36, 2, (0.80, 0.79, 0.75))
        P.draw_text(arr, name.split()[-1] if len(name.split()) > 1 else "", 96, 66, 1, GREEN)
        m = P.m_tex(f"M_IronBadge_{aid}", P.np_image(f"IronBadge_{aid}", arr), rough=0.35)
        P.uv_box(f"{aid}_badgeplate", (W * 0.40, 0.0016, Hh * 0.30), (0.004, thick * 0.55 + depth * 0.55, Hh * 0.10), m,
                 parent=holder, rot=(math.radians(90), 0, 0), face_uv={"+Z": (0, 0, 1, 1), "-Z": (0, 0, 1, 1)})
    else:
        # muscle-back stamp plate
        arr = P.canvas((0.60, 0.61, 0.63), 192, 64, ss=3, mottle=0.02, seed=129)
        P.draw_text(arr, name, 96, 32, 1, (0.20, 0.21, 0.22))
        m = P.m_tex(f"M_IronStamp_{aid}", P.np_image(f"IronStamp_{aid}", arr), rough=0.3, metal=0.7)
        P.uv_box(f"{aid}_stamp", (W * 0.44, 0.0014, Hh * 0.22), (0.004, thick * 0.62, Hh * 0.12), m,
                 parent=holder, rot=(math.radians(90), 0, 0), face_uv={"+Z": (0, 0, 1, 1), "-Z": (0, 0, 1, 1)})
    # sole
    P.pillow(f"{aid}_sole", (W * 0.96, thick * 1.5, 0.008), (0.002, thick * 0.2, -Hh * 0.48), satin, round_frac=0.9, parent=holder, uv=False)
    # hosel: bent tube heel -> shaft
    pts = P.smooth_wire([(-W * 0.44, 0, Hh * 0.30), (-W * 0.46, 0, Hh * 0.55), (-W * 0.44, -0.002, Hh * 0.80)], n=10)
    P.tube_path(f"{aid}_hosel", pts, 0.0060, chrome, parent=holder)
    bpy.context.view_layer.update()
    holder.rotation_euler = (math.radians(38), 0, math.radians(6))
    holder.location = (0, 0.004, tip_z - 0.006)
    return holder


def putter_head(aid, root, M, *, tip_z, kind="blade"):
    holder = L.empty(f"{aid}_headroot", (0, 0, 0), parent=root)
    dark = P.m_flat("M_PutterDark", (0.040, 0.042, 0.046), rough=0.35, metal=0.6)
    milled = P.m_flat("M_PutterFace", (0.055, 0.057, 0.062), rough=0.5, metal=0.4)
    white = P.m_flat("M_PutterSight", (0.85, 0.85, 0.82), rough=0.4)
    if kind == "blade":
        L.rounded_box(f"{aid}_body", (0.105, 0.030, 0.026), (0, 0, 0), dark, corner=0.008, parent=holder, bevel=0.003)
        P.uv_box(f"{aid}_faceplate", (0.098, 0.0025, 0.020), (0, -0.0165, 0), milled, parent=holder)
        P.uv_box(f"{aid}_sight", (0.028, 0.014, 0.0022), (0, 0.006, 0.0135), white, parent=holder)
        pts = P.smooth_wire([(-0.040, 0.000, 0.012), (-0.046, -0.004, 0.030), (-0.040, -0.006, 0.045)], n=8)
        P.tube_path(f"{aid}_neck", pts, 0.005, dark, parent=holder)
    elif kind == "wide":
        L.rounded_box(f"{aid}_body", (0.102, 0.052, 0.024), (0, 0.006, 0), dark, corner=0.014, parent=holder, bevel=0.003)
        P.uv_box(f"{aid}_faceplate", (0.096, 0.0025, 0.018), (0, -0.021, 0), milled, parent=holder)
        P.uv_box(f"{aid}_sight", (0.0035, 0.036, 0.0022), (0, 0.012, 0.0125), white, parent=holder)
        pts = P.smooth_wire([(-0.038, 0.00, 0.010), (-0.044, -0.004, 0.028), (-0.038, -0.006, 0.044)], n=8)
        P.tube_path(f"{aid}_neck", pts, 0.005, dark, parent=holder)
    elif kind == "spider":
        L.rounded_box(f"{aid}_core", (0.080, 0.048, 0.026), (0, -0.008, 0), dark, corner=0.012, parent=holder, bevel=0.003)
        for sx in (-1, 1):
            L.rounded_box(f"{aid}_fang{sx}", (0.022, 0.052, 0.020), (sx * 0.042, 0.026, -0.002), dark, corner=0.010, parent=holder, bevel=0.003)
        P.uv_box(f"{aid}_bridge", (0.062, 0.016, 0.014), (0, 0.048, -0.004), dark, parent=holder)
        P.uv_box(f"{aid}_faceplate", (0.076, 0.0025, 0.020), (0, -0.0345, 0), milled, parent=holder)
        for sx in (-1, 1):
            P.uv_box(f"{aid}_rail{sx}", (0.0035, 0.070, 0.0022), (sx * 0.014, 0.016, 0.0135), white, parent=holder)
    else:  # fang
        L.rounded_box(f"{aid}_core", (0.092, 0.040, 0.024), (0, -0.012, 0), dark, corner=0.016, parent=holder, bevel=0.003)
        for sx in (-1, 1):
            b = L.rounded_box(f"{aid}_horn{sx}", (0.024, 0.050, 0.018), (sx * 0.036, 0.022, -0.002), dark, corner=0.011, parent=holder, bevel=0.003)
        P.uv_box(f"{aid}_faceplate", (0.086, 0.0025, 0.018), (0, -0.0335, 0), milled, parent=holder)
        P.uv_box(f"{aid}_sight", (0.0035, 0.030, 0.0022), (0, 0.002, 0.0125), white, parent=holder)
    bpy.context.view_layer.update()
    holder.rotation_euler = (math.radians(55), 0, 0)
    holder.location = (0, 0.006, tip_z - 0.004)
    return holder


def club_asset(aid, M, *, length, head_fn, shaft="graphite", category, lean_note=None):
    root = P.asset_root(aid, (0.13, 0.13, length), category=category)
    shaft_and_grip(aid, root, M, length=length, shaft=shaft)
    head_fn(aid, root, M)
    P.collision_box(f"COL_{aid}", (0.13, 0.13, length + 0.03), (0, 0, (length + 0.03) / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, length * 0.4))
    P.socket("CLUB_BUTT", (0, 0, 0), root, props={"socket": "club_butt"})
    P.socket("CLUB_HEAD_POINT", (0, 0, length), root, props={"socket": "club_head"})
    return root
