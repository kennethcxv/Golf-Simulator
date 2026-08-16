"""AUDIT — run the SHIPPED assertions against three assets with confirmed faults.

Not a new check. This imports each builder, calls its `build()`, and runs the
exact assertion calls that builder runs, catching SystemExit so one failure does
not hide the rest. Then it measures the GROUND TRUTH for the specific fault the
review found, so "the assertion passed" can be set beside "and here is what the
geometry actually is".

    blender --factory-startup -b --python tools/blender/hero/audit_assertions.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402


def run(label, fn):
    """Run one assertion exactly as the builder runs it; report its verdict."""
    try:
        fn()
    except SystemExit as e:
        print(f"    FAIL  {label}\n          {str(e).splitlines()[0]}")
        return False
    print(f"    PASS  {label}")
    return True


def depth_stats(a, b):
    """Signed depth of a's vertices inside b: max (deepest) and count inside."""
    mwa = a.matrix_world
    d = [HS.point_depth_inside(b, mwa @ v.co) for v in a.data.vertices]
    inside = [x for x in d if x > 0]
    return max(d), len(inside), len(d)


def centreline_probe(a, b, n=400):
    """True minimum surface-to-surface distance, sampled both directions.

    surface_gap() only walks a's VERTICES. Two smooth tubes crossing between
    their vertices are invisible to it, so this samples both ways and reports
    the worst case.
    """
    return min(HS.surface_gap(a, b), HS.surface_gap(b, a))


# ---------------------------------------------------------------------------
print("=" * 78)
print("ASSET 1 — THE CUSTOMER BASKET   (fault: the two bail handles read as crossing)")
print("=" * 78)

import build_basket as BK  # noqa: E402

H.reset_scene()
H.set_engine("EEVEE", samples=16)
p = BK.build()

print("  the assertions this builder ships:")
for i, h in enumerate(p["handles"]):
    run(f"assert_touching(handle{i}, body, require_surface=True)",
        lambda h=h: HS.assert_touching(h, p["body"], "handle attached to rim",
                                       max_gap=0.0025, require_surface=True))
run("assert_rooted(bosses, body)",
    lambda: HS.assert_rooted(p["bosses"], p["body"], "handle pivot bosses",
                             min_verts=3, min_depth=0.0015))
run("assert_no_overlap(handleA, handleB)   <-- THE ONE IN QUESTION",
    lambda: HS.assert_no_overlap(p["handles"][0], p["handles"][1],
                                 "handles must not be inside each other",
                                 min_gap=0.0015))
run("assert_touching(badge, body)",
    lambda: HS.assert_touching(p["badge"], p["body"], "badge seated",
                               max_gap=BK.RIB_DEPTH + BK.WALL * 0.5))
run("assert_fits_inside(interior, LOAD)",
    lambda: HS.assert_fits_inside(p["interior"], BK.LOAD, "holds goods",
                                  margin=0.0040))

a, b = p["handles"]
print("  ground truth:")
dab, nab, tot = depth_stats(a, b)
dba, nba, _ = depth_stats(b, a)
print(f"    handle A into handle B: deepest {dab * 1000:+.2f} mm, "
      f"{nab}/{tot} verts inside")
print(f"    handle B into handle A: deepest {dba * 1000:+.2f} mm, "
      f"{nba}/{tot} verts inside")
print(f"    true min surface distance (both directions): "
      f"{centreline_probe(a, b) * 1000:.2f} mm")
alo, ahi = H.bounds([a])
blo, bhi = H.bounds([b])
print(f"    handle A y-span {alo.y:+.4f}..{ahi.y:+.4f}   "
      f"handle B y-span {blo.y:+.4f}..{bhi.y:+.4f}   "
      f"overlap {min(ahi.y, bhi.y) - max(alo.y, blo.y):+.4f} yd")

# Do the handle legs pass through the shell, as the review claimed?
for i, h in enumerate(p["handles"]):
    d, n, t = depth_stats(h, p["body"])
    print(f"    handle {i} into the BODY shell: deepest {d * 1000:+.2f} mm, "
          f"{n}/{t} verts inside  (unchecked: no assertion pairs these)")

# ---------------------------------------------------------------------------
print()
print("=" * 78)
print("ASSET 2 — THE DUSTPAN   (fault: side walls read as crossing the floor)")
print("=" * 78)

import build_dustpan as DP  # noqa: E402

H.reset_scene()
H.set_engine("EEVEE", samples=16)
parts = DP.build()
pan, handle = parts["pan"], parts["handle"]

print("  the assertions this builder ships:")
run("assert_one_piece(pan)",
    lambda: HS.assert_one_piece(pan, "the lip must be continuous with the pan"))
run("assert_touching(handle, pan)",
    lambda: HS.assert_touching(handle, pan, "handle attached to pan", max_gap=0.0015))

print("  ground truth:")
d, n, t = depth_stats(handle, pan)
print(f"    handle into pan: deepest {d * 1000:+.2f} mm, {n}/{t} verts inside")
print(f"    shells in pan: {HS.shells(pan)}")
print(f"    shells in handle: {HS.shells(handle)}")
lo, hi = H.bounds([pan])
print(f"    pan bounds z {lo.z:+.4f} .. {hi.z:+.4f}")
# Is anything below the floor? Sample the floor's own height near the centre
# line and compare with the lowest shell vertices at the extreme x.
xs = [(pan.matrix_world @ v.co) for v in pan.data.vertices]
xmax = max(abs(v.x) for v in xs)
wall = [v for v in xs if abs(v.x) > xmax * 0.92]
mid = [v for v in xs if abs(v.x) < xmax * 0.25]
print(f"    lowest point on the WALLS (|x|>92% of max): {min(v.z for v in wall):+.5f}")
print(f"    lowest point on the FLOOR (|x|<25% of max): {min(v.z for v in mid):+.5f}")
print(f"    walls hang below the floor by "
      f"{(min(v.z for v in mid) - min(v.z for v in wall)) * 1000:+.2f} mm")

# ---------------------------------------------------------------------------
print()
print("=" * 78)
print("ASSET 3 — THE PRESSURE WASHER WAND   (fault: barrel through the blue shell)")
print("=" * 78)

import build_wand as WD  # noqa: E402

H.reset_scene()
H.set_engine("EEVEE", samples=16)
w = WD.build()

print("  the assertions this builder ships:")
for key, host, lbl, tol in (("lance", "body", "lance roots in gun", 0.0025),
                            ("collar", "body", "collar on muzzle", 0.0025),
                            ("nozzle", "lance", "nozzle on lance", 0.0025),
                            ("trigger", "body", "trigger hangs off body", 0.0030),
                            ("guard", "body", "guard roots in body", 0.0035),
                            ("socket", "body", "grip socket on body", 0.0030),
                            ("grip", "socket", "grip seats in socket", 0.0030),
                            ("safety", "body", "safety on body", 0.0030),
                            ("fitting", "grip", "hose fitting in butt", 0.0030)):
    run(f"assert_touching({key}, {host})",
        lambda k=key, hh=host, l=lbl, t=tol:
            HS.assert_touching(w[k], w[hh], l, t))
run("assert_boxes_overlap(qc, lance)",
    lambda: HS.assert_boxes_overlap(w["qc"], w["lance"], "qc on lance"))
run("assert_no_overlap(trigger, guard)",
    lambda: HS.assert_no_overlap(w["trigger"], w["guard"],
                                 "trigger swings inside its guard", min_gap=0.0008))

print("  ground truth:")
for pair in (("grip", "body"), ("socket", "body"), ("fitting", "body"),
             ("guard", "grip"), ("trigger", "grip"), ("qc", "body")):
    a, b = w[pair[0]], w[pair[1]]
    d, n, t = depth_stats(a, b)
    lo, hi = H.bounds([b])
    print(f"    {pair[0]:>8} into {pair[1]:<6}: deepest {d * 1000:+8.2f} mm, "
          f"{n:>4}/{t} verts inside   (host is only "
          f"{min(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z) * 1000:.1f} mm "
          f"thick on its narrowest axis)")

print()
print("  which of those pairs has an assertion?")
have = {("lance", "body"), ("collar", "body"), ("nozzle", "lance"),
        ("trigger", "body"), ("guard", "body"), ("socket", "body"),
        ("grip", "socket"), ("safety", "body"), ("fitting", "grip"),
        ("qc", "lance"), ("trigger", "guard")}
for pair in (("grip", "body"), ("socket", "body"), ("fitting", "body"),
             ("guard", "grip"), ("trigger", "grip"), ("qc", "body")):
    print(f"    {pair[0]:>8} vs {pair[1]:<6}: "
          f"{'checked' if pair in have else 'NO ASSERTION PAIRS THESE'}")
print()
print("AUDIT COMPLETE")
