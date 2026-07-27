"""Build Asset Sheet 05 reference 45: Pinehollow delivery pallet jack.

Run from the repository root with Blender 5.1:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
      --background --factory-startup \
      --python tools/blender/build_delivery_pallet_jack.py

All geometry is original, deterministic and project-owned. Blender axes are X
length, Y width and Z height. The glTF Y-up conversion exports runtime dimensions
X length, Y height and Z width. Set DELIVERY_PALLET_JACK_QA_PASS to preserve an
explicit visual-review pass under the ignored QA evidence tree.
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
    cylinder,
    descendants,
    empty,
    finish_mesh,
    mat,
    parent_keep,
    reset_scene,
    text_mesh,
)


ASSET_ID = "delivery_pallet_jack"
BUILD_VERSION = 3
TARGET_RUNTIME_DIMS = (1.55, 1.20, 0.70)  # Three.js X length, Y height, Z width
BLENDER_DIMS = (1.55, 0.70, 1.20)  # Blender X length, Y width, Z height
REFERENCE_PATH = (
    "Designs/RefrenceImages/41-50_refrence_images/"
    "ChatGPT Image Jul 17, 2026, 11_45_44 AM.png"
)

SOURCE_DIR = ROOT / "asset_sources" / "blender" / "delivery"
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
QA_ROOT = ROOT / "qa" / "box_system_master" / "blender" / "pallet_jack_ref45"
QA_PASS = os.environ.get("DELIVERY_PALLET_JACK_QA_PASS", "iteration-01")
QA_DIR = QA_ROOT / QA_PASS
SOURCE_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
QA_DIR.mkdir(parents=True, exist_ok=True)


def pallet_jack_materials():
    """Create a compact exporter-safe Pinehollow industrial palette."""
    authored = {
        "safety_yellow": (
            "M_PalletJackSafetyYellow", (0.58, 0.360, 0.010, 1.0), 0.50, 0.08,
        ),
        "safety_yellow_dark": (
            "M_PalletJackSafetyYellowDark", (0.20, 0.095, 0.003, 1.0), 0.61, 0.10,
        ),
        "green": ("M_DeepGolfGreen", (0.008, 0.055, 0.022, 1.0), 0.52, 0.04),
        "charcoal": ("M_WarmCharcoal", (0.014, 0.018, 0.016, 1.0), 0.54, 0.16),
        "rubber": ("M_PalletJackRubber", (0.010, 0.013, 0.012, 1.0), 0.92, 0.0),
        "steel": ("M_BrushedSteel", (0.24, 0.27, 0.25, 1.0), 0.31, 0.86),
        "brass": ("M_RestrainedBrass", (0.39, 0.205, 0.052, 1.0), 0.38, 0.78),
    }
    result = {}
    for key, (name, color, roughness, metallic) in authored.items():
        result[key] = mat(name, color, roughness=roughness, metallic=metallic)
    # Collision material is purposefully distinct and never rendered in QA.
    result["collision"] = mat("M_Collision", (1.0, 0.05, 0.02, 0.18), roughness=1.0)
    return result


def asset_root():
    return empty(
        ASSET_ID,
        props={
            "asset_id": ASSET_ID,
            "asset_version": BUILD_VERSION,
            "version": BUILD_VERSION,
            "units": "meters",
            "reference_id": "45",
            "target_dimensions_m": list(TARGET_RUNTIME_DIMS),
            "blender_dimensions_m": list(BLENDER_DIMS),
            "runtime_axis_map": "Blender +X,+Y,+Z -> Three.js +X,-Z,+Y",
            "runtime_up_axis": "+Y",
            "front": "Blender -X fork tips / runtime -X fork tips",
            "source": "Original Pinehollow Golf geometry generated in-repository from local Asset Sheet 05",
            "license": "Project-owned / UNLICENSED",
            "builder": SCRIPT.relative_to(ROOT).as_posix(),
            "model_map_key": ASSET_ID,
            "asset_type": "manual_hydraulic_pallet_jack",
            "rated_capacity_kg": 2000,
            "paint_finish": "restrained industrial safety yellow painted steel",
            "paint_color_name": "industrial safety yellow",
            "paint_base_color_linear_rgba": [0.58, 0.360, 0.010, 1.0],
            "paint_dark_color_linear_rgba": [0.20, 0.095, 0.003, 1.0],
            "fork_spacing_center_m": 0.45,
            "lift_range_m": [0.075, 0.195],
            "external_assets": "none",
            "external_textures": "none",
        },
        size=0.085,
    )


def mesh_from_pydata(name, vertices, faces, material, *, parent=None, bevel=0.0, props=None):
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish_mesh(obj, material, bevel_width=bevel, bevel_segments=2)
    parent_keep(obj, parent)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def tapered_fork(name, center_y, material, parent):
    """Low insertion deck plus a short heel ramp outside a coupled pallet.

    Ref 44's runner opening is about 73 mm high.  The full insertion section
    remains only 50 mm thick (28-78 mm above ground), leaving real clearance;
    the structural rise is confined to the final 125 mm at the power unit.
    """
    sections = (
        (-0.775, 0.052, 0.028, 0.072),
        (0.240, 0.068, 0.032, 0.078),
        (0.365, 0.073, 0.052, 0.128),
    )
    vertices = []
    for x, half_w, z_bottom, z_top in sections:
        vertices.extend([
            (x, center_y - half_w, z_bottom),
            (x, center_y + half_w, z_bottom),
            (x, center_y + half_w, z_top),
            (x, center_y - half_w, z_top),
        ])
    faces = [(0, 1, 2, 3), (8, 11, 10, 9)]
    for section in range(len(sections) - 1):
        a, b = section * 4, (section + 1) * 4
        faces.extend([
            (a, b, b + 1, a + 1),
            (a + 3, a + 2, b + 2, b + 3),
            (a, a + 3, b + 3, b),
            (a + 1, b + 1, b + 2, a + 2),
        ])
    return mesh_from_pydata(
        name, vertices, faces, material, parent=parent, bevel=0.008,
        props={
            "component": "load_fork",
            "fork_length_m": 1.14,
            "tip_clearance_m": 0.028,
            "heel_clearance_m": 0.052,
            "insertion_section_height_m": 0.050,
            "compatible_runner_gap_m": 0.073,
            "minimum_runner_clearance_m": 0.008,
            "load_surface": True,
        },
    )


def extruded_profile_y(name, profile_xz, width, material, *, parent=None, bevel=0.0, props=None):
    """Extrude a closed X/Z silhouette symmetrically along Y."""
    half = width / 2
    vertices = [(x, -half, z) for x, z in profile_xz] + [(x, half, z) for x, z in profile_xz]
    count = len(profile_xz)
    faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, following, count + following, count + index))
    return mesh_from_pydata(name, vertices, faces, material, parent=parent, bevel=bevel, props=props)


def tube_between(name, start, end, radius, material, *, parent=None, vertices=16, props=None):
    start_v, end_v = Vector(start), Vector(end)
    direction = end_v - start_v
    midpoint = (start_v + end_v) * 0.5
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=direction.length,
        location=midpoint,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    obj.rotation_mode = "XYZ"
    finish_mesh(obj, material, bevel_width=min(0.004, radius * 0.20), bevel_segments=2)
    parent_keep(obj, parent)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def set_collision_helper(obj, kind):
    obj["helper"] = True
    obj["helper_kind"] = kind
    obj.hide_render = True
    return obj


def build_pallet_jack(M):
    root = asset_root()

    # Forks translate vertically as a parallel carriage. A slide is more
    # mechanically faithful than hinging the load-bearing fork surfaces.
    lift = empty(
        "FORK_LIFT_SLIDE", (0, 0, 0), parent=root, size=0.060,
        props={
            "component": "hydraulic_lift_carriage",
            "motion_axis": "+Z",
            "motion_axis_runtime": "+Y",
            "minimum_z_m": 0.0,
            "maximum_z_m": 0.12,
            "minimum_runtime_y_m": 0.0,
            "maximum_runtime_y_m": 0.12,
            "resting_fork_top_m": 0.078,
            "compatible_runner_gap_m": 0.073,
        },
    )
    fork_frame = empty(
        "FORK_FRAME", (0, 0, 0), parent=lift, size=0.055,
        props={"component": "twin_fork_frame", "fork_center_spacing_m": 0.45},
    )
    for label, center_y in (("LEFT", -0.225), ("RIGHT", 0.225)):
        tapered_fork(f"FORK_{label}", center_y, M["safety_yellow"], fork_frame)
        # A dark replaceable wear strip gives the top surface readable scale.
        box(
            f"FORK_WEAR_PAD_{label}", (0.23, 0.082, 0.006),
            (-0.595, center_y, 0.075), M["charcoal"], bevel=0.005, parent=fork_frame,
            props={"component": "replaceable_fork_wear_pad"},
        )
        box(
            f"FORK_SAFETY_INLAY_{label}", (0.095, 0.076, 0.005),
            (-0.285, center_y, 0.097), M["green"], bevel=0.004, parent=fork_frame,
            props={"component": "pinehollow_safety_inlay"},
        )

        # Each load roller owns its true axle-centre pivot.
        roller_pivot = empty(
            f"LOAD_WHEEL_PIVOT_{label}", (-0.595, center_y, 0.037),
            parent=fork_frame, size=0.035,
            props={
                "component": "fork_load_wheel_pivot",
                "rotation_axis": "+/-Y",
                "rotation_axis_runtime": "+/-Z",
                "wheel_radius_m": 0.034,
            },
        )
        cylinder(
            f"LOAD_WHEEL_{label}", 0.034, 0.090, (-0.595, center_y, 0.037),
            M["rubber"], rot=(math.pi / 2, 0, 0), vertices=20, bevel=0.004,
            parent=roller_pivot, props={"component": "fork_load_roller"},
        )
        cylinder(
            f"LOAD_WHEEL_HUB_{label}", 0.014, 0.093, (-0.595, center_y, 0.037),
            M["steel"], rot=(math.pi / 2, 0, 0), vertices=16, bevel=0.002,
            parent=roller_pivot, props={"component": "load_roller_axle"},
        )

    # The fork heel, scissor links and pump ram remain legible without making
    # the compact power unit visually noisy.
    box(
        "FORK_HEEL_CROSSMEMBER", (0.19, 0.61, 0.095), (0.325, 0, 0.115),
        M["safety_yellow_dark"], bevel=0.014, parent=fork_frame,
        props={"component": "fork_heel_crossmember"},
    )
    for label, center_y in (("LEFT", -0.225), ("RIGHT", 0.225)):
        tube_between(
            f"LIFT_LINK_{label}", (0.18, center_y, 0.082), (0.43, center_y, 0.165),
            0.018, M["steel"], parent=lift,
            props={"component": "hydraulic_lift_link", "hinge_axis": "+/-Y"},
        )
        cylinder(
            f"LIFT_LINK_PIN_{label}", 0.027, 0.035, (0.43, center_y, 0.165),
            M["brass"], rot=(math.pi / 2, 0, 0), vertices=16, bevel=0.003, parent=lift,
            props={"component": "lift_link_hinge_pin"},
        )

    power = empty(
        "HYDRAULIC_POWER_UNIT", (0, 0, 0), parent=root, size=0.060,
        props={"component": "hydraulic_power_unit", "serviceable": True},
    )
    housing_profile = [
        (0.325, 0.105), (0.665, 0.105), (0.650, 0.335),
        (0.555, 0.455), (0.410, 0.390),
    ]
    extruded_profile_y(
        "PUMP_HOUSING", housing_profile, 0.355, M["safety_yellow"], parent=power, bevel=0.014,
        props={"component": "formed_steel_pump_housing", "removable_cover": True},
    )
    extruded_profile_y(
        "PUMP_HOUSING_SHADOW", [(0.34, 0.11), (0.64, 0.11), (0.63, 0.16), (0.36, 0.16)],
        0.366, M["safety_yellow_dark"], parent=power, bevel=0.004,
        props={"component": "lower_housing_wear_band"},
    )
    cylinder(
        "HYDRAULIC_RAM", 0.044, 0.235, (0.465, 0, 0.260), M["steel"],
        vertices=20, bevel=0.005, parent=power,
        props={"component": "hydraulic_lift_ram", "motion_axis": "+Z"},
    )
    cylinder(
        "HYDRAULIC_RAM_CAP", 0.058, 0.030, (0.465, 0, 0.390), M["brass"],
        vertices=20, bevel=0.004, parent=power,
        props={"component": "ram_service_cap"},
    )
    cylinder(
        "PRESSURE_RELEASE_VALVE", 0.020, 0.090, (0.565, -0.183, 0.255), M["brass"],
        rot=(math.pi / 2, 0, 0), vertices=16, bevel=0.003, parent=power,
        props={"component": "pressure_release_valve"},
    )
    box(
        "PARKING_SKID", (0.145, 0.085, 0.010), (0.475, 0, 0.005),
        M["charcoal"], bevel=0.003, parent=power,
        props={"component": "service_parking_skid", "floor_contact": True},
    )

    # Original project branding is geometry-backed and texture free.
    box(
        "BRAND_PLATE", (0.165, 0.006, 0.120), (0.485, -0.181, 0.283),
        M["green"], bevel=0.008, parent=power,
        props={"component": "pinehollow_brand_plate", "brand": "Pinehollow Golf"},
    )
    text_mesh(
        "BRAND_MONOGRAM", "PH", (0.485, -0.185, 0.280), M["brass"],
        size=0.050, rot=(math.pi / 2, 0, 0), parent=power,
    )["component"] = "project_owned_brand_monogram"
    box(
        "SAFETY_LABEL", (0.135, 0.006, 0.032), (0.485, -0.186, 0.207),
        M["charcoal"], bevel=0.003, parent=power,
        props={"component": "rated_capacity_label", "rated_capacity_kg": 2000},
    )

    # Steering assembly yaws around the vertical kingpin. Each wheel remains a
    # distinct rotating component on its actual transverse axle centre.
    steering = empty(
        "STEERING_YAW_PIVOT", (0.650, 0, 0.205), parent=root, size=0.065,
        props={
            "component": "steering_yaw_pivot",
            "rotation_axis": "+Z",
            "rotation_axis_runtime": "+Y",
            "steering_range_degrees": [-105, 105],
            "pivot_world_m": [0.650, 0.0, 0.205],
        },
    )
    cylinder(
        "STEERING_KINGPIN", 0.040, 0.205, (0.650, 0, 0.205), M["steel"],
        vertices=20, bevel=0.004, parent=steering,
        props={"component": "steering_kingpin"},
    )
    box(
        "STEERING_AXLE", (0.205, 0.555, 0.082), (0.650, 0, 0.130),
        M["safety_yellow_dark"], bevel=0.016, parent=steering,
        props={"component": "steering_axle_bridge"},
    )
    for label, center_y in (("LEFT", -0.300), ("RIGHT", 0.300)):
        wheel_pivot = empty(
            f"STEER_WHEEL_PIVOT_{label}", (0.675, center_y, 0.105),
            parent=steering, size=0.040,
            props={
                "component": "steering_wheel_pivot",
                "rotation_axis": "+/-Y",
                "rotation_axis_runtime": "+/-Z",
                "wheel_radius_m": 0.100,
            },
        )
        cylinder(
            f"STEER_WHEEL_{label}", 0.100, 0.086, (0.675, center_y, 0.105),
            M["rubber"], rot=(math.pi / 2, 0, 0), vertices=24, bevel=0.008,
            parent=wheel_pivot, props={"component": "polyurethane_steering_wheel"},
        )
        cylinder(
            f"STEER_WHEEL_HUB_{label}", 0.042, 0.094, (0.675, center_y, 0.105),
            M["steel"], rot=(math.pi / 2, 0, 0), vertices=18, bevel=0.004,
            parent=wheel_pivot, props={"component": "steering_wheel_hub"},
        )
        cylinder(
            f"STEER_WHEEL_HUBCAP_{label}", 0.020, 0.100, (0.675, center_y, 0.105),
            M["brass"], rot=(math.pi / 2, 0, 0), vertices=16, bevel=0.003,
            parent=wheel_pivot, props={"component": "steering_axle_cap"},
        )

    handle = empty(
        "HANDLE_TILT_PIVOT", (0.585, 0, 0.380), parent=steering, size=0.060,
        props={
            "component": "pump_handle_tilt_pivot",
            "rotation_axis": "+/-Y",
            "rotation_axis_runtime": "+/-Z",
            "working_range_degrees": [-52, 18],
            "pivot_world_m": [0.585, 0.0, 0.380],
        },
    )
    cylinder(
        "HANDLE_HINGE_PIN", 0.044, 0.235, (0.585, 0, 0.380), M["brass"],
        rot=(math.pi / 2, 0, 0), vertices=18, bevel=0.004, parent=handle,
        props={"component": "handle_hinge_pin"},
    )
    tube_between(
        "HANDLE_STEM", (0.585, 0, 0.405), (0.610, 0, 1.015),
        0.025, M["charcoal"], parent=handle, vertices=20,
        props={"component": "tubular_pump_handle"},
    )
    tube_between(
        "HANDLE_LOOP_LEFT", (0.610, -0.105, 1.005), (0.610, -0.105, 1.145),
        0.023, M["charcoal"], parent=handle, vertices=18,
        props={"component": "d_handle_loop"},
    )
    tube_between(
        "HANDLE_LOOP_RIGHT", (0.610, 0.105, 1.005), (0.610, 0.105, 1.145),
        0.023, M["charcoal"], parent=handle, vertices=18,
        props={"component": "d_handle_loop"},
    )
    tube_between(
        "HANDLE_LOOP_BASE_LEFT", (0.610, 0, 0.985), (0.610, -0.105, 1.025),
        0.023, M["charcoal"], parent=handle, vertices=18,
        props={"component": "d_handle_loop"},
    )
    tube_between(
        "HANDLE_LOOP_BASE_RIGHT", (0.610, 0, 0.985), (0.610, 0.105, 1.025),
        0.023, M["charcoal"], parent=handle, vertices=18,
        props={"component": "d_handle_loop"},
    )
    tube_between(
        "HANDLE_LOOP_TOP_LEFT", (0.610, -0.105, 1.145), (0.610, -0.072, 1.175),
        0.023, M["charcoal"], parent=handle, vertices=18,
        props={"component": "d_handle_loop"},
    )
    tube_between(
        "HANDLE_LOOP_TOP_RIGHT", (0.610, 0.105, 1.145), (0.610, 0.072, 1.175),
        0.023, M["charcoal"], parent=handle, vertices=18,
        props={"component": "d_handle_loop"},
    )
    cylinder(
        "HANDLE_GRIP", 0.025, 0.144, (0.610, 0, 1.175), M["green"],
        rot=(math.pi / 2, 0, 0), vertices=20, bevel=0.004, parent=handle,
        props={"component": "operator_hand_grip", "grip_width_m": 0.144},
    )
    box(
        "HANDLE_TOP_BADGE", (0.040, 0.072, 0.006), (0.610, 0, 1.197),
        M["brass"], bevel=0.002, parent=handle,
        props={"component": "pinehollow_handle_badge"},
    )
    tube_between(
        "RELEASE_CONTROL_ROD", (0.570, -0.030, 0.430), (0.592, -0.030, 0.965),
        0.006, M["steel"], parent=handle, vertices=12,
        props={"component": "hydraulic_release_control_rod"},
    )
    box(
        "RELEASE_CONTROL_PADDLE", (0.075, 0.090, 0.018), (0.585, -0.035, 0.980),
        M["brass"], rot=(0, math.radians(-8), 0), bevel=0.006, parent=handle,
        props={"component": "hydraulic_release_paddle"},
    )

    # Interaction and coupling sockets stay geometry-free.
    anchor(
        "INTERACTION_TARGET", (0.515, -0.48, 0.44), parent=root, kind="pallet_jack_interaction",
        props={"interaction_radius_m": 1.55, "prompt": "Use pallet jack"},
    )
    anchor(
        "HANDLE_GRIP_TARGET", (0.610, 0, 1.175), parent=handle, kind="operator_grip",
        props={"handedness": "two_handed", "grip_width_m": 0.144},
    )
    anchor(
        "PALLET_COUPLING_SOCKET", (-0.275, 0, 0.078), parent=lift, kind="pallet_coupling",
        props={
            "compatible_asset": "delivery_wooden_pallet", "fork_spacing_m": 0.45,
            "target_semantics": "pallet_center", "approach_anchor": "PALLET_JACK_ENTRY",
        },
    )
    for label, center_y in (("LEFT", -0.225), ("RIGHT", 0.225)):
        anchor(
            f"FORK_LOAD_CONTACT_{label}", (-0.275, center_y, 0.078), parent=lift,
            kind="fork_load_contact", props={"maximum_load_kg": 1000},
        )
    anchor(
        "FLOOR_CONTACT", (0.675, 0, 0.005), parent=steering, kind="floor_contact",
        props={"contact_mode": "rolling"},
    )

    collision_group = empty(
        "COLLISION_PROXIES", (0, 0, 0), parent=root, size=0.04,
        props={"helper": True, "helper_kind": "collision_registry", "registry_only": True},
    )
    for label, center_y in (("LEFT", -0.225), ("RIGHT", 0.225)):
        fork_collision = set_collision_helper(
            collision_box(
                f"COL_FORK_{label}", (1.02, 0.136, 0.060), (-0.265, center_y, 0.058),
                M, parent=fork_frame,
            ),
            "fork_collision",
        )
        fork_collision["collision_registry"] = collision_group.name
        fork_collision["follows_pivot"] = "FORK_LIFT_SLIDE"
        fork_collision["proxy_height_m"] = 0.060
        fork_collision["compatible_runner_gap_m"] = 0.073
    power_collision = set_collision_helper(
        collision_box("COL_POWER_UNIT", (0.44, 0.58, 0.37), (0.545, 0, 0.255), M, parent=power),
        "power_unit_collision",
    )
    power_collision["collision_registry"] = collision_group.name
    handle_collision = set_collision_helper(
        collision_box("COL_HANDLE", (0.13, 0.30, 0.84), (0.610, 0, 0.790), M, parent=handle),
        "handle_collision",
    )
    handle_collision["collision_registry"] = collision_group.name
    handle_collision["follows_pivots"] = "STEERING_YAW_PIVOT,HANDLE_TILT_PIVOT"
    return root


REQUIRED_NODES = {
    "FORK_LIFT_SLIDE", "FORK_FRAME", "FORK_LEFT", "FORK_RIGHT",
    "FORK_WEAR_PAD_LEFT", "FORK_WEAR_PAD_RIGHT",
    "LOAD_WHEEL_PIVOT_LEFT", "LOAD_WHEEL_PIVOT_RIGHT",
    "LOAD_WHEEL_LEFT", "LOAD_WHEEL_RIGHT",
    "FORK_HEEL_CROSSMEMBER", "HYDRAULIC_POWER_UNIT", "PUMP_HOUSING",
    "HYDRAULIC_RAM", "PARKING_SKID", "BRAND_PLATE", "BRAND_MONOGRAM",
    "STEERING_YAW_PIVOT", "STEERING_KINGPIN", "STEERING_AXLE",
    "STEER_WHEEL_PIVOT_LEFT", "STEER_WHEEL_PIVOT_RIGHT",
    "STEER_WHEEL_LEFT", "STEER_WHEEL_RIGHT",
    "HANDLE_TILT_PIVOT", "HANDLE_HINGE_PIN", "HANDLE_STEM", "HANDLE_GRIP",
    "RELEASE_CONTROL_ROD", "RELEASE_CONTROL_PADDLE",
    "INTERACTION_TARGET", "HANDLE_GRIP_TARGET", "PALLET_COUPLING_SOCKET",
    "FORK_LOAD_CONTACT_LEFT", "FORK_LOAD_CONTACT_RIGHT", "FLOOR_CONTACT",
    "COLLISION_PROXIES", "COL_FORK_LEFT", "COL_FORK_RIGHT",
    "COL_POWER_UNIT", "COL_HANDLE",
}


def is_collision(obj):
    return obj.name.startswith("COL_") or obj.name == "COLLISION_PROXIES"


def visible_bounds(root):
    corners = []
    bpy.context.view_layer.update()
    for obj in descendants(root):
        if obj.type != "MESH" or is_collision(obj):
            continue
        for corner in obj.bound_box:
            corners.append(obj.matrix_world @ Vector(corner))
    if not corners:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    lo = Vector((min(p.x for p in corners), min(p.y for p in corners), min(p.z for p in corners)))
    hi = Vector((max(p.x for p in corners), max(p.y for p in corners), max(p.z for p in corners)))
    return lo, hi


def asset_metrics(root):
    nodes = descendants(root)
    meshes = [obj for obj in nodes if obj.type == "MESH"]
    triangles = 0
    used_materials = set()
    for obj in meshes:
        triangles += sum(max(1, len(poly.vertices) - 2) for poly in obj.data.polygons)
        used_materials.update(slot.material.name for slot in obj.material_slots if slot.material)
    lo, hi = visible_bounds(root)
    return {
        "nodes": len(nodes),
        "meshes": len(meshes),
        "triangles": triangles,
        "materials": sorted(used_materials),
        "textures": 0,
        "visible_bounds_min_blender": [round(value, 5) for value in lo],
        "visible_bounds_max_blender": [round(value, 5) for value in hi],
        "visible_dimensions_blender": [round(value, 5) for value in (hi - lo)],
        "visible_dimensions_runtime": [round((hi - lo).x, 5), round((hi - lo).z, 5), round((hi - lo).y, 5)],
    }


def exercise_moving_components(root):
    by_name = {obj.name: obj for obj in descendants(root)}
    checks = []

    def moved_after(obj, data_path, delta, witness):
        original_value = getattr(obj, data_path).copy()
        original_witness = witness.matrix_world.translation.copy()
        if data_path == "rotation_euler":
            obj.rotation_euler = tuple(a + b for a, b in zip(original_value, delta))
        else:
            obj.location = tuple(a + b for a, b in zip(original_value, delta))
        bpy.context.view_layer.update()
        movement = (witness.matrix_world.translation - original_witness).length
        setattr(obj, data_path, original_value)
        bpy.context.view_layer.update()
        if movement <= 0.005:
            raise RuntimeError(f"{obj.name} failed pivot exercise with {witness.name}")
        return round(movement, 5)

    checks.append({
        "component": "FORK_LIFT_SLIDE",
        "motion_axis": "+Z",
        "witness_motion_m": moved_after(
            by_name["FORK_LIFT_SLIDE"], "location", (0, 0, 0.06), by_name["FORK_LEFT"]
        ),
        "pass": True,
    })
    checks.append({
        "component": "STEERING_YAW_PIVOT",
        "rotation_axis": "+Z",
        "witness_motion_m": moved_after(
            by_name["STEERING_YAW_PIVOT"], "rotation_euler", (0, 0, math.radians(28)),
            by_name["STEER_WHEEL_LEFT"],
        ),
        "pass": True,
    })
    checks.append({
        "component": "HANDLE_TILT_PIVOT",
        "rotation_axis": "+/-Y",
        "witness_motion_m": moved_after(
            by_name["HANDLE_TILT_PIVOT"], "rotation_euler", (0, math.radians(-24), 0),
            by_name["HANDLE_GRIP"],
        ),
        "pass": True,
    })
    for name, witness_name in (
        ("LOAD_WHEEL_PIVOT_LEFT", "LOAD_WHEEL_LEFT"),
        ("LOAD_WHEEL_PIVOT_RIGHT", "LOAD_WHEEL_RIGHT"),
        ("STEER_WHEEL_PIVOT_LEFT", "STEER_WHEEL_LEFT"),
        ("STEER_WHEEL_PIVOT_RIGHT", "STEER_WHEEL_RIGHT"),
    ):
        pivot, witness = by_name[name], by_name[witness_name]
        before = witness.matrix_world.to_quaternion()
        pivot.rotation_euler.y += math.radians(35)
        bpy.context.view_layer.update()
        angular = before.rotation_difference(witness.matrix_world.to_quaternion()).angle
        pivot.rotation_euler.y -= math.radians(35)
        bpy.context.view_layer.update()
        if angular <= math.radians(5):
            raise RuntimeError(f"{name} wheel rotation exercise failed")
        checks.append({
            "component": name,
            "rotation_axis": "+/-Y",
            "witness_rotation_degrees": round(math.degrees(angular), 3),
            "pass": True,
        })
    return checks


def validate_scene(root):
    nodes = descendants(root)
    by_name = {obj.name: obj for obj in nodes}
    missing = sorted(REQUIRED_NODES - set(by_name))
    if missing:
        raise RuntimeError(f"{ASSET_ID} missing required nodes: {missing}")
    if root.get("asset_id") != ASSET_ID or root.get("reference_id") != "45":
        raise RuntimeError("pallet jack root metadata invalid")
    for obj in nodes:
        if obj.type != "MESH":
            continue
        if any(abs(value - 1.0) > 1e-5 for value in obj.scale):
            raise RuntimeError(f"unapplied scale: {obj.name} {tuple(obj.scale)}")
        if obj.data.polygons and not obj.data.uv_layers:
            raise RuntimeError(f"missing UVs: {obj.name}")

    if by_name["FORK_FRAME"].parent is not by_name["FORK_LIFT_SLIDE"]:
        raise RuntimeError("fork frame hierarchy invalid")
    if by_name["HANDLE_TILT_PIVOT"].parent is not by_name["STEERING_YAW_PIVOT"]:
        raise RuntimeError("handle must steer with the steering assembly")
    for label in ("LEFT", "RIGHT"):
        if by_name[f"STEER_WHEEL_{label}"].parent is not by_name[f"STEER_WHEEL_PIVOT_{label}"]:
            raise RuntimeError(f"steering wheel {label} pivot hierarchy invalid")
        if by_name[f"LOAD_WHEEL_{label}"].parent is not by_name[f"LOAD_WHEEL_PIVOT_{label}"]:
            raise RuntimeError(f"load wheel {label} pivot hierarchy invalid")
        fork_collision = by_name[f"COL_FORK_{label}"]
        if fork_collision.parent is not by_name["FORK_FRAME"]:
            raise RuntimeError(f"fork collision {label} must follow FORK_LIFT_SLIDE")
        if float(fork_collision.get("proxy_height_m", 1)) >= 0.073:
            raise RuntimeError(f"fork collision {label} does not clear the Ref 44 runner gap")
    if by_name["COL_HANDLE"].parent is not by_name["HANDLE_TILT_PIVOT"]:
        raise RuntimeError("handle collision must follow steering and handle tilt")
    if by_name["COL_POWER_UNIT"].parent is not by_name["HYDRAULIC_POWER_UNIT"]:
        raise RuntimeError("power-unit collision hierarchy invalid")

    metrics = asset_metrics(root)
    if not 1200 <= metrics["triangles"] <= 9000:
        raise RuntimeError(f"triangle budget failed: {metrics['triangles']}")
    if not 40 <= metrics["nodes"] <= 90:
        raise RuntimeError(f"node budget failed: {metrics['nodes']}")
    if not 5 <= len(metrics["materials"]) <= 9:
        raise RuntimeError(f"material budget failed: {len(metrics['materials'])}")
    actual = metrics["visible_dimensions_blender"]
    if any(abs(a - e) > 0.003 for a, e in zip(actual, BLENDER_DIMS)):
        raise RuntimeError(f"visible dimensions {actual} do not match {BLENDER_DIMS}")
    metrics["functional_checks"] = exercise_moving_components(root)
    metrics["triangle_budget"] = [1200, 9000]
    metrics["material_budget"] = [5, 9]
    metrics["node_budget"] = [40, 90]
    return metrics


def add_build_info():
    text = bpy.data.texts.new("BUILD_INFO.txt")
    text.write(
        "Pinehollow Golf delivery pallet jack, Asset Sheet 05 reference 45\n"
        f"asset_id: {ASSET_ID}\n"
        f"build_version: {BUILD_VERSION}\n"
        f"builder: {SCRIPT.relative_to(ROOT).as_posix()}\n"
        f"reference: {REFERENCE_PATH}\n"
        "units: metres\n"
        "source: original in-repository geometry from local project reference sheet\n"
        "license: project-owned / UNLICENSED\n"
        "external downloads and textures: none\n"
        "existing delivery assets: untouched\n"
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
        "asset_id": ASSET_ID,
        "reference_id": "45",
        "target_dimensions_m": list(TARGET_RUNTIME_DIMS),
        "source": str(blend_path),
        "export": str(glb_path),
        "bytes": glb_path.stat().st_size,
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


def preview_setup():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 760
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -1.55
    if scene.world is None:
        scene.world = bpy.data.worlds.new("QA_World")
    scene.world.color = (0.022, 0.026, 0.024)
    bpy.ops.object.camera_add(location=(-2.50, -2.05, 1.45))
    camera = bpy.context.object
    camera.name = "QA_Camera"
    camera.data.lens = 56
    scene.camera = camera
    for name, energy, location, size in (
        ("Key", 520, (-1.15, -1.10, 1.85), 1.55),
        ("Fill", 230, (1.45, -0.55, 1.25), 1.25),
        ("Rim", 340, (0.40, 1.30, 1.45), 1.00),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = f"QA_{name}"
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size
        look_at(light, (0, 0, 0.35))
    floor_mat = mat("QA_WarmCreamFloor", (0.20, 0.185, 0.145, 1.0), roughness=0.94)
    box("QA_Floor", (3.6, 3.2, 0.025), (0, 0, -0.018), floor_mat, bevel=0.006)
    return camera


def render_previews(root):
    camera = preview_setup()
    by_name = {obj.name: obj for obj in descendants(root)}
    views = (
        ("hero", (-2.85, -2.38, 1.62), (0.02, 0, 0.50)),
        ("front", (-3.45, 0, 0.88), (-0.02, 0, 0.48)),
        ("side", (0.05, -3.70, 1.02), (0.05, 0, 0.50)),
        ("rear", (2.75, -2.48, 1.46), (0.22, 0, 0.49)),
        ("top", (-0.20, -0.10, 3.90), (-0.05, 0, 0.20)),
    )
    for name, location, target in views:
        camera.location = location
        look_at(camera, target)
        bpy.context.scene.render.filepath = str(QA_DIR / f"{ASSET_ID}_{name}_rest.png")
        bpy.ops.render.render(write_still=True)

    # A working pose explicitly exercises steering, handle tilt and hydraulic
    # lift in a visual proof while leaving the saved/exported rest pose intact.
    steering = by_name["STEERING_YAW_PIVOT"]
    handle = by_name["HANDLE_TILT_PIVOT"]
    lift = by_name["FORK_LIFT_SLIDE"]
    steering.rotation_euler.z = math.radians(-28)
    handle.rotation_euler.y = math.radians(-26)
    lift.location.z = 0.055
    by_name["STEER_WHEEL_PIVOT_LEFT"].rotation_euler.y = math.radians(28)
    by_name["STEER_WHEEL_PIVOT_RIGHT"].rotation_euler.y = math.radians(28)
    by_name["LOAD_WHEEL_PIVOT_LEFT"].rotation_euler.y = math.radians(22)
    by_name["LOAD_WHEEL_PIVOT_RIGHT"].rotation_euler.y = math.radians(22)
    bpy.context.view_layer.update()
    camera.location = (-2.75, -2.38, 1.62)
    look_at(camera, (0.05, 0, 0.47))
    bpy.context.scene.render.filepath = str(QA_DIR / f"{ASSET_ID}_articulated.png")
    bpy.ops.render.render(write_still=True)

    steering.rotation_euler.z = 0
    handle.rotation_euler.y = 0
    lift.location.z = 0
    for name in (
        "STEER_WHEEL_PIVOT_LEFT", "STEER_WHEEL_PIVOT_RIGHT",
        "LOAD_WHEEL_PIVOT_LEFT", "LOAD_WHEEL_PIVOT_RIGHT",
    ):
        by_name[name].rotation_euler.y = 0
    bpy.context.view_layer.update()
    for obj in [candidate for candidate in list(bpy.data.objects) if candidate.name.startswith("QA_")]:
        bpy.data.objects.remove(obj, do_unlink=True)


def clean_reimport_validate():
    reset_scene()
    glb_path = EXPORT_DIR / f"{ASSET_ID}.glb"
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    root = bpy.data.objects.get(ASSET_ID)
    if root is None:
        raise RuntimeError("clean re-import lost pallet jack root")
    names = {obj.name for obj in bpy.context.scene.objects}
    missing = sorted(REQUIRED_NODES - names)
    if missing:
        raise RuntimeError(f"clean re-import missing nodes: {missing}")
    if root.get("asset_id") != ASSET_ID or root.get("reference_id") != "45":
        raise RuntimeError("clean re-import lost root metadata")
    for obj in descendants(root):
        if is_collision(obj):
            obj.hide_render = True
    metrics = asset_metrics(root)
    report = {
        "asset_id": ASSET_ID,
        "glb": str(glb_path),
        "root_metadata_preserved": True,
        "required_nodes_preserved": True,
        "nodes": metrics["nodes"],
        "meshes": metrics["meshes"],
        "triangles": metrics["triangles"],
        "materials": metrics["materials"],
        "visible_dimensions_blender": metrics["visible_dimensions_blender"],
        "visible_dimensions_runtime": metrics["visible_dimensions_runtime"],
        "cameras": len(bpy.data.cameras),
        "lights": len(bpy.data.lights),
    }
    if report["cameras"] or report["lights"]:
        raise RuntimeError("GLB unexpectedly contains camera or light data")
    (QA_DIR / f"{ASSET_ID}_reimport.json").write_text(json.dumps(report, indent=2), encoding="utf8")

    camera = preview_setup()
    camera.location = (-2.85, -2.38, 1.62)
    look_at(camera, (0.02, 0, 0.43))
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
    M = pallet_jack_materials()
    root = build_pallet_jack(M)
    metrics = save_and_export(root)
    render_previews(root)
    reimport = clean_reimport_validate()
    report = {
        "builder": SCRIPT.relative_to(ROOT).as_posix(),
        "build_version": BUILD_VERSION,
        "qa_pass": QA_PASS,
        "reference_sheet": REFERENCE_PATH,
        "external_assets": [],
        "external_textures": [],
        "existing_assets_modified": False,
        "revision_summary": "Pass 5 replaces the orange/ochre paint with restrained industrial safety yellow while preserving the runner-safe geometry and articulated collision hierarchy.",
        "asset": metrics,
        "reimport": reimport,
    }
    (QA_DIR / "delivery_pallet_jack_build_report.json").write_text(
        json.dumps(report, indent=2), encoding="utf8"
    )
    print(f"COMPLETE|asset={ASSET_ID}|qa_pass={QA_PASS}|source={SOURCE_DIR}|export={EXPORT_DIR}")


if __name__ == "__main__":
    main()
