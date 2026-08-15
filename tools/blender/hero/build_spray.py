"""HERO ASSET — THE SPRAY BOTTLE. Trigger, nozzle, translucent body with liquid.

A bare-hand tool: it is drawn right at the camera with no hands around it, so
the body's translucency and the liquid line are the whole read. A spray bottle
whose body is opaque is a coloured cylinder.

Hard surface: a lofted oval body, a lofted liquid volume inside it, and a head
assembly of primitives. No solving.

The liquid is the interesting assertion. It is a separate object that must be
INSIDE the bottle -- the same "small thing attached to a big thing" shape as the
bristles, and a liquid volume poking through the wall is exactly the fault that
would ship unnoticed because every number about it looks right.

    blender --factory-startup -b --python tools/blender/hero/build_spray.py -- [cycles] [break-trigger]
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
OUT_RENDER = os.path.join(REPO, "qa", "hero", "spray")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "spray_bottle.glb")

# 26, not 18. At eighteen the shoulder and the waist both showed flat facets in
# the silhouette, and a translucent body puts its own silhouette twice in every
# frame -- once as the outline and once refracted through it.
SIDES = 26
# (z, half-width X, half-depth Y). A 750 ml trigger bottle: oval section, waist,
# shoulder into a 28 mm neck.
BODY = [
    # Shorter and flatter in section. At 172 mm tall on a 44 x 30 oval it read as
    # a drinks bottle; a trigger bottle is squatter and markedly flatter front to
    # back, because it has to sit in a hand and against a shelf.
    (0.0000, 0.0455, 0.0268),
    (0.0055, 0.0492, 0.0294),
    (0.0260, 0.0505, 0.0302),
    (0.0520, 0.0486, 0.0290),
    (0.0760, 0.0492, 0.0294),
    (0.1000, 0.0500, 0.0300),
    (0.1130, 0.0470, 0.0283),
    (0.1260, 0.0362, 0.0240),
    (0.1350, 0.0246, 0.0192),
    (0.1420, 0.0158, 0.0152),
    (0.1490, 0.0150, 0.0148),
]
LIQUID_TOP = 0.0930
LIQUID_INSET = 0.0030


def loft(name, rings, close_bottom=True, close_top=True, smooth=True):
    verts, faces = [], []
    for (z, rx, ry) in rings:
        for i in range(SIDES):
            a = 2 * math.pi * i / SIDES
            verts.append(Vector((math.cos(a) * rx, math.sin(a) * ry, z)))
    for r in range(len(rings) - 1):
        for i in range(SIDES):
            j = (i + 1) % SIDES
            faces.append((r * SIDES + i, r * SIDES + j,
                          (r + 1) * SIDES + j, (r + 1) * SIDES + i))
    if close_bottom:
        faces.append(tuple(range(SIDES - 1, -1, -1)))
    if close_top:
        base = (len(rings) - 1) * SIDES
        faces.append(tuple(range(base, base + SIDES)))
    return HS.mesh_from(name, verts, faces, smooth=smooth)


def build(broken=False):
    parts = {}

    body = loft("SprayBody", BODY)
    parts["body"] = body

    # ---- the liquid: the same section inset by a wall thickness, filled to a
    # flat surface. Inset rather than scaled, so the gap to the wall is constant
    # instead of shrinking toward the base where a scale would pinch it.
    rings = []
    for (z, rx, ry) in BODY:
        if z > LIQUID_TOP:
            break
        rings.append((max(z, 0.0035), rx - LIQUID_INSET, ry - LIQUID_INSET))
    top = None
    for k in range(1, len(BODY)):
        if BODY[k][0] >= LIQUID_TOP:
            z0, rx0, ry0 = BODY[k - 1]
            z1, rx1, ry1 = BODY[k]
            t = (LIQUID_TOP - z0) / (z1 - z0)
            top = (LIQUID_TOP, rx0 + (rx1 - rx0) * t - LIQUID_INSET,
                   ry0 + (ry1 - ry0) * t - LIQUID_INSET)
            break
    rings.append(top)
    liquid = loft("SprayLiquid", rings)
    parts["liquid"] = liquid

    # ---- collar and head
    # A LOFT, not a cylinder. A plain cylinder wide enough to read as a collar
    # is wider than the neck it grips, so every one of its vertices sits outside
    # the bottle and it is attached to nothing -- the assertion measured 3.7 mm
    # of daylight around the neck. Starting the loft ON the neck section and
    # flaring it makes the joint real geometry.
    collar = loft("SprayCollar", [
        (0.1425, 0.0150, 0.0146),
        (0.1470, 0.0192, 0.0190),
        (0.1610, 0.0188, 0.0186),
    ], smooth=False)
    parts["collar"] = collar

    # A head, not a matchbox: a body block plus a lower throat that carries the
    # trigger pivot, so the two functional parts read as two parts.
    head_body = HS.box("SprayHead", (0, 0.0100, 0.1760), (0.0300, 0.0620, 0.0290),
                       bevel=0.0040, segments=2)
    throat = HS.box("SprayThroat", (0, 0.0225, 0.1605), (0.0250, 0.0300, 0.0180),
                    bevel=0.0035, segments=2)
    head = HS.join([HS.apply_mods(head_body), HS.apply_mods(throat)], "SprayHead")
    parts["head"] = head

    nozzle_base = HS.cylinder("NozzleBase", (0, 0.0420, 0.1760), 0.0112, 0.0180,
                              verts=14, rotation=Vector((0, 1, 0)).to_track_quat("Z", "Y"))
    nozzle_tip = HS.cylinder("NozzleTip", (0, 0.0512, 0.1760), 0.0070, 0.0058,
                             verts=12, rotation=Vector((0, 1, 0)).to_track_quat("Z", "Y"))
    nozzle = HS.join([nozzle_base, nozzle_tip], "SprayNozzle")
    parts["nozzle"] = nozzle

    # ---- the trigger: a lever hanging under the head, curving back toward the
    # bottle the way a finger pulls it.
    tri_verts, tri_faces = [], []
    STEPS = 7
    for s in range(STEPS):
        t = s / (STEPS - 1)
        y = 0.0300 - 0.0165 * t * t
        # Starts INSIDE the throat rather than 1 mm below it: a trigger pivot
        # that reads as a gap is a trigger that is not attached to anything.
        z = 0.1660 - 0.0350 * t
        # A moulded lever, not a strap. At 4.2 mm thick it read as a wire bail
        # hanging off the head rather than as something a finger pulls.
        half_w, thick = 0.0140 - 0.0030 * t, 0.0105 - 0.0025 * t
        if broken:
            # THE DELIBERATELY BROKEN VARIANT: the trigger drops clear of the
            # head's underside. It still looks like a trigger from most angles,
            # which is the point -- the rake's bristles looked placed too. Note
            # the axis: the first version pushed it FORWARD, along the 74 mm the
            # head is deep, so it stayed in contact and the assertion passed on
            # a variant that was not broken.
            z -= 0.0130
        for sx in (-1, 1):
            for sy in (-1, 1):
                tri_verts.append(Vector((sx * half_w, y + sy * thick * 0.5, z)))
    for s in range(STEPS - 1):
        a = s * 4
        b = a + 4
        tri_faces += [(a, a + 1, b + 1, b), (a + 2, a + 3, b + 3, b + 2),
                      (a, a + 2, b + 2, b), (a + 1, a + 3, b + 3, b + 1)]
    tri_faces.append((0, 1, 3, 2))
    last = (STEPS - 1) * 4
    tri_faces.append((last + 2, last + 3, last + 1, last))
    trigger = HS.mesh_from("SprayTrigger", tri_verts, tri_faces)
    parts["trigger"] = trigger

    # ---- dip tube, down the inside into the liquid
    dip = HS.cylinder("SprayDipTube", (0, 0.0, 0.0760), 0.0026, 0.1440, verts=8)
    parts["dip"] = dip

    # ---- materials
    # ALPHA, not transmission. See hardsurface_lib.pbr: EEVEE draws a
    # transmissive body as a dark opaque blob and the game is a raster renderer.
    plastic = HS.pbr("SprayBody", (0.760, 0.830, 0.855), roughness=0.12,
                     alpha=0.26)
    fluid = HS.pbr("SprayLiquid", (0.120, 0.400, 0.270), roughness=0.06,
                   alpha=0.72)
    trim = HS.pbr("SprayTrim", (0.075, 0.190, 0.155), roughness=0.36, coat=0.30)
    dark = HS.pbr("SprayNozzle", (0.032, 0.034, 0.036), roughness=0.30, coat=0.20)
    body.data.materials.append(plastic)
    liquid.data.materials.append(fluid)
    dip.data.materials.append(dark)
    for o in (collar, head, trigger):
        o.data.materials.append(trim)
    nozzle.data.materials.append(dark)
    return parts


def main():
    args = H.argv_after_dashes()
    # CYCLES BY DEFAULT. This asset's whole read is a translucent body with a
    # liquid line in it, and EEVEE's screen-space refraction renders that as
    # frosted grey speckle with no liquid visible at all -- so the fast engine
    # cannot answer the only question this model has to answer.
    # BOTH ENGINES when asked. The game renders closer to EEVEE than to Cycles,
    # so a translucent asset judged only in Cycles has been judged in the engine
    # that flatters it rather than the one that will draw it.
    engine = "EEVEE" if "eevee" in args else "CYCLES"
    broken = "break-trigger" in args
    suffix = "-BROKEN" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=200 if engine == "CYCLES" else 128)
    p = build(broken=broken)

    HS.assert_rooted([p["liquid"]], p["body"], "the liquid volume",
                     min_verts=12, min_depth=0.0010)
    HS.assert_rooted([p["dip"]], p["body"], "the dip tube",
                     min_verts=6, min_depth=0.0010)
    HS.assert_touching(p["trigger"], p["head"],
                       "the trigger must be attached to the head", max_gap=0.0015)
    HS.assert_touching(p["nozzle"], p["head"],
                       "the nozzle must be attached to the head", max_gap=0.0015)
    HS.assert_touching(p["collar"], p["body"],
                       "the collar must meet the bottle neck", max_gap=0.0020)

    subject = [p["body"], p["liquid"], p["collar"], p["head"], p["nozzle"],
               p["trigger"], p["dip"]]
    print(f"TRIS {H.triangles(subject)} ({len(subject)} objects, 4 materials) "
          f"— the hand is 5,179")
    lo, hi = H.bounds(subject)
    print(f"  overall {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} x "
          f"{(hi.z - lo.z) * 1000:.0f} mm, liquid to {LIQUID_TOP * 1000:.0f}")

    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.20)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, f"spray{suffix}", views=8,
                     elevation=14.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"spray{suffix}-turntable.png"), cols=4)
    # The trigger and nozzle face +Y. At -126 the hero camera looked at the BACK
    # of the bottle: no trigger, no nozzle, and a flat grey body with nothing to
    # read. Every frame I judged the first round from was the wrong side.
    for label, az, el in (("hero", 122, 18), ("side", 10, 6),
                          ("front", 90, 6), ("head", 108, 44)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"spray{suffix}-{label}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject, cam,
                         os.path.join(OUT_RENDER, f"spray{suffix}-silhouette.png"),
                         res=(900, 900))

    hfov = 2 * math.atan(math.tan(math.radians(66) / 2) * 16 / 9)
    d = (0.088 / 0.11) / (2 * math.tan(hfov / 2))
    app = H.camera_fov("Apparent", H.orbit_position(centre, d, 122, 16), centre, 66.0)
    app.data.sensor_fit = "VERTICAL"
    H.render(app, os.path.join(OUT_RENDER, f"spray{suffix}-apparent.png"), res=(1600, 900))

    if not broken:
        H.bake_gltf_axis(subject)
        H.export_glb(subject, OUT_GLB)
        print(f"FINAL TRIS {H.triangles(subject)}")


main()
