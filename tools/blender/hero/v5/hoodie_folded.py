"""hoodie-folded. Thick fleece, and the hood folds with it.

REFERENCE: Image1.png row 2 cell 3's stack for the language -- crisp stepped side
folds, flat top face, wider than it is tall.

The hood is drafted as a FLAT ARCH above the shoulders, which is what a hood is
once it has been folded down onto the back of the garment, and it then goes
through the folds with everything else. v4's folded hoodie has a separate slab for
the hood and separate slabs for the plies, which is why the brief calls it a stack
of pillows.

Fleece is four times the thickness of jersey, so its hinges are bigger and the
stack is taller -- that is a real difference between a folded hoodie and a folded
tee and it should show.

Run: blender --factory-startup -b --python hoodie_folded.py -- render
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

NAME = "hoodie-folded"
CLOTH = (0.0448, 0.0512, 0.0865)
TRIM = (0.0372, 0.0428, 0.0742)
CORD = (0.2650, 0.2600, 0.2420)
DEPTH = 0.0068
EV = 0.62
POCKET_TOP, POCKET_BOT, POCKET_HALF = -0.400, -0.560, 0.132


def hood_arch(draft, blk, hd, nu=26, nv=18, name="hoodf_hood"):
    """The hood, folded down flat: an arch sewn to the neckline.

    A hood that has been folded onto the back of a garment is a flat piece, and
    drafting it flat here means it folds WITH the garment instead of being a slab
    parked on top of the pile.
    """
    HW, RISE = 0.132, 0.132
    nl = blk.neckline(blk.back_drop)
    bottom = PT.curve([(-HW, 0.004)] + PT.arc((-HW, 0.004), (HW, 0.004),
                                              -0.006, n=10, axis=1)[1:])
    top = PT.curve(PT.arc((-HW * 0.62, RISE), (HW * 0.62, RISE), 0.030, n=14,
                          axis=1))
    left = PT.curve(PT.arc((-HW, 0.004), (-HW * 0.62, RISE), -0.018, n=12,
                           axis=0))
    right = PT.curve(PT.arc((HW, 0.004), (HW * 0.62, RISE), 0.018, n=12,
                            axis=0))
    out = {}
    for sign, tag in ((-1.0, "f"), (1.0, "b")):
        out[tag] = draft.panel(top=top, bottom=bottom, left=left, right=right,
                               nu=nu, nv=nv, y=sign * hd,
                               name="%s_%s" % (name, tag),
                               uv_box=(0.0, 0.62, 0.30, 1.0))
    ch = draft.chain
    a = ch(out["f"].left, list(reversed(out["f"].top)),
           list(reversed(out["f"].right)))
    b = ch(out["b"].left, list(reversed(out["b"].top)),
           list(reversed(out["b"].right)))
    draft.sew_chain(a, b, rows=4, name="hoodedge")
    draft.mark("hoodface", out["f"].bottom + out["b"].bottom)
    return out


def build():
    blk = BL.Block(chest=0.278, hem=0.262, length=0.694, shoulder=0.248,
                   shoulder_drop=0.044, neck=0.104, front_drop=0.058,
                   back_drop=0.026, armpit=0.262, armhole_bulge=0.014,
                   hem_dip=0.002, sleeve_len=0.372, sleeve_angle=4.0,
                   cuff_half=0.062, sleeve_bulge=0.014)
    draft = PT.Draft()
    BL.flat_shell(draft, blk, DEPTH, nu=56, nv=72, snu=22, roll_rows=2,
                  name="hoodie")
    hood_arch(draft, blk, DEPTH * 0.5)
    ob = draft.build(NAME + "_shell")

    pocket = PT.patch("hoodief_pocket", ob,
                      lambda t: POCKET_HALF * (0.46 + 0.54 * t ** 0.72),
                      POCKET_TOP, POCKET_BOT, nu=22, nv=13, out=0.0042,
                      rim=0.09, label="pocket")
    cuffb = PT.rib_band("hoodief_cuff", ob, "cuff", width=0.0600, proud=0.0030,
                        ribs=28, rib_depth=0.00090, label="cuff")
    hemb = PT.rib_band("hoodief_hem", ob, "hem", width=0.0620, proud=0.0030,
                       ribs=104, rib_depth=0.00090, label="hem")

    fleece = ST.fabric("HoodieFFleece", CLOTH, rough=0.895, weave=0.0011,
                       sheen=0.07, scale_mm=540.0)
    ribm = ST.fabric("HoodieFRib", TRIM, rough=0.86, weave=0.0013, sheen=0.10,
                     scale_mm=250.0, rib=36, rib_depth=0.00060)
    ob.data.materials.append(fleece)
    ob.data.materials.append(ribm)
    trim = ST.join("hoodief_trim", [cuffb, hemb])
    n0 = len(ob.data.polygons) + len(pocket.data.polygons)
    whole = ST.join(NAME, [ob, pocket, trim])
    for i, poly in enumerate(whole.data.polygons):
        poly.material_index = 0 if i < n0 else 1

    FO.lay_flat(whole, face_up=True)
    FO.fold_shirt(whole, blk.chest, sleeve_r=0.0092, side_r=0.0135,
                  last_r=0.0210, side_at=0.58, hood_at=0.012, hood_r=0.010,
                  label="hoodie")
    FO.check_stack(whole, NAME)
    ST.crisp(whole, dissolve=1.6, sharp=27.0, crease=31.0)
    lo, hi = H.bounds([whole])
    sh = HG.shelf(z=0.0, y=(lo.y + hi.y) * 0.5,
                  half_w=(hi.x - lo.x) * 0.5 + 0.042,
                  half_d=(hi.y - lo.y) * 0.5 + 0.036,
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
