"""OUTDOOR TOOL — THE ROTARY SPREADER. Pushed, hopper, wheels, spinner.

Pushed, not held, so no grip sockets -- but a NAMED ROOT, for the same reason
the mower has one: the pushed tools export their parts directly under `Scene`,
which is the naming gap that made Tool_rake unfindable for two sessions.

The hopper HOLDS something, so its interior is measured off a cavity mesh and
reported, the same rule the bag and the divot pail live under.

Everything here applies what the mower taught an hour ago: cross members run
INTO their hosts rather than up to them, boxes that share volume are tested with
assert_boxes_overlap rather than by vertex distance, and every break exceeds the
overlap it undoes.

UNITS ARE YARDS.

    blender --factory-startup -b --python tools/blender/hero/build_spreader.py -- \
        [cycles] [break=fins|axle|bar]
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
OUT_RENDER = os.path.join(REPO, "qa", "hero", "spreader")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "rotary_spreader.glb")
ROOT_NAME = "Tool_rotary_spreader"

HOP_W, HOP_D = 0.4200, 0.3600
HOP_TOP, HOP_BOT = 0.5100, 0.2600
WHEEL_R = 0.1300
TRACK = 0.5200
BAR_TOP = 0.9400
FINS = 5


def rot_x():
    return Vector((1, 0, 0)).to_track_quat("Z", "Y")


def ring4(w, d, z):
    return [Vector((sx * w * 0.5, sy * d * 0.5, z))
            for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


def loft(name, rings, close_bottom=False, close_top=False):
    n = len(rings[0])
    verts, faces = [], []
    for r in rings:
        verts.extend(r)
    for r in range(len(rings) - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append((r * n + i, r * n + j, (r + 1) * n + j, (r + 1) * n + i))
    if close_bottom:
        faces.append(tuple(range(n - 1, -1, -1)))
    if close_top:
        b = (len(rings) - 1) * n
        faces.append(tuple(range(b, b + n)))
    return HS.mesh_from(name, verts, faces)


def build(broken=""):
    p = {}
    M = OL.palette()

    # ---- the hopper: a box that narrows to a chute, open at the top
    p["hopper"] = HS.apply_mods(HS.solidify(loft("Hopper", [
        ring4(HOP_W * 0.30, HOP_D * 0.30, HOP_BOT),
        ring4(HOP_W * 0.72, HOP_D * 0.72, HOP_BOT + 0.0700),
        ring4(HOP_W, HOP_D, HOP_TOP - 0.0300),
        ring4(HOP_W + 0.0140, HOP_D + 0.0140, HOP_TOP)]), 0.0070))
    p["interior"] = loft("HopperInterior", [
        ring4(HOP_W * 0.30 - 0.014, HOP_D * 0.30 - 0.014, HOP_BOT + 0.007),
        ring4(HOP_W * 0.72 - 0.014, HOP_D * 0.72 - 0.014, HOP_BOT + 0.0700),
        ring4(HOP_W - 0.014, HOP_D - 0.014, HOP_TOP - 0.0340)],
        close_bottom=True, close_top=True)
    p["interior"].hide_render = True     # a measurement aid; render() draws all

    # ---- frame: two side rails running the length, plus a cross rail. They run
    # OUT PAST the hopper so the wheels and the bar have something to root in.
    p["rails"] = [HS.apply_mods(HS.box(
        # UNDER the hopper, not outboard of it: at +0.026 the rails and the
        # hopper shared no volume at all and the hopper sat on nothing.
        f"Rail_{k}", (sx * (HOP_W * 0.5 - 0.0100), 0.0200, HOP_BOT - 0.0100),
        (0.0280, 0.4000, 0.0320), bevel=0.0040, segments=2))
        for k, sx in enumerate((-1, 1))]
    p["crossrail"] = HS.apply_mods(HS.box(
        "CrossRail", (0, -0.1200, HOP_BOT - 0.0100),
        # reaches INTO the side rails rather than past them
        (HOP_W - 0.0200, 0.0260, 0.0260), bevel=0.0040, segments=2))

    # ---- axle and wheels. The axle runs THROUGH both wheels.
    # ends INSIDE the hubs. A cylinder's only vertices are its two end caps, so
    # an axle that overshoots the wheels has nothing of itself in them.
    p["axle"] = HS.cylinder("Axle", (0, -0.1200, WHEEL_R), 0.0110,
                            TRACK + 0.0200, verts=12, rotation=rot_x())
    gap = 0.140 if broken == "axle" else 0.0
    p["wheels"] = []
    for k, sx in enumerate((-1, 1)):
        x = sx * (TRACK * 0.5 + gap)
        # WELD, not join: a tyre and a hub left intersecting inside one object
        # make parity meaningless, and the axle -- whose end caps are deep in
        # the hub -- came back as "16.00 mm from Wheel_0 and not embedded".
        p["wheels"].append(HS.weld_union([
            HS.cylinder(f"Tyre_{k}", (x, -0.1200, WHEEL_R), WHEEL_R, 0.0520,
                        verts=22, rotation=rot_x()),
            HS.cylinder(f"Hub_{k}", (x, -0.1200, WHEEL_R), WHEEL_R * 0.42, 0.0620,
                        verts=14, rotation=rot_x()),
        ], f"Wheel_{k}"))

    # ---- the spinner plate under the chute, with fins
    plate_z = HOP_BOT - 0.0560
    p["plate"] = HS.cylinder("SpinnerPlate", (0, 0, plate_z), 0.1080, 0.0100,
                             verts=20)
    lift = 0.055 if broken == "fins" else 0.0
    p["fins"] = []
    for f in range(FINS):
        a = 2 * math.pi * f / FINS
        p["fins"].append(HS.apply_mods(HS.box(
            f"SpinnerFin_{f}", (math.cos(a) * 0.0560, math.sin(a) * 0.0560,
                                plate_z + 0.0130 + lift),
            (0.0900, 0.0080, 0.0220), bevel=0.0020, segments=1)))
        p["fins"][-1].rotation_euler = (0, 0, a)
    p["chute"] = HS.cylinder("Chute", (0, 0, HOP_BOT - 0.0100), 0.0460, 0.0500,
                             verts=16)

    # ---- handlebar
    barlift = 0.090 if broken == "bar" else 0.0
    arms = []
    for k, sx in enumerate((-1, 1)):
        path = []
        for s in range(9):
            t = s / 8.0
            path.append(Vector((sx * (HOP_W * 0.5 - 0.0100),
                                0.1400 + 0.3600 * t,
                                HOP_BOT - 0.0200 + barlift
                                + (BAR_TOP - HOP_BOT) * (t ** 0.88))))
        arms.append(OL.sweep(f"BarArm_{k}", path, 0.0130, sides=8))
    p["arms"] = arms
    # ends ON the arms and level with their tops. It was 50mm outboard of them
    # and 20mm above, so its only vertices -- the two end caps -- met nothing.
    p["bar_cross"] = HS.cylinder("BarCross", (0, 0.5000, BAR_TOP - 0.0200),
                                 0.0130, HOP_W - 0.0200, verts=10, rotation=rot_x())
    p["grips"] = [HS.cylinder(f"BarGrip_{k}", (sx * (HOP_W * 0.5 - 0.0240),
                                               0.5000, BAR_TOP - 0.0200),
                              0.0166, 0.1300, verts=12, rotation=rot_x())
                  for k, sx in enumerate((-1, 1))]
    p["lever"] = HS.apply_mods(HS.box(
        "RateLever", (-0.0800, 0.4700, BAR_TOP - 0.0620),
        (0.0180, 0.0140, 0.0900), bevel=0.0030, segments=1))

    for key, mat in (("hopper", "green"), ("crossrail", "steel"),
                     ("axle", "steel"), ("plate", "poly"), ("chute", "poly"),
                     ("bar_cross", "steel"), ("lever", "rubber")):
        p[key].data.materials.append(M[mat])
    p["interior"].data.materials.append(M["green"])
    for o in p["rails"] + p["arms"]:
        o.data.materials.append(M["steel"])
    for o in p["wheels"]:
        o.data.materials.append(M["poly"])
    for o in p["fins"]:
        o.data.materials.append(M["poly"])
    for o in p["grips"]:
        o.data.materials.append(M["rubber"])
    return p


def flat(p):
    out = []
    for v in p.values():
        if isinstance(v, list):
            out += [o for o in v if isinstance(o, bpy.types.Object)]
        elif isinstance(v, bpy.types.Object) and v.name != "HopperInterior":
            out.append(v)
    return out


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = next((x.split("=", 1)[1] for x in args if x.startswith("break=")), "")
    suffix = f"-BROKEN-{broken}" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=170 if engine == "CYCLES" else 104)
    p = build(broken=broken)

    HS.assert_rooted(p["fins"], p["plate"], "the spinner fins",
                     min_verts=3, min_depth=0.0015)
    for w in p["wheels"]:
        # The axle RUNS THROUGH the wheel, by design and by the comment above
        # it, so 21 mm inside is the intent and not an accident. Declared.
        HS.assert_touching(p["axle"], w, "a wheel must be on the axle", 0.0030,
                           max_depth=0.0240)
    HS.assert_boxes_overlap(p["hopper"], p["rails"][0],
                            "the hopper must sit on the frame")
    # As on the mower: each ceiling is the measured weld depth plus a
    # millimetre or two, not a blanket allowance.
    HS.assert_touching(p["crossrail"], p["rails"][0],
                       "the cross rail must meet the side rails", 0.0030,
                       max_depth=0.0080)
    for k, arm in enumerate(p["arms"]):
        HS.assert_touching(arm, p["rails"][k],
                           "a handlebar arm must root in the frame", 0.0035,
                           max_depth=0.0120)
    HS.assert_touching(p["bar_cross"], p["arms"][0],
                       "the crossbar must meet the arms", 0.0030,
                       max_depth=0.0120)
    for g in p["grips"]:
        HS.assert_touching(p["bar_cross"], g, "a grip must be on the crossbar", 0.0030)
    # boxes_overlap: the hopper is a thin SHELL narrowing to its opening, and
    # the chute sits inside that opening without meeting the wall -- so a
    # surface test reads the cavity as open air. They do share volume.
    HS.assert_boxes_overlap(p["chute"], p["hopper"],
                            "the chute must be under the hopper")

    vs = [v.co for v in p["interior"].data.vertices]
    z0, z1 = min(v.z for v in vs), max(v.z for v in vs)
    top = [v for v in vs if v.z > z1 - 0.004]
    print("")
    print("  === THE HOPPER, measured off the cavity mesh (YARDS) ===")
    print(f"  opening rectangle  {max(v.x for v in top) * 2:.4f} x "
          f"{max(v.y for v in top) * 2:.4f}")
    print(f"  usable depth       {z1 - z0:.4f}")
    print("")

    subject = flat(p)
    # UVs and the grain BEFORE the renders -- Generated-space noise on a
    # part that is a thin slice of a big bounding box runs its grain the
    # wrong way across the surface.
    HS.unwrap_and_grain(subject)
    print(f"TRIS {H.triangles(subject)} ({len(subject)} objects, "
          f"4 shared materials from outdoor_lib, 0 new) — the hand is 5,179")
    lo, hi = H.bounds(subject)
    print(f"  overall {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} x "
          f"{(hi.z - lo.z) * 1000:.0f} mm")

    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.16)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, f"spreader{suffix}", views=8,
                     elevation=20.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"spreader{suffix}-turntable.png"), cols=4)
    for label, az, el in (("hero", -122, 22), ("side", 180, 8),
                          ("front", -90, 12), ("spinner", -90, -34)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"spreader{suffix}-{label}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject, cam,
                         os.path.join(OUT_RENDER, f"spreader{suffix}-silhouette.png"),
                         res=(900, 900))

    if not broken:
        # Same as the mower: the root is at the origin and the geometry sat
        # 249 mm below it.
        # (The location bake that used to be here is inside bake_gltf_axis
        # now, so it happens for every builder and cannot be forgotten.)
        H.drop_to_floor(subject)
        HS.flatten_for_export(subject)
        H.bake_gltf_axis(subject)
        root = H.named_root(ROOT_NAME, subject)
        H.export_glb(subject + [root], OUT_GLB)
        print(f"FINAL TRIS {H.triangles(subject)}")
        H.verify_sockets(OUT_GLB, [ROOT_NAME])


# Guarded so the module can be IMPORTED without building. An unguarded main()
# meant every audit that imported a builder silently re-rendered and re-exported
# its asset as a side effect. Blender runs a --python script as __main__, so the
# command line is unchanged.
if __name__ == "__main__":
    main()
