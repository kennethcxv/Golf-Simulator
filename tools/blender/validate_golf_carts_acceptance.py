"""Render and structurally validate the exported Golf Flipper cart fleet.

This is a read-only acceptance pass over the production GLBs. QA cameras,
lights, seated proxies, and bag proxies are created only in the temporary
Blender scene and are never exported back into the game asset pipeline.

Run from the repository root:

  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
      --factory-startup --python tools/blender/validate_golf_carts_acceptance.py
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_golf_carts import (  # noqa: E402
    EXPORT_DIR,
    ROOT,
    SPECS,
    set_lod_render,
    set_scene_contract,
)
from golf_cart_lib import (  # noqa: E402
    beam,
    box,
    descendants,
    look_at,
    material,
    mesh_bounds,
    reset_scene,
    setup_studio,
    triangle_count,
)


OUTPUT_DIR = ROOT / "qa" / "golf-carts" / "blender" / "acceptance"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
RESOLUTION = (800, 600)


def world_location(obj: bpy.types.Object) -> Vector:
    return obj.matrix_world.translation.copy()


def topology_metrics(meshes: list[bpy.types.Object]) -> dict:
    boundary_edges = 0
    non_manifold_edges = 0
    loose_vertices = 0
    zero_area_faces = 0
    meshes_without_uv = []
    meshes_without_material = []
    non_unit_mesh_scales = []
    zero_area_faces_by_mesh = {}
    minimum_positive_face_area = None
    for obj in meshes:
        if not obj.data.uv_layers:
            meshes_without_uv.append(obj.name)
        if not obj.material_slots:
            meshes_without_material.append(obj.name)
        if max(abs(component - 1.0) for component in obj.scale) > 0.0001:
            non_unit_mesh_scales.append(obj.name)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        loose_vertices += sum(1 for vertex in bm.verts if not vertex.link_edges)
        face_areas = [face.calc_area() for face in bm.faces]
        object_zero_area = sum(1 for area in face_areas if area <= 1e-10)
        zero_area_faces += object_zero_area
        if object_zero_area:
            zero_area_faces_by_mesh[obj.name] = object_zero_area
        positive_areas = [area for area in face_areas if area > 1e-10]
        if positive_areas:
            object_minimum = min(positive_areas)
            minimum_positive_face_area = object_minimum if minimum_positive_face_area is None else min(minimum_positive_face_area, object_minimum)
        for edge in bm.edges:
            if len(edge.link_faces) == 1:
                boundary_edges += 1
            elif not edge.is_manifold:
                non_manifold_edges += 1
        bm.free()
    return {
        "boundaryEdges": boundary_edges,
        "nonManifoldEdgesExcludingIntentionalBoundaries": non_manifold_edges,
        "looseVertices": loose_vertices,
        "zeroAreaFaces": zero_area_faces,
        "zeroAreaFacesByMesh": dict(sorted(zero_area_faces_by_mesh.items())),
        "minimumPositiveFaceAreaM2": minimum_positive_face_area,
        "meshesWithoutUv": sorted(meshes_without_uv),
        "meshesWithoutMaterial": sorted(meshes_without_material),
        "nonUnitMeshScales": sorted(non_unit_mesh_scales),
    }


def pivot_samples(
    pivot: bpy.types.Object,
    axis_index: int,
    angle_degrees: float,
    fractions: tuple[float, ...],
) -> list[dict]:
    """Exercise an imported pivot without changing the closed acceptance pose."""
    original_basis = pivot.matrix_basis.copy()
    bpy.context.view_layer.update()
    baseline = pivot.matrix_world.copy()
    axis = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))[axis_index]
    samples = []
    for fraction in fractions:
        local_rotation = Matrix.Rotation(
            math.radians(angle_degrees) * fraction,
            4,
            axis,
        )
        pivot.matrix_basis = original_basis @ local_rotation
        bpy.context.view_layer.update()
        delta = max(
            abs(float(pivot.matrix_world[row][column] - baseline[row][column]))
            for row in range(4)
            for column in range(4)
        )
        samples.append({
            "fraction": fraction,
            "angleDegrees": round(angle_degrees * fraction, 3),
            "matrixDeltaFromClosed": round(delta, 7),
        })
    pivot.matrix_basis = original_basis
    bpy.context.view_layer.update()
    return samples


def structural_report(spec, root: bpy.types.Object) -> dict:
    config_path = EXPORT_DIR / "config" / f"golf_cart_{spec.slug}.json"
    config = json.loads(config_path.read_text(encoding="utf8"))
    objects = descendants(root)
    names = {obj.name for obj in objects}
    meshes = [obj for obj in objects if obj.type == "MESH"]
    render_meshes = [
        obj for obj in meshes
        if int(obj.get("lod_level", 0)) == 0
        and obj.get("collision_proxy") is not True
        and not obj.name.startswith("COL_")
    ]
    minimum, maximum = mesh_bounds(render_meshes)
    dimensions = maximum - minimum
    expected_dimensions = Vector((spec.width, spec.length, spec.height))
    dimension_delta = [round(abs(dimensions[index] - expected_dimensions[index]), 5) for index in range(3)]
    required_nodes = {
        "VehicleRoot",
        "Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR",
        "SteeringPivot_FL", "SteeringPivot_FR", "SteeringWheel",
        "DRIVER_CAMERA_ANCHOR", "VEHICLE_CAMERA_ANCHOR",
        "CHARGE_PORT", "BATTERY_ACCESS_POINT", "BATTERY_COMPARTMENT_ANCHOR", "VEHICLE_FOOTPRINT",
        "PARKING_ANCHOR", "PARKING_CORNER_FL", "PARKING_CORNER_FR", "PARKING_CORNER_RL", "PARKING_CORNER_RR",
        "INTERACT_DriverEntry", "INTERACT_PassengerEntry_Left", "INTERACT_PassengerEntry_Right",
        "INTERACT_BatteryCompartment", "SERVICE_POINT_FRONT", "SERVICE_POINT_REAR", "SERVICE_POINT_BATTERY",
        "CLEANING_TARGET_BODY", "CLEANING_TARGET_WINDSHIELD", "CLEANING_TARGET_SEATS", "CHARGE_CABLE_GUIDE",
        "LIGHT_HEAD_L", "LIGHT_HEAD_R", "LIGHT_TAIL_L", "LIGHT_TAIL_R",
        "LIGHT_BRAKE_L", "LIGHT_BRAKE_R",
        "LIGHT_INDICATOR_FRONT_L", "LIGHT_INDICATOR_FRONT_R",
        "LIGHT_INDICATOR_REAR_L", "LIGHT_INDICATOR_REAR_R",
        "Headlight_L", "Headlight_R", "Taillight_L", "Taillight_R", "BrakeLight_L", "BrakeLight_R",
        "Indicator_FRONT_L", "Indicator_FRONT_R", "Indicator_REAR_L", "Indicator_REAR_R",
        "BatteryCompartment_Lid", "BatteryCompartment_Cavity",
        "COL_Chassis", "COL_FrontBody", "COL_RearBody", "COL_Roof",
        *config["seatAnchors"], *config["entryPoints"], *config["exitPoints"],
        *config["golfBagSlots"], *config["storageZones"], *config["doorNodes"],
    }
    missing = sorted(required_nodes - names)
    topology = topology_metrics(render_meshes)
    lod_triangles = {
        str(level): triangle_count([
            obj for obj in meshes
            if int(obj.get("lod_level", 0)) == level
            and obj.get("collision_proxy") is not True
            and not obj.name.startswith("COL_")
        ])
        for level in (0, 1, 2)
    }
    generic_object_names = sorted(
        name for name in names
        if re.fullmatch(r"(?:Cube|Cylinder|Sphere|Torus|Plane)(?:\.\d+)?", name)
    )
    texture_sources = list(config.get("projectTextureSources", []))
    missing_texture_sources = sorted(
        path for path in texture_sources
        if not (ROOT / path).is_file() or (ROOT / path).stat().st_size <= 128
    )
    embedded_texture_names = sorted(
        image.name for image in bpy.data.images
        if image.name.startswith(f"golf_cart_{spec.slug}_")
    )
    material_names = sorted({slot.material.name for obj in meshes for slot in obj.material_slots if slot.material})
    material_categories = {
        "body": any("BodyPaint" in name for name in material_names),
        "canopy": any("Canopy" in name for name in material_names),
        "upholstery": any(name.endswith("_Seat") for name in material_names),
        "tire": any("TireRubber" in name for name in material_names),
        "frame": any("PowderCoatedFrame" in name for name in material_names),
        "glass": any("WindshieldGlass" in name for name in material_names),
        "headlight": any("HeadlightLens" in name for name in material_names),
        "tail": any("TailLens" in name for name in material_names),
        "indicator": any("IndicatorLens" in name for name in material_names),
    }
    foot_anchors = sorted(name for name in names if name.startswith("FOOT_ANCHOR_"))
    service_points = sorted(name for name in names if name.startswith("SERVICE_POINT_"))
    wheel_pivots = [bpy.data.objects.get(name) for name in ("Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR")]
    steering_pivots = [bpy.data.objects.get(name) for name in ("SteeringPivot_FL", "SteeringPivot_FR")]
    door_pivots = [bpy.data.objects.get(name) for name in config["doorNodes"]]
    range_by_tier = {
        "basic": ((1.10, 1.35), (2.30, 2.50), (1.65, 1.90)),
        "standard": ((1.10, 1.35), (2.40, 2.60), (1.65, 1.95)),
        "premium": ((1.15, 1.45), (2.80, 3.20), (1.70, 2.00)),
        "high_end": ((1.20, 1.45), (2.90, 3.30), (1.70, 2.05)),
        "luxury": ((1.30, 1.65), (3.50, 4.20), (1.75, 2.10)),
    }[spec.slug]
    dimensions_in_reference_range = all(
        low <= float(dimensions[index]) <= high
        for index, (low, high) in enumerate(range_by_tier)
    )
    battery_modules = sorted(name for name in names if name.startswith("BatteryModule_") and not name.endswith("_Terminal"))
    storage_interior_required = spec.rear_layout in {"lithium_storage", "resort_luggage"}
    pivot_motion = {
        "wheels": {
            pivot.name: pivot_samples(pivot, 0, 47.0, (0.0, 1.0))
            for pivot in wheel_pivots if pivot
        },
        "steering": {
            pivot.name: pivot_samples(pivot, 2, 32.0, (-1.0, 0.0, 1.0))
            for pivot in steering_pivots if pivot
        },
        "doors": {
            pivot.name: pivot_samples(pivot, 2, float(pivot.get("open_angle_degrees", 0.0)), (0.0, 0.25, 0.50, 1.0))
            for pivot in door_pivots if pivot
        },
        "serviceHinges": {},
    }
    for hinge_name in ("BatteryCompartment_Lid", "StorageLid_Rear", "Windshield_Upper"):
        hinge = bpy.data.objects.get(hinge_name)
        if not hinge:
            continue
        axis_index = {"local_x": 0, "local_y": 1, "local_z": 2}.get(str(hinge.get("animation_axis", "local_x")), 0)
        pivot_motion["serviceHinges"][hinge_name] = pivot_samples(
            hinge,
            axis_index,
            float(hinge.get("open_angle_degrees", 0.0)),
            (0.0, 0.25, 0.50, 1.0),
        )
    nonzero_motion_samples = [
        sample
        for category in pivot_motion.values()
        for samples in category.values()
        for sample in samples
        if abs(float(sample["fraction"])) > 0.0001
    ]
    checks = {
        "assetIdPreserved": root.get("asset_id") == spec.asset_id,
        "capacityPreserved": int(root.get("passenger_capacity", -1)) == spec.passenger_capacity,
        "requiredNodesPresent": not missing,
        # Catalog dimensions are the nominal chassis envelope; mirrors, bumpers,
        # handles, and door skins intentionally extend beyond it.
        "dimensionsWithinAccessoryAllowance": (
            dimension_delta[0] <= 0.24
            and dimension_delta[1] <= 0.14
            and dimension_delta[2] <= 0.06
        ),
        "fourWheelPivots": all(name in names for name in ("Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR")),
        "twoSteeringPivots": all(name in names for name in ("SteeringPivot_FL", "SteeringPivot_FR")),
        "seatCountMatches": len(config["seatAnchors"]) == spec.passenger_capacity,
        "twoFootAnchorsPerSeat": len(foot_anchors) == spec.passenger_capacity * 2,
        "entryAndExitPerSeat": len(config["entryPoints"]) == spec.passenger_capacity and len(config["exitPoints"]) == spec.passenger_capacity,
        "twoBagSlots": len(config["golfBagSlots"]) == 2,
        "serviceAnchorsPresent": len(service_points) >= 7,
        "wheelPivotMetadata": all(pivot and pivot.get("moving_part") is True and pivot.get("animation_axis") == "local_x" for pivot in wheel_pivots),
        "steeringPivotMetadata": all(pivot and pivot.get("moving_part") is True and pivot.get("animation_axis") == "local_z" for pivot in steering_pivots),
        "luxuryDoorContract": (
            len(door_pivots) == 6
            and all(pivot and pivot.get("moving_part") is True and pivot.get("animation_axis") == "local_z" for pivot in door_pivots)
        ) if spec.luxury_doors else not door_pivots,
        "pivotMotionExercisesPass": bool(nonzero_motion_samples) and all(sample["matrixDeltaFromClosed"] > 0.0001 for sample in nonzero_motion_samples),
        "batteryInteriorPresent": bool(battery_modules) and "BatteryCompartment_Cavity" in names,
        "storageInteriorPresent": ("RearStorageCavity" in names and "StorageLid_Rear" in names) if storage_interior_required else True,
        "collidersPresent": len([name for name in names if name.startswith("COL_")]) >= 6,
        "threeLodsPresent": all(lod_triangles[str(level)] > 0 for level in (0, 1, 2)),
        "lodsReduceMonotonically": lod_triangles["0"] > lod_triangles["1"] > lod_triangles["2"],
        "dimensionsInReferenceRange": dimensions_in_reference_range,
        "groundContactAtOrigin": abs(float(minimum.z)) <= 0.02,
        "rootTransformAtOrigin": root.location.length <= 0.0001,
        "noDegenerateFaces": topology["zeroAreaFaces"] == 0,
        "noLooseVertices": topology["looseVertices"] == 0,
        "noUnexpectedNonManifoldEdges": topology["nonManifoldEdgesExcludingIntentionalBoundaries"] == 0,
        "materialsAssigned": not topology["meshesWithoutMaterial"],
        "uvsAssigned": not topology["meshesWithoutUv"],
        "materialCategoriesPresent": all(material_categories.values()),
        "projectTexturesDeclared": len(texture_sources) == 3,
        "projectTextureFilesPresent": not missing_texture_sources,
        "projectTexturesEmbedded": len(embedded_texture_names) >= 3,
        "noGenericObjectNames": not generic_object_names,
        "qaCamerasExcluded": not any(obj.type == "CAMERA" for obj in objects),
        "qaLightsExcluded": not any(obj.type == "LIGHT" for obj in objects),
    }
    return {
        "assetId": spec.asset_id,
        "sourceGlb": (EXPORT_DIR / f"golf_cart_{spec.slug}.glb").relative_to(ROOT).as_posix(),
        "bytes": (EXPORT_DIR / f"golf_cart_{spec.slug}.glb").stat().st_size,
        "objects": len(objects),
        "meshes": len(meshes),
        "materials": material_names,
        "materialCategories": material_categories,
        "measuredDimensionsM": [round(value, 5) for value in dimensions],
        "targetDimensionsM": [spec.width, spec.length, spec.height],
        "dimensionDeltaM": dimension_delta,
        "lodTriangles": lod_triangles,
        "colliders": sorted(name for name in names if name.startswith("COL_")),
        "seatAnchors": config["seatAnchors"],
        "bagSlots": config["golfBagSlots"],
        "storageZones": config["storageZones"],
        "doorNodes": config["doorNodes"],
        "footAnchors": foot_anchors,
        "servicePoints": service_points,
        "batteryModules": battery_modules,
        "projectTextureSources": texture_sources,
        "missingProjectTextureSources": missing_texture_sources,
        "embeddedTextureNames": embedded_texture_names,
        "genericObjectNames": generic_object_names,
        "pivotMotionSamples": pivot_motion,
        "missingRequiredNodes": missing,
        "topology": topology,
        "checks": checks,
        "passed": all(checks.values()),
    }


def remove_tagged(prefix: str = "QA_Acceptance_") -> None:
    for obj in list(bpy.data.objects):
        if obj.name.startswith(prefix):
            bpy.data.objects.remove(obj, do_unlink=True)


def make_sphere(name: str, location, radius: float, mat) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def make_cylinder(name: str, location, radius: float, depth: float, mat) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def add_bag_proxies(root: bpy.types.Object) -> None:
    bag_mat = material("QA_Acceptance_BagMaterial", "071A0E", 0.68)
    collar_mat = material("QA_Acceptance_BagCollar", "020302", 0.72)
    club_mat = material("QA_Acceptance_ClubMaterial", "454B49", 0.34, 0.72)
    for index, anchor in enumerate(sorted((obj for obj in descendants(root) if obj.name.startswith("GOLF_BAG_SLOT_")), key=lambda obj: obj.name), start=1):
        point = world_location(anchor)
        make_cylinder(f"QA_Acceptance_Bag_{index}", point + Vector((0, 0, 0.29)), 0.12, 0.58, bag_mat)
        make_cylinder(f"QA_Acceptance_BagCollar_{index}", point + Vector((0, 0, 0.57)), 0.13, 0.05, collar_mat)
        for club_index, x_offset in enumerate((-0.05, 0.0, 0.05), start=1):
            make_cylinder(
                f"QA_Acceptance_Club_{index}_{club_index}",
                point + Vector((x_offset, 0, 0.73)),
                0.009,
                0.36,
                club_mat,
            )


def add_seated_proxies(root: bpy.types.Object) -> None:
    shirt = material("QA_Acceptance_SeatProxyShirt", "27432E", 0.82)
    pants = material("QA_Acceptance_SeatProxyPants", "101820", 0.78)
    skin = material("QA_Acceptance_SeatProxySkin", "8B5739", 0.76)
    for index, anchor in enumerate(sorted((obj for obj in descendants(root) if obj.name.startswith("SEAT_ANCHOR_")), key=lambda obj: obj.name), start=1):
        point = world_location(anchor)
        make_cylinder(f"QA_Acceptance_RiderTorso_{index}", point + Vector((0, 0, 0.30)), 0.15, 0.44, shirt)
        make_sphere(f"QA_Acceptance_RiderHead_{index}", point + Vector((0, 0, 0.62)), 0.12, skin)
        suffix = anchor.name.removeprefix("SEAT_ANCHOR_")
        for foot_side, hip_offset in (("L", -0.06), ("R", 0.06)):
            foot = bpy.data.objects.get(f"FOOT_ANCHOR_{foot_side}_{suffix}")
            if foot:
                beam(
                    f"QA_Acceptance_RiderLeg_{index}_{foot_side}",
                    point + Vector((hip_offset, 0.02, 0.05)),
                    world_location(foot) + Vector((0.0, 0.0, 0.04)),
                    0.055,
                    pants,
                    vertices=10,
                )


def enable_light_configuration(root: bpy.types.Object) -> None:
    for mat in bpy.data.materials:
        if mat.name.startswith("M_GF_HeadlightLens"):
            bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
            if bsdf:
                (bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")).default_value = (1.0, 0.83, 0.48, 1.0)
                (bsdf.inputs.get("Emission Strength")).default_value = 5.0
        elif mat.name.startswith("M_GF_TailLens"):
            bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
            if bsdf:
                (bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")).default_value = (1.0, 0.03, 0.01, 1.0)
                (bsdf.inputs.get("Emission Strength")).default_value = 3.0
        elif mat.name.startswith("M_GF_IndicatorLens"):
            bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
            if bsdf:
                (bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")).default_value = (1.0, 0.30, 0.01, 1.0)
                (bsdf.inputs.get("Emission Strength")).default_value = 3.2
    for anchor in (obj for obj in descendants(root) if obj.name.startswith("LIGHT_HEAD_")):
        point = world_location(anchor)
        bpy.ops.object.light_add(type="SPOT", location=point)
        light = bpy.context.object
        light.name = f"QA_Acceptance_{anchor.name}"
        light.data.color = (1.0, 0.82, 0.50)
        light.data.energy = 1500
        light.data.spot_size = math.radians(35)
        light.data.spot_blend = 0.55
        look_at(light, point + Vector((0, 4.5, -0.35)))
    for anchor in (obj for obj in descendants(root) if obj.name.startswith("LIGHT_TAIL_")):
        point = world_location(anchor)
        bpy.ops.object.light_add(type="POINT", location=point)
        light = bpy.context.object
        light.name = f"QA_Acceptance_{anchor.name}"
        light.data.color = (1.0, 0.02, 0.01)
        light.data.energy = 45
    for anchor in (obj for obj in descendants(root) if obj.name.startswith("LIGHT_INDICATOR_")):
        point = world_location(anchor)
        bpy.ops.object.light_add(type="POINT", location=point)
        light = bpy.context.object
        light.name = f"QA_Acceptance_{anchor.name}"
        light.data.color = (1.0, 0.22, 0.01)
        light.data.energy = 24


def render_views(spec, root: bpy.types.Object) -> list[str]:
    set_lod_render(root, 0)
    target = Vector((0.0, 0.0, spec.height * 0.48))
    distance = max(4.6, spec.length * 1.55)
    camera = setup_studio(
        target=target,
        camera_location=(distance * 0.70, distance, spec.height * 1.48),
        resolution=RESOLUTION,
        neutral_hex="5F6863",
    )
    camera.data.lens = 58
    camera.data.clip_start = 0.025
    floor = bpy.data.objects.get("QA_StudioFloor")
    views: list[str] = []

    def render(name: str, location, aim=target, lens=58, *, floor_visible=True, exact_rotation=None) -> None:
        if floor:
            floor.hide_render = not floor_visible
        camera.location = location
        camera.data.lens = lens
        if exact_rotation is None:
            look_at(camera, aim)
        else:
            camera.rotation_euler = exact_rotation
        path = OUTPUT_DIR / f"golf_cart_{spec.slug}_{name}.png"
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        views.append(path.relative_to(ROOT).as_posix())

    render("front", (0, distance, spec.height * 0.95), lens=62)
    render("rear", (0, -distance, spec.height * 0.95), lens=62)
    render("left", (-distance, 0, spec.height * 0.92), lens=62)
    render("right", (distance, 0, spec.height * 0.92), lens=62)
    render("top", (0, 0, distance + spec.height), (0, 0, 0), lens=60, exact_rotation=(0, 0, 0))
    bpy.ops.object.light_add(type="AREA", location=(distance * 0.25, -distance * 0.20, -distance * 0.55))
    underside_fill = bpy.context.object
    underside_fill.name = "QA_Acceptance_UndersideFill"
    underside_fill.data.energy = 1100
    underside_fill.data.shape = "DISK"
    underside_fill.data.size = 3.0
    look_at(underside_fill, (0, 0, 0.34))
    render(
        "underside",
        (distance * 0.72, -distance * 0.58, -distance * 0.36),
        (0, 0, 0.38),
        lens=52,
        floor_visible=False,
    )
    bpy.data.objects.remove(underside_fill, do_unlink=True)

    driver_anchor = bpy.data.objects.get("DRIVER_CAMERA_ANCHOR")
    driver_point = world_location(driver_anchor)
    # Frame the authored dashboard, wheel, hood and road sightline from the
    # driver's eye.  A shallow horizon-only aim can make a structurally valid
    # camera anchor look like an empty studio render, especially on the taller
    # Luxury roofline.
    render(
        "driver_view",
        driver_point + Vector((0.02, -0.10, 0.10)),
        driver_point + Vector((0.0, 2.4, -0.48)),
        lens=34,
    )
    passenger_anchor = bpy.data.objects.get("SEAT_ANCHOR_Seat_Passenger_Front")
    passenger_eye = world_location(passenger_anchor) + Vector((0.0, -0.13, 0.45))
    controls = bpy.data.objects.get("InstrumentDisplay") or bpy.data.objects.get("InstrumentGauge")
    controls_point = world_location(controls)
    render(
        "passenger_view",
        passenger_eye,
        controls_point + Vector((-0.08, 0.08, 0.04)),
        lens=38,
    )

    wheel = bpy.data.objects.get("Wheel_FL")
    wheel_point = world_location(wheel)
    render("wheel_closeup", wheel_point + Vector((-1.28, 0.10, 0.34)), wheel_point, lens=70)
    seat = bpy.data.objects.get("SEAT_ANCHOR_Seat_Driver")
    seat_point = world_location(seat)
    render("seat_closeup", seat_point + Vector((-1.38, 1.16, 0.72)), seat_point + Vector((0, 0, 0.20)), lens=62)
    control_point = controls_point
    render(
        "dashboard_closeup",
        passenger_eye,
        control_point + Vector((0.0, 0.0, 0.03)),
        lens=50,
    )

    storage_lid = bpy.data.objects.get("StorageLid_Rear")
    original_storage_basis = storage_lid.matrix_basis.copy() if storage_lid else None
    if storage_lid:
        axis = {"local_x": 0, "local_y": 1, "local_z": 2}.get(str(storage_lid.get("animation_axis", "local_x")), 0)
        axis_vector = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))[axis]
        storage_lid.matrix_basis = original_storage_basis @ Matrix.Rotation(
            math.radians(float(storage_lid.get("open_angle_degrees", 62))),
            4,
            axis_vector,
        )
        bpy.context.view_layer.update()
    storage = bpy.data.objects.get("RearStorageCavity")
    storage_point = world_location(storage) if storage else Vector((0.0, spec.rear_end_y + 0.18, 0.68))
    render(
        "storage_closeup",
        storage_point + Vector((spec.width * 1.55, -1.35, 1.12)),
        storage_point + Vector((0.0, 0.0, 0.06)),
        lens=54,
    )
    if storage_lid and original_storage_basis:
        storage_lid.matrix_basis = original_storage_basis
        bpy.context.view_layer.update()

    add_bag_proxies(root)
    render("configuration_bags", (distance * 0.72, -distance * 0.90, spec.height * 1.32), (0, spec.rear_end_y + 0.15, 0.92), lens=60)
    remove_tagged()
    add_seated_proxies(root)
    render("configuration_seated", (-distance * 0.78, distance * 0.45, spec.height * 1.25), (0, -0.12, 1.02), lens=55)
    remove_tagged()
    enable_light_configuration(root)
    world = bpy.context.scene.world
    background = world.node_tree.nodes.get("Background") if world and world.use_nodes else None
    if background:
        background.inputs["Color"].default_value = (0.008, 0.012, 0.010, 1.0)
        background.inputs["Strength"].default_value = 0.06
    for studio_light_name in ("QA_Key", "QA_Fill", "QA_Rim"):
        studio_light = bpy.data.objects.get(studio_light_name)
        if studio_light and studio_light.data:
            studio_light.data.energy *= 0.18
    if floor and floor.data and floor.data.materials:
        floor_bsdf = floor.data.materials[0].node_tree.nodes.get("Principled BSDF")
        if floor_bsdf:
            floor_bsdf.inputs["Base Color"].default_value = (0.025, 0.035, 0.030, 1.0)
    render("configuration_lights", (distance * 0.72, distance * 0.92, spec.height * 1.12), (0, spec.front_end_y - 0.20, 0.72), lens=58)
    render("configuration_lights_rear", (-distance * 0.72, -distance * 0.92, spec.height * 1.12), (0, spec.rear_end_y + 0.20, 0.72), lens=58)
    return views


def validate_one(spec) -> dict:
    reset_scene()
    set_scene_contract()
    glb_path = EXPORT_DIR / f"golf_cart_{spec.slug}.glb"
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    root = bpy.data.objects.get(spec.asset_id)
    if root is None:
        raise RuntimeError(f"{spec.asset_id} missing after clean GLB import")
    report = structural_report(spec, root)
    report["views"] = render_views(spec, root)
    print(
        f"GOLF_CART_ACCEPTANCE|{spec.asset_id}|passed={report['passed']}|"
        f"views={len(report['views'])}|lod0={report['lodTriangles']['0']}"
    )
    return report


def main() -> None:
    reports = [validate_one(spec) for spec in SPECS]
    result = {
        "schemaVersion": 1,
        "blenderVersion": bpy.app.version_string,
        "sourcePolicy": "Production GLBs read only; QA proxies/cameras/lights were not exported.",
        "resolution": list(RESOLUTION),
        "assets": reports,
        "passed": all(report["passed"] for report in reports),
    }
    report_path = OUTPUT_DIR / "golf_cart_acceptance_report.json"
    report_path.write_text(json.dumps(result, indent=2), encoding="utf8")
    print(
        f"GOLF_CART_ACCEPTANCE_COMPLETE|passed={result['passed']}|assets={len(reports)}|"
        f"report={report_path.relative_to(ROOT).as_posix()}"
    )


if __name__ == "__main__":
    main()
