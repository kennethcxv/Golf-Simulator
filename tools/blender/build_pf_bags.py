"""Prime Fairways golf bags (R14): stand / cart / staff / sunday.
Origin: base centre.  Front (pockets) toward -Y."""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import lib_props as L
import proshop_lib as P

SAGE = (0.30, 0.36, 0.26)
NAVY = (0.045, 0.06, 0.11)
CHAR = (0.048, 0.051, 0.056)
WHITE = (0.75, 0.74, 0.70)


def bag_body(aid, mat, parent, *, r=0.12, H=0.90, shear=0.10, taper=0.92):
    """Oval bag tube with an angled top collar (shear toward +Y back)."""
    secs = []
    for t in [0.0, 0.25, 0.5, 0.75, 0.92, 1.0]:
        rr = r * (taper + (1 - taper) * t)
        secs.append((0, 0, H * t, rr, rr * 0.86))
    body = P.loft(f"{aid}_body", secs, (0, 0, 0), mat, parent=parent, ring=18, uv=True, plane="xy")
    for v in body.data.vertices:
        if v.co.z > H * 0.7:
            k = (v.co.z - H * 0.7) / (H * 0.3)
            v.co.z += (v.co.y / r) * shear * k * r
    return body


def collar(aid, mat_dark, parent, *, r=0.12, H=0.90, shear=0.10):
    rim = P.loft(f"{aid}_rim", [(0, 0, -0.012, r * 1.03, r * 0.885), (0, 0, 0.012, r * 1.03, r * 0.885)],
                 (0, 0, H), mat_dark, parent=parent, ring=18, uv=False, plane="xy")
    top = P.loft(f"{aid}_mouth", [(0, 0, -0.002, r * 0.95, r * 0.80), (0, 0, 0.002, r * 0.95, r * 0.80)],
                 (0, 0, H + 0.006), P.m_flat("M_BagMouth", (0.02, 0.02, 0.022), rough=0.8), parent=parent, ring=18, uv=False, plane="xy")
    for o in (rim, top):
        for v in o.data.vertices:
            v.co.z += (v.co.y / r) * shear * r
    # top divider cross
    P.uv_box(f"{aid}_div1", (r * 1.8, 0.008, 0.02), (0, 0, H + 0.004), mat_dark, parent=parent)
    P.uv_box(f"{aid}_div2", (0.008, r * 1.5, 0.02), (0, 0, H + 0.004), mat_dark, parent=parent)


def pocket(aid, tag, mat, parent, *, loc, dims, rot=(0, 0, 0), zip_dark=None):
    o = P.pillow(f"{aid}_{tag}", dims, loc, mat, round_frac=0.55, parent=parent, uv=False, rot=rot)
    if zip_dark is not None:
        horiz = dims[0] >= dims[2]
        if horiz:
            zp = L.box(f"{aid}_{tag}_zip", (dims[0] * 0.8, 0.004, 0.006),
                       (loc[0], loc[1] - dims[1] * 0.52, loc[2] + dims[2] * 0.34), zip_dark, bevel=0.001, parent=parent, uv=False)
            L.box(f"{aid}_{tag}_pull", (0.006, 0.003, 0.014),
                  (loc[0] + dims[0] * 0.34, loc[1] - dims[1] * 0.54, loc[2] + dims[2] * 0.30), zip_dark, bevel=0.001, parent=parent, uv=False)
        else:
            zp = L.box(f"{aid}_{tag}_zip", (0.006 if abs(loc[0]) > 0.05 else dims[0] * 0.8, 0.004, dims[2] * 0.8),
                       (loc[0] - (0.002 if loc[0] > 0 else -0.002), loc[1] - dims[1] * 0.52, loc[2]), zip_dark, bevel=0.001, parent=parent, uv=False)
    return o


def brand_plate(aid, text, loc, parent, *, w=0.09, h=0.035, base=(0.05, 0.05, 0.055), col=(0.85, 0.84, 0.80), rot=(0, 0, 0)):
    arr = P.canvas(base, 256, 96, ss=3, mottle=0.03, seed=151)
    P.draw_text(arr, text, 128, 40, 2, col)
    P.draw_text(arr, "PRIME FAIRWAYS", 128, 72, 1, (0.45, 0.50, 0.38))
    m = P.m_tex(f"M_BagPlate_{aid}_{text[:4]}", P.np_image(f"BagPlate_{aid}_{text[:4]}", arr), rough=0.45)
    P.uv_box(f"{aid}_plate_{text[:4]}", (w, 0.0025, h), loc, m, parent=parent, rot=rot,
             face_uv={"-Y": (0, 0, 1, 1), "+Y": (0, 0, 1, 1)})


def base_unit(aid, mat_dark, parent, *, r=0.125):
    P.lathe(f"{aid}_base", [(r * 0.98, 0.0), (r * 1.04, 0.012), (r * 1.02, 0.05), (r * 0.94, 0.062)],
            (0, 0, 0), mat_dark, steps=20, parent=parent, uv=False, scale_y=0.88)


def strap(aid, tag, mat, parent, pts, *, w=0.032, t=0.011):
    """Padded strap: smooth tube along the path."""
    P.tube_path(f"{aid}_{tag}", P.smooth_wire(pts, n=16), t, mat, parent=parent, verts=10)


def build_stand(M):
    aid = "pf_bag_stand"
    r, H = 0.115, 0.88
    root = P.asset_root(aid, (r * 2.2, r * 2.2 + 0.28, H + 0.06), category="golf_bags")
    sage = P.fabric_mat("M_BagSage", SAGE, "ripstop", rough=0.62, nstr=0.7, seed=153)
    white = P.fabric_mat("M_BagWhite", WHITE, "ripstop", rough=0.62, nstr=0.6, seed=155)
    dark = P.m_flat("M_BagDark", (0.03, 0.032, 0.035), rough=0.6)
    bag_body(aid, sage, root, r=r, H=H)
    # white front panel stripe (near-flush overlay)
    P.pillow(f"{aid}_frontpanel", (0.095, 0.009, H * 0.80), (0, -r * 0.985, H * 0.47), white, round_frac=0.5, parent=root, uv=False)
    collar(aid, dark, root, r=r, H=H)
    base_unit(aid, dark, root, r=r + 0.008)
    pocket(aid, "ballpkt", sage, root, loc=(0, -r * 0.88, 0.22), dims=(0.13, 0.06, 0.20), zip_dark=dark)
    pocket(aid, "sidepkt", sage, root, loc=(r * 0.86, -0.02, 0.38), dims=(0.05, 0.14, 0.30), zip_dark=dark)
    brand_plate(aid, "AERO MAX", (0, -r * 0.95 - 0.032, 0.24), root)
    # deployed legs
    leg = P.m_flat("M_BagLeg", (0.06, 0.062, 0.066), rough=0.4, metal=0.6)
    for sx in (-1, 1):
        pts = [(sx * 0.06, -0.02, H * 0.78), (sx * 0.13, -0.20, H * 0.38), (sx * 0.15, -0.30, 0.01)]
        strap(aid, f"leg{sx}", leg, root, pts, t=0.0085)
        L.sphere(f"{aid}_foot{sx}", 0.016, (sx * 0.15, -0.30, 0.012), dark, parent=root, segs=10)
    P.uv_box(f"{aid}_legbrace", (0.26, 0.014, 0.02), (0, -0.245, 0.16), leg, parent=root, rot=(math.radians(14), 0, 0))
    # double strap
    strap(aid, "strapA", dark, root, [(0.02, r * 0.9, H * 0.86), (0.10, r * 1.25, H * 0.55), (0.05, r * 0.95, H * 0.28)], t=0.011)
    strap(aid, "strapB", dark, root, [(-0.05, r * 0.9, H * 0.80), (-0.13, r * 1.3, H * 0.48), (-0.06, r * 0.95, H * 0.22)], t=0.011)
    P.collision_box(f"COL_{aid}", (r * 2.4, r * 2 + 0.32, H + 0.06), (0, -0.07, (H + 0.06) / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H * 0.6))
    return root


def build_cart(M):
    aid = "pf_bag_cart"
    r, H = 0.145, 0.90
    root = P.asset_root(aid, (r * 2.15, r * 2.15, H + 0.07), category="golf_bags")
    char = P.fabric_mat("M_BagChar", CHAR, "canvas", rough=0.58, nstr=0.6, seed=157)
    dark = P.m_flat("M_BagDark", (0.03, 0.032, 0.035), rough=0.6)
    bag_body(aid, char, root, r=r, H=H, taper=0.97)
    collar(aid, dark, root, r=r, H=H)
    base_unit(aid, dark, root, r=r + 0.008)
    pocket(aid, "ballpkt", char, root, loc=(0, -r * 0.86, 0.20), dims=(0.16, 0.06, 0.22), zip_dark=dark)
    pocket(aid, "midpkt", char, root, loc=(0, -r * 0.90, 0.46), dims=(0.15, 0.05, 0.16), zip_dark=dark)
    pocket(aid, "sidepktL", char, root, loc=(-r * 0.92, -0.02, 0.40), dims=(0.05, 0.15, 0.34))
    pocket(aid, "sidepktR", char, root, loc=(r * 0.92, -0.02, 0.40), dims=(0.05, 0.15, 0.34))
    pocket(aid, "coolerpkt", char, root, loc=(0, -r * 0.87, 0.66), dims=(0.13, 0.045, 0.12), zip_dark=dark)
    brand_plate(aid, "FORGE 460", (0, -r * 0.9 - 0.032, 0.22), root)
    # lift handle at collar
    strap(aid, "handle", dark, root, [(0, r * 0.75, H + 0.02), (0, r * 0.55, H + 0.09), (0, r * 0.2, H + 0.10), (0, r * 0.05, H + 0.04)], t=0.010)
    P.collision_box(f"COL_{aid}", (r * 2.3, r * 2.3, H + 0.10), (0, 0, (H + 0.10) / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H * 0.6))
    return root


def build_staff(M):
    aid = "pf_bag_staff"
    r, H = 0.16, 0.95
    root = P.asset_root(aid, (r * 2.1, r * 2.1, H + 0.07), category="golf_bags")
    navy = P.fabric_mat("M_BagNavy", NAVY, "leather", rough=0.44, nstr=0.5, seed=159)
    white = P.fabric_mat("M_BagWhiteL", WHITE, "leather", rough=0.44, nstr=0.5, seed=161)
    dark = P.m_flat("M_BagDark", (0.03, 0.032, 0.035), rough=0.6)
    bag_body(aid, white, root, r=r, H=H, taper=0.88)
    # navy top third (radii track the body taper, slightly proud)
    P.loft(f"{aid}_topband", [(0, 0, 0, r * 0.990, r * 0.852), (0, 0, H * 0.24, r * 1.014, r * 0.872)],
           (0, 0, H * 0.72), navy, parent=root, ring=18, uv=False, plane="xy")
    P.pillow(f"{aid}_spine", (0.06, 0.02, H * 0.9), (0, r * 0.93, H * 0.48), navy, round_frac=0.6, parent=root, uv=False)
    collar(aid, dark, root, r=r, H=H)
    base_unit(aid, dark, root, r=r + 0.008)
    pocket(aid, "ballpkt", navy, root, loc=(0, -r * 0.84, 0.26), dims=(0.19, 0.075, 0.30), zip_dark=dark)
    pocket(aid, "sidepkt", navy, root, loc=(r * 0.86, -0.03, 0.44), dims=(0.05, 0.16, 0.38), zip_dark=dark)
    # big crest + name on ball pocket
    arr = P.canvas(NAVY, 512, 512, ss=3, mottle=0.04, seed=163)
    import pf_brand as B
    B.crest(arr, 256, 150, 220, (0.78, 0.62, 0.26), field=NAVY)
    P.draw_text(arr, "ELEVATE", 256, 340, 5, (0.88, 0.87, 0.83))
    P.draw_text(arr, "TOUR", 256, 408, 3, (0.78, 0.62, 0.26))
    m = P.m_tex("M_StaffCrest", P.np_image("StaffCrest", arr), rough=0.4)
    P.uv_box(f"{aid}_crest", (0.15, 0.0025, 0.15), (0, -r * 0.88 - 0.042, 0.30), m,
             parent=root, face_uv={"-Y": (0, 0, 1, 1), "+Y": (0, 0, 1, 1)})
    strap(aid, "handle", dark, root, [(0, r * 0.7, H + 0.02), (0, r * 0.4, H + 0.10), (0, r * 0.1, H + 0.05)], t=0.010)
    P.collision_box(f"COL_{aid}", (r * 2.2, r * 2.3, H + 0.10), (0, 0, (H + 0.10) / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H * 0.6))
    return root


def build_sunday(M):
    aid = "pf_bag_sunday"
    r, H = 0.085, 0.82
    root = P.asset_root(aid, (r * 2.3, r * 2.3, H + 0.05), category="golf_bags")
    navy = P.fabric_mat("M_BagNavyC", NAVY, "canvas", rough=0.62, nstr=0.6, seed=165)
    white = P.fabric_mat("M_BagWhiteC", WHITE, "canvas", rough=0.62, nstr=0.6, seed=167)
    dark = P.m_flat("M_BagDark", (0.03, 0.032, 0.035), rough=0.6)
    bag_body(aid, navy, root, r=r, H=H, taper=0.95, shear=0.14)
    # white top wedge (radii track the body taper)
    P.loft(f"{aid}_topband", [(0, 0, 0, r * 1.008, r * 0.868), (0, 0, H * 0.16, r * 1.016, r * 0.875)],
           (0, 0, H * 0.80), white, parent=root, ring=16, uv=False, plane="xy")
    collar(aid, dark, root, r=r, H=H, shear=0.14)
    base_unit(aid, dark, root, r=r + 0.006)
    pocket(aid, "sidepkt", navy, root, loc=(0, -r * 0.86, 0.30), dims=(0.10, 0.05, 0.24), zip_dark=dark)
    brand_plate(aid, "SUNDAY", (0, -r * 0.9 - 0.03, 0.32), root, w=0.07, h=0.028)
    strap(aid, "strap", dark, root, [(0, r * 0.85, H * 0.9), (0.03, r * 1.5, H * 0.5), (0, r * 0.85, H * 0.16)], t=0.010)
    strap(aid, "handle", white, root, [(0, r * 0.6, H + 0.015), (0, r * 0.15, H + 0.07), (0, -r * 0.3, H + 0.015)], t=0.008)
    P.collision_box(f"COL_{aid}", (r * 2.4, r * 2 + 0.16, H + 0.08), (0, 0.02, (H + 0.08) / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H * 0.6))
    return root


REG = {
    "pf_bag_stand": build_stand,
    "pf_bag_cart": build_cart,
    "pf_bag_staff": build_staff,
    "pf_bag_sunday": build_sunday,
}

META = {a: {"name": n, "variant": v, "price": p, "fixture": "pf_fixture_bag_display", "slot_type": "bag_slot", "packaging": "none"}
        for a, n, v, p in [
            ("pf_bag_stand", "Aero Max Stand Bag", "sage_white", 229.99),
            ("pf_bag_cart", "Forge 460 Cart Bag", "charcoal", 269.99),
            ("pf_bag_staff", "Elevate Tour Staff Bag", "navy_white", 549.99),
            ("pf_bag_sunday", "PF Sunday Pencil Bag", "navy_white", 119.99)]}

P.run_batch(REG, kind="products", category_of=lambda a: "golf_bags", manifest_extra=lambda a: META.get(a))
