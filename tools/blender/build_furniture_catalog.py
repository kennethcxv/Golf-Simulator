"""Build the complete Pinehollow furniture catalog as project-owned Blender art.

Run from the repository root with Blender 5.1::

    blender --background --factory-startup \
      --python tools/blender/build_furniture_catalog.py -- --family apparel-rack --thumbnails
    blender --background --factory-startup \
      --python tools/blender/build_furniture_catalog.py -- --all --thumbnails

The committed manifest is generated from the simulation catalog.  Every family
produces five progressively richer GLBs, one editable family .blend, and five
matching 320x180 catalog renders. Geometry is deterministic and original; no
downloaded, generated, Tripo, linked-library, or third-party source is opened.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Iterable

import bpy
from mathutils import Vector


REPO = Path(__file__).resolve().parents[2]
MANIFEST_PATH = Path(__file__).with_name("furniture_catalog_manifest.json")
GLB_DIR = REPO / "vendor" / "models" / "furniture" / "catalog"
THUMB_DIR = REPO / "vendor" / "images" / "furniture" / "catalog"
SOURCE_DIR = REPO / "asset_sources" / "blender" / "furniture_catalog"

TIERS = ("basic", "commercial", "retail", "boutique", "luxury")
TIER_LABELS = ("Municipal", "Commercial", "Professional Retail", "Boutique", "Heritage Country Club")
TIER_BEVEL = (0.008, 0.012, 0.016, 0.020, 0.024)

PALETTE = {
    "cream": (0.79, 0.69, 0.52, 1.0),
    "green": (0.025, 0.16, 0.085, 1.0),
    "sage": (0.33, 0.45, 0.32, 1.0),
    "walnut": (0.22, 0.095, 0.040, 1.0),
    "oak": (0.53, 0.28, 0.105, 1.0),
    "charcoal": (0.075, 0.082, 0.074, 1.0),
    "brass": (0.48, 0.30, 0.080, 1.0),
    "glass": (0.34, 0.48, 0.45, 0.33),
    "white": (0.78, 0.75, 0.65, 1.0),
    "terracotta": (0.35, 0.10, 0.045, 1.0),
}


def args_after_separator() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the five-tier furniture catalog")
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--all", action="store_true", help="build all 62 families / 310 GLBs")
    scope.add_argument("--family", help="build one manifest family id or model family")
    parser.add_argument("--thumbnails", action="store_true", help="render matching 320x180 PNG thumbnails")
    parser.add_argument("--no-source", action="store_true", help="do not save editable per-family .blend sources")
    return parser.parse_args(args_after_separator())


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def material(name: str, color: tuple[float, float, float, float], *, roughness: float = 0.58,
             metallic: float = 0.0, transmission: float = 0.0, emission: float = 0.0) -> bpy.types.Material:
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    node = mat.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = color
    node.inputs["Roughness"].default_value = roughness
    node.inputs["Metallic"].default_value = metallic
    if "Coat Weight" in node.inputs:
        node.inputs["Coat Weight"].default_value = 0.10 if metallic < 0.5 else 0.03
    if "Transmission Weight" in node.inputs:
        node.inputs["Transmission Weight"].default_value = transmission
    if color[3] < 0.99:
        mat.surface_render_method = "DITHERED"
    if emission > 0:
        node.inputs["Emission Color"].default_value = color
        node.inputs["Emission Strength"].default_value = emission
    mat["pinehollow_shared_role"] = name
    mat["source"] = "Project-owned procedural PBR"
    return mat


def tier_materials(tier_index: int) -> dict[str, bpy.types.Material]:
    tier = TIERS[tier_index]
    primary_keys = ("charcoal", "charcoal", "oak", "walnut", "green")
    secondary_keys = ("cream", "oak", "sage", "green", "walnut")
    accent_keys = ("charcoal", "charcoal", "green", "brass", "brass")
    primary = primary_keys[tier_index]
    secondary = secondary_keys[tier_index]
    accent = accent_keys[tier_index]
    return {
        "primary": material(f"M_FURN_{tier}_Primary_{primary}", PALETTE[primary], roughness=0.66 - tier_index * 0.045),
        "secondary": material(f"M_FURN_{tier}_Secondary_{secondary}", PALETTE[secondary], roughness=0.68 - tier_index * 0.04),
        "accent": material(f"M_FURN_{tier}_Accent_{accent}", PALETTE[accent], roughness=0.42, metallic=0.72 if accent == "brass" else 0.18),
        "upholstery": material(f"M_FURN_{tier}_Upholstery", PALETTE["sage" if tier_index < 3 else "green"], roughness=0.82),
        "glass": material("M_FURN_Shared_Glass", PALETTE["glass"], roughness=0.12, metallic=0.08, transmission=0.28),
        "light": material("M_FURN_Shared_WarmLight", (1.0, 0.55, 0.18, 1.0), roughness=0.32, emission=2.0),
        "leaf": material("M_FURN_Shared_Leaf", (0.05, 0.24, 0.09, 1.0), roughness=0.84),
        "soil": material("M_FURN_Shared_Soil", (0.09, 0.035, 0.015, 1.0), roughness=0.92),
    }


def root_object(family: dict, tier_index: int) -> bpy.types.Object:
    tier = TIERS[tier_index]
    root = bpy.data.objects.new(f"FURN_{family['modelFamily']}_{tier}", None)
    bpy.context.collection.objects.link(root)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.12
    root["asset_id"] = family["tiers"][tier_index]["skuId"]
    root["family_id"] = family["familyId"]
    root["model_family"] = family["modelFamily"]
    root["tier"] = tier
    root["brand_tier"] = TIER_LABELS[tier_index]
    root["quality"] = family["tiers"][tier_index]["quality"]
    root["category"] = family["category"]
    root["placement_mode"] = family["placementMode"]
    root["dimensions_m"] = [family["dimensionsM"][key] for key in ("width", "depth", "height")]
    root["front"] = "Blender -Y / runtime +Z"
    root["units"] = "meters"
    root["source"] = "Original deterministic Blender Python geometry; no external assets"
    root["license"] = "Project-owned / UNLICENSED"
    root["reference_direction"] = "Designs/ClubHouse three-image municipal-to-country-club progression"
    return root


def parent(obj: bpy.types.Object, root: bpy.types.Object) -> bpy.types.Object:
    obj.parent = root
    return obj


def apply_mesh_transform(obj: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.select_set(False)


def box(name: str, dims: tuple[float, float, float], loc: tuple[float, float, float], mat: bpy.types.Material,
        root: bpy.types.Object, tier_index: int, *, bevel: float | None = None,
        rotation=(0.0, 0.0, 0.0)) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = f"MESH_{name}"
    obj.dimensions = tuple(max(0.003, value) for value in dims)
    apply_mesh_transform(obj)
    obj.data.materials.append(mat)
    amount = TIER_BEVEL[tier_index] if bevel is None else bevel
    amount = min(amount, min(dims) * 0.16)
    if amount > 0.001:
        mod = obj.modifiers.new("Bevel_ReadableEdges", "BEVEL")
        mod.width = amount
        mod.segments = 2 if tier_index >= 2 else 1
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        obj.select_set(False)
    return parent(obj, root)


def torus(name: str, major_radius: float, minor_radius: float, loc: tuple[float, float, float],
          mat: bpy.types.Material, root: bpy.types.Object, tier_index: int) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=max(0.012, major_radius), minor_radius=max(0.004, minor_radius),
        major_segments=16 + tier_index * 4, minor_segments=6 + tier_index,
        location=loc,
    )
    obj = bpy.context.object
    obj.name = f"MESH_{name}"
    apply_mesh_transform(obj)
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return parent(obj, root)


def cylinder(name: str, radius: float, depth: float, loc: tuple[float, float, float], mat: bpy.types.Material,
             root: bpy.types.Object, tier_index: int, rotation=(0.0, 0.0, 0.0), vertices: int | None = None) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices or 12 + tier_index * 4, radius=max(0.004, radius),
                                       depth=max(0.004, depth), location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = f"MESH_{name}"
    apply_mesh_transform(obj)
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = tier_index >= 1 and abs(poly.normal.z) < 0.8
    return parent(obj, root)


def sphere(name: str, scale: tuple[float, float, float], loc: tuple[float, float, float], mat: bpy.types.Material,
           root: bpy.types.Object, tier_index: int) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12 + tier_index * 4, ring_count=8 + tier_index * 2, location=loc)
    obj = bpy.context.object
    obj.name = f"MESH_{name}"
    obj.scale = scale
    apply_mesh_transform(obj)
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return parent(obj, root)


def empty(name: str, loc: tuple[float, float, float], root: bpy.types.Object, **properties) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "ARROWS"
    obj.empty_display_size = 0.09
    obj.location = loc
    for key, value in properties.items():
        obj[key] = value
    return parent(obj, root)


def add_trim(root: bpy.types.Object, mats: dict, tier: int, w: float, d: float, z: float, *, count=1) -> None:
    if tier < 2:
        return
    thickness = min(0.022, d * 0.12)
    for index in range(count):
        inset = (index + 1) * 0.035
        box(f"TierTrim_{index+1:02d}", (max(0.05, w - inset * 2), thickness, 0.018),
            (0, -d / 2 - 0.002, z - index * 0.032), mats["accent"], root, tier, bevel=0.004)


def make_retail(root, family, tier, mats, w, d, h):
    model = family["modelFamily"]
    post = max(0.025, min(w, d) * 0.055)
    if model == "mannequin":
        cylinder("Pedestal", w * 0.42, h * 0.045, (0, 0, h * 0.023), mats["primary"], root, tier)
        cylinder("LegLeft", w * 0.075, h * 0.47, (-w * 0.12, 0, h * 0.28), mats["secondary"], root, tier)
        cylinder("LegRight", w * 0.075, h * 0.47, (w * 0.12, 0, h * 0.28), mats["secondary"], root, tier)
        sphere("Torso", (w * 0.34, d * 0.30, h * 0.23), (0, 0, h * 0.64), mats["upholstery"], root, tier)
        sphere("Head", (w * 0.15, w * 0.14, h * 0.085), (0, 0, h * 0.91), mats["secondary"], root, tier)
        return
    if model in {"display-table", "feature-gondola"}:
        box("DisplayTop", (w, d, h * 0.10), (0, 0, h * 0.90), mats["secondary"], root, tier)
        for x in (-w * 0.39, w * 0.39):
            for y in (-d * 0.36, d * 0.36):
                box("Leg", (post, post, h * 0.82), (x, y, h * 0.43), mats["primary"], root, tier)
        if tier >= 1:
            box("LowerShelf", (w * 0.83, d * 0.72, h * 0.055), (0, 0, h * 0.25), mats["secondary"], root, tier)
        add_trim(root, mats, tier, w * 0.86, d, h * 0.94, count=1 + (tier >= 4))
        return
    if model in {"cap-display", "bag-display", "putter-display"}:
        box("WeightedBase", (w * 0.75, d * 0.76, h * 0.055), (0, 0, h * 0.03), mats["primary"], root, tier)
        cylinder("CenterPost", post * 0.8, h * 0.78, (0, 0, h * 0.43), mats["accent"], root, tier)
        levels = 2 + min(3, tier)
        for level in range(levels):
            z = h * (0.34 + level * 0.12)
            box(f"DisplayArm_{level:02d}", (w * 0.72, post * 0.75, post * 0.75), (0, 0, z), mats["secondary"], root, tier)
        if model == "bag-display":
            for x in (-w * 0.26, w * 0.26):
                cylinder("BagCradle", d * 0.18, post, (x, 0, h * 0.16), mats["accent"], root, tier)
        return
    # Racks, retail walls and shelving share a strong commercial carcass; shelf
    # count, backing, lighting and crown detail communicate the five stages.
    box("FootLeft", (w * 0.44, d * 0.16, post), (-w * 0.27, 0, post / 2), mats["primary"], root, tier)
    box("FootRight", (w * 0.44, d * 0.16, post), (w * 0.27, 0, post / 2), mats["primary"], root, tier)
    for x in (-w * 0.43, w * 0.43):
        box("Upright", (post, post, h * 0.88), (x, d * 0.18, h * 0.47), mats["primary"], root, tier)
    shelf_count = 1 if model in {"apparel-rack", "club-rack"} else 2 + min(2, tier)
    for index in range(shelf_count):
        z = h * (0.25 + (0.58 / max(1, shelf_count - 1)) * index) if shelf_count > 1 else h * 0.78
        box(f"Shelf_{index+1:02d}", (w * 0.88, d * 0.68, post), (0, 0, z), mats["secondary"], root, tier)
    if model in {"apparel-rack", "club-rack"}:
        cylinder("HangingRail", post * 0.46, w * 0.86, (0, -d * 0.10, h * 0.76), mats["accent"], root, tier,
                 rotation=(0, math.pi / 2, 0))
    if tier >= 2:
        box("BackPanel", (w * 0.86, max(0.018, d * 0.055), h * 0.80), (0, d * 0.30, h * 0.48), mats["primary"], root, tier)
    if tier >= 3:
        box("Crown", (w, d * 0.28, h * 0.055), (0, d * 0.18, h * 0.965), mats["accent"], root, tier)
    if tier >= 4 and model in {"apparel-rack", "club-rack"}:
        box("BuiltInPlinth", (w, d * 0.78, h * 0.075), (0, d * 0.04, h * 0.055), mats["secondary"], root, tier)
        for x in (-w * 0.465, w * 0.465):
            box("BuiltInSide", (w * 0.07, d * 0.82, h * 0.90), (x, d * 0.04, h * 0.50), mats["secondary"], root, tier)
        box("IntegratedLightValance", (w * 0.76, d * 0.055, h * 0.035),
            (0, -d * 0.29, h * 0.89), mats["light"], root, tier, bevel=0.003)
        for x in (-w * 0.22, w * 0.22):
            box("LowerDrawer", (w * 0.38, d * 0.055, h * 0.13),
                (x, -d * 0.31, h * 0.16), mats["secondary"], root, tier)
    add_trim(root, mats, tier, w * 0.85, d, h * 0.91, count=1 + (tier >= 4))


def make_counter(root, family, tier, mats, w, d, h):
    model = family["modelFamily"]
    box("Carcass", (w * 0.94, d * 0.86, h * 0.78), (0, d * 0.02, h * 0.39), mats["primary"], root, tier)
    box("Worktop", (w, d, h * 0.10), (0, 0, h * 0.86), mats["secondary"], root, tier)
    front_y = -d * 0.44
    panels = 2 + (tier >= 2)
    for index in range(panels):
        panel_w = w * 0.82 / panels
        x = -w * 0.41 + panel_w * (index + 0.5)
        box(f"FrontPanel_{index+1:02d}", (panel_w * 0.88, d * 0.035, h * 0.57),
            (x, front_y, h * 0.43), mats["secondary"], root, tier)
    if model in {"office-desk", "back-counter"}:
        pivot = empty("PIVOT_Drawer", (w * 0.25, front_y, h * 0.62), root, motion="drawer +Y/-Y")
        drawer = box("DrawerFront", (w * 0.31, d * 0.04, h * 0.14), (0, 0, 0), mats["secondary"], pivot, tier)
        drawer["moving_component"] = True
    if tier >= 3:
        box("ServiceScreen", (w * 0.34, d * 0.055, h * 0.15), (0, -d * 0.505, h * 0.60), mats["green" if "green" in mats else "primary"], root, tier)
    add_trim(root, mats, tier, w * 0.90, d, h * 0.74, count=1 + (tier >= 4))


def make_seating(root, family, tier, mats, w, d, h):
    model = family["modelFamily"]
    sofa = model == "lounge-sofa"
    stool = model == "bar-stool"
    bench = model in {"bench", "storage-bench"}
    seat_z = h * (0.54 if stool else 0.44)
    seat_w = w * 0.88
    box("SeatFrame", (seat_w, d * 0.72, h * 0.10), (0, 0, seat_z), mats["primary"], root, tier)
    box("SeatCushion", (seat_w * 0.94, d * 0.70, h * 0.12), (0, -d * 0.02, seat_z + h * 0.09), mats["upholstery"], root, tier)
    leg_h = seat_z - h * 0.04
    for x in (-seat_w * 0.40, seat_w * 0.40):
        for y in (-d * 0.26, d * 0.26):
            cylinder("Leg", max(0.018, w * 0.025), leg_h, (x, y, leg_h / 2), mats["primary"], root, tier)
    if not stool:
        box("BackFrame", (seat_w, h * 0.10, h * 0.46), (0, d * 0.28, h * 0.73), mats["primary"], root, tier)
        box("BackCushion", (seat_w * 0.92, h * 0.12, h * 0.35), (0, d * 0.21, h * 0.73), mats["upholstery"], root, tier)
    if (tier >= 1 and not stool) or sofa:
        for x in (-seat_w * 0.48, seat_w * 0.48):
            box("Arm", (w * 0.075, d * 0.78, h * 0.19), (x, 0, seat_z + h * 0.17), mats["primary"], root, tier)
    if sofa:
        for x in (-seat_w * 0.25, seat_w * 0.25):
            box("CushionSeam", (0.012, d * 0.62, h * 0.12), (x, -d * 0.03, seat_z + h * 0.095), mats["accent"], root, tier, bevel=0.002)
    if bench and tier >= 3:
        add_trim(root, mats, tier, seat_w, d, seat_z + h * 0.08)


def make_table(root, family, tier, mats, w, d, h):
    top_h = max(0.045, h * 0.10)
    box("Top", (w, d, top_h), (0, 0, h - top_h / 2), mats["secondary"], root, tier)
    if family["modelFamily"] == "side-table" or tier >= 3:
        cylinder("Pedestal", min(w, d) * 0.10, h * 0.72, (0, 0, h * 0.43), mats["primary"], root, tier)
        cylinder("PedestalFoot", min(w, d) * 0.40, top_h, (0, 0, top_h / 2), mats["primary"], root, tier)
    else:
        leg = max(0.035, min(w, d) * 0.07)
        for x in (-w * 0.39, w * 0.39):
            for y in (-d * 0.36, d * 0.36):
                box("Leg", (leg, leg, h - top_h), (x, y, (h - top_h) / 2), mats["primary"], root, tier)
    if tier >= 2:
        box("ApronFront", (w * 0.82, d * 0.05, h * 0.10), (0, -d * 0.43, h * 0.84), mats["accent"], root, tier)
    add_trim(root, mats, tier, w * 0.84, d, h - top_h * 0.35, count=1 + (tier >= 4))


def make_storage(root, family, tier, mats, w, d, h):
    model = family["modelFamily"]
    if model == "stock-shelving":
        post = max(0.025, w * 0.035)
        for x in (-w * 0.44, w * 0.44):
            for y in (-d * 0.38, d * 0.38):
                box("Post", (post, post, h * 0.94), (x, y, h * 0.49), mats["primary"], root, tier)
        for index in range(4 + (tier >= 3)):
            z = h * (0.08 + index * (0.78 / (3 + (tier >= 3))))
            box(f"Shelf_{index+1:02d}", (w * 0.94, d * 0.90, h * 0.035), (0, 0, z), mats["secondary"], root, tier)
        return
    if model == "storage-bench":
        make_seating(root, family, tier, mats, w, d, h)
        box("StorageBox", (w * 0.80, d * 0.66, h * 0.31), (0, 0, h * 0.22), mats["secondary"], root, tier)
        return
    box("CabinetCarcass", (w, d, h), (0, 0, h / 2), mats["primary"], root, tier)
    columns = 2 if model in {"member-locker", "storage-cabinet"} else 1
    for index in range(columns):
        panel_w = w * 0.90 / columns
        hinge_x = -w * 0.45 + panel_w * index
        pivot = empty(f"PIVOT_Door_{index+1:02d}", (hinge_x, -d * 0.505, h * 0.52), root, motion="hinge around local Z")
        door = box(f"Door_{index+1:02d}", (panel_w * 0.94, d * 0.035, h * 0.86),
                   (panel_w * 0.47, 0, 0), mats["secondary"], pivot, tier)
        door["moving_component"] = True
        cylinder("Handle", max(0.008, w * 0.012), h * 0.10,
                 (panel_w * 0.84, -d * 0.04, 0), mats["accent"], pivot, tier)
    if tier >= 3:
        box("Crown", (w * 1.03, d * 1.02, h * 0.045), (0, 0, h * 0.978), mats["accent"], root, tier)


def make_lighting(root, family, tier, mats, w, d, h):
    model = family["modelFamily"]
    if model in {"floor-lamp", "desk-lamp"}:
        base_r = min(w, d) * 0.33
        cylinder("Base", base_r, h * 0.055, (0, 0, h * 0.028), mats["primary"], root, tier)
        cylinder("Stem", max(0.008, base_r * 0.10), h * 0.72, (0, 0, h * 0.40), mats["accent"], root, tier)
        cylinder("Shade", min(w, d) * 0.40, h * 0.25, (0, 0, h * 0.82), mats["secondary"], root, tier, vertices=16)
        sphere("BulbGlow", (w * 0.12, d * 0.12, h * 0.10), (0, 0, h * 0.76), mats["light"], root, tier)
        return
    if model in {"wall-sconce", "picture-light"}:
        box("WallPlate", (w * 0.42, d * 0.22, h * 0.56), (0, d * 0.37, h * 0.55), mats["primary"], root, tier)
        box("Arm", (w * 0.10, d * 0.55, h * 0.09), (0, 0, h * 0.58), mats["accent"], root, tier)
        cylinder("Shade", w * 0.28, h * 0.24, (0, -d * 0.28, h * 0.48), mats["secondary"], root, tier, vertices=16)
        return
    if model == "track-light":
        box("Track", (w * 0.94, d * 0.18, h * 0.12), (0, 0, h * 0.90), mats["primary"], root, tier)
        for index in range(2 + tier // 2):
            x = (-0.32 + index * (0.64 / max(1, 1 + tier // 2))) * w
            cylinder("Spot", d * 0.18, h * 0.35, (x, 0, h * 0.55), mats["accent"], root, tier, vertices=16)
        return
    # Ceiling lights and chandeliers mount at their authored top socket.
    cylinder("CeilingCanopy", min(w, d) * 0.30, h * 0.10, (0, 0, h * 0.95), mats["primary"], root, tier)
    drop = h * (0.46 if model in {"pendant-light", "chandelier"} else 0.18)
    cylinder("Drop", max(0.008, w * 0.025), drop, (0, 0, h - drop * 0.62), mats["accent"], root, tier)
    if model == "chandelier":
        ring_z = h * 0.46
        torus("HeritageRing", w * 0.36, max(0.012, w * 0.025), (0, 0, ring_z), mats["accent"], root, tier)
        if tier >= 2:
            torus("UpperRing", w * 0.19, max(0.010, w * 0.018), (0, 0, h * 0.64), mats["accent"], root, tier)
        arms = 4 + tier
        for index in range(arms):
            angle = index / arms * math.tau
            x, y = math.cos(angle) * w * 0.34, math.sin(angle) * d * 0.34
            stem_h = h * (0.18 + tier * 0.012)
            cylinder("CandleStem", max(0.008, w * 0.012), stem_h,
                     (x, y, ring_z - stem_h * 0.52), mats["accent"], root, tier)
            cylinder("CandleCup", w * 0.045, h * 0.025,
                     (x, y, ring_z - stem_h), mats["accent"], root, tier, vertices=16)
            sphere("Lamp", (w * 0.050, d * 0.050, h * 0.050),
                   (x, y, ring_z - stem_h - h * 0.045), mats["light"], root, tier)
        sphere("Finial", (w * 0.055, d * 0.055, h * 0.065),
               (0, 0, ring_z - h * 0.13), mats["accent"], root, tier)
    else:
        cylinder("Shade", min(w, d) * 0.44, h * 0.36, (0, 0, h * 0.34), mats["secondary"], root, tier, vertices=20)
        sphere("Lamp", (w * 0.20, d * 0.20, h * 0.16), (0, 0, h * 0.26), mats["light"], root, tier)


def make_architecture(root, family, tier, mats, w, d, h):
    model = family["modelFamily"]
    if model in {"interior-door", "exterior-door"}:
        frame = max(0.035, w * 0.07)
        box("FrameTop", (w, d, frame), (0, 0, h - frame / 2), mats["primary"], root, tier)
        for x in (-w / 2 + frame / 2, w / 2 - frame / 2):
            box("FrameSide", (frame, d, h), (x, 0, h / 2), mats["primary"], root, tier)
        pivot = empty("PIVOT_Door", (-w / 2 + frame, -d * 0.02, 0), root, motion="hinge around local Z")
        door = box("DoorLeaf", (w - frame * 2.3, d * 0.62, h - frame * 1.5),
                   ((w - frame * 2.3) / 2, 0, (h - frame * 1.5) / 2), mats["secondary"], pivot, tier)
        door["moving_component"] = True
        cylinder("Handle", frame * 0.15, d * 0.86, (w * 0.34, -d * 0.05, h * 0.51), mats["accent"], pivot, tier,
                 rotation=(math.pi / 2, 0, 0))
        if tier >= 2:
            box("GlazedPanel", (w * 0.40, d * 0.10, h * 0.32), (w * 0.45, -d * 0.34, h * 0.66), mats["glass"], pivot, tier)
        return
    if model in {"flooring", "ceiling-treatment"}:
        base_h = h * 0.64
        detail_h = h - base_h
        box("FinishBase", (w, d, base_h), (0, 0, base_h / 2), mats["primary"], root, tier,
            bevel=min(0.006, h * 0.08))
        detail_z = base_h + detail_h / 2
        if model == "flooring" and tier >= 4:
            # Repeated paired chevrons fill the sample rather than reading as a
            # small logo sitting on an otherwise plain board.
            for row in range(-3, 4):
                for column in range(-2, 3):
                    y = (row + (0.5 if column % 2 else 0.0)) * d * 0.13
                    center_x = column * w * 0.18
                    for side in (-1, 1):
                        x = center_x + side * w * 0.065
                        box("HerringbonePlank", (w * 0.22, d * 0.055, detail_h),
                            (x, y, detail_z), mats["secondary" if (row + column) % 2 else "accent"], root, tier,
                            bevel=0.0015, rotation=(0, 0, side * math.radians(43)))
        elif model == "flooring" and tier == 3:
            for row in range(-3, 4):
                box("WalnutPlank", (w * 0.92, d * 0.095, detail_h),
                    (0, row * d * 0.13, detail_z), mats["secondary" if row % 2 else "accent"], root, tier,
                    bevel=0.0015)
        else:
            lines = 2 + tier
            for index in range(lines):
                at = -w * 0.38 + index * (w * 0.76 / max(1, lines - 1))
                box("FinishJoint", (max(0.008, w * 0.018), d * 0.92, detail_h),
                    (at, 0, detail_z), mats["secondary" if index % 2 else "accent"], root, tier, bevel=0.001)
                if model == "ceiling-treatment" and tier >= 2:
                    box("CofferJoint", (w * 0.92, max(0.008, d * 0.018), detail_h),
                        (0, at * d / w, detail_z), mats["secondary"], root, tier, bevel=0.001)
        return
    # Installed window and wall finish samples stand at believable architectural
    # proportions, with all relief inside the declared envelope.
    box("FinishBase", (w, d * 0.52, h), (0, d * 0.20, h / 2), mats["primary"], root, tier,
        bevel=min(0.006, d * 0.08))
    strips = 4 + tier
    for index in range(strips):
        x = -w * 0.43 + index * (w * 0.86 / max(1, strips - 1))
        width = w * (0.16 if model == "window-treatment" else 0.115)
        box(f"FinishPanel_{index+1:02d}", (width, d * 0.24, h * 0.88),
            (x, -d * 0.13, h * 0.50), mats["secondary" if index % 2 else "accent"], root, tier,
            bevel=0.002)
    if model == "wall-paneling" and tier >= 2:
        for z in (h * 0.12, h * 0.52, h * 0.90):
            box("PanelRail", (w * 0.94, d * 0.18, h * 0.025), (0, -d * 0.18, z), mats["accent"], root, tier,
                bevel=0.002)


def make_decor(root, family, tier, mats, w, d, h):
    model = family["modelFamily"]
    if model == "plant":
        cylinder("Planter", w * 0.34, h * 0.31, (0, 0, h * 0.16), mats["secondary"], root, tier, vertices=16)
        cylinder("Soil", w * 0.29, h * 0.03, (0, 0, h * 0.31), mats["soil"], root, tier, vertices=16)
        cylinder("Stem", w * 0.035, h * 0.51, (0, 0, h * 0.56), mats["primary"], root, tier)
        leaves = 5 + tier
        for index in range(leaves):
            angle = index / leaves * math.tau
            sphere("Leaf", (w * 0.10, d * 0.25, h * 0.14),
                   (math.cos(angle) * w * 0.20, math.sin(angle) * d * 0.17, h * (0.58 + 0.055 * (index % 3))),
                   mats["leaf"], root, tier)
        return
    if model == "trophy-case":
        make_storage(root, family, tier, mats, w, d, h)
        box("DisplayGlass", (w * 0.84, d * 0.04, h * 0.52), (0, -d * 0.51, h * 0.63), mats["glass"], root, tier)
        return
    if model == "area-rug":
        box("Rug", (w, d, h), (0, 0, h / 2), mats["upholstery"], root, tier, bevel=min(0.004, h * 0.18))
        box("RugInset", (w * 0.84, d * 0.78, h * 0.18), (0, 0, h * 1.01), mats["accent"], root, tier, bevel=0.001)
        return
    if model == "clock":
        cylinder("ClockFrame", w * 0.48, d * 0.80, (0, 0, h * 0.50), mats["primary"], root, tier,
                 rotation=(math.pi / 2, 0, 0), vertices=24)
        cylinder("ClockFace", w * 0.40, d * 0.12, (0, -d * 0.43, h * 0.50), mats["cream" if "cream" in mats else "secondary"], root, tier,
                 rotation=(math.pi / 2, 0, 0), vertices=24)
        return
    # Wall art, mirror and signage are framed authored panels.
    box("Frame", (w, d, h), (0, 0, h / 2), mats["primary"], root, tier)
    inset_mat = mats["glass"] if model == "mirror" else mats["secondary"]
    box("Inset", (w * 0.84, d * 0.18, h * 0.82), (0, -d * 0.43, h * 0.51), inset_mat, root, tier, bevel=0.003)
    if tier >= 3:
        add_trim(root, mats, tier, w * 0.78, d, h * 0.87, count=1 + (tier >= 4))


def make_guest(root, family, tier, mats, w, d, h):
    model = family["modelFamily"]
    if model == "restroom-stall":
        for x in (-w * 0.46, w * 0.46):
            box("Partition", (w * 0.08, d, h), (x, 0, h / 2), mats["primary"], root, tier)
        pivot = empty("PIVOT_StallDoor", (-w * 0.40, -d * 0.48, 0), root, motion="hinge around local Z")
        door = box("StallDoor", (w * 0.80, d * 0.05, h * 0.84), (w * 0.40, 0, h * 0.48), mats["secondary"], pivot, tier)
        door["moving_component"] = True
        return
    box("FacilityCarcass", (w * 0.94, d * 0.84, h * 0.62), (0, d * 0.06, h * 0.31), mats["primary"], root, tier)
    box("Countertop", (w, d, h * 0.09), (0, 0, h * 0.66), mats["secondary"], root, tier)
    if model == "restroom-vanity":
        cylinder("Basin", w * 0.25, h * 0.07, (0, -d * 0.06, h * 0.70), mats["cream" if "cream" in mats else "secondary"], root, tier)
        cylinder("Tap", w * 0.035, h * 0.23, (0, d * 0.15, h * 0.82), mats["accent"], root, tier)
    elif model == "hydration-station":
        cylinder("Reservoir", w * 0.25, h * 0.42, (0, 0, h * 0.84), mats["glass"], root, tier)
        cylinder("Spout", w * 0.025, d * 0.30, (0, -d * 0.38, h * 0.72), mats["accent"], root, tier, rotation=(math.pi / 2, 0, 0))
    else:
        for index in range(3 + tier // 2):
            box("FoldedTowel", (w * 0.70, d * 0.55, h * 0.055), (0, -d * 0.05, h * (0.74 + index * 0.06)), mats["cream" if "cream" in mats else "secondary"], root, tier)


def make_operations(root, family, tier, mats, w, d, h):
    model = family["modelFamily"]
    if model == "golf-cart":
        wheel_r = min(w * 0.16, h * 0.15)
        for x in (-w * 0.42, w * 0.42):
            for y in (-d * 0.34, d * 0.34):
                cylinder("Wheel", wheel_r, w * 0.10, (x, y, wheel_r), mats["charcoal" if "charcoal" in mats else "primary"], root, tier,
                         rotation=(0, math.pi / 2, 0), vertices=20)
        box("Chassis", (w * 0.88, d * 0.78, h * 0.14), (0, 0, h * 0.25), mats["primary"], root, tier)
        box("SeatBase", (w * 0.78, d * 0.35, h * 0.12), (0, d * 0.10, h * 0.50), mats["secondary"], root, tier)
        box("SeatCushion", (w * 0.76, d * 0.31, h * 0.10), (0, d * 0.07, h * 0.59), mats["upholstery"], root, tier)
        for x in (-w * 0.41, w * 0.41):
            box("RoofPost", (w * 0.045, d * 0.045, h * 0.68), (x, 0, h * 0.91), mats["accent"], root, tier)
        box("Canopy", (w, d * 0.84, h * 0.08), (0, 0, h * 0.97), mats["secondary"], root, tier)
        cylinder("SteeringColumn", w * 0.022, h * 0.32, (-w * 0.26, -d * 0.15, h * 0.56), mats["accent"], root, tier, rotation=(math.radians(18), 0, 0))
        cylinder("SteeringWheel", w * 0.13, w * 0.025, (-w * 0.26, -d * 0.21, h * 0.72), mats["primary"], root, tier, rotation=(math.pi / 2, 0, 0), vertices=20)
        return
    if model == "cart-storage":
        for x in (-w * 0.46, w * 0.46):
            for y in (-d * 0.46, d * 0.46):
                box("ShelterPost", (w * 0.045, d * 0.045, h * 0.90), (x, y, h * 0.45), mats["primary"], root, tier)
        box("ShelterRoof", (w, d, h * 0.10), (0, 0, h * 0.94), mats["secondary"], root, tier)
        if tier >= 2:
            box("ChargingRail", (w * 0.75, d * 0.08, h * 0.10), (0, d * 0.43, h * 0.42), mats["accent"], root, tier)
        return
    if model == "patio-set":
        make_table(root, family, tier, mats, w * 0.55, d * 0.55, h * 0.72)
        for x in (-w * 0.37, w * 0.37):
            box("PatioSeat", (w * 0.18, d * 0.36, h * 0.08), (x, 0, h * 0.36), mats["secondary"], root, tier)
            box("PatioBack", (w * 0.18, d * 0.06, h * 0.34), (x, d * 0.15, h * 0.53), mats["upholstery"], root, tier)
        return
    if model == "porch-bench":
        make_seating(root, family, tier, mats, w, d, h)
        return
    # Waste station.
    box("WasteCarcass", (w * 0.82, d * 0.78, h * 0.82), (0, 0, h * 0.41), mats["primary"], root, tier)
    cylinder("Opening", w * 0.20, d * 0.08, (0, -d * 0.42, h * 0.66), mats["charcoal" if "charcoal" in mats else "accent"], root, tier,
             rotation=(math.pi / 2, 0, 0), vertices=20)
    if tier >= 2:
        box("SortingDivider", (w * 0.04, d * 0.70, h * 0.74), (0, 0, h * 0.39), mats["accent"], root, tier)


def add_collision_and_sockets(root, family, w, d, h):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, h / 2))
    collision = bpy.context.object
    collision.name = f"COL_{family['modelFamily']}"
    collision.dimensions = (w, d, h)
    apply_mesh_transform(collision)
    collision.display_type = "WIRE"
    collision.color = (1.0, 0.15, 0.05, 1.0)
    collision["collision_type"] = "simple_box"
    parent(collision, root)
    mode = family["placementMode"]
    if mode == "wall":
        empty("SOCKET_WallMount", (0, d / 2, h / 2), root, contract="back center flush to wall")
    elif mode == "ceiling":
        empty("SOCKET_CeilingMount", (0, 0, h), root, contract="top center flush to ceiling")
    else:
        empty("SOCKET_PLACEMENT", (0, 0, 0), root, contract="finished floor or parent surface")
        if family["modelFamily"] == "area-rug":
            empty("SOCKET_FloorPlacement", (0, 0, 0), root, contract="top of finished floor")
    return collision


def build_variant(family: dict, tier: int) -> tuple[bpy.types.Object, bpy.types.Object]:
    dims = family["dimensionsM"]
    w, d, h = dims["width"], dims["depth"], dims["height"]
    root = root_object(family, tier)
    mats = tier_materials(tier)
    # Convenience aliases are local only; material datablock names remain stable.
    mats["cream"] = material("M_FURN_Shared_Cream", PALETTE["cream"], roughness=0.70)
    mats["charcoal"] = material("M_FURN_Shared_Charcoal", PALETTE["charcoal"], roughness=0.58, metallic=0.25)
    category = family["category"]
    if category == "retail-displays":
        make_retail(root, family, tier, mats, w, d, h)
    elif category == "counters-desks":
        make_counter(root, family, tier, mats, w, d, h)
    elif category == "seating":
        make_seating(root, family, tier, mats, w, d, h)
    elif category == "tables":
        make_table(root, family, tier, mats, w, d, h)
    elif category == "storage":
        make_storage(root, family, tier, mats, w, d, h)
    elif category == "lighting":
        make_lighting(root, family, tier, mats, w, d, h)
    elif category == "architectural":
        make_architecture(root, family, tier, mats, w, d, h)
    elif category == "decor":
        make_decor(root, family, tier, mats, w, d, h)
    elif category == "guest-facilities":
        make_guest(root, family, tier, mats, w, d, h)
    else:
        make_operations(root, family, tier, mats, w, d, h)
    collision = add_collision_and_sockets(root, family, w, d, h)
    return root, collision


def recursive_objects(root: bpy.types.Object) -> list[bpy.types.Object]:
    result = [root]
    stack = list(root.children)
    while stack:
        obj = stack.pop()
        result.append(obj)
        stack.extend(obj.children)
    return result


def export_root(root: bpy.types.Object, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in recursive_objects(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True,
        export_yup=True, export_apply=True, export_extras=True,
        export_animations=False, export_cameras=False, export_lights=False,
        export_materials="EXPORT", export_image_format="AUTO",
    )
    bpy.ops.object.select_all(action="DESELECT")


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_thumbnail_scene() -> tuple[bpy.types.Object, bpy.types.Object]:
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        # Blender 5.1's API keeps the legacy enum even though the renderer is
        # the current Eevee implementation.
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 320
    scene.render.resolution_y = 180
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.color = (0.035, 0.055, 0.040)
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.name = "THUMBNAIL_Camera"
    camera.data.lens = 50
    scene.camera = camera
    bpy.ops.object.light_add(type="AREA", location=(-2.8, -3.6, 4.8))
    key = bpy.context.object
    key.name = "THUMBNAIL_Key"
    key.data.energy = 850
    key.data.shape = "DISK"
    key.data.size = 4.0
    bpy.ops.object.light_add(type="AREA", location=(3.4, -1.0, 2.8))
    fill = bpy.context.object
    fill.name = "THUMBNAIL_Fill"
    fill.data.energy = 520
    fill.data.size = 3.0
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, -0.003))
    floor = bpy.context.object
    floor.name = "THUMBNAIL_Ground"
    floor.data.materials.append(material("M_THUMBNAIL_Ground", (0.060, 0.090, 0.067, 1.0), roughness=0.92))
    return camera, floor


def render_thumbnail(root, collision, family, tier, camera, path: Path) -> None:
    dims = family["dimensionsM"]
    w, d, h = dims["width"], dims["depth"], dims["height"]
    radius = math.sqrt(w * w + d * d + h * h)
    target = Vector((0, 0, h * 0.48))
    if h < 0.14:
        camera.location = (radius * 0.72, -radius * 2.05, radius * 0.95)
        target.z = h * 0.20
    elif family["placementMode"] in {"wall", "ceiling"}:
        camera.location = (radius * 0.78, -radius * 2.35, h * 0.52 + radius * 0.58)
    else:
        camera.location = (radius * 0.76, -radius * 2.30, h * 0.50 + radius * 0.52)
    look_at(camera, target)
    collision.hide_render = True
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    collision.hide_render = False


def save_family_source(family: dict, roots: Iterable[bpy.types.Object]) -> None:
    for root in roots:
        for obj in recursive_objects(root):
            obj.hide_render = False
            obj.hide_viewport = False
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    path = SOURCE_DIR / f"{family['modelFamily']}_five_tiers.blend"
    bpy.context.scene["source"] = "Original project-owned deterministic Blender Python"
    bpy.context.scene["license"] = "Project-owned / UNLICENSED"
    bpy.context.scene["family_id"] = family["familyId"]
    bpy.context.scene["generator"] = "tools/blender/build_furniture_catalog.py"
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True, check_existing=False)


def build_family(family: dict, *, thumbnails: bool, save_source: bool) -> dict:
    reset_scene()
    camera, _floor = setup_thumbnail_scene() if thumbnails else (None, None)
    roots = []
    exports = []
    for tier_index, tier_row in enumerate(family["tiers"]):
        root, collision = build_variant(family, tier_index)
        glb_path = REPO / tier_row["glb"]
        export_root(root, glb_path)
        if thumbnails:
            render_thumbnail(root, collision, family, tier_index, camera, REPO / tier_row["thumbnail"])
        # Arrange the editable family source as a five-stage showroom after the
        # origin-centered runtime export and isolated thumbnail are complete.
        root.location.x = (tier_index - 2) * max(1.2, family["dimensionsM"]["width"] * 1.32)
        for obj in recursive_objects(root):
            # Free every per-file contract name before building the next tier.
            # The GLB was already exported with exact names; the prefix only
            # distinguishes objects in the combined five-tier editable source.
            if obj is not root:
                obj.name = f"SOURCE_{tier_row['id']}_{obj.name}"
            obj.hide_render = True
        roots.append(root)
        exports.append(str(glb_path.relative_to(REPO)).replace("\\", "/"))
    if save_source:
        save_family_source(family, roots)
    return {"family": family["familyId"], "exports": exports, "thumbnails": thumbnails}


def main() -> None:
    args = parse_args()
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    families = manifest["families"]
    if args.family:
        families = [family for family in families if args.family in {family["familyId"], family["modelFamily"]}]
        if not families:
            raise SystemExit(f"unknown furniture family: {args.family}")
    reports = []
    for index, family in enumerate(families, start=1):
        print(f"FURNITURE_BUILD {index}/{len(families)} {family['familyId']}", flush=True)
        reports.append(build_family(family, thumbnails=args.thumbnails, save_source=not args.no_source))
    report_path = REPO / "qa" / "furniture_catalog" / "blender_build_report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps({
        "schema": 1,
        "manifest": str(MANIFEST_PATH.relative_to(REPO)).replace("\\", "/"),
        "familyCount": len(reports),
        "objectCount": sum(len(report["exports"]) for report in reports),
        "reports": reports,
    }, indent=2) + "\n", encoding="utf-8")
    print(f"FURNITURE_BUILD_COMPLETE {len(reports)} families / {sum(len(r['exports']) for r in reports)} objects", flush=True)


if __name__ == "__main__":
    main()
