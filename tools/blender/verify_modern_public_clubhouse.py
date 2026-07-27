"""Clean-room verification for the exported modern public clubhouse GLB.

Run with Blender so the verifier exercises the artifact consumed by the game,
not the authoring .blend file::

    blender --background --factory-startup \
      --python tools/blender/verify_modern_public_clubhouse.py

The JSON report is deterministic apart from Blender's importer metadata and is
written beside the other modern-clubhouse QA evidence.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


REPO_ROOT = Path(__file__).resolve().parents[2]
GLB_PATH = REPO_ROOT / "vendor" / "models" / "clubhouse" / "modern_public_clubhouse_v1.glb"
REPORT_PATH = REPO_ROOT / "qa" / "clubhouse-modern" / "blender" / "modern_public_clubhouse_v1_reimport.json"
FLOOR_Z = 0.27432
OFFICE_DOOR_X = 8.9 * 0.9144
OFFICE_DOOR_Y = -2.0 * 0.9144
OFFICE_DOOR_WIDTH = 1.3 * 0.9144
OFFICE_DOOR_HEIGHT = 2.5 * 0.9144
RESTROOM_EAST_X = 6.90
RESTROOM_SOUTH_Y = 3.25
RESTROOM_NORTH_Y = 5.25
RESTROOM_FIXTURE_Y = 4.93

DOORS = (
    {
        "slug": "Interior_EmployeeRoom",
        "center": (5.35, -3.70),
        "width": 0.92,
        "height": 2.12,
        "rotation_z": math.pi / 2.0,
    },
    {
        "slug": "Interior_Storage",
        "center": (5.35, 0.20),
        "width": 0.92,
        "height": 2.12,
        "rotation_z": math.pi / 2.0,
    },
    {
        "slug": "Interior_Irrigation",
        "center": (5.35, 4.18),
        "width": 0.92,
        "height": 2.12,
        "rotation_z": math.pi / 2.0,
    },
    {
        "slug": "RearServiceDoor",
        "center": (9.63, 3.29184),
        "width": 1.28,
        "height": 2.52,
        "rotation_z": math.pi / 2.0,
    },
)


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def close(actual: float, expected: float, tolerance: float, label: str) -> None:
    if abs(actual - expected) > tolerance:
        raise AssertionError(f"{label}: expected {expected:.5f}, got {actual:.5f}")


def world_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    minimum = Vector(tuple(min(point[axis] for point in corners) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in corners) for axis in range(3)))
    return minimum, maximum


def rounded(values, digits: int = 5) -> list[float]:
    return [round(float(value), digits) for value in values]


def verify_door(spec: dict[str, object]) -> dict[str, object]:
    slug = str(spec["slug"])
    pivot = bpy.data.objects.get(f"PIVOT_{slug}")
    leaf = bpy.data.objects.get(f"MESH_{slug}_Leaf")
    lever = bpy.data.objects.get(f"MESH_{slug}_Lever")
    socket = bpy.data.objects.get(f"SOCKET_{slug}_Interaction")
    if not all((pivot, leaf, lever, socket)):
        present = {
            "pivot": bool(pivot),
            "leaf": bool(leaf),
            "lever": bool(lever),
            "socket": bool(socket),
        }
        raise AssertionError(f"{slug} hierarchy incomplete: {present}")
    if leaf.parent != pivot or lever.parent != pivot or socket.parent != pivot:
        raise AssertionError(f"{slug} moving parts must remain direct pivot children")

    bpy.context.view_layer.update()
    minimum, maximum = world_bounds(leaf)
    dimensions = maximum - minimum
    center_x, center_y = (float(value) for value in spec["center"])
    width = float(spec["width"])
    height = float(spec["height"])
    rotation_z = float(spec["rotation_z"])
    expected_hinge = (
        center_x - math.cos(rotation_z) * width / 2.0,
        center_y - math.sin(rotation_z) * width / 2.0,
        FLOOR_Z,
    )

    close(dimensions.x, 0.055, 0.008, f"{slug} world X thickness")
    close(dimensions.y, width, 0.008, f"{slug} world Y width")
    close(dimensions.z, height, 0.008, f"{slug} world Z height")
    for axis, (actual, expected) in enumerate(zip(pivot.matrix_world.translation, expected_hinge)):
        close(actual, expected, 0.006, f"{slug} hinge axis {axis}")
    for axis, (actual, expected) in enumerate(zip(socket.matrix_world.translation, (center_x, center_y, FLOOR_Z + 1.02))):
        close(actual, expected, 0.006, f"{slug} interaction socket axis {axis}")
    for axis, value in enumerate(leaf.scale):
        close(value, 1.0, 0.0001, f"{slug} applied leaf scale axis {axis}")

    return {
        "slug": slug,
        "pivot": pivot.name,
        "pivotWorld": rounded(pivot.matrix_world.translation),
        "leaf": leaf.name,
        "leafWorldBounds": {
            "min": rounded(minimum),
            "max": rounded(maximum),
            "dimensions": rounded(dimensions),
        },
        "lever": lever.name,
        "interactionSocket": socket.name,
        "socketWorld": rounded(socket.matrix_world.translation),
        "directPivotChildren": sorted(child.name for child in pivot.children),
    }


def verify_office_aperture() -> dict[str, object]:
    west = bpy.data.objects.get("MESH_Partition_ServiceCross_0_West")
    east = bpy.data.objects.get("MESH_Partition_ServiceCross_0_East")
    header = bpy.data.objects.get("MESH_Partition_ServiceCross_0_Header")
    if not all((west, east, header)):
        raise AssertionError("office doorway aperture segments are incomplete")
    west_min, west_max = world_bounds(west)
    east_min, east_max = world_bounds(east)
    header_min, header_max = world_bounds(header)
    opening_left = OFFICE_DOOR_X - OFFICE_DOOR_WIDTH / 2.0
    opening_right = OFFICE_DOOR_X + OFFICE_DOOR_WIDTH / 2.0
    close(west_max.x, opening_left, 0.006, "office aperture west jamb")
    close(east_min.x, opening_right, 0.006, "office aperture east jamb")
    close(header_min.z, FLOOR_Z + OFFICE_DOOR_HEIGHT, 0.006, "office aperture header")
    close((west_min.y + west_max.y) / 2.0, OFFICE_DOOR_Y, 0.006, "office aperture wall plane")
    return {
        "center": rounded((OFFICE_DOOR_X, OFFICE_DOOR_Y, FLOOR_Z + OFFICE_DOOR_HEIGHT / 2.0)),
        "clearWidth": round(OFFICE_DOOR_WIDTH, 5),
        "clearHeight": round(OFFICE_DOOR_HEIGHT, 5),
        "westJambX": round(west_max.x, 5),
        "eastJambX": round(east_min.x, 5),
        "headerBottomZ": round(header_min.z, 5),
    }


def verify_room_apertures() -> list[dict[str, object]]:
    if bpy.data.objects.get("MESH_Partition_ServiceSpine") is not None:
        raise AssertionError("legacy solid service spine still blocks the room doors")
    structural = [
        obj for obj in bpy.data.objects
        if obj.type == "MESH"
        and obj.name.startswith((
            "MESH_Partition_ServiceSpine_Segment",
            "MESH_Partition_ServiceSpine_Header",
        ))
    ]
    if len(structural) != 7:
        raise AssertionError(f"expected seven service-spine aperture pieces, found {len(structural)}")
    reports = []
    for index, spec in enumerate(DOORS[:3]):
        center_y = spec["center"][1]
        blockers = []
        for obj in structural:
            lower, upper = world_bounds(obj)
            if lower.y < center_y < upper.y and lower.z < FLOOR_Z + spec["height"]:
                blockers.append(obj.name)
        if blockers:
            raise AssertionError(f"{spec['slug']} aperture blocked by {blockers}")
        header = bpy.data.objects.get(f"MESH_Partition_ServiceSpine_Header_{index:02d}")
        if header is None:
            raise AssertionError(f"missing service-spine header {index:02d}")
        header_min, _ = world_bounds(header)
        close(header_min.z, FLOOR_Z + 2.18, 0.006, f"{spec['slug']} rough-opening header")
        reports.append({
            "slug": spec["slug"],
            "centerY": round(center_y, 5),
            "clearWidth": 0.98,
            "clearHeight": 2.18,
            "blocked": False,
        })
    return reports


def verify_restroom() -> dict[str, object]:
    required_meshes = [
        "MESH_Restroom_EastWall",
        "MESH_Restroom_SouthWall",
        "MESH_Restroom_NorthWall",
        "MESH_Restroom_TileFloor",
        "MESH_Restroom_ToiletBowl",
        "MESH_Restroom_ToiletTank",
        "MESH_Restroom_BasinTop",
        "MESH_Restroom_Mirror",
    ]
    missing = [name for name in required_meshes if bpy.data.objects.get(name) is None]
    if missing:
        raise AssertionError(f"permanent restroom fitout is incomplete: {missing}")
    east = bpy.data.objects["MESH_Restroom_EastWall"]
    south = bpy.data.objects["MESH_Restroom_SouthWall"]
    north = bpy.data.objects["MESH_Restroom_NorthWall"]
    east_min, east_max = world_bounds(east)
    south_min, south_max = world_bounds(south)
    north_min, north_max = world_bounds(north)
    close((east_min.x + east_max.x) / 2.0, RESTROOM_EAST_X, 0.006, "restroom east wall X")
    close((south_min.y + south_max.y) / 2.0, RESTROOM_SOUTH_Y, 0.006, "restroom south wall Y")
    close((north_min.y + north_max.y) / 2.0, RESTROOM_NORTH_Y, 0.006, "restroom north wall Y")
    if south_max.x < east_max.x - 0.01 or north_max.x < east_max.x - 0.01:
        raise AssertionError("restroom cross-walls do not close against the east wall")

    collision_names = [
        "COL_RestroomEastWall",
        "COL_RestroomSouthWall",
        "COL_RestroomNorthWall",
        "COL_RestroomToilet",
        "COL_RestroomSink",
    ]
    missing_collision = [name for name in collision_names if bpy.data.objects.get(name) is None]
    if missing_collision:
        raise AssertionError(f"restroom collision proxies are incomplete: {missing_collision}")
    for name in ("COL_RestroomToilet", "COL_RestroomSink"):
        fixture_min, fixture_max = world_bounds(bpy.data.objects[name])
        close(
            (fixture_min.y + fixture_max.y) / 2.0,
            RESTROOM_FIXTURE_Y,
            0.006,
            f"{name} clear-lane Y",
        )
    return {
        "complete": True,
        "enclosureMeters": {
            "eastWallX": RESTROOM_EAST_X,
            "southWallY": RESTROOM_SOUTH_Y,
            "northWallY": RESTROOM_NORTH_Y,
        },
        "fixtures": ["toilet", "hand-basin", "mirror", "light"],
        "collisionProxies": collision_names,
    }


def main() -> None:
    if not GLB_PATH.is_file():
        raise FileNotFoundError(GLB_PATH)
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(GLB_PATH))
    bpy.context.view_layer.update()

    door_reports = [verify_door(spec) for spec in DOORS]
    mesh_count = sum(1 for obj in bpy.data.objects if obj.type == "MESH")
    collision_count = sum(1 for obj in bpy.data.objects if obj.name.startswith("COL_"))
    office_aperture = verify_office_aperture()
    room_apertures = verify_room_apertures()
    restroom = verify_restroom()
    porch_closure_nodes = ["Porch_Soffit", "Porch_RearGableInfill"]
    missing_porch_closure = [
        name for name in porch_closure_nodes if bpy.data.objects.get(f"MESH_{name}") is None
    ]
    if missing_porch_closure:
        raise AssertionError(f"Missing finished porch closure geometry: {missing_porch_closure}")
    report = {
        "schemaVersion": 1,
        "source": GLB_PATH.relative_to(REPO_ROOT).as_posix(),
        "sha256": hashlib.sha256(GLB_PATH.read_bytes()).hexdigest(),
        "bytes": GLB_PATH.stat().st_size,
        "cleanFactoryReimport": True,
        "objectCount": len(bpy.data.objects),
        "meshCount": mesh_count,
        "collisionProxyCount": collision_count,
        "verifiedDoorCount": len(door_reports),
        "doors": door_reports,
        "officeDoorAperture": office_aperture,
        "roomDoorApertures": room_apertures,
        "permanentRestroom": restroom,
        "porchRoofClosure": {
            "complete": True,
            "nodes": porch_closure_nodes,
        },
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
