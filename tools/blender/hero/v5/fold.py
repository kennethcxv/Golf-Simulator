"""Folding an actual sheet. The other half of the method change.

The four folded garments in v4 are stacks of pillows because that is literally
what they are: separate slab objects, one per ply, each with the same bevel
radius, arranged in a pile. Nothing in them was ever a garment, so no amount of
crease work could make one read as a folded garment -- there was no sleeve to
fold and no neckline to end up on top.

Here a folded garment is the SAME drafted pattern as its hanging twin, laid flat
on a table and then folded, one fold at a time, with a real hinge.

THE HINGE. A fold is a rotation of everything past a line through 180 degrees,
around a cylinder whose radius is set by the cloth that has to get around the
corner. Written as a map on the sheet:

    s  = signed distance from the fold line
    r  = R - (z - z0)                 distance below the hinge axis
    th = min(s / R, pi)               arc length along the neutral fibre
    s' = r sin(th) - max(0, s - pi R)
    z' = z0 + R - r cos(th)

At s = 0 nothing moves. Through the hinge the material follows the cylinder. Past
th = pi it is travelling back the other way, one hinge-diameter higher. The panel
either side of the hinge is RIGID -- it is not deformed at all, which is why the
result is flat panels meeting at a crisp line instead of a smooth bulge, and it
is the same reason a real fold looks like that.

R is the only parameter and it is a physical one: half the gap between the two
plies, so about the thickness of the cloth that is folding. 4 mm on a jersey tee
gives the tight fold retail staff make; 9 mm on a fleece hoodie gives the fat one
a hoodie makes. It is NOT a smoothing radius and it does not apply to anything
except the hinge.

There is no sine term in this module. `sin` and `cos` appear only as the
parametrisation of the hinge cylinder, which is a circle.
"""

import math

import bpy
from mathutils import Vector


def fold(ob, axis, cut, radius=0.0, side=+1, gap=0.0009, near=0.030):
    """Fold the material on one side of a line over onto the other side.

    THE HINGE AXIS IS SET BY WHERE THE FLAP HAS TO LAND, not by a radius chosen
    in advance. That is the correction that made this work: with a fixed radius
    and the axis pinned to the top of the stack, every fold swung the flap up in
    an arc as tall as the stack already was, so five folds on a tee produced a
    601 mm tower on a 662 mm footprint -- v4's fault reproduced by arithmetic.

    Put the axis half way between the top of what the flap lands on and the top
    of the flap itself:

        A  = (z_land + z_flap) / 2
        r  = A - z            per point: the outer ply turns on a shorter radius
        th = min(s / r, pi)
        s' = r sin th - max(0, s - pi r)
        z' = A - r cos th

    At s = 0 nothing moves. At th = pi the point is at 2A - z, so the flap's own
    top lands exactly on the stack's top and the new top is the old one plus the
    flap's thickness. The panels either side are rigid, so what is left is flat
    faces meeting at a crisp line -- and the hinge's radius comes out as the
    cloth's own thickness, which is why a real fold looks like that.

    `radius` is a floor on the hinge radius, for cloth that will not fold to a
    knife edge.
    """
    me = ob.data
    ax = 0 if axis == 'x' else 1
    land, flap = [], []
    for v in me.vertices:
        d = (v.co[ax] - cut) * side
        if d <= 0.0:
            if -d < near:
                land.append(v.co.z)
        else:
            flap.append(v.co.z)
    if not flap:
        return ob
    z_land = max(land) if land else 0.0
    z_flap = max(flap)
    A = (z_land + z_flap) * 0.5 + gap
    eps = max(1e-5, radius)
    # CLOTH SLIPS. PAPER DOES NOT. Giving every point its own arc radius
    # r = A - z is right for a rigid sheet and wrong for a stack of cloth: two
    # plies 1.5 mm apart land pi * 1.5 = 4.7 mm apart, and over four plies the
    # free edges fan out 19 mm. That is the whole of "the folded trousers'
    # plies splay" -- it was arithmetic, not sag, and no amount of settling
    # could have closed it.
    #
    # Real cloth shears between plies as it goes round the fold, so the plies
    # come off the hinge FLUSH. One arc length for the whole flap, measured on
    # the ply that has the longest way to go, and r still varies with z so the
    # stack keeps its thickness and the mirror at th = pi is exact.
    z_ref = min((v.co.z for v in me.vertices
                 if (v.co[ax] - cut) * side > 0.0), default=0.0)
    R = max(eps, A - z_ref)
    for v in me.vertices:
        p = v.co
        s = (p[ax] - cut) * side
        if s <= 0.0:
            continue
        r = max(eps, A - p.z)
        th = min(s / R, math.pi)
        sp = R * math.sin(th) - max(0.0, s - math.pi * R)
        q = Vector(p)
        q[ax] = cut + sp * side
        q.z = A - r * math.cos(th)
        v.co = q
    me.update()
    return ob


def _fold_fixed(ob, axis, cut, radius, side=+1, up=+1, resolve=None):
    """Fold the material on one side of a line over onto the other side.

    `axis` is 'x' or 'y': the coordinate that the fold line is a constant of.
    `cut` is that constant. `side` +1 folds the material at greater coordinate,
    -1 the lesser. `up` +1 means the moving flap ends up on top.

    Everything is in the object's local space with the sheet lying in the XY
    plane, z up. `resolve` is the z of the hinge base -- normally the top of the
    stack already there, so that a second fold rides over the first instead of
    through it.
    """
    me = ob.data
    ax = 0 if axis == 'x' else 1
    R = float(radius)
    z0 = _stack_top(me, axis, cut, side) if resolve is None else float(resolve)
    for v in me.vertices:
        p = v.co
        s = (p[ax] - cut) * side
        if s <= 0.0:
            continue
        r = R - (p.z - z0) * up
        th = min(s / R, math.pi)
        sp = r * math.sin(th) - max(0.0, s - math.pi * R)
        zp = z0 + (R - r * math.cos(th)) * up
        q = Vector(p)
        q[ax] = cut + sp * side
        q.z = zp
        v.co = q
    me.update()
    return ob


def _stack_top(me, axis, cut, side):
    """The z the flap has to clear: the highest material it will land on."""
    ax = 0 if axis == 'x' else 1
    hi = None
    for v in me.vertices:
        if (v.co[ax] - cut) * side <= 0.0:
            hi = v.co.z if hi is None else max(hi, v.co.z)
    return 0.0 if hi is None else hi


def fold_seq(ob, steps):
    """Apply folds in order. Each one sees the geometry the last one left."""
    for st in steps:
        fold(ob, st["axis"], st["cut"], st.get("radius", 0.0),
             st.get("side", 1), st.get("gap", 0.0009))
    return ob


def settle(ob, floor_z=0.0, sag=0.0016, corner=0.55):
    """Let the folded stack relax onto the shelf.

    Two things a real folded garment does that a rigid fold sequence does not:
    the free corners of the top ply sag a little over the edge below, and the
    whole stack compresses where it is thickest. Both are functions of how far a
    point is from the nearest fold -- the fold is the stiff part -- so they are
    written as a falloff on that distance, not as a wave.
    """
    me = ob.data
    zs = [v.co.z for v in me.vertices]
    lo, hi = min(zs), max(zs)
    span = max(1e-6, hi - lo)
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    cx, cy = (min(xs) + max(xs)) * 0.5, (min(ys) + max(ys)) * 0.5
    hx, hy = max(1e-6, (max(xs) - min(xs)) * 0.5), max(1e-6, (max(ys) - min(ys)) * 0.5)
    for v in me.vertices:
        p = v.co
        h = (p.z - lo) / span
        e = max(abs(p.x - cx) / hx, abs(p.y - cy) / hy)
        # sag only near the outline, only on the upper plies
        w = h * max(0.0, (e - corner) / max(1e-6, 1.0 - corner)) ** 1.6
        p.z -= sag * w * 6.0
        # and a light overall compression where the stack is deep
        p.z = lo + (p.z - lo) * (1.0 - 0.035 * h)
        if p.z < floor_z:
            p.z = floor_z
    me.update()
    return ob


def press(ob, faces_axis='z', amount=0.0006):
    """Flatten the ply faces a touch.

    A folded garment on a shelf has been pressed by the garment above it: the
    broad faces are flatter than the cloth wants to be. This nudges every vertex
    toward the local mean plane of its ply, which removes construction noise from
    the big flat faces without touching the fold lines (where the local plane is
    ambiguous and the weight comes out near zero).
    """
    me = ob.data
    me.calc_loop_triangles()
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    for v in bm.verts:
        ns = [f.normal for f in v.link_faces]
        if len(ns) < 2:
            continue
        avg = sum(ns, Vector((0, 0, 0)))
        if avg.length < 1e-9:
            continue
        avg.normalize()
        # only where the ply really is flat: all faces agreeing with the mean
        agree = min(n.normalized().dot(avg) for n in ns)
        if agree < 0.986:
            continue
        nb = [e.other_vert(v).co for e in v.link_edges]
        if not nb:
            continue
        m = sum(nb, Vector((0, 0, 0))) / len(nb)
        d = (m - v.co).dot(avg)
        v.co = v.co + avg * (d * 0.85)
    bm.to_mesh(me)
    bm.free()
    me.update()
    return ob


def lay_flat(ob, z=0.0):
    """Drop the sheet so its lowest point is at z. Folds are computed in the
    sheet's own frame, so this runs before them."""
    me = ob.data
    lo = min(v.co.z for v in me.vertices)
    for v in me.vertices:
        v.co.z += z - lo
    me.update()
    return ob


def rotate_z(ob, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    for v in ob.data.vertices:
        x, y = v.co.x, v.co.y
        v.co.x, v.co.y = x * c - y * s, x * s + y * c
    ob.data.update()
    return ob


def stack_on(ob, others, gap=0.0011):
    """Lift `ob` so it rests on top of `others`."""
    if not others:
        return ob
    top = max(max(v.co.z for v in o.data.vertices) + o.location.z
              for o in others)
    lo = min(v.co.z for v in ob.data.vertices)
    ob.location.z += top + gap - (lo + ob.location.z)
    return ob


def extent(ob):
    xs = [v.co.x for v in ob.data.vertices]
    ys = [v.co.y for v in ob.data.vertices]
    zs = [v.co.z for v in ob.data.vertices]
    return ((max(xs) - min(xs)), (max(ys) - min(ys)), (max(zs) - min(zs)))
