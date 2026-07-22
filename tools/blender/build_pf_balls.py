"""Prime Fairways golf-ball line: 4 retail boxes + loose balls.

  pf_ballbox_tour12     PRIME TOUR premium 12 (black + gold)
  pf_ballsleeve_value3  BIRDIE value 3-sleeve (green, window, 2 visible balls)
  pf_ballbox_range12    RANGE practice 12 (navy, window, 4 neon balls)
  pf_ballbox_soft12     EAGLE soft feel 12 (navy/white sweep)
  pf_ball_loose_white   loose PRIME TOUR ball
  pf_ball_loose_yellow  loose RANGE practice ball

Run: blender --background --factory-startup --python tools/blender/build_pf_balls.py -- all render
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_props as L
import proshop_lib as P
import pf_brand as B

GOLD = (0.55, 0.38, 0.12)
CREAM_INK = (0.90, 0.88, 0.82)
BALL_D = P.STD["products"]["golf_ball"]["diameter"]


# ------------------------------------------------------------- ball texture ----

def ball_arr(base, mark, mark_col, *, seed=3, w=256, h=256):
    import numpy as np
    arr = P.base_arr(base, w, h, mottle=0.015, seed=seed)
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    cell = 13.0
    ox = np.where(((yy // cell) % 2) > 0.5, cell / 2, 0.0)
    px_ = ((xx + ox) % cell) / cell - 0.5
    py_ = (yy % cell) / cell - 0.5
    d2 = px_ ** 2 + py_ ** 2
    dimple = np.clip(1.0 - d2 * 11.0, 0, 1)
    shade = 1.0 - dimple * 0.10 + np.clip(dimple - 0.55, 0, 1) * 0.05
    arr = np.clip(arr * shade[..., None], 0, 1)
    P.draw_text(arr, mark, w // 2, int(h * 0.47), 2, mark_col)
    P.draw_text(arr, "1", w // 2, int(h * 0.60), 2, mark_col)
    return arr


def loose_ball(aid, base, mark, mark_col, M):
    root = P.asset_root(aid, (BALL_D, BALL_D, BALL_D), category="golf_balls")
    img = P.np_image(f"{aid}_tex", ball_arr(base, mark, mark_col))
    m = P.m_tex(f"M_{aid}", img, rough=0.38, normal=P.nrm_img("dimple", strength=1.2), coat=0.5)
    b = L.sphere("Ball_Body", BALL_D / 2, (0, 0, BALL_D / 2), m, parent=root, segs=24)
    L.activate(b)
    try:
        import bpy
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.sphere_project()
        bpy.ops.object.mode_set(mode="OBJECT")
    except Exception:
        pass
    P.collision_box("COL_Ball", (BALL_D, BALL_D, BALL_D), (0, 0, BALL_D / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, BALL_D / 2))
    return root


# ------------------------------------------------------------- box atlases -----

def tour12_atlas():
    import numpy as np
    w = h = 1024
    black = (0.020, 0.021, 0.023)
    arr = P.canvas(black, w, h, ss=3, mottle=0.04, seed=9)
    q = 512
    # corner pixel patch = cut-edge tint
    P.rect(arr, 0, 0, 10, 10, (0.55, 0.52, 0.45))

    def face(x0, y0, *, front=False, side=False, back=False, flap=False):
        x1, y1 = x0 + q, y0 + q
        P.frame(arr, x0 + 14, y0 + 14, x1 - 14, y1 - 14, 3, GOLD)
        cx = (x0 + x1) // 2
        if front:
            # crown
            cy = y0 + 120
            P.tri(arr, (cx - 60, cy + 26), (cx + 60, cy + 26), (cx, cy - 6), GOLD)
            for dx in (-44, 0, 44):
                P.tri(arr, (cx + dx - 16, cy + 4), (cx + dx + 16, cy + 4), (cx + dx, cy - 34), GOLD)
            P.disc(arr, cx - 44, cy - 38, 7, 7, GOLD)
            P.disc(arr, cx, cy - 42, 7, 7, GOLD)
            P.disc(arr, cx + 44, cy - 38, 7, 7, GOLD)
            P.draw_text(arr, "PRIME TOUR", cx, y0 + 210, 6, CREAM_INK)
            P.draw_text(arr, "PREMIUM PERFORMANCE", cx, y0 + 262, 2, GOLD)
            # gold V sweep
            for i in range(4):
                P.tri(arr, (x0 + 40 + i * 3, y0 + 320 + i * 26), (cx, y0 + 420 + i * 26), (cx, y0 + 412 + i * 26), GOLD)
                P.tri(arr, (x1 - 40 - i * 3, y0 + 320 + i * 26), (cx, y0 + 420 + i * 26), (cx, y0 + 412 + i * 26), GOLD)
            B.icon_row(arr, cx - 40, y0 + 424, ["4-PIECE", "LOW SPIN", "DISTANCE"], 13, CREAM_INK, gap=130)
            P.draw_text(arr, "12", x1 - 46, y1 - 62, 4, CREAM_INK, align="right")
            P.draw_text(arr, "GOLF BALLS", x1 - 40, y1 - 30, 1, CREAM_INK, align="right")
        if side:
            for i, ch in enumerate("PRIME TOUR"):
                P.draw_text(arr, ch, cx, y0 + 90 + i * 34, 3, CREAM_INK)
            P.draw_text(arr, "12", cx, y1 - 80, 4, GOLD)
        if back:
            P.draw_text(arr, "PRIME FAIRWAYS GOLF", cx, y0 + 70, 2, CREAM_INK)
            for i in range(5):
                P.rect(arr, x0 + 60, y0 + 120 + i * 40, x1 - 60, y0 + 126 + i * 40, (0.10, 0.10, 0.10))
            P.barcode(arr, x0 + 150, y1 - 150, x1 - 150, y1 - 70, seed=5, digits="7 41260 11207 4")
        if flap:
            P.draw_text(arr, "PRIME TOUR", cx, y0 + q // 2, 3, GOLD)
    face(0, 0, front=True)
    face(512, 0, side=True)
    face(0, 512, flap=True)
    face(512, 512, back=True)
    return P.np_image("BallBoxTour12", arr)


def soft12_atlas():
    import numpy as np
    w = h = 1024
    arr = P.canvas((0.80, 0.80, 0.78), w, h, ss=3, mottle=0.02, seed=12)
    navy = P.PF_NAVY
    teal = (0.05, 0.22, 0.28)
    q = 512
    P.rect(arr, 0, 0, 10, 10, (0.75, 0.74, 0.70))

    def eagle(cx, cy, s, col):
        P.tri(arr, (cx - s, cy + s * 0.35), (cx + s * 0.15, cy - s * 0.25), (cx + s, cy - s * 0.05), col)
        P.tri(arr, (cx - s * 0.6, cy + s * 0.55), (cx + s * 0.1, cy + s * 0.05), (cx + s * 0.9, cy + s * 0.35), col)
        P.disc(arr, cx + s * 0.72, cy - s * 0.28, s * 0.22, s * 0.18, col)
        P.tri(arr, (cx + s * 0.86, cy - s * 0.30), (cx + s * 1.05, cy - s * 0.22), (cx + s * 0.86, cy - s * 0.14), (0.85, 0.60, 0.15))

    def face(x0, y0, *, front=False, side=False, back=False, flap=False):
        x1, y1 = x0 + q, y0 + q
        cx = (x0 + x1) // 2
        # navy sweep down the right
        for i in range(q):
            t = i / q
            xs = x0 + int(q * (0.62 + 0.22 * math.sin(t * 3.1 + 0.4)))
            P.rect(arr, xs, y0 + i, x1, y0 + i + 1, navy)
        if front:
            eagle(cx - 60, y0 + 120, 60, navy)
            P.draw_text(arr, "EAGLE", cx - 40, y0 + 220, 6, navy)
            P.draw_text(arr, "SOFT FEEL", cx - 40, y0 + 274, 3, teal)
            P.draw_text(arr, "DESIGNED FOR", x0 + 60, y0 + 330, 2, navy, align="left")
            P.draw_text(arr, "COMFORT & CONTROL", x0 + 60, y0 + 362, 2, navy, align="left")
            B.icon_row(arr, cx - 60, y0 + 430, ["SOFT", "LAUNCH", "STRAIGHT"], 13, navy, gap=130)
            P.draw_text(arr, "12", x1 - 120, y1 - 60, 4, CREAM_INK)
            P.draw_text(arr, "GOLF BALLS", x1 - 120, y1 - 26, 1, CREAM_INK)
        if side:
            eagle(cx, y0 + 90, 40, navy)
            for i, ch in enumerate("EAGLE"):
                P.draw_text(arr, ch, cx - 30, y0 + 170 + i * 40, 4, navy)
            P.draw_text(arr, "SOFT FEEL", cx - 30, y1 - 60, 1, teal)
        if back:
            P.draw_text(arr, "EAGLE SOFT FEEL", cx, y0 + 70, 2, navy)
            for i in range(5):
                P.rect(arr, x0 + 60, y0 + 120 + i * 40, x1 - 130, y0 + 126 + i * 40, (0.32, 0.34, 0.36))
            P.barcode(arr, x0 + 130, y1 - 150, x1 - 170, y1 - 70, seed=8, digits="7 41260 55873 1")
        if flap:
            eagle(cx, y0 + q // 2 - 30, 44, navy)
            P.draw_text(arr, "EAGLE", cx, y0 + q // 2 + 60, 3, navy)
    face(0, 0, front=True)
    face(512, 0, side=True)
    face(0, 512, flap=True)
    face(512, 512, back=True)
    return P.np_image("BallBoxSoft12", arr)


def range12_atlas():
    w = h = 1024
    navy = (0.030, 0.045, 0.085)
    arr = P.canvas(navy, w, h, ss=3, mottle=0.05, seed=6)
    orange = (0.72, 0.26, 0.03)
    q = 512
    P.rect(arr, 0, 0, 10, 10, (0.05, 0.06, 0.10))

    def face(x0, y0, *, front=False, side=False, back=False, flap=False):
        x1, y1 = x0 + q, y0 + q
        cx = (x0 + x1) // 2
        # radar arcs motif
        for r_ in (140, 200, 260):
            P.ring(arr, x0 + 90, y0 + 120, r_, r_, 3, (0.06, 0.09, 0.16))
        P.tri(arr, (x0, y0), (x0 + 150, y0), (x0, y0 + 60), orange)
        P.tri(arr, (x0 + 20, y0), (x0 + 170, y0), (x0, y0 + 84), (0.55, 0.55, 0.12))
        if front:
            P.draw_text(arr, "RANGE", cx, y0 + 150, 7, (0.92, 0.92, 0.90))
            P.draw_text(arr, "PRACTICE BALLS", cx, y0 + 215, 3, orange)
            # window frame print aligned to the geometry hole (z 0.044..0.098 of H=0.15)
            P.frame(arr, x0 + 76, y0 + 171, x1 - 76, y0 + 367, 6, (0.85, 0.85, 0.83))
            P.draw_text(arr, "BRIGHT COLORS * EASY TO TRACK", cx - 30, y0 + 400, 2, (0.85, 0.85, 0.83))
            P.rect(arr, x1 - 150, y1 - 92, x1 - 52, y1 - 30, orange)
            P.draw_text(arr, "12", x1 - 101, y1 - 70, 3, (0.95, 0.95, 0.93))
            P.draw_text(arr, "BALLS", x1 - 101, y1 - 44, 1, (0.95, 0.95, 0.93))
        if side:
            for i, ch in enumerate("RANGE"):
                P.draw_text(arr, ch, cx, y0 + 110 + i * 44, 4, (0.9, 0.9, 0.88))
            P.draw_text(arr, "PRACTICE", cx, y1 - 90, 2, orange)
        if back:
            P.draw_text(arr, "RANGE PRACTICE BALLS", cx, y0 + 70, 2, (0.9, 0.9, 0.88))
            for i in range(5):
                P.rect(arr, x0 + 60, y0 + 120 + i * 40, x1 - 60, y0 + 126 + i * 40, (0.10, 0.13, 0.20))
            P.barcode(arr, x0 + 150, y1 - 150, x1 - 150, y1 - 70, seed=4, digits="7 41260 33452 8")
        if flap:
            P.draw_text(arr, "RANGE", cx, y0 + q // 2, 4, orange)
    face(0, 0, front=True)
    face(512, 0, side=True)
    face(0, 512, flap=True)
    face(512, 512, back=True)
    return P.np_image("BallBoxRange12", arr)


def value3_atlas():
    """1024x1024: left column u 0..0.5 = front (window), right = side/back art."""
    w = h = 1024
    green = (0.055, 0.16, 0.075)
    arr = P.canvas((0.78, 0.79, 0.76), w, h, ss=3, mottle=0.02, seed=14)
    P.rect(arr, 0, 0, 10, 10, (0.70, 0.71, 0.68))
    half = 512
    for x0, is_front in ((0, True), (half, False)):
        x1 = x0 + half
        cx = (x0 + x1) // 2
        # green diagonal sweep
        for i in range(h):
            t = i / h
            xs = x0 + int(half * (0.60 + 0.32 * (1 - t)))
            P.rect(arr, xs, i, x1, i + 1, green)
        P.rect(arr, x0, 0, x1, 66, green)
        P.draw_text(arr, "3 BALLS", cx, 34, 2, (0.9, 0.92, 0.88))
        P.draw_text(arr, "BIRDIE", cx, 116, 5, green)
        P.draw_text(arr, "VALUE PACK", cx, 166, 2, (0.30, 0.42, 0.28))
        if is_front:
            # window frame print aligned to hole z 0.048..0.135 of H=0.155
            P.frame(arr, x0 + 64, 126, x1 - 64, 712, 6, green)
        else:
            for i, ch in enumerate("BIRDIE"):
                P.draw_text(arr, ch, cx, 240 + i * 56, 4, green)
        for i, t in enumerate(["DISTANCE", "DURABILITY", "GREAT PRICE"]):
            P.draw_text(arr, t, cx - 30, 748 + i * 42, 2, (0.16, 0.18, 0.16))
            P.rect(arr, cx + 66, 744 + i * 42, cx + 104, 750 + i * 42, green)
        P.barcode(arr, x0 + 130, 892, x1 - 130, 968, seed=11, digits="7 41260 90218 6")
    return P.np_image("BallSleeveValue3", arr)


# ---------------------------------------------------------------- box build ----

window_panel = P.window_panel


def closed_box(aid, dims, atlas_img, M, *, rough=0.5):
    """Standard 6-face retail box mapped to the quadrant atlas."""
    W, D, H = dims
    root = P.asset_root(aid, dims, category="golf_balls")
    m = P.m_tex(f"M_{aid}", atlas_img, rough=rough)
    F = (0.0, 0.5, 0.5, 1.0)     # front
    S = (0.5, 0.5, 1.0, 1.0)     # sides
    FL = (0.0, 0.0, 0.5, 0.5)    # flaps
    BK = (0.5, 0.0, 1.0, 0.5)    # back
    P.uv_box(f"{aid}_body", (W, D, H), (0, 0, H / 2), m, parent=root, bevel=0.0015,
             face_uv={"-Y": F, "+Y": BK, "-X": S, "+X": S, "+Z": FL, "-Z": FL})
    P.collision_box(f"COL_{aid}", (W, D, H), (0, 0, H / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H * 0.55), barcode=(0, D / 2, H / 2))
    return root


def build_tour12(M):
    return closed_box("pf_ballbox_tour12", (0.192, 0.052, 0.14), tour12_atlas(), M)


def build_soft12(M):
    return closed_box("pf_ballbox_soft12", (0.192, 0.052, 0.14), soft12_atlas(), M)


def build_range12(M):
    dims = (0.20, 0.056, 0.15)
    W, D, H = dims
    aid = "pf_ballbox_range12"
    root = P.asset_root(aid, dims, category="golf_balls")
    img = range12_atlas()
    m = P.m_tex(f"M_{aid}", img, rough=0.5)
    F = (0.0, 0.5, 0.5, 1.0)
    S = (0.5, 0.5, 1.0, 1.0)
    FL = (0.0, 0.0, 0.5, 0.5)
    BK = (0.5, 0.0, 1.0, 0.5)
    T = 0.0022
    # window in front face: x 0.032..0.168, z 0.044..0.098  (matches printed frame)
    win = (0.032, 0.044, 0.168, 0.098)
    window_panel(f"{aid}_front", W, H, T, win, m, F, root, y=-D / 2 + T / 2)
    P.uv_box(f"{aid}_back", (W, T, H), (0, D / 2 - T / 2, H / 2), m, parent=root, face_uv={"-Y": BK, "+Y": BK})
    for sx in (-1, 1):
        P.uv_box(f"{aid}_side{'L' if sx < 0 else 'R'}", (T, D - 2 * T, H), (sx * (W / 2 - T / 2), 0, H / 2), m,
                 parent=root, face_uv={"-X": S, "+X": S})
    P.uv_box(f"{aid}_top", (W, D, T), (0, 0, H - T / 2), m, parent=root, face_uv={"+Z": FL, "-Z": FL})
    P.uv_box(f"{aid}_bot", (W, D, T), (0, 0, T / 2), m, parent=root, face_uv={"+Z": FL, "-Z": FL})
    # interior liner + 4 neon balls visible through the window
    P.uv_box(f"{aid}_liner", (W - 0.004, 0.02, H - 0.004), (0, D / 2 - 0.013, H / 2), M["board"], parent=root)
    neon = {"yellow": (0.75, 0.68, 0.02), "orange": (0.78, 0.24, 0.02), "green": (0.35, 0.68, 0.04), "pink": (0.80, 0.06, 0.16)}
    bx = -0.0495
    bz = (win[1] + win[3]) / 2
    for name, col in neon.items():
        img_b = P.np_image(f"RangeBall_{name}", ball_arr(col, "RANGE", (0.10, 0.11, 0.12), seed=7))
        mb = P.m_tex(f"M_RangeBall_{name}", img_b, rough=0.4, normal=P.nrm_img("dimple", strength=1.0))
        L.sphere(f"{aid}_ball_{name}", 0.0163, (bx, -D / 2 + 0.021, bz), mb, parent=root, segs=18)
        bx += 0.033
    P.collision_box(f"COL_{aid}", (W, D, H), (0, 0, H / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H * 0.55), barcode=(0, D / 2, H / 2))
    return root


def build_value3(M):
    dims = (0.048, 0.048, 0.155)
    W, D, H = dims
    aid = "pf_ballsleeve_value3"
    root = P.asset_root(aid, dims, category="golf_balls")
    img = value3_atlas()
    m = P.m_tex(f"M_{aid}", img, rough=0.5)
    FRONT = (0.0, 0.0, 0.5, 1.0)
    SIDE = (0.5, 0.0, 1.0, 1.0)
    T = 0.0018
    win = (0.006, 0.048, 0.042, 0.135)
    window_panel(f"{aid}_front", W, H, T, win, m, FRONT, root, y=-D / 2 + T / 2)
    P.uv_box(f"{aid}_back", (W, T, H), (0, D / 2 - T / 2, H / 2), m, parent=root, face_uv={"-Y": SIDE, "+Y": SIDE})
    for sx in (-1, 1):
        P.uv_box(f"{aid}_side{'L' if sx < 0 else 'R'}", (T, D - 2 * T, H), (sx * (W / 2 - T / 2), 0, H / 2), m,
                 parent=root, face_uv={"-X": SIDE, "+X": SIDE})
    P.uv_box(f"{aid}_top", (W, D, T), (0, 0, H - T / 2), M["green"], parent=root)
    P.uv_box(f"{aid}_bot", (W, D, T), (0, 0, T / 2), M["green"], parent=root)
    img_b = P.np_image("ValueBall", ball_arr((0.80, 0.80, 0.78), "BIRDIE", (0.06, 0.16, 0.075), seed=9))
    mb = P.m_tex("M_ValueBall", img_b, rough=0.4, normal=P.nrm_img("dimple", strength=1.0))
    for z in (0.0275, 0.0705, 0.1135):
        L.sphere(f"{aid}_ball_{z}", BALL_D / 2, (0, 0, z), mb, parent=root, segs=18)
    P.collision_box(f"COL_{aid}", (W, D, H), (0, 0, H / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H * 0.6), barcode=(0, D / 2, H * 0.15))
    return root


REG = {
    "pf_ballbox_tour12": build_tour12,
    "pf_ballbox_soft12": build_soft12,
    "pf_ballbox_range12": build_range12,
    "pf_ballsleeve_value3": build_value3,
    "pf_ball_loose_white": lambda M: loose_ball("pf_ball_loose_white", (0.80, 0.80, 0.78), "PRIME", (0.15, 0.15, 0.17), M),
    "pf_ball_loose_yellow": lambda M: loose_ball("pf_ball_loose_yellow", (0.75, 0.68, 0.02), "RANGE", (0.10, 0.11, 0.12), M),
}

META = {
    "pf_ballbox_tour12": {"name": "Prime Tour Premium 12-Ball Box", "variant": "tour_black", "price": 54.99, "fixture": "pf_fixture_ball_shelf", "slot_type": "shelf_box", "packaging": "closed retail box", "material": "premium board"},
    "pf_ballbox_soft12": {"name": "Eagle Soft Feel 12-Ball Box", "variant": "soft_navy", "price": 32.99, "fixture": "pf_fixture_ball_shelf", "slot_type": "shelf_box", "packaging": "closed retail box", "material": "retail board"},
    "pf_ballbox_range12": {"name": "Range Practice Balls 12", "variant": "range_navy", "price": 19.99, "fixture": "pf_fixture_ball_shelf", "slot_type": "shelf_box", "packaging": "window retail box", "material": "retail board"},
    "pf_ballsleeve_value3": {"name": "Birdie Value 3-Ball Sleeve", "variant": "value_green", "price": 8.99, "fixture": "pf_fixture_ball_shelf", "slot_type": "shelf_box", "packaging": "window sleeve", "material": "retail board"},
    "pf_ball_loose_white": {"name": "Prime Tour Golf Ball", "variant": "white", "price": 4.99, "fixture": "pf_fixture_ball_shelf", "slot_type": "shelf_loose", "packaging": "loose", "material": "urethane"},
    "pf_ball_loose_yellow": {"name": "Range Practice Ball", "variant": "yellow", "price": 1.99, "fixture": "pf_fixture_ball_shelf", "slot_type": "shelf_loose", "packaging": "loose", "material": "surlyn"},
}

P.run_batch(REG, kind="products", category_of=lambda a: "golf_balls", manifest_extra=lambda a: META.get(a))
