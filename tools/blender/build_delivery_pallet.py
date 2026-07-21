"""Build Asset Sheet 05 reference 44: Pinehollow delivery pallet.

Run from the repository root with Blender 5.1:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
      --background --factory-startup \
      --python tools/blender/build_delivery_pallet.py

All geometry is original, deterministic, project-owned work authored in metres.
Blender axes are X length, Y width/depth and Z height. The standard glTF Y-up
conversion exports runtime dimensions X length, Y height and Z width. Set
DELIVERY_PALLET_QA_PASS (for example ``iteration-02``) to preserve comparison
renders and metrics under the ignored QA tree.
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
    finish_mesh,
    mat,
    materials,
    parent_keep,
    reset_scene,
)


ASSET_ID = "delivery_wooden_pallet"
BUILD_VERSION = 2
TARGET_RUNTIME_DIMS = (1.20, 0.14, 1.00)  # Three.js X length, Y height, Z width
BLENDER_DIMS = (1.20, 1.00, 0.14)  # Blender X length, Y width, Z height

SOURCE_DIR = ROOT / "asset_sources" / "blender" / "delivery"
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
QA_ROOT = ROOT / "qa" / "box_system_master" / "blender" / "pallet_ref44"
QA_PASS = os.environ.get("DELIVERY_PALLET_QA_PASS", "iteration-01")
QA_DIR = QA_ROOT / QA_PASS
SOURCE_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
QA_DIR.mkdir(parents=True, exist_ok=True)


def pallet_materials():
    """Exporter-safe Pinehollow materials with restrained weather variation."""
    M = materials()
    authored = (
        # Values are authored in linear light. Keep the boards bright enough
        # to read as unfinished shipping oak beneath the clubhouse overhang,
        # with close tonal variation rather than alternating dark stripes.
        ("oak", (0.300, 0.135, 0.042, 1.0), 0.95, 0.0),
        ("walnut", (0.190, 0.075, 0.018, 1.0), 0.96, 0.0),
        ("walnut_dark", (0.095, 0.030, 0.006, 1.0), 0.97, 0.0),
        # Aged, oxidised fasteners: intentionally low-contrast and matte.
        ("charcoal", (0.030, 0.022, 0.014, 1.0), 0.96, 0.06),
    )
    for key, color, roughness, metallic in authored:
        material = M[key]
        material.diffuse_color = color
        bsdf = material.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        specular = bsdf.inputs.get("Specular IOR Level")
        if specular:
            specular.default_value = 0.18 if metallic == 0.0 else 0.24
        coat = bsdf.inputs.get("Coat Weight")
        if coat:
            coat.default_value = 0.0
        material["finish"] = "matte_weathered_shipping_wood" if metallic == 0.0 else "aged_steel"
    return M


def pallet_root():
    return empty(
        ASSET_ID,
        props={
            "asset_id": ASSET_ID,
            "asset_version": BUILD_VERSION,
            "version": BUILD_VERSION,
            "units": "meters",
            "reference_id": "44",
            "target_dimensions_m": list(TARGET_RUNTIME_DIMS),
            "blender_dimensions_m": list(BLENDER_DIMS),
            "front": "Blender -Y / runtime +Z fork entry",
            "source": "Original Pinehollow Golf geometry generated in-repository from local Asset Sheet 05",
            "license": "Project-owned / UNLICENSED",
            "builder": SCRIPT.relative_to(ROOT).as_posix(),
            "model_map_key": ASSET_ID,
            "asset_type": "delivery_staging_pallet",
            "fork_entry_sides": "front_and_back",
            "rated_box_slots": 6,
        },
        size=0.075,
    )


def set_helper(obj, helper_kind):
    obj["helper"] = True
    obj["helper_kind"] = helper_kind
    obj.hide_render = True
    return obj


def merged_flat_discs(name, centers, radius, z, material, parent, segments=6):
    """Create all nail heads in one UV-authored mesh/material draw unit."""
    verts = []
    faces = []
    for center_x, center_y in centers:
        start = len(verts)
        for index in range(segments):
            angle = 2 * math.pi * index / segments
            verts.append((center_x + radius * math.cos(angle), center_y + radius * math.sin(angle), z))
        faces.append(tuple(range(start, start + segments)))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish_mesh(obj, material, bevel_width=0.0)
    parent_keep(obj, parent)
    obj["fastener_count"] = len(centers)
    obj["fastener_kind"] = "inset_darkened_nail_head"
    return obj


def merged_top_marks(name, marks, z, material, parent):
    """Create restrained grain/wear marks as one inlaid planar mesh."""
    verts = []
    faces = []
    for center_x, center_y, length, width, angle in marks:
        c, s = math.cos(angle), math.sin(angle)
        along = Vector((c, s)) * (length / 2)
        across = Vector((-s, c)) * (width / 2)
        start = len(verts)
        for point in (along + across, along - across, -along - across, -along + across):
            verts.append((center_x + point.x, center_y + point.y, z))
        faces.append((start, start + 1, start + 2, start + 3))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish_mesh(obj, material, bevel_width=0.0)
    parent_keep(obj, parent)
    obj["mark_count"] = len(marks)
    obj["wear_style"] = "restrained_shipping_wear"
    return obj


def merged_end_grain(name, board_centers, board_width, material, parent):
    """Add one merged set of darker board-end faces without changing bounds."""
    verts = []
    faces = []
    x_positions = (-0.5999, 0.5999)
    z0, z1 = 0.115, 0.1396
    for center_y in board_centers:
        y0 = center_y - board_width * 0.44
        y1 = center_y + board_width * 0.44
        for x in x_positions:
            start = len(verts)
            verts.extend([(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)])
            faces.append((start, start + 1, start + 2, start + 3))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish_mesh(obj, material, bevel_width=0.0)
    parent_keep(obj, parent)
    obj["end_face_count"] = len(board_centers) * 2
    return obj


def build_pallet(M):
    root = pallet_root()
    deck = empty(
        "PALLET_DECK", parent=root, size=0.055,
        props={"component": "top_deck", "board_count": 7, "deck_height_m": 0.028},
    )

    # Seven cross-deck boards exactly span the reference's 1.20 x 1.00 m
    # footprint. The 32.5 mm gaps remain legible from first-person height.
    board_width = 0.115
    board_centers = [-0.4425, -0.2950, -0.1475, 0.0, 0.1475, 0.2950, 0.4425]
    board_materials = [M["oak"], M["oak"], M["walnut"], M["oak"], M["oak"], M["walnut"], M["oak"]]
    for index, (center_y, material) in enumerate(zip(board_centers, board_materials), start=1):
        board = box(
            f"TOP_BOARD_{index:02d}", (1.20, board_width, 0.0279),
            (0, center_y, 0.12595), material, bevel=0.0035, parent=deck,
            props={
                "board_index": index,
                "structural_role": "top_deck_board",
                "dimensions_m": [1.20, board_width, 0.0279],
                "wood_family": "weathered_natural_oak",
            },
        )
        board["grain_axis"] = "+X"

    # Three true block-pallet runner groups. Forks enter along +/-Y through the
    # two open channels between these groups.
    group_specs = (("LEFT", -0.47), ("CENTER", 0.0), ("RIGHT", 0.47))
    for group_index, (label, center_x) in enumerate(group_specs, start=1):
        group = empty(
            f"STRINGER_GROUP_{label}", (0, 0, 0), parent=root, size=0.050,
            props={
                "component": "longitudinal_stringer_group",
                "group_index": group_index,
                "fork_boundary_center_x": center_x,
            },
        )
        box(
            f"STRINGER_CAP_{label}", (0.14, 1.00, 0.019),
            (center_x, 0, 0.1025), M["walnut"], bevel=0.0025, parent=group,
            props={"structural_role": "upper_longitudinal_support"},
        )
        for row_label, center_y in (("FRONT", -0.42), ("CENTER", 0.0), ("BACK", 0.42)):
            box(
                f"BLOCK_{label}_{row_label}", (0.14, 0.14, 0.073),
                (center_x, center_y, 0.0565), M["oak" if row_label != "CENTER" else "walnut"],
                bevel=0.004, parent=group,
                props={"structural_role": "load_block", "block_row": row_label.lower()},
            )
        box(
            f"LOWER_BOARD_{label}", (0.14, 1.00, 0.020),
            (center_x, 0, 0.010), M["walnut_dark"], bevel=0.0025, parent=group,
            props={"structural_role": "lower_runner", "floor_contact": True},
        )

    # Two fasteners at every board/stringer crossing, merged into one mesh.
    nail_centers = []
    for board_index, center_y in enumerate(board_centers):
        for group_index, (_, center_x) in enumerate(group_specs):
            # Two heads remain at every structural crossing, but millimetre-
            # scale deterministic offsets avoid a conspicuous perfect dot grid.
            pair_dx = 0.018 + 0.0015 * ((board_index + group_index) % 3)
            first_y = center_y + 0.0015 * (((board_index + group_index * 2) % 3) - 1)
            second_y = center_y + 0.0015 * (((board_index * 2 + group_index) % 3) - 1)
            nail_centers.extend([(center_x - pair_dx, first_y), (center_x + pair_dx, second_y)])
    merged_flat_discs("NAILS", nail_centers, 0.0035, 0.14000, M["charcoal"], root, segments=6)

    # Geometry-backed color breakup survives the texture-free GLB pipeline.
    wear_marks = [
        (-0.36, -0.4425, 0.14, 0.0035, math.radians(0.8)),
        (0.20, -0.4425, 0.10, 0.0025, math.radians(-0.7)),
        (-0.18, -0.2950, 0.18, 0.0030, math.radians(0.5)),
        (0.33, -0.1475, 0.09, 0.0040, math.radians(-1.1)),
        (-0.29, 0.0, 0.12, 0.0030, math.radians(0.9)),
        (0.12, 0.1475, 0.16, 0.0025, math.radians(-0.6)),
        (-0.38, 0.2950, 0.08, 0.0035, math.radians(1.0)),
        (0.31, 0.4425, 0.13, 0.0025, math.radians(-0.8)),
    ]
    merged_top_marks("WEAR_MARKS", wear_marks, 0.14000, M["walnut"], root)
    merged_end_grain("END_GRAIN_MARKS", board_centers, board_width, M["walnut"], root)

    # Pallet-jack and fork helpers are transforms, not visible placeholder
    # geometry. Their authored clearances correspond to the real support gaps.
    for label, center_x in (("LEFT", -0.235), ("RIGHT", 0.235)):
        anchor(
            f"FORK_CHANNEL_{label}", (center_x, 0, 0.058), parent=root, kind="fork_channel",
            props={
                "channel_axis": "+/-Y",
                "clear_width_m": 0.30,
                "clear_height_m": 0.092,
                "clear_length_m": 1.00,
                "fork_center_x": center_x,
            },
        )
    anchor(
        "PALLET_JACK_ENTRY", (0, -0.56, 0.058), parent=root, kind="pallet_jack_entry",
        props={
            "entry_direction_blender": "+Y",
            "entry_direction_runtime": "-Z",
            "recommended_fork_spacing_m": 0.47,
            "maximum_fork_width_m": 0.14,
        },
    )

    # Six bounded staging sockets form a 3x2 grid across the usable deck.
    socket_index = 1
    for row_index, center_y in enumerate((-0.245, 0.245), start=1):
        for column_index, center_x in enumerate((-0.39, 0.0, 0.39), start=1):
            anchor(
                f"DELIVERY_SOCKET_{socket_index:02d}", (center_x, center_y, 0.142),
                parent=root, kind="delivery_box_socket",
                props={
                    "allowed_category": "delivery_box",
                    "max_w": 0.38,
                    "max_d": 0.45,
                    "max_h": 0.65,
                    "stack_order": socket_index,
                    "occupancy": "empty",
                    "occupied": False,
                    "occupancy_key": f"pallet_slot_{socket_index:02d}",
                    "order_index": socket_index,
                    "order_id": "",
                    "row": row_index,
                    "column": column_index,
                },
            )
            socket_index += 1
    anchor(
        "INTERACTION_TARGET", (0, -0.30, 0.175), parent=root, kind="pallet_interaction",
        props={"interaction_radius_m": 1.65, "prompt": "Pallet staging"},
    )

    # Four simple collision components preserve both fork openings. The top
    # deck remains one stable box-placement surface while the lower rails match
    # the three physical stringer groups.
    set_helper(
        collision_box("COL_PALLET", (1.20, 1.00, 0.028), (0, 0, 0.126), M, parent=root),
        "top_deck_collision",
    )
    for label, center_x in group_specs:
        set_helper(
            collision_box(
                f"COL_PALLET_{label}", (0.14, 1.00, 0.112),
                (center_x, 0, 0.056), M, parent=root,
            ),
            "runner_collision",
        )
    return root


REQUIRED_NODES = {
    "PALLET_DECK",
    *{f"TOP_BOARD_{index:02d}" for index in range(1, 8)},
    *{f"STRINGER_GROUP_{label}" for label in ("LEFT", "CENTER", "RIGHT")},
    *{f"STRINGER_CAP_{label}" for label in ("LEFT", "CENTER", "RIGHT")},
    *{f"LOWER_BOARD_{label}" for label in ("LEFT", "CENTER", "RIGHT")},
    *{
        f"BLOCK_{label}_{row}"
        for label in ("LEFT", "CENTER", "RIGHT")
        for row in ("FRONT", "CENTER", "BACK")
    },
    "NAILS", "WEAR_MARKS", "END_GRAIN_MARKS",
    "FORK_CHANNEL_LEFT", "FORK_CHANNEL_RIGHT", "PALLET_JACK_ENTRY",
    *{f"DELIVERY_SOCKET_{index:02d}" for index in range(1, 7)},
    "INTERACTION_TARGET", "COL_PALLET",
    "COL_PALLET_LEFT", "COL_PALLET_CENTER", "COL_PALLET_RIGHT",
}


def visible_bounds(root):
    corners = []
    bpy.context.view_layer.update()
    for obj in descendants(root):
        if obj.type != "MESH" or obj.name.startswith("COL_"):
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
    materials_used = set()
    for obj in meshes:
        triangles += sum(max(1, len(poly.vertices) - 2) for poly in obj.data.polygons)
        materials_used.update(slot.material.name for slot in obj.material_slots if slot.material)
    lo, hi = visible_bounds(root)
    return {
        "nodes": len(nodes),
        "meshes": len(meshes),
        "triangles": triangles,
        "materials": sorted(materials_used),
        "textures": 0,
        "visible_bounds_min_blender": [round(value, 5) for value in lo],
        "visible_bounds_max_blender": [round(value, 5) for value in hi],
        "visible_dimensions_blender": [round(value, 5) for value in (hi - lo)],
        "visible_dimensions_runtime": [round((hi - lo).x, 5), round((hi - lo).z, 5), round((hi - lo).y, 5)],
    }


def functional_checks(root):
    by_name = {obj.name: obj for obj in descendants(root)}
    checks = []
    for label, expected_x in (("LEFT", -0.235), ("RIGHT", 0.235)):
        channel = by_name[f"FORK_CHANNEL_{label}"]
        position_ok = abs(channel.location.x - expected_x) < 1e-5
        clearance_ok = float(channel["clear_width_m"]) >= 0.29 and float(channel["clear_height_m"]) >= 0.09
        if not position_ok or not clearance_ok:
            raise RuntimeError(f"{channel.name} clearance contract invalid")
        checks.append({
            "node": channel.name,
            "position_x_m": round(channel.location.x, 5),
            "clear_width_m": float(channel["clear_width_m"]),
            "clear_height_m": float(channel["clear_height_m"]),
            "pass": True,
        })
    for index in range(1, 7):
        socket = by_name[f"DELIVERY_SOCKET_{index:02d}"]
        within_x = abs(socket.location.x) + float(socket["max_w"]) / 2 <= 0.60001
        within_y = abs(socket.location.y) + float(socket["max_d"]) / 2 <= 0.50001
        metadata_ok = (
            socket.get("allowed_category") == "delivery_box"
            and isinstance(socket.get("stack_order"), int)
            and "occupancy" in socket
            and "order_index" in socket
        )
        if not (within_x and within_y and metadata_ok):
            raise RuntimeError(f"{socket.name} staging contract invalid")
    checks.append({"delivery_sockets": 6, "within_deck_envelope": True, "metadata_complete": True, "pass": True})
    return checks


def validate_scene(root):
    nodes = descendants(root)
    by_name = {obj.name: obj for obj in nodes}
    missing = sorted(REQUIRED_NODES - set(by_name))
    if missing:
        raise RuntimeError(f"{ASSET_ID} missing required nodes: {missing}")
    if root.get("asset_id") != ASSET_ID or root.get("reference_id") != "44":
        raise RuntimeError("pallet root metadata invalid")
    for obj in nodes:
        if obj.type != "MESH":
            continue
        if any(abs(value - 1.0) > 1e-5 for value in obj.scale):
            raise RuntimeError(f"unapplied scale: {obj.name} {tuple(obj.scale)}")
        if obj.data.polygons and not obj.data.uv_layers:
            raise RuntimeError(f"missing UVs: {obj.name}")
    deck = by_name["PALLET_DECK"]
    for index in range(1, 8):
        if by_name[f"TOP_BOARD_{index:02d}"].parent is not deck:
            raise RuntimeError(f"TOP_BOARD_{index:02d} must be direct child of PALLET_DECK")
    for label in ("LEFT", "CENTER", "RIGHT"):
        group = by_name[f"STRINGER_GROUP_{label}"]
        for child_name in (
            f"STRINGER_CAP_{label}", f"LOWER_BOARD_{label}",
            f"BLOCK_{label}_FRONT", f"BLOCK_{label}_CENTER", f"BLOCK_{label}_BACK",
        ):
            if by_name[child_name].parent is not group:
                raise RuntimeError(f"{child_name} hierarchy invalid")
    metrics = asset_metrics(root)
    if not 500 <= metrics["triangles"] <= 5000:
        raise RuntimeError(f"triangle budget failed: {metrics['triangles']}")
    if metrics["nodes"] > 60:
        raise RuntimeError(f"node budget failed: {metrics['nodes']}")
    if len(metrics["materials"]) > 8:
        raise RuntimeError(f"material budget failed: {len(metrics['materials'])}")
    expected = BLENDER_DIMS
    actual = metrics["visible_dimensions_blender"]
    if any(abs(a - e) > 0.001 for a, e in zip(actual, expected)):
        raise RuntimeError(f"visible dimensions {actual} do not match {expected}")
    metrics["functional_checks"] = functional_checks(root)
    metrics["triangle_budget"] = [500, 5000]
    metrics["material_budget"] = 8
    metrics["node_budget"] = 60
    return metrics


def add_build_info():
    text = bpy.data.texts.new("BUILD_INFO.txt")
    text.write(
        "Pinehollow Golf delivery pallet, Asset Sheet 05 reference 44\n"
        f"asset_id: {ASSET_ID}\n"
        f"build_version: {BUILD_VERSION}\n"
        f"builder: {SCRIPT.relative_to(ROOT).as_posix()}\n"
        "units: metres\n"
        "source: original in-repository geometry from local project reference sheet\n"
        "license: project-owned / UNLICENSED\n"
        "external downloads and textures: none\n"
        "existing delivery assets: untouched\n"
    )


def save_and_export(root):
    metrics = validate_scene(root)
    add_build_info()
    blend_path = SOURCE_DIR / f"{ASSET_ID}.blend"
    glb_path = EXPORT_DIR / f"{ASSET_ID}.glb"
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
        "asset_id": ASSET_ID,
        "reference_id": "44",
        "target_dimensions_m": list(TARGET_RUNTIME_DIMS),
        "source": str(blend_path),
        "export": str(glb_path),
        "bytes": glb_path.stat().st_size,
        "qa_pass": QA_PASS,
    })
    (QA_DIR / f"{ASSET_ID}_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf8")
    print(
        f"BUILT|{ASSET_ID}|nodes={metrics['nodes']}|meshes={metrics['meshes']}|"
        f"tris={metrics['triangles']}|mats={len(metrics['materials'])}|bytes={metrics['bytes']}|"
        f"runtime_dims={metrics['visible_dimensions_runtime']}"
    )
    return metrics


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def preview_setup(M):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 760
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -1.15
    if scene.world is None:
        scene.world = bpy.data.worlds.new("QA_World")
    scene.world.color = (0.026, 0.029, 0.027)
    bpy.ops.object.camera_add(location=(1.7, -1.5, 0.9))
    camera = bpy.context.object
    camera.name = "QA_Camera"
    camera.data.lens = 57
    scene.camera = camera
    for name, energy, location, size in (
        ("Key", 620, (-1.25, -1.15, 1.75), 1.55),
        ("Fill", 300, (1.35, -0.40, 1.05), 1.25),
        ("Rim", 440, (0.30, 1.35, 1.20), 1.00),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = f"QA_{name}"
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size
        look_at(light, (0, 0, 0.08))
    floor_mat = mat("QA_WarmGrayGround", (0.105, 0.105, 0.095, 1.0), roughness=0.94)
    box("QA_Floor", (3.4, 3.4, 0.025), (0, 0, -0.018), floor_mat, bevel=0.006)

    # Two authored, semi-transparent size proxies exist only after source/GLB
    # export and are removed before this Blender process exits.
    proxy_a_mat = mat("QA_ProxyKraft", (0.48, 0.27, 0.10, 0.42), roughness=0.78)
    proxy_b_mat = mat("QA_ProxySage", (0.19, 0.34, 0.23, 0.38), roughness=0.72)
    proxy_a = box(
        "QA_BoxProxy_Medium", (0.50, 0.38, 0.35), (-0.31, -0.035, 0.315),
        proxy_a_mat, bevel=0.012,
        props={"qa_only": True, "proxy_dimensions_m": [0.50, 0.38, 0.35]},
    )
    proxy_b = box(
        "QA_BoxProxy_Small", (0.42, 0.30, 0.27), (0.30, 0.080, 0.275),
        proxy_b_mat, bevel=0.010,
        props={"qa_only": True, "proxy_dimensions_m": [0.42, 0.30, 0.27]},
    )
    for proxy in (proxy_a, proxy_b):
        proxy.hide_render = True
    return camera, (proxy_a, proxy_b)


def render_previews(root, M):
    camera, proxies = preview_setup(M)
    views = (
        ("front", (0, -2.15, 0.38), (0, 0, 0.065)),
        ("side", (1.95, 0, 0.36), (0, 0, 0.065)),
        ("top", (0.15, -0.18, 2.55), (0, 0, 0.04)),
        ("three_quarter", (1.65, -1.55, 0.82), (0, 0, 0.055)),
    )
    for loaded in (False, True):
        for proxy in proxies:
            proxy.hide_render = not loaded
        for name, location, target in views:
            camera.location = location
            look_at(camera, target if not loaded else (0, 0, 0.22))
            suffix = "loaded" if loaded else "clean"
            bpy.context.scene.render.filepath = str(QA_DIR / f"{ASSET_ID}_{name}_{suffix}.png")
            bpy.ops.render.render(write_still=True)
    for obj in [candidate for candidate in list(bpy.data.objects) if candidate.name.startswith("QA_")]:
        bpy.data.objects.remove(obj, do_unlink=True)


def clean_reimport_validate():
    reset_scene()
    glb_path = EXPORT_DIR / f"{ASSET_ID}.glb"
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    root = bpy.data.objects.get(ASSET_ID)
    if root is None:
        raise RuntimeError("clean re-import lost pallet root")
    names = {obj.name for obj in bpy.context.scene.objects}
    missing = sorted(REQUIRED_NODES - names)
    if missing:
        raise RuntimeError(f"clean re-import missing nodes: {missing}")
    if root.get("asset_id") != ASSET_ID or root.get("reference_id") != "44":
        raise RuntimeError("clean re-import lost root metadata")
    metrics = asset_metrics(root)
    report = {
        "asset_id": ASSET_ID,
        "glb": str(glb_path),
        "root_metadata_preserved": True,
        "required_nodes_preserved": True,
        "nodes": metrics["nodes"],
        "meshes": metrics["meshes"],
        "triangles": metrics["triangles"],
        "materials": metrics["materials"],
        "visible_dimensions_blender": metrics["visible_dimensions_blender"],
        "visible_dimensions_runtime": metrics["visible_dimensions_runtime"],
    }
    (QA_DIR / f"{ASSET_ID}_reimport.json").write_text(json.dumps(report, indent=2), encoding="utf8")

    # Clean-reimport proof uses no proxy volumes.
    M = pallet_materials()
    camera, proxies = preview_setup(M)
    for proxy in proxies:
        proxy.hide_render = True
    camera.location = (1.65, -1.55, 0.82)
    look_at(camera, (0, 0, 0.055))
    bpy.context.scene.render.filepath = str(QA_DIR / f"{ASSET_ID}_clean_reimport.png")
    bpy.ops.render.render(write_still=True)
    print(
        f"REIMPORT_OK|{ASSET_ID}|nodes={metrics['nodes']}|tris={metrics['triangles']}|"
        f"runtime_dims={metrics['visible_dimensions_runtime']}"
    )
    return report


def main():
    reset_scene()
    bpy.context.scene["asset_build_script"] = SCRIPT.relative_to(ROOT).as_posix()
    bpy.context.scene["asset_build_version"] = BUILD_VERSION
    M = pallet_materials()
    root = build_pallet(M)
    metrics = save_and_export(root)
    render_previews(root, M)
    reimport = clean_reimport_validate()
    report = {
        "builder": SCRIPT.relative_to(ROOT).as_posix(),
        "build_version": BUILD_VERSION,
        "qa_pass": QA_PASS,
        "reference_sheet": "Designs/RefrenceImages/41-50_refrence_images/ChatGPT Image Jul 17, 2026, 11_45_44 AM.png",
        "external_assets": [],
        "external_textures": [],
        "existing_assets_modified": False,
        "asset": metrics,
        "reimport": reimport,
    }
    (QA_DIR / "delivery_wooden_pallet_build_report.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(f"COMPLETE|asset={ASSET_ID}|qa_pass={QA_PASS}|source={SOURCE_DIR}|export={EXPORT_DIR}")


if __name__ == "__main__":
    main()
