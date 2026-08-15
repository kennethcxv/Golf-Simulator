"""HERO ASSET — THE PRESSURE WASHER WAND. A belt tool, lowest frequency of the set.

A trigger gun, a lance, a nozzle head, a union collar and a hose fitting. Six
small things hung on one big thing, which is the class of join that has failed
twice on this project (the rake's bristles, the register's drawer face). So each
join has an assertion, and each assertion is watched failing on a variant that
breaks exactly that join and nothing else.

UNITS ARE YARDS.

    blender --factory-startup -b --python tools/blender/hero/build_wand.py -- \
        [cycles] [break=nozzle|trigger|collar]
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
OUT_RENDER = os.path.join(REPO, "qa", "hero", "wand")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "pressure_wand.glb")

LANCE_LEN = 0.5400
LANCE_R = 0.0098
GRIP_ANGLE = 62.0
BODY_C = Vector((0, 0.0180, 0))
BODY_S = Vector((0.0420, 0.1300, 0.0520))
GRIP_ROOT = Vector((0, -0.0180, -0.0180))


def sweep(name, path, radius, sides=5, cap=True):
    """A tube along a path, cross-section held PERPENDICULAR to the tangent.

    Written out rather than reached for because the first version kept the ring
    in the XY plane, and where the path turned into Y the ring went edge-on and
    the tube pinched shut. A swept section has to follow the sweep.
    """
    verts, faces = [], []
    n = len(path)
    for i, p in enumerate(path):
        nxt = path[min(i + 1, n - 1)]
        prv = path[max(i - 1, 0)]
        t = (nxt - prv).normalized()
        u = Vector((1, 0, 0))
        v = t.cross(u).normalized()
        for k in range(sides):
            a = 2 * math.pi * k / sides
            verts.append(p + u * (math.cos(a) * radius) + v * (math.sin(a) * radius))
    for i in range(n - 1):
        for k in range(sides):
            q = (k + 1) % sides
            faces.append((i * sides + k, i * sides + q,
                          (i + 1) * sides + q, (i + 1) * sides + k))
    if cap:
        faces.append(tuple(range(sides - 1, -1, -1)))
        faces.append(tuple(range((n - 1) * sides, n * sides)))
    return HS.mesh_from(name, verts, faces, smooth=True)


def smooth_barrel(obj):
    """Smooth the round walls of a cylinder-built part but leave its end caps
    flat. Every cylinder here is built along its own local Z, so the caps are
    the faces whose normal points along it -- shading those smooth is what
    gives a tube the black-underside/white-top split instead of a highlight."""
    for poly in obj.data.polygons:
        poly.use_smooth = abs(poly.normal.normalized().z) < 0.7
    return obj


def tapered_box(name, y0, y1, s0, s1, bevel=0.0):
    """A box that narrows toward the muzzle. The first body was a perfect
    rectangular slab and read as a brick; a trigger gun tapers forward."""
    verts = []
    for (y, s) in ((y0, s0), (y1, s1)):
        for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append(Vector((sx * s[0], y, sz * s[1])))
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = HS.mesh_from(name, verts, faces)
    if bevel > 0:
        m = ob.modifiers.new("Bevel", "BEVEL")
        m.width, m.segments = bevel, 2
        m.limit_method, m.angle_limit = "ANGLE", math.radians(40)
        ob = HS.apply_mods(ob)
    return ob


BODY_Y = (-0.0470, 0.0830)
BODY_REAR = (0.0210, 0.0260)
BODY_NOSE = (0.0165, 0.0190)


def build(broken=""):
    p = {}
    rot_y = Vector((0, 1, 0)).to_track_quat("Z", "Y")
    a = math.radians(GRIP_ANGLE)
    axis = Vector((0, -math.sin(a), -math.cos(a)))
    rot_g = axis.to_track_quat("Z", "Y")

    # ---- the gun body: the one big thing everything else hangs on
    p["body"] = tapered_box("GunBody", BODY_Y[0], BODY_Y[1],
                            BODY_REAR, BODY_NOSE, bevel=0.0060)

    # ---- pistol grip. Squashed in X afterwards because a round section reads
    # as a broom handle -- a grip is oval, deeper than it is wide, and that one
    # scale does more for "a hand goes here" than any amount of added geometry.
    grip = HS.join([
        HS.cylinder("GripA", GRIP_ROOT + axis * 0.040, 0.0172, 0.0800,
                    verts=14, rotation=rot_g),
        HS.cylinder("GripSwell", GRIP_ROOT + axis * 0.046, 0.0196, 0.0300,
                    verts=14, rotation=rot_g),
        HS.cylinder("GripButt", GRIP_ROOT + axis * 0.083, 0.0184, 0.0130,
                    verts=14, rotation=rot_g),
    ], "GunGrip")
    grip.scale.x = 0.78
    bpy.context.view_layer.objects.active = grip
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    p["grip"] = grip

    # ---- trigger: a blade hung FORWARD of the grip, into the middle of the
    # guard. The first version swept backwards and sat against the grip, where
    # it disappeared -- an empty guard hoop with nothing in it.
    tv, tf = [], []
    STEPS = 7
    drop = 0.0180 if broken == "trigger" else 0.0
    for s in range(STEPS):
        t = s / (STEPS - 1)
        y = 0.0215 - 0.0440 * t + 0.0320 * t * t   # sweeps back, then curls forward
        z = -0.0140 - 0.0360 * t - drop
        w = 0.0092 - 0.0016 * t
        for sx in (-1, 1):
            for sy in (-1, 1):
                tv.append(Vector((sx * w, y + sy * 0.0042, z)))
    for s in range(STEPS - 1):
        a0, b0 = s * 4, s * 4 + 4
        tf += [(a0, a0 + 1, b0 + 1, b0), (a0 + 2, a0 + 3, b0 + 3, b0 + 2),
               (a0, a0 + 2, b0 + 2, b0), (a0 + 1, a0 + 3, b0 + 3, b0 + 1)]
    tf.append((0, 1, 3, 2))
    last = (STEPS - 1) * 4
    tf.append((last + 2, last + 3, last + 1, last))
    p["trigger"] = HS.mesh_from("GunTrigger", tv, tf)

    # ---- trigger guard: an arc rooted in the body at BOTH ends
    GS = 13
    guard_path = []
    for s in range(GS):
        ang = math.pi * (s / (GS - 1))
        guard_path.append(Vector((0, 0.009 + 0.039 * math.cos(ang),
                                  -0.016 - 0.050 * math.sin(ang))))
    p["guard"] = sweep("TriggerGuard", guard_path, 0.0066, sides=6)

    # ---- the clamshell seam. The body was a featureless brick; two moulded
    # halves meeting at a dark line is a material break on a REAL part
    # boundary, and it costs no new material because the rubber is already here.
    # Kept INSIDE the body's ends: the first version overhung them, and because
    # the body is bevelled the overhang showed as a flat fin sticking out past
    # the nose rather than as a parting line.
    p["seam"] = tapered_box("ShellSeam", BODY_Y[0] + 0.0060, BODY_Y[1] - 0.0060,
                            (BODY_REAR[0] + 0.0006, 0.0016),
                            (BODY_NOSE[0] + 0.0010, 0.0016))

    # ---- the lance, the collar that clamps it, the nozzle head
    p["lance"] = HS.cylinder("Lance", (0, 0.0600 + LANCE_LEN * 0.5, 0),
                             LANCE_R, LANCE_LEN, verts=16, rotation=rot_y)
    collar_y = 0.0900 + (0.030 if broken == "collar" else 0.0)
    p["collar"] = HS.cylinder("LanceCollar", (0, collar_y, 0), 0.0138, 0.0220,
                              verts=12, rotation=rot_y)
    nose_y = 0.0600 + LANCE_LEN + (0.030 if broken == "nozzle" else 0.0)
    p["nozzle"] = HS.join([
        HS.cylinder("NozA", (0, nose_y - 0.0110, 0), 0.0148, 0.0260,
                    verts=16, rotation=rot_y),
        HS.cylinder("NozB", (0, nose_y + 0.0070, 0), 0.0104, 0.0160,
                    verts=14, rotation=rot_y),
    ], "NozzleHead")

    # ---- hose fitting in the butt of the grip. Short and HEXAGONAL: the long
    # stepped version read as a second barrel firing out of the handle.
    # The flange is WIDER than the grip, so none of its vertices land inside and
    # the surface test correctly called it detached. A real fitting has a SHANK
    # up inside the butt -- model the shank and the instrument measures the join
    # instead of being loosened to accept it.
    # 60 mm, not 30: the shank is 30 mm long and buried, so a 30 mm shove left
    # it still overlapping and the "broken" variant passed. A break has to
    # exceed the overlap it is meant to undo, or the control proves nothing.
    fit_d = 0.060 if broken == "fitting" else 0.0
    p["fitting"] = HS.join([
        HS.cylinder("FitShank", GRIP_ROOT + axis * (0.070 + fit_d), 0.0110, 0.0300,
                    verts=10, rotation=rot_g),
        HS.cylinder("FitNut", GRIP_ROOT + axis * (0.088 + fit_d), 0.0216, 0.0140,
                    verts=6, rotation=rot_g),
        HS.cylinder("FitStub", GRIP_ROOT + axis * (0.100 + fit_d), 0.0088, 0.0130,
                    verts=10, rotation=rot_g),
    ], "HoseFitting")

    # Three materials on real part boundaries: the moulded shell, the plumbing,
    # the rubber you actually hold. The steel is the specular event.
    shell = HS.pbr("WandShell", (0.021, 0.049, 0.088), roughness=0.42)
    steel = HS.pbr("WandSteel", (0.158, 0.163, 0.172), roughness=0.27, metallic=0.9)
    rubber = HS.pbr("WandRubber", (0.014, 0.015, 0.017), roughness=0.84)
    for key, mat in (("body", shell), ("guard", shell), ("grip", rubber),
                     ("trigger", rubber), ("seam", rubber), ("lance", steel),
                     ("collar", steel), ("nozzle", steel), ("fitting", steel)):
        p[key].data.materials.append(mat)
    p["materials"] = [shell, steel, rubber]
    for key in ("lance", "collar", "nozzle", "grip", "fitting"):
        smooth_barrel(p[key])
    return p


ORDER = ["body", "seam", "grip", "trigger", "guard", "lance", "collar",
         "nozzle", "fitting"]


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = next((x.split("=", 1)[1] for x in args if x.startswith("break=")), "")
    suffix = f"-BROKEN-{broken}" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=170 if engine == "CYCLES" else 104)
    p = build(broken=broken)

    HS.assert_touching(p["lance"], p["body"], "the lance must root in the gun", 0.0025)
    HS.assert_touching(p["collar"], p["body"], "the collar must sit on the muzzle", 0.0025)
    HS.assert_touching(p["nozzle"], p["lance"], "the nozzle must be on the lance", 0.0025)
    HS.assert_touching(p["trigger"], p["body"], "the trigger must hang off the body", 0.0030)
    HS.assert_touching(p["guard"], p["body"], "the guard must root in the body", 0.0035)
    HS.assert_touching(p["grip"], p["body"], "the grip must meet the body", 0.0030)
    HS.assert_touching(p["fitting"], p["grip"], "the hose fitting must be in the butt", 0.0030)
    HS.assert_no_overlap(p["trigger"], p["guard"], "the trigger must swing inside its guard",
                         min_gap=0.0008)

    subject = [p[k] for k in ORDER]
    print(f"TRIS {H.triangles(subject)} ({len(subject)} objects, "
          f"{len(p['materials'])} materials) — the hand is 5,179")
    lo, hi = H.bounds(subject)
    print(f"  overall {hi.x - lo.x:.4f} x {hi.y - lo.y:.4f} x {hi.z - lo.z:.4f} yd "
          f"(lance {LANCE_LEN:.3f})")
    glo, ghi = H.bounds([p["grip"]])
    print(f"  grip {ghi.z - glo.z:.4f} tall, {(ghi.x - glo.x):.4f} across — a hand is ~0.10")

    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.16)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, f"wand{suffix}", views=8,
                     elevation=20.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"wand{suffix}-turntable.png"), cols=4)

    gc, gr = H.subject_sphere([p["body"], p["grip"], p["trigger"], p["guard"], p["collar"]])
    gd = H.fit_distance(gr, LENS, res=(1100, 1100), margin=1.20)
    for label, az, el, c, d in (("hero", -122, 24, centre, dist),
                                ("side", 180, 6, centre, dist),
                                ("gun", -120, 16, gc, gd),
                                ("trigger", -35, -12, gc, gd)):
        cam = H.camera(label, H.orbit_position(c, d, az, el), c, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"wand{suffix}-{label}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject, cam,
                         os.path.join(OUT_RENDER, f"wand{suffix}-silhouette.png"), res=(900, 900))

    if not broken and engine == "CYCLES":
        H.bake_gltf_axis(subject)
        H.export_glb(subject, OUT_GLB)
        print(f"FINAL TRIS {H.triangles(subject)}")


main()
