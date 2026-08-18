"""hoodie-hung.

REFERENCE: Image1.png has no hoodie, so the style comes from the sheet's knits --
r1c7's slate crew and r1c4's sage cable. What they establish and v4's hoodie does
not have: flat panels, a wide ribbed hem band with a crisp top line, ribbed cuffs,
and a body that is a couple of centimetres deep rather than a duvet.

The hood is the piece v4 got most wrong: a lofted disc with a boolean hole, which
read as a cowl. A hood is TWO MIRROR SIDE PANELS joined along one seam running
from the nape, over the crown, down to the forehead -- see hood.py. That seam and
the binding round the face are what make a hood a hood, and a surface of
revolution has neither.

Run: blender --factory-startup -b --python hoodie_hung.py -- render
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
import hood as HD

NAME = "hoodie-hung"
# VALUES FOR THE GAME'S EXPOSURE, NOT THE STUDIO'S.
#
# The studio gave every garment its own stop -- this hoodie rendered at EV
# +0.62 and the polo at -1.85, nearly two and a half stops apart -- so both
# looked right in Blender and neither could look right in the shop, which has
# ONE exposure. In the first in-game frame the hoodie was a black void with
# none of the fleece visible and the polo was blown to white. EV below is now
# a studio-only convenience; these numbers are chosen for the shelf.
CLOTH = (0.1098, 0.1254, 0.2119)
TRIM = (0.0911, 0.1049, 0.1818)
CORD = (0.2650, 0.2600, 0.2420)
DEPTH = 0.0355
EV = 0.62

POCKET_TOP = -0.400
POCKET_BOT = -0.560
POCKET_HALF = 0.132


def build():
    blk = BL.Block(chest=0.278, hem=0.262, length=0.694, shoulder=0.248,
                   shoulder_drop=0.044, neck=0.104, front_drop=0.058,
                   back_drop=0.026, armpit=0.262, armhole_bulge=0.014,
                   hem_dip=0.002, sleeve_len=0.372, sleeve_angle=58.0,
                   cuff_half=0.062, sleeve_bulge=0.014)
    draft = PT.Draft()
    BL.flat_shell(draft, blk, DEPTH, nu=64, nv=84, snu=26, name="hoodie")

    # the hood, drafted flat and placed on this garment's own neckline
    nl = blk.neckline(blk.front_drop)
    su = blk.SHOULDER_SPAN

    def neckline(u):
        """The neck opening, centre front round to centre back on the +x side."""
        if u <= 0.5:
            t = 0.5 + (0.5 - u * 2.0) * (0.5 - su)
            x, z = nl(min(1.0, max(0.0, t)))
            return Vector((abs(x), -DEPTH * 0.5, z))
        t = 0.5 + ((u - 0.5) * 2.0) * (0.5 - su)
        x, z = blk.neckline(blk.back_drop)(min(1.0, max(0.0, t)))
        return Vector((abs(x), DEPTH * 0.5, z))

    hd = HD.Hood(rise=0.196, forward=0.082, back=0.140, half=0.094,
                 crown_y=0.036, brow=0.138, nape_drop=0.004, lean=0.34)
    HD.build(draft, hd, neckline, nu=34, nv=36, roll_rows=12,
             name="hoodie_hood")

    ob = draft.build(NAME + "_shell")

    def seam(p):
        t = min(1.0, max(0.0, (blk.z_armpit - p.z)
                         / (blk.z_armpit - blk.z_hem)))
        return 1.0 - 0.62 * (t * t * (3.0 - 2.0 * t))

    SIM.pin_from_groups(ob, "pin", {
        "shoulder": 1.0, "neck": 1.0, "hoodneck": 1.0, "hoodseam": 0.85,
        "hoodface": 0.70,
        "underleft": 0.55, "underright": 0.55,
        "overleft": 0.55, "overright": 0.55,
    }, taper=lambda p: 1.0 if p.z > blk.z_armpit else seam(p))
    # brushed-back fleece: heavier and much stiffer than jersey, and the hood is
    # 6,000 more vertices, so the per-vertex mass comes down again
    SIM.settle(ob, "fleece", "pin", frames=48, mass=0.026, label="hoodie shell")

    # the kangaroo pocket, ray cast onto the settled front
    # A KANGAROO POCKET IS NOT A RECTANGLE. Its top edge is short and the hand
    # openings run out and down from it, so the piece is a trapezoid -- and it is
    # the openings the eye reads, which a rectangle has none of.
    pocket = PT.patch("hoodie_pocket", ob,
                      lambda t: POCKET_HALF * (0.46 + 0.54 * t ** 0.72),
                      POCKET_TOP, POCKET_BOT, nu=24, nv=14, out=0.0056,
                      rim=0.09, label="pocket")

    face = PT.rib_band("hoodie_facing", ob, "hoodface", width=0.0270,
                       proud=0.0026, ribs=0, label="hood face")
    cuffb = PT.rib_band("hoodie_cuff", ob, "cuff", width=0.0620, proud=0.0032,
                        ribs=30, rib_depth=0.00120, label="cuff")
    hemb = PT.rib_band("hoodie_hem", ob, "hem", width=0.0640, proud=0.0032,
                       ribs=112, rib_depth=0.00120, label="hem")

    eye = HD.eyelets("hoodie_eyelet", ob, "hoodface", x=0.032, z=-0.014,
                     r=0.0044)
    anchors = []
    for sx in (-1, 1):
        p, _n = PT.surface_at(ob, sx * 0.032, -0.018, -0.0032)
        if p is not None:
            anchors.append((p, sx))
    cord = HD.cords("hoodie_cord", ob, anchors, drop=0.142, r=0.0027)

    fleece = ST.fabric("HoodieFleece", CLOTH, rough=0.895, weave=0.0014,
                       sheen=0.07, scale_mm=1080.0, rib=0)
    ribm = ST.fabric("HoodieRib", TRIM, rough=0.86, weave=0.0016, sheen=0.10,
                     scale_mm=380.0, rib=40, rib_depth=0.00110)
    ST.crisp(ob, dissolve=1.9, sharp=30.0, crease=34.0)
    ob.data.materials.append(fleece)
    ST.smooth_by_angle(pocket, 28.0)
    pocket.data.materials.append(fleece)
    trim = ST.join("hoodie_trim", [face, cuffb, hemb])
    ST.smooth_by_angle(trim, 27.0)
    trim.data.materials.append(ribm)
    cord.data.materials.append(ST.fabric("HoodieCord", CORD, rough=0.80,
                                         weave=0.0009, sheen=0.14,
                                         scale_mm=300.0))
    parts = [ob, pocket, trim, cord]
    metal = []
    if eye is not None:
        eye.data.materials.append(ST.chrome("HoodieEyelet", (0.70, 0.71, 0.73),
                                            0.26))
        metal.append(eye)

    bar, hook = HG.wood_hanger(half_w=blk.shoulder * 0.86,
                               z=blk.z_shoulder + 0.014, drop=0.030, y=0.0,
                               hook_h=0.106)
    return parts, metal + [bar, hook], blk


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
                  ("hood", -70.0, 34.0, 100.0)])


if __name__ == "__main__":
    main()
