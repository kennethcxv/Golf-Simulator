"""OUTDOOR TOOL — THE HOSE NOZZLE. Trigger, barrel, coupling, hose at an angle.

Replaces a 20,313-triangle single mesh with one material and no part boundary --
which is exactly why the in-game one cannot carry a socket, and why gripsFor()
falls through to LEGACY_GRIPS and puts the hands 0.97 yd from the nozzle.

ON THE SUPPORT HAND. The queue asks whether one should exist. It should, and the
reason is not that a hose nozzle is two-handed -- it is held in one. It is that
`support: null` gives the animation nothing to aim the other arm at, so the arm
hangs and the tool reads as something nobody is holding. Anybody using a hose
steadies it behind the coupling, so SOCKET_GripSupport goes on the hose stub. A
socket somewhere real beats a null every time.

UNITS ARE YARDS.

    blender --factory-startup -b --python tools/blender/hero/build_hose.py -- \
        [cycles] [break=trigger|head|hose|socket]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402
import outdoor_lib as OL  # noqa: E402

REPO = os.getcwd()
OUT_RENDER = os.path.join(REPO, "qa", "hero", "hose")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "hose_nozzle.glb")

BODY_Y = (-0.0380, 0.0560)
BODY_REAR = (0.0195, 0.0250)
BODY_NOSE = (0.0150, 0.0198)
GRIP_ANGLE = 56.0
GRIP_ROOT = Vector((0, -0.0140, -0.0160))
BARREL_LEN = 0.0720


def build(broken=""):
    p = {}
    M = OL.palette()
    rot_y = Vector((0, 1, 0)).to_track_quat("Z", "Y")
    a = math.radians(GRIP_ANGLE)
    axis = Vector((0, -math.sin(a), -math.cos(a)))
    rot_g = axis.to_track_quat("Z", "Y")

    # ---- body
    p["body"] = OL.tapered_box("NozzleBody", BODY_Y[0], BODY_Y[1],
                               BODY_REAR, BODY_NOSE, bevel=0.0055)
    p["seam"] = OL.tapered_box("NozzleSeam", BODY_Y[0] + 0.0055, BODY_Y[1] - 0.0055,
                               (BODY_REAR[0] + 0.0006, 0.0015),
                               (BODY_NOSE[0] + 0.0009, 0.0015))

    # ---- grip socket collar, then the grip. Two solids crossing is what reads
    # as phasing; a moulded tool meets its grip at a part boundary.
    p["collar"] = HS.join([
        HS.cylinder("CollA", GRIP_ROOT + axis * 0.005, 0.0238, 0.0160,
                    verts=14, rotation=rot_g),
        HS.cylinder("CollB", GRIP_ROOT + axis * 0.017, 0.0202, 0.0120,
                    verts=14, rotation=rot_g),
    ], "GripCollar")
    grip = HS.join([
        HS.cylinder("GripA", GRIP_ROOT + axis * 0.038, 0.0164, 0.0760,
                    verts=14, rotation=rot_g),
        HS.cylinder("GripSwell", GRIP_ROOT + axis * 0.042, 0.0188, 0.0280,
                    verts=14, rotation=rot_g),
        HS.cylinder("GripRib0", GRIP_ROOT + axis * 0.030, 0.0180, 0.0050,
                    verts=14, rotation=rot_g),
        HS.cylinder("GripRib1", GRIP_ROOT + axis * 0.046, 0.0186, 0.0050,
                    verts=14, rotation=rot_g),
        HS.cylinder("GripRib2", GRIP_ROOT + axis * 0.062, 0.0178, 0.0050,
                    verts=14, rotation=rot_g),
    ], "NozzleGrip")
    grip.scale.x = 0.80
    bpy.context.view_layer.objects.active = grip
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    p["grip"] = grip

    # ---- trigger, hung forward into its guard
    tv, tf = [], []
    STEPS = 7
    drop = 0.0180 if broken == "trigger" else 0.0
    for s in range(STEPS):
        t = s / (STEPS - 1)
        y = 0.0180 - 0.0380 * t + 0.0280 * t * t
        z = -0.0120 - 0.0310 * t - drop
        w = 0.0088 - 0.0015 * t
        for sx in (-1, 1):
            for sy in (-1, 1):
                tv.append(Vector((sx * w, y + sy * 0.0040, z)))
    for s in range(STEPS - 1):
        a0, b0 = s * 4, s * 4 + 4
        tf += [(a0, a0 + 1, b0 + 1, b0), (a0 + 2, a0 + 3, b0 + 3, b0 + 2),
               (a0, a0 + 2, b0 + 2, b0), (a0 + 1, a0 + 3, b0 + 3, b0 + 1)]
    tf.append((0, 1, 3, 2))
    last = (STEPS - 1) * 4
    tf.append((last + 2, last + 3, last + 1, last))
    p["trigger"] = HS.mesh_from("NozzleTrigger", tv, tf)

    GS = 13
    p["guard"] = OL.sweep("TriggerGuard", [
        Vector((0, 0.006 + 0.034 * math.cos(math.pi * (s / (GS - 1))),
                -0.014 - 0.044 * math.sin(math.pi * (s / (GS - 1)))))
        for s in range(GS)], 0.0062, sides=6)

    # ---- barrel and the adjustable spray head
    p["barrel"] = HS.cylinder("Barrel", (0, 0.0480 + BARREL_LEN * 0.5, 0),
                              0.0112, BARREL_LEN, verts=16, rotation=rot_y)
    head_y = 0.0480 + BARREL_LEN + (0.045 if broken == "head" else 0.0)
    p["head"] = HS.join([
        # a knurled adjusting ring, which is what a hose nozzle has instead of a
        # quick-connect: you twist it from jet to fan
        HS.cylinder("HeadRing", (0, head_y - 0.0140, 0), 0.0168, 0.0220,
                    verts=12, rotation=rot_y),
        HS.cylinder("HeadNose", (0, head_y - 0.0010, 0), 0.0128, 0.0130,
                    verts=14, rotation=rot_y),
    ], "SprayHead")
    p["tip"] = HS.prism("SprayTip", Vector((0, head_y + 0.0040, 0)),
                        Vector((0, 1, 0)), 0.0130, 0.0104, 0.0060, sides=12)

    # ---- coupling at the butt, and the hose leaving at an angle
    p["coupling"] = HS.join([
        HS.cylinder("CoupNut", GRIP_ROOT + axis * 0.086, 0.0206, 0.0140,
                    verts=6, rotation=rot_g),
        HS.cylinder("CoupShank", GRIP_ROOT + axis * 0.070, 0.0108, 0.0280,
                    verts=10, rotation=rot_g),
    ], "HoseCoupling")

    hose_gap = 0.070 if broken == "hose" else 0.0
    butt = GRIP_ROOT + axis * (0.092 + hose_gap)
    path = []
    for s in range(11):
        t = s / 10.0
        # leaves along the grip axis then falls away and back, the way a hose
        # under its own weight actually hangs
        path.append(butt + axis * (-0.012 + 0.070 * t)
                    + Vector((0, -0.048 * t * t, -0.155 * t * t * t
                              - 0.030 * t * t)))
    p["hose"] = OL.sweep("HoseStub", path, 0.0118, sides=8)

    # ---- THE SOCKETS. 0.97 is the measured distance the hose's hands sit from
    # the hose today; the control reproduces the real fault rather than one
    # invented for the occasion.
    stray = Vector((0.97, 0, 0)) if broken == "socket" else Vector((0, 0, 0))
    p["sock_primary"] = H.socket("SOCKET_GripPrimary",
                                 GRIP_ROOT + axis * 0.040 + stray)
    p["sock_support"] = H.socket("SOCKET_GripSupport", path[6])

    for key, mat in (("body", "green"), ("seam", "rubber"), ("collar", "green"),
                     ("grip", "rubber"), ("trigger", "rubber"), ("guard", "green"),
                     ("barrel", "steel"), ("head", "brass"), ("tip", "brass"),
                     ("coupling", "brass"), ("hose", "green")):
        p[key].data.materials.append(M[mat])
    for key in ("barrel", "head", "tip", "coupling", "grip", "collar"):
        OL.smooth_barrel(p[key])
    p["materials"] = sorted({"green", "rubber", "steel", "brass"})
    return p


ORDER = ["body", "seam", "collar", "grip", "trigger", "guard", "barrel",
         "head", "tip", "coupling", "hose"]


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = next((x.split("=", 1)[1] for x in args if x.startswith("break=")), "")
    suffix = f"-BROKEN-{broken}" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=170 if engine == "CYCLES" else 104)
    p = build(broken=broken)

    HS.assert_touching(p["collar"], p["body"], "the grip collar must be on the body", 0.0030)
    HS.assert_touching(p["grip"], p["collar"], "the grip must seat in its collar", 0.0030)
    HS.assert_touching(p["trigger"], p["body"], "the trigger must hang off the body", 0.0030)
    HS.assert_touching(p["guard"], p["body"], "the guard must root in the body", 0.0035)
    HS.assert_touching(p["barrel"], p["body"], "the barrel must root in the body", 0.0025)
    HS.assert_touching(p["barrel"], p["head"], "the spray head must be on the barrel", 0.0025)
    HS.assert_touching(p["tip"], p["head"], "the tip must be in the head", 0.0025)
    HS.assert_touching(p["coupling"], p["grip"], "the coupling must be in the butt", 0.0030)
    HS.assert_touching(p["hose"], p["coupling"], "the hose must be on the coupling", 0.0030)
    HS.assert_no_overlap(p["trigger"], p["guard"],
                         "the trigger must swing inside its guard", min_gap=0.0008)
    HS.assert_socket_at(p["grip"], p["sock_primary"],
                        "the trigger hand closes on the grip")
    HS.assert_socket_at(p["hose"], p["sock_support"],
                        "the other hand steadies the hose behind the coupling")

    subject = [p[k] for k in ORDER]
    print(f"TRIS {H.triangles(subject)} ({len(subject)} objects, "
          f"{len(p['materials'])} shared materials) — the hand is 5,179; "
          f"the in-game hose is 20,313 in one mesh")
    lo, hi = H.bounds(subject)
    print(f"  overall {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} x "
          f"{(hi.z - lo.z) * 1000:.0f} mm")

    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.16)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, f"hose{suffix}", views=8,
                     elevation=20.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"hose{suffix}-turntable.png"), cols=4)
    for label, az, el in (("hero", -122, 24), ("side", 180, 8),
                          ("grip", -40, -8), ("head", -90, 14)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"hose{suffix}-{label}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject, cam,
                         os.path.join(OUT_RENDER, f"hose{suffix}-silhouette.png"),
                         res=(900, 900))

    if not broken and engine == "CYCLES":
        socks = [p["sock_primary"], p["sock_support"]]
        H.bake_gltf_axis(subject + socks)
        H.export_glb(subject + socks, OUT_GLB)
        print(f"FINAL TRIS {H.triangles(subject)}")
        H.verify_sockets(OUT_GLB, ["SOCKET_GripPrimary", "SOCKET_GripSupport"])


# Guarded so the module can be IMPORTED without building. An unguarded main()
# meant every audit that imported a builder silently re-rendered and re-exported
# its asset as a side effect. Blender runs a --python script as __main__, so the
# command line is unchanged.
if __name__ == "__main__":
    main()
