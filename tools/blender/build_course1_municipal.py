"""Build the Course 1 failing-municipal clubhouse architecture.

Authoritative dimensions are meters. The assembled enclosed footprint is
12.80 m x 9.75 m (124.80 m2 / 1,343.75 sq ft). Front is Blender -Y, which the
glTF exporter maps to the game's +Z clubhouse-local direction.

This script never opens or overwrites the former Sheet-06 raw sources. It saves
a new traceable .blend and exports the selected production roots to the
canonical and runtime GLB destinations.
"""

from __future__ import annotations

import json
import math
import os
import random
from pathlib import Path

import bpy
from mathutils import Vector


REPO = Path(r"C:\Users\Kenneth\Documents\GitHub\Golf-Flipper-course1-failing-municipal")
SOURCE_DIR = REPO / "asset_sources" / "blender" / "course1_municipal"
CANONICAL_DIR = REPO / "Assets" / "course1_municipal" / "glb"
RUNTIME_DIR = REPO / "vendor" / "models" / "course1_municipal"
TEXTURE_DIR = REPO / "Assets" / "course1_municipal" / "textures"
BLEND_PATH = SOURCE_DIR / "course1_municipal_clubhouse_architecture_v001.blend"
GLB_NAME = "course1_municipal_clubhouse_architecture.glb"

BUILDING_W = 12.80
BUILDING_D = 9.75
FLOOR_Z = 0.20
CEILING_Z = 2.85
EAVE_Z = 3.05
WALL_T = 0.22
PARTITION_T = 0.12
ROOF_PITCH = 4.0 / 12.0
ROOF_RISE = (BUILDING_W / 2.0) * ROOF_PITCH
RIDGE_Z = EAVE_Z + ROOF_RISE

MAIN_DOOR_X = -0.65
MAIN_DOOR_W = 1.80
MAIN_DOOR_H = 2.15
SERVICE_DOOR_Y = 1.85
MAINTENANCE_DOOR_X = 3.95
WINDOW_W = 1.20
WINDOW_H = 1.25
WINDOW_SILL = 0.88

PALETTE = {
    "warm_cream": (0.82, 0.78, 0.66, 1.0),
    "deep_golf_green": (0.075, 0.18, 0.13, 1.0),
    "faded_green": (0.20, 0.31, 0.25, 1.0),
    "muted_sage": (0.38, 0.48, 0.39, 1.0),
    "medium_walnut": (0.26, 0.13, 0.065, 1.0),
    "natural_oak": (0.52, 0.32, 0.13, 1.0),
    "warm_charcoal": (0.095, 0.09, 0.082, 1.0),
    "restrained_brass": (0.45, 0.29, 0.095, 1.0),
}


def clear_scene() -> None:
    # Remove every object datablock, including hidden/unlinked remnants from a
    # prior QA composition. Operator-only deletion can leave orphaned names and
    # produce non-deterministic `.001` node suffixes in the exported GLB.
    for block in list(bpy.data.objects):
        bpy.data.objects.remove(block, do_unlink=True)
    for block in list(bpy.data.collections):
        if block.name != bpy.context.scene.collection.name:
            bpy.data.collections.remove(block)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.fonts,
                       bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)
    for block in list(bpy.data.images):
        if block.name != "Render Result":
            bpy.data.images.remove(block)


def collection(name: str, parent: bpy.types.Collection | None = None) -> bpy.types.Collection:
    result = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(result)
    return result


def move_to_collection(obj: bpy.types.Object, target: bpy.types.Collection) -> None:
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    target.objects.link(obj)


def tag(obj: bpy.types.Object, module: str, lod: int = 0, collision: bool = False) -> None:
    obj["course1_municipal"] = True
    obj["module_id"] = module
    obj["lod"] = lod
    obj["collision_proxy"] = collision
    obj["units"] = "meters"


def material(name: str, color, roughness: float, metallic: float = 0.0,
             texture: bpy.types.Image | None = None,
             transmission: float = 0.0,
             emission_strength: float = 0.0) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = color
    principled = mat.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = metallic
    alpha_input = principled.inputs.get("Alpha")
    if alpha_input:
        alpha_input.default_value = color[3]
    transmission_input = (principled.inputs.get("Transmission Weight") or
                          principled.inputs.get("Transmission"))
    if transmission_input:
        transmission_input.default_value = transmission
    if emission_strength > 0.0:
        emission_color = (principled.inputs.get("Emission Color") or
                          principled.inputs.get("Emission"))
        emission_input = principled.inputs.get("Emission Strength")
        if emission_color:
            emission_color.default_value = color
        if emission_input:
            emission_input.default_value = emission_strength
    if color[3] < 0.999:
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "DITHERED"
        elif hasattr(mat, "blend_method"):
            mat.blend_method = "BLEND"
    if texture:
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = texture
        tex.interpolation = "Linear"
        mat.node_tree.links.new(tex.outputs["Color"], principled.inputs["Base Color"])
    return mat


def _hash_noise(x: int, y: int, seed: int) -> float:
    n = x * 374761393 + y * 668265263 + seed * 69069
    n = (n ^ (n >> 13)) * 1274126177
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


def make_texture(name: str, mode: str, size: int = 512) -> bpy.types.Image:
    """Generate a project-owned stylized PBR base-color texture."""
    TEXTURE_DIR.mkdir(parents=True, exist_ok=True)
    path = TEXTURE_DIR / f"{name}.png"
    image = bpy.data.images.new(name, width=size, height=size, alpha=True)
    pixels = [0.0] * (size * size * 4)
    for y in range(size):
        for x in range(size):
            n = _hash_noise(x, y, 71)
            broad = _hash_noise(x // 8, y // 8, 19)
            if mode == "siding":
                # The physical battens carry the board rhythm. The texture only
                # supplies fine vertical grain, sun fade and restrained paint
                # variation, avoiding the false horizontal/metal-panel grid a
                # repeated board image created across modular wall rectangles.
                fine_grain = _hash_noise(x // 2, y // 20, 97)
                vertical_wash = _hash_noise(x // 18, y // 96, 43)
                lower_dirt = max(0.0, 0.22 - y / size) * 0.075
                # Course daylight and the deep porch overhang both darken the
                # texture in-engine. This mid-value faded green keeps the wall
                # readable from the player camera without becoming saturated.
                base = (0.335, 0.500, 0.385)
                fade = 0.88 + broad * 0.08 + vertical_wash * 0.045
                rgb = [component * fade + (fine_grain - 0.5) * 0.014 - lower_dirt
                       for component in base]
            elif mode == "asphalt_roof":
                row = y // 34
                tab = ((x + (row % 2) * 31) // 62) % 2
                edge = (y % 34) < 3 or ((x + (row % 2) * 31) % 62) < 2
                value = 0.105 + 0.045 * broad + 0.018 * n + 0.012 * tab
                rgb = [value * 0.92, value * 0.90, value * 0.84]
                if edge:
                    rgb = [component * 0.55 for component in rgb]
            elif mode == "concrete":
                value = 0.47 + (broad - 0.5) * 0.08 + (n - 0.5) * 0.025
                rgb = [value * 1.03, value, value * 0.92]
            elif mode == "drywall":
                value = 0.75 + (broad - 0.5) * 0.035 + (n - 0.5) * 0.012
                lower_stain = max(0.0, (0.18 - y / size) * 0.28)
                rgb = [value - lower_stain * 0.6, value * 0.97 - lower_stain, value * 0.87 - lower_stain]
            else:
                value = 0.5 + (n - 0.5) * 0.1
                rgb = [value, value, value]
            index = (y * size + x) * 4
            pixels[index:index + 4] = [max(0.0, min(1.0, c)) for c in rgb] + [1.0]
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    return image


def box(name: str, dims, loc, mat: bpy.types.Material | None,
        target: bpy.types.Collection, bevel: float = 0.012,
        module: str = "MOD_BOX", lod: int = 0,
        collision: bool = False, rotation=(0.0, 0.0, 0.0)) -> bpy.types.Object:
    # Dimension the unrotated primitive in its own local axes first. Assigning
    # Object.dimensions after rotation uses the world-aligned bounds and can
    # stretch pitched roofs/ramp panels into enormous diagonal blades.
    bpy.ops.mesh.primitive_cube_add(location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler = rotation
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    if bevel > 0.0:
        modifier = obj.modifiers.new("EdgeSoftening", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = "ANGLE"
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    if mat:
        obj.data.materials.append(mat)
    move_to_collection(obj, target)
    tag(obj, module, lod, collision)
    return obj


def scale_uv(obj: bpy.types.Object, u_scale: float, v_scale: float) -> None:
    """Tile an object's authored UVs at a real-world-appropriate density."""
    if obj.type != "MESH" or not obj.data.uv_layers:
        return
    for layer in obj.data.uv_layers:
        for loop in layer.data:
            loop.uv.x *= u_scale
            loop.uv.y *= v_scale


def cylinder(name: str, radius: float, depth: float, loc, mat,
             target, vertices: int = 20, module: str = "MOD_CYLINDER",
             rotation=(0.0, 0.0, 0.0)) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth,
                                       location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = polygon.normal.z < 0.9 and polygon.normal.z > -0.9
    move_to_collection(obj, target)
    tag(obj, module)
    return obj


def curve_tube(name: str, points, bevel_depth: float, mat, target,
               module: str, cyclic: bool = False, resolution: int = 1) -> bpy.types.Object:
    data = bpy.data.curves.new(name + "_CURVE", type="CURVE")
    data.dimensions = "3D"
    data.resolution_u = resolution
    data.bevel_depth = bevel_depth
    data.bevel_resolution = 2
    spline = data.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, coord in zip(spline.points, points):
        point.co = (*coord, 1.0)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, data)
    target.objects.link(obj)
    data.materials.append(mat)
    tag(obj, module)
    return obj


def text_mesh(name: str, body: str, loc, size: float, mat, target,
              align="CENTER", extrude=0.012,
              rotation=(math.radians(90), 0.0, 0.0)) -> bpy.types.Object:
    bpy.ops.object.text_add(location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.body = body
    obj.data.align_x = align
    obj.data.align_y = "CENTER"
    obj.data.size = size
    obj.data.extrude = extrude
    obj.data.bevel_depth = 0.003
    obj.data.materials.append(mat)
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    move_to_collection(obj, target)
    tag(obj, "MOD_SIGN_LETTERING")
    return obj


def irregular_patch(name: str, width: float, height: float, loc, mat, target,
                    module: str, seed: int, rotation=(0.0, 0.0, 0.0),
                    thickness: float = 0.006) -> bpy.types.Object:
    """Create a thin, reusable non-rectangular repair/paint-loss patch."""
    rng = random.Random(seed)
    outline = [(-0.50, -0.26), (-0.36, -0.50), (-0.08, -0.43),
               (0.20, -0.49), (0.48, -0.29), (0.42, -0.03),
               (0.50, 0.28), (0.24, 0.48), (-0.04, 0.42),
               (-0.31, 0.50), (-0.48, 0.23)]
    verts = []
    for u, v in outline:
        jitter = 0.94 + rng.uniform(-0.06, 0.06)
        verts.append((u * width * jitter, v * height * jitter, 0.0))
    mesh = bpy.data.meshes.new(name + "_MESH")
    mesh.from_pydata(verts, [], [tuple(range(len(verts)))])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = rotation
    mesh.materials.append(mat)
    tag(obj, module)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(island_margin=0.04)
    bpy.ops.object.mode_set(mode="OBJECT")
    solidify = obj.modifiers.new("PatchThickness", "SOLIDIFY")
    solidify.thickness = thickness
    solidify.offset = 0.0
    bevel = obj.modifiers.new("BrokenPaintEdge", "BEVEL")
    bevel.width = min(width, height) * 0.018
    bevel.segments = 2
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    obj.select_set(False)
    return obj


def complement(intervals, lower: float, upper: float):
    cursor = lower
    result = []
    for start, end in sorted(intervals):
        start = max(lower, start)
        end = min(upper, end)
        if start > cursor + 1e-5:
            result.append((cursor, start))
        cursor = max(cursor, end)
    if cursor < upper - 1e-5:
        result.append((cursor, upper))
    return result


def wall_with_openings(name: str, axis: str, fixed: float, length: float,
                       exterior_sign: float, openings, mats, target,
                       wear_seed: int) -> None:
    """Build layered core/drywall/board-and-batten wall rectangles."""
    z_values = {FLOOR_Z, EAVE_Z}
    for opening in openings:
        z_values.add(FLOOR_Z + opening.get("bottom", 0.0))
        z_values.add(FLOOR_Z + opening.get("bottom", 0.0) + opening["height"])
    levels = sorted(value for value in z_values if FLOOR_Z <= value <= EAVE_Z)
    span_index = 0
    for z0, z1 in zip(levels, levels[1:]):
        mid = (z0 + z1) / 2.0
        blocked = []
        for opening in openings:
            bottom = FLOOR_Z + opening.get("bottom", 0.0)
            top = bottom + opening["height"]
            if bottom < mid < top:
                blocked.append((opening["center"] - opening["width"] / 2.0,
                                opening["center"] + opening["width"] / 2.0))
        for start, end in complement(blocked, -length / 2.0, length / 2.0):
            run = end - start
            along = (start + end) / 2.0
            height = z1 - z0
            z = (z0 + z1) / 2.0
            if axis == "X":
                core_dims = (run, WALL_T - 0.045, height)
                core_loc = (along, fixed, z)
                out_loc = (along, fixed + exterior_sign * (WALL_T / 2.0 - 0.002), z)
                in_loc = (along, fixed - exterior_sign * (WALL_T / 2.0 - 0.010), z)
                # Slight overlap removes light leaks between reusable rectangles
                # while preserving each module as a discrete customization part.
                panel_dims = (run + 0.004, 0.028, height + 0.004)
                dry_dims = (run + 0.003, 0.018, height + 0.003)
            else:
                core_dims = (WALL_T - 0.045, run, height)
                core_loc = (fixed, along, z)
                out_loc = (fixed + exterior_sign * (WALL_T / 2.0 - 0.002), along, z)
                in_loc = (fixed - exterior_sign * (WALL_T / 2.0 - 0.010), along, z)
                panel_dims = (0.028, run + 0.004, height + 0.004)
                dry_dims = (0.018, run + 0.003, height + 0.003)
            box(f"{name}_CORE_{span_index:02d}", core_dims, core_loc, mats["wall_core"], target,
                bevel=0.0, module="MOD_WALL_CORE")
            variation = (span_index + wear_seed) % 4
            box(f"{name}_SIDING_FIELD_{span_index:02d}", panel_dims, out_loc,
                mats[f"siding_{variation}"], target, bevel=0.0, module="MOD_SIDING_FIELD")
            box(f"{name}_DRYWALL_{span_index:02d}", dry_dims, in_loc, mats["drywall"], target,
                bevel=0.0, module="MOD_INTERIOR_DRYWALL")
            span_index += 1

    # Reusable battens make the siding read at first-person distance. Split them
    # vertically around openings so no trim crosses glass or door leaves.
    spacing = 0.40
    position = -length / 2.0 + 0.20
    batten_index = 0
    while position < length / 2.0 - 0.05:
        blocked_z = []
        for opening in openings:
            lo = opening["center"] - opening["width"] / 2.0 - 0.025
            hi = opening["center"] + opening["width"] / 2.0 + 0.025
            if lo < position < hi:
                bottom = FLOOR_Z + opening.get("bottom", 0.0)
                blocked_z.append((bottom, bottom + opening["height"]))
        for z0, z1 in complement(blocked_z, FLOOR_Z + 0.03, EAVE_Z - 0.03):
            height = z1 - z0
            z = (z0 + z1) / 2.0
            warped = ((batten_index + wear_seed * 3) % 17 == 0)
            lean = math.radians(0.7 if warped else 0.0)
            if axis == "X":
                loc = (position, fixed + exterior_sign * (WALL_T / 2.0 + 0.020), z)
                dims = (0.055, 0.030, height)
                rotation = (0.0, lean * exterior_sign, 0.0)
            else:
                loc = (fixed + exterior_sign * (WALL_T / 2.0 + 0.020), position, z)
                dims = (0.030, 0.055, height)
                rotation = (lean * exterior_sign, 0.0, 0.0)
            box(f"{name}_BATTEN_{batten_index:03d}", dims, loc,
                mats[f"siding_{(batten_index + wear_seed) % 4}"], target,
                bevel=0.004, module="MOD_SIDING_BATTEN", rotation=rotation)
            batten_index += 1
        position += spacing

    floor_openings = []
    for opening in openings:
        if opening.get("bottom", 0.0) <= 1e-5:
            floor_openings.append((opening["center"] - opening["width"] / 2.0,
                                   opening["center"] + opening["width"] / 2.0))
    for index, (start, end) in enumerate(complement(floor_openings, -length / 2.0,
                                                    length / 2.0)):
        run = end - start
        along = (start + end) / 2.0
        if axis == "X":
            dims = (run, 0.025, 0.09)
            loc = (along, fixed - exterior_sign * (WALL_T / 2.0 + 0.012),
                   FLOOR_Z + 0.045)
        else:
            dims = (0.025, run, 0.09)
            loc = (fixed - exterior_sign * (WALL_T / 2.0 + 0.012), along,
                   FLOOR_Z + 0.045)
        box(f"{name}_INTERIOR_RUBBER_BASE_{index:02d}", dims, loc,
            mats["rubber_base"], target, bevel=0.004,
            module="MOD_INTERIOR_BASE_TRIM")


def partition_with_openings(name: str, axis: str, fixed: float, length: float,
                            openings, mats, target) -> None:
    """Build an interior-only modular partition with finished jambs.

    This deliberately does not call ``wall_with_openings``: an early visual
    review caught exterior board-and-batten being exposed on the service-spine
    face. Both sides of every interior partition are old drywall with a scuffed
    rubber base, while the core, casings and door heads remain separate modules.
    """
    levels = {FLOOR_Z, CEILING_Z}
    for opening in openings:
        levels.add(FLOOR_Z + opening.get("bottom", 0.0))
        levels.add(FLOOR_Z + opening.get("bottom", 0.0) + opening["height"])
    ordered = sorted(value for value in levels if FLOOR_Z <= value <= CEILING_Z)
    span_index = 0
    base_segments = []
    for z0, z1 in zip(ordered, ordered[1:]):
        mid = (z0 + z1) / 2.0
        blocked = []
        for opening in openings:
            bottom = FLOOR_Z + opening.get("bottom", 0.0)
            top = bottom + opening["height"]
            if bottom < mid < top:
                blocked.append((opening["center"] - opening["width"] / 2.0,
                                opening["center"] + opening["width"] / 2.0))
        for start, end in complement(blocked, -length / 2.0, length / 2.0):
            run = end - start
            along = (start + end) / 2.0
            height = z1 - z0
            z = (z0 + z1) / 2.0
            if axis == "X":
                core_dims, core_loc = (run, PARTITION_T, height), (along, fixed, z)
                dry_dims = (run + 0.003, 0.018, height + 0.003)
                dry_locs = ((along, fixed - PARTITION_T / 2.0, z),
                            (along, fixed + PARTITION_T / 2.0, z))
            else:
                core_dims, core_loc = (PARTITION_T, run, height), (fixed, along, z)
                dry_dims = (0.018, run + 0.003, height + 0.003)
                dry_locs = ((fixed - PARTITION_T / 2.0, along, z),
                            (fixed + PARTITION_T / 2.0, along, z))
            box(f"{name}_CORE_{span_index:02d}", core_dims, core_loc,
                mats["wall_core"], target, bevel=0.0, module="MOD_PARTITION_CORE")
            for face_index, face_loc in enumerate(dry_locs):
                box(f"{name}_DRYWALL_{span_index:02d}_{face_index}", dry_dims,
                    face_loc, mats["drywall"], target, bevel=0.0,
                    module="MOD_INTERIOR_DRYWALL")
            if z0 <= FLOOR_Z + 1e-5:
                base_segments.append((start, end))
            span_index += 1

    for side in (-1, 1):
        for index, (start, end) in enumerate(base_segments):
            run = end - start
            along = (start + end) / 2.0
            if axis == "X":
                dims = (run, 0.025, 0.09)
                loc = (along, fixed + side * (PARTITION_T / 2.0 + 0.012), FLOOR_Z + 0.045)
            else:
                dims = (0.025, run, 0.09)
                loc = (fixed + side * (PARTITION_T / 2.0 + 0.012), along, FLOOR_Z + 0.045)
            box(f"{name}_RUBBER_BASE_{side:+d}_{index:02d}", dims, loc,
                mats["rubber_base"], target, bevel=0.004, module="MOD_INTERIOR_BASE_TRIM")

def add_wall_collision(name: str, axis: str, fixed: float, length: float,
                       door_openings, target, collision_mat) -> None:
    intervals = [(opening["center"] - opening["width"] / 2.0,
                  opening["center"] + opening["width"] / 2.0) for opening in door_openings]
    for index, (start, end) in enumerate(complement(intervals, -length / 2.0, length / 2.0)):
        run = end - start
        along = (start + end) / 2.0
        if axis == "X":
            dims, loc = (run, WALL_T, EAVE_Z), (along, fixed, EAVE_Z / 2.0)
        else:
            dims, loc = (WALL_T, run, EAVE_Z), (fixed, along, EAVE_Z / 2.0)
        obj = box(f"COL_{name}_{index:02d}", dims, loc, collision_mat, target,
                  bevel=0.0, module="COL_WALL", collision=True)
        obj.hide_render = True
    for index, opening in enumerate(door_openings):
        header_h = EAVE_Z - (FLOOR_Z + opening["height"])
        if header_h <= 0.0:
            continue
        z = FLOOR_Z + opening["height"] + header_h / 2.0
        if axis == "X":
            dims, loc = (opening["width"], WALL_T, header_h), (opening["center"], fixed, z)
        else:
            dims, loc = (WALL_T, opening["width"], header_h), (fixed, opening["center"], z)
        obj = box(f"COL_{name}_HEADER_{index:02d}", dims, loc, collision_mat, target,
                  bevel=0.0, module="COL_WALL_HEADER", collision=True)
        obj.hide_render = True


def create_window(name: str, axis: str, fixed: float, center: float,
                  exterior_sign: float, mats, target) -> None:
    frame_t = 0.055
    depth = WALL_T + 0.075
    zc = FLOOR_Z + WINDOW_SILL + WINDOW_H / 2.0
    if axis == "X":
        horizontal_dims = (WINDOW_W + 0.16, depth, frame_t)
        vertical_dims = (frame_t, depth, WINDOW_H + 0.16)
        positions = [
            (center, fixed, zc - WINDOW_H / 2.0 - 0.055),
            (center, fixed, zc + WINDOW_H / 2.0 + 0.055),
            (center - WINDOW_W / 2.0 - 0.055, fixed, zc),
            (center + WINDOW_W / 2.0 + 0.055, fixed, zc),
        ]
        dims = [horizontal_dims, horizontal_dims, vertical_dims, vertical_dims]
        glass_dims = (WINDOW_W, 0.018, WINDOW_H)
        glass_loc = (center, fixed, zc)
        muntin_v_dims = (0.025, depth + 0.01, WINDOW_H)
        muntin_h_dims = (WINDOW_W, depth + 0.01, 0.025)
        muntin_v_loc = (center, fixed + exterior_sign * 0.01, zc)
        muntin_h_loc = (center, fixed + exterior_sign * 0.01, zc)
    else:
        horizontal_dims = (depth, WINDOW_W + 0.16, frame_t)
        vertical_dims = (depth, frame_t, WINDOW_H + 0.16)
        positions = [
            (fixed, center, zc - WINDOW_H / 2.0 - 0.055),
            (fixed, center, zc + WINDOW_H / 2.0 + 0.055),
            (fixed, center - WINDOW_W / 2.0 - 0.055, zc),
            (fixed, center + WINDOW_W / 2.0 + 0.055, zc),
        ]
        dims = [horizontal_dims, horizontal_dims, vertical_dims, vertical_dims]
        glass_dims = (0.018, WINDOW_W, WINDOW_H)
        glass_loc = (fixed, center, zc)
        muntin_v_dims = (depth + 0.01, 0.025, WINDOW_H)
        muntin_h_dims = (depth + 0.01, WINDOW_W, 0.025)
        muntin_v_loc = (fixed + exterior_sign * 0.01, center, zc)
        muntin_h_loc = (fixed + exterior_sign * 0.01, center, zc)
    for index, (piece_dims, piece_loc) in enumerate(zip(dims, positions)):
        box(f"{name}_ALUMINUM_FRAME_{index}", piece_dims, piece_loc, mats["aluminum"], target,
            bevel=0.012, module="MOD_WINDOW_FRAME")
    glass = box(f"{name}_GLAZING", glass_dims, glass_loc, mats["glass"], target,
                bevel=0.002, module="MOD_WINDOW_GLAZING")
    glass["glazing"] = True
    box(f"{name}_MUNTIN_VERTICAL", muntin_v_dims, muntin_v_loc, mats["aluminum"], target,
        bevel=0.004, module="MOD_WINDOW_MUNTIN")
    box(f"{name}_MUNTIN_HORIZONTAL", muntin_h_dims, muntin_h_loc, mats["aluminum"], target,
        bevel=0.004, module="MOD_WINDOW_MUNTIN")
    # Separate projecting sill, head flashing and interior apron give the old
    # double-hung unit believable wall depth and remain swappable trim modules.
    bottom_z = FLOOR_Z + WINDOW_SILL - 0.085
    top_z = FLOOR_Z + WINDOW_SILL + WINDOW_H + 0.105
    if axis == "X":
        sill_dims = (WINDOW_W + 0.30, depth + 0.16, 0.065)
        sill_loc = (center, fixed + exterior_sign * 0.035, bottom_z)
        head_dims = (WINDOW_W + 0.24, 0.17, 0.045)
        head_loc = (center, fixed + exterior_sign * (WALL_T / 2.0 + 0.075), top_z)
        apron_dims = (WINDOW_W + 0.18, 0.032, 0.115)
        apron_loc = (center, fixed - exterior_sign * (WALL_T / 2.0 + 0.022), bottom_z - 0.025)
    else:
        sill_dims = (depth + 0.16, WINDOW_W + 0.30, 0.065)
        sill_loc = (fixed + exterior_sign * 0.035, center, bottom_z)
        head_dims = (0.17, WINDOW_W + 0.24, 0.045)
        head_loc = (fixed + exterior_sign * (WALL_T / 2.0 + 0.075), center, top_z)
        apron_dims = (0.032, WINDOW_W + 0.18, 0.115)
        apron_loc = (fixed - exterior_sign * (WALL_T / 2.0 + 0.022), center, bottom_z - 0.025)
    box(f"{name}_PROJECTING_SILL", sill_dims, sill_loc, mats["aluminum"], target,
        bevel=0.010, module="MOD_WINDOW_SILL")
    box(f"{name}_HEAD_FLASHING", head_dims, head_loc, mats["aluminum"], target,
        bevel=0.006, module="MOD_WINDOW_HEAD_FLASHING")
    box(f"{name}_INTERIOR_APRON", apron_dims, apron_loc, mats["interior_trim"], target,
        bevel=0.008, module="MOD_WINDOW_INTERIOR_TRIM")


def door_leaf(name: str, hinge, width: float, height: float, direction: int,
              mat, glass_mat, target, glazed: bool) -> bpy.types.Object:
    """Create a separate door leaf whose origin is its physical hinge axis."""
    x0 = 0.0 if direction > 0 else -width
    x1 = width if direction > 0 else 0.0
    y0, y1 = -0.027, 0.027
    z0, z1 = 0.0, height
    verts = [(x, y, z) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1),
             (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    mesh = bpy.data.meshes.new(name + "_MESH")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    obj.location = hinge
    mesh.materials.append(mat)
    tag(obj, "MOD_HINGED_DOOR_LEAF")
    # `pivot` is reserved by Golf Flipper's GLTFLoader for a numeric exporter
    # container contract. The object origin already is the physical hinge;
    # descriptive metadata therefore uses a non-reserved key.
    obj["pivot_contract"] = "physical_hinge_axis"
    obj["hinge_axis"] = "local_z"
    obj["swing_degrees"] = 100.0
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(island_margin=0.04)
    bpy.ops.object.mode_set(mode="OBJECT")
    bevel = obj.modifiers.new("DoorEdgeSoftening", "BEVEL")
    bevel.width = 0.012
    bevel.segments = 2
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    obj.select_set(False)
    # Applied raised panels and optional glazing are children, so they follow
    # the exact authored hinge while remaining individually reusable details.
    for row, z in enumerate((0.43, 1.10, 1.72)):
        panel_h = 0.42 if row < 2 else 0.34
        cx = direction * width * 0.50
        panel = box(f"{name}_PANEL_{row}", (width * 0.72, 0.018, panel_h),
                    (hinge[0] + cx, hinge[1] - 0.038, hinge[2] + z),
                    glass_mat if glazed and row == 2 else mat, target,
                    bevel=0.012, module="MOD_DOOR_PANEL")
        panel.parent = obj
        panel.matrix_parent_inverse = obj.matrix_world.inverted()
    handle = cylinder(f"{name}_HANDLE", 0.026, 0.12,
                      (hinge[0] + direction * width * 0.80, hinge[1] - 0.085, hinge[2] + 1.02),
                      mats_global["brass"], target, vertices=16,
                      module="MOD_DOOR_HANDLE", rotation=(math.radians(90), 0.0, 0.0))
    handle.parent = obj
    handle.matrix_parent_inverse = obj.matrix_world.inverted()
    return obj


def create_double_front_door(mats, target) -> None:
    y = -BUILDING_D / 2.0 - 0.015
    left_hinge = (MAIN_DOOR_X - MAIN_DOOR_W / 2.0 + 0.03, y, FLOOR_Z)
    right_hinge = (MAIN_DOOR_X + MAIN_DOOR_W / 2.0 - 0.03, y, FLOOR_Z)
    left = door_leaf("DOOR_MAIN_LEFT", left_hinge, MAIN_DOOR_W / 2.0 - 0.035,
                     MAIN_DOOR_H, 1, mats["door_green"], mats["glass"], target, True)
    right = door_leaf("DOOR_MAIN_RIGHT", right_hinge, MAIN_DOOR_W / 2.0 - 0.035,
                      MAIN_DOOR_H, -1, mats["door_green"], mats["glass"], target, True)
    left["door_id"] = "main_left"
    right["door_id"] = "main_right"
    # Jamb and casing are reusable structural modules, not part of either leaf.
    for x in (MAIN_DOOR_X - MAIN_DOOR_W / 2.0 - 0.055,
              MAIN_DOOR_X + MAIN_DOOR_W / 2.0 + 0.055):
        box("MAIN_DOOR_JAMB", (0.09, WALL_T + 0.10, MAIN_DOOR_H + 0.12),
            (x, y, FLOOR_Z + MAIN_DOOR_H / 2.0), mats["trim_cream"], target,
            bevel=0.012, module="MOD_DOOR_JAMB")
    box("MAIN_DOOR_HEAD", (MAIN_DOOR_W + 0.20, WALL_T + 0.10, 0.11),
        (MAIN_DOOR_X, y, FLOOR_Z + MAIN_DOOR_H + 0.055), mats["trim_cream"], target,
        bevel=0.012, module="MOD_DOOR_HEAD")
    box("MAIN_DOOR_THRESHOLD", (MAIN_DOOR_W + 0.06, 0.28, 0.035),
        (MAIN_DOOR_X, y, FLOOR_Z + 0.015), mats["aluminum"], target,
        bevel=0.006, module="MOD_DOOR_THRESHOLD")


def create_single_door(name: str, axis: str, fixed: float, center: float,
                       exterior_sign: float, mats, target, door_id: str,
                       width=0.95, height=2.10) -> bpy.types.Object:
    # Door leaf's local X is width and local Z is height. For east/west walls,
    # rotate the complete leaf around its local hinge after authoring.
    if axis == "X":
        hinge = (center - width / 2.0 + 0.025, fixed, FLOOR_Z)
        leaf = door_leaf(name, hinge, width - 0.05, height, 1,
                         mats["service_door"], mats["glass"], target, False)
    else:
        hinge = (fixed, center - width / 2.0 + 0.025, FLOOR_Z)
        leaf = door_leaf(name, hinge, width - 0.05, height, 1,
                         mats["service_door"], mats["glass"], target, False)
        leaf.rotation_euler.z = math.radians(90)
    leaf["door_id"] = door_id
    leaf["exterior_sign"] = exterior_sign
    trim_mat = mats["interior_trim"] if door_id.startswith("interior_") else mats["trim_cream"]
    casing_depth = (PARTITION_T if door_id.startswith("interior_") else WALL_T) + 0.08
    for side in (-1, 1):
        along = center + side * (width / 2.0 + 0.035)
        if axis == "X":
            dims, loc = (0.07, casing_depth, height + 0.06), \
                        (along, fixed, FLOOR_Z + height / 2.0)
        else:
            dims, loc = (casing_depth, 0.07, height + 0.06), \
                        (fixed, along, FLOOR_Z + height / 2.0)
        box(f"{name}_CASING_{side:+d}", dims, loc, trim_mat, target,
            bevel=0.006, module="MOD_DOOR_CASING")
    if axis == "X":
        head_dims, head_loc = (width + 0.14, casing_depth, 0.07), \
                              (center, fixed, FLOOR_Z + height + 0.035)
        threshold_dims = (width, casing_depth + 0.06, 0.025)
    else:
        head_dims, head_loc = (casing_depth, width + 0.14, 0.07), \
                              (fixed, center, FLOOR_Z + height + 0.035)
        threshold_dims = (casing_depth + 0.06, width, 0.025)
    box(f"{name}_HEAD", head_dims, head_loc, trim_mat, target,
        bevel=0.006, module="MOD_DOOR_CASING")
    if not door_id.startswith("interior_"):
        threshold_loc = ((center, fixed, FLOOR_Z + 0.012) if axis == "X" else
                         (fixed, center, FLOOR_Z + 0.012))
        box(f"{name}_THRESHOLD", threshold_dims, threshold_loc,
            mats["aluminum"], target, bevel=0.004, module="MOD_DOOR_THRESHOLD")
    return leaf


def create_roof(mats, target) -> None:
    overhang = 0.48
    run = BUILDING_W / 2.0 + overhang
    slope = math.hypot(run, run * ROOF_PITCH)
    angle = math.atan(ROOF_PITCH)
    depth = BUILDING_D + overhang * 2.0
    # Anchor both planes at the authored ridge and let the 0.48 m overhang fall
    # naturally below the eave. West rotates negative; east positive, so each
    # plane rises inward instead of crossing above the building like an X.
    z = RIDGE_Z - run * ROOF_PITCH / 2.0
    for side in (-1, 1):
        x = side * run / 2.0
        rotation_y = side * angle
        panel = box(f"ROOF_FIELD_{'WEST' if side < 0 else 'EAST'}", (slope, depth, 0.105),
                    (x, 0.0, z), mats["roof"], target, bevel=0.008,
                    module="MOD_ROOF_FIELD", rotation=(0.0, rotation_y, 0.0))
        scale_uv(panel, slope / 1.55, depth / 1.45)
        panel["roof_pitch"] = "4:12"
    box("ROOF_RIDGE_CAP", (0.22, depth + 0.06, 0.13), (0.0, 0.0, RIDGE_Z + 0.035),
        mats["roof_ridge"], target, bevel=0.025, module="MOD_ROOF_RIDGE")
    # Restrained repair patches show deferred maintenance without making the
    # operational roof look structurally failed.
    patches = [(-2.4, -0.7, 0.58, 0.92), (2.2, 1.5, 0.48, 0.78)]
    for index, (x, y, w, d) in enumerate(patches):
        side = -1 if x < 0 else 1
        roof_z = RIDGE_Z - abs(x) * ROOF_PITCH + 0.065
        repair = box(f"ROOF_REPLACED_SHINGLE_FIELD_{index}", (w, d, 0.009),
                     (x, y, roof_z), mats["roof_patch"], target, bevel=0.001,
                     module="MOD_REPLACED_SHINGLE_FIELD",
                     rotation=(0.0, side * angle, 0.0))
        scale_uv(repair, max(1.0, w / 0.38), max(1.0, d / 0.38))
    # Fascia, soffits and gutters belong on the true west/east eaves (the ridge
    # runs north/south). Front/back roof edges are rakes handled by the gables.
    outer_eave_z = RIDGE_Z - run * ROOF_PITCH
    soffit_slope = math.hypot(overhang, overhang * ROOF_PITCH)
    for side, label in ((-1, "WEST"), (1, "EAST")):
        x = side * run
        box(f"ROOF_EAVE_FASCIA_{label}", (0.09, depth, 0.19),
            (x, 0.0, outer_eave_z - 0.015), mats["trim_cream"], target,
            bevel=0.008, module="MOD_ROOF_FASCIA")
        box(f"ROOF_VENTED_SOFFIT_{label}", (soffit_slope, depth - 0.10, 0.032),
            (side * (BUILDING_W / 2.0 + overhang / 2.0), 0.0,
             EAVE_Z - overhang * ROOF_PITCH / 2.0 - 0.065),
            mats["interior_trim"], target, bevel=0.004, module="MOD_ROOF_SOFFIT",
            rotation=(0.0, side * angle, 0.0))
        gutter = curve_tube(f"GUTTER_{label}",
                            [(x + side * 0.065, -depth / 2.0 + 0.10, outer_eave_z - 0.10),
                             (x + side * 0.065, depth / 2.0 - 0.10, outer_eave_z - 0.10)],
                            0.045, mats["gutter"], target, "MOD_ALUMINUM_GUTTER")
        gutter["condition"] = "aged_operational"
    for x, y, label in ((-run - 0.065, -depth / 2.0 + 0.14, "WEST_FRONT"),
                        (run + 0.065, depth / 2.0 - 0.14, "EAST_BACK")):
        curve_tube(f"DOWNSPOUT_{label}",
                   [(x, y, outer_eave_z - 0.10), (x, y, 0.35),
                    (x + (0.22 if x < 0 else -0.22), y, 0.20)],
                   0.038, mats["gutter"], target, "MOD_ALUMINUM_DOWNSPOUT")


def create_gable_faces(mats, target) -> None:
    # Front/back triangular infill under the simple gable. Custom meshes receive
    # a non-overlapping smart UV unwrap.
    for y, exterior_sign, label in ((-BUILDING_D / 2.0, -1.0, "FRONT"),
                                    (BUILDING_D / 2.0, 1.0, "BACK")):
        verts = [(-BUILDING_W / 2.0, y, EAVE_Z),
                 (BUILDING_W / 2.0, y, EAVE_Z),
                 (0.0, y, RIDGE_Z)]
        mesh = bpy.data.meshes.new(f"GABLE_{label}_MESH")
        mesh.from_pydata(verts, [], [(0, 1, 2)])
        mesh.update()
        obj = bpy.data.objects.new(f"GABLE_{label}_SIDING", mesh)
        target.objects.link(obj)
        mesh.materials.append(mats["siding_1"])
        tag(obj, "MOD_GABLE_INFILL")
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(island_margin=0.04)
        bpy.ops.object.mode_set(mode="OBJECT")
        obj.select_set(False)
        # Rake trim follows each roof edge.
        half = BUILDING_W / 2.0
        for side in (-1, 1):
            points = [(0.0, y + exterior_sign * 0.035, RIDGE_Z),
                      (side * half, y + exterior_sign * 0.035, EAVE_Z)]
            curve_tube(f"GABLE_{label}_RAKE_{side:+d}", points, 0.052,
                       mats["trim_cream"], target, "MOD_GABLE_RAKE_TRIM")


def create_porch(mats, target, collision_target) -> None:
    porch_w = 7.60
    porch_d = 2.35
    porch_y = -BUILDING_D / 2.0 - porch_d / 2.0
    slab = box("PORCH_CONCRETE_SLAB", (porch_w, porch_d, 0.18),
               (MAIN_DOOR_X, porch_y, 0.09), mats["concrete"], target,
               bevel=0.025, module="MOD_PORCH_SLAB")
    slab["real_dimensions_m"] = [porch_w, porch_d, 0.18]
    # Two broad steps and an accessible side ramp connect to the 1.5 m walk.
    box("PORCH_STEP_UPPER", (2.35, 0.42, 0.14),
        (MAIN_DOOR_X, porch_y - porch_d / 2.0 - 0.18, 0.07), mats["concrete"], target,
        bevel=0.018, module="MOD_PORCH_STEP")
    box("PORCH_STEP_LOWER", (2.60, 0.42, 0.08),
        (MAIN_DOOR_X, porch_y - porch_d / 2.0 - 0.53, 0.04), mats["concrete"], target,
        bevel=0.016, module="MOD_PORCH_STEP")
    ramp_x = MAIN_DOOR_X + porch_w / 2.0 + 1.55
    ramp_length = 4.20
    ramp = box("PORCH_ACCESSIBLE_RAMP", (1.45, ramp_length, 0.12),
               (ramp_x, porch_y + 0.45, 0.06), mats["concrete"], target,
               bevel=0.018, module="MOD_ACCESSIBLE_RAMP",
               rotation=(math.atan2(0.18, ramp_length), 0.0, 0.0))
    ramp["slope"] = "1:23"
    column_x = [MAIN_DOOR_X - porch_w / 2.0 + 0.45,
                MAIN_DOOR_X - porch_w / 6.0,
                MAIN_DOOR_X + porch_w / 6.0,
                MAIN_DOOR_X + porch_w / 2.0 - 0.45]
    outer_y = porch_y - porch_d / 2.0 + 0.25
    for index, x in enumerate(column_x):
        box(f"PORCH_COLUMN_BASE_{index}", (0.34, 0.34, 0.28), (x, outer_y, 0.34),
            mats["trim_cream"], target, bevel=0.016, module="MOD_PORCH_COLUMN_BASE")
        box(f"PORCH_COLUMN_SHAFT_{index}", (0.22, 0.22, 2.27), (x, outer_y, 1.60),
            mats["trim_cream"], target, bevel=0.012, module="MOD_PORCH_COLUMN_SHAFT")
        box(f"PORCH_COLUMN_CAP_{index}", (0.36, 0.36, 0.16), (x, outer_y, 2.78),
            mats["trim_cream"], target, bevel=0.014, module="MOD_PORCH_COLUMN_CAP")
    box("PORCH_FRONT_BEAM", (porch_w - 0.30, 0.23, 0.30),
        (MAIN_DOOR_X, outer_y, 2.84), mats["trim_cream"], target,
        bevel=0.012, module="MOD_PORCH_BEAM")
    roof_angle = math.radians(5.0)
    porch_roof = box("PORCH_SHED_ROOF", (porch_w + 0.40, porch_d + 0.50, 0.095),
                     (MAIN_DOOR_X, porch_y, 3.02), mats["roof"], target,
                     bevel=0.009, module="MOD_PORCH_ROOF", rotation=(roof_angle, 0.0, 0.0))
    scale_uv(porch_roof, (porch_w + 0.40) / 1.55, (porch_d + 0.50) / 1.45)
    # Modest railings: separate posts, top rails and balusters, leaving the main
    # stair/ramp openings clear.
    for side in (-1, 1):
        run_x0 = MAIN_DOOR_X + side * 1.55
        run_x1 = MAIN_DOOR_X + side * (porch_w / 2.0 - 0.30)
        if side < 0:
            start, end = run_x1, run_x0
        else:
            start, end = run_x0, run_x1
        for x in (start, end):
            box("PORCH_RAIL_POST", (0.075, 0.075, 0.86), (x, outer_y - 0.03, 0.53),
                mats["railing"], target, bevel=0.008, module="MOD_PORCH_RAIL_POST")
        box("PORCH_TOP_RAIL", (abs(end - start), 0.075, 0.075),
            ((start + end) / 2.0, outer_y - 0.03, 0.94), mats["railing"], target,
            bevel=0.012, module="MOD_PORCH_TOP_RAIL")
        x = min(start, end) + 0.18
        while x < max(start, end) - 0.12:
            box("PORCH_BALUSTER", (0.035, 0.035, 0.67), (x, outer_y - 0.03, 0.55),
                mats["railing"], target, bevel=0.005, module="MOD_PORCH_BALUSTER")
            x += 0.18
    # Simplified collision proxies retain walk and ramp authority in the game.
    for name, dims, loc in (("COL_PORCH_SLAB", (porch_w, porch_d, 0.18), (MAIN_DOOR_X, porch_y, 0.09)),
                            ("COL_PORCH_STEP", (2.60, 0.85, 0.14), (MAIN_DOOR_X, porch_y - porch_d / 2.0 - 0.35, 0.07)),
                            ("COL_PORCH_RAMP", (1.45, ramp_length, 0.14), (ramp_x, porch_y + 0.45, 0.07))):
        proxy = box(name, dims, loc, mats["collision"], collision_target,
                    bevel=0.0, module="COL_PORCH", collision=True)
        proxy.hide_render = True


def create_chimney(mats, target) -> None:
    x = -4.45
    y = 2.35
    box("CHIMNEY_CORE", (0.78, 0.64, 3.45), (x, y, 2.55), mats["stone_mortar"], target,
        bevel=0.015, module="MOD_CHIMNEY_CORE")
    # Four-sided modular fieldstone veneer; every course alternates joints and
    # carries restrained size/tilt variation. This must hold up from rear and
    # side player cameras, not only from the reference-board front angle.
    rng = random.Random(5152)
    course_h = 0.235
    z = 0.93
    row = 0
    while z < 4.23:
        front_columns = 3 if row % 2 == 0 else 2
        front_span = 0.73
        front_w = front_span / front_columns
        for face, yy in (("FRONT", y - 0.337), ("BACK", y + 0.337)):
            for col in range(front_columns):
                xx = x - front_span / 2.0 + (col + 0.5) * front_w
                width = front_w - 0.014 - rng.uniform(0.0, 0.012)
                tilt = math.radians(rng.uniform(-1.4, 1.4))
                box(f"CHIMNEY_STONE_{face}_{row:02d}_{col}",
                    (width, 0.040, course_h - 0.016),
                    (xx, yy, z), mats[f"stone_{(row + col + (1 if face == 'BACK' else 0)) % 3}"],
                    target, bevel=0.014, module="MOD_FIELDSTONE_VENEER",
                    rotation=(0.0, tilt, 0.0))
        side_columns = 2 if row % 2 == 0 else 3
        side_span = 0.59
        side_w = side_span / side_columns
        for face, xx in (("WEST", x - 0.407), ("EAST", x + 0.407)):
            for col in range(side_columns):
                yy = y - side_span / 2.0 + (col + 0.5) * side_w
                width = side_w - 0.014 - rng.uniform(0.0, 0.010)
                tilt = math.radians(rng.uniform(-1.4, 1.4))
                box(f"CHIMNEY_STONE_{face}_{row:02d}_{col}",
                    (0.040, width, course_h - 0.016),
                    (xx, yy, z), mats[f"stone_{(row + col + (2 if face == 'EAST' else 1)) % 3}"],
                    target, bevel=0.014, module="MOD_FIELDSTONE_VENEER",
                    rotation=(tilt, 0.0, 0.0))
        z += course_h
        row += 1
    box("CHIMNEY_CAP", (0.98, 0.84, 0.14), (x, y, 4.38), mats["concrete"], target,
        bevel=0.022, module="MOD_CHIMNEY_CAP")
    box("CHIMNEY_FLUE", (0.30, 0.26, 0.26), (x, y, 4.55), mats["flue"], target,
        bevel=0.012, module="MOD_CHIMNEY_FLUE")


def create_interior(mats, target, collision_target) -> None:
    interior_w = BUILDING_W - WALL_T * 2.0
    interior_d = BUILDING_D - WALL_T * 2.0
    floor = box("INTERIOR_CONCRETE_FLOOR", (interior_w, interior_d, FLOOR_Z),
                (0.0, 0.0, FLOOR_Z / 2.0), mats["concrete"], target,
                bevel=0.008, module="MOD_CONCRETE_FLOOR")
    floor["starting_finish"] = "aged_sealed_concrete"
    # Restrained cracks read as deferred maintenance while leaving a safe,
    # operational floor. They are shallow render-only curves.
    cracks = [
        [(-4.8, -1.2, FLOOR_Z + 0.0025), (-3.9, -0.8, FLOOR_Z + 0.0025), (-3.1, -1.1, FLOOR_Z + 0.0025)],
        [(-0.8, 3.1, FLOOR_Z + 0.0025), (-0.2, 2.5, FLOOR_Z + 0.0025), (0.9, 2.2, FLOOR_Z + 0.0025)],
        [(2.0, -3.7, FLOOR_Z + 0.0025), (2.6, -3.1, FLOOR_Z + 0.0025), (3.0, -2.2, FLOOR_Z + 0.0025)],
    ]
    for index, points in enumerate(cracks):
        curve_tube(f"FLOOR_HAIRLINE_CRACK_{index}", points, 0.0025, mats["crack"], target,
                   "MOD_CONCRETE_CRACK")

    # East service spine: four intentionally empty rooms opening directly to
    # the main space. The restroom receives only fixed plumbing fixtures.
    spine_x = 3.18
    room_centers = [-3.55, -1.45, 0.62, 3.10]
    room_names = ["EMPLOYEE", "OFFICE", "RESTROOM", "STORAGE"]
    wall_openings = [{"center": center, "width": 0.86, "height": 2.05} for center in room_centers]
    partition_with_openings("PARTITION_SPINE", "Y", spine_x, interior_d,
                            wall_openings, mats, target)
    add_wall_collision("PARTITION_SPINE", "Y", spine_x, interior_d,
                       wall_openings, collision_target, mats["collision"])
    partition_y = [-2.52, -0.38, 1.63]
    for index, y in enumerate(partition_y):
        # Horizontal room divisions are plain drywall, with no retail finish.
        box(f"PARTITION_CROSS_CORE_{index}", (interior_w / 2.0 - spine_x + 0.12, PARTITION_T, CEILING_Z - FLOOR_Z),
            ((spine_x + interior_w / 2.0) / 2.0, y, (CEILING_Z + FLOOR_Z) / 2.0),
            mats["wall_core"], target, bevel=0.004, module="MOD_PARTITION_CORE")
        for side in (-1, 1):
            box(f"PARTITION_CROSS_DRYWALL_{index}_{side:+d}",
                (interior_w / 2.0 - spine_x + 0.10, 0.018, CEILING_Z - FLOOR_Z - 0.01),
                ((spine_x + interior_w / 2.0) / 2.0, y + side * (PARTITION_T / 2.0 - 0.008),
                (CEILING_Z + FLOOR_Z) / 2.0), mats["drywall"], target,
                bevel=0.003, module="MOD_INTERIOR_DRYWALL")
            box(f"PARTITION_CROSS_RUBBER_BASE_{index}_{side:+d}",
                (interior_w / 2.0 - spine_x + 0.10, 0.025, 0.09),
                ((spine_x + interior_w / 2.0) / 2.0,
                 y + side * (PARTITION_T / 2.0 + 0.012), FLOOR_Z + 0.045),
                mats["rubber_base"], target, bevel=0.004,
                module="MOD_INTERIOR_BASE_TRIM")
        proxy = box(f"COL_PARTITION_CROSS_{index}",
                    (interior_w / 2.0 - spine_x + 0.12, PARTITION_T, CEILING_Z - FLOOR_Z),
                    ((spine_x + interior_w / 2.0) / 2.0, y, (CEILING_Z + FLOOR_Z) / 2.0),
                    mats["collision"], collision_target, bevel=0.0,
                    module="COL_PARTITION", collision=True)
        proxy.hide_render = True
    for index, (room, center) in enumerate(zip(room_names, room_centers)):
        door = create_single_door(f"DOOR_INTERIOR_{room}", "Y", spine_x - 0.015,
                                  center, -1.0, mats, target, f"interior_{room.lower()}",
                                  width=0.86, height=2.05)
        door["room"] = room.lower()
        box(f"ROOM_PLACARD_{room}", (0.026, 0.48, 0.16),
            (spine_x - 0.085, center, 2.48), mats["warm_charcoal"], target,
            bevel=0.010, module="MOD_ROOM_PLACARD")
        text_mesh(f"ROOM_LABEL_{room}", room, (spine_x - 0.102, center, 2.48),
                  0.068, mats["trim_cream"], target, extrude=0.004,
                  rotation=(math.radians(90), 0.0, math.radians(-90)))

    # Suspended ceiling: one finish field per room plus reusable exposed T-bars.
    ceiling = box("CEILING_TILE_FIELD_MAIN", (interior_w - 3.10, interior_d, 0.055),
                  ((-interior_w / 2.0 + spine_x) / 2.0, 0.0, CEILING_Z),
                  mats["ceiling_tile"], target, bevel=0.004, module="MOD_CEILING_TILE_FIELD")
    ceiling["ceiling_height_m"] = CEILING_Z
    box("CEILING_TILE_FIELD_SERVICE", (interior_w / 2.0 - spine_x, interior_d, 0.055),
        ((spine_x + interior_w / 2.0) / 2.0, 0.0, CEILING_Z),
        mats["ceiling_tile"], target, bevel=0.004, module="MOD_CEILING_TILE_FIELD")
    x = -interior_w / 2.0 + 0.6
    while x < interior_w / 2.0:
        box("CEILING_T_BAR_X", (0.018, interior_d, 0.028), (x, 0.0, CEILING_Z - 0.034),
            mats["ceiling_grid"], target, bevel=0.002, module="MOD_CEILING_T_BAR")
        x += 0.60
    y = -interior_d / 2.0 + 1.2
    while y < interior_d / 2.0:
        box("CEILING_T_BAR_Y", (interior_w, 0.018, 0.028), (0.0, y, CEILING_Z - 0.034),
            mats["ceiling_grid"], target, bevel=0.002, module="MOD_CEILING_T_BAR")
        y += 1.20
    light_positions = [(-4.4, -3.2), (-2.0, -3.2), (0.4, -3.2),
                       (-4.4, -0.8), (-2.0, -0.8), (0.4, -0.8),
                       (-4.4, 1.6), (-2.0, 1.6), (0.4, 1.6),
                       (4.55, -3.5), (4.55, -1.3), (4.55, 0.8), (4.55, 3.2)]
    for index, (x, y) in enumerate(light_positions):
        fixture = box(f"CEILING_FLUORESCENT_{index:02d}", (1.18, 0.56, 0.065),
                      (x, y, CEILING_Z - 0.055), mats["light_diffuser"], target,
                      bevel=0.018, module="MOD_FLUORESCENT_FIXTURE")
        fixture["fixture_type"] = "operational_2x4_troffer"

    # Old but operational electrical devices, all individually reusable.
    outlets = [(-5.9, -3.2, 0.45, "X"), (-5.9, 0.2, 0.45, "X"), (-5.9, 3.6, 0.45, "X"),
               (-1.8, 4.58, 0.45, "Y"), (1.4, 4.58, 0.45, "Y"),
               (4.1, -4.58, 0.45, "Y"), (5.9, -1.4, 0.45, "X"), (5.9, 2.7, 0.45, "X")]
    for index, (x, y, z, axis) in enumerate(outlets):
        dims = (0.075, 0.018, 0.12) if axis == "Y" else (0.018, 0.075, 0.12)
        plate = box(f"ELECTRICAL_OUTLET_{index:02d}", dims, (x, y, z), mats["outlet"], target,
                    bevel=0.006, module="MOD_ELECTRICAL_OUTLET")
        plate["voltage"] = "120V"

    # The restroom is also intentionally empty. Only final architectural rough-
    # ins remain: a capped wall supply pair and a floor waste flange. These do
    # not dictate the player's future fixture layout.
    restroom_y = 0.62
    for index, z in enumerate((0.43, 0.53)):
        cylinder(f"RESTROOM_CAPPED_SUPPLY_{index}", 0.018, 0.035,
                 (5.98, restroom_y - 0.55 + index * 0.10, z), mats["aluminum"],
                 target, vertices=16, module="MOD_PLUMBING_ROUGH_IN",
                 rotation=(0.0, math.radians(90), 0.0))
    cylinder("RESTROOM_FLOOR_WASTE_FLANGE", 0.075, 0.012,
             (5.15, restroom_y + 0.45, FLOOR_Z + 0.009), mats["aluminum"],
             target, vertices=24, module="MOD_PLUMBING_ROUGH_IN")


def add_exterior_detailing(mats, target) -> None:
    # Fading, lower-wall grime and the occasional warped batten are integrated
    # into the siding system itself. No applied damage cards are used: those
    # read as pasted-on decals in the first architecture review.
    # Old wall lights at each exterior door.
    lights = [(MAIN_DOOR_X - 1.25, -BUILDING_D / 2.0 - 0.19, 2.18, "FRONT_W"),
              (MAIN_DOOR_X + 1.25, -BUILDING_D / 2.0 - 0.19, 2.18, "FRONT_E"),
              (BUILDING_W / 2.0 + 0.19, SERVICE_DOOR_Y, 2.20, "SERVICE"),
              (MAINTENANCE_DOOR_X, BUILDING_D / 2.0 + 0.19, 2.20, "BACK")]
    for x, y, z, label in lights:
        box(f"EXTERIOR_LIGHT_BACKPLATE_{label}", (0.12, 0.06, 0.22), (x, y, z),
            mats["warm_charcoal"], target, bevel=0.012, module="MOD_EXTERIOR_LIGHT")
        cylinder(f"EXTERIOR_LIGHT_GLOBE_{label}", 0.085, 0.14, (x, y - 0.04, z - 0.16),
                 mats["exterior_globe"], target, vertices=20,
                 module="MOD_EXTERIOR_LIGHT", rotation=(math.radians(90), 0.0, 0.0))


def validate_scene(production: bpy.types.Collection, collision: bpy.types.Collection) -> dict:
    meshes = [obj for obj in production.all_objects if obj.type == "MESH"]
    collision_meshes = [obj for obj in collision.all_objects if obj.type == "MESH"]
    missing_uv = [obj.name for obj in meshes if len(obj.data.uv_layers) == 0]
    unapplied = [obj.name for obj in meshes if any(abs(value - 1.0) > 1e-5 for value in obj.scale)]
    nonfinite = []
    for obj in meshes + collision_meshes:
        values = list(obj.location) + list(obj.rotation_euler) + list(obj.scale)
        if not all(math.isfinite(value) for value in values):
            nonfinite.append(obj.name)
    doors = [obj for obj in production.all_objects if obj.get("hinge_axis")]
    return {
        "asset": GLB_NAME,
        "blender_version": bpy.app.version_string,
        "footprint_m": [BUILDING_W, BUILDING_D],
        "floor_area_m2": BUILDING_W * BUILDING_D,
        "floor_area_sq_ft": BUILDING_W * BUILDING_D * 10.7639104167,
        "ceiling_height_m": CEILING_Z - FLOOR_Z,
        "eave_height_m": EAVE_Z,
        "ridge_height_m": RIDGE_Z,
        "production_objects": len(production.all_objects),
        "render_meshes": len(meshes),
        "collision_meshes": len(collision_meshes),
        "materials": len({mat.name for obj in meshes for mat in obj.data.materials}),
        "missing_uv": missing_uv,
        "unapplied_scale": unapplied,
        "nonfinite": nonfinite,
        "doors": [{"name": obj.name, "pivot": obj.get("pivot_contract"),
                   "axis": obj.get("hinge_axis"), "swing_degrees": obj.get("swing_degrees")}
                  for obj in doors],
    }


def export_collection(root: bpy.types.Collection, collision: bpy.types.Collection, filepath: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in list(root.all_objects) + list(collision.all_objects):
        obj.select_set(True)
    filepath.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(filepath),
        export_format="GLB",
        use_selection=True,
        export_extras=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_yup=True,
        export_apply=True,
    )
    bpy.ops.object.select_all(action="DESELECT")


def main() -> None:
    global mats_global
    clear_scene()
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    CANONICAL_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    root = collection("COURSE1_MUNICIPAL_CLUBHOUSE")
    production = collection("LOD0_ARCHITECTURE", root)
    collision = collection("COLLISION_PROXIES", root)
    module_library = collection("MODULE_LIBRARY", root)
    module_library.hide_render = True

    siding_texture = make_texture("municipal_faded_siding_basecolor", "siding")
    roof_texture = make_texture("municipal_asphalt_roof_basecolor", "asphalt_roof")
    concrete_texture = make_texture("municipal_aged_concrete_basecolor", "concrete")
    drywall_texture = make_texture("municipal_old_drywall_basecolor", "drywall")

    mats = {
        "wall_core": material("M_WallCore", (0.32, 0.31, 0.28, 1.0), 0.96),
        "drywall": material("M_OldWarmDrywall", (0.76, 0.72, 0.62, 1.0), 0.88, texture=drywall_texture),
        "interior_trim": material("M_AgedInteriorTrim", (0.66, 0.64, 0.57, 1.0), 0.86),
        "rubber_base": material("M_ScuffedRubberBase", (0.13, 0.125, 0.115, 1.0), 0.91),
        "siding_0": material("M_FadedSiding_A", (0.15, 0.26, 0.20, 1.0), 0.86, texture=siding_texture),
        "siding_1": material("M_FadedSiding_B", (0.17, 0.28, 0.22, 1.0), 0.88, texture=siding_texture),
        "siding_2": material("M_FadedSiding_C", (0.20, 0.30, 0.23, 1.0), 0.90, texture=siding_texture),
        "siding_3": material("M_FadedSiding_D", (0.13, 0.23, 0.18, 1.0), 0.91, texture=siding_texture),
        "bare_wood": material("M_ExposedAgedWood", (0.32, 0.23, 0.15, 1.0), 0.94),
        "trim_cream": material("M_AgedWarmCreamTrim", (0.68, 0.64, 0.53, 1.0), 0.84),
        "roof": material("M_PatchedAsphaltRoof", (0.10, 0.095, 0.085, 1.0), 0.94, texture=roof_texture),
        "roof_ridge": material("M_AsphaltRidge", (0.075, 0.071, 0.065, 1.0), 0.96, texture=roof_texture),
        "roof_patch": material("M_AsphaltRepairPatch", (0.065, 0.061, 0.057, 1.0), 0.90, texture=roof_texture),
        "concrete": material("M_AgedConcrete", (0.48, 0.46, 0.41, 1.0), 0.92, texture=concrete_texture),
        "crack": material("M_ConcreteCrack", (0.08, 0.075, 0.065, 1.0), 1.0),
        "aluminum": material("M_OldAluminum", (0.27, 0.29, 0.28, 1.0), 0.56, 0.42),
        "gutter": material("M_OldAluminumGutter", (0.29, 0.30, 0.28, 1.0), 0.64, 0.34),
        "glass": material("M_OldWindowGlass", (0.13, 0.22, 0.20, 1.0), 0.27, 0.0,
                          transmission=0.18),
        "door_green": material("M_OldDoorGreen", (0.055, 0.14, 0.10, 1.0), 0.78),
        "service_door": material("M_ServiceDoor", (0.18, 0.25, 0.20, 1.0), 0.82),
        "brass": material("M_RestrainedBrass", PALETTE["restrained_brass"], 0.42, 0.58),
        "railing": material("M_PaintedRailing", (0.12, 0.20, 0.16, 1.0), 0.82, 0.08),
        "warm_charcoal": material("M_WarmCharcoal", PALETTE["warm_charcoal"], 0.78, 0.18),
        "stone_mortar": material("M_FieldstoneMortar", (0.21, 0.205, 0.18, 1.0), 0.96),
        "stone_0": material("M_Fieldstone_A", (0.25, 0.235, 0.19, 1.0), 0.94),
        "stone_1": material("M_Fieldstone_B", (0.34, 0.29, 0.22, 1.0), 0.95),
        "stone_2": material("M_Fieldstone_C", (0.19, 0.215, 0.20, 1.0), 0.96),
        "flue": material("M_OldTerracottaFlue", (0.31, 0.13, 0.075, 1.0), 0.91),
        "ceiling_tile": material("M_AgedCeilingTile", (0.82, 0.78, 0.68, 1.0), 0.91,
                                 emission_strength=0.10),
        "ceiling_grid": material("M_CeilingGrid", (0.48, 0.48, 0.43, 1.0), 0.70, 0.22),
        "light_diffuser": material("M_LightDiffuser", (0.92, 0.86, 0.69, 1.0), 0.35,
                                   emission_strength=1.4),
        "exterior_globe": material("M_OldExteriorGlobe", (0.83, 0.76, 0.57, 1.0), 0.42,
                                   emission_strength=0.42),
        "outlet": material("M_AgedOutletPlate", (0.67, 0.64, 0.56, 1.0), 0.82),
        "porcelain": material("M_WarmPorcelain", (0.82, 0.80, 0.72, 1.0), 0.30),
        "collision": material("M_CollisionProxy", (1.0, 0.0, 1.0, 1.0), 1.0),
    }
    mats_global = mats

    front_openings = [
        {"center": MAIN_DOOR_X, "width": MAIN_DOOR_W, "height": MAIN_DOOR_H},
        {"center": -4.45, "width": WINDOW_W, "height": WINDOW_H, "bottom": WINDOW_SILL},
        {"center": 3.10, "width": WINDOW_W, "height": WINDOW_H, "bottom": WINDOW_SILL},
    ]
    back_openings = [
        {"center": MAINTENANCE_DOOR_X, "width": 0.95, "height": 2.10},
        {"center": -3.85, "width": WINDOW_W, "height": WINDOW_H, "bottom": WINDOW_SILL},
        {"center": -1.25, "width": WINDOW_W, "height": WINDOW_H, "bottom": WINDOW_SILL},
    ]
    west_openings = [
        {"center": -2.55, "width": WINDOW_W, "height": WINDOW_H, "bottom": WINDOW_SILL},
        {"center": 1.15, "width": WINDOW_W, "height": WINDOW_H, "bottom": WINDOW_SILL},
    ]
    east_openings = [
        {"center": SERVICE_DOOR_Y, "width": 0.95, "height": 2.10},
        {"center": -2.65, "width": WINDOW_W, "height": WINDOW_H, "bottom": WINDOW_SILL},
    ]
    wall_with_openings("WALL_FRONT", "X", -BUILDING_D / 2.0, BUILDING_W, -1.0,
                       front_openings, mats, production, 11)
    wall_with_openings("WALL_BACK", "X", BUILDING_D / 2.0, BUILDING_W, 1.0,
                       back_openings, mats, production, 17)
    wall_with_openings("WALL_WEST", "Y", -BUILDING_W / 2.0, BUILDING_D, -1.0,
                       west_openings, mats, production, 23)
    wall_with_openings("WALL_EAST", "Y", BUILDING_W / 2.0, BUILDING_D, 1.0,
                       east_openings, mats, production, 29)
    add_wall_collision("WALL_FRONT", "X", -BUILDING_D / 2.0, BUILDING_W,
                       [front_openings[0]], collision, mats["collision"])
    add_wall_collision("WALL_BACK", "X", BUILDING_D / 2.0, BUILDING_W,
                       [back_openings[0]], collision, mats["collision"])
    add_wall_collision("WALL_WEST", "Y", -BUILDING_W / 2.0, BUILDING_D,
                       [], collision, mats["collision"])
    add_wall_collision("WALL_EAST", "Y", BUILDING_W / 2.0, BUILDING_D,
                       [east_openings[0]], collision, mats["collision"])

    create_double_front_door(mats, production)
    create_single_door("DOOR_SERVICE_EAST", "Y", BUILDING_W / 2.0 + 0.015,
                       SERVICE_DOOR_Y, 1.0, mats, production, "service_east")
    create_single_door("DOOR_MAINTENANCE_BACK", "X", BUILDING_D / 2.0 + 0.015,
                       MAINTENANCE_DOOR_X, 1.0, mats, production, "maintenance_back")

    for name, axis, fixed, center, sign in (
        ("WINDOW_FRONT_W", "X", -BUILDING_D / 2.0, -4.45, -1.0),
        ("WINDOW_FRONT_E", "X", -BUILDING_D / 2.0, 3.10, -1.0),
        ("WINDOW_BACK_W", "X", BUILDING_D / 2.0, -3.85, 1.0),
        ("WINDOW_BACK_M", "X", BUILDING_D / 2.0, -1.25, 1.0),
        ("WINDOW_WEST_S", "Y", -BUILDING_W / 2.0, -2.55, -1.0),
        ("WINDOW_WEST_N", "Y", -BUILDING_W / 2.0, 1.15, -1.0),
        ("WINDOW_EAST_S", "Y", BUILDING_W / 2.0, -2.65, 1.0),
    ):
        create_window(name, axis, fixed, center, sign, mats, production)

    create_gable_faces(mats, production)
    create_roof(mats, production)
    create_porch(mats, production, collision)
    create_chimney(mats, production)
    create_interior(mats, production, collision)
    add_exterior_detailing(mats, production)

    # Municipal identity belongs to the architecture, not player furniture.
    text_mesh("SIGN_PINE_HILLS", "PINE HILLS", (0.0, -BUILDING_D / 2.0 - 0.045, 4.10),
              0.43, mats["trim_cream"], production)
    text_mesh("SIGN_MUNICIPAL_GOLF", "MUNICIPAL GOLF", (0.0, -BUILDING_D / 2.0 - 0.047, 3.72),
              0.20, mats["trim_cream"], production)

    root["asset_id"] = "course1_municipal_clubhouse_architecture"
    root["source_license"] = "Project-owned original; based only on user-provided Designs/ClubHouse boards"
    root["real_dimensions_m"] = [BUILDING_W, BUILDING_D, RIDGE_Z]
    root["floor_area_sq_ft"] = BUILDING_W * BUILDING_D * 10.7639104167
    root["starting_interior"] = "intentionally_empty_architecture_only"
    root["reference_board"] = "Designs/ClubHouse/ChatGPT Image Jul 20, 2026, 02_52_34 PM.png"

    audit = validate_scene(production, collision)
    if audit["missing_uv"] or audit["unapplied_scale"] or audit["nonfinite"]:
        raise RuntimeError(f"Course 1 architecture audit failed: {json.dumps(audit, indent=2)}")
    if len(audit["doors"]) != 8:
        raise RuntimeError(f"Expected eight separately hinged doors, got {len(audit['doors'])}")

    bpy.context.scene["course1_municipal_audit"] = json.dumps(audit)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), check_existing=False)
    export_collection(production, collision, CANONICAL_DIR / GLB_NAME)
    export_collection(production, collision, RUNTIME_DIR / GLB_NAME)
    report_path = SOURCE_DIR / "course1_municipal_clubhouse_architecture_audit.json"
    report_path.write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "blend": str(BLEND_PATH),
                      "canonical_glb": str(CANONICAL_DIR / GLB_NAME),
                      "runtime_glb": str(RUNTIME_DIR / GLB_NAME),
                      "audit": audit}, indent=2))


if __name__ == "__main__":
    main()
