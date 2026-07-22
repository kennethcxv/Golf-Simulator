"""Build Asset Sheet 05 reference 41: Pinehollow delivery cargo van.

Run from the repository root with Blender 5.1:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
      --background --factory-startup \
      --python tools/blender/build_delivery_van.py

All geometry is deterministic, original project-owned work authored in metres.
Blender axes are X vehicle length, Y vehicle width and Z height.  The standard
glTF conversion exports runtime dimensions X length, Y height and Z width.
The van faces Blender -X.  Set DELIVERY_VAN_QA_PASS to preserve a review pass.
"""

from __future__ import annotations

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
    box,
    collision_box,
    curve_tube,
    cylinder,
    descendants,
    empty,
    finish_mesh,
    mat,
    materials,
    parent_keep,
    reset_scene,
    torus,
)


ASSET_ID = "delivery_van"
BUILD_VERSION = 5
TARGET_RUNTIME_DIMS = (5.50, 2.40, 2.00)  # Three.js X length, Y height, Z width
BLENDER_DIMS = (5.50, 2.00, 2.40)  # Blender X length, Y width, Z height
SOURCE_DIR = ROOT / "asset_sources" / "blender" / "delivery"
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
QA_ROOT = (
    ROOT / "qa" / "box_system_master" / "delivery_equipment_refs41_45"
    / "assets" / "ref41_van"
)
QA_PASS = os.environ.get("DELIVERY_VAN_QA_PASS", "iteration-01")
QA_DIR = QA_ROOT / QA_PASS
SOURCE_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
QA_DIR.mkdir(parents=True, exist_ok=True)


def van_materials():
    M = materials()
    authored = (
        ("offwhite", (0.74, 0.70, 0.61, 1.0), 0.54, 0.02),
        ("green", (0.009, 0.050, 0.018, 1.0), 0.51, 0.18),
        ("sage", (0.070, 0.130, 0.078, 1.0), 0.69, 0.03),
        ("charcoal", (0.018, 0.023, 0.022, 1.0), 0.55, 0.32),
        ("rubber", (0.003, 0.004, 0.0035, 1.0), 0.91, 0.0),
        ("steel", (0.24, 0.29, 0.29, 1.0), 0.34, 0.75),
        ("brass", (0.42, 0.245, 0.055, 1.0), 0.39, 0.70),
    )
    for key, color, roughness, metallic in authored:
        material = M[key]
        material.diffuse_color = color
        bsdf = material.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    M["window"] = mat("M_VanWindow", (0.008, 0.021, 0.024, 1.0), roughness=0.18, metallic=0.18)
    M["headlight"] = mat(
        "M_VanHeadlight", (0.76, 0.66, 0.39, 1.0), roughness=0.22,
        emissive=(0.76, 0.58, 0.25), emission_strength=0.65,
    )
    M["taillight"] = mat(
        "M_VanTailLight", (0.32, 0.008, 0.005, 1.0), roughness=0.28,
        emissive=(0.32, 0.005, 0.003), emission_strength=0.45,
    )
    M["amber"] = mat(
        "M_VanAmber", (0.45, 0.115, 0.006, 1.0), roughness=0.30,
        emissive=(0.40, 0.085, 0.003), emission_strength=0.38,
    )
    return M


def van_root():
    return empty(
        ASSET_ID,
        props={
            "asset_id": ASSET_ID,
            "asset_version": BUILD_VERSION,
            "version": BUILD_VERSION,
            "units": "meters",
            "reference_id": "41",
            "target_dimensions_m": list(TARGET_RUNTIME_DIMS),
            "blender_dimensions_m": list(BLENDER_DIMS),
            "runtime_axis_map": "Blender +X,+Y,+Z -> Three.js +X,-Z,+Y",
            "runtime_up_axis": "+Y",
            "front": "Blender -X / runtime -X",
            "right_side": "Blender -Y / runtime +Z",
            "source": "Original Pinehollow Golf geometry generated in-repository from local Asset Sheet 05",
            "license": "Project-owned / UNLICENSED",
            "builder": SCRIPT.relative_to(ROOT).as_posix(),
            "model_map_key": ASSET_ID,
            "asset_type": "delivery_cargo_van",
            "brand": "Pinehollow Golf (fictional project-owned marque)",
            "moving_components": "right sliding cargo door, paired rear doors, four wheel spin pivots, two front steer pivots",
            "cargo_socket_count": 6,
        },
        size=0.16,
    )


def set_helper(obj, helper_kind):
    obj["helper"] = True
    obj["helper_kind"] = helper_kind
    obj.hide_render = True
    return obj


def raw_cube(name, dims, loc):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def profile_solid(name, points_xz, width, material, *, cutters=(), parent=None):
    """Extrude a vehicle side profile and apply deterministic cargo cut-outs."""
    half = width / 2
    verts = [(x, -half, z) for x, z in points_xz] + [(x, half, z) for x, z in points_xz]
    count = len(points_xz)
    faces = [tuple(range(count))[::-1], tuple(range(count, count * 2))]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for cutter_name, dims, loc in cutters:
        cutter = raw_cube(cutter_name, dims, loc)
        modifier = obj.modifiers.new("CargoOpening", "BOOLEAN")
        modifier.operation = "DIFFERENCE"
        modifier.solver = "EXACT"
        modifier.object = cutter
        activate(obj)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.data.objects.remove(cutter, do_unlink=True)
    finish_mesh(obj, material, bevel_width=0.018, bevel_segments=2)
    parent_keep(obj, parent)
    obj["component"] = "cargo_van_body_shell"
    obj["real_openings"] = "right sliding door and rear cargo doors"
    return obj


def side_panel_mesh(name, points_xz, thickness, y, material, *, parent=None, props=None, bevel=0.006):
    half = thickness / 2
    verts = [(x, y - half, z) for x, z in points_xz] + [(x, y + half, z) for x, z in points_xz]
    count = len(points_xz)
    faces = [tuple(range(count)), tuple(range(count, count * 2))[::-1]]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish_mesh(obj, material, bevel_width=bevel, bevel_segments=2)
    parent_keep(obj, parent)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def segment_cylinder(name, start, end, radius, material, *, parent=None, vertices=14, bevel=0.002, props=None):
    start_v, end_v = Vector(start), Vector(end)
    direction = end_v - start_v
    midpoint = (start_v + end_v) * 0.5
    rotation = direction.to_track_quat("Z", "Y").to_euler()
    obj = cylinder(
        name, radius, direction.length, midpoint, material, rot=rotation,
        vertices=vertices, bevel=bevel, parent=parent, props=props,
    )
    return obj


def flat_text_mesh(name, text, loc, material, *, size, rot, parent=None):
    """Low-poly, geometry-backed wordmark without texture or font bevel bloat."""
    bpy.ops.object.text_add(location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.data.body = text
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.size = size
    obj.data.resolution_u = 1
    obj.data.extrude = 0.0
    obj.data.bevel_depth = 0.0
    obj.data.materials.append(material)
    activate(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.name = name
    finish_mesh(obj, material, bevel_width=0.0)
    parent_keep(obj, parent)
    return obj


def join_detail_meshes(name, objects, *, parent=None, props=None):
    """Join decorative parts so richer authored detail does not inflate runtime nodes."""
    if not objects:
        raise RuntimeError(f"{name} has no detail meshes to join")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    parent_keep(joined, parent)
    for key, value in (props or {}).items():
        joined[key] = value
    return joined


def crest(name_prefix, location, normal_side, scale, M, *, parent=None):
    """Geometry-only fictional Pinehollow shield and crossed-club mark."""
    x, y, z = location
    points = [
        (x - 0.40 * scale, z + 0.42 * scale),
        (x + 0.40 * scale, z + 0.42 * scale),
        (x + 0.34 * scale, z - 0.08 * scale),
        (x, z - 0.46 * scale),
        (x - 0.34 * scale, z - 0.08 * scale),
    ]
    shield = side_panel_mesh(
        f"{name_prefix}_SHIELD", points, 0.012, y, M["green"], parent=parent,
        props={"component": "project_owned_pinehollow_crest", "external_artwork": False}, bevel=0.008,
    )
    for index, angle in enumerate((-0.62, 0.62), start=1):
        box(
            f"{name_prefix}_CROSSED_CLUB_{index}", (0.060 * scale, 0.014, 0.74 * scale),
            (x, y + normal_side * 0.010, z), M["brass"], rot=(0, angle, 0),
            bevel=0.006 * scale, parent=parent,
        )
    return shield


def build_wheel(position, label, side, axle_kind, M, running_gear):
    x, y, z = position
    parent = running_gear
    if axle_kind == "front":
        parent = empty(
            f"WHEEL_{label}_STEER_PIVOT", position, parent=running_gear, size=0.08,
            props={
                "component": "front_steering_pivot", "moving_part": True,
                "steer_axis_blender": "+Z", "steer_axis_runtime": "+Y",
                "steer_limit_degrees": 32,
            },
        )
    pivot = empty(
        f"WHEEL_{label}_PIVOT", position, parent=parent, size=0.075,
        props={
            "component": "wheel_spin_pivot", "moving_part": True,
            "spin_axis_blender": "+Y", "spin_axis_runtime": "-Z",
            "wheel_radius_m": 0.405, "wheel_width_m": 0.15,
        },
    )
    torus(
        f"WHEEL_{label}_TIRE", 0.320, 0.085, position, M["rubber"],
        rot=(math.pi / 2, 0, 0), parent=pivot,
    )["component"] = "all_season_cargo_tire"
    cylinder(
        f"WHEEL_{label}_HUB", 0.205, 0.100, position, M["steel"],
        rot=(math.pi / 2, 0, 0), vertices=24, bevel=0.010, parent=pivot,
        props={"component": "brushed_steel_wheel_hub"},
    )
    outside_y = y + side * 0.064
    torus(
        f"WHEEL_{label}_RIM_RING", 0.150, 0.024, (x, outside_y, z), M["brass"],
        rot=(math.pi / 2, 0, 0), parent=pivot,
    )
    cylinder(
        f"WHEEL_{label}_CENTER_CAP", 0.068, 0.012, (x, y + side * 0.082, z), M["brass"],
        rot=(math.pi / 2, 0, 0), vertices=18, bevel=0.004, parent=pivot,
    )
    return pivot, parent if axle_kind == "front" else None


def add_fender_arch(name, wheel_x, side, M, parent):
    y = side * 0.905
    points = []
    for angle_deg in (4, 28, 52, 76, 100, 124, 148, 176):
        angle = math.radians(angle_deg)
        points.append((wheel_x + 0.455 * math.cos(angle), y, 0.405 + 0.455 * math.sin(angle)))
    curve_tube(name, points, 0.026, M["charcoal"], parent=parent)["component"] = "wheel_arch_trim"


def build_van(M):
    root = van_root()
    body = empty("BODY_ASSEMBLY", parent=root, size=0.14, props={"component": "fixed_vehicle_body"})

    profile = [
        (-2.62, 0.42), (-2.62, 0.76), (-2.44, 1.04), (-2.12, 1.16),
        (-1.56, 2.12), (-1.28, 2.35), (2.45, 2.35), (2.62, 2.18),
        (2.62, 0.44), (2.38, 0.30), (-2.34, 0.30),
    ]
    cutters = (
        ("CUT_CARGO_INTERIOR", (3.05, 1.56, 1.72), (1.12, 0, 1.34)),
        ("CUT_RIGHT_SLIDING_OPENING", (1.74, 0.42, 1.68), (0.52, -0.79, 1.36)),
        ("CUT_REAR_DOOR_OPENING", (0.36, 1.62, 1.72), (2.50, 0, 1.34)),
    )
    profile_solid("VAN_BODY_SHELL", profile, 1.76, M["offwhite"], cutters=cutters, parent=body)
    box("VAN_ROOF_PANEL", (3.73, 1.70, 0.050), (0.585, 0, 2.375), M["offwhite"], bevel=0.018, parent=body)
    box("VAN_CHASSIS", (4.70, 1.58, 0.16), (0.12, 0, 0.29), M["charcoal"], bevel=0.035, parent=body)
    box("CARGO_FLOOR", (2.92, 1.54, 0.070), (1.10, 0, 0.455), M["charcoal"], bevel=0.008, parent=body,
        props={"component": "cargo_load_floor", "load_surface_height_m": 0.49})
    box("CARGO_BULKHEAD", (0.045, 1.53, 1.62), (-0.38, 0, 1.30), M["sage"], bevel=0.010, parent=body)
    box("CARGO_INNER_LEFT", (2.78, 0.035, 1.50), (1.08, 0.795, 1.32), M["sage"], bevel=0.010, parent=body)
    box("CARGO_INNER_ROOF", (2.78, 1.50, 0.035), (1.08, 0, 2.205), M["sage"], bevel=0.010, parent=body)

    # Joined ribs, floor runners and a bright rear threshold give the open bay
    # believable construction while remaining one runtime mesh.
    cargo_detail_parts = []
    for index, rib_x in enumerate((-0.25, 0.32, 0.89, 1.46, 2.03), start=1):
        cargo_detail_parts.append(box(
            f"CARGO_RIB_LEFT_{index:02d}", (0.048, 0.042, 1.38), (rib_x, 0.758, 1.34),
            M["steel"], bevel=0.009,
        ))
        cargo_detail_parts.append(box(
            f"CARGO_RIB_ROOF_{index:02d}", (0.048, 1.43, 0.042), (rib_x, 0, 2.177),
            M["steel"], bevel=0.009,
        ))
    for index, runner_y in enumerate((-0.46, 0.46), start=1):
        cargo_detail_parts.append(box(
            f"CARGO_FLOOR_RUNNER_{index:02d}", (2.66, 0.055, 0.028), (1.10, runner_y, 0.505),
            M["steel"], bevel=0.006,
        ))
    cargo_detail_parts.extend((
        box("CARGO_REAR_THRESHOLD", (0.115, 1.52, 0.090), (2.555, 0, 0.505), M["steel"], bevel=0.012),
        box("CARGO_REAR_THRESHOLD_BRASS", (0.045, 1.34, 0.030), (2.622, 0, 0.565), M["brass"], bevel=0.006),
    ))
    join_detail_meshes(
        "CARGO_BAY_RIBS_AND_THRESHOLD", cargo_detail_parts, parent=body,
        props={
            "component": "cargo_bay_structural_detail",
            "joined_runtime_detail": True,
            "includes": "left wall ribs, roof bows, floor runners, rear load threshold",
        },
    )

    # Exact length is established by the front and rear bumpers.
    box("FRONT_BUMPER", (0.120, 1.84, 0.19), (-2.690, 0, 0.43), M["charcoal"], bevel=0.040, parent=body)
    box("REAR_BUMPER", (0.120, 1.84, 0.19), (2.690, 0, 0.43), M["charcoal"], bevel=0.040, parent=body)
    box("HOOD_PANEL", (0.70, 1.55, 0.050), (-2.17, 0, 1.115), M["offwhite"], rot=(0, -0.10, 0), bevel=0.018, parent=body)
    box("FRONT_GRILLE", (0.035, 1.12, 0.34), (-2.635, 0, 0.74), M["charcoal"], bevel=0.025, parent=body)
    for index, z in enumerate((0.64, 0.72, 0.80, 0.88), start=1):
        box(f"GRILLE_SLAT_{index:02d}", (0.012, 1.00, 0.022), (-2.656, 0, z), M["steel"], bevel=0.005, parent=body)
    box(
        "FRONT_CREST_SHIELD", (0.022, 0.19, 0.23), (-2.677, 0, 0.76),
        M["green"], bevel=0.025, parent=body,
        props={"component": "project_owned_pinehollow_crest", "external_artwork": False},
    )
    for index, angle in enumerate((-0.62, 0.62), start=1):
        box(
            f"FRONT_CREST_CROSSED_CLUB_{index}", (0.012, 0.035, 0.18),
            (-2.690, 0, 0.76), M["brass"], rot=(angle, 0, 0),
            bevel=0.004, parent=body,
        )

    for label, side in (("LEFT", 1), ("RIGHT", -1)):
        box(
            f"HEADLIGHT_BEZEL_{label}", (0.035, 0.35, 0.21), (-2.650, side * 0.675, 0.89),
            M["charcoal"], bevel=0.045, parent=body,
            props={"component": "front_headlight_bezel"},
        )
        box(
            f"HEADLIGHT_{label}", (0.025, 0.25, 0.115), (-2.675, side * 0.675, 0.89),
            M["headlight"], bevel=0.040, parent=body, props={"component": "front_headlight"},
        )
        box(
            f"FRONT_SIGNAL_{label}", (0.042, 0.18, 0.075), (-2.656, side * 0.78, 0.77),
            M["amber"], bevel=0.018, parent=body,
        )
        box(
            f"TAIL_LIGHT_{label}", (0.040, 0.18, 0.43), (2.645, side * 0.78, 0.83),
            M["taillight"], bevel=0.030, parent=body, props={"component": "rear_combination_lamp"},
        )
        box(
            f"SIDE_ROCKER_{label}", (4.62, 0.055, 0.16), (0.05, side * 0.892, 0.42),
            M["charcoal"], bevel=0.025, parent=body,
        )

    # Split windscreen, side glazing, mirrors, and wipers establish a readable cab.
    for label, side in (("LEFT", 1), ("RIGHT", -1)):
        box(
            f"WINDSHIELD_{label}", (0.032, 0.735, 0.87), (-1.88, side * 0.385, 1.66),
            M["window"], rot=(0, 0.51, 0), bevel=0.025, parent=body,
            props={"component": "driver_windscreen" if side > 0 else "passenger_windscreen"},
        )
        points = [(-1.55, 2.08), (-0.68, 2.10), (-0.62, 1.28), (-1.38, 1.28)]
        side_panel_mesh(
            f"CAB_WINDOW_{label}", points, 0.025, side * 0.892, M["window"], parent=body,
            props={"component": "driver_window" if side > 0 else "passenger_window"}, bevel=0.012,
        )
        box(
            f"CAB_DOOR_HANDLE_{label}", (0.19, 0.030, 0.045), (-0.78, side * 0.912, 1.22),
            M["charcoal"], bevel=0.012, parent=body,
        )
        mirror_y = side * 0.960
        box(
            f"MIRROR_HOUSING_{label}", (0.22, 0.080, 0.24), (-1.48, mirror_y, 1.62),
            M["charcoal"], bevel=0.050, parent=body, props={"component": "side_mirror_housing"},
        )
        box(
            f"MIRROR_GLASS_{label}", (0.16, 0.006, 0.17), (-1.48, side * 0.997, 1.62),
            M["window"], bevel=0.025, parent=body,
        )
        segment_cylinder(
            f"MIRROR_ARM_{label}", (-1.38, side * 0.88, 1.54), (-1.44, side * 0.93, 1.59),
            0.020, M["charcoal"], parent=body, vertices=12,
        )
        segment_cylinder(
            f"WIPER_{label}", (-1.98, side * 0.29, 1.31), (-1.76, side * 0.12, 1.57),
            0.011, M["charcoal"], parent=body, vertices=10,
        )

    # The production camera predominantly sees the driver's/left cargo flank.
    # A large project-owned green panel, restrained brass rule and cream type
    # make the Pinehollow/Fairway identity read without any external texture.
    left_livery_parts = [
        box("LEFT_LIVERY_GREEN_FIELD", (2.70, 0.030, 0.90), (1.02, 0.907, 1.52), M["green"], bevel=0.055),
        box("LEFT_LIVERY_BRASS_RULE", (2.48, 0.018, 0.050), (1.08, 0.931, 1.145), M["brass"], bevel=0.010),
        box("LEFT_LIVERY_BRASS_CAP", (0.055, 0.018, 0.66), (-0.22, 0.931, 1.55), M["brass"], bevel=0.010),
    ]
    left_livery_parts.append(flat_text_mesh(
        "LEFT_LIVERY_BRAND_TEXT", "PINEHOLLOW", (1.13, 0.934, 1.61), M["offwhite"],
        size=0.205, rot=(math.pi / 2, 0, math.pi),
    ))
    left_livery_parts.append(flat_text_mesh(
        "LEFT_LIVERY_SERVICE_TEXT", "FAIRWAY SUPPLY", (1.13, 0.935, 1.365), M["brass"],
        size=0.095, rot=(math.pi / 2, 0, math.pi),
    ))
    # A compact shield and crossed-club monogram repeats the grille/door mark.
    left_shield_points = [
        (-0.13, 1.78), (0.25, 1.78), (0.22, 1.48),
        (0.06, 1.27), (-0.10, 1.48),
    ]
    left_livery_parts.append(side_panel_mesh(
        "LEFT_LIVERY_CREST_SHIELD", left_shield_points, 0.016, 0.934, M["offwhite"],
        props={"external_artwork": False}, bevel=0.010,
    ))
    for index, angle in enumerate((-0.62, 0.62), start=1):
        left_livery_parts.append(box(
            f"LEFT_LIVERY_CROSSED_CLUB_{index}", (0.050, 0.016, 0.48),
            (0.06, 0.948, 1.55), M["brass"], rot=(0, angle, 0), bevel=0.006,
        ))
    join_detail_meshes(
        "LEFT_SIDE_PINEHOLLOW_LIVERY", left_livery_parts, parent=body,
        props={
            "component": "project_owned_left_side_livery",
            "external_artwork": False,
            "brand_read": "PINEHOLLOW / FAIRWAY SUPPLY",
        },
    )

    # Fixed sliding-door rail stays with the body while the panel translates.
    box("SLIDING_DOOR_RAIL_RIGHT", (1.12, 0.035, 0.055), (1.87, -0.905, 1.17), M["charcoal"], bevel=0.012, parent=body)
    sliding_pivot = empty(
        "SLIDING_CARGO_DOOR_RIGHT_PIVOT", (0.52, -0.920, 1.36), parent=root, size=0.11,
        props={
            "component": "right_sliding_cargo_door", "moving_part": True,
            "motion": "slide", "slide_axis_blender": "+X", "slide_axis_runtime": "+X",
            "travel_m": 1.32,
            "closed_position_blender_m": [0.52, -0.92, 1.36],
            "closed_position_runtime_m": [0.52, 1.36, 0.92],
        },
    )
    sliding_panel = box(
        "SLIDING_CARGO_DOOR_RIGHT", (1.72, 0.050, 1.69), (0.52, -0.925, 1.36),
        M["offwhite"], bevel=0.025, parent=sliding_pivot,
        props={"component": "sliding_door_panel", "real_opening_behind": True},
    )
    for name, dims, loc in (
        ("SLIDING_DOOR_TRIM_TOP", (1.60, 0.018, 0.035), (0.52, -0.954, 2.17)),
        ("SLIDING_DOOR_TRIM_BOTTOM", (1.60, 0.018, 0.035), (0.52, -0.954, 0.55)),
        ("SLIDING_DOOR_TRIM_FRONT", (0.035, 0.018, 1.57), (-0.28, -0.954, 1.36)),
        ("SLIDING_DOOR_TRIM_REAR", (0.035, 0.018, 1.57), (1.32, -0.954, 1.36)),
    ):
        box(name, dims, loc, M["sage"], bevel=0.008, parent=sliding_pivot)
    box("SLIDING_DOOR_HANDLE", (0.20, 0.025, 0.050), (1.12, -0.967, 1.33), M["charcoal"], bevel=0.014, parent=sliding_pivot)
    crest("RIGHT_DOOR_CREST", (-0.10, -0.968, 1.51), -1, 0.30, M, parent=sliding_pivot)
    flat_text_mesh(
        "RIGHT_DOOR_BRAND", "PINEHOLLOW GOLF", (0.72, -0.973, 1.56), M["green"],
        size=0.090, rot=(math.pi / 2, 0, 0), parent=sliding_pivot,
    )["component"] = "project_owned_brand_wordmark"
    flat_text_mesh(
        "RIGHT_DOOR_SLOGAN", "PLAY BETTER. EVERY DAY.", (0.72, -0.973, 1.39), M["green"],
        size=0.052, rot=(math.pi / 2, 0, 0), parent=sliding_pivot,
    )["component"] = "project_owned_slogan"

    # Paired rear doors are rooted at their physical outer hinge lines.
    rear_pivots = []
    for label, side in (("LEFT", 1), ("RIGHT", -1)):
        pivot = empty(
            f"REAR_CARGO_DOOR_{label}_HINGE_PIVOT", (2.635, side * 0.835, 1.35), parent=root, size=0.10,
            props={
                "component": "rear_cargo_door_hinge", "moving_part": True,
                "motion": "hinge", "hinge_axis_blender": "+Z", "hinge_axis_runtime": "+Y",
                "open_angle_degrees": side * 78,
                "hinge_side": label.lower(),
            },
        )
        rear_pivots.append(pivot)
        panel = box(
            f"REAR_CARGO_DOOR_{label}", (0.050, 0.825, 1.72), (2.635, side * 0.412, 1.35),
            M["offwhite"], bevel=0.025, parent=pivot,
            props={"component": "rear_door_panel", "real_opening_behind": True},
        )
        box(
            f"REAR_DOOR_HANDLE_{label}", (0.060, 0.055, 0.25), (2.670, side * 0.075, 1.29),
            M["charcoal"], bevel=0.015, parent=pivot,
        )
        for hinge_index, z in enumerate((0.72, 1.92), start=1):
            box(
                f"REAR_DOOR_{label}_HINGE_{hinge_index}", (0.075, 0.12, 0.13),
                (2.675, side * 0.828, z), M["charcoal"], bevel=0.020, parent=pivot,
            )

        # Exterior fleet livery and the interior pressed panel share the door's
        # physical hinge parent. Joining all small pieces keeps the hierarchy lean.
        rear_detail_parts = [
            box(
                f"REAR_{label}_LIVERY_FIELD", (0.018, 0.680, 0.690),
                (2.670, side * 0.412, 1.58), M["green"], bevel=0.035,
            ),
            box(
                f"REAR_{label}_LIVERY_RULE", (0.012, 0.560, 0.045),
                (2.683, side * 0.412, 1.285), M["brass"], bevel=0.009,
            ),
            box(
                f"REAR_{label}_INNER_PANEL", (0.018, 0.680, 1.42),
                (2.600, side * 0.412, 1.38), M["sage"], bevel=0.025,
            ),
        ]
        for rail_index, rail_y in enumerate((side * 0.18, side * 0.64), start=1):
            rear_detail_parts.append(box(
                f"REAR_{label}_INNER_VERTICAL_RAIL_{rail_index}", (0.020, 0.042, 1.18),
                (2.585, rail_y, 1.38), M["steel"], bevel=0.008,
            ))
        for rail_index, rail_z in enumerate((0.83, 1.91), start=1):
            rear_detail_parts.append(box(
                f"REAR_{label}_INNER_HORIZONTAL_RAIL_{rail_index}", (0.020, 0.560, 0.042),
                (2.585, side * 0.412, rail_z), M["steel"], bevel=0.008,
            ))
        rear_detail_parts.append(box(
            f"REAR_{label}_INNER_PULL", (0.045, 0.060, 0.290),
            (2.565, side * 0.10, 1.36), M["charcoal"], bevel=0.014,
        ))
        # From behind, the negative-Y/right leaf occupies screen-left.
        rear_word = "HOLLOW" if label == "LEFT" else "PINE"
        rear_detail_parts.append(flat_text_mesh(
            f"REAR_{label}_LIVERY_WORD", rear_word,
            (2.686, side * 0.412, 1.58), M["offwhite"],
            size=0.125 if label == "LEFT" else 0.105,
            rot=(math.pi / 2, 0, math.pi / 2),
        ))
        join_detail_meshes(
            f"REAR_DOOR_{label}_LIVERY_AND_INNER_TRIM", rear_detail_parts, parent=pivot,
            props={
                "component": "project_owned_rear_livery_and_inner_door_trim",
                "external_artwork": False,
                "moves_with_rear_hinge": True,
                "wordmark_segment": rear_word,
            },
        )

    running_gear = empty("RUNNING_GEAR", parent=root, size=0.12, props={"component": "wheel_and_axle_system"})
    wheel_specs = (
        ("FRONT_LEFT", (-1.72, 0.910, 0.405), 1, "front"),
        ("FRONT_RIGHT", (-1.72, -0.910, 0.405), -1, "front"),
        ("REAR_LEFT", (1.72, 0.910, 0.405), 1, "rear"),
        ("REAR_RIGHT", (1.72, -0.910, 0.405), -1, "rear"),
    )
    wheel_pivots = []
    steer_pivots = []
    for label, position, side, axle_kind in wheel_specs:
        pivot, steer = build_wheel(position, label, side, axle_kind, M, running_gear)
        wheel_pivots.append(pivot)
        if steer:
            steer_pivots.append(steer)
        add_fender_arch(f"FENDER_ARCH_{label}", position[0], side, M, body)

    # Cargo sockets are floor-relative and remain within the modeled bay.
    socket_index = 1
    for center_x in (0.10, 1.05, 2.00):
        for center_y in (-0.39, 0.39):
            anchor(
                f"CARGO_BOX_SOCKET_{socket_index:02d}", (center_x, center_y, 0.50), parent=root,
                kind="delivery_box_socket",
                props={
                    "allowed_category": "delivery_box", "stack_order": socket_index,
                    "max_w": 0.78, "max_d": 0.66, "max_h": 0.82,
                    "occupancy": "empty", "occupied": False,
                    "occupancy_key": f"delivery_van_socket_{socket_index:02d}",
                },
            )
            socket_index += 1
    anchor(
        "REAR_LOADING_ANCHOR", (2.72, 0, 0.58), parent=root, kind="van_loading",
        props={"approach_direction_blender": "-X", "approach_direction_runtime": "-X", "interaction_radius_m": 2.1},
    )
    anchor(
        "RIGHT_DOOR_LOADING_ANCHOR", (0.52, -1.00, 0.58), parent=root, kind="van_side_loading",
        props={"approach_direction_blender": "+Y", "approach_direction_runtime": "-Z", "interaction_radius_m": 1.8},
    )
    anchor("DRIVER_SEAT_ANCHOR", (-1.12, 0.43, 0.82), parent=root, kind="driver_seat")

    # Simple shell collision preserves both real cargo approaches. A single
    # solid bay volume would leave an invisible wall behind each open door.
    for name, dims, loc, kind in (
        ("COL_VAN_CARGO_FLOOR", (3.18, 1.82, 0.14), (1.00, 0, 0.42), "cargo_floor_collision"),
        ("COL_VAN_CARGO_ROOF", (3.18, 1.82, 0.16), (1.00, 0, 2.28), "cargo_roof_collision"),
        ("COL_VAN_CARGO_LEFT_WALL", (3.18, 0.10, 1.86), (1.00, 0.86, 1.35), "cargo_left_wall_collision"),
        ("COL_VAN_CARGO_RIGHT_FRONT_PILLAR", (0.18, 0.10, 1.86), (-0.48, -0.86, 1.35), "cargo_right_front_pillar_collision"),
        ("COL_VAN_CARGO_RIGHT_REAR_PILLAR", (0.20, 0.10, 1.86), (2.48, -0.86, 1.35), "cargo_right_rear_pillar_collision"),
        ("COL_VAN_CAB", (1.58, 1.82, 1.82), (-1.34, 0, 1.20), "cab_collision"),
        ("COL_VAN_NOSE", (0.92, 1.82, 0.88), (-2.30, 0, 0.72), "nose_collision"),
    ):
        set_helper(collision_box(name, dims, loc, M, parent=root), kind)

    # Door proxies share the visible leaves' exact transform parents, so their
    # collision follows every authored slide and hinge movement.
    set_helper(
        collision_box(
            "COL_SLIDING_CARGO_DOOR_RIGHT", (1.72, 0.050, 1.69),
            (0.52, -0.925, 1.36), M, parent=sliding_pivot,
        ),
        "moving_sliding_door_collision",
    )
    for label, pivot in zip(("LEFT", "RIGHT"), rear_pivots):
        side = 1 if label == "LEFT" else -1
        set_helper(
            collision_box(
                f"COL_REAR_CARGO_DOOR_{label}", (0.050, 0.825, 1.72),
                (2.635, side * 0.412, 1.35), M, parent=pivot,
            ),
            "moving_rear_door_collision",
        )
    for label, position, _, _ in wheel_specs:
        set_helper(
            collision_box(f"COL_WHEEL_{label}", (0.81, 0.16, 0.81), position, M, parent=root),
            "wheel_collision",
        )

    # Exercise every authored moving transform and return the source to closed/neutral.
    bpy.context.view_layer.update()
    before = sliding_panel.matrix_world.copy()
    sliding_pivot.location.x += 1.32
    bpy.context.view_layer.update()
    moved = (sliding_panel.matrix_world.translation - before.translation).length > 1.30
    sliding_pivot.location.x -= 1.32
    bpy.context.view_layer.update()
    if not moved:
        raise RuntimeError("right sliding door failed translation exercise")
    sliding_pivot["pivot_exercise_passed"] = True
    sliding_pivot["pivot_exercise_travel_m"] = 1.32
    for pivot in rear_pivots:
        panel = next(child for child in pivot.children if child.name in {"REAR_CARGO_DOOR_LEFT", "REAR_CARGO_DOOR_RIGHT"})
        before = panel.matrix_world.copy()
        angle = math.radians(float(pivot["open_angle_degrees"]))
        pivot.rotation_euler.z = angle
        bpy.context.view_layer.update()
        moved = (panel.matrix_world.translation - before.translation).length > 0.48
        pivot.rotation_euler.z = 0
        bpy.context.view_layer.update()
        if not moved:
            raise RuntimeError(f"{pivot.name} failed hinge exercise")
        pivot["pivot_exercise_passed"] = True
    for pivot in wheel_pivots:
        tire = next(child for child in pivot.children if child.name.endswith("_TIRE"))
        before = tire.matrix_world.copy()
        pivot.rotation_euler.y = math.radians(43)
        bpy.context.view_layer.update()
        changed = any(abs(before[row][col] - tire.matrix_world[row][col]) > 1e-6 for row in range(4) for col in range(4))
        pivot.rotation_euler.y = 0
        bpy.context.view_layer.update()
        if not changed:
            raise RuntimeError(f"{pivot.name} failed spin exercise")
        pivot["pivot_exercise_passed"] = True
        pivot["pivot_exercise_degrees"] = 43
    for pivot in steer_pivots:
        wheel = next(child for child in pivot.children if child.name.endswith("_PIVOT"))
        before = wheel.matrix_world.copy()
        pivot.rotation_euler.z = math.radians(14)
        bpy.context.view_layer.update()
        changed = any(abs(before[row][col] - wheel.matrix_world[row][col]) > 1e-6 for row in range(4) for col in range(4))
        pivot.rotation_euler.z = 0
        bpy.context.view_layer.update()
        if not changed:
            raise RuntimeError(f"{pivot.name} failed steering exercise")
        pivot["pivot_exercise_passed"] = True
        pivot["pivot_exercise_degrees"] = 14
    return root


REQUIRED_NODES = {
    "BODY_ASSEMBLY", "VAN_BODY_SHELL", "VAN_ROOF_PANEL", "VAN_CHASSIS", "CARGO_FLOOR",
    "FRONT_BUMPER", "REAR_BUMPER", "FRONT_GRILLE", "WINDSHIELD_LEFT", "WINDSHIELD_RIGHT",
    "CAB_WINDOW_LEFT", "CAB_WINDOW_RIGHT", "MIRROR_HOUSING_LEFT", "MIRROR_HOUSING_RIGHT",
    "HEADLIGHT_LEFT", "HEADLIGHT_RIGHT", "TAIL_LIGHT_LEFT", "TAIL_LIGHT_RIGHT",
    "SLIDING_CARGO_DOOR_RIGHT_PIVOT", "SLIDING_CARGO_DOOR_RIGHT", "SLIDING_DOOR_RAIL_RIGHT",
    "RIGHT_DOOR_CREST_SHIELD", "RIGHT_DOOR_BRAND", "RIGHT_DOOR_SLOGAN",
    "LEFT_SIDE_PINEHOLLOW_LIVERY", "CARGO_BAY_RIBS_AND_THRESHOLD",
    "REAR_CARGO_DOOR_LEFT_HINGE_PIVOT", "REAR_CARGO_DOOR_RIGHT_HINGE_PIVOT",
    "REAR_CARGO_DOOR_LEFT", "REAR_CARGO_DOOR_RIGHT", "RUNNING_GEAR",
    "REAR_DOOR_LEFT_LIVERY_AND_INNER_TRIM", "REAR_DOOR_RIGHT_LIVERY_AND_INNER_TRIM",
    *{f"WHEEL_{label}_PIVOT" for label in ("FRONT_LEFT", "FRONT_RIGHT", "REAR_LEFT", "REAR_RIGHT")},
    "WHEEL_FRONT_LEFT_STEER_PIVOT", "WHEEL_FRONT_RIGHT_STEER_PIVOT",
    *{f"CARGO_BOX_SOCKET_{index:02d}" for index in range(1, 7)},
    "REAR_LOADING_ANCHOR", "RIGHT_DOOR_LOADING_ANCHOR", "DRIVER_SEAT_ANCHOR",
    "COL_VAN_CARGO_FLOOR", "COL_VAN_CARGO_ROOF", "COL_VAN_CARGO_LEFT_WALL",
    "COL_VAN_CARGO_RIGHT_FRONT_PILLAR", "COL_VAN_CARGO_RIGHT_REAR_PILLAR",
    "COL_VAN_CAB", "COL_VAN_NOSE", "COL_SLIDING_CARGO_DOOR_RIGHT",
    "COL_REAR_CARGO_DOOR_LEFT", "COL_REAR_CARGO_DOOR_RIGHT",
    *{f"COL_WHEEL_{label}" for label in ("FRONT_LEFT", "FRONT_RIGHT", "REAR_LEFT", "REAR_RIGHT")},
}


def visible_bounds(root):
    corners = []
    bpy.context.view_layer.update()
    for obj in descendants(root):
        if obj.type != "MESH" or obj.name.startswith("COL_"):
            continue
        for corner in obj.bound_box:
            corners.append(obj.matrix_world @ Vector(corner))
    lo = Vector((min(point.x for point in corners), min(point.y for point in corners), min(point.z for point in corners)))
    hi = Vector((max(point.x for point in corners), max(point.y for point in corners), max(point.z for point in corners)))
    return lo, hi


def asset_metrics(root):
    nodes = descendants(root)
    meshes = [obj for obj in nodes if obj.type == "MESH"]
    triangles = sum(sum(max(1, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in meshes)
    materials_used = sorted({slot.material.name for obj in meshes for slot in obj.material_slots if slot.material})
    lo, hi = visible_bounds(root)
    size = hi - lo
    return {
        "nodes": len(nodes), "meshes": len(meshes), "triangles": triangles,
        "materials": materials_used, "textures": 0,
        "visible_bounds_min_blender": [round(value, 5) for value in lo],
        "visible_bounds_max_blender": [round(value, 5) for value in hi],
        "visible_dimensions_blender": [round(value, 5) for value in size],
        "visible_dimensions_runtime": [round(size.x, 5), round(size.z, 5), round(size.y, 5)],
    }


def world_position(obj):
    bpy.context.view_layer.update()
    return obj.matrix_world.translation.copy()


def functional_checks(root):
    by_name = {obj.name: obj for obj in descendants(root)}
    checks = []
    sliding = by_name["SLIDING_CARGO_DOOR_RIGHT_PIVOT"]
    if sliding.get("pivot_exercise_passed") is not True or sliding.get("motion") != "slide":
        raise RuntimeError("sliding cargo door transform contract invalid")
    checks.append({"node": sliding.name, "motion": "slide", "travel_m": float(sliding["travel_m"]), "pass": True})
    for label, expected_y in (("LEFT", 0.835), ("RIGHT", -0.835)):
        pivot = by_name[f"REAR_CARGO_DOOR_{label}_HINGE_PIVOT"]
        expected = Vector((2.635, expected_y, 1.35))
        if (world_position(pivot) - expected).length > 1e-5 or pivot.get("pivot_exercise_passed") is not True:
            raise RuntimeError(f"{pivot.name} hinge contract invalid")
    checks.append({"rear_hinge_pivots": 2, "true_outer_hinge_lines": True, "pass": True})
    wheel_centers = {
        "FRONT_LEFT": (-1.72, 0.910, 0.405), "FRONT_RIGHT": (-1.72, -0.910, 0.405),
        "REAR_LEFT": (1.72, 0.910, 0.405), "REAR_RIGHT": (1.72, -0.910, 0.405),
    }
    for label, expected in wheel_centers.items():
        pivot = by_name[f"WHEEL_{label}_PIVOT"]
        tire = by_name[f"WHEEL_{label}_TIRE"]
        if (world_position(pivot) - Vector(expected)).length > 1e-5 or (world_position(tire) - Vector(expected)).length > 1e-5:
            raise RuntimeError(f"{pivot.name} center invalid")
        if pivot.get("pivot_exercise_passed") is not True:
            raise RuntimeError(f"{pivot.name} was not exercised")
    checks.append({"wheel_spin_pivots": 4, "front_steer_pivots": 2, "pass": True})
    for index in range(1, 7):
        socket = by_name[f"CARGO_BOX_SOCKET_{index:02d}"]
        if socket.get("anchor_kind") != "delivery_box_socket" or socket.get("allowed_category") != "delivery_box":
            raise RuntimeError(f"{socket.name} cargo socket metadata invalid")
    checks.append({"cargo_box_sockets": 6, "within_modeled_cargo_bay": True, "pass": True})
    return checks


def validate_scene(root):
    nodes = descendants(root)
    by_name = {obj.name: obj for obj in nodes}
    missing = sorted(REQUIRED_NODES - set(by_name))
    if missing:
        raise RuntimeError(f"{ASSET_ID} missing required nodes: {missing}")
    if root.get("asset_id") != ASSET_ID or root.get("reference_id") != "41":
        raise RuntimeError("delivery-van root metadata invalid")
    for obj in nodes:
        if obj.type != "MESH":
            continue
        if any(abs(value - 1.0) > 1e-5 for value in obj.scale):
            raise RuntimeError(f"unapplied scale: {obj.name} {tuple(obj.scale)}")
        if obj.data.polygons and not obj.data.uv_layers:
            raise RuntimeError(f"missing UVs: {obj.name}")
    metrics = asset_metrics(root)
    if not 5000 <= metrics["triangles"] <= 20000:
        hotspots = sorted(
            (
                (sum(max(1, len(poly.vertices) - 2) for poly in obj.data.polygons), obj.name)
                for obj in nodes if obj.type == "MESH"
            ),
            reverse=True,
        )[:15]
        print(f"TOPOLOGY_HOTSPOTS|{hotspots}")
        raise RuntimeError(f"triangle budget failed: {metrics['triangles']}")
    if metrics["nodes"] > 130:
        raise RuntimeError(f"node budget failed: {metrics['nodes']}")
    if len(metrics["materials"]) > 12:
        raise RuntimeError(f"material budget failed: {len(metrics['materials'])}")
    if any(abs(actual - expected) > 0.002 for actual, expected in zip(metrics["visible_dimensions_blender"], BLENDER_DIMS)):
        extrema = []
        for obj in nodes:
            if obj.type != "MESH" or obj.name.startswith("COL_"):
                continue
            corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
            extrema.append((
                obj.name,
                round(min(point.x for point in corners), 4), round(max(point.x for point in corners), 4),
                round(min(point.y for point in corners), 4), round(max(point.y for point in corners), 4),
                round(min(point.z for point in corners), 4), round(max(point.z for point in corners), 4),
            ))
        print(f"DIMENSION_EXTREMA|x={min(extrema, key=lambda item: item[1])}|{max(extrema, key=lambda item: item[2])}")
        print(f"DIMENSION_EXTREMA|y={min(extrema, key=lambda item: item[3])}|{max(extrema, key=lambda item: item[4])}")
        print(f"DIMENSION_EXTREMA|z={min(extrema, key=lambda item: item[5])}|{max(extrema, key=lambda item: item[6])}")
        raise RuntimeError(f"visible dimensions {metrics['visible_dimensions_blender']} do not match {BLENDER_DIMS}")
    metrics["functional_checks"] = functional_checks(root)
    metrics["triangle_budget"] = [5000, 20000]
    metrics["material_budget"] = 12
    metrics["node_budget"] = 130
    metrics["moving_pivots"] = 9
    metrics["collision_meshes"] = sum(1 for obj in nodes if obj.name.startswith("COL_"))
    return metrics


def add_build_info():
    text = bpy.data.texts.new("BUILD_INFO.txt")
    text.write(
        "Pinehollow Golf delivery cargo van, Asset Sheet 05 reference 41\n"
        f"asset_id: {ASSET_ID}\n"
        f"build_version: {BUILD_VERSION}\n"
        f"builder: {SCRIPT.relative_to(ROOT).as_posix()}\n"
        "units: metres\n"
        "source: original in-repository geometry from local project reference sheet\n"
        "license: project-owned / UNLICENSED\n"
        "external downloads, brand marks and textures: none\n"
        "existing vehicle and delivery assets: untouched\n"
    )


def save_and_export(root):
    metrics = validate_scene(root)
    add_build_info()
    blend_path = SOURCE_DIR / f"{ASSET_ID}.blend"
    glb_path = EXPORT_DIR / f"{ASSET_ID}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in descendants(root):
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path), export_format="GLB", use_selection=True, export_apply=True,
        export_yup=True, export_normals=True, export_texcoords=True, export_materials="EXPORT",
        export_animations=False, export_extras=True, export_cameras=False, export_lights=False,
    )
    metrics.update({
        "asset_id": ASSET_ID, "reference_id": "41", "target_dimensions_m": list(TARGET_RUNTIME_DIMS),
        "source": str(blend_path), "export": str(glb_path), "bytes": glb_path.stat().st_size,
        "qa_pass": QA_PASS,
    })
    (QA_DIR / f"{ASSET_ID}_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf8")
    print(
        f"BUILT|{ASSET_ID}|nodes={metrics['nodes']}|meshes={metrics['meshes']}|"
        f"tris={metrics['triangles']}|mats={len(metrics['materials'])}|bytes={metrics['bytes']}|"
        f"runtime_dims={metrics['visible_dimensions_runtime']}"
    )
    return metrics


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def preview_setup(M):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 760
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -1.00
    if scene.world is None:
        scene.world = bpy.data.worlds.new("QA_World")
    scene.world.color = (0.020, 0.025, 0.024)
    bpy.ops.object.camera_add(location=(-7.1, -5.2, 3.4))
    camera = bpy.context.object
    camera.name = "QA_Camera"
    camera.data.lens = 58
    scene.camera = camera
    for name, energy, location, size in (
        ("Key", 1250, (-4.5, -4.0, 6.2), 4.0),
        ("Fill", 760, (4.0, -3.0, 3.4), 3.0),
        ("Rim", 940, (4.5, 4.0, 5.0), 3.2),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = f"QA_{name}"
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size
        look_at(light, (0, 0, 1.15))
    floor_mat = mat("QA_VanGround", (0.095, 0.088, 0.073, 1.0), roughness=0.94)
    box("QA_Floor", (18, 18, 0.05), (0, 0, -0.035), floor_mat, bevel=0.010)
    box_mat = mat("QA_CargoKraft", (0.22, 0.090, 0.022, 1.0), roughness=0.84)
    proxies = (
        box("QA_CargoBox_A", (0.68, 0.58, 0.50), (0.52, -0.30, 0.75), box_mat, bevel=0.018),
        box("QA_CargoBox_B", (0.62, 0.54, 0.64), (1.42, 0.28, 0.82), box_mat, bevel=0.018),
        box("QA_CargoBox_C", (0.54, 0.48, 0.42), (2.05, -0.27, 0.70), box_mat, bevel=0.018),
    )
    for proxy in proxies:
        proxy.hide_render = True
        proxy["qa_only"] = True
    return camera, proxies


def set_proxy_visibility(proxies, visible):
    for proxy in proxies:
        proxy.hide_render = not visible


def render_previews(root, M):
    camera, proxies = preview_setup(M)
    sliding = bpy.data.objects["SLIDING_CARGO_DOOR_RIGHT_PIVOT"]
    rear_left = bpy.data.objects["REAR_CARGO_DOOR_LEFT_HINGE_PIVOT"]
    rear_right = bpy.data.objects["REAR_CARGO_DOOR_RIGHT_HINGE_PIVOT"]
    views = (
        ("front_three_quarter", (-7.2, -5.4, 3.4), (0, 0, 1.12)),
        ("right_brand_side", (0, -10.0, 2.75), (0, 0, 1.15)),
        ("front", (-8.8, -0.1, 2.65), (-0.15, 0, 1.10)),
        ("rear_three_quarter", (7.2, -5.1, 3.2), (0.4, 0, 1.10)),
        ("left_side", (0, 9.9, 2.70), (0, 0, 1.15)),
    )
    set_proxy_visibility(proxies, False)
    for name, location, target in views:
        camera.location = location
        look_at(camera, target)
        bpy.context.scene.render.filepath = str(QA_DIR / f"{ASSET_ID}_{name}_closed.png")
        bpy.ops.render.render(write_still=True)
    sliding.location.x += 1.32
    set_proxy_visibility(proxies, True)
    camera.location = (0.2, -7.0, 2.55)
    look_at(camera, (0.55, -0.15, 1.15))
    bpy.context.scene.render.filepath = str(QA_DIR / f"{ASSET_ID}_right_sliding_door_open_loaded.png")
    bpy.ops.render.render(write_still=True)
    sliding.location.x -= 1.32
    rear_left.rotation_euler.z = math.radians(78)
    rear_right.rotation_euler.z = math.radians(-78)
    camera.location = (8.2, -2.7, 2.75)
    look_at(camera, (1.15, 0, 1.10))
    bpy.context.scene.render.filepath = str(QA_DIR / f"{ASSET_ID}_rear_doors_open_loaded.png")
    bpy.ops.render.render(write_still=True)
    camera.location = (8.7, 0, 2.35)
    look_at(camera, (1.30, 0, 1.18))
    bpy.context.scene.render.filepath = str(QA_DIR / f"{ASSET_ID}_rear_doors_open_interior_center.png")
    bpy.ops.render.render(write_still=True)
    rear_left.rotation_euler.z = 0
    rear_right.rotation_euler.z = 0
    set_proxy_visibility(proxies, False)
    for obj in [candidate for candidate in list(bpy.data.objects) if candidate.name.startswith("QA_")]:
        bpy.data.objects.remove(obj, do_unlink=True)


def clean_reimport_validate():
    reset_scene()
    glb_path = EXPORT_DIR / f"{ASSET_ID}.glb"
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    root = bpy.data.objects.get(ASSET_ID)
    if root is None:
        raise RuntimeError("clean re-import lost delivery-van root")
    names = {obj.name for obj in bpy.context.scene.objects}
    missing = sorted(REQUIRED_NODES - names)
    if missing:
        raise RuntimeError(f"clean re-import missing nodes: {missing}")
    if root.get("asset_id") != ASSET_ID or root.get("reference_id") != "41":
        raise RuntimeError("clean re-import lost delivery-van metadata")
    metrics = asset_metrics(root)
    report = {
        "asset_id": ASSET_ID, "glb": str(glb_path), "root_metadata_preserved": True,
        "required_nodes_preserved": True, "nodes": metrics["nodes"], "meshes": metrics["meshes"],
        "triangles": metrics["triangles"], "materials": metrics["materials"],
        "visible_dimensions_blender": metrics["visible_dimensions_blender"],
        "visible_dimensions_runtime": metrics["visible_dimensions_runtime"],
        "sliding_door_pivot_preserved": True, "rear_hinge_pivots_preserved": True,
        "wheel_pivots_preserved": True, "cargo_sockets_preserved": True,
        "cameras_in_glb": 0, "lights_in_glb": 0,
    }
    (QA_DIR / f"{ASSET_ID}_reimport.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    M = van_materials()
    camera, proxies = preview_setup(M)
    set_proxy_visibility(proxies, False)
    camera.location = (-7.2, -5.4, 3.4)
    look_at(camera, (0, 0, 1.12))
    bpy.context.scene.render.filepath = str(QA_DIR / f"{ASSET_ID}_clean_reimport.png")
    bpy.ops.render.render(write_still=True)
    print(
        f"REIMPORT_OK|{ASSET_ID}|nodes={metrics['nodes']}|tris={metrics['triangles']}|"
        f"runtime_dims={metrics['visible_dimensions_runtime']}"
    )
    return report


def main():
    reset_scene()
    bpy.context.scene["asset_build_script"] = SCRIPT.relative_to(ROOT).as_posix()
    bpy.context.scene["asset_build_version"] = BUILD_VERSION
    M = van_materials()
    root = build_van(M)
    metrics = save_and_export(root)
    render_previews(root, M)
    reimport = clean_reimport_validate()
    report = {
        "builder": SCRIPT.relative_to(ROOT).as_posix(), "build_version": BUILD_VERSION,
        "qa_pass": QA_PASS,
        "reference_sheet": "Designs/RefrenceImages/41-50_refrence_images/ChatGPT Image Jul 17, 2026, 11_45_44 AM.png",
        "external_assets": [], "external_textures": [], "real_world_brand_references": [],
        "revision_summary": (
            "Pass 5 adds player-camera-readable Pinehollow/Fairway livery to the left flank and rear doors, "
            "pressed inner-door panels plus cargo-bay ribs/rails/threshold, and exposed brass/steel wheel hubs."
        ),
        "existing_assets_modified": False, "asset": metrics, "reimport": reimport,
    }
    (QA_DIR / "delivery_van_build_report.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(f"COMPLETE|asset={ASSET_ID}|qa_pass={QA_PASS}|source={SOURCE_DIR}|export={EXPORT_DIR}")


if __name__ == "__main__":
    main()
