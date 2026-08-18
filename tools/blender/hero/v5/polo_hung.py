"""polo-hung. The brief's first priority.

REFERENCE: Designs/ProShop/Apparel/Image1.png row 1 cell 2 -- the oat shirt on a
wooden hanger. Enlarged, the faults in v4's polo are all construction:

  1. THE SLEEVES ARE RENAISSANCE PUFF SLEEVES. The brief names this. v4 blends a
     sleeve cross-section into a body cross-section over a ramp, so there is no
     armhole at all and the shoulder balloons. Here the sleeve is a pattern piece
     whose head is WELDED to a drafted armhole.
  2. The collar is a soft fin grown out of the body. In the reference it is
     plainly a flat strip rising off the neck and folding back onto the
     shoulders, with the dark inside of the garment showing in the V between the
     two halves.
  3. There is no placket -- v4 has three buttons floating on a smooth chest. The
     reference's placket is a crisp raised strip with a hard edge down each side,
     and it is most of what says "shirt" rather than "sweater".
  4. The body is a pillow. Flat panels, 27 mm apart.

Oat rather than v4's teal: it is the reference cell's own colour, it gives the
rail something against the slate tee, and a near-white garment is the hard case
for the bright studio.

Run: blender --factory-startup -b --python polo_hung.py -- render
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

NAME = "polo-hung"
CLOTH = (0.3620, 0.3410, 0.2985)
TRIM = (0.3240, 0.3030, 0.2610)
BUTTON = (0.3980, 0.3800, 0.3420)
DEPTH = 0.0272
# Oat has four times the albedo of the slate tee -- two full stops -- and at the
# tee's exposure it blew to paper white against a paper-white cyc. Each garment
# picks its own stop; that is why `exposure` is per asset and not in the rig.
EV = -1.85

# the placket: 40 mm wide, from the neckline down 132 mm, three buttons
PL_HALF = 0.0235
PL_TOP = -0.036
PL_BOT = -0.170


def build():
    blk = BL.Block(chest=0.238, hem=0.222, length=0.694, shoulder=0.212,
                   shoulder_drop=0.050, neck=0.078, front_drop=0.038,
                   back_drop=0.020, armpit=0.240, armhole_bulge=0.016,
                   hem_dip=0.010, sleeve_len=0.188, sleeve_angle=41.0,
                   cuff_half=0.072, sleeve_bulge=0.010)
    draft = PT.Draft()
    BL.flat_shell(draft, blk, DEPTH, nu=64, nv=84, snu=24, name="polo")
    ob = draft.build(NAME + "_shell")

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
    # pique is crisper than jersey: a polo holds its shape and its collar
    SIM.settle(ob, "pique", "pin", frames=44, mass=0.030, label="polo shell")

    # the placket, ray cast onto the settled chest so it follows the bow
    plack = PT.patch("polo_placket", ob, PL_HALF, PL_TOP, PL_BOT, nu=11, nv=17,
                     out=0.0027, rim=0.10, label="placket")
    # the fly line down its centre, and the three buttons on it
    buttons = []
    for j, t in enumerate((0.13, 0.42, 0.71)):
        z = PL_TOP + (PL_BOT - PL_TOP) * t
        p, n = PT.surface_at(ob, 0.0, z, 0.0027 + 0.0005)
        if p is None:
            raise SystemExit("polo: button %d missed the chest" % j)
        buttons.append(PT.button("polo_button%d" % j, p, -n, r=0.0053,
                                 h=0.0018))

    # A polo collar FOLDS DOWN ONTO THE SHOULDERS. The first cut stood it up
    # almost vertically and it read as a mandarin collar; the reference's two
    # halves lie back far enough to show the dark inside of the garment in the V
    # between them.
    coll = PT.collar("polo_collar", ob, "neck", stand=0.020, fall=0.052,
                     gap=0.052, spread=0.80, label="collar")

    cuffb = PT.rib_band("polo_cuffband", ob, "cuff", width=0.0250,
                        proud=0.0020, ribs=34, rib_depth=0.00060, label="cuff")
    hemb = PT.rib_band("polo_hemband", ob, "hem", width=0.0230, proud=0.0013,
                       ribs=0, label="hem")
    PT.turn_hem(ob, "hem", depth=0.024, inset=0.0026, up=True, label="hem")
    PT.turn_hem(ob, "cuff", depth=0.020, inset=0.0022, up=True, label="cuffs")

    # PIQUE, and this time it is a lattice. `rib` alone gave one set of wales,
    # which is jersey or a cuff -- not the honeycomb of small raised cells that
    # is the single most identifying thing about a polo in the reference macro.
    # The collar and cuff KEEP the single direction, because rib IS what a
    # collar is knitted in, and having the two read differently is half of why
    # a real polo's trim looks like a separate piece of cloth.
    fabric = ST.fabric("PoloPique", CLOTH, rough=0.815, weave=0.0010,
                       sheen=0.17, scale_mm=1020.0, rib=104, rib_depth=0.00082,
                       pique=1.9)
    trim = ST.fabric("PoloTrim", TRIM, rough=0.79, weave=0.0013, sheen=0.20,
                     scale_mm=400.0, rib=46, rib_depth=0.00095)
    ST.crisp(ob, dissolve=1.8, sharp=29.0, crease=33.0)
    ob.data.materials.append(fabric)

    coll = ST.apply_mods(coll)
    knit = ST.join("polo_trim", [coll, cuffb, hemb, plack])
    ST.smooth_by_angle(knit, 27.0)
    knit.data.materials.append(trim)

    horn = ST.matte("PoloButton", BUTTON, rough=0.26)
    for b in buttons:
        ST.smooth_by_angle(b, 34.0)
    btn = ST.join("polo_buttons", buttons)
    btn.data.materials.append(horn)

    bar, hook = HG.wood_hanger(half_w=blk.shoulder * 0.90,
                               z=blk.z_shoulder + 0.0125, drop=0.030, y=0.0,
                               hook_h=0.104)
    return [ob, knit, btn], [bar, hook], blk


def main():
    argv = H.argv_after_dashes()
    H.reset_scene()
    H.set_engine("CYCLES" if "cycles" in argv else "EEVEE", samples=96)
    cloth_objs, metal_objs, blk = build()
    subject = cloth_objs + metal_objs
    lo, hi = H.bounds(subject)
    look = Vector(((lo.x + hi.x) * 0.5, 0.0, (lo.z + hi.z) * 0.5))
    r = max((hi - lo).x, (hi - lo).z) * 0.5
    ST.world_value(0.34)
    ST.retail_light(centre=look, scale=r)
    ST.cyc(centre=look, scale=r)
    ST.exposure(EV)
    ST.no_white(cloth_objs)
    print("  tris %d" % ST.tris(subject))
    if "render" in argv:
        ST.shots(subject, look, r, ST.out_dir("qa", "hero", "v5", NAME),
                 [("front", -90.0, 4.0, 85.0), ("three", -54.0, 12.0, 85.0),
                  ("side", -6.0, 6.0, 85.0), ("back", 90.0, 6.0, 85.0),
                  ("collar", -78.0, 30.0, 110.0)])


if __name__ == "__main__":
    main()
