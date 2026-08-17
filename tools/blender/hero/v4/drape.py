"""v4 apparel: cloth that is SIMULATED, not lofted.

Everything in v3 was a surface of revolution with primitives bolted on, and
that single choice is what produced every fault on the board: a lofted tube
cannot have a shoulder (its rings are level), cannot have a fold (its rings
are convex), and cannot have a hem that wanders (its rings are closed curves
of one radius). So a sleeve became a cylinder, a pocket became a bar stuck to
the front, a hood became a disc, and a body flared into a bell because the
only way to widen a loft is to grow the radius.

This module does the opposite. It builds a plausible mid-surface, hangs it off
the points a real hanger actually touches, and lets Blender's cloth solver
find the shape. Gravity puts the folds in. Self-collision keeps the plies
apart. The garment is whatever falls out.

Nothing here asserts anything. The check is the render beside the photograph.
"""

import math

import bpy
import bmesh
from mathutils import Vector


# ---------------------------------------------------------------------------
# construction


def grid_mesh(name, rows, wrap_u=False, skip=None):
    """`rows[v][u]` -> a quad mesh. `skip(u, v)` drops the quad whose lower-left
    corner is (u, v), which is how the hood gets a face opening without a
    boolean."""
    nv = len(rows)
    nu = len(rows[0])
    verts = [Vector(p) for row in rows for p in row]
    faces = []
    ulim = nu if wrap_u else nu - 1
    for v in range(nv - 1):
        for u in range(ulim):
            if skip is not None and skip(u, v):
                continue
            u2 = (u + 1) % nu
            faces.append((v * nu + u, v * nu + u2,
                          (v + 1) * nu + u2, (v + 1) * nu + u))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob["nu"], ob["nv"] = nu, nv
    return ob


def jitter(ob, amp=0.0015, seed=1.0):
    """Break the mirror.

    A symmetric mesh under symmetric gravity settles symmetrically, and a
    garment whose left half is the mirror of its right half reads as
    manufactured no matter how good the folds are. Two millimetres of
    smooth noise before the solve is enough for the drape to diverge.
    """
    for v in ob.data.vertices:
        p = v.co
        n = (math.sin(p.x * 21.3 + seed) * math.sin(p.z * 13.7 - seed * 2.1)
             + 0.6 * math.sin(p.y * 31.1 - seed) * math.sin(p.z * 27.3 + seed))
        m = (math.sin(p.z * 9.1 + seed * 3.3) * math.cos(p.x * 17.9 - seed))
        v.co = p + Vector((n * amp, m * amp, n * amp * 0.35))


def vgroup(ob, name, idxs, weight=1.0):
    g = ob.vertex_groups.new(name=name)
    if idxs:
        g.add(list(idxs), weight, 'REPLACE')
    return g


def pin_where(ob, name, pred):
    idxs = [i for i, v in enumerate(ob.data.vertices) if pred(v.co, i)]
    vgroup(ob, name, idxs)
    return idxs


# ---------------------------------------------------------------------------
# the solve


# `mass` in Blender's cloth solver is PER VERTEX, not per unit area, and the
# spring stiffnesses do not scale with resolution. At the 0.3 default a 7,000
# vertex garment weighs two tonnes against springs sized for a tablecloth: it
# compressed 250 mm under its own weight and crumpled like wet paper, which
# read as a simulation problem and was an arithmetic one. These masses are the
# default scaled for a mesh of this density.
CLOTH_PRESETS = {
    # Fleece: heavy for cloth, and it barely stretches or shears. Tension 18 /
    # shear 6 let the side seams slide inward under the weight of the skirt
    # and coned the body -- real sweatshirt jersey will not shear like that.
    "fleece": dict(mass=0.090, tension=42.0, compression=42.0, shear=26.0,
                   bending=9.0, air=1.2),
    # cotton jersey: light, floppy, small folds
    "jersey": dict(mass=0.055, tension=16.0, compression=16.0, shear=6.0,
                   bending=1.6, air=1.1),
    # pique knit: a polo is crisper than a tee
    "pique": dict(mass=0.068, tension=22.0, compression=22.0, shear=10.0,
                  bending=3.4, air=1.1),
    # woven chino: holds a crease, resists bending hard
    "chino": dict(mass=0.085, tension=40.0, compression=40.0, shear=24.0,
                  bending=16.0, air=1.0),
}


def add_cloth(ob, preset="fleece", pin=None, quality=10, self_dist=0.0035,
              coll_dist=0.0035, damping=1.2, shrink=0.0, friction=1.0,
              mass=None):
    # `mass` overrides the preset. It is PER VERTEX, so it is a property of
    # this mesh at this resolution, not of the cloth: resize the garment or
    # change the row count and the right value moves with it.
    p = CLOTH_PRESETS[preset]
    m = ob.modifiers.new("Cloth", 'CLOTH')
    s = m.settings
    s.quality = quality
    s.mass = p["mass"] if mass is None else mass
    s.tension_stiffness = p["tension"]
    s.compression_stiffness = p["compression"]
    s.shear_stiffness = p["shear"]
    s.bending_stiffness = p["bending"]
    s.air_damping = p["air"]
    s.tension_damping = damping * 5.0
    s.compression_damping = damping * 5.0
    s.shear_damping = damping * 5.0
    s.bending_damping = damping * 0.5
    if shrink:
        s.shrink_min = shrink
    s.bending_model = 'ANGULAR'
    if pin:
        s.vertex_group_mass = pin
        s.pin_stiffness = 5.0
    c = m.collision_settings
    c.use_self_collision = True
    c.self_distance_min = self_dist
    # FRICTION IS WHY THE SLEEVES CONCERTINA. At self_friction 6 a sleeve
    # resting against the body grips it, gravity keeps pulling from above, and
    # the sleeve stacks up on itself in accordion pleats instead of hanging.
    # Cloth on cloth does grip -- but a sleeve that has already settled is
    # sliding, not gripping, and the solver has no way to tell those apart.
    c.self_friction = friction * 0.5
    c.distance_min = coll_dist
    c.friction = friction
    c.collision_quality = 4
    return m


def add_collision(ob, thickness=0.003, damping=0.30, friction=0.45):
    ob.modifiers.new("Collision", 'COLLISION')
    ob.collision.thickness_outer = thickness
    ob.collision.thickness_inner = thickness
    ob.collision.damping_factor = damping
    ob.collision.cloth_friction = friction * 80.0
    return ob


def bake(frames, gravity=(0.0, 0.0, -9.81)):
    """Step the frames. `ptcache.bake` needs a window in 5.x; stepping does not,
    and the probe proved stepping actually integrates."""
    scene = bpy.context.scene
    scene.use_gravity = True
    scene.gravity = gravity
    scene.frame_start, scene.frame_end = 1, frames
    for ob in bpy.data.objects:
        for m in ob.modifiers:
            if m.type == 'CLOTH':
                m.point_cache.frame_start = 1
                m.point_cache.frame_end = frames
    dg = bpy.context.evaluated_depsgraph_get()
    for f in range(1, frames + 1):
        scene.frame_set(f)
        dg.update()


def freeze(ob):
    """Take the simulated shape and make it the mesh."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, depsgraph=dg)
    me.name = ob.data.name + "_baked"
    keep = {k: ob[k] for k in ob.keys() if k in ("nu", "nv")}
    old = ob.data
    ob.data = me
    ob.modifiers.clear()
    bpy.data.meshes.remove(old)
    for k, v in keep.items():
        ob[k] = v
    bpy.context.scene.frame_set(1)
    return ob


def travelled(ob, before):
    after = [Vector(v.co) for v in ob.data.vertices]
    if len(after) != len(before):
        return -1.0
    return max((a - b).length for a, b in zip(after, before))


# ---------------------------------------------------------------------------
# after the solve


def despike(ob, tol=3.0, passes=3):
    """Pull back vertices the solver threw.

    A cloth solve on clean topology still loses the occasional vertex, and one
    lost vertex is a 300 mm needle through the render -- it survives solidify,
    it survives smoothing, and it is the first thing the eye finds. A vertex
    sitting further from its neighbours' average than `tol` times the mean
    edge length around it did not get there by draping.
    """
    me = ob.data
    nbrs = [[] for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices
        nbrs[a].append(b)
        nbrs[b].append(a)
    fixed = 0
    for _ in range(passes):
        co = [Vector(v.co) for v in me.vertices]
        hit = 0
        for i, v in enumerate(me.vertices):
            n = nbrs[i]
            if len(n) < 2:
                continue
            avg = sum((co[j] for j in n), Vector()) / len(n)
            edge = sum((co[j] - co[i]).length for j in n) / len(n)
            if (co[i] - avg).length > tol * edge:
                v.co = avg
                hit += 1
        fixed += hit
        if not hit:
            break
    return fixed


def relax(ob, rounds=2, factor=0.42, keep_boundary=False):
    """A light Laplacian pass. The solver leaves a little per-vertex chatter at
    self-collision contacts; two rounds take it out without touching the
    folds, which are two orders of magnitude larger."""
    me = ob.data
    nbrs = [[] for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices
        nbrs[a].append(b)
        nbrs[b].append(a)
    frozen = set()
    if keep_boundary:
        # LAPLACIAN SMOOTHING SHRINKS AN OPEN SHEET. Every boundary vertex is
        # pulled toward the interior because it has neighbours on one side
        # only, so the panel walks inward a little on every round -- the pocket
        # came out 306 mm wide against a 372 mm outline, and the missing 66 mm
        # read as "the pocket is too small" rather than as a smoothing bug.
        cnt = {}
        for p in me.polygons:
            for ek in p.edge_keys:
                cnt[ek] = cnt.get(ek, 0) + 1
        for e in me.edges:
            if cnt.get(tuple(sorted(e.vertices)), 0) == 1:
                frozen.update(e.vertices)
    for _ in range(rounds):
        co = [Vector(v.co) for v in me.vertices]
        for i, v in enumerate(me.vertices):
            n = nbrs[i]
            if not n or i in frozen:
                continue
            avg = sum((co[j] for j in n), Vector()) / len(n)
            v.co = co[i].lerp(avg, factor)


def boundary_loops(ob):
    """Every open edge loop in the mesh, as ordered lists of vertex indices.

    After the solve the armholes and the neckline are no longer where they were
    built -- they have moved with the cloth. The sleeves and the hood have to be
    grown from where those openings ACTUALLY ended up, or they weld to thin air.
    """
    me = ob.data
    link = {}
    for e in me.edges:
        link.setdefault(e.vertices[0], []).append(e.index)
        link.setdefault(e.vertices[1], []).append(e.index)
    face_count = {}
    for p in me.polygons:
        for ek in p.edge_keys:
            face_count[ek] = face_count.get(ek, 0) + 1
    bedges = [e for e in me.edges
              if face_count.get(tuple(sorted(e.vertices)), 0) == 1]
    adj = {}
    for e in bedges:
        a, b = e.vertices
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    seen, loops = set(), []
    for start in adj:
        if start in seen:
            continue
        loop, cur, prev = [start], start, None
        seen.add(start)
        while True:
            nxt = [n for n in adj.get(cur, []) if n != prev]
            nxt = [n for n in nxt if n not in seen] or \
                  [n for n in nxt if n == start]
            if not nxt:
                break
            n = nxt[0]
            if n == start:
                break
            loop.append(n)
            seen.add(n)
            prev, cur = cur, n
        if len(loop) > 3:
            loops.append(loop)
    return loops


def order_loop(ob, idxs, centre, axis, ref):
    """Sort a loop's vertices by angle about `axis`, so a tube grown from it
    does not corkscrew."""
    axis = Vector(axis).normalized()
    e1 = (Vector(ref) - axis * Vector(ref).dot(axis)).normalized()
    e2 = axis.cross(e1)
    out = []
    for i in idxs:
        d = ob.data.vertices[i].co - Vector(centre)
        out.append((math.atan2(d.dot(e2), d.dot(e1)), i))
    out.sort()
    return [i for _a, i in out]


def keep_outside(ob, target, offset=0.007, only=None):
    """Push `ob` out of `target` instead of through it.

    A sleeve hanging beside a body genuinely overlaps it -- the two mid-surfaces
    end up about two cloth thicknesses apart. Simulating that contact was what
    destroyed five solves in a row. Projecting it is exact, instant, and cannot
    diverge.
    """
    from mathutils.bvhtree import BVHTree
    verts = [v.co.copy() for v in target.data.vertices]
    polys = [tuple(p.vertices) for p in target.data.polygons]
    bvh = BVHTree.FromPolygons(verts, polys)
    moved = 0
    for v in ob.data.vertices:
        if only is not None and not only(v.co):
            continue
        loc, nrm, _i, _d = bvh.find_nearest(v.co)
        if loc is None:
            continue
        if (v.co - loc).dot(nrm) < offset:
            v.co = loc + nrm * offset
            moved += 1
    return moved


def push_out_radial(ob, target, axis=(0.0, 0.0), offset=0.007, only=None):
    """Push out along a ray from the body's axis, not to the nearest point.

    Nearest-point projection is what a Shrinkwrap does, and on a sleeve lying
    against a torso it collapses: a dozen vertices sitting deep inside all
    share one nearest point on the surface and land on the same square
    millimetre, which is a zero-area face and a non-manifold edge. Projecting
    along the radial ray keeps the vertices spread by ANGLE, so the sleeve
    arrives as a clean crescent wrapped over the side seam -- which is what a
    sleeve with no arm in it actually is.
    """
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromPolygons([v.co.copy() for v in target.data.vertices],
                               [tuple(p.vertices) for p in target.data.polygons])
    ax, ay = axis
    moved, missed = 0, 0
    for v in ob.data.vertices:
        if only is not None and not only(v.co):
            continue
        d = Vector((v.co.x - ax, v.co.y - ay, 0.0))
        if d.length < 1e-5:
            continue
        d.normalize()
        org = Vector((ax, ay, v.co.z))
        hit, nrm, _i, dist = bvh.ray_cast(org, d, 2.0)
        if hit is None:
            missed += 1
            continue
        # A GRAZING HIT IS NOT A HIT. Where the ray runs nearly tangent to the
        # body -- around the back of the side seam -- `dist` swings wildly
        # between neighbouring vertices and they land on top of each other.
        # Every non-manifold edge left after the radial fix was in that one
        # band. Leave those vertices where they are.
        if nrm is not None and d.dot(nrm) < 0.30:
            missed += 1
            continue
        have = (v.co - org).dot(d)
        if have < dist + offset:
            v.co = org + d * (dist + offset)
            moved += 1
    return moved, missed


def drape_folds(ob, amp, z_top, z_bot, harmonics, axis=(0.0, 0.0),
                seed=0.0, side_bias=0.55, pred=None, gate=None):
    """Vertical drape folds, displaced along the horizontal surface normal.

    Cloth hanging off two shoulder points does not wrinkle randomly. It falls
    in near-vertical folds that START at the supports, widen and deepen as they
    descend, drift slightly off-vertical on the way down, and die out where the
    hem is gathered. `harmonics` is a list of (folds-around, amplitude, drift).
    """
    me = ob.data
    cx, cy = axis
    biggest = 0.0
    for v in me.vertices:
        if pred is not None and not pred(v.co):
            continue
        z = v.co.z
        t = (z_top - z) / max(1e-6, (z_top - z_bot))
        if t <= 0.0:
            continue
        t = min(1.0, t)
        grow = _smooth(t, 0.06, 0.62) * (1.0 - 0.45 * _smooth(t, 0.86, 1.0))
        th = math.atan2(v.co.x - cx, -(v.co.y - cy))
        # the front and back panels are broad and calm; the sides carry the folds
        s = (1.0 - side_bias) + side_bias * abs(math.sin(th))
        d = 0.0
        for (n, a, drift) in harmonics:
            c = math.cos(n * th + seed * (n * 0.37 + 1.0) + drift * t)
            # A PURE COSINE IS NOT A FOLD. Cloth bends along a LINE: broad calm
            # panels with a crease between them. Shaping the wave gives the
            # valleys their sharpness back, and it is the sharpness that catches
            # a shadow and makes a fold visible at all.
            d += a * math.copysign(abs(c) ** 0.62, c)
        nrm = Vector((v.normal.x, v.normal.y, 0.0))
        if nrm.length < 1e-5:
            continue
        g = 1.0 if gate is None else gate(v.co)
        if g <= 0.0:
            continue
        off = d * amp * grow * s * g
        biggest = max(biggest, abs(off))
        v.co = v.co + nrm.normalized() * off
    return biggest


def _smooth(x, a, b):
    if x <= a:
        return 0.0
    if x >= b:
        return 1.0
    t = (x - a) / (b - a)
    return t * t * (3 - 2 * t)


def topstitch(name, pts, radius=0.00072, sides=6):
    """A thread lying on the cloth.

    A seam a millimetre wide cannot be a displacement: at 15 mm between
    columns the mesh has nothing to bend, and the groove came out invisible.
    Real topstitching stands PROUD -- it is thread lying on top of the cloth,
    and it reads because it catches a highlight along its length. Geometry is
    the right answer here and it costs almost nothing.
    """
    rows = []
    n = len(pts)
    for i, p in enumerate(pts):
        p = Vector(p)
        tan = Vector(pts[min(n - 1, i + 1)]) - Vector(pts[max(0, i - 1)])
        tan = tan.normalized() if tan.length > 1e-9 else Vector((0, 0, 1))
        e1 = tan.cross(Vector((0, 1, 0)))
        if e1.length < 1e-6:
            e1 = tan.cross(Vector((1, 0, 0)))
        e1.normalize()
        e2 = tan.cross(e1).normalized()
        rows.append([tuple(p + e1 * (radius * math.cos(2 * math.pi * k / sides))
                           + e2 * (radius * math.sin(2 * math.pi * k / sides)))
                     for k in range(sides)])
    return grid_mesh(name, rows, wrap_u=True)


def on_surface(target, x, z, out=0.0011, axis_y=-1.0):
    """Where a point (x, z) lands on the front or back of a garment, held off
    it by `out`. Ray cast, never nearest-point."""
    from mathutils.bvhtree import BVHTree
    if not hasattr(on_surface, "_cache") or on_surface._cache[0] is not target:
        bvh = BVHTree.FromPolygons(
            [v.co.copy() for v in target.data.vertices],
            [tuple(p.vertices) for p in target.data.polygons])
        on_surface._cache = (target, bvh)
    bvh = on_surface._cache[1]
    org = Vector((x, 0.9 * axis_y, z))
    hit, nrm, _i, _d = bvh.ray_cast(org, Vector((0.0, -axis_y, 0.0)), 2.0)
    if hit is None:
        return None
    return hit + Vector((0.0, axis_y * out, 0.0))


def solidify(ob, thickness, offset=0.0, rim=True):
    """EVEN OFFSET IS A TRAP ON CLOTH.

    It scales each vertex's extrusion by 1/sin of the corner angle so that a
    folded sheet keeps a constant wall thickness -- and at a seam corner where
    that angle approaches zero the divisor approaches zero with it. Two such
    corners on the armhole weld extruded a 3.4 mm shell into an EIGHTEEN METRE
    spike, and every render after that was a grey dot in the far distance.
    A clamp is kept as a second line even with even-offset off.
    """
    m = ob.modifiers.new("Solidify", 'SOLIDIFY')
    m.thickness = thickness
    m.offset = offset
    m.use_rim = rim
    m.use_rim_only = False
    m.use_even_offset = False
    m.thickness_clamp = 1.6
    m.use_quality_normals = True
    return m


def shade_smooth(ob, angle=46.0):
    for p in ob.data.polygons:
        p.use_smooth = True
    mod = ob.modifiers.new("Smooth by Angle", 'NODES')
    ng = bpy.data.node_groups.get("Smooth by Angle")
    if ng is None:
        try:
            bpy.ops.object.select_all(action='DESELECT')
            ob.select_set(True)
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))
            ob.modifiers.remove(mod)
            return
        except Exception:
            ob.modifiers.remove(mod)
            return
    mod.node_group = ng
    for k in mod.keys():
        if k.startswith("Socket") or k.startswith("Input"):
            try:
                mod[k] = math.radians(angle)
            except Exception:
                pass


def apply_all(ob):
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    out = bpy.context.view_layer.objects.active
    if not out.data.materials:
        out.data.materials.clear()
    return out


def strip_loose(ob):
    """Vertices with no face. `grid_mesh` emits one per grid position, so the
    armhole window leaves a raft of them floating in the middle of the
    shoulder -- free particles for the solver and stray points in the export."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return len(loose)


def pin_nearest(ob, name, points, radius=0.004):
    """Pin by POSITION, not by index. Joining and welding renumber everything,
    so a grid index recorded at build time points somewhere else by the time
    the solver runs."""
    from mathutils import kdtree
    me = ob.data
    kd = kdtree.KDTree(len(me.vertices))
    for i, v in enumerate(me.vertices):
        kd.insert(v.co, i)
    kd.balance()
    idxs = set()
    for p in points:
        for (_co, i, d) in kd.find_range(Vector(p), radius):
            idxs.add(i)
        else:
            co, i, d = kd.find(Vector(p))
            if d < radius * 3:
                idxs.add(i)
    vgroup(ob, name, sorted(idxs))
    return sorted(idxs)


def soft_pin(ob, name, weight_fn):
    """A pin group with PARTIAL weights.

    Weight 1 is the hanger. A weight of about 0.1 elsewhere is a light spring
    back to the constructed position -- enough that the solver adds folds
    without being free to redesign the silhouette, which is the difference
    between simulating a garment and dropping a bag of cloth. Return 0 for
    anything that should be governed by gravity alone: hems, cuffs, the hood.
    """
    g = ob.vertex_groups.new(name=name)
    n = 0
    for i, v in enumerate(ob.data.vertices):
        w = weight_fn(v.co)
        if w > 0.0:
            g.add([i], min(1.0, w), 'REPLACE')
            n += 1
    return g, n


def weld(ob, dist=1e-4):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def cleanup(ob, dist=1.5e-5):
    """Collapse the slivers projection leaves behind.

    `keep_outside` moves every vertex that was inside the body onto its
    surface, and two vertices that were both deep inside can land on the same
    square millimetre. That is a zero-area face and a non-manifold edge, and it
    shows up as a black speck in the render long before anyone thinks to run a
    topology check.
    """
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.dissolve_degenerate(bm, dist=dist, edges=bm.edges[:])
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=dist)
    # Whatever is still non-manifold after that is two sheets that happen to
    # share an edge -- the sleeve lying on the body at the armhole. RIP them
    # apart rather than chasing the tolerance: the vertices stay exactly where
    # they are, so nothing moves in the render, and the mesh stops being a
    # thing Solidify can misread.
    bad = [e for e in bm.edges if len(e.link_faces) > 2]
    if bad:
        bmesh.ops.split_edges(bm, edges=bad)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return len(bad)


def decimate(ob, ratio):
    m = ob.modifiers.new("Decimate", 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = ratio
    m.use_collapse_triangulate = False
    return m


def tri_count(objs):
    n = 0
    for ob in objs:
        for p in ob.data.polygons:
            n += len(p.vertices) - 2
    return n


# ---------------------------------------------------------------------------
# fabric detail applied AFTER the solve, so the solver cannot smooth it away


def ribbing(ob, pred, axis_fn, ribs=48, depth=0.0012, phase=0.0):
    """Vertical ribs on a knit band.

    A waistband is not a smooth cylinder with a seam drawn on it -- the read is
    a fine corduroy running the short way, catching a line of highlight per
    rib. `pred(co)` selects the band; `axis_fn(co)` gives the outward normal
    and the angle around the band.
    """
    for v in ob.data.vertices:
        if not pred(v.co):
            continue
        nrm, ang = axis_fn(v.co)
        v.co = v.co + nrm * (math.cos(ang * ribs + phase) * depth)


def seam_groove(ob, z, depth=0.0022, width=0.0055, centre=(0.0, 0.0)):
    """A crease line at one height.

    A waistband that is merely narrower than the body still reads as the same
    piece of cloth tapering. What says SEWN is the groove where the two panels
    join -- one dark line, two millimetres deep, and the band below it becomes
    a separate component to the eye.
    """
    cx, cy = centre
    for v in ob.data.vertices:
        d = abs(v.co.z - z)
        if d > width * 2.2:
            continue
        r = Vector((v.co.x - cx, v.co.y - cy, 0.0))
        if r.length < 1e-6:
            continue
        f = math.exp(-(d / width) ** 2)
        v.co = v.co - r.normalized() * (depth * f)


def band_pull(ob, z_top, z_bot, amount=0.018, centre=(0.0, 0.0)):
    """Pull a band in towards its axis, and blouse the cloth just above it.

    The single strongest cue that a hem is RIBBED and not cut is that the
    garment is narrower there than it is 60 mm higher up.
    """
    cx, cy = centre
    for v in ob.data.vertices:
        z = v.co.z
        if z > z_top + 0.075 or z < z_bot - 0.002:
            continue
        if z <= z_top:
            t = 1.0
        else:
            t = 1.0 - (z - z_top) / 0.075
            t = t * t * (3 - 2 * t)
            t = -t * 0.34          # blouse OUT just above the band
        d = Vector((v.co.x - cx, v.co.y - cy, 0.0))
        if d.length < 1e-6:
            continue
        v.co = v.co - d.normalized() * (amount * t)


def unwrap(ob, angle=68.0, margin=0.006, label=""):
    """Give a garment real UVs, and say what texel density they buy.

    Two reasons, and the second is the one that matters for the art.

    The technical one: most apparel primitives shipped with no TEXCOORD_0 at
    all, so every requirement about texel density, logo stretching or an atlas
    was vacuous rather than met, and nothing in the set could ever carry a
    printed label or a baked weave.

    The visual one: a `ShaderNodeTexNoise` with no Vector input samples
    GENERATED space -- a 3-D volume normalised to the bounding box. Slice that
    with a garment and the "weave" does not follow the cloth: on a sleeve, which
    is a thin diagonal part of a 600 mm box, the noise stretches along the
    sleeve's axis and the fabric reads as smeared plastic exactly where the
    player looks closest. Sampling in UV space instead makes the grain follow
    the surface, which is what a woven or knitted cloth does.

    Returns texels per metre at a 1024 map, which is the number to compare
    against the 768/yd hero ceiling.
    """
    import bmesh
    if ob.type != "MESH" or not ob.data.polygons:
        return 0.0
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    if not ob.data.uv_layers:
        ob.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle),
                             island_margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')

    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uvl = bm.loops.layers.uv.active
    area3d = sum(f.calc_area() for f in bm.faces)
    area_uv = 0.0
    for f in bm.faces:
        ls = f.loops
        acc = 0.0
        for i in range(len(ls)):
            a = ls[i][uvl].uv
            b = ls[(i + 1) % len(ls)][uvl].uv
            acc += a.x * b.y - b.x * a.y
        area_uv += abs(acc) * 0.5
    bm.free()
    if area3d <= 0.0 or area_uv <= 0.0:
        return 0.0
    # texels per metre at 1024: sqrt(uv area) * 1024 / sqrt(surface area)
    density = math.sqrt(area_uv) * 1024.0 / math.sqrt(area3d)
    if label:
        print("  UV %s: %.0f texels/m at 1024 (%.3f m2 into %.1f%% of the map)"
              % (label, density, area3d, area_uv * 100.0))
    return density
