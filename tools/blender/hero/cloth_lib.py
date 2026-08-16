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


def folded(name, centre, size, leaves=3, sag=0.0026, crease=0.0018,
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
            front = 0.5 - 0.5 * sa
            flank = abs(ca)
            bias = 0.20 + 0.80 * max(front, flank * 0.85)
            # and they do not line up: each leaf wanders a little around itself
            wander = 1.0 + 0.011 * math.sin(a * 2.0 + leaf * 2.1 + seed)                 + 0.007 * math.sin(a * 5.0 - leaf * 1.3 + seed * 2)
            sc = (0.93 + 0.07 * roll) * (1.0 - 0.075 * leaf * bias) * wander
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

    obj = grid_surface(name, surf, nu=nu, nv=nv, smooth=True)
    # weld the seam and cap the hem so it is a closed piece
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
    """
    cx, cy, cz = centre
    verts, faces = [], []
    for i in range(sides):
        s = -1.0 + 2.0 * i / (sides - 1)
        a = abs(s)
        inner = Vector((cx + s * halfw, cy + back * (1.0 - 0.35 * s * s), cz))
        outer = Vector((cx + s * halfw * spread,
                        cy + back - forward - reach * s * s, cz))
        for r in range(rows):
            t = r / (rows - 1)
            p = inner.lerp(outer, t)
            # the fold stands proud; the two points settle onto the shirt
            rise = (lift * math.sin(math.pi * min(1.0, t * 1.05)) ** 0.75
                    * (1.0 - 0.62 * a ** 1.7))
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
    """A shop hanger: shoulders and a hook, as one flat profile with thickness.

    Built as a SINGLE closed outline extruded, not as a bar plus a hook.
    Sweeping the two separately left two shells, which assert_all_one_piece
    fails; unioning them with a boolean left a 6 mm fragment, because the
    solver will not weld two self-intersecting swept tubes at a sharp apex. An
    outline has neither problem and matches the wooden hangers in
    ref/apparel/rack-hung-and-folded.jpg better than a wire would.
    """
    cx, cy, cz = centre
    half = rod * 0.5

    def shoulder(t):
        """t from -1 (left tip) to +1 (right tip): the shoulder centreline."""
        x = cx + t * halfw
        z = cz - drop * (abs(t) ** 1.65)
        return x, z

    lower, upper = [], []
    STEPS = 22
    for i in range(STEPS + 1):
        t = -1.0 + 2.0 * i / STEPS
        x, z = shoulder(t)
        # the bar is thicker at the middle, like a moulded hanger
        hh = half * (1.0 + 0.55 * (1.0 - abs(t)))
        lower.append((x, z - hh))
        upper.append((x, z + hh))

    # The stem and hook, as the top of the same outline. Traced as a circular
    # arc from the stem all the way round to the tip and back on the inner
    # radius: the first version stepped through a hand-rolled angle range that
    # crossed itself, and the n-gon it produced rendered as a crumpled blob.
    stem = rod * 0.42
    top = cz + 0.0150
    hcx, hcz = cx, top + hook_r
    A0, A1 = -math.pi / 2, -math.pi / 2 - math.radians(300)
    outer, inner = [], []
    N = 26
    for i in range(N + 1):
        a = A0 + (A1 - A0) * i / N
        outer.append((hcx + math.cos(a) * (hook_r + stem),
                      hcz + math.sin(a) * (hook_r + stem)))
        inner.append((hcx + math.cos(a) * (hook_r - stem),
                      hcz + math.sin(a) * (hook_r - stem)))

    pts = []
    pts.extend(lower)                                   # left tip -> right tip
    pts.append((cx + halfw + half, cz - drop))          # round the right tip
    pts.extend(reversed(upper[STEPS // 2 + 1:]))        # back to the stem
    pts.append((cx + stem, top))                        # up the stem, right
    pts.extend(outer)                                   # round the hook
    pts.append((inner[-1][0], inner[-1][1]))            # over the tip
    pts.extend(reversed(inner))                         # and back inside it
    pts.append((cx - stem, top))                        # down the stem, left
    pts.extend(reversed(upper[:STEPS // 2]))            # on to the left tip
    pts.append((cx - halfw - half, cz - drop))

    verts = [Vector((x, cy, z)) for x, z in pts]
    face = tuple(range(len(verts)))
    obj = HS.mesh_from(name, verts, [face], smooth=False)
    mod = obj.modifiers.new("Thick", "SOLIDIFY")
    mod.thickness = thick
    mod.offset = 0.0
    return HS.apply_mods(obj)


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
    """
    best = 0.0
    for v in obj.data.vertices:
        w = obj.matrix_world @ v.co
        if abs(w.z - z) < tol and abs(w.y - y) < tol * 4:
            best = max(best, abs(w.x))
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


def top_z(obj, x, y, tol=0.014):
    """The garment's top surface height at a point, MEASURED.

    Third time this session that a part placed on a surface by arithmetic
    landed inside it: the folded polo's collar sat at the nominal fold height
    while the real top face had sagged and creased below it, so a 15 mm collar
    rendered as an embossed line. Ask the mesh.
    """
    best = None
    for v in obj.data.vertices:
        w = obj.matrix_world @ v.co
        if abs(w.x - x) < tol and abs(w.y - y) < tol:
            if best is None or w.z > best:
                best = w.z
    if best is None:
        raise SystemExit(
            f"BUILD FAILED: top_z found no surface on {obj.name} near "
            f"x={x:+.4f} y={y:+.4f} (tolerance {tol * 1000:.0f} mm)")
    return best


def texture_into_cell(obj, cell, cols=4, rows=3, margin=0.06):
    """Unwrap the object and pack its UVs into one atlas cell.

    One material, twelve colourways. A new colour must never cost a program --
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
