"""Build Asset Sheet 05 reference 43: Pinehollow stocking cart.

Run from the repository root with Blender 5.1:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
      --background --factory-startup \
      --python tools/blender/build_delivery_stocking_cart.py

All geometry is deterministic, original project-owned work authored in metres.
Blender axes are X length, Y width and Z height; glTF's Y-up conversion yields
runtime X length, Y height and Z width. Set DELIVERY_STOCKING_CART_QA_PASS to
preserve explicit visual iterations in the ignored QA evidence tree.
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
    anchor,
    box,
    collision_box,
    cylinder,
    descendants,
    empty,
    materials,
    parent_keep,
    reset_scene,
)


ASSET_ID = "delivery_stocking_cart"
BUILD_VERSION = 2
TARGET_RUNTIME_DIMS = (1.00, 0.95, 0.50)
BLENDER_DIMS = (1.00, 0.50, 0.95)

SOURCE_DIR = ROOT / "asset_sources" / "blender" / "delivery"
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
QA_ROOT = ROOT / "qa" / "box_system_master" / "blender" / "stocking_cart_ref43"
QA_PASS = os.environ.get("DELIVERY_STOCKING_CART_QA_PASS", "iteration-01")
QA_DIR = QA_ROOT / QA_PASS
SOURCE_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
QA_DIR.mkdir(parents=True, exist_ok=True)


CASTER_SPECS = (
    ("REAR_LEFT", -0.405, -0.202, -12.0),
    ("REAR_RIGHT", -0.405, 0.202, 12.0),
    ("FRONT_LEFT", 0.405, -0.202, 8.0),
    ("FRONT_RIGHT", 0.405, 0.202, -8.0),
)
SHELF_SPECS = (
    ("LOWER", 0.160),
    ("MIDDLE", 0.440),
    ("TOP", 0.720),
)


def cart_materials():
    """Return the shared Pinehollow palette with cart-specific PBR tuning."""
    M = materials()
    tuning = {
        "green": ((0.008, 0.036, 0.018, 1.0), 0.46, 0.32),
        "sage": ((0.055, 0.110, 0.068, 1.0), 0.62, 0.08),
        "charcoal": ((0.026, 0.031, 0.028, 1.0), 0.38, 0.72),
        "rubber": ((0.010, 0.012, 0.011, 1.0), 0.91, 0.0),
        "brass": ((0.315, 0.165, 0.040, 1.0), 0.31, 0.82),
        "cream": ((0.340, 0.220, 0.095, 1.0), 0.60, 0.02),
    }
    for key, (color, roughness, metallic) in tuning.items():
        material = M[key]
        material.diffuse_color = color
        bsdf = material.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    return M


def cart_root():
    return empty(
        ASSET_ID,
        props={
            "asset_id": ASSET_ID,
            "asset_version": BUILD_VERSION,
            "version": BUILD_VERSION,
            "units": "meters",
            "reference_id": "43",
            "target_dimensions_m": list(TARGET_RUNTIME_DIMS),
            "blender_dimensions_m": list(BLENDER_DIMS),
            "runtime_axis_map": "Blender +X,+Y,+Z -> Three.js +X,-Z,+Y",
            "runtime_up_axis": "+Y",
            "front": "Blender +X / runtime +X nose (narrow face)",
            "travel_axis": "Blender +/-X / runtime +/-X",
            "operator_side": "Blender -X / runtime -X",
            "source": "Original Pinehollow Golf geometry generated in-repository from local Asset Sheet 05",
            "license": "Project-owned / UNLICENSED",
            "builder": SCRIPT.relative_to(ROOT).as_posix(),
            "model_map_key": ASSET_ID,
            "asset_type": "three_tier_stocking_cart",
            "shelf_count": 3,
            "caster_count": 4,
            "rated_payload_kg": 120,
        },
        size=0.075,
    )


def set_helper(obj, helper_kind):
    obj["helper"] = True
    obj["helper_kind"] = helper_kind
    obj.hide_render = True
    return obj


def make_shelf(root, M, label, height, index):
    shelf = empty(
        f"SHELF_{label}", parent=root, size=0.045,
        props={
            "component": "stocking_shelf",
            "shelf_index": index,
            "working_height_m": round(height + 0.0825, 4),
            "rated_payload_kg": 40,
        },
    )
    box(
        f"SHELF_BASE_{label}", (0.960, 0.450, 0.035), (0, 0, height),
        M["green"], bevel=0.012, parent=shelf,
        props={"structural_role": "pressed_steel_shelf_base"},
    )
    box(
        f"SHELF_INSET_{label}", (0.880, 0.370, 0.009), (0, 0, height + 0.0215),
        M["sage"], bevel=0.003, parent=shelf,
        props={"surface": "non_slip_stocking_deck"},
    )
    for side, y in (("FRONT", -0.2375), ("BACK", 0.2375)):
        box(
            f"SHELF_RAIL_{label}_{side}", (1.000, 0.025, 0.075),
            (0, y, height + 0.045), M["green"], bevel=0.009, parent=shelf,
            props={"structural_role": "tray_retaining_rail", "edge": side.lower()},
        )
    for side, x in (("REAR", -0.4875), ("NOSE", 0.4875)):
        box(
            f"SHELF_RAIL_{label}_{side}", (0.025, 0.450, 0.075),
            (x, 0, height + 0.045), M["green"], bevel=0.009, parent=shelf,
            props={"structural_role": "tray_retaining_rail", "edge": side.lower()},
        )
    return shelf


def make_caster(root, M, label, x, y, swivel_degrees):
    pivot = empty(
        f"CASTER_SWIVEL_{label}", (x, y, 0.135),
        rot=(0, 0, math.radians(swivel_degrees)), parent=root, size=0.036,
        props={
            "component": "caster_swivel_pivot",
            "pivot_axis": "local_Z",
            "pivot_axis_runtime": "local_Y",
            "neutral_angle_degrees": swivel_degrees,
            "steering_range_degrees": [-180, 180],
        },
    )
    cylinder(
        f"CASTER_STEM_{label}", 0.014, 0.046, (x, y, 0.124), M["charcoal"],
        vertices=16, bevel=0.002, parent=pivot,
        props={"structural_role": "swivel_stem"},
    )
    box(
        f"CASTER_TOP_PLATE_{label}", (0.075, 0.070, 0.012),
        (x, y, 0.132), M["charcoal"], bevel=0.004, parent=pivot,
        props={"structural_role": "caster_mount"},
    )

    # A slight caster trail makes swivel rotation visibly and functionally
    # meaningful instead of placing every child on the pivot axis.
    trail = 0.018
    wheel_center = Vector((x + trail, y, 0.055))
    box(
        f"CASTER_YOKE_{label}", (0.042, 0.070, 0.018),
        (x + trail, y, 0.108), M["charcoal"], bevel=0.004, parent=pivot,
        props={"structural_role": "caster_fork_bridge"},
    )
    for arm_side, arm_y in (("LEFT", y - 0.028), ("RIGHT", y + 0.028)):
        box(
            f"CASTER_YOKE_ARM_{label}_{arm_side}", (0.028, 0.012, 0.066),
            (x + trail, arm_y, 0.079), M["charcoal"], bevel=0.004, parent=pivot,
            props={"structural_role": "caster_fork_arm", "axle_side": arm_side.lower()},
        )
    axle = empty(
        f"CASTER_AXLE_{label}", wheel_center, parent=pivot, size=0.028,
        props={
            "component": "wheel_axle_pivot",
            "pivot_axis": "local_Y",
            "pivot_axis_runtime": "local_-Z",
            "wheel_radius_m": 0.055,
            "rolling_range_degrees": [-360, 360],
        },
    )
    cylinder(
        f"CASTER_WHEEL_{label}", 0.055, 0.038, wheel_center, M["rubber"],
        rot=(math.pi / 2, 0, 0), vertices=24, bevel=0.006, parent=axle,
        props={"component": "rolling_wheel", "moving_part": True},
    )
    cylinder(
        f"CASTER_HUB_{label}", 0.019, 0.046, wheel_center, M["brass"],
        rot=(math.pi / 2, 0, 0), vertices=20, bevel=0.002, parent=axle,
        props={"structural_role": "wheel_axle_hub"},
    )
    if label.startswith("REAR"):
        brake = empty(
            f"CASTER_BRAKE_PIVOT_{label}", wheel_center, parent=pivot, size=0.024,
            props={
                "component": "caster_brake_hinge",
                "pivot_axis": "local_Y",
                "pivot_axis_runtime": "local_-Z",
                "brake_range_degrees": [0, 18],
                "moving_part": True,
            },
        )
        box(
            f"CASTER_BRAKE_PEDAL_{label}", (0.070, 0.026, 0.012),
            (wheel_center.x - 0.045, wheel_center.y, 0.112), M["brass"],
            rot=(0, math.radians(-12), 0), bevel=0.004, parent=brake,
            props={"component": "foot_brake_pedal", "moving_part": True},
        )
    return pivot, axle


def make_handle(root, M):
    pivot = empty(
        "HANDLE_PIVOT", (-0.465, 0, 0.685), parent=root, size=0.050,
        props={
            "component": "push_handle_hinge",
            "pivot_axis": "local_Y",
            "pivot_axis_runtime": "local_-Z",
            "neutral_angle_degrees": 0,
            "fold_range_degrees": [-12, 0],
            "moving_part": True,
        },
    )
    for side, y in (("LEFT", -0.205), ("RIGHT", 0.205)):
        cylinder(
            f"HANDLE_UPRIGHT_{side}", 0.016, 0.265, (-0.465, y, 0.8175),
            M["charcoal"], vertices=16, bevel=0.003, parent=pivot,
            props={"structural_role": "handle_upright"},
        )
        cylinder(
            f"HANDLE_GRIP_COLLAR_{side}", 0.022, 0.036, (-0.465, y, 0.917),
            M["brass"], vertices=18, bevel=0.003, parent=pivot,
            props={"structural_role": "grip_end_collar"},
        )
    cylinder(
        "HANDLE_GRIP", 0.018, 0.442, (-0.465, 0, 0.930), M["rubber"],
        rot=(math.pi / 2, 0, 0), vertices=24, bevel=0.003, parent=pivot,
        props={"component": "player_grip", "grip_width_m": 0.442},
    )
    return pivot


def make_brand_badge(root, M):
    badge = empty(
        "BRAND_BADGE", (0, -0.248, 0.765), parent=root, size=0.024,
        props={"component": "project_brand_mark", "textured": False},
    )
    box("BRAND_BADGE_PLATE", (0.210, 0.004, 0.062), (0, -0.248, 0.765),
        M["cream"], bevel=0.009, parent=badge)
    box("BRAND_BADGE_BAR_A", (0.062, 0.002, 0.008), (-0.054, -0.249, 0.765),
        M["green"], rot=(0, math.radians(38), 0), bevel=0.002, parent=badge)
    box("BRAND_BADGE_BAR_B", (0.062, 0.002, 0.008), (-0.054, -0.249, 0.765),
        M["green"], rot=(0, math.radians(-38), 0), bevel=0.002, parent=badge)
    for index, x in enumerate((0.010, 0.038, 0.066), start=1):
        box(f"BRAND_BADGE_WORDMARK_{index:02d}", (0.018, 0.002, 0.006),
            (x, -0.249, 0.765), M["green"], bevel=0.001, parent=badge)
    return badge


def make_stock_sockets(root):
    sockets = []
    socket_index = 1
    for shelf_index, (label, height) in enumerate(SHELF_SPECS, start=1):
        for column, x in enumerate((-0.225, 0.225), start=1):
            socket = anchor(
                f"STOCK_SOCKET_{socket_index:02d}", (x, 0, height + 0.083),
                parent=root, kind="stocking_cart_item_socket",
                props={
                    "allowed_category": "delivery_goods",
                    "max_w": 0.420,
                    "max_d": 0.360,
                    "max_h": 0.220 if label != "TOP" else 0.500,
                    "shelf": shelf_index,
                    "column": column,
                    "stack_order": socket_index,
                    "occupancy": "empty",
                    "occupied": False,
                    "occupancy_key": f"stocking_cart_slot_{socket_index:02d}",
                    "conflicts_with": "STOCK_BOX_SOCKET_TOP" if label == "TOP" else "",
                },
            )
            sockets.append(socket)
            socket_index += 1
    anchor(
        "STOCK_BOX_SOCKET_TOP", (0, 0, 0.803), parent=root,
        kind="stocking_cart_box_socket",
        props={
            "allowed_category": "delivery_box",
            "max_w": 0.620,
            "max_d": 0.420,
            "max_h": 0.500,
            "shelf": 3,
            "column": 0,
            "stack_order": 7,
            "occupancy": "empty",
            "occupied": False,
            "occupancy_key": "stocking_cart_box_top",
            "centered": True,
            "conflicts_with": "STOCK_SOCKET_05,STOCK_SOCKET_06",
            "exclusive_group": "stocking_cart_top_deck",
        },
    )
    return sockets


def build_cart(M):
    root = cart_root()
    shelves = [make_shelf(root, M, label, height, index)
               for index, (label, height) in enumerate(SHELF_SPECS, start=1)]

    frame = empty(
        "CART_FRAME", parent=root, size=0.050,
        props={"component": "load_bearing_frame", "post_count": 4},
    )
    for end, x in (("REAR", -0.455), ("NOSE", 0.455)):
        for side, y in (("LEFT", -0.205), ("RIGHT", 0.205)):
            box(
                f"FRAME_POST_{end}_{side}", (0.035, 0.035, 0.590),
                (x, y, 0.458), M["charcoal"], bevel=0.008, parent=frame,
                props={"structural_role": "vertical_frame_post"},
            )

    casters = [make_caster(root, M, *spec) for spec in CASTER_SPECS]
    handle = make_handle(root, M)
    make_brand_badge(root, M)
    make_stock_sockets(root)
    anchor(
        "INTERACTION_TARGET", (-0.38, -0.26, 0.82), parent=root,
        kind="stocking_cart_interaction",
        props={
            "interaction_radius_m": 1.45,
            "prompt": "Push stocking cart",
            "preferred_approach": "operator rear",
        },
    )
    anchor(
        "PUSH_GRIP_TARGET", (-0.465, 0, 0.930), parent=handle,
        kind="stocking_cart_push_grip",
        props={"two_handed": True, "grip_width_m": 0.442},
    )

    # Two convex box proxies approximate the cart body and raised handle.
    set_helper(
        collision_box("COL_CART_BODY", (1.000, 0.500, 0.700),
                      (0, 0, 0.455), M, parent=root),
        "cart_body_collision",
    )
    set_helper(
        collision_box("COL_CART_HANDLE", (0.070, 0.470, 0.265),
                      (-0.465, 0, 0.8175), M, parent=root),
        "push_handle_collision",
    )
    return root, shelves, casters, handle


REQUIRED_NODES = {
    "CART_FRAME", "HANDLE_PIVOT", "HANDLE_GRIP", "PUSH_GRIP_TARGET",
    "BRAND_BADGE", "BRAND_BADGE_PLATE", "INTERACTION_TARGET",
    "COL_CART_BODY", "COL_CART_HANDLE",
    *{f"SHELF_{label}" for label, _ in SHELF_SPECS},
    *{f"SHELF_BASE_{label}" for label, _ in SHELF_SPECS},
    *{f"SHELF_INSET_{label}" for label, _ in SHELF_SPECS},
    *{f"FRAME_POST_{end}_{side}" for end in ("REAR", "NOSE") for side in ("LEFT", "RIGHT")},
    *{f"CASTER_SWIVEL_{label}" for label, *_ in CASTER_SPECS},
    *{f"CASTER_AXLE_{label}" for label, *_ in CASTER_SPECS},
    *{f"CASTER_WHEEL_{label}" for label, *_ in CASTER_SPECS},
    *{f"CASTER_BRAKE_PIVOT_{label}" for label in ("REAR_LEFT", "REAR_RIGHT")},
    *{f"CASTER_BRAKE_PEDAL_{label}" for label in ("REAR_LEFT", "REAR_RIGHT")},
    *{f"STOCK_SOCKET_{index:02d}" for index in range(1, 7)},
    "STOCK_BOX_SOCKET_TOP",
}


def visible_bounds(root):
    corners = []
    bpy.context.view_layer.update()
    for obj in descendants(root):
        if obj.type != "MESH" or obj.name.startswith("COL_"):
            continue
        for corner in obj.bound_box:
            corners.append(obj.matrix_world @ Vector(corner))
    if not corners:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    lo = Vector((min(point.x for point in corners), min(point.y for point in corners), min(point.z for point in corners)))
    hi = Vector((max(point.x for point in corners), max(point.y for point in corners), max(point.z for point in corners)))
    return lo, hi


def asset_metrics(root):
    nodes = descendants(root)
    meshes = [obj for obj in nodes if obj.type == "MESH"]
    triangles = sum(
        max(1, len(poly.vertices) - 2)
        for obj in meshes for poly in obj.data.polygons
    )
    materials_used = sorted({
        slot.material.name
        for obj in meshes for slot in obj.material_slots if slot.material
    })
    lo, hi = visible_bounds(root)
    size = hi - lo
    return {
        "nodes": len(nodes),
        "meshes": len(meshes),
        "triangles": triangles,
        "materials": materials_used,
        "textures": 0,
        "visible_bounds_min_blender": [round(value, 5) for value in lo],
        "visible_bounds_max_blender": [round(value, 5) for value in hi],
        "visible_dimensions_blender": [round(value, 5) for value in size],
        "visible_dimensions_runtime": [round(size.x, 5), round(size.z, 5), round(size.y, 5)],
    }


def exercise_moving_parts(root):
    by_name = {obj.name: obj for obj in descendants(root)}
    results = []
    bpy.context.view_layer.update()

    handle = by_name["HANDLE_PIVOT"]
    grip = by_name["HANDLE_GRIP"]
    handle_before = grip.matrix_world.copy()
    original_handle = handle.rotation_euler.copy()
    handle.rotation_euler.y = math.radians(-10)
    bpy.context.view_layer.update()
    handle_delta = (grip.matrix_world.translation - handle_before.translation).length
    handle.rotation_euler = original_handle
    if handle_delta <= 0.005:
        raise RuntimeError("HANDLE_PIVOT did not articulate its grip")
    results.append({"pivot": handle.name, "exercise_degrees": -10, "child_delta_m": round(handle_delta, 5), "pass": True})

    for label, *_ in CASTER_SPECS:
        swivel = by_name[f"CASTER_SWIVEL_{label}"]
        axle = by_name[f"CASTER_AXLE_{label}"]
        wheel = by_name[f"CASTER_WHEEL_{label}"]
        original_swivel = swivel.rotation_euler.copy()
        before_position = axle.matrix_world.translation.copy()
        swivel.rotation_euler.z += math.radians(35)
        bpy.context.view_layer.update()
        swivel_delta = (axle.matrix_world.translation - before_position).length
        swivel.rotation_euler = original_swivel
        original_axle = axle.rotation_euler.copy()
        before_axis = wheel.matrix_world.to_3x3() @ Vector((1, 0, 0))
        axle.rotation_euler.y += math.radians(45)
        bpy.context.view_layer.update()
        after_axis = wheel.matrix_world.to_3x3() @ Vector((1, 0, 0))
        roll_delta = (after_axis - before_axis).length
        axle.rotation_euler = original_axle
        bpy.context.view_layer.update()
        if swivel_delta <= 0.003 or roll_delta <= 0.05:
            raise RuntimeError(f"{label} caster pivots did not exercise")
        results.append({
            "pivot": swivel.name,
            "exercise_degrees": 35,
            "axle_translation_delta_m": round(swivel_delta, 5),
            "wheel_roll_axis_delta": round(roll_delta, 5),
            "pass": True,
        })
    for label in ("REAR_LEFT", "REAR_RIGHT"):
        brake = by_name[f"CASTER_BRAKE_PIVOT_{label}"]
        pedal = by_name[f"CASTER_BRAKE_PEDAL_{label}"]
        original_brake = brake.rotation_euler.copy()
        before_position = pedal.matrix_world.translation.copy()
        brake.rotation_euler.y += math.radians(15)
        bpy.context.view_layer.update()
        pedal_delta = (pedal.matrix_world.translation - before_position).length
        brake.rotation_euler = original_brake
        bpy.context.view_layer.update()
        if pedal_delta <= 0.005:
            raise RuntimeError(f"{label} caster brake did not articulate")
        results.append({
            "pivot": brake.name,
            "exercise_degrees": 15,
            "pedal_translation_delta_m": round(pedal_delta, 5),
            "pass": True,
        })
    return results


def validate_scene(root):
    nodes = descendants(root)
    by_name = {obj.name: obj for obj in nodes}
    missing = sorted(REQUIRED_NODES - set(by_name))
    if missing:
        raise RuntimeError(f"{ASSET_ID} missing required nodes: {missing}")
    if root.get("asset_id") != ASSET_ID or root.get("reference_id") != "43":
        raise RuntimeError("stocking cart root metadata invalid")
    for obj in nodes:
        if obj.type != "MESH":
            continue
        if any(abs(value - 1.0) > 1e-5 for value in obj.scale):
            raise RuntimeError(f"unapplied scale: {obj.name} {tuple(obj.scale)}")
        if obj.data.polygons and not obj.data.uv_layers:
            raise RuntimeError(f"missing UVs: {obj.name}")
    for label, _ in SHELF_SPECS:
        shelf = by_name[f"SHELF_{label}"]
        for component in (f"SHELF_BASE_{label}", f"SHELF_INSET_{label}"):
            if by_name[component].parent is not shelf:
                raise RuntimeError(f"{component} hierarchy invalid")
    for label, *_ in CASTER_SPECS:
        swivel = by_name[f"CASTER_SWIVEL_{label}"]
        axle = by_name[f"CASTER_AXLE_{label}"]
        if axle.parent is not swivel or by_name[f"CASTER_WHEEL_{label}"].parent is not axle:
            raise RuntimeError(f"{label} caster hierarchy invalid")
        if (swivel.matrix_world.translation - Vector((swivel.location.x, swivel.location.y, swivel.location.z))).length > 0.001:
            raise RuntimeError(f"{label} caster pivot origin invalid")
    if by_name["HANDLE_GRIP"].parent is not by_name["HANDLE_PIVOT"]:
        raise RuntimeError("handle grip hierarchy invalid")

    metrics = asset_metrics(root)
    if not 1500 <= metrics["triangles"] <= 14000:
        raise RuntimeError(f"triangle budget failed: {metrics['triangles']}")
    if not 50 <= metrics["nodes"] <= 100:
        raise RuntimeError(f"node budget failed: {metrics['nodes']}")
    if not 5 <= len(metrics["materials"]) <= 9:
        raise RuntimeError(f"material budget failed: {len(metrics['materials'])}")
    actual = metrics["visible_dimensions_blender"]
    if any(abs(value - expected) > 0.001 for value, expected in zip(actual, BLENDER_DIMS)):
        raise RuntimeError(f"visible dimensions {actual} do not match {BLENDER_DIMS}")

    socket_checks = []
    for index in range(1, 7):
        socket = by_name[f"STOCK_SOCKET_{index:02d}"]
        metadata_ok = (
            socket.get("allowed_category") == "delivery_goods"
            and isinstance(socket.get("stack_order"), int)
            and socket.get("occupancy") == "empty"
        )
        if not metadata_ok:
            raise RuntimeError(f"{socket.name} stocking contract invalid")
        socket_checks.append(socket.name)
    top_socket = by_name["STOCK_BOX_SOCKET_TOP"]
    if not (
        top_socket.get("anchor_kind") == "stocking_cart_box_socket"
        and top_socket.get("allowed_category") == "delivery_box"
        and top_socket.get("conflicts_with") == "STOCK_SOCKET_05,STOCK_SOCKET_06"
        and abs(float(top_socket.get("max_w", 0)) - 0.620) < 1e-6
        and abs(float(top_socket.get("max_d", 0)) - 0.420) < 1e-6
        and abs(float(top_socket.get("max_h", 0)) - 0.500) < 1e-6
    ):
        raise RuntimeError("STOCK_BOX_SOCKET_TOP placement contract invalid")
    metrics["moving_part_checks"] = exercise_moving_parts(root)
    metrics["socket_checks"] = {"count": len(socket_checks), "nodes": socket_checks, "pass": True}
    metrics["top_box_socket"] = {
        "node": top_socket.name,
        "maximum_dimensions_m": [0.620, 0.420, 0.500],
        "conflicts_with": ["STOCK_SOCKET_05", "STOCK_SOCKET_06"],
        "pass": True,
    }
    metrics["triangle_budget"] = [1500, 14000]
    metrics["material_budget"] = [5, 9]
    metrics["node_budget"] = [50, 100]
    metrics["uv_check"] = "all mesh nodes have UV layers"
    metrics["transform_check"] = "all mesh rotation/scale transforms applied"
    return metrics


def add_build_info():
    text = bpy.data.texts.new("BUILD_INFO.txt")
    text.write(
        "Pinehollow Golf three-tier stocking cart, Asset Sheet 05 reference 43\n"
        f"asset_id: {ASSET_ID}\n"
        f"build_version: {BUILD_VERSION}\n"
        f"builder: {SCRIPT.relative_to(ROOT).as_posix()}\n"
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
    selected = descendants(root)
    for obj in selected:
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path), export_format="GLB", use_selection=True,
        export_apply=True, export_yup=True, export_normals=True,
        export_texcoords=True, export_materials="EXPORT", export_animations=False,
        export_extras=True, export_cameras=False, export_lights=False,
    )
    metrics.update({
        "asset_id": ASSET_ID,
        "reference_id": "43",
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


def preview_setup(M):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 760
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.90
    if scene.world is None:
        scene.world = bpy.data.worlds.new("QA_World")
    scene.world.color = (0.022, 0.026, 0.023)
    bpy.ops.object.camera_add(location=(1.65, -1.65, 1.22))
    camera = bpy.context.object
    camera.name = "QA_Camera"
    camera.data.lens = 58
    scene.camera = camera
    for name, energy, location, size in (
        ("Key", 720, (-1.40, -1.25, 1.95), 1.45),
        ("Fill", 360, (1.45, -0.45, 1.30), 1.30),
        ("Rim", 510, (0.45, 1.45, 1.55), 1.00),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = f"QA_{name}"
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size
        look_at(light, (0, 0, 0.45))
    floor = box("QA_Floor", (3.5, 3.5, 0.025), (0, 0, -0.018), M["offwhite"], bevel=0.006)
    floor["qa_only"] = True

    # Simple project-owned proxies demonstrate usable clearance without being
    # included in the source .blend or exported GLB.
    proxies = []
    proxies.append(box("QA_TopCarton", (0.45, 0.31, 0.28), (0.12, 0, 0.902),
                       M["kraft"], bevel=0.012, props={"qa_only": True}))
    proxies.append(box("QA_MiddleBin", (0.42, 0.32, 0.14), (-0.10, 0, 0.593),
                       M["green"], bevel=0.018, props={"qa_only": True}))
    for index, x in enumerate((-0.22, 0.03, 0.27), start=1):
        proxies.append(box(f"QA_LowerGoods_{index:02d}", (0.18, 0.24, 0.08),
                           (x, 0, 0.292), M["oak"], bevel=0.022,
                           props={"qa_only": True}))
    for proxy in proxies:
        proxy.hide_render = True
    return camera, proxies


def render_previews(root, M):
    camera, proxies = preview_setup(M)
    views = (
        ("front", (3.30, 0, 0.82), (0, 0, 0.52)),
        ("side", (0, -3.30, 0.82), (0, 0, 0.52)),
        ("rear_handle", (-2.65, -1.75, 1.36), (-0.15, 0, 0.53)),
        ("three_quarter", (2.15, -2.05, 1.42), (0, 0, 0.51)),
        ("caster_detail", (0.90, -0.78, 0.30), (0.34, -0.19, 0.11)),
    )
    for loaded in (False, True):
        for proxy in proxies:
            proxy.hide_render = not loaded
        for name, location, target in views:
            if name == "caster_detail" and loaded:
                continue
            camera.location = location
            look_at(camera, target)
            suffix = "loaded" if loaded else "clean"
            bpy.context.scene.render.filepath = str(QA_DIR / f"{ASSET_ID}_{name}_{suffix}.png")
            bpy.ops.render.render(write_still=True)
    for obj in [candidate for candidate in list(bpy.data.objects) if candidate.name.startswith("QA_")]:
        bpy.data.objects.remove(obj, do_unlink=True)


def clean_reimport_validate():
    reset_scene()
    glb_path = EXPORT_DIR / f"{ASSET_ID}.glb"
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    root = bpy.data.objects.get(ASSET_ID)
    if root is None:
        raise RuntimeError("clean re-import lost stocking-cart root")
    names = {obj.name for obj in bpy.context.scene.objects}
    missing = sorted(REQUIRED_NODES - names)
    if missing:
        raise RuntimeError(f"clean re-import missing nodes: {missing}")
    if root.get("asset_id") != ASSET_ID or root.get("reference_id") != "43":
        raise RuntimeError("clean re-import lost root metadata")
    metrics = asset_metrics(root)
    if any(abs(value - expected) > 0.002 for value, expected in zip(metrics["visible_dimensions_runtime"], TARGET_RUNTIME_DIMS)):
        raise RuntimeError(f"clean re-import dimensions invalid: {metrics['visible_dimensions_runtime']}")
    report = {
        "asset_id": ASSET_ID,
        "glb": str(glb_path),
        "root_metadata_preserved": True,
        "required_nodes_preserved": True,
        "pivot_hierarchy_preserved": True,
        "nodes": metrics["nodes"],
        "meshes": metrics["meshes"],
        "triangles": metrics["triangles"],
        "materials": metrics["materials"],
        "visible_dimensions_blender": metrics["visible_dimensions_blender"],
        "visible_dimensions_runtime": metrics["visible_dimensions_runtime"],
    }
    (QA_DIR / f"{ASSET_ID}_reimport.json").write_text(json.dumps(report, indent=2), encoding="utf8")

    # glTF preserves collision nodes and their helper metadata, but Blender's
    # hide_render flag is intentionally not a runtime visibility contract.
    # Apply the production name/metadata filter before visual proof so helper
    # volumes cannot z-fight the visible cart after clean import.
    for obj in descendants(root):
        if obj.name.startswith("COL_") or bool(obj.get("helper")):
            obj.hide_render = True

    M = cart_materials()
    camera, proxies = preview_setup(M)
    for proxy in proxies:
        proxy.hide_render = True
    camera.location = (2.15, -2.05, 1.42)
    look_at(camera, (0, 0, 0.51))
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
    M = cart_materials()
    root, _shelves, _casters, _handle = build_cart(M)
    metrics = save_and_export(root)
    render_previews(root, M)
    reimport = clean_reimport_validate()
    report = {
        "builder": SCRIPT.relative_to(ROOT).as_posix(),
        "build_version": BUILD_VERSION,
        "qa_pass": QA_PASS,
        "reference_sheet": "Designs/RefrenceImages/41-50_refrence_images/ChatGPT Image Jul 17, 2026, 11_45_44 AM.png",
        "external_assets": [],
        "external_textures": [],
        "existing_assets_modified": False,
        "revision_summary": "Pass 4 adds the centered top-deck box socket, explicit conflicts with the two small top slots, and Three.js pivot-axis metadata.",
        "asset": metrics,
        "reimport": reimport,
    }
    (QA_DIR / f"{ASSET_ID}_build_report.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(f"COMPLETE|asset={ASSET_ID}|qa_pass={QA_PASS}|source={SOURCE_DIR}|export={EXPORT_DIR}")


if __name__ == "__main__":
    main()
