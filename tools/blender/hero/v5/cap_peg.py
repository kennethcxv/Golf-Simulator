"""cap-peg: the same cap, on a shop peg.

Not a second model. The cap is `cap.build()` rotated onto a chrome wall peg, so
whatever gets fixed on the cap is fixed here too -- v4 kept two and they drifted
apart. A peg display shows a cap from BELOW and BEHIND, which is the one view
that exposes the underside of the visor and the back strap, so both are built.

Run: blender --factory-startup -b --python cap_peg.py -- render
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
import hanger as HG
import cap as CAP

NAME = "cap-peg"
EV = -1.02
PEG_Y = 0.030
PEG_Z = 0.0


def hang(objs, tilt=64.0, lift=0.0):
    """Tip the cap back onto the peg and drop it so the sweatband rests on the
    ball. A cap on a peg hangs by the band at the back of the crown, nose down."""
    a = math.radians(tilt)
    c, s = math.cos(a), math.sin(a)
    for ob in objs:
        for v in ob.data.vertices:
            y, z = v.co.y, v.co.z
            v.co.y = y * c - z * s
            v.co.z = y * s + z * c
        ob.data.update()
    lo = min(min(v.co.z for v in ob.data.vertices) for ob in objs)
    shift = lift - lo
    for ob in objs:
        for v in ob.data.vertices:
            v.co.z += shift
        ob.data.update()
    # RETURN THE SHIFT. The seating below computes where the sweatband ended up
    # by rotating its authored centre through `tilt` -- and that arithmetic is
    # only right if rotation is the ONLY thing that happened. It is not: this
    # function also drops the whole cap so its lowest point sits at `lift`, and
    # that drop was invisible to the caller. The cap was therefore seated
    # exactly `shift` too high, which is why the studio side elevation has the
    # peg hanging in clear air 200 mm below a cap resting on nothing.
    return shift


def build():
    cloth_objs, metal_objs = CAP.build()
    parts = cloth_objs + metal_objs
    # A CAP ON A PEG HANGS BY ITS SWEATBAND, so the peg's ball has to end up
    # INSIDE the head opening. The first cut placed the cap by its bounding box
    # and left it floating beside the peg with the ball in clear air behind it.
    TILT = 34.0
    shift = hang(parts, tilt=TILT, lift=0.0)
    a = math.radians(TILT)
    c, sn = math.cos(a), math.sin(a)
    # the band's centre, carried through the same rotation AND the same drop
    oy, oz = 0.014 * sn, -0.014 * c + shift
    ball_y, ball_z = PEG_Y - 0.104, PEG_Z - 0.017
    dy, dz = ball_y - oy, ball_z - oz
    for ob in parts:
        for v in ob.data.vertices:
            v.co.y += dy
            v.co.z += dz
        ob.data.update()
    peg = HG.wall_peg(y=PEG_Y, z=PEG_Z, length=0.104)
    wall = ST.box("PegWall", (0.0, PEG_Y + 0.030, PEG_Z - 0.010),
                  (0.30, 0.010, 0.26), bevel=0.0)
    ST.smooth_by_angle(wall, 26.0)
    wall.data.materials.append(ST.matte("PegWall", (0.520, 0.512, 0.494),
                                        rough=0.86))
    return cloth_objs, metal_objs + [peg], [wall]


def main():
    argv = H.argv_after_dashes()
    H.reset_scene()
    H.set_engine("CYCLES" if "cycles" in argv else "EEVEE", samples=96)
    cloth_objs, metal_objs, set_objs = build()
    subject = cloth_objs + metal_objs
    lo, hi = H.bounds(subject)
    look = Vector(((lo.x + hi.x) * 0.5, (lo.y + hi.y) * 0.5,
                   (lo.z + hi.z) * 0.5))
    r = max((hi - lo).x, (hi - lo).y, (hi - lo).z) * 0.5
    ST.world_value(0.34)
    ST.retail_light(centre=look, scale=r)
    ST.cyc(centre=look, scale=r)
    ST.exposure(EV)
    ST.no_white(cloth_objs)
    print("  tris %d" % ST.tris(subject + set_objs))
    if "render" in argv:
        ST.shots(subject + set_objs, look, r,
                 ST.out_dir("qa", "hero", "v5", NAME),
                 [("front", -90.0, 2.0, 85.0), ("three", -56.0, 14.0, 85.0),
                  ("side", -8.0, 6.0, 85.0), ("under", -84.0, -22.0, 85.0)],
                 res=(950, 1050), margin=1.10)


if __name__ == "__main__":
    main()
