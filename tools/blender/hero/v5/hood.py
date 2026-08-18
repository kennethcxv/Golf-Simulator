"""A two-panel hood, drafted flat like the rest of the garment.

A hood pattern is two mirror side panels joined along ONE seam that runs from the
nape, up the back, over the crown and down to the forehead, plus a neck seam
along the bottom and a face opening at the front. Three edges, and the Coons
patch wants four, so the centre seam is split at the crown -- which is where a
pattern room puts a notch anyway.

Drafted in the PROFILE plane (y, z), then placed:

    * the bottom edge is mapped onto the garment's own neckline, so the hood
      grows out of the neck rather than being parked near it;
    * above the neck the panel relaxes to its own plane at x = +/- half the hood
      width, which is what a hood does when it collapses on a hanger.

v4's hood was a lofted disc with a boolean hole and it read as a cowl. The thing
that makes a hood a hood is the centre seam over the crown and the binding round
the face, and neither of those exists in a surface of revolution.
"""

import math

import bpy
from mathutils import Vector

import pattern as PT
import studio as ST


class Hood(object):
    def __init__(self, rise=0.212, forward=0.052, back=0.096, half=0.056,
                 crown_y=0.014, brow=0.150, nape_drop=0.010, lean=0.10):
        self.rise = rise            # crown height above the neck seam
        self.forward = forward      # how far the face edge sits in front
        self.back = back            # how far the nape sits behind
        self.half = half            # half the hood's width when collapsed
        self.crown_y = crown_y
        self.brow = brow
        self.nape_drop = nape_drop
        # A hood on a hanger FLOPS BACK. Standing it vertical made it read as a
        # paper party hat, which was the loudest fault on the first hoodie.
        self.lean = lean

    # landmarks in the profile plane, (y, z)
    @property
    def face_bottom(self):
        return (-self.forward, -0.004)

    @property
    def face_top(self):
        return (-self.forward * 0.86, self.brow)

    @property
    def crown(self):
        return (self.crown_y, self.rise)

    @property
    def nape(self):
        return (self.back, -self.nape_drop)

    def sides(self):
        FB, FT, CR, NP = (self.face_bottom, self.face_top, self.crown,
                          self.nape)
        # neck seam: FB round to NP, dipping slightly under the jaw
        # 24 landmarks, not 8. `curve()` walks a POLYLINE, so a crown drawn with
        # eight points IS an octagon, and the first hood's silhouette was one.
        bottom = PT.curve(PT.arc(FB, NP, -0.016, n=18, axis=1))
        # face opening: FB up to FT, bowed forward
        left = PT.curve(PT.arc(FB, FT, -0.020, n=26, axis=0))
        # centre seam, front half: FT over to CR
        top = PT.curve(PT.arc(FT, CR, -0.012, n=20, axis=1))
        # centre seam, back half: NP up to CR, bowed back
        right = PT.curve(PT.arc(NP, CR, 0.030, n=26, axis=0))
        return dict(top=top, bottom=bottom, left=left, right=right)


def build(draft, hd, neckline, nu=30, nv=34, roll_rows=12, name="hood"):
    """Draft both halves, place them on the neckline, sew the centre seam.

    `neckline(u)` returns the garment's 3-D neck point for u in 0..1 running from
    the centre front to the centre back on the +x side; the -x side is its
    mirror.
    """
    s = hd.sides()
    bottom_at = s["bottom"]

    def placer(sx):
        def warp(p, u, v):
            # p is (x = sx*half, y, z) as drafted in the profile plane
            w = PT.smoothstep(v, 0.0, 0.34)
            by, bz = bottom_at(u)
            n = neckline(u)
            base = Vector((n.x * sx if sx > 0 else -abs(n.x), n.y, n.z))
            flat = Vector((sx * hd.half, by, bz))
            anchor = base.lerp(flat, w)
            # THE PANEL CLOSES TOWARD THE CROWN. Drafted at a constant
            # x = +/- half, each side of the hood is a flat slab and the only
            # curvature in the whole thing is the seam bridging them -- which
            # is a box with a rolled top edge, and it read as one flat facet
            # across the crown however many rows the roll got. A hood is widest
            # at the head and narrows over it, so the half-width is a profile
            # in v and the seam it feeds narrows with it.
            wf = 1.0 - 0.52 * PT.smoothstep(v, 0.40, 1.0) ** 1.35
            anchor.x *= wf
            up = p.z - bz
            return anchor + Vector((0.0, p.y - by + hd.lean * max(0.0, up),
                                    up))
        return warp

    panels = {}
    for sx, tag in ((-1, "l"), (1, "r")):
        panels[tag] = draft.panel(
            top=s["top"], bottom=s["bottom"], left=s["left"], right=s["right"],
            nu=nu, nv=nv, y=sx * hd.half, name="%s_%s" % (name, tag),
            plane="yz", uv_box=(0.0, 0.55, 0.34, 1.0), warp=placer(sx))
    # THE CENTRE SEAM IS THE CROWN. Its roll radius is half the hood's width --
    # 88 mm, six times the 13 mm of a side seam -- so the row count that gives a
    # soft edge on a body panel gives a five-facet box over a head. The first
    # hood read as a folded paper bag for exactly this reason.
    ch = draft.chain
    a = ch(list(reversed(panels["l"].top)), list(reversed(panels["l"].right)))
    b = ch(list(reversed(panels["r"].top)), list(reversed(panels["r"].right)))
    draft.sew_chain(a, b, rows=roll_rows, name="hoodseam", flat_axis=0)
    draft.mark("hoodface", panels["l"].left + panels["r"].left)
    draft.mark("hoodneck", panels["l"].bottom + panels["r"].bottom)
    return panels


def eyelets(name, ob, group, x=0.030, z=-0.012, r=0.0042):
    """Two metal eyelets at the front of the hood, for the cords to leave by."""
    parts = []
    for sx in (-1, 1):
        p, n = PT.surface_at(ob, sx * x, z, 0.0006)
        if p is None:
            continue
        ring = []
        for i in range(11):
            t = i / 10.0
            a = 2 * math.pi
            ring.append(t)
        bpy.ops.mesh.primitive_torus_add(
            major_radius=r, minor_radius=r * 0.34, major_segments=16,
            minor_segments=8, location=p,
            rotation=(math.pi / 2, 0.0, 0.0))
        e = bpy.context.object
        e.name = "%s_%d" % (name, sx)
        parts.append(e)
    if not parts:
        return None
    ob2 = ST.join(name, parts)
    ST.smooth_by_angle(ob2, 34.0)
    return ob2


def cords(name, ob, anchors, drop=0.128, r=0.0026, sides=8):
    """The drawcords, hanging from the eyelets.

    A cord leaves the eyelet, falls, and swings a little where it lies against
    the chest. The shape is a hanging catenary flattened against the garment, not
    a wave -- v4's read as a row of dashes because it was cast at the body only
    and with a single ray, so wherever the ray missed, the cord vanished.
    """
    parts = []
    for i, (p0, lean) in enumerate(anchors):
        pts = []
        N = 16
        for k in range(N + 1):
            t = k / N
            # catenary-ish: steep at the top, hanging plumb by the bottom
            y = p0.y + lean * (t ** 1.6) * 0.010
            x = p0.x + lean * 0.020 * (1.0 - (1.0 - t) ** 2)
            z = p0.z - drop * t
            q = Vector((x, y, z))
            hit, _n = PT.surface_at(ob, q.x, q.z, -0.0038)
            if hit is not None and q.y > hit.y:
                q.y = hit.y
            pts.append(q)
        parts.append(ST.sweep("%s_%d" % (name, i), pts, r, r, sides=sides))
        # the aglet
        parts.append(ST.box("%s_tip%d" % (name, i),
                            tuple(pts[-1] + Vector((0, 0, -0.008))),
                            (r * 1.25, r * 1.25, 0.0092), bevel=0.0008))
    ob2 = ST.join(name, parts)
    ST.smooth_by_angle(ob2, 34.0)
    return ob2
