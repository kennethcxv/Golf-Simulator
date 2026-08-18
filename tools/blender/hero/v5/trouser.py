"""The trouser block: a front and a back leg panel per leg, drafted flat.

Four pattern pieces, and the seams are the ones a real pair has -- an outseam and
an inseam down each leg, a centre-front rise and a centre-back rise joining the
two legs. That is what makes the crotch a crotch instead of a dent in a tube,
which is what v4's was.

THE PRESSED CREASE is geometry here, not a shader groove. A pressed leg has a
ridge running down the front and another down the back, and a ridge is two flat
facets meeting at a line -- exactly the shape the brief asks a fold to be. It is
a piecewise tent added to the panel's depth, sharpest at the hem and easing out
above the hip, which is where a presser stops.

Measurements are a 32 waist, flat, metres, z = 0 at the waist:

    waist half   0.205     hip half 0.236 at 180 down    crotch 0.278 down
    knee half    0.098 at 560 down  hem half 0.086       length 1.062
"""

import math

from mathutils import Vector

import pattern as PT


def _len(pts):
    return sum((Vector(pts[i + 1]) - Vector(pts[i])).length
               for i in range(len(pts) - 1))


def _round(pts, w=0.25, per=6):
    """Corner-cut a landmark polyline so the outline is a curve, not a kink.

    The first draft's outseam kinked at the hip and the trousers came out with
    two points sticking out at the pockets. One pass of Chaikin per corner with
    a few subdivisions is enough -- this is a pattern curve, not a spline.
    """
    if len(pts) < 3:
        return list(pts)
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = (Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[i + 1]))
        p0 = b.lerp(a, w)
        p1 = b.lerp(c, w)
        for k in range(per + 1):
            t = k / per
            q = p0.lerp(b, t).lerp(b.lerp(p1, t), t)
            out.append((q.x, q.y))
    out.append(pts[-1])
    return out


class Trouser(object):
    """A LANDMARK TABLE, because the first draft mixed up two different
    half-widths and produced a pair with 460 mm hips and bell-bottom legs.

    `rungs` is (z, inner x, outer x) for one leg, waist first. Both numbers are
    absolute distances from the garment's centre line, which is the only
    convention a pattern uses -- "the leg is 98 wide at the knee" has to be
    resolved against the leg's own centre, and resolving it against the
    garment's doubled the hip and pinched the knee at the same time.
    """

    def __init__(self, rungs=None, crease=0.0042):
        # THE CROTCH POINT SITS ON THE CENTRE LINE. The first table put it
        # 30 mm out on each leg and then welded the two rises together, which
        # dragged both crotch points 30 mm inward and puckered the whole seat.
        # In a pattern the rise IS the centre line; the crotch curve is the
        # inseam turning in to meet it.
        self.rungs = rungs or [
            (0.000, 0.000, 0.198),      # waist
            (-0.176, 0.000, 0.238),     # hip, the widest point
            (-0.272, 0.004, 0.232),     # crotch
            (-0.420, 0.040, 0.216),     # thigh
            (-0.548, 0.038, 0.200),     # knee
            (-0.800, 0.032, 0.192),     # calf
            (-1.046, 0.028, 0.190),     # hem
        ]
        self.crease = crease

    @property
    def z_hem(self):
        return self.rungs[-1][0]

    @property
    def z_crotch(self):
        return self.rungs[2][0]

    @property
    def hip_z(self):
        return -self.rungs[1][0]

    @property
    def length(self):
        return -self.rungs[-1][0]

    @property
    def waist(self):
        return self.rungs[0][2]

    def centre(self, sx):
        z, i, o = self.rungs[-1]
        return sx * (i + o) * 0.5

    def _rise(self, sx):
        """The centre-front rise, crotch up to the waist. One smooth curve, so
        the outline has no corner at the crotch."""
        zc, ic, _oc = self.rungs[2]
        return [(sx * ic, zc)] + PT.arc((sx * ic, zc), (sx * 0.0, 0.0),
                                        -sx * 0.010, n=12, axis=0)[1:]

    def leg(self, sx):
        """Four sides of one leg's pattern piece, outer edge at u = 1."""
        top = PT.curve([(sx * self.rungs[0][1], 0.0),
                        (sx * self.rungs[0][2], 0.0)])
        # outseam, hem up to the waist, with the hip rounded rather than kinked
        out = [(sx * o, z) for (z, _i, o) in reversed(self.rungs)]
        right = PT.curve(_round(out, 0.28))
        # inseam from the hem to the crotch, then the rise to the waist
        inner = [(sx * i, z) for (z, i, _o) in reversed(self.rungs[2:])]
        left = PT.curve(_round(inner, 0.22) + self._rise(sx)[1:])
        bottom = PT.curve([(sx * self.rungs[-1][1], self.z_hem),
                           (sx * self.rungs[-1][2], self.z_hem)])
        return dict(top=top, bottom=bottom, left=left, right=right)

    def crotch_t(self, sx):
        inner = _round([(sx * i, z) for (z, i, _o) in reversed(self.rungs[2:])],
                       0.22)
        run = _len(inner)
        return run / (run + _len(self._rise(sx)))

    def depth_field(self, sx, hd, roll=0.26):
        """y for a point on this leg's panel: full depth in the middle, closing
        to zero at the inseam and outseam, plus the pressed crease ridge."""
        cen = self.centre(sx)

        def f(u, v, sign):
            # close to the seams at u = 0 and u = 1
            e = min(u, 1.0 - u) / roll
            w = min(1.0, max(0.0, e))
            w = w * w * (3.0 - 2.0 * w)
            # THE CREASE: a tent, not a bump. Two flat facets meeting at a line,
            # sharpest at the hem, easing out over the hip where a presser stops.
            t = 1.0 - abs(u - 0.5) / 0.5
            tent = max(0.0, (t - 0.68) / 0.32)
            fade = min(1.0, max(0.0, (1.0 - v) / 0.72))
            return sign * (hd * w + self.crease * tent * fade)
        return f


def build(draft, tr, depth, nu=30, nv=76, roll_rows=3, name="trousers"):
    """Draft four pattern pieces and sew the four seams a pair of trousers has."""
    hd = depth * 0.5
    panels = {}
    for sx, tag in ((-1, "l"), (1, "r")):
        s = tr.leg(sx)
        for sign, side in ((-1.0, "f"), (1.0, "b")):
            fld = tr.depth_field(sx, hd)
            panels[tag + side] = draft.panel(
                top=s["top"], bottom=s["bottom"], left=s["left"],
                right=s["right"], nu=nu, nv=nv,
                y=(lambda u, v, f=fld, g=sign: f(u, v, g)),
                name="%s_%s%s" % (name, tag, side),
                uv_box=(0.0, 0.0, 0.48, 1.0) if side == "f"
                else (0.50, 0.0, 0.98, 1.0))
    ch = draft.chain
    for tag in ("l", "r"):
        sx = -1 if tag == "l" else 1
        tc = tr.crotch_t(sx)
        # inseam, hem up to the crotch
        draft.sew_chain(panels[tag + "f"].part("left", 0.0, tc),
                        panels[tag + "b"].part("left", 0.0, tc),
                        rows=roll_rows, name="inseam")
        # outseam, hem up to the waist
        draft.sew_chain(panels[tag + "f"].right, panels[tag + "b"].right,
                        rows=roll_rows, name="outseam")
    # the rises: left front to right front, left back to right back
    tcl, tcr = tr.crotch_t(-1), tr.crotch_t(1)
    draft.weld_pairs(panels["lf"].part("left", tcl, 1.0),
                     panels["rf"].part("left", tcr, 1.0))
    draft.weld_pairs(panels["lb"].part("left", tcl, 1.0),
                     panels["rb"].part("left", tcr, 1.0))
    draft.mark("waist", panels["lf"].top + panels["lb"].top
               + panels["rf"].top + panels["rb"].top)
    for tag in ("l", "r"):
        draft.mark("cuff", panels[tag + "f"].bottom + panels[tag + "b"].bottom)
    draft.mark("rise", panels["lf"].part("left", tcl, 1.0)
               + panels["rf"].part("left", tcr, 1.0)
               + panels["lb"].part("left", tcl, 1.0)
               + panels["rb"].part("left", tcr, 1.0))
    return panels
