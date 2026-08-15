"""Skeleton -> skin -> subdivision. One continuous surface with LOCAL control.

Metaballs gave continuity and took the features away with it: everything blends
into everything, so the fingers sank into the palm, the knuckle ridge smoothed
off, and the mass inflated wherever two structures overlapped. Three rounds of
tuning moved those faults around without fixing them, which is the point at which
the brief says change technique rather than grind.

The Skin modifier is the right tool for a limbed form. It sweeps a surface along
the EDGES of a skeleton rather than summing a field, so:

  - fingers stay separate however close they are, because nothing blends
  - a branch is a real junction, so a knuckle arc is a ridge in the surface
  - each vertex carries TWO radii, so a palm can be a slab and a finger a tube
    in the same mesh
  - the output is quads, which subdivide into something smooth instead of the
    marching-cube ripple that had to be relaxed out of the metaball version

The skeleton is written as named points and parent links, so the anatomy reads
as anatomy in the source rather than as a list of coordinates.
"""

import bpy
import bmesh
from mathutils import Vector


class Skeleton:
    """Points and links. Radii are SURFACE radii in metres; where a part is
    flatter than it is wide, pass a pair."""

    def __init__(self):
        self.points = {}
        self.order = []
        self.links = []
        self.root = None

    def add(self, name, co, radius, parent=None, root=False):
        self.points[name] = {"co": Vector(co), "radius": radius, "index": len(self.order)}
        self.order.append(name)
        if parent is not None:
            self.links.append((parent, name))
        if root:
            self.root = name
        return name

    def chain(self, prefix, start_parent, points):
        """A run of joints, each hanging off the last."""
        parent = start_parent
        names = []
        for i, (co, radius) in enumerate(points):
            parent = self.add(f"{prefix}{i}", co, radius, parent=parent)
            names.append(parent)
        return names

    def build(self, name="Skin", subdivisions=2, smooth=True):
        mesh = bpy.data.meshes.new(name)
        verts = [self.points[n]["co"] for n in self.order]
        edges = [(self.points[a]["index"], self.points[b]["index"]) for a, b in self.links]
        mesh.from_pydata([tuple(v) for v in verts], edges, [])
        mesh.update()

        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        skin = obj.modifiers.new("Skin", "SKIN")
        skin.use_smooth_shade = smooth
        skin.branch_smoothing = 0.30

        layer = mesh.skin_vertices[0].data
        for n in self.order:
            p = self.points[n]
            r = p["radius"]
            if isinstance(r, (tuple, list)):
                layer[p["index"]].radius = (r[0], r[1])
            else:
                layer[p["index"]].radius = (r, r)
        if self.root is not None:
            layer[self.points[self.root]["index"]].use_root = True

        if subdivisions:
            sub = obj.modifiers.new("Subdivision", "SUBSURF")
            sub.levels = subdivisions
            sub.render_levels = subdivisions
        return obj


def segment_gap(a0, a1, b0, b1, samples=9):
    """Approximate closest approach between two segments."""
    best = 1e9
    for i in range(samples + 1):
        p = a0.lerp(a1, i / samples)
        for k in range(samples + 1):
            q = b0.lerp(b1, k / samples)
            d = (p - q).length
            if d < best:
                best = d
    return best


def assert_digits_do_not_interpenetrate(sk, groups, tolerance=0.25):
    """Fail the build when two parts that should be separate are inside each
    other.

    This is the class that has shipped here repeatedly under different names --
    a divider buried in a carcass, bristles floating in air, and on this asset a
    thumb tip buried inside the index knuckle, which came out of the solver as a
    flat shard sticking through the back of the hand. It survived a render with
    the nails hidden, which is the only reason it was identified at all rather
    than being tuned around for another round.

    Adjacent fingers genuinely touch, so the tolerance is a FRACTION of the
    smaller radius: flesh in contact is fine, one digit a quarter of the way
    inside another is not.
    """
    def radius_of(name):
        r = sk.points[name]["radius"]
        return min(r) if isinstance(r, (tuple, list)) else r

    faults = []
    names = list(groups)
    for i in range(len(names)):
        for k in range(i + 1, len(names)):
            ga, gb = groups[names[i]], groups[names[k]]
            for a0, a1 in zip(ga, ga[1:]):
                for b0, b1 in zip(gb, gb[1:]):
                    gap = segment_gap(sk.points[a0]["co"], sk.points[a1]["co"],
                                      sk.points[b0]["co"], sk.points[b1]["co"])
                    ra = max(radius_of(a0), radius_of(a1))
                    rb = max(radius_of(b0), radius_of(b1))
                    allowed = (ra + rb) - tolerance * min(ra, rb)
                    if gap < allowed:
                        faults.append(
                            f"{names[i]} ({a0}-{a1}) and {names[k]} ({b0}-{b1}) "
                            f"are {gap * 1000:.1f} mm apart but occupy "
                            f"{(ra + rb) * 1000:.1f} mm")
    if faults:
        raise SystemExit("BUILD FAILED: parts interpenetrate\n  "
                         + "\n  ".join(faults))
    print(f"  interpenetration assertion passed across {len(names)} digits")


def conform_to_cylinder(obj, origin, direction, radius, epsilon=0.00012):
    """Press the grip onto the handle: any vertex inside the cylinder moves out
    to its surface.

    A single solve margin cannot give both zero penetration and zero daylight,
    because the skinned surface bulges past the skeleton segment by different
    amounts at different joints -- back it off enough to clear the shaft
    everywhere and the middle and ring fingers sit 3 mm off it.

    Flesh does not have that problem. A real grip flattens the finger pads
    against the handle, so the fingers are solved slightly CLOSED and the skin is
    then conformed to the cylinder. The result is contact patches where the pads
    press, which is what the reference photograph shows, and it satisfies both
    assertions by construction rather than by tuning between them.
    """
    direction = direction.normalized()
    moved = 0
    for v in obj.data.vertices:
        d = v.co - origin
        along = direction * d.dot(direction)
        radial = d - along
        r = radial.length
        if 1e-6 < r < radius + epsilon:
            v.co = origin + along + radial * ((radius + epsilon) / r)
            moved += 1
    obj.data.update()
    return moved


def relax(obj, factor=0.42, iterations=2):
    """Even out a surface that has just been pushed around.

    conform_to_cylinder moves every vertex inside the handle out to its surface
    and leaves the ones just outside where they were, so the boundary of each
    contact patch becomes a step -- which reads as a jagged, chipped silhouette
    edge exactly where the hand meets the pole. Relaxing afterwards blends the
    patch into the surrounding skin; the conform is then run a second time,
    because relaxing can push a vertex back inside.
    """
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    mod = obj.modifiers.new("Relax", "SMOOTH")
    mod.factor = factor
    mod.iterations = iterations
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.shade_smooth()
    return obj


def clean_loose(obj):
    """Drop vertices and edges that carry no face.

    The Skin modifier leaves a handful of these at failed junctions -- the build
    that shipped had three single-vertex "pieces" in it. OpenVDB will not take a
    mesh with loose geometry and fragments the result instead of unioning it,
    which is how a remesh turned five islands into seventy-six.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    loose_v = [v for v in bm.verts if not v.link_faces]
    loose_e = [e for e in bm.edges if not e.link_faces]
    bmesh.ops.delete(bm, geom=loose_e, context="EDGES")
    bmesh.ops.delete(bm, geom=[v for v in loose_v if v.is_valid], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return len(loose_v), len(loose_e)


def union_shells(obj, name="Hand"):
    """Merge every island into one connected surface with a Boolean union.

    The Skin modifier emits a SECOND CLOSED HULL instead of a junction at some
    branches. Moving the branch to its own vertex, and out far enough that parent
    and child radii no longer overlap, did not fix it -- the thumb stayed a
    546-vertex island. A voxel remesh made it worse, turning two shells into
    seventy-three, because it shatters on inconsistent normals.

    A Boolean union does not care why the hulls are separate. They overlap in
    space -- the thumb root is buried in the palm, which is what caused the
    problem in the first place -- so unioning them produces exactly one connected
    watertight surface, and the geometry stays where the solver put it.
    """
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")

    pieces = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    pieces.sort(key=lambda o: len(o.data.vertices), reverse=True)
    base, rest = pieces[0], pieces[1:]
    base.name = name
    for other in rest:
        mod = base.modifiers.new(f"U_{other.name}", "BOOLEAN")
        mod.operation = "UNION"
        mod.solver = "EXACT"
        mod.object = other
    bpy.context.view_layer.objects.active = base
    bpy.ops.object.select_all(action="DESELECT")
    base.select_set(True)
    bpy.ops.object.convert(target="MESH")
    base = bpy.context.view_layer.objects.active
    for other in rest:
        bpy.data.objects.remove(other, do_unlink=True)
    bpy.context.view_layer.objects.active = base
    base.select_set(True)
    bpy.ops.object.shade_smooth()
    print(f"  union: {len(pieces)} skin hulls -> {len(base.data.polygons)} faces")
    return base


def unify(obj, voxel=0.0010, smooth_shade=True):
    """Force the whole thing into ONE watertight surface.

    The Skin modifier fails at high-valence branches: where four or five bones
    meet, or where a child bone sits inside its parent's tube, it quietly emits a
    second closed hull instead of a junction. That is what made the thumb a
    354-vertex island sitting on the back of the hand -- clear of every other
    part, passing every part-versus-part check, and not attached to anything.

    Chasing branch radii fixes one instance and leaves the class. A voxel remesh
    fixes the class: overlapping hulls become one surface by definition, stray
    vertices disappear, and self-intersections are resolved rather than hidden.
    The cost is uniform topology, which the decimate pass was going to impose
    anyway.

    The voxel size has to stay well under the gap between adjacent fingers or
    they fuse into a mitten -- 1 mm against roughly 1.4 mm of clearance here.
    """
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    rem = obj.modifiers.new("Unify", "REMESH")
    rem.mode = "VOXEL"
    rem.voxel_size = voxel
    rem.adaptivity = 0.0
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.view_layer.objects.active
    if smooth_shade:
        bpy.ops.object.shade_smooth()
    return obj


def count_shells(obj):
    """How many disconnected pieces is this mesh actually made of?

    "Clear of every other part" and "attached to the thing it grows out of" are
    different claims, and the interpenetration assertion only ever tested the
    first. A thumb can pass every part-versus-part check and still be a separate
    island sitting on the back of the hand, which is what shipped.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    seen = set()
    shells = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack = [v]
        seen.add(v.index)
        size = 0
        while stack:
            cur = stack.pop()
            size += 1
            for e in cur.link_edges:
                other = e.other_vert(cur)
                if other.index not in seen:
                    seen.add(other.index)
                    stack.append(other)
        shells.append(size)
    bm.free()
    shells.sort(reverse=True)
    return shells


def assert_single_shell(obj, label="mesh"):
    shells = count_shells(obj)
    if len(shells) != 1:
        raise SystemExit(
            f"BUILD FAILED: {label} is {len(shells)} separate pieces "
            f"(vertex counts {shells[:8]}). Every digit must be continuous with "
            f"the palm -- a part clear of every other part can still be floating.")
    print(f"  single-shell assertion passed: {label} is one piece, {shells[0]} verts")


def axis_distance(p, origin, direction):
    """Distance from a point to an infinite line."""
    d = p - origin
    return (d - direction * d.dot(direction)).length


def assert_clear_of_cylinder(obj, origin, direction, radius, label="the hand",
                             tolerance=0.0006):
    """No part of the mesh may be inside the thing it is holding.

    The earlier assertion compared parts of the HAND to each other and passed,
    while the thumb ran straight through the shaft in turntable frame 3 -- the
    pole's own colour was visible inside the thumb's silhouette. Nothing was
    checking the hand against the object at all.
    """
    direction = direction.normalized()
    worst = 0.0
    inside = 0
    for v in obj.data.vertices:
        pen = radius - axis_distance(v.co, origin, direction)
        if pen > tolerance:
            inside += 1
            worst = max(worst, pen)
    if inside:
        raise SystemExit(
            f"BUILD FAILED: {inside} vertices of {label} are inside the shaft, "
            f"worst {worst * 1000:.1f} mm deep. The hand cannot pass through the "
            f"thing it is gripping.")
    print("  shaft-clearance assertion passed: no vertex inside the handle")


def assert_grip_contacts(obj, origin, direction, radius, regions, max_gap=0.0030):
    """Every digit has to actually TOUCH the handle.

    Clearing the shaft and gripping it are different claims. A build passes "no
    intersection" trivially by holding the pole at arm's length, and that is what
    the turntable showed: daylight between the fingers and the pole on the ulnar
    side, a hole you could see the background through.

    `regions` maps a name to a predicate over vertex position, so each digit is
    judged on its own -- one finger touching is not a grip.
    """
    direction = direction.normalized()
    gaps = {}
    for name, predicate in regions.items():
        best = 1e9
        for v in obj.data.vertices:
            if predicate(v.co):
                best = min(best, axis_distance(v.co, origin, direction) - radius)
        gaps[name] = best
    pretty = "  ".join(f"{n} {g * 1000:+.1f}mm" for n, g in sorted(gaps.items()))
    bad = {n: g for n, g in gaps.items() if g > max_gap}
    if bad:
        raise SystemExit(
            "BUILD FAILED: not touching the handle: "
            + ", ".join(f"{n} {g * 1000:+.1f} mm away" for n, g in sorted(bad.items()))
            + f"\n  all gaps: {pretty}")
    print(f"  grip-contact assertion passed: {pretty}")


def apply_modifiers(obj):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    return bpy.context.view_layer.objects.active


def flatten_by_bone(obj, bones, axis=2):
    """Squash each part of a finished mesh toward the axis of the bone it
    belongs to.

    Keying the squash on a COORDINATE looks simpler and is wrong: a curled
    finger occupies the same Y band as the palm it is curled over, so "flatten
    everything below y = 0.086" flattens the fingers as well, and it moves them
    off the joint positions everything downstream is calculated from. The nails
    then raycast into empty space and the build fails -- which is how this was
    caught rather than shipped.

    `bones` is a list of (a, b, factor). Each vertex is squashed by the factor of
    the bone it is nearest to, toward that bone's own axis, so the palm becomes a
    slab, the forearm stays oval, and the fingers are not touched at all.
    """
    prepared = [(Vector(a), Vector(b), f) for a, b, f in bones]
    for v in obj.data.vertices:
        best = None
        best_d = 1e9
        for a, b, f in prepared:
            ab = b - a
            t = max(0.0, min(1.0, (v.co - a).dot(ab) / max(1e-12, ab.dot(ab))))
            closest = a + ab * t
            d = (v.co - closest).length
            if d < best_d:
                best_d, best = d, (closest, f)
        if best is None or best[1] >= 0.999:
            continue
        closest, factor = best
        v.co[axis] = closest[axis] + (v.co[axis] - closest[axis]) * factor
    obj.data.update()


def flatten_region(obj, axis, centre_fn, factor_fn):
    """Squash part of a finished mesh toward a plane.

    The Skin modifier's two radii are expressed in a frame that follows the edge
    direction, so along a chain that turns -- a palm that arches into a wrist --
    "flat" rotates with it and the slab twists. Squashing afterwards is both
    simpler and exact: every vertex is pulled toward the palm plane by an amount
    that depends on where along the hand it sits, so the palm becomes a slab, the
    forearm stays oval and the fingers stay round.
    """
    for v in obj.data.vertices:
        f = factor_fn(v.co)
        if f >= 0.999:
            continue
        c = centre_fn(v.co)
        v.co[axis] = c + (v.co[axis] - c) * f
    obj.data.update()


def taper_tip(obj, tip_co, radius, squash=0.55):
    """Round a fingertip off.

    The Skin modifier ends a chain with a flat cap, which reads as a cut-off
    dowel -- the single most obvious "this is a modelled hand" tell after the
    silhouette. Pulling the cap vertices in toward the axis turns it into a
    finger pad.
    """
    tip = Vector(tip_co)
    for v in obj.data.vertices:
        d = (v.co - tip).length
        if d < radius * 1.35:
            t = 1.0 - (d / (radius * 1.35))
            v.co = v.co.lerp(tip, t * squash)
    obj.data.update()


def weld(obj, distance=0.0004):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=distance)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
