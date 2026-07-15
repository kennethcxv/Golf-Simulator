# Inspect the RAW owner-supplied Tripo GLBs in Assets/ before processing them.
# Nothing gets normalised until it has been looked at and measured.
#
#   blender --background --factory-startup --python tools/blender/inspect_tripo.py
#
# Per asset: triangle count, material slots (do the Tripo PBR mats survive import?),
# UV presence, real bounding box in metres, and where the pivot sits relative to the
# geometry (min/centre per axis) so the normaliser knows how far to recentre. Renders
# a 3/4 preview of each to qa/assets/tripo-raw/.

import bpy
import os
import mathutils

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC = os.path.join(ROOT, 'Assets')
OUT = os.path.join(ROOT, 'qa', 'assets', 'tripo-raw')
os.makedirs(OUT, exist_ok=True)

FILES = [
    'armchair+3d+model.glb',
    'green+office+chair+3d+model.glb',
    'card+payment+terminal+3d+model.glb',
    'touchscreen+kiosk+3d+model.glb',
    'modern+display+shelf+3d+model.glb',
    'athletic+shoe+3d+model.glb',
    'golf+headcover+3d+model.glb',
    'green+baseball+cap+3d+model.glb',
    'binocular+gadget+3d+model.glb',
]


def wipe():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.objects):
        for b in list(block):
            if b.users == 0:
                block.remove(b)


def setup_studio():
    scn = bpy.context.scene
    scn.render.engine = 'BLENDER_EEVEE'
    scn.render.resolution_x = 512
    scn.render.resolution_y = 512
    scn.render.film_transparent = False
    world = bpy.data.worlds.new('W')
    scn.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.35, 0.36, 0.38, 1)
    bg.inputs['Strength'].default_value = 1.1


def frame_object(pts):
    xs = [v.x for v in pts]; ys = [v.y for v in pts]; zs = [v.z for v in pts]
    cx, cy, cz = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2
    r = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)) * 0.5 + 1e-4
    d = r * 3.6
    bpy.ops.object.camera_add(location=(cx + d * 0.72, cy - d * 0.72, cz + d * 0.55))
    cam = bpy.context.object
    direction = mathutils.Vector((cx, cy, cz)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    bpy.ops.object.light_add(type='AREA', location=(cx + d, cy - d * 0.6, cz + d))
    k = bpy.context.object; k.data.energy = 300 * (r * r + 0.05); k.data.size = r * 3
    bpy.ops.object.light_add(type='AREA', location=(cx - d * 0.8, cy - d * 0.5, cz + d * 0.3))
    f = bpy.context.object; f.data.energy = 90 * (r * r + 0.05); f.data.size = r * 4


rows = []
for fn in FILES:
    path = os.path.join(SRC, fn)
    name = fn.replace('+3d+model.glb', '').replace('+', '_')
    wipe()
    setup_studio()
    if not os.path.exists(path):
        rows.append((name, 'MISSING', 0, 0, '-', '-', '-'))
        continue
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        rows.append((name, 'NO MESH', 0, 0, '-', '-', '-'))
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
    pts = []
    for o in meshes:
        for c in o.bound_box:
            pts.append(o.matrix_world @ mathutils.Vector(c))
    xs = [v.x for v in pts]; ys = [v.y for v in pts]; zs = [v.z for v in pts]
    dim = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    # pivot report: where is (0,0,0) relative to the mesh? min and centre per axis.
    piv = 'minZ=%.2f cx=%.2f cy=%.2f cz=%.2f' % (
        min(zs), (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2)
    frame_object(pts)
    bpy.context.scene.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)
    rows.append((name, 'ok', tris, len(slots),
                 'yes' if uv_ok else 'NO UV',
                 '%.2f x %.2f x %.2f' % dim, piv))

print('\n' + '=' * 110)
print('%-22s %-7s %9s %5s %6s  %-22s %s' % ('ASSET', 'STATE', 'TRIS', 'MATS', 'UVS', 'DIM (m XxYxZ)', 'PIVOT'))
print('=' * 110)
for r in rows:
    print('%-22s %-7s %9s %5s %6s  %-22s %s' % r)
print('=' * 110)
print('previews ->', OUT)
