"""club-iron -- a cavity-back 7-iron with grooves that are cut.

WHAT WAS THERE: `build_iron_set` makes three clubs out of a four-point panel
extruded 28 mm, rotated four degrees, on a cylinder. No topline, no sole, no
cavity, no grooves.

THE BRIEF IS SPECIFIC: "the grooves are geometry, not a bump map -- they read
at shelf distance and they are what says iron." So they are cut here, with two
walls and a flat floor, using explicit mesh rows at the groove edges rather
than a fine uniform grid that would round them anyway. Twelve grooves at 3.6 mm
pitch, 0.9 mm wide, 0.5 mm deep, which is close to the conforming maximum.

THE CONSTRUCTION of a cavity back, front to back:

  * the FACE -- flat, lofted 34 degrees, grooved, milled;
  * the RIM -- topline, toe, sole and heel, the band of solid metal that runs
    round the outside and is the only part of the club that touches the ball's
    turf;
  * the CAVITY -- the back scooped out between the rim, which is the whole
    point of a cavity back and the single feature that separates it from a
    blade at a glance;
  * the HOSEL, rising out of the heel into a steel shaft.

The sole is a real sole: 22 mm wide, cambered front to back, and it is what the
club sits on.

Run: blender --factory-startup -b --python iron.py -- render export
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import hero_lib as H  # noqa: E402
import studio as ST  # noqa: E402
import hard as HD  # noqa: E402

NAME = "club-iron"
EV = -0.30

LOFT = math.radians(34.0)      # a 7-iron
LIE = math.radians(62.5)
DEPTH = 0.019                  # face to back of the rim

STEEL = (0.615, 0.618, 0.625)
FACEM = (0.500, 0.503, 0.508)


def blade_outline(n=200):
    """The face outline of an iron, in (x, z), heel at -x.

    A straight TOPLINE, a toe that rises and rounds over, a sole that is nearly
    straight with a little bounce, and a heel that goes up vertically into the
    hosel. Those four are the whole silhouette and three of them are straight,
    which is why an iron looks manufactured and a blob does not.
    """
    # CORNERS GET ROUNDED, STRAIGHTS DO NOT. Chaikin cuts every corner by the
    # same fraction, so thirteen evenly spread landmarks came back as a
    # rounded rectangle -- an iron read as a mallet putter, which is the
    # brief's "every edge rounded to the same radius" arriving by a different
    # route. Putting DENSE COLLINEAR points along the topline and the sole
    # leaves Chaikin nothing to cut there: a corner cut between two points
    # 2 mm apart moves the outline half a millimetre. The toe, which really is
    # a curve, keeps its sparse landmarks and rounds.
    top_z, sole_z = 0.0535, 0.0016
    pts = [(-0.0375, 0.007), (-0.0385, 0.018), (-0.0385, 0.0345),
           (-0.0382, 0.0455)]                                   # heel, upright
    pts += [(-0.036 + 0.0022 * i, top_z - 0.00004 * i)
            for i in range(1, 32)]                              # TOPLINE
    pts += [(0.0345, 0.0505), (0.0408, 0.0435),
            (0.0432, 0.0330), (0.0436, 0.0225),
            (0.0405, 0.0110)]                                   # toe, a curve
    pts += [(0.0330 - 0.0023 * i, sole_z + 0.00003 * i)
            for i in range(0, 27)]                              # SOLE
    # 3-D from the start: a 2-D Vector has no .z, and mathutils says so with
    # "unavailable on 2d vector" rather than by silently reading .y
    xz = [(x, 0.0, z) for x, z in pts]
    return HD.resample(HD.chaikin(xz, rounds=2, closed=True), n, closed=True)


def inset(outline, d):
    """Shrink a closed outline toward its centroid by roughly `d`."""
    c = Vector((sum(p.x for p in outline) / len(outline), 0.0,
                sum(p.z for p in outline) / len(outline)))
    out = []
    for p in outline:
        v = Vector((p.x - c.x, 0.0, p.z - c.z))
        L = v.length
        out.append(Vector((c.x + v.x * max(0.0, L - d) / L, p.y,
                           c.z + v.z * max(0.0, L - d) / L)))
    return out


def build():
    n = Vector((0.0, -math.cos(LOFT), math.sin(LOFT)))     # face normal
    rim2 = blade_outline()
    # lift the outline into 3-D on the lofted face plane, with the whole blade
    # leaning back at the loft about its own mid height
    ZM = 0.028
    face_rim = [Vector((p.x, (p.z - ZM) * math.tan(LOFT), p.z)) for p in rim2]

    # THE GROOVES. Explicit rows at every groove edge; the relief function is
    # flat inside a channel and zero outside.
    z0 = min(p.z for p in face_rim)
    z1 = max(p.z for p in face_rim)
    vs, rel = HD.groove_rows(12, 0.0135, 0.0036, 0.0009, z0, z1)
    face = HD.coons_fill("iron_face", face_rim, 0.0, n, nu=44,
                         vs=vs, relief=lambda u, v: rel(u, v) * 0.0005,
                         corners="bbox")

    # THE RIM: the face outline swept back, closing into a smaller back outline
    back_rim = [p + Vector((0.0, DEPTH, 0.0)) for p in inset(face_rim, 0.0035)]
    band = ST.grid("iron_rim", [face_rim, [p + Vector((0, DEPTH * 0.42, 0)) *
                                           1.0 for p in inset(face_rim, 0.0012)],
                                back_rim], wrap_u=True)

    # THE CAVITY: the back, pushed FORWARD between the rim. A negative bulge is
    # a scoop, and a scoop between a topline and a sole is a cavity back.
    cav_rim = inset(back_rim, 0.0062)
    cavity = HD.coons_fill("iron_cavity", cav_rim, -0.0092,
                           Vector((0.0, 1.0, 0.0)), nu=40, nv=28, power=0.62,
                           corners="bbox")
    # the shelf between the rim's inner edge and the cavity's lip
    shelf = ST.grid("iron_shelf", [back_rim, cav_rim], wrap_u=True)

    axis = Vector((-math.cos(LIE), 0.0, math.sin(LIE)))
    heel = Vector((-0.0335, 0.008, 0.040))
    p = HD.club_stick("iron", heel, axis, 0.052, 0.0080, 0.0066, 0.026,
                      0.855, 0.272, 0.0116, 0.0093,
                      shaft_r0=0.0044, shaft_r1=0.0050)

    m_steel = HD.brushed("IronBody", STEEL, rough=0.30)
    m_face = HD.brushed("IronFace", FACEM, rough=0.47)      # milled: duller
    for ob in (band, shelf):
        ob.data.materials.append(m_steel)
    cavity.data.materials.append(HD.brushed("IronCavity", (0.20, 0.21, 0.23),
                                            rough=0.52))
    face.data.materials.append(m_face)
    p["hosel"].data.materials.append(m_steel)
    p["ferrule"].data.materials.append(HD.plastic("IronFerrule"))
    p["shaft"].data.materials.append(
        HD.brushed("IronShaft", (0.70, 0.71, 0.72), rough=0.17))
    p["grip"].data.materials.append(HD.rubber("IronGrip"))


    # BLOCK 5 -- THE MAPS, through the same wire() the eleven garments went
    # through. The families are EXPLICIT, never inferred from the material
    # name: "IronShaft" contains "shaft", "shaft" would infer steel, and a
    # graphite shaft with metallic 1.0 is the exact confusion hard.py warns
    # about. The span is the PART'S in millimetres, so a grip's diamond lands
    # at 3.4 mm and a head's brush at 5 mm rather than at whatever the unwrap
    # normalised to.
    sys.path.insert(0, os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "v7"))
    import surface as SF  # noqa: E402
    SF.bake([
        (m_steel, 'steel', 0.3, 90.0),
        (m_face, 'steel', 0.47, 80.0),
        (cavity.data.materials[0], 'steel', 0.52, 70.0),
        (p['ferrule'].data.materials[0], 'paint', 0.3, 20.0),
        (p['shaft'].data.materials[0], 'steel', 0.17, 900.0),
        (p['grip'].data.materials[0], 'rubber', 0.82, 280.0),
    ], "iron")

    metal = [face, band, shelf, cavity, p["hosel"]]
    soft = [p["ferrule"], p["shaft"], p["grip"]]
    for ob in metal:
        ST.smooth_by_angle(ob, 24.0)     # an iron is nearly all flat land
    for ob in soft:
        ST.smooth_by_angle(ob, 32.0)
    HD.sit_on_floor(metal + soft)
    HD.measure(metal + soft, "iron")
    return metal, soft


def main():
    argv = H.argv_after_dashes()
    H.reset_scene()
    H.set_engine("CYCLES" if "cycles" in argv else "EEVEE", samples=112)
    metal, soft = build()
    subject = metal + soft
    lo, hi = H.bounds(subject)
    look = Vector(((lo.x + hi.x) * 0.5, (lo.y + hi.y) * 0.5,
                   (lo.z + hi.z) * 0.5))
    r = max((hi - lo).x, (hi - lo).y, (hi - lo).z) * 0.5
    HD.studio_hard(look, r, ev=EV)
    print("  tris %d" % ST.tris(subject))
    out = ST.out_dir("qa", "hero", "v5", NAME)
    if "render" in argv:
        ST.shots(subject, look, r, out,
                 [("three", -58.0, 22.0, 85.0), ("front", -90.0, 10.0, 85.0),
                  ("side", -4.0, 10.0, 85.0)],
                 res=(900, 1150), margin=1.08)
        hlo, hhi = H.bounds(metal)
        hlook = Vector(((hlo.x + hhi.x) * 0.5, (hlo.y + hhi.y) * 0.5,
                        (hlo.z + hhi.z) * 0.5))
        hr = max((hhi - hlo).x, (hhi - hlo).y, (hhi - hlo).z) * 0.5
        HD.studio_hard(hlook, hr, ev=EV - 0.45, world=0.10)
        ST._drop("CycFloor")
        ST.shots(metal, hlook, hr, out,
                 [("head-face", -90.0, 4.0, 92.0),
                  ("head-three", -56.0, 20.0, 92.0),
                  ("head-back", 84.0, 14.0, 92.0),
                  ("head-sole", -70.0, -54.0, 92.0)],
                 res=(1100, 900), margin=1.28)
    if "export" in argv:
        import export_all as EX
        for ob in subject:
            if not ob.data.uv_layers:
                ST.unwrap(ob)
        ST.flatten_for_export(subject)
        EX.set_origin(subject, "base")
        sys.path.insert(0, os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "v6"))
        import vertex_ao as VAO  # noqa: E402
        VAO.bake(subject)
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(
            ST.ROOT, "Assets", "models", "hero", "v5", "hard_iron.glb"),
            vertex_colors=True)


if __name__ == "__main__":
    main()
