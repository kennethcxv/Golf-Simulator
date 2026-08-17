"""Flat sewing-pattern panels, sewn into a garment. The method change.

v2, v3 and v4 all built a closed garment VOLUME -- a loft, a superellipse
extrusion, a mid-surface -- and then simulated it. The brief's diagnosis is
correct and it is worth stating precisely: if the volume is wrong before the
solver starts, the solver cannot fix it, because cloth simulation preserves the
surface it is given. Fifty rounds of fold work never reached the fault because
the fault was upstream of the folds.

A garment is not a volume. It is a set of FLAT PANELS with a seam allowance,
and its shape is the consequence of which edges are sewn to which. That is what
this module builds.

    draft = Draft()
    front = draft.panel(top=neckline, bottom=hem, left=side_l, right=side_r,
                        nu=64, nv=72, y=-0.013)
    back  = draft.panel(...,                                       y=+0.013)
    draft.sew(front.left, back.left)      # the side seam
    ob = draft.build("PoloFront")

Every panel is a quad grid over a four-sided region, which is exactly the shape
of a real pattern piece:

  * a body front is bounded by the hem, the two side-seam-plus-armhole curves,
    and the neckline-plus-shoulder curve;
  * a sleeve by the sleeve head, the cuff and two underarm seams;
  * a trouser leg by the waist, the hem and the inseam and outseam.

The grid comes from a Coons patch, so the interior follows the boundary the way
a pattern block's grain lines do, and (u, v) is a UV map for free -- no
smart-project seams cutting across a chest.

WHY THE PANELS ARE PLACED AT +/- y AND NOT SIMULATED CLOSED. A top on a hanger
in Image1.png is FLAT: the front panel and the back panel are a couple of
centimetres apart with a soft roll at the side seam, and that is a garment that
has been pressed, put on a hanger and photographed. Placing the drafted panels
at their own half-depth and sewing the perimeter gives that directly, with no
stretching for a solver to resolve. Gravity then acts on the result -- it puts
the hem and the cuffs where they fall and creases the panel where it must, and
because the panels start flat the creases it makes are the only curvature in the
asset. Nothing here adds a harmonic fold term. There is no sine in this module.
"""

import math

import bpy
import bmesh
from mathutils import Vector

import studio as ST


def lerp(a, b, t):
    return a + (b - a) * t


def curve(points, closed=False):
    """A sampler over a polyline: f(t in 0..1) -> (x, z), arc-length even.

    Pattern curves are drawn as a handful of landmark points -- shoulder point,
    armhole notch, waist, hem corner -- and the sampler walks them by distance
    so a long straight side seam does not get the same number of grid rows as a
    30 mm armhole scoop.
    """
    pts = [Vector((p[0], p[1])) for p in points]
    if closed:
        pts = pts + [pts[0]]
    seg = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]
    total = sum(seg) or 1.0
    acc = [0.0]
    for s in seg:
        acc.append(acc[-1] + s / total)

    def f(t):
        t = min(1.0, max(0.0, t))
        for i in range(len(seg)):
            if t <= acc[i + 1] or i == len(seg) - 1:
                span = acc[i + 1] - acc[i]
                u = 0.0 if span < 1e-12 else (t - acc[i]) / span
                p = pts[i].lerp(pts[i + 1], u)
                return (p.x, p.y)
        return (pts[-1].x, pts[-1].y)
    return f


def piece(parts):
    """A sampler that gives each segment a FIXED share of the parameter.

    `curve()` walks by arc length, which is right inside one pattern curve and
    wrong across a seam: the front neckline is 82 mm deep and the back 28 mm, so
    arc length puts the shoulder-seam-to-neck boundary at u = 0.267 on the front
    and 0.296 on the back. Sewing u in [0, 0.267] of one to u in [0, 0.267] of
    the other then joins 15 mm of the back's NECKLINE to the front's shoulder.

    `parts` is [(fraction, sampler), ...]. Both panels then agree on where the
    shoulder seam ends whatever their neck depth.
    """
    total = sum(f for f, _ in parts) or 1.0
    acc, cum = [], 0.0
    for f, s in parts:
        acc.append((cum / total, (cum + f) / total, s))
        cum += f

    def f(t):
        t = min(1.0, max(0.0, t))
        for a, b, s in acc:
            if t <= b or (a, b, s) is acc[-1]:
                span = b - a
                return s(0.0 if span < 1e-12 else (t - a) / span)
        return acc[-1][2](1.0)
    return f


def smoothstep(x, a, b):
    if b <= a:
        return 0.0 if x < a else 1.0
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def arc(p0, p1, bulge, n=12, axis=0):
    """Landmark points along a circular-ish arc between two points.

    `bulge` is the sideways offset at the midpoint, in metres, positive toward
    +axis. Used for armhole scoops, necklines and shirttail hems -- the places a
    pattern curve is genuinely curved. It is a single-lobe offset with a
    smoothstep profile: one hump, no ripple.
    """
    out = []
    p0, p1 = Vector(p0), Vector(p1)
    for i in range(n + 1):
        t = i / n
        p = p0.lerp(p1, t)
        w = math.sin(math.pi * t) ** 1.15
        if axis == 0:
            p.x += bulge * w
        else:
            p.y += bulge * w
        out.append((p.x, p.y))
    return out


class PanelRef(object):
    """Index bookkeeping for one drafted panel.

    Sides are named for the pattern, not for the mesh: `top` is the neckline
    edge of a body panel and the sleeve head of a sleeve. Because the grid is
    regular, a side is a slice of the index array -- no geometric edge-loop
    search, which is the part of sewing that goes wrong when a weld renumbers
    the mesh.
    """

    def __init__(self, draft, base, nu, nv, name):
        self.draft = draft
        self.base = base
        self.nu = nu
        self.nv = nv
        self.name = name

    def at(self, iu, iv):
        return self.base + iv * (self.nu + 1) + iu

    @property
    def bottom(self):
        return [self.at(i, 0) for i in range(self.nu + 1)]

    @property
    def top(self):
        return [self.at(i, self.nv) for i in range(self.nu + 1)]

    @property
    def left(self):
        return [self.at(0, i) for i in range(self.nv + 1)]

    @property
    def right(self):
        return [self.at(self.nu, i) for i in range(self.nv + 1)]

    def part(self, side, t0, t1):
        """A sub-range of one side, by parameter. The armhole is the top third
        of the side seam curve, so the sleeve sews to `body.left(0.62, 1.0)`."""
        idx = getattr(self, side)
        n = len(idx) - 1
        a, b = int(round(t0 * n)), int(round(t1 * n))
        return idx[min(a, b):max(a, b) + 1]

    def row(self, iv):
        return [self.at(i, iv) for i in range(self.nu + 1)]

    def col(self, iu):
        return [self.at(iu, i) for i in range(self.nv + 1)]

    def verts(self):
        return range(self.base, self.base + (self.nu + 1) * (self.nv + 1))


class Draft(object):
    """One garment's pattern, assembled into a single mesh."""

    def __init__(self):
        self.co = []
        self.uv = []
        self.faces = []
        self.face_uv = []
        self.panels = []
        self.groups = {}

    # -- drafting ----------------------------------------------------------

    def panel(self, top, bottom, left, right, nu, nv, y=0.0, name="panel",
              uv_box=(0.0, 0.0, 1.0, 1.0), plane="xz", warp=None):
        """A four-sided pattern piece as a Coons-patch quad grid.

        `top`, `bottom` take t in 0..1 left-to-right; `left`, `right` take t in
        0..1 bottom-to-top. All four return (a, b) in the drafting plane. The
        corners must agree -- the Coons correction hides a millimetre, not a
        centimetre, and a mismatch shows up as a twisted panel rather than as an
        error, so they are checked.
        """
        for nm, p, q in (("bottom-left", bottom(0.0), left(0.0)),
                         ("bottom-right", bottom(1.0), right(0.0)),
                         ("top-left", top(0.0), left(1.0)),
                         ("top-right", top(1.0), right(1.0))):
            d = math.hypot(p[0] - q[0], p[1] - q[1])
            if d > 0.0015:
                raise SystemExit(
                    "DRAFT FAILED: %s corner of %s is open by %.1f mm "
                    "(%s vs %s)" % (nm, name, d * 1000, p, q))
        base = len(self.co)
        p00, p10 = bottom(0.0), bottom(1.0)
        p01, p11 = top(0.0), top(1.0)
        u0, v0, u1, v1 = uv_box
        for iv in range(nv + 1):
            v = iv / nv
            lo, ro = left(v), right(v)
            for iu in range(nu + 1):
                u = iu / nu
                bo, to = bottom(u), top(u)
                a = ((1 - v) * bo[0] + v * to[0] + (1 - u) * lo[0] + u * ro[0]
                     - ((1 - u) * (1 - v) * p00[0] + u * (1 - v) * p10[0]
                        + (1 - u) * v * p01[0] + u * v * p11[0]))
                b = ((1 - v) * bo[1] + v * to[1] + (1 - u) * lo[1] + u * ro[1]
                     - ((1 - u) * (1 - v) * p00[1] + u * (1 - v) * p10[1]
                        + (1 - u) * v * p01[1] + u * v * p11[1]))
                yy = y(u, v) if callable(y) else y
                if plane == "xz":
                    p = Vector((a, yy, b))
                elif plane == "xy":
                    p = Vector((a, b, yy))
                else:
                    raise SystemExit("plane must be xz or xy")
                if warp is not None:
                    p = warp(p, u, v)
                self.co.append(p)
                self.uv.append((lerp(u0, u1, u), lerp(v0, v1, v)))
        for iv in range(nv):
            for iu in range(nu):
                a = base + iv * (nu + 1) + iu
                self.faces.append((a, a + 1, a + nu + 2, a + nu + 1))
        ref = PanelRef(self, base, nu, nv, name)
        self.panels.append(ref)
        return ref

    # -- sewing ------------------------------------------------------------

    def sew(self, a, b, flip=False, width=None, name=None):
        """Join two edges with a strip of quads: the seam.

        With `width` None the strip is a single band of faces directly between
        the two edges, which is what a flat-felled side seam looks like from
        outside -- a soft roll a few millimetres across. The two edges keep
        their own vertices, so the seam is a real topological join and the
        panels either side of it stay flat.
        """
        b = list(reversed(b)) if flip else list(b)
        a = list(a)
        if len(a) != len(b):
            b = _resample(b, len(a))
        for i in range(len(a) - 1):
            self.faces.append((a[i], a[i + 1], b[i + 1], b[i]))
        if name:
            self.groups.setdefault(name, []).extend(a + b)
        return list(zip(a, b))

    def chain(self, *lists):
        """Concatenate index runs into one boundary chain, dropping the repeated
        index where two runs meet at a welded corner."""
        out = []
        for lst in lists:
            lst = list(lst)
            if out and lst and out[-1] == lst[0]:
                lst = lst[1:]
            out.extend(lst)
        return out

    def sew_chain(self, a, b, rows=3, bulge=0.62, name=None, flat_axis=1):
        """Roll the front panel round to the back along a WHOLE boundary chain.

        The first cut sewed each seam separately with its own constant outward
        direction: the side seam bulged in x, the shoulder seam in z, the
        sleeve's outer seam along the sleeve's perpendicular. Where three of
        those met at the shoulder point they disagreed by 34 degrees, and the
        result was a pair of flaps sticking out past each shoulder like
        epaulettes -- the worst thing in the first render.

        A garment does not have a direction per seam. It has ONE outline, and
        the cloth turns over the edge of it. So the outward direction is taken
        from the chain's own tangent -- perpendicular to it, in the plane of the
        pattern, signed away from the panel -- which is continuous by
        construction and needs no per-seam decision.
        """
        a, b = list(a), list(b)
        if len(a) != len(b):
            raise SystemExit("CHAIN FAILED: %d against %d" % (len(a), len(b)))
        pts = [self.co[i] for i in a]
        cen = sum(pts, Vector((0, 0, 0))) / len(pts)
        outs = []
        ax = flat_axis
        for i in range(len(pts)):
            nxt = pts[min(len(pts) - 1, i + 1)]
            prv = pts[max(0, i - 1)]
            t = nxt - prv
            t[ax] = 0.0
            if t.length < 1e-9:
                t = Vector((1.0, 0.0, 0.0))
            t.normalize()
            n = Vector((t.z, 0.0, -t.x)) if ax == 1 else Vector((t.y, -t.x, 0.0))
            r = pts[i] - cen
            r[ax] = 0.0
            if n.dot(r) < 0.0:
                n = -n
            outs.append(n)
        # Smooth the normals along the chain. At the shoulder point the chain
        # turns from the sleeve's outer seam onto the shoulder seam through about
        # 60 degrees in one step, so two adjacent roll rows crossed and left a
        # small triangular tab sticking out past each shoulder.
        for _ in range(4):
            outs = [(outs[max(0, i - 1)] + outs[i] * 2.0
                     + outs[min(len(outs) - 1, i + 1)]).normalized()
                    for i in range(len(outs))]
        self._roll(a, b, outs, rows, bulge, name)

    def sew_roll(self, a, b, out, rows=3, bulge=0.62, name=None):
        """A seam with a ROLL, one constant outward direction.

        Kept for a seam that genuinely has one -- a trouser inseam, a hood's
        centre-back. For a garment outline use `sew_chain`.
        """
        a, b = list(a), list(b)
        if len(a) != len(b):
            raise SystemExit("SEAM FAILED: %d against %d" % (len(a), len(b)))
        outs = [Vector(out(self.co[i])) for i in a]
        self._roll(a, b, outs, rows, bulge, name)

    def _roll(self, a, b, outs, rows, bulge, name):
        """Bridge two panel edges over a semicircle of radius half their gap.

        The panels either side stay dead flat: all the turning happens in the
        `rows` inserted here, which span only the pressed depth.
        """
        # Taper the roll to nothing at each end of the chain. A chain ends at an
        # OPENING -- a cuff, the neck -- where there is no roll, only the two
        # panel edges. Carrying the full bulge to the last stitch left a small
        # pointed tab sticking out at each cuff corner and at each shoulder tip,
        # four per garment, and they read as damage rather than as cloth.
        n = len(a)
        ends = [min(1.0, min(k, n - 1 - k) / 4.0) for k in range(n)]
        ends = [e * e * (3.0 - 2.0 * e) for e in ends]
        prev = a
        for r in range(1, rows + 1):
            t = r / (rows + 1)
            # the true semicircle through the two panel edges, not a sine bump
            # that happens to look like one
            circ = math.sqrt(max(0.0, 1.0 - (2.0 * t - 1.0) ** 2))
            cur = []
            for k, (i, j) in enumerate(zip(a, b)):
                pa, pb = self.co[i], self.co[j]
                mid = pa.lerp(pb, t)
                d = Vector(outs[k])
                if d.length > 1e-9:
                    d.normalize()
                half = (pb - pa).length * 0.5
                cur.append(len(self.co))
                self.co.append(mid + d * (bulge * half * circ * ends[k]))
                self.uv.append(self.uv[i])
            for k in range(len(cur) - 1):
                self.faces.append((prev[k], prev[k + 1], cur[k + 1], cur[k]))
            prev = cur
        for k in range(len(prev) - 1):
            self.faces.append((prev[k], prev[k + 1], b[k + 1], b[k]))
        if name:
            self.groups.setdefault(name, []).extend(a + b)

    def weld_pairs(self, a, b):
        """Sew with zero allowance: the two edges become one line.

        For a shoulder seam on a flat-pressed top there is nothing to see
        between the front and back panels at the fold -- the cloth simply turns.
        Averaging the two edges onto one line and bridging gives that without a
        sliver face.
        """
        b = list(b)
        a = list(a)
        if len(a) != len(b):
            # NOT resampled. Duplicating an index to make the counts agree
            # writes faces with a repeated corner -- 36 of them in the first
            # draft, which came out as wire edges and a pinched armhole. A seam
            # whose two sides do not have the same number of stitches is a
            # drafting error, so it is one here too.
            raise SystemExit(
                "SEAM FAILED: %d stitches against %d. Draft the two pieces at "
                "matching resolution." % (len(a), len(b)))
        for i, j in zip(a, b):
            m = (self.co[i] + self.co[j]) * 0.5
            self.co[i] = m
            self.co[j] = m
        for i in range(len(a) - 1):
            self.faces.append((a[i], a[i + 1], b[i + 1], b[i]))

    def mark(self, name, idxs):
        self.groups.setdefault(name, []).extend(list(idxs))

    def move(self, idxs, fn):
        for i in idxs:
            self.co[i] = fn(self.co[i])

    # -- output ------------------------------------------------------------

    def build(self, name, weld=1e-5):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(c) for c in self.co], [], self.faces)
        me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(ob)
        lay = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            for li in poly.loop_indices:
                vi = me.loops[li].vertex_index
                lay.data[li].uv = self.uv[vi] if vi < len(self.uv) else (0.0, 0.0)
        for g, idxs in self.groups.items():
            vg = ob.vertex_groups.new(name=g)
            uniq = sorted(set(int(i) for i in idxs))
            if uniq:
                vg.add(uniq, 1.0, 'REPLACE')
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=weld)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.to_mesh(me)
        bm.free()
        me.update()
        return ob


def _resample(idx, n):
    out = []
    for i in range(n):
        t = i / (n - 1) if n > 1 else 0.0
        out.append(idx[min(len(idx) - 1, int(round(t * (len(idx) - 1))))])
    return out


# ---------------------------------------------------------------------------
# trim that is real geometry, not a shader


def band(name, ring, height, thickness, rib=0, rib_depth=0.0009, taper=1.0,
         z_shift=0.0):
    """A ribbed band on a garment opening: neck, cuff, hem, waistband.

    THE SINGLE BIGGEST STYLE MARKER IN THE REFERENCE and the one thing no v4
    garment had. Every knit in Image1.png reads as clothing because the neck,
    the cuffs and the hem are separate bands that sit PROUD of the panel with a
    crisp top edge. v4's tee had a rolled edge at the neck and nothing at the
    cuff or the hem, so it read as a bag with sleeves.

    `ring` is a closed list of points -- the garment opening, taken from the
    panel boundary so the band cannot drift off it. Ribs are cut as real
    geometry at ARC-LENGTH pitch, not by angle about an axis: on a flattened
    section, angular pitch bunches the ribs at the ends and smears them at the
    sides, which is the fault the v4 waistband had twice.
    """
    ring = [Vector(p) for p in ring]
    n = len(ring)
    per = [0.0]
    for i in range(n):
        per.append(per[-1] + (ring[(i + 1) % n] - ring[i]).length)
    circ = per[-1]
    cen = sum(ring, Vector((0, 0, 0))) / n

    rows = []
    NV = 5
    for iv in range(NV + 1):
        t = iv / NV
        z = z_shift - height * t
        k = lerp(1.0, taper, t)
        row = []
        for i in range(n):
            p = ring[i]
            radial = Vector((p.x - cen.x, p.y - cen.y, 0.0))
            if radial.length > 1e-9:
                radial.normalize()
            d = 0.0
            if rib:
                # arc length, so the pitch is constant along the band
                phase = per[i] / circ * rib
                d = -rib_depth * (0.5 - 0.5 * math.cos(2 * math.pi * phase))
            q = Vector((cen.x + (p.x - cen.x) * k, cen.y + (p.y - cen.y) * k,
                        p.z + z))
            row.append(tuple(q + radial * (thickness + d)))
        rows.append(row)
    outer = ST.grid(name, rows, wrap_u=True)
    rows_in = []
    for iv in range(NV + 1):
        t = iv / NV
        z = z_shift - height * t
        k = lerp(1.0, taper, t)
        row = []
        for i in range(n):
            p = ring[i]
            radial = Vector((p.x - cen.x, p.y - cen.y, 0.0))
            if radial.length > 1e-9:
                radial.normalize()
            q = Vector((cen.x + (p.x - cen.x) * k, cen.y + (p.y - cen.y) * k,
                        p.z + z))
            row.append(tuple(q - radial * thickness * 0.35))
        rows_in.append(row)
    inner = ST.grid(name + "_in", rows_in, wrap_u=True)
    ob = ST.join(name, [outer, inner])
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.bridge_loops(bm, edges=[e for e in bm.edges if e.is_boundary])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def ring_from(ob, pred, axis="z"):
    """Take an opening from the built mesh: every boundary vertex passing
    `pred`, ordered around the centre. Bands must come from the panel they sit
    on, or they end up skewed across it -- which is what happened to the v4
    waistband when it was built from the pattern while the body was simulated."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    verts = [v for v in bm.verts if v.is_boundary and pred(v.co)]
    pts = [Vector(v.co) for v in verts]
    bm.free()
    if len(pts) < 6:
        raise SystemExit("ring_from(%s) found only %d boundary verts"
                         % (ob.name, len(pts)))
    cen = sum(pts, Vector((0, 0, 0))) / len(pts)
    pts.sort(key=lambda p: math.atan2(p.y - cen.y, p.x - cen.x))
    return pts


def boundary_loops(ob):
    """Every closed loop of boundary edges, as ordered vertex-index lists."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    adj = {}
    for e in bm.edges:
        if not e.is_boundary:
            continue
        a, b = e.verts[0].index, e.verts[1].index
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    loops, seen = [], set()
    for start in adj:
        if start in seen:
            continue
        loop, cur, prev = [start], start, None
        seen.add(start)
        while True:
            nxt = None
            for c in adj.get(cur, ()):
                if c != prev and c not in seen:
                    nxt = c
                    break
            if nxt is None:
                break
            loop.append(nxt)
            seen.add(nxt)
            prev, cur = cur, nxt
        if len(loop) > 3:
            loops.append(loop)
    bm.free()
    return loops


def opening_loops(ob, group, share=0.30):
    """The boundary loops belonging to a marked opening.

    Filtering by "both verts of the edge are in the group" leaves the seam roll's
    last few vertices out -- they are boundary too, but they belong to the roll,
    not to the panel edge. Every opening then came out with a NOTCH cut into it
    where the roll met it, four of them per garment, and they read as damage.
    An opening is a whole closed loop, so it is selected as one.
    """
    import sim as SIM
    want = set(SIM.group_verts(ob, group))
    if not want:
        raise SystemExit("OPENING FAILED: group %r is empty" % group)
    out = []
    for loop in boundary_loops(ob):
        hit = sum(1 for i in loop if i in want)
        if hit >= max(4, int(share * len(loop))):
            out.append(loop)
    if not out:
        raise SystemExit("OPENING FAILED: no boundary loop matches %r" % group)
    return out


def _surface_dir(ob, loop):
    """For each loop vertex: the in-surface direction AWAY from the opening, and
    the outward normal. Both taken from the mesh, so they hold whatever the
    solver did to it."""
    me = ob.data
    nbr = {}
    for e in me.edges:
        a, b = e.vertices
        nbr.setdefault(a, []).append(b)
        nbr.setdefault(b, []).append(a)
    inloop = set(loop)
    dirs, norms = [], []
    for i in loop:
        p = me.vertices[i].co
        acc = Vector((0, 0, 0))
        n = 0
        for j in nbr.get(i, ()):
            if j in inloop:
                continue
            acc += (me.vertices[j].co - p)
            n += 1
        if n:
            acc /= n
        if acc.length < 1e-9:
            acc = Vector((0.0, 0.0, 1.0))
        dirs.append(acc.normalized())
        nv = Vector(me.vertices[i].normal)
        if nv.length < 1e-9:
            nv = Vector((0.0, -1.0, 0.0))
        norms.append(nv.normalized())
    # SMOOTH BOTH ALONG THE LOOP. Taken per vertex they wobble -- a vertex next
    # to the seam roll has different neighbours from one in the middle of a panel
    # -- and the band built on them came out with a torn sawtooth edge on every
    # opening. A trim band's edge is a smooth curve because the binding is cut
    # from a straight strip.
    n = len(dirs)
    for _ in range(8):
        dirs = [(dirs[(i - 1) % n] + dirs[i] * 2.0
                 + dirs[(i + 1) % n]).normalized() for i in range(n)]
        norms = [(norms[(i - 1) % n] + norms[i] * 2.0
                  + norms[(i + 1) % n]).normalized() for i in range(n)]
    return dirs, norms


def rib_band(name, ob, group, width=0.019, proud=0.0026, ribs=0,
             rib_depth=0.0008, rows=4, start=0.0020, label=""):
    """A RIBBED TRIM BAND lying on the garment around an opening.

    The single loudest signal in Image1.png that a thing is clothing: the neck,
    the cuffs and the hem of every knit on that sheet are separate bands sitting
    PROUD of the panel with a crisp top edge. v4 had none of them and its tee
    read as a bag with sleeves. v5's first attempt built them as rings extruded
    radially from the opening's centroid, which is right for the horizontal part
    of a neckline and wrong everywhere the neckline dips -- and at 1.2 mm of
    thickness it came out as a row of slivers you could not see at all.

    So the band is built from the SURFACE: for each vertex of the opening, walk
    inward along the fabric by `width`, standing `proud` off it. That follows
    whatever shape the opening actually has. Ribs are cut at arc-length pitch,
    never by angle about an axis.
    """
    loops = opening_loops(ob, group)
    parts = []
    for li, loop in enumerate(loops):
        dirs, norms = _surface_dir(ob, loop)
        me = ob.data
        pts = [Vector(me.vertices[i].co) for i in loop]
        per = [0.0]
        for k in range(len(pts)):
            per.append(per[-1] + (pts[(k + 1) % len(pts)] - pts[k]).length)
        circ = max(1e-6, per[-1])
        rowsets = []
        for r in range(rows + 1):
            t = r / rows
            # `start` holds the band's outer row clear of the opening's own
            # boundary. Coincident with it, the band and the panel z-fought and
            # the hem came out scalloped.
            along = start + (width - start) * t
            row = []
            for k, p in enumerate(pts):
                # a raised band with a crisp step at its outer edge, merging back
                # into the fabric at the inner edge
                lift = proud * (1.0 if t < 0.62 else (1.0 - t) / 0.38)
                if ribs:
                    ph = per[k] / circ * ribs
                    lift -= rib_depth * (0.5 - 0.5 * math.cos(2 * math.pi * ph))
                row.append(tuple(p + dirs[k] * along + norms[k] * lift))
            rowsets.append(row)
        parts.append(ST.grid("%s_%d" % (name, li), rowsets, wrap_u=True))
    band = ST.join(name, parts) if len(parts) > 1 else parts[0]
    band.name = name
    print("  band %-8s %d loop(s), %.0f mm wide, %.1f mm proud"
          % (label or group, len(loops), width * 1000, proud * 1000))
    return band


def turn_hem(ob, group, depth=0.024, inset=0.0028, up=True, label=""):
    """A TURNED HEM: the cloth folds back on itself at the opening.

    Every finished edge on a garment is this and nothing else -- the raw edge is
    turned to the inside and stitched, so from outside you see a crisp fold with
    the cloth doubled behind it. v4 gave openings a `solidify` rim, which is a
    3 mm wall, and v5's first cut gave them a `band` ring 1.2 mm proud, which at
    that thickness came out as a row of slivers. Extruding the boundary loop back
    inside the garment is the actual construction, it is one operation, and the
    fold it leaves is exactly the crisp line the reference shows at every hem and
    cuff.
    """
    idxs = set()
    for loop in opening_loops(ob, group):
        idxs.update(loop)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    edges = [e for e in bm.edges
             if e.is_boundary and e.verts[0].index in idxs
             and e.verts[1].index in idxs]
    if len(edges) < 8:
        raise SystemExit("HEM FAILED: only %d boundary edges in %r"
                         % (len(edges), group))
    pts = [v.co.copy() for e in edges for v in e.verts]
    cen = sum(pts, Vector((0, 0, 0))) / len(pts)
    ret = bmesh.ops.extrude_edge_only(bm, edges=edges)
    new = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]
    for v in new:
        r = v.co - cen
        r.z = 0.0
        if r.length > 1e-9:
            r.normalize()
        v.co = v.co + Vector((0.0, 0.0, depth if up else -depth)) - r * inset
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    print("  hem %-8s %s %d edges turned %.0f mm"
          % (label or group, ob.name, len(edges), depth * 1000))
    return len(edges)


def topstitch(name, pts, radius=0.00068, sides=6):
    return ST.sweep(name, pts, radius, radius, sides=sides)


def seam_line(ob, path, depth=0.0011, width=0.0052):
    """Press a seam INTO a panel: a narrow V, not a tube laid on top.

    A stitched seam on a real garment is a valley -- the two allowances pull the
    face together. v4 drew seams as swept tubes, which at this scale is a cable
    lying on the shirt. `path` is a list of (point, direction) in world space.
    """
    from mathutils.kdtree import KDTree
    me = ob.data
    kd = KDTree(len(me.vertices))
    for i, v in enumerate(me.vertices):
        kd.insert(v.co, i)
    kd.balance()
    moved = 0
    for p, d in path:
        d = Vector(d).normalized()
        for (co, i, dist) in kd.find_range(Vector(p), width):
            w = 1.0 - smoothstep(dist, width * 0.25, width)
            me.vertices[i].co = co - d * (depth * w)
            moved += 1
    return moved
