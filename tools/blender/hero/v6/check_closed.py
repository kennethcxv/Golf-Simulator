"""IS THE FOLDED GARMENT CLOSED FROM ABOVE?

`folded.check_stack` measures one thing: height over footprint, and it fails
anything taller than a third of its width because the brief's word for v4 was
"too tall for their footprint". It passed apparel_trousers_folded at 0.10, and
apparel_trousers_folded is an OPEN BOX. In game you look down into a cavity
with internal walls and a visible floor; only the rolled edge on one side reads
as cloth at all. A hollow frame has exactly the same height-over-footprint as
a solid stack, so the check could not have caught it and never will.

This asks the question that was actually meant: standing over the stack, do you
see CLOTH, or do you see into it. Fire a grid of rays straight down over the
footprint. For each one, find the highest surface it hits. On a folded garment
that is the top ply, within a millimetre or two of the stack's top everywhere
the garment is. On a frame, the rays that go down the middle hit the FLOOR of
the cavity, a long way below.

It runs against the EXPORTED GLB rather than the build, because the export is
what ships and because a check that re-runs the builder cannot be pointed at a
file somebody else produced.

    blender --factory-startup -b --python check_closed.py --python-exit-code 1 \
        -- Assets/models/hero/v5/apparel_polo_folded.glb ...
    blender ... -- --control          # prove it can fail AND pass
"""

import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

# A ray whose highest hit is more than this fraction of the stack height below
# the top is looking INTO the garment rather than at it.
SINK = 0.40
# More than this share of the footprint sunk, and it is not a closed stack.
OPEN_LIMIT = 0.12
GRID = 40


def _load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def _bvh(objs):
    verts, tris = [], []
    for ob in objs:
        mw = ob.matrix_world
        base = len(verts)
        me = ob.data
        verts.extend([mw @ v.co for v in me.vertices])
        for p in me.polygons:
            idx = list(p.vertices)
            for k in range(1, len(idx) - 1):
                tris.append((base + idx[0], base + idx[k], base + idx[k + 1]))
    return BVHTree.FromPolygons([tuple(v) for v in verts], tris, all_triangles=True)


def closure(objs, label="", grid=GRID, verbose=True):
    """Fraction of the footprint you can see INTO from directly above."""
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in objs:
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            for a in range(3):
                lo[a] = min(lo[a], w[a])
                hi[a] = max(hi[a], w[a])
    height = hi.z - lo.z
    if height <= 1e-6:
        raise SystemExit("CLOSURE FAILED: %s has no height" % label)
    bvh = _bvh(objs)

    above = hi.z + max(0.05, height)
    hits = 0
    sunk = 0
    depths = []
    for iy in range(grid):
        for ix in range(grid):
            # cell centres, so the ray never runs exactly along a shared edge
            x = lo.x + (ix + 0.5) / grid * (hi.x - lo.x)
            y = lo.y + (iy + 0.5) / grid * (hi.y - lo.y)
            loc, _, _, _ = bvh.ray_cast(Vector((x, y, above)), Vector((0, 0, -1)))
            if loc is None:
                continue          # outside the silhouette: not part of the test
            hits += 1
            drop = (hi.z - loc.z) / height
            depths.append(drop)
            if drop > SINK:
                sunk += 1
    if not hits:
        raise SystemExit("CLOSURE FAILED: %s -- no ray hit it at all" % label)
    frac = sunk / hits
    d = np.array(depths)
    ok = frac <= OPEN_LIMIT
    if verbose:
        print("  %-5s %-24s %5.1f%% of the footprint sunk past %.0f%% of the "
              "stack height  (median drop %.2f, worst %.2f, %d rays)"
              % ("ok" if ok else "FAIL", label, frac * 100, SINK * 100,
                 float(np.median(d)), float(d.max()), hits))
    return ok, frac


# ---------------------------------------------------------------------------


def _slab(name, z0, z1, half=0.10):
    """A closed box: the shape a folded stack is meant to approximate."""
    bpy.ops.mesh.primitive_cube_add(size=1)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (half, half, (z1 - z0) / 2.0)
    ob.location = (0, 0, (z0 + z1) / 2.0)
    bpy.context.view_layer.update()
    return ob


def control():
    """A solid stack must pass and an open frame must fail, or this measures
    nothing. The frame is built the way the fault presents: a rim of the right
    height with the middle missing."""
    print()
    print("=" * 78)
    print("CLOSURE CONTROL")
    print("=" * 78)
    ok = []

    bpy.ops.wm.read_factory_settings(use_empty=True)
    solid = _slab("solid", 0.0, 0.04)
    good, frac = closure([solid], "a solid closed stack")
    ok.append(good)

    # THE FRAME: four walls and a floor, no lid. Same height, same footprint,
    # so check_stack's ratio is identical -- which is the whole point.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    parts = []
    for i, (dx, dy, hx, hy) in enumerate([
        (0.09, 0.0, 0.01, 0.10), (-0.09, 0.0, 0.01, 0.10),
        (0.0, 0.09, 0.10, 0.01), (0.0, -0.09, 0.10, 0.01),
    ]):
        bpy.ops.mesh.primitive_cube_add(size=1)
        w = bpy.context.active_object
        w.name = "wall%d" % i
        w.scale = (hx, hy, 0.02)
        w.location = (dx, dy, 0.02)
        parts.append(w)
    floor = _slab("floor", 0.0, 0.004)
    parts.append(floor)
    bpy.context.view_layer.update()
    bad, frac = closure(parts, "an open frame, same footprint")
    ok.append(not bad)
    print("        ^ this one MUST fail, and check_stack scores it identically")

    print()
    if not all(ok):
        raise SystemExit("CONTROL FAILED: %d of %d"
                         % (sum(1 for x in ok if not x), len(ok)))
    print("control passed: %d of %d. A closed stack passes, an open frame of the "
          "same height and footprint fails." % (len(ok), len(ok)))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--control" in argv:
        control()
        return
    # A REAL FOLDED GARMENT IS STEPPED, not a box: the top ply does not cover
    # the whole footprint, and where it stops you see the ply below. That is
    # correct and it registers as "sunk" at a shallow threshold. --sink raises
    # the bar to rays that fall NEARLY TO THE FLOOR, which no amount of honest
    # stepping produces and which is what an open cavity looks like.
    global SINK
    for a in argv:
        if a.startswith("--sink="):
            SINK = float(a.split("=", 1)[1])
    files = [a for a in argv if a.endswith(".glb")]
    if not files:
        raise SystemExit("usage: -- <file.glb> [...]   or   -- --control")
    print()
    print("=" * 78)
    print("IS THE FOLD CLOSED FROM ABOVE?")
    print("=" * 78)
    bad = []
    for f in files:
        objs = _load(f)
        good, frac = closure(objs, os.path.basename(f))
        if not good:
            bad.append((os.path.basename(f), frac))
    print()
    if bad:
        raise SystemExit(
            "FAILED: %d of %d folded garments are open from above -- %s"
            % (len(bad), len(files),
               ", ".join("%s %.0f%%" % (n, p * 100) for n, p in bad)))
    print("all %d closed: standing over the stack you see cloth, not into it."
          % len(files))


if __name__ == "__main__":
    main()
