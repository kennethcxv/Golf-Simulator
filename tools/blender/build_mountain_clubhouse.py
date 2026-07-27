"""Build the final modular 3,000 sq ft Pinehollow mountain clubhouse.

This is a project-owned, reference-led architectural kit.  The shipped GLB is
an assembled lodge, while every source object remains a discrete, named module
with realistic metric dimensions and reuse metadata.  No downloaded geometry
or texture is used.

Run with Blender 5.1+::

    blender --background --factory-startup --python tools/blender/build_mountain_clubhouse.py -- --preview
"""

from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import assets_51_100_lib as A


# 21.0 m x 13.275 m = 278.775 m2 = 3,000.71 sq ft.
BUILDING_W = 21.0
BUILDING_D = 13.275
FLOOR_Z = 0.27432
STONE_TOP = 1.08
EAVE_Z = 4.40
RIDGE_Z = 8.00
ROOF_OVERHANG = 0.82
WALL_T = 0.22
FRONT_Y = -BUILDING_D / 2.0
BACK_Y = BUILDING_D / 2.0

PORCH_W = 18.0
PORCH_D = 3.40
PORCH_FRONT_Y = FRONT_Y - PORCH_D
PATIO_W = 15.50
PATIO_D = 5.20
CARTPORT_W = 7.20
CARTPORT_D = 6.60

MAIN_DOOR_X = -0.73152
MAIN_DOOR_W = 1.80
MAIN_DOOR_H = 2.45
DELIVERY_DOOR_Y = 3.29184
DELIVERY_DOOR_W = 2.40
DELIVERY_DOOR_H = 2.60
EMPLOYEE_DOOR_Y = -1.35
PATIO_DOOR_X = 0.20
PATIO_DOOR_W = 2.80
PATIO_DOOR_H = 2.55

SOURCE_PATH = REPO_ROOT / "asset_sources/blender/clubhouse/mountain_clubhouse_3000sqft.blend"
CANONICAL_PATH = REPO_ROOT / "Assets/clubhouse/mountain_clubhouse_3000sqft.glb"
RUNTIME_PATH = REPO_ROOT / "vendor/models/clubhouse/mountain_clubhouse_3000sqft.glb"
PREVIEW_PATH = REPO_ROOT / "qa/mountain-clubhouse/blender/mountain_clubhouse_3000sqft.png"
REPORT_PATH = REPO_ROOT / "qa/mountain-clubhouse/blender/build-report.json"


def linear(hex_value: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    return A.hex_to_linear_rgba(hex_value, alpha)


def custom_materials() -> dict[str, bpy.types.Material]:
    mats = A.palette_materials()
    mats.update({
        "cedar": A.material("Lodge_NaturalCedar", linear("9A653F"), roughness=0.66),
        "cedar_light": A.material("Lodge_NaturalCedarLight", linear("B2794C"), roughness=0.64),
        "cedar_dark": A.material("Lodge_NaturalCedarDark", linear("70452F"), roughness=0.69),
        "timber": A.material("Lodge_HeavyTimberWalnut", linear("5A3728"), roughness=0.58),
        "timber_end": A.material("Lodge_TimberEndGrain", linear("754A31"), roughness=0.68),
        "stone_a": A.material("Lodge_FieldstoneGranite", linear("77766D"), roughness=0.91),
        "stone_b": A.material("Lodge_FieldstoneWarm", linear("8A7966"), roughness=0.92),
        "stone_c": A.material("Lodge_FieldstoneSage", linear("697068"), roughness=0.94),
        "stone_d": A.material("Lodge_FieldstoneCharcoal", linear("565852"), roughness=0.93),
        "mortar": A.material("Lodge_WarmMortar", linear("B6AA91"), roughness=0.96),
        "roof": A.material("Lodge_StandingSeamDeepGreen", linear("183D31"), roughness=0.36, metallic=0.72),
        "roof_edge": A.material("Lodge_RoofEdgeCharcoal", linear("242B29"), roughness=0.42, metallic=0.67),
        "concrete": A.material("Lodge_WarmConcrete", linear("B8B0A0"), roughness=0.89),
        "paver": A.material("Lodge_PatioStone", linear("8D887C"), roughness=0.91),
        "road": A.material("Lodge_MaintenanceRoad", linear("3B3D3A"), roughness=0.96),
        "road_edge": A.material("Lodge_RoadAggregate", linear("6B675D"), roughness=0.98),
        "glass": A.material("Lodge_ClearMountainGlass", linear("A9C5C1", 0.28), roughness=0.08,
                            alpha=0.28, transmission=0.72, ior=1.45, double_sided=True),
        "glass_dark": A.material("Lodge_GlassShadow", linear("263C38", 0.55), roughness=0.18,
                                 alpha=0.55, transmission=0.32, ior=1.45, double_sided=True),
        "brass": A.material("Lodge_RestrainedBrass", linear("9B7A3B"), roughness=0.31, metallic=0.88),
        "lamp": A.material("Lodge_LampGlow", linear("FFD59A"), roughness=0.24,
                           emission_color=linear("FFD59A")[:3], emission_strength=2.2),
        "pine_trunk": A.material("Lodge_PineTrunk", linear("59412E"), roughness=0.91),
        "pine_needles": A.material("Lodge_PineNeedles", linear("224C36"), roughness=0.86),
        "pine_needles_light": A.material("Lodge_PineNeedlesSunward", linear("376346"), roughness=0.84),
        "grass": A.material("Lodge_MountainGround", linear("53654B"), roughness=0.98),
        "collision": A.material("Lodge_CollisionAuthoring", (1.0, 0.0, 1.0, 0.0), roughness=1.0,
                                alpha=0.0, double_sided=True),
    })
    return mats


def group(name: str, parent: bpy.types.Object, **properties: object) -> bpy.types.Object:
    obj = bpy.data.objects.new(name if name.startswith("LOD") else f"LOD0_{name}", None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.12
    obj["lod_level"] = 0
    for key, value in properties.items():
        obj[key] = value
    A.parent_keep_world(obj, parent)
    return obj


def mark_module(obj: bpy.types.Object, family: str, nominal: tuple[float, float, float] | None = None,
                **properties: object) -> bpy.types.Object:
    obj["module_family"] = family
    obj["reusable_architectural_module"] = True
    obj["units"] = "meters"
    if nominal:
        obj["nominal_dimensions_m"] = json.dumps([round(v, 5) for v in nominal])
    for key, value in properties.items():
        obj[key] = value
    return obj


def box(name: str, dims: tuple[float, float, float], loc: tuple[float, float, float],
        mat: bpy.types.Material, parent: bpy.types.Object, *, family: str,
        rotation: tuple[float, float, float] = (0.0, 0.0, 0.0), bevel: float = 0.018,
        **properties: object) -> bpy.types.Object:
    obj = A.box(name, dims, loc, mat, parent=parent, rotation=rotation,
                bevel=min(bevel, min(dims) * 0.20), bevel_segments=2, uv="cube")
    return mark_module(obj, family, dims, **properties)


def cylinder(name: str, radius: float, depth: float, loc: tuple[float, float, float],
             mat: bpy.types.Material, parent: bpy.types.Object, *, family: str,
             rotation: tuple[float, float, float] = (0.0, 0.0, 0.0), vertices: int = 20,
             **properties: object) -> bpy.types.Object:
    obj = A.cylinder(name, radius, depth, loc, mat, parent=parent, rotation=rotation,
                     vertices=vertices, bevel=0.009, uv="smart")
    return mark_module(obj, family, (radius * 2.0, radius * 2.0, depth), **properties)


def beam_between(name: str, start: tuple[float, float, float], end: tuple[float, float, float],
                 section: tuple[float, float], mat: bpy.types.Material,
                 parent: bpy.types.Object, *, family: str = "heavy_timber") -> bpy.types.Object:
    a = Vector(start)
    b = Vector(end)
    delta = b - a
    length = delta.length
    midpoint = (a + b) * 0.5
    obj = A.box(name, (section[0], section[1], length), midpoint, mat,
                parent=parent, bevel=0.016, bevel_segments=2, uv="cube")
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(delta.normalized())
    A.apply_transforms(obj, rotation=True, scale=True)
    return mark_module(obj, family, (section[0], section[1], length),
                       joinery="structural_member_with_true_centerline")


def cone(name: str, radius1: float, radius2: float, depth: float,
         loc: tuple[float, float, float], mat: bpy.types.Material,
         parent: bpy.types.Object, *, family: str, vertices: int = 18) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2,
                                    depth=depth, location=loc)
    obj = bpy.context.object
    obj.name = f"MESH_{name}"
    A.finish_mesh(obj, mat, bevel=0.012, bevel_segments=2, uv="smart", smooth=True)
    A.parent_keep_world(obj, parent)
    return mark_module(obj, family, (radius1 * 2.0, radius1 * 2.0, depth))


def root_asset() -> bpy.types.Object:
    root = bpy.data.objects.new("A_MOUNTAIN_LODGE_CLUBHOUSE_ROOT", None)
    bpy.context.collection.objects.link(root)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.35
    root["asset_slug"] = "mountain_clubhouse_3000sqft"
    root["asset_kind"] = "modular_architectural_expansion"
    root["source"] = "Original project-owned Blender Python construction"
    root["license"] = "Project-owned; no external assets or textures"
    root["reference"] = "Designs/ClubHouse/ChatGPT Image Jul 20, 2026, 02_52_25 PM.png; Course 3"
    root["conditioned_footprint_m"] = json.dumps([BUILDING_W, BUILDING_D])
    root["conditioned_area_m2"] = BUILDING_W * BUILDING_D
    root["conditioned_area_sqft"] = BUILDING_W * BUILDING_D * 10.76391041671
    root["interior_policy"] = "INTENTIONALLY_EMPTY_PLAYER_FURNISHES"
    root["modular_construction"] = True
    root["units"] = "meters"
    root["up_axis"] = "+Z"
    root["front_axis"] = "-Y"
    return root


def subtract_spans(lo: float, hi: float, openings: list[tuple[float, float]]) -> list[tuple[float, float]]:
    spans: list[tuple[float, float]] = []
    cursor = lo
    for start, end in sorted(openings):
        start = max(lo, start)
        end = min(hi, end)
        if start > cursor + 0.005:
            spans.append((cursor, start))
        cursor = max(cursor, end)
    if cursor < hi - 0.005:
        spans.append((cursor, hi))
    return spans


def wall_segment(name: str, axis: str, center: float, start: float, end: float,
                 z0: float, z1: float, mats: dict[str, bpy.types.Material],
                 parent: bpy.types.Object, variant: int = 0) -> None:
    length = end - start
    if length <= 0.01 or z1 <= z0:
        return
    cedar = [mats["cedar"], mats["cedar_light"], mats["cedar_dark"]][variant % 3]
    if axis == "x":
        loc = ((start + end) * 0.5, center, (z0 + z1) * 0.5)
        dims = (length, WALL_T, z1 - z0)
    else:
        loc = (center, (start + end) * 0.5, (z0 + z1) * 0.5)
        dims = (WALL_T, length, z1 - z0)
    box(f"{name}_CedarPanel", dims, loc, cedar, parent, family="cedar_wall_panel",
        bevel=0.012, wall_axis=axis, expansion_grid_m=1.2)
    # Repeated battens give the cedar elevation readable depth at player distance.
    spacing = 0.60
    cursor = math.ceil(start / spacing) * spacing
    index = 0
    while cursor < end - 0.08:
        if axis == "x":
            b_loc = (cursor, center - math.copysign(WALL_T * 0.58, center), (z0 + z1) * 0.5)
            b_dims = (0.045, 0.038, z1 - z0 - 0.04)
        else:
            b_loc = (center + math.copysign(WALL_T * 0.58, center), cursor, (z0 + z1) * 0.5)
            b_dims = (0.038, 0.045, z1 - z0 - 0.04)
        box(f"{name}_Batten_{index:02d}", b_dims, b_loc, mats["cedar_dark"], parent,
            family="cedar_batten", bevel=0.006, expansion_grid_m=spacing)
        cursor += spacing
        index += 1


def stone_veneer(name: str, axis: str, center: float, start: float, end: float,
                  z0: float, z1: float, mats: dict[str, bpy.types.Material],
                  parent: bpy.types.Object, *, seed: int,
                  surface_direction: float | None = None) -> None:
    rng = random.Random(seed)
    thickness = 0.16
    length = end - start
    if length < 0.15:
        return
    # Mortar backer closes the wall, individual raised stones sell fieldstone depth.
    if axis == "x":
        box(f"{name}_MortarBacker", (length, thickness, z1 - z0),
            ((start + end) * 0.5, center, (z0 + z1) * 0.5), mats["mortar"], parent,
            family="stone_veneer_backer", bevel=0.006)
    else:
        box(f"{name}_MortarBacker", (thickness, length, z1 - z0),
            (center, (start + end) * 0.5, (z0 + z1) * 0.5), mats["mortar"], parent,
            family="stone_veneer_backer", bevel=0.006)
    stone_mats = [mats["stone_a"], mats["stone_b"], mats["stone_c"], mats["stone_d"]]
    row_h = 0.25
    rows = max(1, int((z1 - z0) / row_h))
    stone_id = 0
    for row in range(rows):
        rz0 = z0 + row * (z1 - z0) / rows
        rz1 = z0 + (row + 1) * (z1 - z0) / rows
        cursor = start + (0.10 if row % 2 else 0.0)
        while cursor < end - 0.06:
            width = min(rng.uniform(0.28, 0.58), end - cursor)
            gap = 0.025
            usable = max(0.10, width - gap)
            height = max(0.10, (rz1 - rz0) - 0.035)
            depth = thickness + rng.uniform(0.025, 0.075)
            if axis == "x":
                direction = surface_direction if surface_direction is not None else math.copysign(1.0, center)
                dims = (usable, depth, height)
                loc = (cursor + usable * 0.5, center + direction * depth * 0.16,
                       rz0 + height * 0.5 + rng.uniform(-0.01, 0.01))
            else:
                direction = surface_direction if surface_direction is not None else math.copysign(1.0, center)
                dims = (depth, usable, height)
                loc = (center + direction * depth * 0.16, cursor + usable * 0.5,
                       rz0 + height * 0.5 + rng.uniform(-0.01, 0.01))
            box(f"{name}_Stone_{stone_id:03d}", dims, loc, rng.choice(stone_mats), parent,
                family="natural_fieldstone", bevel=0.025, masonry_course=row)
            stone_id += 1
            cursor += width


def stone_pier(name: str, x: float, y: float, z0: float, z1: float,
               mats: dict[str, bpy.types.Material], parent: bpy.types.Object, seed: int,
               size: float = 0.82, public_direction: float = -1.0) -> None:
    """Reusable square pier with a stone core, coursed public face, returns, and cap."""
    box(f"{name}_Core", (size, size, z1 - z0), (x, y, (z0 + z1) * 0.5),
        mats["stone_b"], parent, family="stone_pier_core", bevel=0.035,
        structural_pier=True)
    stone_veneer(f"{name}_PublicFace", "x", y + public_direction * size * 0.54,
                  x - size * 0.48, x + size * 0.48, z0 + 0.04, z1 - 0.08,
                  mats, parent, seed=seed)
    # Modular return slabs avoid a thin applied-stone silhouette at oblique player views.
    for side in (-1, 1):
        box(f"{name}_Return_{side:+d}", (0.11, size * 0.94, z1 - z0 - 0.12),
            (x + side * size * 0.49, y, (z0 + z1) * 0.5 - 0.02),
            mats["stone_c" if side < 0 else "stone_a"], parent,
            family="stone_pier_return", bevel=0.025)
    box(f"{name}_Cap", (size + 0.16, size + 0.16, 0.13),
        (x, y, z1 + 0.015), mats["stone_d"], parent,
        family="stone_pier_cap", bevel=0.032)


def facade_wall(name: str, axis: str, center: float, lo: float, hi: float,
                openings: list[dict[str, float]], mats: dict[str, bpy.types.Material],
                parent: bpy.types.Object, seed: int) -> None:
    x_openings = [(entry["c"] - entry["w"] / 2.0, entry["c"] + entry["w"] / 2.0) for entry in openings]
    solid_spans = subtract_spans(lo, hi, x_openings)
    for index, (start, end) in enumerate(solid_spans):
        stone_veneer(f"{name}_Base_{index:02d}", axis, center, start, end,
                      FLOOR_Z, STONE_TOP, mats, parent, seed=seed + index)
        wall_segment(f"{name}_Upper_{index:02d}", axis, center, start, end,
                     STONE_TOP, EAVE_Z, mats, parent, variant=index)
    for index, opening in enumerate(openings):
        start = opening["c"] - opening["w"] / 2.0
        end = opening["c"] + opening["w"] / 2.0
        sill = opening.get("sill", FLOOR_Z)
        top = opening["top"]
        if sill > FLOOR_Z + 0.02:
            stone_veneer(f"{name}_Below_{index:02d}", axis, center, start, end,
                          FLOOR_Z, min(sill, STONE_TOP), mats, parent, seed=seed + 50 + index)
            if sill > STONE_TOP:
                wall_segment(f"{name}_BelowCedar_{index:02d}", axis, center, start, end,
                             STONE_TOP, sill, mats, parent, variant=index + 1)
        if top < EAVE_Z - 0.02:
            wall_segment(f"{name}_Header_{index:02d}", axis, center, start, end,
                         top, EAVE_Z, mats, parent, variant=index + 2)


def window_module(name: str, axis: str, center: float, c: float, width: float, height: float,
                  sill: float, mats: dict[str, bpy.types.Material], parent: bpy.types.Object,
                  *, large: bool = False) -> bpy.types.Object:
    holder = group(f"Window_{name}", parent, module_family="window", reusable_architectural_module=True,
                   nominal_width_m=width, nominal_height_m=height)
    zc = sill + height / 2.0
    frame = 0.115 if not large else 0.14
    depth = WALL_T + 0.09
    if axis == "x":
        glass_dims = (width - frame * 2.0, 0.032, height - frame * 2.0)
        glass_loc = (c, center, zc)
        boxes = [
            ((frame, depth, height), (c - width / 2 + frame / 2, center, zc)),
            ((frame, depth, height), (c + width / 2 - frame / 2, center, zc)),
            ((width, depth, frame), (c, center, sill + frame / 2)),
            ((width, depth, frame), (c, center, sill + height - frame / 2)),
        ]
    else:
        glass_dims = (0.032, width - frame * 2.0, height - frame * 2.0)
        glass_loc = (center, c, zc)
        boxes = [
            ((depth, frame, height), (center, c - width / 2 + frame / 2, zc)),
            ((depth, frame, height), (center, c + width / 2 - frame / 2, zc)),
            ((depth, width, frame), (center, c, sill + frame / 2)),
            ((depth, width, frame), (center, c, sill + height - frame / 2)),
        ]
    box(f"{name}_Glass", glass_dims, glass_loc, mats["glass"], holder, family="window_glazing",
        bevel=0.003, glass_thickness_m=0.032)
    for index, (dims, loc) in enumerate(boxes):
        box(f"{name}_Frame_{index}", dims, loc, mats["timber"], holder,
            family="window_frame", bevel=0.012)
    mullion_count = 3 if large else 1
    for index in range(1, mullion_count + 1):
        offset = -width / 2.0 + width * index / (mullion_count + 1)
        if axis == "x":
            loc = (c + offset, center - 0.025, zc)
            dims = (0.065, depth + 0.02, height - frame * 2.0)
        else:
            loc = (center + 0.025, c + offset, zc)
            dims = (depth + 0.02, 0.065, height - frame * 2.0)
        box(f"{name}_MullionV_{index}", dims, loc, mats["timber"], holder,
            family="window_mullion", bevel=0.008)
    if height > 1.7:
        if axis == "x":
            loc = (c, center - 0.026, zc + height * 0.12)
            dims = (width - frame * 2.0, depth + 0.02, 0.065)
        else:
            loc = (center + 0.026, c, zc + height * 0.12)
            dims = (depth + 0.02, width - frame * 2.0, 0.065)
        box(f"{name}_MullionH", dims, loc, mats["timber"], holder,
            family="window_mullion", bevel=0.008)
    # Deep natural-stone sill reads against the cedar and sheds water believably.
    if axis == "x":
        dims = (width + 0.30, 0.36, 0.11)
        loc = (c, center - math.copysign(0.12, center), sill - 0.035)
    else:
        dims = (0.36, width + 0.30, 0.11)
        loc = (center + math.copysign(0.12, center), c, sill - 0.035)
    box(f"{name}_StoneSill", dims, loc, mats["stone_b"], holder,
        family="window_stone_sill", bevel=0.018)
    return holder


def door_leaf(name: str, width: float, height: float, depth: float,
              hinge: tuple[float, float, float], axis: str,
              mats: dict[str, bpy.types.Material], parent: bpy.types.Object,
              *, glazed: bool, handed: str, glazing_face_sign: float = -1.0) -> bpy.types.Object:
    pivot = bpy.data.objects.new(f"PIVOT_{name}", None)
    bpy.context.collection.objects.link(pivot)
    pivot.location = hinge
    pivot.empty_display_type = "ARROWS"
    pivot.empty_display_size = 0.18
    pivot["marker_type"] = "pivot"
    pivot["door_handedness"] = handed
    pivot["reusable_architectural_module"] = True
    A.parent_keep_world(pivot, parent)
    direction = 1.0 if handed == "right" else -1.0
    if axis == "x":
        center = (hinge[0] + direction * width / 2.0, hinge[1], hinge[2] + height / 2.0)
        slab_dims = (width, depth, height)
        glass_dims = (width * 0.58, depth + 0.012, height * 0.48)
        glass_loc = (center[0], center[1] + glazing_face_sign * 0.012, center[2] + height * 0.12)
    else:
        center = (hinge[0], hinge[1] + direction * width / 2.0, hinge[2] + height / 2.0)
        slab_dims = (depth, width, height)
        glass_dims = (depth + 0.012, width * 0.58, height * 0.48)
        glass_loc = (center[0] + 0.012, center[1], center[2] + height * 0.12)
    slab = box(f"{name}_TimberLeaf", slab_dims, center, mats["timber"], pivot,
               family="hinged_door_leaf", bevel=0.022, pivot_at_physical_hinge=True)
    if glazed:
        box(f"{name}_GlassLite", glass_dims, glass_loc, mats["glass_dark"], pivot,
            family="door_glazing", bevel=0.004)
        # Applied raised rails keep the door authored as a reusable assembly without booleans.
        for zoff in (-height * 0.32, height * 0.38):
            if axis == "x":
                dims = (width * 0.82, depth + 0.045, 0.105)
                loc = (center[0], center[1] + glazing_face_sign * 0.026, center[2] + zoff)
            else:
                dims = (depth + 0.045, width * 0.82, 0.105)
                loc = (center[0] + 0.026, center[1], center[2] + zoff)
            box(f"{name}_Rail_{zoff:+.2f}", dims, loc, mats["cedar_light"], pivot,
                family="door_trim", bevel=0.012)
    handle_z = hinge[2] + 1.03
    if axis == "x":
        handle_loc = (hinge[0] + direction * width * 0.78, hinge[1] - depth * 0.65, handle_z)
        rotation = (math.pi / 2.0, 0.0, 0.0)
    else:
        handle_loc = (hinge[0] + depth * 0.65, hinge[1] + direction * width * 0.78, handle_z)
        rotation = (0.0, math.pi / 2.0, 0.0)
    cylinder(f"{name}_Handle", 0.032, 0.15, handle_loc, mats["brass"], pivot,
             family="door_hardware", rotation=rotation, vertices=16)
    slab["door_leaf_width_m"] = width
    slab["door_leaf_height_m"] = height
    return pivot


def door_frame(name: str, axis: str, center: float, c: float, width: float, height: float,
               mats: dict[str, bpy.types.Material], parent: bpy.types.Object) -> None:
    jamb = 0.15
    depth = WALL_T + 0.13
    if axis == "x":
        parts = [
            ((jamb, depth, height + jamb), (c - width / 2 - jamb / 2, center, FLOOR_Z + height / 2)),
            ((jamb, depth, height + jamb), (c + width / 2 + jamb / 2, center, FLOOR_Z + height / 2)),
            ((width + jamb * 2, depth, jamb), (c, center, FLOOR_Z + height + jamb / 2)),
        ]
    else:
        parts = [
            ((depth, jamb, height + jamb), (center, c - width / 2 - jamb / 2, FLOOR_Z + height / 2)),
            ((depth, jamb, height + jamb), (center, c + width / 2 + jamb / 2, FLOOR_Z + height / 2)),
            ((depth, width + jamb * 2, jamb), (center, c, FLOOR_Z + height + jamb / 2)),
        ]
    for index, (dims, loc) in enumerate(parts):
        box(f"{name}_Frame_{index}", dims, loc, mats["timber"], parent,
            family="door_frame", bevel=0.015)


def build_doors(mats: dict[str, bpy.types.Material], parent: bpy.types.Object) -> None:
    door_frame("MainEntrance", "x", FRONT_Y, MAIN_DOOR_X, MAIN_DOOR_W, MAIN_DOOR_H, mats, parent)
    leaf_w = MAIN_DOOR_W / 2.0
    door_leaf("MainEntranceLeft", leaf_w, MAIN_DOOR_H, 0.105,
              (MAIN_DOOR_X - MAIN_DOOR_W / 2.0, FRONT_Y, FLOOR_Z), "x", mats, parent,
              glazed=True, handed="right")
    door_leaf("MainEntranceRight", leaf_w, MAIN_DOOR_H, 0.105,
              (MAIN_DOOR_X + MAIN_DOOR_W / 2.0, FRONT_Y, FLOOR_Z), "x", mats, parent,
              glazed=True, handed="left")
    # Employee entrance: single secure glazed timber door on the east service side.
    door_frame("EmployeeEntrance", "y", BUILDING_W / 2.0, EMPLOYEE_DOOR_Y, 1.00, 2.20, mats, parent)
    door_leaf("EmployeeEntrance", 1.00, 2.20, 0.105,
              (BUILDING_W / 2.0, EMPLOYEE_DOOR_Y - 0.50, FLOOR_Z), "y", mats, parent,
              glazed=True, handed="right")
    # Delivery entrance: true 2.4 m double leaves with flush lower panels.
    door_frame("DeliveryEntrance", "y", BUILDING_W / 2.0, DELIVERY_DOOR_Y,
               DELIVERY_DOOR_W, DELIVERY_DOOR_H, mats, parent)
    door_leaf("DeliveryEntranceNorth", DELIVERY_DOOR_W / 2.0, DELIVERY_DOOR_H, 0.12,
              (BUILDING_W / 2.0, DELIVERY_DOOR_Y - DELIVERY_DOOR_W / 2.0, FLOOR_Z), "y", mats, parent,
              glazed=False, handed="right")
    door_leaf("DeliveryEntranceSouth", DELIVERY_DOOR_W / 2.0, DELIVERY_DOOR_H, 0.12,
              (BUILDING_W / 2.0, DELIVERY_DOOR_Y + DELIVERY_DOOR_W / 2.0, FLOOR_Z), "y", mats, parent,
              glazed=False, handed="left")
    # Course patio: a broad glazed double door supports the indoor/outdoor lodge relationship.
    door_frame("PatioEntrance", "x", BACK_Y, PATIO_DOOR_X, PATIO_DOOR_W, PATIO_DOOR_H, mats, parent)
    door_leaf("PatioEntranceLeft", PATIO_DOOR_W / 2.0, PATIO_DOOR_H, 0.105,
              (PATIO_DOOR_X - PATIO_DOOR_W / 2.0, BACK_Y, FLOOR_Z), "x", mats, parent,
              glazed=True, handed="right", glazing_face_sign=1.0)
    door_leaf("PatioEntranceRight", PATIO_DOOR_W / 2.0, PATIO_DOOR_H, 0.105,
              (PATIO_DOOR_X + PATIO_DOOR_W / 2.0, BACK_Y, FLOOR_Z), "x", mats, parent,
              glazed=True, handed="left", glazing_face_sign=1.0)


def build_shell(mats: dict[str, bpy.types.Material], root: bpy.types.Object) -> None:
    shell = group("ArchitecturalShell", root, component="shell", conditioned_area_sqft=3000.71)
    walls = group("ModularWalls", shell, expansion_grid_m=1.2)
    windows = group("ModularWindows", shell)
    doors = group("ModularDoors", shell)
    floor = group("EmptyInterior", shell, interior_policy="PLAYER_FURNISHES")

    box("ConditionedSlab", (BUILDING_W, BUILDING_D, FLOOR_Z), (0.0, 0.0, FLOOR_Z / 2.0),
        mats["concrete"], floor, family="foundation_slab", bevel=0.025,
        player_build_surface=True, conditioned_area_m2=BUILDING_W * BUILDING_D)
    # A warm neutral subfloor is intentionally the only interior finish; no furniture is baked.
    box("PlayerFinishSubfloor", (BUILDING_W - 0.36, BUILDING_D - 0.36, 0.032),
        (0.0, 0.0, FLOOR_Z + 0.016), mats["concrete"], floor,
        family="player_finish_subfloor", bevel=0.006, player_flooring_receiver=True)

    front_openings = [
        {"c": -7.58952, "w": 2.40, "sill": 0.82, "top": 3.00},
        {"c": -4.48056, "w": 2.40, "sill": 0.82, "top": 3.00},
        {"c": MAIN_DOOR_X, "w": MAIN_DOOR_W, "sill": FLOOR_Z, "top": FLOOR_Z + MAIN_DOOR_H},
        {"c": 4.70, "w": 4.50, "sill": 0.62, "top": 3.55},
    ]
    back_openings = [
        {"c": -5.15, "w": 5.40, "sill": 0.58, "top": 3.72},
        {"c": PATIO_DOOR_X, "w": PATIO_DOOR_W, "sill": FLOOR_Z,
         "top": FLOOR_Z + PATIO_DOOR_H},
        {"c": 3.60, "w": 2.80, "sill": 0.68, "top": 3.52},
    ]
    east_openings = [
        {"c": -4.20624, "w": 2.40, "sill": 0.82, "top": 3.00},
        {"c": EMPLOYEE_DOOR_Y, "w": 1.00, "sill": FLOOR_Z, "top": FLOOR_Z + 2.20},
        {"c": DELIVERY_DOOR_Y, "w": DELIVERY_DOOR_W, "sill": FLOOR_Z, "top": FLOOR_Z + DELIVERY_DOOR_H},
    ]
    west_openings = [
        {"c": -2.20, "w": 3.60, "sill": 0.62, "top": 3.45},
        {"c": 3.60, "w": 2.40, "sill": 0.82, "top": 3.00},
    ]
    facade_wall("Front", "x", FRONT_Y, -BUILDING_W / 2, BUILDING_W / 2,
                front_openings, mats, walls, 100)
    facade_wall("Back", "x", BACK_Y, -BUILDING_W / 2, BUILDING_W / 2,
                back_openings, mats, walls, 200)
    facade_wall("East", "y", BUILDING_W / 2, -BUILDING_D / 2, BUILDING_D / 2,
                east_openings, mats, walls, 300)
    facade_wall("West", "y", -BUILDING_W / 2, -BUILDING_D / 2, BUILDING_D / 2,
                west_openings, mats, walls, 400)

    for label, c, w, h, sill, large in [
        ("FrontWest", -7.58952, 2.40, 2.18, 0.82, False),
        ("FrontMid", -4.48056, 2.40, 2.18, 0.82, False),
        ("FrontGreatRoom", 4.70, 4.50, 2.93, 0.62, True),
    ]:
        window_module(label, "x", FRONT_Y, c, w, h, sill, mats, windows, large=large)
    for label, c, w, h, sill, large in [
        ("PatioGreatRoom", -5.15, 5.40, 3.14, 0.58, True),
        ("CourseView", 3.60, 2.80, 2.84, 0.68, True),
    ]:
        window_module(label, "x", BACK_Y, c, w, h, sill, mats, windows, large=large)
    window_module("OfficeEast", "y", BUILDING_W / 2, -4.20624, 2.40, 2.18, 0.82,
                  mats, windows)
    window_module("CartportView", "y", -BUILDING_W / 2, -2.20, 3.60, 2.83, 0.62,
                  mats, windows, large=True)
    window_module("WestCourseView", "y", -BUILDING_W / 2, 3.60, 2.40, 2.18, 0.82,
                  mats, windows)
    build_doors(mats, doors)

    # Solid cedar gable faces, deliberately separate from rectangular wall bays.
    rise = RIDGE_Z - EAVE_Z
    profile = [(-BUILDING_W / 2, 0.0), (BUILDING_W / 2, 0.0), (0.0, rise)]
    for side, y in (("Front", FRONT_Y), ("Back", BACK_Y)):
        gable = A.profile_prism(f"{side}_CedarGable", profile, WALL_T, (0.0, y, EAVE_Z),
                                mats["cedar"], parent=walls, bevel=0.012,
                                properties={"module_family": "cedar_gable_panel",
                                            "reusable_architectural_module": True,
                                            "expansion_grid_m": 1.2})
        mark_module(gable, "cedar_gable_panel", (BUILDING_W, WALL_T, rise))
        # Vertical gable battens follow the triangular outline.
        for index, x in enumerate([v * 0.60 for v in range(-16, 17)]):
            available = max(0.0, rise * (1.0 - abs(x) / (BUILDING_W / 2.0)))
            if available < 0.25:
                continue
            outward = -1 if side == "Front" else 1
            box(f"{side}_GableBatten_{index:02d}", (0.05, 0.042, available),
                (x, y + outward * (WALL_T / 2 + 0.018), EAVE_Z + available / 2),
                mats["cedar_dark"], walls, family="cedar_batten", bevel=0.006)

        # A recessed, timber-framed triangular window gives both lodge elevations the
        # strong glazed gable composition shown in the Course 3 reference.
        glass_half = 3.45
        glass_rise = 2.72
        glass_profile = [(-glass_half, 0.0), (glass_half, 0.0), (0.0, glass_rise)]
        glass_y = y + outward * (WALL_T / 2 + 0.052)
        gable_glass = A.profile_prism(
            f"{side}_CourseViewGableGlass", glass_profile, 0.035,
            (0.0, glass_y, EAVE_Z + 0.16), mats["glass_dark"], parent=windows,
            bevel=0.008,
            properties={"module_family": "gable_window_glazing",
                        "reusable_architectural_module": True,
                        "course_view_glazing": True},
        )
        mark_module(gable_glass, "gable_window_glazing", (glass_half * 2.0, 0.035, glass_rise))
        frame_y = glass_y + outward * 0.035
        beam_between(f"{side}_GableWindowSill", (-glass_half, frame_y, EAVE_Z + 0.16),
                     (glass_half, frame_y, EAVE_Z + 0.16), (0.17, 0.14), mats["timber"], windows,
                     family="gable_window_frame")
        beam_between(f"{side}_GableWindowRafterW", (-glass_half, frame_y, EAVE_Z + 0.16),
                     (0.0, frame_y, EAVE_Z + 0.16 + glass_rise), (0.17, 0.14), mats["timber"], windows,
                     family="gable_window_frame")
        beam_between(f"{side}_GableWindowRafterE", (0.0, frame_y, EAVE_Z + 0.16 + glass_rise),
                     (glass_half, frame_y, EAVE_Z + 0.16), (0.17, 0.14), mats["timber"], windows,
                     family="gable_window_frame")
        for mullion_index, mx in enumerate((-2.25, -1.12, 0.0, 1.12, 2.25)):
            available = glass_rise * (1.0 - abs(mx) / glass_half)
            beam_between(f"{side}_GableWindowMullion_{mullion_index}",
                         (mx, frame_y, EAVE_Z + 0.20),
                         (mx, frame_y, EAVE_Z + 0.16 + available),
                         (0.105, 0.10), mats["timber"], windows,
                         family="gable_window_mullion")


def roof_height_at_x(x: float) -> float:
    return RIDGE_Z - abs(x) * (RIDGE_Z - EAVE_Z) / (BUILDING_W / 2.0)


def build_roof_and_trusses(mats: dict[str, bpy.types.Material], root: bpy.types.Object) -> None:
    roof = group("ModularStandingSeamRoof", root, component="roof")
    trusses = group("ExposedHeavyTimberTrusses", root, component="trusses", interior_architecture=True)
    run = BUILDING_W / 2 + ROOF_OVERHANG
    rise = (RIDGE_Z - EAVE_Z) + ROOF_OVERHANG * (RIDGE_Z - EAVE_Z) / (BUILDING_W / 2)
    slope = math.hypot(run, rise)
    pitch = math.atan2(rise, run)
    roof_depth = BUILDING_D + ROOF_OVERHANG * 2
    for side, sign in (("West", -1), ("East", 1)):
        box(f"MainRoof_{side}_Panel", (slope, roof_depth, 0.12),
            (sign * run / 2.0, 0.0, (EAVE_Z - ROOF_OVERHANG * math.tan(pitch) + RIDGE_Z) / 2.0 + 0.08),
            mats["roof"], roof, family="standing_seam_roof_panel",
            rotation=(0.0, sign * pitch, 0.0), bevel=0.012, roof_pitch_degrees=math.degrees(pitch))
    # Standing seams are true raised metal ribs on a realistic 0.48 m module.
    seam_spacing = 0.48
    seam_id = 0
    x = -BUILDING_W / 2 - ROOF_OVERHANG + seam_spacing
    while x < BUILDING_W / 2 + ROOF_OVERHANG - 0.10:
        z = roof_height_at_x(max(-BUILDING_W / 2, min(BUILDING_W / 2, x))) + 0.12
        # At the overhang extend the roof slope linearly.
        if abs(x) > BUILDING_W / 2:
            z = EAVE_Z - (abs(x) - BUILDING_W / 2) * math.tan(pitch) + 0.12
        box(f"RoofStandingSeam_{seam_id:02d}", (0.038, roof_depth, 0.052),
            (x, 0.0, z), mats["roof_edge"], roof, family="standing_seam_rib",
            rotation=(0.0, (-1 if x < 0 else 1) * pitch, 0.0), bevel=0.006,
            seam_spacing_m=seam_spacing)
        seam_id += 1
        x += seam_spacing
    box("RoofRidgeCap", (0.28, roof_depth + 0.12, 0.19), (0.0, 0.0, RIDGE_Z + 0.11),
        mats["roof_edge"], roof, family="metal_ridge_cap", bevel=0.028)
    for side, y in (("Front", FRONT_Y - ROOF_OVERHANG), ("Back", BACK_Y + ROOF_OVERHANG)):
        beam_between(f"{side}_BargeRafter_W", (-BUILDING_W / 2 - ROOF_OVERHANG, y, EAVE_Z - 0.20),
                     (0.0, y, RIDGE_Z), (0.24, 0.18), mats["timber"], roof, family="gable_barge_rafter")
        beam_between(f"{side}_BargeRafter_E", (0.0, y, RIDGE_Z),
                     (BUILDING_W / 2 + ROOF_OVERHANG, y, EAVE_Z - 0.20),
                     (0.24, 0.18), mats["timber"], roof, family="gable_barge_rafter")
    # Five full timber trusses remain visible inside the intentionally empty hall.
    for index, y in enumerate((-5.25, -2.65, 0.0, 2.65, 5.25)):
        tie_z = 4.02
        beam_between(f"InteriorTruss_{index}_Tie", (-9.70, y, tie_z), (9.70, y, tie_z),
                     (0.30, 0.30), mats["timber"], trusses)
        beam_between(f"InteriorTruss_{index}_RafterW", (-9.70, y, tie_z), (0.0, y, RIDGE_Z - 0.30),
                     (0.29, 0.29), mats["timber"], trusses)
        beam_between(f"InteriorTruss_{index}_RafterE", (0.0, y, RIDGE_Z - 0.30), (9.70, y, tie_z),
                     (0.29, 0.29), mats["timber"], trusses)
        beam_between(f"InteriorTruss_{index}_King", (0.0, y, tie_z), (0.0, y, RIDGE_Z - 0.30),
                     (0.28, 0.28), mats["timber"], trusses)
        beam_between(f"InteriorTruss_{index}_BraceW", (-4.85, y, tie_z), (0.0, y, RIDGE_Z - 0.30),
                     (0.22, 0.22), mats["timber"], trusses)
        beam_between(f"InteriorTruss_{index}_BraceE", (4.85, y, tie_z), (0.0, y, RIDGE_Z - 0.30),
                     (0.22, 0.22), mats["timber"], trusses)
    beam_between("InteriorRidgeBeam", (0.0, FRONT_Y + 0.25, RIDGE_Z - 0.28),
                 (0.0, BACK_Y - 0.25, RIDGE_Z - 0.28), (0.34, 0.38), mats["timber"], trusses)


def build_porch(mats: dict[str, bpy.types.Material], root: bpy.types.Object) -> None:
    porch = group("CoveredFrontPorch", root, component="porch", depth_m=PORCH_D)
    deck_z = FLOOR_Z
    box("PorchFoundation", (PORCH_W, PORCH_D, FLOOR_Z),
        (-0.50, FRONT_Y - PORCH_D / 2.0, FLOOR_Z / 2.0), mats["stone_b"], porch,
        family="porch_foundation", bevel=0.028)
    # 140 mm cedar boards: individually reusable, with realistic 6 mm spacing.
    board_w = 0.14
    count = int(PORCH_W / (board_w + 0.006))
    start_x = -0.50 - (count - 1) * (board_w + 0.006) / 2.0
    for index in range(count):
        box(f"PorchDeckBoard_{index:03d}", (board_w, PORCH_D - 0.10, 0.045),
            (start_x + index * (board_w + 0.006), FRONT_Y - PORCH_D / 2.0, deck_z + 0.023),
            mats["cedar_light" if index % 5 else "cedar"], porch, family="porch_deck_board",
            bevel=0.008, module_spacing_m=0.006)
    outer_y = PORCH_FRONT_Y + 0.28
    top_z = 3.55
    # Four posts frame the entry bay; no structural member occupies the door centerline.
    post_positions = [-8.25, -4.35, 2.85, 7.25]
    for index, x in enumerate(post_positions):
        # Stone base + timber post + cap are separate reusable column modules.
        stone_pier(f"PorchColumn_{index}_Base", x, outer_y, FLOOR_Z, 1.14,
                   mats, porch, seed=600 + index, size=0.82)
        box(f"PorchColumn_{index}_Post", (0.38, 0.38, top_z - 1.10),
            (x, outer_y, (top_z + 1.10) / 2.0), mats["timber"], porch,
            family="heavy_timber_column", bevel=0.022, structural_post=True)
        box(f"PorchColumn_{index}_Capital", (0.52, 0.52, 0.16), (x, outer_y, top_z - 0.08),
            mats["timber_end"], porch, family="timber_column_cap", bevel=0.026)
    beam_between("PorchFrontHeader", (post_positions[0], outer_y, top_z),
                 (post_positions[-1], outer_y, top_z), (0.34, 0.34), mats["timber"], porch)
    # Knee braces visibly carry the header and prevent the porch from reading as thin sticks.
    for index, x in enumerate(post_positions):
        if index > 0:
            beam_between(f"PorchKneeBrace_{index}_W", (x, outer_y, top_z - 1.05),
                         (x - 0.82, outer_y, top_z), (0.18, 0.18), mats["timber"], porch)
        if index < len(post_positions) - 1:
            beam_between(f"PorchKneeBrace_{index}_E", (x, outer_y, top_z - 1.05),
                         (x + 0.82, outer_y, top_z), (0.18, 0.18), mats["timber"], porch)
    # Lean-to standing-seam porch roof, separate from the main gable.
    inner_z = EAVE_Z - 0.18
    outer_z = top_z + 0.12
    slope = math.hypot(PORCH_D + 0.70, inner_z - outer_z)
    angle = math.atan2(inner_z - outer_z, PORCH_D + 0.70)
    box("PorchRoofPanel", (PORCH_W + 0.85, slope, 0.105),
        (-0.50, FRONT_Y - PORCH_D / 2.0, (inner_z + outer_z) / 2.0), mats["roof"], porch,
        family="standing_seam_porch_roof", rotation=(angle, 0.0, 0.0), bevel=0.012)
    for index, x in enumerate([v * 0.48 for v in range(-18, 18)]):
        if abs(x + 0.50) > PORCH_W / 2.0:
            continue
        box(f"PorchRoofSeam_{index:02d}", (0.036, slope, 0.045),
            (x, FRONT_Y - PORCH_D / 2.0, (inner_z + outer_z) / 2.0 + 0.06),
            mats["roof_edge"], porch, family="standing_seam_rib",
            rotation=(angle, 0.0, 0.0), bevel=0.005)
    # Three broad stone steps centered on the main entrance.
    for index, (w, d, h) in enumerate(((4.40, 0.52, 0.11), (4.00, 0.48, 0.11), (3.60, 0.44, 0.11))):
        box(f"PorchStep_{index}", (w, d, h),
            (MAIN_DOOR_X, PORCH_FRONT_Y - 0.18 - index * 0.43, FLOOR_Z - (index + 0.5) * 0.09),
            mats["stone_b"], porch, family="stone_porche_step", bevel=0.022,
            tread_depth_m=d, riser_height_m=0.09)
    # A true entry cross-gable and truss sit over the unobstructed door bay.
    y = outer_y - 0.08
    entry_left = -4.35
    entry_right = 2.85
    entry_apex_x = MAIN_DOOR_X
    entry_apex_z = 5.68
    beam_between("PorchFeatureTrussTie", (entry_left, y, top_z + 0.10),
                 (entry_right, y, top_z + 0.10), (0.30, 0.25), mats["timber"], porch)
    beam_between("PorchFeatureTrussRafterW", (entry_left, y, top_z + 0.10),
                 (entry_apex_x, y, entry_apex_z), (0.28, 0.23), mats["timber"], porch)
    beam_between("PorchFeatureTrussRafterE", (entry_apex_x, y, entry_apex_z),
                 (entry_right, y, top_z + 0.10), (0.28, 0.23), mats["timber"], porch)
    beam_between("PorchFeatureTrussKing", (entry_apex_x, y, top_z + 0.10),
                 (entry_apex_x, y, entry_apex_z), (0.23, 0.20), mats["timber"], porch)
    for label, x0, x1 in (("W", entry_left, entry_apex_x), ("E", entry_apex_x, entry_right)):
        beam_between(f"PorchFeatureTrussBrace{label}",
                     ((x0 + x1) * 0.5, y, top_z + 0.10),
                     (entry_apex_x, y, entry_apex_z), (0.18, 0.17), mats["timber"], porch)

    entry_run = (entry_right - entry_left) * 0.5 + 0.35
    entry_rise = entry_apex_z - (top_z + 0.02)
    entry_slope = math.hypot(entry_run, entry_rise)
    entry_pitch = math.atan2(entry_rise, entry_run)
    entry_roof_depth = PORCH_D + 0.92
    for side, sign in (("W", -1), ("E", 1)):
        box(f"EntryCrossGableRoof_{side}", (entry_slope, entry_roof_depth, 0.115),
            (entry_apex_x + sign * entry_run * 0.5,
             FRONT_Y - PORCH_D * 0.50,
             (entry_apex_z + top_z) * 0.5 + 0.08),
            mats["roof"], porch, family="standing_seam_entry_gable_roof",
            rotation=(0.0, sign * entry_pitch, 0.0), bevel=0.012)
        for seam_index, seam_y in enumerate([
            FRONT_Y - PORCH_D - 0.30 + step * 0.48
            for step in range(int(entry_roof_depth / 0.48) + 1)
        ]):
            box(f"EntryCrossGableSeam_{side}_{seam_index:02d}",
                (entry_slope, 0.038, 0.050),
                (entry_apex_x + sign * entry_run * 0.5, seam_y,
                 (entry_apex_z + top_z) * 0.5 + 0.145),
                mats["roof_edge"], porch, family="standing_seam_rib",
                rotation=(0.0, sign * entry_pitch, 0.0), bevel=0.005)
    box("EntryCrossGableRidgeCap", (0.24, entry_roof_depth + 0.08, 0.17),
        (entry_apex_x, FRONT_Y - PORCH_D * 0.50, entry_apex_z + 0.12),
        mats["roof_edge"], porch, family="metal_ridge_cap", bevel=0.024)


def build_cartport(mats: dict[str, bpy.types.Material], root: bpy.types.Object) -> None:
    cartport = group("CoveredGolfCartParking", root, component="cart_parking",
                     capacity=2, clear_bay_width_m=3.15)
    x0 = -BUILDING_W / 2.0 - CARTPORT_W
    x1 = -BUILDING_W / 2.0
    y0 = FRONT_Y + 0.10
    y1 = y0 + CARTPORT_D
    box("CartportPad", (CARTPORT_W, CARTPORT_D, 0.13),
        ((x0 + x1) / 2.0, (y0 + y1) / 2.0, 0.065), mats["concrete"], cartport,
        family="cartport_slab", bevel=0.022)
    for index, y in enumerate((y0 + 0.28, y1 - 0.28)):
        stone_veneer(f"CartportOuterPost_{index}_Base", "y", x0 + 0.32, y - 0.34, y + 0.34,
                      0.13, 0.88, mats, cartport, seed=710 + index)
        box(f"CartportOuterPost_{index}", (0.34, 0.34, 2.82),
            (x0 + 0.32, y, 2.20), mats["timber"], cartport,
            family="heavy_timber_column", bevel=0.022)
    for index, y in enumerate((y0 + 0.28, y1 - 0.28)):
        box(f"CartportWallPost_{index}", (0.30, 0.30, 3.10),
            (x1 - 0.25, y, 2.36), mats["timber"], cartport,
            family="heavy_timber_column", bevel=0.020)
    # The front and rear center posts make the two 3.15 m cart bays legible and structural.
    bay_divider_x = (x0 + x1) * 0.5
    for side, y in (("Front", y0 + 0.28), ("Rear", y1 - 0.28)):
        stone_pier(f"Cartport{side}DividerBase", bay_divider_x, y, 0.13, 0.86,
                   mats, cartport, seed=735 if side == "Front" else 736,
                   size=0.68, public_direction=-1.0 if side == "Front" else 1.0)
        box(f"Cartport{side}DividerPost", (0.32, 0.32, 2.92),
            (bay_divider_x, y, 2.30), mats["timber"], cartport,
            family="heavy_timber_column", bevel=0.022, cart_bay_divider=True)
    beam_between("CartportOuterHeader", (x0 + 0.32, y0 + 0.28, 3.62),
                 (x0 + 0.32, y1 - 0.28, 3.62), (0.32, 0.30), mats["timber"], cartport)
    beam_between("CartportWallHeader", (x1 - 0.25, y0 + 0.28, 4.10),
                 (x1 - 0.25, y1 - 0.28, 4.10), (0.32, 0.30), mats["timber"], cartport)
    for side, y in (("Front", y0 + 0.28), ("Rear", y1 - 0.28)):
        beam_between(f"Cartport{side}CrossHeader", (x0 + 0.32, y, 3.62),
                     (x1 - 0.25, y, 4.10), (0.28, 0.28), mats["timber"], cartport)
        beam_between(f"Cartport{side}BayBraceWest",
                     (bay_divider_x, y, 3.20), (bay_divider_x - 1.05, y, 3.83),
                     (0.16, 0.16), mats["timber"], cartport,
                     family="cartport_knee_brace")
        beam_between(f"Cartport{side}BayBraceEast",
                     (bay_divider_x, y, 3.20), (bay_divider_x + 1.05, y, 3.94),
                     (0.16, 0.16), mats["timber"], cartport,
                     family="cartport_knee_brace")
    run = x1 - x0 + 0.60
    angle = math.atan2(0.48, run)
    box("CartportRoofPanel", (run, CARTPORT_D + 0.70, 0.11),
        ((x0 + x1) / 2.0, (y0 + y1) / 2.0, 3.89), mats["roof"], cartport,
        family="standing_seam_cartport_roof", rotation=(0.0, -angle, 0.0), bevel=0.012)
    for index, y in enumerate([y0 + 0.22 + i * 0.48 for i in range(14)]):
        if y > y1 - 0.05:
            break
        box(f"CartportRoofSeam_{index:02d}", (run, 0.036, 0.046),
            ((x0 + x1) / 2.0, y, 3.95), mats["roof_edge"], cartport,
            family="standing_seam_rib", rotation=(0.0, -angle, 0.0), bevel=0.005)
    # Bay stripes and stops make the use obvious without baking a cart prop.
    for bay, x in enumerate((x0 + 1.90, x0 + 5.20)):
        for edge in (-1.48, 1.48):
            box(f"CartBay_{bay}_Stripe_{edge:+.2f}", (0.08, CARTPORT_D - 0.75, 0.012),
                (x + edge, (y0 + y1) / 2.0, 0.142), mats["warm_cream"], cartport,
                family="cart_parking_line", bevel=0.002)
        box(f"CartBay_{bay}_WheelStop", (1.70, 0.18, 0.15),
            (x, y1 - 0.65, 0.205), mats["road_edge"], cartport,
            family="parking_wheel_stop", bevel=0.024)
        A.socket(f"GolfCartBay_{bay + 1}", parent=cartport,
                 location=(x, (y0 + y1) / 2.0, 0.14),
                 properties={"capacity": 1, "vehicle_type": "golf_cart"})


def build_service_architecture(mats: dict[str, bpy.types.Material], root: bpy.types.Object) -> None:
    service = group("EmployeeAndDeliveryArchitecture", root, component="service_entrances")

    def canopy(name: str, y: float, width: float, projection: float,
               wall_z: float, outer_z: float, role: str) -> None:
        holder = group(f"{name}Canopy", service, module_family="service_entry_canopy",
                       reusable_architectural_module=True, entrance_role=role)
        inner_x = BUILDING_W / 2.0 + 0.10
        outer_x = inner_x + projection
        slope = math.hypot(projection + 0.20, wall_z - outer_z)
        pitch = math.atan2(wall_z - outer_z, projection + 0.20)
        box(f"{name}Roof", (slope, width + 0.36, 0.10),
            ((inner_x + outer_x) * 0.5, y, (wall_z + outer_z) * 0.5),
            mats["roof"], holder, family="standing_seam_service_canopy",
            rotation=(0.0, pitch, 0.0), bevel=0.012, entrance_role=role)
        for seam_index, seam_y in enumerate([
            y - width / 2.0 + 0.20 + i * 0.42 for i in range(max(2, int(width / 0.42)))
        ]):
            box(f"{name}RoofSeam_{seam_index:02d}", (slope, 0.034, 0.046),
                ((inner_x + outer_x) * 0.5, seam_y, (wall_z + outer_z) * 0.5 + 0.06),
                mats["roof_edge"], holder, family="standing_seam_rib",
                rotation=(0.0, pitch, 0.0), bevel=0.005)
        beam_between(f"{name}OuterHeader", (outer_x, y - width / 2.0, outer_z),
                     (outer_x, y + width / 2.0, outer_z), (0.22, 0.22), mats["timber"], holder)
        for side in (-1, 1):
            beam_between(f"{name}Brace_{side:+d}",
                         (inner_x - 0.04, y + side * (width * 0.42), wall_z - 0.12),
                         (outer_x, y + side * (width * 0.42), outer_z),
                         (0.15, 0.15), mats["timber"], holder,
                         family="service_canopy_brace")
        # Reusable role plaque and landing make each service entrance legible from the road.
        box(f"{name}RolePlaque", (0.07, min(width * 0.62, 1.75), 0.34),
            (BUILDING_W / 2.0 + 0.17, y, wall_z - 0.43), mats["roof"], holder,
            family="service_role_plaque", bevel=0.028, entrance_role=role,
            customizable_sign_face=True)
        box(f"{name}Landing", (projection + 0.55, width + 0.50, 0.12),
            (BUILDING_W / 2.0 + projection * 0.48, y, 0.06), mats["concrete"], holder,
            family="service_entry_landing", bevel=0.022, entrance_role=role)

    canopy("Employee", EMPLOYEE_DOOR_Y, 2.10, 1.20, 3.18, 2.82, "employee")
    canopy("Delivery", DELIVERY_DOOR_Y, 3.45, 1.75, 3.62, 3.08, "delivery")
    # Restrained brass-edged guards protect the wide delivery opening from carts and vans.
    for side in (-1, 1):
        cylinder(f"DeliveryBollard_{side:+d}", 0.095, 0.92,
                 (BUILDING_W / 2.0 + 1.68,
                  DELIVERY_DOOR_Y + side * (DELIVERY_DOOR_W / 2.0 + 0.34), 0.46),
                 mats["brass"], service, family="delivery_bollard", vertices=20,
                 entrance_role="delivery")


def build_chimney_and_fireplace(mats: dict[str, bpy.types.Material], root: bpy.types.Object) -> None:
    fireplace = group("StoneFireplaceAndChimney", root, component="fireplace_chimney")
    cx = 6.55
    cy = BACK_Y - 0.12
    # Stone core guarantees every reveal remains finished; raised fieldstone modules add relief.
    box("ChimneyCore", (2.35, 1.22, 8.80), (cx, cy + 0.32, 4.40), mats["stone_b"], fireplace,
        family="chimney_core", bevel=0.025)
    stone_veneer("ChimneyBackFace", "x", cy + 0.98, cx - 1.20, cx + 1.20,
                  0.10, 8.90, mats, fireplace, seed=810)
    stone_veneer("ChimneyFrontFace", "x", cy - 0.31, cx - 1.20, cx + 1.20,
                  0.10, 8.90, mats, fireplace, seed=815, surface_direction=-1.0)
    stone_veneer("ChimneyWestReturn", "y", cx - 1.18, cy - 0.28, cy + 0.95,
                  0.10, 8.90, mats, fireplace, seed=820)
    stone_veneer("ChimneyEastReturn", "y", cx + 1.18, cy - 0.28, cy + 0.95,
                  0.10, 8.90, mats, fireplace, seed=830)
    box("ChimneyCap", (2.78, 1.62, 0.22), (cx, cy + 0.34, 9.02), mats["stone_d"], fireplace,
        family="stone_chimney_cap", bevel=0.035)
    box("ChimneyFlue", (0.72, 0.72, 0.58), (cx, cy + 0.34, 9.42), mats["warm_charcoal"], fireplace,
        family="metal_chimney_flue", bevel=0.018)
    box("ChimneyRainCap", (1.00, 1.00, 0.11), (cx, cy + 0.34, 9.76), mats["roof_edge"], fireplace,
        family="metal_chimney_cap", bevel=0.022)
    # Interior hearth faces -Y into the open great room; no furniture or fire is baked.
    box("FireplaceHearth", (3.20, 1.18, 0.18), (cx, BACK_Y - 1.00, FLOOR_Z + 0.09), mats["stone_b"], fireplace,
        family="stone_fireplace_hearth", bevel=0.035)
    box("FireplaceSurround", (3.00, 0.72, 3.20), (cx, BACK_Y - 0.64, 1.72), mats["stone_a"], fireplace,
        family="stone_fireplace_surround", bevel=0.028)
    box("FireboxOpening", (1.62, 0.08, 1.28), (cx, BACK_Y - 1.015, 1.02), mats["warm_charcoal"], fireplace,
        family="firebox_recess", bevel=0.018)
    box("FireplaceMantel", (3.28, 0.54, 0.25), (cx, BACK_Y - 1.03, 2.72), mats["timber"], fireplace,
        family="heavy_timber_mantel", bevel=0.030)


def build_lamp(name: str, loc: tuple[float, float, float], mats: dict[str, bpy.types.Material],
               parent: bpy.types.Object, *, wall_axis: str = "x") -> None:
    holder = group(f"RusticLight_{name}", parent, reusable_architectural_module=True,
                   module_family="rustic_exterior_light")
    if wall_axis == "x":
        box(f"{name}_Backplate", (0.22, 0.09, 0.36), loc, mats["brass"], holder,
            family="rustic_light_backplate", bevel=0.022)
        arm_end = (loc[0], loc[1] - 0.30, loc[2] + 0.08)
    else:
        box(f"{name}_Backplate", (0.09, 0.22, 0.36), loc, mats["brass"], holder,
            family="rustic_light_backplate", bevel=0.022)
        arm_end = (loc[0] + 0.30, loc[1], loc[2] + 0.08)
    beam_between(f"{name}_Arm", (loc[0], loc[1], loc[2] + 0.08), arm_end,
                 (0.055, 0.055), mats["brass"], holder, family="rustic_light_arm")
    cylinder(f"{name}_Shade", 0.18, 0.18, (arm_end[0], arm_end[1], arm_end[2] - 0.10),
             mats["roof_edge"], holder, family="rustic_light_shade", vertices=24)
    A.sphere(f"{name}_Bulb", 0.075, (arm_end[0], arm_end[1], arm_end[2] - 0.23), mats["lamp"],
             segments=16, rings=8, parent=holder,
             properties={"module_family": "warm_lamp_bulb", "emissive_fixture": True})
    A.socket(f"Light_{name}", parent=holder,
             location=(arm_end[0], arm_end[1], arm_end[2] - 0.23),
             properties={"light_color": "#FFD59A", "range_m": 6.0, "intensity": 1.65})


def build_patio_and_routes(mats: dict[str, bpy.types.Material], root: bpy.types.Object) -> None:
    site = group("ModularSitework", root, component="sitework")
    # Rear patio overlooking the course, built as reusable 0.775 x 0.65 m pavers.
    patio_y = BACK_Y + PATIO_D / 2.0
    cols = 20
    rows = 8
    pw = PATIO_W / cols
    pd = PATIO_D / rows
    for row in range(rows):
        for col in range(cols):
            x = -PATIO_W / 2 + pw * (col + 0.5)
            y = BACK_Y + pd * (row + 0.5)
            mat = mats["paver"] if (row + col) % 5 else mats["stone_b"]
            box(f"PatioPaver_{row:02d}_{col:02d}", (pw - 0.025, pd - 0.025, 0.075),
                (x, y, 0.12), mat, site, family="patio_paver", bevel=0.014,
                patio_overlooks_course=True)
    # Broad covered course-view deck: separate piers, columns, roof, rails, and balusters.
    cover = group("CoveredCourseViewPatio", site, component="covered_course_view_patio",
                  reusable_architectural_module=True)
    cover_d = 4.55
    outer_y = BACK_Y + cover_d
    inner_z = EAVE_Z - 0.20
    outer_z = 3.52
    post_positions = (-7.18, -2.55, 2.55, 7.18)
    for index, x in enumerate(post_positions):
        stone_pier(f"PatioColumn_{index}_Base", x, outer_y - 0.18, FLOOR_Z, 1.02,
                   mats, cover, seed=760 + index, size=0.76, public_direction=1.0)
        box(f"PatioColumn_{index}_Post", (0.34, 0.34, outer_z - 0.96),
            (x, outer_y - 0.18, (outer_z + 0.96) * 0.5), mats["timber"], cover,
            family="heavy_timber_column", bevel=0.022, structural_post=True)
    beam_between("PatioOuterHeader", (post_positions[0], outer_y - 0.18, outer_z),
                 (post_positions[-1], outer_y - 0.18, outer_z),
                 (0.34, 0.34), mats["timber"], cover)
    for index, x in enumerate(post_positions):
        if index > 0:
            beam_between(f"PatioKneeBrace_{index}_W", (x, outer_y - 0.18, outer_z - 0.92),
                         (x - 0.72, outer_y - 0.18, outer_z),
                         (0.17, 0.17), mats["timber"], cover)
        if index < len(post_positions) - 1:
            beam_between(f"PatioKneeBrace_{index}_E", (x, outer_y - 0.18, outer_z - 0.92),
                         (x + 0.72, outer_y - 0.18, outer_z),
                         (0.17, 0.17), mats["timber"], cover)
    patio_slope = math.hypot(cover_d + 0.45, inner_z - outer_z)
    patio_angle = math.atan2(inner_z - outer_z, cover_d + 0.45)
    box("PatioStandingSeamRoof", (PATIO_W + 0.70, patio_slope, 0.105),
        (0.0, BACK_Y + cover_d * 0.5, (inner_z + outer_z) * 0.5),
        mats["roof"], cover, family="standing_seam_patio_roof",
        rotation=(-patio_angle, 0.0, 0.0), bevel=0.012)
    for seam_index, x in enumerate([
        -PATIO_W / 2.0 + 0.24 + i * 0.48 for i in range(int(PATIO_W / 0.48) + 1)
    ]):
        box(f"PatioRoofSeam_{seam_index:02d}", (0.036, patio_slope, 0.047),
            (x, BACK_Y + cover_d * 0.5, (inner_z + outer_z) * 0.5 + 0.06),
            mats["roof_edge"], cover, family="standing_seam_rib",
            rotation=(-patio_angle, 0.0, 0.0), bevel=0.005)
    # Guard rails stop short of the 6.4 m course steps, preserving a generous central opening.
    rail_z = 1.08
    for side, (x0, x1) in enumerate(((-7.35, -3.35), (3.35, 7.35))):
        box(f"PatioOuterRail_{side}", (x1 - x0, 0.13, 0.14),
            ((x0 + x1) * 0.5, BACK_Y + PATIO_D - 0.28, rail_z),
            mats["timber"], cover, family="patio_guardrail", bevel=0.018)
        baluster_x = x0 + 0.25
        baluster_index = 0
        while baluster_x < x1 - 0.15:
            box(f"PatioBaluster_{side}_{baluster_index:02d}", (0.075, 0.075, 0.80),
                (baluster_x, BACK_Y + PATIO_D - 0.28, 0.66),
                mats["timber"], cover, family="patio_baluster", bevel=0.010)
            baluster_x += 0.46
            baluster_index += 1
    # Broad course-view steps down from the patio.
    for index in range(3):
        box(f"PatioCourseStep_{index}", (6.40 - index * 0.38, 0.48, 0.11),
            (0.0, BACK_Y + PATIO_D + 0.18 + index * 0.42, 0.08 - index * 0.065),
            mats["stone_b"], site, family="patio_step", bevel=0.022)
    # Front walk and accessible apron.
    for index in range(6):
        box(f"FrontSidewalk_{index}", (2.35, 1.20, 0.085),
            (MAIN_DOOR_X, PORCH_FRONT_Y - 1.05 - index * 1.18, 0.045),
            mats["concrete"], site, family="sidewalk_module", bevel=0.018,
            accessible_route=True)
    # Employee sidewalk turns along the east facade to the service road.
    for index, y in enumerate([-5.55, -4.35, -3.15, -1.95, -0.75, 0.45, 1.65, 2.85, 4.05]):
        box(f"EmployeeSidewalk_{index}", (1.35, 1.16, 0.085),
            (BUILDING_W / 2 + 0.82, y, 0.045), mats["concrete"], site,
            family="sidewalk_module", bevel=0.018, employee_route=True)
    # Six overlapping reusable 8 m road panels create a real maintenance/delivery approach.
    road_x = BUILDING_W / 2 + 5.10
    for index in range(6):
        y = -17.5 + index * 7.85
        box(f"MaintenanceRoadSegment_{index}", (6.20, 8.10, 0.08),
            (road_x, y, 0.015), mats["road"], site, family="maintenance_road_module",
            bevel=0.012, heavy_vehicle_route=True, module_length_m=8.0)
        for side in (-1, 1):
            box(f"MaintenanceRoadShoulder_{index}_{side:+d}", (0.92, 8.10, 0.075),
                (road_x + side * 3.48, y, -0.002), mats["road_edge"], site,
                family="gravel_road_shoulder", bevel=0.045,
                drainage_edge=True)
    # Delivery apron at the large service door.
    box("DeliveryApron", (7.20, 7.00, 0.11),
        (BUILDING_W / 2 + 3.45, DELIVERY_DOOR_Y, 0.045), mats["road"], site,
        family="delivery_apron", bevel=0.018, delivery_vehicle_turning_area=True)


def build_boulder(name: str, loc: tuple[float, float, float], scale: tuple[float, float, float],
                  mat: bpy.types.Material, parent: bpy.types.Object, seed: int) -> None:
    rng = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0, location=loc)
    obj = bpy.context.object
    obj.name = f"MESH_{name}"
    # Deterministic vertex variation prevents the landscaping from reading as scaled spheres.
    for vertex in obj.data.vertices:
        direction = vertex.co.normalized()
        vertex.co += direction * rng.uniform(-0.18, 0.16)
        # A flattened bearing surface and chipped crown make the rock sit in the terrain.
        vertex.co.z = max(-0.66, vertex.co.z)
        if vertex.co.z > 0.58:
            vertex.co.z *= rng.uniform(0.82, 0.96)
    obj.scale = scale
    obj.rotation_euler = (rng.uniform(-0.18, 0.18), rng.uniform(-0.18, 0.18), rng.uniform(0.0, math.tau))
    A.finish_mesh(obj, mat, bevel=0.018, bevel_segments=1, uv="smart", smooth=False)
    A.parent_keep_world(obj, parent)
    mark_module(obj, "mountain_boulder", scale, original_project_geometry=True)


def pine_whorl(name: str, loc: tuple[float, float, float], radius: float, z: float,
               mat: bpy.types.Material, parent: bpy.types.Object,
               rng: random.Random, branches: int) -> None:
    """Create a single faceted mesh containing a full radial whorl and forked tips."""
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int]] = []

    def cluster(angle: float, start_r: float, end_r: float, width: float,
                thickness: float, start_z: float, end_z: float) -> None:
        direction = Vector((math.cos(angle), math.sin(angle), 0.0))
        side = Vector((-math.sin(angle), math.cos(angle), 0.0))
        mid_r = (start_r + end_r) * 0.55
        mid_z = (start_z + end_z) * 0.52
        base = direction * start_r
        left = direction * mid_r + side * width
        tip = direction * end_r
        right = direction * mid_r - side * width
        points = [
            (base.x, base.y, start_z),
            (left.x, left.y, mid_z),
            (tip.x, tip.y, end_z),
            (right.x, right.y, mid_z),
            (direction.x * mid_r, direction.y * mid_r, mid_z + thickness),
            (direction.x * mid_r, direction.y * mid_r, mid_z - thickness),
        ]
        offset = len(vertices)
        vertices.extend(points)
        for edge in range(4):
            next_edge = (edge + 1) % 4
            faces.append((offset + 4, offset + edge, offset + next_edge))
            faces.append((offset + 5, offset + next_edge, offset + edge))

    base_rotation = rng.uniform(0.0, math.tau)
    for branch in range(branches):
        angle = base_rotation + math.tau * branch / branches + rng.uniform(-0.08, 0.08)
        branch_radius = radius * rng.uniform(0.90, 1.08)
        drop = -radius * rng.uniform(0.08, 0.16)
        cluster(angle, radius * 0.06, branch_radius, radius * 0.20,
                radius * 0.105, 0.02, drop)
        # Two forked secondary sprays remove the stacked-cone silhouette at player distance.
        for fork_sign in (-1, 1):
            cluster(angle + fork_sign * rng.uniform(0.20, 0.30),
                    radius * 0.42, branch_radius * rng.uniform(0.76, 0.90),
                    radius * 0.115, radius * 0.070,
                    drop * 0.40 + radius * 0.025, drop * 0.82)

    mesh = bpy.data.meshes.new(f"MESH_{name}_DATA")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(f"MESH_{name}", mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = (loc[0], loc[1], loc[2] + z)
    A.finish_mesh(obj, mat, bevel=0.009, bevel_segments=1, uv="smart", smooth=False)
    A.parent_keep_world(obj, parent)
    mark_module(obj, "pine_canopy", (radius * 2.0, radius * 2.0, radius * 0.34),
                procedural_branch_whorl=True)


def build_pine(name: str, loc: tuple[float, float, float], height: float,
               mats: dict[str, bpy.types.Material], parent: bpy.types.Object) -> None:
    pine = group(f"Pine_{name}", parent, reusable_architectural_module=True,
                 module_family="mountain_pine", nominal_height_m=height)
    rng = random.Random(1200 + sum(ord(char) for char in name))
    trunk_h = height * 0.88
    cone(f"{name}_Trunk", height * 0.045, height * 0.020, trunk_h,
         (loc[0], loc[1], loc[2] + trunk_h / 2), mats["pine_trunk"], pine,
         family="pine_trunk", vertices=18)
    for collar in range(3):
        cylinder(f"{name}_BarkCollar_{collar}", height * (0.047 - collar * 0.005), 0.10,
                 (loc[0], loc[1], loc[2] + height * (0.18 + collar * 0.21)),
                 mats["cedar_dark"], pine, family="pine_bark_collar", vertices=18)
    tiers = 9
    for tier in range(tiers):
        normalized = tier / (tiers - 1)
        z = height * (0.24 + tier * 0.084)
        radius = height * (0.245 * (1.0 - normalized) + 0.052)
        pine_whorl(f"{name}_BranchWhorl_{tier}", loc, radius, z,
                   mats["pine_needles_light" if tier in (2, 5, 8) else "pine_needles"],
                   pine, rng, 7 if tier < 4 else 6)


def landscape_bed(name: str, x: float, y: float, sx: float, sy: float,
                  mat: bpy.types.Material, parent: bpy.types.Object, seed: int) -> None:
    rng = random.Random(seed)
    sides = 18
    top_ring: list[tuple[float, float, float]] = []
    bottom_ring: list[tuple[float, float, float]] = []
    for index in range(sides):
        angle = math.tau * index / sides
        jitter = rng.uniform(0.84, 1.08)
        px = math.cos(angle) * sx * 0.5 * jitter
        py = math.sin(angle) * sy * 0.5 * jitter
        top_ring.append((px, py, rng.uniform(0.02, 0.08)))
        bottom_ring.append((px * 0.96, py * 0.96, -0.10))
    vertices = [(0.0, 0.0, 0.07)] + top_ring + bottom_ring
    faces: list[tuple[int, ...]] = []
    for index in range(sides):
        nxt = (index + 1) % sides
        faces.append((0, 1 + index, 1 + nxt))
        faces.append((1 + index, 1 + sides + index, 1 + sides + nxt, 1 + nxt))
    mesh = bpy.data.meshes.new(f"MESH_{name}_DATA")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(f"MESH_{name}", mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = (x, y, 0.08)
    A.finish_mesh(obj, mat, bevel=0.055, bevel_segments=2, uv="smart", smooth=False)
    A.parent_keep_world(obj, parent)
    mark_module(obj, "landscape_island", (sx, sy, 0.22), irregular_mountain_berm=True)


def build_landscape(mats: dict[str, bpy.types.Material], root: bpy.types.Object) -> None:
    landscape = group("MountainLandscape", root, component="landscape")
    # Landscape islands hold the architecture in mountain terrain without masking the game ground.
    for index, (x, y, sx, sy) in enumerate([
        (-19.0, -10.8, 5.5, 4.2), (-18.8, 3.2, 5.0, 4.4),
        (-17.3, 11.2, 5.8, 4.2), (11.8, 13.3, 5.0, 3.8),
        (8.8, -12.4, 4.4, 3.2),
    ]):
        landscape_bed(f"LandscapeIsland_{index}", x, y, sx, sy,
                      mats["grass"], landscape, 1300 + index)
    boulders = [
        (-18.2, -10.7, 1.75, 1.20, 0.92), (-20.0, -9.8, 1.10, 0.82, 0.68),
        (-18.2, 3.0, 1.85, 1.25, 1.02), (-20.0, 4.1, 1.15, 0.90, 0.72),
        (-16.8, 11.0, 1.55, 1.08, 0.82), (-18.8, 12.1, 1.05, 0.78, 0.64),
        (11.2, 13.0, 1.45, 1.04, 0.78), (13.0, 13.6, 0.95, 0.72, 0.58),
        (8.4, -12.3, 1.30, 0.92, 0.72), (10.1, -11.8, 0.92, 0.68, 0.55),
    ]
    stone_mats = [mats["stone_a"], mats["stone_b"], mats["stone_c"], mats["stone_d"]]
    for index, (x, y, sx, sy, sz) in enumerate(boulders):
        build_boulder(f"Boulder_{index:02d}", (x, y, sz * 0.35), (sx, sy, sz),
                      stone_mats[index % len(stone_mats)], landscape, 900 + index)
    pines = [
        (-19.7, -11.5, 9.2), (-19.5, 2.7, 10.4), (-17.8, 11.9, 11.0),
        (10.8, 14.0, 9.1), (14.2, 12.6, 10.2), (8.9, -13.4, 8.7),
    ]
    for index, (x, y, height) in enumerate(pines):
        build_pine(f"Pine_{index:02d}", (x, y, 0.05), height, mats, landscape)


def build_lighting(mats: dict[str, bpy.types.Material], root: bpy.types.Object) -> None:
    lights = group("RusticArchitecturalLighting", root, component="lighting")
    for name, x in (("MainWest", MAIN_DOOR_X - 1.35), ("MainEast", MAIN_DOOR_X + 1.35),
                    ("GreatRoom", 7.55)):
        build_lamp(name, (x, FRONT_Y - WALL_T / 2 - 0.04, 2.55), mats, lights)
    build_lamp("Employee", (BUILDING_W / 2 + WALL_T / 2 + 0.04, EMPLOYEE_DOOR_Y, 2.55),
               mats, lights, wall_axis="y")
    build_lamp("Delivery", (BUILDING_W / 2 + WALL_T / 2 + 0.04, DELIVERY_DOOR_Y, 2.75),
               mats, lights, wall_axis="y")
    # Warm pendant cages are architectural fixtures; the open floor remains empty.
    for index, x in enumerate((-4.20, -0.50, 3.20)):
        cylinder(f"PorchPendant_{index}_Stem", 0.018, 0.55,
                 (x, FRONT_Y - PORCH_D * 0.56, 3.34), mats["brass"], lights,
                 family="pendant_stem", vertices=12)
        A.torus(f"PorchPendant_{index}_Cage", 0.18, 0.018,
                (x, FRONT_Y - PORCH_D * 0.56, 3.02), mats["brass"],
                rotation=(math.pi / 2.0, 0.0, 0.0), major_segments=20, minor_segments=8,
                parent=lights, properties={"module_family": "rustic_pendant_cage",
                                           "reusable_architectural_module": True})
        A.sphere(f"PorchPendant_{index}_Bulb", 0.075,
                 (x, FRONT_Y - PORCH_D * 0.56, 3.02), mats["lamp"],
                 segments=16, rings=8, parent=lights,
                 properties={"module_family": "warm_lamp_bulb", "emissive_fixture": True})


def build_collisions(mats: dict[str, bpy.types.Material], root: bpy.types.Object) -> None:
    collision = group("SimplifiedCollision", root, collision_authority=True)
    mat = mats["collision"]
    # Simple convex wall runs preserve all three service apertures.
    front_gaps = [
        (MAIN_DOOR_X - MAIN_DOOR_W / 2, MAIN_DOOR_X + MAIN_DOOR_W / 2),
    ]
    for index, (start, end) in enumerate(subtract_spans(-BUILDING_W / 2, BUILDING_W / 2, front_gaps)):
        obj = A.collision_box(f"FrontWall_{index}", (end - start, WALL_T + 0.08, EAVE_Z),
                              ((start + end) / 2, FRONT_Y, EAVE_Z / 2), parent=collision, material=mat)
        obj["collision_role"] = "wall"
    east_gaps = [
        (EMPLOYEE_DOOR_Y - 0.50, EMPLOYEE_DOOR_Y + 0.50),
        (DELIVERY_DOOR_Y - DELIVERY_DOOR_W / 2, DELIVERY_DOOR_Y + DELIVERY_DOOR_W / 2),
    ]
    for index, (start, end) in enumerate(subtract_spans(-BUILDING_D / 2, BUILDING_D / 2, east_gaps)):
        obj = A.collision_box(f"EastWall_{index}", (WALL_T + 0.08, end - start, EAVE_Z),
                              (BUILDING_W / 2, (start + end) / 2, EAVE_Z / 2), parent=collision, material=mat)
        obj["collision_role"] = "wall"
    for side, x in (("West", -BUILDING_W / 2),):
        obj = A.collision_box(f"{side}Wall", (WALL_T + 0.08, BUILDING_D, EAVE_Z),
                              (x, 0.0, EAVE_Z / 2), parent=collision, material=mat)
        obj["collision_role"] = "wall"
    back_gaps = [
        (PATIO_DOOR_X - PATIO_DOOR_W / 2.0, PATIO_DOOR_X + PATIO_DOOR_W / 2.0),
    ]
    for index, (start, end) in enumerate(subtract_spans(-BUILDING_W / 2, BUILDING_W / 2, back_gaps)):
        obj = A.collision_box(f"BackWall_{index}", (end - start, WALL_T + 0.08, EAVE_Z),
                              ((start + end) / 2.0, BACK_Y, EAVE_Z / 2),
                              parent=collision, material=mat)
        obj["collision_role"] = "wall"
    for index, x in enumerate((-8.25, -4.35, 2.85, 7.25)):
        A.collision_box(f"PorchPost_{index}", (0.48, 0.48, 3.55),
                        (x, PORCH_FRONT_Y + 0.28, 1.78), parent=collision, material=mat)
    for index, y in enumerate((FRONT_Y + 0.38, FRONT_Y + CARTPORT_D - 0.18)):
        A.collision_box(f"CartportPost_{index}", (0.52, 0.52, 3.65),
                        (-BUILDING_W / 2 - CARTPORT_W + 0.32, y, 1.83), parent=collision, material=mat)
    A.collision_box("Chimney", (2.55, 1.55, 9.1), (6.55, BACK_Y + 0.25, 4.55),
                    parent=collision, material=mat)


def build_markers(root: bpy.types.Object) -> None:
    for name, loc, props in [
        ("PLACEMENT", (0.0, 0.0, 0.0), {"anchor": "building_center"}),
        ("MainEntrance", (MAIN_DOOR_X, FRONT_Y, FLOOR_Z), {"entrance_type": "public"}),
        ("EmployeeEntrance", (BUILDING_W / 2, EMPLOYEE_DOOR_Y, FLOOR_Z), {"entrance_type": "employee"}),
        ("DeliveryEntrance", (BUILDING_W / 2, DELIVERY_DOOR_Y, FLOOR_Z), {"entrance_type": "delivery"}),
        ("PatioEntrance", (PATIO_DOOR_X, BACK_Y, FLOOR_Z), {"entrance_type": "course_patio"}),
        ("PatioCourseView", (0.0, BACK_Y + PATIO_D, 0.15), {"view": "course"}),
        ("FurnishingGridOrigin", (0.0, 0.0, FLOOR_Z + 0.035), {"grid_m": 0.25}),
        ("Fireplace", (6.55, BACK_Y - 1.20, FLOOR_Z), {"feature": "fireplace"}),
        ("MaintenanceRoad", (BUILDING_W / 2 + 5.1, DELIVERY_DOOR_Y, 0.06), {"route": "maintenance"}),
    ]:
        A.socket(name, parent=root, location=loc, properties=props)


def build_asset() -> bpy.types.Object:
    A.reset_scene(seed=20260720)
    scene = bpy.context.scene
    scene["asset_pipeline"] = "Golf Flipper Modular Architecture"
    scene["architectural_standard"] = "metric_real_world"
    scene["interior_policy"] = "intentionally empty; player furnishes"
    root = root_asset()
    mats = custom_materials()
    build_shell(mats, root)
    build_roof_and_trusses(mats, root)
    build_porch(mats, root)
    build_cartport(mats, root)
    build_service_architecture(mats, root)
    build_chimney_and_fireplace(mats, root)
    build_patio_and_routes(mats, root)
    build_landscape(mats, root)
    build_lighting(mats, root)
    build_collisions(mats, root)
    build_markers(root)
    return root


def audit(root: bpy.types.Object) -> dict[str, object]:
    nodes = A.descendants(root)
    visible = [obj for obj in nodes if obj.type == "MESH" and not obj.get("collision_proxy")]
    collisions = [obj for obj in nodes if obj.type == "MESH" and obj.get("collision_proxy")]
    materials = {mat.name for obj in visible for mat in obj.data.materials if mat}
    triangles = 0
    unapplied = []
    missing_uv = []
    non_modular = []
    for obj in visible:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        if any(abs(value - 1.0) > 1e-5 for value in obj.scale) or any(abs(value) > 1e-5 for value in obj.rotation_euler):
            unapplied.append(obj.name)
        if not obj.data.uv_layers:
            missing_uv.append(obj.name)
        if not obj.get("module_family"):
            non_modular.append(obj.name)
    required = {
        "heavy_timber": any(obj.get("module_family") == "heavy_timber" for obj in visible),
        "natural_stone": any(obj.get("module_family") == "natural_fieldstone" for obj in visible),
        "cedar": any(obj.get("module_family") == "cedar_wall_panel" for obj in visible),
        "standing_seam_roof": any(obj.get("module_family") == "standing_seam_roof_panel" for obj in visible),
        "windows": any(obj.get("module_family") == "window_glazing" for obj in visible),
        "doors": len([obj for obj in nodes if obj.name.startswith("PIVOT_")]) >= 5,
        "porch": any(obj.get("module_family") == "porch_deck_board" for obj in visible),
        "cart_parking": len([obj for obj in nodes if obj.name.startswith("SOCKET_GolfCartBay")]) == 2,
        "chimney": any(obj.get("module_family") == "chimney_core" for obj in visible),
        "patio": any(obj.get("module_family") == "patio_paver" for obj in visible),
        "maintenance_road": any(obj.get("module_family") == "maintenance_road_module" for obj in visible),
        "pines": any(obj.get("module_family") == "pine_canopy" for obj in visible),
        "boulders": any(obj.get("module_family") == "mountain_boulder" for obj in visible),
        "rustic_lighting": any(obj.get("module_family") == "rustic_light_backplate" for obj in visible),
        "empty_interior": root.get("interior_policy") == "INTENTIONALLY_EMPTY_PLAYER_FURNISHES",
    }
    bounds = A.world_bounds(root)
    report = {
        "ok": not unapplied and not missing_uv and not non_modular and bool(collisions) and all(required.values()),
        "sourceLicense": "Project-owned; no external assets or textures",
        "conditionedFootprintMeters": [BUILDING_W, BUILDING_D],
        "conditionedAreaSquareMeters": round(BUILDING_W * BUILDING_D, 3),
        "conditionedAreaSquareFeet": round(BUILDING_W * BUILDING_D * 10.76391041671, 2),
        "overallBoundsMeters": bounds.to_dict(),
        "nodeCount": len(nodes),
        "visibleMeshCount": len(visible),
        "collisionMeshCount": len(collisions),
        "materialCount": len(materials),
        "triangleCount": triangles,
        "pivotCount": len([obj for obj in nodes if obj.name.startswith("PIVOT_")]),
        "socketCount": len([obj for obj in nodes if obj.name.startswith("SOCKET_")]),
        "unappliedTransforms": unapplied,
        "missingUvs": missing_uv,
        "missingModuleMetadata": non_modular,
        "requirements": required,
    }
    return report


def main() -> None:
    options = A.parse_asset_cli()
    root = build_asset()
    report = audit(root)
    print("MOUNTAIN_CLUBHOUSE_AUDIT|" + json.dumps(report, sort_keys=True))
    if options.strict and not report["ok"]:
        raise RuntimeError("mountain clubhouse production audit failed")
    SOURCE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CANONICAL_PATH.parent.mkdir(parents=True, exist_ok=True)
    RUNTIME_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    if options.save_source:
        A.save_blend(SOURCE_PATH)
    if options.export_glbs:
        A.export_glb(CANONICAL_PATH, root, include_animations=True)
        A.export_glb(RUNTIME_PATH, root, include_animations=True)
    if options.preview:
        A.render_studio_preview(root, PREVIEW_PATH, width=1600, height=1000,
                                azimuth_degrees=32.0, elevation_degrees=22.0)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"REPORT|{REPORT_PATH}")


if __name__ == "__main__":
    main()
