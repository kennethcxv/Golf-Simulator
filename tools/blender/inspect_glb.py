# Inspect every generated GLB and render a contact sheet.
# Nothing goes into the game unlooked-at.
#
#   blender --background --factory-startup --python tools/blender/inspect_glb.py
#
# Prints, per asset: shipped triangle count (post-modifier, as exported),
# material slots, UV presence, and real bounding-box dimensions in metres.
# Renders a 3/4 preview of each to qa/assets/models/.

import bpy
import os
import math
import glob

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC = os.path.join(ROOT, 'vendor', 'models', 'clubhouse')
OUT = os.path.join(ROOT, 'qa', 'assets', 'models')
os.makedirs(OUT, exist_ok=True)


def wipe():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()


def setup_studio():
    scn = bpy.context.scene
    scn.render.engine = 'BLENDER_EEVEE'
    scn.render.resolution_x = 480
    scn.render.resolution_y = 480
    scn.render.film_transparent = False
    world = bpy.data.worlds.new('W')
    scn.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.35, 0.36, 0.38, 1)
    bg.inputs['Strength'].default_value = 1.2


def frame_object(o):
    # bounding sphere -> camera distance
    bb = [o.matrix_world @ __import__('mathutils').Vector(c) for c in o.bound_box]
    xs = [v.x for v in bb]; ys = [v.y for v in bb]; zs = [v.z for v in bb]
    cx, cy, cz = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2
    r = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)) * 0.5 + 1e-4
    d = r * 3.6

    bpy.ops.object.camera_add(location=(cx + d * 0.72, cy - d * 0.72, cz + d * 0.55))
    cam = bpy.context.object
    # aim at the centre
    import mathutils
    direction = mathutils.Vector((cx, cy, cz)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam

    bpy.ops.object.light_add(type='AREA', location=(cx + d, cy - d * 0.6, cz + d))
    k = bpy.context.object
    k.data.energy = 300 * (r * r + 0.05)
    k.data.size = r * 3
    bpy.ops.object.light_add(type='AREA', location=(cx - d * 0.8, cy - d * 0.5, cz + d * 0.3))
    f = bpy.context.object
    f.data.energy = 90 * (r * r + 0.05)
    f.data.size = r * 4
    return cam


rows = []
only = {name.strip() for name in os.environ.get('GLB_FILTER', '').split(',') if name.strip()}
paths = sorted(glob.glob(os.path.join(SRC, '*.glb')))
if only:
    paths = [path for path in paths if os.path.splitext(os.path.basename(path))[0] in only]
for path in paths:
    name = os.path.splitext(os.path.basename(path))[0]
    wipe()
    setup_studio()
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        rows.append((name, 'NO MESH', 0, 0, '-', '-'))
        continue

    tris = 0
    slots = set()
    uv_ok = True
    for o in meshes:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
        for m in o.data.materials:
            if m:
                slots.add(m.name)
        if not o.data.uv_layers:
            uv_ok = False

    # bounds across every mesh
    import mathutils
    pts = []
    for o in meshes:
        for c in o.bound_box:
            pts.append(o.matrix_world @ mathutils.Vector(c))
    xs = [v.x for v in pts]; ys = [v.y for v in pts]; zs = [v.z for v in pts]
    dim = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))

    # join for framing
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.object

    frame_object(obj)
    bpy.context.scene.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)

    rows.append((name, 'ok', tris, len(slots), 'yes' if uv_ok else 'NO UV',
                 '%.3f x %.3f x %.3f' % dim))

print('\n' + '=' * 92)
print('%-16s %-6s %8s %6s %7s   %s' % ('ASSET', 'STATE', 'TRIS', 'MATS', 'UVS', 'DIMENSIONS (m, XxYxZ)'))
print('=' * 92)
for r in rows:
    print('%-16s %-6s %8s %6s %7s   %s' % r)
print('=' * 92)
print('previews ->', OUT)
