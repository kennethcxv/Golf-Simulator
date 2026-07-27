"""Prime Fairways essentials (R24/R26/R32 accessories): towels, headcovers,
belt, umbrella, sunglasses (+case box), gift card hang-card."""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import lib_props as L
import proshop_lib as P
import pf_brand as B

DGREEN = (0.055, 0.14, 0.075)
NAVY = (0.042, 0.055, 0.105)
CREAM = (0.72, 0.68, 0.57)


def build_towel_card(M):
    aid = "pf_towel_card"
    W, T, H = 0.13, 0.0022, 0.15
    root = P.asset_root(aid, (W, 0.04, 0.32), category="extras")
    arr = B.hangcard_arr(512, 590, base=(0.80, 0.78, 0.70), band=DGREEN, title="TOUR TOWEL",
                         subtitle="WAFFLE MICROFIBER", accent=(0.72, 0.62, 0.38), seed=181, sku="8 41200 9917")
    m = P.m_tex(f"M_{aid}", P.np_image(f"Card_{aid}", arr), rough=0.6)
    card = P.uv_box(f"{aid}_card", (W, T, H), (0, 0, 0.32 - H), m, parent=root, bevel=0.0008,
                    face_uv={"-Y": (0, 0, 1, 1), "+Y": (0, 0, 1, 1)})
    card.location.z = 0.32 - H / 2
    cutter = L.box("slotcut", (0.034, 0.02, 0.006), (0, 0, 0.32 - 0.012), M["collision"], bevel=0.0, uv=False)
    P.boolean_cut(card, cutter)
    # folded towel hanging below the card
    tw = P.m_tex("M_TowelGreen", P.np_image("TowelGreen", P.fabric_arr(DGREEN, 256, 256, kind="canvas", seed=183)), rough=0.85)
    P.pillow(f"{aid}_towel", (0.115, 0.035, 0.20), (0, -0.005, 0.10), tw, round_frac=0.35, parent=root)
    for i in range(3):
        L.box(f"{aid}_stripe{i}", (0.118, 0.002, 0.008), (0, -0.024, 0.05 + i * 0.05), P.m_flat("M_TowelStripe", CREAM, rough=0.8), parent=root, uv=False)
    P.collision_box(f"COL_{aid}", (0.13, 0.045, 0.32), (0, 0, 0.16), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.16), hang=(0, 0, 0.31))
    return root


def build_towel_folded(M):
    aid = "pf_towel_folded"
    root = P.asset_root(aid, (0.38, 0.15, 0.045), category="extras")
    tw = P.m_tex("M_TowelGreenV2", P.np_image("TowelGreenV2", P.fabric_arr(DGREEN, 256, 256, kind="canvas", seed=183)),
                 rough=0.88, normal=P.nrm_img("canvas", strength=1.5), uvscale=2.0)
    P.pillow(f"{aid}_body", (0.38, 0.15, 0.045), (0, 0, 0.0225), tw, round_frac=0.45, parent=root)
    stripe = P.m_flat("M_TowelStripe", CREAM, rough=0.85)
    # dobby stripes across the width near both ends (classic golf towel)
    for sx in (-1, 1):
        L.box(f"{aid}_stripeA{sx}", (0.016, 0.146, 0.0035), (sx * 0.132, 0, 0.0462), stripe, parent=root, uv=False)
        L.box(f"{aid}_stripeB{sx}", (0.007, 0.146, 0.0030), (sx * 0.112, 0, 0.0460), stripe, parent=root, uv=False)
    # fold rolls at both ends
    for sx in (-1, 1):
        L.cyl(f"{aid}_roll{sx}", 0.020, 0.142, (sx * 0.172, 0, 0.0235), tw, rot=(math.radians(90), 0, 0), parent=root, verts=14)
    P.collision_box(f"COL_{aid}", (0.385, 0.155, 0.05), (0, 0, 0.025), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.04))
    return root


def headcover(aid, base, num, M):
    root = P.asset_root(aid, (0.13, 0.13, 0.33), category="extras", extra={"hanging": False})
    m = P.m_tex(f"M_HC_{aid}", P.np_image(f"HC_{aid}", P.leather_arr(base, 256, 256, seed=185, pebble=0.1)), rough=0.5)
    cream = P.m_flat("M_HCCream", CREAM, rough=0.6)
    prof = [(0.058, 0.0), (0.062, 0.06), (0.060, 0.14), (0.052, 0.20), (0.058, 0.26), (0.052, 0.30), (0.030, 0.325), (0.0, 0.33)]
    P.lathe(f"{aid}_body", prof, (0, 0, 0), m, steps=18, parent=root, scale_y=0.9, uv=True)
    L.torus(f"{aid}_discrim", 0.0315, 0.0035, (0, -0.052, 0.24), m, rot=(math.radians(90), 0, 0), parent=root, mj=18, mn=8)
    # ribbed sock band (visibly darker knit)
    L.cyl(f"{aid}_band", 0.059, 0.058, (0, 0, 0.115),
          P.m_tex(f"M_HCKnit_{aid}", P.np_image(f"HCKnit_{aid}", P.fabric_arr(tuple(c * 0.55 for c in base), 128, 128, kind="knit", seed=187)),
                  rough=0.85, normal=P.nrm_img("rib", strength=2.0), uvscale=3.0), parent=root, verts=20)
    # number disc
    arr = P.base_arr(CREAM, 128, 128, mottle=0.03, seed=189)
    P.ring(arr, 64, 64, 52, 52, 6, DGREEN)
    P.draw_text(arr, num, 64, 64, 5, DGREEN)
    md = P.m_tex(f"M_HCNum_{aid}", P.np_image(f"HCNum_{aid}", arr), rough=0.55)
    disc = L.cyl(f"{aid}_num", 0.029, 0.005, (0, -0.0505, 0.24), md, rot=(math.radians(90), 0, 0), parent=root, verts=20)
    # top pom (fleece)
    pomm = P.fabric_mat("M_HCPom", CREAM, "fleece", rough=0.9, nstr=1.4, seed=186)
    L.sphere(f"{aid}_pom", 0.036, (0, 0, 0.338), pomm, parent=root, segs=14)
    P.collision_box(f"COL_{aid}", (0.13, 0.12, 0.37), (0, 0, 0.185), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.2), hang=(0, 0, 0.33))
    return root


def build_belt(M):
    aid = "pf_belt_coiled"
    root = P.asset_root(aid, (0.115, 0.115, 0.038), category="extras")
    lm = P.fabric_mat("M_BeltNavy", NAVY, "leather", rough=0.42, nstr=0.5, seed=191)
    # true flat spiral of belt strap (rect cross-section approximated by flat tube)
    pts = []
    for i in range(64):
        t = i / 63
        a = t * math.pi * 2 * 2.6
        r = 0.054 - t * 0.024
        pts.append((math.cos(a) * r, math.sin(a) * r, 0.014 + math.sin(a * 3) * 0.0002))
    strap = P.tube_path(f"{aid}_coil", pts, 0.0135, lm, parent=root, verts=8)
    strap.scale = (1.0, 1.0, 0.34)     # flatten the tube into strap cross-section
    # strap tongue laid across the top of the coil into the buckle at centre
    P.tube_path(f"{aid}_tongue", [(0.049, 0.004, 0.019), (0.006, 0.002, 0.0205), (-0.031, 0.0, 0.021)],
                0.0135, lm, parent=root, verts=8).scale = (1.0, 1.0, 0.34)
    # buckle: flat rounded frame + prong resting on the strap
    fr = L.torus(f"{aid}_bucklef", 0.0165, 0.0030, (-0.037, 0.0, 0.0195), M["brass"], parent=root, mj=18, mn=8)
    fr.scale = (1.0, 0.80, 0.55)
    L.cyl(f"{aid}_prong", 0.0015, 0.030, (-0.037, 0.0, 0.021), M["brass"],
          rot=(0, math.radians(90), 0), parent=root, verts=8)
    P.collision_box(f"COL_{aid}", (0.125, 0.125, 0.036), (0, 0, 0.017), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.028))
    return root


def build_umbrella(M):
    aid = "pf_umbrella_closed"
    Ln = 0.98
    root = P.asset_root(aid, (0.055, 0.055, Ln), category="extras")
    green = P.m_tex("M_UmbGreen", P.np_image("UmbGreen", P.fabric_arr(DGREEN, 256, 256, kind="ripstop", seed=193)), rough=0.55)
    cream = P.m_tex("M_UmbCream", P.np_image("UmbCream", P.fabric_arr(CREAM, 256, 256, kind="ripstop", seed=195)), rough=0.55)
    # furled canopy: 8 flutes, alternating green/cream lobes painted per-face
    prof = [(0.006, 0.0), (0.009, 0.10), (0.020, 0.38), (0.0275, 0.60), (0.017, 0.72), (0.006, 0.76)]
    canopy = P.lathe(f"{aid}_canopy", prof, (0, 0, 0.08), green, steps=8, parent=root, uv=True)
    canopy.data.materials.append(cream)
    for poly in canopy.data.polygons:
        c = poly.center
        ang = math.atan2(c.y, c.x) % (2 * math.pi)
        if int(ang / (2 * math.pi) * 8) % 2 == 1:
            poly.material_index = 1
    L.cyl(f"{aid}_shaft", 0.006, 0.16, (0, 0, 0.85), M["steel"], parent=root, verts=10)
    L.frustum(f"{aid}_tip", 0.004, 0.006, 0.05, (0, 0, 0.915), M["black"], segments=8, parent=root, uv=False)
    # pistol grip handle
    L.cyl(f"{aid}_handlepost", 0.007, 0.05, (0, 0, 0.055), M["rubber"], parent=root, verts=10)
    hdl = P.pillow(f"{aid}_handle", (0.022, 0.055, 0.03), (0, -0.018, 0.015), M["rubber"], round_frac=0.8, parent=root, uv=False)
    L.cyl(f"{aid}_collar2", 0.0085, 0.02, (0, 0, 0.085), M["black"], parent=root, verts=10)
    # strap band
    L.box(f"{aid}_bandwrap", (0.045, 0.014, 0.018), (0.004, 0, 0.47), cream, bevel=0.002, parent=root, uv=False)
    P.collision_box(f"COL_{aid}", (0.06, 0.075, Ln), (0, -0.005, Ln / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.5))
    return root


def build_sunglasses(M):
    aid = "pf_sunglasses"
    root = P.asset_root(aid, (0.148, 0.155, 0.05), category="extras")
    frame = P.m_flat("M_SGFrame", (0.024, 0.026, 0.030), rough=0.25)
    lens = P.m_flat("M_SGLens", (0.05, 0.08, 0.10), rough=0.06, metal=0.4)
    for sx in (-1, 1):
        # rim annulus + lens disc, both facing forward with identical tilt
        rim = P.lathe(f"{aid}_rim{sx}", [(0.0270, 0.0), (0.0300, 0.0), (0.0300, 0.0042), (0.0270, 0.0042)],
                      (0, 0, 0), frame, steps=24, uv=False, scale_y=0.80)
        rim.rotation_euler = (math.radians(96), 0, math.radians(-sx * 4))
        rim.location = (sx * 0.0345, -0.028, 0.028)
        L.parent_keep(rim, root)
        lp = L.cyl(f"{aid}_lens{sx}", 0.0280, 0.0026, (0, 0, 0), lens, parent=None, verts=24)
        lp.scale = (1.0, 0.80, 1.0)
        lp.rotation_euler = (math.radians(96), 0, math.radians(-sx * 4))
        lp.location = (sx * 0.0345, -0.0278, 0.028)
        L.parent_keep(lp, root)
    # browline bar spanning both rims + nose bridge + hinges + temples
    L.box(f"{aid}_bar", (0.128, 0.0055, 0.0075), (0, -0.0295, 0.0505), frame, bevel=0.002, parent=root, uv=False)
    br = P.tube_path(f"{aid}_bridge", [(-0.012, -0.030, 0.0345), (0, -0.026, 0.040), (0.012, -0.030, 0.0345)], 0.0024, frame, parent=root, verts=8)
    for sx in (-1, 1):
        L.box(f"{aid}_hinge{sx}", (0.006, 0.007, 0.010), (sx * 0.0665, -0.026, 0.0475), frame, bevel=0.0015, parent=root, uv=False)
        # temple arm: straight run then downturned ear hook
        pts = P.smooth_wire([(sx * 0.0685, -0.020, 0.0475), (sx * 0.0715, 0.055, 0.0475),
                             (sx * 0.0700, 0.112, 0.0455), (sx * 0.0660, 0.128, 0.030)], n=14)
        P.tube_path(f"{aid}_temple{sx}", pts, 0.0026, frame, parent=root, verts=8)
    P.collision_box(f"COL_{aid}", (0.15, 0.16, 0.058), (0, 0.02, 0.029), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.03))
    return root


def build_sunglasses_box(M):
    aid = "pf_sunglasses_box"
    dims = (0.165, 0.062, 0.075)
    root = P.asset_root(aid, dims, category="extras")
    w = h = 512
    arr = P.canvas((0.045, 0.05, 0.055), w, h, ss=3, mottle=0.04, seed=197)
    P.frame(arr, 12, 12, w - 12, h - 12, 3, (0.55, 0.42, 0.16))
    P.draw_text(arr, "PF SPORT SHADES", w // 2, 120, 2, (0.85, 0.84, 0.80))
    # glasses icon
    for sx in (-1, 1):
        P.disc(arr, w // 2 + sx * 70, 250, 55, 40, (0.10, 0.16, 0.30))
        P.ring(arr, w // 2 + sx * 70, 250, 58, 43, 6, (0.55, 0.42, 0.16))
    P.rect(arr, w // 2 - 18, 240, w // 2 + 18, 252, (0.55, 0.42, 0.16))
    P.draw_text(arr, "POLARIZED * UV400", w // 2, 380, 1, (0.65, 0.64, 0.60))
    P.barcode(arr, 150, 420, w - 150, 480, seed=25, digits="8 41200 77401 2")
    m = P.m_tex(f"M_{aid}", P.np_image(f"SGBox", arr), rough=0.5)
    P.uv_box(f"{aid}_body", dims, (0, 0, dims[2] / 2), m, parent=root, bevel=0.0015,
             face_uv={"-Y": (0, 0, 1, 1), "+Y": (0, 0, 1, 1), "-X": (0, 0, 0.06, 1), "+X": (0.94, 0, 1, 1),
                      "+Z": (0, 0.9, 1, 1), "-Z": (0, 0, 1, 0.1)})
    P.collision_box(f"COL_{aid}", dims, (0, 0, dims[2] / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.045), barcode=(0, dims[1] / 2, 0.03))
    return root


def build_giftcard(M):
    aid = "pf_giftcard"
    W, T, H = 0.09, 0.0022, 0.135
    root = P.asset_root(aid, (W, T, H), category="extras")
    w, h = 512, 768
    arr = P.canvas((0.80, 0.78, 0.70), w, h, ss=3, mottle=0.02, seed=199)
    P.rect(arr, 24, 40, w - 24, 110, DGREEN)
    P.draw_text(arr, "PRIME FAIRWAYS", w // 2, 76, 2, (0.88, 0.88, 0.82))
    # the card itself (printed as if mounted)
    P.rect(arr, 60, 200, w - 60, 560, NAVY)
    B.crest(arr, w // 2, 320, 160, (0.72, 0.60, 0.26), field=NAVY)
    P.draw_text(arr, "GIFT CARD", w // 2, 470, 3, (0.85, 0.84, 0.80))
    P.draw_text(arr, "PRO SHOP CREDIT", w // 2, 520, 1, (0.60, 0.58, 0.50))
    P.barcode(arr, 140, 640, w - 140, 716, seed=27, digits="8 41200 90031 8")
    m = P.m_tex(f"M_{aid}", P.np_image("GiftCard", arr), rough=0.55)
    card = P.uv_box(f"{aid}_card", (W, T, H), (0, 0, H / 2), m, parent=root, bevel=0.0006,
                    face_uv={"-Y": (0, 0, 1, 1), "+Y": (0, 0, 1, 1)})
    cutter = L.box("slotcut", (0.024, 0.02, 0.0045), (0, 0, H * 0.94), M["collision"], bevel=0.0, uv=False)
    P.boolean_cut(card, cutter)
    P.collision_box(f"COL_{aid}", (W, 0.006, H), (0, 0, H / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H / 2), hang=(0, 0, H * 0.94))
    return root


REG = {
    "pf_towel_card": build_towel_card,
    "pf_towel_folded": build_towel_folded,
    "pf_headcover_driver": lambda M: headcover("pf_headcover_driver", NAVY, "1", M),
    "pf_headcover_wood": lambda M: headcover("pf_headcover_wood", (0.30, 0.36, 0.26), "3", M),
    "pf_belt_coiled": build_belt,
    "pf_umbrella_closed": build_umbrella,
    "pf_sunglasses": build_sunglasses,
    "pf_sunglasses_box": build_sunglasses_box,
    "pf_giftcard": build_giftcard,
}

META = {a: {"name": n, "variant": v, "price": p, "fixture": f, "slot_type": s, "packaging": pk}
        for a, n, v, p, f, s, pk in [
            ("pf_towel_card", "PF Tour Towel (Card)", "green", 24.99, "pf_fixture_accessory_slatwall", "hook_card", "hang-card"),
            ("pf_towel_folded", "PF Tour Towel Folded", "green", 24.99, "pf_fixture_freestanding_gondola", "shelf_soft", "none"),
            ("pf_headcover_driver", "PF Driver Headcover", "navy", 39.99, "pf_fixture_freestanding_gondola", "hook_soft", "none"),
            ("pf_headcover_wood", "PF Wood Headcover", "sage", 34.99, "pf_fixture_freestanding_gondola", "hook_soft", "none"),
            ("pf_belt_coiled", "PF Leather Belt", "navy", 44.99, "pf_fixture_accessory_slatwall", "shelf_small", "coiled"),
            ("pf_umbrella_closed", "PF Course Umbrella", "green_cream", 54.99, "pf_fixture_freestanding_gondola", "barrel", "none"),
            ("pf_sunglasses", "PF Sport Shades", "black", 89.99, "pf_fixture_rangefinder_display", "shelf_small", "loose"),
            ("pf_sunglasses_box", "PF Sport Shades Box", "black", 89.99, "pf_fixture_rangefinder_display", "shelf_box", "retail box"),
            ("pf_giftcard", "PF Gift Card", "navy", 25.00, "pf_fixture_checkout", "hook_card", "hang-card")]}

P.run_batch(REG, kind="products", category_of=lambda a: "extras", manifest_extra=lambda a: META.get(a))
