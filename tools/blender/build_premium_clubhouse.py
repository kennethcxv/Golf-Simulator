"""Build Golf Flipper's premium 6,889 sq ft modular clubhouse architecture.

Run with Blender 5.1 or newer::

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
      --background --factory-startup --python tools/blender/build_premium_clubhouse.py

The script creates project-owned texture maps, a reusable module-library GLB,
the complete empty clubhouse/site GLB, the editable Blender source, previews,
and a machine-readable build manifest.  No raw or third-party asset is read or
overwritten.  Geometry is authored in metres and exported glTF Y-up.
"""

from __future__ import annotations

import json
import math
import random
import sys
from array import array
from pathlib import Path
from typing import Iterable, Sequence

import bpy
from mathutils import Vector


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import assets_51_100_lib as A


REPO_ROOT = SCRIPT_DIR.parents[1]
SOURCE_DIR = REPO_ROOT / "asset_sources" / "blender" / "premium_clubhouse"
CANONICAL_DIR = REPO_ROOT / "Assets" / "premium_clubhouse" / "glb"
RUNTIME_DIR = REPO_ROOT / "vendor" / "models" / "premium_clubhouse"
TEXTURE_DIR = REPO_ROOT / "Assets" / "premium_clubhouse" / "textures"
QA_DIR = REPO_ROOT / "qa" / "premium-clubhouse" / "blender"

SOURCE_PATH = SOURCE_DIR / "premium_clubhouse_architecture.blend"
KIT_CANONICAL = CANONICAL_DIR / "premium_clubhouse_modular_kit.glb"
KIT_RUNTIME = RUNTIME_DIR / "premium_clubhouse_modular_kit.glb"
BUILDING_CANONICAL = CANONICAL_DIR / "premium_clubhouse_architecture.glb"
BUILDING_RUNTIME = RUNTIME_DIR / "premium_clubhouse_architecture.glb"
MANIFEST_PATH = CANONICAL_DIR / "premium_clubhouse_manifest.json"

WALL_T = 0.30
FLOOR_H = 3.60
FLOOR_Z = 0.30
BUILDING_W = 32.0
BUILDING_D = 10.0
EAVE_Z = FLOOR_Z + FLOOR_H * 2.0 + 0.05
RIDGE_Z = 10.85
BAY = 4.0
BUILDING_AREA_M2 = BUILDING_W * BUILDING_D * 2.0
BUILDING_AREA_FT2 = BUILDING_AREA_M2 * 10.76391041671

RNG = random.Random(55007000)


def ensure_dirs() -> None:
    for directory in (SOURCE_DIR, CANONICAL_DIR, RUNTIME_DIR, TEXTURE_DIR, QA_DIR):
        directory.mkdir(parents=True, exist_ok=True)


def root_empty(name: str, parent: bpy.types.Object | None = None, **properties: object) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.18
    for key, value in properties.items():
        obj[key] = value
    if parent is not None:
        obj.parent = parent
    return obj


def group(name: str, parent: bpy.types.Object, **properties: object) -> bpy.types.Object:
    return root_empty(name, parent, **properties)


def mark_module(root: bpy.types.Object, family: str, width: float, depth: float, height: float) -> None:
    root["module_template"] = True
    root["module_family"] = family
    root["dimensions_m"] = json.dumps([width, depth, height])
    root["authored_units"] = "meters"
    root["origin_contract"] = "finished-floor center; facade exterior faces -Y"
    root["expansion_grid_m"] = BAY


def socket(name: str, parent: bpy.types.Object, location=(0.0, 0.0, 0.0), **properties: object) -> bpy.types.Object:
    return A.socket(name, parent=parent, location=location, properties=properties)


def pivot(name: str, parent: bpy.types.Object, location=(0.0, 0.0, 0.0), **properties: object) -> bpy.types.Object:
    return A.pivot(name, parent=parent, location=location, properties=properties)


def mesh_object(
    name: str,
    vertices: Sequence[Sequence[float]],
    faces: Sequence[Sequence[int]],
    material: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    bevel: float = 0.006,
    collision: bool = False,
    properties: dict[str, object] | None = None,
) -> bpy.types.Object:
    data = bpy.data.meshes.new("GEO_" + name)
    data.from_pydata(vertices, [], faces)
    data.validate(verbose=False)
    data.update(calc_edges=True)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    A.finish_mesh(
        obj,
        material,
        bevel=0.0 if collision else bevel,
        bevel_segments=2,
        uv=False if collision else "smart",
        smooth=not collision,
        collision=collision,
        properties=properties,
    )
    obj.parent = parent
    return obj


def box(
    name: str,
    dimensions: Sequence[float],
    location: Sequence[float],
    material: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    bevel: float = 0.012,
    rotation=(0.0, 0.0, 0.0),
    properties: dict[str, object] | None = None,
) -> bpy.types.Object:
    return A.box(
        name,
        dimensions,
        location,
        material,
        rotation=rotation,
        parent=parent,
        bevel=bevel,
        bevel_segments=2,
        uv="smart",
        properties=properties,
    )


def collision_box(
    name: str,
    dimensions: Sequence[float],
    location: Sequence[float],
    parent: bpy.types.Object,
    collision_material: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    A.finish_mesh(
        obj,
        collision_material,
        uv=False,
        smooth=False,
        collision=True,
        properties={"collision_shape": "box", "runtime_visibility": "hidden"},
    )
    obj.parent = parent
    return obj


def cylinder(
    name: str,
    radius: float,
    depth: float,
    location: Sequence[float],
    material: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    vertices: int = 24,
    bevel: float = 0.006,
    rotation=(0.0, 0.0, 0.0),
) -> bpy.types.Object:
    return A.cylinder(
        name,
        radius,
        depth,
        location,
        material,
        parent=parent,
        vertices=vertices,
        bevel=bevel,
        rotation=rotation,
        uv="smart",
    )


def torus(
    name: str,
    major_radius: float,
    minor_radius: float,
    location: Sequence[float],
    material: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    rotation=(0.0, 0.0, 0.0),
    major_segments: int = 32,
    minor_segments: int = 10,
) -> bpy.types.Object:
    return A.torus(
        name,
        major_radius,
        minor_radius,
        location,
        material,
        rotation=rotation,
        parent=parent,
        major_segments=major_segments,
        minor_segments=minor_segments,
    )


def clone_tree(source: bpy.types.Object, parent: bpy.types.Object, name: str | None = None) -> bpy.types.Object:
    clone = source.copy()
    clone.data = source.data
    clone.animation_data_clear()
    clone.name = name or source.name
    bpy.context.collection.objects.link(clone)
    clone.parent = parent
    for child in source.children:
        clone_tree(child, clone, child.name)
    return clone


def place_module(
    template: bpy.types.Object,
    parent: bpy.types.Object,
    instance_name: str,
    location: Sequence[float],
    rotation_z: float = 0.0,
) -> bpy.types.Object:
    instance = clone_tree(template, parent, instance_name)
    instance.location = location
    instance.rotation_euler = (0.0, 0.0, rotation_z)
    instance.hide_render = False
    instance.hide_viewport = False
    instance["module_template"] = False
    instance["module_instance"] = True
    instance["source_template"] = template.name
    return instance


def _texture_pixel(kind: str, x: int, y: int, size: int) -> tuple[tuple[float, float, float], float, float]:
    """Return base RGB, normalized height, and roughness for a project-owned tile."""

    u = x / size
    v = y / size
    noise = (
        math.sin((x * 12.9898 + y * 78.233 + len(kind) * 9.17)) * 43758.5453
    ) % 1.0
    if kind == "limestone":
        course = int(v * 8)
        mortar_y = (y % max(2, size // 8)) < max(1, size // 96)
        offset = (size // 12) if course % 2 else 0
        mortar_x = ((x + offset) % max(4, size // 4)) < max(1, size // 96)
        mortar = mortar_y or mortar_x
        base = 0.73 + (noise - 0.5) * 0.08 + 0.025 * math.sin((x + y) * 0.15)
        rgb = (base * 1.05, base, base * 0.88)
        return rgb if not mortar else (0.43, 0.42, 0.37), 0.35 if mortar else 0.68 + noise * 0.10, 0.78
    if kind == "brick":
        rows = 12
        cell_h = max(4, size // rows)
        cell_w = cell_h * 3
        row = y // cell_h
        mortar = y % cell_h < max(1, size // 128) or (x + (cell_w // 2 if row % 2 else 0)) % cell_w < max(1, size // 128)
        warmth = 0.50 + (noise - 0.5) * 0.10
        rgb = (warmth * 1.12, warmth * 0.58, warmth * 0.36)
        return rgb if not mortar else (0.50, 0.46, 0.38), 0.30 if mortar else 0.72 + noise * 0.08, 0.83
    if kind == "walnut":
        grain = 0.82 + 0.11 * math.sin(v * math.tau * 18 + math.sin(u * math.tau * 3)) + (noise - 0.5) * 0.035
        return (0.48 * grain, 0.245 * grain, 0.105 * grain), 0.52 + 0.13 * grain, 0.53
    if kind == "slate":
        row_h = max(4, size // 16)
        row = y // row_h
        seam = y % row_h < 2 or (x + (row % 2) * (size // 16)) % max(4, size // 8) < 2
        value = 0.12 + (noise - 0.5) * 0.045
        return ((value, value * 1.03, value * 1.02) if not seam else (0.045, 0.05, 0.048)), 0.32 if seam else 0.64, 0.88
    if kind == "copper":
        patina = max(0.0, math.sin((u * 4.0 + v * 1.4) * math.tau) * 0.5 + noise - 0.76)
        return (0.56 - patina * 0.23, 0.31 + patina * 0.23, 0.13 + patina * 0.19), 0.60 + patina * 0.10, 0.31 + patina * 0.30
    if kind == "oak":
        grain = 0.90 + 0.07 * math.sin(v * math.tau * 15 + math.sin(u * math.tau * 2.0)) + (noise - 0.5) * 0.025
        return (0.54 * grain, 0.38 * grain, 0.22 * grain), 0.55 + grain * 0.10, 0.58
    if kind == "asphalt":
        # Keep the authored paving in the warm-charcoal range after the game
        # renderer's sRGB conversion and strong sun/shadow contrast.  Values in
        # the high teens read as pitch black in the player camera and erase the
        # aggregate detail, especially across the large parking fields.
        value = 0.30 + (noise - 0.5) * 0.060
        fleck = noise > 0.985
        return ((value + 0.08,) * 3 if fleck else (value * 0.98, value, value * 1.01)), 0.50 + noise * 0.18, 0.93
    if kind == "paver":
        cell = max(8, size // 8)
        mortar = x % cell < 2 or y % cell < 2
        value = 0.52 + (noise - 0.5) * 0.08
        return ((0.36, 0.35, 0.31) if mortar else (value * 1.07, value, value * 0.88)), 0.36 if mortar else 0.66, 0.79
    raise ValueError(kind)


def _write_texture_set(kind: str, size: int = 256) -> tuple[Path, Path, Path]:
    base_path = TEXTURE_DIR / f"premium_{kind}_basecolor.png"
    normal_path = TEXTURE_DIR / f"premium_{kind}_normal.png"
    roughness_path = TEXTURE_DIR / f"premium_{kind}_roughness.png"
    samples: list[tuple[tuple[float, float, float], float, float]] = []
    for y in range(size):
        for x in range(size):
            samples.append(_texture_pixel(kind, x, y, size))
    heights = [sample[1] for sample in samples]
    base_pixels = array("f")
    normal_pixels = array("f")
    rough_pixels = array("f")
    strength = 3.0
    for y in range(size):
        for x in range(size):
            rgb, _, roughness = samples[y * size + x]
            left = heights[y * size + (x - 1) % size]
            right = heights[y * size + (x + 1) % size]
            down = heights[((y - 1) % size) * size + x]
            up = heights[((y + 1) % size) * size + x]
            nx, ny, nz = (left - right) * strength, (down - up) * strength, 1.0
            length = math.sqrt(nx * nx + ny * ny + nz * nz)
            nx, ny, nz = nx / length, ny / length, nz / length
            base_pixels.extend((*rgb, 1.0))
            normal_pixels.extend((nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5, 1.0))
            rough_pixels.extend((roughness, roughness, roughness, 1.0))

    def save(name: str, path: Path, pixels: array, color_space: str) -> None:
        image = bpy.data.images.new(name, width=size, height=size, alpha=True, float_buffer=False)
        # Set the role before assigning pixels. Blender 5.1 reinitializes a
        # generated image when its colour space changes, which otherwise clears
        # the populated buffer back to black.
        image.colorspace_settings.name = color_space
        image.pixels.foreach_set(pixels)
        # Blender does not guarantee that foreach_set() reaches the encoded image
        # buffer until the datablock is explicitly updated. Without this call the
        # saved PNG can be the untouched black allocation even though the Python
        # pixel array is populated.
        image.update()
        image.file_format = "PNG"
        image.filepath_raw = str(path)
        image.save()
        image.pack()
        image["project_owned"] = True
        image["generated_by"] = Path(__file__).name

    save(f"TEX_{kind}_BaseColor", base_path, base_pixels, "sRGB")
    save(f"TEX_{kind}_Normal", normal_path, normal_pixels, "Non-Color")
    save(f"TEX_{kind}_Roughness", roughness_path, rough_pixels, "Non-Color")
    return base_path, normal_path, roughness_path


def textured_material(
    name: str,
    kind: str,
    *,
    metallic: float = 0.0,
    normal_strength: float = 0.42,
) -> bpy.types.Material:
    base_path, normal_path, rough_path = _write_texture_set(kind)
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.use_backface_culling = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = 0.65
    texcoord = nodes.new("ShaderNodeTexCoord")
    base = nodes.new("ShaderNodeTexImage")
    base.image = bpy.data.images.load(str(base_path), check_existing=True)
    base.extension = "REPEAT"
    normal = nodes.new("ShaderNodeTexImage")
    normal.image = bpy.data.images.load(str(normal_path), check_existing=True)
    normal.image.colorspace_settings.name = "Non-Color"
    normal.extension = "REPEAT"
    rough = nodes.new("ShaderNodeTexImage")
    rough.image = bpy.data.images.load(str(rough_path), check_existing=True)
    rough.image.colorspace_settings.name = "Non-Color"
    rough.extension = "REPEAT"
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.inputs["Strength"].default_value = normal_strength
    links.new(texcoord.outputs["UV"], base.inputs["Vector"])
    links.new(texcoord.outputs["UV"], normal.inputs["Vector"])
    links.new(texcoord.outputs["UV"], rough.inputs["Vector"])
    links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(normal.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    material["project_owned"] = True
    material["source"] = "Generated in-repository by build_premium_clubhouse.py"
    material["style"] = "Pinehollow stylized PBR"
    return material


def create_materials() -> dict[str, bpy.types.Material]:
    palette = A.palette_materials()
    return {
        **palette,
        "limestone": textured_material("MAT_PC_Warm_Limestone", "limestone", normal_strength=0.52),
        "brick": textured_material("MAT_PC_Clubhouse_Brick", "brick", normal_strength=0.58),
        "walnut": textured_material("MAT_PC_Premium_Walnut", "walnut", normal_strength=0.26),
        "oak": textured_material("MAT_PC_Natural_Oak", "oak", normal_strength=0.24),
        "slate": textured_material("MAT_PC_Charcoal_Slate", "slate", normal_strength=0.48),
        "copper": textured_material("MAT_PC_Aged_Copper", "copper", metallic=0.82, normal_strength=0.18),
        "asphalt": textured_material("MAT_PC_Premium_Asphalt", "asphalt", normal_strength=0.30),
        "paver": textured_material("MAT_PC_Cream_Paver", "paver", normal_strength=0.40),
        "interior": A.material("PC_InteriorWarmCream", (0.79, 0.73, 0.62, 1.0), roughness=0.84),
        "mortar": A.material("PC_LimestoneMortar", (0.43, 0.41, 0.35, 1.0), roughness=0.88),
        "water": A.material("PC_FountainWater", (0.10, 0.31, 0.34, 0.58), roughness=0.16, alpha=0.58, transmission=0.0, double_sided=True),
        "emissive": A.material(
            "PC_WarmArchitecturalLight",
            (0.95, 0.58, 0.22, 1.0),
            roughness=0.28,
            emission_color=(1.0, 0.47, 0.16),
            emission_strength=3.0,
        ),
        "soil": A.material("PC_LandscapeSoil", (0.15, 0.085, 0.045, 1.0), roughness=0.94),
        "leaf": A.material("PC_BoxwoodLeaf", (0.055, 0.21, 0.10, 1.0), roughness=0.86),
        "leaf_light": A.material("PC_BoxwoodLeafTips", (0.12, 0.31, 0.14, 1.0), roughness=0.84),
        "flower": A.material("PC_FloweringHydrangea", (0.48, 0.12, 0.20, 1.0), roughness=0.82),
        "flower_light": A.material("PC_FloweringHydrangeaTips", (0.72, 0.30, 0.34, 1.0), roughness=0.80),
        "line": A.material("PC_ParkingLine", (0.82, 0.76, 0.58, 1.0), roughness=0.77),
        "glass_perf": A.material(
            "PC_PerformanceGlass",
            (0.38, 0.58, 0.58, 0.34),
            roughness=0.18,
            alpha=0.34,
            transmission=0.0,
            ior=1.45,
            double_sided=True,
        ),
    }


def arch_ring(
    name: str,
    outer_radius: float,
    inner_radius: float,
    depth: float,
    location: Sequence[float],
    material: bpy.types.Material,
    parent: bpy.types.Object,
    segments: int = 18,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    half = depth / 2.0
    for side_y in (-half, half):
        for radius in (outer_radius, inner_radius):
            for index in range(segments + 1):
                angle = math.pi * index / segments
                vertices.append((math.cos(angle) * radius, side_y, math.sin(angle) * radius))
    row = segments + 1
    outer_front, inner_front, outer_back, inner_back = 0, row, row * 2, row * 3
    for index in range(segments):
        faces.append((outer_front + index, outer_front + index + 1, inner_front + index + 1, inner_front + index))
        faces.append((outer_back + index + 1, outer_back + index, inner_back + index, inner_back + index + 1))
        faces.append((outer_front + index, outer_back + index, outer_back + index + 1, outer_front + index + 1))
        faces.append((inner_front + index + 1, inner_back + index + 1, inner_back + index, inner_front + index))
    faces.extend([
        (outer_front, inner_front, inner_back, outer_back),
        (outer_front + segments, outer_back + segments, inner_back + segments, inner_front + segments),
    ])
    obj = mesh_object(name, vertices, faces, material, parent, bevel=0.004)
    obj.location = location
    return obj


def half_disc(
    name: str,
    radius: float,
    y: float,
    z: float,
    material: bpy.types.Material,
    parent: bpy.types.Object,
    segments: int = 18,
) -> bpy.types.Object:
    vertices = [(0.0, y, z)]
    vertices.extend((math.cos(math.pi * index / segments) * radius, y, z + math.sin(math.pi * index / segments) * radius)
                    for index in range(segments + 1))
    faces = [(0, index + 1, index + 2) for index in range(segments)]
    return mesh_object(name, vertices, faces, material, parent, bevel=0.0)


def build_window(
    name: str,
    width: float,
    height: float,
    materials: dict[str, bpy.types.Material],
    parent: bpy.types.Object,
    *,
    arched: bool = False,
) -> bpy.types.Object:
    root = group(name, parent, architectural_component="window", reusable=True)
    frame = materials["warm_cream"]
    glass = materials["glass_perf"]
    walnut = materials["walnut"]
    depth = 0.105
    stile = 0.095
    sill = 0.12
    box(f"{name}_Sill", (width + 0.24, depth + 0.06, sill), (0.0, -0.005, sill / 2), materials["limestone"], root, bevel=0.018)
    box(f"{name}_LeftStile", (stile, depth, height), (-(width - stile) / 2, 0.0, sill + height / 2), frame, root, bevel=0.01)
    box(f"{name}_RightStile", (stile, depth, height), ((width - stile) / 2, 0.0, sill + height / 2), frame, root, bevel=0.01)
    box(f"{name}_BottomRail", (width, depth, stile), (0.0, 0.0, sill + stile / 2), frame, root, bevel=0.01)
    box(f"{name}_TopRail", (width, depth, stile), (0.0, 0.0, sill + height - stile / 2), frame, root, bevel=0.01)
    box(f"{name}_Glass", (width - stile * 2.0, 0.012, height - stile * 2.0), (0.0, 0.012, sill + height / 2), glass, root, bevel=0.0)
    box(f"{name}_MullionV", (0.052, depth + 0.012, height - stile * 2.0), (0.0, -0.005, sill + height / 2), walnut, root, bevel=0.006)
    for fraction in (0.34, 0.67):
        box(f"{name}_MullionH_{int(fraction * 100)}", (width - stile * 2.0, depth + 0.012, 0.045),
            (0.0, -0.005, sill + height * fraction), walnut, root, bevel=0.005)
    if arched:
        radius = width * 0.47
        center_z = sill + height - radius - 0.06
        arch_ring(f"{name}_StoneArch", radius + 0.15, radius, 0.14, (0.0, -0.045, center_z), materials["limestone"], root)
        arch_ring(f"{name}_WoodArch", radius, max(0.05, radius - 0.075), depth, (0.0, -0.01, center_z), walnut, root)
        half_disc(f"{name}_ArchGlass", max(0.05, radius - 0.075), 0.014, center_z, glass, root)
        box(f"{name}_ArchTransom", (width - 0.14, depth + 0.015, 0.055), (0.0, -0.006, center_z), walnut, root, bevel=0.006)
    socket("WindowCenter", root, (0.0, 0.0, sill + height / 2), opening_width_m=width, opening_height_m=height)
    return root


def build_door_leaf(
    name: str,
    width: float,
    height: float,
    hinge_x: float,
    direction: float,
    materials: dict[str, bpy.types.Material],
    parent: bpy.types.Object,
) -> bpy.types.Object:
    hinge = pivot(name + "_Hinge", parent, (hinge_x, 0.0, 0.0), hinge_axis="+Z", max_open_degrees=105)
    center_x = hinge_x + direction * width / 2.0
    box(name + "_Slab", (width - 0.025, 0.075, height), (center_x, 0.0, height / 2), materials["walnut"], hinge, bevel=0.018)
    panel_w = width * 0.70
    for panel_index, panel_z in enumerate((0.52, 1.30, 2.18)):
        panel_h = 0.48 if panel_index < 2 else max(0.36, height - 2.35)
        box(f"{name}_RaisedPanel_{panel_index + 1}", (panel_w, 0.025, panel_h),
            (center_x, -0.050, panel_z), materials["medium_walnut"], hinge, bevel=0.02)
    handle_x = center_x + direction * width * 0.34
    cylinder(name + "_Handle", 0.032, 0.11, (handle_x, -0.105, 1.08), materials["restrained_brass"], hinge,
             vertices=16, rotation=(math.pi / 2, 0.0, 0.0))
    box(name + "_KickPlate", (width * 0.68, 0.018, 0.24), (center_x, -0.052, 0.20), materials["restrained_brass"], hinge, bevel=0.006)
    socket("Grip", hinge, (handle_x, -0.11, 1.08), interaction="door_handle")
    return hinge


def build_door(
    name: str,
    width: float,
    height: float,
    materials: dict[str, bpy.types.Material],
    parent: bpy.types.Object,
    *,
    double: bool = False,
    service: bool = False,
) -> bpy.types.Object:
    root = group(name, parent, architectural_component="door", reusable=True, door_type="double" if double else "single")
    frame_mat = materials["warm_charcoal"] if service else materials["limestone"]
    frame_w = 0.16
    box(name + "_FrameLeft", (frame_w, 0.18, height + 0.22), (-(width + frame_w) / 2, 0.0, (height + 0.22) / 2), frame_mat, root, bevel=0.016)
    box(name + "_FrameRight", (frame_w, 0.18, height + 0.22), ((width + frame_w) / 2, 0.0, (height + 0.22) / 2), frame_mat, root, bevel=0.016)
    box(name + "_Lintel", (width + frame_w * 2.0, 0.18, 0.18), (0.0, 0.0, height + 0.13), frame_mat, root, bevel=0.016)
    box(name + "_Threshold", (width + 0.16, 0.28, 0.07), (0.0, -0.02, 0.035), materials["limestone"], root, bevel=0.012)
    if double:
        leaf_w = width / 2.0
        build_door_leaf(name + "_LeftLeaf", leaf_w, height, -width / 2.0, 1.0, materials, root)
        build_door_leaf(name + "_RightLeaf", leaf_w, height, width / 2.0, -1.0, materials, root)
    else:
        build_door_leaf(name + "_Leaf", width, height, -width / 2.0, 1.0, materials, root)
    socket("Threshold", root, (0.0, 0.0, 0.0), clear_width_m=width)
    return root


def build_rollup_door(
    name: str,
    width: float,
    height: float,
    materials: dict[str, bpy.types.Material],
    parent: bpy.types.Object,
) -> bpy.types.Object:
    root = group(name, parent, architectural_component="maintenance_door", reusable=True)
    frame = materials["warm_charcoal"]
    box(name + "_LeftJamb", (0.18, 0.22, height + 0.28), (-(width + 0.18) / 2, 0.0, (height + 0.28) / 2), frame, root, bevel=0.012)
    box(name + "_RightJamb", (0.18, 0.22, height + 0.28), ((width + 0.18) / 2, 0.0, (height + 0.28) / 2), frame, root, bevel=0.012)
    box(name + "_Header", (width + 0.36, 0.22, 0.28), (0.0, 0.0, height + 0.14), frame, root, bevel=0.012)
    panel = box(name + "_Panel", (width, 0.09, height), (0.0, 0.0, height / 2), materials["muted_sage"], root, bevel=0.008)
    panel["moving_component"] = True
    panel["motion"] = "vertical_rollup"
    for index in range(1, 11):
        box(f"{name}_Slat_{index:02d}", (width - 0.08, 0.018, 0.025), (0.0, -0.055, height * index / 11.0), frame, root, bevel=0.002)
    pivot(name + "_LiftAxis", root, (0.0, 0.0, height), hinge_axis="+X", motion="rollup")
    socket("Threshold", root, (0.0, 0.0, 0.0), clear_width_m=width)
    return root


def _wall_piece(
    name: str,
    dimensions: Sequence[float],
    location: Sequence[float],
    outer_material: bpy.types.Material,
    materials: dict[str, bpy.types.Material],
    parent: bpy.types.Object,
    *,
    collision: bool = True,
) -> None:
    box(name, dimensions, location, outer_material, parent, bevel=0.010)
    liner_location = (location[0], WALL_T / 2 + 0.015, location[2])
    liner_dims = (dimensions[0], 0.028, dimensions[2])
    box(name + "_InteriorLiner", liner_dims, liner_location, materials["interior"], parent, bevel=0.002)
    if collision:
        collision_box(name + "_Collision", dimensions, location, parent, materials["collision"])


def build_wall_bay(
    name: str,
    materials: dict[str, bpy.types.Material],
    parent: bpy.types.Object,
    *,
    width: float = BAY,
    finish: str = "limestone",
    level: str = "ground",
    aperture: str = "solid",
) -> bpy.types.Object:
    root = group(name, parent, architectural_component="wall_bay", finish=finish, level=level, aperture=aperture)
    mark_module(root, "wall", width, WALL_T, FLOOR_H)
    outer = materials[finish]
    opening_w = 0.0
    opening_h = 0.0
    sill_z = 0.0
    inserted: bpy.types.Object | None = None
    if aperture == "window_tall":
        opening_w, opening_h, sill_z = 1.70, 2.55, 0.48
    elif aperture == "window_upper":
        opening_w, opening_h, sill_z = 1.48, 1.88, 0.72
    elif aperture == "door_double":
        opening_w, opening_h, sill_z = 2.60, 2.98, 0.0
    elif aperture == "door_single":
        opening_w, opening_h, sill_z = 1.30, 2.62, 0.0
    elif aperture == "maintenance":
        opening_w, opening_h, sill_z = 3.34, 3.30, 0.0

    if aperture == "solid":
        _wall_piece(name + "_Field", (width, WALL_T, FLOOR_H), (0.0, 0.0, FLOOR_H / 2), outer, materials, root)
    else:
        side_w = (width - opening_w) / 2.0
        _wall_piece(name + "_LeftPier", (side_w, WALL_T, FLOOR_H), (-(opening_w + side_w) / 2, 0.0, FLOOR_H / 2), outer, materials, root)
        _wall_piece(name + "_RightPier", (side_w, WALL_T, FLOOR_H), ((opening_w + side_w) / 2, 0.0, FLOOR_H / 2), outer, materials, root)
        if sill_z > 0:
            _wall_piece(name + "_SillField", (opening_w, WALL_T, sill_z), (0.0, 0.0, sill_z / 2), outer, materials, root)
        header_h = FLOOR_H - (sill_z + opening_h)
        if header_h > 0.02:
            _wall_piece(name + "_HeaderField", (opening_w, WALL_T, header_h), (0.0, 0.0, sill_z + opening_h + header_h / 2), outer, materials, root)

        insert_root = group(name + "_InsertedArchitecture", root)
        insert_root.location = (0.0, -WALL_T / 2 - 0.035, sill_z)
        if aperture.startswith("window"):
            inserted = build_window(
                name + "_Window",
                opening_w - 0.16,
                opening_h - 0.16,
                materials,
                insert_root,
                arched=aperture == "window_tall",
            )
        elif aperture == "door_double":
            inserted = build_door(name + "_Door", 2.40, 2.80, materials, insert_root, double=True)
        elif aperture == "door_single":
            inserted = build_door(name + "_Door", 1.10, 2.40, materials, insert_root)
        elif aperture == "maintenance":
            inserted = build_rollup_door(name + "_Door", 3.12, 3.12, materials, insert_root)

    if level == "ground":
        box(name + "_StonePlinth", (width + 0.05, 0.10, 0.74), (0.0, -WALL_T / 2 - 0.045, 0.37), materials["limestone"], root, bevel=0.010)
        box(name + "_PlinthCap", (width + 0.08, 0.14, 0.09), (0.0, -WALL_T / 2 - 0.065, 0.79), materials["limestone"], root, bevel=0.012)
    box(name + "_BeltCourse", (width + 0.04, 0.12, 0.11), (0.0, -WALL_T / 2 - 0.055, FLOOR_H - 0.11), materials["limestone"], root, bevel=0.012)
    socket("BayWest", root, (-width / 2, 0.0, 0.0), grid_m=BAY)
    socket("BayEast", root, (width / 2, 0.0, 0.0), grid_m=BAY)
    socket("LevelAbove", root, (0.0, 0.0, FLOOR_H), grid_m=FLOOR_H)
    if inserted is not None:
        socket("ApertureCenter", root, (0.0, 0.0, sill_z + opening_h / 2), aperture=aperture)
    return root


def build_corner_pier(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    root = group(name, parent, architectural_component="corner_pier")
    mark_module(root, "corner", 0.60, 0.60, FLOOR_H)
    box(name + "_Core", (0.60, 0.60, FLOOR_H), (0.0, 0.0, FLOOR_H / 2), materials["brick"], root, bevel=0.012)
    for index in range(8):
        z = 0.22 + index * 0.43
        offset = 0.035 if index % 2 else 0.0
        box(f"{name}_QuoinA_{index:02d}", (0.30 + offset, 0.10, 0.25), (-0.16, -0.35, z), materials["limestone"], root, bevel=0.010)
        box(f"{name}_QuoinB_{index:02d}", (0.10, 0.30 + offset, 0.25), (-0.35, -0.16, z), materials["limestone"], root, bevel=0.010)
    collision_box(name + "_Collision", (0.60, 0.60, FLOOR_H), (0.0, 0.0, FLOOR_H / 2), root, materials["collision"])
    socket("WallX", root, (0.30, 0.0, 0.0), grid_m=BAY)
    socket("WallY", root, (0.0, 0.30, 0.0), grid_m=BAY)
    return root


def build_column(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object, height: float = 6.50) -> bpy.types.Object:
    root = group(name, parent, architectural_component="column", order="Tuscan")
    mark_module(root, "column", 0.82, 0.82, height)
    stone = materials["limestone"]
    box(name + "_Plinth", (0.82, 0.82, 0.18), (0.0, 0.0, 0.09), stone, root, bevel=0.025)
    box(name + "_LowerBase", (0.68, 0.68, 0.15), (0.0, 0.0, 0.255), stone, root, bevel=0.025)
    torus(name + "_BaseTorus", 0.30, 0.055, (0.0, 0.0, 0.39), stone, root, major_segments=28)
    cylinder(name + "_Shaft", 0.255, height - 1.12, (0.0, 0.0, 0.48 + (height - 1.12) / 2), stone, root, vertices=32, bevel=0.012)
    torus(name + "_NeckRing", 0.27, 0.035, (0.0, 0.0, height - 0.48), stone, root, major_segments=28)
    cylinder(name + "_CapitalEchinus", 0.34, 0.17, (0.0, 0.0, height - 0.35), stone, root, vertices=32, bevel=0.018)
    box(name + "_Abacus", (0.74, 0.74, 0.18), (0.0, 0.0, height - 0.16), stone, root, bevel=0.024)
    collision_box(name + "_Collision", (0.58, 0.58, height), (0.0, 0.0, height / 2), root, materials["collision"])
    socket("Capital", root, (0.0, 0.0, height), load_bearing=True)
    return root


def build_cornice(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object, width: float = BAY) -> bpy.types.Object:
    root = group(name, parent, architectural_component="cornice")
    mark_module(root, "cornice", width, 0.42, 0.42)
    stone = materials["limestone"]
    box(name + "_BedMould", (width, 0.30, 0.10), (0.0, -0.03, 0.05), stone, root, bevel=0.014)
    box(name + "_Frieze", (width, 0.24, 0.17), (0.0, 0.0, 0.18), stone, root, bevel=0.012)
    box(name + "_Crown", (width + 0.04, 0.39, 0.12), (0.0, -0.065, 0.325), stone, root, bevel=0.018)
    for index in range(max(1, round(width / 0.5))):
        x = -width / 2 + (index + 0.5) * width / max(1, round(width / 0.5))
        box(f"{name}_Dentil_{index + 1:02d}", (0.18, 0.09, 0.10), (x, -0.245, 0.18), stone, root, bevel=0.008)
    socket("CorniceWest", root, (-width / 2, 0.0, 0.0), grid_m=BAY)
    socket("CorniceEast", root, (width / 2, 0.0, 0.0), grid_m=BAY)
    return root


def build_sconce(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    root = group(name, parent, architectural_component="exterior_sconce")
    mark_module(root, "lighting_mount", 0.32, 0.28, 0.58)
    cylinder(name + "_Backplate", 0.13, 0.045, (0.0, 0.0, 0.30), materials["restrained_brass"], root,
             vertices=24, rotation=(math.pi / 2, 0.0, 0.0))
    box(name + "_Arm", (0.055, 0.24, 0.055), (0.0, -0.10, 0.30), materials["restrained_brass"], root, bevel=0.012)
    box(name + "_Lantern", (0.24, 0.18, 0.34), (0.0, -0.22, 0.18), materials["warm_charcoal"], root, bevel=0.018)
    box(name + "_Glow", (0.15, 0.115, 0.23), (0.0, -0.315, 0.18), materials["emissive"], root, bevel=0.014)
    socket("Light", root, (0.0, -0.36, 0.18), color_temperature_k=2700, range_m=7.5, intensity_lm=520)
    return root


def build_roof_slope(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    run = BUILDING_D / 2 + 0.72
    rise = RIDGE_Z - EAVE_Z
    length = math.hypot(run, rise)
    angle = math.atan2(rise, run)
    root = group(name, parent, architectural_component="roof_slope", pitch_degrees=math.degrees(angle))
    mark_module(root, "roof", BAY, length, 0.18)
    box(name + "_SlatePanel", (BAY + 0.04, length, 0.16), (0.0, 0.0, 0.0), materials["slate"], root,
        bevel=0.010)
    for seam in (-1.0, 0.0, 1.0):
        box(f"{name}_StandingSeam_{seam:+.0f}", (0.026, length, 0.025), (seam, -0.01, 0.095), materials["warm_charcoal"], root, bevel=0.005)
    box(name + "_CopperDripEdge", (BAY + 0.06, 0.10, 0.055), (0.0, -length / 2 + 0.04, 0.02), materials["copper"], root, bevel=0.008)
    socket("RoofWest", root, (-BAY / 2, 0.0, 0.0), grid_m=BAY)
    socket("RoofEast", root, (BAY / 2, 0.0, 0.0), grid_m=BAY)
    socket("Eave", root, (0.0, -length / 2, 0.0), roof_pitch_degrees=math.degrees(angle))
    socket("Ridge", root, (0.0, length / 2, 0.0), roof_pitch_degrees=math.degrees(angle))
    return root


def build_dormer(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    root = group(name, parent, architectural_component="dormer")
    mark_module(root, "dormer", 1.80, 1.45, 2.10)
    box(name + "_FrontWall", (1.80, 0.22, 1.45), (0.0, 0.0, 0.725), materials["limestone"], root, bevel=0.010)
    window_mount = group(name + "_WindowMount", root)
    window_mount.location = (0.0, -0.15, 0.30)
    build_window(name + "_Window", 1.05, 0.94, materials, window_mount, arched=True)
    roof_angle = math.radians(32)
    slope_len = 1.25
    box(name + "_RoofLeft", (1.18, slope_len, 0.11), (-0.48, -0.02, 1.68), materials["slate"], root,
        bevel=0.008, rotation=(0.0, -roof_angle, 0.0))
    box(name + "_RoofRight", (1.18, slope_len, 0.11), (0.48, -0.02, 1.68), materials["slate"], root,
        bevel=0.008, rotation=(0.0, roof_angle, 0.0))
    box(name + "_CopperFlashing", (1.88, 0.12, 0.07), (0.0, 0.12, 0.05), materials["copper"], root, bevel=0.008)
    collision_box(name + "_Collision", (1.80, 1.15, 1.75), (0.0, 0.12, 0.875), root, materials["collision"])
    socket("RoofRegister", root, (0.0, 0.0, 0.0), pitch_degrees=30)
    return root


def build_veranda_bay(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    root = group(name, parent, architectural_component="covered_veranda")
    mark_module(root, "veranda", BAY, 3.20, 3.55)
    box(name + "_Slab", (BAY, 3.20, 0.18), (0.0, -1.60, 0.09), materials["paver"], root, bevel=0.012)
    for x in (-1.75, 1.75):
        post = group(f"{name}_Post_{'W' if x < 0 else 'E'}", root)
        box(post.name + "_Base", (0.46, 0.46, 0.17), (x, -2.86, 0.265), materials["limestone"], post, bevel=0.018)
        box(post.name + "_Shaft", (0.30, 0.30, 2.88), (x, -2.86, 1.78), materials["warm_cream"], post, bevel=0.012)
        box(post.name + "_Capital", (0.49, 0.49, 0.18), (x, -2.86, 3.31), materials["limestone"], post, bevel=0.018)
    angle = math.radians(9)
    roof_length = 3.48
    box(name + "_CopperRoof", (BAY + 0.18, roof_length, 0.12), (0.0, -1.62, 3.42), materials["copper"], root,
        bevel=0.010, rotation=(angle, 0.0, 0.0))
    box(name + "_Fascia", (BAY + 0.22, 0.17, 0.28), (0.0, -3.25, 3.17), materials["walnut"], root, bevel=0.014)
    sconce_mount = group(name + "_LightMount", root)
    sconce_mount.location = (0.0, -2.85, 3.02)
    sconce_mount.rotation_euler = (math.pi / 2, 0.0, 0.0)
    build_sconce(name + "_CeilingLight", materials, sconce_mount)
    collision_box(name + "_FrontPostCollisionW", (0.38, 0.38, 3.25), (-1.75, -2.86, 1.72), root, materials["collision"])
    collision_box(name + "_FrontPostCollisionE", (0.38, 0.38, 3.25), (1.75, -2.86, 1.72), root, materials["collision"])
    socket("VerandaWest", root, (-BAY / 2, 0.0, 0.0), grid_m=BAY)
    socket("VerandaEast", root, (BAY / 2, 0.0, 0.0), grid_m=BAY)
    return root


def triangular_prism(
    name: str,
    width: float,
    depth: float,
    height: float,
    base_z: float,
    material: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    x = width / 2
    y = depth / 2
    vertices = [
        (-x, -y, base_z), (x, -y, base_z), (0.0, -y, base_z + height),
        (-x, y, base_z), (x, y, base_z), (0.0, y, base_z + height),
    ]
    faces = [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    return mesh_object(name, vertices, faces, material, parent, bevel=0.012)


def build_balustrade(
    name: str,
    materials: dict[str, bpy.types.Material],
    parent: bpy.types.Object,
    *,
    width: float = BAY,
) -> bpy.types.Object:
    root = group(name, parent, architectural_component="stone_balustrade", reusable=True)
    mark_module(root, "balustrade", width, 0.34, 1.08)
    stone = materials["limestone"]
    box(name + "_PlinthRail", (width, 0.30, 0.16), (0.0, 0.0, 0.08), stone, root, bevel=0.025)
    box(name + "_TopRail", (width + 0.06, 0.36, 0.17), (0.0, 0.0, 0.995), stone, root, bevel=0.032)
    for side in (-1, 1):
        box(f"{name}_EndPost_{side:+d}", (0.34, 0.34, 0.92),
            (side * (width / 2 - 0.17), 0.0, 0.54), stone, root, bevel=0.035)
        box(f"{name}_EndCap_{side:+d}", (0.43, 0.43, 0.13),
            (side * (width / 2 - 0.17), 0.0, 1.03), stone, root, bevel=0.032)
    baluster_count = max(3, round(width / 0.42))
    clear_width = width - 0.72
    for index in range(baluster_count):
        x = -clear_width / 2 + (index + 0.5) * clear_width / baluster_count
        cylinder(f"{name}_Baluster_{index + 1:02d}_Lower", 0.085, 0.24,
                 (x, 0.0, 0.35), stone, root, vertices=16, bevel=0.014)
        cylinder(f"{name}_Baluster_{index + 1:02d}_Body", 0.065, 0.42,
                 (x, 0.0, 0.66), stone, root, vertices=16, bevel=0.012)
        cylinder(f"{name}_Baluster_{index + 1:02d}_Upper", 0.095, 0.18,
                 (x, 0.0, 0.91), stone, root, vertices=16, bevel=0.014)
    collision_box(name + "_Collision", (width, 0.30, 1.08), (0.0, 0.0, 0.54), root, materials["collision"])
    socket("BalustradeWest", root, (-width / 2, 0.0, 0.0), grid_m=BAY)
    socket("BalustradeEast", root, (width / 2, 0.0, 0.0), grid_m=BAY)
    return root


def build_interior_guardrail(
    name: str,
    materials: dict[str, bpy.types.Material],
    parent: bpy.types.Object,
    *,
    width: float = BAY,
) -> bpy.types.Object:
    root = group(name, parent, architectural_component="interior_guardrail", reusable=True)
    mark_module(root, "guardrail", width, 0.16, 1.08)
    box(name + "_FloorShoe", (width, 0.14, 0.09), (0.0, 0.0, 0.045),
        materials["warm_charcoal"], root, bevel=0.014)
    post_count = max(3, round(width / 0.72) + 1)
    for index in range(post_count):
        x = -width / 2 + index * width / (post_count - 1)
        cylinder(f"{name}_Post_{index + 1:02d}", 0.035, 0.98, (x, 0.0, 0.54),
                 materials["warm_charcoal"], root, vertices=12, bevel=0.006)
    for z in (0.38, 0.72):
        box(f"{name}_HorizontalRail_{z:.2f}", (width, 0.07, 0.065), (0.0, 0.0, z),
            materials["restrained_brass"], root, bevel=0.016)
    box(name + "_WalnutTopRail", (width + 0.08, 0.15, 0.10), (0.0, 0.0, 1.02),
        materials["walnut"], root, bevel=0.026)
    collision_box(name + "_Collision", (width, 0.14, 1.08), (0.0, 0.0, 0.54), root, materials["collision"])
    socket("GuardrailWest", root, (-width / 2, 0.0, 0.0), grid_m=BAY)
    socket("GuardrailEast", root, (width / 2, 0.0, 0.0), grid_m=BAY)
    return root


def build_pavilion_gable(
    name: str,
    materials: dict[str, bpy.types.Material],
    parent: bpy.types.Object,
) -> bpy.types.Object:
    """Projecting cross-gable that gives each facade wing a mansion-scale mass."""

    width = 7.60
    depth = 3.60
    rise = 3.05
    root = group(name, parent, architectural_component="projecting_pavilion_gable", reusable=True)
    mark_module(root, "pavilion_gable", width, depth, rise)
    face = triangular_prism(name + "_StonePediment", width, 0.34, rise, 0.0, materials["limestone"], root)
    face.location.y = -depth / 2 + 0.05
    inset = triangular_prism(name + "_CreamTympanum", width - 0.72, 0.08, rise - 0.48,
                             0.20, materials["warm_cream"], root)
    inset.location.y = -depth / 2 - 0.16
    box(name + "_BaseCornice", (width + 0.22, 0.52, 0.24),
        (0.0, -depth / 2 - 0.08, 0.12), materials["limestone"], root, bevel=0.030)

    run = width / 2 + 0.34
    slope_length = math.hypot(run, rise)
    angle = math.atan2(rise, run)
    for side in (-1, 1):
        box(f"{name}_SlateRoof_{side:+d}", (slope_length, depth, 0.16),
            (side * run / 2, 0.0, rise / 2 + 0.13), materials["slate"], root,
            bevel=0.012, rotation=(0.0, side * angle, 0.0))
        box(f"{name}_CopperRake_{side:+d}", (slope_length + 0.08, 0.14, 0.11),
            (side * run / 2, -depth / 2 - 0.25, rise / 2 + 0.15), materials["copper"], root,
            bevel=0.015, rotation=(0.0, side * angle, 0.0))

    cylinder(name + "_OculusBackplate", 0.54, 0.08, (0.0, -depth / 2 - 0.26, 1.08),
             materials["glass_perf"], root, vertices=36, bevel=0.014, rotation=(math.pi / 2, 0.0, 0.0))
    torus(name + "_OculusStoneRing", 0.52, 0.10, (0.0, -depth / 2 - 0.33, 1.08),
          materials["limestone"], root, rotation=(math.pi / 2, 0.0, 0.0), major_segments=36)
    box(name + "_OculusMullionV", (0.07, 0.06, 0.84),
        (0.0, -depth / 2 - 0.39, 1.08), materials["walnut"], root, bevel=0.010)
    box(name + "_OculusMullionH", (0.84, 0.06, 0.07),
        (0.0, -depth / 2 - 0.39, 1.08), materials["walnut"], root, bevel=0.010)
    collision_box(name + "_Collision", (width, 0.38, rise),
                  (0.0, -depth / 2, rise / 2), root, materials["collision"])
    socket("PavilionCenter", root, (0.0, -depth / 2, 0.0), facade_axis="-Y")
    socket("RoofTieIn", root, (0.0, depth / 2, rise * 0.55), stable=True)
    return root


def build_portico(name: str, column_template: bpy.types.Object, materials: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    root = group(name, parent, architectural_component="grand_portico")
    mark_module(root, "portico", 10.0, 4.50, 9.55)
    box(name + "_GrandStoop", (10.0, 4.50, 0.24), (0.0, -2.25, 0.12), materials["paver"], root, bevel=0.018)
    for step in range(3):
        box(f"{name}_Step_{step + 1}", (7.6 + step * 0.55, 0.56, 0.14),
            (0.0, -4.62 - step * 0.44, 0.23 - step * 0.14), materials["limestone"], root, bevel=0.018)
    for index, x in enumerate((-4.05, -1.35, 1.35, 4.05), 1):
        placed = place_module(column_template, root, f"{name}_Column_{index:02d}", (x, -4.08, 0.24))
        placed["structural_role"] = "portico_column"
    box(name + "_Entablature", (10.25, 0.78, 0.70), (0.0, -4.08, 6.67), materials["limestone"], root, bevel=0.024)
    triangular_prism(name + "_PedimentFace", 10.25, 0.42, 2.30, 7.02, materials["limestone"], root).location.y = -4.25
    tympanum = triangular_prism(name + "_TympanumInset", 8.75, 0.10, 1.62, 7.24, materials["warm_cream"], root)
    tympanum.location.y = -4.49
    cylinder(name + "_ClubCrestBackplate", 0.48, 0.075, (0.0, -4.58, 7.86),
             materials["walnut"], root, vertices=36, bevel=0.024, rotation=(math.pi / 2, 0.0, 0.0))
    torus(name + "_ClubCrestRing", 0.38, 0.055, (0.0, -4.64, 7.86),
          materials["restrained_brass"], root, rotation=(math.pi / 2, 0.0, 0.0), major_segments=32)
    for side in (-1, 1):
        box(f"{name}_CrestLaurel_{side:+d}", (0.07, 0.055, 0.58),
            (side * 0.22, -4.67, 7.84), materials["restrained_brass"], root,
            bevel=0.018, rotation=(0.0, side * math.radians(22), 0.0))
    roof_angle = math.atan2(2.45, 5.55)
    slope_length = math.hypot(5.55, 2.45)
    box(name + "_PedimentRoofW", (slope_length, 4.75, 0.16), (-2.52, -2.30, 8.27), materials["copper"], root,
        bevel=0.012, rotation=(0.0, -roof_angle, 0.0))
    box(name + "_PedimentRoofE", (slope_length, 4.75, 0.16), (2.52, -2.30, 8.27), materials["copper"], root,
        bevel=0.012, rotation=(0.0, roof_angle, 0.0))
    box(name + "_PedimentCornice", (10.55, 0.54, 0.21), (0.0, -4.33, 7.03), materials["limestone"], root, bevel=0.022)
    socket("MainArrival", root, (0.0, -5.25, 0.0), entrance="member")
    socket("ValetStop", root, (0.0, -8.0, 0.0), entrance="valet")
    return root


def build_stair(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    root = group(name, parent, architectural_component="interior_stair")
    run = 5.40
    width = 1.90
    steps = 20
    rise = FLOOR_H / steps
    tread = run / steps
    mark_module(root, "stair", width, run, FLOOR_H)
    for index in range(steps):
        box(f"{name}_Tread_{index + 1:02d}", (width, tread + 0.025, 0.055),
            (0.0, -run / 2 + (index + 0.5) * tread, (index + 1) * rise), materials["oak"], root, bevel=0.008)
        box(f"{name}_Riser_{index + 1:02d}", (width, 0.045, rise),
            (0.0, -run / 2 + index * tread, index * rise + rise / 2), materials["walnut"], root, bevel=0.004)
    for side in (-1, 1):
        for index in range(0, steps + 1, 4):
            x = side * (width / 2 - 0.06)
            y = -run / 2 + index * tread
            z = index * rise + 0.52
            cylinder(f"{name}_Baluster_{side:+d}_{index:02d}", 0.028, 1.02, (x, y, z), materials["warm_charcoal"], root, vertices=12)
        rail_length = math.hypot(run, FLOOR_H)
        angle = math.atan2(FLOOR_H, run)
        box(f"{name}_Handrail_{side:+d}", (0.085, rail_length, 0.095),
            (side * (width / 2 - 0.06), 0.0, FLOOR_H / 2 + 0.95), materials["walnut"], root,
            bevel=0.018, rotation=(angle, 0.0, 0.0))
    collision_box(name + "_Collision", (width, run, FLOOR_H), (0.0, 0.0, FLOOR_H / 2), root, materials["collision"])
    socket("LowerLanding", root, (0.0, -run / 2, 0.0), finished_floor=True)
    socket("UpperLanding", root, (0.0, run / 2, FLOOR_H), finished_floor=True)
    return root


def annulus_mesh(
    name: str,
    inner_radius: float,
    outer_radius: float,
    height: float,
    material: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    segments: int = 96,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    for z in (0.0, height):
        for radius in (inner_radius, outer_radius):
            vertices.extend((math.cos(math.tau * index / segments) * radius,
                             math.sin(math.tau * index / segments) * radius, z)
                            for index in range(segments))
    inner_bottom, outer_bottom, inner_top, outer_top = 0, segments, segments * 2, segments * 3
    for index in range(segments):
        nxt = (index + 1) % segments
        faces.extend([
            # Winding is explicit rather than repaired after export: top faces
            # point +Z, outer walls point away from the circle, and inner walls
            # point toward its centre. Reversed annulus normals appeared as
            # near-black curb bands in the game's single-sided PBR materials.
            (inner_top + index, outer_top + index, outer_top + nxt, inner_top + nxt),
            (outer_bottom + index, outer_bottom + nxt, outer_top + nxt, outer_top + index),
            (inner_bottom + index, inner_top + index, inner_top + nxt, inner_bottom + nxt),
        ])
    return mesh_object(name, vertices, faces, material, parent, bevel=0.008)


def build_fountain(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    root = group(name, parent, architectural_component="premium_fountain")
    mark_module(root, "fountain", 8.0, 8.0, 3.65)
    cylinder(name + "_Foundation", 4.00, 0.24, (0.0, 0.0, 0.12), materials["limestone"], root, vertices=64, bevel=0.025)
    annulus_mesh(name + "_OuterBasin", 3.34, 3.82, 0.56, materials["limestone"], root, segments=64).location.z = 0.20
    cylinder(name + "_WaterPlane", 3.32, 0.035, (0.0, 0.0, 0.49), materials["water"], root, vertices=64, bevel=0.0)
    cylinder(name + "_PedestalBase", 0.92, 0.34, (0.0, 0.0, 0.67), materials["limestone"], root, vertices=36, bevel=0.025)
    cylinder(name + "_Pedestal", 0.42, 1.42, (0.0, 0.0, 1.55), materials["limestone"], root, vertices=32, bevel=0.018)
    cylinder(name + "_LowerBowl", 1.42, 0.18, (0.0, 0.0, 2.18), materials["limestone"], root, vertices=48, bevel=0.03)
    cylinder(name + "_UpperStem", 0.26, 0.82, (0.0, 0.0, 2.68), materials["limestone"], root, vertices=28, bevel=0.016)
    cylinder(name + "_UpperBowl", 0.82, 0.14, (0.0, 0.0, 3.10), materials["limestone"], root, vertices=40, bevel=0.025)
    cylinder(name + "_Finial", 0.12, 0.48, (0.0, 0.0, 3.39), materials["copper"], root, vertices=20, bevel=0.015)

    # Eight mesh water arcs make the fountain read as active in the exported
    # game asset without depending on particles. Each curve is converted to a
    # reusable, batchable mesh so the runtime remains deterministic and cheap.
    for index in range(8):
        angle = math.tau * index / 8
        curve_data = bpy.data.curves.new(f"CURVE_{name}_WaterArc_{index + 1:02d}", "CURVE")
        curve_data.dimensions = "3D"
        curve_data.resolution_u = 1
        curve_data.bevel_depth = 0.026
        curve_data.bevel_resolution = 2
        spline = curve_data.splines.new("POLY")
        samples = 13
        spline.points.add(samples - 1)
        for sample in range(samples):
            t = sample / (samples - 1)
            radius = 0.48 + (2.58 - 0.48) * t
            height = 2.12 + (0.58 - 2.12) * t + 0.72 * 4.0 * t * (1.0 - t)
            spline.points[sample].co = (
                math.cos(angle) * radius,
                math.sin(angle) * radius,
                height,
                1.0,
            )
        arc = bpy.data.objects.new(f"MESH_{name}_WaterArc_{index + 1:02d}", curve_data)
        bpy.context.scene.collection.objects.link(arc)
        arc.parent = root
        arc.data.materials.append(materials["water"])
        bpy.ops.object.select_all(action="DESELECT")
        arc.select_set(True)
        bpy.context.view_layer.objects.active = arc
        bpy.ops.object.convert(target="MESH")
        arc.select_set(False)
        arc["architectural_detail"] = "fountain_water_arc"
        arc["reusable"] = True
    for index in range(8):
        angle = math.tau * index / 8
        socket(f"WaterJet_{index + 1:02d}", root, (math.cos(angle) * 1.16, math.sin(angle) * 1.16, 0.54),
               water_target=(0.0, 0.0, 2.15))
        socket(f"UnderwaterLight_{index + 1:02d}", root, (math.cos(angle) * 2.50, math.sin(angle) * 2.50, 0.52),
               color_temperature_k=3000, range_m=4.5, intensity_lm=330)
    collision_box(name + "_Collision", (8.0, 8.0, 0.78), (0.0, 0.0, 0.39), root, materials["collision"])
    return root


def build_sidewalk(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    root = group(name, parent, architectural_component="sidewalk")
    mark_module(root, "sidewalk", BAY, 2.0, 0.14)
    box(name + "_Paver", (BAY, 2.0, 0.14), (0.0, 0.0, 0.07), materials["paver"], root, bevel=0.010)
    box(name + "_Curb", (BAY, 0.18, 0.24), (0.0, -0.91, 0.12), materials["limestone"], root, bevel=0.016)
    collision_box(name + "_Collision", (BAY, 2.0, 0.14), (0.0, 0.0, 0.07), root, materials["collision"])
    socket("SidewalkWest", root, (-BAY / 2, 0.0, 0.0), grid_m=BAY)
    socket("SidewalkEast", root, (BAY / 2, 0.0, 0.0), grid_m=BAY)
    return root


def build_shrub(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    root = group(name, parent, landscape_component="boxwood_shrub", reusable=True)
    cylinder(name + "_Trunk", 0.08, 0.58, (0.0, 0.0, 0.29), materials["walnut"], root, vertices=10, bevel=0.006)
    for index, (x, y, z, scale) in enumerate(((-0.24, 0.0, 0.66, 0.52), (0.22, 0.03, 0.70, 0.50),
                                               (0.0, -0.10, 0.92, 0.58), (0.05, 0.18, 0.62, 0.44)), 1):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=scale, location=(x, y, z))
        leaf = bpy.context.object
        A.finish_mesh(leaf, materials["leaf_light"] if index == 3 else materials["leaf"], uv="smart", smooth=True)
        leaf.name = f"MESH_{name}_Canopy_{index:02d}"
        leaf.parent = root
    return root


def build_flowering_shrub(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    root = group(name, parent, landscape_component="flowering_hydrangea", reusable=True)
    mark_module(root, "landscape", 1.45, 1.20, 1.18)
    cylinder(name + "_Trunk", 0.075, 0.48, (0.0, 0.0, 0.24), materials["walnut"], root,
             vertices=10, bevel=0.006)
    leaf_positions = ((-0.27, -0.06, 0.55, 0.46), (0.26, 0.03, 0.58, 0.48),
                      (-0.04, 0.20, 0.72, 0.45), (0.02, -0.18, 0.76, 0.48))
    for index, (x, y, z, radius) in enumerate(leaf_positions, 1):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius, location=(x, y, z))
        leaf = bpy.context.object
        A.finish_mesh(leaf, materials["leaf_light"] if index % 2 else materials["leaf"], uv="smart", smooth=True)
        leaf.name = f"MESH_{name}_LeafMass_{index:02d}"
        leaf.parent = root
    flower_positions = ((-0.34, -0.10, 0.88), (0.33, -0.04, 0.91), (0.0, 0.22, 1.01),
                        (-0.08, -0.27, 1.03), (0.18, 0.08, 1.10), (-0.42, 0.15, 0.78))
    for index, (x, y, z) in enumerate(flower_positions, 1):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.19 if index % 3 else 0.16,
                                              location=(x, y, z))
        flower = bpy.context.object
        A.finish_mesh(flower, materials["flower_light"] if index % 2 else materials["flower"], uv="smart", smooth=True)
        flower.name = f"MESH_{name}_FlowerHead_{index:02d}"
        flower.parent = root
    socket("LandscapeCenter", root, (0.0, 0.0, 0.0), stable=True)
    return root


def build_chimney(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    root = group(name, parent, architectural_component="roof_chimney", reusable=True)
    mark_module(root, "roof_detail", 1.45, 1.25, 3.20)
    box(name + "_BrickShaft", (1.12, 0.94, 2.56), (0.0, 0.0, 1.28), materials["brick"], root, bevel=0.018)
    box(name + "_StoneShoulder", (1.34, 1.16, 0.22), (0.0, 0.0, 2.12), materials["limestone"], root, bevel=0.026)
    box(name + "_UpperBrick", (0.96, 0.82, 0.56), (0.0, 0.0, 2.48), materials["brick"], root, bevel=0.014)
    box(name + "_StoneCapLower", (1.28, 1.10, 0.18), (0.0, 0.0, 2.82), materials["limestone"], root, bevel=0.028)
    box(name + "_StoneCapUpper", (1.44, 1.24, 0.16), (0.0, 0.0, 2.99), materials["limestone"], root, bevel=0.030)
    for side in (-1, 1):
        box(f"{name}_CopperFlue_{side:+d}", (0.25, 0.34, 0.34), (side * 0.25, 0.0, 3.17),
            materials["copper"], root, bevel=0.035)
    collision_box(name + "_Collision", (1.12, 0.94, 2.75), (0.0, 0.0, 1.375), root, materials["collision"])
    socket("RoofRegister", root, (0.0, 0.0, 0.0), stable=True)
    socket("FlueService", root, (0.0, 0.0, 3.20), clearance_m=0.75)
    return root


def build_coffered_ceiling_bay(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    root = group(name, parent, architectural_component="coffered_ceiling", reusable=True)
    mark_module(root, "ceiling", BAY, 5.0, 0.30)
    # The panel is flush to the structural ceiling; moulded beams project down.
    box(name + "_RecessedPanel", (BAY - 0.24, 4.76, 0.055), (0.0, 0.0, 0.12),
        materials["warm_cream"], root, bevel=0.010)
    for x in (-BAY / 2 + 0.10, 0.0, BAY / 2 - 0.10):
        box(f"{name}_BeamX_{x:+.1f}", (0.20, 5.0, 0.24), (x, 0.0, 0.0),
            materials["limestone"], root, bevel=0.024)
    for y in (-2.40, 0.0, 2.40):
        box(f"{name}_BeamY_{y:+.1f}", (BAY, 0.20, 0.24), (0.0, y, 0.0),
            materials["limestone"], root, bevel=0.024)
    cylinder(name + "_BrassCanopy", 0.18, 0.055, (0.0, 0.0, -0.15), materials["restrained_brass"], root,
             vertices=24, bevel=0.010)
    cylinder(name + "_WarmLens", 0.11, 0.035, (0.0, 0.0, -0.195), materials["emissive"], root,
             vertices=24, bevel=0.012)
    socket("Light", root, (0.0, 0.0, -0.24), color_temperature_k=2700, range_m=7.5, intensity_lm=900)
    socket("CeilingWest", root, (-BAY / 2, 0.0, 0.0), grid_m=BAY)
    socket("CeilingEast", root, (BAY / 2, 0.0, 0.0), grid_m=BAY)
    return root


def build_templates(materials: dict[str, bpy.types.Material]) -> tuple[bpy.types.Object, dict[str, bpy.types.Object]]:
    kit = root_empty(
        "PC_MODULAR_KIT_ROOT",
        asset_id="premium_clubhouse_modular_kit",
        authored_units="meters",
        area_target_ft2="5500-7000",
        source="Original project-owned Golf Flipper architecture",
        license="Project-owned",
        visual_reference="Designs/ClubHouse Course 5 row",
    )
    templates: dict[str, bpy.types.Object] = {}

    def add(key: str, value: bpy.types.Object) -> None:
        templates[key] = value
        value["template_key"] = key

    add("wall_ground_stone_solid", build_wall_bay("MOD_WALL_GROUND_STONE_SOLID_4000", materials, kit))
    add("wall_ground_stone_window", build_wall_bay("MOD_WALL_GROUND_STONE_WINDOW_4000", materials, kit, aperture="window_tall"))
    add("wall_ground_stone_double", build_wall_bay("MOD_WALL_GROUND_STONE_DOUBLE_DOOR_4000", materials, kit, aperture="door_double"))
    add("wall_ground_stone_single", build_wall_bay("MOD_WALL_GROUND_STONE_SINGLE_DOOR_4000", materials, kit, aperture="door_single"))
    add("wall_ground_brick_solid", build_wall_bay("MOD_WALL_GROUND_BRICK_SOLID_4000", materials, kit, finish="brick"))
    add("wall_ground_brick_window", build_wall_bay("MOD_WALL_GROUND_BRICK_WINDOW_4000", materials, kit, finish="brick", aperture="window_tall"))
    add("wall_ground_brick_double", build_wall_bay("MOD_WALL_GROUND_BRICK_DOUBLE_DOOR_4000", materials, kit, finish="brick", aperture="door_double"))
    add("wall_ground_brick_single", build_wall_bay("MOD_WALL_GROUND_BRICK_SINGLE_DOOR_4000", materials, kit, finish="brick", aperture="door_single"))
    add("wall_ground_brick_maintenance", build_wall_bay("MOD_WALL_GROUND_BRICK_MAINTENANCE_4000", materials, kit, finish="brick", aperture="maintenance"))
    add("wall_ground_stone_solid_2000", build_wall_bay("MOD_WALL_GROUND_STONE_SOLID_2000", materials, kit, width=2.0))
    add("wall_ground_brick_solid_2000", build_wall_bay("MOD_WALL_GROUND_BRICK_SOLID_2000", materials, kit, width=2.0, finish="brick"))
    add("wall_ground_grand_entry", build_wall_bay("MOD_WALL_GRAND_MEMBER_ENTRY_8000", materials, kit, width=8.0, aperture="door_double"))
    add("wall_upper_stone_solid", build_wall_bay("MOD_WALL_UPPER_STONE_SOLID_4000", materials, kit, level="upper"))
    add("wall_upper_stone_window", build_wall_bay("MOD_WALL_UPPER_STONE_WINDOW_4000", materials, kit, level="upper", aperture="window_upper"))
    add("wall_upper_stone_double", build_wall_bay("MOD_WALL_UPPER_STONE_DOUBLE_DOOR_4000", materials, kit, level="upper", aperture="door_double"))
    add("wall_upper_stone_solid_2000", build_wall_bay("MOD_WALL_UPPER_STONE_SOLID_2000", materials, kit, width=2.0, level="upper"))
    add("wall_upper_brick_solid", build_wall_bay("MOD_WALL_UPPER_BRICK_SOLID_4000", materials, kit, finish="brick", level="upper"))
    add("wall_upper_brick_window", build_wall_bay("MOD_WALL_UPPER_BRICK_WINDOW_4000", materials, kit, finish="brick", level="upper", aperture="window_upper"))
    add("wall_upper_brick_solid_2000", build_wall_bay("MOD_WALL_UPPER_BRICK_SOLID_2000", materials, kit, width=2.0, finish="brick", level="upper"))
    add("corner", build_corner_pier("MOD_CORNER_PIER_600", materials, kit))
    add("column", build_column("MOD_COLUMN_TUSCAN_550", materials, kit))
    add("portico", build_portico("MOD_GRAND_PORTICO_10000", templates["column"], materials, kit))
    add("balustrade_4000", build_balustrade("MOD_BALUSTRADE_STONE_4000", materials, kit))
    add("balustrade_2000", build_balustrade("MOD_BALUSTRADE_STONE_2000", materials, kit, width=2.0))
    add("guardrail_4000", build_interior_guardrail("MOD_GUARDRAIL_WALNUT_BRASS_4000", materials, kit))
    add("guardrail_2000", build_interior_guardrail("MOD_GUARDRAIL_WALNUT_BRASS_2000", materials, kit, width=2.0))
    add("pavilion_gable", build_pavilion_gable("MOD_PAVILION_GABLE_7600", materials, kit))
    add("cornice_4000", build_cornice("MOD_CORNICE_DENTIL_4000", materials, kit))
    add("cornice_2000", build_cornice("MOD_CORNICE_DENTIL_2000", materials, kit, width=2.0))
    add("roof", build_roof_slope("MOD_ROOF_SLOPE_SLATE_4000", materials, kit))
    add("dormer", build_dormer("MOD_DORMER_ARCHED_1800", materials, kit))
    add("cupola", build_cupola("MOD_ROOF_CUPOLA_3000", materials, kit))
    add("veranda", build_veranda_bay("MOD_VERANDA_COPPER_BAY_4000", materials, kit))
    add("stair", build_stair("MOD_INTERIOR_STAIR_1900", materials, kit))
    add("sidewalk", build_sidewalk("MOD_SIDEWALK_PAVER_4000", materials, kit))
    add("parking_bay", build_parking_bay("MOD_PARKING_BAY_2750", materials, kit))
    add("light_pole", build_light_pole("MOD_PARKING_LIGHT_6400", materials, kit))
    add("loading_dock", build_loading_dock("MOD_LOADING_DOCK_8000", materials, kit))
    add("fountain", build_fountain("MOD_PREMIUM_FOUNTAIN_8000", materials, kit))
    add("shrub", build_shrub("MOD_LANDSCAPE_BOXWOOD_1200", materials, kit))
    add("flowering_shrub", build_flowering_shrub("MOD_LANDSCAPE_HYDRANGEA_1450", materials, kit))
    add("sconce", build_sconce("MOD_EXTERIOR_SCONCE_580", materials, kit))
    add("chimney", build_chimney("MOD_ROOF_CHIMNEY_1450", materials, kit))
    add("coffered_ceiling", build_coffered_ceiling_bay("MOD_CEILING_COFFER_4000X5000", materials, kit))

    for template in templates.values():
        template.hide_render = True
        template.hide_viewport = True
    kit["template_count"] = len(templates)
    kit["template_keys"] = json.dumps(sorted(templates))
    return kit, templates


def add_upper_floor_with_stairwells(parent: bpy.types.Object, materials: dict[str, bpy.types.Material]) -> None:
    z = FLOOR_Z + FLOOR_H + 0.12
    thickness = 0.24
    # Two 2.4 x 6.0 m stairwells remain open. The surrounding slab is split into
    # structural rectangles rather than using a destructive Boolean.
    box("UpperFloor_Center", (17.6, BUILDING_D - 0.32, thickness), (0.0, 0.0, z), materials["interior"], parent, bevel=0.010)
    for side, x in ((-1, -14.5), (1, 14.5)):
        box(f"UpperFloor_End_{side:+d}", (3.0, BUILDING_D - 0.32, thickness), (x, 0.0, z), materials["interior"], parent, bevel=0.010)
        for y in (-4.0, 4.0):
            box(f"UpperFloor_StairEdge_{side:+d}_{y:+.0f}", (4.2, 1.68, thickness),
                (side * 10.9, y, z), materials["interior"], parent, bevel=0.010)
    # A thin oak finish is architecture, not furnishing, and can later be swapped
    # by the player without changing the structural slab.
    finish_z = z + thickness / 2 + 0.012
    box("UpperFloorFinish_Center", (17.52, BUILDING_D - 0.40, 0.024), (0.0, 0.0, finish_z), materials["natural_oak"], parent, bevel=0.003)
    for side, x in ((-1, -14.5), (1, 14.5)):
        box(f"UpperFloorFinish_End_{side:+d}", (2.92, BUILDING_D - 0.40, 0.024), (x, 0.0, finish_z), materials["natural_oak"], parent, bevel=0.003)
        for y in (-4.0, 4.0):
            box(f"UpperFloorFinish_StairEdge_{side:+d}_{y:+.0f}", (4.12, 1.60, 0.024),
                (side * 10.9, y, finish_z), materials["natural_oak"], parent, bevel=0.003)


def assemble_envelope(
    building: bpy.types.Object,
    templates: dict[str, bpy.types.Object],
    materials: dict[str, bpy.types.Material],
) -> tuple[bpy.types.Object, bpy.types.Object, bpy.types.Object]:
    envelope = group("ARCH_ClubhouseEnvelope", building, architectural_system="envelope")
    interior = group("ARCH_EmptyInterior", building, intentionally_empty=True, player_customizable=True)
    roof = group("ARCH_RoofSystem", building, architectural_system="roof")

    box("FoundationSlab", (BUILDING_W, BUILDING_D, FLOOR_Z), (0.0, 0.0, FLOOR_Z / 2), materials["limestone"], envelope, bevel=0.018)
    box("GroundFloorFinish", (BUILDING_W - 0.40, BUILDING_D - 0.40, 0.035),
        (0.0, 0.0, FLOOR_Z + 0.018), materials["natural_oak"], interior, bevel=0.004)
    add_upper_floor_with_stairwells(interior, materials)
    box("UpperCeiling", (BUILDING_W - 0.42, BUILDING_D - 0.42, 0.10),
        (0.0, 0.0, EAVE_Z - 0.11), materials["interior"], interior, bevel=0.006)

    # Ground-floor front: centered member entry, bag drop to the west, and a
    # distinct tournament entry to the east. All other bays remain architecture.
    front_ground = [
        (-14.0, "wall_ground_stone_window", "Front_Ground_W03_Window"),
        (-10.0, "wall_ground_stone_double", "Front_Ground_W02_BagDrop"),
        (-6.0, "wall_ground_stone_window", "Front_Ground_W01_Window"),
        (0.0, "wall_ground_grand_entry", "Front_Ground_Center_MemberEntrance"),
        (6.0, "wall_ground_stone_window", "Front_Ground_E01_Window"),
        (10.0, "wall_ground_stone_double", "Front_Ground_E02_TournamentEntrance"),
        (14.0, "wall_ground_stone_window", "Front_Ground_E03_Window"),
    ]
    for x, key, name in front_ground:
        place_module(templates[key], envelope, name, (x, -BUILDING_D / 2, FLOOR_Z))
    for index, x in enumerate((-14, -10, -6, -2, 2, 6, 10, 14), 1):
        key = "wall_upper_stone_double" if x in (-10, 10) else "wall_upper_stone_window"
        label = "BalconyDoor" if key == "wall_upper_stone_double" else "Window"
        place_module(templates[key], envelope, f"Front_Upper_{label}_{index:02d}",
                     (x, -BUILDING_D / 2, FLOOR_Z + FLOOR_H))

    rear_ground_keys = [
        "wall_ground_brick_maintenance", "wall_ground_brick_solid", "wall_ground_brick_window", "wall_ground_brick_window",
        "wall_ground_brick_window", "wall_ground_brick_double", "wall_ground_brick_solid", "wall_ground_brick_window",
    ]
    rear_names = ["MaintenanceEntrance", "ServiceWallW", "RearWindowW2", "RearWindowW1",
                  "RearWindowE1", "LoadingDockEntrance", "ServiceWallE", "RearWindowE2"]
    for index, (x, key, label) in enumerate(zip((-14, -10, -6, -2, 2, 6, 10, 14), rear_ground_keys, rear_names), 1):
        place_module(templates[key], envelope, f"Rear_Ground_{index:02d}_{label}",
                     (x, BUILDING_D / 2, FLOOR_Z), math.pi)
    for index, x in enumerate((-14, -10, -6, -2, 2, 6, 10, 14), 1):
        key = "wall_upper_brick_window" if index not in (2, 7) else "wall_upper_brick_solid"
        place_module(templates[key], envelope, f"Rear_Upper_{index:02d}",
                     (x, BUILDING_D / 2, FLOOR_Z + FLOOR_H), math.pi)

    # Side runs are 4 + 4 + 2 metres so the 10 m depth remains grid-compatible.
    west_ground = [(-3.0, "wall_ground_brick_window", "West_Window"),
                   (1.0, "wall_ground_brick_single", "West_EmployeeEntrance"),
                   (4.0, "wall_ground_brick_solid_2000", "West_ServiceReturn")]
    east_ground = [(-3.0, "wall_ground_stone_single", "East_MemberLockerEntrance"),
                   (1.0, "wall_ground_stone_window", "East_LockerWindow"),
                   (4.0, "wall_ground_stone_solid_2000", "East_TerraceReturn")]
    for y, key, name in west_ground:
        place_module(templates[key], envelope, name, (-BUILDING_W / 2, y, FLOOR_Z), -math.pi / 2)
    for y, key, name in east_ground:
        place_module(templates[key], envelope, name, (BUILDING_W / 2, y, FLOOR_Z), math.pi / 2)
    for side, x, rotation, finish in (("West", -BUILDING_W / 2, -math.pi / 2, "brick"),
                                      ("East", BUILDING_W / 2, math.pi / 2, "stone")):
        for index, (y, width) in enumerate(((-3.0, 4.0), (1.0, 4.0), (4.0, 2.0)), 1):
            key = f"wall_upper_{finish}_{'window' if width == 4.0 else 'solid_2000'}"
            place_module(templates[key], envelope, f"{side}_Upper_{index:02d}",
                         (x, y, FLOOR_Z + FLOOR_H), rotation)

    # Full-height facade pilasters break the repeated bays into an estate-scale
    # rhythm and keep the stone/brick transition legible from the driveway.
    for elevation, y, outward in (("Front", -5.22, -1), ("Rear", 5.22, 1)):
        for index, x in enumerate((-12.0, -8.0, -4.0, 4.0, 8.0, 12.0), 1):
            box(f"{elevation}_Pilaster_{index:02d}_Shaft", (0.34, 0.28, 6.78),
                (x, y, FLOOR_Z + 3.39), materials["limestone"], envelope, bevel=0.014)
            box(f"{elevation}_Pilaster_{index:02d}_Base", (0.52, 0.36, 0.28),
                (x, y + outward * 0.03, FLOOR_Z + 0.14), materials["limestone"], envelope, bevel=0.022)
            box(f"{elevation}_Pilaster_{index:02d}_Capital", (0.54, 0.38, 0.24),
                (x, y + outward * 0.03, EAVE_Z - 0.38), materials["limestone"], envelope, bevel=0.022)

    # Tall brick/limestone quoins define the mansion silhouette at every corner.
    for level in (FLOOR_Z, FLOOR_Z + FLOOR_H):
        for index, (x, y, rotation) in enumerate(((-16, -5, 0), (16, -5, math.pi / 2),
                                                  (16, 5, math.pi), (-16, 5, -math.pi / 2)), 1):
            place_module(templates["corner"], envelope, f"Corner_{index:02d}_{'Upper' if level > 1 else 'Ground'}",
                         (x, y, level), rotation)

    # Continuous reusable cornice modules around all elevations.
    for index, x in enumerate((-14, -10, -6, -2, 2, 6, 10, 14), 1):
        place_module(templates["cornice_4000"], envelope, f"Front_Cornice_{index:02d}", (x, -5.08, EAVE_Z - 0.34))
        place_module(templates["cornice_4000"], envelope, f"Rear_Cornice_{index:02d}", (x, 5.08, EAVE_Z - 0.34), math.pi)
    for side, x, rotation in (("West", -16.08, -math.pi / 2), ("East", 16.08, math.pi / 2)):
        for index, (y, key) in enumerate(((-3.0, "cornice_4000"), (1.0, "cornice_4000"), (4.0, "cornice_2000")), 1):
            place_module(templates[key], envelope, f"{side}_Cornice_{index:02d}", (x, y, EAVE_Z - 0.34), rotation)

    # Upper-level pavilion balconies are permanent architecture. Their modular
    # rail runs and simplified slab collisions remain independently replaceable.
    for side_name, center_x in (("West", -12.0), ("East", 12.0)):
        box(f"{side_name}_PavilionBalcony_Slab", (8.20, 3.30, 0.20),
            (center_x, -6.63, FLOOR_Z + FLOOR_H + 0.22), materials["paver"], envelope, bevel=0.018)
        collision_box(f"{side_name}_PavilionBalcony_SlabCollision", (8.20, 3.30, 0.20),
                      (center_x, -6.63, FLOOR_Z + FLOOR_H + 0.22), envelope, materials["collision"])
        for segment_index, x in enumerate((center_x - 2.0, center_x + 2.0), 1):
            place_module(templates["balustrade_4000"], envelope,
                         f"{side_name}_PavilionBalustrade_Front_{segment_index:02d}",
                         (x, -8.24, FLOOR_Z + FLOOR_H + 0.31))
        for return_index, x in enumerate((center_x - 4.02, center_x + 4.02), 1):
            place_module(templates["balustrade_2000"], envelope,
                         f"{side_name}_PavilionBalustrade_Return_{return_index:02d}",
                         (x, -7.22, FLOOR_Z + FLOOR_H + 0.31), math.pi / 2)

    # Two open architectural stairs; no furnishing or reception fixture is authored.
    place_module(templates["stair"], interior, "Interior_Stair_West", (-10.9, 0.0, FLOOR_Z))
    place_module(templates["stair"], interior, "Interior_Stair_East", (10.9, 0.0, FLOOR_Z), math.pi)
    upper_guardrail_z = FLOOR_Z + FLOOR_H + 0.24
    for side_name, center_x, closed_end_y in (("West", -10.9, -3.0), ("East", 10.9, 3.0)):
        for edge_index, x in enumerate((center_x - 1.20, center_x + 1.20), 1):
            place_module(templates["guardrail_4000"], interior,
                         f"Interior_{side_name}Stair_Guardrail_Long_{edge_index:02d}A",
                         (x, -1.0, upper_guardrail_z), math.pi / 2)
            place_module(templates["guardrail_2000"], interior,
                         f"Interior_{side_name}Stair_Guardrail_Long_{edge_index:02d}B",
                         (x, 2.0, upper_guardrail_z), math.pi / 2)
        place_module(templates["guardrail_2000"], interior,
                     f"Interior_{side_name}Stair_Guardrail_ClosedEnd",
                     (center_x, closed_end_y, upper_guardrail_z))
    for x in (-5.3, 0.0, 5.3):
        for y in (-2.3, 2.3):
            column = place_module(templates["column"], interior, f"Interior_StructuralColumn_{x:+.1f}_{y:+.1f}",
                                  (x, y, FLOOR_Z))
            column.scale = (0.72, 0.72, 0.55)

    # Reusable coffer bays make both unfurnished levels read as permanent luxury
    # architecture without baking furniture, counters, or decorative displays.
    for level_name, ceiling_z in (("Ground", FLOOR_Z + FLOOR_H - 0.08), ("Upper", EAVE_Z - 0.18)):
        for index, x in enumerate((-14.0, -10.0, -6.0, -2.0, 2.0, 6.0, 10.0, 14.0), 1):
            place_module(templates["coffered_ceiling"], interior,
                         f"Interior_{level_name}_CofferBay_{index:02d}", (x, 0.0, ceiling_z))

    # Modular gable roof: 16 repeated slopes, detailed end gables, six dormers,
    # copper ridge, gutters, and downspouts.
    run = BUILDING_D / 2 + 0.72
    rise = RIDGE_Z - EAVE_Z
    angle = math.atan2(rise, run)
    center_z = (EAVE_Z + RIDGE_Z) / 2
    for index, x in enumerate((-14, -10, -6, -2, 2, 6, 10, 14), 1):
        front = place_module(templates["roof"], roof, f"Roof_FrontSlope_{index:02d}", (x, -run / 2, center_z))
        front.rotation_euler = (angle, 0.0, 0.0)
        rear = place_module(templates["roof"], roof, f"Roof_RearSlope_{index:02d}", (x, run / 2, center_z))
        rear.rotation_euler = (angle, 0.0, math.pi)
    for side, x, rotation in (("West", -16.03, -math.pi / 2), ("East", 16.03, math.pi / 2)):
        gable = triangular_prism(f"Roof_{side}_Gable", BUILDING_D, WALL_T, RIDGE_Z - EAVE_Z,
                                 EAVE_Z, materials["brick"], roof)
        gable.location.x = x
        gable.rotation_euler.z = rotation
        for slope_sign in (-1, 1):
            rail_length = math.hypot(run, rise)
            cap = box(f"Roof_{side}_CopperRake_{slope_sign:+d}", (0.11, rail_length, 0.09),
                      (x + (-0.10 if side == "West" else 0.10), slope_sign * run / 2, center_z),
                      materials["copper"], roof, bevel=0.012,
                      rotation=(-slope_sign * angle, 0.0, 0.0))
            cap["architectural_detail"] = "gable_rake_flashing"
    box("Roof_CopperRidge", (BUILDING_W + 0.35, 0.22, 0.20), (0.0, 0.0, RIDGE_Z), materials["copper"], roof, bevel=0.035)
    for side_y, rotation in ((-5.68, 0.0), (5.68, math.pi)):
        cylinder(f"Roof_Gutter_{'Front' if side_y < 0 else 'Rear'}", 0.095, BUILDING_W + 0.24,
                 (0.0, side_y, EAVE_Z - 0.02), materials["copper"], roof,
                 vertices=20, bevel=0.005, rotation=(0.0, math.pi / 2, 0.0))
    for index, (x, y) in enumerate(((-15.6, -5.64), (15.6, -5.64), (-15.6, 5.64), (15.6, 5.64)), 1):
        cylinder(f"Roof_Downspout_{index:02d}", 0.065, 7.12, (x, y, 3.70), materials["copper"], roof, vertices=16, bevel=0.004)
    for index, x in enumerate((-4.0, 4.0), 1):
        place_module(templates["dormer"], roof, f"Dormer_Front_{index:02d}", (x, -4.20, 7.92))
    for index, x in enumerate((-8.0, 8.0), 1):
        place_module(templates["dormer"], roof, f"Dormer_Rear_{index:02d}", (x, 4.20, 7.92), math.pi)
    place_module(templates["cupola"], roof, "Roof_CentralCupola", (0.0, 0.0, RIDGE_Z - 0.10))
    for side_name, x in (("West", -12.0), ("East", 12.0)):
        place_module(templates["pavilion_gable"], roof, f"Roof_{side_name}_ProjectingPavilion",
                     (x, -5.38, EAVE_Z - 0.16))
    for index, (x, y, z) in enumerate(((-12.0, 1.55, 8.38), (12.0, 1.55, 8.38),
                                        (-7.3, -1.20, 9.06), (7.3, -1.20, 9.06)), 1):
        place_module(templates["chimney"], roof, f"Roof_EstateChimney_{index:02d}", (x, y, z))
    return envelope, interior, roof


def build_parking_bay(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    root = group(name, parent, architectural_component="parking_bay", empty=True)
    mark_module(root, "parking", 2.75, 5.50, 0.16)
    for side in (-1, 1):
        box(f"{name}_Line_{side:+d}", (0.075, 5.35, 0.018), (side * 1.3375, 0.0, 0.012), materials["line"], root, bevel=0.004)
    box(name + "_WheelStop", (1.82, 0.18, 0.14), (0.0, 2.15, 0.07), materials["limestone"], root, bevel=0.025)
    socket("BayCenter", root, (0.0, 0.0, 0.0), parking_width_m=2.75, parking_depth_m=5.50)
    return root


def build_light_pole(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    root = group(name, parent, architectural_component="parking_light")
    mark_module(root, "site_lighting", 1.80, 0.80, 6.40)
    cylinder(name + "_Footing", 0.38, 0.42, (0.0, 0.0, 0.21), materials["limestone"], root, vertices=24, bevel=0.018)
    cylinder(name + "_Pole", 0.095, 5.72, (0.0, 0.0, 3.05), materials["warm_charcoal"], root, vertices=18, bevel=0.006)
    box(name + "_CrossArm", (1.72, 0.12, 0.12), (0.0, 0.0, 5.96), materials["warm_charcoal"], root, bevel=0.020)
    for side in (-1, 1):
        box(f"{name}_Lantern_{side:+d}", (0.58, 0.36, 0.20), (side * 0.58, -0.12, 5.82), materials["warm_charcoal"], root, bevel=0.045)
        box(f"{name}_Glow_{side:+d}", (0.42, 0.24, 0.025), (side * 0.58, -0.31, 5.77), materials["emissive"], root, bevel=0.006)
        socket(f"Light_{side:+d}", root, (side * 0.58, -0.34, 5.72), color_temperature_k=3000, range_m=14.0, intensity_lm=2200)
    collision_box(name + "_Collision", (0.34, 0.34, 5.95), (0.0, 0.0, 2.98), root, materials["collision"])
    return root


def build_cupola(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    root = group(name, parent, architectural_component="roof_cupola")
    mark_module(root, "roof_detail", 3.0, 3.0, 3.55)
    box(name + "_Plinth", (3.00, 3.00, 0.28), (0.0, 0.0, 0.14), materials["limestone"], root, bevel=0.030)
    box(name + "_LowerCurb", (2.55, 2.55, 0.34), (0.0, 0.0, 0.43), materials["copper"], root, bevel=0.028)
    box(name + "_LanternCore", (2.10, 2.10, 1.52), (0.0, 0.0, 1.36), materials["warm_cream"], root, bevel=0.018)
    for side_index, (x, y, rotation) in enumerate(((0.0, -1.07, 0.0), (1.07, 0.0, math.pi / 2),
                                                   (0.0, 1.07, math.pi), (-1.07, 0.0, -math.pi / 2)), 1):
        opening = group(f"{name}_Louver_{side_index:02d}", root)
        opening.location = (x, y, 0.86)
        opening.rotation_euler.z = rotation
        box(f"{name}_Louver_{side_index:02d}_Recess", (1.22, 0.035, 0.92), (0.0, 0.0, 0.46), materials["warm_charcoal"], opening, bevel=0.020)
        for slat in range(4):
            box(f"{name}_Louver_{side_index:02d}_Slat_{slat + 1}", (1.04, 0.045, 0.07),
                (0.0, -0.035, 0.18 + slat * 0.19), materials["walnut"], opening, bevel=0.008,
                rotation=(math.radians(-18), 0.0, 0.0))
    box(name + "_Cornice", (2.52, 2.52, 0.24), (0.0, 0.0, 2.24), materials["limestone"], root, bevel=0.032)
    roof_vertices = [
        (-1.45, -1.45, 2.34), (1.45, -1.45, 2.34), (1.45, 1.45, 2.34), (-1.45, 1.45, 2.34),
        (-0.34, -0.34, 3.10), (0.34, -0.34, 3.10), (0.34, 0.34, 3.10), (-0.34, 0.34, 3.10),
    ]
    roof_faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]
    mesh_object(name + "_CopperRoof", roof_vertices, roof_faces, materials["copper"], root, bevel=0.018)
    cylinder(name + "_FinialStem", 0.085, 0.38, (0.0, 0.0, 3.28), materials["restrained_brass"], root, vertices=18, bevel=0.008)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.15, location=(0.0, 0.0, 3.51))
    finial = bpy.context.object
    A.finish_mesh(finial, materials["restrained_brass"], uv="smart", smooth=True)
    finial.name = f"MESH_{name}_Finial"
    finial.parent = root
    collision_box(name + "_Collision", (2.55, 2.55, 2.45), (0.0, 0.0, 1.22), root, materials["collision"])
    socket("RoofRegister", root, (0.0, 0.0, 0.0), stable=True)
    socket("BeaconLight", root, (0.0, -1.15, 1.52), color_temperature_k=2700, range_m=10.0, intensity_lm=850)
    return root


def ramp_wedge(
    name: str,
    width: float,
    depth: float,
    height: float,
    material: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    x, y = width / 2, depth / 2
    vertices = [(-x, -y, 0), (x, -y, 0), (-x, y, 0), (x, y, 0), (-x, y, height), (x, y, height)]
    faces = [(0, 1, 3, 2), (2, 3, 5, 4), (0, 2, 4), (1, 5, 3), (0, 4, 5, 1)]
    return mesh_object(name, vertices, faces, material, parent, bevel=0.010)


def build_loading_dock(name: str, materials: dict[str, bpy.types.Material], parent: bpy.types.Object) -> bpy.types.Object:
    root = group(name, parent, architectural_component="loading_dock", empty=True)
    mark_module(root, "service", 8.0, 5.0, 4.0)
    box(name + "_DockSlab", (8.0, 4.0, 0.82), (0.0, 1.0, 0.41), materials["paver"], root, bevel=0.018)
    ramp = ramp_wedge(name + "_AccessibleRamp", 2.0, 5.0, 0.82, materials["paver"], root)
    ramp.location = (3.0, -3.5, 0.0)
    for side in (-1, 1):
        box(f"{name}_CanopyPost_{side:+d}", (0.24, 0.24, 3.18), (side * 3.65, 2.65, 2.27), materials["warm_charcoal"], root, bevel=0.012)
    box(name + "_Canopy", (8.30, 3.30, 0.16), (0.0, 1.56, 3.90), materials["copper"], root, bevel=0.014,
        rotation=(math.radians(6), 0.0, 0.0))
    box(name + "_DockEdge", (8.0, 0.22, 0.24), (0.0, 3.02, 0.78), materials["warm_charcoal"], root, bevel=0.018)
    collision_box(name + "_Collision", (8.0, 4.0, 0.82), (0.0, 1.0, 0.41), root, materials["collision"])
    socket("TruckBay", root, (0.0, 6.5, 0.0), vehicle_clearance_m=4.2)
    socket("DockThreshold", root, (0.0, -1.0, 0.82), finished_floor=True)
    return root


def assemble_site(
    building: bpy.types.Object,
    templates: dict[str, bpy.types.Object],
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    site = group("ARCH_ClubhouseSite", building, architectural_system="site", intentionally_empty=True)

    # Grand member arrival plus separate covered bag-drop/tournament entrances.
    place_module(templates["portico"], site, "Arrival_GrandMemberPortico", (0.0, -BUILDING_D / 2, 0.0))
    place_module(templates["veranda"], site, "Arrival_BagDropCanopy", (-10.0, -BUILDING_D / 2, FLOOR_Z))
    place_module(templates["veranda"], site, "Arrival_TournamentCanopy", (10.0, -BUILDING_D / 2, FLOOR_Z))
    place_module(templates["veranda"], site, "Arrival_WestPavilionCanopyExtension", (-14.0, -BUILDING_D / 2, FLOOR_Z))
    place_module(templates["veranda"], site, "Arrival_EastPavilionCanopyExtension", (14.0, -BUILDING_D / 2, FLOOR_Z))
    for index, x in enumerate((-13.0, -7.0, 7.0, 13.0), 1):
        place_module(templates["sconce"], site, f"Front_Facade_Sconce_{index:02d}", (x, -5.26, 2.12))
        place_module(templates["sconce"], site, f"Rear_Facade_Sconce_{index:02d}", (x, 5.26, 2.12), math.pi)
    for side, x, rotation in (("West", -16.26, -math.pi / 2), ("East", 16.26, math.pi / 2)):
        for index, y in enumerate((-2.2, 2.2), 1):
            place_module(templates["sconce"], site, f"{side}_Facade_Sconce_{index:02d}", (x, y, 2.12), rotation)

    # Covered rear veranda and an unfurnished outdoor dining terrace.
    for index, x in enumerate((-14, -10, -6, -2, 2, 6, 10, 14), 1):
        place_module(templates["veranda"], site, f"Rear_Veranda_{index:02d}", (x, BUILDING_D / 2, FLOOR_Z), math.pi)
    box("OutdoorDiningTerrace", (18.0, 10.0, 0.18), (7.0, 11.5, 0.09), materials["paver"], site, bevel=0.018,
        properties={"intentionally_empty": True, "player_furnishing_zone": "outdoor_dining"})
    for x in (-1.8, 15.8):
        box(f"Terrace_RetainingWall_{x:+.1f}", (0.24, 10.0, 0.58), (x, 11.5, 0.29), materials["limestone"], site, bevel=0.018)
    box("Terrace_RearWall", (18.0, 0.24, 0.58), (7.0, 16.38, 0.29), materials["limestone"], site, bevel=0.018)

    # Circular valet drive and premium fountain define the reference silhouette.
    drive = annulus_mesh("CircularValetDrive", 12.0, 19.5, 0.12, materials["asphalt"], site, segments=96)
    drive.location = (0.0, -34.0, 0.0)
    drive["site_function"] = "circular_driveway"
    outer_drive_curb = annulus_mesh("CircularValetDrive_OuterCurb", 19.48, 19.88, 0.24,
                                    materials["limestone"], site, segments=96)
    outer_drive_curb.location = (0.0, -34.0, 0.02)
    outer_drive_curb["architectural_detail"] = "roundabout_outer_curb"
    island_curb = annulus_mesh("CircularDrive_LandscapeIslandCurb", 4.35, 11.70, 0.22,
                               materials["limestone"], site, segments=96)
    island_curb.location = (0.0, -34.0, 0.02)
    island_soil = annulus_mesh("CircularDrive_LandscapeIslandSoil", 4.75, 11.20, 0.16,
                               materials["soil"], site, segments=96)
    island_soil.location = (0.0, -34.0, 0.20)
    for index in range(28):
        angle = math.tau * index / 28
        radius = 8.15 + (0.46 if index % 2 else -0.34)
        shrub = place_module(templates["shrub"], site, f"CircularDrive_FormalShrub_{index + 1:02d}",
                              (math.cos(angle) * radius, -34.0 + math.sin(angle) * radius, 0.34))
        shrub.scale = (0.72, 0.72, 0.66 if index % 2 else 0.58)
    for index in range(14):
        angle = math.tau * (index + 0.5) / 14
        flower = place_module(templates["flowering_shrub"], site,
                              f"CircularDrive_FloweringShrub_{index + 1:02d}",
                              (math.cos(angle) * 10.05, -34.0 + math.sin(angle) * 10.05, 0.34))
        flower.scale = (0.64, 0.64, 0.58)
    fountain = place_module(templates["fountain"], site, "Arrival_PremiumFountain", (0.0, -34.0, 0.12))
    fountain["site_function"] = "fountain"
    box("ValetArrivalApron", (12.0, 14.0, 0.12), (0.0, -14.0, 0.06), materials["asphalt"], site, bevel=0.012,
        properties={"site_function": "valet_area", "intentionally_empty": True})
    box("MainApproachDrive", (12.0, 34.0, 0.12), (0.0, -69.0, 0.06), materials["asphalt"], site, bevel=0.012)

    # Two empty 40-space lots; dimensions exceed common premium 2.75 x 5.5 m bays.
    for lot_side, lot_x in (("West", -35.5), ("East", 35.5)):
        box(f"ParkingLot_{lot_side}_Asphalt", (29.0, 52.0, 0.12), (lot_x, -49.0, 0.06), materials["asphalt"], site, bevel=0.012,
            properties={"parking_capacity": 40, "intentionally_empty": True})
        for row, y in enumerate((-63.0, -35.0), 1):
            for bay_index in range(10):
                x = lot_x - 12.375 + bay_index * 2.75
                rotation = 0.0 if row == 1 else math.pi
                place_module(templates["parking_bay"], site,
                             f"Parking_{lot_side}_R{row}_B{bay_index + 1:02d}", (x, y, 0.13), rotation)
        # A second paired row faces each primary row across the drive aisle.
        for row, y in enumerate((-56.5, -41.5), 3):
            for bay_index in range(10):
                x = lot_x - 12.375 + bay_index * 2.75
                rotation = math.pi if row == 3 else 0.0
                place_module(templates["parking_bay"], site,
                             f"Parking_{lot_side}_R{row}_B{bay_index + 1:02d}", (x, y, 0.13), rotation)
        for lamp_index, (dx, y) in enumerate(((-12.0, -49.0), (0.0, -49.0), (12.0, -49.0)), 1):
            place_module(templates["light_pole"], site, f"Parking_{lot_side}_Light_{lamp_index:02d}",
                         (lot_x + dx, y, 0.12))

    # Broad paver walks connect all front entrances and the roundabout.
    for index, x in enumerate((-14, -10, -6, -2, 2, 6, 10, 14), 1):
        place_module(templates["sidewalk"], site, f"Front_Sidewalk_{index:02d}", (x, -9.0, 0.0))
    for side, x, rotation in (("West", -18.0, -math.pi / 2), ("East", 18.0, math.pi / 2)):
        for index, y in enumerate((-3, 1, 5, 9, 13), 1):
            place_module(templates["sidewalk"], site, f"{side}_Sidewalk_{index:02d}", (x, y, 0.0), rotation)

    # Empty cart staging for 18+ carts, separated from the loading dock.
    box("GolfCartStagingPad", (26.0, 11.0, 0.16), (-21.0, 14.0, 0.08), materials["paver"], site, bevel=0.016,
        properties={"site_function": "golf_cart_staging", "capacity": 20, "intentionally_empty": True})
    for index, x in enumerate((-31, -27, -23, -19, -15, -11), 1):
        canopy = place_module(templates["veranda"], site, f"CartStaging_Canopy_{index:02d}", (x, 10.0, 0.16), math.pi)
        canopy["site_function"] = "golf_cart_staging_cover"
    for line_index in range(11):
        x = -33.0 + line_index * 2.4
        box(f"CartStaging_Line_{line_index + 1:02d}", (0.055, 8.5, 0.016), (x, 15.0, 0.17), materials["line"], site, bevel=0.003)

    # Rear service court: loading dock, maintenance apron, and separate employee path.
    place_module(templates["loading_dock"], site, "Service_LoadingDock", (6.0, 6.0, 0.0), math.pi)
    box("Service_LoadingApron", (16.0, 16.0, 0.14), (10.0, 18.0, 0.07), materials["asphalt"], site, bevel=0.012,
        properties={"site_function": "loading_apron", "intentionally_empty": True})
    box("MaintenanceEntranceApron", (10.0, 8.0, 0.14), (-14.0, 9.0, 0.07), materials["asphalt"], site, bevel=0.012,
        properties={"site_function": "maintenance_entrance"})
    box("EmployeeEntranceWalk", (2.0, 10.0, 0.14), (-21.0, 1.0, 0.07), materials["paver"], site, bevel=0.012,
        properties={"site_function": "employee_entrance"})

    # Formal beds and repeated project-authored boxwood provide luxury landscaping
    # without adding furniture or third-party props.
    for bed_index, (x, y, width, depth) in enumerate(((-13.0, -12.0, 7.0, 2.2), (13.0, -12.0, 7.0, 2.2),
                                                       (-17.8, -34.0, 2.4, 12.0), (17.8, -34.0, 2.4, 12.0),
                                                       (-7.0, 17.0, 8.0, 2.0), (15.0, 17.0, 8.0, 2.0)), 1):
        box(f"LandscapeBed_{bed_index:02d}_Edging", (width + 0.24, depth + 0.24, 0.20), (x, y, 0.10), materials["limestone"], site, bevel=0.018)
        box(f"LandscapeBed_{bed_index:02d}_Soil", (width, depth, 0.10), (x, y, 0.20), materials["soil"], site, bevel=0.010)
        count = max(2, int(width / 1.25))
        for shrub_index in range(count):
            sx = x - width / 2 + (shrub_index + 0.5) * width / count
            template_key = "flowering_shrub" if (
                (bed_index in (1, 2) and shrub_index % 2 == 0)
                or (bed_index in (3, 4) and shrub_index % 3 == 1)
            ) else "shrub"
            shrub = place_module(templates[template_key], site,
                                  f"LandscapeBed_{bed_index:02d}_{'FloweringShrub' if template_key == 'flowering_shrub' else 'Shrub'}_{shrub_index + 1:02d}",
                                  (sx, y + (0.16 if shrub_index % 2 else -0.16), 0.25))
            shrub.rotation_euler.z = (shrub_index % 3 - 1) * 0.16

    return site


def descendants(root: bpy.types.Object) -> list[bpy.types.Object]:
    result = [root]
    queue = list(root.children)
    while queue:
        item = queue.pop(0)
        result.append(item)
        queue.extend(item.children)
    return result


def render_preview(
    building: bpy.types.Object,
    kit: bpy.types.Object,
    output_path: Path,
    *,
    night: bool = False,
    interior: bool = False,
) -> None:
    scene = bpy.context.scene
    studio = bpy.data.collections.new("__PC_QA_RENDER__")
    scene.collection.children.link(studio)
    old_camera = scene.camera
    old_world = scene.world
    old_engine = scene.render.engine
    old_filepath = scene.render.filepath
    old_resolution = (scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage)
    old_format = scene.render.image_settings.file_format
    old_exposure = scene.view_settings.look
    old_view_exposure = scene.view_settings.exposure
    hidden: list[tuple[bpy.types.Object, bool]] = []
    try:
        for obj in descendants(kit):
            hidden.append((obj, obj.hide_render))
            obj.hide_render = True
        for obj in descendants(building):
            if obj.get("collision_proxy"):
                hidden.append((obj, obj.hide_render))
                obj.hide_render = True

        world = bpy.data.worlds.new("PC_QA_WORLD")
        world.use_nodes = True
        background = world.node_tree.nodes.get("Background")
        background.inputs["Color"].default_value = (0.025, 0.045, 0.080, 1.0) if night else (0.34, 0.46, 0.64, 1.0)
        background.inputs["Strength"].default_value = 0.20 if night else 0.68
        scene.world = world
        try:
            scene.view_settings.look = "AgX - Medium Low Contrast"
        except Exception:
            pass
        scene.view_settings.exposure = 0.34 if night else 0.22

        def link_object(obj: bpy.types.Object) -> bpy.types.Object:
            studio.objects.link(obj)
            return obj

        def area(name: str, energy: float, size: float, position: Sequence[float], target: Sequence[float]) -> None:
            data = bpy.data.lights.new(name + "_DATA", "AREA")
            data.energy = energy
            data.shape = "DISK"
            data.size = size
            obj = link_object(bpy.data.objects.new(name, data))
            obj.location = position
            obj.rotation_euler = (Vector(target) - Vector(position)).to_track_quat("-Z", "Y").to_euler()

        def point(name: str, energy: float, radius: float, position: Sequence[float], color=(1.0, 0.50, 0.22)) -> None:
            data = bpy.data.lights.new(name + "_DATA", "POINT")
            data.energy = energy
            data.color = color
            data.shadow_soft_size = radius
            obj = link_object(bpy.data.objects.new(name, data))
            obj.location = position

        def sun(name: str, energy: float, rotation: Sequence[float], color=(1.0, 0.86, 0.68)) -> None:
            data = bpy.data.lights.new(name + "_DATA", "SUN")
            data.energy = energy
            data.color = color
            data.angle = math.radians(5.0)
            obj = link_object(bpy.data.objects.new(name, data))
            obj.rotation_euler = rotation

        if night:
            sun("PC_MoonSun", 0.28, (math.radians(32), 0.0, math.radians(-34)), color=(0.42, 0.56, 0.82))
            area("PC_Moon", 2600.0, 32.0, (-30.0, -42.0, 44.0), (0.0, -10.0, 3.0))
            area("PC_FacadeWash", 5800.0, 22.0, (0.0, -30.0, 12.0), (0.0, -2.0, 4.0))
            area("PC_FacadeFill", 3200.0, 16.0, (32.0, -20.0, 9.0), (4.0, -2.0, 3.4))
            for index, (x, y, z) in enumerate(((-13, -6.0, 2.4), (-7, -6.0, 2.4), (0, -10.0, 5.6),
                                               (7, -6.0, 2.4), (13, -6.0, 2.4),
                                               (-12, 6.2, 2.6), (0, 6.2, 2.6), (12, 6.2, 2.6)), 1):
                point(f"PC_WarmLight_{index:02d}", 1450.0, 0.86, (x, y, z))
            for index, (x, y) in enumerate(((-35.5, -49), (35.5, -49), (0, -34)), 1):
                point(f"PC_SiteLight_{index:02d}", 3900.0, 1.6, (x, y, 5.8), color=(1.0, 0.62, 0.34))
        else:
            sun("PC_DaylightSun", 1.65, (math.radians(27), math.radians(-18), math.radians(-38)))
            area("PC_SunKey", 7600.0, 20.0, (-18.0, -46.0, 48.0), (0.0, -8.0, 4.0))
            area("PC_FacadeFill", 9200.0, 24.0, (0.0, -34.0, 16.0), (0.0, -3.0, 3.6))
            area("PC_SkyFill", 4200.0, 28.0, (34.0, -6.0, 28.0), (0.0, 0.0, 4.0))

        if interior:
            camera_position = (0.0, -2.8, 1.92)
            camera_target = (9.8, 2.2, 2.15)
            area("PC_InteriorFill", 1050.0, 7.0, (0.0, 0.0, 6.6), (0.0, 0.0, 0.0))
            point("PC_InteriorWarm", 1150.0, 1.8, (7.0, 1.5, 2.8), color=(1.0, 0.60, 0.34))
        else:
            camera_position = (53.0, -86.0, 27.0)
            camera_target = (0.0, -20.0, 4.0)
        camera_data = bpy.data.cameras.new("PC_QA_CAMERA_DATA")
        camera_data.lens = 50.0 if not interior else 24.0
        camera_data.clip_start = 0.05
        camera_data.clip_end = 400.0
        camera = link_object(bpy.data.objects.new("PC_QA_CAMERA", camera_data))
        camera.location = camera_position
        camera.rotation_euler = (Vector(camera_target) - Vector(camera_position)).to_track_quat("-Z", "Y").to_euler()
        scene.camera = camera

        for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
            try:
                scene.render.engine = engine
                break
            except Exception:
                continue
        scene.render.resolution_x = 1600
        scene.render.resolution_y = 900
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = str(output_path)
        scene.render.film_transparent = False
        bpy.ops.render.render(write_still=True)
        if not output_path.is_file():
            raise RuntimeError(f"Preview render missing: {output_path}")
        print(f"PREVIEW|{output_path}|bytes={output_path.stat().st_size}")
    finally:
        scene.camera = old_camera
        scene.world = old_world
        scene.render.filepath = old_filepath
        scene.view_settings.exposure = old_view_exposure
        try:
            scene.view_settings.look = old_exposure
        except Exception:
            pass
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = old_resolution
        scene.render.image_settings.file_format = old_format
        try:
            scene.render.engine = old_engine
        except Exception:
            pass
        for obj, state in hidden:
            obj.hide_render = state
        for obj in list(studio.objects):
            data = obj.data
            obj_type = obj.type
            bpy.data.objects.remove(obj, do_unlink=True)
            if data is not None and data.users == 0:
                collection = {"CAMERA": bpy.data.cameras, "LIGHT": bpy.data.lights}.get(obj_type)
                if collection is not None:
                    collection.remove(data)
        scene.collection.children.unlink(studio)
        bpy.data.collections.remove(studio)
        if world.users == 0:
            bpy.data.worlds.remove(world)


def validate_build(building: bpy.types.Object, kit: bpy.types.Object) -> dict[str, object]:
    errors: list[str] = []
    warnings: list[str] = []
    building_nodes = descendants(building)
    kit_nodes = descendants(kit)
    visible_meshes = [obj for obj in building_nodes if obj.type == "MESH" and not obj.get("collision_proxy")]
    collisions = [obj for obj in building_nodes if obj.type == "MESH" and obj.get("collision_proxy")]
    pivots = [obj for obj in building_nodes if obj.name.startswith("PIVOT_")]
    sockets = [obj for obj in building_nodes if obj.name.startswith("SOCKET_")]
    module_templates = [obj for obj in kit.children if obj.get("module_template")]
    module_instances = [obj for obj in building_nodes if obj.get("module_instance")]
    materials = {material.name for obj in visible_meshes for material in obj.data.materials if material}
    triangles = 0
    unapplied: list[str] = []
    for obj in visible_meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        if any(abs(value - 1.0) > 1e-5 for value in obj.scale):
            unapplied.append(obj.name)
    if not 5500.0 <= BUILDING_AREA_FT2 <= 7000.0:
        errors.append(f"Enclosed area {BUILDING_AREA_FT2:.1f} ft2 is outside 5,500-7,000 ft2")
    if unapplied:
        errors.append(f"Visible mesh transforms not applied: {unapplied[:12]}")
    if len(module_templates) < 25:
        errors.append(f"Only {len(module_templates)} module templates found")
    if len(collisions) < 30:
        errors.append(f"Only {len(collisions)} collision proxies found")
    if len(pivots) < 10:
        errors.append(f"Only {len(pivots)} moving-part pivots found")
    banned = ("chair", "desk", "counter", "display", "reception", "shelf", "table", "cart_model", "furniture")
    offending = [obj.name for obj in building_nodes if any(term in obj.name.lower() for term in banned)]
    if offending:
        errors.append(f"Non-architectural content found: {offending[:12]}")
    if triangles > 850_000:
        warnings.append(f"LOD0 triangle count {triangles:,} exceeds the initial 850k architecture budget")
    for pivot_obj in pivots:
        if "hinge_axis" not in pivot_obj:
            warnings.append(f"Pivot without hinge_axis metadata: {pivot_obj.name}")
    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "dimensions": {
            "enclosedWidthM": BUILDING_W,
            "enclosedDepthM": BUILDING_D,
            "floors": 2,
            "enclosedAreaM2": round(BUILDING_AREA_M2, 3),
            "enclosedAreaFt2": round(BUILDING_AREA_FT2, 1),
            "eaveHeightM": EAVE_Z,
            "ridgeHeightM": RIDGE_Z,
        },
        "counts": {
            "buildingNodes": len(building_nodes),
            "visibleMeshes": len(visible_meshes),
            "triangles": triangles,
            "materials": len(materials),
            "collisionMeshes": len(collisions),
            "pivots": len(pivots),
            "sockets": len(sockets),
            "moduleTemplates": len(module_templates),
            "moduleInstances": len(module_instances),
        },
        "emptyInterior": not offending,
        "materials": sorted(materials),
    }


def build() -> dict[str, object]:
    ensure_dirs()
    A.reset_scene(factory=True, seed=55007000)
    materials = create_materials()
    kit, templates = build_templates(materials)
    building = root_empty(
        "PC_PREMIUM_CLUBHOUSE_ARCHITECTURE_ROOT",
        asset_id="premium_clubhouse_architecture",
        authored_units="meters",
        front_axis="-Y",
        up_axis="+Z",
        enclosed_area_m2=BUILDING_AREA_M2,
        enclosed_area_ft2=BUILDING_AREA_FT2,
        intentionally_empty=True,
        player_customizable=True,
        source="Original project-owned Golf Flipper architecture",
        license="Project-owned",
        visual_reference="Designs/ClubHouse Course 5 row",
        external_assets="none",
    )
    assemble_envelope(building, templates, materials)
    assemble_site(building, templates, materials)
    socket("ExpansionWest", building, (-BUILDING_W / 2, 0.0, FLOOR_Z), grid_m=BAY, stable=True)
    socket("ExpansionEast", building, (BUILDING_W / 2, 0.0, FLOOR_Z), grid_m=BAY, stable=True)
    socket("ExpansionRear", building, (0.0, BUILDING_D / 2, FLOOR_Z), grid_m=BAY, stable=True)
    socket("FinishedFloorDatum", building, (0.0, 0.0, FLOOR_Z), stable=True)
    building["entrances"] = json.dumps([
        "member", "tournament", "bag_drop", "member_locker", "maintenance", "employee", "loading_dock",
    ])
    building["site_features"] = json.dumps([
        "circular_driveway", "valet", "fountain", "outdoor_terrace", "covered_veranda",
        "golf_cart_staging", "parking", "landscaping", "loading_apron",
    ])

    validation = validate_build(building, kit)
    if not validation["ok"]:
        raise RuntimeError("Premium clubhouse validation failed: " + "; ".join(validation["errors"]))

    A.save_blend(SOURCE_PATH)
    A.export_glb(KIT_CANONICAL, kit)
    A.export_glb(KIT_RUNTIME, kit)
    A.export_glb(BUILDING_CANONICAL, building)
    A.export_glb(BUILDING_RUNTIME, building)

    day_preview = QA_DIR / "premium-clubhouse-day.png"
    night_preview = QA_DIR / "premium-clubhouse-night.png"
    interior_preview = QA_DIR / "premium-clubhouse-empty-interior.png"
    render_preview(building, kit, day_preview, night=False)
    render_preview(building, kit, night_preview, night=True)
    render_preview(building, kit, interior_preview, night=False, interior=True)

    manifest = {
        "schemaVersion": 1,
        "asset": "premium_clubhouse_architecture",
        "source": SOURCE_PATH.relative_to(REPO_ROOT).as_posix(),
        "canonicalGlb": BUILDING_CANONICAL.relative_to(REPO_ROOT).as_posix(),
        "runtimeGlb": BUILDING_RUNTIME.relative_to(REPO_ROOT).as_posix(),
        "kitCanonicalGlb": KIT_CANONICAL.relative_to(REPO_ROOT).as_posix(),
        "kitRuntimeGlb": KIT_RUNTIME.relative_to(REPO_ROOT).as_posix(),
        "previews": [path.relative_to(REPO_ROOT).as_posix() for path in (day_preview, night_preview, interior_preview)],
        "sha256": {
            "canonical": A.sha256_file(BUILDING_CANONICAL),
            "runtime": A.sha256_file(BUILDING_RUNTIME),
            "kitCanonical": A.sha256_file(KIT_CANONICAL),
            "kitRuntime": A.sha256_file(KIT_RUNTIME),
        },
        "validation": validation,
        "moduleKeys": sorted(templates),
        "sourceLicense": {
            "source": "Original in-repository procedural Blender build",
            "license": "Project-owned",
            "externalDownloads": [],
        },
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("PREMIUM_CLUBHOUSE_BUILD|" + json.dumps(manifest, sort_keys=True))
    return manifest


def render_saved_previews(*, day_only: bool = False) -> None:
    """Re-render QA views from the retained source without rebuilding exports."""

    ensure_dirs()
    if not SOURCE_PATH.is_file():
        raise FileNotFoundError(f"Premium clubhouse source is missing: {SOURCE_PATH}")
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE_PATH))
    building = bpy.data.objects.get("PC_PREMIUM_CLUBHOUSE_ARCHITECTURE_ROOT")
    kit = bpy.data.objects.get("PC_MODULAR_KIT_ROOT")
    if building is None or kit is None:
        raise RuntimeError("Premium clubhouse source is missing its building or modular-kit root")
    render_preview(building, kit, QA_DIR / "premium-clubhouse-day.png", night=False)
    if day_only:
        return
    render_preview(building, kit, QA_DIR / "premium-clubhouse-night.png", night=True)
    render_preview(building, kit, QA_DIR / "premium-clubhouse-empty-interior.png", night=False, interior=True)


if __name__ == "__main__":
    if "--preview-only" in sys.argv:
        render_saved_previews(day_only="--day-only" in sys.argv)
    else:
        build()
