"""HERO ASSET — THE SHOPPING BAG, with a REAL interior volume.

Every sale ends here, and goods have phased through this bag across three
playtests. A bag modelled as an outside can only ever be tested against a
guessed rectangle, so this models the CAVITY as its own closed mesh and the
clearance assertion walks a load-sized probe against it.

That is the difference that matters: `assert_fits_inside` is measuring the shape
the goods actually have to live in, not a number somebody wrote down.

    blender --factory-startup -b --python tools/blender/hero/build_bag.py -- [cycles] [break-interior]
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
OUT_RENDER = os.path.join(REPO, "qa", "hero", "bag")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "shopping_bag.glb")

SIDES = 24
WALL = 0.0016
# (z, half-width X, half-depth Y). A filled kraft bag bows outward at the middle
# and pulls in slightly at the rim where the fold stiffens it.
PROFILE = [
    (0.0000, 0.1320, 0.0740),
    (0.0140, 0.1360, 0.0778),
    (0.0700, 0.1408, 0.0812),
    (0.1500, 0.1428, 0.0826),
    (0.2300, 0.1404, 0.0808),
    (0.2950, 0.1352, 0.0770),
    (0.3180, 0.1332, 0.0756),
    (0.3300, 0.1348, 0.0768),   # the rolled rim
]
# What the bag has to hold: the biggest single item the checkout packs.
LOAD = (0.190, 0.100, 0.155)
ROUND = 0.42        # superellipsoid exponent: a bag section is a soft rectangle


def section(z, rx, ry, inset=0.0, crease=True):
    """A superellipse with GUSSET CREASES at the four corners.

    Without them the bag is a smooth tube and reads as a leather tote. A paper
    bag is folded flat and opened, so the corners carry a vertical crease that
    pulls in slightly -- it is the single detail that says paper rather than
    moulded plastic.
    """
    pts = []
    for i in range(SIDES):
        u = -math.pi + 2 * math.pi * i / SIDES
        cu, su = math.cos(u), math.sin(u)
        px = math.copysign(abs(cu) ** ROUND, cu) if abs(cu) > 1e-9 else 0.0
        py = math.copysign(abs(su) ** ROUND, su) if abs(su) > 1e-9 else 0.0
        k = 1.0
        if crease:
            # four creases, at the corners of the flattened bag
            # At 0.030 the creases were invisible and the bag still read as a
            # smooth tote. A real gusset pulls in several millimetres.
            k -= 0.075 * max(0.0, math.cos(4 * u - math.pi)) ** 4
        pts.append(Vector((px * (rx - inset) * k, py * (ry - inset) * k, z)))
    return pts


def loft(name, rings, close_bottom=True, close_top=True):
    verts, faces = [], []
    for r in rings:
        verts.extend(r)
    for r in range(len(rings) - 1):
        for i in range(SIDES):
            j = (i + 1) % SIDES
            faces.append((r * SIDES + i, r * SIDES + j,
                          (r + 1) * SIDES + j, (r + 1) * SIDES + i))
    if close_bottom:
        faces.append(tuple(range(SIDES - 1, -1, -1)))
    if close_top:
        b = (len(rings) - 1) * SIDES
        faces.append(tuple(range(b, b + SIDES)))
    return HS.mesh_from(name, verts, faces, smooth=True)


def build(broken=False):
    parts = {}

    outer = loft("BagOuter", [section(z, rx, ry) for (z, rx, ry) in PROFILE],
                 close_top=False)
    solid = outer.modifiers.new("Paper", "SOLIDIFY")
    solid.thickness = WALL
    solid.offset = 1.0
    solid.use_rim = True
    parts["bag"] = HS.apply_mods(outer)

    # ---- THE CAVITY, as its own closed mesh. This is the thing the clearance
    # assertion measures against, and it is why that assertion means something.
    shrink = 0.026 if broken else 0.0
    interior = loft("BagInterior",
                    [section(z, rx, ry, inset=WALL + 0.0012 + shrink)
                     for (z, rx, ry) in PROFILE[:-1]] +
                    [section(PROFILE[-1][0] - 0.004,
                             PROFILE[-1][1], PROFILE[-1][2],
                             inset=WALL + 0.0012 + shrink)])
    parts["interior"] = interior

    # ---- handles: twisted paper cord, both ends into the rim
    handles = []
    for side in (-1, 1):
        pts, faces = [], []
        STEPS, RING = 11, 6
        for s in range(STEPS):
            t = s / (STEPS - 1)
            a = math.pi * t
            cx = math.cos(a) * 0.062
            cz = PROFILE[-1][0] - 0.020 + math.sin(a) * 0.090
            # ON the panel, not inside the cavity. The section is a superellipse,
            # so the wall at x = 62 mm is NOT at the rim's half-depth -- solving
            # it puts the ends 8.7 mm further out than the rim number suggested,
            # which is exactly how far they were floating.
            t = max(0.0, 1.0 - abs(cx / PROFILE[-1][1]) ** (1.0 / ROUND))
            cy = side * (PROFILE[-1][2] * (t ** ROUND) + 0.0016)
            dirv = Vector((-math.sin(a), 0, math.cos(a)))
            u = Vector((0, 1, 0))
            v = dirv.cross(u).normalized()
            for k in range(RING):
                b = 2 * math.pi * k / RING
                pts.append(Vector((cx, cy, cz))
                           + u * (math.cos(b) * 0.0052)
                           + v * (math.sin(b) * 0.0052))
        for s in range(STEPS - 1):
            for k in range(RING):
                q = (k + 1) % RING
                faces.append((s * RING + k, s * RING + q,
                              (s + 1) * RING + q, (s + 1) * RING + k))
        faces.append(tuple(range(RING - 1, -1, -1)))
        base = (STEPS - 1) * RING
        faces.append(tuple(range(base, base + RING)))
        handles.append(HS.mesh_from(f"BagHandle_{'F' if side < 0 else 'B'}",
                                    pts, faces, smooth=True))
    parts["handles"] = handles

    kraft = HS.pbr("BagKraft", (0.205, 0.108, 0.042), roughness=0.97)
    cord = HS.pbr("BagCord", (0.150, 0.078, 0.030), roughness=0.98)
    inner = HS.pbr("BagInner", (0.165, 0.092, 0.038), roughness=0.95)
    parts["bag"].data.materials.append(kraft)
    interior.data.materials.append(inner)
    for h in handles:
        h.data.materials.append(cord)
    return parts


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = "break-interior" in args
    suffix = "-BROKEN" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=160 if engine == "CYCLES" else 96)
    p = build(broken=broken)

    HS.assert_fits_inside(p["interior"], LOAD,
                          "the bag has to hold what checkout packs into it",
                          margin=0.0030)
    for h in p["handles"]:
        HS.assert_touching(h, p["bag"], "a handle must be attached to the bag",
                           max_gap=0.0020)

    subject = [p["bag"]] + p["handles"]
    print(f"TRIS {H.triangles(subject)} ({len(subject)} objects, 2 materials) "
          f"— the hand is 5,179")
    lo, hi = H.bounds(subject)
    print(f"  overall {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} x "
          f"{(hi.z - lo.z) * 1000:.0f} mm, load {LOAD[0]*1000:.0f} x "
          f"{LOAD[1]*1000:.0f} x {LOAD[2]*1000:.0f}")

    p["interior"].hide_render = True
    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.20)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, f"bag{suffix}", views=8,
                     elevation=18.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"bag{suffix}-turntable.png"), cols=4)
    for label, az, el in (("hero", -124, 22), ("front", -90, 8),
                          ("into", -90, 62), ("side", 0, 8)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"bag{suffix}-{label}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject, cam,
                         os.path.join(OUT_RENDER, f"bag{suffix}-silhouette.png"),
                         res=(900, 900))

    hfov = 2 * math.atan(math.tan(math.radians(66) / 2) * 16 / 9)
    d = (0.280 / 0.26) / (2 * math.tan(hfov / 2))
    app = H.camera_fov("Apparent", H.orbit_position(centre, d, -124, 18), centre, 66.0)
    app.data.sensor_fit = "VERTICAL"
    H.render(app, os.path.join(OUT_RENDER, f"bag{suffix}-apparent.png"), res=(1600, 900))

    if not broken and engine == "CYCLES":
        H.bake_gltf_axis(subject)
        H.export_glb(subject, OUT_GLB)
        print(f"FINAL TRIS {H.triangles(subject)}")


main()
