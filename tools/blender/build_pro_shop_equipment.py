"""Build the five-level Pinehollow pro-shop equipment library.

The visual ladder follows the owner-supplied Designs/ClubHouse reference:
Basic -> Standard -> Premium -> High-End -> Luxury. Geometry, capacity and
moving parts evolve at every step; tier variants are never mere recolours.

Run from the repository root:

  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
    --background --factory-startup \
    --python tools/blender/build_pro_shop_equipment.py -- checkout render

Currently the checkout-critical family group is production-ready. Additional
family builders are added to BUILDERS without changing the export contract.
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import bpy

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

import lib_props as L


TIERS = (
    {"id": "municipal", "level": 1, "name": "Municipal", "reference": "Basic"},
    {"id": "public", "level": 2, "name": "Public Course", "reference": "Standard"},
    {"id": "premium", "level": 3, "name": "Premium", "reference": "Premium"},
    {"id": "high_end", "level": 4, "name": "High-End", "reference": "High-End"},
    {"id": "country_club", "level": 5, "name": "Country Club", "reference": "Luxury"},
)

DIMENSIONS = {
    "golf_cart": (
        (2.40, 1.20, 1.78), (2.45, 1.22, 1.82), (2.72, 1.25, 1.88),
        (2.76, 1.28, 1.92), (3.35, 1.32, 1.95),
    ),
    "push_cart": (
        (1.18, 0.66, 1.05), (1.22, 0.69, 1.08), (1.28, 0.72, 1.10),
        (1.30, 0.74, 1.12), (1.34, 0.76, 1.14),
    ),
    "utility_cart": (
        (2.55, 1.26, 1.76), (2.62, 1.28, 1.80), (2.72, 1.32, 1.84),
        (2.82, 1.35, 1.88), (2.92, 1.38, 1.92),
    ),
    "maintenance_cart": (
        (2.62, 1.30, 1.82), (2.70, 1.34, 1.86), (2.80, 1.38, 1.90),
        (2.90, 1.40, 1.94), (3.00, 1.44, 1.98),
    ),
    "ball_washer": (
        (0.34, 0.28, 1.16), (0.36, 0.30, 1.20), (0.40, 0.32, 1.24),
        (0.43, 0.34, 1.27), (0.46, 0.36, 1.31),
    ),
    "club_cleaner": (
        (0.42, 0.36, 0.98), (0.45, 0.38, 1.02), (0.48, 0.40, 1.06),
        (0.52, 0.43, 1.10), (0.56, 0.46, 1.14),
    ),
    "bag_stand": (
        (0.58, 0.48, 0.70), (0.62, 0.50, 0.74), (0.68, 0.54, 0.78),
        (0.72, 0.58, 0.82), (0.78, 0.62, 0.88),
    ),
    "range_basket": (
        (0.34, 0.34, 0.26), (0.36, 0.36, 0.28), (0.38, 0.38, 0.30),
        (0.40, 0.40, 0.32), (0.42, 0.42, 0.34),
    ),
    "scorecard_holder": (
        (0.28, 0.20, 0.25), (0.30, 0.22, 0.27), (0.33, 0.23, 0.29),
        (0.35, 0.25, 0.31), (0.38, 0.27, 0.34),
    ),
    "practice_basket": (
        (0.48, 0.48, 0.62), (0.52, 0.52, 0.68), (0.56, 0.56, 0.74),
        (0.60, 0.60, 0.80), (0.66, 0.66, 0.88),
    ),
    "water_cooler": (
        (0.46, 0.46, 1.18), (0.48, 0.48, 1.24), (0.52, 0.52, 1.30),
        (0.56, 0.56, 1.36), (0.62, 0.62, 1.44),
    ),
    "trash_can": (
        (0.48, 0.48, 0.76), (0.52, 0.52, 0.82), (0.56, 0.56, 0.88),
        (0.60, 0.60, 0.96), (0.66, 0.66, 1.06),
    ),
    "bench": (
        (1.55, 0.52, 0.82), (1.65, 0.56, 0.86), (1.75, 0.60, 0.90),
        (1.86, 0.64, 0.94), (2.00, 0.68, 0.98),
    ),
    "bag_drop_station": (
        (1.50, 0.72, 1.25), (1.70, 0.78, 1.55), (1.92, 0.84, 1.95),
        (2.12, 0.90, 2.15), (2.35, 0.98, 2.32),
    ),
    "golf_club_storage": (
        (1.35, 0.48, 1.85), (1.50, 0.52, 1.94), (1.68, 0.56, 2.02),
        (1.88, 0.60, 2.10), (2.10, 0.66, 2.18),
    ),
    "rental_club_storage": (
        (1.50, 0.58, 1.82), (1.68, 0.62, 1.92), (1.88, 0.66, 2.02),
        (2.10, 0.70, 2.12), (2.35, 0.76, 2.22),
    ),
    "display_tv": (
        (0.82, 0.10, 0.52), (1.05, 0.10, 0.64), (1.28, 0.09, 0.76),
        (1.58, 0.08, 0.92), (1.88, 0.08, 1.08),
    ),
    "pos_terminal": (
        (0.30, 0.23, 0.31), (0.34, 0.24, 0.34), (0.38, 0.25, 0.37),
        (0.41, 0.26, 0.39), (0.45, 0.28, 0.42),
    ),
    "card_reader": (
        (0.084, 0.14, 0.17), (0.090, 0.15, 0.18), (0.096, 0.16, 0.19),
        (0.104, 0.17, 0.20), (0.112, 0.18, 0.22),
    ),
    "receipt_printer": (
        (0.15, 0.18, 0.12), (0.17, 0.19, 0.13), (0.18, 0.20, 0.14),
        (0.20, 0.22, 0.15), (0.22, 0.24, 0.17),
    ),
    "cash_drawer": (
        (0.36, 0.38, 0.10), (0.39, 0.40, 0.11), (0.42, 0.42, 0.12),
        (0.45, 0.44, 0.13), (0.48, 0.46, 0.14),
    ),
    "computer": (
        (0.50, 0.30, 0.52), (0.56, 0.30, 0.54), (0.62, 0.31, 0.56),
        (0.68, 0.32, 0.58), (0.74, 0.34, 0.60),
    ),
    "laptop": (
        (0.32, 0.23, 0.22), (0.34, 0.24, 0.23), (0.36, 0.25, 0.24),
        (0.38, 0.26, 0.25), (0.40, 0.27, 0.26),
    ),
    "office_chair": (
        (0.56, 0.56, 0.96), (0.58, 0.58, 1.02), (0.61, 0.61, 1.08),
        (0.64, 0.64, 1.14), (0.68, 0.68, 1.20),
    ),
}

PROGRESSION = {
    "golf_cart": (
        "2-seat manual municipal cart", "2-seat cart with canopy and bag well",
        "4-seat cart with windshield and upgraded seats", "4-seat lithium cart with enclosed storage",
        "6-seat enclosed country-club shuttle",
    ),
    "push_cart": (
        "two-wheel painted-steel frame", "three-wheel folding frame",
        "four-wheel frame with scorecard tray", "braked aluminum frame with storage console",
        "carbon-look concierge cart with brass details",
    ),
    "utility_cart": (
        "open two-seat flatbed", "canopy and drop-side bed", "windshield and lockable toolbox",
        "lithium power with enclosed cab", "quiet country-club service vehicle with finished cargo box",
    ),
    "maintenance_cart": (
        "steel work bed and hand-tool rack", "canopy, side rails and hose reel",
        "enclosed tool cabinets and beacon", "weather cab with powered lift bed",
        "quiet fleet unit with integrated wash-down system",
    ),
    "ball_washer": (
        "single manual drum on painted post", "powder-coated drum with towel ring",
        "dual ball-and-club station", "cast housing with waste bin and signage",
        "walnut-and-brass four-station amenity",
    ),
    "club_cleaner": (
        "bucket and fixed brush", "covered manual brush station", "dual brush with drip tray",
        "powered enclosed cleaner", "brass-trimmed concierge wash station",
    ),
    "bag_stand": (
        "painted tubular single-bag stand", "powder-coated two-bag stand", "oak rail with padded rests",
        "walnut valet stand with shelf", "brass-trimmed four-bag arrival stand",
    ),
    "range_basket": (
        "galvanized wire basket", "coated-steel basket with handle grip", "molded stackable basket",
        "reinforced basket with ball-count plaque", "woven-look brass-accent range basket",
    ),
    "scorecard_holder": (
        "bent sheet-metal pocket", "powder-coated four-slot holder", "oak stepped organizer",
        "walnut organizer with pencil cup", "brass-inlaid concierge scorecard cabinet",
    ),
    "practice_basket": (
        "wire chipping basket", "coated target basket with flag", "folding basket with two target rings",
        "weighted premium target with collection tray", "brass-ringed academy target and crest flag",
    ),
    "water_cooler": (
        "insulated jug on steel stand", "covered cooler with cup dispenser", "cabinet cooler with drain tray",
        "refrigerated refill station", "stone-base filtered hydration station",
    ),
    "trash_can": (
        "open galvanized bin", "lidded powder-coated can", "slatted oak receptacle",
        "walnut dual-stream receptacle", "stone-and-brass waste/recycling station",
    ),
    "bench": (
        "painted steel slat bench", "treated timber course bench", "oak bench with back and arms",
        "walnut memorial bench", "curved country-club bench with brass plaque",
    ),
    "bag_drop_station": (
        "portable bag rack and sign", "covered two-bay drop rack", "oak valet counter with canopy",
        "walnut four-bay concierge station", "country-club porte-cochere valet kiosk",
    ),
    "golf_club_storage": (
        "open steel club rack", "slotted powder-coated rack", "oak rack with head dividers",
        "walnut locking club cabinet", "lit country-club club wall with brass rails",
    ),
    "rental_club_storage": (
        "numbered open rental rack", "rolling rack with bag bays", "oak issue station with cubbies",
        "walnut locking fleet cabinet", "lit concierge rental wall with service counter",
    ),
    "display_tv": (
        "small wall display with thick bezel", "commercial score display", "thin 4K leaderboard display",
        "large multi-input hospitality display", "framed country-club presentation display",
    ),
    "pos_terminal": (
        "compact button till display", "touch POS on weighted stand",
        "dual-hinge widescreen POS", "all-in-one hospitality terminal",
        "walnut-and-brass concierge POS",
    ),
    "card_reader": (
        "magstripe keypad reader", "chip-and-swipe countertop reader",
        "touch reader with contactless target", "wireless hospitality reader",
        "brass-detailed country-club payment reader",
    ),
    "receipt_printer": (
        "compact impact printer", "covered thermal printer",
        "fast cutter printer with status panel", "network printer with enclosed roll",
        "walnut-clad silent concierge printer",
    ),
    "cash_drawer": (
        "four-note steel till", "five-note/five-coin insert",
        "locking heavy-duty drawer", "smart-count hospitality drawer",
        "walnut-fronted brass-latched cash drawer",
    ),
    "computer": (
        "refurbished desktop with separate tower", "commercial desktop workstation",
        "all-in-one office computer", "dual-display management workstation",
        "walnut-base executive management computer",
    ),
    "laptop": (
        "thick refurbished notebook", "durable business laptop", "slim aluminum operations laptop",
        "high-resolution executive laptop", "leather-sleeved brass-accent club laptop",
    ),
    "office_chair": (
        "simple task chair", "padded adjustable office chair", "ergonomic mesh chair with arms",
        "leather executive chair", "tufted country-club chair with walnut arms",
    ),
}

GLB_DIR = ROOT / "vendor" / "models" / "pro_shop_equipment"
SOURCE_DIR = ROOT / "asset_sources" / "blender" / "pro_shop_equipment"
MANIFEST_PATH = GLB_DIR / "_manifest.json"
BUILD_VERSION = 1
FPS = 30


def material(name, color, roughness=0.55, metallic=0.0, emission=None, strength=0.0):
    mat = L.mat(name, color, roughness=roughness, metallic=metallic)
    if emission is not None:
        node = mat.node_tree.nodes.get("Principled BSDF")
        socket = node.inputs.get("Emission Color") or node.inputs.get("Emission")
        if socket:
            socket.default_value = (*emission, 1.0)
        if node.inputs.get("Emission Strength"):
            node.inputs["Emission Strength"].default_value = strength
    return mat


def materials():
    pine = L.materials()
    return {
        **pine,
        "municipal": material("EQ_MunicipalPaint", (0.20, 0.23, 0.22), 0.78, 0.10),
        "public": material("EQ_PublicGreen", (0.075, 0.16, 0.105), 0.60, 0.10),
        "premium": material("EQ_PremiumCharcoal", (0.035, 0.040, 0.043), 0.43, 0.28),
        "high_end": material("EQ_HighEndSage", (0.17, 0.24, 0.18), 0.48, 0.05),
        "country_club": material("EQ_CountryCream", (0.72, 0.68, 0.57), 0.42, 0.02),
        "aluminum": material("EQ_Aluminum", (0.42, 0.45, 0.47), 0.30, 0.82),
        "dark_steel": material("EQ_DarkSteel", (0.045, 0.048, 0.052), 0.42, 0.72),
        "rubber": material("EQ_Rubber", (0.018, 0.020, 0.022), 0.90, 0.0),
        "screen": material("EQ_Screen", (0.008, 0.012, 0.014), 0.13, 0.06,
                           emission=(0.018, 0.042, 0.034), strength=0.42),
        "screen_live": material("EQ_ScreenLive", (0.018, 0.065, 0.042), 0.16, 0.04,
                                emission=(0.05, 0.22, 0.12), strength=0.55),
        "key": material("EQ_Key", (0.12, 0.13, 0.14), 0.62, 0.0),
        "paper": material("EQ_Paper", (0.88, 0.86, 0.77), 0.82, 0.0),
        "led_green": material("EQ_LedGreen", (0.04, 0.54, 0.12), 0.25, 0.0,
                              emission=(0.08, 1.0, 0.20), strength=1.8),
        "led_amber": material("EQ_LedAmber", (0.78, 0.42, 0.05), 0.25, 0.0,
                              emission=(1.0, 0.42, 0.04), strength=1.4),
        "glass": material("EQ_GlassBlue", (0.28, 0.48, 0.52), 0.10, 0.05),
        "white": material("EQ_WarmWhite", (0.84, 0.82, 0.74), 0.58, 0.0),
        "fabric": material("EQ_SageFabric", (0.18, 0.27, 0.20), 0.88, 0.0),
        "leather": material("EQ_DeepGreenLeather", (0.025, 0.09, 0.055), 0.42, 0.0),
        "red": material("EQ_ServiceRed", (0.52, 0.045, 0.025), 0.46, 0.05),
        "amber": material("EQ_BeaconAmber", (0.92, 0.32, 0.035), 0.22, 0.0,
                           emission=(1.0, 0.18, 0.02), strength=0.7),
        "stone": material("EQ_WarmStone", (0.31, 0.29, 0.24), 0.78, 0.0),
    }


def group(name, parent=None, props=None, location=(0.0, 0.0, 0.0)):
    obj = L.empty(name, location, parent=parent, props=props)
    return obj


def root_for(family, tier_index, dims):
    tier = TIERS[tier_index]
    asset_id = f"{family}_{tier['id']}"
    root = L.asset_root(asset_id, dims)
    root["asset_version"] = BUILD_VERSION
    root["equipment_family"] = family
    root["quality_tier"] = tier["id"]
    root["quality_level"] = tier["level"]
    root["reference_tier"] = tier["reference"]
    root["visual_progression"] = PROGRESSION[family][tier_index]
    root["source_reference"] = "Owner-supplied Designs/ClubHouse images"
    root["style"] = "Pinehollow stylized PBR"
    root["units"] = "meters"
    root["front"] = "-Y"
    root["license"] = "Project-owned / UNLICENSED"
    return root


def tier_body_material(M, tier_index):
    return M[TIERS[tier_index]["id"]]


def tier_trim_material(M, tier_index):
    if tier_index == 0:
        return M["dark_steel"]
    if tier_index == 1:
        return M["aluminum"]
    if tier_index == 2:
        return M["oak"]
    if tier_index == 3:
        return M["walnut"]
    return M["brass"]


def anchor(name, parent, location, **props):
    return L.empty(name, location, parent=parent, props={"anchor": True, **props})


def animate_location(obj, name, closed, opened, frames=18):
    obj.location = closed
    obj.keyframe_insert(data_path="location", frame=1)
    obj.location = opened
    obj.keyframe_insert(data_path="location", frame=1 + frames)
    action = obj.animation_data.action
    action.name = name
    action.use_fake_user = True
    track = obj.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, action)
    strip.name = name
    track.mute = True
    obj.animation_data.action = None
    obj.location = closed


def animate_rotation(obj, name, closed, opened, frames=18):
    obj.rotation_euler = closed
    obj.keyframe_insert(data_path="rotation_euler", frame=1)
    obj.rotation_euler = opened
    obj.keyframe_insert(data_path="rotation_euler", frame=1 + frames)
    action = obj.animation_data.action
    action.name = name
    action.use_fake_user = True
    track = obj.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, action)
    strip.name = name
    track.mute = True
    obj.animation_data.action = None
    obj.rotation_euler = closed


def screen_panel(name, parent, width, height, center_z, depth, M, tier_index):
    body = tier_body_material(M, tier_index)
    trim = tier_trim_material(M, tier_index)
    bezel = 0.020 if tier_index == 0 else max(0.010, 0.018 - tier_index * 0.002)
    L.box(f"{name}_Back", (width, depth, height), (0, 0, center_z), body,
          bevel=min(0.014, height * 0.05), parent=parent)
    L.box(f"{name}_TrimTop", (width, 0.008, bezel), (0, -depth / 2 - 0.002, center_z + height / 2 - bezel / 2), trim,
          bevel=0.002, parent=parent)
    L.box(f"{name}_TrimBottom", (width, 0.008, bezel), (0, -depth / 2 - 0.002, center_z - height / 2 + bezel / 2), trim,
          bevel=0.002, parent=parent)
    for side in (-1, 1):
        L.box(f"{name}_TrimSide_{side}", (bezel, 0.008, height - 2 * bezel),
              (side * (width / 2 - bezel / 2), -depth / 2 - 0.002, center_z), trim,
              bevel=0.002, parent=parent)
    screen = L.box(f"{name}_Screen", (width - 2 * bezel, 0.004, height - 2 * bezel),
                   (0, -depth / 2 - 0.007, center_z), M["screen_live"], bevel=0.002, parent=parent,
                   props={"dynamic_screen": True, "screen_px": [1024, 768]})
    return screen


def build_pos(tier_index, M):
    dims = DIMENSIONS["pos_terminal"][tier_index]
    w, d, h = dims
    root = root_for("pos_terminal", tier_index, dims)
    body = tier_body_material(M, tier_index)
    trim = tier_trim_material(M, tier_index)

    base_h = 0.030 + tier_index * 0.004
    base_w = w * (0.72 + tier_index * 0.035)
    base_d = d * 0.72
    L.box("POS_Base", (base_w, base_d, base_h), (0, 0.025, base_h / 2), body,
          bevel=0.012, parent=root)
    L.box("POS_BaseTrim", (base_w * 0.86, base_d + 0.004, 0.008),
          (0, 0.025, base_h + 0.002), trim, bevel=0.002, parent=root)

    stem_h = h * (0.22 + tier_index * 0.02)
    stem = group("POS_TiltPivot", root, {
        "moving_part": "display_tilt", "pivot_axis": "+X", "range_degrees": [-12, 18],
    }, (0, 0.035, base_h))
    L.box("POS_Stem", (w * 0.14, d * 0.18, stem_h),
          (0, 0.035, base_h + stem_h / 2), trim, bevel=0.008, parent=stem)

    screen_w = w * (0.88 if tier_index < 2 else 0.94)
    screen_h = h - base_h - stem_h * 0.45
    screen_z = base_h + stem_h + screen_h * 0.42
    screen_panel("POS", stem, screen_w, screen_h, screen_z, d * 0.19, M, tier_index)
    anchor("ANCHOR_Screen", stem, (0, -d * 0.105, screen_z), role="dynamic_pos_canvas")
    anchor("ANCHOR_Player", root, (0, -d * 0.62, h * 0.45), role="cashier_view")

    if tier_index == 0:
        for index in range(5):
            L.box(f"POS_FunctionKey_{index}", (screen_w / 6.4, 0.010, 0.022),
                  ((index - 2) * screen_w / 5.6, -d * 0.105, screen_z - screen_h / 2 + 0.035),
                  M["key"], bevel=0.003, parent=stem)
    if tier_index >= 2:
        L.cyl("POS_HingeKnuckle", w * 0.055, w * 0.30,
              (0, 0.035, base_h + stem_h), M["aluminum"], rot=(0, math.pi / 2, 0),
              verts=18, bevel=0.002, uv=True, parent=stem)
    if tier_index >= 3:
        L.box("POS_CableDock", (w * 0.34, d * 0.18, 0.028),
              (0, d * 0.28, base_h + 0.014), M["premium"], bevel=0.006, parent=root)
    if tier_index == 4:
        L.box("POS_WalnutPlinth", (base_w * 0.94, base_d * 0.94, base_h * 0.48),
              (0, 0.025, base_h * 0.76), M["walnut"], bevel=0.006, parent=root)
        L.box("POS_CrestPlate", (screen_w * 0.22, 0.004, 0.032),
              (0, -d * 0.105 - 0.003, screen_z - screen_h / 2 + 0.027), M["brass"],
              bevel=0.004, parent=stem)

    animate_rotation(stem, "POS_DisplayTilt", (0.0, 0.0, 0.0), (math.radians(-9), 0.0, 0.0), 20)
    L.collision_box("COL_POS_Base", (base_w + 0.02, base_d + 0.02, base_h + 0.01),
                    (0, 0.025, base_h / 2), M, parent=root)
    L.collision_box("COL_POS_Display", (screen_w + 0.02, d * 0.23, screen_h + 0.02),
                    (0, 0.0, screen_z), M, parent=root)
    return root


def keypad(parent, width, start_z, front_y, M, tier_index):
    rows = 4
    cols = 3
    key_w = width / 4.1
    key_h = key_w * 0.55
    labels = (
        ("1", "2", "3"),
        ("4", "5", "6"),
        ("7", "8", "9"),
        ("Cancel", "0", "Confirm"),
    )
    for row in range(rows):
        for col in range(cols):
            index = row * cols + col
            label = labels[row][col]
            mat = M["key"]
            if row == rows - 1 and col == 0:
                mat = M["led_amber"]
            if row == rows - 1 and col == 2:
                mat = M["led_green"]
            node_name = f"Terminal_Key_{label}" if label.isdigit() else f"Terminal_{label}Button"
            L.box(node_name, (key_w, 0.006, key_h),
                  ((col - 1) * key_w * 1.18, front_y, start_z - row * key_h * 1.22),
                  mat, bevel=0.0025, parent=parent,
                  props={"key_index": index, "key_label": label.upper()})


def build_card_reader(tier_index, M):
    dims = DIMENSIONS["card_reader"][tier_index]
    w, d, h = dims
    root = root_for("card_reader", tier_index, dims)
    body_mat = tier_body_material(M, tier_index)
    trim = tier_trim_material(M, tier_index)

    stand_h = 0.020 + tier_index * 0.004
    L.box("Reader_Stand", (w * 0.86, d * 0.68, stand_h),
          (0, d * 0.08, stand_h / 2), body_mat, bevel=0.008, parent=root)
    reader = group("Reader_TiltPivot", root, {
        "moving_part": "reader_tilt", "pivot_axis": "+X", "range_degrees": [-8, 14],
    }, (0, d * 0.12, stand_h))
    shell_h = h - stand_h
    L.box("Reader_Shell", (w, d * 0.48, shell_h),
          (0, -d * 0.02, stand_h + shell_h / 2), body_mat,
          rot=(math.radians(-11), 0, 0), bevel=0.012, parent=reader)

    face_y = -d * 0.27
    screen_h = shell_h * (0.28 + tier_index * 0.025)
    screen_z = h - screen_h * 0.62
    L.box("Reader_ScreenFrame", (w * 0.82, 0.007, screen_h),
          (0, face_y, screen_z), trim, bevel=0.004, parent=reader)
    L.box("Terminal_Screen", (w * 0.72, 0.005, screen_h * 0.78),
          (0, face_y - 0.005, screen_z), M["screen_live"], bevel=0.003, parent=reader,
          props={"dynamic_screen": True, "screen_px": [480, 440]})
    keypad(reader, w * 0.82, screen_z - screen_h * 0.70, face_y - 0.003, M, tier_index)
    L.box("Terminal_BackButton", (w * 0.16, 0.006, w * 0.09),
          (w * 0.30, face_y - 0.003, screen_z - screen_h * 0.48),
          M["key"], bevel=0.002, parent=reader,
          props={"key_label": "BACK"})

    # Every tier keeps a physical swipe channel. Later levels add chip and NFC,
    # but never remove the interaction needed by the checkout acceptance route.
    slot_x = w / 2 - 0.006
    L.box("Reader_SwipeRailOuter", (0.009, d * 0.44, h * 0.66),
          (slot_x, -d * 0.02, h * 0.44), M["rubber"], bevel=0.002, parent=reader)
    L.box("Reader_SwipeRailInner", (0.004, d * 0.41, h * 0.60),
          (slot_x + 0.004, -d * 0.02, h * 0.44), trim, bevel=0.001, parent=reader)
    anchor("CARD_SWIPE_START", reader, (slot_x + 0.006, d * 0.17, h * 0.72),
           role="card_swipe", direction="toward -Y")
    anchor("CARD_SWIPE_END", reader, (slot_x + 0.006, -d * 0.22, h * 0.18),
           role="card_swipe", direction="toward -Y")

    # The municipal model remains visibly swipe-first, but every tier keeps a
    # standards-sized chip slot so changing quality never breaks checkout.
    L.box("Terminal_ChipSlot", (w * (0.58 if tier_index == 0 else 0.66), 0.018, 0.010),
          (0, face_y + 0.008, stand_h + 0.018), M["rubber"], bevel=0.002, parent=reader)
    anchor("CARD_INSERT_SOCKET", reader, (0, face_y - 0.008, stand_h + 0.016),
           role="card_insert", axis="+Z")
    if tier_index >= 2:
        anchor("NFC_TAP_SOCKET", reader, (0, face_y - 0.010, screen_z),
               role="contactless")
        for ring in range(3):
            L.torus(f"Reader_NFC_{ring}", 0.010 + ring * 0.005, 0.0012,
                    (0, face_y - 0.009, screen_z - screen_h * 0.58), M["aluminum"],
                    rot=(math.pi / 2, 0, 0), parent=reader, mj=16, mn=6)
    if tier_index >= 3:
        L.cyl("Reader_WirelessLED", 0.003, 0.004,
              (-w * 0.34, face_y - 0.007, h * 0.84), M["led_green"],
              rot=(math.pi / 2, 0, 0), verts=10, bevel=0, uv=True, parent=reader)
    if tier_index == 4:
        L.box("Reader_WalnutCradle", (w * 1.02, d * 0.32, 0.024),
              (0, d * 0.22, stand_h + 0.012), M["walnut"], bevel=0.007, parent=root)
        L.box("Reader_BrassBadge", (w * 0.34, 0.004, 0.020),
              (0, face_y - 0.007, h * 0.89), M["brass"], bevel=0.003, parent=reader)

    animate_rotation(reader, "CardReader_Tilt", (0.0, 0.0, 0.0), (math.radians(-7), 0.0, 0.0), 16)
    L.collision_box("COL_CardReader", (w + 0.012, d + 0.016, h + 0.012),
                    (0, 0, h / 2), M, parent=root)
    return root


def build_receipt_printer(tier_index, M):
    dims = DIMENSIONS["receipt_printer"][tier_index]
    w, d, h = dims
    root = root_for("receipt_printer", tier_index, dims)
    body_mat = tier_body_material(M, tier_index)
    trim = tier_trim_material(M, tier_index)

    body_h = h * 0.72
    L.box("Printer_Body", (w, d, body_h), (0, 0, body_h / 2), body_mat,
          bevel=min(0.014, h * 0.10), parent=root)
    lid_pivot = group("Printer_LidPivot", root, {
        "moving_part": "paper_roll_lid", "pivot_axis": "+X", "hinge": "rear edge",
    }, (0, d / 2 - 0.016, body_h))
    lid_depth = d * 0.64
    L.box("Printer_RollLid", (w * 0.94, lid_depth, h * 0.34),
          (0, d * 0.10, body_h + h * 0.10), body_mat, bevel=0.012, parent=lid_pivot)
    L.box("Printer_LidTrim", (w * 0.82, lid_depth + 0.004, 0.008),
          (0, d * 0.10, body_h + h * 0.24), trim, bevel=0.002, parent=lid_pivot)

    slot_z = body_h + h * 0.10
    L.box("Printer_OutputSlot", (w * 0.62, 0.012, 0.014),
          (0, -d / 2 - 0.002, slot_z), M["rubber"], bevel=0.002, parent=root)
    if tier_index >= 2:
        L.box("Printer_AutoCutter", (w * 0.66, 0.008, 0.008),
              (0, -d / 2 - 0.010, slot_z - 0.006), M["aluminum"], bevel=0.001, parent=root)

    paper_pivot = group("ReceiptPaperFeed", root, {
        "moving_part": "receipt_paper", "slide_axis": "+Z", "travel_m": h * 0.56,
    }, (0, -d / 2 - 0.010, slot_z))
    paper_w = w * 0.54
    paper_h = h * 0.56
    L.box("ReceiptPaper", (paper_w, 0.002, paper_h),
          (0, -d / 2 - 0.012, slot_z + paper_h / 2), M["paper"],
          bevel=0.0005, parent=paper_pivot, props={"receipt_surface": True})
    anchor("RECEIPT_OUTPUT_SOCKET", paper_pivot, (0, -d / 2 - 0.016, slot_z), role="receipt_feed")
    anchor("RECEIPT_PICKUP_SOCKET", paper_pivot, (0, -d / 2 - 0.016, slot_z + paper_h), role="receipt_pickup")

    controls = 1 + min(2, tier_index)
    for index in range(controls):
        L.cyl(f"Printer_Status_{index}", 0.003, 0.004,
              (w * 0.31 - index * 0.014, -d / 2 - 0.006, body_h * 0.48),
              M["led_green"] if index == 0 else M["led_amber"],
              rot=(math.pi / 2, 0, 0), verts=10, bevel=0, uv=True, parent=root)
    if tier_index >= 1:
        L.box("Printer_FeedButton", (0.025, 0.005, 0.014),
              (-w * 0.28, -d / 2 - 0.006, body_h * 0.48), M["key"], bevel=0.003, parent=root)
    if tier_index >= 3:
        L.box("Printer_NetworkPanel", (w * 0.28, 0.006, h * 0.18),
              (w * 0.27, -d / 2 - 0.005, body_h * 0.28), M["screen"], bevel=0.003, parent=root)
    if tier_index == 4:
        for side in (-1, 1):
            L.box(f"Printer_WalnutSide_{side}", (0.014, d * 0.84, body_h * 0.82),
                  (side * (w / 2 - 0.008), 0, body_h * 0.45), M["walnut"], bevel=0.004, parent=root)
        L.box("Printer_BrassTearBar", (w * 0.68, 0.006, 0.008),
              (0, -d / 2 - 0.012, slot_z - 0.006), M["brass"], bevel=0.001, parent=root)

    animate_location(paper_pivot, "Receipt_Print", (0, -d / 2 - 0.010, slot_z - paper_h * 0.82),
                     (0, -d / 2 - 0.010, slot_z), int(FPS * 1.1))
    animate_rotation(lid_pivot, "Printer_LidOpen", (0.0, 0.0, 0.0), (math.radians(62), 0.0, 0.0), 20)
    L.collision_box("COL_ReceiptPrinter", (w + 0.012, d + 0.012, h + 0.012),
                    (0, 0, h / 2), M, parent=root)
    return root


def build_cash_drawer(tier_index, M):
    dims = DIMENSIONS["cash_drawer"][tier_index]
    w, d, h = dims
    root = root_for("cash_drawer", tier_index, dims)
    body_mat = tier_body_material(M, tier_index)
    trim = tier_trim_material(M, tier_index)

    shell_h = h
    L.box("CashDrawer_Housing", (w, d, shell_h), (0, 0, shell_h / 2), body_mat,
          bevel=0.008, parent=root)
    L.box("CashDrawer_HousingTop", (w * 0.96, d * 0.96, 0.012),
          (0, 0.006, shell_h - 0.006), M["premium"], bevel=0.003, parent=root)

    slide = group("DrawerSlide", root, {
        "moving_part": "cash_drawer", "slide_axis": "-Y", "open_travel_m": d * 0.76,
    }, (0, 0, 0))
    tray_w = w * 0.93
    tray_d = d * 0.88
    tray_h = h * 0.72
    floor_h = max(0.008, h * 0.08)
    wall_h = tray_h * 0.72
    wall = 0.008
    # The till is a shallow open insert, not a solid slab: cash and separators
    # must remain readable from the cashier camera at every quality tier.
    L.box("CashDrawer_Tray", (tray_w, tray_d, floor_h),
          (0, -0.012, floor_h / 2 + 0.008), M["white"], bevel=0.004, parent=slide,
          props={"drawer_interior": True})
    for side in (-1, 1):
        L.box(f"CashDrawer_TraySide_{side}", (wall, tray_d, wall_h),
              (side * (tray_w / 2 - wall / 2), -0.012, 0.008 + floor_h + wall_h / 2),
              M["white"], bevel=0.002, parent=slide)
    L.box("CashDrawer_TrayRear", (tray_w, wall, wall_h),
          (0, tray_d / 2 - wall / 2 - 0.012, 0.008 + floor_h + wall_h / 2),
          M["white"], bevel=0.002, parent=slide)
    front_mat = M["walnut"] if tier_index == 4 else body_mat
    L.box("CashDrawer_Front", (w * 0.96, 0.028, h * 0.82),
          (0, -d / 2 - 0.002, h * 0.45), front_mat, bevel=0.006, parent=slide)
    latch_mat = M["brass"] if tier_index == 4 else trim
    L.box("CashDrawer_Latch", (w * 0.10, 0.008, h * 0.18),
          (0, -d / 2 - 0.020, h * 0.50), latch_mat, bevel=0.002, parent=slide)

    # Every production till supports the simulation's full denomination set.
    # Tier progression changes its construction and automation, never whether
    # the player can make exact change.
    bill_denominations = (1, 5, 10, 20, 50)
    coin_denominations = (1, 5, 10, 20, 50)
    bills = len(bill_denominations)
    coins = len(coin_denominations)
    bill_depth = tray_d * 0.56
    coin_depth = tray_d - bill_depth - wall * 3
    pitch = tray_w / bills
    for index in range(1, bills):
        x = -tray_w / 2 + index * pitch
        L.box(f"BillDivider_{index}", (wall, bill_depth, tray_h * 0.72),
              (x, -tray_d / 2 + bill_depth / 2 + wall, tray_h * 0.42),
              M["aluminum"], bevel=0.001, parent=slide)
    for index, denomination in enumerate(bill_denominations):
        x = -tray_w / 2 + (index + 0.5) * pitch
        socket = anchor(f"BILL_{denomination}_SOCKET", slide,
               (x, -tray_d / 2 + bill_depth * 0.52, tray_h * 0.30),
               role="bill_well", well_index=index + 1,
               well_w=pitch - wall * 2, well_d=bill_depth - wall * 2,
               wall_h=tray_h * 0.72, max_pieces=12, spacing_m=0.0016)
        if tier_index >= 2:
            clip = group(f"BillClipPivot_{denomination}", slide, {
                "moving_part": "bill_clip", "pivot_axis": "+X",
            }, (x, -tray_d / 2 + bill_depth * 0.72, tray_h * 0.72))
            socket["clip"] = clip.name
            L.box(f"BillClip_{denomination}", (pitch * 0.46, bill_depth * 0.42, 0.008),
                  (x, -tray_d / 2 + bill_depth * 0.54, tray_h * 0.72), trim,
                  bevel=0.002, parent=clip)

    coin_pitch = tray_w / coins
    coin_y = tray_d / 2 - coin_depth / 2 - wall
    for index in range(1, coins):
        x = -tray_w / 2 + index * coin_pitch
        L.box(f"CoinDivider_{index}", (wall, coin_depth, tray_h * 0.62),
              (x, coin_y, tray_h * 0.36), M["aluminum"], bevel=0.001, parent=slide)
    for index, denomination in enumerate(coin_denominations):
        x = -tray_w / 2 + (index + 0.5) * coin_pitch
        anchor(f"COIN_{denomination:02d}_SOCKET", slide,
               (x, coin_y, tray_h * 0.24), role="coin_well", well_index=index + 1,
               well_w=coin_pitch - wall * 2, well_d=coin_depth - wall * 2,
               wall_h=tray_h * 0.62, max_pieces=30, pile_h_m=0.0032)

    if tier_index >= 3:
        L.box("CashDrawer_CountDisplay", (w * 0.28, 0.007, h * 0.22),
              (w * 0.25, -d / 2 - 0.021, h * 0.50), M["screen_live"],
              bevel=0.003, parent=slide, props={"dynamic_screen": True})
    if tier_index == 4:
        L.box("CashDrawer_BrassRail", (w * 0.72, 0.006, 0.008),
              (0, -d / 2 - 0.022, h * 0.18), M["brass"], bevel=0.002, parent=slide)

    anchor("ANCHOR_DrawerGrip", slide, (0, -d / 2 - 0.032, h * 0.50), role="drawer_grip")
    animate_location(slide, "CashDrawer_Open", (0.0, 0.0, 0.0), (0.0, -d * 0.76, 0.0), 18)
    L.collision_box("COL_CashDrawerHousing", (w + 0.012, d + 0.012, h + 0.012),
                    (0, 0, h / 2), M, parent=root)
    return root


def vehicle_wheel(name, parent, x, y, z, radius, width, M, tier_index, steer=False):
    pivot = group(f"{name}_Pivot", parent, {
        "moving_part": "steering_wheel" if steer else "rolling_wheel",
        "pivot_axis": "+Y",
    }, (x, y, z))
    L.cyl(f"{name}_Tire", radius, width, (x, y, z), M["rubber"],
          rot=(math.pi / 2, 0, 0), verts=20, bevel=0.006, uv=True, parent=pivot)
    L.cyl(f"{name}_Hub", radius * 0.46, width + 0.010, (x, y, z),
          M["brass"] if tier_index == 4 else M["aluminum"],
          rot=(math.pi / 2, 0, 0), verts=16, bevel=0.003, uv=True, parent=pivot)
    if steer:
        animate_rotation(pivot, f"{name}_Steer", (0, 0, 0), (0, 0, math.radians(18)), 18)
    return pivot


def vehicle_canopy(root, w, d, h, M, tier_index, cabin_x=-0.18):
    trim = tier_trim_material(M, tier_index)
    post_z = h * 0.61
    top_z = h * 0.965
    for x_index, x in enumerate((cabin_x - w * 0.20, cabin_x + w * 0.20)):
        for y_index, y in enumerate((-d * 0.36, d * 0.36)):
            L.box(f"Canopy_Post_{x_index + 1}_{y_index + 1}", (0.035, 0.035, h * 0.57), (x, y, post_z),
                  trim, bevel=0.006, parent=root)
    L.rounded_box("Canopy_Roof", (w * 0.53, d * 0.90, h * 0.075),
                  (cabin_x, 0, top_z), tier_body_material(M, tier_index),
                  corner=0.10, bevel=0.006, parent=root)


def build_golf_cart(tier_index, M):
    w, d, h = DIMENSIONS["golf_cart"][tier_index]
    root = root_for("golf_cart", tier_index, (w, d, h))
    body = tier_body_material(M, tier_index)
    trim = tier_trim_material(M, tier_index)
    wheel_r = h * 0.145
    axle_x = w * 0.34
    for x in (-axle_x, axle_x):
        for y in (-d * 0.42, d * 0.42):
            vehicle_wheel(f"CartWheel_{'Front' if x > 0 else 'Rear'}_{'L' if y < 0 else 'R'}",
                          root, x, y, wheel_r, wheel_r, d * 0.10, M, tier_index,
                          steer=(x > 0 and y < 0))
    chassis_z = wheel_r * 1.22
    L.rounded_box("GolfCart_Chassis", (w * 0.78, d * 0.72, h * 0.15),
                  (0, 0, chassis_z), body, corner=0.12, bevel=0.008, parent=root)
    L.rounded_box("GolfCart_Hood", (w * 0.28, d * 0.68, h * 0.22),
                  (w * 0.25, 0, chassis_z + h * 0.13), body,
                  corner=0.10, bevel=0.008, parent=root)
    seat_count = 1 if tier_index < 2 else 2 if tier_index < 4 else 3
    seat_xs = [-w * 0.08] if seat_count == 1 else (
        [-w * 0.15, -w * 0.36] if seat_count == 2 else [-w * 0.06, -w * 0.25, -w * 0.42]
    )
    seat_mat = M["fabric"] if tier_index < 3 else M["leather"]
    for index, x in enumerate(seat_xs):
        L.rounded_box(f"GolfCart_Seat_{index + 1}", (w * 0.19, d * 0.68, h * 0.10),
                      (x, 0, chassis_z + h * 0.20), seat_mat,
                      corner=0.045, bevel=0.006, parent=root)
        L.rounded_box(f"GolfCart_SeatBack_{index + 1}", (w * 0.055, d * 0.68, h * 0.28),
                      (x - w * 0.085, 0, chassis_z + h * 0.34), seat_mat,
                      corner=0.035, bevel=0.005, parent=root)
    # The entry cart has an exposed rain/roll bar; upper tiers complete it with
    # the reference's increasingly finished canopy and enclosed cabin.
    if tier_index == 0:
        for side, y in zip(("L", "R"), (-d * 0.34, d * 0.34)):
            L.box(f"Municipal_RollBar_{side}", (0.035, 0.035, h * 0.63),
                  (-w * 0.24, y, h * 0.64), trim, bevel=0.004, parent=root)
        L.box("Municipal_RollBarTop", (0.035, d * 0.72, 0.035),
              (-w * 0.24, 0, h * 0.94), trim, bevel=0.004, parent=root)
    else:
        vehicle_canopy(root, w, d, h, M, tier_index, cabin_x=-w * 0.08)
    if tier_index >= 2:
        L.box("GolfCart_Windshield", (w * 0.035, d * 0.72, h * 0.38),
              (w * 0.18, 0, h * 0.66), M["glass"], bevel=0.006, parent=root,
              props={"glass": True})
    if tier_index >= 3:
        door = group("GolfCart_StorageDoorPivot", root, {
            "moving_part": "storage_door", "pivot_axis": "+Z",
        }, (-w * 0.20, -d * 0.39, chassis_z + h * 0.11))
        L.box("GolfCart_StorageDoor", (w * 0.25, 0.035, h * 0.18),
              (-w * 0.20, -d * 0.39, chassis_z + h * 0.11), body,
              bevel=0.006, parent=door)
        animate_rotation(door, "GolfCart_StorageDoorOpen", (0, 0, 0), (0, 0, math.radians(54)), 18)
    if tier_index == 4:
        L.box("GolfCart_BrassBeltline", (w * 0.58, 0.018, 0.025),
              (-w * 0.08, -d * 0.39, h * 0.55), M["brass"], bevel=0.004, parent=root)
        anchor("ANCHOR_ConciergeStep", root, (-w * 0.28, -d * 0.52, h * 0.26), role="passenger_step")
    anchor("ANCHOR_DriverSeat", root, (w * 0.02, -d * 0.18, h * 0.52), role="driver")
    anchor("ANCHOR_BagWell", root, (-w * 0.39, 0, h * 0.43), role="golf_bags")
    L.collision_box("COL_GolfCartBody", (w * 0.80, d * 0.76, h * 0.55),
                    (0, 0, h * 0.39), M, parent=root)
    L.collision_box("COL_GolfCartCabin", (w * 0.53, d * 0.80, h * 0.72),
                    (-w * 0.08, 0, h * 0.64), M, parent=root)
    return root


def build_push_cart(tier_index, M):
    w, d, h = DIMENSIONS["push_cart"][tier_index]
    root = root_for("push_cart", tier_index, (w, d, h))
    trim = tier_trim_material(M, tier_index)
    wheel_r = d * 0.23
    rear_x = -w * 0.28
    for y in (-d * 0.40, d * 0.40):
        vehicle_wheel(f"PushCart_Rear_{'L' if y < 0 else 'R'}", root,
                      rear_x, y, wheel_r, wheel_r, d * 0.09, M, tier_index)
    if tier_index >= 1:
        vehicle_wheel("PushCart_Front", root, w * 0.34, 0, wheel_r * 0.78,
                      wheel_r * 0.78, d * 0.09, M, tier_index, steer=True)
    if tier_index >= 2:
        for y in (-d * 0.27, d * 0.27):
            vehicle_wheel(f"PushCart_Front_{'L' if y < 0 else 'R'}", root,
                          w * 0.32, y, wheel_r * 0.66, wheel_r * 0.66,
                          d * 0.07, M, tier_index)
    L.box("PushCart_LowerFrame", (w * 0.66, 0.035, 0.035),
          (0, 0, h * 0.25), trim, rot=(0, math.radians(-12), 0), bevel=0.005, parent=root)
    L.box("PushCart_HandleStem", (0.040, 0.040, h * 0.74),
          (-w * 0.28, 0, h * 0.59), trim, rot=(0, math.radians(-10), 0), bevel=0.005, parent=root)
    L.box("PushCart_Handle", (w * 0.28, d * 0.18, 0.045),
          (-w * 0.39, 0, h * 0.96), M["rubber"], bevel=0.012, parent=root)
    L.box("PushCart_BagRestLower", (w * 0.18, d * 0.62, 0.045),
          (w * 0.20, 0, h * 0.20), trim, bevel=0.006, parent=root)
    L.box("PushCart_BagRestUpper", (0.045, d * 0.56, h * 0.12),
          (-w * 0.02, 0, h * 0.67), trim, bevel=0.006, parent=root)
    if tier_index >= 2:
        L.rounded_box("PushCart_ScorecardTray", (w * 0.26, d * 0.40, 0.055),
                      (-w * 0.17, 0, h * 0.79), tier_body_material(M, tier_index),
                      corner=0.035, bevel=0.004, parent=root)
    if tier_index >= 3:
        L.rounded_box("PushCart_StorageConsole", (w * 0.23, d * 0.43, h * 0.16),
                      (-w * 0.10, 0, h * 0.58), tier_body_material(M, tier_index),
                      corner=0.04, bevel=0.005, parent=root)
        anchor("ANCHOR_Brake", root, (-w * 0.38, -d * 0.18, h * 0.94), role="parking_brake")
    if tier_index == 4:
        L.box("PushCart_BrassBadge", (0.055, d * 0.42, 0.018),
              (-w * 0.12, 0, h * 0.71), M["brass"], bevel=0.004, parent=root)
    anchor("ANCHOR_GolfBag", root, (w * 0.02, 0, h * 0.48), role="golf_bag")
    L.collision_box("COL_PushCart", (w * 0.86, d * 0.88, h),
                    (-w * 0.03, 0, h / 2), M, parent=root)
    return root


def build_service_cart(family, tier_index, M):
    w, d, h = DIMENSIONS[family][tier_index]
    root = root_for(family, tier_index, (w, d, h))
    body = tier_body_material(M, tier_index)
    trim = tier_trim_material(M, tier_index)
    wheel_r = h * 0.14
    for x in (-w * 0.35, w * 0.35):
        for y in (-d * 0.42, d * 0.42):
            vehicle_wheel(f"ServiceWheel_{'Front' if x < 0 else 'Rear'}_{'L' if y < 0 else 'R'}",
                          root, x, y, wheel_r, wheel_r, d * 0.10, M, tier_index,
                          steer=(x < 0 and y < 0))
    deck_z = wheel_r * 1.22
    L.rounded_box("ServiceCart_Chassis", (w * 0.82, d * 0.74, h * 0.14),
                  (0, 0, deck_z), body, corner=0.10, bevel=0.008, parent=root)
    cabin_x = -w * 0.23
    L.rounded_box("ServiceCart_Hood", (w * 0.23, d * 0.68, h * 0.19),
                  (-w * 0.37, 0, deck_z + h * 0.13), body,
                  corner=0.07, bevel=0.008, parent=root)
    L.rounded_box("ServiceCart_Seat", (w * 0.20, d * 0.67, h * 0.10),
                  (cabin_x, 0, deck_z + h * 0.20), M["fabric"] if tier_index < 3 else M["leather"],
                  corner=0.04, bevel=0.006, parent=root)
    bed_x = w * 0.23
    L.box("ServiceCart_BedFloor", (w * 0.38, d * 0.72, h * 0.07),
          (bed_x, 0, deck_z + h * 0.12), trim, bevel=0.006, parent=root)
    side_h = h * (0.16 if family == "utility_cart" else 0.22)
    for y in (-d * 0.37, d * 0.37):
        side = group(f"ServiceCart_BedSidePivot_{'L' if y < 0 else 'R'}", root, {
            "moving_part": "drop_side", "pivot_axis": "+X",
        }, (bed_x, y, deck_z + h * 0.14))
        L.box(f"ServiceCart_BedSide_{'L' if y < 0 else 'R'}", (w * 0.39, 0.035, side_h),
              (bed_x, y, deck_z + h * 0.14 + side_h / 2), body,
              bevel=0.005, parent=side)
        if y < 0:
            animate_rotation(side, "ServiceCart_DropSide", (0, 0, 0), (math.radians(68), 0, 0), 20)
    # Even the open municipal work cart carries a full-height safety rack.
    rack_x = w * 0.38
    for side, y in zip(("L", "R"), (-d * 0.34, d * 0.34)):
        L.box(f"ServiceCart_SafetyRackPost_{side}", (0.035, 0.035, h * 0.62),
              (rack_x, y, h * 0.65), trim, bevel=0.005, parent=root)
    L.box("ServiceCart_SafetyRackTop", (0.035, d * 0.72, 0.035),
          (rack_x, 0, h * 0.95), trim, bevel=0.005, parent=root)
    if tier_index >= 1:
        vehicle_canopy(root, w, d, h, M, tier_index, cabin_x=cabin_x)
    if tier_index >= 2:
        L.box("ServiceCart_Windshield", (w * 0.028, d * 0.70, h * 0.36),
              (-w * 0.08, 0, h * 0.66), M["glass"], bevel=0.005, parent=root)
        L.rounded_box("ServiceCart_Toolbox", (w * 0.23, d * 0.58, h * 0.22),
                      (bed_x, 0, deck_z + h * 0.25), M["premium"],
                      corner=0.035, bevel=0.005, parent=root)
    if tier_index >= 3:
        for y in (-d * 0.37, d * 0.37):
            door = group(f"ServiceCart_DoorPivot_{'L' if y < 0 else 'R'}", root, {
                "moving_part": "cab_door", "pivot_axis": "+Z",
            }, (cabin_x, y, h * 0.54))
            L.box(f"ServiceCart_CabDoor_{'L' if y < 0 else 'R'}", (w * 0.22, 0.030, h * 0.42),
                  (cabin_x, y, h * 0.54), body, bevel=0.008, parent=door)
    if family == "maintenance_cart":
        L.cyl("Maintenance_HoseReel", d * 0.16, 0.10, (bed_x, -d * 0.31, h * 0.60),
              M["red"], rot=(math.pi / 2, 0, 0), verts=20, bevel=0.004, uv=True, parent=root)
        for index in range(2 + tier_index):
            L.cyl(f"Maintenance_Tool_{index + 1}", 0.012, h * 0.46,
                  (rack_x, -d * 0.27 + index * d * 0.11, h * 0.69), trim,
                  verts=12, bevel=0.002, uv=True, parent=root)
        if tier_index >= 2:
            L.cyl("Maintenance_Beacon", 0.055, 0.10, (cabin_x, 0, h * 0.94),
                  M["amber"], verts=16, bevel=0.006, uv=True, parent=root)
        if tier_index == 4:
            L.cyl("Maintenance_WashTank", d * 0.20, w * 0.23,
                  (bed_x, 0, h * 0.56), M["white"], rot=(0, math.pi / 2, 0),
                  verts=20, bevel=0.006, uv=True, parent=root)
            anchor("ANCHOR_WashHose", root, (bed_x, -d * 0.42, h * 0.58), role="wash_down")
    elif tier_index == 4:
        L.box("UtilityCart_FinishedCargoBox", (w * 0.37, d * 0.68, h * 0.28),
              (bed_x, 0, deck_z + h * 0.26), M["walnut"], bevel=0.010, parent=root)
        L.box("UtilityCart_BrassRail", (w * 0.30, 0.018, 0.025),
              (bed_x, -d * 0.37, deck_z + h * 0.32), M["brass"], bevel=0.004, parent=root)
    anchor("ANCHOR_Cargo", root, (bed_x, 0, deck_z + h * 0.20), role="cargo")
    L.collision_box(f"COL_{family}_Body", (w * 0.84, d * 0.78, h * 0.55),
                    (0, 0, h * 0.39), M, parent=root)
    L.collision_box(f"COL_{family}_Cab", (w * 0.38, d * 0.76, h * 0.72),
                    (cabin_x, 0, h * 0.64), M, parent=root)
    return root


def build_utility_cart(tier_index, M):
    return build_service_cart("utility_cart", tier_index, M)


def build_maintenance_cart(tier_index, M):
    return build_service_cart("maintenance_cart", tier_index, M)


def build_ball_washer(tier_index, M):
    w, d, h = DIMENSIONS["ball_washer"][tier_index]
    root = root_for("ball_washer", tier_index, (w, d, h))
    body = tier_body_material(M, tier_index)
    trim = tier_trim_material(M, tier_index)
    base_h = h * 0.07
    L.rounded_box("BallWasher_Base", (w * 0.84, d * 0.82, base_h),
                  (0, 0, base_h / 2), M["stone"] if tier_index == 4 else body,
                  corner=0.045, bevel=0.005, parent=root)
    L.cyl("BallWasher_Post", w * 0.075, h * 0.58, (0, 0, h * 0.34), trim,
          verts=16, bevel=0.004, uv=True, parent=root)
    drum_z = h * 0.72
    L.cyl("BallWasher_Drum", w * 0.35, d * 0.72, (0, 0, drum_z), body,
          rot=(math.pi / 2, 0, 0), verts=24, bevel=0.008, uv=True, parent=root)
    crank = group("BallWasher_CrankPivot", root, {
        "moving_part": "wash_crank", "pivot_axis": "+Y",
    }, (w * 0.34, -d * 0.38, drum_z))
    L.cyl("BallWasher_CrankShaft", 0.015, w * 0.22,
          (w * 0.42, -d * 0.38, drum_z), trim,
          rot=(0, math.pi / 2, 0), verts=12, bevel=0.002, uv=True, parent=crank)
    L.cyl("BallWasher_CrankGrip", 0.022, d * 0.18,
          (w * 0.50, -d * 0.46, drum_z), M["rubber"],
          rot=(math.pi / 2, 0, 0), verts=12, bevel=0.003, uv=True, parent=crank)
    animate_rotation(crank, "BallWasher_CrankTurn", (0, 0, 0), (0, math.tau, 0), 30)
    ports = 1 if tier_index < 2 else 2 if tier_index < 4 else 4
    for index in range(ports):
        x = (index - (ports - 1) / 2) * w * 0.19
        L.cyl(f"BallWasher_Port_{index + 1}", w * 0.055, 0.022,
              (x, -d * 0.38, drum_z + h * 0.11), M["rubber"],
              rot=(math.pi / 2, 0, 0), verts=16, bevel=0.002, uv=True, parent=root)
    if tier_index >= 1:
        L.torus("BallWasher_TowelRing", w * 0.15, 0.010,
                (-w * 0.30, 0, h * 0.48), trim, rot=(0, math.pi / 2, 0), parent=root)
    if tier_index >= 2:
        for side in (-1, 1):
            L.cyl(f"BallWasher_ClubBrush_{side}", w * 0.075, h * 0.17,
                  (side * w * 0.24, 0, h * 0.47), M["rubber"],
                  verts=16, bevel=0.003, uv=True, parent=root)
    if tier_index >= 3:
        L.rounded_box("BallWasher_WasteBin", (w * 0.55, d * 0.62, h * 0.20),
                      (0, 0, h * 0.18), M["premium"], corner=0.04, bevel=0.005, parent=root)
        L.box("BallWasher_Sign", (w * 0.70, 0.025, h * 0.13),
              (0, d * 0.18, h * 0.94), trim, bevel=0.006, parent=root)
    if tier_index == 4:
        L.box("BallWasher_WalnutBand", (w * 0.88, 0.025, h * 0.12),
              (0, -d * 0.38, drum_z), M["walnut"], bevel=0.005, parent=root)
        L.box("BallWasher_BrassCrest", (w * 0.36, 0.012, h * 0.06),
              (0, -d * 0.40, drum_z), M["brass"], bevel=0.005, parent=root)
    anchor("ANCHOR_BallInput", root, (0, -d * 0.43, drum_z + h * 0.10), role="ball_input")
    L.collision_box("COL_BallWasher", (w, d, h), (0, 0, h / 2), M, parent=root)
    return root


def build_club_cleaner(tier_index, M):
    w, d, h = DIMENSIONS["club_cleaner"][tier_index]
    root = root_for("club_cleaner", tier_index, (w, d, h))
    body = tier_body_material(M, tier_index)
    trim = tier_trim_material(M, tier_index)
    base_h = h * 0.10
    L.rounded_box("ClubCleaner_Base", (w, d, base_h), (0, 0, base_h / 2),
                  M["stone"] if tier_index == 4 else body,
                  corner=0.055, bevel=0.005, parent=root)
    cabinet_h = h * (0.48 if tier_index < 3 else 0.68)
    L.rounded_box("ClubCleaner_Cabinet", (w * 0.78, d * 0.78, cabinet_h),
                  (0, 0, base_h + cabinet_h / 2), body,
                  corner=0.06, bevel=0.007, parent=root)
    brush_count = 1 if tier_index < 2 else 2
    for index in range(brush_count):
        x = (index - (brush_count - 1) / 2) * w * 0.30
        pivot = group(f"ClubCleaner_BrushPivot_{index + 1}", root, {
            "moving_part": "cleaning_brush", "pivot_axis": "+Z",
        }, (x, -d * 0.34, base_h + cabinet_h * 0.72))
        L.cyl(f"ClubCleaner_Brush_{index + 1}", w * 0.105, h * 0.22,
              (x, -d * 0.35, base_h + cabinet_h * 0.72), M["rubber"],
              verts=20, bevel=0.004, uv=True, parent=pivot)
        if index == 0:
            animate_rotation(pivot, "ClubCleaner_BrushSpin", (0, 0, 0), (0, 0, math.tau), 24)
    L.box("ClubCleaner_DripTray", (w * 0.70, d * 0.22, h * 0.045),
          (0, -d * 0.43, base_h + h * 0.12), trim, bevel=0.006, parent=root)
    if tier_index >= 1:
        lid = group("ClubCleaner_LidPivot", root, {
            "moving_part": "service_lid", "pivot_axis": "+X",
        }, (0, d * 0.31, base_h + cabinet_h))
        L.rounded_box("ClubCleaner_Lid", (w * 0.82, d * 0.74, h * 0.08),
                      (0, 0, base_h + cabinet_h + h * 0.035), body,
                      corner=0.055, bevel=0.005, parent=lid)
        animate_rotation(lid, "ClubCleaner_LidOpen", (0, 0, 0), (math.radians(52), 0, 0), 18)
    if tier_index >= 3:
        L.box("ClubCleaner_ControlPanel", (w * 0.44, 0.018, h * 0.12),
              (0, -d * 0.405, h * 0.78), M["screen_live"], bevel=0.006, parent=root)
        L.cyl("ClubCleaner_PowerLED", 0.008, 0.012,
              (w * 0.25, -d * 0.42, h * 0.79), M["led_green"],
              rot=(math.pi / 2, 0, 0), verts=12, bevel=0.001, uv=True, parent=root)
    if tier_index == 4:
        for side in (-1, 1):
            L.box(f"ClubCleaner_WalnutSide_{side}", (0.022, d * 0.70, cabinet_h * 0.88),
                  (side * w * 0.38, 0, base_h + cabinet_h * 0.48), M["walnut"],
                  bevel=0.005, parent=root)
        L.box("ClubCleaner_BrassRail", (w * 0.62, 0.018, 0.020),
              (0, -d * 0.42, h * 0.69), M["brass"], bevel=0.004, parent=root)
    anchor("ANCHOR_ClubHead", root, (0, -d * 0.45, h * 0.49), role="club_cleaning")
    L.collision_box("COL_ClubCleaner", (w, d, h), (0, 0, h / 2), M, parent=root)
    return root


def build_bag_stand(tier_index, M):
    w, d, h = DIMENSIONS["bag_stand"][tier_index]
    root = root_for("bag_stand", tier_index, (w, d, h))
    trim = tier_trim_material(M, tier_index)
    wood = M["oak"] if tier_index == 2 else M["walnut"] if tier_index >= 3 else trim
    bays = min(4, tier_index + 1)
    L.box("BagStand_BaseRail", (w, d * 0.18, h * 0.07),
          (0, d * 0.22, h * 0.035), wood, bevel=0.009, parent=root)
    L.box("BagStand_FrontRail", (w, d * 0.15, h * 0.07),
          (0, -d * 0.34, h * 0.035), wood, bevel=0.009, parent=root)
    for side in (-1, 1):
        L.box(f"BagStand_Upright_{side}", (0.045, 0.045, h * 0.78),
              (side * w * 0.46, 0, h * 0.42), wood, bevel=0.007, parent=root)
    L.box("BagStand_TopRail", (w, d * 0.12, h * 0.07),
          (0, 0, h * 0.84), wood, bevel=0.009, parent=root)
    for index in range(bays):
        x = (index - (bays - 1) / 2) * (w * 0.78 / max(1, bays - 1)) if bays > 1 else 0
        L.torus(f"BagStand_Rest_{index + 1}", min(w / (bays + 2), 0.12), 0.014,
                (x, -d * 0.03, h * 0.67), M["rubber"] if tier_index < 4 else M["brass"],
                rot=(math.pi / 2, 0, 0), parent=root, mj=18, mn=8)
        anchor(f"ANCHOR_Bag_{index + 1}", root, (x, -d * 0.08, h * 0.42), role="golf_bag")
    if tier_index >= 3:
        L.wood_slab("BagStand_ValetShelf", (w * 0.82, d * 0.56, h * 0.055),
                    (0, 0, h * 0.28), M["walnut"], bevel=0.008, parent=root)
    if tier_index == 4:
        L.box("BagStand_BrassCrest", (w * 0.24, 0.018, h * 0.08),
              (0, -d * 0.08, h * 0.84), M["brass"], bevel=0.006, parent=root)
    L.collision_box("COL_BagStand", (w, d, h), (0, 0, h / 2), M, parent=root)
    return root


def basket_body(prefix, root, w, d, h, z, M, tier_index, target=False):
    body = tier_body_material(M, tier_index)
    trim = tier_trim_material(M, tier_index)
    if tier_index == 2 and not target:
        L.rounded_box(f"{prefix}_MoldedShell", (w * 0.90, d * 0.90, h * 0.72),
                      (0, 0, z + h * 0.36), body, corner=0.08, bevel=0.006, parent=root)
    else:
        L.torus(f"{prefix}_TopRing", w * 0.42, 0.013,
                (0, 0, z + h * 0.76), M["brass"] if tier_index == 4 else trim,
                parent=root, mj=24, mn=8)
        L.torus(f"{prefix}_BottomRing", w * 0.31, 0.012,
                (0, 0, z + h * 0.08), trim, parent=root, mj=24, mn=8)
        slats = 8 + tier_index * 2
        for index in range(slats):
            angle = math.tau * index / slats
            x = math.cos(angle) * w * 0.36
            y = math.sin(angle) * d * 0.36
            L.cyl(f"{prefix}_Wire_{index + 1}", 0.006, h * 0.68,
                  (x, y, z + h * 0.42), trim, verts=8, bevel=0.001, uv=True, parent=root)


def build_range_basket(tier_index, M):
    w, d, h = DIMENSIONS["range_basket"][tier_index]
    root = root_for("range_basket", tier_index, (w, d, h))
    basket_body("RangeBasket", root, w, d, h, 0, M, tier_index)
    handle = group("RangeBasket_HandlePivot", root, {
        "moving_part": "basket_handle", "pivot_axis": "+Y",
    }, (0, 0, h * 0.72))
    handle_radius = min(w * 0.40, h * 0.18)
    L.torus("RangeBasket_Handle", handle_radius, 0.012,
            (0, 0, h * 0.70), M["rubber"] if tier_index == 1 else tier_trim_material(M, tier_index),
            rot=(math.pi / 2, 0, 0), parent=handle, mj=24, mn=8)
    animate_rotation(handle, "RangeBasket_HandleFold", (0, 0, 0), (0, math.radians(72), 0), 16)
    if tier_index >= 3:
        L.box("RangeBasket_CountPlaque", (w * 0.30, 0.018, h * 0.18),
              (0, -d * 0.42, h * 0.42), M["brass"] if tier_index == 4 else M["white"],
              bevel=0.005, parent=root)
    anchor("ANCHOR_RangeBalls", root, (0, 0, h * 0.42), role="range_balls")
    L.collision_box("COL_RangeBasket", (w, d, h), (0, 0, h / 2), M, parent=root)
    return root


def build_scorecard_holder(tier_index, M):
    w, d, h = DIMENSIONS["scorecard_holder"][tier_index]
    root = root_for("scorecard_holder", tier_index, (w, d, h))
    body = tier_body_material(M, tier_index)
    finish = M["oak"] if tier_index == 2 else M["walnut"] if tier_index >= 3 else body
    L.box("ScorecardHolder_Back", (w, d * 0.18, h),
          (0, d * 0.39, h / 2), finish, bevel=0.007, parent=root)
    slots = 1 if tier_index == 0 else 4 if tier_index == 1 else 5 + tier_index
    slot_h = h * 0.52
    for index in range(slots):
        x = (index - (slots - 1) / 2) * (w * 0.78 / max(1, slots - 1)) if slots > 1 else 0
        L.box(f"ScorecardHolder_Divider_{index + 1}", (0.010, d * 0.72, slot_h),
              (x, 0, slot_h / 2), tier_trim_material(M, tier_index),
              bevel=0.002, parent=root)
        anchor(f"ANCHOR_Scorecard_{index + 1}", root, (x, -d * 0.18, slot_h * 0.55), role="scorecards")
    L.box("ScorecardHolder_Lip", (w, d * 0.74, h * 0.12),
          (0, 0, h * 0.06), finish, bevel=0.006, parent=root)
    if tier_index >= 3:
        L.cyl("ScorecardHolder_PencilCup", d * 0.15, h * 0.48,
              (w * 0.38, 0, h * 0.30), finish, verts=18, bevel=0.004, uv=True, parent=root)
    if tier_index == 4:
        L.box("ScorecardHolder_BrassInlay", (w * 0.66, 0.012, h * 0.08),
              (0, -d * 0.38, h * 0.86), M["brass"], bevel=0.004, parent=root)
    L.collision_box("COL_ScorecardHolder", (w, d, h), (0, 0, h / 2), M, parent=root)
    return root


def build_practice_basket(tier_index, M):
    w, d, h = DIMENSIONS["practice_basket"][tier_index]
    root = root_for("practice_basket", tier_index, (w, d, h))
    trim = tier_trim_material(M, tier_index)
    L.rounded_box("PracticeBasket_Base", (w * 0.74, d * 0.74, h * 0.07),
                  (0, 0, h * 0.035), M["stone"] if tier_index >= 3 else trim,
                  corner=0.08, bevel=0.006, parent=root)
    L.cyl("PracticeBasket_Mast", 0.018, h * 0.76, (0, d * 0.20, h * 0.44),
          trim, verts=12, bevel=0.002, uv=True, parent=root)
    rings = 1 if tier_index < 2 else 2 if tier_index < 4 else 3
    for index in range(rings):
        radius = w * (0.36 - index * 0.07)
        z = h * (0.35 + index * 0.16)
        L.torus(f"PracticeBasket_TargetRing_{index + 1}", radius, 0.014,
                (0, 0, z), M["brass"] if tier_index == 4 else trim,
                rot=(math.pi / 2, 0, 0), parent=root, mj=28, mn=8)
    basket_body("PracticeBasket_Collector", root, w * 0.76, d * 0.76, h * 0.38,
                h * 0.06, M, tier_index, target=True)
    if tier_index >= 1:
        L.box("PracticeBasket_Flag", (w * 0.42, 0.012, h * 0.17),
              (w * 0.19, d * 0.20, h * 0.86), tier_body_material(M, tier_index),
              bevel=0.003, parent=root)
    if tier_index >= 3:
        L.box("PracticeBasket_CollectionTray", (w * 0.82, d * 0.82, h * 0.055),
              (0, 0, h * 0.11), trim, bevel=0.007, parent=root)
    anchor("ANCHOR_PracticeTarget", root, (0, -d * 0.15, h * 0.52), role="practice_target")
    L.collision_box("COL_PracticeBasket", (w, d, h), (0, 0, h / 2), M, parent=root)
    return root


def build_water_cooler(tier_index, M):
    w, d, h = DIMENSIONS["water_cooler"][tier_index]
    root = root_for("water_cooler", tier_index, (w, d, h))
    body = tier_body_material(M, tier_index)
    base_mat = M["stone"] if tier_index == 4 else body
    cabinet_h = h * (0.48 if tier_index < 2 else 0.72)
    L.rounded_box("WaterCooler_Cabinet", (w * 0.84, d * 0.82, cabinet_h),
                  (0, 0, cabinet_h / 2), base_mat,
                  corner=0.07, bevel=0.007, parent=root)
    tank_r = w * (0.32 if tier_index < 3 else 0.37)
    L.cyl("WaterCooler_Tank", tank_r, h * 0.44,
          (0, 0, cabinet_h + h * 0.18), M["white"],
          verts=24, bevel=0.010, uv=True, parent=root)
    lid = group("WaterCooler_LidPivot", root, {
        "moving_part": "cooler_lid", "pivot_axis": "+X",
    }, (0, d * 0.18, cabinet_h + h * 0.40))
    L.cyl("WaterCooler_Lid", tank_r * 1.04, h * 0.055,
          (0, 0, cabinet_h + h * 0.41), tier_trim_material(M, tier_index),
          verts=24, bevel=0.005, uv=True, parent=lid)
    animate_rotation(lid, "WaterCooler_LidOpen", (0, 0, 0), (math.radians(58), 0, 0), 18)
    L.cyl("WaterCooler_Spigot", 0.025, d * 0.20,
          (0, -d * 0.46, cabinet_h * 0.82), tier_trim_material(M, tier_index),
          rot=(math.pi / 2, 0, 0), verts=14, bevel=0.003, uv=True, parent=root)
    if tier_index >= 1:
        L.cyl("WaterCooler_CupDispenser", w * 0.075, h * 0.36,
              (w * 0.38, 0, h * 0.58), body, verts=16, bevel=0.004, uv=True, parent=root)
    if tier_index >= 2:
        L.box("WaterCooler_DrainTray", (w * 0.48, d * 0.18, h * 0.045),
              (0, -d * 0.45, cabinet_h * 0.52), M["aluminum"], bevel=0.005, parent=root)
    if tier_index >= 3:
        L.box("WaterCooler_FilterScreen", (w * 0.34, 0.018, h * 0.10),
              (0, -d * 0.42, cabinet_h * 0.72), M["screen_live"], bevel=0.005, parent=root)
    if tier_index == 4:
        L.box("WaterCooler_BrassBand", (w * 0.72, 0.018, h * 0.035),
              (0, -d * 0.42, cabinet_h * 0.90), M["brass"], bevel=0.004, parent=root)
    anchor("ANCHOR_WaterFill", root, (0, -d * 0.50, cabinet_h * 0.76), role="drinking_water")
    L.collision_box("COL_WaterCooler", (w, d, h), (0, 0, h / 2), M, parent=root)
    return root


def build_trash_can(tier_index, M):
    w, d, h = DIMENSIONS["trash_can"][tier_index]
    root = root_for("trash_can", tier_index, (w, d, h))
    body = tier_body_material(M, tier_index)
    finish = M["oak"] if tier_index == 2 else M["walnut"] if tier_index == 3 else body
    streams = 2 if tier_index >= 3 else 1
    if tier_index < 2:
        L.cyl("TrashCan_Body", w * 0.43, h * 0.82, (0, 0, h * 0.41), finish,
              verts=24, bevel=0.008, uv=True, parent=root)
    else:
        L.rounded_box("TrashCan_Cabinet", (w * 0.92, d * 0.92, h * 0.90),
                      (0, 0, h * 0.45), M["stone"] if tier_index == 4 else finish,
                      corner=0.07, bevel=0.008, parent=root)
        slats = 7 + tier_index
        for index in range(slats):
            x = -w * 0.38 + index * (w * 0.76 / max(1, slats - 1))
            L.box(f"TrashCan_Slat_{index + 1}", (w * 0.055, 0.020, h * 0.72),
                  (x, -d * 0.47, h * 0.45), finish, bevel=0.004, parent=root)
    lid = group("TrashCan_LidPivot", root, {
        "moving_part": "trash_lid", "pivot_axis": "+X",
    }, (0, d * 0.38, h * 0.88))
    L.rounded_box("TrashCan_Lid", (w, d, h * 0.10),
                  (0, 0, h * 0.94), M["brass"] if tier_index == 4 else body,
                  corner=0.07, bevel=0.007, parent=lid)
    animate_rotation(lid, "TrashCan_LidOpen", (0, 0, 0), (math.radians(62), 0, 0), 18)
    for index in range(streams):
        x = (index - (streams - 1) / 2) * w * 0.38
        L.box(f"TrashCan_Opening_{index + 1}", (w * (0.50 if streams == 1 else 0.34), d * 0.24, 0.025),
              (x, -d * 0.04, h * 0.99), M["rubber"], bevel=0.010, parent=lid)
        anchor(f"ANCHOR_WasteStream_{index + 1}", root, (x, -d * 0.10, h), role="waste")
    if tier_index == 4:
        L.box("TrashCan_BrassLabel", (w * 0.58, 0.018, h * 0.09),
              (0, -d * 0.48, h * 0.68), M["brass"], bevel=0.005, parent=root)
    L.collision_box("COL_TrashCan", (w, d, h), (0, 0, h / 2), M, parent=root)
    return root


def build_bench(tier_index, M):
    w, d, h = DIMENSIONS["bench"][tier_index]
    root = root_for("bench", tier_index, (w, d, h))
    frame = tier_trim_material(M, tier_index)
    slat = frame if tier_index == 0 else M["oak"] if tier_index < 3 else M["walnut"]
    seat_z = h * 0.46
    for x_index, x in enumerate((-w * 0.40, w * 0.40)):
        for y_index, y in enumerate((-d * 0.28, d * 0.28)):
            L.box(f"Bench_Leg_{x_index + 1}_{y_index + 1}", (0.065, 0.065, seat_z), (x, y, seat_z / 2),
                  frame, bevel=0.007, parent=root)
    slats = 4 + tier_index
    for index in range(slats):
        y = -d * 0.34 + index * (d * 0.68 / max(1, slats - 1))
        L.wood_slab(f"Bench_SeatSlat_{index + 1}", (w, d * 0.10, h * 0.055),
                    (0, y, seat_z), slat, bevel=0.006, parent=root)
    if tier_index >= 1:
        for index in range(3 + tier_index):
            z = seat_z + h * (0.10 + index * 0.09)
            L.wood_slab(f"Bench_BackSlat_{index + 1}", (w, h * 0.045, h * 0.07),
                        (0, d * 0.35, z), slat, bevel=0.006, parent=root)
        for side, x in zip(("L", "R"), (-w * 0.42, w * 0.42)):
            L.box(f"Bench_BackPost_{side}", (0.065, 0.065, h * 0.52),
                  (x, d * 0.34, seat_z + h * 0.23), frame, bevel=0.007, parent=root)
    if tier_index >= 2:
        for side, x in zip(("L", "R"), (-w * 0.46, w * 0.46)):
            L.box(f"Bench_Arm_{side}", (w * 0.13, d * 0.10, h * 0.055),
                  (x, 0, seat_z + h * 0.18), slat, bevel=0.008, parent=root)
    if tier_index >= 3:
        L.box("Bench_MemorialPlaque", (w * 0.25, 0.018, h * 0.08),
              (0, d * 0.37, seat_z + h * 0.31), M["brass"], bevel=0.005, parent=root)
    if tier_index == 4:
        for side, x in zip(("L", "R"), (-w * 0.47, w * 0.47)):
            L.sphere(f"Bench_Finial_{side}", h * 0.035, (x, d * 0.34, h * 0.96), M["brass"], parent=root, segs=16)
    anchor("ANCHOR_Seat", root, (0, -d * 0.08, seat_z + h * 0.06), role="seating")
    L.collision_box("COL_BenchSeat", (w, d * 0.82, h * 0.18),
                    (0, 0, seat_z), M, parent=root)
    L.collision_box("COL_BenchBack", (w, d * 0.16, h * 0.54),
                    (0, d * 0.34, seat_z + h * 0.24), M, parent=root)
    return root


def build_bag_drop_station(tier_index, M):
    w, d, h = DIMENSIONS["bag_drop_station"][tier_index]
    root = root_for("bag_drop_station", tier_index, (w, d, h))
    body = tier_body_material(M, tier_index)
    finish = M["oak"] if tier_index == 2 else M["walnut"] if tier_index >= 3 else body
    counter_h = h * (0.56 if tier_index == 0 else 0.43)
    L.rounded_box("BagDrop_Counter", (w * 0.88, d * 0.72, counter_h),
                  (0, 0, counter_h / 2), finish, corner=0.08, bevel=0.009, parent=root)
    bays = 1 if tier_index == 0 else min(4, tier_index + 1)
    for index in range(bays):
        x = (index - (bays - 1) / 2) * (w * 0.72 / max(1, bays - 1)) if bays > 1 else 0
        L.box(f"BagDrop_BayDivider_{index + 1}", (0.045, d * 0.62, counter_h * 0.72),
              (x, 0, counter_h * 0.38), tier_trim_material(M, tier_index),
              bevel=0.005, parent=root)
        anchor(f"ANCHOR_BagDrop_{index + 1}", root, (x, -d * 0.20, counter_h * 0.42), role="bag_drop")
    if tier_index == 0:
        L.box("BagDrop_SignPost", (0.050, 0.050, h * 0.82),
              (w * 0.40, d * 0.18, h * 0.59), tier_trim_material(M, tier_index),
              bevel=0.006, parent=root)
        L.box("BagDrop_PortableSign", (w * 0.34, 0.035, h * 0.22),
              (w * 0.26, d * 0.18, h * 0.88), body, bevel=0.008, parent=root)
    else:
        for side, x in zip(("L", "R"), (-w * 0.43, w * 0.43)):
            L.box(f"BagDrop_CanopyPost_{side}", (0.060, 0.060, h * 0.74),
                  (x, d * 0.24, h * 0.58), tier_trim_material(M, tier_index),
                  bevel=0.008, parent=root)
        L.rounded_box("BagDrop_Canopy", (w, d * 0.92, h * 0.09),
                      (0, 0, h * 0.95), body, corner=0.10, bevel=0.008, parent=root)
    if tier_index >= 2:
        L.wood_slab("BagDrop_ServiceTop", (w * 0.92, d * 0.78, h * 0.055),
                    (0, 0, counter_h + h * 0.025), finish, bevel=0.008, parent=root)
    if tier_index >= 3:
        L.box("BagDrop_ConciergePanel", (w * 0.46, 0.024, h * 0.22),
              (0, -d * 0.37, counter_h * 0.60), finish, bevel=0.008, parent=root)
    if tier_index == 4:
        L.box("BagDrop_BrassCrest", (w * 0.28, 0.018, h * 0.10),
              (0, -d * 0.47, h * 0.89), M["brass"], bevel=0.006, parent=root)
    L.collision_box("COL_BagDropCounter", (w * 0.90, d * 0.74, counter_h),
                    (0, 0, counter_h / 2), M, parent=root)
    L.collision_box("COL_BagDropCanopy", (w, d, h * 0.12),
                    (0, 0, h * 0.94), M, parent=root)
    return root


def build_club_storage(family, tier_index, M):
    w, d, h = DIMENSIONS[family][tier_index]
    root = root_for(family, tier_index, (w, d, h))
    body = tier_body_material(M, tier_index)
    finish = M["oak"] if tier_index == 2 else M["walnut"] if tier_index >= 3 else body
    bays = 4 + tier_index * 2 if family == "golf_club_storage" else 5 + tier_index * 2
    plinth_h = h * 0.08
    L.rounded_box("ClubStorage_Plinth", (w, d, plinth_h),
                  (0, 0, plinth_h / 2), finish, corner=0.05, bevel=0.007, parent=root)
    L.box("ClubStorage_Back", (w * 0.96, d * 0.10, h * 0.86),
          (0, d * 0.43, plinth_h + h * 0.43), finish, bevel=0.006, parent=root)
    for side in (-1, 1):
        L.box(f"ClubStorage_Side_{side}", (w * 0.045, d * 0.92, h * 0.88),
              (side * w * 0.475, 0, plinth_h + h * 0.44), finish,
              bevel=0.007, parent=root)
    L.wood_slab("ClubStorage_Top", (w, d, h * 0.06),
                (0, 0, h * 0.97), finish, bevel=0.007, parent=root)
    shelf_count = 2 if tier_index < 2 else 3 if tier_index < 4 else 4
    for shelf in range(shelf_count):
        z = plinth_h + (shelf + 1) * (h * 0.76 / shelf_count)
        L.wood_slab(f"ClubStorage_Shelf_{shelf + 1}", (w * 0.92, d * 0.82, h * 0.035),
                    (0, 0, z), finish, bevel=0.004, parent=root)
    pitch = w * 0.86 / bays
    for index in range(bays):
        x = -w * 0.43 + (index + 0.5) * pitch
        L.cyl(f"StoredClub_Shaft_{index + 1}", 0.007, h * 0.66,
              (x, 0, plinth_h + h * 0.39), M["dark_steel"],
              verts=10, bevel=0.001, uv=True, parent=root)
        L.box(f"StoredClub_Head_{index + 1}", (pitch * 0.48, d * 0.18, h * 0.055),
              (x, -d * 0.05, plinth_h + h * 0.72),
              M["aluminum"] if index % 2 == 0 else M["premium"],
              bevel=0.006, parent=root)
        anchor(f"ANCHOR_Club_{index + 1}", root, (x, -d * 0.22, plinth_h + h * 0.40), role="stored_club")
    if family == "rental_club_storage":
        bag_bays = 2 + tier_index
        for index in range(bag_bays):
            x = (index - (bag_bays - 1) / 2) * (w * 0.72 / max(1, bag_bays - 1)) if bag_bays > 1 else 0
            L.box(f"RentalStorage_BayDivider_{index + 1}", (0.028, d * 0.76, h * 0.42),
                  (x, 0, plinth_h + h * 0.21), tier_trim_material(M, tier_index),
                  bevel=0.004, parent=root)
            anchor(f"ANCHOR_RentalBag_{index + 1}", root, (x, -d * 0.18, h * 0.28), role="rental_bag")
        if tier_index >= 1:
            for side, x in zip(("L", "R"), (-w * 0.40, w * 0.40)):
                vehicle_wheel(f"RentalStorage_Caster_{side}", root, x, 0, 0.045, 0.045, d * 0.07, M, tier_index)
    if tier_index >= 3:
        for side in (-1, 1):
            door = group(f"ClubStorage_DoorPivot_{'L' if side < 0 else 'R'}", root, {
                "moving_part": "cabinet_door", "pivot_axis": "+Z",
            }, (side * w * 0.46, -d * 0.45, h * 0.52))
            L.box(f"ClubStorage_GlassDoor_{'L' if side < 0 else 'R'}", (w * 0.46, 0.025, h * 0.82),
                  (side * w * 0.23, -d * 0.45, h * 0.52), M["glass"],
                  bevel=0.008, parent=door)
            L.box(f"ClubStorage_DoorFrame_{'L' if side < 0 else 'R'}", (w * 0.43, 0.030, h * 0.045),
                  (side * w * 0.23, -d * 0.46, h * 0.90), finish,
                  bevel=0.005, parent=door)
            if side < 0:
                animate_rotation(door, "ClubStorage_DoorOpen", (0, 0, 0), (0, 0, math.radians(-76)), 22)
    if tier_index == 4:
        for side in (-1, 1):
            L.box(f"ClubStorage_Light_{side}", (0.018, 0.018, h * 0.78),
                  (side * w * 0.42, -d * 0.39, h * 0.54), M["led_amber"],
                  bevel=0.004, parent=root)
        L.box("ClubStorage_BrassRail", (w * 0.74, 0.018, h * 0.025),
              (0, -d * 0.47, h * 0.92), M["brass"], bevel=0.004, parent=root)
    L.collision_box(f"COL_{family}", (w, d, h), (0, 0, h / 2), M, parent=root)
    return root


def build_golf_club_storage(tier_index, M):
    return build_club_storage("golf_club_storage", tier_index, M)


def build_rental_club_storage(tier_index, M):
    return build_club_storage("rental_club_storage", tier_index, M)


def build_display_tv(tier_index, M):
    w, d, h = DIMENSIONS["display_tv"][tier_index]
    root = root_for("display_tv", tier_index, (w, d, h))
    bezel = max(0.018, w * (0.050 - tier_index * 0.007))
    frame_mat = M["walnut"] if tier_index == 4 else tier_body_material(M, tier_index)
    pivot = group("DisplayTV_TiltPivot", root, {
        "moving_part": "display_tilt", "pivot_axis": "+X", "range_degrees": [-6, 10],
    }, (0, d * 0.10, h * 0.52))
    body_d = d * 0.72
    L.rounded_box("DisplayTV_Back", (w, body_d, h), (0, 0, h / 2), frame_mat,
                  corner=bezel * 1.6, bevel=0.006, parent=pivot)
    L.box("DisplayTV_Screen", (w - 2 * bezel, 0.008, h - 2 * bezel),
          (0, -body_d / 2 - 0.005, h / 2), M["screen_live"],
          bevel=0.005, parent=pivot,
          props={"dynamic_screen": True, "screen_px": [3840 if tier_index >= 2 else 1920, 2160 if tier_index >= 2 else 1080]})
    if tier_index == 0:
        for index in range(5):
            L.box(f"DisplayTV_Button_{index + 1}", (0.018, 0.008, 0.010),
                  (w * 0.25 + index * 0.024, -body_d / 2 - 0.009, bezel * 0.65),
                  M["key"], bevel=0.002, parent=pivot)
    if tier_index >= 1:
        L.box("DisplayTV_CommercialBadge", (w * 0.14, 0.008, h * 0.025),
              (0, -body_d / 2 - 0.009, bezel * 0.60), tier_trim_material(M, tier_index),
              bevel=0.004, parent=pivot)
    if tier_index >= 3:
        L.box("DisplayTV_InputPanel", (w * 0.22, 0.010, h * 0.22),
              (w * 0.30, body_d / 2 + 0.003, h * 0.40), M["premium"],
              bevel=0.005, parent=pivot)
    if tier_index == 4:
        for side, x in zip(("L", "R"), (-w * 0.47, w * 0.47)):
            L.box(f"DisplayTV_BrassFrameSide_{side}", (0.012, body_d + 0.006, h * 0.90),
                  (x, 0, h * 0.52), M["brass"], bevel=0.003, parent=pivot)
    animate_rotation(pivot, "DisplayTV_Tilt", (0, 0, 0), (math.radians(-6), 0, 0), 18)
    anchor("ANCHOR_DisplaySurface", pivot, (0, -body_d / 2 - 0.010, h / 2), role="dynamic_display")
    anchor("ANCHOR_WallMount", root, (0, body_d / 2, h / 2), role="wall_mount")
    L.collision_box("COL_DisplayTV", (w, d, h), (0, 0, h / 2), M, parent=root)
    return root


def computer_monitor(prefix, parent, width, depth, height, x, z, M, tier_index):
    pivot = group(f"{prefix}_TiltPivot", parent, {
        "moving_part": "monitor_tilt", "pivot_axis": "+X",
    }, (x, 0, z - height * 0.34))
    L.box(f"{prefix}_Back", (width, depth, height), (x, 0, z),
          tier_body_material(M, tier_index), bevel=0.006, parent=pivot)
    bezel = max(0.012, width * (0.055 - tier_index * 0.007))
    L.box(f"{prefix}_Screen", (width - 2 * bezel, 0.006, height - 2 * bezel),
          (x, -depth / 2 - 0.005, z), M["screen_live"], bevel=0.004,
          parent=pivot, props={"dynamic_screen": True, "screen_px": [1920, 1080]})
    L.box(f"{prefix}_Stem", (width * 0.10, depth * 0.20, z * 0.44),
          (x, depth * 0.08, z * 0.28), tier_trim_material(M, tier_index),
          bevel=0.006, parent=pivot)
    animate_rotation(pivot, f"{prefix}_Tilt", (0, 0, 0), (math.radians(-7), 0, 0), 16)
    return pivot


def build_computer(tier_index, M):
    w, d, h = DIMENSIONS["computer"][tier_index]
    root = root_for("computer", tier_index, (w, d, h))
    dual = tier_index >= 3
    all_in_one = tier_index >= 2
    monitor_count = 2 if dual else 1
    monitor_w = w * (0.45 if dual else 0.72)
    monitor_h = h * 0.54
    for index in range(monitor_count):
        x = (index - (monitor_count - 1) / 2) * w * 0.47
        computer_monitor(f"Computer_Monitor_{index + 1}", root, monitor_w, d * 0.18,
                         monitor_h, x, h * 0.70, M, tier_index)
        anchor(f"ANCHOR_ComputerScreen_{index + 1}", root,
               (x, -d * 0.10, h * 0.70), role="computer_screen")
    base_mat = M["walnut"] if tier_index == 4 else tier_trim_material(M, tier_index)
    L.rounded_box("Computer_Base", (w * 0.84, d * 0.78, h * 0.055),
                  (0, d * 0.04, h * 0.028), base_mat,
                  corner=0.05, bevel=0.005, parent=root)
    L.box("Computer_Keyboard", (w * 0.72, d * 0.32, h * 0.045),
          (0, -d * 0.26, h * 0.065), M["key"], bevel=0.008, parent=root)
    if not all_in_one:
        L.rounded_box("Computer_Tower", (w * 0.20, d * 0.70, h * 0.58),
                      (w * 0.38, d * 0.05, h * 0.29), tier_body_material(M, tier_index),
                      corner=0.035, bevel=0.006, parent=root)
        L.cyl("Computer_PowerButton", 0.012, 0.008,
              (w * 0.38, -d * 0.31, h * 0.49), M["led_green"],
              rot=(math.pi / 2, 0, 0), verts=12, bevel=0.002, uv=True, parent=root)
    if tier_index == 4:
        L.box("Computer_BrassNameplate", (w * 0.20, 0.010, h * 0.035),
              (0, -d * 0.40, h * 0.055), M["brass"], bevel=0.004, parent=root)
    L.collision_box("COL_Computer", (w, d, h), (0, 0, h / 2), M, parent=root)
    return root


def build_laptop(tier_index, M):
    w, d, h = DIMENSIONS["laptop"][tier_index]
    root = root_for("laptop", tier_index, (w, d, h))
    body = M["aluminum"] if tier_index >= 2 else tier_body_material(M, tier_index)
    if tier_index == 4:
        L.rounded_box("Laptop_LeatherSleeve", (w, d, h * 0.12),
                      (0, 0, h * 0.06), M["leather"], corner=0.04, bevel=0.006, parent=root)
    base_z = h * (0.10 if tier_index < 4 else 0.17)
    L.rounded_box("Laptop_Base", (w * 0.96, d, h * 0.10),
                  (0, 0, base_z), body, corner=0.035, bevel=0.005, parent=root)
    L.box("Laptop_Keyboard", (w * 0.80, d * 0.54, h * 0.018),
          (0, -d * 0.12, base_z + h * 0.055), M["key"], bevel=0.004, parent=root)
    L.box("Laptop_Trackpad", (w * 0.34, d * 0.20, h * 0.012),
          (0, -d * 0.36, base_z + h * 0.060), tier_trim_material(M, tier_index),
          bevel=0.005, parent=root)
    screen_h = h * 0.78
    pivot = group("Laptop_ScreenHinge", root, {
        "moving_part": "laptop_screen", "pivot_axis": "+X", "range_degrees": [0, 112],
    }, (0, d * 0.42, base_z + h * 0.05))
    L.box("Laptop_ScreenBack", (w * 0.96, h * 0.055, screen_h),
          (0, d * 0.42, base_z + screen_h * 0.52), body,
          bevel=0.005, parent=pivot)
    bezel = max(0.010, w * (0.045 - tier_index * 0.005))
    L.box("Laptop_Screen", (w * 0.96 - 2 * bezel, 0.006, screen_h - 2 * bezel),
          (0, d * 0.39, base_z + screen_h * 0.52), M["screen_live"],
          bevel=0.004, parent=pivot, props={"dynamic_screen": True, "screen_px": [2560, 1600]})
    if tier_index == 4:
        L.box("Laptop_BrassHinge", (w * 0.56, 0.018, 0.018),
              (0, d * 0.42, base_z + h * 0.05), M["brass"], bevel=0.004, parent=pivot)
    animate_rotation(pivot, "Laptop_Close", (0, 0, 0), (math.radians(86), 0, 0), 22)
    anchor("ANCHOR_LaptopScreen", pivot, (0, d * 0.38, base_z + screen_h * 0.52), role="computer_screen")
    L.collision_box("COL_Laptop", (w, d, h), (0, 0, h / 2), M, parent=root)
    return root


def build_office_chair(tier_index, M):
    w, d, h = DIMENSIONS["office_chair"][tier_index]
    root = root_for("office_chair", tier_index, (w, d, h))
    frame = tier_trim_material(M, tier_index)
    upholstery = M["fabric"] if tier_index < 3 else M["leather"]
    caster_z = h * 0.055
    for index in range(5):
        angle = math.tau * index / 5
        x, y = math.cos(angle) * w * 0.36, math.sin(angle) * d * 0.36
        L.box(f"OfficeChair_BaseArm_{index + 1}", (w * 0.38, 0.035, 0.035),
              (x * 0.48, y * 0.48, caster_z + h * 0.035), frame,
              rot=(0, 0, angle), bevel=0.005, parent=root)
        L.cyl(f"OfficeChair_Caster_{index + 1}", h * 0.032, 0.026,
              (x, y, caster_z), M["rubber"], rot=(math.pi / 2, 0, 0),
              verts=14, bevel=0.002, uv=True, parent=root)
    swivel = group("OfficeChair_SwivelPivot", root, {
        "moving_part": "chair_swivel", "pivot_axis": "+Z",
    }, (0, 0, h * 0.12))
    L.cyl("OfficeChair_GasLift", w * 0.045, h * 0.36,
          (0, 0, h * 0.30), frame, verts=16, bevel=0.004, uv=True, parent=swivel)
    seat_z = h * 0.48
    L.rounded_box("OfficeChair_Seat", (w * 0.76, d * 0.72, h * 0.12),
                  (0, -d * 0.03, seat_z), upholstery,
                  corner=0.09, bevel=0.008, parent=swivel)
    back_h = h * (0.40 + tier_index * 0.035)
    L.rounded_box("OfficeChair_Back", (w * (0.66 + tier_index * 0.03), h * 0.11, back_h),
                  (0, d * 0.29, seat_z + back_h * 0.43),
                  M["fabric"] if tier_index == 2 else upholstery,
                  corner=0.08, bevel=0.008, parent=swivel)
    if tier_index >= 1:
        for side in (-1, 1):
            L.box(f"OfficeChair_ArmPost_{side}", (0.040, 0.040, h * 0.20),
                  (side * w * 0.35, 0, seat_z + h * 0.13), frame,
                  bevel=0.006, parent=swivel)
            L.rounded_box(f"OfficeChair_ArmPad_{side}", (w * 0.16, d * 0.44, h * 0.055),
                          (side * w * 0.35, 0, seat_z + h * 0.23),
                          M["walnut"] if tier_index == 4 else upholstery,
                          corner=0.04, bevel=0.006, parent=swivel)
    if tier_index >= 3:
        L.rounded_box("OfficeChair_Headrest", (w * 0.52, h * 0.10, h * 0.13),
                      (0, d * 0.29, h * 0.93), upholstery,
                      corner=0.05, bevel=0.006, parent=swivel)
    if tier_index == 4:
        for row in range(2):
            for col in range(3):
                L.sphere(f"OfficeChair_Tuft_{row}_{col}", h * 0.015,
                         ((col - 1) * w * 0.15, d * 0.23, h * (0.69 + row * 0.13)),
                         M["brass"], parent=swivel, segs=12)
    animate_rotation(swivel, "OfficeChair_Swivel", (0, 0, 0), (0, 0, math.radians(45)), 20)
    anchor("ANCHOR_ChairSeat", swivel, (0, -d * 0.03, seat_z + h * 0.08), role="seating")
    L.collision_box("COL_OfficeChairSeat", (w * 0.78, d * 0.74, h * 0.18),
                    (0, -d * 0.03, seat_z), M, parent=root)
    L.collision_box("COL_OfficeChairBack", (w * 0.72, h * 0.14, h * 0.52),
                    (0, d * 0.29, h * 0.75), M, parent=root)
    return root


BUILDERS = {
    "golf_cart": build_golf_cart,
    "push_cart": build_push_cart,
    "utility_cart": build_utility_cart,
    "maintenance_cart": build_maintenance_cart,
    "ball_washer": build_ball_washer,
    "club_cleaner": build_club_cleaner,
    "bag_stand": build_bag_stand,
    "range_basket": build_range_basket,
    "scorecard_holder": build_scorecard_holder,
    "practice_basket": build_practice_basket,
    "water_cooler": build_water_cooler,
    "trash_can": build_trash_can,
    "bench": build_bench,
    "bag_drop_station": build_bag_drop_station,
    "golf_club_storage": build_golf_club_storage,
    "rental_club_storage": build_rental_club_storage,
    "display_tv": build_display_tv,
    "pos_terminal": build_pos,
    "card_reader": build_card_reader,
    "receipt_printer": build_receipt_printer,
    "cash_drawer": build_cash_drawer,
    "computer": build_computer,
    "laptop": build_laptop,
    "office_chair": build_office_chair,
}

GROUPS = {
    "checkout": ("pos_terminal", "card_reader", "receipt_printer", "cash_drawer"),
    "transport": ("golf_cart", "push_cart", "utility_cart", "maintenance_cart"),
    "course": (
        "ball_washer", "club_cleaner", "bag_stand", "range_basket",
        "scorecard_holder", "practice_basket", "water_cooler", "trash_can",
        "bench", "bag_drop_station",
    ),
    "indoor": (
        "golf_club_storage", "rental_club_storage", "display_tv",
        "computer", "laptop", "office_chair",
    ),
}


def visible_triangles(root):
    return sum(
        sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons)
        for obj in L.descendants(root)
        if obj.type == "MESH" and not obj.get("collision_proxy")
    )


def bounds(root):
    mins, maxs = L._world_bounds(root)
    return {
        "min": [round(value, 5) for value in mins],
        "max": [round(value, 5) for value in maxs],
        "size": [round(maxs[index] - mins[index], 5) for index in range(3)],
    }


def canonical_export_names(root):
    """Temporarily remove Blender's global .001 suffixes from one tier.

    Source .blend files intentionally contain all five tiers, so Blender must
    suffix repeated component names there.  A shipped GLB contains only one
    tier and must expose a stable runtime contract regardless of which tier it
    came from.  Move every blocker out of the namespace, canonicalize the
    selected subtree, then restore the authoring scene after export.
    """
    selected = set(L.descendants(root))
    changed = []
    for obj in bpy.context.scene.objects:
        if obj not in selected:
            changed.append((obj, obj.name))
            obj.name = f"SOURCEONLY_{obj.name}_{id(obj)}"
    for obj in selected:
        changed.append((obj, obj.name))
        obj.name = re.sub(r"\.\d{3}$", "", obj.name)
        if obj.data is not None:
            obj.data.name = obj.name
    return changed


def restore_names(changed):
    # Restore selected names last, after freeing their canonical names.
    selected = [(obj, name) for obj, name in changed if not obj.name.startswith("SOURCEONLY_")]
    blockers = [(obj, name) for obj, name in changed if obj.name.startswith("SOURCEONLY_")]
    for obj, _name in selected:
        obj.name = f"RESTORE_{obj.name}_{id(obj)}"
    for obj, name in blockers:
        obj.name = name
    for obj, name in selected:
        obj.name = name


def export_root(asset_id, root):
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    target = GLB_DIR / f"{asset_id}.glb"
    bpy.ops.object.select_all(action="DESELECT")
    selected = L.descendants(root)
    for obj in selected:
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    changed = canonical_export_names(root)
    try:
        bpy.ops.export_scene.gltf(
            filepath=str(target),
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_yup=True,
            export_normals=True,
            export_texcoords=True,
            export_materials="EXPORT",
            export_animations=True,
            export_force_sampling=True,
            export_extras=True,
            export_cameras=False,
            export_lights=False,
        )
    finally:
        restore_names(changed)
    return target, selected


def load_manifest():
    if not MANIFEST_PATH.exists():
        return {"version": 1, "generatedBy": "tools/blender/build_pro_shop_equipment.py", "assets": []}
    try:
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"version": 1, "generatedBy": "tools/blender/build_pro_shop_equipment.py", "assets": []}


def write_manifest(updates):
    manifest = load_manifest()
    indexed = {entry["id"]: entry for entry in manifest.get("assets", [])}
    indexed.update({entry["id"]: entry for entry in updates})
    manifest["assets"] = [indexed[key] for key in sorted(indexed)]
    manifest["available"] = sorted(indexed)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"MANIFEST|{MANIFEST_PATH.relative_to(ROOT)}|assets={len(indexed)}")


def build_family(family, do_render=False):
    L.reset_scene()
    M = materials()
    source_root = group(f"SOURCE_{family}", props={
        "equipment_family": family,
        "tier_count": 5,
        "source_reference": "Designs/ClubHouse",
        "license": "Project-owned / UNLICENSED",
    })
    roots = []
    widest = max(item[0] for item in DIMENSIONS[family])
    spacing = widest + max(0.24, widest * 0.34)
    for tier_index, tier in enumerate(TIERS):
        root = BUILDERS[family](tier_index, M)
        L.parent_keep(root, source_root)
        root.location.x = (tier_index - 2) * spacing
        roots.append(root)
    bpy.context.view_layer.update()

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    source_path = SOURCE_DIR / f"{family}.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path), check_existing=False)
    updates = []
    for tier_index, root in enumerate(roots):
        asset_id = root["asset_id"]
        arranged = tuple(root.location)
        root.location = (0.0, 0.0, 0.0)
        bpy.context.view_layer.update()
        measured = bounds(root)
        glb_path, nodes = export_root(asset_id, root)
        updates.append({
            "id": asset_id,
            "familyId": family,
            "tierId": TIERS[tier_index]["id"],
            "qualityLevel": tier_index + 1,
            "source": str(source_path.relative_to(ROOT)).replace("\\", "/"),
            "glb": str(glb_path.relative_to(ROOT)).replace("\\", "/"),
            "targetDimensionsM": list(DIMENSIONS[family][tier_index]),
            "measuredBoundsM": measured,
            "triangles": visible_triangles(root),
            "nodes": len(nodes),
            "movingParts": sorted(re.sub(r"\.\d{3}$", "", obj.name) for obj in nodes if obj.get("moving_part")),
            "collisionNodes": sorted(re.sub(r"\.\d{3}$", "", obj.name) for obj in nodes if obj.get("collision_proxy")),
            "license": "Project-owned / UNLICENSED",
        })
        print(
            f"BUILT|{asset_id}|tris={updates[-1]['triangles']}|nodes={len(nodes)}|"
            f"glb={glb_path.relative_to(ROOT)}"
        )
        root.location = arranged
    bpy.context.view_layer.update()
    if do_render:
        L.render_preview(f"pro-shop-equipment/{family}-tiers", source_root, azimuth=34, elevation=20)
    return updates


def requested_families(arguments):
    values = [arg for arg in arguments if arg != "render"]
    if not values or "all" in values:
        return list(BUILDERS)
    unknown = [value for value in values if value not in BUILDERS and value not in GROUPS]
    if unknown:
        raise SystemExit(f"Unknown equipment families/groups: {', '.join(unknown)}")
    selected = []
    for value in values:
        families = GROUPS.get(value, (value,))
        for family in families:
            if family not in selected:
                selected.append(family)
    return selected


def main():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    do_render = "render" in arguments
    updates = []
    for family in requested_families(arguments):
        updates.extend(build_family(family, do_render=do_render))
    write_manifest(updates)
    print(f"COMPLETE|families={len(set(entry['familyId'] for entry in updates))}|assets={len(updates)}")


if __name__ == "__main__":
    main()
