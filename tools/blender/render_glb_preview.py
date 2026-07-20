"""Render a turntable preview of any GLB into a PNG.

The checkout kit renders its own previews at build time, but the delivery
family (assets 41-50) is built by separate scripts that do not, so those
assets had no way to be looked at outside the running game. This fills that
gap for any GLB in the repo.

    blender --background --factory-startup --python tools/blender/render_glb_preview.py \
        -- <out_dir> <glb> [<glb> ...]
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def frame_and_render(out_png, *, azimuth=35.0, elevation=18.0, res=640):
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.visible_get()]
    if not objs:
        print(f"SKIP {out_png}: no visible meshes")
        return False

    # world-space bounds of everything that will actually render
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for o in objs:
        if o.name.startswith(("COL_", "COLLISION_")):
            continue
        for corner in o.bound_box:
            w = o.matrix_world @ __import__("mathutils").Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    if lo[0] == float("inf"):
        return False
    ctr = [(lo[i] + hi[i]) / 2 for i in range(3)]
    span = max(hi[i] - lo[i] for i in range(3)) or 1.0

    cam_data = bpy.data.cameras.new("PreviewCam")
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    bpy.context.collection.objects.link(cam)
    dist = span * 2.35
    az, el = math.radians(azimuth), math.radians(elevation)
    cam.location = (
        ctr[0] + math.cos(el) * math.sin(az) * dist,
        ctr[1] - math.cos(el) * math.cos(az) * dist,
        ctr[2] + math.sin(el) * dist,
    )
    direction = (ctr[0] - cam.location[0], ctr[1] - cam.location[1], ctr[2] - cam.location[2])
    import mathutils
    cam.rotation_euler = mathutils.Vector(direction).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam

    key = bpy.data.lights.new("Key", "AREA")
    key.energy = span * span * 900
    key.size = span * 2
    ko = bpy.data.objects.new("Key", key)
    ko.location = (ctr[0] + span, ctr[1] - span * 1.4, ctr[2] + span * 1.6)
    ko.rotation_euler = mathutils.Vector(
        (ctr[0] - ko.location[0], ctr[1] - ko.location[1], ctr[2] - ko.location[2])
    ).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(ko)

    world = bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.42, 0.44, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.1
    bpy.context.scene.world = world

    sc = bpy.context.scene
    # Some registered engines (Hydra) expose no bl_idname, so probe by assignment.
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
        try:
            sc.render.engine = engine
            break
        except TypeError:
            continue
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    # Must be absolute: Blender resolves a relative render path against the
    # blend file's directory, which in --factory-startup is not the cwd.
    sc.render.filepath = str(Path(out_png).resolve())
    bpy.ops.render.render(write_still=True)
    wrote = Path(out_png).resolve().exists()
    print(f"  -> engine={sc.render.engine} path={sc.render.filepath} exists={wrote}")
    return wrote


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 2:
        raise SystemExit("usage: -- <out_dir> <glb> [<glb> ...]")
    out_dir = Path(argv[0])
    out_dir.mkdir(parents=True, exist_ok=True)
    for src in argv[1:]:
        p = Path(src)
        if not p.exists():
            print(f"MISSING {p}")
            continue
        clear()
        bpy.ops.import_scene.gltf(filepath=str(p))
        ok = frame_and_render(out_dir / f"{p.stem}.png")
        print(("RENDERED " if ok else "FAILED ") + p.stem)
    print("COMPLETE")


if __name__ == "__main__":
    main()
