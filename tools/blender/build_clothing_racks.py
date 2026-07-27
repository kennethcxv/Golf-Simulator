"""Build the five reference-matched Pinehollow clothing racks.

Run with Blender 5.1+ in background mode:
  blender --background --python tools/blender/build_clothing_racks.py

The script is deterministic and owns only the clothing-rack source, export,
texture, preview, and QA-artifact folders. It never touches the reference PNGs.
"""

from __future__ import annotations

import json
import math
import os
import sys
from array import array
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

import bpy
from mathutils import Vector


REPO = Path(os.environ.get("GF_REPO_ROOT", Path(__file__).resolve().parents[2])).resolve()
ASSET_ROOT = REPO / "Assets" / "pro_shop_furniture"
SOURCE_ROOT = ASSET_ROOT / "source" / "clothing-racks"
TEXTURE_ROOT = ASSET_ROOT / "textures" / "clothing-racks"
PREVIEW_ROOT = ASSET_ROOT / "previews" / "clothing-racks"
EXPORT_ROOT = REPO / "vendor" / "models" / "pro_shop_furniture" / "clothing-racks"
QA_ROOT = REPO / "qa" / "clothing_racks" / "blender"
MANIFEST_PATH = ASSET_ROOT / "clothing-racks-manifest.json"


@dataclass(frozen=True)
class RackSpec:
    key: str
    label: str
    primary_name: str
    width: float
    height: float
    depth: float
    reference: str
    collision_name: str


SPECS = (
    RackSpec("basic", "Basic", "ClothingRack_Basic", 1.55, 1.76, 0.56,
             "Designs/Clothing_Racks/Basic.png", "COLLISION_BasicClothingRack"),
    RackSpec("standard", "Standard", "ClothingRack_Standard", 1.62, 1.80, 0.62,
             "Designs/Clothing_Racks/Standard.png", "COLLISION_StandardClothingRack"),
    RackSpec("premium", "Premium", "ClothingRack_Premium", 1.86, 2.08, 0.58,
             "Designs/Clothing_Racks/Premium.png", "COLLISION_PremiumClothingRack"),
    RackSpec("high-end", "High-End", "ClothingRack_HighEnd", 2.88, 2.28, 0.62,
             "Designs/Clothing_Racks/High-End.png", "COLLISION_HighEndClothingRack"),
    RackSpec("luxury", "Luxury", "ClothingRack_Luxury", 3.18, 2.38, 0.68,
             "Designs/Clothing_Racks/Luxury.png", "COLLISION_LuxuryClothingRack"),
)

LOD_PREFIX = {0: "LOD0", 1: "LOD1", 2: "LOD2"}
LOD_SEGMENTS = {0: 24, 1: 16, 2: 10}
LOD_BEVEL_SEGMENTS = {0: 3, 1: 2, 2: 1}
CURRENT_SPEC: RackSpec | None = None
MATERIALS: dict[str, bpy.types.Material] = {}


def ensure_directories() -> None:
    for folder in (SOURCE_ROOT, TEXTURE_ROOT, PREVIEW_ROOT, EXPORT_ROOT, QA_ROOT):
        folder.mkdir(parents=True, exist_ok=True)


def clean_scene() -> None:
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.images,
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def activate(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def set_parent(obj: bpy.types.Object, parent: bpy.types.Object | None) -> bpy.types.Object:
    if parent is not None:
        obj.parent = parent
    return obj


def stable_seed(text: str) -> int:
    return sum((index + 17) * ord(char) for index, char in enumerate(text))


def _grain_value(u: float, v: float, seed: float) -> float:
    warped = v + 0.008 * math.sin((u * 2.8 + seed) * math.tau)
    warped += 0.003 * math.sin((u * 8.3 - v * 1.7 + seed * 0.37) * math.tau)
    broad = 0.5 + 0.5 * math.sin((warped * 21.0 + seed * 0.11) * math.tau)
    fine = 0.5 + 0.5 * math.sin((warped * 59.0 + u * 1.4 + seed * 0.29) * math.tau)
    pore = 0.5 + 0.5 * math.sin((u * 137.0 + warped * 11.0 + seed) * math.tau)
    return max(0.0, min(1.0, broad * 0.52 + fine * 0.34 + pore * 0.14))


def generate_wood_maps(stem: str, base_rgb: tuple[float, float, float], seed: float,
                       size: int = 1024) -> dict[str, Path]:
    paths = {
        "albedo": TEXTURE_ROOT / f"{stem}_albedo.png",
        "roughness": TEXTURE_ROOT / f"{stem}_roughness.png",
        "normal": TEXTURE_ROOT / f"{stem}_normal.png",
    }
    pixels_albedo = array("f")
    pixels_rough = array("f")
    pixels_normal = array("f")
    for y in range(size):
        v = y / max(1, size - 1)
        for x in range(size):
            u = x / max(1, size - 1)
            grain = _grain_value(u, v, seed)
            vignette = 0.985 + 0.015 * math.sin((u * 1.3 + v * 0.7 + seed) * math.tau)
            contrast = 0.24 if "walnut" in stem else 0.16
            value = (0.86 if "walnut" in stem else 0.88) + grain * contrast
            r = max(0.0, min(1.0, base_rgb[0] * value * vignette))
            g = max(0.0, min(1.0, base_rgb[1] * value * vignette))
            b = max(0.0, min(1.0, base_rgb[2] * value * vignette))
            pixels_albedo.extend((r, g, b, 1.0))
            rough = max(0.24, min(0.72, 0.42 + (1.0 - grain) * 0.10))
            pixels_rough.extend((rough, rough, rough, 1.0))
            before = _grain_value(u, max(0.0, v - 1.0 / size), seed)
            after = _grain_value(u, min(1.0, v + 1.0 / size), seed)
            slope = max(-0.10, min(0.10, (after - before) * 0.30))
            pixels_normal.extend((0.5, 0.5 - slope, 1.0, 1.0))
    for kind, pixels in (
        ("albedo", pixels_albedo),
        ("roughness", pixels_rough),
        ("normal", pixels_normal),
    ):
        image = bpy.data.images.new(f"GEN_{stem}_{kind}", width=size, height=size, alpha=True)
        image.pixels.foreach_set(pixels)
        image.filepath_raw = str(paths[kind])
        image.file_format = "PNG"
        image.save()
        bpy.data.images.remove(image)
    return paths


def generate_metal_roughness(size: int = 512) -> Path:
    path = TEXTURE_ROOT / "charcoal_metal_roughness.png"
    pixels = array("f")
    for y in range(size):
        v = y / max(1, size - 1)
        for x in range(size):
            u = x / max(1, size - 1)
            variation = (
                math.sin((u * 31.0 + v * 13.0) * math.tau) * 0.025
                + math.sin((u * 97.0 - v * 43.0) * math.tau) * 0.012
            )
            value = max(0.24, min(0.58, 0.38 + variation))
            pixels.extend((value, value, value, 1.0))
    image = bpy.data.images.new("GEN_charcoal_metal_roughness", width=size, height=size, alpha=True)
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)
    return path


def generate_textures() -> dict[str, dict[str, Path] | Path]:
    return {
        # Tuned in the production clubhouse renderer, whose warm indirect
        # light otherwise crushed the first-pass woods toward black.
        "oak": generate_wood_maps("pinehollow_oak", (0.420, 0.235, 0.075), 0.17),
        "walnut": generate_wood_maps("pinehollow_walnut", (0.340, 0.145, 0.045), 0.43),
        "dark_walnut": generate_wood_maps("pinehollow_dark_walnut", (0.235, 0.075, 0.020), 0.71),
        "metal_roughness": generate_metal_roughness(),
    }


def principled_input(bsdf: bpy.types.Node, *names: str):
    for name in names:
        if name in bsdf.inputs:
            return bsdf.inputs[name]
    raise KeyError(f"Principled BSDF input not found: {names}")


def load_image(path: Path, *, non_color: bool = False) -> bpy.types.Image:
    image = bpy.data.images.load(str(path), check_existing=True)
    image.name = path.stem
    image.filepath = str(path)
    if non_color:
        image.colorspace_settings.name = "Non-Color"
    image["project_owned"] = True
    image["source_repo_path"] = path.relative_to(REPO).as_posix()
    return image


def make_material(name: str, color: tuple[float, float, float, float], *,
                  roughness: float = 0.5, metallic: float = 0.0,
                  albedo: Path | None = None, roughness_map: Path | None = None,
                  normal_map: Path | None = None, normal_strength: float = 0.25,
                  emission: tuple[float, float, float, float] | None = None,
                  emission_strength: float = 0.0) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = color
    material.metallic = metallic
    material.roughness = roughness
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (560, 40)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (260, 40)
    principled_input(bsdf, "Base Color").default_value = color
    principled_input(bsdf, "Metallic").default_value = metallic
    principled_input(bsdf, "Roughness").default_value = roughness
    if emission is not None:
        principled_input(bsdf, "Emission Color", "Emission").default_value = emission
        principled_input(bsdf, "Emission Strength").default_value = emission_strength
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    x = -520
    if albedo:
        node = nodes.new("ShaderNodeTexImage")
        node.name = "PBR_Albedo"
        node.label = "Project-owned albedo"
        node.image = load_image(albedo)
        node.location = (x, 200)
        links.new(node.outputs["Color"], principled_input(bsdf, "Base Color"))
    if roughness_map:
        node = nodes.new("ShaderNodeTexImage")
        node.name = "PBR_Roughness"
        node.image = load_image(roughness_map, non_color=True)
        node.location = (x, -20)
        links.new(node.outputs["Color"], principled_input(bsdf, "Roughness"))
    if normal_map:
        node = nodes.new("ShaderNodeTexImage")
        node.name = "PBR_Normal"
        node.image = load_image(normal_map, non_color=True)
        node.location = (x, -260)
        normal = nodes.new("ShaderNodeNormalMap")
        normal.inputs["Strength"].default_value = normal_strength
        normal.location = (-80, -220)
        links.new(node.outputs["Color"], normal.inputs["Color"])
        links.new(normal.outputs["Normal"], principled_input(bsdf, "Normal"))
    material["project_owned"] = True
    material["asset_family"] = "clothing-racks"
    return material


def build_materials(texture_paths: dict[str, dict[str, Path] | Path]) -> dict[str, bpy.types.Material]:
    oak = texture_paths["oak"]
    walnut = texture_paths["walnut"]
    dark = texture_paths["dark_walnut"]
    metal_roughness = texture_paths["metal_roughness"]
    assert isinstance(oak, dict) and isinstance(walnut, dict) and isinstance(dark, dict)
    assert isinstance(metal_roughness, Path)
    return {
        "painted_steel": make_material("M_CR_PaintedSteel", (0.030, 0.034, 0.032, 1),
                                        roughness=0.52, metallic=0.46,
                                        roughness_map=metal_roughness),
        "industrial_iron": make_material("M_CR_IndustrialIron", (0.050, 0.052, 0.048, 1),
                                          roughness=0.46, metallic=0.66,
                                          roughness_map=metal_roughness),
        "boutique_black": make_material("M_CR_BoutiqueBlack", (0.025, 0.028, 0.026, 1),
                                         roughness=0.38, metallic=0.68,
                                         roughness_map=metal_roughness),
        "dark_metal": make_material("M_CR_DarkPremiumMetal", (0.050, 0.047, 0.041, 1),
                                     roughness=0.30, metallic=0.84,
                                     roughness_map=metal_roughness),
        "brass": make_material("M_CR_RestrainedBrass", (0.43, 0.245, 0.070, 1),
                                roughness=0.26, metallic=0.92),
        "rubber": make_material("M_CR_CasterRubber", (0.012, 0.014, 0.014, 1),
                                 roughness=0.82, metallic=0.0),
        "oak": make_material("M_CR_NaturalOak", (1, 1, 1, 1), roughness=0.48,
                             albedo=oak["albedo"], roughness_map=oak["roughness"],
                             normal_map=oak["normal"], normal_strength=0.09),
        "walnut": make_material("M_CR_MediumWalnut", (1, 1, 1, 1), roughness=0.43,
                                albedo=walnut["albedo"], roughness_map=walnut["roughness"],
                                normal_map=walnut["normal"], normal_strength=0.08),
        "dark_walnut": make_material("M_CR_DarkWalnut", (1, 1, 1, 1), roughness=0.39,
                                     albedo=dark["albedo"], roughness_map=dark["roughness"],
                                     normal_map=dark["normal"], normal_strength=0.07),
        "led": make_material("M_CR_WarmLED", (1.0, 0.62, 0.22, 1), roughness=0.24,
                             emission=(1.0, 0.38, 0.075, 1), emission_strength=5.5),
        "led_low": make_material("M_CR_WarmLowerLED", (1.0, 0.48, 0.14, 1), roughness=0.24,
                                  emission=(1.0, 0.28, 0.045, 1), emission_strength=7.0),
        "lens": make_material("M_CR_LightLens", (0.78, 0.66, 0.44, 1), roughness=0.18,
                              metallic=0.0, emission=(1.0, 0.52, 0.16, 1), emission_strength=2.2),
        "collision": make_material("M_CR_Collision", (0.82, 0.08, 0.08, 0.18), roughness=0.8),
        "qa_fabric_green": make_material("M_QA_FabricGreen", (0.035, 0.22, 0.095, 1), roughness=0.82),
        "qa_fabric_cream": make_material("M_QA_FabricCream", (0.80, 0.72, 0.55, 1), roughness=0.86),
    }


BOX_VERTICES = (
    (-0.5, -0.5, -0.5), (0.5, -0.5, -0.5), (0.5, 0.5, -0.5), (-0.5, 0.5, -0.5),
    (-0.5, -0.5, 0.5), (0.5, -0.5, 0.5), (0.5, 0.5, 0.5), (-0.5, 0.5, 0.5),
)
BOX_FACES = (
    (0, 1, 5, 4),  # front -Y
    (3, 7, 6, 2),  # back +Y
    (0, 4, 7, 3),  # left -X
    (1, 2, 6, 5),  # right +X
    (4, 5, 6, 7),  # top +Z
    (0, 3, 2, 1),  # bottom -Z
)
FACE_PLANES = (("X", "Z"), ("X", "Z"), ("Y", "Z"), ("Y", "Z"), ("X", "Y"), ("X", "Y"))


def _coord(vertex: Sequence[float], axis: str) -> float:
    return vertex[{"X": 0, "Y": 1, "Z": 2}[axis]] + 0.5


def box_mesh(name: str, size: Sequence[float], location: Sequence[float], material: bpy.types.Material,
             *, bevel: float = 0.008, grain_axis: str = "X", uv_seed: int | None = None,
             parent: bpy.types.Object | None = None, bevel_segments: int = 2,
             smooth: bool = True) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(BOX_VERTICES, [], BOX_FACES)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.dimensions = tuple(float(value) for value in size)
    obj.location = tuple(float(value) for value in location)
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    uv = mesh.uv_layers.new(name="UVMap")
    seed = (uv_seed if uv_seed is not None else stable_seed(name)) % 6
    margin = 0.014
    for face_index, polygon in enumerate(mesh.polygons):
        axes = list(FACE_PLANES[face_index])
        if grain_axis in axes:
            u_axis = grain_axis
            v_axis = axes[1] if axes[0] == grain_axis else axes[0]
        else:
            u_axis, v_axis = axes
        cell = (face_index + seed) % 6
        cell_x, cell_y = cell % 3, cell // 3
        cell_w, cell_h = 1.0 / 3.0, 1.0 / 2.0
        flip = -1 if (stable_seed(name) + face_index) % 2 else 1
        for loop_index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            u_raw = _coord(vertex, u_axis)
            v_raw = _coord(vertex, v_axis)
            if flip < 0:
                u_raw = 1.0 - u_raw
            uv.data[loop_index].uv = (
                cell_x * cell_w + margin + u_raw * (cell_w - margin * 2),
                cell_y * cell_h + margin + v_raw * (cell_h - margin * 2),
            )
    mesh.materials.append(material)
    if bevel > 0:
        modifier = obj.modifiers.new("Bevel_Production", "BEVEL")
        modifier.width = min(float(bevel), min(size) * 0.24)
        modifier.segments = max(1, int(bevel_segments))
        modifier.limit_method = "ANGLE"
        modifier.angle_limit = math.radians(38)
        try:
            modifier.harden_normals = True
        except Exception:
            pass
        activate(obj)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    if smooth:
        activate(obj)
        try:
            bpy.ops.object.shade_auto_smooth(angle=math.radians(42))
        except Exception:
            for polygon in obj.data.polygons:
                polygon.use_smooth = True
            try:
                obj.data.set_sharp_from_angle(angle=math.radians(42))
            except Exception:
                pass
    set_parent(obj, parent)
    return obj


def cylinder(name: str, radius: float, depth: float, location: Sequence[float], material: bpy.types.Material,
             *, rotation: Sequence[float] = (0, 0, 0), vertices: int = 24,
             bevel: float = 0.0025, parent: bpy.types.Object | None = None) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=max(8, int(vertices)), radius=float(radius), depth=float(depth),
        end_fill_type="NGON", location=tuple(location), rotation=tuple(rotation),
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.data.materials.append(material)
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("Bevel_Production", "BEVEL")
        modifier.width = min(bevel, radius * 0.35)
        modifier.segments = 2
        modifier.limit_method = "ANGLE"
        activate(obj)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    try:
        obj.data.set_sharp_from_angle(angle=math.radians(48))
    except Exception:
        pass
    set_parent(obj, parent)
    return obj


def sphere(name: str, radius: float, location: Sequence[float], material: bpy.types.Material,
           *, segments: int = 20, rings: int = 10,
           parent: bpy.types.Object | None = None) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=max(8, segments), ring_count=max(6, rings), radius=radius, location=tuple(location),
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    set_parent(obj, parent)
    return obj


def tube_between(name: str, start: Sequence[float], end: Sequence[float], radius: float,
                 material: bpy.types.Material, *, vertices: int = 20,
                 parent: bpy.types.Object | None = None) -> bpy.types.Object:
    a, b = Vector(start), Vector(end)
    direction = b - a
    midpoint = (a + b) * 0.5
    obj = cylinder(name, radius, direction.length, midpoint, material, vertices=vertices, bevel=0.0015)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.rotation_mode = "XYZ"
    set_parent(obj, parent)
    return obj


def bent_tube(name: str, center: Sequence[float], bend_radius: float, tube_radius: float,
              start_angle: float, end_angle: float, material: bpy.types.Material,
              *, arc_segments: int = 8, ring_segments: int = 16,
              parent: bpy.types.Object | None = None) -> bpy.types.Object:
    cx, cy, cz = center
    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    for arc_index in range(arc_segments + 1):
        t = arc_index / arc_segments
        angle = start_angle + (end_angle - start_angle) * t
        radial = Vector((math.cos(angle), 0.0, math.sin(angle)))
        path = Vector((cx, cy, cz)) + radial * bend_radius
        side = Vector((0.0, 1.0, 0.0))
        for ring_index in range(ring_segments):
            ring_angle = ring_index / ring_segments * math.tau
            point = path + radial * (math.cos(ring_angle) * tube_radius)
            point += side * (math.sin(ring_angle) * tube_radius)
            verts.append(tuple(point))
    for arc_index in range(arc_segments):
        for ring_index in range(ring_segments):
            nxt = (ring_index + 1) % ring_segments
            a = arc_index * ring_segments + ring_index
            b = arc_index * ring_segments + nxt
            c = (arc_index + 1) * ring_segments + nxt
            d = (arc_index + 1) * ring_segments + ring_index
            faces.append((a, b, c, d))
    faces.append(tuple(reversed(range(ring_segments))))
    end_start = arc_segments * ring_segments
    faces.append(tuple(end_start + index for index in range(ring_segments)))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            arc_index = vertex_index // ring_segments
            ring_index = vertex_index % ring_segments
            uv.data[loop_index].uv = (arc_index / arc_segments, ring_index / ring_segments)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    set_parent(obj, parent)
    return obj


def empty(name: str, location: Sequence[float] = (0, 0, 0), *,
          parent: bpy.types.Object | None = None, display: str = "PLAIN_AXES",
          size: float = 0.08) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = tuple(location)
    obj.empty_display_type = display
    obj.empty_display_size = size
    set_parent(obj, parent)
    return obj


def triangle_count(root: bpy.types.Object) -> int:
    total = 0
    for obj in [root, *list(root.children_recursive)]:
        if obj.type != "MESH":
            continue
        total += sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons)
    return total


def mesh_objects(root: bpy.types.Object) -> list[bpy.types.Object]:
    return [obj for obj in [root, *list(root.children_recursive)] if obj.type == "MESH"]


def prefixed(lod: int, component: str) -> str:
    return f"{LOD_PREFIX[lod]}_{component}"


def add_caster(lod: int, tag: str, x: float, y: float, parent: bpy.types.Object,
               metal: bpy.types.Material, *, premium: bool = False) -> None:
    segments = LOD_SEGMENTS[lod]
    radius = 0.058 if premium else 0.054
    wheel_width = 0.030 if premium else 0.026
    cylinder(prefixed(lod, f"Wheel_{tag}"), radius, wheel_width, (x, y, radius), MATERIALS["rubber"],
             rotation=(0, math.pi / 2, 0), vertices=segments, bevel=0.0015, parent=parent)
    if lod < 2:
        cylinder(prefixed(lod, f"WheelHub_{tag}"), radius * 0.38, wheel_width + 0.006,
                 (x, y, radius), metal, rotation=(0, math.pi / 2, 0),
                 vertices=segments, bevel=0.001, parent=parent)
        fork_x = wheel_width * 0.72
        for side, offset in (("L", -fork_x), ("R", fork_x)):
            box_mesh(prefixed(lod, f"CasterFork_{tag}_{side}"),
                     (0.010, radius * 1.22, radius * 1.42),
                     (x + offset, y, radius * 1.42), metal,
                     bevel=0.003, parent=parent, bevel_segments=LOD_BEVEL_SEGMENTS[lod])
    box_mesh(prefixed(lod, f"CasterPlate_{tag}"),
             (0.090, 0.080, 0.018), (x, y, radius * 2.18), metal,
             bevel=0.004, parent=parent, bevel_segments=LOD_BEVEL_SEGMENTS[lod])
    # Bridge the caster plate into the rack frame with intentional overlap.
    # The former fixed 55 mm stem sat 5.8 mm below the Basic frame and could
    # read as a wheel assembly floating under the rack at player-eye distance.
    stem_bottom = radius * 2.18
    stem_top = 0.182
    cylinder(prefixed(lod, f"CasterStem_{tag}"), 0.015, stem_top - stem_bottom,
             (x, y, (stem_bottom + stem_top) / 2), metal, vertices=segments,
             bevel=0.0015, parent=parent)
    if lod == 0:
        cylinder(prefixed(lod, f"CasterSwivelRing_{tag}"), 0.030, 0.012,
                 (x, y, radius * 2.32), metal, vertices=segments,
                 bevel=0.001, parent=parent)


def add_adjustable_foot(lod: int, tag: str, x: float, y: float,
                        parent: bpy.types.Object, metal: bpy.types.Material) -> None:
    segments = LOD_SEGMENTS[lod]
    cylinder(prefixed(lod, f"FootPad_{tag}"), 0.034, 0.012, (x, y, 0.006),
             MATERIALS["rubber"], vertices=segments, bevel=0.001, parent=parent)
    # Insert the threaded stem into the post rather than terminating 3 mm
    # below it.  The nut remains visible while the load path stays continuous.
    cylinder(prefixed(lod, f"FootStem_{tag}"), 0.010, 0.068, (x, y, 0.046),
             metal, vertices=max(8, segments // 2), bevel=0.001, parent=parent)
    if lod == 0:
        cylinder(prefixed(lod, f"FootNut_{tag}"), 0.017, 0.012, (x, y, 0.060),
                 metal, vertices=8, bevel=0.0008, parent=parent)


def add_rod_mount(lod: int, tag: str, x: float, y: float, z: float,
                  parent: bpy.types.Object, material: bpy.types.Material,
                  *, direction: float) -> None:
    box_mesh(prefixed(lod, f"RodBracketPlate_{tag}"), (0.018, 0.060, 0.105),
             (x, y, z), material, bevel=0.004, parent=parent,
             bevel_segments=LOD_BEVEL_SEGMENTS[lod])
    cylinder(prefixed(lod, f"RodSocket_{tag}"), 0.030, 0.045,
             (x - direction * 0.020, y, z), material,
             rotation=(0, math.pi / 2, 0), vertices=LOD_SEGMENTS[lod],
             bevel=0.002, parent=parent)
    if lod == 0:
        for dz in (-0.030, 0.030):
            cylinder(prefixed(lod, f"RodFastener_{tag}_{'A' if dz < 0 else 'B'}"),
                     0.005, 0.005, (x, y - 0.032, z + dz), MATERIALS["dark_metal"],
                     rotation=(math.pi / 2, 0, 0), vertices=10, bevel=0.0005, parent=parent)


def add_puck_fixture(lod: int, tag: str, x: float, y: float, z: float,
                     parent: bpy.types.Object, housing: bpy.types.Material) -> None:
    cylinder(prefixed(lod, f"LightHousing_{tag}"), 0.045, 0.018, (x, y, z), housing,
             vertices=LOD_SEGMENTS[lod], bevel=0.002, parent=parent)
    cylinder(prefixed(lod, f"LightLens_{tag}"), 0.034, 0.006, (x, y, z - 0.012),
             MATERIALS["lens"], vertices=LOD_SEGMENTS[lod], bevel=0.001, parent=parent)


def add_led_strip(lod: int, tag: str, x: float, y: float, z: float, length: float,
                  parent: bpy.types.Object, trim_material: bpy.types.Material,
                  *, emissive_material: bpy.types.Material | None = None) -> None:
    box_mesh(prefixed(lod, f"LEDChannel_{tag}"), (length, 0.025, 0.025),
             (x, y, z), trim_material, bevel=0.004, parent=parent,
             bevel_segments=LOD_BEVEL_SEGMENTS[lod])
    box_mesh(prefixed(lod, f"LEDEmissive_{tag}"), (length - 0.025, 0.010, 0.010),
             (x, y - 0.010, z - 0.003), emissive_material or MATERIALS["led"], bevel=0.002,
             parent=parent, bevel_segments=1)


def add_front_fastener(lod: int, tag: str, x: float, y: float, z: float,
                       parent: bpy.types.Object, material: bpy.types.Material) -> None:
    if lod != 0:
        return
    cylinder(prefixed(lod, f"Fastener_{tag}"), 0.006, 0.006, (x, y, z), material,
             rotation=(math.pi / 2, 0, 0), vertices=10, bevel=0.0005, parent=parent)


def build_basic(spec: RackSpec, lod: int, parent: bpy.types.Object) -> None:
    metal = MATERIALS["painted_steel"]
    segments = LOD_SEGMENTS[lod]
    bevel_segments = LOD_BEVEL_SEGMENTS[lod]
    rail = 0.038
    base_z = 0.190
    rail_y = spec.depth / 2 - 0.072
    rail_x = spec.width / 2 - 0.070
    box_mesh(prefixed(lod, "BaseRail_Front"), (spec.width - 0.105, rail, rail),
             (0, -rail_y, base_z), metal, bevel=0.007, parent=parent,
             bevel_segments=bevel_segments)
    box_mesh(prefixed(lod, "BaseRail_Back"), (spec.width - 0.105, rail, rail),
             (0, rail_y, base_z), metal, bevel=0.007, parent=parent,
             bevel_segments=bevel_segments)
    for side, x in (("Left", -rail_x), ("Right", rail_x)):
        box_mesh(prefixed(lod, f"BaseRail_{side}"), (rail, spec.depth - 0.105, rail),
                 (x, 0, base_z), metal, bevel=0.007, parent=parent,
                 bevel_segments=bevel_segments)
    upright_x = spec.width / 2 - 0.085
    bend_radius = 0.070
    top_z = 1.700
    upright_top = top_z - bend_radius
    upright_bottom = base_z + rail * 0.45
    for side, x in (("Left", -upright_x), ("Right", upright_x)):
        cylinder(prefixed(lod, f"VerticalSupport_{side}"), 0.027,
                 upright_top - upright_bottom, (x, 0, (upright_top + upright_bottom) / 2), metal,
                 vertices=segments, bevel=0.002, parent=parent)
        if lod < 2:
            cylinder(prefixed(lod, f"BaseCollar_{side}"), 0.036, 0.035,
                     (x, 0, upright_bottom + 0.006), metal, vertices=segments,
                     bevel=0.002, parent=parent)
    bar_half = upright_x - bend_radius
    cylinder(prefixed(lod, "HangingRod"), 0.027, bar_half * 2,
             (0, 0, top_z), metal, rotation=(0, math.pi / 2, 0),
             vertices=segments, bevel=0.002, parent=parent)
    bent_tube(prefixed(lod, "Elbow_Left"), (-bar_half, 0, upright_top), bend_radius, 0.027,
              math.pi, math.pi / 2, metal, arc_segments=max(4, segments // 3),
              ring_segments=max(8, segments), parent=parent)
    bent_tube(prefixed(lod, "Elbow_Right"), (bar_half, 0, upright_top), bend_radius, 0.027,
              math.pi / 2, 0.0, metal, arc_segments=max(4, segments // 3),
              ring_segments=max(8, segments), parent=parent)
    caster_x = spec.width / 2 - 0.050
    caster_y = spec.depth / 2 - 0.057
    for tag, x, y in (
        ("FL", -caster_x, -caster_y), ("FR", caster_x, -caster_y),
        ("BL", -caster_x, caster_y), ("BR", caster_x, caster_y),
    ):
        add_caster(lod, tag, x, y, parent, metal)
    if lod == 0:
        for tag, x in (("L", -upright_x), ("R", upright_x)):
            add_front_fastener(lod, f"Base_{tag}", x, -rail_y - rail / 2 - 0.003,
                               base_z, parent, metal)


def build_standard(spec: RackSpec, lod: int, parent: bpy.types.Object) -> None:
    metal = MATERIALS["industrial_iron"]
    wood = MATERIALS["oak"]
    segments = LOD_SEGMENTS[lod]
    bevel_segments = LOD_BEVEL_SEGMENTS[lod]
    rail = 0.046
    base_z = 0.185
    rail_y = spec.depth / 2 - 0.074
    rail_x = spec.width / 2 - 0.074
    box_mesh(prefixed(lod, "DeckFrame_Front"), (spec.width - 0.090, rail, 0.065),
             (0, -rail_y, base_z), metal, bevel=0.008, parent=parent,
             bevel_segments=bevel_segments)
    box_mesh(prefixed(lod, "DeckFrame_Back"), (spec.width - 0.090, rail, 0.065),
             (0, rail_y, base_z), metal, bevel=0.008, parent=parent,
             bevel_segments=bevel_segments)
    for side, x in (("Left", -rail_x), ("Right", rail_x)):
        box_mesh(prefixed(lod, f"DeckFrame_{side}"), (rail, spec.depth - 0.100, 0.065),
                 (x, 0, base_z), metal, bevel=0.008, parent=parent,
                 bevel_segments=bevel_segments)
    cross_count = 3 if lod == 0 else 2 if lod == 1 else 1
    for index in range(cross_count):
        x = -0.48 + (0.96 / max(1, cross_count - 1)) * index if cross_count > 1 else 0
        box_mesh(prefixed(lod, f"DeckSupport_{index + 1:02d}"),
                 (0.040, spec.depth - 0.145, 0.035), (x, 0, 0.205), metal,
                 bevel=0.005, parent=parent, bevel_segments=bevel_segments)
    plank_count = 6 if lod == 0 else 3 if lod == 1 else 1
    usable_depth = spec.depth - 0.185
    gap = 0.007 if plank_count > 1 else 0
    plank_depth = (usable_depth - gap * (plank_count - 1)) / plank_count
    for index in range(plank_count):
        y = -usable_depth / 2 + plank_depth / 2 + index * (plank_depth + gap)
        box_mesh(prefixed(lod, f"WoodPlatformPlank_{index + 1:02d}"),
                 (spec.width - 0.185, plank_depth, 0.057), (0, y, 0.242), wood,
                 bevel=0.005, grain_axis="X", uv_seed=index + 1,
                 parent=parent, bevel_segments=bevel_segments)
    upright_x = spec.width / 2 - 0.105
    bend_radius = 0.073
    top_z = 1.745
    upright_top = top_z - bend_radius
    upright_bottom = 0.248
    for side, x in (("Left", -upright_x), ("Right", upright_x)):
        cylinder(prefixed(lod, f"PipeUpright_{side}"), 0.032,
                 upright_top - upright_bottom, (x, 0, (upright_top + upright_bottom) / 2), metal,
                 vertices=segments, bevel=0.0025, parent=parent)
        cylinder(prefixed(lod, f"PipeFootFlange_{side}"), 0.050, 0.026,
                 (x, 0, upright_bottom), metal, vertices=segments,
                 bevel=0.002, parent=parent)
        if lod < 2:
            cylinder(prefixed(lod, f"PipeCoupling_{side}"), 0.040, 0.045,
                     (x, 0, upright_top - 0.045), metal, vertices=segments,
                     bevel=0.002, parent=parent)
    bar_half = upright_x - bend_radius
    cylinder(prefixed(lod, "HangingRod"), 0.032, bar_half * 2,
             (0, 0, top_z), metal, rotation=(0, math.pi / 2, 0),
             vertices=segments, bevel=0.0025, parent=parent)
    bent_tube(prefixed(lod, "PipeElbow_Left"), (-bar_half, 0, upright_top), bend_radius, 0.032,
              math.pi, math.pi / 2, metal, arc_segments=max(4, segments // 3),
              ring_segments=max(8, segments), parent=parent)
    bent_tube(prefixed(lod, "PipeElbow_Right"), (bar_half, 0, upright_top), bend_radius, 0.032,
              math.pi / 2, 0.0, metal, arc_segments=max(4, segments // 3),
              ring_segments=max(8, segments), parent=parent)
    caster_x = spec.width / 2 - 0.052
    caster_y = spec.depth / 2 - 0.060
    for tag, x, y in (
        ("FL", -caster_x, -caster_y), ("FR", caster_x, -caster_y),
        ("BL", -caster_x, caster_y), ("BR", caster_x, caster_y),
    ):
        add_caster(lod, tag, x, y, parent, metal, premium=True)


def build_premium(spec: RackSpec, lod: int, parent: bpy.types.Object) -> None:
    metal = MATERIALS["boutique_black"]
    wood = MATERIALS["oak"]
    bevel_segments = LOD_BEVEL_SEGMENTS[lod]
    tube = 0.058
    x_outer = spec.width / 2 - tube / 2
    y_outer = spec.depth / 2 - tube / 2
    frame_bottom = 0.075
    frame_top = 2.015
    vertical_height = frame_top - frame_bottom
    for side, x in (("Left", -x_outer), ("Right", x_outer)):
        for depth_name, y in (("Front", -y_outer), ("Back", y_outer)):
            box_mesh(prefixed(lod, f"FramePost_{side}_{depth_name}"),
                     (tube, tube, vertical_height), (x, y, (frame_top + frame_bottom) / 2), metal,
                     bevel=0.008, parent=parent, bevel_segments=bevel_segments)
    divider_x = -0.305
    for depth_name, y in (("Front", -y_outer), ("Back", y_outer)):
        box_mesh(prefixed(lod, f"ShelfDivider_{depth_name}"),
                 (tube, tube, vertical_height), (divider_x, y, (frame_top + frame_bottom) / 2), metal,
                 bevel=0.008, parent=parent, bevel_segments=bevel_segments)
    for depth_name, y in (("Front", -y_outer), ("Back", y_outer)):
        box_mesh(prefixed(lod, f"TopRail_{depth_name}"),
                 (spec.width - tube, tube, tube), (0, y, frame_top), metal,
                 bevel=0.008, parent=parent, bevel_segments=bevel_segments)
        box_mesh(prefixed(lod, f"BottomRail_{depth_name}"),
                 (spec.width - tube, tube, tube), (0, y, 0.120), metal,
                 bevel=0.008, parent=parent, bevel_segments=bevel_segments)
    for side, x in (("Left", -x_outer), ("Right", x_outer)):
        box_mesh(prefixed(lod, f"TopDepthRail_{side}"),
                 (tube, spec.depth - tube, tube), (x, 0, frame_top), metal,
                 bevel=0.008, parent=parent, bevel_segments=bevel_segments)
    box_mesh(prefixed(lod, "WoodTopCap"), (spec.width, spec.depth, 0.052),
             (0, 0, 2.054), wood, bevel=0.010, grain_axis="X", parent=parent,
             bevel_segments=bevel_segments)
    # Slot the deck into all four posts.  The previous nominal insets left a
    # visible air line around the board even though the frame itself was sound.
    frame_clear_width = 2 * x_outer - tube
    frame_clear_depth = 2 * y_outer - tube
    box_mesh(prefixed(lod, "FullLowerShelf"),
             (frame_clear_width + 0.010, frame_clear_depth + 0.010, 0.054),
             (0, 0, 0.174), wood, bevel=0.008, grain_axis="X", uv_seed=2,
             parent=parent, bevel_segments=bevel_segments)
    # Derive the shelf bay from the actual inside faces of its posts, then add
    # a restrained 5 mm mortise at either end.  This prevents both floating
    # shelves and support rails that poke through the frame.
    left_inner = -x_outer + tube / 2
    right_inner = divider_x - tube / 2
    left_center = (left_inner + right_inner) / 2
    left_width = right_inner - left_inner + 0.010
    shelf_depth = frame_clear_depth + 0.006
    shelf_levels = (0.575, 0.985, 1.395)
    for index, z in enumerate(shelf_levels, 1):
        box_mesh(prefixed(lod, f"Shelf_{index:02d}"),
                 (left_width, shelf_depth, 0.046), (left_center, 0, z), wood,
                 bevel=0.007, grain_axis="X", uv_seed=4 + index,
                 parent=parent, bevel_segments=bevel_segments)
        for depth_name, y in (("Front", -y_outer + 0.010), ("Back", y_outer - 0.010)):
            box_mesh(prefixed(lod, f"ShelfSupport_{index:02d}_{depth_name}"),
                     (left_width - 0.002, 0.026, 0.028), (left_center, y, z - 0.036), metal,
                     bevel=0.004, parent=parent, bevel_segments=bevel_segments)
    # The rod brackets now land on load-bearing depth rails instead of ending
    # in open space between the front and rear posts.
    rod_start = divider_x + tube / 2
    rod_end = x_outer - tube / 2
    rod_y = -0.095
    rod_z = 1.755
    for side, x in (("Left", rod_start), ("Right", rod_end)):
        box_mesh(prefixed(lod, f"RodDepthRail_{side}"),
                 (0.034, spec.depth - tube, 0.046), (x, 0, rod_z), metal,
                 bevel=0.006, parent=parent, bevel_segments=bevel_segments)
    cylinder(prefixed(lod, "HangingRod"), 0.024, rod_end - rod_start,
             ((rod_start + rod_end) / 2, rod_y, rod_z), metal,
             rotation=(0, math.pi / 2, 0), vertices=LOD_SEGMENTS[lod],
             bevel=0.002, parent=parent)
    add_rod_mount(lod, "Left", rod_start, rod_y, rod_z, parent, metal, direction=-1)
    add_rod_mount(lod, "Right", rod_end, rod_y, rod_z, parent, metal, direction=1)
    for tag, x, y in (
        ("FL", -x_outer, -y_outer), ("FR", x_outer, -y_outer),
        ("BL", -x_outer, y_outer), ("BR", x_outer, y_outer),
    ):
        add_adjustable_foot(lod, tag, x, y, parent, metal)
    if lod == 0:
        for index, z in enumerate(shelf_levels, 1):
            add_front_fastener(lod, f"Shelf{index}_L", -x_outer + 0.020, -y_outer - 0.031,
                               z - 0.020, parent, metal)
            add_front_fastener(lod, f"Shelf{index}_R", divider_x - 0.020, -y_outer - 0.031,
                               z - 0.020, parent, metal)


def millwork_layout(spec: RackSpec) -> dict[str, object]:
    """Return one structural layout shared by geometry and runtime nodes.

    Earlier revisions independently approximated bay centers, divider centers,
    shelf spans, light positions, and rod spans.  Those values were each close,
    but their accumulated error left visible gaps at the outer bays.  Computing
    every dependent part from the physical inside faces makes those joints
    deterministic across High-End and Luxury as well as every LOD.
    """
    side_thickness = 0.075 if spec.key == "luxury" else 0.070
    divider_thickness = 0.060
    inner_width = spec.width - 2 * side_thickness
    clear_width = (inner_width - 2 * divider_thickness) / 3
    bay_pitch = clear_width + divider_thickness
    return {
        "side_thickness": side_thickness,
        "divider_thickness": divider_thickness,
        "side_x": spec.width / 2 - side_thickness / 2,
        "clear_width": clear_width,
        "bay_centers": (-bay_pitch, 0.0, bay_pitch),
        "divider_xs": (-bay_pitch / 2, bay_pitch / 2),
    }
def build_millwork(spec: RackSpec, lod: int, parent: bpy.types.Object, *, luxury: bool) -> None:
    wood = MATERIALS["dark_walnut" if luxury else "walnut"]
    metal = MATERIALS["brass" if luxury else "dark_metal"]
    dark_metal = MATERIALS["dark_metal"]
    bevel_segments = LOD_BEVEL_SEGMENTS[lod]
    layout = millwork_layout(spec)
    side_thickness = float(layout["side_thickness"])
    divider_thickness = float(layout["divider_thickness"])
    side_x = float(layout["side_x"])
    clear_width = float(layout["clear_width"])
    bay_pitch = clear_width + divider_thickness
    bay_centers = tuple(layout["bay_centers"])
    divider_xs = tuple(layout["divider_xs"])
    back_y = spec.depth / 2 - 0.025
    front_y = -spec.depth / 2
    base_height = 0.145 if luxury else 0.135
    panel_bottom = base_height
    panel_top = spec.height - 0.155
    panel_height = panel_top - panel_bottom
    # Structural carcass and three independent back panels make the visible
    # construction legible from the sides and rear instead of a single block.
    box_mesh(prefixed(lod, "BasePlinth"), (spec.width, spec.depth, base_height),
             (0, 0, base_height / 2), wood, bevel=0.010, grain_axis="X",
             parent=parent, bevel_segments=bevel_segments)
    box_mesh(prefixed(lod, "BaseMolding"), (spec.width + 0.018, spec.depth + 0.018, 0.050),
             (0, -0.002, base_height + 0.025), wood, bevel=0.008, grain_axis="X",
             uv_seed=1, parent=parent, bevel_segments=bevel_segments)
    for side, x in (("Left", -side_x), ("Right", side_x)):
        box_mesh(prefixed(lod, f"SidePanel_{side}"),
                 (side_thickness, spec.depth - 0.030, panel_height),
                 (x, 0.005, panel_bottom + panel_height / 2), wood,
                 bevel=0.010, grain_axis="Z", uv_seed=2 if side == "Left" else 3,
                 parent=parent, bevel_segments=bevel_segments)
    # Recess the structural backer behind the three finished panels.  The old
    # depth order hid every panel seam from a player inspecting the rear.
    box_mesh(prefixed(lod, "ContinuousBacker"),
             (spec.width - side_thickness * 2 - 0.012, 0.030, panel_height - 0.012),
             (0, back_y - 0.036, panel_bottom + panel_height / 2), wood,
             bevel=0.004, grain_axis="Z", uv_seed=9,
             parent=parent, bevel_segments=bevel_segments)
    for index, x in enumerate(bay_centers, 1):
        box_mesh(prefixed(lod, f"BackPanel_{index:02d}"),
                 (bay_pitch - 0.035, 0.032, panel_height - 0.045),
                 (x, back_y, panel_bottom + panel_height / 2), wood,
                 bevel=0.006, grain_axis="Z", uv_seed=10 + index,
                 parent=parent, bevel_segments=bevel_segments)
    if lod < 2:
        rear_trim_y = spec.depth / 2 - 0.013
        for index, x in enumerate((-side_x + 0.018, *divider_xs, side_x - 0.018), 1):
            box_mesh(prefixed(lod, f"RearStile_{index:02d}"),
                     (0.052, 0.018, panel_height - 0.020),
                     (x, rear_trim_y, panel_bottom + panel_height / 2), wood,
                     bevel=0.004, grain_axis="Z", uv_seed=90 + index,
                     parent=parent, bevel_segments=bevel_segments)
        for index, z in enumerate((panel_bottom + 0.035, panel_top - 0.035), 1):
            box_mesh(prefixed(lod, f"RearRail_{index:02d}"),
                     (spec.width - side_thickness * 1.35, 0.018, 0.052),
                     (0, rear_trim_y, z), wood,
                     bevel=0.004, grain_axis="X", uv_seed=95 + index,
                     parent=parent, bevel_segments=bevel_segments)
    for index, x in enumerate(divider_xs, 1):
        box_mesh(prefixed(lod, f"VerticalDivider_{index:02d}"),
                 (divider_thickness, spec.depth - 0.040, panel_height),
                 (x, 0.005, panel_bottom + panel_height / 2), wood,
                 bevel=0.008, grain_axis="Z", uv_seed=20 + index,
                 parent=parent, bevel_segments=bevel_segments)
    ceiling_z = spec.height - 0.185
    box_mesh(prefixed(lod, "TopInteriorPanel"),
             (spec.width - 0.105, spec.depth - 0.055, 0.070),
             (0, 0.002, ceiling_z), wood, bevel=0.008, grain_axis="X", uv_seed=4,
             parent=parent, bevel_segments=bevel_segments)
    # Crown and fascia follow the stepped reference molding without turning the
    # top into a stack of arbitrary decorative blocks.
    box_mesh(prefixed(lod, "CrownLower"), (spec.width + 0.010, spec.depth + 0.018, 0.060),
             (0, 0, spec.height - 0.120), wood, bevel=0.009, grain_axis="X", uv_seed=5,
             parent=parent, bevel_segments=bevel_segments)
    box_mesh(prefixed(lod, "CrownUpper"), (spec.width + 0.060, spec.depth + 0.055, 0.055),
             (0, 0, spec.height - 0.055), wood, bevel=0.010, grain_axis="X", uv_seed=6,
             parent=parent, bevel_segments=bevel_segments)
    box_mesh(prefixed(lod, "FrontFascia"), (spec.width - 0.035, 0.060, 0.110),
             (0, front_y - 0.010, spec.height - 0.155), wood,
             bevel=0.008, grain_axis="X", uv_seed=7,
             parent=parent, bevel_segments=bevel_segments)
    upper_surface = 1.825 if luxury else 1.785
    lower_surface = 0.485 if luxury else 0.475
    connected_shelf_width = clear_width + 0.012
    upper_shelf_depth = spec.depth - 0.070
    lower_shelf_depth = spec.depth - 0.055
    for index, x in enumerate(bay_centers, 1):
        box_mesh(prefixed(lod, f"UpperDisplayShelf_{index:02d}"),
                 (connected_shelf_width, upper_shelf_depth, 0.052),
                 (x, -0.005, upper_surface - 0.026), wood,
                 bevel=0.008, grain_axis="X", uv_seed=30 + index,
                 parent=parent, bevel_segments=bevel_segments)
        box_mesh(prefixed(lod, f"LowerDisplayShelf_{index:02d}"),
                 (connected_shelf_width, lower_shelf_depth, 0.058),
                 (x, -0.012, lower_surface - 0.029), wood,
                 bevel=0.009, grain_axis="X", uv_seed=40 + index,
                 parent=parent, bevel_segments=bevel_segments)
        if luxury:
            # The luxury reference divides every lower bay into two product
            # cubbies; their center partitions are load-bearing millwork.
            cubby_top = lower_surface - 0.058
            cubby_height = cubby_top - base_height + 0.010
            box_mesh(prefixed(lod, f"LowerCubbyDivider_{index:02d}"),
                     (0.045, spec.depth - 0.070, cubby_height),
                     (x, -0.005, (base_height + cubby_top) / 2), wood,
                     bevel=0.006, grain_axis="Z", uv_seed=50 + index,
                     parent=parent, bevel_segments=bevel_segments)
        else:
            lower_shelf_surface = 0.215
            box_mesh(prefixed(lod, f"LowerStorageShelf_{index:02d}"),
                     (connected_shelf_width, upper_shelf_depth, 0.050),
                     (x, -0.005, lower_shelf_surface - 0.025), wood,
                     bevel=0.007, grain_axis="X", uv_seed=50 + index,
                     parent=parent, bevel_segments=bevel_segments)
            # Complete U-shaped steel frames connect each upper display shelf
            # to the base and its rear support.  The old pair of inset front
            # legs appeared detached and extended too far through the shelf.
            support_offset = clear_width / 2 - 0.026
            support_bottom = base_height
            support_top = lower_surface - 0.058
            support_height = support_top - support_bottom + 0.010
            thin_support_bevel_segments = 2 if lod == 0 else 1
            for side_index, offset in enumerate((-support_offset, support_offset), 1):
                support_x = x + offset
                depth_positions = (("Front", front_y + 0.060),)
                if lod < 2:
                    depth_positions += (("Back", back_y - 0.045),)
                for depth_name, support_y in depth_positions:
                    box_mesh(prefixed(lod, f"ShelfLeg_{index:02d}_{side_index:02d}_{depth_name}"),
                             (0.026, 0.032, support_height),
                             (support_x, support_y, (support_bottom + support_top) / 2), dark_metal,
                             bevel=0.004, parent=parent,
                             bevel_segments=thin_support_bevel_segments)
                if lod < 2:
                    box_mesh(prefixed(lod, f"ShelfSideRail_{index:02d}_{side_index:02d}"),
                             (0.026, lower_shelf_depth - 0.020, 0.026),
                             (support_x, -0.012, support_top - 0.004), dark_metal,
                             bevel=0.004, parent=parent,
                             bevel_segments=thin_support_bevel_segments)
                    box_mesh(prefixed(lod, f"StorageSideRail_{index:02d}_{side_index:02d}"),
                             (0.026, upper_shelf_depth - 0.020, 0.024),
                             (support_x, -0.005, lower_shelf_surface - 0.055), dark_metal,
                             bevel=0.004, parent=parent,
                             bevel_segments=thin_support_bevel_segments)
            # Close the two side frames into one load-bearing undercarriage.
            # Without these front/back stretchers the connected legs still read
            # as loose poles from the normal player approach angle.
            crossrail_width = support_offset * 2 + 0.018
            rail_depths = (("Front", front_y + 0.060),)
            if lod < 2:
                rail_depths += (("Back", back_y - 0.045),)
            for depth_name, support_y in rail_depths:
                box_mesh(prefixed(lod, f"ShelfCrossRail_{index:02d}_{depth_name}"),
                         (crossrail_width, 0.026, 0.026),
                         (x, support_y, support_top - 0.004), dark_metal,
                         bevel=0.004, parent=parent,
                         bevel_segments=thin_support_bevel_segments)
                box_mesh(prefixed(lod, f"StorageCrossRail_{index:02d}_{depth_name}"),
                         (crossrail_width, 0.026, 0.024),
                         (x, support_y, lower_shelf_surface - 0.055), dark_metal,
                         bevel=0.004, parent=parent,
                         bevel_segments=thin_support_bevel_segments)
    rod_z = 1.655 if luxury else 1.635
    rod_y = -0.115
    rod_half = clear_width / 2
    for index, x in enumerate(bay_centers, 1):
        cylinder(prefixed(lod, f"HangingRod_{index:02d}"), 0.021,
                 rod_half * 2, (x, rod_y, rod_z), metal,
                 rotation=(0, math.pi / 2, 0), vertices=LOD_SEGMENTS[lod],
                 bevel=0.002, parent=parent)
        add_rod_mount(lod, f"{index:02d}_Left", x - rod_half, rod_y, rod_z,
                      parent, metal, direction=-1)
        add_rod_mount(lod, f"{index:02d}_Right", x + rod_half, rod_y, rod_z,
                      parent, metal, direction=1)
    # Front stiles, trim transitions, and inset lines catch the warm interior
    # lighting and make the construction read at both player and room scale.
    stile_xs = (-side_x + 0.010, divider_xs[0], divider_xs[1], side_x - 0.010)
    for index, x in enumerate(stile_xs, 1):
        box_mesh(prefixed(lod, f"FrontStile_{index:02d}"),
                 (0.050 if luxury else 0.045, 0.040, panel_height - 0.030),
                 (x, front_y - 0.012, panel_bottom + panel_height / 2), wood,
                 bevel=0.006, grain_axis="Z", uv_seed=60 + index,
                 parent=parent, bevel_segments=bevel_segments)
    if lod < 2:
        for index, x in enumerate(bay_centers, 1):
            box_mesh(prefixed(lod, f"UpperShelfLip_{index:02d}"),
                     (connected_shelf_width, 0.035, 0.050),
                     (x, front_y + 0.020, upper_surface + 0.010), wood,
                     bevel=0.006, grain_axis="X", uv_seed=70 + index,
                     parent=parent, bevel_segments=bevel_segments)
            box_mesh(prefixed(lod, f"LowerShelfLip_{index:02d}"),
                     (connected_shelf_width, 0.035, 0.055),
                     (x, front_y + 0.020, lower_surface + 0.008), wood,
                     bevel=0.006, grain_axis="X", uv_seed=80 + index,
                     parent=parent, bevel_segments=bevel_segments)
    if luxury:
        for index, x in enumerate(stile_xs, 1):
            box_mesh(prefixed(lod, f"BrassInlay_{index:02d}"),
                     (0.008, 0.010, panel_height - 0.125),
                     (x + (0.032 if index < 3 else -0.032), front_y - 0.035,
                      panel_bottom + panel_height / 2), MATERIALS["brass"],
                     bevel=0.002, grain_axis="Z", parent=parent, bevel_segments=1)
        box_mesh(prefixed(lod, "BrassBaseInlay"), (spec.width - 0.075, 0.010, 0.010),
                 (0, front_y - 0.038, base_height + 0.055), MATERIALS["brass"],
                 bevel=0.002, parent=parent, bevel_segments=1)
        box_mesh(prefixed(lod, "BrassCrownInlay"), (spec.width - 0.105, 0.010, 0.010),
                 (0, front_y - 0.044, spec.height - 0.112), MATERIALS["brass"],
                 bevel=0.002, parent=parent, bevel_segments=1)
    if lod == 0:
        # Restrained joinery seams and visible mounting screws: only places the
        # player can actually see at close range, not hidden micro-detail.
        for bay_index, x in enumerate(bay_centers, 1):
            for z_index, z in enumerate((upper_surface - 0.055, lower_surface - 0.060), 1):
                for side_index, sx in enumerate((x - rod_half, x + rod_half), 1):
                    add_front_fastener(lod, f"Bay{bay_index}_{z_index}_{side_index}",
                                       sx, front_y - 0.038, z, parent, dark_metal)
        if luxury:
            # Three subtle flutes per outside stile reinforce the custom final
            # tier without becoming ornate residential closet decoration.
            for side_name, x in (("Left", -side_x + 0.020), ("Right", side_x - 0.020)):
                for flute_index, dx in enumerate((-0.018, 0.0, 0.018), 1):
                    box_mesh(prefixed(lod, f"Flute_{side_name}_{flute_index:02d}"),
                             (0.006, 0.010, panel_height - 0.180),
                             (x + dx, front_y - 0.038, panel_bottom + panel_height / 2),
                             MATERIALS["dark_metal"], bevel=0.0015, grain_axis="Z",
                             parent=parent, bevel_segments=1)
    fixture_z = spec.height - 0.215
    for index, x in enumerate(bay_centers, 1):
        add_puck_fixture(lod, f"{index:02d}", x, -0.105, fixture_z,
                         parent, dark_metal)
        if luxury:
            add_led_strip(lod, f"Upper_{index:02d}", x, back_y - 0.040,
                          upper_surface - 0.060, clear_width - 0.100, parent, MATERIALS["brass"])
            if lod < 2:
                add_led_strip(lod, f"Lower_{index:02d}", x, back_y - 0.040,
                              lower_surface - 0.060, clear_width - 0.100, parent, MATERIALS["brass"],
                              emissive_material=MATERIALS["led_low"])


def build_geometry(spec: RackSpec, lod: int, parent: bpy.types.Object) -> None:
    if spec.key == "basic":
        build_basic(spec, lod, parent)
    elif spec.key == "standard":
        build_standard(spec, lod, parent)
    elif spec.key == "premium":
        build_premium(spec, lod, parent)
    elif spec.key == "high-end":
        build_millwork(spec, lod, parent, luxury=False)
    elif spec.key == "luxury":
        build_millwork(spec, lod, parent, luxury=True)
    else:
        raise ValueError(spec.key)


def zone_layout(spec: RackSpec) -> tuple[list[dict], list[dict]]:
    if spec.key == "basic":
        return ([{"start": -0.45, "end": 0.45, "y": 0.0, "z": 1.700}], [])
    if spec.key == "standard":
        return (
            [{"start": -0.46, "end": 0.46, "y": 0.0, "z": 1.745}],
            [{"min": (-0.69, -0.205), "max": (0.69, 0.205), "z": 0.271}],
        )
    if spec.key == "premium":
        tube = 0.058
        x_outer = spec.width / 2 - tube / 2
        y_outer = spec.depth / 2 - tube / 2
        divider_x = -0.305
        rod_start = divider_x + tube / 2
        rod_end = x_outer - tube / 2
        left_inner = -x_outer + tube / 2
        right_inner = divider_x - tube / 2
        # Keep a 0.42 m hanger plus 20 mm breathing room clear of both the
        # divider and outside post even though the physical rod spans farther.
        hangs = [{"start": rod_start + 0.230, "end": rod_end - 0.230,
                  "y": -0.095, "z": 1.755}]
        shelves = [
            {"min": (-x_outer + 0.055, -y_outer + 0.044),
             "max": (x_outer - 0.055, y_outer - 0.044), "z": 0.201},
            {"min": (left_inner + 0.020, -y_outer + 0.046),
             "max": (right_inner - 0.020, y_outer - 0.046), "z": 0.598},
            {"min": (left_inner + 0.020, -y_outer + 0.046),
             "max": (right_inner - 0.020, y_outer - 0.046), "z": 1.008},
            {"min": (left_inner + 0.020, -y_outer + 0.046),
             "max": (right_inner - 0.020, y_outer - 0.046), "z": 1.418},
        ]
        return hangs, shelves
    layout = millwork_layout(spec)
    clear_width = float(layout["clear_width"])
    divider_thickness = float(layout["divider_thickness"])
    bay_pitch = clear_width + divider_thickness
    bay_centers = tuple(layout["bay_centers"])
    rod_z = 1.655 if spec.key == "luxury" else 1.635
    usable_half = min(clear_width / 2 - 0.10, (bay_pitch - 0.44) / 2)
    hangs = [
        {"start": x - usable_half, "end": x + usable_half, "y": -0.115, "z": rod_z}
        for x in bay_centers
    ]
    shelves: list[dict] = []
    upper_surface = 1.825 if spec.key == "luxury" else 1.785
    lower_surface = 0.485 if spec.key == "luxury" else 0.475
    for x in bay_centers:
        shelves.append({
            "min": (x - clear_width / 2 + 0.050, -(spec.depth - 0.070) / 2 + 0.040),
            "max": (x + clear_width / 2 - 0.050, (spec.depth - 0.070) / 2 - 0.040),
            "z": upper_surface,
        })
    for x in bay_centers:
        shelves.append({
            "min": (x - clear_width / 2 + 0.050, -0.012 - (spec.depth - 0.055) / 2 + 0.040),
            "max": (x + clear_width / 2 - 0.050, -0.012 + (spec.depth - 0.055) / 2 - 0.040),
            "z": lower_surface,
        })
    if spec.key == "high-end":
        for x in bay_centers:
            shelves.append({
                "min": (x - clear_width / 2 + 0.055, -(spec.depth - 0.070) / 2 + 0.040),
                "max": (x + clear_width / 2 - 0.055, (spec.depth - 0.070) / 2 - 0.040),
                "z": 0.215,
            })
    else:
        for x in bay_centers:
            for half in (-1, 1):
                center = x + half * clear_width * 0.245
                shelves.append({
                    "min": (center - clear_width * 0.205, -(spec.depth - 0.070) / 2 + 0.040),
                    "max": (center + clear_width * 0.205, (spec.depth - 0.070) / 2 - 0.040),
                    "z": 0.178,
                })
    return hangs, shelves


def add_functional_nodes(spec: RackSpec, root: bpy.types.Object) -> dict[str, list[str] | str]:
    node_parent = empty("InteractionNodes", parent=root, display="CUBE", size=0.04)
    node_parent["purpose"] = "runtime-merchandise-and-placement-transforms"
    hangs, shelves = zone_layout(spec)
    node_names: list[str] = []
    for index, zone in enumerate(hangs, 1):
        prefix = f"HANG_ZONE_{index:02d}"
        center_x = (zone["start"] + zone["end"]) / 2
        for suffix, x in (("START", zone["start"]), ("END", zone["end"]), ("CENTER", center_x)):
            node = empty(f"{prefix}_{suffix}", (x, zone["y"], zone["z"]),
                         parent=node_parent, display="ARROWS", size=0.075)
            node["zone_type"] = "hanging"
            node["zone_index"] = index
            node["boundary"] = suffix.lower()
            node["merchandise_forward_axis"] = "-Y"
            node["usable_length_m"] = round(zone["end"] - zone["start"], 4)
            node_names.append(node.name)
    shelf_names: list[str] = []
    for index, zone in enumerate(shelves, 1):
        prefix = f"SHELF_ZONE_{index:02d}"
        center = (
            (zone["min"][0] + zone["max"][0]) / 2,
            (zone["min"][1] + zone["max"][1]) / 2,
            zone["z"],
        )
        node = empty(prefix, center, parent=node_parent, display="CUBE", size=0.065)
        node["zone_type"] = "shelf"
        node["zone_index"] = index
        node["merchandise_forward_axis"] = "-Y"
        node["usable_width_m"] = round(zone["max"][0] - zone["min"][0], 4)
        node["usable_depth_m"] = round(zone["max"][1] - zone["min"][1], 4)
        shelf_names.append(node.name)
        for suffix, point in (("MIN", zone["min"]), ("MAX", zone["max"])):
            bound = empty(f"{prefix}_{suffix}", (point[0], point[1], zone["z"]),
                          parent=node_parent, display="SPHERE", size=0.045)
            bound["zone_type"] = "shelf-boundary"
            bound["zone_index"] = index
            bound["boundary"] = suffix.lower()
            shelf_names.append(bound.name)
    interaction = empty("INTERACTION_POINT", (0, -spec.depth / 2 - 0.72, 1.05),
                        parent=node_parent, display="ARROWS", size=0.12)
    interaction["comfortable_distance_m"] = 0.72
    interaction["forward_axis"] = "+Y"
    footprint = empty("PLACEMENT_FOOTPRINT", (0, 0, 0.03), parent=node_parent,
                      display="CUBE", size=1.0)
    footprint.scale = (spec.width / 2, spec.depth / 2, 0.03)
    footprint["width_m"] = spec.width
    footprint["depth_m"] = spec.depth
    footprint["origin"] = "center-floor"
    light_names: list[str] = []
    if spec.key in ("high-end", "luxury"):
        layout = millwork_layout(spec)
        bay_centers = tuple(layout["bay_centers"])
        fixture_z = spec.height - 0.227
        for index, x in enumerate(bay_centers, 1):
            node = empty(f"LIGHT_POINT_{index:02d}", (x, -0.105, fixture_z),
                         parent=node_parent, display="SINGLE_ARROW", size=0.095)
            node.rotation_euler = (math.pi, 0, 0)
            node["light_type"] = "warm-recessed-puck"
            node["kelvin"] = 2850
            # Export data-only attachment nodes.  Runtime instantiation keeps
            # production lighting deterministic and satisfies the repository
            # rule that GLBs contain geometry/metadata, not baked light objects.
            node["runtime_light_kind"] = "spot"
            node["runtime_intensity"] = 2.0110023093544167 if spec.key == "luxury" else 2.5
            node["runtime_color_linear"] = (1.0, 0.72, 0.46)
            node["runtime_distance_m"] = 3.0
            node["runtime_decay"] = 2.0
            node["runtime_angle_rad"] = round(math.radians(72), 6)
            node["runtime_penumbra"] = 0.72
            node["light_offset_m"] = (0.0, 0.0, -0.020)
            node["target_offset_m"] = (
                0.0,
                round(spec.depth * 0.28 + 0.105, 6),
                round(spec.height * 0.55 - fixture_z, 6),
            )
            light_names.append(node.name)
        if spec.key == "luxury":
            for index, x in enumerate(bay_centers, 4):
                source_index = index - 3
                node = empty(f"LIGHT_POINT_{index:02d}", (x, spec.depth / 2 - 0.065, 1.765),
                             parent=node_parent, display="SINGLE_ARROW", size=0.075)
                node.rotation_euler = (math.pi / 2, 0, 0)
                node["light_type"] = "warm-integrated-cove"
                node["kelvin"] = 2750
                node["bay"] = source_index
                node["runtime_light_kind"] = "point"
                node["runtime_intensity"] = 0.3532841922173272
                node["runtime_color_linear"] = (1.0, 0.64, 0.34)
                node["runtime_distance_m"] = 1.35
                node["runtime_decay"] = 2.0
                node["light_offset_m"] = (
                    0.0,
                    round(0.045 - (spec.depth / 2 - 0.065), 6),
                    -0.030,
                )
                light_names.append(node.name)
    return {
        "hangNodes": node_names,
        "shelfNodes": shelf_names,
        "lightNodes": light_names,
        "interactionNode": interaction.name,
        "footprintNode": footprint.name,
    }


def add_collision(spec: RackSpec, root: bpy.types.Object) -> bpy.types.Object:
    collision = box_mesh(spec.collision_name, (spec.width, spec.depth, spec.height),
                         (0, 0, spec.height / 2), MATERIALS["collision"],
                         bevel=0, parent=root, smooth=False)
    collision.display_type = "WIRE"
    collision.hide_render = True
    collision["collision_proxy"] = True
    collision["blocks_player"] = True
    collision["blocks_customers"] = True
    collision["shape"] = "simple-box"
    return collision


def create_asset(spec: RackSpec) -> tuple[bpy.types.Object, list[bpy.types.Object], dict]:
    root = empty(spec.primary_name, (0, 0, 0), display="CUBE", size=0.14)
    root["asset_family"] = "clothing-racks"
    root["tier"] = spec.key
    root["display_name"] = f"{spec.label} Clothing Rack"
    root["dimensions_m"] = [spec.width, spec.height, spec.depth]
    root["unit_system"] = "METERS"
    root["front_axis"] = "-Y"
    root["up_axis"] = "+Z"
    root["origin_convention"] = "footprint-center-floor"
    root["reference_image"] = spec.reference
    root["source_license"] = "project-owned-reference"
    lod_roots: list[bpy.types.Object] = []
    for lod in range(3):
        lod_root = empty(LOD_PREFIX[lod], parent=root, display="CUBE", size=0.10)
        lod_root["lod_level"] = lod
        lod_root["switch_distance_m"] = (0.0, 8.0, 18.0)[lod]
        lod_root.hide_render = lod > 0
        build_geometry(spec, lod, lod_root)
        lod_roots.append(lod_root)
    collision = add_collision(spec, root)
    nodes = add_functional_nodes(spec, root)
    metadata = {
        "nodes": nodes,
        "collision": collision.name,
        "hangZones": len(zone_layout(spec)[0]),
        "shelfZones": len(zone_layout(spec)[1]),
    }
    return root, lod_roots, metadata


def descendants(root: bpy.types.Object) -> list[bpy.types.Object]:
    result: list[bpy.types.Object] = []
    stack = [root]
    while stack:
        item = stack.pop()
        result.append(item)
        stack.extend(item.children)
    return result


def remove_unused_datablocks() -> None:
    for material in list(bpy.data.materials):
        if material.users == 0:
            bpy.data.materials.remove(material)
    for image in list(bpy.data.images):
        if image.users == 0:
            bpy.data.images.remove(image)


def save_source(root: bpy.types.Object, source_path: Path) -> None:
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene["asset_root"] = root.name
    scene["asset_units"] = "meters"
    scene["source_references_are_immutable"] = True
    bpy.context.preferences.filepaths.save_version = 0
    remove_unused_datablocks()
    source_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path), compress=True)
    # Make texture references repository-relative after the blend path exists.
    for image in bpy.data.images:
        repo_path = image.get("source_repo_path")
        if not repo_path:
            continue
        image.filepath = bpy.path.relpath(str(REPO / repo_path))
        image.filepath_raw = image.filepath
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path), compress=True)
    backup_path = Path(str(source_path) + "1")
    if backup_path.exists():
        backup_path.unlink()


def export_glb(root: bpy.types.Object, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in descendants(root):
        obj.hide_set(False)
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
        export_lights=True,
    )


def look_at(obj: bpy.types.Object, target: Sequence[float]) -> None:
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_preview_studio(spec: RackSpec) -> tuple[bpy.types.Object, list[bpy.types.Object]]:
    studio_objects: list[bpy.types.Object] = []
    cream = make_material("PREVIEW_WarmCream", (0.56, 0.52, 0.44, 1), roughness=0.82)
    wall_mat = make_material("PREVIEW_Backdrop", (0.28, 0.29, 0.28, 1), roughness=0.92)
    floor = box_mesh("PREVIEW_Floor", (9.0, 9.0, 0.035), (0, 0, -0.020), cream,
                     bevel=0.006, parent=None, smooth=False)
    backdrop = box_mesh("PREVIEW_Backdrop", (8.5, 0.060, 5.6), (0, spec.depth * 2.0 + 0.70, 2.75),
                        wall_mat, bevel=0.020, parent=None, smooth=False)
    studio_objects.extend((floor, backdrop))
    if spec.key in ("premium",):
        camera_location = (0.28, -4.25, spec.height * 0.66)
    elif spec.key in ("high-end", "luxury"):
        camera_location = (spec.width * 0.62, -5.20, spec.height * 0.70)
    else:
        camera_location = (spec.width * 0.82, -3.10, spec.height * 0.72)
    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.object
    camera.name = "PREVIEW_Camera"
    camera.data.lens = 56
    look_at(camera, (0, 0, spec.height * 0.48))
    studio_objects.append(camera)
    lights = (
        ("PREVIEW_Key", (spec.width * 1.25, -2.4, spec.height * 1.35), 650, 4.0, (1.0, 0.69, 0.42)),
        ("PREVIEW_Fill", (-spec.width * 1.25, -1.2, spec.height * 0.88), 330, 3.5, (0.58, 0.72, 1.0)),
        ("PREVIEW_Rim", (0.0, 1.4, spec.height * 1.25), 500, 3.0, (1.0, 0.47, 0.22)),
    )
    for name, location, energy, size, color in lights:
        data = bpy.data.lights.new(f"{name}_Data", type="AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        data.color = color
        light = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(light)
        light.location = location
        look_at(light, (0, 0, spec.height * 0.52))
        studio_objects.append(light)
    scene = bpy.context.scene
    scene.camera = camera
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except (TypeError, ValueError):
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.image_settings.color_depth = "8"
    scene.world.color = (0.035, 0.035, 0.035)
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    return camera, studio_objects


def render_still(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def qa_shirt(name: str, x: float, y: float, rod_z: float,
             fabric: bpy.types.Material, hanger_material: bpy.types.Material) -> list[bpy.types.Object]:
    created: list[bpy.types.Object] = []
    shoulder_z = rod_z - 0.115
    created.append(tube_between(f"QA_{name}_HangerLeft", (x, y, shoulder_z),
                                (x - 0.165, y, shoulder_z - 0.115), 0.006,
                                hanger_material, vertices=12))
    created.append(tube_between(f"QA_{name}_HangerRight", (x, y, shoulder_z),
                                (x + 0.165, y, shoulder_z - 0.115), 0.006,
                                hanger_material, vertices=12))
    created.append(cylinder(f"QA_{name}_HangerStem", 0.006, 0.115,
                            (x, y, rod_z - 0.055), hanger_material,
                            vertices=12, bevel=0.001))
    outline = (
        (-0.105, 0.0), (-0.210, -0.090), (-0.175, -0.205), (-0.120, -0.165),
        (-0.120, -0.585), (0.120, -0.585), (0.120, -0.165), (0.175, -0.205),
        (0.210, -0.090), (0.105, 0.0),
    )
    thickness = 0.030
    verts = [(x + px, y - thickness / 2, shoulder_z - 0.080 + pz) for px, pz in outline]
    verts += [(x + px, y + thickness / 2, shoulder_z - 0.080 + pz) for px, pz in outline]
    count = len(outline)
    faces: list[tuple[int, ...]] = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    mesh = bpy.data.meshes.new(f"QA_{name}_ShirtMesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    shirt = bpy.data.objects.new(f"QA_{name}_Shirt", mesh)
    bpy.context.collection.objects.link(shirt)
    mesh.materials.append(fabric)
    activate(shirt)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.035)
    bpy.ops.object.mode_set(mode="OBJECT")
    bevel = shirt.modifiers.new("QA_ShirtEdgeSoftening", "BEVEL")
    bevel.width = 0.008
    bevel.segments = 2
    activate(shirt)
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(52))
    except Exception:
        pass
    created.append(shirt)
    return created


def add_qa_merchandise(spec: RackSpec) -> list[bpy.types.Object]:
    green = make_material("M_QA_ValidationGreen", (0.025, 0.185, 0.072, 1), roughness=0.82)
    cream = make_material("M_QA_ValidationCream", (0.72, 0.62, 0.44, 1), roughness=0.86)
    charcoal = make_material("M_QA_HangerMetal", (0.055, 0.060, 0.056, 1),
                             roughness=0.34, metallic=0.78)
    created: list[bpy.types.Object] = []
    hangs, shelves = zone_layout(spec)
    for zone_index, zone in enumerate(hangs, 1):
        usable = zone["end"] - zone["start"]
        count = max(3, min(7, int(usable / 0.145)))
        inset = 0.035
        for item_index in range(count):
            t = item_index / max(1, count - 1)
            x = zone["start"] + inset + (usable - inset * 2) * t
            fabric = green if (item_index + zone_index) % 2 else cream
            created.extend(qa_shirt(f"Hang{zone_index:02d}_{item_index + 1:02d}",
                                    x, zone["y"] - 0.010, zone["z"], fabric, charcoal))
    for shelf_index, zone in enumerate(shelves, 1):
        width = zone["max"][0] - zone["min"][0]
        depth = zone["max"][1] - zone["min"][1]
        center_x = (zone["min"][0] + zone["max"][0]) / 2
        center_y = (zone["min"][1] + zone["max"][1]) / 2
        stack_count = 2 if width > 0.62 else 1
        for stack_index in range(stack_count):
            offset = (stack_index - (stack_count - 1) / 2) * min(0.32, width * 0.34)
            fabric = cream if (shelf_index + stack_index) % 2 else green
            for layer in range(3):
                item = box_mesh(f"QA_Shelf{shelf_index:02d}_Stack{stack_index + 1:02d}_Layer{layer + 1:02d}",
                                (min(0.28, width * 0.55), min(0.22, depth * 0.65), 0.032),
                                (center_x + offset, center_y, zone["z"] + 0.018 + layer * 0.033),
                                fabric, bevel=0.007, grain_axis="X", uv_seed=shelf_index + layer,
                                bevel_segments=2)
                created.append(item)
    return created


def object_bounds(objects: Iterable[bpy.types.Object]) -> dict[str, list[float]]:
    minimum = Vector((float("inf"), float("inf"), float("inf")))
    maximum = Vector((float("-inf"), float("-inf"), float("-inf")))
    found = False
    for obj in objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            minimum.x = min(minimum.x, world.x)
            minimum.y = min(minimum.y, world.y)
            minimum.z = min(minimum.z, world.z)
            maximum.x = max(maximum.x, world.x)
            maximum.y = max(maximum.y, world.y)
            maximum.z = max(maximum.z, world.z)
            found = True
    if not found:
        return {"min": [0, 0, 0], "max": [0, 0, 0], "size": [0, 0, 0]}
    return {
        "min": [round(value, 4) for value in minimum],
        "max": [round(value, 4) for value in maximum],
        "size": [round(maximum[i] - minimum[i], 4) for i in range(3)],
    }


def relative(path: Path) -> str:
    return path.relative_to(REPO).as_posix()


def build_one(spec: RackSpec, texture_paths: dict[str, dict[str, Path] | Path]) -> dict:
    global CURRENT_SPEC, MATERIALS
    CURRENT_SPEC = spec
    clean_scene()
    MATERIALS = build_materials(texture_paths)
    root, lod_roots, metadata = create_asset(spec)
    for obj in descendants(root):
        if obj.type == "MESH":
            if any(abs(value - 1.0) > 1e-5 for value in obj.scale):
                activate(obj)
                bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            if any(abs(value) > 1e-5 for value in obj.rotation_euler):
                activate(obj)
                bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    lod_triangles = [triangle_count(lod_root) for lod_root in lod_roots]
    if not (lod_triangles[0] > lod_triangles[1] > lod_triangles[2]):
        raise RuntimeError(f"{spec.key}: LOD triangle counts are not strictly descending: {lod_triangles}")
    lod_bounds = object_bounds(mesh_objects(lod_roots[0]))
    source_path = SOURCE_ROOT / f"{spec.primary_name}.blend"
    glb_path = EXPORT_ROOT / f"{spec.key}.glb"
    preview_path = PREVIEW_ROOT / f"{spec.key}.png"
    merchandise_path = QA_ROOT / f"{spec.key}-merchandise-validation.png"
    save_source(root, source_path)
    export_glb(root, glb_path)
    add_preview_studio(spec)
    render_still(preview_path)
    qa_objects = add_qa_merchandise(spec)
    render_still(merchandise_path)
    record = {
        "id": f"clothing-racks:{spec.key}",
        "tier": spec.key,
        "label": f"{spec.label} Clothing Rack",
        "primaryObject": spec.primary_name,
        "reference": spec.reference,
        "dimensionsM": [spec.width, spec.height, spec.depth],
        "origin": [0, 0, 0],
        "frontAxis": "-Y",
        "source": relative(source_path),
        "glb": relative(glb_path),
        "preview": relative(preview_path),
        "merchandiseValidationPreview": relative(merchandise_path),
        "collision": metadata["collision"],
        "hangZoneCount": metadata["hangZones"],
        "shelfZoneCount": metadata["shelfZones"],
        "nodes": metadata["nodes"],
        "lodTriangles": {"LOD0": lod_triangles[0], "LOD1": lod_triangles[1], "LOD2": lod_triangles[2]},
        "lodDistancesM": {"LOD0": 0, "LOD1": 8, "LOD2": 18},
        "lod0BoundsM": lod_bounds,
        "sourceObjectCount": len(descendants(root)),
        "sourceMeshCount": len(mesh_objects(root)),
        "glbBytes": glb_path.stat().st_size,
        "materials": sorted({mat.name for obj in mesh_objects(root) for mat in obj.data.materials if mat}),
        "textures": sorted({
            image.get("source_repo_path")
            for material in bpy.data.materials if material.use_nodes
            for node in material.node_tree.nodes if node.type == "TEX_IMAGE" and node.image
            for image in (node.image,) if image.get("source_repo_path")
        }),
        "qaTemporaryMerchandiseObjectCount": len(qa_objects),
    }
    return record


def write_manifest(records: list[dict]) -> None:
    payload = {
        "assetFamily": "Pinehollow Clothing Racks",
        "generator": "tools/blender/build_clothing_racks.py",
        "blenderVersion": bpy.app.version_string,
        "units": "meters",
        "orientation": {"up": "+Z", "front": "-Y", "origin": "footprint center at floor"},
        "externalAssets": [],
        "externalTextures": [],
        "license": "Original project-owned procedural geometry and textures; project-owned design references only.",
        "textures": sorted(relative(path) for path in TEXTURE_ROOT.glob("*.png")),
        "assets": records,
    }
    MANIFEST_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    report_path = QA_ROOT / "build-report.json"
    report_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    ensure_directories()
    texture_paths = generate_textures()
    records: list[dict] = []
    for spec in SPECS:
        print(f"[clothing-racks] building {spec.label}", flush=True)
        records.append(build_one(spec, texture_paths))
        print(
            f"[clothing-racks] {spec.key}: "
            f"{records[-1]['lodTriangles']} -> {records[-1]['glb']}",
            flush=True,
        )
    write_manifest(records)
    summary = {
        "built": len(records),
        "manifest": relative(MANIFEST_PATH),
        "sources": [record["source"] for record in records],
        "exports": [record["glb"] for record in records],
        "previews": [record["preview"] for record in records],
    }
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == "__main__":
    main()
