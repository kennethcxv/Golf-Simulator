"""Build the modular 4,000 sq ft Mediterranean resort clubhouse.

Original project-owned geometry. No downloaded or generated mesh inputs.

Run from the repository root with Blender 5.1::

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
      --background --factory-startup \
      --python tools/blender/build_resort_clubhouse_4000.py

The source uses metres, Blender Z-up, and a deliberately modular hierarchy.
Blender's glTF exporter converts it to Three.js Y-up coordinates. The complete
assembled site is exported as one GLB for efficient loading; every architectural
and site component remains a separately named, reusable object in the .blend.
Repeated modules share mesh datablocks so future expansions can be edited at the
master level without manually revising every placement.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


REPO = Path(__file__).resolve().parents[2]
SOURCE_DIR = REPO / "asset_sources" / "blender" / "clubhouse_resort_4000"
CANONICAL_DIR = REPO / "Assets" / "clubhouse_resort_4000" / "glb"
RUNTIME_DIR = REPO / "vendor" / "models" / "clubhouse"
QA_DIR = REPO / "qa" / "clubhouse_resort" / "blender"
SOURCE_PATH = SOURCE_DIR / "clubhouse_resort_4000.blend"
CANONICAL_GLB = CANONICAL_DIR / "clubhouse_resort_4000.glb"
RUNTIME_GLB = RUNTIME_DIR / "clubhouse_resort_4000.glb"
PREVIEW_PATH = QA_DIR / "clubhouse_resort_4000_preview.png"
PREVIEW_FRONT_PATH = QA_DIR / "clubhouse_resort_4000_front.png"
PREVIEW_REAR_PATH = QA_DIR / "clubhouse_resort_4000_rear_patio.png"
PREVIEW_INTERIOR_PATH = QA_DIR / "clubhouse_resort_4000_empty_interior.png"
MANIFEST_PATH = QA_DIR / "clubhouse_resort_4000_manifest.json"

# 24.0 x 15.5 m = 372 m2 = 4,004.17 sq ft.
BUILDING_W = 24.0
BUILDING_D = 15.5
BUILDING_AREA_M2 = BUILDING_W * BUILDING_D
BUILDING_AREA_SQFT = BUILDING_AREA_M2 * 10.7639104167
FLOOR_Z = 0.30
WALL_H = 4.45
WALL_T = 0.25
ROOF_EAVE_Z = 4.58
ROOF_RIDGE_Z = 7.18
FRONT_Y = -BUILDING_D / 2.0
BACK_Y = BUILDING_D / 2.0


def ensure_dirs() -> None:
    for directory in (SOURCE_DIR, CANONICAL_DIR, RUNTIME_DIR, QA_DIR):
        directory.mkdir(parents=True, exist_ok=True)


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                       bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            datablocks.remove(datablock)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.025, 0.035, 0.045)


def material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    roughness: float = 0.6,
    metallic: float = 0.0,
    emission: tuple[float, float, float] | None = None,
    emission_strength: float = 0.0,
    alpha: float = 1.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    mat.surface_render_method = "DITHERED" if alpha < 1.0 else "DITHERED"
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Alpha"].default_value = alpha
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    mat["project_owned"] = True
    mat["palette"] = "Pinehollow resort"
    return mat


def palette() -> dict[str, bpy.types.Material]:
    return {
        "stucco": material("M_Stucco_WarmCream", (1.0, 0.86, 0.60, 1.0), roughness=0.86,
                            emission=(0.30, 0.18, 0.07), emission_strength=0.10),
        "stucco_light": material("M_Stucco_SunlitCream", (1.0, 0.96, 0.79, 1.0), roughness=0.83,
                                  emission=(0.28, 0.18, 0.08), emission_strength=0.07),
        "stucco_shadow": material("M_Stucco_Reveal", (0.48, 0.42, 0.32, 1.0), roughness=0.92),
        "clay": material("M_ClayTile_Terracotta", (0.52, 0.14, 0.045, 1.0), roughness=0.82),
        "clay_light": material("M_ClayTile_Sunwashed", (0.67, 0.25, 0.075, 1.0), roughness=0.80),
        "clay_dark": material("M_ClayTile_DeepTerracotta", (0.34, 0.070, 0.025, 1.0), roughness=0.84),
        "stone": material("M_Stone_WarmLimestone", (0.64, 0.54, 0.40, 1.0), roughness=0.91),
        "stone_light": material("M_Stone_Cap", (0.80, 0.70, 0.54, 1.0), roughness=0.86),
        "green": material("M_DeepGolfGreen", (0.025, 0.15, 0.085, 1.0), roughness=0.65),
        "sage": material("M_MutedSage", (0.29, 0.39, 0.29, 1.0), roughness=0.82),
        "walnut": material("M_MediumWalnut", (0.22, 0.095, 0.040, 1.0), roughness=0.66),
        "oak": material("M_NaturalOak", (0.56, 0.34, 0.16, 1.0), roughness=0.74),
        "charcoal": material("M_WarmCharcoal", (0.055, 0.060, 0.055, 1.0), roughness=0.54, metallic=0.14),
        "drive": material("M_MotorCourt_WarmAggregate", (0.16, 0.145, 0.115, 1.0), roughness=0.92),
        "brass": material("M_RestrainedBrass", (0.47, 0.28, 0.075, 1.0), roughness=0.35, metallic=0.72),
        "glass": material("M_WindowGlass", (0.19, 0.33, 0.34, 0.28), roughness=0.17, alpha=0.28),
        "water": material("M_Water_ResortBlue", (0.055, 0.34, 0.42, 0.52), roughness=0.12, metallic=0.05,
                          emission=(0.025, 0.12, 0.16), emission_strength=0.10, alpha=0.52),
        "paver": material("M_Paver_WarmStone", (0.67, 0.58, 0.44, 1.0), roughness=0.94),
        "mulch": material("M_Mulch", (0.095, 0.050, 0.025, 1.0), roughness=1.0),
        "leaf": material("M_PalmLeaf", (0.035, 0.225, 0.070, 1.0), roughness=0.91),
        "leaf_light": material("M_PalmLeafLight", (0.080, 0.340, 0.120, 1.0), roughness=0.9),
        "flower": material("M_Bougainvillea", (0.55, 0.055, 0.12, 1.0), roughness=0.92),
        "interior": material("M_InteriorWarmPlaster", (1.0, 0.98, 0.92, 1.0), roughness=0.9,
                             emission=(0.35, 0.30, 0.22), emission_strength=0.30),
        "interior_floor": material("M_InteriorUnfurnishedStone", (0.88, 0.78, 0.63, 1.0), roughness=0.76,
                                   emission=(0.20, 0.15, 0.09), emission_strength=0.16),
        "light": material("M_WarmArchitecturalGlow", (0.62, 0.42, 0.16, 1.0), roughness=0.36,
                          emission=(1.0, 0.48, 0.15), emission_strength=2.3),
        "collision": material("M_COLLISION_HIDDEN", (1.0, 0.0, 1.0, 0.0), roughness=1.0, alpha=0.0),
    }


def empty(name: str, parent: bpy.types.Object | None = None, **props: object) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.18
    if parent:
        obj.parent = parent
    for key, value in props.items():
        obj[key] = value
    return obj


def finish_mesh(obj: bpy.types.Object, *, bevel: float = 0.0, smooth: bool = False) -> bpy.types.Object:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    obj.select_set(False)
    obj["transforms_applied"] = True
    obj["modular"] = True
    return obj


def box(
    name: str,
    dims: tuple[float, float, float],
    loc: tuple[float, float, float],
    mat: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    bevel: float = 0.02,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    props: dict[str, object] | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    obj.data.materials.append(mat)
    obj.parent = parent
    for key, value in (props or {}).items():
        obj[key] = value
    return finish_mesh(obj, bevel=bevel)


def cylinder(
    name: str,
    radius: float,
    depth: float,
    loc: tuple[float, float, float],
    mat: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    vertices: int = 24,
    bevel: float = 0.015,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    obj.parent = parent
    return finish_mesh(obj, bevel=bevel, smooth=True)


def oval_bed(
    name: str,
    radius_x: float,
    radius_y: float,
    depth: float,
    loc: tuple[float, float, float],
    mat: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    """Low, softly beveled landscape island with fully applied transforms."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=1.0, depth=depth, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (radius_x, radius_y, 1.0)
    obj.data.materials.append(mat)
    obj.parent = parent
    return finish_mesh(obj, bevel=min(0.10, depth * 0.34), smooth=True)


def oval_ring(
    name: str,
    outer_x: float,
    outer_y: float,
    inner_x: float,
    inner_y: float,
    depth: float,
    loc: tuple[float, float, float],
    mat: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    segments: int = 72,
) -> bpy.types.Object:
    """Raised elliptical ring for motor courts and crisp limestone bed curbs."""
    if inner_x <= 0 or inner_y <= 0 or inner_x >= outer_x or inner_y >= outer_y:
        raise ValueError(f"{name} requires a positive inner ellipse smaller than its outer ellipse")
    z0 = -depth / 2.0
    z1 = depth / 2.0
    verts: list[tuple[float, float, float]] = []
    for index in range(segments):
        angle = math.tau * index / segments
        c, s = math.cos(angle), math.sin(angle)
        verts.extend((
            (outer_x * c, outer_y * s, z0),
            (outer_x * c, outer_y * s, z1),
            (inner_x * c, inner_y * s, z1),
            (inner_x * c, inner_y * s, z0),
        ))
    faces: list[tuple[int, ...]] = []
    for index in range(segments):
        nxt = (index + 1) % segments
        a = index * 4
        b = nxt * 4
        faces.extend((
            (a + 1, b + 1, b + 2, a + 2),
            (a, b, b + 1, a + 1),
            (a + 2, b + 2, b + 3, a + 3),
            (a + 3, b + 3, b, a),
        ))
    obj = mesh_object(name, verts, faces, mat, parent, smooth=True)
    obj.location = loc
    obj["applied_elliptical_ring"] = True
    return obj


def cylinder_between(name: str, start: tuple[float, float, float], end: tuple[float, float, float],
                     radius: float, mat: bpy.types.Material, parent: bpy.types.Object,
                     *, vertices: int = 10) -> bpy.types.Object:
    a = Vector(start)
    b = Vector(end)
    direction = b - a
    if direction.length <= 1e-6:
        raise ValueError(f"{name} requires distinct endpoints")
    rotation = Vector((0.0, 0.0, 1.0)).rotation_difference(direction.normalized()).to_euler()
    return cylinder(name, radius, direction.length, tuple((a + b) * 0.5), mat, parent,
                    vertices=vertices, bevel=radius * 0.22, rotation=tuple(rotation))


def barrel_roof_tile(name: str, radius: float, depth: float, loc: tuple[float, float, float],
                     mat: bpy.types.Material, parent: bpy.types.Object,
                     *, rotation: tuple[float, float, float], segments: int = 10) -> bpy.types.Object:
    """Open-backed half-round Spanish tile; no solid pipe end caps."""
    verts: list[tuple[float, float, float]] = []
    for z in (-depth / 2.0, depth / 2.0):
        for index in range(segments + 1):
            angle = math.pi * index / segments
            verts.append((math.cos(angle) * radius, math.sin(angle) * radius, z))
    ring = segments + 1
    faces = []
    for index in range(segments):
        face = (index, index + 1, ring + index + 1, ring + index)
        faces.append(face)
    tile = mesh_object(name, verts, faces, mat, parent, smooth=True)
    tile.location = loc
    tile.rotation_euler = rotation
    bpy.context.view_layer.objects.active = tile
    tile.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    tile.select_set(False)
    return tile


def barrel_roof_tile_vector(name: str, radius: float, depth: float, loc: tuple[float, float, float],
                            axis: Vector, normal: Vector, mat: bpy.types.Material,
                            parent: bpy.types.Object, *, segments: int = 10) -> bpy.types.Object:
    """Half-round tile with explicit slope axis/normal for triangular hip ends."""
    axis = axis.normalized()
    normal = normal.normalized()
    side = normal.cross(axis).normalized()
    verts: list[tuple[float, float, float]] = []
    for along in (-depth / 2.0, depth / 2.0):
        center = axis * along
        for index in range(segments + 1):
            angle = math.pi * index / segments
            point = center + side * (math.cos(angle) * radius) + normal * (math.sin(angle) * radius)
            verts.append(tuple(point))
    ring = segments + 1
    faces = []
    for index in range(segments):
        face = (index, index + 1, ring + index + 1, ring + index)
        faces.append(face)
    tile = mesh_object(name, verts, faces, mat, parent, smooth=True)
    tile.location = loc
    return tile


def uv_smart(obj: bpy.types.Object) -> None:
    if obj.type != "MESH":
        return
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)


def mesh_object(
    name: str,
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    mat: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    bevel: float = 0.0,
    smooth: bool = False,
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name + "_DATA")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    obj.parent = parent
    finish_mesh(obj, bevel=bevel, smooth=smooth)
    uv_smart(obj)
    return obj


def linked_copy_tree(source: bpy.types.Object, name: str, parent: bpy.types.Object,
                     location: tuple[float, float, float], rotation_z: float = 0.0) -> bpy.types.Object:
    mapping: dict[bpy.types.Object, bpy.types.Object] = {}

    def clone(node: bpy.types.Object, target_parent: bpy.types.Object) -> bpy.types.Object:
        copied = node.copy()
        if node.data:
            copied.data = node.data
        bpy.context.collection.objects.link(copied)
        copied.parent = target_parent
        mapping[node] = copied
        for child in node.children:
            clone(child, copied)
        return copied

    result = clone(source, parent)
    result.name = name
    result.location = location
    result.rotation_euler.z = rotation_z
    result["linked_module_source"] = source.name
    return result


def arch_ring(
    name: str,
    center: tuple[float, float, float],
    opening_w: float,
    spring_z: float,
    ring_t: float,
    depth: float,
    mat: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    segments: int = 18,
) -> bpy.types.Object:
    cx, cy, cz = center
    inner_r = opening_w / 2.0
    outer_r = inner_r + ring_t
    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for y in (-depth / 2.0, depth / 2.0):
        for radius in (inner_r, outer_r):
            for index in range(segments + 1):
                theta = math.pi * index / segments
                verts.append((cx + math.cos(theta) * radius, cy + y, cz + spring_z + math.sin(theta) * radius))
    stride = segments + 1
    for layer in range(2):
        inner = layer * 2 * stride
        outer = inner + stride
        for index in range(segments):
            if layer == 0:
                faces.append((inner + index, inner + index + 1, outer + index + 1, outer + index))
            else:
                faces.append((inner + index, outer + index, outer + index + 1, inner + index + 1))
    front_inner, front_outer = 0, stride
    back_inner, back_outer = 2 * stride, 3 * stride
    for index in range(segments):
        faces.append((front_outer + index, front_outer + index + 1, back_outer + index + 1, back_outer + index))
        faces.append((back_inner + index, back_inner + index + 1, front_inner + index + 1, front_inner + index))
    for index in (0, segments):
        faces.append((front_inner + index, back_inner + index, back_outer + index, front_outer + index))
    return mesh_object(name, verts, faces, mat, parent, bevel=0.018)


def arch_spandrels(
    name: str,
    width: float,
    spring_z: float,
    top_z: float,
    depth: float,
    center_y: float,
    mat: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    segments_per_side: int = 8,
) -> tuple[bpy.types.Object, bpy.types.Object]:
    """Fill the square corners above an arched window with actual wall mass."""
    radius = width / 2.0
    results = []
    for side, start, end in (("Left", math.pi / 2, math.pi), ("Right", 0.0, math.pi / 2)):
        arc = []
        for index in range(segments_per_side + 1):
            theta = start + (end - start) * index / segments_per_side
            arc.append((math.cos(theta) * radius, spring_z + math.sin(theta) * radius))
        if side == "Left":
            polygon = [(-radius, top_z), (0.0, top_z), *arc]
        else:
            polygon = [(0.0, top_z), (radius, top_z), *arc]
        verts = [(x, center_y - depth / 2, z) for x, z in polygon]
        verts += [(x, center_y + depth / 2, z) for x, z in polygon]
        count = len(polygon)
        faces = [tuple(range(count)), tuple(range(count, count * 2))[::-1]]
        for index in range(count):
            nxt = (index + 1) % count
            faces.append((index, nxt, count + nxt, count + index))
        results.append(mesh_object(f"{name}_{side}", verts, faces, mat, parent, bevel=0.008))
    return results[0], results[1]


def hip_roof(
    name: str,
    width: float,
    depth: float,
    eave_z: float,
    ridge_z: float,
    mat: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    center: tuple[float, float] = (0.0, 0.0),
    overhang: float = 0.62,
) -> bpy.types.Object:
    cx, cy = center
    half_w = width / 2.0 + overhang
    half_d = depth / 2.0 + overhang
    ridge_half = max(0.35, half_w - half_d)
    bottom_z = eave_z - 0.12
    top = [
        (cx - half_w, cy - half_d, eave_z),
        (cx + half_w, cy - half_d, eave_z),
        (cx + half_w, cy + half_d, eave_z),
        (cx - half_w, cy + half_d, eave_z),
        (cx - ridge_half, cy, ridge_z),
        (cx + ridge_half, cy, ridge_z),
    ]
    bottom = [(x, y, z - 0.12) for x, y, z in top]
    verts = top + bottom
    faces = [
        (0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4),
        (10, 11, 7, 6), (11, 8, 7), (11, 10, 9, 8), (10, 6, 9),
        (0, 6, 7, 1), (1, 7, 8, 2), (2, 8, 9, 3), (3, 9, 6, 0),
    ]
    roof = mesh_object(name, verts, faces, mat, parent, bevel=0.035)
    roof["module_type"] = "hip_roof"
    roof["real_dimensions_m"] = json.dumps({"width": width, "depth": depth, "eave": eave_z, "ridge": ridge_z})
    return roof


def segmented_wall_x(
    name: str,
    y: float,
    x0: float,
    x1: float,
    z0: float,
    z1: float,
    openings: list[tuple[float, float, float, float, str]],
    mat: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    depth: float = WALL_T,
) -> list[bpy.types.Object]:
    parts: list[bpy.types.Object] = []
    cursor = x0
    for ox0, ox1, oz0, oz1, label in sorted(openings):
        if ox0 > cursor:
            parts.append(box(f"{name}_Pier_{label}", (ox0 - cursor, depth, z1 - z0), ((cursor + ox0) / 2, y, (z0 + z1) / 2), mat, parent))
        if oz0 > z0:
            parts.append(box(f"{name}_Below_{label}", (ox1 - ox0, depth, oz0 - z0), ((ox0 + ox1) / 2, y, (z0 + oz0) / 2), mat, parent))
        if oz1 < z1:
            parts.append(box(f"{name}_Above_{label}", (ox1 - ox0, depth, z1 - oz1), ((ox0 + ox1) / 2, y, (oz1 + z1) / 2), mat, parent))
        cursor = ox1
    if cursor < x1:
        parts.append(box(f"{name}_Pier_End", (x1 - cursor, depth, z1 - z0), ((cursor + x1) / 2, y, (z0 + z1) / 2), mat, parent))
    return parts


def segmented_wall_y(
    name: str,
    x: float,
    y0: float,
    y1: float,
    z0: float,
    z1: float,
    openings: list[tuple[float, float, float, float, str]],
    mat: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    depth: float = WALL_T,
) -> list[bpy.types.Object]:
    parts: list[bpy.types.Object] = []
    cursor = y0
    for oy0, oy1, oz0, oz1, label in sorted(openings):
        if oy0 > cursor:
            parts.append(box(f"{name}_Pier_{label}", (depth, oy0 - cursor, z1 - z0), (x, (cursor + oy0) / 2, (z0 + z1) / 2), mat, parent))
        if oz0 > z0:
            parts.append(box(f"{name}_Below_{label}", (depth, oy1 - oy0, oz0 - z0), (x, (oy0 + oy1) / 2, (z0 + oz0) / 2), mat, parent))
        if oz1 < z1:
            parts.append(box(f"{name}_Above_{label}", (depth, oy1 - oy0, z1 - oz1), (x, (oy0 + oy1) / 2, (oz1 + z1) / 2), mat, parent))
        cursor = oy1
    if cursor < y1:
        parts.append(box(f"{name}_Pier_End", (depth, y1 - cursor, z1 - z0), (x, (cursor + y1) / 2, (z0 + z1) / 2), mat, parent))
    return parts


def arched_window_module(name: str, mats: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    module = empty(name, parent, module_type="arched_window", width_m=2.25, height_m=3.05)
    w = 2.25
    sill = 0.82
    spring = 2.12
    radius = w / 2.0
    box("Frame_Left", (0.105, 0.18, spring - sill), (-w / 2 + 0.0525, 0.0, (sill + spring) / 2), mats["green"], module, bevel=0.012)
    box("Frame_Right", (0.105, 0.18, spring - sill), (w / 2 - 0.0525, 0.0, (sill + spring) / 2), mats["green"], module, bevel=0.012)
    box("Frame_Sill", (w, 0.22, 0.11), (0.0, 0.0, sill + 0.055), mats["stone_light"], module, bevel=0.018)
    box("Glass_Lower", (w - 0.22, 0.026, spring - sill - 0.14), (0.0, 0.035, (sill + spring) / 2), mats["glass"], module, bevel=0.004)
    arch_spandrels("Stucco_ArchSpandrel", w, spring, 3.30, 0.25, 0.265, mats["stucco"], module)
    arch_ring("Frame_Arch", (0.0, 0.0, 0.0), w - 0.10, spring, 0.11, 0.18, mats["green"], module)
    # Fanlight glass is a restrained half-disc built as a triangle fan.
    verts = [(0.0, 0.04, spring)]
    for index in range(17):
        theta = math.pi * index / 16
        verts.append((math.cos(theta) * (radius - 0.12), 0.04, spring + math.sin(theta) * (radius - 0.12)))
    faces = [(0, index + 1, index + 2) for index in range(16)]
    mesh_object("Glass_Fanlight", verts, faces, mats["glass"], module)
    for x in (-0.36, 0.36):
        box(f"Muntin_V_{x:+.2f}", (0.035, 0.055, spring - sill - 0.18), (x, -0.015, (sill + spring) / 2), mats["green"], module, bevel=0.005)
    box("Muntin_H", (w - 0.25, 0.055, 0.035), (0.0, -0.015, 1.50), mats["green"], module, bevel=0.005)
    for angle in (-0.72, 0.0, 0.72):
        length = radius - 0.18
        x = math.sin(angle) * length / 2
        z = spring + math.cos(angle) * length / 2
        box(f"Fanlight_Radial_{angle:+.2f}", (0.028, 0.055, length), (x, -0.015, z), mats["green"], module,
            bevel=0.004, rotation=(0.0, angle, 0.0))
    return module


def double_door_module(name: str, mats: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    module = empty(name, parent, module_type="double_entry_door", clear_width_m=2.10, clear_height_m=2.65)
    frame = empty("Frame", module)
    box("Jamb_Left", (0.14, 0.24, 2.72), (-1.12, 0.0, 1.36), mats["stone_light"], frame, bevel=0.022)
    box("Jamb_Right", (0.14, 0.24, 2.72), (1.12, 0.0, 1.36), mats["stone_light"], frame, bevel=0.022)
    box("Threshold", (2.36, 0.34, 0.09), (0.0, -0.01, 0.045), mats["stone_light"], frame, bevel=0.016)
    arch_ring("Arched_Casing", (0.0, 0.0, 0.0), 2.24, 2.66, 0.14, 0.24, mats["stone_light"], frame)
    for side, hinge_x, leaf_center, sign in (("Left", -1.05, -0.525, 1), ("Right", 1.05, 0.525, -1)):
        pivot = empty(f"PIVOT_Door{side}", module, pivot_role="physical_hinge", animation_axis="Z")
        pivot.location = (hinge_x, 0.0, 0.0)
        leaf = empty(f"Door{side}_Leaf", pivot, moving_part=True)
        leaf.location = ((leaf_center - hinge_x), 0.0, 0.0)
        box("RaisedPanel_Lower", (0.91, 0.11, 1.05), (0.0, 0.0, 0.61), mats["walnut"], leaf, bevel=0.035)
        box("GlazedPanel_Upper", (0.84, 0.035, 1.18), (0.0, -0.025, 1.79), mats["glass"], leaf, bevel=0.008)
        box("Stile_Left", (0.10, 0.14, 2.52), (-0.455, 0.0, 1.28), mats["walnut"], leaf, bevel=0.016)
        box("Stile_Right", (0.10, 0.14, 2.52), (0.455, 0.0, 1.28), mats["walnut"], leaf, bevel=0.016)
        for z in (0.08, 1.15, 2.48):
            box(f"Rail_{z:.2f}", (0.91, 0.14, 0.10), (0.0, 0.0, z), mats["walnut"], leaf, bevel=0.014)
        box("Brass_Pull", (0.045, 0.08, 0.48), (sign * -0.33, -0.11, 1.32), mats["brass"], leaf, bevel=0.018)
        socket = empty(f"SOCKET_Handle{side}", pivot, interaction="door_handle")
        socket.location = ((leaf_center - hinge_x) + sign * -0.33, -0.12, 1.32)
    fan_verts = [(0.0, 0.03, 2.66)]
    for index in range(17):
        theta = math.pi * index / 16
        fan_verts.append((math.cos(theta) * 1.02, 0.03, 2.66 + math.sin(theta) * 1.02))
    mesh_object("Door_Fanlight_Glass", fan_verts, [(0, i + 1, i + 2) for i in range(16)], mats["glass"], module)
    return module


def column_module(name: str, mats: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    module = empty(name, parent, module_type="mediterranean_column", height_m=3.55)
    box("Stone_Foot", (0.72, 0.72, 0.16), (0.0, 0.0, 0.08), mats["stone"], module, bevel=0.045)
    box("Stone_Plinth", (0.60, 0.60, 0.42), (0.0, 0.0, 0.37), mats["stone"], module, bevel=0.050)
    cylinder("Cream_Base", 0.27, 0.18, (0.0, 0.0, 0.67), mats["stucco_light"], module, vertices=28, bevel=0.025)
    cylinder("Cream_Shaft", 0.205, 2.42, (0.0, 0.0, 1.95), mats["stucco_light"], module, vertices=28, bevel=0.018)
    cylinder("Cream_Neck", 0.25, 0.13, (0.0, 0.0, 3.22), mats["stucco_light"], module, vertices=28, bevel=0.022)
    box("Cream_Capital", (0.64, 0.64, 0.18), (0.0, 0.0, 3.375), mats["stucco_light"], module, bevel=0.055)
    box("Cream_Abacus", (0.74, 0.74, 0.12), (0.0, 0.0, 3.525), mats["stone_light"], module, bevel=0.034)
    return module


def arcade_bay(name: str, width: float, mats: dict[str, bpy.types.Material], parent: bpy.types.Object,
               *, grand: bool = False) -> bpy.types.Object:
    clear_top = 3.56
    spring = clear_top - width / 2.0
    arch_mat = mats["stone_light"] if grand else mats["stucco_light"]
    module = empty(name, parent, module_type="arcade_bay", clear_width_m=width,
                   clear_height_m=clear_top, entrance_hierarchy="grand" if grand else "secondary")
    # The physical columns are authored once at the bay boundaries. Keeping the
    # voussoirs independent avoids the doubled piers that made the old arcade
    # read as a row of cramped municipal openings.
    arch_ring("Arch_Voussoir", (0.0, 0.0, 0.0), width, spring, 0.30 if grand else 0.24,
              0.52, arch_mat, module, segments=28 if grand else 22)
    box("Spandrel", (width + 0.84, 0.52, 0.36), (0.0, 0.0, 3.73), mats["stucco_light"], module, bevel=0.035)
    if grand:
        box("Entrance_Keystone", (0.42, 0.60, 0.48), (0.0, -0.02, 3.52), mats["stone"], module,
            bevel=0.055, rotation=(0.0, math.radians(4.0), 0.0))
    return module


def palm_frond(name: str, angle: float, length: float, drop: float,
               mat: bpy.types.Material, parent: bpy.types.Object,
               crown: Vector, *, upright: float = 0.0) -> bpy.types.Object:
    """One curved, serrated stylized frond with a readable player-height silhouette."""
    segments = 18
    centers: list[Vector] = []
    for index in range(segments + 1):
        t = index / segments
        radius = length * t
        centers.append(Vector((
            crown.x + math.cos(angle) * radius,
            crown.y + math.sin(angle) * radius,
            crown.z + math.sin(t * math.pi) * (0.34 + upright) - drop * (t ** 1.45),
        )))
    forward = Vector((math.cos(angle), math.sin(angle), 0.0))
    side = Vector((-math.sin(angle), math.cos(angle), 0.0))
    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    # One gently serrated feather surface stays broad enough to survive the
    # game's stylized lighting and batching. Dozens of individually thin
    # leaflets produced a black wire-grid silhouette from the player camera.
    for index, center in enumerate(centers):
        t = index / segments
        envelope = math.sin(math.pi * (t ** 0.88)) ** 0.68
        width = (0.055 + 0.46 * envelope) * (1.0 - 0.22 * t)
        if 1 < index < segments - 1 and index % 2:
            width *= 0.86
        verts.extend((tuple(center - side * width), tuple(center + side * width)))
    for index in range(segments):
        a = index * 2
        faces.append((a, a + 1, a + 3, a + 2))
    return mesh_object(name, verts, faces, mat, parent, smooth=True)


def palm_module(name: str, mats: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    module = empty(name, parent, module_type="canary_date_palm", height_m=8.2)
    # Tapered sections plus proud scar collars establish a mature resort palm
    # without relying on a flat bark texture.
    cylinder("Trunk_Lower", 0.33, 2.9, (0.0, 0.0, 1.45), mats["walnut"], module, vertices=24, bevel=0.028)
    cylinder("Trunk_Mid", 0.265, 2.8, (0.10, 0.0, 4.18), mats["oak"], module, vertices=24, bevel=0.024,
             rotation=(0.0, math.radians(4.0), 0.0))
    cylinder("Trunk_Upper", 0.215, 1.75, (0.30, 0.0, 6.32), mats["oak"], module, vertices=24, bevel=0.022,
             rotation=(0.0, math.radians(6.0), 0.0))
    for index in range(15):
        z = 0.48 + index * 0.46
        radius = 0.355 - index * 0.009
        cylinder(f"TrunkScar_{index:02d}", radius, 0.075, (0.02 + z * 0.035, 0.0, z),
                 mats["clay_dark"], module, vertices=18, bevel=0.010)
    crown = Vector((0.42, 0.0, 7.22))
    cylinder("Crown", 0.43, 0.72, tuple(crown), mats["walnut"], module, vertices=24, bevel=0.05)
    for index in range(20):
        layer = index % 3
        angle = math.tau * index / 20.0 + layer * 0.075
        palm_frond(
            f"Frond_Mature_{index:02d}", angle,
            2.95 + 0.36 * math.sin(index * 1.71),
            (0.60, 1.18, 0.36)[layer] + 0.16 * ((index * 5) % 4),
            mats["leaf_light" if index % 6 == 0 else "leaf"], module, crown,
            upright=(0.04, -0.04, 0.26)[layer],
        )
    for index in range(6):
        palm_frond(f"Frond_Young_{index:02d}", math.tau * index / 6.0 + 0.22, 1.68, 0.02,
                   mats["leaf_light"], module, crown + Vector((0.0, 0.0, 0.12)), upright=0.62)
    return module


def patio_table_module(name: str, mats: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    module = empty(name, parent, module_type="outdoor_dining_set")
    cylinder("Table_Pedestal", 0.085, 0.68, (0.0, 0.0, 0.34), mats["charcoal"], module, vertices=18)
    cylinder("Table_Base", 0.36, 0.055, (0.0, 0.0, 0.028), mats["charcoal"], module, vertices=24, bevel=0.02)
    cylinder("Table_Top", 0.72, 0.065, (0.0, 0.0, 0.72), mats["stone_light"], module, vertices=32, bevel=0.025)
    for index in range(4):
        angle = math.tau * index / 4
        x, y = math.cos(angle) * 1.04, math.sin(angle) * 1.04
        chair = empty(f"Chair_{index}", module)
        chair.location = (x, y, 0.0)
        chair.rotation_euler.z = angle + math.pi
        box("Seat_Frame", (0.56, 0.56, 0.10), (0.0, 0.0, 0.43), mats["walnut"], chair, bevel=0.045)
        box("Seat_Cushion", (0.50, 0.50, 0.11), (0.0, -0.01, 0.51), mats["sage"], chair, bevel=0.060)
        for lx in (-0.215, 0.215):
            box("Back_Post", (0.065, 0.070, 0.70), (lx, 0.22, 0.81), mats["walnut"], chair,
                bevel=0.012, rotation=(math.radians(-6), 0.0, 0.0))
        box("Back_Cushion", (0.43, 0.10, 0.42), (0.0, 0.20, 0.83), mats["sage"], chair,
            bevel=0.060, rotation=(math.radians(-6), 0.0, 0.0))
        box("Back_TopRail", (0.50, 0.075, 0.075), (0.0, 0.235, 1.06), mats["oak"], chair,
            bevel=0.020, rotation=(math.radians(-6), 0.0, 0.0))
        for lx in (-0.27, 0.27):
            box("Arm", (0.055, 0.46, 0.055), (lx, -0.01, 0.67), mats["walnut"], chair, bevel=0.016)
        for lx in (-0.19, 0.19):
            for ly in (-0.18, 0.18):
                cylinder("Leg", 0.038, 0.44, (lx, ly, 0.22), mats["charcoal"], chair, vertices=10, bevel=0.008)
    cylinder("Umbrella_Mast", 0.045, 2.82, (0.0, 0.0, 1.41), mats["charcoal"], module, vertices=16, bevel=0.008)
    bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=1.62, radius2=0.10, depth=0.38, location=(0.0, 0.0, 2.64))
    canopy = bpy.context.object
    canopy.name = "Umbrella_Canopy"
    canopy.data.materials.append(mats["sage"])
    canopy.parent = module
    finish_mesh(canopy, bevel=0.025, smooth=True)
    for index in range(8):
        angle = index * math.tau / 8.0
        cylinder_between(f"Umbrella_Rib_{index}", (0.0, 0.0, 2.81),
                         (math.cos(angle) * 1.53, math.sin(angle) * 1.53, 2.47),
                         0.014, mats["brass"], module, vertices=8)
    cylinder("Umbrella_Finial", 0.07, 0.22, (0.0, 0.0, 2.98), mats["brass"], module, vertices=16, bevel=0.014)
    return module


def golf_cart_module(name: str, mats: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    """Compact two-seat resort cart for the authored staging bays."""
    module = empty(name, parent, module_type="staged_golf_cart", operational_prop=True)
    box("Cart_Chassis", (1.26, 2.22, 0.18), (0.0, 0.0, 0.43), mats["charcoal"], module, bevel=0.08)
    box("Cart_Floor", (1.18, 1.76, 0.12), (0.0, 0.04, 0.62), mats["green"], module, bevel=0.09)
    box("Cart_Nose", (1.14, 0.58, 0.48), (0.0, -0.76, 0.82), mats["green"], module, bevel=0.14,
        rotation=(math.radians(-4), 0.0, 0.0))
    box("Cart_Dash", (1.08, 0.20, 0.46), (0.0, -0.38, 1.12), mats["green"], module, bevel=0.08,
        rotation=(math.radians(8), 0.0, 0.0))
    box("Cart_SeatBase", (1.12, 0.55, 0.22), (0.0, 0.34, 1.02), mats["stucco_light"], module, bevel=0.11)
    box("Cart_SeatBack", (1.12, 0.20, 0.62), (0.0, 0.58, 1.34), mats["stucco_light"], module,
        bevel=0.11, rotation=(math.radians(-7), 0.0, 0.0))
    for x in (-0.48, 0.48):
        for y in (-0.72, 0.72):
            cylinder("Cart_Wheel", 0.30, 0.20, (x, y, 0.33), mats["charcoal"], module,
                     vertices=18, bevel=0.035, rotation=(0.0, math.pi / 2, 0.0))
            cylinder("Cart_Hub", 0.12, 0.215, (x, y, 0.33), mats["brass"], module,
                     vertices=16, bevel=0.018, rotation=(0.0, math.pi / 2, 0.0))
    for x in (-0.51, 0.51):
        cylinder_between("Cart_RoofPost", (x, -0.44, 0.64), (x, -0.44, 2.08),
                         0.035, mats["charcoal"], module, vertices=10)
        cylinder_between("Cart_RearPost", (x, 0.58, 0.64), (x, 0.58, 2.08),
                         0.035, mats["charcoal"], module, vertices=10)
    box("Cart_Canopy", (1.52, 2.04, 0.10), (0.0, 0.06, 2.10), mats["stucco_light"], module, bevel=0.09)
    box("Cart_Windshield", (1.04, 0.035, 0.68), (0.0, -0.43, 1.60), mats["glass"], module, bevel=0.025,
        rotation=(math.radians(-5), 0.0, 0.0))
    cylinder_between("Cart_SteeringColumn", (0.30, -0.34, 0.98), (0.30, -0.26, 1.37),
                     0.025, mats["charcoal"], module, vertices=10)
    cylinder("Cart_SteeringWheel", 0.18, 0.035, (0.30, -0.23, 1.39), mats["charcoal"], module,
             vertices=18, bevel=0.012, rotation=(math.radians(75), 0.0, 0.0))
    box("Cart_BagWell", (1.02, 0.38, 0.42), (0.0, 0.93, 0.78), mats["green"], module, bevel=0.09)
    return module


def golf_bag_module(name: str, mats: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    """A restrained staged guest bag; site equipment, not interior furniture."""
    module = empty(name, parent, module_type="guest_bag", operational_prop=True)
    cylinder("Bag_Body", 0.21, 0.88, (0.0, 0.0, 0.48), mats["green"], module,
             vertices=20, bevel=0.04)
    cylinder("Bag_Base", 0.24, 0.10, (0.0, 0.0, 0.05), mats["charcoal"], module,
             vertices=20, bevel=0.025)
    cylinder("Bag_Cuff", 0.24, 0.13, (0.0, 0.0, 0.91), mats["walnut"], module,
             vertices=20, bevel=0.025)
    box("Bag_Pocket", (0.30, 0.11, 0.38), (0.0, -0.20, 0.49), mats["stucco_light"], module, bevel=0.06)
    for index, x in enumerate((-0.13, -0.065, 0.0, 0.065, 0.13)):
        height = 1.43 + (index % 3) * 0.08
        cylinder(f"Club_Shaft_{index}", 0.012, height - 0.86, (x, 0.0, (height + 0.86) / 2),
                 mats["charcoal"], module, vertices=8, bevel=0.003)
        box(f"Club_Head_{index}", (0.10, 0.045, 0.055), (x + 0.03, 0.0, height),
            mats["brass"], module, bevel=0.015, rotation=(0.0, math.radians(8 + index * 3), 0.0))
    return module


def wall_lantern_module(name: str, mats: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    module = empty(name, parent, module_type="architectural_wall_lantern")
    box("Lantern_Backplate", (0.28, 0.08, 0.62), (0.0, 0.0, 0.0), mats["brass"], module, bevel=0.045)
    box("Lantern_Glow", (0.24, 0.18, 0.48), (0.0, -0.12, -0.02), mats["light"], module, bevel=0.035)
    for x in (-0.16, 0.16):
        box("Lantern_Stile", (0.035, 0.24, 0.64), (x, -0.12, 0.0), mats["charcoal"], module, bevel=0.008)
    for z in (-0.31, 0.31):
        box("Lantern_Rail", (0.35, 0.24, 0.035), (0.0, -0.12, z), mats["charcoal"], module, bevel=0.008)
    box("Lantern_Crown", (0.44, 0.30, 0.10), (0.0, -0.12, 0.39), mats["charcoal"], module, bevel=0.025)
    cylinder("Lantern_Finial", 0.055, 0.20, (0.0, -0.12, 0.52), mats["brass"], module, vertices=14, bevel=0.012)
    return module


def add_text(name: str, text: str, loc: tuple[float, float, float], size: float,
             extrude: float, mat: bpy.types.Material, parent: bpy.types.Object,
             rotation: tuple[float, float, float] = (math.pi / 2, 0.0, 0.0)) -> bpy.types.Object:
    curve = bpy.data.curves.new(name + "_CURVE", "FONT")
    curve.body = text
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.size = size
    curve.extrude = extrude
    curve.bevel_depth = min(0.008, extrude * 0.3)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    obj.parent = parent
    obj["fictional_brand"] = True
    return obj


def build() -> tuple[bpy.types.Object, dict[str, bpy.types.Object]]:
    mats = palette()
    root = empty(
        "ROOT_ClubhouseResort4000",
        None,
        asset_id="clubhouse_resort_4000",
        authored_units="meters",
        source_lineage="Original in-repository Blender geometry; no external assets",
        architecture="Mediterranean luxury resort",
        building_width_m=BUILDING_W,
        building_depth_m=BUILDING_D,
        conditioned_area_m2=BUILDING_AREA_M2,
        conditioned_area_sqft=BUILDING_AREA_SQFT,
        interior_state="intentionally empty for player furnishing",
        modular_construction=True,
        runtime_axis_map="Blender +X,+Y,+Z -> Three.js +X,-Z,+Y",
    )
    architecture = empty("ARCHITECTURE_Modular", root)
    shell = empty("SHELL_4000SQFT", architecture)
    roof_group = empty("ROOFS_ModularHipAndClay", architecture)
    opening_group = empty("OPENINGS_DoorsAndWindows", architecture)
    arcade_group = empty("ARCADES_ColumnsAndCoveredWalkways", architecture)
    site = empty("SITE_ResortLandscape", root)
    patio = empty("PATIO_OutdoorSeating", site)
    bag_drop = empty("BAG_DROP_AndCartStaging", site)
    water = empty("WATER_FEATURES", site)
    landscape = empty("LANDSCAPE_Premium", site)
    signage = empty("SIGNAGE_Luxury", site)
    collisions = empty("COLLISION_PROXIES", root, collision_group=True)

    # Structure and empty interior.
    box("MODULE_Foundation_Slab_24x15p5", (BUILDING_W, BUILDING_D, FLOOR_Z),
        (0.0, 0.0, FLOOR_Z / 2), mats["stone"], shell, bevel=0.035,
        props={"conditioned_area_authority": True})
    box("MODULE_Interior_EmptyFloor", (BUILDING_W - 0.50, BUILDING_D - 0.50, 0.08),
        (0.0, 0.0, FLOOR_Z + 0.04), mats["interior_floor"], shell, bevel=0.012,
        props={"player_furnishing_surface": True, "permanent_furniture_count": 0})
    box("MODULE_Interior_EmptyCeiling", (BUILDING_W - 0.54, BUILDING_D - 0.54, 0.08),
        (0.0, 0.0, WALL_H - 0.08), mats["interior"], shell, bevel=0.010,
        props={"architectural_finish": True, "player_decor_surface": True})
    # Recessed discs are architectural services, not furnishings. Their low
    # emissive glow keeps the empty fit-out shell readable without baking a
    # player layout into the building.
    for row, y in enumerate((-3.65, 0.0, 3.65)):
        for column, x in enumerate((-8.2, -4.1, 0.0, 4.1, 8.2)):
            cylinder(f"Interior_Downlight_{row}_{column}", 0.105, 0.025,
                     (x, y, WALL_H - 0.135), mats["light"], shell,
                     vertices=16, bevel=0.008)

    window_w, window_bottom, window_top = 2.25, 0.80, 3.28
    door_center = -1.0
    door_w = 2.40
    front_windows = (-9.15, -6.15, 3.10, 6.10)
    back_windows = (-8.80, -5.45, -2.10, 2.10, 5.45, 8.80)
    side_windows = (-4.85, -1.65, 1.65, 4.85)
    front_openings = [(x - window_w / 2, x + window_w / 2, window_bottom, window_top, f"Window_{i}")
                      for i, x in enumerate(front_windows)]
    front_openings.append((door_center - door_w / 2, door_center + door_w / 2, FLOOR_Z, 3.78, "MainDoor"))
    segmented_wall_x("MODULE_Wall_Front", FRONT_Y + WALL_T / 2, -BUILDING_W / 2, BUILDING_W / 2,
                     FLOOR_Z, WALL_H, front_openings, mats["stucco"], shell)
    segmented_wall_x("MODULE_Wall_Back", BACK_Y - WALL_T / 2, -BUILDING_W / 2, BUILDING_W / 2,
                     FLOOR_Z, WALL_H,
                     [(x - window_w / 2, x + window_w / 2, window_bottom, window_top, f"Window_{i}")
                      for i, x in enumerate(back_windows)], mats["stucco"], shell)
    for side_name, x in (("West", -BUILDING_W / 2 + WALL_T / 2), ("East", BUILDING_W / 2 - WALL_T / 2)):
        segmented_wall_y(f"MODULE_Wall_{side_name}", x, FRONT_Y, BACK_Y, FLOOR_Z, WALL_H,
                         [(y - window_w / 2, y + window_w / 2, window_bottom, window_top, f"Window_{i}")
                          for i, y in enumerate(side_windows)], mats["stucco"], shell)

    # Interior plaster liners repeat every aperture, keeping sight lines genuinely open.
    liner_depth = 0.035
    segmented_wall_x("MODULE_Liner_Front", FRONT_Y + WALL_T + liner_depth / 2,
                     -BUILDING_W / 2 + WALL_T, BUILDING_W / 2 - WALL_T, FLOOR_Z, WALL_H,
                     front_openings, mats["interior"], shell, depth=liner_depth)
    segmented_wall_x("MODULE_Liner_Back", BACK_Y - WALL_T - liner_depth / 2,
                     -BUILDING_W / 2 + WALL_T, BUILDING_W / 2 - WALL_T, FLOOR_Z, WALL_H,
                     [(x - window_w / 2, x + window_w / 2, window_bottom, window_top, f"Window_{i}")
                      for i, x in enumerate(back_windows)], mats["interior"], shell, depth=liner_depth)
    for side_name, x in (("West", -BUILDING_W / 2 + WALL_T + liner_depth / 2),
                         ("East", BUILDING_W / 2 - WALL_T - liner_depth / 2)):
        segmented_wall_y(f"MODULE_Liner_{side_name}", x, FRONT_Y + WALL_T, BACK_Y - WALL_T,
                         FLOOR_Z, WALL_H,
                         [(y - window_w / 2, y + window_w / 2, window_bottom, window_top, f"Window_{i}")
                          for i, y in enumerate(side_windows)], mats["interior"], shell, depth=liner_depth)

    # Limestone accents: base, water table, quoins, and cornice are reusable strips.
    box("MODULE_StoneBase_Front_West", (door_center - door_w / 2 + BUILDING_W / 2, 0.34, 0.72),
        ((-BUILDING_W / 2 + door_center - door_w / 2) / 2, FRONT_Y - 0.05, FLOOR_Z + 0.36), mats["stone"], shell, bevel=0.028)
    box("MODULE_StoneBase_Front_East", (BUILDING_W / 2 - (door_center + door_w / 2), 0.34, 0.72),
        ((door_center + door_w / 2 + BUILDING_W / 2) / 2, FRONT_Y - 0.05, FLOOR_Z + 0.36), mats["stone"], shell, bevel=0.028)
    for name, dims, loc in (
        ("Back", (BUILDING_W, 0.34, 0.72), (0.0, BACK_Y + 0.05, FLOOR_Z + 0.36)),
        ("West", (0.34, BUILDING_D, 0.72), (-BUILDING_W / 2 - 0.05, 0.0, FLOOR_Z + 0.36)),
        ("East", (0.34, BUILDING_D, 0.72), (BUILDING_W / 2 + 0.05, 0.0, FLOOR_Z + 0.36)),
    ):
        box(f"MODULE_StoneBase_{name}", dims, loc, mats["stone"], shell, bevel=0.028)
    for side, y in (("Front", FRONT_Y - 0.18), ("Back", BACK_Y + 0.18)):
        box(f"MODULE_Cornice_{side}", (BUILDING_W + 0.48, 0.30, 0.30), (0.0, y, WALL_H - 0.05), mats["stone_light"], shell, bevel=0.04)
    for side, x in (("West", -BUILDING_W / 2 - 0.18), ("East", BUILDING_W / 2 + 0.18)):
        box(f"MODULE_Cornice_{side}", (0.30, BUILDING_D + 0.48, 0.30), (x, 0.0, WALL_H - 0.05), mats["stone_light"], shell, bevel=0.04)
    for corner_x in (-BUILDING_W / 2 - 0.10, BUILDING_W / 2 + 0.10):
        for corner_y in (FRONT_Y - 0.10, BACK_Y + 0.10):
            for level in range(7):
                box(f"MODULE_Quoin_{corner_x:+.0f}_{corner_y:+.0f}_{level}", (0.48, 0.48, 0.42),
                    (corner_x, corner_y, FLOOR_Z + 0.24 + level * 0.57), mats["stone_light"], shell, bevel=0.035)
    # Slim limestone pilasters divide the long side elevations into window
    # bays. They mask wall segmentation and give the side approaches the same
    # architectural cadence as the front arcade.
    for side_name, x in (("West", -BUILDING_W / 2 - 0.16), ("East", BUILDING_W / 2 + 0.16)):
        for index, y in enumerate((-3.25, 0.0, 3.25)):
            box(f"MODULE_SidePilaster_{side_name}_{index}", (0.32, 0.24, 3.66),
                (x, y, FLOOR_Z + 1.95), mats["stone_light"], shell, bevel=0.035)
            box(f"MODULE_SidePilasterCap_{side_name}_{index}", (0.40, 0.40, 0.18),
                (x, y, FLOOR_Z + 3.82), mats["stone"], shell, bevel=0.035)

    main_roof = hip_roof("MODULE_Roof_MainHip", BUILDING_W, BUILDING_D, ROOF_EAVE_Z, ROOF_RIDGE_Z,
                         mats["clay"], roof_group)
    # Tile-course shadow lines break the large roof field at a readable resort-
    # scale rhythm without turning hundreds of individual tiles into draw calls.
    half_w = BUILDING_W / 2 + 0.62
    half_d = BUILDING_D / 2 + 0.62
    ridge_half = half_w - half_d
    roof_slope = math.atan2(ROOF_RIDGE_Z - ROOF_EAVE_Z, half_d)
    for side, direction in (("Front", -1.0), ("Back", 1.0)):
        for index, t in enumerate((0.13, 0.24, 0.35, 0.46, 0.57, 0.68, 0.79, 0.90)):
            y = direction * half_d * t
            z = ROOF_RIDGE_Z + (ROOF_EAVE_Z - ROOF_RIDGE_Z) * t + 0.045
            row_half = ridge_half + (half_w - ridge_half) * t
            box(f"MODULE_ClayTileCourse_{side}_{index:02d}", (row_half * 2, 0.075, 0.055),
                (0.0, y, z), mats["clay_light"], roof_group, bevel=0.018,
                rotation=(direction * roof_slope, 0.0, 0.0), props={"roof_tile_course": True})
    # Repeating barrel caps turn those course shadows into readable Spanish
    # clay tile. Three linked color masters provide restrained sun-faded
    # variation while keeping every roof component replaceable in the source.
    barrel_masters = []
    tile_t = 0.13
    tile_direction = -1.0
    tile_y = tile_direction * half_d * tile_t
    tile_z = ROOF_RIDGE_Z + (ROOF_EAVE_Z - ROOF_RIDGE_Z) * tile_t + 0.035
    tile_row_half = ridge_half + (half_w - ridge_half) * tile_t
    for master_index, key in enumerate(("clay", "clay_light", "clay_dark")):
        barrel_masters.append(barrel_roof_tile(
            f"MODULE_ClayBarrelTile_Master_{master_index+1}", 0.092, 0.68,
            (-tile_row_half + 0.25 + master_index * 0.48, tile_y, tile_z), mats[key], roof_group,
            rotation=(math.pi / 2 - tile_direction * roof_slope, 0.0, 0.0),
        ))
        barrel_masters[-1]["reusable_roof_detail"] = True
    for side, direction in (("Front", -1.0), ("Back", 1.0)):
        for row_index, t in enumerate((0.13, 0.24, 0.35, 0.46, 0.57, 0.68, 0.79, 0.90)):
            y = direction * half_d * t
            z = ROOF_RIDGE_Z + (ROOF_EAVE_Z - ROOF_RIDGE_Z) * t + 0.035
            row_half = ridge_half + (half_w - ridge_half) * t
            count = max(5, int((row_half * 2.0) / 0.48))
            for column_index in range(count):
                if side == "Front" and row_index == 0 and column_index < 3:
                    continue
                x = -row_half + (column_index + 0.5) * (row_half * 2.0 / count)
                source = barrel_masters[(column_index + row_index * 2 + (1 if side == "Back" else 0)) % 3]
                copy = linked_copy_tree(source, f"BarrelTile_{side}_{row_index:02d}_{column_index:02d}", roof_group, (x, y, z))
                # The master's slope rotation is baked by finish_mesh. Front
                # copies therefore need no additional transform; rear copies
                # mirror that baked pitch instead of accidentally applying it
                # twice and standing the tile on end.
                copy.rotation_euler.x = 0.0 if side == "Front" else -2.0 * roof_slope
    # Tile the east/west hip triangles as their own reusable roof-plane family;
    # leaving those large facets bare made the otherwise detailed roof read
    # unfinished from the arrival and patio hero angles.
    side_tile_masters: dict[str, list[bpy.types.Object]] = {"East": [], "West": []}
    for label, direction in (("East", 1.0), ("West", -1.0)):
        axis = Vector((direction * math.cos(roof_slope), 0.0, -math.sin(roof_slope)))
        normal = Vector((direction * math.sin(roof_slope), 0.0, math.cos(roof_slope)))
        t = 0.13
        x = direction * (ridge_half + (half_w - ridge_half) * t)
        z = ROOF_RIDGE_Z + (ROOF_EAVE_Z - ROOF_RIDGE_Z) * t + 0.035
        row_half_y = half_d * t
        first_count = max(3, int((row_half_y * 2.0) / 0.48))
        for master_index, key in enumerate(("clay", "clay_light", "clay_dark")):
            y = -row_half_y + (master_index + 0.5) * (row_half_y * 2.0 / first_count)
            master = barrel_roof_tile_vector(
                f"MODULE_ClayHipTile_{label}_Master_{master_index+1}", 0.092, 0.68,
                (x, y, z), axis, normal, mats[key], roof_group,
            )
            master["reusable_roof_detail"] = True
            side_tile_masters[label].append(master)
        for row_index, t in enumerate((0.13, 0.24, 0.35, 0.46, 0.57, 0.68, 0.79, 0.90)):
            x = direction * (ridge_half + (half_w - ridge_half) * t)
            z = ROOF_RIDGE_Z + (ROOF_EAVE_Z - ROOF_RIDGE_Z) * t + 0.035
            row_half_y = half_d * t
            count = max(3, int((row_half_y * 2.0) / 0.48))
            for column_index in range(count):
                if row_index == 0 and column_index < 3:
                    continue
                y = -row_half_y + (column_index + 0.5) * (row_half_y * 2.0 / count)
                source = side_tile_masters[label][(column_index + row_index * 2) % 3]
                linked_copy_tree(source, f"HipTile_{label}_{row_index:02d}_{column_index:02d}", roof_group, (x, y, z))
    # Ridge and hip barrel tiles make the clay roof silhouette read at player distance.
    tile_master = cylinder("MODULE_Clay_RidgeTile_Master", 0.17, 0.44, (-ridge_half, 0.0, ROOF_RIDGE_Z + 0.11),
                           mats["clay_light"], roof_group, vertices=16, bevel=0.015, rotation=(0.0, math.pi / 2, 0.0))
    tile_master["reusable_roof_detail"] = True
    tile_index = 0
    x = -ridge_half + 0.22
    while x <= ridge_half:
        linked_copy_tree(tile_master, f"RidgeTile_{tile_index:02d}", roof_group, (x, 0.0, ROOF_RIDGE_Z + 0.11))
        tile_index += 1
        x += 0.40
    # Decorative eave barrels use one linked module at a practical 0.52 m rhythm.
    eave_tile = cylinder("MODULE_Clay_EaveTile_Master", 0.13, 0.68,
                         (-BUILDING_W / 2, FRONT_Y - 0.60, ROOF_EAVE_Z - 0.01), mats["clay_light"], roof_group,
                         vertices=14, bevel=0.012, rotation=(math.pi / 2, 0.0, 0.0))
    for side_y, label in ((FRONT_Y - 0.60, "Front"), (BACK_Y + 0.60, "Back")):
        for index in range(47):
            xx = -BUILDING_W / 2 + index * (BUILDING_W / 46)
            linked_copy_tree(eave_tile, f"EaveTile_{label}_{index:02d}", roof_group, (xx, side_y, ROOF_EAVE_Z - 0.01))

    # Tower/cupola gives the entrance a resort landmark without consuming floor area.
    tower = empty("MODULE_Tower_LuxuryEntrance", architecture, module_type="entry_tower")
    tower.location = (door_center, FRONT_Y + 1.60, 0.0)
    box("Tower_Upper", (4.0, 4.0, 2.25), (0.0, 0.0, 5.35), mats["stucco_light"], tower, bevel=0.055)
    for side, loc, rot in (
        ("Front", (0.0, -2.02, 5.45), 0.0), ("Back", (0.0, 2.02, 5.45), math.pi),
        ("West", (-2.02, 0.0, 5.45), -math.pi / 2), ("East", (2.02, 0.0, 5.45), math.pi / 2),
    ):
        louver = empty(f"Tower_Louver_{side}", tower)
        louver.location = loc
        louver.rotation_euler.z = rot
        arch_ring("Louver_Arch", (0.0, 0.0, 0.0), 1.15, 0.70, 0.11, 0.16, mats["stone_light"], louver, segments=14)
        for lx in (-0.34, -0.11, 0.11, 0.34):
            box("Louver_Slat", (0.075, 0.08, 1.05), (lx, -0.07, 1.02), mats["green"], louver, bevel=0.008)
    hip_roof("MODULE_Roof_TowerHip", 4.25, 4.25, 6.55, 7.75, mats["clay_light"], tower, overhang=0.38)
    cylinder("Tower_Finial", 0.07, 0.52, (0.0, 0.0, 8.04), mats["brass"], tower, vertices=16, bevel=0.018)
    cylinder("Tower_FinialBall", 0.14, 0.16, (0.0, 0.0, 8.34), mats["brass"], tower, vertices=18, bevel=0.02)

    # Reusable arched window master and linked placements.
    window_master = arched_window_module("MODULE_Window_Arched_Master", mats, opening_group)
    window_master.location = (front_windows[0], FRONT_Y - 0.14, 0.0)
    placements: list[tuple[str, tuple[float, float, float], float]] = []
    for index, x in enumerate(front_windows[1:], start=1):
        placements.append((f"Window_Front_{index}", (x, FRONT_Y - 0.14, 0.0), 0.0))
    for index, x in enumerate(back_windows):
        placements.append((f"Window_Back_{index}", (x, BACK_Y + 0.14, 0.0), math.pi))
    for side, x, rot in (("West", -BUILDING_W / 2 - 0.14, -math.pi / 2), ("East", BUILDING_W / 2 + 0.14, math.pi / 2)):
        for index, y in enumerate(side_windows):
            placements.append((f"Window_{side}_{index}", (x, y, 0.0), rot))
    for name, loc, rot in placements:
        linked_copy_tree(window_master, name, opening_group, loc, rot)

    door = double_door_module("MODULE_Door_DoubleEntry", mats, opening_group)
    door.location = (door_center, FRONT_Y - 0.17, FLOOR_Z)
    # The tower is now deliberately centered on the physical entrance. Its
    # brass crest and identity sit above the arcade roofline, readable from the
    # bag-drop arrival instead of disappearing behind the eave.
    cylinder("Facade_Crest_Ring", 0.50, 0.09, (door_center, FRONT_Y - 0.39, 5.82), mats["brass"], signage,
             vertices=32, bevel=0.025, rotation=(math.pi / 2, 0.0, 0.0))
    cylinder("Facade_Crest_Field", 0.41, 0.105, (door_center, FRONT_Y - 0.45, 5.82), mats["green"], signage,
             vertices=32, bevel=0.020, rotation=(math.pi / 2, 0.0, 0.0))
    add_text("Facade_Crest_Monogram", "P", (door_center, FRONT_Y - 0.52, 5.82), 0.48, 0.022, mats["brass"], signage)
    add_text("Facade_Title", "PINEHOLLOW", (door_center, FRONT_Y - 0.43, 5.18), 0.34, 0.020, mats["brass"], signage)
    add_text("Facade_Subtitle", "GOLF RESORT", (door_center, FRONT_Y - 0.43, 4.76), 0.20, 0.014, mats["green"], signage)
    lantern_master = wall_lantern_module("MODULE_WallLantern_Master", mats, opening_group)
    lantern_master.location = (door_center - 1.55, FRONT_Y - 0.24, 2.35)
    for index, x in enumerate((door_center + 1.55, -7.65, 6.45), start=1):
        linked_copy_tree(lantern_master, f"WallLantern_Front_{index}", opening_group, (x, FRONT_Y - 0.24, 2.35))

    # Front covered arcade with a deliberately larger central arrival bay. The
    # side rhythm stays modular, while the five-opening composition now reads
    # as resort architecture instead of a uniform row of small shop arches.
    box("MODULE_Walkway_FrontCovered", (20.2, 3.55, 0.16), (-1.0, FRONT_Y - 1.68, 0.12),
        mats["paver"], arcade_group, bevel=0.025, props={"covered_walkway": True})
    column_master = column_module("MODULE_Column_Master", mats, arcade_group)
    column_master.location = (-10.0, FRONT_Y - 2.92, 0.16)
    column_xs = (-10.0, -6.6, -3.2, 1.2, 4.6, 8.0)
    for index, x in enumerate(column_xs[1:], start=1):
        linked_copy_tree(column_master, f"Column_Front_{index}", arcade_group, (x, FRONT_Y - 2.92, 0.16))
    arcade_master = arcade_bay("MODULE_ArcadeBay_Master", 2.98, mats, arcade_group)
    arcade_master.location = ((column_xs[0] + column_xs[1]) / 2, FRONT_Y - 2.92, 0.16)
    for index in (1, 3, 4):
        midpoint = (column_xs[index] + column_xs[index + 1]) / 2
        linked_copy_tree(arcade_master, f"ArcadeBay_Front_{index}", arcade_group,
                         (midpoint, FRONT_Y - 2.92, 0.16))
    grand_arcade = arcade_bay("MODULE_ArcadeBay_GrandEntrance", 3.98, mats, arcade_group, grand=True)
    grand_arcade.location = (door_center, FRONT_Y - 2.92, 0.16)
    hip_roof("MODULE_Roof_FrontArcade", 19.2, 4.0, 3.92, 4.90, mats["clay_light"], arcade_group,
             center=(-1.0, FRONT_Y - 1.68), overhang=0.38)
    arcade_eave_tile = cylinder("MODULE_Arcade_EaveTile_Master", 0.12, 0.62,
                                (-10.35, FRONT_Y - 3.88, 3.95), mats["clay_light"], arcade_group,
                                vertices=14, bevel=0.012, rotation=(math.pi / 2, 0.0, 0.0))
    for index in range(39):
        linked_copy_tree(arcade_eave_tile, f"Arcade_EaveTile_{index:02d}", arcade_group,
                         (-10.35 + index * 0.49, FRONT_Y - 3.88, 3.95))

    # Entrance plaza and primary fountain.
    box("MODULE_Plaza_Entrance", (22.0, 9.0, 0.14), (-0.6, FRONT_Y - 7.0, 0.07), mats["paver"], site, bevel=0.030)
    # A proper elliptical arrival motor court fills the former empty turf
    # apron and frames a landscaped island like the Course 4 reference.
    motor_court_y = FRONT_Y - 17.0
    oval_ring("MODULE_ArrivalMotorCourt", 24.0, 9.0, 17.0, 5.05, 0.055,
              (door_center, motor_court_y, 0.030), mats["drive"], site)
    oval_ring("MODULE_ArrivalIsland_LimestoneCurb", 17.0, 5.05, 16.50, 4.56, 0.16,
              (door_center, motor_court_y, 0.08), mats["stone_light"], landscape)
    oval_bed("MODULE_ArrivalIsland_WestGarden", 5.2, 1.72, 0.13,
             (-8.0, motor_court_y, 0.065), mats["mulch"], landscape)
    oval_ring("MODULE_ArrivalIsland_WestGardenCurb", 5.40, 1.92, 5.15, 1.67, 0.14,
              (-8.0, motor_court_y, 0.07), mats["stone_light"], landscape)
    oval_bed("MODULE_ArrivalIsland_EastGarden", 4.7, 1.55, 0.13,
             (7.0, motor_court_y + 0.10, 0.065), mats["mulch"], landscape)
    oval_ring("MODULE_ArrivalIsland_EastGardenCurb", 4.90, 1.75, 4.65, 1.50, 0.14,
              (7.0, motor_court_y + 0.10, 0.07), mats["stone_light"], landscape)
    # Two restrained limestone lines carry the eye from the motor court to
    # the double doors and keep the entrance plaza from reading as one slab.
    for side, x in (("West", door_center - 1.58), ("East", door_center + 1.58)):
        box(f"MODULE_Plaza_ProcessionalInlay_{side}", (0.075, 8.65, 0.022),
            (x, FRONT_Y - 7.0, 0.151), mats["stone_light"], site, bevel=0.008)
    # Curved planting islands carry the resort landscaping into the arrival
    # lawn instead of leaving a broad municipal-looking turf apron. Their low
    # profile keeps the monument, fountain and porte-cochere sightlines open.
    oval_bed("MODULE_LandscapeIsland_WestArrival", 4.65, 1.95, 0.16,
             (-16.2, FRONT_Y - 10.9, 0.08), mats["mulch"], landscape)
    oval_ring("MODULE_LandscapeIsland_WestArrivalCurb", 4.88, 2.18, 4.61, 1.91, 0.15,
              (-16.2, FRONT_Y - 10.9, 0.075), mats["stone_light"], landscape)
    oval_bed("MODULE_LandscapeIsland_EastArrival", 3.85, 1.65, 0.16,
             (15.7, FRONT_Y - 13.1, 0.08), mats["mulch"], landscape)
    oval_ring("MODULE_LandscapeIsland_EastArrivalCurb", 4.08, 1.88, 3.81, 1.61, 0.15,
              (15.7, FRONT_Y - 13.1, 0.075), mats["stone_light"], landscape)
    box("MODULE_LandscapeBed_StagingEast", (0.85, 13.4, 0.14), (19.25, FRONT_Y - 5.4, 0.07),
        mats["mulch"], landscape, bevel=0.12)
    box("MODULE_LandscapeBed_BagDropEdge", (0.72, 7.2, 0.14), (2.35, FRONT_Y - 8.0, 0.07),
        mats["mulch"], landscape, bevel=0.12)
    for side, x in (("West", -12.70), ("East", 12.70)):
        box(f"MODULE_LandscapeBed_{side}", (0.88, 11.8, 0.14), (x, 0.0, 0.07),
            mats["mulch"], landscape, bevel=0.12)
    fountain = empty("MODULE_Fountain_Entrance", water, module_type="tiered_fountain")
    fountain.location = (-5.8, FRONT_Y - 8.0, 0.14)
    cylinder("Basin_Outer", 2.35, 0.42, (0.0, 0.0, 0.21), mats["stone_light"], fountain, vertices=48, bevel=0.055)
    cylinder("Basin_Water", 2.02, 0.06, (0.0, 0.0, 0.45), mats["water"], fountain, vertices=48, bevel=0.012)
    cylinder("Pedestal", 0.38, 1.28, (0.0, 0.0, 1.05), mats["stone"], fountain, vertices=28, bevel=0.045)
    cylinder("Upper_Bowl", 1.05, 0.22, (0.0, 0.0, 1.73), mats["stone_light"], fountain, vertices=40, bevel=0.060)
    cylinder("Upper_Water", 0.88, 0.035, (0.0, 0.0, 1.86), mats["water"], fountain, vertices=40, bevel=0.008)
    cylinder("Finial", 0.13, 0.78, (0.0, 0.0, 2.20), mats["brass"], fountain, vertices=20, bevel=0.025)
    cylinder("Central_WaterJet", 0.035, 0.85, (0.0, 0.0, 2.88), mats["water"], fountain, vertices=10, bevel=0.006)
    for jet_index in range(6):
        angle = jet_index * math.tau / 6.0
        points = []
        for segment in range(6):
            t = segment / 5.0
            radius = 0.62 + 1.18 * t
            points.append((
                math.cos(angle) * radius,
                math.sin(angle) * radius,
                1.82 + math.sin(t * math.pi) * 0.48 - t * 1.24,
            ))
        for segment in range(5):
            cylinder_between(f"CascadeJet_{jet_index}_{segment}", points[segment], points[segment + 1],
                             0.013, mats["water"], fountain, vertices=8)

    # Porte cochere, bag drop and four-cart staging lanes.
    box("MODULE_BagDrop_Paving", (10.8, 7.3, 0.13), (8.0, FRONT_Y - 8.0, 0.065), mats["paver"], bag_drop, bevel=0.028)
    bag_columns = ((4.7, FRONT_Y - 5.15), (10.8, FRONT_Y - 5.15),
                   (4.7, FRONT_Y - 10.55), (10.8, FRONT_Y - 10.55))
    for index, (x, y) in enumerate(bag_columns):
        linked_copy_tree(column_master, f"Column_BagDrop_{index}", bag_drop, (x, y, 0.14))
    hip_roof("MODULE_Roof_PorteCochere", 7.4, 6.2, 3.82, 5.18, mats["clay"], bag_drop,
             center=(7.75, FRONT_Y - 7.85), overhang=0.38)
    sign_bar = empty("MODULE_BagDrop_Sign", bag_drop)
    sign_bar.location = (7.75, FRONT_Y - 10.88, 3.16)
    box("Sign_Back", (3.2, 0.16, 0.54), (0.0, 0.0, 0.0), mats["green"], sign_bar, bevel=0.06)
    add_text("BagDrop_Letters", "BAG DROP", (0.0, -0.095, 0.0), 0.28, 0.018, mats["brass"], sign_bar)
    add_text("BagDrop_Letters_Reverse", "BAG DROP", (0.0, 0.095, 0.0), 0.28, 0.018, mats["brass"], sign_bar,
             rotation=(-math.pi / 2, 0.0, math.pi))
    rack = empty("MODULE_BagRack", bag_drop, module_type="bag_drop_rack")
    rack.location = (4.2, FRONT_Y - 5.0, 0.16)
    box("Rack_Base", (2.9, 0.62, 0.12), (0.0, 0.0, 0.06), mats["walnut"], rack, bevel=0.035)
    for index in range(7):
        x = -1.25 + index * (2.50 / 6)
        box(f"Rack_Divider_{index}", (0.06, 0.52, 0.85), (x, 0.0, 0.49), mats["walnut"], rack, bevel=0.018)
    box("Rack_Header", (2.9, 0.22, 0.18), (0.0, 0.0, 0.96), mats["green"], rack, bevel=0.035)
    add_text("BagRack_Letters", "GUEST BAGS", (0.0, -0.13, 0.96), 0.16, 0.012, mats["brass"], rack)
    bag_master = golf_bag_module("MODULE_GuestBag_Master", mats, rack)
    bag_master.location = (-0.86, -0.03, 0.14)
    for index, x in enumerate((-0.42, 0.03, 0.48, 0.93), start=2):
        linked_copy_tree(bag_master, f"GuestBag_{index:02d}", rack, (x, -0.03, 0.14),
                         rotation_z=(index % 2) * 0.08)
    # Cart staging is an organized apron with four marked bays and a covered walk.
    staging = empty("MODULE_CartStaging_FourBay", bag_drop, module_type="cart_staging")
    staging.location = (14.8, FRONT_Y - 5.4, 0.0)
    box("Staging_Apron", (8.2, 13.0, 0.12), (0.0, 0.0, 0.06), mats["paver"], staging, bevel=0.018)
    for index in range(5):
        x = -3.8 + index * 1.9
        box(f"Bay_Line_{index}", (0.07, 6.1, 0.018), (x, 1.4, 0.13), mats["stone_light"], staging, bevel=0.004)
    for index in range(4):
        add_text(f"Bay_Number_{index+1}", str(index + 1), (-2.85 + index * 1.9, -1.1, 0.145), 0.40, 0.008,
                 mats["stone_light"], staging, rotation=(0.0, 0.0, 0.0))
    hip_roof("MODULE_Roof_CartStaging", 8.2, 5.2, 3.18, 4.35, mats["clay"], staging,
             center=(0.0, 4.4), overhang=0.30)
    box("Staging_FrontBeam", (8.05, 0.22, 0.30), (0.0, 1.95, 3.03), mats["walnut"], staging, bevel=0.035)
    box("Staging_RearBeam", (8.05, 0.22, 0.30), (0.0, 6.85, 3.03), mats["walnut"], staging, bevel=0.035)
    box("Staging_SignPanel", (3.9, 0.16, 0.52), (0.0, 1.80, 2.65), mats["green"], staging, bevel=0.055)
    add_text("Staging_SignLetters", "CART STAGING", (0.0, 1.69, 2.65), 0.25, 0.016,
             mats["brass"], staging)
    for x in (-3.55, 3.55):
        for y in (2.1, 6.65):
            box("Staging_Post", (0.16, 0.16, 3.18), (x, y, 1.59), mats["charcoal"], staging, bevel=0.025)
            box("Staging_StoneFoot", (0.42, 0.42, 0.38), (x, y, 0.19), mats["stone"], staging, bevel=0.045)
    cart_master = golf_cart_module("MODULE_GolfCart_Master", mats, staging)
    cart_master.location = (-0.95, 4.42, 0.13)
    cart_master.rotation_euler.z = math.pi
    linked_copy_tree(cart_master, "GolfCart_Staged_02", staging, (0.95, 4.42, 0.13),
                     rotation_z=math.pi)

    # Rear hospitality patio, covered pergola and two water-rill basins.
    box("MODULE_Patio_LargeRear", (19.0, 8.0, 0.15), (0.0, BACK_Y + 4.0, 0.075), mats["paver"], patio, bevel=0.028,
        props={"large_patio": True, "outdoor_seating_zone": True})
    oval_bed("MODULE_LandscapeIsland_RearPatioWest", 4.6, 0.92, 0.15,
             (-4.9, BACK_Y + 8.25, 0.075), mats["mulch"], landscape)
    oval_ring("MODULE_LandscapeIsland_RearPatioWestCurb", 4.82, 1.14, 4.56, 0.88, 0.14,
              (-4.9, BACK_Y + 8.25, 0.07), mats["stone_light"], landscape)
    oval_bed("MODULE_LandscapeIsland_RearPatioEast", 4.6, 0.92, 0.15,
             (4.9, BACK_Y + 8.25, 0.075), mats["mulch"], landscape)
    oval_ring("MODULE_LandscapeIsland_RearPatioEastCurb", 4.82, 1.14, 4.56, 0.88, 0.14,
              (4.9, BACK_Y + 8.25, 0.07), mats["stone_light"], landscape)
    pergola = empty("MODULE_Pergola_CoveredWalkway", patio, module_type="covered_walkway")
    pergola.location = (-4.2, BACK_Y + 2.8, 0.14)
    for x in (-5.4, -1.8, 1.8, 5.4):
        for y in (-2.15, 2.15):
            column = box("Pergola_Column", (0.26, 0.26, 3.25), (x, y, 1.625), mats["stucco_light"], pergola, bevel=0.035)
            box("Pergola_StoneFoot", (0.46, 0.46, 0.44), (x, y, 0.22), mats["stone"], pergola, bevel=0.045)
    for y in (-2.15, 2.15):
        box("Pergola_MainBeam", (11.2, 0.24, 0.30), (0.0, y, 3.28), mats["walnut"], pergola, bevel=0.035)
    for index in range(13):
        x = -5.4 + index * 0.9
        box(f"Pergola_Rafter_{index:02d}", (0.13, 5.0, 0.18), (x, 0.0, 3.52), mats["oak"], pergola, bevel=0.025)
    table_master = patio_table_module("MODULE_PatioDiningSet_Master", mats, patio)
    table_master.location = (-5.6, BACK_Y + 3.45, 0.15)
    for index, loc in enumerate(((0.0, BACK_Y + 5.05, 0.15), (5.6, BACK_Y + 3.45, 0.15))):
        linked_copy_tree(table_master, f"PatioDiningSet_{index+1}", patio, loc,
                         rotation_z=(math.pi / 8, -math.pi / 8)[index])
    for side, x in (("West", -8.0), ("East", 8.0)):
        rill = empty(f"MODULE_WaterRill_{side}", water, module_type="reflecting_rill")
        rill.location = (x, BACK_Y + 4.0, 0.13)
        box("Rill_StoneBasin", (1.25, 6.6, 0.32), (0.0, 0.0, 0.16), mats["stone_light"], rill, bevel=0.045)
        box("Rill_Water", (0.94, 6.25, 0.045), (0.0, 0.0, 0.34), mats["water"], rill, bevel=0.015)

    # Monument signage with restrained brass identity.
    monument = empty("MODULE_Sign_Monument", signage, module_type="luxury_signage")
    monument.location = (-9.0, motor_court_y - 0.10, 0.0)
    box("Sign_Foundation", (4.2, 1.00, 0.22), (0.0, 0.0, 0.11), mats["stone"], monument, bevel=0.055)
    box("Sign_Pier_Left", (0.52, 0.60, 1.68), (-1.62, 0.0, 0.94), mats["stone"], monument, bevel=0.060)
    box("Sign_Pier_Right", (0.52, 0.60, 1.68), (1.62, 0.0, 0.94), mats["stone"], monument, bevel=0.060)
    box("Sign_Panel", (2.95, 0.24, 1.04), (0.0, -0.03, 1.10), mats["green"], monument, bevel=0.11)
    box("Sign_BrassBorder", (3.10, 0.07, 1.18), (0.0, -0.18, 1.10), mats["brass"], monument, bevel=0.07)
    box("Sign_PanelFace", (2.90, 0.05, 1.00), (0.0, -0.23, 1.10), mats["green"], monument, bevel=0.09)
    add_text("Sign_Title", "PINEHOLLOW", (0.0, -0.28, 1.28), 0.245, 0.016, mats["brass"], monument)
    add_text("Sign_Subtitle", "RESORT & GOLF CLUB", (0.0, -0.28, 0.92), 0.135, 0.012, mats["stone_light"], monument)
    # Landscaping masters and linked placements.
    box("MODULE_LandscapeBed_Front", (30.0, 3.0, 0.14), (-1.0, FRONT_Y - 3.7, 0.07), mats["mulch"], landscape, bevel=0.12)
    box("MODULE_LandscapeBed_Rear", (24.0, 2.2, 0.14), (0.0, BACK_Y + 0.9, 0.07), mats["mulch"], landscape, bevel=0.12)
    palm_master = palm_module("MODULE_Palm_Master", mats, landscape)
    palm_master.location = (0.0, BACK_Y + 11.0, 0.10)
    palm_positions = (
        (-25.5, FRONT_Y - 9.8, 0.10),
        (20.0, FRONT_Y - 1.8, 0.10),
        (-11.8, BACK_Y + 7.0, 0.10), (11.8, BACK_Y + 7.0, 0.10),
        (-13.6, 2.4, 0.10), (13.8, 3.9, 0.10),
    )
    for index, loc in enumerate(palm_positions):
        linked_copy_tree(palm_master, f"Palm_{index+1:02d}", landscape, loc, rotation_z=(index * 0.71) % math.tau)
    shrub_master = empty("MODULE_Shrub_Master", landscape, module_type="landscape_shrub")
    # Five overlapping clipped lobes read as maintained resort planting while
    # avoiding the repeated boulder silhouette of a single stretched sphere.
    shrub_lobes = (
        ((-0.34, -0.03, 0.23), (0.48, 0.38, 0.34), "leaf"),
        ((0.30, 0.06, 0.24), (0.46, 0.36, 0.36), "leaf_light"),
        ((0.02, -0.27, 0.28), (0.44, 0.34, 0.39), "leaf"),
        ((-0.08, 0.24, 0.27), (0.41, 0.33, 0.36), "leaf_light"),
        ((0.39, -0.22, 0.20), (0.34, 0.28, 0.29), "leaf"),
        ((-0.38, 0.20, 0.18), (0.31, 0.27, 0.27), "leaf_light"),
        ((0.02, 0.01, 0.43), (0.39, 0.35, 0.40), "leaf"),
    )
    for index, (loc, scale, material_key) in enumerate(shrub_lobes):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.55, location=loc)
        shrub_mesh = bpy.context.object
        shrub_mesh.name = f"Shrub_FoliageLobe_{index:02d}"
        shrub_mesh.scale = scale
        shrub_mesh.data.materials.append(mats[material_key])
        shrub_mesh.parent = shrub_master
        finish_mesh(shrub_mesh, smooth=True)
    shrub_positions = []
    for i in range(14):
        shrub_positions.append((-11.0 + i * 1.55, FRONT_Y - 3.8 - (i % 2) * 0.38, 0.08))
    for i in range(12):
        shrub_positions.append((-10.0 + i * 1.82, BACK_Y + 0.82 + (i % 2) * 0.32, 0.08))
    for side_x in (-12.70, 12.70):
        for i, y in enumerate((-4.5, -2.25, 0.0, 2.25, 4.5)):
            shrub_positions.append((side_x, y, 0.08 + (i % 2) * 0.03))
    shrub_positions.extend((
        (-19.2, FRONT_Y - 11.0, 0.10), (-17.4, FRONT_Y - 10.4, 0.11),
        (-15.5, FRONT_Y - 11.3, 0.09), (-13.4, FRONT_Y - 10.6, 0.12),
        (13.1, FRONT_Y - 13.2, 0.10), (15.0, FRONT_Y - 12.7, 0.12),
        (16.8, FRONT_Y - 13.5, 0.09), (18.3, FRONT_Y - 12.8, 0.11),
        (-8.1, BACK_Y + 8.2, 0.10), (-5.5, BACK_Y + 8.5, 0.12),
        (-2.7, BACK_Y + 8.1, 0.09), (2.8, BACK_Y + 8.1, 0.10),
        (5.4, BACK_Y + 8.5, 0.12), (8.1, BACK_Y + 8.2, 0.09),
        (-12.0, motor_court_y - 0.35, 0.10), (-10.4, motor_court_y + 0.42, 0.12),
        (-6.5, motor_court_y - 0.38, 0.10), (-4.9, motor_court_y + 0.38, 0.11),
        (4.1, motor_court_y - 0.32, 0.10), (5.8, motor_court_y + 0.36, 0.12),
        (8.1, motor_court_y - 0.28, 0.10), (9.5, motor_court_y + 0.34, 0.11),
    ))
    shrub_master.location = shrub_positions[0]
    for index, loc in enumerate(shrub_positions[1:], start=2):
        linked_copy_tree(shrub_master, f"Shrub_{index:02d}", landscape, loc, rotation_z=index * 0.43)
    # A slim Mediterranean cypress screen softens the service-yard sightline
    # without walling off the working cart and delivery circulation.
    cypress_master = empty("MODULE_CypressScreen_Master", landscape, module_type="landscape_screen")
    cylinder("Cypress_Trunk", 0.065, 3.35, (0.0, 0.0, 1.675), mats["walnut"], cypress_master,
             vertices=12, bevel=0.012)
    # Overlapping irregular foliage masses form a tapered but organic cypress;
    # the earlier single cone read like a green traffic marker.
    cypress_lobes = (
        ((0.00, 0.00, 0.82), (0.56, 0.52, 0.95), "leaf"),
        ((0.05, -0.03, 1.45), (0.72, 0.65, 1.02), "leaf_light"),
        ((-0.04, 0.04, 2.12), (0.68, 0.62, 1.08), "leaf"),
        ((0.03, 0.00, 2.80), (0.53, 0.49, 0.92), "leaf_light"),
        ((-0.02, 0.02, 3.42), (0.34, 0.31, 0.70), "leaf"),
    )
    for index, (loc, scale, material_key) in enumerate(cypress_lobes):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.62, location=loc)
        foliage = bpy.context.object
        foliage.name = f"Cypress_FoliageLobe_{index:02d}"
        foliage.scale = scale
        foliage.data.materials.append(mats[material_key])
        foliage.parent = cypress_master
        finish_mesh(foliage, smooth=True)
    cypress_positions = (
        (20.0, FRONT_Y - 8.4, 0.08),
        (20.6, FRONT_Y - 4.8, 0.08),
        (20.1, FRONT_Y - 1.1, 0.08),
    )
    cypress_master.location = cypress_positions[0]
    cypress_master.scale = (0.82, 0.82, 0.92)
    for index, loc in enumerate(cypress_positions[1:], start=2):
        cypress = linked_copy_tree(cypress_master, f"CypressScreen_{index:02d}", landscape, loc,
                                   rotation_z=(index % 3 - 1) * 0.08)
        width_scale = (0.76, 0.88)[index - 2]
        cypress.scale = (width_scale, width_scale, (0.86, 0.96)[index - 2])
    flower_master = empty("MODULE_BougainvilleaPlanter_Master", landscape, module_type="flower_planter")
    cylinder("Planter_Pot", 0.44, 0.34, (0.0, 0.0, 0.17), mats["clay"], flower_master, vertices=28, bevel=0.05)
    cylinder("Planter_Rim", 0.49, 0.10, (0.0, 0.0, 0.36), mats["clay_light"], flower_master, vertices=28, bevel=0.025)
    for index in range(15):
        angle = index * 2.399
        radius = 0.12 + (index % 4) * 0.065
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.085 + (index % 2) * 0.025,
                                             location=(math.cos(angle) * radius, math.sin(angle) * radius,
                                                       0.48 + (index % 4) * 0.095))
        bloom = bpy.context.object
        bloom.name = f"Bloom_{index:02d}"
        bloom.data.materials.append(mats["flower"] if index % 2 else mats["leaf_light"])
        bloom.parent = flower_master
        finish_mesh(bloom, smooth=True)
    flower_positions = ((-3.2, FRONT_Y - 3.05, 0.12), (1.4, FRONT_Y - 3.05, 0.12),
                        (5.6, FRONT_Y - 3.05, 0.12), (-5.5, BACK_Y + 1.2, 0.12),
                        (5.5, BACK_Y + 1.2, 0.12),
                        (-18.0, FRONT_Y - 10.9, 0.12), (-14.5, FRONT_Y - 10.7, 0.12),
                        (14.2, FRONT_Y - 13.1, 0.12), (17.3, FRONT_Y - 13.0, 0.12),
                        (-6.8, BACK_Y + 8.25, 0.12), (-3.3, BACK_Y + 8.25, 0.12),
                        (3.3, BACK_Y + 8.25, 0.12), (6.8, BACK_Y + 8.25, 0.12),
                        (-12.6, motor_court_y - 0.05, 0.12), (-5.8, motor_court_y + 0.05, 0.12),
                        (4.8, motor_court_y + 0.10, 0.12), (8.8, motor_court_y - 0.05, 0.12))
    flower_master.location = flower_positions[0]
    for index, loc in enumerate(flower_positions[1:], start=2):
        linked_copy_tree(flower_master, f"BougainvilleaPlanter_{index}", landscape, loc, index * 0.63)

    # Simplified collision proxies, intentionally separate and non-rendering.
    collision_specs = [
        ("COL_Wall_Front_West", (10.0, 0.30, 4.1), (-7.0, FRONT_Y, 2.35)),
        ("COL_Wall_Front_East", (10.0, 0.30, 4.1), (7.0, FRONT_Y, 2.35)),
        ("COL_Wall_Back", (BUILDING_W, 0.30, 4.1), (0.0, BACK_Y, 2.35)),
        ("COL_Wall_West", (0.30, BUILDING_D, 4.1), (-BUILDING_W / 2, 0.0, 2.35)),
        ("COL_Wall_East", (0.30, BUILDING_D, 4.1), (BUILDING_W / 2, 0.0, 2.35)),
        ("COL_Fountain", (4.8, 4.8, 0.55), (-5.8, FRONT_Y - 8.0, 0.275)),
        ("COL_MonumentSign", (4.2, 1.00, 1.90), (-9.0, motor_court_y - 0.10, 0.95)),
    ]
    for name, dims, loc in collision_specs:
        proxy = box(name, dims, loc, mats["collision"], collisions, bevel=0.0,
                    props={"collision_proxy": True, "collision_shape": "box", "render": False})
        proxy.hide_render = True
        proxy.display_type = "WIRE"
    for index, (x, y) in enumerate(bag_columns):
        proxy = box(f"COL_BagDropColumn_{index}", (0.72, 0.72, 3.6), (x, y, 1.8), mats["collision"], collisions,
                    bevel=0.0, props={"collision_proxy": True, "render": False})
        proxy.hide_render = True
        proxy.display_type = "WIRE"
    for index, x in enumerate(column_xs):
        proxy = box(f"COL_ArcadeColumn_{index}", (0.74, 0.74, 3.72),
                    (x, FRONT_Y - 2.92, 1.86), mats["collision"], collisions,
                    bevel=0.0, props={"collision_proxy": True, "render": False})
        proxy.hide_render = True
        proxy.display_type = "WIRE"
    for index, (x, y) in enumerate((
        (11.25, FRONT_Y - 3.30), (18.35, FRONT_Y - 3.30),
        (11.25, FRONT_Y + 1.25), (18.35, FRONT_Y + 1.25),
    )):
        proxy = box(f"COL_CartStagingPost_{index}", (0.44, 0.44, 3.24), (x, y, 1.62),
                    mats["collision"], collisions, bevel=0.0,
                    props={"collision_proxy": True, "render": False})
        proxy.hide_render = True
        proxy.display_type = "WIRE"
    for index, (x, y) in enumerate((
        (-9.6, BACK_Y + 0.65), (-9.6, BACK_Y + 4.95),
        (-6.0, BACK_Y + 0.65), (-6.0, BACK_Y + 4.95),
        (-2.4, BACK_Y + 0.65), (-2.4, BACK_Y + 4.95),
        (1.2, BACK_Y + 0.65), (1.2, BACK_Y + 4.95),
    )):
        proxy = box(f"COL_PergolaColumn_{index}", (0.48, 0.48, 3.30), (x, y, 1.65),
                    mats["collision"], collisions, bevel=0.0,
                    props={"collision_proxy": True, "render": False})
        proxy.hide_render = True
        proxy.display_type = "WIRE"

    # Stable sockets used by runtime integration and future expansion tools.
    sockets = {
        "SOCKET_MainEntrance": (door_center, FRONT_Y, FLOOR_Z),
        "SOCKET_BagDrop": (7.75, FRONT_Y - 7.85, 0.14),
        "SOCKET_CartStaging": (14.8, FRONT_Y - 5.4, 0.12),
        "SOCKET_Patio": (0.0, BACK_Y + 4.0, 0.15),
        "SOCKET_Fountain": (-5.8, FRONT_Y - 8.0, 0.14),
        "SOCKET_Expansion_West": (-BUILDING_W / 2, 0.0, FLOOR_Z),
        "SOCKET_Expansion_East": (BUILDING_W / 2, 0.0, FLOOR_Z),
        "SOCKET_Expansion_Rear": (0.0, BACK_Y, FLOOR_Z),
        "SOCKET_PLACEMENT": (0.0, 0.0, 0.0),
    }
    for socket_name, location in sockets.items():
        socket = empty(socket_name, root, socket=True)
        socket.location = location

    root["module_catalog"] = json.dumps(sorted({
        "wall-straight", "wall-opening", "arched-window", "double-entry-door", "mediterranean-column",
        "arcade-bay", "hip-roof", "clay-ridge-tile", "covered-walkway", "paver-slab",
        "fountain", "reflecting-rill", "date-palm", "landscape-shrub", "flower-planter",
        "outdoor-dining-set", "pergola", "bag-rack", "guest-bag", "staged-golf-cart",
        "cart-staging", "monument-sign", "landscape-screen",
    }))
    return root, {
        "mainRoof": main_roof,
        "windowMaster": window_master,
        "door": door,
        "columnMaster": column_master,
        "arcadeMaster": arcade_master,
        "palmMaster": palm_master,
        "tableMaster": table_master,
        "cartMaster": cart_master,
        "bagMaster": bag_master,
    }


def descendants(root: bpy.types.Object) -> list[bpy.types.Object]:
    result: list[bpy.types.Object] = []
    stack = [root]
    while stack:
        node = stack.pop()
        result.append(node)
        stack.extend(node.children)
    return result


def export_glb(root: bpy.types.Object, path: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in descendants(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_animations=True,
        export_materials="EXPORT",
    )


def optimize_runtime_tree(root: bpy.types.Object) -> dict[str, int]:
    """Collapse immutable presentation meshes while retaining interaction nodes."""
    before = descendants(root)
    before_meshes = [obj for obj in before if obj.type == "MESH"]
    collision = [obj for obj in before if obj.get("collision_proxy")]
    for obj in collision:
        bpy.data.objects.remove(obj, do_unlink=True)

    dynamic_nodes: set[bpy.types.Object] = set()
    for name in ("PIVOT_DoorLeft", "PIVOT_DoorRight"):
        pivot = bpy.data.objects.get(name)
        if pivot:
            dynamic_nodes.update(descendants(pivot))
    sockets = {obj for obj in descendants(root) if obj.get("socket")}

    # Font curves become ordinary static meshes in the runtime companion. The
    # modular source and canonical export were already saved before this pass.
    for obj in list(descendants(root)):
        if obj.type != "FONT" or obj in dynamic_nodes:
            continue
        world = obj.matrix_world.copy()
        obj.parent = root
        obj.matrix_world = world
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.convert(target="MESH")

    buckets: dict[str, list[bpy.types.Object]] = {}
    for obj in descendants(root):
        if obj.type != "MESH" or obj in dynamic_nodes or obj.get("collision_proxy"):
            continue
        world = obj.matrix_world.copy()
        obj.parent = root
        obj.matrix_world = world
        material_name = obj.data.materials[0].name if obj.data.materials else "NoMaterial"
        buckets.setdefault(material_name, []).append(obj)

    batch_count = 0
    for material_name, objects in buckets.items():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.hide_set(False)
            obj.select_set(True)
        active = objects[0]
        bpy.context.view_layer.objects.active = active
        if len(objects) > 1:
            bpy.ops.object.join()
        active.name = "RUNTIME_BATCH_" + "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in material_name)
        active["runtime_static_batch"] = True
        active["source_mesh_count"] = len(objects)
        active.parent = root
        batch_count += 1

    # Door pivots and expansion/interaction sockets are the only non-render
    # hierarchy the optimized companion needs. Preserve world transforms while
    # dropping thousands of now-empty module containers.
    keep = {root, *dynamic_nodes, *sockets}
    for obj in [*dynamic_nodes, *sockets]:
        if obj is root or obj.parent in dynamic_nodes:
            continue
        world = obj.matrix_world.copy()
        obj.parent = root
        obj.matrix_world = world
    for obj in list(descendants(root)):
        if obj is root or obj in keep or obj.type == "MESH":
            continue
        bpy.data.objects.remove(obj, do_unlink=True)

    root["runtime_optimized"] = True
    root["runtime_static_batch_count"] = batch_count
    root["runtime_source_mesh_count"] = len(before_meshes)
    bpy.context.view_layer.update()
    after = descendants(root)
    return {
        "sourceObjects": len(before),
        "sourceMeshes": len(before_meshes),
        "runtimeObjects": len(after),
        "runtimeMeshes": sum(obj.type == "MESH" for obj in after),
        "staticBatches": batch_count,
        "preservedDoorNodes": len(dynamic_nodes),
        "preservedSockets": len(sockets),
        "removedCollisionProxies": len(collision),
    }


def preview(root: bpy.types.Object) -> None:
    ground_mat = material("QA_Ground", (0.095, 0.19, 0.075, 1.0), roughness=0.98)
    qa_root = empty("QA_PREVIEW_ONLY")
    box("QA_GroundPlane", (62.0, 58.0, 0.10), (0.0, 1.0, -0.06), ground_mat, qa_root, bevel=0.02)
    bpy.ops.object.camera_add(location=(37.0, -43.0, 25.0))
    camera = bpy.context.object
    camera.name = "QA_Camera_Hero"
    target = Vector((0.0, -1.8, 3.1))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.lens = 48
    bpy.context.scene.camera = camera
    bpy.ops.object.light_add(type="SUN", location=(12.0, -18.0, 28.0))
    sun = bpy.context.object
    sun.name = "QA_Sun"
    sun.rotation_euler = (math.radians(28), math.radians(-18), math.radians(-32))
    sun.data.energy = 2.4
    sun.data.angle = math.radians(18)
    bpy.ops.object.light_add(type="AREA", location=(-10.0, -18.0, 18.0))
    key = bpy.context.object
    key.name = "QA_Key"
    key.data.energy = 1900
    key.data.shape = "DISK"
    key.data.size = 12.0
    key.rotation_euler = ((Vector((0.0, -2.0, 3.0)) - key.location).to_track_quat("-Z", "Y").to_euler())
    bpy.ops.object.light_add(type="AREA", location=(0.0, 0.0, 3.65))
    interior_fill = bpy.context.object
    interior_fill.name = "QA_InteriorFill"
    interior_fill.data.energy = 850
    interior_fill.data.shape = "RECTANGLE"
    interior_fill.data.size = 13.0
    interior_fill.data.size_y = 7.0
    interior_fill.rotation_euler = (0.0, 0.0, 0.0)
    world = bpy.context.scene.world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.20, 0.34, 0.55, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.45
    bpy.context.scene.view_settings.look = "AgX - Medium High Contrast"
    shots = (
        (PREVIEW_PATH, (37.0, -43.0, 25.0), (0.0, -1.8, 3.1), 48),
        (PREVIEW_FRONT_PATH, (1.0, -43.0, 7.0), (0.0, -5.8, 2.6), 52),
        (PREVIEW_REAR_PATH, (-28.0, 35.0, 14.0), (0.0, 10.2, 2.2), 50),
        # With the front wall between large apertures, this camera proves the
        # authored shell contains no counters, retail fixtures, or furniture.
        (PREVIEW_INTERIOR_PATH, (-0.8, -5.2, 1.72), (0.0, 4.5, 1.5), 36),
    )
    for path, location, target_point, lens in shots:
        camera.location = location
        target = Vector(target_point)
        camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
        camera.data.lens = lens
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)


def clean_manifest(root: bpy.types.Object, modules: dict[str, bpy.types.Object]) -> dict[str, object]:
    meshes = [obj for obj in descendants(root) if obj.type == "MESH"]
    materials = {mat.name for obj in meshes for mat in obj.data.materials if mat}
    triangles = sum(len(obj.data.loop_triangles) if obj.data.loop_triangles else len(obj.data.polygons) * 2 for obj in meshes)
    unapplied = [obj.name for obj in meshes if any(abs(value - 1.0) > 1e-6 for value in obj.scale)]
    permanent_furniture = [obj.name for obj in descendants(root) if obj.get("interior_furniture")]
    collision = [obj.name for obj in descendants(root) if obj.get("collision_proxy")]
    return {
        "asset": root.name,
        "source": str(SOURCE_PATH.relative_to(REPO)).replace("\\", "/"),
        "canonicalGlb": str(CANONICAL_GLB.relative_to(REPO)).replace("\\", "/"),
        "runtimeGlb": str(RUNTIME_GLB.relative_to(REPO)).replace("\\", "/"),
        "preview": str(PREVIEW_PATH.relative_to(REPO)).replace("\\", "/"),
        "previewFront": str(PREVIEW_FRONT_PATH.relative_to(REPO)).replace("\\", "/"),
        "previewRearPatio": str(PREVIEW_REAR_PATH.relative_to(REPO)).replace("\\", "/"),
        "previewEmptyInterior": str(PREVIEW_INTERIOR_PATH.relative_to(REPO)).replace("\\", "/"),
        "dimensionsMeters": {"width": BUILDING_W, "depth": BUILDING_D, "roofHeight": 8.42},
        "conditionedArea": {"squareMeters": BUILDING_AREA_M2, "squareFeet": BUILDING_AREA_SQFT},
        "interior": {"intentionallyEmpty": len(permanent_furniture) == 0, "permanentFurniture": permanent_furniture},
        "modules": {name: obj.name for name, obj in modules.items()},
        "objectCount": len(descendants(root)),
        "meshCount": len(meshes),
        "triangleEstimate": triangles,
        "materialCount": len(materials),
        "collisionProxyCount": len(collision),
        "unappliedScaleObjects": unapplied,
        "sourceLineage": "Original in-repository Blender geometry; no external assets",
    }


def main() -> int:
    ensure_dirs()
    reset_scene()
    root, modules = build()
    bpy.context.view_layer.update()
    # Saving before QA objects are added keeps the editable production source clean.
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_PATH))
    export_glb(root, CANONICAL_GLB)
    manifest = clean_manifest(root, modules)
    preview(root)
    manifest["runtimeOptimization"] = optimize_runtime_tree(root)
    export_glb(root, RUNTIME_GLB)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("RESORT_CLUBHOUSE_BUILD|" + json.dumps(manifest, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
