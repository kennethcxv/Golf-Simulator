"""Build Golf Flipper's five original progression-tier golf carts.

Run from the repository root with Blender 5.1:

  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
      --factory-startup --python tools/blender/build_golf_carts.py

The source references are owner-supplied images in Designs/Golf_Carts.  Geometry,
materials, hierarchy, collisions, anchors, and preview staging are authored here
from scratch.  No external models, textures, brands, or downloaded assets are used.
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import bpy
import bmesh
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from golf_cart_lib import (
    apply_mesh,
    assign,
    beam,
    box,
    curve_tube,
    cylinder,
    descendants,
    empty,
    export_root,
    join_meshes,
    loft_solid,
    look_at,
    material,
    mesh_bounds,
    parent_keep,
    remove_qa_objects,
    reset_scene,
    setup_studio,
    smart_uv,
    torus,
    triangle_count,
    uv_sphere,
)


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "asset_sources" / "blender" / "golf_carts"
EXPORT_DIR = ROOT / "vendor" / "models" / "golf_carts"
CONFIG_DIR = EXPORT_DIR / "config"
QA_DIR = ROOT / "qa" / "golf-carts" / "blender" / "iteration-04"
REFERENCE_DIR = ROOT / "Designs" / "Golf_Carts"
TEXTURE_DIR = ROOT / "asset_sources" / "textures" / "golf_carts"
BUILD_VERSION = "2.4.0-runtime-door-batching"

for folder in (SOURCE_DIR, EXPORT_DIR, CONFIG_DIR, QA_DIR, TEXTURE_DIR):
    folder.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True)
class CartSpec:
    slug: str
    asset_id: str
    label: str
    reference_file: str
    width: float
    length: float
    height: float
    wheelbase: float
    wheel_radius: float
    wheel_width: float
    passenger_capacity: int
    body_color: str
    canopy_color: str
    seat_color: str
    body_roughness: float
    body_metallic: float
    wheel_style: str
    trim_level: int
    roof_length: float
    seat_rows: tuple[dict[str, Any], ...]
    rear_layout: str
    split_windshield: bool = False
    luxury_doors: bool = False

    @property
    def body_width(self) -> float:
        return self.width - self.wheel_width * 0.48

    @property
    def front_wheel_y(self) -> float:
        return self.wheelbase * 0.5

    @property
    def rear_wheel_y(self) -> float:
        return -self.wheelbase * 0.5

    @property
    def wheel_x(self) -> float:
        return (self.width - self.wheel_width) * 0.5

    @property
    def front_end_y(self) -> float:
        return self.length * 0.5

    @property
    def rear_end_y(self) -> float:
        return -self.length * 0.5


SPECS = (
    CartSpec(
        slug="basic",
        asset_id="GolfCart_Basic",
        label="Basic Golf Cart",
        reference_file="ChatGPT Image Jul 21, 2026, 09_05_08 PM (1).png",
        width=1.20,
        length=2.38,
        height=1.78,
        wheelbase=1.62,
        wheel_radius=0.285,
        wheel_width=0.165,
        passenger_capacity=2,
        body_color="02120A",
        canopy_color="B9A77F",
        seat_color="5C4A33",
        body_roughness=0.44,
        body_metallic=0.10,
        wheel_style="steel",
        trim_level=1,
        roof_length=1.82,
        seat_rows=({"y": -0.14, "facing": 1, "names": ("Seat_Driver", "Seat_Passenger_Front")},),
        rear_layout="bag_rack",
        split_windshield=True,
    ),
    CartSpec(
        slug="standard",
        asset_id="GolfCart_Standard",
        label="Standard Golf Cart",
        reference_file="ChatGPT Image Jul 21, 2026, 09_05_09 PM (2).png",
        width=1.23,
        length=2.49,
        height=1.81,
        wheelbase=1.70,
        wheel_radius=0.292,
        wheel_width=0.17,
        passenger_capacity=2,
        body_color="5A4028",
        canopy_color="B8A57C",
        seat_color="040505",
        body_roughness=0.40,
        body_metallic=0.08,
        wheel_style="fleet_alloy",
        trim_level=2,
        roof_length=1.95,
        seat_rows=({"y": -0.10, "facing": 1, "names": ("Seat_Driver", "Seat_Passenger_Front")},),
        rear_layout="utility_bin",
        split_windshield=True,
    ),
    CartSpec(
        slug="premium",
        asset_id="GolfCart_Premium",
        label="Premium Golf Cart",
        reference_file="ChatGPT Image Jul 21, 2026, 09_05_09 PM (3).png",
        width=1.27,
        length=3.08,
        height=1.86,
        wheelbase=2.00,
        wheel_radius=0.305,
        wheel_width=0.18,
        passenger_capacity=4,
        body_color="030506",
        canopy_color="030405",
        seat_color="0B0E0D",
        body_roughness=0.34,
        body_metallic=0.16,
        wheel_style="eight_spoke",
        trim_level=3,
        roof_length=2.58,
        seat_rows=(
            {"y": 0.22, "facing": 1, "names": ("Seat_Driver", "Seat_Passenger_Front")},
            {"y": -0.92, "facing": -1, "names": ("Seat_Passenger_Rear_Left", "Seat_Passenger_Rear_Right")},
        ),
        rear_layout="rear_facing_bench",
    ),
    CartSpec(
        slug="high_end",
        asset_id="GolfCart_HighEnd",
        label="High-End Golf Cart",
        reference_file="ChatGPT Image Jul 21, 2026, 09_05_09 PM (4).png",
        width=1.30,
        length=3.19,
        height=1.89,
        wheelbase=2.08,
        wheel_radius=0.318,
        wheel_width=0.185,
        passenger_capacity=4,
        body_color="01091B",
        canopy_color="030405",
        seat_color="0E1210",
        body_roughness=0.33,
        body_metallic=0.24,
        wheel_style="split_spoke",
        trim_level=4,
        roof_length=2.72,
        seat_rows=(
            {"y": 0.39, "facing": 1, "names": ("Seat_Driver", "Seat_Passenger_Front")},
            {"y": -0.74, "facing": 1, "names": ("Seat_Passenger_Rear_Left", "Seat_Passenger_Rear_Right")},
        ),
        rear_layout="lithium_storage",
    ),
    CartSpec(
        slug="luxury",
        asset_id="GolfCart_Luxury",
        label="Luxury Golf Cart",
        reference_file="ChatGPT Image Jul 21, 2026, 09_05_09 PM (5).png",
        width=1.38,
        length=3.96,
        height=1.95,
        wheelbase=2.66,
        wheel_radius=0.335,
        wheel_width=0.19,
        passenger_capacity=6,
        # Preserve a visibly black finish while leaving enough value range for
        # the game's restrained outdoor lighting to reveal the body surfacing.
        body_color="0A1110",
        canopy_color="0D1412",
        seat_color="171E1B",
        body_roughness=0.32,
        body_metallic=0.28,
        wheel_style="luxury_multi_spoke",
        trim_level=5,
        roof_length=3.55,
        seat_rows=(
            {"y": 0.93, "facing": 1, "names": ("Seat_Driver", "Seat_Passenger_Front")},
            {"y": -0.18, "facing": 1, "names": ("Seat_Passenger_Middle_Left", "Seat_Passenger_Middle_Right")},
            {"y": -1.30, "facing": 1, "names": ("Seat_Passenger_Rear_Left", "Seat_Passenger_Rear_Right")},
        ),
        rear_layout="resort_luggage",
        luxury_doors=True,
    ),
)


def set_scene_contract() -> None:
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    scene["golf_cart_build_script"] = Path(__file__).relative_to(ROOT).as_posix()
    scene["golf_cart_build_version"] = BUILD_VERSION
    scene["source_license"] = "Original project-authored geometry; project-owned / UNLICENSED"


def authored_texture(
    spec: CartSpec,
    role: str,
    *,
    width: int = 128,
    height: int = 128,
    base: float = 0.5,
    amplitude: float = 0.08,
    normal_map: bool = False,
) -> tuple[bpy.types.Image, Path]:
    """Create a small deterministic project-owned material map on disk.

    The reference brief asks for subtle close-range normal/roughness variation
    and reproducible texture deliverables. These maps contain no third-party or
    generated imagery: they are mathematical tile fields authored by this build.
    """
    image_name = f"T_{spec.asset_id}_{role}"
    image = bpy.data.images.new(image_name, width=width, height=height, alpha=False, float_buffer=False)
    pixels: list[float] = []
    seed = sum(ord(character) for character in f"{spec.slug}:{role}") * 0.0137
    for py in range(height):
        v = py / max(1, height - 1)
        for px in range(width):
            u = px / max(1, width - 1)
            fine = math.sin((u * 29.0 + v * 17.0 + seed) * math.tau)
            broad = math.sin((u * 5.0 - v * 7.0 + seed * 0.31) * math.tau)
            weave = math.sin((u + v) * 41.0 * math.pi + seed) * math.sin((u - v) * 37.0 * math.pi - seed)
            if normal_map:
                nx = 0.5 + amplitude * (fine * 0.55 + weave * 0.45)
                ny = 0.5 + amplitude * (broad * 0.55 - weave * 0.45)
                nz = math.sqrt(max(0.0, 1.0 - min(0.18, (nx - 0.5) ** 2 + (ny - 0.5) ** 2)))
                pixels.extend((nx, ny, nz, 1.0))
            else:
                value = max(0.04, min(0.96, base + amplitude * (fine * 0.42 + broad * 0.28 + weave * 0.30)))
                pixels.extend((value, value, value, 1.0))
    image.pixels.foreach_set(pixels)
    image.colorspace_settings.name = "Non-Color"
    path = TEXTURE_DIR / f"golf_cart_{spec.slug}_{role}.png"
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    image["source"] = "Deterministic project-authored mathematical texture"
    image["license"] = "project-owned / UNLICENSED"
    return image, path


def connect_roughness_map(mat: bpy.types.Material, image: bpy.types.Image) -> None:
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    if not bsdf:
        return
    tex = nodes.new("ShaderNodeTexImage")
    tex.name = f"{mat.name}_AuthoredRoughness"
    tex.label = "Project-authored roughness"
    tex.image = image
    tex.interpolation = "Linear"
    tex.extension = "REPEAT"
    links.new(tex.outputs["Color"], bsdf.inputs["Roughness"])


def connect_normal_map(mat: bpy.types.Material, image: bpy.types.Image, strength: float) -> None:
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    if not bsdf:
        return
    tex = nodes.new("ShaderNodeTexImage")
    tex.name = f"{mat.name}_AuthoredNormal"
    tex.label = "Project-authored tangent normal"
    tex.image = image
    tex.interpolation = "Linear"
    tex.extension = "REPEAT"
    normal = nodes.new("ShaderNodeNormalMap")
    normal.name = f"{mat.name}_NormalStrength"
    normal.inputs["Strength"].default_value = strength
    links.new(tex.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])


def make_materials(spec: CartSpec) -> dict[str, bpy.types.Material]:
    body = material(
        f"M_{spec.asset_id}_BodyPaint",
        spec.body_color,
        spec.body_roughness,
        spec.body_metallic,
    )
    body["material_role"] = "painted_body_panel"
    canopy = material(f"M_{spec.asset_id}_Canopy", spec.canopy_color, 0.58 if spec.trim_level < 3 else 0.38, 0.04)
    canopy["material_role"] = "molded_canopy"
    seat = material(f"M_{spec.asset_id}_Seat", spec.seat_color, 0.72 if spec.trim_level < 3 else 0.52, 0.0)
    seat["material_role"] = "vinyl_or_leather_like_upholstery"
    mats = {
        "body": body,
        # Moving Luxury door panels use the same authored PBR values without
        # texture samplers so runtime vertex-PBR batching can collapse each
        # complete opaque door leaf to one draw while the static body retains
        # the project-authored normal and roughness maps.
        "body_untextured": material(
            f"M_{spec.asset_id}_DoorBody",
            spec.body_color,
            spec.body_roughness,
            spec.body_metallic,
        ),
        "canopy": canopy,
        "seat": seat,
        "seat_seam": material(
            f"M_{spec.asset_id}_SeatStitch",
            "343C38" if spec.trim_level >= 3 else "17140E",
            0.78,
            0.0,
        ),
        "seat_piping": material(
            f"M_{spec.asset_id}_SeatPiping",
            "171C19" if spec.trim_level >= 3 else "0B0906",
            0.62,
            0.0,
        ),
        "body_shadow": material(f"M_{spec.asset_id}_BodyShadow", "020503" if spec.slug == "basic" else "020203", 0.42, 0.18),
        "roof_underside": material(f"M_{spec.asset_id}_RoofUnderside", "10130F" if spec.trim_level < 3 else "121716", 0.72, 0.08),
        "charcoal": material("M_GF_WarmCharcoal", "0E1210", 0.58, 0.28),
        "black_plastic": material("M_GF_MoldedBlackPlastic", "050806", 0.72, 0.02),
        "frame": material("M_GF_PowderCoatedFrame", "050806", 0.48, 0.55),
        "rubber": material("M_GF_TireRubber", "010101", 0.90, 0.0),
        "undercarriage": material("M_GF_Undercarriage", "020302", 0.78, 0.42),
        "steel": material("M_GF_BrushedSteel", "8F9695", 0.38, 0.78),
        "alloy": material("M_GF_WheelAlloy", "A9ADAA", 0.25, 0.88),
        "alloy_dark": material("M_GF_DarkMachinedAlloy", "060707", 0.25, 0.82),
        "storage_liner": material("M_GF_StorageLiner", "151A18", 0.70, 0.05),
        "brass": material("M_GF_RestrainedBrass", "9B7D43", 0.32, 0.72),
        "glass": material(
            "M_GF_WindshieldGlass",
            "B8D0D2",
            0.14,
            0.03,
            alpha=0.17 if spec.slug == "luxury" else 0.24,
            transmission=0.86 if spec.slug == "luxury" else 0.78,
        ),
        "mirror": material("M_GF_MirrorDark", "394044", 0.16, 0.82),
        "battery": material("M_GF_BatteryCase", "252B29", 0.62, 0.12),
        "battery_cap": material("M_GF_BatteryCap", "6D2D24", 0.48, 0.12),
        "copper": material("M_GF_CopperConnector", "8A572F", 0.34, 0.74),
        "display": material("M_GF_InstrumentDisplay", "183034", 0.24, 0.16, emission="5B9E98", emission_strength=0.12),
        "instrument": material("M_GF_InstrumentLens", "7F999B", 0.30, 0.08, emission="78999B", emission_strength=0.05),
        "headlight": material("M_GF_HeadlightLens", "EDE3C5", 0.20, 0.08, emission="F9E7B1", emission_strength=0.22),
        "tail": material("M_GF_TailLens", "8E1F20", 0.28, 0.08, emission="B12B2D", emission_strength=0.18),
        "amber": material("M_GF_IndicatorLens", "D8892D", 0.28, 0.08, emission="E79A35", emission_strength=0.16),
        "collision": material("M_GF_CollisionProxy", "C84D49", 1.0, 0.0),
    }
    paint_roughness, paint_path = authored_texture(
        spec,
        "paint_roughness",
        base=spec.body_roughness,
        amplitude=0.028 if spec.trim_level < 3 else 0.018,
    )
    upholstery_roughness, upholstery_roughness_path = authored_texture(
        spec,
        "upholstery_roughness",
        base=0.70 if spec.trim_level < 3 else 0.54,
        amplitude=0.065,
    )
    upholstery_normal, upholstery_normal_path = authored_texture(
        spec,
        "upholstery_normal",
        normal_map=True,
        amplitude=0.025 if spec.trim_level < 3 else 0.018,
    )
    connect_roughness_map(body, paint_roughness)
    connect_roughness_map(seat, upholstery_roughness)
    connect_normal_map(seat, upholstery_normal, 0.24 if spec.trim_level < 3 else 0.16)
    body["texture_sources"] = json.dumps([paint_path.relative_to(ROOT).as_posix()])
    seat["texture_sources"] = json.dumps([
        upholstery_roughness_path.relative_to(ROOT).as_posix(),
        upholstery_normal_path.relative_to(ROOT).as_posix(),
    ])
    return mats


def component_group(name: str, vehicle_root: bpy.types.Object, role: str) -> bpy.types.Object:
    return empty(name, parent=vehicle_root, props={"component_group": role})


def mark_lod(obj: bpy.types.Object, level: int) -> bpy.types.Object:
    obj["lod_level"] = level
    if level > 0:
        obj.hide_render = True
    return obj


def front_panel(
    name: str,
    outline_xz: list[tuple[float, float]],
    y: float,
    depth: float,
    mat: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    bevel: float = 0.0,
    props: dict[str, Any] | None = None,
) -> bpy.types.Object:
    """Create a clean, bevelled panel whose face lies in the vehicle X/Z plane.

    Golf-cart lamps and grilles are visibly trapezoidal in the supplied references.
    A purpose-built prism keeps those signatures project-authored and avoids the
    generic rounded boxes that made the first fleet read as five recolours.
    """
    half_depth = depth * 0.5
    vertices = [
        (x, y - half_depth, z) for x, z in outline_xz
    ] + [
        (x, y + half_depth, z) for x, z in outline_xz
    ]
    count = len(outline_xz)
    faces: list[tuple[int, ...]] = [
        tuple(reversed(range(count))),
        tuple(count + index for index in range(count)),
    ]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, following, count + following, count + index))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign(obj, mat)
    apply_mesh(obj, bevel=bevel, segments=3, smooth=True)
    smart_uv(obj)
    parent_keep(obj, parent)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def mirrored_outline(
    center_x: float,
    half_width: float,
    z_low: float,
    z_high: float,
    *,
    inner_taper: float = 0.0,
    outer_taper: float = 0.0,
) -> list[tuple[float, float]]:
    """Return a four-corner swept lamp outline around ``center_x``."""
    sign = -1.0 if center_x < 0 else 1.0
    inner_x = center_x - sign * half_width
    outer_x = center_x + sign * half_width
    return [
        (inner_x + sign * inner_taper, z_low),
        (outer_x - sign * outer_taper, z_low + 0.012),
        (outer_x, z_high - 0.018),
        (inner_x, z_high),
    ]


def create_collision(
    name: str,
    dimensions,
    location,
    parent: bpy.types.Object,
    mats: dict[str, bpy.types.Material],
    purpose: str,
) -> bpy.types.Object:
    obj = box(
        name,
        dimensions,
        location,
        mat=mats["collision"],
        parent=parent,
        props={
            "collision_proxy": True,
            "collision_shape": "box",
            "collision_purpose": purpose,
            "owns_navigation_collision": False,
            "structural_collision": False,
        },
    )
    obj.display_type = "WIRE"
    obj.hide_render = True
    return obj


def add_anchor(
    parent: bpy.types.Object,
    name: str,
    location,
    *,
    rotation=(0.0, 0.0, 0.0),
    kind: str,
    size: float = 0.075,
) -> bpy.types.Object:
    return empty(
        name,
        location,
        rotation,
        parent,
        size=size,
        props={"anchor_kind": kind, "forward_axis_blender": "+Y", "forward_axis_runtime": "-Z"},
    )


def add_fender_arch(
    name: str,
    x: float,
    wheel_y: float,
    radius: float,
    mats: dict[str, bpy.types.Material],
    parent: bpy.types.Object,
) -> bpy.types.Object:
    points = []
    for index in range(9):
        angle = math.radians(12 + index * 19.5)
        points.append((x, wheel_y + math.cos(angle) * radius * 1.19, radius + math.sin(angle) * radius * 1.18))
    return curve_tube(
        name,
        points,
        0.032,
        mats["body"],
        parent=parent,
        resolution=1,
        bevel_resolution=2,
        props={"component": "fender_arch_trim", "lod_level": 0},
    )


def build_undercarriage(
    spec: CartSpec,
    groups: dict[str, bpy.types.Object],
    mats: dict[str, bpy.types.Material],
) -> None:
    parent = groups["undercarriage"]
    frame_width = spec.body_width * 0.68
    rail_x = frame_width * 0.42
    for side, x in (("L", -rail_x), ("R", rail_x)):
        mark_lod(box(
            f"FrameRail_{side}",
            (0.075, spec.length * 0.74, 0.11),
            (x, -0.02, 0.34),
            mat=mats["frame"],
            bevel=0.018,
            parent=parent,
        ), 0)
    for index, y in enumerate((-spec.wheelbase * 0.35, 0.0, spec.wheelbase * 0.35)):
        mark_lod(box(
            f"FrameCrossmember_{index + 1:02d}",
            (frame_width, 0.085, 0.09),
            (0.0, y, 0.34),
            mat=mats["frame"],
            bevel=0.014,
            parent=parent,
        ), 0)
    for label, y in (("Front", spec.front_wheel_y), ("Rear", spec.rear_wheel_y)):
        mark_lod(cylinder(
            f"{label}Axle",
            0.047,
            spec.width * 0.82,
            (0.0, y, spec.wheel_radius),
            rotation=(0.0, math.pi / 2, 0.0),
            mat=mats["undercarriage"],
            vertices=14,
            parent=parent,
        ), 0)
    battery_y = -0.28 if spec.passenger_capacity <= 2 else -0.12
    mark_lod(box(
        "BatteryHousing",
        (spec.body_width * 0.72, 0.62 if spec.trim_level < 4 else 0.74, 0.26),
        (0.0, battery_y, 0.43),
        mat=mats["undercarriage"],
        bevel=0.045,
        parent=parent,
        props={"component": "battery_housing", "battery_type": "lithium" if spec.trim_level >= 4 else "electric_bank"},
    ), 0)
    mark_lod(cylinder(
        "RearElectricMotor",
        0.16 if spec.trim_level < 4 else 0.19,
        spec.body_width * 0.50,
        (0.0, spec.rear_wheel_y + 0.10, spec.wheel_radius + 0.02),
        rotation=(0.0, math.pi / 2, 0.0),
        mat=mats["undercarriage"],
        vertices=18,
        bevel=0.012,
        parent=parent,
    ), 0)
    for index, (x, y, lean) in enumerate((
        (-spec.wheel_x * 0.72, spec.front_wheel_y - 0.08, -0.09),
        (spec.wheel_x * 0.72, spec.front_wheel_y - 0.08, 0.09),
        (-spec.wheel_x * 0.72, spec.rear_wheel_y + 0.08, -0.09),
        (spec.wheel_x * 0.72, spec.rear_wheel_y + 0.08, 0.09),
    )):
        mark_lod(beam(
            f"ShockAbsorber_{index + 1:02d}",
            (x, y, spec.wheel_radius + 0.02),
            (x + lean, y + (-0.08 if y > 0 else 0.08), spec.wheel_radius + 0.34),
            0.028,
            mats["steel"],
            vertices=10,
            parent=parent,
        ), 0)


def body_sections(spec: CartSpec) -> list[dict[str, float]]:
    rear = spec.rear_end_y + 0.13
    front = spec.front_end_y - 0.12
    dash = float(spec.seat_rows[0]["y"]) + 0.58
    if spec.slug == "basic":
        return [
            {"y": rear, "width": spec.body_width * 0.78, "z_min": 0.31, "z_max": 0.69, "exponent": 3.2},
            {"y": rear + 0.20, "width": spec.body_width * 0.98, "z_min": 0.29, "z_max": 0.76, "exponent": 4.8},
            {"y": -0.26, "width": spec.body_width, "z_min": 0.28, "z_max": 0.78, "exponent": 5.2},
            {"y": dash - 0.08, "width": spec.body_width * 0.98, "z_min": 0.28, "z_max": 0.77, "exponent": 5.0},
            {"y": front - 0.26, "width": spec.body_width * 0.90, "z_min": 0.31, "z_max": 0.70, "exponent": 3.8},
            {"y": front, "width": spec.body_width * 0.72, "z_min": 0.37, "z_max": 0.61, "exponent": 3.0},
        ]
    if spec.slug == "standard":
        return [
            {"y": rear, "width": spec.body_width * 0.82, "z_min": 0.30, "z_max": 0.72, "exponent": 3.6},
            {"y": rear + 0.24, "width": spec.body_width, "z_min": 0.28, "z_max": 0.79, "exponent": 5.4},
            {"y": -0.20, "width": spec.body_width, "z_min": 0.28, "z_max": 0.80, "exponent": 5.6},
            {"y": dash + 0.02, "width": spec.body_width * 0.99, "z_min": 0.29, "z_max": 0.78, "exponent": 5.2},
            {"y": front - 0.23, "width": spec.body_width * 0.88, "z_min": 0.33, "z_max": 0.68, "exponent": 3.8},
            {"y": front, "width": spec.body_width * 0.70, "z_min": 0.39, "z_max": 0.60, "exponent": 3.0},
        ]
    if spec.slug == "premium":
        return [
            {"y": rear, "width": spec.body_width * 0.84, "z_min": 0.32, "z_max": 0.68, "exponent": 4.0},
            {"y": rear + 0.26, "width": spec.body_width, "z_min": 0.29, "z_max": 0.77, "exponent": 5.8},
            {"y": -0.72, "width": spec.body_width, "z_min": 0.28, "z_max": 0.79, "exponent": 6.0},
            {"y": 0.18, "width": spec.body_width * 1.01, "z_min": 0.28, "z_max": 0.80, "exponent": 5.8},
            {"y": dash + 0.10, "width": spec.body_width * 0.96, "z_min": 0.30, "z_max": 0.76, "exponent": 5.0},
            {"y": front - 0.18, "width": spec.body_width * 0.78, "z_min": 0.38, "z_max": 0.62, "exponent": 3.4},
            {"y": front, "width": spec.body_width * 0.62, "z_min": 0.42, "z_max": 0.57, "exponent": 2.8},
        ]
    if spec.slug == "high_end":
        return [
            {"y": rear, "width": spec.body_width * 0.86, "z_min": 0.31, "z_max": 0.70, "exponent": 4.0},
            {"y": rear + 0.25, "width": spec.body_width, "z_min": 0.28, "z_max": 0.78, "exponent": 5.8},
            {"y": -0.72, "width": spec.body_width * 1.01, "z_min": 0.27, "z_max": 0.80, "exponent": 6.0},
            {"y": 0.35, "width": spec.body_width * 1.01, "z_min": 0.28, "z_max": 0.81, "exponent": 5.8},
            {"y": dash + 0.10, "width": spec.body_width * 0.97, "z_min": 0.31, "z_max": 0.77, "exponent": 5.0},
            {"y": front - 0.18, "width": spec.body_width * 0.80, "z_min": 0.38, "z_max": 0.63, "exponent": 3.6},
            {"y": front, "width": spec.body_width * 0.64, "z_min": 0.42, "z_max": 0.58, "exponent": 3.0},
        ]
    return [
        {"y": rear, "width": spec.body_width * 0.91, "z_min": 0.30, "z_max": 0.73, "exponent": 5.0},
        {"y": rear + 0.20, "width": spec.body_width, "z_min": 0.28, "z_max": 0.80, "exponent": 6.0},
        {"y": -1.28, "width": spec.body_width, "z_min": 0.27, "z_max": 0.82, "exponent": 6.0},
        {"y": -0.18, "width": spec.body_width, "z_min": 0.27, "z_max": 0.82, "exponent": 6.0},
        {"y": 0.92, "width": spec.body_width, "z_min": 0.27, "z_max": 0.82, "exponent": 6.0},
        {"y": dash + 0.10, "width": spec.body_width * 0.96, "z_min": 0.31, "z_max": 0.79, "exponent": 5.2},
        {"y": front - 0.18, "width": spec.body_width * 0.80, "z_min": 0.39, "z_max": 0.64, "exponent": 3.6},
        {"y": front, "width": spec.body_width * 0.66, "z_min": 0.43, "z_max": 0.59, "exponent": 3.0},
    ]


def hood_sections(spec: CartSpec) -> list[dict[str, float]]:
    """Reference-derived front shell: fleet, sport, premium, and shuttle noses."""
    dash_y = dashboard_y(spec)
    hood_front = spec.front_end_y - 0.10
    if spec.slug == "basic":
        return [
            {"y": dash_y - 0.08, "width": spec.body_width * 0.84, "z_min": 0.58, "z_max": 0.89, "exponent": 5.2},
            {"y": dash_y + 0.18, "width": spec.body_width * 0.96, "z_min": 0.54, "z_max": 0.92, "exponent": 4.8},
            {"y": hood_front - 0.30, "width": spec.body_width * 0.92, "z_min": 0.50, "z_max": 0.84, "exponent": 4.0},
            {"y": hood_front, "width": spec.body_width * 0.86, "z_min": 0.52, "z_max": 0.70, "exponent": 3.2},
        ]
    if spec.slug == "standard":
        return [
            {"y": dash_y - 0.08, "width": spec.body_width * 0.86, "z_min": 0.59, "z_max": 0.91, "exponent": 5.4},
            {"y": dash_y + 0.20, "width": spec.body_width * 0.98, "z_min": 0.54, "z_max": 0.94, "exponent": 5.0},
            {"y": hood_front - 0.28, "width": spec.body_width * 0.94, "z_min": 0.49, "z_max": 0.85, "exponent": 4.0},
            {"y": hood_front, "width": spec.body_width * 0.88, "z_min": 0.52, "z_max": 0.68, "exponent": 3.2},
        ]
    if spec.slug in {"premium", "high_end"}:
        crown = 0.94 if spec.slug == "high_end" else 0.92
        return [
            {"y": dash_y - 0.09, "width": spec.body_width * 0.82, "z_min": 0.60, "z_max": crown, "exponent": 5.8},
            {"y": dash_y + 0.20, "width": spec.body_width * 0.98, "z_min": 0.53, "z_max": crown + 0.03, "exponent": 5.4},
            {"y": hood_front - 0.34, "width": spec.body_width * 0.96, "z_min": 0.48, "z_max": 0.86, "exponent": 4.6},
            {"y": hood_front - 0.08, "width": spec.body_width * 0.82, "z_min": 0.50, "z_max": 0.73, "exponent": 3.6},
            {"y": hood_front, "width": spec.body_width * 0.88, "z_min": 0.53, "z_max": 0.66, "exponent": 3.2},
        ]
    return [
        {"y": dash_y - 0.10, "width": spec.body_width * 0.84, "z_min": 0.61, "z_max": 0.96, "exponent": 5.8},
        {"y": dash_y + 0.22, "width": spec.body_width, "z_min": 0.53, "z_max": 0.98, "exponent": 5.6},
        {"y": hood_front - 0.34, "width": spec.body_width * 0.98, "z_min": 0.46, "z_max": 0.87, "exponent": 4.8},
        {"y": hood_front - 0.08, "width": spec.body_width * 0.84, "z_min": 0.48, "z_max": 0.74, "exponent": 3.8},
        {"y": hood_front, "width": spec.body_width * 0.90, "z_min": 0.52, "z_max": 0.66, "exponent": 3.2},
    ]


def driver_row(spec: CartSpec) -> dict[str, Any]:
    return spec.seat_rows[0]


def dashboard_y(spec: CartSpec) -> float:
    return float(driver_row(spec)["y"]) + 0.58


def build_body(
    spec: CartSpec,
    groups: dict[str, bpy.types.Object],
    mats: dict[str, bpy.types.Material],
) -> None:
    body_parent = groups["body"]
    mark_lod(loft_solid(
        "Body",
        body_sections(spec),
        mats["body"],
        radial_segments=20 if spec.trim_level >= 4 else 16,
        bevel=0.012,
        parent=body_parent,
        props={"component": "lower_body_tub"},
    ), 0)
    dash_y = dashboard_y(spec)
    mark_lod(loft_solid(
        "FrontBody",
        hood_sections(spec),
        mats["body"],
        radial_segments=20 if spec.trim_level >= 3 else 16,
        bevel=0.010,
        parent=body_parent,
        props={"component": "front_hood_shell"},
    ), 0)
    mark_lod(box(
        "Floorboard",
        (spec.body_width * 0.91, max(0.74, dash_y - (spec.rear_end_y + 0.55)), 0.075),
        (0.0, (dash_y + spec.rear_end_y + 0.55) * 0.5, 0.48),
        mat=mats["charcoal"],
        bevel=0.025,
        parent=body_parent,
    ), 0)
    wheel_clearance = spec.wheel_radius * 1.28
    skirt_spans = (
        ("Front", spec.front_wheel_y + wheel_clearance, spec.front_end_y - 0.06),
        ("Center", spec.rear_wheel_y + wheel_clearance, spec.front_wheel_y - wheel_clearance),
        ("Rear", spec.rear_end_y + 0.06, spec.rear_wheel_y - wheel_clearance),
    )
    for side, x in (("L", -spec.body_width * 0.51), ("R", spec.body_width * 0.51)):
        for span_name, y_start, y_end in skirt_spans:
            span_length = y_end - y_start
            if span_length <= 0.04:
                continue
            mark_lod(box(
                f"SideSkirt_{span_name}_{side}",
                (0.055, span_length, 0.13),
                (x, (y_start + y_end) * 0.5, 0.43),
                mat=mats["charcoal"],
                bevel=0.024,
                parent=body_parent,
            ), 0)
        add_fender_arch(f"FrontFenderTrim_{side}", x, spec.front_wheel_y, spec.wheel_radius, mats, body_parent)
        add_fender_arch(f"RearFenderTrim_{side}", x, spec.rear_wheel_y, spec.wheel_radius, mats, body_parent)
    mark_lod(box(
        "FrontBumper",
        (spec.width * 0.94, 0.10 if spec.trim_level < 5 else 0.115, 0.10 if spec.trim_level < 5 else 0.12),
        (0.0, spec.front_end_y + 0.005, 0.43),
        mat=mats["charcoal"],
        bevel=0.035,
        parent=body_parent,
    ), 0)
    mark_lod(box(
        "RearBumper",
        (spec.width * 0.90, 0.10, 0.12),
        (0.0, spec.rear_end_y + 0.01, 0.43),
        mat=mats["charcoal"],
        bevel=0.03,
        parent=body_parent,
    ), 0)
    fascia_y = spec.front_end_y - 0.025
    grille_width = {
        "basic": 0.42,
        "standard": 0.50,
        "premium": 0.38,
        "high_end": 0.48,
        "luxury": 0.56,
    }[spec.slug]
    grille_low = 0.635 if spec.trim_level < 3 else 0.645
    grille_high = grille_low + (0.10 if spec.slug != "luxury" else 0.12)
    grille = mark_lod(front_panel(
        "FrontGrille",
        [
            (-grille_width * 0.47, grille_low),
            (grille_width * 0.47, grille_low),
            (grille_width * 0.50, grille_high),
            (-grille_width * 0.50, grille_high),
        ],
        fascia_y + 0.018,
        0.035,
        mats["black_plastic"],
        body_parent,
        bevel=0.0,
        props={"component": "front_grille", "lod_level": 0},
    ), 0)
    _ = grille
    lower_width = spec.body_width * (0.46 if spec.trim_level < 3 else 0.54)
    mark_lod(front_panel(
        "FrontLowerAirIntake",
        [
            (-lower_width * 0.48, 0.455),
            (lower_width * 0.48, 0.455),
            (lower_width * 0.42, 0.545),
            (-lower_width * 0.42, 0.545),
        ],
        fascia_y + 0.012,
        0.028,
        mats["black_plastic"],
        body_parent,
        bevel=0.0,
        props={"component": "lower_air_intake", "lod_level": 0},
    ), 0)
    if spec.trim_level >= 2:
        accent_material = mats["brass"] if spec.trim_level == 5 else mats["steel"]
        mark_lod(beam(
            "FrontGrilleAccent",
            (-grille_width * 0.42, fascia_y + 0.047, grille_low + 0.015),
            (grille_width * 0.42, fascia_y + 0.047, grille_low + 0.015),
            0.006 if spec.trim_level < 4 else 0.008,
            accent_material,
            vertices=10,
            parent=body_parent,
        ), 0)
    # Two restrained crown creases keep every nose manufactured instead of
    # balloon-like, while their sweep differentiates fleet and premium shells.
    crease_material = mats["body_shadow"] if spec.trim_level < 4 else mats["steel"]
    crease_start_y = dash_y + 0.03
    crease_end_y = spec.front_end_y - 0.16
    for side, sign in (("L", -1.0), ("R", 1.0)):
        start_x = sign * spec.body_width * (0.25 if spec.trim_level < 3 else 0.30)
        end_x = sign * spec.body_width * (0.17 if spec.trim_level < 3 else 0.23)
        mark_lod(curve_tube(
            f"HoodCrownCrease_{side}",
            (
                (start_x, crease_start_y, 0.923 if spec.trim_level < 3 else 0.955),
                (sign * spec.body_width * 0.27, (crease_start_y + crease_end_y) * 0.5, 0.886),
                (end_x, crease_end_y, 0.765 if spec.trim_level < 3 else 0.795),
            ),
            0.0045 if spec.trim_level < 4 else 0.0055,
            crease_material,
            parent=body_parent,
            resolution=2,
            bevel_resolution=2,
            props={"component": "hood_crown_crease", "lod_level": 0},
        ), 0)
    panel_length = max(0.54, spec.wheelbase * 0.52)
    panel_y = (spec.front_wheel_y + spec.rear_wheel_y) * 0.5
    for side, x in (("L", -spec.body_width * 0.505), ("R", spec.body_width * 0.505)):
        # Recessed service-panel perimeter, not a dark slab.
        y0 = panel_y - panel_length * 0.5
        y1 = panel_y + panel_length * 0.5
        for edge_name, a, b in (
            ("Top", (x, y0, 0.735), (x, y1, 0.735)),
            ("Bottom", (x, y0, 0.505), (x, y1, 0.505)),
            ("Front", (x, y1, 0.505), (x, y1, 0.735)),
            ("Rear", (x, y0, 0.505), (x, y0, 0.735)),
        ):
            mark_lod(beam(
                f"BodyServicePanel_{side}_{edge_name}",
                a,
                b,
                0.0045,
                mats["body_shadow"],
                vertices=8,
                parent=body_parent,
            ), 0)
    if spec.trim_level >= 3:
        for side, x in (("L", -spec.body_width * 0.512), ("R", spec.body_width * 0.512)):
            mark_lod(box(
                f"PremiumBeltline_{side}",
                (0.020, spec.length * (0.48 if spec.slug != "luxury" else 0.70), 0.025),
                (x, -0.05 if spec.slug != "luxury" else -0.22, 0.785),
                mat=mats["brass"] if spec.trim_level == 5 else mats["steel"],
                bevel=0.010,
                parent=body_parent,
            ), 0)
    lod1_parent = groups["lod1"]
    lod2_parent = groups["lod2"]
    mark_lod(loft_solid(
        "LOD1_BodySilhouette",
        body_sections(spec),
        mats["body"],
        radial_segments=10,
        parent=lod1_parent,
    ), 1)
    mark_lod(box(
        "LOD1_Hood",
        (spec.body_width * 0.82, max(0.48, spec.front_end_y - dash_y + 0.06), 0.34),
        (0.0, (spec.front_end_y + dash_y) * 0.5, 0.66),
        mat=mats["body"],
        bevel=0.06,
        parent=lod1_parent,
    ), 1)
    mark_lod(box(
        "LOD2_BodySilhouette",
        (spec.body_width * 0.94, spec.length * 0.89, 0.43),
        (0.0, -0.02, 0.51),
        mat=mats["body"],
        bevel=0.08,
        parent=lod2_parent,
    ), 2)


def build_roof_and_windshield(
    spec: CartSpec,
    groups: dict[str, bpy.types.Object],
    mats: dict[str, bpy.types.Material],
    functional: dict[str, Any],
) -> None:
    roof_parent = groups["roof"]
    roof_center_y = driver_row(spec)["y"] - (0.10 if spec.passenger_capacity <= 2 else 0.22)
    if spec.slug == "luxury":
        roof_center_y = -0.24
    roof_rear = roof_center_y - spec.roof_length * 0.5
    roof_front = roof_center_y + spec.roof_length * 0.5
    roof_sections = [
        {"y": roof_rear, "width": spec.width * 0.90, "z_min": spec.height - 0.115, "z_max": spec.height - 0.045, "exponent": 5.2},
        {"y": roof_rear + spec.roof_length * 0.10, "width": spec.width * 1.02, "z_min": spec.height - 0.105, "z_max": spec.height - 0.016, "exponent": 6.4},
        {"y": roof_center_y, "width": spec.width * 1.035, "z_min": spec.height - 0.098, "z_max": spec.height, "exponent": 6.8},
        {"y": roof_front - spec.roof_length * 0.10, "width": spec.width * 1.02, "z_min": spec.height - 0.105, "z_max": spec.height - 0.016, "exponent": 6.4},
        {"y": roof_front, "width": spec.width * 0.90, "z_min": spec.height - 0.115, "z_max": spec.height - 0.045, "exponent": 5.2},
    ]
    mark_lod(loft_solid(
        "RoofShell",
        roof_sections,
        mats["canopy"],
        radial_segments=24 if spec.trim_level >= 3 else 20,
        bevel=0.008,
        parent=roof_parent,
        props={"component": "molded_roof"},
    ), 0)
    mark_lod(box(
        "RoofUndersidePanel",
        (spec.width * 0.86, spec.roof_length * 0.84, 0.032),
        (0.0, roof_center_y, spec.height - 0.122),
        mat=mats["roof_underside"],
        bevel=0.028,
        segments=3,
        parent=roof_parent,
    ), 0)
    for side, x in (("L", -spec.width * 0.495), ("R", spec.width * 0.495)):
        mark_lod(beam(
            f"RoofDripRail_{side}",
            (x, roof_rear + 0.10, spec.height - 0.076),
            (x, roof_front - 0.10, spec.height - 0.076),
            0.012 if spec.trim_level < 3 else 0.014,
            mats["canopy"],
            vertices=10,
            parent=roof_parent,
        ), 0)
    rib_count = 2 if spec.passenger_capacity <= 2 else 3 if spec.passenger_capacity <= 4 else 5
    for index in range(rib_count):
        y = roof_rear + spec.roof_length * (index + 1) / (rib_count + 1)
        mark_lod(beam(
            f"RoofUndersideRib_{index + 1:02d}",
            (-spec.width * 0.38, y, spec.height - 0.139),
            (spec.width * 0.38, y, spec.height - 0.139),
            0.015,
            mats["roof_underside"],
            vertices=10,
            parent=roof_parent,
        ), 0)
    if spec.trim_level >= 3:
        # A shallow centre spine is the strongest premium-roof cue in references 3-5.
        mark_lod(curve_tube(
            "RoofCenterSpine",
            (
                (0.0, roof_rear + 0.16, spec.height - 0.026),
                (0.0, roof_center_y, spec.height - 0.004),
                (0.0, roof_front - 0.16, spec.height - 0.026),
            ),
            0.009,
            mats["canopy"],
            parent=roof_parent,
            resolution=2,
            bevel_resolution=2,
            props={"component": "roof_center_spine", "lod_level": 0},
        ), 0)
    front_support_y = dashboard_y(spec) + 0.02
    rear_support_y = roof_center_y - spec.roof_length * 0.42
    support_positions = [front_support_y, rear_support_y]
    if spec.passenger_capacity >= 4 and spec.slug != "premium":
        support_positions.insert(1, roof_center_y)
    if spec.slug == "luxury":
        support_positions = [1.50, 0.48, -0.64, -1.70]
    for index, y in enumerate(support_positions):
        for side, x in (("L", -spec.body_width * 0.49), ("R", spec.body_width * 0.49)):
            bottom_z = 0.68 if spec.slug == "luxury" else 0.70
            top_x = x * 0.94
            top_y = y - (0.08 if index == 0 else 0.0)
            mark_lod(beam(
                f"RoofSupport_{index + 1:02d}_{side}",
                (x, y, bottom_z),
                (top_x, top_y, spec.height - 0.10),
                0.033 if spec.trim_level < 3 else 0.038,
                mats["frame"],
                vertices=12,
                parent=roof_parent,
            ), 0)
    windshield_parent = groups["windshield"]
    glass_width = spec.body_width * 0.86
    glass_y = front_support_y - 0.015
    if spec.split_windshield:
        lower = mark_lod(box(
            "Windshield_Lower",
            (glass_width, 0.018, 0.30),
            (0.0, glass_y, 1.09),
            rotation=(math.radians(-6), 0.0, 0.0),
            mat=mats["glass"],
            bevel=0.010,
            parent=windshield_parent,
            props={"component": "split_windshield_lower"},
        ), 0)
        upper_pivot = empty(
            "Windshield_Upper",
            (0.0, glass_y, 1.27),
            parent=windshield_parent,
            props={
                "component": "folding_windshield_upper_pivot",
                "moving_part": True,
                "animation_axis": "local_x",
                "open_angle_degrees": 96,
            },
        )
        upper = box(
            "Windshield_Upper_Glass",
            (glass_width, 0.018, 0.34),
            (0.0, glass_y - 0.018, 1.44),
            rotation=(math.radians(-6), 0.0, 0.0),
            mat=mats["glass"],
            bevel=0.010,
            props={"component": "folding_windshield_glass", "lod_level": 0},
        )
        parent_keep(upper, upper_pivot)
        functional["windshield_pivot"] = upper_pivot
        functional["windshield_type"] = "split_folding"
        for side, x in (("L", -glass_width * 0.43), ("R", glass_width * 0.43)):
            mark_lod(box(
                f"WindshieldHinge_{side}",
                (0.075, 0.045, 0.065),
                (x, glass_y - 0.030, 1.27),
                mat=mats["black_plastic"],
                bevel=0.012,
                parent=windshield_parent,
                props={"component": "folding_windshield_hinge"},
            ), 0)
        add_anchor(groups["interactions"], "INTERACT_Windshield", (0.0, glass_y - 0.10, 1.28), kind="windshield_interaction")
        _ = lower
    else:
        mark_lod(box(
            "Windshield",
            (glass_width, 0.022 if spec.trim_level >= 4 else 0.018, 0.66),
            (0.0, glass_y, 1.32),
            rotation=(math.radians(-5), 0.0, 0.0),
            mat=mats["glass"],
            bevel=0.012,
            parent=windshield_parent,
            props={"component": "fixed_windshield"},
        ), 0)
        functional["windshield_type"] = "fixed"
    for side, x in (("L", -glass_width * 0.515), ("R", glass_width * 0.515)):
        mark_lod(beam(
            f"WindshieldBorder_{side}",
            (x, glass_y - 0.015, 0.99),
            (x * 0.96, glass_y - 0.075, 1.67),
            0.020,
            mats["frame"],
            vertices=10,
            parent=windshield_parent,
        ), 0)
    mark_lod(beam(
        "WindshieldBorder_Top",
        (-glass_width * 0.50, glass_y - 0.075, 1.66),
        (glass_width * 0.50, glass_y - 0.075, 1.66),
        0.018,
        mats["frame"],
        vertices=10,
        parent=windshield_parent,
    ), 0)
    if spec.trim_level >= 4:
        step_clearance = spec.wheel_radius * 1.28
        step_start_y = spec.rear_wheel_y + step_clearance
        step_end_y = spec.front_wheel_y - step_clearance
        step_length = max(0.56, step_end_y - step_start_y)
        step_center_y = (step_start_y + step_end_y) * 0.5
        for side, x in (("L", -spec.body_width * 0.54), ("R", spec.body_width * 0.54)):
            mark_lod(box(
                f"StepRail_{side}",
                (0.09, step_length, 0.075),
                (x, step_center_y, 0.37),
                mat=mats["steel"],
                bevel=0.025,
                parent=roof_parent,
            ), 0)
    for level, parent in ((1, groups["lod1"]), (2, groups["lod2"])):
        mark_lod(box(
            f"LOD{level}_Roof",
            (spec.width * 1.02, spec.roof_length, 0.09),
            (0.0, roof_center_y, spec.height - 0.07),
            mat=mats["canopy"],
            bevel=0.05,
            parent=parent,
        ), level)
        # Roof posts carry most of the cart silhouette at gameplay distance.
        # Keep every authored row in LOD1 and the outer pair in LOD2 so the
        # canopy never reads as a disconnected floating slab.
        lod_support_positions = support_positions if level == 1 else [support_positions[0], support_positions[-1]]
        for index, y in enumerate(lod_support_positions):
            for side, x in (("L", -spec.body_width * 0.49), ("R", spec.body_width * 0.49)):
                top_x = x * 0.94
                top_y = y - (0.08 if index == 0 else 0.0)
                mark_lod(beam(
                    f"LOD{level}_RoofSupport_{index + 1:02d}_{side}",
                    (x, y, 0.68),
                    (top_x, top_y, spec.height - 0.10),
                    0.030 if level == 1 else 0.036,
                    mats["frame"],
                    vertices=8 if level == 1 else 6,
                    parent=parent,
                ), level)
        if level == 1:
            mark_lod(box(
                "LOD1_Windshield",
                (glass_width, 0.018, 0.62),
                (0.0, glass_y, 1.31),
                rotation=(math.radians(-5), 0.0, 0.0),
                mat=mats["glass"],
                parent=parent,
            ), 1)


def seat_positions(spec: CartSpec) -> list[dict[str, Any]]:
    output = []
    x_offset = min(0.30, spec.body_width * 0.245)
    for row_index, row in enumerate(spec.seat_rows):
        for column, (name, x) in enumerate(zip(row["names"], (-x_offset, x_offset))):
            output.append({
                "name": name,
                "x": x,
                "y": float(row["y"]),
                "facing": int(row["facing"]),
                "row": row_index,
                "column": column,
            })
    return output


def build_one_seat(
    spec: CartSpec,
    seat: dict[str, Any],
    groups: dict[str, bpy.types.Object],
    mats: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    parent = empty(
        seat["name"],
        parent=groups["seats"],
        props={"component": "passenger_seat", "seat_index": seat["row"] * 2 + seat["column"]},
    )
    width = spec.body_width * (0.405 if spec.passenger_capacity <= 2 else 0.39)
    depth = 0.46 if spec.trim_level < 3 else 0.49
    facing = seat["facing"]
    cushion_z = 0.79 if spec.trim_level < 3 else 0.82
    mark_lod(box(
        f"{seat['name']}_Cushion",
        (width, depth, 0.16 if spec.trim_level < 4 else 0.18),
        (seat["x"], seat["y"], cushion_z),
        mat=mats["seat"],
        bevel=0.075 if spec.trim_level < 3 else 0.09,
        segments=3,
        parent=parent,
    ), 0)
    back_y = seat["y"] - facing * (depth * 0.40)
    back_height = 0.48 if spec.trim_level < 3 else 0.54
    mark_lod(box(
        f"{seat['name']}_Back",
        (width, 0.14, back_height),
        (seat["x"], back_y, cushion_z + 0.27),
        rotation=(math.radians(8 * facing), 0.0, 0.0),
        mat=mats["seat"],
        bevel=0.070 if spec.trim_level < 3 else 0.085,
        segments=3,
        parent=parent,
    ), 0)
    piping_y = back_y + facing * 0.074
    for piping_name, x in (("Left", seat["x"] - width * 0.41), ("Right", seat["x"] + width * 0.41)):
        mark_lod(curve_tube(
            f"{seat['name']}_BackPiping_{piping_name}",
            (
                (x, piping_y, cushion_z + 0.10),
                (x - (seat["x"] - x) * 0.05, piping_y, cushion_z + back_height * 0.82),
            ),
            0.004 if spec.trim_level < 3 else 0.005,
            mats["seat_piping"],
            parent=parent,
            resolution=1,
            bevel_resolution=1,
            props={"component": "seat_edge_piping", "lod_level": 0},
        ), 0)
    mark_lod(beam(
        f"{seat['name']}_CushionFrontPiping",
        (seat["x"] - width * 0.41, seat["y"] + facing * depth * 0.48, cushion_z + 0.015),
        (seat["x"] + width * 0.41, seat["y"] + facing * depth * 0.48, cushion_z + 0.015),
        0.0045,
        mats["seat_piping"],
        vertices=8,
        parent=parent,
    ), 0)
    if spec.slug == "premium":
        seam_parts = []
        front_y = back_y + facing * 0.073
        for direction in (-1.0, 1.0):
            seam_parts.append(curve_tube(
                f"{seat['name']}_Chevron_{'L' if direction < 0 else 'R'}",
                (
                    (seat["x"] + direction * width * 0.30, front_y, cushion_z + 0.39),
                    (seat["x"], front_y + facing * 0.001, cushion_z + 0.25),
                ),
                0.002,
                mats["seat_seam"],
                resolution=1,
                bevel_resolution=1,
            ))
        seams = join_meshes(f"{seat['name']}_ChevronStitching", seam_parts)
        smart_uv(seams)
        parent_keep(seams, parent)
        mark_lod(seams, 0)
    elif spec.slug == "high_end":
        seam_parts = []
        front_y = back_y + facing * 0.073
        seam_step = width * 0.19
        seam_low_z = cushion_z + 0.13
        seam_high_z = cushion_z + 0.47
        for index in range(-2, 3):
            x_start = seat["x"] + (index - 0.5) * seam_step
            x_end = x_start + seam_step
            seam_parts.append(curve_tube(
                f"{seat['name']}_Stitch_A_{index:+d}",
                ((x_start, front_y, seam_low_z), (x_end, front_y, seam_high_z)),
                0.0018,
                mats["seat_seam"],
                resolution=1,
                bevel_resolution=1,
            ))
            seam_parts.append(curve_tube(
                f"{seat['name']}_Stitch_B_{index:+d}",
                ((x_end, front_y + facing * 0.001, seam_low_z), (x_start, front_y + facing * 0.001, seam_high_z)),
                0.0018,
                mats["seat_seam"],
                resolution=1,
                bevel_resolution=1,
            ))
        seams = join_meshes(f"{seat['name']}_QuiltedStitching", seam_parts)
        smart_uv(seams)
        parent_keep(seams, parent)
        mark_lod(seams, 0)
    elif spec.slug == "luxury":
        seam_parts = []
        front_y = back_y + facing * 0.073
        for index, offset in enumerate((-0.22, 0.0, 0.22), start=1):
            seam_parts.append(curve_tube(
                f"{seat['name']}_VerticalChannel_{index:02d}",
                (
                    (seat["x"] + width * offset, front_y, cushion_z + 0.13),
                    (seat["x"] + width * offset, front_y, cushion_z + 0.47),
                ),
                0.002,
                mats["seat_seam"],
                resolution=1,
                bevel_resolution=1,
            ))
        seams = join_meshes(f"{seat['name']}_VerticalChannelStitching", seam_parts)
        smart_uv(seams)
        parent_keep(seams, parent)
        mark_lod(seams, 0)
    if spec.slug == "luxury":
        mark_lod(box(
            f"{seat['name']}_Headrest",
            (width * 0.55, 0.16, 0.22),
            (seat["x"], back_y - facing * 0.018, cushion_z + 0.63),
            rotation=(math.radians(6 * facing), 0.0, 0.0),
            mat=mats["seat"],
            bevel=0.065,
            segments=3,
            parent=parent,
        ), 0)
    return parent


def build_seats_and_anchors(
    spec: CartSpec,
    groups: dict[str, bpy.types.Object],
    mats: dict[str, bpy.types.Material],
) -> list[dict[str, Any]]:
    seats = seat_positions(spec)
    for seat in seats:
        build_one_seat(spec, seat, groups, mats)
        rotation = (0.0, 0.0, 0.0 if seat["facing"] > 0 else math.pi)
        add_anchor(
            groups["interactions"],
            f"SEAT_ANCHOR_{seat['name']}",
            (seat["x"], seat["y"], 0.91 if spec.trim_level < 3 else 0.94),
            rotation=rotation,
            kind="seat_hip",
        )
        foot_y = seat["y"] + seat["facing"] * 0.39
        for foot, delta_x in (("L", -0.10), ("R", 0.10)):
            add_anchor(
                groups["interactions"],
                f"FOOT_ANCHOR_{foot}_{seat['name']}",
                (seat["x"] + delta_x, foot_y, 0.48),
                rotation=rotation,
                kind="seat_foot",
                size=0.055,
            )
        side_sign = -1 if seat["column"] == 0 else 1
        entry = (side_sign * (spec.width * 0.5 + 0.42), seat["y"] + seat["facing"] * 0.08, 0.05)
        add_anchor(groups["interactions"], f"ENTRY_POINT_{seat['name']}", entry, rotation=rotation, kind="entry_point")
        add_anchor(groups["interactions"], f"EXIT_POINT_{seat['name']}", entry, rotation=rotation, kind="exit_point")
    for row_index, row in enumerate(spec.seat_rows):
        facing = int(row["facing"])
        for side, sign in (("L", -1.0), ("R", 1.0)):
            arm_x = sign * spec.body_width * 0.46
            arm_y = float(row["y"]) + facing * 0.02
            mark_lod(curve_tube(
                f"SeatRow_{row_index + 1:02d}_Armrest_{side}",
                (
                    (arm_x, arm_y - facing * 0.22, 0.78),
                    (arm_x, arm_y - facing * 0.23, 1.00),
                    (arm_x, arm_y + facing * 0.18, 1.00),
                    (arm_x, arm_y + facing * 0.23, 0.84),
                ),
                0.022 if spec.trim_level < 3 else 0.025,
                mats["frame"],
                parent=groups["seats"],
                resolution=2,
                bevel_resolution=2,
                props={"component": "seat_armrest", "lod_level": 0},
            ), 0)
    for level, parent in ((1, groups["lod1"]), (2, groups["lod2"])):
        for row_index, row in enumerate(spec.seat_rows):
            width = spec.body_width * 0.84
            mark_lod(box(
                f"LOD{level}_SeatRow_{row_index + 1:02d}",
                (width, 0.43, 0.44 if level == 1 else 0.36),
                (0.0, row["y"] - row["facing"] * 0.06, 0.93),
                mat=mats["seat"],
                bevel=0.06,
                parent=parent,
            ), level)
    return seats


def build_dashboard_and_controls(
    spec: CartSpec,
    groups: dict[str, bpy.types.Object],
    mats: dict[str, bpy.types.Material],
    functional: dict[str, Any],
) -> None:
    parent = groups["dashboard"]
    dash_y = dashboard_y(spec)
    dash_width = spec.body_width * 0.84
    mark_lod(box(
        "Dashboard",
        (dash_width, 0.20, 0.30 if spec.trim_level < 3 else 0.33),
        (0.0, dash_y, 0.96),
        rotation=(math.radians(-7), 0.0, 0.0),
        mat=mats["charcoal"],
        bevel=0.055 if spec.trim_level < 3 else 0.07,
        parent=parent,
    ), 0)
    mark_lod(box(
        "DashboardTop",
        (dash_width * 0.94, 0.24, 0.07),
        (0.0, dash_y - 0.01, 1.10),
        mat=mats["charcoal"],
        bevel=0.025,
        parent=parent,
    ), 0)
    instrument_x = -dash_width * 0.23
    if spec.trim_level <= 2:
        mark_lod(cylinder(
            "InstrumentGauge",
            0.075,
            0.018,
            (instrument_x, dash_y - 0.105, 1.00),
            rotation=(math.pi / 2, 0.0, 0.0),
            mat=mats["instrument"],
            vertices=18,
            parent=parent,
        ), 0)
    else:
        mark_lod(box(
            "InstrumentDisplay",
            (0.28 if spec.trim_level < 5 else 0.36, 0.018, 0.13),
            (instrument_x + 0.02, dash_y - 0.108, 1.01),
            mat=mats["display"],
            bevel=0.018,
            parent=parent,
        ), 0)
        for index in range(3):
            mark_lod(box(
                f"DisplayIndicator_{index + 1:02d}",
                (0.035, 0.008, 0.012),
                (instrument_x - 0.07 + index * 0.07, dash_y - 0.120, 1.01),
                mat=mats["amber"] if index == 1 else mats["instrument"],
                bevel=0.004,
                parent=parent,
            ), 0)
    if spec.trim_level >= 2:
        for side, x in (("L", -0.10), ("R", 0.10)):
            mark_lod(torus(
                f"CupHolder_{side}",
                0.048,
                0.010,
                (x, dash_y - 0.03, 1.115),
                mat=mats["charcoal"],
                major_segments=16,
                minor_segments=6,
                parent=parent,
            ), 0)
    passenger_x = seat_positions(spec)[1]["x"]
    mark_lod(box(
        "DashboardGlovebox",
        (0.28 if spec.trim_level < 4 else 0.34, 0.014, 0.105),
        (passenger_x, dash_y - 0.109, 0.975),
        mat=mats["black_plastic"],
        bevel=0.018,
        parent=parent,
        props={"component": "dashboard_storage_lid"},
    ), 0)
    mark_lod(beam(
        "DashboardGloveboxPull",
        (passenger_x - 0.055, dash_y - 0.121, 1.005),
        (passenger_x + 0.055, dash_y - 0.121, 1.005),
        0.006,
        mats["steel"] if spec.trim_level >= 3 else mats["charcoal"],
        vertices=8,
        parent=parent,
    ), 0)
    key_x = instrument_x + 0.14
    mark_lod(cylinder(
        "IgnitionSwitchBezel",
        0.026,
        0.014,
        (key_x, dash_y - 0.116, 0.948),
        rotation=(math.pi / 2, 0.0, 0.0),
        mat=mats["steel"],
        vertices=16,
        parent=parent,
    ), 0)
    mark_lod(box(
        "ForwardReverseSelector",
        (0.055, 0.020, 0.090),
        (key_x + 0.09, dash_y - 0.119, 0.965),
        mat=mats["black_plastic"],
        bevel=0.014,
        parent=parent,
        props={"component": "drive_direction_selector"},
    ), 0)
    if spec.trim_level >= 4:
        mark_lod(box(
            "DashboardAccentInlay",
            (dash_width * 0.84, 0.010, 0.022),
            (0.0, dash_y - 0.121, 1.073),
            mat=mats["brass"] if spec.trim_level == 5 else mats["steel"],
            bevel=0.006,
            parent=parent,
        ), 0)
    driver_x = seat_positions(spec)[0]["x"]
    column_start = (driver_x, dash_y - 0.10, 0.91)
    wheel_center = (driver_x, dash_y - 0.24, 1.18)
    mark_lod(beam(
        "SteeringColumn",
        column_start,
        wheel_center,
        0.030 if spec.trim_level < 3 else 0.034,
        mats["frame"],
        vertices=12,
        parent=parent,
    ), 0)
    steering = empty(
        "SteeringWheel",
        wheel_center,
        (math.radians(66), 0.0, 0.0),
        parent,
        props={
            "component": "steering_wheel_pivot",
            "moving_part": True,
            "animation_axis": "local_z",
            "steering_ratio_visual": 1.65,
        },
    )
    ring = torus(
        "SteeringWheel_Rim",
        0.165 if spec.trim_level < 3 else 0.18,
        0.020 if spec.trim_level < 3 else 0.022,
        wheel_center,
        rotation=tuple(steering.rotation_euler),
        mat=mats["charcoal"],
        major_segments=24,
        minor_segments=8,
    )
    parent_keep(ring, steering)
    apply_mesh(ring)
    mark_lod(ring, 0)
    bpy.context.view_layer.update()
    spoke_parts = []
    radius = 0.15 if spec.trim_level < 3 else 0.165
    for angle in (math.radians(90), math.radians(210), math.radians(330)):
        endpoint = steering.matrix_world @ Vector((math.cos(angle) * radius, math.sin(angle) * radius, 0.0))
        spoke_parts.append(beam(
            f"SteeringSpoke_{round(math.degrees(angle)):03d}",
            wheel_center,
            endpoint,
            0.010,
            mats["steel"] if spec.trim_level >= 4 else mats["charcoal"],
            vertices=8,
        ))
    spokes = join_meshes("SteeringWheel_Spokes", spoke_parts)
    parent_keep(spokes, steering)
    apply_mesh(spokes)
    mark_lod(spokes, 0)
    hub = cylinder(
        "SteeringWheel_Hub",
        0.045,
        0.045,
        wheel_center,
        rotation=tuple(steering.rotation_euler),
        mat=mats["brass"] if spec.trim_level >= 4 else mats["charcoal"],
        vertices=16,
    )
    parent_keep(hub, steering)
    apply_mesh(hub)
    mark_lod(hub, 0)
    functional["steering_wheel"] = steering
    mark_lod(box(
        "Pedal_Accelerator",
        (0.08, 0.14, 0.025),
        (driver_x - 0.08, dash_y - 0.17, 0.53),
        rotation=(math.radians(24), 0.0, 0.0),
        mat=mats["charcoal"],
        bevel=0.012,
        parent=parent,
    ), 0)
    mark_lod(box(
        "Pedal_Brake",
        (0.10, 0.13, 0.025),
        (driver_x + 0.08, dash_y - 0.17, 0.53),
        rotation=(math.radians(24), 0.0, 0.0),
        mat=mats["charcoal"],
        bevel=0.012,
        parent=parent,
    ), 0)
    add_anchor(groups["interactions"], "DriverControlAnchor", wheel_center, rotation=tuple(steering.rotation_euler), kind="driver_control")
    driver_seat = seat_positions(spec)[0]
    add_anchor(
        groups["interactions"],
        "DRIVER_CAMERA_ANCHOR",
        (driver_seat["x"], driver_seat["y"] + 0.02, 1.34 if spec.height < 1.9 else 1.38),
        kind="driver_camera",
    )
    add_anchor(
        groups["interactions"],
        "VEHICLE_CAMERA_ANCHOR",
        # A restrained shoulder offset keeps the cart centred enough to drive
        # while exposing a wheel and the side surfacing in the authored view.
        (-spec.body_width * 0.72, spec.rear_end_y - 1.90, spec.height + 0.18),
        rotation=(math.radians(-11), 0.0, 0.0),
        kind="third_person_camera",
    )


def build_rim(
    spec: CartSpec,
    label: str,
    center,
    level: int,
    parent: bpy.types.Object,
    mats: dict[str, bpy.types.Material],
) -> None:
    radius = spec.wheel_radius
    width = spec.wheel_width
    alloy = mats["steel"] if spec.wheel_style == "steel" else mats["alloy"]
    if level == 2:
        rim = cylinder(
            f"LOD2_{label}_Rim",
            radius * 0.48,
            width * 1.02,
            center,
            rotation=(0.0, math.pi / 2, 0.0),
            mat=alloy,
            vertices=12,
        )
        parent_keep(rim, parent)
        mark_lod(rim, 2)
        return
    if spec.wheel_style == "steel":
        parts = [
            cylinder(
                f"LOD{level}_{label}_PressedSteelDish",
                radius * 0.43,
                width * 1.04,
                center,
                rotation=(0.0, math.pi / 2, 0.0),
                mat=alloy,
                vertices=24 if level == 0 else 14,
                bevel=0.012,
            ),
            torus(
                f"LOD{level}_{label}_SteelRimLip",
                radius * 0.43,
                radius * 0.040,
                center,
                rotation=(0.0, math.pi / 2, 0.0),
                mat=alloy,
                major_segments=24 if level == 0 else 14,
                minor_segments=6,
            ),
        ]
        if level == 0:
            for index in range(5):
                angle = math.tau * index / 5
                parts.append(cylinder(
                    f"LOD0_{label}_Vent_{index + 1:02d}",
                    radius * 0.050,
                    width * 1.09,
                    (
                        center[0],
                        center[1] + math.cos(angle) * radius * 0.25,
                        center[2] + math.sin(angle) * radius * 0.25,
                    ),
                    rotation=(0.0, math.pi / 2, 0.0),
                    mat=mats["black_plastic"],
                    vertices=10,
                ))
        joined = join_meshes(f"LOD{level}_{label}_RimAssembly", parts)
        smart_uv(joined)
        parent_keep(joined, parent)
        mark_lod(joined, level)
        return
    spoke_count = {
        "steel": 6,
        "fleet_alloy": 6,
        "eight_spoke": 8,
        "split_spoke": 10,
        "luxury_multi_spoke": 12,
    }[spec.wheel_style]
    if level == 1:
        spoke_count = min(6, spoke_count)
    exterior_sign = math.copysign(1.0, center[0])
    face_x = center[0] + exterior_sign * width * 0.40
    parts = [
        cylinder(
            f"LOD{level}_{label}_InnerWheelFace",
            radius * 0.33,
            width * 0.12,
            (
                center[0] + exterior_sign * width * 0.12,
                center[1],
                center[2],
            ),
            rotation=(0.0, math.pi / 2, 0.0),
            mat=mats["alloy_dark"] if spec.trim_level >= 3 else mats["charcoal"],
            vertices=18 if level == 0 else 12,
            bevel=0.008,
        ),
        cylinder(
            f"LOD{level}_{label}_Hub",
            radius * (0.14 if level == 0 else 0.18),
            width * 0.18,
            (face_x + exterior_sign * width * 0.04, center[1], center[2]),
            rotation=(0.0, math.pi / 2, 0.0),
            mat=mats["brass"] if spec.trim_level == 5 and level == 0 else alloy,
            vertices=16 if level == 0 else 12,
            bevel=0.010,
        ),
        torus(
            f"LOD{level}_{label}_RimRing",
            radius * 0.45,
            radius * 0.072,
            (face_x, center[1], center[2]),
            rotation=(0.0, math.pi / 2, 0.0),
            mat=alloy,
            major_segments=24 if level == 0 else 16,
            minor_segments=6,
        ),
    ]
    for index in range(spoke_count):
        angle = math.tau * index / spoke_count
        y1 = center[1] + math.cos(angle) * radius * 0.15
        z1 = center[2] + math.sin(angle) * radius * 0.15
        y2 = center[1] + math.cos(angle) * radius * 0.40
        z2 = center[2] + math.sin(angle) * radius * 0.40
        parts.append(beam(
            f"LOD{level}_{label}_Spoke_{index + 1:02d}",
            (face_x, y1, z1),
            (face_x, y2, z2),
            0.013 if spec.trim_level < 4 else 0.010,
            alloy,
            vertices=7,
        ))
        if spec.wheel_style in {"split_spoke", "luxury_multi_spoke"} and level == 0:
            offset = math.radians(2.8 if spec.trim_level == 4 else 2.0)
            a2 = angle + offset
            parts.append(beam(
                f"LOD0_{label}_SplitSpoke_{index + 1:02d}",
                (face_x, center[1] + math.cos(a2) * radius * 0.19, center[2] + math.sin(a2) * radius * 0.19),
                (face_x, center[1] + math.cos(a2) * radius * 0.40, center[2] + math.sin(a2) * radius * 0.40),
                0.007,
                mats["brass"] if spec.trim_level == 5 else alloy,
                vertices=6,
            ))
    joined = join_meshes(f"LOD{level}_{label}_RimAssembly", parts)
    smart_uv(joined)
    parent_keep(joined, parent)
    mark_lod(joined, level)


def build_wheel(
    spec: CartSpec,
    label: str,
    x: float,
    y: float,
    front: bool,
    vehicle_root: bpy.types.Object,
    mats: dict[str, bpy.types.Material],
) -> tuple[bpy.types.Object, bpy.types.Object | None]:
    center = (x, y, spec.wheel_radius)
    steering = None
    wheel_parent = vehicle_root
    if front:
        steering = empty(
            f"SteeringPivot_{label[-2:]}",
            center,
            parent=vehicle_root,
            props={
                "component": "front_steering_pivot",
                "moving_part": True,
                "animation_axis": "local_z",
                "steer_limit_degrees": 32,
            },
        )
        wheel_parent = steering
        wheel = empty(
            label,
            parent=wheel_parent,
            props={
                "component": "wheel_spin_pivot",
                "moving_part": True,
                "animation_axis": "local_x",
                "wheel_radius_m": spec.wheel_radius,
                "wheel_width_m": spec.wheel_width,
            },
        )
    else:
        wheel = empty(
            label,
            center,
            parent=wheel_parent,
            props={
                "component": "wheel_spin_pivot",
                "moving_part": True,
                "animation_axis": "local_x",
                "wheel_radius_m": spec.wheel_radius,
                "wheel_width_m": spec.wheel_width,
            },
        )
    for level in (0, 1, 2):
        lod_parent = empty(f"LOD{level}_{label}_Visual", parent=wheel, props={"lod_level": level})
        if level > 0:
            lod_parent.hide_render = True
        major_segments = 30 if level == 0 else 18 if level == 1 else 12
        minor_segments = 10 if level == 0 else 7 if level == 1 else 5
        tire_parts = [torus(
            f"LOD{level}_{label}_Tire",
            spec.wheel_radius * 0.77,
            spec.wheel_radius * 0.23,
            center,
            rotation=(0.0, math.pi / 2, 0.0),
            mat=mats["rubber"],
            major_segments=major_segments,
            minor_segments=minor_segments,
        )]
        if level == 0:
            base_major = spec.wheel_radius * 0.77
            base_minor = spec.wheel_radius * 0.23
            for band_index, x_offset in enumerate((-spec.wheel_width * 0.23, 0.0, spec.wheel_width * 0.23), start=1):
                surface_radius = base_major + math.sqrt(max(0.0, base_minor * base_minor - x_offset * x_offset))
                tire_parts.append(torus(
                    f"{label}_TreadBand_{band_index:02d}",
                    surface_radius - 0.003,
                    0.0045,
                    (x + x_offset, y, spec.wheel_radius),
                    rotation=(0.0, math.pi / 2, 0.0),
                    mat=mats["rubber"],
                    major_segments=30,
                    minor_segments=5,
                ))
        tire = join_meshes(f"LOD{level}_{label}_TireAssembly", tire_parts)
        smart_uv(tire)
        parent_keep(tire, lod_parent)
        mark_lod(tire, level)
        build_rim(spec, label, center, level, lod_parent, mats)
    return wheel, steering


def build_wheels(
    spec: CartSpec,
    vehicle_root: bpy.types.Object,
    functional: dict[str, Any],
    mats: dict[str, bpy.types.Material],
) -> None:
    functional["wheels"] = []
    functional["steering_pivots"] = []
    for label, x, y, front in (
        ("Wheel_FL", -spec.wheel_x, spec.front_wheel_y, True),
        ("Wheel_FR", spec.wheel_x, spec.front_wheel_y, True),
        ("Wheel_RL", -spec.wheel_x, spec.rear_wheel_y, False),
        ("Wheel_RR", spec.wheel_x, spec.rear_wheel_y, False),
    ):
        wheel, steering = build_wheel(spec, label, x, y, front, vehicle_root, mats)
        functional["wheels"].append(wheel)
        if steering:
            functional["steering_pivots"].append(steering)


def build_lights(
    spec: CartSpec,
    groups: dict[str, bpy.types.Object],
    mats: dict[str, bpy.types.Material],
) -> None:
    parent = groups["lights"]
    front_y = spec.front_end_y - 0.05
    rear_y = spec.rear_end_y + 0.045
    head_x = spec.body_width * 0.30
    for side, x in (("L", -head_x), ("R", head_x)):
        head_z = 0.705 if spec.trim_level < 4 else 0.725
        half_width = 0.105 if spec.slug == "basic" else 0.125 if spec.slug == "standard" else 0.145
        z_low = head_z - (0.095 if spec.slug == "basic" else 0.090)
        z_high = head_z + (0.095 if spec.slug == "basic" else 0.090)
        housing_outline = mirrored_outline(
            x,
            half_width,
            z_low,
            z_high,
            inner_taper=0.012 if spec.trim_level >= 2 else 0.0,
            outer_taper=0.028 if spec.trim_level >= 2 else 0.006,
        )
        housing = front_panel(
            f"HeadlightHousing_{side}",
            housing_outline,
            front_y - 0.030,
            0.045,
            mats["black_plastic"],
            parent,
            bevel=0.0,
        )
        lens_outline = [
            (x + (corner_x - x) * 0.76, head_z + (corner_z - head_z) * 0.72)
            for corner_x, corner_z in housing_outline
        ]
        fixture = front_panel(
            f"Headlight_{side}",
            lens_outline,
            front_y + 0.002,
            0.016,
            mats["headlight"],
            parent,
            bevel=0.0,
            props={"component": "headlight_lens", "light_role": "head"},
        )
        mark_lod(housing, 0)
        mark_lod(fixture, 0)
        if spec.trim_level >= 3:
            projector_offsets = (-0.040, 0.040) if spec.slug == "premium" else (0.0,)
            for index, offset in enumerate(projector_offsets, start=1):
                projector = torus(
                    f"HeadlightProjectorRing_{side}_{index:02d}",
                    0.036 if len(projector_offsets) == 1 else 0.030,
                    0.006,
                    (x + offset, front_y + 0.014, head_z),
                    rotation=(math.pi / 2, 0.0, 0.0),
                    mat=mats["steel"],
                    major_segments=18,
                    minor_segments=6,
                    parent=parent,
                )
                mark_lod(projector, 0)
                mark_lod(cylinder(
                    f"HeadlightProjectorLens_{side}_{index:02d}",
                    0.024 if len(projector_offsets) == 1 else 0.020,
                    0.012,
                    (x + offset, front_y + 0.015, head_z),
                    rotation=(math.pi / 2, 0.0, 0.0),
                    mat=mats["instrument"],
                    vertices=18,
                    parent=parent,
                ), 0)
        add_anchor(parent, f"LIGHT_HEAD_{side}", (x, front_y + 0.018, head_z), kind="light_attachment", size=0.05)
    tail_x = spec.body_width * 0.37
    for side, x in (("L", -tail_x), ("R", tail_x)):
        mark_lod(box(
            f"TaillightHousing_{side}",
            (0.155, 0.050, 0.095),
            (x, rear_y + 0.014, 0.68),
            mat=mats["charcoal"],
            bevel=0.025,
            parent=parent,
        ), 0)
        mark_lod(box(
            f"BrakeLight_{side}",
            (0.115, 0.024, 0.035),
            (x, rear_y - 0.018, 0.700),
            mat=mats["tail"],
            bevel=0.014,
            parent=parent,
        ), 0)
        mark_lod(box(
            f"Taillight_{side}",
            (0.115, 0.024, 0.026),
            (x, rear_y - 0.019, 0.657),
            mat=mats["tail"],
            bevel=0.010,
            parent=parent,
        ), 0)
        add_anchor(parent, f"LIGHT_TAIL_{side}", (x, rear_y - 0.02, 0.657), kind="light_attachment", size=0.05)
        add_anchor(parent, f"LIGHT_BRAKE_{side}", (x, rear_y - 0.025, 0.700), kind="light_attachment", size=0.05)
    for prefix, y, x_scale in (("FRONT", front_y, 0.44), ("REAR", rear_y, 0.44)):
        for side, x in (("L", -spec.body_width * x_scale), ("R", spec.body_width * x_scale)):
            indicator_z = 0.790 if prefix == "FRONT" else 0.730
            mark_lod(box(
                f"Indicator_{prefix}_{side}",
                (0.065 if spec.trim_level < 4 else 0.078, 0.025, 0.034),
                (x, y + (0.012 if prefix == "FRONT" else -0.012), indicator_z),
                mat=mats["amber"],
                bevel=0.012,
                parent=parent,
                props={"component": "indicator_lens", "light_role": "indicator"},
            ), 0)
            add_anchor(
                parent,
                f"LIGHT_INDICATOR_{prefix}_{side}",
                (x, y + (0.025 if prefix == "FRONT" else -0.025), indicator_z),
                kind="light_attachment",
                size=0.045,
            )


def build_storage(
    spec: CartSpec,
    groups: dict[str, bpy.types.Object],
    mats: dict[str, bpy.types.Material],
    functional: dict[str, Any],
) -> None:
    parent = groups["storage"]
    rear_y = spec.rear_end_y + 0.18
    slots = []
    if spec.rear_layout in {"bag_rack", "utility_bin"}:
        platform_y = rear_y + 0.08
        mark_lod(box(
            "RearCargoPlatform",
            (spec.body_width * 0.78, 0.36, 0.075),
            (0.0, platform_y, 0.78),
            mat=mats["charcoal"],
            bevel=0.025,
            parent=parent,
        ), 0)
        for side, x in (("L", -spec.body_width * 0.36), ("R", spec.body_width * 0.36)):
            mark_lod(beam(
                f"RearCargoRail_{side}",
                (x, rear_y - 0.02, 0.78),
                (x, rear_y - 0.02, 1.13),
                0.025,
                mats["frame"],
                vertices=10,
                parent=parent,
            ), 0)
        mark_lod(beam(
            "RearCargoRail_Top",
            (-spec.body_width * 0.36, rear_y - 0.02, 1.13),
            (spec.body_width * 0.36, rear_y - 0.02, 1.13),
            0.025,
            mats["frame"],
            vertices=10,
            parent=parent,
        ), 0)
        if spec.rear_layout == "utility_bin":
            mark_lod(box(
                "RearUtilityBin",
                (spec.body_width * 0.68, 0.34, 0.28),
                (0.0, rear_y + 0.04, 0.91),
                mat=mats["charcoal"],
                bevel=0.045,
                parent=parent,
            ), 0)
        else:
            for index, x in enumerate((-0.18, 0.18), start=1):
                mark_lod(torus(
                    f"GolfBagRetainingHoop_{index:02d}",
                    0.095,
                    0.013,
                    (x, rear_y + 0.02, 0.82),
                    mat=mats["frame"],
                    major_segments=18,
                    minor_segments=6,
                    parent=parent,
                ), 0)
            mark_lod(beam(
                "GolfBagRetainingStrap",
                (-spec.body_width * 0.34, rear_y - 0.02, 0.99),
                (spec.body_width * 0.34, rear_y - 0.02, 0.99),
                0.018,
                mats["charcoal"],
                vertices=10,
                parent=parent,
            ), 0)
        for index, x in enumerate((-0.18, 0.18), start=1):
            slots.append(add_anchor(parent, f"GOLF_BAG_SLOT_{index:02d}", (x, rear_y + 0.02, 0.86), rotation=(math.radians(-8), 0.0, 0.0), kind="golf_bag_slot"))
    elif spec.rear_layout == "rear_facing_bench":
        for side, x in (("L", -spec.body_width * 0.45), ("R", spec.body_width * 0.45)):
            mark_lod(beam(
                f"RearPassengerRail_{side}",
                (x, spec.rear_end_y + 0.13, 0.63),
                (x, spec.rear_end_y + 0.11, 1.17),
                0.028,
                mats["frame"],
                vertices=10,
                parent=parent,
            ), 0)
        mark_lod(beam(
            "RearPassengerSafetyRail",
            (-spec.body_width * 0.45, spec.rear_end_y + 0.11, 1.17),
            (spec.body_width * 0.45, spec.rear_end_y + 0.11, 1.17),
            0.030,
            mats["frame"],
            vertices=12,
            parent=parent,
        ), 0)
        for index, x in enumerate((-0.23, 0.23), start=1):
            slots.append(add_anchor(parent, f"GOLF_BAG_SLOT_{index:02d}", (x, spec.rear_end_y + 0.04, 0.68), rotation=(math.radians(-12), 0.0, 0.0), kind="golf_bag_slot"))
    else:
        storage_y = spec.rear_end_y + (0.25 if spec.slug == "luxury" else 0.22)
        storage_width = spec.body_width * 0.74
        storage_depth = 0.52 if spec.slug != "luxury" else 0.62
        wall = 0.055
        mark_lod(box(
            "RearStorageBox_Floor",
            (storage_width, storage_depth, 0.075),
            (0.0, storage_y, 0.515),
            mat=mats["black_plastic"],
            bevel=0.025,
            parent=parent,
            props={"component": "storage_cavity_floor"},
        ), 0)
        for side, x in (("L", -storage_width * 0.5 + wall * 0.5), ("R", storage_width * 0.5 - wall * 0.5)):
            mark_lod(box(
                f"RearStorageBox_Wall_{side}",
                (wall, storage_depth, 0.30),
                (x, storage_y, 0.68),
                mat=mats["charcoal"],
                bevel=0.020,
                parent=parent,
            ), 0)
        for end, y in (("Front", storage_y + storage_depth * 0.5 - wall * 0.5), ("Rear", storage_y - storage_depth * 0.5 + wall * 0.5)):
            mark_lod(box(
                f"RearStorageBox_Wall_{end}",
                (storage_width - wall * 1.4, wall, 0.30),
                (0.0, y, 0.68),
                mat=mats["charcoal"],
                bevel=0.020,
                parent=parent,
            ), 0)
        mark_lod(box(
            "RearStorageCavity",
            (storage_width - wall * 2.1, storage_depth - wall * 2.1, 0.025),
            (0.0, storage_y, 0.565),
            mat=mats["storage_liner"],
            bevel=0.012,
            parent=parent,
            props={"component": "storage_interior_cavity"},
        ), 0)
        lid = empty(
            "StorageLid_Rear",
            (0.0, storage_y - 0.25, 0.84),
            parent=parent,
            props={"moving_part": True, "animation_axis": "local_x", "open_angle_degrees": 68},
        )
        panel = box(
            "StorageLid_Rear_Panel",
            (spec.body_width * 0.72, 0.50 if spec.slug != "luxury" else 0.60, 0.055),
            (0.0, storage_y, 0.86),
            mat=mats["body"],
            bevel=0.030,
        )
        parent_keep(panel, lid)
        mark_lod(panel, 0)
        inner_panel = box(
            "StorageLid_Rear_InnerPanel",
            (spec.body_width * 0.62, 0.40 if spec.slug != "luxury" else 0.50, 0.016),
            (0.0, storage_y, 0.825),
            mat=mats["storage_liner"],
            bevel=0.018,
        )
        parent_keep(inner_panel, lid)
        mark_lod(inner_panel, 0)
        functional["storage_lid"] = lid
        add_anchor(groups["interactions"], "INTERACT_Storage_Rear", (0.0, storage_y + 0.28, 0.88), kind="storage_interaction")
        for index, x in enumerate((-0.20, 0.20), start=1):
            slots.append(add_anchor(parent, f"GOLF_BAG_SLOT_{index:02d}", (x, spec.rear_end_y + 0.04, 0.74), rotation=(math.radians(-10), 0.0, 0.0), kind="golf_bag_slot"))
    add_anchor(parent, "CARGO_ZONE_REAR", (0.0, rear_y + 0.18, 0.84), kind="cargo_zone", size=0.12)
    add_anchor(parent, "STORAGE_ZONE_DASH", (0.18, dashboard_y(spec) - 0.15, 0.98), kind="storage_zone", size=0.06)
    add_anchor(parent, "STORAGE_ZONE_UNDER_SEAT", (0.0, driver_row(spec)["y"], 0.60), kind="storage_zone", size=0.08)
    if spec.trim_level >= 2:
        add_anchor(parent, "CUP_HOLDER_01", (-0.10, dashboard_y(spec) - 0.03, 1.13), kind="cup_holder", size=0.04)
        add_anchor(parent, "CUP_HOLDER_02", (0.10, dashboard_y(spec) - 0.03, 1.13), kind="cup_holder", size=0.04)
    functional["golf_bag_slots"] = slots
    battery_x = spec.body_width * 0.515
    battery_y = driver_row(spec)["y"]
    battery_z = 0.63
    for edge_name, dimensions, location in (
        ("Top", (0.040, 0.55, 0.035), (battery_x - 0.012, battery_y, battery_z + 0.132)),
        ("Bottom", (0.040, 0.55, 0.035), (battery_x - 0.012, battery_y, battery_z - 0.132)),
        ("Front", (0.040, 0.035, 0.25), (battery_x - 0.012, battery_y + 0.257, battery_z)),
        ("Rear", (0.040, 0.035, 0.25), (battery_x - 0.012, battery_y - 0.257, battery_z)),
    ):
        mark_lod(box(
            f"BatteryCompartment_Frame_{edge_name}",
            dimensions,
            location,
            mat=mats["charcoal"],
            bevel=0.012,
            parent=parent,
        ), 0)
    mark_lod(box(
        "BatteryCompartment_Cavity",
        (0.028, 0.48, 0.21),
        (battery_x - 0.036, battery_y, battery_z),
        mat=mats["black_plastic"],
        bevel=0.018,
        parent=parent,
        props={"component": "battery_compartment_interior"},
    ), 0)
    module_count = 3 if spec.trim_level < 3 else 2
    module_span = 0.36
    for index in range(module_count):
        offset = 0.0 if module_count == 1 else -module_span * 0.5 + module_span * index / (module_count - 1)
        mark_lod(box(
            f"BatteryModule_{index + 1:02d}",
            (0.034, 0.115 if module_count == 3 else 0.175, 0.155),
            (battery_x - 0.012, battery_y + offset, battery_z - 0.005),
            mat=mats["battery"],
            bevel=0.014,
            parent=parent,
            props={
                "component": "battery_module",
                "battery_technology": "lithium_module" if spec.trim_level >= 4 else "sealed_electric_bank",
            },
        ), 0)
        mark_lod(cylinder(
            f"BatteryModule_{index + 1:02d}_Terminal",
            0.014,
            0.045,
            (battery_x + 0.005, battery_y + offset, battery_z + 0.055),
            rotation=(0.0, math.pi / 2, 0.0),
            mat=mats["copper"],
            vertices=10,
            parent=parent,
        ), 0)
    battery_lid = empty(
        "BatteryCompartment_Lid",
        (battery_x, battery_y - 0.25, battery_z),
        parent=parent,
        props={"moving_part": True, "animation_axis": "local_z", "open_angle_degrees": -68},
    )
    battery_panel = box(
        "BatteryCompartment_Lid_Panel",
        (0.040, 0.48, 0.23),
        (battery_x + 0.008, battery_y, battery_z),
        mat=mats["body"],
        bevel=0.030,
    )
    parent_keep(battery_panel, battery_lid)
    mark_lod(battery_panel, 0)
    functional["battery_lid"] = battery_lid
    charge_x = spec.body_width * 0.51
    charge_y = spec.rear_wheel_y + 0.28
    charge = torus(
        "ChargePort_Bezel",
        0.045,
        0.010,
        (charge_x, charge_y, 0.63),
        rotation=(0.0, math.pi / 2, 0.0),
        mat=mats["brass"] if spec.trim_level >= 4 else mats["charcoal"],
        major_segments=16,
        minor_segments=6,
        parent=parent,
    )
    mark_lod(charge, 0)
    add_anchor(parent, "CHARGE_PORT", (charge_x + 0.025, charge_y, 0.63), rotation=(0.0, math.pi / 2, 0.0), kind="charge_port")
    add_anchor(parent, "BATTERY_ACCESS_POINT", (battery_x + 0.10, battery_y, battery_z), kind="battery_access")
    add_anchor(parent, "BATTERY_COMPARTMENT_ANCHOR", (battery_x - 0.16, battery_y, battery_z), kind="battery_compartment")
    add_anchor(groups["interactions"], "INTERACT_BatteryCompartment", (battery_x + 0.20, battery_y, battery_z), kind="battery_interaction")


def build_luxury_doors_and_mirrors(
    spec: CartSpec,
    groups: dict[str, bpy.types.Object],
    mats: dict[str, bpy.types.Material],
    functional: dict[str, Any],
) -> None:
    if not spec.luxury_doors:
        return
    door_parent = groups["doors"]
    row_centers = (0.88, -0.20, -1.27)
    labels = ("F", "M", "R")
    door_pivots = []
    for row_label, center_y in zip(labels, row_centers):
        for side_label, side_sign in (("L", -1), ("R", 1)):
            hinge_y = center_y + 0.47
            x = side_sign * spec.body_width * 0.51
            pivot = empty(
                f"Door_{row_label}{side_label}",
                (x, hinge_y, 0.48),
                parent=door_parent,
                props={
                    "component": "hinged_passenger_door",
                    "moving_part": True,
                    "animation_axis": "local_z",
                    "open_angle_degrees": 74 * side_sign,
                    "hinge_side": side_label,
                },
            )
            panel = box(
                f"Door_{row_label}{side_label}_Panel",
                (0.042, 0.86, 0.52),
                (x, center_y, 0.70),
                mat=mats["body_untextured"],
                bevel=0.040,
            )
            parent_keep(panel, pivot)
            mark_lod(panel, 0)
            window = box(
                f"Door_{row_label}{side_label}_Window",
                (0.020, 0.76, 0.66),
                (x, center_y, 1.31),
                mat=mats["glass"],
                bevel=0.025,
            )
            parent_keep(window, pivot)
            mark_lod(window, 0)
            rail_parts = [
                beam(
                    f"Door_{row_label}{side_label}_TopRail",
                    (x, center_y - 0.40, 0.98),
                    (x, center_y + 0.40, 0.98),
                    0.026,
                    mats["frame"],
                    vertices=9,
                ),
                beam(
                    f"Door_{row_label}{side_label}_RearRail",
                    (x, center_y - 0.40, 0.47),
                    (x, center_y - 0.40, 0.98),
                    0.026,
                    mats["frame"],
                    vertices=9,
                ),
                beam(
                    f"Door_{row_label}{side_label}_WindowTopRail",
                    (x, center_y - 0.40, 1.68),
                    (x, center_y + 0.40, 1.68),
                    0.026,
                    mats["frame"],
                    vertices=9,
                ),
                beam(
                    f"Door_{row_label}{side_label}_WindowHingeRail",
                    (x, center_y + 0.40, 0.98),
                    (x, center_y + 0.40, 1.68),
                    0.026,
                    mats["frame"],
                    vertices=9,
                ),
                beam(
                    f"Door_{row_label}{side_label}_WindowLatchRail",
                    (x, center_y - 0.40, 0.98),
                    (x, center_y - 0.40, 1.68),
                    0.026,
                    mats["frame"],
                    vertices=9,
                ),
            ]
            rails = join_meshes(f"Door_{row_label}{side_label}_Frame", rail_parts)
            parent_keep(rails, pivot)
            mark_lod(rails, 0)
            handle = box(
                f"Door_{row_label}{side_label}_Handle",
                (0.045, 0.16, 0.035),
                (x + side_sign * 0.028, center_y - 0.25, 0.85),
                mat=mats["brass"],
                bevel=0.015,
            )
            parent_keep(handle, pivot)
            mark_lod(handle, 0)
            inset = box(
                f"Door_{row_label}{side_label}_LowerInset",
                (0.014, 0.60, 0.18),
                (x + side_sign * 0.024, center_y, 0.69),
                mat=mats["body_shadow"],
                bevel=0.028,
            )
            parent_keep(inset, pivot)
            mark_lod(inset, 0)
            inner_trim = box(
                f"Door_{row_label}{side_label}_InnerTrim",
                (0.012, 0.62, 0.30),
                (x - side_sign * 0.027, center_y, 0.70),
                mat=mats["storage_liner"],
                bevel=0.032,
            )
            parent_keep(inner_trim, pivot)
            mark_lod(inner_trim, 0)
            add_anchor(groups["interactions"], f"INTERACT_Door_{row_label}{side_label}", (x + side_sign * 0.18, center_y - 0.25, 0.86), kind="door_interaction")
            door_pivots.append(pivot)
    functional["doors"] = door_pivots
    for side_label, side_sign in (("L", -1), ("R", 1)):
        x = side_sign * spec.body_width * 0.51
        mark_lod(beam(
            f"CabinHeaderRail_{side_label}",
            (x, -1.72, 1.72),
            (x, 1.52, 1.72),
            0.034,
            mats["frame"],
            vertices=12,
            parent=door_parent,
        ), 0)
        mark_lod(beam(
            f"CabinSillRail_{side_label}",
            (x, -1.72, 0.43),
            (x, 1.52, 0.43),
            0.032,
            mats["frame"],
            vertices=12,
            parent=door_parent,
        ), 0)
        for pillar_index, y in enumerate((1.47, 0.43, -0.66, -1.72), start=1):
            mark_lod(beam(
                f"CabinPillar_{pillar_index:02d}_{side_label}",
                (x, y, 0.45),
                (x * 0.96, y - 0.025, 1.73),
                0.037,
                mats["frame"],
                vertices=12,
                parent=door_parent,
            ), 0)
    for side_label, side_sign in (("L", -1), ("R", 1)):
        x = side_sign * spec.body_width * 0.565
        mark_lod(beam(
            f"MirrorArm_{side_label}",
            (side_sign * spec.body_width * 0.49, 1.42, 1.38),
            (x, 1.49, 1.42),
            0.018,
            mats["frame"],
            vertices=9,
            parent=groups["doors"],
        ), 0)
        mark_lod(box(
            f"MirrorHousing_{side_label}",
            (0.058, 0.155, 0.19),
            (x, 1.51, 1.42),
            mat=mats["charcoal"],
            bevel=0.045,
            parent=groups["doors"],
        ), 0)
        mark_lod(box(
            f"Mirror_{side_label}",
            (0.014, 0.118, 0.145),
            (x + side_sign * 0.041, 1.51, 1.42),
            mat=mats["mirror"],
            bevel=0.025,
            parent=groups["doors"],
        ), 0)
    mark_lod(box(
        "CabinRearWindow",
        (spec.body_width * 0.88, 0.020, 0.64),
        (0.0, -1.74, 1.31),
        mat=mats["glass"],
        bevel=0.030,
        parent=door_parent,
        props={"component": "fixed_rear_cabin_glass"},
    ), 0)
    for edge_name, start, end in (
        ("Top", (-spec.body_width * 0.46, -1.755, 1.66), (spec.body_width * 0.46, -1.755, 1.66)),
        ("Bottom", (-spec.body_width * 0.46, -1.755, 0.97), (spec.body_width * 0.46, -1.755, 0.97)),
        ("Left", (-spec.body_width * 0.46, -1.755, 0.97), (-spec.body_width * 0.46, -1.755, 1.66)),
        ("Right", (spec.body_width * 0.46, -1.755, 0.97), (spec.body_width * 0.46, -1.755, 1.66)),
    ):
        mark_lod(beam(
            f"CabinRearWindowFrame_{edge_name}",
            start,
            end,
            0.026,
            mats["frame"],
            vertices=10,
            parent=door_parent,
        ), 0)


def build_collisions(
    spec: CartSpec,
    groups: dict[str, bpy.types.Object],
    mats: dict[str, bpy.types.Material],
    functional: dict[str, Any],
) -> None:
    parent = groups["collisions"]
    create_collision("COL_Chassis", (spec.body_width * 0.92, spec.length * 0.84, 0.50), (0.0, -0.02, 0.47), parent, mats, "main_chassis")
    create_collision("COL_FrontBody", (spec.body_width * 0.82, max(0.52, spec.front_end_y - dashboard_y(spec) + 0.12), 0.42), (0.0, (spec.front_end_y + dashboard_y(spec)) * 0.5, 0.69), parent, mats, "front_body")
    create_collision("COL_RearBody", (spec.body_width * 0.82, 0.55, 0.48), (0.0, spec.rear_end_y + 0.30, 0.62), parent, mats, "rear_body")
    create_collision("COL_Roof", (spec.width * 0.98, spec.roof_length * 0.96, 0.10), (0.0, -0.12 if spec.slug != "luxury" else -0.24, spec.height - 0.07), parent, mats, "roof")
    create_collision("COL_SeatArea", (spec.body_width * 0.78, spec.roof_length * 0.72, 0.34), (0.0, -0.16, 0.86), parent, mats, "seat_area")
    footprint = create_collision("COL_VEHICLE_FOOTPRINT", (spec.width, spec.length, 0.035), (0.0, 0.0, 0.018), parent, mats, "parking_footprint")
    footprint["vehicle_footprint"] = True
    for pivot in functional.get("doors", []):
        row_label = pivot.name.split("_")[-1]
        center_y = {"FL": 0.88, "FR": 0.88, "ML": -0.20, "MR": -0.20, "RL": -1.27, "RR": -1.27}[row_label]
        x = -spec.body_width * 0.51 if row_label.endswith("L") else spec.body_width * 0.51
        door_col = create_collision(f"COL_Door_{row_label}", (0.05, 0.84, 0.48), (x, center_y, 0.69), parent, mats, "door")
        parent_keep(door_col, pivot)


def build_service_and_general_anchors(spec: CartSpec, groups: dict[str, bpy.types.Object]) -> None:
    parent = groups["interactions"]
    add_anchor(parent, "VEHICLE_FOOTPRINT", (0.0, 0.0, 0.02), kind="vehicle_footprint", size=0.16)
    add_anchor(parent, "PARKING_ANCHOR", (0.0, 0.0, 0.0), kind="parking_anchor", size=0.12)
    add_anchor(parent, "VEHICLE_CENTER", (0.0, 0.0, 0.65), kind="vehicle_center")
    add_anchor(parent, "FRONT_CENTER", (0.0, spec.front_end_y, 0.52), kind="front_center")
    add_anchor(parent, "REAR_CENTER", (0.0, spec.rear_end_y, 0.52), rotation=(0.0, 0.0, math.pi), kind="rear_center")
    for suffix, x, y in (
        ("FL", -spec.width * 0.5, spec.front_end_y),
        ("FR", spec.width * 0.5, spec.front_end_y),
        ("RL", -spec.width * 0.5, spec.rear_end_y),
        ("RR", spec.width * 0.5, spec.rear_end_y),
    ):
        add_anchor(parent, f"PARKING_CORNER_{suffix}", (x, y, 0.02), kind="parking_extent", size=0.045)
    driver = seat_positions(spec)[0]
    add_anchor(parent, "INTERACT_DriverEntry", (-spec.width * 0.72, driver["y"], 0.75), kind="general_interaction")
    add_anchor(parent, "INTERACT_PassengerEntry_Left", (-spec.width * 0.72, driver["y"], 0.75), kind="general_interaction")
    add_anchor(parent, "INTERACT_PassengerEntry_Right", (spec.width * 0.72, driver["y"], 0.75), kind="general_interaction")
    if spec.passenger_capacity >= 4:
        add_anchor(parent, "INTERACT_RearEntry_Left", (-spec.width * 0.72, spec.seat_rows[-1]["y"], 0.75), kind="general_interaction")
        add_anchor(parent, "INTERACT_RearEntry_Right", (spec.width * 0.72, spec.seat_rows[-1]["y"], 0.75), kind="general_interaction")
    service_points = {
        "SERVICE_POINT_FRONT": (0.0, spec.front_end_y + 0.35, 0.58),
        "SERVICE_POINT_REAR": (0.0, spec.rear_end_y - 0.35, 0.58),
        "SERVICE_POINT_BATTERY": (spec.body_width * 0.64, driver["y"], 0.62),
        "SERVICE_POINT_WHEEL_FL": (-spec.wheel_x, spec.front_wheel_y, spec.wheel_radius),
        "SERVICE_POINT_WHEEL_FR": (spec.wheel_x, spec.front_wheel_y, spec.wheel_radius),
        "SERVICE_POINT_WHEEL_RL": (-spec.wheel_x, spec.rear_wheel_y, spec.wheel_radius),
        "SERVICE_POINT_WHEEL_RR": (spec.wheel_x, spec.rear_wheel_y, spec.wheel_radius),
        "CLEANING_TARGET_BODY": (spec.body_width * 0.60, 0.0, 0.66),
        "CLEANING_TARGET_WINDSHIELD": (0.0, dashboard_y(spec), 1.34),
        "CLEANING_TARGET_SEATS": (0.0, driver["y"], 0.94),
        "CHARGE_CABLE_GUIDE": (spec.body_width * 0.70, spec.rear_wheel_y + 0.28, 0.36),
        "PLACEMENT_CLEARANCE_TOP": (0.0, 0.0, spec.height),
    }
    for name, location in service_points.items():
        add_anchor(parent, name, location, kind="service_point", size=0.06)


def exercise_pivots(spec: CartSpec, functional: dict[str, Any]) -> list[dict[str, Any]]:
    checks = []
    for pivot in functional["steering_pivots"]:
        before = pivot.matrix_world.copy()
        pivot.rotation_euler.z = math.radians(32)
        bpy.context.view_layer.update()
        changed = any(abs(before[row][column] - pivot.matrix_world[row][column]) > 1e-7 for row in range(4) for column in range(4))
        pivot.rotation_euler.z = 0.0
        pivot["pivot_exercise_passed"] = changed
        checks.append({"node": pivot.name, "motion": "steer", "degrees": 32, "pass": changed})
    for wheel in functional["wheels"]:
        before = wheel.matrix_world.copy()
        wheel.rotation_euler.x = math.radians(47)
        bpy.context.view_layer.update()
        changed = any(abs(before[row][column] - wheel.matrix_world[row][column]) > 1e-7 for row in range(4) for column in range(4))
        wheel.rotation_euler.x = 0.0
        wheel["pivot_exercise_passed"] = changed
        checks.append({"node": wheel.name, "motion": "spin", "degrees": 47, "pass": changed})
    steering = functional["steering_wheel"]
    steering.rotation_euler.z = math.radians(70)
    bpy.context.view_layer.update()
    steering.rotation_euler.z = 0.0
    steering["pivot_exercise_passed"] = True
    checks.append({"node": steering.name, "motion": "steering_wheel", "degrees": 70, "pass": True})
    for pivot in functional.get("doors", []):
        angle = math.radians(float(pivot["open_angle_degrees"]))
        pivot.rotation_euler.z = angle
        bpy.context.view_layer.update()
        pivot.rotation_euler.z = 0.0
        pivot["pivot_exercise_passed"] = True
        checks.append({"node": pivot.name, "motion": "hinge", "degrees": round(math.degrees(angle), 2), "pass": True})
    for key in ("storage_lid", "battery_lid", "windshield_pivot"):
        pivot = functional.get(key)
        if not pivot:
            continue
        angle = math.radians(float(pivot.get("open_angle_degrees", 55)))
        axis_index = {"local_x": 0, "local_y": 1, "local_z": 2}[str(pivot.get("animation_axis", "local_x"))]
        pivot.rotation_euler[axis_index] = angle
        bpy.context.view_layer.update()
        pivot.rotation_euler[axis_index] = 0.0
        pivot["pivot_exercise_passed"] = True
        checks.append({"node": pivot.name, "motion": "hinge", "degrees": round(math.degrees(angle), 2), "pass": True})
    bpy.context.view_layer.update()
    if not all(check["pass"] for check in checks):
        raise RuntimeError(f"{spec.asset_id} pivot exercise failed: {checks}")
    return checks


def build_asset(spec: CartSpec) -> tuple[bpy.types.Object, dict[str, Any], dict[str, bpy.types.Material], dict[str, bpy.types.Object]]:
    reset_scene()
    set_scene_contract()
    mats = make_materials(spec)
    root = empty(
        spec.asset_id,
        props={
            "asset_id": spec.asset_id,
            "asset_type": "golf_cart_vehicle",
            "tier": spec.slug,
            "display_name": spec.label,
            "reference_file": f"Designs/Golf_Carts/{spec.reference_file}",
            "source": "Original project-authored Blender Python geometry",
            "license": "project-owned / UNLICENSED",
            "dimensions_m_xyz": [spec.width, spec.length, spec.height],
            "wheelbase_m": spec.wheelbase,
            "passenger_capacity": spec.passenger_capacity,
            "forward_axis_blender": "+Y",
            "forward_axis_runtime": "-Z",
            "up_axis": "+Z",
            "condition_variant_support": "material-mask-ready; clean default",
            "lod_count": 3,
        },
    )
    vehicle_root = empty("VehicleRoot", parent=root, props={"vehicle_root": True, "ground_origin": True})
    groups = {
        "chassis": component_group("Chassis", vehicle_root, "chassis"),
        "body": component_group("BodyAssembly", vehicle_root, "body"),
        "roof": component_group("RoofAssembly", vehicle_root, "roof_and_supports"),
        "windshield": component_group("WindshieldAssembly", vehicle_root, "windshield"),
        "dashboard": component_group("DashboardAssembly", vehicle_root, "dashboard_and_controls"),
        "seats": component_group("Seats", vehicle_root, "seating"),
        "storage": component_group("Storage", vehicle_root, "storage"),
        "lights": component_group("Lights", vehicle_root, "lighting"),
        "doors": component_group("Doors", vehicle_root, "doors"),
        "undercarriage": component_group("Undercarriage", vehicle_root, "undercarriage"),
        "collisions": component_group("Collisions", vehicle_root, "collision_proxies"),
        "interactions": component_group("InteractionNodes", vehicle_root, "anchors_and_interactions"),
    }
    lods = component_group("LODs", vehicle_root, "level_of_detail")
    groups["lod1"] = empty("LOD1", parent=lods, props={"lod_level": 1, "suggested_distance_m": 22})
    groups["lod2"] = empty("LOD2", parent=lods, props={"lod_level": 2, "suggested_distance_m": 55})
    groups["lod1"].hide_render = True
    groups["lod2"].hide_render = True
    functional: dict[str, Any] = {"doors": []}

    build_undercarriage(spec, groups, mats)
    build_body(spec, groups, mats)
    build_roof_and_windshield(spec, groups, mats, functional)
    seats = build_seats_and_anchors(spec, groups, mats)
    build_dashboard_and_controls(spec, groups, mats, functional)
    build_wheels(spec, vehicle_root, functional, mats)
    build_lights(spec, groups, mats)
    build_storage(spec, groups, mats, functional)
    build_luxury_doors_and_mirrors(spec, groups, mats, functional)
    build_service_and_general_anchors(spec, groups)
    build_collisions(spec, groups, mats, functional)
    pivot_checks = exercise_pivots(spec, functional)

    functional["seat_records"] = seats
    functional["pivot_checks"] = pivot_checks
    functional["topology_cleanup"] = clean_authored_mesh_topology(root)
    return root, functional, mats, groups


def clean_authored_mesh_topology(root: bpy.types.Object) -> dict[str, Any]:
    """Remove export-only collapsed triangles without changing visible forms.

    Beveled manufactured parts can contain zero-area corner triangles after
    modifier application and glTF triangulation. They render invisibly but are
    still invalid production topology. Weld only coincident vertices, dissolve
    zero-length edges, then delete any residual zero-area faces.
    """
    report = {
        "meshesChecked": 0,
        "zeroAreaFacesBefore": 0,
        "zeroAreaFacesAfter": 0,
        "meshesCleaned": [],
    }
    for obj in descendants(root):
        if obj.type != "MESH":
            continue
        report["meshesChecked"] += 1
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        before = sum(1 for face in bm.faces if face.calc_area() <= 1e-10)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-7)
        bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=1e-7)
        residual = [face for face in bm.faces if face.calc_area() <= 1e-10]
        if residual:
            bmesh.ops.delete(bm, geom=residual, context="FACES")
        after = sum(1 for face in bm.faces if face.calc_area() <= 1e-10)
        report["zeroAreaFacesBefore"] += before
        report["zeroAreaFacesAfter"] += after
        if before or after:
            report["meshesCleaned"].append({"name": obj.name, "before": before, "after": after})
        bm.normal_update()
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()
    return report


def lod_level(obj: bpy.types.Object) -> int:
    cursor = obj
    while cursor is not None:
        if "lod_level" in cursor:
            return int(cursor["lod_level"])
        cursor = cursor.parent
    return 0


def asset_metrics(spec: CartSpec, root: bpy.types.Object, functional: dict[str, Any]) -> dict[str, Any]:
    items = descendants(root)
    meshes = [obj for obj in items if obj.type == "MESH"]
    visible_lod0 = [obj for obj in meshes if lod_level(obj) == 0 and obj.get("collision_proxy") is not True]
    minimum, maximum = mesh_bounds(visible_lod0)
    material_names = sorted({mat.name for obj in meshes for mat in obj.data.materials if mat})
    missing_uv = sorted(obj.name for obj in visible_lod0 if not obj.data.uv_layers)
    non_applied = [
        {"name": obj.name, "scale": [round(value, 6) for value in obj.scale], "rotation": [round(value, 6) for value in obj.rotation_euler]}
        for obj in meshes
        if any(abs(value - 1.0) > 1e-5 for value in obj.scale)
        or any(abs(value) > 1e-5 for value in obj.rotation_euler)
    ]
    triangles = {str(level): 0 for level in (0, 1, 2)}
    for obj in meshes:
        if obj.get("collision_proxy") is True:
            continue
        obj.data.calc_loop_triangles()
        triangles[str(lod_level(obj))] += len(obj.data.loop_triangles)
    anchor_names = sorted(obj.name for obj in items if obj.type == "EMPTY" and obj.get("anchor_kind"))
    collision_names = sorted(obj.name for obj in items if obj.get("collision_proxy") is True)
    result = {
        "asset_id": spec.asset_id,
        "tier": spec.slug,
        "reference": f"Designs/Golf_Carts/{spec.reference_file}",
        "target_dimensions_m_xyz": [spec.width, spec.length, spec.height],
        "measured_bounds_min_xyz": [round(value, 4) for value in minimum],
        "measured_bounds_max_xyz": [round(value, 4) for value in maximum],
        "measured_dimensions_m_xyz": [round(value, 4) for value in (maximum - minimum)],
        "wheelbase_m": spec.wheelbase,
        "passenger_capacity": spec.passenger_capacity,
        "nodes": len(items),
        "meshes": len(meshes),
        "triangles_by_lod": triangles,
        "materials": material_names,
        "material_count": len(material_names),
        "missing_uv_meshes": missing_uv,
        "non_applied_mesh_transforms": non_applied,
        "collision_nodes": collision_names,
        "anchor_nodes": anchor_names,
        "seat_anchors": sorted(name for name in anchor_names if name.startswith("SEAT_ANCHOR_")),
        "entry_points": sorted(name for name in anchor_names if name.startswith("ENTRY_POINT_")),
        "exit_points": sorted(name for name in anchor_names if name.startswith("EXIT_POINT_")),
        "storage_zones": sorted(name for name in anchor_names if "STORAGE_ZONE" in name or "CARGO_ZONE" in name),
        "golf_bag_slots": sorted(name for name in anchor_names if name.startswith("GOLF_BAG_SLOT_")),
        "wheel_nodes": [wheel.name for wheel in functional["wheels"]],
        "steering_nodes": [pivot.name for pivot in functional["steering_pivots"]],
        "door_nodes": [pivot.name for pivot in functional.get("doors", [])],
        "windshield_type": functional.get("windshield_type", "fixed"),
        "functional_parts": sorted({
            "four_independent_wheels",
            "front_steering_pivots",
            "steering_wheel",
            "battery_compartment_lid",
            "charge_port",
            *(("rear_storage_lid",) if functional.get("storage_lid") else ()),
            *(("folding_windshield",) if functional.get("windshield_pivot") else ()),
            *(("six_hinged_doors",) if functional.get("doors") else ()),
        }),
        "pivot_checks": functional["pivot_checks"],
        "topology_cleanup": functional["topology_cleanup"],
    }
    if missing_uv:
        raise RuntimeError(f"{spec.asset_id} is missing UVs on visible meshes: {missing_uv}")
    if non_applied:
        raise RuntimeError(f"{spec.asset_id} has unapplied mesh transforms: {non_applied[:8]}")
    if len(result["seat_anchors"]) != spec.passenger_capacity:
        raise RuntimeError(f"{spec.asset_id} seat-anchor count mismatch")
    if len(functional["wheels"]) != 4 or len(functional["steering_pivots"]) != 2:
        raise RuntimeError(f"{spec.asset_id} wheel hierarchy mismatch")
    return result


def set_lod_render(root: bpy.types.Object, level: int) -> None:
    for obj in descendants(root):
        if obj.type == "MESH" and obj.get("collision_proxy") is not True:
            obj.hide_render = lod_level(obj) != level
        elif obj.get("collision_proxy") is True:
            obj.hide_render = True


def render_asset_previews(
    spec: CartSpec,
    root: bpy.types.Object,
    functional: dict[str, Any],
) -> list[str]:
    camera_distance = max(4.8, spec.length * 1.85)
    camera = setup_studio(
        target=(0.0, 0.0, spec.height * 0.48),
        camera_location=(camera_distance * 0.72, camera_distance, spec.height * 1.48),
        resolution=(1200, 900),
    )
    set_lod_render(root, 0)
    outputs = []

    def render(name: str, camera_location=None, target=None) -> None:
        if camera_location is not None:
            camera.location = camera_location
        if target is not None:
            look_at(camera, target)
        path = QA_DIR / f"golf_cart_{spec.slug}_{name}.png"
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        outputs.append(path.relative_to(ROOT).as_posix())

    render("preview")
    for pivot in functional["steering_pivots"]:
        pivot.rotation_euler.z = math.radians(28)
    bpy.context.view_layer.update()
    render("steering_left")
    for pivot in functional["steering_pivots"]:
        pivot.rotation_euler.z = math.radians(-28)
    bpy.context.view_layer.update()
    render("steering_right")
    for pivot in functional["steering_pivots"]:
        pivot.rotation_euler.z = 0.0
    if functional.get("storage_lid"):
        functional["storage_lid"].rotation_euler.x = math.radians(62)
        bpy.context.view_layer.update()
        render(
            "storage_open",
            (camera_distance * 0.58, spec.rear_end_y - camera_distance * 0.62, spec.height * 1.12),
            (0.0, spec.rear_end_y + 0.22, 0.66),
        )
        functional["storage_lid"].rotation_euler.x = 0.0
    battery_axis = {"local_x": 0, "local_y": 1, "local_z": 2}[str(functional["battery_lid"].get("animation_axis", "local_x"))]
    functional["battery_lid"].rotation_euler[battery_axis] = math.radians(float(functional["battery_lid"].get("open_angle_degrees", 55)))
    bpy.context.view_layer.update()
    render("battery_open", (camera_distance * 0.92, camera_distance * 0.34, spec.height * 1.16), (spec.body_width * 0.42, driver_row(spec)["y"], 0.64))
    functional["battery_lid"].rotation_euler[battery_axis] = 0.0
    if functional.get("doors"):
        for fraction, label in ((0.25, "doors_25_percent"), (0.50, "doors_50_percent"), (1.0, "doors_open")):
            for pivot in functional["doors"]:
                pivot.rotation_euler.z = math.radians(float(pivot["open_angle_degrees"])) * fraction
            bpy.context.view_layer.update()
            render(label, (camera_distance * 0.82, camera_distance * 0.74, spec.height * 1.45), (0.0, -0.25, 0.92))
        for pivot in functional["doors"]:
            pivot.rotation_euler.z = 0.0
    if functional.get("windshield_pivot"):
        functional["windshield_pivot"].rotation_euler.x = math.radians(92)
        bpy.context.view_layer.update()
        render("windshield_folded")
        functional["windshield_pivot"].rotation_euler.x = 0.0
    bpy.context.view_layer.update()
    remove_qa_objects()
    return outputs


def clean_reimport_validate(spec: CartSpec, expected: dict[str, Any]) -> dict[str, Any]:
    reset_scene()
    set_scene_contract()
    glb_path = EXPORT_DIR / f"golf_cart_{spec.slug}.glb"
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    root = bpy.data.objects.get(spec.asset_id)
    if root is None:
        raise RuntimeError(f"{spec.asset_id} clean re-import lost the asset root")
    objects = descendants(root)
    names = {obj.name for obj in objects}
    required = {
        "VehicleRoot",
        "Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR",
        "SteeringPivot_FL", "SteeringPivot_FR", "SteeringWheel",
        "DRIVER_CAMERA_ANCHOR", "CHARGE_PORT", "BATTERY_ACCESS_POINT",
        "COL_Chassis", "COL_FrontBody", "COL_RearBody", "COL_Roof",
    }
    required.update(expected["seat_anchors"])
    missing = sorted(required - names)
    if missing:
        raise RuntimeError(f"{spec.asset_id} clean re-import missing nodes: {missing}")
    if root.get("asset_id") != spec.asset_id or int(root.get("passenger_capacity", -1)) != spec.passenger_capacity:
        raise RuntimeError(f"{spec.asset_id} clean re-import lost metadata")
    meshes = [obj for obj in objects if obj.type == "MESH"]
    cameras = [obj.name for obj in objects if obj.type == "CAMERA"]
    lights = [obj.name for obj in objects if obj.type == "LIGHT"]
    if cameras or lights:
        raise RuntimeError(f"{spec.asset_id} GLB contains QA cameras/lights")
    minimum, maximum = mesh_bounds([
        obj for obj in meshes if lod_level(obj) == 0 and obj.get("collision_proxy") is not True
    ])
    report = {
        "asset_id": spec.asset_id,
        "glb": glb_path.relative_to(ROOT).as_posix(),
        "bytes": glb_path.stat().st_size,
        "root_metadata_preserved": True,
        "required_nodes_preserved": True,
        "required_node_count": len(required),
        "nodes": len(objects),
        "meshes": len(meshes),
        "measured_dimensions_m_xyz": [round(value, 4) for value in (maximum - minimum)],
        "cameras_in_glb": 0,
        "lights_in_glb": 0,
        "wheel_pivots_preserved": True,
        "steering_pivots_preserved": True,
        "seat_anchors_preserved": len(expected["seat_anchors"]),
        "collision_nodes_preserved": len([name for name in names if name.startswith("COL_")]),
    }
    set_lod_render(root, 0)
    camera_distance = max(4.8, spec.length * 1.85)
    setup_studio(
        target=(0.0, 0.0, spec.height * 0.48),
        camera_location=(camera_distance * 0.72, camera_distance, spec.height * 1.48),
        resolution=(1200, 900),
    )
    preview = QA_DIR / f"golf_cart_{spec.slug}_clean_reimport.png"
    bpy.context.scene.render.filepath = str(preview)
    bpy.ops.render.render(write_still=True)
    report["preview"] = preview.relative_to(ROOT).as_posix()
    (QA_DIR / f"golf_cart_{spec.slug}_reimport.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    return report


def build_one(spec: CartSpec) -> dict[str, Any]:
    root, functional, _mats, _groups = build_asset(spec)
    metrics = asset_metrics(spec, root, functional)
    source_path = SOURCE_DIR / f"golf_cart_{spec.slug}.blend"
    glb_path = EXPORT_DIR / f"golf_cart_{spec.slug}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path), check_existing=False)
    export_root(root, glb_path, animations=False)
    project_textures = [
        (TEXTURE_DIR / f"golf_cart_{spec.slug}_{role}.png").relative_to(ROOT).as_posix()
        for role in ("paint_roughness", "upholstery_roughness", "upholstery_normal")
    ]
    metrics.update({
        "source_blend": source_path.relative_to(ROOT).as_posix(),
        "export_glb": glb_path.relative_to(ROOT).as_posix(),
        "export_bytes": glb_path.stat().st_size,
        "build_version": BUILD_VERSION,
        "external_assets": [],
        "external_textures": [],
        "project_textures": project_textures,
        "brand_marks": [],
    })
    metrics["previews"] = render_asset_previews(spec, root, functional)
    reimport = clean_reimport_validate(spec, metrics)
    metrics["reimport"] = reimport
    (QA_DIR / f"golf_cart_{spec.slug}_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf8")
    config = {
        "assetId": spec.asset_id,
        "tier": spec.slug,
        "displayName": spec.label,
        "modelUrl": f"vendor/models/golf_carts/golf_cart_{spec.slug}.glb",
        "dimensionsMeters": {"width": spec.width, "length": spec.length, "height": spec.height},
        "wheelbaseMeters": spec.wheelbase,
        "wheelRadiusMeters": spec.wheel_radius,
        "passengerCapacity": spec.passenger_capacity,
        "forwardAxisBlender": "+Y",
        "forwardAxisRuntime": "-Z",
        "wheelNodes": ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"],
        "steeringNodes": ["SteeringPivot_FL", "SteeringPivot_FR"],
        "steeringWheelNode": "SteeringWheel",
        "seatAnchors": metrics["seat_anchors"],
        "entryPoints": metrics["entry_points"],
        "exitPoints": metrics["exit_points"],
        "golfBagSlots": metrics["golf_bag_slots"],
        "storageZones": metrics["storage_zones"],
        "doorNodes": metrics["door_nodes"],
        "windshieldType": metrics["windshield_type"],
        "chargePort": "CHARGE_PORT",
        "batteryAccess": "BATTERY_ACCESS_POINT",
        "collisionPrefix": "COL_",
        "lodDistancesMeters": [0, 22, 55],
        "projectTextureSources": project_textures,
    }
    (CONFIG_DIR / f"golf_cart_{spec.slug}.json").write_text(json.dumps(config, indent=2), encoding="utf8")
    print(
        f"GOLF_CART_BUILT|{spec.asset_id}|lod0={metrics['triangles_by_lod']['0']}|"
        f"lod1={metrics['triangles_by_lod']['1']}|lod2={metrics['triangles_by_lod']['2']}|"
        f"nodes={metrics['nodes']}|bytes={metrics['export_bytes']}"
    )
    return metrics


def build_comparison(results: list[dict[str, Any]]) -> dict[str, Any]:
    reset_scene()
    set_scene_contract()
    roots = []
    spacing = 2.55
    # The camera looks from +X, so place Basic at +X to make the rendered lineup
    # read Basic -> Luxury from left to right.
    start_x = spacing * 2
    for index, spec in enumerate(SPECS):
        bpy.ops.import_scene.gltf(filepath=str(EXPORT_DIR / f"golf_cart_{spec.slug}.glb"))
        root = bpy.data.objects.get(spec.asset_id)
        if root is None:
            raise RuntimeError(f"comparison import lost {spec.asset_id}")
        root.location.x = start_x - index * spacing
        set_lod_render(root, 0)
        roots.append(root)
    camera = setup_studio(
        target=(0.0, 0.0, 0.85),
        camera_location=(8.0, 18.5, 7.5),
        resolution=(2000, 900),
    )
    camera.data.lens = 55
    look_at(camera, (0.0, 0.0, 0.82))
    comparison_path = QA_DIR / "golf_cart_progression_comparison.png"
    bpy.context.scene.render.filepath = str(comparison_path)
    bpy.ops.render.render(write_still=True)
    blend_path = SOURCE_DIR / "golf_cart_validation_scene.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    report = {
        "asset_order": [spec.asset_id for spec in SPECS],
        "spacing_m": spacing,
        "comparison_render": comparison_path.relative_to(ROOT).as_posix(),
        "validation_scene": blend_path.relative_to(ROOT).as_posix(),
        "passenger_capacities": [spec.passenger_capacity for spec in SPECS],
        "target_dimensions_m_xyz": [result["target_dimensions_m_xyz"] for result in results],
    }
    return report


def main() -> None:
    missing_references = [spec.reference_file for spec in SPECS if not (REFERENCE_DIR / spec.reference_file).exists()]
    if missing_references:
        raise FileNotFoundError(f"Missing golf-cart references: {missing_references}")
    results = [build_one(spec) for spec in SPECS]
    comparison = build_comparison(results)
    catalog = {
        "schemaVersion": 1,
        "buildVersion": BUILD_VERSION,
        "source": "Original project-authored Blender Python geometry",
        "license": "project-owned / UNLICENSED",
        "externalAssets": [],
        "externalTextures": [],
        "projectTextures": sorted({
            texture
            for spec in SPECS
            for texture in json.loads((CONFIG_DIR / f"golf_cart_{spec.slug}.json").read_text(encoding="utf8"))["projectTextureSources"]
        }),
        "referenceDirectory": "Designs/Golf_Carts",
        "carts": [json.loads((CONFIG_DIR / f"golf_cart_{spec.slug}.json").read_text(encoding="utf8")) for spec in SPECS],
    }
    (CONFIG_DIR / "golf_cart_catalog.json").write_text(json.dumps(catalog, indent=2), encoding="utf8")
    report = {
        "buildVersion": BUILD_VERSION,
        "blenderVersion": bpy.app.version_string,
        "referencesInspected": [f"Designs/Golf_Carts/{spec.reference_file}" for spec in SPECS],
        "sourceProtection": "Owner-supplied references and raw Tripo assets were read only and never overwritten.",
        "externalAssets": [],
        "externalTextures": [],
        "projectTextures": sorted({texture for result in results for texture in result["project_textures"]}),
        "assets": results,
        "comparison": comparison,
    }
    report_path = QA_DIR / "golf_cart_build_report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf8")
    print(
        f"GOLF_CART_FLEET_COMPLETE|assets={len(results)}|report={report_path.relative_to(ROOT).as_posix()}|"
        f"comparison={comparison['comparison_render']}"
    )


if __name__ == "__main__":
    main()
