"""Does headless cloth simulation actually drape in this Blender?

The whole v4 plan rests on it. Before a single garment panel is drawn, hang a
flat sheet from two corners over a bar and MEASURE that it moved: a sheet that
is still flat after the bake means the modifier never evaluated, and every
garment built on top of it would be a rigid extrusion wearing a new name.

    blender --factory-startup -b --python tools/blender/hero/v4/probe_cloth.py
"""

import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))


def grid(name, w, h, nx, ny, z):
    verts = [(-w / 2 + w * i / (nx - 1), -h / 2 + h * j / (ny - 1), z)
             for j in range(ny) for i in range(nx)]
    faces = [(j * nx + i, j * nx + i + 1, (j + 1) * nx + i + 1, (j + 1) * nx + i)
             for j in range(ny - 1) for i in range(nx - 1)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.use_gravity = True
    scene.gravity = (0.0, 0.0, -9.81)

    NX, NY = 41, 41
    sheet = grid("sheet", 0.60, 0.60, NX, NY, 0.80)

    # pin the two top corners only -- everything else must fall
    vg = sheet.vertex_groups.new(name="pin")
    top_row = [(NY - 1) * NX + i for i in range(NX)]
    vg.add([top_row[0], top_row[-1]], 1.0, 'REPLACE')

    # a bar for it to drape over, so we also learn whether collision fires
    bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=0.9,
                                        rotation=(0, 1.5708, 0),
                                        location=(0, 0, 0.62))
    bar = bpy.context.object
    bar.modifiers.new("Collision", 'COLLISION')
    bar.collision.thickness_outer = 0.004

    cl = sheet.modifiers.new("Cloth", 'CLOTH')
    cl.settings.quality = 8
    cl.settings.mass = 0.30
    cl.settings.tension_stiffness = 15
    cl.settings.compression_stiffness = 15
    cl.settings.shear_stiffness = 5
    cl.settings.bending_stiffness = 0.5
    cl.settings.vertex_group_mass = "pin"
    cl.collision_settings.use_self_collision = True
    cl.collision_settings.self_distance_min = 0.004
    cl.collision_settings.distance_min = 0.004

    FRAMES = 60
    cl.point_cache.frame_start = 1
    cl.point_cache.frame_end = FRAMES
    scene.frame_start, scene.frame_end = 1, FRAMES

    before = [Vector(v.co) for v in sheet.data.vertices]

    dg = bpy.context.evaluated_depsgraph_get()
    for f in range(1, FRAMES + 1):
        scene.frame_set(f)
        dg.update()

    ev = sheet.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = bpy.data.meshes.new_from_object(ev, depsgraph=dg)
    after = [Vector(v.co) for v in me.vertices]

    moved = max((a - b).length for a, b in zip(after, before))
    zs = [v.z for v in after]
    span = max(zs) - min(zs)
    # a flat sheet has every vertex on one plane; a draped one does not
    ys = [v.y for v in after]
    ybow = max(ys) - min(ys)

    print(f"PROBE max vertex travel {moved * 1000:.1f} mm")
    print(f"PROBE z span {span * 1000:.1f} mm (started flat at 0.0)")
    print(f"PROBE y bow {ybow * 1000:.1f} mm (started {600:.0f} mm)")
    ok = moved > 0.05 and span > 0.20
    print("PROBE RESULT:", "CLOTH SIMULATES" if ok else "*** CLOTH IS INERT ***")
    if not ok:
        raise SystemExit(3)


if __name__ == "__main__":
    main()
