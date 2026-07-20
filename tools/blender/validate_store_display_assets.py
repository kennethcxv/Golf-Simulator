"""Clean-reimport and visually compare every five-tier store-display family.

The validator imports the shipped GLBs into a factory-clean Blender scene,
checks the production hierarchy, then renders one labelled 1600x900 comparison
per family. It never reads the authoring .blend files.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
GLB_DIR = ROOT / "Assets" / "pro_shop" / "glb" / "fixtures"
OUT_DIR = ROOT / "qa" / "store_display_assets" / "clean_reimport"
OUT_DIR.mkdir(parents=True, exist_ok=True)

FAMILIES = [
    "clothing_rack", "hat_wall", "shoe_display", "golf_club_wall", "ball_display",
    "accessory_rack", "snack_shelving", "drink_refrigerator", "impulse_shelf",
    "checkout_display", "feature_table", "window_display", "luxury_display_island",
    "wall_slat_system", "built_in_cabinetry", "glass_display_tower", "corner_shelving",
    "rotating_display",
]

TIER_LABELS = ["BASIC", "STANDARD", "PREMIUM", "HIGH-END", "LUXURY"]


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass


def material(name, color, roughness=.7, metallic=0.0, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        (bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")).default_value = (*emission, 1)
        if bsdf.inputs.get("Emission Strength"):
            bsdf.inputs["Emission Strength"].default_value = 1.5
    return mat


def bounds(objects):
    points = []
    for obj in objects:
        if obj.type != "MESH" or not obj.visible_get():
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points:
        return (Vector((0, 0, 0)), Vector((0, 0, 0)))
    return (
        Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points))),
        Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points))),
    )


def descendants(root):
    result = []
    stack = [root]
    while stack:
        obj = stack.pop()
        result.append(obj)
        stack.extend(obj.children)
    return result


def import_asset(family, tier):
    asset_id = f"pf_display_{family}_t{tier}"
    path = GLB_DIR / f"{asset_id}.glb"
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path), import_scene_extras=True)
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    roots = [obj for obj in imported if obj.parent is None]
    root = next((obj for obj in roots if obj.name == asset_id), roots[0] if roots else None)
    if root is None:
        raise RuntimeError(f"{asset_id}: no imported root")
    nodes = descendants(root)
    for obj in nodes:
        if obj.name.upper().startswith("COL_") or bool(obj.get("collision_proxy")):
            obj.hide_render = True
            obj.hide_viewport = True
    meshes = [obj for obj in nodes if obj.type == "MESH" and not obj.name.upper().startswith("COL_")]
    collisions = [obj for obj in nodes if obj.name.upper().startswith("COL_")]
    slots = [obj for obj in nodes if obj.type == "EMPTY" and bool(obj.get("slot"))]
    moving = [obj for obj in nodes if bool(obj.get("moving_part"))]
    tris = 0
    uv_missing = []
    for obj in meshes:
        obj.data.calc_loop_triangles()
        tris += len(obj.data.loop_triangles)
        if not obj.data.uv_layers:
            uv_missing.append(obj.name)
    required_moving = family in {"drink_refrigerator", "glass_display_tower", "rotating_display"} \
        or (family == "built_in_cabinetry" and tier >= 3)
    errors = []
    if not meshes:
        errors.append("no visible mesh")
    if not collisions:
        errors.append("no COL_ collision proxy")
    if not slots:
        errors.append("no stocking slots")
    if uv_missing:
        errors.append(f"visible meshes without UVs: {uv_missing}")
    if required_moving and not moving:
        errors.append("required moving-part pivot missing")
    if root.get("display_family") != family or int(root.get("display_tier", 0)) != tier:
        errors.append("root display metadata missing or incorrect")
    if not root.get("source") or not root.get("license"):
        errors.append("source/license metadata missing")
    return {
        "id": asset_id,
        "path": str(path.relative_to(ROOT)).replace("\\", "/"),
        "root": root,
        "objects": nodes,
        "visibleMeshes": len(meshes),
        "triangles": tris,
        "collisionNodes": [obj.name for obj in collisions],
        "slotCount": len(slots),
        "movingPivots": [obj.name for obj in moving],
        "integratedLightMeshes": len([obj for obj in nodes if obj.name.startswith("LIGHT_PUCK_")]),
        "errors": errors,
    }


def add_label(text, x, z, width, tier, cream):
    bpy.ops.object.text_add(location=(x, -.20, z), rotation=(math.pi / 2, 0, 0))
    obj = bpy.context.object
    obj.name = f"QA_Label_Tier_{tier}"
    obj.data.body = text
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.size = min(.22, width * .12)
    obj.data.extrude = .004
    obj.data.bevel_depth = .002
    obj.data.materials.append(cream)


def setup_studio(total_width, max_height, center_x):
    floor_mat = material("QA_Floor", (.12, .105, .085), roughness=.78)
    cream = material("QA_Label_Cream", (.88, .77, .52), roughness=.45, emission=(.22, .14, .05))
    bpy.ops.mesh.primitive_plane_add(size=max(24, total_width * 1.7), location=(center_x, 0, -.012))
    floor = bpy.context.object
    floor.name = "QA_Floor"
    floor.data.materials.append(floor_mat)
    world = bpy.data.worlds.new("QA_World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (.025, .028, .027, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = .28
    bpy.context.scene.world = world
    for name, energy, size, loc, color in [
        ("QA_Key", 950, 6.0, (center_x - total_width * .20, -5.5, max_height + 3.0), (1.0, .78, .56)),
        ("QA_Fill", 560, 7.0, (center_x + total_width * .25, -2.5, max_height + 1.5), (.70, .82, 1.0)),
        ("QA_Rim", 720, 5.0, (center_x, 4.5, max_height + 2.2), (1.0, .74, .45)),
    ]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        data.color = color
        obj = bpy.data.objects.new(name, data)
        obj.location = loc
        obj.rotation_euler = (Vector((center_x, 0, max_height * .45)) - obj.location).to_track_quat("-Z", "Y").to_euler()
        bpy.context.collection.objects.link(obj)
    cam_data = bpy.data.cameras.new("QA_Camera")
    cam = bpy.data.objects.new("QA_Camera", cam_data)
    # Keep the five-tier lineup centered and leave enough horizontal breathing
    # room for the outer fixtures and their labels.  A yawed orthographic view
    # made Tier 1 disappear behind the left crop on the widest families.
    cam.location = (center_x, -max(10.0, total_width * .92), max_height * .72 + 1.2)
    cam.rotation_euler = (Vector((center_x, 0, max_height * .48)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max((max_height + .42) * 1.82, total_width / .84)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cream


def render_family(family):
    reset_scene()
    records = [import_asset(family, tier) for tier in range(1, 6)]
    widths = []
    heights = []
    for record in records:
        lo, hi = bounds(record["objects"])
        widths.append(hi.x - lo.x)
        heights.append(hi.z - lo.z)
    gap = .42
    total_width = sum(widths) + gap * 4
    cursor = -total_width / 2
    positions = []
    for record, width in zip(records, widths):
        x = cursor + width / 2
        record["root"].location.x += x
        positions.append(x)
        cursor += width + gap
    max_height = max(heights)
    cream = setup_studio(total_width, max_height, 0)
    for tier, (x, width) in enumerate(zip(positions, widths), 1):
        add_label(f"T{tier}  {TIER_LABELS[tier - 1]}", x, max_height + .24, width, tier, cream)
    scene = bpy.context.scene
    scene.render.filepath = str(OUT_DIR / f"{family}_five_tiers.png")
    bpy.ops.render.render(write_still=True)
    return {
        "family": family,
        "comparison": str(Path(scene.render.filepath).relative_to(ROOT)).replace("\\", "/"),
        "assets": [{key: value for key, value in record.items() if key not in {"root", "objects"}} for record in records],
    }


report = {
    "schemaVersion": 1,
    "method": "factory-clean Blender 5.1 GLB reimport; visible-mesh UV check; hierarchy metadata check; five-tier comparison render",
    "families": [render_family(family) for family in FAMILIES],
}
errors = [f"{asset['id']}: {error}" for family in report["families"] for asset in family["assets"] for error in asset["errors"]]
report["summary"] = {
    "familyCount": len(report["families"]),
    "assetCount": sum(len(family["assets"]) for family in report["families"]),
    "errorCount": len(errors),
    "errors": errors,
}
(OUT_DIR / "clean-reimport-report.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report["summary"], indent=2))
if errors:
    raise SystemExit(1)
