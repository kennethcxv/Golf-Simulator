"""tee-folded.

REFERENCE: Image1.png row 2 cell 4 -- the teal knit folded on two cream plies.
Enlarged it says three things, and the brief names all three as missing from v4:

  1. THE NECK IS VISIBLE ON THE TOP FACE. The crew ring sits near one edge and
     it is the first thing the eye finds.
  2. THE SLEEVE FOLDS SHOW as stepped edges down the side of the stack.
  3. The faces are FLAT and the fold edges are CRISP, and the whole thing is much
     wider than it is tall.

v4's has none of them, because v4's folded garments are separate slab objects in
a pile -- there was never a sleeve to fold or a neckline to end up on top. This is
the same pattern as tee-hung, laid flat and put through the five folds a shop
assistant uses.

Run: blender --factory-startup -b --python tee_folded.py -- render
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
import block as BL
import sim as SIM
import fold as FD
import folded as FO
import hanger as HG

NAME = "tee-folded"
CLOTH = (0.0530, 0.0905, 0.1218)
RIB = (0.0398, 0.0690, 0.0935)
# A FOLDED GARMENT IS PRESSED FLAT. The hung tee is 27 mm front to back; folded,
# the two panels are against each other and the pressed depth is the cloth. Fold
# a 27 mm shell and the hinges have to be 14 mm radius and the stack comes out as
# tall as its footprint -- which is v4's fault stated in millimetres.
DEPTH = 0.0038
EV = 0.02


def build():
    blk = BL.Block(chest=0.232, hem=0.211, length=0.700, shoulder=0.209,
                   shoulder_drop=0.048, neck=0.086, front_drop=0.046,
                   back_drop=0.022, armpit=0.238, armhole_bulge=0.015,
                   hem_dip=0.004, sleeve_len=0.196, sleeve_angle=6.0,
                   cuff_half=0.070, sleeve_bulge=0.010)
    draft = PT.Draft()
    BL.flat_shell(draft, blk, DEPTH, nu=52, nv=68, snu=20, roll_rows=2,
                  name="tee")
    ob = draft.build(NAME + "_shell")

    rib = PT.rib_band("teef_neckrib", ob, "neck", width=0.0205, proud=0.0028,
                      ribs=40, rib_depth=0.00080, label="neck")
    hemb = PT.rib_band("teef_hemband", ob, "hem", width=0.0300, proud=0.0013,
                       ribs=0, label="hem")
    cuffb = PT.rib_band("teef_cuffband", ob, "cuff", width=0.0230,
                        proud=0.0012, ribs=0, label="cuff")
    PT.turn_hem(ob, "hem", depth=0.020, inset=0.0012, up=True, label="hem")
    PT.turn_hem(ob, "cuff", depth=0.016, inset=0.0010, up=True, label="cuffs")

    fabric = ST.fabric("TeeFJersey", CLOTH, rough=0.845, weave=0.0009,
                       sheen=0.15, scale_mm=520.0, rib=132, rib_depth=0.00016)
    ribmat = ST.fabric("TeeFRib", RIB, rough=0.80, weave=0.0013, sheen=0.18,
                       scale_mm=260.0, rib=44, rib_depth=0.00030)
    ob.data.materials.append(fabric)
    ob.data.materials.append(ribmat)
    # the trim JOINS THE SHELL BEFORE FOLDING, or it stays behind in mid-air
    trim = ST.join("teef_trim", [rib, hemb, cuffb])
    n0 = len(ob.data.polygons)
    whole = ST.join(NAME, [ob, trim])
    for i, poly in enumerate(whole.data.polygons):
        poly.material_index = 0 if i < n0 else 1

    FO.lay_flat(whole, face_up=True)
    FO.fold_shirt(whole, blk.chest, sleeve_r=0.0052, side_r=0.0082,
                  last_r=0.0128, side_at=0.62, label="tee")
    FO.check_stack(whole, "tee-folded")
    ST.crisp(whole, dissolve=1.5, sharp=26.0, crease=30.0)

    lo, hi = H.bounds([whole])
    sh = HG.shelf(z=0.0, y=(lo.y + hi.y) * 0.5,
                  half_w=(hi.x - lo.x) * 0.5 + 0.040,
                  half_d=(hi.y - lo.y) * 0.5 + 0.034)
    return [whole], [sh]


def main():
    argv = H.argv_after_dashes()
    H.reset_scene()
    H.set_engine("CYCLES" if "cycles" in argv else "EEVEE", samples=96)
    cloth_objs, set_objs = build()
    subject = cloth_objs
    lo, hi = H.bounds(subject)
    look = Vector(((lo.x + hi.x) * 0.5, (lo.y + hi.y) * 0.5,
                   (lo.z + hi.z) * 0.5))
    r = max((hi - lo).x, (hi - lo).y) * 0.5
    ST.world_value(0.34)
    ST.retail_light(centre=look, scale=r)
    ST.cyc(centre=look, scale=r)
    ST.exposure(EV)
    ST.no_white(cloth_objs)
    print("  tris %d" % ST.tris(subject + set_objs))
    if "render" in argv:
        ST.shots(subject + set_objs, look, r,
                 ST.out_dir("qa", "hero", "v5", NAME),
                 [("three", -58.0, 30.0, 85.0), ("front", -90.0, 16.0, 85.0),
                  ("side", -6.0, 14.0, 85.0), ("top", -70.0, 62.0, 85.0)],
                 res=(1100, 900), margin=1.12)


if __name__ == "__main__":
    main()
