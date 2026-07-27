# Find the SCREEN on a processed Tripo device (kiosk, card terminal) so the live
# transaction canvas can be hung exactly on it — position, facing and size.
#
#   blender \
#       --background --factory-startup --python tools/blender/measure_screens.py
#
# A screen is the largest FLAT panel facing outward, so it is found by geometry, not by
# colour (these devices are dark-grey all over, so texture darkness caught the whole
# casing). Triangles are clustered by quantised normal, and the biggest clusters are
# reported with their area-weighted centroid, mean normal and span — the screen is the
# one whose normal faces out (up-and-forward). Coordinates are in THREE's frame (glTF
# Y-up: three = (x, z, -y) of Blender), the frame attachScreen()/attachTerm() plant in.

import bpy
import os
import math
import mathutils

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC = os.path.join(ROOT, 'vendor', 'models', 'clubhouse')
TARGETS = ['kiosk', 'cardterm_pro']


def wipe():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.objects):
        for b in list(block):
            if b.users == 0:
                block.remove(b)


def to_three(v):
    return mathutils.Vector((v.x, v.z, -v.y))


for name in TARGETS:
    wipe()
    path = os.path.join(SRC, name + '.glb')
    if not os.path.exists(path):
        print('%s: MISSING' % name)
        continue
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in bpy.context.scene.objects:
        o.select_set(o.type == 'MESH')
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    me = obj.data
    me.calc_loop_triangles()

    # cluster triangles by quantised normal AND plane offset, so the front panel and the
    # back panel (opposite normals) and two parallel faces at different depths all split.
    clusters = {}
    for t in me.loop_triangles:
        vs = [me.vertices[t.vertices[k]].co for k in range(3)]
        c = (vs[0] + vs[1] + vs[2]) / 3.0
        area = (vs[1] - vs[0]).cross(vs[2] - vs[0]).length * 0.5
        n = mathutils.Vector(t.normal)
        off = n.dot(c)
        key = (round(n.x * 6), round(n.y * 6), round(n.z * 6), round(off * 12))
        cl = clusters.setdefault(key, [0.0, mathutils.Vector(), mathutils.Vector()])
        cl[0] += area
        cl[1] += c * area
        cl[2] += n * area

    ranked = sorted(clusters.values(), key=lambda cl: -cl[0])[:6]
    print('\n=== %s ===  (top flat panels, biggest first; screen = large + faces out)' % name)
    for i, (a, csum, nsum) in enumerate(ranked):
        c = csum / a
        n = nsum.normalized()
        c3 = to_three(c); n3 = to_three(n)
        rot_x = math.atan2(n3.y, n3.z)   # lay a +Z plane back to meet this normal
        print('  #%d area=%.4f  centre(three)=% .3f,% .3f,% .3f  normal(three)=% .2f,% .2f,% .2f  rot.x=% .3f'
              % (i, a, c3.x, c3.y, c3.z, n3.x, n3.y, n3.z, rot_x))
