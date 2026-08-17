"""tee-hung. The first v5 asset, and the one that proves the method.

REFERENCE: Designs/ProShop/Apparel/Image1.png, row 1 cell 7 -- the slate knit on
a wooden hanger. Enlarged, it says five things and v4's tee had none of them:

  1. The body is FLAT. Front and back a couple of centimetres apart, a soft roll
     at the side seam, and no other curvature at all. v4's tee is a bolster.
  2. The neck is a RIBBED BAND -- a proud ring with a crisp top edge and visible
     ribs. v4's tee has a rolled edge and nothing else, which is why it reads as
     a bag.
  3. The hem is a BAND with a crisp top line, and the cuffs are bands.
  4. The shoulder is nearly horizontal out to a real shoulder point, then the
     sleeve turns down. v4 blends a sleeve section into a body section over a
     ramp, and the ramp is the ballooning cap the brief names.
  5. The whole thing is bright, on white, with a soft even light.

Built as six flat pattern pieces sewn together (see block.py), settled under
gravity for forty frames, then trimmed off the settled openings.

Run: blender --factory-startup -b --python tee_hung.py -- render
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
import hanger as HG

NAME = "tee-hung"
OUT = None  # set in main(): must be absolute, see studio.out_dir

# a golf shop tee: short sleeve, slate blue, the reference's own colour
CLOTH = (0.0530, 0.0905, 0.1218)
# The bands read in Image1.png mainly by TONE, not by height: the slate knit's
# hem and cuffs are visibly darker than its body, and that step is what the eye
# uses. A 1 mm proud band the same colour as the panel is invisible.
RIB = (0.0338, 0.0602, 0.0838)
DEPTH = 0.0270
EV = 0.02


def build():
    # narrower than the first cut: 508 mm across the body against a 706 mm length
    # read boxy beside the reference, whose body-width to length ratio is nearer
    # two thirds.
    blk = BL.Block(chest=0.232, hem=0.211, length=0.700, shoulder=0.209,
                   shoulder_drop=0.048, neck=0.086, front_drop=0.046,
                   back_drop=0.022, armpit=0.238, armhole_bulge=0.015,
                   hem_dip=0.004, sleeve_len=0.196, sleeve_angle=44.0,
                   cuff_half=0.070, sleeve_bulge=0.010)
    draft = PT.Draft()
    BL.flat_shell(draft, blk, DEPTH, nu=64, nv=84, snu=24, name="tee")
    ob = draft.build(NAME + "_shell")

    # The hanger holds the shoulder seams and the neck rib is stiff trim: both
    # pinned hard. THE SEAM IS PINNED TOO, at 0.55, and that is the fix for the
    # first cut's cone. Rolling a panel round to the back turns the cloth through
    # 180 degrees over a 13 mm radius, and angular bending stiffness then pushes
    # the panels apart to straighten it -- measured at 27 mm drafted depth going
    # to 153 mm at the hem, with the garment losing 152 mm of width as the
    # sleeves collapsed inward. Lowering bending stiffness does not fix it
    # (95 mm at 2.0, 106 mm at 0.8); pinning the seam does, to 31 mm at the hem
    # and 49 mm at the chest with the width held.
    #
    # It is also the more accurate model. A seam is not the same cloth as the
    # panel: it is two allowances turned and stitched, several times stiffer, and
    # on a pressed garment it does not move. The PANELS are what gravity gets,
    # and they are entirely free.
    # The seam is stiff where the hanger supports it and freer down the skirt, so
    # the garment can take two or three soft creases below the chest instead of
    # standing like a board. Guarded by `settle`, which fails the build if the
    # width moves more than 6 per cent.
    def seam(p):
        t = min(1.0, max(0.0, (blk.z_armpit - p.z)
                         / (blk.z_armpit - blk.z_hem)))
        return 1.0 - 0.62 * (t * t * (3.0 - 2.0 * t))

    SIM.pin_from_groups(ob, "pin", {
        "shoulder": 1.0, "neck": 1.0,
        "underleft": 0.55, "underright": 0.55,
        "overleft": 0.55, "overright": 0.55,
    }, taper=lambda p: 1.0 if p.z > blk.z_armpit else seam(p))
    # mass is PER VERTEX: 14,000 verts against springs sized for a tablecloth is
    # how v4 got a 339 mm sag out of a 700 mm garment. A pressed tee on a hanger
    # does not stretch, so the target is a sag in the low tens of mm.
    SIM.settle(ob, "jersey", "pin", frames=44, mass=0.030, label="tee shell")

    # finish the openings. The hem and the cuffs turn back inside themselves,
    # which is what a finished edge is; the neck takes a ribbed band, and the hem
    # and cuffs take a shallow one for the stitch line. These are the reference's
    # loudest signal that the thing is clothing.
    # ORDER MATTERS: the bands are built off the opening loop, and `turn_hem`
    # moves that loop 28 mm up inside the garment. Bands first.
    rib = PT.rib_band("tee_neckrib", ob, "neck", width=0.0205, proud=0.0044,
                      ribs=40, rib_depth=0.00105, label="neck")
    hemb = PT.rib_band("tee_hemband", ob, "hem", width=0.0320, proud=0.0019,
                       ribs=0, label="hem")
    cuffb = PT.rib_band("tee_cuffband", ob, "cuff", width=0.0245,
                        proud=0.0017, ribs=0, label="cuff")
    PT.turn_hem(ob, "hem", depth=0.028, inset=0.0026, up=True, label="hem")
    PT.turn_hem(ob, "cuff", depth=0.022, inset=0.0022, up=True, label="cuffs")

    # a 3 mm wale on the panel and a 2 mm one on the trim, plus the yarn grain
    fabric = ST.fabric("TeeJersey", CLOTH, rough=0.845, weave=0.0009,
                       sheen=0.15, scale_mm=1050.0, rib=150,
                       rib_depth=0.00055)
    ribmat = ST.fabric("TeeRib", RIB, rough=0.80, weave=0.0013, sheen=0.18,
                       scale_mm=420.0, rib=52, rib_depth=0.00055)
    ST.crisp(ob, dissolve=1.8, sharp=29.0, crease=33.0)
    ob.data.materials.append(fabric)
    trim = ST.join("tee_trim", [rib, hemb, cuffb])
    ST.smooth_by_angle(trim, 26.0)
    trim.data.materials.append(ribmat)
    rib = trim

    bar, hook = HG.wood_hanger(half_w=blk.shoulder * 0.90,
                               z=blk.z_shoulder + 0.0125, drop=0.030, y=0.0,
                               hook_h=0.104)
    return [ob, rib], [bar, hook], blk


def views(subject, blk):
    lo, hi = H.bounds(subject)
    look = Vector(((lo.x + hi.x) * 0.5, 0.0, (lo.z + hi.z) * 0.5))
    r = max((hi - lo).x, (hi - lo).z) * 0.5
    return look, r


def main():
    argv = H.argv_after_dashes()
    do_render = "render" in argv
    H.reset_scene()
    H.set_engine("CYCLES" if "cycles" in argv else "EEVEE", samples=96)
    cloth_objs, metal_objs, blk = build()
    subject = cloth_objs + metal_objs
    look, r = views(subject, blk)
    ST.world_value(0.34)
    ST.retail_light(centre=look, scale=r)
    ST.cyc(centre=look, scale=r)
    ST.exposure(EV)
    print("  tris %d" % ST.tris(subject))

    if do_render:
        ST.shots(subject, look, r, ST.out_dir("qa", "hero", "v5", "tee-hung"),
                 [("front", -90.0, 4.0, 85.0), ("three", -54.0, 12.0, 85.0),
                  ("side", -6.0, 6.0, 85.0), ("back", 90.0, 6.0, 85.0)])


if __name__ == "__main__":
    main()
