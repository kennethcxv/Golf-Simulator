"""MACRO OCCLUSION, per object, in the vertices -- what a tiling atlas cannot do.

`weave.py` gives the cloth its grain, and the grain is a repeating material, so
it tiles. Occlusion between two PLIES of a folded stack does not repeat and
cannot tile: it belongs to that fold, in that place, once. In the first in-game
frame the folded polo read as a single pale slab -- the reference photograph of
a folded stack is mostly SHADOW SLOTS between the plies, and there were none,
because the only occlusion in the file was the micro cavity between two yarns.

So this bakes real ambient occlusion into a vertex colour. Vertex colours need
no UV, cost four bytes a vertex, survive the glTF export as COLOR_0, and
three.js multiplies them into base colour with nothing to wire. On a garment
whose vertices are already dense enough to hold a fold, they hold a fold's
shadow.

WHY NOT A CYCLES BAKE. A baked AO map needs a non-overlapping UV layout, and
these garments are unwrapped by their PATTERN DRAFT -- panels normalised 0..1,
overlapping between parts. Baking into that puts the sleeve's shadow on the
front. It would also mean a second full-size image per garment for something
that is a few hundred numbers.

    blender --factory-startup -b --python vertex_ao.py -- control
"""

import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ATTR = "Col"


def _hemisphere(n):
    """A fixed Fibonacci hemisphere: even, and the same every run.

    Random directions would make the bake differ between builds, which turns
    every golden-image diff into noise and makes an A/B meaningless.
    """
    out = []
    ga = math.pi * (3.0 - math.sqrt(5.0))
    for i in range(n):
        z = (i + 0.5) / n            # 0..1, cosine-ish weighting toward the pole
        r = math.sqrt(max(0.0, 1.0 - z * z))
        a = ga * i
        out.append(Vector((r * math.cos(a), r * math.sin(a), z)))
    return out


def _frame(nrm):
    """An orthonormal basis with `nrm` as +z."""
    up = Vector((0.0, 0.0, 1.0))
    if abs(nrm.z) > 0.94:
        up = Vector((1.0, 0.0, 0.0))
    t = nrm.cross(up)
    if t.length < 1e-9:
        t = Vector((1.0, 0.0, 0.0))
    t.normalize()
    b = nrm.cross(t)
    return t, b


def _smooth(me, vals, rounds=3, w=0.55):
    """Average each vertex with its neighbours along the mesh edges.

    Forty rays per vertex is a coarse estimate of a hemisphere, and the error
    is not smooth: on the hoodie it showed up in game as irregular dark
    smudges across the chest and shoulder, which read as dirt on the garment.
    More rays would cost linearly; this costs nothing and removes exactly the
    high-frequency part, which is the part that is noise. A real contact
    shadow is many vertices wide and survives it.
    """
    n = len(vals)
    ea = np.empty(len(me.edges) * 2, np.int32)
    me.edges.foreach_get("vertices", ea)
    a, b = ea[0::2], ea[1::2]
    deg = np.bincount(a, minlength=n) + np.bincount(b, minlength=n)
    deg = np.maximum(deg, 1)
    out = vals
    for _ in range(rounds):
        acc = np.zeros(n, np.float64)
        np.add.at(acc, a, out[b])
        np.add.at(acc, b, out[a])
        out = ((1.0 - w) * out + w * (acc / deg)).astype(np.float32)
    return out


def bake(objs, samples=40, radius=0.16, floor=0.30, power=1.15, bias=0.0006,
         contact=0.022, contact_floor=0.42, smooth=3):
    """Occlusion from EVERY object against EVERY object.

    One BVH over the lot, not one per mesh: the hanger has to darken the
    shoulder it is inside, and the ply above has to darken the ply below. Built
    per-mesh, each part would be occluded only by itself and a folded stack --
    which is four separate surfaces stacked with air between them -- would come
    out almost clean, which is exactly the wrong answer.
    """
    meshes = [o for o in objs if o is not None and o.type == "MESH"]
    if not meshes:
        return {}
    verts, tris = [], []
    for ob in meshes:
        mw = ob.matrix_world
        base = len(verts)
        me = ob.data
        verts.extend([mw @ v.co for v in me.vertices])
        for p in me.polygons:
            idx = list(p.vertices)
            for k in range(1, len(idx) - 1):
                tris.append((base + idx[0], base + idx[k], base + idx[k + 1]))
    bvh = BVHTree.FromPolygons([tuple(v) for v in verts], tris, all_triangles=True)

    dirs = _hemisphere(samples)
    report = {}
    for ob in meshes:
        me = ob.data
        mw = ob.matrix_world
        nm = mw.to_3x3().inverted().transposed()
        col = me.color_attributes.get(ATTR)
        if col is None:
            col = me.color_attributes.new(name=ATTR, type="FLOAT_COLOR",
                                          domain="POINT")
        vals = np.ones(len(me.vertices), np.float32)
        for i, v in enumerate(me.vertices):
            n = (nm @ v.normal).normalized()
            p = (mw @ v.co) + n * bias
            t, b = _frame(n)
            hit = 0.0
            near = 0.0
            for d in dirs:
                w = t * d.x + b * d.y + n * d.z
                loc, _, _, dist = bvh.ray_cast(p, w, radius)
                if loc is not None:
                    # near hits occlude more than far ones -- a ply 2 mm away
                    # is a shadow slot, a wall 150 mm away is not
                    hit += 1.0 - (dist / radius)
                    if contact > 0.0 and dist < contact:
                        near += 1.0 - (dist / contact)
            # TWO RADII OFF ONE RAY. The broad term is ambient shape; the
            # CONTACT term is the reason this exists. Last session's fold fix
            # made the plies of a folded stack land flush -- correctly, they
            # were splaying 19 mm -- and flush plies are millimetres apart, so
            # a 160 mm ambient radius barely darkens the junction between them
            # and the stack read in game as one pale cushion. The reference
            # photograph of a folded stack is mostly the dark lines BETWEEN
            # plies, and those are a 2 cm effect.
            broad = floor + (1.0 - floor) * max(0.0, 1.0 - hit / samples) ** power
            tight = (contact_floor + (1.0 - contact_floor)
                     * max(0.0, 1.0 - near / samples))
            vals[i] = max(floor * contact_floor, broad * tight)
        if smooth:
            vals = _smooth(me, vals, rounds=smooth)
        buf = np.empty(len(me.vertices) * 4, np.float32)
        buf[0::4] = vals
        buf[1::4] = vals
        buf[2::4] = vals
        buf[3::4] = 1.0
        col.data.foreach_set("color", buf)
        me.update()
        report[ob.name] = (float(vals.min()), float(vals.mean()))
        print("    ao %-26s min %.3f  mean %.3f  (%d verts)"
              % (ob.name, vals.min(), vals.mean(), len(vals)))
    return report


# ---------------------------------------------------------------------------


def _plane(name, z, size=0.4, n=6):
    me = bpy.data.meshes.new(name)
    vs, fs = [], []
    for j in range(n + 1):
        for i in range(n + 1):
            vs.append((size * (i / n - 0.5), size * (j / n - 0.5), z))
    for j in range(n):
        for i in range(n):
            a = j * (n + 1) + i
            fs.append((a, a + 1, a + n + 2, a + n + 1))
    me.from_pydata(vs, [], fs)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def control():
    """Three cases whose right answers are known before the bake runs."""
    print()
    print("=" * 74)
    print("VERTEX AO CONTROL")
    print("=" * 74)
    ok = []

    bpy.ops.wm.read_factory_settings(use_empty=True)
    lone = _plane("lone", 0.0)
    r = bake([lone], samples=24)
    v = r["lone"][1]
    good = v > 0.985
    ok.append(good)
    print("  %-5s a plane with nothing near it: mean %.3f, wanted ~1.000"
          % ("ok" if good else "FAIL", v))

    # TWO PLIES 3 MM APART, which is what a folded stack is.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    a = _plane("lower", 0.0)
    b = _plane("upper", 0.003)
    r = bake([a, b], samples=24)
    v = r["lower"][1]
    good = v < 0.40
    ok.append(good)
    print("  %-5s a ply 3 mm under another: mean %.3f, wanted well under 0.40"
          % ("ok" if good else "FAIL", v))
    # and the TOP of the stack must stay light, or the whole garment just
    # goes grey and nothing has been gained
    v2 = r["upper"][1]
    good = v2 > 0.80
    ok.append(good)
    print("  %-5s the ply on top of it: mean %.3f, wanted above 0.80"
          % ("ok" if good else "FAIL", v2))

    # RADIUS ZERO IS THE OFF SWITCH. If this darkens anything, the occlusion
    # being reported is the instrument's, not the geometry's.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    a = _plane("lower", 0.0)
    b = _plane("upper", 0.003)
    r = bake([a, b], samples=24, radius=0.0, contact=0.0, smooth=0)
    v = min(r["lower"][0], r["upper"][0])
    good = v > 0.999
    ok.append(good)
    print("  %-5s the same pair with radius 0: min %.3f, wanted 1.000"
          % ("ok" if good else "FAIL", v))

    print()
    if not all(ok):
        raise SystemExit("CONTROL FAILED: %d of %d"
                         % (sum(1 for x in ok if not x), len(ok)))
    print("control passed: %d of %d. Open geometry stays light, a 3 mm gap goes "
          "dark, and switching the radius off switches the effect off." % (len(ok), len(ok)))


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "control" in argv:
        control()
