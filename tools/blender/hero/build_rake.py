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
# A FULL shaft, not a viewmodel stub. Two hands have to land on this tool and
# the sockets have to be somewhere real, so the shaft runs its whole length.
SHAFT_LEN = 1.150


def tapered_tine(name, base, direction, length, r0, r1, sides=7):
    """A tine: a taper that closes over a rounded tip, with a root fillet."""
    d = Vector(direction).normalized()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(up).normalized()
    v = d.cross(u).normalized()
    PROF = ((0.00, 1.34), (0.10, 1.00), (0.55, 0.72), (0.86, 0.46),
            (0.95, 0.30), (1.00, 0.06))
    verts, faces = [], []
    for (t, k) in PROF:
        r = (r0 + (r1 - r0) * t) * k
        c = Vector(base) + d * (length * t)
        for i in range(sides):
            a = 2 * math.pi * i / sides
            verts.append(c + u * (math.cos(a) * r) + v * (math.sin(a) * r))
    for j in range(len(PROF) - 1):
        for i in range(sides):
            a = j * sides + i
            b = j * sides + (i + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range((len(PROF) - 1) * sides, len(PROF) * sides)))
    return HS.mesh_from(name, verts, faces, smooth=True)


def moulded_bar():
    """The head as a MOULDED bar, not a bevelled box.

    A bevelled box is a bar, and beside the apparel it read as exactly that:
    primitive-built. A course rake head is injection-moulded -- it bows a few
    millimetres along its length so the tines meet sand evenly, its back is
    rounded rather than square, and a raised spine runs down the middle where
    the wall thickens for the handle boss. Those three lines are the whole
    difference between a moulding and an extrusion.
    """
    NX, NA = 34, 14
    hy, hz = HEAD[1] * 0.5, HEAD[2] * 0.5
    rows = []
    for i in range(NX + 1):
        u = -1.0 + 2.0 * i / NX
        x = u * HEAD[0] * 0.5
        # the bow, and the ends drawing in
        bow = 0.0075 * (1.0 - u * u)
        taper = 1.0 - 0.16 * (abs(u) ** 3.2)
        # ... and the spine: the section is deeper through the middle third
        spine = 1.0 + 0.24 * math.exp(-((u / 0.30) ** 2))
        row = []
        for k in range(NA):
            a = 2 * math.pi * k / NA
            # a rounded-rectangle section: square-ish front face, round back
            ca, sa = math.cos(a), math.sin(a)
            e = 2.6 if sa > 0 else 1.7          # front crisper than the back
            py = hy * taper * math.copysign(abs(ca) ** (2.0 / e), ca)
            pz = hz * taper * spine * math.copysign(abs(sa) ** (2.0 / e), sa)
            row.append(Vector((x, py - bow, pz)))
        rows.append(row)
    verts, faces = [], []
    for row in rows:
        verts.extend(row)
    for i in range(NX):
        for k in range(NA):
            a = i * NA + k
            b = i * NA + (k + 1) % NA
            faces.append((a, b, b + NA, a + NA))
    faces.append(tuple(range(NA - 1, -1, -1)))
    faces.append(tuple(range(NX * NA, NX * NA + NA)))
    ob = HS.mesh_from("RakeBar", verts, faces, smooth=True)
    return ob


def build(broken=""):
    parts = {}

    # ---- the head: a bar with a smoothing blade sweeping back off it. The blade
    # is what a bunker rake actually levels sand with; the tines only comb it.
    bar = moulded_bar()

    blade_verts, blade_faces = [], []
    COLS = 13
    for i in range(COLS):
        u = i / (COLS - 1)
        x = (u - 0.5) * HEAD[0] * 0.985
        # the blade sweeps back and down from the bar's rear face
        # WIDER, AND WITH A DOWNTURNED LIP. At 30 mm of reach and no lip the
        # levelling blade -- the part a bunker rake actually smooths sand with
        # -- was a thin flange the same colour as the bar, invisible from every
        # hero angle. 46 mm with the trailing edge turned down gives it a
        # silhouette and an edge to catch the key.
        for (dy, dz) in ((0.0, 0.005), (0.030, -0.003), (0.046, -0.010),
                         (0.046, -0.017), (0.030, -0.013), (0.0, -0.008)):
            blade_verts.append(Vector((x, HEAD[1] * 0.5 - 0.006 + dy, dz)))
    SEC = 6
    for i in range(COLS - 1):
        a = i * SEC
        b = a + SEC
        for k in range(SEC):
            k2 = (k + 1) % SEC
            blade_faces.append((a + k, a + k2, b + k2, b + k))
    blade_faces.append(tuple(range(SEC)))
    last = (COLS - 1) * SEC
    blade_faces.append(tuple(range(last + SEC - 1, last - 1, -1)))
    blade = HS.mesh_from("RakeBlade", blade_verts, blade_faces)
    # A MOULDED BRAND PANEL. An injection-moulded tool does not carry a printed
    # label, it carries a recessed panel with raised lettering; three ribs at
    # this size is all the eye reads and it is the only event on an otherwise
    # blank 460 mm bar.
    plate = HS.box("RakePlate", (0.0, -0.004, HEAD[2] * 0.5 + 0.0035),
                   (0.108, 0.026, 0.0026), bevel=0.0008, segments=2)
    plate = HS.apply_mods(plate)
    ribs = [plate]
    for k in range(3):
        ribs.append(HS.box(f"RakeRib_{k}",
                           (-0.030 + k * 0.030, -0.004,
                            HEAD[2] * 0.5 + 0.0052),
                           (0.020, 0.0044, 0.0014), bevel=0.0005, segments=1))
    ribs = [HS.apply_mods(r) if r is not plate else r for r in ribs]
    head = HS.join([bar, blade] + ribs, "RakeHead")
    parts["head"] = head

    # ---- tines, rooted in the underside of the bar
    tines = []
    for i in range(TINES):
        u = (i + 0.5) / TINES
        x = (u - 0.5) * (HEAD[0] - 0.028)
        top = Vector((x, -0.004, -HEAD[2] * 0.5 + TINE_ROOT))
        if broken == "tines":
            # THE DELIBERATELY BROKEN VARIANT: every tine dropped clear of the
            # head. This is the fault that is in the game right now, and the
            # rooting assertion has to catch it. Note the sign -- the head is
            # ABOVE the tines, so breaking them means moving DOWN.
            top = top - Vector((0, 0, 0.030))
        # Chunkier. Bunker rake tines are moulded teeth, not wire pins, and at
        # 5 mm tapering to 2.6 they read as a comb of needles.
        # A ROUNDED TIP AND A ROOT FILLET. Five-sided prisms cut square at
        # both ends are square nubs: at this size the tip is what the eye
        # lands on, and a moulded tine is a cone with a 2 mm ball on it. The
        # lengths also wander by a millimetre, because a moulding does.
        wob = 0.0011 * math.sin(i * 2.7 + 0.6)
        tines.append(tapered_tine(f"Tine_{i}", top - Vector((0, 0.0075 * (1.0 - (2 * u - 1) ** 2), 0)),
                                  Vector((0, -0.16, -1)), TINE_LEN + wob,
                                  0.0086, 0.0030))
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

    # TAPERED, thick at the ferrule and thinner at the grip, which is how a
    # rake shaft is actually turned
    shaft = HS.prism("RakeShaft", root + axis * 0.062, axis, SHAFT_LEN,
                     0.0150, 0.0118, sides=16)
    parts["shaft"] = shaft

    # ---- the moulded end grip
    top = root + axis * (0.062 + SHAFT_LEN)
    grip = HS.join([
        HS.cylinder("GripBody", top - axis * 0.088, 0.0172, 0.176,
                    verts=14, rotation=rot),
        HS.cylinder("GripFlare", top - axis * 0.008, 0.0196, 0.020,
                    verts=14, rotation=rot),
        HS.cylinder("GripCollar", top - axis * 0.174, 0.0158, 0.014,
                    verts=14, rotation=rot),
    ], "RakeGrip")
    parts["grip"] = grip

    # ---- THE SOCKETS. 0.81 is the measured distance the rake's hands sit from
    # the rake today, when gripsFor() falls through to LEGACY_GRIPS. The control
    # reproduces that exact fault rather than inventing one.
    stray = Vector((0.81, 0, 0)) if broken == "socket" else Vector((0, 0, 0))
    parts["sock_primary"] = H.socket("SOCKET_GripPrimary",
                                     top - axis * 0.070 + stray)
    parts["sock_support"] = H.socket("SOCKET_GripSupport",
                                     root + axis * (0.062 + SHAFT_LEN * 0.44))

    # Much rougher. The blade is a broad flat face and at 0.44 it caught the key
    # as a chrome strip along the top of the head, so a black plastic rake read
    # as a steel bar with trim.
    # Moulded plastic has a fine matte grain and a shaft has wood grain; both
    # were flat colour. Noise SCALE is in Generated space -- the bounding box,
    # not metres -- so the number has to be set per object size: about one cell
    # per millimetre is what reads as a surface rather than as paint.
    poly = HS.surface("RakePlastic", (0.0125, 0.0132, 0.0148), rough=0.74,
                      scale=190.0, strength=0.22, dist=0.00035, spread=0.16)
    metal = HS.pbr("RakeFerrule", (0.030, 0.030, 0.033), roughness=0.44,
                   metallic=0.62)
    wood = HS.surface("RakeShaft", (0.104, 0.036, 0.018), rough=0.62,
                      scale=520.0, strength=0.20, dist=0.00028, spread=0.22,
                      detail=3.0)
    head.data.materials.append(poly)
    grip.data.materials.append(poly)
    for t in tines:
        t.data.materials.append(poly)
    ferrule.data.materials.append(metal)
    shaft.data.materials.append(wood)
    return parts


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = next((x.split("=", 1)[1] for x in args if x.startswith("break=")),
                  "tines" if "break-tines" in args else "")
    suffix = f"-BROKEN-{broken}" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=160 if engine == "CYCLES" else 96)
    p = build(broken=broken)

    HS.assert_rooted(p["tines"], p["head"], "rake tines", min_verts=3, min_depth=0.0025)
    # A RAKE'S SOCKET IS MOULDED DEEP. The ferrule reaches 18.9 mm into a 38 mm
    # head, which is its middle, and that is how the object is made -- so the
    # depth is declared here rather than left to the 6 mm default that the
    # rebuilt assertion applies to everything else.
    #
    # What would actually be wrong is the ferrule coming out of the UNDERSIDE
    # among the tines, and no depth number can tell you that. It needs its own
    # measurement, so it gets one.
    HS.assert_touching(p["ferrule"], p["head"],
                       "the ferrule is socketed into the head, as a moulded "
                       "rake is", max_gap=0.0015, max_depth=0.0220)
    flo = min((p["ferrule"].matrix_world @ v.co).z
              for v in p["ferrule"].data.vertices)
    hlo = min((p["head"].matrix_world @ v.co).z for v in p["head"].data.vertices)
    if flo < hlo + 0.0040:
        raise SystemExit(
            f"BUILD FAILED: the ferrule stops {(flo - hlo) * 1000:.1f} mm above "
            f"the head's underside -- it is coming through among the tines")
    print(f"  socket clearance assertion passed: the ferrule stops "
          f"{(flo - hlo) * 1000:.1f} mm above the head's underside")
    HS.assert_touching(p["shaft"], p["ferrule"],
                       "the shaft must be seated in the ferrule", max_gap=0.0015)

    # shaft-INTO-grip, not grip-into-shaft: the grip is a sleeve AROUND the
    # shaft, so it is wider than its host and not one of its vertices lands
    # inside. Fourth part on this project with that shape. The shaft's top end
    # DOES land inside the grip, so that is the direction that measures it.
    HS.assert_touching(p["shaft"], p["grip"], "the end grip must be on the shaft",
                       max_gap=0.0025)
    HS.assert_socket_at(p["grip"], p["sock_primary"],
                        "the top hand closes on the end grip")
    HS.assert_socket_at(p["shaft"], p["sock_support"],
                        "the lower hand closes on the shaft")

    subject = [p["head"], p["ferrule"], p["shaft"], p["grip"]] + p["tines"]

    # UVs and the grain BEFORE the renders. Generated-space noise on a

    # diagonal shaft in a big bounding box runs the wood grain ACROSS the

    # timber, which is the one thing that says painted dowel.

    HS.unwrap_and_grain(subject)
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

    if not broken:
        merged = HS.join(p["tines"], "RakeTines")
        exportable = [p["head"], p["ferrule"], p["shaft"], p["grip"], merged]
        socks = [p["sock_primary"], p["sock_support"]]
        # A bunker rake stands or leans against something; the game's props
        # all sit with their base at exactly z = 0 and this one straddled the
        # origin by 830 mm.
        # (The location bake that used to be here is inside bake_gltf_axis
        # now, so it happens for every builder and cannot be forgotten.)
        H.drop_to_floor(exportable + socks)
        H.bake_gltf_axis(exportable + socks)
        H.export_glb(exportable + socks, OUT_GLB)
        print(f"FINAL TRIS {H.triangles(exportable)}")
        H.verify_sockets(OUT_GLB, ["SOCKET_GripPrimary", "SOCKET_GripSupport"])


# Guarded so the module can be IMPORTED without building. An unguarded main()
# meant every audit that imported a builder silently re-rendered and re-exported
# its asset as a side effect. Blender runs a --python script as __main__, so the
# command line is unchanged.
if __name__ == "__main__":
    main()
