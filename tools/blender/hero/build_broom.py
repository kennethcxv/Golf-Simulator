"""HERO ASSET — THE BROOM HEAD. Block, ferrule, bristles.

Reference: Designs/ProShop/Images/Goal_26/playtest5/broom-v1-lit.png — the
PROCEDURAL broom already in the game, which reads correctly: a wooden block, a
metal ferrule, dense even bristles, right proportions.

That makes this the one asset with a bar to beat rather than a fault to fix. If
the model here does not clearly beat the procedural one it does not go in, and
saying so is the outcome rather than a failure.

Hard surface throughout: no solving, no skinning. A block, a socket, and sixty
tufts placed on a grid.

    blender --factory-startup -b --python tools/blender/hero/build_broom.py -- [cycles] [break-roots]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector, Quaternion  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402

REPO = os.getcwd()
OUT_RENDER = os.path.join(REPO, "qa", "hero", "broom")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "broom_head.glb")

# Metres. A commercial push broom head: 300 wide, 55 deep, 48 tall in the block,
# with 95 mm of bristle. The handle enters at about 55 degrees off vertical.
BLOCK = (0.300, 0.060, 0.040)
BRISTLE_LEN = 0.098
ROOT_DEPTH = 0.012          # how far each tuft is seated INTO the block
# DENSITY IS THE WHOLE READ. Twenty columns of tufts is a comb: you can count
# the teeth and see daylight between every one. A commercial push broom has a
# tuft roughly every 8 mm along a 300 mm block, in four staggered rows, and it
# reads as one mass rather than as separate bristles.
ROWS, COLS = 4, 54
FERRULE_ANGLE = 38.0


def wobble(i, k, salt):
    """Deterministic pseudo-variation. Blender scripts here must not use random:
    a build that differs run to run cannot be compared against its own previous
    frame, which is how the hand's regressions were traced."""
    x = math.sin((i * 12.9898 + k * 78.233 + salt) * 43758.5453)
    return x - math.floor(x) - 0.5


def build(broken=False):
    parts = {}

    # ---- the block
    block = HS.box("BroomBlock", (0, 0, 0), BLOCK, bevel=0.004, segments=2)
    block = HS.apply_mods(block)
    parts["block"] = block

    # ---- the ferrule: a socket standing off the block's back, angled for the
    # handle, with a collar ring so there is a metal edge to catch the light.
    ang = math.radians(FERRULE_ANGLE)
    axis = Vector((0, -math.sin(ang), math.cos(ang)))
    base = Vector((0, -0.006, BLOCK[2] * 0.5 - 0.004))
    rot = axis.to_track_quat("Z", "Y")
    socket = HS.cylinder("Ferrule", base + axis * 0.048, 0.0114, 0.108,
                         verts=16, rotation=rot)
    collar = HS.cylinder("FerruleCollar", base + axis * 0.020, 0.0146, 0.011,
                         verts=16, rotation=rot)
    ferrule = HS.join([socket, collar], "Ferrule")
    parts["ferrule"] = ferrule

    # ---- bristles, as tufts on a grid. Outer rows splay, which is what makes a
    # push broom read as a push broom rather than as a hairbrush.
    tufts = []
    for r in range(ROWS):
        for c in range(COLS):
            # Stagger alternate rows by half a column, which is how a real
            # block is drilled and what stops the tufts lining up into visible
            # lanes when you look along them.
            fx = (c + 0.5 + 0.5 * (r % 2)) / COLS - 0.5
            fy = (r + 0.5) / ROWS - 0.5
            x = fx * (BLOCK[0] - 0.016)
            y = fy * (BLOCK[1] - 0.014)
            top = Vector((x, y, -BLOCK[2] * 0.5 + ROOT_DEPTH))
            if broken:
                # THE DELIBERATELY BROKEN VARIANT: every tuft dropped clear of
                # the block, which is the exact shape of the fault that shipped
                # twice -- the mop's strands and the rake's bristles both hung
                # in air. Note the sign: the first version of this test moved
                # the tufts UP, which seats them DEEPER in a block that is above
                # them, and the assertion passed on a variant that was not
                # broken at all.
                top = top - Vector((0, 0, 0.030))
            # Less splay per row. At 0.30 the four rows fanned into four
            # separate curtains with daylight lanes between them, which is the
            # opposite of the dense mass the whole thing is for.
            splay = 0.17 * (fy / 0.34) + 0.07 * wobble(r, c, 3.1)
            lean = 0.10 * wobble(r, c, 7.7)
            d = Vector((lean, splay, -1.0)).normalized()
            # A push broom's bristles are CUT LEVEL. Eleven percent of length
            # variation turned the hem into a saw-tooth and made the whole thing
            # read as a wire brush; four percent reads as wear.
            length = BRISTLE_LEN * (1.0 + 0.04 * wobble(r, c, 11.3))
            tufts.append(HS.prism(f"Tuft_{r}_{c}", top, d, length,
                                  # Barely tapered. Spikes read as wire; a
                                  # bristle is near-parallel along its length.
                                  0.0046, 0.0034, sides=4,
                                  twist=0.40 * wobble(r, c, 5.5)))
    parts["tufts"] = tufts

    # ---- materials
    # Much darker than looks right in the source. The studio is bright and AgX
    # lifts midtones, so a value that reads as "brown" numerically comes out as
    # peach cardboard in the frame -- which is exactly the kind of judgement that
    # has to be made from the render rather than from the number.
    wood = HS.pbr("BroomWood", (0.038, 0.015, 0.005), roughness=0.74, coat=0.0)
    metal = HS.pbr("BroomFerrule", (0.155, 0.158, 0.168), roughness=0.26, metallic=1.0)
    fibre = HS.pbr("BroomBristle", (0.0075, 0.0055, 0.0038), roughness=0.86)
    block.data.materials.append(wood)
    ferrule.data.materials.append(metal)
    for t in tufts:
        t.data.materials.append(fibre)
    return parts


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = "break-roots" in args
    suffix = "-BROKEN" if broken else ""

    H.reset_scene()
    H.set_engine(engine, samples=160 if engine == "CYCLES" else 96)
    parts = build(broken=broken)
    block, ferrule, tufts = parts["block"], parts["ferrule"], parts["tufts"]

    # ---- THE ASSERTION THAT MATTERS. Watched failing on the broken variant
    # before it was trusted on the real one.
    HS.assert_rooted(tufts, block, "bristle tufts", min_verts=3, min_depth=0.0025)
    HS.assert_touching(ferrule, block, "the ferrule must sit on the block",
                       max_gap=0.0015)

    subject = [block, ferrule] + tufts
    tris = H.triangles(subject)
    print(f"TRIS {tris} ({len(subject)} objects, 3 materials) "
          f"— the hand is 5,179")

    lo, hi = H.bounds(subject)
    print(f"  block {BLOCK[0] * 1000:.0f} x {BLOCK[1] * 1000:.0f} x "
          f"{BLOCK[2] * 1000:.0f} mm, bristle {BRISTLE_LEN * 1000:.0f} mm, "
          f"{len(tufts)} tufts")
    print(f"  overall {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} x "
          f"{(hi.z - lo.z) * 1000:.0f} mm")

    # ---- renders
    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.22)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, f"broom{suffix}", views=8,
                     elevation=18.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"broom{suffix}-turntable.png"), cols=4)
    for label, az, el in (("hero", -126, 24), ("front", -90, 6),
                          ("under", -90, -52), ("end", 0, 10)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"broom{suffix}-{label}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject, cam,
                         os.path.join(OUT_RENDER, f"broom{suffix}-silhouette.png"),
                         res=(900, 900))

    # apparent size: in broom-v1-lit.png the head spans about 9% of frame width
    hfov = 2 * math.atan(math.tan(math.radians(66) / 2) * 16 / 9)
    d = (BLOCK[0] / 0.09) / (2 * math.tan(hfov / 2))
    app = H.camera_fov("Apparent", H.orbit_position(centre, d, -126, 20), centre, 66.0)
    app.data.sensor_fit = "VERTICAL"
    H.render(app, os.path.join(OUT_RENDER, f"broom{suffix}-apparent.png"), res=(1600, 900))

    if not broken:
        merged = HS.join(tufts, "BroomBristles")
        exportable = [block, ferrule, merged]
        H.bake_gltf_axis(exportable)
        H.export_glb(exportable, OUT_GLB)
        print(f"FINAL TRIS {H.triangles(exportable)}")


# Guarded so the module can be IMPORTED without building. An unguarded main()
# meant every audit that imported a builder silently re-rendered and re-exported
# its asset as a side effect. Blender runs a --python script as __main__, so the
# command line is unchanged.
if __name__ == "__main__":
    main()
