"""NEGATIVE CONTROL for the four cloth-reads-as-cloth checks.

A check that has never been watched failing is not a check. Each of the four is
run here against the exact fault it exists to catch AND against geometry that is
genuinely right, because an assertion that fails everything proves as little as
one that fails nothing.

The known-bad cases are not hypothetical. Every one of them shipped:

  RELIEF        v2's collar washed out completely on the folded polo's top view
  IRREGULARITY  v2's stack was an even comb of plies at identical pitch
  FLAT CAPS     the sleeve, the cuff, the hood end and the flap ends, four times
  BURIED        the collar vanished at six plies and nothing failed

    blender --factory-startup -b --python \\
        tools/blender/hero/v3/control_cloth_checks.py
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402
import cloth_checks as CC  # noqa: E402

WRONG = []


def expect(name, want_fail, fn):
    try:
        fn()
        got, msg = False, ""
    except SystemExit as e:
        got, msg = True, str(e).splitlines()[0]
    ok = got == want_fail
    print(f"  {'ok  ' if ok else '!! WRONG'}  {name}")
    print(f"          {'FAILED: ' + msg if got else 'passed'}")
    if not ok:
        WRONG.append(name)


def slab(name, centre, size):
    ob = HS.box(name, centre, size)
    return HS.apply_mods(ob)


print()
print("=" * 78)
print("PART 1 - RELIEF: a seam that cannot cast a shadow is not a seam")
print("=" * 78)
H.reset_scene()
host = slab("Cloth", (0, 0, 0), (0.300, 0.220, 0.010))
for proud_mm, want_fail, why in ((0.4, True, "0.4 mm: v2's washed-out collar"),
                                 (1.2, True, "1.2 mm: still under the limit"),
                                 (3.5, False, "3.5 mm: reads at player distance")):
    # a trim strip whose top sits `proud_mm` above the cloth's top face
    top = 0.005
    th = 0.004
    cz = top + proud_mm / 1000.0 - th * 0.5
    trim = slab(f"Trim{proud_mm}", (0, 0, cz), (0.200, 0.014, th))
    expect(f"assert_relief at {proud_mm:.1f} mm proud -- {why}", want_fail,
           lambda t=trim: CC.assert_relief([(t, host, t.name)], "control"))

print()
print("=" * 78)
print("PART 2 - IRREGULARITY: an even comb reads as manufactured")
print("=" * 78)
EVEN = [0.000, 0.010, 0.020, 0.030, 0.040]
TIGHT = [0.000, 0.0103, 0.0104, 0.030, 0.041]
REAL = [0.000, 0.0091, 0.0207, 0.0284, 0.0417]
for vals, want_fail, why in ((EVEN, True, "a perfect ladder at 10 mm pitch"),
                             (TIGHT, True, "two plies 0.1 mm apart"),
                             (REAL, False, "gaps that genuinely vary")):
    expect(f"assert_irregular -- {why}", want_fail,
           lambda v=vals: CC.assert_irregular(v, "control"))

print()
print("=" * 78)
print("PART 3 - FLAT CAPS: the fault that shipped four times")
print("=" * 78)
H.reset_scene()


def tube(name, capped):
    rings = []
    for k in range(5):
        r = 0.030 if capped or k < 3 else 0.030 * (1.0 - (k - 2) * 0.42)
        ring = [Vector((math.cos(2 * math.pi * i / 12) * r,
                        math.sin(2 * math.pi * i / 12) * r,
                        k * 0.020)) for i in range(12)]
        rings.append(ring)
    verts, faces = [], []
    for ring in rings:
        verts.extend(ring)
    for a in range(len(rings) - 1):
        for i in range(12):
            j = (i + 1) % 12
            faces.append((a * 12 + i, a * 12 + j, (a + 1) * 12 + j,
                          (a + 1) * 12 + i))
    if capped:
        # exactly what CL.loft does: one n-gon over the end ring
        faces.append(tuple(range(11, -1, -1)))
        b = (len(rings) - 1) * 12
        faces.append(tuple(range(b, b + 12)))
    else:
        # tucked: a pole at each end, so the closure is triangles
        for b, order in (((0), False), (((len(rings) - 1) * 12), True)):
            c = len(verts)
            verts.append(Vector((0.0, 0.0, (0.0 if not order else 4 * 0.020)
                                 + (-0.012 if not order else 0.012))))
            for i in range(12):
                j = (i + 1) % 12
                faces.append((c, b + j, b + i) if not order
                             else (c, b + i, b + j))
    return HS.mesh_from(name, verts, faces, smooth=True)


for capped, want_fail, why in ((True, True, "loft's own n-gon end cap"),
                               (False, False, "tucked closed with a pole")):
    ob = tube(f"Tube{'Capped' if capped else 'Tucked'}", capped)
    expect(f"assert_no_flat_caps -- {why}", want_fail,
           lambda o=ob: CC.assert_no_flat_caps([o], "control"))

print()
print("=" * 78)
print("PART 4 - BURIED: the collar that vanished and nothing failed")
print("=" * 78)
H.reset_scene()
cloth = slab("Body", (0, 0, 0), (0.300, 0.220, 0.020))
sunk = slab("SunkCollar", (0, 0.05, 0.000), (0.100, 0.040, 0.006))
prouds = slab("ProudCollar", (0, -0.05, 0.012), (0.100, 0.040, 0.006))
expect("assert_not_buried -- a collar sunk inside the cloth", True,
       lambda: CC.assert_not_buried({"body": cloth, "collar": sunk}, "control"))
expect("assert_not_buried -- a collar sitting on it", False,
       lambda: CC.assert_not_buried({"body": cloth, "collar": prouds}, "control"))

print()
if WRONG:
    raise SystemExit("CONTROL FAILED: " + "; ".join(WRONG))
print("CONTROL PASSED - all four cloth checks have been watched failing on the "
      "fault they exist to catch, and passing on geometry that is right.")
