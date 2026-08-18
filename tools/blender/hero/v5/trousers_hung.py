"""trousers-hung.

REFERENCE: Image1.png has no trousers, so the style comes from the sheet's long
garments -- r1c1's camel coat and r2c2's green one. Both are flat slabs with
crisp edges, a straight hem, and the only curvature a soft vertical shading down
the sides. That is a pressed garment on a hanger and it is what a pair of golf
trousers on a clamp hanger should look like.

v4's trousers were two soft tubes with a dent where the crotch should be, and no
crease. The crease is the whole point of a pressed trouser: it is the thing that
tells you at a glance the garment is tailored rather than knitted, and here it is
GEOMETRY -- a tent ridge down each leg, two flat facets meeting at a line -- not
a shader groove.

Run: blender --factory-startup -b --python trousers_hung.py -- render
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
import sim as SIM
import hanger as HG

NAME = "trousers-hung"
CLOTH = (0.1590, 0.1495, 0.1250)
TRIM = (0.1420, 0.1330, 0.1090)
DEPTH = 0.0300
EV = -0.92


def build():
    tr = TR.Trouser(crease=0.0072)
    draft = PT.Draft()
    TR.build(draft, tr, DEPTH, nu=30, nv=76, name="trousers")
    ob = draft.build(NAME + "_shell")

    # the clamp grips the waistband; the seams hold their line at the hip and
    # loosen down the leg, which is where a hanging trouser takes its creases
    def seam(p):
        t = min(1.0, max(0.0, (-tr.hip_z - p.z) / (tr.length - tr.hip_z)))
        return 1.0 - 0.58 * (t * t * (3.0 - 2.0 * t))

    SIM.pin_from_groups(ob, "pin", {
        "waist": 1.0, "rise": 0.85,
        "inseam": 0.55, "outseam": 0.55,
    }, taper=lambda p: 1.0 if p.z > -tr.hip_z else seam(p))
    SIM.settle(ob, "twill", "pin", frames=44, mass=0.026, label="trouser shell")

    # the waistband is a real band with a crisp top edge, not a rolled hem
    band = PT.rib_band("trousers_waistband", ob, "waist", width=0.0405,
                       proud=0.0036, ribs=0, label="waistband")
    PT.turn_hem(ob, "waist", depth=0.014, inset=0.0022, up=True, label="waist")
    PT.turn_hem(ob, "cuff", depth=0.038, inset=0.0026, up=True, label="hems")
    hemb = PT.rib_band("trousers_hemband", ob, "cuff", width=0.0380,
                       proud=0.0014, ribs=0, label="leg hem")

    # belt loops: five, straddling the waistband
    loops = []
    for i, x in enumerate((-0.148, -0.074, 0.0, 0.074, 0.148)):
        p, n = PT.surface_at(ob, x, -0.020, 0.0)
        if p is None:
            continue
        n = Vector(n).normalized()
        pts = [p + n * 0.0016 + Vector((0, 0, 0.018)),
               p + n * 0.0090 + Vector((0, 0, 0.006)),
               p + n * 0.0090 + Vector((0, 0, -0.024)),
               p + n * 0.0016 + Vector((0, 0, -0.036))]
        loops.append(ST.sweep("trousers_loop%d" % i, pts, 0.0072, 0.0026,
                              sides=8))
    # the fly: a topstitched line down the right of centre
    fly = []
    for j in range(13):
        z = -0.030 - 0.126 * (j / 12.0)
        p, n = PT.surface_at(ob, 0.019, z, 0.0009)
        if p is not None:
            fly.append(p)
    stitch = PT.topstitch("trousers_fly", fly, radius=0.00085) if fly else None

    twill = ST.fabric("TrouserTwill", CLOTH, rough=0.775, weave=0.0009,
                      sheen=0.16, scale_mm=1200.0, rib=210, rib_depth=0.00028,
                      rib_angle=38.0)
    trim = ST.fabric("TrouserTrim", TRIM, rough=0.76, weave=0.0011, sheen=0.19,
                     scale_mm=460.0)
    ST.crisp(ob, dissolve=1.6, sharp=27.0, crease=31.0)
    ob.data.materials.append(twill)
    hard = [band, hemb] + loops + ([stitch] if stitch else [])
    trimob = ST.join("trousers_trim", hard)
    ST.smooth_by_angle(trimob, 27.0)
    trimob.data.materials.append(trim)

    body, steel = HG.clamp_hanger(half_w=0.166, z=0.0245, y=0.0, grip=0.140,
                                  hook_h=0.104)
    return [ob, trimob], [body, steel], tr


def main():
    argv = H.argv_after_dashes()
    H.reset_scene()
    H.set_engine("CYCLES" if "cycles" in argv else "EEVEE", samples=96)
    cloth_objs, metal_objs, tr = build()
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
                 [("front", -90.0, 3.0, 85.0), ("three", -54.0, 10.0, 85.0),
                  ("side", -6.0, 5.0, 85.0), ("back", 90.0, 5.0, 85.0),
                  ("waist", -80.0, 26.0, 110.0)], res=(820, 1220))


if __name__ == "__main__":
    main()
