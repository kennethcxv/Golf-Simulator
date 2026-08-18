"""Where does the towel's waffle go?

THE OPEN FAULT. The flat panel measures eight distinct z values over 5.50 mm
and renders as a clear grid of raised cells. After three folds, settle, press
and crisp the stack is glassy. Last session I reported that and did not isolate
the step, which is how a named residual becomes permanent.

WHY THE OLD MEASUREMENT COULD NOT FIND IT. "Eight distinct z values in the
mesh" is a whole-object statistic, and after folding, a towel's z values are
dominated by the six plies -- 42 mm of stack against 1.87 mm of relief. The
number stayed healthy no matter what happened to the waffle. THIS probe measures
only the UPWARD-FACING TOP SURFACE, which is the surface the fault is about.

  top faces = normal.z > 0.85 and centre within `band` of the stack's maximum
  relief  = the peak-to-peak z of those face centres, minus any slow tilt

and it prints that after every step in the chain, so the step that eats it has
to show as a drop between two lines.

NEGATIVE CONTROL (`--control`): the same probe against a panel built with the
waffle switched off. If it cannot tell a waffled panel from a smooth one it is
not measuring the waffle, and every number it prints is worthless.

  blender --factory-startup -b --python towel_probe.py
  blender --factory-startup -b --python towel_probe.py -- control
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
HERO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERO, "v5"))
sys.path.insert(0, HERO)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import hero_lib as H  # noqa: E402
import studio as ST  # noqa: E402
import fold as FD  # noqa: E402
import folded as FO  # noqa: E402
import towel as TW  # noqa: E402


def top_relief(ob, band=0.004, label=""):
    """Peak-to-peak z of the upward-facing top surface, in millimetres.

    A slow tilt across the stack would read as relief, so the plane of best fit
    is subtracted first -- otherwise `settle`'s sag alone would look like a
    healthy waffle.
    """
    me = ob.data
    me.calc_loop_triangles()
    zmax = max(v.co.z for v in me.vertices)
    pts = []
    for poly in me.polygons:
        if poly.normal.z <= 0.85:
            continue
        c = poly.center
        if c.z < zmax - band:
            continue
        pts.append((c.x, c.y, c.z))
    if len(pts) < 40:
        print("  %-14s top faces %4d  -- too few to measure" % (label, len(pts)))
        return None, len(pts)

    n = len(pts)
    mx = sum(p[0] for p in pts) / n
    my = sum(p[1] for p in pts) / n
    mz = sum(p[2] for p in pts) / n
    sxx = sum((p[0] - mx) ** 2 for p in pts)
    syy = sum((p[1] - my) ** 2 for p in pts)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    sxz = sum((p[0] - mx) * (p[2] - mz) for p in pts)
    syz = sum((p[1] - my) * (p[2] - mz) for p in pts)
    det = sxx * syy - sxy * sxy
    if abs(det) < 1e-16:
        a = b = 0.0
    else:
        a = (syy * sxz - sxy * syz) / det
        b = (sxx * syz - sxy * sxz) / det
    res = [p[2] - (mz + a * (p[0] - mx) + b * (p[1] - my)) for p in pts]
    ptp = (max(res) - min(res)) * 1000.0
    # how many distinct levels, to a tenth of a millimetre
    lev = len({round(r * 10000.0) for r in res})
    print("  %-14s top faces %4d   relief %6.3f mm   %3d levels"
          % (label, n, ptp, lev))
    return ptp, n


def chain(waffle=True):
    ob = TW.panel(waffle=waffle)
    fabric = ST.fabric("TowelTerry", TW.CLOTH, rough=0.93, weave=0.0022,
                       sheen=0.06, scale_mm=300.0)
    ob.data.materials.append(fabric)
    out = []
    out.append(("panel", top_relief(ob, label="panel")[0]))

    r = TW.THICK * 1.15
    (x0, x1), (y0, y1), _z = FO.span(ob)
    FD.fold(ob, 'x', x0 + (x1 - x0) / 3.0, r, side=-1)
    out.append(("fold 1", top_relief(ob, label="fold 1")[0]))
    (x0, x1), (y0, y1), _z = FO.span(ob)
    FD.fold(ob, 'x', x1 - (x1 - x0) / 2.0, r * 1.7, side=+1)
    out.append(("fold 2", top_relief(ob, label="fold 2")[0]))
    (x0, x1), (y0, y1), _z = FO.span(ob)
    FD.fold(ob, 'y', (y0 + y1) * 0.5, r * 2.6, side=-1)
    out.append(("fold 3", top_relief(ob, label="fold 3")[0]))

    FD.settle(ob, floor_z=0.0, sag=0.0018, corner=0.48)
    out.append(("settle", top_relief(ob, label="settle")[0]))
    FD.press(ob)
    out.append(("press", top_relief(ob, label="press")[0]))
    FO.centre_xy(ob)
    ST.crisp(ob, dissolve=1.4, sharp=26.0, crease=30.0)
    out.append(("crisp", top_relief(ob, label="crisp")[0]))
    return ob, out


def main():
    argv = H.argv_after_dashes()
    H.reset_scene()

    if "control" in argv:
        print("\nCONTROL -- the same chain with the waffle switched OFF.")
        print("A probe that reports the same numbers for both is measuring "
              "something else.")
        H.reset_scene()
        _obw, withw = chain(waffle=True)
        H.reset_scene()
        _obf, without = chain(waffle=False)
        print("\n  %-14s %10s %10s" % ("step", "waffle", "smooth"))
        ok = False
        for (lab, a), (_l2, b) in zip(withw, without):
            a = -1.0 if a is None else a
            b = -1.0 if b is None else b
            print("  %-14s %10.3f %10.3f" % (lab, a, b))
            if lab == "panel" and a - b > 1.0:
                ok = True
        if ok:
            print("\nCONTROL OK: the flat panel reads >1 mm of relief with the "
                  "waffle on and effectively none with it off, so the probe "
                  "is measuring the waffle.")
        else:
            print("\nCONTROL FAILED: the probe cannot tell a waffled panel "
                  "from a smooth one.")
            raise SystemExit(1)
        return

    print("\nTHE CHAIN, relief on the top surface after each step:")
    _ob, steps = chain(waffle=True)
    print("")
    prev = None
    for lab, val in steps:
        if prev is not None and val is not None and prev is not None:
            if prev > 0.3 and val < prev * 0.35:
                print("  >>> %s removed %.3f mm of %.3f mm" % (lab, prev - val, prev))
        prev = val if val is not None else prev


if __name__ == "__main__":
    main()
