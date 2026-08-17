"""THE SHARED MATERIAL LIBRARY for the outdoor tools AND the retail rack.

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

# EVERY ONE OF THESE WAS FLAT COLOUR, and that is most of why the outdoor
# tools read as painted primitives beside the apparel: a face pointed at the
# key sits at one value across its whole width, so the eye has nothing to tell
# it whether it is looking at moulded plastic, at wood or at paint.
#
# name -> (colour, roughness, metallic, noise scale, bump strength, bump mm,
#          colour spread, detail)
# `scale` is in GENERATED space -- the bounding box, 0 to 1, not metres -- so
# these are tuned for a tool a few hundred millimetres across. About one noise
# cell per millimetre is what reads as a surface.
PALETTE = {
    # moulded black plastic: a fine even matte grain from the tool marks
    "poly": ((0.0125, 0.0132, 0.0148), 0.74, 0.0, 190.0, 0.22, 0.00035, 0.16, 6.0),
    # overmould and hose: softer, slightly coarser
    "rubber": ((0.0155, 0.0166, 0.0186), 0.87, 0.0, 150.0, 0.30, 0.00050, 0.18, 5.0),
    # brushed steel, along nothing in particular: fine and low contrast
    "steel": ((0.1620, 0.1670, 0.1780), 0.34, 0.86, 320.0, 0.12, 0.00018, 0.07, 4.0),
    "brass": ((0.4100, 0.2820, 0.0960), 0.30, 0.84, 320.0, 0.12, 0.00018, 0.07, 4.0),
    # wood: the grain is long and the colour varies most of all of them
    "wood": ((0.1040, 0.0360, 0.0180), 0.62, 0.0, 520.0, 0.20, 0.00028, 0.22, 3.0),
    # the shop's green, on sheet metal and moulded pails alike
    "green": ((0.0225, 0.0600, 0.0420), 0.46, 0.0, 210.0, 0.16, 0.00030, 0.13, 5.0),
    "oak": ((0.2450, 0.1620, 0.0790), 0.60, 0.0, 460.0, 0.24, 0.00035, 0.20, 3.0),
}


def palette():
    """Every outdoor tool draws from this and nothing else."""
    out = {}
    for name, spec in PALETTE.items():
        col, rough, metal, scale, strength, dist, spread, detail = spec
        key = f"Outdoor_{name.capitalize()}"
        existing = bpy.data.materials.get(key)
        out[name] = existing or HS.surface(
            key, col, rough=rough, metallic=metal, scale=scale,
            strength=strength, dist=dist, spread=spread, detail=detail)
    return out


def uv_cell(obj, cell, cols, rows):
    """Point an instance at ONE cell of a shared atlas. The whole trick:
    variety costs texture cells, not materials."""
    cx, cy = cell % cols, cell // cols
    for layer in obj.data.uv_layers:
        for d in layer.data:
            u, v = d.uv
            d.uv = ((cx + u) / cols, ((rows - 1 - cy) + v) / rows)


def label_quad(name, cx, cz, w, h, y, cell, cols, rows, flip=False):
    """Artwork on its OWN quad, standing proud of whatever it labels.

    Per-face UV logic on a bevelled box is not reliable: the chamfer strips
    carry diagonal normals, and a planar x/z map collapses to a single stretched
    line of the image on the top face -- which at any camera above the horizon
    is most of what you see. The basket badge, the ledger label and the ball
    boxes are all separate quads for this reason.
    """
    verts = [Vector((cx + sx * w * 0.5, y, cz + sz * h * 0.5))
             for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    ob = HS.mesh_from(name, verts, [(0, 1, 2, 3)])
    uvl = ob.data.uv_layers.new(name="UVMap")
    for li in ob.data.polygons[0].loop_indices:
        co = ob.data.vertices[ob.data.loops[li].vertex_index].co
        u = (co.x - (cx - w * 0.5)) / w
        uvl.data[li].uv = (1.0 - u if flip else u,
                           (co.z - (cz - h * 0.5)) / h)
    uv_cell(ob, cell, cols, rows)
    return ob


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
