# Normalise the raw owner-supplied Tripo GLBs (Assets/*.glb) into game-ready props
# in vendor/models/clubhouse/, PRESERVING their baked PBR material.
#
#   blender \
#       --background --factory-startup --python tools/blender/process_tripo.py
#
# WHY A SEPARATE PATH FROM build_merch.py: the merch loader (merch.js) remaps every
# material onto the shared clubhouse kit to hold the material count flat — right for
# goods stocked by the dozen, wrong for these. Each Tripo prop is ONE textured atlas
# material and is placed as a HERO SINGLETON (one card terminal, one gondola, a pair of
# chairs), so keeping its own baked look costs a handful of materials and buys the
# fidelity the whole session is about. These load through merch.instantiateRaw(), which
# does NOT remap.
#
# inspect_tripo.py established that Tripo ships every asset normalised to a unit cube
# with the pivot already at base-centre (minZ=0, cx=cy=0). So the whole job is: recentre
# defensively, UNIFORM-scale so one chosen axis hits a real-world target, optional yaw,
# optional decimate, then export Y-up with materials. Uniform scale keeps Tripo's aspect.

import bpy
import os
import math
import mathutils

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC = os.path.join(ROOT, 'Assets')
OUT = os.path.join(ROOT, 'vendor', 'models', 'clubhouse')
os.makedirs(OUT, exist_ok=True)

# axis: which dimension 'size' (metres) pins. 'z' height, 'x'/'y' the horizontal spans.
# yaw: degrees about world Z, applied after scale, to face the prop's front a canonical way.
# decimate: <1.0 collapses tris; 1.0 leaves the mesh untouched (these are already 7-18k).
SPECS = [
    # hero singletons — full detail, one draw call each
    {'file': 'armchair+3d+model.glb',              'out': 'armchair',      'axis': 'z', 'size': 0.90, 'yaw': 0,   'decimate': 1.0},
    {'file': 'green+office+chair+3d+model.glb',     'out': 'office_chair',  'axis': 'z', 'size': 1.06, 'yaw': 0,   'decimate': 1.0},
    {'file': 'card+payment+terminal+3d+model.glb',  'out': 'cardterm_pro',  'axis': 'x', 'size': 0.21, 'yaw': 0,   'decimate': 1.0},
    {'file': 'touchscreen+kiosk+3d+model.glb',      'out': 'kiosk',         'axis': 'z', 'size': 0.46, 'yaw': 0,   'decimate': 1.0},
    {'file': 'modern+display+shelf+3d+model.glb',   'out': 'display_shelf', 'axis': 'z', 'size': 1.70, 'yaw': 0,   'decimate': 1.0},
    # repeated PRODUCTS — decimated hard, because a shelf carries a dozen and they bake
    # into one mesh per material; less detail per copy, more copies for the same budget.
    {'file': 'athletic+shoe+3d+model.glb',          'out': 'shoe_pro',      'axis': 'y', 'size': 0.30, 'yaw': 0,   'decimate': 0.30},
    {'file': 'green+baseball+cap+3d+model.glb',      'out': 'cap_pro',       'axis': 'x', 'size': 0.27, 'yaw': 0,   'decimate': 0.35},
    {'file': 'golf+headcover+3d+model.glb',          'out': 'headcover',     'axis': 'z', 'size': 0.26, 'yaw': 0,   'decimate': 0.40},
    {'file': 'binocular+gadget+3d+model.glb',        'out': 'rangefinder',   'axis': 'y', 'size': 0.12, 'yaw': 0,   'decimate': 0.45},
]


def wipe():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.objects):
        for b in list(block):
            if b.users == 0:
                block.remove(b)


def bbox(obj):
    pts = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    xs = [v.x for v in pts]; ys = [v.y for v in pts]; zs = [v.z for v in pts]
    dim = mathutils.Vector((max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)))
    ctr = mathutils.Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2))
    return dim, ctr, min(zs)


def apply(obj, loc=False, rot=False, scale=False):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=loc, rotation=rot, scale=scale)


def process(spec):
    wipe()
    path = os.path.join(SRC, spec['file'])
    bpy.ops.import_scene.gltf(filepath=path)

    # drop any imported empties/cameras/lights out of the way; keep only meshes,
    # unparented so a join cannot drag a parent transform along.
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        print('!! %s: NO MESH' % spec['out'])
        return None
    for o in bpy.context.scene.objects:
        o.select_set(o.type == 'MESH')
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    apply(obj, loc=True, rot=True, scale=True)

    # recentre base-centre to the origin (defensive — Tripo already does this)
    dim, ctr, minz = bbox(obj)
    obj.location = (-ctr.x, -ctr.y, -minz)
    apply(obj, loc=True)

    # uniform scale so the chosen axis hits its real-world target
    dim, ctr, minz = bbox(obj)
    cur = {'x': dim.x, 'y': dim.y, 'z': dim.z}[spec['axis']]
    s = spec['size'] / cur if cur > 1e-6 else 1.0
    obj.scale = (s, s, s)
    apply(obj, scale=True)

    # yaw about Z (base stays on the floor; Z-rotation preserves z)
    if spec['yaw']:
        obj.rotation_euler = (0, 0, math.radians(spec['yaw']))
        apply(obj, rot=True)

    # re-drop to the floor in case of rounding
    dim, ctr, minz = bbox(obj)
    if abs(minz) > 1e-4:
        obj.location.z -= minz
        apply(obj, loc=True)

    bpy.ops.object.shade_auto_smooth(angle=math.radians(35))

    if spec.get('decimate', 1.0) < 1.0:
        m = obj.modifiers.new('dec', 'DECIMATE')
        m.ratio = spec['decimate']
        bpy.ops.object.modifier_apply(modifier=m.name)

    obj.name = spec['out']
    for o in bpy.context.scene.objects:
        o.select_set(o is obj)
    out = os.path.join(OUT, spec['out'] + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True, export_normals=True,
        export_texcoords=True, export_materials='EXPORT')

    dim, ctr, minz = bbox(obj)
    obj.data.calc_loop_triangles()
    print('WROTE %-14s %6d tris  %.2f x %.2f x %.2f m  base_z=%.3f'
          % (spec['out'], len(obj.data.loop_triangles), dim.x, dim.y, dim.z, minz))
    return out


if __name__ == '__main__':
    for spec in SPECS:
        process(spec)
    print('\n=== processed %d Tripo props -> %s ===' % (len(SPECS), OUT))
