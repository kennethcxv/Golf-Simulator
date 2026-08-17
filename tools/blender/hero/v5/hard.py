"""Hardgoods construction, carrying v5's method across from cloth.

The garments worked because each one was drafted the way a factory makes it --
flat pattern pieces, sewn, then gravity -- instead of being sculpted into
roughly the right silhouette. The same rule applies here and it bites harder,
because a chrome edge that should catch a highlight in one line smears it over
a centimetre the moment it is rounded like everything else.

So: a driver head is a CROWN and a SOLE meeting at a skirt line, with a face
set into the front. An iron is a body with a milled face and grooves that are
cut, not painted. A club is a head, a hosel, a ferrule, a shaft and a grip,
because that is five parts and they are made of five different things.

WHAT IS BANNED, same as the apparel path:

  * No harmonic term added to fake a shape. Nothing in here calls sin() to
    make something curvy. The section curves are SUPERELLIPSES -- algebraic,
    |s|^p, the same family as the seam roll's sqrt(1 - (2t-1)^2) -- and the
    exponent is what makes a crown read flatter than a sole rather than an
    amplitude does.
  * No uniform smoothing. Crown and sole meet at a marked sharp edge and the
    two carry different materials, which is most of what says "this is a
    manufactured object" rather than "this is a blob".
"""

import math

import bmesh
import bpy
from mathutils import Vector

import studio as ST


# ---------------------------------------------------------------------------
# curves


def resample(pts, n, closed=False):
    """Arc-length resample of a polyline.

    A curve drawn with eight landmarks IS an octagon -- that was the v5 hood's
    silhouette and it cost a round to find. Everything shaped here goes through
    this first.
    """
    p = [Vector(q) for q in pts]
    if closed:
        p = p + [p[0]]
    seg = [(p[i + 1] - p[i]).length for i in range(len(p) - 1)]
    total = sum(seg)
    if total <= 0:
        raise SystemExit("BUILD FAILED: resample got a zero-length curve")
    out, acc = [], 0.0
    steps = n if closed else n - 1
    for i in range(steps if closed else n):
        want = total * (i / steps)
        acc, k = 0.0, 0
        while k < len(seg) and acc + seg[k] < want:
            acc += seg[k]
            k += 1
        k = min(k, len(seg) - 1)
        t = (want - acc) / seg[k] if seg[k] > 0 else 0.0
        out.append(p[k].lerp(p[k + 1], t))
    return out


def chaikin(pts, rounds=2, closed=True):
    """Corner-cut a landmark polygon into a smooth outline."""
    p = [Vector(q) for q in pts]
    for _ in range(rounds):
        out = []
        n = len(p)
        rng = range(n) if closed else range(n - 1)
        for i in rng:
            a, b = p[i], p[(i + 1) % n]
            out.append(a.lerp(b, 0.25))
            out.append(a.lerp(b, 0.75))
        if not closed:
            out = [p[0]] + out + [p[-1]]
        p = out
    return p


def lerp_table(table, t):
    """Linear read of a landmark table [(t0, a, b, ...), (t1, ...), ...]."""
    if t <= table[0][0]:
        return table[0][1:]
    if t >= table[-1][0]:
        return table[-1][1:]
    for i in range(len(table) - 1):
        t0, t1 = table[i][0], table[i + 1][0]
        if t0 <= t <= t1:
            k = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
            return tuple(a + (b - a) * k
                         for a, b in zip(table[i][1:], table[i + 1][1:]))
    return table[-1][1:]


def superarc(s, power, flat):
    """(1 - |s|^power)^flat, s in [-1, 1].

    power=2, flat=0.5 is a circle. Raising `power` flattens the middle and
    sharpens the shoulder -- which is the difference between a sole (nearly
    flat, then a quick turn into the skirt) and a crown (a shallow continuous
    dome). It is one number per surface and it is the shape of the part, not a
    wave laid over it.
    """
    a = min(1.0, abs(s))
    return max(0.0, 1.0 - a ** power) ** flat


# ---------------------------------------------------------------------------
# surfaces


def loft(name, sections, wrap=True, cap_first=False, cap_last=False):
    """`sections[v]` is a ring of points; build the tube between them."""
    ob = ST.grid(name, sections, wrap_u=wrap)
    if cap_first or cap_last:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.to_mesh(ob.data)
        bm.free()
    return ob


def fill_loop(ob):
    """Close every boundary of a mesh and fix its normals."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def dish(name, rim, centre, bulge, nu, nv, normal):
    """A slightly domed patch filling a closed rim -- a club face.

    `rim` is the closed outline, `centre` the point the rings collapse toward,
    `bulge` how far the middle stands proud along `normal`. The rings stop
    short of a pole and the remainder is filled, because a pole in the middle
    of a face is exactly where the highlight lands.
    """
    n = Vector(normal).normalized()
    c = Vector(centre)
    # RESAMPLE THE RIM FIRST. A club face's outline is a closed curve whose
    # point spacing comes from whatever built the shell -- the driver's had 34
    # points across the topline and 25 around the much shorter leading edge.
    # Scaling that toward a centre turns the spacing difference into radial
    # creases, and the first face came out as a pinwheel with a star at the
    # sweet spot. Uniform arc length makes the fan regular.
    rim = resample(rim, nu, closed=True)
    rows = []
    for v in range(nv + 1):
        t = v / nv
        k = 0.022 + (1.0 - 0.022) * (1.0 - t)     # 1 at the rim, 0.022 inside
        # the dome is spherical in the plane, so its height depends on how far
        # out the ring is and not on which way round it
        lift = bulge * max(0.0, 1.0 - k * k) ** 0.5
        rows.append([tuple(c + (Vector(p) - c) * k + n * lift) for p in rim])
    ob = ST.grid(name, rows, wrap_u=True)
    fill_loop(ob)
    return ob


def coons_fill(name, rim, bulge, normal, nu=26, nv=20, power=0.55, vs=None,
               relief=None, corners=None):
    """Fill a closed rim with a QUAD GRID, not a fan.

    `dish` collapses rings toward a centre, and even with a uniformly sampled
    rim that leaves fifty long thin triangles meeting at a point -- which is a
    star, and it lands exactly on the sweet spot of a club face where the
    highlight goes. Two rounds of the driver face were that star.

    The apparel path already had the answer: a pattern piece is a Coons patch
    over four boundary curves, and a club face is a pattern piece. Split the rim
    into four chains, Coons-interpolate between them, and there is no pole
    anywhere in it. `bulge` then lifts the interior along `normal` with an
    algebraic falloff that is zero on all four edges.
    """
    m4 = 4 * max(nu, nv)
    r = resample(rim, m4, closed=True)

    # WHERE THE FOUR CORNERS ARE DECIDES WHICH WAY u AND v RUN, and splitting
    # the rim at index 0 puts them wherever the outline happened to start. On
    # the iron that was the heel at the sole, so v ran diagonally and twelve
    # grooves came out as twelve wavy VERTICAL lines down the face. The driver
    # hid it because its face is nearly symmetric and nothing on it is
    # directional.
    #
    # corners="bbox" pins them to the rim points nearest the outline's bounding
    # -box corners, which for any blade or face is exactly heel-top, toe-top,
    # toe-sole, heel-sole -- so u runs heel to toe and v runs top to sole, and
    # a groove is a row.
    if corners == "bbox":
        # WIND IT THE SAME WAY EVERY TIME. The corner walk below assumes the
        # rim runs heel-top -> toe-top -> toe-sole -> heel-sole; fed the other
        # way round it takes the long arc for two of the four sides and the
        # patch folds through itself. Signed area in the xz plane says which
        # way this outline happens to go.
        area = 0.0
        for i in range(len(r)):
            a, b = r[i], r[(i + 1) % len(r)]
            area += a.x * b.z - b.x * a.z
        if area > 0.0:
            r = list(reversed(r))
        ax = [q for q in r]
        xs = [q.x for q in ax]
        zs = [q.z for q in ax]
        want = [(min(xs), max(zs)), (max(xs), max(zs)),
                (max(xs), min(zs)), (min(xs), min(zs))]
        idx = []
        for wx, wz in want:
            best, bi = 1e18, 0
            for i, q in enumerate(ax):
                d = (q.x - wx) ** 2 + (q.z - wz) ** 2
                if d < best:
                    best, bi = d, i
            idx.append(bi)
        i0, i1, i2, i3 = idx
        seq = r + r
        def arc(a, b):
            n = (b - a) % m4
            return seq[a:a + n + 1]
        # top runs corner0->corner1 and bottom corner3->corner2; left runs
        # corner0->corner3 and right corner1->corner2. Two of those are walked
        # BACKWARDS around the rim, and taking arc(i3, i2) instead of
        # arc(i2, i3) walks the long way -- through the other two corners --
        # which is what shredded the first grooved face.
        top = arc(i0, i1)
        right = arc(i1, i2)
        bottom = list(reversed(arc(i2, i3)))
        left = list(reversed(arc(i3, i0)))
        if min(len(top), len(right), len(bottom), len(left)) < 2:
            raise SystemExit(
                "BUILD FAILED: coons_fill corners='bbox' found a degenerate "
                "side -- the outline's extremes are not four distinct points")
    else:
        m = m4 // 4
        top = r[0:m + 1]
        right = r[m:2 * m + 1]
        bottom = list(reversed(r[2 * m:3 * m + 1]))
        left = list(reversed(r[3 * m:] + [r[0]]))
    top = resample(top, nu + 1)
    bottom = resample(bottom, nu + 1)
    left = resample(left, nv + 1)
    right = resample(right, nv + 1)
    c00, c10 = left[0], right[0]
    c01, c11 = left[-1], right[-1]
    n = Vector(normal).normalized()
    # EXPLICIT ROWS WHERE A GROOVE NEEDS THEM. Sampling a 0.9 mm channel out of
    # uniform rows takes about 120 of them across a 50 mm face and still rounds
    # the walls. Handing in the v values instead -- one pair at each groove
    # edge -- gives vertical walls and a flat floor out of four rows per groove,
    # which is what a cut groove IS.
    vlist = [j / nv for j in range(nv + 1)] if vs is None else list(vs)
    left = resample(left, len(vlist)) if vs is None else left
    right = resample(right, len(vlist)) if vs is None else right
    rows = []
    for j, v in enumerate(vlist):
        if vs is None:
            lp, rp = left[j], right[j]
        else:
            lp, rp = _at(left, v), _at(right, v)
        row = []
        for i in range(nu + 1):
            u = i / nu
            p = (top[i] * (1 - v) + bottom[i] * v
                 + lp * (1 - u) + rp * u
                 - (c00 * (1 - u) * (1 - v) + c10 * u * (1 - v)
                    + c01 * (1 - u) * v + c11 * u * v))
            su = max(0.0, 1.0 - (2 * u - 1) ** 2) ** power
            sv = max(0.0, 1.0 - (2 * v - 1) ** 2) ** power
            d = 0.0 if relief is None else relief(u, v)
            row.append(tuple(p + n * (bulge * su * sv + d)))
        rows.append(row)
    return ST.grid(name, rows)


def _at(chain, t):
    """Point at parameter t along an evenly sampled chain."""
    k = t * (len(chain) - 1)
    i = min(len(chain) - 2, int(k))
    return chain[i].lerp(chain[i + 1], k - i)


def groove_rows(count, first, pitch, width, lo, hi, edge=0.00016):
    """Row parameters and a relief function for a set of cut grooves.

    Returns (vs, relief). `vs` carries four rows per groove -- land, floor,
    floor, land -- plus filler rows through the lands so the face is not one
    long quad between grooves. `relief(u, v)` is the depth at that row, and it
    is FLAT inside a groove and zero outside: two walls and a floor, never a
    profile that eases in.
    """
    span = hi - lo
    cuts = []
    for i in range(count):
        c = first + i * pitch
        cuts.append((c - width * 0.5, c + width * 0.5))
    vs = set()
    for a, b in cuts:
        for z in (a - edge, a, b, b + edge):
            vs.add(min(1.0, max(0.0, (z - lo) / span)))
    for i in range(21):
        vs.add(i / 20.0)
    vs = sorted(vs)

    def relief(u, v):
        z = lo + v * span
        for a, b in cuts:
            if a <= z <= b:
                return -1.0
        return 0.0
    return vs, relief


def scorelines(pts_fn, count, first, pitch, width, depth, axis, extent):
    """Return a function that cuts real grooves into a face's height field.

    THE GROOVES ARE GEOMETRY. A bump map does not survive a glTF export of a
    procedural material, does not read at shelf distance, and is the difference
    between "an iron" and "a wedge-shaped lump". Each groove is a flat-bottomed
    channel with vertical-ish walls -- piecewise, so the face keeps flat lands
    between crisp groove edges.
    """
    edges = [(first + i * pitch) for i in range(count)]

    def cut(u):
        for e in edges:
            d = abs(u - e)
            if d <= width * 0.5:
                return depth
        return 0.0
    return cut


def revolve(name, profile, sides=32, axis="z"):
    """Spin a 2-D profile [(r, h), ...] about an axis."""
    rows = []
    for r, h in profile:
        row = []
        for j in range(sides):
            a = 2 * math.pi * j / sides
            if axis == "z":
                row.append((r * math.cos(a), r * math.sin(a), h))
            elif axis == "y":
                row.append((r * math.cos(a), h, r * math.sin(a)))
            else:
                row.append((h, r * math.cos(a), r * math.sin(a)))
        rows.append(row)
    ob = ST.grid(name, rows, wrap_u=True)
    fill_loop(ob)
    return ob


def tube(name, a, b, r0, r1, sides=20, rows=2, up=(0, 0, 1)):
    """A tapered round tube from a to b."""
    a, b = Vector(a), Vector(b)
    tan = (b - a).normalized()
    e1 = tan.cross(Vector(up))
    if e1.length < 1e-6:
        e1 = tan.cross(Vector((1, 0, 0)))
    e1.normalize()
    e2 = tan.cross(e1).normalized()
    out = []
    for i in range(rows + 1):
        t = i / rows
        c = a.lerp(b, t)
        r = r0 + (r1 - r0) * t
        out.append([tuple(c + e1 * (r * math.cos(2 * math.pi * j / sides))
                          + e2 * (r * math.sin(2 * math.pi * j / sides)))
                    for j in range(sides)])
    ob = ST.grid(name, out, wrap_u=True)
    fill_loop(ob)
    return ob


def grip(name, a, b, r_butt, r_tip, sides=24, rows=26, ribs=0, rib_depth=0.0):
    """A club grip: tapered rubber with a rounded butt cap.

    Real grips are not a cylinder. They taper about 2 mm over their length,
    they finish in a domed cap with a lip, and the last 30 mm below the cap is
    the parallel section your top hand sits on. `ribs` cuts the moulded
    diamond banding as a stepped height, never a wave.
    """
    a, b = Vector(a), Vector(b)     # a = butt (top), b = tip (down the shaft)
    tan = (b - a).normalized()
    e1 = tan.cross(Vector((0, 0, 1)))
    if e1.length < 1e-6:
        e1 = tan.cross(Vector((1, 0, 0)))
    e1.normalize()
    e2 = tan.cross(e1).normalized()
    L = (b - a).length
    out = []
    for i in range(rows + 1):
        # ROWS CLUSTERED AT THE BUTT. The cap is a quarter-round over 7 mm and
        # the grip is 280 mm long, so evenly spaced rows put ONE row inside it
        # and the grip came out as a flat-topped chamfered prism. Squaring the
        # parameter puts six rows in the same 7 mm.
        t = (i / rows) ** 1.9
        c = a.lerp(b, t)
        r = r_butt + (r_tip - r_butt) * t
        # the butt cap: a quarter-round over the first 7 mm, so the grip ends
        # in a dome with a lip instead of a cut pipe
        cap = min(1.0, (t * L) / 0.007)
        r *= max(0.18, cap ** 0.5)
        if ribs and 0.10 < t < 0.92:
            band = (t * ribs) % 1.0
            r += rib_depth if band < 0.5 else 0.0
        out.append([tuple(c + e1 * (r * math.cos(2 * math.pi * j / sides))
                          + e2 * (r * math.sin(2 * math.pi * j / sides)))
                    for j in range(sides)])
    ob = ST.grid(name, out, wrap_u=True)
    fill_loop(ob)
    return ob


# ---------------------------------------------------------------------------
# materials -- the brief's "seven different light responses where v4 had one"


def _bsdf(name, colour, rough, metallic=0.0, coat=0.0, coat_rough=0.05,
          spec=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    for key, val in (("Coat Weight", coat), ("Coat Roughness", coat_rough),
                     ("Specular IOR Level", spec)):
        if key in b.inputs:
            b.inputs[key].default_value = val
    return m


def painted(name, colour, rough=0.14, coat=0.85):
    """A gloss-painted crown: a clearcoat over pigment, so the highlight is a
    tight bright line and the colour underneath stays dark."""
    return _bsdf(name, colour, rough, metallic=0.0, coat=coat, coat_rough=0.03)


def brushed(name, colour=(0.62, 0.63, 0.64), rough=0.34):
    """Brushed steel: metal, but the highlight is a smear rather than a mirror."""
    return _bsdf(name, colour, rough, metallic=1.0)


def titanium(name, colour=(0.56, 0.55, 0.53), rough=0.44):
    """Matte titanium -- a driver sole. Duller and warmer than steel."""
    return _bsdf(name, colour, rough, metallic=1.0)


def graphite(name, colour=(0.045, 0.046, 0.050), rough=0.24):
    """A graphite shaft: near-black composite with a hard, narrow highlight and
    NO metallic response -- that is what separates it from a steel shaft at a
    glance, and v4 gave both the same material."""
    return _bsdf(name, colour, rough, metallic=0.0, coat=0.35, spec=0.62)


def rubber(name, colour=(0.038, 0.038, 0.041), rough=0.82):
    """Grip rubber: broad dull sheen, no coat."""
    return _bsdf(name, colour, rough, metallic=0.0, spec=0.32)


def leather(name, colour=(0.126, 0.070, 0.042), rough=0.56, grain=0.0009):
    """Leather: a mid-rough dielectric with a fine pebbled bump."""
    m = _bsdf(name, colour, rough, metallic=0.0, spec=0.45)
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 260.0
    tex.inputs["Detail"].default_value = 5.0
    tex.inputs["Roughness"].default_value = 0.62
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.55
    bump.inputs["Distance"].default_value = grain
    nt.links.new(tex.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def plastic(name, colour=(0.022, 0.022, 0.024), rough=0.12):
    """Ferrule / packaging plastic: hard, glossy, dielectric."""
    return _bsdf(name, colour, rough, metallic=0.0, coat=0.25, spec=0.58)


def clear(name, rough=0.04):
    """The clear front of a blister pack."""
    m = _bsdf(name, (0.86, 0.90, 0.92), rough, metallic=0.0, spec=0.62)
    b = m.node_tree.nodes["Principled BSDF"]
    if "Transmission Weight" in b.inputs:
        b.inputs["Transmission Weight"].default_value = 0.88
    if "IOR" in b.inputs:
        b.inputs["IOR"].default_value = 1.46
    m.blend_method = "BLEND" if hasattr(m, "blend_method") else m.blend_method
    return m


def card(name, colour=(0.72, 0.70, 0.66), rough=0.76):
    """Printed card backing."""
    return _bsdf(name, colour, rough, metallic=0.0, spec=0.28)


# ---------------------------------------------------------------------------
# assembly helpers


def mark_band(ob, pick, sharp=True):
    """Mark the edges between two named regions sharp.

    `pick(a, b)` gets the two face centres of an edge's faces and says whether
    that edge is the seam. This is how the crown/sole skirt line stays a LINE:
    smoothing alone at 30 degrees rounds it, because the two surfaces meet at
    about 25.
    """
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.edges.ensure_lookup_table()
    n = 0
    for e in bm.edges:
        if len(e.link_faces) != 2:
            continue
        a, b = e.link_faces
        if pick(a.calc_center_median(), b.calc_center_median()):
            e.smooth = False
            n += 1
    bm.to_mesh(me)
    bm.free()
    if sharp:
        me.update()
    print("    marked %d seam edges sharp" % n)
    return n


def measure(objs, label=""):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in objs:
        mw = ob.matrix_world
        for v in ob.data.vertices:
            w = mw @ v.co
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    print("  %-16s %.0f x %.0f x %.0f mm"
          % (label, (hi.x - lo.x) * 1000, (hi.y - lo.y) * 1000,
             (hi.z - lo.z) * 1000))
    return lo, hi


def sit_on_floor(objs):
    lo, _hi = measure(objs, "before floor")
    for ob in objs:
        for v in ob.data.vertices:
            v.co.z -= lo.z
        ob.data.update()
    return objs


def studio_hard(centre, scale, ev=-0.30, world=0.15):
    """The retail studio, re-balanced for hardgoods.

    Image1.png's rig is a bright white box: world 0.34, five soft lamps, a
    near-white card. That is right for pale cloth and wrong for a black driver
    crown, because in a box that bright a near-black diffuse surface reflects
    enough environment to land at mid grey -- the first driver render had a
    0.03 crown, a 0.045 shaft and a 0.038 grip all reading about 0.45, and it
    looked like three broken materials rather than one lighting choice.

    Dropping the WORLD rather than the exposure is the fix: the lamps still
    light the card to white, so the background and the contact shadow are
    unchanged, but the blacks stop being lifted by a hemisphere of white.
    Metals keep their environment to reflect because the card is still there.
    """
    ST.world_value(world)
    ST.retail_light(centre=centre, scale=scale)
    ST.cyc(centre=centre, scale=scale)
    ST.exposure(ev)


def club_stick(prefix, heel, axis, hosel_len, hosel_r0, hosel_r1,
               fer_len, shaft_len, grip_len, grip_r0, grip_r1,
               shaft_r0=0.0043, shaft_r1=0.0048):
    """Hosel, ferrule, shaft and grip on ONE axis -- shared by all three clubs.

    Building this per club is how the existing set ended up with a driver whose
    shaft is on the head's centre line and a putter whose shaft is a cylinder
    stuck through the blade. The axis comes in, everything hangs off it, and a
    club cannot be assembled crooked.
    """
    heel, axis = Vector(heel), Vector(axis).normalized()
    p = {}
    p["hosel"] = tube(prefix + "_hosel", heel, heel + axis * hosel_len,
                      hosel_r0, hosel_r1, sides=20, rows=3)
    f0 = heel + axis * (hosel_len - 0.002)
    p["ferrule"] = tube(prefix + "_ferrule", f0, f0 + axis * fer_len,
                        hosel_r1 * 1.24, shaft_r0 * 1.22, sides=22, rows=5)
    s0 = heel + axis * (hosel_len + fer_len - 0.004)
    s1 = heel + axis * (hosel_len + shaft_len)
    p["shaft"] = tube(prefix + "_shaft", s0, s1, shaft_r0, shaft_r1,
                      sides=18, rows=8)
    gt = heel + axis * (hosel_len + shaft_len + 0.006)
    gb = heel + axis * (hosel_len + shaft_len + 0.006 - grip_len)
    p["grip"] = grip(prefix + "_grip", gt, gb, grip_r0, grip_r1,
                     sides=24, rows=30)
    return p
