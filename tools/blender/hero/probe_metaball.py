"""What do metaball ELLIPSOID size and radius actually do?

The hand's palm, wrist, forearm, thenar, hypothenar and knuckles all vanished
from the first build while the ball-built fingers came through, so the ellipsoid
elements are contributing no field. Rather than guess at the semantics, this
solves one element at a time and prints the bounding box of the resulting
surface. A shape that produces no mesh prints NO SURFACE, which is the answer.

    blender --factory-startup -b --python tools/blender/hero/probe_metaball.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402


def solve(label, make, threshold=0.62, resolution=0.0025):
    for block in (bpy.data.objects, bpy.data.metaballs, bpy.data.meshes):
        for item in list(block):
            block.remove(item, do_unlink=True)
    mball = bpy.data.metaballs.new("P")
    mball.resolution = resolution
    mball.render_resolution = resolution
    mball.threshold = threshold
    obj = bpy.data.objects.new("P", mball)
    bpy.context.collection.objects.link(obj)
    make(mball)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    if not mesh.vertices:
        print(f"{label:52s} NO SURFACE")
        bpy.data.meshes.remove(mesh)
        return None
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for v in mesh.vertices:
        for i in range(3):
            lo[i] = min(lo[i], v.co[i])
            hi[i] = max(hi[i], v.co[i])
    size = hi - lo
    print(f"{label:52s} verts {len(mesh.vertices):5d}  "
          f"size {size.x:.4f} x {size.y:.4f} x {size.z:.4f}")
    bpy.data.meshes.remove(mesh)
    return size


bpy.ops.wm.read_factory_settings(use_empty=True)

print("\n--- BALL: the control. These worked in the failed build. ---")
for r in (0.010, 0.0165, 0.030):
    solve(f"BALL radius={r}",
          lambda mb, r=r: setattr(mb.elements.new(type="BALL"), "radius", r))

print("\n--- ELLIPSOID: size varied, radius held at the palm value 0.0165 ---")
for sz in ((0.030, 0.030, 0.006), (0.010, 0.010, 0.004), (0.004, 0.004, 0.002),
           (0.001, 0.001, 0.001)):
    def mk(mb, sz=sz):
        el = mb.elements.new(type="ELLIPSOID")
        el.size_x, el.size_y, el.size_z = sz
        el.radius = 0.0165
    solve(f"ELLIPSOID size={sz} radius=0.0165", mk)

print("\n--- ELLIPSOID: radius varied, size held at the palm value ---")
for rad in (0.0165, 0.04, 0.08, 0.20, 0.50):
    def mk(mb, rad=rad):
        el = mb.elements.new(type="ELLIPSOID")
        el.size_x, el.size_y, el.size_z = (0.030, 0.030, 0.006)
        el.radius = rad
    solve(f"ELLIPSOID size=(.030,.030,.006) radius={rad}", mk)

print("\n--- CAPSULE, for comparison ---")
for sx in (0.01, 0.03):
    def mk(mb, sx=sx):
        el = mb.elements.new(type="CAPSULE")
        el.size_x = sx
        el.radius = 0.0165
    solve(f"CAPSULE size_x={sx} radius=0.0165", mk)

print("\n--- stiffness sweep on the failing ellipsoid ---")
for st in (1.0, 2.0, 4.0, 8.0, 10.0):
    def mk(mb, st=st):
        el = mb.elements.new(type="ELLIPSOID")
        el.size_x, el.size_y, el.size_z = (0.030, 0.030, 0.006)
        el.radius = 0.0165
        el.stiffness = st
    solve(f"ELLIPSOID stiffness={st}", mk)

print("\n--- does a BALL scale with stiffness the same way? ---")
for st in (1.0, 2.0, 5.0):
    def mk(mb, st=st):
        el = mb.elements.new(type="BALL")
        el.radius = 0.0165
        el.stiffness = st
    solve(f"BALL radius=0.0165 stiffness={st}", mk)
