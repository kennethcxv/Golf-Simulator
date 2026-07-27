"""Build Sheet 06 production assets (51-60) for Pinehollow Golf Flipper.

Run from Blender, for example::

    blender --background --factory-startup --python tools/blender/build_assets_51_60.py --
    blender --background --factory-startup --python tools/blender/build_assets_51_60.py -- --asset 51

All dimensions are authored in metres.  The exterior pair deliberately shares a
deterministic registration manifest: asset 51 owns structural geometry and
blocking collision, while asset 52 is an additive, non-structural damage layer.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
from array import array
from collections.abc import Callable, Sequence
from pathlib import Path

import bpy

# Blender does not consistently add the executed script's directory to sys.path.
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import assets_51_100_lib as A


REGISTRATION_ID = "PINEHOLLOW_CLUBHOUSE_S06_V1"
SHELL_W = 16.80
SHELL_D = 10.50
SHELL_H = 7.13
EAVE_H = 4.02
WALL_T = 0.23
INTERIOR_LINER_T = 0.028
FLOOR_Z = 0.27432
FRONT_Y = -SHELL_D / 2.0
DOOR_X = -0.73152

IDENTITIES = {
    51: A.AssetIdentity(51, "finished_clubhouse_exterior"),
    52: A.AssetIdentity(52, "dilapidated_clubhouse_exterior"),
    53: A.AssetIdentity(53, "main_entrance_double_door"),
    54: A.AssetIdentity(54, "exterior_porch_and_steps"),
    55: A.AssetIdentity(55, "clubhouse_windows_set"),
    56: A.AssetIdentity(56, "interior_wall_panel_kit"),
    57: A.AssetIdentity(57, "interior_trim_and_baseboard_kit"),
    58: A.AssetIdentity(58, "ceiling_and_beam_kit"),
    59: A.AssetIdentity(59, "renovated_flooring_set"),
    60: A.AssetIdentity(60, "damaged_flooring_set"),
}

DIMENSIONS = {
    51: (16.80, 10.50, 7.13),
    52: (16.80, 10.50, 7.13),
    53: (1.80, 0.24, 2.45),
    54: (11.52, 3.29, 4.02),
    55: (2.19, 0.23, 1.74),
    56: (1.20, 0.075, 1.15),
    57: (2.40, 0.025, 0.14),
    58: (3.60, 0.20, 0.24),
    59: (1.00, 1.00, 0.018),
    60: (1.00, 1.00, 0.035),
}

REQUIRED_MARKERS = {
    51: ("SOCKET_MainEntrance", "SOCKET_Porch", "SOCKET_ClubSign", "SOCKET_ExteriorLight_W", "SOCKET_ExteriorLight_E", "SOCKET_PLACEMENT"),
    52: ("SOCKET_MainEntrance", "SOCKET_Porch", "SOCKET_ClubSign", "SOCKET_Damage_Roof", "SOCKET_Damage_Trim", "SOCKET_PLACEMENT"),
    53: ("PIVOT_DoorLeft", "PIVOT_DoorRight", "SOCKET_HandleLeft", "SOCKET_HandleRight", "SOCKET_Threshold", "SOCKET_PLACEMENT"),
    54: ("SOCKET_MainEntrance", "SOCKET_Railing_W", "SOCKET_Railing_E", "SOCKET_Column_W", "SOCKET_Column_E", "SOCKET_PLACEMENT"),
    55: ("SOCKET_WindowStandard", "SOCKET_WindowNarrow", "SOCKET_WindowWide", "SOCKET_WindowArched", "SOCKET_PLACEMENT"),
    56: ("SOCKET_PanelNext", "SOCKET_InsideCorner", "SOCKET_OutsideCorner", "SOCKET_DoorConnector", "SOCKET_WindowConnector", "SOCKET_PLACEMENT"),
    57: ("SOCKET_TrimNext", "SOCKET_InsideCorner", "SOCKET_OutsideCorner", "SOCKET_EndCap", "SOCKET_Junction", "SOCKET_PLACEMENT"),
    58: ("SOCKET_BeamNext", "SOCKET_BeamCross", "SOCKET_BeamEnd", "SOCKET_RecessedLight", "SOCKET_PLACEMENT"),
    59: ("SOCKET_FloorOrigin", "SOCKET_FloorTransition", "SOCKET_PLACEMENT"),
    60: ("SOCKET_FloorOrigin", "SOCKET_DamageModule", "SOCKET_FloorTransition", "SOCKET_PLACEMENT"),
}

DOOR_ANIMATIONS = ("DoorLeft_Open", "DoorLeft_Close", "DoorRight_Open", "DoorRight_Close")

# Both exterior assets receive this exact socket set and its SHA-256 signature.
# Values are local-space [x, y, z] metres followed by XYZ Euler radians.
EXTERIOR_REGISTRATION = {
    "SOCKET_MainEntrance": ([DOOR_X, FRONT_Y, FLOOR_Z], [0.0, 0.0, 0.0]),
    "SOCKET_Porch": ([-0.9144, FRONT_Y, FLOOR_Z], [0.0, 0.0, 0.0]),
    "SOCKET_ClubSign": ([2.37744, FRONT_Y - 0.001, 3.33], [math.pi / 2.0, 0.0, 0.0]),
    "SOCKET_ExteriorLight_W": ([DOOR_X - 1.34, FRONT_Y - 0.001, 2.42], [math.pi / 2.0, 0.0, 0.0]),
    "SOCKET_ExteriorLight_E": ([DOOR_X + 1.34, FRONT_Y - 0.001, 2.42], [math.pi / 2.0, 0.0, 0.0]),
    "SOCKET_Damage_Roof": ([0.0, 0.0, 7.02], [0.0, 0.0, 0.0]),
    "SOCKET_Damage_Trim": ([DOOR_X, FRONT_Y, EAVE_H], [0.0, 0.0, 0.0]),
    "SOCKET_PLACEMENT": ([0.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
}


def _manifest_json() -> str:
    payload = {key: {"location_m": value[0], "rotation_xyz_rad": value[1]} for key, value in sorted(EXTERIOR_REGISTRATION.items())}
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


REGISTRATION_MANIFEST = _manifest_json()
REGISTRATION_SHA256 = hashlib.sha256(REGISTRATION_MANIFEST.encode("utf-8")).hexdigest()


def _group(name: str, parent: bpy.types.Object, **properties: object) -> bpy.types.Object:
    obj = bpy.data.objects.new(name if name.startswith("LOD") else "LOD0_" + name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.08
    obj["lod_level"] = 0
    for key, value in properties.items():
        obj[key] = value
    A.parent_keep_world(obj, parent)
    return obj


def _root(number: int, **properties: object) -> tuple[bpy.types.Object, dict[str, bpy.types.Material]]:
    identity = IDENTITIES[number]
    root = A.asset_root(identity, DIMENSIONS[number])
    root["production_sheet"] = "06"
    root["authored_units"] = "meters"
    root["runtime_unit_conversion"] = "meters_to_yards_once:1.0936133"
    root["visual_style"] = "stylized PBR; warm cream, golf green, sage, walnut, oak, charcoal, restrained brass"
    root["lod_policy"] = "LOD0 authored; distance/indoor gating supplies coarse runtime culling"
    root["asset_budget"] = "sheet06 production budget"
    for key, value in properties.items():
        root[key] = value
    return root, A.palette_materials()


def _marker(name: str, root: bpy.types.Object, location=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0), **properties: object) -> bpy.types.Object:
    marker = A.socket(name, location=location, rotation=rotation, parent=root, properties=properties)
    return marker


def _placement(root: bpy.types.Object) -> None:
    _marker("PLACEMENT", root, placement_contract="origin_on_finished_floor_or_grade")


def _exterior_registration(root: bpy.types.Object, structural_authority: bool) -> None:
    root["registration_id"] = REGISTRATION_ID
    root["registration_manifest_json"] = REGISTRATION_MANIFEST
    root["registration_manifest_sha256"] = REGISTRATION_SHA256
    root["structural_authority"] = structural_authority
    root["composition_contract"] = "asset51 structural base + asset52 additive damage overlay"
    for name, (location, rotation) in sorted(EXTERIOR_REGISTRATION.items()):
        A.socket(name, location=location, rotation=rotation, parent=root, properties={
            "registration_id": REGISTRATION_ID,
            "registration_sha256": REGISTRATION_SHA256,
            "shared_between_assets": "51,52",
        })


def _custom_materials(p: dict[str, bpy.types.Material]) -> dict[str, bpy.types.Material]:
    return {
        "stone": A.material("S06_WarmFieldstone", (0.31, 0.27, 0.21, 1.0), roughness=0.82),
        "roof": A.material("S06_CharcoalShingle", (0.105, 0.095, 0.082, 1.0), roughness=0.88),
        "moss": A.material("S06_Moss", (0.12, 0.20, 0.08, 1.0), roughness=0.94),
        "grime": A.material("S06_GrimeWash", (0.12, 0.105, 0.075, 0.58), roughness=0.92, alpha=0.58, double_sided=True),
        "rot": A.material("S06_RottedWood", (0.16, 0.095, 0.052, 1.0), roughness=0.96),
        "rust": A.material("S06_Rust", (0.30, 0.095, 0.035, 1.0), roughness=0.90),
        "plaster": A.material("S06_WarmPlaster", (0.72, 0.68, 0.58, 1.0), roughness=0.79),
        # The Course-1 reference authors the entrance leaves as deep golf green
        # painted wood over the sage siding; hardware stays restrained brass.
        "door_green": A.material("S06_DeepGolfGreenDoor", (0.075, 0.17, 0.12, 1.0), roughness=0.55),
        "interior_plaster": A.material("S06_InteriorWarmCreamPlaster", (0.78, 0.72, 0.61, 1.0), roughness=0.91),
        "interior_sage": A.material("S06_InteriorMutedSagePlaster", (0.34, 0.40, 0.30, 1.0), roughness=0.91),
        "ceiling_plaster": A.material("S06_QuietWarmCreamCeiling", (0.82, 0.76, 0.65, 1.0), roughness=0.93),
        "clear_glass": A.material(
            "S06_ClearWindowGlass",
            (0.47, 0.61, 0.56, 0.30),
            roughness=0.18,
            alpha=0.30,
            # GLTF KHR_materials_transmission re-renders the full clubhouse
            # once per pane. Four live Asset-55 windows multiplied the active
            # vacuum pass by roughly 4.6M triangles. Alpha-blended tint keeps
            # the same clear player view without a per-pane scene refraction.
            transmission=0.0,
            ior=1.45,
            double_sided=True,
        ),
        "carpet_sage": A.material("S06_SageCarpet", (0.25, 0.34, 0.25, 1.0), roughness=0.98),
        "carpet_gray": A.material("S06_GrayCarpet", (0.28, 0.29, 0.27, 1.0), roughness=0.98),
        "cream_tile": A.material("S06_CreamTile", (0.72, 0.68, 0.56, 1.0), roughness=0.48),
        "stone_tile": A.material("S06_StoneTile", (0.39, 0.39, 0.34, 1.0), roughness=0.67),
        "water_stain": A.material("S06_WaterStain", (0.18, 0.135, 0.075, 0.72), roughness=0.94, alpha=0.72, double_sided=True),
        "dark_wood": A.material("S06_DarkWood", (0.11, 0.060, 0.034, 1.0), roughness=0.60),
        "lamp": A.material("S06_WarmLamp", (0.72, 0.49, 0.19, 1.0), roughness=0.34, emission_color=(1.0, 0.53, 0.20), emission_strength=1.5),
    }


TEXTURE_DIR = A.REPO_ROOT / "Assets" / "assets_51_100" / "textures" / "sheet_06"
VARIANT_PREVIEW_DIR = A.REPO_ROOT / "qa" / "assets_51_100_master" / "sheet_06" / "variant_previews"


def _noise(x: int, y: int, seed: int) -> float:
    value = (x * 73856093) ^ (y * 19349663) ^ (seed * 83492791)
    value = (value ^ (value >> 13)) * 1274126177
    return ((value ^ (value >> 16)) & 0xFFFF) / 65535.0


def _texture_rgb(kind: str, x: int, y: int, size: int) -> tuple[float, float, float]:
    u, v = x / max(1, size - 1), y / max(1, size - 1)
    n = _noise(x, y, len(kind) * 17)
    if kind == "siding_green":
        # Authored as sRGB, like the wood bases below.  The first pass used
        # (0.030, 0.155, 0.095) -- about #082818 -- which is barely off black.  In
        # game the whole south elevation read as a silhouette: you could not see the
        # clapboard, the grime sitting on it, or the clean stripe a pressure washer
        # had just cut through that grime, which makes the washing loop illegible.
        # Reference 51 is a mid sage-hunter green with the boards clearly readable.
        # The groove stays proportionally dark so the shadow line still separates
        # the courses.
        groove = 0.34 if y % 32 in (0, 1, 2) else 1.0
        board = 0.88 + 0.08 * math.sin(v * math.pi * 16.0) + (n - 0.5) * 0.025
        return (0.280 * board * groove, 0.400 * board * groove, 0.310 * board * groove)
    if kind == "charcoal_shingle":
        row = y // 22
        seam_x = (x + (11 if row % 2 else 0)) % 44
        seam = 0.42 if y % 22 in (0, 1) or seam_x in (0, 1) else 1.0
        value = (0.105 + (n - 0.5) * 0.055) * seam
        return (value * 0.92, value * 0.98, value)
    if kind == "fieldstone":
        row = y // 42
        seam_x = (x + (21 if row % 2 else 0)) % 64
        mortar = y % 42 < 4 or seam_x < 4
        if mortar:
            return (0.24, 0.225, 0.19)
        value = 0.30 + (n - 0.5) * 0.12 + 0.04 * math.sin((x + y) * 0.09)
        return (value * 1.05, value * 0.92, value * 0.72)
    wood_bases = {
        # These are authored as sRGB texture values.  The previous values and
        # high-amplitude sine grain collapsed to near-black walnut and orange,
        # wavy oak after colour management in game.
        "walnut": (0.33, 0.19, 0.11),
        "oak": (0.60, 0.43, 0.27),
        # Asset-specific architectural finishes avoid pushing the brighter
        # porch/door palette onto the large interior floor, wall and ceiling
        # fields.  Values are authored sRGB and deliberately restrained.
        "floor_oak": (0.48, 0.39, 0.28),
        "architectural_walnut": (0.38, 0.27, 0.19),
        "weathered_board_wood": (0.52, 0.46, 0.40),
        "dark_wood": (0.19, 0.105, 0.060),
        "damaged_wood": (0.115, 0.052, 0.022),
    }
    if kind in wood_bases:
        base = wood_bases[kind]
        if kind == "floor_oak":
            # A low-contrast, exactly tileable long grain removes the visible
            # colour discontinuity where one-metre runtime modules meet.
            grain = (
                0.925
                + 0.026 * math.sin(math.tau * (5.0 * v + 0.12 * math.sin(math.tau * u)))
                + 0.012 * math.sin(math.tau * (13.0 * v + 2.0 * u))
                + 0.006 * math.sin(math.tau * (29.0 * v - 3.0 * u))
            )
        elif kind == "oak":
            # Long, low-contrast grain; physical plank gaps are modeled in 59.
            # Omitting painted-in cross seams prevents the old brick lattice.
            grain = (
                0.93
                + 0.032 * math.sin(v * 34.0 + math.sin(u * 5.0) * 0.55)
                + 0.014 * math.sin(v * 87.0 + u * 2.0)
                + (n - 0.5) * 0.022
            )
        elif kind == "architectural_walnut":
            grain = (
                0.88
                + 0.034 * math.sin(math.tau * (4.0 * v + 0.10 * math.sin(math.tau * u)))
                + 0.014 * math.sin(math.tau * (11.0 * v + 2.0 * u))
            )
        elif kind == "weathered_board_wood":
            grain = (
                0.84
                + 0.065 * math.sin(v * 61.0 + math.sin(u * 9.0) * 1.1)
                + 0.024 * math.sin(v * 137.0 - u * 3.0)
                + (n - 0.5) * 0.035
            )
        elif kind == "damaged_wood":
            # Damage assets retain their stronger authored contrast; this
            # revision only quiets finished oak/walnut surfaces.
            grain = 0.76 + 0.17 * math.sin(v * 118.0 + math.sin(u * 21.0) * 2.8) + (n - 0.5) * 0.09
            if x % 64 in (0, 1, 2):
                grain *= 0.33
        else:
            grain = (
                0.90
                + 0.050 * math.sin(v * 46.0 + math.sin(u * 7.0) * 0.70)
                + 0.018 * math.sin(v * 103.0 + u * 2.5)
                + (n - 0.5) * 0.030
            )
        if kind == "damaged_wood":
            stain = max(0.0, 1.0 - math.hypot(u - 0.68, v - 0.35) * 2.8)
            grain *= 1.0 - stain * 0.58
            if abs(math.sin(u * 29.0 + v * 41.0)) < 0.035:
                grain *= 0.30
        return tuple(max(0.005, min(1.0, channel * grain)) for channel in base)
    if kind in ("sage_carpet", "gray_carpet", "damaged_carpet"):
        base = (0.17, 0.26, 0.18) if kind != "gray_carpet" else (0.27, 0.28, 0.26)
        fibre = 0.78 + n * 0.24 + 0.04 * math.sin((x + y) * 1.7)
        if kind == "damaged_carpet":
            base = (0.19, 0.16, 0.10)
            blotch = max(0.0, 1.0 - math.hypot(u - 0.42, v - 0.58) * 3.0)
            fibre *= 1.0 - blotch * 0.65
        return tuple(channel * fibre for channel in base)
    tile_base = (0.62, 0.57, 0.45) if kind == "cream_tile" else (0.32, 0.33, 0.30)
    if kind == "damaged_tile":
        tile_base = (0.27, 0.25, 0.20)
    grid = x % 64 < 4 or y % 64 < 4
    if grid:
        return (0.15, 0.14, 0.12)
    value = 0.88 + (n - 0.5) * 0.15
    if kind == "damaged_tile" and abs(math.sin(u * 37.0 + v * 31.0)) < 0.045:
        value *= 0.25
    return tuple(channel * value for channel in tile_base)


def _write_texture(kind: str, *, size: int = 256) -> Path:
    """Write and pack a deterministic, original Sheet-6 base-colour texture."""

    TEXTURE_DIR.mkdir(parents=True, exist_ok=True)
    path = TEXTURE_DIR / f"s06_{kind}.png"
    image_name = f"S06_{kind.upper()}_IMAGE"
    existing = bpy.data.images.get(image_name)
    if existing is not None:
        bpy.data.images.remove(existing)
    image = bpy.data.images.new(image_name, width=size, height=size, alpha=True, float_buffer=False)
    pixels = array("f")
    for y in range(size):
        for x in range(size):
            red, green, blue = _texture_rgb(kind, x, y, size)
            pixels.extend((red, green, blue, 1.0))
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image["project_owned"] = True
    image["generator"] = "build_assets_51_60.py deterministic Sheet-6 texture"
    image.save()
    image.pack()
    return path


def _texture_material(kind: str, *, roughness: float) -> bpy.types.Material:
    path = _write_texture(kind)
    return A.project_texture_material(f"S06_{kind}", path, roughness=roughness)


def _surface_materials(*kinds: str) -> dict[str, bpy.types.Material]:
    roughness = {
        "siding_green": 0.76,
        "charcoal_shingle": 0.90,
        "fieldstone": 0.88,
        "walnut": 0.69,
        "oak": 0.76,
        "floor_oak": 0.90,
        "architectural_walnut": 0.86,
        "weathered_board_wood": 0.94,
        "dark_wood": 0.74,
        "sage_carpet": 0.98,
        "gray_carpet": 0.98,
        "cream_tile": 0.52,
        "stone_tile": 0.72,
        "damaged_wood": 0.92,
        "damaged_carpet": 0.99,
        "damaged_tile": 0.90,
    }
    return {kind: _texture_material(kind, roughness=roughness[kind]) for kind in kinds}


def _join_meshes(
    name: str,
    objects: Sequence[bpy.types.Object],
    *,
    parent: bpy.types.Object,
    properties: dict[str, object] | None = None,
    hide_render: bool = False,
) -> bpy.types.Object:
    meshes = [obj for obj in objects if obj is not None and obj.type == "MESH"]
    if not meshes:
        raise ValueError(f"{name} has no meshes to join")
    active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in meshes:
            obj.hide_set(False)
            obj.select_set(True)
        bpy.context.view_layer.objects.active = active
        bpy.ops.object.join()
    active.name = name if name.startswith("MESH_") else "MESH_" + name
    active.data.name = active.name + "_DATA"
    A.parent_keep_world(active, parent)
    active.hide_render = hide_render
    active["joined_production_detail"] = True
    for key, value in (properties or {}).items():
        active[key] = value
    return active


def _variant_properties(variant: str, *, default: bool = False) -> dict[str, object]:
    return {
        "variant_id": variant,
        "runtime_variant": True,
        "variant_default": default,
        "runtime_visibility_contract": "adapter selects exactly one variant_id; Blender hide_render is preview-only",
    }


def _box(name, dims, loc, mat, parent, **kwargs):
    return A.box(name, dims, loc, mat, parent=parent, **kwargs)


def _segment_box_yz(name: str, start: tuple[float, float, float], end: tuple[float, float, float], thickness: float, mat: bpy.types.Material, parent: bpy.types.Object, **kwargs) -> bpy.types.Object:
    """Create a closed rectangular rail along a segment in the YZ plane."""

    dy, dz = end[1] - start[1], end[2] - start[2]
    length = math.hypot(dy, dz)
    center = tuple((a + b) / 2.0 for a, b in zip(start, end))
    return _box(name, (thickness, length, thickness), center, mat, parent, rotation=(math.atan2(dz, dy), 0.0, 0.0), **kwargs)


def _segment_box_xz(name: str, start: tuple[float, float, float], end: tuple[float, float, float], thickness: float, mat: bpy.types.Material, parent: bpy.types.Object, **kwargs) -> bpy.types.Object:
    """Create a closed rectangular brace along a segment in the XZ plane."""

    dx, dz = end[0] - start[0], end[2] - start[2]
    length = math.hypot(dx, dz)
    center = tuple((a + b) / 2.0 for a, b in zip(start, end))
    return _box(name, (length, thickness, thickness), center, mat, parent, rotation=(0.0, -math.atan2(dz, dx), 0.0), **kwargs)


def _front_wall_segment(name: str, x0: float, x1: float, z0: float, z1: float, parent: bpy.types.Object, mat: bpy.types.Material) -> None:
    if x1 - x0 > 0.01 and z1 - z0 > 0.01:
        _box(name, (x1 - x0, WALL_T, z1 - z0), ((x0 + x1) / 2.0, FRONT_Y + WALL_T / 2.0, (z0 + z1) / 2.0), mat, parent, bevel=0.012)


def _front_casing(
    name: str,
    x0: float,
    x1: float,
    z0: float,
    z1: float,
    parent: bpy.types.Object,
    mat: bpy.types.Material,
    *,
    sill: bool,
) -> bpy.types.Object:
    depth, width = 0.075, 0.13
    y = FRONT_Y + depth / 2.0
    parts = [
        _box(f"{name}_CasingLeft", (width, depth, z1 - z0 + width), (x0 - width / 2.0, y, (z0 + z1) / 2.0), mat, parent, bevel=0.014),
        _box(f"{name}_CasingRight", (width, depth, z1 - z0 + width), (x1 + width / 2.0, y, (z0 + z1) / 2.0), mat, parent, bevel=0.014),
        _box(f"{name}_CasingHead", (x1 - x0 + 2 * width, depth, width), ((x0 + x1) / 2.0, y, z1 + width / 2.0), mat, parent, bevel=0.014),
    ]
    if sill:
        parts.append(_box(f"{name}_ProjectingSill", (x1 - x0 + 0.30, 0.105, 0.10), ((x0 + x1) / 2.0, FRONT_Y + 0.0525, z0 - 0.05), mat, parent, bevel=0.016))
    return _join_meshes(f"{name}_CreamCasing", parts, parent=parent, properties={"aperture_trim": True})


def _dormer(
    name: str,
    center_x: float,
    width: float,
    base_z: float,
    parent: bpy.types.Object,
    siding: bpy.types.Material,
    shingle: bpy.types.Material,
    cream: bpy.types.Material,
    recess: bpy.types.Material,
) -> None:
    front_y, back_y = -3.62, -2.24
    eave_z, apex_z = base_z + 1.18, base_z + 1.86
    opening_w, opening_h = width * 0.46, 0.74
    opening_z0 = base_z + 0.26
    opening_z1 = opening_z0 + opening_h
    x0, x1 = center_x - opening_w / 2.0, center_x + opening_w / 2.0
    facade = [
        _box(f"{name}_FacadeLeft", ((width - opening_w) / 2.0, 0.15, eave_z - base_z), (center_x - (width + opening_w) / 4.0, front_y, (base_z + eave_z) / 2.0), siding, parent, bevel=0.012),
        _box(f"{name}_FacadeRight", ((width - opening_w) / 2.0, 0.15, eave_z - base_z), (center_x + (width + opening_w) / 4.0, front_y, (base_z + eave_z) / 2.0), siding, parent, bevel=0.012),
        _box(f"{name}_FacadeBelow", (opening_w, 0.15, opening_z0 - base_z), (center_x, front_y, (base_z + opening_z0) / 2.0), siding, parent, bevel=0.012),
        _box(f"{name}_FacadeAbove", (opening_w, 0.15, eave_z - opening_z1), (center_x, front_y, (opening_z1 + eave_z) / 2.0), siding, parent, bevel=0.012),
        _box(f"{name}_CheekWest", (0.12, back_y - front_y, eave_z - base_z), (center_x - width / 2.0 + 0.06, (front_y + back_y) / 2.0, (base_z + eave_z) / 2.0), siding, parent, bevel=0.010),
        _box(f"{name}_CheekEast", (0.12, back_y - front_y, eave_z - base_z), (center_x + width / 2.0 - 0.06, (front_y + back_y) / 2.0, (base_z + eave_z) / 2.0), siding, parent, bevel=0.010),
        A.profile_prism(f"{name}_FrontGable", [(-width / 2.0, eave_z), (width / 2.0, eave_z), (0.0, apex_z)], 0.15, (center_x, front_y, 0.0), siding, parent=parent, bevel=0.010),
    ]
    _join_meshes(f"{name}_SidedStructure", facade, parent=parent, properties={"structural_geometry": True, "dormer": True})
    roof_rise = apex_z - eave_z
    roof_run = width / 2.0 + 0.10
    roof_angle = math.atan2(roof_rise, roof_run)
    roof_length = math.hypot(roof_run, roof_rise)
    roofs = [
        _box(f"{name}_RoofWest", (roof_length, back_y - front_y + 0.24, 0.10), (center_x - roof_run / 2.0, (front_y + back_y) / 2.0, (eave_z + apex_z) / 2.0), shingle, parent, rotation=(0.0, -roof_angle, 0.0), bevel=0.010),
        _box(f"{name}_RoofEast", (roof_length, back_y - front_y + 0.24, 0.10), (center_x + roof_run / 2.0, (front_y + back_y) / 2.0, (eave_z + apex_z) / 2.0), shingle, parent, rotation=(0.0, roof_angle, 0.0), bevel=0.010),
    ]
    _join_meshes(f"{name}_ShingleRoof", roofs, parent=parent, properties={"structural_geometry": True, "dormer": True})
    casing = [
        _box(f"{name}_WindowLeft", (0.10, 0.07, opening_h + 0.10), (x0 - 0.05, front_y - 0.05, (opening_z0 + opening_z1) / 2.0), cream, parent, bevel=0.012),
        _box(f"{name}_WindowRight", (0.10, 0.07, opening_h + 0.10), (x1 + 0.05, front_y - 0.05, (opening_z0 + opening_z1) / 2.0), cream, parent, bevel=0.012),
        _box(f"{name}_WindowHead", (opening_w + 0.20, 0.07, 0.10), (center_x, front_y - 0.05, opening_z1 + 0.05), cream, parent, bevel=0.012),
        _box(f"{name}_WindowSill", (opening_w + 0.28, 0.10, 0.09), (center_x, front_y - 0.065, opening_z0 - 0.045), cream, parent, bevel=0.012),
    ]
    _join_meshes(f"{name}_CreamWindowCasing", casing, parent=parent, properties={"modular_window_receiver": True})
    _box(f"{name}_WindowRecess", (opening_w, 0.025, opening_h), (center_x, front_y + 0.086, (opening_z0 + opening_z1) / 2.0), recess, parent, bevel=0.004, properties={"aperture_shadow": True, "replace_with_asset_55": True})


def build_51() -> bpy.types.Object:
    root, p = _root(
        51,
        structural_shell=True,
        structural_role="CANONICAL_STRUCTURAL_AUTHORITY",
        structural_authority=True,
        mesh_budget=80,
        triangle_budget=120000,
    )
    m = _custom_materials(p)
    surface = _surface_materials("siding_green", "charcoal_shingle", "fieldstone")
    aperture_recess = A.material("S06_ClubhouseApertureRecess", (0.012, 0.018, 0.014, 1.0), roughness=0.92)
    shell = _group("LOD0_StructuralShell", root, structural_authority=True)
    interior_liners = _group(
        "LOD0_InteriorPlasterLiners",
        root,
        structural_authority=True,
        interior_finish=True,
        finish_role="muted-sage upper-wall plaster liner with aperture-safe segmentation",
    )
    roof_group = _group("LOD0_RoofStructure", root)
    details = _group("LOD0_ExteriorDetails", root)
    dormers = _group("LOD0_DormeredGables", root, structural_authority=True)
    collision = _group("LOD0_StructuralCollision", root, collision_authority=True)
    _exterior_registration(root, True)

    # Foundation/slab is the structural floor only; finish flooring belongs to 59/60.
    _box("FoundationPlinth", (SHELL_W, SHELL_D, FLOOR_Z), (0.0, 0.0, FLOOR_Z / 2.0), surface["fieldstone"], shell, bevel=0.025)

    # Front wall has real door and window apertures.  No door/window meshes are duplicated here.
    openings = [
        (-8.68452, -6.49452, FLOOR_Z + 0.77724, FLOOR_Z + 2.51724, "WindowWest"),
        (-5.57556, -3.38556, FLOOR_Z + 0.77724, FLOOR_Z + 2.51724, "WindowMid"),
        (DOOR_X - 0.90, DOOR_X + 0.90, FLOOR_Z, FLOOR_Z + 2.45, "MainDoor"),
    ]
    cursor = -SHELL_W / 2.0
    for index, (x0, x1, low, high, label) in enumerate(openings):
        _front_wall_segment(f"FrontPier_{index}", cursor, x0, FLOOR_Z, EAVE_H, shell, surface["siding_green"])
        if low > FLOOR_Z + 0.005:
            _front_wall_segment(f"FrontBelow_{label}", x0, x1, FLOOR_Z, low, shell, surface["siding_green"])
        _front_wall_segment(f"FrontAbove_{label}", x0, x1, high, EAVE_H, shell, surface["siding_green"])
        cursor = x1
    _front_wall_segment("FrontPier_East", cursor, SHELL_W / 2.0, FLOOR_Z, EAVE_H, shell, surface["siding_green"])

    # Back wall has the north lounge window at the authoritative layout datum.
    # Segmenting the structure prevents the modular Asset-55 window from being
    # placed over an opaque green wall.
    back_window_center_x = 3.0 * 0.9144
    back_window_x0 = back_window_center_x - 2.19 / 2.0
    back_window_x1 = back_window_center_x + 2.19 / 2.0
    back_window_low = FLOOR_Z + 0.77724
    back_window_high = FLOOR_Z + 2.51724
    back_wall_parts = [
        _box("BackWallWest", (back_window_x0 + SHELL_W / 2.0, WALL_T, EAVE_H - FLOOR_Z), ((-SHELL_W / 2.0 + back_window_x0) / 2.0, SHELL_D / 2.0 - WALL_T / 2.0, (FLOOR_Z + EAVE_H) / 2.0), surface["siding_green"], shell, bevel=0.012),
        _box("BackWallEast", (SHELL_W / 2.0 - back_window_x1, WALL_T, EAVE_H - FLOOR_Z), ((back_window_x1 + SHELL_W / 2.0) / 2.0, SHELL_D / 2.0 - WALL_T / 2.0, (FLOOR_Z + EAVE_H) / 2.0), surface["siding_green"], shell, bevel=0.012),
        _box("BackWallBelowWindow", (back_window_x1 - back_window_x0, WALL_T, back_window_low - FLOOR_Z), (back_window_center_x, SHELL_D / 2.0 - WALL_T / 2.0, (FLOOR_Z + back_window_low) / 2.0), surface["siding_green"], shell, bevel=0.012),
        _box("BackWallAboveWindow", (back_window_x1 - back_window_x0, WALL_T, EAVE_H - back_window_high), (back_window_center_x, SHELL_D / 2.0 - WALL_T / 2.0, (back_window_high + EAVE_H) / 2.0), surface["siding_green"], shell, bevel=0.012),
    ]
    _join_meshes("BackWall", back_wall_parts, parent=shell, properties={"structural_geometry": True, "aperture": "north-lounge-window"})

    # Side-wall apertures are likewise authored as segmented construction.
    _box("WestWall", (WALL_T, SHELL_D - 2 * WALL_T, EAVE_H - FLOOR_Z), (-SHELL_W / 2.0 + WALL_T / 2.0, 0.0, (FLOOR_Z + EAVE_H) / 2.0), surface["siding_green"], shell, bevel=0.012)
    east_x = SHELL_W / 2.0 - WALL_T / 2.0
    # East openings: service door at y=+3.29184 and standard window at y=-4.20624.
    east_openings = [(-5.30124, -3.11124, FLOOR_Z + 0.77724, FLOOR_Z + 2.51724, "EastWindow"),
                     (2.60604, 3.97764, FLOOR_Z, FLOOR_Z + 2.286, "ServiceDoor")]
    y_cursor = -SHELL_D / 2.0 + WALL_T
    for index, (y0, y1, low, high, label) in enumerate(east_openings):
        if y0 > y_cursor:
            _box(f"EastPier_{index}", (WALL_T, y0 - y_cursor, EAVE_H - FLOOR_Z), (east_x, (y_cursor + y0) / 2.0, (FLOOR_Z + EAVE_H) / 2.0), surface["siding_green"], shell, bevel=0.010)
        if low > FLOOR_Z + 0.005:
            _box(f"EastBelow_{label}", (WALL_T, y1 - y0, low - FLOOR_Z), (east_x, (y0 + y1) / 2.0, (FLOOR_Z + low) / 2.0), surface["siding_green"], shell, bevel=0.010)
        _box(f"EastAbove_{label}", (WALL_T, y1 - y0, EAVE_H - high), (east_x, (y0 + y1) / 2.0, (high + EAVE_H) / 2.0), surface["siding_green"], shell, bevel=0.010)
        y_cursor = y1
    if y_cursor < SHELL_D / 2.0 - WALL_T:
        _box("EastPier_North", (WALL_T, SHELL_D / 2.0 - WALL_T - y_cursor, EAVE_H - FLOOR_Z), (east_x, (y_cursor + SHELL_D / 2.0 - WALL_T) / 2.0, (FLOOR_Z + EAVE_H) / 2.0), surface["siding_green"], shell, bevel=0.010)

    # Thin plaster liners sit wholly on the room side of the structural shell.
    # They are joined into one authored mesh to avoid a draw-call per wall bay,
    # and repeat the structural apertures exactly so doors/windows remain clear.
    liner_props = {
        "interior_finish": True,
        "finish_family": "muted-sage-plaster",
        "aperture_safe": True,
        "room_side_only": True,
        "palette_hierarchy": "muted-sage wall field; warm-cream aperture trim and ceiling",
    }
    liner_parts: list[bpy.types.Object] = []
    inner_x0 = -SHELL_W / 2.0 + WALL_T
    inner_x1 = SHELL_W / 2.0 - WALL_T
    front_liner_y = FRONT_Y + WALL_T + INTERIOR_LINER_T / 2.0
    front_cursor = inner_x0
    for index, (x0, x1, low, high, label) in enumerate(openings):
        if x0 > front_cursor:
            liner_parts.append(_box(f"InteriorFrontPier_{index}", (x0 - front_cursor, INTERIOR_LINER_T, EAVE_H - FLOOR_Z), ((front_cursor + x0) / 2.0, front_liner_y, (FLOOR_Z + EAVE_H) / 2.0), m["interior_sage"], interior_liners, bevel=0.005, properties=liner_props))
        if low > FLOOR_Z + 0.005:
            liner_parts.append(_box(f"InteriorFrontBelow_{label}", (x1 - x0, INTERIOR_LINER_T, low - FLOOR_Z), ((x0 + x1) / 2.0, front_liner_y, (FLOOR_Z + low) / 2.0), m["interior_sage"], interior_liners, bevel=0.005, properties=liner_props))
        liner_parts.append(_box(f"InteriorFrontAbove_{label}", (x1 - x0, INTERIOR_LINER_T, EAVE_H - high), ((x0 + x1) / 2.0, front_liner_y, (high + EAVE_H) / 2.0), m["interior_sage"], interior_liners, bevel=0.005, properties=liner_props))
        front_cursor = x1
    if front_cursor < inner_x1:
        liner_parts.append(_box("InteriorFrontPier_East", (inner_x1 - front_cursor, INTERIOR_LINER_T, EAVE_H - FLOOR_Z), ((front_cursor + inner_x1) / 2.0, front_liner_y, (FLOOR_Z + EAVE_H) / 2.0), m["interior_sage"], interior_liners, bevel=0.005, properties=liner_props))

    back_liner_y = SHELL_D / 2.0 - WALL_T - INTERIOR_LINER_T / 2.0
    liner_parts.extend([
        _box("InteriorBackWest", (back_window_x0 - inner_x0, INTERIOR_LINER_T, EAVE_H - FLOOR_Z), ((inner_x0 + back_window_x0) / 2.0, back_liner_y, (FLOOR_Z + EAVE_H) / 2.0), m["interior_sage"], interior_liners, bevel=0.005, properties=liner_props),
        _box("InteriorBackEast", (inner_x1 - back_window_x1, INTERIOR_LINER_T, EAVE_H - FLOOR_Z), ((back_window_x1 + inner_x1) / 2.0, back_liner_y, (FLOOR_Z + EAVE_H) / 2.0), m["interior_sage"], interior_liners, bevel=0.005, properties=liner_props),
        _box("InteriorBackBelowWindow", (back_window_x1 - back_window_x0, INTERIOR_LINER_T, back_window_low - FLOOR_Z), (back_window_center_x, back_liner_y, (FLOOR_Z + back_window_low) / 2.0), m["interior_sage"], interior_liners, bevel=0.005, properties=liner_props),
        _box("InteriorBackAboveWindow", (back_window_x1 - back_window_x0, INTERIOR_LINER_T, EAVE_H - back_window_high), (back_window_center_x, back_liner_y, (back_window_high + EAVE_H) / 2.0), m["interior_sage"], interior_liners, bevel=0.005, properties=liner_props),
        _box("InteriorWestWall", (INTERIOR_LINER_T, SHELL_D - 2.0 * WALL_T, EAVE_H - FLOOR_Z), (-SHELL_W / 2.0 + WALL_T + INTERIOR_LINER_T / 2.0, 0.0, (FLOOR_Z + EAVE_H) / 2.0), m["interior_sage"], interior_liners, bevel=0.005, properties=liner_props),
    ])

    east_liner_x = SHELL_W / 2.0 - WALL_T - INTERIOR_LINER_T / 2.0
    east_cursor = -SHELL_D / 2.0 + WALL_T
    east_inner_limit = SHELL_D / 2.0 - WALL_T
    for index, (y0, y1, low, high, label) in enumerate(east_openings):
        if y0 > east_cursor:
            liner_parts.append(_box(f"InteriorEastPier_{index}", (INTERIOR_LINER_T, y0 - east_cursor, EAVE_H - FLOOR_Z), (east_liner_x, (east_cursor + y0) / 2.0, (FLOOR_Z + EAVE_H) / 2.0), m["interior_sage"], interior_liners, bevel=0.005, properties=liner_props))
        if low > FLOOR_Z + 0.005:
            liner_parts.append(_box(f"InteriorEastBelow_{label}", (INTERIOR_LINER_T, y1 - y0, low - FLOOR_Z), (east_liner_x, (y0 + y1) / 2.0, (FLOOR_Z + low) / 2.0), m["interior_sage"], interior_liners, bevel=0.005, properties=liner_props))
        liner_parts.append(_box(f"InteriorEastAbove_{label}", (INTERIOR_LINER_T, y1 - y0, EAVE_H - high), (east_liner_x, (y0 + y1) / 2.0, (high + EAVE_H) / 2.0), m["interior_sage"], interior_liners, bevel=0.005, properties=liner_props))
        east_cursor = y1
    if east_cursor < east_inner_limit:
        liner_parts.append(_box("InteriorEastPier_North", (INTERIOR_LINER_T, east_inner_limit - east_cursor, EAVE_H - FLOOR_Z), (east_liner_x, (east_cursor + east_inner_limit) / 2.0, (FLOOR_Z + EAVE_H) / 2.0), m["interior_sage"], interior_liners, bevel=0.005, properties=liner_props))

    # Closed gable ends and twin charcoal roof planes define one structural shell.
    gable_profile = [(-SHELL_D / 2.0 + WALL_T, EAVE_H), (0.0, SHELL_H), (SHELL_D / 2.0 - WALL_T, EAVE_H)]
    A.profile_prism("WestGable", gable_profile, WALL_T, (-SHELL_W / 2.0 + WALL_T / 2.0, 0.0, 0.0), surface["siding_green"], rotation=(0.0, 0.0, math.pi / 2.0), parent=shell, bevel=0.012)
    A.profile_prism("EastGable", gable_profile, WALL_T, (SHELL_W / 2.0 - WALL_T / 2.0, 0.0, 0.0), surface["siding_green"], rotation=(0.0, 0.0, math.pi / 2.0), parent=shell, bevel=0.012)
    liner_parts.extend([
        A.profile_prism("InteriorWestGableLiner", gable_profile, INTERIOR_LINER_T, (-SHELL_W / 2.0 + WALL_T + INTERIOR_LINER_T / 2.0, 0.0, 0.0), m["interior_sage"], rotation=(0.0, 0.0, math.pi / 2.0), parent=interior_liners, bevel=0.005, properties=liner_props),
        A.profile_prism("InteriorEastGableLiner", gable_profile, INTERIOR_LINER_T, (SHELL_W / 2.0 - WALL_T - INTERIOR_LINER_T / 2.0, 0.0, 0.0), m["interior_sage"], rotation=(0.0, 0.0, math.pi / 2.0), parent=interior_liners, bevel=0.005, properties=liner_props),
    ])
    _join_meshes("InteriorWarmCreamPlasterLiners", liner_parts, parent=interior_liners, properties=liner_props)
    run = SHELL_D / 2.0 - 0.06
    rise = SHELL_H - EAVE_H - 0.07
    slope_len = math.hypot(run, rise)
    slope = math.atan2(rise, run)
    roof_mid_z = (EAVE_H + SHELL_H - 0.07) / 2.0
    _box("RoofSouthPlane", (SHELL_W, slope_len, 0.12), (0.0, -run / 2.0, roof_mid_z), surface["charcoal_shingle"], roof_group, rotation=(slope, 0.0, 0.0), bevel=0.012)
    _box("RoofNorthPlane", (SHELL_W, slope_len, 0.12), (0.0, run / 2.0, roof_mid_z), surface["charcoal_shingle"], roof_group, rotation=(-slope, 0.0, 0.0), bevel=0.012)
    _box("RidgeCap", (SHELL_W, 0.16, 0.12), (0.0, 0.0, SHELL_H - 0.06), p["warm_charcoal"], details, bevel=0.035)
    _box("StoneChimney", (0.82, 0.72, 1.42), (4.25, 1.08, 6.28), surface["fieldstone"], details, bevel=0.025)
    _box("ChimneyCap", (0.96, 0.86, 0.12), (4.25, 1.08, 7.01), p["warm_charcoal"], details, bevel=0.018)
    _box("FrontFascia", (SHELL_W, 0.10, 0.25), (0.0, FRONT_Y + 0.05, EAVE_H + 0.04), p["warm_cream"], details, bevel=0.010)
    _box("BackFascia", (SHELL_W, 0.10, 0.25), (0.0, -FRONT_Y - 0.05, EAVE_H + 0.04), p["warm_cream"], details, bevel=0.010)
    for x in (-8.92, 8.92):
        A.cylinder(f"Downspout_{'W' if x < 0 else 'E'}", 0.045, 3.72, (x, FRONT_Y + 0.045, 2.12), p["warm_charcoal"], parent=details, bevel=0.004)
    # Exterior utility details (§6): gutter channels run the eaves and end on
    # the corner downspouts, and craftsman wall lanterns occupy the authored
    # entrance light sockets so the porch face reads finished rather than
    # showing bare mounting points.
    gutters = [
        _box("GutterFront", (17.84, 0.12, 0.10), (0.0, FRONT_Y + 0.02, EAVE_H + 0.18), p["warm_charcoal"], details, bevel=0.012),
        _box("GutterBack", (17.84, 0.12, 0.10), (0.0, -FRONT_Y - 0.02, EAVE_H + 0.18), p["warm_charcoal"], details, bevel=0.012),
    ]
    _join_meshes("EaveGutterRuns", gutters, parent=details, properties={"exterior_utility": "gutter"})
    lantern_glow = A.material(
        "S06_LanternWarmGlow", (0.98, 0.86, 0.62, 1.0), roughness=0.35,
        emission_color=(1.0, 0.82, 0.52), emission_strength=2.4,
    )
    for label, lantern_x in (("W", DOOR_X - 1.34), ("E", DOOR_X + 1.34)):
        lantern = [
            _box(f"Lantern{label}_Bracket", (0.05, 0.14, 0.05), (lantern_x, FRONT_Y - 0.07, 2.46), p["warm_charcoal"], details, bevel=0.008),
            _box(f"Lantern{label}_Body", (0.16, 0.16, 0.30), (lantern_x, FRONT_Y - 0.19, 2.34), p["warm_charcoal"], details, bevel=0.010),
            _box(f"Lantern{label}_Pane", (0.12, 0.18, 0.20), (lantern_x, FRONT_Y - 0.19, 2.34), lantern_glow, details, bevel=0.006),
            _box(f"Lantern{label}_Cap", (0.20, 0.20, 0.04), (lantern_x, FRONT_Y - 0.19, 2.52), p["warm_charcoal"], details, bevel=0.010),
        ]
        _join_meshes(f"EntranceLantern_{label}", lantern, parent=details, properties={"exterior_utility": "wall_lantern"})

    # Strong fieldstone water-table and cream aperture trim separate the shell materials.
    stone_h = 0.52
    stone_parts = [
        _box("StoneWaterTableFrontWest", (DOOR_X - 0.90 + SHELL_W / 2.0, 0.07, stone_h), ((-SHELL_W / 2.0 + DOOR_X - 0.90) / 2.0, FRONT_Y + 0.035, stone_h / 2.0), surface["fieldstone"], details, bevel=0.018),
        _box("StoneWaterTableFrontEast", (SHELL_W / 2.0 - (DOOR_X + 0.90), 0.07, stone_h), ((DOOR_X + 0.90 + SHELL_W / 2.0) / 2.0, FRONT_Y + 0.035, stone_h / 2.0), surface["fieldstone"], details, bevel=0.018),
        _box("StoneWaterTableBack", (SHELL_W, 0.07, stone_h), (0.0, -FRONT_Y - 0.035, stone_h / 2.0), surface["fieldstone"], details, bevel=0.018),
        _box("StoneWaterTableWest", (0.07, SHELL_D - 0.14, stone_h), (-SHELL_W / 2.0 + 0.035, 0.0, stone_h / 2.0), surface["fieldstone"], details, bevel=0.018),
        _box("StoneWaterTableEast", (0.07, SHELL_D - 0.14, stone_h), (SHELL_W / 2.0 - 0.035, 0.0, stone_h / 2.0), surface["fieldstone"], details, bevel=0.018),
    ]
    _join_meshes("FieldstoneWaterTable", stone_parts, parent=details, properties={"structural_geometry": True, "material_separation": "stone-foundation"})
    _front_casing("WindowWest", -8.68452, -6.49452, FLOOR_Z + 0.77724, FLOOR_Z + 2.51724, details, p["warm_cream"], sill=True)
    _front_casing("WindowMid", -5.57556, -3.38556, FLOOR_Z + 0.77724, FLOOR_Z + 2.51724, details, p["warm_cream"], sill=True)
    _front_casing("MainDoor", DOOR_X - 0.90, DOOR_X + 0.90, FLOOR_Z, FLOOR_Z + 2.45, details, p["warm_cream"], sill=False)

    # Two gabled dormers establish the reference clubhouse silhouette while retaining modular windows.
    _dormer("DormerWest", -6.45, 2.35, 4.40, dormers, surface["siding_green"], surface["charcoal_shingle"], p["warm_cream"], aperture_recess)
    _dormer("DormerEntry", DOOR_X, 3.15, 4.34, dormers, surface["siding_green"], surface["charcoal_shingle"], p["warm_cream"], aperture_recess)

    # Simplified blockers preserve every walkable opening, especially the entrance.
    A.collision_box("Foundation", (SHELL_W, SHELL_D, FLOOR_Z), (0.0, 0.0, FLOOR_Z / 2.0), parent=collision, purpose="walkable")
    # Front blockers use full-height piers; window apertures remain blocked, door aperture remains open.
    left_w = (DOOR_X - 0.90) - (-SHELL_W / 2.0)
    right_w = SHELL_W / 2.0 - (DOOR_X + 0.90)
    A.collision_box("FrontWallWest", (left_w, WALL_T, EAVE_H), (-SHELL_W / 2.0 + left_w / 2.0, FRONT_Y + WALL_T / 2.0, EAVE_H / 2.0), parent=collision)
    A.collision_box("FrontWallEast", (right_w, WALL_T, EAVE_H), (DOOR_X + 0.90 + right_w / 2.0, FRONT_Y + WALL_T / 2.0, EAVE_H / 2.0), parent=collision)
    A.collision_box("FrontDoorHeader", (1.80, WALL_T, EAVE_H - (FLOOR_Z + 2.45)), (DOOR_X, FRONT_Y + WALL_T / 2.0, (EAVE_H + FLOOR_Z + 2.45) / 2.0), parent=collision)
    A.collision_box("BackWall", (SHELL_W, WALL_T, EAVE_H), (0.0, SHELL_D / 2.0 - WALL_T / 2.0, EAVE_H / 2.0), parent=collision)
    A.collision_box("WestWall", (WALL_T, SHELL_D, EAVE_H), (-SHELL_W / 2.0 + WALL_T / 2.0, 0.0, EAVE_H / 2.0), parent=collision)
    # East blockers leave only the service-door span passable.
    service0, service1 = 2.60604, 3.97764
    A.collision_box("EastWallSouth", (WALL_T, service0 + SHELL_D / 2.0, EAVE_H), (east_x, (-SHELL_D / 2.0 + service0) / 2.0, EAVE_H / 2.0), parent=collision)
    A.collision_box("EastWallNorth", (WALL_T, SHELL_D / 2.0 - service1, EAVE_H), (east_x, (service1 + SHELL_D / 2.0) / 2.0, EAVE_H / 2.0), parent=collision)
    A.collision_box("EastDoorHeader", (WALL_T, service1 - service0, EAVE_H - (FLOOR_Z + 2.286)), (east_x, (service0 + service1) / 2.0, (EAVE_H + FLOOR_Z + 2.286) / 2.0), parent=collision)
    return root


def build_52() -> bpy.types.Object:
    root, p = _root(
        52,
        structural_role="ADDITIVE_DAMAGE_VISUALS",
        additive_damage_only=True,
        owns_navigation_collision=False,
        canonical_structure_asset=51,
        structural_collision=False,
        mesh_budget=80,
        triangle_budget=70000,
    )
    surface = _surface_materials("damaged_wood", "weathered_board_wood")
    # Boarded apertures live beneath the deep porch shadow in game.  A direct,
    # high-roughness pair keeps the salvage boards legible there without the
    # pale interior response of the shared projected weathered-wood texture.
    boarded_warm = A.material("S06_BoardedDamageWarm", (0.26, 0.17, 0.09, 1.0), roughness=0.95)
    boarded_cool = A.material("S06_BoardedDamageCool", (0.18, 0.15, 0.11, 1.0), roughness=0.97)
    board_fastener = A.material("S06_BoardFastener", (0.055, 0.047, 0.038, 1.0), roughness=0.70, metallic=0.42)
    heavy_weather = A.material("S06_HeavyExteriorWeathering", (0.018, 0.030, 0.018, 0.76), roughness=0.96, alpha=0.76, double_sided=True)
    roof_mold = A.material("S06_RoofMoldAndTar", (0.012, 0.016, 0.010, 0.88), roughness=0.98, alpha=0.88, double_sided=True)
    moss_mat = A.material("S06_HeavyMoss", (0.018, 0.085, 0.020, 1.0), roughness=0.99)
    damp_mat = A.material("S06_RisingDamp", (0.030, 0.020, 0.012, 0.90), roughness=0.99, alpha=0.90, double_sided=True)
    wall = _group("LOD0_WallDamage", root, overlay_role="additive")
    roof = _group("LOD0_RoofDamage", root, overlay_role="additive")
    trim = _group("LOD0_TrimDamage", root, overlay_role="additive")
    raycast = _group("LOD0_DamageRaycast", root, collision_authority=False)
    _exterior_registration(root, False)
    common = {"damage_overlay": True, "registration_id": REGISTRATION_ID, "structural_geometry": False}

    # Continuous but paper-thin dirt skins reveal the aligned building silhouette in isolation.
    # They remain repair-state masks, never structural shell geometry or navigation authority.
    front_depth = 0.014
    front_y = FRONT_Y + front_depth / 2.0
    openings = [
        (-8.68452, -6.49452, FLOOR_Z + 0.77724, FLOOR_Z + 2.51724),
        (-5.57556, -3.38556, FLOOR_Z + 0.77724, FLOOR_Z + 2.51724),
        (DOOR_X - 0.90, DOOR_X + 0.90, FLOOR_Z, FLOOR_Z + 2.45),
    ]
    front_skin: list[bpy.types.Object] = []
    cursor = -SHELL_W / 2.0
    for index, (x0, x1, low, high) in enumerate(openings):
        if x0 > cursor:
            front_skin.append(_box(f"WeatherSkinFrontPier_{index}", (x0 - cursor, front_depth, EAVE_H - FLOOR_Z), ((cursor + x0) / 2.0, front_y, (FLOOR_Z + EAVE_H) / 2.0), heavy_weather, wall, bevel=0.002, properties={**common, "damage_kind": "full_surface_weathering"}))
        if low > FLOOR_Z:
            front_skin.append(_box(f"WeatherSkinBelow_{index}", (x1 - x0, front_depth, low - FLOOR_Z), ((x0 + x1) / 2.0, front_y, (FLOOR_Z + low) / 2.0), heavy_weather, wall, bevel=0.002, properties={**common, "damage_kind": "full_surface_weathering"}))
        front_skin.append(_box(f"WeatherSkinAbove_{index}", (x1 - x0, front_depth, EAVE_H - high), ((x0 + x1) / 2.0, front_y, (high + EAVE_H) / 2.0), heavy_weather, wall, bevel=0.002, properties={**common, "damage_kind": "full_surface_weathering"}))
        cursor = x1
    front_skin.append(_box("WeatherSkinFrontEast", (SHELL_W / 2.0 - cursor, front_depth, EAVE_H - FLOOR_Z), ((cursor + SHELL_W / 2.0) / 2.0, front_y, (FLOOR_Z + EAVE_H) / 2.0), heavy_weather, wall, bevel=0.002, properties={**common, "damage_kind": "full_surface_weathering"}))
    _join_meshes("AlignedFrontWeatherSkin", front_skin, parent=wall, properties={**common, "damage_kind": "full_surface_weathering"})
    _box("AlignedBackWeatherSkin", (SHELL_W, front_depth, EAVE_H - FLOOR_Z), (0.0, -FRONT_Y - front_depth / 2.0, (FLOOR_Z + EAVE_H) / 2.0), heavy_weather, wall, bevel=0.002, properties={**common, "damage_kind": "full_surface_weathering"})
    _box("AlignedWestWeatherSkin", (front_depth, SHELL_D - 0.02, EAVE_H - FLOOR_Z), (-SHELL_W / 2.0 + front_depth / 2.0, 0.0, (FLOOR_Z + EAVE_H) / 2.0), heavy_weather, wall, bevel=0.002, properties={**common, "damage_kind": "full_surface_weathering"})
    _box("AlignedEastWeatherSkin", (front_depth, SHELL_D - 0.02, EAVE_H - FLOOR_Z), (SHELL_W / 2.0 - front_depth / 2.0, 0.0, (FLOOR_Z + EAVE_H) / 2.0), heavy_weather, wall, bevel=0.002, properties={**common, "damage_kind": "full_surface_weathering"})
    _box("FoundationDampBandFront", (SHELL_W, front_depth, 0.18), (0.0, front_y, 0.09), damp_mat, wall, bevel=0.008, properties={**common, "damage_kind": "rising_damp"})
    _box("FoundationDampBandBack", (SHELL_W, front_depth, 0.18), (0.0, -FRONT_Y - front_depth / 2.0, 0.09), damp_mat, wall, bevel=0.008, properties={**common, "damage_kind": "rising_damp"})

    # Aligned roof mold patches and dense moss communicate neglect without replacing Asset 51's roof.
    run = SHELL_D / 2.0 - 0.10
    rise = SHELL_H - EAVE_H - 0.10
    slope = math.atan2(rise, run)
    patch_length = math.hypot(run * 0.82, rise * 0.82)
    roof_patches = [
        # Mold stays on the roof: patch extents are clamped inside the 16.8 m
        # shell span (the previous 8.1/7.0 widths overhung both gable ends and
        # failed the clean-reimport dimension check by 1.45 m).
        _box("RoofMoldSouthWest", (6.35, patch_length, 0.028), (-5.2, -run * 0.45, 5.48), roof_mold, roof, rotation=(slope, 0.0, 0.0), bevel=0.008, properties={**common, "damage_kind": "roof_mold"}),
        _box("RoofMoldSouthEast", (5.75, patch_length * 0.72, 0.028), (5.5, -run * 0.38, 5.34), roof_mold, roof, rotation=(slope, 0.0, 0.0), bevel=0.008, properties={**common, "damage_kind": "roof_mold"}),
        _box("RoofMoldNorth", (10.2, patch_length * 0.56, 0.028), (-1.2, run * 0.40, 5.50), roof_mold, roof, rotation=(-slope, 0.0, 0.0), bevel=0.008, properties={**common, "damage_kind": "roof_mold"}),
    ]
    _join_meshes("AlignedRoofMoldPatches", roof_patches, parent=roof, properties={**common, "damage_kind": "roof_mold"})
    moss_parts = []
    for index, (x, y, length, z) in enumerate(((-7.2, -3.9, 3.5, 5.00), (-2.9, -2.0, 4.2, 5.92), (2.0, -0.7, 3.8, 6.63), (6.7, 2.5, 3.2, 5.42))):
        moss_parts.append(_box(f"RoofMoss_{index}", (length, 0.34, 0.045), (x, y, z), moss_mat, roof, bevel=0.035, properties={**common, "damage_kind": "moss"}))
    moss_parts.append(_box("RoofRidgeMoss", (4.8, 0.12, 0.035), (-1.4, 0.0, SHELL_H - 0.0175), moss_mat, roof, bevel=0.014, properties={**common, "damage_kind": "ridge_moss"}))
    _join_meshes("HeavyRoofMoss", moss_parts, parent=roof, properties={**common, "damage_kind": "moss"})

    # Boarded apertures, missing fascia and dormer boards are separately repairable damage modules.
    board_parts: list[bpy.types.Object] = []
    fastener_parts: list[bpy.types.Object] = []
    board_y = FRONT_Y + 0.025
    board_height = 0.145
    for label, x0, x1, z0, z1 in (
        ("WestWindow", -8.68452, -6.49452, FLOOR_Z + 0.77724, FLOOR_Z + 2.51724),
        ("MidWindow", -5.57556, -3.38556, FLOOR_Z + 0.77724, FLOOR_Z + 2.51724),
        ("MainDoor", DOOR_X - 0.90, DOOR_X + 0.90, FLOOR_Z, FLOOR_Z + 2.45),
    ):
        count = 4 if label == "MainDoor" else 3
        for index in range(count):
            z = z0 + (index + 0.5) * (z1 - z0) / count
            board_parts.append(_box(f"Boarded{label}_{index}", (x1 - x0 + 0.08, 0.05, board_height), ((x0 + x1) / 2.0, board_y, z), boarded_cool if index % 2 else boarded_warm, trim, rotation=(0.0, (-0.025 if index % 2 else 0.018), 0.0), bevel=0.010, properties={**common, "damage_kind": "boarded_aperture", "repairable": True, "weathered_board_height_m": board_height}))
            for fastener_index, x in enumerate((x0 + 0.13, x1 - 0.13)):
                fastener_parts.append(A.cylinder(
                    f"BoardFastener_{label}_{index}_{fastener_index}",
                    0.016,
                    0.010,
                    (x, board_y + 0.031, z),
                    board_fastener,
                    vertices=10,
                    rotation=(math.pi / 2.0, 0.0, 0.0),
                    parent=trim,
                    bevel=0.0015,
                    properties={**common, "damage_kind": "board_fastener", "repairable": True},
                ))
    for dormer_name, x, width, z in (("West", -6.45, 1.08, 4.98), ("Entry", DOOR_X, 1.45, 4.94)):
        for index in range(2):
            board_parts.append(_box(f"BoardedDormer{dormer_name}_{index}", (width, 0.045, board_height), (x, -3.60, z + index * 0.32), boarded_cool if index else boarded_warm, trim, rotation=(0.0, 0.035 if index else -0.025, 0.0), bevel=0.010, properties={**common, "damage_kind": "boarded_aperture", "repairable": True, "weathered_board_height_m": board_height}))
    _join_meshes("BoardedApertureDamage", board_parts, parent=trim, properties={**common, "damage_kind": "boarded_aperture", "repairable": True, "board_surface_variants": 2})
    _join_meshes("BoardedApertureFasteners", fastener_parts, parent=trim, properties={**common, "damage_kind": "board_fastener", "repairable": True, "fastener_count": len(fastener_parts)})
    broken_trim = [
        _box("BrokenFasciaWest", (4.10, 0.07, 0.18), (-6.45, FRONT_Y + 0.035, EAVE_H + 0.03), surface["damaged_wood"], trim, rotation=(0.0, 0.035, 0.0), bevel=0.008, properties={**common, "damage_kind": "missing_trim"}),
        _box("BrokenFasciaEast", (3.25, 0.07, 0.18), (5.85, FRONT_Y + 0.035, EAVE_H - 0.06), surface["damaged_wood"], trim, rotation=(0.0, -0.045, 0.0), bevel=0.008, properties={**common, "damage_kind": "missing_trim"}),
        _box("HangingTrim", (2.4, 0.06, 0.12), (2.2, FRONT_Y + 0.03, 3.56), surface["damaged_wood"], trim, rotation=(0.0, -0.10, 0.0), bevel=0.008, properties={**common, "damage_kind": "warped_trim"}),
    ]
    _join_meshes("WarpedMissingTrim", broken_trim, parent=trim, properties={**common, "damage_kind": "warped_missing_trim"})
    # Raycast-only proxies are intentionally non-blocking and never structural/nav authority.
    A.collision_box("Damage_RoofRaycast", (SHELL_W - 0.4, SHELL_D - 0.4, 0.08), (0.0, 0.0, 5.64), parent=raycast, purpose="raycast-only")
    A.collision_box("Damage_TrimRaycast", (SHELL_W - 0.4, 0.06, 0.30), (0.0, FRONT_Y - 0.03, EAVE_H), parent=raycast, purpose="raycast-only")
    return root


def _door_leaf(
    prefix: str,
    pivot: bpy.types.Object,
    x0: float,
    x1: float,
    p: dict[str, bpy.types.Material],
    walnut: bpy.types.Material,
    glass: bpy.types.Material,
) -> None:
    center = (x0 + x1) / 2.0
    width = x1 - x0
    # Joined production categories retain a detailed leaf while staying well inside the module budget.
    wood = [
        _box(f"{prefix}_StileOuter", (0.105, 0.10, 2.29), (x0 + 0.0525, 0.0, 1.185), walnut, pivot, bevel=0.014),
        _box(f"{prefix}_StileInner", (0.105, 0.10, 2.29), (x1 - 0.0525, 0.0, 1.185), walnut, pivot, bevel=0.014),
    ]
    for label, z in (("BottomRail", 0.095), ("LockRail", 0.73), ("TopRail", 2.275)):
        wood.append(_box(f"{prefix}_{label}", (width - 0.19, 0.10, 0.12), (center, 0.0, z), walnut, pivot, bevel=0.014))
    _join_meshes(f"{prefix}_WalnutStructure", wood, parent=pivot, properties={"door_leaf": prefix, "material_role": "walnut_structure"})
    _box(f"{prefix}_RaisedLowerPanel", (width - 0.25, 0.075, 0.49), (center, -0.004, 0.40), walnut, pivot, bevel=0.030, properties={"door_leaf": prefix, "raised_panel": True})
    _box(f"{prefix}_Glass", (width - 0.24, 0.012, 1.37), (center, 0.024, 1.51), glass, pivot, bevel=0.002, properties={"glazing": True, "clear_view": True, "door_leaf": prefix})
    muntins = [_box(f"{prefix}_MuntinV", (0.024, 0.028, 1.37), (center, -0.022, 1.51), walnut, pivot, bevel=0.004)]
    for index, z in enumerate((1.16, 1.51, 1.86)):
        muntins.append(_box(f"{prefix}_MuntinH_{index}", (width - 0.24, 0.028, 0.020), (center, -0.022, z), walnut, pivot, bevel=0.004))
    _join_meshes(f"{prefix}_WalnutMuntins", muntins, parent=pivot, properties={"door_leaf": prefix, "sash_grid": "2x4", "intermediate_rail_profile": "slender-20mm"})
    sash = [
        _box(f"{prefix}_SashLeft", (0.035, 0.065, 1.43), (x0 + 0.125, 0.0, 1.51), walnut, pivot, bevel=0.007),
        _box(f"{prefix}_SashRight", (0.035, 0.065, 1.43), (x1 - 0.125, 0.0, 1.51), walnut, pivot, bevel=0.007),
        _box(f"{prefix}_SashTop", (width - 0.25, 0.065, 0.035), (center, 0.0, 2.225), walnut, pivot, bevel=0.007),
        _box(f"{prefix}_SashBottom", (width - 0.25, 0.065, 0.035), (center, 0.0, 0.795), walnut, pivot, bevel=0.007),
    ]
    _join_meshes(f"{prefix}_DeepSashMoulding", sash, parent=pivot, properties={"door_leaf": prefix, "profile_depth": "layered"})
    handle_x = x1 - 0.14 if prefix == "DoorLeft" else x0 + 0.14
    hardware = [
        _box(f"{prefix}_HandleBackplate", (0.085, 0.024, 0.30), (handle_x, -0.108, 1.03), p["restrained_brass"], pivot, bevel=0.012),
        A.cylinder(f"{prefix}_HandleSpindle", 0.025, 0.10, (handle_x, -0.07, 1.03), p["restrained_brass"], rotation=(math.pi / 2.0, 0.0, 0.0), vertices=16, parent=pivot, bevel=0.005),
        _box(f"{prefix}_Lever", (0.16, 0.035, 0.035), (handle_x + (-0.055 if prefix == "DoorLeft" else 0.055), -0.1025, 1.03), p["restrained_brass"], pivot, bevel=0.012),
    ]
    _join_meshes(f"{prefix}_BrassLeverSet", hardware, parent=pivot, properties={"door_leaf": prefix, "interaction_hardware": True})
    hinge_x = x0 + 0.012 if prefix == "DoorLeft" else x1 - 0.012
    hinges = [A.cylinder(f"{prefix}_HingeKnuckle_{index}", 0.023, 0.15, (hinge_x, 0.067, z), p["restrained_brass"], vertices=14, parent=pivot, bevel=0.004) for index, z in enumerate((0.42, 1.20, 2.02))]
    _join_meshes(f"{prefix}_HingeKnuckles", hinges, parent=pivot, properties={"door_leaf": prefix, "hinge_hardware": True})


def build_53() -> bpy.types.Object:
    root, p = _root(53, interaction="true double-leaf hinged entrance", mesh_budget=36, triangle_budget=60000)
    m = _custom_materials(p)
    walnut = _surface_materials("walnut")["walnut"]
    frame = _group("LOD0_DoorFrame", root)
    collision = _group("LOD0_DoorCollision", root)
    _placement(root)
    left = A.pivot("DoorLeft", location=(-0.80, 0.0, 0.04), parent=root, properties={"hinge_side": "left", "swing_degrees": 100.0})
    right = A.pivot("DoorRight", location=(0.80, 0.0, 0.04), parent=root, properties={"hinge_side": "right", "swing_degrees": -100.0})
    frame_parts = [
        _box("FrameLeft", (0.10, 0.24, 2.45), (-0.85, 0.0, 1.225), p["warm_cream"], frame, bevel=0.015),
        _box("FrameRight", (0.10, 0.24, 2.45), (0.85, 0.0, 1.225), p["warm_cream"], frame, bevel=0.015),
        _box("FrameHeader", (1.60, 0.24, 0.11), (0.0, 0.0, 2.395), p["warm_cream"], frame, bevel=0.015),
        _box("FrameRabbetLeft", (0.045, 0.15, 2.31), (-0.775, 0.045, 1.195), p["warm_cream"], frame, bevel=0.008),
        _box("FrameRabbetRight", (0.045, 0.15, 2.31), (0.775, 0.045, 1.195), p["warm_cream"], frame, bevel=0.008),
        _box("FrameRabbetHeader", (1.51, 0.15, 0.045), (0.0, 0.045, 2.33), p["warm_cream"], frame, bevel=0.008),
    ]
    _join_meshes("DeepCreamDoorCasing", frame_parts, parent=frame, properties={"static_frame": True, "layered_casing": True})
    _box("Threshold", (1.60, 0.24, 0.04), (0.0, 0.0, 0.02), p["restrained_brass"], frame, bevel=0.006)
    _door_leaf("DoorLeft", left, -0.80, 0.0, p, m["door_green"], m["clear_glass"])
    _door_leaf("DoorRight", right, 0.0, 0.80, p, m["door_green"], m["clear_glass"])
    _box("DoorLeft_Astragal", (0.045, 0.13, 2.30), (-0.0225, 0.0, 1.19), m["door_green"], left, bevel=0.010, properties={"door_leaf": "DoorLeft", "astragal": True})
    stops = [
        _box("DoorStopLeft", (0.035, 0.035, 2.28), (-0.765, 0.085, 1.18), walnut, frame, bevel=0.006),
        _box("DoorStopRight", (0.035, 0.035, 2.28), (0.765, 0.085, 1.18), walnut, frame, bevel=0.006),
    ]
    _join_meshes("WalnutDoorStops", stops, parent=frame, properties={"door_stop": True})
    A.socket("HandleLeft", location=(-0.14, -0.09, 1.03), parent=left, properties={"interaction": "door_handle"})
    A.socket("HandleRight", location=(0.14, -0.09, 1.03), parent=right, properties={"interaction": "door_handle"})
    A.socket("Threshold", location=(0.0, -0.12, 0.0), parent=root)
    A.collision_box("DoorLeft", (0.80, 0.08, 2.33), (-0.40, 0.0, 1.205), parent=left, purpose="animated-blocking")
    A.collision_box("DoorRight", (0.80, 0.08, 2.33), (0.40, 0.0, 1.205), parent=right, purpose="animated-blocking")
    A.collision_box("FrameLeft", (0.10, 0.24, 2.45), (-0.85, 0.0, 1.225), parent=collision)
    A.collision_box("FrameRight", (0.10, 0.24, 2.45), (0.85, 0.0, 1.225), parent=collision)
    A.collision_box("FrameHeader", (1.60, 0.24, 0.11), (0.0, 0.0, 2.395), parent=collision)
    closed = (0.0, 0.0, 0.0)
    left_open = (0.0, 0.0, math.radians(100.0))
    right_open = (0.0, 0.0, math.radians(-100.0))
    A.animate_transform_clip(left, "DoorLeft_Open", ({"frame": 1, "rotation": closed}, {"frame": 24, "rotation": left_open}), interpolation="SINE")
    A.animate_transform_clip(left, "DoorLeft_Close", ({"frame": 1, "rotation": left_open}, {"frame": 24, "rotation": closed}), interpolation="SINE")
    A.animate_transform_clip(right, "DoorRight_Open", ({"frame": 1, "rotation": closed}, {"frame": 24, "rotation": right_open}), interpolation="SINE")
    A.animate_transform_clip(right, "DoorRight_Close", ({"frame": 1, "rotation": right_open}, {"frame": 24, "rotation": closed}), interpolation="SINE")
    left.rotation_euler = closed
    right.rotation_euler = closed
    bpy.context.view_layer.update()
    return root


def build_54() -> bpy.types.Object:
    root, p = _root(
        54,
        modular_porch=True,
        mesh_budget=36,
        triangle_budget=90000,
        deck_surface_z_m=FLOOR_Z,
        main_entrance_alignment_z_m=FLOOR_Z,
        alignment_target="Asset51 SOCKET_Porch/MainEntrance finished-floor datum",
        stair_rise_count=2,
    )
    surface = _surface_materials("oak", "fieldstone", "damaged_wood")
    deck = _group("LOD0_PorchDeck", root)
    canopy = _group("LOD0_PorchCanopy", root)
    rails = _group("LOD0_PorchRails", root)
    damage = _group("LOD0_PorchDamage", root, overlay_role="optional")
    collision = _group("LOD0_PorchCollision", root)
    _placement(root)
    for name, location in (("MainEntrance", (0.0, 0.0, FLOOR_Z)), ("Railing_W", (-5.30, -1.20, FLOOR_Z)), ("Railing_E", (5.30, -1.20, FLOOR_Z)), ("Column_W", (-5.00, -0.35, FLOOR_Z)), ("Column_E", (5.00, -0.35, FLOOR_Z))):
        _marker(name, root, location)

    # A real board-built deck terminates exactly at the clubhouse finished-floor datum.
    deck_boards = []
    board_count, gap = 18, 0.012
    board_width = (11.52 - gap * (board_count - 1)) / board_count
    for index in range(board_count):
        x = -11.52 / 2.0 + board_width / 2.0 + index * (board_width + gap)
        deck_boards.append(_box(f"DeckBoard_{index}", (board_width, 1.50, 0.12), (x, -0.75, FLOOR_Z - 0.06), surface["oak"], deck, bevel=0.010, properties={"deck_board": True, "grain_axis": "-Y"}))
    _join_meshes("OakDeckBoards", deck_boards, parent=deck, properties={"walk_surface_z_m": FLOOR_Z, "board_built": True})

    lower_top = FLOOR_Z / 2.0
    stair_parts = [
        _box("LowerTread", (5.65, 0.94, lower_top), (0.0, -2.82, lower_top / 2.0), surface["oak"], deck, bevel=0.012),
        _box("UpperTread", (5.25, 0.95, FLOOR_Z), (0.0, -1.975, FLOOR_Z / 2.0), surface["oak"], deck, bevel=0.012),
        _box("LowerNosing", (5.77, 0.075, 0.055), (0.0, -3.2525, lower_top - 0.0275), surface["oak"], deck, bevel=0.012),
        _box("UpperNosing", (5.37, 0.075, 0.055), (0.0, -2.4125, FLOOR_Z - 0.0275), surface["oak"], deck, bevel=0.012),
    ]
    _join_meshes("OakStairTreadsAndNosings", stair_parts, parent=deck, properties={"stair_rises": 2, "top_datum_m": FLOOR_Z})
    risers = [
        _box("LowerRiserFace", (5.65, 0.045, lower_top), (0.0, -3.2675, lower_top / 2.0), p["medium_walnut"], deck, bevel=0.006),
        _box("UpperRiserFace", (5.25, 0.045, FLOOR_Z - lower_top), (0.0, -2.4275, (lower_top + FLOOR_Z) / 2.0), p["medium_walnut"], deck, bevel=0.006),
    ]
    _join_meshes("WalnutStairRisers", risers, parent=deck, properties={"stair_rises": 2})
    underside = [
        _box("FrontDeckBeam", (11.12, 0.16, 0.16), (0.0, -1.40, 0.13), p["medium_walnut"], deck, bevel=0.015),
        _box("RearDeckBeam", (11.12, 0.15, 0.15), (0.0, -0.10, 0.125), p["medium_walnut"], deck, bevel=0.015),
    ]
    for index, x in enumerate((-4.2, -2.1, 0.0, 2.1, 4.2)):
        underside.append(_box(f"DeckJoist_{index}", (0.12, 1.30, 0.12), (x, -0.75, 0.14), p["medium_walnut"], deck, bevel=0.010))
    _join_meshes("PorchUndersideBeams", underside, parent=deck, properties={"underside_structure": True})

    # A shallow shed pitch resolves the old floating slab silhouette while the
    # roof crown remains exactly at the canonical 4.02 m asset height.
    canopy_roof_angle = math.radians(3.0)
    canopy_roof_depth = 2.38
    canopy_roof_thickness = 0.12
    canopy_roof_vertical_extent = (
        canopy_roof_depth * math.sin(canopy_roof_angle)
        + canopy_roof_thickness * math.cos(canopy_roof_angle)
    )
    canopy_roof_center_z = 4.02 - canopy_roof_vertical_extent / 2.0
    _box(
        "CanopyRoof",
        (11.52, canopy_roof_depth, canopy_roof_thickness),
        (0.0, -1.25, canopy_roof_center_z),
        p["deep_green"],
        canopy,
        rotation=(canopy_roof_angle, 0.0, 0.0),
        bevel=0.018,
        properties={"shed_pitch_degrees": 3.0, "roof_crown_z_m": 4.02},
    )
    canopy_trim = [
        _box("CanopyFrontFascia", (11.52, 0.11, 0.22), (0.0, -2.43, 3.76), p["warm_cream"], canopy, bevel=0.014),
        _box("CanopyRearFascia", (11.52, 0.10, 0.18), (0.0, -0.075, 3.91), p["warm_cream"], canopy, bevel=0.012),
        _box("CanopySoffit", (11.25, 2.20, 0.050), (0.0, -1.22, canopy_roof_center_z - 0.105), p["muted_sage"], canopy, rotation=(canopy_roof_angle, 0.0, 0.0), bevel=0.009),
        _box("CanopyWallLedger", (11.18, 0.08, 0.14), (0.0, -0.08, 3.77), p["medium_walnut"], canopy, bevel=0.012),
        _box("CanopyRoofCrownEdge", (11.40, 0.045, 0.010), (0.0, -0.075, 4.015), p["deep_green"], canopy, bevel=0.001, properties={"canonical_height_owner": True, "top_z_m": 4.02}),
    ]
    _join_meshes("CreamCanopyFasciaAndSoffit", canopy_trim, parent=canopy, properties={"profiled_canopy": True})

    post_xs = (-5.00, -1.72, 1.72, 5.00)
    cream_posts: list[bpy.types.Object] = []
    stone_bases: list[bpy.types.Object] = []
    for index, x in enumerate(post_xs):
        stone_bases.extend([
            _box(f"ColumnStoneFoot_{index}", (0.48, 0.48, 0.10), (x, -0.35, FLOOR_Z + 0.05), surface["fieldstone"], canopy, bevel=0.025),
            _box(f"ColumnStoneBase_{index}", (0.40, 0.40, 0.34), (x, -0.35, FLOOR_Z + 0.27), surface["fieldstone"], canopy, bevel=0.030),
        ])
        cream_posts.extend([
            _box(f"ColumnPlinth_{index}", (0.32, 0.32, 0.16), (x, -0.35, FLOOR_Z + 0.52), p["warm_cream"], canopy, bevel=0.024),
            _box(f"ColumnBaseCollar_{index}", (0.27, 0.27, 0.13), (x, -0.35, FLOOR_Z + 0.665), p["warm_cream"], canopy, bevel=0.021),
            _box(f"ColumnShaft_{index}", (0.22, 0.22, 2.321), (x, -0.35, 2.1595), p["warm_cream"], canopy, bevel=0.018),
            _box(f"ColumnNeck_{index}", (0.29, 0.29, 0.11), (x, -0.35, 3.375), p["warm_cream"], canopy, bevel=0.020),
            _box(f"ColumnCapital_{index}", (0.39, 0.39, 0.16), (x, -0.35, 3.51), p["warm_cream"], canopy, bevel=0.023),
            _box(f"ColumnAbacus_{index}", (0.46, 0.46, 0.10), (x, -0.35, 3.64), p["warm_cream"], canopy, bevel=0.022),
        ])
    _join_meshes("ProfiledCreamColumns", cream_posts, parent=canopy, properties={"profiled_posts": True})
    _join_meshes("FieldstoneColumnBases", stone_bases, parent=canopy, properties={"stone_column_bases": True})

    rail_parts: list[bpy.types.Object] = []
    # Side and front deck rails remain attached to the deck, leaving a central stair opening.
    for side, x in (("W", -5.30), ("E", 5.30)):
        rail_parts.extend([
            _box(f"SideRailTop_{side}", (0.11, 1.28, 0.11), (x, -0.76, 1.10), p["warm_cream"], rails, bevel=0.022),
            _box(f"SideRailBottom_{side}", (0.09, 1.28, 0.09), (x, -0.76, 0.52), p["warm_cream"], rails, bevel=0.018),
        ])
        for index, y in enumerate((-1.25, -0.98, -0.71, -0.44, -0.17)):
            rail_parts.append(_box(f"SideBaluster_{side}_{index}", (0.065, 0.065, 0.60), (x, y, 0.81), p["warm_cream"], rails, bevel=0.010))
    for side, x0, x1 in (("W", -5.30, -2.82), ("E", 2.82, 5.30)):
        width = x1 - x0
        rail_parts.extend([
            _box(f"FrontRailTop_{side}", (width, 0.11, 0.11), ((x0 + x1) / 2.0, -1.42, 1.10), p["warm_cream"], rails, bevel=0.022),
            _box(f"FrontRailBottom_{side}", (width, 0.09, 0.09), ((x0 + x1) / 2.0, -1.42, 0.52), p["warm_cream"], rails, bevel=0.018),
        ])
        for index in range(5):
            x = x0 + (index + 0.5) * width / 5.0
            rail_parts.append(_box(f"FrontBaluster_{side}_{index}", (0.065, 0.065, 0.60), (x, -1.42, 0.81), p["warm_cream"], rails, bevel=0.010))
    _join_meshes("AttachedCreamPorchRailings", rail_parts, parent=rails, properties={"attached_balusters": True})

    stair_rails: list[bpy.types.Object] = []
    for side, x in (("W", -2.91), ("E", 2.91)):
        handrail_points = ((x, -3.18, 0.62), (x, -2.40, 0.82), (x, -1.48, 1.10))
        lower_points = ((x, -3.12, 0.30), (x, -2.40, 0.47), (x, -1.50, 0.68))
        for segment_index, (start, end) in enumerate(zip(handrail_points, handrail_points[1:])):
            stair_rails.append(_segment_box_yz(f"DiagonalHandrail_{side}_{segment_index}", start, end, 0.11, p["deep_green"], rails, bevel=0.022, properties={"diagonal_stair_rail": True}))
        for segment_index, (start, end) in enumerate(zip(lower_points, lower_points[1:])):
            stair_rails.append(_segment_box_yz(f"DiagonalLowerRail_{side}_{segment_index}", start, end, 0.064, p["deep_green"], rails, bevel=0.016, properties={"diagonal_stair_rail": True}))
        for index, y in enumerate((-2.98, -2.62, -2.26, -1.90, -1.58)):
            ratio = (y + 3.18) / 1.70
            z0 = 0.22 + ratio * 0.28
            z1 = 0.57 + ratio * 0.48
            stair_rails.append(_box(f"StairBaluster_{side}_{index}", (0.06, 0.06, z1 - z0), (x, y, (z0 + z1) / 2.0), p["warm_cream"], rails, bevel=0.010))
    _join_meshes("DiagonalStairHandrails", stair_rails, parent=rails, properties={"diagonal_handrails": True, "attached_balusters": True})

    braces = []
    for index, x in enumerate(post_xs):
        direction = 1.0 if index % 2 == 0 else -1.0
        braces.append(_segment_box_xz(f"CanopyBrace_{index}", (x, -0.35, 3.51), (x + direction * 0.34, -0.35, 3.76), 0.065, p["medium_walnut"], canopy, bevel=0.013, properties={"canopy_brace": True}))
    _join_meshes("WalnutCanopyBraces", braces, parent=canopy, properties={"underside_braces": True})
    _box("WarpedDeckBoard", (1.85, 0.16, 0.026), (-2.0, -0.88, FLOOR_Z + 0.013), surface["damaged_wood"], damage, rotation=(0.0, 0.0, 0.025), bevel=0.010, properties={"damage_overlay": True, "repairable": True})

    A.collision_box("Deck", (11.52, 1.50, 0.10), (0.0, -0.75, FLOOR_Z - 0.05), parent=collision, purpose="walkable")
    A.collision_hull("StepRamp", [(-2.92, -3.29, 0.0), (2.92, -3.29, 0.0), (-2.72, -1.50, FLOOR_Z), (2.72, -1.50, FLOOR_Z), (-2.92, -3.29, 0.025), (2.92, -3.29, 0.025), (-2.72, -1.50, 0.0), (2.72, -1.50, 0.0)], parent=collision, purpose="walkable")
    for index, x in enumerate(post_xs):
        A.collision_box(f"Column_{index}", (0.48, 0.48, 3.48), (x, -0.35, FLOOR_Z + 1.74), parent=collision)
    return root


def _window_variant(
    name: str,
    width: float,
    height: float,
    root: bpy.types.Object,
    p: dict[str, bpy.types.Material],
    walnut: bpy.types.Material,
    glass: bpy.types.Material,
    *,
    arched: bool = False,
    hidden: bool = False,
) -> bpy.types.Object:
    variant_id = name.lower()
    variant_props = _variant_properties(variant_id, default=not hidden)
    group = _group(f"LOD0_Window{name}", root, **variant_props)
    group.hide_render = hidden
    casing_t = 0.11
    casing = [
        _box(f"Window{name}_CasingLeft", (casing_t, 0.18, height), (-width / 2.0 + casing_t / 2.0, 0.02, height / 2.0), p["warm_cream"], group, bevel=0.016),
        _box(f"Window{name}_CasingRight", (casing_t, 0.18, height), (width / 2.0 - casing_t / 2.0, 0.02, height / 2.0), p["warm_cream"], group, bevel=0.016),
        _box(f"Window{name}_CasingHead", (width - 2 * casing_t, 0.18, casing_t), (0.0, 0.02, height - casing_t / 2.0), p["warm_cream"], group, bevel=0.016),
        _box(f"Window{name}_ProjectingSill", (width, 0.23, 0.09), (0.0, 0.0, 0.045), p["warm_cream"], group, bevel=0.018),
        _box(f"Window{name}_SillApron", (width - 0.18, 0.16, 0.075), (0.0, 0.025, 0.115), p["warm_cream"], group, bevel=0.014),
    ]
    if arched:
        points = [
            (math.cos(theta) * (width / 2.0 - casing_t), height - 0.3375 + math.sin(theta) * 0.31)
            for theta in [math.pi * i / 8.0 for i in range(9)]
        ]
        for index, ((x0, z0), (x1, z1)) in enumerate(zip(points, points[1:])):
            dx, dz = x1 - x0, z1 - z0
            casing.append(_box(
                f"Window{name}_ArchTrim_{index}", (math.hypot(dx, dz) + 0.012, 0.05, 0.055),
                ((x0 + x1) / 2.0, -0.055, (z0 + z1) / 2.0), p["warm_cream"], group,
                rotation=(0.0, math.atan2(-dz, dx), 0.0), bevel=0.010,
            ))
    _join_meshes(f"Window{name}_LayeredCreamCasing", casing, parent=group, properties=variant_props, hide_render=hidden)

    inner_w = width - 0.30
    lower_z0, lower_z1 = 0.16, height * 0.515
    upper_z0, upper_z1 = lower_z1, height - 0.13
    sash_stile = 0.042
    sash_rail = 0.044
    sash_depth = 0.060
    sash: list[bpy.types.Object] = []
    for sash_name, z0, z1 in (("Lower", lower_z0, lower_z1), ("Upper", upper_z0, upper_z1)):
        sash.extend([
            _box(f"Window{name}_{sash_name}SashLeft", (sash_stile, sash_depth, z1 - z0), (-inner_w / 2.0 + sash_stile / 2.0, -0.002, (z0 + z1) / 2.0), walnut, group, bevel=0.007),
            _box(f"Window{name}_{sash_name}SashRight", (sash_stile, sash_depth, z1 - z0), (inner_w / 2.0 - sash_stile / 2.0, -0.002, (z0 + z1) / 2.0), walnut, group, bevel=0.007),
            _box(f"Window{name}_{sash_name}SashBottom", (inner_w, sash_depth, sash_rail), (0.0, -0.002, z0 + sash_rail / 2.0), walnut, group, bevel=0.007),
            _box(f"Window{name}_{sash_name}SashTop", (inner_w, sash_depth, sash_rail), (0.0, -0.002, z1 - sash_rail / 2.0), walnut, group, bevel=0.007),
        ])
    sash.append(_box(f"Window{name}_MeetingRail", (inner_w, 0.068, 0.052), (0.0, -0.010, lower_z1), walnut, group, bevel=0.008))
    _join_meshes(f"Window{name}_WalnutDoubleSashes", sash, parent=group, properties={**variant_props, "sash_count": 2, "profile": "slender-double-hung"}, hide_render=hidden)

    glass_parts = []
    for sash_name, z0, z1 in (("Lower", lower_z0 + sash_rail, lower_z1 - sash_rail), ("Upper", upper_z0 + sash_rail, upper_z1 - sash_rail)):
        glass_parts.append(_box(f"Window{name}_{sash_name}Glass", (inner_w - 2.0 * sash_stile, 0.012, z1 - z0), (0.0, 0.034, (z0 + z1) / 2.0), glass, group, bevel=0.002, properties={"glazing": True, "clear_view": True}))
    _join_meshes(f"Window{name}_UpperLowerGlass", glass_parts, parent=group, properties={**variant_props, "glazing": True, "clear_view": True}, hide_render=hidden)

    muntins: list[bpy.types.Object] = []
    vertical_count = 2 if width > 1.45 else 1
    for sash_name, z0, z1 in (("Lower", lower_z0 + sash_rail, lower_z1 - sash_rail), ("Upper", upper_z0 + sash_rail, upper_z1 - sash_rail)):
        for index in range(vertical_count):
            x = (-inner_w * 0.18 if vertical_count == 2 and index == 0 else inner_w * 0.18 if vertical_count == 2 else 0.0)
            muntins.append(_box(f"Window{name}_{sash_name}MuntinV_{index}", (0.020, 0.026, z1 - z0), (x, -0.040, (z0 + z1) / 2.0), walnut, group, bevel=0.004))
        muntins.append(_box(f"Window{name}_{sash_name}MuntinH", (inner_w - 2.0 * sash_stile, 0.026, 0.020), (0.0, -0.040, (z0 + z1) / 2.0), walnut, group, bevel=0.004))
    _join_meshes(f"Window{name}_WalnutMuntinGrid", muntins, parent=group, properties={**variant_props, "muntin_grid": f"{vertical_count + 1}x2 per sash"}, hide_render=hidden)
    return group


def build_55() -> bpy.types.Object:
    root, p = _root(
        55,
        modular_variants="standard,narrow,wide,arched",
        mesh_budget=36,
        triangle_budget=55000,
        variant_selection_contract="adapter selects exactly one variant_id; Blender hide_render is preview-only",
        variant_ids_json=json.dumps(["standard", "narrow", "wide", "arched"]),
    )
    m = _custom_materials(p)
    walnut = _surface_materials("walnut")["walnut"]
    _placement(root)
    _window_variant("Standard", 2.19, 1.74, root, p, walnut, m["clear_glass"])
    _window_variant("Narrow", 1.10, 1.74, root, p, walnut, m["clear_glass"], hidden=True)
    _window_variant("Wide", 2.19, 1.32, root, p, walnut, m["clear_glass"], hidden=True)
    _window_variant("Arched", 1.55, 1.74, root, p, walnut, m["clear_glass"], arched=True, hidden=True)
    for name in ("WindowStandard", "WindowNarrow", "WindowWide", "WindowArched"):
        _marker(name, root, variant=name.removeprefix("Window").lower())
    collision = _group("LOD0_WindowCollision", root)
    A.collision_box("WindowFrameLeft", (0.09, 0.23, 1.74), (-1.05, 0.0, 0.87), parent=collision)
    A.collision_box("WindowFrameRight", (0.09, 0.23, 1.74), (1.05, 0.0, 0.87), parent=collision)
    A.collision_box("WindowGlassRaycast", (2.01, 0.04, 1.56), (0.0, 0.0, 0.87), parent=collision, purpose="raycast-only")
    return root


def build_56() -> bpy.types.Object:
    root, p = _root(
        56,
        modular_panel_kit=True,
        mesh_budget=36,
        triangle_budget=40000,
        variant_selection_contract="adapter selects one top-level variant_id group",
        variant_ids_json=json.dumps(["straight", "inside_corner", "outside_corner", "door_connector", "window_connector"]),
    )
    m = _custom_materials(p)
    walnut = _surface_materials("architectural_walnut")["architectural_walnut"]
    panel_wear = A.material("S06_PanelRepairWear", (0.12, 0.070, 0.035, 1.0), roughness=0.94)
    panel = _group("LOD0_PanelStraight", root, **_variant_properties("straight", default=True))
    _placement(root)
    _box(
        "PanelWarmPlasterBack",
        (1.20, 0.035, 1.15),
        (0.0, 0.020, 0.575),
        m["interior_plaster"],
        panel,
        bevel=0.006,
        properties={**_variant_properties("straight", default=True), "architectural_backing": "warm-cream-plaster"},
    )
    _box(
        # Preserve the established mesh name for the runtime/reimport contract;
        # revision 2 changes its role from a flat sage strip to the recessed
        # walnut field behind the raised rails, stiles and panel mouldings.
        "PanelMutedSageDadoField",
        (1.10, 0.016, 0.94),
        (0.0, -0.0185, 0.54),
        walnut,
        panel,
        bevel=0.004,
        properties={
            **_variant_properties("straight", default=True),
            "recessed_walnut_field": True,
            "legacy_mesh_name_retained": True,
        },
    )
    walnut_parts: list[bpy.types.Object] = [
        _box("PanelStile_Left", (0.065, 0.030, 1.02), (-0.545, -0.0225, 0.53), walnut, panel, bevel=0.007),
        _box("PanelStile_Centre", (0.060, 0.030, 1.02), (0.0, -0.0225, 0.53), walnut, panel, bevel=0.007),
        _box("PanelStile_Right", (0.065, 0.030, 1.02), (0.545, -0.0225, 0.53), walnut, panel, bevel=0.007),
        _box("PanelRail_Bottom", (1.13, 0.030, 0.075), (0.0, -0.0225, 0.06), walnut, panel, bevel=0.007),
        _box("PanelRail_Top", (1.13, 0.032, 0.080), (0.0, -0.0215, 1.01), walnut, panel, bevel=0.007),
    ]
    _join_meshes(
        "RestrainedWalnutWainscotFrame",
        walnut_parts,
        parent=panel,
        properties={
            **_variant_properties("straight", default=True),
            "profile": "raised-walnut-rail-and-stile",
            "recess_depth_m": 0.0145,
        },
    )
    recessed_panels = [
        _box(
            f"PanelRecessedFace_{label}",
            (0.44, 0.012, 0.76),
            (center_x, -0.0170, 0.53),
            walnut,
            panel,
            bevel=0.018,
            properties={"recessed_panel": True, "panel_bay": label},
        )
        for label, center_x in (("Left", -0.275), ("Right", 0.275))
    ]
    _join_meshes(
        "RaisedWalnutRecessedPanels",
        recessed_panels,
        parent=panel,
        properties={**_variant_properties("straight", default=True), "recessed_panel_depth_m": 0.0145},
    )
    panel_mouldings: list[bpy.types.Object] = []
    for label, center_x in (("Left", -0.275), ("Right", 0.275)):
        panel_mouldings.extend([
            _box(f"Panel{label}Moulding_Left", (0.025, 0.020, 0.80), (center_x - 0.23, -0.0275, 0.53), walnut, panel, bevel=0.006),
            _box(f"Panel{label}Moulding_Right", (0.025, 0.020, 0.80), (center_x + 0.23, -0.0275, 0.53), walnut, panel, bevel=0.006),
            _box(f"Panel{label}Moulding_Bottom", (0.485, 0.020, 0.025), (center_x, -0.0275, 0.13), walnut, panel, bevel=0.006),
            _box(f"Panel{label}Moulding_Top", (0.485, 0.020, 0.025), (center_x, -0.0275, 0.93), walnut, panel, bevel=0.006),
        ])
    _join_meshes(
        "RaisedWalnutPanelMouldings",
        panel_mouldings,
        parent=panel,
        properties={**_variant_properties("straight", default=True), "raised_moulding": True},
    )
    cream_profile = [
        _box("PanelCreamCap", (1.20, 0.040, 0.050), (0.0, -0.0175, 1.125), walnut, panel, bevel=0.009, properties={"walnut_chair_rail_cap": True, "legacy_mesh_name_retained": True}),
        _box("PanelCreamReveal", (1.12, 0.025, 0.018), (0.0, -0.025, 1.070), p["warm_cream"], panel, bevel=0.004, properties={"cream_pencil_reveal": True}),
    ]
    _join_meshes("RestrainedCreamPanelProfile", cream_profile, parent=panel, properties=_variant_properties("straight", default=True))

    # A small repair-state layer restores the panel transition contract without
    # stamping grime onto every repeated module.  Runtime batching honors the
    # deterministic sample stride below, so only a restrained subset of wall
    # bays carries these scuffs while panels are unrestored.
    panel_wear_parts = [
        A.profile_prism(
            "PanelWear_LowerScuff",
            [
                (-0.180, -0.032), (-0.145, -0.048), (-0.035, -0.043),
                (0.070, -0.034), (0.165, -0.012), (0.178, 0.015),
                (0.105, 0.034), (-0.025, 0.045), (-0.150, 0.025),
            ],
            0.003,
            (-0.24, -0.0385, 0.17),
            panel_wear,
            parent=panel,
            bevel=0.0005,
        ),
        A.profile_prism(
            "PanelWear_ScratchA",
            [
                (-0.140, -0.007), (-0.035, -0.004), (0.138, 0.003),
                (0.130, 0.012), (0.020, 0.007), (-0.142, 0.001),
            ],
            0.003,
            (0.25, -0.0385, 0.44),
            panel_wear,
            rotation=(0.0, -0.075, 0.0),
            parent=panel,
            bevel=0.0004,
        ),
        A.profile_prism(
            "PanelWear_ScratchB",
            [
                (-0.088, -0.006), (-0.018, -0.003), (0.087, 0.002),
                (0.080, 0.010), (0.012, 0.006), (-0.090, 0.001),
            ],
            0.003,
            (0.31, -0.0385, 0.39),
            panel_wear,
            rotation=(0.0, 0.11, 0.0),
            parent=panel,
            bevel=0.0004,
        ),
    ]
    _join_meshes(
        "PanelDamageWear",
        panel_wear_parts,
        parent=panel,
        properties={
            **_variant_properties("straight", default=True),
            "damage_overlay": True,
            "repairable": True,
            "damage_kind": "sparse_panel_scuff",
            "damage_sample_stride": 7,
            "damage_sample_offset": 2,
            "runtime_sampling_contract": "assembly instances this mesh on one of every seven straight panel placements",
        },
        hide_render=True,
    )

    for variant_id, label, x in (
        ("inside_corner", "InsideCorner", -0.505),
        ("outside_corner", "OutsideCorner", 0.505),
        ("door_connector", "DoorConnector", -0.30),
        ("window_connector", "WindowConnector", 0.30),
    ):
        props = _variant_properties(variant_id)
        variant_group = _group(f"LOD0_Panel{label}", root, **props)
        variant_group.hide_render = True
        parts = [
            _box(f"Panel{label}Post", (0.055, 0.075, 1.15), (x, 0.0, 0.575), walnut, variant_group, bevel=0.009),
            _box(f"Panel{label}Cap", (0.15, 0.055, 0.050), (x, -0.010, 1.125), walnut, variant_group, bevel=0.009),
            _box(f"Panel{label}Foot", (0.13, 0.055, 0.10), (x, -0.010, 0.05), walnut, variant_group, bevel=0.009),
        ]
        _join_meshes(f"Panel{label}Profile", parts, parent=variant_group, properties=props, hide_render=True)
    for name, loc in (("PanelNext", (0.60, 0.0, 0.0)), ("InsideCorner", (-0.60, 0.0, 0.0)), ("OutsideCorner", (0.60, 0.0, 0.0)), ("DoorConnector", (-0.30, 0.0, 0.0)), ("WindowConnector", (0.30, 0.0, 0.58))):
        _marker(name, root, loc)
    A.collision_box("PanelSelection", (1.20, 0.075, 1.15), (0.0, 0.0, 0.575), parent=root, purpose="selection-blocking")
    return root


def build_57() -> bpy.types.Object:
    root, p = _root(
        57,
        modular_trim_kit=True,
        mesh_budget=36,
        triangle_budget=30000,
        variant_selection_contract="adapter selects one top-level variant_id group",
        variant_ids_json=json.dumps(["baseboard", "crown", "chair_rail", "door_casing", "inside_corner", "outside_corner", "end_cap", "junction"]),
    )
    walnut = _surface_materials("walnut")["walnut"]
    _placement(root)
    base_props = _variant_properties("baseboard", default=True)
    base_group = _group("LOD0_TrimBaseboard", root, **base_props)
    base_parts = [
        _box("BaseboardPlinth", (2.40, 0.025, 0.040), (0.0, 0.0, 0.020), walnut, base_group, bevel=0.007),
        _box("BaseboardField", (2.40, 0.018, 0.072), (0.0, 0.0035, 0.076), walnut, base_group, bevel=0.008),
        _box("BaseboardCap", (2.40, 0.025, 0.028), (0.0, 0.0, 0.126), walnut, base_group, bevel=0.009),
        _box("BaseboardReveal", (2.40, 0.022, 0.012), (0.0, -0.0015, 0.105), p["restrained_brass"], base_group, bevel=0.004),
    ]
    _join_meshes("LayeredDarkWalnutBaseboard", base_parts, parent=base_group, properties={**base_props, "profile_layers": 4})

    profiles = {
        "crown": (("CrownBody", (2.40, 0.022, 0.075), (0.0, 0.0015, 0.1025)), ("CrownLip", (2.40, 0.025, 0.025), (0.0, 0.0, 0.1275))),
        "chair_rail": (("ChairRailBack", (2.40, 0.017, 0.080), (0.0, 0.004, 0.070)), ("ChairRailCap", (2.40, 0.025, 0.032), (0.0, 0.0, 0.105))),
        "door_casing": (("DoorCasingField", (2.40, 0.020, 0.105), (0.0, 0.0025, 0.070)), ("DoorCasingBead", (2.40, 0.025, 0.025), (0.0, 0.0, 0.1275))),
    }
    for variant_id, pieces in profiles.items():
        props = _variant_properties(variant_id)
        group = _group(f"LOD0_Trim{variant_id.title().replace('_', '')}", root, **props)
        group.hide_render = True
        objects = [_box(name, dims, loc, walnut, group, bevel=0.008) for name, dims, loc in pieces]
        _join_meshes(f"Trim{variant_id.title().replace('_', '')}Profile", objects, parent=group, properties=props, hide_render=True)

    for variant_id, label, x in (("inside_corner", "InsideCorner", -1.14), ("outside_corner", "OutsideCorner", 1.14), ("end_cap", "EndCap", 1.14), ("junction", "Junction", 0.0)):
        props = _variant_properties(variant_id)
        group = _group(f"LOD0_Trim{label}", root, **props)
        group.hide_render = True
        width = 0.12 if variant_id != "junction" else 0.18
        parts = [
            _box(f"Trim{label}Plinth", (width, 0.025, 0.045), (x, 0.0, 0.0225), walnut, group, bevel=0.008),
            _box(f"Trim{label}Body", (width * 0.78, 0.020, 0.073), (x, 0.0025, 0.0815), walnut, group, bevel=0.008),
            _box(f"Trim{label}Cap", (width, 0.025, 0.025), (x, 0.0, 0.1275), walnut, group, bevel=0.008),
        ]
        _join_meshes(f"Trim{label}Connector", parts, parent=group, properties={**props, "connector_profile": True}, hide_render=True)
    for name, loc in (("TrimNext", (1.20, 0.0, 0.0)), ("InsideCorner", (-1.20, 0.0, 0.0)), ("OutsideCorner", (1.20, 0.0, 0.0)), ("EndCap", (1.20, 0.0, 0.07)), ("Junction", (0.0, 0.0, 0.07))):
        _marker(name, root, loc)
    A.collision_box("TrimRaycast", (2.40, 0.025, 0.14), (0.0, 0.0, 0.07), parent=root, purpose="raycast-only")
    return root


def build_58() -> bpy.types.Object:
    root, p = _root(
        58,
        modular_ceiling_kit=True,
        mesh_budget=36,
        triangle_budget=32000,
        variant_selection_contract="adapter selects one top-level variant_id group",
        variant_ids_json=json.dumps(["straight", "half", "cross_connector", "end_cap", "ceiling_panel", "light_mount"]),
    )
    m = _custom_materials(p)
    walnut = _surface_materials("architectural_walnut")["architectural_walnut"]
    _placement(root)
    straight_props = _variant_properties("straight", default=True)
    straight = _group("LOD0_BeamStraight", root, **straight_props)
    beam_parts = [
        # One continuous visible body removes the former 20 mm centre gap and
        # diagonal scarf silhouette.  A very small end bevel lets adjacent
        # runtime modules overlap cleanly without reading as broken segments.
        _box("BeamStraightBody", (3.60, 0.14, 0.14), (0.0, 0.0, 0.07), walnut, straight, bevel=0.0015),
        # The concealed cleat preserves the exact 240 mm module height.
        _box("BeamConcealedTopCleat", (3.60, 0.08, 0.10), (0.0, 0.0, 0.19), walnut, straight, bevel=0.003),
    ]
    _join_meshes("DarkWalnutScarfJointBeam", beam_parts, parent=straight, properties={**straight_props, "joinery": "continuous-body-with-concealed-cleat", "visible_drop_m": 0.14, "legacy_mesh_name_retained": True})
    variant_specs = (
        ("half", "BeamHalf", (1.80, 0.14, 0.14), (-0.90, 0.0, 0.070), walnut),
        ("cross_connector", "BeamCrossConnector", (0.22, 0.14, 0.14), (0.0, 0.0, 0.070), walnut),
        ("end_cap", "BeamEndCap", (0.10, 0.14, 0.14), (1.75, 0.0, 0.070), p["restrained_brass"]),
        ("ceiling_panel", "CeilingPanel", (1.80, 0.20, 0.08), (0.0, 0.0, 0.04), m["ceiling_plaster"]),
    )
    for variant_id, label, dims, loc, mat in variant_specs:
        props = _variant_properties(variant_id)
        group = _group(f"LOD0_{label}", root, **props)
        group.hide_render = True
        piece_properties = {"joinery_variant": variant_id, "quiet_architectural_profile": True}
        # The production runtime intentionally stretches this quiet carrier
        # across the full room depth. Any source bevel would be stretched with
        # it and read as a broad edge band from the player camera.
        piece_bevel = 0.0 if variant_id == "ceiling_panel" else 0.010
        if variant_id == "ceiling_panel":
            piece_properties.update({
                "perpendicular_runtime_scale_safe": True,
                "maximum_edge_bevel_m": 0.0,
                "depth_direction_relief": False,
            })
        pieces = [_box(label, dims, loc, mat, group, bevel=piece_bevel, properties=piece_properties)]
        if variant_id == "cross_connector":
            pieces.extend([
                _box("BeamCrossLapWest", (0.50, 0.12, 0.045), (-0.25, 0.0, 0.0525), walnut, group, bevel=0.008),
                _box("BeamCrossLapEast", (0.50, 0.12, 0.045), (0.25, 0.0, 0.0975), walnut, group, bevel=0.008),
            ])
        _join_meshes(label, pieces, parent=group, properties=props, hide_render=True)

    light_props = _variant_properties("light_mount")
    light_group = _group("LOD0_RecessedLightMount", root, **light_props)
    light_group.hide_render = True
    light_parts = [
        A.cylinder("RecessedLightMount", 0.09, 0.045, (0.0, 0.0, 0.0225), p["restrained_brass"], vertices=20, parent=light_group, bevel=0.006),
        A.cylinder("WarmLampLens", 0.065, 0.02, (0.0, 0.0, 0.01), m["lamp"], vertices=20, parent=light_group, bevel=0.004),
    ]
    _join_meshes("RecessedLightMountAssembly", light_parts, parent=light_group, properties=light_props, hide_render=True)
    for name, loc in (("BeamNext", (1.80, 0.0, 0.12)), ("BeamCross", (0.0, 0.0, 0.12)), ("BeamEnd", (-1.80, 0.0, 0.12)), ("RecessedLight", (0.0, 0.0, 0.0))):
        _marker(name, root, loc)
    A.collision_box("BeamOverhead", (3.60, 0.20, 0.24), (0.0, 0.0, 0.12), parent=root, purpose="overhead-blocking")
    return root


def build_59() -> bpy.types.Object:
    legacy_finish_ids = ["oak", "walnut", "dark_wood", "sage_carpet", "gray_carpet", "cream_tile", "stone_tile"]
    construction_families = [
        ("concrete", "Concrete", "slab", (0.36, 0.34, 0.30)),
        ("vinyl", "Vinyl", "plank", (0.38, 0.43, 0.34)),
        ("laminate", "Laminate", "plank", (0.45, 0.29, 0.16)),
        ("hardwood", "Hardwood", "plank", (0.47, 0.27, 0.13)),
        ("luxury_hardwood", "LuxuryHardwood", "wide_plank", (0.27, 0.12, 0.052)),
        ("stone_tile", "StoneTile", "tile", (0.36, 0.38, 0.37)),
        ("marble", "Marble", "large_tile", (0.72, 0.69, 0.62)),
        ("herringbone", "Herringbone", "herringbone", (0.33, 0.16, 0.065)),
    ]
    construction_qualities = [
        ("municipal", "Municipal", 1, 0.94),
        ("standard", "Standard", 2, 0.82),
        ("premium", "Premium", 3, 0.69),
        ("high_end", "HighEnd", 4, 0.56),
        ("luxury", "Luxury", 5, 0.44),
    ]
    construction_finish_ids = [
        f"construction_{family_id}_{quality_id}"
        for family_id, _family_label, _kind, _color in construction_families
        for quality_id, _quality_label, _quality_level, _roughness in construction_qualities
    ]
    finish_ids = legacy_finish_ids + construction_finish_ids
    root, _p = _root(
        59,
        material_carrier=True,
        modular_flooring=True,
        mesh_budget=64,
        triangle_budget=90000,
        variant_selection_contract="adapter selects one top-level variant_id/finish_variant group; hide_render is preview-only",
        variant_ids_json=json.dumps(finish_ids),
        finish_variant_ids_json=json.dumps(finish_ids),
        default_finish_variant="oak",
        construction_finish_family_count=len(construction_families),
        construction_quality_level_count=len(construction_qualities),
        construction_finish_variant_count=len(construction_finish_ids),
        construction_reference="Designs/ClubHouse — five-grade municipal-to-luxury finish board",
        oak_finish_contract="quiet natural-oak planks; modeled 2 mm longitudinal joints; flush one-metre module ends; exactly tileable grain",
    )
    surface = _surface_materials(*(finish_id for finish_id in legacy_finish_ids if finish_id != "oak"))
    surface["oak"] = _texture_material("floor_oak", roughness=0.90)
    _placement(root)

    variants = (
        ("oak", "Oak", "wood"),
        ("walnut", "Walnut", "wood"),
        ("dark_wood", "DarkWood", "wood"),
        ("sage_carpet", "SageCarpet", "carpet"),
        ("gray_carpet", "GrayCarpet", "carpet"),
        ("cream_tile", "CreamTile", "tile"),
        ("stone_tile", "StoneTile", "tile"),
    )
    for index, (variant_id, label, surface_kind) in enumerate(variants):
        hidden = index != 0
        props = {
            **_variant_properties(variant_id, default=not hidden),
            "finish_variant": variant_id,
            "finish_family": surface_kind,
            "material_carrier": True,
            "variant_index": index,
        }
        group = _group(f"LOD0_Floor{label}", root, **props)
        group.hide_render = hidden
        pieces: list[bpy.types.Object] = []
        if surface_kind == "wood":
            plank_count = 7
            gap = 0.002 if variant_id == "oak" else 0.003
            plank_width = (1.0 - gap * (plank_count - 1)) / plank_count
            if variant_id == "oak":
                # A shallow same-finish bed keeps the modeled joints warm and
                # subtle instead of reading as a black one-metre tile grid.
                pieces.append(_box(
                    "FloorOakWarmJointBed",
                    (1.0, 1.0, 0.004),
                    (0.0, 0.0, 0.002),
                    surface[variant_id],
                    group,
                    bevel=0.0003,
                    properties={"joint_bed": True, "walk_plane_owner": False},
                ))
            for plank_index in range(plank_count):
                x = -0.5 + plank_width / 2.0 + plank_index * (plank_width + gap)
                pieces.append(_box(
                    f"Floor{label}Plank_{plank_index}",
                    (plank_width, 1.0, 0.018),
                    (x, 0.0, 0.009),
                    surface[variant_id],
                    group,
                    # Finished-oak module ends remain flush and coplanar.  The
                    # physical 2 mm longitudinal gaps supply sufficient edge
                    # definition without outlining every one-metre tile.
                    bevel=0.0 if variant_id == "oak" else 0.0008,
                    properties={
                        "plank_index": plank_index,
                        "grain_axis": "Y",
                        "plank_joint_m": gap,
                        "quiet_finish": variant_id == "oak",
                        "flush_runtime_module_ends": variant_id == "oak",
                    },
                ))
            mesh_name = f"Floor{label}PlankField"
        elif surface_kind == "tile":
            tile_count, gap = 4, 0.008
            tile_width = (1.0 - gap * (tile_count - 1)) / tile_count
            for row in range(tile_count):
                for column in range(tile_count):
                    x = -0.5 + tile_width / 2.0 + column * (tile_width + gap)
                    y = -0.5 + tile_width / 2.0 + row * (tile_width + gap)
                    pieces.append(_box(
                        f"Floor{label}Tile_{row}_{column}",
                        (tile_width, tile_width, 0.018),
                        (x, y, 0.009),
                        surface[variant_id],
                        group,
                        bevel=0.0025,
                        properties={"tile_row": row, "tile_column": column},
                    ))
            mesh_name = f"Floor{label}TileField"
        else:
            pieces.append(_box(
                f"Floor{label}CarpetField",
                (1.0, 1.0, 0.018),
                (0.0, 0.0, 0.009),
                surface[variant_id],
                group,
                bevel=0.002,
                properties={"pile_direction": "Y", "carpet_field": True},
            ))
            mesh_name = f"Floor{label}CarpetField"
        joined_finish = _join_meshes(mesh_name, pieces, parent=group, properties=props, hide_render=hidden)
        if variant_id == "oak":
            # Floor planes must retain hard, planar normals after the individual
            # plank boxes are joined.  Limit this override to the default oak
            # mesh so carpet/tile/alternate-wood shading remains untouched.
            for polygon in joined_finish.data.polygons:
                polygon.use_smooth = False
            joined_finish.data.update()
            joined_finish["flat_floor_normals"] = True
            joined_finish["normal_contract"] = "all oak flooring polygons explicitly flat after join"

    # The material-upgrade library keeps the same exact 1 x 1 x 0.018 m carrier
    # used by every existing Sheet-6 floor. Every family is therefore a safe
    # runtime material/geometry swap over the one analytic walk plane. Grade
    # changes are visible in joint precision, board/tile rhythm, bevel restraint,
    # color depth and roughness—not merely in an inventory label.
    construction_variant_index = len(variants)
    for family_id, family_label, surface_kind, base_color in construction_families:
        for quality_id, quality_label, quality_level, roughness in construction_qualities:
            variant_id = f"construction_{family_id}_{quality_id}"
            tint = 0.84 + quality_level * 0.045
            color = tuple(min(0.92, channel * tint + (quality_level - 1) * 0.008) for channel in base_color)
            material = A.material(
                f"S06_Floor_{family_label}_{quality_label}",
                (*color, 1.0),
                roughness=roughness,
            )
            props = {
                **_variant_properties(variant_id),
                "finish_variant": variant_id,
                "finish_family": family_id,
                "construction_quality": quality_id,
                "construction_quality_level": quality_level,
                "material_carrier": True,
                "variant_index": construction_variant_index,
                "reference_progression": "municipal_standard_premium_high_end_luxury_country_club",
                "authored_dimensions_m": "1.0 x 1.0 x 0.018",
            }
            construction_variant_index += 1
            group = _group(f"LOD0_Floor{family_label}{quality_label}", root, **props)
            group.hide_render = True
            pieces: list[bpy.types.Object] = []
            joint = max(0.0012, 0.0065 - quality_level * 0.00105)
            bevel = 0.00035 + quality_level * 0.00018

            # Every construction variant owns a full-footprint finish bed. It
            # closes modeled joints, guarantees identical measurable bounds and
            # prevents the one-metre runtime cells from reading as black tiles.
            pieces.append(_box(
                f"Floor{family_label}{quality_label}FinishBed",
                (1.0, 1.0, 0.004),
                (0.0, 0.0, 0.002),
                material,
                group,
                bevel=0.0002,
                properties={"joint_bed": True, "walk_plane_owner": False, **props},
            ))

            if surface_kind in {"plank", "wide_plank"}:
                plank_count = (5 if surface_kind == "wide_plank" else 7) + (1 if quality_level == 1 else 0)
                plank_width = (1.0 - joint * (plank_count - 1)) / plank_count
                for plank_index in range(plank_count):
                    x = -0.5 + plank_width / 2.0 + plank_index * (plank_width + joint)
                    pieces.append(_box(
                        f"Floor{family_label}{quality_label}Plank_{plank_index}",
                        (plank_width, 1.0, 0.014),
                        (x, 0.0, 0.011),
                        material,
                        group,
                        bevel=bevel,
                        properties={
                            "plank_index": plank_index,
                            "grain_axis": "Y",
                            "plank_joint_m": joint,
                            "board_selection_grade": quality_level,
                        },
                    ))
                mesh_name = f"Floor{family_label}{quality_label}PlankField"
            elif surface_kind in {"tile", "large_tile"}:
                tile_count = 2 if surface_kind == "large_tile" else (3 if quality_level >= 4 else 4)
                tile_width = (1.0 - joint * (tile_count - 1)) / tile_count
                for row in range(tile_count):
                    for column in range(tile_count):
                        x = -0.5 + tile_width / 2.0 + column * (tile_width + joint)
                        y = -0.5 + tile_width / 2.0 + row * (tile_width + joint)
                        pieces.append(_box(
                            f"Floor{family_label}{quality_label}Tile_{row}_{column}",
                            (tile_width, tile_width, 0.014),
                            (x, y, 0.011),
                            material,
                            group,
                            bevel=bevel * 1.5,
                            properties={"tile_row": row, "tile_column": column, "calibration_grade": quality_level},
                        ))
                mesh_name = f"Floor{family_label}{quality_label}TileField"
            elif surface_kind == "herringbone":
                # Contained parquet pairs sit on the exact-size bed; their true
                # alternating 45-degree silhouettes remain inside the carrier.
                pair_centers = [(-0.24, -0.24), (0.0, -0.24), (0.24, -0.24),
                                (-0.12, 0.0), (0.12, 0.0),
                                (-0.24, 0.24), (0.0, 0.24), (0.24, 0.24)]
                for pair_index, (x, y) in enumerate(pair_centers):
                    for side, angle in enumerate((math.radians(45), math.radians(-45))):
                        offset = -0.045 if side == 0 else 0.045
                        pieces.append(_box(
                            f"Floor{family_label}{quality_label}Parquet_{pair_index}_{side}",
                            (0.075, 0.265, 0.014),
                            (x + offset, y, 0.011),
                            material,
                            group,
                            rotation=(0.0, 0.0, angle),
                            bevel=bevel,
                            properties={"parquet_pair": pair_index, "parquet_side": side, "pattern": "herringbone"},
                        ))
                mesh_name = f"Floor{family_label}{quality_label}HerringboneField"
            else:
                pieces.append(_box(
                    f"Floor{family_label}{quality_label}SlabField",
                    (0.998, 0.998, 0.014),
                    (0.0, 0.0, 0.011),
                    material,
                    group,
                    bevel=bevel,
                    properties={"slab_field": True, "polish_grade": quality_level},
                ))
                mesh_name = f"Floor{family_label}{quality_label}SlabField"

            joined = _join_meshes(mesh_name, pieces, parent=group, properties=props, hide_render=True)
            for polygon in joined.data.polygons:
                polygon.use_smooth = False
            joined.data.update()
            joined["flat_floor_normals"] = True
            joined["normal_contract"] = "all construction finish polygons explicitly flat after join"
    _marker("FloorOrigin", root)
    _marker("FloorTransition", root, (0.50, 0.0, 0.009))
    A.collision_box("FloorWalkable", (1.0, 1.0, 0.018), (0.0, 0.0, 0.009), parent=root, purpose="walkable")
    return root


def build_60() -> bpy.types.Object:
    damage_ids = ["damaged_wood", "damaged_carpet", "damaged_tile"]
    root, p = _root(
        60,
        additive_damage_only=True,
        structural_collision=False,
        modular_floor_damage=True,
        mesh_budget=20,
        triangle_budget=36000,
        variant_selection_contract="adapter selects one top-level variant_id/damage_variant group; hide_render is preview-only",
        variant_ids_json=json.dumps(damage_ids),
        damage_variant_ids_json=json.dumps(damage_ids),
        default_damage_variant="damaged_wood",
        maximum_visible_relief_m=0.035,
    )
    surface = _surface_materials(*damage_ids)
    exposed_subfloor = A.material("S06_ExposedSubfloorShadow", (0.028, 0.018, 0.010, 1.0), roughness=0.99)
    broken_oak = A.material("S06_BrokenOak", (0.14, 0.070, 0.028, 1.0), roughness=0.94)
    raw_oak_edge = A.material("S06_RawOakBreak", (0.22, 0.12, 0.050, 1.0), roughness=0.91)
    _placement(root)
    common = {"damage_overlay": True, "repairable": True, "nav_blocking": False}

    # Default damaged wood is an additive condition layer, never a second full
    # flooring field.  Sparse stains, cracks, chips and lifted fragments reveal
    # the selected Asset-59 finish beneath; the highest fragment remains 35 mm.
    wood_props = {
        **_variant_properties("damaged_wood", default=True),
        "damage_variant": "damaged_wood",
        "finish_family": "wood",
        "overlay_role": "additive",
    }
    wood_group = _group("LOD0_FloorDamageWood", root, **wood_props)
    # Three narrow, staggered reveals follow the Asset-59 plank direction and
    # read as missing boards instead of a loose rug or circular stain.  Each is
    # a closed 1.2 mm skin immediately above the 18 mm walk surface, never a
    # replacement flooring field or navigation collider.
    pocket_parts: list[bpy.types.Object] = []
    for pocket_index, (center_x, low_y, high_y) in enumerate((
        (-0.20, -0.34, 0.24),
        (-0.03, -0.12, 0.36),
        (0.14, -0.30, 0.13),
    )):
        half_width = 0.060
        outline_xy = [
            (center_x - half_width, low_y + 0.035),
            (center_x - half_width * 0.45, low_y),
            (center_x + half_width, low_y + 0.050),
            (center_x + half_width, high_y - 0.045),
            (center_x + half_width * 0.15, high_y),
            (center_x - half_width, high_y - 0.030),
        ]
        pocket_parts.append(A.profile_prism(
            f"SubfloorReveal_{pocket_index}",
            [(x, -y) for x, y in outline_xy],
            0.0012,
            (0.0, 0.0, 0.0190),
            exposed_subfloor,
            rotation=(math.pi / 2.0, 0.0, 0.0),
            parent=wood_group,
            bevel=0.0,
            properties={**common, "damage_kind": "jagged_subfloor_reveal", "plank_index": pocket_index},
        ))
    _join_meshes(
        "DamagedWoodSubfloorPocket",
        pocket_parts,
        parent=wood_group,
        properties={
            **wood_props,
            **common,
            "damage_kind": "jagged_subfloor_reveal",
            "full_replacement_field": False,
            "missing_board_count": len(pocket_parts),
            "grain_axis": "Y",
            "visual_read": "three missing finish boards expose dark subfloor",
        },
    )
    localized_wood_parts = [
        _box("DamagedWoodPlank_0", (0.13, 0.48, 0.008), (-0.17, -0.01, 0.02665), broken_oak, wood_group, rotation=(0.018, 0.0, 0.035), bevel=0.004, properties={**common, "damage_kind": "cupped_edge_fragment", "plank_index": 0, "grain_axis": "Y"}),
        _box("DamagedWoodPlank_1", (0.13, 0.36, 0.008), (0.12, 0.07, 0.02530), broken_oak, wood_group, rotation=(-0.018, 0.0, -0.040), bevel=0.003, properties={**common, "damage_kind": "cupped_edge_fragment", "plank_index": 1, "grain_axis": "Y"}),
        _box("DamagedWoodPlank_2", (0.11, 0.25, 0.006), (0.28, -0.13, 0.02270), raw_oak_edge, wood_group, rotation=(0.012, 0.0, 0.025), bevel=0.003, properties={**common, "damage_kind": "cupped_edge_fragment", "plank_index": 2, "grain_axis": "Y"}),
    ]
    _join_meshes(
        # Preserve the established runtime/reimport mesh name while replacing
        # its former one-square-metre board field with three local fragments.
        "DamagedWoodUnevenPlankField",
        localized_wood_parts,
        parent=wood_group,
        properties={
            **wood_props,
            **common,
            "non_flat_geometry": True,
            "full_replacement_field": False,
            "localized_fragment_count": len(localized_wood_parts),
            "grain_axis": "Y",
            "visual_read": "broken boards remain aligned with Asset 59 plank direction",
        },
    )
    lifted_parts = [
        _box("LiftedBrokenPlank_A", (0.12, 0.28, 0.009), (-0.31, 0.16, 0.0255), raw_oak_edge, wood_group, rotation=(0.020, 0.0, 0.055), bevel=0.005),
        _box("LiftedBrokenPlank_B", (0.10, 0.22, 0.007), (0.29, 0.19, 0.0235), broken_oak, wood_group, rotation=(-0.015, 0.0, -0.045), bevel=0.004),
        _box("LiftedBrokenPlank_C", (0.08, 0.17, 0.006), (0.03, -0.31, 0.0225), raw_oak_edge, wood_group, rotation=(0.012, 0.0, 0.035), bevel=0.003),
    ]
    _join_meshes("DamagedWoodLiftedFragments", lifted_parts, parent=wood_group, properties={**wood_props, **common, "damage_kind": "lifted_broken_plank", "maximum_top_m": 0.035, "grain_axis": "Y"})
    crack_parts: list[bpy.types.Object] = []
    for crack_index, points in enumerate((((-0.45, -0.09), (-0.20, 0.02), (0.02, -0.07)), ((0.12, 0.43), (0.22, 0.18), (0.45, 0.06)))):
        for segment_index, (start, end) in enumerate(zip(points, points[1:])):
            dx, dy = end[0] - start[0], end[1] - start[1]
            crack_parts.append(_box(
                f"WoodCrack_{crack_index}_{segment_index}",
                (math.hypot(dx, dy), 0.008, 0.002),
                ((start[0] + end[0]) / 2.0, (start[1] + end[1]) / 2.0, 0.019),
                p["soft_black"],
                wood_group,
                rotation=(0.0, 0.0, math.atan2(dy, dx)),
                bevel=0.0015,
                properties={**common, "damage_kind": "crack"},
            ))
    _join_meshes("DamagedWoodCrackNetwork", crack_parts, parent=wood_group, properties={**wood_props, **common, "damage_kind": "crack"})
    chip_parts = [
        _box("WoodChip_0", (0.018, 0.105, 0.003), (-0.39, 0.31, 0.0200), raw_oak_edge, wood_group, rotation=(0.0, 0.0, 0.20), bevel=0.001),
        _box("WoodChip_1", (0.022, 0.090, 0.003), (0.38, -0.30, 0.0200), broken_oak, wood_group, rotation=(0.0, 0.0, -0.24), bevel=0.001),
        _box("WoodChip_2", (0.014, 0.072, 0.0025), (0.36, 0.31, 0.01975), raw_oak_edge, wood_group, rotation=(0.0, 0.0, 0.34), bevel=0.0008),
    ]
    _join_meshes("DamagedWoodChips", chip_parts, parent=wood_group, properties={**wood_props, **common, "damage_kind": "splinter", "chip_shape": "slender wood splinters"})

    carpet_props = {
        **_variant_properties("damaged_carpet"),
        "damage_variant": "damaged_carpet",
        "finish_family": "carpet",
        "overlay_role": "additive",
    }
    carpet_group = _group("LOD0_FloorDamageCarpet", root, **carpet_props)
    carpet_group.hide_render = True
    carpet_base = _box("DamagedCarpetField", (1.0, 1.0, 0.018), (0.0, 0.0, 0.009), surface["damaged_carpet"], carpet_group, bevel=0.002, properties={**common, "damage_kind": "stained_carpet"})
    _join_meshes("DamagedCarpetStainedField", [carpet_base], parent=carpet_group, properties={**carpet_props, **common, "damage_kind": "stained_carpet"}, hide_render=True)
    tear_parts = [
        _box("CarpetTearShadow", (0.46, 0.035, 0.003), (0.03, -0.04, 0.0195), p["soft_black"], carpet_group, rotation=(0.0, 0.0, -0.16), bevel=0.002),
        _box("CarpetLiftedFlap", (0.37, 0.14, 0.012), (0.10, 0.02, 0.026), surface["damaged_carpet"], carpet_group, rotation=(0.0, 0.0, -0.13), bevel=0.008),
    ]
    _join_meshes("DamagedCarpetTornFlap", tear_parts, parent=carpet_group, properties={**carpet_props, **common, "damage_kind": "torn_carpet"}, hide_render=True)
    frays = [
        _box(f"CarpetFray_{index}", (0.18 - index * 0.018, 0.012, 0.005), (-0.07 + index * 0.055, -0.01 + index * 0.017, 0.0325), surface["damaged_carpet"], carpet_group, rotation=(0.0, 0.0, -0.30 + index * 0.12), bevel=0.002)
        for index in range(5)
    ]
    _join_meshes("DamagedCarpetFrayedFibres", frays, parent=carpet_group, properties={**carpet_props, **common, "damage_kind": "frayed_carpet", "maximum_top_m": 0.035}, hide_render=True)

    tile_props = {
        **_variant_properties("damaged_tile"),
        "damage_variant": "damaged_tile",
        "finish_family": "tile",
        "overlay_role": "additive",
    }
    tile_group = _group("LOD0_FloorDamageTile", root, **tile_props)
    tile_group.hide_render = True
    tile_parts: list[bpy.types.Object] = []
    tile_count, tile_gap = 4, 0.008
    tile_width = (1.0 - tile_gap * (tile_count - 1)) / tile_count
    for row in range(tile_count):
        for column in range(tile_count):
            x = -0.5 + tile_width / 2.0 + column * (tile_width + tile_gap)
            y = -0.5 + tile_width / 2.0 + row * (tile_width + tile_gap)
            height = 0.014 + 0.002 * ((row + column) % 3)
            tile_parts.append(_box(
                f"DamagedTile_{row}_{column}",
                (tile_width, tile_width, height),
                (x, y, height / 2.0),
                surface["damaged_tile"],
                tile_group,
                bevel=0.003,
                properties={**common, "damage_kind": "uneven_tile", "tile_row": row, "tile_column": column},
            ))
    _join_meshes("DamagedTileUnevenField", tile_parts, parent=tile_group, properties={**tile_props, **common, "non_flat_geometry": True}, hide_render=True)
    tile_breaks = [
        _box("MissingTilePocket", (tile_width * 0.72, tile_width * 0.72, 0.003), (0.125, -0.125, 0.0015), p["soft_black"], tile_group, bevel=0.004),
        _box("LiftedTileShard_A", (0.21, 0.10, 0.016), (-0.18, 0.17, 0.027), surface["damaged_tile"], tile_group, rotation=(0.0, 0.0, 0.17), bevel=0.006),
        _box("LiftedTileShard_B", (0.14, 0.09, 0.011), (-0.03, 0.28, 0.0265), surface["damaged_tile"], tile_group, rotation=(0.0, 0.0, -0.22), bevel=0.005),
    ]
    _join_meshes("DamagedTileBrokenAndMissingPieces", tile_breaks, parent=tile_group, properties={**tile_props, **common, "damage_kind": "broken_tile"}, hide_render=True)
    tile_cracks: list[bpy.types.Object] = []
    for index, (start, end) in enumerate((((-0.44, -0.33), (-0.16, -0.13)), ((-0.16, -0.13), (0.08, -0.25)), ((0.08, -0.25), (0.39, -0.06)))):
        dx, dy = end[0] - start[0], end[1] - start[1]
        tile_cracks.append(_box(
            f"TileCrack_{index}",
            (math.hypot(dx, dy), 0.010, 0.003),
            ((start[0] + end[0]) / 2.0, (start[1] + end[1]) / 2.0, 0.0195),
            p["soft_black"],
            tile_group,
            rotation=(0.0, 0.0, math.atan2(dy, dx)),
            bevel=0.0015,
        ))
    _join_meshes("DamagedTileCrackNetwork", tile_cracks, parent=tile_group, properties={**tile_props, **common, "damage_kind": "crack"}, hide_render=True)
    _marker("FloorOrigin", root)
    _marker("DamageModule", root, (0.0, 0.0, 0.018))
    _marker("FloorTransition", root, (0.50, 0.0, 0.018))
    A.collision_box("FloorDamageRaycast", (1.0, 1.0, 0.035), (0.0, 0.0, 0.0175), parent=root, purpose="raycast-only")
    return root


BUILDERS: dict[int, Callable[[], bpy.types.Object]] = {
    51: build_51, 52: build_52, 53: build_53, 54: build_54, 55: build_55,
    56: build_56, 57: build_57, 58: build_58, 59: build_59, 60: build_60,
}


def _render_variant_previews(number: int, root: bpy.types.Object, options: A.BuildOptions) -> list[Path]:
    """Render tight, isolated evidence for every non-default runtime variant."""

    groups = sorted(
        (child for child in root.children if child.get("runtime_variant") and child.get("variant_id")),
        key=lambda child: str(child.get("variant_id")),
    )
    if not groups:
        return []
    renderables = {
        group: [group, *list(A.descendants(group))]
        for group in groups
    }
    original_visibility = {
        obj: obj.hide_render
        for objects in renderables.values()
        for obj in objects
    }
    outputs: list[Path] = []
    try:
        for selected in groups:
            if selected.get("variant_default"):
                continue
            for group, objects in renderables.items():
                hidden = group is not selected
                for obj in objects:
                    obj.hide_render = hidden
            variant_id = str(selected.get("variant_id"))
            output = VARIANT_PREVIEW_DIR / f"asset_{number:03d}_variant_{variant_id}.png"
            A.render_studio_preview(
                selected,
                output,
                width=options.preview_width,
                height=options.preview_height,
                azimuth_degrees=options.preview_azimuth,
                elevation_degrees=options.preview_elevation,
            )
            outputs.append(output)
    finally:
        for obj, hidden in original_visibility.items():
            obj.hide_render = hidden
    print("VARIANT_PREVIEWS|" + json.dumps({"asset": number, "files": [str(path) for path in outputs]}, sort_keys=True))
    return outputs


def _parse_cli(argv: Sequence[str]) -> tuple[int | None, A.BuildOptions, bool]:
    selected: int | None = None
    variant_previews = False
    forwarded: list[str] = []
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--asset":
            if index + 1 >= len(argv):
                raise SystemExit("--asset requires a number from 51 through 60")
            selected = int(argv[index + 1])
            index += 2
            continue
        if arg.startswith("--asset="):
            selected = int(arg.split("=", 1)[1])
            index += 1
            continue
        if arg == "--variant-previews":
            variant_previews = True
            index += 1
            continue
        forwarded.append(arg)
        index += 1
    if selected is not None and selected not in BUILDERS:
        raise SystemExit(f"unsupported --asset {selected}; expected 51 through 60")
    # Forward all library-owned switches unchanged (preview today, force if/when added).
    return selected, A.parse_asset_cli(forwarded), variant_previews


def main(argv: Sequence[str] | None = None) -> int:
    selected, options, variant_previews = _parse_cli(A.blender_cli_args(sys.argv) if argv is None else list(argv))
    numbers = [selected] if selected is not None else sorted(BUILDERS)
    results: list[dict[str, object]] = []
    for number in numbers:
        A.reset_scene(seed=options.seed + number)
        root = BUILDERS[number]()
        root["deterministic_seed"] = options.seed + number
        result = A.publish_asset(
            IDENTITIES[number], root, options=options,
            expected_dimensions=DIMENSIONS[number],
            required_sockets=REQUIRED_MARKERS[number],
            required_animations=DOOR_ANIMATIONS if number == 53 else (),
            require_collision=number not in (52, 57, 60),
        )
        if variant_previews and number >= 55:
            _render_variant_previews(number, root, options)
        results.append({
            "asset": number,
            "source": str(result.paths.source),
            "canonical": str(result.paths.canonical_glb),
            "runtime": str(result.paths.runtime_glb),
            "preview": str(result.paths.preview),
            "canonical_sha256": result.canonical_sha256,
            "runtime_sha256": result.runtime_sha256,
            "validation": result.validation.to_dict(),
        })
    print("SHEET06_BUILD|" + json.dumps(results, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
