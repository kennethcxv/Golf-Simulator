"""GOAL 27 — THE MOP HEAD, REBUILT FROM NOTHING. Attempt eleven, and the last.

Ten attempts failed. Nine were parameter passes on a Verlet strand rig and one
was a Blender round, and the review of the shipped state still read: the strand
ring is detached from the red hub and offset sideways, the head is hollow
through the middle, and the shaft passes out through the hub's top.

It was also NEVER TURNTABLED -- it went through bisection, not the hero
pipeline, so the frame set those faults would have been caught in has never
existed. That is fixed here first.

THE APPROACH IS DIFFERENT ON PURPOSE. No solver. The head is modelled geometry
the way the broom's bristles are, because the broom is the one tool in this
project that reads correctly and it is not a solver.

Reference: Designs/ProShop/Images/Goal_26/MopRefrenceImage.png -- a spin mop:

  a dense white microfibre DISC, about twice as wide as it is deep
  a red hub, a rounded triangle, CLAMPING the yarn from above
  the shaft socketed into the hub at an angle, STOPPING inside it
  yarn that FILLS the disc rather than outlining it

Four properties, four assertions, each measuring the exact fault that shipped:

  every tuft is ROOTED in the hub            -- no daylight, no detached ring
  the shaft's top is BELOW the hub's top     -- it does not pass through
  the disc has NO HOLLOW MIDDLE              -- measured by ray, not by eye
  the hub is CONCENTRIC with the disc        -- no sideways offset

UNITS ARE YARDS.

    blender --factory-startup -b --python tools/blender/hero/build_mop.py -- \\
        [cycles] [break=detach|hollow|offset|through]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402
import cloth_lib as CL  # noqa: E402

REPO = os.getcwd()
OUT_RENDER = os.path.join(REPO, "qa", "hero", "mop")
GLB_DIR = os.path.join(REPO, "Assets", "models", "hero")

# A spin-mop head: 186 mm across the yarn, 84 mm deep overall, hub 98 mm.
DISC_R = 0.0930
HEAD_H = 0.0840
HUB_R = 0.0490
HUB_H = 0.0230
SHAFT_R = 0.0092
SHAFT_TILT = 34.0          # degrees off vertical, as the reference


def hub(name, centre, broken=""):
    """The red hub: a rounded triangle plate with a raised rim and a boss.

    A triangle, not a disc, because that is what the reference has and it is
    the only part of the head with a recognisable shape -- the yarn below it is
    the same from every angle.
    """
    cx, cy, cz = centre
    rings = []
    LAYERS = 12
    for k in range(LAYERS + 1):
        t = k / LAYERS
        # a squat dome: full radius at the base, tucking in at the top
        r = HUB_R * (1.0 - 0.30 * t * t)
        z = cz + HUB_H * t
        ring = []
        SEG = 66
        for i in range(SEG):
            a = 2 * math.pi * i / SEG
            # rounded triangle: a three-lobed radius
            lobe = 1.0 + 0.150 * math.cos(3.0 * a)
            # the raised rim, a ridge just inside the edge
            rim = 1.0 + 0.055 * math.exp(-((t - 0.42) / 0.13) ** 2)
            rr = r * lobe * rim
            ring.append(Vector((cx + math.cos(a) * rr,
                                cy + math.sin(a) * rr, z)))
        rings.append(ring)
    return CL.loft(name, rings, close_bottom=True, close_top=True, smooth=True)


def socket(name, centre, tilt):
    """The collar the shaft enters. Angled, like the reference."""
    d = Vector((0.0, -math.sin(math.radians(tilt)), math.cos(math.radians(tilt))))
    a = Vector(centre)
    return CL._sweep(name, [a, a + d * 0.0420], 0.0132, sides=12)


def yarn(hub_obj, broken="", rings=(0.04, 0.11, 0.19, 0.30, 0.44, 0.57,
                                   0.69, 0.80, 0.90, 0.97, 1.02),
         per_ring=(5, 9, 14, 18, 24, 30, 36, 42, 46, 48, 46)):
    """The microfibre: tufts rooted UNDER the hub, radiating out and down.

    THE INNER RINGS ARE THE POINT. Every previous attempt put strands on the
    RIM only, which is why the head was hollow through the middle and why you
    could see the floor through a mop. The disc is filled from 20% of the
    radius outwards.
    """
    tufts = []
    for ri, (frac, n) in enumerate(zip(rings, per_ring)):
        if broken == "hollow" and frac < 0.7:
            continue          # THE BROKEN VARIANT: rim strands only
        # EVERY TUFT IS CLAMPED IN THE MIDDLE and fans out from there, which is
        # both what a spin mop does and what lets the hub actually grip them.
        # Rooting each ring under its own radius put the outer rings at the
        # hub's edge, where only one or two vertices were inside it -- 53 of 117
        # tufts failed assert_rooted on the first build.
        root_r = HUB_R * (0.24 + 0.30 * frac)
        tip_r = DISC_R * frac
        drop = HEAD_H * (0.96 - 0.30 * frac)
        for i in range(n):
            a = 2 * math.pi * (i + 0.5 * (ri % 2)) / n + ri * 0.21
            root = Vector((math.cos(a) * root_r, math.sin(a) * root_r,
                           HUB_H * 0.30))
            if broken == "detach":
                # THE BROKEN VARIANT: the whole ring dropped clear of the hub,
                # which is the fault that shipped ten times. It still looks
                # like a mop from directly above.
                root.z -= 0.030
            # Length and lie vary per strand. Every tuft the same length made a
            # combed fan that read as a dish brush; real microfibre is a mass of
            # loops at slightly different lengths, and the variation is most of
            # what makes it read as yarn rather than as slats.
            jitter = 0.86 + 0.28 * ((i * 7 + ri * 13) % 11) / 10.0
            swirl = 0.16 * math.sin(i * 1.7 + ri)
            run = (tip_r - root_r) * jitter
            tang = Vector((-math.sin(a), math.cos(a), 0.0)) * run * swirl
            dirv = (Vector((math.cos(a) * run, math.sin(a) * run,
                            -drop * jitter)) + tang).normalized()
            length = math.hypot(run, drop * jitter)
            tufts.append(HS.prism(f"Yarn_{ri}_{i}", root, dirv, length,
                                  0.0034 + 0.0012 * (1 - frac), 0.0020,
                                  sides=4, twist=0.9 + 0.35 * ri))
    return tufts


def assert_shaft_stops_inside(shaft, hub_obj, label):
    """The reported fault, measured directly: the shaft's TIP must be buried in
    the hub and must not come out of its underside.

    The first version of this check compared the shaft's highest point with the
    hub's and failed at 204 mm -- of course it did: the handle runs up and away,
    that is what a handle is. The property is about the LOWER END. A check has
    to measure the thing that was wrong, not a thing that happens to be nearby.
    """
    verts = [shaft.matrix_world @ v.co for v in shaft.data.vertices]
    tip = min(verts, key=lambda v: v.z)
    hlo, hhi = H.bounds([hub_obj])
    if not HS.point_inside(hub_obj, tip):
        raise SystemExit(
            f"BUILD FAILED: {label} -- the shaft's lower end at z={tip.z:+.4f} "
            f"is NOT inside the hub. It is not socketed into anything.")
    if tip.z < hlo.z:
        raise SystemExit(
            f"BUILD FAILED: {label} -- the shaft protrudes "
            f"{(hlo.z - tip.z) * 1000:.2f} mm below the hub's underside; it "
            f"passes through the hub, which is the fault that shipped ten times.")
    print(f"  shaft assertion passed: the tip is buried in the hub, "
          f"{(tip.z - hlo.z) * 1000:.1f} mm above its underside ({label})")


def assert_no_hollow_middle(tufts, label, samples=24, r_frac=0.34):
    """Fire rays straight down through the middle of the disc. Every one must
    hit yarn.

    "No hollow middle" was checked by looking at a render, from the one angle
    where the hub hides the hole. A ray cannot be fooled by the hub."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    misses = []
    for i in range(samples):
        a = 2 * math.pi * i / samples
        r = DISC_R * r_frac * (0.35 + 0.65 * ((i % 4) / 3.0))
        origin = Vector((math.cos(a) * r, math.sin(a) * r, -HEAD_H * 1.4))
        hit = False
        for t in tufts:
            ok, _loc, _n, _i = t.ray_cast(
                t.matrix_world.inverted() @ origin,
                t.matrix_world.inverted().to_3x3() @ Vector((0, 0, 1)))
            if ok:
                hit = True
                break
        if not hit:
            misses.append((round(math.degrees(a)), round(r * 1000, 1)))
    if misses:
        raise SystemExit(
            f"BUILD FAILED: {label} -- {len(misses)} of {samples} rays fired up "
            f"through the middle of the disc hit no yarn: the head is hollow. "
            f"Misses at (degrees, mm from centre): {misses[:8]}")
    print(f"  fill assertion passed: all {samples} rays through the inner "
          f"{r_frac * 100:.0f}% of the disc hit yarn ({label})")


def assert_concentric(hub_obj, tufts, label, tol=0.0040):
    """The hub must sit over the middle of the yarn, not off to one side.

    Measured on VERTEX CENTROIDS, not bounding-box centres. The hub is a
    three-lobed triangle and a triangle's bounding box is not centred on its
    centroid, so the box-centre version reported a 6.85 mm offset on a hub that
    is exactly concentric -- the instrument was wrong, not the model.
    """
    def centroid(objs):
        pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
        return Vector((sum(p.x for p in pts) / len(pts),
                       sum(p.y for p in pts) / len(pts), 0.0))

    off = (centroid([hub_obj]) - centroid(tufts)).length
    if off > tol:
        raise SystemExit(
            f"BUILD FAILED: {label} -- the hub's centroid is {off * 1000:.2f} mm "
            f"from the yarn disc's centroid, over the {tol * 1000:.1f} mm "
            f"tolerance. This is the sideways offset the shipped mop had.")
    print(f"  concentric assertion passed: hub centroid within "
          f"{off * 1000:.2f} mm of the disc centroid ({label})")


def build(broken=""):
    p = {}
    p["hub"] = hub("MopHub", (0, 0, 0), broken=broken)
    p["socket"] = socket("MopSocket", (0, 0.0060, HUB_H * 0.55), SHAFT_TILT)
    tilt = math.radians(SHAFT_TILT)
    d = Vector((0.0, -math.sin(tilt), math.cos(tilt)))
    # the shaft STOPS INSIDE the hub: its lower end is below the hub's top and
    # its upper end runs away up the handle
    base = Vector((0, 0.0060, HUB_H * 0.30))
    if broken == "through":
        base = base - d * 0.045      # THE BROKEN VARIANT: driven out the top
    p["shaft"] = CL._sweep("MopShaft", [base, base + d * 0.2600], SHAFT_R,
                           sides=12)
    offs = Vector((0.030, 0, 0)) if broken == "offset" else Vector((0, 0, 0))
    p["hub"].location = offs
    p["socket"].location = offs
    p["shaft"].location = offs
    p["tufts"] = yarn(p["hub"], broken=broken)
    return p


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = next((x.split("=", 1)[1] for x in args if x.startswith("break=")), "")
    suffix = f"-BROKEN-{broken}" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=180 if engine == "CYCLES" else 96)
    p = build(broken=broken)

    red = HS.pbr("MopHubRed", (0.520, 0.055, 0.045), roughness=0.34)
    fibre = HS.pbr("MopYarn", (0.905, 0.900, 0.876), roughness=0.94)
    steel = HS.pbr("MopShaft", (0.400, 0.410, 0.420), roughness=0.36,
                   metallic=0.7)
    p["hub"].data.materials.append(red)
    p["socket"].data.materials.append(red)
    p["shaft"].data.materials.append(steel)
    for t in p["tufts"]:
        t.data.materials.append(fibre)

    hard = {"hub": p["hub"], "socket": p["socket"], "shaft": p["shaft"]}
    if not broken:
        HS.assert_all_one_piece(hard, "mop: hub, socket and shaft")
        # the shaft is DELIBERATELY deep in its socket -- that is what a socket
        # is, and it is named rather than defaulted
        HS.assert_assembly(hard, "mop: the hard parts",
                           allow=[("shaft", "socket"), ("socket", "hub"),
                                  ("shaft", "hub")], max_depth=0.0420)
        HS.assert_rooted(p["tufts"], p["hub"], "yarn tufts", min_verts=3,
                         min_depth=0.0012)
        assert_shaft_stops_inside(p["shaft"], p["hub"], "the shaft must stop in the hub")
        assert_no_hollow_middle(p["tufts"], "the disc must be filled")
        assert_concentric(p["hub"], p["tufts"], "the hub must sit over the disc")

    # THE ASSERTIONS RUN ON THE SEPARATE TUFTS -- assert_rooted has to see each
    # one individually -- and only then are they joined. 318 loose objects is
    # 318 draw calls, which would be a worse fault than the one being fixed.
    tuft_count = len(p["tufts"])
    tuft_tris = H.triangles(p["tufts"])
    p["yarn"] = HS.join(p["tufts"], "MopYarn")
    subject = [p["hub"], p["socket"], p["shaft"], p["yarn"]]
    lo, hi = H.bounds(subject)
    print(f"mop: TRIS {H.triangles(subject)} in {len(subject)} objects "
          f"(the {tuft_count} tufts joined into one, {tuft_tris} tris), "
          f"3 materials")
    print(f"  head {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} mm "
          f"across, disc {HEAD_H * 1000:.0f} mm deep — "
          f"{(hi.x - lo.x) / HEAD_H:.2f}x as wide as deep")

    head = [p["hub"], p["socket"], p["yarn"]]
    centre, radius = H.subject_sphere(head)
    LENS = 76.0
    dist = H.fit_distance(radius, LENS, res=(1000, 1000), margin=1.24)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)
    tt = H.turntable(centre, dist, OUT_RENDER, f"mop{suffix}", views=8,
                     elevation=16.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"mop{suffix}-turntable.png"))
    for label, az, el in (("hero", -122, 22), ("side", -90, 4),
                          ("above", -90, 74), ("under", -90, -34)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre,
                       lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"mop{suffix}-{label}.png"),
                 res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject, cam,
                         os.path.join(OUT_RENDER, f"mop{suffix}-silhouette.png"),
                         res=(900, 900))
    if not broken:
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(GLB_DIR, "mop_head.glb"))


if __name__ == "__main__":
    main()
