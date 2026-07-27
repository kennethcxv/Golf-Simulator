"""Build the five reference-matched Golf Flipper retail shelf upgrades.

Blender 5.1 background usage:
  blender --background --python tools/blender/build_retail_shelves.py

The build is original project work and uses only procedural geometry/textures.
Reference PNGs under Designs/Shelves are never modified or packed into outputs.
"""

from __future__ import annotations

from array import array
import json
import math
import os
from pathlib import Path
import random

import bpy
from mathutils import Vector


REPO = Path(os.environ.get("GF_REPO_ROOT", Path(__file__).resolve().parents[2])).resolve()
ASSET_ROOT = REPO / "Assets" / "pro_shop_furniture"
SOURCE_ROOT = ASSET_ROOT / "source" / "retail-shelving"
PREVIEW_ROOT = ASSET_ROOT / "previews" / "retail-shelving"
TEXTURE_ROOT = ASSET_ROOT / "textures" / "retail-shelving"
RUNTIME_ROOT = REPO / "vendor" / "models" / "pro_shop_furniture" / "retail-shelving"
QA_ROOT = REPO / "qa" / "retail_shelves" / "blender"
MANIFEST_PATH = ASSET_ROOT / "retail-shelving-manifest.json"

CONFIGS = [
    {
        "id": "basic", "name": "Shelf_Basic", "label": "Basic Shelf",
        "dimensions": (1.15, 0.47, 1.42), "zones": 3, "doors": 0,
        "storage_zones": 0, "light_nodes": 0, "price": 520,
        "reference": "Designs/Shelves/Basic.png",
    },
    {
        "id": "standard", "name": "Shelf_Standard", "label": "Standard Shelf",
        "dimensions": (1.28, 0.48, 1.55), "zones": 3, "doors": 0,
        "storage_zones": 0, "light_nodes": 0, "price": 940,
        "reference": "Designs/Shelves/Standard.png",
    },
    {
        "id": "premium", "name": "Shelf_Premium", "label": "Premium Shelf",
        "dimensions": (1.50, 0.52, 1.45), "zones": 3, "doors": 0,
        "storage_zones": 0, "light_nodes": 0, "price": 1760,
        "reference": "Designs/Shelves/Premium.png",
    },
    {
        "id": "high-end", "name": "Shelf_HighEnd", "label": "High-End Display Wall",
        # dimensions describe the true placement envelope, including projecting
        # knobs; carcass_depth keeps the cabinet itself inside that envelope.
        "dimensions": (3.10, 0.60, 2.40), "carcass_depth": 0.545, "zones": 15, "doors": 6,
        "storage_zones": 6, "light_nodes": 3, "price": 6400,
        "reference": "Designs/Shelves/High-End.png",
    },
    {
        "id": "luxury", "name": "Shelf_Luxury", "label": "Luxury Display Wall",
        "dimensions": (3.75, 0.65, 2.55), "carcass_depth": 0.585, "zones": 15, "doors": 6,
        "storage_zones": 6, "light_nodes": 15, "price": 11800,
        "reference": "Designs/Shelves/Luxury.png",
    },
]

CURRENT_LOD = 0
MATERIALS = {}


def ensure_directories():
    for path in (SOURCE_ROOT, PREVIEW_ROOT, TEXTURE_ROOT, RUNTIME_ROOT, QA_ROOT):
        path.mkdir(parents=True, exist_ok=True)


def clean_scene(remove_images=False):
    global TEST_MATERIALS
    TEST_MATERIALS = None
    # Operator deletion skips viewport-hidden LOD roots.  Removing every object
    # datablock explicitly guarantees that later tier builds retain canonical
    # names (LOD0/LOD1/LOD2) instead of silently gaining .001 suffixes.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for blocks in (
        bpy.data.meshes, bpy.data.curves, bpy.data.materials,
        bpy.data.cameras, bpy.data.lights,
    ):
        for block in list(blocks):
            if block.users == 0:
                blocks.remove(block)
    if remove_images:
        for image in list(bpy.data.images):
            if image.users == 0:
                bpy.data.images.remove(image)


def clamp(value, lo=0.0, hi=1.0):
    return max(lo, min(hi, value))


def hash_noise(x, y, seed):
    value = math.sin((x * 127.1 + y * 311.7 + seed * 73.17)) * 43758.5453
    return value - math.floor(value)


def texture_pixels(prefix, base_color, roughness, *, wood=False, vertical=False, res=512):
    base = array("f")
    rough = array("f")
    normal = array("f")
    height = array("f", [0.0]) * (res * res)
    seed = sum(ord(char) for char in prefix) * 0.013
    for py in range(res):
        v = py / max(1, res - 1)
        for px in range(res):
            u = px / max(1, res - 1)
            along = v if vertical else u
            across = u if vertical else v
            noise = hash_noise(px, py, seed)
            if wood:
                # Grain lines run along ``along`` and vary across the board.
                # A small longitudinal wobble keeps them organic without the
                # oversized zebra-wave pattern common to procedural wood.
                waviness = 0.012 * math.sin(along * math.tau * 1.7 + seed)
                grain = (
                    0.46 * math.sin((across + waviness) * math.tau * 24.0)
                    + 0.20 * math.sin((across + waviness * 0.45) * math.tau * 57.0 + along * 1.1)
                    + 0.08 * math.sin(across * math.tau * 103.0 + along * 4.0)
                )
                knot_x = (along - 0.37) / 0.18
                knot_y = (across - 0.62) / 0.10
                knot = math.exp(-(knot_x * knot_x + knot_y * knot_y))
                grain += knot * math.sin(math.sqrt(knot_x * knot_x + knot_y * knot_y) * 16.0) * 0.16
                variation = grain * 0.045 + (noise - 0.5) * 0.018
                h = clamp(0.5 + grain * 0.040 + (noise - 0.5) * 0.012)
                rgh = clamp(roughness + (0.5 - h) * 0.10 + (noise - 0.5) * 0.020, 0.2, 0.85)
            else:
                broad = math.sin(u * math.tau * 3.0 + math.sin(v * math.tau * 2.0)) * 0.018
                variation = broad + (noise - 0.5) * 0.025
                h = clamp(0.5 + broad * 2.0 + (noise - 0.5) * 0.05)
                rgh = clamp(roughness + (noise - 0.5) * 0.05, 0.25, 0.95)
            height[py * res + px] = h
            color = tuple(clamp(channel * (1.0 + variation)) for channel in base_color)
            base.extend((*color, 1.0))
            rough.extend((rgh, rgh, rgh, 1.0))

    strength = 2.4 if wood else 0.8
    for py in range(res):
        for px in range(res):
            left = height[py * res + ((px - 1) % res)]
            right = height[py * res + ((px + 1) % res)]
            down = height[((py - 1) % res) * res + px]
            up = height[((py + 1) % res) * res + px]
            nx = (left - right) * strength
            ny = (down - up) * strength
            nz = 1.0
            length = math.sqrt(nx * nx + ny * ny + nz * nz)
            normal.extend((nx / length * 0.5 + 0.5, ny / length * 0.5 + 0.5, nz / length * 0.5 + 0.5, 1.0))
    return base, rough, normal, res


def save_image(path, pixels, resolution, colorspace):
    image = bpy.data.images.new(path.stem, width=resolution, height=resolution, alpha=True)
    image.colorspace_settings.name = colorspace
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.update()
    image.save()
    bpy.data.images.remove(image)


def ensure_texture_set(prefix, base_color, roughness, *, wood=False, vertical=False):
    paths = {
        "base": TEXTURE_ROOT / f"{prefix}_basecolor.png",
        "rough": TEXTURE_ROOT / f"{prefix}_roughness.png",
        "normal": TEXTURE_ROOT / f"{prefix}_normal.png",
    }
    if all(path.exists() for path in paths.values()) and os.environ.get("GF_REBUILD_SHELF_TEXTURES") != "1":
        return paths
    base, rough, normal, res = texture_pixels(
        prefix, base_color, roughness, wood=wood, vertical=vertical,
    )
    save_image(paths["base"], base, res, "sRGB")
    save_image(paths["rough"], rough, res, "Non-Color")
    save_image(paths["normal"], normal, res, "Non-Color")
    return paths


def build_texture_library():
    ensure_directories()
    definitions = [
        ("utility_metal", (0.22, 0.23, 0.23), 0.48, False, False),
        ("charcoal_metal", (0.075, 0.080, 0.078), 0.35, False, False),
        ("standard_composite", (0.52, 0.43, 0.30), 0.64, False, False),
        ("premium_walnut_horizontal", (0.24, 0.12, 0.055), 0.46, True, False),
        ("premium_walnut_vertical", (0.24, 0.12, 0.055), 0.46, True, True),
        ("highend_walnut_horizontal", (0.18, 0.075, 0.028), 0.42, True, False),
        ("highend_walnut_vertical", (0.18, 0.075, 0.028), 0.42, True, True),
        ("luxury_mahogany_horizontal", (0.105, 0.033, 0.015), 0.36, True, False),
        ("luxury_mahogany_vertical", (0.105, 0.033, 0.015), 0.36, True, True),
    ]
    for prefix, color, roughness, wood, vertical in definitions:
        ensure_texture_set(prefix, color, roughness, wood=wood, vertical=vertical)


def load_image(path, colorspace):
    image = bpy.data.images.load(str(path), check_existing=True)
    image.colorspace_settings.name = colorspace
    image.pack()
    return image


def textured_material(name, prefix, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    base_node = nodes.new("ShaderNodeTexImage")
    rough_node = nodes.new("ShaderNodeTexImage")
    normal_node = nodes.new("ShaderNodeTexImage")
    normal_map = nodes.new("ShaderNodeNormalMap")
    base_node.image = load_image(TEXTURE_ROOT / f"{prefix}_basecolor.png", "sRGB")
    rough_node.image = load_image(TEXTURE_ROOT / f"{prefix}_roughness.png", "Non-Color")
    normal_node.image = load_image(TEXTURE_ROOT / f"{prefix}_normal.png", "Non-Color")
    shader.inputs["Metallic"].default_value = metallic
    normal_map.inputs["Strength"].default_value = 0.10 if "wood" in prefix or "walnut" in prefix or "mahogany" in prefix else 0.14
    links.new(base_node.outputs["Color"], shader.inputs["Base Color"])
    links.new(rough_node.outputs["Color"], shader.inputs["Roughness"])
    links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return mat


def solid_material(name, color, roughness, metallic=0.0, emission=None, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, alpha)
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Alpha"].default_value = alpha
    if emission:
        emission_color = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
        emission_strength = shader.inputs.get("Emission Strength")
        if emission_color:
            emission_color.default_value = (*emission, 1.0)
        if emission_strength:
            emission_strength.default_value = 1.8
    if alpha < 1.0:
        mat.surface_render_method = "DITHERED"
    return mat


def create_material_library():
    global MATERIALS
    MATERIALS = {
        "utility": textured_material("GF_Shelf_UtilityMetal", "utility_metal", 0.72),
        "charcoal": textured_material("GF_Shelf_CharcoalSteel", "charcoal_metal", 0.68),
        "composite": textured_material("GF_Shelf_CommercialComposite", "standard_composite", 0.0),
        "premium_h": textured_material("GF_Shelf_PremiumWalnut_Horizontal", "premium_walnut_horizontal"),
        "premium_v": textured_material("GF_Shelf_PremiumWalnut_Vertical", "premium_walnut_vertical"),
        "high_h": textured_material("GF_Shelf_HighEndWalnut_Horizontal", "highend_walnut_horizontal"),
        "high_v": textured_material("GF_Shelf_HighEndWalnut_Vertical", "highend_walnut_vertical"),
        "luxury_h": textured_material("GF_Shelf_LuxuryMahogany_Horizontal", "luxury_mahogany_horizontal"),
        "luxury_v": textured_material("GF_Shelf_LuxuryMahogany_Vertical", "luxury_mahogany_vertical"),
        "brass": solid_material("GF_Shelf_RestrainedBrass", (0.46, 0.255, 0.055), 0.28, 0.82),
        "dark_hardware": solid_material("GF_Shelf_DarkHardware", (0.035, 0.040, 0.038), 0.31, 0.72),
        "interior": solid_material("GF_Shelf_CabinetInterior", (0.14, 0.095, 0.055), 0.56, 0.0),
        "recess": solid_material("GF_Shelf_Recess", (0.012, 0.014, 0.012), 0.79, 0.0),
        "led": solid_material("GF_Shelf_WarmIntegratedLight", (0.92, 0.62, 0.22), 0.22, 0.02, (1.0, 0.48, 0.12)),
        "collider": solid_material("GF_Shelf_CollisionHidden", (0.02, 0.7, 0.2), 1.0, 0.0, alpha=0.05),
    }


def empty(name, location=(0.0, 0.0, 0.0), parent=None, display="PLAIN_AXES", size=0.08):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = display
    obj.empty_display_size = size
    obj.location = location
    bpy.context.collection.objects.link(obj)
    if parent:
        obj.parent = parent
    return obj


def select_only(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]


def descendants(root):
    result = []
    stack = [root]
    while stack:
        obj = stack.pop()
        result.append(obj)
        stack.extend(obj.children)
    return result


def cube_uv(obj, size=1.1):
    if not obj.data or not hasattr(obj.data, "uv_layers"):
        return
    select_only([obj])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cube_project(cube_size=size, correct_aspect=True)
    bpy.ops.object.mode_set(mode="OBJECT")


def add_box(name, size, location, material=None, bevel=0.006, parent=None, uv_size=1.1):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        obj.data.materials.append(material)
    cube_uv(obj, uv_size)
    if bevel > 0.0005:
        modifier = obj.modifiers.new("Manufactured edge radius", "BEVEL")
        modifier.width = min(bevel, min(size) * 0.22)
        modifier.segments = 2 if CURRENT_LOD == 0 else 1
        modifier.limit_method = "ANGLE"
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    if parent:
        obj.parent = parent
    obj["lod"] = CURRENT_LOD
    return obj


def add_cylinder(name, radius, depth, location, material=None, vertices=12, parent=None, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=max(6, vertices), radius=radius, depth=depth,
        location=location, rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    if material:
        obj.data.materials.append(material)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    cube_uv(obj, 0.45)
    if parent:
        obj.parent = parent
    obj["lod"] = CURRENT_LOD
    return obj


def add_sphere(name, radius, location, material=None, parent=None, segments=12):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=max(6, segments // 2), radius=radius, location=location,
    )
    obj = bpy.context.object
    obj.name = name
    if material:
        obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    obj["lod"] = CURRENT_LOD
    return obj


def add_rod_batch(name, segments, radius, material, parent, sides=8):
    vertices = []
    faces = []
    for start, end in segments:
        a = Vector(start)
        b = Vector(end)
        direction = b - a
        if direction.length < 1e-6:
            continue
        direction.normalize()
        helper = Vector((0.0, 0.0, 1.0))
        if abs(direction.dot(helper)) > 0.95:
            helper = Vector((0.0, 1.0, 0.0))
        axis_u = direction.cross(helper).normalized()
        axis_v = direction.cross(axis_u).normalized()
        base_index = len(vertices)
        for center in (a, b):
            for side in range(sides):
                angle = math.tau * side / sides
                offset = axis_u * math.cos(angle) * radius + axis_v * math.sin(angle) * radius
                vertices.append(tuple(center + offset))
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append((base_index + side, base_index + nxt, base_index + sides + nxt, base_index + sides + side))
        faces.append(tuple(base_index + side for side in reversed(range(sides))))
        faces.append(tuple(base_index + sides + side for side in range(sides)))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    obj.parent = parent
    obj["lod"] = CURRENT_LOD
    return obj


def parent_keep_world(child, parent):
    world = child.matrix_world.copy()
    child.parent = parent
    child.matrix_world = world


def set_origin_world(obj, world_location):
    bpy.context.scene.cursor.location = world_location
    select_only([obj])
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR", center="MEDIAN")


def make_zone(root, name, center, usable, capacity, clearance, bay=None, level=None):
    zone = empty(name, center, root, "CUBE", 0.08)
    zone["zone_type"] = "shelf"
    zone["usable_width_m"] = round(usable[0], 4)
    zone["usable_depth_m"] = round(usable[1], 4)
    zone["clearance_height_m"] = round(clearance, 4)
    zone["capacity"] = int(capacity)
    zone["facing"] = "front:+Z_gltf"
    if bay is not None:
        zone["bay"] = int(bay)
    if level is not None:
        zone["level"] = int(level)
    min_loc = (center[0] - usable[0] / 2, center[1] - usable[1] / 2, center[2])
    max_loc = (center[0] + usable[0] / 2, center[1] + usable[1] / 2, center[2] + clearance)
    minimum = empty(name + "_MIN", min_loc, root, "CUBE", 0.035)
    maximum = empty(name + "_MAX", max_loc, root, "CUBE", 0.035)
    minimum["zone_bound"] = "min"
    maximum["zone_bound"] = "max"
    zone["min_node"] = minimum.name
    zone["max_node"] = maximum.name
    return zone


def make_storage_zone(root, name, center, usable, capacity, bay, level):
    zone = empty(name, center, root, "CUBE", 0.07)
    zone["zone_type"] = "cabinet_storage"
    zone["usable_width_m"] = round(usable[0], 4)
    zone["usable_depth_m"] = round(usable[1], 4)
    zone["clearance_height_m"] = round(usable[2], 4)
    zone["capacity"] = int(capacity)
    zone["bay"] = int(bay)
    zone["level"] = int(level)
    return zone


def add_placement_nodes(root, config):
    w, d, h = config["dimensions"]
    interaction = empty("INTERACTION_POINT", (0.0, -d / 2 - 0.72, min(1.12, h * 0.54)), root, size=0.12)
    interaction["interaction"] = "shelf"
    footprint = empty("PLACEMENT_FOOTPRINT", (0.0, 0.0, 0.0), root, "CUBE", 0.14)
    footprint["width_m"] = w
    footprint["depth_m"] = d
    footprint["height_m"] = h
    empty("PLACEMENT_FOOTPRINT_MIN", (-w / 2, -d / 2, 0.0), root, "CUBE", 0.04)
    empty("PLACEMENT_FOOTPRINT_MAX", (w / 2, d / 2, h), root, "CUBE", 0.04)
    front = empty("FRONT_DIRECTION", (0.0, -d / 2 - 0.14, 0.18), root, "ARROWS", 0.16)
    front["forward_blender"] = [0.0, -1.0, 0.0]
    front["forward_gltf"] = [0.0, 0.0, 1.0]
    carcass_depth = config.get("carcass_depth", d)
    wall_gap = 0.018
    wall_y = max(carcass_depth / 2 + 0.0135, d / 2 - wall_gap) \
        if config["id"] in ("high-end", "luxury") else d / 2
    wall = empty("WALL_SNAP_ANCHOR", (0.0, wall_y, 0.08), root, "CUBE", 0.10)
    wall["wall_gap_m"] = wall_gap
    wall["enabled"] = config["id"] in ("high-end", "luxury")
    empty("FLOOR_CONTACT_CENTER", (0.0, 0.0, 0.0), root, "CIRCLE", 0.12)
    if config["id"] in ("high-end", "luxury"):
        light_control = empty(
            "INTERACT_ShelfLights",
            (w / 2 - 0.10, -d / 2 - 0.045, min(1.22, h * 0.52)),
            root,
            "SPHERE",
            0.07,
        )
        light_control["interaction"] = "toggle_integrated_lighting"
        light_control["interactionType"] = "light-power"


def collision_box(name, size, location, parent):
    obj = add_box(name, size, location, MATERIALS["collider"], bevel=0.0, parent=parent)
    obj.display_type = "WIRE"
    obj.hide_render = True
    obj["collision_proxy"] = True
    obj["collision_shape"] = "box"
    return obj


def add_basic_collisions(root, config, shelf_zs):
    w, d, h = config["dimensions"]
    group = empty("COLLISION_Shelf_Basic", parent=root)
    for index, (x, y) in enumerate(((-w/2+0.035, -d/2+0.035), (w/2-0.035, -d/2+0.035), (-w/2+0.035, d/2-0.035), (w/2-0.035, d/2-0.035)), 1):
        collision_box(f"COLLISION_Shelf_Basic_Post{index:02d}", (0.07, 0.07, h), (x, y, h/2), group)
    for index, z in enumerate(shelf_zs, 1):
        collision_box(f"COLLISION_Shelf_Basic_Surface{index:02d}", (w-0.09, d-0.07, 0.035), (0, 0, z), group)


def build_basic(config, parent, lod=0, metadata=True):
    w, d, h = config["dimensions"]
    shelf_zs = [0.16, 0.72, 1.28]
    post_r = 0.022 if lod < 2 else 0.026
    post_sides = 12 if lod == 0 else 8 if lod == 1 else 6
    for index, (x, y) in enumerate(((-w/2+0.035, -d/2+0.035), (w/2-0.035, -d/2+0.035), (-w/2+0.035, d/2-0.035), (w/2-0.035, d/2-0.035)), 1):
        add_cylinder(f"Basic_Post_{index:02d}", post_r, h - 0.035, (x, y, h/2+0.012), MATERIALS["utility"], post_sides, parent)
        add_cylinder(f"Basic_Foot_{index:02d}", post_r * 1.16, 0.055, (x, y, 0.0275), MATERIALS["dark_hardware"], post_sides, parent)
        if lod == 0:
            add_cylinder(f"Basic_PostCap_{index:02d}", post_r * 1.22, 0.038, (x, y, h-0.012), MATERIALS["utility"], post_sides, parent)
            for groove in range(9):
                z = 0.23 + groove * 0.125
                add_cylinder(f"Basic_AdjustmentRing_{index:02d}_{groove:02d}", post_r * 1.11, 0.008, (x, y, z), MATERIALS["dark_hardware"], 10, parent)
    for shelf_index, z in enumerate(shelf_zs, 1):
        if lod == 2:
            add_box(f"Basic_WireShelf_LOD2_{shelf_index:02d}", (w-0.08, d-0.06, 0.025), (0, 0, z), MATERIALS["utility"], 0.004, parent)
        else:
            x0, x1 = -w/2+0.06, w/2-0.06
            y0, y1 = -d/2+0.05, d/2-0.05
            segments = [
                ((x0,y0,z),(x1,y0,z)), ((x1,y0,z),(x1,y1,z)),
                ((x1,y1,z),(x0,y1,z)), ((x0,y1,z),(x0,y0,z)),
            ]
            wire_cols = 16 if lod == 0 else 9
            cross_rows = 5 if lod == 0 else 3
            for col in range(wire_cols):
                x = x0 + (x1-x0) * col / max(1, wire_cols-1)
                segments.append(((x,y0,z),(x,y1,z)))
            for row in range(cross_rows):
                y = y0 + (y1-y0) * row / max(1, cross_rows-1)
                segments.append(((x0,y,z+0.002),(x1,y,z+0.002)))
            if lod == 0:
                truss_steps = 18
                for y in (y0, y1):
                    segments.append(((x0,y,z-0.082),(x1,y,z-0.082)))
                    for step in range(truss_steps):
                        xa = x0 + (x1-x0) * step / truss_steps
                        xb = x0 + (x1-x0) * (step+1) / truss_steps
                        za = z-0.032 if step % 2 == 0 else z-0.082
                        zb = z-0.032 if step % 2 == 1 else z-0.082
                        segments.append(((xa,y,za),(xb,y,zb)))
            add_rod_batch(f"Basic_WireShelf_{shelf_index:02d}", segments, 0.0044 if lod == 0 else 0.0055, MATERIALS["utility"], parent, 7 if lod == 0 else 6)
        for post_index, (x,y) in enumerate(((-w/2+0.035, -d/2+0.035), (w/2-0.035, -d/2+0.035), (-w/2+0.035, d/2-0.035), (w/2-0.035, d/2-0.035)), 1):
            add_cylinder(f"Basic_ShelfCollar_{shelf_index:02d}_{post_index:02d}", 0.035, 0.070, (x,y,z), MATERIALS["utility"], 12 if lod == 0 else 8, parent)
        if metadata:
            # The top deck is open to the room; the post height is not an
            # overhead obstruction.  Keep a useful merchandise-height budget
            # instead of reporting only the few centimetres above the posts.
            clearance = (shelf_zs[shelf_index] - z - 0.08) if shelf_index < len(shelf_zs) else 0.55
            make_zone(parent.parent, f"SHELF_ZONE_{shelf_index:02d}", (0, 0, z+0.010), (w-0.16, d-0.13), 8, clearance)
    if metadata:
        add_basic_collisions(parent.parent, config, shelf_zs)
    return shelf_zs


def build_standard(config, parent, lod=0, metadata=True):
    w, d, h = config["dimensions"]
    shelf_zs = [0.18, 0.82, 1.46]
    px = w/2-0.035
    py = d/2-0.035
    for index, (x,y) in enumerate(((-px,-py),(px,-py),(-px,py),(px,py)),1):
        add_box(f"Standard_SlottedUpright_{index:02d}", (0.042,0.042,h-0.05), (x,y,h/2+0.015), MATERIALS["charcoal"], 0.003, parent, 0.45)
        add_cylinder(f"Standard_LevelingFoot_{index:02d}", 0.035, 0.035, (x,y,0.0175), MATERIALS["dark_hardware"], 12 if lod == 0 else 8, parent)
        if lod < 2:
            slot_count = 17 if lod == 0 else 8
            for slot in range(slot_count):
                z = 0.18 + slot * (h-0.35)/max(1,slot_count-1)
                add_box(f"Standard_UprightSlot_{index:02d}_{slot:02d}", (0.010,0.004,0.036), (x, -py-0.023 if y < 0 else py+0.023, z), MATERIALS["recess"], 0.002, parent, 0.25)
    for shelf_index,z in enumerate(shelf_zs,1):
        add_box(f"Standard_FrontBeam_{shelf_index:02d}", (w-0.06,0.042,0.090), (0,-py,z-0.038), MATERIALS["charcoal"], 0.005, parent, 0.7)
        add_box(f"Standard_BackBeam_{shelf_index:02d}", (w-0.06,0.042,0.090), (0,py,z-0.038), MATERIALS["charcoal"], 0.005, parent, 0.7)
        if lod < 2:
            for x in (-w*0.33,0,w*0.33):
                add_box(f"Standard_CrossSupport_{shelf_index:02d}", (0.034,d-0.07,0.045), (x,0,z-0.018), MATERIALS["charcoal"], 0.003, parent, 0.5)
        add_box(f"Standard_ShelfBoard_{shelf_index:02d}", (w-0.11,d-0.10,0.026), (0,0,z+0.020), MATERIALS["composite"], 0.004, parent, 0.9)
        if metadata:
            clearance = (shelf_zs[shelf_index]-z-0.10) if shelf_index < len(shelf_zs) else 0.65
            make_zone(parent.parent, f"SHELF_ZONE_{shelf_index:02d}", (0,-0.005,z+0.036), (w-0.19,d-0.17), 10, clearance)
    if metadata:
        group=empty("COLLISION_Shelf_Standard",parent=parent.parent)
        for i,(x,y) in enumerate(((-px,-py),(px,-py),(-px,py),(px,py)),1):
            collision_box(f"COLLISION_Shelf_Standard_Post{i:02d}",(0.07,0.07,h),(x,y,h/2),group)
        for i,z in enumerate(shelf_zs,1):
            collision_box(f"COLLISION_Shelf_Standard_Surface{i:02d}",(w-0.08,d-0.08,0.05),(0,0,z+0.01),group)
    return shelf_zs


def build_premium(config, parent, lod=0, metadata=True):
    w,d,h=config["dimensions"]
    shelf_zs=[0.17,0.75,1.33]
    px=w/2-0.03; py=d/2-0.03
    for index,(x,y) in enumerate(((-px,-py),(px,-py),(-px,py),(px,py)),1):
        add_box(f"Premium_FabricatedUpright_{index:02d}",(0.045,0.045,h-0.04),(x,y,h/2+0.01),MATERIALS["charcoal"],0.005,parent,0.6)
        add_box(f"Premium_FootCap_{index:02d}",(0.062,0.062,0.045),(x,y,0.0225),MATERIALS["dark_hardware"],0.004,parent,0.4)
    for shelf_index,z in enumerate(shelf_zs,1):
        for y in (-py,py):
            add_box(f"Premium_ShelfRail_{shelf_index:02d}",(w-0.05,0.040,0.055),(0,y,z-0.035),MATERIALS["charcoal"],0.004,parent,0.8)
        if lod < 2:
            for x in (-w*0.36,w*0.36):
                add_box(f"Premium_RefinedBracket_{shelf_index:02d}",(0.034,d-0.07,0.048),(x,0,z-0.025),MATERIALS["charcoal"],0.004,parent,0.5)
        add_box(f"Premium_WalnutShelf_{shelf_index:02d}",(w-0.08,d-0.08,0.052),(0,0,z),MATERIALS["premium_h"],0.010,parent,1.2)
        if lod == 0:
            for x in (-px,px):
                add_cylinder(f"Premium_Fastener_{shelf_index:02d}",0.011,0.008,(x,-py-0.024,z+0.008),MATERIALS["dark_hardware"],12,parent,rotation=(math.pi/2,0,0))
        if metadata:
            clearance=(shelf_zs[shelf_index]-z-0.10) if shelf_index<len(shelf_zs) else 0.60
            make_zone(parent.parent,f"SHELF_ZONE_{shelf_index:02d}",(0,-0.005,z+0.031),(w-0.17,d-0.15),12,clearance)
    if metadata:
        group=empty("COLLISION_Shelf_Premium",parent=parent.parent)
        for i,(x,y) in enumerate(((-px,-py),(px,-py),(-px,py),(px,py)),1):
            collision_box(f"COLLISION_Shelf_Premium_Post{i:02d}",(0.07,0.07,h),(x,y,h/2),group)
        for i,z in enumerate(shelf_zs,1):
            collision_box(f"COLLISION_Shelf_Premium_Surface{i:02d}",(w-0.07,d-0.07,0.065),(0,0,z),group)
    return shelf_zs


def add_door(root, bay, side, bay_left, bay_right, front_y, center_z, width, height, material, hardware, luxury=False, lod=0, interactive=True):
    side_name="Left" if side=="left" else "Right"
    hinge_x=bay_left+0.045 if side=="left" else bay_right-0.045
    direction=1 if side=="left" else -1
    center_x=hinge_x+direction*width/2
    door=add_box(f"CabinetDoor_Bay{bay:02d}_{side_name}",(width,0.038,height),(center_x,front_y,center_z),material,0.009 if lod==0 else 0.005,root,0.78)
    set_origin_world(door,(hinge_x,front_y,center_z))
    open_degrees=-96.0 if side=="left" else 96.0
    if interactive:
        door["moving_part"]="cabinet_door"
        door["hinge_side"]=side
        door["closed_degrees"]=0.0
        door["open_degrees"]=open_degrees
        door["movement_axis"]="local_z"
        # Match the established propertyFurnitureVisuals component contract.
        door["interactionType"]="cabinet-door"
        door["closedLocation"]=list(door.location)
        door["closedRotation"]=[0.0,0.0,0.0]
        door["openRotation"]=[0.0,0.0,math.radians(open_degrees)]
        door["openAngle"]=open_degrees
        door["interactionSoundCategory"]="cabinet"
    if lod < 2:
        rail=0.055 if luxury else 0.048
        panel_w=width-rail*2.25
        panel_h=height-rail*2.25
        inset=add_box(f"DoorPanel_Bay{bay:02d}_{side_name}",(panel_w,0.012,panel_h),(center_x,front_y-0.025,center_z),material,0.004,None,0.65)
        parent_keep_world(inset,door)
        for suffix,loc,size in (
            ("Top",(center_x,front_y-0.033,center_z+panel_h/2),(panel_w+rail,0.018,rail)),
            ("Bottom",(center_x,front_y-0.033,center_z-panel_h/2),(panel_w+rail,0.018,rail)),
            ("Hinge",(center_x-direction*panel_w/2,front_y-0.033,center_z),(rail,0.018,panel_h)),
            ("Handle",(center_x+direction*panel_w/2,front_y-0.033,center_z),(rail,0.018,panel_h)),
        ):
            trim=add_box(f"DoorFrame_{bay:02d}_{side_name}_{suffix}",size,loc,material,0.004,None,0.65)
            parent_keep_world(trim,door)
        if luxury:
            for suffix,loc,size in (
                ("Top",(center_x,front_y-0.045,center_z+panel_h*0.39),(panel_w*0.84,0.008,0.010)),
                ("Bottom",(center_x,front_y-0.045,center_z-panel_h*0.39),(panel_w*0.84,0.008,0.010)),
                ("Left",(center_x-panel_w*0.42,front_y-0.045,center_z),(0.010,0.008,panel_h*0.78)),
                ("Right",(center_x+panel_w*0.42,front_y-0.045,center_z),(0.010,0.008,panel_h*0.78)),
            ):
                brass=add_box(f"DoorBrassInset_{bay:02d}_{side_name}_{suffix}",size,loc,MATERIALS["brass"],0.002,None,0.4)
                parent_keep_world(brass,door)
    handle_x=hinge_x+direction*(width-0.085)
    handle=add_sphere(f"CabinetHandle_Bay{bay:02d}_{side_name}",0.018 if not luxury else 0.022,(handle_x,front_y-0.050,center_z+0.04),hardware,None,12 if lod==0 else 8)
    parent_keep_world(handle,door)
    if interactive:
        # New empties do not have a dependency-graph-evaluated matrix_world yet,
        # so parent_keep_world() can collapse them to the asset origin. Author
        # this socket directly in hinge-local coordinates: beside the handle,
        # slightly proud of the door, and at a comfortable visible height.
        interact=empty(
            f"INTERACT_CabinetDoor_Bay{bay:02d}_{side_name}",
            (direction*(width-0.085),-0.10,0.04),door,"SPHERE",0.07,
        )
        interact["interaction"]="toggle_cabinet_door"
        interact["interactionType"]="cabinet-door"
        interact["component"]=door.name
        interact["door_name"]=door.name
    return door


def build_display_wall(config,parent,lod=0,metadata=True,luxury=False):
    w,d,h=config["dimensions"]
    carcass_d=config.get("carcass_depth",d)
    wood_h=MATERIALS["luxury_h" if luxury else "high_h"]
    wood_v=MATERIALS["luxury_v" if luxury else "high_v"]
    hardware=MATERIALS["brass"] if luxury else MATERIALS["dark_hardware"]
    bay_gap=0.075 if luxury else 0.065
    side=0.095 if luxury else 0.085
    inner_w=w-2*side-2*bay_gap
    bay_w=inner_w/3
    base_h=0.66 if luxury else 0.60
    toe_h=0.11 if luxury else 0.10
    crown_h=0.22 if luxury else 0.19
    back_y=carcass_d/2-0.027
    front_y=-carcass_d/2+0.022

    add_box("Luxury_BackCarcass" if luxury else "HighEnd_BackCarcass",(w-0.12,0.045,h-crown_h-toe_h),(0,back_y,(h-crown_h+toe_h)/2),wood_v,0.006,parent,1.25)
    # Side panels and front pilasters establish a built-in silhouette.
    for index,x in enumerate((-w/2+side/2,w/2-side/2),1):
        add_box(f"DisplayWall_SidePanel_{index:02d}",(side,carcass_d-0.04,h-toe_h-crown_h+0.06),(x,0,(h+toe_h-crown_h)/2),wood_v,0.010,parent,1.2)
        if lod==0:
            add_box(f"DisplayWall_SideInset_{index:02d}",(0.012,carcass_d*0.58,h*0.55),(x + (0.051 if x<0 else -0.051),0.055,h*0.57),MATERIALS["recess"],0.004,parent,0.9)
    divider_x=[]
    for divider in range(4):
        x=-w/2+side+divider*(bay_w+bay_gap)
        if divider==3: x=w/2-side
        divider_x.append(x)
        pilaster_w=0.075 if luxury else 0.065
        add_box(f"Pilaster_{divider+1:02d}",(pilaster_w,0.095,h-toe_h-crown_h+0.03),(x,front_y-0.025,(h+toe_h-crown_h)/2),wood_v,0.009,parent,0.8)
        if luxury and lod<2:
            add_box(f"Pilaster_BrassReveal_{divider+1:02d}",(0.009,0.012,h-toe_h-crown_h-0.10),(x,front_y-0.083,(h+toe_h-crown_h)/2),MATERIALS["brass"],0.002,parent,0.5)

    # Layered crown and base molding.
    crown_layers=[(w,0.10,0.070),(w-0.03,0.075,0.055),(w-0.07,0.060,0.045)]
    if luxury: crown_layers.insert(0,(w,0.13,0.075))
    for index,(cw,cd,ch) in enumerate(crown_layers):
        add_box(f"CrownMolding_Layer{index+1:02d}",(cw,cd,ch),(0,back_y-carcass_d*0.33,h-ch/2-index*0.045),wood_h,0.010,parent,1.2)
    base_layers=[(w,0.095,0.10),(w-0.05,0.080,0.065)]
    if luxury: base_layers.append((w-0.09,0.065,0.050))
    for index,(bw,bd,bh) in enumerate(base_layers):
        add_box(f"BaseMolding_Layer{index+1:02d}",(bw,bd,bh),(0,front_y+bd/2,bh/2+index*0.050),wood_h,0.009,parent,1.0)
    if luxury and lod<2:
        add_box("Luxury_BaseBrassShadowLine",(w-0.14,0.012,0.015),(0,front_y-0.025,toe_h+0.02),MATERIALS["brass"],0.002,parent,0.8)

    shelf_levels=[base_h+0.045]
    display_top=h-crown_h-0.11
    # Reserve one full merchandising interval beneath the light valance.  The
    # previous /4 spacing put the fifth zone directly under the fixtures and
    # left it with negative usable clearance after trim allowances.
    step=(display_top-shelf_levels[0])/5
    shelf_levels += [shelf_levels[0]+step*i for i in range(1,5)]
    doors=[]
    for bay in range(1,4):
        left=-w/2+side+(bay-1)*(bay_w+bay_gap)
        right=left+bay_w
        center=(left+right)/2
        # Cabinet interior is real geometry, not a hollow void.
        interior_depth=carcass_d-0.16
        add_box(f"CabinetInterior_Bay{bay:02d}_Back",(bay_w-0.10,0.032,base_h-toe_h-0.06),(center,back_y-0.025,(base_h+toe_h)/2),MATERIALS["interior"],0.004,parent,0.8)
        add_box(f"CabinetInterior_Bay{bay:02d}_Floor",(bay_w-0.10,interior_depth,0.032),(center,0,toe_h+0.025),MATERIALS["interior"],0.004,parent,0.8)
        add_box(f"CabinetInterior_Bay{bay:02d}_Shelf",(bay_w-0.10,interior_depth,0.028),(center,0,toe_h+(base_h-toe_h)*0.52),MATERIALS["interior"],0.004,parent,0.8)
        add_box(f"CabinetInterior_Bay{bay:02d}_Top",(bay_w-0.10,interior_depth,0.032),(center,0,base_h-0.025),MATERIALS["interior"],0.004,parent,0.8)
        for sx in (left+0.035,right-0.035):
            add_box(f"CabinetInterior_Bay{bay:02d}_Side",(0.038,interior_depth,base_h-toe_h),(sx,0,(base_h+toe_h)/2),wood_v,0.005,parent,0.8)
        if metadata:
            make_storage_zone(parent.parent,f"STORAGE_ZONE_Bay{bay:02d}_Level01",(center,-0.01,toe_h+0.055),(bay_w-0.17,interior_depth-0.10,(base_h-toe_h)*0.42),6,bay,1)
            make_storage_zone(parent.parent,f"STORAGE_ZONE_Bay{bay:02d}_Level02",(center,-0.01,toe_h+(base_h-toe_h)*0.56),(bay_w-0.17,interior_depth-0.10,(base_h-toe_h)*0.36),6,bay,2)
        door_gap=0.012
        door_w=(bay_w-0.10-door_gap)/2
        door_h=base_h-toe_h-0.075
        door_z=toe_h+door_h/2+0.028
        doors.append(add_door(parent,bay,"left",left,right,front_y-0.010,door_z,door_w,door_h,wood_v,hardware,luxury,lod,metadata))
        doors.append(add_door(parent,bay,"right",left,right,front_y-0.010,door_z,door_w,door_h,wood_v,hardware,luxury,lod,metadata))

        # Five usable display levels per bay: cabinet top plus four boards.
        for level,z in enumerate(shelf_levels,1):
            board_depth=carcass_d-0.13
            add_box(f"ShelfBoard_Bay{bay:02d}_Level{level:02d}",(bay_w-0.10,board_depth,0.036 if not luxury else 0.042),(center,-0.012,z),wood_h,0.007 if not luxury else 0.010,parent,1.15)
            add_box(f"ShelfEdge_Bay{bay:02d}_Level{level:02d}",(bay_w-0.08,0.035,0.048),(center,front_y+0.04,z-0.003),wood_h,0.006,parent,0.85)
            if luxury and lod<2:
                add_box(f"ShelfBrassAccent_Bay{bay:02d}_Level{level:02d}",(bay_w-0.16,0.010,0.010),(center,front_y+0.015,z-0.010),MATERIALS["brass"],0.002,parent,0.7)
            if metadata:
                clearance=(shelf_levels[level]-z-0.08) if level<len(shelf_levels) else display_top-z-0.06
                make_zone(parent.parent,f"SHELF_ZONE_BAY{bay:02d}_LEVEL{level:02d}",(center,-0.008,z+0.024),(bay_w-0.22,carcass_d-0.25),6 if not luxury else 8,clearance,bay,level)
            if luxury and level>1 and lod<2:
                add_box(f"ShelfLight_Bay{bay:02d}_Level{level:02d}",(bay_w-0.22,0.018,0.013),(center,front_y+0.055,z-0.032),MATERIALS["led"],0.003,parent,0.7)
                if metadata:
                    node=empty(f"LIGHT_Shelf_Bay{bay:02d}_Level{level:02d}",(center,front_y+0.07,z-0.05),parent.parent,"CIRCLE",0.055)
                    node["light_type"]="shelf_wash"
                    node["color_kelvin"]=3000
                    node["intensity_lumens"]=220

        fixture_z=h-crown_h-0.055
        add_cylinder(f"LightFixture_Bay{bay:02d}",0.042,0.018,(center,front_y+0.10,fixture_z),MATERIALS["dark_hardware"],16 if lod==0 else 8,parent)
        add_cylinder(f"LightLens_Bay{bay:02d}",0.032,0.011,(center,front_y+0.09,fixture_z-0.012),MATERIALS["led"],16 if lod==0 else 8,parent)
        if metadata:
            light=empty(f"LIGHT_POINT_Bay{bay:02d}",(center,front_y+0.05,fixture_z-0.04),parent.parent,"CIRCLE",0.07)
            light["light_type"]="warm_spot"
            light["color_kelvin"]=3000 if luxury else 3200
            light["intensity_lumens"]=520 if luxury else 420
            light["range_m"]=2.5

    if metadata:
        collision=empty("COLLISION_Shelf_Luxury" if luxury else "COLLISION_Shelf_HighEnd",parent=parent.parent)
        prefix="COLLISION_Shelf_Luxury" if luxury else "COLLISION_Shelf_HighEnd"
        collision_box(prefix+"_LeftSide",(side,carcass_d-0.05,h),( -w/2+side/2,0,h/2),collision)
        collision_box(prefix+"_RightSide",(side,carcass_d-0.05,h),( w/2-side/2,0,h/2),collision)
        collision_box(prefix+"_BaseCabinet",(w-2*side,carcass_d-0.06,base_h),(0,0,base_h/2),collision)
        collision_box(prefix+"_Back",(w-2*side,0.06,h-base_h),(0,back_y,(h+base_h)/2),collision)
        collision_box(prefix+"_Crown",(w,0.13,crown_h),(0,back_y-carcass_d*0.30,h-crown_h/2),collision)
        for index,x in enumerate(divider_x,1):
            collision_box(prefix+f"_Pilaster{index:02d}",(0.08,0.10,h-base_h-crown_h),(x,front_y,(h+base_h-crown_h)/2),collision)
    return shelf_levels,doors


def build_geometry(config,lod_root,lod,metadata=True):
    global CURRENT_LOD
    CURRENT_LOD=lod
    if config["id"]=="basic": return build_basic(config,lod_root,lod,metadata)
    if config["id"]=="standard": return build_standard(config,lod_root,lod,metadata)
    if config["id"]=="premium": return build_premium(config,lod_root,lod,metadata)
    if config["id"]=="high-end": return build_display_wall(config,lod_root,lod,metadata,False)
    if config["id"]=="luxury": return build_display_wall(config,lod_root,lod,metadata,True)
    raise ValueError(config["id"])


def mesh_triangles(root):
    total=0
    for obj in descendants(root):
        if obj.type!="MESH" or obj.name.startswith("COLLISION_"):
            continue
        mesh=obj.data
        mesh.calc_loop_triangles()
        total+=len(mesh.loop_triangles)
    return total


def export_glb(root,path):
    path.parent.mkdir(parents=True,exist_ok=True)
    objects=descendants(root)
    select_only(objects)
    bpy.ops.export_scene.gltf(
        filepath=str(path),export_format="GLB",use_selection=True,
        export_apply=True,export_yup=True,export_extras=True,
        export_cameras=False,export_lights=False,
    )


def look_at(obj,target):
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat("-Z","Y").to_euler()


def studio_setup(config,functional=False):
    w,d,h=config["dimensions"]
    preview_root=empty("PREVIEW_STUDIO")
    floor=add_box("PREVIEW_Floor",(max(6.0,w*2.2),max(5.0,d*6),0.05),(0,0,-0.035),solid_material("PREVIEW_NeutralGray",(0.30,0.31,0.32),0.82),0.0,preview_root,2.0)
    camera_loc=(w*1.10+0.8,-max(3.4,d*4.5+2.2),h*0.78+0.45)
    if w < 2.0:
        camera_loc=(w*0.92+0.36,-3.0,h*0.74+0.34)
    bpy.ops.object.camera_add(location=camera_loc)
    camera=bpy.context.object
    camera.name="PREVIEW_Camera"
    camera.data.lens=58 if w<2 else 64
    look_at(camera,(0,0,h*0.48))
    camera.parent=preview_root
    bpy.context.scene.camera=camera
    for name,energy,size,loc in (
        ("PREVIEW_Key",1050,3.5,(-3.4,-4.2,4.8)),
        ("PREVIEW_Fill",650,3.2,(4.6,-1.5,3.1)),
        ("PREVIEW_Rim",850,2.7,(1.2,3.2,4.4)),
    ):
        bpy.ops.object.light_add(type="AREA",location=loc)
        light=bpy.context.object
        light.name=name
        light.data.energy=energy
        light.data.shape="DISK"
        light.data.size=size
        look_at(light,(0,0,h*0.48))
        light.parent=preview_root
    if config["id"] in ("high-end","luxury"):
        w,d,h=config["dimensions"]
        bay_w=(w-0.36)/3
        for bay in range(3):
            x=-bay_w+bay*bay_w
            bpy.ops.object.light_add(type="AREA",location=(x,-d*0.20,h-0.32))
            light=bpy.context.object
            light.name=f"PREVIEW_Integrated_{bay+1:02d}"
            light.data.energy=34 if config["id"]=="high-end" else 52
            light.data.color=(1.0,0.62,0.29)
            light.data.shape="RECTANGLE"
            light.data.size=bay_w*0.40
            light.data.size_y=0.10
            look_at(light,(x,-0.05,h*0.55))
            light.parent=preview_root
    return preview_root


def set_studio_camera(config,view):
    """Reframe the shared studio camera for repeatable all-angle QA evidence."""
    w,d,h=config["dimensions"]
    camera=bpy.data.objects.get("PREVIEW_Camera")
    if camera is None:
        raise RuntimeError("PREVIEW_Camera is required before changing studio views")
    three_quarter_distance=max(3.2,d*4.5+2.2,w*0.92+1.75)
    front_distance=max(3.6,d*4.5+2.2,w*1.45+1.70)
    camera.data.lens=58 if w<2 else 64
    if view=="front":
        camera.location=(0,-front_distance,h*0.76+0.42)
    elif view=="left":
        camera.location=(-w*0.92-0.65,-three_quarter_distance*0.78,h*0.78+0.46)
    elif view=="right":
        camera.location=(w*0.92+0.65,-three_quarter_distance*0.78,h*0.78+0.46)
    else:
        raise ValueError(f"Unknown studio view: {view}")
    look_at(camera,(0,0,h*0.48))


def render(path,config):
    scene=bpy.context.scene
    try: scene.render.engine="BLENDER_EEVEE_NEXT"
    except TypeError: scene.render.engine="BLENDER_EEVEE"
    scene.render.resolution_x=900
    scene.render.resolution_y=900
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG"
    scene.render.film_transparent=False
    scene.render.image_settings.color_mode="RGBA"
    scene.render.filepath=str(path)
    scene.render.engine="BLENDER_EEVEE"
    scene.render.image_settings.color_depth="8"
    scene.view_settings.look="AgX - Medium High Contrast"
    scene.world.color=(0.045,0.050,0.055)
    path.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.render.render(write_still=True)


def delete_root(root):
    for obj in reversed(descendants(root)):
        bpy.data.objects.remove(obj,do_unlink=True)


TEST_MATERIALS=None


def test_materials():
    global TEST_MATERIALS
    if TEST_MATERIALS:
        return TEST_MATERIALS
    TEST_MATERIALS=[
        solid_material("TEST_Product_Green",(0.06,0.24,0.13),0.62),
        solid_material("TEST_Product_Cream",(0.78,0.72,0.59),0.72),
        solid_material("TEST_Product_Sage",(0.36,0.48,0.37),0.68),
        solid_material("TEST_Product_Charcoal",(0.08,0.09,0.085),0.48),
        solid_material("TEST_Product_Brass",(0.45,0.25,0.06),0.36,0.55),
    ]
    return TEST_MATERIALS


def add_test_products(asset_root,config):
    group=empty("PREVIEW_TestProducts")
    mats=test_materials()
    zones=sorted([obj for obj in descendants(asset_root) if obj.name.startswith("SHELF_ZONE_") and not obj.name.endswith(("_MIN","_MAX"))],key=lambda o:o.name)
    records=[]
    for index,zone in enumerate(zones):
        width=float(zone.get("usable_width_m",0.6))
        depth=float(zone.get("usable_depth_m",0.25))
        capacity=int(zone.get("capacity",4))
        count=min(4,max(2,capacity))
        product_w=min(0.20,width/(count+0.8))
        product_d=min(0.24,depth*0.72)
        clearance=float(zone.get("clearance_height_m",0.30))
        product_h=min(0.24,max(0.09,clearance*0.62))
        for col in range(count):
            x=zone.location.x-width*0.40+col*(width*0.80/max(1,count-1))
            y=zone.location.y-depth*0.05+(col%2)*min(0.025,depth*0.08)
            bottom=zone.location.z
            if (index+col)%5==0:
                obj=add_cylinder(f"TEST_Bottle_{index:02d}_{col:02d}",product_w*0.28,product_h,(x,y,bottom+product_h/2),mats[(index+col)%len(mats)],10,group)
            else:
                obj=add_box(f"TEST_Box_{index:02d}_{col:02d}",(product_w,product_d,product_h),(x,y,bottom+product_h/2),mats[(index+col)%len(mats)],0.008,group,0.5)
            records.append({"zone":zone.name,"object":obj.name,"bottom":round(bottom,4),"width":round(product_w,4),"depth":round(product_d,4),"height":round(product_h,4)})
    return group,records


def open_functional_doors(asset_root,config):
    doors=sorted(
        [obj for obj in descendants(asset_root) if obj.name.startswith("CabinetDoor_")],
        key=lambda obj: obj.name,
    )
    opened=[]
    wanted=doors[:2] if config["id"]=="high-end" else doors[:4]
    for index,door in enumerate(wanted):
        factor=0.72 if index%2==0 else 1.0
        door.rotation_euler.z=math.radians(float(door["open_degrees"])*factor)
        opened.append(door)
    return opened


def restore_doors(doors):
    for door in doors:
        door.rotation_euler.z=0.0


def hide_lod_roots(lod_roots,active=0):
    for index,root in enumerate(lod_roots):
        root.hide_render=index!=active
        root.hide_viewport=index!=active
        for child in descendants(root):
            child.hide_render=index!=active or child.name.startswith("COLLISION_")
            child.hide_viewport=index!=active


def build_asset(config):
    clean_scene()
    create_material_library()
    root=empty(config["name"])
    w,d,h=config["dimensions"]
    root["asset_id"]=f"pro-shop-furniture:retail-shelving:{config['id']}"
    root["category"]="retail-shelving"
    root["tier"]=config["id"]
    root["display_name"]=config["label"]
    root["dimensions_m"]=[w,h,d]
    root["front_direction"]="+Z glTF / -Y Blender"
    root["source"]="Original Golf Flipper procedural Blender asset; no external assets"
    root["reference"] = config["reference"]
    root["lod_count"]=3
    root["stocking_zone_count"]=config["zones"]
    root["cabinet_door_count"]=config["doors"]
    root["storage_zone_count"]=config["storage_zones"]
    add_placement_nodes(root,config)
    lod0=empty("LOD0",parent=root)
    lod0["lod_level"]=0
    lod0["switch_distance_m"]=0.0
    result=build_geometry(config,lod0,0,True)
    main_path=RUNTIME_ROOT/f"shelf_{config['id'].replace('-','_')}.glb"
    triangle_counts={"LOD0":mesh_triangles(lod0)}

    # Main empty render.
    studio=studio_setup(config)
    render(PREVIEW_ROOT/f"shelf_{config['id'].replace('-','_')}_preview.png",config)
    delete_root(studio)

    # Functional render: cabinet operation for built-ins, product fit for open racks.
    opened=[]
    test_group=None
    test_records=[]
    if config["doors"]:
        opened=open_functional_doors(root,config)
    else:
        test_group,test_records=add_test_products(root,config)
    studio=studio_setup(config,True)
    render(PREVIEW_ROOT/f"shelf_{config['id'].replace('-','_')}_functional.png",config)
    delete_root(studio)
    if test_group:
        delete_root(test_group)
    restore_doors(opened)

    # Every tier also receives an explicit stocking-fit render.
    test_group,test_records=add_test_products(root,config)
    studio=studio_setup(config,True)
    render(QA_ROOT/f"shelf_{config['id'].replace('-','_')}_stocking_validation.png",config)
    angle_previews=[]
    for view in ("front","left"):
        set_studio_camera(config,view)
        angle_path=QA_ROOT/f"shelf_{config['id'].replace('-','_')}_angle_{view}.png"
        render(angle_path,config)
        angle_previews.append(angle_path.relative_to(REPO).as_posix())
    delete_root(studio)
    delete_root(test_group)

    lod_roots=[lod0]
    for lod in (1,2):
        lod_root=empty(f"LOD{lod}",parent=root)
        lod_root["lod_level"]=lod
        lod_root["switch_distance_m"]=(0.0,8.0,18.0)[lod]
        build_geometry(config,lod_root,lod,False)
        lod_roots.append(lod_root)
        export_path=RUNTIME_ROOT/f"shelf_{config['id'].replace('-','_')}_lod{lod}.glb"
        export_glb(lod_root,export_path)
        triangle_counts[f"LOD{lod}"]=mesh_triangles(lod_root)
    # The runtime's established Three.js LOD adapter expects all three authored
    # roots in the production GLB.  Keep standalone LOD files as validation and
    # streaming-ready artifacts as well.
    export_glb(root,main_path)
    hide_lod_roots(lod_roots,0)
    source_path=SOURCE_ROOT/f"shelf_{config['id'].replace('-','_')}.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path))

    zone_objects=[obj for obj in descendants(root) if obj.name.startswith("SHELF_ZONE_") and not obj.name.endswith(("_MIN","_MAX"))]
    storage_objects=[obj for obj in descendants(root) if obj.name.startswith("STORAGE_ZONE_")]
    doors=[obj for obj in descendants(lod0) if obj.name.startswith("CabinetDoor_")]
    light_nodes=[obj for obj in descendants(root) if obj.name.startswith("LIGHT_")]
    collisions=[obj for obj in descendants(root) if obj.name.startswith("COLLISION_") and obj.type=="MESH"]
    material_names=sorted({mat.name for obj in descendants(lod0) if obj.type=="MESH" for mat in obj.data.materials if mat})
    return {
        "id":config["id"],"assetName":config["name"],"label":config["label"],
        "reference":config["reference"],"dimensionsM":{"width":w,"depth":d,"height":h},
        "source":source_path.relative_to(REPO).as_posix(),
        "glb":main_path.relative_to(REPO).as_posix(),
        "lodGlbs":{
            "LOD1":(RUNTIME_ROOT/f"shelf_{config['id'].replace('-','_')}_lod1.glb").relative_to(REPO).as_posix(),
            "LOD2":(RUNTIME_ROOT/f"shelf_{config['id'].replace('-','_')}_lod2.glb").relative_to(REPO).as_posix(),
        },
        "preview":(PREVIEW_ROOT/f"shelf_{config['id'].replace('-','_')}_preview.png").relative_to(REPO).as_posix(),
        "functionalPreview":(PREVIEW_ROOT/f"shelf_{config['id'].replace('-','_')}_functional.png").relative_to(REPO).as_posix(),
        "stockingPreview":(QA_ROOT/f"shelf_{config['id'].replace('-','_')}_stocking_validation.png").relative_to(REPO).as_posix(),
        "anglePreviews":angle_previews,
        "triangleCounts":triangle_counts,"materials":material_names,
        "shelfZones":len(zone_objects),"shelfCapacity":sum(int(obj.get("capacity",0)) for obj in zone_objects),
        "cabinetDoors":len(doors),"storageZones":len(storage_objects),"lightNodes":len(light_nodes),
        "storageCapacity":sum(int(obj.get("capacity",0)) for obj in storage_objects),
        "collisionMeshes":len(collisions),"testProducts":test_records,
        "wallSnap":config["id"] in ("high-end","luxury"),
        "license":"Original Golf Flipper project asset; no external source",
    }


def build_comparison(manifest):
    clean_scene()
    create_material_library()
    roots=[]
    cursor=0.0
    max_h=0.0
    for entry in manifest["assets"]:
        bpy.ops.import_scene.gltf(filepath=str(REPO/entry["glb"]))
        imported=[obj for obj in bpy.context.selected_objects if obj.parent is None]
        if not imported:
            continue
        root=imported[0]
        root.name=f"COMPARISON_{entry['assetName']}"
        width=entry["dimensionsM"]["width"]
        root.location.x=cursor+width/2
        cursor+=width+0.55
        roots.append(root)
        max_h=max(max_h,entry["dimensionsM"]["height"])
        for obj in descendants(root):
            if obj.name.startswith("COLLISION_"):
                obj.hide_render=True
    total_w=max(1.0,cursor-0.55)
    center=total_w/2
    studio_root=empty("PREVIEW_ComparisonStudio")
    floor=add_box("PREVIEW_ComparisonFloor",(total_w+3.0,4.5,0.05),(center,0,-0.035),solid_material("PREVIEW_ComparisonGray",(0.30,0.31,0.32),0.82),0.0,studio_root,2.0)
    camera_distance=max(15.0,total_w*1.55)
    bpy.ops.object.camera_add(location=(center,-camera_distance,max_h*0.82+0.7))
    camera=bpy.context.object
    camera.name="PREVIEW_ComparisonCamera"
    camera.data.lens=55
    look_at(camera,(center,0,max_h*0.46))
    camera.parent=studio_root
    bpy.context.scene.camera=camera
    for name,energy,size,loc in (
        ("PREVIEW_ComparisonKey",2200,5.0,(center-4,-5.0,5.5)),
        ("PREVIEW_ComparisonFill",1500,5.0,(center+5,-1.0,4.0)),
        ("PREVIEW_ComparisonRim",1800,4.0,(center,4.0,5.0)),
    ):
        bpy.ops.object.light_add(type="AREA",location=loc)
        light=bpy.context.object; light.name=name; light.data.energy=energy; light.data.size=size
        look_at(light,(center,0,max_h*0.45)); light.parent=studio_root
    config={"dimensions":(total_w,0.7,max_h),"id":"comparison"}
    path=PREVIEW_ROOT/"shelf_progression_comparison.png"
    scene=bpy.context.scene
    scene.render.resolution_x=1800; scene.render.resolution_y=760; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG"; scene.render.filepath=str(path)
    scene.render.engine="BLENDER_EEVEE"; scene.view_settings.look="AgX - Medium High Contrast"; scene.world.color=(0.045,0.05,0.055)
    bpy.ops.render.render(write_still=True)
    comparison_source=SOURCE_ROOT/"shelf_progression_comparison.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(comparison_source))
    manifest["comparison"]={"source":comparison_source.relative_to(REPO).as_posix(),"preview":path.relative_to(REPO).as_posix()}


def main():
    ensure_directories()
    build_texture_library()
    assets=[]
    for config in CONFIGS:
        print(f"[retail-shelves] building {config['name']}",flush=True)
        assets.append(build_asset(config))
    manifest={
        "schemaVersion":1,
        "generator":"tools/blender/build_retail_shelves.py",
        "blenderVersion":bpy.app.version_string,
        "units":"metres",
        "orientation":"Blender Z-up; glTF Y-up; front +Z in glTF",
        "assetCount":len(assets),
        "assets":assets,
        "textureDirectory":TEXTURE_ROOT.relative_to(REPO).as_posix(),
        "externalAssets":[],
    }
    build_comparison(manifest)
    MANIFEST_PATH.write_text(json.dumps(manifest,indent=2)+"\n","utf-8")
    print(json.dumps({"built":len(assets),"manifest":str(MANIFEST_PATH),"blender":bpy.app.version_string}))


if __name__=="__main__":
    main()
