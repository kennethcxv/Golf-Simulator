"""CLOTH — the vocabulary the apparel needs, which hardsurface_lib does not have.

Everything in the shop's clothing was a box with a wobbled top face. The owner's
note is exact: "Folded cloth has soft edges, a visible fold line, and a slight
sag — not six flat faces." That is three separate properties and a box has none
of them, so a wobble on the top of a box was never going to fix it.

What the reference photographs actually show (ref/apparel):

  A RETAIL FOLD is a stack of leaves, not a solid. The front edge is a row of
  soft LIPS where the folded-under layers end, each one a rounded roll, and they
  do not line up. That row of lips is the single strongest cue that the thing is
  cloth -- see polo-folded-stack.jpg, where it reads even at thumbnail size.

  THE EDGES ARE ROLLS, not fillets. Fabric folded over has a radius roughly half
  the thickness of the layers it contains. On the trousers stack it is the whole
  read: a fat cylindrical roll at the fold end and a soft crumple at the other.

  THE TOP FACE SAGS AND CRUMPLES. Not a sine wave -- a low, broad dish with a
  couple of soft diagonal creases where the sleeves are underneath.

  A HUNG GARMENT is a surface, not a slab: it peaks at the two shoulder points
  over the hanger, hollows between them at the neck, falls almost straight, and
  flares slightly at the hem. Cross-sections are lens-shaped, wide and thin.

Units are YARDS, like the rest of the hero set.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hardsurface_lib as HS  # noqa: E402


# ---------------------------------------------------------------------------
# primitives


def superellipse(cx, cy, z, hw, hd, n=4.0, steps=48, rot=0.0):
    """A rounded rectangle as a closed ring. `n` is the corner squareness:
    2 is an ellipse, 4 a soft rounded rectangle, 8 nearly square."""
    pts = []
    for i in range(steps):
        a = 2 * math.pi * i / steps
        ca, sa = math.cos(a), math.sin(a)
        x = math.copysign(abs(ca) ** (2.0 / n), ca) * hw
        y = math.copysign(abs(sa) ** (2.0 / n), sa) * hd
        if rot:
            x, y = x * math.cos(rot) - y * math.sin(rot), x * math.sin(rot) + y * math.cos(rot)
        pts.append(Vector((cx + x, cy + y, z)))
    return pts


def loft(name, rings, close_bottom=True, close_top=True, smooth=True):
    n = len(rings[0])
    verts, faces = [], []
    for r in rings:
        verts.extend(r)
    for r in range(len(rings) - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append((r * n + i, r * n + j, (r + 1) * n + j, (r + 1) * n + i))
    if close_bottom:
        faces.append(tuple(range(n - 1, -1, -1)))
    if close_top:
        b = (len(rings) - 1) * n
        faces.append(tuple(range(b, b + n)))
    return HS.mesh_from(name, verts, faces, smooth=smooth)


def grid_surface(name, fn, nu=21, nv=17, smooth=True):
    """A quad surface from fn(u, v) -> Vector, u and v in [0, 1]."""
    verts, faces = [], []
    for j in range(nv):
        for i in range(nu):
            verts.append(fn(i / (nu - 1), j / (nv - 1)))
    for j in range(nv - 1):
        for i in range(nu - 1):
            a = j * nu + i
            faces.append((a, a + 1, a + nu + 1, a + nu))
    return HS.mesh_from(name, verts, faces, smooth=smooth)


# ---------------------------------------------------------------------------
# the folded garment


def folded_stack(prefix, centre, size, leaves=3, sag=0.0026, crease=0.0018,
                 squareness=7.5, steps=40, seed=0.0, gap=0.0009,
                 rollw=None, stagger=0.0026, wander=1.0, lean=0.0042,
                 twist=1.15, taper=0.62):
    """A folded garment: a stack of SEPARATE leaves, one closed shell each.

    The version this replaces was a single loft whose rings stepped out and
    back in at each leaf boundary. A step is not a layer. It has no thickness
    of its own, nothing behind it to cast into, and no edge you could pinch, so
    however much the top face was dished and creased the object stayed a
    moulded lid -- and four garments were parked on that one fault.

    `polo-rail-shop.jpg` says what a folded garment actually reads by, and it
    is not the top face: it is the EDGES. Every ply ends in a soft roll that
    takes a highlight along its crest, and under each roll is a dark slot where
    the next ply starts. Highlight, slot, highlight, slot, four times up the
    front. You cannot get a slot out of one surface -- it needs two surfaces
    with air between them.

    So each leaf is its own closed shell here: a flat plate whose whole
    perimeter turns over in a half-round roll of absolute width `rollw`, with
    `gap` of air above it. Same move that took the cap's crown from a dome to
    six panels.

    `assert_all_one_piece` is per PART, not per asset -- the cap ships six
    separate panel objects and passes it. Separate leaves were never the
    loose-shell fault that assertion catches; reading it that way is what
    forced the block in the first place.

    In the reference no two plies line up: the front edges wander in and out by
    the better part of a centimetre over a 300 mm garment. `wander` scales that
    and it is most of what stops the stack reading as machined.

    `lean` and `twist` accumulate up the pile and `taper` thins each ply from
    its fold to its cut end. Those three are v3: v2 had independent jitter
    around a fixed centre and a constant thickness, which is a column of
    boards however much noise is on it.

    `gap` is deliberately under `assert_assembly`'s 1.5 mm contact tolerance:
    plies resting on each other are a stack, plies floating apart are the loose
    part that check exists to catch, and the first cut of this failed it with
    "leaf0 touches nothing". The slot you see in the reference is not that gap
    -- it is the V-shaped groove where two rolls turn away from the contact
    plane, and it opens to a full leaf thickness at the rim on its own.

    Returns {"leaf0": obj, ...}, bottom leaf first.
    """
    cx, cy, cz = centre
    w, d, h = size
    exp = 2.0 / squareness
    th = (h - gap * (leaves - 1)) / float(leaves)
    half = th * 0.5
    # THE ROLL IS WIDER THAN THE PLY IS THICK, and that ratio is the whole
    # difference between cloth and an air mattress. Turning the edge over
    # through a true half-round -- roll radius equal to half the thickness --
    # gives every ply a uniform sausage all the way round, and the first render
    # of this came out as a stack of inflatable cushions. Cloth has no
    # stiffness to hold a tube: it tapers away over two or three times its own
    # thickness and then turns. Vertical stays at `half`, horizontal runs out
    # to `rollw`, so the edge is a flattened ellipse rather than a circle.
    if rollw is None:
        rollw = half * 2.25
    if rollw >= min(w, d) * 0.30:
        raise SystemExit(
            f"BUILD FAILED: folded_stack {prefix}: a {rollw * 1000:.1f} mm "
            f"edge roll leaves no flat on a {w * 1000:.0f} x {d * 1000:.0f} mm "
            f"leaf")

    # top pole, three flat rings, the roll down to the rim, the roll back
    # under, one coarse ring underneath, bottom pole. The underside is coarse
    # on purpose: it is never seen on any leaf but the bottom one, and the
    # roll is where every triangle earns its place.
    # The top sheet needs enough RADIAL rings to carry a crease. The first cut
    # had three, so the whole top face of the garment was four samples across
    # 300 mm and a 3.8 mm crease with two cycles in it could not be represented
    # at all -- the render came back with a glassy top and I would have gone
    # looking for the crease amplitude, which was never the problem.
    #
    # Only the TOP leaf's top sheet is ever seen: every leaf below it is
    # covered to within one roll width of its own rim, and no leaf's underside
    # shows at all bar the bottom one's. So the density goes where the pixels
    # are and the rest stay coarse, which pays for itself twice over.
    NR = 3
    DENSE = (0.18, 0.34, 0.48, 0.61, 0.72, 0.82, 0.91, 1.0)
    COARSE = (0.55, 0.85, 1.0)

    def profile(dense):
        pr = [("pole", 1.0)]
        pr += [("flat", f, 1.0) for f in (DENSE if dense else COARSE)]
        pr += [("roll", (s / NR) * (math.pi * 0.5), 1.0)
               for s in range(1, NR + 1)]
        pr += [("roll", (s / NR) * (math.pi * 0.5), -1.0)
               for s in range(NR - 1, -1, -1)]
        pr += [("flat", 0.62, -1.0), ("pole", -1.0)]
        return pr

    out = {}
    for k in range(leaves):
        ph = seed + k * 2.3999632          # golden angle: no two leaves agree
        z0 = cz + k * (th + gap) + half
        # THE STACK LEANS. Every folded pile in the reference does --
        # trousers-stack.jpg is the clearest: the top pair sits visibly forward
        # and left of the one under it, and the lean ACCUMULATES up the pile.
        # v2 gave each leaf independent jitter around a fixed centre, which
        # averages out to a column and reads as machined however much noise is
        # in it. Jitter is not the same thing as lean.
        #
        # So the offset and the twist are CUMULATIVE in k, with the direction
        # taken from the seed so no two garments lean the same way, and noise
        # on top of that rather than instead of it.
        lean_a = seed * 1.7
        lx = math.cos(lean_a) * lean
        ly = math.sin(lean_a) * lean
        sx = 1.0 - 0.013 * k + 0.011 * math.sin(ph * 1.7)
        sy = 1.0 - 0.009 * k + 0.013 * math.sin(ph * 2.3 + 1.1)
        ox = lx * k + 0.0021 * math.sin(ph * 3.1)
        oy = (stagger + ly) * k + 0.0024 * math.sin(ph * 1.3 + 2.0)
        rot = math.radians(twist * k + 1.7 * math.sin(ph * 0.9 + 0.4))
        cr, sr = math.cos(rot), math.sin(rot)
        top_leaf = (k == leaves - 1)
        prof = profile(top_leaf)

        # each leaf holds its corners a little differently
        ex = exp * (1.0 + 0.11 * math.sin(ph * 1.4))

        def boundary(a, _sx=sx, _sy=sy, _ph=ph, _ex=ex):
            ca, sa = math.cos(a), math.sin(a)
            wob = (1.0 + wander * (0.019 * math.sin(a * 2.0 + _ph)
                                   + 0.012 * math.sin(a * 5.0 - _ph * 1.7)
                                   + 0.008 * math.sin(a * 3.0 + _ph * 2.6)))
            return (math.copysign(abs(ca) ** _ex, ca) * w * 0.5 * _sx * wob,
                    math.copysign(abs(sa) ** _ex, sa) * d * 0.5 * _sy * wob)

        def rollat(a, _ph=ph):
            """A fold is not the same tightness the whole way round it."""
            return rollw * (1.0 + 0.34 * math.sin(a * 2.0 + _ph * 1.9)
                            + 0.19 * math.sin(a * 3.0 - _ph))

        def thickat(a, _ph=ph):
            """A PLY IS NOT THE SAME THICKNESS ALL THE WAY ROUND.

            It is fattest at the fold, where several layers of cloth turn over
            together, and thinnest at the cut ends where the fabric just stops.
            trousers-stack.jpg is unambiguous: every pair in it is a fat rounded
            roll at the left and tapers away to nothing at the right.

            v2 made each ply a constant-thickness slab, and a stack of
            constant-thickness slabs is a stack of boards.

            The fraction returned is a scale on `half`, and it must never
            exceed 1: leaf k's top sits at z0k + half*t(a) and leaf k+1's
            bottom at z0k + th + gap - half*t(a), so the two stay clear by
            gap + 2*half*(1 - t(a)). Where the ply is thin the slot between
            plies opens up, which is exactly where the reference is darkest.
            """
            back = 0.5 + 0.5 * math.sin(a)          # 1 at +y, 0 at -y
            wob = 0.06 * math.sin(a * 3.0 + _ph * 1.3)
            return max(0.35, min(1.0, taper + (1.0 - taper) * back + wob))

        verts, faces = [], []
        rings = []
        for entry in prof:
            if entry[0] == "pole":
                rings.append(("pole", len(verts), entry[1]))
                # the pole takes the AVERAGE taper, so the flat rings around it
                # are not pulled away from their own centre
                verts.append(Vector((cx + ox, cy + oy,
                                     z0 + half * entry[1] * (taper + 1.0) * 0.5)))
                continue
            start = len(verts)
            for i in range(steps):
                a = 2 * math.pi * i / steps
                bx, by = boundary(a)
                m = math.hypot(bx, by) or 1e-9
                rw = rollat(a)
                tk = thickat(a)
                if entry[0] == "flat":
                    # a fraction of the outline pulled in by one roll width
                    s = max(0.0, 1.0 - rw / m) * entry[1]
                    zf = entry[2] * tk
                else:
                    # the roll: inset runs out as the surface turns over, so
                    # the crest is the true outline and the width of the turn
                    # is an absolute distance instead of scaling with the
                    # radius the way a fractional inset would
                    theta = entry[1]
                    s = max(0.0, 1.0 - (rw * (1.0 - math.sin(theta))) / m)
                    zf = entry[2] * math.cos(theta) * tk
                x, y = bx * s, by * s
                xr, yr = x * cr - y * sr, x * sr + y * cr
                px, py = cx + ox + xr, cy + oy + yr
                u = xr / (w * 0.5)
                q = yr / (d * 0.5)
                # LEAF k's TOP SHEET AND LEAF k+1's BOTTOM SHEET MUST MOVE
                # TOGETHER. Every leaf's lowest point sits exactly `gap` above
                # the one below's highest, so as long as any vertical
                # displacement is the SAME field for all of them, no two leaves
                # can meet whatever their outlines do -- non-intersection is
                # structural rather than something a gap has to be tuned to buy.
                # The first cut gave each leaf its own droop scale and its own
                # crease phase, which is up to 2.9 mm of differential across a
                # 0.9 mm gap: the leaves would have laced through each other.
                #
                # A stack of cloth dishes as ONE body anyway, and it rumples as
                # one, so a shared field is also the honest shape.
                dfac = 1.0
                if k == 0:
                    dfac = 0.5 + 0.5 * zf     # the bottom ply lies on a shelf
                droop = (1.0 - min(1.0, (u * u + q * q) * 0.80)) * sag * dfac
                rumple = crease * 0.30 * (math.sin(1.9 * u + 1.4 * q + seed)
                                          + 0.5 * math.sin(3.3 * q - 1.1 * u
                                                           + seed * 2)) * 0.5
                pz = z0 + half * zf - droop + rumple
                # The top face of the stack is the only one anybody sees, so it
                # gets the creases the sleeves folded underneath put in it.
                # Nothing sits above it, so this one may differ freely.
                if top_leaf and zf > 0.0:
                    # 2.2 rad across the whole width is 0.7 of a cycle -- a
                    # broad swell, not a crease, and smooth-shaded it turned
                    # the top face glassy. A crease reads by how FAST the
                    # normal turns, so the wavelength matters more than the
                    # amplitude does.
                    pz -= crease * zf * 0.5 * (
                        math.sin(4.6 * u + 2.4 * q + ph)
                        + 0.55 * math.sin(5.4 * q - 2.6 * u + ph * 2))
                verts.append(Vector((px, py, pz)))
            rings.append(("ring", start, entry[-1]))

        for r in range(len(rings) - 1):
            kind0, s0, _ = rings[r]
            kind1, s1, _ = rings[r + 1]
            if kind0 == "pole":
                for i in range(steps):
                    faces.append((s0, s1 + i, s1 + (i + 1) % steps))
            elif kind1 == "pole":
                for i in range(steps):
                    faces.append((s1, s0 + (i + 1) % steps, s0 + i))
            else:
                for i in range(steps):
                    j = (i + 1) % steps
                    faces.append((s0 + i, s1 + i, s1 + j, s0 + j))

        out[f"leaf{k}"] = HS.mesh_from(f"{prefix}_Leaf{k}", verts, faces,
                                       smooth=True)
    return out


def _folded_removed(name, centre, size, leaves=3, sag=0.0026, crease=0.0018,
                    squareness=7.5, steps=64, seed=0.0):
    """A folded garment: leaves stacked into one closed surface.

    Built as a single loft whose rings step OUT and back IN at each leaf
    boundary, so the front edge grows the row of soft lips the reference has,
    and the whole thing is still one watertight piece -- `assert_all_one_piece`
    is on now and a garment made of separate leaves would be exactly the
    loose-shell fault it exists to catch.

    The top face carries a broad dish plus two diagonal creases, which is what
    the sleeves folded underneath actually do to it.
    """
    cx, cy, cz = centre
    w, d, h = size
    rings = []
    LAYERS = 30
    for k in range(LAYERS + 1):
        t = k / LAYERS
        # The rolled top and bottom edges. The first version used a sine that
        # went NEGATIVE at mid height, so the ring inverted and the garment had
        # an hourglass pinch through its middle -- a profile has to be checked
        # across its whole domain, not at its ends.
        edge = min(t, 1.0 - t)
        roll = min(1.0, (edge / 0.13) ** 0.62)
        leaf = min(leaves - 1, int(t * leaves))
        ring = []
        for i in range(steps):
            a = 2 * math.pi * i / steps
            ca, sa = math.cos(a), math.sin(a)
            # THE LIPS ARE NOT A RING. Concentric steps all the way round read
            # as a moulded lid, which is exactly what the first render looked
            # like. On a real fold the leaves end at the FRONT and the SIDES;
            # the folded edge at the back is clean.
            # THE LIPS ARE AT THE FRONT EDGE ONLY. The previous bias gave the
            # sides 88% of the step and the BACK still 20%, so the leaves
            # stepped in all the way round and the garment came out reading as
            # a moulded lid with three concentric rings -- which is exactly
            # what the folded polo's render showed.
            #
            # On the shop shelf (polo-rail-shop.jpg, a dozen stacks of it) the
            # sides and the back of a folded garment are FOLDS: smooth, single
            # curves. Only the front is a cut edge with layers ending at it,
            # and that row of soft lips is the whole cue.
            front = 0.5 - 0.5 * sa
            bias = front ** 1.7
            # and they do not line up: each leaf wanders a little around itself
            wander = (1.0 + 0.017 * math.sin(a * 2.0 + leaf * 2.1 + seed)
                      + 0.011 * math.sin(a * 5.0 - leaf * 1.3 + seed * 2)
                      + 0.008 * math.sin(a * 3.0 + leaf * 4.7 - seed))
            sc = (0.93 + 0.07 * roll) * (1.0 - 0.105 * leaf * bias) * wander
            x = math.copysign(abs(ca) ** (2.0 / squareness), ca) * w * 0.5 * sc
            y = math.copysign(abs(sa) ** (2.0 / squareness), sa) * d * 0.5 * sc
            ring.append(Vector((cx + x, cy + y, cz + h * t)))
        rings.append(ring)
    # THE TOP FACE NEEDS INTERIOR GEOMETRY. Capping the loft with one n-gon
    # left the whole top face flat and vertex-free, so the sag and the creases
    # below had nothing to displace and `top_z` could not even find a surface
    # there. Cloth is soft in the middle, which is where a cap ring has to be.
    cap = []
    for c, dip in ((0.84, 0.10), (0.62, 0.22), (0.38, 0.32), (0.15, 0.38)):
        ring = []
        for i, base in enumerate(rings[-1]):
            ring.append(Vector((cx + (base.x - cx) * c,
                                cy + (base.y - cy) * c,
                                cz + h - sag * dip)))
        cap.append(ring)
    allr = rings + cap
    n = steps
    verts, faces = [], []
    for r in allr:
        verts.extend(r)
    for r in range(len(allr) - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append((r * n + i, r * n + j, (r + 1) * n + j, (r + 1) * n + i))
    faces.append(tuple(range(n - 1, -1, -1)))          # the flat underside
    centre_i = len(verts)
    verts.append(Vector((cx, cy, cz + h - sag * 0.40)))
    base = (len(allr) - 1) * n
    for i in range(n):
        faces.append((base + i, base + (i + 1) % n, centre_i))
    obj = HS.mesh_from(name, verts, faces, smooth=True)

    # sag and crease the top. Working on the finished mesh keeps it one piece;
    # displacing the ring positions instead pulled the side walls with it and
    # the garment leaned.
    top = cz + h
    for v in obj.data.vertices:
        co = v.co
        if co.z < top - h * 0.34:
            continue
        u = (co.x - cx) / (w * 0.5)
        q = (co.y - cy) / (d * 0.5)
        dish = (1.0 - min(1.0, (u * u + q * q) * 0.75)) * sag
        fold = crease * (math.sin(2.2 * u + 1.1 * q + seed)
                         + 0.55 * math.sin(4.1 * q - 1.7 * u + seed * 2)) * 0.5
        blend = min(1.0, max(0.0, (co.z - (top - h * 0.34)) / (h * 0.34)))
        v.co.z -= (dish + fold) * blend
    obj.data.update()
    return obj


def fold_line(name, start, end, radius, sides=10, sink=0.45):
    """The soft roll along a fold, half-sunk into the garment it belongs to."""
    a, b = Vector(start), Vector(end)
    axis = (b - a)
    length = axis.length
    axis.normalize()
    up = Vector((0, 0, 1))
    side = axis.cross(up)
    if side.length < 1e-6:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(axis).normalized()
    rings = []
    STEPS = 9
    for s in range(STEPS + 1):
        t = s / STEPS
        c = a + axis * (length * t)
        # taper the ends so the roll dies into the surface instead of stopping
        r = radius * math.sin(math.pi * (0.12 + 0.76 * t)) ** 0.55
        ring = []
        for i in range(sides):
            ang = 2 * math.pi * i / sides
            ring.append(c + side * (math.cos(ang) * r)
                        + up * (math.sin(ang) * r - r * sink))
        rings.append(ring)
    return loft(name, rings, smooth=True)


# ---------------------------------------------------------------------------
# the hung garment


def hung_body(spec):
    """A hung garment's FRONT and BACK panels, as the polo hung is built.

    `draped()` makes one closed lens-section tube, and a tube has no side seam,
    no shoulder seam and no armhole -- the three lines that tell an eye it is a
    shirt. Every garment built on it reads as a soft slab with sleeves stuck
    to it, which is exactly what the tee hung and the hoodie hung still do.

    This is the polo's panel construction, generalised. It is a separate
    function rather than a refactor of build_polo because that polo is PASS
    after ten rounds and is not worth risking to save a duplicate; if the two
    ever need to agree, this is the one to keep.

    Returns (panel_fn, side_u, top_edge). `panel_fn(front, u, v, seed)` takes u
    from -1 to +1 across the body and v from 0 at the shoulder to 1 at the hem,
    and y is ZERO at u = +/-1 by construction, so the two panels MEET at the
    side seams instead of being halves of a tube that never had one.
    """
    sh = spec["sh_half"]
    length = spec["length"]
    neck_half = spec["neck_half"]
    drop = spec["shoulder_drop"]
    scoop_f = spec["scoop_front"]
    scoop_b = spec["scoop_back"]
    prof = spec["width_profile"]
    d_chest = spec["depth_chest"]
    d_hem = spec["depth_hem"]
    hang_u = spec.get("hanger_u", 0.845)
    z_sh = spec.get("shoulder_z", 0.0)
    flare = spec.get("hem_side_drop", 0.0090)

    def table(v):
        for i in range(len(prof) - 1):
            a, b = prof[i], prof[i + 1]
            if v <= b[0]:
                t = (v - a[0]) / (b[0] - a[0]) if b[0] > a[0] else 0.0
                t = t * t * (3.0 - 2.0 * t)
                return a[1] + (b[1] - a[1]) * t
        return prof[-1][1]

    def top_edge(u, front):
        a = abs(u)
        if a >= neck_half:
            t = (a - neck_half) / (1.0 - neck_half)
            return z_sh - drop * (t ** 1.25)
        sc = scoop_f if front else scoop_b
        return z_sh - sc * (1.0 - (a / neck_half) ** 2) ** 0.85

    def side_u(t01):
        """Sample CLUSTERED at the side seams.

        The section arrives at the seam with a vertical tangent, so the panels
        meet ROUNDED -- but sampled uniformly the last step collapses a fifth
        of the depth into one facet and it reads as a hard crease. sin() puts
        the vertices where the curve is tight.
        """
        return math.sin((-1.0 + 2.0 * t01) * math.pi * 0.5)

    def panel_fn(front, u, v, seed=0.0):
        w = sh * table(v)
        x = u * w
        # The top edge's shape must NOT reach the hem: cloth hanging free
        # forgets the line it was cut on within a hand's width, and carrying it
        # all the way down puts the neck scoop and shoulder drop into the hem
        # as a scallop -- which is what both of these still have.
        settle = min(1.0, v / 0.32) ** 1.15
        z = top_edge(u, front) * (1.0 - settle) - length * v
        z += 0.0060 * math.exp(-(((abs(u) - hang_u) / 0.145) ** 2)) * max(
            0.0, 1.0 - v / 0.22) ** 1.3
        z -= flare * (abs(u) ** 3.0) * (v ** 2.2)
        open_up = 0.30 + 0.70 * min(1.0, (v / 0.34)) ** 1.4
        if abs(u) < neck_half:
            open_up += 0.58 * (1.0 - (abs(u) / neck_half) ** 2) * max(
                0.0, 1.0 - v / 0.22)
        depth = (d_chest + (d_hem - d_chest) * v) * open_up
        bow = math.cos(u * math.pi * 0.5) ** 0.72
        fold = 0.0042 * math.sin(u * 5.2 + seed) * min(1.0, v * 2.6)
        y = (depth * bow + fold) * (-1.0 if front else 1.0)
        return Vector((x, y, z))

    return panel_fn, side_u, top_edge


def draped(name, shoulder_z, width, hem_width, length, depth, centre=(0, 0),
           neck=0.052, shoulder_drop=0.010, nu=25, nv=19, wobble=0.0022):
    """A shirt hanging from a hanger.

    A closed lens-section surface: peaks at the two shoulder points, dips at the
    neck between them, falls with a slight A-flare and a soft wobble down the
    front and back. The section is a lens rather than a rectangle because cloth
    with nothing in it has no corners.
    """
    cx, cy = centre

    def surf(u, v):
        # u around the section (0..1 wraps front to back), v down the garment
        ang = 2 * math.pi * u
        halfw = (width * (1 - v) + hem_width * v) * 0.5
        # shoulder line: two peaks with a neck hollow between them
        sx = math.cos(ang)
        peak = shoulder_z - shoulder_drop * (1.0 - abs(sx) ** 1.6)
        hollow = neck * max(0.0, 1.0 - (abs(sx) / 0.42) ** 2) if abs(sx) < 0.42 else 0.0
        top = peak - hollow
        z = top - length * v
        # lens section, fuller at the hem
        thick = depth * (0.72 + 0.36 * v) * 0.5
        y = math.sin(ang) * thick * (0.55 + 0.45 * math.sin(math.pi * min(1.0, v * 1.4 + 0.2)))
        x = sx * halfw
        # vertical folds
        f = wobble * math.sin(ang * 3.0 + v * 5.5) * min(1.0, v * 2.2)
        return Vector((cx + x + f * 0.4, cy + y + f, z))

    # THE HEM IS ROLLED, not capped flat. holes_fill closes the bottom with one
    # n-gon, which renders as a hard hexagonal point -- the shape the review
    # called "a hard hexagon at the bottom". Two extra rings tuck the section in
    # so the hem closes as a roll.
    def surf2(u, v):
        if v <= 1.0 - 2e-6:
            return surf(u, min(v, 1.0))
        return surf(u, 1.0)

    verts, faces = [], []
    NV = nv + 3
    for j in range(NV):
        if j < nv:
            vv = j / (nv - 1)
            shrink = 1.0
        else:
            vv = 1.0
            # never 0.0: a ring collapsed to a point makes degenerate faces
            # and the mesh stops being closed, which assert_assembly then
            # refuses to measure at all.
            shrink = (0.76, 0.46, 0.20)[j - nv]
        for i in range(nu):
            pnt = surf(i / (nu - 1), vv)
            if shrink < 1.0:
                axis = Vector((cx, cy, pnt.z - 0.004 * (1.0 - shrink)))
                pnt = axis + (pnt - Vector((cx, cy, pnt.z))) * shrink
            verts.append(pnt)
    for j in range(NV - 1):
        for i in range(nu - 1):
            a = j * nu + i
            faces.append((a, a + 1, a + nu + 1, a + nu))
    obj = HS.mesh_from(name, verts, faces, smooth=True)
    _weld_and_cap(obj)
    return obj


def _weld_and_cap(obj, distance=1e-4):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=distance)
    holes = [e for e in bm.edges if len(e.link_faces) == 1]
    if holes:
        bmesh.ops.holes_fill(bm, edges=holes)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def sleeve(name, root, direction, length, r0, r1, droop=0.35, sides=12, steps=8):
    """A sleeve: a tapered tube that falls as it goes out."""
    root = Vector(root)
    d = Vector(direction).normalized()
    rings = []
    for s in range(steps + 1):
        t = s / steps
        c = root + d * (length * t)
        c.z -= droop * length * t * t
        r = r0 * (1 - t) + r1 * t
        up = Vector((0, 0, 1))
        side = d.cross(up)
        if side.length < 1e-6:
            side = Vector((1, 0, 0))
        side.normalize()
        up = side.cross(d).normalized()
        ring = []
        for i in range(sides):
            a = 2 * math.pi * i / sides
            ring.append(c + side * (math.cos(a) * r) + up * (math.sin(a) * r * 0.82))
        rings.append(ring)
    return loft(name, rings, smooth=True)


def collar(name, centre, halfw, depth, height, thickness=0.0075, sides=42,
           point_drop=0.62, sink=0.0022, root=0.0038, gap=0.62, fall=0.5):
    """A polo collar: ONE band around the neck with a V left open at the front,
    whose two ends are the collar points.

    Two earlier attempts got the topology wrong. A continuous arch has no V and
    read as the handle on a lid. Two mirrored leaves left a gap at the BACK as
    well as the front, and were two shells. A collar is a band with one opening,
    and its ends are the points -- so it is a single strip swept from just right
    of centre-front, all the way round the back, to just left of centre-front.

    `gap` is the angle (radians) left open at the front. Near each end the band
    drops, widens and folds over, which is what makes a collar read as folded
    fabric and not as a standing rib.
    """
    cx, cy, cz = centre
    half_gap = gap * 0.5
    verts, faces = [], []
    for i in range(sides):
        t = i / (sides - 1)
        th = half_gap + (2 * math.pi - gap) * t
        x = math.sin(th) * halfw
        y = -math.cos(th) * depth
        # how close this section is to one of the two free ends
        near = min(th - half_gap, (2 * math.pi - half_gap) - th)
        tip = max(0.0, 1.0 - near / 0.95) ** 1.8
        z = cz + height * (1.0 - point_drop * tip)
        stand = height * (0.52 - 0.34 * tip)
        # out = away from the neck, so the collar flares as it falls
        out = 1.0 + 0.16 * tip
        rows = ((0.00, 0.00, -root - height * 0.10),      # rooted in the shirt
                (0.18, 0.35, stand * 0.60),               # the stand
                (0.70, 1.05, stand * 1.00),               # the fold
                (1.00, 1.60, stand * 0.62 - fall * height * tip))
        for (fx, fy, oz) in rows:
            verts.append(Vector((cx + x * (out + 0.10 * fx),
                                 cy + y * (out + 0.10 * fx) + thickness * fy
                                 * (1.0 if abs(math.sin(th)) < 0.98 else 1.0),
                                 z + oz - sink)))
    # A CLOSED tube: the four rows wrap round as a cross-section, so the band
    # is a solid with thickness rather than an open strip. An open strip is not
    # a volume, and every inside/outside test in the library is a parity test --
    # asked about an open mesh it reported the placket 47 mm inside the collar.
    per = 4
    for i in range(sides - 1):
        for k in range(per):
            a, b = i * per + k, i * per + (k + 1) % per
            faces.append((a, b, b + per, a + per))
    faces.append((0, 1, 2, 3))
    base = (sides - 1) * per
    faces.append((base + 3, base + 2, base + 1, base))
    return HS.mesh_from(name, verts, faces, smooth=True)


def collar_flat(name, centre, halfw=0.052, back=0.030, forward=0.030,
                spread=1.62, reach=0.030, thick=0.0062, lift=0.0155,
                sides=33, rows=7):
    """A polo collar as it lies on a FOLDED shirt: splayed flat, points spread.

    A standing ring is the wrong object here. Fold a polo and the collar is
    pressed down onto the body in a wide shallow V with the two points lying on
    the fabric -- that is what the shelf photograph shows, and it is the only
    part of a folded polo you can identify from across a shop. Modelled as a
    ring it rendered as a handbag handle twice.

    Built as a strip between a NECK curve and a FREE-EDGE curve, nearly flat,
    lifting slightly along the fold and settling again at the points.

    THE FREE EDGE IS NOT A SMOOTH ARC. That is what made the third attempt read
    as a handbag handle again: both edges were parabolas, so the whole collar
    was one crescent and a crescent lying on a shirt is a strap. What tells an
    eye "collar" is the pair of POINTS and the notch between them -- two
    straight runs meeting at a corner, with the placket starting in the gap.
    So the free edge's forward reach is a piecewise profile with an actual
    corner in it at |s| = SP, and the notch at the centre is what the V is.
    """
    cx, cy, cz = centre
    SP = 0.30                      # where the points are, across the collar

    def reach_at(a):
        """Forward reach of the free edge, as a fraction of `reach`."""
        if a < 0.09:               # the notch: the two points nearly meet
            return 0.26 + 0.45 * (a / 0.09)
        if a < SP:                 # front edge of the leaf, out to the point
            t = (a - 0.09) / (SP - 0.09)
            return 0.71 + 0.29 * t
        t = (a - SP) / (1.0 - SP)  # and back to the shoulder, past the corner
        return 1.0 - 0.86 * (t ** 0.78)

    # A CORNER NEEDS A VERTEX ON IT. Sampling s uniformly puts the point
    # somewhere inside a span and rounds it off into the blob this is trying to
    # stop being, so the breakpoints are sampled exactly and the spans between
    # them are filled.
    breaks = (-1.0, -SP, -0.09, 0.09, SP, 1.0)
    per = max(2, (sides - 1) // (len(breaks) - 1) + 1)
    svals = []
    for lo, hi in zip(breaks[:-1], breaks[1:]):
        for q in range(per):
            svals.append(lo + (hi - lo) * q / per)
    svals.append(1.0)
    sides = len(svals)

    verts, faces = [], []
    for s in svals:
        a = abs(s)
        inner = Vector((cx + s * halfw, cy + back * (1.0 - 0.35 * s * s), cz))
        outer = Vector((cx + s * halfw * spread,
                        cy + back - forward * 0.35 - reach * reach_at(a), cz))
        for r in range(rows):
            t = r / (rows - 1)
            p = inner.lerp(outer, t)
            # The band folds over: a crest partway across, then the fall to the
            # free edge, which settles onto the shirt at the points.
            crest = math.sin(math.pi * min(1.0, t * 0.92)) ** 0.62
            rise = lift * crest * (1.0 - 0.55 * a ** 1.6)
            # the free edge lifts off the cloth a little between the points --
            # a collar never lies perfectly down, and the shadow under it is
            # most of what separates it from a printed shape
            if t > 0.72:
                rise += lift * 0.30 * ((t - 0.72) / 0.28) ** 1.4 * max(
                    0.0, 1.0 - (a / 0.55) ** 2)
            p.z = cz + rise
            verts.append(p)
    for i in range(sides - 1):
        for r in range(rows - 1):
            b = i * rows + r
            faces.append((b, b + 1, b + rows + 1, b + rows))
    obj = HS.mesh_from(name, verts, faces, smooth=True)
    mod = obj.modifiers.new("Thick", "SOLIDIFY")
    mod.thickness = thick
    mod.offset = -0.4
    mod.use_rim = True
    return HS.apply_mods(obj)


def folded_ribbon(prefix, centre, size, plies=4, squareness=7.5,
                  xsteps=22, seed=0.0, gap=0.0011, sag=0.0030,
                  crease=0.0032, lean=0.0040, wander=1.0, cut_frac=0.34):
    """A folded garment as ONE PIECE OF CLOTH THAT HAS BEEN FOLDED.

    v1 was a lofted block. v2 made it a stack of separate closed pillows, which
    is why the plies finally read -- but a pillow has two free edges and a real
    ply has ONE. Fold a shirt and the layers are JOINED, alternately at the
    front and at the back, in a concertina. That is the difference between
    cloth that has been folded and a shape that resembles it, and it is what
    the owner meant by "approximated from the outside".

    You can see it in the reference the moment you look for it. In
    trousers-stack.jpg every pair is a fat rounded U-TURN at the left and a
    tapering cut end at the right, and the pair above it turns the other way.
    A stack of separate slabs cannot do that: it has the same edge at both
    ends, so it reads as boards however much wander is on it.

    CONSTRUCTION. The cross-section in (y, z) is a single closed curve: a
    centreline that runs the depth of the garment, turns through a half circle
    at one end, runs back at the next level down, turns at the other end, and
    so on -- offset either side by half the cloth thickness and capped at the
    two cut ends. That section is then swept across x, scaled by the garment's
    own rounded-rectangle outline so the corners round off.

    One closed shell, so `assert_all_one_piece` is satisfied by construction and
    there is no leaf-to-leaf clearance to police: the plies cannot lace through
    each other because they are the same surface.

    `cut_frac` is how far the cut ends fall short of the fold ends, because a
    garment folded in three does not land its raw edge flush with its fold.
    """
    cx, cy, cz = centre
    w, d, h = size
    exp = 2.0 / squareness
    t = (h - gap * (plies - 1)) / float(plies)   # one ply's cloth thickness
    step = t + gap                                # centreline pitch

    # ---- the centreline of the folded ribbon, in (y, z)
    # y runs -d/2 (front) to +d/2 (back); the ribbon starts at the BOTTOM and
    # works up, so the top ply is the one the collar and the print sit on.
    half_d = d * 0.5
    cut_in = half_d * cut_frac
    path = []
    for i in range(plies):
        zc = -h * 0.5 + t * 0.5 + i * step
        # THE FOLD FACES THE SHOPPER. Alternating from the back put only one
        # U-turn at the front of a four-ply garment and left the raw cut ends
        # facing out. Every stack in the reference is the other way round: the
        # fat rounded folds are what you see from the aisle and the cut edges
        # are tucked to the back.
        turn_at_back = (i % 2 == 1)
        # a ply runs from its cut end (or its incoming turn) to the far end
        if i == 0:
            y_from = -half_d + cut_in            # the first raw edge
        else:
            y_from = half_d if not turn_at_back else -half_d
        y_to = half_d if turn_at_back else -half_d
        if i == plies - 1:
            y_to = (half_d - cut_in) if turn_at_back else (-half_d + cut_in)
        path.append((y_from, y_to, zc))

    def centreline():
        """Dense samples of the centreline, front-cut end to back-cut end."""
        pts = []
        for i, (y0, y1, zc) in enumerate(path):
            n = max(4, int(abs(y1 - y0) / (d * 0.115)))
            for k in range(n + 1):
                f = k / n
                pts.append(Vector((0.0, y0 + (y1 - y0) * f, zc)))
            if i < plies - 1:
                # the U-turn: a half circle of radius step/2 at the far end
                nxt = path[i + 1]
                r = step * 0.5
                yc = y1
                sgn = 1.0 if y1 > 0 else -1.0
                for k in range(1, 7):
                    a = math.pi * (k / 7.0)
                    pts.append(Vector((0.0,
                                       yc + sgn * math.sin(a) * r,
                                       zc + r - math.cos(a) * r)))
        return pts

    line = centreline()

    # ---- offset it either side by half the cloth, and cap the two cut ends
    sect = []
    n_line = len(line)
    for i, q in enumerate(line):
        a = line[max(0, i - 1)]
        b = line[min(n_line - 1, i + 1)]
        tan = (b - a)
        if tan.length < 1e-9:
            tan = Vector((0.0, 1.0, 0.0))
        tan.normalize()
        nrm = Vector((0.0, -tan.z, tan.y))       # in-plane perpendicular
        sect.append((q, nrm))

    upper = [q + n * (t * 0.5) for q, n in sect]
    lower = [q - n * (t * 0.5) for q, n in sect]

    def cap(q, n, out_dir):
        """A raw edge is a rounded hem, not a square cut."""
        return [q + n * (t * 0.5 * math.cos(a)) + out_dir * (t * 0.5 * math.sin(a))
                for a in (math.pi * 0.25, math.pi * 0.5, math.pi * 0.75)]

    q0, n0 = sect[0]
    d0 = (line[0] - line[1]).normalized()
    q1, n1 = sect[-1]
    d1 = (line[-1] - line[-2]).normalized()
    ring2d = (list(upper) + cap(q1, n1, d1) + list(reversed(lower))
              + cap(q0, -n0, d0))

    # WHICH POINTS ARE A RAW EDGE. A fold is a machine-straight line -- cloth
    # turns over on itself and stays put -- but a CUT edge never is: it is the
    # loose end of the garment and it wanders. The top ply's cut came out as a
    # dead straight line with a chamfer on it, which is most of why the folded
    # trousers read as a lid sitting on rolls.
    #
    # So the two raw ends are tagged here, at construction, rather than guessed
    # at from a point's position later: a mid-ply point passes through the same
    # y as the cut and would be caught by any positional test.
    L = len(upper)
    edge_w = [0.0] * len(ring2d)
    REACH = 5
    for j in range(REACH):
        f = (1.0 - j / float(REACH)) ** 1.4
        edge_w[j] = max(edge_w[j], f)                       # start of upper
        edge_w[L - 1 - j] = max(edge_w[L - 1 - j], f)       # end of upper
        edge_w[L + 3 + j] = max(edge_w[L + 3 + j], f)       # end of lower
        edge_w[2 * L + 2 - j] = max(edge_w[2 * L + 2 - j], f)
    for j in range(3):                                      # the two caps
        edge_w[L + j] = 1.0
        edge_w[2 * L + 3 + j] = 1.0

    # ---- sweep the section across x, scaled by the garment's own outline
    NS = len(ring2d)

    # THE X ENDS ARE TUCKED, NOT CAPPED. The sweep used to close each end with
    # a single n-gon over the whole section -- 164 sides -- and at the low
    # angle the brief asks for that cap is a flat vertical wall with a step
    # per ply. It read as a staircase, which is F1 on the first comparison
    # frame, and assert_no_flat_caps names it in one line.
    #
    # Instead the section shrinks toward its own centroid over three stations
    # and finishes on a pole, so the garment turns over at its ends the way
    # the cloth actually does.
    cy2d = sum(q.y for q in ring2d) / NS
    cz2d = sum(q.z for q in ring2d) / NS
    # F1: three short stations still read as a stepped wall. The tuck has to
    # travel far enough in x to be a turn rather than a chamfer.
    TUCK = ((0.94, 1.2), (0.80, 2.6), (0.58, 3.8), (0.30, 4.7), (0.12, 5.2))
    stations = ([(-1.0 - 0.026 * push, sc) for sc, push in reversed(TUCK)]
                + [(-1.0 + 2.0 * xi / (xsteps - 1.0), 1.0)
                   for xi in range(xsteps)]
                + [(1.0 + 0.026 * push, sc) for sc, push in TUCK])

    verts, faces = [], []
    poles = []
    for u, shrink in stations:
        # rounded-rectangle footprint: full width across the middle, tucking in
        # at the two ends
        # THE FOOTPRINT IS A ROUNDED RECTANGLE, and it has to be computed as
        # one. The first cut raised u to the superellipse exponent and THEN to
        # the eighth, double-counting the taper: the depth was already down to
        # 90% by u = 0.5 and the whole garment came out a lens. A superellipse
        # |X|^n + |Y|^n = 1 gives the half-depth directly, and at n = 7.5 it
        # holds full depth to u = 0.9 and only rounds off in the last tenth.
        # CLAMPED. The tuck stations sit just past u = +/-1, where
        # 1 - |u|^7.5 goes negative and clamps to zero -- which collapses the
        # section flat in y and turns the tuck back into the wall it was meant
        # to replace. The footprint is only defined on the garment.
        uc = max(-1.0, min(1.0, u))
        k = max(0.0, 1.0 - abs(uc) ** squareness) ** (1.0 / squareness)
        x = u * w * 0.5
        wob = 1.0 + wander * (0.020 * math.sin(u * 3.1 + seed)
                              + 0.012 * math.sin(u * 6.7 - seed * 1.7))
        # the pile leans, and it leans MORE the higher up you are
        for si2, p2raw in enumerate(ring2d):
            ew = edge_w[si2] * shrink
            p2 = Vector((0.0,
                         cy2d + (p2raw.y - cy2d) * shrink,
                         cz2d + (p2raw.z - cz2d) * shrink))
            zt = (p2.z + h * 0.5) / max(1e-6, h)        # 0 bottom, 1 top
            # THE PILE SAGS AT ITS PERIMETER, not just across x. Sagging only
            # in x left the top ply a flat plate with a bevelled edge sitting
            # on the rolls -- it reads as a lid, which is what the trousers
            # looked like. Cloth falls away at every edge.
            #
            # It has to be the SAME field for every ply or the surface folds
            # through itself: the plies are 1.1 mm apart and this is several
            # times that. Applied to all of them the whole pile dishes and the
            # spacing is untouched.
            ry = (p2.y / (d * 0.5))
            dome = 1.0 - min(1.0, (u * u * 0.62 + ry * ry * 0.72))
            droop = dome * sag * 1.9
            rumple = crease * 0.30 * math.sin(2.1 * u + 3.3 * p2.y / d + seed)
            # the raw edge wanders in y and dips a little as it goes
            ewob = ew * (0.0062 * math.sin(u * 5.3 + seed * 2.1)
                         + 0.0034 * math.sin(u * 11.7 - seed))
            verts.append(Vector((
                cx + x + lean * zt * math.cos(seed * 1.7),
                cy + p2.y * k * wob + ewob
                + lean * zt * math.sin(seed * 1.7),
                cz + h * 0.5 + p2.z - droop + rumple
                - ew * 0.0016 * (1.0 + math.sin(u * 4.1 + seed)))))
    nst = len(stations)
    for xi in range(nst - 1):
        for si in range(NS):
            a = xi * NS + si
            b = xi * NS + (si + 1) % NS
            faces.append((a, b, b + NS, a + NS))
    # a pole at each end, so the closure is triangles and there is no n-gon
    x0 = stations[0][0] * w * 0.5 - 0.0060
    x1 = stations[-1][0] * w * 0.5 + 0.0060
    for xend, ring0, flip in ((x0, 0, False), (x1, (nst - 1) * NS, True)):
        c = len(verts)
        verts.append(Vector((cx + xend, cy + cy2d, cz + h * 0.5 + cz2d)))
        for si in range(NS):
            sj = (si + 1) % NS
            faces.append((c, ring0 + sj, ring0 + si) if not flip
                         else (c, ring0 + si, ring0 + sj))
    obj = HS.mesh_from(f"{prefix}_Cloth", verts, faces, smooth=True)
    smooth_by_angle(obj, 46.0)

    # THE BUILDER HANDS OUT ITS OWN TOP SURFACE. top_z() answers with the
    # NEAREST VERTEX above a height cut, and with six plies stacked inside one
    # shell the nearest vertex to a point can easily be on the ply BELOW the
    # top one -- 7 mm low, which is enough to bury a collar completely. That is
    # exactly what happened: the collar, placket and buttons all disappeared
    # the moment the ply count went from four to six, and nothing failed,
    # because they are allow-listed to interpenetrate the cloth.
    #
    # This is computed from the same expressions that built the surface, so it
    # cannot drift from it.
    z_top = path[-1][2] + t * 0.5

    def top_at(x, y):
        u = max(-1.0, min(1.0, (x - cx) / (w * 0.5)))
        zt = (z_top + h * 0.5) / max(1e-6, h)
        droop = (1.0 - min(1.0, (u * u) * 0.80)) * sag * (0.25 + 0.75 * zt)
        rumple = crease * 0.30 * math.sin(2.1 * u + 3.3 * (y - cy) / d + seed)
        return cz + h * 0.5 + z_top - droop + rumple

    return {"cloth": obj, "top_at": top_at}


def top_leaf(parts):
    """The leaf everything else sits on -- collar, placket, band, print.

    Named rather than indexed, because `p["leaf3"]` in a builder that later
    changes its leaf count is a silent wrong answer: top_z would happily
    measure the middle of the stack and put the collar inside it.
    """
    ns = sorted((k for k in parts if k.startswith("leaf")),
                key=lambda k: int(k[4:]))
    if not ns:
        raise SystemExit("BUILD FAILED: top_leaf: no parts named leafN")
    return parts[ns[-1]]


def assert_leaves_clear(parts, label, tol=0.0006):
    """Leaves may TOUCH. They may not lace through one another.

    THE GENERAL ASSEMBLY CHECK DOES NOT COVER THIS and the control is what
    found it: driven 4 mm into each other the leaves sailed through, because
    the shared ceiling is MAX_SEAT_DEPTH at 6 mm and these plies are only
    9.9 mm thick. Six millimetres of overlap is most of a ply -- for this one
    part the general limit is meaningless, so it gets its own.
    """
    leaves = {k: v for k, v in parts.items() if k.startswith("leaf")}
    if len(leaves) < 2:
        raise SystemExit(
            f"BUILD FAILED: {label} -- found {len(leaves)} parts named leafN, "
            f"so this check measured nothing. Renaming the leaves must not be "
            f"a way to switch it off.")
    HS.assert_assembly(leaves, label, max_depth=tol)


def edge_y(objs, x, sign, window=0.020):
    """The extreme y of a set of parts near a given x -- MEASURED.

    A band wrapped round a stack has to clear the widest thing in it, and the
    widest thing is whichever leaf's wander happened to bulge there. Guessing
    the face is at +/-d/2 put the polo's size band through two leaves at once,
    and it looked like a bracket clipped over the front edge with cloth coming
    through it. The pair was in the allow list, so nothing measured it either.
    """
    best = None
    for ob in objs:
        mw = ob.matrix_world
        for v in ob.data.vertices:
            q = mw @ v.co
            if abs(q.x - x) > window:
                continue
            if best is None or (q.y * sign) > (best * sign):
                best = q.y
    if best is None:
        raise SystemExit(
            f"BUILD FAILED: edge_y found no geometry within "
            f"{window * 1000:.0f} mm of x={x:+.4f}")
    return best


def strip(name, path, halfw, halfh, sides=12):
    """A flat strip with rounded edges -- a placket, a waistband, a hem tape.

    A circular sweep is a sausage. Real trim is wide and thin with a soft edge,
    and the difference is the whole read at 18 inches.
    """
    rings = []
    for i, p in enumerate(path):
        nxt = path[min(i + 1, len(path) - 1)]
        prv = path[max(i - 1, 0)]
        d = (nxt - prv)
        if d.length < 1e-9:
            d = Vector((0, 1, 0))
        d.normalize()
        up = Vector((0, 0, 1))
        side = d.cross(up)
        if side.length < 1e-6:
            side = Vector((1, 0, 0))
        side.normalize()
        up = side.cross(d).normalized()
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            ca, sa = math.cos(a), math.sin(a)
            ring.append(p + side * (math.copysign(abs(ca) ** 0.55, ca) * halfw)
                        + up * (math.copysign(abs(sa) ** 0.55, sa) * halfh))
        rings.append(ring)
    return loft(name, rings, smooth=True)


def hanger(name, centre, halfw=0.086, drop=0.052, hook_r=0.020, rod=0.0055,
           thick=0.0090):
    """A shop hanger, as TWO parts: a moulded body and a metal hook.

    Three attempts to make it one piece all failed, and the last two failed for
    the same reason: the hook's outline crossed its own stem and the n-gon
    rendered as a crumpled spiral. A real hanger IS two parts -- a body and a
    hook pressed into it -- so it is modelled as two and the pair is declared,
    rather than contorting the geometry to satisfy a rule that was never true
    of the object.

    Returns (body, hook).
    """
    cx, cy, cz = centre
    half = rod * 0.5

    def shoulder(t):
        x = cx + t * halfw
        z = cz - drop * (abs(t) ** 1.65)
        return x, z

    lower, upper = [], []
    STEPS = 22
    for i in range(STEPS + 1):
        t = -1.0 + 2.0 * i / STEPS
        x, z = shoulder(t)
        hh = half * (1.0 + 0.55 * (1.0 - abs(t)))
        lower.append((x, z - hh))
        upper.append((x, z + hh))

    stem = rod * 0.62
    top = cz + 0.0165
    pts = []
    pts.extend(lower)
    pts.append((cx + halfw + half, cz - drop))
    pts.extend(reversed(upper[STEPS // 2 + 1:]))
    pts.append((cx + stem, top))
    pts.append((cx - stem, top))
    pts.extend(reversed(upper[:STEPS // 2]))
    pts.append((cx - halfw - half, cz - drop))
    verts = [Vector((x, cy, z)) for x, z in pts]
    body = HS.mesh_from(name, verts, [tuple(range(len(verts)))], smooth=False)
    mod = body.modifiers.new("Thick", "SOLIDIFY")
    mod.thickness = thick
    mod.offset = 0.0
    body = HS.apply_mods(body)

    # the hook: a swept tube on a circular arc, starting inside the stem
    hcz = top + hook_r * 0.72
    path = [Vector((cx, cy, top - rod * 0.9))]
    for i in range(19):
        a = math.radians(-90 + 250.0 * i / 18.0)
        path.append(Vector((cx + math.cos(a) * hook_r * 0.62,
                            cy, hcz + math.sin(a) * hook_r)))
    hook = _sweep(f"{name}_hook", path, rod * 0.40, sides=7)
    return body, hook


def union(a, b, name):
    """Boolean UNION of two objects, leaving one watertight piece."""
    mod = a.modifiers.new("Union", "BOOLEAN")
    mod.operation = "UNION"
    mod.object = b
    mod.solver = "EXACT"
    out = HS.apply_mods(a)
    bpy.data.objects.remove(b, do_unlink=True)
    out.name = name
    return out


def _sweep(name, path, radius, sides=8):
    rings = []
    for i, p in enumerate(path):
        nxt = path[min(i + 1, len(path) - 1)]
        prv = path[max(i - 1, 0)]
        d = (nxt - prv)
        if d.length < 1e-9:
            d = Vector((1, 0, 0))
        d.normalize()
        up = Vector((0, 1, 0))
        side = d.cross(up)
        if side.length < 1e-6:
            side = Vector((1, 0, 0))
        side.normalize()
        up = side.cross(d).normalized()
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            ring.append(p + side * (math.cos(a) * radius) + up * (math.sin(a) * radius))
        rings.append(ring)
    return loft(name, rings, smooth=True)


def edge_x(obj, z, y, tol=0.006):
    """The garment's actual half-width at a height, MEASURED off the mesh.

    Placing a size tag by arithmetic put it 19.93 mm inside the shirt and then,
    corrected by arithmetic again, 0 mm from it -- `assert_assembly` failed it
    both times. The loft's width at a height is a function of the leaf steps,
    the roll profile and the jitter; measure it instead of predicting it.

    SIGNED, and a WORLD coordinate. This used to return max(abs(x)), which is
    the half-width ONLY when the garment sits at x = 0 -- true of every render
    it has ever had, and false the moment two are placed side by side. Callers
    add nothing to it. It also refuses to answer rather than returning 0.0 when
    it finds no surface, which is how a tag ends up at the origin.
    """
    best = None
    for v in obj.data.vertices:
        w = obj.matrix_world @ v.co
        if abs(w.z - z) < tol and abs(w.y - y) < tol * 4:
            if best is None or w.x > best:
                best = w.x
    if best is None:
        raise SystemExit(
            f"BUILD FAILED: edge_x found no surface on {obj.name} at "
            f"z={z:+.4f} y={y:+.4f}")
    return best


def surface_y(obj, x, z, sign=-1, tol=0.010):
    """The front (sign -1) or back (+1) surface depth at a point, MEASURED.

    A drape's section thickness is a function of the flare, the fold wobble and
    the shoulder hollow, so a placket placed by arithmetic floats in front of
    the chest or sinks through it. Every part that has to sit ON this surface
    asks it where the surface is.
    """
    best = None
    for v in obj.data.vertices:
        w = obj.matrix_world @ v.co
        if abs(w.z - z) < tol and abs(w.x - x) < tol * 2.5:
            if best is None or (w.y < best if sign < 0 else w.y > best):
                best = w.y
    if best is None:
        # NEVER a silent default. Returning 0.0 when the probe found nothing put
        # a button 20.69 mm inside the shirt, because the neck hollow means
        # there is no surface at x=0 above the neck line and the fallback
        # answered anyway. A measurement that cannot be made must say so.
        raise SystemExit(
            f"BUILD FAILED: surface_y found no surface on {obj.name} near "
            f"x={x:+.4f} z={z:+.4f} (tolerance {tol * 1000:.0f} mm). The part "
            f"being placed there is off the garment, not on it.")
    return best


def top_z(obj, x, y, max_search=0.030):
    """The garment's top surface height at a point, MEASURED.

    NEAREST VERTEX in the upper part of the mesh, not a box filter. A fixed
    tolerance failed on the trousers: the fold's top cap has rings at 84%, 62%,
    38% and 15% of the outline, so near the middle the nearest vertex can be
    23 mm away in x and a 14 mm window finds nothing at all.

    It still fails loudly rather than defaulting -- a silent 0.0 from this
    function's sibling put a button 20.69 mm inside a shirt.
    """
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    if not pts:
        raise SystemExit(f"BUILD FAILED: top_z: {obj.name} has no vertices")
    zs = [q.z for q in pts]
    cut = min(zs) + (max(zs) - min(zs)) * 0.55
    upper = [q for q in pts if q.z >= cut]
    best, bestd = None, 1e9
    for q in upper:
        d = math.hypot(q.x - x, q.y - y)
        if d < bestd:
            best, bestd = q, d
    if best is None or bestd > max_search:
        raise SystemExit(
            f"BUILD FAILED: top_z found no top surface on {obj.name} within "
            f"{max_search * 1000:.0f} mm of x={x:+.4f} y={y:+.4f} "
            f"(nearest {bestd * 1000:.1f} mm). The part being placed there is "
            f"off the garment, not on it.")
    return best.z


def texture_into_cell(obj, cell, cols=4, rows=3, margin=0.06):
    """Unwrap the object and pack its UVs into one atlas cell.

    One material, twenty-four cells. A new colour must never cost a program --
    the parallel session measured ~70 ms of cold shader compile each, which the
    owner pays for on every first load.
    """
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.20, island_margin=0.015)
    bpy.ops.object.mode_set(mode="OBJECT")
    uv = obj.data.uv_layers.active
    cx, cy = cell % cols, rows - 1 - cell // cols
    for d in uv.data:
        u = margin + d.uv[0] * (1.0 - 2 * margin)
        v = margin + d.uv[1] * (1.0 - 2 * margin)
        d.uv = ((cx + u) / cols, (cy + v) / rows)
    return obj


def cell_offset(obj, cell, cols=4, rows=3):
    """Map an object's EXISTING 0-1 UVs into one atlas cell, without unwrapping.

    For anything whose artwork has to land in a known place -- a decal, a
    printed panel -- re-projecting would throw that placement away.
    """
    uv = obj.data.uv_layers.active
    cx, cy = cell % cols, rows - 1 - cell // cols
    for d in uv.data:
        d.uv = ((cx + min(1.0, max(0.0, d.uv[0]))) / cols,
                (cy + min(1.0, max(0.0, d.uv[1]))) / rows)
    return obj


def sleeve_from_body(name, root, direction, length, r0, r1, droop=0.10,
                     sides=14, steps=9, seam_in=0.0035, cuff=0.0, flat=0.52,
                     close=True):
    """A sleeve that GROWS OUT OF a shoulder instead of being pushed into one.

    The old sleeve was a tapered tube whose end cap sat wherever it landed, and
    the review said so three times over: "sleeves are cylinders pushed into a
    shoulder, not sleeves growing out of one".

    Two changes do the work. The root ring starts INSIDE the body so there is no
    seam gap to see, and the section is a LENS, wider than it is deep, because
    an empty sleeve is flat.
    """
    root = Vector(root)
    d = Vector(direction).normalized()
    up = Vector((0, 0, 1))
    side = d.cross(up)
    if side.length < 1e-6:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(d).normalized()
    rings = []
    for s in range(steps + 1):
        t = s / steps
        c = root + d * (length * t - seam_in)
        c.z -= droop * length * t * t
        r = r0 * (1 - t) + r1 * t
        if cuff and t > 0.86:
            r *= 1.0 + cuff * (t - 0.86) / 0.14
        ring = []
        for i in range(sides):
            a = 2 * math.pi * i / sides
            ring.append(c + side * (math.cos(a) * r)
                        + up * (math.sin(a) * r * flat))
        rings.append(ring)
    # THE CUFF ROLLS CLOSED. loft() caps the last ring flat, so a sleeve that
    # ends at full section ends in a DISC -- and side-on that disc is the
    # biggest single shape on a hung polo: a dark ellipse with a scalloped rim
    # that reads as the open end of a drum. An empty sleeve does not gape. Its
    # cuff is a folded hem and the opening is pressed nearly shut, so the
    # section closes to a SLOT: the width goes on holding while the depth
    # collapses. Same move draped() makes at the hem, for the same reason.
    if close:
        c = root + d * (length - seam_in)
        c.z -= droop * length
        r = r1 * (1.0 + (cuff or 0.0))
        for k, (rs, fs, push) in enumerate(((0.88, 0.52, 0.0050),
                                            (0.66, 0.22, 0.0082),
                                            (0.38, 0.07, 0.0098))):
            ring = []
            for i in range(sides):
                a = 2 * math.pi * i / sides
                ring.append(c + d * push
                            + side * (math.cos(a) * r * rs)
                            + up * (math.sin(a) * r * flat * fs))
            rings.append(ring)
    return loft(name, rings, smooth=True)


def ribbed_ring(name, centre, axis, radius, width, ribs=22, depth=0.0016,
                sides=None):
    """A ribbed band -- a collar, a cuff, a waist hem.

    "Ribbed collars and cuffs should show as ribbing, not as smooth trim." So
    the ribs are geometry: the section's radius steps in and out around the
    ring, which reads at the distance a player stands.
    """
    c = Vector(centre)
    d = Vector(axis).normalized()
    up = Vector((0, 0, 1))
    side = d.cross(up)
    if side.length < 1e-6:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(d).normalized()
    n = sides or ribs * 3
    rings = []
    for s in range(5):
        t = s / 4.0
        centre_t = c + d * (width * (t - 0.5))
        swell = 1.0 + 0.05 * math.sin(math.pi * t)
        ring = []
        for i in range(n):
            a = 2 * math.pi * i / n
            rib = 1.0 + (depth / radius) * math.cos(ribs * a)
            r = radius * swell * rib
            ring.append(centre_t + side * (math.cos(a) * r)
                        + up * (math.sin(a) * r * 0.74))
        rings.append(ring)
    return loft(name, rings, smooth=False)


def decal(name, centre, normal, size, lift=0.0016):
    """A printed patch as thin geometry: a chest logo, a sleeve badge, a tee
    front. Prints are what make fabric read as merchandise rather than cloth,
    and a decal quad lands its artwork exactly where it is put -- which a
    smart-projected UV island does not.
    """
    c = Vector(centre)
    n = Vector(normal).normalized()
    # THE FRAME IS FIXED BY udir x vdir = n, and nothing else. The old one
    # derived `side` from a world-up cross product and then subtracted u from
    # 0.5 to correct the handedness -- a sign calibrated by reading ONE render,
    # of a chest print on a hung shirt. It only ever worked for that case. On
    # the folded tee the normal is straight up, the cross product degenerates
    # to the (1, 0, 0) fallback, and the print came out rotated 180 degrees:
    # PINE HILLS upside down and running right to left.
    #
    # A decal lying flat has no world-up to borrow, so the choice has to be
    # made deliberately: its text points to the BACK of the garment, so that
    # somebody standing at the front of the shelf reads it the right way up.
    if abs(n.z) > 0.9:
        vdir = Vector((0.0, 1.0, 0.0))
    else:
        vdir = Vector((0.0, 0.0, 1.0))
    vdir = (vdir - n * vdir.dot(n)).normalized()
    side = vdir.cross(n).normalized()
    up = vdir
    w, h = size[0] * 0.5, size[1] * 0.5
    verts, faces = [], []
    for sgn in (-1, 1):
        base = c + n * (lift * (1.0 if sgn > 0 else -0.4))
        for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append(base + side * (sx * w) + up * (sy * h))
    faces.append((3, 2, 1, 0))
    faces.append((4, 5, 6, 7))
    for i in range(4):
        j = (i + 1) % 4
        faces.append((i, j, j + 4, i + 4))
    obj = HS.mesh_from(name, verts, faces, smooth=False)

    # UVs FROM VERTEX POSITION, not from loop order. mesh_from recalculates
    # normals, which reorders the loops, so a fixed corner sequence lands on
    # whichever corner it happens to hit -- the first version came out rotated
    # 90 degrees with the wordmark running vertically. Same trap the basket
    # badge hit; position is winding-independent.
    uv = obj.data.uv_layers.new(name="UVMap")
    for poly in obj.data.polygons:
        flat = abs(poly.normal.dot(n)) > 0.7
        for li in poly.loop_indices:
            co = obj.data.vertices[obj.data.loops[li].vertex_index].co
            if not flat:
                uv.data[li].uv = (0.02, 0.02)
                continue
            rel = co - c
            # No sign correction here any more: `side` is built as
            # vdir x n, so u already runs to the reader's right for any
            # orientation. The old minus was a per-case patch.
            u = 0.5 + rel.dot(side) / (2 * w)
            v = 0.5 + rel.dot(up) / (2 * h)
            uv.data[li].uv = (0.02 + 0.96 * min(1.0, max(0.0, u)),
                              0.02 + 0.96 * min(1.0, max(0.0, v)))
    obj["explicit_uv"] = True
    return obj


# ---------------------------------------------------------------------------
# surface construction
#
# These came out of the cap, which is the first garment built from panels
# rather than from primitives, and every remaining garment needs them: a strip
# swept along a path with the surface normal SUPPLIED (because deriving it from
# world up rolls the strip over on a curved body), a ring of thread, a moulded
# stud, and UVs taken off grid indices so artwork lands where it was put.

def framed_sweep(name, pts, nrms, halfw, halfh, closed=False, sides=8,
                 square=0.62, taper=0):
    """A strip swept along a path with the surface normal GIVEN per point.

    cloth_lib.strip derives its frame from the tangent and world up, which is
    correct on a flat garment and wrong on a dome. Here the caller supplies the
    normal, so a seam ridge stays flat against the panel all the way round the
    crown instead of rolling over on to its side.

    `taper` shrinks the section over that many rings at each end so the strip
    DIES INTO the surface. Without it a seam ridge stops in a blunt square
    block, which is what the centre-back seam did where it crossed the hem --
    visible in the close-up as a white brick and in nothing else.
    """
    n = len(pts)
    rings = []
    for i, p in enumerate(pts):
        sc = 1.0
        if taper and not closed:
            e = min(i, n - 1 - i)
            sc = 0.22 + 0.78 * min(1.0, (e / float(taper)) ** 0.55)
        nxt = pts[(i + 1) % n] if closed else pts[min(i + 1, n - 1)]
        prv = pts[(i - 1) % n] if closed else pts[max(i - 1, 0)]
        tan = (nxt - prv)
        if tan.length < 1e-9:
            tan = Vector((1, 0, 0))
        tan.normalize()
        nrm = Vector(nrms[i]).normalized()
        side = tan.cross(nrm)
        if side.length < 1e-6:
            side = Vector((0, 0, 1)).cross(tan)
        side.normalize()
        nrm = side.cross(tan).normalized()
        ring = []
        for k in range(sides):
            ang = 2.0 * math.pi * k / sides
            ca, sa = math.cos(ang), math.sin(ang)
            ring.append(
                p + side * (math.copysign(abs(ca) ** square, ca) * halfw * sc)
                + nrm * (math.copysign(abs(sa) ** square, sa) * halfh * sc))
        rings.append(ring)
    verts, faces = [], []
    for r in rings:
        verts.extend(r)
    segs = n if closed else n - 1
    for r in range(segs):
        r2 = (r + 1) % n
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((r * sides + k, r * sides + k2,
                          r2 * sides + k2, r2 * sides + k))
    if not closed:
        faces.append(tuple(range(sides - 1, -1, -1)))
        b = (n - 1) * sides
        faces.append(tuple(range(b, b + sides)))
    return HS.mesh_from(name, verts, faces, smooth=True)


def stud(name, base, direction, radius, height, sides=12):
    """A snapback peg: a SMOOTH DOME on a short shank.

    HS.prism gave a flat-shaded 10-sided stub, and at the frame size the rear
    view is reviewed at that reads as a hexagonal nut screwed into the strap --
    which is not a fault that exists at a third of frame, and is obvious once
    the shot is framed off the subject's real extent.
    """
    d = Vector(direction).normalized()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(up).normalized()
    v = d.cross(u).normalized()
    b0 = Vector(base)
    rings = []
    for (t, rf) in ((0.00, 1.00), (0.55, 1.00), (0.80, 0.86),
                    (0.94, 0.60), (1.00, 0.26)):
        c = b0 + d * (height * t)
        rings.append([c + u * (math.cos(2 * math.pi * i / sides) * radius * rf)
                      + v * (math.sin(2 * math.pi * i / sides) * radius * rf)
                      for i in range(sides)])
    return loft(name, rings, close_bottom=True, close_top=True, smooth=True)


def torus(name, centre, normal, major, minor, mseg=8, nseg=4):
    """A sewn eyelet: a ring of thread standing proud of the panel."""
    c = Vector(centre)
    nz = Vector(normal).normalized()
    side = nz.cross(Vector((0, 0, 1)))
    if side.length < 1e-6:
        side = Vector((1, 0, 0))
    side.normalize()
    up = nz.cross(side).normalized()
    verts, faces = [], []
    for i in range(mseg):
        ai = 2.0 * math.pi * i / mseg
        radial = side * math.cos(ai) + up * math.sin(ai)
        for k in range(nseg):
            ak = 2.0 * math.pi * k / nseg
            verts.append(c + radial * (major + minor * math.cos(ak))
                         + nz * (minor * math.sin(ak)))
    for i in range(mseg):
        i2 = (i + 1) % mseg
        for k in range(nseg):
            k2 = (k + 1) % nseg
            faces.append((i * nseg + k, i * nseg + k2,
                          i2 * nseg + k2, i2 * nseg + k))
    return HS.mesh_from(name, verts, faces, smooth=True)


def thicken(obj, thickness, offset=-1.0):
    m = obj.modifiers.new("Thick", "SOLIDIFY")
    m.thickness = thickness
    m.offset = offset
    m.use_rim = True
    return HS.apply_mods(obj)


def smooth_by_angle(obj, deg=42.0):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(deg))
    except (AttributeError, RuntimeError, TypeError):
        pass
    return obj


def grid_uv(obj, nu, nv, flip_u=False, flip_v=False):
    """UVs straight off the grid indices, for a part whose artwork has to land
    in a known place. Vertex index is (row * nu + col) by construction in
    grid_surface, and mesh_from reorders LOOPS but never vertices -- which is
    the distinction the decal function had to learn the hard way."""
    uv = obj.data.uv_layers.new(name="UVMap")
    for poly in obj.data.polygons:
        for li in poly.loop_indices:
            vi = obj.data.loops[li].vertex_index
            row, col = divmod(vi, nu)
            u = col / (nu - 1.0)
            vv = min(1.0, row / (nv - 1.0))
            # flip_v exists because a garment's own v runs DOWN the body while
            # a texture's v runs UP the image. The polo's chest badge came out
            # rotated 180 degrees -- read as "mirrored", fixed twice for the
            # wrong reason -- until the two conventions were named.
            uv.data[li].uv = (1.0 - u if flip_u else u,
                              1.0 - vv if flip_v else vv)
    obj["explicit_uv"] = True
    return obj
