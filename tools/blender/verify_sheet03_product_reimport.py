"""Verify five revised Sheet 03 product GLBs in clean Blender 5.1 scenes.

This is a post-export verifier.  It does not inspect or rebuild the editable
``.blend`` sources.  Each shipped GLB is imported only after
``bpy.ops.wm.read_factory_settings(use_empty=True)`` so the resulting evidence
describes the standalone runtime artifact rather than retained source-scene
state.

Run from the repository root::

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
        --background --factory-startup \
        --python tools/blender/verify_sheet03_product_reimport.py

Stable JSON and Markdown evidence is written beneath
``qa/assets_01_50_master/after/sheet03/clean-reimport-v3``.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import bpy
from mathutils import Vector


SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[2]
REPORT_DIR = (
    REPO_ROOT
    / "qa"
    / "assets_01_50_master"
    / "after"
    / "sheet03"
    / "clean-reimport-v3"
)
REPORT_JSON = REPORT_DIR / "sheet03-product-clean-reimport-v3.json"
REPORT_MD = REPORT_DIR / "sheet03-product-clean-reimport-v3.md"

REPORT_KIND = "sheet03-product-clean-blender-reimport-v3"
SCHEMA_VERSION = 1
BUILD_VERSION = 3
BLENDER_MAJOR_MINOR = (5, 1)
TRANSFORM_TOLERANCE = 1.0e-5
DIMENSION_MIN_RATIO = 0.65
DIMENSION_MAX_RATIO = 1.20
STANDING_FLOOR_TOLERANCE_M = 0.020
HANGING_PIVOT_TOLERANCE_RATIO = 0.10
MIN_VISIBLE_TRIANGLES = 150
MAX_VISIBLE_TRIANGLES = 50_000

CHECK_NAMES = (
    "artifactIntegrity",
    "cleanFactoryImport",
    "exactRootAndMetadata",
    "noCamerasOrLights",
    "finiteAppliedTransforms",
    "visibleBoundsVsTarget",
    "requiredDetailsAndCollision",
)

BASE_METADATA = {
    "asset_version": BUILD_VERSION,
    "builder": "tools/blender/build_checkout_products.py",
    "front": "-Y (cashier side)",
    "license": "Project-owned / UNLICENSED",
    "source": "Original Pinehollow Golf geometry generated in-repository",
    "units": "meters",
}


@dataclass(frozen=True)
class AssetContract:
    stem: str
    target_dimensions_m: tuple[float, float, float]
    required_detail_nodes: tuple[str, ...]
    collision_node: str
    required_empty_nodes: tuple[str, ...]
    metadata: Mapping[str, Any]
    placement: str = "standing"

    @property
    def relative_glb_path(self) -> str:
        return f"vendor/models/clubhouse/{self.stem}.glb"


def _metadata(
    stem: str,
    dimensions: tuple[float, float, float],
    **specific: Any,
) -> dict[str, Any]:
    values: dict[str, Any] = {
        **BASE_METADATA,
        "asset_id": stem,
        "target_dimensions_m": list(dimensions),
    }
    values.update(specific)
    return values


CONTRACTS = (
    AssetContract(
        stem="checkout_product_hanging_polo",
        target_dimensions_m=(0.255, 0.078, 0.700),
        required_detail_nodes=(
            "HangingPoloBody",
            "HangingPoloSleeve_L",
            "HangingPoloSleeve_R",
            "HangingPoloSleeveSeam_L",
            "HangingPoloSleeveSeam_R",
            "HangingPoloCollar_L",
            "HangingPoloCollar_R",
            "HangingPoloPlacket",
            "HangingPoloButton_1",
            "HangingPoloButton_2",
            "HangingPoloButton_3",
            "HangingPoloChestMark",
            "HangingPoloHem",
            "HangingPoloHanger",
            "HangingPoloHook",
        ),
        collision_node="COL_HangingPolo",
        required_empty_nodes=("HANGER_SOCKET",),
        metadata=_metadata(
            "checkout_product_hanging_polo",
            (0.255, 0.078, 0.700),
            pivot_description="hanger hook / waterfall-arm contact at local origin",
            placement="four-across face-out apparel display",
            product_kind="compact hanging polo",
        ),
        placement="hanging",
    ),
    AssetContract(
        stem="checkout_product_cap",
        target_dimensions_m=(0.21, 0.19, 0.115),
        required_detail_nodes=(
            "CapCrown",
            "CapBrim",
            "CapBrimUnder",
            "CapPanelSeam_1",
            "CapPanelSeam_2",
            "CapPanelSeam_3",
            "CapTopButton",
            "CapEyelet_1",
            "CapEyelet_2",
            "CapCrest",
            "CapCrestSlash",
        ),
        collision_node="COL_Product",
        required_empty_nodes=("ANCHOR_ProductBarcode", "ANCHOR_ProductGripPrimary"),
        metadata=_metadata(
            "checkout_product_cap",
            (0.21, 0.19, 0.115),
            grip_mode="small",
            separate_handoff=False,
        ),
    ),
    AssetContract(
        stem="checkout_product_rangefinder",
        target_dimensions_m=(0.19, 0.15, 0.105),
        required_detail_nodes=(
            "RangefinderBody",
            "RangefinderGrip",
            "RangefinderObjectiveBarrel",
            "RangefinderObjectiveGlass",
            "RangefinderEyepieceBarrel",
            "RangefinderEyepieceGlass",
            "RangefinderObjectiveBezel",
            "RangefinderTopScreen",
            "RangefinderButton_1",
            "RangefinderButton_2",
            "RangefinderSideCrest",
            "RangefinderLanyard",
        ),
        collision_node="COL_Product",
        required_empty_nodes=("ANCHOR_ProductBarcode", "ANCHOR_ProductGripPrimary"),
        metadata=_metadata(
            "checkout_product_rangefinder",
            (0.19, 0.15, 0.105),
            grip_mode="small",
            separate_handoff=False,
        ),
    ),
    AssetContract(
        stem="checkout_product_stand_bag",
        target_dimensions_m=(0.72, 0.30, 0.25),
        required_detail_nodes=(
            "StandBagBody",
            "StandBagTopRim",
            "StandBagBaseRim",
            "StandBagDividerFrontBack",
            "StandBagDividerLeftRight",
            "StandBagPocket",
            "StandBagBallPocket",
            "StandBagPocketFlap",
            "StandBagPocketZip",
            "StandBagFrontPiping",
            "StandBagCrest",
            "StandBagShoulderStrap",
            "StandLeg_1",
            "StandLeg_2",
            "StandLegFoot_1",
            "StandLegFoot_2",
        ),
        collision_node="COL_Product",
        required_empty_nodes=(
            "ANCHOR_ProductBarcode",
            "ANCHOR_ProductGripPrimary",
            "ANCHOR_ProductGripSecondary",
        ),
        metadata=_metadata(
            "checkout_product_stand_bag",
            (0.72, 0.30, 0.25),
            grip_mode="two-hand",
            separate_handoff=True,
        ),
    ),
    AssetContract(
        stem="checkout_product_shoe_pair",
        target_dimensions_m=(0.29, 0.205, 0.105),
        required_detail_nodes=(
            "LeftSole",
            "LeftMidsole",
            "LeftUpper",
            "LeftToe",
            "LeftTongue",
            "LeftSaddle",
            "LeftHeelCounter",
            "LeftLace_1",
            "LeftLace_2",
            "LeftLace_3",
            "LeftQuarterPiping",
            "RightSole",
            "RightMidsole",
            "RightUpper",
            "RightToe",
            "RightTongue",
            "RightSaddle",
            "RightHeelCounter",
            "RightLace_1",
            "RightLace_2",
            "RightLace_3",
            "RightQuarterPiping",
        ),
        collision_node="COL_Product",
        required_empty_nodes=("ANCHOR_ProductBarcode", "ANCHOR_ProductGripPrimary"),
        metadata=_metadata(
            "checkout_product_shoe_pair",
            (0.29, 0.205, 0.105),
            grip_mode="medium",
            separate_handoff=False,
        ),
    ),
)


def _round(value: float, digits: int = 7) -> float:
    result = round(float(value), digits)
    return 0.0 if result == -0.0 else result


def _vector(values: Iterable[float], digits: int = 7) -> list[float]:
    return [_round(value, digits) for value in values]


def _plain(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Mapping):
        return {str(key): _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    try:
        return [_plain(item) for item in value]
    except TypeError:
        return str(value)


def _custom_properties(obj: bpy.types.Object) -> dict[str, Any]:
    return {
        key: _plain(obj[key])
        for key in sorted(obj.keys())
        if key != "_RNA_UI"
    }


def _sha256(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _check(ok: bool, issues: Sequence[str] = (), **measurements: Any) -> dict[str, Any]:
    return {
        "ok": bool(ok),
        "issues": [str(issue) for issue in issues],
        "measurements": _plain(measurements),
    }


def _failed_check(reason: str) -> dict[str, Any]:
    return _check(False, (reason,))


def _nearly(left: float, right: float, tolerance: float = TRANSFORM_TOLERANCE) -> bool:
    return abs(float(left) - float(right)) <= tolerance


def _all_finite(values: Iterable[float]) -> bool:
    return all(math.isfinite(float(value)) for value in values)


def _scene_census() -> dict[str, int]:
    return {
        "objects": len(bpy.data.objects),
        "meshes": len(bpy.data.meshes),
        "materials": len(bpy.data.materials),
        "cameras": len(bpy.data.cameras),
        "lights": len(bpy.data.lights),
        "actions": len(bpy.data.actions),
    }


def _reset_to_factory_empty() -> dict[str, int]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    return _scene_census()


def _descendants(root: bpy.types.Object) -> set[bpy.types.Object]:
    result: set[bpy.types.Object] = set()
    pending = [root]
    while pending:
        obj = pending.pop()
        if obj in result:
            continue
        result.add(obj)
        pending.extend(obj.children)
    return result


def _world_bounds(objects: Sequence[bpy.types.Object]) -> tuple[Vector, Vector]:
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    found = False
    for obj in objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            if not _all_finite(point):
                raise ValueError(f"{obj.name} contributes a non-finite world bound")
            for axis in range(3):
                minimum[axis] = min(minimum[axis], point[axis])
                maximum[axis] = max(maximum[axis], point[axis])
            found = True
    if not found:
        raise ValueError("no mesh bounds were available")
    return minimum, maximum


def _visible_meshes(objects: Iterable[bpy.types.Object]) -> list[bpy.types.Object]:
    return sorted(
        (
            obj
            for obj in objects
            if obj.type == "MESH"
            and not obj.name.startswith("COL_")
            and obj.get("collision_proxy") is not True
        ),
        key=lambda obj: obj.name,
    )


def _triangle_count(objects: Sequence[bpy.types.Object]) -> int:
    total = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def _verify_asset(contract: AssetContract) -> dict[str, Any]:
    path = REPO_ROOT / contract.relative_glb_path
    checks: dict[str, dict[str, Any]] = {}
    exception_traceback: str | None = None

    factory_census = _reset_to_factory_empty()
    file_exists = path.is_file()
    file_bytes = path.stat().st_size if file_exists else 0
    artifact_issues = []
    if not file_exists:
        artifact_issues.append(f"missing GLB: {contract.relative_glb_path}")
    elif file_bytes <= 0:
        artifact_issues.append("GLB is empty")
    checks["artifactIntegrity"] = _check(
        not artifact_issues,
        artifact_issues,
        relativePath=contract.relative_glb_path,
        fileBytes=file_bytes,
        sha256=_sha256(path),
    )

    if not file_exists or file_bytes <= 0:
        reason = "cannot import a missing or empty GLB"
        for name in CHECK_NAMES[1:]:
            checks[name] = _failed_check(reason)
        return {
            "stem": contract.stem,
            "relativeGlbPath": contract.relative_glb_path,
            "ok": False,
            "checks": {name: checks[name] for name in CHECK_NAMES},
        }

    try:
        import_result = sorted(
            bpy.ops.import_scene.gltf(filepath=str(path), import_pack_images=True)
        )
        bpy.context.view_layer.update()
        objects = sorted(bpy.data.objects, key=lambda obj: obj.name)
        object_names = [obj.name for obj in objects]
        clean_issues = []
        if any(factory_census.values()):
            clean_issues.append(f"factory-empty reset retained data: {factory_census}")
        if import_result != ["FINISHED"]:
            clean_issues.append(f"glTF import result was {import_result}, expected ['FINISHED']")
        if not objects:
            clean_issues.append("glTF import produced no objects")
        checks["cleanFactoryImport"] = _check(
            not clean_issues,
            clean_issues,
            factoryEmptyCensus=factory_census,
            importOperatorResult=import_result,
            importedCensus=_scene_census(),
            importedObjectNames=object_names,
        )

        roots = [obj for obj in objects if obj.name == contract.stem]
        top_level = [obj for obj in objects if obj.parent is None]
        root_issues = []
        root = roots[0] if len(roots) == 1 else None
        if len(roots) != 1:
            root_issues.append(
                f"found {len(roots)} objects named {contract.stem}, expected exactly one"
            )
        top_level_names = sorted(obj.name for obj in top_level)
        if top_level_names != [contract.stem]:
            root_issues.append(
                f"top-level objects are {top_level_names}, expected exactly [{contract.stem!r}]"
            )

        root_metadata: dict[str, Any] | None = None
        hierarchy_names: list[str] = []
        if root is not None:
            hierarchy = _descendants(root)
            hierarchy_names = sorted(obj.name for obj in hierarchy)
            if root.type != "EMPTY":
                root_issues.append(f"root type is {root.type}, expected EMPTY")
            if root.parent is not None:
                root_issues.append(f"root parent is {root.parent.name}, expected none")
            if any(not _nearly(value, 0.0) for value in root.location):
                root_issues.append(
                    f"root location is {_vector(root.location)}, expected [0, 0, 0]"
                )
            root_rotation = root.matrix_basis.to_quaternion().angle
            if not _nearly(root_rotation, 0.0):
                root_issues.append(
                    f"root local rotation angle is {root_rotation:.9f}, expected 0"
                )
            if any(not _nearly(value, 1.0) for value in root.scale):
                root_issues.append(
                    f"root scale is {_vector(root.scale)}, expected [1, 1, 1]"
                )
            if hierarchy != set(objects):
                outside = sorted(obj.name for obj in set(objects) - hierarchy)
                root_issues.append(f"objects outside the identity-root hierarchy: {outside}")
            root_metadata = _custom_properties(root)
            if root_metadata != dict(contract.metadata):
                missing = sorted(set(contract.metadata) - set(root_metadata))
                unexpected = sorted(set(root_metadata) - set(contract.metadata))
                mismatched = sorted(
                    key
                    for key in set(root_metadata) & set(contract.metadata)
                    if root_metadata[key] != contract.metadata[key]
                )
                root_issues.append(
                    "root extras differ from the exact build-v3 contract "
                    f"(missing={missing}, unexpected={unexpected}, mismatched={mismatched})"
                )
        checks["exactRootAndMetadata"] = _check(
            not root_issues,
            root_issues,
            expectedRootName=contract.stem,
            topLevelObjectNames=top_level_names,
            hierarchyObjectNames=hierarchy_names,
            expectedMetadata=dict(contract.metadata),
            importedMetadata=root_metadata,
        )

        camera_objects = sorted(obj.name for obj in objects if obj.type == "CAMERA")
        light_objects = sorted(obj.name for obj in objects if obj.type == "LIGHT")
        camera_data = sorted(camera.name for camera in bpy.data.cameras)
        light_data = sorted(light.name for light in bpy.data.lights)
        camera_light_issues = []
        if camera_objects or camera_data:
            camera_light_issues.append(
                f"import contains cameras: objects={camera_objects}, datablocks={camera_data}"
            )
        if light_objects or light_data:
            camera_light_issues.append(
                f"import contains lights: objects={light_objects}, datablocks={light_data}"
            )
        checks["noCamerasOrLights"] = _check(
            not camera_light_issues,
            camera_light_issues,
            cameraObjects=camera_objects,
            cameraDatablocks=camera_data,
            lightObjects=light_objects,
            lightDatablocks=light_data,
        )

        transform_issues = []
        transform_records = []
        for obj in objects:
            local_values = [value for row in obj.matrix_local for value in row]
            world_values = [value for row in obj.matrix_world for value in row]
            finite = (
                _all_finite(local_values)
                and _all_finite(world_values)
                and _all_finite(obj.location)
                and _all_finite(obj.rotation_euler)
                and _all_finite(obj.scale)
            )
            if not finite:
                transform_issues.append(f"{obj.name} has a non-finite transform")
            scale_applied = all(_nearly(value, 1.0) for value in obj.scale)
            if not scale_applied:
                transform_issues.append(
                    f"{obj.name} has unapplied scale {_vector(obj.scale)}"
                )
            rotation_angle = obj.matrix_basis.to_quaternion().angle
            rotation_applied = obj.type != "MESH" or _nearly(rotation_angle, 0.0)
            if not rotation_applied:
                transform_issues.append(
                    f"{obj.name} has unapplied mesh rotation angle {rotation_angle:.9f}"
                )
            vertex_finite = True
            if obj.type == "MESH":
                vertex_finite = all(
                    _all_finite(vertex.co)
                    for vertex in obj.data.vertices
                )
                if not vertex_finite:
                    transform_issues.append(f"{obj.name} has non-finite mesh vertices")
            transform_records.append(
                {
                    "name": obj.name,
                    "type": obj.type,
                    "location": _vector(obj.location),
                    "rotationAngleRadians": _round(rotation_angle, 9),
                    "scale": _vector(obj.scale),
                    "finite": finite and vertex_finite,
                    "scaleApplied": scale_applied,
                    "meshRotationApplied": rotation_applied,
                }
            )
        checks["finiteAppliedTransforms"] = _check(
            not transform_issues,
            transform_issues,
            transformTolerance=TRANSFORM_TOLERANCE,
            objectCount=len(objects),
            objects=transform_records,
        )

        hierarchy = _descendants(root) if root is not None else set(objects)
        visible_meshes = _visible_meshes(hierarchy)
        minimum, maximum = _world_bounds(visible_meshes)
        dimensions = maximum - minimum
        ratios = [
            dimensions[index] / contract.target_dimensions_m[index]
            for index in range(3)
        ]
        bounds_issues = []
        if not visible_meshes:
            bounds_issues.append("no visible meshes remain after excluding collision proxies")
        if not _all_finite((*minimum, *maximum, *dimensions, *ratios)):
            bounds_issues.append("visible bounds contain non-finite values")
        for axis, ratio in zip("XYZ", ratios):
            if ratio < DIMENSION_MIN_RATIO or ratio > DIMENSION_MAX_RATIO:
                bounds_issues.append(
                    f"visible {axis} dimension ratio is {ratio:.4f}, expected "
                    f"{DIMENSION_MIN_RATIO:.2f}..{DIMENSION_MAX_RATIO:.2f} of target"
                )
        placement_measurement: dict[str, Any]
        if contract.placement == "hanging":
            pivot_tolerance = (
                contract.target_dimensions_m[2] * HANGING_PIVOT_TOLERANCE_RATIO
            )
            if minimum.z >= 0.0 or maximum.z <= 0.0:
                bounds_issues.append(
                    "hanging visible bounds must cross the root's hanger-contact Z plane"
                )
            if abs(maximum.z) > pivot_tolerance:
                bounds_issues.append(
                    f"hanging visible top is {maximum.z:.5f} m from root plane; "
                    f"tolerance is {pivot_tolerance:.5f} m"
                )
            placement_measurement = {
                "mode": "hanging",
                "rootContactPlaneZ": 0.0,
                "topOffsetFromRootMeters": _round(maximum.z),
                "toleranceMeters": _round(pivot_tolerance),
            }
        else:
            if abs(minimum.z) > STANDING_FLOOR_TOLERANCE_M:
                bounds_issues.append(
                    f"standing visible minimum Z is {minimum.z:.5f} m; expected floor "
                    f"contact within {STANDING_FLOOR_TOLERANCE_M:.3f} m"
                )
            placement_measurement = {
                "mode": "standing",
                "floorPlaneZ": 0.0,
                "minimumZOffsetMeters": _round(minimum.z),
                "toleranceMeters": STANDING_FLOOR_TOLERANCE_M,
            }
        checks["visibleBoundsVsTarget"] = _check(
            not bounds_issues,
            bounds_issues,
            targetDimensionsXYZMeters=list(contract.target_dimensions_m),
            visibleMinimumXYZMeters=_vector(minimum),
            visibleMaximumXYZMeters=_vector(maximum),
            visibleDimensionsXYZMeters=_vector(dimensions),
            dimensionRatios=_vector(ratios, 5),
            allowedDimensionRatio=[DIMENSION_MIN_RATIO, DIMENSION_MAX_RATIO],
            placement=placement_measurement,
            visibleMeshCount=len(visible_meshes),
        )

        details_issues = []
        by_name = {obj.name: obj for obj in hierarchy}
        missing_details = sorted(
            name for name in contract.required_detail_nodes if name not in by_name
        )
        if missing_details:
            details_issues.append(f"missing required detail nodes: {missing_details}")
        non_mesh_details = sorted(
            name
            for name in contract.required_detail_nodes
            if name in by_name and by_name[name].type != "MESH"
        )
        if non_mesh_details:
            details_issues.append(
                f"required detail nodes are not meshes: {non_mesh_details}"
            )
        missing_empties = sorted(
            name for name in contract.required_empty_nodes if name not in by_name
        )
        if missing_empties:
            details_issues.append(f"missing required interaction nodes: {missing_empties}")
        non_empty_helpers = sorted(
            name
            for name in contract.required_empty_nodes
            if name in by_name and by_name[name].type != "EMPTY"
        )
        if non_empty_helpers:
            details_issues.append(
                f"required interaction nodes are not empties: {non_empty_helpers}"
            )

        collision_nodes = sorted(
            (
                obj
                for obj in hierarchy
                if obj.name.startswith("COL_") or obj.get("collision_proxy") is True
            ),
            key=lambda obj: obj.name,
        )
        collision_names = [obj.name for obj in collision_nodes]
        if collision_names != [contract.collision_node]:
            details_issues.append(
                f"collision nodes are {collision_names}, expected exactly "
                f"[{contract.collision_node!r}]"
            )
        collision_records = []
        for collision in collision_nodes:
            extras = _custom_properties(collision)
            if collision.type != "MESH":
                details_issues.append(
                    f"{collision.name} type is {collision.type}, expected MESH"
                )
            if extras != {"collision_proxy": True, "shape": "box"}:
                details_issues.append(
                    f"{collision.name} extras are {extras}, expected the exact box-proxy contract"
                )
            collision_minimum, collision_maximum = _world_bounds((collision,))
            collision_records.append(
                {
                    "name": collision.name,
                    "type": collision.type,
                    "extras": extras,
                    "minimumXYZMeters": _vector(collision_minimum),
                    "maximumXYZMeters": _vector(collision_maximum),
                    "dimensionsXYZMeters": _vector(collision_maximum - collision_minimum),
                }
            )

        visible_triangles = _triangle_count(visible_meshes)
        if visible_triangles <= MIN_VISIBLE_TRIANGLES:
            details_issues.append(
                f"visible triangle count is {visible_triangles}, expected more than "
                f"{MIN_VISIBLE_TRIANGLES} for authored detail"
            )
        if visible_triangles >= MAX_VISIBLE_TRIANGLES:
            details_issues.append(
                f"visible triangle count is {visible_triangles}, expected fewer than "
                f"{MAX_VISIBLE_TRIANGLES} for a repeated product"
            )
        checks["requiredDetailsAndCollision"] = _check(
            not details_issues,
            details_issues,
            requiredDetailNodes=list(contract.required_detail_nodes),
            requiredInteractionNodes=list(contract.required_empty_nodes),
            expectedCollisionNode=contract.collision_node,
            importedCollisionNodes=collision_records,
            visibleTriangleCount=visible_triangles,
            visibleTriangleBudget={
                "exclusiveMinimum": MIN_VISIBLE_TRIANGLES,
                "exclusiveMaximum": MAX_VISIBLE_TRIANGLES,
            },
        )
    except Exception as exc:
        reason = f"{type(exc).__name__}: {exc}"
        exception_traceback = traceback.format_exc()
        for name in CHECK_NAMES[1:]:
            checks.setdefault(name, _failed_check(f"cannot evaluate after import failure: {reason}"))

    for name in CHECK_NAMES:
        checks.setdefault(
            name,
            _failed_check(f"internal verifier defect: mandatory check {name} was not evaluated"),
        )
    ordered_checks = {name: checks[name] for name in CHECK_NAMES}
    result = {
        "stem": contract.stem,
        "relativeGlbPath": contract.relative_glb_path,
        "ok": all(check["ok"] for check in ordered_checks.values()),
        "checks": ordered_checks,
    }
    if exception_traceback is not None:
        result["exceptionTraceback"] = exception_traceback
    return result


def _environment_check() -> dict[str, Any]:
    issues = []
    actual_major_minor = tuple(bpy.app.version[:2])
    if actual_major_minor != BLENDER_MAJOR_MINOR:
        issues.append(
            f"Blender version is {bpy.app.version_string}, expected 5.1.x"
        )
    if not bpy.app.background:
        issues.append("Blender is not running in background mode")
    factory_flag_present = "--factory-startup" in sys.argv
    if not factory_flag_present:
        issues.append("process arguments do not contain --factory-startup")
    return _check(
        not issues,
        issues,
        blenderVersion=bpy.app.version_string,
        blenderVersionTuple=list(bpy.app.version),
        background=bpy.app.background,
        factoryStartupFlagPresent=factory_flag_present,
        requiredInvocation=(
            "Blender 5.1/blender.exe --background --factory-startup "
            "--python tools/blender/verify_sheet03_product_reimport.py"
        ),
    )


def build_report() -> dict[str, Any]:
    environment = _environment_check()
    assets = [_verify_asset(contract) for contract in CONTRACTS]
    total_checks = len(assets) * len(CHECK_NAMES)
    passed_checks = sum(
        1 for asset in assets for check in asset["checks"].values() if check["ok"]
    )
    passed_assets = sum(1 for asset in assets if asset["ok"])
    return {
        "schemaVersion": SCHEMA_VERSION,
        "reportKind": REPORT_KIND,
        "scope": [contract.stem for contract in CONTRACTS],
        "requiredCheckNames": list(CHECK_NAMES),
        "units": "meters",
        "environment": environment,
        "method": {
            "inputRepresentation": "runtime GLB",
            "factoryResetBeforeEveryImport": True,
            "factoryResetOperation": "bpy.ops.wm.read_factory_settings(use_empty=True)",
            "visibleBoundsExcludeCollisionProxies": True,
            "stableEvidenceContainsTimestamp": False,
        },
        "assets": assets,
        "summary": {
            "assetCount": len(assets),
            "passedAssets": passed_assets,
            "failedAssets": len(assets) - passed_assets,
            "totalChecks": total_checks,
            "passedChecks": passed_checks,
            "failedChecks": total_checks - passed_checks,
        },
        "ok": environment["ok"] and passed_assets == len(assets),
    }


def _markdown(report: Mapping[str, Any]) -> str:
    mark = lambda value: "PASS" if value else "FAIL"
    lines = [
        "# Sheet 03 Product Clean-Reimport Verification v3",
        "",
        f"Overall: **{mark(report['ok'])}**",
        "",
        f"- Blender environment: **{mark(report['environment']['ok'])}** "
        f"(`{report['environment']['measurements']['blenderVersion']}`; background + factory startup)",
        "- Method: reset to an empty factory scene before importing each runtime GLB.",
        "- Visible bounds exclude authored `COL_` proxy meshes.",
        f"- Assets passed: {report['summary']['passedAssets']}/{report['summary']['assetCount']}",
        f"- Mandatory checks passed: {report['summary']['passedChecks']}/{report['summary']['totalChecks']}",
        "",
        "## Results",
        "",
        "| Product | Clean import | Exact root + metadata | No camera/light | Finite + applied | Bounds | Details + collision | Result |",
        "| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
    ]
    for asset in report["assets"]:
        checks = asset["checks"]
        lines.append(
            f"| `{asset['stem']}` | {mark(checks['cleanFactoryImport']['ok'])} | "
            f"{mark(checks['exactRootAndMetadata']['ok'])} | "
            f"{mark(checks['noCamerasOrLights']['ok'])} | "
            f"{mark(checks['finiteAppliedTransforms']['ok'])} | "
            f"{mark(checks['visibleBoundsVsTarget']['ok'])} | "
            f"{mark(checks['requiredDetailsAndCollision']['ok'])} | "
            f"{mark(asset['ok'])} |"
        )

    lines.extend(["", "## Measured visible bounds", ""])
    lines.extend([
        "| Product | Target XYZ (m) | Visible XYZ (m) | Ratio XYZ | Triangles | Collision |",
        "| --- | --- | --- | --- | ---: | --- |",
    ])
    for asset in report["assets"]:
        bounds = asset["checks"]["visibleBoundsVsTarget"]["measurements"]
        details = asset["checks"]["requiredDetailsAndCollision"]["measurements"]
        target = bounds.get("targetDimensionsXYZMeters", "unavailable")
        visible = bounds.get("visibleDimensionsXYZMeters", "unavailable")
        ratios = bounds.get("dimensionRatios", "unavailable")
        triangles = details.get("visibleTriangleCount", "unavailable")
        collision = details.get("expectedCollisionNode", "unavailable")
        lines.append(
            f"| `{asset['stem']}` | `{target}` | `{visible}` | `{ratios}` | "
            f"{triangles} | `{collision}` |"
        )

    failures = []
    for issue in report["environment"]["issues"]:
        failures.append(f"Environment: {issue}")
    for asset in report["assets"]:
        for check_name, check in asset["checks"].items():
            failures.extend(
                f"`{asset['stem']}` `{check_name}`: {issue}"
                for issue in check["issues"]
            )
    lines.extend(["", "## Failures", ""])
    lines.extend(f"- {failure}" for failure in failures)
    if not failures:
        lines.append("- None.")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    report = build_report()
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_JSON.write_text(
        json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    REPORT_MD.write_text(_markdown(report), encoding="utf-8")
    print(
        "SHEET03_PRODUCT_CLEAN_REIMPORT_V3|"
        + json.dumps(
            {
                "ok": report["ok"],
                "passedAssets": report["summary"]["passedAssets"],
                "failedChecks": report["summary"]["failedChecks"],
                "json": REPORT_JSON.relative_to(REPO_ROOT).as_posix(),
                "markdown": REPORT_MD.relative_to(REPO_ROOT).as_posix(),
            },
            sort_keys=True,
        )
    )
    return 0 if report["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
