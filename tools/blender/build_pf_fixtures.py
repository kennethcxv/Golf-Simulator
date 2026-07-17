"""Prime Fairways store fixtures (R24-R32): one construction family —
walnut slat backs, black steel frames, oak shelves, charcoal plinths, PF black
header with gold crest + wordmark, warm downlights, green accents, brass pulls.

Every fixture carries named placement slot empties with capacity props
(slot_type / accepts / max_w / max_d / max_h) sized from scale_standards.json
plus the retail clearances, and a COL_ box.

GLBs (kind=fixtures): pf_fixture_apparel_wall, hat_wall, accessory_slatwall,
club_rack, bag_display, ball_shelf, shoe_display, snack_shelf,
rangefinder_display, center_table, freestanding_gondola, checkout_counter_shop
+ pf_hook_short / _medium / _long / _double.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import lib_props as L
import proshop_lib as P
import pf_brand as B

GOLD = (0.72, 0.58, 0.24)
CL = P.STD["clearances"]
FX = P.STD["fixtures"]


# ------------------------------------------------------------- family parts ----

def posts(aid, M, parent, w, d, h, *, t=0.045):
    for sx in (-1, 1):
        for sy in (-1, 1):
            L.box(f"{aid}_post{sx}{sy}", (t, t, h), (sx * (w / 2 - t / 2), sy * (d / 2 - t / 2), h / 2), M["black"], bevel=0.004, parent=parent)


def slat_back(aid, M, parent, w, z0, z1, *, y, n=None, tag=""):
    n = n or max(4, int((z1 - z0) / 0.095))
    sh = (z1 - z0) / n
    for i in range(n):
        L.wood_slab(f"{aid}_slat{tag}{i}", (w, 0.024, sh - 0.008), (0, y, z0 + sh * (i + 0.5)), M["walnut"], parent=parent, bevel=0.003)


def header(aid, M, parent, w, z, *, d=0.10, y=0.0, h=0.25, title="PRIME FAIRWAYS"):
    L.box(f"{aid}_header", (w, d, h), (0, y, z + h / 2), M["black"], bevel=0.005, parent=parent)
    # gold crest decal + wordmark
    arr = P.canvas((0.016, 0.017, 0.019), 512, 128, ss=3, mottle=0.03, seed=201)
    B.crest(arr, 70, 64, 100, GOLD)
    P.draw_text(arr, title, 300, 64, 4, GOLD)
    m = P.m_tex(f"M_Header_{aid}", P.np_image(f"Header_{aid}", arr), rough=0.35)
    P.uv_box(f"{aid}_headerplate", (min(w * 0.8, 1.35), 0.006, h * 0.56), (0, y - d / 2 - 0.002, z + h / 2), m,
             parent=parent, face_uv={"-Y": (0, 0, 1, 1)})
    # warm downlight strip under the header
    L.box(f"{aid}_lightstrip", (w * 0.85, 0.02, 0.012), (0, y - d / 2 + 0.02, z - 0.006), M["emissive_warm"], parent=parent, uv=False)


def plinth(aid, M, parent, w, d, *, h=0.10, tag=""):
    L.box(f"{aid}_plinth{tag}", (w - 0.02, d - 0.02, h - 0.015), (0, 0, (h - 0.015) / 2), M["charcoal"], bevel=0.004, parent=parent)
    L.wood_slab(f"{aid}_plinthcap{tag}", (w, d, 0.018), (0, 0, h - 0.008), M["walnut"], parent=parent)
    return h


def oak_shelf(aid, M, parent, w, d, z, *, tag, lip=0.0, tilt=0.0, y=0.0):
    s = L.wood_slab(f"{aid}_shelf{tag}", (w, d, 0.028), (0, y, z), M["oak"], parent=parent)
    if tilt:
        s.rotation_euler = (math.radians(tilt), 0, 0)
    if lip:
        lp = L.box(f"{aid}_lip{tag}", (w, 0.012, lip), (0, y - d / 2 + 0.006, z + lip / 2), M["black"], bevel=0.002, parent=parent)
        if tilt:
            lp.rotation_euler = (math.radians(tilt), 0, 0)
            lp.location.z = z + math.cos(math.radians(tilt)) * lip / 2 - math.sin(math.radians(tilt)) * (-d / 2)
    return s


def drawer_base(aid, M, parent, w, d, h, *, n=2):
    L.box(f"{aid}_cab", (w, d, h - 0.03), (0, 0, (h - 0.03) / 2 + 0.02), M["walnut"], bevel=0.005, parent=parent)
    L.box(f"{aid}_cabtoe", (w - 0.06, d - 0.04, 0.05), (0, 0, 0.025), M["charcoal"], bevel=0.003, parent=parent)
    L.wood_slab(f"{aid}_cabtop", (w + 0.02, d + 0.02, 0.026), (0, 0, h - 0.013), M["walnut"], parent=parent)
    dw = (w - 0.10) / n
    for i in range(n):
        cx = -w / 2 + 0.05 + dw * (i + 0.5)
        L.box(f"{aid}_drawer{i}", (dw - 0.03, 0.02, h * 0.42), (cx, -d / 2 - 0.002, h * 0.45), M["walnut"], bevel=0.004, parent=parent)
        L.brass_cup_pull(f"{aid}_pull{i}", cx, -d / 2 - 0.012, h * 0.45, M, parent)
    return h


def green_band(aid, M, parent, w, d, z, *, hgt=0.06):
    L.box(f"{aid}_band", (w, d, hgt), (0, 0, z), M["green"], bevel=0.003, parent=parent)


# ------------------------------------------------------------------ fixtures ---

def build_apparel_wall(M):
    aid = "pf_fixture_apparel_wall"
    S = FX["apparel_wall"]
    w, d, h = S["w"], S["d"], S["h"]
    root = P.asset_root(aid, (w, d, h), category="apparel_wall", kind="fixture")
    posts(aid, M, root, w, 0.10, h)
    slat_back(aid, M, root, w - 0.10, 0.60, h - 0.28, y=0.02)
    header(aid, M, root, w, h - 0.25)
    cab_d = 0.55
    cab = L.empty(f"{aid}_cabroot", (0, -d / 2 + cab_d / 2 + 0.02, 0), parent=root)
    drawer_base(aid, M, cab, w - 0.04, cab_d, S["base_cabinet_h"])
    rails = {}
    for tag, (rz, ry) in {"upper": (S["rails_z"][0], -0.16), "lower": (S["rails_z"][1], -0.34)}.items():
        L.cyl(f"{aid}_rail_{tag}", 0.014, w - 0.16, (0, ry, rz), M["black"], rot=(0, math.radians(90), 0), parent=root, verts=14)
        for sx in (-1, 1):
            L.box(f"{aid}_railarm_{tag}{sx}", (0.025, abs(ry) - 0.05, 0.025), (sx * (w / 2 - 0.10), (ry + 0.03) / 2, rz), M["black"], bevel=0.002, parent=root)
        rails[tag] = (rz, ry)
    n = 0
    for i in range(6):
        n += 1
        P.slot(f"APPAREL_HANGER_SLOT_{n:02d}", (-w / 2 + 0.25 + i * (w - 0.5) / 5, rails["upper"][1], rails["upper"][0] + 0.014), root,
               slot_type="hanger_slot", accepts=["apparel_hanging", "hanger"], max_dims=(0.58, 0.28, 1.10))
    for i in range(6):
        n += 1
        P.slot(f"APPAREL_HANGER_SLOT_{n:02d}", (-w / 2 + 0.25 + i * (w - 0.5) / 5, rails["lower"][1], rails["lower"][0] + 0.014), root,
               slot_type="hanger_slot", accepts=["apparel_hanging_short", "hanger"], max_dims=(0.58, 0.28, 0.76))
    for i in range(4):
        P.slot(f"APPAREL_FOLDED_SLOT_{i+1:02d}", (-w / 2 + 0.30 + i * (w - 0.6) / 3, -d / 2 + cab_d / 2 + 0.02, S["base_cabinet_h"] + 0.002), root,
               slot_type="folded_slot", accepts=["apparel_folded"], max_dims=(0.42, 0.40, 0.42))
    P.collision_box(f"COL_{aid}", (w, d, h), (0, 0, h / 2), M, root)
    return root


def build_hat_wall(M):
    aid = "pf_fixture_hat_wall"
    S = FX["hat_wall"]
    w, d, h = S["w"], S["d"], S["h"]
    root = P.asset_root(aid, (w, d, h), category="hat_wall", kind="fixture")
    posts(aid, M, root, w, 0.10, h)
    slat_back(aid, M, root, w - 0.10, 0.60, h - 0.28, y=0.02)
    header(aid, M, root, w, h - 0.25)
    cab = L.empty(f"{aid}_cabroot", (0, -d / 2 + 0.55 / 2 + 0.02, 0), parent=root)
    drawer_base(aid, M, cab, w - 0.04, 0.50, S["base_cabinet_h"])
    n = 0
    for si, sz in enumerate(S["shelves_z"]):
        oak_shelf(aid, M, root, w - 0.14, S["shelf_depth"], sz, tag=f"H{si}", tilt=S["shelf_tilt_deg"], y=-0.06)
        for i in range(4):
            n += 1
            P.slot(f"HAT_SLOT_{n:02d}", (-w / 2 + 0.20 + i * (w - 0.40) / 3, -0.10, sz + 0.022), root,
                   rot=(math.radians(S["shelf_tilt_deg"]), 0, 0),
                   slot_type="hat_shelf", accepts=["hats"], max_dims=(0.31, 0.31, 0.34))
    P.collision_box(f"COL_{aid}", (w, d, h), (0, 0, h / 2), M, root)
    return root


def build_accessory_slatwall(M):
    aid = "pf_fixture_accessory_slatwall"
    S = FX["accessory_slatwall"]
    w, d, h = S["w"], S["d"], S["h"]
    root = P.asset_root(aid, (w, d, h), category="accessory_slatwall", kind="fixture")
    posts(aid, M, root, w, 0.10, h)
    slat_back(aid, M, root, w - 0.10, 0.42, h - 0.28, y=0.02)
    header(aid, M, root, w, h - 0.25)
    # two-step walnut base platform
    plinth(aid, M, root, w, d - 0.06, h=S["base_step_z"], tag="lo")
    step = L.empty(f"{aid}_step2", (0, 0.10, 0), parent=root)
    L.box(f"{aid}_step2box", (w - 0.05, d - 0.30, S["base_platform_z"] - 0.015), (0, 0.10, (S["base_platform_z"] - 0.015) / 2), M["charcoal"], bevel=0.004, parent=root)
    L.wood_slab(f"{aid}_step2cap", (w - 0.03, d - 0.28, 0.018), (0, 0.10, S["base_platform_z"] - 0.006), M["walnut"], parent=root)
    n = 0
    for rz in S["hook_rows_z"]:
        for i in range(S["hooks_per_row"]):
            n += 1
            P.slot(f"HOOK_SLOT_{n:02d}", (-w / 2 + 0.16 + i * (w - 0.32) / (S["hooks_per_row"] - 1), 0.004, rz), root,
                   slot_type="hook", accepts=["hook", "hook_card", "hook_soft"], max_dims=(0.17, 0.26, 0.38))
    for i in range(5):
        P.slot(f"SHELF_SLOT_A{i+1:02d}", (-w / 2 + 0.18 + i * (w - 0.36) / 4, 0.02, S["base_platform_z"] + 0.002), root,
               slot_type="shelf_bottle", accepts=["bottles", "shelf_box", "shelf_small"], max_dims=(0.26, 0.26, 0.40))
    for i in range(4):
        P.slot(f"SHELF_SLOT_B{i+1:02d}", (-w / 2 + 0.22 + i * (w - 0.44) / 3, -d / 2 + 0.17, S["base_step_z"] + 0.002), root,
               slot_type="shelf_small", accepts=["shelf_small", "shelf_box", "loose"], max_dims=(0.30, 0.26, 0.34))
    P.collision_box(f"COL_{aid}", (w, d, h), (0, 0, h / 2), M, root)
    return root


def build_club_rack(M):
    aid = "pf_fixture_club_rack"
    S = FX["club_rack"]
    w, d, h = S["w"], S["d"], S["h"]
    root = P.asset_root(aid, (w, d, h), category="club_rack", kind="fixture")
    plinth(aid, M, root, w, d, h=S["plinth_h"])
    green_band(aid, M, root, w - 0.03, d - 0.03, S["plinth_h"] + 0.03)
    # white wordmark band on the plinth front
    arr = P.canvas((0.048, 0.051, 0.056), 512, 64, ss=3, mottle=0.02, seed=203)
    P.draw_text(arr, "PRIME FAIRWAYS", 256, 32, 3, (0.85, 0.84, 0.80))
    m = P.m_tex(f"M_RackBand_{aid}", P.np_image(f"RackBand_{aid}", arr), rough=0.5)
    P.uv_box(f"{aid}_bandplate", (w * 0.6, 0.004, 0.05), (0, -d / 2 + 0.004, S["plinth_h"] + 0.032), m,
             parent=root, face_uv={"-Y": (0, 0, 1, 1)})
    # curved side cheeks
    for sx in (-1, 1):
        L.rounded_box(f"{aid}_cheek{sx}", (0.035, d - 0.06, h - S["plinth_h"]), (sx * (w / 2 - 0.03), 0, (h + S["plinth_h"]) / 2), M["walnut"], corner=0.12, parent=root, bevel=0.006)
    # angled lower deck (grip rest) + split-height notch rails:
    # slots 1-12 = long clubs (rail 1.16), slots 13-18 = irons/wedges/putters (rail 0.78)
    deck = L.wood_slab(f"{aid}_deck", (w - 0.10, d - 0.12, 0.026), (0, 0, S["deck_z"]), M["walnut"], parent=root)
    deck.rotation_euler = (math.radians(-6), 0, 0)
    nslots = S["slots"]
    pitch = S["slot_pitch"]
    x0 = -(nslots - 1) / 2 * pitch
    n_long = 12
    zones = [
        {"z": S["top_rail_z"], "i0": 0, "i1": n_long, "max_h": 1.18},
        {"z": 0.78, "i0": n_long, "i1": nslots, "max_h": 0.97},
    ]
    for zi, zone in enumerate(zones):
        zx0 = x0 + zone["i0"] * pitch - pitch / 2
        zx1 = x0 + (zone["i1"] - 1) * pitch + pitch / 2
        zw = zx1 - zx0
        zc = (zx0 + zx1) / 2
        L.wood_slab(f"{aid}_topshelf{zi}", (zw, 0.16, 0.026), (zc, 0.10, zone["z"]), M["walnut"], parent=root)
        L.box(f"{aid}_backrail{zi}", (zw, 0.03, 0.10), (zc, 0.19, zone["z"] + 0.05), M["walnut"], bevel=0.004, parent=root)
        L.box(f"{aid}_notchbar{zi}", (zw, 0.024, 0.020), (zc, 0.028, zone["z"] + 0.012), M["walnut"], bevel=0.003, parent=root)
        for i in range(zone["i0"], zone["i1"] + 1):
            tx = x0 - pitch / 2 + i * pitch
            L.box(f"{aid}_tooth{i}", (0.020, 0.05, 0.036), (min(max(tx, zx0 + 0.01), zx1 - 0.01), 0.012, zone["z"] + 0.030), M["walnut"], bevel=0.003, parent=root)
        for i in range(zone["i0"], zone["i1"]):
            cx = x0 + i * pitch
            P.slot(f"CLUB_SLOT_{i+1:02d}", (cx, -0.01, S["deck_z"] + 0.016), root,
                   slot_type="club_slot", accepts=["clubs"], max_dims=(0.13, 0.15, zone["max_h"] + 0.02))
            P.socket(f"CLUB_GRIP_SLOT_{i+1:02d}", (cx, -0.01, S["deck_z"] + 0.016), root, props={"socket": "club_grip"})
            P.socket(f"CLUB_SHAFT_SLOT_{i+1:02d}", (cx, 0.028, zone["z"] + 0.03), root, props={"socket": "club_shaft"})
            P.socket(f"CLUB_HEAD_SLOT_{i+1:02d}", (cx, 0.05, zone["z"] + 0.10), root, props={"socket": "club_head"})
    P.collision_box(f"COL_{aid}", (w, d, h + 0.05), (0, 0, (h + 0.05) / 2), M, root)
    return root


def build_bag_display(M):
    aid = "pf_fixture_bag_display"
    S = FX["bag_display"]
    w, d, h = S["w"], S["d"], S["h"]
    root = P.asset_root(aid, (w, d, h), category="bag_display", kind="fixture")
    posts(aid, M, root, w, d, h, t=0.06)
    L.box(f"{aid}_back", (w - 0.12, 0.035, h - 0.35), (0, d / 2 - 0.06, (h - 0.35) / 2 + 0.06), M["walnut"], bevel=0.004, parent=root)
    header(aid, M, root, w, h - 0.25, y=0.0)
    for i, dz in enumerate(S["deck_z"]):
        L.wood_slab(f"{aid}_deck{i}", (w - 0.12, d - 0.14, 0.035), (0, 0, dz), M["walnut"], parent=root)
        if i == 1:
            # under-deck light housed against the upper deck's front lip
            L.box(f"{aid}_lighthousing", (w * 0.8, 0.035, 0.02), (0, -d / 2 + 0.12, dz - 0.028), M["black"], parent=root, uv=False)
            L.box(f"{aid}_decklight", (w * 0.78, 0.02, 0.008), (0, -d / 2 + 0.12, dz - 0.040), M["emissive_warm"], parent=root, uv=False)
        for b in range(S["bags_per_deck"]):
            idx = i * S["bags_per_deck"] + b + 1
            P.slot(f"BAG_SLOT_{idx:02d}", (-w / 2 + 0.30 + b * S["bag_pitch"], -0.04, dz + 0.02), root,
                   slot_type="bag_slot", accepts=["golf_bags"], max_dims=(0.44, 0.62, 1.10))
    P.collision_box(f"COL_{aid}", (w, d, h), (0, 0, h / 2), M, root)
    return root


def shelf_unit(aid, M, *, S, category, slot_prefix_letters, slots_per_shelf, accepts, max_dims, base_accepts=None, base_max=None, dividers=False):
    w, d, h = S["w"], S["d"], S["h"]
    root = P.asset_root(aid, (w, d, h), category=category, kind="fixture")
    posts(aid, M, root, w, 0.10, h)
    L.box(f"{aid}_backpanel", (w - 0.10, 0.028, h - S["base_step_z"] - 0.30), (0, d / 2 - 0.10, (h + S["base_step_z"]) / 2 - 0.14), M["charcoal"], bevel=0.004, parent=root)
    for sx in (-1, 1):
        L.box(f"{aid}_cheek{sx}", (0.03, d - 0.10, h - 0.28), (sx * (w / 2 - 0.055), 0.0, (h - 0.28) / 2), M["charcoal"], bevel=0.004, parent=root)
    header(aid, M, root, w, h - 0.25)
    plinth(aid, M, root, w, d, h=S["base_step_z"] - 0.05)
    L.wood_slab(f"{aid}_basecap", (w - 0.06, d - 0.10, 0.024), (0, 0, S["base_step_z"]), M["oak"], parent=root)
    n = 0
    for si, sz in enumerate(S["shelves_z"]):
        letter = slot_prefix_letters[si]
        oak_shelf(aid, M, root, w - 0.12, d - 0.16, sz, tag=f"S{si}", lip=S.get("lip_h", 0.0), y=-0.02)
        if dividers and si == 0:
            for k in range(1, 4):
                L.box(f"{aid}_div{k}", (0.010, d - 0.20, 0.10), (-w / 2 + 0.06 + k * (w - 0.12) / 4, -0.02, sz + 0.064), M["black"], bevel=0.001, parent=root)
        for i in range(slots_per_shelf):
            n += 1
            P.slot(f"SHELF_SLOT_{letter}{i+1:02d}", (-w / 2 + 0.14 + i * (w - 0.28) / max(1, slots_per_shelf - 1), -0.04, sz + 0.016), root,
                   slot_type="shelf_box", accepts=accepts, max_dims=max_dims)
    for i in range(slots_per_shelf):
        P.slot(f"SHELF_SLOT_Z{i+1:02d}", (-w / 2 + 0.14 + i * (w - 0.28) / max(1, slots_per_shelf - 1), 0.0, S["base_step_z"] + 0.014), root,
               slot_type="shelf_box", accepts=base_accepts or accepts, max_dims=base_max or max_dims)
    P.collision_box(f"COL_{aid}", (w, d, h), (0, 0, h / 2), M, root)
    return root


def build_ball_shelf(M):
    return shelf_unit("pf_fixture_ball_shelf", M, S=FX["ball_shelf"], category="ball_shelf",
                      slot_prefix_letters="ABCD", slots_per_shelf=6,
                      accepts=["golf_balls", "shelf_box"], max_dims=(0.225, 0.28, 0.32))


def build_snack_shelf(M):
    return shelf_unit("pf_fixture_snack_shelf", M, S=FX["snack_drink_shelf"], category="snack_drink_shelf",
                      slot_prefix_letters="ABC", slots_per_shelf=5,
                      accepts=["snacks", "shelf_box", "shelf_pouch", "shelf_bag", "shelf_small"], max_dims=(0.20, 0.28, 0.36),
                      base_accepts=["bottles"], base_max=(0.20, 0.28, 0.40), dividers=True)


def build_rangefinder_display(M):
    return shelf_unit("pf_fixture_rangefinder_display", M, S=FX["rangefinder_display"], category="rangefinder_display",
                      slot_prefix_letters="ABC", slots_per_shelf=4,
                      accepts=["rangefinders", "shelf_box", "shelf_device", "shelf_card", "shelf_small"], max_dims=(0.24, 0.28, 0.30))


def build_shoe_display(M):
    aid = "pf_fixture_shoe_display"
    S = FX["shoe_display"]
    w, d, h = S["w"], S["d"], S["h"]
    root = P.asset_root(aid, (w, d, h), category="shoe_display", kind="fixture")
    posts(aid, M, root, w, 0.12, h)
    L.box(f"{aid}_backpanel", (w - 0.10, 0.028, h - 0.30), (0, d / 2 - 0.09, (h - 0.30) / 2), M["charcoal"], bevel=0.004, parent=root)
    header(aid, M, root, w, h - 0.22, h=0.20)
    plinth(aid, M, root, w, d, h=0.10)
    tilt = S["tier_tilt_deg"]
    n_left = 0
    n_right = 0
    for ti, tz in enumerate(S["tiers_z"]):
        ty = -0.06 + ti * 0.05
        oak_shelf(aid, M, root, w - 0.10, S["tier_depth"], tz, tag=f"T{ti}", tilt=tilt, y=ty, lip=0.018)
        for i in range(4):
            sx = -w / 2 + 0.18 + i * (w - 0.36) / 3
            left = (i % 2 == 0)
            if left:
                n_left += 1
                nm = f"SHOE_LEFT_SLOT_{n_left:02d}"
            else:
                n_right += 1
                nm = f"SHOE_RIGHT_SLOT_{n_right:02d}"
            P.slot(nm, (sx, ty - 0.02, tz + 0.030), root, rot=(math.radians(tilt), 0, math.radians(10 if left else -10)),
                   slot_type="shoe_tier", accepts=["shoes"], max_dims=(0.18, 0.34, 0.20))
    L.wood_slab(f"{aid}_topflat", (w - 0.10, 0.30, 0.026), (0, 0.10, S["top_flat_z"]), M["oak"], parent=root)
    for i, nm in enumerate(("SHOE_LEFT_SLOT_90", "SHOE_RIGHT_SLOT_90")):
        P.slot(nm, (-0.25 + i * 0.5, 0.06, S["top_flat_z"] + 0.016), root, rot=(0, 0, math.radians(8 - 16 * i)),
               slot_type="shoe_tier", accepts=["shoes"], max_dims=(0.18, 0.34, 0.20))
    P.collision_box(f"COL_{aid}", (w, d, h), (0, 0, h / 2), M, root)
    return root


def build_center_table(M):
    aid = "pf_fixture_center_table"
    S = FX["center_table"]
    w, d, h = S["w"], S["d"], S["h"]
    root = P.asset_root(aid, (w, d, h), category="center_table", kind="fixture")
    for sx in (-1, 1):
        for sy in (-1, 1):
            L.box(f"{aid}_leg{sx}{sy}", (0.05, 0.05, h - 0.03), (sx * (w / 2 - 0.06), sy * (d / 2 - 0.06), (h - 0.03) / 2), M["black"], bevel=0.003, parent=root)
    L.wood_slab(f"{aid}_top", (w, d, 0.035), (0, 0, h - 0.0175), M["walnut"], parent=root)
    L.wood_slab(f"{aid}_lower", (w - 0.14, d - 0.14, 0.026), (0, 0, S["lower_shelf_z"]), M["walnut"], parent=root)
    for i in range(4):
        for j in range(2):
            idx = i * 2 + j + 1
            P.slot(f"TABLE_SLOT_{idx:02d}", (-w / 2 + 0.22 + i * (w - 0.44) / 3, -d / 4 + j * d / 2, h + 0.002), root,
                   slot_type="folded_slot", accepts=["apparel_folded", "hats", "shelf_soft"], max_dims=(0.34, 0.40, 0.40))
    for i in range(4):
        P.slot(f"SHELF_SLOT_L{i+1:02d}", (-w / 2 + 0.22 + i * (w - 0.44) / 3, 0, S["lower_shelf_z"] + 0.015), root,
               slot_type="folded_slot", accepts=["apparel_folded", "shelf_soft"], max_dims=(0.40, 0.44, 0.42))
    P.collision_box(f"COL_{aid}", (w, d, h), (0, 0, h / 2), M, root)
    return root


def build_gondola(M):
    aid = "pf_fixture_freestanding_gondola"
    S = FX["freestanding_gondola"]
    w, d, h = S["w"], S["d"], S["h"]
    root = P.asset_root(aid, (w, d, h), category="freestanding_gondola", kind="fixture")
    plinth(aid, M, root, w, d, h=S["plinth_h"])
    posts(aid, M, root, w, d, h, t=0.05)
    # central spine + slat faces both long sides
    L.box(f"{aid}_spine", (w - 0.10, 0.06, h - S["plinth_h"] - 0.06), (0, 0, (h + S["plinth_h"]) / 2 - 0.03), M["charcoal"], bevel=0.004, parent=root)
    for sy in (-1, 1):
        for i in range(10):
            L.wood_slab(f"{aid}_slat{sy}{i}", (w - 0.12, 0.022, 0.082), (0, sy * 0.045, S["mid_shelf_z"] + 0.07 + i * 0.092), M["walnut"], parent=root, bevel=0.003)
    L.wood_slab(f"{aid}_top", (w, d - 0.20, 0.028), (0, 0, h - 0.014), M["walnut"], parent=root)
    for sy in (-1, 1):
        L.wood_slab(f"{aid}_midshelf{sy}", (w - 0.10, 0.34, 0.024), (0, sy * (d / 2 - 0.16), S["mid_shelf_z"]), M["oak"], parent=root)
    n = 0
    for sy in (-1, 1):
        for rz in S["hook_rows_z"]:
            for i in range(5):
                n += 1
                P.slot(f"HOOK_SLOT_{n:02d}", (-w / 2 + 0.17 + i * (w - 0.34) / 4, sy * 0.058, rz), root,
                       rot=(0, 0, 0 if sy < 0 else math.pi),
                       slot_type="hook", accepts=["hook", "hook_card", "hook_soft"], max_dims=(0.17, 0.26, 0.38))
    for sy in (-1, 1):
        for i in range(4):
            P.slot(f"SHELF_SLOT_G{('F' if sy < 0 else 'B')}{i+1:02d}", (-w / 2 + 0.20 + i * (w - 0.40) / 3, sy * (d / 2 - 0.16), S["mid_shelf_z"] + 0.014), root,
                   rot=(0, 0, 0 if sy < 0 else math.pi),
                   slot_type="shelf_soft", accepts=["apparel_folded", "shelf_soft", "shelf_small"], max_dims=(0.36, 0.37, 0.32))
    for i in range(3):
        P.slot(f"TABLE_SLOT_T{i+1:02d}", (-w / 2 + 0.30 + i * (w - 0.60) / 2, 0, h + 0.002), root,
               slot_type="shelf_soft", accepts=["apparel_folded", "hats", "shelf_soft", "towels"], max_dims=(0.42, 0.52, 0.40))
    # umbrella barrel on one end
    L.cyl(f"{aid}_barrel", 0.10, 0.42, (w / 2 + 0.14, 0, 0.21), M["charcoal"], parent=root, verts=18)
    L.cyl(f"{aid}_barrelrim", 0.104, 0.03, (w / 2 + 0.14, 0, 0.42), M["brass"], parent=root, verts=18)
    P.slot("BARREL_SLOT_01", (w / 2 + 0.14, 0, 0.05), root, slot_type="barrel", accepts=["umbrellas"], max_dims=(0.20, 0.20, 1.05))
    P.collision_box(f"COL_{aid}", (w + 0.3, d, h), (0.07, 0, h / 2), M, root)
    return root


def build_checkout_counter_shop(M):
    aid = "pf_fixture_checkout_counter_shop"
    S = FX["checkout_counter_shop"]
    w, d, h = S["w"], S["d"], S["h"]
    root = P.asset_root(aid, (w, d, h), category="checkout_counter", kind="fixture")
    L.box(f"{aid}_body", (w, d - 0.06, h - 0.05), (0, 0, (h - 0.05) / 2), M["charcoal"], bevel=0.006, parent=root)
    L.box(f"{aid}_toe", (w - 0.08, d - 0.12, 0.06), (0, 0, 0.03), M["black"], bevel=0.003, parent=root)
    L.wood_slab(f"{aid}_top", (w + 0.06, d, 0.04), (0, 0, h - 0.02), M["walnut"], parent=root)
    arr = P.canvas((0.035, 0.037, 0.042), 512, 512, ss=3, mottle=0.03, seed=205)
    B.crest(arr, 256, 190, 240, GOLD)
    P.draw_text(arr, "PRIME FAIRWAYS", 256, 380, 3, GOLD)
    m = P.m_tex(f"M_CtrCrest", P.np_image("CtrCrest", arr), rough=0.4)
    P.uv_box(f"{aid}_crest", (0.44, 0.006, 0.44), (0, -d / 2 + 0.028, h * 0.47), m, parent=root, face_uv={"-Y": (0, 0, 1, 1)})
    for i in range(3):
        P.slot(f"COUNTER_SLOT_{i+1:02d}", (-w / 2 + 0.3 + i * (w - 0.6) / 2, 0, h + 0.002), root,
               slot_type="counter", accepts=["shelf_small", "shelf_card", "scorecards"], max_dims=(0.30, 0.40, 0.40))
    P.collision_box(f"COL_{aid}", (w + 0.06, d, h), (0, 0, h / 2), M, root)
    return root


def build_hook(aid, M, *, arm=0.10, double=False):
    root = P.asset_root(aid, (0.05, arm + 0.03, 0.09), category="hooks", kind="fixture")
    blk = P.m_flat("M_HookBlack", (0.028, 0.029, 0.032), rough=0.4, metal=0.6)
    L.box(f"{aid}_plate", (0.038, 0.008, 0.075), (0, 0.004, 0.0), blk, bevel=0.002, parent=root)
    L.box(f"{aid}_lip", (0.034, 0.012, 0.012), (0, -0.004, 0.032), blk, bevel=0.002, parent=root)
    arms = [0.0] if not double else [-0.011, 0.011]
    for k, ax in enumerate(arms):
        pts = P.smooth_wire([(ax, -0.002, 0.012), (ax, -arm * 0.85, 0.008), (ax, -arm, 0.020)], n=8)
        P.tube_path(f"{aid}_arm{k}", pts, 0.004, blk, parent=root)
        L.sphere(f"{aid}_tip{k}", 0.0055, (ax, -arm, 0.022), blk, parent=root, segs=8)
    P.socket("HOOK_TIP", (0, -arm * 0.8, 0.014), root, props={"socket": "hook_hang"})
    P.collision_box(f"COL_{aid}", (0.05, arm + 0.03, 0.09), (0, -arm / 2, 0.01), M, root)
    return root


REG = {
    "pf_fixture_apparel_wall": build_apparel_wall,
    "pf_fixture_hat_wall": build_hat_wall,
    "pf_fixture_accessory_slatwall": build_accessory_slatwall,
    "pf_fixture_club_rack": build_club_rack,
    "pf_fixture_bag_display": build_bag_display,
    "pf_fixture_ball_shelf": build_ball_shelf,
    "pf_fixture_snack_shelf": build_snack_shelf,
    "pf_fixture_rangefinder_display": build_rangefinder_display,
    "pf_fixture_shoe_display": build_shoe_display,
    "pf_fixture_center_table": build_center_table,
    "pf_fixture_freestanding_gondola": build_gondola,
    "pf_fixture_checkout_counter_shop": build_checkout_counter_shop,
    "pf_hook_short": lambda M: build_hook("pf_hook_short", M, arm=0.06),
    "pf_hook_medium": lambda M: build_hook("pf_hook_medium", M, arm=0.10),
    "pf_hook_long": lambda M: build_hook("pf_hook_long", M, arm=0.15),
    "pf_hook_double": lambda M: build_hook("pf_hook_double", M, arm=0.10, double=True),
}

META = {a: {"name": a.replace("pf_fixture_", "PF ").replace("pf_hook", "PF slatwall hook").replace("_", " ").title(),
            "variant": "walnut_black", "price": 0, "fixture": "-", "slot_type": "-", "packaging": "-"} for a in REG}

P.run_batch(REG, kind="fixtures", category_of=lambda a: ("hooks" if a.startswith("pf_hook") else a.replace("pf_fixture_", "")), manifest_extra=lambda a: META.get(a))
