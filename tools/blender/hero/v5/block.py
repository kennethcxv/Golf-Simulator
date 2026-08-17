"""The shirt block: front, back and sleeve pattern pieces, drafted flat.

A tee and a polo are the same block. That is not a shortcut, it is how a pattern
room works -- one body block, then the style lines (a crew rib or a placket and
collar) are drafted onto it. The brief's objection is to forcing all TEN garments
through one generator, and this is not that: trousers, the hood and the cap have
nothing to do with this file.

Measurements are a men's medium, flat, in metres, with z = 0 at the high point of
the shoulder and the garment running down in -z:

    chest half-width      0.256      shoulder point   0.222 out, 0.052 down
    body length           0.712      neck half-width  0.094
    armpit                0.246 down front neck drop  0.084 / back 0.028

Every curve is a landmark polyline sampled by arc length. The only curvature in a
pattern piece is in its outline; the interior is a Coons grid over that outline,
which is flat because a pattern piece is flat.
"""

import math

from mathutils import Vector

import pattern as PT


class Block(object):
    def __init__(self, chest=0.256, hem=0.250, length=0.712, shoulder=0.222,
                 shoulder_drop=0.052, neck=0.094, front_drop=0.084,
                 back_drop=0.028, armpit=0.246, armhole_bulge=0.017,
                 hem_dip=0.006, sleeve_len=0.196, sleeve_angle=36.0,
                 cuff_half=0.086, sleeve_bulge=0.013):
        self.chest = chest
        self.hem = hem
        self.length = length
        self.shoulder = shoulder
        self.shoulder_drop = shoulder_drop
        self.neck = neck
        self.front_drop = front_drop
        self.back_drop = back_drop
        self.armpit = armpit
        self.armhole_bulge = armhole_bulge
        self.hem_dip = hem_dip
        self.sleeve_len = sleeve_len
        self.sleeve_angle = sleeve_angle
        self.cuff_half = cuff_half
        self.sleeve_bulge = sleeve_bulge

    # -- landmarks ---------------------------------------------------------

    @property
    def z_hem(self):
        return -self.length

    @property
    def z_armpit(self):
        return -self.armpit

    @property
    def z_shoulder(self):
        return -self.shoulder_drop

    def shoulder_pt(self, sx):
        return (sx * self.shoulder, self.z_shoulder)

    def armpit_pt(self, sx):
        return (sx * self.chest, self.z_armpit)

    def hem_pt(self, sx):
        return (sx * self.hem, self.z_hem)

    # -- body outline ------------------------------------------------------

    def side(self, sx):
        """Side seam then armhole, bottom to top. One continuous pattern curve.

        The armhole is a single inward scoop -- one lobe. v3's armhole was a
        circle cut out of a tube and v4's was a blend ramp between two sections;
        both produced the ballooning shoulder cap the brief calls a Renaissance
        puff sleeve, because neither was ever an armhole in the pattern sense.
        """
        # A STRAIGHT side seam from the hem to the armpit. The first draft put an
        # intermediate landmark at `z_armpit + 0.030`, meaning 30 mm ABOVE the
        # armpit -- so the seam ran up past the armpit and back down to it, and
        # `left(v)` reversed direction. The Coons interior interpolates that
        # reversal across the whole panel, which came out as a doubled-over lip
        # right across the chest at armpit height in every render. It read as a
        # torn armhole and cost three rounds of looking in the wrong place.
        pts = [self.hem_pt(sx), self.armpit_pt(sx)]
        pts += PT.arc(self.armpit_pt(sx), self.shoulder_pt(sx),
                      -sx * self.armhole_bulge, n=10, axis=0)[1:]
        return PT.curve(pts)

    SHOULDER_SPAN = 0.255

    def neckline(self, drop):
        """Shoulder seam, neck scoop, shoulder seam. Left to right.

        The three segments get a FIXED share of the parameter -- see
        pattern.piece -- so that the front and back panels, which have very
        different neck depths, still put the shoulder seam in the same place.
        """
        su = self.SHOULDER_SPAN
        left = PT.curve([self.shoulder_pt(-1), (-self.neck * 1.06, -0.004),
                         (-self.neck, 0.0)])
        scoop = PT.curve(PT.arc((-self.neck, 0.0), (self.neck, 0.0), -drop,
                                n=16, axis=1))
        right = PT.curve([(self.neck, 0.0), (self.neck * 1.06, -0.004),
                          self.shoulder_pt(1)])
        return PT.piece([(su, left), (1.0 - 2 * su, scoop), (su, right)])

    def hemline(self):
        pts = [self.hem_pt(-1)]
        pts += PT.arc(self.hem_pt(-1), self.hem_pt(1), -self.hem_dip, n=8,
                      axis=1)[1:-1]
        pts += [self.hem_pt(1)]
        return PT.curve(pts)

    # -- sleeve outline ----------------------------------------------------

    def sleeve_frame(self, sx):
        """Where the cuff ends up, given the sleeve's angle and length."""
        a = math.radians(self.sleeve_angle)
        mid = Vector(((self.armpit_pt(sx)[0] + self.shoulder_pt(sx)[0]) * 0.5,
                      (self.armpit_pt(sx)[1] + self.shoulder_pt(sx)[1]) * 0.5))
        # OUT, then down. `sx` is the side, so the sleeve leaves the body in the
        # direction of its own side -- getting this sign wrong drafts both
        # sleeves back across the chest, where they interpenetrate the body from
        # frame one and the self-collision response throws the whole solve.
        axis = Vector((sx * math.cos(a), -math.sin(a)))
        perp = Vector((axis.y, -axis.x)) * -sx
        c = mid + axis * self.sleeve_len
        return c, axis, perp

    def sleeve(self, sx):
        """The four sides of a sleeve pattern piece.

        left  = the sleeve head, sewn to the armhole (bottom = armpit)
        right = the cuff opening
        bottom = the under-sleeve seam, top = the outer sleeve seam
        """
        c, axis, perp = self.sleeve_frame(sx)
        outer = tuple(c + perp * self.cuff_half)
        under = tuple(c - perp * self.cuff_half)
        head = self.side(sx)

        def left(v):
            # the sleeve head is the armhole, run bottom (armpit) to top
            return head(PT.lerp(self._armhole_t(), 1.0, v))

        def right(v):
            return (PT.lerp(under[0], outer[0], v),
                    PT.lerp(under[1], outer[1], v))

        bottom = PT.curve(PT.arc(self.armpit_pt(sx), under,
                                 -sx * self.sleeve_bulge * 0.5, n=8, axis=0))
        # EASE OUT OF THE SHOULDER POINT. The shoulder seam arrives at about 20
        # degrees below horizontal and the sleeve's outer seam leaves at 44, so
        # the outline has a 64-degree corner there. A real one is a corner too,
        # but softer, and a hard one left a visible ledge at each shoulder tip
        # where the seam roll had to turn through it in a single stitch.
        sh = self.shoulder_pt(sx)
        ease = (sh[0] + sx * 0.016, sh[1] - 0.0055)
        top = PT.curve([sh, ease]
                       + PT.arc(ease, outer, -self.sleeve_bulge, n=10,
                                axis=1)[1:])
        return dict(top=top, bottom=bottom, left=left, right=right,
                    cuff=(under, outer, c, axis, perp))

    def _armhole_t(self):
        """Where along `side` the armhole starts. The side seam runs from the
        hem to the armpit and the armhole from there to the shoulder, so this is
        the arc-length fraction of the side seam."""
        sx = -1
        run = [self.hem_pt(sx), self.armpit_pt(sx)]
        seam = sum((Vector(run[i + 1]) - Vector(run[i])).length
                   for i in range(len(run) - 1))
        hole = PT.arc(self.armpit_pt(sx), self.shoulder_pt(sx),
                      -sx * self.armhole_bulge, n=10, axis=0)
        arm = sum((Vector(hole[i + 1]) - Vector(hole[i])).length
                  for i in range(len(hole) - 1))
        return seam / (seam + arm)


def flat_shell(draft, blk, depth, nu=52, nv=58, snu=22, snv=None,
               back_drop=None, roll_rows=3, name="shirt"):
    """Draft front and back shells, place them flat, and sew the garment.

    THIS IS THE WHOLE CONSTRUCTION. Six pattern pieces -- front body, back body,
    two front sleeves, two back sleeves -- each drafted flat, then placed at
    +/- half the pressed depth and sewn along every seam a real one has: side
    seams, shoulder seams, sleeve outer and under seams, and the armhole where
    the sleeve head meets the body.

    The openings -- neck, hem, cuffs -- are left OPEN, which is what makes them
    openings. They get their trim after the solve, taken off the settled edge.
    """
    hd = depth * 0.5
    # The sleeve head has to have exactly as many stitches as the armhole it is
    # sewn to, and the armhole is whatever whole number of body rows sits above
    # the armpit. Deriving it rather than choosing it is what makes the seam a
    # weld instead of a resample.
    t_arm0 = blk._armhole_t()
    if snv is None:
        snv = nv - int(round(t_arm0 * nv))
    front = draft.panel(top=blk.neckline(blk.front_drop), bottom=blk.hemline(),
                        left=blk.side(-1), right=blk.side(1),
                        nu=nu, nv=nv, y=-hd, name=name + "_front",
                        uv_box=(0.0, 0.0, 0.48, 1.0))
    back = draft.panel(top=blk.neckline(blk.back_drop if back_drop is None
                                       else back_drop),
                       bottom=blk.hemline(),
                       left=blk.side(-1), right=blk.side(1),
                       nu=nu, nv=nv, y=+hd, name=name + "_back",
                       uv_box=(0.50, 0.0, 0.98, 1.0))

    sl = {}
    for sx, tag in ((-1, "l"), (1, "r")):
        s = blk.sleeve(sx)
        for side, yy in ((-hd, "f"), (+hd, "b")):
            sl[tag + yy] = draft.panel(top=s["top"], bottom=s["bottom"],
                                       left=s["left"], right=s["right"],
                                       nu=snu, nv=snv, y=side,
                                       name="%s_sleeve_%s%s" % (name, tag, yy),
                                       uv_box=(0.0, 0.0, 0.30, 0.42))
        sl[tag + "_cuff"] = s["cuff"]

    t_arm = t_arm0
    su = _shoulder_span(blk)
    # the armhole: each sleeve head welds to the body's armhole, front to front
    # and back to back, with zero allowance -- a set-in sleeve seam
    for tag, sxp in (("l", "left"), ("r", "right")):
        draft.weld_pairs(sl[tag + "f"].left, front.part(sxp, t_arm, 1.0))
        draft.weld_pairs(sl[tag + "b"].left, back.part(sxp, t_arm, 1.0))

    # THE OUTLINE. Walking the flat garment's boundary from the hem round to the
    # hem again, the closed part comes in four chains separated by the four
    # openings -- hem, left cuff, neck, right cuff. Each chain is rolled from
    # front panel to back in one operation, so the outward direction is
    # continuous through the shoulder point where three seams meet.
    ch = draft.chain
    chains = [
        ("underleft",
         ch(front.part("left", 0.0, t_arm), sl["lf"].bottom),
         ch(back.part("left", 0.0, t_arm), sl["lb"].bottom)),
        ("overleft",
         ch(list(reversed(sl["lf"].top)), front.part("top", 0.0, su)),
         ch(list(reversed(sl["lb"].top)), back.part("top", 0.0, su))),
        ("overright",
         ch(front.part("top", 1.0 - su, 1.0), sl["rf"].top),
         ch(back.part("top", 1.0 - su, 1.0), sl["rb"].top)),
        ("underright",
         ch(list(reversed(sl["rf"].bottom)),
            list(reversed(front.part("right", 0.0, t_arm)))),
         ch(list(reversed(sl["rb"].bottom)),
            list(reversed(back.part("right", 0.0, t_arm))))),
    ]
    for nm, a, b in chains:
        draft.sew_chain(a, b, rows=roll_rows, name=nm)

    # openings, marked so the trim and the pinning can find them by name rather
    # than by a z threshold that moves when the garment settles
    draft.mark("neck", front.part("top", su, 1.0 - su)
               + back.part("top", su, 1.0 - su))
    draft.mark("shoulder", front.part("top", 0.0, su)
               + front.part("top", 1.0 - su, 1.0)
               + back.part("top", 0.0, su) + back.part("top", 1.0 - su, 1.0))
    draft.mark("hem", front.bottom + back.bottom)
    for tag in ("l", "r"):
        draft.mark("cuff", sl[tag + "f"].right + sl[tag + "b"].right)
    return dict(front=front, back=back, sleeves=sl, armhole_t=t_arm,
                shoulder_span=su)


def _shoulder_span(blk):
    return blk.SHOULDER_SPAN


def _sleeve_out(blk, tag, which):
    sx = -1 if tag == "l" else 1
    _c, axis, perp = blk.sleeve_frame(sx)
    d = Vector((perp.x, 0.0, perp.y)) * which
    d.normalize()
    return lambda p: d
