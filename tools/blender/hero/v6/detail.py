"""A real close-up of any v5 garment, at a stated field width.

Every fault still open on the garments is a small one -- nicks at an armhole,
a facet on a hood crown -- and `studio.shots` cannot frame a small thing: it
fits the SUBJECT, so the "detail" view of a 800 mm shirt is a view of a 800 mm
shirt. That is how the towel's waffle spent two rounds reported missing.

  blender --factory-startup -b --python detail.py -- polo_hung 120 -0.19 0 0.36 armhole
                                                     module  mm    x     y   z  tag

The point is given in metres in the garment's own space. `-- <module> list`
prints the bounding box instead, so the point can be chosen from a number.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
HERO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERO, "v5"))
sys.path.insert(0, HERO)

import importlib  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import hero_lib as H  # noqa: E402
import studio as ST  # noqa: E402
import shot as SH  # noqa: E402


def flatten(built):
    out = []
    for item in built:
        if isinstance(item, (list, tuple)):
            out.extend(o for o in item if hasattr(o, "data"))
        elif hasattr(item, "data"):
            out.append(item)
    return out


def main():
    argv = H.argv_after_dashes()
    mod_name = argv[0]
    H.reset_scene()
    H.set_engine("EEVEE", samples=112)
    mod = importlib.import_module(mod_name)
    objs = flatten(mod.build())

    lo, hi = H.bounds(objs)
    if len(argv) > 1 and argv[1] == "list":
        print("  %s bounds  x[%.3f %.3f]  y[%.3f %.3f]  z[%.3f %.3f]"
              % (mod_name, lo.x, hi.x, lo.y, hi.y, lo.z, hi.z))
        return

    width = float(argv[1])
    look = Vector((float(argv[2]), float(argv[3]), float(argv[4])))
    tag = argv[5] if len(argv) > 5 else "detail"
    az = float(argv[6]) if len(argv) > 6 else -90.0
    el = float(argv[7]) if len(argv) > 7 else 6.0

    ST.world_value(0.34)
    ST.retail_light(centre=look, scale=max(width / 1000.0, 0.05))
    ST.exposure(getattr(mod, "EV", 0.10))
    out = ST.out_dir("qa", "hero", "v6", mod_name.replace("_", "-"))
    SH.macro(objs, look, width, out, [(tag, az, el)], res=(1100, 1100))


if __name__ == "__main__":
    main()
