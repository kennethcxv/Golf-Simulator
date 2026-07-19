"""Build Asset Sheet 05 reference 48: Pinehollow golf-club delivery carton.

Run from the repository root with Blender 5.1:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
      --background --factory-startup --python tools/blender/build_delivery_club_box.py

The user-provided reference defines the recognizable long, slim kraft carton,
green end bands, handling marks, and exact 1.25 x 0.18 x 0.18 metre bounds.
All production geometry is original, deterministic, and authored by this
in-repository script. No external meshes, textures, fonts, or generated assets
are downloaded or embedded.

Blender uses Z-up. The glTF exporter converts the source to a Y-up runtime scene,
so the numeric target remains 1.25 m long, 0.18 m high, and 0.18 m deep in game.
"""

from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector


SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[2]
sys.path.insert(0, str(SCRIPT.parent))

from build_checkout_assets import (  # noqa: E402
    anchor,
    box,
    collision_box,
    descendants,
    empty,
    mat,
    parent_keep,
    reset_scene,
)


ASSET_ID = "delivery_golf_club_box"
BUILD_VERSION = 4
REFERENCE_ID = "48"
TARGET_DIMS = (1.25, 0.18, 0.18)  # Blender X length, Y depth, Z height.
REFERENCE_PATH = (
    "Designs/RefrenceImages/41-50_refrence_images/"
    "ChatGPT Image Jul 17, 2026, 11_45_44 AM.png"
)

SOURCE_DIR = ROOT / "asset_sources" / "blender" / "delivery"
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
QA_ROOT = ROOT / "qa" / "box_system_master" / "blender" / "club_box_ref48"
QA_PASS = os.environ.get("DELIVERY_CLUB_QA_PASS", "").strip()
QA_DIR = QA_ROOT / QA_PASS if QA_PASS else QA_ROOT
SOURCE_PATH = SOURCE_DIR / f"{ASSET_ID}.blend"
EXPORT_PATH = EXPORT_DIR / f"{ASSET_ID}.glb"
METRICS_PATH = QA_DIR / f"{ASSET_ID}_metrics.json"
REPORT_PATH = QA_DIR / f"{ASSET_ID}_build_report.json"

for directory in (SOURCE_DIR, EXPORT_DIR, QA_DIR):
    directory.mkdir(parents=True, exist_ok=True)


REQUIRED = {
    ASSET_ID,
    "BOX_BASE",
    "BOX_WALL_FRONT", "BOX_WALL_BACK", "BOX_WALL_LEFT", "BOX_WALL_RIGHT",
    "BOX_FRONT", "BOX_BACK", "BOX_LEFT", "BOX_RIGHT",
    "BOX_FLAP_FRONT", "BOX_FLAP_BACK", "BOX_FLAP_LEFT", "BOX_FLAP_RIGHT",
    "FLAP_TOP_FRONT", "FLAP_TOP_BACK", "FLAP_TOP_LEFT", "FLAP_TOP_RIGHT",
    "TAPE_CENTER", *{f"TAPE_CENTER_SEG_{index:02d}" for index in range(1, 13)},
    "TAPE_END_LEFT", "TAPE_END_RIGHT",
    "LABEL_MAIN", "LABEL_SHIPPING", "LABEL_DYNAMIC",
    "INSERT_BOTTOM", "INSERT_SIDE_FRONT", "INSERT_SIDE_BACK",
    "END_PADDING_LEFT", "END_PADDING_RIGHT",
    "SHAFT_SUPPORT_01", "SHAFT_SUPPORT_02",
    "HEAD_SUPPORT_01", "HEAD_SUPPORT_02",
    "CONTENT_SLOT_01", "CONTENT_SLOT_02",
    "CONTENT_LAYOUT_CLUB2", "CONTENT_SLOT_CLUB2_01", "CONTENT_SLOT_CLUB2_02",
    "COLLISION_CLOSED", "COLLISION_OPEN",
    "INTERACTION_TARGET", "CUT_PATH", "VOLUME_CONTENTS",
    "BOX_FLAT_BUNDLE",
    "FLAT_PANEL_BASE", "FLAT_PANEL_FRONT", "FLAT_PANEL_BACK",
    "FLAT_PANEL_LEFT", "FLAT_PANEL_RIGHT", "FLAT_LABEL",
}

MATERIAL_NAMES = {
    "M_Kraft", "M_KraftDark", "M_DeepGreen", "M_Brass", "M_Label", "M_tape",
}


def setup_scene() -> None:
    reset_scene()
    scene = bpy.context.scene
    scene["asset_build_script"] = SCRIPT.relative_to(ROOT).as_posix()
    scene["asset_build_version"] = BUILD_VERSION
    scene["units"] = "meters"
    scene["reference_id"] = REFERENCE_ID
    scene["reference_path"] = REFERENCE_PATH


def production_materials() -> dict[str, bpy.types.Material]:
    """Small, cohesive Pinehollow PBR kit; no raster textures are required."""
    return {
        "kraft": mat("M_Kraft", (0.30, 0.14, 0.055, 1.0), roughness=0.88),
        "kraft_dark": mat("M_KraftDark", (0.105, 0.045, 0.018, 1.0), roughness=0.93),
        "green": mat("M_DeepGreen", (0.008, 0.055, 0.018, 1.0), roughness=0.58),
        "brass": mat("M_Brass", (0.56, 0.39, 0.13, 1.0), roughness=0.36, metallic=0.72),
        "label": mat("M_Label", (0.64, 0.48, 0.25, 1.0), roughness=0.91),
        "tape": mat("M_tape", (0.71, 0.48, 0.19, 0.88), roughness=0.62),
        "collision": mat("M_Collision", (1.0, 0.0, 1.0, 0.0), roughness=1.0),
    }


def root_object() -> bpy.types.Object:
    source = (
        "User-provided Asset Sheet 05 - Delivery & Stocking (41-50), reference 48; "
        "original geometry authored in-repository"
    )
    license_text = (
        "User-provided design reference; original project-owned derivative geometry; "
        "no external assets"
    )
    root = empty(
        ASSET_ID,
        props={
            "asset_id": ASSET_ID,
            "asset_version": BUILD_VERSION,
            "version": BUILD_VERSION,
            "units": "meters",
            "reference_id": REFERENCE_ID,
            "reference_path": REFERENCE_PATH,
            "source": source,
            "license": license_text,
            "target_dimensions_m": list(TARGET_DIMS),
            "front": "-Y label/player side",
            "box_profile": "long_golf_club",
            "carry_profile": "long_two_hand",
            "content_capacity": 2,
            "physical_shell_id": ASSET_ID,
            "packaging_shell_id": "LONG_CLUB_CARTON",
            "content_layouts": json.dumps(["CLUB2"]),
            "default_content_layout": "CLUB2",
            "content_scale": 1.0,
            "allow_scale": False,
            "builder": SCRIPT.relative_to(ROOT).as_posix(),
        },
        size=0.055,
    )
    return root


def helper(obj: bpy.types.Object, kind: str) -> bpy.types.Object:
    obj["helper"] = True
    obj["helper_kind"] = kind
    obj.hide_render = True
    return obj


def front_quad(
    name: str,
    width: float,
    height: float,
    loc,
    material: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    """Create a -Y-facing, explicitly UV-mapped label plane."""
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    verts = [
        (-width / 2, 0, -height / 2),
        (width / 2, 0, -height / 2),
        (width / 2, 0, height / 2),
        (-width / 2, 0, height / 2),
    ]
    mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
    mesh.materials.append(material)
    uv_layer = mesh.uv_layers.new(name="UVMap")
    uvs = ((0, 0), (1, 0), (1, 1), (0, 1))
    for loop in mesh.loops:
        uv_layer.data[loop.index].uv = uvs[loop.vertex_index]
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    parent_keep(obj, parent)
    return obj


PIXEL_FONT = {
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "B": ("11110", "10001", "10001", "11110", "10001", "10001", "11110"),
    "C": ("01111", "10000", "10000", "10000", "10000", "10000", "01111"),
    "D": ("11110", "10001", "10001", "10001", "10001", "10001", "11110"),
    "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "F": ("11111", "10000", "10000", "11110", "10000", "10000", "10000"),
    "G": ("01111", "10000", "10000", "10111", "10001", "10001", "01111"),
    "H": ("10001", "10001", "10001", "11111", "10001", "10001", "10001"),
    "I": ("11111", "00100", "00100", "00100", "00100", "00100", "11111"),
    "L": ("10000", "10000", "10000", "10000", "10000", "10000", "11111"),
    "N": ("10001", "11001", "11001", "10101", "10011", "10011", "10001"),
    "O": ("01110", "10001", "10001", "10001", "10001", "10001", "01110"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "S": ("01111", "10000", "10000", "01110", "00001", "00001", "11110"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
    "U": ("10001", "10001", "10001", "10001", "10001", "10001", "01110"),
    "W": ("10001", "10001", "10001", "10101", "10101", "11011", "10001"),
    " ": ("00000",) * 7,
}


def pixel_text_mesh(
    name: str,
    text: str,
    loc,
    material: bpy.types.Material,
    *,
    cell: float,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    """Low-poly, readable 5x7 shipping print on a single front-facing mesh."""
    glyphs = [PIXEL_FONT[character] for character in text]
    columns = len(glyphs) * 6 - 1
    width = columns * cell
    height = 7 * cell
    verts = []
    faces = []
    for glyph_index, glyph in enumerate(glyphs):
        for row, pattern in enumerate(glyph):
            for column, filled in enumerate(pattern):
                if filled != "1":
                    continue
                x0 = -width / 2 + (glyph_index * 6 + column) * cell
                x1 = x0 + cell * 0.78
                z1 = height / 2 - row * cell
                z0 = z1 - cell * 0.78
                start = len(verts)
                verts.extend(((x0, 0, z0), (x1, 0, z0), (x1, 0, z1), (x0, 0, z1)))
                faces.append((start, start + 1, start + 2, start + 3))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(material)
    uv_layer = mesh.uv_layers.new(name="UVMap")
    uvs = ((0, 0), (1, 0), (1, 1), (0, 1))
    for loop in mesh.loops:
        uv_layer.data[loop.index].uv = uvs[loop.vertex_index % 4]
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    parent_keep(obj, parent)
    return obj


def wall(
    root: bpy.types.Object,
    M: dict[str, bpy.types.Material],
    pivot_name: str,
    panel_name: str,
    pivot_loc,
    panel_dims,
    panel_loc,
    inner_name: str,
    inner_dims,
    inner_loc,
    material_key: str = "kraft",
) -> bpy.types.Object:
    pivot = empty(
        pivot_name,
        pivot_loc,
        parent=root,
        size=0.027,
        props={
            "pivot_kind": "bottom_fold",
            "closed_rotation": [0.0, 0.0, 0.0],
            "flatten_angle_deg": 90.0,
            "hinge_axis": "X" if pivot_name == "BOX_WALL_FRONT" else "",
            "open_reveal_angle_deg": 82.0 if pivot_name == "BOX_WALL_FRONT" else 0.0,
            "reveal_contents": pivot_name == "BOX_WALL_FRONT",
        },
    )
    box(panel_name, panel_dims, panel_loc, M[material_key], bevel=0.0022, parent=pivot)
    box(inner_name, inner_dims, inner_loc, M["kraft_dark"], bevel=0.0010, parent=pivot)
    return pivot


def flap(
    wall_pivot: bpy.types.Object,
    M: dict[str, bpy.types.Material],
    pivot_name: str,
    panel_name: str,
    pivot_loc,
    panel_dims,
    panel_loc,
    axis: str,
    sign: int,
) -> bpy.types.Object:
    pivot = empty(
        pivot_name,
        pivot_loc,
        parent=wall_pivot,
        size=0.025,
        props={
            "pivot_kind": "top_fold",
            "hinge_axis": axis,
            "open_sign": sign,
            "open_angle_deg": 112.0,
            "closed_rotation": [0.0, 0.0, 0.0],
        },
    )
    box(panel_name, panel_dims, panel_loc, M["kraft"], bevel=0.0015, parent=pivot)
    # Dark inner laminate and a thin score line communicate double-wall stock.
    inner_dims = (panel_dims[0] * 0.985, panel_dims[1] * 0.985, 0.0015)
    box(
        f"{panel_name}_INNER",
        inner_dims,
        (panel_loc[0], panel_loc[1], panel_loc[2] - 0.0021),
        M["kraft_dark"],
        bevel=0.0004,
        parent=pivot,
    )
    return pivot


def add_front_mark(
    name: str,
    dims,
    loc,
    material: bpy.types.Material,
    parent: bpy.types.Object,
    rot_y: float = 0.0,
) -> bpy.types.Object:
    return box(name, dims, loc, material, rot=(0, rot_y, 0), bevel=0.0, parent=parent)


def merge_mesh_objects(objects: list[bpy.types.Object], name: str) -> bpy.types.Object:
    """Bake related low-poly decal strokes into one draw/node without flattening pivots."""
    live = [obj for obj in objects if obj and obj.name in bpy.data.objects]
    if not live:
        raise RuntimeError(f"cannot merge empty object set for {name}")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in live:
        obj.select_set(True)
    active = live[0]
    bpy.context.view_layer.objects.active = active
    bpy.ops.object.join()
    active.name = name
    return active


def build_crest(front_wall: bpy.types.Object, M: dict[str, bpy.types.Material]) -> None:
    """Original crossed-club shield assembled from restrained line geometry."""
    y = -0.08955
    front_quad("CREST_FIELD", 0.092, 0.103, (-0.492, y + 0.00015, 0.097), M["label"], front_wall)
    marks = [
        add_front_mark("CREST_TOP", (0.054, 0.0007, 0.004), (-0.492, y, 0.130), M["green"], front_wall),
        add_front_mark("CREST_LEFT", (0.004, 0.0007, 0.052), (-0.518, y, 0.105), M["green"], front_wall, -0.18),
        add_front_mark("CREST_RIGHT", (0.004, 0.0007, 0.052), (-0.466, y, 0.105), M["green"], front_wall, 0.18),
        add_front_mark("CREST_POINT_L", (0.004, 0.0007, 0.038), (-0.507, y, 0.073), M["green"], front_wall, -0.74),
        add_front_mark("CREST_POINT_R", (0.004, 0.0007, 0.038), (-0.477, y, 0.073), M["green"], front_wall, 0.74),
        add_front_mark("CREST_CLUB_A", (0.004, 0.00065, 0.060), (-0.492, y - 0.00005, 0.103), M["green"], front_wall, 0.72),
        add_front_mark("CREST_CLUB_B", (0.004, 0.00065, 0.060), (-0.492, y - 0.00005, 0.103), M["green"], front_wall, -0.72),
        add_front_mark("CREST_HEAD_A", (0.018, 0.0007, 0.006), (-0.472, y - 0.00005, 0.124), M["brass"], front_wall, -0.18),
        add_front_mark("CREST_HEAD_B", (0.018, 0.0007, 0.006), (-0.512, y - 0.00005, 0.124), M["brass"], front_wall, 0.18),
    ]
    merge_mesh_objects(marks, "CREST_MARKS")


def build_handling_icons(front_wall: bpy.types.Object, M: dict[str, bpy.types.Material]) -> None:
    """Three clear line pictograms: fragile, keep dry, and this side up."""
    y = -0.08956
    xs = (0.315, 0.390, 0.465)
    for index, x in enumerate(xs, start=1):
        front_quad(f"ICON_FIELD_{index:02d}", 0.060, 0.070, (x, y + 0.00016, 0.067), M["label"], front_wall)

    # Fragile goblet.
    marks = []
    x = xs[0]
    marks.extend([
        add_front_mark("ICON_FRAGILE_BOWL", (0.034, 0.0007, 0.005), (x, y, 0.082), M["green"], front_wall),
        add_front_mark("ICON_FRAGILE_LEFT", (0.004, 0.0007, 0.025), (x - 0.013, y, 0.073), M["green"], front_wall, -0.28),
        add_front_mark("ICON_FRAGILE_RIGHT", (0.004, 0.0007, 0.025), (x + 0.013, y, 0.073), M["green"], front_wall, 0.28),
        add_front_mark("ICON_FRAGILE_STEM", (0.004, 0.0007, 0.022), (x, y, 0.051), M["green"], front_wall),
        add_front_mark("ICON_FRAGILE_FOOT", (0.029, 0.0007, 0.004), (x, y, 0.039), M["green"], front_wall),
    ])

    # Keep-dry umbrella canopy and handle.
    x = xs[1]
    marks.extend([
        add_front_mark("ICON_DRY_CANOPY_L", (0.004, 0.0007, 0.035), (x - 0.013, y, 0.078), M["green"], front_wall, -0.92),
        add_front_mark("ICON_DRY_CANOPY_R", (0.004, 0.0007, 0.035), (x + 0.013, y, 0.078), M["green"], front_wall, 0.92),
        add_front_mark("ICON_DRY_SHAFT", (0.004, 0.0007, 0.043), (x, y, 0.059), M["green"], front_wall),
        add_front_mark("ICON_DRY_HANDLE", (0.018, 0.0007, 0.004), (x + 0.007, y, 0.037), M["green"], front_wall),
    ])

    # This-side-up twin arrows.
    x = xs[2]
    for suffix, dx in (("L", -0.012), ("R", 0.012)):
        marks.extend([
            add_front_mark(f"ICON_UP_SHAFT_{suffix}", (0.004, 0.0007, 0.039), (x + dx, y, 0.058), M["green"], front_wall),
            add_front_mark(f"ICON_UP_HEAD_A_{suffix}", (0.004, 0.0007, 0.022), (x + dx - 0.007, y, 0.080), M["green"], front_wall, -0.70),
            add_front_mark(f"ICON_UP_HEAD_B_{suffix}", (0.004, 0.0007, 0.022), (x + dx + 0.007, y, 0.080), M["green"], front_wall, 0.70),
        ])
    merge_mesh_objects(marks, "HANDLING_ICON_MARKS")


def build_box(M: dict[str, bpy.types.Material]) -> bpy.types.Object:
    length, depth, height = TARGET_DIMS
    base_t = 0.012
    wall_t = 0.012
    wall_top = 0.174
    root = root_object()

    # Reinforced base, recessed inside the exact exterior envelope.
    box(
        "BOX_BASE",
        (length - 2 * wall_t, depth - 2 * wall_t, base_t),
        (0, 0, base_t / 2),
        M["kraft_dark"],
        bevel=0.0018,
        parent=root,
        props={"construction": "double_wall_corrugated", "wall_thickness_m": wall_t},
    )
    box("BASE_LINER", (length - 0.050, depth - 0.034, 0.004), (0, 0, 0.015), M["kraft"], bevel=0.0008, parent=root)
    for x in (-0.565, -0.280, 0.005, 0.290, 0.565):
        box(f"BASE_REINFORCEMENT_{x:+.3f}", (0.020, depth - 0.040, 0.011), (x, 0, 0.020), M["kraft_dark"], bevel=0.0012, parent=root)

    # Outer long walls are recessed 1 mm so the branded green edge bands own
    # the exact +/-0.09 m depth bounds without coplanar shimmer.
    front_wall = wall(
        root, M,
        "BOX_WALL_FRONT", "BOX_FRONT",
        (0, -depth / 2, base_t),
        (length - 2 * wall_t, wall_t, wall_top - base_t),
        (0, -depth / 2 + wall_t / 2 + 0.001, (base_t + wall_top) / 2),
        "BOX_FRONT_INNER",
        (length - 0.050, 0.0025, wall_top - base_t - 0.020),
        (0, -depth / 2 + wall_t + 0.002, (base_t + wall_top) / 2),
    )
    back_wall = wall(
        root, M,
        "BOX_WALL_BACK", "BOX_BACK",
        (0, depth / 2, base_t),
        (length - 2 * wall_t, wall_t, wall_top - base_t),
        (0, depth / 2 - wall_t / 2 - 0.001, (base_t + wall_top) / 2),
        "BOX_BACK_INNER",
        (length - 0.050, 0.0025, wall_top - base_t - 0.020),
        (0, depth / 2 - wall_t - 0.002, (base_t + wall_top) / 2),
    )
    left_wall = wall(
        root, M,
        "BOX_WALL_LEFT", "BOX_LEFT",
        (-length / 2, 0, base_t),
        (wall_t, depth - 2 * wall_t, wall_top - base_t),
        (-length / 2 + wall_t / 2, 0, (base_t + wall_top) / 2),
        "BOX_LEFT_INNER",
        (0.0025, depth - 0.046, wall_top - base_t - 0.020),
        (-length / 2 + wall_t + 0.002, 0, (base_t + wall_top) / 2),
        material_key="green",
    )
    right_wall = wall(
        root, M,
        "BOX_WALL_RIGHT", "BOX_RIGHT",
        (length / 2, 0, base_t),
        (wall_t, depth - 2 * wall_t, wall_top - base_t),
        (length / 2 - wall_t / 2, 0, (base_t + wall_top) / 2),
        "BOX_RIGHT_INNER",
        (0.0025, depth - 0.046, wall_top - base_t - 0.020),
        (length / 2 - wall_t - 0.002, 0, (base_t + wall_top) / 2),
        material_key="green",
    )

    # True four-flap closure. Each mesh is a direct child of its physical hinge.
    flap_t = 0.006
    front_flap = flap(
        front_wall, M,
        "BOX_FLAP_FRONT", "FLAP_TOP_FRONT",
        (0, -depth / 2, wall_top),
        (length - 2 * wall_t, depth / 2 - 0.006, flap_t),
        (0, -depth / 4 - 0.003, wall_top + flap_t / 2),
        "X", 1,
    )
    back_flap = flap(
        back_wall, M,
        "BOX_FLAP_BACK", "FLAP_TOP_BACK",
        (0, depth / 2, wall_top),
        (length - 2 * wall_t, depth / 2 - 0.006, flap_t),
        (0, depth / 4 + 0.003, wall_top + flap_t / 2),
        "X", -1,
    )
    left_flap = flap(
        left_wall, M,
        "BOX_FLAP_LEFT", "FLAP_TOP_LEFT",
        (-length / 2, 0, wall_top),
        (length * 0.075, depth - 2 * wall_t, flap_t),
        (-length / 2 + length * 0.0375, 0, wall_top + flap_t / 2 - 0.0005),
        "Y", -1,
    )
    right_flap = flap(
        right_wall, M,
        "BOX_FLAP_RIGHT", "FLAP_TOP_RIGHT",
        (length / 2, 0, wall_top),
        (length * 0.075, depth - 2 * wall_t, flap_t),
        (length / 2 - length * 0.0375, 0, wall_top + flap_t / 2 - 0.0005),
        "Y", 1,
    )

    # Deep-green wrap bands at both ends. Side faces are the green end walls;
    # these front/back/top pieces continue the band around the carton.
    band_w = 0.102
    for suffix, x in (("LEFT", -0.548), ("RIGHT", 0.548)):
        box(f"BAND_FRONT_{suffix}", (band_w, 0.002, 0.158), (x, -depth / 2 + 0.001, 0.093), M["green"], bevel=0.001, parent=front_wall)
        box(f"BAND_BACK_{suffix}", (band_w, 0.002, 0.158), (x, depth / 2 - 0.001, 0.093), M["green"], bevel=0.001, parent=back_wall)
        box(f"BAND_TOP_FRONT_{suffix}", (band_w, depth * 0.41, 0.0016), (x, -depth * 0.245, 0.1789), M["green"], bevel=0.0004, parent=front_flap)
        box(f"BAND_TOP_BACK_{suffix}", (band_w, depth * 0.41, 0.0016), (x, depth * 0.245, 0.1789), M["green"], bevel=0.0004, parent=back_flap)

    # Twelve-piece centre tape provides deterministic cut progression, followed
    # by reinforced end strips. Everything stays within the exact 0.18 m height.
    tape_root = empty(
        "TAPE_CENTER", (0, 0, 0), parent=root, size=0.022,
        props={"tape_path": "left_to_right_then_ends", "segment_count": 14},
    )
    usable = length - 0.075
    step = usable / 12
    for index in range(12):
        x = -usable / 2 + (index + 0.5) * step
        segment = box(
            f"TAPE_CENTER_SEG_{index + 1:02d}",
            (step - 0.003, 0.031, 0.002),
            (x, 0, 0.179),
            M["tape"],
            bevel=0.0,
            parent=tape_root,
            props={"cut_order": index + 1},
        )
        segment["tape_segment"] = True
    for name, x, order in (
        ("TAPE_END_RIGHT", length * 0.455, 13),
        ("TAPE_END_LEFT", -length * 0.455, 14),
    ):
        box(
            name, (0.040, depth - 0.014, 0.002), (x, 0, 0.179), M["tape"],
            bevel=0.0, parent=tape_root,
            props={"cut_order": order, "tape_segment": True, "end_strip": True},
        )

    # Player-facing identity. LABEL_DYNAMIC is an explicit UV surface that the
    # runtime can replace without rebuilding the carton hierarchy.
    front_quad("LABEL_MAIN", 0.405, 0.080, (-0.105, -0.08930, 0.098), M["label"], front_wall)
    front_quad("LABEL_SHIPPING", 0.205, 0.074, (0.195, -0.08936, 0.110), M["label"], front_wall)
    front_quad("LABEL_DYNAMIC", 0.197, 0.066, (0.195, -0.08948, 0.110), M["label"], front_wall)
    box("LABEL_SHIPPING_HEADER", (0.197, 0.00055, 0.014), (0.195, -0.08963, 0.133), M["green"], bevel=0.0, parent=front_wall)
    for index, z in enumerate((0.118, 0.108, 0.098, 0.088), start=1):
        width = (0.140, 0.168, 0.125, 0.154)[index - 1]
        box(f"LABEL_SHIPPING_LINE_{index:02d}", (width, 0.0005, 0.003), (0.185, -0.08964, z), M["kraft_dark"], bevel=0.0, parent=front_wall)

    pixel_text_mesh(
        "GOLF_CLUBS_TEXT", "GOLF CLUBS",
        (-0.105, -0.08936, 0.107), M["green"],
        cell=0.0064, parent=front_wall,
    )
    pixel_text_mesh(
        "HANDLE_WITH_CARE_TEXT", "HANDLE WITH CARE",
        (-0.105, -0.08940, 0.073), M["green"],
        cell=0.00345, parent=front_wall,
    )
    build_crest(front_wall, M)
    build_handling_icons(front_wall, M)

    # Interior: double-wall liner, snug end padding, two shaft bridges, and two
    # denser head cradles. These remain plainly visible in the open preview.
    box("INSERT_BOTTOM", (length - 0.070, depth - 0.052, 0.010), (0, 0, 0.030), M["label"], bevel=0.0025, parent=root)
    box("INSERT_SIDE_FRONT", (length - 0.090, 0.020, 0.055), (0, -0.060, 0.058), M["kraft_dark"], bevel=0.004, parent=root)
    box("INSERT_SIDE_BACK", (length - 0.090, 0.020, 0.055), (0, 0.060, 0.058), M["kraft_dark"], bevel=0.004, parent=root)
    box("END_PADDING_LEFT", (0.075, depth - 0.052, 0.100), (-0.548, 0, 0.080), M["label"], bevel=0.009, parent=root, props={"padding": "molded_paper"})
    box("END_PADDING_RIGHT", (0.075, depth - 0.052, 0.100), (0.548, 0, 0.080), M["label"], bevel=0.009, parent=root, props={"padding": "molded_paper"})

    for index, x in enumerate((-0.285, 0.130), start=1):
        support = box(
            f"SHAFT_SUPPORT_{index:02d}",
            (0.042, depth - 0.058, 0.054),
            (x, 0, 0.061),
            M["label"],
            bevel=0.007,
            parent=root,
            props={"support_kind": "shaft_bridge", "slot_count": 2},
        )
        for row, y in enumerate((-0.031, 0.031), start=1):
            box(
                f"SHAFT_SUPPORT_{index:02d}_RAIL_{row:02d}",
                (0.054, 0.014, 0.022),
                (x, y, 0.090),
                M["kraft_dark"],
                bevel=0.003,
                parent=support,
            )

    for index, (x, y) in enumerate(((-0.415, -0.034), (0.415, 0.034)), start=1):
        support = box(
            f"HEAD_SUPPORT_{index:02d}",
            (0.155, 0.048, 0.025),
            (x, y, 0.043),
            M["label"],
            bevel=0.006,
            parent=root,
            props={"support_kind": "opposed_club_head_cradle", "row": index},
        )
        backstop_x = x + (-0.071 if x < 0 else 0.071)
        box(
            f"HEAD_SUPPORT_{index:02d}_BACKSTOP",
            (0.045, 0.052, 0.055),
            (backstop_x, y, 0.062),
            M["kraft_dark"],
            bevel=0.005,
            parent=support,
        )

    # Corrugated edge cues along the long inner lips. They are structural scale,
    # not micro-detail, and alternate kraft tones to read under warm lighting.
    for side, y in (("FRONT", -0.073), ("BACK", 0.073)):
        for index, x in enumerate((-0.47, -0.35, -0.23, -0.11, 0.01, 0.13, 0.25, 0.37), start=1):
            box(
                f"CORRUGATION_{side}_{index:02d}",
                (0.055, 0.003, 0.006),
                (x, y, 0.168),
                M["kraft_dark" if index % 2 else "kraft"],
                bevel=0.0,
                parent=root,
            )

    socket_props = (
        {"slot_index": 1, "stack_order": 1, "visibility_threshold": 0.01, "removal_order": 2},
        {"slot_index": 2, "stack_order": 2, "visibility_threshold": 0.51, "removal_order": 1},
    )
    for index, (y, z, props) in enumerate(((-0.026, 0.087, socket_props[0]), (0.026, 0.104, socket_props[1])), start=1):
        anchor(
            f"CONTENT_SLOT_{index:02d}",
            (-0.020, y, z),
            parent=root,
            kind="box_content",
            props={
                **props,
                "allowed_category": "clubs",
                "max_w": 1.18,
                "max_d": 0.080,
                "max_h": 0.082,
            },
        )

    # Contract-authoritative CLUB2 sockets. Two complete, full-scale retail
    # clubs stack vertically inside the 180 mm shell. A restrained two-degree
    # opposing splay keeps both shafts readable from above while the protected
    # heads still occupy opposite end cradles and the 130 mm fit envelope.
    # Legacy CONTENT_SLOT_01/02 remain for old saves.
    layout_id = "CLUB2"
    allowed_skus = ("driver1", "driver2", "driver3", "putter1", "putter2", "wedge1", "wedge2")
    packaging_state = "head-and-shaft-guarded"
    layout_root = empty(
        f"CONTENT_LAYOUT_{layout_id}",
        parent=root,
        size=0.040,
        props={
            "layout_id": layout_id,
            "capacity": 2,
            "allowed_category": "clubs",
            "catalog_category": "clubs",
            "allowed_skus": json.dumps(allowed_skus),
            "packaging_state": packaging_state,
            "physical_shell_id": ASSET_ID,
            "packaging_shell_id": "LONG_CLUB_CARTON",
            "socket_prefix": f"CONTENT_SLOT_{layout_id}_",
            "selection_rule": "exact_sku_category_quantity_dimensions_packaging_state",
            "packed_orientation": "lengthwise-heads-opposed",
            "content_scale": 1.0,
            "allow_scale": False,
        },
    )
    splay = math.radians(2.0)
    for index, (y, z, rotation_z) in enumerate((
        (-0.0125, 0.065, -splay),
        (0.0125, 0.115, math.pi + splay),
    ), start=1):
        socket = anchor(
            f"CONTENT_SLOT_{layout_id}_{index:02d}",
            (0.0, y, z),
            rot=(0.0, 0.0, rotation_z),
            parent=layout_root,
            kind="box_content",
            props={
                "layout_id": layout_id,
                "slot_index": index,
                "allowed_category": "clubs",
                "catalog_category": "clubs",
                "allowed_skus": json.dumps(allowed_skus),
                "packaging_state": packaging_state,
                "packaging_shell_id": "LONG_CLUB_CARTON",
                "max_w": 1.19,
                "max_d": 0.105,
                "max_h": 0.09,
                "display_state": "opened_lengthwise",
                "stack_order": index,
                "stack_column": 1,
                "stack_layer": index,
                "visibility_threshold": 0.01 if index == 1 else 0.51,
                "visible_when_remaining_at_least": 3 - index,
                "removal_order": 3 - index,
                "removal_policy": "highest_removal_order_first",
                "content_scale": 1.0,
                "allow_scale": False,
            },
        )
        socket["authored_rotation_rad"] = json.dumps([0.0, 0.0, round(rotation_z, 6)])

    # Compact authored flattened variant. Required children are direct so the
    # runtime can switch the whole bundle without resolving nested decoration.
    flat = empty(
        "BOX_FLAT_BUNDLE", (0, 0, 0), parent=root, size=0.030,
        props={"runtime_variant": "flattened", "thickness_m": 0.030},
    )
    box("FLAT_PANEL_BASE", (length - 0.018, depth - 0.022, 0.007), (0, 0, 0.006), M["kraft_dark"], bevel=0.002, parent=flat)
    box("FLAT_PANEL_FRONT", (length - 0.040, depth * 0.64, 0.005), (0, -0.016, 0.012), M["kraft"], bevel=0.0015, parent=flat)
    box("FLAT_PANEL_BACK", (length - 0.055, depth * 0.58, 0.005), (0, 0.020, 0.017), M["kraft"], bevel=0.0015, parent=flat)
    box("FLAT_PANEL_LEFT", (length * 0.31, depth - 0.040, 0.004), (-0.365, 0.004, 0.022), M["green"], bevel=0.0012, parent=flat)
    box("FLAT_PANEL_RIGHT", (length * 0.31, depth - 0.040, 0.004), (0.365, -0.004, 0.026), M["green"], bevel=0.0012, parent=flat)
    box("FLAT_LABEL", (0.270, 0.078, 0.002), (-0.060, -0.010, 0.029), M["label"], bevel=0.0005, parent=flat)

    helper(collision_box("COLLISION_CLOSED", TARGET_DIMS, (0, 0, height / 2), M, parent=root), "closed_collision")
    helper(collision_box("COLLISION_OPEN", (length, depth, 0.145), (0, 0, 0.0725), M, parent=root), "open_collision")
    helper(collision_box("VOLUME_CONTENTS", (1.185, 0.128, 0.105), (-0.012, 0, 0.083), M, parent=root), "contents_volume")
    anchor("INTERACTION_TARGET", (0, -0.135, 0.120), parent=root, kind="box_interaction")
    anchor(
        "CUT_PATH", (0, 0, height), parent=root, kind="cut_path",
        props={
            "points": json.dumps([
                [-0.588, 0.0, 0.180], [0.588, 0.0, 0.180],
                [0.568, -0.078, 0.180], [0.568, 0.078, 0.180],
                [-0.568, 0.078, 0.180], [-0.568, -0.078, 0.180],
            ]),
            "duration_sec": 2.7,
            "segment_count": 14,
            "segment_nodes": json.dumps([
                *[f"TAPE_CENTER_SEG_{index:02d}" for index in range(1, 13)],
                "TAPE_END_RIGHT", "TAPE_END_LEFT",
            ]),
        },
    )

    # Keep any beveled/text decoration inside the authoritative envelope while
    # the structural walls, band faces, base, and tape own the exact extrema.
    clamp_visible_meshes(root)
    return root


def is_helper_mesh(obj: bpy.types.Object) -> bool:
    return bool(
        obj.get("helper")
        or obj.name.startswith("COLLISION_")
        or obj.name.startswith("VOLUME_")
    )


def object_world_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    lo = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    hi = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    return lo, hi


def clamp_visible_meshes(root: bpy.types.Object) -> None:
    """Translate only tiny overhangs caused by text/bevel into the exact box bounds."""
    half_x = TARGET_DIMS[0] / 2
    half_y = TARGET_DIMS[1] / 2
    low = (-half_x, -half_y, 0.0)
    high = (half_x, half_y, TARGET_DIMS[2])
    bpy.context.view_layer.update()
    for obj in descendants(root):
        if obj.type != "MESH" or is_helper_mesh(obj):
            continue
        lo, hi = object_world_bounds(obj)
        shift = Vector((0.0, 0.0, 0.0))
        for axis in range(3):
            if lo[axis] < low[axis] - 1e-7:
                shift[axis] += low[axis] - lo[axis]
            if hi[axis] + shift[axis] > high[axis] + 1e-7:
                shift[axis] += high[axis] - (hi[axis] + shift[axis])
        if shift.length_squared > 0:
            world = obj.matrix_world.copy()
            world.translation += shift
            obj.matrix_world = world
            bpy.context.view_layer.update()


def visible_bounds(root: bpy.types.Object) -> tuple[Vector, Vector]:
    points: list[Vector] = []
    bpy.context.view_layer.update()
    for obj in descendants(root):
        if obj.type != "MESH" or is_helper_mesh(obj):
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points:
        return Vector(), Vector()
    return (
        Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points))),
        Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points))),
    )


def material_and_texture_stats(objects: list[bpy.types.Object]) -> tuple[list[str], list[str]]:
    material_names: set[str] = set()
    image_names: set[str] = set()
    for obj in objects:
        if obj.type != "MESH":
            continue
        for slot in obj.material_slots:
            material = slot.material
            if not material:
                continue
            material_names.add(material.name)
            if material.use_nodes and material.node_tree:
                for node in material.node_tree.nodes:
                    if node.type == "TEX_IMAGE" and node.image:
                        image_names.add(node.image.name)
    return sorted(material_names), sorted(image_names)


def hierarchy_checks(root: bpy.types.Object) -> dict:
    checks = {}
    for pivot_name, panel_name in (
        ("BOX_WALL_FRONT", "BOX_FRONT"),
        ("BOX_WALL_BACK", "BOX_BACK"),
        ("BOX_WALL_LEFT", "BOX_LEFT"),
        ("BOX_WALL_RIGHT", "BOX_RIGHT"),
        ("BOX_FLAP_FRONT", "FLAP_TOP_FRONT"),
        ("BOX_FLAP_BACK", "FLAP_TOP_BACK"),
        ("BOX_FLAP_LEFT", "FLAP_TOP_LEFT"),
        ("BOX_FLAP_RIGHT", "FLAP_TOP_RIGHT"),
    ):
        pivot = bpy.data.objects.get(pivot_name)
        panel = bpy.data.objects.get(panel_name)
        checks[f"{pivot_name}_directly_parents_{panel_name}"] = bool(pivot and panel and panel.parent == pivot)
    flat = bpy.data.objects.get("BOX_FLAT_BUNDLE")
    for child_name in (
        "FLAT_PANEL_BASE", "FLAT_PANEL_FRONT", "FLAT_PANEL_BACK",
        "FLAT_PANEL_LEFT", "FLAT_PANEL_RIGHT", "FLAT_LABEL",
    ):
        child = bpy.data.objects.get(child_name)
        checks[f"BOX_FLAT_BUNDLE_directly_parents_{child_name}"] = bool(flat and child and child.parent == flat)
    return checks


def asset_metrics(root: bpy.types.Object) -> dict:
    nodes = descendants(root)
    meshes = [obj for obj in nodes if obj.type == "MESH"]
    triangle_rows = [
        {
            "object": obj.name,
            "triangles": sum(max(1, len(polygon.vertices) - 2) for polygon in obj.data.polygons),
        }
        for obj in meshes
    ]
    triangles = sum(row["triangles"] for row in triangle_rows)
    materials_used, textures_used = material_and_texture_stats(nodes)
    lo, hi = visible_bounds(root)
    dims = hi - lo
    bad_transforms = []
    for obj in meshes:
        if any(abs(value - 1.0) > 1e-5 for value in obj.scale):
            bad_transforms.append({"object": obj.name, "scale": [round(v, 8) for v in obj.scale]})
        if any(abs(value) > 1e-5 for value in obj.rotation_euler):
            bad_transforms.append({"object": obj.name, "rotation": [round(v, 8) for v in obj.rotation_euler]})
    return {
        "asset_id": ASSET_ID,
        "asset_version": BUILD_VERSION,
        "reference_id": REFERENCE_ID,
        "reference_path": REFERENCE_PATH,
        "source_license": "User-provided reference; original project-owned geometry; no external assets",
        "target_dimensions_m": list(TARGET_DIMS),
        "visible_bounds_min": [round(v, 6) for v in lo],
        "visible_bounds_max": [round(v, 6) for v in hi],
        "visible_dimensions_m": [round(v, 6) for v in dims],
        "nodes": len(nodes),
        "meshes": len(meshes),
        "triangles": triangles,
        "top_triangle_meshes": sorted(
            triangle_rows, key=lambda row: row["triangles"], reverse=True,
        )[:12],
        "materials": materials_used,
        "material_count": len(materials_used),
        "textures": textures_used,
        "texture_count": len(textures_used),
        "animations": len(bpy.data.actions),
        "cameras": sum(1 for obj in bpy.context.scene.objects if obj.type == "CAMERA"),
        "lights": sum(1 for obj in bpy.context.scene.objects if obj.type == "LIGHT"),
        "helper_meshes": sum(1 for obj in meshes if is_helper_mesh(obj)),
        "content_sockets": [obj.name for obj in nodes if obj.name.startswith("CONTENT_SLOT_")],
        "hierarchy_checks": hierarchy_checks(root),
        "bad_mesh_transforms": bad_transforms,
    }


def validate(root: bpy.types.Object, *, imported: bool = False) -> dict:
    nodes = descendants(root)
    by_name = {obj.name: obj for obj in nodes}
    names = set(by_name)
    missing = sorted(REQUIRED - names)
    if missing:
        raise RuntimeError(f"{ASSET_ID} missing required nodes: {missing}")
    if root.name != ASSET_ID:
        raise RuntimeError(f"root name changed: {root.name}")

    required_materials_missing = sorted(MATERIAL_NAMES - set(bpy.data.materials.keys()))
    if required_materials_missing:
        raise RuntimeError(f"missing material conventions: {required_materials_missing}")

    metrics = asset_metrics(root)
    if metrics["visible_dimensions_m"] != list(TARGET_DIMS):
        raise RuntimeError(
            f"visible dimensions must be exact {TARGET_DIMS}, got {metrics['visible_dimensions_m']}"
        )
    if not all(metrics["hierarchy_checks"].values()):
        failed = [key for key, value in metrics["hierarchy_checks"].items() if not value]
        raise RuntimeError(f"hierarchy validation failed: {failed}")
    if metrics["bad_mesh_transforms"]:
        raise RuntimeError(f"unapplied mesh transforms: {metrics['bad_mesh_transforms']}")
    if metrics["cameras"] or metrics["lights"]:
        raise RuntimeError("production asset scene contains a camera or light")
    if metrics["texture_count"] != 0:
        raise RuntimeError(f"unexpected external texture/image dependency: {metrics['textures']}")
    if metrics["triangles"] > 12000:
        raise RuntimeError(
            f"triangle budget exceeded: {metrics['triangles']} > 12000; "
            f"top meshes={metrics['top_triangle_meshes']}"
        )
    if not 50 <= metrics["nodes"] <= 120:
        raise RuntimeError(f"node budget must remain 50..120, got {metrics['nodes']}")

    root_props = root.keys()
    for key in ("asset_id", "asset_version", "units", "reference_id", "source", "license", "target_dimensions_m"):
        if key not in root_props:
            raise RuntimeError(f"root missing metadata extra: {key}")
    if str(root["reference_id"]) != REFERENCE_ID:
        raise RuntimeError(f"reference_id changed: {root['reference_id']}")

    for index in (1, 2):
        socket = by_name.get(f"CONTENT_SLOT_{index:02d}")
        for key in ("allowed_category", "max_w", "max_d", "max_h", "stack_order", "visibility_threshold", "removal_order"):
            if socket is None or key not in socket.keys():
                raise RuntimeError(f"CONTENT_SLOT_{index:02d} missing {key}")
        if socket["allowed_category"] != "clubs":
            raise RuntimeError(f"CONTENT_SLOT_{index:02d} category changed")

    layout = by_name["CONTENT_LAYOUT_CLUB2"]
    expected_skus = ("driver1", "driver2", "driver3", "putter1", "putter2", "wedge1", "wedge2")
    if layout.parent is not root or int(layout.get("capacity", -1)) != 2:
        raise RuntimeError("CLUB2 layout hierarchy or capacity changed")
    if layout.get("packaging_shell_id") != "LONG_CLUB_CARTON":
        raise RuntimeError("CLUB2 packaging shell contract changed")
    if tuple(json.loads(layout.get("allowed_skus", "[]"))) != expected_skus:
        raise RuntimeError("CLUB2 allowed SKU contract changed")
    for index in (1, 2):
        socket = by_name[f"CONTENT_SLOT_CLUB2_{index:02d}"]
        if socket.parent is not layout:
            raise RuntimeError(f"{socket.name} must be directly under CONTENT_LAYOUT_CLUB2")
        for key in (
            "layout_id", "slot_index", "allowed_category", "catalog_category", "allowed_skus",
            "packaging_state", "packaging_shell_id", "max_w", "max_d", "max_h", "display_state",
            "stack_order", "stack_column", "stack_layer", "visibility_threshold",
            "removal_order", "content_scale", "allow_scale", "authored_rotation_rad",
        ):
            if key not in socket:
                raise RuntimeError(f"{socket.name} missing {key}")
        exported = tuple(round(float(socket[key]), 6) for key in ("max_w", "max_d", "max_h"))
        if exported != (1.19, 0.105, 0.09):
            raise RuntimeError(f"{socket.name} CLUB2 envelope changed: {exported}")
        if socket["packaging_shell_id"] != "LONG_CLUB_CARTON":
            raise RuntimeError(f"{socket.name} packaging shell contract changed")
        if float(socket["content_scale"]) != 1.0 or bool(socket["allow_scale"]):
            raise RuntimeError(f"{socket.name} must remain authored at 1:1 scale")
    expected_rotations = ([0.0, 0.0, -0.034907], [0.0, 0.0, 3.176499])
    for index, expected in enumerate(expected_rotations, start=1):
        actual = json.loads(by_name[f"CONTENT_SLOT_CLUB2_{index:02d}"]["authored_rotation_rad"])
        if actual != expected:
            raise RuntimeError(f"CLUB2 socket {index} opposing-splay rotation changed: {actual}")

    metrics["validation"] = "clean_reimport_ok" if imported else "source_ok"
    return metrics


def add_build_info() -> None:
    text = bpy.data.texts.new("BUILD_INFO.txt")
    text.write(
        "Pinehollow Golf delivery asset\n"
        f"asset_id: {ASSET_ID}\n"
        f"build_version: {BUILD_VERSION}\n"
        f"reference_id: {REFERENCE_ID}\n"
        f"reference_path: {REFERENCE_PATH}\n"
        f"builder: {SCRIPT.relative_to(ROOT).as_posix()}\n"
        "units: metres\n"
        "source: user-provided Asset Sheet 05 reference 48; original in-repository geometry\n"
        "license: user-provided design reference; project-owned derivative; no external assets\n"
        "content layout: CLUB2; authored content scale: 1.0; opposing protected heads; shrink fallback: forbidden\n"
    )


def save_and_export(root: bpy.types.Object) -> dict:
    metrics = validate(root)
    add_build_info()
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_PATH), check_existing=False)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in descendants(root):
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(EXPORT_PATH),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_animations=False,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )
    metrics.update({
        "source": str(SOURCE_PATH),
        "export": str(EXPORT_PATH),
        "export_bytes": EXPORT_PATH.stat().st_size,
    })
    return metrics


def look_at(obj: bpy.types.Object, target) -> None:
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def preview_visibility(root: bpy.types.Object, *, opened: bool) -> list[tuple[bpy.types.Object, bool]]:
    changed = []
    for obj in descendants(root):
        if is_helper_mesh(obj) or obj.name.startswith("BOX_FLAT_BUNDLE") or obj.parent and obj.parent.name == "BOX_FLAT_BUNDLE":
            changed.append((obj, obj.hide_render))
            obj.hide_render = True
        if opened and (obj.name.startswith("TAPE_") or obj.name.startswith("BAND_TOP_")):
            changed.append((obj, obj.hide_render))
            obj.hide_render = True
    return changed


def render_preview(
    root: bpy.types.Object,
    filename: str,
    camera_location,
    camera_target,
    *,
    opened: bool = False,
) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world = scene.world or bpy.data.worlds.new("QA_World")
    scene.world.color = (0.025, 0.036, 0.030)
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    scene.view_settings.exposure = -1.1

    rotations = []
    if opened:
        poses = {
            "BOX_FLAP_FRONT": (math.radians(-112), 0, 0),
            "BOX_FLAP_BACK": (math.radians(112), 0, 0),
            "BOX_FLAP_LEFT": (0, math.radians(112), 0),
            "BOX_FLAP_RIGHT": (0, math.radians(-112), 0),
        }
        for name, rotation in poses.items():
            pivot = bpy.data.objects.get(name)
            if pivot:
                rotations.append((pivot, pivot.rotation_euler.copy()))
                pivot.rotation_euler = rotation
        front_wall = bpy.data.objects.get("BOX_WALL_FRONT")
        if front_wall:
            rotations.append((front_wall, front_wall.rotation_euler.copy()))
            front_wall.rotation_euler.x = math.radians(82)
    changed_visibility = preview_visibility(root, opened=opened)
    bpy.context.view_layer.update()

    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.object
    camera.name = "QA_Camera"
    camera.data.lens = 58 if not opened else 54
    look_at(camera, camera_target)
    scene.camera = camera

    for name, energy, location, size in (
        ("QA_Key", 180, (-0.7, -0.75, 1.05), 1.5),
        ("QA_Fill", 85, (0.9, -0.25, 0.72), 1.1),
        ("QA_Rim", 125, (0.25, 0.75, 0.90), 1.0),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size
        look_at(light, (0, 0, 0.08))

    floor_mat = mat("QA_FloorMaterial", (0.095, 0.125, 0.105, 1.0), roughness=0.95)
    floor = box("QA_Floor", (3.4, 2.4, 0.025), (0, 0, -0.017), floor_mat, bevel=0.004)
    floor.hide_render = False
    scene.render.filepath = str(QA_DIR / filename)
    bpy.ops.render.render(write_still=True)

    for pivot, rotation in rotations:
        pivot.rotation_euler = rotation
    for obj, state in changed_visibility:
        obj.hide_render = state
    for obj in [item for item in list(bpy.data.objects) if item.name.startswith("QA_")]:
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.view_layer.update()


def clean_reimport() -> tuple[bpy.types.Object, dict]:
    setup_scene()
    bpy.ops.import_scene.gltf(filepath=str(EXPORT_PATH))
    roots = [obj for obj in bpy.context.scene.objects if obj.name == ASSET_ID]
    if len(roots) != 1:
        raise RuntimeError(f"clean reimport expected one {ASSET_ID} root, found {len(roots)}")
    root = roots[0]
    metrics = validate(root, imported=True)
    metrics["source"] = str(SOURCE_PATH)
    metrics["export"] = str(EXPORT_PATH)
    metrics["export_bytes"] = EXPORT_PATH.stat().st_size
    return root, metrics


def main() -> None:
    setup_scene()
    M = production_materials()
    root = build_box(M)
    source_metrics = save_and_export(root)

    render_preview(
        root,
        f"{ASSET_ID}_sealed_three_quarter.png",
        (1.18, -1.28, 0.58),
        (0, 0, 0.082),
    )
    render_preview(
        root,
        f"{ASSET_ID}_open_interior.png",
        (0.88, -1.12, 1.48),
        (0.02, 0, 0.045),
        opened=True,
    )

    imported_root, imported_metrics = clean_reimport()
    render_preview(
        imported_root,
        f"{ASSET_ID}_clean_reimport.png",
        (-1.10, -1.22, 0.54),
        (0, 0, 0.082),
    )

    report = {
        "asset_id": ASSET_ID,
        "reference_id": REFERENCE_ID,
        "source_validation": source_metrics,
        "clean_reimport_validation": imported_metrics,
        "previews": [
            str(QA_DIR / f"{ASSET_ID}_sealed_three_quarter.png"),
            str(QA_DIR / f"{ASSET_ID}_open_interior.png"),
            str(QA_DIR / f"{ASSET_ID}_clean_reimport.png"),
        ],
    }
    METRICS_PATH.write_text(json.dumps(imported_metrics, indent=2), encoding="utf8")
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf8")
    print(
        "BUILT|"
        f"asset={ASSET_ID}|nodes={imported_metrics['nodes']}|meshes={imported_metrics['meshes']}|"
        f"tris={imported_metrics['triangles']}|materials={imported_metrics['material_count']}|"
        f"textures={imported_metrics['texture_count']}|dims={imported_metrics['visible_dimensions_m']}|"
        f"bytes={imported_metrics['export_bytes']}|reimport={imported_metrics['validation']}"
    )


if __name__ == "__main__":
    main()
