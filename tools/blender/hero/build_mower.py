"""OUTDOOR TOOL — THE GREENS MOWER. Pushed, not held, so no grip sockets.

Reel, rollers, handlebar, catcher, engine housing, on the shared outdoor
palette. What it DOES need is a NAMED ROOT: the pushed tools currently export
with their parts directly under `Scene`, the same naming gap that made Tool_rake
unfindable for two sessions. A tool the code cannot name is a tool the code
cannot place, so the root node is asserted by name in the exported file exactly
the way the held tools' sockets are.

UNITS ARE YARDS.

    blender --factory-startup -b --python tools/blender/hero/build_mower.py -- \
        [cycles] [break=blades|bar|roller]
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
OUT_RENDER = os.path.join(REPO, "qa", "hero", "mower")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "greens_mower.glb")
ROOT_NAME = "Tool_greens_mower"

CUT_W = 0.5600           # cutting width
REEL_R = 0.0560
BLADES = 6
CHASSIS_H = 0.1450
ROLL_F_R = 0.0380
ROLL_R_R = 0.0500
BAR_TOP = 0.9200


def rot_x():
    return Vector((1, 0, 0)).to_track_quat("Z", "Y")


def build(broken=""):
    p = {}
    M = OL.palette()
    hw = CUT_W * 0.5

    # ---- chassis side plates
    p["plates"] = [HS.apply_mods(HS.box(
        f"Plate_{k}", (sx * (hw + 0.0140), 0.0100, CHASSIS_H * 0.55),
        (0.0180, 0.3200, 0.1300), bevel=0.0050, segments=2))
        for k, sx in enumerate((-1, 1))]
    p["crossbeam"] = HS.apply_mods(HS.box(
        "CrossBeam", (0, 0.1000, CHASSIS_H * 0.86),
        (CUT_W + 0.0200, 0.0620, 0.0420), bevel=0.0040, segments=2))

    # ---- the cutting reel: a drum with helical blades. Same "many small things
    # on one big thing" class as the rake's tines.
    p["reel"] = HS.cylinder("ReelDrum", (0, -0.0400, REEL_R + 0.0060),
                            REEL_R * 0.46, CUT_W, verts=18, rotation=rot_x())
    # lift the blade's ROOT off the drum, not its tip. Pushing the outer edge
    # out left the inner edge still buried and the control passed.
    root_r = REEL_R * 0.30 + (0.045 if broken == "blades" else 0.0)
    blades = []
    for b in range(BLADES):
        a0 = 2 * math.pi * b / BLADES
        bv, bf = [], []
        SEG = 7
        for s in range(SEG):
            t = s / (SEG - 1)
            a = a0 + t * 0.62                      # the helix
            x = -hw + CUT_W * t
            for (rr, dz) in ((root_r, 0.0), (REEL_R, 0.0)):
                bv.append(Vector((x,
                                  -0.0400 + math.cos(a) * rr,
                                  REEL_R + 0.0060 + math.sin(a) * rr + dz)))
        for s in range(SEG - 1):
            a1, b1 = s * 2, (s + 1) * 2
            bf.append((a1, a1 + 1, b1 + 1, b1))
        blades.append(HS.apply_mods(HS.solidify(
            HS.mesh_from(f"ReelBlade_{b}", bv, bf), 0.0055)))
    p["blades"] = blades

    p["bedknife"] = HS.apply_mods(HS.box(
        "BedKnife", (0, -0.0400 - REEL_R - 0.0090, 0.0130),
        (CUT_W + 0.0360, 0.0300, 0.0110), bevel=0.0022, segments=1))

    # ---- rollers
    # 90 mm, not 45: the roller's own radius is 38 and the plate reaches down to
    # 15, so a 45 mm drop still left half the roller's vertices inside the
    # chassis. A break has to exceed the overlap it undoes.
    drop = 0.090 if broken == "roller" else 0.0
    p["roll_front"] = HS.cylinder("RollerFront", (0, -0.1420, ROLL_F_R - drop),
                                  ROLL_F_R, CUT_W + 0.0400, verts=18, rotation=rot_x())
    p["roll_rear"] = HS.cylinder("RollerRear", (0, 0.1560, ROLL_R_R),
                                 ROLL_R_R, CUT_W + 0.0400, verts=18, rotation=rot_x())

    # ---- engine housing and its details
    p["engine"] = HS.apply_mods(HS.box(
        "EngineHousing", (0, 0.0900, CHASSIS_H + 0.0510),
        (0.2600, 0.2200, 0.1600), bevel=0.0080, segments=2))
    p["shroud"] = HS.apply_mods(HS.box(
        "EngineShroud", (0, 0.0900, CHASSIS_H + 0.1350),
        (0.2200, 0.1800, 0.0260), bevel=0.0060, segments=2))
    p["exhaust"] = HS.cylinder("Exhaust", (0.1520, 0.0900, CHASSIS_H + 0.0500),
                               0.0180, 0.0700, verts=12,
                               rotation=Vector((1, 0, 0)).to_track_quat("Z", "Y"))
    p["tank"] = HS.apply_mods(HS.box(
        "FuelTank", (-0.1180, 0.1500, CHASSIS_H + 0.1190),
        (0.1000, 0.1100, 0.0700), bevel=0.0090, segments=2))

    # ---- handlebar: a U-frame back and up, with a crossbar and two grips
    lift = 0.060 if broken == "bar" else 0.0
    arms = []
    for k, sx in enumerate((-1, 1)):
        path = []
        for s in range(9):
            t = s / 8.0
            path.append(Vector((sx * (hw + 0.0140),
                                0.1200 + 0.4400 * t + lift * 0.0,
                                CHASSIS_H * 0.70 + lift + (BAR_TOP - CHASSIS_H * 0.70)
                                * (t ** 0.86))))
        arms.append(OL.sweep(f"BarArm_{k}", path, 0.0125, sides=8))
    p["arms"] = arms
    p["bar_cross"] = HS.cylinder("BarCross", (0, 0.5600, BAR_TOP),
                                 0.0125, CUT_W + 0.0280, verts=10, rotation=rot_x())
    p["grips"] = [HS.cylinder(f"BarGrip_{k}", (sx * (hw - 0.0400), 0.5600, BAR_TOP),
                              0.0160, 0.1300, verts=12, rotation=rot_x())
                  for k, sx in enumerate((-1, 1))]

    # ---- grass catcher, hung off the front
    cv, cf = [], []
    # the rear lip runs BACK INTO the side plates. At y=-0.19 and 0.94 of the
    # half width it floated 45mm clear of the chassis in front of it -- a
    # catcher that hangs on nothing.
    for (y, w, z0, z1) in ((-0.1300, 1.06, 0.0620, 0.1420),
                           (-0.2620, 0.88, 0.0980, 0.1560)):
        for (sx, sz) in ((-1, 0), (1, 0), (1, 1), (-1, 1)):
            cv.append(Vector((sx * hw * w, y, z0 if sz == 0 else z1)))
    for k in range(4):
        q = (k + 1) % 4
        cf.append((k, q, q + 4, k + 4))
    cf.append((3, 2, 1, 0))
    cf.append((4, 5, 6, 7))
    p["catcher"] = HS.apply_mods(HS.solidify(
        HS.mesh_from("GrassCatcher", cv, cf), 0.0060))

    for key, mat in (("crossbeam", "green"), ("reel", "steel"),
                     ("bedknife", "steel"), ("roll_front", "poly"),
                     ("roll_rear", "poly"), ("engine", "green"),
                     ("shroud", "poly"), ("exhaust", "steel"),
                     ("tank", "poly"), ("bar_cross", "steel"),
                     ("catcher", "green")):
        p[key].data.materials.append(M[mat])
    for o in p["plates"]:
        o.data.materials.append(M["green"])
    for o in p["blades"]:
        o.data.materials.append(M["steel"])
    for o in p["arms"]:
        o.data.materials.append(M["steel"])
    for o in p["grips"]:
        o.data.materials.append(M["rubber"])
    return p


def flat(p):
    out = []
    for v in p.values():
        if isinstance(v, list):
            out += [o for o in v if isinstance(o, bpy.types.Object)]
        elif isinstance(v, bpy.types.Object):
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

    HS.assert_rooted(p["blades"], p["reel"], "the reel blades",
                     min_verts=3, min_depth=0.0020)
    HS.assert_touching(p["bedknife"], p["plates"][0],
                       "the bed knife must be in the chassis", 0.0030)
    HS.assert_touching(p["roll_front"], p["plates"][0],
                       "the front roller must be in the chassis", 0.0030)
    HS.assert_touching(p["roll_rear"], p["plates"][0],
                       "the rear roller must be in the chassis", 0.0030)
    for arm in p["arms"]:
        # A 25 mm handlebar arm bolted to an 18 mm side plate passes through
        # it, so 9.00 mm -- the plate's own half-thickness -- is the deepest
        # this pair can possibly read. It is not "driven through and out the
        # far side"; it is the maximum, and it is declared rather than left to
        # trip the 6 mm default.
        HS.assert_touching(arm, p["plates"][0] if arm.name.endswith("0")
                           else p["plates"][1],
                           "a handlebar arm is bolted through its side plate",
                           0.0035, max_depth=0.0100)
    # A WELDED TUBE SITS TO ITS HOST'S RADIUS: the crossbar's end reaches the
    # centre of a 25 mm arm, measured at 10.70 mm. Every ceiling here is the
    # measured depth plus a millimetre or two, so the check still bites if a
    # join moves; a blanket allowance would not.
    HS.assert_touching(p["bar_cross"], p["arms"][0],
                       "the crossbar must meet the arms", 0.0030,
                       max_depth=0.0120)
    # crossbar-INTO-grip: a grip is a sleeve AROUND the bar, so it is wider than
    # its host and none of its vertices land inside. Fifth part on this project.
    for g in p["grips"]:
        HS.assert_touching(p["bar_cross"], g, "a grip must be on the crossbar", 0.0030)
    # boxes_overlap: the engine and the crossbeam genuinely share volume, but
    # the engine's eight corners are all far from a thin bar under the middle of
    # its footprint, so a vertex test measures corner-to-corner distance and
    # calls a seated engine detached by 61mm.
    HS.assert_boxes_overlap(p["engine"], p["crossbeam"],
                            "the engine must sit on the chassis")
    HS.assert_touching(p["catcher"], p["plates"][0],
                       "the catcher must hang on the chassis", 0.0060,
                       max_depth=0.0095)

    subject = flat(p)
    print(f"TRIS {H.triangles(subject)} ({len(subject)} objects, "
          f"5 shared materials from outdoor_lib, 0 new) — the hand is 5,179")
    lo, hi = H.bounds(subject)
    print(f"  overall {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} x "
          f"{(hi.z - lo.z) * 1000:.0f} mm   (cut width {CUT_W * 1000:.0f})")

    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.16)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, f"mower{suffix}", views=8,
                     elevation=20.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"mower{suffix}-turntable.png"), cols=4)
    for label, az, el in (("hero", -122, 22), ("side", 180, 8),
                          ("front", -90, 12), ("reel", -90, -22)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"mower{suffix}-{label}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject, cam,
                         os.path.join(OUT_RENDER, f"mower{suffix}-silhouette.png"),
                         res=(900, 900))

    if not broken:
        # Wheeled equipment standing on the ground. The named root marks the
        # ORIGIN, not the base -- it is at (0,0,0) while the geometry reached
        # 179 mm below it -- so the root alone does not put the wheels on the
        # grass.
        # Bake the object locations first: bake_gltf_axis permutes VERTICES
        # and leaves each object's own location in the old convention, so any
        # part with a transform lands in the wrong place. Proven on the rake,
        # which shipped 1,750 mm tall against a 970 mm scene. Meshes only --
        # an EMPTY's location is the whole point of it.
        bpy.ops.object.select_all(action="DESELECT")
        for o in subject:
            o.select_set(True)
        bpy.context.view_layer.objects.active = subject[0]
        bpy.ops.object.transform_apply(location=True, rotation=False,
                                       scale=False)
        H.drop_to_floor(subject)
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
