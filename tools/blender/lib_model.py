# Modelling helpers shared by the clubhouse asset scripts.
#
# The first attempt at this merchandise assembled detached primitives — a box
# torso with two floating box sleeves, a plank sole with an egg stuck on the toe.
# Rendered, they read WORSE than the primitives they were meant to replace,
# because a shirt and a shoe are not assemblies: they are continuous surfaces.
#
# So the two workhorses here are:
#   loft()          — bridge a stack of cross-sections into one closed shell.
#                     This is how you model a shoe, a bag, a club head.
#   outline_solid() — take a 2D silhouette, fill it, give it thickness.
#                     This is how you model a flat garment.
#
# Both produce ONE watertight mesh that bevels and subdivides into a soft,
# readable form instead of a pile of parts.

import bpy
import bmesh
import math


def _new_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    return o


def loft(name, sections, cap=True):
    """sections: list of rings, each a list of (x,y,z) with the SAME point count.
    Bridges consecutive rings into a closed tube and caps the ends."""
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in sec] for sec in sections]
    bm.verts.ensure_lookup_table()
    n = len(sections[0])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for j in range(n):
            k = (j + 1) % n
            bm.faces.new((a[j], a[k], b[k], b[j]))
    if cap:
        bm.faces.new(rings[0])
        bm.faces.new(rings[-1])
    return _new_obj(name, bm)


def outline_solid(name, pts2d, thickness, plane='xz'):
    """pts2d: a closed 2D silhouette, which may be CONCAVE (a shirt has sleeves
    and a neck notch). Triangle-fills it, then extrudes to `thickness`."""
    bm = bmesh.new()
    h = thickness / 2.0
    verts = []
    for (a, b) in pts2d:
        p = (a, -h, b) if plane == 'xz' else (a, b, -h)
        verts.append(bm.verts.new(p))
    bm.verts.ensure_lookup_table()
    edges = []
    n = len(verts)
    for i in range(n):
        edges.append(bm.edges.new((verts[i], verts[(i + 1) % n])))
    # a plain faces.new() on a concave n-gon tessellates badly; fill with triangles
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges)
    bm.faces.ensure_lookup_table()
    faces = list(bm.faces)
    r = bmesh.ops.extrude_face_region(bm, geom=faces)
    moved = [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]
    off = (0, thickness, 0) if plane == 'xz' else (0, 0, thickness)
    bmesh.ops.translate(bm, verts=moved, vec=off)
    return _new_obj(name, bm)


def _clamp_ring(pts, idx, lo=None, hi=None):
    out = []
    for p in pts:
        p = list(p)
        if lo is not None and p[idx] < lo:
            p[idx] = lo
        if hi is not None and p[idx] > hi:
            p[idx] = hi
        out.append(tuple(p))
    return out


def ring_yz(x, cy, cz, ry, rz, n=12, zfloor=None, yback=None):
    """Ring in the y-z plane at a given x. Loft along X — shoes, club heads.
    zfloor flattens the underside (a shoe is not an ellipse: it has a flat sole)."""
    pts = [(x, cy + ry * math.cos(2 * math.pi * i / n),
            cz + rz * math.sin(2 * math.pi * i / n)) for i in range(n)]
    pts = _clamp_ring(pts, 2, lo=zfloor)
    return _clamp_ring(pts, 1, lo=yback)


def ring_xy(z, cx, cy, rx, ry, n=12, yback=None):
    """Ring in the x-y plane at a given z. Loft along Z — bags.
    yback flattens the back panel (a bag leans against a rail)."""
    pts = [(cx + rx * math.cos(2 * math.pi * i / n),
            cy + ry * math.sin(2 * math.pi * i / n), z) for i in range(n)]
    return _clamp_ring(pts, 1, lo=yback)


def ring_xz(y, cx, cz, rx, rz, n=12, zfloor=None):
    """Ring in the x-z plane at a given y. Loft along Y — driver heads."""
    pts = [(cx + rx * math.cos(2 * math.pi * i / n), y,
            cz + rz * math.sin(2 * math.pi * i / n)) for i in range(n)]
    return _clamp_ring(pts, 2, lo=zfloor)


def bevel(o, width=0.006, segments=2, angle=50):
    m = o.modifiers.new('bev', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    return o


def subsurf(o, levels=1):
    m = o.modifiers.new('sub', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    return o
