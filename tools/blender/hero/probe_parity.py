"""Does ray parity fix the cavity bug that closest-point-normal has?

The claim to test: for a SOLIDIFIED shell, a point in the cavity is OUTSIDE the
closed manifold (the manifold's interior is the wall material only), so a
crossing-count test answers correctly where the closest-point normal does not --
closest_point_on_mesh lands on the INNER wall for a cavity point, and that
normal faces into the cavity, which flips the sign.

Measured on the basket, whose handles arc over the open top and which the
shipped instrument reports as 70 mm "inside" a 6 mm shell.

    blender --factory-startup -b --python tools/blender/hero/probe_parity.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402


def inside_by_parity(host, p_world, eps=1e-6):
    """Crossing count along +X. Odd = inside the closed volume."""
    local = host.matrix_world.inverted() @ p_world
    direction = Vector((1.0, 0.0, 0.0))
    origin = local.copy()
    crossings = 0
    for _ in range(64):
        ok, loc, _nrm, _i = host.ray_cast(origin, direction)
        if not ok:
            break
        crossings += 1
        origin = loc + direction * eps
    return crossings % 2 == 1


import build_basket as BK  # noqa: E402

H.reset_scene()
H.set_engine("EEVEE", samples=8)
p = BK.build()
body = p["body"]

print()
print("THE CAVITY BUG, MEASURED BOTH WAYS")
for i, h in enumerate(p["handles"]):
    mw = h.matrix_world
    old = [HS.point_depth_inside(body, mw @ v.co) for v in h.data.vertices]
    new = [inside_by_parity(body, mw @ v.co) for v in h.data.vertices]
    print(f"  handle {i}: closest-point-normal says {sum(1 for d in old if d > 0)}"
          f"/{len(old)} verts inside (deepest {max(old) * 1000:+.2f} mm)")
    print(f"            ray parity says            {sum(new)}"
          f"/{len(new)} verts inside")

# The bosses ARE genuinely in the wall material -- the instrument must still say
# so, or the fix has just swapped one wrong answer for another.
for b in p["bosses"][:2]:
    mw = b.matrix_world
    old = [HS.point_depth_inside(body, mw @ v.co) for v in b.data.vertices]
    new = [inside_by_parity(body, mw @ v.co) for v in b.data.vertices]
    print(f"  {b.name}: normal {sum(1 for d in old if d > 0)}/{len(old)} inside,"
          f"  parity {sum(new)}/{len(new)} inside   (these SHOULD be in the wall)")

# And a control: a point unambiguously in mid-air, and one unambiguously in the
# thickest solid part of the shell.
air = Vector((0, 0, 2.0))
print(f"  a point 2 m above the basket: normal "
      f"{HS.point_depth_inside(body, air) * 1000:+.1f} mm, parity "
      f"{inside_by_parity(body, air)}")
