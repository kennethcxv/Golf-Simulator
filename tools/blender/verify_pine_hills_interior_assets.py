"""Verify Pine Hills clubhouse interior sources and exported GLBs.

The verifier opens every authored .blend, checks dimensions, clean transforms,
materials/UVs, required nodes, sockets, pivots and colliders, then imports the
matching GLB into a fresh scene and repeats the hierarchy/bounds checks.  It
also physically exercises the cooler hinge before restoring the closed pose.

Run with Blender 5.1::

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
      --background --factory-startup \
      --python tools/blender/verify_pine_hills_interior_assets.py
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import bpy
from mathutils import Vector


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import assets_51_100_lib as A


REPO_ROOT = SCRIPT_DIR.parents[1]
SOURCE_DIR = REPO_ROOT / "asset_sources" / "blender" / "clubhouse"
EXPORT_DIR = REPO_ROOT / "vendor" / "models" / "clubhouse"
REPORT_PATH = SOURCE_DIR / "pine_hills_interior_asset_verification_v1.json"


@dataclass(frozen=True)
class VerifySpec:
    key: str
    stem: str
    root_name: str
    dimensions: tuple[float, float, float]
    tolerance: float
    required_nodes: tuple[str, ...]
    minimum_sockets: int

    @property
    def source_path(self) -> Path:
        return SOURCE_DIR / f"{self.stem}.blend"

    @property
    def glb_path(self) -> Path:
        return EXPORT_DIR / f"{self.stem}.glb"


SPECS: tuple[VerifySpec, ...] = (
    VerifySpec(
        "front_desk_return",
        "pine_hills_front_desk_return_v1",
        "A_PINE_HILLS_FRONT_DESK_RETURN_V1_ROOT",
        (1.27, 2.10, 0.965),
        0.025,
        ("SOCKET_JoinAsset61_Right", "SOCKET_ReturnCounterProp_01", "SOCKET_StaffChair", "COL_ReturnFrontHull", "COL_ReturnLegHull"),
        5,
    ),
    VerifySpec(
        "opening_drinks_cooler",
        "pine_hills_opening_drinks_cooler_v1",
        "A_PINE_HILLS_OPENING_DRINKS_COOLER_V1_ROOT",
        (0.90, 0.68, 1.90),
        0.025,
        (
            "COOLER_Door",
            "PIVOT_COOLER_Door",
            "MESH_COOLER_DoorGlass",
            "MESH_COOLER_DoorHandle",
            "COL_COOLER_Carcass",
            "COL_COOLER_Door",
            "SOCKET_Bottle_01",
            "SOCKET_Bottle_24",
        ),
        27,
    ),
    VerifySpec(
        "golf_tv",
        "pine_hills_golf_tv_v1",
        "A_PINE_HILLS_GOLF_TV_V1_ROOT",
        (1.10, 0.17, 0.68),
        0.08,
        ("SOCKET_WallMount", "MESH_GolfTVScreen", "MESH_GolfTVFlag", "COL_GolfTV"),
        3,
    ),
    VerifySpec(
        "water_cooler",
        "pine_hills_water_cooler_v1",
        "A_PINE_HILLS_WATER_COOLER_V1_ROOT",
        (0.39, 0.47, 1.37),
        0.08,
        ("MESH_WaterCoolerJug", "SOCKET_UseCold", "SOCKET_CupStack", "COL_WaterCoolerBody"),
        4,
    ),
    VerifySpec(
        "public_waste_bin",
        "pine_hills_public_waste_bin_v1",
        "A_PINE_HILLS_PUBLIC_WASTE_BIN_V1_ROOT",
        (0.44, 0.44, 0.68),
        0.08,
        ("MESH_WasteBinOpening", "SOCKET_Discard", "COL_WasteBinBody"),
        2,
    ),
    VerifySpec(
        "public_waste_bin_overflow",
        "pine_hills_public_waste_bin_overflow_v1",
        "A_PINE_HILLS_PUBLIC_WASTE_BIN_OVERFLOW_V1_ROOT",
        (0.50, 0.44, 0.86),
        0.12,
        ("MESH_WasteOverflowPaper_01", "SOCKET_CleanupTarget", "COL_WasteOverflowCleanup"),
        3,
    ),
    VerifySpec(
        "front_desk_clutter",
        "pine_hills_front_desk_clutter_v1",
        "A_PINE_HILLS_FRONT_DESK_CLUTTER_V1_ROOT",
        (0.72, 0.38, 0.24),
        0.18,
        (
            "MESH_PenCup",
            "MESH_ReceiptSpike",
            "MESH_CoffeeMug",
            "MESH_PaperStack_01",
            "MESH_DeskPhoneBase",
            "SOCKET_CleanupTarget",
            "COL_FrontDeskClutter",
        ),
        7,
    ),
    VerifySpec(
        "lounge_litter",
        "pine_hills_lounge_litter_v1",
        "A_PINE_HILLS_LOUNGE_LITTER_V1_ROOT",
        (0.76, 0.60, 0.16),
        0.16,
        ("MESH_PizzaBoxBase", "MESH_EmptyCupUpright", "MESH_EmptyCupTipped", "SOCKET_CleanupTarget", "COL_LoungeLitter"),
        5,
    ),
    VerifySpec(
        "fallen_frame",
        "pine_hills_fallen_frame_v1",
        "A_PINE_HILLS_FALLEN_FRAME_V1_ROOT",
        (0.64, 0.46, 0.06),
        0.15,
        ("MESH_FallenFrameGlass", "SOCKET_CleanupTarget", "SOCKET_WallMount", "COL_FallenFrame"),
        3,
    ),
    VerifySpec(
        "floor_plant",
        "pine_hills_floor_plant_v1",
        "A_PINE_HILLS_FLOOR_PLANT_V1_ROOT",
        (0.76, 0.62, 1.23),
        0.08,
        ("MESH_FloorPlantPot", "MESH_FloorPlantLeaf_01", "SOCKET_Water", "COL_FloorPlantPot"),
        3,
    ),
    VerifySpec(
        "counter_plant",
        "pine_hills_counter_plant_v1",
        "A_PINE_HILLS_COUNTER_PLANT_V1_ROOT",
        (0.26, 0.26, 0.65),
        0.08,
        ("MESH_CounterPlantPot", "MESH_CounterPlantLeaf_01", "SOCKET_Water", "COL_CounterPlantPot"),
        3,
    ),
)


ALLOWED_NODE_PREFIXES = ("MESH_", "COL_", "SOCKET_", "PIVOT_", "GROUP_")
GENERIC_NAME = re.compile(r"^(Cube|Cylinder|Sphere|Icosphere|Cone|Torus|Empty|Material)(\.\d+)?$")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _close_animated_parts() -> None:
    door = bpy.data.objects.get("COOLER_Door")
    if door is None:
        return
    if door.animation_data is not None:
        door.animation_data_clear()
    door.rotation_euler = (0.0, 0.0, 0.0)
    # glTF round-trips use quaternion mode even though the authored source uses
    # Euler Z.  Set both representations so the closed-pose bounds are measured
    # rather than whichever animation clip the importer happened to activate.
    door.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
    door.rotation_axis_angle = (0.0, 0.0, 0.0, 1.0)
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()


def _bounds(root: bpy.types.Object) -> A.Bounds:
    _close_animated_parts()
    return A.world_bounds(root)


def _material_and_triangle_stats(root: bpy.types.Object) -> tuple[int, int, int, list[str], int, int, int]:
    visible = []
    collisions = []
    sockets = []
    polygons = 0
    triangles = 0
    material_names: set[str] = set()
    for obj in A.descendants(root):
        if obj.type == "EMPTY" and obj.name.startswith("SOCKET_"):
            sockets.append(obj)
        if obj.type != "MESH":
            continue
        if obj.get("collision_proxy") or obj.name.startswith("COL_"):
            collisions.append(obj)
            continue
        visible.append(obj)
        polygons += len(obj.data.polygons)
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        material_names.update(mat.name for mat in obj.data.materials if mat)
    return polygons, triangles, len(material_names), sorted(material_names), len(visible), len(collisions), len(sockets)


def _dimension_errors(bounds: A.Bounds, spec: VerifySpec, stage: str) -> list[str]:
    errors: list[str] = []
    for axis, actual, expected in zip("XYZ", bounds.size, spec.dimensions):
        allowed = max(0.012, expected * spec.tolerance)
        if abs(actual - expected) > allowed:
            errors.append(
                f"{stage}: {axis} dimension {actual:.5f}m differs from {expected:.5f}m "
                f"by more than {allowed:.5f}m"
            )
    return errors


def _source_checks(spec: VerifySpec) -> dict[str, object]:
    errors: list[str] = []
    warnings: list[str] = []
    if not spec.source_path.is_file():
        return {"ok": False, "errors": [f"missing source {spec.source_path}"], "warnings": warnings}
    bpy.ops.wm.open_mainfile(filepath=str(spec.source_path), load_ui=False)
    bpy.context.scene.frame_set(1)
    root = bpy.data.objects.get(spec.root_name)
    if root is None:
        return {"ok": False, "errors": [f"root missing: {spec.root_name}"], "warnings": warnings}
    nodes = A.descendants(root)
    by_name = {obj.name: obj for obj in nodes}
    if root.type != "EMPTY" or root.parent is not None:
        errors.append("source: root is not an unparented empty")
    if any(abs(value) > 1e-6 for value in (*root.location, *root.rotation_euler)):
        errors.append(f"source: root location/rotation is not identity: {tuple(root.location)} / {tuple(root.rotation_euler)}")
    if any(abs(value - 1.0) > 1e-6 for value in root.scale):
        errors.append(f"source: root scale is not identity: {tuple(root.scale)}")
    for prop, expected in (("units", "meters"), ("up_axis", "+Z"), ("front_axis", "-Y"), ("license", "Project-owned")):
        if root.get(prop) != expected:
            errors.append(f"source: root property {prop!r} is {root.get(prop)!r}, expected {expected!r}")
    if root.get("external_assets") is not False or root.get("external_textures") is not False:
        errors.append("source: external asset/texture flags are not explicitly false")
    try:
        authored_dims = tuple(float(v) for v in json.loads(root["target_dimensions_m"]))
        if max(abs(authored_dims[i] - spec.dimensions[i]) for i in range(3)) > 1e-6:
            errors.append(f"source: target dimension metadata {authored_dims} differs from verifier {spec.dimensions}")
    except Exception as exc:
        errors.append(f"source: invalid target_dimensions_m metadata: {exc}")

    for required in spec.required_nodes:
        if required not in by_name:
            errors.append(f"source: required node missing: {required}")
    for obj in nodes:
        if obj is root:
            continue
        if obj.name != "COOLER_Door" and not obj.name.startswith(ALLOWED_NODE_PREFIXES):
            errors.append(f"source: node lacks approved clean prefix: {obj.name}")
        if GENERIC_NAME.fullmatch(obj.name):
            errors.append(f"source: generic Blender node name retained: {obj.name}")
        if obj.type in {"CAMERA", "LIGHT"}:
            errors.append(f"source: shipping hierarchy contains {obj.type}: {obj.name}")
        if obj.type != "MESH":
            continue
        if any(abs(value - 1.0) > 1e-5 for value in obj.scale):
            errors.append(f"source: unapplied scale on {obj.name}: {tuple(obj.scale)}")
        if any(abs(value) > 1e-5 for value in obj.rotation_euler):
            errors.append(f"source: unapplied rotation on {obj.name}: {tuple(obj.rotation_euler)}")
        collision = bool(obj.get("collision_proxy")) or obj.name.startswith("COL_")
        if collision and not obj.name.startswith("COL_"):
            errors.append(f"source: collision proxy lacks COL_ prefix: {obj.name}")
        if not collision:
            if not obj.name.startswith("MESH_"):
                errors.append(f"source: visible mesh lacks MESH_ prefix: {obj.name}")
            if not obj.data.uv_layers:
                errors.append(f"source: visible mesh lacks UVs: {obj.name}")
            if not obj.data.materials or any(mat is None for mat in obj.data.materials):
                errors.append(f"source: visible mesh has missing material: {obj.name}")

    for material in bpy.data.materials:
        if GENERIC_NAME.fullmatch(material.name):
            errors.append(f"source: generic material name retained: {material.name}")
        if material.name.startswith("MAT_") and not material.get("project_owned"):
            errors.append(f"source: material is not marked project-owned: {material.name}")
        if material.use_nodes and material.node_tree.nodes.get("Principled BSDF") is None:
            errors.append(f"source: material lacks Principled BSDF: {material.name}")
    for image in bpy.data.images:
        if image.name in {"Render Result", "Viewer Node"} or image.source == "GENERATED":
            continue
        errors.append(f"source: unexpected image datablock proves an external/packed texture dependency: {image.name}")

    bounds = _bounds(root)
    errors.extend(_dimension_errors(bounds, spec, "source"))
    if abs(bounds.minimum[2]) > 0.011:
        errors.append(f"source: placement asset does not meet z=0 plane (minimum {bounds.minimum[2]:.5f}m)")
    polygons, triangles, material_count, materials, visible_count, collision_count, socket_count = _material_and_triangle_stats(root)
    if collision_count < 1:
        errors.append("source: no collision proxies")
    if socket_count < spec.minimum_sockets:
        errors.append(f"source: socket count {socket_count} is below {spec.minimum_sockets}")
    if triangles > 30000:
        warnings.append(f"source: {triangles} triangles exceeds the 30000-triangle lightweight ceiling")

    special: dict[str, object] = {}
    if spec.key == "front_desk_return":
        join = by_name.get("SOCKET_JoinAsset61_Right")
        combined = float(root.get("combined_front_run_m", 0.0))
        if abs(combined - 4.20) > 1e-6 or abs(2.93 + 1.27 - combined) > 1e-6:
            errors.append(f"source: front run metadata is not exact 2.93 + 1.27 = 4.20 (got {combined})")
        if abs(float(root.get("staff_return_length_m", 0.0)) - 2.10) > 1e-6:
            errors.append("source: staff return length metadata is not 2.10 m")
        if join is None or max(abs(join.location[i] - (-0.635, -0.595, 0.0)[i]) for i in range(3)) > 1e-6:
            errors.append("source: Asset61 right-join socket is misplaced")
        special["combinedFrontRunMeters"] = combined
        special["asset61ReferenceMeters"] = [2.93, 0.91, 0.965]
        special["moduleFrontExtensionMeters"] = 1.27
        special["staffReturnMeters"] = 2.10
    elif spec.key == "opening_drinks_cooler":
        door = by_name.get("COOLER_Door")
        pivot = by_name.get("PIVOT_COOLER_Door")
        if abs(float(root.get("door_open_angle_degrees", 0.0)) - (-108.0)) > 1e-6:
            errors.append("source: cooler open angle metadata must be -108 degrees for an outward swing")
        bottle_sockets = sorted(name for name in by_name if name.startswith("SOCKET_Bottle_"))
        expected_sockets = [f"SOCKET_Bottle_{index:02d}" for index in range(1, 25)]
        if bottle_sockets != expected_sockets:
            errors.append(f"source: bottle socket sequence mismatch: {bottle_sockets}")
        expected_hinge = Vector((-0.420, -0.280, 0.0))
        if door is None or door.type != "EMPTY":
            errors.append("source: COOLER_Door is not a separate empty transform")
        else:
            if (door.location - expected_hinge).length > 1e-6:
                errors.append(f"source: COOLER_Door origin {tuple(door.location)} is not on hinge {tuple(expected_hinge)}")
            door_collider = by_name.get("COL_COOLER_Door")
            if door_collider is None or door_collider.parent != door:
                errors.append("source: COL_COOLER_Door is not parented to the moving door")
            handle = by_name.get("MESH_COOLER_DoorHandle")
            if handle is None:
                errors.append("source: cooler handle is missing")
            else:
                closed_position = handle.matrix_world.translation.copy()
                door.rotation_euler.z = math.radians(-108.0)
                bpy.context.view_layer.update()
                opened_position = handle.matrix_world.translation.copy()
                travel = (opened_position - closed_position).length
                if travel < 0.35:
                    errors.append(f"source: opening exercise moved handle only {travel:.4f}m")
                if opened_position.y > closed_position.y - 0.45:
                    errors.append(
                        "source: cooler door does not swing outward into customer-side -Y "
                        f"space (closed y={closed_position.y:.4f}, open y={opened_position.y:.4f})"
                    )
                door.rotation_euler = (0.0, 0.0, 0.0)
                bpy.context.view_layer.update()
                special["doorHandleTravelMetersAtMinus108Degrees"] = round(travel, 6)
                special["doorHandleClosedY"] = round(closed_position.y, 6)
                special["doorHandleOpenY"] = round(opened_position.y, 6)
        if pivot is None or (pivot.location - expected_hinge).length > 1e-6:
            errors.append("source: PIVOT_COOLER_Door does not match physical hinge")
        action_names = sorted(action.name for action in bpy.data.actions)
        for action in ("COOLER_Door_Open", "COOLER_Door_Close"):
            if action not in action_names:
                errors.append(f"source: animation clip missing: {action}")
        special["bottleSocketCount"] = len(bottle_sockets)
        special["bottleSocketNames"] = bottle_sockets
        special["hingeLocationMeters"] = list(expected_hinge)
        special["animationNames"] = action_names

    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "boundsMeters": bounds.to_dict(),
        "nodeCount": len(nodes),
        "nodeNames": sorted(by_name),
        "visibleMeshCount": visible_count,
        "collisionMeshCount": collision_count,
        "socketCount": socket_count,
        "pivotCount": sum(1 for obj in nodes if obj.type == "EMPTY" and (obj.name.startswith("PIVOT_") or obj.get("marker_type") == "pivot")),
        "polygonCount": polygons,
        "triangleCount": triangles,
        "materialCount": material_count,
        "materialNames": materials,
        "special": special,
    }


def _glb_checks(spec: VerifySpec) -> dict[str, object]:
    errors: list[str] = []
    warnings: list[str] = []
    if not spec.glb_path.is_file():
        return {"ok": False, "errors": [f"missing GLB {spec.glb_path}"], "warnings": warnings}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(spec.glb_path))
    bpy.context.scene.frame_set(1)
    root = bpy.data.objects.get(spec.root_name)
    if root is None:
        return {"ok": False, "errors": [f"GLB round-trip root missing: {spec.root_name}"], "warnings": warnings}
    _close_animated_parts()
    nodes = A.descendants(root)
    by_name = {obj.name: obj for obj in nodes}
    for required in spec.required_nodes:
        if required not in by_name:
            errors.append(f"GLB round-trip: required node missing: {required}")
    bounds = _bounds(root)
    errors.extend(_dimension_errors(bounds, spec, "GLB round-trip"))
    polygons, triangles, material_count, materials, visible_count, collision_count, socket_count = _material_and_triangle_stats(root)
    if collision_count < 1:
        errors.append("GLB round-trip: no COL_ proxy survived export")
    if socket_count < spec.minimum_sockets:
        errors.append(f"GLB round-trip: socket count {socket_count} is below {spec.minimum_sockets}")
    if spec.key == "opening_drinks_cooler":
        bottle_names = sorted(name for name in by_name if name.startswith("SOCKET_Bottle_"))
        if bottle_names != [f"SOCKET_Bottle_{index:02d}" for index in range(1, 25)]:
            errors.append("GLB round-trip: 24 sequential bottle sockets did not survive")
        door = by_name.get("COOLER_Door")
        if door is None or by_name.get("COL_COOLER_Door") is None:
            errors.append("GLB round-trip: opening door hierarchy did not survive")
    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "boundsMeters": bounds.to_dict(),
        "nodeCount": len(nodes),
        "nodeNames": sorted(by_name),
        "visibleMeshCount": visible_count,
        "collisionMeshCount": collision_count,
        "socketCount": socket_count,
        "polygonCount": polygons,
        "triangleCount": triangles,
        "materialCount": material_count,
        "materialNames": materials,
    }


def main() -> int:
    results: list[dict[str, object]] = []
    all_errors: list[str] = []
    for spec in SPECS:
        source = _source_checks(spec)
        glb = _glb_checks(spec)
        errors = [*source.get("errors", []), *glb.get("errors", [])]
        warnings = [*source.get("warnings", []), *glb.get("warnings", [])]
        result = {
            "key": spec.key,
            "root": spec.root_name,
            "ok": not errors,
            "errors": errors,
            "warnings": warnings,
            "targetDimensionsMeters": list(spec.dimensions),
            "sourcePath": spec.source_path.relative_to(REPO_ROOT).as_posix(),
            "glbPath": spec.glb_path.relative_to(REPO_ROOT).as_posix(),
            "sourceBytes": spec.source_path.stat().st_size if spec.source_path.is_file() else 0,
            "glbBytes": spec.glb_path.stat().st_size if spec.glb_path.is_file() else 0,
            "sourceSha256": _sha256(spec.source_path) if spec.source_path.is_file() else None,
            "glbSha256": _sha256(spec.glb_path) if spec.glb_path.is_file() else None,
            "requiredNodes": list(spec.required_nodes),
            "source": source,
            "glbRoundTrip": glb,
        }
        results.append(result)
        all_errors.extend(f"{spec.key}: {message}" for message in errors)
        print("PINE_HILLS_VERIFY_ASSET|" + json.dumps(result, sort_keys=True))

    source_polygons = sum(int(result["source"].get("polygonCount", 0)) for result in results)
    source_triangles = sum(int(result["source"].get("triangleCount", 0)) for result in results)
    source_materials = sum(int(result["source"].get("materialCount", 0)) for result in results)
    report = {
        "schema": "pine-hills-interior-asset-verification-v1",
        "blenderVersion": ".".join(str(value) for value in bpy.app.version),
        "ok": not all_errors,
        "assetCount": len(results),
        "errorCount": len(all_errors),
        "errors": all_errors,
        "totalSourcePolygons": source_polygons,
        "totalSourceTriangles": source_triangles,
        "summedPerAssetMaterialCounts": source_materials,
        "units": "meters",
        "externalAssets": False,
        "externalTextures": False,
        "assets": results,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"PINE_HILLS_VERIFY_REPORT|{REPORT_PATH}|ok={report['ok']}|errors={len(all_errors)}")
    print("PINE_HILLS_VERIFY|" + json.dumps(report, sort_keys=True))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    status = main()
    if status:
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(status)
    raise SystemExit(0)
