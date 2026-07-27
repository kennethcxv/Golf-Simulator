"""Author the five reference-matched Golf Flipper office desks in Blender.

This is a self-contained production build.  It starts from factory settings,
creates original project-owned geometry and texture maps, saves one editable
source scene per desk, exports LOD0/1/2 GLBs, renders closed and functional
previews, re-imports every LOD0 GLB, and writes a validation report.

The repository's furniture catalog has historic runtime ids named
``basic/standard/premium/luxury/executive``.  For this family only, those map
to the requested visual progression as follows:

    basic -> Basic, standard -> Standard, premium -> Premium,
    luxury -> High-End, executive -> Luxury.

Run through Blender MCP (preferred) or Blender 5.1+ background mode:

    blender --background --factory-startup --python tools/blender/build_desks.py
"""

from __future__ import annotations

from array import array
import json
import math
import os
from pathlib import Path
import shutil
import sys
import traceback

import bpy
import bmesh
from mathutils import Vector


REPO = Path(os.environ.get("GF_REPO_ROOT", Path(__file__).resolve().parents[2])).resolve()
ASSET_ROOT = REPO / "Assets" / "pro_shop_furniture"
SOURCE_ROOT = ASSET_ROOT / "source" / "office-desks"
PREVIEW_ROOT = ASSET_ROOT / "previews" / "office-desks"
EXPORT_ROOT = ASSET_ROOT / "exports" / "office-desks"
TEXTURE_ROOT = ASSET_ROOT / "textures" / "office-desks"
RUNTIME_ROOT = REPO / "vendor" / "models" / "pro_shop_furniture" / "office-desks"
QA_ROOT = REPO / "qa" / "desks"
MANIFEST_PATH = ASSET_ROOT / "manifest.json"
REPORT_PATH = QA_ROOT / "blender-validation.json"

METERS_TO_YARDS = 1.0936133
FRONT_Y_SIGN = -1.0


DESKS = [
    {
        "key": "basic", "runtime": "basic", "asset": "Desk_Basic", "label": "Basic",
        "dimensions": (1.32, 0.76, 0.68), "tier_level": 1,
        "sound": "light-laminate-drawer", "builder": "build_basic",
    },
    {
        "key": "standard", "runtime": "standard", "asset": "Desk_Standard", "label": "Standard",
        "dimensions": (1.52, 0.76, 0.72), "tier_level": 2,
        "sound": "heavy-laminate-drawer", "builder": "build_standard",
    },
    {
        "key": "premium", "runtime": "premium", "asset": "Desk_Premium", "label": "Premium",
        "dimensions": (1.64, 0.78, 0.78), "tier_level": 3,
        "sound": "wood-drawer", "builder": "build_premium",
    },
    {
        "key": "high_end", "runtime": "luxury", "asset": "Desk_HighEnd", "label": "High-End",
        "dimensions": (1.74, 0.79, 0.82), "tier_level": 4,
        "sound": "heavy-solid-wood", "builder": "build_high_end",
    },
    {
        "key": "luxury", "runtime": "executive", "asset": "Desk_Luxury", "label": "Luxury",
        "dimensions": (1.92, 0.81, 0.90), "tier_level": 5,
        "sound": "refined-hardwood-brass", "builder": "build_luxury",
    },
]


MATERIALS = {}
MOVING_PARTS = []
CURRENT_DESK = None


def log(message):
    print(f"[desk-build] {message}", flush=True)


def ensure_dirs():
    for path in (SOURCE_ROOT, PREVIEW_ROOT, EXPORT_ROOT, TEXTURE_ROOT, RUNTIME_ROOT, QA_ROOT):
        path.mkdir(parents=True, exist_ok=True)


def factory_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.resolution_percentage = 100
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.frame_start = 1
    scene.frame_end = 42
    scene.frame_set(1)
    if scene.world is None:
        scene.world = bpy.data.worlds.new("Desk_Studio_World")
    scene.world.color = (0.035, 0.04, 0.038)


def _hash01(x, y, seed):
    n = (x * 374761393 + y * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    n ^= n >> 16
    return (n & 0xFFFFFF) / float(0xFFFFFF)


def _lerp_color(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def _save_image(name, path, width, height, pixels, data=False):
    image = bpy.data.images.new(name, width=width, height=height, alpha=True, float_buffer=False)
    image.pixels.foreach_set(pixels)
    if data:
        try:
            image.colorspace_settings.name = "Non-Color"
        except TypeError:
            pass
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def generate_texture_set(key, kind, base, accent, roughness, size=384):
    """Generate compact authored base-color, roughness and tangent-normal maps."""
    folder = TEXTURE_ROOT / key
    folder.mkdir(parents=True, exist_ok=True)
    paths = {
        "base": folder / f"{key}_basecolor.png",
        "rough": folder / f"{key}_roughness.png",
        "normal": folder / f"{key}_normal.png",
    }
    if all(path.exists() for path in paths.values()) and os.environ.get("GF_DESK_REBUILD_TEXTURES") != "1":
        return paths

    count = size * size
    heights = array("f", [0.0]) * count
    tones = array("f", [0.0]) * count
    roughs = array("f", [0.0]) * count
    seed = sum(ord(char) for char in key) + len(kind) * 97
    knots = ((0.22, 0.33, 0.055), (0.68, 0.72, 0.075), (0.86, 0.24, 0.04))

    for py in range(size):
        v = py / max(1, size - 1)
        for px in range(size):
            u = px / max(1, size - 1)
            idx = py * size + px
            fine = _hash01(px, py, seed) - 0.5
            if kind == "wood":
                warp = 0.95 * math.sin(u * math.tau * 2.2) + 0.28 * math.sin(u * math.tau * 8.1)
                phase = v * math.tau * 6.4 + warp * 0.55
                narrow = 0.5 + 0.5 * math.sin(phase)
                broad = 0.5 + 0.5 * math.sin(v * math.tau * 2.1 + math.sin(u * 5.1))
                knot_term = 0.0
                for kx, ky, kr in knots:
                    dx = (u - kx) / 2.7
                    dy = v - ky
                    radius = math.sqrt(dx * dx + dy * dy)
                    fade = max(0.0, 1.0 - radius / kr)
                    knot_term += fade * (0.5 + 0.5 * math.sin(radius * 390.0))
                tone = 0.45 + (narrow - 0.5) * 0.085 + (broad - 0.5) * 0.065 + knot_term * 0.13 + fine * 0.035
                height_value = 0.48 + (narrow - 0.5) * 0.075 + knot_term * 0.055 + fine * 0.025
                rough_value = roughness + (0.5 - narrow) * 0.035 + fine * 0.018
            elif kind == "leather":
                pore = _hash01(px * 3, py * 5, seed + 11)
                crease = 0.5 + 0.5 * math.sin((u * 27.0 + math.sin(v * 31.0)) * math.tau)
                tone = 0.34 + (pore - 0.5) * 0.13 + (crease - 0.5) * 0.025
                height_value = 0.5 + (pore - 0.5) * 0.12 + (crease - 0.5) * 0.03
                rough_value = roughness + (pore - 0.5) * 0.08
            else:  # laminate / paint with restrained manufactured variation
                # Powder coat and commercial laminate should read as a quiet,
                # continuous finish. A repeating sine pattern became visible
                # after mipmapping in the clubhouse and looked corrugated.
                tone = 0.50 + fine * 0.035
                height_value = 0.5 + fine * 0.014
                rough_value = roughness + fine * 0.022
            tones[idx] = max(0.0, min(1.0, tone))
            heights[idx] = max(0.0, min(1.0, height_value))
            roughs[idx] = max(0.06, min(0.98, rough_value))

    base_pixels = array("f")
    rough_pixels = array("f")
    normal_pixels = array("f")
    strength = 1.75 if kind == "wood" else 1.15 if kind == "leather" else 0.45
    for py in range(size):
        ym = max(0, py - 1)
        yp = min(size - 1, py + 1)
        for px in range(size):
            xm = max(0, px - 1)
            xp = min(size - 1, px + 1)
            idx = py * size + px
            color = _lerp_color(base, accent, tones[idx])
            base_pixels.extend((color[0], color[1], color[2], 1.0))
            r = roughs[idx]
            rough_pixels.extend((r, r, r, 1.0))
            dx = (heights[py * size + xp] - heights[py * size + xm]) * strength
            dy = (heights[yp * size + px] - heights[ym * size + px]) * strength
            normal = Vector((-dx, -dy, 1.0)).normalized()
            normal_pixels.extend((normal.x * 0.5 + 0.5, normal.y * 0.5 + 0.5, normal.z * 0.5 + 0.5, 1.0))

    _save_image(f"{key}_basecolor", paths["base"], size, size, base_pixels)
    _save_image(f"{key}_roughness", paths["rough"], size, size, rough_pixels, data=True)
    _save_image(f"{key}_normal", paths["normal"], size, size, normal_pixels, data=True)
    return paths


def textured_material(name, paths, metallic=0.0, normal_strength=0.42):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (0.35, 0.22, 0.12, 1.0)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (620, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (340, 0)
    bsdf.inputs["Metallic"].default_value = metallic
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])

    base_node = nodes.new("ShaderNodeTexImage")
    base_node.name = "Authored Base Color"
    base_node.image = bpy.data.images.load(str(paths["base"]), check_existing=True)
    base_node.extension = "REPEAT"
    base_node.location = (-420, 180)
    links.new(base_node.outputs["Color"], bsdf.inputs["Base Color"])

    rough_node = nodes.new("ShaderNodeTexImage")
    rough_node.name = "Authored Roughness"
    rough_node.image = bpy.data.images.load(str(paths["rough"]), check_existing=True)
    rough_node.image.colorspace_settings.name = "Non-Color"
    rough_node.extension = "REPEAT"
    rough_node.location = (-420, -40)
    links.new(rough_node.outputs["Color"], bsdf.inputs["Roughness"])

    normal_node = nodes.new("ShaderNodeTexImage")
    normal_node.name = "Authored Tangent Normal"
    normal_node.image = bpy.data.images.load(str(paths["normal"]), check_existing=True)
    normal_node.image.colorspace_settings.name = "Non-Color"
    normal_node.extension = "REPEAT"
    normal_node.location = (-420, -280)
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.inputs["Strength"].default_value = normal_strength
    normal_map.location = (60, -210)
    links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    mat["source"] = "Original Golf Flipper procedural texture"
    mat["license"] = "Project-owned; no external source"
    return mat


def solid_material(name, color, roughness=0.52, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, 1.0)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    mat["source"] = "Original Golf Flipper material"
    mat["license"] = "Project-owned; no external source"
    return mat


def build_materials(desk):
    global MATERIALS
    key = desk["key"]
    if key == "basic":
        # The supplied Basic reference is neutral powder-coated steel with a
        # pale worktop.  Keep every RGB channel balanced so the clubhouse's
        # green walls cannot amplify a sage cast.
        surface = generate_texture_set("basic_warm_grey_worktop", "laminate", (0.58, 0.59, 0.62), (0.84, 0.85, 0.87), 0.66)
        body = generate_texture_set("basic_neutral_powdercoat", "laminate", (0.36, 0.37, 0.40), (0.60, 0.61, 0.64), 0.76)
        interior = generate_texture_set("basic_neutral_drawer_interior", "laminate", (0.30, 0.31, 0.33), (0.50, 0.51, 0.53), 0.72)
    elif key == "standard":
        surface = generate_texture_set("standard_dark_laminate", "wood", (0.15, 0.12, 0.10), (0.42, 0.30, 0.20), 0.58)
        body = surface
        interior = generate_texture_set("standard_dark_drawer_interior", "wood", (0.22, 0.18, 0.14), (0.40, 0.30, 0.20), 0.62)
    elif key == "premium":
        surface = generate_texture_set("premium_warm_veneer", "wood", (0.18, 0.10, 0.055), (0.48, 0.27, 0.13), 0.45)
        body = surface
        interior = generate_texture_set("premium_warm_cabinet_interior", "wood", (0.22, 0.14, 0.08), (0.42, 0.26, 0.14), 0.57)
    elif key == "high_end":
        surface = generate_texture_set("high_end_walnut", "wood", (0.115, 0.055, 0.028), (0.38, 0.18, 0.075), 0.38)
        body = surface
        interior = generate_texture_set("high_end_walnut_interior", "wood", (0.17, 0.09, 0.045), (0.34, 0.18, 0.09), 0.51)
    else:
        surface = generate_texture_set("luxury_dark_walnut", "wood", (0.075, 0.030, 0.015), (0.28, 0.11, 0.040), 0.33)
        body = surface
        interior = generate_texture_set("luxury_dark_walnut_interior", "wood", (0.12, 0.05, 0.025), (0.26, 0.11, 0.05), 0.45)
    MATERIALS = {
        "surface": textured_material(f"{desk['asset']}_Surface", surface, normal_strength=0.16 if key == "basic" else 0.48),
        "body": textured_material(f"{desk['asset']}_Body", body, normal_strength=0.14 if key == "basic" else 0.46),
        "interior": textured_material(f"{desk['asset']}_InteriorOak", interior, normal_strength=0.35),
        "charcoal": solid_material(f"{desk['asset']}_WarmCharcoal", (0.055, 0.06, 0.055), 0.32, 0.70),
        "steel": solid_material(f"{desk['asset']}_SatinSteel", (0.34, 0.35, 0.33), 0.28, 0.82),
        "brass": solid_material(f"{desk['asset']}_RestrainedBrass", (0.46, 0.255, 0.065), 0.27, 0.78),
        "shadow": solid_material(f"{desk['asset']}_InteriorShadow", (0.018, 0.014, 0.010), 0.78, 0.0),
    }
    if key == "luxury":
        leather = generate_texture_set("luxury_dark_leather", "leather", (0.035, 0.028, 0.025), (0.18, 0.12, 0.08), 0.46)
        MATERIALS["leather"] = textured_material(f"{desk['asset']}_Leather", leather, normal_strength=0.72)


def collection(name, parent=None):
    col = bpy.data.collections.new(name)
    if parent is None:
        bpy.context.scene.collection.children.link(col)
    else:
        parent.children.link(col)
    return col


def link_object(obj, col):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    col.objects.link(obj)


def _clean_hierarchy_world_matrix(obj):
    """Compose a hierarchy whose parent-inverse matrices are intentionally identity."""
    matrix = obj.matrix_basis.copy()
    current = obj.parent
    while current is not None:
        matrix = current.matrix_basis @ matrix
        current = current.parent
    return matrix


def set_parent_keep_world(obj, parent):
    # Newly linked objects have a current matrix_basis immediately, while
    # matrix_world can remain the previous identity until a depsgraph update.
    # Reading matrix_world here was the source of zeroed pivots/anchors.
    world_matrix = obj.matrix_basis.copy() if obj.parent is None else _clean_hierarchy_world_matrix(obj)
    local_matrix = _clean_hierarchy_world_matrix(parent).inverted() @ world_matrix
    obj.parent = parent
    # Keep the exported hierarchy explicit.  Blender otherwise leaves a
    # compensating parent-inverse matrix behind; glTF legitimately folds that
    # inverse into the children, which flattens authored empty locations and
    # turns cabinet-door hinge roots into origin pivots.  An identity parent
    # inverse plus the restored world matrix gives children clean local offsets
    # while preserving their visible world-space pose.
    obj.matrix_parent_inverse.identity()
    obj.matrix_basis = local_matrix


def empty(name, location=(0, 0, 0), parent=None, col=None, display="PLAIN_AXES", size=0.07):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = display
    obj.empty_display_size = size
    obj.location = location
    (col or bpy.context.collection).objects.link(obj)
    if parent:
        set_parent_keep_world(obj, parent)
    return obj


def _apply_mesh_transforms(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.select_set(False)


def _bevel(obj, width, segments=2):
    if width <= 0:
        return
    mod = obj.modifiers.new("Intentional edge softening", "BEVEL")
    mod.width = min(width, min(obj.dimensions) * 0.22)
    mod.segments = segments
    mod.limit_method = "ANGLE"
    try:
        mod.harden_normals = True
    except AttributeError:
        pass
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)


def _axis_index(axis):
    return {"X": 0, "Y": 1, "Z": 2}[axis]


def box_uv(obj, grain_axis="X", long_tile=1.35, cross_tile=0.72):
    mesh = obj.data
    uv_layer = mesh.uv_layers.get("UVMap") or mesh.uv_layers.new(name="UVMap")
    desired = _axis_index(grain_axis)
    name_offset = (sum(ord(c) for c in obj.name) % 97) / 97.0
    for poly in mesh.polygons:
        normal = poly.normal
        dominant = max(range(3), key=lambda index: abs(normal[index]))
        plane_axes = [axis for axis in range(3) if axis != dominant]
        u_axis = desired if desired in plane_axes else plane_axes[0]
        v_axis = plane_axes[1] if plane_axes[0] == u_axis else plane_axes[0]
        for loop_index in poly.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv_layer.data[loop_index].uv = (
                vertex[u_axis] / long_tile + name_offset,
                vertex[v_axis] / cross_tile + name_offset * 0.37,
            )


def cube(name, size, location, mat=None, bevel=0.006, parent=None, col=None, grain="X", segments=2):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.dimensions = size
    _apply_mesh_transforms(obj)
    if bevel:
        _bevel(obj, bevel, segments)
    if mat:
        obj.data.materials.append(mat)
    box_uv(obj, grain_axis=grain)
    if col:
        link_object(obj, col)
    if parent:
        set_parent_keep_world(obj, parent)
    return obj


def cylinder(name, radius, depth, location, mat=None, axis="Y", parent=None, col=None, vertices=20):
    rotation = (math.pi / 2, 0, 0) if axis == "Y" else (0, math.pi / 2, 0) if axis == "X" else (0, 0, 0)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    _apply_mesh_transforms(obj)
    if mat:
        obj.data.materials.append(mat)
    if col:
        link_object(obj, col)
    if parent:
        set_parent_keep_world(obj, parent)
    return obj


def sphere(name, radius, location, mat=None, parent=None, col=None, segments=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=max(8, segments // 2), radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    if mat:
        obj.data.materials.append(mat)
    if col:
        link_object(obj, col)
    if parent:
        set_parent_keep_world(obj, parent)
    return obj


def add_bar_pull(prefix, center, length, front_y, parent, mat, col, radius=0.007, projection=0.026):
    x, _, z = center
    cylinder(f"{prefix}_Grip", radius, length, (x, front_y - projection, z), mat, axis="X", parent=parent, col=col, vertices=16)
    for index, hx in enumerate((x - length * 0.40, x + length * 0.40), start=1):
        cylinder(f"{prefix}_Mount_{index}", radius * 0.72, projection, (hx, front_y - projection * 0.5, z), mat, axis="Y", parent=parent, col=col, vertices=14)


def add_knob(prefix, center, front_y, parent, mat, col, radius=0.012):
    x, _, z = center
    cylinder(f"{prefix}_Collar", radius * 0.78, 0.010, (x, front_y - 0.006, z), mat, axis="Y", parent=parent, col=col, vertices=18)
    sphere(f"{prefix}_Knob", radius, (x, front_y - 0.022, z), mat, parent=parent, col=col, segments=18)


def add_panel_frame(prefix, center, width, height, plane_y, parent, mat, col, rail=0.028, projection=0.012, double=False):
    x, _, z = center
    y = plane_y - projection
    cube(f"{prefix}_Panel", (width - rail * 2.3, 0.010, height - rail * 2.3), (x, y + 0.004, z), mat, 0.003, parent, col, grain="Z")
    cube(f"{prefix}_RailTop", (width, 0.018, rail), (x, y, z + height / 2 - rail / 2), mat, 0.004, parent, col, grain="X")
    cube(f"{prefix}_RailBottom", (width, 0.018, rail), (x, y, z - height / 2 + rail / 2), mat, 0.004, parent, col, grain="X")
    cube(f"{prefix}_StileLeft", (rail, 0.018, height), (x - width / 2 + rail / 2, y, z), mat, 0.004, parent, col, grain="Z")
    cube(f"{prefix}_StileRight", (rail, 0.018, height), (x + width / 2 - rail / 2, y, z), mat, 0.004, parent, col, grain="Z")
    if double:
        inset_w = width - rail * 2.9
        inset_h = height - rail * 2.9
        thin = rail * 0.30
        cube(f"{prefix}_InnerTop", (inset_w, 0.014, thin), (x, y - 0.006, z + inset_h / 2), mat, 0.002, parent, col, grain="X")
        cube(f"{prefix}_InnerBottom", (inset_w, 0.014, thin), (x, y - 0.006, z - inset_h / 2), mat, 0.002, parent, col, grain="X")
        cube(f"{prefix}_InnerLeft", (thin, 0.014, inset_h), (x - inset_w / 2, y - 0.006, z), mat, 0.002, parent, col, grain="Z")
        cube(f"{prefix}_InnerRight", (thin, 0.014, inset_h), (x + inset_w / 2, y - 0.006, z), mat, 0.002, parent, col, grain="Z")


def add_side_panel(prefix, side_x, center_y, center_z, depth, height, parent, mat, col, double=False):
    # A framed side panel on an X-normal face.  Recess and rails remain true 3D parts.
    inward = -1 if side_x > 0 else 1
    x = side_x + inward * 0.009
    panel_depth = depth * 0.72
    panel_height = height * 0.72
    cube(f"{prefix}_Inset", (0.012, panel_depth, panel_height), (x, center_y, center_z), mat, 0.003, parent, col, grain="Z")
    rail = 0.028
    face_x = side_x + inward * 0.002
    cube(f"{prefix}_Top", (0.018, panel_depth, rail), (face_x, center_y, center_z + panel_height / 2), mat, 0.004, parent, col, grain="Y")
    cube(f"{prefix}_Bottom", (0.018, panel_depth, rail), (face_x, center_y, center_z - panel_height / 2), mat, 0.004, parent, col, grain="Y")
    cube(f"{prefix}_Front", (0.018, rail, panel_height), (face_x, center_y - panel_depth / 2, center_z), mat, 0.004, parent, col, grain="Z")
    cube(f"{prefix}_Back", (0.018, rail, panel_height), (face_x, center_y + panel_depth / 2, center_z), mat, 0.004, parent, col, grain="Z")
    if double:
        cylinder(f"{prefix}_UpperBead", 0.006, panel_depth * 0.90, (face_x + inward * 0.012, center_y, center_z + panel_height * 0.32), mat, axis="Y", parent=parent, col=col, vertices=12)
        cylinder(f"{prefix}_LowerBead", 0.006, panel_depth * 0.90, (face_x + inward * 0.012, center_y, center_z - panel_height * 0.32), mat, axis="Y", parent=parent, col=col, vertices=12)


def mark_collision(obj):
    obj.display_type = "WIRE"
    obj.hide_render = True
    obj["collision_proxy"] = True
    obj["purpose"] = "simplified player/furniture collision"


def all_descendants(root):
    result = []
    stack = [root]
    while stack:
        current = stack.pop()
        result.append(current)
        stack.extend(current.children)
    return result


def make_structure(desk):
    global MOVING_PARTS, CURRENT_DESK
    CURRENT_DESK = desk
    MOVING_PARTS = []
    root_col = collection(desk["asset"])
    root = empty(desk["asset"], col=root_col, size=0.12)
    root["asset_id"] = f"pro-shop-furniture:office-desks:{desk['runtime']}"
    root["asset_name"] = desk["asset"]
    root["reference_tier"] = desk["label"]
    root["furnitureTier"] = desk["tier_level"]
    root["dimensions_m"] = list(desk["dimensions"])
    root["front_direction"] = [0.0, -1.0, 0.0]
    root["source"] = "Original Golf Flipper Blender build; Designs/Desks reference"
    root["license"] = "Project-owned; no external asset or texture"

    groups = {}
    for name in ("Body", "Desktop", "ModestyPanel", "Hardware", "MovingParts", "InteractionNodes", "Collision"):
        groups[name] = empty(name, parent=root, col=root_col, size=0.08)
    collision_name = f"COLLISION_{desk['asset']}"
    groups["Collision"].name = collision_name
    return root_col, root, groups


def add_general_nodes(root, groups, dimensions, surface_z, margin_x=0.12, margin_y=0.11):
    width, _, depth = dimensions
    col = root.users_collection[0]
    parent = groups["InteractionNodes"]
    nodes = {
        "INTERACTION_POINT": (0, -depth / 2 - 0.34, 0.92),
        "PLACEMENT_FOOTPRINT": (0, 0, 0),
        "CHAIR_ANCHOR": (0, -depth / 2 - 0.48, 0),
        "PACK_ANCHOR": (0, depth / 2 + 0.36, 0.86),
        "DESK_SURFACE_CENTER": (0, 0, surface_z),
        "DESK_SURFACE_MIN": (-width / 2 + margin_x, -depth / 2 + margin_y, surface_z),
        "DESK_SURFACE_MAX": (width / 2 - margin_x, depth / 2 - margin_y, surface_z),
        "DESK_SURFACE_LEFT": (-width * 0.28, 0, surface_z),
        "DESK_SURFACE_RIGHT": (width * 0.28, 0, surface_z),
    }
    for name, location in nodes.items():
        node = empty(name, location, parent=parent, col=col, size=0.055)
        node["node_type"] = "placement" if "SURFACE" in name or "FOOTPRINT" in name else "interaction"
        if name == "CHAIR_ANCHOR":
            node["forward"] = [0.0, 1.0, 0.0]
        if name == "PACK_ANCHOR":
            node["interactionType"] = "pack-furniture"
    return nodes


def _linearize_action(action):
    try:
        for fcurve in action.fcurves:
            for point in fcurve.keyframe_points:
                point.interpolation = "BEZIER"
                point.handle_left_type = "AUTO_CLAMPED"
                point.handle_right_type = "AUTO_CLAMPED"
    except AttributeError:
        # Blender 5 action slots still accept keyframe_insert; interpolation is an
        # optional polish path and does not affect the runtime metadata contract.
        pass


def _action_for_transform(obj, name, data_path, start_value, end_value):
    obj.animation_data_create()
    action = bpy.data.actions.new(name=name)
    action.use_fake_user = True
    obj.animation_data.action = action
    if data_path == "location":
        obj.location = start_value
        obj.keyframe_insert(data_path="location", frame=1, group=name)
        obj.location = end_value
        obj.keyframe_insert(data_path="location", frame=18, group=name)
        obj.location = start_value
    else:
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = start_value
        obj.keyframe_insert(data_path="rotation_euler", frame=1, group=name)
        obj.rotation_euler = end_value
        obj.keyframe_insert(data_path="rotation_euler", frame=18, group=name)
        obj.rotation_euler = start_value
    _linearize_action(action)
    obj.animation_data.action = None
    return action


def add_component_animations(component):
    name = component.name
    if component["interactionType"] == "drawer":
        target_name = component.get("animationTarget")
        target = bpy.data.objects.get(target_name) if target_name else component
        closed = Vector((0.0, 0.0, 0.0))
        opened = Vector((0.0, -float(component["openDistance"]), 0.0))
        open_action = _action_for_transform(target, f"Open_{name}", "location", closed, opened)
        close_action = _action_for_transform(target, f"Close_{name}", "location", opened, closed)
    else:
        target = component
        closed = Vector(component["closedRotation"])
        opened = Vector(component["openRotation"])
        open_action = _action_for_transform(target, f"Open_{name}", "rotation_euler", closed, opened)
        close_action = _action_for_transform(target, f"Close_{name}", "rotation_euler", opened, closed)

    # NLA_TRACKS is the glTF export mode used below.  Non-overlapping strips keep
    # the authored static frame closed while preserving independently named clips.
    for track_name, action, start in (
        (f"Open_{name}", open_action, 1),
        (f"Close_{name}", close_action, 24),
    ):
        track = target.animation_data.nla_tracks.new()
        track.name = track_name
        strip = track.strips.new(track_name, start, action)
        strip.extrapolation = "NOTHING"
        strip.blend_type = "REPLACE"
    target.location = closed if component["interactionType"] == "drawer" else target.location
    component.location = Vector(component["closedLocation"])
    component.rotation_euler = Vector(component["closedRotation"])


def add_drawer(
    name, x, z, width, height, desk_depth, box_depth, open_distance,
    moving_parent, hardware_parent, col, front_mat, interior_mat,
    sound, handle="bar", front_bevel=0.008,
):
    front_y = -desk_depth / 2 + 0.018
    component = empty(name, (x, front_y, z), parent=moving_parent, col=col, size=0.065)
    component["interactionType"] = "drawer"
    component["movementAxis"] = [0.0, -1.0, 0.0]
    component["openDistance"] = open_distance
    component["closedLocation"] = list(component.location)
    component["openLocation"] = [component.location.x, component.location.y - open_distance, component.location.z]
    component["closedRotation"] = [0.0, 0.0, 0.0]
    component["openRotation"] = [0.0, 0.0, 0.0]
    component["interactionSoundCategory"] = sound
    component["storageCapacity"] = round(width * max(0.05, height - 0.055) * max(0.08, box_depth - 0.04), 4)

    # Keep the closed pivot on the metadata root.  Translation clips animate a
    # zero-based child so glTF can retain the root's static transform even when
    # animation channels are exported for the drawer motion.
    motion = empty(f"{name}_Motion", (x, front_y, z), parent=component, col=col, size=0.045)
    component["animationTarget"] = motion.name

    front = cube(f"{name}_Front", (width, 0.026, height), (x, front_y, z), front_mat, front_bevel, motion, col, grain="X", segments=3)
    front["moving_component"] = name
    inner_height = max(0.05, height - 0.055)
    wall = 0.018
    bottom_z = z - height / 2 + wall + 0.018
    rear_y = front_y + box_depth - wall
    center_y = front_y + box_depth / 2
    cube(f"{name}_DrawerBox_Bottom", (width - 0.035, box_depth - 0.025, wall), (x, center_y, bottom_z), interior_mat, 0.003, motion, col, grain="X")
    cube(f"{name}_DrawerBox_Left", (wall, box_depth - 0.025, inner_height), (x - width / 2 + wall, center_y, bottom_z + inner_height / 2), interior_mat, 0.003, motion, col, grain="Y")
    cube(f"{name}_DrawerBox_Right", (wall, box_depth - 0.025, inner_height), (x + width / 2 - wall, center_y, bottom_z + inner_height / 2), interior_mat, 0.003, motion, col, grain="Y")
    cube(f"{name}_DrawerBox_Back", (width - 0.035, wall, inner_height), (x, rear_y, bottom_z + inner_height / 2), interior_mat, 0.003, motion, col, grain="X")

    handle_z = z + max(-0.015, height * 0.10)
    if handle == "knob":
        add_knob(f"{name}_Handle", (x, front_y, handle_z), front_y - 0.014, motion, MATERIALS["brass"], col, radius=0.012)
    else:
        handle_mat = MATERIALS["steel"] if CURRENT_DESK["tier_level"] <= 2 else MATERIALS["brass"]
        add_bar_pull(f"{name}_Handle", (x, front_y, handle_z), min(width * 0.44, 0.17), front_y - 0.014, motion, handle_mat, col, radius=0.0065 if CURRENT_DESK["tier_level"] <= 2 else 0.0075)

    interact = empty(f"INTERACT_{name}", (x, front_y - 0.095, handle_z), parent=motion, col=col, size=0.045)
    interact["interactionType"] = "drawer"
    interact["component"] = name
    storage = empty(f"STORAGE_ZONE_{name}", (x, center_y, bottom_z + 0.032), parent=motion, col=col, display="CUBE", size=min(width, box_depth) * 0.22)
    storage["storage_zone"] = True
    storage["bounds_m"] = [round(width - 0.08, 3), round(box_depth - 0.08, 3), round(inner_height - 0.025, 3)]
    MOVING_PARTS.append(component)
    return component


def add_cabinet(
    name, center_x, bottom_z, width, height, desk_depth, hinge_side,
    body_parent, moving_parent, col, mat, interior_mat, sound, double_panel=False,
):
    front_y = -desk_depth / 2 + 0.018
    cabinet = empty(name.replace("Door_", "_"), (center_x, 0, bottom_z), parent=body_parent, col=col, size=0.06)
    cabinet["storage_container"] = True
    wall = 0.022
    back_y = desk_depth / 2 - 0.045
    interior_depth = desk_depth - 0.11
    center_y = front_y + interior_depth / 2 + 0.02
    cube(f"{name}_InteriorBottom", (width - 0.045, interior_depth, wall), (center_x, center_y, bottom_z + wall), interior_mat, 0.003, cabinet, col, grain="X")
    cube(f"{name}_InteriorBack", (width - 0.045, wall, height - 0.045), (center_x, back_y, bottom_z + height / 2), interior_mat, 0.003, cabinet, col, grain="X")
    cube(f"{name}_InteriorLeft", (wall, interior_depth, height - 0.045), (center_x - width / 2 + wall, center_y, bottom_z + height / 2), interior_mat, 0.003, cabinet, col, grain="Y")
    cube(f"{name}_InteriorRight", (wall, interior_depth, height - 0.045), (center_x + width / 2 - wall, center_y, bottom_z + height / 2), interior_mat, 0.003, cabinet, col, grain="Y")
    cube(f"{name}_InteriorShelf", (width - 0.075, interior_depth - 0.045, 0.018), (center_x, center_y, bottom_z + height * 0.49), interior_mat, 0.003, cabinet, col, grain="X")

    left_hinge = hinge_side == "left"
    hinge_x = center_x - width / 2 + 0.008 if left_hinge else center_x + width / 2 - 0.008
    component = empty(name, (hinge_x, front_y, bottom_z + height / 2), parent=moving_parent, col=col, size=0.065)
    open_angle = math.radians(-96 if left_hinge else 96)
    component["interactionType"] = "cabinet-door"
    component["hingeAxis"] = [0.0, 0.0, 1.0]
    component["openAngle"] = math.degrees(open_angle)
    component["closedLocation"] = list(component.location)
    component["openLocation"] = list(component.location)
    component["closedRotation"] = [0.0, 0.0, 0.0]
    component["openRotation"] = [0.0, 0.0, open_angle]
    component["interactionSoundCategory"] = sound

    door_center_x = center_x
    cube(f"{name}_Slab", (width - 0.018, 0.028, height - 0.018), (door_center_x, front_y, bottom_z + height / 2), mat, 0.009, component, col, grain="Z", segments=3)
    add_panel_frame(
        f"{name}_Raised", (door_center_x, front_y, bottom_z + height / 2),
        width * 0.72, height * 0.70, front_y - 0.015, component, mat, col,
        rail=0.026, projection=0.010, double=double_panel,
    )
    knob_x = center_x + width * 0.30 if left_hinge else center_x - width * 0.30
    knob_z = bottom_z + height * 0.57
    add_knob(f"{name}_Handle", (knob_x, front_y, knob_z), front_y - 0.028, component, MATERIALS["brass"], col, radius=0.013)
    for hinge_index, hz in enumerate((bottom_z + height * 0.22, bottom_z + height * 0.78), start=1):
        cylinder(f"{name}_Hinge_{hinge_index}", 0.006, 0.046, (hinge_x, front_y + 0.010, hz), MATERIALS["brass"], axis="Z", parent=component, col=col, vertices=14)

    interact = empty(f"INTERACT_{name}", (knob_x, front_y - 0.095, knob_z), parent=component, col=col, size=0.045)
    interact["interactionType"] = "cabinet-door"
    interact["component"] = name
    storage = empty(f"STORAGE_ZONE_{name.replace('Door_', '')}", (center_x, center_y, bottom_z + 0.05), parent=cabinet, col=col, display="CUBE", size=min(width, interior_depth) * 0.23)
    storage["storage_zone"] = True
    storage["bounds_m"] = [round(width - 0.09, 3), round(interior_depth - 0.08, 3), round(height - 0.10, 3)]
    MOVING_PARTS.append(component)
    return component


def add_collision_box(name, size, location, collision_parent, col):
    proxy = cube(name, size, location, None, 0, collision_parent, col)
    mark_collision(proxy)
    return proxy


def add_desktop(groups, col, dimensions, thickness, mat, bevel, layers=0):
    width, height, depth = dimensions
    desktop = groups["Desktop"]
    main = cube("Desktop", (width, depth, thickness), (0, 0, height - thickness / 2), mat, bevel, desktop, col, grain="X", segments=3)
    main["usable_surface_z"] = height
    if layers >= 1:
        cube("Desktop_EdgeMolding_Lower", (width * 1.012, depth * 1.012, 0.020), (0, 0, height - thickness - 0.005), mat, min(bevel, 0.009), desktop, col, grain="X", segments=3)
    if layers >= 2:
        cube("Desktop_EdgeMolding_Upper", (width * 1.018, depth * 1.018, 0.018), (0, 0, height - 0.015), mat, min(bevel, 0.009), desktop, col, grain="X", segments=3)
    return main


def add_plinth(prefix, x, width, desk_depth, bottom_z, body_parent, col, mat, layers=2, notched=False):
    depth = desk_depth * 0.92
    cube(f"{prefix}_Base", (width, depth, 0.065), (x, 0.01, bottom_z + 0.0325), mat, 0.010, body_parent, col, grain="X", segments=3)
    if layers >= 2:
        cube(f"{prefix}_BaseMolding", (width * 1.035, depth * 1.035, 0.028), (x, 0.01, bottom_z + 0.078), mat, 0.007, body_parent, col, grain="X", segments=3)
    if layers >= 3:
        cube(f"{prefix}_BaseBead", (width * 1.055, depth * 1.055, 0.016), (x, 0.01, bottom_z + 0.099), mat, 0.006, body_parent, col, grain="X", segments=3)
    if notched:
        foot_w = width * 0.24
        for side in (-1, 1):
            cube(f"{prefix}_Foot_{'L' if side < 0 else 'R'}", (foot_w, depth * 0.94, 0.032), (x + side * width * 0.34, 0.01, bottom_z + 0.016), mat, 0.006, body_parent, col, grain="X")


def add_pedestal_face_frame(
    prefix, x, width, desk_depth, frame_top, body_parent, col, mat,
    *, plinth_layers=2, fluted=False,
):
    """Build one continuous cabinet/drawer surround and return its clear opening.

    Doors and drawers use the returned opening instead of independently chosen
    dimensions, so their reveals, rails, pedestal sides, and plinth all share
    the same physical datums.
    """
    front_y = -desk_depth / 2 + 0.032
    frame_depth = 0.050
    frame_bottom = 0.083 if plinth_layers <= 2 else 0.098
    lower_rail_h = 0.052
    upper_rail_h = 0.046
    stile_w = 0.044 if plinth_layers <= 2 else 0.052 if not fluted else 0.056
    reveal = 0.007
    opening_width = width - stile_w * 2 - reveal * 2
    opening_bottom = frame_bottom + lower_rail_h + reveal
    opening_top = frame_top - upper_rail_h - reveal
    opening_height = opening_top - opening_bottom
    if opening_width <= 0.18 or opening_height <= 0.24:
        raise ValueError(f"{prefix} face-frame opening is not usable")

    cube(f"{prefix}_FaceLowerRail", (width + 0.010, frame_depth, lower_rail_h), (x, front_y, frame_bottom + lower_rail_h / 2), mat, 0.007, body_parent, col, grain="X", segments=3)
    cube(f"{prefix}_FaceUpperRail", (width + 0.018, frame_depth, upper_rail_h), (x, front_y, frame_top - upper_rail_h / 2), mat, 0.007, body_parent, col, grain="X", segments=3)
    cube(f"{prefix}_FaceCrown", (width + 0.038, frame_depth + 0.008, 0.022), (x, front_y, frame_top - 0.003), mat, 0.006, body_parent, col, grain="X", segments=3)

    if not fluted:
        stile_height = frame_top - frame_bottom
        for side_name, side in (("Left", -1), ("Right", 1)):
            sx = x + side * (width / 2 - stile_w / 2)
            cube(f"{prefix}_FaceStile{side_name}", (stile_w, frame_depth, stile_height), (sx, front_y, frame_bottom + stile_height / 2), mat, 0.007, body_parent, col, grain="Z", segments=3)

    # A narrow recessed shadow line makes the moving front read as seated
    # joinery, while leaving the cabinet mouth physically open when the door
    # swings away.
    shadow_y = front_y + frame_depth * 0.48
    shadow_t = 0.009
    shadow_w = opening_width + reveal
    shadow_h = opening_height + reveal
    cube(f"{prefix}_RevealTop", (shadow_w, 0.010, shadow_t), (x, shadow_y, opening_top + reveal / 2), MATERIALS["shadow"], 0.002, body_parent, col, grain="X")
    cube(f"{prefix}_RevealBottom", (shadow_w, 0.010, shadow_t), (x, shadow_y, opening_bottom - reveal / 2), MATERIALS["shadow"], 0.002, body_parent, col, grain="X")
    for side_name, side in (("Left", -1), ("Right", 1)):
        cube(
            f"{prefix}_Reveal{side_name}",
            (shadow_t, 0.010, shadow_h),
            (x + side * (opening_width / 2 + reveal / 2), shadow_y, (opening_bottom + opening_top) / 2),
            MATERIALS["shadow"], 0.002, body_parent, col, grain="Z",
        )

    return {
        "width": opening_width,
        "bottom": opening_bottom,
        "top": opening_top,
        "height": opening_height,
    }


def finalize_motion():
    for component in MOVING_PARTS:
        add_component_animations(component)
    bpy.context.scene.frame_set(1)


def build_basic(desk):
    col, root, groups = make_structure(desk)
    w, h, d = desk["dimensions"]
    body = groups["Body"]
    hardware = groups["Hardware"]
    moving = groups["MovingParts"]
    modesty = groups["ModestyPanel"]

    add_desktop(groups, col, desk["dimensions"], 0.045, MATERIALS["surface"], 0.014, layers=0)
    frame_z = (h - 0.055) / 2
    leg_h = h - 0.07
    leg_x = (-w / 2 + 0.055, -w / 2 + 0.475, w / 2 - 0.055)
    for ix, x in enumerate(leg_x):
        for side, y in enumerate((-d / 2 + 0.055, d / 2 - 0.055)):
            cube(f"Body_Leg_{ix + 1}_{'Front' if side == 0 else 'Rear'}", (0.052, 0.052, leg_h), (x, y, frame_z), MATERIALS["body"], 0.006, body, col, grain="Z")
            cube(f"Hardware_FootPad_{ix + 1}_{side + 1}", (0.058, 0.058, 0.018), (x, y, 0.009), MATERIALS["charcoal"], 0.004, hardware, col)
    pedestal_bottom = 0.055
    pedestal_top = h - 0.055
    pedestal_height = pedestal_top - pedestal_bottom
    pedestal_center_z = pedestal_bottom + pedestal_height / 2
    cube("Body_LeftPedestalOuter", (0.040, d * 0.94, pedestal_height), (-w / 2 + 0.074, 0, pedestal_center_z), MATERIALS["body"], 0.006, body, col, grain="Z")
    cube("Body_LeftPedestalInner", (0.040, d * 0.94, pedestal_height), (-w / 2 + 0.455, 0, pedestal_center_z), MATERIALS["body"], 0.006, body, col, grain="Z")
    cube("Body_LeftPedestalBack", (0.385, 0.034, pedestal_height), (-w / 2 + 0.265, d / 2 - 0.075, pedestal_center_z), MATERIALS["body"], 0.006, body, col, grain="X")
    cube("Body_LeftPedestalTopRail", (0.40, d * 0.94, 0.024), (-w / 2 + 0.265, 0, pedestal_top), MATERIALS["body"], 0.004, body, col, grain="X")
    cube("Body_LeftPedestalBottomRail", (0.395, 0.042, 0.055), (-w / 2 + 0.265, -d / 2 + 0.055, 0.185), MATERIALS["body"], 0.006, body, col, grain="X")
    cube("Body_DrawerDivider", (0.37, d * 0.69, 0.025), (-w / 2 + 0.265, 0.035, h * 0.505), MATERIALS["body"], 0.004, body, col, grain="X")
    cube("Body_DrawerRevealRail", (0.365, 0.030, 0.014), (-w / 2 + 0.265, -d / 2 + 0.038, 0.579), MATERIALS["shadow"], 0.002, body, col, grain="X")
    privacy_bottom = 0.075
    privacy_top = h - 0.055
    cube("Body_RightPrivacyPanel", (0.032, d * 0.80, privacy_top - privacy_bottom), (w / 2 - 0.075, 0, (privacy_top + privacy_bottom) / 2), MATERIALS["body"], 0.006, body, col, grain="Z")
    cube("Body_FrontApron", (w * 0.52, 0.034, 0.115), (w * 0.19, -d / 2 + 0.075, h - 0.112), MATERIALS["body"], 0.006, body, col, grain="X")
    modesty_bottom = 0.170
    modesty_top = h - 0.145
    cube("ModestyPanel", (w * 0.54, 0.030, modesty_top - modesty_bottom), (w * 0.18, d / 2 - 0.070, (modesty_top + modesty_bottom) / 2), MATERIALS["body"], 0.005, modesty, col, grain="X")
    cube("ModestyPanel_LowerRail", (w * 0.54, 0.042, 0.035), (w * 0.18, d / 2 - 0.075, modesty_bottom), MATERIALS["body"], 0.005, modesty, col, grain="X")

    drawer_x = -w / 2 + 0.265
    add_drawer("Drawer_Left_Top", drawer_x, 0.655, 0.345, 0.140, d, 0.43, 0.34, moving, hardware, col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], handle="bar", front_bevel=0.005)
    add_drawer("Drawer_Left_Bottom", drawer_x, 0.402, 0.345, 0.340, d, 0.47, 0.37, moving, hardware, col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], handle="bar", front_bevel=0.005)

    add_general_nodes(root, groups, desk["dimensions"], h, margin_x=0.075, margin_y=0.07)
    add_collision_box("COL_Desk_Basic_Desktop", (w, d, 0.09), (0, 0, h - 0.045), groups["Collision"], col)
    add_collision_box("COL_Desk_Basic_LeftPedestal", (0.43, d * 0.86, pedestal_top), (-w / 2 + 0.26, 0, pedestal_top / 2), groups["Collision"], col)
    add_collision_box("COL_Desk_Basic_RightSide", (0.12, d * 0.84, privacy_top), (w / 2 - 0.07, 0, privacy_top / 2), groups["Collision"], col)
    finalize_motion()
    return col, root, groups


def _standard_pedestal(body, col, x, width, h, d, side):
    side_name = "Left" if side < 0 else "Right"
    pedestal_bottom = 0.095
    pedestal_top = h - 0.060
    pedestal_height = pedestal_top - pedestal_bottom
    pedestal_center_z = pedestal_bottom + pedestal_height / 2
    cube(f"Body_{side_name}PedestalOuter", (0.044, d * 0.94, pedestal_height), (x + side * width / 2, 0, pedestal_center_z), MATERIALS["body"], 0.007, body, col, grain="Z")
    cube(f"Body_{side_name}PedestalInner", (0.044, d * 0.94, pedestal_height), (x - side * width / 2, 0, pedestal_center_z), MATERIALS["body"], 0.007, body, col, grain="Z")
    cube(f"Body_{side_name}PedestalBack", (width, 0.032, pedestal_height), (x, d / 2 - 0.064, pedestal_center_z), MATERIALS["body"], 0.006, body, col, grain="X")
    cube(f"Body_{side_name}PedestalTop", (width + 0.02, d * 0.96, 0.018), (x, 0, h - 0.064), MATERIALS["body"], 0.004, body, col, grain="X")
    cube(f"Body_{side_name}FaceBottomRail", (width - 0.012, 0.046, 0.052), (x, -d / 2 + 0.050, 0.122), MATERIALS["body"], 0.006, body, col, grain="X")
    cube(f"Body_{side_name}FaceTopRail", (width + 0.010, 0.046, 0.030), (x, -d / 2 + 0.050, h - 0.078), MATERIALS["body"], 0.005, body, col, grain="X")
    for separator, z in enumerate((0.541, 0.390), start=1):
        cube(f"Body_{side_name}DrawerSeparator_{separator}", (width - 0.025, d * 0.70, 0.020), (x, 0.025, z), MATERIALS["shadow"], 0.003, body, col, grain="X")
    for front_back, y in enumerate((-d / 2 + 0.07, d / 2 - 0.07), start=1):
        for foot_side, fx in enumerate((x - width * 0.37, x + width * 0.37), start=1):
            cube(f"Body_{side_name}Foot_{front_back}_{foot_side}", (0.068, 0.068, 0.095), (fx, y, 0.0475), MATERIALS["body"], 0.008, body, col, grain="Z")


def build_standard(desk):
    col, root, groups = make_structure(desk)
    w, h, d = desk["dimensions"]
    body, moving, modesty = groups["Body"], groups["MovingParts"], groups["ModestyPanel"]
    add_desktop(groups, col, desk["dimensions"], 0.055, MATERIALS["surface"], 0.012, layers=0)
    pedestal_w = 0.38
    pedestal_x = w / 2 - pedestal_w / 2 - 0.045
    _standard_pedestal(body, col, -pedestal_x, pedestal_w, h, d, -1)
    _standard_pedestal(body, col, pedestal_x, pedestal_w, h, d, 1)
    cube("Body_CenterDrawerFrame", (w - pedestal_w * 2 - 0.12, 0.055, 0.024), (0, -d / 2 + 0.080, h - 0.074), MATERIALS["body"], 0.004, body, col, grain="X")
    modesty_bottom = 0.170
    modesty_top = 0.555
    cube("ModestyPanel", (w - pedestal_w * 2 - 0.13, 0.034, modesty_top - modesty_bottom), (0, d / 2 - 0.065, (modesty_top + modesty_bottom) / 2), MATERIALS["body"], 0.006, modesty, col, grain="X")
    cube("ModestyPanel_LowerRail", (w - pedestal_w * 2 - 0.13, 0.046, 0.040), (0, d / 2 - 0.068, modesty_bottom), MATERIALS["body"], 0.005, modesty, col, grain="X")

    drawer_specs = (("Top", 0.620, 0.145, 0.39, 0.31), ("Middle", 0.465, 0.140, 0.41, 0.32), ("Bottom", 0.273, 0.225, 0.46, 0.35))
    for side_name, x in (("Left", -pedestal_x), ("Right", pedestal_x)):
        for row_name, z, height, box_depth, open_distance in drawer_specs:
            add_drawer(f"Drawer_{side_name}_{row_name}", x, z, pedestal_w - 0.055, height, d, box_depth, open_distance, moving, groups["Hardware"], col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], handle="bar", front_bevel=0.006)
        cube(f"Body_{side_name}DrawerRevealUpper", (pedestal_w - 0.035, 0.030, 0.017), (x, -d / 2 + 0.039, 0.541), MATERIALS["shadow"], 0.002, body, col, grain="X")
        cube(f"Body_{side_name}DrawerRevealLower", (pedestal_w - 0.035, 0.030, 0.010), (x, -d / 2 + 0.039, 0.390), MATERIALS["shadow"], 0.002, body, col, grain="X")
    center_width = w - pedestal_w * 2 - 0.16
    add_drawer("Drawer_Center", 0, 0.635, center_width, 0.115, d, 0.36, 0.28, moving, groups["Hardware"], col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], handle="bar", front_bevel=0.006)

    add_general_nodes(root, groups, desk["dimensions"], h, margin_x=0.085, margin_y=0.075)
    add_collision_box("COL_Desk_Standard_Desktop", (w, d, 0.10), (0, 0, h - 0.05), groups["Collision"], col)
    add_collision_box("COL_Desk_Standard_LeftPedestal", (pedestal_w + 0.05, d * 0.88, h - 0.10), (-pedestal_x, 0, (h - 0.10) / 2), groups["Collision"], col)
    add_collision_box("COL_Desk_Standard_RightPedestal", (pedestal_w + 0.05, d * 0.88, h - 0.10), (pedestal_x, 0, (h - 0.10) / 2), groups["Collision"], col)
    finalize_motion()
    return col, root, groups


def add_executive_shell(desk, groups, col, *, pedestal_width, top_thickness, top_layers, panel_double, plinth_layers, fluted=False):
    w, h, d = desk["dimensions"]
    body, modesty = groups["Body"], groups["ModestyPanel"]
    add_desktop(groups, col, desk["dimensions"], top_thickness, MATERIALS["surface"], 0.018 if desk["tier_level"] == 3 else 0.022, layers=top_layers)
    x_offset = w / 2 - pedestal_width / 2 - 0.055
    top_drawer_bottom = h - top_thickness - 0.165
    pedestal_bottom = 0.035
    pedestal_top = top_drawer_bottom + 0.015
    pedestal_height = pedestal_top - pedestal_bottom
    for side_name, x, side in (("Left", -x_offset, -1), ("Right", x_offset, 1)):
        cube(f"Body_{side_name}PedestalOuter", (0.050, d * 0.94, pedestal_height), (x + side * pedestal_width / 2, 0, pedestal_bottom + pedestal_height / 2), MATERIALS["body"], 0.008, body, col, grain="Z")
        cube(f"Body_{side_name}PedestalInner", (0.050, d * 0.94, pedestal_height), (x - side * pedestal_width / 2, 0, pedestal_bottom + pedestal_height / 2), MATERIALS["body"], 0.008, body, col, grain="Z")
        cube(f"Body_{side_name}PedestalBack", (pedestal_width, 0.045, pedestal_height), (x, d / 2 - 0.065, pedestal_bottom + pedestal_height / 2), MATERIALS["body"], 0.008, body, col, grain="X")
        cube(f"Body_{side_name}PedestalHeader", (pedestal_width + 0.02, d * 0.96, 0.050), (x, 0, pedestal_top - 0.025), MATERIALS["body"], 0.008, body, col, grain="X")
        add_side_panel(f"Body_{side_name}SideRaisedPanel", side * (w / 2 - 0.060), 0.03, pedestal_bottom + pedestal_height * 0.50, d * 0.78, pedestal_height * 0.74, body, MATERIALS["body"], col, double=panel_double)
        add_plinth(f"Body_{side_name}Plinth", x, pedestal_width + 0.04, d, 0.0, body, col, MATERIALS["body"], layers=plinth_layers, notched=True)
        if fluted:
            outer_x = x + side * (pedestal_width / 2 - 0.028)
            inner_x = x - side * (pedestal_width / 2 - 0.028)
            for column_name, cx in (("Outer", outer_x), ("Inner", inner_x)):
                cube(f"Body_{side_name}{column_name}Column", (0.052, 0.055, pedestal_height * 0.86), (cx, -d / 2 + 0.032, pedestal_bottom + pedestal_height * 0.50), MATERIALS["body"], 0.008, body, col, grain="Z")
                for flute in (-0.014, 0.0, 0.014):
                    cylinder(f"Body_{side_name}{column_name}Flute_{flute:+.3f}", 0.0035, pedestal_height * 0.70, (cx + flute, -d / 2 + 0.001, pedestal_bottom + pedestal_height * 0.51), MATERIALS["shadow"], axis="Z", parent=body, col=col, vertices=10)

    knee_width = w - pedestal_width * 2 - 0.15
    cube("Body_CenterApron", (knee_width, 0.060, 0.150), (0, -d / 2 + 0.075, h - top_thickness - 0.085), MATERIALS["body"], 0.008, body, col, grain="X")
    modesty_height = 0.39 if desk["tier_level"] <= 3 else 0.43
    modesty_z = 0.34
    cube("ModestyPanel", (knee_width + 0.08, 0.042, modesty_height), (0, d / 2 - 0.060, modesty_z), MATERIALS["body"], 0.007, modesty, col, grain="X")
    panel_count = 2 if desk["tier_level"] <= 4 else 3
    panel_width = (knee_width - 0.10) / panel_count
    for index in range(panel_count):
        px = -knee_width / 2 + panel_width / 2 + index * panel_width
        add_panel_frame(f"ModestyPanel_Raised_{index + 1}", (px, d / 2 - 0.060, modesty_z), panel_width * 0.82, modesty_height * 0.68, d / 2 - 0.086, modesty, MATERIALS["body"], col, rail=0.022, projection=0.008, double=panel_double)
    cube("ModestyPanel_BaseRail", (knee_width + 0.12, 0.060, 0.058), (0, d / 2 - 0.052, 0.085), MATERIALS["body"], 0.008, modesty, col, grain="X")
    return x_offset, knee_width, top_drawer_bottom, pedestal_bottom


def build_premium(desk):
    col, root, groups = make_structure(desk)
    w, h, d = desk["dimensions"]
    pedestal_w = 0.405
    xoff, knee, top_drawer_bottom, _ = add_executive_shell(
        desk, groups, col, pedestal_width=pedestal_w, top_thickness=0.070,
        top_layers=1, panel_double=False, plinth_layers=2, fluted=False,
    )
    moving = groups["MovingParts"]
    frame_top = top_drawer_bottom + 0.015
    left_opening = add_pedestal_face_frame(
        "Body_LeftPedestal", -xoff, pedestal_w, d, frame_top,
        groups["Body"], col, MATERIALS["body"], plinth_layers=2,
    )
    right_opening = add_pedestal_face_frame(
        "Body_RightPedestal", xoff, pedestal_w, d, frame_top,
        groups["Body"], col, MATERIALS["body"], plinth_layers=2,
    )
    drawer_z = 0.642
    add_drawer("Drawer_Left_Top", -xoff, drawer_z, pedestal_w - 0.060, 0.120, d, 0.45, 0.35, moving, groups["Hardware"], col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], handle="knob", front_bevel=0.008)
    add_drawer("Drawer_Center", 0, drawer_z, knee - 0.035, 0.120, d, 0.40, 0.31, moving, groups["Hardware"], col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], handle="knob", front_bevel=0.008)
    add_drawer("Drawer_Right_Top", xoff, drawer_z, pedestal_w - 0.060, 0.120, d, 0.45, 0.35, moving, groups["Hardware"], col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], handle="knob", front_bevel=0.008)
    add_cabinet("CabinetDoor_Left", -xoff, left_opening["bottom"], left_opening["width"], left_opening["height"], d, "left", groups["Body"], moving, col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], double_panel=False)
    add_cabinet("CabinetDoor_Right", xoff, right_opening["bottom"], right_opening["width"], right_opening["height"], d, "right", groups["Body"], moving, col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], double_panel=False)

    # Reference-specific cornice and front pilasters separate this handcrafted
    # silhouette from the Standard manufactured desk.
    cube("Body_FrontCornice", (w * 0.96, 0.045, 0.035), (0, -d / 2 + 0.050, h - 0.105), MATERIALS["body"], 0.007, groups["Body"], col, grain="X", segments=3)
    for side_name, x in (("Left", -xoff - pedestal_w * 0.44), ("Right", xoff + pedestal_w * 0.44)):
        cube(f"Body_{side_name}FrontPilaster", (0.048, 0.052, 0.455), (x, -d / 2 + 0.050, 0.34), MATERIALS["body"], 0.007, groups["Body"], col, grain="Z")
    add_general_nodes(root, groups, desk["dimensions"], h, margin_x=0.11, margin_y=0.095)
    add_collision_box("COL_Desk_Premium_Desktop", (w, d, 0.11), (0, 0, h - 0.055), groups["Collision"], col)
    add_collision_box("COL_Desk_Premium_LeftPedestal", (pedestal_w + 0.08, d * 0.90, 0.64), (-xoff, 0, 0.32), groups["Collision"], col)
    add_collision_box("COL_Desk_Premium_RightPedestal", (pedestal_w + 0.08, d * 0.90, 0.64), (xoff, 0, 0.32), groups["Collision"], col)
    finalize_motion()
    return col, root, groups


def build_high_end(desk):
    col, root, groups = make_structure(desk)
    w, h, d = desk["dimensions"]
    pedestal_w = 0.445
    xoff, knee, top_drawer_bottom, _ = add_executive_shell(
        desk, groups, col, pedestal_width=pedestal_w, top_thickness=0.082,
        top_layers=2, panel_double=True, plinth_layers=3, fluted=False,
    )
    moving = groups["MovingParts"]
    frame_top = top_drawer_bottom + 0.015
    left_opening = add_pedestal_face_frame(
        "Body_LeftPedestal", -xoff, pedestal_w, d, frame_top,
        groups["Body"], col, MATERIALS["body"], plinth_layers=3,
    )
    right_opening = add_pedestal_face_frame(
        "Body_RightPedestal", xoff, pedestal_w, d, frame_top,
        groups["Body"], col, MATERIALS["body"], plinth_layers=3,
    )
    drawer_z = 0.640
    add_drawer("Drawer_Left_Top", -xoff, drawer_z, pedestal_w - 0.065, 0.125, d, 0.48, 0.37, moving, groups["Hardware"], col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], handle="knob", front_bevel=0.010)
    add_drawer("Drawer_Center", 0, drawer_z, knee - 0.032, 0.125, d, 0.43, 0.33, moving, groups["Hardware"], col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], handle="knob", front_bevel=0.010)
    add_drawer("Drawer_Right_Top", xoff, drawer_z, pedestal_w - 0.065, 0.125, d, 0.48, 0.37, moving, groups["Hardware"], col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], handle="knob", front_bevel=0.010)
    add_cabinet("CabinetDoor_Left", -xoff, left_opening["bottom"], left_opening["width"], left_opening["height"], d, "left", groups["Body"], moving, col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], double_panel=True)
    add_cabinet("CabinetDoor_Right", xoff, right_opening["bottom"], right_opening["width"], right_opening["height"], d, "right", groups["Body"], moving, col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], double_panel=True)

    cube("Body_UpperMolding", (w * 0.975, 0.052, 0.040), (0, -d / 2 + 0.058, h - 0.120), MATERIALS["body"], 0.008, groups["Body"], col, grain="X", segments=3)
    for side_name, x in (("Left", -xoff - pedestal_w * 0.45), ("Right", xoff + pedestal_w * 0.45)):
        cube(f"Body_{side_name}CornerBlock", (0.058, 0.060, 0.490), (x, -d / 2 + 0.055, 0.35), MATERIALS["body"], 0.008, groups["Body"], col, grain="Z", segments=3)
        cube(f"Body_{side_name}CornerCapital", (0.078, 0.078, 0.040), (x, -d / 2 + 0.055, 0.608), MATERIALS["body"], 0.007, groups["Body"], col, grain="X", segments=3)
    add_general_nodes(root, groups, desk["dimensions"], h, margin_x=0.12, margin_y=0.10)
    add_collision_box("COL_Desk_HighEnd_Desktop", (w, d, 0.12), (0, 0, h - 0.06), groups["Collision"], col)
    add_collision_box("COL_Desk_HighEnd_LeftPedestal", (pedestal_w + 0.09, d * 0.91, 0.66), (-xoff, 0, 0.33), groups["Collision"], col)
    add_collision_box("COL_Desk_HighEnd_RightPedestal", (pedestal_w + 0.09, d * 0.91, 0.66), (xoff, 0, 0.33), groups["Collision"], col)
    finalize_motion()
    return col, root, groups


def build_luxury(desk):
    col, root, groups = make_structure(desk)
    w, h, d = desk["dimensions"]
    pedestal_w = 0.475
    xoff, knee, top_drawer_bottom, _ = add_executive_shell(
        desk, groups, col, pedestal_width=pedestal_w, top_thickness=0.092,
        top_layers=2, panel_double=True, plinth_layers=3, fluted=True,
    )
    moving = groups["MovingParts"]
    frame_top = top_drawer_bottom + 0.015
    left_opening = add_pedestal_face_frame(
        "Body_LeftPedestal", -xoff, pedestal_w, d, frame_top,
        groups["Body"], col, MATERIALS["body"], plinth_layers=3, fluted=True,
    )
    right_opening = add_pedestal_face_frame(
        "Body_RightPedestal", xoff, pedestal_w, d, frame_top,
        groups["Body"], col, MATERIALS["body"], plinth_layers=3, fluted=True,
    )
    drawer_z = 0.650

    add_drawer("Drawer_Left_Top", -xoff, drawer_z, pedestal_w - 0.072, 0.118, d, 0.50, 0.39, moving, groups["Hardware"], col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], handle="knob", front_bevel=0.011)
    add_drawer("Drawer_Right_Top", xoff, drawer_z, pedestal_w - 0.072, 0.118, d, 0.50, 0.39, moving, groups["Hardware"], col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], handle="knob", front_bevel=0.011)
    add_cabinet("CabinetDoor_Left", -xoff, left_opening["bottom"], left_opening["width"], left_opening["height"], d, "left", groups["Body"], moving, col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], double_panel=True)
    drawer_gap = 0.012
    usable_height = right_opening["height"] - drawer_gap
    bottom_height = usable_height * 0.52
    middle_height = usable_height - bottom_height
    bottom_z = right_opening["bottom"] + bottom_height / 2
    middle_z = right_opening["top"] - middle_height / 2
    add_drawer("Drawer_Right_Middle", xoff, middle_z, right_opening["width"], middle_height, d, 0.50, 0.39, moving, groups["Hardware"], col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], handle="knob", front_bevel=0.011)
    add_drawer("Drawer_Right_Bottom", xoff, bottom_z, right_opening["width"], bottom_height, d, 0.53, 0.41, moving, groups["Hardware"], col, MATERIALS["body"], MATERIALS["interior"], desk["sound"], handle="knob", front_bevel=0.011)
    split_z = right_opening["bottom"] + bottom_height + drawer_gap / 2
    cube("Body_RightDrawerSeparator", (right_opening["width"] + 0.012, 0.040, 0.015), (xoff, -d / 2 + 0.042, split_z), MATERIALS["shadow"], 0.003, groups["Body"], col, grain="X")

    # Three-piece, nearly flush leather writing field with restrained brass
    # tooling follows the supplied Luxury reference without introducing props.
    leather_parent = groups["Desktop"]
    inset_y = -0.015
    inset_depth = d * 0.60
    panel_gap = 0.018
    total_width = w * 0.76
    side_width = total_width * 0.22
    center_width = total_width - side_width * 2 - panel_gap * 2
    leather_z = h + 0.0018
    panel_specs = (
        ("Left", -total_width / 2 + side_width / 2, side_width),
        ("Center", 0, center_width),
        ("Right", total_width / 2 - side_width / 2, side_width),
    )
    for panel_name, x, width in panel_specs:
        cube(f"Desktop_LeatherInset_{panel_name}", (width, inset_depth, 0.004), (x, inset_y, leather_z), MATERIALS["leather"], 0.006, leather_parent, col, grain="X", segments=3)
        border = 0.008
        border_z = leather_z + 0.003
        cube(f"Desktop_LeatherBorder_{panel_name}_Front", (width, border, 0.004), (x, inset_y - inset_depth / 2, border_z), MATERIALS["brass"], 0.002, leather_parent, col, grain="X")
        cube(f"Desktop_LeatherBorder_{panel_name}_Back", (width, border, 0.004), (x, inset_y + inset_depth / 2, border_z), MATERIALS["brass"], 0.002, leather_parent, col, grain="X")
        cube(f"Desktop_LeatherBorder_{panel_name}_Left", (border, inset_depth, 0.004), (x - width / 2, inset_y, border_z), MATERIALS["brass"], 0.002, leather_parent, col, grain="Y")
        cube(f"Desktop_LeatherBorder_{panel_name}_Right", (border, inset_depth, 0.004), (x + width / 2, inset_y, border_z), MATERIALS["brass"], 0.002, leather_parent, col, grain="Y")

    cube("Body_LuxuryFrontCornice", (w * 0.975, 0.058, 0.042), (0, -d / 2 + 0.060, h - 0.125), MATERIALS["body"], 0.009, groups["Body"], col, grain="X", segments=3)
    cube("Body_LuxuryFrontBead", (w * 0.945, 0.026, 0.022), (0, -d / 2 + 0.025, h - 0.152), MATERIALS["brass"], 0.005, groups["Body"], col, grain="X", segments=3)
    add_general_nodes(root, groups, desk["dimensions"], h + 0.006, margin_x=0.14, margin_y=0.125)
    add_collision_box("COL_Desk_Luxury_Desktop", (w, d, 0.13), (0, 0, h - 0.065), groups["Collision"], col)
    add_collision_box("COL_Desk_Luxury_LeftPedestal", (pedestal_w + 0.10, d * 0.92, 0.68), (-xoff, 0, 0.34), groups["Collision"], col)
    add_collision_box("COL_Desk_Luxury_RightPedestal", (pedestal_w + 0.10, d * 0.92, 0.68), (xoff, 0, 0.34), groups["Collision"], col)
    finalize_motion()
    return col, root, groups


def build_lod(desk, level, root_col):
    """Create an efficient static distance representation; interactions stay on LOD0."""
    w, h, d = desk["dimensions"]
    lod_parent_col = next((child for child in root_col.children if child.name == "LODs"), None)
    if lod_parent_col is None:
        lod_parent_col = collection("LODs", parent=root_col)
    lod_col = collection(f"{desk['asset']}_LOD{level}", parent=lod_parent_col)
    root = empty(f"{desk['asset']}_LOD{level}", col=lod_col, size=0.10)
    root["lod_level"] = level
    root["interactions"] = "LOD0 only"
    top_t = 0.045 if desk["tier_level"] <= 2 else 0.065 if level == 1 else 0.055
    cube(f"LOD{level}_Desktop", (w, d, top_t), (0, 0, h - top_t / 2), MATERIALS["surface"], 0.010 if level == 1 else 0.004, root, lod_col, grain="X", segments=1)

    if desk["key"] == "basic":
        leg_h = h - top_t
        for index, x in enumerate((-w / 2 + 0.06, -w / 2 + 0.46, w / 2 - 0.06), start=1):
            for side, y in enumerate((-d / 2 + 0.06, d / 2 - 0.06), start=1):
                cube(f"LOD{level}_Leg_{index}_{side}", (0.055, 0.055, leg_h), (x, y, leg_h / 2), MATERIALS["body"], 0.004, root, lod_col, grain="Z", segments=1)
        cube(f"LOD{level}_LeftStorage", (0.40, d * 0.76, h * 0.57), (-w / 2 + 0.26, 0, 0.39), MATERIALS["body"], 0.006, root, lod_col, grain="Z", segments=1)
        cube(f"LOD{level}_RightPanel", (0.04, d * 0.78, h * 0.56), (w / 2 - 0.075, 0, 0.39), MATERIALS["body"], 0.004, root, lod_col, grain="Z", segments=1)
    else:
        if desk["key"] == "standard":
            pedestal_w = 0.40
        elif desk["key"] == "premium":
            pedestal_w = 0.445
        elif desk["key"] == "high_end":
            pedestal_w = 0.49
        else:
            pedestal_w = 0.525
        xoff = w / 2 - pedestal_w / 2 - 0.04
        pedestal_h = h - top_t - 0.03
        for side_name, x in (("Left", -xoff), ("Right", xoff)):
            cube(f"LOD{level}_{side_name}Pedestal", (pedestal_w, d * 0.86, pedestal_h), (x, 0, pedestal_h / 2), MATERIALS["body"], 0.010 if level == 1 else 0.005, root, lod_col, grain="Z", segments=1)
            face_y = -d / 2 + 0.02
            if level == 1:
                rows = 3 if desk["key"] in ("standard", "luxury") else 2
                for row in range(rows):
                    face_h = pedestal_h * 0.20
                    face_z = pedestal_h * (0.28 + row * 0.23)
                    cube(f"LOD{level}_{side_name}Face_{row + 1}", (pedestal_w * 0.82, 0.018, face_h), (x, face_y, face_z), MATERIALS["body"], 0.004, root, lod_col, grain="X", segments=1)
                    if desk["tier_level"] >= 3:
                        sphere(f"LOD{level}_{side_name}Knob_{row + 1}", 0.010, (x, face_y - 0.018, face_z), MATERIALS["brass"], root, lod_col, segments=12)
        knee = w - pedestal_w * 2 - 0.10
        cube(f"LOD{level}_Modesty", (knee, 0.035, h * 0.44), (0, d / 2 - 0.055, h * 0.35), MATERIALS["body"], 0.005, root, lod_col, grain="X", segments=1)
        if desk["tier_level"] >= 3:
            cube(f"LOD{level}_PlinthLeft", (pedestal_w * 1.04, d * 0.91, 0.075), (-xoff, 0, 0.0375), MATERIALS["body"], 0.007, root, lod_col, grain="X", segments=1)
            cube(f"LOD{level}_PlinthRight", (pedestal_w * 1.04, d * 0.91, 0.075), (xoff, 0, 0.0375), MATERIALS["body"], 0.007, root, lod_col, grain="X", segments=1)

    if desk["key"] == "luxury":
        cube(f"LOD{level}_Leather", (w * 0.76, d * 0.60, 0.004), (0, -0.015, h + 0.001), MATERIALS["leather"], 0.004, root, lod_col, grain="X", segments=1)
    for obj in all_descendants(root):
        obj.hide_render = True
        obj.hide_viewport = True
    return root


def triangle_count(root, include_collision=False):
    total = 0
    for obj in all_descendants(root):
        if obj.type != "MESH":
            continue
        if not include_collision and (obj.name.startswith("COL_") or obj.get("collision_proxy")):
            continue
        mesh = obj.data
        mesh.calc_loop_triangles()
        total += len(mesh.loop_triangles)
    return total


def mesh_count(root, include_collision=False):
    return sum(
        1 for obj in all_descendants(root)
        if obj.type == "MESH" and (include_collision or not (obj.name.startswith("COL_") or obj.get("collision_proxy")))
    )


def _batch_token(value):
    return "".join(character if character.isalnum() else "_" for character in value).strip("_")


def batch_render_meshes(root, moving_parts=()):
    """Reduce runtime draw calls without flattening functional empty hierarchies.

    Static meshes are batched per authored top-level group and material.  Meshes
    belonging to a drawer or cabinet door are batched separately per component
    and material, then parented back to that component's animation target.  The
    metadata roots, interaction/storage empties, named pivots, and the simplified
    collision objects therefore remain untouched.
    """
    moving_set = set(moving_parts)
    batches = {}

    for obj in all_descendants(root):
        if obj.type != "MESH" or obj.name.startswith("COL_") or obj.get("collision_proxy"):
            continue
        material = next((slot for slot in obj.data.materials if slot is not None), None)
        if material is None:
            continue

        component = None
        current = obj.parent
        while current is not None and current is not root:
            if current in moving_set:
                component = current
                break
            current = current.parent

        if component is not None:
            target_name = component.get("animationTarget")
            target_parent = bpy.data.objects.get(target_name) if target_name else component
            group_name = component.name
            group_key = ("moving", component.name, material.name)
        else:
            top_group = obj
            while top_group.parent is not None and top_group.parent is not root:
                top_group = top_group.parent
            target_parent = root if top_group is obj else top_group
            group_name = target_parent.name
            group_key = ("static", group_name, material.name)

        batches.setdefault(group_key, {
            "objects": [],
            "parent": target_parent,
            "component": component,
            "name": f"BATCH_{_batch_token(group_name)}_{_batch_token(material.name)}",
        })["objects"].append(obj)

    for batch in batches.values():
        objects = batch["objects"]
        parent = batch["parent"]
        for obj in objects:
            if obj.parent is not parent:
                set_parent_keep_world(obj, parent)
        if len(objects) > 1:
            bpy.ops.object.select_all(action="DESELECT")
            for obj in objects:
                obj.hide_set(False)
                obj.hide_viewport = False
                obj.select_set(True)
            active = sorted(objects, key=lambda item: item.name)[0]
            bpy.context.view_layer.objects.active = active
            bpy.ops.object.join()
        else:
            active = objects[0]
        active.name = batch["name"]
        active.data.name = f"{batch['name']}_Mesh"
        if batch["component"] is not None:
            active["moving_component"] = batch["component"].name

    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.update()
    return len(batches)


def select_hierarchy(root):
    bpy.ops.object.select_all(action="DESELECT")
    selected = all_descendants(root)
    for obj in selected:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    return selected


def export_glb(root, path, animations=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    selected = select_hierarchy(root)
    kwargs = {
        "filepath": str(path),
        "export_format": "GLB",
        "use_selection": True,
        "export_yup": True,
        "export_extras": True,
        "export_cameras": False,
        "export_lights": False,
        "export_animations": animations,
        "export_optimize_animation_size": False,
    }
    if animations:
        kwargs.update({
            "export_animation_mode": "NLA_TRACKS",
            "export_nla_strips": True,
            "export_force_sampling": True,
        })
    bpy.ops.export_scene.gltf(**kwargs)
    if root.name.endswith("_LOD1") or root.name.endswith("_LOD2"):
        for obj in selected:
            obj.hide_viewport = True
            obj.hide_render = True
    log(f"exported {path.relative_to(REPO)}")


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_studio(desk, comparison=False):
    w, h, d = desk["dimensions"] if desk else (9.5, 0.81, 1.0)
    floor_size = 13.0 if comparison else max(5.0, w * 3.6)
    floor_mat = solid_material("PREVIEW_NeutralFloor", (0.19, 0.205, 0.20), 0.78)
    floor = cube("PREVIEW_Floor", (floor_size, floor_size, 0.018), (0, 0.32 if comparison else 0, -0.012), floor_mat, 0.0)

    if comparison:
        camera_location = (0.7, -16.5, 4.85)
        target = (0, 0, 0.40)
        lens = 58
    else:
        camera_location = (w * 1.10 + 0.55, -d * 2.60 - 1.25, h * 1.40 + 0.58)
        target = (0, 0.015, h * 0.43)
        lens = 58
    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.object
    camera.name = "PREVIEW_Camera"
    camera.data.lens = lens
    look_at(camera, target)
    bpy.context.scene.camera = camera

    lights = (
        ("PREVIEW_Key", 1050 if not comparison else 1650, 4.5 if not comparison else 7.0, (-3.4, -4.5, 5.6)),
        ("PREVIEW_Fill", 760 if not comparison else 1200, 4.0 if not comparison else 6.0, (5.0, -1.2, 3.7)),
        ("PREVIEW_Rim", 900 if not comparison else 1400, 4.0 if not comparison else 6.0, (1.2, 5.1, 5.2)),
        ("PREVIEW_FrontSoft", 1800 if not comparison else 2800, 3.4 if not comparison else 6.5, (0.0, -5.2 if not comparison else -8.0, 1.9 if not comparison else 3.0)),
    )
    for name, energy, size, location in lights:
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size
        look_at(light, target)
    bpy.context.scene.world.color = (0.045, 0.052, 0.050)
    return camera


def mute_motion(muted):
    for component in MOVING_PARTS:
        target_name = component.get("animationTarget")
        target = bpy.data.objects.get(target_name) if target_name else component
        if target.animation_data:
            for track in target.animation_data.nla_tracks:
                track.mute = muted


def set_component_state(component, opened):
    if component["interactionType"] == "drawer":
        component.location = Vector(component["openLocation"] if opened else component["closedLocation"])
    else:
        component.rotation_euler = Vector(component["openRotation"] if opened else component["closedRotation"])


def render_previews(desk, root):
    for obj in all_descendants(root):
        if obj.name.startswith("COL_") or obj.get("collision_proxy"):
            obj.hide_render = True
        else:
            obj.hide_render = False
    add_studio(desk)
    scene = bpy.context.scene
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.frame_set(1)
    canonical = PREVIEW_ROOT / f"desk_{desk['key']}_preview.png"
    scene.render.filepath = str(canonical)
    bpy.ops.render.render(write_still=True)

    mute_motion(True)
    for component in MOVING_PARTS:
        set_component_state(component, False)
    drawers = [part for part in MOVING_PARTS if part["interactionType"] == "drawer"]
    doors = [part for part in MOVING_PARTS if part["interactionType"] == "cabinet-door"]
    if drawers:
        set_component_state(drawers[0], True)
    if doors:
        set_component_state(doors[0], True)
    elif len(drawers) > 1:
        set_component_state(drawers[-1], True)
    functional = PREVIEW_ROOT / f"desk_{desk['key']}_functional.png"
    scene.render.filepath = str(functional)
    bpy.ops.render.render(write_still=True)
    for component in MOVING_PARTS:
        set_component_state(component, False)
    mute_motion(False)
    scene.frame_set(1)

    runtime_preview = PREVIEW_ROOT / f"{desk['runtime']}.png"
    shutil.copy2(canonical, runtime_preview)
    return canonical, functional


def _non_manifold_edges(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    count = sum(1 for edge in bm.edges if not edge.is_manifold)
    bm.free()
    return count


def visible_meshes(root):
    return [
        obj for obj in all_descendants(root)
        if obj.type == "MESH" and not obj.name.startswith("COL_") and not obj.get("collision_proxy")
    ]


def bounds_for(root):
    points = []
    bpy.context.view_layer.update()
    for obj in visible_meshes(root):
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    mins = [min(point[index] for point in points) for index in range(3)]
    maxs = [max(point[index] for point in points) for index in range(3)]
    return {
        "min": [round(value, 5) for value in mins],
        "max": [round(value, 5) for value in maxs],
        "dimensions": [round(maxs[index] - mins[index], 5) for index in range(3)],
    }


def validate_source(desk, root, lod1, lod2, source_path):
    objects = all_descendants(root)
    meshes = [obj for obj in objects if obj.type == "MESH"]
    render_meshes = visible_meshes(root)
    collisions = [obj for obj in meshes if obj.name.startswith("COL_") or obj.get("collision_proxy")]
    node_names = {obj.name for obj in objects if obj.type == "EMPTY"}
    required_nodes = {
        "INTERACTION_POINT", "PLACEMENT_FOOTPRINT", "CHAIR_ANCHOR",
        "PACK_ANCHOR", "DESK_SURFACE_CENTER", "DESK_SURFACE_MIN", "DESK_SURFACE_MAX",
    }
    generic = [obj.name for obj in objects if obj.name.startswith(("Cube", "Cylinder", "Sphere", "Empty", "Material."))]
    unapplied = [
        obj.name for obj in meshes
        if any(abs(value - 1.0) > 0.001 for value in obj.scale)
        or any(abs(value) > 0.001 for value in obj.rotation_euler)
    ]
    missing_uv = [obj.name for obj in render_meshes if len(obj.data.uv_layers) == 0]
    missing_material = [obj.name for obj in render_meshes if not obj.data.materials]
    non_manifold = {obj.name: _non_manifold_edges(obj) for obj in render_meshes}
    non_manifold = {name: count for name, count in non_manifold.items() if count}
    component_records = []
    for component in MOVING_PARTS:
        interact_name = f"INTERACT_{component.name}"
        storage_prefix = f"STORAGE_ZONE_{component.name}" if component["interactionType"] == "drawer" else "STORAGE_ZONE_"
        descendants = all_descendants(component)
        component_records.append({
            "name": component.name,
            "type": component["interactionType"],
            "interactNode": interact_name in {obj.name for obj in descendants},
            "storageNode": any(obj.name.startswith(storage_prefix) for obj in descendants) if component["interactionType"] == "drawer" else True,
            "openDistanceM": component.get("openDistance"),
            "openAngleDeg": component.get("openAngle"),
            "origin": [round(value, 4) for value in component.location],
        })
    expected_actions = {f"{motion}_{part.name}" for part in MOVING_PARTS for motion in ("Open", "Close")}
    action_names = {action.name for action in bpy.data.actions}
    bounds = bounds_for(root)
    expected_w, expected_h, expected_d = desk["dimensions"]
    issues = []
    if root.location.length > 0.001:
        issues.append("root origin is not centered at floor datum")
    if abs(bounds["min"][2]) > 0.012:
        issues.append(f"visible floor contact is {bounds['min'][2]:.4f}m")
    if abs(bounds["dimensions"][0] - expected_w) > 0.055:
        issues.append(f"width {bounds['dimensions'][0]} differs from target {expected_w}")
    if abs(bounds["dimensions"][1] - expected_d) > 0.055:
        issues.append(f"depth {bounds['dimensions'][1]} differs from target {expected_d}")
    if abs(bounds["dimensions"][2] - expected_h) > 0.025:
        issues.append(f"height {bounds['dimensions'][2]} differs from target {expected_h}")
    if generic:
        issues.append(f"generic names: {generic[:5]}")
    if unapplied:
        issues.append(f"unapplied mesh transforms: {unapplied[:5]}")
    if missing_uv:
        issues.append(f"meshes without UVs: {missing_uv[:5]}")
    if missing_material:
        issues.append(f"meshes without materials: {missing_material[:5]}")
    if non_manifold:
        issues.append(f"non-manifold meshes: {list(non_manifold.items())[:5]}")
    if not required_nodes.issubset(node_names):
        issues.append(f"missing general nodes: {sorted(required_nodes - node_names)}")
    positioned_nodes = required_nodes - {"PLACEMENT_FOOTPRINT"}
    zeroed_nodes = [
        name for name in positioned_nodes
        if (bpy.data.objects.get(name) is None or bpy.data.objects[name].matrix_world.translation.length < 0.05)
    ]
    if zeroed_nodes:
        issues.append(f"general nodes lost authored positions: {sorted(zeroed_nodes)}")
    if len(collisions) < 3:
        issues.append(f"only {len(collisions)} collision proxies")
    missing_actions = expected_actions - action_names
    if missing_actions:
        issues.append(f"missing actions: {sorted(missing_actions)[:5]}")
    for component in component_records:
        if not component["interactNode"] or not component["storageNode"]:
            issues.append(f"incomplete component nodes: {component['name']}")
        if Vector(component["origin"]).length < 0.05:
            issues.append(f"component pivot collapsed to origin: {component['name']}")
    return {
        "source": source_path.relative_to(REPO).as_posix(),
        "boundsM": bounds,
        "visibleMeshes": len(render_meshes),
        "collisionMeshes": len(collisions),
        "materials": sorted({mat.name for obj in render_meshes for mat in obj.data.materials if mat}),
        "components": component_records,
        "animationClips": sorted(expected_actions),
        "interactionNodes": sorted(name for name in node_names if name.startswith("INTERACT_") or name in required_nodes or name == "PACK_ANCHOR"),
        "storageNodes": sorted(name for name in node_names if name.startswith("STORAGE_ZONE_")),
        "triangles": {"LOD0": triangle_count(root), "LOD1": triangle_count(lod1), "LOD2": triangle_count(lod2)},
        "issues": issues,
    }


def validate_reimport(desk, glb_path, expected_actions, expected_components):
    factory_scene()
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    root = bpy.data.objects.get(desk["asset"])
    issues = []
    if root is None:
        issues.append(f"missing root {desk['asset']}")
        objects = list(bpy.context.scene.objects)
    else:
        objects = all_descendants(root)
    names = {obj.name for obj in objects}
    required_nodes = {
        "INTERACTION_POINT", "PLACEMENT_FOOTPRINT", "CHAIR_ANCHOR",
        "PACK_ANCHOR", "DESK_SURFACE_CENTER", "DESK_SURFACE_MIN", "DESK_SURFACE_MAX",
    }
    missing_nodes = required_nodes - names
    if missing_nodes:
        issues.append(f"missing re-imported nodes: {sorted(missing_nodes)}")
    positioned_nodes = required_nodes - {"PLACEMENT_FOOTPRINT"}
    zeroed_nodes = [
        name for name in positioned_nodes
        if name in names and bpy.data.objects[name].matrix_world.translation.length < 0.05
    ]
    if zeroed_nodes:
        issues.append(f"re-imported nodes lost authored positions: {sorted(zeroed_nodes)}")
    component_names = set(expected_components)
    missing_components = component_names - names
    if missing_components:
        issues.append(f"missing re-imported components: {sorted(missing_components)}")
    zeroed_components = [
        name for name in component_names
        if name in names and bpy.data.objects[name].matrix_world.translation.length < 0.05
    ]
    if zeroed_components:
        issues.append(f"re-imported component pivots collapsed: {sorted(zeroed_components)}")
    colliders = [obj for obj in objects if obj.type == "MESH" and obj.name.startswith("COL_")]
    if len(colliders) < 3:
        issues.append(f"only {len(colliders)} re-imported collision meshes")
    action_names = {action.name for action in bpy.data.actions}
    exported_actions = sorted(name for name in expected_actions if name in action_names)
    missing_actions = set(expected_actions) - action_names
    if missing_actions:
        issues.append(f"missing re-imported actions: {sorted(missing_actions)[:6]}")
    meshes = [obj for obj in objects if obj.type == "MESH"]
    unapplied = [obj.name for obj in meshes if any(abs(value - 1.0) > 0.001 for value in obj.scale)]
    if unapplied:
        issues.append(f"re-imported mesh scales not applied: {unapplied[:5]}")
    materials = {mat.name for obj in meshes for mat in obj.data.materials if mat}
    if len(materials) < 3:
        issues.append(f"only {len(materials)} re-imported materials")
    image_materials = 0
    for mat_name in materials:
        mat = bpy.data.materials.get(mat_name)
        if mat and mat.use_nodes and any(node.type == "TEX_IMAGE" for node in mat.node_tree.nodes):
            image_materials += 1
    if image_materials < 2:
        issues.append(f"only {image_materials} texture-backed materials survived")
    metadata_components = [
        obj.name for obj in objects
        if obj.type == "EMPTY" and obj.get("interactionType") in {"drawer", "cabinet-door"}
    ]
    if len(metadata_components) < len(component_names):
        issues.append(f"component metadata survived on {len(metadata_components)}/{len(component_names)} nodes")
    return {
        "glb": glb_path.relative_to(REPO).as_posix(),
        "objects": len(objects),
        "meshes": len(meshes),
        "materials": sorted(materials),
        "textureBackedMaterials": image_materials,
        "collisionMeshes": len(colliders),
        "animationClips": exported_actions,
        "componentMetadataNodes": sorted(metadata_components),
        "issues": issues,
    }


def build_one(desk):
    factory_scene()
    build_materials(desk)
    builder = globals()[desk["builder"]]
    root_col, root, groups = builder(desk)
    lod1 = build_lod(desk, 1, root_col)
    lod2 = build_lod(desk, 2, root_col)
    batch_render_meshes(root, MOVING_PARTS)
    batch_render_meshes(lod1)
    batch_render_meshes(lod2)
    source_path = SOURCE_ROOT / f"desk_{desk['key']}.blend"
    bpy.context.scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path), check_existing=False)

    source_validation = validate_source(desk, root, lod1, lod2, source_path)
    canonical_glb = EXPORT_ROOT / f"desk_{desk['key']}.glb"
    lod1_path = EXPORT_ROOT / f"desk_{desk['key']}_lod1.glb"
    lod2_path = EXPORT_ROOT / f"desk_{desk['key']}_lod2.glb"
    export_glb(root, canonical_glb, animations=True)
    export_glb(lod1, lod1_path, animations=False)
    export_glb(lod2, lod2_path, animations=False)
    runtime_glb = RUNTIME_ROOT / f"{desk['runtime']}.glb"
    runtime_lod1 = RUNTIME_ROOT / f"{desk['runtime']}_lod1.glb"
    runtime_lod2 = RUNTIME_ROOT / f"{desk['runtime']}_lod2.glb"
    shutil.copy2(canonical_glb, runtime_glb)
    shutil.copy2(lod1_path, runtime_lod1)
    shutil.copy2(lod2_path, runtime_lod2)
    preview, functional_preview = render_previews(desk, root)
    reimport = validate_reimport(
        desk, canonical_glb, source_validation["animationClips"],
        [part["name"] for part in source_validation["components"]],
    )
    issues = [*source_validation["issues"], *reimport["issues"]]
    record = {
        "key": desk["key"],
        "runtimeTierId": desk["runtime"],
        "asset": desk["asset"],
        "label": desk["label"],
        "tierLevel": desk["tier_level"],
        "targetDimensionsM": list(desk["dimensions"]),
        "source": source_path.relative_to(REPO).as_posix(),
        "glb": canonical_glb.relative_to(REPO).as_posix(),
        "runtimeGlb": runtime_glb.relative_to(REPO).as_posix(),
        "runtimeLods": {
            "LOD1": runtime_lod1.relative_to(REPO).as_posix(),
            "LOD2": runtime_lod2.relative_to(REPO).as_posix(),
        },
        "lods": {
            "LOD0": canonical_glb.relative_to(REPO).as_posix(),
            "LOD1": lod1_path.relative_to(REPO).as_posix(),
            "LOD2": lod2_path.relative_to(REPO).as_posix(),
        },
        "preview": preview.relative_to(REPO).as_posix(),
        "functionalPreview": functional_preview.relative_to(REPO).as_posix(),
        "sourceValidation": source_validation,
        "reimportValidation": reimport,
        "issues": issues,
    }
    log(f"{desk['asset']}: {source_validation['triangles']} / issues={len(issues)}")
    return record


def build_comparison(records):
    factory_scene()
    roots = []
    total_width = sum(desk["dimensions"][0] for desk in DESKS) + 0.30 * (len(DESKS) - 1)
    cursor = -total_width / 2
    for desk, record in zip(DESKS, records):
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(REPO / record["glb"]))
        new_objects = set(bpy.context.scene.objects) - before
        root = next((obj for obj in new_objects if obj.name == desk["asset"]), None)
        if root is None:
            tops = [obj for obj in new_objects if obj.parent is None]
            root = tops[0] if tops else None
        if root is None:
            raise RuntimeError(f"comparison import missing root for {desk['asset']}")
        width = desk["dimensions"][0]
        root.location.x += cursor + width / 2
        cursor += width + 0.30
        roots.append(root)
        for obj in new_objects:
            if obj.name.startswith("COL_") or obj.get("collision_proxy"):
                obj.hide_render = True
    add_studio(None, comparison=True)
    scene = bpy.context.scene
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 820
    comparison_path = PREVIEW_ROOT / "desk_progression.png"
    scene.render.filepath = str(comparison_path)
    bpy.ops.render.render(write_still=True)
    source_path = SOURCE_ROOT / "desk_progression.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path), check_existing=False)
    legacy_source = ASSET_ROOT / "source" / "office-desks.blend"
    shutil.copy2(source_path, legacy_source)
    return {
        "source": source_path.relative_to(REPO).as_posix(),
        "legacySource": legacy_source.relative_to(REPO).as_posix(),
        "preview": comparison_path.relative_to(REPO).as_posix(),
        "assets": [root.name for root in roots],
    }


def update_manifest(records):
    manifest = json.loads(MANIFEST_PATH.read_text("utf-8")) if MANIFEST_PATH.exists() else {}
    for desk, record in zip(DESKS, records):
        source = record["sourceValidation"]
        components = source["components"]
        manifest[f"office-desks:{desk['runtime']}"] = {
            "category": "office-desks",
            "label": "Office Desk",
            "assetName": desk["asset"],
            "referenceTier": desk["label"],
            "tier": desk["runtime"],
            "tierLabel": desk["label"],
            "tierLevel": desk["tier_level"],
            "dimensionsM": list(desk["dimensions"]),
            "meshCount": source["visibleMeshes"],
            "triangleCount": source["triangles"]["LOD0"],
            "lodTriangleCounts": source["triangles"],
            "glb": record["runtimeGlb"],
            "canonicalGlb": record["glb"],
            "lods": record["lods"],
            "runtimeLods": record["runtimeLods"],
            "preview": f"Assets/pro_shop_furniture/previews/office-desks/{desk['runtime']}.png",
            "canonicalPreview": record["preview"],
            "functionalPreview": record["functionalPreview"],
            "source": record["source"],
            "functionalDrawers": sum(1 for part in components if part["type"] == "drawer"),
            "functionalCabinetDoors": sum(1 for part in components if part["type"] == "cabinet-door"),
            "animationClips": source["animationClips"],
            "interactionNodes": source["interactionNodes"],
            "storageNodes": source["storageNodes"],
            "collisionMeshes": source["collisionMeshes"],
            "validationReport": REPORT_PATH.relative_to(REPO).as_posix(),
            "license": "Original Golf Flipper project asset; no external source",
        }
    MANIFEST_PATH.write_text(json.dumps(dict(sorted(manifest.items())), indent=2) + "\n", "utf-8")


def write_markdown(report):
    lines = [
        "# Desk Blender validation",
        "",
        f"Blender: {report['blenderVersion']}",
        "",
        "All geometry, materials, and texture maps are original project-owned work generated by the repository build.",
        "",
        "| Asset | Dimensions (m) | LOD0 tris | LOD1 tris | LOD2 tris | Drawers | Doors | Result |",
        "|---|---:|---:|---:|---:|---:|---:|---|",
    ]
    for record in report["assets"]:
        source = record["sourceValidation"]
        tris = source["triangles"]
        components = source["components"]
        dimensions = " × ".join(f"{value:.2f}" for value in record["targetDimensionsM"])
        lines.append(
            f"| {record['asset']} | {dimensions} | {tris['LOD0']:,} | {tris['LOD1']:,} | {tris['LOD2']:,} | "
            f"{sum(1 for part in components if part['type'] == 'drawer')} | "
            f"{sum(1 for part in components if part['type'] == 'cabinet-door')} | "
            f"{'PASS' if not record['issues'] else 'FAIL'} |"
        )
    lines.extend([
        "",
        "Validation covers applied mesh transforms, UVs, material assignment, manifold geometry, named hierarchy, floor contact, target bounds, collision proxies, interaction/storage nodes, authored open/close clips, GLB export, and fresh-scene GLB re-import.",
        "",
        "LOD1 and LOD2 are static distance assets; functional drawers and doors intentionally remain on LOD0, matching the current runtime's interactive-furniture capability.",
        "",
        f"Overall: {'PASS' if report['passed'] else 'FAIL'}",
        "",
    ])
    (QA_ROOT / "blender-validation.md").write_text("\n".join(lines), "utf-8")


def main():
    ensure_dirs()
    records = []
    for desk in DESKS:
        log(f"building {desk['asset']}")
        records.append(build_one(desk))
    comparison = build_comparison(records)
    update_manifest(records)
    failed = [record for record in records if record["issues"]]
    report = {
        "blenderVersion": bpy.app.version_string,
        "assetCount": len(records),
        "passed": not failed,
        "failedAssets": [record["asset"] for record in failed],
        "sourceAndLicense": "Original Golf Flipper project-owned Blender geometry and generated PBR maps; no external assets",
        "runtimeTierCompatibility": {
            "basic": "Desk_Basic", "standard": "Desk_Standard", "premium": "Desk_Premium",
            "luxury": "Desk_HighEnd", "executive": "Desk_Luxury",
        },
        "comparison": comparison,
        "assets": records,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", "utf-8")
    write_markdown(report)
    log(json.dumps({"passed": report["passed"], "report": str(REPORT_PATH), "assets": len(records)}))
    if failed:
        raise RuntimeError(f"desk validation failed for: {', '.join(record['asset'] for record in failed)}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
