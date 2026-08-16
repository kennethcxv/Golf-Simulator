"""THE BROOM CUT, RE-EXAMINED — mine beside the procedural one.

The cut was made off a studio render of my broom alone, and the owner's answer
was the right one: the procedural broom is the one asset in this game that
already reads correctly, so the only honest test is both of them in the same
frame, at the same scale, under the same lights, from the same distance.

The procedural broom is not a mesh anywhere on disk. It is four primitives
declared in `src/data/cleaningTools.js` and built by three.js at runtime:

    cyl(0.019, 0.021, 1.90, [0, 0, -0.88],  [PI/2, 0, 0], 'ash')    handle
    cyl(0.024, 0.031, 0.12, [0, 0, -1.74],  [PI/2, 0, 0], 'steel')  ferrule
    box([0.46, 0.085, 0.11],  [0, -0.045, -1.85], 'ash')            block
    box([0.44, 0.125, 0.092], [0, -0.150, -1.85], 'bristle')        BRISTLES

The bristles are ONE BOX. That is the thing to beat, and it is worth writing
down plainly because it is the whole question: 218 modelled tufts against a
single cuboid with a dark matte material on it.

Ported here from those numbers, with the game's own palette:

    steel   0x9aa3aa  rough 0.42  metal 0.70
    ash     0xc2a273  rough 0.80
    bristle 0x2b2622  rough 0.95

AXES. The tool frame in the game is x across the sweep, -y down to the floor,
-z away from the player along the handle. The hero builder's frame is x across,
-z down, -y toward the player. So proc(x, y, z) maps to hero(x, -z, y).

HANDLES ARE OMITTED FROM BOTH. The procedural handle is coaxial with its block
and the whole tool is pitched by worldPitch in world space; mine is a 38-degree
ferrule on a head asset with no handle at all. Drawing either one's handle
would be comparing poses rather than heads, and the head is what was cut.

    blender --factory-startup -b --python tools/blender/hero/compare_broom.py -- [cycles]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402
import build_broom  # noqa: E402

REPO = os.getcwd()
OUT = os.path.join(REPO, "qa", "hero", "broom_compare")

# straight off cleaningTools.js, converted to the hero frame
PROC_BLOCK = (0.460, 0.110, 0.085)
PROC_BRIST = (0.440, 0.092, 0.125)
PROC_BRIST_DROP = 0.105          # bristle centre below block centre
PROC_FERRULE_R = (0.024, 0.031)
PROC_FERRULE_H = 0.120
PROC_FERRULE_AT = (0.0, -0.110, 0.045)


def srgb(hexv):
    """The game's colours are sRGB hex; Blender wants linear."""
    out = []
    for sh in (16, 8, 0):
        c = ((hexv >> sh) & 0xFF) / 255.0
        out.append(c / 12.92 if c <= 0.04045
                   else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def build_procedural(offset):
    """The four primitives, at their declared sizes, in the hero frame."""
    ox = Vector(offset)
    parts = []
    block = HS.box("ProcBlock", ox, PROC_BLOCK)
    bristle = HS.box("ProcBristle", ox + Vector((0, 0, -PROC_BRIST_DROP)),
                     PROC_BRIST)
    # three.js CylinderGeometry is +Y; rot [PI/2,0,0] lays it along +Z in the
    # tool frame, which is -Y here (the handle runs back toward the player).
    ferrule = HS.cylinder("ProcFerrule", ox + Vector(PROC_FERRULE_AT),
                          (PROC_FERRULE_R[0] + PROC_FERRULE_R[1]) * 0.5,
                          PROC_FERRULE_H, verts=8,
                          rotation=Vector((0, -1, 0)).to_track_quat("Z", "Y"))

    wood = HS.pbr("ProcAsh", srgb(0xC2A273), roughness=0.80)
    steel = HS.pbr("ProcSteel", srgb(0x9AA3AA), roughness=0.42, metallic=0.70)
    fibre = HS.pbr("ProcBristle", srgb(0x2B2622), roughness=0.95)
    block.data.materials.append(wood)
    ferrule.data.materials.append(steel)
    bristle.data.materials.append(fibre)
    parts += [block, ferrule, bristle]
    return parts


SHIPPING = os.path.join("vendor", "models", "assets_51_100", "firstperson",
                        "asset_074_broom_fp.glb")


def load_shipping(offset):
    """THE BROOM THE OWNER ACTUALLY SEES.

    I nearly compared against the wrong object. The four primitives above are
    the INSTANT FALLBACK -- cleaningTools.js says so in as many words: "the
    procedural parts above stay as the instant fallback so equipping never
    waits on I/O; the authored geometry swaps in when it arrives". The player
    sees them for one frame.

    broom-v1-lit.png, the reference the cut was judged against, shows a block
    with a metal collar and a fine dense bristle fringe. That is not a box. It
    is this GLB, from the assets_51_100 pipeline -- a different builder from
    the hero one entirely. Comparing my head against the fallback would have
    been a rigged fight I could not lose, and I would have reported it.
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=SHIPPING)
    got = [o for o in bpy.data.objects
           if o not in before and o.type == "MESH"]
    if not got:
        raise SystemExit(f"BUILD FAILED: no meshes imported from {SHIPPING}")
    lo, hi = H.bounds(got)
    print(f"  shipping GLB: {len(got)} meshes, whole asset "
          f"{(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} x "
          f"{(hi.z - lo.z) * 1000:.0f} mm")

    # Only the HEAD. The shipping asset is a whole first-person broom with a
    # metre of shaft, three grip bands and a hang hole, and framing that beside
    # a 300 mm head compares the framing rather than the heads.
    HEAD = ("BroomBlock", "BroomBlockCap", "BroomBristleSeat", "BroomBristles",
            "BroomFerrule", "BroomFerrulePin")
    head = [o for o in got if any(o.name.endswith(n) for n in HEAD)]
    if len(head) != len(HEAD):
        raise SystemExit(
            f"BUILD FAILED: expected {len(HEAD)} head meshes, matched "
            f"{sorted(o.name for o in head)} -- the GLB's part names have "
            f"changed and this comparison would be of the wrong geometry")
    for o in got:
        if o not in head:
            bpy.data.objects.remove(o, do_unlink=True)

    # Its ferrule leans +y; the hero head's leans -y. Turn it to face the same
    # way, or the same camera photographs two different sides of two brooms.
    #
    # MOVE THE VERTICES, not the object. The importer leaves each mesh's
    # offset baked into its DATA with the object at the origin, so rotating
    # the object swung the head about a point 840 mm away and the "head" came
    # out 1010 mm wide -- a number that would have been the whole comparison
    # if I had not printed it.
    lo, hi = H.bounds(head)
    mid = (lo + hi) * 0.5
    off = Vector(offset)
    for ob in head:
        mw = ob.matrix_world.copy()
        for v in ob.data.vertices:
            q = mw @ v.co - mid
            v.co = Vector((-q.x, -q.y, q.z)) + off
        ob.matrix_world.identity()
        ob.data.update()
    return head


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    suffix = "" if engine == "CYCLES" else "-eevee"

    H.reset_scene()
    H.set_engine(engine, samples=200 if engine == "CYCLES" else 128)

    # MINE first, at the origin, then shifted left.
    mine_parts = build_broom.build(broken=False)
    mine = [mine_parts["block"], mine_parts["ferrule"]] + mine_parts["tufts"]
    for ob in mine:
        ob.location.x -= 0.290

    proc = load_shipping((0.290, 0.0, 0.0))

    both = mine + proc
    print(f"  mine: {H.triangles(mine)} tris in {len(mine)} objects")
    print(f"  proc: {H.triangles(proc)} tris in {len(proc)} objects")
    lo, hi = H.bounds(mine)
    print(f"  mine head {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f}"
          f" x {(hi.z - lo.z) * 1000:.0f} mm")
    lo, hi = H.bounds(proc)
    print(f"  proc head {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f}"
          f" x {(hi.z - lo.z) * 1000:.0f} mm")

    centre, radius = H.subject_sphere(both)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)
    LENS = 70.0
    dist = H.fit_distance(radius, LENS, res=(1800, 900), margin=1.10)

    os.makedirs(OUT, exist_ok=True)
    for label, az, el in (("pair-hero", -118, 22), ("pair-front", -90, 7),
                          ("pair-low", -90, -14), ("pair-top", -90, 62)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre,
                       lens=LENS)
        H.render(cam, os.path.join(OUT, f"{label}{suffix}.png"), res=(1800, 900))

    # AND AT THE SIZE THE PLAYER SEES IT. "Reads correctly" is a claim about a
    # broom being swept two feet from the camera, not about a studio close-up,
    # and a fault that only exists at 1800 px is not a reason to cut anything.
    hfov = 2 * math.atan(math.tan(math.radians(66) / 2) * 16 / 9)
    d = (0.62 / 0.42) / (2 * math.tan(hfov / 2))
    cam = H.camera_fov("Apparent", H.orbit_position(centre, d, -118, 20),
                       centre, 66.0)
    cam.data.sensor_fit = "VERTICAL"
    H.render(cam, os.path.join(OUT, f"pair-apparent{suffix}.png"),
             res=(1600, 900))
    print(f"  wrote {OUT}")


if __name__ == "__main__":
    main()
