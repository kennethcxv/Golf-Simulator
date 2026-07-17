"""Prime Fairways scorecard line (R09):
  pf_scorecard_course    folded course scorecard (tent display) - PRIME FAIRWAYS GC
  pf_scorecard_booklet   navy premium player's booklet with brass corners
  pf_scorecard_holeguide single hole-guide card
  pf_scorecard_mini      small writable scorecard
  pf_pencil              green hex pencil
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import lib_props as L
import proshop_lib as P
import pf_brand as B

CREAMP = (0.80, 0.77, 0.66)
DGREEN = (0.075, 0.155, 0.085)
NAVY = (0.035, 0.05, 0.11)
GOLDI = (0.55, 0.40, 0.14)
INK = (0.12, 0.13, 0.12)


def course_cover_arr():
    w, h = 1024, 512
    arr = P.canvas(CREAMP, w, h, ss=3, mottle=0.02, seed=51)
    # left half = front cover, right half = back cover
    for x0, is_front in ((0, True), (512, False)):
        x1 = x0 + 512
        cx = (x0 + x1) // 2
        P.frame(arr, x0 + 26, 26, x1 - 26, h - 26, 4, DGREEN)
        P.frame(arr, x0 + 38, 38, x1 - 38, h - 38, 2, DGREEN)
        if is_front:
            # crossed clubs + ball crest
            cy = 150
            for ang in (-0.5, 0.5):
                for t in range(-70, 70, 4):
                    px = cx + math.sin(ang) * t
                    py = cy + math.cos(ang) * t
                    P.rect(arr, px - 3, py - 3, px + 3, py + 3, DGREEN)
                P.disc(arr, cx + math.sin(ang) * -78, cy + math.cos(ang) * -78, 9, 12, DGREEN)
            P.disc(arr, cx, cy - 88, 16, 16, (0.92, 0.92, 0.88))
            P.ring(arr, cx, cy - 88, 16, 16, 3, DGREEN)
            P.draw_text(arr, "EST", cx - 96, cy, 2, GOLDI)
            P.draw_text(arr, "2024", cx + 96, cy, 2, GOLDI)
            P.draw_text(arr, "PRIME FAIRWAYS", cx, 300, 4, DGREEN)
            P.draw_text(arr, "GOLF CLUB", cx, 348, 3, DGREEN)
            P.rect(arr, x0 + 120, 400, x1 - 120, 444, DGREEN)
            P.draw_text(arr, "SCORECARD", cx, 422, 2, (0.9, 0.9, 0.85))
        else:
            P.draw_text(arr, "PLAY WELL", cx, 200, 3, DGREEN)
            P.draw_text(arr, "KEEP HONOR", cx, 250, 3, DGREEN)
            B.flag_mound(arr, cx, 340, 90, DGREEN)
    return P.np_image("ScorecardCover", arr)


def course_inside_arr():
    w, h = 1024, 512
    arr = P.canvas((0.83, 0.81, 0.72), w, h, ss=3, mottle=0.015, seed=53)
    # hole table across both halves
    P.rect(arr, 40, 40, w - 40, 90, DGREEN)
    heads = ["HOLE", "PAR", "BLUE", "WHITE", "GOLD", "HCP", "P1", "P2", "P3", "P4"]
    colw = (w - 80) / len(heads)
    for i, t in enumerate(heads):
        P.draw_text(arr, t, int(40 + colw * (i + 0.5)), 65, 2, (0.9, 0.9, 0.85))
        P.rect(arr, int(40 + colw * i), 40, int(40 + colw * i) + 2, h - 120, DGREEN)
    import numpy as np
    rng = np.random.default_rng(3)
    for r_ in range(9):
        y = 90 + r_ * 32
        P.rect(arr, 40, y + 30, w - 40, y + 32, (0.55, 0.55, 0.48))
        vals = [str(r_ + 1), str([4, 5, 3, 4, 4, 3, 4, 5, 4][r_]), str(410 - r_ * 12), str(390 - r_ * 12), str(360 - r_ * 12), str(rng.integers(1, 18))]
        for i, v in enumerate(vals):
            P.draw_text(arr, v, int(40 + colw * (i + 0.5)), y + 16, 1, INK)
    # tree skyline footer
    P.rect(arr, 40, h - 100, w - 40, h - 40, (0.55, 0.60, 0.48))
    for tx in range(80, w - 60, 60):
        P.tri(arr, (tx - 18, h - 44), (tx + 18, h - 44), (tx, h - 96), DGREEN)
    return P.np_image("ScorecardInside", arr)


def build_course(M):
    aid = "pf_scorecard_course"
    cw, ch = 0.155, 0.11    # closed panel size
    T = 0.0012
    root = P.asset_root(aid, (cw, 0.09, ch), category="scorecards")
    cov = P.m_tex("M_SCCover", course_cover_arr(), rough=0.62)
    ins = P.m_tex("M_SCInside", course_inside_arr(), rough=0.62)
    ang = math.radians(16)
    # tent: outer sheets carry the cover art, inner sheets the hole table
    for s in (-1, 1):   # s=-1 front panel, s=+1 back panel
        rot = (-s * ang, 0, 0)
        yc = s * (math.sin(ang) * ch / 2)
        zc = math.cos(ang) * ch / 2
        outer_face = "-Y" if s < 0 else "+Y"
        cov_region = (0.0, 0.0, 0.5, 1.0) if s < 0 else (0.5, 0.0, 1.0, 1.0)
        ins_region = (0.0, 0.0, 0.5, 1.0) if s < 0 else (0.5, 0.0, 1.0, 1.0)
        P.uv_box(f"{aid}_outer{s}", (cw, T, ch), (0, yc + s * T * 0.6, zc), cov, rot=rot, parent=root,
                 face_uv={outer_face: cov_region, ("+Y" if s < 0 else "-Y"): cov_region})
        P.uv_box(f"{aid}_inner{s}", (cw, T, ch), (0, yc - s * T * 0.6, zc), ins, rot=rot, parent=root,
                 face_uv={("+Y" if s < 0 else "-Y"): ins_region, outer_face: ins_region})
    P.collision_box(f"COL_{aid}", (cw, math.sin(ang) * ch * 2 + 0.004, math.cos(ang) * ch), (0, 0, math.cos(ang) * ch / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, ch * 0.5))
    return root


def booklet_cover_arr():
    w = h = 512
    arr = P.canvas(NAVY, w, h, ss=3, mottle=0.06, seed=57)
    P.frame(arr, 30, 30, w - 30, h - 30, 4, GOLDI)
    P.frame(arr, 42, 42, w - 42, h - 42, 2, GOLDI)
    cx = w // 2
    B.crest(arr, cx, 170, 130, GOLDI, field=NAVY, mono="PF")
    # laurel dashes
    for s in (-1, 1):
        for i in range(7):
            a = math.radians(30 + i * 18)
            px = cx + s * math.sin(a) * 105
            py = 170 + math.cos(a) * 95
            P.disc(arr, px, py, 7, 4, GOLDI)
    P.draw_text(arr, "PLAYER'S", cx, 330, 3, GOLDI)
    P.draw_text(arr, "SCORECARD", cx, 372, 3, GOLDI)
    P.rect(arr, cx - 24, 396, cx + 24, 400, GOLDI)
    P.draw_text(arr, "PLAY WELL. KEEP HONOR.", cx, 428, 1, (0.55, 0.52, 0.42))
    return P.np_image("BookletCover", arr)


def build_booklet(M):
    aid = "pf_scorecard_booklet"
    W, D, H = 0.11, 0.014, 0.15
    root = P.asset_root(aid, (W, D, H), category="scorecards")
    leather = P.m_tex("M_BookNavy", P.np_image("BookNavy", P.leather_arr(NAVY, 256, 256, seed=59, pebble=0.14)), rough=0.5)
    cover = P.m_tex("M_BookCover", booklet_cover_arr(), rough=0.5)
    P.uv_box(f"{aid}_block", (W - 0.004, D - 0.004, H - 0.004), (0.002, 0, H / 2), M["paper"], parent=root)
    P.uv_box(f"{aid}_cover", (W, 0.0022, H), (0, -D / 2 + 0.0011, H / 2), cover, parent=root, bevel=0.0008,
             face_uv={"-Y": (0, 0, 1, 1), "+Y": (0, 0, 1, 1)})
    P.uv_box(f"{aid}_backcover", (W, 0.0022, H), (0, D / 2 - 0.0011, H / 2), leather, parent=root, bevel=0.0008)
    P.uv_box(f"{aid}_spine", (0.0024, D, H), (-W / 2 + 0.0012, 0, H / 2), leather, parent=root, bevel=0.0008)
    for cz in (0.012, H - 0.012):
        for cy in (-D / 2 + 0.002, D / 2 - 0.002):
            L.box(f"{aid}_corner{cz:.3f}{cy:.3f}", (0.016, 0.004, 0.016), (W / 2 - 0.007, cy, cz), M["brass"], bevel=0.0015, parent=root, uv=False)
    P.collision_box(f"COL_{aid}", (W, D, H), (0, 0, H / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H / 2))
    return root


def holeguide_arr():
    w, h = 512, 1024
    arr = P.canvas((0.83, 0.81, 0.72), w, h, ss=3, mottle=0.015, seed=61)
    P.frame(arr, 20, 20, w - 20, h - 20, 4, DGREEN)
    P.draw_text(arr, "7", 110, 120, 8, DGREEN)
    P.draw_text(arr, "PAR 4", 110, 220, 3, INK)
    P.draw_text(arr, "HDCP 1", 110, 270, 2, INK)
    # vertical hole map
    P.rect(arr, 250, 60, 470, 640, (0.60, 0.65, 0.52))
    for i in range(14):
        t = i / 13
        cxm = 360 + math.sin(t * 2.6) * 55
        P.disc(arr, cxm, 620 - t * 530, 58 - t * 18, 30, (0.42, 0.52, 0.34))
    P.disc(arr, 388, 108, 30, 20, (0.55, 0.60, 0.48))
    P.disc(arr, 344, 200, 16, 10, (0.78, 0.72, 0.48))
    P.disc(arr, 415, 300, 18, 11, (0.78, 0.72, 0.48))
    P.rect(arr, 386, 78, 389, 110, (0.85, 0.85, 0.82))
    P.tri(arr, (389, 78), (389, 94), (412, 86), (0.6, 0.12, 0.06))
    for i, (t, d) in enumerate([("BLUE", "450"), ("WHITE", "430"), ("GOLD", "400"), ("RED", "360")]):
        y = 700 + i * 52
        P.disc(arr, 70, y, 12, 12, [(0.1, 0.2, 0.5), (0.8, 0.8, 0.78), (0.7, 0.55, 0.1), (0.6, 0.1, 0.08)][i])
        P.draw_text(arr, t, 150, y, 2, INK, align="left")
        P.draw_text(arr, d, 340, y, 2, INK, align="left")
    P.rect(arr, 40, 920, w - 40, 990, DGREEN)
    P.draw_text(arr, "TIP: A STRAIGHT DRIVE", w // 2, 944, 1, (0.88, 0.88, 0.82))
    P.draw_text(arr, "SETS UP THE APPROACH", w // 2, 968, 1, (0.88, 0.88, 0.82))
    return P.np_image("HoleGuide", arr)


def build_holeguide(M):
    aid = "pf_scorecard_holeguide"
    W, D, H = 0.09, 0.0016, 0.14
    root = P.asset_root(aid, (W, D, H), category="scorecards")
    m = P.m_tex("M_HoleGuide", holeguide_arr(), rough=0.62)
    P.uv_box(f"{aid}_card", (W, D, H), (0, 0, H / 2), m, parent=root, bevel=0.0006,
             face_uv={"-Y": (0, 0, 1, 1), "+Y": (0, 0, 1, 1)})
    P.collision_box(f"COL_{aid}", (W, 0.004, H), (0, 0, H / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H / 2))
    return root


def mini_arr():
    w, h = 1024, 512
    arr = P.canvas((0.84, 0.82, 0.74), w, h, ss=3, mottle=0.012, seed=63)
    P.rect(arr, 30, 40, w - 30, 96, DGREEN)
    cols = ["HOLE"] + [str(i) for i in range(1, 10)] + ["OUT"]
    colw = (w - 60) / len(cols)
    for i, t in enumerate(cols):
        P.draw_text(arr, t, int(30 + colw * (i + 0.5)), 68, 2, (0.9, 0.9, 0.85))
        P.rect(arr, int(30 + colw * i), 40, int(30 + colw * i) + 2, h - 130, (0.5, 0.5, 0.44))
    rows = ["PAR", "P1", "P2", "P3"]
    import numpy as np
    rng = np.random.default_rng(5)
    for r_, t in enumerate(rows):
        y = 96 + r_ * 60
        P.rect(arr, 30, y + 58, w - 30, y + 60, (0.5, 0.5, 0.44))
        P.draw_text(arr, t, int(30 + colw * 0.5), y + 30, 2, INK)
        if t in ("PAR", "P1", "P2"):
            for c in range(1, 10):
                P.draw_text(arr, str(rng.integers(3, 6)), int(30 + colw * (c + 0.5)), y + 30, 2, (0.25, 0.28, 0.30))
    P.draw_text(arr, "NOTES", 90, h - 80, 2, INK, align="left")
    P.rect(arr, 200, h - 74, w - 60, h - 72, (0.5, 0.5, 0.44))
    return P.np_image("MiniCard", arr)


def build_mini(M):
    aid = "pf_scorecard_mini"
    W, D, H = 0.125, 0.0016, 0.095
    root = P.asset_root(aid, (W, D, H), category="scorecards")
    m = P.m_tex("M_MiniCard", mini_arr(), rough=0.62)
    P.uv_box(f"{aid}_card", (W, D, H), (0, 0, H / 2), m, parent=root, bevel=0.0006,
             face_uv={"-Y": (0, 0, 1, 1), "+Y": (0, 0, 1, 1)})
    P.collision_box(f"COL_{aid}", (W, 0.004, H), (0, 0, H / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H / 2))
    return root


def build_pencil(M):
    aid = "pf_pencil"
    Ln, r = 0.09, 0.00375
    root = P.asset_root(aid, (Ln, r * 2, r * 2), category="scorecards")
    green = P.m_flat("M_PencilGreen", (0.10, 0.22, 0.12), rough=0.4)
    wood = P.m_flat("M_PencilWood", (0.62, 0.46, 0.26), rough=0.6)
    lead = P.m_flat("M_PencilLead", (0.08, 0.08, 0.09), rough=0.4)
    pink = P.m_flat("M_PencilPink", (0.72, 0.35, 0.38), rough=0.6)
    rot = (0, math.radians(90), 0)
    L.cyl(f"{aid}_body", r, Ln * 0.72, (-Ln * 0.05, 0, r), green, rot=rot, parent=root, verts=6)
    P.lathe(f"{aid}_tipwood", [(0.0, 0.0), (r * 0.92, 0.0), (0.0012, 0.0095), (0.0, 0.0105)],
            (-Ln * 0.41, 0, r), wood, steps=12, rot=(0, math.radians(90), 0), parent=root, uv=False)
    P.lathe(f"{aid}_lead", [(0.0, 0.0), (0.0011, 0.0), (0.0, 0.003)], (-Ln * 0.53, 0, r), lead, steps=10,
            rot=(0, math.radians(90), 0), parent=root, uv=False)
    L.cyl(f"{aid}_ferrule", r * 1.02, 0.008, (Ln * 0.315, 0, r), M["brass"], rot=rot, parent=root, verts=12)
    L.cyl(f"{aid}_eraser", r * 0.95, 0.009, (Ln * 0.395, 0, r), pink, rot=rot, parent=root, verts=12)
    P.collision_box(f"COL_{aid}", (Ln, r * 2.4, r * 2.4), (0, 0, r), M, root)
    P.product_sockets(root, pickup=(0, 0, r))
    return root


REG = {
    "pf_scorecard_course": build_course,
    "pf_scorecard_booklet": build_booklet,
    "pf_scorecard_holeguide": build_holeguide,
    "pf_scorecard_mini": build_mini,
    "pf_pencil": build_pencil,
}

META = {
    "pf_scorecard_course": {"name": "PF Golf Club Scorecard", "variant": "course", "price": 2.99, "fixture": "pf_fixture_rangefinder_display", "slot_type": "shelf_card", "packaging": "folded card"},
    "pf_scorecard_booklet": {"name": "Player's Scorecard Booklet", "variant": "navy_gold", "price": 24.99, "fixture": "pf_fixture_rangefinder_display", "slot_type": "shelf_card", "packaging": "hardcover"},
    "pf_scorecard_holeguide": {"name": "Hole Guide Card", "variant": "hole7", "price": 1.99, "fixture": "pf_fixture_rangefinder_display", "slot_type": "shelf_card", "packaging": "card"},
    "pf_scorecard_mini": {"name": "Mini Scorecard", "variant": "mini", "price": 0.99, "fixture": "pf_fixture_rangefinder_display", "slot_type": "shelf_card", "packaging": "card"},
    "pf_pencil": {"name": "PF Scoring Pencil", "variant": "green", "price": 0.49, "fixture": "pf_fixture_rangefinder_display", "slot_type": "loose", "packaging": "loose"},
}

P.run_batch(REG, kind="products", category_of=lambda a: "scorecards", manifest_extra=lambda a: META.get(a))
