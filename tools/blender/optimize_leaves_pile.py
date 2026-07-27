"""Build the runtime leaves pile from the untouched owner-supplied Tripo GLB.

Run with:
  blender --background --factory-startup --python tools/blender/optimize_leaves_pile.py

The source GLB is never modified. The derived .blend keeps the packed, resized
PBR images and the runtime GLB is exported into the existing vendor pipeline.
"""

from pathlib import Path
import math

import bpy
import mathutils


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "Assets" / "fallen+leaves+pile+3d+model.glb"
SOURCE_DIR = ROOT / "Assets" / "course_props" / "source"
BLEND = SOURCE_DIR / "leaves_pile_optimized.blend"
OUTPUT = ROOT / "vendor" / "models" / "leaves_pile.glb"
TEXTURE_MAX = 1024
DECIMATE_RATIO = 0.55


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)


def world_bounds(objects):
    points = []
    for obj in objects:
        points.extend(obj.matrix_world @ mathutils.Vector(corner) for corner in obj.bound_box)
    mins = mathutils.Vector(tuple(min(point[i] for point in points) for i in range(3)))
    maxs = mathutils.Vector(tuple(max(point[i] for point in points) for i in range(3)))
    return mins, maxs


def apply_transforms(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def main():
    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("leaves pile source contains no mesh")
    before_min, before_max = world_bounds(meshes)

    # The source currently has one mesh. Joining remains deterministic if the
    # provider later splits it, while preserving material slots and UVs.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    pile = bpy.context.view_layer.objects.active
    pile.name = "leaves_pile"
    apply_transforms(pile)

    modifier = pile.modifiers.new(name="RuntimeDecimate", type="DECIMATE")
    modifier.ratio = DECIMATE_RATIO
    modifier.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = pile
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.ops.object.shade_smooth_by_angle()

    resized = []
    for image in bpy.data.images:
        width, height = image.size
        largest = max(width, height)
        if largest > TEXTURE_MAX:
            scale = TEXTURE_MAX / largest
            new_width = max(1, int(round(width * scale)))
            new_height = max(1, int(round(height * scale)))
            image.scale(new_width, new_height)
            resized.append((image.name, width, height, new_width, new_height))
        image.pack()

    after_min, after_max = world_bounds([pile])
    bound_error = max(
        abs(before_min[i] - after_min[i]) for i in range(3)
    ) + max(abs(before_max[i] - after_max[i]) for i in range(3))
    if bound_error > 0.005:
        raise RuntimeError(f"bounds changed by {bound_error:.6f} m")

    pile.data.calc_loop_triangles()
    triangles = len(pile.data.loop_triangles)
    if triangles <= 0:
        raise RuntimeError("decimation produced an empty mesh")
    if not pile.data.uv_layers:
        raise RuntimeError("runtime mesh lost its UV map")

    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), check_existing=False)
    bpy.ops.object.select_all(action="DESELECT")
    pile.select_set(True)
    bpy.context.view_layer.objects.active = pile
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_jpeg_quality=85,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )

    dims = after_max - after_min
    print(
        "LEAVES_PILE_OPTIMIZED "
        f"triangles={triangles} bounds={dims.x:.4f}x{dims.y:.4f}x{dims.z:.4f} "
        f"textures={resized} blend={BLEND} output={OUTPUT}"
    )


if __name__ == "__main__":
    main()
