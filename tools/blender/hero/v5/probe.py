"""Which object is the tube lying across the chest? Colour the trim and look.

Three rounds of reasoning about index ranges have not identified it. One red
material will.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy
from mathutils import Vector

import hero_lib as H
import studio as ST
import tee_hung as T

H.reset_scene()
H.set_engine("EEVEE", samples=32)
cloth_objs, metal_objs, blk = T.build()
for ob in cloth_objs[1:]:
    ob.data.materials.clear()
    ob.data.materials.append(ST.matte("dbg_red", (0.75, 0.05, 0.05), rough=0.5))
    zs = [(ob.matrix_world @ v.co).z for v in ob.data.vertices]
    xs = [(ob.matrix_world @ v.co).x for v in ob.data.vertices]
    print("TRIM %-16s z %.3f..%.3f  x %.3f..%.3f  verts %d"
          % (ob.name, min(zs), max(zs), min(xs), max(xs), len(ob.data.vertices)))
shell = cloth_objs[0]
zs = [v.co.z for v in shell.data.vertices]
ys = [v.co.y for v in shell.data.vertices]
print("SHELL z %.3f..%.3f  y %.3f..%.3f" % (min(zs), max(zs), min(ys), max(ys)))

subject = cloth_objs + metal_objs
lo, hi = H.bounds(subject)
look = Vector(((lo.x + hi.x) * 0.5, 0.0, (lo.z + hi.z) * 0.5))
r = max((hi - lo).x, (hi - lo).z) * 0.5
ST.world_value(0.34)
ST.retail_light(centre=look, scale=r)
ST.cyc(centre=look, scale=r)
ST.exposure(0.02)
ST.shots(subject, look, r, ST.out_dir("qa", "hero", "v5", "_probe"),
         [("trim-front", -90.0, 4.0, 85.0)])
