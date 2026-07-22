"""Build the Pinehollow delivery hero carton, cutter, and recycling station.

Run from the repository root with Blender 5.1:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
      --background --factory-startup --python tools/blender/build_delivery_hero.py

All geometry is original, deterministic, project-owned work. Dimensions are
metres. Blender Z is up; the glTF exporter converts to a Y-up runtime scene.
The source .blend files remain editable and the GLBs retain named pivots,
sockets, collision helpers and interaction anchors through glTF extras.
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
    cylinder,
    descendants,
    empty,
    finish_mesh,
    mat,
    materials,
    parent_keep,
    reset_scene,
    text_mesh,
)


SOURCE_DIR = ROOT / "asset_sources" / "blender" / "delivery"
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
QA_ROOT = ROOT / "qa" / "box_system_master" / "hero_apparel" / "blender"
QA_PASS = os.environ.get("DELIVERY_HERO_QA_PASS", "").strip()
QA_DIR = QA_ROOT / QA_PASS if QA_PASS else QA_ROOT
SOURCE_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
QA_DIR.mkdir(parents=True, exist_ok=True)

BUILD_VERSION = 4
BOX_ID = "delivery_apparel_box"
CUTTER_ID = "delivery_box_cutter"
RECYCLING_ID = "delivery_recycling_station"
BOX_DIMS = (0.60, 0.40, 0.35)  # width X, depth Y, height Z
CUTTER_DIMS = (0.04, 0.16, 0.022)
RECYCLING_DIMS = (0.78, 0.62, 0.96)


def delivery_materials():
    M = materials()
    M["kraft_dark"] = mat("M_KraftDark", (0.25, 0.145, 0.075, 1), roughness=0.92)
    M["tape"] = mat("M_tape", (0.82, 0.59, 0.25, 0.82), roughness=0.66)
    M["label_cream"] = mat("M_Paper", (0.92, 0.86, 0.72, 1), roughness=0.90)
    M["blade"] = mat("M_Steel", (0.70, 0.73, 0.75, 1), roughness=0.22, metallic=0.92)
    # Sheet-05 #49 calls for a yellow/black body. The cutter shipped in brass,
    # which read as a gold tool rather than the safety-yellow utility knife the
    # reference shows. Same hue family as the pallet jack's safety yellow so the
    # two receiving-bay tools agree.
    M["cutter_yellow"] = mat("M_CutterSafetyYellow", (0.78, 0.62, 0.06, 1), roughness=0.42)
    return M


def root_for(asset_id, dims, front):
    root = empty(
        asset_id,
        props={
            "asset_id": asset_id,
            "asset_version": BUILD_VERSION,
            "units": "meters",
            "target_dimensions_m": list(dims),
            "front": front,
            "source": "Original Pinehollow Golf geometry generated in-repository",
            "license": "Project-owned / UNLICENSED",
            "builder": SCRIPT.relative_to(ROOT).as_posix(),
        },
        size=0.055,
    )
    return root


def set_helper(obj, kind):
    obj["helper"] = True
    obj["helper_kind"] = kind
    obj.hide_render = True
    return obj


def front_label_quad(name, width, height, loc, material, parent):
    """Create a -Y-facing shipping-label surface with explicit 0..1 UVs."""
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
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    parent_keep(obj, parent)
    return obj


def wall_panel(name, pivot_name, dims, pivot_loc, panel_loc, root, M, inner_loc, inner_dims):
    pivot_props = {
        "pivot_kind": "bottom_fold",
        "closed_rotation": [0, 0, 0],
        "flatten_angle_deg": 90,
    }
    if pivot_name == "BOX_WALL_FRONT":
        pivot_props.update({
            "hinge_axis": "X",
            "open_reveal_angle_deg": 82,
            "reveal_contents": True,
        })
    pivot = empty(
        pivot_name,
        pivot_loc,
        parent=root,
        size=0.035,
        props=pivot_props,
    )
    panel = box(name, dims, panel_loc, M["kraft"], bevel=0.003, parent=pivot)
    box(f"{name}_INNER", inner_dims, inner_loc, M["kraft_dark"], bevel=0.001, parent=pivot)
    return pivot, panel


def flap_panel(name, pivot_name, dims, pivot_loc, panel_loc, root, M):
    pivot = empty(
        pivot_name,
        pivot_loc,
        parent=root,
        size=0.032,
        props={"pivot_kind": "top_fold", "closed_rotation": [0, 0, 0], "open_angle_deg": 122},
    )
    panel = box(name, dims, panel_loc, M["kraft_dark"], bevel=0.002, parent=pivot)
    # A slim kraft rim keeps the flap edge readable under warm stockroom light.
    rim_dims = (dims[0] * 0.94, dims[1] * 0.94, 0.002)
    box(f"{name}_FACE", rim_dims, (panel_loc[0], panel_loc[1], panel_loc[2] + 0.005), M["kraft"], bevel=0.001, parent=pivot)
    return pivot, panel


def build_apparel_box(M):
    w, d, h = BOX_DIMS
    t = 0.012
    root = root_for(BOX_ID, BOX_DIMS, "-Y label/player side")
    root["box_profile"] = "medium_apparel"
    root["carry_profile"] = "medium_two_hand"
    root["content_capacity"] = 8
    root["version"] = BUILD_VERSION
    root["physical_shell_id"] = BOX_ID
    root["packaging_shell_id"] = "APPAREL_CARTON"
    root["content_layouts"] = json.dumps(["APPAREL8", "FLAT8"])
    root["default_content_layout"] = "APPAREL8"
    root["content_scale"] = 1.0
    root["allow_scale"] = False

    # Floor and reinforced corner pads. There is deliberately no top cap.
    box("BOX_BASE", (w - 2 * t, d - 2 * t, t), (0, 0, t / 2), M["kraft_dark"], bevel=0.002, parent=root)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(
                f"CORNER_PAD_{'R' if sx > 0 else 'L'}_{'B' if sy > 0 else 'F'}",
                (0.045, 0.045, 0.018),
                (sx * (w / 2 - 0.032), sy * (d / 2 - 0.032), 0.015),
                M["kraft_dark"],
                bevel=0.004,
                parent=root,
            )

    front_wall, _ = wall_panel(
        "BOX_FRONT", "BOX_WALL_FRONT", (w - 2 * t, t, h - t),
        (0, -d / 2, t), (0, -d / 2 + t / 2, h / 2 + t / 2), root, M,
        (0, -d / 2 + t + 0.001, h / 2 + t / 2), (w - 0.04, 0.003, h - 0.035),
    )
    back_wall, _ = wall_panel(
        "BOX_BACK", "BOX_WALL_BACK", (w - 2 * t, t, h - t),
        (0, d / 2, t), (0, d / 2 - t / 2, h / 2 + t / 2), root, M,
        (0, d / 2 - t - 0.001, h / 2 + t / 2), (w - 0.04, 0.003, h - 0.035),
    )
    left_wall, _ = wall_panel(
        "BOX_LEFT", "BOX_WALL_LEFT", (t, d - 2 * t, h - t),
        (-w / 2, 0, t), (-w / 2 + t / 2, 0, h / 2 + t / 2), root, M,
        (-w / 2 + t + 0.001, 0, h / 2 + t / 2), (0.003, d - 0.04, h - 0.035),
    )
    right_wall, _ = wall_panel(
        "BOX_RIGHT", "BOX_WALL_RIGHT", (t, d - 2 * t, h - t),
        (w / 2, 0, t), (w / 2 - t / 2, 0, h / 2 + t / 2), root, M,
        (w / 2 - t - 0.001, 0, h / 2 + t / 2), (0.003, d - 0.04, h - 0.035),
    )

    # Four true RSC flaps, hinged on the upper fold lines. Long front/back
    # flaps meet at the centre seam; the side pair sits underneath.
    flap_t = 0.008
    front_flap, _ = flap_panel(
        "FLAP_TOP_FRONT", "BOX_FLAP_FRONT", (w - 0.024, d / 2 - 0.012, flap_t),
        (0, -d / 2, h), (0, -d / 4 - 0.003, h), front_wall, M,
    )
    back_flap, _ = flap_panel(
        "FLAP_TOP_BACK", "BOX_FLAP_BACK", (w - 0.024, d / 2 - 0.012, flap_t),
        (0, d / 2, h), (0, d / 4 + 0.003, h), back_wall, M,
    )
    left_flap, _ = flap_panel(
        "FLAP_TOP_LEFT", "BOX_FLAP_LEFT", (w / 2 - 0.014, d - 0.028, flap_t),
        (-w / 2, 0, h - 0.004), (-w / 4 - 0.003, 0, h - 0.004), left_wall, M,
    )
    right_flap, _ = flap_panel(
        "FLAP_TOP_RIGHT", "BOX_FLAP_RIGHT", (w / 2 - 0.014, d - 0.028, flap_t),
        (w / 2, 0, h - 0.004), (w / 4 + 0.003, 0, h - 0.004), right_wall, M,
    )

    # Segmented top tape. Runtime hides these pieces monotonically along the
    # authored centre + cross-seam cut path and raises the peeled strips.
    tape_root = empty("TAPE_CENTER", (0, 0, h + 0.009), parent=root, size=0.025, props={"tape_path": "centre_then_cross"})
    centre_span = d * 0.84
    centre_step = centre_span / 6
    for index in range(6):
        name = (
            "TAPE_SEG_RIGHT" if index == 0 else
            "TAPE_SEG_LEFT" if index == 5 else
            f"TAPE_CENTER_SEG_{index + 1:02d}"
        )
        y = d * 0.42 - (index + 0.5) * centre_step
        segment = box(
            name, (0.052, centre_step - 0.004, 0.009),
            (0, y, h + 0.009), M["tape"], bevel=0.0015, parent=tape_root,
        )
        segment["cut_order"] = index + 1
    cross_span = w * 0.84
    cross_step = cross_span / 4
    cross_pieces = [
        ("TAPE_CROSS_LEFT_INNER", -0.5 * cross_step, 7),
        ("TAPE_SIDE_LEFT", -1.5 * cross_step, 8),
        ("TAPE_CROSS_RIGHT_INNER", 0.5 * cross_step, 9),
        ("TAPE_SIDE_RIGHT", 1.5 * cross_step, 10),
    ]
    for name, x, order in cross_pieces:
        segment = box(
            name, (cross_step - 0.006, 0.045, 0.010),
            (x, -d * 0.42, h + 0.011), M["tape"], bevel=0.0015, parent=tape_root,
        )
        segment["cut_order"] = order
    box("TAPE_PEELED_LEFT", (0.022, d * 0.42, 0.006), (-0.018, -d * 0.22, h + 0.018), M["tape"], bevel=0.001, parent=front_flap)
    box("TAPE_PEELED_RIGHT", (0.022, d * 0.42, 0.006), (0.018, d * 0.22, h + 0.018), M["tape"], bevel=0.001, parent=back_flap)

    # Pinehollow apparel band and deterministic runtime label mount. The
    # Imagegen concept is a reference only; no generated raster is baked here.
    label_pivot = empty("LABEL_SHIPPING", (0, -d / 2 - 0.008, 0.18), parent=front_wall, size=0.025, props={"label_mount": True})
    box("LABEL_MAIN", (w * 0.86, 0.004, 0.082), (0, -d / 2 - 0.008, 0.205), M["green"], bevel=0.003, parent=label_pivot)
    box("SHIPPING_LABEL_BACKING", (0.238, 0.0045, 0.150), (0.135, -d / 2 - 0.011, 0.108), M["label_cream"], bevel=0.003, parent=label_pivot)
    front_label_quad(
        "LABEL_DYNAMIC", 0.232, 0.144,
        (0.135, -d / 2 - 0.014, 0.108), M["label_cream"], label_pivot,
    )
    text_mesh("APPAREL_MARK", "APPAREL", (-0.085, -d / 2 - 0.012, 0.202), M["cream"], size=0.030, rot=(math.pi / 2, 0, 0), parent=label_pivot)
    # Small side identity panel stays readable when cartons are stacked label-out.
    box("SIDE_APPAREL_BAND", (0.004, d * 0.56, 0.075), (-w / 2 - 0.007, 0, 0.205), M["green"], bevel=0.002, parent=left_wall)

    # Interior inserts and tissue form a believable product bed. Sockets are
    # empties; runtime attaches the actual catalog folded-polo GLBs once.
    # Low layout-neutral scores divide the tissue bed without intersecting the
    # full-scale garment/socket envelopes that begin 52 mm above the floor.
    box("DIVIDER_LONG", (0.008, d - 0.055, 0.024), (0, 0, 0.038), M["paper"], bevel=0.001, parent=root)
    box("DIVIDER_CROSS", (w - 0.065, 0.008, 0.024), (0, 0, 0.038), M["paper"], bevel=0.001, parent=root)
    box("TISSUE_BASE", (w - 0.045, d - 0.045, 0.006), (0, 0, 0.021), M["paper"], bevel=0.002, parent=root)
    for side, x in enumerate((-0.248, 0.248), start=1):
        tissue = box(
            f"TISSUE_SIDE_{side:02d}", (0.072, d - 0.090, 0.070),
            (x, 0, 0.056), M["paper"], bevel=0.008, parent=root,
        )
        tissue.rotation_euler.y = math.radians(-8 if x < 0 else 8)
    # Eight readable presentation sockets, authored as four two-garment stacks.
    # Pair-consecutive ordering lets runtime recenter the remaining stacks after
    # every armful while still showing the honest 8 -> 6 -> 4 -> 2 depletion.
    slot_index = 1
    for x in (-0.198, -0.066, 0.066, 0.198):
        for y, z in ((-0.014, 0.142), (0.014, 0.178)):
            anchor(
                f"CONTENT_SLOT_{slot_index:02d}", (x, y, z), parent=root,
                kind="box_content", props={"slot_index": slot_index, "sku_family": "folded_apparel"},
            )
            slot_index += 1

    # Exact, layout-aware sockets coexist with the legacy short names above.
    # APPAREL8 uses two honest full-width stacks with four compressed soft-good
    # layers apiece. FLAT8 uses a roomy 2 x 2 x 2 grid for banded sock pairs.
    def add_content_layout(layout_id, category, allowed_skus, packaging_state, definitions):
        layout_root = empty(
            f"CONTENT_LAYOUT_{layout_id}",
            parent=root,
            size=0.040,
            props={
                "layout_id": layout_id,
                "capacity": len(definitions),
                "allowed_category": category,
                "catalog_category": "apparel",
                "allowed_skus": json.dumps(allowed_skus),
                "packaging_state": packaging_state,
                "physical_shell_id": BOX_ID,
                "packaging_shell_id": "APPAREL_CARTON",
                "socket_prefix": f"CONTENT_SLOT_{layout_id}_",
                "selection_rule": "exact_sku_category_quantity_dimensions_packaging_state",
                "content_scale": 1.0,
                "allow_scale": False,
            },
        )
        capacity = len(definitions)
        for index, definition in enumerate(definitions, start=1):
            position, stack_column, stack_layer, max_dims = definition
            max_w, max_d, max_h = max_dims
            socket = anchor(
                f"CONTENT_SLOT_{layout_id}_{index:02d}",
                position,
                parent=layout_root,
                kind="box_content",
                props={
                    "layout_id": layout_id,
                    "slot_index": index,
                    "allowed_category": category,
                    "catalog_category": "apparel",
                    "allowed_skus": json.dumps(allowed_skus),
                    "packaging_state": packaging_state,
                    "packaging_shell_id": "APPAREL_CARTON",
                    "max_w": max_w,
                    "max_d": max_d,
                    "max_h": max_h,
                    "display_state": "opened_face_out",
                    "stack_order": index,
                    "stack_column": stack_column,
                    "stack_layer": stack_layer,
                    "visibility_threshold": round(1.0 - (index - 1) / max(1, capacity - 1), 4),
                    "visible_when_remaining_at_least": capacity - index + 1,
                    "removal_order": capacity - index + 1,
                    "removal_policy": "highest_removal_order_first",
                    "content_scale": 1.0,
                    "allow_scale": False,
                },
            )
            socket["authored_rotation_rad"] = json.dumps([0.0, 0.0, 0.0])

    apparel_definitions = []
    for stack_column, x in enumerate((-0.120, 0.120), start=1):
        for stack_layer, z in enumerate((0.102, 0.158, 0.214, 0.270), start=1):
            apparel_definitions.append(((x, 0.0, z), stack_column, stack_layer, (0.220, 0.190, 0.100)))
    add_content_layout(
        "APPAREL8",
        "apparel",
        ("polo1", "polo2", "jacket2", "pants2", "shorts1"),
        "folded-with-tissue-and-size-tag",
        apparel_definitions,
    )

    flat_definitions = []
    stack_column = 0
    for y in (-0.082, 0.082):
        for x in (-0.105, 0.105):
            stack_column += 1
            for stack_layer, z in enumerate((0.092, 0.177), start=1):
                flat_definitions.append(((x, y, z), stack_column, stack_layer, (0.180, 0.150, 0.080)))
    add_content_layout(
        "FLAT8",
        "apparel",
        ("sock1",),
        "banded-folded-pair",
        flat_definitions,
    )

    # A compact authored end-state avoids the four hinged walls fighting for
    # the same plane once the carton is fully broken down. Runtime reveals this
    # thin layered bundle only in the latter half of the flatten animation.
    flat = empty(
        "BOX_FLAT_BUNDLE", (0, 0, 0), parent=root, size=0.035,
        props={"runtime_variant": "flattened", "thickness_m": 0.034},
    )
    box("FLAT_PANEL_BASE", (w - 0.018, d - 0.018, 0.009), (0, 0, 0.010), M["kraft_dark"], bevel=0.003, parent=flat)
    box("FLAT_PANEL_BACK", (w - 0.038, d * 0.80, 0.007), (0, 0.012, 0.018), M["kraft"], bevel=0.003, parent=flat)
    box("FLAT_PANEL_FRONT", (w - 0.070, d * 0.72, 0.007), (0, -0.010, 0.026), M["kraft"], bevel=0.003, parent=flat)
    box("FLAT_FOLD_LEFT", (w * 0.38, d - 0.070, 0.005), (-w * 0.20, 0.005, 0.031), M["kraft_dark"], bevel=0.002, parent=flat)
    box("FLAT_FOLD_RIGHT", (w * 0.38, d - 0.070, 0.005), (w * 0.20, -0.005, 0.034), M["kraft"], bevel=0.002, parent=flat)
    box("FLAT_BRAND_BAND", (w * 0.70, d * 0.14, 0.003), (0, -d * 0.10, 0.038), M["green"], bevel=0.0015, parent=flat)
    box("FLAT_LABEL", (w * 0.25, d * 0.20, 0.003), (w * 0.16, d * 0.08, 0.039), M["label_cream"], bevel=0.0015, parent=flat)

    collision_box("COL_BOX_CLOSED", (w, d, h), (0, 0, h / 2), M, parent=root)
    collision_box("COL_BOX_OPEN", (w, d, h * 0.82), (0, 0, h * 0.41), M, parent=root)
    set_helper(collision_box("COLLISION_CLOSED", (w, d, h), (0, 0, h / 2), M, parent=root), "closed_collision")
    set_helper(collision_box("COLLISION_OPEN", (w, d, h * 0.82), (0, 0, h * 0.41), M, parent=root), "open_collision")
    set_helper(collision_box("VOLUME_CONTENTS", (w - 0.05, d - 0.05, 0.21), (0, 0, 0.125), M, parent=root), "contents_volume")
    anchor("INTERACTION_TARGET", (0, -d * 0.08, h + 0.045), parent=root, kind="box_interaction")
    anchor(
        "CUT_PATH", (0, 0, h + 0.025), parent=root, kind="cut_path",
        props={
            "points": json.dumps([
                [0, d * 0.42, h + 0.025], [0, -d * 0.42, h + 0.025],
                [-w * 0.42, -d * 0.42, h + 0.025], [w * 0.42, -d * 0.42, h + 0.025],
            ]),
            "segment_nodes": json.dumps([
                "TAPE_SEG_RIGHT",
                *[f"TAPE_CENTER_SEG_{index:02d}" for index in range(2, 6)],
                "TAPE_SEG_LEFT",
                "TAPE_CROSS_LEFT_INNER", "TAPE_SIDE_LEFT",
                "TAPE_CROSS_RIGHT_INNER", "TAPE_SIDE_RIGHT",
            ]),
            "duration_sec": 2.0,
        },
    )
    return root


def blade_wedge(name, loc, material, parent):
    # Slim trapezoidal utility blade: X width, Y length, Z height.
    x0, x1 = -0.0008, 0.0008
    y0, y1 = -0.0175, 0.0175
    z0, z1 = -0.007, 0.007
    verts = [
        (x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0 + 0.010, z1),
        (x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0 + 0.010, z1),
    ]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    finish_mesh(obj, material, bevel_width=0.0004)
    parent_keep(obj, parent)
    return obj


def build_cutter(M):
    root = root_for(CUTTER_ID, CUTTER_DIMS, "long axis Blender +Y / runtime -Z")
    root["tool_profile"] = "retractable_utility_knife"
    root["blade_pose"] = "retracted"
    root["blade_extension_m"] = 0.016
    root["slider_extension_m"] = 0.012

    # Tapered silhouette is built from overlapping bevelled shells, but every
    # operational component remains separately named and transformable.
    body = box("CUTTER_BODY", (0.038, 0.140, 0.018), (0, 0.070, 0.010), M["cutter_yellow"], bevel=0.005, parent=root)
    body["grip_axis"] = "+Y"
    box("CUTTER_RUBBER_GRIP", (0.040, 0.065, 0.020), (0, 0.035, 0.0105), M["rubber"], bevel=0.005, parent=root)
    box("CUTTER_CHANNEL", (0.012, 0.118, 0.003), (0, 0.085, 0.0195), M["charcoal"], bevel=0.001, parent=root)
    slider = box("CUTTER_SLIDER", (0.018, 0.026, 0.005), (0, 0.073, 0.020), M["charcoal"], bevel=0.002, parent=root)
    slider["pose_retracted_blender_y"] = 0.073
    slider["pose_extended_blender_y"] = 0.085
    blade = blade_wedge("CUTTER_BLADE", (0, 0.1425, 0.012), M["blade"], root)
    blade["pose_retracted_blender_y"] = 0.1425
    blade["pose_extended_blender_y"] = 0.1585
    box("CUTTER_SAFETY_STOP", (0.035, 0.015, 0.020), (0, 0.1525, 0.0105), M["charcoal"], bevel=0.0025, parent=root)
    cylinder("CUTTER_SCREW", 0.0045, 0.0025, (0.013, 0.108, 0.019), M["steel"], rot=(0, math.pi / 2, 0), vertices=16, bevel=0.0008, parent=root)
    for index, y in enumerate((0.017, 0.032, 0.047, 0.062), start=1):
        box(f"CUTTER_GRIP_RIDGE_{index:02d}", (0.040, 0.004, 0.003), (0, y, 0.0185), M["charcoal"], bevel=0.0008, parent=root)

    anchor("CUTTER_GRIP_POINT", (0, 0.052, 0.007), parent=root, kind="tool_grip", props={"hand": "right"})
    anchor("CUTTER_POSE_RETRACTED", (0, 0.160, 0.012), parent=root, kind="blade_pose")
    anchor("CUTTER_POSE_EXTENDED", (0, 0.176, 0.012), parent=root, kind="blade_pose")
    anchor("BLADE_CONTACT", (0, 0.176, 0.012), parent=root, kind="blade_contact")
    collision_box("COL_CUTTER", (0.040, 0.160, 0.022), (0, 0.080, 0.011), M, parent=root)
    return root


def build_recycling_station(M):
    """Open-front cardboard station with a legible player-facing identity."""
    w, d, h = RECYCLING_DIMS
    root = root_for(RECYCLING_ID, RECYCLING_DIMS, "-Y player side")
    root["station_profile"] = "cardboard_recycling"
    root["accepts"] = "flattened_delivery_carton"

    # A deep-green rolling cage: tall enough to discover in first person, open
    # enough that the carried bundle can visibly descend into it.
    box("RECYCLE_FLOOR", (w - 0.08, d - 0.08, 0.055), (0, 0.015, 0.105), M["charcoal"], bevel=0.018, parent=root)
    box("RECYCLE_BACK", (w - 0.06, 0.055, h - 0.12), (0, d / 2 - 0.040, h / 2), M["green"], bevel=0.018, parent=root)
    box("RECYCLE_LEFT", (0.055, d - 0.06, h - 0.18), (-w / 2 + 0.040, 0.015, h / 2 - 0.01), M["green"], bevel=0.018, parent=root)
    box("RECYCLE_RIGHT", (0.055, d - 0.06, h - 0.18), (w / 2 - 0.040, 0.015, h / 2 - 0.01), M["green"], bevel=0.018, parent=root)
    box("RECYCLE_FRONT_LOW", (w - 0.06, 0.055, 0.42), (0, -d / 2 + 0.040, 0.31), M["sage"], bevel=0.018, parent=root)
    box("RECYCLE_TOP_RAIL_BACK", (w, 0.075, 0.075), (0, d / 2 - 0.035, h - 0.035), M["brass"], bevel=0.018, parent=root)
    box("RECYCLE_TOP_RAIL_LEFT", (0.075, d - 0.06, 0.075), (-w / 2 + 0.035, 0, h - 0.035), M["brass"], bevel=0.018, parent=root)
    box("RECYCLE_TOP_RAIL_RIGHT", (0.075, d - 0.06, 0.075), (w / 2 - 0.035, 0, h - 0.035), M["brass"], bevel=0.018, parent=root)
    box("RECYCLE_FRONT_LIP", (w, 0.085, 0.095), (0, -d / 2 + 0.030, 0.695), M["brass"], bevel=0.020, parent=root)

    # Cream panel and simple original mark stay readable at gameplay distance.
    box("RECYCLE_LABEL_PANEL", (w * 0.72, 0.010, 0.245), (0, -d / 2 - 0.002, 0.315), M["label_cream"], bevel=0.010, parent=root)
    box("RECYCLE_LABEL_BAND", (w * 0.62, 0.014, 0.055), (0, -d / 2 - 0.010, 0.382), M["green"], bevel=0.006, parent=root)
    text_mesh(
        "RECYCLE_TEXT", "CARDBOARD", (0, -d / 2 - 0.018, 0.322), M["green"],
        size=0.075, rot=(math.pi / 2, 0, 0), parent=root,
    )
    # Three restrained brass chevrons imply the recycling loop without using a
    # downloaded logo or texture.
    for index, x in enumerate((-0.115, 0, 0.115), start=1):
        mark = box(
            f"RECYCLE_CHEVRON_{index:02d}", (0.075, 0.016, 0.025),
            (x, -d / 2 - 0.020, 0.205), M["brass"], bevel=0.006, parent=root,
        )
        mark.rotation_euler.y = math.radians((-22, 22, -22)[index - 1])

    for index, x in enumerate((-w * 0.31, w * 0.31), start=1):
        wheel = cylinder(
            f"RECYCLE_WHEEL_{index:02d}", 0.062, 0.052,
            (x, 0.12, 0.060), M["rubber"], rot=(0, math.pi / 2, 0),
            vertices=14, bevel=0.004, parent=root,
        )
        wheel["moving_component"] = True

    collision_box("COL_RECYCLING_STATION", RECYCLING_DIMS, (0, 0, h / 2), M, parent=root)
    set_helper(collision_box("VOLUME_RECYCLE_DROP", (w - 0.16, d - 0.16, 0.34), (0, 0.02, 0.76), M, parent=root), "drop_volume")
    anchor("RECYCLE_INTERACTION", (0, -d / 2 - 0.10, 0.62), parent=root, kind="recycle_interaction")
    anchor("RECYCLE_DROP_TARGET", (0, 0.02, 0.66), parent=root, kind="recycle_drop")
    return root


def add_build_info(asset_id):
    text = bpy.data.texts.new("BUILD_INFO.txt")
    layout_note = (
        "apparel content layouts: APPAREL8 and FLAT8; authored scale: 1.0; shrink fallback: forbidden\n"
        if asset_id == BOX_ID else ""
    )
    text.write(
        "Pinehollow Golf delivery hero asset\n"
        f"asset_id: {asset_id}\n"
        f"build_version: {BUILD_VERSION}\n"
        f"builder: {SCRIPT.relative_to(ROOT).as_posix()}\n"
        "units: metres\n"
        "source: original in-repository geometry; no external assets\n"
        "raw Tripo sources: untouched and not imported\n"
        f"{layout_note}"
    )


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


BOX_REQUIRED = {
    "BOX_WALL_FRONT", "BOX_WALL_BACK", "BOX_WALL_LEFT", "BOX_WALL_RIGHT",
    "BOX_FLAP_FRONT", "BOX_FLAP_BACK", "BOX_FLAP_LEFT", "BOX_FLAP_RIGHT",
    "BOX_FRONT", "BOX_BACK", "BOX_LEFT", "BOX_RIGHT",
    "FLAP_TOP_FRONT", "FLAP_TOP_BACK", "FLAP_TOP_LEFT", "FLAP_TOP_RIGHT",
    "TAPE_SEG_LEFT", "TAPE_SEG_RIGHT", "TAPE_SIDE_LEFT", "TAPE_SIDE_RIGHT",
    "TAPE_PEELED_LEFT", "TAPE_PEELED_RIGHT", "LABEL_MAIN", "LABEL_DYNAMIC",
    "LABEL_SHIPPING", "DIVIDER_LONG", "DIVIDER_CROSS", "TISSUE_BASE",
    "COL_BOX_CLOSED", "COL_BOX_OPEN", "COLLISION_CLOSED", "COLLISION_OPEN",
    "INTERACTION_TARGET", "CUT_PATH", "VOLUME_CONTENTS",
    "BOX_FLAT_BUNDLE", "FLAT_PANEL_BASE", "FLAT_PANEL_FRONT",
    "FLAT_FOLD_LEFT", "FLAT_FOLD_RIGHT", "FLAT_BRAND_BAND", "FLAT_LABEL",
    *{f"CONTENT_SLOT_{index:02d}" for index in range(1, 9)},
    "CONTENT_LAYOUT_APPAREL8", "CONTENT_LAYOUT_FLAT8",
    *{f"CONTENT_SLOT_APPAREL8_{index:02d}" for index in range(1, 9)},
    *{f"CONTENT_SLOT_FLAT8_{index:02d}" for index in range(1, 9)},
}
CUTTER_REQUIRED = {
    "CUTTER_BODY", "CUTTER_SLIDER", "CUTTER_BLADE", "CUTTER_CHANNEL",
    "CUTTER_RUBBER_GRIP", "CUTTER_SAFETY_STOP", "CUTTER_SCREW",
    "BLADE_CONTACT", "CUTTER_GRIP_POINT", "CUTTER_POSE_RETRACTED",
    "CUTTER_POSE_EXTENDED", "COL_CUTTER",
}
RECYCLING_REQUIRED = {
    "RECYCLE_FLOOR", "RECYCLE_BACK", "RECYCLE_LEFT", "RECYCLE_RIGHT",
    "RECYCLE_FRONT_LOW", "RECYCLE_TOP_RAIL_BACK", "RECYCLE_FRONT_LIP",
    "RECYCLE_LABEL_PANEL", "RECYCLE_LABEL_BAND", "RECYCLE_TEXT",
    "COL_RECYCLING_STATION", "VOLUME_RECYCLE_DROP",
    "RECYCLE_INTERACTION", "RECYCLE_DROP_TARGET",
}


def validate_scene(asset_id, root, required):
    nodes = descendants(root)
    by_name = {obj.name: obj for obj in nodes}
    missing = sorted(required - set(by_name))
    if missing:
        raise RuntimeError(f"{asset_id} missing required nodes: {missing}")
    for obj in nodes:
        if obj.type == "MESH":
            if any(abs(scale - 1.0) > 1e-5 for scale in obj.scale):
                raise RuntimeError(f"{asset_id} unapplied scale: {obj.name} {tuple(obj.scale)}")
    if asset_id == BOX_ID:
        expected_layouts = {
            "APPAREL8": {
                "capacity": 8,
                "skus": ("polo1", "polo2", "jacket2", "pants2", "shorts1"),
                "max_dims": (0.220, 0.190, 0.100),
            },
            "FLAT8": {
                "capacity": 8,
                "skus": ("sock1",),
                "max_dims": (0.180, 0.150, 0.080),
            },
        }
        if tuple(json.loads(root.get("content_layouts", "[]"))) != tuple(expected_layouts):
            raise RuntimeError("apparel content layout declaration changed")
        for layout_id, expected in expected_layouts.items():
            layout = by_name[f"CONTENT_LAYOUT_{layout_id}"]
            if layout.parent is not root or int(layout.get("capacity", -1)) != expected["capacity"]:
                raise RuntimeError(f"{layout_id} hierarchy or capacity changed")
            if layout.get("packaging_shell_id") != "APPAREL_CARTON":
                raise RuntimeError(f"{layout_id} packaging shell contract changed")
            if tuple(json.loads(layout.get("allowed_skus", "[]"))) != expected["skus"]:
                raise RuntimeError(f"{layout_id} allowed SKU contract changed")
            for index in range(1, expected["capacity"] + 1):
                socket = by_name[f"CONTENT_SLOT_{layout_id}_{index:02d}"]
                if socket.parent is not layout:
                    raise RuntimeError(f"{socket.name} must be directly under {layout.name}")
                for key in (
                    "layout_id", "slot_index", "allowed_category", "catalog_category", "allowed_skus",
                    "packaging_state", "packaging_shell_id", "max_w", "max_d", "max_h", "display_state",
                    "stack_order", "stack_column", "stack_layer", "visibility_threshold",
                    "removal_order", "content_scale", "allow_scale",
                ):
                    if key not in socket:
                        raise RuntimeError(f"{socket.name} missing {key}")
                actual_dims = tuple(round(float(socket[key]), 6) for key in ("max_w", "max_d", "max_h"))
                if actual_dims != expected["max_dims"]:
                    raise RuntimeError(f"{socket.name} envelope changed: {actual_dims}")
                if socket["packaging_shell_id"] != "APPAREL_CARTON":
                    raise RuntimeError(f"{socket.name} packaging shell contract changed")
                if float(socket["content_scale"]) != 1.0 or bool(socket["allow_scale"]):
                    raise RuntimeError(f"{socket.name} must remain authored at 1:1 scale")
    metrics = asset_metrics(root)
    triangle_budget = 12000 if asset_id in (BOX_ID, RECYCLING_ID) else 6000
    if metrics["triangles"] > triangle_budget:
        raise RuntimeError(f"{asset_id} exceeds triangle budget: {metrics['triangles']}")
    return metrics


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
    metrics.update({"source": str(blend_path), "export": str(glb_path), "bytes": glb_path.stat().st_size})
    (QA_DIR / f"{asset_id}_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf8")
    print(f"BUILT|{asset_id}|nodes={metrics['nodes']}|tris={metrics['triangles']}|bytes={metrics['bytes']}")
    return metrics


def look_at(camera, target):
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def render_preview(asset_id, root, opened=False):
    scene = bpy.context.scene
    # Blender 5.1 exposes Eevee under the legacy enum even though the UI still
    # calls the renderer Eevee. Keeping the preview renderer version-tolerant
    # makes the asset build repeatable across the project's supported installs.
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("QA_World")
    scene.world.color = (0.035, 0.045, 0.038)
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    scene.view_settings.exposure = -1.25
    if asset_id == BOX_ID:
        camera_location = (0.42, -0.44, 1.02) if opened else (0.88, -1.05, 0.72)
        camera_target = (0, 0, 0.115) if opened else (0, 0, 0.17)
    elif asset_id == CUTTER_ID:
        camera_location = (0.26, -0.38, 0.24)
        camera_target = (0, 0.075, 0.015)
    else:
        camera_location = (1.35, -1.65, 1.20)
        camera_target = (0, 0, 0.46)
    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.object
    camera.name = "QA_Camera"
    look_at(camera, camera_target)
    camera.data.lens = 54
    scene.camera = camera
    for name, energy, loc, size in [
        ("Key", 220, (-0.6, -0.6, 1.25), 1.4),
        ("Fill", 105, (0.8, -0.2, 0.75), 1.0),
        ("Rim", 150, (0.1, 0.8, 1.0), 0.8),
    ]:
        bpy.ops.object.light_add(type="AREA", location=loc)
        light = bpy.context.object
        light.name = f"QA_{name}"
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size
        look_at(light, (0, 0, 0.15))
    floor_mat = mat("QA_Floor", (0.10, 0.13, 0.11, 1), roughness=0.95)
    floor = box("QA_Floor", (2.4, 2.4, 0.025), (0, 0, -0.018), floor_mat, bevel=0.004)
    hidden_variants = []
    if asset_id == BOX_ID:
        flat_bundle = bpy.data.objects.get("BOX_FLAT_BUNDLE")
        if flat_bundle:
            for obj in descendants(flat_bundle):
                hidden_variants.append((obj, obj.hide_render))
                obj.hide_render = True
        for obj in descendants(root):
            if obj.name.startswith("TAPE_PEELED_") or (opened and obj.name.startswith("TAPE_")):
                hidden_variants.append((obj, obj.hide_render))
                obj.hide_render = True
    changed = []
    if opened and asset_id == BOX_ID:
        poses = {
            "BOX_FLAP_FRONT": math.radians(102), "BOX_FLAP_BACK": math.radians(-102),
            "BOX_FLAP_LEFT": math.radians(-102), "BOX_FLAP_RIGHT": math.radians(102),
        }
        for name, angle in poses.items():
            pivot = bpy.data.objects.get(name)
            changed.append((pivot, pivot.rotation_euler.copy()))
            if name.endswith(("FRONT", "BACK")):
                pivot.rotation_euler.x = angle
            else:
                pivot.rotation_euler.y = angle
        front_wall = bpy.data.objects.get("BOX_WALL_FRONT")
        if front_wall:
            changed.append((front_wall, front_wall.rotation_euler.copy()))
            front_wall.rotation_euler.x = math.radians(82)
    scene.render.filepath = str(QA_DIR / f"{asset_id}_{'open' if opened else 'sealed'}.png")
    bpy.ops.render.render(write_still=True)
    for obj, rotation in changed:
        obj.rotation_euler = rotation
    for obj, was_hidden in hidden_variants:
        obj.hide_render = was_hidden
    # Camera and floor already use QA_ names; remove a unique snapshot so no
    # invalid StructRNA reference is visited twice after deletion.
    for obj in [o for o in list(bpy.data.objects) if o.name.startswith("QA_")]:
        bpy.data.objects.remove(obj, do_unlink=True)


def clean_reimport_validate(asset_id, required):
    reset_scene()
    glb_path = EXPORT_DIR / f"{asset_id}.glb"
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    names = {obj.name for obj in bpy.context.scene.objects}
    missing = sorted(required - names)
    if missing:
        raise RuntimeError(f"clean re-import {asset_id} missing: {missing}")
    roots = [obj for obj in bpy.context.scene.objects if obj.name == asset_id]
    if not roots:
        raise RuntimeError(f"clean re-import {asset_id} lost root")
    metrics = asset_metrics(roots[0])
    print(f"REIMPORT_OK|{asset_id}|nodes={metrics['nodes']}|tris={metrics['triangles']}")


def build_one(asset_id):
    reset_scene()
    bpy.context.scene["asset_build_script"] = SCRIPT.relative_to(ROOT).as_posix()
    bpy.context.scene["asset_build_version"] = BUILD_VERSION
    M = delivery_materials()
    if asset_id == BOX_ID:
        root = build_apparel_box(M)
        required = BOX_REQUIRED
    elif asset_id == CUTTER_ID:
        root = build_cutter(M)
        required = CUTTER_REQUIRED
    else:
        root = build_recycling_station(M)
        required = RECYCLING_REQUIRED
    metrics = save_and_export(asset_id, root, required)
    render_preview(asset_id, root, opened=False)
    if asset_id == BOX_ID:
        render_preview(asset_id, root, opened=True)
    return metrics, required


def main():
    target = os.environ.get("DELIVERY_HERO_TARGET", "").strip()
    asset_ids = (BOX_ID, CUTTER_ID, RECYCLING_ID) if not target else (target,)
    unknown = [asset_id for asset_id in asset_ids if asset_id not in (BOX_ID, CUTTER_ID, RECYCLING_ID)]
    if unknown:
        raise RuntimeError(f"unknown DELIVERY_HERO_TARGET: {unknown[0]}")
    built = []
    requirements = {}
    for asset_id in asset_ids:
        metrics, required = build_one(asset_id)
        built.append(metrics)
        requirements[asset_id] = required
    for asset_id in asset_ids:
        clean_reimport_validate(asset_id, requirements[asset_id])
    report = {
        "builder": SCRIPT.relative_to(ROOT).as_posix(),
        "build_version": BUILD_VERSION,
        "qa_pass": QA_PASS or "default",
        "asset_target": target or "all",
        "external_assets": [],
        "raw_tripo_sources_modified": False,
        "assets": built,
    }
    (QA_DIR / "delivery_hero_build_report.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(f"COMPLETE|assets={len(built)}|source_dir={SOURCE_DIR}|export_dir={EXPORT_DIR}")


if __name__ == "__main__":
    main()
