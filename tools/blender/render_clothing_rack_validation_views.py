"""Render repeatable multi-angle inspection views for every clothing rack.

Run with:
  blender --background --factory-startup --python \
    tools/blender/render_clothing_rack_validation_views.py

The source .blend files remain untouched.  Only QA PNGs and a JSON index are
written beneath qa/clothing_racks/blender/inspection.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

import bpy
from mathutils import Vector


REPO = Path(os.environ.get("GF_REPO_ROOT", Path(__file__).resolve().parents[2])).resolve()
MANIFEST = REPO / "Assets" / "pro_shop_furniture" / "clothing-racks-manifest.json"
OUTPUT = REPO / "qa" / "clothing_racks" / "blender" / "inspection"


def look_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def material(name: str, rgba: tuple[float, float, float, float], roughness: float) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.diffuse_color = rgba
    result.use_nodes = True
    principled = result.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = rgba
    principled.inputs["Roughness"].default_value = roughness
    return result


def add_stage(width: float, height: float, depth: float) -> bpy.types.Object:
    floor_material = material("QA_InspectionFloor", (0.38, 0.35, 0.29, 1.0), 0.88)
    bpy.ops.mesh.primitive_cube_add(location=(0.0, 0.0, -0.03), scale=(5.0, 5.0, 0.03))
    floor = bpy.context.object
    floor.name = "QA_InspectionFloor"
    floor.data.materials.append(floor_material)

    lights = (
        ("QA_Key", (width * 1.25, -2.8, height * 1.45), 720.0, 3.4, (1.0, 0.72, 0.48)),
        ("QA_Fill", (-width * 1.30, -1.8, height * 0.92), 430.0, 3.0, (0.62, 0.76, 1.0)),
        ("QA_Back", (-width * 0.55, 2.5, height * 1.18), 610.0, 3.0, (1.0, 0.57, 0.33)),
        ("QA_Side", (width * 1.55, 1.1, height * 0.75), 380.0, 2.6, (0.72, 0.88, 1.0)),
        ("QA_Top", (0.0, 0.0, height * 1.85), 480.0, 2.8, (1.0, 0.84, 0.63)),
    )
    for name, location, energy, size, color in lights:
        light_data = bpy.data.lights.new(f"{name}_Data", type="AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light_data.color = color
        light = bpy.data.objects.new(name, light_data)
        bpy.context.collection.objects.link(light)
        light.location = location
        look_at(light, (0.0, 0.0, height * 0.52))

    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.name = "QA_InspectionCamera"
    camera.data.lens = 50.0
    camera.data.sensor_width = 36.0
    camera.data.clip_start = 0.03
    camera.data.clip_end = 100.0
    return camera


def configure_render(camera: bpy.types.Object) -> None:
    scene = bpy.context.scene
    scene.camera = camera
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except (TypeError, ValueError):
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.world.color = (0.026, 0.028, 0.027)
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass


def views(tier: str, width: float, height: float, depth: float) -> tuple[dict, ...]:
    front_distance = max(3.15, width * 1.62, height * 1.70)
    side_distance = max(3.60, height * 2.05)
    if tier in {"basic", "standard"}:
        close_location = (width * 0.72, -0.92, height * 0.93)
        close_target = (width * 0.47, -depth * 0.05, height * 0.86)
    elif tier == "premium":
        close_location = (-width * 0.50, -1.02, height * 0.68)
        close_target = (-width * 0.38, -depth * 0.16, height * 0.60)
    else:
        close_location = (width * 0.27, -1.12, height * 0.72)
        close_target = (width * 0.27, -depth * 0.25, height * 0.65)
    return (
        {"name": "01-front", "location": (0.0, -front_distance, height * 0.58),
         "target": (0.0, 0.0, height * 0.50), "lens": 50.0},
        {"name": "02-left", "location": (-side_distance, -side_distance * 0.32, height * 0.58),
         "target": (0.0, 0.0, height * 0.50), "lens": 56.0},
        {"name": "03-right", "location": (side_distance, -side_distance * 0.32, height * 0.58),
         "target": (0.0, 0.0, height * 0.50), "lens": 56.0},
        {"name": "04-back", "location": (0.0, front_distance, height * 0.58),
         "target": (0.0, 0.0, height * 0.50), "lens": 50.0},
        {"name": "05-player-eye", "location": (width * 0.43, -max(2.35, width * 1.05), 1.65),
         "target": (0.0, -depth * 0.05, min(height * 0.52, 1.28)), "lens": 52.0},
        {"name": "06-material-closeup", "location": close_location,
         "target": close_target, "lens": 68.0},
    )


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    records: list[dict] = []
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for entry in manifest["assets"]:
        source = REPO / entry["source"]
        bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False)
        width, height, depth = entry["dimensionsM"]
        camera = add_stage(width, height, depth)
        configure_render(camera)
        tier_output = OUTPUT / entry["tier"]
        tier_output.mkdir(parents=True, exist_ok=True)
        outputs: list[str] = []
        for view in views(entry["tier"], width, height, depth):
            camera.location = view["location"]
            camera.data.lens = view["lens"]
            look_at(camera, view["target"])
            output = tier_output / f"{view['name']}.png"
            bpy.context.scene.render.filepath = str(output)
            bpy.ops.render.render(write_still=True)
            outputs.append(output.relative_to(REPO).as_posix())
        records.append({"tier": entry["tier"], "source": entry["source"], "views": outputs})
        print(f"[inspection] {entry['tier']}: {len(outputs)} views", flush=True)
    report = {
        "method": "Repeatable Eevee inspection renders from production .blend sources",
        "resolution": [640, 640],
        "viewCount": sum(len(record["views"]) for record in records),
        "assets": records,
    }
    (OUTPUT / "inspection-index.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"assets": len(records), "views": report["viewCount"]}, indent=2), flush=True)


if __name__ == "__main__":
    main()
