"""Measure and render the generated maintenance GLBs."""

import bpy
import mathutils
import os

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'qa', 'course-maintenance', 'assets')
os.makedirs(OUT, exist_ok=True)
FILES = ['greens_mower.glb', 'rotary_spreader.glb', 'treatment_sprayer.glb']


def wipe():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)


def bounds(meshes):
    points = [obj.matrix_world @ mathutils.Vector(corner) for obj in meshes for corner in obj.bound_box]
    axes = [[point[i] for point in points] for i in range(3)]
    return tuple(max(axis) - min(axis) for axis in axes), tuple((max(axis) + min(axis)) / 2 for axis in axes)


def studio(dimensions, center):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 900
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    scene.world.color = (0.055, 0.07, 0.06)
    radius = max(dimensions) * 0.6
    distance = radius * 4.0
    camera_location = mathutils.Vector((center[0] + distance * 0.75, center[1] - distance, center[2] + distance * 0.62))
    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.object
    camera.rotation_euler = (mathutils.Vector(center) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camera
    for location, energy, size in [
        ((center[0] + distance, center[1] - distance, center[2] + distance), 700, radius * 3),
        ((center[0] - distance, center[1] - distance * 0.4, center[2] + distance * 0.5), 280, radius * 4),
    ]:
        bpy.ops.object.light_add(type='AREA', location=location)
        bpy.context.object.data.energy = energy
        bpy.context.object.data.shape = 'DISK'
        bpy.context.object.data.size = size
    bpy.ops.mesh.primitive_plane_add(size=8, location=(center[0], center[1], 0))
    floor = bpy.context.object
    floor_mat = bpy.data.materials.new('Studio floor')
    floor_mat.diffuse_color = (0.15, 0.17, 0.14, 1)
    floor.data.materials.append(floor_mat)


rows = []
for filename in FILES:
    wipe()
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'vendor', 'models', filename))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    visible = [obj for obj in meshes if not obj.name.startswith('COLLISION_')]
    proxies = [obj for obj in meshes if obj.name.startswith('COLLISION_')]
    dimensions, center = bounds(visible)
    triangles = 0
    uv_ok = True
    materials = set()
    for obj in visible:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        uv_ok = uv_ok and bool(obj.data.uv_layers)
        materials.update(material.name for material in obj.data.materials if material)
    for proxy in proxies:
        proxy.hide_render = True
    studio(dimensions, center)
    bpy.context.scene.render.filepath = os.path.join(OUT, filename.replace('.glb', '.png'))
    bpy.ops.render.render(write_still=True)
    rows.append({
        'asset': filename,
        'dimensions_m': tuple(round(value, 3) for value in dimensions),
        'triangles': triangles,
        'materials': len(materials),
        'uvs': uv_ok,
        'collision_proxies': [proxy.name for proxy in proxies],
    })

print('COURSE MAINTENANCE ASSET INSPECTION')
for row in rows:
    print(row)
print('PREVIEWS', OUT)
