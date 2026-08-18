"""polo-folded. The tee's fold, with the collar and placket coming along.

REFERENCE: Image1.png row 2 cell 3 -- the pink knit on two tan plies, with its
neck and a couple of buttons visible at the top-left of the top face, and the
side folds showing as crisp steps.

Same pattern as polo-hung, laid flat and folded. The point of doing it that way
rather than modelling a folded shape is that the collar and the placket are on
the garment BEFORE it folds, so they end up wherever the fold puts them -- which
is what makes the top face read as a shirt rather than as a slab.

Run: blender --factory-startup -b --python polo_folded.py -- render
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
import folded as FO
import hanger as HG

NAME = "polo-folded"
# VALUES FOR THE GAME'S EXPOSURE, NOT THE STUDIO'S.
#
# The studio gave every garment its own stop -- this hoodie rendered at EV
# +0.62 and the polo at -1.85, nearly two and a half stops apart -- so both
# looked right in Blender and neither could look right in the shop, which has
# ONE exposure. In the first in-game frame the hoodie was a black void with
# none of the fleece visible and the polo was blown to white. EV below is now
# a studio-only convenience; these numbers are chosen for the shelf.
CLOTH = (0.2172, 0.2046, 0.1791)
TRIM = (0.1944, 0.1818, 0.1566)
BUTTON = (0.3980, 0.3800, 0.3420)
DEPTH = 0.0042
EV = -1.85
PL_HALF, PL_TOP, PL_BOT = 0.0235, -0.036, -0.170


def build():
    blk = BL.Block(chest=0.238, hem=0.222, length=0.694, shoulder=0.212,
                   shoulder_drop=0.050, neck=0.078, front_drop=0.038,
                   back_drop=0.020, armpit=0.240, armhole_bulge=0.016,
                   hem_dip=0.010, sleeve_len=0.188, sleeve_angle=6.0,
                   cuff_half=0.072, sleeve_bulge=0.010)
    draft = PT.Draft()
    BL.flat_shell(draft, blk, DEPTH, nu=52, nv=68, snu=20, roll_rows=2,
                  name="polo")
    ob = draft.build(NAME + "_shell")

    plack = PT.patch("polof_placket", ob, PL_HALF, PL_TOP, PL_BOT, nu=11,
                     nv=17, out=0.0022, rim=0.10, label="placket")
    buttons = []
    for j, t in enumerate((0.13, 0.42, 0.71)):
        z = PL_TOP + (PL_BOT - PL_TOP) * t
        p, n = PT.surface_at(ob, 0.0, z, 0.0026)
        if p is not None:
            buttons.append(PT.button("polof_button%d" % j, p, -n, r=0.0050,
                                     h=0.0015))
    coll = PT.collar("polof_collar", ob, "neck", stand=0.013, fall=0.048,
                     gap=0.052, spread=0.92, thick=0.0016, label="collar")
    cuffb = PT.rib_band("polof_cuff", ob, "cuff", width=0.0240, proud=0.0016,
                        ribs=30, rib_depth=0.00045, label="cuff")
    hemb = PT.rib_band("polof_hem", ob, "hem", width=0.0230, proud=0.0011,
                       ribs=0, label="hem")
    PT.turn_hem(ob, "hem", depth=0.018, inset=0.0011, up=True, label="hem")
    PT.turn_hem(ob, "cuff", depth=0.015, inset=0.0009, up=True, label="cuffs")

    fabric = ST.fabric("PoloFPique", CLOTH, rough=0.815, weave=0.0008,
                       sheen=0.17, scale_mm=520.0, rib=110, rib_depth=0.00018)
    trim = ST.fabric("PoloFTrim", TRIM, rough=0.79, weave=0.0011, sheen=0.20,
                     scale_mm=250.0, rib=40, rib_depth=0.00030)
    horn = ST.matte("PoloFButton", BUTTON, rough=0.26)
    ob.data.materials.append(fabric)
    ob.data.materials.append(trim)
    ob.data.materials.append(horn)
    coll = ST.apply_mods(coll)
    knit = ST.join("polof_trim", [coll, cuffb, hemb, plack])
    btn = ST.join("polof_buttons", buttons)
    n0 = len(ob.data.polygons)
    n1 = n0 + len(knit.data.polygons)
    whole = ST.join(NAME, [ob, knit, btn])
    for i, poly in enumerate(whole.data.polygons):
        poly.material_index = 0 if i < n0 else (1 if i < n1 else 2)

    FO.lay_flat(whole, face_up=True)
    FO.fold_shirt(whole, blk.chest, sleeve_r=0.0052, side_r=0.0086,
                  last_r=0.0132, side_at=0.60, label="polo")
    FO.check_stack(whole, NAME)
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
