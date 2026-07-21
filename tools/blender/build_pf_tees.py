"""Prime Fairways tee line: 4 retail tee boxes (open window, visible tees,
hang tab) + 4 loose tees.

  pf_teebox_wood / pf_teebox_performance / pf_teebox_bamboo / pf_teebox_prolaunch
  pf_tee_loose_wood / _white / _bamboo / _step
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import lib_props as L
import proshop_lib as P
import pf_brand as B

BOX = (0.078, 0.036, 0.115)
TAB_H = 0.024
GREEN = (0.10, 0.20, 0.11)
NAVY = P.PF_NAVY
INKD = (0.13, 0.14, 0.13)


def tee_profile(style):
    base = [(0.0005, 0.0), (0.0016, 0.006), (0.0020, 0.028), (0.0023, 0.046),
            (0.0032, 0.0555), (0.0056, 0.0635), (0.0058, 0.0665), (0.0040, 0.0655),
            (0.0034, 0.0605), (0.0, 0.060)]
    if style == "step":
        return [(0.0005, 0.0), (0.0016, 0.006), (0.0020, 0.030), (0.0042, 0.034), (0.0042, 0.040),
                (0.0024, 0.044), (0.0026, 0.050), (0.0034, 0.0565), (0.0056, 0.0640), (0.0058, 0.0665),
                (0.0040, 0.0655), (0.0034, 0.0605), (0.0, 0.060)]
    return base


def tee_mat(style, M):
    if style == "wood":
        return P.m_flat("M_TeeWood", (0.42, 0.26, 0.12), rough=0.55)
    if style == "bamboo":
        return P.m_flat("M_TeeBamboo", (0.50, 0.36, 0.16), rough=0.5)
    return P.m_flat("M_TeeWhite", (0.80, 0.80, 0.77), rough=0.45)


def band_color(style):
    return {"wood": None, "white": GREEN, "bamboo": NAVY, "step": NAVY}[style]


def make_tee(prefix, style, M, *, loc=(0, 0, 0), rot=(0, 0, 0), parent=None, lying=False):
    t = P.lathe(f"{prefix}_body", tee_profile(style), loc, tee_mat(style, M), steps=14, rot=rot, parent=parent, uv=False)
    bc = band_color(style)
    if bc:
        bmat = P.m_flat(f"M_TeeBand_{style}", bc, rough=0.5)
        zs = [0.052] if style != "step" else [0.048, 0.053, 0.058]
        for i, z in enumerate(zs):
            if lying:   # tee axis runs along +X when displayed flat
                bloc = (loc[0] + z, loc[1], loc[2])
                brot = (0, math.radians(90), 0)
            else:
                bloc = (loc[0], loc[1], loc[2] + z)
                brot = (0, 0, 0)
            L.cyl(f"{prefix}_band{i}", 0.00265, 0.0035 if style != "step" else 0.0022, bloc, bmat,
                  rot=brot, parent=parent, verts=12)
    return t


# ------------------------------------------------------------------ atlases ----

def bamboo_arr(w, h, *, seed=41):
    import numpy as np
    arr = P.base_arr((0.55, 0.42, 0.20), w, h, mottle=0.05, seed=seed)
    yy, xx = np.mgrid[0:h, 0:w]
    strip = ((xx // 126) % 2).astype("float32") * 0.06
    node = (((yy + 180 * ((xx // 126) % 3)) % 720) < 15).astype("float32") * 0.12
    arr = np.clip(arr * (1.0 - strip - node)[..., None], 0, 1)
    return arr


def teebox_atlas(variant):
    w = h = 1024
    half = 512
    if variant == "wood":
        arr = P.wrap_canvas(P.kraft_arr(w * 3, h * 3, seed=11), 3)
        ink, band, band_txt = (0.10, 0.085, 0.06), GREEN, (0.88, 0.90, 0.85)
        title = ["CLASSIC", "WOOD TEES"]
        sub = ["NATURAL HARDWOOD", "DURABLE & RELIABLE"]
    elif variant == "performance":
        arr = P.canvas((0.82, 0.82, 0.79), w, h, ss=3, mottle=0.02, seed=13)
        ink, band, band_txt = INKD, GREEN, (0.88, 0.90, 0.85)
        title = ["PERFORMANCE", "GOLF TEES"]
        sub = ["CONSISTENT HEIGHT", "ENHANCED DURABILITY"]
    elif variant == "bamboo":
        arr = P.wrap_canvas(bamboo_arr(w * 3, h * 3), 3)
        ink, band, band_txt = (0.12, 0.10, 0.06), NAVY, (0.85, 0.87, 0.90)
        title = ["ECO", "BAMBOO TEES"]
        sub = ["SUSTAINABLE MATERIAL", "STRONG & LIGHTWEIGHT"]
    else:
        arr = P.canvas((0.83, 0.83, 0.81), w, h, ss=3, mottle=0.015, seed=17)
        ink, band, band_txt = NAVY, NAVY, (0.85, 0.87, 0.90)
        title = ["PRO LAUNCH", "PERFORMANCE TEES"]
        sub = ["MAXIMUM HEIGHT", "LOW SPIN DESIGN"]
    P.rect(arr, 0, 0, 10, 10, (0.6, 0.58, 0.5))
    for x0, is_front in ((0, True), (half, False)):
        x1 = x0 + half
        cx = (x0 + x1) // 2
        if is_front:
            P.frame(arr, x0 + 50, 60, x1 - 50, 474, 5, ink)
        else:
            B.p_roundel(arr, cx, 150, 60, ink)
            for i, ch in enumerate(title[0].replace(" ", "")[:8]):
                P.draw_text(arr, ch, cx, 260 + i * 42, 3, ink)
        B.p_roundel(arr, cx, 540, 34, ink) if is_front else None
        if is_front:
            P.draw_text(arr, title[0], cx, 618, 3, ink)
            P.draw_text(arr, title[1], cx, 660, 3, ink)
            P.draw_text(arr, sub[0], cx, 716, 1, ink)
            P.draw_text(arr, sub[1], cx, 744, 1, ink)
        P.rect(arr, x0, 800, x1, 900, band)
        P.draw_text(arr, "2 3/4 IN", x0 + 105, 834, 2, band_txt)
        P.draw_text(arr, "70 MM", x0 + 105, 868, 1, band_txt)
        P.draw_text(arr, "20", x1 - 105, 836, 3, band_txt)
        P.draw_text(arr, "TEES", x1 - 105, 872, 1, band_txt)
        P.barcode(arr, x0 + 150, 920, x1 - 150, 990, seed=19, digits="7 41260 44120 9")
    return P.np_image(f"TeeBox_{variant}", arr)


def build_teebox(variant, tee_style, M):
    aid = f"pf_teebox_{variant}"
    W, D, H = BOX
    root = P.asset_root(aid, (W, D, H + TAB_H), category="tees")
    img = teebox_atlas(variant)
    m = P.m_tex(f"M_{aid}", img, rough=0.6)
    FRONT = (0.0, 0.0, 0.5, 1.0)
    SIDE = (0.5, 0.0, 1.0, 1.0)
    T = 0.0016
    win = (0.008, 0.062, 0.070, 0.108)   # front window (rows 62..474 in atlas)
    P.window_panel(f"{aid}_front", W, H, T, win, m, FRONT, root, y=-D / 2 + T / 2)
    P.uv_box(f"{aid}_back", (W, T, H), (0, D / 2 - T / 2, H / 2), m, parent=root, face_uv={"-Y": SIDE, "+Y": SIDE})
    for sx in (-1, 1):
        P.uv_box(f"{aid}_side{'L' if sx < 0 else 'R'}", (T, D - 2 * T, H), (sx * (W / 2 - T / 2), 0, H / 2), m,
                 parent=root, face_uv={"-X": SIDE, "+X": SIDE})
    base_mat = M["kraft"] if variant == "wood" else M["board"]
    P.uv_box(f"{aid}_top", (W, D, T), (0, 0, H - T / 2), base_mat, parent=root)
    P.uv_box(f"{aid}_bot", (W, D, T), (0, 0, T / 2), base_mat, parent=root)
    # interior: floor + back liner + 6 standing tees
    P.uv_box(f"{aid}_shelf", (W - 0.004, D - 0.006, 0.002), (0, 0.001, 0.030), base_mat, parent=root)
    P.uv_box(f"{aid}_liner", (W - 0.004, 0.002, H - 0.004), (0, D / 2 - 0.004, H / 2), base_mat, parent=root)
    i = 0
    for yx in (-0.008, 0.009):
        for tx in (-0.020, 0.0, 0.020):
            make_tee(f"{aid}_tee{i}", tee_style, M, loc=(tx + (0.004 if yx > 0 else 0), yx, 0.0315), parent=root)
            i += 1
    # hang tab with euro slot
    tab = P.uv_box(f"{aid}_tab", (0.034, T, TAB_H + 0.006), (0, 0, H + (TAB_H - 0.006) / 2), base_mat, parent=root, bevel=0.001)
    cutter = L.box("tab_cut", (0.018, 0.02, 0.005), (0, 0, H + TAB_H / 2 + 0.003), M["collision"], bevel=0.0, uv=False)
    P.boolean_cut(tab, cutter)
    P.collision_box(f"COL_{aid}", (W, D, H + TAB_H), (0, 0, (H + TAB_H) / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H * 0.6), barcode=(0, D / 2, H * 0.08), hang=(0, 0, H + TAB_H / 2 + 0.003))
    return root


def build_loose_tee(style, M):
    aid = f"pf_tee_loose_{style}"
    root = P.asset_root(aid, (0.067, 0.012, 0.012), category="tees")
    make_tee(aid, style, M, loc=(-0.0335, 0, 0.0058), rot=(0, math.radians(90), 0), parent=root, lying=True)
    P.collision_box(f"COL_{aid}", (0.07, 0.013, 0.013), (0, 0, 0.0065), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.006))
    return root


REG = {
    "pf_teebox_wood": lambda M: build_teebox("wood", "wood", M),
    "pf_teebox_performance": lambda M: build_teebox("performance", "white", M),
    "pf_teebox_bamboo": lambda M: build_teebox("bamboo", "bamboo", M),
    "pf_teebox_prolaunch": lambda M: build_teebox("prolaunch", "step", M),
    "pf_tee_loose_wood": lambda M: build_loose_tee("wood", M),
    "pf_tee_loose_white": lambda M: build_loose_tee("white", M),
    "pf_tee_loose_bamboo": lambda M: build_loose_tee("bamboo", M),
    "pf_tee_loose_step": lambda M: build_loose_tee("step", M),
}

META = {
    "pf_teebox_wood": {"name": "Classic Wood Tees 20pk", "variant": "kraft", "price": 5.99, "fixture": "pf_fixture_accessory_slatwall", "slot_type": "hook_card", "packaging": "window box + hang tab"},
    "pf_teebox_performance": {"name": "Performance Golf Tees 20pk", "variant": "white_green", "price": 8.99, "fixture": "pf_fixture_accessory_slatwall", "slot_type": "hook_card", "packaging": "window box + hang tab"},
    "pf_teebox_bamboo": {"name": "Eco Bamboo Tees 20pk", "variant": "bamboo_navy", "price": 7.99, "fixture": "pf_fixture_accessory_slatwall", "slot_type": "hook_card", "packaging": "window box + hang tab"},
    "pf_teebox_prolaunch": {"name": "Pro Launch Performance Tees 20pk", "variant": "white_navy", "price": 10.99, "fixture": "pf_fixture_accessory_slatwall", "slot_type": "hook_card", "packaging": "window box + hang tab"},
    "pf_tee_loose_wood": {"name": "Wood Tee", "variant": "wood", "price": 0.25, "fixture": "pf_fixture_accessory_slatwall", "slot_type": "loose", "packaging": "loose"},
    "pf_tee_loose_white": {"name": "Performance Tee", "variant": "white", "price": 0.35, "fixture": "pf_fixture_accessory_slatwall", "slot_type": "loose", "packaging": "loose"},
    "pf_tee_loose_bamboo": {"name": "Bamboo Tee", "variant": "bamboo", "price": 0.30, "fixture": "pf_fixture_accessory_slatwall", "slot_type": "loose", "packaging": "loose"},
    "pf_tee_loose_step": {"name": "Pro Launch Tee", "variant": "step", "price": 0.45, "fixture": "pf_fixture_accessory_slatwall", "slot_type": "loose", "packaging": "loose"},
}

P.run_batch(REG, kind="products", category_of=lambda a: "tees", manifest_extra=lambda a: META.get(a))
