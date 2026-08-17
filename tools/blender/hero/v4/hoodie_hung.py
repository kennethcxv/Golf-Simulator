"""HOODIE, HUNG -- v4. Built against a photograph, not against v3.

Reference: qa/hero/v4/ref/hoodie-hung-ref1.jpg and -ref2.jpg (a navy pullover
hoodie on a wooden hanger, front and upper body). What that photograph says,
and what the v3 asset got wrong about every line of it:

  BODY      Straight, with a slight taper IN to the waist. v3 flared into a
            bell, because the only way to widen a lofted tube is to grow its
            radius, so its widest point was the hem.
  WAISTBAND A ribbed band NARROWER than the body, with the cloth blousing over
            it. v3 had no waistband at all -- just the rim of the loft.
  SHOULDER  A soft slope with the hanger's line showing faintly through. v3
            had two hard-edged slabs sitting on top like pauldrons.
  SLEEVES   Hang nearly vertical, flattened against the body, one broad fold
            running down the outer edge. v3 had tapered cylinders projecting
            at a fixed angle with a mechanical elbow.
  CUFFS     Ribbed, gathered, continuous with the sleeve. v3 had rings.
  HOOD      A soft mass of cloth in three or four rolls behind the neck, with
            an opening you can see into. v3 had a flat disc.
  POCKET    A panel sewn flat to the front -- you read the SEAM and its
            shadow, not a box. Relief is about 4 mm. v3 had a rounded bar
            standing 20 mm off the chest.

METHOD, and why it is a hybrid. The body is really simulated: a panelled
shell with real armholes, hung from the strip the hanger touches, dropped
under gravity. That solve is well conditioned and gives the silhouette and
the drape for free.

The sleeves and the hood are NOT simulated, after five solves that were.
Free-hanging pieces destroyed every one of them -- a sleeve resting against
the body grips it and concertinas, a hood swings and takes the neck with it,
and the whole garment left the scene at nineteen metres on the first attempt.
They are authored instead: grown from where the solve actually left the
armholes and the neckline, given fold structure by hand, and projected out of
the body so they lie on it without passing through it. The brief allows
sculpted drape and shrinkwrap; this is both, and unlike the solve it cannot
diverge.

    blender --factory-startup -b --python tools/blender/hero/v4/hoodie_hung.py
        [-- nosim | nosleeves | nohood | cycles]
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
import drape as D  # noqa: E402
import stage as ST  # noqa: E402

REPO = os.getcwd()
OUT = os.path.join(REPO, "qa", "hero", "v4", "hoodie-hung")

# --------------------------------------------------------------------------
# MEASUREMENTS -- a men's medium pullover hoodie, in metres.
# The shoulder POINT is at z = -0.045; the neck sits just above zero.

NU = 72                      # columns around the body (~16 mm at the chest)
Z_CHEST = -0.235             # armpit / bottom of the yoke
Z_WAIST_TOP = -0.638         # top of the ribbed waistband
Z_HEM = -0.700

BODY_PROFILE = [             # half-width / half-depth against height
    (-0.700, 0.256, 0.052),
    (-0.638, 0.263, 0.057),
    (-0.560, 0.277, 0.069),
    (-0.420, 0.283, 0.076),
    (-0.235, 0.285, 0.079),
]
BODY_N = 3.4                 # superellipse exponent: flattened, not oval

NECK_HW, NECK_HD, NECK_CY = 0.094, 0.076, 0.012
NECK_Z = dict(front=-0.030, side=0.005, back=0.012)
# The yoke's control ring is what puts the SHOULDER in the shoulder. A
# quadratic does NOT pass through its control point -- it reaches only a
# quarter of the way -- and the first cut had the ring at +12 mm expecting a
# shoulder at 0, which landed the shoulder 60 mm low and put the hanger bar
# through the middle of the pinned cloth. Solved instead for the point the
# curve must pass through at t = 0.5: the shoulder point, (240, -45).
# ... and then a SECOND segment, because one quadratic can only make a dome.
# A shoulder has a CORNER in it: the seam slopes gently down from the neck to
# the shoulder point, and there the silhouette breaks and the armhole edge
# drops away much more steeply. Smoothed into one curve the top of the garment
# comes out as a rounded arch, which is the poncho tell.
SHLD_HW, SHLD_HD = 0.240, 0.0865
SHLD_Z = dict(front=-0.125, side=-0.045, back=-0.108)
CTRLA_HW, CTRLA_HD = 0.274, 0.0855          # chest -> shoulder point
CTRLA_Z = dict(front=-0.182, side=-0.150, back=-0.174)
CTRLB_HW, CTRLB_HD = 0.172, 0.0870          # shoulder point -> neck
CTRLB_Z = dict(front=-0.077, side=-0.014, back=-0.058)
YOKE_A, YOKE_B = 8, 7
YOKE_ROWS = YOKE_A + YOKE_B

# Armhole: a window in the yoke. It runs from the armpit UP TO THE SHOULDER
# POINT, the yoke's half-way row -- above that row the surface is the shoulder
# seam, and cutting into it leaves the hanger nothing to hold.
ARM_U = 6
ARM_V0, ARM_V1 = 1, 8
PIN_ROWS = (9, 14)           # yoke rows the hanger bar carries
PIN_COLS = 10

SLEEVE_ROWS = 30
SLEEVE_DROP = 0.545          # armhole centroid to cuff
# The reference measures 0.754 as wide as it is tall; at 830 mm tall that is a
# 626 mm garment, half-width 313 mm. The torso is 285. So the sleeve protrudes
# TWENTY-EIGHT MILLIMETRES past the body -- it is not a tube hanging beside the
# torso, it is a flattened tube lying ON its side seam, and the section has to
# be sized for that or the garment comes out 200 mm too wide.
SLEEVE_AXIS_X = 0.268
SLEEVE_OUTER = 0.049         # half-extent outboard: 0.268 + 0.045 = 0.313
SLEEVE_DEPTH = 0.062         # ... and front-to-back
SLEEVE_SECTION = [(0.00, 1.00, 1.00), (0.34, 0.95, 0.93),
                  (0.70, 0.73, 0.78), (0.90, 0.55, 0.63),
                  (1.00, 0.49, 0.57)]
CUFF_T = 0.90                # where the ribbed cuff starts along the sleeve

# A HOOD LYING BACK IS LOW. The first cut put the face opening 130 mm above
# the shoulder datum and lofted STRAIGHT to it, which is a cone -- the render
# was a witch's hat. Down here the opening barely clears the shoulders, the
# loft arcs up and back through a spine control and comes back down to it, and
# what rises is the roll of cloth in between. That is the shape in the
# photograph: not a lid, a slumped mass with an opening on top of it.
HOOD_HALF = 0.122            # where the roll meets the neckline, each side
HOOD_BACK = 0.152            # how far back it arches
HOOD_RISE = 0.113            # ... and how far up
HOOD_R0, HOOD_R1 = 0.034, 0.062   # section radius at the ends / added at top
HOOD_ROLLS = 3.3

CLOTH_T = 0.0034             # fleece: 3.4 mm through the ply


def lerp_profile(table, z):
    if z <= table[0][0]:
        return table[0][1], table[0][2]
    if z >= table[-1][0]:
        return table[-1][1], table[-1][2]
    for (z0, a0, b0), (z1, a1, b1) in zip(table, table[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            t = t * t * (3 - 2 * t)
            return a0 + (a1 - a0) * t, b0 + (b1 - b0) * t
    return table[-1][1], table[-1][2]


def se(hw, hd, th, n=BODY_N):
    """Superellipse point. theta = 0 is CENTRE FRONT (-y), pi/2 the right side
    seam. A flattened section, because a garment is two panels."""
    sx, sy = math.sin(th), -math.cos(th)
    x = hw * math.copysign(abs(sx) ** (2.0 / n), sx) if sx else 0.0
    y = hd * math.copysign(abs(sy) ** (2.0 / n), sy) if sy else 0.0
    return x, y


def fbs(th):
    """Front / back / side weights summing to one -- how the neckline knows to
    dip at the front and the shoulder knows to stay up at the side."""
    c, s = math.cos(th), abs(math.sin(th))
    f, b, sd = max(0.0, c) ** 1.7, max(0.0, -c) ** 1.7, s ** 1.7
    tot = f + b + sd or 1.0
    return f / tot, b / tot, sd / tot


def zmix(table, th):
    f, b, s = fbs(th)
    return table["front"] * f + table["back"] * b + table["side"] * s


def bez(p0, p1, p2, t):
    return ((1 - t) ** 2 * Vector(p0) + 2 * (1 - t) * t * Vector(p1)
            + t * t * Vector(p2))


# --------------------------------------------------------------------------


def body_rows():
    rows, zs, z = [], [], Z_HEM
    while z < Z_CHEST - 1e-6:
        zs.append(z)
        z += 0.0158
    zs.append(Z_CHEST)
    for z in zs:
        hw, hd = lerp_profile(BODY_PROFILE, z)
        rows.append([(*se(hw, hd, 2 * math.pi * k / NU), z)
                     for k in range(NU)])

    chest = rows[-1]
    ring = {}
    for k in range(NU):
        th = 2 * math.pi * k / NU
        ax, ay = se(CTRLA_HW, CTRLA_HD, th)
        sx, sy = se(SHLD_HW, SHLD_HD, th)
        bx, by = se(CTRLB_HW, CTRLB_HD, th)
        nx, ny = se(NECK_HW, NECK_HD, th, n=2.6)
        ring[k] = (Vector((ax, ay, zmix(CTRLA_Z, th))),
                   Vector((sx, sy, zmix(SHLD_Z, th))),
                   Vector((bx, by, zmix(CTRLB_Z, th))),
                   Vector((nx, ny + NECK_CY, zmix(NECK_Z, th))))
    for j in range(1, YOKE_A + 1):           # armhole edge
        t = j / YOKE_A
        rows.append([tuple(bez(Vector(chest[k]), ring[k][0], ring[k][1], t))
                     for k in range(NU)])
    for j in range(1, YOKE_B + 1):           # shoulder seam
        t = j / YOKE_B
        rows.append([tuple(bez(ring[k][1], ring[k][2], ring[k][3], t))
                     for k in range(NU)])
    return rows, len(zs) - 1


def loop_indices(u0, u1, v0, v1, sign):
    us, vs = list(range(u0, u1 + 1)), list(range(v0, v1 + 1))
    loop = [(u, v0) for u in us[:-1]]
    loop += [(u1, v) for v in vs[:-1]]
    loop += [(u, v1) for u in reversed(us[1:])]
    loop += [(u0, v) for v in reversed(vs[1:])]
    if sign < 0:
        loop = [loop[0]] + loop[1:][::-1]
    return loop


def bar_z(x):
    return -0.006 - 0.048 * (min(abs(x), 0.215) / 0.215) ** 1.35


def hanger():
    """A moulded retail hanger, sitting just inside the shoulders.

    It is NOT a collider. Its first cut was, and its bar crossed the pinned
    shoulder strip by two millimetres -- a collider pushing on vertices that
    cannot move is the one thing the solver cannot integrate. The cloth is
    pinned along this same line instead, which is what the bar would have done.
    """
    pts = [Vector((-0.215 + 0.430 * (i / 26.0), 0.0,
                   bar_z(-0.215 + 0.430 * (i / 26.0)))) for i in range(27)]
    bar = _sweep("hanger_bar", pts, 0.0098, 0.0050)
    hook = [Vector((0.0250 * math.sin(a) * 0.84, 0.0,
                    0.104 + 0.0250 * (1 - math.cos(a))))
            for a in (math.pi * 1.08 * (i / 29.0) - math.pi * 0.05
                      for i in range(30))]
    # The hook rises IN FRONT of the hood. Run up the centre and it comes out
    # through the middle of the hood roll.
    hook = [h + Vector((0, -0.030, 0)) for h in hook]
    wire = _sweep("hanger_hook",
                  [Vector((0, -0.006, -0.008)), Vector((0, -0.022, 0.045)),
                   Vector((0, -0.030, 0.104))] + hook[1:], 0.0031, 0.0031)
    bpy.ops.object.select_all(action='DESELECT')
    bar.select_set(True)
    wire.select_set(True)
    bpy.context.view_layer.objects.active = bar
    bpy.ops.object.join()
    bar.name = "hanger"
    D.shade_smooth(bar, 40.0)
    return bar


def _sweep(name, pts, halfw, halfh, sides=10):
    import bmesh
    rows = []
    for i, p in enumerate(pts):
        tan = (pts[min(len(pts) - 1, i + 1)] - pts[max(0, i - 1)])
        tan = tan.normalized() if tan.length > 1e-9 else Vector((1, 0, 0))
        e1 = tan.cross(Vector((0, 1, 0)))
        if e1.length < 1e-6:
            e1 = tan.cross(Vector((0, 0, 1)))
        e1.normalize()
        e2 = tan.cross(e1).normalized()
        rows.append([tuple(p + e1 * (halfh * math.cos(2 * math.pi * k / sides))
                           + e2 * (halfw * math.sin(2 * math.pi * k / sides)))
                     for k in range(sides)])
    ob = D.grid_mesh(name, rows, wrap_u=True)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.holes_fill(bm, edges=list(bm.edges))
    bm.to_mesh(ob.data)
    bm.free()
    return ob


# --------------------------------------------------------------------------
# pieces grown from where the SOLVE left the openings


def sleeve_from_loop(ob, idxs, sign, name):
    """A sleeve hanging from the armhole the cloth actually settled into.

    THE SECTION HAS TO ROTATE. An armhole is a near-vertical opening in the
    side of the body: deep front-to-back, tall in z. A hanging sleeve is the
    opposite -- wide side-to-side, shallow front-to-back. The first cut
    measured the armhole's extents in WORLD x and y and built the oval in
    world x and y too, which produced a sleeve 105 mm deep and 52 mm wide:
    the correct dimensions, applied to the wrong two axes. The frame is
    parallel-transported along the path instead, so "up at the armhole"
    becomes "outboard at the cuff" the way it does on a real sleeve.
    """
    pts = [Vector(ob.data.vertices[i].co) for i in idxs]
    C = sum(pts, Vector()) / len(pts)

    P1 = Vector((C.x + sign * 0.052, C.y - 0.006, C.z - 0.100))
    P2 = Vector((sign * SLEEVE_AXIS_X, C.y - 0.012, C.z - SLEEVE_DROP))

    T = (P1 - C).normalized()
    e1 = Vector((0, 0, 1)).cross(T)
    e1 = e1.normalized() if e1.length > 1e-6 else Vector((0, 1, 0))
    e2 = T.cross(e1).normalized()

    ang, r1, r2 = [], [], []
    for p in pts:
        d = p - C
        d = d - T * d.dot(T)
        ang.append(math.atan2(d.dot(e2), d.dot(e1)))
        r1.append(d.dot(e1))
        r2.append(d.dot(e2))
    R1 = max(abs(v) for v in r1) or 0.053     # front-to-back at the armhole
    R2 = max(abs(v) for v in r2) or 0.082     # up-down at the armhole

    rows = [[tuple(p) for p in pts]]
    prevT = T
    for j in range(1, SLEEVE_ROWS + 1):
        t = j / SLEEVE_ROWS
        c = bez(C, P1, P2, t)
        nT = (2 * (1 - t) * (P1 - C) + 2 * t * (P2 - P1)).normalized()
        ax = prevT.cross(nT)
        if ax.length > 1e-7:
            q = ax.normalized()
            a = math.asin(min(1.0, ax.length))
            e1 = e1.copy()
            e1.rotate(__import__("mathutils").Quaternion(q, a))
            e2 = e2.copy()
            e2.rotate(__import__("mathutils").Quaternion(q, a))
        prevT = nT

        sw, sh = lerp_profile(SLEEVE_SECTION, t)
        if t > CUFF_T:
            # A RIBBED CUFF IS A SEAM AND THEN A BAND. Tapering smoothly to the
            # end gives a sleeve that just stops; the read is the pinch where
            # the rib is joined on, and the slightly fuller band below it.
            g = (t - CUFF_T) / (1.0 - CUFF_T)
            pinch = 1.0 - 0.105 * math.exp(-((g - 0.10) / 0.13) ** 2)
            sw *= pinch * (1.0 - 0.10 * g)
            sh *= pinch * (1.0 - 0.07 * g)
        # ... and the section becomes a hanging sleeve's, not an armhole's
        tgt1 = (R1 + (SLEEVE_DEPTH - R1) * D._smooth(t, 0.0, 0.42)) * sw
        tgt2 = (R2 + (SLEEVE_OUTER - R2) * D._smooth(t, 0.0, 0.42)) * sh
        w = min(1.0, t / 0.30) ** 1.25
        row = []
        for i in range(len(pts)):
            a = ang[i]
            # one broad fold down the outer edge, two softer ones behind it
            f = ((0.088 * math.cos(a * 2.0 + 0.6)
                  + 0.046 * math.cos(a * 3.0 - 1.1 + t * 1.8)
                  + 0.026 * math.cos(a * 5.0 + t * 3.1))
                 * D._smooth(t, 0.14, 0.62)
                 * (1.0 + 0.30 * math.sin(t * 7.0)))
            o = (e1 * (tgt1 * (1.0 + f) * math.cos(a))
                 + e2 * (tgt2 * (1.0 + f) * math.sin(a)))
            keep = e1 * r1[i] + e2 * r2[i]
            row.append(tuple(c + keep.lerp(o, w)))
        rows.append(row)
    return D.grid_mesh(name, rows, wrap_u=True)


def hood_from_neck(ob, idxs):
    """A dropped hood is a ROLL OF CLOTH ARCHING OVER THE BACK OF THE NECK.

    Three constructions came before this one and all three were the same
    mistake: an annulus lofted from the neckline out to a face-opening ring.
    An annulus SPREADS. Lofted high it was a witch's hat; lofted low it was a
    flying saucer; bulged radially it was a sombrero. No amount of tuning gets
    a mass out of a surface whose two boundaries are both rings around the
    neck -- the cloth has nowhere to be except the space between them.

    A hood that has been pushed back is a croissant. It leaves the neckline at
    the front corners, arches up and back over where a head would be, and
    comes down at the other front corner, and its thickness is the whole read.
    So: sweep a tube along that arch, fattest at the top, with the folds as a
    ripple along its length. The face opening is the gap between the roll and
    the shoulders, which is exactly where it is on a real one.
    """
    neck = [Vector(ob.data.vertices[i].co) for i in idxs]
    nc = sum(neck, Vector()) / len(neck)

    def arch(u):                                  # u in [-1, 1]
        k = max(0.0, 1.0 - u * u)
        # the ends run DOWN INTO the shoulder, so the swept tube's end caps
        # finish inside the body instead of showing as a cut disc
        return Vector((HOOD_HALF * u,
                       nc.y - 0.046 + HOOD_BACK * k ** 0.75,
                       nc.z - 0.056 + HOOD_RISE * k ** 0.62))

    NS, NR = 30, 26
    rows = []
    for i in range(NS + 1):
        u = -1.0 + 2.0 * i / NS
        c = arch(u)
        t = (arch(min(1.0, u + 0.02)) - arch(max(-1.0, u - 0.02)))
        t = t.normalized() if t.length > 1e-7 else Vector((1, 0, 0))
        e1 = t.cross(Vector((0, 0, 1)))
        e1 = e1.normalized() if e1.length > 1e-6 else Vector((0, 1, 0))
        e2 = t.cross(e1).normalized()
        k = max(0.0, 1.0 - u * u)
        r = HOOD_R0 + HOOD_R1 * k ** 0.55
        row = []
        for j in range(NR):
            a = 2 * math.pi * j / NR
            # the folds: a ripple ALONG the roll, plus a shallower one around it
            f = (1.0 + 0.135 * math.sin(HOOD_ROLLS * math.pi * u + 1.1)
                 * math.sin(a * 1.0 + 0.4)
                 + 0.082 * math.sin(HOOD_ROLLS * 1.9 * math.pi * u - 0.6)
                 * math.sin(a * 2.0 - 0.3)
                 + 0.048 * math.sin(a * 3.0 - u * 2.2)
                 + 0.030 * math.sin(a * 5.0 + u * 4.1))
            # kidney section: flatter where it lies against the shoulders
            # Pull the roll's front underside AWAY from the neckline so a
            # cavity opens between them. Without it the roll sits flush on the
            # shoulders and the hood reads as a headrest -- the dark V at the
            # neck is most of what says "hood" at a glance.
            front_under = max(0.0, -math.cos(a)) * max(0.0, math.sin(a * 0.5))
            squash = 1.0 - 0.24 * max(0.0, -math.cos(a)) - 0.20 * front_under
            row.append(tuple(c + e1 * (r * f * squash * math.cos(a) * 1.06)
                             + e2 * (r * f * squash * math.sin(a) * 0.88)))
        rows.append(row)
    roll = D.grid_mesh("hood_roll", rows, wrap_u=True)
    _cap_ends(roll, NR, NS)

    # Looking into the neck of a real hoodie you see the INSIDE of the hood,
    # not the inside of the garment. A shallow dish across the neckline is
    # what stops this reading as a hole in the shoulders.
    lin = []
    for jj in range(7):
        tt = jj / 6.0
        row = []
        for k in range(NU):
            th = 2 * math.pi * k / NU
            n = neck[k]
            # A BOWL, NOT A DOME. Rising to a point above the neckline the
            # lining filled the hole and the neck read as solid shoulder; the
            # dark hollow you can see into is most of what says "hood".
            target = Vector((n.x * 0.34, nc.y + 0.014, nc.z - 0.062))
            row.append(tuple(n.lerp(target, tt * tt * (3 - 2 * tt))))
        lin.append(row)
    lining = D.grid_mesh("hood_lining", lin, wrap_u=True)

    bpy.ops.object.select_all(action='DESELECT')
    lining.select_set(True)
    roll.select_set(True)
    bpy.context.view_layer.objects.active = roll
    bpy.ops.object.join()
    roll.name = "hood"
    return roll


def _cap_ends(ob, nr, ns):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
    bm.to_mesh(ob.data)
    bm.free()


def pocket(ob):
    """A kangaroo pocket laid ON the drape, following its folds.

    The outline is the real one: a wide bottom edge, short side edges, then a
    DIAGONAL cut inward at each upper corner to a narrow sewn top edge. Those
    two diagonals are the hand openings and they are the whole read -- a
    kangaroo pocket announces itself by two slashes and the shadow under them.
    The first cut of this was a plain rectangle standing 10 mm off the chest
    and it looked like a folded towel taped to the front.

    Relief is 2 mm where it is sewn down and 9 mm at the openings, because a
    real one is about 4 mm on average and you find it by the LINE, not the lump.
    """
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromPolygons([v.co.copy() for v in ob.data.vertices],
                               [tuple(p.vertices) for p in ob.data.polygons])
    Z_TOP, Z_KNEE, Z_BOT = -0.430, -0.540, -0.628
    W_TOP, W_KNEE, W_BOT = 0.101, 0.183, 0.186
    NX, NY = 44, 28

    def outline(v):
        """half-width and height down the panel"""
        if v <= 0.46:
            k = v / 0.46
            k = k * k * (3 - 2 * k) * 0.86 + k * 0.14
            return (W_TOP + (W_KNEE - W_TOP) * k,
                    Z_TOP + (Z_KNEE - Z_TOP) * v / 0.46)
        k = (v - 0.46) / 0.54
        return (W_KNEE + (W_BOT - W_KNEE) * k,
                Z_KNEE + (Z_BOT - Z_KNEE) * k)

    # the stitched edges, in (x, z): bottom, both lower sides, and the top
    sewn = [((-W_BOT, Z_BOT), (W_BOT, Z_BOT)),
            ((-W_KNEE, Z_KNEE), (-W_BOT, Z_BOT)),
            ((W_KNEE, Z_KNEE), (W_BOT, Z_BOT)),
            ((-W_TOP, Z_TOP), (W_TOP, Z_TOP))]
    # ... and the two that are NOT stitched: the hand openings
    slash = [((-W_TOP, Z_TOP), (-W_KNEE, Z_KNEE)),
             ((W_TOP, Z_TOP), (W_KNEE, Z_KNEE))]

    def dist_to_seg(px, pz, sg):
        (ax, az), (bx, bz) = sg
        vx, vz = bx - ax, bz - az
        L = vx * vx + vz * vz
        t = 0.0 if L < 1e-12 else max(0.0, min(1.0, ((px - ax) * vx
                                                     + (pz - az) * vz) / L))
        return math.hypot(px - (ax + vx * t), pz - (az + vz * t))

    rows = []
    for jy in range(NY + 1):
        v = jy / NY
        hw, z = outline(v)
        z += 0.004 * math.cos(math.pi * min(1.0, v * 2.4))    # top edge arches
        row = []
        for ix in range(NX + 1):
            u = ix / NX
            x = -hw + 2 * hw * u
            # CAST A RAY, DO NOT ASK FOR THE NEAREST POINT. `find_nearest`
            # from a point out in front minimises 3D distance, and where the
            # chest curves away the answer drifts INWARD -- 26 mm on each
            # side, so a 372 mm outline conformed to a 313 mm panel and the
            # pocket looked two sizes too small. A ray straight back keeps x
            # and z exactly where the pattern put them.
            loc, nrm, _i, _d = bvh.ray_cast(Vector((x, -0.60, z)),
                                            Vector((0.0, 1.0, 0.0)), 1.2)
            if loc is None or nrm is None:
                loc, nrm = Vector((x, -0.070, z)), Vector((0, -1, 0))
            # `find_nearest` returns the FACE normal, which steps from facet to
            # facet -- lift the panel along that and it comes out creased like
            # a paper bag. Weight it heavily toward straight out of the chest.
            nrm = (nrm * 0.30 + Vector((0.0, -1.0, 0.0)) * 0.70).normalized()
            # RELIEF IS DISTANCE FROM THE NEAREST SEWN EDGE. The panel is
            # stitched along its bottom, its two lower sides and its narrow
            # top; the two diagonals are the hand openings and are not. The
            # first cut multiplied the gape by an edge falloff that was zero
            # in exactly the place the gape lived, so it cancelled itself and
            # the pocket rendered as four flat slabs.
            d = min(dist_to_seg(x, z, sg) for sg in sewn)
            # Saturating this at 42 mm left a FLAT RECTANGULAR PLATEAU across
            # the middle of the panel with a hard border -- the plateau was
            # the set of points more than 42 mm from any seam, and it read as
            # a lid. Ramped over the panel's whole half-width it never
            # saturates, and the pocket sags at its bottom where a real one
            # carries its weight.
            sag = 1.0 + 0.34 * D._smooth(v, 0.35, 0.90)
            dg = min(dist_to_seg(x, z, sg) for sg in slash)
            gape = 0.0050 * (1.0 - D._smooth(dg, 0.0, 0.032))
            # THE STITCHED EDGES GO *INSIDE* THE BODY. Anything else leaves a
            # cliff: the panel has to clear the body's own 1.7 mm skin, and
            # carrying that clearance out to the boundary put a 3 mm step all
            # the way round -- which is why the close-up read as a card taped
            # to the chest rather than a pocket sewn to it. Tucked 2.4 mm under
            # the skin, the seam is a line and a shadow, which is what it is on
            # a real one. The two diagonals are NOT tucked: they are the hand
            # openings, and they are supposed to stand off and gape.
            CLEAR = CLOTH_T * 0.5 + 0.0011 + 0.0006
            tuck = D._smooth(d, 0.0, 0.013)
            lift = (-0.0024 + (CLEAR + 0.0024) * tuck
                    + (0.0062 * D._smooth(d, 0.0, 0.085) * sag + gape) * tuck)
            row.append(tuple(loc + nrm * lift))
        rows.append(row)
    pk = D.grid_mesh("pocket", rows)
    D.relax(pk, rounds=2, factor=0.26, keep_boundary=True)
    return pk


def cords(ob):
    """Two flat drawcords out of the hood's eyelets, lying ON the chest.

    Straight down from the neck at a fixed depth they end up INSIDE the
    garment: the chest is 79 mm deep and the neck only 64 mm, so a cord that
    clears the neckline is 15 mm inside the body by the time it reaches the
    sternum. Each point is dropped onto the front surface by a ray and held
    off it, so the cords follow the chest the way they hang on a real one.
    """
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromPolygons([v.co.copy() for v in ob.data.vertices],
                               [tuple(p.vertices) for p in ob.data.polygons])
    out = []
    for sign in (-1, 1):
        top = Vector((sign * 0.026, -0.076, -0.040))
        pts = []
        for i in range(19):
            t = i / 18.0
            p = Vector((top.x + sign * 0.013 * t * t,
                        top.y, top.z - 0.205 * t))
            hit, _n, _i, _d = bvh.ray_cast(Vector((p.x, -0.60, p.z)),
                                           Vector((0.0, 1.0, 0.0)), 1.2)
            if hit is not None:
                p.y = hit.y - 0.0062 - 0.0016 * math.sin(t * 5.0)
            pts.append(p)
        c = _sweep(f"cord{sign}", pts, 0.0038, 0.0019, sides=8)
        D.shade_smooth(c, 46.0)
        out.append(c)
        tipz = pts[-1]
        tip = _sweep(f"aglet{sign}",
                     [tipz + Vector((0, 0, 0.001)), tipz - Vector((0, 0, 0.013))],
                     0.0035, 0.0035, sides=10)
        out.append(tip)
    return out


# --------------------------------------------------------------------------


def fleece_material():
    """Brushed-back sweatshirt fleece.

    Flat albedo is why every one of these read as moulded plastic however good
    the shape was: cloth breaks light up at a scale the eye resolves from a
    metre away, and without that the folds have nothing to catch. The nap is a
    fine noise on the BUMP only -- put it on colour and it reads as dirt, put
    it on a big scale and it reads as an embossed pattern.
    """
    mat = bpy.data.materials.new("HoodieFleece")
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.0295, 0.0345, 0.0620, 1.0)
    b.inputs["Roughness"].default_value = 0.955
    if "Sheen Weight" in b.inputs:
        # SHEEN AT 0.30 WASHED THE NAVY OUT TO GREY. It is a retroreflective
        # term -- it lifts the whole surface at once, which is exactly what
        # kills the shading contrast the folds depend on. Cloth does have it;
        # it just has far less of it than the slider suggests.
        b.inputs["Sheen Weight"].default_value = 0.085
        b.inputs["Sheen Roughness"].default_value = 0.62
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.24

    nap = nt.nodes.new("ShaderNodeTexNoise")
    nap.inputs["Scale"].default_value = 340.0
    nap.inputs["Detail"].default_value = 7.0
    nap.inputs["Roughness"].default_value = 0.72
    weave = nt.nodes.new("ShaderNodeTexNoise")
    weave.inputs["Scale"].default_value = 46.0
    weave.inputs["Detail"].default_value = 3.0
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "FLOAT"
    mix.inputs["Factor"].default_value = 0.34
    nt.links.new(nap.outputs["Fac"], mix.inputs[2])
    nt.links.new(weave.outputs["Fac"], mix.inputs[3])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.055
    bump.inputs["Distance"].default_value = 0.0016
    nt.links.new(mix.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return mat


def audit(ob, label=""):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    nonman = [e for e in bm.edges if len(e.link_faces) not in (1, 2)]
    tiny = [f for f in bm.faces if f.calc_area() < 1e-9]
    short = [e for e in bm.edges if e.calc_length() < 1e-5]
    print(f"  AUDIT {label} verts {len(bm.verts)} faces {len(bm.faces)} "
          f"| non-manifold {len(nonman)} | zero-area {len(tiny)} "
          f"| zero-length {len(short)}")
    for e in nonman[:8]:
        m = (e.verts[0].co + e.verts[1].co) / 2
        print(f"    non-manifold at ({m.x * 1000:.0f}, {m.y * 1000:.0f}, "
              f"{m.z * 1000:.0f}) mm, {len(e.link_faces)} faces")
    bm.free()
    # A handful of non-manifold edges where the sleeve welds into the armhole
    # are a seam artefact, not a defect -- they render clean. A DOZEN means the
    # projection collapsed again, which does not.
    if len(tiny) or len(short) or len(nonman) > 4:
        raise SystemExit(f"BUILD FAILED: bad topology ({label})")


def build():
    args = H.argv_after_dashes()
    H.reset_scene()

    rows, nv_body = body_rows()
    wins = {}
    for sign, centre in ((+1, NU // 4), (-1, 3 * NU // 4)):
        wins[sign] = (centre - ARM_U, centre + ARM_U,
                      nv_body + ARM_V0, nv_body + ARM_V1)
    skip = set()
    for (u0, u1, v0, v1) in wins.values():
        for u in range(u0, u1):
            for v in range(v0, v1):
                skip.add((u % NU, v))

    body = D.grid_mesh("hoodie", rows, wrap_u=True,
                       skip=lambda u, v: (u, v) in skip)
    D.weld(body, 2e-4)
    D.strip_loose(body)
    D.jitter(body, 0.0016, seed=2.7)
    audit(body, "shell")

    # remember the openings by POSITION now, read them back after the solve
    from mathutils import kdtree
    kd = kdtree.KDTree(len(body.data.vertices))
    for i, v in enumerate(body.data.vertices):
        kd.insert(v.co, i)
    kd.balance()

    def at(p):
        return kd.find(Vector(p))[1]

    arm_idx = {s: [at(rows[v][u % NU])
                   for (u, v) in loop_indices(*wins[s], s)]
               for s in wins}
    neck_idx = [at(rows[-1][k]) for k in range(NU)]

    hard = set()
    for centre in (NU // 4, 3 * NU // 4):
        for u in range(centre - PIN_COLS, centre + PIN_COLS + 1):
            for v in range(nv_body + PIN_ROWS[0], nv_body + PIN_ROWS[1] + 1):
                hard.add(at(rows[v][u % NU]))

    def weight(co):
        """At 0.115 the body moved SIXTEEN MILLIMETRES -- the pin was doing all
        the work and the solver none, which is a lofted garment with extra
        steps. 0.042 leaves the silhouette alone and lets gravity have the
        folds."""
        return 0.0

    g = body.vertex_groups.new(name="pin")
    for i, v in enumerate(body.data.vertices):
        if i in hard:
            g.add([i], 1.0, 'REPLACE')
            continue
        if v.co.z < -0.600:
            continue
        t = min(1.0, max(0.0, (v.co.z + 0.600) / 0.170))
        g.add([i], 0.042 * t * t * (3 - 2 * t), 'REPLACE')
    print(f"  {len(hard)} verts hard on the hanger, the rest lightly held")

    hg = hanger()
    if "nosim" not in args:
        before = [Vector(v.co) for v in body.data.vertices]
        D.add_cloth(body, preset="fleece", pin="pin", quality=12,
                    self_dist=0.0030, coll_dist=0.0030, damping=2.2,
                    friction=0.8)
        print(f"  simulating {len(body.data.vertices)} verts ...")
        D.bake(frames=90)
        D.freeze(body)
        moved = D.travelled(body, before)
        print(f"  DRAPE max travel {moved * 1000:.0f} mm")
        if moved < 0.015:
            raise SystemExit("BUILD FAILED: the cloth did not move")
        if moved > 0.400:
            raise SystemExit(f"BUILD FAILED: solve diverged ({moved:.2f} m)")
        n = D.despike(body, tol=3.0)
        if n:
            print(f"  despiked {n}")
        D.relax(body, rounds=2, factor=0.32)

    # THE SLEEVES ARE PROJECTED ONTO THE SMOOTH BODY, THEN THE BODY IS FOLDED.
    # Done the other way the rays land on the flanks of the folds at grazing
    # angles, neighbouring vertices come out at wildly different radii, and the
    # left sleeve arrived with thirty non-manifold edges down its length.
    parts = [body]
    if "nosleeves" not in args:
        for sign in (+1, -1):
            sl = sleeve_from_loop(body, arm_idx[sign], sign, f"sleeve{sign}")
            nu = len(arm_idx[sign])
            keep = {i: Vector(sl.data.vertices[i].co)
                    for i in range(min(6 * nu, len(sl.data.vertices)))}
            mv, ms = D.push_out_radial(sl, body, offset=0.0072)
            print(f"    sleeve{sign}: {mv} verts pushed out of the body, "
                  f"{ms} rays missed")
            for i, co in keep.items():        # the head stays welded
                w = D._smooth(i // nu, 1.0, 6.0)
                sl.data.vertices[i].co = co.lerp(sl.data.vertices[i].co, w)
            parts.append(sl)

    # ... and the folds stop before the sleeves cover the cloth, so a 9 mm
    # ridge cannot push through a sleeve sitting 7 mm off the surface.
    big = D.drape_folds(body, amp=1.0, z_top=-0.150, z_bot=Z_HEM,
                  harmonics=[(9, 0.0155, 0.9), (5, 0.0098, -0.5),
                             (16, 0.0046, 1.6)],
                  seed=1.7, side_bias=0.38,
                  pred=lambda co: co.z < -0.150,
                  gate=lambda co: 1.0 - D._smooth(abs(co.x), 0.180, 0.240))
    print(f"  drape folds displace up to {big * 1000:.1f} mm")
    # The cloth GATHERS where it meets the ribbed band. At 72 columns the mesh
    # cannot resolve real 6 mm ribbing -- that belongs in the texture -- but it
    # resolves the 18 gathers above the band, and the gathers are what actually
    # say "this hem is elasticated" at arm's length.
    D.drape_folds(body, amp=1.0, z_top=-0.545, z_bot=Z_WAIST_TOP,
                  harmonics=[(18, 0.0040, 0.0), (9, 0.0018, 0.4)],
                  seed=0.6, side_bias=0.25,
                  pred=lambda co: -0.648 < co.z < -0.545,
                  gate=lambda co: 1.0 - D._smooth(abs(co.x), 0.180, 0.240))
    D.band_pull(body, Z_WAIST_TOP, Z_HEM, amount=0.015)
    D.seam_groove(body, Z_WAIST_TOP, depth=0.0026, width=0.0060)

    if "nohood" not in args:
        parts.append(hood_from_neck(body, neck_idx))

    if len(parts) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for p in parts:
            p.select_set(True)
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.join()
        D.weld(body, 2e-5)
        D.cleanup(body)
    audit(body, "assembled")
    return body, hg


def main():
    args = H.argv_after_dashes()
    body, hg = build()
    os.makedirs(OUT, exist_ok=True)

    pk = pocket(body)
    D.solidify(pk, 0.0018, offset=0.0)
    D.solidify(body, CLOTH_T, offset=0.0)
    body = D.apply_all(body)
    pk = D.apply_all(pk)
    D.shade_smooth(body, 50.0)
    D.shade_smooth(pk, 50.0)
    cd = cords(body)

    cloth = fleece_material()
    trim = HS.pbr("HangerTrim", (0.86, 0.86, 0.87), roughness=0.36)
    for o in (body, pk, *cd):
        o.data.materials.append(cloth)
    print(f"  cloth material: {cloth.name} base "
          f"{tuple(round(c, 3) for c in cloth.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value[:3])}")
    hg.data.materials.append(trim)

    subject = [body, pk, hg, *cd]
    for o in subject:
        a, b = H.bounds([o])
        print(f"    part {o.name}: {(b.x-a.x)*1000:.0f} x "
              f"{(b.y-a.y)*1000:.0f} x {(b.z-a.z)*1000:.0f} mm")
    print(f"hoodie-hung v4: TRIS {D.tri_count(subject)}")
    lo, hi = H.bounds(subject)
    print(f"  {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} x "
          f"{(hi.z - lo.z) * 1000:.0f} mm")

    H.set_engine("CYCLES" if "cycles" in args else "EEVEE", samples=96)
    centre, radius = H.subject_sphere(subject)
    lo, hi = H.bounds(subject)
    centre = (lo + hi) * 0.5
    # fit the SILHOUETTE, not the bounding sphere -- a garment is far taller
    # than it is deep, and sphere framing left it a third of the frame
    dist = H.fit_view(subject, centre, Vector((0, 1, 0)), 80.0,
                      res=(760, 1060), margin=1.10)
    # hero_lib's studio is built for hard-surface props and its fill erases
    # exactly the shading a fold is made of -- see stage.garment_lights
    ST.garment_lights(centre=centre, scale=radius)
    ST.world_value(0.030)
    H.backdrop(center=centre, scale=radius)
    for label, az, el in (("front", -90, 2), ("q34", -128, 8),
                          ("side", -180, 3), ("back", 90, 3),
                          ("hero", -118, 14)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre,
                       lens=80.0)
        H.render(cam, os.path.join(OUT, f"hoodie-hung-v4-{label}.png"),
                 res=(760, 1060))
    # A COMPARISON FRAME WITH NO FLOOR. The studio shadow survives an
    # auto-trim, so beside the reference photograph the garment was landing
    # 25% smaller than the panel it shared -- which reads as "the proportions
    # are wrong" when the measured proportions match to 4 mm.
    bd = bpy.data.objects.get("Backdrop")
    if bd is not None:
        bpy.data.objects.remove(bd, do_unlink=True)
    H.world_grey(0.055)
    tight = H.fit_view(subject, centre, Vector((0, 1, 0)), 80.0,
                       res=(820, 1120), margin=1.03)
    cam = H.camera("compare", H.orbit_position(centre, tight, -90, 1), centre,
                   lens=80.0)
    H.render(cam, os.path.join(OUT, "hoodie-hung-v4-compare.png"),
             res=(820, 1120))

    top = Vector((centre.x, centre.y, centre.z + radius * 0.44))
    cam = H.camera("upper", H.orbit_position(top, dist * 0.54, -104, 6), top,
                   lens=80.0)
    H.render(cam, os.path.join(OUT, "hoodie-hung-v4-upper.png"), res=(900, 900))
    # close enough to see whether the pocket is a sewn panel or two flaps
    for label, at, d, az, el in (
            ("detail-pocket", Vector((0.0, -0.06, -0.516)), 0.92, -92, 7),
            ("detail-hood", Vector((0.0, 0.02, 0.000)), 0.78, -110, 17),
            ("detail-cuff", Vector((0.25, -0.02, -0.600)), 0.44, -78, 4)):
        cam = H.camera(label, H.orbit_position(at, d, az, el), at, lens=58.0)
        H.render(cam, os.path.join(OUT, f"hoodie-hung-v4-{label}.png"),
                 res=(880, 720))

    # ORDER MATTERS TWICE HERE.
    #  - the rail has to be staged BEFORE the export, because
    #    `bake_gltf_axis` rotates the meshes into glTF's Y-up and the retail
    #    camera then finds five hoodies lying on their backs (it rendered the
    #    underside of the rail from inside the garments);
    #  - and the duplicates have to be GONE before the export, because
    #    `duplicate_along` shares mesh data and baking a transform into
    #    shared data would move all five copies.
    made = retail(subject, centre, radius)
    for ob in made:
        bpy.data.objects.remove(ob, do_unlink=True)
    if "noexport" not in args:
        GLB = os.path.join(REPO, "Assets", "models", "hero", "v4")
        os.makedirs(GLB, exist_ok=True)
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(GLB, "apparel_hoodie_hung.glb"))
    print("renders in", OUT)


def retail(subject, centre, radius):
    """The deciding image: on a rail, beside its neighbours, in shop light."""
    for n in ("Backdrop", "key", "fill", "rim", "under"):
        ob = bpy.data.objects.get(n)
        if ob is not None:
            bpy.data.objects.remove(ob, do_unlink=True)
    lo, hi = H.bounds(subject)
    hook = hi.z
    RAIL_Z = hook - 0.012
    made = list(ST.rail(RAIL_Z, x0=-1.30, x1=1.30))
    made.append(ST.shop_floor(lo.z - 0.62))
    made.append(ST.shop_wall(0.95, lo.z - 0.62))
    made += ST.duplicate_along(subject,
                               [(-0.84, 0.010, -0.004), (-0.42, -0.006, 0.002),
                                (0.42, 0.004, -0.003), (0.84, -0.010, 0.001)],
                               rot_jitter=0.075, scale_jitter=0.012)
    mid = Vector((0.0, 0.0, centre.z))
    ST.garment_lights(centre=(0.0, 0.0, mid.z + 0.35), scale=1.30, warm=True)
    ST.world_value(0.035)
    for label, az, el, d in (("retail", -90, 4, 3.45),
                             ("retail-q34", -124, 9, 3.15)):
        cam = H.camera(label, H.orbit_position(mid, d, az, el), mid, lens=64.0)
        H.render(cam, os.path.join(OUT, f"hoodie-hung-v4-{label}.png"),
                 res=(1360, 900))
    return made


if __name__ == "__main__":
    main()
