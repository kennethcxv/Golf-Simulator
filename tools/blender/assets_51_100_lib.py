"""Repeatable Blender production helpers for Golf Flipper Assets 51-100.

This module is intentionally independent from :mod:`lib_props`.  It establishes
the Sheet 6-10 source/export contract without changing the older prop pipeline.
All dimensions are metres, +Z is up, and the authored front/player side is -Y.

Typical per-asset builder::

    import assets_51_100_lib as A

    def build(ctx):
        root = A.asset_root(ctx.identity, (0.46, 0.31, 1.08))
        A.box("Housing", (0.40, 0.27, 0.55), (0, 0, 0.34),
              ctx.materials["deep_green"], parent=root)
        A.collision_box("Body", (0.40, 0.27, 0.55), (0, 0, 0.34),
                        parent=root, material=ctx.materials["collision"])
        A.socket("PLACEMENT", parent=root)
        return root

    if __name__ == "__main__":
        A.run_asset_cli(71, "vacuum_cleaner", build,
                        expected_dimensions=(0.46, 0.31, 1.08))

Invoke a builder through Blender, for example::

    blender --background --factory-startup --python build_sheet_08.py -- --preview

Canonical and runtime GLBs are two explicit exporter runs.  They can be
byte-equivalent until a measured, real runtime optimization stage exists.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import re
import sys
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, MutableMapping, Sequence

import bpy
import bmesh
from mathutils import Matrix, Vector


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
SOURCE_ROOT = REPO_ROOT / "asset_sources" / "blender" / "assets_51_100"
CANONICAL_ROOT = REPO_ROOT / "Assets" / "assets_51_100" / "glb"
RUNTIME_ROOT = REPO_ROOT / "vendor" / "models" / "assets_51_100"
QA_ROOT = REPO_ROOT / "qa" / "assets_51_100_master"

ASSET_MIN = 51
ASSET_MAX = 100
BUILD_SCHEMA_VERSION = 1
DEFAULT_SEED = 51100
FRONT_AXIS = "-Y"

_GENERIC_NAME = re.compile(
    r"^(?:Cube|Cylinder|Sphere|Icosphere|Torus|Cone|Curve|Text|Empty|"
    r"Material|Mesh|Object|BezierCurve)(?:\.\d+)?$",
    re.IGNORECASE,
)
_VALID_NODE_PREFIXES = ("A_", "MESH_", "COL_", "SOCKET_", "PIVOT_", "LOD0_", "LOD1_", "LOD2_")
_SAFE_TOKEN = re.compile(r"[^A-Za-z0-9]+")


# ---------------------------------------------------------------------------
# Identity, paths, deterministic CLI context


def _slug(value: str) -> str:
    value = _SAFE_TOKEN.sub("_", str(value).strip()).strip("_").lower()
    if not value:
        raise ValueError("asset slug cannot be empty")
    return value


def _label(value: str) -> str:
    value = _SAFE_TOKEN.sub("_", str(value).strip()).strip("_")
    if not value:
        raise ValueError("node label cannot be empty")
    return value


def sheet_for_asset(asset_number: int) -> int:
    asset_number = int(asset_number)
    if not ASSET_MIN <= asset_number <= ASSET_MAX:
        raise ValueError(f"asset number must be {ASSET_MIN}-{ASSET_MAX}, got {asset_number}")
    return math.ceil(asset_number / 10)


@dataclass(frozen=True)
class AssetIdentity:
    number: int
    slug: str
    first_person: bool = False

    def __post_init__(self) -> None:
        sheet_for_asset(self.number)
        object.__setattr__(self, "slug", _slug(self.slug))

    @property
    def sheet(self) -> int:
        return sheet_for_asset(self.number)

    @property
    def stem(self) -> str:
        suffix = "_fp" if self.first_person else ""
        return f"asset_{self.number:03d}_{self.slug}{suffix}"

    @property
    def root_name(self) -> str:
        suffix = "_FP" if self.first_person else ""
        return f"A_{self.number:03d}_{_label(self.slug).upper()}{suffix}_ROOT"


@dataclass(frozen=True)
class ProductionPaths:
    source: Path
    canonical_glb: Path
    runtime_glb: Path
    preview: Path

    def create_parents(self) -> None:
        for path in (self.source, self.canonical_glb, self.runtime_glb, self.preview):
            path.parent.mkdir(parents=True, exist_ok=True)

    def as_relative_dict(self, root: Path = REPO_ROOT) -> dict[str, str]:
        def display(path: Path) -> str:
            try:
                return path.resolve().relative_to(root.resolve()).as_posix()
            except ValueError:
                return str(path.resolve())

        return {
            "source": display(self.source),
            "canonicalGlb": display(self.canonical_glb),
            "runtimeGlb": display(self.runtime_glb),
            "preview": display(self.preview),
        }


def production_paths(identity: AssetIdentity) -> ProductionPaths:
    """Return the exact planned source, canonical, runtime, and QA paths."""

    if identity.first_person:
        source_dir = SOURCE_ROOT / "firstperson"
        canonical_dir = CANONICAL_ROOT / "firstperson"
        runtime_dir = RUNTIME_ROOT / "firstperson"
        preview_dir = QA_ROOT / "previews" / "firstperson"
    else:
        sheet_dir = f"sheet_{identity.sheet:02d}"
        source_dir = SOURCE_ROOT / sheet_dir
        canonical_dir = CANONICAL_ROOT / sheet_dir
        runtime_dir = RUNTIME_ROOT / sheet_dir
        preview_dir = QA_ROOT / "previews" / sheet_dir
    return ProductionPaths(
        source=source_dir / f"{identity.stem}.blend",
        canonical_glb=canonical_dir / f"{identity.stem}.glb",
        runtime_glb=runtime_dir / f"{identity.stem}.glb",
        preview=preview_dir / f"{identity.stem}.png",
    )


@dataclass(frozen=True)
class BuildOptions:
    preview: bool = False
    save_source: bool = True
    export_glbs: bool = True
    strict: bool = True
    seed: int = DEFAULT_SEED
    preview_width: int = 1200
    preview_height: int = 900
    preview_azimuth: float = 38.0
    preview_elevation: float = 24.0


@dataclass
class BuildContext:
    identity: AssetIdentity
    paths: ProductionPaths
    materials: dict[str, bpy.types.Material]
    options: BuildOptions


@dataclass(frozen=True)
class PublishResult:
    identity: AssetIdentity
    paths: ProductionPaths
    validation: "ValidationReport"
    canonical_sha256: str | None
    runtime_sha256: str | None


def blender_cli_args(argv: Sequence[str] | None = None) -> list[str]:
    """Return arguments following Blender's ``--`` separator."""

    argv = list(sys.argv if argv is None else argv)
    return argv[argv.index("--") + 1 :] if "--" in argv else []


def asset_cli_parser(description: str | None = None) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=description or __doc__)
    parser.add_argument("--preview", action="store_true", help="render isolated QA preview after export")
    parser.add_argument("--no-save", action="store_true", help="do not save the Blender source")
    parser.add_argument("--no-export", action="store_true", help="do not write canonical/runtime GLBs")
    parser.add_argument("--no-strict", action="store_true", help="report validation errors without raising")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--preview-width", type=int, default=1200)
    parser.add_argument("--preview-height", type=int, default=900)
    parser.add_argument("--preview-azimuth", type=float, default=38.0)
    parser.add_argument("--preview-elevation", type=float, default=24.0)
    return parser


def parse_asset_cli(argv: Sequence[str] | None = None) -> BuildOptions:
    ns = asset_cli_parser().parse_args(blender_cli_args() if argv is None else list(argv))
    return BuildOptions(
        preview=ns.preview,
        save_source=not ns.no_save,
        export_glbs=not ns.no_export,
        strict=not ns.no_strict,
        seed=ns.seed,
        preview_width=max(320, ns.preview_width),
        preview_height=max(240, ns.preview_height),
        preview_azimuth=ns.preview_azimuth,
        preview_elevation=ns.preview_elevation,
    )


# ---------------------------------------------------------------------------
# Scene, hierarchy, names, transforms


def reset_scene(*, factory: bool = True, seed: int = DEFAULT_SEED) -> bpy.types.Scene:
    """Start a deterministic, empty metric/Z-up production scene."""

    if factory:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    else:
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)
        for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                           bpy.data.images, bpy.data.cameras, bpy.data.lights):
            for datablock in list(datablocks):
                if datablock.users == 0:
                    datablocks.remove(datablock)
    random.seed(seed)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    scene.render.fps = 30
    scene.render.fps_base = 1.0
    scene.frame_start = 1
    scene.frame_end = 60
    scene.frame_set(1)
    scene["asset_pipeline"] = "Golf Flipper Assets 51-100"
    scene["asset_pipeline_schema"] = BUILD_SCHEMA_VERSION
    scene["units"] = "meters"
    scene["up_axis"] = "+Z"
    scene["front_axis"] = FRONT_AXIS
    try:
        bpy.context.preferences.filepaths.save_version = 0
    except Exception:
        pass
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    return scene


def activate(obj: bpy.types.Object) -> bpy.types.Object:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    return obj


def parent_keep_world(obj: bpy.types.Object, parent: bpy.types.Object | None) -> bpy.types.Object:
    if parent is None:
        return obj
    bpy.context.view_layer.update()
    matrix = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_parent_inverse = parent.matrix_world.inverted()
    obj.matrix_world = matrix
    bpy.context.view_layer.update()
    return obj


def descendants(root: bpy.types.Object, *, include_root: bool = True) -> list[bpy.types.Object]:
    result: list[bpy.types.Object] = [root] if include_root else []
    queue = list(root.children)
    while queue:
        obj = queue.pop(0)
        result.append(obj)
        queue.extend(obj.children)
    return result


def _mesh_name(name: str, *, collision: bool = False) -> str:
    prefix = "COL_" if collision else "MESH_"
    clean = _label(name)
    if clean.startswith(prefix):
        return clean
    if clean.startswith("MESH_") or clean.startswith("COL_"):
        clean = clean.split("_", 1)[1]
    return prefix + clean


def _marker_name(name: str, prefix: str) -> str:
    clean = _label(name)
    return clean if clean.startswith(prefix) else prefix + clean


def asset_root(
    identity: AssetIdentity | int,
    target_dimensions: Sequence[float] | Mapping[str, float],
    *,
    slug: str | None = None,
    source_note: str = "Original Pinehollow Golf Flipper asset authored in-repository",
    license_note: str = "Project-owned",
) -> bpy.types.Object:
    """Create the single canonical ``A_NNN_*_ROOT`` node."""

    if isinstance(identity, int):
        if slug is None:
            raise ValueError("slug is required when asset_root receives an integer")
        identity = AssetIdentity(identity, slug)
    obj = bpy.data.objects.new(identity.root_name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.20
    obj["asset_number"] = identity.number
    obj["asset_slug"] = identity.slug
    obj["asset_stem"] = identity.stem
    obj["asset_sheet"] = identity.sheet
    obj["first_person_variant"] = identity.first_person
    obj["build_schema_version"] = BUILD_SCHEMA_VERSION
    obj["units"] = "meters"
    obj["up_axis"] = "+Z"
    obj["front_axis"] = FRONT_AXIS
    obj["target_dimensions_m"] = json.dumps(target_dimensions, sort_keys=True)
    if isinstance(target_dimensions, Sequence) and not isinstance(target_dimensions, (str, bytes)):
        dims = list(target_dimensions)
        if len(dims) == 3:
            obj["target_width_m"], obj["target_depth_m"], obj["target_height_m"] = map(float, dims)
    obj["source"] = source_note
    obj["license"] = license_note
    return obj


def empty_marker(
    name: str,
    *,
    prefix: str = "SOCKET_",
    location: Sequence[float] = (0.0, 0.0, 0.0),
    rotation: Sequence[float] = (0.0, 0.0, 0.0),
    parent: bpy.types.Object | None = None,
    size: float = 0.08,
    properties: Mapping[str, Any] | None = None,
) -> bpy.types.Object:
    if prefix not in ("SOCKET_", "PIVOT_"):
        raise ValueError("marker prefix must be SOCKET_ or PIVOT_")
    obj = bpy.data.objects.new(_marker_name(name, prefix), None)
    bpy.context.collection.objects.link(obj)
    obj.location = tuple(location)
    obj.rotation_euler = tuple(rotation)
    obj.empty_display_type = "ARROWS" if prefix == "SOCKET_" else "PLAIN_AXES"
    obj.empty_display_size = float(size)
    obj["marker_type"] = "socket" if prefix == "SOCKET_" else "pivot"
    for key, value in (properties or {}).items():
        obj[key] = value
    parent_keep_world(obj, parent)
    return obj


def socket(name: str, **kwargs: Any) -> bpy.types.Object:
    return empty_marker(name, prefix="SOCKET_", **kwargs)


def pivot(name: str, **kwargs: Any) -> bpy.types.Object:
    return empty_marker(name, prefix="PIVOT_", **kwargs)


def apply_transforms(
    obj: bpy.types.Object,
    *,
    location: bool = False,
    rotation: bool = True,
    scale: bool = True,
) -> bpy.types.Object:
    activate(obj)
    bpy.ops.object.transform_apply(location=location, rotation=rotation, scale=scale)
    return obj


# ---------------------------------------------------------------------------
# Pinehollow stylized PBR materials and project-owned texture support


PALETTE_SRGB_HEX: Mapping[str, str] = {
    "warm_cream": "E8DFC9",
    "deep_green": "173F32",
    "muted_sage": "829681",
    "medium_walnut": "704934",
    "natural_oak": "B98A59",
    "warm_charcoal": "292C2A",
    "restrained_brass": "9B7A3B",
    "brushed_steel": "737B7C",
    "soft_black": "111513",
    "rubber": "171B19",
    "paper": "EEE9DC",
    "safety_red": "9E2F2B",
    "safety_yellow": "C9A33B",
    "cool_white": "DDE4E0",
    "glass_tint": "B8D0C9",
}


def _srgb_channel_to_linear(value: float) -> float:
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgba(value: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    value = value.strip().lstrip("#")
    if len(value) != 6:
        raise ValueError(f"expected six-digit hex color, got {value!r}")
    channels = [int(value[index : index + 2], 16) / 255.0 for index in (0, 2, 4)]
    return (*(_srgb_channel_to_linear(channel) for channel in channels), float(alpha))


def _principled_input(node: bpy.types.Node, names: Sequence[str]) -> Any | None:
    for name in names:
        socket_input = node.inputs.get(name)
        if socket_input is not None:
            return socket_input
    return None


def material(
    name: str,
    base_color: Sequence[float],
    *,
    roughness: float = 0.55,
    metallic: float = 0.0,
    alpha: float | None = None,
    transmission: float = 0.0,
    ior: float = 1.45,
    coat: float = 0.0,
    emission_color: Sequence[float] | None = None,
    emission_strength: float = 0.0,
    double_sided: bool = False,
) -> bpy.types.Material:
    """Create/reuse a clean stylized-PBR material with Blender 5.x fallbacks."""

    clean_name = _label(name)
    if not clean_name.startswith("MAT_"):
        clean_name = "MAT_" + clean_name
    existing = bpy.data.materials.get(clean_name)
    if existing is not None:
        return existing
    rgba = tuple(base_color)
    if len(rgba) == 3:
        rgba = (*rgba, 1.0)
    if alpha is not None:
        rgba = (*rgba[:3], float(alpha))
    mat = bpy.data.materials.new(clean_name)
    mat.use_nodes = True
    mat.diffuse_color = rgba
    mat.use_backface_culling = not double_sided
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf is None:
        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    assignments = [
        (("Base Color",), rgba),
        (("Metallic",), float(metallic)),
        (("Roughness",), float(roughness)),
        (("Alpha",), float(rgba[3])),
        (("Transmission Weight", "Transmission"), float(transmission)),
        (("IOR",), float(ior)),
        (("Coat Weight", "Clearcoat"), float(coat)),
    ]
    for names, value in assignments:
        input_socket = _principled_input(bsdf, names)
        if input_socket is not None:
            input_socket.default_value = value
    if emission_color is not None:
        color_socket = _principled_input(bsdf, ("Emission Color", "Emission"))
        strength_socket = _principled_input(bsdf, ("Emission Strength",))
        if color_socket is not None:
            ec = tuple(emission_color)
            color_socket.default_value = (*ec[:3], 1.0)
        if strength_socket is not None:
            strength_socket.default_value = float(emission_strength)
    if rgba[3] < 0.999:
        for mode in ("DITHERED", "BLENDED"):
            try:
                mat.surface_render_method = mode
                break
            except Exception:
                continue
    mat["project_owned"] = True
    mat["style"] = "Pinehollow stylized PBR"
    return mat


def palette_materials() -> dict[str, bpy.types.Material]:
    """Return the shared project-owned Pinehollow material palette."""

    colors = {key: hex_to_linear_rgba(value) for key, value in PALETTE_SRGB_HEX.items()}
    result = {
        "warm_cream": material("PH_WarmCream", colors["warm_cream"], roughness=0.67),
        "deep_green": material("PH_DeepGolfGreen", colors["deep_green"], roughness=0.52),
        "muted_sage": material("PH_MutedSage", colors["muted_sage"], roughness=0.66),
        "medium_walnut": material("PH_MediumWalnut", colors["medium_walnut"], roughness=0.49),
        "natural_oak": material("PH_NaturalOak", colors["natural_oak"], roughness=0.54),
        "warm_charcoal": material("PH_WarmCharcoal", colors["warm_charcoal"], roughness=0.56),
        "restrained_brass": material("PH_RestrainedBrass", colors["restrained_brass"], roughness=0.32, metallic=0.88),
        "brushed_steel": material("PH_BrushedSteel", colors["brushed_steel"], roughness=0.39, metallic=0.82),
        "soft_black": material("PH_SoftBlack", colors["soft_black"], roughness=0.47),
        "rubber": material("PH_Rubber", colors["rubber"], roughness=0.86),
        "paper": material("PH_Paper", colors["paper"], roughness=0.83),
        "safety_red": material("PH_SafetyRed", colors["safety_red"], roughness=0.58),
        "safety_yellow": material("PH_SafetyYellow", colors["safety_yellow"], roughness=0.59),
        "cool_white": material("PH_CoolWhite", colors["cool_white"], roughness=0.64),
        "glass": material("PH_RestrainedGlass", colors["glass_tint"], roughness=0.12, alpha=0.22,
                          transmission=0.80, ior=1.45, double_sided=True),
        "collision": material("PH_CollisionAuthoring", (1.0, 0.0, 1.0, 0.0), roughness=1.0,
                              alpha=0.0, double_sided=True),
    }
    return result


def project_texture_material(
    name: str,
    texture_path: str | Path,
    *,
    roughness: float = 0.55,
    metallic: float = 0.0,
    color_space: str = "sRGB",
) -> bpy.types.Material:
    """Create a packed texture material, refusing files outside the repository.

    This deliberately does not fetch assets.  Callers must use original,
    project-owned artwork already present in the repository.
    """

    path = Path(texture_path)
    path = (REPO_ROOT / path).resolve() if not path.is_absolute() else path.resolve()
    try:
        path.relative_to(REPO_ROOT.resolve())
    except ValueError as exc:
        raise ValueError(f"texture must be project-owned and inside {REPO_ROOT}: {path}") from exc
    if not path.is_file():
        raise FileNotFoundError(path)
    mat = material(name, (1.0, 1.0, 1.0, 1.0), roughness=roughness, metallic=metallic)
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    tex = nodes.get("ProjectOwnedBaseColor") or nodes.new("ShaderNodeTexImage")
    tex.name = "ProjectOwnedBaseColor"
    tex.label = path.name
    image = bpy.data.images.load(str(path), check_existing=True)
    image.colorspace_settings.name = color_space
    image.pack()
    image["project_owned"] = True
    image["source_repo_path"] = path.relative_to(REPO_ROOT).as_posix()
    tex.image = image
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mat["source_repo_path"] = path.relative_to(REPO_ROOT).as_posix()
    return mat


def assign_material(obj: bpy.types.Object, mat: bpy.types.Material | None) -> bpy.types.Object:
    if mat is None or obj.type != "MESH":
        return obj
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


# ---------------------------------------------------------------------------
# Bevel, smooth normals, UV, and geometry helpers


def add_bevel(
    obj: bpy.types.Object,
    width: float,
    *,
    segments: int = 2,
    angle_degrees: float = 38.0,
    apply: bool = True,
) -> bpy.types.Object:
    if obj.type != "MESH" or width <= 0:
        return obj
    modifier = obj.modifiers.new("Bevel_Production", "BEVEL")
    modifier.width = float(width)
    modifier.segments = max(1, int(segments))
    modifier.limit_method = "ANGLE"
    modifier.angle_limit = math.radians(angle_degrees)
    try:
        modifier.harden_normals = True
    except Exception:
        pass
    if apply:
        activate(obj)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj


def smooth_mesh(obj: bpy.types.Object, *, angle_degrees: float = 40.0) -> bpy.types.Object:
    if obj.type != "MESH":
        return obj
    activate(obj)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle_degrees))
        return obj
    except Exception:
        pass
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    try:
        obj.data.set_sharp_from_angle(angle=math.radians(angle_degrees))
    except Exception:
        # Blender versions differ here; bevel geometry still provides readable
        # production highlights, and validation reports any missing normals.
        pass
    obj.data.update()
    return obj


def smart_uv(
    obj: bpy.types.Object,
    *,
    angle_degrees: float = 66.0,
    island_margin: float = 0.025,
) -> bpy.types.Object:
    if obj.type != "MESH" or not obj.data.polygons:
        return obj
    activate(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle_degrees), island_margin=island_margin)
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def cube_uv(obj: bpy.types.Object, *, cube_size: float = 1.0) -> bpy.types.Object:
    if obj.type != "MESH" or not obj.data.polygons:
        return obj
    activate(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        bpy.ops.uv.cube_project(cube_size=max(0.001, float(cube_size)), correct_aspect=True)
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def finish_mesh(
    obj: bpy.types.Object,
    mat: bpy.types.Material | None,
    *,
    bevel: float = 0.0,
    bevel_segments: int = 2,
    uv: str | bool | None = "smart",
    smooth: bool = True,
    smooth_angle: float = 40.0,
    collision: bool = False,
    properties: Mapping[str, Any] | None = None,
) -> bpy.types.Object:
    obj.name = _mesh_name(obj.name, collision=collision)
    apply_transforms(obj, rotation=True, scale=True)
    if bevel > 0 and not collision:
        add_bevel(obj, bevel, segments=bevel_segments, apply=True)
    assign_material(obj, mat)
    if uv == "smart" or uv is True:
        smart_uv(obj)
    elif uv == "cube":
        cube_uv(obj)
    if smooth and not collision:
        smooth_mesh(obj, angle_degrees=smooth_angle)
    for key, value in (properties or {}).items():
        obj[key] = value
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
    mat: bpy.types.Material | None,
    *,
    rotation: Sequence[float] = (0.0, 0.0, 0.0),
    parent: bpy.types.Object | None = None,
    bevel: float = 0.006,
    bevel_segments: int = 2,
    uv: str | bool | None = "cube",
    properties: Mapping[str, Any] | None = None,
) -> bpy.types.Object:
    dimensions = tuple(float(v) for v in dimensions)
    if len(dimensions) != 3 or min(dimensions) <= 0:
        raise ValueError(f"box dimensions must contain three positive values: {dimensions}")
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=tuple(location), rotation=tuple(rotation))
    obj = bpy.context.object
    obj.name = _mesh_name(name)
    obj.dimensions = dimensions
    clamped_bevel = min(float(bevel), min(dimensions) * 0.24) if bevel else 0.0
    finish_mesh(obj, mat, bevel=clamped_bevel, bevel_segments=bevel_segments, uv=uv,
                properties=properties)
    parent_keep_world(obj, parent)
    return obj


def cylinder(
    name: str,
    radius: float,
    depth: float,
    location: Sequence[float],
    mat: bpy.types.Material | None,
    *,
    rotation: Sequence[float] = (0.0, 0.0, 0.0),
    vertices: int = 24,
    parent: bpy.types.Object | None = None,
    bevel: float = 0.002,
    uv: str | bool | None = "smart",
    properties: Mapping[str, Any] | None = None,
) -> bpy.types.Object:
    if radius <= 0 or depth <= 0:
        raise ValueError("cylinder radius/depth must be positive")
    bpy.ops.mesh.primitive_cylinder_add(vertices=max(8, int(vertices)), radius=float(radius), depth=float(depth),
                                        location=tuple(location), rotation=tuple(rotation))
    obj = bpy.context.object
    obj.name = _mesh_name(name)
    finish_mesh(obj, mat, bevel=min(bevel, radius * 0.25, depth * 0.12), uv=uv,
                properties=properties)
    parent_keep_world(obj, parent)
    return obj


def sphere(
    name: str,
    radius: float,
    location: Sequence[float],
    mat: bpy.types.Material | None,
    *,
    segments: int = 24,
    rings: int | None = None,
    parent: bpy.types.Object | None = None,
    properties: Mapping[str, Any] | None = None,
) -> bpy.types.Object:
    if radius <= 0:
        raise ValueError("sphere radius must be positive")
    segments = max(8, int(segments))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=max(6, rings or segments // 2),
                                        radius=float(radius), location=tuple(location))
    obj = bpy.context.object
    obj.name = _mesh_name(name)
    finish_mesh(obj, mat, uv=False, smooth=True, properties=properties)
    parent_keep_world(obj, parent)
    return obj


def torus(
    name: str,
    major_radius: float,
    minor_radius: float,
    location: Sequence[float],
    mat: bpy.types.Material | None,
    *,
    rotation: Sequence[float] = (0.0, 0.0, 0.0),
    major_segments: int = 32,
    minor_segments: int = 12,
    parent: bpy.types.Object | None = None,
    properties: Mapping[str, Any] | None = None,
) -> bpy.types.Object:
    if major_radius <= 0 or minor_radius <= 0 or minor_radius >= major_radius:
        raise ValueError("torus radii must be positive and minor_radius < major_radius")
    bpy.ops.mesh.primitive_torus_add(major_radius=float(major_radius), minor_radius=float(minor_radius),
                                    major_segments=max(8, int(major_segments)),
                                    minor_segments=max(4, int(minor_segments)),
                                    location=tuple(location), rotation=tuple(rotation))
    obj = bpy.context.object
    obj.name = _mesh_name(name)
    finish_mesh(obj, mat, uv=False, smooth=True, properties=properties)
    parent_keep_world(obj, parent)
    return obj


def curve_tube(
    name: str,
    points: Sequence[Sequence[float]],
    radius: float,
    mat: bpy.types.Material | None,
    *,
    parent: bpy.types.Object | None = None,
    cyclic: bool = False,
    resolution: int = 2,
    bevel_resolution: int = 3,
    properties: Mapping[str, Any] | None = None,
) -> bpy.types.Object:
    if len(points) < 2 or radius <= 0:
        raise ValueError("curve_tube requires at least two points and a positive radius")
    data = bpy.data.curves.new(_mesh_name(name) + "_CURVE_DATA", "CURVE")
    data.dimensions = "3D"
    data.resolution_u = max(1, int(resolution))
    data.bevel_depth = float(radius)
    data.bevel_resolution = max(0, int(bevel_resolution))
    data.use_fill_caps = True
    spline = data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for control, point in zip(spline.bezier_points, points):
        control.co = tuple(float(v) for v in point)
        control.handle_left_type = "AUTO"
        control.handle_right_type = "AUTO"
    spline.use_cyclic_u = bool(cyclic)
    obj = bpy.data.objects.new(_mesh_name(name), data)
    bpy.context.collection.objects.link(obj)
    activate(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    finish_mesh(obj, mat, uv="smart", smooth=True, properties=properties)
    parent_keep_world(obj, parent)
    return obj


curve = curve_tube


def profile_prism(
    name: str,
    profile_xz: Sequence[Sequence[float]],
    depth: float,
    location: Sequence[float],
    mat: bpy.types.Material | None,
    *,
    rotation: Sequence[float] = (0.0, 0.0, 0.0),
    parent: bpy.types.Object | None = None,
    bevel: float = 0.003,
    properties: Mapping[str, Any] | None = None,
) -> bpy.types.Object:
    """Extrude a simple ordered X/Z profile through Y by ``depth``."""

    if len(profile_xz) < 3 or depth <= 0:
        raise ValueError("profile_prism requires at least three points and positive depth")
    profile = [(float(p[0]), float(p[1])) for p in profile_xz]
    half = depth / 2.0
    vertices = [(x, -half, z) for x, z in profile] + [(x, half, z) for x, z in profile]
    count = len(profile)
    faces: list[tuple[int, ...]] = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    mesh = bpy.data.meshes.new(_mesh_name(name) + "_DATA")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate(verbose=False)
    mesh.update(calc_edges=True)
    obj = bpy.data.objects.new(_mesh_name(name), mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = tuple(location)
    obj.rotation_euler = tuple(rotation)
    finish_mesh(obj, mat, bevel=bevel, uv="smart", smooth=False, properties=properties)
    parent_keep_world(obj, parent)
    return obj


profile = profile_prism


def text_mesh(
    name: str,
    text: str,
    location: Sequence[float],
    mat: bpy.types.Material | None,
    *,
    size: float = 0.10,
    depth: float = 0.004,
    bevel: float = 0.0008,
    rotation: Sequence[float] = (math.pi / 2.0, 0.0, 0.0),
    align_x: str = "CENTER",
    align_y: str = "CENTER",
    parent: bpy.types.Object | None = None,
    font_path: str | Path | None = None,
    properties: Mapping[str, Any] | None = None,
) -> bpy.types.Object:
    """Create converted geometry text; optional fonts must live in this repo."""

    bpy.ops.object.text_add(location=tuple(location), rotation=tuple(rotation))
    obj = bpy.context.object
    obj.name = _mesh_name(name)
    obj.data.body = str(text)
    obj.data.align_x = align_x
    obj.data.align_y = align_y
    obj.data.size = float(size)
    obj.data.extrude = float(depth)
    obj.data.bevel_depth = float(bevel)
    obj.data.bevel_resolution = 2
    if font_path is not None:
        path = Path(font_path)
        path = (REPO_ROOT / path).resolve() if not path.is_absolute() else path.resolve()
        try:
            path.relative_to(REPO_ROOT.resolve())
        except ValueError as exc:
            raise ValueError("font must be project-owned and inside the repository") from exc
        obj.data.font = bpy.data.fonts.load(str(path), check_existing=True)
    activate(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    finish_mesh(obj, mat, uv="smart", smooth=False, properties=properties)
    parent_keep_world(obj, parent)
    return obj


# ---------------------------------------------------------------------------
# Simplified collision proxies


def collision_box(
    name: str,
    dimensions: Sequence[float],
    location: Sequence[float],
    *,
    parent: bpy.types.Object | None,
    material: bpy.types.Material | None = None,
    rotation: Sequence[float] = (0.0, 0.0, 0.0),
    purpose: str = "blocking",
) -> bpy.types.Object:
    if material is None:
        material = palette_materials()["collision"]
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=tuple(location), rotation=tuple(rotation))
    obj = bpy.context.object
    obj.name = _mesh_name(name, collision=True)
    obj.dimensions = tuple(dimensions)
    finish_mesh(obj, material, uv=False, smooth=False, collision=True,
                properties={"collision_shape": "box", "collision_purpose": purpose})
    parent_keep_world(obj, parent)
    return obj


def collision_cylinder(
    name: str,
    radius: float,
    depth: float,
    location: Sequence[float],
    *,
    parent: bpy.types.Object | None,
    material: bpy.types.Material | None = None,
    rotation: Sequence[float] = (0.0, 0.0, 0.0),
    vertices: int = 12,
    purpose: str = "blocking",
) -> bpy.types.Object:
    if material is None:
        material = palette_materials()["collision"]
    bpy.ops.mesh.primitive_cylinder_add(vertices=max(8, int(vertices)), radius=float(radius), depth=float(depth),
                                        location=tuple(location), rotation=tuple(rotation))
    obj = bpy.context.object
    obj.name = _mesh_name(name, collision=True)
    finish_mesh(obj, material, uv=False, smooth=False, collision=True,
                properties={"collision_shape": "cylinder", "collision_purpose": purpose})
    parent_keep_world(obj, parent)
    return obj


def collision_hull(
    name: str,
    vertices: Sequence[Sequence[float]],
    *,
    parent: bpy.types.Object | None,
    material: bpy.types.Material | None = None,
    location: Sequence[float] = (0.0, 0.0, 0.0),
    purpose: str = "blocking",
) -> bpy.types.Object:
    """Build a convex hull proxy from authored support vertices."""

    if len(vertices) < 4:
        raise ValueError("collision_hull needs at least four support vertices")
    material = material or palette_materials()["collision"]
    mesh = bpy.data.meshes.new(_mesh_name(name, collision=True) + "_DATA")
    mesh.from_pydata([tuple(v) for v in vertices], [], [])
    obj = bpy.data.objects.new(_mesh_name(name, collision=True), mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = tuple(location)
    activate(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.convex_hull()
    bpy.ops.object.mode_set(mode="OBJECT")
    finish_mesh(obj, material, uv=False, smooth=False, collision=True,
                properties={"collision_shape": "convex_hull", "collision_purpose": purpose})
    parent_keep_world(obj, parent)
    return obj


# ---------------------------------------------------------------------------
# Animation helpers


def keyframe_transform(
    obj: bpy.types.Object,
    frame: int,
    *,
    location: Sequence[float] | None = None,
    rotation: Sequence[float] | None = None,
    scale: Sequence[float] | None = None,
) -> None:
    if location is not None:
        obj.location = tuple(location)
        obj.keyframe_insert(data_path="location", frame=int(frame))
    if rotation is not None:
        obj.rotation_euler = tuple(rotation)
        obj.keyframe_insert(data_path="rotation_euler", frame=int(frame))
    if scale is not None:
        obj.scale = tuple(scale)
        obj.keyframe_insert(data_path="scale", frame=int(frame))


def _set_action_interpolation(action: bpy.types.Action, interpolation: str) -> None:
    try:
        for fcurve in action.fcurves:
            for point in fcurve.keyframe_points:
                point.interpolation = interpolation
    except Exception:
        # Blender 5 layered actions do not expose legacy fcurves directly.  The
        # exporter still receives the action and samples its authored values.
        pass


def stash_action(obj: bpy.types.Object, clip_name: str, *, interpolation: str = "BEZIER") -> bpy.types.Action:
    """Name and stash the active action so multiple clips survive GLB export."""

    animation_data = obj.animation_data
    if animation_data is None or animation_data.action is None:
        raise RuntimeError(f"{obj.name} has no active action to stash as {clip_name}")
    action = animation_data.action
    action.name = str(clip_name)
    action.use_fake_user = True
    action["clip_name"] = str(clip_name)
    _set_action_interpolation(action, interpolation)
    track = animation_data.nla_tracks.new()
    track.name = str(clip_name)
    strip = track.strips.new(str(clip_name), int(action.frame_range[0]), action)
    strip.name = str(clip_name)
    track.mute = True
    animation_data.action = None
    return action


def animate_transform_clip(
    obj: bpy.types.Object,
    clip_name: str,
    keyframes: Sequence[Mapping[str, Any]],
    *,
    interpolation: str = "BEZIER",
) -> bpy.types.Action:
    """Author a named transform clip from deterministic keyframe dictionaries."""

    if not keyframes:
        raise ValueError("animation clip needs at least one keyframe")
    if obj.animation_data is not None:
        obj.animation_data.action = None
    for key in sorted(keyframes, key=lambda item: int(item["frame"])):
        keyframe_transform(obj, int(key["frame"]), location=key.get("location"),
                           rotation=key.get("rotation"), scale=key.get("scale"))
    return stash_action(obj, clip_name, interpolation=interpolation)


# ---------------------------------------------------------------------------
# Bounds and source-scene validation


@dataclass(frozen=True)
class Bounds:
    minimum: tuple[float, float, float]
    maximum: tuple[float, float, float]
    size: tuple[float, float, float]
    center: tuple[float, float, float]

    def to_dict(self) -> dict[str, list[float]]:
        return {key: [round(v, 6) for v in value] for key, value in asdict(self).items()}


def world_bounds(root: bpy.types.Object, *, include_collision: bool = False) -> Bounds:
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    found = False
    bpy.context.view_layer.update()
    for obj in descendants(root):
        if obj.type != "MESH" or (obj.get("collision_proxy") and not include_collision):
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
        raise ValueError(f"{root.name} has no visible mesh bounds")
    size = maximum - minimum
    center = (maximum + minimum) * 0.5
    return Bounds(tuple(minimum), tuple(maximum), tuple(size), tuple(center))


@dataclass(frozen=True)
class ValidationIssue:
    severity: str
    code: str
    message: str
    object_name: str | None = None


@dataclass
class ValidationReport:
    asset_root: str
    issues: list[ValidationIssue] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)

    @property
    def errors(self) -> list[ValidationIssue]:
        return [issue for issue in self.issues if issue.severity == "error"]

    @property
    def warnings(self) -> list[ValidationIssue]:
        return [issue for issue in self.issues if issue.severity == "warning"]

    @property
    def ok(self) -> bool:
        return not self.errors

    def add(self, severity: str, code: str, message: str, obj: bpy.types.Object | None = None) -> None:
        self.issues.append(ValidationIssue(severity, code, message, obj.name if obj else None))

    def to_dict(self) -> dict[str, Any]:
        return {
            "assetRoot": self.asset_root,
            "ok": self.ok,
            "errorCount": len(self.errors),
            "warningCount": len(self.warnings),
            "issues": [asdict(issue) for issue in self.issues],
            "stats": self.stats,
        }

    def raise_for_errors(self) -> None:
        if self.errors:
            details = "; ".join(f"{issue.code}: {issue.message}" for issue in self.errors)
            raise RuntimeError(f"asset validation failed for {self.asset_root}: {details}")


def _nearly(value: float, target: float, tolerance: float = 1e-5) -> bool:
    return abs(float(value) - float(target)) <= tolerance


def _mesh_topology_stats(obj: bpy.types.Object) -> tuple[int, int, int]:
    mesh = obj.data
    mesh.calc_loop_triangles()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    boundary = sum(1 for edge in bm.edges if edge.is_boundary)
    non_manifold = sum(1 for edge in bm.edges if not edge.is_manifold)
    zero_area = sum(1 for face in bm.faces if face.calc_area() <= 1e-12)
    bm.free()
    return len(mesh.loop_triangles), boundary, non_manifold + zero_area


def validate_asset_scene(
    root: bpy.types.Object,
    *,
    identity: AssetIdentity | None = None,
    expected_dimensions: Sequence[float] | None = None,
    required_sockets: Sequence[str] = (),
    required_animations: Sequence[str] = (),
    require_collision: bool = True,
    dimension_tolerance: float = 0.08,
) -> ValidationReport:
    """Run structural checks before saving or exporting a production asset."""

    report = ValidationReport(root.name)
    nodes = descendants(root)
    meshes = [obj for obj in nodes if obj.type == "MESH"]
    visible_meshes = [obj for obj in meshes if not obj.get("collision_proxy")]
    collisions = [obj for obj in meshes if obj.get("collision_proxy")]
    markers = [obj for obj in nodes if obj.type == "EMPTY" and obj is not root]
    if identity is not None and root.name != identity.root_name:
        report.add("error", "root-name", f"expected {identity.root_name}, got {root.name}", root)
    if not root.name.startswith("A_") or not root.name.endswith("_ROOT"):
        report.add("error", "root-contract", "asset root must use A_NNN_*_ROOT", root)
    if root.type != "EMPTY":
        report.add("error", "root-type", "asset root must be an empty", root)
    if root.parent is not None:
        report.add("error", "root-parent", "asset root cannot have a parent", root)
    if any(not _nearly(value, 0.0) for value in (*root.location, *root.rotation_euler)):
        report.add("error", "root-transform", "asset root location and rotation must remain at identity", root)
    if any(not _nearly(value, 1.0) for value in root.scale):
        report.add("error", "root-scale", "asset root scale must remain [1, 1, 1]", root)
    if not visible_meshes:
        report.add("error", "visible-mesh", "asset contains no visible mesh", root)
    if require_collision and not collisions:
        report.add("error", "collision-missing", "asset requires at least one COL_ proxy", root)
    for scene_obj in bpy.context.scene.objects:
        if scene_obj.type in {"CAMERA", "LIGHT"}:
            report.add("error", "source-scene-node", "production source scene cannot retain cameras or lights", scene_obj)
    for obj in nodes:
        if obj.type in {"CAMERA", "LIGHT"}:
            report.add("error", "ship-node", "camera/light cannot ship under the asset root", obj)
        if obj is not root and not obj.name.startswith(_VALID_NODE_PREFIXES):
            report.add("error", "node-name", f"node lacks an approved prefix {_VALID_NODE_PREFIXES}", obj)
        if _GENERIC_NAME.fullmatch(obj.name):
            report.add("error", "generic-name", "generic Blender node name cannot ship", obj)
        if obj.type == "MESH":
            is_collision = bool(obj.get("collision_proxy"))
            expected_prefix = "COL_" if is_collision else "MESH_"
            if not obj.name.startswith(expected_prefix):
                report.add("error", "mesh-prefix", f"expected {expected_prefix} name", obj)
            if any(not _nearly(value, 1.0) for value in obj.scale):
                report.add("error", "unapplied-scale", f"scale is {tuple(round(v, 6) for v in obj.scale)}", obj)
            if any(not _nearly(value, 0.0) for value in obj.rotation_euler):
                report.add("error", "unapplied-rotation", "mesh rotation must be applied before export", obj)
            triangles, boundary, invalid = _mesh_topology_stats(obj)
            if invalid:
                severity = "error" if is_collision else "warning"
                report.add(severity, "non-manifold", f"mesh has {invalid} non-manifold/zero-area conditions", obj)
            if is_collision and boundary:
                report.add("error", "open-collision", f"collision proxy has {boundary} boundary edges", obj)
            if not is_collision and not obj.data.uv_layers:
                report.add("error", "uv-missing", "visible mesh has no UV layer", obj)
            if not is_collision and not obj.data.materials:
                report.add("error", "material-missing", "visible mesh has no material", obj)
            for mat in obj.data.materials:
                if mat is None:
                    report.add("error", "material-slot", "empty material slot", obj)
                elif _GENERIC_NAME.fullmatch(mat.name):
                    report.add("error", "material-name", f"generic material name {mat.name}", obj)
    marker_names = {obj.name for obj in markers if obj.name.startswith(("SOCKET_", "PIVOT_"))}
    for name in required_sockets:
        required = str(name)
        if not required.startswith(("SOCKET_", "PIVOT_")):
            required = _marker_name(required, "SOCKET_")
        if required not in marker_names:
            report.add("error", "marker-missing", f"required socket/pivot {required} is absent", root)
    action_names = {action.name for action in bpy.data.actions}
    for name in required_animations:
        if name not in action_names:
            report.add("error", "animation-missing", f"required animation {name} is absent", root)
    for image in bpy.data.images:
        if image.source == "GENERATED" or image.name in {"Render Result", "Viewer Node"}:
            continue
        if image.packed_file is None:
            report.add("error", "texture-not-packed", f"texture {image.name} is not packed", root)
        if image.filepath:
            path = Path(bpy.path.abspath(image.filepath)).resolve()
            try:
                path.relative_to(REPO_ROOT.resolve())
            except ValueError:
                report.add("error", "external-texture", f"texture is outside repository: {path}", root)
    try:
        bounds = world_bounds(root)
        report.stats["boundsMeters"] = bounds.to_dict()
        if expected_dimensions is not None:
            expected = tuple(float(value) for value in expected_dimensions)
            if len(expected) != 3:
                raise ValueError("expected_dimensions must be width, depth, height")
            for axis, actual, target in zip("XYZ", bounds.size, expected):
                allowed = max(0.01, abs(target) * dimension_tolerance)
                if abs(actual - target) > allowed:
                    report.add("warning", "dimensions", f"{axis} size {actual:.4f}m differs from target {target:.4f}m", root)
        if bounds.minimum[2] < -0.01:
            report.add("warning", "below-floor", f"visible geometry reaches z={bounds.minimum[2]:.4f}m", root)
    except ValueError as exc:
        report.add("error", "bounds", str(exc), root)
    triangle_count = 0
    for obj in visible_meshes:
        obj.data.calc_loop_triangles()
        triangle_count += len(obj.data.loop_triangles)
    report.stats.update({
        "nodeCount": len(nodes),
        "visibleMeshCount": len(visible_meshes),
        "collisionMeshCount": len(collisions),
        "socketCount": sum(1 for obj in markers if obj.name.startswith("SOCKET_")),
        "pivotCount": sum(1 for obj in markers if obj.name.startswith("PIVOT_")),
        "materialCount": len({mat.name for obj in visible_meshes for mat in obj.data.materials if mat}),
        "triangleCount": triangle_count,
        "animationNames": sorted(action_names),
    })
    return report


# ---------------------------------------------------------------------------
# Clean source save, explicit canonical/runtime exports, and studio evidence


def _pack_project_images() -> None:
    for image in bpy.data.images:
        if image.source == "FILE" and image.packed_file is None:
            path = Path(bpy.path.abspath(image.filepath)).resolve()
            try:
                path.relative_to(REPO_ROOT.resolve())
            except ValueError as exc:
                raise RuntimeError(f"refusing to pack external image {path}") from exc
            image.pack()


def save_blend(path: Path) -> Path:
    path = Path(path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    _pack_project_images()
    bpy.ops.wm.save_as_mainfile(filepath=str(path), check_existing=False)
    print(f"SOURCE|{path}")
    return path


def _operator_kwargs(operator: Any, kwargs: Mapping[str, Any]) -> dict[str, Any]:
    """Filter exporter options against the active Blender build's RNA."""

    try:
        supported = set(operator.get_rna_type().properties.keys())
        return {key: value for key, value in kwargs.items() if key in supported}
    except Exception:
        return dict(kwargs)


def _select_for_export(root: bpy.types.Object) -> list[bpy.types.Object]:
    selected = descendants(root)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in selected:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    return selected


def export_glb(path: Path, root: bpy.types.Object, *, include_animations: bool = True) -> Path:
    """Run one explicit, atomic GLB export of the asset hierarchy."""

    path = Path(path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    if any(obj.type in {"CAMERA", "LIGHT"} for obj in descendants(root)):
        raise RuntimeError("asset hierarchy contains a camera or light")
    _pack_project_images()
    _select_for_export(root)
    temporary = path.with_name(path.stem + ".exporting.glb")
    if temporary.exists():
        temporary.unlink()
    options = {
        "filepath": str(temporary),
        "export_format": "GLB",
        "use_selection": True,
        "export_apply": False,
        "export_yup": True,
        "export_normals": True,
        "export_tangents": False,
        "export_texcoords": True,
        "export_materials": "EXPORT",
        "export_animations": bool(include_animations),
        "export_animation_mode": "ACTIONS",
        "export_nla_strips": True,
        "export_force_sampling": True,
        "export_extras": True,
        "export_cameras": False,
        "export_lights": False,
        "export_renderable_objects": False,
        "export_unused_images": False,
        "export_unused_textures": False,
        "export_image_format": "AUTO",
        "export_hierarchy_full_collections": False,
    }
    bpy.ops.export_scene.gltf(**_operator_kwargs(bpy.ops.export_scene.gltf, options))
    if not temporary.is_file() or temporary.stat().st_size < 20:
        raise RuntimeError(f"GLB exporter did not create a valid file at {temporary}")
    os.replace(temporary, path)
    print(f"GLB|{path}|bytes={path.stat().st_size}|sha256={sha256_file(path)}")
    return path


def export_canonical_and_runtime(paths: ProductionPaths, root: bpy.types.Object) -> tuple[Path, Path]:
    """Perform two explicit GLB exports; no unproven optimizer is implied."""

    canonical = export_glb(paths.canonical_glb, root)
    runtime = export_glb(paths.runtime_glb, root)
    print(f"EXPORT_PAIR|canonical={canonical}|runtime={runtime}|explicit_runs=2")
    return canonical, runtime


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _link_object_to_collection(obj: bpy.types.Object, collection: bpy.types.Collection) -> None:
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    collection.objects.link(obj)


def render_studio_preview(
    root: bpy.types.Object,
    output_path: Path,
    *,
    width: int = 1200,
    height: int = 900,
    azimuth_degrees: float = 38.0,
    elevation_degrees: float = 24.0,
) -> Path:
    """Render isolated evidence, then remove every temporary camera/light/object."""

    output_path = Path(output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    bounds = world_bounds(root)
    center = Vector(bounds.center)
    extent = max(0.08, max(bounds.size))
    floor_z = bounds.minimum[2]
    scene = bpy.context.scene
    studio = bpy.data.collections.new("__QA_STUDIO__")
    scene.collection.children.link(studio)
    old_world = scene.world
    old_camera = scene.camera
    old_filepath = scene.render.filepath
    old_resolution = (scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage)
    old_engine = scene.render.engine
    old_transparent = scene.render.film_transparent
    old_file_format = scene.render.image_settings.file_format
    collision_visibility = {obj.name: obj.hide_render for obj in descendants(root) if obj.get("collision_proxy")}
    try:
        for obj in descendants(root):
            if obj.get("collision_proxy"):
                obj.hide_render = True
        floor_mat = material("QA_StudioFloor", hex_to_linear_rgba("CEC6B5"), roughness=0.88)
        bpy.ops.mesh.primitive_plane_add(size=max(4.0, extent * 5.0), location=(center.x, center.y, floor_z - 0.002))
        floor = bpy.context.object
        floor.name = "QA_PREVIEW_FLOOR"
        floor.data.materials.append(floor_mat)
        _link_object_to_collection(floor, studio)

        world = bpy.data.worlds.new("QA_PREVIEW_WORLD")
        world.use_nodes = True
        background = world.node_tree.nodes.get("Background")
        background.inputs["Color"].default_value = hex_to_linear_rgba("C8D0C5")
        background.inputs["Strength"].default_value = 0.42
        scene.world = world

        def area_light(name: str, energy: float, size: float, position: Vector) -> bpy.types.Object:
            data = bpy.data.lights.new(name + "_DATA", "AREA")
            data.energy = energy
            data.shape = "DISK"
            data.size = size
            obj = bpy.data.objects.new(name, data)
            studio.objects.link(obj)
            obj.location = position
            obj.rotation_euler = (center - position).to_track_quat("-Z", "Y").to_euler()
            return obj

        area_light("QA_KEY", 320.0 * extent * extent + 80.0, extent * 2.0,
                   center + Vector((-1.4, -1.8, 2.2)) * extent)
        area_light("QA_FILL", 120.0 * extent * extent + 35.0, extent * 2.6,
                   center + Vector((1.8, -0.5, 1.1)) * extent)
        area_light("QA_RIM", 180.0 * extent * extent + 45.0, extent * 1.5,
                   center + Vector((0.7, 1.8, 2.0)) * extent)

        azimuth = math.radians(azimuth_degrees)
        elevation = math.radians(elevation_degrees)
        direction = Vector((math.cos(elevation) * math.sin(azimuth),
                            -math.cos(elevation) * math.cos(azimuth),
                            math.sin(elevation)))
        camera_position = center + direction * (extent * 2.35 + 0.25)
        camera_data = bpy.data.cameras.new("QA_CAMERA_DATA")
        camera_data.lens = 58.0
        camera_data.clip_start = max(0.01, extent / 1000.0)
        camera_data.clip_end = max(100.0, extent * 20.0)
        camera = bpy.data.objects.new("QA_CAMERA", camera_data)
        studio.objects.link(camera)
        camera.location = camera_position
        camera.rotation_euler = (center - camera_position).to_track_quat("-Z", "Y").to_euler()
        scene.camera = camera
        for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
            try:
                scene.render.engine = engine
                break
            except Exception:
                continue
        scene.render.resolution_x = max(320, int(width))
        scene.render.resolution_y = max(240, int(height))
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = str(output_path)
        scene.render.film_transparent = False
        bpy.ops.render.render(write_still=True)
        if not output_path.is_file():
            raise RuntimeError(f"preview render did not create {output_path}")
        print(f"PREVIEW|{output_path}|bytes={output_path.stat().st_size}")
        return output_path
    finally:
        scene.camera = old_camera
        scene.world = old_world
        scene.render.filepath = old_filepath
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = old_resolution
        try:
            scene.render.engine = old_engine
        except Exception:
            pass
        scene.render.film_transparent = old_transparent
        scene.render.image_settings.file_format = old_file_format
        for name, hidden in collision_visibility.items():
            obj = bpy.data.objects.get(name)
            if obj is not None:
                obj.hide_render = hidden
        for obj in list(studio.objects):
            obj_type = obj.type
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if data is not None and getattr(data, "users", 1) == 0:
                collection = {
                    "MESH": bpy.data.meshes,
                    "LIGHT": bpy.data.lights,
                    "CAMERA": bpy.data.cameras,
                }.get(obj_type)
                if collection is not None:
                    collection.remove(data)
        if studio.name in scene.collection.children:
            scene.collection.children.unlink(studio)
        bpy.data.collections.remove(studio)
        preview_world = bpy.data.worlds.get("QA_PREVIEW_WORLD")
        if preview_world is not None and preview_world.users == 0:
            bpy.data.worlds.remove(preview_world)
        preview_material = bpy.data.materials.get("MAT_QA_StudioFloor")
        if preview_material is not None and preview_material.users == 0:
            bpy.data.materials.remove(preview_material)


def publish_asset(
    identity: AssetIdentity,
    root: bpy.types.Object,
    *,
    paths: ProductionPaths | None = None,
    options: BuildOptions | None = None,
    expected_dimensions: Sequence[float] | None = None,
    required_sockets: Sequence[str] = (),
    required_animations: Sequence[str] = (),
    require_collision: bool = True,
) -> PublishResult:
    """Validate, save, export twice, and optionally render QA evidence."""

    paths = paths or production_paths(identity)
    options = options or BuildOptions()
    report = validate_asset_scene(
        root,
        identity=identity,
        expected_dimensions=expected_dimensions,
        required_sockets=required_sockets,
        required_animations=required_animations,
        require_collision=require_collision,
    )
    print("VALIDATION|" + json.dumps(report.to_dict(), sort_keys=True))
    if options.strict:
        report.raise_for_errors()
    paths.create_parents()
    if options.save_source:
        save_blend(paths.source)
    canonical_hash = runtime_hash = None
    if options.export_glbs:
        canonical, runtime = export_canonical_and_runtime(paths, root)
        canonical_hash = sha256_file(canonical)
        runtime_hash = sha256_file(runtime)
    if options.preview:
        render_studio_preview(root, paths.preview, width=options.preview_width,
                              height=options.preview_height,
                              azimuth_degrees=options.preview_azimuth,
                              elevation_degrees=options.preview_elevation)
    return PublishResult(identity, paths, report, canonical_hash, runtime_hash)


def run_asset_cli(
    asset_number: int,
    slug: str,
    build: Callable[[BuildContext], bpy.types.Object],
    *,
    first_person: bool = False,
    expected_dimensions: Sequence[float] | None = None,
    required_sockets: Sequence[str] = (),
    required_animations: Sequence[str] = (),
    require_collision: bool = True,
    argv: Sequence[str] | None = None,
) -> PublishResult:
    """Deterministic one-call entry point for per-sheet builder scripts."""

    options = parse_asset_cli(argv)
    identity = AssetIdentity(asset_number, slug, first_person=first_person)
    paths = production_paths(identity)
    reset_scene(seed=options.seed)
    context = BuildContext(identity, paths, palette_materials(), options)
    root = build(context)
    if root is None:
        raise RuntimeError("asset builder returned no root")
    return publish_asset(
        identity,
        root,
        paths=paths,
        options=options,
        expected_dimensions=expected_dimensions,
        required_sockets=required_sockets,
        required_animations=required_animations,
        require_collision=require_collision,
    )


# ---------------------------------------------------------------------------
# Library CLI: path inspection and a temp-only Blender smoke test


def _smoke_paths(output_root: Path, identity: AssetIdentity) -> ProductionPaths:
    output_root = output_root.resolve()
    return ProductionPaths(
        source=output_root / "source" / f"{identity.stem}.blend",
        canonical_glb=output_root / "canonical" / f"{identity.stem}.glb",
        runtime_glb=output_root / "runtime" / f"{identity.stem}.glb",
        preview=output_root / "qa" / f"{identity.stem}.png",
    )


def smoke_test(output_root: Path) -> PublishResult:
    """Exercise geometry, hierarchy, validation, save, two exports, and render.

    To prevent an accidental production write, ``output_root`` must be outside
    the repository.  The caller owns cleanup of this evidence directory.
    """

    output_root = Path(output_root).resolve()
    try:
        output_root.relative_to(REPO_ROOT.resolve())
    except ValueError:
        pass
    else:
        raise ValueError("smoke output must be outside the repository")
    identity = AssetIdentity(71, "pipeline_smoke")
    paths = _smoke_paths(output_root, identity)
    reset_scene(seed=DEFAULT_SEED)
    mats = palette_materials()
    root = asset_root(identity, (0.40, 0.34, 0.20))
    box("SmokeHousing", (0.40, 0.30, 0.20), (0.0, 0.0, 0.10), mats["deep_green"],
        parent=root, bevel=0.012)
    knob_pivot = pivot("SmokeKnob", parent=root, location=(0.0, -0.15, 0.11))
    cylinder("SmokeKnob", 0.035, 0.04, (0.0, -0.17, 0.11), mats["restrained_brass"],
             rotation=(math.pi / 2.0, 0.0, 0.0), parent=knob_pivot)
    collision_box("SmokeBody", (0.40, 0.30, 0.20), (0.0, 0.0, 0.10),
                  parent=root, material=mats["collision"])
    socket("PLACEMENT", parent=root, location=(0.0, 0.0, 0.0))
    socket("GRIP_R", parent=root, location=(0.0, -0.17, 0.11))
    animate_transform_clip(knob_pivot, "use_loop", [
        {"frame": 1, "rotation": (0.0, 0.0, 0.0)},
        {"frame": 12, "rotation": (0.0, 0.0, math.radians(35.0))},
        {"frame": 24, "rotation": (0.0, 0.0, 0.0)},
    ])
    result = publish_asset(
        identity,
        root,
        paths=paths,
        options=BuildOptions(preview=True, preview_width=640, preview_height=480),
        expected_dimensions=(0.40, 0.34, 0.20),
        required_sockets=("PLACEMENT", "GRIP_R", "PIVOT_SmokeKnob"),
        required_animations=("use_loop",),
        require_collision=True,
    )
    print("SMOKE_OK|" + json.dumps({
        "paths": paths.as_relative_dict(output_root),
        "canonicalSha256": result.canonical_sha256,
        "runtimeSha256": result.runtime_sha256,
        "byteEquivalent": result.canonical_sha256 == result.runtime_sha256,
    }, sort_keys=True))
    return result


def _module_main() -> int:
    parser = argparse.ArgumentParser(description="Assets 51-100 Blender production helper")
    subparsers = parser.add_subparsers(dest="command", required=True)
    path_parser = subparsers.add_parser("paths", help="print exact planned paths")
    path_parser.add_argument("asset_number", type=int)
    path_parser.add_argument("slug")
    path_parser.add_argument("--first-person", action="store_true")
    smoke_parser = subparsers.add_parser("smoke", help="run temp-only Blender pipeline smoke test")
    smoke_parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args(blender_cli_args())
    if args.command == "paths":
        identity = AssetIdentity(args.asset_number, args.slug, args.first_person)
        print(json.dumps(production_paths(identity).as_relative_dict(), indent=2, sort_keys=True))
        return 0
    if args.command == "smoke":
        smoke_test(args.output_root)
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(_module_main())
