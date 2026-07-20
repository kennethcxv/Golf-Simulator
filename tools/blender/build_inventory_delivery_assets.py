"""Build Golf Flipper's original inventory/delivery equipment kit.

Run from the repository root with Blender 5.1:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
      --background --factory-startup \
      --python tools/blender/build_inventory_delivery_assets.py

The kit is deterministic, project-owned geometry with no external inputs. All
dimensions are metres. Blender is Z-up; glTF exports Y-up. Moving parts remain
separate with hinge/slide origins, transforms are applied, and each larger prop
contains a simplified COL_* mesh plus named interaction sockets.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[2]
SOURCE_DIR = ROOT / "asset_sources" / "blender" / "inventory_delivery"
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
QA_DIR = ROOT / "qa" / "inventory-delivery-loop" / "assets"
SOURCE_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
QA_DIR.mkdir(parents=True, exist_ok=True)

BUILD_VERSION = 1
ASSETS = (
    "delivery_worktable",
    "delivery_stock_shelf",
    "delivery_box_cutter",
    "delivery_recycling_station",
    "delivery_van",
)


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def material(name, color, roughness=0.65, metallic=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def kit_materials():
    return {
        "green": material("M_green", (0.045, 0.20, 0.075), 0.55),
        "sage": material("M_sage", (0.27, 0.42, 0.31), 0.72),
        "walnut": material("M_walnut", (0.28, 0.15, 0.075), 0.52),
        "cream": material("M_cream", (0.88, 0.82, 0.68), 0.76),
        "charcoal": material("M_charcoal", (0.085, 0.095, 0.09), 0.48),
        "steel": material("M_steel", (0.42, 0.45, 0.45), 0.28, 0.82),
        "brass": material("M_brass", (0.50, 0.35, 0.12), 0.32, 0.72),
        "rubber": material("M_rubber", (0.025, 0.028, 0.026), 0.88),
        "plastic": material("M_plastic", (0.18, 0.20, 0.18), 0.58),
        "glass": material("M_glass", (0.12, 0.22, 0.25), 0.16, 0.05),
        "paper": material("M_paper", (0.90, 0.86, 0.74), 0.92),
        "white": material("M_white", (0.84, 0.84, 0.78), 0.62),
        "yellow": material("M_delivery_yellow", (0.84, 0.60, 0.045), 0.48),
        "red": material("M_delivery_red", (0.43, 0.065, 0.045), 0.54),
        "light": material("M_light", (0.95, 0.78, 0.42), 0.35),
    }


def empty(name, location=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.10
    obj.location = location
    bpy.context.collection.objects.link(obj)
    if parent:
        obj.parent = parent
    return obj


def apply_mesh_transform(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.select_set(False)


def cube(name, size, location, mat, parent=None, bevel=0.025):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    apply_mesh_transform(obj)
    if bevel > 0:
        mod = obj.modifiers.new("EdgeSoftness", "BEVEL")
        mod.width = min(bevel, min(size) * 0.24)
        mod.segments = 2
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        obj.select_set(False)
    obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    return obj


def cylinder(name, radius, depth, location, mat, parent=None, rotation=(0, 0, 0), vertices=20):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    apply_mesh_transform(obj)
    obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    return obj


def collision(name, size, location, parent):
    obj = cube(name, size, location, material("M_collision", (0.8, 0.1, 0.1), 1.0), parent, bevel=0)
    obj.display_type = "WIRE"
    obj.hide_render = True
    obj["collision"] = True
    obj["simplified"] = True
    return obj


def text_mesh(name, text, location, scale, mat, parent, rotation=(math.pi / 2, 0, 0)):
    bpy.ops.object.text_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.body = text
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.extrude = 0.003
    obj.data.bevel_depth = 0.001
    obj.data.size = scale
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    apply_mesh_transform(obj)
    obj.parent = parent
    return obj


def new_root(asset_id, dimensions):
    root = empty(asset_id)
    root["asset_id"] = asset_id
    root["build_version"] = BUILD_VERSION
    root["builder"] = SCRIPT.relative_to(ROOT).as_posix()
    root["dimensions_m"] = list(dimensions)
    root["external_assets"] = []
    root["license"] = "Project-owned original"
    return root


def build_worktable(M):
    root = new_root("delivery_worktable", (1.70, 0.78, 0.92))
    cube("Worktop", (1.70, 0.78, 0.085), (0, 0, 0.855), M["walnut"], root, 0.035)
    cube("Backsplash", (1.70, 0.055, 0.28), (0, 0.36, 0.99), M["green"], root, 0.018)
    for x in (-0.72, 0.72):
        for y in (-0.28, 0.28):
            cube(f"Leg_{x}_{y}", (0.095, 0.095, 0.80), (x, y, 0.40), M["charcoal"], root, 0.018)
    cube("LowerShelf", (1.46, 0.60, 0.055), (0, 0, 0.25), M["sage"], root, 0.018)
    cube("FrontRail", (1.46, 0.055, 0.15), (0, -0.31, 0.69), M["green"], root, 0.015)
    # Restrained brass ruler inset along the working edge.
    cube("BrassMeasureStrip", (1.40, 0.018, 0.012), (0, -0.385, 0.902), M["brass"], root, 0.004)
    for i in range(15):
        cube(f"MeasureTick_{i:02d}", (0.008, 0.026, 0.004), (-0.65 + i * 0.093, -0.397, 0.912), M["charcoal"], root, 0)
    # Cutter dock and small tape well make the station operational, not decorative.
    cube("CutterDock", (0.24, 0.09, 0.035), (0.56, 0.23, 0.918), M["charcoal"], root, 0.015)
    cylinder("TapeWell", 0.075, 0.025, (-0.58, 0.23, 0.918), M["brass"], root, vertices=24)
    empty("SOCKET_BoxSurface", (0, -0.04, 0.925), root)["surface"] = "worktable"
    empty("SOCKET_CutterDock", (0.56, 0.23, 0.95), root)["tool"] = "box_cutter"
    collision("COL_Worktable", (1.72, 0.80, 0.90), (0, 0, 0.45), root)
    return root


def build_stock_shelf(M):
    root = new_root("delivery_stock_shelf", (2.25, 0.68, 2.10))
    for x in (-1.06, 1.06):
        for y in (-0.28, 0.28):
            cube(f"Upright_{x}_{y}", (0.07, 0.07, 2.05), (x, y, 1.025), M["charcoal"], root, 0.012)
    shelf_z = (0.12, 0.62, 1.12, 1.62, 2.02)
    for i, z in enumerate(shelf_z):
        cube(f"Shelf_{i}", (2.20, 0.64, 0.055), (0, 0, z), M["sage"] if i < 4 else M["green"], root, 0.012)
        if i < 4:
            cube(f"ShelfLip_{i}", (2.20, 0.035, 0.09), (0, -0.31, z + 0.055), M["green"], root, 0.008)
    cube("Header", (2.18, 0.07, 0.28), (0, 0.27, 1.88), M["cream"], root, 0.018)
    text_mesh("HeaderLabel", "RECEIVING RESERVE", (0, 0.308, 1.89), 0.105, M["green"], root, rotation=(math.pi / 2, 0, 0))
    slot = 0
    for row, z in enumerate((0.18, 0.68, 1.18, 1.68)):
        for col, x in enumerate((-0.68, 0, 0.68)):
            anchor = empty(f"SOCKET_Box_{slot:02d}", (x, 0, z), root)
            anchor["surface"] = "stock_shelf"
            anchor["slot"] = slot
            slot += 1
    collision("COL_StockShelf", (2.25, 0.70, 2.08), (0, 0, 1.04), root)
    return root


def build_cutter(M):
    root = new_root("delivery_box_cutter", (0.045, 0.17, 0.030))
    cube("CutterBody", (0.042, 0.145, 0.026), (0, 0, 0), M["yellow"], root, 0.012)
    cube("CutterGrip", (0.044, 0.075, 0.030), (0, 0.025, 0), M["rubber"], root, 0.010)
    cube("CutterSliderRail", (0.022, 0.075, 0.006), (0, -0.025, 0.016), M["charcoal"], root, 0.004)
    slider = empty("CutterSliderPivot", (0, -0.038, 0.020), root)
    slider["axis"] = "Y"
    slider["travel_m"] = 0.055
    cube("CutterSlider", (0.020, 0.030, 0.010), (0, 0, 0), M["charcoal"], slider, 0.004)
    blade = cube("CutterBlade", (0.018, 0.052, 0.003), (0, -0.035, 0), M["steel"], slider, 0.001)
    blade["sharp_edge"] = "negative_y"
    empty("SOCKET_HandGrip", (0, 0.035, 0), root)["grip"] = "right_hand"
    empty("SOCKET_BladeTip", (0, -0.071, 0), slider)["cut_anchor"] = True
    return root


def build_recycling(M):
    root = new_root("delivery_recycling_station", (1.45, 0.62, 1.16))
    cube("StationBack", (1.42, 0.08, 1.14), (0, 0.25, 0.57), M["green"], root, 0.025)
    for x, label in ((-0.37, "FLAT"), (0.37, "PAPER")):
        cube(f"Bin_{label}", (0.62, 0.54, 0.82), (x, -0.02, 0.41), M["charcoal"], root, 0.035)
        cube(f"Lid_{label}", (0.62, 0.55, 0.07), (x, -0.02, 0.84), M["sage"], root, 0.018)
        cube(f"Slot_{label}", (0.42, 0.06, 0.055), (x, -0.305, 0.91), M["rubber"], root, 0.012)
        text_mesh(f"Label_{label}", label, (x, -0.344, 1.035), 0.11, M["cream"], root, rotation=(math.pi / 2, 0, 0))
    cube("HeaderBar", (1.38, 0.10, 0.19), (0, 0.20, 1.04), M["walnut"], root, 0.025)
    empty("SOCKET_FlatCardboard", (-0.37, -0.28, 0.93), root)["disposal"] = "cardboard"
    collision("COL_RecyclingStation", (1.45, 0.64, 1.15), (0, 0, 0.575), root)
    return root


def build_van(M):
    root = new_root("delivery_van", (1.94, 4.85, 2.25))
    # Lower body, cargo shell, hood, and gentle roof cap form a readable stylized van.
    cube("VanLowerBody", (1.90, 4.45, 0.74), (0, 0, 0.78), M["green"], root, 0.16)
    cube("VanCargoBody", (1.82, 3.18, 1.30), (0, 0.48, 1.52), M["cream"], root, 0.14)
    cube("VanCab", (1.82, 1.42, 1.12), (0, -1.60, 1.41), M["green"], root, 0.14)
    cube("VanHood", (1.74, 0.70, 0.38), (0, -2.22, 1.00), M["green"], root, 0.10)
    cube("VanRoof", (1.76, 3.85, 0.14), (0, 0.08, 2.19), M["sage"], root, 0.07)
    # Windows sit proud so the shape reads under the game's flat-ish lighting.
    cube("Windshield", (1.54, 0.055, 0.62), (0, -2.20, 1.63), M["glass"], root, 0.028)
    for x in (-0.92, 0.92):
        cube(f"SideWindow_{x}", (0.035, 0.68, 0.56), (x, -1.62, 1.64), M["glass"], root, 0.022)
        cube(f"MirrorArm_{x}", (0.18, 0.035, 0.035), (x * 1.02, -1.82, 1.54), M["charcoal"], root, 0.012)
        cube(f"Mirror_{x}", (0.06, 0.17, 0.13), (x * 1.11, -1.82, 1.54), M["charcoal"], root, 0.025)
    # Four independent wheels, all transformed and correctly aligned on X axles.
    for x in (-0.93, 0.93):
        for y in (-1.55, 1.43):
            cylinder(f"Wheel_{x}_{y}", 0.36, 0.18, (x, y, 0.55), M["rubber"], root, rotation=(0, math.pi / 2, 0), vertices=28)
            cylinder(f"Hub_{x}_{y}", 0.18, 0.185, (x, y, 0.55), M["brass"], root, rotation=(0, math.pi / 2, 0), vertices=20)
    cube("FrontBumper", (1.82, 0.16, 0.20), (0, -2.43, 0.70), M["charcoal"], root, 0.05)
    cube("RearBumper", (1.82, 0.16, 0.20), (0, 2.28, 0.70), M["charcoal"], root, 0.05)
    for x in (-0.55, 0.55):
        cube(f"Headlamp_{x}", (0.32, 0.045, 0.18), (x, -2.45, 1.05), M["light"], root, 0.025)
        cube(f"TailLamp_{x}", (0.24, 0.045, 0.30), (x, 2.37, 1.06), M["red"], root, 0.022)
    # Rear doors retain hinge pivots for a visible unloading pose.
    for sign, side in ((-1, "Left"), (1, "Right")):
        hinge = empty(f"RearDoor{side}Pivot", (sign * 0.90, 2.31, 1.47), root)
        hinge["axis"] = "Z"
        hinge["open_degrees"] = sign * 92
        cube(f"RearDoor{side}", (0.86, 0.055, 1.42), (-sign * 0.43, 0, 0), M["cream"], hinge, 0.05)
        cube(f"RearDoor{side}Inset", (0.64, 0.025, 1.13), (-sign * 0.43, -0.038, 0), M["sage"], hinge, 0.025)
    # Fictional identity; no real-world brand or logo.
    for x, rot in ((-0.925, (math.pi / 2, 0, -math.pi / 2)), (0.925, (math.pi / 2, 0, math.pi / 2))):
        text_mesh("PinehollowParcelMark", "PINEHOLLOW PARCEL", (x, 0.40, 1.68), 0.15, M["green"], root, rotation=rot)
    empty("SOCKET_Cargo", (0, 1.18, 0.88), root)["cargo_anchor"] = True
    empty("SOCKET_Driver", (-0.44, -1.62, 1.10), root)["driver_anchor"] = True
    collision("COL_DeliveryVan", (1.94, 4.82, 2.12), (0, 0, 1.06), root)
    return root


BUILDERS = {
    "delivery_worktable": build_worktable,
    "delivery_stock_shelf": build_stock_shelf,
    "delivery_box_cutter": build_cutter,
    "delivery_recycling_station": build_recycling,
    "delivery_van": build_van,
}


def descendants(root):
    result = []
    stack = [root]
    while stack:
        obj = stack.pop()
        result.append(obj)
        stack.extend(obj.children)
    return result


def asset_metrics(root):
    meshes = [obj for obj in descendants(root) if obj.type == "MESH"]
    return {
        "asset": root.name,
        "nodes": len(descendants(root)),
        "meshes": len(meshes),
        "triangles": sum(len(obj.data.loop_triangles) for obj in meshes),
        "materials": len({slot.material.name for obj in meshes for slot in obj.material_slots if slot.material}),
    }


def save_export(asset_id, root):
    for obj in descendants(root):
        if obj.type == "MESH":
            obj.data.calc_loop_triangles()
    blend_path = SOURCE_DIR / f"{asset_id}.blend"
    glb_path = EXPORT_DIR / f"{asset_id}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.ops.object.select_all(action="DESELECT")
    for obj in descendants(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )
    return asset_metrics(root)


def render_preview(asset_id, root):
    floor = cube("QA_Floor", (8, 8, 0.05), (0, 0, -0.04), material("QA_FloorMat", (0.16, 0.14, 0.11), 0.9), None, 0)
    preview_camera = {
        "delivery_box_cutter": (0.22, -0.30, 0.20),
        "delivery_van": (4.2, -5.8, 3.3),
    }.get(asset_id, (4.2, -5.8, 3.3))
    bpy.ops.object.camera_add(location=preview_camera)
    camera = bpy.context.object
    camera.name = "QA_Camera"
    target_z = 0.0 if asset_id == "delivery_box_cutter" else (1.1 if asset_id == "delivery_van" else 0.9)
    target = Vector((0, 0, target_z))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = camera
    bpy.ops.object.light_add(type="AREA", location=(3.0, -3.0, 5.0))
    key = bpy.context.object
    key.name = "QA_Key"
    key.data.energy = 900
    key.data.shape = "DISK"
    key.data.size = 4.0
    bpy.ops.object.light_add(type="AREA", location=(-3.0, 1.5, 3.0))
    fill = bpy.context.object
    fill.name = "QA_Fill"
    fill.data.energy = 500
    fill.data.size = 3.0
    scene = bpy.context.scene
    # Blender 5.1 exposes Eevee under the stable BLENDER_EEVEE identifier.
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(QA_DIR / f"{asset_id}.png")
    scene.world.color = (0.025, 0.025, 0.025)
    scene.render.film_transparent = False
    bpy.ops.render.render(write_still=True)
    for obj in (floor, camera, key, fill):
        bpy.data.objects.remove(obj, do_unlink=True)


def validate_reimport(asset_id):
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(EXPORT_DIR / f"{asset_id}.glb"))
    names = {obj.name for obj in bpy.context.scene.objects}
    if asset_id not in names:
        raise RuntimeError(f"{asset_id}: root missing after clean GLB re-import")
    if asset_id not in ("delivery_box_cutter",) and not any(name.startswith("COL_") for name in names):
        raise RuntimeError(f"{asset_id}: simplified collision mesh missing")
    if asset_id == "delivery_van" and not {"RearDoorLeftPivot", "RearDoorRightPivot"}.issubset(names):
        raise RuntimeError("delivery_van: rear door pivots missing")
    print(f"REIMPORT_OK|{asset_id}|nodes={len(names)}")


def main():
    metrics = []
    for asset_id in ASSETS:
        reset_scene()
        root = BUILDERS[asset_id](kit_materials())
        metric = save_export(asset_id, root)
        render_preview(asset_id, root)
        metrics.append(metric)
        print(f"BUILT|{asset_id}|triangles={metric['triangles']}|materials={metric['materials']}")
    for asset_id in ASSETS:
        validate_reimport(asset_id)
    report = {
        "builder": SCRIPT.relative_to(ROOT).as_posix(),
        "build_version": BUILD_VERSION,
        "external_assets": [],
        "license": "Project-owned original",
        "raw_tripo_sources_modified": False,
        "assets": metrics,
    }
    (QA_DIR / "inventory_delivery_asset_build.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(f"COMPLETE|assets={len(metrics)}|export_dir={EXPORT_DIR}")


if __name__ == "__main__":
    main()
