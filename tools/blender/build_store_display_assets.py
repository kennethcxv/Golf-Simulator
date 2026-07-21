"""Build the complete five-tier Pinehollow retail-display library.

Outputs use the existing pro-shop asset pipeline:
  Assets/pro_shop/source/fixtures/store_displays/<family>/<asset>.blend
  Assets/pro_shop/glb/fixtures/<asset>.glb
  Assets/pro_shop/manifests/fragments/<asset>.json

Convention: X width, Y depth (-Y is the player/customer side), Z up, metres.

Run all assets:
  blender --background --factory-startup --python tools/blender/build_store_display_assets.py -- all nojoin

Run a family or asset:
  ... -- clothing_rack nojoin
  ... -- pf_display_clothing_rack_t3 nojoin render
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

import lib_props as L
import proshop_lib as P


REFERENCE_FILES = [
    {
        "file": "Designs/ClubHouse/ChatGPT Image Jul 20, 2026, 02_51_59 PM.png",
        "sha256": "71837A0D4FBA7FB51F41EB315AC45191265595CF4075EFBD4FAD1D5674834D58",
        "role": "five-tier fixtures, materials, lighting, and custom-millwork progression",
    },
    {
        "file": "Designs/ClubHouse/ChatGPT Image Jul 20, 2026, 02_52_25 PM.png",
        "sha256": "AC8734A60E3DACE03466A4C04255FE9A13F89B7452390DB5FC8075D64E453692",
        "role": "municipal-to-private-club market levels and increasing room scale",
    },
    {
        "file": "Designs/ClubHouse/ChatGPT Image Jul 20, 2026, 02_52_34 PM.png",
        "sha256": "0C0780A1B1162A045D42AC1E77C7514759FED9D9D641903DC8A984C62CEB1A3D",
        "role": "worn municipal Tier-1 utility baseline",
    },
]

TIER = {
    1: {"name": "municipal_value", "quality": "Basic", "price_band": 1, "lights": 0,
        "materials": "utility steel"},
    2: {"name": "suburban_retail", "quality": "Standard", "price_band": 2, "lights": 1,
        "materials": "charcoal steel and natural oak"},
    3: {"name": "lodge_crafted", "quality": "Premium", "price_band": 3, "lights": 2,
        "materials": "thick charcoal frame, crafted oak, restrained brass"},
    4: {"name": "resort_boutique", "quality": "High-end", "price_band": 4, "lights": 3,
        "materials": "fitted walnut casework, cream panels, brass"},
    5: {"name": "private_club_luxury", "quality": "Luxury", "price_band": 5, "lights": 5,
        "materials": "built-in walnut millwork, warm cream, brass, glass"},
}

FAMILY_DIMS = {
    "clothing_rack": [(1.20, .55, 1.55), (1.45, .60, 1.75), (1.75, .65, 1.95), (2.20, .70, 2.25), (3.00, .82, 2.58)],
    "hat_wall": [(0.90, .28, 1.60), (1.20, .34, 1.85), (1.60, .40, 2.08), (2.10, .48, 2.32), (3.00, .58, 2.58)],
    "shoe_display": [(1.00, .42, 1.48), (1.30, .46, 1.76), (1.70, .50, 2.02), (2.20, .56, 2.30), (3.00, .66, 2.58)],
    "golf_club_wall": [(1.25, .36, 1.75), (1.60, .40, 1.95), (2.05, .44, 2.18), (2.55, .50, 2.38), (3.40, .60, 2.62)],
    "ball_display": [(0.90, .42, 1.35), (1.20, .46, 1.58), (1.55, .50, 1.85), (2.05, .56, 2.16), (2.80, .64, 2.48)],
    "accessory_rack": [(0.85, .42, 1.55), (1.15, .46, 1.78), (1.50, .50, 2.02), (2.00, .56, 2.28), (2.75, .64, 2.55)],
    "snack_shelving": [(0.90, .45, 1.45), (1.20, .50, 1.70), (1.55, .54, 1.95), (2.05, .60, 2.22), (2.80, .68, 2.52)],
    "drink_refrigerator": [(0.72, .68, 1.72), (0.92, .72, 1.92), (1.20, .76, 2.08), (1.65, .82, 2.28), (2.35, .90, 2.52)],
    "impulse_shelf": [(0.48, .42, .95), (0.62, .46, 1.10), (0.78, .50, 1.28), (1.00, .54, 1.48), (1.35, .62, 1.72)],
    "checkout_display": [(0.45, .30, .32), (0.62, .36, .48), (0.82, .42, .65), (1.05, .48, .82), (1.35, .56, 1.02)],
    "feature_table": [(1.00, .62, .78), (1.28, .72, .82), (1.58, .82, .86), (1.92, .94, .92), (2.35, 1.12, 1.02)],
    "window_display": [(1.20, .55, 1.50), (1.55, .65, 1.78), (1.95, .76, 2.02), (2.40, .88, 2.30), (3.10, 1.00, 2.62)],
    "luxury_display_island": [(1.20, .75, .92), (1.50, .90, 1.08), (1.85, 1.05, 1.28), (2.25, 1.20, 1.48), (2.80, 1.45, 1.70)],
    "wall_slat_system": [(1.00, .24, 1.65), (1.35, .28, 1.90), (1.75, .32, 2.14), (2.25, .38, 2.38), (3.10, .46, 2.62)],
    "built_in_cabinetry": [(1.20, .48, 1.72), (1.55, .52, 1.95), (2.00, .58, 2.18), (2.60, .64, 2.40), (3.50, .72, 2.64)],
    "glass_display_tower": [(.52, .48, 1.35), (.68, .56, 1.60), (.86, .64, 1.88), (1.08, .72, 2.16), (1.38, .82, 2.45)],
    "corner_shelving": [(1.00, 1.00, 1.55), (1.25, 1.25, 1.80), (1.50, 1.50, 2.04), (1.80, 1.80, 2.30), (2.15, 2.15, 2.58)],
    "rotating_display": [(.62, .62, 1.35), (.78, .78, 1.58), (.94, .94, 1.82), (1.12, 1.12, 2.08), (1.38, 1.38, 2.38)],
}

FAMILY_LABELS = {key: key.replace("_", " ").title() for key in FAMILY_DIMS}


def box(name, dims, loc, mat, parent, *, bevel=.008, rot=(0, 0, 0), props=None):
    return L.box(name, dims, loc, mat, parent=parent, bevel=bevel, rot=rot, props=props, uv=True)


def cyl(name, radius, depth, loc, mat, parent, *, rot=(0, 0, 0), verts=18, props=None):
    obj = L.cyl(name, radius, depth, loc, mat, parent=parent, rot=rot, verts=verts, uv=True)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def rail_x(name, length, z, y, mat, parent, *, radius=.018):
    return cyl(name, radius, length, (0, y, z), mat, parent, rot=(0, math.pi / 2, 0), verts=20)


def rail_y(name, length, x, z, mat, parent, *, radius=.018):
    return cyl(name, radius, length, (x, 0, z), mat, parent, rot=(math.pi / 2, 0, 0), verts=20)


def tier_palette(M, tier):
    display_glass = P.m_flat("M_PSDisplayGlass", (.16, .25, .30), rough=.08, alpha=.22, ds=True)
    return {
        "frame": M["black"],
        "wood": M["board"] if tier == 1 else M["oak"] if tier <= 3 else M["walnut"],
        "panel": M["charcoal"] if tier <= 2 else M["sage"] if tier == 3 else M["cream"],
        "accent": M["steel"] if tier <= 2 else M["brass"],
        "glass": display_glass,
        "light": M["emissive_warm"],
        "dark": M["charcoal"],
    }


def root_for(family, tier, dims):
    aid = f"pf_display_{family}_t{tier}"
    spec = TIER[tier]
    root = P.asset_root(aid, dims, category=family, kind="fixtures", extra={
        "display_family": family,
        "display_tier": tier,
        "tier_name": spec["name"],
        "quality_label": spec["quality"],
        "material_story": spec["materials"],
        "size_grade": tier,
        "material_grade": tier,
        "custom_woodwork_level": max(0, tier - 1),
        "fixture_complexity_grade": tier,
        "integrated_light_count": spec["lights"],
        "reference_files": ";".join(item["file"] for item in REFERENCE_FILES),
        "reference_sha256": ";".join(item["sha256"] for item in REFERENCE_FILES),
        "source": "Original Prime Fairways geometry generated in-repository from user-provided clubhouse references",
        "license": "Project-owned / UNLICENSED",
    })
    root.name = aid
    return root


def add_header(root, W, D, H, tier, Pm, label):
    if tier < 2:
        return
    h = .10 if tier == 2 else .14 if tier == 3 else .18
    box("Header_Back", (W - .08, .055, h), (0, -D / 2 + .04, H - h / 2 - .025), Pm["panel"], root, bevel=.006)
    root["header_label"] = label


def add_crown(root, W, D, H, tier, Pm):
    if tier < 4:
        return
    box("Crown_Main", (W - .06, D - .03, .075), (0, 0, H - .0375), Pm["wood"], root, bevel=.012)
    box("Crown_Trim", (W, D, .035), (0, 0, H - .0175), Pm["accent"], root, bevel=.006)
    if tier == 5:
        box("Plinth_Base", (W, D, .10), (0, 0, .05), Pm["wood"], root, bevel=.012)
        box("Plinth_Trim", (W, D, .035), (0, 0, .10), Pm["accent"], root, bevel=.005)


def add_lights(root, W, D, H, tier, Pm, *, rows=None):
    count = TIER[tier]["lights"]
    if count <= 0:
        return
    # The references use recessed pucks/spotlights at higher grades. A row of
    # small fittings leaves the merchandise volume clear and makes each upgrade's
    # increasing light count legible without shipping punctual glTF lights.
    z = max(.12, H - .14)
    for i in range(count):
        x = 0 if count == 1 else -W * .34 + W * .68 * i / (count - 1)
        cyl(f"LIGHT_HOUSING_{i + 1:02d}", .045, .026, (x, -D / 2 + .032, z),
            Pm["accent"], root, rot=(math.pi / 2, 0, 0), verts=18)
        puck = cyl(f"LIGHT_PUCK_{i + 1:02d}", .032, .010, (x, -D / 2 + .014, z),
                   Pm["light"], root, rot=(math.pi / 2, 0, 0), verts=18)
        puck["integrated_light"] = True
        puck["light_temperature_k"] = 2700


def add_rotating_lights(root, W, D, H, tier, Pm):
    """Seat the light pucks beneath the circular canopy instead of a wall fascia."""
    count = TIER[tier]["lights"]
    if count <= 0:
        return
    radius = min(W, D) * (.39 if tier >= 3 else .34)
    for i in range(count):
        x = 0 if count == 1 else -radius * .70 + radius * 1.40 * i / (count - 1)
        y = -math.sqrt(max(.001, radius * radius - x * x)) + .018
        z = H - .13
        cyl(f"LIGHT_HOUSING_{i + 1:02d}", .041, .022, (x, y, z),
            Pm["accent"], root, rot=(math.pi / 2, 0, 0), verts=18)
        puck = cyl(f"LIGHT_PUCK_{i + 1:02d}", .029, .008, (x, y - .014, z),
                   Pm["light"], root, rot=(math.pi / 2, 0, 0), verts=18)
        puck["integrated_light"] = True
        puck["light_temperature_k"] = 2700


def add_collision(root, W, D, H, M, *, height=None, z=None, name="COL_Fixture"):
    hh = height or H
    P.collision_box(name, (W, D, hh), (0, 0, z if z is not None else hh / 2), M, root)


def add_linear_slots(root, prefix, count, W, y, z, *, slot_type, accepts, max_dims, rows=1):
    cols = math.ceil(count / rows)
    for i in range(count):
        row, col = divmod(i, cols)
        x = 0 if cols == 1 else -W / 2 + (W * col / (cols - 1))
        zz = z - row * max_dims[2] * 1.15
        P.slot(f"{prefix}_{i + 1:02d}", (x, y, zz), root, slot_type=slot_type,
               accepts=accepts, max_dims=max_dims)


def add_case(root, W, D, H, tier, Pm, *, open_front=True, back=True):
    t = .035 if tier <= 2 else .05 if tier == 3 else .065
    # Tier 3 follows the reference's thick-metal-frame / wood-shelf hybrid;
    # fitted walnut carcasses begin at the boutique Tier 4.
    wood = Pm["frame"] if tier <= 3 else Pm["wood"]
    box("Case_Left", (t, D, H), (-W / 2 + t / 2, 0, H / 2), wood, root, bevel=.008)
    box("Case_Right", (t, D, H), (W / 2 - t / 2, 0, H / 2), wood, root, bevel=.008)
    box("Case_Top", (W, D, t), (0, 0, H - t / 2), wood, root, bevel=.008)
    box("Case_Base", (W, D, t), (0, 0, t / 2), wood, root, bevel=.008)
    if back:
        box("Case_Back", (W - 2 * t, .025, H - 2 * t), (0, D / 2 - .013, H / 2), Pm["panel"], root, bevel=.003)
    if not open_front:
        box("Case_Front", (W - 2 * t, .018, H - 2 * t), (0, -D / 2 - .01, H / 2), Pm["glass"], root, bevel=.002)
    add_crown(root, W, D, H, tier, Pm)


def add_shelves(root, W, D, H, tier, Pm, levels, *, front_lip=False, glass_from=99):
    for i, z in enumerate(levels, 1):
        mat = Pm["glass"] if tier >= glass_from else Pm["wood"] if tier >= 2 else Pm["frame"]
        box(f"Shelf_{i:02d}", (W - .10, D - .05, .035), (0, 0, z), mat, root, bevel=.006)
        if front_lip:
            box(f"Shelf_Lip_{i:02d}", (W - .10, .022, .075), (0, -D / 2 + .02, z + .04), Pm["accent"], root, bevel=.003)


def add_panel_millwork(root, W, D, H, tier, Pm):
    if tier < 4:
        return
    bays = 2 if tier == 4 else 3
    inner = W - .16
    for i in range(1, bays):
        x = -inner / 2 + inner * i / bays
        box(f"Millwork_Divider_{i:02d}", (.045, D - .06, H - .22), (x, .01, H / 2), Pm["wood"], root, bevel=.006)
    if tier == 5:
        for i in range(bays):
            x = -inner / 2 + inner * (i + .5) / bays
            box(f"Drawer_Front_{i + 1:02d}", (inner / bays - .05, .035, .16),
                (x, -D / 2 - .018, .22), Pm["wood"], root, bevel=.006)
            cyl(f"Drawer_Pull_{i + 1:02d}", .012, .11, (x, -D / 2 - .055, .22),
                Pm["accent"], root, rot=(math.pi / 2, 0, 0), verts=16)


def build_clothing(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    if tier <= 2:
        post = .035 if tier == 1 else .05
        for x in (-W / 2 + .08, W / 2 - .08):
            box(f"Upright_{'L' if x < 0 else 'R'}", (post, post, H - .14), (x, 0, (H - .14) / 2 + .08), Pm["frame"], root, bevel=.005)
        rail_x("Hang_Rail", W - .18, H - .18, 0, Pm["frame"], root, radius=.018 if tier == 1 else .025)
        if tier == 1:
            for y in (-D / 2 + .08, D / 2 - .08):
                rail_x(f"Welded_Base_Rail_{y:+.2f}", W - .14, .14, y, Pm["frame"], root, radius=.018)
            for x in (-W / 2 + .08, W / 2 - .08):
                rail_y(f"Welded_Base_Crossrail_{x:+.2f}", D - .16, x, .14, Pm["frame"], root, radius=.018)
        else:
            box("Oak_Lower_Base", (W - .14, D - .12, .04), (0, 0, .18), Pm["wood"], root, bevel=.007)
        for x in (-W / 2 + .09, W / 2 - .09):
            for y in (-D / 2 + .08, D / 2 - .08):
                cyl(f"Caster_Stem_{x:+.2f}_{y:+.2f}", .010, .085, (x, y, .085), Pm["frame"], root, verts=12)
                cyl(f"Caster_{x:+.2f}_{y:+.2f}", .045, .025, (x, y, .045), M["rubber"], root,
                    rot=(math.pi / 2, 0, 0), verts=14)
    else:
        add_case(root, W, D, H, tier, Pm)
        rail_x("Hang_Rail", W - .24, H * .68, -D * .10, Pm["accent"], root, radius=.022)
        add_shelves(root, W, D, H, tier, Pm, [.28, .52] if tier == 3 else [.30, .56])
        add_panel_millwork(root, W, D, H, tier, Pm)
    add_lights(root, W, D, H, tier, Pm, rows=[H - .24, H * .60, .67, .35, .28])
    add_header(root, W, D, H, tier, Pm, "CLOTHING")
    count = [8, 10, 12, 16, 21][tier - 1]
    add_linear_slots(root, "CLOTHING_HANGER_SLOT", count, W - .28, -D * .10, H * .68,
                     slot_type="hanger", accepts=["polo", "jacket", "quarterzip"], max_dims=(.24, .16, .55))
    add_collision(root, W, D, H, M)
    return root


def build_hat(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    if tier == 1:
        for x in (-W / 2 + .06, W / 2 - .06):
            box(f"Upright_{x:+.2f}", (.035, .035, H), (x, .07, H / 2), Pm["frame"], root, bevel=.004)
        for row in range(3):
            rail_x(f"Mesh_Rail_{row + 1}", W - .12, .48 + row * .42, .07, Pm["frame"], root, radius=.012)
    else:
        add_case(root, W, D, H, tier, Pm)
        rows = 5 + tier
        for row in range(rows):
            z = .30 + row * (H - .58) / max(1, rows - 1)
            box(f"Slat_{row + 1:02d}", (W - .12, .035, .055), (0, -D / 2 + .035, z), Pm["wood"], root, bevel=.004)
        add_panel_millwork(root, W, D, H, tier, Pm)
        add_lights(root, W, D, H, tier, Pm)
    add_header(root, W, D, H, tier, Pm, "HEADWEAR")
    count = [8, 12, 16, 20, 30][tier - 1]
    cols = 4 if tier <= 2 else 5 if tier <= 4 else 6
    rows = math.ceil(count / cols)
    for i in range(count):
        row, col = divmod(i, cols)
        x = -W * .38 + (W * .76 * col / max(1, cols - 1))
        z = .40 + (H - .72) * row / max(1, rows - 1)
        cyl(f"Hat_Peg_{i + 1:02d}", .010, D * .55, (x, -D * .18, z), Pm["accent"], root,
            rot=(math.pi / 2, 0, 0), verts=14)
        P.slot(f"HAT_SLOT_{i + 1:02d}", (x, -D / 2 - .08, z), root, slot_type="hat_peg",
               accepts=["cap", "visor"], max_dims=(.24, .24, .18))
    add_collision(root, W, D, H, M)
    return root


def build_shoe(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    if tier == 1:
        for x in (-W / 2 + .05, W / 2 - .05):
            box(f"Post_{x:+.2f}", (.035, .035, H), (x, .08, H / 2), Pm["frame"], root, bevel=.004)
    else:
        add_case(root, W, D, H, tier, Pm)
    levels = 3 + tier
    zs = [.22 + i * (H - .46) / max(1, levels - 1) for i in range(levels)]
    for i, z in enumerate(zs, 1):
        shelf = box(f"Angled_Shoe_Shelf_{i:02d}", (W - .12, D * .72, .028),
                    (0, -.04, z), Pm["wood"] if tier > 1 else Pm["frame"], root,
                    bevel=.005, rot=(math.radians(-7), 0, 0))
        shelf["display_angle_deg"] = 7
    add_header(root, W, D, H, tier, Pm, "FOOTWEAR")
    add_panel_millwork(root, W, D, H, tier, Pm); add_lights(root, W, D, H, tier, Pm, rows=list(reversed(zs)))
    per = 2 if tier <= 3 else 3
    count = levels * per
    for i in range(count):
        row, col = divmod(i, per)
        x = 0 if per == 1 else -W * .30 + W * .60 * col / max(1, per - 1)
        P.slot(f"SHOE_PAIR_SLOT_{i + 1:02d}", (x, -D * .25, zs[row] + .05), root,
               rot=(math.radians(-7), 0, 0), slot_type="shoe_pair", accepts=["golf_shoes"], max_dims=(.34, .28, .16))
    add_collision(root, W, D, H, M)
    return root


def build_club(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    add_case(root, W, D, H, tier, Pm)
    rows = 1 if tier <= 2 else 2
    for row in range(rows):
        z = H * (.70 - row * .32)
        rail_x(f"Club_Support_Rail_{row + 1}", W - .12, z, -D * .18, Pm["accent"], root, radius=.018)
        box(f"Club_Head_Tray_{row + 1}", (W - .14, D * .45, .035), (0, -.03, z - .52), Pm["wood"], root, bevel=.005)
    add_header(root, W, D, H, tier, Pm, "CLUB STUDIO")
    add_panel_millwork(root, W, D, H, tier, Pm); add_lights(root, W, D, H, tier, Pm)
    count = [8, 12, 18, 24, 32][tier - 1]
    add_linear_slots(root, "CLUB_SLOT", count, W - .22, -D * .16, H * .70,
                     slot_type="club", accepts=["driver", "iron", "wedge", "putter"], max_dims=(.10, .12, 1.25), rows=rows)
    add_collision(root, W, D, H, M)
    return root


def build_ball(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    if tier == 1:
        add_case(root, W, D, H, tier, Pm, back=False)
    else:
        add_case(root, W, D, H, tier, Pm)
    levels = 3 + tier
    zs = [.20 + i * (H - .42) / max(1, levels - 1) for i in range(levels)]
    add_shelves(root, W, D, H, tier, Pm, zs, front_lip=True)
    add_header(root, W, D, H, tier, Pm, "GOLF BALLS")
    add_panel_millwork(root, W, D, H, tier, Pm); add_lights(root, W, D, H, tier, Pm, rows=list(reversed(zs)))
    cols = 3 + tier
    for row, z in enumerate(zs):
        for col in range(cols):
            x = -W * .36 + W * .72 * col / max(1, cols - 1)
            P.slot(f"BALL_CARTON_SLOT_{row + 1:02d}_{col + 1:02d}", (x, -D * .28, z + .07), root,
                   slot_type="ball_carton", accepts=["golf_balls"], max_dims=(.17, .15, .10))
    add_collision(root, W, D, H, M)
    return root


def build_accessory(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    add_case(root, W, D, H, tier, Pm)
    slats = 5 + tier * 2
    for row in range(slats):
        z = .25 + row * (H - .50) / max(1, slats - 1)
        box(f"Accessory_Slat_{row + 1:02d}", (W - .12, .028, .045), (0, -D / 2 + .035, z), Pm["wood"], root, bevel=.003)
    cols = 3 + tier
    rows = 2 + tier
    idx = 0
    for row in range(rows):
        for col in range(cols):
            idx += 1; x = -W * .38 + W * .76 * col / max(1, cols - 1); z = .40 + (H - .76) * row / max(1, rows - 1)
            cyl(f"Hook_{idx:02d}", .007, D * .58, (x, -D * .20, z), Pm["accent"], root,
                rot=(math.pi / 2, 0, 0), verts=12)
            P.slot(f"ACCESSORY_HOOK_SLOT_{idx:02d}", (x, -D / 2 - .06, z), root,
                   slot_type="peg_hook", accepts=["glove", "tees", "marker", "towel", "rangefinder"], max_dims=(.22, .12, .28))
    add_header(root, W, D, H, tier, Pm, "ACCESSORIES")
    add_panel_millwork(root, W, D, H, tier, Pm); add_lights(root, W, D, H, tier, Pm)
    add_collision(root, W, D, H, M)
    return root


def build_snack(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    add_case(root, W, D, H, tier, Pm, back=tier > 1)
    levels = 3 + tier
    zs = [.18 + i * (H - .42) / max(1, levels - 1) for i in range(levels)]
    add_shelves(root, W, D, H, tier, Pm, zs, front_lip=True)
    add_header(root, W, D, H, tier, Pm, "GRAB & GO")
    add_panel_millwork(root, W, D, H, tier, Pm); add_lights(root, W, D, H, tier, Pm, rows=list(reversed(zs)))
    cols = 3 + tier
    for row, z in enumerate(zs):
        for col in range(cols):
            x = -W * .37 + W * .74 * col / max(1, cols - 1)
            P.slot(f"SNACK_SLOT_{row + 1:02d}_{col + 1:02d}", (x, -D * .30, z + .10), root,
                   slot_type="snack", accepts=["snack", "bottle"], max_dims=(.18, .16, .26))
    add_collision(root, W, D, H, M)
    return root


def add_hinged_door(root, W, D, H, Pm, tier, *, glass=True, double=False):
    leaves = 2 if double else 1
    for leaf in range(leaves):
        leaf_w = (W - .10) / leaves
        hinge_x = -W / 2 + .05 + leaf * leaf_w
        pivot = L.empty(f"DOOR_PIVOT_{leaf + 1:02d}", (hinge_x, -D / 2 - .02, .10), parent=root,
                        props={"moving_part": True, "pivot_type": "hinge", "axis": "+Z", "open_angle_deg": 105})
        cx = hinge_x + leaf_w / 2
        frame_mat = Pm["wood"] if tier >= 4 else Pm["frame"]
        if glass:
            stile_w = min(.055, leaf_w * .11)
            rail_h = min(.075, H * .08)
            for side, x in (("L", cx - leaf_w / 2 + stile_w / 2), ("R", cx + leaf_w / 2 - stile_w / 2)):
                box(f"Door_Frame_{leaf + 1:02d}_{side}", (stile_w, .045, H - .22),
                    (x, -D / 2 - .02, H / 2), frame_mat, pivot, bevel=.006)
            for edge, z in (("Bottom", .10 + rail_h / 2), ("Top", H - .10 - rail_h / 2)):
                box(f"Door_Frame_{leaf + 1:02d}_{edge}", (leaf_w - .02, .045, rail_h),
                    (cx, -D / 2 - .02, z), frame_mat, pivot, bevel=.006)
            box(f"Door_Glass_{leaf + 1:02d}", (leaf_w - .12, .018, H - .36), (cx, -D / 2 - .05, H / 2), Pm["glass"], pivot, bevel=.002)
        else:
            box(f"Door_Panel_{leaf + 1:02d}", (leaf_w - .02, .045, H - .22),
                (cx, -D / 2 - .02, H / 2), frame_mat, pivot, bevel=.007)
        cyl(f"Door_Handle_{leaf + 1:02d}", .012, .28, (cx + leaf_w * .32, -D / 2 - .085, H / 2),
            Pm["accent"], pivot, verts=16)


def build_fridge(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    add_case(root, W, D, H, tier, Pm)
    levels = 3 + tier
    zs = [.28 + i * (H - .58) / max(1, levels - 1) for i in range(levels)]
    add_shelves(root, W, D, H, tier, Pm, zs, glass_from=3)
    box("Refrigeration_Vent", (W - .16, .035, .12), (0, -D / 2 - .025, .13), Pm["dark"], root, bevel=.004)
    add_hinged_door(root, W, D, H, Pm, tier, glass=True, double=tier >= 4)
    add_header(root, W, D, H, tier, Pm, "COLD DRINKS")
    add_lights(root, W, D, H, tier, Pm, rows=list(reversed(zs)))
    cols = 2 + tier
    for row, z in enumerate(zs):
        for col in range(cols):
            x = -W * .34 + W * .68 * col / max(1, cols - 1)
            P.slot(f"DRINK_SLOT_{row + 1:02d}_{col + 1:02d}", (x, -D * .17, z + .12), root,
                   slot_type="bottle", accepts=["bottle", "can"], max_dims=(.10, .10, .28))
    add_collision(root, W, D, H, M)
    return root


def build_impulse(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    add_case(root, W, D, H, tier, Pm)
    levels = 2 + tier
    zs = [.18 + i * (H - .36) / max(1, levels - 1) for i in range(levels)]
    add_shelves(root, W, D, H, tier, Pm, zs, front_lip=True, glass_from=4)
    add_header(root, W, D, H, tier, Pm, "LAST LOOK")
    add_panel_millwork(root, W, D, H, tier, Pm); add_lights(root, W, D, H, tier, Pm, rows=list(reversed(zs)))
    for i, z in enumerate(zs, 1):
        P.slot(f"IMPULSE_SLOT_{i:02d}", (0, -D * .28, z + .07), root, slot_type="impulse",
               accepts=["tees", "marker", "glove", "snack"], max_dims=(W - .15, .18, .20))
    add_collision(root, W, D, H, M)
    return root


def build_checkout(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    box("Counter_Display_Base", (W, D, .06), (0, 0, .03), Pm["wood"], root, bevel=.008)
    supports = 1 if tier <= 2 else 2
    for i in range(supports):
        x = 0 if supports == 1 else (-W * .24 if i == 0 else W * .24)
        box(f"Riser_Support_{i + 1:02d}", (.035, .045, H - .12), (x, D * .20, H / 2),
            Pm["frame"] if tier <= 3 else Pm["accent"], root, bevel=.004)
    if tier >= 4:
        box("Checkout_Back_Panel", (W * .72, .025, H * .56), (0, D * .22, H * .48),
            Pm["panel"], root, bevel=.005)
    levels = 1 + tier
    for i in range(levels):
        z = .12 + i * (H - .18) / max(1, levels - 1)
        width = W * (1 - i * .07)
        box(f"Riser_{i + 1:02d}", (width, D * .70, .035), (0, .02 + i * .025, z),
            Pm["glass"] if tier >= 4 else Pm["wood"], root, bevel=.005)
        box(f"Riser_Lip_{i + 1:02d}", (width, .018, .05), (0, -D * .34, z + .03), Pm["accent"], root, bevel=.002)
        P.slot(f"CHECKOUT_DISPLAY_SLOT_{i + 1:02d}", (0, -D * .18, z + .05), root,
               slot_type="countertop", accepts=["marker", "tees", "rangefinder", "glove"], max_dims=(width - .05, .18, .20))
    add_lights(root, W, D, H, tier, Pm, rows=[H - .12, H * .64, H * .42, .18, .10])
    add_collision(root, W, D, H, M)
    return root


def build_feature_table(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    top_t = .055 if tier <= 2 else .075
    box("Feature_Table_Top", (W, D, top_t), (0, 0, H - top_t / 2), Pm["wood"], root, bevel=.014)
    if tier == 1:
        for x in (-W * .40, W * .40):
            for y in (-D * .36, D * .36):
                box(f"Leg_{x:+.2f}_{y:+.2f}", (.045, .045, H - top_t), (x, y, (H - top_t) / 2), Pm["frame"], root, bevel=.004)
    else:
        box("Feature_Table_Plinth", (W * .55, D * .48, H - top_t), (0, 0, (H - top_t) / 2), Pm["wood"], root, bevel=.012)
        if tier >= 3:
            box("Lower_Display_Deck", (W * .78, D * .72, .045), (0, 0, .28), Pm["wood"], root, bevel=.008)
        if tier >= 4:
            for x in (-W * .23, W * .23):
                box(f"Inset_Panel_{x:+.2f}", (W * .34, .025, H * .36), (x, -D * .25, H * .40), Pm["panel"], root, bevel=.006)
    add_lights(root, W, D, H, tier, Pm, rows=[H - .09, .42, .32, .18, .12])
    cols = 2 + tier
    rows = 2 if tier >= 3 else 1
    idx = 0
    for row in range(rows):
        for col in range(cols):
            idx += 1; x = -W * .38 + W * .76 * col / max(1, cols - 1); y = -D * .20 + row * D * .40
            P.slot(f"FEATURE_TABLE_SLOT_{idx:02d}", (x, y, H), root, slot_type="tabletop",
                   accepts=["folded_apparel", "shoes", "balls", "rangefinder"], max_dims=(.30, .28, .26))
    add_collision(root, W, D, H, M)
    return root


def build_window(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    box("Window_Display_Platform", (W, D, .14 if tier >= 4 else .09), (0, 0, .07), Pm["wood"], root, bevel=.014)
    box("Window_Backdrop", (W, .045, H - .12), (0, D / 2 - .03, H / 2 + .04), Pm["panel"], root, bevel=.008)
    if tier >= 2:
        for x in (-W / 2 + .045, W / 2 - .045):
            box(f"Window_Frame_{x:+.2f}", (.07, .07, H), (x, D / 2 - .02, H / 2), Pm["frame"], root, bevel=.006)
    plinths = 1 + tier
    for i in range(plinths):
        x = -W * .36 + W * .72 * i / max(1, plinths - 1)
        ph = .25 + .10 * (i % 2) + .03 * tier
        box(f"Display_Plinth_{i + 1:02d}", (W / (plinths + .7), D * .48, ph), (x, -.08, .09 + ph / 2), Pm["wood"], root, bevel=.012)
        P.slot(f"WINDOW_DISPLAY_SLOT_{i + 1:02d}", (x, -.08, .09 + ph), root, slot_type="plinth",
               accepts=["bag", "shoes", "apparel", "clubs"], max_dims=(W / plinths, D * .42, H * .50))
    add_header(root, W, D, H, tier, Pm, "SEASONAL EDIT")
    add_crown(root, W, D, H, tier, Pm); add_lights(root, W, D, H, tier, Pm)
    add_collision(root, W, D, H, M)
    return root


def build_island(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    box("Island_Base", (W, D, .12), (0, 0, .06), Pm["wood"], root, bevel=.016)
    box("Island_Core", (W * .55, D * .55, H * .54), (0, 0, H * .28 + .12), Pm["panel"], root, bevel=.018)
    decks = 1 + tier
    for i in range(decks):
        z = .24 + i * (H - .36) / max(1, decks - 1)
        scale = 1 - i * .07
        box(f"Island_Deck_{i + 1:02d}", (W * scale, D * scale, .045), (0, 0, z),
            Pm["glass"] if tier >= 4 and i > 0 else Pm["wood"], root, bevel=.010)
    if tier >= 3:
        for a in range(4):
            ang = a * math.pi / 2
            x, y = math.cos(ang) * W * .32, math.sin(ang) * D * .32
            box(f"Island_Brass_Post_{a + 1}", (.025, .025, H * .46), (x, y, H * .60), Pm["accent"], root, bevel=.003)
    add_lights(root, W, D, H, tier, Pm, rows=[H - .12, H * .72, H * .48, .30, .20])
    for face in range(4):
        ang = face * math.pi / 2
        for i in range(1 + tier):
            along = -W * .28 + W * .56 * i / max(1, tier)
            x = along if face % 2 == 0 else math.cos(ang) * W * .33
            y = along if face % 2 == 1 else math.sin(ang) * D * .33
            P.slot(f"ISLAND_SLOT_{face + 1}_{i + 1:02d}", (x, y, H * .72), root, rot=(0, 0, ang),
                   slot_type="island", accepts=["premium_merchandise"], max_dims=(.32, .28, .42))
    add_collision(root, W, D, H, M)
    return root


def build_slat(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    box("Slatwall_Back", (W, .035, H), (0, D / 2 - .025, H / 2), Pm["panel"], root, bevel=.004)
    slats = 6 + tier * 2
    for i in range(slats):
        z = .16 + i * (H - .32) / max(1, slats - 1)
        box(f"Slat_{i + 1:02d}", (W, .035, .045), (0, -D / 2 + .025, z), Pm["wood"], root, bevel=.003)
    if tier >= 2:
        box("Slatwall_Left_Trim", (.055, D, H), (-W / 2 + .028, 0, H / 2), Pm["frame"], root, bevel=.006)
        box("Slatwall_Right_Trim", (.055, D, H), (W / 2 - .028, 0, H / 2), Pm["frame"], root, bevel=.006)
    add_header(root, W, D, H, tier, Pm, "MODULAR WALL")
    add_crown(root, W, D, H, tier, Pm); add_lights(root, W, D, H, tier, Pm)
    cols = 3 + tier; rows = 2 + tier
    for row in range(rows):
        for col in range(cols):
            i = row * cols + col + 1; x = -W * .38 + W * .76 * col / max(1, cols - 1); z = .30 + (H - .58) * row / max(1, rows - 1)
            P.slot(f"SLAT_SYSTEM_SLOT_{i:02d}", (x, -D / 2 - .04, z), root, slot_type="slat_accessory",
                   accepts=["hook", "shelf", "rail"], max_dims=(.35, .30, .30))
    add_collision(root, W, D, H, M)
    return root


def build_cabinetry(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    add_case(root, W, D, H, tier, Pm)
    levels = 2 + tier
    zs = [.30 + i * (H - .60) / max(1, levels - 1) for i in range(levels)]
    add_shelves(root, W, D, H, tier, Pm, zs, glass_from=5)
    if tier >= 4:
        add_panel_millwork(root, W, D, H, tier, Pm)
    if tier >= 3:
        add_hinged_door(root, W, D, H * .50, Pm, tier, glass=tier >= 4, double=W > 1.8)
    add_header(root, W, D, H, tier, Pm, "CLUB CABINETRY")
    add_lights(root, W, D, H, tier, Pm, rows=list(reversed(zs)))
    cols = 2 + tier
    for row, z in enumerate(zs):
        for col in range(cols):
            x = -W * .36 + W * .72 * col / max(1, cols - 1)
            P.slot(f"CABINET_SLOT_{row + 1:02d}_{col + 1:02d}", (x, -D * .22, z + .08), root,
                   slot_type="cabinet_shelf", accepts=["boxed_goods", "folded_apparel", "awards"], max_dims=(.30, .28, .28))
    add_collision(root, W, D, H, M)
    return root


def build_tower(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    box("Tower_Base", (W, D, .12), (0, 0, .06), Pm["wood"], root, bevel=.012)
    box("Tower_Top", (W, D, .10), (0, 0, H - .05), Pm["wood"], root, bevel=.012)
    for x in (-W / 2 + .035, W / 2 - .035):
        for y in (-D / 2 + .035, D / 2 - .035):
            box(f"Tower_Post_{x:+.2f}_{y:+.2f}", (.045, .045, H - .20), (x, y, H / 2), Pm["frame" if tier <= 2 else "wood"], root, bevel=.005)
    for side, (dims2, loc) in enumerate([
        ((W - .10, .018, H - .25), (0, D / 2 - .04, H / 2)),
        ((.018, D - .10, H - .25), (-W / 2 + .04, 0, H / 2)),
        ((.018, D - .10, H - .25), (W / 2 - .04, 0, H / 2)),
    ], 1):
        box(f"Tower_Glass_{side}", dims2, loc, Pm["glass"], root, bevel=.002)
    add_hinged_door(root, W, D, H, Pm, tier, glass=True)
    levels = 2 + tier
    zs = [.24 + i * (H - .48) / max(1, levels - 1) for i in range(levels)]
    add_shelves(root, W, D, H, tier, Pm, zs, glass_from=1)
    add_crown(root, W, D, H, tier, Pm); add_lights(root, W, D, H, tier, Pm, rows=list(reversed(zs)))
    for i, z in enumerate(zs, 1):
        P.slot(f"TOWER_SLOT_{i:02d}", (0, 0, z + .06), root, slot_type="glass_tower",
               accepts=["rangefinder", "collectible", "premium_accessory"], max_dims=(W - .15, D - .15, .30))
    add_collision(root, W, D, H, M)
    return root


def build_corner(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    t = .04 if tier <= 2 else .06
    box("Corner_Back_X", (W, t, H), (0, D / 2 - t / 2, H / 2), Pm["panel"], root, bevel=.005)
    box("Corner_Back_Y", (t, D, H), (W / 2 - t / 2, 0, H / 2), Pm["panel"], root, bevel=.005)
    levels = 3 + tier
    zs = [.18 + i * (H - .36) / max(1, levels - 1) for i in range(levels)]
    for i, z in enumerate(zs, 1):
        box(f"Corner_Shelf_X_{i:02d}", (W, D * .42, .035), (0, D * .29, z), Pm["wood"], root, bevel=.007)
        box(f"Corner_Shelf_Y_{i:02d}", (W * .42, D, .035), (W * .29, 0, z), Pm["wood"], root, bevel=.007)
        P.slot(f"CORNER_SLOT_X_{i:02d}", (-W * .18, D * .27, z + .06), root, slot_type="corner_shelf",
               accepts=["boxed_goods", "apparel", "accessory"], max_dims=(W * .45, D * .34, .28))
        P.slot(f"CORNER_SLOT_Y_{i:02d}", (W * .27, -D * .18, z + .06), root, slot_type="corner_shelf",
               accepts=["boxed_goods", "apparel", "accessory"], max_dims=(W * .34, D * .45, .28))
    add_crown(root, W, D, H, tier, Pm); add_lights(root, W, D, H, tier, Pm, rows=list(reversed(zs)))
    add_collision(root, W, D, H, M)
    return root


def build_rotating(family, tier, dims, M):
    W, D, H = dims; Pm = tier_palette(M, tier); root = root_for(family, tier, dims)
    cyl("Stationary_Base", min(W, D) * .46, .12, (0, 0, .06), Pm["wood"], root, verts=32,
        props={"stationary": True})
    cyl("Turntable_Bearing", min(W, D) * .31, .06, (0, 0, .15), Pm["accent"], root, verts=28,
        props={"stationary": True})
    rotor = L.empty("ROTATING_CAROUSEL_PIVOT", (0, 0, .18), parent=root,
                    props={"moving_part": True, "pivot_type": "turntable", "axis": "+Z", "rotation_deg": 360})
    cyl("Rotor_Column", .045 + tier * .006, H - .30, (0, 0, H / 2), Pm["frame"], rotor, verts=20)
    levels = 2 + tier
    for i in range(levels):
        z = .30 + i * (H - .52) / max(1, levels - 1)
        cyl(f"Rotor_Deck_{i + 1:02d}", min(W, D) * (.39 - i * .015), .035, (0, 0, z),
            Pm["glass"] if tier >= 4 else Pm["wood"], rotor, verts=28)
        arms = 4 + tier
        for arm in range(arms):
            angle = arm * math.tau / arms
            x, y = math.cos(angle) * W * .31, math.sin(angle) * D * .31
            P.slot(f"ROTATING_SLOT_{i + 1:02d}_{arm + 1:02d}", (x, y, z + .05), rotor,
                   rot=(0, 0, angle), slot_type="rotating", accepts=["hat", "accessory", "boxed_goods"], max_dims=(.20, .18, .28))
    if tier >= 2:
        cyl("Rotor_Canopy", min(W, D) * .43, .08, (0, 0, H - .08), Pm["wood"], rotor, verts=28)
    add_rotating_lights(rotor, W, D, H, tier, Pm)
    add_collision(root, W, D, .22, M, height=.22, z=.11, name="COL_Stationary_Base")
    return root


BUILDERS = {
    "clothing_rack": build_clothing,
    "hat_wall": build_hat,
    "shoe_display": build_shoe,
    "golf_club_wall": build_club,
    "ball_display": build_ball,
    "accessory_rack": build_accessory,
    "snack_shelving": build_snack,
    "drink_refrigerator": build_fridge,
    "impulse_shelf": build_impulse,
    "checkout_display": build_checkout,
    "feature_table": build_feature_table,
    "window_display": build_window,
    "luxury_display_island": build_island,
    "wall_slat_system": build_slat,
    "built_in_cabinetry": build_cabinetry,
    "glass_display_tower": build_tower,
    "corner_shelving": build_corner,
    "rotating_display": build_rotating,
}


def make_builder(family, tier, dims):
    return lambda M: BUILDERS[family](family, tier, dims, M)


REGISTRY = {
    f"pf_display_{family}_t{tier}": make_builder(family, tier, dims)
    for family, tiers in FAMILY_DIMS.items()
    for tier, dims in enumerate(tiers, 1)
}


def manifest_extra(asset_id):
    family = next(key for key in FAMILY_DIMS if asset_id.startswith(f"pf_display_{key}_t"))
    tier = int(asset_id.rsplit("_t", 1)[1])
    spec = TIER[tier]
    dims = FAMILY_DIMS[family][tier - 1]
    return {
        "name": f"{FAMILY_LABELS[family]} - Tier {tier} {spec['quality']}",
        "variant": spec["name"],
        "tier": tier,
        "quality": spec["quality"],
        "price_band": spec["price_band"],
        "material_story": spec["materials"],
        "size_grade": tier,
        "material_grade": tier,
        "custom_woodwork_level": max(0, tier - 1),
        "fixture_complexity_grade": tier,
        "integrated_light_count": spec["lights"],
        "target_dimensions_m": list(dims),
        "references": REFERENCE_FILES,
        "license": "Project-owned / UNLICENSED",
        "source_note": "Original in-repository Blender geometry; no external assets downloaded",
        "price": None,
        "fixture": "store_display_upgrade",
        "slot_type": "authored_in_glb",
        "packaging": "fixture_freight",
    }


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    selectors = [arg for arg in argv if arg not in {"all", "render", "nojoin"}]
    selected = list(REGISTRY)
    if selectors:
        selected = [aid for aid in REGISTRY if aid in selectors or any(aid.startswith(f"pf_display_{s}_t") for s in selectors)]
        if not selected:
            raise SystemExit(f"No display assets matched: {selectors}")
    P.run_batch(REGISTRY, kind="fixtures", category_of=lambda aid: f"store_displays/{next(key for key in FAMILY_DIMS if aid.startswith(f'pf_display_{key}_t'))}",
                default=selected, manifest_extra=manifest_extra)


if __name__ == "__main__":
    main()
