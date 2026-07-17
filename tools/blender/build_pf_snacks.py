"""Prime Fairways snack line (R05):
  pf_snack_granola_box   FAIRWAY FUEL oats & honey granola bars (box of 6)
  pf_snack_trailmix      ELEVATE TRAIL MIX stand-up pouch
  pf_snack_protein_bar   GREEN DRIVE chocolate chip protein bar (flow wrap)
  pf_snack_chips         BUNKER BITES sour cream & chive potato chips
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import lib_props as L
import proshop_lib as P
import pf_brand as B

CREAM = (0.72, 0.68, 0.55)
DGREEN = (0.075, 0.16, 0.085)
LGREEN = (0.24, 0.38, 0.16)
BLUE = (0.055, 0.13, 0.34)
INK = (0.10, 0.13, 0.09)


def golf_scene(arr, x0, y0, x1, y1):
    """Small stylized course scene: sky, hills, flag."""
    P.rect(arr, x0, y0, x1, y1, (0.60, 0.63, 0.55))
    h = y1 - y0
    P.disc(arr, (x0 + x1) / 2 - 40, y1, (x1 - x0) * 0.7, h * 0.55, LGREEN)
    P.disc(arr, (x0 + x1) / 2 + 90, y1 + 8, (x1 - x0) * 0.6, h * 0.42, DGREEN)
    for tx in (x0 + 30, x1 - 40):
        P.disc(arr, tx, y0 + h * 0.45, 16, 22, DGREEN)
        P.rect(arr, tx - 2, y0 + h * 0.45 + 16, tx + 2, y0 + h * 0.75, (0.16, 0.10, 0.05))
    fx = (x0 + x1) / 2 + 30
    P.rect(arr, fx, y0 + h * 0.18, fx + 3, y0 + h * 0.62, (0.75, 0.75, 0.72))
    P.tri(arr, (fx + 3, y0 + h * 0.18), (fx + 3, y0 + h * 0.34), (fx + 40, y0 + h * 0.26), (0.55, 0.10, 0.06))
    return arr


def granola_atlas():
    w = h = 1024
    arr = P.canvas(CREAM, w, h, ss=3, mottle=0.03, seed=23)
    P.rect(arr, 0, 0, 10, 10, (0.62, 0.58, 0.47))
    q = 512

    def face(x0, y0, *, front=False, side=False, back=False, flap=False):
        x1, y1 = x0 + q, y0 + q
        cx = (x0 + x1) // 2
        if front or back:
            P.rect(arr, x0, y0, x1, y0 + 36, DGREEN)
            # flag ray crest
            fx, fy = cx, y0 + 86
            P.rect(arr, fx - 2, fy - 28, fx + 2, fy + 14, DGREEN)
            P.tri(arr, (fx + 2, fy - 28), (fx + 2, fy - 8), (fx + 34, fy - 18), DGREEN)
            for a in (-0.9, -0.45, 0.45, 0.9):
                ex = fx + math.sin(a) * 60
                ey = fy - 10 - math.cos(a) * 26
                P.rect(arr, ex - 2, ey - 6, ex + 2, ey, DGREEN)
            P.draw_text(arr, "FAIRWAY", cx, y0 + 150, 6, DGREEN)
            P.draw_text(arr, "-FUEL-", cx, y0 + 205, 5, DGREEN)
            P.rect(arr, x0 + 96, y0 + 238, x1 - 96, y0 + 282, DGREEN)
            P.draw_text(arr, "OATS & HONEY", cx, y0 + 260, 2, (0.88, 0.88, 0.80))
            P.draw_text(arr, "GRANOLA BARS", cx, y0 + 310, 2, INK)
            golf_scene(arr, x0 + 60, y0 + 336, x1 - 60, y0 + 430)
            # bar illustration over the scene
            P.rect(arr, cx - 120, y0 + 400, cx + 120, y0 + 440, (0.55, 0.38, 0.16))
            for bx in range(int(cx - 112), int(cx + 112), 16):
                P.disc(arr, bx, y0 + 408 + (bx % 3) * 8, 7, 5, (0.66, 0.48, 0.22))
            P.rect(arr, x0 + 30, y1 - 76, x0 + 130, y1 - 20, DGREEN)
            P.draw_text(arr, "6", x0 + 80, y1 - 58, 3, (0.9, 0.9, 0.84))
            P.draw_text(arr, "BARS", x0 + 80, y1 - 32, 1, (0.9, 0.9, 0.84))
            P.draw_text(arr, "NET WT 7.4 OZ (210G)", cx + 60, y1 - 40, 1, INK)
            if back:
                P.barcode(arr, x0 + 150, y0 + 460, x1 - 150, y1 - 30, seed=6, digits="8 33012 40233 5")
        if side:
            P.rect(arr, x0, y0, x1, y1, DGREEN)
            P.draw_text(arr, "MADE WITH", cx, y0 + 60, 2, CREAM)
            for i, t in enumerate(["WHOLE GRAINS", "NO ARTIFICIAL", "MADE FOR", "THE COURSE"]):
                P.ring(arr, cx, y0 + 130 + i * 100, 26, 26, 4, CREAM)
                P.draw_text(arr, t, cx, y0 + 176 + i * 100, 1, CREAM)
        if flap:
            P.draw_text(arr, "FAIRWAY FUEL", cx, y0 + q // 2, 3, DGREEN)
    face(0, 0, front=True)
    face(512, 0, side=True)
    face(0, 512, flap=True)
    face(512, 512, back=True)
    return P.np_image("SnackGranola", arr)


def build_granola(M):
    dims = (0.16, 0.05, 0.19)
    aid = "pf_snack_granola_box"
    root = P.asset_root(aid, dims, category="snacks")
    m = P.m_tex(f"M_{aid}", granola_atlas(), rough=0.55)
    P.uv_box(f"{aid}_body", dims, (0, 0, dims[2] / 2), m, parent=root, bevel=0.0015,
             face_uv={"-Y": (0, 0.5, 0.5, 1), "+Y": (0.5, 0, 1, 0.5), "-X": (0.5, 0.5, 1, 1),
                      "+X": (0.5, 0.5, 1, 1), "+Z": (0, 0, 0.5, 0.5), "-Z": (0, 0, 0.5, 0.5)})
    P.collision_box(f"COL_{aid}", dims, (0, 0, dims[2] / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.11), barcode=(0, dims[1] / 2, 0.06))
    return root


def trailmix_atlas():
    import numpy as np
    w = h = 1024
    arr = P.canvas((0.70, 0.66, 0.55), w, h, ss=3, mottle=0.03, seed=29)
    P.rect(arr, 0, 0, 10, 10, (0.05, 0.10, 0.26))
    half = 512
    rng = np.random.default_rng(7)
    for x0 in (0, half):
        x1 = x0 + half
        cx = (x0 + x1) // 2
        is_front = x0 == 0
        # blue header w/ mountain
        P.rect(arr, x0, 0, x1, 210, BLUE)
        P.tri(arr, (cx - 130, 200), (cx + 40, 200), (cx - 45, 66), (0.80, 0.82, 0.86))
        P.tri(arr, (cx - 45, 66), (cx - 80, 122), (cx - 10, 122), (0.95, 0.95, 0.96))
        P.tri(arr, (cx - 20, 200), (cx + 130, 200), (cx + 55, 96), (0.62, 0.66, 0.72))
        P.rect(arr, cx + 53, 60, cx + 57, 96, (0.9, 0.9, 0.9))
        P.tri(arr, (cx + 57, 60), (cx + 57, 78), (cx + 82, 69), (0.9, 0.9, 0.9))
        P.draw_text(arr, "ELEVATE", cx, 264, 6, BLUE)
        P.draw_text(arr, "TRAIL MIX", cx, 320, 3, INK)
        P.rect(arr, x0 + 70, 352, x1 - 70, 394, BLUE)
        P.draw_text(arr, "PEAK PERFORMANCE BLEND", cx, 373, 1, (0.88, 0.89, 0.92))
        P.draw_text(arr, "NUTS * SEEDS * FRUIT * CHOC", cx, 424, 1, INK)
        if is_front:
            # window print filled with drawn mix
            P.rect(arr, x0 + 80, 450, x1 - 80, 700, (0.30, 0.20, 0.10))
            P.frame(arr, x0 + 80, 450, x1 - 80, 700, 6, (0.85, 0.84, 0.80))
            cols = [(0.45, 0.28, 0.12), (0.55, 0.40, 0.18), (0.30, 0.16, 0.07), (0.60, 0.50, 0.28), (0.25, 0.10, 0.05)]
            for _ in range(160):
                px = rng.uniform(x0 + 95, x1 - 95)
                py = rng.uniform(465, 685)
                r = rng.uniform(7, 16)
                P.disc(arr, px, py, r, r * 0.8, cols[int(rng.integers(0, len(cols)))])
        else:
            B.icon_row(arr, cx, 560, ["ENERGY", "PROTEIN", "GO FUEL"], 20, BLUE, gap=150)
        P.draw_text(arr, "NET WT 5 OZ (142G)", cx, 740, 1, INK)
        if not is_front:
            P.barcode(arr, x0 + 150, 800, x1 - 150, 890, seed=9, digits="8 33012 77120 2")
    return P.np_image("SnackTrailmix", arr)


def build_trailmix(M):
    dims = (0.155, 0.085, 0.235)
    W, D, H = dims
    aid = "pf_snack_trailmix"
    root = P.asset_root(aid, dims, category="snacks")
    m = P.m_tex(f"M_{aid}", trailmix_atlas(), rough=0.45)
    body = P.uv_box(f"{aid}_body", (W, D * 0.72, H), (0, 0, H / 2), m, parent=root, bevel=0.006,
                    face_uv={"-Y": (0, 0.22, 0.5, 1), "+Y": (0.5, 0.22, 1, 1), "-X": (0.5, 0.22, 0.52, 1),
                             "+X": (0.98, 0.22, 1, 1), "+Z": (0.5, 0.95, 1, 1), "-Z": (0.5, 0.95, 1, 1)})
    # pouch silhouette: bulge base, pinch top seal
    me = body.data
    for v in me.vertices:
        t = v.co.z / H
        if t > 0.55:
            k = (t - 0.55) / 0.45
            v.co.y *= (1.0 - 0.88 * k * k)
        else:
            v.co.y *= (1.0 + 0.28 * (1.0 - t / 0.55))
    # top seal fin
    P.uv_box(f"{aid}_seal", (W * 0.98, 0.006, 0.014), (0, 0, H - 0.002), m, parent=root,
             face_uv={"-Y": (0.5, 0.95, 1, 1), "+Y": (0.5, 0.95, 1, 1)})
    P.collision_box(f"COL_{aid}", (W, D, H), (0, 0, H / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H * 0.55), barcode=(0, D / 2 - 0.01, H * 0.25))
    return root


def protein_atlas():
    w, h = 1024, 512
    arr = P.canvas(DGREEN, w, h, ss=3, mottle=0.04, seed=31)
    P.rect(arr, 0, 0, 10, 10, (0.06, 0.12, 0.07))
    # wrap: front art spans middle, crimp zones at ends
    cx = w // 2
    P.rect(arr, 120, 60, w - 120, h - 60, CREAM)
    golfer_x = 240
    P.disc(arr, golfer_x, 150, 16, 16, DGREEN)
    P.tri(arr, (golfer_x - 26, 260), (golfer_x + 18, 260), (golfer_x + 2, 168), DGREEN)
    P.rect(arr, golfer_x - 60, 170, golfer_x - 56, 230, DGREEN)
    P.tri(arr, (golfer_x - 60, 168), (golfer_x - 30, 182), (golfer_x - 56, 188), DGREEN)
    P.draw_text(arr, "GREEN", 520, 140, 6, DGREEN)
    P.draw_text(arr, "DRIVE", 520, 196, 6, DGREEN)
    P.draw_text(arr, "PROTEIN BAR", 520, 248, 2, INK)
    P.rect(arr, 380, 274, 660, 312, (0.22, 0.12, 0.05))
    P.draw_text(arr, "CHOCOLATE CHIP", 520, 293, 1, (0.85, 0.82, 0.76))
    P.rect(arr, 700, 110, 850, 220, DGREEN)
    P.draw_text(arr, "15G", 775, 150, 3, CREAM)
    P.draw_text(arr, "PROTEIN", 775, 190, 1, CREAM)
    P.draw_text(arr, "GLUTEN FREE * NO ARTIFICIALS", cx, h - 110, 1, INK)
    P.draw_text(arr, "2.12 OZ (60G)", 820, h - 110, 1, INK)
    P.barcode(arr, 120, h - 92, 260, h - 40, seed=13, digits="8 33012 55521 8")
    return P.np_image("SnackProtein", arr)


def build_protein(M):
    dims = (0.095, 0.035, 0.02)
    W, D, H = dims
    aid = "pf_snack_protein_bar"
    root = P.asset_root(aid, dims, category="snacks")
    m = P.m_tex(f"M_{aid}", protein_atlas(), rough=0.35)
    P.uv_box(f"{aid}_body", (W - 0.012, D, H), (0, 0, H / 2), m, parent=root, bevel=0.005,
             face_uv={"+Z": (0.12, 0.05, 0.88, 0.95), "-Z": (0.12, 0.05, 0.88, 0.95),
                      "-Y": (0.12, 0.0, 0.88, 0.12), "+Y": (0.12, 0.0, 0.88, 0.12),
                      "-X": (0.0, 0.0, 0.06, 0.5), "+X": (0.0, 0.0, 0.06, 0.5)})
    for sx in (-1, 1):
        P.uv_box(f"{aid}_crimp{'L' if sx < 0 else 'R'}", (0.007, D * 0.8, H * 0.4),
                 (sx * (W / 2 - 0.0035), 0, H / 2), m, parent=root,
                 face_uv={"+Z": (0.0, 0.0, 0.06, 0.5), "-Z": (0.0, 0.0, 0.06, 0.5),
                          "-Y": (0.0, 0.0, 0.06, 0.5), "+Y": (0.0, 0.0, 0.06, 0.5)})
    P.collision_box(f"COL_{aid}", dims, (0, 0, H / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H), barcode=(0.02, 0, H))
    return root


def chips_atlas():
    import numpy as np
    w = h = 1024
    arr = P.canvas(DGREEN, w, h, ss=3, mottle=0.05, seed=37)
    P.rect(arr, 0, 0, 10, 10, (0.06, 0.12, 0.07))
    half = 512
    rng = np.random.default_rng(11)
    for x0 in (0, half):
        x1 = x0 + half
        cx = (x0 + x1) // 2
        is_front = x0 == 0
        # cream center panel
        P.disc(arr, cx, 400, 215, 330, CREAM)
        # green banner
        P.disc(arr, cx, 130, 150, 60, LGREEN)
        P.disc(arr, cx, 122, 130, 44, (0.55, 0.58, 0.48))
        P.disc(arr, cx + 60, 118, 26, 14, (0.72, 0.66, 0.50))
        P.rect(arr, cx + 96, 96, cx + 99, 120, (0.55, 0.10, 0.06))
        P.tri(arr, (cx + 99, 96), (cx + 99, 108), (cx + 118, 102), (0.55, 0.10, 0.06))
        P.draw_text(arr, "BUNKER", cx, 210, 6, DGREEN)
        P.draw_text(arr, "BITES", cx, 266, 6, DGREEN)
        P.rect(arr, x0 + 110, 296, x1 - 110, 334, LGREEN)
        P.draw_text(arr, "SOUR CREAM & CHIVE", cx, 315, 1, (0.92, 0.92, 0.86))
        P.draw_text(arr, "POTATO CHIPS", cx, 362, 2, INK)
        if is_front:
            for _ in range(9):
                px = rng.uniform(cx - 130, cx + 130)
                py = rng.uniform(420, 560)
                r = rng.uniform(30, 46)
                P.disc(arr, px, py, r, r * 0.62, (0.78, 0.62, 0.22))
                P.disc(arr, px, py, r * 0.8, r * 0.45, (0.85, 0.72, 0.32))
            P.disc(arr, cx + 80, 600, 60, 34, (0.35, 0.42, 0.30))
            P.disc(arr, cx + 80, 592, 48, 24, (0.88, 0.88, 0.84))
            P.draw_text(arr, "MADE WITH REAL POTATOES", cx, 680, 1, INK)
        else:
            for i in range(5):
                P.rect(arr, x0 + 120, 430 + i * 40, x1 - 120, 436 + i * 40, (0.30, 0.34, 0.26))
            P.barcode(arr, x0 + 150, 640, x1 - 150, 720, seed=15, digits="8 33012 66302 9")
        P.draw_text(arr, "NET WT 1 OZ (28G)", cx, 760, 1, INK if not is_front else INK)
    return P.np_image("SnackChips", arr)


def build_chips(M):
    dims = (0.16, 0.055, 0.20)
    W, D, H = dims
    aid = "pf_snack_chips"
    root = P.asset_root(aid, dims, category="snacks")
    m = P.m_tex(f"M_{aid}", chips_atlas(), rough=0.3)
    body = P.uv_box(f"{aid}_body", (W, D, H * 0.92), (0, 0, H * 0.46), m, parent=root, bevel=0.012,
                    face_uv={"-Y": (0, 0.2, 0.5, 1.0), "+Y": (0.5, 0.2, 1, 1.0), "-X": (0.48, 0.2, 0.5, 1),
                             "+X": (0.98, 0.2, 1, 1), "+Z": (0, 0.0, 0.5, 0.2), "-Z": (0, 0.0, 0.5, 0.2)})
    me = body.data
    for v in me.vertices:
        t = max(0.0, min(1.0, v.co.z / (H * 0.92)))
        if t > 0.72:
            k = (t - 0.72) / 0.28
            v.co.y *= (1.0 - 0.90 * k * k)
        else:
            v.co.y *= (1.0 + 0.30 * math.sin(math.pi * t / 0.72 * 0.85))
    P.uv_box(f"{aid}_topcrimp", (W * 0.98, 0.006, 0.014), (0, 0, H * 0.92 + 0.004), m, parent=root,
             face_uv={"-Y": (0, 0.0, 0.5, 0.06), "+Y": (0, 0.0, 0.5, 0.06)})
    P.collision_box(f"COL_{aid}", (W, D, H * 0.95), (0, 0, H * 0.475), M, root)
    P.product_sockets(root, pickup=(0, 0, H * 0.5), barcode=(0, D / 2 - 0.008, H * 0.35))
    return root


REG = {
    "pf_snack_granola_box": build_granola,
    "pf_snack_trailmix": build_trailmix,
    "pf_snack_protein_bar": build_protein,
    "pf_snack_chips": build_chips,
}

META = {
    "pf_snack_granola_box": {"name": "Fairway Fuel Granola Bars (6)", "variant": "oats_honey", "price": 7.49, "fixture": "pf_fixture_snack_shelf", "slot_type": "shelf_box", "packaging": "carton"},
    "pf_snack_trailmix": {"name": "Elevate Trail Mix", "variant": "peak_blend", "price": 6.99, "fixture": "pf_fixture_snack_shelf", "slot_type": "shelf_pouch", "packaging": "stand-up pouch"},
    "pf_snack_protein_bar": {"name": "Green Drive Protein Bar", "variant": "chocolate_chip", "price": 3.49, "fixture": "pf_fixture_snack_shelf", "slot_type": "shelf_small", "packaging": "flow wrap"},
    "pf_snack_chips": {"name": "Bunker Bites Potato Chips", "variant": "sour_cream_chive", "price": 2.99, "fixture": "pf_fixture_snack_shelf", "slot_type": "shelf_bag", "packaging": "pillow bag"},
}

P.run_batch(REG, kind="products", category_of=lambda a: "snacks", manifest_extra=lambda a: META.get(a))
