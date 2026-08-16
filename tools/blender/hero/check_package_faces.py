"""Photograph every printed face SQUARE-ON and read the type back.

"Text on some of the packaging is stretched... Render each one square-on and
read the text back. If you cannot read it comfortably in the render, it is
wrong."

Two things this found on its first run:

  the sleeve's SIDE PANEL printed "KESTREL" MIRRORED. A fixed corner sequence
  is only correct for one winding, and the two opposite faces of a box have
  opposite windings by construction. Package UVs are derived from vertex
  POSITION now, which is winding-independent.

  and the check itself was wrong: with all three objects in the scene, the
  camera aimed at the dozen box's end face sat on the far side of the sleeve,
  so "dozen-end" photographed the sleeve. Each subject is isolated now.

    blender --factory-startup -b --python tools/blender/hero/check_package_faces.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import build_balls as B  # noqa: E402

OUT = os.path.join(os.getcwd(), "qa", "hero", "balls", "faces")

H.reset_scene()
H.set_engine("EEVEE", samples=64)
p = B.build(line="kestrel")
H.studio(center=(0, 0, 0.06), scale=0.14)

VIEWS = [
    ("sleeve-front", "sleeve", (0, -1, 0)),
    ("sleeve-side", "sleeve", (1, 0, 0)),
    ("sleeve-back", "sleeve", (0, 1, 0)),
    ("dozen-front", "dozen", (0, -1, 0)),
    ("dozen-top", "dozen", (0, 0, 1)),
    ("dozen-end", "dozen", (1, 0, 0)),
    ("dozen-back", "dozen", (0, 1, 0)),
]
subjects = [p["ball"], p["sleeve"], p["dozen"]]

for name, key, nrm in VIEWS:
    ob = p[key]
    for o in subjects:
        o.hide_render = (o is not ob)
    lo, hi = H.bounds([ob])
    c = (lo + hi) * 0.5
    span = max((hi - lo).x, (hi - lo).y, (hi - lo).z)
    cam = H.camera(name, c + Vector(nrm) * (span * 3.4), c, lens=110.0)
    H.render(cam, os.path.join(OUT, f"{name}.png"), res=(1000, 1000))
    bpy.data.objects.remove(cam, do_unlink=True)

for o in subjects:
    o.hide_render = False
print(f"package faces rendered to {OUT}")
