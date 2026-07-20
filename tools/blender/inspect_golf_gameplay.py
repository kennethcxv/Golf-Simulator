"""Inspect and render the generated live-golf gameplay kit.

Run:
  blender --background --factory-startup --python tools/blender/inspect_golf_gameplay.py

The script imports the shipped GLB, validates its production hierarchy, prints
per-root dimensions/triangle/material/UV facts, and writes a studio preview.
"""

import math
import os

import bpy
from mathutils import Vector


ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SOURCE = os.path.join(ROOT, 'vendor', 'models', 'golf_gameplay_kit.glb')
OUT_DIR = os.path.join(ROOT, 'qa', 'golf-gameplay-loop', 'assets')
PREVIEW = os.path.join(OUT_DIR, 'golf-gameplay-kit.png')
ROOT_NAMES = ('GolfBag', 'GolfClub', 'StarterStand', 'RangeBasket', 'GolfBall')
EXPECTED_COLLIDERS = {'COLLIDER_GolfBag', 'COLLIDER_StarterStand'}
os.makedirs(OUT_DIR, exist_ok=True)


def descendants(root):
    return [root, *list(root.children_recursive)]


def bounds(objects):
    points = []
    for obj in objects:
        if obj.type != 'MESH' or obj.name.startswith('COLLIDER_'):
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    low = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    high = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return low, high


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=SOURCE)

rows = []
for name in ROOT_NAMES:
    root = bpy.data.objects.get(name)
    assert root is not None, f'missing root: {name}'
    members = descendants(root)
    meshes = [obj for obj in members if obj.type == 'MESH' and not obj.name.startswith('COLLIDER_')]
    assert meshes, f'{name} has no render meshes'
    triangles = 0
    materials = set()
    for mesh in meshes:
        mesh.data.calc_loop_triangles()
        triangles += len(mesh.data.loop_triangles)
        assert mesh.data.uv_layers, f'{mesh.name} has no UV map'
        assert all(abs(value - 1.0) < 1e-5 for value in mesh.scale), f'{mesh.name} has unapplied scale'
        materials.update(material.name for material in mesh.data.materials if material)
    low, high = bounds(members)
    size = high - low
    rows.append((name, triangles, len(materials), tuple(round(v, 4) for v in size)))

colliders = {obj.name for obj in bpy.context.scene.objects if obj.name.startswith('COLLIDER_')}
assert colliders == EXPECTED_COLLIDERS, f'collision proxies changed: {sorted(colliders)}'
assert bpy.data.objects['GolfClub'].get('pivot') == 'grip'
assert bpy.data.objects['GolfBag'].get('pivot') == 'floor-center'
assert bpy.data.objects['StarterStand'].get('pivot') == 'floor-center'
assert bpy.data.objects['GolfBall'].get('pivot') == 'true-center'

for obj in bpy.context.scene.objects:
    if obj.name.startswith('COLLIDER_'):
        obj.hide_render = True

# The authored roots are already arranged as a compact contact sheet.
bpy.ops.mesh.primitive_plane_add(size=7.5, location=(0, 0.2, -0.015))
floor = bpy.context.object
floor.name = 'InspectionFloor'
floor_mat = bpy.data.materials.new('InspectionFloorMaterial')
floor_mat.diffuse_color = (0.08, 0.11, 0.075, 1)
floor.data.materials.append(floor_mat)

bpy.ops.object.light_add(type='AREA', location=(3.8, -4.5, 5.8))
key = bpy.context.object
key.data.energy = 900
key.data.shape = 'DISK'
key.data.size = 4.0
aim(key, (0, 0.4, 0.6))
bpy.ops.object.light_add(type='AREA', location=(-3.4, -1.0, 3.0))
fill = bpy.context.object
fill.data.energy = 420
fill.data.size = 3.5
aim(fill, (0, 0.4, 0.6))
bpy.ops.object.light_add(type='AREA', location=(0.5, 4.5, 4.4))
rim = bpy.context.object
rim.data.energy = 650
rim.data.size = 3.0
aim(rim, (0, 0.4, 0.7))

bpy.ops.object.camera_add(location=(4.5, -6.6, 3.15))
camera = bpy.context.object
camera.data.lens = 56
aim(camera, (0, 0.35, 0.65))

scene = bpy.context.scene
scene.camera = camera
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1200
scene.render.resolution_y = 700
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = PREVIEW
scene.render.film_transparent = False
scene.world.color = (0.035, 0.05, 0.03)
scene.view_settings.look = 'AgX - Medium High Contrast'
bpy.ops.render.render(write_still=True)

print('\nGOLF GAMEPLAY KIT')
print(f'{"ROOT":18} {"TRIS":>8} {"MATS":>6}  DIMENSIONS X x Y x Z (m)')
for name, triangles, materials, dimensions in rows:
    print(f'{name:18} {triangles:8d} {materials:6d}  {dimensions[0]:.4f} x {dimensions[1]:.4f} x {dimensions[2]:.4f}')
print('COLLIDERS          ', ', '.join(sorted(colliders)))
print('PREVIEW            ', PREVIEW)
