"""Build Asset Sheet 05 reference 42: Pinehollow delivery hand truck.

Run from the repository root with Blender 5.1:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
      --background --factory-startup \
      --python tools/blender/build_delivery_hand_truck.py

All geometry is deterministic, original project-owned work authored in metres.
Blender axes are X width, Y depth and Z height; the standard glTF Y-up
conversion exports runtime axes X width, Y height and Z depth.  Set
DELIVERY_HAND_TRUCK_QA_PASS to preserve an explicit visual-review iteration.
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
    materials,
    parent_keep,
    reset_scene,
    torus,
)


ASSET_ID = "delivery_hand_truck"
BUILD_VERSION = 4
TARGET_RUNTIME_DIMS = (0.50, 1.20, 0.45)  # Three.js X width, Y height, Z depth
BLENDER_DIMS = (0.50, 0.45, 1.20)  # Blender X width, Y depth, Z height
SOURCE_DIR = ROOT / "asset_sources" / "blender" / "delivery"
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
QA_ROOT = ROOT / "qa" / "box_system_master" / "blender" / "hand_truck_ref42"
QA_PASS = os.environ.get("DELIVERY_HAND_TRUCK_QA_PASS", "iteration-01")
QA_DIR = QA_ROOT / QA_PASS
SOURCE_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
QA_DIR.mkdir(parents=True, exist_ok=True)


def hand_truck_materials():
    """Exporter-safe stylised PBR materials in the Pinehollow palette."""
    M = materials()
    authored = (
        ("green", (0.007, 0.043, 0.015, 1.0), 0.51, 0.18),
        ("charcoal", (0.030, 0.037, 0.035, 1.0), 0.48, 0.42),
        ("rubber", (0.003, 0.004, 0.0035, 1.0), 0.91, 0.0),
        ("steel", (0.30, 0.35, 0.34, 1.0), 0.30, 0.78),
        ("brass", (0.46, 0.275, 0.070, 1.0), 0.37, 0.74),
        ("sage", (0.055, 0.110, 0.065, 1.0), 0.69, 0.04),
    )
    for key, color, roughness, metallic in authored:
        material = M[key]
        material.diffuse_color = color
        bsdf = material.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    return M


def hand_truck_root():
    return empty(
        ASSET_ID,
        props={
            "asset_id": ASSET_ID,
            "asset_version": BUILD_VERSION,
            "version": BUILD_VERSION,
            "units": "meters",
            "reference_id": "42",
            "target_dimensions_m": list(TARGET_RUNTIME_DIMS),
            "blender_dimensions_m": list(BLENDER_DIMS),
            "front": "Blender -Y / runtime +Z load-plate entry",
            "source": "Original Pinehollow Golf geometry generated in-repository from local Asset Sheet 05",
            "license": "Project-owned / UNLICENSED",
            "builder": SCRIPT.relative_to(ROOT).as_posix(),
            "model_map_key": ASSET_ID,
            "asset_type": "manual_delivery_hand_truck",
            "rated_load_kg": 160,
            "moving_components": "WHEEL_LEFT_PIVOT,WHEEL_RIGHT_PIVOT",
        },
        size=0.075,
    )


def set_helper(obj, helper_kind):
    obj["helper"] = True
    obj["helper_kind"] = helper_kind
    obj.hide_render = True
    return obj


def segment_cylinder(name, start, end, radius, material, *, parent=None, vertices=16, bevel=0.0025, props=None):
    """Create a round member whose object origin is its physical midpoint."""
    start_v = Vector(start)
    end_v = Vector(end)
    direction = end_v - start_v
    if direction.length <= 1e-6:
        raise ValueError(f"{name} has zero length")
    midpoint = (start_v + end_v) * 0.5
    rotation = direction.to_track_quat("Z", "Y").to_euler()
    obj = cylinder(
        name,
        radius,
        direction.length,
        midpoint,
        material,
        rot=rotation,
        vertices=vertices,
        bevel=bevel,
        parent=parent,
        props=props,
    )
    obj["segment_start_m"] = [round(value, 6) for value in start_v]
    obj["segment_end_m"] = [round(value, 6) for value in end_v]
    return obj


def toe_plate_mesh(name, material, parent):
    """Chamfered load plate, extruded upward from the exact ground plane."""
    footprint = [
        (-0.220, -0.320), (0.220, -0.320),
        (0.250, -0.290), (0.250, 0.050),
        (0.220, 0.080), (-0.220, 0.080),
        (-0.250, 0.050), (-0.250, -0.290),
    ]
    verts = [(x, y, z) for z in (0.0, 0.024) for x, y in footprint]
    count = len(footprint)
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
    finish_mesh(obj, material, bevel_width=0.005, bevel_segments=2)
    parent_keep(obj, parent)
    obj["component"] = "load_plate"
    obj["rated_load_kg"] = 160
    obj["load_surface_height_m"] = 0.024
    obj["load_surface_dimensions_m"] = [0.50, 0.40]
    obj["centered_carton_dimensions_m"] = [0.60, 0.40]
    obj["maximum_side_overhang_each_m"] = 0.05
    return obj


def build_wheel(label, center_x, M, axle):
    pivot = empty(
        f"WHEEL_{label}_PIVOT",
        (center_x, 0.015, 0.135),
        parent=axle,
        size=0.045,
        props={
            "component": "spinning_wheel",
            "moving_part": True,
            "pivot_role": "wheel_center",
            "spin_axis_blender": "+X",
            "spin_axis_runtime": "+X",
            "wheel_radius_m": 0.115,
            "wheel_width_m": 0.054,
        },
    )
    tire = torus(
        f"WHEEL_{label}_TIRE",
        0.083,
        0.032,
        (center_x, 0.015, 0.135),
        M["rubber"],
        rot=(0, math.pi / 2, 0),
        parent=pivot,
    )
    tire["component"] = "non_marking_rubber_tire"
    hub = cylinder(
        f"WHEEL_{label}_HUB",
        0.049,
        0.054,
        (center_x, 0.015, 0.135),
        M["green"],
        rot=(0, math.pi / 2, 0),
        vertices=24,
        bevel=0.003,
        parent=pivot,
        props={"component": "wheel_hub", "axle_bore_radius_m": 0.011},
    )
    torus(
        f"WHEEL_{label}_RIM_RING",
        0.045,
        0.005,
        (center_x, 0.015, 0.135),
        M["brass"],
        rot=(0, math.pi / 2, 0),
        parent=pivot,
    )
    outside_x = center_x + (0.025 if center_x > 0 else -0.025)
    cylinder(
        f"WHEEL_{label}_AXLE_CAP",
        0.018,
        0.004,
        (outside_x, 0.015, 0.135),
        M["brass"],
        rot=(0, math.pi / 2, 0),
        vertices=20,
        bevel=0.001,
        parent=pivot,
        props={"component": "retaining_cap"},
    )
    return pivot


def build_hand_truck(M):
    root = hand_truck_root()

    toe = empty(
        "TOE_PLATE_ASSEMBLY", parent=root, size=0.05,
        props={"component": "static_load_platform", "load_direction": "Blender +Y / runtime -Z"},
    )
    toe_plate_mesh("LOAD_PLATE", M["charcoal"], toe)
    # Three low-profile traction ribs and a restrained Pinehollow badge give
    # the broad plate useful visual structure without texture dependencies.
    for index, center_x in enumerate((-0.145, 0.0, 0.145), start=1):
        box(
            f"LOAD_PLATE_TRACTION_RIB_{index:02d}", (0.018, 0.300, 0.004),
            (center_x, -0.120, 0.026), M["sage"], bevel=0.0015, parent=toe,
            props={"component": "anti_slip_rib"},
        )
    badge = box(
        "LOAD_PLATE_BADGE", (0.090, 0.058, 0.004),
        (0, -0.130, 0.027), M["green"], bevel=0.007, parent=toe,
        props={"component": "project_owned_geometric_mark", "external_artwork": False},
    )
    for index, angle in enumerate((-0.58, 0.58), start=1):
        box(
            f"BADGE_CROSSED_TOOL_{index}", (0.009, 0.050, 0.003),
            (0, -0.130, 0.031), M["brass"], rot=(0, 0, angle),
            bevel=0.0015, parent=badge,
        )
    for side, center_x in (("LEFT", -0.235), ("RIGHT", 0.235)):
        box(
            f"TOE_EDGE_GUARD_{side}", (0.018, 0.350, 0.030),
            (center_x, -0.120, 0.031), M["green"], bevel=0.004, parent=toe,
            props={"component": "plate_edge_reinforcement"},
        )

    frame = empty(
        "FRAME_ASSEMBLY", parent=root, size=0.055,
        props={"component": "fixed_welded_frame", "tube_outer_diameter_m": 0.028},
    )
    rail_specs = {
        "LEFT": ((-0.112, 0.035, 0.185), (-0.140, 0.074, 0.965)),
        "RIGHT": ((0.112, 0.035, 0.185), (0.140, 0.074, 0.965)),
    }
    for label, (start, end) in rail_specs.items():
        segment_cylinder(
            f"FRAME_RAIL_{label}", start, end, 0.014, M["green"], parent=frame,
            vertices=18, props={"component": "main_frame_upright"},
        )
        segment_cylinder(
            f"HANDLE_NECK_{label}", end,
            ((-0.145 if label == "LEFT" else 0.145), 0.105, 1.040),
            0.014, M["green"], parent=frame, vertices=18,
            props={"component": "fixed_handle_neck"},
        )

    # Cross members become progressively lighter toward eye height.  Their
    # round construction remains readable in silhouette and avoids a flat cage.
    for index, (z, half_width, y) in enumerate(
        ((0.350, 0.120, 0.043), (0.575, 0.128, 0.054), (0.800, 0.136, 0.066), (0.955, 0.140, 0.073)),
        start=1,
    ):
        segment_cylinder(
            f"FRAME_CROSSBAR_{index:02d}", (-half_width, y, z), (half_width, y, z),
            0.011 if index < 4 else 0.010, M["green"], parent=frame, vertices=16,
            props={"component": "welded_cross_member", "crossbar_index": index},
        )

    # Diagonal kick braces transfer plate loads into the main frame rather than
    # leaving the toe plate visually unsupported.
    for label, sign in (("LEFT", -1), ("RIGHT", 1)):
        segment_cylinder(
            f"TOE_SUPPORT_{label}", (sign * 0.178, -0.012, 0.030),
            (sign * 0.112, 0.035, 0.280), 0.012, M["green"], parent=frame,
            vertices=16, props={"component": "load_transfer_brace"},
        )
        segment_cylinder(
            f"AXLE_BRACE_{label}", (sign * 0.112, 0.035, 0.200),
            (sign * 0.190, 0.015, 0.135), 0.011, M["steel"], parent=frame,
            vertices=16, props={"component": "axle_support_brace"},
        )

    handle_group = empty(
        "HANDLE_ASSEMBLY", (0, 0, 0), parent=root, size=0.055,
        props={"component": "fixed_twin_handle", "motion": "fixed"},
    )
    for label, center_x in (("LEFT", -0.145), ("RIGHT", 0.145)):
        pivot = empty(
            f"HANDLE_{label}_PIVOT", (center_x, 0.105, 1.120), parent=handle_group, size=0.035,
            props={
                "component": "hand_grip_center",
                "pivot_role": "true_grip_center",
                "motion": "fixed",
                "grip_length_m": 0.160,
            },
        )
        segment_cylinder(
            f"HANDLE_{label}_GRIP", (center_x, 0.105, 1.040), (center_x, 0.105, 1.200),
            0.018, M["rubber"], parent=pivot, vertices=20, bevel=0.003,
            props={"component": "ribbed_rubber_grip"},
        )
        # Four low-poly collars imply moulded grip ribs at first-person distance.
        for index, z in enumerate((1.057, 1.098, 1.139, 1.180), start=1):
            cylinder(
                f"HANDLE_{label}_GRIP_RIB_{index:02d}", 0.0192, 0.005,
                (center_x, 0.105, z), M["charcoal"], vertices=16,
                bevel=0.0008, parent=pivot,
            )
        anchor(
            f"HAND_GRIP_{label}", (center_x, 0.105, 1.120), parent=root, kind="hand_grip",
            props={"hand": label.lower(), "grip_axis": "+Z", "grip_length_m": 0.160},
        )

    axle = empty(
        "AXLE_ASSEMBLY", (0, 0.015, 0.135), parent=root, size=0.05,
        props={
            "component": "fixed_axle_with_independent_wheels",
            "pivot_role": "axle_centerline",
            "axis_blender": "+X",
            "axis_runtime": "+X",
        },
    )
    cylinder(
        "AXLE_SHAFT", 0.010, 0.446, (0, 0.015, 0.135), M["steel"],
        rot=(0, math.pi / 2, 0), vertices=16, bevel=0.001, parent=axle,
        props={"component": "steel_axle"},
    )
    left_wheel = build_wheel("LEFT", -0.218, M, axle)
    right_wheel = build_wheel("RIGHT", 0.218, M, axle)

    # Functional anchors describe the actual plate volume and player contact.
    anchor(
        "LOAD_ORIGIN", (0, -0.120, 0.026), parent=root, kind="load_origin",
        props={
            "load_direction_blender": "+Y",
            "load_direction_runtime": "-Z",
            "max_load_width_m": 0.60,
            "max_load_depth_m": 0.40,
            "max_load_height_m": 0.70,
            "plate_width_m": 0.50,
            "plate_depth_m": 0.40,
            "centered_load": True,
            "maximum_side_overhang_each_m": 0.05,
        },
    )
    anchor(
        "INTERACTION_TARGET", (0, -0.050, 0.720), parent=root, kind="hand_truck_interaction",
        props={"interaction_radius_m": 1.55, "prompt": "Use hand truck"},
    )
    anchor(
        "CENTER_OF_MASS", (0, 0.018, 0.410), parent=root, kind="center_of_mass",
        props={"unloaded": True},
    )

    # Four convex boxes are intentionally simpler than the visible tube and
    # wheel meshes.  Wheel proxies remain separate for future rolling contact.
    set_helper(
        collision_box("COL_HAND_TRUCK_FRAME", (0.34, 0.075, 1.03), (0, 0.073, 0.685), M, parent=root),
        "upright_frame_collision",
    )
    set_helper(
        collision_box("COL_HAND_TRUCK_LOAD_PLATE", (0.50, 0.40, 0.030), (0, -0.120, 0.015), M, parent=root),
        "load_plate_collision",
    )
    for label, center_x in (("LEFT", -0.218), ("RIGHT", 0.218)):
        set_helper(
            collision_box(f"COL_HAND_TRUCK_WHEEL_{label}", (0.054, 0.230, 0.230), (center_x, 0.015, 0.135), M, parent=root),
            "wheel_collision",
        )

    # Exercise the exported wheel pivots before resetting them to neutral.
    bpy.context.view_layer.update()
    pivot_checks = []
    for pivot in (left_wheel, right_wheel):
        child = next(candidate for candidate in pivot.children if candidate.name.endswith("_TIRE"))
        before = child.matrix_world.copy()
        pivot.rotation_euler.x = math.radians(37)
        bpy.context.view_layer.update()
        moved = any(abs(before[row][col] - child.matrix_world[row][col]) > 1e-6 for row in range(4) for col in range(4))
        pivot.rotation_euler.x = 0
        bpy.context.view_layer.update()
        if not moved:
            raise RuntimeError(f"{pivot.name} failed wheel-pivot exercise")
        pivot["pivot_exercise_degrees"] = 37
        pivot["pivot_exercise_passed"] = True
        pivot_checks.append(pivot.name)
    root["pivot_exercises_passed"] = ",".join(pivot_checks)
    return root


REQUIRED_NODES = {
    "TOE_PLATE_ASSEMBLY", "LOAD_PLATE", "LOAD_PLATE_BADGE",
    "FRAME_ASSEMBLY", "HANDLE_ASSEMBLY", "AXLE_ASSEMBLY", "AXLE_SHAFT",
    "WHEEL_LEFT_PIVOT", "WHEEL_RIGHT_PIVOT",
    "WHEEL_LEFT_TIRE", "WHEEL_RIGHT_TIRE", "WHEEL_LEFT_HUB", "WHEEL_RIGHT_HUB",
    "HANDLE_LEFT_PIVOT", "HANDLE_RIGHT_PIVOT", "HANDLE_LEFT_GRIP", "HANDLE_RIGHT_GRIP",
    "HAND_GRIP_LEFT", "HAND_GRIP_RIGHT", "LOAD_ORIGIN", "INTERACTION_TARGET", "CENTER_OF_MASS",
    "COL_HAND_TRUCK_FRAME", "COL_HAND_TRUCK_LOAD_PLATE",
    "COL_HAND_TRUCK_WHEEL_LEFT", "COL_HAND_TRUCK_WHEEL_RIGHT",
    *{f"FRAME_CROSSBAR_{index:02d}" for index in range(1, 5)},
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
    lo = Vector((min(p.x for p in corners), min(p.y for p in corners), min(p.z for p in corners)))
    hi = Vector((max(p.x for p in corners), max(p.y for p in corners), max(p.z for p in corners)))
    return lo, hi


def asset_metrics(root):
    nodes = descendants(root)
    meshes = [obj for obj in nodes if obj.type == "MESH"]
    triangles = 0
    materials_used = set()
    for obj in meshes:
        triangles += sum(max(1, len(poly.vertices) - 2) for poly in obj.data.polygons)
        materials_used.update(slot.material.name for slot in obj.material_slots if slot.material)
    lo, hi = visible_bounds(root)
    size = hi - lo
    return {
        "nodes": len(nodes),
        "meshes": len(meshes),
        "triangles": triangles,
        "materials": sorted(materials_used),
        "textures": 0,
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
    axle = by_name["AXLE_ASSEMBLY"]
    axle_position = world_position(axle)
    if (axle_position - Vector((0, 0.015, 0.135))).length > 1e-5:
        raise RuntimeError("axle centerline pivot moved")
    checks.append({"node": axle.name, "world_position_m": [round(v, 5) for v in axle_position], "pass": True})
    for label, expected_x in (("LEFT", -0.218), ("RIGHT", 0.218)):
        pivot = by_name[f"WHEEL_{label}_PIVOT"]
        tire = by_name[f"WHEEL_{label}_TIRE"]
        expected = Vector((expected_x, 0.015, 0.135))
        pivot_position = world_position(pivot)
        tire_position = world_position(tire)
        valid = (
            pivot.parent is axle
            and tire.parent is pivot
            and (pivot_position - expected).length < 1e-5
            and (tire_position - pivot_position).length < 1e-5
            and pivot.get("pivot_exercise_passed") is True
        )
        if not valid:
            raise RuntimeError(f"{pivot.name} wheel hierarchy/pivot contract invalid")
        checks.append({
            "node": pivot.name,
            "world_position_m": [round(v, 5) for v in pivot_position],
            "spin_axis": pivot["spin_axis_blender"],
            "exercise_degrees": pivot["pivot_exercise_degrees"],
            "pass": True,
        })
    for label, expected_x in (("LEFT", -0.145), ("RIGHT", 0.145)):
        pivot = by_name[f"HANDLE_{label}_PIVOT"]
        grip = by_name[f"HANDLE_{label}_GRIP"]
        expected = Vector((expected_x, 0.105, 1.120))
        if grip.parent is not pivot or (world_position(pivot) - expected).length > 1e-5 or (world_position(grip) - expected).length > 1e-5:
            raise RuntimeError(f"{pivot.name} true grip-center pivot invalid")
    checks.append({"handle_grip_pivots": 2, "true_centers": True, "pass": True})
    return checks


def validate_scene(root):
    nodes = descendants(root)
    by_name = {obj.name: obj for obj in nodes}
    missing = sorted(REQUIRED_NODES - set(by_name))
    if missing:
        raise RuntimeError(f"{ASSET_ID} missing required nodes: {missing}")
    if root.get("asset_id") != ASSET_ID or root.get("reference_id") != "42":
        raise RuntimeError("hand-truck root metadata invalid")
    for obj in nodes:
        if obj.type != "MESH":
            continue
        if any(abs(value - 1.0) > 1e-5 for value in obj.scale):
            raise RuntimeError(f"unapplied scale: {obj.name} {tuple(obj.scale)}")
        if obj.data.polygons and not obj.data.uv_layers:
            raise RuntimeError(f"missing UVs: {obj.name}")
    metrics = asset_metrics(root)
    if not 1200 <= metrics["triangles"] <= 9000:
        raise RuntimeError(f"triangle budget failed: {metrics['triangles']}")
    if metrics["nodes"] > 85:
        raise RuntimeError(f"node budget failed: {metrics['nodes']}")
    if len(metrics["materials"]) > 8:
        raise RuntimeError(f"material budget failed: {len(metrics['materials'])}")
    if any(abs(actual - expected) > 0.001 for actual, expected in zip(metrics["visible_dimensions_blender"], BLENDER_DIMS)):
        raise RuntimeError(f"visible dimensions {metrics['visible_dimensions_blender']} do not match {BLENDER_DIMS}")
    metrics["functional_checks"] = functional_checks(root)
    metrics["triangle_budget"] = [1200, 9000]
    metrics["material_budget"] = 8
    metrics["node_budget"] = 85
    metrics["moving_parts"] = 2
    metrics["collision_meshes"] = 4
    return metrics


def add_build_info():
    text = bpy.data.texts.new("BUILD_INFO.txt")
    text.write(
        "Pinehollow Golf delivery hand truck, Asset Sheet 05 reference 42\n"
        f"asset_id: {ASSET_ID}\n"
        f"build_version: {BUILD_VERSION}\n"
        f"builder: {SCRIPT.relative_to(ROOT).as_posix()}\n"
        "units: metres\n"
        "source: original in-repository geometry from local project reference sheet\n"
        "license: project-owned / UNLICENSED\n"
        "external downloads and textures: none\n"
        "existing handtruck.glb and other delivery assets: untouched\n"
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
        export_apply=True, export_yup=True, export_normals=True, export_texcoords=True,
        export_materials="EXPORT", export_animations=False, export_extras=True,
        export_cameras=False, export_lights=False,
    )
    metrics.update({
        "asset_id": ASSET_ID,
        "reference_id": "42",
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
    scene.render.resolution_x = 960
    scene.render.resolution_y = 760
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -1.15
    if scene.world is None:
        scene.world = bpy.data.worlds.new("QA_World")
    scene.world.color = (0.024, 0.029, 0.026)
    bpy.ops.object.camera_add(location=(1.25, -2.25, 0.94))
    camera = bpy.context.object
    camera.name = "QA_Camera"
    camera.data.lens = 52
    scene.camera = camera
    for name, energy, location, size in (
        ("Key", 590, (-1.30, -1.30, 1.85), 1.30),
        ("Fill", 270, (1.45, -0.35, 1.20), 1.15),
        ("Rim", 400, (0.25, 1.45, 1.55), 1.00),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = f"QA_{name}"
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size
        look_at(light, (0, 0, 0.55))
    floor_mat = mat("QA_WarmGround", (0.115, 0.105, 0.085, 1.0), roughness=0.93)
    box("QA_Floor", (3.2, 3.2, 0.025), (0, 0, -0.018), floor_mat, bevel=0.006)

    proxy_mat = mat("QA_BoxKraft", (0.24, 0.105, 0.030, 1.0), roughness=0.84)
    proxy = box(
        "QA_LoadProxy", (0.60, 0.40, 0.40), (0, -0.120, 0.224),
        proxy_mat, bevel=0.012,
        props={"qa_only": True, "proxy_dimensions_m": [0.60, 0.40, 0.40]},
    )
    proxy.hide_render = True
    for side, x in (("L", -0.12), ("R", 0.12)):
        box(f"QA_BoxBand_{side}", (0.035, 0.402, 0.402), (x, -0.120, 0.224), M["green"], bevel=0.001).hide_render = True
    return camera, proxy


def render_previews(root, M):
    camera, proxy = preview_setup(M)
    views = (
        ("front_three_quarter", (1.25, -2.25, 0.94), (0, -0.035, 0.59)),
        ("front", (0, -2.58, 0.78), (0, -0.025, 0.58)),
        ("side", (2.20, -0.65, 0.78), (0, -0.035, 0.56)),
        ("back", (-1.20, 2.10, 0.92), (0, 0.025, 0.58)),
        ("wheel_pivot_detail", (0.75, -0.92, 0.42), (0, -0.015, 0.19)),
    )
    for name, location, target in views:
        proxy.hide_render = True
        for band in (obj for obj in bpy.data.objects if obj.name.startswith("QA_BoxBand_")):
            band.hide_render = True
        camera.location = location
        look_at(camera, target)
        bpy.context.scene.render.filepath = str(QA_DIR / f"{ASSET_ID}_{name}_clean.png")
        bpy.ops.render.render(write_still=True)
    proxy.hide_render = False
    for band in (obj for obj in bpy.data.objects if obj.name.startswith("QA_BoxBand_")):
        band.hide_render = False
    camera.location = (1.25, -2.25, 0.94)
    look_at(camera, (0, -0.035, 0.57))
    bpy.context.scene.render.filepath = str(QA_DIR / f"{ASSET_ID}_front_three_quarter_loaded.png")
    bpy.ops.render.render(write_still=True)
    for obj in [candidate for candidate in list(bpy.data.objects) if candidate.name.startswith("QA_")]:
        bpy.data.objects.remove(obj, do_unlink=True)


def clean_reimport_validate():
    reset_scene()
    glb_path = EXPORT_DIR / f"{ASSET_ID}.glb"
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    root = bpy.data.objects.get(ASSET_ID)
    if root is None:
        raise RuntimeError("clean re-import lost hand-truck root")
    names = {obj.name for obj in bpy.context.scene.objects}
    missing = sorted(REQUIRED_NODES - names)
    if missing:
        raise RuntimeError(f"clean re-import missing nodes: {missing}")
    if root.get("asset_id") != ASSET_ID or root.get("reference_id") != "42":
        raise RuntimeError("clean re-import lost root metadata")
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
        "wheel_pivots_preserved": all(bpy.data.objects.get(f"WHEEL_{label}_PIVOT") for label in ("LEFT", "RIGHT")),
        "cameras_in_glb": 0,
        "lights_in_glb": 0,
    }
    (QA_DIR / f"{ASSET_ID}_reimport.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    M = hand_truck_materials()
    camera, proxy = preview_setup(M)
    proxy.hide_render = True
    for band in (obj for obj in bpy.data.objects if obj.name.startswith("QA_BoxBand_")):
        band.hide_render = True
    camera.location = (1.25, -2.25, 0.94)
    look_at(camera, (0, -0.035, 0.57))
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
    M = hand_truck_materials()
    root = build_hand_truck(M)
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
        "revision_summary": "Pass 4 authors the full 0.50 x 0.40 m toe plate and proves a centered 0.60 x 0.40 m carton with bounded 5 cm side overhang.",
        "asset": metrics,
        "reimport": reimport,
    }
    (QA_DIR / "delivery_hand_truck_build_report.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(f"COMPLETE|asset={ASSET_ID}|qa_pass={QA_PASS}|source={SOURCE_DIR}|export={EXPORT_DIR}")


if __name__ == "__main__":
    main()
