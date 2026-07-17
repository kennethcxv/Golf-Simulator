"""Render repeatable studio previews of the shipped checkout GLBs.

The default output is intentionally outside the repository.  Pass an optional
directory after ``--`` to override it:

    blender --background --factory-startup \
        --python tools/blender/render_checkout_assets.py -- C:/temp/previews
"""

from __future__ import annotations

import math
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
ASSETS = (
    "checkout_counter",
    "checkout_cash_drawer",
    "checkout_scanner",
    "checkout_card_reader",
    "checkout_receipt_printer",
    "checkout_shopping_bag",
)


def output_dir() -> Path:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    path = Path(args[0]).resolve() if args else Path(tempfile.gettempdir()) / "golf_flipper_checkout_qa"
    path.mkdir(parents=True, exist_ok=True)
    return path


def wipe() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.actions, bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            datablocks.remove(datablock)


def visible_meshes() -> list[bpy.types.Object]:
    result = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        hidden = obj.name.startswith("COL_") or obj.name.startswith("VOLUME_") or obj.name == "ScannerBeam"
        obj.hide_render = hidden
        if not hidden:
            result.append(obj)
    return result


def bounds(meshes: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    low = Vector(tuple(min(value[i] for value in points) for i in range(3)))
    high = Vector(tuple(max(value[i] for value in points) for i in range(3)))
    return low, high


def add_studio(meshes: list[bpy.types.Object], *, wide: bool = False) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 960 if wide else 720
    scene.render.resolution_y = 620 if wide else 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.resolution_percentage = 100

    world = bpy.data.worlds.get("CheckoutQAWorld") or bpy.data.worlds.new("CheckoutQAWorld")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.055, 0.067, 0.058, 1.0)
    background.inputs["Strength"].default_value = 0.55
    scene.world = world

    low, high = bounds(meshes)
    center = (low + high) * 0.5
    extent = max(high.x - low.x, high.y - low.y, high.z - low.z)
    floor_z = low.z - max(0.003, extent * 0.01)
    bpy.ops.mesh.primitive_plane_add(size=max(3.0, extent * 4.0), location=(center.x, center.y, floor_z))
    floor = bpy.context.object
    floor.name = "QA_Floor"
    material = bpy.data.materials.new("QA_FloorMaterial")
    material.diffuse_color = (0.12, 0.135, 0.115, 1.0)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.12, 0.135, 0.115, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.82
    floor.data.materials.append(material)

    distance = extent * (2.45 if wide else 2.70)
    camera_location = center + Vector((distance * 0.78, -distance, distance * 0.62))
    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.object
    camera.name = "QA_Camera"
    direction = center - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera.data.lens = 54 if wide else 58
    scene.camera = camera

    light_specs = (
        (center + Vector((extent * 0.8, -extent * 1.0, extent * 1.45)), 110, extent * 1.7),
        (center + Vector((-extent * 1.2, -extent * 0.35, extent * 0.85)), 65, extent * 1.9),
        (center + Vector((extent * 0.1, extent * 1.4, extent * 1.0)), 80, extent * 1.4),
    )
    for index, (location, energy, size) in enumerate(light_specs):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = f"QA_Light_{index + 1}"
        light.data.energy = energy * max(0.25, extent * extent)
        light.data.size = max(0.4, size)
        light.rotation_euler = (center - location).to_track_quat("-Z", "Y").to_euler()


def render(path: Path, *, wide: bool = False) -> None:
    meshes = visible_meshes()
    add_studio(meshes, wide=wide)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    print(f"RENDERED|{path}")


def render_drawer_closeup(path: Path) -> None:
    """Render the interaction surface at roughly the in-game cashier angle."""
    meshes = visible_meshes()
    add_studio(meshes, wide=True)
    scene = bpy.context.scene
    scene.render.resolution_y = 720
    camera = scene.camera
    target = Vector((0.0, -0.31, 0.095))
    camera.location = Vector((0.42, -1.03, 0.61))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.lens = 62
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    print(f"RENDERED|{path}")


def import_asset(asset_id: str) -> bpy.types.Object:
    bpy.ops.import_scene.gltf(filepath=str(EXPORT_DIR / f"{asset_id}.glb"))
    root = bpy.data.objects.get(asset_id)
    if root is None:
        raise RuntimeError(f"GLB is missing expected root node: {asset_id}")
    return root


def activate_clip(action_name: str, object_name: str, frame: int) -> None:
    obj = bpy.data.objects[object_name]
    action = bpy.data.actions[action_name]
    if obj.animation_data is None:
        obj.animation_data_create()
    obj.animation_data.action = action
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()


def render_individuals(out: Path) -> None:
    for asset_id in ASSETS:
        wipe()
        import_asset(asset_id)
        render(out / f"{asset_id}.png", wide=asset_id == "checkout_counter")

    state_renders = (
        ("checkout_cash_drawer", "DrawerSlide_OpenHoldClose", "DrawerSlide", 24, "checkout_cash_drawer_open.png"),
        ("checkout_receipt_printer", "ReceiptPaper_PrintFeed", "ReceiptPaper", 38, "checkout_receipt_printer_printing.png"),
        ("checkout_shopping_bag", "BagHandleFront_Gather", "BagHandleFrontPivot", 32, "checkout_shopping_bag_handle.png"),
    )
    for asset_id, action, obj, frame, filename in state_renders:
        wipe()
        import_asset(asset_id)
        activate_clip(action, obj, frame)
        if asset_id == "checkout_shopping_bag":
            activate_clip("BagHandleBack_Gather", "BagHandleBackPivot", frame)
        render(out / filename)

    wipe()
    import_asset("checkout_cash_drawer")
    activate_clip("DrawerSlide_OpenHoldClose", "DrawerSlide", 24)
    render_drawer_closeup(out / "checkout_cash_drawer_labels_closeup.png")

    wipe()
    import_asset("checkout_cash_drawer")
    activate_clip("DrawerSlide_OpenHoldClose", "DrawerSlide", 36)
    for denomination in (1, 5, 10, 20, 50):
        activate_clip(f"BillClip_{denomination}_Lift", f"BillClipPivot_{denomination}", 36)
    render_drawer_closeup(out / "checkout_cash_drawer_clips_lifted.png")


def render_assembly(out: Path) -> None:
    wipe()
    counter = import_asset("checkout_counter")
    del counter
    placements = {
        "checkout_cash_drawer": "ANCHOR_DrawerHousing",
        "checkout_scanner": "ANCHOR_Scanner",
        "checkout_card_reader": "ANCHOR_CardReader",
        "checkout_receipt_printer": "ANCHOR_ReceiptPrinter",
        "checkout_shopping_bag": "ANCHOR_Bag",
    }
    anchor_matrices = {anchor_name: bpy.data.objects[anchor_name].matrix_world.copy() for anchor_name in placements.values()}
    for asset_id, anchor_name in placements.items():
        root = import_asset(asset_id)
        root.matrix_world = anchor_matrices[anchor_name]
    bpy.context.view_layer.update()
    render(out / "checkout_assembly.png", wide=True)


def main() -> None:
    out = output_dir()
    render_individuals(out)
    render_assembly(out)
    print(f"COMPLETE|output={out}")


if __name__ == "__main__":
    main()
