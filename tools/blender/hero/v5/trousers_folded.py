"""trousers-folded. Leg on leg, then in three -- which is how trousers fold.

A shirt folds in from the sides; trousers do not. You lay one leg on the other so
the two creases line up, then fold the whole thing in half and in half again. The
result is a long thin stack with the WAISTBAND on one end and the folded hems on
the other, and the pressed creases running the full length of the top face. None
of that is true of a pile of slabs.

Run: blender --factory-startup -b --python trousers_folded.py -- render
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
import pattern as PT
import trouser as TR
import folded as FO
import hanger as HG

NAME = "trousers-folded"
CLOTH = (0.1590, 0.1495, 0.1250)
TRIM = (0.1420, 0.1330, 0.1090)
# EACH FOLD DOUBLES THE STACK, so the drafted depth is the one number that
# decides whether the result is a fold or a pile. A hung leg is a tube with air
# in it; folded, that air is gone and the depth is two thicknesses of cloth.
# At 6 mm the three trouser folds compounded to 135 mm on a 352 mm footprint --
# 0.38, which is the brief's "too tall for their footprint" arrived at by
# arithmetic rather than by modelling a pillow.
DEPTH = 0.0026
EV = -0.92


def build():
    tr = TR.Trouser(crease=0.0030)
    draft = PT.Draft()
    TR.build(draft, tr, DEPTH, nu=26, nv=66, roll_rows=2, name="trousers")
    ob = draft.build(NAME + "_shell")

    band = PT.rib_band("trousersf_waistband", ob, "waist", width=0.0405,
                       proud=0.0030, ribs=0, label="waistband")
    PT.turn_hem(ob, "waist", depth=0.012, inset=0.0012, up=True, label="waist")
    PT.turn_hem(ob, "cuff", depth=0.030, inset=0.0014, up=True, label="hems")
    hemb = PT.rib_band("trousersf_hemband", ob, "cuff", width=0.0340,
                       proud=0.0012, ribs=0, label="leg hem")

    twill = ST.fabric("TrouserFTwill", CLOTH, rough=0.775, weave=0.0008,
                      sheen=0.16, scale_mm=600.0, rib=150, rib_depth=0.00016,
                      rib_angle=38.0)
    trim = ST.fabric("TrouserFTrim", TRIM, rough=0.76, weave=0.0010,
                     sheen=0.19, scale_mm=260.0)
    ob.data.materials.append(twill)
    ob.data.materials.append(trim)
    t = ST.join("trousersf_trim", [band, hemb])
    n0 = len(ob.data.polygons)
    whole = ST.join(NAME, [ob, t])
    for i, poly in enumerate(whole.data.polygons):
        poly.material_index = 0 if i < n0 else 1

    FO.lay_flat(whole, face_up=True)
    FO.fold_trousers(whole, leg_r=0.0080, last_r=0.0150, label="trousers")
    FO.check_stack(whole, NAME)
    ST.crisp(whole, dissolve=1.5, sharp=26.0, crease=30.0)
    lo, hi = H.bounds([whole])
    sh = HG.shelf(z=0.0, y=(lo.y + hi.y) * 0.5,
                  half_w=(hi.x - lo.x) * 0.5 + 0.046,
                  half_d=(hi.y - lo.y) * 0.5 + 0.040,
                  tone=(0.300, 0.244, 0.180))
    return [whole], [sh]


def main():
    argv = H.argv_after_dashes()
    H.reset_scene()
    H.set_engine("CYCLES" if "cycles" in argv else "EEVEE", samples=96)
    cloth_objs, set_objs = build()
    lo, hi = H.bounds(cloth_objs)
    look = Vector(((lo.x + hi.x) * 0.5, (lo.y + hi.y) * 0.5,
                   (lo.z + hi.z) * 0.5))
    r = max((hi - lo).x, (hi - lo).y) * 0.5
    ST.world_value(0.34)
    ST.retail_light(centre=look, scale=r)
    ST.cyc(centre=look, scale=r)
    ST.exposure(EV)
    ST.no_white(cloth_objs)
    print("  tris %d" % ST.tris(cloth_objs + set_objs))
    if "render" in argv:
        ST.shots(cloth_objs + set_objs, look, r,
                 ST.out_dir("qa", "hero", "v5", NAME),
                 [("three", -58.0, 30.0, 85.0), ("front", -90.0, 16.0, 85.0),
                  ("side", -6.0, 14.0, 85.0), ("top", -70.0, 62.0, 85.0)],
                 res=(1100, 900), margin=1.12)


if __name__ == "__main__":
    main()
