"""Hard-surface helpers, and the assertion that has failed twice in this project.

"Many small things attached to one big thing" is the shape of both the mop's
strands and the rake's bristles, and both shipped FLOATING IN AIR. Neither had a
check, and neither fault is visible in any number you would naturally print --
a bristle 5 mm below its block has a perfectly reasonable position, length and
triangle count.

So the property is ROOT and CONNECTION, measured on the geometry:

  assert_rooted     every small part must have vertices genuinely INSIDE the
                    host's volume, by a real depth. Not "near", not "aligned
                    with" -- inside, measured by closest-point-on-mesh and the
                    sign of the surface normal.
  assert_touching   two separate parts that are meant to meet must have surfaces
                    within a tolerance of each other.
  assert_one_piece  a part that is meant to be a single continuous object -- a
                    pan and its lip -- must be one shell.

Single-shell does NOT apply to these assets as a whole: a broom legitimately has
a block, a ferrule and bristles as separate objects. Root and connection are the
properties, not one shell.
"""

import math

import bpy
import bmesh
from mathutils import Vector


# ---------------------------------------------------------------------------
# the assertions


# THREE DIRECTIONS, NONE OF THEM AXIS-ALIGNED.
#
# The single +x ray this function used to cast is exact except when it runs
# along a face, and "along a face" is not a rare accident in this project -- it
# is the normal case, because nearly everything is modelled with a flat bottom
# at z = 0. Two cap panels sitting side by side on that plane were reported as
# interpenetrating BY 85.53 mm: the query point was a bottom-rim vertex at
# z = +0.00, the +x ray grazed the neighbour's coplanar bottom rim and came back
# with ONE crossing, and parity duly said "inside". Every other direction said
# outside and the nearest surface was 85.53 mm away -- which is the tell, since
# a point 85 mm from the nearest surface of a 2.6 mm shell cannot be in it.
#
# The directions below are mutually incommensurate and share no plane with any
# axis pair, so a face would have to be built at one of these exact obliquities
# to graze one -- and grazing all three at once is not reachable. Two are cast
# and a third only breaks a tie, so the common case costs one extra ray.
_PARITY_DIRS = (
    Vector((0.5773503, 0.3313013, 0.7457043)).normalized(),
    Vector((-0.4472136, 0.8090170, 0.3809524)).normalized(),
    Vector((0.2672612, -0.5345225, 0.8017837)).normalized(),
)


def _crossings(host, local, direction, eps, limit):
    origin, n = local.copy(), 0
    for _ in range(limit):
        ok, loc, _nrm, _i = host.ray_cast(origin, direction)
        if not ok:
            break
        n += 1
        origin = loc + direction * eps
    return n % 2 == 1


def point_inside(host, p_world, eps=1e-6, limit=64):
    """Is world point `p_world` inside `host`'s closed volume? Crossing count.

    THE SIGN COMES FROM PARITY, NOT FROM A SURFACE NORMAL, and that is the whole
    point of this function. The previous version took the sign from the closest
    face's normal, which is wrong for every hollow object in the project: for a
    point in a shell's CAVITY the closest face is the INNER wall, whose normal
    faces into the cavity, so the dot product flips and the point reports as
    deeply inside the material.

    Measured on the basket: the handles arc over the open top and the normal test
    called 33 of 78 vertices "inside" a 6 mm shell, up to 71.85 mm deep. Parity
    says 4 -- the four leg-end vertices that are genuinely in the rim material,
    which is where the pivot belongs. Same mesh, same points, one lie removed.

    A solidified shell's manifold interior IS the wall material, so parity is
    exact for it, and for a solid block it agrees with the old test everywhere.

    AND THE DIRECTION MATTERS. See _PARITY_DIRS: one axis-aligned ray is exact
    right up until it lies in the plane of a face, which on a model with a flat
    bottom is most of the time.
    """
    local = host.matrix_world.inverted() @ p_world
    first = _crossings(host, local, _PARITY_DIRS[0], eps, limit)
    second = _crossings(host, local, _PARITY_DIRS[1], eps, limit)
    if first == second:
        return first
    return _crossings(host, local, _PARITY_DIRS[2], eps, limit)


def point_depth_inside(host, p_world):
    """How far inside `host` is world point `p_world`? Negative means outside.

    Sign from `point_inside` (parity), magnitude from the distance to the nearest
    surface. The point is converted into the HOST'S LOCAL SPACE first, because
    closest_point_on_mesh takes local coordinates. The first version passed world
    coordinates straight in, which is silently correct for a host whose origin
    happens to sit at the world origin -- true for the broom block and the
    dustpan pan, and false for the spray bottle's head, where it reported a
    nozzle sunk 7 mm into the head as being 2.2 mm outside it.
    """
    local = host.matrix_world.inverted() @ p_world
    ok, loc, _nrm, _ = host.closest_point_on_mesh(local)
    if not ok:
        return -1e9
    d = (local - loc).length
    return d if point_inside(host, p_world) else -d


def assert_rooted(parts, host, label, min_verts=3, min_depth=0.0015):
    """Every small part must be genuinely seated in the big one.

    This is the check the mop's strands and the rake's bristles never had. It
    measures the PART'S OWN VERTICES against the host volume, so it cannot be
    satisfied by a root position that some other code was supposed to honour.
    """
    faults = []
    shallow = []
    for part in parts:
        mw = part.matrix_world
        depths = sorted((point_depth_inside(host, mw @ v.co) for v in part.data.vertices),
                        reverse=True)
        inside = [d for d in depths if d >= min_depth]
        if len(inside) < min_verts:
            faults.append(f"{part.name}: only {len(inside)} vertices are "
                          f"{min_depth * 1000:.1f} mm inside {host.name} "
                          f"(deepest {depths[0] * 1000:+.2f} mm)")
        else:
            shallow.append(depths[0])
    if faults:
        raise SystemExit(
            f"BUILD FAILED: {len(faults)} of {len(parts)} {label} are not rooted "
            f"in {host.name}\n  " + "\n  ".join(faults[:6])
            + (f"\n  ... and {len(faults) - 6} more" if len(faults) > 6 else ""))
    print(f"  rooted assertion passed: {len(parts)} {label} seated in "
          f"{host.name}, shallowest {min(shallow) * 1000:.1f} mm deep")


def surface_gap(a, b):
    """Smallest distance from any vertex of `a` to the surface of `b`."""
    mwa = a.matrix_world
    best = 1e9
    for v in a.data.vertices:
        ok, loc, _, _ = b.closest_point_on_mesh(b.matrix_world.inverted() @ (mwa @ v.co))
        if ok:
            best = min(best, ((b.matrix_world @ loc) - (mwa @ v.co)).length)
    return best


MAX_SEAT_DEPTH = 0.0060
"""How far a part may be inside another and still be called 'attached'.

There was no such number, and that is why the wand shipped. `assert_touching`
returned PASS the moment a part was 0.2 mm inside its host and never looked at
how much more -- so a grip driven 20.26 mm into a body 41.6 mm thick printed as
`GripSocket is embedded in GunBody by 19.47 mm` in green. Attached is a few
millimetres. Twenty is out the other side.

Where deep insertion is intended (a shaft in a socket), pass `max_depth`
explicitly and say why. Silence must mean the tight default, not no limit.
"""


def assert_touching(a, b, label, max_gap=0.0015, require_surface=False,
                    max_depth=MAX_SEAT_DEPTH):
    """Connected means ABUTTING or EMBEDDED, and the first version only tested
    the first.

    surface_gap returns an unsigned distance, so a socket sunk 6 mm into a block
    reports a 6 mm "gap" and fails for being too well attached. Anything with
    vertices inside the other part is connected by definition, so that is
    checked first.
    """
    # `require_surface` turns the embedded short-circuit OFF, which matters for
    # a HOLLOW host. "Inside the mesh" of a 6 mm basket shell means inside its
    # CAVITY, so a handle arcing over the open top counts as embedded 70 mm deep
    # and the check passes however far above the rim it floats -- the broken
    # variant proved exactly that by passing. Where a part has to MEET a surface
    # rather than sink into a solid, only the surface distance is meaningful.
    mwa = a.matrix_world
    deepest = -1e9 if require_surface else max(
        (point_depth_inside(b, mwa @ v.co) for v in a.data.vertices), default=-1e9)
    if deepest > 0.0002:
        if deepest > max_depth:
            raise SystemExit(
                f"BUILD FAILED: {label} -- {a.name} is {deepest * 1000:.2f} mm "
                f"INSIDE {b.name}, past the {max_depth * 1000:.1f} mm a seated "
                f"part may sink. This is not attachment, it is one part driven "
                f"through another; pass max_depth explicitly if it is intended.")
        print(f"  connection assertion passed: {a.name} is embedded in "
              f"{b.name} by {deepest * 1000:.2f} mm ({label})")
        return
    gap = surface_gap(a, b)
    if gap > max_gap:
        raise SystemExit(
            f"BUILD FAILED: {label} -- {a.name} is {gap * 1000:.2f} mm from "
            f"{b.name} and not embedded in it, so it is not attached")
    print(f"  connection assertion passed: {a.name} meets {b.name} "
          f"at {gap * 1000:.2f} mm ({label})")


def assert_no_overlap(a, b, label, min_gap=0.0008):
    """Two parts that must NOT be inside each other.

    The inverse of assert_touching, and it needs its own instrument: a cloth
    lying against a sponge passes every "is it attached" test precisely because
    it is touching, and interpenetration is invisible from most angles because
    the buried part is buried.
    """
    mwa = a.matrix_world
    deepest = max((point_depth_inside(b, mwa @ v.co) for v in a.data.vertices),
                  default=-1e9)
    if deepest > 0:
        raise SystemExit(
            f"BUILD FAILED: {label} -- {a.name} is {deepest * 1000:.2f} mm INSIDE "
            f"{b.name}. They must sit against each other, not through each other.")
    gap = surface_gap(a, b)
    if gap < min_gap:
        raise SystemExit(
            f"BUILD FAILED: {label} -- {a.name} and {b.name} are only "
            f"{gap * 1000:.2f} mm apart, under the {min_gap * 1000:.1f} mm minimum")
    print(f"  separation assertion passed: {a.name} clears {b.name} by "
          f"{gap * 1000:.2f} mm ({label})")


def assert_fits_inside(interior, size, label, margin=0.0030, samples=5):
    """A box of `size` must fit inside `interior` with clearance all round.

    The shopping bag's whole job is holding goods, and goods have phased through
    it across three playtests. A bag modelled as a shape with no measured cavity
    can only be tested against a guessed rectangle -- so the cavity is real
    geometry and this walks the probe's corners and edge midpoints against it.
    """
    sx, sy, sz = (v * 0.5 for v in size)
    lo, hi = None, None
    for v in interior.data.vertices:
        w = interior.matrix_world @ v.co
        lo = w.copy() if lo is None else Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
        hi = w.copy() if hi is None else Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    # SEARCH for a placement rather than assume one. The first version parked
    # the probe exactly `margin` above the cavity floor and then required
    # `margin` of clearance, so the bottom face sat on the boundary by
    # construction and the test reported +3.00 mm against a 3.0 mm requirement --
    # it was measuring its own placement, not the bag.
    base = (lo + hi) * 0.5
    best = -1e9
    for step in range(9):
        centre = base.copy()
        centre.z = lo.z + sz + (hi.z - lo.z - 2 * sz) * (step / 8.0)
        worst = 1e9
        for i in range(samples):
            for j in range(samples):
                for k in range(samples):
                    if not (i in (0, samples - 1) or j in (0, samples - 1)
                            or k in (0, samples - 1)):
                        continue          # surface of the probe only
                    p = centre + Vector((
                        sx * (2 * i / (samples - 1) - 1),
                        sy * (2 * j / (samples - 1) - 1),
                        sz * (2 * k / (samples - 1) - 1)))
                    worst = min(worst, point_depth_inside(interior, p))
        best = max(best, worst)
    worst = best
    if worst < margin:
        raise SystemExit(
            f"BUILD FAILED: {label} -- a {size[0]:.4f} x {size[1]:.4f} x "
            f"{size[2]:.4f} load does not fit in {interior.name}: the tightest "
            f"corner has {worst:+.5f} of clearance, {margin:.5f} required")
    # Units are whatever the asset is authored in -- metres for the tools, YARDS
    # for the checkout bag, because the game's are. Printing "mm" regardless was
    # a label that would have been believed.
    print(f"  clearance assertion passed: a {size[0]:.4f} x {size[1]:.4f} x "
          f"{size[2]:.4f} load clears {interior.name} by {worst:.5f} at its "
          f"tightest ({label})")


def assert_socket_at(host, sock, label, max_gap=0.0300):
    """A socket must be AT the part a hand closes around.

    Finding the node by name only proves the exporter kept it. The reported
    fault is not a missing node -- it is hands 0.81 yd from the rake, because
    LEGACY_GRIPS holds numbers nobody reconciled with the mesh.

    Measured UNSIGNED, against the host's surface. The signed inside/outside
    test reads the wrong way here: a grip is a stack of overlapping cylinders
    joined into one mesh, so closest_point_on_mesh lands on an internal face
    and the normal points into the solid. It called a socket on the grip's own
    centreline "4.2 mm outside". Distance to the surface has no such failure
    mode, and at a 30 mm tolerance against a 17 mm grip it still separates
    cleanly from the 785 mm the real fault produces.
    """
    local = host.matrix_world.inverted() @ sock.location
    ok, loc, _nor, _i = host.closest_point_on_mesh(local)
    if not ok:
        raise SystemExit(f"BUILD FAILED: cannot measure {sock.name} against "
                         f"{host.name} — {label}")
    d = ((host.matrix_world @ loc) - sock.location).length
    if d > max_gap:
        raise SystemExit(
            f"BUILD FAILED: {sock.name} is {d * 1000:.1f} mm from {host.name}'s "
            f"surface — {label}. A hand sent here closes on air, which is the "
            f"LEGACY_GRIPS fault this socket exists to replace "
            f"(measured: rake 810, hose 970, divot 720 mm)")
    print(f"  socket assertion passed: {sock.name} is {d * 1000:.1f} mm from "
          f"{host.name} ({label})")
    return d


def assert_boxes_overlap(a, b, label, min_overlap=0.0020):
    """Two parts must share real volume, measured on WORLD BOUNDING BOXES.

    Used where the surface tests cannot answer: a drawer face against a hollow
    tray reported an unchanging 4.32 mm however far the face was moved, so
    whatever it was measuring, it was not the plane in question. Bounding-box
    overlap is coarse, and it is honest about being coarse -- it cannot be
    invariant to position.
    """
    def box(o):
        pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        return lo, hi

    alo, ahi = box(a)
    blo, bhi = box(b)
    over = [min(ahi[i], bhi[i]) - max(alo[i], blo[i]) for i in range(3)]
    worst = min(over)
    if worst < min_overlap:
        axis = "xyz"[over.index(worst)]
        raise SystemExit(
            f"BUILD FAILED: {label} -- {a.name} and {b.name} overlap by only "
            f"{worst * 1000:+.2f} mm on {axis}; they do not share volume")
    print(f"  overlap assertion passed: {a.name} shares "
          f"{worst * 1000:.1f} mm with {b.name} ({label})")


def _world_box(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))


def _boxes_clear(a, b, slack=0.0):
    alo, ahi = _world_box(a)
    blo, bhi = _world_box(b)
    return any(min(ahi[i], bhi[i]) - max(alo[i], blo[i]) < -slack for i in range(3))


def is_closed(obj):
    """Watertight: every edge shared by exactly two faces."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bad = any(len(e.link_faces) != 2 for e in bm.edges)
    bm.free()
    return not bad


def assert_assembly(parts, label, allow=(), max_depth=MAX_SEAT_DEPTH,
                    require_attached=True):
    """EVERY pair, not a hand-written list of pairs.

    The wand has 12 parts -- 66 pairs -- and its builder named 11 of them. The
    pair the fault was in, grip against body, was not one of the 11, so a grip
    driven 20 mm through the body was never looked at by anything. Four more
    faulty pairs were likewise simply absent. A check you have to REMEMBER to
    write per pair gets forgotten exactly where the modelling is hardest and the
    parts are most crowded, which is where the faults are.

    So this walks all of them and fails closed. `allow` names the pairs where
    deep interpenetration is deliberate, as {("grip", "socket"), ...} -- naming
    one is a decision on the record, forgetting one is now a build failure
    instead of silence.

    `parts` is {name: object}. Also requires every part to touch at least one
    other, which is the loose-shell fault from the other direction.
    """
    allow = {tuple(sorted(p)) for p in allow}
    names = sorted(parts)
    # EVERY inside/outside test here is a parity test, and parity is only
    # defined for a closed surface. Asked about an open strip it answers
    # confidently and wrongly -- an open collar band reported a placket 47 mm
    # inside it. Refuse to measure rather than measure nonsense.
    open_parts = [n for n in names if not is_closed(parts[n])]
    if open_parts:
        raise SystemExit(
            f"BUILD FAILED: {label} -- these parts are not closed surfaces, so "
            f"no inside/outside test can be trusted about them: "
            f"{', '.join(open_parts)}")
    faults, attached = [], {n: False for n in names}
    nearest = {n: (1e9, "") for n in names}
    for i, na in enumerate(names):
        for nb in names[i + 1:]:
            a, b = parts[na], parts[nb]
            if _boxes_clear(a, b):
                continue                      # cannot touch, cheap reject
            deepest = max((point_depth_inside(b, a.matrix_world @ v.co)
                           for v in a.data.vertices), default=-1e9)
            other = max((point_depth_inside(a, b.matrix_world @ v.co)
                         for v in b.data.vertices), default=-1e9)
            deep = max(deepest, other)
            if deep > 0.0002:
                attached[na] = attached[nb] = True
                if deep > max_depth and tuple(sorted((na, nb))) not in allow:
                    faults.append(f"{na} and {nb} interpenetrate by "
                                  f"{deep * 1000:.2f} mm "
                                  f"(limit {max_depth * 1000:.1f})")
            else:
                gap = min(surface_gap(a, b), surface_gap(b, a))
                if gap <= 0.0015:
                    attached[na] = attached[nb] = True
                else:
                    # Remember the near miss. "touches nothing" with no number
                    # tells you a part is loose but not by how much, and the fix
                    # is always a distance.
                    if gap < nearest[na][0]:
                        nearest[na] = (gap, nb)
                    if gap < nearest[nb][0]:
                        nearest[nb] = (gap, na)
    if require_attached:
        for n in names:
            if not attached[n]:
                g, who = nearest[n]
                near = (f"; nearest is {who} at {g * 1000:.2f} mm"
                        if who else "; nothing is even close")
                faults.append(f"{n} touches nothing -- it is a loose part{near}")
    if faults:
        raise SystemExit(
            f"BUILD FAILED: {label} -- {len(faults)} assembly faults across "
            f"{len(names)} parts ({len(names) * (len(names) - 1) // 2} pairs "
            f"checked)\n  " + "\n  ".join(faults[:8])
            + (f"\n  ... and {len(faults) - 8} more" if len(faults) > 8 else ""))
    print(f"  assembly assertion passed: {len(names)} parts, "
          f"{len(names) * (len(names) - 1) // 2} pairs, none interpenetrating "
          f"past {max_depth * 1000:.1f} mm, none loose ({label})")


def assert_all_one_piece(parts, label, allow=()):
    """`assert_one_piece` over EVERY part, not one hand-picked part per asset.

    The dustpan called it on the pan and not on the handle, and the handle is
    three disconnected cylinders -- [24, 24, 24] -- held to the pan by two
    vertices. Same failure mode as the pair list: a per-part check that has to be
    remembered per part.
    """
    allow = set(allow)
    faults = []
    for name in sorted(parts):
        s = shells(parts[name])
        if len(s) != 1 and name not in allow:
            faults.append(f"{name} is {len(s)} separate pieces {s[:6]}")
    if faults:
        raise SystemExit(f"BUILD FAILED: {label} -- " + "; ".join(faults))
    print(f"  continuity assertion passed: all {len(parts)} parts are one piece "
          f"each ({label})")


def shells(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    seen, sizes = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, size = [v], 0
        seen.add(v.index)
        while stack:
            cur = stack.pop()
            size += 1
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        sizes.append(size)
    bm.free()
    return sorted(sizes, reverse=True)


def assert_one_piece(obj, label):
    s = shells(obj)
    if len(s) != 1:
        raise SystemExit(f"BUILD FAILED: {label} -- {obj.name} is {len(s)} "
                         f"separate pieces {s[:6]}, and it must be continuous")
    print(f"  continuity assertion passed: {obj.name} is one piece ({label})")


# ---------------------------------------------------------------------------
# construction


def recalc_normals(obj):
    """Make every face point outward.

    Not cosmetic. point_depth_inside decides inside-vs-outside from the SIGN of
    the surface normal, so a mesh wound inward makes the test report the exact
    opposite -- and it does it quietly: a point 106 mm outside a 44 mm sponge
    came back as 106 mm INSIDE it. Every assertion in this module that uses
    depth inherits that lie, which includes the rooting check the bristles rely
    on, so normals are fixed at construction rather than trusted.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def mesh_from(name, verts, faces, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    recalc_normals(ob)
    return ob


def box(name, centre, size, bevel=0.0, segments=2):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=centre)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = Vector(size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        m = ob.modifiers.new("Bevel", "BEVEL")
        m.width = bevel
        m.segments = segments
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(40)
    return ob


def cylinder(name, centre, radius, depth, verts=16, rotation=None, cap="NGON"):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth,
                                        location=centre, vertices=verts,
                                        end_fill_type=cap)
    ob = bpy.context.active_object
    ob.name = name
    if rotation is not None:
        ob.rotation_mode = "QUATERNION"
        ob.rotation_quaternion = rotation
    return ob


def prism(name, base, direction, length, radius_a, radius_b, sides=5, twist=0.0):
    """A tapering n-sided prism -- the cheap unit a bristle tuft is made of.

    Five sides rather than a cylinder: at the size a tuft occupies on screen the
    silhouette difference is invisible and the triangle difference is not.
    """
    d = Vector(direction).normalized()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(up).normalized()
    v = d.cross(u).normalized()
    verts, faces = [], []
    for ring, (t, r) in enumerate(((0.0, radius_a), (1.0, radius_b))):
        centre = Vector(base) + d * (length * t)
        for i in range(sides):
            a = 2 * math.pi * i / sides + twist * t
            verts.append(centre + u * (math.cos(a) * r) + v * (math.sin(a) * r))
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range(sides, sides * 2)))
    return mesh_from(name, verts, faces)


def solidify(obj, thickness, offset=0.0, rim=True):
    """Give a surface a wall. Sheet parts -- reel blades, catcher panels --
    have to have thickness or they vanish edge-on and read as decals."""
    m = obj.modifiers.new("Solid", "SOLIDIFY")
    m.thickness, m.offset, m.use_rim = thickness, offset, rim
    return obj


def weld_union(objects, name):
    """Boolean the pieces into ONE closed shell, rather than merely joining them.

    `join` puts several meshes in one object and leaves them intersecting, and
    that breaks every parity test in this module: a ray through the overlap of
    two welded cylinders crosses four surfaces where the point is inside one
    solid, so the count comes out even and the point reports as OUTSIDE.

    Found on the spreader. Its wheel is a tyre and a hub joined coaxially, and
    the axle's end caps sit deep inside the hub -- yet `assert_touching` said
    the axle was "16.00 mm from Wheel_0 and not embedded in it". 16 mm is the
    hub's wall, which is what the fallback gap test measures once parity has
    wrongly said outside. The geometry was right and the mesh was not closed in
    the sense the test needs.

    A wheel is one solid, so it is built as one.
    """
    base = objects[0]
    for other in objects[1:]:
        m = base.modifiers.new("Weld", "BOOLEAN")
        m.operation, m.object, m.solver = "UNION", other, "EXACT"
        base = apply_mods(base)
        bpy.data.objects.remove(other, do_unlink=True)
    base.name = name
    return recalc_normals(base)


def join(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    return ob


def apply_mods(obj):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    out = bpy.context.view_layer.objects.active

    # A BOOLEAN LEAVES AN EMPTY MATERIAL SLOT BEHIND, and every polygon points
    # at it. The cap's punched snapback tail came out of the modifier with
    # slots == [None] and material_index 0 on every face, so the builder's
    # `data.materials.append(trim)` landed in slot 1, which nothing used, and
    # the strap rendered in Blender's default white while the probe confirmed
    # its UVs were exactly right. An hour went into the UVs before the slot was
    # looked at.
    #
    # Dropping slots only when EVERY slot is empty cannot disturb a part that
    # has real materials: an object whose only slots are None has no material
    # to lose.
    mats = list(out.data.materials)
    if mats and all(m is None for m in mats):
        out.data.materials.clear()
        for poly in out.data.polygons:
            poly.material_index = 0
    return out


def pbr_textured(name, image_path, roughness=0.9, uv_map="UVMap"):
    """A material whose base colour is a PRINTED image.

    A grocery sack is printed, not tinted. Modelling the shape and leaving it a
    flat brown is a bag with no product on it.
    """
    import os as _os
    if not _os.path.exists(image_path):
        raise SystemExit(f"BUILD FAILED: artwork missing: {image_path} "
                         f"(run tools/blender/hero/make_bag_art.mjs)")
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = roughness
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(image_path)
    tex.image.colorspace_settings.name = "sRGB"
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = uv_map
    nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    return mat


def wrap_uvs(obj, rings, name="UVMap"):
    """Arc-length UVs for a lofted shell.

    u runs around the section by ARC LENGTH, so the print does not stretch on the
    long panels and bunch on the short ones; v runs up the loft. The wrapping
    quad gets u = 1 on its far edge rather than 0, or the whole texture smears
    backwards across one column of faces.
    """
    n = len(rings[0])
    cum = []
    for ring in rings:
        acc = [0.0]
        for i in range(n):
            a = ring[i]
            b = ring[(i + 1) % n]
            acc.append(acc[-1] + (b - a).length)
        cum.append(acc)
    heights = [r[0].z for r in rings]
    span = max(heights) - min(heights) or 1.0

    layer = obj.data.uv_layers.new(name=name)
    for poly in obj.data.polygons:
        for li in poly.loop_indices:
            vi = obj.data.loops[li].vertex_index
            r, i = divmod(vi, n)
            if r >= len(rings):
                layer.data[li].uv = (0.0, 0.0)
                continue
            total = cum[r][-1] or 1.0
            # a loop's own vertex index gives u directly; the wrap face is the
            # one whose two far vertices are index 0, and they take u = 1
            u = cum[r][i] / total
            if i == 0 and poly.loop_total == 4:
                others = [obj.data.loops[k].vertex_index % n for k in poly.loop_indices]
                if max(others) == n - 1:
                    u = 1.0
            layer.data[li].uv = (u, (heights[r] - min(heights)) / span)
    return layer


def unwrap_and_grain(objects, uv_scale=900.0, angle=66.0, margin=0.006):
    """Give props UVs and point their `surface()` noise at them.

    Same fault as the apparel, and it shows worst on the rake's shaft. A
    `ShaderNodeTexNoise` with no Vector input samples GENERATED space -- a 3-D
    volume normalised to the object's bounding box -- so on a shaft that runs
    diagonally across a 1.5 m box the "wood grain" is a cross-section of a
    cloud, and it runs ACROSS the timber instead of along it. Wood grain that
    crosses the shaft is the one thing that says painted dowel.

    In UV space a swept tube unwraps to a long strip, so the grain runs the
    length of the shaft on its own.
    """
    import math as _m
    for ob in objects:
        if ob.type != "MESH" or not ob.data.polygons:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        if not ob.data.uv_layers:
            ob.data.uv_layers.new(name="UVMap")
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.smart_project(angle_limit=_m.radians(angle),
                                     island_margin=margin)
            bpy.ops.object.mode_set(mode='OBJECT')
    seen, n = set(), 0
    for ob in objects:
        if ob.type != "MESH" or not ob.data.uv_layers:
            continue
        for mat in ob.data.materials:
            if mat is None or mat.name in seen or not mat.use_nodes:
                continue
            seen.add(mat.name)
            nt = mat.node_tree
            uvn = None
            for node in list(nt.nodes):
                if node.type != "TEX_NOISE" or node.inputs["Vector"].is_linked:
                    continue
                if uvn is None:
                    uvn = nt.nodes.new("ShaderNodeUVMap")
                nt.links.new(uvn.outputs["UV"], node.inputs["Vector"])
                old = node.inputs["Scale"].default_value
                node.inputs["Scale"].default_value = uv_scale * (old / 220.0)
                n += 1
    print(f"  grain: {n} noise nodes moved to UV space across {len(seen)} "
          f"materials")
    return n


def flatten_for_export(objects, keep=()):
    """Put a real baseColorFactor back on every material before export.

    THIS IS THE FAULT THAT ONLY THE IN-GAME TEST FOUND, and it made every
    garment WHITE in the running game while every Blender render was correct.

    The glTF exporter writes `baseColorFactor` only when Base Color is an
    unlinked constant. The colour microvariation added for the fabric links a
    Mix node into Base Color -- which improved every studio render and silently
    dropped the factor from all ten GLBs, so the shipped hoodie was a white
    hoodie. The note in my own memory says ShaderNodeMix is the only pattern
    that exports a factor; evidently that holds for a Mix fed by a TEXTURE, not
    for one fed by two constants and a noise.

    The procedural variation is a render-time nicety and the export needs a
    number. So: after the renders, average the Mix's two colour inputs, write
    that into Base Color, and unlink. The bump chain is untouched -- normals
    export from geometry here, and nothing depends on it.

    Call this AFTER the last render and BEFORE bake_gltf_axis.
    """
    seen, fixed = set(), 0
    for ob in objects:
        if ob.type != "MESH":
            continue
        for mat in ob.data.materials:
            if mat is None or mat.name in seen or not mat.use_nodes:
                continue
            seen.add(mat.name)
            if mat.name in keep:
                # SOME LINKED BASE COLOURS ARE THE POINT. The till screen's
                # content is a node chain into Base Color; averaging its two
                # tints and unlinking would export a flat panel and undo the
                # whole reason it exists. Only the microvariation wants
                # flattening.
                continue
            nt = mat.node_tree
            bsdf = next((n for n in nt.nodes
                         if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf is None:
                continue
            sock = bsdf.inputs["Base Color"]
            if not sock.is_linked:
                continue
            src = sock.links[0].from_node
            cols = [i.default_value for i in src.inputs
                    if i.type == "RGBA" and not i.is_linked]
            if not cols:
                continue
            n = len(cols)
            avg = [sum(c[k] for c in cols) / n for k in range(3)]
            for link in list(sock.links):
                nt.links.remove(link)
            sock.default_value = (avg[0], avg[1], avg[2], 1.0)
            fixed += 1
    print("  export colour: %d of %d materials had a linked Base Color and "
          "would have shipped WHITE" % (fixed, len(seen)))
    return fixed


def surface(name, colour, rough=0.8, scale=200.0, strength=0.25, dist=0.0004,
            spread=0.15, detail=6.0, metallic=0.0):
    """A `pbr` with a real SURFACE: noise on the bump for texture, and a narrow
    tint either side on colour for microvariation.

    Both halves matter and the apparel pass learned each the hard way. Bump
    alone leaves a face pointed at the key sitting at one flat value across its
    whole width, which is what makes a moulded prop read as painted plastic.
    Colour variation coarser than the grain reads as staining.

    `scale` IS IN GENERATED SPACE -- the object's bounding box, 0 to 1, not
    metres. 900 on a 112 mm sponge is eight noise cells per millimetre:
    sub-pixel at any camera that shows the whole object, so it averages to flat
    and the material has no visible effect at all despite being wired
    correctly. Roughly one cell per millimetre is what the eye reads as a
    surface, so pass about `1.1 * (the object's longest span in mm)`.
    """
    mat = pbr(name, colour, roughness=rough, metallic=metallic)
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = 0.55
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = dist
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    if spread > 0.0:
        v = nt.nodes.new("ShaderNodeTexNoise")
        v.inputs["Scale"].default_value = scale * 0.42
        v.inputs["Detail"].default_value = 4.0
        t = nt.nodes.new("ShaderNodeMix")
        t.data_type = "RGBA"
        lo, hi = 1.0 - spread, 1.0 + spread
        t.inputs["A"].default_value = (colour[0] * lo, colour[1] * lo,
                                       colour[2] * lo, 1.0)
        t.inputs["B"].default_value = (colour[0] * hi, colour[1] * hi,
                                       colour[2] * hi, 1.0)
        nt.links.new(v.outputs["Fac"], t.inputs["Factor"])
        nt.links.new(t.outputs[2], b.inputs["Base Color"])
    return mat


def pbr(name, colour, roughness=0.5, metallic=0.0, transmission=0.0, ior=1.45,
        coat=0.0, emission=None, emission_strength=2.0, alpha=1.0,
        show_back=True):
    """`alpha` is the transparency a RASTER engine can draw.

    Transmission is a path-tracing feature. Cycles renders a transmissive bottle
    beautifully and EEVEE renders it as a dark opaque blob -- and the game is a
    raster renderer, so a translucent asset authored with transmission has been
    authored for the engine that will never draw it. Alpha reads in both, and it
    is what a Three.js material would use.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Roughness"].default_value = roughness
    b.inputs["Metallic"].default_value = metallic
    if transmission and "Transmission Weight" in b.inputs:
        b.inputs["Transmission Weight"].default_value = transmission
    if "IOR" in b.inputs:
        b.inputs["IOR"].default_value = ior
    if coat and "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = coat
    # EMISSION WAS ACCEPTED AND SILENTLY DROPPED. The parameter has been in this
    # signature the whole time and nothing ever read it, which is why the cash
    # register's monitor rendered as a flat mint rectangle in BOTH engines and
    # the review recorded "no emission in either" -- the brief asked for an
    # emissive screen and the material never had one. An argument a function
    # accepts and ignores is worse than one it rejects.
    if emission is not None:
        if "Emission Color" in b.inputs:
            b.inputs["Emission Color"].default_value = (*emission, 1.0)
        elif "Emission" in b.inputs:
            b.inputs["Emission"].default_value = (*emission, 1.0)
        if "Emission Strength" in b.inputs:
            b.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        for attr, value in (("blend_method", "BLEND"),
                            ("surface_render_method", "BLENDED")):
            if hasattr(mat, attr):
                try:
                    setattr(mat, attr, value)
                except (TypeError, AttributeError):
                    pass
        # SHOW_BACK OFF is what a game renderer does. With it on you see the
        # object's own far wall through its near one, and on the spray bottle
        # that drew the liquid loft's back rings as a stack of hard concentric
        # ellipses -- read as banding or z-fighting, actually just both sides of
        # a translucent solid being drawn at once.
        if hasattr(mat, "show_transparent_back"):
            mat.show_transparent_back = show_back
    return mat
