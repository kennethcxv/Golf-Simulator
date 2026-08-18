"""The towel's waffle, at the waffle's own scale, flat panel beside folded stack.

The claim under test is "the waffle exists in the flat panel and is gone after
fold/settle/press". Both halves of that were measured from frames that span the
whole 300 mm object, where 1.9 mm of relief is four pixels. This renders the
SAME 90 mm field on both, so the comparison is a comparison.

  blender --factory-startup -b --python towel_macro.py
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
import hard as HD  # noqa: E402
import towel as TW  # noqa: E402
import shot as SH  # noqa: E402

OUT = None
FIELD = 90.0            # mm across the frame; the waffle pitch is 16 mm


def top_point(objs):
    """A point on the upper surface, in from the edge so the frame is all cloth."""
    lo, hi = H.bounds(objs)
    return Vector(((lo.x + hi.x) * 0.5, (lo.y + hi.y) * 0.5, hi.z))


def flat():
    H.reset_scene()
    H.set_engine("EEVEE", samples=112)
    ob = TW.panel()
    ob.data.materials.append(ST.fabric("TowelTerry", TW.CLOTH, rough=0.93,
                                       weave=0.0022, sheen=0.06, scale_mm=300.0))
    ST.smooth_by_angle(ob, 26.0)
    look = top_point([ob])
    HD.studio_hard(look, 0.05, ev=-0.05, world=0.24)
    SH.macro([ob], look, FIELD, OUT, [("flat-90mm", -58.0, 34.0)])


def folded():
    H.reset_scene()
    H.set_engine("EEVEE", samples=112)
    objs = TW.build()
    look = top_point(objs)
    HD.studio_hard(look, 0.05, ev=-0.05, world=0.24)
    SH.macro(objs, look, FIELD, OUT, [("folded-90mm", -58.0, 34.0)])


def main():
    global OUT
    OUT = ST.out_dir("qa", "hero", "v6", "towel")
    flat()
    folded()


if __name__ == "__main__":
    main()
