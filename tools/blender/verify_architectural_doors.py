"""Fresh-process GLB reimport validation for the architectural door family.

Run with Blender 5.1+ after ``build_architectural_doors.py``. Every runtime GLB
is imported into a factory-clean scene, inspected in its exported hierarchy,
cycled procedurally through representative angles, and rendered from the
reimported data. Results are written under ``qa/doors/blender``.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Mapping, Sequence

import bpy
import bmesh
from mathutils import Matrix, Vector


REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools" / "blender"))
import build_architectural_doors as doors


MANIFEST_PATH = REPO / "Assets" / "architecture" / "doors" / "doors-manifest.json"
QA_ROOT = REPO / "qa" / "doors" / "blender"
RENDER_ROOT = QA_ROOT / "reimport"
REPORT_JSON = QA_ROOT / "architectural-door-reimport-validation.json"
REPORT_MD = QA_ROOT / "architectural-door-reimport-validation.md"
ANGLE_SAMPLES = (0.0, 10.0, 25.0, 50.0, 75.0)


def descendants(root: bpy.types.Object) -> list[bpy.types.Object]:
    return doors.descendants(root)


def issue(record: dict, code: str, message: str, *, severity: str = "error") -> None:
    record["issues"].append({"severity": severity, "code": code, "message": message})


def clear_active_actions() -> None:
    for obj in bpy.context.scene.objects:
        if obj.animation_data is not None:
            obj.animation_data.action = None
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()


def imported_root(spec: doors.DoorSpec) -> bpy.types.Object:
    root = next(
        (obj for obj in bpy.context.scene.objects if obj.get("asset_id") == f"architectural-door-{spec.key}"),
        None,
    )
    if root is None:
        root = bpy.data.objects.get(spec.root_name)
    if root is None:
        raise RuntimeError(f"fresh import did not expose the {spec.label} root")
    return root


def names_under(root: bpy.types.Object) -> set[str]:
    return {obj.name for obj in descendants(root)}


def welded_non_manifold_edges(obj: bpy.types.Object) -> int:
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
        return sum(1 for edge in bm.edges if not edge.is_manifold)
    finally:
        bm.free()


def world_min_z(objects: Sequence[bpy.types.Object]) -> float:
    minimum = math.inf
    bpy.context.view_layer.update()
    for obj in objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            minimum = min(minimum, (obj.matrix_world @ Vector(corner)).z)
    return minimum


def matrix_delta(a: Matrix, b: Matrix) -> float:
    return max(abs(a[row][column] - b[row][column]) for row in range(4) for column in range(4))


def pivot_for_side(root: bpy.types.Object, side: str) -> bpy.types.Object | None:
    name = "PIVOT_Door" if side == "Single" else f"PIVOT_Door_{side}"
    return next((obj for obj in descendants(root) if obj.name == name), None)


def handle_pivots_for_leaf(root: bpy.types.Object, leaf: bpy.types.Object, side: str) -> list[bpy.types.Object]:
    expected = (
        ("PIVOT_Handle_Exterior", "PIVOT_Handle_Interior")
        if side == "Single"
        else (f"PIVOT_Handle_{side}_Exterior", f"PIVOT_Handle_{side}_Interior")
    )
    found = []
    leaf_descendants = set(descendants(leaf))
    for name in expected:
        obj = bpy.data.objects.get(name)
        if obj is not None and obj in leaf_descendants:
            found.append(obj)
    return found


def latch_pivot_for_side(side: str) -> bpy.types.Object | None:
    name = "PIVOT_LatchBolt" if side == "Single" else f"PIVOT_LatchBolt_{side}"
    return bpy.data.objects.get(name)


def validate_motion(
    spec: doors.DoorSpec,
    root: bpy.types.Object,
    record: dict,
) -> None:
    motion_samples: dict[str, list[dict[str, object]]] = {}
    for setup in doors.leaf_setup(spec):
        side = str(setup["side"] or "Single")
        direction = float(setup["direction"])
        hinge_x = float(setup["hinge_x"])
        pivot = pivot_for_side(root, side)
        if pivot is None:
            issue(record, "motion.pivot", f"missing motion pivot for {side}")
            continue
        pivot.rotation_mode = "XYZ"
        pivot.rotation_euler = (0.0, 0.0, 0.0)
        bpy.context.view_layer.update()
        if (pivot.matrix_world.translation - Vector((hinge_x, 0.0, 0.0))).length > 2e-4:
            issue(record, "motion.hinge_origin", f"{pivot.name} origin is not on its hinge line: {tuple(pivot.matrix_world.translation)}")

        handles = handle_pivots_for_leaf(root, pivot, side)
        if len(handles) != 2:
            issue(record, "motion.handles", f"{side} expected two face handles, found {[obj.name for obj in handles]}")
        relative_handles = {
            handle.name: pivot.matrix_world.inverted() @ handle.matrix_world
            for handle in handles
        }
        latch = latch_pivot_for_side(side)
        if spec.double and side == "Right":
            if latch is not None:
                issue(record, "motion.inactive_latch", "Luxury inactive right leaf should use flush bolts, not a lateral latch")
        elif latch is None:
            issue(record, "motion.latch", f"missing latch pivot for {side}")
        elif latch not in descendants(pivot):
            issue(record, "motion.latch_parent", f"{latch.name} is not carried by {pivot.name}")
        relative_latch = pivot.matrix_world.inverted() @ latch.matrix_world if latch is not None else None

        moving_meshes = [
            obj for obj in descendants(pivot)
            if obj.type == "MESH" and not obj.get("collision_proxy") and doors.inherited_lod(obj) == 0
        ]
        samples = []
        previous_y = -math.inf
        all_angles = (*ANGLE_SAMPLES, float(spec.open_degrees))
        for degrees in all_angles:
            pivot.rotation_euler.z = direction * math.radians(degrees)
            bpy.context.view_layer.update()
            far = pivot.matrix_world @ Vector((direction * spec.leaf_width, 0.0, 0.0))
            expected = Vector((
                hinge_x + direction * spec.leaf_width * math.cos(math.radians(degrees)),
                spec.leaf_width * math.sin(math.radians(degrees)),
                0.0,
            ))
            error = (far - expected).length
            radius_error = abs((far - Vector((hinge_x, 0.0, 0.0))).length - spec.leaf_width)
            floor_z = world_min_z(moving_meshes)
            handle_error = max(
                (matrix_delta(relative_handles[handle.name], pivot.matrix_world.inverted() @ handle.matrix_world)
                 for handle in handles),
                default=0.0,
            )
            latch_error = (
                matrix_delta(relative_latch, pivot.matrix_world.inverted() @ latch.matrix_world)
                if latch is not None and relative_latch is not None else 0.0
            )
            if error > 2e-4 or radius_error > 2e-4:
                issue(record, "motion.arc", f"{side} at {degrees:g} degrees left its authored hinge arc (error {error:.6f}m)")
            if degrees > 0.0 and far.y <= previous_y - 1e-5:
                issue(record, "motion.monotonic", f"{side} swing did not advance monotonically at {degrees:g} degrees")
            if floor_z < -0.002:
                issue(record, "motion.floor_scrape", f"{side} at {degrees:g} degrees extends below floor ({floor_z:.6f}m)")
            if handle_error > 2e-4:
                issue(record, "motion.handle_detach", f"{side} handle detached at {degrees:g} degrees ({handle_error:.6f})")
            if latch_error > 2e-4:
                issue(record, "motion.latch_detach", f"{side} latch detached at {degrees:g} degrees ({latch_error:.6f})")
            samples.append({
                "degrees": degrees,
                "farEdgeMeters": [round(value, 6) for value in far],
                "arcErrorMeters": round(error, 7),
                "radiusErrorMeters": round(radius_error, 7),
                "movingMinZMeters": round(floor_z, 6),
                "handleRelativeError": round(handle_error, 7),
                "latchRelativeError": round(latch_error, 7),
            })
            previous_y = far.y

        for _ in range(5):
            pivot.rotation_euler.z = direction * math.radians(spec.open_degrees)
            bpy.context.view_layer.update()
            pivot.rotation_euler.z = 0.0
            bpy.context.view_layer.update()
        returned = pivot.matrix_world @ Vector((direction * spec.leaf_width, 0.0, 0.0))
        closed_expected = Vector((hinge_x + direction * spec.leaf_width, 0.0, 0.0))
        cycle_error = (returned - closed_expected).length
        if cycle_error > 2e-4:
            issue(record, "motion.repeatability", f"{side} did not return after five cycles ({cycle_error:.6f}m)")
        motion_samples[side] = samples

    if spec.double:
        left = pivot_for_side(root, "Left")
        right = pivot_for_side(root, "Right")
        if left is not None and right is not None:
            left.rotation_mode = right.rotation_mode = "XYZ"
            left.rotation_euler.z = math.radians(spec.open_degrees)
            right.rotation_euler.z = -math.radians(spec.open_degrees)
            bpy.context.view_layer.update()
            left_far = left.matrix_world @ Vector((spec.leaf_width, 0.0, 0.0))
            right_far = right.matrix_world @ Vector((-spec.leaf_width, 0.0, 0.0))
            if min(left_far.y, right_far.y) < spec.leaf_width * 0.92:
                issue(record, "motion.double_clearance", f"both Luxury leaves do not clear the opening: left={tuple(left_far)}, right={tuple(right_far)}")
            record["doubleLeafFullOpen"] = {
                "leftFarEdgeMeters": [round(value, 6) for value in left_far],
                "rightFarEdgeMeters": [round(value, 6) for value in right_far],
            }
            left.rotation_euler.z = right.rotation_euler.z = 0.0
            bpy.context.view_layer.update()
    record["motionSamples"] = motion_samples


def validate_one(spec: doors.DoorSpec, manifest_record: Mapping[str, object]) -> dict:
    doors.clean_scene()
    path = REPO / str(manifest_record["runtimeGlb"])
    record = {
        "tier": spec.key,
        "label": spec.label,
        "glb": path.relative_to(REPO).as_posix(),
        "issues": [],
    }
    if not path.is_file():
        issue(record, "file.missing", f"runtime GLB is missing: {path}")
        record["ok"] = False
        return record
    record["fileBytes"] = path.stat().st_size
    record["sha256"] = doors.asset_lib.sha256_file(path)
    if record["sha256"] != manifest_record["sha256"]:
        issue(record, "file.hash", "GLB hash does not match the current manifest")

    bpy.ops.import_scene.gltf(filepath=str(path))
    root = imported_root(spec)
    all_actions = sorted(action.name for action in bpy.data.actions)
    clear_active_actions()
    objects = descendants(root)
    object_names = {obj.name for obj in objects}
    record["root"] = root.name
    record["objectCount"] = len(objects)
    record["meshCount"] = sum(1 for obj in objects if obj.type == "MESH")
    record["actions"] = all_actions

    if root.parent is not None:
        issue(record, "root.parent", "reimported asset root is parented")
    if root.location.length > 1e-5 or any(abs(value) > 1e-5 for value in root.rotation_euler):
        issue(record, "root.identity", f"reimported root is not at the threshold origin: {tuple(root.location)}")
    if any(abs(float(value) - 1.0) > 1e-5 for value in root.scale):
        issue(record, "root.scale", f"reimported root scale is not one: {tuple(root.scale)}")
    generated_names = sorted(name for name in object_names if len(name) > 4 and name[-4] == "." and name[-3:].isdigit())
    if generated_names:
        issue(record, "names.generated", f"fresh import generated unstable object suffixes: {generated_names[:10]}")

    required_nodes = set(manifest_record["functionalNodes"])
    missing_nodes = sorted(required_nodes.difference(object_names))
    if missing_nodes:
        issue(record, "nodes.missing", f"missing functional nodes: {missing_nodes}")
    required_collision = set(manifest_record["collisionNodes"])
    missing_collision = sorted(required_collision.difference(object_names))
    if missing_collision:
        issue(record, "collision.missing", f"missing collision nodes: {missing_collision}")

    expected_actions = set(manifest_record["animations"])
    missing_actions = sorted(expected_actions.difference(all_actions))
    if missing_actions:
        issue(record, "animations.missing", f"missing exported animation clips: {missing_actions}")
    empty_actions = [action.name for action in bpy.data.actions if action.frame_range[1] <= action.frame_range[0]]
    if empty_actions:
        issue(record, "animations.empty", f"animation clips have empty ranges: {empty_actions}")

    visible_meshes = [obj for obj in objects if obj.type == "MESH" and not obj.get("collision_proxy")]
    collision_meshes = [obj for obj in objects if obj.type == "MESH" and obj.get("collision_proxy")]
    for obj in visible_meshes + collision_meshes:
        if any(abs(float(value) - 1.0) > 1e-4 for value in obj.scale):
            issue(record, "mesh.scale", f"{obj.name} reimported with non-unit scale {tuple(obj.scale)}")
        if not obj.data.uv_layers:
            issue(record, "mesh.uv", f"{obj.name} lost its UV map")
        if not obj.data.materials:
            issue(record, "mesh.material", f"{obj.name} lost its material")
    for obj in collision_meshes:
        bad = welded_non_manifold_edges(obj)
        if bad:
            issue(record, "collision.non_manifold", f"{obj.name} has {bad} non-manifold edges after weld")

    textured_materials = []
    for material in {slot for obj in visible_meshes for slot in obj.data.materials if slot is not None}:
        image_nodes = [node for node in material.node_tree.nodes if node.type == "TEX_IMAGE" and node.image] if material.use_nodes else []
        if image_nodes:
            textured_materials.append(material.name)
    if not textured_materials:
        issue(record, "materials.textures", "no texture-backed PBR material survived GLB reimport")
    record["texturedMaterials"] = sorted(textured_materials)

    lod_triangles = {f"LOD{lod}": doors.triangle_count_for_lod(root, lod) for lod in range(3)}
    record["lodTriangles"] = lod_triangles
    expected_triangles = manifest_record["lodTriangles"]
    for key, value in lod_triangles.items():
        if int(value) != int(expected_triangles[key]):
            issue(record, "lod.triangle_mismatch", f"{key} reimported with {value} triangles; manifest records {expected_triangles[key]}")
    if not (lod_triangles["LOD0"] > lod_triangles["LOD1"] > lod_triangles["LOD2"] > 0):
        issue(record, "lod.order", f"reimported LODs are not strictly descending: {lod_triangles}")

    bounds = doors.lod_bounds(root, 0)
    record["boundsLOD0"] = bounds
    expected_bounds = manifest_record["boundsLOD0"]
    max_bound_error = max(
        abs(float(bounds[field][index]) - float(expected_bounds[field][index]))
        for field in ("min", "max", "dimensions") for index in range(3)
    )
    record["maxBoundsErrorMeters"] = round(max_bound_error, 7)
    if max_bound_error > 0.003:
        issue(record, "bounds.mismatch", f"LOD0 fresh-import bounds differ from source by {max_bound_error:.6f}m")

    if spec.arched:
        glass = [name for name in object_names if name.startswith("MESH_LOD0_Single_GlassPane_")]
        if len(glass) != 8:
            issue(record, "glass.panes", f"High-End expected eight separate LOD0 panes, found {len(glass)}")
    if spec.double:
        for name in ("PIVOT_FlushBolt_Right_Top", "PIVOT_FlushBolt_Right_Bottom", "STRIKE_PLATE_Left"):
            if name not in object_names:
                issue(record, "luxury.locking", f"Luxury locking hierarchy is missing {name}")
    if doors.tier_level(spec) >= 2:
        if not any("LockKeyway" in name for name in object_names):
            issue(record, "lock.keyway", "premium-tier lock cylinder has no separate keyway geometry")

    validate_motion(spec, root, record)

    doors.set_preview_lod(root, 0)
    for setup in doors.leaf_setup(spec):
        pivot = pivot_for_side(root, str(setup["side"] or "Single"))
        if pivot is not None:
            pivot.rotation_mode = "XYZ"
            pivot.rotation_euler.z = 0.0
    bpy.context.view_layer.update()
    stem = spec.key.replace("-", "_")
    closed_path = RENDER_ROOT / f"door_{stem}_fresh_closed.png"
    doors.asset_lib.render_studio_preview(root, closed_path, width=720, height=900, azimuth_degrees=0.0, elevation_degrees=10.0)
    for setup in doors.leaf_setup(spec):
        pivot = pivot_for_side(root, str(setup["side"] or "Single"))
        if pivot is not None:
            pivot.rotation_euler.z = float(setup["direction"]) * math.radians(spec.open_degrees)
    bpy.context.view_layer.update()
    open_path = RENDER_ROOT / f"door_{stem}_fresh_open.png"
    doors.asset_lib.render_studio_preview(root, open_path, width=720, height=900, azimuth_degrees=-28.0, elevation_degrees=16.0)
    record["freshReimportRenders"] = [
        closed_path.relative_to(REPO).as_posix(),
        open_path.relative_to(REPO).as_posix(),
    ]
    record["ok"] = not any(item["severity"] == "error" for item in record["issues"])
    return record


def write_reports(records: Sequence[Mapping[str, object]]) -> None:
    overall = all(bool(record["ok"]) for record in records)
    report = {
        "schemaVersion": 1,
        "blenderVersion": bpy.app.version_string,
        "freshProcess": True,
        "angleSamplesDegrees": [*ANGLE_SAMPLES, "tier full angle"],
        "overallOk": overall,
        "records": list(records),
    }
    REPORT_JSON.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# Architectural Door Fresh-Reimport Validation",
        "",
        f"Overall result: **{'PASS' if overall else 'FAIL'}**",
        "",
        "Each runtime GLB was imported into a factory-clean Blender process. The checks cover hierarchy, transforms, UV/material retention, collisions, exact LOD triangle counts, animation names, dimensions, and procedural samples at 0°, 10°, 25°, 50°, 75°, and each tier's full-open angle.",
        "",
        "| Tier | LOD0 | LOD1 | LOD2 | Max bounds error | Motion samples | Result |",
        "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for record in records:
        triangles = record.get("lodTriangles", {"LOD0": 0, "LOD1": 0, "LOD2": 0})
        sample_count = sum(len(samples) for samples in record.get("motionSamples", {}).values())
        lines.append(
            f"| {record['label']} | {triangles['LOD0']:,} | {triangles['LOD1']:,} | {triangles['LOD2']:,} | "
            f"{float(record.get('maxBoundsErrorMeters', 0.0)):.6f} m | {sample_count} | {'PASS' if record['ok'] else 'FAIL'} |"
        )
        for found in record.get("issues", []):
            lines.append(f"| ↳ {found['severity']} |  |  |  |  |  | `{found['code']}` {found['message']} |")
    lines.extend((
        "",
        f"Machine-readable report: `{REPORT_JSON.relative_to(REPO).as_posix()}`",
        "",
    ))
    REPORT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"REIMPORT_REPORT|{REPORT_JSON}|overall={overall}")


def main() -> None:
    if not MANIFEST_PATH.is_file():
        raise FileNotFoundError(f"build manifest is missing: {MANIFEST_PATH}")
    QA_ROOT.mkdir(parents=True, exist_ok=True)
    RENDER_ROOT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    by_tier = {record["tier"]: record for record in manifest["assets"]}
    records = []
    for spec in doors.SPECS:
        print(f"REIMPORT_START|{spec.key}")
        record = validate_one(spec, by_tier[spec.key])
        records.append(record)
        print(f"REIMPORT_{'PASS' if record['ok'] else 'FAIL'}|{spec.key}|issues={len(record['issues'])}")
    write_reports(records)
    if not all(record["ok"] for record in records):
        raise RuntimeError("architectural door fresh-reimport validation failed; see report")
    print("ARCHITECTURAL_DOORS_REIMPORT_OK")


if __name__ == "__main__":
    main()
