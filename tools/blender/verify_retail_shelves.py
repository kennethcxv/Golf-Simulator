"""Re-import and validate the five authored retail shelving assets.

Run with Blender 5.x:
  blender --background --factory-startup --python tools/blender/verify_retail_shelves.py

The checks intentionally exercise the exported GLBs, rather than trusting the
source scene: placement metadata, stocking bounds, door pivots/motion, cabinet
storage, lights, multipart collision proxies, material/UV survival, and LOD
silhouette/triangle reduction all have to survive a fresh import.
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
MANIFEST_PATH = REPO / "Assets" / "pro_shop_furniture" / "retail-shelving-manifest.json"
REPORT_PATH = REPO / "qa" / "retail_shelves" / "blender" / "asset-verification.json"
DEFAULT_NAME = re.compile(r"^(Cube|Cylinder|Sphere|Plane|Empty|Point|Spot)(\.\d+)?$")
SHELF_ZONE = re.compile(r"^SHELF_ZONE_(?:\d{2}|BAY\d{2}_LEVEL\d{2})$")
DOOR = re.compile(r"^CabinetDoor_Bay(\d{2})_(Left|Right)$")


def clean_scene() -> None:
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    # Hidden LOD roots are deliberately present in source files, so selection-
    # based deletion is insufficient here as well.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for blocks in (
        bpy.data.meshes, bpy.data.curves, bpy.data.materials,
        bpy.data.images, bpy.data.cameras, bpy.data.lights,
    ):
        for block in list(blocks):
            if block.users == 0:
                blocks.remove(block)


def descendants(root: bpy.types.Object) -> list[bpy.types.Object]:
    result: list[bpy.types.Object] = []
    stack = [root]
    while stack:
        obj = stack.pop()
        result.append(obj)
        stack.extend(obj.children)
    return result


def object_map(root: bpy.types.Object) -> dict[str, bpy.types.Object]:
    return {obj.name: obj for obj in descendants(root)}


def near(value: float, expected: float, tolerance: float = 0.002) -> bool:
    return math.isclose(float(value), float(expected), rel_tol=0.0, abs_tol=tolerance)


def triangles(objects: list[bpy.types.Object]) -> int:
    total = 0
    for obj in objects:
        if obj.type != "MESH" or obj.name.startswith("COLLISION_"):
            continue
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def mesh_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    minimum = Vector((float("inf"),) * 3)
    maximum = Vector((float("-inf"),) * 3)
    found = False
    for obj in objects:
        if obj.type != "MESH":
            continue
        found = True
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                minimum[axis] = min(minimum[axis], world[axis])
                maximum[axis] = max(maximum[axis], world[axis])
    if not found:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    return minimum, maximum


def bounds_size(bounds: tuple[Vector, Vector]) -> Vector:
    return bounds[1] - bounds[0]


def overlap_volume(a: tuple[Vector, Vector], b: tuple[Vector, Vector]) -> float:
    widths = [max(0.0, min(a[1][axis], b[1][axis]) - max(a[0][axis], b[0][axis])) for axis in range(3)]
    return widths[0] * widths[1] * widths[2]


def expected_zone_names(entry: dict) -> list[str]:
    if entry["shelfZones"] == 3:
        return [f"SHELF_ZONE_{index:02d}" for index in range(1, 4)]
    return [
        f"SHELF_ZONE_BAY{bay:02d}_LEVEL{level:02d}"
        for bay in range(1, 4) for level in range(1, 6)
    ]


def validate_general_nodes(entry: dict, objects: dict[str, bpy.types.Object], issues: list[str]) -> dict:
    required = {
        "INTERACTION_POINT", "PLACEMENT_FOOTPRINT", "PLACEMENT_FOOTPRINT_MIN",
        "PLACEMENT_FOOTPRINT_MAX", "FRONT_DIRECTION", "WALL_SNAP_ANCHOR",
        "FLOOR_CONTACT_CENTER",
    }
    missing = sorted(required - objects.keys())
    if missing:
        issues.append(f"missing placement nodes: {missing}")
        return {"placementNodes": len(required) - len(missing)}

    dims = entry["dimensionsM"]
    footprint = objects["PLACEMENT_FOOTPRINT"]
    for key, expected in (("width_m", dims["width"]), ("depth_m", dims["depth"]), ("height_m", dims["height"])):
        if not near(footprint.get(key, -1), expected):
            issues.append(f"PLACEMENT_FOOTPRINT {key} mismatch")
    fp_min = objects["PLACEMENT_FOOTPRINT_MIN"].matrix_world.translation
    fp_max = objects["PLACEMENT_FOOTPRINT_MAX"].matrix_world.translation
    expected_min = (-dims["width"] / 2, -dims["depth"] / 2, 0)
    expected_max = (dims["width"] / 2, dims["depth"] / 2, dims["height"])
    if any(not near(fp_min[i], expected_min[i]) for i in range(3)):
        issues.append(f"footprint minimum {tuple(round(v, 4) for v in fp_min)} is incorrect")
    if any(not near(fp_max[i], expected_max[i]) for i in range(3)):
        issues.append(f"footprint maximum {tuple(round(v, 4) for v in fp_max)} is incorrect")
    interaction = objects["INTERACTION_POINT"].matrix_world.translation
    if interaction.y >= -dims["depth"] / 2 - 0.45 or not 0.72 <= interaction.z <= 1.2:
        issues.append(f"interaction point is not comfortably in front: {tuple(round(v, 3) for v in interaction)}")
    floor = objects["FLOOR_CONTACT_CENTER"].matrix_world.translation
    if floor.length > 0.002:
        issues.append(f"floor contact center is not the root origin: {tuple(floor)}")
    wall = objects["WALL_SNAP_ANCHOR"]
    if bool(wall.get("enabled", False)) != bool(entry["wallSnap"]):
        issues.append("wall-snap enabled metadata mismatch")
    wall_inset = dims["depth"] / 2 - wall.matrix_world.translation.y
    if wall_inset < -0.002 or wall_inset > 0.05:
        issues.append("wall-snap anchor is not aligned to the true back plane")
    if not near(wall.get("wall_gap_m", -1), 0.018):
        issues.append("wall-snap gap metadata mismatch")
    return {"placementNodes": len(required), "wallSnapEnabled": bool(wall.get("enabled", False))}


def validate_shelf_zones(entry: dict, objects: dict[str, bpy.types.Object], issues: list[str]) -> dict:
    actual = sorted(name for name in objects if SHELF_ZONE.match(name))
    expected = expected_zone_names(entry)
    if actual != expected:
        issues.append(f"shelf zone names differ: expected {len(expected)}, found {len(actual)}")
    capacity = 0
    clearances: list[float] = []
    dims = entry["dimensionsM"]
    for name in expected:
        zone = objects.get(name)
        minimum = objects.get(name + "_MIN")
        maximum = objects.get(name + "_MAX")
        if not zone or not minimum or not maximum:
            issues.append(f"{name} is missing center/min/max nodes")
            continue
        center = zone.matrix_world.translation
        lo = minimum.matrix_world.translation
        hi = maximum.matrix_world.translation
        usable_w = float(zone.get("usable_width_m", 0))
        usable_d = float(zone.get("usable_depth_m", 0))
        clearance = float(zone.get("clearance_height_m", 0))
        clearances.append(clearance)
        capacity += int(zone.get("capacity", 0))
        if zone.get("zone_type") != "shelf" or zone.get("facing") != "front:+Z_gltf":
            issues.append(f"{name} is missing stocking type/facing metadata")
        if usable_w < 0.30 or usable_d < 0.20 or clearance < 0.20:
            issues.append(f"{name} has unusable {usable_w:.3f}x{usable_d:.3f}x{clearance:.3f}m bounds")
        if not (near(lo.x, center.x - usable_w / 2) and near(hi.x, center.x + usable_w / 2)):
            issues.append(f"{name} width bounds do not match metadata")
        if not (near(lo.y, center.y - usable_d / 2) and near(hi.y, center.y + usable_d / 2)):
            issues.append(f"{name} depth bounds do not match metadata")
        if not near(lo.z, center.z) or not near(hi.z, center.z + clearance):
            issues.append(f"{name} vertical bounds do not match its shelf surface/clearance")
        if lo.x < -dims["width"] / 2 or hi.x > dims["width"] / 2:
            issues.append(f"{name} exceeds the declared shelf width")
        if lo.y < -dims["depth"] / 2 or hi.y > dims["depth"] / 2:
            issues.append(f"{name} exceeds the declared shelf depth")
        # Representative medium retail box fit.  This validates the authored
        # usable volume without baking any merchandise into the asset.
        if usable_w < 0.22 or usable_d < 0.20 or clearance < 0.20:
            issues.append(f"{name} cannot fit the 0.22x0.20x0.20m validation package")
    if capacity != entry["shelfCapacity"]:
        issues.append(f"shelf capacity {capacity} != manifest {entry['shelfCapacity']}")
    return {
        "shelfZones": len(actual), "shelfCapacity": capacity,
        "minimumClearanceM": round(min(clearances), 4) if clearances else 0,
    }


def validate_storage_lights(entry: dict, objects: dict[str, bpy.types.Object], issues: list[str]) -> dict:
    storage = sorted(
        (obj for name, obj in objects.items() if name.startswith("STORAGE_ZONE_")),
        key=lambda obj: obj.name,
    )
    lights = sorted(
        (obj for name, obj in objects.items() if name.startswith("LIGHT_")),
        key=lambda obj: obj.name,
    )
    if len(storage) != entry["storageZones"]:
        issues.append(f"storage zones {len(storage)} != manifest {entry['storageZones']}")
    if len(lights) != entry["lightNodes"]:
        issues.append(f"light nodes {len(lights)} != manifest {entry['lightNodes']}")
    storage_capacity = sum(int(zone.get("capacity", 0)) for zone in storage)
    if storage_capacity != int(entry.get("storageCapacity", storage_capacity)):
        issues.append(
            f"storage capacity {storage_capacity} != manifest {entry.get('storageCapacity')}"
        )
    for zone in storage:
        if zone.get("zone_type") != "cabinet_storage" or int(zone.get("capacity", 0)) < 1:
            issues.append(f"{zone.name} has invalid storage metadata")
        if min(float(zone.get("usable_width_m", 0)), float(zone.get("usable_depth_m", 0)), float(zone.get("clearance_height_m", 0))) <= 0.10:
            issues.append(f"{zone.name} has unusable cabinet bounds")
    for node in lights:
        if not node.get("light_type") or int(node.get("color_kelvin", 0)) not in range(2600, 3601):
            issues.append(f"{node.name} has invalid warm-light metadata")
    control = objects.get("INTERACT_ShelfLights")
    if lights and (
        not control
        or control.get("interaction") != "toggle_integrated_lighting"
        or control.get("interactionType") != "light-power"
    ):
        issues.append("integrated lights are missing their authored power interaction node")
    if not lights and control:
        issues.append("unlit shelf unexpectedly exports a light-power interaction node")
    return {
        "storageZones": len(storage),
        "storageCapacity": storage_capacity,
        "lightNodes": len(lights),
        "lightControl": control.name if control else None,
    }


def validate_doors(entry: dict, objects: dict[str, bpy.types.Object], issues: list[str]) -> dict:
    doors = sorted((obj for name, obj in objects.items() if DOOR.match(name)), key=lambda item: item.name)
    expected_names = [
        f"CabinetDoor_Bay{bay:02d}_{side}"
        for bay in range(1, 4) for side in ("Left", "Right")
    ] if entry["cabinetDoors"] else []
    if [door.name for door in doors] != expected_names:
        issues.append(f"cabinet doors differ: {[door.name for door in doors]}")
    motions: list[dict] = []
    for door in doors:
        match = DOOR.match(door.name)
        side = match.group(2)
        local_x = [corner[0] for corner in door.bound_box]
        if side == "Left" and (abs(min(local_x)) > 0.012 or max(local_x) < 0.20):
            issues.append(f"{door.name} origin is not on its left hinge edge")
        if side == "Right" and (abs(max(local_x)) > 0.012 or min(local_x) > -0.20):
            issues.append(f"{door.name} origin is not on its right hinge edge")
        expected_open = -96.0 if side == "Left" else 96.0
        if door.get("moving_part") != "cabinet_door" or door.get("movement_axis") != "local_z":
            issues.append(f"{door.name} has invalid moving-part metadata")
        if not near(door.get("open_degrees", 0), expected_open, 0.01):
            issues.append(f"{door.name} open angle/direction is incorrect")
        interact = objects.get("INTERACT_" + door.name)
        if not interact or interact.parent != door or interact.get("door_name") != door.name:
            issues.append(f"{door.name} interaction node is missing or not parented to the door")
        elif (
            abs(interact.location.y + 0.10) > 0.012
            or not 0.02 <= interact.location.z <= 0.08
            or (side == "Left" and interact.location.x < 0.20)
            or (side == "Right" and interact.location.x > -0.20)
            or interact.matrix_world.translation.z < 0.20
        ):
            issues.append(
                f"{door.name} interaction node is not at its hinge-local handle: "
                f"local={tuple(round(value, 3) for value in interact.location)} "
                f"world={tuple(round(value, 3) for value in interact.matrix_world.translation)}"
            )

    # Exercise all doors at the required positions, then return them closed.
    for fraction in (0.0, 0.25, 0.50, 1.0, 0.50, 0.25, 0.0):
        for door in doors:
            door.rotation_euler.z = math.radians(float(door.get("open_degrees", 0)) * fraction)
        bpy.context.view_layer.update()
        step_bounds = {door.name: mesh_bounds(descendants(door)) for door in doors}
        for door in doors:
            if step_bounds[door.name][0].z < -0.003:
                issues.append(f"{door.name} clips the floor at {fraction:.0%} open")
        for bay in range(1, 4):
            left = f"CabinetDoor_Bay{bay:02d}_Left"
            right = f"CabinetDoor_Bay{bay:02d}_Right"
            if left in step_bounds and right in step_bounds and overlap_volume(step_bounds[left], step_bounds[right]) > 1e-5:
                issues.append(f"bay {bay} doors overlap at {fraction:.0%} open")
        motions.append({"fraction": fraction, "minimumDoorZ": round(min((value[0].z for value in step_bounds.values()), default=0), 4)})
    for door in doors:
        if abs(door.rotation_euler.z) > 1e-6:
            issues.append(f"{door.name} did not return closed")
    return {"cabinetDoors": len(doors), "doorMotionSteps": motions}


def validate_meshes(root: bpy.types.Object, issues: list[str], *, source: bool) -> dict:
    all_objects = descendants(root)
    meshes = [obj for obj in all_objects if obj.type == "MESH"]
    visible = [obj for obj in meshes if not obj.name.startswith("COLLISION_")]
    defaults = [obj.name for obj in all_objects if DEFAULT_NAME.match(obj.name)]
    temp = [obj.name for obj in all_objects if obj.name.startswith(("TEST_", "PREVIEW_"))]
    missing_materials = [obj.name for obj in visible if not obj.data.materials]
    missing_uvs = [
        obj.name for obj in visible if not obj.data.uv_layers
        and not obj.name.startswith("Basic_WireShelf_")
    ]
    unapplied = [obj.name for obj in meshes if any(not near(value, 1.0, 0.001) for value in obj.scale)]
    non_manifold: dict[str, int] = {}
    degenerate: dict[str, int] = {}
    if source:
        for obj in meshes:
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bad_edges = sum(1 for edge in bm.edges if not edge.is_manifold)
            bad_faces = sum(1 for face in bm.faces if face.calc_area() <= 1e-10)
            bm.free()
            if bad_edges:
                non_manifold[obj.name] = bad_edges
            if bad_faces:
                degenerate[obj.name] = bad_faces
    if defaults:
        issues.append(f"default object names remain: {defaults[:8]}")
    if temp:
        issues.append(f"temporary preview merchandise/studio objects remain: {temp[:8]}")
    if missing_materials:
        issues.append(f"visible meshes without materials: {missing_materials[:8]}")
    if missing_uvs:
        issues.append(f"visible meshes without UVs: {missing_uvs[:8]}")
    if unapplied:
        issues.append(f"unapplied mesh scales: {unapplied[:8]}")
    if non_manifold:
        issues.append(f"non-manifold meshes: {dict(list(non_manifold.items())[:8])}")
    if degenerate:
        issues.append(f"zero-area meshes: {dict(list(degenerate.items())[:8])}")
    return {
        "meshCount": len(meshes), "visibleMeshCount": len(visible),
        "materialCount": len({material.name for obj in visible for material in obj.data.materials if material}),
        "missingUVs": len(missing_uvs), "nonManifoldMeshes": len(non_manifold),
    }


def validate_collision(entry: dict, objects: dict[str, bpy.types.Object], issues: list[str]) -> dict:
    colliders = [obj for name, obj in objects.items() if name.startswith("COLLISION_") and obj.type == "MESH"]
    if len(colliders) != entry["collisionMeshes"]:
        issues.append(f"collision meshes {len(colliders)} != manifest {entry['collisionMeshes']}")
    for collider in colliders:
        if not collider.get("collision_proxy") or collider.get("collision_shape") != "box":
            issues.append(f"{collider.name} lacks collision-proxy metadata")
    dims = entry["dimensionsM"]
    blockers = [
        obj.name for obj in colliders
        if obj.dimensions.x > dims["width"] * 0.85
        and obj.dimensions.y > dims["depth"] * 0.35
        and obj.dimensions.z > dims["height"] * 0.65
    ]
    if blockers:
        issues.append(f"oversized full-opening collision boxes: {blockers}")
    return {"collisionMeshes": len(colliders), "fullOpeningBlockers": blockers}


def validate_source(entry: dict) -> dict:
    bpy.ops.wm.open_mainfile(filepath=str(REPO / entry["source"]), load_ui=False)
    root = bpy.data.objects.get(entry["assetName"])
    issues: list[str] = []
    if not root:
        return {"path": entry["source"], "issues": ["missing source root"]}
    objects = object_map(root)
    if root.location.length > 0.001 or any(abs(value) > 0.001 for value in root.rotation_euler):
        issues.append("source root is not at the floor-footprint origin")
    lod_triangles = {}
    for lod in ("LOD0", "LOD1", "LOD2"):
        node = objects.get(lod)
        if not node:
            issues.append(f"missing source {lod}")
            continue
        lod_triangles[lod] = triangles(descendants(node))
        if lod_triangles[lod] != entry["triangleCounts"][lod]:
            issues.append(f"source {lod} triangles {lod_triangles[lod]} != manifest {entry['triangleCounts'][lod]}")
    if len(lod_triangles) == 3 and not (lod_triangles["LOD0"] > lod_triangles["LOD1"] > lod_triangles["LOD2"]):
        issues.append(f"source LOD triangles do not descend: {lod_triangles}")
    mesh_report = validate_meshes(root, issues, source=True)
    missing_textures = []
    for image in bpy.data.images:
        if image.source == "FILE" and not Path(bpy.path.abspath(image.filepath)).exists():
            missing_textures.append(image.filepath)
    if missing_textures:
        issues.append(f"source textures are missing: {missing_textures[:6]}")
    return {
        "path": entry["source"], "lodTriangles": lod_triangles,
        "texturesResolved": not missing_textures, **mesh_report, "issues": issues,
    }


def validate_lod_glb(entry: dict, lod: str, main_bounds: tuple[Vector, Vector]) -> dict:
    clean_scene()
    path = REPO / entry["lodGlbs"][lod]
    bpy.ops.import_scene.gltf(filepath=str(path))
    root = bpy.data.objects.get(lod)
    issues: list[str] = []
    if not root:
        return {"path": entry["lodGlbs"][lod], "issues": [f"missing imported {lod} root"]}
    objects = descendants(root)
    count = triangles(objects)
    if count != entry["triangleCounts"][lod]:
        issues.append(f"{lod} triangles {count} != manifest {entry['triangleCounts'][lod]}")
    current_bounds = mesh_bounds(objects)
    main_size = bounds_size(main_bounds)
    current_size = bounds_size(current_bounds)
    for axis, label in ((0, "width"), (1, "depth"), (2, "height")):
        ratio = current_size[axis] / max(main_size[axis], 1e-6)
        if not 0.88 <= ratio <= 1.12:
            issues.append(f"{lod} {label} silhouette ratio {ratio:.3f} is outside tolerance")
    if current_bounds[0].z < -0.003:
        issues.append(f"{lod} extends below the floor")
    return {
        "path": entry["lodGlbs"][lod], "triangles": count,
        "boundsM": [round(value, 4) for value in current_size], "issues": issues,
    }


def validate_main_glb(entry: dict) -> tuple[dict, tuple[Vector, Vector]]:
    clean_scene()
    path = REPO / entry["glb"]
    bpy.ops.import_scene.gltf(filepath=str(path))
    root = bpy.data.objects.get(entry["assetName"])
    issues: list[str] = []
    if not root:
        return {"path": entry["glb"], "issues": ["missing imported asset root"]}, (Vector(), Vector())
    objects = object_map(root)
    if "LOD0" not in objects:
        issues.append("main GLB is missing LOD0")
        lod_objects = descendants(root)
    else:
        lod_objects = descendants(objects["LOD0"])
    bundled_lod_triangles = {}
    for lod in ("LOD0", "LOD1", "LOD2"):
        lod_root = objects.get(lod)
        if not lod_root:
            issues.append(f"main GLB is missing bundled {lod}")
            continue
        bundled_lod_triangles[lod] = triangles(descendants(lod_root))
        if bundled_lod_triangles[lod] != entry["triangleCounts"][lod]:
            issues.append(
                f"bundled {lod} triangles {bundled_lod_triangles[lod]} "
                f"!= manifest {entry['triangleCounts'][lod]}"
            )
    count = triangles(lod_objects)
    if count != entry["triangleCounts"]["LOD0"]:
        issues.append(f"main triangles {count} != manifest {entry['triangleCounts']['LOD0']}")
    main_bounds = mesh_bounds([obj for obj in lod_objects if not obj.name.startswith("COLLISION_")])
    dims = entry["dimensionsM"]
    if main_bounds[0].z < -0.003 or main_bounds[0].z > 0.02:
        issues.append(f"LOD0 floor contact is {main_bounds[0].z:.4f}m")
    size = bounds_size(main_bounds)
    if size.x > dims["width"] + 0.025 or size.y > dims["depth"] + 0.025 or size.z > dims["height"] + 0.025:
        issues.append(f"visible bounds {tuple(round(v, 3) for v in size)} exceed declared dimensions")
    root_dims = list(root.get("dimensions_m", []))
    expected_root_dims = [dims["width"], dims["height"], dims["depth"]]
    if len(root_dims) != 3 or any(not near(root_dims[index], expected_root_dims[index]) for index in range(3)):
        issues.append(f"root dimensions metadata {root_dims} != {expected_root_dims}")
    reports = {
        **validate_meshes(root, issues, source=False),
        **validate_general_nodes(entry, objects, issues),
        **validate_shelf_zones(entry, objects, issues),
        **validate_storage_lights(entry, objects, issues),
        **validate_doors(entry, objects, issues),
        **validate_collision(entry, objects, issues),
    }
    return {
        "path": entry["glb"], "triangles": count, "bundledLodTriangles": bundled_lod_triangles,
        "boundsM": [round(value, 4) for value in size], **reports, "issues": issues,
    }, main_bounds


def validate_asset(entry: dict) -> dict:
    source = validate_source(entry)
    main, main_bounds = validate_main_glb(entry)
    lod1 = validate_lod_glb(entry, "LOD1", main_bounds)
    lod2 = validate_lod_glb(entry, "LOD2", main_bounds)
    issues = [
        f"source: {issue}" for issue in source["issues"]
    ] + [
        f"main: {issue}" for issue in main["issues"]
    ] + [
        f"LOD1: {issue}" for issue in lod1["issues"]
    ] + [
        f"LOD2: {issue}" for issue in lod2["issues"]
    ]
    return {
        "id": entry["id"], "assetName": entry["assetName"],
        "dimensionsM": entry["dimensionsM"], "source": source,
        "main": main, "lod1": lod1, "lod2": lod2, "issues": issues,
    }


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text("utf-8"))
    records = [validate_asset(entry) for entry in manifest["assets"]]
    failures = [record for record in records if record["issues"]]
    report = {
        "schemaVersion": 1, "blenderVersion": bpy.app.version_string,
        "assetCount": len(records), "passed": len(records) - len(failures),
        "failed": len(failures), "assets": records,
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", "utf-8")
    print(json.dumps({
        "assetCount": report["assetCount"], "passed": report["passed"],
        "failed": report["failed"], "report": str(REPORT_PATH),
    }))
    if failures:
        summary = "; ".join(f"{record['id']}: {record['issues'][:3]}" for record in failures)
        raise RuntimeError(f"Retail shelf validation failed: {summary}")


if __name__ == "__main__":
    main()
