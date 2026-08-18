"""EXPORT THE TEN v5 GARMENTS, and read every file back before believing it.

v5 built ten garments and shipped none of them. Renders were the whole output,
which is exactly the gap `control_export_roundtrip.py` was written about: every
check in this pipeline looks at the Blender scene, the GLB is written last, and
nobody ever reads it again. So this runs each asset's own `build()` -- the same
code the renders photographed, not a copy of it -- and puts the result through
the full export gate:

    unwrap (only where the draft did not already lay a UV down)
      -> flatten_for_export   (a linked Base Color exports as WHITE)
      -> set the origin       (see below)
      -> bake_gltf_axis       (+Y_blender -> -Z_gltf, into the VERTICES)
      -> export_glb           (which re-imports the file and compares per part)

THE ORIGIN CONVENTION, which v4 never had and which is why its ten needed a
magic height each in the QA driver:

  * A HUNG garment's origin is the TOP OF ITS HOOK, centred in x. Put that point
    on a rail and the garment hangs correctly, with no per-asset constant.
  * A garment that RESTS -- the four folded stacks and the cap -- has its origin
    at its base, centred. Put that on a shelf and it sits on it.
  * The cap on a peg mounts to a WALL, so its origin is the wall plane in y and
    the peg root in z.

The studio shelf under each folded stack is a lighting prop -- it exists for the
contact shadow -- and does not ship. The hanger and the peg do: they are what
the thing is displayed on and the game has no wooden hanger of its own.

    blender --factory-startup -b --python export_all.py
    blender --factory-startup -b --python export_all.py -- only=tee-hung,cap
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import hero_lib as H  # noqa: E402
import studio as ST  # noqa: E402

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "v6"))
import vertex_ao as VAO  # noqa: E402

GLB_DIR = os.path.join(ST.ROOT, "Assets", "models", "hero", "v5")

# name, module, glb, how the build's return splits, origin rule
#
# `take` says which of the build's returned lists ship. Every module returns
# (cloth, set, ...) but "set" means different things: the hangers and the cap's
# eyelets are part of the product, the folded stacks' shelf is a light stand.
PLAN = [
    ("tee-hung",        "tee_hung",        "apparel_tee_hung.glb",       "both", "hook"),
    ("polo-hung",       "polo_hung",       "apparel_polo_hung.glb",      "both", "hook"),
    ("hoodie-hung",     "hoodie_hung",     "apparel_hoodie_hung.glb",    "both", "hook"),
    ("trousers-hung",   "trousers_hung",   "apparel_trousers_hung.glb",  "both", "hook"),
    ("cap",             "cap",             "apparel_cap.glb",            "both", "base"),
    ("tee-folded",      "tee_folded",      "apparel_tee_folded.glb",     "cloth", "base"),
    ("polo-folded",     "polo_folded",     "apparel_polo_folded.glb",    "cloth", "base"),
    ("hoodie-folded",   "hoodie_folded",   "apparel_hoodie_folded.glb",  "cloth", "base"),
    ("trousers-folded", "trousers_folded", "apparel_trousers_folded.glb", "cloth", "base"),
    ("cap-peg",         "cap_peg",         "apparel_cap_peg.glb",        "peg", "wall"),
]


def shift(objs, d):
    """Move meshes by their VERTICES and empties by their location.

    Same split `drop_to_floor` makes and for the same reason: a socket has no
    vertices to carry a translation.
    """
    for ob in objs:
        if ob.type == "MESH":
            local = ob.matrix_world.inverted().to_3x3() @ d
            for v in ob.data.vertices:
                v.co += local
            ob.data.update()
        else:
            ob.location = ob.location + d


def world_pts(objs):
    pts = []
    for ob in objs:
        if ob.type != "MESH":
            continue
        mw = ob.matrix_world
        pts.extend(mw @ v.co for v in ob.data.vertices)
    return pts


def set_origin(objs, rule):
    """Put the asset's mount point at (0, 0, 0) and verify it landed there."""
    pts = world_pts(objs)
    if not pts:
        raise SystemExit("EXPORT FAILED: nothing with vertices to place")
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts),
                 min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts),
                 max(p.z for p in pts)))
    mid = (lo + hi) * 0.5
    if rule == "hook":
        # the hang point: top of the hook, on the garment's centre line
        want = Vector((mid.x, mid.y, hi.z))
    elif rule == "base":
        want = Vector((mid.x, mid.y, lo.z))
    elif rule == "wall":
        # the peg's mounting plate is the LAST thing in +y
        want = Vector((mid.x, hi.y, mid.z))
    else:
        raise SystemExit("EXPORT FAILED: no origin rule %r" % rule)
    shift(objs, -want)

    pts = world_pts(objs)
    lo2 = Vector((min(p.x for p in pts), min(p.y for p in pts),
                  min(p.z for p in pts)))
    hi2 = Vector((max(p.x for p in pts), max(p.y for p in pts),
                  max(p.z for p in pts)))
    got = {"hook": hi2.z, "base": lo2.z, "wall": hi2.y}[rule]
    if abs(got) > 1e-5:
        raise SystemExit("EXPORT FAILED: origin rule %r asked for 0 and got "
                         "%+.3f mm" % (rule, got * 1000))
    print("  origin %-5s  x[%7.1f,%7.1f] y[%7.1f,%7.1f] z[%7.1f,%7.1f] mm"
          % (rule, lo2.x * 1000, hi2.x * 1000, lo2.y * 1000, hi2.y * 1000,
             lo2.z * 1000, hi2.z * 1000))
    return lo2, hi2


def uvs(objs):
    """Unwrap only what has no UV yet.

    The pattern draft writes (u, v) straight into a UV layer -- a garment's
    pattern IS its UV map, which is the one free thing about building clothes
    this way. Running smart_project over that would throw it away and replace it
    with angle-limited islands, so this only touches parts drafted some other
    way (the hanger, the hook, the buckle).
    """
    for ob in objs:
        if ob.type != "MESH":
            continue
        if not ob.data.uv_layers:
            ST.unwrap(ob)


def one(name, mod_name, glb, take, rule):
    print()
    print("-" * 74)
    print(name)
    H.reset_scene()
    H.set_engine("EEVEE", samples=8)
    mod = __import__(mod_name)
    got = mod.build()
    cloth = list(got[0])
    extra = list(got[1])
    if take == "both":
        subject = cloth + extra
    elif take == "cloth":
        subject = cloth
    elif take == "peg":
        # cap_peg returns (cloth, metal + [peg], [wall]) -- the studio's wall
        # card is a backdrop, the peg is the fixture
        subject = cloth + extra
    else:
        raise SystemExit("EXPORT FAILED: no take rule %r" % take)
    subject = [o for o in subject if o is not None]

    for ob in subject:
        if ob.type == "MESH" and ob.modifiers:
            ST.apply_mods(ob)
    uvs(subject)
    ST.flatten_for_export(subject)
    lo, hi = set_origin(subject, rule)
    tris = ST.tris(subject)

    # MACRO OCCLUSION, into the vertices. The tiling atlas carries the cavity
    # between two yarns; it cannot carry the shadow between two plies of a
    # folded stack, because that shadow belongs to that fold and does not
    # repeat. In the first in-game frame the folded polo read as one pale slab
    # and the reference photograph of a folded stack is mostly shadow slots.
    VAO.bake(subject)
    H.bake_gltf_axis(subject)
    path = os.path.join(GLB_DIR, glb)
    H.export_glb(subject, path, vertex_colors=True)
    size = os.path.getsize(path)
    print("  %-16s %6d tris  %7.1f KiB  %.0f x %.0f x %.0f mm"
          % (name, tris, size / 1024.0, (hi.x - lo.x) * 1000,
             (hi.y - lo.y) * 1000, (hi.z - lo.z) * 1000))
    return dict(name=name, glb=glb, tris=tris, bytes=size, rule=rule,
                size_mm=[round((hi.x - lo.x) * 1000, 1),
                         round((hi.y - lo.y) * 1000, 1),
                         round((hi.z - lo.z) * 1000, 1)])


def main():
    args = H.argv_after_dashes()
    only = next((a.split("=", 1)[1] for a in args if a.startswith("only=")),
                None)
    plan = PLAN
    if only:
        want = {s.strip() for s in only.split(",")}
        plan = [p for p in PLAN if p[0] in want]
        missing = want - {p[0] for p in plan}
        if missing:
            raise SystemExit("EXPORT FAILED: no such asset %s"
                             % ", ".join(sorted(missing)))
    os.makedirs(GLB_DIR, exist_ok=True)
    print()
    print("=" * 74)
    print("v5 EXPORT -- %d assets to %s" % (len(plan), GLB_DIR))
    print("=" * 74)
    rows = [one(*p) for p in plan]
    print()
    print("=" * 74)
    print("%-18s %8s %10s  %s" % ("asset", "tris", "KiB", "size (mm)"))
    for r in rows:
        print("%-18s %8d %10.1f  %.0f x %.0f x %.0f"
              % (r["name"], r["tris"], r["bytes"] / 1024.0, *r["size_mm"]))
    print("%-18s %8d %10.1f" % ("TOTAL", sum(r["tris"] for r in rows),
                                sum(r["bytes"] for r in rows) / 1024.0))
    print()
    print("Every file above was re-imported and compared with the scene it came "
          "from, per part, by export_glb.")


if __name__ == "__main__":
    main()
