"""Prime Fairways glove line (R12): AERO MAX white leather / VANTAGE PRO black /
FORGE 360 navy mesh / ELEVATE LITE sage.  Loose glove + retail hang-card."""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import lib_props as L
import proshop_lib as P
import pf_brand as B

VARIANTS = {
    "white": {"base": (0.78, 0.77, 0.73), "accent": (0.30, 0.38, 0.27), "brand": "AERO MAX", "kind": "leather"},
    "black": {"base": (0.045, 0.047, 0.050), "accent": (0.30, 0.42, 0.16), "brand": "VANTAGE PRO", "kind": "leather"},
    "navy": {"base": (0.045, 0.065, 0.125), "accent": (0.75, 0.76, 0.78), "brand": "FORGE 360", "kind": "mesh"},
    "sage": {"base": (0.30, 0.36, 0.26), "accent": (0.85, 0.85, 0.82), "brand": "ELEVATE LITE", "kind": "perf"},
}


def glove_mats(vid, M):
    v = VARIANTS[vid]
    if v["kind"] == "mesh":
        main = P.fabric_mat(f"M_Glove_{vid}", v["base"], "ripstop", rough=0.62, nstr=0.8, seed=91)
    else:
        main = P.fabric_mat(f"M_Glove_{vid}", v["base"], "leather", rough=0.42, nstr=0.55, seed=91)
    acc = P.m_flat(f"M_GloveAcc_{vid}", v["accent"], rough=0.5)
    return main, acc


def tab_tex(vid):
    v = VARIANTS[vid]
    w, h = 256, 128
    arr = P.canvas(v["base"], w, h, ss=3, mottle=0.02, seed=93)
    P.frame(arr, 6, 6, w - 6, h - 6, 3, v["accent"])
    P.draw_text(arr, v["brand"], w // 2, h // 2 - 12, 2, v["accent"])
    P.draw_text(arr, "GOLF GLOVE", w // 2, h // 2 + 26, 1, v["accent"])
    return P.np_image(f"GloveTab_{vid}", arr)


def build_glove(vid, M, *, name=None):
    v = VARIANTS[vid]
    aid = name or f"pf_glove_{vid}"
    root = P.asset_root(aid, (0.115, 0.028, 0.24), category="gloves")
    main, acc = glove_mats(vid, M)
    # palm: rings span X/Z laid along +Y, rotated +90 about X so +Y becomes +Z (hand up)
    palm = P.loft(f"{aid}_palm",
                  [(0, 0.000, 0, 0.038, 0.010), (0, 0.020, 0, 0.042, 0.012), (0, 0.055, 0, 0.047, 0.0135),
                   (0, 0.085, 0, 0.048, 0.013), (0, 0.105, 0, 0.046, 0.0125)],
                  (0, 0, 0.018), main, parent=root, ring=14, rot=(math.radians(90), 0, 0), uv=True)
    # fingers rooted inside the palm with knuckle bulges + crotch stitches
    fingers = [(-0.0345, 0.058, 0.0082), (-0.0115, 0.070, 0.0088), (0.0115, 0.065, 0.0086), (0.0335, 0.050, 0.0076)]
    for i, (fx, fl, fr) in enumerate(fingers):
        prof = [(fr * 1.05, 0.0), (fr, 0.012), (fr * 1.02, fl * 0.42), (fr * 0.94, fl * 0.55),
                (fr * 0.96, fl * 0.72), (fr * 0.80, fl - fr * 0.9), (0.0, fl)]
        P.lathe(f"{aid}_finger{i}", prof, (fx, 0.0005, 0.108), main, steps=12, parent=root, uv=False)
    sm = P.m_flat(f"M_GloveStitch_{vid}", tuple(c * 0.62 for c in v["base"]), rough=0.8)
    for i in range(len(fingers) - 1):
        cx = (fingers[i][0] + fingers[i + 1][0]) / 2
        P.tube_path(f"{aid}_crotch{i}", [(cx, -0.0095, 0.106), (cx, -0.010, 0.121)], 0.0008, sm, parent=root, verts=4)
    # back-of-hand tendon stitches
    for i, (fx, fl, fr) in enumerate(fingers):
        P.tube_path(f"{aid}_tendon{i}", [(fx * 0.85, -0.0125, 0.070), (fx, -0.0125, 0.104)], 0.0007, sm, parent=root, verts=4)
    # thumb (angled out +X, lower)
    tp = [(0.0105, 0.0), (0.0090, 0.030), (0.0075, 0.052), (0.0, 0.060)]
    P.lathe(f"{aid}_thumb", tp, (0.0385, -0.003, 0.078), main, steps=12, rot=(0, math.radians(38), 0), parent=root, uv=False)
    # cuff + closure tab
    P.loft(f"{aid}_cuff", [(0, 0.0, 0, 0.040, 0.0115), (0, 0.018, 0, 0.0415, 0.012)],
           (0, 0, 0.0), acc if v["kind"] != "leather" else main, parent=root, ring=14, rot=(math.radians(90), 0, 0), uv=False)
    # velcro closure strap crossing to the thumb-side tab
    tab = P.pillow(f"{aid}_tab", (0.058, 0.008, 0.026), (0.006, -0.0150, 0.043), main, round_frac=0.5, parent=root, uv=False)
    tab.rotation_euler = (math.radians(-4), 0, math.radians(-12))
    for t in (-1, 1):
        P.tube_path(f"{aid}_tabstitch{t}", [(-0.020, -0.0175, 0.043 + t * 0.009), (0.031, -0.0185, 0.037 + t * 0.009)],
                    0.0007, sm, parent=root, verts=4)
    plate = P.uv_box(f"{aid}_tabplate", (0.034, 0.003, 0.018), (0.004, -0.0198, 0.0425),
                     P.m_tex(f"M_GloveTab_{vid}", tab_tex(vid), rough=0.5), parent=root,
                     face_uv={"-Y": (0, 0, 1, 1)})
    plate.rotation_euler = (math.radians(-4), 0, math.radians(-12))
    # elastic wrist ribbing
    P.loft(f"{aid}_wristrib", [(0, 0, 0.004, 0.0405, 0.0118), (0, 0, 0.017, 0.0415, 0.012)], (0, 0, 0),
           P.m_tex(f"M_GloveRib_{vid}", P.np_image(f"GloveRibAlb_{vid}", P.base_arr(tuple(c * 0.9 for c in v["base"]), 128, 128, mottle=0.03, seed=97)),
                   rough=0.8, normal=P.nrm_img("rib", strength=1.6), uvscale=3.0), parent=root, ring=14, uv=True, plane="xy")
    P.collision_box(f"COL_{aid}", (0.115, 0.032, 0.20), (0.004, -0.002, 0.10), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.11))
    return root


CARD = (0.105, 0.0022, 0.225)


def build_card(vid, M):
    v = VARIANTS[vid]
    aid = f"pf_glove_{vid}_card"
    W, T, H = CARD
    root = P.asset_root(aid, (W, 0.034, H), category="gloves")
    arr = B.hangcard_arr(512, 1024, base=(0.16, 0.20, 0.16), band=(0.055, 0.10, 0.06),
                         title=v["brand"], subtitle="PREMIUM GOLF GLOVE", accent=(0.72, 0.62, 0.38),
                         seed=95, sku="8 41200 8890")
    P.draw_text(arr, "CABRETTA SOFT" if v["kind"] == "leather" else "COOL MESH", 256, 990, 1, (0.72, 0.62, 0.38))
    m = P.m_tex(f"M_{aid}_card", P.np_image(f"Card_{aid}", arr), rough=0.6)
    card = P.uv_box(f"{aid}_card", (W, T, H), (0, 0, H / 2), m, parent=root, bevel=0.0008,
                    face_uv={"-Y": (0, 0, 1, 1), "+Y": (0, 0, 1, 1)})
    cutter = L.box("slotcut", (0.030, 0.02, 0.0055), (0, 0, H * 0.945), M["collision"], bevel=0.0, uv=False)
    P.boolean_cut(card, cutter)
    g = build_glove(vid, M, name=f"{aid}_item")
    g.location = (0, -T - 0.013, H * 0.10)
    g.scale = (0.82, 0.82, 0.82)
    L.parent_keep(g, root)
    for o in list(g.children):
        if o.name.startswith("COL_") or o.name in ("PICKUP_SOCKET", "SHELF_ANCHOR"):
            bpy.data.objects.remove(o, do_unlink=True)
    P.collision_box(f"COL_{aid}", (W, 0.036, H), (0, -0.012, H / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H * 0.5), hang=(0, 0, H * 0.945))
    return root


REG = {}
META = {}
for _vid, _v in VARIANTS.items():
    REG[f"pf_glove_{_vid}"] = (lambda vv: (lambda M: build_glove(vv, M)))(_vid)
    REG[f"pf_glove_{_vid}_card"] = (lambda vv: (lambda M: build_card(vv, M)))(_vid)
    META[f"pf_glove_{_vid}"] = {"name": f"{_v['brand']} Golf Glove", "variant": _vid, "price": 19.99,
                                "fixture": "pf_fixture_accessory_slatwall", "slot_type": "loose", "packaging": "loose"}
    META[f"pf_glove_{_vid}_card"] = {"name": f"{_v['brand']} Golf Glove (Card)", "variant": _vid, "price": 19.99,
                                     "fixture": "pf_fixture_accessory_slatwall", "slot_type": "hook_card", "packaging": "hang-card"}

P.run_batch(REG, kind="products", category_of=lambda a: "gloves", manifest_extra=lambda a: META.get(a))
