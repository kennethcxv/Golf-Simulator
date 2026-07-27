"""Prime Fairways rangefinders (R03): stealth black / charcoal armor / tour white /
field olive + one shared retail box."""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import lib_props as L
import proshop_lib as P
import pf_brand as B

W, D, H = 0.041, 0.104, 0.073   # body: width across, depth, height
VARIANTS = {
    "stealth": {"base": (0.028, 0.030, 0.033), "panel": (0.020, 0.021, 0.023), "accent": (0.25, 0.36, 0.14)},
    "armor": {"base": (0.055, 0.058, 0.063), "panel": (0.030, 0.032, 0.035), "accent": (0.30, 0.40, 0.20)},
    "tour": {"base": (0.78, 0.78, 0.75), "panel": (0.045, 0.047, 0.050), "accent": (0.30, 0.42, 0.16)},
    "field": {"base": (0.14, 0.16, 0.11), "panel": (0.035, 0.037, 0.040), "accent": (0.55, 0.58, 0.52)},
}


def build_rf(vid, M, *, name=None):
    v = VARIANTS[vid]
    aid = name or f"pf_rangefinder_{vid}"
    root = P.asset_root(aid, (W * 1.9, D, H), category="rangefinders")
    body_img = P.np_image(f"RFBody_{vid}", P.base_arr(v["base"], 256, 256, mottle=0.06, seed=101))
    mb = P.m_tex(f"M_RF_{vid}", body_img, rough=0.55)
    mp = P.m_flat(f"M_RFPanel_{vid}", v["panel"], rough=0.65)
    ma = P.m_flat(f"M_RFAcc_{vid}", v["accent"], rough=0.45)
    # main body: soft brick with a waist, tapered toward the rear
    body = L.rounded_box(f"{aid}_body", (W * 1.6, D * 0.94, H), (0, 0, H / 2), mb, corner=0.022, parent=root, bevel=0.008, segments=8)
    for vx in body.data.vertices:
        if vx.co.y > D * 0.1:
            k = (vx.co.y - D * 0.1) / (D * 0.4)
            vx.co.x *= (1.0 - 0.10 * k)
            vx.co.z = (vx.co.z - H / 2) * (1.0 - 0.10 * k) + H / 2
        wk = 1.0 - 0.05 * math.exp(-((vx.co.y - 0.006) / 0.02) ** 2)
        vx.co.x *= wk
    # ocular hood bump on the top rear
    P.pillow(f"{aid}_hood", (W * 1.2, D * 0.40, 0.013), (0, D * 0.16, H - 0.004), mb, round_frac=0.8, parent=root, uv=False)
    # knurled rubber side armor
    knurl = P.m_tex(f"M_RFArmor_{vid}", P.np_image(f"RFArmor_{vid}", P.base_arr(v["panel"], 256, 256, mottle=0.05, seed=105)),
                    rough=0.8, normal=P.nrm_img("knurl", strength=1.4), uvscale=3.0)
    for sx in (-1, 1):
        P.pillow(f"{aid}_grip{sx}", (0.007, D * 0.52, H * 0.52), (sx * (W * 0.76), 0.008, H * 0.5), knurl, round_frac=0.7, parent=root)
    # near-flush front lens plate (face -Y) with PROTRUDING lens barrels
    L.rounded_box(f"{aid}_faceplate", (W * 1.38, 0.008, H * 0.72), (0, -D * 0.452, H / 2), mp, corner=0.018, parent=root, bevel=0.003, segments=6)
    L.cyl(f"{aid}_ocular_barrel", 0.0115, 0.014, (0, -D * 0.475, H * 0.72), mb, rot=(math.radians(90), 0, 0), parent=root, verts=22)
    L.cyl(f"{aid}_ocular_ring", 0.0100, 0.006, (0, -D * 0.505, H * 0.72), ma, rot=(math.radians(90), 0, 0), parent=root, verts=22)
    L.cyl(f"{aid}_ocular_glass", 0.0082, 0.004, (0, -D * 0.503, H * 0.72), M["lens_blue"], rot=(math.radians(90), 0, 0), parent=root, verts=22)
    L.cyl(f"{aid}_obj_barrel", 0.0180, 0.016, (0, -D * 0.475, H * 0.34), mb, rot=(math.radians(90), 0, 0), parent=root, verts=26)
    L.cyl(f"{aid}_obj_ring", 0.0160, 0.007, (0, -D * 0.508, H * 0.34), ma, rot=(math.radians(90), 0, 0), parent=root, verts=26)
    L.cyl(f"{aid}_obj_glass", 0.0135, 0.004, (0, -D * 0.506, H * 0.34), M["lens_blue"], rot=(math.radians(90), 0, 0), parent=root, verts=26)
    L.torus(f"{aid}_obj_hood", 0.0180, 0.0022, (0, -D * 0.512, H * 0.34), mb, rot=(math.radians(90), 0, 0), parent=root, mj=22, mn=6)
    # rear eyepiece
    L.cyl(f"{aid}_eyecup", 0.0125, 0.012, (0, D * 0.47, H * 0.66), M["rubber"], rot=(math.radians(90), 0, 0), parent=root, verts=22)
    L.cyl(f"{aid}_eyeglass", 0.0075, 0.004, (0, D * 0.478, H * 0.66), M["lens_blue"], rot=(math.radians(90), 0, 0), parent=root, verts=16)
    # top buttons
    L.cyl(f"{aid}_btn_power", 0.0075, 0.006, (0, -D * 0.16, H + 0.001), M["rubber"], parent=root, verts=16)
    L.cyl(f"{aid}_btn_mode", 0.006, 0.005, (0, 0.012, H + 0.0005), ma, parent=root, verts=14)
    # brand plate on side
    tx = P.canvas(v["panel"], 256, 64, ss=3, mottle=0.02, seed=103)
    P.draw_text(tx, "PF OPTICS", 128, 32, 2, v["accent"])
    plate = P.uv_box(f"{aid}_brand", (0.002, 0.052, 0.014), (W * 0.96, 0.01, H * 0.62),
                     P.m_tex(f"M_RFBrand_{vid}", P.np_image(f"RFBrand_{vid}", tx), rough=0.5), parent=root,
                     face_uv={"+X": (0, 0, 1, 1), "-X": (0, 0, 1, 1)})
    P.collision_box(f"COL_{aid}", (W * 2.0, D, H + 0.006), (0, 0, (H + 0.006) / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H * 0.55))
    return root


def rf_box_atlas():
    w = h = 1024
    arr = P.canvas((0.045, 0.05, 0.055), w, h, ss=3, mottle=0.04, seed=107)
    P.rect(arr, 0, 0, 10, 10, (0.05, 0.05, 0.05))
    q = 512
    GOLDI = (0.55, 0.42, 0.16)
    GREEN = (0.25, 0.36, 0.14)

    def device(cx, cy, s, col):
        P.rect(arr, cx - s, cy - s * 0.55, cx + s, cy + s * 0.55, col)
        P.disc(arr, cx - s * 0.45, cy, s * 0.28, s * 0.28, (0.10, 0.16, 0.30))
        P.ring(arr, cx - s * 0.45, cy, s * 0.30, s * 0.30, max(2, int(s * 0.06)), GREEN)
        P.disc(arr, cx + s * 0.42, cy - s * 0.18, s * 0.16, s * 0.16, (0.10, 0.16, 0.30))

    def face(x0, y0, *, front=False, side=False, back=False, flap=False):
        x1, y1 = x0 + q, y0 + q
        cx = (x0 + x1) // 2
        P.frame(arr, x0 + 16, y0 + 16, x1 - 16, y1 - 16, 2, GOLDI)
        if front:
            P.draw_text(arr, "PF OPTICS", cx, y0 + 70, 3, (0.85, 0.84, 0.80))
            P.draw_text(arr, "LASER RANGEFINDER", cx, y0 + 116, 2, GREEN)
            device(cx, y0 + 260, 130, (0.10, 0.11, 0.12))
            B.icon_row(arr, cx, y0 + 420, ["SLOPE", "800M", "CLEAR"], 14, (0.75, 0.74, 0.70), gap=140)
        if side:
            P.draw_text(arr, "PF OPTICS", cx, y0 + 90, 3, (0.85, 0.84, 0.80))
            device(cx, y0 + 250, 90, (0.10, 0.11, 0.12))
        if back:
            P.draw_text(arr, "PF OPTICS RANGEFINDER", cx, y0 + 70, 2, (0.85, 0.84, 0.80))
            for i in range(6):
                P.rect(arr, x0 + 60, y0 + 120 + i * 36, x1 - 60, y0 + 125 + i * 36, (0.20, 0.21, 0.22))
            P.barcode(arr, x0 + 150, y1 - 140, x1 - 150, y1 - 60, seed=21, digits="8 41200 66104 3")
        if flap:
            P.draw_text(arr, "PF OPTICS", cx, y0 + q // 2, 3, GOLDI)
    face(0, 0, front=True)
    face(512, 0, side=True)
    face(0, 512, flap=True)
    face(512, 512, back=True)
    return P.np_image("RFBox", arr)


def build_rf_box(M):
    aid = "pf_rangefinder_box"
    dims = (0.13, 0.095, 0.145)
    root = P.asset_root(aid, dims, category="rangefinders")
    m = P.m_tex(f"M_{aid}", rf_box_atlas(), rough=0.5)
    P.uv_box(f"{aid}_body", dims, (0, 0, dims[2] / 2), m, parent=root, bevel=0.0018,
             face_uv={"-Y": (0, 0.5, 0.5, 1), "+Y": (0.5, 0, 1, 0.5), "-X": (0.5, 0.5, 1, 1),
                      "+X": (0.5, 0.5, 1, 1), "+Z": (0, 0, 0.5, 0.5), "-Z": (0, 0, 0.5, 0.5)})
    P.collision_box(f"COL_{aid}", dims, (0, 0, dims[2] / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, dims[2] * 0.55), barcode=(0, dims[1] / 2, dims[2] / 2))
    return root


REG = {f"pf_rangefinder_{v}": (lambda vv: (lambda M: build_rf(vv, M)))(v) for v in VARIANTS}
REG["pf_rangefinder_box"] = build_rf_box

META = {f"pf_rangefinder_{v}": {"name": f"PF Optics Rangefinder ({v.title()})", "variant": v, "price": 219.99,
                                "fixture": "pf_fixture_rangefinder_display", "slot_type": "shelf_device", "packaging": "loose display"}
        for v in VARIANTS}
META["pf_rangefinder_box"] = {"name": "PF Optics Rangefinder Box", "variant": "retail", "price": 219.99,
                              "fixture": "pf_fixture_rangefinder_display", "slot_type": "shelf_box", "packaging": "retail box"}

P.run_batch(REG, kind="products", category_of=lambda a: "rangefinders", manifest_extra=lambda a: META.get(a))
