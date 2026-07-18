"""Build delivery reference 46 (generic carton) and 50 (packing tape).

Run from the repository root with Blender 5.1:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
      --background --factory-startup \
      --python tools/blender/build_delivery_generic_and_tape.py

All geometry is original, deterministic, project-owned work authored in metres.
Blender Z is up; the glTF exporter converts to a Y-up runtime scene.  This
script deliberately creates new assets and never opens or overwrites legacy
carton sources. Set DELIVERY_ASSET_QA_PASS (for example ``pass-02``) to keep
successive comparison renders under the ignored QA tree. Set
DELIVERY_ASSET_TARGET to either asset id to rebuild only that asset.
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
    panel_mesh,
    parent_keep,
    reset_scene,
    text_mesh,
    torus,
)


SOURCE_DIR = ROOT / "asset_sources" / "blender" / "delivery"
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
QA_ROOT = ROOT / "qa" / "box_system_master" / "assets_41_50" / "blender"
QA_PASS = os.environ.get("DELIVERY_ASSET_QA_PASS", "pass-01")
QA_DIR = QA_ROOT / QA_PASS
SOURCE_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
QA_DIR.mkdir(parents=True, exist_ok=True)

BUILD_VERSION = 3
BOX_ID = "delivery_generic_merchandise_box"
TAPE_ID = "delivery_packing_tape_roll"
BOX_DIMS = (0.60, 0.40, 0.40)  # X width, Y depth, Z height
TAPE_DIMS = (0.10, 0.10, 0.05)  # X/Y outside diameter, Z axial width


def delivery_materials():
    """Return exporter-safe Pinehollow materials used by both assets."""
    M = materials()
    # The shared material names are kept intact for runtime remapping, while
    # their authored Blender values match the medium-kraft/deep-green sheet.
    for key, color in (
        ("kraft", (0.43, 0.235, 0.085, 1.0)),
        ("green", (0.010, 0.072, 0.026, 1.0)),
        ("cream", (0.82, 0.75, 0.59, 1.0)),
        ("paper", (0.64, 0.46, 0.25, 1.0)),
    ):
        material = M[key]
        material.diffuse_color = color
        material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = color
    M["kraft_dark"] = mat("M_KraftDark", (0.255, 0.145, 0.072, 1.0), roughness=0.93)
    M["tape"] = mat("M_tape", (0.66, 0.37, 0.085, 0.79), roughness=0.42)
    tape_bsdf = M["tape"].node_tree.nodes.get("Principled BSDF")
    if tape_bsdf:
        transmission = tape_bsdf.inputs.get("Transmission Weight") or tape_bsdf.inputs.get("Transmission")
        if transmission:
            transmission.default_value = 0.07
        coat = tape_bsdf.inputs.get("Coat Weight") or tape_bsdf.inputs.get("Clearcoat")
        if coat:
            coat.default_value = 0.18
    return M


def root_for(asset_id, dims, reference_id, front):
    return empty(
        asset_id,
        props={
            "asset_id": asset_id,
            "asset_version": BUILD_VERSION,
            "version": BUILD_VERSION,
            "units": "meters",
            "reference_id": reference_id,
            "target_dimensions_m": list(dims),
            "front": front,
            "source": "Original Pinehollow Golf geometry generated in-repository from local reference sheet",
            "license": "Project-owned / UNLICENSED",
            "builder": SCRIPT.relative_to(ROOT).as_posix(),
            "model_map_key": asset_id,
        },
        size=0.055,
    )


def set_helper(obj, helper_kind):
    obj["helper"] = True
    obj["helper_kind"] = helper_kind
    obj.hide_render = True
    return obj


def rear_label_quad(name, width, height, loc, material, parent):
    """Create a +Y-facing label surface with landscape, explicit 0..1 UVs."""
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    verts = [
        (-width / 2, 0, -height / 2),
        (-width / 2, 0, height / 2),
        (width / 2, 0, height / 2),
        (width / 2, 0, -height / 2),
    ]
    mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
    mesh.materials.append(material)
    uv_layer = mesh.uv_layers.new(name="UVMap")
    uvs = ((0, 0), (0, 1), (1, 1), (1, 0))
    for loop in mesh.loops:
        uv_layer.data[loop.index].uv = uvs[loop.vertex_index]
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    parent_keep(obj, parent)
    return obj


def printed_text(name, text, loc, material, *, size, rot=(math.pi / 2, 0, 0), parent=None):
    """Create crisp low-profile carton print without high-cost bevelled type."""
    bpy.ops.object.text_add(location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.data.body = text
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.size = size
    obj.data.resolution_u = 2
    obj.data.extrude = 0.00010
    obj.data.bevel_depth = 0.0
    obj.data.materials.append(material)
    activate(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.name = name
    finish_mesh(obj, material, bevel_width=0.0)
    parent_keep(obj, parent)
    return obj


def wall_panel(name, pivot_name, dims, pivot_loc, panel_loc, root, M, inner_loc, inner_dims, axis):
    pivot = empty(
        pivot_name,
        pivot_loc,
        parent=root,
        size=0.035,
        props={
            "pivot_kind": "bottom_fold",
            "hinge_axis": axis,
            "closed_rotation": [0.0, 0.0, 0.0],
            "flatten_angle_deg": 88,
        },
    )
    panel = box(name, dims, panel_loc, M["kraft"], bevel=0.003, parent=pivot)
    box(f"{name}_INNER", inner_dims, inner_loc, M["kraft_dark"], bevel=0.001, parent=pivot)
    panel["cardboard_thickness_m"] = 0.012
    panel["surface"] = "stylized_corrugated_kraft"
    return pivot, panel


def flap_panel(name, pivot_name, dims, pivot_loc, panel_loc, wall_pivot, M, axis, direction):
    pivot = empty(
        pivot_name,
        pivot_loc,
        parent=wall_pivot,
        size=0.032,
        props={
            "pivot_kind": "top_fold",
            "hinge_axis": axis,
            "closed_rotation": [0.0, 0.0, 0.0],
            "open_angle_deg": 145 * direction,
        },
    )
    panel = box(name, dims, panel_loc, M["kraft"], bevel=0.002, parent=pivot)
    # The interior face is a real inset surface, not a single-sided material trick.
    inner_z = panel_loc[2] - dims[2] * 0.52
    box(
        f"{name}_INNER",
        (dims[0] * 0.965, dims[1] * 0.965, 0.0022),
        (panel_loc[0], panel_loc[1], inner_z),
        M["kraft_dark"],
        bevel=0.0008,
        parent=pivot,
    )
    panel["fold_pivot"] = pivot_name
    return pivot, panel


def build_generic_box(M):
    w, d, h = BOX_DIMS
    t = 0.012
    root = root_for(BOX_ID, BOX_DIMS, 46, "-Y label/player side")
    root["asset_type"] = "shipping_carton"
    root["box_profile"] = "merchbox"
    root["carry_profile"] = "medium_two_hand"
    root["content_capacity"] = 8
    root["recommended_sku"] = "cap1"
    root["reference_dimensions_cm"] = [60, 40, 40]
    root["physical_shell_id"] = BOX_ID
    root["packaging_shell_id"] = "GENERIC_MERCHANDISE"
    root["content_layouts"] = json.dumps(["CAP_NEST8"])
    root["default_content_layout"] = "CAP_NEST8"
    root["content_scale"] = 1.0
    root["allow_scale"] = False

    # Corrugated shell.  The base and every wall remain logically independent.
    box("BOX_BASE", (w - 2 * t, d - 2 * t, t), (0, 0, t / 2), M["kraft_dark"], bevel=0.002, parent=root)
    box("BOX_BASE_FACE", (w - 0.04, d - 0.04, 0.003), (0, 0, t + 0.001), M["kraft"], bevel=0.001, parent=root)

    front_wall, _ = wall_panel(
        "BOX_FRONT", "BOX_WALL_FRONT", (w - 2 * t, t, h - t),
        (0, -d / 2, t), (0, -d / 2 + t / 2, h / 2 + t / 2), root, M,
        (0, -d / 2 + t + 0.001, h / 2 + t / 2), (w - 0.042, 0.003, h - 0.036), "X",
    )
    back_wall, _ = wall_panel(
        "BOX_BACK", "BOX_WALL_BACK", (w - 2 * t, t, h - t),
        (0, d / 2, t), (0, d / 2 - t / 2, h / 2 + t / 2), root, M,
        (0, d / 2 - t - 0.001, h / 2 + t / 2), (w - 0.042, 0.003, h - 0.036), "X",
    )
    left_wall, _ = wall_panel(
        "BOX_LEFT", "BOX_WALL_LEFT", (t, d - 2 * t, h - t),
        (-w / 2, 0, t), (-w / 2 + t / 2, 0, h / 2 + t / 2), root, M,
        (-w / 2 + t + 0.001, 0, h / 2 + t / 2), (0.003, d - 0.042, h - 0.036), "Y",
    )
    right_wall, _ = wall_panel(
        "BOX_RIGHT", "BOX_WALL_RIGHT", (t, d - 2 * t, h - t),
        (w / 2, 0, t), (w / 2 - t / 2, 0, h / 2 + t / 2), root, M,
        (w / 2 - t - 0.001, 0, h / 2 + t / 2), (0.003, d - 0.042, h - 0.036), "Y",
    )

    # Four true RSC flaps.  Each mesh is a direct child of its hinge empty.
    flap_t = 0.008
    flap_panel(
        "FLAP_TOP_FRONT", "BOX_FLAP_FRONT", (w - 0.024, d / 2 - 0.012, flap_t),
        (0, -d / 2, h), (0, -d / 4 - 0.003, h), front_wall, M, "X", 1,
    )
    flap_panel(
        "FLAP_TOP_BACK", "BOX_FLAP_BACK", (w - 0.024, d / 2 - 0.012, flap_t),
        (0, d / 2, h), (0, d / 4 + 0.003, h), back_wall, M, "X", -1,
    )
    flap_panel(
        "FLAP_TOP_LEFT", "BOX_FLAP_LEFT", (w / 2 - 0.014, d - 0.028, flap_t),
        (-w / 2, 0, h - 0.004), (-w / 4 - 0.003, 0, h - 0.004), left_wall, M, "Y", -1,
    )
    flap_panel(
        "FLAP_TOP_RIGHT", "BOX_FLAP_RIGHT", (w / 2 - 0.014, d - 0.028, flap_t),
        (w / 2, 0, h - 0.004), (w / 4 + 0.003, 0, h - 0.004), right_wall, M, "Y", 1,
    )

    # Readable fold scores and corrugated-edge hints remain restrained.
    box("FOLD_SCORE_FRONT", (w - 0.05, 0.0025, 0.005), (0, -d / 2 - 0.001, h - 0.019), M["kraft_dark"], bevel=0.001, parent=front_wall)
    box("FOLD_SCORE_BACK", (w - 0.05, 0.0025, 0.005), (0, d / 2 + 0.001, h - 0.019), M["kraft_dark"], bevel=0.001, parent=back_wall)
    box("CORRUGATED_EDGE_LEFT", (0.003, d - 0.05, 0.005), (-w / 2 + 0.0005, 0, h - 0.019), M["kraft_dark"], bevel=0.001, parent=left_wall)
    box("CORRUGATED_EDGE_RIGHT", (0.003, d - 0.05, 0.005), (w / 2 - 0.0005, 0, h - 0.019), M["kraft_dark"], bevel=0.001, parent=right_wall)

    # Centre-seam packing tape is eight independent cut segments plus the two
    # wall returns.  Runtime can reveal a monotonic cut instead of popping it.
    tape_root = empty(
        "TAPE_CENTER", (0, 0, 0), parent=root, size=0.025,
        props={"tape_path": "centre_seam", "segment_count": 8, "material_slot": "M_tape"},
    )
    span = d * 0.94
    step = span / 8
    for index in range(8):
        segment = box(
            f"TAPE_CENTER_SEG_{index + 1:02d}",
            (0.050, step - 0.0015, 0.0016),
            (0, -span / 2 + (index + 0.5) * step, h + 0.0038),
            M["tape"], bevel=0.0007, parent=tape_root,
            props={
                "cut_order": index + 1,
                "cut_fraction_start": round(index / 8, 3),
                "cut_fraction_end": round((index + 1) / 8, 3),
            },
        )
        segment["tape_state"] = "uncut"
    box("TAPE_SIDE_FRONT", (0.050, 0.0018, 0.100), (0, -d / 2 - 0.001, h - 0.050), M["tape"], bevel=0.0007, parent=tape_root)
    box("TAPE_SIDE_BACK", (0.050, 0.0018, 0.100), (0, d / 2 + 0.001, h - 0.050), M["tape"], bevel=0.0007, parent=tape_root)

    # Original fictional branding: a printed shield, crossed-club shorthand,
    # and the local reference slogan.  No commercial shipping marks are used.
    panel_mesh(
        "LABEL_MAIN",
        [(-0.047, 0.328), (0.047, 0.328), (0.043, 0.258), (0, 0.224), (-0.043, 0.258)],
        0.0014, -d / 2 - 0.001, M["green"], parent=front_wall, bevel=0.0012,
    )
    box("CREST_CLUB_A", (0.007, 0.0017, 0.066), (0, -d / 2 - 0.0012, 0.278), M["cream"], rot=(0, math.radians(42), 0), bevel=0.001, parent=front_wall)
    box("CREST_CLUB_B", (0.007, 0.0017, 0.066), (0, -d / 2 - 0.0012, 0.278), M["cream"], rot=(0, math.radians(-42), 0), bevel=0.001, parent=front_wall)
    printed_text(
        "LABEL_SLOGAN", "PLAY BETTER.\nEVERY DAY.",
        (0.095, -d / 2 - 0.002, 0.116), M["green"],
        size=0.022, rot=(math.pi / 2, 0, 0), parent=front_wall,
    )
    # Handling marks are small geometry-backed print blocks, readable without a
    # texture atlas and cheap enough for the runtime material pipeline.
    for index, x in enumerate((-0.235, -0.175), start=1):
        box(f"HANDLING_ICON_{index:02d}", (0.045, 0.0015, 0.045), (x, -d / 2 - 0.001, 0.055), M["green"], bevel=0.002, parent=front_wall)
        box(f"HANDLING_ICON_INSET_{index:02d}", (0.031, 0.0017, 0.031), (x, -d / 2 - 0.0012, 0.055), M["kraft"], bevel=0.001, parent=front_wall)
    # Keep-dry umbrella in the left frame.
    box("HANDLING_KEEP_DRY_LEFT", (0.019, 0.0015, 0.0032), (-0.243, -d / 2 - 0.0015, 0.063), M["green"], rot=(0, math.radians(-18), 0), bevel=0.0006, parent=front_wall)
    box("HANDLING_KEEP_DRY_RIGHT", (0.019, 0.0015, 0.0032), (-0.227, -d / 2 - 0.0015, 0.063), M["green"], rot=(0, math.radians(18), 0), bevel=0.0006, parent=front_wall)
    box("HANDLING_KEEP_DRY_STEM", (0.0028, 0.0015, 0.021), (-0.235, -d / 2 - 0.0015, 0.052), M["green"], bevel=0.0005, parent=front_wall)
    box("HANDLING_KEEP_DRY_HOOK", (0.010, 0.0015, 0.0028), (-0.231, -d / 2 - 0.0015, 0.042), M["green"], bevel=0.0005, parent=front_wall)
    # Two up arrows in the right frame.
    for arrow_index, x in enumerate((-0.182, -0.168), start=1):
        box(f"HANDLING_UP_SHAFT_{arrow_index:02d}", (0.0028, 0.0015, 0.020), (x, -d / 2 - 0.0015, 0.052), M["green"], bevel=0.0005, parent=front_wall)
        box(f"HANDLING_UP_HEAD_L_{arrow_index:02d}", (0.010, 0.0015, 0.0028), (x - 0.0035, -d / 2 - 0.0015, 0.061), M["green"], rot=(0, math.radians(-40), 0), bevel=0.0005, parent=front_wall)
        box(f"HANDLING_UP_HEAD_R_{arrow_index:02d}", (0.010, 0.0015, 0.0028), (x + 0.0035, -d / 2 - 0.0015, 0.061), M["green"], rot=(0, math.radians(40), 0), bevel=0.0005, parent=front_wall)

    # The runtime paints one 512x320 landscape canvas onto LABEL_DYNAMIC. Keep
    # that surface a single explicit-UV quad on the rear face; the old narrow
    # cuboid stretched the full label into a tiny, quarter-turned strip.
    label_pivot = empty(
        "LABEL_SHIPPING", (0.135, d / 2, 0.180),
        parent=back_wall, size=0.025, props={"label_mount": True, "face": "+Y"},
    )
    box(
        "SHIPPING_LABEL_BACKING", (0.238, 0.0020, 0.150),
        (0.135, d / 2 + 0.0010, 0.180), M["paper"], bevel=0.0008, parent=label_pivot,
    )
    dynamic = rear_label_quad(
        "LABEL_DYNAMIC", 0.232, 0.144,
        (0.135, d / 2 + 0.0022, 0.180), M["paper"], label_pivot,
    )
    dynamic["fields"] = json.dumps(["order_number", "sku", "unit_count", "weight_kg"])
    dynamic["default_unit_count"] = 8

    # Protective bed and one low longitudinal divider define the two physical
    # cap stacks used by CAP_NEST8 without hiding nested crowns from the player.
    box("INSERT_BOTTOM", (w - 0.048, d - 0.048, 0.010), (0, 0, 0.022), M["paper"], bevel=0.002, parent=root)
    box("INSERT_SIDE_LEFT", (0.026, d - 0.060, 0.120), (-w / 2 + 0.031, 0, 0.078), M["paper"], bevel=0.003, parent=root)
    box("INSERT_SIDE_RIGHT", (0.026, d - 0.060, 0.120), (w / 2 - 0.031, 0, 0.078), M["paper"], bevel=0.003, parent=root)
    box("INSERT_DIVIDER_LONG", (0.007, d - 0.074, 0.055), (0, 0, 0.055), M["kraft_dark"], bevel=0.001, parent=root)

    # Pair-consecutive 2x2x2 sockets.  Removing two units at a time clears one
    # full vertical pair, so 8 -> 6 -> 4 -> 2 stays visually tidy.
    slot_index = 1
    columns = [(-0.140, -0.085), (0.140, -0.085), (-0.140, 0.085), (0.140, 0.085)]
    for column_index, (x, y) in enumerate(columns, start=1):
        for layer_index, z in enumerate((0.095, 0.215), start=1):
            anchor(
                f"CONTENT_SLOT_{slot_index:02d}", (x, y, z), parent=root, kind="box_content",
                props={
                    "slot_index": slot_index,
                    "allowed_category": "apparel:cap",
                    "max_w": 0.18,
                    "max_d": 0.16,
                    "max_h": 0.12,
                    "stack_order": layer_index,
                    "stack_column": column_index,
                    "stack_layer": layer_index,
                    "visibility_threshold": round(1.0 - (slot_index - 1) / 7.0, 4),
                    "removal_order": 9 - slot_index,
                },
            )
            slot_index += 1

    # Contract-authoritative CAP_NEST8 layout. The two 215 mm-wide stacks sit
    # side by side, while four full-scale cap crowns nest vertically in each
    # stack. The legacy CONTENT_SLOT_01..08 anchors above remain untouched for
    # pre-layout runtime compatibility; new code selects only this exact root.
    layout_id = "CAP_NEST8"
    allowed_skus = ("cap1",)
    packaging_state = "nested-crowns-with-tissue-form"
    layout_root = empty(
        f"CONTENT_LAYOUT_{layout_id}",
        parent=root,
        size=0.040,
        props={
            "layout_id": layout_id,
            "capacity": 8,
            "allowed_category": "apparel:cap",
            "catalog_category": "apparel",
            "allowed_skus": json.dumps(allowed_skus),
            "packaging_state": packaging_state,
            "physical_shell_id": BOX_ID,
            "packaging_shell_id": "GENERIC_MERCHANDISE",
            "socket_prefix": f"CONTENT_SLOT_{layout_id}_",
            "selection_rule": "exact_sku_category_quantity_dimensions_packaging_state",
            "content_scale": 1.0,
            "allow_scale": False,
        },
    )
    slot_index = 1
    for stack_column, x in enumerate((-0.1125, 0.1125), start=1):
        for stack_layer, z in enumerate((0.075, 0.110, 0.145, 0.180), start=1):
            socket = anchor(
                f"CONTENT_SLOT_{layout_id}_{slot_index:02d}",
                (x, 0.0, z),
                parent=layout_root,
                kind="box_content",
                props={
                    "layout_id": layout_id,
                    "slot_index": slot_index,
                    "allowed_category": "apparel:cap",
                    "catalog_category": "apparel",
                    "allowed_skus": json.dumps(allowed_skus),
                    "packaging_state": packaging_state,
                    "packaging_shell_id": "GENERIC_MERCHANDISE",
                    "max_w": 0.215,
                    "max_d": 0.215,
                    "max_h": 0.075,
                    "display_state": "opened_nested",
                    "stack_order": slot_index,
                    "stack_column": stack_column,
                    "stack_layer": stack_layer,
                    "visibility_threshold": round(1.0 - (slot_index - 1) / 7.0, 4),
                    "visible_when_remaining_at_least": 9 - slot_index,
                    "removal_order": 9 - slot_index,
                    "removal_policy": "highest_removal_order_first",
                    "content_scale": 1.0,
                    "allow_scale": False,
                },
            )
            socket["authored_rotation_rad"] = json.dumps([0.0, 0.0, 0.0])
            slot_index += 1

    # Compact, single-group flatten variant.  Every named panel is a direct
    # child so runtime can replace the live hinged shell deterministically.
    flat = empty(
        "BOX_FLAT_BUNDLE", (0, 0, 0), parent=root, size=0.035,
        props={"runtime_variant": "flattened", "thickness_m": 0.041},
    )
    box("FLAT_PANEL_BASE", (w - 0.020, d - 0.020, 0.009), (0, 0, 0.010), M["kraft_dark"], bevel=0.003, parent=flat)
    box("FLAT_PANEL_BACK", (w - 0.040, d * 0.83, 0.007), (0, 0.012, 0.018), M["kraft"], bevel=0.003, parent=flat)
    box("FLAT_PANEL_FRONT", (w - 0.066, d * 0.77, 0.007), (0, -0.011, 0.025), M["kraft"], bevel=0.003, parent=flat)
    box("FLAT_PANEL_LEFT", (w * 0.42, d - 0.070, 0.006), (-w * 0.18, 0.008, 0.032), M["kraft_dark"], bevel=0.002, parent=flat)
    box("FLAT_PANEL_RIGHT", (w * 0.42, d - 0.070, 0.006), (w * 0.18, -0.006, 0.037), M["kraft"], bevel=0.002, parent=flat)
    box("FLAT_LABEL", (w * 0.22, d * 0.22, 0.003), (w * 0.14, d * 0.06, 0.0415), M["green"], bevel=0.001, parent=flat)

    set_helper(collision_box("COLLISION_CLOSED", (w, d, h), (0, 0, h / 2), M, parent=root), "closed_collision")
    set_helper(collision_box("COLLISION_OPEN", (w, d, h * 0.83), (0, 0, h * 0.415), M, parent=root), "open_collision")
    set_helper(collision_box("VOLUME_CONTENTS", (w - 0.060, d - 0.060, 0.285), (0, 0, 0.166), M, parent=root), "contents_volume")
    anchor("INTERACTION_TARGET", (0, -d * 0.07, h + 0.045), parent=root, kind="box_interaction")
    anchor(
        "CUT_PATH", (0, 0, h + 0.025), parent=root, kind="cut_path",
        props={
            "points": json.dumps([[0, -d * 0.46, h + 0.025], [0, d * 0.46, h + 0.025]]),
            "duration_sec": 1.9,
            "segment_nodes": json.dumps([f"TAPE_CENTER_SEG_{i:02d}" for i in range(1, 9)]),
        },
    )
    return root


def annular_cylinder(name, outer_radius, inner_radius, depth, z_center, material, *, parent=None, segments=64, props=None):
    """Create a watertight, UV-authored hollow cylinder aligned to Blender Z."""
    z0 = z_center - depth / 2
    z1 = z_center + depth / 2
    verts = []
    for index in range(segments):
        angle = 2 * math.pi * index / segments
        c, s = math.cos(angle), math.sin(angle)
        verts.extend([
            (outer_radius * c, outer_radius * s, z0),
            (outer_radius * c, outer_radius * s, z1),
            (inner_radius * c, inner_radius * s, z0),
            (inner_radius * c, inner_radius * s, z1),
        ])
    faces = []
    for index in range(segments):
        nxt = (index + 1) % segments
        a, b = index * 4, nxt * 4
        faces.extend([
            (a, b, b + 1, a + 1),            # outside wall
            (a + 2, a + 3, b + 3, b + 2),    # inside wall
            (a + 1, b + 1, b + 3, a + 3),    # upper annulus
            (a, a + 2, b + 2, b),            # lower annulus
        ])
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish_mesh(obj, material, bevel_width=0.0)
    parent_keep(obj, parent)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def radial_shield(name, angle, radius, z_center, material, parent):
    """Make one shallow shield-shaped print patch on the paper core interior."""
    half_t = 0.00028
    outline = [(-0.0090, 0.0120), (0.0090, 0.0120), (0.0085, -0.0040), (0, -0.0120), (-0.0085, -0.0040)]
    verts = []
    for radial in (-half_t, half_t):
        verts.extend([(radial, tangential, vertical) for tangential, vertical in outline])
    n = len(outline)
    faces = [tuple(range(n)), tuple(range(n, n * 2))[::-1]]
    for index in range(n):
        nxt = (index + 1) % n
        faces.append((index, nxt, n + nxt, n + index))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = (radius * math.cos(angle), radius * math.sin(angle), z_center)
    obj.rotation_euler.z = angle
    finish_mesh(obj, material, bevel_width=0.00035)
    parent_keep(obj, parent)
    obj["print_kind"] = "repeating_pinehollow_crest"
    return obj


def radial_crest_bar(name, angle, radius, z_center, diagonal, material, parent):
    """Add one low-poly diagonal print stroke inside a core shield."""
    long_half = 0.0070
    short_half = 0.0010
    c, s = math.cos(diagonal), math.sin(diagonal)
    u = Vector((c, s))
    v = Vector((-s, c))
    outline = [u * long_half + v * short_half, u * long_half - v * short_half,
               -u * long_half - v * short_half, -u * long_half + v * short_half]
    radial_half = 0.00018
    verts = []
    for radial in (-radial_half, radial_half):
        verts.extend([(radial, point.x, point.y) for point in outline])
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = (radius * math.cos(angle), radius * math.sin(angle), z_center)
    obj.rotation_euler.z = angle
    finish_mesh(obj, material, bevel_width=0.0)
    parent_keep(obj, parent)
    return obj


def loose_tape_ribbon(name, material, parent):
    """Create a short tangential loose end without exceeding the roll envelope."""
    centers = []
    for degrees in (-165, -155, -145, -135):
        angle = math.radians(degrees)
        centers.append(Vector((0.04945 * math.cos(angle), 0.04945 * math.sin(angle))))
    tangent = Vector((math.sqrt(0.5), -math.sqrt(0.5)))
    centers.extend([centers[-1] + tangent * distance for distance in (0.006, 0.014, 0.024)])
    thickness = 0.00046
    z0, z1 = 0.0012, 0.0488
    verts = []
    for index, center in enumerate(centers):
        if index == 0:
            direction = (centers[1] - centers[0]).normalized()
        elif index == len(centers) - 1:
            direction = (centers[-1] - centers[-2]).normalized()
        else:
            direction = (centers[index + 1] - centers[index - 1]).normalized()
        normal = Vector((-direction.y, direction.x)) * (thickness / 2)
        verts.extend([
            (center.x + normal.x, center.y + normal.y, z0),
            (center.x + normal.x, center.y + normal.y, z1),
            (center.x - normal.x, center.y - normal.y, z0),
            (center.x - normal.x, center.y - normal.y, z1),
        ])
    faces = []
    for index in range(len(centers) - 1):
        a, b = index * 4, (index + 1) * 4
        faces.extend([
            (a, b, b + 1, a + 1),
            (a + 2, a + 3, b + 3, b + 2),
            (a + 1, b + 1, b + 3, a + 3),
            (a, a + 2, b + 2, b),
        ])
    faces.extend([(0, 1, 3, 2), (len(verts) - 4, len(verts) - 2, len(verts) - 1, len(verts) - 3)])
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish_mesh(obj, material, bevel_width=0.0)
    parent_keep(obj, parent)
    obj["loose_length_m"] = 0.024
    obj["tearable"] = True
    obj["state"] = "attached"
    return obj


def build_tape_roll(M):
    root = root_for(TAPE_ID, TAPE_DIMS, 50, "runtime roll axis +Z; Blender authoring axis +Y")
    root["asset_type"] = "packing_consumable"
    root["outer_diameter_m"] = 0.10
    root["inner_diameter_m"] = 0.049
    root["width_m"] = 0.05
    root["material_slot"] = "M_tape"
    root["reference_dimensions_cm"] = [10, 10, 5]
    root["runtime_axis"] = "+Z"
    root["blender_authoring_axis"] = "+Y"

    # Geometry is first built in its natural flat QA pose, then this group is
    # rotated +90 degrees around X for export. Blender's Z-up -> glTF Y-up
    # conversion therefore yields a runtime-Z roll axis, matching the model
    # contract and the runtime's X+90 placement rotation.
    axis = empty(
        "TAPE_AXIS_EXPORT", (0, 0, 0), parent=root, size=0.025,
        props={"orientation_helper": True, "runtime_axis": "+Z", "export_rotation_x_deg": 90},
    )

    annular_cylinder(
        "TAPE_WOUND", 0.0500, 0.0292, 0.0500, 0.0250, M["tape"], parent=axis, segments=64,
        props={"wound_layers": 38, "translucent": True, "tape_width_m": 0.05},
    )
    # Four subtle circumferential ridges sell the wound construction without
    # noisy micro-geometry or increasing the stated 10 cm outside diameter.
    for index, z in enumerate((0.0030, 0.0175, 0.0325, 0.0470), start=1):
        torus(
            f"TAPE_LAYER_{index:02d}", 0.04935, 0.00042, (0, 0, z), M["tape"],
            parent=axis,
        )
    annular_cylinder(
        "TAPE_CORE", 0.0290, 0.0245, 0.0480, 0.0250, M["paper"], parent=axis, segments=48,
        props={"material": "printed_paper_core", "core_wall_m": 0.0045},
    )
    for index, degrees in enumerate((0, 90, 180, 270), start=1):
        angle = math.radians(degrees)
        radial_shield(f"CORE_PRINT_{index:02d}", angle, 0.02425, 0.025, M["green"], axis)
        radial_crest_bar(f"CORE_GLYPH_A_{index:02d}", angle, 0.02385, 0.025, math.radians(48), M["cream"], axis)
        radial_crest_bar(f"CORE_GLYPH_B_{index:02d}", angle, 0.02380, 0.025, math.radians(132), M["cream"], axis)
    loose_tape_ribbon("TAPE_LOOSE_END", M["tape"], axis)

    collision = collision_box("COL_PACKING_TAPE", TAPE_DIMS, (0, 0, TAPE_DIMS[2] / 2), M, parent=axis)
    set_helper(collision, "packing_tape_collision")
    anchor(
        "TAPE_GRIP_POINT", (0, -0.018, 0.028), parent=axis, kind="grip",
        props={"grip_axis": "+Z_runtime", "preferred_hand": "right"},
    )
    axis.rotation_euler.x = math.pi / 2
    bpy.context.view_layer.update()
    return root


BOX_REQUIRED = {
    "BOX_BASE",
    *{f"BOX_WALL_{side}" for side in ("FRONT", "BACK", "LEFT", "RIGHT")},
    *{f"BOX_{side}" for side in ("FRONT", "BACK", "LEFT", "RIGHT")},
    *{f"BOX_FLAP_{side}" for side in ("FRONT", "BACK", "LEFT", "RIGHT")},
    *{f"FLAP_TOP_{side}" for side in ("FRONT", "BACK", "LEFT", "RIGHT")},
    "TAPE_CENTER",
    *{f"TAPE_CENTER_SEG_{index:02d}" for index in range(1, 9)},
    "TAPE_SIDE_FRONT", "TAPE_SIDE_BACK",
    "LABEL_MAIN", "LABEL_SHIPPING", "LABEL_DYNAMIC",
    "INSERT_BOTTOM", "INSERT_SIDE_LEFT", "INSERT_SIDE_RIGHT",
    *{f"CONTENT_SLOT_{index:02d}" for index in range(1, 9)},
    "CONTENT_LAYOUT_CAP_NEST8",
    *{f"CONTENT_SLOT_CAP_NEST8_{index:02d}" for index in range(1, 9)},
    "COLLISION_CLOSED", "COLLISION_OPEN", "INTERACTION_TARGET", "CUT_PATH", "VOLUME_CONTENTS",
    "BOX_FLAT_BUNDLE", "FLAT_PANEL_BASE", "FLAT_PANEL_FRONT", "FLAT_PANEL_BACK",
    "FLAT_PANEL_LEFT", "FLAT_PANEL_RIGHT", "FLAT_LABEL",
}
TAPE_REQUIRED = {
    "TAPE_WOUND", "TAPE_CORE", "TAPE_LOOSE_END", "COL_PACKING_TAPE", "TAPE_GRIP_POINT",
    *{f"TAPE_LAYER_{index:02d}" for index in range(1, 5)},
    *{f"CORE_PRINT_{index:02d}" for index in range(1, 5)},
}


def visible_bounds(root):
    corners = []
    bpy.context.view_layer.update()
    for obj in descendants(root):
        if obj.type != "MESH" or obj.name.startswith(("COL_", "COLLISION_", "VOLUME_")):
            continue
        for corner in obj.bound_box:
            corners.append(obj.matrix_world @ Vector(corner))
    if not corners:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    lo = Vector((min(p.x for p in corners), min(p.y for p in corners), min(p.z for p in corners)))
    hi = Vector((max(p.x for p in corners), max(p.y for p in corners), max(p.z for p in corners)))
    return lo, hi


def asset_metrics(root):
    nodes = descendants(root)
    meshes = [obj for obj in nodes if obj.type == "MESH"]
    triangles = 0
    material_names = set()
    for obj in meshes:
        triangles += sum(max(1, len(poly.vertices) - 2) for poly in obj.data.polygons)
        material_names.update(slot.material.name for slot in obj.material_slots if slot.material)
    lo, hi = visible_bounds(root)
    return {
        "nodes": len(nodes),
        "meshes": len(meshes),
        "triangles": triangles,
        "materials": sorted(material_names),
        "visible_bounds_min": [round(v, 5) for v in lo],
        "visible_bounds_max": [round(v, 5) for v in hi],
        "visible_dimensions": [round(v, 5) for v in (hi - lo)],
    }


def exercise_box_pivots():
    checks = []
    definitions = [
        ("BOX_WALL_FRONT", "BOX_FRONT", "X", math.radians(-82)),
        ("BOX_WALL_BACK", "BOX_BACK", "X", math.radians(82)),
        ("BOX_WALL_LEFT", "BOX_LEFT", "Y", math.radians(82)),
        ("BOX_WALL_RIGHT", "BOX_RIGHT", "Y", math.radians(-82)),
        ("BOX_FLAP_FRONT", "FLAP_TOP_FRONT", "X", math.radians(145)),
        ("BOX_FLAP_BACK", "FLAP_TOP_BACK", "X", math.radians(-145)),
        ("BOX_FLAP_LEFT", "FLAP_TOP_LEFT", "Y", math.radians(-145)),
        ("BOX_FLAP_RIGHT", "FLAP_TOP_RIGHT", "Y", math.radians(145)),
    ]
    for pivot_name, child_name, axis, angle in definitions:
        pivot = bpy.data.objects[pivot_name]
        child = bpy.data.objects[child_name]
        if child.parent is not pivot:
            raise RuntimeError(f"{child_name} must be direct child of {pivot_name}")
        original = pivot.rotation_euler.copy()
        bpy.context.view_layer.update()
        before = child.matrix_world.translation.copy()
        if axis == "X":
            pivot.rotation_euler.x = angle
        else:
            pivot.rotation_euler.y = angle
        bpy.context.view_layer.update()
        after = child.matrix_world.translation.copy()
        travel = (after - before).length
        pivot.rotation_euler = original
        bpy.context.view_layer.update()
        if travel < 0.025:
            raise RuntimeError(f"pivot {pivot_name} did not exercise correctly ({travel:.5f} m)")
        checks.append({"pivot": pivot_name, "child": child_name, "travel_m": round(travel, 5), "pass": True})
    return checks


def validate_scene(asset_id, root, required):
    nodes = descendants(root)
    by_name = {obj.name: obj for obj in nodes}
    missing = sorted(required - set(by_name))
    if missing:
        raise RuntimeError(f"{asset_id} missing required nodes: {missing}")
    if root.get("asset_id") != asset_id or root.get("units") != "meters":
        raise RuntimeError(f"{asset_id} root metadata invalid")
    for obj in nodes:
        if obj.type != "MESH":
            continue
        if any(abs(scale - 1.0) > 1e-5 for scale in obj.scale):
            raise RuntimeError(f"{asset_id} unapplied scale: {obj.name} {tuple(obj.scale)}")
        if obj.data.polygons and not obj.data.uv_layers:
            raise RuntimeError(f"{asset_id} missing UVs: {obj.name}")
    if asset_id == BOX_ID:
        for side in ("FRONT", "BACK", "LEFT", "RIGHT"):
            if by_name[f"BOX_{side}"].parent is not by_name[f"BOX_WALL_{side}"]:
                raise RuntimeError(f"BOX_{side} hierarchy invalid")
            if by_name[f"FLAP_TOP_{side}"].parent is not by_name[f"BOX_FLAP_{side}"]:
                raise RuntimeError(f"FLAP_TOP_{side} hierarchy invalid")
        flat = by_name["BOX_FLAT_BUNDLE"]
        for name in ("FLAT_PANEL_BASE", "FLAT_PANEL_FRONT", "FLAT_PANEL_BACK", "FLAT_PANEL_LEFT", "FLAT_PANEL_RIGHT", "FLAT_LABEL"):
            if by_name[name].parent is not flat:
                raise RuntimeError(f"{name} must be direct child of BOX_FLAT_BUNDLE")
        for index in range(1, 9):
            slot = by_name[f"CONTENT_SLOT_{index:02d}"]
            for prop in ("allowed_category", "max_w", "max_d", "max_h", "stack_order", "visibility_threshold", "removal_order"):
                if prop not in slot:
                    raise RuntimeError(f"{slot.name} missing {prop}")
            if max(float(slot["max_w"]), float(slot["max_d"]), float(slot["max_h"])) > 0.18001:
                raise RuntimeError(f"{slot.name} exceeds authored cap bounds")
        layout = by_name["CONTENT_LAYOUT_CAP_NEST8"]
        if layout.parent is not root or int(layout.get("capacity", -1)) != 8:
            raise RuntimeError("CAP_NEST8 layout hierarchy or capacity changed")
        if layout.get("packaging_shell_id") != "GENERIC_MERCHANDISE":
            raise RuntimeError("CAP_NEST8 packaging shell contract changed")
        if tuple(json.loads(layout.get("allowed_skus", "[]"))) != ("cap1",):
            raise RuntimeError("CAP_NEST8 allowed SKU contract changed")
        for index in range(1, 9):
            slot = by_name[f"CONTENT_SLOT_CAP_NEST8_{index:02d}"]
            if slot.parent is not layout:
                raise RuntimeError(f"{slot.name} must be directly under CAP_NEST8")
            for prop in (
                "layout_id", "slot_index", "allowed_category", "catalog_category", "allowed_skus",
                "packaging_state", "packaging_shell_id", "max_w", "max_d", "max_h", "display_state",
                "stack_order", "stack_column", "stack_layer", "visibility_threshold",
                "removal_order", "content_scale", "allow_scale",
            ):
                if prop not in slot:
                    raise RuntimeError(f"{slot.name} missing {prop}")
            authored = tuple(round(float(slot[key]), 6) for key in ("max_w", "max_d", "max_h"))
            if authored != (0.215, 0.215, 0.075):
                raise RuntimeError(f"{slot.name} cap envelope changed: {authored}")
            if slot["packaging_shell_id"] != "GENERIC_MERCHANDISE":
                raise RuntimeError(f"{slot.name} packaging shell contract changed")
            if float(slot["content_scale"]) != 1.0 or bool(slot["allow_scale"]):
                raise RuntimeError(f"{slot.name} must remain authored at 1:1 scale")
        pivot_checks = exercise_box_pivots()
    else:
        pivot_checks = []
    metrics = asset_metrics(root)
    triangle_budget = 12000 if asset_id == BOX_ID else 8000
    if metrics["triangles"] > triangle_budget:
        raise RuntimeError(f"{asset_id} exceeds triangle budget: {metrics['triangles']} > {triangle_budget}")
    if len(metrics["materials"]) > 12:
        raise RuntimeError(f"{asset_id} exceeds material budget: {len(metrics['materials'])}")
    metrics["triangle_budget"] = triangle_budget
    metrics["pivot_checks"] = pivot_checks
    return metrics


def add_build_info(asset_id):
    text = bpy.data.texts.new("BUILD_INFO.txt")
    text.write(
        "Pinehollow Golf delivery references 46 and 50\n"
        f"asset_id: {asset_id}\n"
        f"build_version: {BUILD_VERSION}\n"
        f"builder: {SCRIPT.relative_to(ROOT).as_posix()}\n"
        "units: metres\n"
        "source: original in-repository geometry from local project reference sheet\n"
        "license: project-owned / UNLICENSED\n"
        "external downloads: none\n"
        "legacy carton sources: untouched\n"
        "content layout: CAP_NEST8; authored content scale: 1.0; shrink fallback: forbidden\n"
    )


def save_and_export(asset_id, root, required):
    metrics = validate_scene(asset_id, root, required)
    add_build_info(asset_id)
    blend_path = SOURCE_DIR / f"{asset_id}.blend"
    glb_path = EXPORT_DIR / f"{asset_id}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.object.select_all(action="DESELECT")
    selected = descendants(root)
    for obj in selected:
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
        "reference_id": int(root["reference_id"]),
        "target_dimensions_m": list(root["target_dimensions_m"]),
        "source": str(blend_path),
        "export": str(glb_path),
        "bytes": glb_path.stat().st_size,
        "qa_pass": QA_PASS,
    })
    (QA_DIR / f"{asset_id}_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf8")
    print(f"BUILT|{asset_id}|nodes={metrics['nodes']}|tris={metrics['triangles']}|bytes={metrics['bytes']}")
    return metrics


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def preview_setup():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("QA_World")
    scene.world.color = (0.018, 0.026, 0.021)
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -1.25
    bpy.ops.object.camera_add(location=(1, -1, 0.8))
    camera = bpy.context.object
    camera.name = "QA_Camera"
    camera.data.lens = 56
    scene.camera = camera
    for name, energy, location, size in (
        ("Key", 520, (-0.7, -0.8, 1.35), 1.25),
        ("Fill", 260, (0.9, -0.3, 0.85), 1.05),
        ("Rim", 340, (0.1, 0.9, 1.10), 0.85),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = f"QA_{name}"
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size
        look_at(light, (0, 0, 0.18))
    floor_mat = mat("QA_FloorMaterial", (0.075, 0.105, 0.085, 1), roughness=0.95)
    box("QA_Floor", (2.2, 2.2, 0.025), (0, 0, -0.018), floor_mat, bevel=0.004)
    return camera


def set_box_open(opened):
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
    for obj in descendants(bpy.data.objects["TAPE_CENTER"]):
        obj.hide_render = opened
    bpy.context.view_layer.update()


def render_box_previews(root):
    camera = preview_setup()
    flat_nodes = descendants(bpy.data.objects["BOX_FLAT_BUNDLE"])
    for obj in flat_nodes:
        obj.hide_render = True
    views = [
        ("sealed_three_quarter", (0.86, -1.06, 0.74), (0, 0, 0.20), False),
        ("sealed_front", (0.0, -1.15, 0.42), (0, -0.01, 0.20), False),
        ("open_three_quarter", (0.92, -1.12, 0.91), (0, 0, 0.18), True),
        ("open_interior", (0.42, -0.38, 1.22), (0, 0, 0.13), True),
    ]
    for name, location, target, opened in views:
        set_box_open(opened)
        camera.location = location
        look_at(camera, target)
        bpy.context.scene.render.filepath = str(QA_DIR / f"{BOX_ID}_{name}.png")
        bpy.ops.render.render(write_still=True)
    set_box_open(False)
    for obj in flat_nodes:
        obj.hide_render = False
    # Flat-bundle proof: hide the live architecture and leave only the authored
    # compact replacement plus helpers (which are already non-rendering).
    flat_names = {obj.name for obj in flat_nodes}
    hidden = []
    for obj in descendants(root):
        if obj.type == "MESH" and obj.name not in flat_names and not obj.name.startswith(("COL_", "COLLISION_", "VOLUME_")):
            hidden.append((obj, obj.hide_render))
            obj.hide_render = True
    camera.location = (0.70, -0.82, 0.64)
    look_at(camera, (0, 0, 0.02))
    bpy.context.scene.render.filepath = str(QA_DIR / f"{BOX_ID}_flat_bundle.png")
    bpy.ops.render.render(write_still=True)
    for obj, was_hidden in hidden:
        obj.hide_render = was_hidden
    for obj in [candidate for candidate in list(bpy.data.objects) if candidate.name.startswith("QA_")]:
        bpy.data.objects.remove(obj, do_unlink=True)


def render_tape_previews():
    axis = bpy.data.objects["TAPE_AXIS_EXPORT"]
    export_rotation = axis.rotation_euler.copy()
    axis.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()
    camera = preview_setup()
    views = [
        ("three_quarter", (0.18, -0.22, 0.16), (0, 0, 0.025)),
        ("front", (0, -0.25, 0.055), (0, 0, 0.025)),
        ("top", (0.055, -0.090, 0.255), (0, 0, 0.025)),
    ]
    for name, location, target in views:
        camera.location = location
        look_at(camera, target)
        bpy.context.scene.render.filepath = str(QA_DIR / f"{TAPE_ID}_{name}.png")
        bpy.ops.render.render(write_still=True)
    for obj in [candidate for candidate in list(bpy.data.objects) if candidate.name.startswith("QA_")]:
        bpy.data.objects.remove(obj, do_unlink=True)
    axis.rotation_euler = export_rotation
    bpy.context.view_layer.update()


def clean_reimport_validate(asset_id, required):
    reset_scene()
    glb_path = EXPORT_DIR / f"{asset_id}.glb"
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    names = {obj.name for obj in bpy.context.scene.objects}
    missing = sorted(required - names)
    if missing:
        raise RuntimeError(f"clean re-import {asset_id} missing: {missing}")
    root = bpy.data.objects.get(asset_id)
    if root is None:
        raise RuntimeError(f"clean re-import {asset_id} lost root")
    if root.get("asset_id") != asset_id or int(root.get("reference_id", -1)) not in (46, 50):
        raise RuntimeError(f"clean re-import {asset_id} lost root extras")
    metrics = asset_metrics(root)
    report = {
        "asset_id": asset_id,
        "glb": str(glb_path),
        "root_metadata_preserved": True,
        "required_nodes_preserved": True,
        "nodes": metrics["nodes"],
        "meshes": metrics["meshes"],
        "triangles": metrics["triangles"],
        "materials": metrics["materials"],
        "visible_dimensions": metrics["visible_dimensions"],
    }
    (QA_DIR / f"{asset_id}_reimport.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(f"REIMPORT_OK|{asset_id}|nodes={metrics['nodes']}|tris={metrics['triangles']}|dims={metrics['visible_dimensions']}")
    return report


def build_one(asset_id):
    reset_scene()
    bpy.context.scene["asset_build_script"] = SCRIPT.relative_to(ROOT).as_posix()
    bpy.context.scene["asset_build_version"] = BUILD_VERSION
    M = delivery_materials()
    if asset_id == BOX_ID:
        root = build_generic_box(M)
        required = BOX_REQUIRED
    else:
        root = build_tape_roll(M)
        required = TAPE_REQUIRED
    metrics = save_and_export(asset_id, root, required)
    if asset_id == BOX_ID:
        render_box_previews(root)
    else:
        render_tape_previews()
    return metrics, required


def main():
    target = os.environ.get("DELIVERY_ASSET_TARGET", "").strip()
    asset_ids = (BOX_ID, TAPE_ID) if not target else (target,)
    unknown = [asset_id for asset_id in asset_ids if asset_id not in (BOX_ID, TAPE_ID)]
    if unknown:
        raise RuntimeError(f"unknown DELIVERY_ASSET_TARGET: {unknown[0]}")
    built = []
    requirements = {}
    for asset_id in asset_ids:
        metrics, required = build_one(asset_id)
        built.append(metrics)
        requirements[asset_id] = required
    reimports = [clean_reimport_validate(asset_id, requirements[asset_id]) for asset_id in asset_ids]
    report = {
        "builder": SCRIPT.relative_to(ROOT).as_posix(),
        "build_version": BUILD_VERSION,
        "qa_pass": QA_PASS,
        "asset_target": target or "all",
        "reference_sheet": "Designs/RefrenceImages/41-50_refrence_images/ChatGPT Image Jul 17, 2026, 11_45_44 AM.png",
        "external_assets": [],
        "legacy_sources_modified": False,
        "assets": built,
        "reimports": reimports,
    }
    (QA_DIR / "delivery_generic_and_tape_build_report.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(f"COMPLETE|assets={len(built)}|qa_pass={QA_PASS}|source_dir={SOURCE_DIR}|export_dir={EXPORT_DIR}")


if __name__ == "__main__":
    main()
