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
