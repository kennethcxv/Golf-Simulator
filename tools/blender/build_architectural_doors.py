"""Build the five reference-matched Golf Flipper architectural door tiers.

Run with Blender 5.1+:
  blender --background --factory-startup --python tools/blender/build_architectural_doors.py

The script is deterministic, uses only original in-repository procedural geometry
and textures, never edits ``Designs/Doors``, and writes editable sources, runtime
GLBs, PBR textures, neutral-studio previews, a comparison scene, and a manifest.
All dimensions are metres, +Z is up, and the authored front/player side is -Y.
"""

from __future__ import annotations

import json
import math
import os
import random
import sys
from array import array
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Sequence

import bpy
import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import assets_51_100_lib as asset_lib


REPO = Path(os.environ.get("GF_REPO_ROOT", Path(__file__).resolve().parents[2])).resolve()
ASSET_ROOT = REPO / "Assets" / "architecture" / "doors"
SOURCE_ROOT = ASSET_ROOT / "source"
TEXTURE_ROOT = ASSET_ROOT / "textures"
PREVIEW_ROOT = ASSET_ROOT / "previews"
EXPORT_ROOT = REPO / "vendor" / "models" / "architecture" / "doors"
QA_ROOT = REPO / "qa" / "doors" / "blender"
MANIFEST_PATH = ASSET_ROOT / "doors-manifest.json"
COMPARISON_SOURCE = SOURCE_ROOT / "door_tier_comparison.blend"
COMPARISON_PREVIEW = PREVIEW_ROOT / "door_tier_comparison.png"
BLENDER_VERSION_REQUIRED = (5, 1, 0)

FRONT_AXIS = "-Y"
UP_AXIS = "+Z"
LOD_NAMES = {0: "LOD0", 1: "LOD1", 2: "LOD2"}
LOD_BEVEL_SEGMENTS = {0: 3, 1: 2, 2: 1}
LOD_CYLINDER_SEGMENTS = {0: 24, 1: 14, 2: 8}
LOD_DISTANCES_M = {0: 0.0, 1: 8.0, 2: 18.0}


@dataclass(frozen=True)
class DoorSpec:
    key: str
    label: str
    root_name: str
    leaf_width: float
    leaf_height: float
    leaf_thickness: float
    opening_width: float
    opening_height: float
    frame_depth: float
    outer_width: float
    outer_height: float
    hinge_count: int
    open_degrees: float
    material_style: str
    panel_style: str
    reference: str
    double: bool = False
    arched: bool = False

    @property
    def leaf_count(self) -> int:
        return 2 if self.double else 1

    @property
    def total_leaf_width(self) -> float:
        return self.leaf_width * self.leaf_count

    @property
    def spring_height(self) -> float:
        return self.leaf_height - self.leaf_width / 2.0 if self.arched else self.leaf_height


SPECS = (
    DoorSpec(
        "basic", "Basic", "Door_Basic", 0.84, 2.04, 0.040,
        0.852, 2.052, 0.240, 1.060, 2.190, 2, 100.0,
        "paint_white", "two_panel_basic", "Designs/Doors/Basic.png",
    ),
    DoorSpec(
        "standard", "Standard", "Door_Standard", 0.86, 2.08, 0.044,
        0.873, 2.093, 0.250, 1.095, 2.235, 3, 105.0,
        "paint_cream", "two_panel_refined", "Designs/Doors/Standard.png",
    ),
    DoorSpec(
        "premium", "Premium", "Door_Premium", 0.92, 2.16, 0.050,
        0.934, 2.174, 0.270, 1.205, 2.345, 3, 105.0,
        "medium_walnut", "premium_three_panel", "Designs/Doors/Premium.png",
    ),
    DoorSpec(
        "high-end", "High-End", "Door_HighEnd", 1.02, 2.46, 0.055,
        1.034, 2.474, 0.300, 1.365, 2.660, 4, 105.0,
        "dark_walnut", "arched_glass", "Designs/Doors/High-End.png", arched=True,
    ),
    DoorSpec(
        "luxury", "Luxury", "Door_Luxury", 0.93, 2.35, 0.058,
        1.874, 2.364, 0.320, 2.205, 2.555, 4, 105.0,
        "mahogany", "luxury_double", "Designs/Doors/Luxury.png", double=True,
    ),
)

SPEC_BY_KEY = {spec.key: spec for spec in SPECS}
CURRENT_SPEC: DoorSpec | None = None
MATERIALS: dict[str, bpy.types.Material] = {}


def ensure_directories() -> None:
    for folder in (SOURCE_ROOT, TEXTURE_ROOT, PREVIEW_ROOT, EXPORT_ROOT, QA_ROOT):
        folder.mkdir(parents=True, exist_ok=True)


def relative(path: Path) -> str:
    return path.resolve().relative_to(REPO).as_posix()


def clean_scene() -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection" and collection.users == 0:
            bpy.data.collections.remove(collection)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)
    # Production clips use fake users so they survive export. Once their owner
    # hierarchy is deleted, remove them explicitly before building the next SKU.
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    scene.render.fps = 30
    scene.render.fps_base = 1.0
    scene.frame_start = 1
    scene.frame_end = 60
    scene.frame_set(1)
    scene["asset_pipeline"] = "Golf Flipper Architectural Doors"
    scene["units"] = "meters"
    scene["up_axis"] = UP_AXIS
    scene["front_axis"] = FRONT_AXIS
    scene["references_immutable"] = True
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass


def activate(obj: bpy.types.Object) -> bpy.types.Object:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    return obj


def descendants(root: bpy.types.Object, include_root: bool = True) -> list[bpy.types.Object]:
    result = [root] if include_root else []
    stack = list(root.children)
    while stack:
        obj = stack.pop()
        result.append(obj)
        stack.extend(obj.children)
    return result


def set_parent_keep_world(obj: bpy.types.Object, parent: bpy.types.Object | None) -> bpy.types.Object:
    if parent is None:
        return obj
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    # Keep explicit local TRS with an identity parent inverse. glTF has no
    # parent-inverse concept; leaving one here can make the exporter bake the
    # final sampled animation pose into child nodes while the pivot returns to
    # its rest rotation.
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_world = world
    bpy.context.view_layer.update()
    return obj


def set_properties(obj: bpy.types.Object, properties: Mapping[str, object] | None) -> None:
    for key, value in (properties or {}).items():
        if isinstance(value, (dict, list, tuple)):
            obj[key] = json.dumps(value, sort_keys=True)
        else:
            obj[key] = value


def empty(
    name: str,
    location: Sequence[float] = (0.0, 0.0, 0.0),
    *,
    parent: bpy.types.Object | None = None,
    display: str = "PLAIN_AXES",
    size: float = 0.08,
    properties: Mapping[str, object] | None = None,
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = tuple(float(value) for value in location)
    obj.empty_display_type = display
    obj.empty_display_size = float(size)
    set_properties(obj, properties)
    set_parent_keep_world(obj, parent)
    return obj


def group(name: str, parent: bpy.types.Object, **properties: object) -> bpy.types.Object:
    return empty(name, parent=parent, display="CUBE", size=0.055, properties=properties)


def stable_seed(text: str) -> int:
    return sum((index + 23) * ord(char) for index, char in enumerate(text))


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _remove_existing_image(name: str) -> None:
    image = bpy.data.images.get(name)
    if image is not None and image.users == 0:
        bpy.data.images.remove(image)


def _write_image(
    name: str,
    path: Path,
    width: int,
    height: int,
    pixels: array,
    *,
    non_color: bool = False,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    _remove_existing_image(name)
    image = bpy.data.images.new(name, width=width, height=height, alpha=True, float_buffer=False)
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    if non_color:
        image.colorspace_settings.name = "Non-Color"
    image.save()
    image["source_repo_path"] = relative(path)
    return path


def generate_wood_maps(
    stem: str,
    base_rgb: tuple[float, float, float],
    accent_rgb: tuple[float, float, float],
    *,
    seed: float,
    size: int = 512,
) -> dict[str, Path]:
    color_path = TEXTURE_ROOT / f"{stem}_basecolor.png"
    rough_path = TEXTURE_ROOT / f"{stem}_roughness.png"
    normal_path = TEXTURE_ROOT / f"{stem}_normal.png"
    if color_path.exists() and rough_path.exists() and normal_path.exists():
        return {"color": color_path, "roughness": rough_path, "normal": normal_path}
    rng = random.Random(stable_seed(stem))
    phase_a = rng.random() * math.tau + seed
    phase_b = rng.random() * math.tau + seed * 0.37
    color_pixels = array("f")
    rough_pixels = array("f")
    normal_pixels = array("f")
    heights = [0.0] * (size * size)
    for y in range(size):
        v = y / max(1, size - 1)
        for x in range(size):
            u = x / max(1, size - 1)
            # Keep the grain directional without the broad, high-contrast sine
            # bands that turned into zebra waves at first-person scale. The
            # narrow latewood lines and low-amplitude flow remain legible while
            # joinery and panel relief carry the silhouette.
            warped = u + 0.007 * math.sin(v * math.tau * 1.4 + phase_a)
            warped += 0.0025 * math.sin(v * math.tau * 4.6 - phase_b)
            broad = 0.5 + 0.5 * math.sin(warped * math.tau * 4.6 + 0.25 * math.sin(v * math.tau * 0.7))
            fine = 0.5 + 0.5 * math.sin(warped * math.tau * 18.0 + v * 0.9 + phase_b)
            pore = 0.5 + 0.5 * math.sin((warped * 49.0 + v * 2.3) * math.tau + phase_a)
            fleck = 0.5 + 0.5 * math.sin((u * 17.7 + v * 23.1 + 0.2 * math.sin(v * math.tau * 2.0)) * math.tau + phase_b)
            latewood = (0.5 + 0.5 * math.sin(warped * math.tau * 5.1 + phase_a)) ** 8
            knot_dx = u - (0.24 + 0.45 * (0.5 + 0.5 * math.sin(seed * 1.7)))
            knot_dy = v - (0.31 + 0.31 * (0.5 + 0.5 * math.cos(seed * 2.3)))
            knot_r = math.sqrt(knot_dx * knot_dx * 3.2 + knot_dy * knot_dy)
            knot = math.exp(-knot_r * 20.0) * (0.5 + 0.5 * math.sin(knot_r * 95.0))
            value = clamp(
                0.50 + (broad - 0.5) * 0.24 + (fine - 0.5) * 0.13
                + (pore - 0.5) * 0.035 + (fleck - 0.5) * 0.025
                - latewood * 0.055 - knot * 0.10,
                0.0, 1.0,
            )
            height_value = clamp(
                0.50 + (broad - 0.5) * 0.065 + (fine - 0.5) * 0.025
                - latewood * 0.020 - knot * 0.025,
                0.0, 1.0,
            )
            heights[y * size + x] = height_value
            mix = 0.36 + value * 0.34
            rgb = tuple(clamp(base_rgb[i] * (1.0 - mix) + accent_rgb[i] * mix, 0.0, 1.0) for i in range(3))
            color_pixels.extend((*rgb, 1.0))
            rough = clamp(0.43 + (1.0 - value) * 0.10 + pore * 0.018, 0.41, 0.58)
            rough_pixels.extend((rough, rough, rough, 1.0))
    strength = 2.4
    for y in range(size):
        for x in range(size):
            left = heights[y * size + ((x - 1) % size)]
            right = heights[y * size + ((x + 1) % size)]
            down = heights[((y - 1) % size) * size + x]
            up = heights[((y + 1) % size) * size + x]
            nx = (left - right) * strength
            ny = (down - up) * strength
            nz = 1.0
            length = math.sqrt(nx * nx + ny * ny + nz * nz)
            normal_pixels.extend((nx / length * 0.5 + 0.5, ny / length * 0.5 + 0.5, nz / length * 0.5 + 0.5, 1.0))
    _write_image(f"IMG_{stem}_BaseColor", color_path, size, size, color_pixels)
    _write_image(f"IMG_{stem}_Roughness", rough_path, size, size, rough_pixels, non_color=True)
    _write_image(f"IMG_{stem}_Normal", normal_path, size, size, normal_pixels, non_color=True)
    return {"color": color_path, "roughness": rough_path, "normal": normal_path}


def generate_paint_maps(stem: str, rgb: tuple[float, float, float], *, seed: float, size: int = 256) -> dict[str, Path]:
    color_path = TEXTURE_ROOT / f"{stem}_basecolor.png"
    rough_path = TEXTURE_ROOT / f"{stem}_roughness.png"
    if color_path.exists() and rough_path.exists():
        return {"color": color_path, "roughness": rough_path}
    color_pixels = array("f")
    rough_pixels = array("f")
    for y in range(size):
        for x in range(size):
            u = x / size
            v = y / size
            variation = 0.006 * math.sin((u * 23.0 + v * 7.0 + seed) * math.tau)
            variation += 0.003 * math.sin((u * 61.0 - v * 37.0 + seed * 0.31) * math.tau)
            color_pixels.extend((*(clamp(channel + variation, 0.0, 1.0) for channel in rgb), 1.0))
            rough = clamp(0.55 + variation * 1.2, 0.50, 0.60)
            rough_pixels.extend((rough, rough, rough, 1.0))
    _write_image(f"IMG_{stem}_BaseColor", color_path, size, size, color_pixels)
    _write_image(f"IMG_{stem}_Roughness", rough_path, size, size, rough_pixels, non_color=True)
    return {"color": color_path, "roughness": rough_path}


def generate_glass_normal(size: int = 256) -> Path:
    path = TEXTURE_ROOT / "privacy_glass_normal_v2.png"
    if path.exists():
        return path
    normal_pixels = array("f")
    height = [0.0] * (size * size)
    for y in range(size):
        v = y / size
        for x in range(size):
            u = x / size
            ripple = 0.52 * math.sin((u * 3.2 + 0.12 * math.sin(v * 5.0)) * math.tau)
            ripple += 0.30 * math.sin((u * 7.4 - v * 0.8) * math.tau)
            ripple += 0.18 * math.sin((v * 5.3 + u * 1.4) * math.tau)
            height[y * size + x] = ripple
    for y in range(size):
        for x in range(size):
            left = height[y * size + ((x - 1) % size)]
            right = height[y * size + ((x + 1) % size)]
            down = height[((y - 1) % size) * size + x]
            up = height[((y + 1) % size) * size + x]
            nx = (left - right) * 0.13
            ny = (down - up) * 0.13
            nz = 1.0
            length = math.sqrt(nx * nx + ny * ny + nz * nz)
            normal_pixels.extend((nx / length * 0.5 + 0.5, ny / length * 0.5 + 0.5, nz / length * 0.5 + 0.5, 1.0))
    _write_image("IMG_PrivacyGlassNormalV2", path, size, size, normal_pixels, non_color=True)
    return path


def generate_glass_color(size: int = 256) -> Path:
    path = TEXTURE_ROOT / "privacy_glass_basecolor_v2.png"
    if path.exists():
        return path
    color_pixels = array("f")
    base = (0.31, 0.38, 0.35)
    for y in range(size):
        v = y / size
        for x in range(size):
            u = x / size
            broad = 0.5 + 0.5 * math.sin((u * 5.2 + 0.10 * math.sin(v * 5.1)) * math.tau)
            fine = 0.5 + 0.5 * math.sin((u * 12.4 - v * 1.3) * math.tau)
            stipple = 0.5 + 0.5 * math.sin((u * 43.0 + v * 37.0) * math.tau)
            shade = 0.84 + broad * 0.10 + fine * 0.04 + stipple * 0.02
            color_pixels.extend((*(clamp(channel * shade, 0.0, 1.0) for channel in base), 1.0))
    _write_image("IMG_PrivacyGlassBaseColorV2", path, size, size, color_pixels)
    return path


def load_image(path: Path, *, non_color: bool = False) -> bpy.types.Image:
    image = bpy.data.images.load(str(path), check_existing=True)
    image.filepath = str(path)
    image["source_repo_path"] = relative(path)
    if non_color:
        image.colorspace_settings.name = "Non-Color"
    return image


def principled_input(node: bpy.types.Node, *names: str):
    for name in names:
        found = node.inputs.get(name)
        if found is not None:
            return found
    return None


def make_material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    roughness: float,
    metallic: float = 0.0,
    alpha: float = 1.0,
    transmission: float = 0.0,
    ior: float = 1.45,
    coat: float = 0.0,
    double_sided: bool = False,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*color[:3], alpha)
    material.use_backface_culling = not double_sided
    nodes = material.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    principled_input(bsdf, "Base Color").default_value = (*color[:3], alpha)
    principled_input(bsdf, "Roughness").default_value = roughness
    principled_input(bsdf, "Metallic").default_value = metallic
    alpha_input = principled_input(bsdf, "Alpha")
    if alpha_input:
        alpha_input.default_value = alpha
    transmission_input = principled_input(bsdf, "Transmission Weight", "Transmission")
    if transmission_input:
        transmission_input.default_value = transmission
    ior_input = principled_input(bsdf, "IOR")
    if ior_input:
        ior_input.default_value = ior
    coat_input = principled_input(bsdf, "Coat Weight", "Clearcoat")
    if coat_input:
        coat_input.default_value = coat
    if alpha < 0.999:
        try:
            material.surface_render_method = "DITHERED"
        except Exception:
            pass
    return material


def make_textured_material(
    name: str,
    maps: Mapping[str, Path],
    *,
    base_color: tuple[float, float, float, float],
    roughness: float,
    normal_strength: float = 0.25,
    coat: float = 0.0,
    emissive_strength: float = 0.0,
) -> bpy.types.Material:
    material = make_material(name, base_color, roughness=roughness, coat=coat)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    color_node = nodes.new("ShaderNodeTexImage")
    color_node.name = f"{name}_BaseColorTexture"
    color_node.image = load_image(maps["color"])
    links.new(color_node.outputs["Color"], principled_input(bsdf, "Base Color"))
    if emissive_strength > 0.0:
        emission_color = principled_input(bsdf, "Emission Color", "Emission")
        emission_strength_input = principled_input(bsdf, "Emission Strength")
        if emission_color is not None:
            links.new(color_node.outputs["Color"], emission_color)
        if emission_strength_input is not None:
            emission_strength_input.default_value = emissive_strength
    rough_node = nodes.new("ShaderNodeTexImage")
    rough_node.name = f"{name}_RoughnessTexture"
    rough_node.image = load_image(maps["roughness"], non_color=True)
    links.new(rough_node.outputs["Color"], principled_input(bsdf, "Roughness"))
    if maps.get("normal"):
        normal_texture = nodes.new("ShaderNodeTexImage")
        normal_texture.name = f"{name}_NormalTexture"
        normal_texture.image = load_image(maps["normal"], non_color=True)
        normal_map = nodes.new("ShaderNodeNormalMap")
        normal_map.name = f"{name}_NormalMap"
        normal_map.inputs["Strength"].default_value = normal_strength
        links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], principled_input(bsdf, "Normal"))
    return material


def build_materials(spec: DoorSpec) -> dict[str, bpy.types.Material]:
    white_maps = generate_paint_maps("paint_warm_white_v2", (0.79, 0.765, 0.71), seed=1.2)
    cream_maps = generate_paint_maps("paint_warm_cream_v2", (0.69, 0.635, 0.53), seed=2.7)
    # v5 keeps the restrained cabinet-scale grain from v4 while lifting the
    # actual texture values for the clubhouse's shaded exterior and stockroom.
    medium_maps = generate_wood_maps("wood_medium_walnut_v5", (0.250, 0.105, 0.050), (0.52, 0.250, 0.105), seed=1.9)
    dark_maps = generate_wood_maps("wood_dark_walnut_v5", (0.180, 0.075, 0.035), (0.42, 0.190, 0.080), seed=3.1)
    mahogany_maps = generate_wood_maps("wood_mahogany_v5", (0.210, 0.065, 0.035), (0.47, 0.170, 0.075), seed=4.7)
    glass_normal = generate_glass_normal()
    glass_color = generate_glass_color()
    mats = {
        "paint_white": make_textured_material(
            "MAT_Door_WarmWhitePaint", white_maps, base_color=(0.79, 0.765, 0.71, 1), roughness=0.55,
        ),
        "paint_cream": make_textured_material(
            "MAT_Door_WarmCreamPaint", cream_maps, base_color=(0.69, 0.635, 0.53, 1), roughness=0.50,
        ),
        "medium_walnut": make_textured_material(
            "MAT_Door_MediumWalnut", medium_maps, base_color=(0.34, 0.155, 0.065, 1), roughness=0.48, normal_strength=0.14, coat=0.05, emissive_strength=0.12,
        ),
        "dark_walnut": make_textured_material(
            "MAT_Door_DarkWalnut", dark_maps, base_color=(0.28, 0.120, 0.050, 1), roughness=0.49, normal_strength=0.14, coat=0.05, emissive_strength=0.12,
        ),
        "mahogany": make_textured_material(
            "MAT_Door_Mahogany", mahogany_maps, base_color=(0.31, 0.105, 0.050, 1), roughness=0.47, normal_strength=0.14, coat=0.06, emissive_strength=0.12,
        ),
        "brass_basic": make_material(
            "MAT_Door_BasicBrass", (0.64, 0.40, 0.13, 1), roughness=0.36, metallic=0.30,
        ),
        "brass_refined": make_material(
            "MAT_Door_RefinedBrass", (0.84, 0.56, 0.19, 1), roughness=0.30, metallic=0.30, coat=0.10,
        ),
        "brass_structural": make_material(
            "MAT_Door_StructuralBrass", (0.58, 0.36, 0.12, 1), roughness=0.39, metallic=0.34,
        ),
        "steel": make_material(
            "MAT_Door_LatchSteel", (0.24, 0.255, 0.24, 1), roughness=0.35, metallic=0.90,
        ),
        "rubber": make_material(
            "MAT_Door_WeatherSeal", (0.018, 0.021, 0.019, 1), roughness=0.82,
        ),
        "collision": make_material(
            "MAT_Door_CollisionAuthoring", (0.45, 0.02, 0.65, 0.18), roughness=0.75, alpha=0.18, double_sided=True,
        ),
    }
    for material_key in ("medium_walnut", "dark_walnut", "mahogany"):
        wood_bsdf = mats[material_key].node_tree.nodes.get("Principled BSDF")
        specular = principled_input(wood_bsdf, "Specular IOR Level", "Specular")
        if specular is not None:
            specular.default_value = 0.14
    glass = make_material(
        "MAT_Door_PrivacyGlass", (0.31, 0.38, 0.35, 1), roughness=0.60,
        # Rough privacy glass uses its textured alpha/normal response rather than
        # real-time transmission, which would trigger a full scene-buffer redraw.
        alpha=0.94, transmission=0.0, ior=1.46, coat=0.08, double_sided=True,
    )
    nodes = glass.node_tree.nodes
    links = glass.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    glass_color_texture = nodes.new("ShaderNodeTexImage")
    glass_color_texture.name = "PrivacyGlassBaseColorTexture"
    glass_color_texture.image = load_image(glass_color)
    links.new(glass_color_texture.outputs["Color"], principled_input(bsdf, "Base Color"))
    glass_texture = nodes.new("ShaderNodeTexImage")
    glass_texture.name = "PrivacyGlassNormalTexture"
    glass_texture.image = load_image(glass_normal, non_color=True)
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.name = "PrivacyGlassNormalMap"
    normal_map.inputs["Strength"].default_value = 0.48
    links.new(glass_texture.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], principled_input(bsdf, "Normal"))
    mats["glass"] = glass
    mats["primary"] = mats[spec.material_style]
    mats["frame"] = mats[spec.material_style]
    mats["hardware"] = mats["brass_basic"] if spec.key == "basic" else mats["brass_refined"]
    return mats


def apply_mesh_transforms(obj: bpy.types.Object) -> bpy.types.Object:
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return obj


def assign_material(obj: bpy.types.Object, material: bpy.types.Material | None) -> None:
    if material is not None and material.name not in obj.data.materials:
        obj.data.materials.append(material)


def apply_bevel(obj: bpy.types.Object, width: float, segments: int) -> None:
    if width <= 0:
        return
    modifier = obj.modifiers.new("ManufacturedEdgeSoftening", "BEVEL")
    modifier.width = float(width)
    modifier.segments = max(1, int(segments))
    modifier.limit_method = "ANGLE"
    modifier.angle_limit = math.radians(24)
    activate(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def shade_manufactured(obj: bpy.types.Object) -> None:
    activate(obj)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(46), keep_sharp_edges=True)
    except Exception:
        try:
            bpy.ops.object.shade_auto_smooth(angle=math.radians(46))
        except Exception:
            pass


def planar_uv(
    obj: bpy.types.Object,
    *,
    grain_axis: str = "Z",
    uv_offset: tuple[float, float] = (0.0, 0.0),
    repeat: tuple[float, float] = (1.0, 1.0),
) -> None:
    mesh = obj.data
    if mesh.uv_layers:
        while mesh.uv_layers:
            mesh.uv_layers.remove(mesh.uv_layers[0])
    layer = mesh.uv_layers.new(name="UVMap")
    vertices = mesh.vertices
    xs = [vertex.co.x for vertex in vertices]
    ys = [vertex.co.y for vertex in vertices]
    zs = [vertex.co.z for vertex in vertices]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    min_z, max_z = min(zs), max(zs)
    span_x = max(1e-6, max_x - min_x)
    span_y = max(1e-6, max_y - min_y)
    span_z = max(1e-6, max_z - min_z)
    mesh.calc_normals_split if hasattr(mesh, "calc_normals_split") else None
    for polygon in mesh.polygons:
        normal = polygon.normal
        for loop_index in polygon.loop_indices:
            co = vertices[mesh.loops[loop_index].vertex_index].co
            if abs(normal.y) >= max(abs(normal.x), abs(normal.z)):
                u = (co.x - min_x) / span_x
                v = (co.z - min_z) / span_z
            elif abs(normal.x) >= abs(normal.z):
                u = (co.y - min_y) / span_y
                v = (co.z - min_z) / span_z
            else:
                u = (co.x - min_x) / span_x
                v = (co.y - min_y) / span_y
            if grain_axis.upper() == "X":
                u, v = v, 1.0 - u
            elif grain_axis.upper() == "Y":
                u, v = 1.0 - v, u
            layer.data[loop_index].uv = (
                u * repeat[0] + uv_offset[0],
                v * repeat[1] + uv_offset[1],
            )


def finish_mesh(
    obj: bpy.types.Object,
    material: bpy.types.Material | None,
    *,
    bevel: float = 0.0,
    bevel_segments: int = 2,
    grain_axis: str = "Z",
    uv_offset: tuple[float, float] = (0.0, 0.0),
    uv_repeat: tuple[float, float] = (1.0, 1.0),
    collision: bool = False,
    smooth: bool = True,
    properties: Mapping[str, object] | None = None,
) -> bpy.types.Object:
    apply_mesh_transforms(obj)
    apply_bevel(obj, bevel, bevel_segments)
    assign_material(obj, material)
    planar_uv(obj, grain_axis=grain_axis, uv_offset=uv_offset, repeat=uv_repeat)
    if smooth and not collision:
        shade_manufactured(obj)
    set_properties(obj, properties)
    if collision:
        obj["collision_proxy"] = True
        obj.display_type = "WIRE"
        obj.hide_render = True
        try:
            obj.visible_camera = False
            obj.visible_shadow = False
        except Exception:
            pass
    return obj


def box(
    name: str,
    dimensions: Sequence[float],
    location: Sequence[float],
    material: bpy.types.Material | None,
    *,
    parent: bpy.types.Object | None = None,
    rotation: Sequence[float] = (0.0, 0.0, 0.0),
    bevel: float = 0.006,
    bevel_segments: int = 2,
    grain_axis: str = "Z",
    uv_offset: tuple[float, float] = (0.0, 0.0),
    uv_repeat: tuple[float, float] = (1.0, 1.0),
    collision: bool = False,
    properties: Mapping[str, object] | None = None,
) -> bpy.types.Object:
    dims = tuple(float(value) for value in dimensions)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=tuple(location), rotation=tuple(rotation))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    clamped = min(float(bevel), min(dims) * 0.22) if bevel else 0.0
    finish_mesh(
        obj,
        material,
        bevel=clamped,
        bevel_segments=bevel_segments,
        grain_axis=grain_axis,
        uv_offset=uv_offset,
        uv_repeat=uv_repeat,
        collision=collision,
        smooth=not collision,
        properties=properties,
    )
    set_parent_keep_world(obj, parent)
    return obj


def cylinder(
    name: str,
    radius: float,
    depth: float,
    location: Sequence[float],
    material: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    rotation: Sequence[float] = (0.0, 0.0, 0.0),
    vertices: int = 20,
    bevel: float = 0.002,
    properties: Mapping[str, object] | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=max(8, int(vertices)), radius=float(radius), depth=float(depth),
        location=tuple(location), rotation=tuple(rotation),
    )
    obj = bpy.context.object
    obj.name = name
    finish_mesh(
        obj,
        material,
        bevel=min(bevel, radius * 0.22, depth * 0.12),
        bevel_segments=2,
        grain_axis="Z",
        smooth=True,
        properties=properties,
    )
    set_parent_keep_world(obj, parent)
    return obj


def sphere(
    name: str,
    radius: float,
    location: Sequence[float],
    material: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    segments: int = 16,
    properties: Mapping[str, object] | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=max(8, segments), ring_count=max(6, segments // 2),
        radius=radius, location=tuple(location),
    )
    obj = bpy.context.object
    obj.name = name
    finish_mesh(obj, material, bevel=0.0, smooth=True, properties=properties)
    set_parent_keep_world(obj, parent)
    return obj


def tube_between(
    name: str,
    start: Sequence[float],
    end: Sequence[float],
    radius: float,
    material: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    vertices: int = 16,
    bevel: float = 0.002,
    properties: Mapping[str, object] | None = None,
) -> bpy.types.Object:
    p0 = Vector(start)
    p1 = Vector(end)
    direction = p1 - p0
    length = direction.length
    if length <= 1e-6:
        raise ValueError(f"{name}: tube endpoints coincide")
    midpoint = (p0 + p1) * 0.5
    rotation = direction.to_track_quat("Z", "Y").to_euler()
    return cylinder(
        name, radius, length, midpoint, material,
        parent=parent, rotation=rotation, vertices=vertices, bevel=bevel, properties=properties,
    )


def curve_tube(
    name: str,
    points: Sequence[Sequence[float]],
    radius: float,
    material: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    resolution: int = 4,
    bevel_resolution: int = 2,
    properties: Mapping[str, object] | None = None,
) -> bpy.types.Object:
    if len(points) < 2:
        raise ValueError(f"{name}: curve tube needs at least two points")
    data = bpy.data.curves.new(name + "_DATA", "CURVE")
    data.dimensions = "3D"
    data.resolution_u = max(1, int(resolution))
    data.bevel_depth = float(radius)
    data.bevel_resolution = max(0, int(bevel_resolution))
    data.resolution_v = max(1, 2 + int(bevel_resolution))
    data.fill_mode = "FULL"
    spline = data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for bezier, point in zip(spline.bezier_points, points):
        bezier.co = tuple(float(value) for value in point)
        bezier.handle_left_type = "AUTO"
        bezier.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    activate(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.name = name
    finish_mesh(
        obj, material, bevel=0.0, grain_axis="X", smooth=True,
        properties=properties,
    )
    set_parent_keep_world(obj, parent)
    return obj


def polygon_prism(
    name: str,
    points_xz: Sequence[Sequence[float]],
    depth: float,
    y: float,
    material: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    bevel: float = 0.004,
    bevel_segments: int = 2,
    grain_axis: str = "Z",
    uv_offset: tuple[float, float] = (0.0, 0.0),
    collision: bool = False,
    properties: Mapping[str, object] | None = None,
) -> bpy.types.Object:
    points = [(float(x), float(z)) for x, z in points_xz]
    count = len(points)
    if count < 3:
        raise ValueError(f"{name}: polygon needs at least three points")
    front_y = y - depth / 2.0
    rear_y = y + depth / 2.0
    vertices = [(x, front_y, z) for x, z in points] + [(x, rear_y, z) for x, z in points]
    faces: list[tuple[int, ...]] = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    for index in range(count):
        next_index = (index + 1) % count
        faces.append((index, next_index, count + next_index, count + index))
    mesh = bpy.data.meshes.new(name + "_DATA")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish_mesh(
        obj,
        material,
        bevel=bevel,
        bevel_segments=bevel_segments,
        grain_axis=grain_axis,
        uv_offset=uv_offset,
        collision=collision,
        smooth=not collision,
        properties=properties,
    )
    set_parent_keep_world(obj, parent)
    return obj


def arch_points(radius: float, center_z: float, segments: int, *, start: float = 0.0, end: float = math.pi) -> list[tuple[float, float]]:
    return [
        (math.cos(start + (end - start) * index / segments) * radius,
         center_z + math.sin(start + (end - start) * index / segments) * radius)
        for index in range(segments + 1)
    ]


def arch_panel(
    name: str,
    width: float,
    height: float,
    depth: float,
    y: float,
    material: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    segments: int = 24,
    bevel: float = 0.004,
    bevel_segments: int = 2,
    uv_offset: tuple[float, float] = (0.0, 0.0),
    collision: bool = False,
    properties: Mapping[str, object] | None = None,
) -> bpy.types.Object:
    radius = width / 2.0
    spring = height - radius
    points = [(-radius, 0.0), (radius, 0.0), (radius, spring)]
    points.extend(arch_points(radius, spring, segments, start=0.0, end=math.pi)[1:])
    return polygon_prism(
        name, points, depth, y, material, parent=parent,
        bevel=bevel, bevel_segments=bevel_segments, grain_axis="Z", uv_offset=uv_offset,
        collision=collision, properties=properties,
    )


def arch_ring(
    name: str,
    outer_radius: float,
    inner_radius: float,
    center_z: float,
    depth: float,
    y: float,
    material: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    segments: int = 24,
    bevel: float = 0.004,
    bevel_segments: int = 2,
    uv_offset: tuple[float, float] = (0.0, 0.0),
    properties: Mapping[str, object] | None = None,
) -> bpy.types.Object:
    outer = arch_points(outer_radius, center_z, segments)
    inner = list(reversed(arch_points(inner_radius, center_z, segments)))
    return polygon_prism(
        name, outer + inner, depth, y, material, parent=parent,
        bevel=bevel, bevel_segments=bevel_segments, grain_axis="X", uv_offset=uv_offset,
        properties=properties,
    )


def arched_glass_half(
    name: str,
    radius: float,
    center_z: float,
    depth: float,
    y: float,
    side: str,
    material: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    segments: int,
) -> bpy.types.Object:
    if side == "right":
        arc = arch_points(radius, center_z, segments, start=0.0, end=math.pi / 2.0)
    else:
        arc = arch_points(radius, center_z, segments, start=math.pi / 2.0, end=math.pi)
    points = [(0.0, center_z), *arc]
    return polygon_prism(
        name, points, depth, y, material, parent=parent,
        bevel=0.0015, bevel_segments=1, grain_axis="Z",
        properties={"glazing": True, "privacy_glass": True, "double_sided": True},
    )


def mark_lod(obj: bpy.types.Object, lod: int) -> None:
    obj["lod_level"] = int(lod)
    obj["lod_distance_m"] = LOD_DISTANCES_M[lod]


def join_meshes(
    name: str,
    objects: Sequence[bpy.types.Object],
    *,
    parent: bpy.types.Object | None = None,
    properties: Mapping[str, object] | None = None,
) -> bpy.types.Object:
    valid = [obj for obj in objects if obj and obj.type == "MESH"]
    if not valid:
        raise ValueError(f"{name}: no meshes to join")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in valid:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = valid[0]
    bpy.ops.object.join()
    result = bpy.context.object
    result.name = name
    set_properties(result, properties)
    if not bool((properties or {}).get("collision_proxy")):
        # Joining manufactured pieces can invalidate their per-object sharp-edge
        # normals. Recompute the angle split on the final mesh to prevent bright
        # smoothing wedges across frame fronts and jamb returns.
        shade_manufactured(result)
    if parent is not None and result.parent is not parent:
        set_parent_keep_world(result, parent)
    return result


def lod_parent(name: str, lod: int, parent: bpy.types.Object) -> bpy.types.Object:
    obj = group(f"{LOD_NAMES[lod]}_{name}", parent, lod_level=lod, lod_distance_m=LOD_DISTANCES_M[lod])
    mark_lod(obj, lod)
    return obj


def add_rect_panel(
    spec: DoorSpec,
    lod: int,
    parent: bpy.types.Object,
    *,
    name: str,
    center_x: float,
    center_z: float,
    width: float,
    height: float,
    face: str,
    material: bpy.types.Material,
    raised: bool,
    grain_offset: float,
) -> list[bpy.types.Object]:
    side = -1.0 if face == "Exterior" else 1.0
    face_y = side * (spec.leaf_thickness / 2.0)
    pieces: list[bpy.types.Object] = []
    level = {"basic": 0, "standard": 1, "premium": 2, "high-end": 3, "luxury": 4}[spec.key]
    border = (0.038 + level * 0.004) if lod < 2 else 0.030
    mould_depth = (0.014 + level * 0.002) if lod == 0 else (0.011 if lod == 1 else 0.007)
    inset = 0.018 if raised else 0.009
    panel_depth = 0.012 if lod < 2 else 0.007
    panel_y = face_y + side * (panel_depth / 2.0 + (inset if raised else 0.002))
    panel = box(
        f"MESH_{LOD_NAMES[lod]}_{name}_{face}_Field",
        (max(0.05, width - border * 1.65), panel_depth, max(0.05, height - border * 1.65)),
        (center_x, panel_y, center_z), material, parent=parent,
        bevel=0.010 if lod == 0 else 0.006 if lod == 1 else 0.002,
        bevel_segments=LOD_BEVEL_SEGMENTS[lod], grain_axis="Z",
        uv_offset=(grain_offset, 0.0),
        properties={"panel": name, "face": face, "raised": raised, "lod": lod},
    )
    pieces.append(panel)
    mould_y = face_y + side * (mould_depth / 2.0 + inset * 0.65)
    rail_bevel = 0.010 if lod == 0 else 0.006 if lod == 1 else 0.002
    for rail_name, dims, location, axis in (
        ("Left", (border, mould_depth, height), (center_x - width / 2.0 + border / 2.0, mould_y, center_z), "Z"),
        ("Right", (border, mould_depth, height), (center_x + width / 2.0 - border / 2.0, mould_y, center_z), "Z"),
        ("Top", (width - border * 2.0, mould_depth, border), (center_x, mould_y, center_z + height / 2.0 - border / 2.0), "X"),
        ("Bottom", (width - border * 2.0, mould_depth, border), (center_x, mould_y, center_z - height / 2.0 + border / 2.0), "X"),
    ):
        pieces.append(box(
            f"MESH_{LOD_NAMES[lod]}_{name}_{face}_Moulding{rail_name}",
            dims, location, material, parent=parent,
            bevel=rail_bevel, bevel_segments=LOD_BEVEL_SEGMENTS[lod],
            grain_axis=axis, uv_offset=(grain_offset + (0.11 if axis == "X" else 0.0), 0.0),
            properties={"panel_moulding": name, "face": face, "lod": lod},
        ))
    return pieces


def add_curved_luxury_panel(
    spec: DoorSpec,
    lod: int,
    parent: bpy.types.Object,
    *,
    name: str,
    center_x: float,
    center_z: float,
    width: float,
    height: float,
    face: str,
    direction: float,
    material: bpy.types.Material,
    grain_offset: float,
) -> list[bpy.types.Object]:
    side = -1.0 if face == "Exterior" else 1.0
    depth = 0.015 if lod == 0 else 0.010 if lod == 1 else 0.007
    y = side * (spec.leaf_thickness / 2.0 + depth / 2.0 + 0.012)
    half = width / 2.0
    bottom = center_z - height / 2.0
    top_outer = center_z + height / 2.0 - 0.055
    top_inner = center_z + height / 2.0 + 0.035
    left_top = top_outer if direction > 0 else top_inner
    right_top = top_inner if direction > 0 else top_outer
    segments = 10 if lod == 0 else 6 if lod == 1 else 3
    points = [(center_x - half, bottom), (center_x + half, bottom), (center_x + half, right_top)]
    for index in range(1, segments + 1):
        t = index / segments
        x = center_x + half - width * t
        eased = t * t * (3.0 - 2.0 * t)
        z = right_top * (1.0 - eased) + left_top * eased + math.sin(math.pi * t) * 0.045
        points.append((x, z))
    field = polygon_prism(
        f"MESH_{LOD_NAMES[lod]}_{name}_{face}_CurvedField",
        points, depth, y, material, parent=parent,
        bevel=0.012 if lod == 0 else 0.006 if lod == 1 else 0.002,
        bevel_segments=LOD_BEVEL_SEGMENTS[lod], grain_axis="Z", uv_offset=(grain_offset, 0.0),
        properties={"panel": name, "face": face, "raised": True, "curved_top": True, "lod": lod},
    )
    # A physically separate inner field plus four moulding rails reads as deep
    # millwork while retaining the reference's subtle rising top line.
    mould_depth = depth * 0.88
    mould_y = y + side * (depth * 0.74)
    border = 0.046 if lod < 2 else 0.032
    pieces = [field]
    pieces.extend((
        box(
            f"MESH_{LOD_NAMES[lod]}_{name}_{face}_MouldingLeft",
            (border, mould_depth, height - 0.05),
            (center_x - half + border / 2.0, mould_y, center_z - 0.01), material,
            parent=parent, bevel=0.008 if lod == 0 else 0.004,
            bevel_segments=LOD_BEVEL_SEGMENTS[lod], grain_axis="Z", uv_offset=(grain_offset + 0.05, 0.0),
        ),
        box(
            f"MESH_{LOD_NAMES[lod]}_{name}_{face}_MouldingRight",
            (border, mould_depth, height - 0.05),
            (center_x + half - border / 2.0, mould_y, center_z - 0.01), material,
            parent=parent, bevel=0.008 if lod == 0 else 0.004,
            bevel_segments=LOD_BEVEL_SEGMENTS[lod], grain_axis="Z", uv_offset=(grain_offset + 0.13, 0.0),
        ),
        box(
            f"MESH_{LOD_NAMES[lod]}_{name}_{face}_MouldingBottom",
            (width - border * 2.0, mould_depth, border),
            (center_x, mould_y, bottom + border / 2.0), material,
            parent=parent, bevel=0.008 if lod == 0 else 0.004,
            bevel_segments=LOD_BEVEL_SEGMENTS[lod], grain_axis="X", uv_offset=(grain_offset + 0.21, 0.0),
        ),
    ))
    curved_points: list[tuple[float, float, float]] = []
    for index in range(segments + 1):
        t = index / segments
        x = center_x - half + border + (width - border * 2.0) * t
        eased = t * t * (3.0 - 2.0 * t)
        z = left_top * (1.0 - eased) + right_top * eased + math.sin(math.pi * t) * 0.045
        curved_points.append((x, mould_y, z - border * 0.45))
    pieces.append(curve_tube(
        f"MESH_{LOD_NAMES[lod]}_{name}_{face}_MouldingCurvedTop",
        curved_points, border * 0.36, material, parent=parent,
        resolution=4 if lod == 0 else 3 if lod == 1 else 2,
        bevel_resolution=3 if lod == 0 else 2 if lod == 1 else 1,
        properties={"panel_moulding": name, "face": face, "lod": lod, "curved_top": True},
    ))
    return pieces


def tier_level(spec: DoorSpec) -> int:
    return {"basic": 0, "standard": 1, "premium": 2, "high-end": 3, "luxury": 4}[spec.key]


def build_rect_frame(spec: DoorSpec, lod: int, parent: bpy.types.Object) -> None:
    material = MATERIALS["frame"]
    level = tier_level(spec)
    segments = LOD_BEVEL_SEGMENTS[lod]
    jamb = 0.072 + level * 0.008
    head = jamb + (0.012 if level >= 2 else 0.0)
    bevel = 0.010 + level * 0.002 if lod == 0 else 0.006 if lod == 1 else 0.002
    parts: list[bpy.types.Object] = []
    for side, x in (("Left", -(spec.opening_width + jamb) / 2.0), ("Right", (spec.opening_width + jamb) / 2.0)):
        parts.append(box(
            f"MESH_{LOD_NAMES[lod]}_Jamb_{side}",
            (jamb, spec.frame_depth, spec.opening_height + head),
            (x, 0.0, (spec.opening_height + head) / 2.0), material,
            parent=parent, bevel=bevel, bevel_segments=segments, grain_axis="Z",
            uv_offset=(0.07 if side == "Left" else 0.37, 0.0),
            properties={"frame_component": "jamb", "side": side.lower(), "lod": lod},
        ))
    parts.append(box(
        f"MESH_{LOD_NAMES[lod]}_HeadJamb",
        (spec.opening_width + jamb * 2.0, spec.frame_depth, head),
        (0.0, 0.0, spec.opening_height + head / 2.0), material,
        parent=parent, bevel=bevel, bevel_segments=segments, grain_axis="X", uv_offset=(0.19, 0.0),
        properties={"frame_component": "head_jamb", "lod": lod},
    ))
    stop_width = 0.024 + level * 0.002
    stop_depth = 0.026
    # The authored default swing is inward (+Y), so stops and seals sit on the
    # exterior (-Y) face and never obstruct the first degrees of travel.
    stop_y = -(spec.leaf_thickness / 2.0 + stop_depth / 2.0 + 0.004)
    for side, x in (("Left", -spec.opening_width / 2.0 + stop_width / 2.0), ("Right", spec.opening_width / 2.0 - stop_width / 2.0)):
        parts.append(box(
            f"MESH_{LOD_NAMES[lod]}_DoorStop_{side}",
            (stop_width, stop_depth, spec.opening_height - 0.028),
            (x, stop_y, (spec.opening_height - 0.028) / 2.0 + 0.014), material,
            parent=parent, bevel=0.004 if lod < 2 else 0.001,
            bevel_segments=segments, grain_axis="Z", uv_offset=(0.43, 0.0),
            properties={"door_stop": True, "side": side.lower(), "lod": lod},
        ))
    parts.append(box(
        f"MESH_{LOD_NAMES[lod]}_DoorStop_Head",
        (spec.opening_width - stop_width * 2.0, stop_depth, stop_width),
        (0.0, stop_y, spec.opening_height - stop_width / 2.0), material,
        parent=parent, bevel=0.004 if lod < 2 else 0.001,
        bevel_segments=segments, grain_axis="X", uv_offset=(0.55, 0.0),
        properties={"door_stop": True, "side": "head", "lod": lod},
    ))
    if lod < 2:
        seal_width = 0.010
        seal_depth = 0.006
        seal_y = -(spec.leaf_thickness / 2.0 + seal_depth / 2.0 + 0.001)
        for side, x in (("Left", -spec.opening_width / 2.0 + seal_width / 2.0),
                        ("Right", spec.opening_width / 2.0 - seal_width / 2.0)):
            parts.append(box(
                f"MESH_{LOD_NAMES[lod]}_WeatherSeal_{side}",
                (seal_width, seal_depth, spec.opening_height - 0.030),
                (x, seal_y, spec.opening_height / 2.0), MATERIALS["rubber"],
                parent=parent, bevel=0.0015, bevel_segments=1, grain_axis="Z",
                properties={"weather_seal": True, "compressible": True, "side": side.lower(), "lod": lod},
            ))
        parts.append(box(
            f"MESH_{LOD_NAMES[lod]}_WeatherSeal_Head",
            (spec.opening_width - seal_width * 2.0, seal_depth, seal_width),
            (0.0, seal_y, spec.opening_height - seal_width / 2.0), MATERIALS["rubber"],
            parent=parent, bevel=0.0015, bevel_segments=1, grain_axis="X",
            properties={"weather_seal": True, "compressible": True, "side": "head", "lod": lod},
        ))
    casing_layers = 1 if lod == 2 else (1 + (1 if level >= 1 else 0) + (1 if level >= 3 and lod == 0 else 0))
    base_casing = 0.070 + level * 0.013
    for face_name, face_sign in (("Front", -1.0), ("Rear", 1.0)):
        for layer in range(casing_layers):
            casing_width = max(0.042, base_casing - layer * 0.019)
            casing_depth = 0.026 - min(layer, 1) * 0.004
            y = face_sign * (spec.frame_depth / 2.0 + casing_depth / 2.0 + layer * 0.004)
            inset = layer * 0.017
            outer_x = spec.opening_width / 2.0 + jamb + casing_width / 2.0 - inset
            casing_height = spec.opening_height + head + casing_width - inset
            for side, x in (("Left", -outer_x), ("Right", outer_x)):
                parts.append(box(
                    f"MESH_{LOD_NAMES[lod]}_Casing_{face_name}_{side}_Layer{layer + 1}",
                    (casing_width, casing_depth, casing_height),
                    (x, y, casing_height / 2.0), material,
                    parent=parent, bevel=bevel * (0.78 if layer else 1.0), bevel_segments=segments,
                    grain_axis="Z", uv_offset=(0.12 + layer * 0.11 + (0.25 if face_sign > 0 else 0.0), 0.0),
                    properties={"casing": True, "face": face_name.lower(), "layer": layer + 1, "lod": lod},
                ))
            parts.append(box(
                f"MESH_{LOD_NAMES[lod]}_Casing_{face_name}_Head_Layer{layer + 1}",
                (spec.opening_width + jamb * 2.0 + casing_width * 2.0 - inset * 2.0, casing_depth, casing_width),
                (0.0, y, spec.opening_height + head + casing_width / 2.0 - inset), material,
                parent=parent, bevel=bevel * (0.78 if layer else 1.0), bevel_segments=segments,
                grain_axis="X", uv_offset=(0.28 + layer * 0.13, 0.0),
                properties={"casing": True, "face": face_name.lower(), "layer": layer + 1, "lod": lod},
            ))
    threshold_material = MATERIALS["brass_structural"] if spec.key in ("high-end", "luxury") else material
    parts.append(box(
        f"MESH_{LOD_NAMES[lod]}_Threshold",
        (spec.opening_width + jamb * 0.4, spec.frame_depth + 0.055, 0.020 if level < 2 else 0.028),
        (0.0, -0.010, 0.010 if level < 2 else 0.014), threshold_material,
        parent=parent, bevel=0.005 if lod == 0 else 0.002,
        bevel_segments=segments, grain_axis="X", uv_offset=(0.33, 0.0),
        properties={"threshold": True, "floor_contact": True, "lod": lod},
    ))
    join_meshes(
        f"MESH_{LOD_NAMES[lod]}_StaticFrameAssembly", parts, parent=parent,
        properties={"static_frame": True, "lod": lod, "wall_depth_m": spec.frame_depth},
    )


def build_arch_frame(spec: DoorSpec, lod: int, parent: bpy.types.Object) -> None:
    material = MATERIALS["frame"]
    segments_count = 36 if lod == 0 else 22 if lod == 1 else 12
    bevel_segments = LOD_BEVEL_SEGMENTS[lod]
    inner_radius = spec.opening_width / 2.0
    spring = spec.opening_height - inner_radius
    jamb = 0.102 if lod < 2 else 0.085
    parts: list[bpy.types.Object] = []
    for side, x in (("Left", -(inner_radius + jamb / 2.0)), ("Right", inner_radius + jamb / 2.0)):
        parts.append(box(
            f"MESH_{LOD_NAMES[lod]}_ArchedJamb_{side}",
            (jamb, spec.frame_depth, spring + 0.018), (x, 0.0, (spring + 0.018) / 2.0),
            material, parent=parent, bevel=0.014 if lod == 0 else 0.007 if lod == 1 else 0.002,
            bevel_segments=bevel_segments, grain_axis="Z", uv_offset=(0.11 if side == "Left" else 0.47, 0.0),
            properties={"frame_component": "arched_jamb", "side": side.lower(), "lod": lod},
        ))
    parts.append(arch_ring(
        f"MESH_{LOD_NAMES[lod]}_ArchedHeadJamb",
        inner_radius + jamb, inner_radius, spring, spec.frame_depth, 0.0, material,
        parent=parent, segments=segments_count,
        bevel=0.012 if lod == 0 else 0.006 if lod == 1 else 0.002,
        bevel_segments=bevel_segments, uv_offset=(0.24, 0.0),
        properties={"frame_component": "arched_head", "lod": lod},
    ))
    stop_width = 0.030
    stop_depth = 0.030
    stop_y = -(spec.leaf_thickness / 2.0 + stop_depth / 2.0 + 0.004)
    for side, x in (("Left", -inner_radius + stop_width / 2.0), ("Right", inner_radius - stop_width / 2.0)):
        parts.append(box(
            f"MESH_{LOD_NAMES[lod]}_ArchedDoorStop_{side}",
            (stop_width, stop_depth, spring), (x, stop_y, spring / 2.0), material,
            parent=parent, bevel=0.004 if lod < 2 else 0.001, bevel_segments=bevel_segments,
            grain_axis="Z", uv_offset=(0.58, 0.0), properties={"door_stop": True, "lod": lod},
        ))
    parts.append(arch_ring(
        f"MESH_{LOD_NAMES[lod]}_ArchedDoorStop_Head",
        inner_radius, inner_radius - stop_width, spring, stop_depth, stop_y, material,
        parent=parent, segments=segments_count,
        bevel=0.003 if lod < 2 else 0.001, bevel_segments=bevel_segments,
        uv_offset=(0.63, 0.0), properties={"door_stop": True, "lod": lod},
    ))
    if lod < 2:
        seal_width = 0.011
        seal_depth = 0.006
        seal_y = -(spec.leaf_thickness / 2.0 + seal_depth / 2.0 + 0.001)
        for side, x in (("Left", -inner_radius + seal_width / 2.0),
                        ("Right", inner_radius - seal_width / 2.0)):
            parts.append(box(
                f"MESH_{LOD_NAMES[lod]}_ArchedWeatherSeal_{side}",
                (seal_width, seal_depth, spring), (x, seal_y, spring / 2.0), MATERIALS["rubber"],
                parent=parent, bevel=0.0015, bevel_segments=1, grain_axis="Z",
                properties={"weather_seal": True, "compressible": True, "side": side.lower(), "lod": lod},
            ))
        parts.append(arch_ring(
            f"MESH_{LOD_NAMES[lod]}_ArchedWeatherSeal_Head",
            inner_radius - 0.003, inner_radius - seal_width,
            spring, seal_depth, seal_y, MATERIALS["rubber"], parent=parent,
            segments=segments_count, bevel=0.0015, bevel_segments=1,
            properties={"weather_seal": True, "compressible": True, "side": "head", "lod": lod},
        ))
    casing_layers = 1 if lod == 2 else 2 if lod == 1 else 3
    base_width = 0.135
    for face_name, face_sign in (("Front", -1.0), ("Rear", 1.0)):
        for layer in range(casing_layers):
            width = base_width - layer * 0.030
            depth = 0.030 - min(layer, 1) * 0.005
            y = face_sign * (spec.frame_depth / 2.0 + depth / 2.0 + layer * 0.004)
            outer = inner_radius + jamb + width - layer * 0.014
            inner = inner_radius + jamb - layer * 0.014
            for side, x in (("Left", -(inner_radius + jamb + width / 2.0 - layer * 0.014)),
                            ("Right", inner_radius + jamb + width / 2.0 - layer * 0.014)):
                parts.append(box(
                    f"MESH_{LOD_NAMES[lod]}_ArchedCasing_{face_name}_{side}_Layer{layer + 1}",
                    (width, depth, spring + width * 0.4),
                    (x, y, (spring + width * 0.4) / 2.0), material,
                    parent=parent, bevel=0.014 if lod == 0 else 0.006 if lod == 1 else 0.002,
                    bevel_segments=bevel_segments, grain_axis="Z", uv_offset=(0.18 + layer * 0.14, 0.0),
                    properties={"casing": True, "face": face_name.lower(), "layer": layer + 1, "lod": lod},
                ))
            parts.append(arch_ring(
                f"MESH_{LOD_NAMES[lod]}_ArchedCasing_{face_name}_Head_Layer{layer + 1}",
                outer, inner, spring, depth, y, material, parent=parent, segments=segments_count,
                bevel=0.012 if lod == 0 else 0.005 if lod == 1 else 0.002,
                bevel_segments=bevel_segments, uv_offset=(0.30 + layer * 0.12, 0.0),
                properties={"casing": True, "face": face_name.lower(), "layer": layer + 1, "lod": lod},
            ))
    parts.append(box(
        f"MESH_{LOD_NAMES[lod]}_ArchedThreshold",
        (spec.opening_width + 0.10, spec.frame_depth + 0.075, 0.030),
        (0.0, -0.010, 0.015), MATERIALS["brass_structural"], parent=parent,
        bevel=0.006 if lod == 0 else 0.002, bevel_segments=bevel_segments,
        grain_axis="X", properties={"threshold": True, "floor_contact": True, "lod": lod},
    ))
    join_meshes(
        f"MESH_{LOD_NAMES[lod]}_StaticArchedFrameAssembly", parts, parent=parent,
        properties={"static_frame": True, "arched": True, "lod": lod, "wall_depth_m": spec.frame_depth},
    )


def panel_layout(spec: DoorSpec, leaf_center_x: float, leaf_width: float) -> list[dict[str, float | str | bool]]:
    if spec.panel_style == "two_panel_basic":
        return [
            {"name": "UpperPanel", "x": leaf_center_x, "z": 1.38, "w": leaf_width * 0.68, "h": 0.94, "raised": False},
            {"name": "LowerPanel", "x": leaf_center_x, "z": 0.48, "w": leaf_width * 0.68, "h": 0.46, "raised": False},
        ]
    if spec.panel_style == "two_panel_refined":
        return [
            {"name": "UpperPanel", "x": leaf_center_x, "z": 1.40, "w": leaf_width * 0.69, "h": 0.98, "raised": True},
            {"name": "LowerPanel", "x": leaf_center_x, "z": 0.48, "w": leaf_width * 0.69, "h": 0.53, "raised": True},
        ]
    if spec.panel_style == "premium_three_panel":
        lower_w = leaf_width * 0.285
        return [
            {"name": "UpperPanel", "x": leaf_center_x, "z": 1.48, "w": leaf_width * 0.69, "h": 1.04, "raised": True},
            {"name": "LowerPanelLeft", "x": leaf_center_x - leaf_width * 0.185, "z": 0.48, "w": lower_w, "h": 0.56, "raised": True},
            {"name": "LowerPanelRight", "x": leaf_center_x + leaf_width * 0.185, "z": 0.48, "w": lower_w, "h": 0.56, "raised": True},
        ]
    if spec.panel_style == "luxury_double":
        return [
            {"name": "UpperPanel", "x": leaf_center_x, "z": 1.56, "w": leaf_width * 0.67, "h": 0.95, "raised": True, "curved": True},
            {"name": "LowerPanel", "x": leaf_center_x, "z": 0.49, "w": leaf_width * 0.62, "h": 0.58, "raised": True},
        ]
    return []


def build_rect_leaf_geometry(
    spec: DoorSpec,
    lod: int,
    leaf_parent: bpy.types.Object,
    *,
    leaf_name: str,
    hinge_x: float,
    direction: float,
    grain_offset: float,
) -> None:
    material = MATERIALS["primary"]
    segments = LOD_BEVEL_SEGMENTS[lod]
    center_x = hinge_x + direction * spec.leaf_width / 2.0
    bottom_gap = 0.012
    slab = box(
        f"MESH_{LOD_NAMES[lod]}_{leaf_name}_Slab",
        (spec.leaf_width, spec.leaf_thickness, spec.leaf_height),
        (center_x, 0.0, bottom_gap + spec.leaf_height / 2.0), material,
        parent=leaf_parent, bevel=0.009 + tier_level(spec) * 0.002 if lod == 0 else 0.005 if lod == 1 else 0.0015,
        bevel_segments=segments, grain_axis="Z", uv_offset=(grain_offset, 0.0),
        properties={"door_leaf": leaf_name, "moving_component": True, "lod": lod},
    )
    if spec.key in ("premium", "luxury"):
        rail_depth = 0.013 if lod < 2 else 0.006
        face_y = -spec.leaf_thickness / 2.0 - rail_depth / 2.0 + 0.002
        rail_parts = [
            box(
                f"MESH_{LOD_NAMES[lod]}_{leaf_name}_ExteriorHingeStile",
                (spec.leaf_width * 0.18, rail_depth, spec.leaf_height - 0.05),
                (hinge_x + direction * spec.leaf_width * 0.09, face_y, bottom_gap + spec.leaf_height / 2.0),
                material, parent=leaf_parent, bevel=0.007 if lod == 0 else 0.003,
                bevel_segments=segments, grain_axis="Z", uv_offset=(grain_offset + 0.09, 0.0),
            ),
            box(
                f"MESH_{LOD_NAMES[lod]}_{leaf_name}_ExteriorLatchStile",
                (spec.leaf_width * 0.18, rail_depth, spec.leaf_height - 0.05),
                (hinge_x + direction * spec.leaf_width * 0.91, face_y, bottom_gap + spec.leaf_height / 2.0),
                material, parent=leaf_parent, bevel=0.007 if lod == 0 else 0.003,
                bevel_segments=segments, grain_axis="Z", uv_offset=(grain_offset + 0.29, 0.0),
            ),
        ]
        for index, z in enumerate((0.16, 0.89, spec.leaf_height - 0.12), 1):
            rail_parts.append(box(
                f"MESH_{LOD_NAMES[lod]}_{leaf_name}_ExteriorRail{index}",
                (spec.leaf_width * 0.70, rail_depth, 0.105 if index != 2 else 0.125),
                (center_x, face_y, z), material, parent=leaf_parent,
                bevel=0.007 if lod == 0 else 0.003, bevel_segments=segments,
                grain_axis="X", uv_offset=(grain_offset + 0.17 * index, 0.0),
            ))
    for panel_index, panel in enumerate(panel_layout(spec, center_x, spec.leaf_width), 1):
        for face_index, face in enumerate(("Exterior", "Interior")):
            offset = grain_offset + panel_index * 0.137 + face_index * 0.311
            name = f"{leaf_name}_{panel['name']}"
            if panel.get("curved"):
                add_curved_luxury_panel(
                    spec, lod, leaf_parent, name=name,
                    center_x=float(panel["x"]), center_z=float(panel["z"]),
                    width=float(panel["w"]), height=float(panel["h"]), face=face,
                    direction=direction, material=material, grain_offset=offset,
                )
            else:
                add_rect_panel(
                    spec, lod, leaf_parent, name=name,
                    center_x=float(panel["x"]), center_z=float(panel["z"]),
                    width=float(panel["w"]), height=float(panel["h"]), face=face,
                    material=material, raised=bool(panel["raised"]), grain_offset=offset,
                )
    slab["panel_count"] = len(panel_layout(spec, center_x, spec.leaf_width))


def build_arch_leaf_geometry(
    spec: DoorSpec,
    lod: int,
    leaf_parent: bpy.types.Object,
    *,
    leaf_name: str,
    hinge_x: float,
    direction: float,
    grain_offset: float,
) -> None:
    material = MATERIALS["primary"]
    glass = MATERIALS["glass"]
    segments = 32 if lod == 0 else 20 if lod == 1 else 12
    bevel_segments = LOD_BEVEL_SEGMENTS[lod]
    center_x = hinge_x + direction * spec.leaf_width / 2.0
    radius = spec.leaf_width / 2.0
    spring = spec.spring_height
    bottom_gap = 0.012
    glass_bottom = 0.89
    stile = 0.112 if lod < 2 else 0.095
    glass_radius = radius - stile - 0.014
    parts: list[bpy.types.Object] = []
    parts.append(box(
        f"MESH_{LOD_NAMES[lod]}_{leaf_name}_LowerSolid",
        (spec.leaf_width, spec.leaf_thickness, glass_bottom),
        (center_x, 0.0, bottom_gap + glass_bottom / 2.0), material,
        parent=leaf_parent, bevel=0.012 if lod == 0 else 0.006 if lod == 1 else 0.002,
        bevel_segments=bevel_segments, grain_axis="Z", uv_offset=(grain_offset, 0.0),
        properties={"door_leaf": leaf_name, "moving_component": True, "lod": lod},
    ))
    for side_name, x in (("Hinge", hinge_x + direction * stile / 2.0),
                         ("Latch", hinge_x + direction * (spec.leaf_width - stile / 2.0))):
        parts.append(box(
            f"MESH_{LOD_NAMES[lod]}_{leaf_name}_{side_name}Stile",
            (stile, spec.leaf_thickness, spring - glass_bottom + 0.018),
            (x, 0.0, glass_bottom + (spring - glass_bottom + 0.018) / 2.0), material,
            parent=leaf_parent, bevel=0.010 if lod == 0 else 0.005 if lod == 1 else 0.002,
            bevel_segments=bevel_segments, grain_axis="Z", uv_offset=(grain_offset + (0.09 if side_name == "Hinge" else 0.31), 0.0),
            properties={"door_leaf": leaf_name, "joinery": "stile", "lod": lod},
        ))
    parts.append(arch_ring(
        f"MESH_{LOD_NAMES[lod]}_{leaf_name}_ArchedTopRail",
        radius, glass_radius, spring, spec.leaf_thickness, 0.0, material,
        parent=leaf_parent, segments=segments,
        bevel=0.010 if lod == 0 else 0.005 if lod == 1 else 0.002,
        bevel_segments=bevel_segments, uv_offset=(grain_offset + 0.19, 0.0),
        properties={"door_leaf": leaf_name, "joinery": "arched_top_rail", "lod": lod},
    ))
    parts.append(box(
        f"MESH_{LOD_NAMES[lod]}_{leaf_name}_LockRail",
        (spec.leaf_width - stile * 2.0, spec.leaf_thickness, 0.115),
        (center_x, 0.0, glass_bottom + 0.012), material,
        parent=leaf_parent, bevel=0.010 if lod == 0 else 0.005 if lod == 1 else 0.002,
        bevel_segments=bevel_segments, grain_axis="X", uv_offset=(grain_offset + 0.41, 0.0),
        properties={"door_leaf": leaf_name, "joinery": "lock_rail", "lod": lod},
    ))
    # The reference uses two columns and three rectangular rows below a split
    # semicircular crown: eight independently named, physically thick panes.
    glass_left = center_x - glass_radius
    glass_right = center_x + glass_radius
    center_gap = 0.027 if lod < 2 else 0.022
    horizontal_gap = 0.026 if lod < 2 else 0.020
    rect_bottom = glass_bottom + 0.075
    rect_top = spring - 0.012
    row_height = (rect_top - rect_bottom - horizontal_gap * 2.0) / 3.0
    pane_index = 1
    for row in range(3):
        z0 = rect_bottom + row * (row_height + horizontal_gap)
        zc = z0 + row_height / 2.0
        for column, (x0, x1) in enumerate(((glass_left, center_x - center_gap / 2.0),
                                           (center_x + center_gap / 2.0, glass_right))):
            box(
                f"MESH_{LOD_NAMES[lod]}_{leaf_name}_GlassPane_{pane_index:02d}",
                (x1 - x0 - 0.008, 0.012, row_height - 0.008),
                ((x0 + x1) / 2.0, 0.0, zc), glass, parent=leaf_parent,
                bevel=0.002 if lod < 2 else 0.001, bevel_segments=1,
                grain_axis="Z", uv_offset=(0.13 * pane_index, 0.17 * row),
                properties={"glazing": True, "privacy_glass": True, "pane_index": pane_index, "lod": lod},
            )
            pane_index += 1
    for half_side in ("left", "right"):
        pane = arched_glass_half(
            f"MESH_{LOD_NAMES[lod]}_{leaf_name}_GlassPane_{pane_index:02d}",
            glass_radius - 0.010, spring, 0.012, 0.0, half_side, glass,
            parent=leaf_parent, segments=max(5, segments // 2),
        )
        pane["pane_index"] = pane_index
        pane["lod"] = lod
        pane_index += 1
    muntin_depth = spec.leaf_thickness * 0.76
    parts.append(box(
        f"MESH_{LOD_NAMES[lod]}_{leaf_name}_MuntinVertical",
        (center_gap, muntin_depth, spec.leaf_height - rect_bottom - 0.04),
        (center_x, 0.0, rect_bottom + (spec.leaf_height - rect_bottom - 0.04) / 2.0), material,
        parent=leaf_parent, bevel=0.005 if lod == 0 else 0.002,
        bevel_segments=bevel_segments, grain_axis="Z", uv_offset=(grain_offset + 0.52, 0.0),
        properties={"muntin": True, "orientation": "vertical", "lod": lod},
    ))
    for index in range(1, 3):
        z = rect_bottom + index * row_height + (index - 0.5) * horizontal_gap
        parts.append(box(
            f"MESH_{LOD_NAMES[lod]}_{leaf_name}_MuntinHorizontal_{index}",
            (glass_radius * 2.0, muntin_depth, horizontal_gap),
            (center_x, 0.0, z), material, parent=leaf_parent,
            bevel=0.005 if lod == 0 else 0.002, bevel_segments=bevel_segments,
            grain_axis="X", uv_offset=(grain_offset + 0.61 + index * 0.07, 0.0),
            properties={"muntin": True, "orientation": "horizontal", "lod": lod},
        ))
    lower_panel_width = spec.leaf_width * 0.31
    for panel_index, x in enumerate((center_x - spec.leaf_width * 0.19, center_x + spec.leaf_width * 0.19), 1):
        for face_index, face in enumerate(("Exterior", "Interior")):
            add_rect_panel(
                spec, lod, leaf_parent,
                name=f"{leaf_name}_LowerPanel{panel_index}", center_x=x, center_z=0.47,
                width=lower_panel_width, height=0.48, face=face, material=material,
                raised=True, grain_offset=grain_offset + 0.11 * panel_index + 0.27 * face_index,
            )
    for piece in parts:
        piece["door_leaf"] = leaf_name
        piece["lod"] = lod


def handle_names(spec: DoorSpec, leaf_side: str | None, face: str) -> tuple[str, str, str]:
    side_token = f"_{leaf_side}" if leaf_side else ""
    return (
        f"PIVOT_Handle{side_token}_{face}",
        f"Backplate{side_token}_{face}",
        f"Handle{side_token}_{face}",
    )


def build_handle_hardware(
    spec: DoorSpec,
    lod: int,
    leaf_pivot: bpy.types.Object,
    leaf_lod_parent: bpy.types.Object,
    *,
    hinge_x: float,
    direction: float,
    leaf_side: str | None,
    handle_pivots: dict[str, bpy.types.Object],
) -> None:
    level = tier_level(spec)
    handle_x = hinge_x + direction * (spec.leaf_width - (0.105 if level < 2 else 0.115))
    handle_z = 1.02 if spec.key != "luxury" else 1.045
    hardware = MATERIALS["hardware"]
    plate_h = 0.0 if level < 2 else 0.26 + (0.04 if level >= 3 else 0.0)
    for face_index, (face, face_sign) in enumerate((("Exterior", -1.0), ("Interior", 1.0))):
        pivot_name, plate_name, handle_name = handle_names(spec, leaf_side, face)
        pivot = handle_pivots.get(pivot_name)
        if pivot is None:
            pivot = empty(
                pivot_name, (handle_x, face_sign * (spec.leaf_thickness / 2.0 + 0.045), handle_z),
                parent=leaf_pivot, display="ARROWS", size=0.055,
                properties={
                    "moving_component": "handle", "rotation_axis": "+Y",
                    "rest_degrees": 0.0, "pressed_degrees": -28.0,
                    "face": face.lower(), "leaf": leaf_side or "single",
                },
            )
            handle_pivots[pivot_name] = pivot
        handle_lod = lod_parent(f"{handle_name}", lod, pivot)
        face_y = face_sign * (spec.leaf_thickness / 2.0 + 0.010)
        if plate_h > 0.0:
            half_w = 0.043 if spec.key != "luxury" else 0.048
            top = handle_z + plate_h / 2.0
            bottom = handle_z - plate_h / 2.0
            plate_points = [
                (-half_w, bottom + 0.026), (-half_w * 0.72, bottom),
                (half_w * 0.72, bottom), (half_w, bottom + 0.026),
                (half_w, top - 0.026), (half_w * 0.72, top),
                (-half_w * 0.72, top), (-half_w, top - 0.026),
            ]
            plate_points = [(handle_x + x, z) for x, z in plate_points]
            polygon_prism(
                f"MESH_{LOD_NAMES[lod]}_{plate_name}", plate_points,
                0.018 if lod < 2 else 0.012, face_y, hardware,
                parent=leaf_lod_parent, bevel=0.006 if lod == 0 else 0.003 if lod == 1 else 0.001,
                bevel_segments=LOD_BEVEL_SEGMENTS[lod], grain_axis="Z",
                properties={"backplate": True, "face": face.lower(), "lod": lod},
            )
        else:
            cylinder(
                f"MESH_{LOD_NAMES[lod]}_{plate_name}_Rosette",
                0.047 if spec.key == "standard" else 0.044, 0.016,
                (handle_x, face_y, handle_z), hardware, parent=leaf_lod_parent,
                rotation=(math.pi / 2.0, 0.0, 0.0), vertices=LOD_CYLINDER_SEGMENTS[lod],
                bevel=0.003, properties={"backplate": True, "face": face.lower(), "lod": lod},
            )
        # Local geometry is authored in world coordinates and parented with a
        # preserved matrix, so rotation of the pivot occurs about the spindle.
        pivot_y = face_sign * (spec.leaf_thickness / 2.0 + 0.043)
        cylinder(
            f"MESH_{LOD_NAMES[lod]}_{handle_name}_Hub",
            0.027 + level * 0.0015, 0.045,
            (handle_x, pivot_y, handle_z), hardware, parent=handle_lod,
            rotation=(math.pi / 2.0, 0.0, 0.0), vertices=LOD_CYLINDER_SEGMENTS[lod],
            bevel=0.004, properties={"handle": True, "face": face.lower(), "lod": lod},
        )
        lever_length = 0.135 + level * 0.008
        lever_end_x = handle_x - direction * lever_length
        tube_between(
            f"MESH_{LOD_NAMES[lod]}_{handle_name}_Lever",
            (handle_x, pivot_y + face_sign * 0.018, handle_z),
            (lever_end_x, pivot_y + face_sign * 0.018, handle_z),
            0.011 + level * 0.0007, hardware, parent=handle_lod,
            vertices=LOD_CYLINDER_SEGMENTS[lod], bevel=0.003,
            properties={"handle": True, "face": face.lower(), "lod": lod},
        )
        sphere(
            f"MESH_{LOD_NAMES[lod]}_{handle_name}_LeverTip",
            0.013 + level * 0.0007, (lever_end_x, pivot_y + face_sign * 0.018, handle_z),
            hardware, parent=handle_lod, segments=LOD_CYLINDER_SEGMENTS[lod],
            properties={"handle": True, "face": face.lower(), "lod": lod},
        )
        if level >= 2:
            lock_z = handle_z - 0.105
            cylinder(
                f"MESH_{LOD_NAMES[lod]}_LockCylinder_{leaf_side or 'Single'}_{face}",
                0.018, 0.019, (handle_x, face_y + face_sign * 0.003, lock_z), hardware,
                parent=leaf_lod_parent, rotation=(math.pi / 2.0, 0.0, 0.0),
                vertices=LOD_CYLINDER_SEGMENTS[lod], bevel=0.002,
                properties={"lock_cylinder": True, "animation_ready": True, "face": face.lower(), "lod": lod},
            )
            if face == "Exterior":
                box(
                    f"MESH_{LOD_NAMES[lod]}_LockKeyway_{leaf_side or 'Single'}_{face}",
                    (0.0045, 0.0035, 0.014),
                    (handle_x, face_y + face_sign * 0.014, lock_z), MATERIALS["steel"],
                    parent=leaf_lod_parent, bevel=0.001, bevel_segments=1, grain_axis="Z",
                    properties={"keyway": True, "lock_prep": True, "face": face.lower(), "lod": lod},
                )
            else:
                box(
                    f"MESH_{LOD_NAMES[lod]}_LockThumbturn_{leaf_side or 'Single'}_{face}",
                    (0.020, 0.006, 0.006),
                    (handle_x, face_y + face_sign * 0.015, lock_z), hardware,
                    parent=leaf_lod_parent, rotation=(0.0, 0.0, math.radians(28.0)),
                    bevel=0.002, bevel_segments=1, grain_axis="X",
                    properties={"thumbturn": True, "lock_prep": True, "face": face.lower(), "lod": lod},
                )
    if lod == 0:
        cylinder(
            f"MESH_{LOD_NAMES[lod]}_HandleSpindle_{leaf_side or 'Single'}",
            0.010, spec.leaf_thickness + 0.080, (handle_x, 0.0, handle_z), MATERIALS["steel"],
            parent=leaf_lod_parent, rotation=(math.pi / 2.0, 0.0, 0.0), vertices=12, bevel=0.001,
            properties={"spindle": True, "leaf": leaf_side or "single", "lod": lod},
        )


def build_latch(
    spec: DoorSpec,
    lod: int,
    leaf_pivot: bpy.types.Object,
    *,
    hinge_x: float,
    direction: float,
    leaf_side: str | None,
    latch_pivots: dict[str, bpy.types.Object],
) -> None:
    suffix = f"_{leaf_side}" if leaf_side else ""
    pivot_name = f"PIVOT_LatchBolt{suffix}"
    latch_x = hinge_x + direction * spec.leaf_width
    pivot = latch_pivots.get(pivot_name)
    if pivot is None:
        pivot = empty(
            pivot_name, (latch_x, 0.0, 1.02), parent=leaf_pivot,
            display="ARROWS", size=0.045,
            properties={
                "moving_component": "latch", "translation_axis": "+X" if direction > 0 else "-X",
                "extended_m": 0.018, "retracted_m": 0.0, "leaf": leaf_side or "single",
            },
        )
        latch_pivots[pivot_name] = pivot
    latch_lod = lod_parent(f"LatchBolt{suffix}", lod, pivot)
    box(
        f"MESH_{LOD_NAMES[lod]}_LatchBolt{suffix}",
        (0.030, max(0.018, spec.leaf_thickness * 0.48), 0.040),
        (latch_x + direction * 0.010, 0.0, 1.02), MATERIALS["steel"],
        parent=latch_lod, bevel=0.006 if lod == 0 else 0.003 if lod == 1 else 0.001,
        bevel_segments=LOD_BEVEL_SEGMENTS[lod], grain_axis="X",
        properties={"latch_bolt": True, "animation_ready": True, "lod": lod},
    )


def hinge_heights(spec: DoorSpec) -> list[float]:
    if spec.hinge_count == 2:
        return [0.43, spec.leaf_height - 0.43]
    if spec.hinge_count == 3:
        return [0.34, spec.leaf_height * 0.52, spec.leaf_height - 0.34]
    return [0.30, spec.leaf_height * 0.36, spec.leaf_height * 0.67, spec.leaf_height - 0.28]


def build_hinges(
    spec: DoorSpec,
    lod: int,
    static_parent: bpy.types.Object,
    leaf_parent: bpy.types.Object,
    *,
    leaf_name: str,
    hinge_x: float,
    direction: float,
) -> None:
    vertices = LOD_CYLINDER_SEGMENTS[lod]
    hardware = MATERIALS["brass_structural"] if spec.key == "basic" else MATERIALS["hardware"]
    static_parts: list[bpy.types.Object] = []
    leaf_parts: list[bpy.types.Object] = []
    barrel_y = -spec.leaf_thickness / 2.0 - 0.010
    for index, z in enumerate(hinge_heights(spec), 1):
        static_parts.append(cylinder(
            f"MESH_{LOD_NAMES[lod]}_{leaf_name}_HingeBarrel_{index}",
            0.018 + tier_level(spec) * 0.0015, 0.115 + tier_level(spec) * 0.008,
            (hinge_x, barrel_y, z), hardware, parent=static_parent,
            vertices=vertices, bevel=0.0025,
            properties={"hinge": True, "hinge_axis": "+Z", "leaf": leaf_name, "lod": lod},
        ))
        leaf_parts.append(box(
            f"MESH_{LOD_NAMES[lod]}_{leaf_name}_HingeLeafPlate_{index}",
            (0.064, 0.010, 0.095 + tier_level(spec) * 0.007),
            (hinge_x + direction * 0.030, barrel_y + 0.010, z), hardware,
            parent=leaf_parent, bevel=0.005 if lod == 0 else 0.002,
            bevel_segments=LOD_BEVEL_SEGMENTS[lod], grain_axis="Z",
            properties={"hinge_leaf_plate": True, "hinge_axis": "+Z", "leaf": leaf_name, "lod": lod},
        ))
        if lod == 0:
            for cap_sign in (-1.0, 1.0):
                static_parts.append(sphere(
                    f"MESH_{LOD_NAMES[lod]}_{leaf_name}_HingeCap_{index}_{'Top' if cap_sign > 0 else 'Bottom'}",
                    0.019 + tier_level(spec) * 0.0015,
                    (hinge_x, barrel_y, z + cap_sign * (0.060 + tier_level(spec) * 0.004)), hardware,
                    parent=static_parent, segments=vertices,
                    properties={"hinge_cap": True, "leaf": leaf_name, "lod": lod},
                ))
    if static_parts:
        join_meshes(
            f"MESH_{LOD_NAMES[lod]}_{leaf_name}_StaticHingeHardware",
            static_parts, parent=static_parent,
            properties={"hinge_hardware": True, "static": True, "leaf": leaf_name, "lod": lod},
        )
    if leaf_parts:
        join_meshes(
            f"MESH_{LOD_NAMES[lod]}_{leaf_name}_MovingHingePlates",
            leaf_parts, parent=leaf_parent,
            properties={"hinge_hardware": True, "moving": True, "leaf": leaf_name, "lod": lod},
        )


def leaf_setup(spec: DoorSpec) -> list[dict[str, object]]:
    """Return stable hinge geometry for each independently moving leaf."""

    if spec.double:
        half_opening = spec.opening_width / 2.0
        return [
            {"side": "Left", "hinge_x": -half_opening, "direction": 1.0},
            {"side": "Right", "hinge_x": half_opening, "direction": -1.0},
        ]
    return [{"side": None, "hinge_x": -spec.leaf_width / 2.0, "direction": 1.0}]


def add_strike_hardware(spec: DoorSpec, lod: int, static_parent: bpy.types.Object) -> None:
    level = tier_level(spec)
    plate_h = 0.105 + level * 0.008
    plate_x = spec.opening_width / 2.0 + 0.004
    plate = box(
        f"MESH_{LOD_NAMES[lod]}_StrikePlate_Frame",
        (0.018, 0.006 if lod < 2 else 0.004, plate_h),
        (plate_x, -spec.leaf_thickness / 2.0 - 0.013, 1.02),
        MATERIALS["hardware"], parent=static_parent,
        bevel=0.004 if lod == 0 else 0.002 if lod == 1 else 0.001,
        bevel_segments=LOD_BEVEL_SEGMENTS[lod], grain_axis="Z",
        properties={"strike_plate": True, "lock_ready": True, "lod": lod},
    )
    if lod == 0:
        plate["cutout_width_m"] = 0.016
        plate["cutout_height_m"] = 0.046


def add_luxury_astragal(
    spec: DoorSpec,
    lod: int,
    right_leaf_parent: bpy.types.Object,
) -> None:
    """Build the overlapping meeting stile carried by the inactive right leaf."""

    seam_x = spec.opening_width / 2.0 - spec.leaf_width
    depth = 0.020 if lod == 0 else 0.014 if lod == 1 else 0.008
    box(
        f"MESH_{LOD_NAMES[lod]}_RightLeaf_ExteriorAstragal",
        (0.068 if lod < 2 else 0.054, depth, spec.leaf_height - 0.035),
        (seam_x, -spec.leaf_thickness / 2.0 - depth / 2.0, spec.leaf_height / 2.0 + 0.004),
        MATERIALS["primary"], parent=right_leaf_parent,
        bevel=0.008 if lod == 0 else 0.004 if lod == 1 else 0.001,
        bevel_segments=LOD_BEVEL_SEGMENTS[lod], grain_axis="Z", uv_offset=(0.73, 0.0),
        properties={"astragal": True, "moving": True, "leaf": "Right", "lod": lod},
    )


def add_luxury_center_strike(
    spec: DoorSpec,
    lod: int,
    right_leaf_parent: bpy.types.Object,
) -> None:
    seam_x = spec.opening_width / 2.0 - spec.leaf_width
    plate = box(
        f"MESH_{LOD_NAMES[lod]}_LuxuryCenterStrikePlate",
        (0.008, spec.leaf_thickness * 0.76, 0.112),
        (seam_x - 0.005, 0.0, 1.02), MATERIALS["hardware"],
        parent=right_leaf_parent, bevel=0.003 if lod == 0 else 0.0015,
        bevel_segments=LOD_BEVEL_SEGMENTS[lod], grain_axis="Z",
        properties={"strike_plate": True, "moving_with_inactive_leaf": True, "lod": lod},
    )
    plate["receives_latch_from"] = "Left"
    box(
        f"MESH_{LOD_NAMES[lod]}_LuxuryCenterStrikeRecess",
        (0.004, spec.leaf_thickness * 0.42, 0.046),
        (seam_x - 0.010, 0.0, 1.02), MATERIALS["rubber"],
        parent=right_leaf_parent, bevel=0.001, bevel_segments=1, grain_axis="Z",
        properties={"strike_recess": True, "receives_latch": True, "lod": lod},
    )


def add_flush_bolts(
    spec: DoorSpec,
    lod: int,
    right_leaf_pivot: bpy.types.Object,
    right_leaf_parent: bpy.types.Object,
    flush_pivots: dict[str, bpy.types.Object],
) -> None:
    seam_x = spec.opening_width / 2.0 - spec.leaf_width + 0.055
    face_y = spec.leaf_thickness / 2.0 + 0.012
    for position, z, axis in (
        ("Top", spec.leaf_height - 0.115, "+Z"),
        ("Bottom", 0.115, "-Z"),
    ):
        name = f"PIVOT_FlushBolt_Right_{position}"
        pivot = flush_pivots.get(name)
        if pivot is None:
            pivot = empty(
                name, (seam_x, face_y + 0.006, z), parent=right_leaf_pivot,
                display="ARROWS", size=0.035,
                properties={
                    "moving_component": "flush_bolt", "leaf": "Right", "position": position.lower(),
                    "translation_axis": axis, "travel_m": 0.018, "default_state": "extended",
                },
            )
            flush_pivots[name] = pivot
        bolt_lod = lod_parent(f"FlushBolt_Right_{position}", lod, pivot)
        box(
            f"MESH_{LOD_NAMES[lod]}_FlushBolt_Right_{position}_Plate",
            (0.036, 0.010, 0.095), (seam_x, face_y, z), MATERIALS["hardware"],
            parent=right_leaf_parent, bevel=0.004 if lod == 0 else 0.002,
            bevel_segments=LOD_BEVEL_SEGMENTS[lod], grain_axis="Z",
            properties={"flush_bolt_plate": True, "leaf": "Right", "lod": lod},
        )
        cylinder(
            f"MESH_{LOD_NAMES[lod]}_FlushBolt_Right_{position}_Rod",
            0.0075, 0.072, (seam_x, face_y + 0.008, z), MATERIALS["steel"],
            parent=bolt_lod, vertices=LOD_CYLINDER_SEGMENTS[lod], bevel=0.0015,
            properties={"flush_bolt": True, "functional": True, "leaf": "Right", "lod": lod},
        )


def add_collision(spec: DoorSpec, root: bpy.types.Object, leaf_pivots: Mapping[str, bpy.types.Object]) -> list[str]:
    collision_root = group(
        "COLLISION_DoorAssembly", root, collision_proxy=True,
        collision_role="authoring_and_placement", runtime_collision_authority="analytic_swing",
    )
    jamb_width = max(0.065, (spec.outer_width - spec.opening_width) / 2.0)
    # One named frame proxy may contain several closed manifold components.
    # Stop the jambs just below the header instead of overlapping their boxes;
    # the fresh-import validator intentionally welds coincident vertices and
    # would otherwise expose the buried coplanar faces as non-manifold edges.
    collision_seam = 0.00004
    jamb_height = max(0.05, spec.opening_height - collision_seam)
    frame_parts = []
    for side, x in (("Left", -(spec.opening_width + jamb_width) / 2.0),
                    ("Right", (spec.opening_width + jamb_width) / 2.0)):
        frame_parts.append(box(
            f"COLLISION_DoorFrame_{side}",
            (jamb_width, spec.frame_depth, jamb_height),
            (x, 0.0, jamb_height / 2.0), MATERIALS["collision"],
            parent=collision_root, bevel=0.0, collision=True,
            properties={"collision_proxy": True, "collision_part": "frame", "side": side.lower()},
        ))
    header_height = max(0.075, spec.outer_height - spec.opening_height)
    frame_parts.append(box(
        "COLLISION_DoorFrame_Header",
        (spec.outer_width, spec.frame_depth, header_height),
        (0.0, 0.0, spec.opening_height + header_height / 2.0), MATERIALS["collision"],
        parent=collision_root, bevel=0.0, collision=True,
        properties={"collision_proxy": True, "collision_part": "frame", "side": "header"},
    ))
    tier_token = "HighEnd" if spec.key == "high-end" else spec.label.replace("-", "")
    frame_collider = join_meshes(
        f"COLLISION_DoorFrame_{tier_token}", frame_parts, parent=collision_root,
        properties={"collision_proxy": True, "collision_part": "static_frame", "tier": spec.key},
    )
    frame_collider.hide_render = True
    frame_collider.hide_viewport = True
    frame_collider.display_type = "WIRE"

    names = [frame_collider.name]
    for setup in leaf_setup(spec):
        side = str(setup["side"] or "Single")
        hinge_x = float(setup["hinge_x"])
        direction = float(setup["direction"])
        center_x = hinge_x + direction * spec.leaf_width / 2.0
        pivot = leaf_pivots[side]
        leaf_collision_name = (
            f"COLLISION_DoorLeaf_Luxury_{side}"
            if spec.double else f"COLLISION_DoorLeaf_{tier_token}"
        )
        if spec.arched:
            collider = arch_panel(
                leaf_collision_name, spec.leaf_width,
                spec.leaf_height + 0.012, spec.leaf_thickness,
                0.0, MATERIALS["collision"], parent=pivot,
                segments=12, bevel=0.0, collision=True,
                properties={"collision_proxy": True, "collision_part": "moving_leaf", "leaf": side},
            )
        else:
            collider = box(
                leaf_collision_name,
                (spec.leaf_width, spec.leaf_thickness, spec.leaf_height),
                (center_x, 0.0, 0.012 + spec.leaf_height / 2.0), MATERIALS["collision"],
                parent=pivot, bevel=0.0, collision=True,
                properties={"collision_proxy": True, "collision_part": "moving_leaf", "leaf": side},
            )
        collider.hide_render = True
        collider.hide_viewport = True
        collider.display_type = "WIRE"
        names.append(collider.name)
    return names


def add_functional_nodes(spec: DoorSpec, root: bpy.types.Object) -> list[str]:
    nodes: list[bpy.types.Object] = []

    def node(name: str, location: Sequence[float], **props: object) -> bpy.types.Object:
        result = empty(name, location, parent=root, display="ARROWS", size=0.055, properties=props)
        nodes.append(result)
        return result

    node("WALL_OPENING_CENTER", (0.0, 0.0, spec.opening_height / 2.0),
         role="wall_opening_center", opening_width_m=spec.opening_width, opening_height_m=spec.opening_height)
    node("WALL_SNAP_ANCHOR", (0.0, 0.0, 0.0), role="wall_snap", front_axis=FRONT_AXIS)
    wall_normal = node("WALL_NORMAL", (0.0, -0.12, 1.0), role="wall_normal", vector="0,-1,0")
    wall_normal.rotation_euler.x = math.pi / 2.0
    node("DOORWAY_MIN", (-spec.opening_width / 2.0, -spec.frame_depth / 2.0, 0.0), role="doorway_bounds_min")
    node("DOORWAY_MAX", (spec.opening_width / 2.0, spec.frame_depth / 2.0, spec.opening_height), role="doorway_bounds_max")
    node("FLOOR_CONTACT_CENTER", (0.0, 0.0, 0.0), role="floor_contact")
    node("PLACEMENT_ANCHOR", (0.0, 0.0, 0.0), role="placement", wall_mounted=True)
    node("INTERACTION_POINT", (0.0, -0.72, 1.02), role="interaction", action="toggle_door")
    node("INTERACT_Door", (0.0, -0.58, 1.02), role="interaction_alias", action="toggle_door")
    node("NAV_ENTRY_A", (0.0, -0.56, 0.0), role="navigation_entry", side="exterior")
    node("NAV_ENTRY_B", (0.0, 0.56, 0.0), role="navigation_entry", side="interior")
    node("NAV_CENTER", (0.0, 0.0, 0.0), role="navigation_center")
    node("NAV_CLEARANCE_MIN", (-spec.opening_width * 0.46, -0.34, 0.0), role="navigation_clearance_min")
    node("NAV_CLEARANCE_MAX", (spec.opening_width * 0.46, 0.34, spec.opening_height), role="navigation_clearance_max")
    node("LOCK_ANCHOR", (spec.opening_width / 2.0, 0.0, 1.02), role="future_lock_anchor", lock_authority=False)
    node("STRIKE_PLATE", (spec.opening_width / 2.0, -spec.leaf_thickness / 2.0, 1.02), role="strike_plate")
    node("SWING_CLEARANCE", (0.0, spec.leaf_width / 2.0, 0.0), role="swing_clearance",
         radius_m=spec.leaf_width, open_degrees=spec.open_degrees)
    if not spec.double:
        setup = leaf_setup(spec)[0]
        handle_x = float(setup["hinge_x"]) + float(setup["direction"]) * (
            spec.leaf_width - (0.105 if tier_level(spec) < 2 else 0.115)
        )
        node("INTERACT_Handle_Exterior", (handle_x, -0.52, 1.02), role="handle_interaction", face="exterior")
        node("INTERACT_Handle_Interior", (handle_x, 0.52, 1.02), role="handle_interaction", face="interior")
    else:
        for setup in leaf_setup(spec):
            side = str(setup["side"])
            hinge_x = float(setup["hinge_x"])
            direction = float(setup["direction"])
            handle_x = hinge_x + direction * (spec.leaf_width - 0.115)
            node(f"INTERACTION_POINT_{side}", (handle_x, -0.72, 1.045), role="leaf_interaction", leaf=side)
            node(f"INTERACT_Door_{side}", (handle_x, -0.58, 1.045), role="leaf_interaction", leaf=side)
            node(f"INTERACT_Handle_{side}_Exterior", (handle_x, -0.54, 1.045), role="handle_interaction", leaf=side, face="exterior")
            node(f"INTERACT_Handle_{side}_Interior", (handle_x, 0.54, 1.045), role="handle_interaction", leaf=side, face="interior")
            node(f"LOCK_ANCHOR_{side}", (handle_x, 0.0, 0.94), role="future_lock_anchor", leaf=side, lock_authority=False)
            node(f"STRIKE_PLATE_{side}", (hinge_x + direction * spec.leaf_width, 0.0, 1.02), role="strike_plate", leaf=side)
            node(f"SWING_CLEARANCE_{side.upper()}",
                 (hinge_x + direction * spec.leaf_width / 2.0, spec.leaf_width / 2.0, 0.0),
                 role="swing_clearance", leaf=side, radius_m=spec.leaf_width,
                 open_degrees=spec.open_degrees)
    return [item.name for item in nodes]


def add_animation_clips(
    spec: DoorSpec,
    root: bpy.types.Object,
    leaf_pivots: Mapping[str, bpy.types.Object],
    handle_pivots: Mapping[str, bpy.types.Object],
    latch_pivots: Mapping[str, bpy.types.Object],
    flush_pivots: Mapping[str, bpy.types.Object],
) -> list[str]:
    # Blender's glTF importer activates the first clip on a fresh reimport. A
    # lexically first identity clip keeps that inspection pose closed without
    # compromising the independently playable open/close clips.
    asset_lib.animate_transform_clip(
        root, "A_RestPose",
        [
            {"frame": 1, "location": (0.0, 0.0, 0.0), "rotation": (0.0, 0.0, 0.0), "scale": (1.0, 1.0, 1.0)},
            {"frame": 2, "location": (0.0, 0.0, 0.0), "rotation": (0.0, 0.0, 0.0), "scale": (1.0, 1.0, 1.0)},
        ], interpolation="LINEAR",
    )
    clips: list[str] = ["A_RestPose"]
    open_angle = math.radians(spec.open_degrees)
    for setup in leaf_setup(spec):
        side = str(setup["side"] or "Single")
        direction = float(setup["direction"])
        pivot = leaf_pivots[side]
        clip_prefix = "Door" if side == "Single" else f"Door_{side}"
        asset_lib.animate_transform_clip(
            pivot, f"{clip_prefix}_Open",
            [
                {"frame": 1, "rotation": (0.0, 0.0, 0.0)},
                {"frame": 8, "rotation": (0.0, 0.0, direction * open_angle * 0.12)},
                {"frame": 24, "rotation": (0.0, 0.0, direction * open_angle * 0.82)},
                {"frame": 34, "rotation": (0.0, 0.0, direction * open_angle)},
            ], interpolation="BEZIER",
        )
        clips.append(f"{clip_prefix}_Open")
        asset_lib.animate_transform_clip(
            pivot, f"{clip_prefix}_Close",
            [
                {"frame": 1, "rotation": (0.0, 0.0, direction * open_angle)},
                {"frame": 22, "rotation": (0.0, 0.0, direction * open_angle * 0.16)},
                {"frame": 30, "rotation": (0.0, 0.0, 0.0)},
                {"frame": 34, "rotation": (0.0, 0.0, 0.0)},
            ], interpolation="BEZIER",
        )
        clips.append(f"{clip_prefix}_Close")

    for name, pivot in handle_pivots.items():
        face = "Exterior" if name.endswith("Exterior") else "Interior"
        side = ""
        if "_Left_" in name:
            side = "_Left"
        elif "_Right_" in name:
            side = "_Right"
        clip = f"Handle{side}_{face}_Press"
        press = math.radians(-28.0 if face == "Exterior" else 28.0)
        asset_lib.animate_transform_clip(
            pivot, clip,
            [
                {"frame": 1, "rotation": (0.0, 0.0, 0.0)},
                {"frame": 5, "rotation": (0.0, press, 0.0)},
                {"frame": 10, "rotation": (0.0, 0.0, 0.0)},
            ], interpolation="BEZIER",
        )
        clips.append(clip)

    for name, pivot in latch_pivots.items():
        side = name.removeprefix("PIVOT_LatchBolt").lstrip("_")
        side_suffix = f"_{side}" if side else ""
        base = Vector(pivot.get("authored_location", tuple(pivot.location)))
        direction = -1.0
        if side == "Right":
            direction = 1.0
        elif side == "Left" or not side:
            direction = -1.0
        asset_lib.animate_transform_clip(
            pivot, f"Latch{side_suffix}_Retract",
            [
                {"frame": 1, "location": tuple(base)},
                {"frame": 7, "location": (base.x + direction * 0.018, base.y, base.z)},
            ], interpolation="LINEAR",
        )
        clips.append(f"Latch{side_suffix}_Retract")
        asset_lib.animate_transform_clip(
            pivot, f"Latch{side_suffix}_Extend",
            [
                {"frame": 1, "location": (base.x + direction * 0.018, base.y, base.z)},
                {"frame": 7, "location": tuple(base)},
            ], interpolation="LINEAR",
        )
        clips.append(f"Latch{side_suffix}_Extend")

    for name, pivot in flush_pivots.items():
        position = "Top" if name.endswith("Top") else "Bottom"
        travel = 0.018 if position == "Top" else -0.018
        base = Vector(pivot.get("authored_location", tuple(pivot.location)))
        asset_lib.animate_transform_clip(
            pivot, f"FlushBolt_Right_{position}_Retract",
            [
                {"frame": 1, "location": tuple(base)},
                {"frame": 9, "location": (base.x, base.y, base.z - travel)},
            ], interpolation="LINEAR",
        )
        clips.append(f"FlushBolt_Right_{position}_Retract")
        asset_lib.animate_transform_clip(
            pivot, f"FlushBolt_Right_{position}_Extend",
            [
                {"frame": 1, "location": (base.x, base.y, base.z - travel)},
                {"frame": 9, "location": tuple(base)},
            ], interpolation="LINEAR",
        )
        clips.append(f"FlushBolt_Right_{position}_Extend")

    # GLB clips live in NLA tracks; return every control to the authored closed,
    # unpressed, extended source pose after keyframe creation.
    for setup in leaf_setup(spec):
        leaf_pivots[str(setup["side"] or "Single")].rotation_euler = (0.0, 0.0, 0.0)
    for pivot in handle_pivots.values():
        pivot.rotation_euler = (0.0, 0.0, 0.0)
    for pivot in latch_pivots.values():
        pivot.location = Vector(pivot.get("authored_location", tuple(pivot.location)))
    for pivot in flush_pivots.values():
        pivot.location = Vector(pivot.get("authored_location", tuple(pivot.location)))
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    return clips


def add_root_metadata(spec: DoorSpec, root: bpy.types.Object) -> None:
    root["asset_id"] = f"architectural-door-{spec.key}"
    root["display_name"] = f"{spec.label} Architectural Door"
    root["category"] = "architectural_door"
    root["tier"] = spec.key
    root["units"] = "meters"
    root["up_axis"] = UP_AXIS
    root["front_axis"] = FRONT_AXIS
    root["origin_semantics"] = "threshold center at finished floor"
    root["opening_width_m"] = spec.opening_width
    root["opening_height_m"] = spec.opening_height
    root["frame_depth_m"] = spec.frame_depth
    root["supported_wall_depth_min_m"] = max(0.16, spec.frame_depth - 0.08)
    root["supported_wall_depth_max_m"] = spec.frame_depth + 0.10
    root["wall_depth_adjustment"] = "scale or replace jamb liners only; preserve leaf, hardware, and pivots"
    root["leaf_width_m"] = spec.leaf_width
    root["leaf_height_m"] = spec.leaf_height
    root["leaf_thickness_m"] = spec.leaf_thickness
    root["leaf_count"] = spec.leaf_count
    root["hinge_count_per_leaf"] = spec.hinge_count
    root["swing_axis"] = "+Z"
    root["swing_open_degrees"] = spec.open_degrees
    root["swing_closed_degrees"] = 0.0
    root["swing_runtime_authority"] = "procedural interpolation with swept-arc occupancy safety"
    root["default_state"] = "closed"
    root["default_swing_side"] = "+Y inward"
    root["supports_inward_outward_swing"] = True
    root["supports_mirrored_handedness"] = True
    root["mirroring_policy"] = "mirror the full root across local X; swap leaf-side metadata and swing sign"
    root["interaction"] = "toggle via INTERACTION_POINT or INTERACT_Door"
    root["handle_press_degrees"] = 28.0
    root["latch_travel_m"] = 0.018
    root["lock_ready"] = True
    root["lock_runtime_authority"] = False
    root["lock_note"] = "anchors and cylinders are authored for future access-control integration"
    root["sound_category"] = {
        "basic": "light_painted_interior_door",
        "standard": "refined_painted_interior_door",
        "premium": "solid_walnut_door",
        "high-end": "premium_wood_glass_door",
        "luxury": "heavy_double_hardwood_door",
    }[spec.key]
    root["sound_hooks"] = json.dumps({"open": "doorSwing", "close": "doorShut", "entry": "doorbell"}, sort_keys=True)
    root["lod_distances_m"] = json.dumps(LOD_DISTANCES_M, sort_keys=True)
    root["collision_policy"] = "hidden authored proxies plus runtime analytic leaf/frame colliders"
    root["navigation_policy"] = "door frame excluded from nav bake; leaf occupancy checked at runtime"
    root["placement_policy"] = "wall opening snap; validate clearway and supported jamb depth"
    root["placement_requires_ceiling_clearance"] = bool(spec.arched)
    root["auto_close_default"] = {
        "basic": "off", "standard": "optional", "premium": "optional",
        "high-end": "soft_optional", "luxury": "controlled_optional",
    }[spec.key]
    root["reference_image"] = spec.reference
    root["reference_usage"] = "visual design reference only; immutable"
    root["asset_source"] = "original project-owned procedural Blender geometry and textures"
    root["license"] = "Golf Flipper project-owned"
    root["external_assets"] = False
    root["builder"] = relative(Path(__file__))
    root["blender_version"] = bpy.app.version_string
    if spec.double:
        root["active_leaf"] = "Left"
        root["inactive_leaf"] = "Right"
        root["inactive_leaf_locking"] = "top and bottom flush bolts"


def create_asset(spec: DoorSpec) -> tuple[bpy.types.Object, dict[str, object]]:
    global CURRENT_SPEC, MATERIALS
    CURRENT_SPEC = spec
    clean_scene()
    MATERIALS = build_materials(spec)
    root = empty(
        spec.root_name, (0.0, 0.0, 0.0), display="CUBE", size=0.12,
        properties={"asset_root": True, "production_ready": True},
    )
    add_root_metadata(spec, root)
    static_root = group("STATIC_DoorAssembly", root, static=True)
    leaf_pivots: dict[str, bpy.types.Object] = {}
    handle_pivots: dict[str, bpy.types.Object] = {}
    latch_pivots: dict[str, bpy.types.Object] = {}
    flush_pivots: dict[str, bpy.types.Object] = {}

    for setup in leaf_setup(spec):
        side = str(setup["side"] or "Single")
        hinge_x = float(setup["hinge_x"])
        direction = float(setup["direction"])
        leaf_pivot = empty(
            f"PIVOT_Door{'' if side == 'Single' else '_' + side}",
            (hinge_x, 0.0, 0.0), parent=root, display="ARROWS", size=0.12,
            properties={
                "moving_component": "door_leaf", "leaf": side,
                "hinge_axis": "+Z", "hinge_x_m": hinge_x,
                "swing_direction": direction, "closed_degrees": 0.0,
                "open_degrees": direction * spec.open_degrees,
            },
        )
        leaf_pivots[side] = leaf_pivot

    for lod in range(3):
        static_lod = lod_parent("Static", lod, static_root)
        if spec.arched:
            build_arch_frame(spec, lod, static_lod)
        else:
            build_rect_frame(spec, lod, static_lod)
        if not spec.double:
            add_strike_hardware(spec, lod, static_lod)

        for leaf_index, setup in enumerate(leaf_setup(spec)):
            side = str(setup["side"] or "Single")
            hinge_x = float(setup["hinge_x"])
            direction = float(setup["direction"])
            leaf_pivot = leaf_pivots[side]
            leaf_lod = lod_parent(f"DoorLeaf_{side}", lod, leaf_pivot)
            if spec.arched:
                build_arch_leaf_geometry(
                    spec, lod, leaf_lod, leaf_name=side,
                    hinge_x=hinge_x, direction=direction,
                    grain_offset=0.17 + leaf_index * 0.41,
                )
            else:
                build_rect_leaf_geometry(
                    spec, lod, leaf_lod, leaf_name=side,
                    hinge_x=hinge_x, direction=direction,
                    grain_offset=0.17 + leaf_index * 0.41,
                )
            build_hinges(
                spec, lod, static_lod, leaf_lod,
                leaf_name=side, hinge_x=hinge_x, direction=direction,
            )
            build_handle_hardware(
                spec, lod, leaf_pivot, leaf_lod,
                hinge_x=hinge_x, direction=direction,
                leaf_side=None if side == "Single" else side,
                handle_pivots=handle_pivots,
            )
            if not (spec.double and side == "Right"):
                build_latch(
                    spec, lod, leaf_pivot,
                    hinge_x=hinge_x, direction=direction,
                    leaf_side=None if side == "Single" else side,
                    latch_pivots=latch_pivots,
                )
            if spec.double and side == "Right":
                add_luxury_astragal(spec, lod, leaf_lod)
                add_luxury_center_strike(spec, lod, leaf_lod)
                add_flush_bolts(spec, lod, leaf_pivot, leaf_lod, flush_pivots)

    for pivot in list(latch_pivots.values()) + list(flush_pivots.values()):
        pivot["authored_location"] = [float(value) for value in pivot.location]
    collision_names = add_collision(spec, root, leaf_pivots)
    node_names = add_functional_nodes(spec, root)
    if spec.double:
        center_strike = bpy.data.objects.get("STRIKE_PLATE_Left")
        if center_strike is not None:
            set_parent_keep_world(center_strike, leaf_pivots["Right"])
    clip_names = add_animation_clips(spec, root, leaf_pivots, handle_pivots, latch_pivots, flush_pivots)
    root["animation_clips"] = json.dumps(clip_names)
    root["functional_nodes"] = json.dumps(node_names)
    root["collision_nodes"] = json.dumps(collision_names)
    bpy.context.view_layer.update()
    return root, {
        "leafPivots": leaf_pivots,
        "handlePivots": handle_pivots,
        "latchPivots": latch_pivots,
        "flushPivots": flush_pivots,
        "functionalNodes": node_names,
        "collisionNodes": collision_names,
        "animations": clip_names,
    }


def inherited_lod(obj: bpy.types.Object) -> int | None:
    cursor: bpy.types.Object | None = obj
    while cursor is not None:
        if "lod_level" in cursor:
            return int(cursor["lod_level"])
        cursor = cursor.parent
    return None


def triangle_count_for_lod(root: bpy.types.Object, lod: int) -> int:
    total = 0
    for obj in descendants(root):
        if obj.type != "MESH" or obj.get("collision_proxy") or inherited_lod(obj) != lod:
            continue
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def lod_bounds(root: bpy.types.Object, lod: int = 0) -> dict[str, list[float]]:
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    found = False
    bpy.context.view_layer.update()
    for obj in descendants(root):
        if obj.type != "MESH" or obj.get("collision_proxy") or inherited_lod(obj) != lod:
            continue
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            minimum.x = min(minimum.x, point.x)
            minimum.y = min(minimum.y, point.y)
            minimum.z = min(minimum.z, point.z)
            maximum.x = max(maximum.x, point.x)
            maximum.y = max(maximum.y, point.y)
            maximum.z = max(maximum.z, point.z)
            found = True
    if not found:
        raise RuntimeError(f"{root.name}: no LOD{lod} visible mesh bounds")
    size = maximum - minimum
    return {
        "min": [round(value, 6) for value in minimum],
        "max": [round(value, 6) for value in maximum],
        "dimensions": [round(value, 6) for value in size],
    }


def mesh_non_manifold_edge_count(obj: bpy.types.Object) -> int:
    mesh = obj.data
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        return sum(1 for edge in bm.edges if not edge.is_manifold)
    finally:
        bm.free()


def validate_source(spec: DoorSpec, root: bpy.types.Object, rig: Mapping[str, object]) -> dict[str, object]:
    issues: list[dict[str, str]] = []

    def issue(code: str, message: str, *, severity: str = "error") -> None:
        issues.append({"severity": severity, "code": code, "message": message})

    if root.parent is not None:
        issue("root.parent", "asset root must not be parented")
    if root.location.length > 1e-6 or any(abs(value) > 1e-6 for value in root.rotation_euler):
        issue("root.identity", f"root transform is not identity: location={tuple(root.location)} rotation={tuple(root.rotation_euler)}")
    if any(abs(float(value) - 1.0) > 1e-6 for value in root.scale):
        issue("root.scale", f"root scale is not 1: {tuple(root.scale)}")
    if any(obj.type in {"CAMERA", "LIGHT"} for obj in descendants(root)):
        issue("hierarchy.studio", "asset hierarchy contains a camera or light")

    objects = descendants(root)
    names = [obj.name for obj in objects]
    if len(names) != len(set(names)):
        issue("names.duplicate", "object names are not unique")
    generated_suffixes = [name for name in names if len(name) > 4 and name[-4] == "." and name[-3:].isdigit()]
    if generated_suffixes:
        issue("names.generated_suffix", f"Blender-generated suffixes found: {generated_suffixes[:8]}")

    required_nodes = {
        "WALL_OPENING_CENTER", "WALL_SNAP_ANCHOR", "WALL_NORMAL", "DOORWAY_MIN", "DOORWAY_MAX",
        "FLOOR_CONTACT_CENTER", "PLACEMENT_ANCHOR", "INTERACTION_POINT", "INTERACT_Door",
        "NAV_ENTRY_A", "NAV_ENTRY_B", "NAV_CENTER", "NAV_CLEARANCE_MIN", "NAV_CLEARANCE_MAX",
        "LOCK_ANCHOR", "STRIKE_PLATE", "SWING_CLEARANCE",
    }
    missing_nodes = sorted(required_nodes.difference(names))
    if missing_nodes:
        issue("nodes.missing", f"missing functional nodes: {missing_nodes}")

    expected_pivots = {"PIVOT_Door"} if not spec.double else {"PIVOT_Door_Left", "PIVOT_Door_Right"}
    missing_pivots = sorted(expected_pivots.difference(names))
    if missing_pivots:
        issue("pivots.missing", f"missing leaf pivots: {missing_pivots}")
    for setup in leaf_setup(spec):
        side = str(setup["side"] or "Single")
        pivot = rig["leafPivots"][side]
        world = pivot.matrix_world.translation
        if abs(world.x - float(setup["hinge_x"])) > 1e-5 or abs(world.y) > 1e-5 or abs(world.z) > 1e-5:
            issue("pivots.hinge_location", f"{pivot.name} is not at the authored hinge line: {tuple(world)}")
        if abs(pivot.rotation_euler.z) > 1e-6:
            issue("pivots.closed_pose", f"{pivot.name} is not closed in source pose")

    visible_meshes = [obj for obj in objects if obj.type == "MESH" and not obj.get("collision_proxy")]
    collision_meshes = [obj for obj in objects if obj.type == "MESH" and obj.get("collision_proxy")]
    if not visible_meshes:
        issue("mesh.visible", "no visible meshes found")
    if not collision_meshes:
        issue("collision.missing", "no collision meshes found")
    for obj in visible_meshes + collision_meshes:
        if any(abs(float(value) - 1.0) > 1e-5 for value in obj.scale):
            issue("mesh.scale", f"{obj.name} has unapplied scale {tuple(obj.scale)}")
        if not obj.data.uv_layers:
            issue("mesh.uv", f"{obj.name} has no UV map")
        if not obj.data.materials:
            issue("mesh.material", f"{obj.name} has no material")
    for obj in collision_meshes:
        bad_edges = mesh_non_manifold_edge_count(obj)
        if bad_edges:
            issue("collision.non_manifold", f"{obj.name} has {bad_edges} non-manifold edges")

    lod_triangles = {f"LOD{lod}": triangle_count_for_lod(root, lod) for lod in range(3)}
    if not (lod_triangles["LOD0"] > lod_triangles["LOD1"] > lod_triangles["LOD2"] > 0):
        issue("lod.triangles", f"LOD triangle counts are not strictly descending: {lod_triangles}")
    for lod in range(3):
        if not any(inherited_lod(obj) == lod for obj in visible_meshes):
            issue("lod.missing", f"LOD{lod} has no visible meshes")

    actions = sorted({action.name for action in bpy.data.actions if action.get("clip_name")})
    expected_actions = set(rig["animations"])
    missing_actions = sorted(expected_actions.difference(actions))
    if missing_actions:
        issue("animations.missing", f"missing actions: {missing_actions}")
    if len(actions) != len(expected_actions):
        issue("animations.count", f"expected {len(expected_actions)} clips, found {len(actions)}", severity="warning")

    bounds = lod_bounds(root, 0)
    if bounds["min"][2] < -0.002:
        issue("bounds.floor", f"LOD0 extends below finished floor: {bounds['min'][2]}m")
    if bounds["dimensions"][0] < spec.opening_width or bounds["dimensions"][2] < spec.opening_height:
        issue("bounds.frame", f"frame does not enclose required opening: {bounds['dimensions']}")
    if abs(bounds["dimensions"][0] - spec.outer_width) / spec.outer_width > 0.18:
        issue("bounds.width", f"measured outer width {bounds['dimensions'][0]}m differs materially from target {spec.outer_width}m")
    if abs(bounds["dimensions"][2] - spec.outer_height) / spec.outer_height > 0.12:
        issue("bounds.height", f"measured outer height {bounds['dimensions'][2]}m differs materially from target {spec.outer_height}m")

    result = {
        "asset": spec.key,
        "ok": not any(item["severity"] == "error" for item in issues),
        "issues": issues,
        "objectCount": len(objects),
        "meshCount": len(visible_meshes),
        "collisionMeshCount": len(collision_meshes),
        "materialCount": len({slot.name for obj in visible_meshes for slot in obj.data.materials if slot}),
        "boundsLOD0": bounds,
        "lodTriangles": lod_triangles,
        "actions": actions,
        "functionalNodes": list(rig["functionalNodes"]),
        "collisionNodes": list(rig["collisionNodes"]),
        "blenderVersion": bpy.app.version_string,
    }
    if not result["ok"]:
        raise RuntimeError(f"{spec.label} source validation failed: {json.dumps(issues, indent=2)}")
    return result


def set_preview_lod(root: bpy.types.Object, lod: int = 0) -> None:
    for obj in descendants(root):
        if obj.type != "MESH":
            continue
        level = inherited_lod(obj)
        obj.hide_render = bool(obj.get("collision_proxy")) or (level is not None and level != lod)


def point_camera(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def render_detail_preview(
    root: bpy.types.Object,
    path: Path,
    *,
    target: Sequence[float],
    camera_position: Sequence[float],
    resolution: tuple[int, int] = (900, 900),
) -> Path:
    """Render an isolated close detail without persisting studio objects."""

    path.parent.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    old_camera = scene.camera
    old_world = scene.world
    old_filepath = scene.render.filepath
    old_resolution = (scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage)
    old_engine = scene.render.engine
    studio = bpy.data.collections.new("__DOOR_DETAIL_STUDIO__")
    scene.collection.children.link(studio)
    world = bpy.data.worlds.new("DOOR_DETAIL_WORLD")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.42, 0.45, 0.43, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.26
    scene.world = world
    target_vec = Vector(target)

    def add_light(name: str, energy: float, size: float, location: Sequence[float]) -> None:
        data = bpy.data.lights.new(name + "_DATA", "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        studio.objects.link(obj)
        obj.location = location
        point_camera(obj, target_vec)

    add_light("DOOR_DETAIL_KEY", 150.0, 1.4, (target_vec.x - 0.65, target_vec.y - 0.95, target_vec.z + 0.90))
    add_light("DOOR_DETAIL_FILL", 70.0, 1.8, (target_vec.x + 0.85, target_vec.y - 0.30, target_vec.z + 0.35))
    add_light("DOOR_DETAIL_RIM", 105.0, 1.2, (target_vec.x, target_vec.y + 0.85, target_vec.z + 0.70))
    camera_data = bpy.data.cameras.new("DOOR_DETAIL_CAMERA_DATA")
    camera_data.lens = 62.0
    camera_data.clip_start = 0.01
    camera_data.clip_end = 100.0
    camera = bpy.data.objects.new("DOOR_DETAIL_CAMERA", camera_data)
    studio.objects.link(camera)
    camera.location = camera_position
    point_camera(camera, target_vec)
    scene.camera = camera
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path)
    scene.render.film_transparent = False
    try:
        bpy.ops.render.render(write_still=True)
        if not path.is_file():
            raise RuntimeError(f"detail preview was not created: {path}")
        print(f"PREVIEW|{path}|bytes={path.stat().st_size}")
        return path
    finally:
        scene.camera = old_camera
        scene.world = old_world
        scene.render.filepath = old_filepath
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = old_resolution
        try:
            scene.render.engine = old_engine
        except Exception:
            pass
        for obj in list(studio.objects):
            data = obj.data
            kind = obj.type
            bpy.data.objects.remove(obj, do_unlink=True)
            if data is not None and getattr(data, "users", 1) == 0:
                if kind == "LIGHT":
                    bpy.data.lights.remove(data)
                elif kind == "CAMERA":
                    bpy.data.cameras.remove(data)
        scene.collection.children.unlink(studio)
        bpy.data.collections.remove(studio)
        if world.users == 0:
            bpy.data.worlds.remove(world)


def set_leaf_pose(spec: DoorSpec, rig: Mapping[str, object], pose: Mapping[str, float]) -> None:
    for setup in leaf_setup(spec):
        side = str(setup["side"] or "Single")
        degrees = float(pose.get(side, 0.0))
        direction = float(setup["direction"])
        rig["leafPivots"][side].rotation_euler.z = direction * math.radians(degrees)
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()


def render_asset_previews(spec: DoorSpec, root: bpy.types.Object, rig: Mapping[str, object]) -> list[Path]:
    set_preview_lod(root, 0)
    stem = spec.key.replace("-", "_")
    paths: list[Path] = []

    def broad(suffix: str, pose: Mapping[str, float], azimuth: float, elevation: float = 16.0) -> None:
        set_leaf_pose(spec, rig, pose)
        path = PREVIEW_ROOT / f"door_{stem}_{suffix}.png"
        asset_lib.render_studio_preview(
            root, path, width=900, height=1100,
            azimuth_degrees=azimuth, elevation_degrees=elevation,
        )
        paths.append(path)

    closed_pose = {str(setup["side"] or "Single"): 0.0 for setup in leaf_setup(spec)}
    broad("closed_front", closed_pose, 0.0, 10.0)
    broad("open_45", {key: 45.0 for key in closed_pose}, -24.0, 15.0)
    broad("open_full", {key: spec.open_degrees for key in closed_pose}, -34.0, 18.0)
    broad("closed_rear", closed_pose, 180.0, 12.0)

    first_setup = leaf_setup(spec)[0]
    first_hinge = float(first_setup["hinge_x"])
    first_direction = float(first_setup["direction"])
    handle_x = first_hinge + first_direction * (spec.leaf_width - (0.105 if tier_level(spec) < 2 else 0.115))
    handle_z = 1.045 if spec.double else 1.02
    hardware_path = PREVIEW_ROOT / f"door_{stem}_hardware_closeup.png"
    render_detail_preview(
        root, hardware_path,
        target=(handle_x, -spec.leaf_thickness / 2.0, handle_z),
        camera_position=(handle_x + 0.31, -0.68, handle_z + 0.17),
    )
    paths.append(hardware_path)

    if spec.arched:
        set_leaf_pose(spec, rig, closed_pose)
        glass_path = PREVIEW_ROOT / f"door_{stem}_privacy_glass_closeup.png"
        render_detail_preview(
            root, glass_path,
            target=(0.0, -0.01, 1.68),
            camera_position=(0.42, -1.08, 1.83),
        )
        paths.append(glass_path)
        rear_glass = PREVIEW_ROOT / f"door_{stem}_privacy_glass_interior.png"
        render_detail_preview(
            root, rear_glass,
            target=(0.0, 0.01, 1.68),
            camera_position=(-0.40, 1.12, 1.78),
        )
        paths.append(rear_glass)
        broad("open_interior", {"Single": spec.open_degrees * 0.72}, 158.0, 18.0)

    if spec.double:
        broad("left_open", {"Left": spec.open_degrees, "Right": 0.0}, -25.0, 16.0)
        broad("right_open", {"Left": 0.0, "Right": spec.open_degrees}, 25.0, 16.0)
        broad("both_open", {"Left": spec.open_degrees, "Right": spec.open_degrees}, 0.0, 14.0)
        set_leaf_pose(spec, rig, closed_pose)
        seam_path = PREVIEW_ROOT / f"door_{stem}_center_seam_closeup.png"
        render_detail_preview(
            root, seam_path,
            target=(0.0, -spec.leaf_thickness / 2.0, 1.15),
            camera_position=(0.34, -0.82, 1.30),
        )
        paths.append(seam_path)

    set_leaf_pose(spec, rig, closed_pose)
    return paths


def hide_source_distance_lods(root: bpy.types.Object) -> None:
    for obj in descendants(root):
        level = inherited_lod(obj)
        if level is None:
            continue
        obj.hide_viewport = level != 0
        if obj.type == "MESH":
            obj.hide_render = level != 0
    for obj in descendants(root):
        if obj.get("collision_proxy"):
            obj.hide_viewport = True
            obj.hide_render = True


def publish_asset(spec: DoorSpec) -> dict[str, object]:
    root, rig = create_asset(spec)
    validation = validate_source(spec, root, rig)
    stem = spec.key.replace("-", "_")
    source_path = SOURCE_ROOT / f"door_{stem}.blend"
    glb_path = EXPORT_ROOT / f"door_{stem}.glb"
    validation_path = QA_ROOT / f"door_{stem}_source_validation.json"
    validation_path.write_text(json.dumps(validation, indent=2) + "\n", encoding="utf-8")

    hide_source_distance_lods(root)
    asset_lib.save_blend(source_path)
    # Render from the proven rest hierarchy before GLB action sampling. Blender's
    # exporter is allowed to leave evaluated child matrices behind in-memory, so
    # it is deliberately the final operation on this disposable build scene.
    previews = render_asset_previews(spec, root, rig)
    hide_source_distance_lods(root)
    asset_lib.save_blend(source_path)
    asset_lib.export_glb(glb_path, root, include_animations=True)
    return {
        "id": f"architectural-door-{spec.key}",
        "tier": spec.key,
        "label": spec.label,
        "reference": spec.reference,
        "source": relative(source_path),
        "runtimeGlb": relative(glb_path),
        "sourceValidation": relative(validation_path),
        "previews": [relative(path) for path in previews],
        "fileBytes": glb_path.stat().st_size,
        "sha256": asset_lib.sha256_file(glb_path),
        "dimensionsMeters": {
            "leafWidth": spec.leaf_width,
            "leafHeight": spec.leaf_height,
            "leafThickness": spec.leaf_thickness,
            "openingWidth": spec.opening_width,
            "openingHeight": spec.opening_height,
            "frameDepth": spec.frame_depth,
            "outerTargetWidth": spec.outer_width,
            "outerTargetHeight": spec.outer_height,
        },
        "leafCount": spec.leaf_count,
        "hingesPerLeaf": spec.hinge_count,
        "openDegrees": spec.open_degrees,
        "lodDistancesMeters": {f"LOD{lod}": distance for lod, distance in LOD_DISTANCES_M.items()},
        "lodTriangles": validation["lodTriangles"],
        "boundsLOD0": validation["boundsLOD0"],
        "objectCount": validation["objectCount"],
        "meshCount": validation["meshCount"],
        "materialCount": validation["materialCount"],
        "animations": validation["actions"],
        "functionalNodes": validation["functionalNodes"],
        "collisionNodes": validation["collisionNodes"],
        "materials": sorted({material.name for material in MATERIALS.values()}),
        "externalAssets": [],
        "license": "Golf Flipper project-owned",
        "sourceValidationOk": validation["ok"],
    }


def build_comparison_scene(records: Sequence[Mapping[str, object]]) -> dict[str, str]:
    clean_scene()
    comparison_root = empty(
        "Door_Tier_Comparison", properties={
            "qa_only": True, "units": "meters", "front_axis": FRONT_AXIS,
            "purpose": "side-by-side scale, silhouette, material, and tier progression review",
        },
    )
    widths = [float(record["boundsLOD0"]["dimensions"][0]) for record in records]
    gap = 0.42
    total_width = sum(widths) + gap * (len(widths) - 1)
    cursor_x = -total_width / 2.0
    for record, width in zip(records, widths):
        spec = SPEC_BY_KEY[str(record["tier"])]
        glb_path = REPO / str(record["runtimeGlb"])
        before = {obj.as_pointer() for obj in bpy.context.scene.objects}
        bpy.ops.import_scene.gltf(filepath=str(glb_path))
        imported = [obj for obj in bpy.context.scene.objects if obj.as_pointer() not in before]
        candidate = next((obj for obj in imported if obj.get("asset_id") == f"architectural-door-{spec.key}"), None)
        if candidate is None:
            candidate = next((obj for obj in imported if obj.name.startswith(spec.root_name)), None)
        if candidate is None:
            roots = [obj for obj in imported if obj.parent is None]
            if len(roots) != 1:
                raise RuntimeError(f"could not resolve comparison root for {spec.label}: {[obj.name for obj in roots]}")
            candidate = roots[0]
        if candidate.animation_data is not None:
            candidate.animation_data.action = None
        x = cursor_x + width / 2.0
        candidate.location.x += x
        candidate["comparison_tier"] = spec.key
        set_parent_keep_world(candidate, comparison_root)
        cursor_x += width + gap
        for obj in descendants(candidate):
            if obj.type != "MESH":
                continue
            level = inherited_lod(obj)
            obj.hide_render = bool(obj.get("collision_proxy")) or (level is not None and level != 0)
            obj.hide_viewport = bool(obj.get("collision_proxy")) or (level is not None and level != 0)
    bpy.context.view_layer.update()
    asset_lib.save_blend(COMPARISON_SOURCE)
    asset_lib.render_studio_preview(
        comparison_root, COMPARISON_PREVIEW,
        width=2000, height=1050, azimuth_degrees=0.0, elevation_degrees=7.0,
    )
    asset_lib.save_blend(COMPARISON_SOURCE)
    return {"source": relative(COMPARISON_SOURCE), "preview": relative(COMPARISON_PREVIEW)}


def write_manifest(records: Sequence[Mapping[str, object]], comparison: Mapping[str, str]) -> None:
    references = []
    for spec in SPECS:
        path = REPO / spec.reference
        if not path.is_file():
            raise FileNotFoundError(f"required immutable reference is missing: {path}")
        references.append({
            "tier": spec.key,
            "path": spec.reference,
            "sha256": asset_lib.sha256_file(path),
            "modified": False,
        })
    manifest = {
        "schemaVersion": 1,
        "family": "Golf Flipper Architectural Door Tiers",
        "builder": relative(Path(__file__)),
        "blenderVersion": bpy.app.version_string,
        "units": "meters",
        "upAxis": UP_AXIS,
        "frontAxis": FRONT_AXIS,
        "origin": "threshold center at finished floor",
        "license": "Golf Flipper project-owned original work",
        "externalAssets": [],
        "referenceImages": references,
        "runtimePolicy": {
            "interaction": "procedural leaf/handle/latch interpolation using authored pivots",
            "collision": "analytic swept leaf plus authored hidden proxies",
            "navigation": "opening excluded from static nav bake; runtime occupancy gate",
            "locking": "future-ready nodes only; no invented access-control authority",
            "audioHooks": {"open": "doorSwing", "close": "doorShut", "entry": "doorbell"},
            "save": "persist tier and per-leaf closed/open state; intermediate swing is transient",
        },
        "comparison": dict(comparison),
        "assets": list(records),
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    report_path = QA_ROOT / "architectural-door-build-report.md"
    lines = [
        "# Architectural Door Blender Build Report",
        "",
        "All five sources were built from original procedural geometry and project-owned procedural textures. The immutable design references were read only; no external assets were downloaded.",
        "",
        "| Tier | LOD0 tris | LOD1 tris | LOD2 tris | GLB bytes | Source validation |",
        "| --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for record in records:
        tris = record["lodTriangles"]
        lines.append(
            f"| {record['label']} | {tris['LOD0']:,} | {tris['LOD1']:,} | {tris['LOD2']:,} | "
            f"{record['fileBytes']:,} | {'PASS' if record['sourceValidationOk'] else 'FAIL'} |"
        )
    lines.extend((
        "",
        "## Outputs",
        "",
        f"- Manifest: `{relative(MANIFEST_PATH)}`",
        f"- Comparison source: `{comparison['source']}`",
        f"- Comparison preview: `{comparison['preview']}`",
        "- Per-tier editable sources: `Assets/architecture/doors/source/`",
        "- Runtime GLBs: `vendor/models/architecture/doors/`",
        "- Studio previews: `Assets/architecture/doors/previews/`",
        "- Source validation JSON: `qa/doors/blender/`",
        "",
        "Fresh-process GLB reimport, gameplay integration, browser QA, and stress-performance evidence are intentionally tracked in their own reports after this deterministic build stage.",
        "",
    ))
    report_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    if bpy.app.version < BLENDER_VERSION_REQUIRED:
        raise RuntimeError(
            f"Blender {'.'.join(map(str, BLENDER_VERSION_REQUIRED))}+ is required; found {bpy.app.version_string}"
        )
    ensure_directories()
    requested = os.environ.get("GF_DOOR_SPEC", "").strip().lower()
    if requested and requested not in SPEC_BY_KEY:
        raise RuntimeError(f"unknown GF_DOOR_SPEC={requested!r}; expected one of {sorted(SPEC_BY_KEY)}")
    selected_specs = [SPEC_BY_KEY[requested]] if requested else list(SPECS)
    records: list[dict[str, object]] = []
    for spec in selected_specs:
        print(f"BUILD_START|{spec.key}|{spec.label}")
        record = publish_asset(spec)
        records.append(record)
        print(
            f"BUILD_OK|{spec.key}|lod0={record['lodTriangles']['LOD0']}|"
            f"lod1={record['lodTriangles']['LOD1']}|lod2={record['lodTriangles']['LOD2']}"
        )
    if len(records) == len(SPECS):
        comparison = build_comparison_scene(records)
        write_manifest(records, comparison)
        print(f"MANIFEST|{MANIFEST_PATH}")
    else:
        print(f"PARTIAL_BUILD_OK|count={len(records)}|manifest_skipped=true")
    print("ARCHITECTURAL_DOORS_BUILD_OK")


if __name__ == "__main__":
    main()
