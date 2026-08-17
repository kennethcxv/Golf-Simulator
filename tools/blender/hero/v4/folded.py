"""Folded garments: ONE ribbon of cloth, folded, not a stack of pillows.

Reference: qa/hero/v4/ref/folded-ref1.jpg (a stack of folded polos on a shop
table). What it shows, and what v3 missed:

  * The front edge is where the garment is READ. Two or three soft lips are
    stacked there with shadow between them, and they are all different -- one
    wider, one set back, one rolled tighter.
  * The top surface is not flat. It undulates, and the folded-in side edge
    crosses it as a long soft crease.
  * Nothing is straight. Every edge wanders by a few millimetres.
  * The stack COMPRESSES: the lower plies are flatter and wider than the
    upper ones.

v3 built the concertina and got the hard part right -- the x end of a folded
garment is a HEM, not a point, and the cloth's own thickness is what closes
it. What it got wrong is that every ply came out identical, which is what
turns a fold into a mattress. The variation is the whole thing.

The ribbon is swept along a zigzag path: front to back, roll, back to front,
roll, and so on. Its ends finish at the FRONT, which is why a real folded
shirt shows a cut edge, then a rolled fold, then another cut edge.
"""

import math

import bmesh
from mathutils import Vector

import drape as D


def stadium(hw, ht, n):
    """`n` points round a rectangle 2hw x 2ht with SEMICIRCULAR ends, spaced by
    arc length.

    A superellipse will not do here. At hw = 150 mm and ht = 6 mm even an
    exponent of 6 rounds the corner over 18 mm of width, so the hem comes out
    as a long soft ramp instead of the tight roll a folded edge actually has.
    """
    flat = max(1e-5, hw - ht)
    per = 4.0 * flat + 2.0 * math.pi * ht
    out = []
    for i in range(n):
        s = per * i / n
        if s < flat:                                    # +x half of the top
            out.append((s, ht))
        elif s < flat + math.pi * ht:                   # the +x end
            a = (s - flat) / ht
            out.append((flat + ht * math.sin(a), ht * math.cos(a)))
        elif s < 3.0 * flat + math.pi * ht:             # the bottom
            out.append((flat - (s - flat - math.pi * ht), -ht))
        elif s < 3.0 * flat + 2.0 * math.pi * ht:       # the -x end
            a = (s - 3.0 * flat - math.pi * ht) / ht
            out.append((-flat - ht * math.sin(a), -ht * math.cos(a)))
        else:                                           # -x half of the top
            out.append((-flat + (s - 3.0 * flat - 2.0 * math.pi * ht), ht))
    return out


def zigzag(half_d, plies, ply_t, roll_r, ply_gap):
    """The ribbon's centreline in (y, z), and a per-point ply index.

    Returns [(y, z, ply, t_along_ply)] sampled evenly enough that the rolls
    stay round.
    """
    pts = []
    z = 0.0
    for p in range(plies):
        y0 = -half_d if p % 2 == 0 else half_d
        y1 = -y0
        n = 26
        for i in range(n + 1):
            t = i / n
            pts.append((y0 + (y1 - y0) * t, z, p, t))
        if p == plies - 1:
            break
        # the U-turn: a half circle carrying the cloth up to the next ply
        rise = ply_t + ply_gap
        r = max(roll_r, rise * 0.5)
        cy = y1
        for i in range(1, 9):
            a = math.pi * i / 9.0
            pts.append((cy + math.sin(a) * r * (1 if y1 > 0 else -1),
                        z + (1.0 - math.cos(a)) * rise * 0.5, p + 0.5, i / 9.0))
        z += rise
    return pts


def concertina(name, half_w, half_d, plies=4, ply_t=0.0085, ply_gap=0.0022,
               roll_r=0.0060, nu=40, wander=0.0035, seed=1.0,
               squash=0.30, bulk=None):
    """One ribbon of cloth, folded `plies` times.

    `bulk(x_frac, ply)` adds thickness where the garment's own mass is -- the
    sleeves folded underneath, the collar band, the waistband. Without it
    every ply is the same slab and the fold reads as a mattress.
    """
    path = zigzag(half_d, plies, ply_t, roll_r, ply_gap)
    top_z = max(p[1] for p in path)
    rows = []
    for i, (y, z, ply, t) in enumerate(path):
        a = path[max(0, i - 1)]
        b = path[min(len(path) - 1, i + 1)]
        tg = Vector((0.0, b[0] - a[0], b[1] - a[1]))
        tg = tg.normalized() if tg.length > 1e-9 else Vector((0, 1, 0))
        nrm = Vector((0.0, -tg.z, tg.y))

        # THE STACK COMPRESSES. Lower plies carry the ones above them: they
        # spread wider and flatten. This is the single cue that says a pile of
        # cloth rather than a pile of boards.
        depth = 1.0 - (z / max(1e-6, top_z))
        hw = half_w * (1.0 + squash * 0.055 * depth)
        ht = ply_t * 0.5 * (1.0 - squash * 0.34 * depth)
        if bulk is not None:
            ht *= bulk(t, ply)

        # nothing is straight: every ply's edge wanders, and differently
        wob = (wander * math.sin(t * 4.1 + ply * 2.3 + seed)
               + wander * 0.5 * math.sin(t * 9.7 - ply * 1.7 + seed * 2.1))
        hw += wob

        row = []
        for (sx, sn) in stadium(hw, ht, nu):
            p = Vector((sx, y, z)) + nrm * sn
            row.append(tuple(p))
        rows.append(row)

    ob = D.grid_mesh(name, rows, wrap_u=True)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
    bm.to_mesh(ob.data)
    bm.free()
    D.shade_smooth(ob, 44.0)
    ob["top_z"] = top_z
    return ob


def top_at(ob, x, y, above=0.40):
    """Where the top surface of a folded garment is, at (x, y). Ray DOWN, so
    features land on the top ply and not on whatever is nearest."""
    from mathutils.bvhtree import BVHTree
    if getattr(top_at, "_for", None) is not ob:
        top_at._for = ob
        top_at._bvh = BVHTree.FromPolygons(
            [v.co.copy() for v in ob.data.vertices],
            [tuple(p.vertices) for p in ob.data.polygons])
    hit, nrm, _i, _d = top_at._bvh.ray_cast(Vector((x, y, above)),
                                            Vector((0.0, 0.0, -1.0)), 2.0)
    return (hit, nrm) if hit is not None else (None, None)


def undulate(ob, amp=0.0022, seed=1.0, only_top=0.60):
    """Soften the top face. A folded garment's upper surface is never a plane;
    it dips where the plies below it are thinner and rises over the sleeve."""
    zs = [v.co.z for v in ob.data.vertices]
    hi, lo = max(zs), min(zs)
    for v in ob.data.vertices:
        f = (v.co.z - lo) / max(1e-6, hi - lo)
        if f < only_top:
            continue
        w = (f - only_top) / (1.0 - only_top)
        n = (math.sin(v.co.x * 17.0 + seed) * math.cos(v.co.y * 23.0 - seed)
             + 0.55 * math.sin(v.co.x * 31.0 - seed * 1.7)
             * math.cos(v.co.y * 13.0 + seed))
        v.co.z += n * amp * w


def side_crease(ob, x, depth=0.0034, width=0.010, above=0.55):
    """The long soft crease where the garment's side was folded in. It runs the
    whole length of the top ply and is one of the clearest cues in the
    reference."""
    zs = [v.co.z for v in ob.data.vertices]
    hi, lo = max(zs), min(zs)
    for v in ob.data.vertices:
        f = (v.co.z - lo) / max(1e-6, hi - lo)
        if f < above:
            continue
        w = (f - above) / (1.0 - above)
        d = abs(v.co.x - x)
        v.co.z -= depth * math.exp(-(d / width) ** 2) * w
