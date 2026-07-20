"""Reduce oversized texture sets on course props proven resident at runtime.

Run with:
  blender --background --factory-startup --python tools/blender/optimize_course_runtime_textures.py

Every owner-supplied Tripo GLB under ``Assets/`` is hashed before and after the
build and is never opened for writing. The already normalized/decimated runtime
GLBs are the inputs. Derived editable .blend files and replacement runtime GLBs
retain geometry, UVs, material slots, pivots, and world bounds.
"""

from pathlib import Path
import hashlib

import bpy
import mathutils


ROOT = Path(__file__).resolve().parents[2]
RUNTIME_DIR = ROOT / "vendor" / "models"
SOURCE_DIR = ROOT / "Assets" / "course_props" / "source" / "runtime_textures"
BOUND_EPSILON_METERS = 0.0005

# Small, simple silhouettes use 1K. Large props, signage, and first-person held
# tools retain 2K because they can fill a meaningful part of the player camera.
ASSETS = (
    ("belt", "rubber+belt+3d+model.glb", 1024),
    ("bucket_soil", "bucket+with+soil+3d+model.glb", 2048),
    ("gas_can", "gasoline+can+3d+model.glb", 1024),
    ("tractor_broken", "tractor+3d+model.glb", 2048),
    ("shed", "garden+shed+3d+model.glb", 2048),
    ("rake", "rake+3d+model.glb", 2048),
    ("workbench", "wooden+workbench+3d+model.glb", 2048),
    ("golf_cart", "golf+cart+3d+model.glb", 2048),
    ("hose_nozzle", "garden+hose+nozzle+3d+model.glb", 2048),
    ("hand_fork", "garden+hand+fork+3d+model.glb", 2048),
    ("club_sign", "golf+club+sign+3d+model.glb", 2048),
    ("tee_sign_broken", "wooden+sign+3d+model.glb", 2048),
    ("tractor_red", "red+tractor+3d+model.glb", 2048),
    ("tool_chest", "tool+chest+3d+model.glb", 1024),
    # Conditional repaired-state assets.
    ("mower_deck", "red+agricultural+machine+3d+model.glb", 2048),
    ("course_sign", "golf+course+sign+3d+model.glb", 2048),
)


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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


def max_bounds_error(before, after):
    before_min, before_max = before
    after_min, after_max = after
    return max(
        *(abs(before_min[i] - after_min[i]) for i in range(3)),
        *(abs(before_max[i] - after_max[i]) for i in range(3)),
    )


def triangle_count(objects):
    total = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def apply_rotation_scale(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    # Keep locations/pivots intact; bake only rotation and scale.
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def optimize_asset(name, raw_name, texture_max):
    runtime_glb = RUNTIME_DIR / f"{name}.glb"
    raw_glb = ROOT / "Assets" / raw_name
    if not runtime_glb.exists():
        raise FileNotFoundError(runtime_glb)
    if not raw_glb.exists():
        raise FileNotFoundError(raw_glb)
    raw_hash_before = sha256_file(raw_glb)

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
        if largest > texture_max:
            scale = texture_max / largest
            new_width = max(1, int(round(width * scale)))
            new_height = max(1, int(round(height * scale)))
            image.scale(new_width, new_height)
            resized.append((image.name, width, height, new_width, new_height))
        image.pack()
    if not resized:
        # Repeatable build: assets already at or below their declared tier need
        # no round-trip. Still prove the immutable raw source did not change.
        raw_hash_after = sha256_file(raw_glb)
        if raw_hash_after != raw_hash_before:
            raise RuntimeError(f"{name}: raw source changed during build")
        print(
            "COURSE_RUNTIME_TEXTURE_CURRENT "
            f"name={name} raw_sha256={raw_hash_after} texture_max={texture_max} "
            f"input={runtime_glb}"
        )
        return

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

    blend_path = SOURCE_DIR / f"{name}_runtime_{texture_max // 1024}k.blend"
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

    raw_hash_after = sha256_file(raw_glb)
    if raw_hash_after != raw_hash_before:
        raise RuntimeError(f"{name}: raw source changed during build")
    dimensions = after_bounds[1] - after_bounds[0]
    print(
        "COURSE_RUNTIME_TEXTURE_OPTIMIZED "
        f"name={name} raw_sha256={raw_hash_after} triangles={after_triangles} "
        f"bounds={dimensions.x:.6f}x{dimensions.y:.6f}x{dimensions.z:.6f} "
        f"bounds_error={bounds_error:.9f} texture_max={texture_max} "
        f"textures={resized} blend={blend_path} output={runtime_glb}"
    )


def main():
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    for name, raw_name, texture_max in ASSETS:
        optimize_asset(name, raw_name, texture_max)


if __name__ == "__main__":
    main()
