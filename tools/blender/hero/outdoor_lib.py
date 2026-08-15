"""THE SHARED MATERIAL LIBRARY for the outdoor tools.

The queue's rule: "Rebuild as real parts on a shared material library", with the
target of a small shared library across the whole batch. The four tools this
replaces are ONE MESH AND ONE MATERIAL EACH -- rake 20,192 tris, hose 20,313,
fork 19,812, bucket 19,815 -- so the naive rebuild costs four materials per tool
and lands worse than what it replaces.

Six materials cover the whole outdoor family. They are created ONCE per build
and handed out by name, so two tools asking for `steel` get the same datablock
rather than two identical ones the engine has to keep apart. A parallel session
is cutting this game from 349 materials to under 40; the way to help is to stop
minting new ones, not to make prettier ones.

Also here: the hard-surface helpers the wand proved out, promoted so every tool
in this batch gets them rather than each re-deriving a swept tube.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hardsurface_lib as HS  # noqa: E402

# name -> (colour, roughness, metallic)
PALETTE = {
    "poly": ((0.0105, 0.0110, 0.0125), 0.72, 0.0),   # moulded black plastic
    "rubber": ((0.0140, 0.0150, 0.0170), 0.86, 0.0),  # overmould, grips, hose
    "steel": ((0.1550, 0.1600, 0.1700), 0.30, 0.90),  # shafts, tines, fittings
    "brass": ((0.4020, 0.2760, 0.0920), 0.28, 0.88),  # couplings, ferrules
    "wood": ((0.0980, 0.0300, 0.0140), 0.66, 0.0),    # rake and tool shafts
    "green": ((0.0210, 0.0580, 0.0400), 0.44, 0.0),   # the shop's own green
}


def palette():
    """Every outdoor tool draws from this and nothing else."""
    out = {}
    for name, (col, rough, metal) in PALETTE.items():
        key = f"Outdoor_{name.capitalize()}"
        existing = bpy.data.materials.get(key)
        out[name] = existing or HS.pbr(key, col, roughness=rough, metallic=metal)
    return out


def sweep(name, path, radius, sides=6, cap=True, smooth=True):
    """A tube along a path, cross-section held PERPENDICULAR to the tangent.

    Kept because the first version held the ring in the XY plane, and where the
    path turned into Y the ring went edge-on and the tube pinched shut.
    """
    verts, faces = [], []
    n = len(path)
    for i, p in enumerate(path):
        nxt = path[min(i + 1, n - 1)]
        prv = path[max(i - 1, 0)]
        t = (nxt - prv).normalized()
        u = Vector((1, 0, 0))
        if abs(t.dot(u)) > 0.94:
            u = Vector((0, 0, 1))
        v = t.cross(u).normalized()
        u = v.cross(t).normalized()
        for k in range(sides):
            a = 2 * math.pi * k / sides
            verts.append(p + u * (math.cos(a) * radius) + v * (math.sin(a) * radius))
    for i in range(n - 1):
        for k in range(sides):
            q = (k + 1) % sides
            faces.append((i * sides + k, i * sides + q,
                          (i + 1) * sides + q, (i + 1) * sides + k))
    if cap:
        faces.append(tuple(range(sides - 1, -1, -1)))
        faces.append(tuple(range((n - 1) * sides, n * sides)))
    return HS.mesh_from(name, verts, faces, smooth=smooth)


def smooth_barrel(obj):
    """Smooth a cylinder's round wall, leave its end caps flat. Shading the caps
    smooth is what gives a tube a black-underside/white-top split rather than a
    highlight."""
    for poly in obj.data.polygons:
        poly.use_smooth = abs(poly.normal.normalized().z) < 0.7
    return obj


def tapered_box(name, y0, y1, s0, s1, bevel=0.0):
    """A box that narrows along +Y. A tool body that does not taper reads as a
    brick."""
    verts = []
    for (y, s) in ((y0, s0), (y1, s1)):
        for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append(Vector((sx * s[0], y, sz * s[1])))
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = HS.mesh_from(name, verts, faces)
    if bevel > 0:
        m = ob.modifiers.new("Bevel", "BEVEL")
        m.width, m.segments = bevel, 2
        m.limit_method, m.angle_limit = "ANGLE", math.radians(40)
        ob = HS.apply_mods(ob)
    return ob
