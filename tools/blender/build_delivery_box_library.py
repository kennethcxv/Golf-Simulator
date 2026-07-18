"""Build Pinehollow's exact-dimension production delivery-box library.

Run from the repository root with Blender 5.1:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
      --background --factory-startup \
      --python tools/blender/build_delivery_box_library.py

The builder is deterministic and profile driven.  Every physical shell is a
separate .blend and GLB; layouts are authored transform sockets, never scaled
fallback geometry.  All geometry is original project-owned work created from
the local Asset Sheet 05 reference and the live packaging dimensions in
``src/data/boxes.js``.  No raw or third-party asset is opened or modified.

Optional environment variables:

``DELIVERY_BOX_LIBRARY_TARGET``
    Build one asset id instead of the complete library.
``DELIVERY_BOX_LIBRARY_QA_PASS``
    Name the ignored preview/report pass (default ``pass-01``).
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
    activate,
    anchor,
    box,
    collision_box,
    descendants,
    empty,
    finish_mesh,
    mat,
    materials,
    parent_keep,
    reset_scene,
)


SOURCE_DIR = ROOT / "asset_sources" / "blender" / "delivery"
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
QA_PASS = os.environ.get("DELIVERY_BOX_LIBRARY_QA_PASS", "pass-01")
QA_DIR = ROOT / "qa" / "box_system_master" / "packaging_library" / QA_PASS
REFERENCE_PATH = (
    ROOT
    / "Designs"
    / "RefrenceImages"
    / "41-50_refrence_images"
    / "ChatGPT Image Jul 17, 2026, 11_45_44 AM.png"
)

for directory in (SOURCE_DIR, EXPORT_DIR, QA_DIR):
    directory.mkdir(parents=True, exist_ok=True)

BUILD_VERSION = 1


def slot(
    position,
    *,
    max_dims,
    layer,
    column,
    rotation=(0.0, 0.0, 0.0),
    display="opened_face_out",
):
    """Return one data-only socket definition in Blender X/Y/Z order."""
    return {
        "position": tuple(position),
        "rotation": tuple(rotation),
        "max_dims": tuple(max_dims),
        "layer": int(layer),
        "column": int(column),
        "display": display,
    }


def grid_slots(xs, ys, zs, max_dims, *, upright=False):
    """Stable X-major, depth-next, layer-last authored grid."""
    result = []
    column = 0
    for y in ys:
        for x in xs:
            column += 1
            for layer, z in enumerate(zs, start=1):
                result.append(
                    slot(
                        (x, y, z),
                        max_dims=max_dims,
                        layer=layer,
                        column=column,
                        rotation=(0.0, 0.0, 0.0),
                        display="opened_upright" if upright else "opened_face_out",
                    )
                )
    return result


def layout(layout_id, category, skus, packed_state, slots):
    return {
        "id": layout_id,
        "category": category,
        "skus": tuple(skus),
        "packed_state": packed_state,
        "slots": tuple(slots),
    }


# Dimensions use Blender authoring order: width X, depth Y, height Z.  Runtime
# glTF bounds are therefore width X, height Y, depth Z after the Y-up export.
# The first six shells exactly mirror src/data/boxes.js.  The provisions and
# long-product exceptions are purpose-built dimensions from the packing audit.
PROFILES = {
    "delivery_accessory_carton": {
        "box_kind": "carton",
        "dims": (0.42, 0.36, 0.30),
        "label": "ACCESSORIES",
        "carry": "small_two_hand",
        "style": "kraft",
        "fragile": False,
        "layouts": (
            layout(
                "ACCESSORY_CARD12",
                "accessories",
                ("tees1", "towel1", "marker1"),
                "retail_card_or_small_carton",
                # Required 2 x 3 x 2 grid.
                grid_slots(
                    (-0.1025, 0.1025),
                    (-0.105, 0.0, 0.105),
                    (0.075, 0.205),
                    (0.205, 0.080, 0.130),
                ),
            ),
            layout(
                "GLOVE8",
                "apparel:glove",
                ("glove1",),
                "flat_retail_sleeve",
                # Distinct flat 2 x 1 x 4 stack; it shares only the shell.
                grid_slots(
                    (-0.090, 0.090),
                    (0.0,),
                    (0.045, 0.092, 0.139, 0.186),
                    (0.180, 0.230, 0.040),
                ),
            ),
            layout(
                "RANGE4",
                "accessories:rangefinder",
                ("range2",),
                "protective_retail_case",
                # Fragile optics: four cases in an exact 2 x 1 x 2 layout.
                grid_slots(
                    (-0.0975, 0.0975),
                    (0.0,),
                    (0.065, 0.175),
                    (0.195, 0.150, 0.110),
                ),
            ),
        ),
    },
    "delivery_golf_ball_case": {
        "box_kind": "ballcase",
        "dims": (0.52, 0.42, 0.34),
        "label": "GOLF BALLS",
        "carry": "heavy_two_hand",
        "style": "kraft",
        "fragile": False,
        "layouts": (
            layout(
                "BALL12",
                "balls",
                ("balls1", "balls2", "balls3"),
                "retail_dozen_carton",
                # Audit-authoritative 3 x 2 x 2 coordinates.
                grid_slots(
                    (-0.160, 0.0, 0.160),
                    (-0.075, 0.075),
                    (0.045, 0.125),
                    (0.160, 0.130, 0.075),
                ),
            ),
        ),
    },
    "delivery_shoe_carton": {
        "box_kind": "shoebox",
        "dims": (0.58, 0.44, 0.32),
        "label": "FOOTWEAR",
        "carry": "medium_two_hand",
        "style": "cream_green",
        "fragile": False,
        "layouts": (
            layout(
                "SHOE4",
                "apparel:shoes",
                ("shoe1",),
                "retail_shoe_box",
                grid_slots(
                    (-0.142, 0.142),
                    (0.0,),
                    (0.082, 0.218),
                    (0.250, 0.330, 0.140),
                ),
            ),
        ),
    },
    "delivery_golf_bag_carton": {
        "box_kind": "bagcarton",
        "dims": (0.72, 0.52, 1.05),
        "label": "GOLF BAG",
        "carry": "bulky_low",
        "style": "cream_green",
        "fragile": False,
        "layouts": (
            layout(
                "BAG1",
                "accessories:golf_bag",
                ("bag1",),
                "protective_bag_with_foam_blocks",
                (
                    slot(
                        (0.0, 0.0, 0.535),
                        max_dims=(0.670, 0.450, 0.980),
                        layer=1,
                        column=1,
                        display="opened_vertical",
                    ),
                ),
            ),
        ),
    },
    "delivery_fixture_package": {
        "box_kind": "fixture",
        "dims": (0.62, 0.40, 0.55),
        "label": "COURSECARE",
        "carry": "large_low",
        "style": "sage_green",
        "fragile": True,
        "layouts": (
            layout(
                "FIXTURE1",
                "supplies:fixture",
                ("vac1", "light1", "board1", "poster1", "plant1"),
                "foam_blocked_fixture",
                (
                    slot(
                        (0.0, 0.0, 0.286),
                        max_dims=(0.590, 0.370, 0.500),
                        layer=1,
                        column=1,
                        display="opened_protected",
                    ),
                ),
            ),
        ),
    },
    "delivery_furniture_crate": {
        "box_kind": "crate",
        "dims": (1.25, 0.85, 0.98),
        "label": "FURNITURE",
        "carry": "freight_assisted",
        "style": "timber_reinforced",
        "fragile": True,
        "layouts": (
            layout(
                "FURNITURE1",
                "decor:furniture",
                ("rug1", "lounge1"),
                "flat_pack_timber_reinforced",
                (
                    slot(
                        (0.0, 0.0, 0.505),
                        max_dims=(1.190, 0.790, 0.900),
                        layer=1,
                        column=1,
                        display="opened_freight",
                    ),
                ),
            ),
        ),
    },
    "delivery_bulk_provisions_carton": {
        "box_kind": "provisions",
        "dims": (0.50, 0.38, 0.30),
        "label": "PROVISIONS",
        "carry": "heavy_two_hand",
        "style": "sage_green",
        "fragile": False,
        "layouts": (
            layout(
                "DRINK12",
                "provisions:drink",
                ("water1",),
                "sealed_bottle_case",
                # Required upright 4 x 3 single layer.
                grid_slots(
                    (-0.165, -0.055, 0.055, 0.165),
                    (-0.100, 0.0, 0.100),
                    (0.145,),
                    (0.075, 0.075, 0.230),
                    upright=True,
                ),
            ),
            layout(
                "SNACK12",
                "provisions:snack",
                ("snack1",),
                "sealed_snack_multipack",
                # Twelve face-out bags in a 3 x 4 presentation tray.
                grid_slots(
                    (-0.160, 0.0, 0.160),
                    (-0.125, -0.042, 0.042, 0.125),
                    (0.135,),
                    (0.160, 0.075, 0.200),
                    upright=True,
                ),
            ),
        ),
    },
    "delivery_umbrella_carton": {
        "box_kind": "umbrella",
        "dims": (0.92, 0.38, 0.28),
        "label": "UMBRELLAS",
        "carry": "long_two_hand",
        "style": "kraft",
        "fragile": False,
        "layouts": (
            layout(
                "UMBRELLA6",
                "accessories:umbrella",
                ("umb1",),
                "sleeved_long_product",
                tuple(
                    slot(
                        (0.0, y, z),
                        max_dims=(0.870, 0.112, 0.120),
                        layer=layer,
                        column=column,
                        rotation=(0.0, 0.0, math.pi if (column + layer) % 2 else 0.0),
                        display="opened_long_face_out",
                    )
                    for column, y in enumerate((-0.112, 0.0, 0.112), start=1)
                    for layer, z in enumerate((0.065, 0.180), start=1)
                ),
            ),
        ),
    },
    "delivery_iron_set_carton": {
        "box_kind": "ironset",
        "dims": (1.12, 0.24, 0.24),
        "label": "IRON SET",
        "carry": "long_two_hand",
        "style": "cream_green",
        "fragile": True,
        "layouts": (
            layout(
                "IRONSET1",
                "clubs:iron_set",
                ("irons1", "irons2"),
                "bundled_set_with_head_and_shaft_supports",
                (
                    slot(
                        (0.0, 0.0, 0.126),
                        max_dims=(1.070, 0.190, 0.190),
                        layer=1,
                        column=1,
                        display="opened_long_face_out",
                    ),
                ),
            ),
        ),
    },
}


def delivery_materials():
    """Exporter-safe stylized Pinehollow packaging palette."""
    M = materials()
    colors = {
        "kraft": (0.46, 0.275, 0.115, 1.0),
        "green": (0.012, 0.095, 0.040, 1.0),
        "sage": (0.105, 0.245, 0.135, 1.0),
        "cream": (0.855, 0.800, 0.660, 1.0),
        "paper": (0.705, 0.535, 0.315, 1.0),
        "oak": (0.435, 0.255, 0.115, 1.0),
        "charcoal": (0.060, 0.070, 0.066, 1.0),
    }
    for key, color in colors.items():
        material = M[key]
        material.diffuse_color = color
        bsdf = material.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = color
            bsdf.inputs["Roughness"].default_value = 0.90 if key in ("kraft", "paper") else 0.66
    M["kraft_dark"] = mat("M_BoxKraftInterior", (0.255, 0.145, 0.065, 1.0), roughness=0.95)
    M["tape"] = mat("M_BoxTape", (0.40, 0.23, 0.075, 0.90), roughness=0.50)
    M["foam"] = mat("M_PackingFoam", (0.78, 0.74, 0.62, 1.0), roughness=0.96)
    return M


def root_for(asset_id, profile):
    dims = profile["dims"]
    layout_ids = [candidate["id"] for candidate in profile["layouts"]]
    root = empty(
        asset_id,
        props={
            "asset_id": asset_id,
            "asset_version": BUILD_VERSION,
            "version": BUILD_VERSION,
            "units": "meters",
            "reference_id": "41-50:46-48-derived-library",
            "reference_path": REFERENCE_PATH.relative_to(ROOT).as_posix(),
            "target_dimensions_m": list(dims),
            "target_dimensions_order": "width_depth_height",
            "front": "-Y label/player side",
            "source": "Original Pinehollow Golf geometry generated in-repository",
            "license": "Project-owned / UNLICENSED",
            "builder": SCRIPT.relative_to(ROOT).as_posix(),
            "asset_type": "delivery_packaging",
            "physical_shell_id": asset_id,
            "box_kind": profile["box_kind"],
            "carry_profile": profile["carry"],
            "content_layouts": json.dumps(layout_ids),
            "default_content_layout": layout_ids[0],
            "content_capacity": max(len(candidate["slots"]) for candidate in profile["layouts"]),
            "external_assets": "[]",
        },
        size=0.055,
    )
    return root


def set_helper(obj, kind):
    obj["helper"] = True
    obj["helper_kind"] = kind
    obj.hide_render = True
    return obj


def label_quad(name, width, height, loc, material, parent, *, rear=False):
    """One explicit-UV runtime label quad facing the selected box side."""
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    if rear:
        verts = [
            (-width / 2, 0, -height / 2),
            (-width / 2, 0, height / 2),
            (width / 2, 0, height / 2),
            (width / 2, 0, -height / 2),
        ]
        uvs = ((0, 0), (0, 1), (1, 1), (1, 0))
    else:
        verts = [
            (-width / 2, 0, -height / 2),
            (width / 2, 0, -height / 2),
            (width / 2, 0, height / 2),
            (-width / 2, 0, height / 2),
        ]
        uvs = ((0, 0), (1, 0), (1, 1), (0, 1))
    mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
    mesh.materials.append(material)
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for loop in mesh.loops:
        uv_layer.data[loop.index].uv = uvs[loop.vertex_index]
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    parent_keep(obj, parent)
    return obj


BLOCK_GLYPHS = {
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "B": ("11110", "10001", "10001", "11110", "10001", "10001", "11110"),
    "C": ("01111", "10000", "10000", "10000", "10000", "10000", "01111"),
    "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "F": ("11111", "10000", "10000", "11110", "10000", "10000", "10000"),
    "G": ("01111", "10000", "10000", "10111", "10001", "10001", "01111"),
    "I": ("11111", "00100", "00100", "00100", "00100", "00100", "11111"),
    "L": ("10000", "10000", "10000", "10000", "10000", "10000", "11111"),
    "M": ("10001", "11011", "10101", "10101", "10001", "10001", "10001"),
    "N": ("10001", "11001", "10101", "10011", "10001", "10001", "10001"),
    "O": ("01110", "10001", "10001", "10001", "10001", "10001", "01110"),
    "P": ("11110", "10001", "10001", "11110", "10000", "10000", "10000"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "S": ("01111", "10000", "10000", "01110", "00001", "00001", "11110"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
    "U": ("10001", "10001", "10001", "10001", "10001", "10001", "01110"),
    "V": ("10001", "10001", "10001", "10001", "10001", "01010", "00100"),
    "W": ("10001", "10001", "10001", "10101", "10101", "11011", "10001"),
}


def block_text(name, text, loc, material, *, max_width, max_height, parent):
    """Create readable original 5x7 carton lettering as one cheap plane mesh."""
    text = text.upper()
    columns = sum(3 if char == " " else 6 for char in text) - 1
    cell = min(max_height / 7.0, max_width / max(1, columns))
    # Adjacent cells overlap by one percent, turning the economical grid into
    # solid block lettering instead of a dotted/display-like label.
    filled = cell * 1.01
    total_width = columns * cell
    x_origin = loc[0] - total_width / 2
    z_origin = loc[2] + 3 * cell
    verts = []
    faces = []
    cursor = 0
    for char in text:
        if char == " ":
            cursor += 3
            continue
        glyph = BLOCK_GLYPHS.get(char, BLOCK_GLYPHS["E"])
        for row, pattern in enumerate(glyph):
            for column, active in enumerate(pattern):
                if active != "1":
                    continue
                cx = x_origin + (cursor + column + 0.5) * cell
                cz = z_origin - row * cell
                x0, x1 = cx - filled / 2, cx + filled / 2
                z0, z1 = cz - filled / 2, cz + filled / 2
                start = len(verts)
                verts.extend(((x0, loc[1], z0), (x1, loc[1], z0), (x1, loc[1], z1), (x0, loc[1], z1)))
                faces.append((start, start + 1, start + 2, start + 3))
        cursor += 6
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish_mesh(obj, material, bevel_width=0.0)
    parent_keep(obj, parent)
    obj["label_text"] = text
    obj["lettering"] = "original_5x7_block_glyphs"
    return obj


def wall_panel(name, side, dims, pivot_loc, panel_loc, root, M, inner_loc, inner_dims, axis):
    pivot = empty(
        f"BOX_WALL_{side}",
        pivot_loc,
        parent=root,
        size=0.035,
        props={
            "pivot_kind": "bottom_fold",
            "hinge_axis": axis,
            "closed_rotation": json.dumps([0.0, 0.0, 0.0]),
            "flatten_angle_deg": 88,
            "open_reveal_angle_deg": 82 if side == "FRONT" else 0,
            "reveal_contents": side == "FRONT",
        },
    )
    panel = box(
        name,
        dims,
        panel_loc,
        M["kraft"],
        bevel=min(0.003, min(dims) * 0.20),
        parent=pivot,
        props={"cardboard_thickness_m": 0.012, "surface": "stylized_corrugated_kraft"},
    )
    box(f"{name}_INNER", inner_dims, inner_loc, M["kraft_dark"], bevel=0.0008, parent=pivot)
    return pivot, panel


def flap_panel(side, dims, pivot_loc, panel_loc, wall_pivot, M, axis, angle):
    pivot = empty(
        f"BOX_FLAP_{side}",
        pivot_loc,
        parent=wall_pivot,
        size=0.032,
        props={
            "pivot_kind": "top_fold",
            "hinge_axis": axis,
            "closed_rotation": json.dumps([0.0, 0.0, 0.0]),
            "open_angle_deg": angle,
        },
    )
    panel = box(
        f"FLAP_TOP_{side}",
        dims,
        panel_loc,
        M["kraft"],
        bevel=min(0.002, min(dims) * 0.20),
        parent=pivot,
        props={"fold_pivot": pivot.name, "open_angle_deg": angle},
    )
    box(
        f"FLAP_TOP_{side}_INNER",
        (dims[0] * 0.965, dims[1] * 0.965, max(0.0018, dims[2] * 0.24)),
        (panel_loc[0], panel_loc[1], panel_loc[2] - dims[2] * 0.52),
        M["kraft_dark"],
        bevel=0.0006,
        parent=pivot,
    )
    return pivot, panel


def add_shell(root, profile, M):
    w, d, h = profile["dims"]
    t = min(0.012, max(0.008, min(w, d) * 0.025))
    flap_t = min(0.008, t * 0.70)
    box("BOX_BASE", (w - 2 * t, d - 2 * t, t), (0, 0, t / 2), M["kraft_dark"], bevel=0.002, parent=root)
    box("BOX_BASE_FACE", (w - 0.045, d - 0.045, 0.0025), (0, 0, t + 0.001), M["kraft"], bevel=0.001, parent=root)

    front, _ = wall_panel(
        "BOX_FRONT", "FRONT", (w - 2 * t, t, h - t),
        (0, -d / 2, t), (0, -d / 2 + t / 2, h / 2 + t / 2), root, M,
        (0, -d / 2 + t + 0.001, h / 2 + t / 2), (w - 0.045, 0.0025, h - 0.040), "X",
    )
    back, _ = wall_panel(
        "BOX_BACK", "BACK", (w - 2 * t, t, h - t),
        (0, d / 2, t), (0, d / 2 - t / 2, h / 2 + t / 2), root, M,
        (0, d / 2 - t - 0.001, h / 2 + t / 2), (w - 0.045, 0.0025, h - 0.040), "X",
    )
    left, _ = wall_panel(
        "BOX_LEFT", "LEFT", (t, d - 2 * t, h - t),
        (-w / 2, 0, t), (-w / 2 + t / 2, 0, h / 2 + t / 2), root, M,
        (-w / 2 + t + 0.001, 0, h / 2 + t / 2), (0.0025, d - 0.045, h - 0.040), "Y",
    )
    right, _ = wall_panel(
        "BOX_RIGHT", "RIGHT", (t, d - 2 * t, h - t),
        (w / 2, 0, t), (w / 2 - t / 2, 0, h / 2 + t / 2), root, M,
        (w / 2 - t - 0.001, 0, h / 2 + t / 2), (0.0025, d - 0.045, h - 0.040), "Y",
    )

    flap_panel(
        "FRONT", (w - 0.024, d / 2 - 0.012, flap_t),
        (0, -d / 2, h), (0, -d / 4 - 0.003, h), front, M, "X", 145,
    )
    flap_panel(
        "BACK", (w - 0.024, d / 2 - 0.012, flap_t),
        (0, d / 2, h), (0, d / 4 + 0.003, h), back, M, "X", -145,
    )
    flap_panel(
        "LEFT", (w / 2 - 0.014, d - 0.028, flap_t),
        (-w / 2, 0, h - 0.004), (-w / 4 - 0.003, 0, h - 0.004), left, M, "Y", -145,
    )
    flap_panel(
        "RIGHT", (w / 2 - 0.014, d - 0.028, flap_t),
        (w / 2, 0, h - 0.004), (w / 4 + 0.003, 0, h - 0.004), right, M, "Y", 145,
    )
    return front, back, left, right


def add_tape(root, profile, M):
    w, d, h = profile["dims"]
    segment_count = 12 if max(w, h) >= 0.90 else 8
    tape_width = min(0.055, max(0.042, w * 0.11))
    span = d * 0.92
    step = span / segment_count
    tape_root = empty(
        "TAPE_CENTER",
        parent=root,
        size=0.025,
        props={
            "tape_path": "centre_seam",
            "segment_count": segment_count,
            "state_sequence": "uncut,partial,cut,peeled",
        },
    )
    for index in range(segment_count):
        segment = box(
            f"TAPE_CENTER_SEG_{index + 1:02d}",
            (tape_width, step - 0.0012, 0.0018),
            (0, -span / 2 + (index + 0.5) * step, h + 0.0036),
            M["tape"],
            bevel=0.0006,
            parent=tape_root,
            props={
                "cut_order": index + 1,
                "cut_fraction_start": round(index / segment_count, 4),
                "cut_fraction_end": round((index + 1) / segment_count, 4),
                "tape_state": "uncut",
            },
        )
        segment["separable"] = True
    box("TAPE_SIDE_FRONT", (tape_width, 0.0018, min(0.120, h * 0.36)), (0, -d / 2 - 0.0008, h - min(0.060, h * 0.18)), M["tape"], bevel=0.0006, parent=tape_root)
    box("TAPE_SIDE_BACK", (tape_width, 0.0018, min(0.120, h * 0.36)), (0, d / 2 + 0.0008, h - min(0.060, h * 0.18)), M["tape"], bevel=0.0006, parent=tape_root)

    # Heavy and long cases use a restrained cross band as physical reinforcement.
    if profile["box_kind"] in {"ballcase", "bagcarton", "fixture", "crate", "umbrella", "ironset"}:
        cross_span = w * 0.88
        cross_step = cross_span / 6
        cross_root = empty("TAPE_REINFORCEMENT", parent=root, size=0.022, props={"reinforced": True})
        for index in range(6):
            box(
                f"TAPE_CROSS_SEG_{index + 1:02d}",
                (cross_step - 0.002, tape_width * 0.82, 0.0018),
                (-cross_span / 2 + (index + 0.5) * cross_step, 0, h + 0.0053),
                M["tape"],
                bevel=0.0006,
                parent=cross_root,
                props={"cross_cut_order": index + 1, "separable": True},
            )

    anchor(
        "CUT_PATH",
        (0, 0, h + 0.025),
        parent=root,
        kind="cut_path",
        props={
            "points": json.dumps([[0, -d * 0.46, h + 0.025], [0, d * 0.46, h + 0.025]]),
            "duration_sec": 2.4 if segment_count == 12 else 1.9,
            "segment_nodes": json.dumps([f"TAPE_CENTER_SEG_{index:02d}" for index in range(1, segment_count + 1)]),
            "completion_threshold": 0.92,
        },
    )


def add_branding(root, profile, walls, M):
    w, d, h = profile["dims"]
    front, back, _, _ = walls
    # The category face always uses Pinehollow deep green for player-camera
    # contrast; sage remains a secondary side-band accent.
    band_material = M["green"]
    if profile["style"] == "timber_reinforced":
        band_material = M["charcoal"]
    label_height = min(0.105, h * 0.22)
    band_z = min(h * 0.58, h - label_height * 0.80)
    box(
        "LABEL_MAIN",
        (w * 0.86, 0.0022, label_height),
        (0, -d / 2 - 0.0012, band_z),
        band_material,
        bevel=0.001,
        parent=front,
        props={"fictional_brand": "Pinehollow Clubhouse Supply"},
    )
    block_text(
        "LABEL_CATEGORY_TEXT",
        profile["label"],
        (0, -d / 2 - 0.0030, band_z),
        M["cream"],
        max_width=w * 0.78,
        max_height=label_height * 0.58,
        parent=front,
    )

    label_w = min(0.240, w * 0.42)
    label_h = min(0.145, h * 0.34)
    label_x = min(w * 0.22, w / 2 - label_w / 2 - 0.025)
    label_z = max(label_h / 2 + 0.035, h * 0.28)
    label_pivot = empty(
        "LABEL_SHIPPING",
        (label_x, d / 2, label_z),
        parent=back,
        size=0.024,
        props={"label_mount": True, "face": "+Y", "runtime_canvas_aspect": "512:320"},
    )
    box(
        "SHIPPING_LABEL_BACKING",
        (label_w + 0.006, 0.0020, label_h + 0.006),
        (label_x, d / 2 + 0.0010, label_z),
        M["cream"],
        bevel=0.0008,
        parent=label_pivot,
    )
    dynamic = label_quad(
        "LABEL_DYNAMIC",
        label_w,
        label_h,
        (label_x, d / 2 + 0.0022, label_z),
        M["cream"],
        label_pivot,
        rear=True,
    )
    dynamic["fields"] = json.dumps(["category", "unit_count", "order_number", "supplier", "weight_kg"])
    dynamic["layout_ids"] = root["content_layouts"]

    # Original geometric handling marks stay readable without external textures.
    icon_x = -w / 2 + min(0.070, w * 0.17)
    icon_z = max(0.055, h * 0.18)
    box("HANDLING_ICON_FRAME", (0.052, 0.0018, 0.052), (icon_x, -d / 2 - 0.0014, icon_z), band_material, bevel=0.002, parent=front)
    box("HANDLING_ICON_INSET", (0.038, 0.0020, 0.038), (icon_x, -d / 2 - 0.0016, icon_z), M["kraft"], bevel=0.001, parent=front)
    for arrow_index, x in enumerate((icon_x - 0.008, icon_x + 0.008), start=1):
        box(f"THIS_SIDE_UP_{arrow_index:02d}", (0.003, 0.0022, 0.025), (x, -d / 2 - 0.0019, icon_z), band_material, bevel=0.0005, parent=front)
    if profile["fragile"]:
        fragile = box(
            "LABEL_FRAGILE",
            (min(0.160, w * 0.30), 0.0022, min(0.052, h * 0.12)),
            (-w * 0.20, d / 2 + 0.0012, min(h * 0.72, h - 0.05)),
            M["cream"],
            bevel=0.001,
            parent=back,
            props={"handling": "fragile"},
        )
        fragile["label_text"] = "HANDLE WITH CARE"


def add_inserts(root, profile, M):
    w, d, h = profile["dims"]
    insert_material = M["foam"] if profile["fragile"] else M["paper"]
    bottom_t = min(0.020, max(0.010, h * 0.035))
    bottom = box(
        "INSERT_BOTTOM",
        (w - 0.050, d - 0.050, bottom_t),
        (0, 0, 0.014 + bottom_t / 2),
        insert_material,
        bevel=min(0.004, bottom_t * 0.20),
        parent=root,
        props={"permanent": True, "removal_allowed": False, "insert_role": "product_bed"},
    )
    bottom["persists_when_empty"] = True
    side_h = min(0.180, h * 0.34)
    box("INSERT_SIDE_LEFT", (0.024, d - 0.065, side_h), (-w / 2 + 0.030, 0, side_h / 2 + 0.025), insert_material, bevel=0.003, parent=root)
    box("INSERT_SIDE_RIGHT", (0.024, d - 0.065, side_h), (w / 2 - 0.030, 0, side_h / 2 + 0.025), insert_material, bevel=0.003, parent=root)

    kind = profile["box_kind"]
    if kind == "ballcase":
        for index, x in enumerate((-0.080, 0.080), start=1):
            box(f"INSERT_DIVIDER_X_{index:02d}", (0.006, d - 0.070, 0.150), (x, 0, 0.095), M["kraft_dark"], bevel=0.001, parent=root)
        box("INSERT_DIVIDER_Y_01", (w - 0.070, 0.006, 0.150), (0, 0, 0.095), M["kraft_dark"], bevel=0.001, parent=root)
    elif kind == "provisions":
        for index, x in enumerate((-0.110, 0.0, 0.110), start=1):
            box(f"INSERT_DIVIDER_X_{index:02d}", (0.004, d - 0.070, 0.095), (x, 0, 0.067), M["paper"], bevel=0.0008, parent=root)
        for index, y in enumerate((-0.050, 0.050), start=1):
            box(f"INSERT_DIVIDER_Y_{index:02d}", (w - 0.070, 0.004, 0.095), (0, y, 0.067), M["paper"], bevel=0.0008, parent=root)
    elif kind in {"umbrella", "ironset"}:
        for index, x in enumerate((-w * 0.36, w * 0.36), start=1):
            support = box(f"LONG_PRODUCT_SUPPORT_{index:02d}", (0.055, d - 0.070, min(0.120, h * 0.42)), (x, 0, min(0.080, h * 0.31)), M["foam"], bevel=0.008, parent=root)
            support["support_role"] = "shaft_and_head_restraint"
    elif kind == "bagcarton":
        for index, z in enumerate((0.100, h - 0.115), start=1):
            block = box(f"BAG_FOAM_BLOCK_{index:02d}", (w - 0.130, d - 0.130, 0.095), (0, 0, z), M["foam"], bevel=0.014, parent=root)
            block["support_role"] = "bag_end_block"
    elif kind in {"fixture", "crate"}:
        for index, x in enumerate((-w * 0.38, w * 0.38), start=1):
            box(f"FREIGHT_CORNER_BLOCK_{index:02d}", (0.085, d - 0.105, min(0.180, h * 0.24)), (x, 0, min(0.115, h * 0.18)), M["foam"], bevel=0.012, parent=root)


def add_layouts(root, profile):
    for layout_profile in profile["layouts"]:
        layout_id = layout_profile["id"]
        capacity = len(layout_profile["slots"])
        layout_root = empty(
            f"CONTENT_LAYOUT_{layout_id}",
            parent=root,
            size=0.040,
            props={
                "layout_id": layout_id,
                "capacity": capacity,
                "allowed_category": layout_profile["category"],
                "allowed_skus": json.dumps(layout_profile["skus"]),
                "packaging_state": layout_profile["packed_state"],
                "physical_shell_id": root["physical_shell_id"],
                "socket_prefix": f"CONTENT_SLOT_{layout_id}_",
                "selection_rule": "exact_sku_category_quantity_dimensions_packaging_state",
            },
        )
        for index, definition in enumerate(layout_profile["slots"], start=1):
            max_w, max_d, max_h = definition["max_dims"]
            socket_name = f"CONTENT_SLOT_{layout_id}_{index:02d}"
            socket = anchor(
                socket_name,
                definition["position"],
                rot=definition["rotation"],
                parent=layout_root,
                kind="box_content",
                props={
                    "layout_id": layout_id,
                    "slot_index": index,
                    "allowed_category": layout_profile["category"],
                    "allowed_skus": json.dumps(layout_profile["skus"]),
                    "packaging_state": layout_profile["packed_state"],
                    "max_w": max_w,
                    "max_d": max_d,
                    "max_h": max_h,
                    "display_state": definition["display"],
                    "stack_order": index,
                    "stack_column": definition["column"],
                    "stack_layer": definition["layer"],
                    "visibility_threshold": round(1.0 - (index - 1) / max(1, capacity - 1), 4),
                    "visible_when_remaining_at_least": capacity - index + 1,
                    "removal_order": capacity - index + 1,
                    "removal_policy": "highest_removal_order_first",
                },
            )
            socket["authored_rotation_rad"] = json.dumps([round(v, 6) for v in definition["rotation"]])


def add_flat_bundle(root, profile, M):
    w, d, _ = profile["dims"]
    flat = empty(
        "BOX_FLAT_BUNDLE",
        parent=root,
        size=0.035,
        props={"runtime_variant": "flattened", "thickness_m": 0.038},
    )
    box("FLAT_PANEL_BASE", (w - 0.020, d - 0.020, 0.009), (0, 0, 0.010), M["kraft_dark"], bevel=0.003, parent=flat)
    box("FLAT_PANEL_BACK", (w - 0.045, d * 0.82, 0.007), (0, 0.010, 0.018), M["kraft"], bevel=0.002, parent=flat)
    box("FLAT_PANEL_FRONT", (w - 0.070, d * 0.74, 0.007), (0, -0.010, 0.025), M["kraft"], bevel=0.002, parent=flat)
    box("FLAT_PANEL_LEFT", (w * 0.42, d - 0.070, 0.005), (-w * 0.20, 0.005, 0.032), M["kraft_dark"], bevel=0.0015, parent=flat)
    box("FLAT_PANEL_RIGHT", (w * 0.42, d - 0.070, 0.005), (w * 0.20, -0.005, 0.036), M["kraft"], bevel=0.0015, parent=flat)
    box("FLAT_LABEL", (w * 0.20, d * 0.18, 0.0025), (w * 0.20, d * 0.08, 0.039), M["green"], bevel=0.0008, parent=flat)


def add_reinforcement(root, profile, M):
    """Visual family variation without changing the exact outer envelope."""
    w, d, h = profile["dims"]
    style = profile["style"]
    if style == "timber_reinforced":
        # Oak battens sit inside the crate envelope and leave the kraft wall
        # visible between them, matching Pinehollow's stylized freight language.
        for face, y in (("FRONT", -d / 2 + 0.0095), ("BACK", d / 2 - 0.0095)):
            for index, z in enumerate((h * 0.18, h * 0.50, h * 0.82), start=1):
                box(f"CRATE_{face}_BATTEN_{index:02d}", (w - 0.035, 0.027, 0.055), (0, y, z), M["oak"], bevel=0.006, parent=root)
        for side, x in (("LEFT", -w / 2 + 0.0095), ("RIGHT", w / 2 - 0.0095)):
            for index, z in enumerate((h * 0.22, h * 0.78), start=1):
                box(f"CRATE_{side}_BATTEN_{index:02d}", (0.027, d - 0.035, 0.055), (x, 0, z), M["oak"], bevel=0.006, parent=root)
        for index, x in enumerate((-w * 0.36, w * 0.36), start=1):
            box(f"CRATE_SKID_{index:02d}", (0.105, d - 0.025, 0.052), (x, 0, 0.031), M["walnut"], bevel=0.006, parent=root)
        for index, y in enumerate((-d * 0.22, d * 0.22), start=1):
            box(f"CRATE_TOP_BATTEN_{index:02d}", (w - 0.080, 0.070, 0.025), (0, y, h - 0.008), M["oak"], bevel=0.005, parent=root)
    elif style in {"cream_green", "sage_green"}:
        material = M["green"] if style == "cream_green" else M["sage"]
        box("CATEGORY_SIDE_BAND_LEFT", (0.0022, d * 0.72, min(0.090, h * 0.14)), (-w / 2 - 0.0010, 0, h * 0.58), material, bevel=0.0008, parent=root)
        box("CATEGORY_SIDE_BAND_RIGHT", (0.0022, d * 0.72, min(0.090, h * 0.14)), (w / 2 + 0.0010, 0, h * 0.58), material, bevel=0.0008, parent=root)


def build_asset(asset_id, profile, M):
    root = root_for(asset_id, profile)
    walls = add_shell(root, profile, M)
    add_tape(root, profile, M)
    add_branding(root, profile, walls, M)
    add_inserts(root, profile, M)
    add_layouts(root, profile)
    add_flat_bundle(root, profile, M)
    add_reinforcement(root, profile, M)

    w, d, h = profile["dims"]
    set_helper(collision_box("COLLISION_CLOSED", (w, d, h), (0, 0, h / 2), M, parent=root), "closed_collision")
    set_helper(collision_box("COLLISION_OPEN", (w, d, h * 0.83), (0, 0, h * 0.415), M, parent=root), "open_collision")
    set_helper(collision_box("VOLUME_CONTENTS", (w - 0.060, d - 0.060, h - 0.075), (0, 0, h / 2 - 0.005), M, parent=root), "contents_volume")
    anchor("INTERACTION_TARGET", (0, -d * 0.10, h + 0.045), parent=root, kind="box_interaction", props={"interaction": "pickup_cut_open_unpack"})
    return root


def visible_bounds(root):
    bpy.context.view_layer.update()
    corners = []
    for obj in descendants(root):
        if obj.type != "MESH" or obj.name.startswith(("COL_", "COLLISION_", "VOLUME_")):
            continue
        for corner in obj.bound_box:
            corners.append(obj.matrix_world @ Vector(corner))
    if not corners:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    lo = Vector(tuple(min(point[index] for point in corners) for index in range(3)))
    hi = Vector(tuple(max(point[index] for point in corners) for index in range(3)))
    return lo, hi


def asset_metrics(root):
    nodes = descendants(root)
    meshes = [obj for obj in nodes if obj.type == "MESH"]
    triangles = sum(
        sum(max(1, len(polygon.vertices) - 2) for polygon in obj.data.polygons)
        for obj in meshes
    )
    material_names = sorted({
        slot.material.name
        for obj in meshes
        for slot in obj.material_slots
        if slot.material
    })
    lo, hi = visible_bounds(root)
    return {
        "nodes": len(nodes),
        "meshes": len(meshes),
        "triangles": triangles,
        "materials": material_names,
        "textures": 0,
        "visible_bounds_min": [round(value, 5) for value in lo],
        "visible_bounds_max": [round(value, 5) for value in hi],
        "visible_dimensions_blender_xyz": [round(value, 5) for value in (hi - lo)],
    }


def required_names(profile):
    names = {
        "BOX_BASE", "BOX_BASE_FACE",
        "TAPE_CENTER", "TAPE_SIDE_FRONT", "TAPE_SIDE_BACK",
        "LABEL_MAIN", "LABEL_CATEGORY_TEXT", "LABEL_SHIPPING", "LABEL_DYNAMIC",
        "SHIPPING_LABEL_BACKING", "INSERT_BOTTOM", "INSERT_SIDE_LEFT", "INSERT_SIDE_RIGHT",
        "COLLISION_CLOSED", "COLLISION_OPEN", "VOLUME_CONTENTS", "INTERACTION_TARGET", "CUT_PATH",
        "BOX_FLAT_BUNDLE", "FLAT_PANEL_BASE", "FLAT_PANEL_FRONT", "FLAT_PANEL_BACK",
        "FLAT_PANEL_LEFT", "FLAT_PANEL_RIGHT", "FLAT_LABEL",
    }
    for side in ("FRONT", "BACK", "LEFT", "RIGHT"):
        names.update({f"BOX_WALL_{side}", f"BOX_{side}", f"BOX_FLAP_{side}", f"FLAP_TOP_{side}"})
    segment_count = 12 if max(profile["dims"][0], profile["dims"][2]) >= 0.90 else 8
    names.update(f"TAPE_CENTER_SEG_{index:02d}" for index in range(1, segment_count + 1))
    for layout_profile in profile["layouts"]:
        layout_id = layout_profile["id"]
        names.add(f"CONTENT_LAYOUT_{layout_id}")
        names.update(
            f"CONTENT_SLOT_{layout_id}_{index:02d}"
            for index in range(1, len(layout_profile["slots"]) + 1)
        )
    if profile["fragile"]:
        names.add("LABEL_FRAGILE")
    return names


def exercise_pivots(by_name):
    checks = []
    definitions = (
        ("BOX_WALL_FRONT", "BOX_FRONT", "X", -82),
        ("BOX_WALL_BACK", "BOX_BACK", "X", 82),
        ("BOX_WALL_LEFT", "BOX_LEFT", "Y", 82),
        ("BOX_WALL_RIGHT", "BOX_RIGHT", "Y", -82),
        ("BOX_FLAP_FRONT", "FLAP_TOP_FRONT", "X", 145),
        ("BOX_FLAP_BACK", "FLAP_TOP_BACK", "X", -145),
        ("BOX_FLAP_LEFT", "FLAP_TOP_LEFT", "Y", -145),
        ("BOX_FLAP_RIGHT", "FLAP_TOP_RIGHT", "Y", 145),
    )
    for pivot_name, child_name, axis, degrees in definitions:
        pivot = by_name[pivot_name]
        child = by_name[child_name]
        if child.parent is not pivot:
            raise RuntimeError(f"{child_name} must be a direct child of {pivot_name}")
        original = pivot.rotation_euler.copy()
        bpy.context.view_layer.update()
        before = child.matrix_world.translation.copy()
        if axis == "X":
            pivot.rotation_euler.x = math.radians(degrees)
        else:
            pivot.rotation_euler.y = math.radians(degrees)
        bpy.context.view_layer.update()
        travel = (child.matrix_world.translation - before).length
        pivot.rotation_euler = original
        bpy.context.view_layer.update()
        if travel < 0.018:
            raise RuntimeError(f"{pivot_name} failed pivot exercise: {travel:.5f} m")
        checks.append({"pivot": pivot_name, "child": child_name, "travel_m": round(travel, 5), "pass": True})
    return checks


def validate_scene(asset_id, profile, root):
    nodes = descendants(root)
    by_name = {obj.name: obj for obj in nodes}
    missing = sorted(required_names(profile) - set(by_name))
    if missing:
        raise RuntimeError(f"{asset_id} missing required nodes: {missing}")
    if root.get("asset_id") != asset_id or root.get("units") != "meters":
        raise RuntimeError(f"{asset_id} lost root production metadata")

    for obj in nodes:
        if obj.type != "MESH":
            continue
        if any(abs(value - 1.0) > 1e-5 for value in obj.scale):
            raise RuntimeError(f"{asset_id} has unapplied scale on {obj.name}: {tuple(obj.scale)}")
        if obj.data.polygons and not obj.data.uv_layers:
            raise RuntimeError(f"{asset_id} mesh {obj.name} has no UV map")

    for layout_profile in profile["layouts"]:
        layout_id = layout_profile["id"]
        layout_root = by_name[f"CONTENT_LAYOUT_{layout_id}"]
        if int(layout_root.get("capacity", -1)) != len(layout_profile["slots"]):
            raise RuntimeError(f"{asset_id}/{layout_id} capacity metadata changed")
        for index, definition in enumerate(layout_profile["slots"], start=1):
            name = f"CONTENT_SLOT_{layout_id}_{index:02d}"
            socket = by_name[name]
            if socket.parent is not layout_root:
                raise RuntimeError(f"{name} is not directly under CONTENT_LAYOUT_{layout_id}")
            for key in (
                "layout_id", "slot_index", "allowed_category", "allowed_skus", "packaging_state",
                "max_w", "max_d", "max_h", "display_state", "stack_order", "stack_layer",
                "visibility_threshold", "removal_order",
            ):
                if key not in socket:
                    raise RuntimeError(f"{name} missing {key}")
            authored = tuple(round(value, 6) for value in definition["max_dims"])
            exported = tuple(round(float(socket[key]), 6) for key in ("max_w", "max_d", "max_h"))
            if authored != exported:
                raise RuntimeError(f"{name} max dimensions changed: {exported} != {authored}")

    if by_name["INSERT_BOTTOM"].get("permanent") is not True:
        raise RuntimeError(f"{asset_id} bottom insert is not permanent")
    for collision_name in ("COLLISION_CLOSED", "COLLISION_OPEN"):
        collision = by_name[collision_name]
        triangles = sum(max(1, len(poly.vertices) - 2) for poly in collision.data.polygons)
        if triangles > 24:
            raise RuntimeError(f"{asset_id}/{collision_name} is not simplified")

    metrics = asset_metrics(root)
    expected = profile["dims"]
    actual = metrics["visible_dimensions_blender_xyz"]
    for index, axis in enumerate("XYZ"):
        if abs(actual[index] - expected[index]) > 0.009:
            raise RuntimeError(
                f"{asset_id} visible {axis} dimension {actual[index]:.5f} differs from {expected[index]:.5f}"
            )
    if metrics["triangles"] > 15000:
        raise RuntimeError(f"{asset_id} triangle budget exceeded: {metrics['triangles']}")
    if len(metrics["materials"]) > 10:
        raise RuntimeError(f"{asset_id} material budget exceeded: {len(metrics['materials'])}")
    metrics["triangle_budget"] = 15000
    metrics["material_budget"] = 10
    metrics["pivot_checks"] = exercise_pivots(by_name)
    metrics["layouts"] = {
        candidate["id"]: {
            "capacity": len(candidate["slots"]),
            "allowed_category": candidate["category"],
            "allowed_skus": list(candidate["skus"]),
            "packaging_state": candidate["packed_state"],
        }
        for candidate in profile["layouts"]
    }
    return metrics


def add_build_info(asset_id, profile):
    info = bpy.data.texts.new("BUILD_INFO.txt")
    info.write(
        "Pinehollow Golf exact-dimension delivery packaging library\n"
        f"asset_id: {asset_id}\n"
        f"build_version: {BUILD_VERSION}\n"
        f"box_kind: {profile['box_kind']}\n"
        f"dimensions_width_depth_height_m: {profile['dims']}\n"
        f"layouts: {[candidate['id'] for candidate in profile['layouts']]}\n"
        f"builder: {SCRIPT.relative_to(ROOT).as_posix()}\n"
        f"reference: {REFERENCE_PATH.relative_to(ROOT).as_posix()}\n"
        "source: original project-owned in-repository geometry\n"
        "license: project-owned / UNLICENSED\n"
        "external downloads: none\n"
        "raw external sources modified: none\n"
    )


def save_and_export(asset_id, profile, root):
    metrics = validate_scene(asset_id, profile, root)
    add_build_info(asset_id, profile)
    blend_path = SOURCE_DIR / f"{asset_id}.blend"
    glb_path = EXPORT_DIR / f"{asset_id}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in descendants(root):
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
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
        "asset_id": asset_id,
        "box_kind": profile["box_kind"],
        "target_dimensions_width_depth_height_m": list(profile["dims"]),
        "source_path": blend_path.relative_to(ROOT).as_posix(),
        "glb_path": glb_path.relative_to(ROOT).as_posix(),
        "glb_bytes": glb_path.stat().st_size,
        "qa_pass": QA_PASS,
    })
    (QA_DIR / f"{asset_id}_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf8")
    print(
        f"BUILT|{asset_id}|nodes={metrics['nodes']}|meshes={metrics['meshes']}|"
        f"tris={metrics['triangles']}|materials={len(metrics['materials'])}|bytes={metrics['glb_bytes']}"
    )
    return metrics


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def preview_setup(profile):
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 560
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world = scene.world or bpy.data.worlds.new("QA_World")
    scene.world.color = (0.018, 0.026, 0.021)
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -1.65

    w, d, h = profile["dims"]
    scale = max(w, d, h)
    bpy.ops.object.camera_add(location=(scale * 1.45, -scale * 2.10, max(h * 1.18, scale * 1.12)))
    camera = bpy.context.object
    camera.name = "QA_Camera"
    camera.data.lens = 52
    scene.camera = camera
    for name, energy, location in (
        ("Key", 165, (-scale * 0.8, -scale * 1.0, max(h * 1.45, scale * 1.2))),
        ("Fill", 75, (scale * 1.0, -scale * 0.4, max(h * 0.9, scale * 0.8))),
        ("Rim", 110, (0, scale * 1.0, max(h * 1.25, scale))),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = f"QA_{name}"
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = max(0.75, scale)
        look_at(light, (0, 0, h * 0.45))
    box("QA_Floor", (scale * 3.4, scale * 3.4, 0.025), (0, 0, -0.018), mat("QA_FloorMat", (0.075, 0.105, 0.085, 1), roughness=0.95), bevel=0.004)
    return camera


def set_open_state(opened):
    definitions = {
        "BOX_FLAP_FRONT": ("X", math.radians(145)),
        "BOX_FLAP_BACK": ("X", math.radians(-145)),
        "BOX_FLAP_LEFT": ("Y", math.radians(-145)),
        "BOX_FLAP_RIGHT": ("Y", math.radians(145)),
    }
    for name, (axis, angle) in definitions.items():
        pivot = bpy.data.objects[name]
        pivot.rotation_euler = (0, 0, 0)
        if opened:
            if axis == "X":
                pivot.rotation_euler.x = angle
            else:
                pivot.rotation_euler.y = angle
    # The player-facing wall has its own bottom hinge.  Dropping it after the
    # flaps clear creates a low sightline into tall/bulky cartons; all inserts
    # and sockets remain under the permanent base instead of following it.
    front_wall = bpy.data.objects.get("BOX_WALL_FRONT")
    if front_wall:
        front_wall.rotation_euler = (math.radians(82) if opened else 0.0, 0.0, 0.0)
    tape = bpy.data.objects.get("TAPE_CENTER")
    if tape:
        for obj in descendants(tape):
            obj.hide_render = opened
    reinforcement = bpy.data.objects.get("TAPE_REINFORCEMENT")
    if reinforcement:
        for obj in descendants(reinforcement):
            obj.hide_render = opened
    bpy.context.view_layer.update()


def render_previews(asset_id, profile, root):
    camera = preview_setup(profile)
    w, d, h = profile["dims"]
    scale = max(w, d, h)
    flat_names = {obj.name for obj in descendants(bpy.data.objects["BOX_FLAT_BUNDLE"])}
    for name in flat_names:
        bpy.data.objects[name].hide_render = True
    if w >= max(d, h) * 2.0:
        views = (
            ("sealed_three_quarter", (scale * 0.72, -scale * 1.52, max(h * 2.2, scale * 0.70)), (0, 0, h * 0.42), False),
            ("open_three_quarter", (scale * 0.70, -scale * 1.55, max(h * 2.6, scale * 0.86)), (0, 0, h * 0.35), True),
            ("open_interior", (scale * 0.38, -scale * 0.82, max(h * 3.2, scale * 1.02)), (0, 0, h * 0.25), True),
        )
    else:
        views = (
            ("sealed_three_quarter", (scale * 1.45, -scale * 2.10, max(h * 1.18, scale * 1.12)), (0, 0, h * 0.43), False),
            ("open_three_quarter", (scale * 1.45, -scale * 2.10, max(h * 1.40, scale * 1.28)), (0, 0, h * 0.38), True),
            ("open_interior", (scale * 0.72, -scale * 1.15, max(h * 1.72, scale * 1.50)), (0, 0, h * 0.30), True),
        )
    for view_name, location, target, opened in views:
        set_open_state(opened)
        camera.location = location
        look_at(camera, target)
        bpy.context.scene.render.filepath = str(QA_DIR / f"{asset_id}_{view_name}.png")
        bpy.ops.render.render(write_still=True)
    set_open_state(False)
    for name in flat_names:
        bpy.data.objects[name].hide_render = False
    for obj in [candidate for candidate in list(bpy.data.objects) if candidate.name.startswith("QA_")]:
        bpy.data.objects.remove(obj, do_unlink=True)


def clean_reimport_validate(asset_id, profile):
    reset_scene()
    glb_path = EXPORT_DIR / f"{asset_id}.glb"
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    root = bpy.data.objects.get(asset_id)
    if root is None:
        raise RuntimeError(f"clean re-import {asset_id} lost exact root name")
    names = {obj.name for obj in bpy.context.scene.objects}
    missing = sorted(required_names(profile) - names)
    if missing:
        raise RuntimeError(f"clean re-import {asset_id} missing required nodes: {missing}")
    if root.get("asset_id") != asset_id or root.get("physical_shell_id") != asset_id:
        raise RuntimeError(f"clean re-import {asset_id} lost glTF extras")
    if any(obj.type == "CAMERA" for obj in bpy.context.scene.objects):
        raise RuntimeError(f"clean re-import {asset_id} unexpectedly contains a camera")
    if any(obj.type == "LIGHT" for obj in bpy.context.scene.objects):
        raise RuntimeError(f"clean re-import {asset_id} unexpectedly contains a light")
    metrics = asset_metrics(root)
    expected = profile["dims"]
    actual = metrics["visible_dimensions_blender_xyz"]
    for index in range(3):
        if abs(actual[index] - expected[index]) > 0.009:
            raise RuntimeError(f"clean re-import {asset_id} changed dimensions: {actual} vs {expected}")
    report = {
        "asset_id": asset_id,
        "glb": glb_path.relative_to(ROOT).as_posix(),
        "root_metadata_preserved": True,
        "required_nodes_preserved": True,
        "no_camera": True,
        "no_light": True,
        "clean_transforms": all(
            all(abs(value - 1.0) < 1e-5 for value in obj.scale)
            for obj in descendants(root)
            if obj.type == "MESH"
        ),
        **metrics,
    }
    (QA_DIR / f"{asset_id}_reimport.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(f"REIMPORT_OK|{asset_id}|nodes={metrics['nodes']}|tris={metrics['triangles']}|dims={actual}")
    return report


def build_one(asset_id, profile):
    reset_scene()
    bpy.context.scene["asset_build_script"] = SCRIPT.relative_to(ROOT).as_posix()
    bpy.context.scene["asset_build_version"] = BUILD_VERSION
    M = delivery_materials()
    root = build_asset(asset_id, profile, M)
    metrics = save_and_export(asset_id, profile, root)
    render_previews(asset_id, profile, root)
    return metrics


def main():
    target = os.environ.get("DELIVERY_BOX_LIBRARY_TARGET", "").strip()
    asset_ids = tuple(PROFILES) if not target else (target,)
    unknown = [asset_id for asset_id in asset_ids if asset_id not in PROFILES]
    if unknown:
        raise RuntimeError(f"unknown DELIVERY_BOX_LIBRARY_TARGET: {unknown[0]}")
    if not REFERENCE_PATH.exists():
        raise RuntimeError(f"authoritative reference is missing: {REFERENCE_PATH}")

    builds = [build_one(asset_id, PROFILES[asset_id]) for asset_id in asset_ids]
    reimports = [clean_reimport_validate(asset_id, PROFILES[asset_id]) for asset_id in asset_ids]
    report = {
        "builder": SCRIPT.relative_to(ROOT).as_posix(),
        "build_version": BUILD_VERSION,
        "qa_pass": QA_PASS,
        "asset_target": target or "all",
        "reference": REFERENCE_PATH.relative_to(ROOT).as_posix(),
        "source_and_license": "Original project-owned geometry; no external downloads",
        "raw_external_assets_modified": False,
        "assets": builds,
        "reimports": reimports,
    }
    (QA_DIR / "delivery_box_library_build_report.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(
        f"COMPLETE|assets={len(asset_ids)}|qa_pass={QA_PASS}|"
        f"source_dir={SOURCE_DIR}|export_dir={EXPORT_DIR}"
    )


if __name__ == "__main__":
    main()
