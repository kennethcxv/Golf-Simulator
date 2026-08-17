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


def assert_irregular(values, label, min_spread=0.0012, min_gap=0.0006,
                     min_range=0.0):
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
    # THE PAIRWISE TEST DOES NOT APPLY TO SAMPLES OF A SMOOTH CURVE, and
    # callers that pass min_gap=0 are saying so deliberately. Ply edges in a
    # stack are separate things and two at the same height read as one; nine
    # samples along an outline are not separate things, and near any crest the
    # neighbours agree because the curve has a turning point there. Demanding
    # they differ forces high-frequency noise into the silhouette -- the
    # buckled, wavy outline that was itself a fault two rounds ago.
    #
    # What a flat outline actually is, is one that barely changes across the
    # whole garment. That is min_range, and it is measured end to end.
    if min_range > 0.0 and (vs[-1] - vs[0]) < min_range:
        raise SystemExit(
            f"BUILD FAILED: {label} -- the outline is straight: it varies by "
            f"{(vs[-1] - vs[0]) * 1000:.2f} mm across the whole garment "
            f"(needs {min_range * 1000:.1f}). A folded garment's edge breathes; "
            f"an edge that does not is a moulded block.")
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


def silhouette(obj, samples=9, span=0.72):
    """The garment's half-depth at N stations across its width, off the MESH.

    assert_irregular needs numbers a human would line up by eye, and on a
    folded garment that is the outline: if every station has the same depth the
    thing is a machined block whatever the surface does. Measured rather than
    predicted, for the reason edge_x is: the outline is the product of the
    footprint, the wander and the lean together, and the builder's own
    parameters do not tell you what came out.
    """
    mw = obj.matrix_world
    pts = [mw @ v.co for v in obj.data.vertices]
    xs = [q.x for q in pts]
    x0, x1 = min(xs), max(xs)
    cx, cy = (x0 + x1) * 0.5, sum(q.y for q in pts) / len(pts)
    half = (x1 - x0) * 0.5 * span
    out = []
    # BANDS THAT DO NOT OVERLAP. At (x1 - x0) / (samples * 2) each band was
    # wider than the gap between stations, so two neighbouring stations could
    # return the SAME extreme vertex and report it as two measurements that
    # agree exactly -- 142.5 / 142.5 on the polo, which is the instrument
    # talking to itself, not a straight edge on the garment. Half the station
    # pitch makes the bands abut without sharing.
    pitch = (2 * half) / (samples - 1.0)
    band = pitch * 0.5
    for i in range(samples):
        xa = cx - half + pitch * i
        near = [abs(q.y - cy) for q in pts if abs(q.x - xa) < band]
        if not near:
            raise SystemExit(
                f"BUILD FAILED: silhouette found no surface on {obj.name} at "
                f"x={xa:+.4f} -- it will not answer with a default")
        out.append(max(near))
    return out


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


def assert_not_buried(parts, label, min_out=0.35, only=None):
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
    # `only` names the parts to JUDGE; every part is still an occluder. The
    # cloth is the thing that does the burying and has ten thousand polygons,
    # so judging it costs minutes and answers a question nobody asked.
    subjects = names if only is None else [n for n in names if n in only]
    faults, scores = [], []
    for na in subjects:
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
    if not scores:
        raise SystemExit(f"BUILD FAILED: {label} -- assert_not_buried judged "
                         f"NOTHING. It refuses rather than printing a pass on "
                         f"an empty set, which is how a check certifies air.")
    lo = min(scores, key=lambda r: r[1])
    print(f"  buried assertion passed: {len(scores)} parts, least exposed is "
          f"{lo[0]} at {lo[1] * 100:.0f}% ({label})")
    return scores
