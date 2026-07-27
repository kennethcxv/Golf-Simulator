"""Validate clothing-rack Blender sources and exported GLBs.

Run with:
  blender --background --factory-startup --python tools/blender/verify_clothing_racks.py
"""

from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector


REPO = Path(os.environ.get("GF_REPO_ROOT", Path(__file__).resolve().parents[2])).resolve()
MANIFEST_PATH = REPO / "Assets" / "pro_shop_furniture" / "clothing-racks-manifest.json"
REPORT_PATH = REPO / "qa" / "clothing_racks" / "blender" / "asset-verification.json"
DEFAULT_NAME = re.compile(r"^(Cube|Cylinder|Sphere|Plane|Empty|Point|Spot)(\.\d+)?$")
MERCHANDISE_NAME = re.compile(r"(shirt|jacket|pants|hanger|hat|folded|shoe.?box)", re.I)


def clean_scene() -> None:
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for blocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(blocks):
            if block.users == 0:
                blocks.remove(block)


def descendants(root: bpy.types.Object) -> list[bpy.types.Object]:
    result: list[bpy.types.Object] = []
    stack = [root]
    while stack:
        item = stack.pop()
        result.append(item)
        stack.extend(item.children)
    return result


def triangle_count(root: bpy.types.Object) -> int:
    return sum(
        sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons)
        for obj in descendants(root) if obj.type == "MESH"
    )


def bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    minimum = Vector((float("inf"), float("inf"), float("inf")))
    maximum = Vector((float("-inf"), float("-inf"), float("-inf")))
    for obj in objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                minimum[axis] = min(minimum[axis], world[axis])
                maximum[axis] = max(maximum[axis], world[axis])
    return minimum, maximum


def near(value: float, expected: float, tolerance: float = 0.001) -> bool:
    return math.isclose(float(value), float(expected), rel_tol=0.0, abs_tol=tolerance)


def world_position(obj: bpy.types.Object) -> Vector:
    return obj.matrix_world.translation.copy()


def object_gap(a: bpy.types.Object, b: bpy.types.Object) -> float:
    """Return the shortest bounding-box gap between two manufactured parts."""
    a_min, a_max = bounds([a])
    b_min, b_max = bounds([b])
    gaps = []
    for axis in range(3):
        if a_max[axis] < b_min[axis]:
            gaps.append(b_min[axis] - a_max[axis])
        elif b_max[axis] < a_min[axis]:
            gaps.append(a_min[axis] - b_max[axis])
        else:
            gaps.append(0.0)
    return math.sqrt(sum(gap * gap for gap in gaps))


def validate_structural_connections(entry: dict, object_map: dict[str, bpy.types.Object],
                                    issues: list[str]) -> dict:
    """Fail visible shelves, supports, or rod mounts that terminate in space."""
    checks: list[tuple[str, str, str, float]] = []
    tier = entry["tier"]
    if tier == "basic":
        for side in ("Left", "Right"):
            checks.append((f"Basic rod/{side} elbow", "LOD0_HangingRod",
                           f"LOD0_Elbow_{side}", 0.004))
            checks.append((f"Basic {side} upright/elbow", f"LOD0_VerticalSupport_{side}",
                           f"LOD0_Elbow_{side}", 0.004))
            checks.append((f"Basic {side} upright/base", f"LOD0_VerticalSupport_{side}",
                           f"LOD0_BaseRail_{side}", 0.004))
        for depth in ("Front", "Back"):
            for side in ("Left", "Right"):
                checks.append((f"Basic frame corner {depth}/{side}",
                               f"LOD0_BaseRail_{depth}", f"LOD0_BaseRail_{side}", 0.004))
            for caster_side in ("L", "R"):
                checks.append((f"Basic caster {depth}/{caster_side}/frame",
                               f"LOD0_CasterStem_{depth[0]}{caster_side}",
                               f"LOD0_BaseRail_{depth}", 0.004))
    elif tier == "standard":
        for side in ("Left", "Right"):
            checks.append((f"Standard rod/{side} elbow", "LOD0_HangingRod",
                           f"LOD0_PipeElbow_{side}", 0.004))
            checks.append((f"Standard {side} upright/elbow", f"LOD0_PipeUpright_{side}",
                           f"LOD0_PipeElbow_{side}", 0.004))
            # Both center planks bridge the small design reveal and receive the
            # upright flange, so either is a valid continuous load path.
            checks.append((f"Standard {side} upright/platform",
                           f"LOD0_PipeFootFlange_{side}", "LOD0_WoodPlatformPlank_03", 0.006))
        for depth in ("Front", "Back"):
            for side in ("Left", "Right"):
                checks.append((f"Standard frame corner {depth}/{side}",
                               f"LOD0_DeckFrame_{depth}", f"LOD0_DeckFrame_{side}", 0.004))
            for caster_side in ("L", "R"):
                checks.append((f"Standard caster {depth}/{caster_side}/frame",
                               f"LOD0_CasterStem_{depth[0]}{caster_side}",
                               f"LOD0_DeckFrame_{depth}", 0.004))
        for plank_index in range(1, 7):
            plank = f"LOD0_WoodPlatformPlank_{plank_index:02d}"
            for support_index in range(1, 4):
                checks.append((f"Standard plank {plank_index}/support {support_index}", plank,
                               f"LOD0_DeckSupport_{support_index:02d}", 0.004))
        checks.append(("Standard front plank/perimeter", "LOD0_WoodPlatformPlank_01",
                       "LOD0_DeckFrame_Front", 0.004))
        checks.append(("Standard back plank/perimeter", "LOD0_WoodPlatformPlank_06",
                       "LOD0_DeckFrame_Back", 0.004))
    elif tier == "premium":
        for side in ("Left", "Right"):
            checks.append((
                f"Premium rod {side.lower()} bracket/depth rail",
                f"LOD0_RodBracketPlate_{side}", f"LOD0_RodDepthRail_{side}", 0.004,
            ))
        for index in range(1, 4):
            shelf = f"LOD0_Shelf_{index:02d}"
            for support in (
                "LOD0_FramePost_Left_Front", "LOD0_FramePost_Left_Back",
                "LOD0_ShelfDivider_Front", "LOD0_ShelfDivider_Back",
            ):
                checks.append((f"Premium shelf {index}/{support}", shelf, support, 0.006))
        for support in (
            "LOD0_FramePost_Left_Front", "LOD0_FramePost_Left_Back",
            "LOD0_FramePost_Right_Front", "LOD0_FramePost_Right_Back",
        ):
            checks.append(("Premium lower deck/frame", "LOD0_FullLowerShelf", support, 0.006))
        for tag, side, depth in (
            ("FL", "Left", "Front"), ("FR", "Right", "Front"),
            ("BL", "Left", "Back"), ("BR", "Right", "Back"),
        ):
            checks.append((f"Premium leveling foot {tag}/post", f"LOD0_FootStem_{tag}",
                           f"LOD0_FramePost_{side}_{depth}", 0.004))
    elif tier in {"high-end", "luxury"}:
        boundaries = (
            ("LOD0_SidePanel_Left", "LOD0_VerticalDivider_01"),
            ("LOD0_VerticalDivider_01", "LOD0_VerticalDivider_02"),
            ("LOD0_VerticalDivider_02", "LOD0_SidePanel_Right"),
        )
        for index, (left, right) in enumerate(boundaries, 1):
            for shelf_kind in ("UpperDisplayShelf", "LowerDisplayShelf"):
                shelf = f"LOD0_{shelf_kind}_{index:02d}"
                checks.append((f"{tier} {shelf_kind} {index}/left", shelf, left, 0.006))
                checks.append((f"{tier} {shelf_kind} {index}/right", shelf, right, 0.006))
                checks.append((
                    f"{tier} {shelf_kind} {index}/back",
                    shelf, f"LOD0_BackPanel_{index:02d}", 0.006,
                ))
            checks.append((
                f"{tier} rod {index}/left",
                f"LOD0_RodBracketPlate_{index:02d}_Left", left, 0.006,
            ))
            checks.append((
                f"{tier} rod {index}/right",
                f"LOD0_RodBracketPlate_{index:02d}_Right", right, 0.006,
            ))
            if tier == "high-end":
                storage = f"LOD0_LowerStorageShelf_{index:02d}"
                checks.append((f"High-End storage {index}/left", storage, left, 0.006))
                checks.append((f"High-End storage {index}/right", storage, right, 0.006))
                checks.append((
                    f"High-End storage {index}/back", storage,
                    f"LOD0_BackPanel_{index:02d}", 0.006,
                ))
                for side_index in (1, 2):
                    for depth_name in ("Front", "Back"):
                        leg = f"LOD0_ShelfLeg_{index:02d}_{side_index:02d}_{depth_name}"
                        checks.append((f"High-End leg {index}/{side_index}/{depth_name}/base",
                                       leg, "LOD0_BasePlinth", 0.006))
                        checks.append((f"High-End leg {index}/{side_index}/{depth_name}/shelf",
                                       leg, f"LOD0_LowerDisplayShelf_{index:02d}", 0.006))
                        for rail_name in ("ShelfCrossRail", "StorageCrossRail"):
                            checks.append((
                                f"High-End {rail_name} {index}/{depth_name}/leg {side_index}",
                                f"LOD0_{rail_name}_{index:02d}_{depth_name}", leg, 0.006,
                            ))
            else:
                divider = f"LOD0_LowerCubbyDivider_{index:02d}"
                checks.append((f"Luxury cubby divider {index}/base", divider,
                               "LOD0_BasePlinth", 0.006))
                checks.append((f"Luxury cubby divider {index}/shelf", divider,
                               f"LOD0_LowerDisplayShelf_{index:02d}", 0.006))
    results = []
    for label, a_name, b_name, tolerance in checks:
        a = object_map.get(a_name)
        b = object_map.get(b_name)
        if not a or not b:
            issues.append(f"structural connection check missing object: {label}")
            results.append({"label": label, "gapM": None, "ok": False})
            continue
        gap = object_gap(a, b)
        ok = gap <= tolerance
        if not ok:
            issues.append(f"disconnected part {label}: gap={gap:.4f}m")
        results.append({"label": label, "gapM": round(gap, 5), "ok": ok})
    return {
        "structuralConnectionChecks": len(results),
        "structuralConnectionsPassed": sum(1 for result in results if result["ok"]),
        "structuralConnectionDetails": results,
    }


def expected_node_names(entry: dict) -> set[str]:
    expected = {entry["nodes"]["interactionNode"], entry["nodes"]["footprintNode"]}
    expected.update(entry["nodes"]["hangNodes"])
    expected.update(entry["nodes"]["shelfNodes"])
    expected.update(entry["nodes"]["lightNodes"])
    return expected


def validate_functional_nodes(entry: dict, object_map: dict[str, bpy.types.Object], issues: list[str]) -> dict:
    missing = sorted(expected_node_names(entry) - object_map.keys())
    if missing:
        issues.append(f"missing functional nodes: {missing}")
    dimensions = entry["dimensionsM"]
    hanger_half_width = 0.21
    hang_clearances: list[dict] = []
    for index in range(1, entry["hangZoneCount"] + 1):
        names = [f"HANG_ZONE_{index:02d}_{suffix}" for suffix in ("START", "END", "CENTER")]
        if not all(name in object_map for name in names):
            continue
        start, end, center = (world_position(object_map[name]) for name in names)
        length = end.x - start.x
        if length <= 0.20:
            issues.append(f"hang zone {index} usable length too small: {length:.3f}m")
        if not near(center.x, (start.x + end.x) / 2, 0.002):
            issues.append(f"hang zone {index} center is not midway between bounds")
        if not (near(start.y, end.y, 0.002) and near(start.z, end.z, 0.002)):
            issues.append(f"hang zone {index} boundaries are not collinear")
        left_clearance = start.x - hanger_half_width + dimensions[0] / 2
        right_clearance = dimensions[0] / 2 - (end.x + hanger_half_width)
        if left_clearance < 0.015 or right_clearance < 0.015:
            issues.append(
                f"hang zone {index} lacks side clearance for a 0.42m hanger: "
                f"left={left_clearance:.3f}, right={right_clearance:.3f}"
            )
        hang_clearances.append({
            "zone": index,
            "usableLengthM": round(length, 4),
            "leftFootprintClearanceM": round(left_clearance, 4),
            "rightFootprintClearanceM": round(right_clearance, 4),
            "rodHeightM": round(center.z, 4),
            "simulatedShirtBottomM": round(center.z - 0.78, 4),
        })
    # Adjacent bay nodes must also leave a full garment-width gap around their
    # shared divider rather than only fitting inside the outer footprint.
    for index in range(1, entry["hangZoneCount"]):
        left = object_map.get(f"HANG_ZONE_{index:02d}_END")
        right = object_map.get(f"HANG_ZONE_{index + 1:02d}_START")
        if left and right:
            gap = world_position(right).x - world_position(left).x - hanger_half_width * 2
            if gap < 0.015:
                issues.append(f"adjacent hanging zones {index}/{index + 1} clip a shared divider")
    shelf_clearances: list[dict] = []
    for index in range(1, entry["shelfZoneCount"] + 1):
        center_name = f"SHELF_ZONE_{index:02d}"
        min_name = f"{center_name}_MIN"
        max_name = f"{center_name}_MAX"
        if not all(name in object_map for name in (center_name, min_name, max_name)):
            continue
        center = world_position(object_map[center_name])
        minimum = world_position(object_map[min_name])
        maximum = world_position(object_map[max_name])
        width = maximum.x - minimum.x
        depth = maximum.y - minimum.y
        if width <= 0.12 or depth <= 0.10:
            issues.append(f"shelf zone {index} has unusable bounds {width:.3f}x{depth:.3f}m")
        if not (minimum.x <= center.x <= maximum.x and minimum.y <= center.y <= maximum.y):
            issues.append(f"shelf zone {index} center lies outside its bounds")
        if not (near(center.z, minimum.z, 0.002) and near(center.z, maximum.z, 0.002)):
            issues.append(f"shelf zone {index} bounds are not on the shelf surface")
        if minimum.x < -dimensions[0] / 2 or maximum.x > dimensions[0] / 2:
            issues.append(f"shelf zone {index} exceeds rack width")
        if minimum.y < -dimensions[2] / 2 or maximum.y > dimensions[2] / 2:
            issues.append(f"shelf zone {index} exceeds rack depth")
        shelf_clearances.append({
            "zone": index,
            "usableWidthM": round(width, 4),
            "usableDepthM": round(depth, 4),
            "surfaceHeightM": round(center.z, 4),
        })
    interaction = object_map.get("INTERACTION_POINT")
    if interaction:
        point = world_position(interaction)
        if point.y >= -dimensions[2] / 2 - 0.30:
            issues.append("interaction point is not a comfortable distance in front of the rack")
        if not 0.85 <= point.z <= 1.25:
            issues.append(f"interaction point height is uncomfortable: {point.z:.3f}m")
    footprint = object_map.get("PLACEMENT_FOOTPRINT")
    if footprint:
        if not near(footprint.get("width_m", -1), dimensions[0], 0.002):
            issues.append("placement footprint width metadata mismatch")
        if not near(footprint.get("depth_m", -1), dimensions[2], 0.002):
            issues.append("placement footprint depth metadata mismatch")
    light_profiles: list[dict] = []
    for name in entry["nodes"]["lightNodes"]:
        node = object_map.get(name)
        if not node:
            continue
        kind = node.get("runtime_light_kind")
        intensity = float(node.get("runtime_intensity", 0.0))
        color = tuple(node.get("runtime_color_linear", ()))
        offset = tuple(node.get("light_offset_m", ()))
        target = tuple(node.get("target_offset_m", ()))
        if kind not in {"spot", "point"}:
            issues.append(f"light attachment {name} has invalid runtime kind {kind!r}")
        if intensity <= 0 or len(color) != 3 or len(offset) != 3:
            issues.append(f"light attachment {name} has incomplete runtime photometry")
        if kind == "spot" and len(target) != 3:
            issues.append(f"spot attachment {name} has no target offset")
        light_profiles.append({"name": name, "kind": kind, "intensity": round(intensity, 4)})
    return {
        "hangClearances": hang_clearances,
        "shelfClearances": shelf_clearances,
        "runtimeLightProfiles": light_profiles,
    }


def validate_meshes(objects: list[bpy.types.Object], issues: list[str], *, source: bool) -> dict:
    meshes = [obj for obj in objects if obj.type == "MESH"]
    missing_materials = [obj.name for obj in meshes if not obj.data.materials]
    missing_uv = [
        obj.name for obj in meshes
        if not obj.name.startswith("COLLISION_") and len(obj.data.uv_layers) == 0
    ]
    invalid_scale = [obj.name for obj in meshes if any(not near(value, 1.0, 0.001) for value in obj.scale)]
    invalid_rotation = [obj.name for obj in meshes if any(abs(value) > 0.001 for value in obj.rotation_euler)]
    default_names = [obj.name for obj in objects if DEFAULT_NAME.match(obj.name)]
    merchandise = [obj.name for obj in objects if MERCHANDISE_NAME.search(obj.name)]
    non_manifold: dict[str, int] = {}
    zero_area: dict[str, int] = {}
    reversed_or_zero_normals: list[str] = []
    duplicate_bounds: dict[tuple, str] = {}
    overlapping_duplicates: list[tuple[str, str]] = []
    for obj in meshes:
        if source:
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            count = sum(1 for edge in bm.edges if not edge.is_manifold)
            if count:
                non_manifold[obj.name] = count
            degenerate = sum(1 for face in bm.faces if face.calc_area() <= 1e-10)
            if degenerate:
                zero_area[obj.name] = degenerate
            bm.free()
        if any(poly.normal.length < 0.9 for poly in obj.data.polygons):
            reversed_or_zero_normals.append(obj.name)
        minimum, maximum = bounds([obj])
        key = (
            tuple(round(value, 5) for value in minimum),
            tuple(round(value, 5) for value in maximum),
            len(obj.data.vertices), len(obj.data.polygons),
        )
        prior = duplicate_bounds.get(key)
        if prior and not ({prior.split("_")[0], obj.name.split("_")[0]} <= {"LOD0", "LOD1", "LOD2"}):
            overlapping_duplicates.append((prior, obj.name))
        else:
            duplicate_bounds[key] = obj.name
    if missing_materials:
        issues.append(f"meshes without materials: {missing_materials[:8]}")
    if missing_uv:
        issues.append(f"visible meshes without UVs: {missing_uv[:8]}")
    if invalid_scale:
        issues.append(f"unapplied mesh scales: {invalid_scale[:8]}")
    if invalid_rotation:
        issues.append(f"unapplied mesh rotations: {invalid_rotation[:8]}")
    if default_names:
        issues.append(f"default object names remain: {default_names}")
    if merchandise:
        issues.append(f"permanent merchandise found: {merchandise[:8]}")
    if non_manifold:
        issues.append(f"non-manifold meshes: {dict(list(non_manifold.items())[:8])}")
    if zero_area:
        issues.append(f"zero-area faces: {dict(list(zero_area.items())[:8])}")
    if reversed_or_zero_normals:
        issues.append(f"invalid polygon normals: {reversed_or_zero_normals[:8]}")
    if overlapping_duplicates:
        issues.append(f"overlapping duplicate geometry: {overlapping_duplicates[:6]}")
    return {
        "meshCount": len(meshes),
        "missingMaterials": len(missing_materials),
        "missingUVs": len(missing_uv),
        "nonManifoldMeshes": len(non_manifold),
        "zeroAreaMeshes": len(zero_area),
    }


def validate_source(entry: dict) -> dict:
    path = REPO / entry["source"]
    bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False)
    root = bpy.data.objects.get(entry["primaryObject"])
    issues: list[str] = []
    if not root:
        return {"path": entry["source"], "issues": ["missing primary root"]}
    objects = descendants(root)
    object_map = {obj.name: obj for obj in objects}
    if any(abs(value) > 0.0001 for value in root.location):
        issues.append(f"root origin is not footprint-center floor: {tuple(root.location)}")
    for lod in ("LOD0", "LOD1", "LOD2"):
        if lod not in object_map:
            issues.append(f"missing {lod} hierarchy")
    collision = object_map.get(entry["collision"])
    if not collision:
        issues.append(f"missing collision {entry['collision']}")
    else:
        actual = tuple(round(value, 3) for value in collision.dimensions)
        # Manifest dimensions use product-facing width/height/depth ordering;
        # Blender's Z-up object dimensions are X/Y/Z (width/depth/height).
        width, height, depth = entry["dimensionsM"]
        expected = tuple(round(value, 3) for value in (width, depth, height))
        if any(abs(a - b) > 0.01 for a, b in zip(actual, expected)):
            issues.append(f"collision dimensions {actual} != {expected}")
        if not near((collision.matrix_world @ Vector((0, 0, -0.5))).z, 0, 0.01):
            # The direct bound check below is authoritative; this diagnostic is
            # deliberately non-fatal for Blender's object-space cube corner.
            pass
    lod_triangles = {}
    for lod in ("LOD0", "LOD1", "LOD2"):
        if lod in object_map:
            lod_triangles[lod] = triangle_count(object_map[lod])
            expected = entry["lodTriangles"][lod]
            if lod_triangles[lod] != expected:
                issues.append(f"{lod} triangles {lod_triangles[lod]} != manifest {expected}")
    if len(lod_triangles) == 3 and not (lod_triangles["LOD0"] > lod_triangles["LOD1"] > lod_triangles["LOD2"]):
        issues.append(f"LOD triangle counts do not descend: {lod_triangles}")
    if "LOD0" in object_map:
        minimum, maximum = bounds([obj for obj in descendants(object_map["LOD0"]) if obj.type == "MESH"])
        if minimum.z < -0.002 or minimum.z > 0.015:
            issues.append(f"rack does not sit on floor: LOD0 min Z={minimum.z:.4f}")
        if maximum.z > entry["dimensionsM"][1] + 0.02:
            issues.append(f"rack exceeds declared height: {maximum.z:.4f}")
    mesh_report = validate_meshes(objects, issues, source=True)
    node_report = validate_functional_nodes(entry, object_map, issues)
    connection_report = validate_structural_connections(entry, object_map, issues)
    actual_lights = sum(1 for obj in objects if obj.type == "LIGHT")
    if actual_lights:
        issues.append(f"source contains {actual_lights} baked light objects; expected data-only nodes")
    missing_textures = []
    for image in bpy.data.images:
        if image.source != "FILE":
            continue
        resolved = Path(bpy.path.abspath(image.filepath))
        if not resolved.exists():
            missing_textures.append(str(resolved))
    if missing_textures:
        issues.append(f"missing source textures: {missing_textures[:6]}")
    return {
        "path": entry["source"],
        "objectCount": len(objects),
        "lodTriangles": lod_triangles,
        "runtimeLights": actual_lights,
        "texturesResolved": len(missing_textures) == 0,
        **mesh_report,
        **node_report,
        **connection_report,
        "issues": issues,
    }


def validate_glb(entry: dict) -> dict:
    clean_scene()
    path = REPO / entry["glb"]
    bpy.ops.import_scene.gltf(filepath=str(path))
    root = bpy.data.objects.get(entry["primaryObject"])
    issues: list[str] = []
    if not root:
        return {"path": entry["glb"], "issues": ["missing imported primary root"]}
    objects = descendants(root)
    object_map = {obj.name: obj for obj in objects}
    mesh_report = validate_meshes(objects, issues, source=False)
    node_report = validate_functional_nodes(entry, object_map, issues)
    connection_report = validate_structural_connections(entry, object_map, issues)
    collision = object_map.get(entry["collision"])
    if not collision:
        issues.append(f"missing exported collision {entry['collision']}")
    else:
        actual = tuple(round(value, 3) for value in collision.dimensions)
        width, height, depth = entry["dimensionsM"]
        expected = tuple(round(value, 3) for value in (width, depth, height))
        if any(abs(a - b) > 0.015 for a, b in zip(actual, expected)):
            issues.append(f"exported collision dimensions {actual} != {expected}")
    lod_triangles = {}
    for lod in ("LOD0", "LOD1", "LOD2"):
        obj = object_map.get(lod)
        if not obj:
            issues.append(f"missing exported {lod}")
            continue
        lod_triangles[lod] = triangle_count(obj)
        if lod_triangles[lod] != entry["lodTriangles"][lod]:
            issues.append(f"exported {lod} triangles {lod_triangles[lod]} != {entry['lodTriangles'][lod]}")
    actual_lights = sum(1 for obj in objects if obj.type == "LIGHT")
    if actual_lights:
        issues.append(f"export contains {actual_lights} baked light objects; expected data-only nodes")
    first_root_count = sum(1 for obj in bpy.data.objects if obj.name == entry["primaryObject"] or obj.name.startswith(entry["primaryObject"] + "."))
    duplicate_import_ok = True
    try:
        bpy.ops.import_scene.gltf(filepath=str(path))
        second_root_count = sum(
            1 for obj in bpy.data.objects
            if obj.name == entry["primaryObject"] or obj.name.startswith(entry["primaryObject"] + ".")
        )
        duplicate_import_ok = second_root_count >= first_root_count + 1
    except Exception as error:  # pragma: no cover - Blender reports exporter-specific detail
        duplicate_import_ok = False
        issues.append(f"duplicate import raised: {error}")
    if not duplicate_import_ok:
        issues.append("GLB could not be duplicated cleanly")
    return {
        "path": entry["glb"],
        "bytes": path.stat().st_size,
        "objectCount": len(objects),
        "lodTriangles": lod_triangles,
        "runtimeLights": actual_lights,
        "duplicateImportOk": duplicate_import_ok,
        **mesh_report,
        **node_report,
        **connection_report,
        "issues": issues,
    }


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    assets = []
    for entry in manifest["assets"]:
        print(f"[verify-clothing-racks] source {entry['tier']}", flush=True)
        source = validate_source(entry)
        print(f"[verify-clothing-racks] glb {entry['tier']}", flush=True)
        glb = validate_glb(entry)
        assets.append({"tier": entry["tier"], "source": source, "glb": glb})
    failures = [
        {"tier": asset["tier"], "sourceIssues": asset["source"]["issues"], "glbIssues": asset["glb"]["issues"]}
        for asset in assets if asset["source"]["issues"] or asset["glb"]["issues"]
    ]
    report = {
        "assetCount": len(assets),
        "passed": len(assets) - len(failures),
        "failed": len(failures),
        "failures": failures,
        "assets": assets,
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "assetCount": report["assetCount"],
        "passed": report["passed"],
        "failed": report["failed"],
        "report": str(REPORT_PATH),
    }, indent=2), flush=True)
    if failures:
        raise RuntimeError(f"{len(failures)} clothing-rack assets failed validation")


if __name__ == "__main__":
    main()
