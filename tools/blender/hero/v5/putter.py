"""club-putter -- a mallet with a plumber's neck, sight lines and a milled insert.

WHAT WAS THERE: a bevelled cube 130 x 52 x 32 with a thinner cube stuck on the
front for an insert, on a straight cylinder. The brief asks for "a distinct
alignment line and a flat face. Different silhouette from the other two or it
is not worth having", and a box is not a silhouette.

SO IT IS A MALLET, deliberately, because the driver is a dome and the iron is a
blade and a third wedge-shaped thing would have been the wrong choice. What
makes a mallet read as a putter at a glance is four things and none of them are
the outline:

  * the TOP IS FLAT and it is the only club face-up in the bag, so the two
    SIGHT LINES on it are the most visible feature on the whole object;
  * the FACE is nearly vertical -- three degrees, against the driver's ten and
    a half and the iron's thirty-four -- with a soft MILLED INSERT set into it
    that is a different material and stands proud of nothing;
  * the neck is a PLUMBER'S NECK: a double bend that offsets the shaft ahead of
    the face. A straight hosel is what every primitive putter has and it is the
    tell;
  * the sole carries two visible weights out at the heel and toe.

The body sections use a high superellipse exponent, which gives a genuinely
flat top and sole with a quick turn at the corners -- the same one number that
made the driver's crown flat, pushed further.

Run: blender --factory-startup -b --python putter.py -- render export
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

NAME = "club-putter"
EV = -0.30

LOFT = math.radians(3.0)
LIE = math.radians(70.0)

# y (face -> back), half width, top height
SEC = [
    (0.000, 0.0560, 0.0225),
    (0.018, 0.0575, 0.0230),
    (0.042, 0.0555, 0.0228),
    (0.062, 0.0470, 0.0218),
    (0.074, 0.0345, 0.0195),
    (0.082, 0.0195, 0.0150),
    (0.086, 0.0060, 0.0085),
]

NU, NV = 40, 46
BODY = (0.288, 0.292, 0.300)      # dark anodised
INSERT = (0.170, 0.196, 0.230)    # a soft polymer insert, blue-grey
SIGHT = (0.865, 0.868, 0.860)


def ring(y, hw, ht):
    """A flat top and a flat sole with quick corners.

    Exponent 6.0 against the driver crown's 3.25: the top of a mallet is a
    machined plane you sight along, not a dome, and the corner radius is about
    3 mm. One number is the whole difference in character between the two
    heads.
    """
    pts = []
    for i in range(NU):
        s = -1.0 + 2.0 * i / (NU - 1)
        pts.append((s * hw, y, ht * HD.superarc(s, 6.0, 0.16)))
    for i in range(1, NU - 1):
        s = 1.0 - 2.0 * i / (NU - 1)
        pts.append((s * hw, y, 0.0028 * (1.0 - HD.superarc(s, 6.0, 0.16))))
    return pts


def build():
    rings = []
    y0, y1 = SEC[0][0], SEC[-1][0]
    for v in range(NV):
        t = v / (NV - 1)
        y = y0 + (y1 - y0) * (t * t * (3.0 - 2.0 * t))
        hw, ht = HD.lerp_table(SEC, y)
        rings.append(ring(y, hw, ht))
    body = ST.grid("putter_body", rings, wrap_u=True)
    HD.fill_loop(body)
    face_rim = rings[0]

    # THE FACE, three degrees of loft, and the insert milled into it
    n = Vector((0.0, -math.cos(LOFT), math.sin(LOFT)))
    face = HD.coons_fill("putter_face", face_rim, 0.0, n, nu=34, nv=16,
                         corners="bbox")
    ins_rim = []
    for i in range(64):
        a = 2 * math.pi * i / 64
        ins_rim.append(Vector((0.0470 * math.cos(a), -0.0012,
                               0.0113 + 0.0082 * math.sin(a))))
    insert = HD.coons_fill("putter_insert", ins_rim, 0.0, n, nu=30, nv=14,
                           corners="bbox")

    # TWO SIGHT LINES on the top, a ball's width apart -- and they FOLLOW THE
    # SURFACE. Built as flat boxes at a fixed height they were flush at the
    # middle and floating three millimetres clear at the back, because the top
    # falls away toward the tail. A sight line is painted into a machined
    # channel; it cannot be anywhere but on the metal.
    sights = []
    for sx in (-1, 1):
        rows = []
        for j in range(18):
            y = 0.030 + (0.070 - 0.030) * j / 17.0
            hw, ht = HD.lerp_table(SEC, y)
            row = []
            for k in range(2):
                x = sx * 0.0107 + (k - 0.5) * 0.0032
                sp = x / hw
                row.append((x, y, ht * HD.superarc(sp, 6.0, 0.16) + 0.00025))
            rows.append(row)
        sights.append(ST.grid("putter_sight%+d" % sx, rows))
    sight = ST.join("putter_sight", sights)

    # TWO SOLE WEIGHTS, out at the heel and the toe where they do the work
    ws = []
    for sx in (-1, 1):
        w = HD.revolve("putter_w%+d" % sx,
                       [(0.0, 0.0026), (0.0078, 0.0028), (0.0088, 0.0012),
                        (0.0088, -0.0012), (0.0, -0.0012)], sides=22)
        for v in w.data.vertices:
            v.co = Vector((v.co.x + sx * 0.0405, v.co.y + 0.0625,
                           v.co.z + 0.0016))
        w.data.update()
        ws.append(w)
    weights = ST.join("putter_weights", ws)

    # THE PLUMBER'S NECK: up out of the heel, forward, then away on the shaft
    # axis. Two bends, which is what puts the shaft AHEAD of the face.
    axis = Vector((-math.cos(LIE), 0.0, math.sin(LIE)))
    knee = Vector((-0.0455, 0.020, 0.0215))
    path = [knee,
            knee + Vector((0.0, 0.0, 0.026)),
            knee + Vector((-0.004, -0.014, 0.040)),
            knee + Vector((-0.008, -0.020, 0.052))]
    neck = ST.sweep("putter_neck", path, 0.0052, 0.0052, sides=16)
    top = path[-1]
    p = HD.club_stick("putter", top, axis, 0.010, 0.0054, 0.0050, 0.018,
                      0.760, 0.290, 0.0134, 0.0112,
                      shaft_r0=0.0047, shaft_r1=0.0052)

    m_body = HD.brushed("PutterBody", BODY, rough=0.38)
    body.data.materials.append(m_body)
    face.data.materials.append(HD.brushed("PutterFace", (0.44, 0.45, 0.46),
                                          rough=0.26))
    insert.data.materials.append(HD.plastic("PutterInsert", INSERT, rough=0.55))
    sight.data.materials.append(ST.matte("PutterSight", SIGHT, rough=0.42))
    weights.data.materials.append(HD.brushed("PutterWeight", (0.30, 0.29, 0.28),
                                             rough=0.34))
    neck.data.materials.append(HD.brushed("PutterNeck", (0.66, 0.67, 0.68),
                                          rough=0.18))
    p["hosel"].data.materials.append(HD.brushed("PutterHosel", (0.66, 0.67, 0.68),
                                                rough=0.18))
    p["ferrule"].data.materials.append(HD.plastic("PutterFerrule"))
    p["shaft"].data.materials.append(
        HD.brushed("PutterShaft", (0.70, 0.71, 0.72), rough=0.17))
    p["grip"].data.materials.append(HD.rubber("PutterGrip", (0.052, 0.050, 0.048),
                                              rough=0.78))

    metal = [body, face, insert, sight, weights, neck, p["hosel"]]
    soft = [p["ferrule"], p["shaft"], p["grip"]]
    for ob in metal:
        ST.smooth_by_angle(ob, 26.0)
    for ob in soft:
        ST.smooth_by_angle(ob, 32.0)
    HD.sit_on_floor(metal + soft)
    HD.measure(metal + soft, "putter")
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
        HD.studio_hard(hlook, hr, ev=EV, world=0.13)
        ST._drop("CycFloor")
        ST.shots(metal, hlook, hr, out,
                 [("head-top", -78.0, 62.0, 92.0),
                  ("head-three", -56.0, 24.0, 92.0),
                  ("head-face", -90.0, 6.0, 92.0)],
                 res=(1100, 900), margin=1.24)
    if "export" in argv:
        import export_all as EX
        for ob in subject:
            if not ob.data.uv_layers:
                ST.unwrap(ob)
        ST.flatten_for_export(subject)
        EX.set_origin(subject, "base")
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(
            ST.ROOT, "Assets", "models", "hero", "v5", "hard_putter.glb"))


if __name__ == "__main__":
    main()
