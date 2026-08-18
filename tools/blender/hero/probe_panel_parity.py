"""WHY does the assembly check say two adjacent cap panels overlap by 85 mm?

85 mm is the crown's own radius. A number that size between two panels that
share a seam is not a modelling fault, it is an instrument reading, and the
rule here is that an instrument gets measured before the model does.

    blender --factory-startup -b --python tools/blender/hero/probe_panel_parity.py
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402
import build_cap as C  # noqa: E402
from mathutils import Vector  # noqa: E402

H.reset_scene()
p = {}
C.build_crown(p)
a, b = p["panel2"], p["panel3"]

worst, worst_v, worst_src = -1e9, None, ""
for src, dst, label in ((a, b, "panel2 vertex vs panel3"),
                        (b, a, "panel3 vertex vs panel2")):
    for v in src.data.vertices:
        w = src.matrix_world @ v.co
        d = HS.point_depth_inside(dst, w)
        if d > worst:
            worst, worst_v, worst_src = d, w, label

print(f"\nworst reading: {worst * 1000:+.2f} mm  ({worst_src})")
print(f"at world point ({worst_v.x * 1000:+.2f}, {worst_v.y * 1000:+.2f}, "
      f"{worst_v.z * 1000:+.2f}) mm")

host = b if worst_src.startswith("panel2") else a
print(f"host = {host.name}")

# THE QUESTION: how many times does a ray from that point cross the host, and
# does the answer depend on the direction chosen? Parity is only meaningful if
# it does not.
DIRS = {
    "+x  (what point_inside uses)": Vector((1.0, 0.0, 0.0)),
    "+y": Vector((0.0, 1.0, 0.0)),
    "+z": Vector((0.0, 0.0, 1.0)),
    "tilted a": Vector((0.5773, 0.3313, 0.7457)).normalized(),
    "tilted b": Vector((-0.4472, 0.8090, 0.3810)).normalized(),
    "tilted c": Vector((0.2673, -0.5345, 0.8018)).normalized(),
}
local = host.matrix_world.inverted() @ worst_v
print("\ncrossings by ray direction:")
for name, d in DIRS.items():
    origin, n = local.copy(), 0
    for _ in range(64):
        ok, loc, _nrm, _i = host.ray_cast(origin, d)
        if not ok:
            break
        n += 1
        origin = loc + d * 1e-6
    print(f"  {name:<28} {n} crossings -> "
          f"{'INSIDE' if n % 2 else 'outside'}")

ok, loc, _n, _i = host.closest_point_on_mesh(local)
print(f"\nnearest surface of {host.name} is "
      f"{((host.matrix_world @ loc) - worst_v).length * 1000:.2f} mm away")
print("\nA point 85 mm from the nearest surface of a 2.6 mm shell cannot be "
      "inside it.\nWhichever directions disagree, the +x answer is the one the "
      "library believes.")
