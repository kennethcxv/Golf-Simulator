"""Build the five packed, nonretail FIXTURE1 product representations.

Run from the repository root with Blender 5.1+::

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
        --background --factory-startup \
        --python tools/blender/build_nonretail_fixture_products.py

Every asset is authored in metres at 1:1 scale.  Authoring axes are X width,
Y depth (-Y is the package/player-facing front), and Z height; glTF exports to
the runtime X/Y/Z convention of width/height/depth.  The packed envelopes are
the exact values frozen in ``src/data/productPackaging.js``.

The four assets without a repository source are original procedural geometry.
The packed pendant is an original production derivative based on the immutable,
project-owned ``vendor/models/clubhouse/pendant.glb`` silhouette.  That source
is read and hashed for provenance but is never imported, edited, or overwritten.
No downloaded or third-party assets are used.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector


SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[2]
sys.path.insert(0, str(SCRIPT.parent))

from build_checkout_assets import (  # noqa: E402
    activate,
    anchor,
    apply_rotation_scale,
    box,
    collision_box,
    cylinder,
    descendants,
    empty,
    finish_mesh,
    mat,
    parent_keep,
    reset_scene,
    torus,
)


SOURCE_DIR = ROOT / "asset_sources" / "blender" / "nonretail_fixture_products"
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
QA_PASS = os.environ.get("NONRETAIL_FIXTURE_ASSET_QA_PASS", "pass-01").strip() or "pass-01"
QA_DIR = ROOT / "qa" / "box_system_master" / "nonretail_fixture_products" / QA_PASS
PENDANT_REFERENCE = ROOT / "vendor" / "models" / "clubhouse" / "pendant.glb"

SOURCE_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
QA_DIR.mkdir(parents=True, exist_ok=True)

BUILD_VERSION = 1


def dims(w: float, d: float, h: float):
    """Return authoring dimensions (X width, Y depth, Z height)."""
    return (w, d, h)


ASSETS = {
    "delivery_fixture_product_vacuum": {
        "logical_sku": "vac1",
        "product_name": "Pinehollow shop vacuum",
        "author_dimensions": dims(0.58, 0.37, 0.36),
        "runtime_dimensions": (0.58, 0.36, 0.37),
        "physical_runtime_dimensions": (0.42, 0.68, 0.38),
        "packing_state": "hose-and-wand-detached-in-moulded-insert",
        "packing_orientation": "motor-base-on-side",
        "placement_fixture": "restoration-bay",
        "unit_weight_lb": 17.0,
        "fragile": False,
        "required": {
            "VAC_MOULDED_INSERT",
            "VAC_MOTOR_CANISTER_SIDE_PACKED",
            "VAC_DETACHED_WAND",
            "VAC_HOSE_COIL",
            "VAC_CREVICE_NOZZLE",
            "VAC_TOP_END_BRACE",
            "VAC_TOP_END_BRACE_NECK",
        },
    },
    "delivery_fixture_product_plant": {
        "logical_sku": "plant1",
        "product_name": "Pinehollow potted plant",
        "author_dimensions": dims(0.34, 0.34, 0.28),
        "runtime_dimensions": (0.34, 0.28, 0.34),
        "physical_runtime_dimensions": (0.35, 0.65, 0.35),
        "packing_state": "crown-netted-and-pot-braced",
        "packing_orientation": "pot-upright",
        "placement_fixture": "decor-floor",
        "unit_weight_lb": 9.0,
        "fragile": False,
        "required": {
            "PLANT_POT",
            "PLANT_CROWN_COMPRESSED",
            "PLANT_CROWN_NET",
            "PLANT_POT_BRACE_RING",
            "PLANT_MOULDED_INSERT",
        },
    },
    "delivery_fixture_product_poster": {
        "logical_sku": "poster1",
        "product_name": "Pinehollow course poster",
        "author_dimensions": dims(0.56, 0.37, 0.07),
        "runtime_dimensions": (0.56, 0.07, 0.37),
        "physical_runtime_dimensions": (0.52, 0.04, 0.36),
        "packing_state": "framed-face-protected-with-corner-blocks",
        "packing_orientation": "frame-on-edge",
        "placement_fixture": "decor-wall",
        "unit_weight_lb": 2.5,
        "fragile": True,
        "required": {
            "POSTER_FRAME",
            "POSTER_COURSE_ART",
            "POSTER_FACE_PROTECTOR",
            "POSTER_CORNER_PROTECTOR_NW",
            "POSTER_CORNER_PROTECTOR_NE",
            "POSTER_CORNER_PROTECTOR_SW",
            "POSTER_CORNER_PROTECTOR_SE",
        },
    },
    "delivery_fixture_product_events_board": {
        "logical_sku": "board1",
        "product_name": "Pinehollow events board",
        "author_dimensions": dims(0.58, 0.36, 0.10),
        "runtime_dimensions": (0.58, 0.10, 0.36),
        "physical_runtime_dimensions": (0.58, 0.06, 0.42),
        "packing_state": "rail-detached-with-corner-blocks",
        "packing_orientation": "board-on-edge",
        "placement_fixture": "decor-wall",
        "unit_weight_lb": 15.0,
        "fragile": False,
        "required": {
            "EVENTS_BOARD",
            "EVENTS_BOARD_CORK_FACE",
            "BOARD_DETACHED_RAIL",
            "BOARD_CORNER_BLOCK_NW",
            "BOARD_CORNER_BLOCK_NE",
            "BOARD_CORNER_BLOCK_SW",
            "BOARD_CORNER_BLOCK_SE",
        },
    },
    "delivery_fixture_product_pendant": {
        "logical_sku": "light1",
        "product_name": "Pinehollow green pendant light",
        "author_dimensions": dims(0.36, 0.36, 0.32),
        "runtime_dimensions": (0.36, 0.32, 0.36),
        "physical_runtime_dimensions": (0.36, 0.48, 0.36),
        "packing_state": "stem-detached-shade-in-foam-ring",
        "packing_orientation": "shade-upright",
        "placement_fixture": "decor-ceiling",
        "unit_weight_lb": 5.5,
        "fragile": True,
        "required": {
            "PENDANT_SHADE",
            "PENDANT_SHADE_RIM",
            "PENDANT_FOAM_RING",
            "PENDANT_DETACHED_STEM",
            "PENDANT_CEILING_CANOPY",
            "PENDANT_TOP_FOAM_BRACE",
            "PENDANT_STEM_END_CLIP",
        },
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def configure_scene() -> None:
    scene = bpy.context.scene
    scene["asset_build_script"] = SCRIPT.relative_to(ROOT).as_posix()
    scene["asset_build_version"] = BUILD_VERSION
    scene["units"] = "meters"
    scene["external_downloads"] = 0
    scene["raw_sources_modified"] = False
    scene["packed_dimensions_source"] = "src/data/productPackaging.js"


def fixture_materials():
    materials = {
        "cream": mat("M_NonretailWarmCream", (0.91, 0.86, 0.73, 1.0), roughness=0.72),
        "green": mat("M_NonretailDeepGolfGreen", (0.055, 0.22, 0.12, 1.0), roughness=0.52),
        "sage": mat("M_NonretailMutedSage", (0.38, 0.52, 0.40, 1.0), roughness=0.68),
        "sage_dark": mat("M_NonretailDarkSage", (0.22, 0.35, 0.25, 1.0), roughness=0.75),
        "walnut": mat("M_NonretailMediumWalnut", (0.31, 0.19, 0.10, 1.0), roughness=0.57),
        "oak": mat("M_NonretailNaturalOak", (0.66, 0.47, 0.27, 1.0), roughness=0.64),
        "charcoal": mat("M_NonretailWarmCharcoal", (0.055, 0.065, 0.075, 1.0), roughness=0.52),
        "rubber": mat("M_NonretailRubber", (0.025, 0.030, 0.035, 1.0), roughness=0.92),
        "steel": mat("M_NonretailBrushedSteel", (0.48, 0.53, 0.56, 1.0), roughness=0.33, metallic=0.82),
        "brass": mat("M_NonretailRestrainedBrass", (0.58, 0.39, 0.12, 1.0), roughness=0.35, metallic=0.78),
        "kraft": mat("M_NonretailKraftProtector", (0.61, 0.43, 0.25, 1.0), roughness=0.86),
        "foam": mat("M_NonretailMouldedFoam", (0.79, 0.80, 0.70, 1.0), roughness=0.94),
        "terracotta": mat("M_NonretailTerracotta", (0.55, 0.25, 0.12, 1.0), roughness=0.82),
        "leaf": mat("M_NonretailLeafGreen", (0.08, 0.31, 0.13, 1.0), roughness=0.78),
        "leaf_light": mat("M_NonretailLeafSage", (0.29, 0.48, 0.24, 1.0), roughness=0.78),
        "soil": mat("M_NonretailPottingSoil", (0.11, 0.075, 0.04, 1.0), roughness=0.98),
        "cork": mat("M_NonretailCork", (0.55, 0.34, 0.16, 1.0), roughness=0.93),
        "paper": mat("M_NonretailPaper", (0.95, 0.92, 0.82, 1.0), roughness=0.91),
        "blue": mat("M_NonretailCourseWater", (0.17, 0.39, 0.46, 1.0), roughness=0.72),
        "glass": mat("M_NonretailFaceProtector", (0.72, 0.84, 0.79, 0.12), roughness=0.13),
        "net": mat("M_NonretailPlantNet", (0.86, 0.83, 0.68, 0.88), roughness=0.82),
        "collision": mat("M_NonretailCollision", (1.0, 0.0, 1.0, 0.0), roughness=1.0),
    }
    for key in ("glass", "net", "collision"):
        material = materials[key]
        if hasattr(material, "surface_render_method"):
            material.surface_render_method = "DITHERED"
        material.use_transparency_overlap = False
    return materials


def product_root(asset_id: str):
    spec = ASSETS[asset_id]
    if asset_id == "delivery_fixture_product_pendant":
        source = PENDANT_REFERENCE.relative_to(ROOT).as_posix()
        derivation = "original packed derivative informed by immutable project-owned pendant silhouette"
    else:
        source = "Original in-repository procedural Blender geometry; no external source assets"
        derivation = "original packed product representation"
    root = empty(
        asset_id,
        props={
            "asset_id": asset_id,
            "asset_version": BUILD_VERSION,
            "version": BUILD_VERSION,
            "logical_sku": spec["logical_sku"],
            "product_name": spec["product_name"],
            "asset_type": "nonretail_fixture_product_packed",
            "units": "meters",
            "front": "-Y (player-facing package front)",
            "packed_dimensions_author_m": list(spec["author_dimensions"]),
            "runtime_dimensions_m": list(spec["runtime_dimensions"]),
            "physical_dimensions_runtime_m": list(spec["physical_runtime_dimensions"]),
            "packing_state": spec["packing_state"],
            "packing_orientation": spec["packing_orientation"],
            "placement_fixture": spec["placement_fixture"],
            "unit_weight_lb": spec["unit_weight_lb"],
            "fragile": spec["fragile"],
            "content_scale": 1,
            "allow_runtime_scale": False,
            "source": source,
            "derivation": derivation,
            "license": "Project-owned / UNLICENSED",
            "builder": SCRIPT.relative_to(ROOT).as_posix(),
            "external_assets": 0,
        },
        size=0.035,
    )
    if asset_id == "delivery_fixture_product_pendant":
        root["reference_sha256"] = sha256(PENDANT_REFERENCE)
        root["reference_dimensions_author_m"] = [0.1941, 0.1941, 0.4980]
        root["reference_imported_into_build"] = False
    return root


def mark(obj, *, component: str, packing_role: str, separate: bool = True):
    obj["component"] = component
    obj["packing_role"] = packing_role
    obj["separate_component"] = separate
    return obj


def ellipsoid(name, dimensions, location, material, *, parent, component, packing_role):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    finish_mesh(obj, material, bevel_width=0.0)
    parent_keep(obj, parent)
    return mark(obj, component=component, packing_role=packing_role)


def open_cone(name, radius_bottom, radius_top, depth, location, material, *, parent, component, packing_role):
    bpy.ops.mesh.primitive_cone_add(
        vertices=28,
        radius1=radius_bottom,
        radius2=radius_top,
        depth=depth,
        end_fill_type="NOTHING",
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    finish_mesh(obj, material, bevel_width=0.0015)
    parent_keep(obj, parent)
    return mark(obj, component=component, packing_role=packing_role)


def beam_between(name, start, end, radius, material, *, parent, component, packing_role, vertices=14):
    start_v = Vector(start)
    end_v = Vector(end)
    delta = end_v - start_v
    midpoint = (start_v + end_v) * 0.5
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=delta.length,
        location=midpoint,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = delta.to_track_quat("Z", "Y")
    obj.rotation_mode = "XYZ"
    finish_mesh(obj, material, bevel_width=min(radius * 0.28, 0.0015))
    parent_keep(obj, parent)
    return mark(obj, component=component, packing_role=packing_role)


def tube_path(name, points, radius, material, *, parent, component, packing_role):
    curve = bpy.data.curves.new(name + "Curve", type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    curve.resolution_u = 1
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, coordinate in zip(spline.points, points):
        point.co = (*coordinate, 1.0)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    activate(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.name = name
    finish_mesh(obj, material, bevel_width=0.0)
    parent_keep(obj, parent)
    return mark(obj, component=component, packing_role=packing_role)


def add_packing_label(root, materials, prefix: str, author_dimensions):
    width, depth, _height = author_dimensions
    label_z = 0.0205
    label_y = -depth / 2 + 0.042
    backing = box(
        f"{prefix}_PACKING_ID_LABEL",
        (0.125, 0.056, 0.0015),
        (0.0, label_y, label_z),
        materials["paper"],
        bevel=0.001,
        parent=root,
        props={"component": "packing_id_label", "logical_sku": root["logical_sku"]},
    )
    # TAGS (2026-08-06): "hunt every tag/QR reference, delete all." The paper
    # patch stays — a shipping label on a delivery carton is packaging — but it
    # no longer carries a printed code, and its role no longer claims one.
    backing["packing_role"] = "packing_identity_label"
    box(
        f"{prefix}_LABEL_GREEN_BAND",
        (0.025, 0.050, 0.0008),
        (-0.047, label_y, label_z + 0.0010),
        materials["green"],
        bevel=0.0003,
        parent=root,
    )
    # The BARCODE_AREA anchor STAYS. It is an empty, not geometry — a logical
    # surface saying which face of the carton faces a reader — and it draws
    # nothing. What is gone is the eleven charcoal bars that were printed onto
    # this label and rendered on every delivery carton in the shop.
    anchor(
        "BARCODE_AREA",
        (0.012, label_y + 0.002, label_z + 0.002),
        parent=root,
        kind="barcode",
        props={
            "width_m": 0.080,
            "height_m": 0.034,
            "surface": "packing_identity_label",
        },
    )


def add_common_contract(root, materials, asset_id: str):
    spec = ASSETS[asset_id]
    width, depth, height = spec["author_dimensions"]
    add_packing_label(root, materials, spec["logical_sku"].upper(), spec["author_dimensions"])
    collision = collision_box(
        f"COL_{spec['logical_sku'].upper()}_PACKED",
        spec["author_dimensions"],
        (0, 0, height / 2),
        materials,
        parent=root,
    )
    collision["simplified"] = True
    collision["packed_envelope"] = True
    anchor(
        "PICKUP_TARGET",
        (0, -depth * 0.04, max(0.045, height * 0.54)),
        parent=root,
        kind="pickup",
        props={"grip_mode": "fixture-package", "packed_product": True},
    )
    anchor(
        "PLACEMENT_TARGET",
        (0, 0, 0),
        parent=root,
        kind="placement",
        props={
            "fixture_id": spec["placement_fixture"],
            "upright_axis": "+Z",
            "product_front": "-Y",
        },
    )


def build_vacuum(materials):
    asset_id = "delivery_fixture_product_vacuum"
    root = product_root(asset_id)
    insert = box(
        "VAC_MOULDED_INSERT",
        (0.58, 0.37, 0.032),
        (0, 0, 0.016),
        materials["foam"],
        bevel=0.008,
        parent=root,
        props={"component": "moulded_insert", "packing_role": "lower_full-envelope_cradle"},
    )
    insert["recyclable"] = True

    canister = cylinder(
        "VAC_MOTOR_CANISTER_SIDE_PACKED",
        0.115,
        0.285,
        (-0.085, 0.015, 0.168),
        materials["charcoal"],
        rot=(0, math.pi / 2, 0),
        vertices=28,
        bevel=0.004,
        parent=root,
        props={"component": "motor_canister", "packing_role": "motor_base_on_side"},
    )
    canister["unpacked_upright_height_m"] = 0.68
    cylinder(
        "VAC_CANISTER_GREEN_END",
        0.111,
        0.022,
        (-0.228, 0.015, 0.168),
        materials["green"],
        rot=(0, math.pi / 2, 0),
        vertices=28,
        bevel=0.003,
        parent=root,
        props={"component": "canister_end", "packing_role": "motor_base_on_side"},
    )
    cylinder(
        "VAC_MOTOR_LID",
        0.105,
        0.075,
        (0.095, 0.015, 0.168),
        materials["sage_dark"],
        rot=(0, math.pi / 2, 0),
        vertices=28,
        bevel=0.004,
        parent=root,
        props={"component": "motor_lid", "packing_role": "motor_base_on_side"},
    )
    # A stout carry handle makes the sideways motor unmistakably a shop vacuum.
    handle = empty(
        "VAC_CANISTER_HANDLE",
        parent=root,
        props={"component": "carry_handle", "packing_role": "folded_against_motor"},
    )
    beam_between("VAC_HANDLE_LEFT", (-0.10, -0.098, 0.235), (-0.10, -0.132, 0.275), 0.010, materials["green"], parent=handle, component="handle_leg", packing_role="folded_against_motor")
    beam_between("VAC_HANDLE_GRIP", (-0.10, -0.132, 0.275), (0.050, -0.132, 0.275), 0.011, materials["green"], parent=handle, component="handle_grip", packing_role="folded_against_motor")
    beam_between("VAC_HANDLE_RIGHT", (0.050, -0.132, 0.275), (0.050, -0.098, 0.235), 0.010, materials["green"], parent=handle, component="handle_leg", packing_role="folded_against_motor")
    for index, x in enumerate((-0.16, -0.01), start=1):
        wheel = cylinder(
            f"VAC_WHEEL_{index:02d}",
            0.034,
            0.022,
            (x, 0.124, 0.095),
            materials["rubber"],
            rot=(math.pi / 2, 0, 0),
            vertices=18,
            bevel=0.002,
            parent=root,
            props={"component": "vacuum_wheel", "packing_role": "motor_base_on_side"},
        )
        wheel["rolling_axis"] = "+Y"

    wand = beam_between(
        "VAC_DETACHED_WAND",
        (-0.252, -0.126, 0.069),
        (0.212, -0.126, 0.069),
        0.010,
        materials["steel"],
        parent=root,
        component="detached_wand",
        packing_role="detached_in_insert_channel",
    )
    wand["detached_for_packing"] = True
    nozzle = box(
        "VAC_CREVICE_NOZZLE",
        (0.082, 0.055, 0.032),
        (0.238, -0.118, 0.070),
        materials["charcoal"],
        rot=(0, 0, -0.12),
        bevel=0.004,
        parent=root,
        props={"component": "crevice_nozzle", "packing_role": "detached_accessory_cell"},
    )
    nozzle["detached_for_packing"] = True

    hose_points = []
    for turn in range(2):
        for index in range(17):
            angle = math.tau * index / 16
            radius = 0.066 - turn * 0.014
            hose_points.append((0.205 + math.cos(angle) * radius, 0.071 + turn * 0.009, 0.185 + math.sin(angle) * radius))
    hose = tube_path(
        "VAC_HOSE_COIL",
        hose_points,
        0.009,
        materials["rubber"],
        parent=root,
        component="flexible_hose",
        packing_role="detached_coil_in_insert_well",
    )
    hose["detached_for_packing"] = True
    cylinder(
        "VAC_HOSE_COUPLER",
        0.018,
        0.046,
        (0.205, 0.078, 0.278),
        materials["sage"],
        rot=(math.pi / 2, 0, 0),
        vertices=16,
        bevel=0.002,
        parent=root,
        props={"component": "hose_coupler", "packing_role": "detached_coil_in_insert_well"},
    )

    # The cap reaches the contracted height but visibly keys into the canister
    # instead of reading as a loose block suspended above the insert.
    box(
        "VAC_TOP_END_BRACE_NECK",
        (0.100, 0.058, 0.025),
        (-0.205, 0.025, 0.2925),
        materials["foam"],
        bevel=0.007,
        parent=root,
        props={"component": "top_end_brace_neck", "packing_role": "retains_motor_base"},
    )
    brace = box(
        "VAC_TOP_END_BRACE",
        (0.110, 0.070, 0.055),
        (-0.205, 0.025, 0.3325),
        materials["foam"],
        bevel=0.010,
        parent=root,
        props={"component": "top_end_brace", "packing_role": "retains_motor_base"},
    )
    brace["envelope_height_stop"] = True
    add_common_contract(root, materials, asset_id)
    return root


def build_plant(materials):
    asset_id = "delivery_fixture_product_plant"
    root = product_root(asset_id)
    box(
        "PLANT_MOULDED_INSERT",
        (0.34, 0.34, 0.025),
        (0, 0, 0.0125),
        materials["foam"],
        bevel=0.007,
        parent=root,
        props={"component": "moulded_insert", "packing_role": "pot_cradle_full-envelope"},
    )
    pot = open_cone(
        "PLANT_POT",
        0.095,
        0.116,
        0.135,
        (0, 0, 0.0925),
        materials["terracotta"],
        parent=root,
        component="terracotta_pot",
        packing_role="upright_pot",
    )
    pot["unpacked_product_height_m"] = 0.65
    cylinder("PLANT_POT_RIM", 0.119, 0.017, (0, 0, 0.157), materials["terracotta"], vertices=28, bevel=0.0025, parent=root, props={"component": "pot_rim", "packing_role": "upright_pot"})
    cylinder("PLANT_SOIL", 0.102, 0.007, (0, 0, 0.163), materials["soil"], vertices=28, bevel=0.001, parent=root, props={"component": "contained_soil", "packing_role": "sealed_below_crown_net"})
    for index, (start, end) in enumerate((
        ((0, 0, 0.164), (-0.045, 0.008, 0.222)),
        ((0, 0, 0.164), (0.040, -0.010, 0.229)),
        ((0, 0, 0.164), (0.000, 0.036, 0.241)),
    ), start=1):
        beam_between(f"PLANT_STEM_{index:02d}", start, end, 0.006, materials["sage_dark"], parent=root, component="compressed_stem", packing_role="crown_netted")
    crown = empty(
        "PLANT_CROWN_COMPRESSED",
        parent=root,
        props={"component": "compressed_leaf_crown", "packing_role": "crown_netted", "unpacked_spread_m": 0.35},
    )
    leaf_specs = (
        ("A", (0.18, 0.075, 0.055), (-0.047, -0.010, 0.221), materials["leaf"]),
        ("B", (0.17, 0.068, 0.050), (0.049, 0.005, 0.225), materials["leaf_light"]),
        ("C", (0.135, 0.075, 0.055), (0.005, 0.055, 0.237), materials["leaf"]),
        ("D", (0.105, 0.062, 0.060), (-0.010, -0.046, 0.250), materials["leaf_light"]),
    )
    for suffix, dimensions, location, material in leaf_specs:
        ellipsoid(f"PLANT_COMPRESSED_LEAF_{suffix}", dimensions, location, material, parent=crown, component="compressed_leaf", packing_role="crown_netted")

    # The brace is a full 340 mm outer-diameter ring; the two bands and crossed
    # cords make the transport net readable even in a small open-carton view.
    brace = torus("PLANT_POT_BRACE_RING", 0.145, 0.025, (0, 0, 0.080), materials["foam"], parent=root)
    mark(brace, component="pot_brace_ring", packing_role="pot_braced")
    net = empty(
        "PLANT_CROWN_NET",
        parent=root,
        props={"component": "protective_crown_net", "packing_role": "crown_netted", "removable": True},
    )
    for index, (radius, height) in enumerate(((0.105, 0.196), (0.094, 0.232), (0.070, 0.266)), start=1):
        band = torus(f"PLANT_NET_BAND_{index:02d}", radius, 0.0032, (0, 0, height), materials["net"], parent=net)
        mark(band, component="net_band", packing_role="crown_netted")
    for index, (start, end) in enumerate((
        ((-0.105, 0, 0.196), (-0.045, 0, 0.278)),
        ((0.105, 0, 0.196), (0.045, 0, 0.278)),
        ((0, -0.105, 0.196), (0, -0.045, 0.278)),
        ((0, 0.105, 0.196), (0, 0.045, 0.278)),
    ), start=1):
        beam_between(f"PLANT_NET_CORD_{index:02d}", start, end, 0.0028, materials["net"], parent=net, component="net_cord", packing_role="crown_netted", vertices=10)
    add_common_contract(root, materials, asset_id)
    return root


def corner_protector(prefix, x, y, z, materials, *, parent, north, east, board=False):
    main_name = prefix
    width = 0.062 if board else 0.070
    depth = 0.052 if board else 0.060
    height = 0.040
    main = box(
        main_name,
        (width, depth, height),
        (x, y, z),
        materials["kraft"],
        bevel=0.005,
        parent=parent,
        props={"component": "corner_protector" if not board else "corner_block", "packing_role": "corner_protection"},
    )
    main["corner"] = ("N" if north else "S") + ("E" if east else "W")
    return main


def build_poster(materials):
    asset_id = "delivery_fixture_product_poster"
    root = product_root(asset_id)
    box(
        "POSTER_BACK_FACE_PROTECTOR",
        (0.56, 0.37, 0.015),
        (0, 0, 0.0075),
        materials["kraft"],
        bevel=0.005,
        parent=root,
        props={"component": "back_face_protector", "packing_role": "full-envelope_backing"},
    )
    frame = empty(
        "POSTER_FRAME",
        parent=root,
        props={"component": "walnut_picture_frame", "packing_role": "frame_on_edge", "physical_width_m": 0.52, "physical_depth_m": 0.36},
    )
    for name, dimensions, location in (
        ("POSTER_FRAME_NORTH", (0.52, 0.025, 0.026), (0, 0.1575, 0.032)),
        ("POSTER_FRAME_SOUTH", (0.52, 0.025, 0.026), (0, -0.1575, 0.032)),
        ("POSTER_FRAME_WEST", (0.025, 0.29, 0.026), (-0.2475, 0, 0.032)),
        ("POSTER_FRAME_EAST", (0.025, 0.29, 0.026), (0.2475, 0, 0.032)),
    ):
        box(name, dimensions, location, materials["walnut"], bevel=0.003, parent=frame, props={"component": "frame_member", "packing_role": "frame_on_edge"})
    art = box(
        "POSTER_COURSE_ART",
        (0.47, 0.29, 0.004),
        (0, 0, 0.032),
        materials["cream"],
        bevel=0.001,
        parent=frame,
        props={"component": "course_poster_face", "packing_role": "face_up_below_protector"},
    )
    art["fictional_brand"] = "Pinehollow Golf"
    # Geometric course artwork: fairway bands, water, and a brass flag.
    for index, (width, depth, y, material) in enumerate((
        (0.405, 0.052, 0.083, materials["sage_dark"]),
        (0.350, 0.055, 0.020, materials["sage"]),
        (0.285, 0.052, -0.045, materials["green"]),
        (0.105, 0.050, -0.105, materials["blue"]),
    ), start=1):
        box(f"POSTER_ART_BAND_{index:02d}", (width, depth, 0.0012), (0, y, 0.0348), material, bevel=0.003, parent=frame)
    beam_between("POSTER_ART_FLAG_STEM", (0.102, 0.030, 0.0355), (0.102, 0.092, 0.0355), 0.0016, materials["brass"], parent=frame, component="poster_flag", packing_role="printed_art", vertices=8)
    box("POSTER_ART_FLAG", (0.044, 0.025, 0.0012), (0.124, 0.081, 0.0355), materials["cream"], bevel=0.002, parent=frame)
    protector = box(
        "POSTER_FACE_PROTECTOR",
        (0.505, 0.345, 0.003),
        (0, 0, 0.0485),
        materials["glass"],
        bevel=0.001,
        parent=root,
        props={"component": "removable_face_protector", "packing_role": "glazed_face_protected", "removable": True},
    )
    protector["protects_fragile_glazing"] = True
    for name, x, y, north, east in (
        ("POSTER_CORNER_PROTECTOR_NW", -0.245, 0.155, True, False),
        ("POSTER_CORNER_PROTECTOR_NE", 0.245, 0.155, True, True),
        ("POSTER_CORNER_PROTECTOR_SW", -0.245, -0.155, False, False),
        ("POSTER_CORNER_PROTECTOR_SE", 0.245, -0.155, False, True),
    ):
        corner_protector(name, x, y, 0.050, materials, parent=root, north=north, east=east)
    add_common_contract(root, materials, asset_id)
    return root


def build_events_board(materials):
    asset_id = "delivery_fixture_product_events_board"
    root = product_root(asset_id)
    box(
        "BOARD_PACKING_PAD",
        (0.58, 0.36, 0.018),
        (0, 0, 0.009),
        materials["foam"],
        bevel=0.006,
        parent=root,
        props={"component": "packing_pad", "packing_role": "full-envelope_backing"},
    )
    board = empty(
        "EVENTS_BOARD",
        parent=root,
        props={"component": "framed_events_board", "packing_role": "board_on_edge", "rail_detached": True},
    )
    for name, dimensions, location in (
        ("BOARD_FRAME_NORTH", (0.53, 0.025, 0.034), (0, 0.1425, 0.046)),
        ("BOARD_FRAME_SOUTH", (0.53, 0.025, 0.034), (0, -0.1425, 0.046)),
        ("BOARD_FRAME_WEST", (0.025, 0.26, 0.034), (-0.2525, 0, 0.046)),
        ("BOARD_FRAME_EAST", (0.025, 0.26, 0.034), (0.2525, 0, 0.046)),
    ):
        box(name, dimensions, location, materials["green"], bevel=0.003, parent=board, props={"component": "board_frame_member", "packing_role": "board_on_edge"})
    cork = box(
        "EVENTS_BOARD_CORK_FACE",
        (0.48, 0.26, 0.008),
        (0, 0, 0.063),
        materials["cork"],
        bevel=0.002,
        parent=board,
        props={"component": "cork_face", "packing_role": "face_up"},
    )
    cork["pin_ready"] = True
    box("EVENTS_BOARD_HEADER", (0.45, 0.047, 0.003), (0, 0.095, 0.0685), materials["green"], bevel=0.002, parent=board, props={"component": "events_header", "packing_role": "face_up"})
    note_specs = (
        (-0.155, 0.025, 0.105, 0.070, 0.03),
        (-0.020, 0.010, 0.110, 0.082, -0.025),
        (0.145, 0.035, 0.100, 0.062, 0.02),
        (0.075, -0.075, 0.120, 0.060, -0.04),
        (-0.120, -0.078, 0.105, 0.055, 0.025),
    )
    for index, (x, y, width, depth, rotation) in enumerate(note_specs, start=1):
        box(f"EVENTS_BOARD_NOTE_{index:02d}", (width, depth, 0.002), (x, y, 0.0695), materials["paper"], rot=(0, 0, rotation), bevel=0.0015, parent=board, props={"component": "event_note", "packing_role": "pinned_face_up"})
        cylinder(f"EVENTS_BOARD_PIN_{index:02d}", 0.004, 0.003, (x, y + depth * 0.30, 0.072), materials["brass"], vertices=10, bevel=0.0005, parent=board, props={"component": "note_pin", "packing_role": "pinned_face_up"})
    rail = box(
        "BOARD_DETACHED_RAIL",
        (0.46, 0.026, 0.020),
        (0, -0.155, 0.083),
        materials["brass"],
        bevel=0.003,
        parent=root,
        props={"component": "detached_hanging_rail", "packing_role": "detached_in_edge_channel", "detached_for_packing": True},
    )
    rail["mount_axis"] = "+X"
    for index, x in enumerate((-0.190, 0.190), start=1):
        cylinder(f"BOARD_RAIL_FASTENER_{index:02d}", 0.006, 0.004, (x, -0.155, 0.095), materials["steel"], vertices=12, bevel=0.001, parent=root, props={"component": "rail_fastener", "packing_role": "retained_with_detached_rail"})
    for name, x, y, north, east in (
        ("BOARD_CORNER_BLOCK_NW", -0.259, 0.151, True, False),
        ("BOARD_CORNER_BLOCK_NE", 0.259, 0.151, True, True),
        ("BOARD_CORNER_BLOCK_SW", -0.259, -0.151, False, False),
        ("BOARD_CORNER_BLOCK_SE", 0.259, -0.151, False, True),
    ):
        corner_protector(name, x, y, 0.080, materials, parent=root, north=north, east=east, board=True)
    add_common_contract(root, materials, asset_id)
    return root


def build_pendant(materials):
    asset_id = "delivery_fixture_product_pendant"
    root = product_root(asset_id)
    box(
        "PENDANT_MOULDED_INSERT",
        (0.36, 0.36, 0.020),
        (0, 0, 0.010),
        materials["foam"],
        bevel=0.007,
        parent=root,
        props={"component": "moulded_insert", "packing_role": "full-envelope_shade_base"},
    )
    ring = torus("PENDANT_FOAM_RING", 0.139, 0.035, (0, 0, 0.061), materials["foam"], parent=root)
    mark(ring, component="shade_foam_ring", packing_role="shade_upright_in_ring")
    ring["removable"] = True
    shade = open_cone(
        "PENDANT_SHADE",
        0.160,
        0.060,
        0.145,
        (0, 0, 0.135),
        materials["green"],
        parent=root,
        component="pendant_shade",
        packing_role="shade_upright_in_ring",
    )
    shade["unpacked_total_height_m"] = 0.48
    rim = torus("PENDANT_SHADE_RIM", 0.154, 0.006, (0, 0, 0.0625), materials["brass"], parent=root)
    mark(rim, component="shade_rim", packing_role="shade_upright_in_ring")
    cylinder("PENDANT_SOCKET", 0.031, 0.060, (0, 0, 0.225), materials["charcoal"], vertices=22, bevel=0.003, parent=root, props={"component": "lamp_socket", "packing_role": "inside_shade_neck"})
    cylinder("PENDANT_SOCKET_BRASS_COLLAR", 0.036, 0.013, (0, 0, 0.197), materials["brass"], vertices=22, bevel=0.002, parent=root, props={"component": "socket_collar", "packing_role": "inside_shade_neck"})

    stem = beam_between(
        "PENDANT_DETACHED_STEM",
        (-0.132, 0.118, 0.255),
        (0.132, 0.118, 0.255),
        0.012,
        materials["charcoal"],
        parent=root,
        component="detached_pendant_stem",
        packing_role="detached_in_top_channel",
    )
    stem["detached_for_packing"] = True
    stem["assembly_axis"] = "+Z"
    canopy = cylinder(
        "PENDANT_CEILING_CANOPY",
        0.073,
        0.025,
        (-0.090, -0.096, 0.247),
        materials["green"],
        vertices=24,
        bevel=0.003,
        parent=root,
        props={"component": "ceiling_canopy", "packing_role": "detached_accessory_well", "detached_for_packing": True},
    )
    canopy["mount_surface"] = "ceiling"
    cord_points = []
    for index in range(28):
        angle = math.tau * index / 14
        radius = 0.047 - 0.0008 * index
        cord_points.append((0.090 + math.cos(angle) * radius, -0.090 + math.sin(angle) * radius, 0.247 + index * 0.00055))
    cord = tube_path("PENDANT_COILED_CORD", cord_points, 0.0032, materials["charcoal"], parent=root, component="electrical_cord", packing_role="coiled_in_accessory_well")
    cord["detached_for_packing"] = True
    box(
        "PENDANT_STEM_END_CLIP",
        (0.052, 0.075, 0.030),
        (-0.142, 0.118, 0.270),
        materials["foam"],
        bevel=0.008,
        parent=root,
        props={"component": "stem_end_clip", "packing_role": "retains_detached_stem"},
    )
    brace = box(
        "PENDANT_TOP_FOAM_BRACE",
        (0.068, 0.110, 0.036),
        (0.142, 0.110, 0.302),
        materials["foam"],
        bevel=0.009,
        parent=root,
        props={"component": "top_foam_brace", "packing_role": "retains_detached_stem"},
    )
    brace["envelope_height_stop"] = True
    add_common_contract(root, materials, asset_id)
    return root


BUILDERS = {
    "delivery_fixture_product_vacuum": build_vacuum,
    "delivery_fixture_product_plant": build_plant,
    "delivery_fixture_product_poster": build_poster,
    "delivery_fixture_product_events_board": build_events_board,
    "delivery_fixture_product_pendant": build_pendant,
}


def visible_bounds(root):
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    visible_meshes = []
    for obj in descendants(root):
        if obj.type != "MESH" or obj.name.startswith("COL_"):
            continue
        visible_meshes.append(obj)
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                minimum[axis] = min(minimum[axis], world[axis])
                maximum[axis] = max(maximum[axis], world[axis])
    if not visible_meshes:
        raise RuntimeError(f"{root.name} has no visible meshes")
    dimensions = maximum - minimum
    return minimum, maximum, dimensions, visible_meshes


def triangle_count(objects):
    return sum(len(obj.data.loop_triangles) for obj in objects if obj.type == "MESH")


def validate_asset(asset_id: str, root):
    spec = ASSETS[asset_id]
    nodes = descendants(root)
    names = {obj.name for obj in nodes}
    required = set(spec["required"]) | {
        "BARCODE_AREA",
        "PICKUP_TARGET",
        "PLACEMENT_TARGET",
        f"COL_{spec['logical_sku'].upper()}_PACKED",
    }
    missing = sorted(required - names)
    if missing:
        raise RuntimeError(f"{asset_id} missing required nodes: {missing}")
    if root.name != asset_id or root.get("asset_id") != asset_id:
        raise RuntimeError(f"{asset_id} root identity drifted")
    if root.get("logical_sku") != spec["logical_sku"]:
        raise RuntimeError(f"{asset_id} logical SKU drifted")
    if root.get("allow_runtime_scale") is not False or root.get("content_scale") != 1:
        raise RuntimeError(f"{asset_id} is not an authored 1:1 asset")
    if any(obj.type in {"CAMERA", "LIGHT"} for obj in nodes):
        raise RuntimeError(f"{asset_id} contains a camera or light")
    for anchor_name in ("BARCODE_AREA", "PICKUP_TARGET", "PLACEMENT_TARGET"):
        socket = bpy.data.objects.get(anchor_name)
        if socket is None or socket.parent != root or not socket.get("anchor"):
            raise RuntimeError(f"{asset_id}/{anchor_name} is not a direct root anchor")
    minimum, maximum, dimensions, visible_meshes = visible_bounds(root)
    expected = Vector(spec["author_dimensions"])
    if any(abs(dimensions[index] - expected[index]) > 0.001 for index in range(3)):
        raise RuntimeError(f"{asset_id} visible dimensions {tuple(dimensions)} != {tuple(expected)}")
    if abs(minimum.z) > 0.001:
        raise RuntimeError(f"{asset_id} must rest on Z=0, got {minimum.z}")
    for obj in [candidate for candidate in nodes if candidate.type == "MESH"]:
        if any(abs(value - 1.0) > 1e-5 for value in obj.scale):
            raise RuntimeError(f"{asset_id}/{obj.name} has unapplied scale {tuple(obj.scale)}")
        if obj.data.polygons and len(obj.data.uv_layers) < 1:
            raise RuntimeError(f"{asset_id}/{obj.name} has no UV map")
        obj.data.calc_loop_triangles()
    triangles = triangle_count(nodes)
    if triangles < 400 or triangles > 12000:
        raise RuntimeError(f"{asset_id} triangle count {triangles} outside 400..12000")
    return {
        "asset_id": asset_id,
        "logical_sku": spec["logical_sku"],
        "nodes": len(nodes),
        "meshes": len([obj for obj in nodes if obj.type == "MESH"]),
        "triangles": triangles,
        "materials": len({slot.material.name for obj in nodes if obj.type == "MESH" for slot in obj.material_slots if slot.material}),
        "visible_dimensions_authoring": [round(value, 6) for value in dimensions],
        "visible_dimensions_runtime": [round(dimensions.x, 6), round(dimensions.z, 6), round(dimensions.y, 6)],
        "visible_min_authoring": [round(value, 6) for value in minimum],
        "visible_max_authoring": [round(value, 6) for value in maximum],
        "required_nodes": sorted(required),
        "anchors": ["BARCODE_AREA", "PICKUP_TARGET", "PLACEMENT_TARGET"],
        "collision": f"COL_{spec['logical_sku'].upper()}_PACKED",
        "transforms_applied": True,
        "all_meshes_uv_mapped": True,
    }


def add_build_info(asset_id: str):
    text = bpy.data.texts.new("BUILD_INFO.txt")
    text.write(
        "Pinehollow Golf packed nonretail fixture product\n"
        f"asset_id: {asset_id}\n"
        f"logical_sku: {ASSETS[asset_id]['logical_sku']}\n"
        f"build_version: {BUILD_VERSION}\n"
        f"builder: {SCRIPT.relative_to(ROOT).as_posix()}\n"
        "units: metres; 1:1 authored content scale\n"
        "dimension contract: src/data/productPackaging.js\n"
        "source: original project-owned procedural geometry; no external downloads\n"
        "raw/project-owned sources: read-only and never overwritten\n"
    )


def save_export(asset_id: str, root):
    metrics = validate_asset(asset_id, root)
    add_build_info(asset_id)
    blend_path = SOURCE_DIR / f"{asset_id}.blend"
    glb_path = EXPORT_DIR / f"{asset_id}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.object.select_all(action="DESELECT")
    selected = descendants(root)
    for obj in selected:
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_animations=False,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )
    metrics.update({
        "blend": blend_path.relative_to(ROOT).as_posix(),
        "glb": glb_path.relative_to(ROOT).as_posix(),
        "blend_bytes": blend_path.stat().st_size,
        "glb_bytes": glb_path.stat().st_size,
        "glb_sha256": sha256(glb_path),
        "source_note": root.get("source"),
    })
    print(f"BUILT|{asset_id}|tris={metrics['triangles']}|bytes={metrics['glb_bytes']}|runtime_dims={metrics['visible_dimensions_runtime']}")
    return metrics


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_preview(asset_id: str):
    spec = ASSETS[asset_id]
    width, depth, height = spec["author_dimensions"]
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -1.0
    if scene.world is None:
        scene.world = bpy.data.worlds.new("QA_World")
    scene.world.color = (0.018, 0.026, 0.020)
    bpy.ops.object.camera_add(location=(width * 1.15, -depth * 1.75, max(height * 2.35, 0.36)))
    camera = bpy.context.object
    camera.name = "QA_Camera"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = max(width, depth, height) * 1.72
    scene.camera = camera
    for name, energy, location, color, size in (
        ("Key", 54, (-0.55, -0.52, 0.72), (1.0, 0.85, 0.67), 0.55),
        ("Fill", 26, (0.58, -0.18, 0.42), (0.67, 0.86, 0.72), 0.46),
        ("Rim", 40, (0.12, 0.52, 0.62), (0.73, 0.84, 1.0), 0.40),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = f"QA_{name}"
        light.data.energy = energy
        light.data.color = color
        light.data.shape = "DISK"
        light.data.size = size
        look_at(light, (0, 0, height * 0.35))
    floor_material = mat("QA_FloorMaterial", (0.032, 0.052, 0.038, 1.0), roughness=0.93)
    box("QA_Floor", (1.10, 1.10, 0.012), (0, 0, -0.009), floor_material, bevel=0.004)
    return camera


def render_previews(asset_id: str):
    spec = ASSETS[asset_id]
    width, depth, height = spec["author_dimensions"]
    camera = setup_preview(asset_id)
    target = (0, 0, height * 0.45)
    views = (
        ("front_three_quarter", (width * 1.05, -depth * 1.75, max(height * 2.20, 0.32))),
        ("packing_overhead", (width * 0.10, -depth * 0.22, max(width, depth) * 2.25 + height)),
    )
    preview_paths = []
    for view_name, location in views:
        camera.location = location
        look_at(camera, target if view_name == "front_three_quarter" else (0, 0, height * 0.10))
        output_path = QA_DIR / f"{asset_id}_{view_name}.png"
        bpy.context.scene.render.filepath = str(output_path)
        bpy.ops.render.render(write_still=True)
        preview_paths.append(output_path.relative_to(ROOT).as_posix())
    return preview_paths


def clean_reimport(asset_id: str):
    reset_scene()
    configure_scene()
    glb_path = EXPORT_DIR / f"{asset_id}.glb"
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    root = bpy.data.objects.get(asset_id)
    if root is None:
        raise RuntimeError(f"clean reimport lost {asset_id} root")
    metrics = validate_asset(asset_id, root)
    report = {
        **metrics,
        "glb": glb_path.relative_to(ROOT).as_posix(),
        "root_metadata_preserved": root.get("asset_id") == asset_id,
        "logical_sku_preserved": root.get("logical_sku") == ASSETS[asset_id]["logical_sku"],
        "required_nodes_preserved": ASSETS[asset_id]["required"].issubset({obj.name for obj in descendants(root)}),
        "anchors_preserved": all(bpy.data.objects.get(name) is not None for name in ("BARCODE_AREA", "PICKUP_TARGET", "PLACEMENT_TARGET")),
        "no_runtime_scale": root.get("allow_runtime_scale") is False and root.get("content_scale") == 1,
        "no_cameras_or_lights": not any(obj.type in {"CAMERA", "LIGHT"} for obj in descendants(root)),
        "clean_reimport": True,
    }
    report_path = QA_DIR / f"{asset_id}_reimport.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf8")
    print(f"REIMPORT_OK|{asset_id}|tris={metrics['triangles']}|runtime_dims={metrics['visible_dimensions_runtime']}")
    return report


def build_one(asset_id: str):
    reset_scene()
    configure_scene()
    materials = fixture_materials()
    root = BUILDERS[asset_id](materials)
    metrics = save_export(asset_id, root)
    metrics["previews"] = render_previews(asset_id)
    return metrics


def requested_assets():
    target = os.environ.get("NONRETAIL_FIXTURE_ASSET_TARGET", "").strip()
    if not target:
        return list(BUILDERS)
    if target not in BUILDERS:
        raise RuntimeError(f"unknown NONRETAIL_FIXTURE_ASSET_TARGET: {target}")
    return [target]


def main():
    if not PENDANT_REFERENCE.is_file():
        raise RuntimeError(f"missing immutable project-owned pendant reference: {PENDANT_REFERENCE}")
    reference_hash_before = sha256(PENDANT_REFERENCE)
    chosen = requested_assets()
    metrics = [build_one(asset_id) for asset_id in chosen]
    reimports = [clean_reimport(asset_id) for asset_id in chosen]
    reference_hash_after = sha256(PENDANT_REFERENCE)
    if reference_hash_before != reference_hash_after:
        raise RuntimeError("immutable project-owned pendant reference changed during build")
    report = {
        "builder": SCRIPT.relative_to(ROOT).as_posix(),
        "build_version": BUILD_VERSION,
        "qa_pass": QA_PASS,
        "asset_target": os.environ.get("NONRETAIL_FIXTURE_ASSET_TARGET", "").strip() or "all",
        "dimension_contract": "src/data/productPackaging.js",
        "external_assets": [],
        "source_inventory": {
            "vac1": "no project source found; original procedural geometry",
            "plant1": "no project source found; original procedural geometry",
            "poster1": "no project source found; original procedural geometry",
            "board1": "no project source found; original procedural geometry",
            "light1": PENDANT_REFERENCE.relative_to(ROOT).as_posix(),
        },
        "project_owned_reference": PENDANT_REFERENCE.relative_to(ROOT).as_posix(),
        "project_owned_reference_sha256_before": reference_hash_before,
        "project_owned_reference_sha256_after": reference_hash_after,
        "project_owned_reference_unchanged": reference_hash_before == reference_hash_after,
        "raw_sources_modified": False,
        "assets": metrics,
        "reimports": reimports,
    }
    report_path = QA_DIR / "nonretail_fixture_products_build_report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf8")
    print(f"COMPLETE|assets={len(metrics)}|qa_pass={QA_PASS}|reference_unchanged=true")


if __name__ == "__main__":
    main()
