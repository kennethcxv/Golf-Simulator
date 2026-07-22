"""Read-only Blender audit for the property-expansion/world-overhaul baseline.

Run with:
  blender --background --factory-startup --python tools/blender/audit_property_overhaul_assets.py

The script never exports or overwrites a source asset. It imports each current runtime
GLB into a fresh scene, records production-relevant structure, and renders a neutral
three-quarter preview beside the in-game baseline screenshots.
"""

import bpy
import json
import mathutils
import os


ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "qa", "property-expansion-world-overhaul", "baseline", "blender")
os.makedirs(OUT, exist_ok=True)

ASSETS = [
    ("tractor_restored_ai", "vendor/models/tractor_red.glb", "weak"),
    ("tractor_broken_ai", "vendor/models/tractor_broken.glb", "weak"),
    ("tractor_scripted_fallback", "vendor/models/tractor.glb", "placeholder"),
    ("golf_cart_ambient", "vendor/models/golf_cart.glb", "weak"),
    ("maintenance_shed", "vendor/models/shed.glb", "weak"),
    ("leaf_pile", "vendor/models/leaves_pile.glb", "weak"),
    ("club_entrance_sign", "vendor/models/club_sign.glb", "weak"),
    ("tee_sign_broken", "vendor/models/tee_sign_broken.glb", "weak"),
    ("tee_sign_restored", "vendor/models/course_sign.glb", "weak"),
    ("groundskeeper_house", "vendor/models/clubhouse_ext_opt.glb", "weak"),
    ("tree_default", "vendor/models/trees/tree_default.glb", "placeholder"),
    ("tree_oak", "vendor/models/trees/tree_oak.glb", "placeholder"),
    ("tree_pine", "vendor/models/trees/tree_pineDefaultA.glb", "placeholder"),
]


def wipe():
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


def setup_studio():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 480
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.055, 0.065, 0.06)


def bounds(meshes):
    points = []
    for obj in meshes:
        points.extend(obj.matrix_world @ mathutils.Vector(corner) for corner in obj.bound_box)
    xs = [point.x for point in points]
    ys = [point.y for point in points]
    zs = [point.z for point in points]
    minimum = mathutils.Vector((min(xs), min(ys), min(zs)))
    maximum = mathutils.Vector((max(xs), max(ys), max(zs)))
    return minimum, maximum, (minimum + maximum) * 0.5


def add_studio(minimum, maximum, center):
    size = maximum - minimum
    radius = max(size) * 0.5 + 0.05
    distance = radius * 3.4
    camera_position = center + mathutils.Vector((distance * 0.78, -distance, distance * 0.62))
    bpy.ops.object.camera_add(location=camera_position)
    camera = bpy.context.object
    camera.data.lens = 55
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = camera

    bpy.ops.object.light_add(
        type="AREA",
        location=center + mathutils.Vector((distance * 0.8, -distance * 0.6, distance)),
    )
    key = bpy.context.object
    key.data.energy = 650 * (radius * radius + 0.15)
    key.data.shape = "DISK"
    key.data.size = max(1.0, radius * 2.5)

    bpy.ops.object.light_add(
        type="AREA",
        location=center + mathutils.Vector((-distance * 0.7, -distance * 0.25, distance * 0.45)),
    )
    fill = bpy.context.object
    fill.data.energy = 220 * (radius * radius + 0.15)
    fill.data.size = max(1.0, radius * 3.0)

    bpy.ops.object.light_add(
        type="AREA",
        location=center + mathutils.Vector((0, distance * 0.55, distance * 0.75)),
    )
    rim = bpy.context.object
    rim.data.energy = 280 * (radius * radius + 0.15)
    rim.data.size = max(1.0, radius * 2.0)

    bpy.ops.mesh.primitive_plane_add(size=max(2.0, radius * 5.0), location=(center.x, center.y, minimum.z - 0.01))
    floor = bpy.context.object
    floor.name = "QA_Floor"
    floor_mat = bpy.data.materials.new("QA_Floor_Material")
    floor_mat.diffuse_color = (0.14, 0.16, 0.145, 1.0)
    floor_mat.roughness = 0.95
    floor.data.materials.append(floor_mat)


rows = []
for asset_id, relative_path, classification in ASSETS:
    wipe()
    setup_studio()
    path = os.path.join(ROOT, *relative_path.split("/"))
    row = {
        "id": asset_id,
        "path": relative_path,
        "baselineClassification": classification,
        "exists": os.path.exists(path),
    }
    if not row["exists"]:
        rows.append(row)
        continue

    bpy.ops.import_scene.gltf(filepath=path)
    imported = [obj for obj in bpy.context.scene.objects if obj.type not in {"CAMERA", "LIGHT"}]
    meshes = [obj for obj in imported if obj.type == "MESH"]
    if not meshes:
        row["error"] = "no mesh objects"
        rows.append(row)
        continue

    minimum, maximum, center = bounds(meshes)
    dimensions = maximum - minimum
    triangles = 0
    material_names = set()
    missing_uv = []
    non_applied = []
    origins = []
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        material_names.update(material.name for material in obj.data.materials if material)
        if not obj.data.uv_layers:
            missing_uv.append(obj.name)
        if any(abs(scale - 1.0) > 1e-4 for scale in obj.scale):
            non_applied.append({"object": obj.name, "scale": list(obj.scale)})
        origin = obj.matrix_world.translation
        origins.append({
            "object": obj.name,
            "fromBoundsCenterMeters": [round(value, 4) for value in (origin - center)],
            "fromGroundMeters": round(origin.z - minimum.z, 4),
        })

    names = [obj.name for obj in imported]
    actions = sorted(action.name for action in bpy.data.actions)
    row.update({
        "objectCount": len(imported),
        "meshCount": len(meshes),
        "triangles": triangles,
        "materialCount": len(material_names),
        "dimensionsMetersAssetSpace": [round(value, 4) for value in dimensions],
        "boundsMinMeters": [round(value, 4) for value in minimum],
        "boundsMaxMeters": [round(value, 4) for value in maximum],
        "rootObjectNames": sorted(obj.name for obj in imported if obj.parent is None),
        "objectNames": sorted(names),
        "animationActions": actions,
        "hasAnimations": bool(actions),
        "hasNamedCollisionProxy": any("coll" in name.lower() for name in names),
        "hasNamedLod": any("lod" in name.lower() for name in names),
        "missingUvObjects": sorted(missing_uv),
        "nonAppliedMeshTransforms": non_applied,
        "meshOrigins": origins,
    })

    add_studio(minimum, maximum, center)
    preview = os.path.join(OUT, f"{asset_id}.png")
    bpy.context.scene.render.filepath = preview
    bpy.ops.render.render(write_still=True)
    row["preview"] = os.path.relpath(preview, ROOT).replace("\\", "/")
    rows.append(row)

report = {
    "blenderVersion": bpy.app.version_string,
    "sourceProtection": "read-only imports; no exports and no source assets overwritten",
    "assets": rows,
    "missingRuntimeModelCategories": [
        "vacuum world model",
        "vacuum first-person rigged model",
        "pressure washer machine model",
        "pressure washer first-person rigged model",
        "rigged production character model",
    ],
}
with open(os.path.join(OUT, "asset-audit.json"), "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2)

print(json.dumps(report, indent=2))
