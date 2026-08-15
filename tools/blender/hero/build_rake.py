"""HERO ASSET — THE BUNKER RAKE.

Reference: Designs/ProShop/J_BUNKER_RAKE.png — a moulded black plastic head with
a smoothing blade along the back, short tines underneath, a black ferrule and a
reddish wood shaft.

What is in the game now is in Designs/ProShop/Images/Goal_26/findings/
rake-exploded-viewmodel.png: capsule lumps floating in the sky with two planks
driven through them. That is a detached first-person hand, not a rake.

The head-to-shaft join and the tines are the same class the bristle assertion
covers -- many small things on one big thing -- so the tines are checked for
ROOT depth in the head and every joint is checked for connection.

    blender --factory-startup -b --python tools/blender/hero/build_rake.py -- [cycles] [break-tines]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402

REPO = os.getcwd()
OUT_RENDER = os.path.join(REPO, "qa", "hero", "rake")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "bunker_rake.glb")

HEAD = (0.460, 0.052, 0.038)     # a course bunker rake head
TINES = 15
TINE_LEN = 0.038
TINE_ROOT = 0.013
SHAFT_ANGLE = 42.0               # off vertical, as the reference shows
SHAFT_LEN = 0.520                # a stub: the rest is out of frame in the viewmodel


def build(broken=False):
    parts = {}

    # ---- the head: a bar with a smoothing blade sweeping back off it. The blade
    # is what a bunker rake actually levels sand with; the tines only comb it.
    bar = HS.box("RakeBar", (0, 0, 0), HEAD, bevel=0.0055, segments=2)
    bar = HS.apply_mods(bar)

    blade_verts, blade_faces = [], []
    COLS = 13
    for i in range(COLS):
        u = i / (COLS - 1)
        x = (u - 0.5) * HEAD[0] * 0.985
        # the blade sweeps back and down from the bar's rear face
        for (dy, dz) in ((0.0, 0.004), (0.030, -0.004), (0.030, -0.011), (0.0, -0.007)):
            blade_verts.append(Vector((x, HEAD[1] * 0.5 - 0.006 + dy, dz)))
    for i in range(COLS - 1):
        a = i * 4
        b = a + 4
        for k in range(4):
            k2 = (k + 1) % 4
            blade_faces.append((a + k, a + k2, b + k2, b + k))
    blade_faces.append((0, 1, 2, 3))
    last = (COLS - 1) * 4
    blade_faces.append((last + 3, last + 2, last + 1, last))
    blade = HS.mesh_from("RakeBlade", blade_verts, blade_faces)
    head = HS.join([bar, blade], "RakeHead")
    parts["head"] = head

    # ---- tines, rooted in the underside of the bar
    tines = []
    for i in range(TINES):
        u = (i + 0.5) / TINES
        x = (u - 0.5) * (HEAD[0] - 0.028)
        top = Vector((x, -0.004, -HEAD[2] * 0.5 + TINE_ROOT))
        if broken:
            # THE DELIBERATELY BROKEN VARIANT: every tine dropped clear of the
            # head. This is the fault that is in the game right now, and the
            # rooting assertion has to catch it. Note the sign -- the head is
            # ABOVE the tines, so breaking them means moving DOWN.
            top = top - Vector((0, 0, 0.030))
        # Chunkier. Bunker rake tines are moulded teeth, not wire pins, and at
        # 5 mm tapering to 2.6 they read as a comb of needles.
        tines.append(HS.prism(f"Tine_{i}", top, Vector((0, -0.16, -1)),
                              TINE_LEN, 0.0082, 0.0044, sides=5))
    parts["tines"] = tines

    # ---- ferrule and shaft
    ang = math.radians(SHAFT_ANGLE)
    axis = Vector((0, -math.sin(ang), math.cos(ang)))
    root = Vector((0, 0.004, HEAD[2] * 0.5 - 0.008))
    rot = axis.to_track_quat("Z", "Y")
    ferrule = HS.join([
        HS.cylinder("FerruleA", root + axis * 0.030, 0.0152, 0.070, verts=16, rotation=rot),
        HS.cylinder("FerruleB", root + axis * 0.068, 0.0168, 0.012, verts=16, rotation=rot),
    ], "RakeFerrule")
    parts["ferrule"] = ferrule

    shaft = HS.cylinder("RakeShaft", root + axis * (0.062 + SHAFT_LEN * 0.5),
                        0.0138, SHAFT_LEN, verts=16, rotation=rot)
    parts["shaft"] = shaft

    # Much rougher. The blade is a broad flat face and at 0.44 it caught the key
    # as a chrome strip along the top of the head, so a black plastic rake read
    # as a steel bar with trim.
    poly = HS.pbr("RakePlastic", (0.0105, 0.0110, 0.0125), roughness=0.72)
    metal = HS.pbr("RakeFerrule", (0.018, 0.018, 0.020), roughness=0.52, metallic=0.5)
    wood = HS.pbr("RakeShaft", (0.098, 0.030, 0.014), roughness=0.66)
    head.data.materials.append(poly)
    for t in tines:
        t.data.materials.append(poly)
    ferrule.data.materials.append(metal)
    shaft.data.materials.append(wood)
    return parts


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = "break-tines" in args
    suffix = "-BROKEN" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=160 if engine == "CYCLES" else 96)
    p = build(broken=broken)

    HS.assert_rooted(p["tines"], p["head"], "rake tines", min_verts=3, min_depth=0.0025)
    HS.assert_touching(p["ferrule"], p["head"],
                       "the ferrule must be seated in the head", max_gap=0.0015)
    HS.assert_touching(p["shaft"], p["ferrule"],
                       "the shaft must be seated in the ferrule", max_gap=0.0015)

    subject = [p["head"], p["ferrule"], p["shaft"]] + p["tines"]
    print(f"TRIS {H.triangles(subject)} ({len(subject)} objects, 3 materials) "
          f"— the hand is 5,179")
    lo, hi = H.bounds(subject)
    print(f"  head {HEAD[0]*1000:.0f} x {HEAD[1]*1000:.0f} x {HEAD[2]*1000:.0f} mm, "
          f"{TINES} tines {TINE_LEN*1000:.0f} long")
    print(f"  overall {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} x "
          f"{(hi.z - lo.z) * 1000:.0f} mm")

    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.18)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, f"rake{suffix}", views=8,
                     elevation=18.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"rake{suffix}-turntable.png"), cols=4)
    for label, az, el in (("hero", -124, 24), ("front", -90, 6),
                          ("under", -90, -50), ("join", -140, 34)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"rake{suffix}-{label}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject, cam,
                         os.path.join(OUT_RENDER, f"rake{suffix}-silhouette.png"),
                         res=(900, 900))

    hfov = 2 * math.atan(math.tan(math.radians(66) / 2) * 16 / 9)
    d = (HEAD[0] / 0.22) / (2 * math.tan(hfov / 2))
    app = H.camera_fov("Apparent", H.orbit_position(centre, d, -124, 20), centre, 66.0)
    app.data.sensor_fit = "VERTICAL"
    H.render(app, os.path.join(OUT_RENDER, f"rake{suffix}-apparent.png"), res=(1600, 900))

    if not broken and engine == "CYCLES":
        merged = HS.join(p["tines"], "RakeTines")
        exportable = [p["head"], p["ferrule"], p["shaft"], merged]
        H.bake_gltf_axis(exportable)
        H.export_glb(exportable, OUT_GLB)
        print(f"FINAL TRIS {H.triangles(exportable)}")


main()
