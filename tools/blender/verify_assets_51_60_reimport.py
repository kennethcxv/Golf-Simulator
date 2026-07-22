"""Verify Sheet 06 GLBs by importing each canonical file into clean Blender.

This is deliberately a post-export verifier rather than a source-scene check.
Each asset is imported after ``read_factory_settings(use_empty=True)`` so the
evidence proves what Blender 5.1 can reconstruct from the shipped GLB itself.

Run from the repository root::

    blender --background --factory-startup \
      --python tools/blender/verify_assets_51_60_reimport.py

The deterministic report is written to
``qa/assets_51_100_master/sheet_06/clean_reimport.{json,md}``.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sys
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import bpy
from mathutils import Euler, Matrix, Vector


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
REPORT_DIR = REPO_ROOT / "qa" / "assets_51_100_master" / "sheet_06"
REPORT_JSON = REPORT_DIR / "clean_reimport.json"
REPORT_MD = REPORT_DIR / "clean_reimport.md"

SCHEMA_VERSION = 1
REPORT_KIND = "sheet06-clean-blender-reimport"
REGISTRATION_ID = "PINEHOLLOW_CLUBHOUSE_S06_V1"
FLOOR_Z = 0.27432
MATRIX_TOLERANCE = 1.0e-5
TRANSFORM_TOLERANCE = 1.0e-5
GROUND_TOLERANCE = 0.005
DIMENSION_TOLERANCE_RATIO = 0.08
RELIEF_TOLERANCE = 1.0e-6

APPROVED_NODE_PREFIX = re.compile(r"^(?:A_|MESH_|COL_|SOCKET_|PIVOT_|LOD[012]_)")
GENERIC_NAME = re.compile(
    r"^(?:Cube|Cylinder|Sphere|Icosphere|Torus|Cone|Curve|Text|Empty|"
    r"Material|Mesh|Object|BezierCurve)(?:\.\d+)?$",
    re.IGNORECASE,
)
COPY_SUFFIX = re.compile(r"\.\d{3}$")
ALLOWED_COLLISION_SHAPES = frozenset({"box", "cylinder", "convex_hull"})

CHECK_NAMES = (
    "artifactIntegrity",
    "cleanSceneImport",
    "identityRoot",
    "hierarchyAndNames",
    "markers",
    "animations",
    "noCamerasOrLights",
    "metricDimensionsAndGroundContact",
    "collisionContract",
    "materialsAndUvs",
    "meshTransforms",
    "assetSpecific",
)

EXTERIOR_MARKERS = (
    "SOCKET_ClubSign",
    "SOCKET_Damage_Roof",
    "SOCKET_Damage_Trim",
    "SOCKET_ExteriorLight_E",
    "SOCKET_ExteriorLight_W",
    "SOCKET_MainEntrance",
    "SOCKET_PLACEMENT",
    "SOCKET_Porch",
)


@dataclass(frozen=True)
class AssetContract:
    number: int
    stem: str
    dimensions_xyz: tuple[float, float, float]
    markers: tuple[str, ...]
    actions: tuple[str, ...]
    collision_purposes: tuple[str, ...]

    @property
    def id3(self) -> str:
        return f"{self.number:03d}"

    @property
    def filename_stem(self) -> str:
        return f"asset_{self.id3}_{self.stem}"

    @property
    def root_name(self) -> str:
        return f"A_{self.id3}_{self.stem.upper()}_ROOT"

    @property
    def source_relative(self) -> str:
        return f"asset_sources/blender/assets_51_100/sheet_06/{self.filename_stem}.blend"

    @property
    def canonical_relative(self) -> str:
        return f"Assets/assets_51_100/glb/sheet_06/{self.filename_stem}.glb"

    @property
    def runtime_relative(self) -> str:
        return f"vendor/models/assets_51_100/sheet_06/{self.filename_stem}.glb"


CONTRACTS = (
    AssetContract(51, "finished_clubhouse_exterior", (19.89, 13.46, 7.13),
                  EXTERIOR_MARKERS, (), ("blocking", "walkable")),
    AssetContract(52, "dilapidated_clubhouse_exterior", (19.20, 12.34, 7.13),
                  EXTERIOR_MARKERS, (), ("raycast-only",)),
    AssetContract(53, "main_entrance_double_door", (1.80, 0.24, 2.45),
                  ("PIVOT_DoorLeft", "PIVOT_DoorRight", "SOCKET_HandleLeft",
                   "SOCKET_HandleRight", "SOCKET_PLACEMENT", "SOCKET_Threshold"),
                  ("DoorLeft_Close", "DoorLeft_Open", "DoorRight_Close", "DoorRight_Open"),
                  ("animated-blocking", "blocking")),
    AssetContract(54, "exterior_porch_and_steps", (11.52, 3.29, 4.02),
                  ("SOCKET_Column_E", "SOCKET_Column_W", "SOCKET_MainEntrance",
                   "SOCKET_PLACEMENT", "SOCKET_Railing_E", "SOCKET_Railing_W"),
                  (), ("blocking", "walkable")),
    AssetContract(55, "clubhouse_windows_set", (2.19, 0.23, 1.74),
                  ("SOCKET_PLACEMENT", "SOCKET_WindowArched", "SOCKET_WindowNarrow",
                   "SOCKET_WindowStandard", "SOCKET_WindowWide"),
                  (), ("blocking", "raycast-only")),
    AssetContract(56, "interior_wall_panel_kit", (1.20, 0.075, 1.15),
                  ("SOCKET_DoorConnector", "SOCKET_InsideCorner", "SOCKET_OutsideCorner",
                   "SOCKET_PLACEMENT", "SOCKET_PanelNext", "SOCKET_WindowConnector"),
                  (), ("selection-blocking",)),
    AssetContract(57, "interior_trim_and_baseboard_kit", (2.40, 0.025, 0.14),
                  ("SOCKET_EndCap", "SOCKET_InsideCorner", "SOCKET_Junction",
                   "SOCKET_OutsideCorner", "SOCKET_PLACEMENT", "SOCKET_TrimNext"),
                  (), ("raycast-only",)),
    AssetContract(58, "ceiling_and_beam_kit", (3.60, 0.96, 1.08),
                  ("SOCKET_BeamCross", "SOCKET_BeamEnd", "SOCKET_BeamNext",
                   "SOCKET_PLACEMENT", "SOCKET_RecessedLight"),
                  (), ("overhead-blocking",)),
    AssetContract(59, "renovated_flooring_set", (1.00, 1.00, 0.018),
                  ("SOCKET_FloorOrigin", "SOCKET_FloorTransition", "SOCKET_PLACEMENT"),
                  (), ("walkable",)),
    AssetContract(60, "damaged_flooring_set", (1.00, 1.00, 0.035),
                  ("SOCKET_DamageModule", "SOCKET_FloorOrigin", "SOCKET_FloorTransition",
                   "SOCKET_PLACEMENT"),
                  (), ("raycast-only",)),
)


def _round(value: float, digits: int = 7) -> float:
    result = round(float(value), digits)
    return 0.0 if result == -0.0 else result


def _vector(values: Iterable[float]) -> list[float]:
    return [_round(value) for value in values]


def _matrix(matrix: Matrix) -> list[float]:
    return [_round(matrix[row][column], 8) for row in range(4) for column in range(4)]


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
    return {key: _plain(obj[key]) for key in sorted(obj.keys()) if key != "_RNA_UI"}


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
    return _check(False, [reason])


def _nearly(left: float, right: float, tolerance: float = TRANSFORM_TOLERANCE) -> bool:
    return abs(float(left) - float(right)) <= tolerance


def _matrix_near(left: Sequence[float], right: Sequence[float], tolerance: float = MATRIX_TOLERANCE) -> bool:
    return len(left) == len(right) and all(_nearly(a, b, tolerance) for a, b in zip(left, right))


def _reset_clean_scene() -> dict[str, int]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    return {
        "objects": len(bpy.data.objects),
        "meshes": len(bpy.data.meshes),
        "materials": len(bpy.data.materials),
        "actions": len(bpy.data.actions),
        "cameras": len(bpy.data.cameras),
        "lights": len(bpy.data.lights),
    }


def _descendants(root: bpy.types.Object) -> set[bpy.types.Object]:
    found: set[bpy.types.Object] = set()
    pending = [root]
    while pending:
        obj = pending.pop()
        if obj in found:
            continue
        found.add(obj)
        pending.extend(obj.children)
    return found


def _visible_meshes(objects: Sequence[bpy.types.Object]) -> list[bpy.types.Object]:
    return [
        obj for obj in objects
        if obj.type == "MESH" and not obj.name.startswith("COL_")
        and obj.get("collision_proxy") is not True
    ]


def _world_bounds(objects: Sequence[bpy.types.Object]) -> tuple[Vector, Vector]:
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    found = False
    for obj in objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                minimum[axis] = min(minimum[axis], world[axis])
                maximum[axis] = max(maximum[axis], world[axis])
            found = True
    if not found:
        raise ValueError("no mesh bounds were available after import")
    return minimum, maximum


def _action_curve_count(action: bpy.types.Action) -> int:
    fcurves = getattr(action, "fcurves", None)
    if fcurves is not None:
        try:
            return len(fcurves)
        except TypeError:
            pass
    count = 0
    for layer in getattr(action, "layers", ()):
        for strip in getattr(layer, "strips", ()):
            for channelbag in getattr(strip, "channelbags", ()):
                count += len(getattr(channelbag, "fcurves", ()))
    return count


def _action_owner_hints(objects: Sequence[bpy.types.Object]) -> dict[str, set[str]]:
    owners: dict[str, set[str]] = {}
    for obj in objects:
        animation_data = obj.animation_data
        if animation_data is None:
            continue
        if animation_data.action is not None:
            owners.setdefault(animation_data.action.name, set()).add(obj.name)
        for track in animation_data.nla_tracks:
            for strip in track.strips:
                if strip.action is not None:
                    owners.setdefault(strip.action.name, set()).add(obj.name)
    for action in bpy.data.actions:
        hints = owners.setdefault(action.name, set())
        for slot in getattr(action, "slots", ()):
            for attribute in ("identifier", "name", "display_name"):
                value = getattr(slot, attribute, None)
                if value:
                    hints.add(str(value))
    return owners


def _restore_static_authoring_pose(
    contract: AssetContract,
    objects: Sequence[bpy.types.Object],
    objects_by_name: Mapping[str, bpy.types.Object],
) -> str:
    """Evaluate bounds in the exported static/rest pose, not an active clip.

    Blender's glTF importer makes one imported clip active.  For Asset 53 that
    can be the first frame of a ``*_Close`` action, where a leaf is intentionally
    open.  The GLB dimension contract describes the closed authored assembly,
    so action existence/ownership is captured first and then the two physical
    hinges are restored to their exported closed pose for spatial checks.
    """

    if contract.number != 53:
        return "STATIC_EXPORTED_POSE"
    for obj in objects:
        animation_data = obj.animation_data
        if animation_data is None:
            continue
        try:
            animation_data.action = None
        except (AttributeError, RuntimeError, TypeError):
            pass
        for track in animation_data.nla_tracks:
            track.mute = True
    for name in ("PIVOT_DoorLeft", "PIVOT_DoorRight"):
        pivot = objects_by_name.get(name)
        if pivot is not None:
            pivot.rotation_mode = "XYZ"
            pivot.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    return "ASSET53_CLOSED_AUTHORING_POSE_AFTER_ACTION_VERIFICATION"


def _identity_issues(obj: bpy.types.Object) -> list[str]:
    issues: list[str] = []
    if obj.parent is not None:
        issues.append(f"identity root parent is {obj.parent.name}, expected none")
    if obj.type != "EMPTY":
        issues.append(f"identity root type is {obj.type}, expected EMPTY")
    if any(not _nearly(value, 0.0) for value in obj.location):
        issues.append(f"identity root location is {_vector(obj.location)}, expected [0, 0, 0]")
    rotation = obj.rotation_euler
    if any(not _nearly(value, 0.0) for value in rotation):
        issues.append(f"identity root rotation is {_vector(rotation)}, expected [0, 0, 0]")
    if any(not _nearly(value, 1.0) for value in obj.scale):
        issues.append(f"identity root scale is {_vector(obj.scale)}, expected [1, 1, 1]")
    return issues


def _marker_snapshot(obj: bpy.types.Object) -> dict[str, Any]:
    return {
        "localMatrix": _matrix(obj.matrix_local),
        "worldMatrix": _matrix(obj.matrix_world),
        "locationMeters": _vector(obj.location),
        "rotationEulerRadians": _vector(obj.rotation_euler),
        "extras": _custom_properties(obj),
    }


def _root_contract_issues(contract: AssetContract, root: bpy.types.Object) -> list[str]:
    extras = _custom_properties(root)
    expected_stem = contract.filename_stem
    expected_values = {
        "asset_number": contract.number,
        "asset_slug": contract.stem,
        "asset_stem": expected_stem,
        "asset_sheet": 6,
        "first_person_variant": False,
        "build_schema_version": 1,
        "units": "meters",
        "authored_units": "meters",
        "up_axis": "+Z",
        "front_axis": "-Y",
        "license": "Project-owned",
        "source": "Original Pinehollow Golf Flipper asset authored in-repository",
    }
    issues: list[str] = []
    for key, expected in expected_values.items():
        if extras.get(key) != expected:
            issues.append(f"root extra {key} is {extras.get(key)!r}, expected {expected!r}")
    expected_dimensions = list(contract.dimensions_xyz)
    try:
        encoded_dimensions = json.loads(str(extras.get("target_dimensions_m")))
    except (TypeError, ValueError, json.JSONDecodeError):
        encoded_dimensions = None
    if encoded_dimensions != expected_dimensions:
        issues.append(
            f"target_dimensions_m is {encoded_dimensions!r}, expected {expected_dimensions!r}"
        )
    for key, expected in zip(
        ("target_width_m", "target_depth_m", "target_height_m"), expected_dimensions
    ):
        actual = extras.get(key)
        if not isinstance(actual, (int, float)) or not _nearly(actual, expected, 1.0e-6):
            issues.append(f"root extra {key} is {actual!r}, expected {expected}")
    return issues


def _asset_specific_check(
    contract: AssetContract,
    root: bpy.types.Object,
    objects: Sequence[bpy.types.Object],
    objects_by_name: Mapping[str, bpy.types.Object],
    animation_measurements: Mapping[str, Any],
    visible_minimum: Vector,
    visible_maximum: Vector,
) -> dict[str, Any]:
    extras = _custom_properties(root)
    issues: list[str] = []
    measurements: dict[str, Any] = {
        "contract": "asset identity/provenance plus the numbered Sheet-6 special contract",
    }

    if contract.number == 51:
        expected = {
            "registration_id": REGISTRATION_ID,
            "structural_role": "CANONICAL_STRUCTURAL_AUTHORITY",
            "structural_authority": True,
        }
        for key, value in expected.items():
            if extras.get(key) != value:
                issues.append(f"Asset 51 root extra {key} is {extras.get(key)!r}, expected {value!r}")
        measurements["authority"] = expected
    elif contract.number == 52:
        expected = {
            "registration_id": REGISTRATION_ID,
            "structural_role": "ADDITIVE_DAMAGE_VISUALS",
            "structural_authority": False,
            "additive_damage_only": True,
            "owns_navigation_collision": False,
            "canonical_structure_asset": 51,
            "structural_collision": False,
        }
        for key, value in expected.items():
            if extras.get(key) != value:
                issues.append(f"Asset 52 root extra {key} is {extras.get(key)!r}, expected {value!r}")
        forbidden_claims = []
        for obj in objects:
            props = _custom_properties(obj)
            if props.get("structural_authority") is True or props.get("structural_geometry") is True:
                forbidden_claims.append(obj.name)
            if props.get("collision_authority") is True or props.get("owns_navigation_collision") is True:
                forbidden_claims.append(obj.name)
        if forbidden_claims:
            issues.append(f"Asset 52 descendants claim structural/navigation authority: {sorted(set(forbidden_claims))}")
        measurements["authority"] = expected
        measurements["forbiddenAuthorityClaims"] = sorted(set(forbidden_claims))
    elif contract.number == 53:
        pivot_names = sorted(name for name in objects_by_name if name.startswith("PIVOT_"))
        expected_pivots = ["PIVOT_DoorLeft", "PIVOT_DoorRight"]
        if pivot_names != expected_pivots:
            issues.append(f"Asset 53 pivots are {pivot_names}, expected {expected_pivots}")
        for name, expected_location in (
            ("PIVOT_DoorLeft", (-0.80, 0.0, 0.04)),
            ("PIVOT_DoorRight", (0.80, 0.0, 0.04)),
        ):
            obj = objects_by_name.get(name)
            if obj is None or any(not _nearly(a, b) for a, b in zip(obj.location, expected_location)):
                issues.append(f"{name} is not at its physical hinge datum {list(expected_location)}")
        action_targets_ok = bool(animation_measurements.get("targetsMatchPivots"))
        if not action_targets_ok:
            issues.append("Asset 53 imported actions are not owned by their named hinge pivots")
        measurements["pivots"] = pivot_names
        measurements["fourActionsTargetPivots"] = action_targets_ok
    elif contract.number == 54:
        marker = objects_by_name.get("SOCKET_MainEntrance")
        actual = _vector(marker.location) if marker is not None else None
        expected = [0.0, 0.0, FLOOR_Z]
        if marker is None or any(not _nearly(a, b, 1.0e-6) for a, b in zip(marker.location, expected)):
            issues.append(
                f"Asset 54 SOCKET_MainEntrance is {actual}, expected revised deck datum {expected} metres"
            )
        if marker is not None and any(not _nearly(value, 0.0) for value in marker.rotation_euler):
            issues.append("Asset 54 SOCKET_MainEntrance rotation must remain identity")
        expected_root_extras = {
            "deck_surface_z_m": FLOOR_Z,
            "main_entrance_alignment_z_m": FLOOR_Z,
            "stair_rise_count": 2,
        }
        for key, expected_value in expected_root_extras.items():
            actual_value = extras.get(key)
            if isinstance(expected_value, float):
                matches = isinstance(actual_value, (int, float)) and _nearly(
                    actual_value, expected_value, 1.0e-6
                )
            else:
                matches = actual_value == expected_value
            if not matches:
                issues.append(
                    f"Asset 54 root extra {key} is {actual_value!r}, expected {expected_value!r}"
                )
        deck = objects_by_name.get("MESH_OakDeckBoards")
        deck_top = None
        if deck is None or deck.type != "MESH":
            issues.append("Asset 54 requires the exact imported mesh MESH_OakDeckBoards")
        else:
            _deck_minimum, deck_maximum = _world_bounds([deck])
            deck_top = _round(deck_maximum.z)
            if not _nearly(deck_maximum.z, FLOOR_Z, 1.0e-6):
                issues.append(
                    f"Asset 54 MESH_OakDeckBoards top is {deck_maximum.z:.7f}m, expected {FLOOR_Z:.7f}m"
                )
        stair_mesh = objects_by_name.get("MESH_OakStairTreadsAndNosings")
        stair_mesh_rises = stair_mesh.get("stair_rises") if stair_mesh is not None else None
        if stair_mesh is None or stair_mesh.type != "MESH":
            issues.append("Asset 54 requires MESH_OakStairTreadsAndNosings")
        elif stair_mesh_rises != 2:
            issues.append(
                f"Asset 54 stair mesh declares {stair_mesh_rises!r} rises, expected exactly 2"
            )
        measurements["mainEntranceLocationMeters"] = actual
        measurements["expectedMainEntranceLocationMeters"] = expected
        measurements["floorZMetres"] = FLOOR_Z
        measurements["deckSurfaceTopMeters"] = deck_top
        measurements["expectedRootExtras"] = expected_root_extras
        measurements["actualRootExtras"] = {
            key: extras.get(key) for key in expected_root_extras
        }
        measurements["stairMeshRiseCount"] = stair_mesh_rises
    elif contract.number == 59:
        oak = objects_by_name.get("MESH_FloorOakPlankField")
        top_loop_normals: list[list[float]] = []
        normal_issues: list[str] = []
        if oak is None or oak.type != "MESH":
            issues.append("Asset 59 requires the exact imported mesh MESH_FloorOakPlankField")
        else:
            if _custom_properties(oak).get("flat_floor_normals") is not True:
                issues.append("Asset 59 oak mesh must declare flat_floor_normals=true")
            for polygon in oak.data.polygons:
                if polygon.normal.z < 0.999999:
                    continue
                for loop_index in polygon.loop_indices:
                    normal = oak.data.loops[loop_index].normal
                    rounded = [_round(normal.x), _round(normal.y), _round(normal.z)]
                    top_loop_normals.append(rounded)
                    if (abs(normal.x) > 1.0e-6
                            or abs(normal.y) > 1.0e-6
                            or abs(normal.z - 1.0) > 1.0e-6):
                        normal_issues.append(
                            f"loop {loop_index} normal is {rounded}, expected [0, 0, 1]"
                        )
            if not top_loop_normals:
                issues.append("Asset 59 oak mesh has no upward-facing top loops")
            if normal_issues:
                issues.append(
                    "Asset 59 oak top is not flat shaded: "
                    + "; ".join(normal_issues[:8])
                )
        measurements["oakFlatNormalsDeclared"] = (
            oak is not None and _custom_properties(oak).get("flat_floor_normals") is True
        )
        measurements["oakTopLoopCount"] = len(top_loop_normals)
        measurements["oakTopLoopNormals"] = sorted({tuple(value) for value in top_loop_normals})
    elif contract.number == 60:
        relief = float(visible_maximum.z - visible_minimum.z)
        if visible_minimum.z < -RELIEF_TOLERANCE:
            issues.append(f"Asset 60 visible geometry falls below datum at z={visible_minimum.z:.7f}m")
        if relief <= 0.0 or relief > 0.035 + RELIEF_TOLERANCE:
            issues.append(f"Asset 60 visible relief is {relief:.7f}m, maximum is 0.035m")
        measurements["visibleReliefMeters"] = _round(relief)
        measurements["maximumReliefMeters"] = 0.035
    else:
        # The numbered modules have no extra authority/animation rule.  Their
        # non-skipped asset-specific gate is exact identity and provenance.
        provenance_ok = not _root_contract_issues(contract, root)
        if not provenance_ok:
            issues.append(f"Asset {contract.number} numbered-module provenance is not exact")
        measurements["numberedModuleIdentityAndProvenance"] = provenance_ok

    construction_contracts = {
        51: (10, 2),
        53: (25, 5),
        55: (20, 4),
        56: (30, 6),
        58: (50, 10),
        59: (40, 8),
    }
    if contract.number in construction_contracts:
        expected_variant_count, expected_family_count = construction_contracts[contract.number]
        try:
            declared_ids = {
                value for value in json.loads(str(extras.get("variant_ids_json")))
                if isinstance(value, str) and value.startswith("construction_")
            }
        except (TypeError, ValueError, json.JSONDecodeError):
            declared_ids = set()
            issues.append(f"Asset {contract.number} construction variant manifest is not valid JSON")

        tagged_records: dict[str, set[tuple[str, str, int]]] = {}
        for obj in objects:
            props = _custom_properties(obj)
            variant_ids = {
                value for value in props.values()
                if isinstance(value, str) and value.startswith("construction_")
            }
            for variant_id in variant_ids:
                family = props.get("construction_finish_family", props.get("finish_family"))
                quality = props.get("construction_quality")
                level = props.get("construction_quality_level")
                if isinstance(family, str) and isinstance(quality, str) and isinstance(level, int):
                    tagged_records.setdefault(variant_id, set()).add((family, quality, level))
                else:
                    tagged_records.setdefault(variant_id, set())

        tagged_ids = set(tagged_records)
        if len(declared_ids) != expected_variant_count:
            issues.append(
                f"Asset {contract.number} declares {len(declared_ids)} construction variants, "
                f"expected {expected_variant_count}"
            )
        if tagged_ids != declared_ids:
            missing = sorted(declared_ids - tagged_ids)
            undeclared = sorted(tagged_ids - declared_ids)
            issues.append(
                f"Asset {contract.number} construction tags do not match its manifest; "
                f"missing={missing}, undeclared={undeclared}"
            )
        malformed = sorted(variant_id for variant_id, records in tagged_records.items() if not records)
        if malformed:
            issues.append(
                f"Asset {contract.number} construction variants lack family/quality/level tags: {malformed}"
            )
        families = {
            family
            for records in tagged_records.values()
            for family, _quality, _level in records
        }
        qualities = {
            (quality, level)
            for records in tagged_records.values()
            for _family, quality, level in records
        }
        expected_qualities = {
            ("municipal", 1), ("standard", 2), ("premium", 3),
            ("high_end", 4), ("luxury", 5),
        }
        if len(families) != expected_family_count:
            issues.append(
                f"Asset {contract.number} has {len(families)} construction families, "
                f"expected {expected_family_count}"
            )
        if qualities != expected_qualities:
            issues.append(
                f"Asset {contract.number} construction quality ladder is {sorted(qualities)}, "
                f"expected {sorted(expected_qualities)}"
            )
        measurements["constructionFinishLibrary"] = {
            "declaredVariantCount": len(declared_ids),
            "taggedVariantCount": len(tagged_ids),
            "familyCount": len(families),
            "qualities": sorted(qualities),
            "variantIds": sorted(tagged_ids),
        }

    return _check(not issues, issues, **measurements)


def _verify_asset(contract: AssetContract) -> tuple[dict[str, Any], dict[str, Any]]:
    source = REPO_ROOT / contract.source_relative
    canonical = REPO_ROOT / contract.canonical_relative
    runtime = REPO_ROOT / contract.runtime_relative
    canonical_sha = _sha256(canonical)
    runtime_sha = _sha256(runtime)
    artifact_issues = []
    for label, path in (("Blender source", source), ("canonical GLB", canonical), ("runtime GLB", runtime)):
        if not path.is_file():
            artifact_issues.append(f"{label} is missing at {path.relative_to(REPO_ROOT).as_posix()}")
        elif path.stat().st_size <= 20:
            artifact_issues.append(f"{label} is empty or truncated")
    if canonical_sha is None or runtime_sha is None or canonical_sha != runtime_sha:
        artifact_issues.append("canonical/runtime SHA-256 values are not byte-identical")

    checks: dict[str, dict[str, Any]] = {
        "artifactIntegrity": _check(
            not artifact_issues,
            artifact_issues,
            sourceExists=source.is_file(),
            canonicalExists=canonical.is_file(),
            runtimeExists=runtime.is_file(),
            canonicalSha256=canonical_sha,
            runtimeSha256=runtime_sha,
            byteIdentical=canonical_sha is not None and canonical_sha == runtime_sha,
        )
    }
    snapshots: dict[str, Any] = {}
    dependency_failure: str | None = None

    try:
        pre_import_counts = _reset_clean_scene()
        if not canonical.is_file():
            raise FileNotFoundError(f"canonical GLB does not exist: {contract.canonical_relative}")
        operator_result = sorted(bpy.ops.import_scene.gltf(filepath=str(canonical)))
        bpy.context.view_layer.update()
        objects = sorted(list(bpy.context.scene.objects), key=lambda obj: obj.name)
        objects_by_name = {obj.name: obj for obj in objects}
        clean_issues = []
        if any(pre_import_counts.values()):
            clean_issues.append(f"factory-empty scene retained data before import: {pre_import_counts}")
        if operator_result != ["FINISHED"]:
            clean_issues.append(f"glTF import operator returned {operator_result}, expected ['FINISHED']")
        checks["cleanSceneImport"] = _check(
            not clean_issues,
            clean_issues,
            preImportCounts=pre_import_counts,
            importOperatorResult=operator_result,
            importedObjectCount=len(objects),
            canonicalPath=contract.canonical_relative,
        )

        exact_roots = [obj for obj in objects if obj.name == contract.root_name]
        identity_roots = [obj for obj in objects if obj.name.startswith("A_") and obj.name.endswith("_ROOT")]
        root_issues = []
        if len(exact_roots) != 1:
            root_issues.append(f"found {len(exact_roots)} exact roots named {contract.root_name}, expected one")
        if len(identity_roots) != 1:
            root_issues.append(f"found {len(identity_roots)} A_*_ROOT objects, expected one")
        root = exact_roots[0] if exact_roots else None
        if root is not None:
            root_issues.extend(_identity_issues(root))
            root_issues.extend(_root_contract_issues(contract, root))
        checks["identityRoot"] = _check(
            not root_issues,
            root_issues,
            expectedRoot=contract.root_name,
            exactRootCount=len(exact_roots),
            identityRootNames=sorted(obj.name for obj in identity_roots),
            rootLocalMatrix=_matrix(root.matrix_local) if root is not None else None,
            rootExtras=_custom_properties(root) if root is not None else None,
        )
        if root is None:
            raise ValueError(f"cannot continue without exact identity root {contract.root_name}")

        reachable = _descendants(root)
        hierarchy_issues = []
        top_level = sorted(obj.name for obj in objects if obj.parent is None)
        if reachable != set(objects):
            orphans = sorted(obj.name for obj in set(objects) - reachable)
            hierarchy_issues.append(f"objects are not reachable from identity root: {orphans}")
        if top_level != [contract.root_name]:
            hierarchy_issues.append(f"top-level objects are {top_level}, expected only {contract.root_name}")
        names = [obj.name for obj in objects]
        if len(set(names)) != len(names):
            hierarchy_issues.append("duplicate imported object names were found")
        for obj in objects:
            if obj is root:
                continue
            if not APPROVED_NODE_PREFIX.match(obj.name):
                hierarchy_issues.append(f"{obj.name} lacks an approved node prefix")
            if GENERIC_NAME.fullmatch(obj.name):
                hierarchy_issues.append(f"{obj.name} is a generic authoring name")
            if COPY_SUFFIX.search(obj.name):
                hierarchy_issues.append(f"{obj.name} has a suspicious Blender copy suffix")
        checks["hierarchyAndNames"] = _check(
            not hierarchy_issues,
            hierarchy_issues,
            importedObjectCount=len(objects),
            reachableObjectCount=len(reachable),
            topLevelObjects=top_level,
            objectNames=names,
        )

        marker_objects = {
            obj.name: obj for obj in objects
            if obj.name.startswith("SOCKET_") or obj.name.startswith("PIVOT_")
        }
        marker_issues = []
        actual_markers = sorted(marker_objects)
        expected_markers = sorted(contract.markers)
        if actual_markers != expected_markers:
            marker_issues.append(f"markers are {actual_markers}, expected exactly {expected_markers}")
        for name, marker in marker_objects.items():
            expected_type = "pivot" if name.startswith("PIVOT_") else "socket"
            if marker.type != "EMPTY":
                marker_issues.append(f"{name} type is {marker.type}, expected EMPTY")
            if marker.get("marker_type") != expected_type:
                marker_issues.append(
                    f"{name} marker_type is {marker.get('marker_type')!r}, expected {expected_type!r}"
                )
        checks["markers"] = _check(
            not marker_issues,
            marker_issues,
            expectedMarkers=expected_markers,
            actualMarkers=actual_markers,
            markerCount=len(marker_objects),
        )

        actions = {action.name: action for action in bpy.data.actions}
        actual_actions = sorted(actions)
        expected_actions = sorted(contract.actions)
        action_owners = _action_owner_hints(objects)
        animation_issues = []
        curve_counts = {name: _action_curve_count(action) for name, action in sorted(actions.items())}
        if actual_actions != expected_actions:
            animation_issues.append(f"actions are {actual_actions}, expected exactly {expected_actions}")
        for name in expected_actions:
            if curve_counts.get(name, 0) <= 0:
                animation_issues.append(f"{name} contains no imported animation curves")
        targets_match = True
        if contract.number == 53:
            for name in expected_actions:
                expected_pivot = "PIVOT_DoorLeft" if "Left" in name else "PIVOT_DoorRight"
                hints = action_owners.get(name, set())
                if not any(expected_pivot in hint for hint in hints):
                    targets_match = False
                    animation_issues.append(
                        f"{name} owner/slot hints {sorted(hints)} do not target {expected_pivot}"
                    )
        animation_measurements = {
            "expectedActions": expected_actions,
            "actualActions": actual_actions,
            "curveCounts": curve_counts,
            "ownerOrSlotHints": {key: sorted(value) for key, value in sorted(action_owners.items())},
            "targetsMatchPivots": targets_match,
        }
        checks["animations"] = _check(not animation_issues, animation_issues, **animation_measurements)

        evaluated_pose = _restore_static_authoring_pose(contract, objects, objects_by_name)

        ship_node_issues = []
        cameras = sorted(obj.name for obj in objects if obj.type == "CAMERA")
        lights = sorted(obj.name for obj in objects if obj.type == "LIGHT")
        if cameras:
            ship_node_issues.append(f"imported cameras must be empty, found {cameras}")
        if lights:
            ship_node_issues.append(f"imported lights must be empty, found {lights}")
        checks["noCamerasOrLights"] = _check(
            not ship_node_issues,
            ship_node_issues,
            cameras=cameras,
            lights=lights,
            cameraDatablocks=len(bpy.data.cameras),
            lightDatablocks=len(bpy.data.lights),
        )

        visible_meshes = _visible_meshes(objects)
        minimum, maximum = _world_bounds(visible_meshes)
        dimensions = maximum - minimum
        dimension_issues = []
        for axis, actual, expected in zip("XYZ", dimensions, contract.dimensions_xyz):
            allowed = max(0.01, abs(expected) * DIMENSION_TOLERANCE_RATIO)
            if abs(actual - expected) > allowed:
                dimension_issues.append(
                    f"visible {axis} dimension {actual:.7f}m differs from {expected:.7f}m by more than {allowed:.7f}m"
                )
        if minimum.z < -GROUND_TOLERANCE or minimum.z > GROUND_TOLERANCE:
            dimension_issues.append(
                f"visible ground contact is z={minimum.z:.7f}m, expected within +/-{GROUND_TOLERANCE:.3f}m"
            )
        scene = bpy.context.scene
        if scene.unit_settings.system != "METRIC" or scene.unit_settings.length_unit != "METERS":
            dimension_issues.append(
                f"clean reimport scene units are {scene.unit_settings.system}/{scene.unit_settings.length_unit}"
            )
        if not _nearly(scene.unit_settings.scale_length, 1.0, 1.0e-9):
            dimension_issues.append(f"scene unit scale is {scene.unit_settings.scale_length}, expected 1.0")
        checks["metricDimensionsAndGroundContact"] = _check(
            not dimension_issues,
            dimension_issues,
            units="meters",
            sceneUnitSystem=scene.unit_settings.system,
            sceneLengthUnit=scene.unit_settings.length_unit,
            sceneScaleLength=scene.unit_settings.scale_length,
            targetDimensionsXYZMeters=contract.dimensions_xyz,
            actualDimensionsXYZMeters=_vector(dimensions),
            boundsMinimumXYZMeters=_vector(minimum),
            boundsMaximumXYZMeters=_vector(maximum),
            dimensionToleranceRatio=DIMENSION_TOLERANCE_RATIO,
            groundToleranceMeters=GROUND_TOLERANCE,
            evaluatedPose=evaluated_pose,
        )

        collision_objects = sorted(
            [obj for obj in objects if obj.name.startswith("COL_")], key=lambda obj: obj.name
        )
        collision_issues = []
        purposes = set()
        collision_records = []
        if not collision_objects:
            collision_issues.append("no imported COL_ collision/raycast meshes were found")
        for collision in collision_objects:
            props = _custom_properties(collision)
            purpose = props.get("collision_purpose")
            shape = props.get("collision_shape")
            if collision.type != "MESH":
                collision_issues.append(f"{collision.name} type is {collision.type}, expected MESH")
            if props.get("collision_proxy") is not True:
                collision_issues.append(f"{collision.name} collision_proxy is not true")
            if shape not in ALLOWED_COLLISION_SHAPES:
                collision_issues.append(f"{collision.name} collision_shape is {shape!r}")
            if not isinstance(purpose, str) or not purpose:
                collision_issues.append(f"{collision.name} collision_purpose is missing")
            else:
                purposes.add(purpose)
            collision_records.append({"name": collision.name, "shape": shape, "purpose": purpose})
        expected_purposes = sorted(contract.collision_purposes)
        if sorted(purposes) != expected_purposes:
            collision_issues.append(
                f"collision purposes are {sorted(purposes)}, expected exactly {expected_purposes}"
            )
        for obj in objects:
            if obj.get("collision_proxy") is True and not obj.name.startswith("COL_"):
                collision_issues.append(f"{obj.name} claims collision_proxy without COL_ prefix")
        checks["collisionContract"] = _check(
            not collision_issues,
            collision_issues,
            collisionCount=len(collision_objects),
            expectedPurposes=expected_purposes,
            actualPurposes=sorted(purposes),
            collisionMeshes=collision_records,
        )

        material_uv_issues = []
        mesh_records = []
        material_names = set()
        if not visible_meshes:
            material_uv_issues.append("no visible imported meshes were found")
        for mesh_object in visible_meshes:
            materials = [material for material in mesh_object.data.materials if material is not None]
            uv_names = sorted(layer.name for layer in mesh_object.data.uv_layers)
            if not materials:
                material_uv_issues.append(f"{mesh_object.name} has no material after GLB reimport")
            if not uv_names:
                material_uv_issues.append(f"{mesh_object.name} has no UV layer after GLB reimport")
            for material in materials:
                material_names.add(material.name)
                if GENERIC_NAME.fullmatch(material.name) or COPY_SUFFIX.search(material.name):
                    material_uv_issues.append(f"{mesh_object.name} uses suspicious material {material.name}")
                if not material.use_nodes:
                    material_uv_issues.append(f"{material.name} is not a node-based PBR material")
                elif material.node_tree.nodes.get("Principled BSDF") is None:
                    material_uv_issues.append(f"{material.name} lacks a Principled BSDF")
            mesh_records.append({
                "name": mesh_object.name,
                "materials": sorted(material.name for material in materials),
                "uvLayers": uv_names,
            })
        checks["materialsAndUvs"] = _check(
            not material_uv_issues,
            material_uv_issues,
            visibleMeshCount=len(visible_meshes),
            materialCount=len(material_names),
            materialNames=sorted(material_names),
            visibleMeshes=mesh_records,
        )

        transform_issues = []
        transform_records = []
        for mesh_object in sorted(
            [obj for obj in objects if obj.type == "MESH"], key=lambda obj: obj.name
        ):
            translation, rotation, scale = mesh_object.matrix_basis.decompose()
            rotation_angle = rotation.angle
            suspicious = (
                any(not _nearly(value, 1.0) for value in scale)
                or not _nearly(rotation_angle, 0.0)
            )
            if suspicious:
                transform_issues.append(
                    f"{mesh_object.name} has unapplied local rotation/scale after reimport: "
                    f"angle={rotation_angle:.8f}, scale={_vector(scale)}"
                )
            transform_records.append({
                "name": mesh_object.name,
                "translation": _vector(translation),
                "rotationAngleRadians": _round(rotation_angle, 9),
                "scale": _vector(scale),
                "suspicious": suspicious,
            })
        checks["meshTransforms"] = _check(
            not transform_issues,
            transform_issues,
            transformTolerance=TRANSFORM_TOLERANCE,
            suspiciousMeshCount=sum(1 for item in transform_records if item["suspicious"]),
            meshes=transform_records,
        )

        checks["assetSpecific"] = _asset_specific_check(
            contract,
            root,
            objects,
            objects_by_name,
            animation_measurements,
            minimum,
            maximum,
        )

        snapshots = {
            "rootExtras": _custom_properties(root),
            "markers": {name: _marker_snapshot(obj) for name, obj in sorted(marker_objects.items())},
            "visibleBounds": {
                "minimumXYZMeters": _vector(minimum),
                "maximumXYZMeters": _vector(maximum),
                "dimensionsXYZMeters": _vector(dimensions),
            },
        }
    except Exception as exc:  # Evidence must still record every mandatory check.
        dependency_failure = f"{type(exc).__name__}: {exc}"
        if "cleanSceneImport" not in checks:
            checks["cleanSceneImport"] = _failed_check(dependency_failure)
        for name in CHECK_NAMES:
            checks.setdefault(name, _failed_check(f"cannot evaluate after clean-import failure: {dependency_failure}"))
        snapshots["exceptionTraceback"] = traceback.format_exc()

    for name in CHECK_NAMES:
        checks.setdefault(name, _failed_check(f"internal verifier defect: mandatory check {name} was not evaluated"))
    checks = {name: checks[name] for name in CHECK_NAMES}
    ok = all(check["ok"] for check in checks.values())
    result = {
        "assetNumber": contract.number,
        "assetId": f"A_{contract.id3}_{contract.stem.upper()}",
        "stem": contract.stem,
        "sourcePath": contract.source_relative,
        "canonicalGlbPath": contract.canonical_relative,
        "runtimeGlbPath": contract.runtime_relative,
        "importedRepresentation": "canonicalGlb",
        "ok": ok,
        "checks": checks,
    }
    if dependency_failure is not None:
        result["importFailure"] = dependency_failure
    return result, snapshots


def _exterior_registration_check(snapshots: Mapping[int, Mapping[str, Any]]) -> dict[str, Any]:
    issues: list[str] = []
    finished = snapshots.get(51, {})
    damaged = snapshots.get(52, {})
    finished_extras = finished.get("rootExtras", {})
    damaged_extras = damaged.get("rootExtras", {})
    expected_authority = {
        "asset51": {
            "registration_id": REGISTRATION_ID,
            "structural_role": "CANONICAL_STRUCTURAL_AUTHORITY",
            "structural_authority": True,
        },
        "asset52": {
            "registration_id": REGISTRATION_ID,
            "structural_role": "ADDITIVE_DAMAGE_VISUALS",
            "structural_authority": False,
            "additive_damage_only": True,
            "owns_navigation_collision": False,
            "canonical_structure_asset": 51,
            "structural_collision": False,
        },
    }
    for key, expected in expected_authority["asset51"].items():
        if finished_extras.get(key) != expected:
            issues.append(f"Asset 51 {key} is {finished_extras.get(key)!r}, expected {expected!r}")
    for key, expected in expected_authority["asset52"].items():
        if damaged_extras.get(key) != expected:
            issues.append(f"Asset 52 {key} is {damaged_extras.get(key)!r}, expected {expected!r}")

    finished_manifest = finished_extras.get("registration_manifest_json")
    damaged_manifest = damaged_extras.get("registration_manifest_json")
    finished_manifest_sha = finished_extras.get("registration_manifest_sha256")
    damaged_manifest_sha = damaged_extras.get("registration_manifest_sha256")
    if not isinstance(finished_manifest, str) or finished_manifest != damaged_manifest:
        issues.append("Assets 51/52 registration_manifest_json values are absent or different")
    computed_sha = (
        hashlib.sha256(finished_manifest.encode("utf-8")).hexdigest()
        if isinstance(finished_manifest, str) else None
    )
    if computed_sha != finished_manifest_sha or computed_sha != damaged_manifest_sha:
        issues.append("Assets 51/52 registration manifest SHA-256 signatures are invalid or different")
    try:
        manifest_payload = json.loads(finished_manifest) if isinstance(finished_manifest, str) else {}
    except json.JSONDecodeError:
        manifest_payload = {}
        issues.append("registration_manifest_json is not valid JSON")
    if sorted(manifest_payload) != sorted(EXTERIOR_MARKERS):
        issues.append(
            f"registration manifest markers are {sorted(manifest_payload)}, expected {sorted(EXTERIOR_MARKERS)}"
        )

    finished_markers = finished.get("markers", {})
    damaged_markers = damaged.get("markers", {})
    aligned = []
    for marker_name in EXTERIOR_MARKERS:
        left = finished_markers.get(marker_name)
        right = damaged_markers.get(marker_name)
        if left is None or right is None:
            issues.append(f"Assets 51/52 are missing shared registration marker {marker_name}")
            continue
        local_aligned = _matrix_near(left["localMatrix"], right["localMatrix"])
        world_aligned = _matrix_near(left["worldMatrix"], right["worldMatrix"])
        if not local_aligned or not world_aligned:
            issues.append(f"Assets 51/52 {marker_name} matrices are not aligned")
        manifest_entry = manifest_payload.get(marker_name, {})
        expected_location = manifest_entry.get("location_m")
        if not isinstance(expected_location, list) or len(expected_location) != 3:
            issues.append(f"registration manifest lacks a valid location_m for {marker_name}")
        elif any(not _nearly(a, b) for a, b in zip(left["locationMeters"], expected_location)):
            issues.append(f"Asset 51 {marker_name} does not match its manifest location")
        aligned.append({
            "name": marker_name,
            "localMatrixAligned": local_aligned,
            "worldMatrixAligned": world_aligned,
            "locationMeters": left["locationMeters"],
        })
    return _check(
        not issues,
        issues,
        registrationId=REGISTRATION_ID,
        registrationManifestSha256=computed_sha,
        expectedAuthority=expected_authority,
        sharedMarkerCount=len(aligned),
        sharedMarkers=aligned,
        matrixTolerance=MATRIX_TOLERANCE,
    )


def _porch_alignment_check(snapshots: Mapping[int, Mapping[str, Any]]) -> dict[str, Any]:
    issues: list[str] = []
    shell_porch = snapshots.get(51, {}).get("markers", {}).get("SOCKET_Porch")
    porch_entrance = snapshots.get(54, {}).get("markers", {}).get("SOCKET_MainEntrance")
    residual = None
    composed = None
    if shell_porch is None:
        issues.append("Asset 51 SOCKET_Porch snapshot is missing")
    if porch_entrance is None:
        issues.append("Asset 54 SOCKET_MainEntrance snapshot is missing")
    if shell_porch is not None and porch_entrance is not None:
        expected_local = [0.0, 0.0, FLOOR_Z]
        actual_local = porch_entrance["locationMeters"]
        if any(not _nearly(a, b, 1.0e-6) for a, b in zip(actual_local, expected_local)):
            issues.append(
                f"Asset 54 entrance datum is {actual_local}, expected {expected_local} metres"
            )
        shell_matrix = Matrix([
            shell_porch["worldMatrix"][row * 4:(row + 1) * 4] for row in range(4)
        ])
        porch_local_matrix = Matrix([
            porch_entrance["localMatrix"][row * 4:(row + 1) * 4] for row in range(4)
        ])
        shell_translation = shell_matrix.to_translation()
        mount_translation = Vector((shell_translation.x, shell_translation.y, 0.0))
        mount_matrix = Matrix.Translation(mount_translation)
        composed_matrix = mount_matrix @ porch_local_matrix
        composed = _matrix(composed_matrix)
        residual = _vector(composed_matrix.to_translation() - shell_translation)
        if not _matrix_near(composed, shell_porch["worldMatrix"]):
            issues.append(
                "Mounting Asset 54 at Asset 51 SOCKET_Porch horizontal datum does not align "
                "its revised SOCKET_MainEntrance to the shared finished-floor socket"
            )
    return _check(
        not issues,
        issues,
        asset51Socket="SOCKET_Porch",
        asset54Socket="SOCKET_MainEntrance",
        expectedAsset54LocalLocationMeters=[0.0, 0.0, FLOOR_Z],
        composedWorldMatrix=composed,
        translationResidualMeters=residual,
        matrixTolerance=MATRIX_TOLERANCE,
        alignmentContract=(
            "Translate Asset54 root to Asset51 SOCKET_Porch X/Y at grade; Asset54 local FLOOR_Z "
            "then exactly supplies the shared finished-floor Z datum"
        ),
    )


def _markdown(report: Mapping[str, Any]) -> str:
    status = "PASS" if report["ok"] else "FAIL"
    lines = [
        "# Sheet 06 Clean-Blender Reimport Verification",
        "",
        f"Overall: **{status}**",
        "",
        f"- Report schema: `{report['reportKind']}@{report['schemaVersion']}`",
        f"- Blender: `{report['blenderVersion']}`",
        "- Method: each canonical GLB was imported after an empty factory reset; runtime SHA was checked independently.",
        f"- Assets passed: {report['summary']['passedAssets']}/10",
        f"- Mandatory checks passed: {report['summary']['passedChecks']}/{report['summary']['totalChecks']}",
        "",
        "## Asset results",
        "",
        "| Asset | Canonical clean import | SHA identity | Dimensions/ground | Materials/UVs | Special contract | Result |",
        "| ---: | :---: | :---: | :---: | :---: | :---: | :---: |",
    ]
    for asset in report["assets"]:
        checks = asset["checks"]
        mark = lambda value: "PASS" if value else "FAIL"
        lines.append(
            f"| {asset['assetNumber']} | {mark(checks['cleanSceneImport']['ok'])} | "
            f"{mark(checks['artifactIntegrity']['ok'])} | "
            f"{mark(checks['metricDimensionsAndGroundContact']['ok'])} | "
            f"{mark(checks['materialsAndUvs']['ok'])} | "
            f"{mark(checks['assetSpecific']['ok'])} | {mark(asset['ok'])} |"
        )
    lines.extend([
        "",
        "## Cross-asset contracts",
        "",
    ])
    for name, check in report["crossAssetChecks"].items():
        lines.append(f"- `{name}`: **{'PASS' if check['ok'] else 'FAIL'}**")
        for issue in check["issues"]:
            lines.append(f"  - {issue}")
    failures = []
    for asset in report["assets"]:
        for check_name, check in asset["checks"].items():
            for issue in check["issues"]:
                failures.append(f"Asset {asset['assetNumber']} `{check_name}`: {issue}")
    for name, check in report["crossAssetChecks"].items():
        failures.extend(f"Cross-asset `{name}`: {issue}" for issue in check["issues"])
    lines.extend(["", "## Failures", ""])
    if failures:
        lines.extend(f"- {failure}" for failure in failures)
    else:
        lines.append("- None.")
    lines.append("")
    return "\n".join(lines)


def build_report() -> dict[str, Any]:
    assets = []
    snapshots: dict[int, Mapping[str, Any]] = {}
    for contract in CONTRACTS:
        result, snapshot = _verify_asset(contract)
        assets.append(result)
        snapshots[contract.number] = snapshot
    cross_asset_checks = {
        "exteriorRegistrationAndAuthority": _exterior_registration_check(snapshots),
        "asset54MainEntranceToAsset51PorchAlignment": _porch_alignment_check(snapshots),
    }
    passed_checks = sum(
        1 for asset in assets for check in asset["checks"].values() if check["ok"]
    )
    total_checks = len(assets) * len(CHECK_NAMES)
    passed_assets = sum(1 for asset in assets if asset["ok"])
    overall = (
        passed_assets == len(CONTRACTS)
        and passed_checks == total_checks
        and all(check["ok"] for check in cross_asset_checks.values())
    )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "reportKind": REPORT_KIND,
        "blenderVersion": bpy.app.version_string,
        "blenderVersionTuple": list(bpy.app.version),
        "requiredCheckNames": list(CHECK_NAMES),
        "assetRange": [51, 60],
        "units": "meters",
        "assets": assets,
        "crossAssetChecks": cross_asset_checks,
        "summary": {
            "assetCount": len(assets),
            "passedAssets": passed_assets,
            "failedAssets": len(assets) - passed_assets,
            "totalChecks": total_checks,
            "passedChecks": passed_checks,
            "failedChecks": total_checks - passed_checks,
            "crossAssetCheckCount": len(cross_asset_checks),
            "passedCrossAssetChecks": sum(1 for check in cross_asset_checks.values() if check["ok"]),
        },
        "ok": overall,
    }


def main() -> int:
    report = build_report()
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_JSON.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    REPORT_MD.write_text(_markdown(report), encoding="utf-8")
    print(
        "SHEET06_CLEAN_REIMPORT|"
        + json.dumps({
            "ok": report["ok"],
            "passedAssets": report["summary"]["passedAssets"],
            "failedChecks": report["summary"]["failedChecks"],
            "json": REPORT_JSON.relative_to(REPO_ROOT).as_posix(),
            "markdown": REPORT_MD.relative_to(REPO_ROOT).as_posix(),
        }, sort_keys=True)
    )
    return 0 if report["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
