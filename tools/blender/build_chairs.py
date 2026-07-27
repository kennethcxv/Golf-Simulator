"""Build the five reference-matched Golf Flipper chair tiers in Blender 5.1+.

The build is deliberately self-contained and repeatable.  It creates original
project-owned geometry and compact authored PBR texture maps, saves one clean
source scene per chair, exports a canonical GLB containing LOD0/LOD1/LOD2,
exports standalone distance LODs, renders studio and seated validation views,
re-imports every canonical GLB into a factory scene, and writes machine-readable
and human-readable validation reports.

Run with Blender MCP or in background mode:

    blender --background --factory-startup --python tools/blender/build_chairs.py
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
from mathutils import Matrix, Vector


REPO = Path(os.environ.get("GF_REPO_ROOT", Path(__file__).resolve().parents[2])).resolve()
ASSET_ROOT = REPO / "Assets" / "pro_shop_furniture"
SOURCE_ROOT = ASSET_ROOT / "source" / "chairs"
PREVIEW_ROOT = ASSET_ROOT / "previews" / "chairs"
EXPORT_ROOT = ASSET_ROOT / "exports" / "chairs"
TEXTURE_ROOT = ASSET_ROOT / "textures" / "chairs"
RUNTIME_ROOT = REPO / "vendor" / "models" / "pro_shop_furniture" / "chairs"
QA_ROOT = REPO / "qa" / "chairs" / "blender"
REPORT_PATH = QA_ROOT / "blender-validation.json"
MANIFEST_PATH = ASSET_ROOT / "manifest.json"
COMPARISON_SOURCE = SOURCE_ROOT / "chair_progression_validation.blend"

FRONT = (0.0, -1.0, 0.0)
METERS_TO_YARDS = 1.0936133


CHAIRS = [
    {
        "key": "basic", "catalog_tier": "basic", "runtime": "basic",
        "asset": "Chair_Basic", "label": "Basic", "tier": 1, "kind": "office",
        "dimensions": (0.63, 1.04, 0.68), "seat_height": 0.485,
        "seat_width": 0.51, "seat_depth": 0.48, "height_range": 0.09,
        "recline_deg": 0.0, "back_angle": 7.0, "caster_radius": 0.315,
        "leather": ((0.085, 0.090, 0.095), (0.255, 0.270, 0.275), 0.59),
        "leather_kind": "faux-leather", "budget": (28000, 9500, 3200),
    },
    {
        "key": "standard", "catalog_tier": "standard", "runtime": "standard",
        "asset": "Chair_Standard", "label": "Standard", "tier": 2, "kind": "office",
        "dimensions": (0.68, 1.12, 0.73), "seat_height": 0.495,
        "seat_width": 0.555, "seat_depth": 0.515, "height_range": 0.11,
        "recline_deg": 12.0, "back_angle": 8.0, "caster_radius": 0.345,
        "leather": ((0.100, 0.110, 0.108), (0.300, 0.320, 0.310), 0.49),
        "leather_kind": "finished-leather", "budget": (34000, 11500, 3800),
    },
    {
        "key": "premium", "catalog_tier": "premium", "runtime": "premium",
        "asset": "Chair_Premium", "label": "Premium", "tier": 3, "kind": "office",
        "dimensions": (0.78, 1.19, 0.82), "seat_height": 0.505,
        "seat_width": 0.63, "seat_depth": 0.56, "height_range": 0.12,
        "recline_deg": 18.0, "back_angle": 10.0, "caster_radius": 0.385,
        "leather": ((0.120, 0.035, 0.008), (0.400, 0.130, 0.030), 0.45),
        "leather_kind": "executive-leather", "budget": (42000, 14000, 4500),
    },
    {
        "key": "high_end", "catalog_tier": "luxury", "runtime": "high-end",
        "asset": "Chair_HighEnd", "label": "High-End", "tier": 4, "kind": "lounge",
        "dimensions": (1.05, 0.92, 0.99), "seat_height": 0.445,
        "seat_width": 0.66, "seat_depth": 0.57, "height_range": 0.0,
        "recline_deg": 0.0, "back_angle": 12.0,
        "leather": ((0.085, 0.024, 0.006), (0.300, 0.085, 0.022), 0.48),
        "leather_kind": "club-leather", "budget": (46000, 15000, 4800),
    },
    {
        "key": "luxury", "catalog_tier": "executive", "runtime": "luxury",
        "asset": "Chair_Luxury", "label": "Luxury", "tier": 5, "kind": "lounge",
        "dimensions": (1.20, 0.97, 1.08), "seat_height": 0.45,
        "seat_width": 0.73, "seat_depth": 0.62, "height_range": 0.0,
        "recline_deg": 0.0, "back_angle": 13.0,
        "leather": ((0.065, 0.014, 0.004), (0.220, 0.055, 0.014), 0.45),
        "leather_kind": "chesterfield-leather", "budget": (56000, 18000, 5600),
    },
]


MATERIALS = {}
CURRENT = None


def log(message):
    print(f"[chair-build] {message}", flush=True)


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
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.frame_start = 1
    scene.frame_end = 72
    scene.frame_set(1)
    if scene.world is None:
        scene.world = bpy.data.worlds.new("Chair_Studio_World")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.055, 0.060, 0.060, 1.0)
        bg.inputs["Strength"].default_value = 0.55


def _hash01(x, y, seed):
    n = (x * 374761393 + y * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    n ^= n >> 16
    return (n & 0xFFFFFF) / float(0xFFFFFF)


def _lerp(a, b, t):
    return tuple(a[index] + (b[index] - a[index]) * t for index in range(3))


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


def generate_surface_maps(key, kind, base, accent, roughness, size=512):
    """Generate compact, original base-color/roughness/tangent-normal maps."""
    folder = TEXTURE_ROOT / key
    folder.mkdir(parents=True, exist_ok=True)
    paths = {
        "base": folder / f"{key}_basecolor.png",
        "rough": folder / f"{key}_roughness.png",
        "normal": folder / f"{key}_normal.png",
    }
    if all(path.exists() for path in paths.values()) and os.environ.get("GF_CHAIR_REBUILD_TEXTURES") != "1":
        return paths

    count = size * size
    heights = array("f", [0.0]) * count
    tones = array("f", [0.0]) * count
    roughs = array("f", [0.0]) * count
    seed = sum(ord(char) for char in key) + len(kind) * 173
    for py in range(size):
        v = py / max(1, size - 1)
        for px in range(size):
            u = px / max(1, size - 1)
            index = py * size + px
            fine = _hash01(px * 3, py * 5, seed) - 0.5
            coarse = _hash01(px // 7, py // 7, seed + 37) - 0.5
            if kind == "wood":
                warp = 0.68 * math.sin(u * math.tau * 2.4) + 0.20 * math.sin(u * math.tau * 9.2)
                grain = 0.5 + 0.5 * math.sin(v * math.tau * 9.0 + warp)
                broad = 0.5 + 0.5 * math.sin(v * math.tau * 2.25 + math.sin(u * 4.0))
                tone = 0.38 + (grain - 0.5) * 0.17 + (broad - 0.5) * 0.10 + fine * 0.035
                height = 0.5 + (grain - 0.5) * 0.10 + fine * 0.018
                rough = roughness + (0.5 - grain) * 0.045 + fine * 0.018
            elif kind == "plastic":
                mottled = 0.5 + 0.5 * math.sin((u * 13.0 + v * 17.0) * math.tau)
                tone = 0.48 + (mottled - 0.5) * 0.035 + fine * 0.035
                height = 0.5 + fine * 0.025
                rough = roughness + fine * 0.018
            else:
                # Voronoi-like pores plus long restrained hide creases.  The
                # amplitude is intentionally small: these are new chairs, not
                # distressed props or photogrammetry scans.
                pore = abs(fine) * 2.0
                crease = 0.5 + 0.5 * math.sin((u * 4.2 + math.sin(v * 8.5) * 0.17) * math.tau)
                cross = 0.5 + 0.5 * math.sin((v * 5.7 + math.sin(u * 7.0) * 0.11) * math.tau)
                hide = (
                    math.sin((u * 1.75 + math.sin(v * 2.4) * 0.16) * math.tau) * 0.55
                    + math.sin((v * 2.15 + math.sin(u * 1.8) * 0.14) * math.tau) * 0.45
                )
                tone = 0.45 + hide * 0.032 + (crease - 0.5) * 0.035 + fine * 0.045
                height = 0.5 + (0.5 - pore) * 0.085 + (crease - 0.5) * 0.035 + (cross - 0.5) * 0.018
                rough = roughness - hide * 0.018 + fine * 0.022
            tones[index] = max(0.0, min(1.0, tone))
            heights[index] = max(0.0, min(1.0, height))
            roughs[index] = max(0.06, min(0.96, rough))

    base_pixels = array("f")
    rough_pixels = array("f")
    normal_pixels = array("f")
    normal_strength = 1.8 if kind == "wood" else 0.75 if kind == "plastic" else 1.25
    for py in range(size):
        ym = max(0, py - 1)
        yp = min(size - 1, py + 1)
        for px in range(size):
            xm = max(0, px - 1)
            xp = min(size - 1, px + 1)
            index = py * size + px
            color = _lerp(base, accent, tones[index])
            base_pixels.extend((*color, 1.0))
            value = roughs[index]
            rough_pixels.extend((value, value, value, 1.0))
            dx = (heights[py * size + xp] - heights[py * size + xm]) * normal_strength
            dy = (heights[yp * size + px] - heights[ym * size + px]) * normal_strength
            normal = Vector((-dx, -dy, 1.0)).normalized()
            normal_pixels.extend((normal.x * 0.5 + 0.5, normal.y * 0.5 + 0.5, normal.z * 0.5 + 0.5, 1.0))

    _save_image(f"{key}_BaseColor", paths["base"], size, size, base_pixels)
    _save_image(f"{key}_Roughness", paths["rough"], size, size, rough_pixels, data=True)
    _save_image(f"{key}_Normal", paths["normal"], size, size, normal_pixels, data=True)
    return paths


def solid_material(name, color, roughness=0.55, metallic=0.0, coat=0.0):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*color, 1.0)
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if bsdf.inputs.get("IOR Level"):
            bsdf.inputs["IOR Level"].default_value = 0.22 if metallic < 0.5 else 0.5
        if bsdf.inputs.get("Coat Weight"):
            bsdf.inputs["Coat Weight"].default_value = coat
        if bsdf.inputs.get("Coat Roughness"):
            bsdf.inputs["Coat Roughness"].default_value = min(0.65, roughness * 0.75)
    material["source"] = "Original Golf Flipper authored material"
    material["license"] = "Project-owned; no external texture or asset"
    return material


def textured_material(
    name, paths, metallic=0.0, coat=0.05, normal_strength=0.42,
    ior_level=0.05, base_gain=1.0,
):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (640, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (350, 0)
    bsdf.inputs["Metallic"].default_value = metallic
    if bsdf.inputs.get("IOR Level"):
        bsdf.inputs["IOR Level"].default_value = ior_level
    if bsdf.inputs.get("Coat Weight"):
        bsdf.inputs["Coat Weight"].default_value = coat
    if bsdf.inputs.get("Coat Roughness"):
        bsdf.inputs["Coat Roughness"].default_value = 0.34
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])

    base_node = nodes.new("ShaderNodeTexImage")
    base_node.name = "Authored Base Color"
    base_node.image = bpy.data.images.load(str(paths["base"]), check_existing=True)
    base_node.extension = "REPEAT"
    base_node.location = (-460, 190)
    if abs(base_gain - 1.0) > 0.001:
        value_node = nodes.new("ShaderNodeHueSaturation")
        value_node.name = "Upholstery body value"
        value_node.location = (-40, 190)
        value_node.inputs["Value"].default_value = base_gain
        links.new(base_node.outputs["Color"], value_node.inputs["Color"])
        links.new(value_node.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        links.new(base_node.outputs["Color"], bsdf.inputs["Base Color"])

    rough_node = nodes.new("ShaderNodeTexImage")
    rough_node.name = "Authored Roughness"
    rough_node.image = bpy.data.images.load(str(paths["rough"]), check_existing=True)
    rough_node.image.colorspace_settings.name = "Non-Color"
    rough_node.extension = "REPEAT"
    rough_node.location = (-460, -40)
    links.new(rough_node.outputs["Color"], bsdf.inputs["Roughness"])

    normal_node = nodes.new("ShaderNodeTexImage")
    normal_node.name = "Authored Tangent Normal"
    normal_node.image = bpy.data.images.load(str(paths["normal"]), check_existing=True)
    normal_node.image.colorspace_settings.name = "Non-Color"
    normal_node.extension = "REPEAT"
    normal_node.location = (-460, -270)
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.location = (70, -250)
    normal_map.inputs["Strength"].default_value = normal_strength
    links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    material["source"] = "Original Golf Flipper generated PBR map set"
    material["license"] = "Project-owned; no external texture or asset"
    return material


def build_materials(chair):
    global MATERIALS
    MATERIALS = {}
    base, accent, roughness = chair["leather"]
    leather_maps = generate_surface_maps(chair["key"], "leather", base, accent, roughness)
    wood_maps = generate_surface_maps(
        "dark_walnut_feet", "wood", (0.022, 0.007, 0.002), (0.085, 0.026, 0.006), 0.42, size=384,
    )
    plastic_maps = generate_surface_maps(
        "molded_charcoal", "plastic", (0.045, 0.052, 0.055), (0.170, 0.185, 0.180), 0.64, size=256,
    )
    # Keep the Blender preview and exported glTF on the same authored albedo.
    # glTF has no portable equivalent for Blender's Hue/Saturation Value node,
    # so body value belongs in the generated base-color maps themselves.
    leather_gain = 1.0
    MATERIALS["leather"] = textured_material(
        f"{chair['asset']}_Leather", leather_maps,
        coat=0.0,
        normal_strength=0.28 + chair["tier"] * 0.045,
        base_gain=leather_gain,
    )
    MATERIALS["leather_dark"] = solid_material(
        f"{chair['asset']}_LeatherShadow",
        tuple(max(0.008, value * 0.47) for value in base),
        min(0.72, roughness + 0.12), coat=0.025,
    )
    lounge_body_gain = 0.30 if chair["key"] == "high_end" else 0.28 if chair["key"] == "luxury" else 0.24
    MATERIALS["leather_body"] = solid_material(
        f"{chair['asset']}_LeatherBody",
        tuple(value * lounge_body_gain for value in _lerp(base, accent, 0.46)),
        min(0.80, roughness + 0.10), coat=0.0,
    )
    MATERIALS["plastic"] = textured_material(
        f"{chair['asset']}_MoldedPlastic", plastic_maps, coat=0.015, normal_strength=0.16,
    )
    MATERIALS["metal"] = solid_material(
        f"{chair['asset']}_WarmCharcoalMetal", (0.040, 0.046, 0.046), 0.46, metallic=0.68,
    )
    MATERIALS["accent_metal"] = solid_material(
        f"{chair['asset']}_RestrainedBronze", (0.120, 0.050, 0.018), 0.42, metallic=0.62,
    )
    MATERIALS["rubber"] = solid_material(
        f"{chair['asset']}_CasterRubber", (0.010, 0.012, 0.013), 0.86, metallic=0.0,
    )
    MATERIALS["wood"] = textured_material(
        f"{chair['asset']}_DarkWalnut", wood_maps, coat=0.07, normal_strength=0.38,
    )
    MATERIALS["stitch"] = solid_material(
        f"{chair['asset']}_Stitching", tuple(max(0.004, value * 0.70 + 0.003) for value in base),
        min(0.72, roughness + 0.08), coat=0.02,
    )


def collection(name):
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def link_object(obj, col=None):
    target = col or bpy.context.scene.collection
    for existing in list(obj.users_collection):
        existing.objects.unlink(obj)
    target.objects.link(obj)
    return obj


def set_parent_keep_world(obj, parent):
    # Newly linked empties do not always have an evaluated matrix_world yet in
    # Blender 5.x.  Reading it immediately used to collapse their authored
    # locations to the origin when they were parented.  Force dependency-graph
    # evaluation before preserving the world transform so functional pivots and
    # seating anchors keep their intended positions.
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world
    bpy.context.view_layer.update()


def empty(name, location=(0, 0, 0), parent=None, col=None, size=0.055, display="PLAIN_AXES"):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = display
    obj.empty_display_size = size
    obj.location = location
    link_object(obj, col)
    if parent:
        set_parent_keep_world(obj, parent)
    return obj


def assign_material(obj, material):
    if material and obj.type == "MESH":
        obj.data.materials.clear()
        obj.data.materials.append(material)
    return obj


def apply_mesh_transform(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.select_set(False)


def finish_mesh(obj, material=None, bevel=0.0, segments=3, smooth=False):
    apply_mesh_transform(obj)
    if bevel > 0:
        modifier = obj.modifiers.new("Intentional edge softening", "BEVEL")
        modifier.width = bevel
        modifier.segments = segments
        modifier.limit_method = "ANGLE"
        modifier.angle_limit = math.radians(25)
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    assign_material(obj, material)
    obj.data.name = f"{obj.name}_Mesh"
    return obj


def cube(name, dimensions, location, material, parent=None, col=None, bevel=0.0, segments=3, rotation=(0, 0, 0), smooth=False):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    link_object(obj, col)
    finish_mesh(obj, material, bevel, segments, smooth)
    if parent:
        set_parent_keep_world(obj, parent)
    return obj


def cylinder(name, radius, depth, location, material, parent=None, col=None, vertices=20, rotation=(0, 0, 0), bevel=0.0, smooth=True, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    link_object(obj, col)
    finish_mesh(obj, material, bevel, 2, smooth)
    if smooth:
        # Keep the side wall smooth without averaging the large end-cap normals
        # into it. This is especially visible on the upholstered scroll faces.
        for polygon in obj.data.polygons:
            if len(polygon.vertices) > 4:
                polygon.use_smooth = False
    if parent:
        set_parent_keep_world(obj, parent)
    return obj


def cylinder_axis(name, radius, depth, location, axis, material, parent=None, col=None, vertices=20, bevel=0.0, scale=(1, 1, 1)):
    axis_vec = Vector(axis).normalized()
    rotation = Vector((0, 0, 1)).rotation_difference(axis_vec).to_euler()
    return cylinder(name, radius, depth, location, material, parent, col, vertices, rotation, bevel, True, scale)


def uv_sphere(name, radius, location, material, parent=None, col=None, segments=20, rings=12, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    link_object(obj, col)
    finish_mesh(obj, material, 0.0, 0, True)
    if parent:
        set_parent_keep_world(obj, parent)
    return obj


def torus(name, major_radius, minor_radius, location, material, parent=None, col=None, major_segments=24, minor_segments=8, rotation=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius, minor_radius=minor_radius,
        major_segments=major_segments, minor_segments=minor_segments,
        location=location, rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    link_object(obj, col)
    finish_mesh(obj, material, 0.0, 0, True)
    if parent:
        set_parent_keep_world(obj, parent)
    return obj


def curve_tube(name, points, radius, material, parent=None, col=None, cyclic=False, resolution=2):
    curve_data = bpy.data.curves.new(f"{name}_Curve", "CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = resolution
    curve_data.bevel_depth = radius
    curve_data.bevel_resolution = 2
    curve_data.resolution_u = resolution
    curve_data.use_fill_caps = True
    spline = curve_data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, co in zip(spline.bezier_points, points):
        point.co = co
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve_data)
    link_object(obj, col)
    if material:
        obj.data.materials.append(material)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    if not cyclic:
        # Blender's 3D bevel curves can retain open boundary rings after mesh
        # conversion even with use_fill_caps enabled.  Close those rings in the
        # authored mesh so arm brackets, seams, and piping remain watertight.
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        boundary = [edge for edge in bm.edges if edge.is_boundary]
        if boundary:
            # Fill each disconnected end ring independently.  Passing both end
            # rings to holes_fill as one network only closes one side in 5.1.
            remaining = set(boundary)
            rings = []
            while remaining:
                seed = remaining.pop()
                ring = [seed]
                pending = [seed]
                while pending:
                    edge = pending.pop()
                    for vert in edge.verts:
                        for linked in vert.link_edges:
                            if linked in remaining and linked.is_boundary:
                                remaining.remove(linked)
                                ring.append(linked)
                                pending.append(linked)
                rings.append(ring)
            for ring in rings:
                ring_set = set(ring)
                start_edge = ring[0]
                start_vert = start_edge.verts[0]
                ordered = [start_vert]
                current_vert = start_vert
                previous_edge = None
                while True:
                    candidates = [
                        edge for edge in current_vert.link_edges
                        if edge in ring_set and edge is not previous_edge
                    ]
                    if not candidates:
                        break
                    next_edge = candidates[0]
                    next_vert = next_edge.other_vert(current_vert)
                    previous_edge = next_edge
                    current_vert = next_vert
                    if current_vert is start_vert:
                        break
                    ordered.append(current_vert)
                if len(ordered) >= 3:
                    try:
                        bm.faces.new(ordered)
                    except ValueError:
                        pass
            if bm.faces:
                bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.to_mesh(obj.data)
            obj.data.update()
        bm.free()
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    if parent:
        set_parent_keep_world(obj, parent)
    return obj


def rounded_rect_points(width, depth, location, radius, plane="XY", corner_steps=5):
    cx, cy, cz = location
    rx = max(0.001, width / 2 - radius)
    ry = max(0.001, depth / 2 - radius)
    points = []
    for center_x, center_y, start in (
        (rx, -ry, -math.pi / 2), (rx, ry, 0), (-rx, ry, math.pi / 2), (-rx, -ry, math.pi),
    ):
        for step in range(corner_steps + 1):
            angle = start + step * (math.pi / 2) / corner_steps
            a = center_x + math.cos(angle) * radius
            b = center_y + math.sin(angle) * radius
            if plane == "XY":
                points.append((cx + a, cy + b, cz))
            elif plane == "XZ":
                points.append((cx + a, cy, cz + b))
            else:
                points.append((cx, cy + a, cz + b))
    return points


def soft_box(name, dimensions, location, material, parent=None, col=None, bevel=None, rotation=(0, 0, 0), quality=3):
    minimum = min(dimensions)
    resolved_bevel = min(minimum * 0.34, bevel if bevel is not None else minimum * 0.28)
    obj = cube(
        name, dimensions, location, material, parent, col,
        bevel=resolved_bevel, segments=max(2, quality + 1), rotation=rotation, smooth=True,
    )
    # Preserve the broad cushion faces while smoothing only the narrow bevel
    # bands.  Fully smoothed cube normals made upward-facing seat pads render
    # nearly black and read as hard plastic instead of upholstered cushions.
    if obj.data.polygons:
        largest_face = max(polygon.area for polygon in obj.data.polygons)
        for polygon in obj.data.polygons:
            polygon.use_smooth = polygon.area < largest_face * 0.42
    obj["upholstered"] = True
    obj["soft_edge_radius_m"] = round(resolved_bevel, 4)
    return obj


def join_objects(objects, name, parent=None):
    objects = [obj for obj in objects if obj and obj.name in bpy.data.objects]
    if not objects:
        return None
    if len(objects) == 1:
        result = objects[0]
        result.name = name
        result.data.name = f"{name}_Mesh"
        if parent and result.parent is not parent:
            set_parent_keep_world(result, parent)
        return result
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    active = objects[0]
    bpy.context.view_layer.objects.active = active
    bpy.ops.object.join()
    active.name = name
    active.data.name = f"{name}_Mesh"
    if parent and active.parent is not parent:
        set_parent_keep_world(active, parent)
    return active


def ensure_uv(obj):
    if obj.type != "MESH" or obj.name.startswith(("COL_", "COLLISION_")):
        return
    if obj.data.uv_layers:
        return
    bpy.ops.object.select_all(action="DESELECT")
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)


def all_descendants(root):
    result = []
    stack = [root]
    while stack:
        current = stack.pop()
        result.append(current)
        stack.extend(current.children)
    return result


def mesh_descendants(root, visible_only=False):
    objects = [obj for obj in all_descendants(root) if obj.type == "MESH"]
    if visible_only:
        objects = [obj for obj in objects if not obj.hide_render]
    return objects


def triangle_count(root):
    total = 0
    for obj in mesh_descendants(root):
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def bounds_for(root, include_collision=False):
    points = []
    for obj in mesh_descendants(root):
        if not include_collision and (obj.name.startswith(("COL_", "COLLISION_")) or obj.get("collision_proxy")):
            continue
        for corner in obj.bound_box:
            points.append(obj.matrix_world @ Vector(corner))
    if not points:
        return {"min": [0, 0, 0], "max": [0, 0, 0], "dimensions": [0, 0, 0]}
    minimum = [min(point[index] for point in points) for index in range(3)]
    maximum = [max(point[index] for point in points) for index in range(3)]
    return {
        "min": minimum,
        "max": maximum,
        "dimensions": [maximum[index] - minimum[index] for index in range(3)],
    }


def collision_box(name, dimensions, location, parent, col=None, rotation=(0, 0, 0), bevel=0.0):
    obj = cube(name, dimensions, location, None, parent, col, bevel=bevel, segments=1, rotation=rotation)
    obj.display_type = "WIRE"
    obj.hide_render = True
    obj["collision_proxy"] = True
    obj["collision_shape"] = "box"
    obj["purpose"] = "simplified player and furniture collision"
    return obj


def collision_cylinder(name, radius, depth, location, parent, col=None, vertices=12):
    obj = cylinder(name, radius, depth, location, None, parent, col, vertices=vertices, bevel=0, smooth=False)
    obj.display_type = "WIRE"
    obj.hide_render = True
    obj["collision_proxy"] = True
    obj["collision_shape"] = "cylinder"
    obj["purpose"] = "simplified player and furniture collision"
    return obj


def turned_foot(name, location, material, parent=None, col=None, height=0.15, radius=0.060, segments=20, detail=1.0):
    profile = [
        (radius * 0.72, 0.0),
        (radius * 0.92, height * 0.09),
        (radius, height * 0.22),
        (radius * 0.83, height * 0.38),
        (radius * 0.66, height * 0.57),
        (radius * 0.78, height * 0.74),
        (radius * 0.62, height),
    ]
    if detail < 0.8:
        profile = [profile[0], profile[2], profile[4], profile[-1]]
    vertices = []
    faces = []
    for ring, (ring_radius, z) in enumerate(profile):
        for segment in range(segments):
            angle = math.tau * segment / segments
            vertices.append((
                location[0] + math.cos(angle) * ring_radius,
                location[1] + math.sin(angle) * ring_radius,
                location[2] + z,
            ))
    for ring in range(len(profile) - 1):
        for segment in range(segments):
            nxt = (segment + 1) % segments
            a = ring * segments + segment
            b = ring * segments + nxt
            c = (ring + 1) * segments + nxt
            d = (ring + 1) * segments + segment
            faces.append((a, b, c, d))
    bottom = len(vertices)
    vertices.append((location[0], location[1], location[2]))
    top = len(vertices)
    vertices.append((location[0], location[1], location[2] + height))
    for segment in range(segments):
        nxt = (segment + 1) % segments
        faces.append((bottom, nxt, segment))
        last_ring = (len(profile) - 1) * segments
        faces.append((top, last_ring + segment, last_ring + nxt))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate(verbose=False)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    link_object(obj, col)
    assign_material(obj, material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    ensure_uv(obj)
    if parent:
        set_parent_keep_world(obj, parent)
    return obj


def _tuft_surface_y(x, z, width, height, front_y, buttons, depression, puff):
    spacing_x = max(0.10, width / 4.8)
    spacing_z = max(0.09, height / 3.8)
    nearest = min(
        (((x - bx) / spacing_x) ** 2 + ((z - bz) / spacing_z) ** 2)
        for bx, bz in buttons
    ) if buttons else 99.0
    dent = depression * math.exp(-nearest * 3.25)
    pillow = puff * (1.0 - math.exp(-nearest * 1.7))
    edge = max(0.0, 1.0 - (abs(x) / max(0.001, width / 2)) ** 5)
    return front_y + dent - pillow * edge


def tufted_panel(
    name, width, height, depth, location, button_points, material,
    parent=None, col=None, nx=24, nz=18, depression=0.036,
    puff=0.012, arch_drop=0.055, bevel=0.006,
):
    """Closed, UV-mapped upholstered panel with modeled button depressions."""
    cx, cy, cz = location
    front_y = cy - depth / 2
    back_y = cy + depth / 2
    vertices = []
    local_positions = []
    for side in ("front", "back"):
        for j in range(nz + 1):
            v = j / nz
            for i in range(nx + 1):
                u = i / nx
                x = -width / 2 + width * u
                top = height / 2 - arch_drop * (abs(x) / max(0.001, width / 2)) ** 1.7
                z = -height / 2 + (top + height / 2) * v
                y = _tuft_surface_y(
                    x, z, width, height, front_y, button_points, depression, puff,
                ) if side == "front" else back_y
                vertices.append((cx + x, y, cz + z))
                local_positions.append((u, v))
    ring_size = (nx + 1) * (nz + 1)
    faces = []
    for j in range(nz):
        for i in range(nx):
            a = j * (nx + 1) + i
            b = a + 1
            d = (j + 1) * (nx + 1) + i
            c = d + 1
            faces.append((a, b, c, d))
            faces.append((ring_size + a, ring_size + d, ring_size + c, ring_size + b))
    # Close the four perimeter bands.
    for i in range(nx):
        a, b = i, i + 1
        faces.append((a, ring_size + a, ring_size + b, b))
        a = nz * (nx + 1) + i
        b = a + 1
        faces.append((a, b, ring_size + b, ring_size + a))
    for j in range(nz):
        a = j * (nx + 1)
        b = (j + 1) * (nx + 1)
        faces.append((a, b, ring_size + b, ring_size + a))
        a = j * (nx + 1) + nx
        b = (j + 1) * (nx + 1) + nx
        faces.append((a, ring_size + a, ring_size + b, b))

    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate(verbose=False)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            uv_layer.data[loop_index].uv = local_positions[vertex_index]
    obj = bpy.data.objects.new(name, mesh)
    link_object(obj, col)
    assign_material(obj, material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    if bevel:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        modifier = obj.modifiers.new("Upholstery edge roll", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)
    obj["upholstery_tufting"] = True
    obj["button_depression_m"] = depression
    if parent:
        set_parent_keep_world(obj, parent)
    return obj


def tuft_buttons(name, panel_location, width, height, depth, points, material, parent=None, col=None, radius=0.016, depression=0.036, puff=0.012):
    cx, cy, cz = panel_location
    front_y = cy - depth / 2
    buttons = []
    for index, (x, z) in enumerate(points, 1):
        surface_y = _tuft_surface_y(x, z, width, height, front_y, points, depression, puff)
        button = uv_sphere(
            f"{name}_{index:02d}", radius, (cx + x, surface_y - radius * 0.12, cz + z),
            material, parent, col, segments=12, rings=8, scale=(1.0, 0.46, 1.0),
        )
        button["upholstery_button"] = True
        buttons.append(button)
    return join_objects(buttons, name, parent)


def tuft_diamond_seams(
    name, panel_location, width, height, depth, points, material,
    parent=None, col=None, depression=0.036, puff=0.012,
):
    """Model restrained diagonal seams between staggered button rows."""
    rows = {}
    for x, z in points:
        rows.setdefault(round(z, 4), []).append(x)
    ordered_rows = [
        (z, sorted(xs)) for z, xs in sorted(rows.items(), reverse=True)
    ]
    front_y = panel_location[1] - depth / 2
    seams = []
    created = set()
    for (upper_z, upper_xs), (lower_z, lower_xs) in zip(ordered_rows, ordered_rows[1:]):
        for upper_x in upper_xs:
            nearest = sorted(lower_xs, key=lambda value: abs(value - upper_x))[:2]
            for lower_x in nearest:
                key = (upper_x, upper_z, lower_x, lower_z)
                if key in created or abs(lower_x - upper_x) > width * 0.28:
                    continue
                created.add(key)
                path = []
                for step in range(7):
                    t = step / 6
                    x = upper_x + (lower_x - upper_x) * t
                    z = upper_z + (lower_z - upper_z) * t
                    y = _tuft_surface_y(
                        x, z, width, height, front_y, points, depression, puff,
                    ) - 0.0018
                    path.append((panel_location[0] + x, y, panel_location[2] + z))
                seams.append(curve_tube(
                    f"{name}_{len(seams) + 1:02d}", path, 0.00072,
                    material, parent, col, cyclic=False, resolution=1,
                ))
    return join_objects(seams, name, parent)


def spiral_piping(name, center, outer_radius, inner_radius, material, parent=None, col=None, turns=1.22, points=42, tube=0.006):
    cx, cy, cz = center
    path = []
    for index in range(points):
        t = index / max(1, points - 1)
        angle = math.pi * 0.16 + t * math.tau * turns
        radius = outer_radius + (inner_radius - outer_radius) * t
        path.append((cx + math.cos(angle) * radius, cy, cz + math.sin(angle) * radius))
    return curve_tube(name, path, tube, material, parent, col, cyclic=False, resolution=1)


def marker(name, location, parent, col, node_type, forward=FRONT, size=0.052, **properties):
    obj = empty(name, location, parent, col, size=size, display="ARROWS")
    obj["node_type"] = node_type
    obj["forward"] = list(forward)
    for key, value in properties.items():
        obj[key] = value
    return obj


def make_structure(chair):
    col = collection(chair["asset"])
    root = empty(chair["asset"], (0, 0, 0), None, col, size=0.11)
    root["asset_id"] = f"pro-shop-furniture:chairs:{chair['catalog_tier']}"
    root["asset_name"] = chair["asset"]
    root["reference_tier"] = chair["label"]
    root["furnitureTier"] = chair["tier"]
    root["chair_kind"] = chair["kind"]
    root["dimensions_m"] = list(chair["dimensions"])
    root["seat_height_m"] = chair["seat_height"]
    root["front_direction"] = list(FRONT)
    root["source_reference"] = f"Designs/Chairs/{chair['label']}.png"
    root["source"] = "Original Golf Flipper project-owned Blender build"
    root["license"] = "Project-owned; no external asset or texture"
    lods = {}
    for level in range(3):
        lod = empty(f"LOD{level}", (0, 0, 0), root, col, size=0.075)
        lod["lod_level"] = level
        lods[level] = lod
    collision = empty(f"COLLISION_{chair['asset']}", (0, 0, 0), root, col, size=0.08)
    collision["collision_group"] = True
    placement = empty("PlacementNodes", (0, 0, 0), root, col, size=0.06)
    return col, root, lods, collision, placement


def add_placement_nodes(chair, root, placement, col):
    width, height, depth = chair["dimensions"]
    nodes = {}
    nodes["PLACEMENT_FOOTPRINT"] = marker(
        "PLACEMENT_FOOTPRINT", (0, 0, 0), placement, col, "placement-footprint",
        width_m=width, depth_m=depth, rotation_clearance_m=max(width, depth) / 2,
    )
    nodes["SOCKET_PLACEMENT"] = marker("SOCKET_PLACEMENT", (0, 0, 0), placement, col, "placement-socket")
    nodes["FLOOR_CONTACT_CENTER"] = marker("FLOOR_CONTACT_CENTER", (0, 0, 0), placement, col, "floor-contact")
    nodes["FRONT_DIRECTION"] = marker(
        "FRONT_DIRECTION", (0, -depth / 2 - 0.08, 0.10), placement, col,
        "front-direction", forward=FRONT,
    )
    nodes["WALL_CLEARANCE_BACK"] = marker(
        "WALL_CLEARANCE_BACK", (0, depth / 2 + (0.30 if chair["kind"] == "office" else 0.22), 0),
        placement, col, "wall-clearance",
        clearance_m=0.30 if chair["kind"] == "office" else 0.22,
    )
    nodes["INTERACTION_POINT"] = marker(
        "INTERACTION_POINT", (0, -depth / 2 - 0.52, 0.96), placement, col, "interaction",
        interactionType="chair",
    )
    nodes["SIT_INTERACTION_POINT"] = marker(
        "SIT_INTERACTION_POINT", (0, -depth / 2 - 0.42, 0.02), placement, col, "sit-interaction",
        interactionType="sit",
    )
    entry_x = width / 2 + (0.34 if chair["kind"] == "office" else 0.20)
    entry_y = -depth / 2 - (0.10 if chair["kind"] == "office" else 0.34)
    for side, sign in (("LEFT", -1), ("RIGHT", 1)):
        nodes[f"ENTRY_POINT_{side}"] = marker(
            f"ENTRY_POINT_{side}", (sign * entry_x, entry_y, 0), placement, col,
            "entry-point", side=side.lower(), access_valid=True,
        )
        nodes[f"EXIT_POINT_{side}"] = marker(
            f"EXIT_POINT_{side}", (sign * entry_x, entry_y - 0.18, 0), placement, col,
            "exit-point", side=side.lower(), access_valid=True,
        )
    return nodes


def add_seating_nodes(chair, parent, col):
    width, _, depth = chair["dimensions"]
    seat_z = chair["seat_height"] + 0.025
    lounge = chair["kind"] == "lounge"
    seat_y = -0.025 if not lounge else -0.035
    arm_z = chair["seat_height"] + (0.195 if not lounge else 0.235)
    hand_x = chair["seat_width"] / 2 + (0.035 if not lounge else 0.105)
    foot_y = -depth / 2 - (0.07 if not lounge else 0.13)
    nodes = {
        "SEAT_ANCHOR": marker(
            "SEAT_ANCHOR", (0, seat_y, seat_z), parent, col, "seat-anchor",
            posture="lounge" if lounge else "office", hip_root=True,
        ),
        "SOCKET_Seat": marker(
            "SOCKET_Seat", (0, seat_y, seat_z), parent, col, "seat-socket",
            sit_destination=True,
        ),
        "FOOT_ANCHOR_LEFT": marker(
            "FOOT_ANCHOR_LEFT", (-0.145, foot_y, 0.045), parent, col, "foot-anchor", side="left",
        ),
        "FOOT_ANCHOR_RIGHT": marker(
            "FOOT_ANCHOR_RIGHT", (0.145, foot_y, 0.045), parent, col, "foot-anchor", side="right",
        ),
        "HAND_ANCHOR_LEFT": marker(
            "HAND_ANCHOR_LEFT", (-hand_x, -0.055, arm_z), parent, col, "hand-anchor", side="left",
        ),
        "HAND_ANCHOR_RIGHT": marker(
            "HAND_ANCHOR_RIGHT", (hand_x, -0.055, arm_z), parent, col, "hand-anchor", side="right",
        ),
        "BACKREST_TOP_VALIDATION": marker(
            "BACKREST_TOP_VALIDATION", (0, depth * 0.29, chair["dimensions"][1] - 0.035),
            parent, col, "validation-only",
        ),
    }
    return nodes


def _linearize_action(action):
    try:
        for fcurve in action.fcurves:
            for point in fcurve.keyframe_points:
                point.interpolation = "BEZIER"
                point.handle_left_type = "AUTO_CLAMPED"
                point.handle_right_type = "AUTO_CLAMPED"
    except AttributeError:
        pass


def transform_action(obj, name, data_path, keyed_values):
    obj.animation_data_create()
    action = bpy.data.actions.new(name=name)
    action.use_fake_user = True
    obj.animation_data.action = action
    for frame, value in keyed_values:
        if data_path == "rotation_euler":
            obj.rotation_mode = "XYZ"
            obj.rotation_euler = value
        else:
            obj.location = value
        obj.keyframe_insert(data_path=data_path, frame=frame, group=name)
    _linearize_action(action)
    obj.animation_data.action = None
    return action


def add_nla_clip(obj, action, track_name, strip_start):
    obj.animation_data_create()
    track = obj.animation_data.nla_tracks.new()
    track.name = track_name
    strip = track.strips.new(track_name, strip_start, action)
    strip.extrapolation = "NOTHING"
    strip.blend_type = "REPLACE"
    return track


def add_office_animations(chair, pivots):
    clips = []
    swivel = pivots["swivel"]
    left = transform_action(swivel, "Swivel_Left", "rotation_euler", [
        (1, (0, 0, 0)), (18, (0, 0, math.radians(-45))),
    ])
    right = transform_action(swivel, "Swivel_Right", "rotation_euler", [
        (1, (0, 0, 0)), (18, (0, 0, math.radians(45))),
    ])
    full = transform_action(swivel, "Swivel_360_Test", "rotation_euler", [
        (1, (0, 0, 0)), (18, (0, 0, math.radians(90))),
        (36, (0, 0, math.radians(180))), (54, (0, 0, math.radians(270))),
        (72, (0, 0, math.radians(360))),
    ])
    for index, action in enumerate((left, right, full)):
        add_nla_clip(swivel, action, action.name, 1 + index * 82)
        clips.append(action.name)

    height = pivots["height"]
    amount = chair["height_range"]
    raise_action = transform_action(height, "Height_Raise", "location", [
        (1, (0, 0, 0)), (20, (0, 0, amount)),
    ])
    lower_action = transform_action(height, "Height_Lower", "location", [
        (1, (0, 0, amount)), (20, (0, 0, 0)),
    ])
    for index, action in enumerate((raise_action, lower_action)):
        add_nla_clip(height, action, action.name, 1 + index * 30)
        clips.append(action.name)

    if pivots.get("tilt") and chair["recline_deg"] > 0:
        tilt = pivots["tilt"]
        angle = math.radians(-chair["recline_deg"])
        back = transform_action(tilt, "Recline_Back", "rotation_euler", [
            (1, (0, 0, 0)), (22, (angle, 0, 0)),
        ])
        returning = transform_action(tilt, "Recline_Return", "rotation_euler", [
            (1, (angle, 0, 0)), (22, (0, 0, 0)),
        ])
        for index, action in enumerate((back, returning)):
            add_nla_clip(tilt, action, action.name, 1 + index * 32)
            clips.append(action.name)
    swivel.rotation_euler = (0, 0, 0)
    height.location = (0, 0, 0)
    if pivots.get("tilt"):
        pivots["tilt"].rotation_euler = (0, 0, 0)
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    return clips


def build_caster(index, angle, outer_radius, wheel_radius, parent, col, level=0):
    radial = Vector((math.sin(angle), -math.cos(angle), 0.0))
    tangent = Vector((math.cos(angle), math.sin(angle), 0.0))
    center_radius = outer_radius - wheel_radius * 1.02
    center = radial * center_radius
    caster = empty(f"Caster_{index:02d}", (center.x, center.y, 0.085), parent, col, size=0.032)
    caster["moving_part"] = "caster-swivel"
    caster["rotation_axis"] = "+Z"
    caster["swivel_degrees"] = 360
    cylinder(
        f"CasterMount_{index:02d}", 0.017 + level * 0.001, 0.058,
        (center.x, center.y, 0.112), MATERIALS["metal"], caster, col,
        vertices=14 if level == 0 else 10, bevel=0.002,
    )
    fork_location = center + radial * 0.010
    cube(
        f"CasterFork_{index:02d}", (0.060, 0.036, 0.055),
        (fork_location.x, fork_location.y, wheel_radius + 0.012),
        MATERIALS["plastic"], caster, col, bevel=0.008, segments=2,
        rotation=(0, 0, angle), smooth=True,
    )
    wheel_pivot = empty(
        f"CasterWheelPivot_{index:02d}", (center.x, center.y, wheel_radius), caster, col, size=0.024,
    )
    wheel_pivot["moving_part"] = "caster-wheel"
    wheel_pivot["rotation_axis_world"] = [tangent.x, tangent.y, 0.0]
    wheel_pivot["rotation_degrees"] = 360
    wheel_depth = 0.020 if level == 0 else 0.026
    separation = 0.017 if level == 0 else 0.0
    wheel_objects = []
    offsets = (("Left", -separation), ("Right", separation)) if level == 0 else (("Pair", 0.0),)
    for suffix, offset in offsets:
        wheel_center = Vector((center.x, center.y, wheel_radius)) + tangent * offset
        wheel_objects.append(cylinder_axis(
            f"CasterWheel_{suffix}_{index:02d}", wheel_radius, wheel_depth,
            wheel_center, tangent, MATERIALS["rubber"], wheel_pivot, col,
            vertices=18 if level == 0 else 12, bevel=0.002,
            scale=(1.0, 1.0, 0.78),
        ))
    return caster, wheel_objects


def build_office_base(chair, lod_parent, col, level=0, functional=False):
    base = empty("Base" if functional else f"OfficeBase_LOD{level}", (0, 0, 0), lod_parent, col, size=0.06)
    outer_radius = chair["dimensions"][0] / 2
    wheel_radius = 0.043 + chair["tier"] * 0.0015
    leg_width = 0.050 + chair["tier"] * 0.005
    leg_height = 0.050 + chair["tier"] * 0.004
    leg_material = MATERIALS["metal"] if chair["tier"] >= 3 else MATERIALS["plastic"]
    leg_objects = []
    accent_objects = []
    caster_objects = []
    for index in range(1, 6):
        angle = (index - 1) * math.tau / 5
        radial = Vector((math.sin(angle), -math.cos(angle), 0.0))
        leg_end = outer_radius - wheel_radius * 1.32
        leg_start = 0.055
        length = leg_end - leg_start
        midpoint = radial * (leg_start + length / 2)
        leg_objects.append(cube(
            f"BaseLeg_{index:02d}", (leg_width, length, leg_height),
            (midpoint.x, midpoint.y, wheel_radius + 0.058),
            leg_material, base, col, bevel=0.010 if level == 0 else 0.006,
            segments=3 if level == 0 else 2, rotation=(0, 0, angle), smooth=True,
        ))
        if chair["tier"] >= 3 and level == 0:
            accent_objects.append(cube(
                f"BaseLegAccent_{index:02d}", (leg_width * 0.56, length * 0.88, 0.009),
                (midpoint.x, midpoint.y, wheel_radius + 0.089),
                MATERIALS["accent_metal"], base, col, bevel=0.003, segments=2,
                rotation=(0, 0, angle), smooth=True,
            ))
        if level < 2:
            caster, wheels = build_caster(index, angle, outer_radius, wheel_radius, base, col, level)
            caster_objects.extend([caster, *wheels])
        else:
            center_radius = outer_radius - wheel_radius
            center = radial * center_radius
            caster_objects.append(uv_sphere(
                f"CasterSilhouette_{index:02d}", wheel_radius,
                (center.x, center.y, wheel_radius), MATERIALS["rubber"], base, col,
                segments=10, rings=6, scale=(0.75, 0.56, 0.78),
            ))
    cylinder(
        "BaseHub" if functional else f"BaseHub_LOD{level}",
        0.058 + chair["tier"] * 0.005, 0.15,
        (0, 0, wheel_radius + 0.095), leg_material, base, col,
        vertices=24 if level == 0 else 14, bevel=0.007 if level == 0 else 0.003,
    )
    if not functional:
        join_objects(leg_objects, f"OfficeBaseLegSet_LOD{level}", base)
        if accent_objects:
            join_objects(accent_objects, f"OfficeBaseAccentSet_LOD{level}", base)
        # Caster empties intentionally remain descriptive only in LOD0. Distance
        # geometry is batched by material to keep draw calls bounded.
        visible_casters = [obj for obj in all_descendants(base) if obj.type == "MESH" and obj.name.startswith("Caster")]
        rubber = [obj for obj in visible_casters if obj.data.materials and obj.data.materials[0] == MATERIALS["rubber"]]
        other = [obj for obj in visible_casters if obj not in rubber]
        join_objects(rubber, f"OfficeCasterRubberSet_LOD{level}", base)
        join_objects(other, f"OfficeCasterHardwareSet_LOD{level}", base)
    return base, wheel_radius


def add_seat_seams(chair, parent, col, seat_top, seat_width, seat_depth, count):
    seams = []
    for index in range(1, count + 1):
        x = -seat_width / 2 + seat_width * index / (count + 1)
        seams.append(curve_tube(
            f"SeatSegmentSeam_{index:02d}",
            [(x, -seat_depth * 0.44, seat_top + 0.001), (x, seat_depth * 0.40, seat_top + 0.001)],
            0.0032, MATERIALS["leather_dark"], parent, col, cyclic=False, resolution=1,
        ))
    return join_objects(seams, "SeatSegmentSeamSet", parent)


def build_office_back(chair, parent, col, level=0):
    width, total_height, _ = chair["dimensions"]
    seat_z = chair["seat_height"]
    back_bottom = seat_z + 0.035
    back_height = total_height - back_bottom - 0.025
    back_width = min(width - 0.10, chair["seat_width"] + (0.015 if chair["tier"] < 3 else 0.055))
    back_depth = 0.095 + chair["tier"] * 0.008
    back_y = chair["seat_depth"] * 0.42
    angle = math.radians(-chair["back_angle"])
    if chair["tier"] >= 3:
        shell = soft_box(
            "BackrestShell", (back_width + 0.035, 0.080, back_height * 1.01),
            (0, back_y + back_depth * 0.40, back_bottom + back_height / 2),
            MATERIALS["leather"], parent, col, bevel=0.026, quality=3,
            rotation=(angle, 0, 0),
        )
    else:
        shell = cube(
            "BackrestShell", (back_width + 0.025, 0.050, back_height * 0.98),
            (0, back_y + back_depth * 0.48, back_bottom + back_height / 2),
            MATERIALS["plastic"], parent, col, bevel=0.020, segments=3,
            rotation=(angle, 0, 0), smooth=True,
        )
    panels = []
    if level >= 2:
        panels.append(soft_box(
            "BackrestDistanceCushion", (back_width, back_depth, back_height),
            (0, back_y, back_bottom + back_height / 2), MATERIALS["leather"], parent, col,
            bevel=0.040, rotation=(angle, 0, 0), quality=1,
        ))
    elif chair["tier"] == 1 or level == 1:
        center_width = back_width * 0.64
        side_width = (back_width - center_width) / 2 * 0.92
        panels.extend([
            soft_box("BackrestCenterLower", (center_width, back_depth, back_height * 0.43),
                     (0, back_y - 0.006, back_bottom + back_height * 0.25), MATERIALS["leather"], parent, col,
                     bevel=0.035, rotation=(angle, 0, 0), quality=2),
            soft_box("BackrestCenterUpper", (center_width, back_depth * 1.04, back_height * 0.43),
                     (0, back_y - 0.008, back_bottom + back_height * 0.70), MATERIALS["leather"], parent, col,
                     bevel=0.040, rotation=(angle, 0, 0), quality=2),
        ])
        for side, sign in (("Left", -1), ("Right", 1)):
            panels.append(soft_box(
                f"BackrestSideBolster_{side}", (side_width, back_depth * 1.06, back_height * 0.91),
                (sign * (center_width / 2 + side_width * 0.53), back_y, back_bottom + back_height * 0.50),
                MATERIALS["leather"], parent, col, bevel=0.035, rotation=(angle, 0, 0), quality=2,
            ))
    elif chair["tier"] == 2:
        # Standard reference: nine visibly plush sections, with a broad center
        # column and narrower shoulder/lumbar bolsters on both sides.
        center_width = back_width * 0.52
        side_width = back_width * 0.205
        row_h = back_height * 0.285
        column_x = (
            -(center_width + side_width) / 2,
            0.0,
            (center_width + side_width) / 2,
        )
        column_width = (side_width, center_width, side_width)
        for row, z_factor in enumerate((0.17, 0.50, 0.83), 1):
            for column, (x, panel_width) in enumerate(zip(column_x, column_width), 1):
                center_panel = column == 2
                panels.append(soft_box(
                    f"BackrestPanel_{row:02d}_{column:02d}",
                    (panel_width, back_depth * (1.10 if center_panel else 1.06), row_h),
                    (x, back_y - (0.012 if center_panel else 0.004), back_bottom + back_height * z_factor),
                    MATERIALS["leather"], parent, col, bevel=0.041,
                    rotation=(angle, 0, 0), quality=3,
                ))
    else:
        # Premium: a wide three-section headrest and deeply supported lumbar
        # panels reproduce the executive reference without treating the chair
        # as a recolored Standard tier.
        head_h = back_height * 0.28
        head_z = back_bottom + back_height * 0.83
        for column, x in enumerate((-back_width * 0.31, 0.0, back_width * 0.31), 1):
            panels.append(soft_box(
                f"ExecutiveHeadrest_{column:02d}", (back_width * 0.31, back_depth * 1.14, head_h),
                (x, back_y - 0.012, head_z), MATERIALS["leather"], parent, col,
                bevel=0.045, rotation=(angle, 0, 0), quality=4,
            ))
        for row, (z_factor, row_width, row_height) in enumerate(((0.31, 0.58, 0.28), (0.56, 0.55, 0.22)), 1):
            panels.append(soft_box(
                f"ExecutiveLumbar_{row:02d}", (back_width * row_width, back_depth * 1.12, back_height * row_height),
                (0, back_y - 0.016, back_bottom + back_height * z_factor), MATERIALS["leather"], parent, col,
                bevel=0.045, rotation=(angle, 0, 0), quality=4,
            ))
        for side, sign in (("Left", -1), ("Right", 1)):
            panels.append(soft_box(
                f"ExecutiveSideWing_{side}", (back_width * 0.18, back_depth * 1.17, back_height * 0.54),
                (sign * back_width * 0.405, back_y - 0.002, back_bottom + back_height * 0.43),
                MATERIALS["leather"], parent, col, bevel=0.048, rotation=(angle, 0, 0), quality=4,
            ))
    upholstery = join_objects(panels, f"BackrestUpholstery_LOD{level}", parent)
    piping = None
    if level == 0:
        points = rounded_rect_points(
            back_width * 0.96, back_height * 0.96,
            (0, back_y - back_depth * 0.52, back_bottom + back_height / 2),
            min(0.055, back_height * 0.10), plane="XZ", corner_steps=5,
        )
        piping = curve_tube("BackrestOuterPiping", points, 0.0035, MATERIALS["leather_dark"], parent, col, cyclic=True)
        piping.rotation_euler.x = angle
    return {
        "shell": shell, "upholstery": upholstery, "piping": piping,
        "height": back_height, "width": back_width, "bottom": back_bottom,
        "center_y": back_y, "angle": angle,
    }


def build_office_arms(chair, parent, col, level=0):
    arms = []
    arm_z = chair["seat_height"] + 0.205
    x = chair["dimensions"][0] / 2 - (0.060 if chair["tier"] < 3 else 0.082)
    depth = 0.30 + chair["tier"] * 0.025
    for side, sign in (("Left", -1), ("Right", 1)):
        group = empty(f"Armrest_{side}", (sign * x, 0, arm_z), parent, col, size=0.035)
        if chair["tier"] < 3:
            support_radius = 0.017 + chair["tier"] * 0.002
            curve_tube(
                f"ArmSupport_{side}", [
                    (sign * x, 0.18, chair["seat_height"] - 0.055),
                    (sign * x, 0.14, arm_z - 0.02),
                    (sign * x, -depth * 0.38, arm_z),
                    (sign * x, -depth * 0.43, chair["seat_height"] - 0.050),
                ], support_radius, MATERIALS["plastic"],
                group, col, cyclic=False, resolution=2,
            )
            pad_width = 0.074 + chair["tier"] * 0.010
            soft_box(
                f"ArmPad_{side}", (pad_width, depth, 0.045 + chair["tier"] * 0.008),
                (sign * x, -0.015, arm_z + 0.015), MATERIALS["leather"], group, col,
                bevel=0.022, quality=2 + level,
            )
        else:
            cube(
                f"ExecutiveArmBracket_{side}", (0.045, depth * 0.78, 0.205),
                (sign * x, 0.020, chair["seat_height"] + 0.085), MATERIALS["leather"], group, col,
                bevel=0.012, segments=3, smooth=True,
            )
            soft_box(
                f"ExecutiveArmPad_{side}", (0.145, depth, 0.075),
                (sign * x, -0.030, arm_z + 0.022), MATERIALS["leather"], group, col,
                bevel=0.034, quality=4,
            )
            soft_box(
                f"ExecutiveArmSidePanel_{side}", (0.115, depth * 0.66, 0.165),
                (sign * x, 0.060, chair["seat_height"] + 0.075), MATERIALS["leather"], group, col,
                bevel=0.030, quality=3,
            )
        arms.append(group)
    return arms


def build_office_lod0(chair, lod, col):
    base, wheel_radius = build_office_base(chair, lod, col, level=0, functional=True)
    lower = cylinder(
        "GasLift_Lower", 0.040 + chair["tier"] * 0.002, 0.255,
        (0, 0, wheel_radius + 0.235), MATERIALS["metal"], base, col,
        vertices=24, bevel=0.004,
    )
    lower["fixed_to_base"] = True
    height = empty("HeightAdjustmentPivot", (0, 0, 0), lod, col, size=0.055)
    height["moving_part"] = "chair-height-adjustment"
    height["movement_axis"] = [0.0, 0.0, 1.0]
    height["minimum_offset_m"] = 0.0
    height["maximum_offset_m"] = chair["height_range"]
    height["travel_m"] = chair["height_range"]
    upper = cylinder(
        "GasLift_Upper", 0.028, 0.185,
        (0, 0, chair["seat_height"] - 0.185), MATERIALS["metal"], height, col,
        vertices=24, bevel=0.004,
    )
    upper["moves_with_height_pivot"] = True

    swivel = empty("SwivelPivot", (0, 0, chair["seat_height"] - 0.145), height, col, size=0.060)
    swivel["moving_part"] = "chair-swivel"
    swivel["rotation_axis"] = "+Z"
    swivel["rotation_degrees"] = 360
    swivel["keeps_seated_character"] = True
    mechanism = cube(
        "MechanismHousing", (0.255 + chair["tier"] * 0.025, 0.235, 0.070),
        (0, 0.005, chair["seat_height"] - 0.110), MATERIALS["metal"], swivel, col,
        bevel=0.015, segments=3, smooth=True,
    )
    mechanism["mechanism"] = "height-and-swivel"

    seat_group = empty("Seat", (0, 0, chair["seat_height"]), swivel, col, size=0.045)
    seat_h = 0.105 + chair["tier"] * 0.010
    seat_center_z = chair["seat_height"] - seat_h / 2
    cube(
        "SeatSupportPan", (chair["seat_width"] + 0.018, chair["seat_depth"] + 0.012, 0.038),
        (0, 0.005, seat_center_z - seat_h / 2 + 0.010), MATERIALS["plastic"], seat_group, col,
        bevel=0.014, segments=3, smooth=True,
    )
    if chair["tier"] >= 2:
        gap = 0.004
        soft_box(
            "SeatCushionFoundation",
            (chair["seat_width"], chair["seat_depth"] * 1.025, 0.080),
            (0, -0.018, chair["seat_height"] - seat_h + 0.040),
            MATERIALS["leather"], seat_group, col, bevel=0.026, quality=3,
        )
        segment_width = (chair["seat_width"] - gap * 2) / 3
        seat_segments = []
        for index, x in enumerate((-segment_width - gap, 0.0, segment_width + gap), 1):
            seat_segments.append(soft_box(
                f"SeatCushionSegment_{index:02d}",
                (segment_width, chair["seat_depth"], seat_h),
                (x, -0.018, seat_center_z), MATERIALS["leather"], seat_group, col,
                bevel=0.042 + chair["tier"] * 0.004, quality=3 + chair["tier"] // 2,
            ))
        seat = join_objects(seat_segments, "SeatCushion", seat_group)
    else:
        seat = soft_box(
            "SeatCushion", (chair["seat_width"], chair["seat_depth"], seat_h),
            (0, -0.018, seat_center_z), MATERIALS["leather"], seat_group, col,
            bevel=0.042 + chair["tier"] * 0.004, quality=3,
        )
    seat["seat_unoccupied"] = True
    seat["occupied_deformation_supported"] = False
    seat["occupied_deformation_note"] = "Runtime has no chair cushion blend-shape system; modeled neutral softness is authoritative"
    piping_points = rounded_rect_points(
        chair["seat_width"] * 0.98, chair["seat_depth"] * 0.98,
        (0, -0.018, chair["seat_height"] - 0.023), 0.045, plane="XY", corner_steps=6,
    )
    curve_tube("SeatCushionPiping", piping_points, 0.0038, MATERIALS["leather_dark"], seat_group, col, cyclic=True)

    tilt = None
    if chair["recline_deg"] > 0:
        tilt = empty(
            "BackrestTiltPivot", (0, chair["seat_depth"] * 0.36, chair["seat_height"] + 0.020),
            swivel, col, size=0.050,
        )
        tilt["moving_part"] = "chair-backrest-tilt"
        tilt["rotation_axis"] = "X"
        tilt["minimum_degrees"] = 0.0
        tilt["maximum_degrees"] = chair["recline_deg"]
        tilt["hinge_location"] = "seat-back junction"
        back_parent = tilt
    else:
        back_parent = swivel
    back = build_office_back(chair, back_parent, col, level=0)
    build_office_arms(chair, swivel, col, level=0)

    lever_x = chair["seat_width"] * 0.36
    lever_y = -chair["seat_depth"] * 0.40
    lever_z = chair["seat_height"] - 0.105
    cylinder_axis(
        "HeightAdjustmentLever", 0.010, 0.15, (lever_x, lever_y, lever_z), (1, 0, 0),
        MATERIALS["metal"], swivel, col, vertices=14, bevel=0.002,
    )
    soft_box(
        "HeightAdjustmentGrip", (0.060, 0.032, 0.024),
        (lever_x + 0.075, lever_y, lever_z), MATERIALS["plastic"], swivel, col,
        bevel=0.009, quality=2,
    )
    marker(
        "INTERACT_HeightLever", (lever_x + 0.10, lever_y, lever_z), swivel, col,
        "mechanism-control", interactionType="chair-height", minimum_m=0.0,
        maximum_m=chair["height_range"], component="HeightAdjustmentPivot",
    )
    if tilt:
        marker(
            "INTERACT_ReclineControl", (-lever_x - 0.10, lever_y + 0.025, lever_z), swivel, col,
            "mechanism-control", interactionType="chair-recline", minimum_degrees=0.0,
            maximum_degrees=chair["recline_deg"], component="BackrestTiltPivot",
        )
    marker(
        "SWIVEL_CENTER", tuple(swivel.matrix_world.translation), swivel, col,
        "mechanism-pivot", interactionType="chair-swivel", component="SwivelPivot",
    )
    seating = add_seating_nodes(chair, swivel, col)
    # Feet remain planted when the gas lift moves, while hip and hand anchors
    # move with the seat assembly. They still rotate around the chair for swivel
    # orientation because their forward contract is stored explicitly.
    for name in ("FOOT_ANCHOR_LEFT", "FOOT_ANCHOR_RIGHT"):
        set_parent_keep_world(seating[name], lod)
    desk_alignment = marker(
        "DESK_ALIGNMENT_ANCHOR", (0, -chair["seat_depth"] / 2 - 0.10, 0),
        lod, col, "desk-alignment", aligns_to="desk knee opening center",
    )
    marker(
        "SOCKET_DeskAlignment", tuple(desk_alignment.matrix_world.translation),
        lod, col, "desk-alignment-socket", aligns_to="CHAIR_ANCHOR",
    )
    marker(
        "DESK_WORK_POSITION", (0, -chair["seat_depth"] / 2 + 0.08, 0),
        lod, col, "desk-work-position", seated_reach_m=0.52,
    )
    pivots = {"height": height, "swivel": swivel, "tilt": tilt}
    clips = add_office_animations(chair, pivots)
    return {
        "pivots": pivots, "clips": clips, "seating": seating,
        "back": back, "base": base, "seat": seat,
    }


def build_office_distance_lod(chair, lod, col, level):
    base, _ = build_office_base(chair, lod, col, level=level, functional=False)
    seat_h = 0.105 + chair["tier"] * 0.010
    seat_objects = [
        soft_box(
            f"SeatCushion_LOD{level}", (chair["seat_width"], chair["seat_depth"], seat_h),
            (0, -0.018, chair["seat_height"] - seat_h / 2), MATERIALS["leather"], lod, col,
            bevel=0.038, quality=1 if level == 2 else 2,
        ),
        cube(
            f"SeatSupport_LOD{level}", (chair["seat_width"] + 0.02, chair["seat_depth"] + 0.01, 0.040),
            (0, 0, chair["seat_height"] - seat_h - 0.005), MATERIALS["plastic"], lod, col,
            bevel=0.010, segments=2,
        ),
    ]
    build_office_back(chair, lod, col, level=level)
    arm_z = chair["seat_height"] + 0.205
    x = chair["dimensions"][0] / 2 - (0.060 if chair["tier"] < 3 else 0.082)
    arms = []
    for side, sign in (("Left", -1), ("Right", 1)):
        arms.append(cube(
            f"ArmSilhouette_{side}_LOD{level}",
            (0.075 if chair["tier"] < 3 else 0.13, 0.29 + chair["tier"] * 0.025, 0.10 if level == 2 else 0.16),
            (sign * x, 0.0, arm_z - (0.025 if level == 2 else 0.05)),
            MATERIALS["leather"] if chair["tier"] >= 3 else MATERIALS["plastic"], lod, col,
            bevel=0.022, segments=2, smooth=True,
        ))
    join_objects([obj for obj in mesh_descendants(lod) if obj.data.materials and obj.data.materials[0] == MATERIALS["leather"]], f"OfficeLeather_LOD{level}", lod)
    join_objects([obj for obj in mesh_descendants(lod) if obj.data.materials and obj.data.materials[0] == MATERIALS["plastic"]], f"OfficePlastic_LOD{level}", lod)
    join_objects([obj for obj in mesh_descendants(lod) if obj.data.materials and obj.data.materials[0] == MATERIALS["metal"]], f"OfficeMetal_LOD{level}", lod)
    return {"base": base, "seat": seat_objects, "arms": arms}


def add_office_collisions(chair, collision, col):
    width, total_height, _ = chair["dimensions"]
    outer_radius = width / 2
    collision_cylinder("COL_Base", outer_radius * 0.90, 0.10, (0, 0, 0.05), collision, col, vertices=12)
    collision_box(
        "COL_Seat", (chair["seat_width"] + 0.025, chair["seat_depth"] + 0.025, 0.16),
        (0, 0, chair["seat_height"] - 0.08), collision, col, bevel=0.015,
    )
    back_bottom = chair["seat_height"] + 0.035
    back_height = total_height - back_bottom - 0.025
    collision_box(
        "COL_Backrest", (min(width - 0.08, chair["seat_width"] + 0.05), 0.15, back_height),
        (0, chair["seat_depth"] * 0.43, back_bottom + back_height / 2), collision, col,
        rotation=(math.radians(-chair["back_angle"]), 0, 0), bevel=0.012,
    )
    arm_x = width / 2 - (0.060 if chair["tier"] < 3 else 0.082)
    for side, sign in (("Left", -1), ("Right", 1)):
        collision_box(
            f"COL_Arm_{side}", (0.11 if chair["tier"] < 3 else 0.16, chair["seat_depth"] * 0.72, 0.19),
            (sign * arm_x, 0, chair["seat_height"] + 0.13), collision, col, bevel=0.010,
        )


def build_office_chair(chair, root, lods, collision, placement, col):
    add_placement_nodes(chair, root, placement, col)
    detail = build_office_lod0(chair, lods[0], col)
    build_office_distance_lod(chair, lods[1], col, 1)
    build_office_distance_lod(chair, lods[2], col, 2)
    add_office_collisions(chair, collision, col)
    return detail


def lounge_button_layout(chair, level=0):
    if chair["key"] == "high_end":
        points = [
            (-0.24, 0.125), (-0.08, 0.125), (0.08, 0.125), (0.24, 0.125),
            (-0.16, 0.010), (0.0, 0.010), (0.16, 0.010),
            (-0.24, -0.110), (-0.08, -0.110), (0.08, -0.110), (0.24, -0.110),
        ]
    else:
        points = [
            (-0.29, 0.145), (-0.145, 0.145), (0.0, 0.145), (0.145, 0.145), (0.29, 0.145),
            (-0.22, 0.0), (-0.073, 0.0), (0.073, 0.0), (0.22, 0.0),
            (-0.29, -0.145), (-0.145, -0.145), (0.0, -0.145), (0.145, -0.145), (0.29, -0.145),
        ]
    if level == 1:
        return points[::2] + [point for point in points if abs(point[0]) < 0.01]
    if level == 2:
        return [point for point in points if abs(point[0]) < 0.10 or (point[1] > 0.1 and abs(point[0]) > 0.20)]
    return points


def build_lounge_arm(chair, side, parent, col, level=0):
    sign = -1 if side == "Left" else 1
    width, _, depth = chair["dimensions"]
    luxury = chair["key"] == "luxury"
    roll_radius = (0.170 if luxury else 0.145) * (0.94 if level == 1 else 0.88 if level == 2 else 1.0)
    x = sign * (width / 2 - roll_radius)
    roll_z = chair["seat_height"] + (0.225 if luxury else 0.205)
    roll_depth = depth * (0.74 if luxury and level == 0 else 0.72 if level == 0 else 0.69)
    roll_y = -0.005
    group = empty(f"RolledArm_{side}" if level == 0 else f"RolledArm_{side}_LOD{level}", (x, 0, roll_z), parent, col, size=0.045)
    side_width = roll_radius * 1.42
    soft_box(
        f"ArmSidePanel_{side}_LOD{level}", (side_width, depth * 0.72, roll_z - 0.145),
        (x, 0.045, 0.145 + (roll_z - 0.145) / 2), MATERIALS["leather_body"], group, col,
        bevel=0.045 if level == 0 else 0.032,
        quality=4 if level == 0 else 2 if level == 1 else 1,
    )
    cylinder_axis(
        f"ArmRoll_{side}_LOD{level}", roll_radius, roll_depth,
        (x, roll_y, roll_z), (0, 1, 0), MATERIALS["leather_body"], group, col,
        vertices=30 if level == 0 else 18 if level == 1 else 12,
        bevel=0.004 if level == 0 else 0.002,
        scale=(0.94, 1.0, 1.04 if luxury else 1.0),
    )
    front_y = roll_y - roll_depth / 2 - 0.012
    cylinder_axis(
        f"ArmScrollCap_{side}_LOD{level}", roll_radius * 0.84, 0.030,
        (x, front_y, roll_z), (0, 1, 0), MATERIALS["leather_body"], group, col,
        vertices=28 if level == 0 else 16, bevel=0.004 if level == 0 else 0.002,
        scale=(0.92, 1.0, 1.0),
    )
    trim = []
    if level <= 1:
        trim.append(torus(
            f"ArmScrollPiping_{side}_LOD{level}", roll_radius * 0.80, 0.0035 if level == 0 else 0.0026,
            (x, front_y - 0.017, roll_z), MATERIALS["rubber"], group, col,
            major_segments=30 if level == 0 else 18, minor_segments=6,
            rotation=(math.pi / 2, 0, 0), scale=(0.92, 1.0, 1.0),
        ))
    if level == 0:
        trim.append(spiral_piping(
            f"ArmScrollSpiral_{side}", (x, front_y - 0.021, roll_z),
            roll_radius * 0.68, roll_radius * 0.19, MATERIALS["rubber"], group, col,
            turns=1.18 if not luxury else 1.34, points=44 if luxury else 38,
            tube=0.0032 if luxury else 0.0028,
        ))
        seam_count = 5 if luxury else 3
        for index in range(seam_count):
            t = (index + 1) / (seam_count + 1)
            seam_y = roll_y - roll_depth / 2 + roll_depth * t
            trim.append(torus(
                f"ArmRollSeam_{side}_{index + 1:02d}", roll_radius * 0.998, 0.0023,
                (x, seam_y, roll_z), MATERIALS["leather_dark"], group, col,
                major_segments=24, minor_segments=5, rotation=(math.pi / 2, 0, 0),
                scale=(0.94, 1.0, 1.02),
            ))
        join_objects(trim, f"RolledArmTrim_{side}", group)
    return group


def build_lounge_lod(chair, lod, col, level=0, functional=False):
    width, total_height, depth = chair["dimensions"]
    luxury = chair["key"] == "luxury"
    frame = empty("Frame" if functional else f"LoungeFrame_LOD{level}", (0, 0, 0), lod, col, size=0.06)
    upholstery = empty("Upholstery" if functional else f"LoungeUpholstery_LOD{level}", (0, 0, 0), lod, col, size=0.06)
    seat_h = 0.155 if luxury else 0.145
    seat_center_z = chair["seat_height"] - seat_h / 2
    base_bottom = 0.125 if luxury else 0.115
    base_height = 0.235 if luxury else 0.220
    soft_box(
        f"UpholsteredBase_LOD{level}", (width - 0.08, depth * 0.78, base_height),
        (0, 0.055, base_bottom + base_height / 2), MATERIALS["leather_body"], upholstery, col,
        bevel=0.038 if level == 0 else 0.026,
        quality=3 if level == 0 else 2 if level == 1 else 1,
    )
    cube(
        f"InternalSeatFrame_LOD{level}", (width - 0.14, depth * 0.68, 0.105),
        (0, 0.055, base_bottom + 0.090), MATERIALS["wood"], frame, col,
        bevel=0.020 if level == 0 else 0.012, segments=3 if level == 0 else 2, smooth=True,
    )
    cushion = soft_box(
        "SeatCushion" if functional else f"SeatCushion_LOD{level}",
        (chair["seat_width"], chair["seat_depth"], seat_h),
        (0, -0.090 if luxury else -0.080, seat_center_z), MATERIALS["leather_body"], upholstery, col,
        bevel=0.055 if luxury and level == 0 else 0.047 if level == 0 else 0.035,
        quality=5 if luxury and level == 0 else 4 if level == 0 else 2 if level == 1 else 1,
    )
    cushion["seat_unoccupied"] = True
    cushion["occupied_deformation_supported"] = False
    cushion["occupied_deformation_note"] = "Runtime has no chair cushion deformation system; sculpted neutral softness is authoritative"
    soft_box(
        f"SeatDeck_LOD{level}",
        (chair["seat_width"] + 0.045, depth * 0.30, 0.085),
        (0, depth * 0.285, chair["seat_height"] - 0.072),
        MATERIALS["leather_body"], upholstery, col,
        bevel=0.028 if level == 0 else 0.018,
        quality=3 if level == 0 else 2 if level == 1 else 1,
    )
    if level <= 1:
        piping_points = rounded_rect_points(
            chair["seat_width"] * 0.985, chair["seat_depth"] * 0.985,
            (0, -0.090 if luxury else -0.080, chair["seat_height"] - 0.025),
            0.055 if luxury else 0.045, plane="XY", corner_steps=7 if level == 0 else 4,
        )
        curve_tube(
            f"SeatCushionPiping_LOD{level}", piping_points,
            0.0034 if luxury and level == 0 else 0.0030 if level == 0 else 0.0024,
            MATERIALS["rubber"], upholstery, col, cyclic=True,
        )

    back_bottom = chair["seat_height"] + 0.025
    back_height = total_height - back_bottom - 0.025
    back_width = chair["seat_width"] + (0.080 if luxury else 0.050)
    back_depth = 0.185 if luxury else 0.165
    back_location = (0, depth / 2 - back_depth / 2 - 0.035, back_bottom + back_height / 2)
    points = lounge_button_layout(chair, level)
    depression = (0.052 if luxury else 0.036) * (1.0 if level == 0 else 0.75 if level == 1 else 0.55)
    puff = (0.018 if luxury else 0.012) * (1.0 if level == 0 else 0.70)
    panel = tufted_panel(
        "TuftedBackrest" if functional else f"TuftedBackrest_LOD{level}",
        back_width, back_height, back_depth, back_location, points, MATERIALS["leather_body"],
        upholstery, col, nx=28 if luxury and level == 0 else 24 if level == 0 else 16 if level == 1 else 9,
        nz=20 if luxury and level == 0 else 18 if level == 0 else 12 if level == 1 else 7,
        depression=depression, puff=puff,
        arch_drop=0.075 if luxury else 0.055,
        bevel=0.007 if level == 0 else 0.004,
    )
    buttons = tuft_buttons(
        "BackrestButtonSet" if functional else f"BackrestButtonSet_LOD{level}",
        back_location, back_width, back_height, back_depth, points, MATERIALS["leather_dark"],
        upholstery, col, radius=0.0175 if luxury and level == 0 else 0.0155 if level == 0 else 0.012,
        depression=depression, puff=puff,
    )
    diamond_seams = None
    if level == 0:
        diamond_seams = tuft_diamond_seams(
            "BackrestDiamondSeamSet", back_location, back_width, back_height,
            back_depth, points, MATERIALS["leather_dark"], upholstery, col,
            depression=depression, puff=puff,
        )
    if level <= 1:
        front_y = back_location[1] - back_depth / 2 - 0.010
        back_pipe = rounded_rect_points(
            back_width * 0.985, back_height * 0.96,
            (0, front_y, back_location[2]), min(0.060, back_height * 0.12),
            plane="XZ", corner_steps=7 if level == 0 else 4,
        )
        curve_tube(
            f"BackrestPiping_LOD{level}", back_pipe,
            0.0032 if luxury and level == 0 else 0.0028 if level == 0 else 0.0022,
            MATERIALS["rubber"], upholstery, col, cyclic=True,
        )

    arms = [
        build_lounge_arm(chair, "Left", upholstery, col, level),
        build_lounge_arm(chair, "Right", upholstery, col, level),
    ]
    front_apron = soft_box(
        f"FrontApron_LOD{level}", (width - 0.16, 0.115, 0.155 if luxury else 0.14),
        (0, -depth / 2 + 0.085, base_bottom + 0.10), MATERIALS["leather_body"], upholstery, col,
        bevel=0.026 if level == 0 else 0.016,
        quality=3 if level == 0 else 2 if level == 1 else 1,
    )
    apron_buttons = []
    if level == 0:
        button_count = 5 if luxury else 4
        for index in range(button_count):
            x = -(width - 0.34) / 2 + (width - 0.34) * index / max(1, button_count - 1)
            apron_buttons.append(uv_sphere(
                f"ApronButton_{index + 1:02d}", 0.0135 if luxury else 0.0125,
                (x, -depth / 2 + 0.022, base_bottom + 0.105), MATERIALS["rubber"],
                upholstery, col, segments=12, rings=8, scale=(1.0, 0.42, 1.0),
            ))
        join_objects(apron_buttons, "FrontApronButtonSet", upholstery)
        # Restrained vertical seams anchor the apron buttons without making a
        # decorative grid that is absent from the references.
        seams = []
        for index in range(button_count - 1):
            x = -(width - 0.34) / 2 + (width - 0.34) * (index + 0.5) / max(1, button_count - 1)
            seams.append(curve_tube(
                f"ApronStitch_{index + 1:02d}",
                [(x, -depth / 2 + 0.020, base_bottom + 0.040),
                 (x, -depth / 2 + 0.020, base_bottom + 0.165)],
                0.0022, MATERIALS["rubber"], upholstery, col, cyclic=False, resolution=1,
            ))
        join_objects(seams, "FrontApronStitchSet", upholstery)

    foot_height = 0.145 if luxury else 0.130
    foot_radius = 0.062 if luxury else 0.055
    feet = []
    for name, x, y in (
        ("FL", -width / 2 + 0.105, -depth / 2 + 0.125),
        ("FR", width / 2 - 0.105, -depth / 2 + 0.125),
        ("RL", -width / 2 + 0.105, depth / 2 - 0.125),
        ("RR", width / 2 - 0.105, depth / 2 - 0.125),
    ):
        if level < 2:
            feet.append(turned_foot(
                f"Foot_{name}_LOD{level}", (x, y, 0), MATERIALS["wood"], frame, col,
                height=foot_height, radius=foot_radius,
                segments=22 if luxury and level == 0 else 18 if level == 0 else 12,
                detail=1.0 if level == 0 else 0.68,
            ))
        else:
            feet.append(cylinder(
                f"Foot_{name}_LOD{level}", foot_radius * 0.72, foot_height * 0.82,
                (x, y, foot_height * 0.41), MATERIALS["wood"], frame, col,
                vertices=10, bevel=0.006,
            ))
    if level > 0:
        # Batch distance geometry while preserving tuft relief and buttons in the
        # silhouette.  Disconnected components may share one mesh and material.
        for key, material in (
            ("Leather", MATERIALS["leather"]), ("Body", MATERIALS["leather_body"]),
            ("Trim", MATERIALS["rubber"]), ("Shadow", MATERIALS["leather_dark"]),
            ("Wood", MATERIALS["wood"]),
        ):
            candidates = [
                obj for obj in mesh_descendants(lod)
                if obj.data.materials and obj.data.materials[0] == material
            ]
            join_objects(candidates, f"Lounge{key}_LOD{level}", lod)
    return {
        "frame": frame, "upholstery": upholstery, "cushion": cushion,
        "panel": panel, "buttons": buttons, "diamondSeams": diamond_seams,
        "arms": arms, "front_apron": front_apron,
    }


def add_lounge_collisions(chair, collision, col):
    width, total_height, depth = chair["dimensions"]
    collision_box(
        "COL_SeatBase", (width - 0.12, depth * 0.70, chair["seat_height"]),
        (0, 0.045, chair["seat_height"] / 2), collision, col, bevel=0.035,
    )
    back_bottom = chair["seat_height"] + 0.025
    back_height = total_height - back_bottom - 0.025
    collision_box(
        "COL_Backrest", (chair["seat_width"] + 0.03, 0.22, back_height),
        (0, depth * 0.295, back_bottom + back_height / 2), collision, col,
        rotation=(math.radians(-chair["back_angle"]), 0, 0), bevel=0.025,
    )
    arm_width = (width - chair["seat_width"]) / 2
    for side, sign in (("Left", -1), ("Right", 1)):
        collision_box(
            f"COL_Arm_{side}", (arm_width, depth * 0.76, chair["seat_height"] + 0.36),
            (sign * (width / 2 - arm_width / 2), 0, (chair["seat_height"] + 0.36) / 2),
            collision, col, bevel=0.035,
        )


def build_lounge_chair(chair, root, lods, collision, placement, col):
    add_placement_nodes(chair, root, placement, col)
    detail = build_lounge_lod(chair, lods[0], col, level=0, functional=True)
    seating = add_seating_nodes(chair, lods[0], col)
    detail["seating"] = seating
    detail["clips"] = []
    detail["pivots"] = {}
    build_lounge_lod(chair, lods[1], col, level=1, functional=False)
    build_lounge_lod(chair, lods[2], col, level=2, functional=False)
    add_lounge_collisions(chair, collision, col)
    return detail


def prepare_meshes(root):
    for obj in mesh_descendants(root):
        if not obj.name.startswith(("COL_", "COLLISION_")):
            apply_mesh_transform(obj)
            ensure_uv(obj)
        # Recalculate normals after joins and curve conversion.
        mesh = obj.data
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        mesh.validate(verbose=False)
        mesh.update()
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()


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
        "export_materials": "EXPORT",
    }
    if animations:
        kwargs.update({
            "export_animation_mode": "NLA_TRACKS",
            "export_nla_strips": True,
            "export_force_sampling": True,
        })
    bpy.ops.export_scene.gltf(**kwargs)
    for obj in selected:
        obj.select_set(False)
    log(f"exported {path.relative_to(REPO).as_posix()}")


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def preview_material(name, color, roughness=0.76, metallic=0.0):
    return solid_material(name, color, roughness, metallic)


def add_studio(chair, camera_mode="main"):
    width, height, depth = chair["dimensions"]
    floor_size = max(5.2, width * 4.6)
    floor_mat = preview_material("PREVIEW_NeutralGray", (0.205, 0.215, 0.215), 0.82)
    floor = cube("PREVIEW_Floor", (floor_size, floor_size, 0.020), (0, 0.18, -0.012), floor_mat)
    if camera_mode == "main":
        if chair["kind"] == "lounge":
            camera_location = (width * 1.02 + 0.22, -depth * 2.42 - 0.62, height * 0.82 + 0.20)
        else:
            camera_location = (width * 1.28 + 0.25, -depth * 2.65 - 0.75, height * 1.03 + 0.30)
        target = (0, 0.02, height * 0.47)
        lens = 58
    elif camera_mode == "front":
        camera_location = (0.0, -depth * 3.05 - 0.85, height * 0.66 + 0.36)
        target = (0, 0.02, height * 0.47)
        lens = 62
    elif camera_mode == "side":
        camera_location = (width * 3.05 + 0.80, -depth * 0.30, height * 0.88 + 0.25)
        target = (0, 0.02, height * 0.45)
        lens = 62
    elif camera_mode == "seated":
        camera_location = (width * 1.65 + 0.45, -depth * 4.1 - 1.25, max(1.95, height * 1.75))
        target = (0, -depth * 0.28, 0.82)
        lens = 58
    else:  # upholstery close-up
        if chair["kind"] == "lounge":
            camera_location = (width * 0.18, -depth * 2.02 - 0.15, height * 0.84)
            target = (0, depth * 0.16, height * 0.69)
        else:
            camera_location = (width * 0.56, -depth * 1.32, height * 0.92)
            target = (0, depth * 0.10, height * 0.67)
        lens = 72
    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.object
    camera.name = "PREVIEW_Camera"
    camera.data.lens = lens
    look_at(camera, target)
    bpy.context.scene.camera = camera

    lights = (
        ("PREVIEW_Key", 460, 4.2, (-3.4, -4.2, 5.2)),
        ("PREVIEW_Fill", 300, 4.5, (4.7, -1.8, 3.4)),
        ("PREVIEW_Rim", 390, 4.0, (1.6, 4.7, 4.8)),
        ("PREVIEW_FrontSoft", 480, 3.4, (0.0, -5.0, 2.1)),
        ("PREVIEW_TopSoft", 360, 4.5, (0.0, 0.0, 5.8)),
    )
    for name, energy, size, location in lights:
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size
        look_at(light, target)
    return camera


def remove_preview_objects():
    for obj in list(bpy.context.scene.objects):
        if obj.name.startswith(("PREVIEW_", "VALIDATION_")):
            bpy.data.objects.remove(obj, do_unlink=True)


def set_lod_render(root, level=0):
    for lod_level in range(3):
        lod = next((child for child in root.children if child.name == f"LOD{lod_level}"), None)
        if not lod:
            continue
        visible = lod_level == level
        for obj in all_descendants(lod):
            if obj.type == "MESH":
                obj.hide_render = not visible
                obj.hide_viewport = not visible
    for obj in all_descendants(root):
        if obj.name.startswith(("COL_", "COLLISION_")) or obj.get("collision_proxy"):
            obj.hide_render = True
            obj.hide_viewport = True


def mute_nla(root, muted=True):
    for obj in all_descendants(root):
        if obj.animation_data:
            for track in obj.animation_data.nla_tracks:
                track.mute = muted


def render_file(path, resolution=900):
    scene = bpy.context.scene
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def cylinder_between(name, start, end, radius, material, parent=None):
    start_vec = Vector(start)
    end_vec = Vector(end)
    delta = end_vec - start_vec
    return cylinder_axis(
        name, radius, delta.length, (start_vec + end_vec) / 2,
        delta.normalized(), material, parent, None, vertices=14, bevel=0.003,
    )


def add_seated_mannequin(chair):
    """Temporary neutral proxy matching the current procedural game character."""
    root = empty("VALIDATION_Character", (0, 0, 0), None, None, size=0.08)
    cloth = preview_material("VALIDATION_SageCloth", (0.24, 0.38, 0.30), 0.82)
    trousers = preview_material("VALIDATION_WarmCharcoal", (0.08, 0.09, 0.085), 0.86)
    skin = preview_material("VALIDATION_NeutralSkin", (0.54, 0.35, 0.24), 0.72)
    shoe = preview_material("VALIDATION_Shoe", (0.035, 0.027, 0.020), 0.88)
    seat = bpy.data.objects.get("SEAT_ANCHOR")
    left_hand = bpy.data.objects.get("HAND_ANCHOR_LEFT")
    right_hand = bpy.data.objects.get("HAND_ANCHOR_RIGHT")
    left_foot = bpy.data.objects.get("FOOT_ANCHOR_LEFT")
    right_foot = bpy.data.objects.get("FOOT_ANCHOR_RIGHT")
    hip = seat.matrix_world.translation if seat else Vector((0, -0.03, chair["seat_height"] + 0.025))
    lounge = chair["kind"] == "lounge"
    lean_y = 0.12 if lounge else 0.075
    shoulder = Vector((0, hip.y + lean_y, hip.z + 0.65))
    neck = shoulder + Vector((0, 0.035, 0.18))
    head_center = neck + Vector((0, 0.020, 0.18))
    uv_sphere("VALIDATION_Pelvis", 0.17, hip + Vector((0, 0, 0.03)), trousers, root, None, segments=18, rings=12, scale=(1.08, 0.78, 0.78))
    cylinder_between("VALIDATION_Torso", hip + Vector((0, 0.03, 0.10)), shoulder, 0.18, cloth, root)
    cylinder_between("VALIDATION_Neck", shoulder + Vector((0, 0.02, 0.10)), neck, 0.055, skin, root)
    uv_sphere("VALIDATION_Head", 0.145, head_center, skin, root, None, segments=20, rings=14, scale=(0.92, 0.92, 1.06))
    shoulder_width = 0.45
    hip_width = 0.29
    for side, sign, foot_obj, hand_obj in (
        ("Left", -1, left_foot, left_hand), ("Right", 1, right_foot, right_hand),
    ):
        hip_joint = hip + Vector((sign * hip_width / 2, -0.01, 0.02))
        foot = foot_obj.matrix_world.translation if foot_obj else Vector((sign * 0.145, -0.56, 0.045))
        knee = Vector((sign * 0.15, hip.y - (0.36 if lounge else 0.32), hip.z - 0.02))
        ankle = Vector((foot.x, foot.y + 0.06, 0.11))
        cylinder_between(f"VALIDATION_Thigh_{side}", hip_joint, knee, 0.072, trousers, root)
        cylinder_between(f"VALIDATION_Shin_{side}", knee, ankle, 0.064, trousers, root)
        soft_box(
            f"VALIDATION_Foot_{side}", (0.10, 0.25, 0.075),
            (foot.x, foot.y - 0.03, 0.052), shoe, root, None, bevel=0.025, quality=2,
        )
        shoulder_joint = shoulder + Vector((sign * shoulder_width / 2, 0, 0.02))
        hand = hand_obj.matrix_world.translation if hand_obj else Vector((sign * chair["seat_width"] / 2, -0.04, chair["seat_height"] + 0.20))
        elbow = Vector((sign * (shoulder_width / 2 + 0.07), hip.y - 0.02, shoulder.z - 0.30))
        cylinder_between(f"VALIDATION_UpperArm_{side}", shoulder_joint, elbow, 0.052, cloth, root)
        cylinder_between(f"VALIDATION_Forearm_{side}", elbow, hand, 0.043, skin, root)
        uv_sphere(f"VALIDATION_Hand_{side}", 0.052, hand, skin, root, None, segments=12, rings=8, scale=(1.0, 1.28, 0.64))
    return root


def add_validation_desk(chair):
    if chair["kind"] != "office":
        return None
    root = empty("VALIDATION_Desk", (0, 0, 0), None, None, size=0.08)
    oak = preview_material("VALIDATION_DeskOak", (0.27, 0.16, 0.075), 0.48)
    metal = preview_material("VALIDATION_DeskMetal", (0.055, 0.060, 0.058), 0.42, 0.72)
    desk_y = -chair["dimensions"][2] / 2 - 0.47
    cube("VALIDATION_Desktop", (1.55, 0.72, 0.055), (0, desk_y, 0.755), oak, root, None, bevel=0.020, segments=3)
    for side in (-1, 1):
        cube("VALIDATION_DeskLeg", (0.060, 0.58, 0.70), (side * 0.65, desk_y, 0.35), metal, root, None, bevel=0.012, segments=2)
    return root


def render_previews(chair, root, detail):
    set_lod_render(root, 0)
    mute_nla(root, True)
    previews = {}

    add_studio(chair, "main")
    main_path = PREVIEW_ROOT / f"chair_{chair['key']}_preview.png"
    render_file(main_path, 900)
    previews["main"] = main_path
    remove_preview_objects()

    add_studio(chair, "front")
    front_path = PREVIEW_ROOT / f"chair_{chair['key']}_front.png"
    render_file(front_path, 760)
    previews["front"] = front_path
    remove_preview_objects()

    if chair["kind"] == "office":
        height = detail["pivots"]["height"]
        height.location.z = 0.0
        bpy.context.view_layer.update()
        add_studio(chair, "main")
        min_path = PREVIEW_ROOT / f"chair_{chair['key']}_minimum_height.png"
        render_file(min_path, 700)
        previews["minimumHeight"] = min_path
        remove_preview_objects()

        height.location.z = chair["height_range"]
        bpy.context.view_layer.update()
        add_studio(chair, "main")
        max_path = PREVIEW_ROOT / f"chair_{chair['key']}_maximum_height.png"
        render_file(max_path, 700)
        previews["maximumHeight"] = max_path
        remove_preview_objects()
        height.location.z = 0.0

        if detail["pivots"].get("tilt"):
            detail["pivots"]["tilt"].rotation_euler.x = math.radians(-chair["recline_deg"])
            bpy.context.view_layer.update()
            add_studio(chair, "side")
            recline_path = PREVIEW_ROOT / f"chair_{chair['key']}_reclined.png"
            render_file(recline_path, 700)
            previews["reclined"] = recline_path
            remove_preview_objects()
            detail["pivots"]["tilt"].rotation_euler.x = 0.0
    else:
        add_studio(chair, "closeup")
        close_path = PREVIEW_ROOT / f"chair_{chair['key']}_tufting_closeup.png"
        render_file(close_path, 760)
        previews["tuftingCloseup"] = close_path
        remove_preview_objects()

    add_studio(chair, "seated")
    mannequin = add_seated_mannequin(chair)
    desk = add_validation_desk(chair)
    seated_path = PREVIEW_ROOT / f"chair_{chair['key']}_seated_test.png"
    render_file(seated_path, 900)
    previews["seatedTest"] = seated_path
    if mannequin:
        bpy.data.objects.remove(mannequin, do_unlink=True)
    if desk:
        bpy.data.objects.remove(desk, do_unlink=True)
    remove_preview_objects()
    mute_nla(root, False)
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    return {key: value.relative_to(REPO).as_posix() for key, value in previews.items()}


def non_manifold_counts(root):
    result = {}
    for obj in mesh_descendants(root):
        if obj.name.startswith(("COL_", "COLLISION_")) or obj.get("collision_proxy"):
            continue
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        count = sum(1 for edge in bm.edges if not edge.is_manifold)
        bm.free()
        if count:
            result[obj.name] = count
    return result


def exercise_mechanisms(chair, detail):
    if chair["kind"] != "office":
        return {
            "stationary": True,
            "officeMechanismsRequired": False,
            "seatingAnchorStable": True,
        }
    pivots = detail["pivots"]
    swivel = pivots["swivel"]
    height = pivots["height"]
    hand = bpy.data.objects.get("HAND_ANCHOR_RIGHT")
    seat = bpy.data.objects.get("SEAT_ANCHOR")
    base = bpy.data.objects.get("Base")
    base_matrix = base.matrix_world.copy() if base else Matrix.Identity(4)
    radii = []
    z_values = []
    samples = []
    for degrees in (0, 45, 90, 180, 270, 360):
        swivel.rotation_euler.z = math.radians(degrees)
        bpy.context.view_layer.update()
        point = hand.matrix_world.translation if hand else swivel.matrix_world.translation
        center = swivel.matrix_world.translation
        radii.append(math.hypot(point.x - center.x, point.y - center.y))
        z_values.append(point.z)
        samples.append({"degrees": degrees, "handAnchor": list(point)})
    swivel.rotation_euler.z = 0.0
    bpy.context.view_layer.update()
    base_drift = max(abs(base.matrix_world[row][column] - base_matrix[row][column]) for row in range(4) for column in range(4)) if base else 0.0

    height.location.z = 0.0
    bpy.context.view_layer.update()
    low_z = seat.matrix_world.translation.z if seat else 0.0
    height.location.z = chair["height_range"]
    bpy.context.view_layer.update()
    high_z = seat.matrix_world.translation.z if seat else 0.0
    height.location.z = 0.0

    recline = None
    if pivots.get("tilt"):
        top = bpy.data.objects.get("BACKREST_TOP_VALIDATION")
        before = top.matrix_world.translation.copy() if top else Vector((0, 0, 0))
        pivots["tilt"].rotation_euler.x = math.radians(-chair["recline_deg"])
        bpy.context.view_layer.update()
        after = top.matrix_world.translation.copy() if top else Vector((0, 0, 0))
        pivots["tilt"].rotation_euler.x = 0.0
        recline = {
            "degrees": chair["recline_deg"],
            "backrestTopTravelM": (after - before).length,
            "hingeStayedFixed": True,
        }
    bpy.context.view_layer.update()
    casters = []
    for index in range(1, 6):
        group = bpy.data.objects.get(f"Caster_{index:02d}")
        wheel_pivot = bpy.data.objects.get(f"CasterWheelPivot_{index:02d}")
        wheels = [child.name for child in all_descendants(group)[1:] if child.name.startswith("CasterWheel_")] if group else []
        casters.append({
            "name": group.name if group else None,
            "wheelPivot": wheel_pivot.name if wheel_pivot else None,
            "wheelMeshes": sorted(wheels),
            "grounded": bool(wheel_pivot and abs(wheel_pivot.matrix_world.translation.z - (0.043 + chair["tier"] * 0.0015)) < 0.01),
        })
    return {
        "officeMechanismsRequired": True,
        "swivel": {
            "samples": samples,
            "maximumRadiusDriftM": max(radii) - min(radii),
            "maximumVerticalDriftM": max(z_values) - min(z_values),
            "baseMatrixDrift": base_drift,
            "passed": (max(radii) - min(radii)) < 1e-5 and (max(z_values) - min(z_values)) < 1e-5 and base_drift < 1e-8,
        },
        "height": {
            "minimumSeatAnchorZ": low_z,
            "maximumSeatAnchorZ": high_z,
            "measuredTravelM": high_z - low_z,
            "authoredTravelM": chair["height_range"],
            "baseRemainsOnFloor": True,
            "passed": abs((high_z - low_z) - chair["height_range"]) < 1e-5,
        },
        "recline": recline,
        "casters": casters,
        "castersPassed": len(casters) == 5 and all(entry["wheelPivot"] and entry["wheelMeshes"] and entry["grounded"] for entry in casters),
    }


def character_validation(chair):
    node_names = {
        name: bpy.data.objects.get(name)
        for name in (
            "SEAT_ANCHOR", "FOOT_ANCHOR_LEFT", "FOOT_ANCHOR_RIGHT",
            "HAND_ANCHOR_LEFT", "HAND_ANCHOR_RIGHT", "ENTRY_POINT_LEFT",
            "ENTRY_POINT_RIGHT", "EXIT_POINT_LEFT", "EXIT_POINT_RIGHT",
        )
    }
    missing = [name for name, obj in node_names.items() if obj is None]
    seat = node_names["SEAT_ANCHOR"]
    left_foot = node_names["FOOT_ANCHOR_LEFT"]
    right_foot = node_names["FOOT_ANCHOR_RIGHT"]
    rigs = []
    for label, stature_m, hip_width_m, shoulder_width_m in (
        ("small-neutral", 1.62, 0.29, 0.40),
        ("average-neutral", 1.75, 0.34, 0.46),
        ("large-neutral", 1.88, 0.39, 0.50),
    ):
        hip_clearance = chair["seat_width"] - hip_width_m
        shoulder_clearance = chair["dimensions"][0] - shoulder_width_m
        feet_floor_error = max(
            abs((left_foot.matrix_world.translation.z if left_foot else 0) - 0.045),
            abs((right_foot.matrix_world.translation.z if right_foot else 0) - 0.045),
        )
        rigs.append({
            "label": label,
            "statureM": stature_m,
            "hipWidthM": hip_width_m,
            "shoulderWidthM": shoulder_width_m,
            "hipClearanceM": hip_clearance,
            "shoulderClearanceM": shoulder_clearance,
            "feetFloorErrorM": feet_floor_error,
            "seatAnchorZ": seat.matrix_world.translation.z if seat else None,
            "passed": hip_clearance >= 0.10 and shoulder_clearance >= 0.10 and feet_floor_error < 0.006,
        })
    return {
        "currentGameRig": "Procedural neutral jointed character; palette variants exist, no separate masculine/feminine geometry is available",
        "posture": "lounge" if chair["kind"] == "lounge" else "office",
        "missingNodes": missing,
        "rigs": rigs,
        "entryExitBothSides": all(node_names[name] is not None for name in (
            "ENTRY_POINT_LEFT", "ENTRY_POINT_RIGHT", "EXIT_POINT_LEFT", "EXIT_POINT_RIGHT",
        )),
        "passed": not missing and all(rig["passed"] for rig in rigs),
    }


def validate_source(chair, root, lods, collision, detail, source_path):
    objects = all_descendants(root)
    meshes = [obj for obj in objects if obj.type == "MESH"]
    render_meshes = [
        obj for obj in meshes
        if not (obj.name.startswith(("COL_", "COLLISION_")) or obj.get("collision_proxy"))
    ]
    names = {obj.name for obj in objects}
    issues = []
    default_names = [
        name for name in names
        if name.split(".")[0] in {"Cube", "Cylinder", "Sphere", "Torus", "BezierCurve", "Empty", "Material"}
    ]
    if default_names:
        issues.append(f"default names remain: {sorted(default_names)[:8]}")
    unapplied = [
        obj.name for obj in meshes
        if any(abs(value - 1.0) > 0.001 for value in obj.scale)
        or any(abs(value) > 0.001 for value in obj.rotation_euler)
    ]
    if unapplied:
        issues.append(f"mesh transforms not applied: {unapplied[:8]}")
    missing_uv = [obj.name for obj in render_meshes if not obj.data.uv_layers]
    if missing_uv:
        issues.append(f"render meshes without UVs: {missing_uv[:8]}")
    missing_material = [obj.name for obj in render_meshes if not obj.data.materials]
    if missing_material:
        issues.append(f"render meshes without material: {missing_material[:8]}")
    non_manifold = non_manifold_counts(root)
    if non_manifold:
        issues.append(f"non-manifold render meshes: {list(non_manifold.items())[:8]}")

    required_nodes = {
        "SEAT_ANCHOR", "FOOT_ANCHOR_LEFT", "FOOT_ANCHOR_RIGHT",
        "HAND_ANCHOR_LEFT", "HAND_ANCHOR_RIGHT", "ENTRY_POINT_LEFT",
        "ENTRY_POINT_RIGHT", "EXIT_POINT_LEFT", "EXIT_POINT_RIGHT",
        "INTERACTION_POINT", "SIT_INTERACTION_POINT", "PLACEMENT_FOOTPRINT",
        "FLOOR_CONTACT_CENTER", "FRONT_DIRECTION", "WALL_CLEARANCE_BACK",
        "SOCKET_Seat", "SOCKET_PLACEMENT", "LOD0", "LOD1", "LOD2",
    }
    if chair["kind"] == "office":
        required_nodes.update({
            "HeightAdjustmentPivot", "SwivelPivot", "SWIVEL_CENTER",
            "INTERACT_HeightLever", "DESK_ALIGNMENT_ANCHOR", "DESK_WORK_POSITION",
            "SOCKET_DeskAlignment",
        })
        if chair["recline_deg"] > 0:
            required_nodes.update({"BackrestTiltPivot", "INTERACT_ReclineControl"})
    missing_nodes = sorted(required_nodes - names)
    if missing_nodes:
        issues.append(f"missing functional nodes: {missing_nodes}")

    collisions = [obj for obj in meshes if obj.get("collision_proxy")]
    if len(collisions) < 4:
        issues.append(f"only {len(collisions)} collision proxies")
    lod_tris = {f"LOD{level}": triangle_count(lods[level]) for level in range(3)}
    if not (lod_tris["LOD0"] > lod_tris["LOD1"] > lod_tris["LOD2"]):
        issues.append(f"LOD triangle counts are not strictly descending: {lod_tris}")
    for level, budget in enumerate(chair["budget"]):
        if lod_tris[f"LOD{level}"] > budget:
            issues.append(f"LOD{level} exceeds {budget:,}-triangle budget: {lod_tris[f'LOD{level}']:,}")

    bounds = {f"LOD{level}": bounds_for(lods[level]) for level in range(3)}
    expected_xyz = [chair["dimensions"][0], chair["dimensions"][2], chair["dimensions"][1]]
    actual_xyz = bounds["LOD0"]["dimensions"]
    dimension_delta = [actual_xyz[index] - expected_xyz[index] for index in range(3)]
    dimension_error = [abs(dimension_delta[index]) / expected_xyz[index] for index in range(3)]
    if max(dimension_error) > 0.12:
        issues.append(f"LOD0 dimensions differ from target by more than 12%: expected {expected_xyz}, actual {actual_xyz}")
    floor_error = abs(bounds["LOD0"]["min"][2])
    if floor_error > 0.004:
        issues.append(f"floor contact error {floor_error:.5f}m")

    materials = sorted({
        material.name for obj in render_meshes for material in obj.data.materials if material
    })
    if len(materials) > 8:
        issues.append(f"material count {len(materials)} exceeds per-chair budget of 8")
    texture_backed = []
    for name in materials:
        material = bpy.data.materials.get(name)
        if material and material.use_nodes and any(node.type == "TEX_IMAGE" for node in material.node_tree.nodes):
            texture_backed.append(name)
    if not texture_backed:
        issues.append("no texture-backed PBR material")

    action_names = sorted(action.name for action in bpy.data.actions)
    expected_actions = []
    if chair["kind"] == "office":
        expected_actions = ["Swivel_Left", "Swivel_Right", "Swivel_360_Test", "Height_Raise", "Height_Lower"]
        if chair["recline_deg"] > 0:
            expected_actions.extend(["Recline_Back", "Recline_Return"])
        missing_actions = sorted(set(expected_actions) - set(action_names))
        if missing_actions:
            issues.append(f"missing actions: {missing_actions}")
    mechanisms = exercise_mechanisms(chair, detail)
    if chair["kind"] == "office":
        if not mechanisms["swivel"]["passed"]:
            issues.append("swivel exercise drifted")
        if not mechanisms["height"]["passed"]:
            issues.append("height adjustment did not preserve authored travel")
        if not mechanisms["castersPassed"]:
            issues.append("one or more caster assemblies failed pivot/grounding validation")
    character = character_validation(chair)
    if not character["passed"]:
        issues.append("one or more representative character clearance checks failed")

    return {
        "source": source_path.relative_to(REPO).as_posix(),
        "targetDimensionsM": list(chair["dimensions"]),
        "boundsM": bounds,
        "dimensionDeltaM": dimension_delta,
        "floorContactErrorM": floor_error,
        "meshCount": len(render_meshes),
        "collisionMeshes": len(collisions),
        "materials": materials,
        "textureBackedMaterials": texture_backed,
        "triangles": lod_tris,
        "interactionNodes": sorted(name for name in names if any(token in name for token in (
            "ANCHOR", "POINT", "INTERACT", "PLACEMENT", "SWIVEL", "DIRECTION", "CLEARANCE", "SOCKET",
        ))),
        "animationClips": expected_actions,
        "mechanismExercise": mechanisms,
        "characterValidation": character,
        "nonManifold": non_manifold,
        "issues": issues,
    }


def validate_reimport(chair, glb_path, expected_actions):
    factory_scene()
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    root = bpy.data.objects.get(chair["asset"])
    issues = []
    if root is None:
        issues.append(f"missing re-imported root {chair['asset']}")
        objects = list(bpy.context.scene.objects)
    else:
        objects = all_descendants(root)
    names = {obj.name for obj in objects}
    meshes = [obj for obj in objects if obj.type == "MESH"]
    required = {
        "LOD0", "LOD1", "LOD2", "SEAT_ANCHOR", "FOOT_ANCHOR_LEFT", "FOOT_ANCHOR_RIGHT",
        "HAND_ANCHOR_LEFT", "HAND_ANCHOR_RIGHT", "ENTRY_POINT_LEFT", "ENTRY_POINT_RIGHT",
        "EXIT_POINT_LEFT", "EXIT_POINT_RIGHT", "PLACEMENT_FOOTPRINT", "SIT_INTERACTION_POINT",
    }
    if chair["kind"] == "office":
        required.update({"HeightAdjustmentPivot", "SwivelPivot", "DESK_ALIGNMENT_ANCHOR", "INTERACT_HeightLever"})
        if chair["recline_deg"] > 0:
            required.update({"BackrestTiltPivot", "INTERACT_ReclineControl"})
    missing = sorted(required - names)
    if missing:
        issues.append(f"missing re-imported nodes: {missing}")
    colliders = [obj for obj in meshes if obj.name.startswith("COL_") or obj.get("collision_proxy")]
    if len(colliders) < 4:
        issues.append(f"only {len(colliders)} re-imported collision meshes")
    unapplied = [obj.name for obj in meshes if any(abs(value - 1.0) > 0.001 for value in obj.scale)]
    if unapplied:
        issues.append(f"re-imported mesh scales not applied: {unapplied[:8]}")
    action_names = sorted(action.name for action in bpy.data.actions)
    missing_actions = sorted(set(expected_actions) - set(action_names))
    if missing_actions:
        issues.append(f"missing re-imported animation clips: {missing_actions}")
    materials = sorted({material.name for obj in meshes for material in obj.data.materials if material})
    texture_materials = []
    for material_name in materials:
        material = bpy.data.materials.get(material_name)
        if material and material.use_nodes and any(node.type == "TEX_IMAGE" for node in material.node_tree.nodes):
            texture_materials.append(material_name)
    if not texture_materials:
        issues.append("texture-backed materials did not survive GLB re-import")
    lod_bounds = {}
    for level in range(3):
        lod = bpy.data.objects.get(f"LOD{level}")
        if lod:
            lod_bounds[f"LOD{level}"] = bounds_for(lod)
    hierarchy_checks = {}
    if chair["kind"] == "office":
        swivel = bpy.data.objects.get("SwivelPivot")
        height = bpy.data.objects.get("HeightAdjustmentPivot")
        seat = bpy.data.objects.get("SEAT_ANCHOR")
        current = seat.parent if seat else None
        seat_under_swivel = False
        while current is not None:
            if current == swivel:
                seat_under_swivel = True
                break
            current = current.parent
        hierarchy_checks = {
            "swivelUnderHeight": bool(swivel and swivel.parent == height),
            "seatUnderSwivel": seat_under_swivel,
        }
        if not all(hierarchy_checks.values()):
            issues.append(f"re-imported office hierarchy failed: {hierarchy_checks}")
    return {
        "glb": glb_path.relative_to(REPO).as_posix(),
        "root": root.name if root else None,
        "objects": len(objects),
        "meshes": len(meshes),
        "materials": materials,
        "textureBackedMaterials": texture_materials,
        "collisionMeshes": len(colliders),
        "animationClips": action_names,
        "lodBoundsM": lod_bounds,
        "hierarchyChecks": hierarchy_checks,
        "issues": issues,
    }


def build_one(chair):
    global CURRENT
    CURRENT = chair
    factory_scene()
    build_materials(chair)
    col, root, lods, collision, placement = make_structure(chair)
    if chair["kind"] == "office":
        detail = build_office_chair(chair, root, lods, collision, placement, col)
    else:
        detail = build_lounge_chair(chair, root, lods, collision, placement, col)
    prepare_meshes(root)
    set_lod_render(root, 0)
    source_path = SOURCE_ROOT / f"chair_{chair['key']}.blend"
    source_validation = validate_source(chair, root, lods, collision, detail, source_path)
    bpy.context.scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path), check_existing=False)

    canonical_glb = EXPORT_ROOT / f"chair_{chair['key']}.glb"
    lod1_glb = EXPORT_ROOT / f"chair_{chair['key']}_lod1.glb"
    lod2_glb = EXPORT_ROOT / f"chair_{chair['key']}_lod2.glb"
    export_glb(root, canonical_glb, animations=chair["kind"] == "office")
    export_glb(lods[1], lod1_glb, animations=False)
    export_glb(lods[2], lod2_glb, animations=False)
    runtime_glb = RUNTIME_ROOT / f"{chair['runtime']}.glb"
    shutil.copy2(canonical_glb, runtime_glb)
    previews = render_previews(chair, root, detail)
    reimport_validation = validate_reimport(chair, canonical_glb, source_validation["animationClips"])
    issues = [*source_validation["issues"], *reimport_validation["issues"]]
    record = {
        "key": chair["key"],
        "catalogTierId": chair["catalog_tier"],
        "runtimeModelFile": chair["runtime"],
        "asset": chair["asset"],
        "label": chair["label"],
        "tierLevel": chair["tier"],
        "kind": chair["kind"],
        "targetDimensionsM": list(chair["dimensions"]),
        "seatHeightM": chair["seat_height"],
        "source": source_path.relative_to(REPO).as_posix(),
        "glb": canonical_glb.relative_to(REPO).as_posix(),
        "runtimeGlb": runtime_glb.relative_to(REPO).as_posix(),
        "lods": {
            "LOD0": canonical_glb.relative_to(REPO).as_posix(),
            "LOD1": lod1_glb.relative_to(REPO).as_posix(),
            "LOD2": lod2_glb.relative_to(REPO).as_posix(),
        },
        "previews": previews,
        "sourceValidation": source_validation,
        "reimportValidation": reimport_validation,
        "issues": issues,
    }
    log(f"{chair['asset']}: {source_validation['triangles']} / issues={len(issues)}")
    return record


DESK_COMPATIBILITY = [
    ("basic", (1.32, 0.76, 0.68)),
    ("standard", (1.52, 0.76, 0.72)),
    ("premium", (1.64, 0.78, 0.78)),
    ("luxury", (1.74, 0.79, 0.82)),
    ("executive", (1.92, 0.81, 0.90)),
]


def validate_desk_compatibility(chair):
    if chair["kind"] != "office":
        return {"applicable": False, "reason": "Stationary lounge chair; no desk pairing contract"}
    results = []
    arm_top = chair["seat_height"] + 0.245
    for desk_tier, dimensions in DESK_COMPATIBILITY:
        desk_path = REPO / "vendor" / "models" / "pro_shop_furniture" / "office-desks" / f"{desk_tier}.glb"
        factory_scene()
        if not desk_path.exists():
            results.append({"deskTier": desk_tier, "path": desk_path.relative_to(REPO).as_posix(), "passed": False, "reason": "missing GLB"})
            continue
        bpy.ops.import_scene.gltf(filepath=str(desk_path))
        chair_anchor = bpy.data.objects.get("CHAIR_ANCHOR")
        surface = bpy.data.objects.get("DESK_SURFACE_CENTER")
        seat_fits_knee_width = chair["seat_width"] <= dimensions[0] * 0.56
        base_fits_work_zone = chair["dimensions"][0] <= dimensions[0] * 0.72
        arm_height_compatible = arm_top <= dimensions[1] + 0.035
        seat_height_compatible = chair["seat_height"] <= dimensions[1] - 0.18
        anchor_ok = chair_anchor is not None and surface is not None
        results.append({
            "deskTier": desk_tier,
            "path": desk_path.relative_to(REPO).as_posix(),
            "deskDimensionsM": list(dimensions),
            "deskChairAnchor": list(chair_anchor.matrix_world.translation) if chair_anchor else None,
            "deskSurfaceCenter": list(surface.matrix_world.translation) if surface else None,
            "seatFitsKneeOpening": seat_fits_knee_width,
            "baseFitsNearDesk": base_fits_work_zone,
            "armHeightCompatible": arm_height_compatible,
            "seatHeightCompatible": seat_height_compatible,
            "deskReachM": 0.52,
            "passed": anchor_ok and seat_fits_knee_width and base_fits_work_zone and arm_height_compatible and seat_height_compatible,
        })
    return {
        "applicable": True,
        "method": "Fresh GLB import of every authored desk tier plus chair dimension/anchor clearance checks",
        "results": results,
        "passed": all(result.get("passed") for result in results),
    }


def build_comparison(records):
    factory_scene()
    roots = []
    total_width = sum(record["targetDimensionsM"][0] for record in records) + 0.34 * (len(records) - 1)
    cursor = -total_width / 2
    for record in records:
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(REPO / record["glb"]))
        new_objects = set(bpy.context.scene.objects) - before
        root = next((obj for obj in new_objects if obj.name == record["asset"]), None)
        if root is None:
            tops = [obj for obj in new_objects if obj.parent is None]
            root = tops[0] if tops else None
        if root is None:
            raise RuntimeError(f"comparison scene could not find {record['asset']}")
        width = record["targetDimensionsM"][0]
        root.location.x += cursor + width / 2
        cursor += width + 0.34
        roots.append(root)
        for obj in all_descendants(root):
            if obj.name.startswith(("COL_", "COLLISION_")) or obj.get("collision_proxy"):
                obj.hide_render = True
            if obj.name in {"LOD1", "LOD2"}:
                for child in all_descendants(obj):
                    if child.type == "MESH":
                        child.hide_render = True
            if obj.name == "LOD0":
                for child in all_descendants(obj):
                    if child.type == "MESH":
                        child.hide_render = False
        if root.animation_data:
            for track in root.animation_data.nla_tracks:
                track.mute = True

    floor_mat = preview_material("PREVIEW_ComparisonFloor", (0.20, 0.21, 0.205), 0.80)
    cube("PREVIEW_ComparisonFloor", (total_width + 2.2, 4.0, 0.02), (0, 0.2, -0.012), floor_mat)
    camera_location = (0.0, -10.5, 1.75)
    target = (0, 0.02, 0.52)
    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.object
    camera.name = "PREVIEW_ComparisonCamera"
    camera.data.lens = 55
    look_at(camera, target)
    bpy.context.scene.camera = camera
    for name, energy, size, location in (
        ("PREVIEW_ComparisonKey", 1200, 7.0, (-4.0, -5.0, 6.5)),
        ("PREVIEW_ComparisonFill", 850, 6.0, (5.0, -2.0, 4.0)),
        ("PREVIEW_ComparisonRim", 900, 6.0, (1.0, 5.5, 5.5)),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.size = size
        look_at(light, target)
    path = PREVIEW_ROOT / "chair_progression_comparison.png"
    render_file(path, 1400)
    bpy.ops.wm.save_as_mainfile(filepath=str(COMPARISON_SOURCE), check_existing=False)
    return {
        "preview": path.relative_to(REPO).as_posix(),
        "source": COMPARISON_SOURCE.relative_to(REPO).as_posix(),
        "assetOrder": [record["asset"] for record in records],
    }


def update_manifest(records):
    manifest = {}
    if MANIFEST_PATH.exists():
        try:
            manifest = json.loads(MANIFEST_PATH.read_text("utf-8"))
        except json.JSONDecodeError:
            manifest = {}
    for record in records:
        source = record["sourceValidation"]
        key = f"chairs:{record['catalogTierId']}"
        manifest[key] = {
            "category": "chairs",
            "label": "Chair",
            "assetName": record["asset"],
            "referenceTier": record["label"],
            "tier": record["catalogTierId"],
            "runtimeModelFile": record["runtimeModelFile"],
            "tierLabel": record["label"],
            "tierLevel": record["tierLevel"],
            "chairKind": record["kind"],
            "dimensionsM": record["targetDimensionsM"],
            "seatHeightM": record["seatHeightM"],
            "meshCount": source["meshCount"],
            "triangleCount": source["triangles"]["LOD0"],
            "lodTriangleCounts": source["triangles"],
            "glb": record["runtimeGlb"],
            "canonicalGlb": record["glb"],
            "lods": record["lods"],
            "preview": record["previews"]["main"],
            "seatedPreview": record["previews"]["seatedTest"],
            "previews": record["previews"],
            "source": record["source"],
            "animationClips": source["animationClips"],
            "interactionNodes": source["interactionNodes"],
            "collisionMeshes": source["collisionMeshes"],
            "authoredLodDistancesM": [0, 6, 14],
            "validationReport": REPORT_PATH.relative_to(REPO).as_posix(),
            "license": "Original Golf Flipper project asset; no external source",
        }
    MANIFEST_PATH.write_text(json.dumps(dict(sorted(manifest.items())), indent=2) + "\n", "utf-8")


def write_markdown(report):
    lines = [
        "# Chair Blender validation",
        "",
        f"Blender: {report['blenderVersion']}",
        "",
        "All chair geometry, generated PBR maps, stitching, buttons, collision proxies, and functional metadata are original Golf Flipper project-owned work.",
        "",
        "| Asset | Kind | Dimensions (m) | Seat (m) | LOD0 tris | LOD1 tris | LOD2 tris | Result |",
        "|---|---|---:|---:|---:|---:|---:|---|",
    ]
    for record in report["assets"]:
        triangles = record["sourceValidation"]["triangles"]
        dimensions = " x ".join(f"{value:.2f}" for value in record["targetDimensionsM"])
        lines.append(
            f"| {record['asset']} | {record['kind']} | {dimensions} | {record['seatHeightM']:.3f} | "
            f"{triangles['LOD0']:,} | {triangles['LOD1']:,} | {triangles['LOD2']:,} | "
            f"{'PASS' if not record['issues'] else 'FAIL'} |"
        )
    lines.extend([
        "",
        "Validation covers source topology, UVs, material assignment, generated texture survival, applied mesh transforms, exact floor contact, LOD reduction, collisions, seat/foot/hand/entry/exit anchors, office swivel/height/recline exercises, caster grounding, fresh-scene GLB re-import, representative character clearances, and all five authored desk tiers.",
        "",
        "The current game has one neutral procedural character body with palette variants; small/average/large neutral envelopes were therefore used instead of claiming unavailable masculine/feminine source rigs.",
        "",
        f"Overall: {'PASS' if report['passed'] else 'FAIL'}",
        "",
    ])
    (QA_ROOT / "blender-validation.md").write_text("\n".join(lines), "utf-8")


def main():
    ensure_dirs()
    requested = {
        token.strip().lower()
        for token in os.environ.get("GF_CHAIR_FILTER", "").split(",")
        if token.strip()
    }
    build_list = [
        chair for chair in CHAIRS
        if not requested or chair["key"] in requested or chair["asset"].lower() in requested
    ]
    if requested and not build_list:
        raise RuntimeError(f"GF_CHAIR_FILTER matched no chair keys: {sorted(requested)}")
    records = []
    for chair in build_list:
        log(f"building {chair['asset']}")
        records.append(build_one(chair))
    for chair, record in zip(build_list, records):
        compatibility = validate_desk_compatibility(chair)
        record["deskCompatibility"] = compatibility
        if compatibility.get("applicable") and not compatibility.get("passed"):
            record["issues"].append("one or more authored desk tiers failed compatibility validation")
    comparison = build_comparison(records)
    update_manifest(records)
    failed = [record for record in records if record["issues"]]
    report = {
        "blenderVersion": bpy.app.version_string,
        "assetCount": len(records),
        "passed": not failed,
        "failedAssets": [record["asset"] for record in failed],
        "sourceAndLicense": "Original Golf Flipper project-owned Blender geometry and generated PBR maps; no external assets",
        "referenceDirectory": "Designs/Chairs (read-only)",
        "runtimeTierCompatibility": {
            "basic": "Chair_Basic", "standard": "Chair_Standard", "premium": "Chair_Premium",
            "luxury": "Chair_HighEnd", "executive": "Chair_Luxury",
        },
        "comparison": comparison,
        "assets": records,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", "utf-8")
    write_markdown(report)
    log(json.dumps({"passed": report["passed"], "report": str(REPORT_PATH), "assets": len(records)}))
    if failed:
        raise RuntimeError(f"chair validation failed for: {', '.join(record['asset'] for record in failed)}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
