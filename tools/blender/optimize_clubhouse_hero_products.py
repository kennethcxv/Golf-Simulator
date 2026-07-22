"""Reduce oversized atlases on repeated clubhouse hero products.

Run with:
  blender --background --factory-startup --python tools/blender/optimize_clubhouse_hero_products.py

The owner-supplied Tripo GLBs in ``Assets/`` are never touched.  This script
round-trips the already normalized/decimated runtime models, creates editable
derived Blender sources, and replaces only the runtime GLBs in the existing
vendor pipeline. Geometry, pivots, material slots, UVs, and world bounds are
validated before each export.
"""

from pathlib import Path

import bpy
import mathutils


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "Assets" / "pro_shop" / "source" / "derived"
RUNTIME_DIR = ROOT / "vendor" / "models" / "clubhouse"
TEXTURE_MAX = 2048
BOUND_EPSILON_METERS = 0.0005

PRODUCTS = (
    ("cap_pro", RUNTIME_DIR / "cap_pro.glb"),
    ("rangefinder", RUNTIME_DIR / "rangefinder.glb"),
    ("shoe_pro", RUNTIME_DIR / "shoe_pro.glb"),
)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)


def world_bounds(objects):
    points = [
        obj.matrix_world @ mathutils.Vector(corner)
        for obj in objects
        for corner in obj.bound_box
    ]
    if not points:
        raise RuntimeError("asset contains no bounded mesh")
    mins = mathutils.Vector(tuple(min(point[i] for point in points) for i in range(3)))
    maxs = mathutils.Vector(tuple(max(point[i] for point in points) for i in range(3)))
    return mins, maxs


def triangle_count(objects):
    total = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def max_bounds_error(before, after):
    before_min, before_max = before
    after_min, after_max = after
    return max(
        *(abs(before_min[i] - after_min[i]) for i in range(3)),
        *(abs(before_max[i] - after_max[i]) for i in range(3)),
    )


def apply_rotation_scale(objects):
    # Keep locations intact so authored pivots stay where gameplay expects them.
    # Rotation/scale are baked without changing world-space geometry.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def optimize_product(name, runtime_glb):
    if not runtime_glb.exists():
        raise FileNotFoundError(runtime_glb)

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(runtime_glb))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"{name}: runtime GLB contains no mesh")

    before_bounds = world_bounds(meshes)
    before_triangles = triangle_count(meshes)
    before_material_slots = sum(len(obj.material_slots) for obj in meshes)
    if before_triangles <= 0:
        raise RuntimeError(f"{name}: runtime GLB contains no triangles")
    if any(not obj.data.uv_layers for obj in meshes):
        raise RuntimeError(f"{name}: runtime mesh is missing UVs")

    apply_rotation_scale(meshes)

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

    if not resized:
        raise RuntimeError(f"{name}: no oversized image was found")

    after_bounds = world_bounds(meshes)
    after_triangles = triangle_count(meshes)
    after_material_slots = sum(len(obj.material_slots) for obj in meshes)
    bounds_error = max_bounds_error(before_bounds, after_bounds)
    if bounds_error > BOUND_EPSILON_METERS:
        raise RuntimeError(f"{name}: bounds changed by {bounds_error:.6f} m")
    if after_triangles != before_triangles:
        raise RuntimeError(
            f"{name}: triangle count changed {before_triangles} -> {after_triangles}"
        )
    if after_material_slots != before_material_slots:
        raise RuntimeError(
            f"{name}: material slots changed "
            f"{before_material_slots} -> {after_material_slots}"
        )

    blend_path = SOURCE_DIR / f"{name}_runtime_2k.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.export_scene.gltf(
        filepath=str(runtime_glb),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_jpeg_quality=90,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )

    dimensions = after_bounds[1] - after_bounds[0]
    print(
        "CLUBHOUSE_HERO_PRODUCT_OPTIMIZED "
        f"name={name} triangles={after_triangles} "
        f"bounds={dimensions.x:.6f}x{dimensions.y:.6f}x{dimensions.z:.6f} "
        f"bounds_error={bounds_error:.9f} textures={resized} "
        f"blend={blend_path} output={runtime_glb}"
    )


def main():
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    for name, runtime_glb in PRODUCTS:
        optimize_product(name, runtime_glb)


if __name__ == "__main__":
    main()
