"""THE CHECKS THAT ASK WHETHER IT READS AS CLOTH.

Every cloth assertion up to now tests CONSTRUCTION -- is it one piece, do the
parts touch, do the plies stand clear. All of them can pass on a garment that
looks like a moulded lid, and that is why four reviews in a row collapsed into
"the faults I listed are gone".

These four measure the things the reviews actually kept objecting to. Each one
is watched failing on a known-bad case in `control_cloth_checks.py` before it is
trusted, the way `assert_leaves_clear` was -- that one earned its keep the
moment leaves were driven 4 mm into each other and the general check sailed
straight through.

    RELIEF          a seam that cannot cast a shadow is not a seam
    IRREGULARITY    dead-level and evenly-spaced are what read as manufactured
    NO FLAT CAPS    four separate parts have shipped with a lofted end cap
    NOT BURIED      the collar that vanished came from top_z, silently
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402
import hardsurface_lib as HS  # noqa: E402


def proud_of(part, host):
    """How far the FURTHEST vertex of `part` stands outside `host`, in metres.

    point_depth_inside is positive inside and negative outside, so the most
    exposed vertex is the most negative one.
    """
    mw = part.matrix_world
    worst = -1e9
    for v in part.data.vertices:
        d = -HS.point_depth_inside(host, mw @ v.co)
        if d > worst:
            worst = d
    return worst


def assert_relief(pairs, label, min_proud=0.0022):
    """A SEAM THAT CANNOT CAST A SHADOW IS NOT A SEAM.

    `pairs` is [(trim, host, name), ...]. Every trim part has to stand at least
    `min_proud` clear of the cloth it sits on, because relief below about two
    millimetres washes out completely at the distance a player stands -- which
    is the single note that has come back on the apparel every single round:
    "the relief is too shallow and it all washes out".

    This is deliberately NOT a taste call. It is a distance, and it is measured.
    """
    faults, got = [], []
    for trim, host, name in pairs:
        p = proud_of(trim, host)
        got.append((name, p))
        if p < min_proud:
            faults.append(f"{name} stands only {p * 1000:.2f} mm proud of the "
                          f"cloth (needs {min_proud * 1000:.1f})")
    if faults:
        raise SystemExit(f"BUILD FAILED: {label} -- " + "; ".join(faults))
    lo = min(got, key=lambda r: r[1])
    print(f"  relief assertion passed: {len(got)} trims, shallowest is "
          f"{lo[0]} at {lo[1] * 1000:.2f} mm ({label})")
    return got


def assert_irregular(values, label, min_spread=0.0012, min_gap=0.0006):
    """DEAD-LEVEL AND EVENLY-SPACED ARE THE TWO THINGS THAT READ AS MADE.

    `values` is a list of measured positions -- ply edges along a stack, hem
    heights round a garment, whatever the eye would line up. Two conditions:

      * no two may agree within `min_gap`, so nothing lines up exactly, and
      * the GAPS between them must themselves vary by `min_spread`, so they are
        not an even comb.

    The second half is the one that matters and the one a human reviewer keeps
    catching by eye. A perfectly even ladder passes any "are they different?"
    test while looking machined, which is exactly what v2's stack did.
    """
    if len(values) < 3:
        raise SystemExit(
            f"BUILD FAILED: {label} -- irregularity needs at least three "
            f"values to have gaps to compare; got {len(values)}")
    vs = sorted(values)
    gaps = [b - a for a, b in zip(vs[:-1], vs[1:])]
    tight = [(a, b) for a, b in zip(vs[:-1], vs[1:]) if (b - a) < min_gap]
    spread = max(gaps) - min(gaps)
    if tight:
        raise SystemExit(
            f"BUILD FAILED: {label} -- {len(tight)} pair(s) line up within "
            f"{min_gap * 1000:.2f} mm of each other: "
            + ", ".join(f"{a * 1000:.1f}/{b * 1000:.1f}" for a, b in tight[:4]))
    if spread < min_spread:
        raise SystemExit(
            f"BUILD FAILED: {label} -- the gaps are an even comb: they run "
            f"{min(gaps) * 1000:.2f} to {max(gaps) * 1000:.2f} mm, a spread of "
            f"{spread * 1000:.2f} (needs {min_spread * 1000:.1f}). Evenly "
            f"spaced is what reads as manufactured.")
    print(f"  irregularity assertion passed: {len(vs)} edges, gaps "
          f"{min(gaps) * 1000:.1f}-{max(gaps) * 1000:.1f} mm ({label})")
    return spread


def assert_no_flat_caps(objs, label, max_sides=4):
    """EVERY LOFT END CLOSED OR TUCKED.

    `CL.loft` caps its first and last ring with a single n-gon, and that cap is
    a flat plate wherever the ring still has real size. It has shipped four
    separate times -- the polo's sleeve, the tee's cuff, the hoodie's hood end
    and the folded flap's ends -- and each time it was found by eye, fixed by
    hand, and never made checkable.

    An n-gon with more than four sides IS that cap. Cloth built here is quads
    and the occasional pole triangle, so the rule is crisp and there is nothing
    to tune.
    """
    faults = []
    for ob in objs:
        big = [len(p.vertices) for p in ob.data.polygons
               if len(p.vertices) > max_sides]
        if big:
            faults.append(f"{ob.name} has {len(big)} n-gon cap(s) of "
                          f"{sorted(set(big))} sides")
    if faults:
        raise SystemExit(
            f"BUILD FAILED: {label} -- a lofted end left flat: "
            + "; ".join(faults)
            + ". Close it with tuck rings, do not cap it.")
    print(f"  flat-cap assertion passed: {len(objs)} parts, no polygon over "
          f"{max_sides} sides ({label})")


def assert_not_buried(parts, label, min_out=0.35):
    """EVERY PART REACHABLE BY LIGHT.

    The collar disappeared for two rounds because `top_z` answers with the
    nearest vertex above a height cut, and with six plies inside one shell that
    can be the ply BELOW the top one. Seven millimetres low is enough to bury a
    collar completely, and nothing failed, because the collar is allow-listed to
    interpenetrate the cloth. "It is allowed to overlap" and "it is allowed to
    vanish" are not the same permission.

    So: at least `min_out` of each part's vertices must lie outside every other
    part. A buried collar scores near zero.
    """
    # AREA-WEIGHTED, not vertex-counted. Counting vertices is brittle on a
    # low-polygon part: a box seated 1 mm into the cloth has half its vertices
    # on the bottom face and scores 50% buried while being plainly visible.
    # The control caught exactly that as a false positive. What matters is how
    # much SURFACE the light can reach.
    names = sorted(parts)
    faults, scores = [], []
    for na in names:
        a = parts[na]
        mw = a.matrix_world
        if not a.data.polygons:
            continue
        total = out_area = 0.0
        for poly in a.data.polygons:
            area = poly.area
            total += area
            q = mw @ poly.center
            if all(HS.point_depth_inside(parts[nb], q) <= 0.0
                   for nb in names if nb != na):
                out_area += area
        if total <= 0.0:
            continue
        frac = out_area / total
        scores.append((na, frac))
        if frac < min_out:
            faults.append(f"{na} has only {frac * 100:.0f}% of its surface outside "
                          f"the other parts -- it is buried")
    if faults:
        raise SystemExit(f"BUILD FAILED: {label} -- " + "; ".join(faults))
    lo = min(scores, key=lambda r: r[1])
    print(f"  buried assertion passed: {len(scores)} parts, least exposed is "
          f"{lo[0]} at {lo[1] * 100:.0f}% ({label})")
    return scores
