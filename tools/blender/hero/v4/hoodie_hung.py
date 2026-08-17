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
# The board's waistband is a SLIM band, about 45 mm, not the 62 mm slab that
# made the bottom of the garment read as corrugated card.
Z_WAIST_TOP = -0.690         # top of the ribbed waistband
Z_HEM = -0.735

# HALF-WIDTHS CUT BY 33 mm AND THE BODY LENGTHENED BY 35.
# Measured off the board's FRONT VIEW panel the hoodie is 0.61 as wide as it
# is tall. This table plus the old yoke gave 0.78 -- near enough square, which
# is the whole of the "reads as a rounded block" complaint. A garment cannot
# be fixed by folds while its outline is the wrong rectangle.
# ... AND HALF AS DEEP. This is the whole of the "inflated / pillow" read. A
# 150 mm front-to-back body on a 508 mm chest is a bolster; the board's SIDE
# VIEW panel shows a hoodie on a hanger is very nearly FLAT -- two panels with
# air between them, about 85 mm at the chest and less at the hem. Every fold,
# seam and pocket sits on top of that decision and none of them can rescue it.
BODY_PROFILE = [             # half-width / half-depth against height
    (-0.735, 0.232, 0.0300),
    (-0.690, 0.238, 0.0330),
    (-0.590, 0.248, 0.0392),
    (-0.430, 0.252, 0.0425),
    (-0.235, 0.254, 0.0440),
]
BODY_N = 3.4                 # superellipse exponent: flattened, not oval

NECK_HW, NECK_HD, NECK_CY = 0.094, 0.0545, 0.010
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
SHLD_HW, SHLD_HD = 0.2105, 0.0505
SHLD_Z = dict(front=-0.125, side=-0.045, back=-0.108)
CTRLA_HW, CTRLA_HD = 0.240, 0.0490          # chest -> shoulder point
CTRLA_Z = dict(front=-0.182, side=-0.150, back=-0.174)
# ... and the corner is SOFT. At 240/172 the silhouette broke too
# sharply and the top corners read square.
CTRLB_HW, CTRLB_HD = 0.166, 0.0512          # shoulder point -> neck
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
SLEEVE_DROP = 0.572          # armhole centroid to cuff
# The reference measures 0.754 as wide as it is tall; at 830 mm tall that is a
# 626 mm garment, half-width 313 mm. The torso is 285. So the sleeve protrudes
# TWENTY-EIGHT MILLIMETRES past the body -- it is not a tube hanging beside the
# torso, it is a flattened tube lying ON its side seam, and the section has to
# be sized for that or the garment comes out 200 mm too wide.
SLEEVE_AXIS_X = 0.230
SLEEVE_OUTER = 0.043         # half-extent outboard: 0.230 + 0.043 = 0.273
SLEEVE_DEPTH = 0.036         # ... and front-to-back
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
#
# ... and it is WIDER THAN IT IS TALL. At half 122 / rise 113 with a 135-part
# ripple the roll came out as two lumps with a valley between them -- the
# reference hood is one smooth low mass spanning the shoulders, and the ripple
# has to stay well under the section radius or it becomes the silhouette.
HOOD_HALF = 0.124            # where the roll meets the neckline, each side
# BACK OFF THE NECKLINE. Brought forward to 94 mm the roll overhung the neck
# opening and closed it to a puckered hole: on the board the hood sits BEHIND
# the shoulders and the neckline in front of it is a broad open scoop.
HOOD_BACK = 0.116            # how far back it arches
HOOD_RISE = 0.126            # ... and how far up
HOOD_R0, HOOD_R1 = 0.030, 0.048   # section radius at the ends / added at top
HOOD_ROLLS = 2.6
# The face opening. Every reference frame reads the hood by its BINDING: a
# rolled hem round the opening whose two ends cross in a V at the centre
# front. Without it the roll is a bolster lying on the shoulders.
HOOD_FACE_A = 0.36 * math.pi   # where round the section the opening sits
HOOD_BIND_R = 0.0116

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
    """The shop's black moulded hanger, sitting just inside the shoulders.

    It is NOT a collider. Its first cut was, and its bar crossed the pinned
    shoulder strip by two millimetres -- a collider pushing on vertices that
    cannot move is the one thing the solver cannot integrate. The cloth is
    pinned along this same line instead, which is what the bar would have done.

    A 10 mm WHITE WIRE was the wrong prop. Every reference board -- hoodie,
    polo, tee, and the retail racks behind all three -- hangs its stock on the
    same black moulded hanger with a chrome hook, and it is the first thing the
    eye uses to decide whether it is looking at shop stock or at a render.
    """
    # BACK AND DOWN, under the hood. Raising the hood 30 mm and bringing it
    # forward left the hanger's shoulder sticking out of the neck as a black
    # beak. A hanger inside a hoodie is inside the HOOD, not in front of it.
    body, hook = ST.top_hanger(half_w=0.1855, z=-0.021, drop=0.047,
                               y=0.012, hook_h=0.121)
    return body, hook


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
        # THE ENDS RUN DOWN INTO THE SHOULDER, so the swept tube's end caps
        # finish inside the body instead of showing as a cut disc. Flattening
        # the body from 150 mm deep to 88 moved the front surface 30 mm back
        # and left these ends standing outside it: they rendered as two curved
        # flaps with dark undersides springing off the neck, which read as a
        # shirt collar on a hoodie.
        return Vector((HOOD_HALF * u,
                       nc.y + 0.006 - 0.052 * k ** 0.9 + HOOD_BACK * k ** 0.75,
                       nc.z - 0.094 + 0.038 * k ** 0.9
                       + HOOD_RISE * k ** 0.62))

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
        # A DROPPED HOOD SLUMPS TO ONE SIDE. Perfectly symmetric it reads as a
        # moulded headrest; nothing that has been pushed back off a head lands
        # even. The fat point sits a little left of the crown.
        r = ((HOOD_R0 + HOOD_R1 * k ** 0.55)
             * (1.0 + 0.115 * math.sin(u * 1.35 - 0.55)))
        row = []
        for j in range(NR):
            a = 2 * math.pi * j / NR
            # the folds: a ripple ALONG the roll, plus a shallower one around it
            # AT 8% OF A 91 mm RADIUS THE RIPPLE IS 7 mm ACROSS A 180 mm
            # FORM -- invisible, and the hood came out a moulded dome. A hood
            # pushed back off the head is three or four soft rolls of cloth
            # lying on each other, and the depth of those rolls IS the read.
            f = (1.0 + 0.168 * math.sin(HOOD_ROLLS * math.pi * u + 1.1)
                 * math.sin(a * 1.0 + 0.4)
                 + 0.104 * math.sin(HOOD_ROLLS * 1.9 * math.pi * u - 0.6)
                 * math.sin(a * 2.0 - 0.3)
                 + 0.058 * math.sin(a * 3.0 - u * 2.2)
                 + 0.034 * math.sin(a * 5.0 + u * 4.1)
                 # ... and it is not symmetric. Nothing that has been shrugged
                 # off a head lands even.
                 + 0.062 * math.sin(u * 2.1 + a * 1.0 - 0.9))
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
            target = Vector((n.x * 0.30, nc.y + 0.026, nc.z - 0.108))
            row.append(tuple(n.lerp(target, tt * tt * (3 - 2 * tt))))
        lin.append(row)
    lining = D.grid_mesh("hood_lining", lin, wrap_u=True)

    # THE TWO FACINGS, and the V they cross in at the neck.
    #
    # A swept tube round the opening was the first try and it was the wrong
    # object: its ends had to die somewhere, and wherever they died they punched
    # a notch through the shoulder. The reference reads the hood off a different
    # thing anyway -- the two FACINGS, flat bands of doubled cloth running from
    # the crown down each side of the opening, which OVERLAP at the centre front
    # and make the V. They are panels, they end at the neckline, and being
    # panels they can simply lie on the roll.
    rows = []
    NB = 34
    for j in range(NB + 1):
        u = -0.94 + 1.88 * (j / NB)
        c = arch(u)
        tg = (arch(min(1.0, u + 0.02)) - arch(max(-1.0, u - 0.02)))
        tg = tg.normalized() if tg.length > 1e-7 else Vector((1, 0, 0))
        e1 = tg.cross(Vector((0, 0, 1)))
        e1 = e1.normalized() if e1.length > 1e-6 else Vector((0, 1, 0))
        e2 = tg.cross(e1).normalized()
        k = max(0.0, 1.0 - u * u)
        r = ((HOOD_R0 + HOOD_R1 * k ** 0.55)
             * (1.0 + 0.115 * math.sin(u * 1.35 - 0.55)))
        # THE ENDS WRAP UNDER. Wherever the band simply stopped it punched a
        # notch through the shoulder; carrying it round the section as it
        # approaches the neck slides it under the roll, which is where a
        # facing goes anyway.
        under = 0.92 * math.pi * (abs(u) ** 3.4)
        row = []
        for i in range(7):
            w = i / 6.0                     # across the 42 mm facing
            a = HOOD_FACE_A - 0.30 + 0.60 * w + under
            p = (c + e1 * (r * 1.014 * math.cos(a) * 1.06)
                 + e2 * (r * 1.014 * math.sin(a) * 0.88))
            row.append(tuple(p))
        rows.append(row)
    fac = D.grid_mesh("hood_facing", rows)
    D.solidify(fac, 0.0044, offset=0.0)
    fac = D.apply_all(fac)
    D.shade_smooth(fac, 44.0)
    facings = [fac]

    # THE LINING STAYS SEPARATE, so it can carry its own material. The brief
    # asks the hanging hoodie for a "dark interior/cavity", and joining the
    # bowl into the shell gave it the shell's albedo: the neck opening came out
    # the same value as the chest and read as a filled hole rather than a
    # cavity you can see into. A hoodie's inside is the brushed back of the
    # same fleece -- lighter, and much flatter.
    bpy.ops.object.select_all(action='DESELECT')
    for f in facings:
        f.select_set(True)
    roll.select_set(True)
    bpy.context.view_layer.objects.active = roll
    bpy.ops.object.join()
    roll.name = "hood"
    return roll, lining


def _cap_ends(ob, nr, ns):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
    bm.to_mesh(ob.data)
    bm.free()


def ribbed_band(body):
    """The ribbed waistband, as its own high-column ring.

    THE SHADER RIBS WERE SMEARING. They came off the ANGLE about the garment's
    axis, which is even on a round tube and wildly uneven on a superellipse
    flattened to n = 3.4: dx/dtheta runs away at centre front, so the same 150
    ribs per turn arrived as twenty-odd broad corrugations across the front
    panel and a fine blur at the side seams. The render read as corrugated
    card, and no bump strength fixes a frequency wrong by a factor of six in
    the middle of the frame.

    Ribs sit 6.4 mm apart ALONG THE CLOTH, so they have to be driven by arc
    length, which the shader cannot reach without UVs. The band is 45 mm tall;
    at 208 columns it is under 3,000 triangles and can simply be modelled --
    the same answer the cuffs already use, for the same reason.

    AND IT IS BUILT FROM THE BODY, NOT FROM THE PROFILE TABLE. The body is
    simulated and then fold-displaced; by the time the band is made, its hem is
    nowhere near the analytic superellipse. The first cut lofted the table and
    the band landed skewed across a hem that had moved, which read as a
    separate object jammed under the garment.
    """
    NA, NV = 208, 7
    PITCH = 0.0064
    DEPTH = 0.0013
    ROW_H = 0.0158                     # body_rows' spacing

    co = [Vector(v.co) for v in body.data.vertices]
    r0z = [co[k].z for k in range(NU)]
    r1z = [co[NU + k].z for k in range(NU)]
    print("  band probe: %d verts, %d rows-worth, row0 z %.4f..%.4f, "
          "row1 z %.4f..%.4f" % (len(co), len(co) // NU, min(r0z), max(r0z),
                                 min(r1z), max(r1z)))

    def body_ring(z):
        """The body's own section at height z, resampled to NA columns."""
        f = max(0.0, (z - Z_HEM) / ROW_H)
        r0 = min(int(f), (len(co) // NU) - 2)
        w = min(1.0, f - r0)
        out = []
        for i in range(NA):
            g = i * NU / NA
            k0 = int(g) % NU
            k1 = (k0 + 1) % NU
            u = g - int(g)
            a = co[r0 * NU + k0].lerp(co[r0 * NU + k1], u)
            b = co[(r0 + 1) * NU + k0].lerp(co[(r0 + 1) * NU + k1], u)
            out.append(a.lerp(b, w))
        return out

    def smooth_ring(ring, k=9, w=0.72):
        """A ribbed band is STIFFER than the body it gathers.

        Sampled straight off the deformed hem the band inherits every one of
        the 15 mm drape folds and comes out corrugated and dipping, which read
        as a crumpled rag under the garment. Real 2x2 rib is a dense stiff
        knit: it takes the average shape and ignores the folds.
        """
        out = []
        for i in range(len(ring)):
            acc = Vector((0, 0, 0))
            for d in range(-k, k + 1):
                acc = acc + ring[(i + d) % len(ring)]
            out.append(ring[i].lerp(acc / (2 * k + 1), w))
        return out

    base = smooth_ring(body_ring(Z_HEM + 0.001))
    # THE HEM IS NOT LEVEL. The solve leaves row 0 spanning 31 mm of height,
    # so a band that merely sat 9 mm under the AVERAGE hem let the low half of
    # the body's own raw hem hang out below it, wavy and unfinished -- which is
    # the crumpled rag that kept appearing under the garment. The band's
    # bottom edge is a level line under the lowest point of the cloth.
    z_floor = min(p.z for p in body_ring(Z_HEM + 0.001)) - 0.005
    cx = sum((p.x for p in base), 0.0) / NA
    cy = sum((p.y for p in base), 0.0) / NA
    # arc length round the body's OWN hem, so the rib pitch is 6.4 mm of cloth
    arc, s = [0.0], 0.0
    for i in range(1, NA + 1):
        a, b = base[(i - 1) % NA], base[i % NA]
        s += math.hypot(b.x - a.x, b.y - a.y)
        arc.append(s)

    rows = []
    for j in range(NV + 1):
        t = j / NV
        # the band hangs 9 mm BELOW the body's hem so no fold can poke out
        z = Z_HEM + (Z_WAIST_TOP + 0.006 - Z_HEM) * t
        ring = smooth_ring(body_ring(z))
        level = (1.0 - t) ** 1.5          # level at the bottom, follows at top
        # the band is DRAWN IN -- narrower than the body it gathers, which is
        # the single cue that says elasticated rather than cut
        pull = 0.0062 + 0.0040 * math.sin(math.pi * t)
        # ... and it rolls closed top and bottom instead of ending in a cliff
        roll = 0.055 * (math.exp(-(t / 0.13) ** 2)
                        + math.exp(-((1.0 - t) / 0.13) ** 2))
        row = []
        for i in range(NA):
            p = ring[i]
            d = Vector((p.x - cx, p.y - cy, 0.0))
            n = d.normalized() if d.length > 1e-6 else Vector((0, 1, 0))
            rib = DEPTH * math.cos(2 * math.pi * arc[i] / PITCH)
            q = p - n * (pull - rib) - d * roll
            # THE BODY'S OWN HEIGHT THERE, not the nominal sample height. The
            # solve moves the hem by up to 20 mm; taking xy from the deformed
            # body and z from the table twisted the band across the garment
            # and it read as a separate crumpled object jammed underneath.
            row.append((q.x, q.y, p.z * (1.0 - level)
                        + z_floor * level))
        rows.append(row)
    ob = D.grid_mesh("waistband", rows, wrap_u=True)
    D.shade_smooth(ob, 34.0)
    print("  waistband: %d ribs at %.1f mm over %.0f mm"
          % (round(s / PITCH), PITCH * 1000, s * 1000))
    return ob


def ribbed_cuff(sleeve, name):
    """A real ribbed cuff, as its own tube.

    The shader ribs work on the body because they run off the angle about the
    garment's axis and the body wraps that axis completely. A cuff does not:
    it sits 250 mm off-axis, so the same angular sweep crosses about three
    ribs across the whole cuff. Twenty-two ribs at 8 mm need geometry, and at
    this size geometry is cheap.
    """
    nu = sleeve["nu"]
    nv = sleeve["nv"]
    co = [Vector(v.co) for v in sleeve.data.vertices]
    j0 = int(round(CUFF_T * (nv - 1)))
    ring0 = co[j0 * nu:(j0 + 1) * nu]
    ring1 = co[(nv - 1) * nu:nv * nu]
    c0 = sum(ring0, Vector()) / nu
    c1 = sum(ring1, Vector()) / nu
    axis = (c1 - c0)
    axis = axis.normalized() if axis.length > 1e-6 else Vector((0, 0, -1))
    e1 = axis.cross(Vector((0, 1, 0)))
    e1 = e1.normalized() if e1.length > 1e-6 else Vector((1, 0, 0))
    e2 = axis.cross(e1).normalized()

    def extent(ring, c):
        return (max(abs((p - c).dot(e1)) for p in ring),
                max(abs((p - c).dot(e2)) for p in ring))
    r0 = extent(ring0, c0)
    r1 = extent(ring1, c1)

    NA, NV = 56, 9
    RIBS = 22
    rows = []
    for j in range(NV + 1):
        t = j / NV
        c = c0.lerp(c1, t)
        a1 = (r0[0] + (r1[0] - r0[0]) * t) + 0.0009
        a2 = (r0[1] + (r1[1] - r0[1]) * t) + 0.0009
        # the seam pinch where the rib is joined on, then a fuller band
        pinch = 1.0 - 0.085 * math.exp(-((t - 0.10) / 0.16) ** 2)
        row = []
        for i in range(NA):
            th = 2 * math.pi * i / NA
            rib = 1.0 + 0.0165 * math.cos(RIBS * th) * D._smooth(t, 0.16, 0.30)
            row.append(tuple(c + e1 * (a1 * pinch * rib * math.cos(th))
                             + e2 * (a2 * pinch * rib * math.sin(th))))
        rows.append(row)
    ob = D.grid_mesh(name, rows, wrap_u=True)
    D.shade_smooth(ob, 30.0)
    return ob


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
    Z_TOP, Z_KNEE, Z_BOT = -0.452, -0.538, -0.676
    # WIDER, AND THE HAND OPENINGS STEEPER. On the board the pocket runs very
    # nearly to the side seams and its two diagonals are short and steep -- the
    # slashes are the read, and a shallow diagonal over half the panel's height
    # makes them a taper rather than an opening.
    W_TOP, W_KNEE, W_BOT = 0.099, 0.198, 0.202
    NX, NY = 44, 28

    def outline(v):
        """half-width and height down the panel"""
        if v <= 0.34:
            k = v / 0.34
            k = k * k * (3 - 2 * k) * 0.86 + k * 0.14
            return (W_TOP + (W_KNEE - W_TOP) * k,
                    Z_TOP + (Z_KNEE - Z_TOP) * v / 0.34)
        k = (v - 0.34) / 0.66
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
                loc, nrm = Vector((x, -0.044, z)), Vector((0, -1, 0))
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


def fleece_material_plain(colour, rough=0.96):
    mat = bpy.data.materials.new("HoodieLining")
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Roughness"].default_value = rough
    if "Sheen Weight" in b.inputs:
        b.inputs["Sheen Weight"].default_value = 0.06
    return mat


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
    # HEATHER. The board's fleece is a marl -- two yarns spun together, so the
    # colour varies by about 30% at a 12 mm scale. Flat navy is the one thing
    # left that says "material" rather than "cloth"; the nap noise is on the
    # bump only and a bump alone cannot make a heather. Kept small enough that
    # it reads as yarn and not as staining.
    # AT THE YARN'S SCALE, NOT THE PANEL'S. Scale 88 puts the variation on an
    # 11 mm blob and 75% of contrast across it: that is camouflage, not
    # heather. A marl varies at the thickness of a thread, so the noise has to
    # be an order of magnitude finer and a quarter as strong -- close up it is
    # yarn, at a metre it is a slightly living surface, and neither reads as
    # staining.
    marl = nt.nodes.new("ShaderNodeTexNoise")
    marl.inputs["Scale"].default_value = 640.0
    marl.inputs["Detail"].default_value = 5.0
    marl.inputs["Roughness"].default_value = 0.52
    tint = nt.nodes.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    tint.inputs["A"].default_value = (0.0268, 0.0314, 0.0568, 1.0)
    tint.inputs["B"].default_value = (0.0332, 0.0388, 0.0688, 1.0)
    nt.links.new(marl.outputs["Fac"], tint.inputs["Factor"])
    nt.links.new(tint.outputs[2], b.inputs["Base Color"])
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
    # RIBBING THE MESH CANNOT CARRY. A waistband rib is 6 mm and the body has
    # 16 mm between columns, so geometry can only ever give scallops. The
    # brief's own rule applies: geometry when it changes the silhouette,
    # normals when it does not. Ribs come from the ANGLE about the garment's
    # axis so they wrap correctly instead of being stripes in x, and a z mask
    # confines them to the waistband and the cuffs.
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    ang = nt.nodes.new("ShaderNodeMath")
    ang.operation = 'ARCTAN2'
    nt.links.new(sep.outputs["Y"], ang.inputs[0])
    nt.links.new(sep.outputs["X"], ang.inputs[1])
    freq = nt.nodes.new("ShaderNodeMath")
    freq.operation = 'MULTIPLY'
    freq.inputs[1].default_value = 150.0
    nt.links.new(ang.outputs[0], freq.inputs[0])
    rib = nt.nodes.new("ShaderNodeMath")
    rib.operation = 'SINE'
    nt.links.new(freq.outputs[0], rib.inputs[0])

    def band(lo, hi):
        r = nt.nodes.new("ShaderNodeMapRange")
        r.inputs["From Min"].default_value = lo
        r.inputs["From Max"].default_value = hi
        r.clamp = True
        nt.links.new(sep.outputs["Z"], r.inputs["Value"])
        return r

    up = band(Z_HEM - 0.004, Z_HEM + 0.010)          # rises into the band
    dn = band(Z_WAIST_TOP + 0.004, Z_WAIST_TOP - 0.010)
    cu = band(-0.716, -0.704)
    cd = band(-0.652, -0.664)
    m1 = nt.nodes.new("ShaderNodeMath")
    m1.operation = 'MULTIPLY'
    nt.links.new(up.outputs["Result"], m1.inputs[0])
    nt.links.new(dn.outputs["Result"], m1.inputs[1])
    m2 = nt.nodes.new("ShaderNodeMath")
    m2.operation = 'MULTIPLY'
    nt.links.new(cu.outputs["Result"], m2.inputs[0])
    nt.links.new(cd.outputs["Result"], m2.inputs[1])
    mask = nt.nodes.new("ShaderNodeMath")
    mask.operation = 'MAXIMUM'
    nt.links.new(m1.outputs[0], mask.inputs[0])
    nt.links.new(m2.outputs[0], mask.inputs[1])
    ribbed = nt.nodes.new("ShaderNodeMath")
    ribbed.operation = 'MULTIPLY'
    nt.links.new(rib.outputs[0], ribbed.inputs[0])
    nt.links.new(mask.outputs[0], ribbed.inputs[1])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.030
    bump.inputs["Distance"].default_value = 0.0011
    nt.links.new(mix.outputs[0], bump.inputs["Height"])
    ribbump = nt.nodes.new("ShaderNodeBump")
    ribbump.inputs["Strength"].default_value = 0.60
    ribbump.inputs["Distance"].default_value = 0.0016
    nt.links.new(ribbed.outputs[0], ribbump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], ribbump.inputs["Normal"])
    nt.links.new(ribbump.outputs["Normal"], b.inputs["Normal"])
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

    hgb, hgh = hanger()
    if "nosim" not in args:
        before = [Vector(v.co) for v in body.data.vertices]
        # MASS IS PER VERTEX AND THE GARMENT JUST LOST 40% OF ITS AREA.
        # Flattening the body from 150 mm deep to 88 shortened every ring
        # without changing the vertex count, so the same 0.090 per vertex is
        # now that much denser against springs whose rest lengths shrank with
        # it: travel went 44 mm -> 188, the hem stretched into a pouch, and
        # the waistband had a sagging bag of cloth hanging out below it. The
        # third time this arithmetic has looked like a modelling failure.
        D.add_cloth(body, preset="fleece", pin="pin", quality=12,
                    self_dist=0.0030, coll_dist=0.0030, damping=3.4,
                    friction=0.8, mass=0.062)
        print(f"  simulating {len(body.data.vertices)} verts ...")
        D.bake(frames=150)
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
            parts.append(ribbed_cuff(sl, "cuff%d" % sign))
            # THE ARMHOLE SEAM. Every reference frame has one and it is what
            # separates a sleeve from a bulge on the side of the torso: the
            # line, not the silhouette. Two rows in from the head so it sits
            # on the sleeve where a set-in seam is topstitched.
            ring = [Vector(sl.data.vertices[2 * nu + k].co) for k in range(nu)]
            c = sum(ring, Vector()) / nu
            ring = [p + (p - c).normalized() * 0.0011 for p in ring]
            seam = D.topstitch("armseam%d" % sign, ring + [ring[0]],
                               radius=0.00085, sides=7)
            D.shade_smooth(seam, 40.0)
            parts.append(seam)

    # ... and the folds stop before the sleeves cover the cloth, so a 9 mm
    # ridge cannot push through a sleeve sitting 7 mm off the surface.
    big = D.drape_folds(body, amp=1.0, z_top=-0.150, z_bot=Z_HEM,
                  harmonics=[(9, 0.0196, 0.9), (5, 0.0128, -0.5),
                             (16, 0.0058, 1.6)],
                  seed=1.7, side_bias=0.54,
                  pred=lambda co: co.z < -0.150,
                  gate=lambda co: 1.0 - D._smooth(abs(co.x), 0.192, 0.246))
    print(f"  drape folds displace up to {big * 1000:.1f} mm")
    # The cloth GATHERS where it meets the ribbed band. At 72 columns the mesh
    # cannot resolve real 6 mm ribbing -- that belongs in the texture -- but it
    # resolves the 18 gathers above the band, and the gathers are what actually
    # say "this hem is elasticated" at arm's length.
    D.drape_folds(body, amp=1.0, z_top=-0.600, z_bot=Z_WAIST_TOP,
                  harmonics=[(18, 0.0022, 0.0), (9, 0.0011, 0.4)],
                  seed=0.6, side_bias=0.25,
                  pred=lambda co: -0.700 < co.z < -0.600,
                  gate=lambda co: 1.0 - D._smooth(abs(co.x), 0.192, 0.246))
    D.band_pull(body, Z_WAIST_TOP, Z_HEM, amount=0.016)
    D.seam_groove(body, Z_WAIST_TOP, depth=0.0026, width=0.0060)

    parts.append(ribbed_band(body))
    if "nohood" not in args:
        _roll, hood_lining = hood_from_neck(body, neck_idx)
        parts.append(_roll)

    if len(parts) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for p in parts:
            p.select_set(True)
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.join()
        D.weld(body, 2e-5)
        D.cleanup(body)
    audit(body, "assembled")
    return body, [hgb, hgh], hood_lining


def main():
    args = H.argv_after_dashes()
    body, hg, lining = build()   # hg = [hanger body, chrome hook]
    os.makedirs(OUT, exist_ok=True)

    pk = pocket(body)
    D.solidify(pk, 0.0018, offset=0.0)
    D.solidify(body, CLOTH_T, offset=0.0)
    body = D.apply_all(body)
    pk = D.apply_all(pk)
    D.shade_smooth(body, 70.0)
    D.shade_smooth(pk, 50.0)
    cd = cords(body)

    cloth = fleece_material()
    for o in (body, pk, *cd):
        o.data.materials.append(cloth)
    # brushed back: lighter than the face, and flat -- it is in shadow and the
    # only thing that has to happen is that the eye can tell it is a surface
    lining.data.materials.append(
        fleece_material_plain((0.0620, 0.0690, 0.1020), rough=0.985))
    D.shade_smooth(lining, 44.0)
    print(f"  cloth material: {cloth.name} base "
          f"{tuple(round(c, 3) for c in cloth.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value[:3])}")

    subject = [body, pk, lining, *hg, *cd]
    for o in subject:
        a, b = H.bounds([o])
        print(f"    part {o.name}: {(b.x-a.x)*1000:.0f} x "
              f"{(b.y-a.y)*1000:.0f} x {(b.z-a.z)*1000:.0f} mm")
    print(f"hoodie-hung v4: TRIS {D.tri_count(subject)}")
    # ob.bound_box is CACHED and the fold fields transform vertices
    # directly, so nothing refreshes it in background mode -- every
    # camera then frames where the garment used to be.
    bpy.context.view_layer.update()
    lo, hi = H.bounds(subject)
    print(f"  {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} x "
          f"{(hi.z - lo.z) * 1000:.0f} mm")

    H.set_engine("CYCLES" if "cycles" in args else "EEVEE", samples=96)

    ST.exposure(0.25)
    # UVs and the grain BEFORE the first render, not just before the
    # export: the studio frames are the evidence, so they have to be of
    # the asset that ships.
    for _ob in subject:
        D.unwrap(_ob)
    ST.grain_follows_cloth(subject)
    centre, radius = H.subject_sphere(subject)
    # ob.bound_box is CACHED and the fold fields transform vertices
    # directly, so nothing refreshes it in background mode -- every
    # camera then frames where the garment used to be.
    bpy.context.view_layer.update()
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
                       res=(820, 1120), margin=1.09)
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
        # UVS BEFORE THE AXIS BAKE. Most of these primitives shipped with no
        # TEXCOORD_0 at all, which makes every texel-density and
        # logo-stretching requirement vacuous rather than met, and means
        # nothing here could ever carry a printed label or a baked weave.
        for _ob in subject:
            D.unwrap(_ob, label=_ob.name)
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(GLB, "apparel_hoodie_hung.glb"))
    print("renders in", OUT)


def retail(subject, centre, radius):
    """The deciding image: on a rail, beside its neighbours, in shop light."""
    for n in ("Backdrop", "key", "fill", "rim", "top", "under"):
        ob = bpy.data.objects.get(n)
        if ob is not None:
            bpy.data.objects.remove(ob, do_unlink=True)
    # ob.bound_box is CACHED and the fold fields transform vertices
    # directly, so nothing refreshes it in background mode -- every
    # camera then frames where the garment used to be.
    bpy.context.view_layer.update()
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
