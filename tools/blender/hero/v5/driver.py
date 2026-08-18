"""club-driver -- a 460 cc titanium driver, built the way one is made.

WHAT IS THERE NOW: `build_checkout_products.club_base` makes a driver out of a
UV sphere scaled (1.22, 0.78, 0.72) with a bevelled cube stuck on the front for
a face, on a plain cylinder shaft with a cylinder grip. Five primitives, one
steel material for the shaft and the face, and no crown, no sole, no hosel, no
ferrule. That is the "you do not have one" in the brief, stated in code.

THE CONSTRUCTION. A driver head is a hollow shell with three surfaces that meet
at edges you can see across a shop:

  * the CROWN -- a shallow compound dome, painted gloss, which is the only part
    of the club the player looks down at;
  * the SOLE -- nearly flat with a slight camber, a duller metal, carrying the
    weight port;
  * the FACE -- set into the front, leaning back at the loft, domed in BOTH
    directions (bulge across, roll up) and cut with scorelines.

Crown and sole meet at the SKIRT, the widest line around the head, and that
line is the single most important edge on the object: it is where the highlight
breaks. It is marked sharp here and the two surfaces carry different materials,
because smoothing at 30 degrees would still round it -- they meet at about 25.

The head is lofted along the face-to-back axis from a table of real sections
(width, skirt height, crown apex, sole depth), and each section's crown and
sole are SUPERELLIPSES whose exponents differ: the crown is a continuous
shallow dome, the sole is flat in the middle and turns hard into the skirt.
That difference is the shape of the part. There is no sin() anywhere in it.

Run: blender --factory-startup -b --python driver.py -- render
     blender --factory-startup -b --python driver.py -- render export
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

NAME = "club-driver"
EV = -0.30

LOFT = math.radians(10.5)      # the face leans back this much
LIE = math.radians(58.0)       # the shaft rises this much off the ground

# y (face -> back), width, skirt height, crown apex, sole depth below skirt.
# Sole bottom is skirt - depth, so the small differences down that last column
# ARE the sole camber: 2 mm of clearance at the face, 3 mm at the back, flat
# through the middle where the club sits on the ground.
SEC = [
    (0.000, 0.104, 0.020, 0.056, 0.018),
    (0.014, 0.116, 0.019, 0.061, 0.0185),
    (0.038, 0.121, 0.018, 0.064, 0.018),
    (0.062, 0.120, 0.017, 0.065, 0.017),
    (0.086, 0.110, 0.017, 0.060, 0.0165),
    (0.104, 0.088, 0.017, 0.048, 0.0155),
    (0.118, 0.052, 0.016, 0.032, 0.013),
    (0.125, 0.030, 0.016, 0.022, 0.010),
    (0.129, 0.010, 0.016, 0.012, 0.005),
]

NC, NS = 46, 34        # crown points per ring, sole points per ring
NV = 64               # rings from face to back
ZMID = 0.028           # the face's mid height, the axis the loft leans about

CROWN = (0.0295, 0.0315, 0.0345)     # near-black graphite grey, gloss
SOLE = (0.545, 0.535, 0.515)
FACE = (0.605, 0.600, 0.585)
BADGE = (0.612, 0.140, 0.108)


def ring(y, w, zsk, hc, ds):
    """One cross-section: crown arc heel->toe, then sole arc toe->heel.

    The crown's exponents (3.25, 0.42) give a surface that is nearly flat over
    the middle and then turns hard into the skirt; the sole's (3.4, 0.5) do the
    same lower down. The first pass used (2.35, 0.60), which is close to an
    ellipse, and the head read as a computer mouse: one continuous curve from
    the topline to the sole with nowhere for a highlight to break. A driver
    crown is FLAT where you look at it. That difference is two numbers.
    """
    lean = max(0.0, 1.0 - y / 0.042)
    tan_l = math.tan(LOFT)
    pts = []

    def place(x, z):
        return (x, y + lean * (z - ZMID) * tan_l, z)

    for i in range(NC):
        s = -1.0 + 2.0 * i / (NC - 1)
        x = s * w * 0.5
        pts.append(place(x, zsk + (hc - zsk) * HD.superarc(s, 3.25, 0.42)))
    for i in range(1, NS):
        s = 1.0 - 2.0 * i / NS
        x = s * w * 0.5
        pts.append(place(x, zsk - ds * HD.superarc(s, 3.40, 0.50)))
    return pts


def head():
    rings = []
    y0, y1 = SEC[0][0], SEC[-1][0]
    for v in range(NV):
        # RINGS CLUSTERED AT BOTH ENDS. t**0.86 put them near the face, where
        # the section barely changes, and left the back -- where the width
        # collapses from 88 mm to 10 mm in 25 mm -- with a ring every 4 mm. The
        # toe and back silhouette came back visibly polygonal. A smoothstep is
        # dense at both ends and sparse through the middle, which is where the
        # section is genuinely constant.
        t = v / (NV - 1)
        y = y0 + (y1 - y0) * (t * t * (3.0 - 2.0 * t))
        w, zsk, hc, ds = HD.lerp_table(SEC, y)
        rings.append(ring(y, w, zsk, hc, ds))
    ob = ST.grid("driver_head", rings, wrap_u=True)
    HD.fill_loop(ob)     # closes the tail; the face end is filled by the dish
    return ob, rings[0]


def face_patch(rim):
    """The face: a dish set into the front, leaning back at the loft.

    Bulge and roll are both 305 mm radii on a real driver, which over a 104 mm
    face is 4.5 mm of crown across and 1.3 mm up -- so the dish is genuinely
    domed and not a flat plate, and the highlight travels across it as the club
    turns instead of switching on and off.
    """
    n = Vector((0.0, -math.cos(LOFT), math.sin(LOFT)))
    ob = HD.coons_fill("driver_face", rim, 0.0045, n, nu=30, nv=22)

    # SCORELINES, cut as geometry. Six shallow channels across the face, 4 mm
    # apart with a flat land between -- the same piecewise rule the knit wale
    # follows, because a groove has two walls and a floor, not a waveform.
    cut = HD.scorelines(None, 7, -0.012, 0.0042, 0.0011, 0.00035, "z", 0.040)
    for v in ob.data.vertices:
        h = v.co.z - ZMID
        d = cut(h)
        if d:
            v.co -= n * d
    ob.data.update()
    return ob


def hosel_and_shaft():
    """Hosel, ferrule, shaft and grip, all on ONE axis.

    A shaft that does not continue the hosel's bore is the tell that the club
    was assembled out of primitives rather than built: the existing one has the
    shaft on the head's centre line and the head hanging off it sideways.
    """
    axis = Vector((-math.cos(LIE), 0.0, math.sin(LIE)))
    heel = Vector((-0.040, 0.026, 0.026))          # inside the head, at the heel
    parts = {}

    parts["hosel"] = HD.tube("driver_hosel", heel, heel + axis * 0.062,
                             0.0082, 0.0068, sides=20, rows=3)
    # THE FERRULE IS A COLLAR, not a hairline. At 7.1 mm over a 6.8 mm hosel
    # it was 0.3 mm proud and vanished; a real one steps visibly off the hosel
    # and tapers into the shaft over 30 mm, and it is the black band that says
    # "this club was assembled" rather than moulded in one piece.
    fer0 = heel + axis * 0.060
    parts["ferrule"] = HD.tube("driver_ferrule", fer0, fer0 + axis * 0.032,
                               0.0086, 0.0053, sides=22, rows=5)
    sh0 = heel + axis * 0.074
    sh1 = heel + axis * 1.118
    parts["shaft"] = HD.tube("driver_shaft", sh0, sh1,
                             0.0043, 0.0048, sides=18, rows=8)
    g_top = heel + axis * 1.124
    g_bot = heel + axis * 0.846
    parts["grip"] = HD.grip("driver_grip", g_top, g_bot,
                            0.0121, 0.0096, sides=24, rows=30,
                            ribs=0, rib_depth=0.0)
    return parts


def build():
    hd, rim = head()
    fc = face_patch(rim)

    # a weight port in the sole, which is what stops the sole reading as a
    # painted underside
    port = HD.revolve("driver_port",
                      [(0.0, 0.0028), (0.0092, 0.0030), (0.0104, 0.0018),
                       (0.0104, -0.0016), (0.0, -0.0016)], sides=24)
    for v in port.data.vertices:
        v.co = Vector((v.co.x + 0.002, v.co.y + 0.098, v.co.z + 0.0035))
    port.data.update()

    parts = hosel_and_shaft()

    # MATERIALS: crown gloss-painted, sole matte titanium, face brushed. Three
    # responses on the head alone, and the skirt is where they change.
    m_crown = HD.painted("DriverCrown", CROWN, rough=0.11, coat=0.9)
    m_sole = HD.titanium("DriverSole", SOLE, rough=0.46)
    m_face = HD.brushed("DriverFace", FACE, rough=0.29)
    hd.data.materials.append(m_crown)
    hd.data.materials.append(m_sole)
    # skirt line: every ring's crown runs u in [0, NC), the sole after it
    nu = hd["nu"]
    for poly in hd.data.polygons:
        u = min(v % nu for v in poly.vertices)
        poly.material_index = 0 if (u < NC - 1) else 1
    fc.data.materials.append(m_face)
    port.data.materials.append(HD.brushed("DriverWeight", (0.32, 0.31, 0.30),
                                          rough=0.38))

    parts["hosel"].data.materials.append(
        HD.brushed("DriverHosel", (0.60, 0.60, 0.60), rough=0.22))
    parts["ferrule"].data.materials.append(HD.plastic("DriverFerrule"))
    parts["shaft"].data.materials.append(HD.graphite("DriverShaft"))
    parts["grip"].data.materials.append(HD.rubber("DriverGrip"))

    # CRISPNESS. 30 degrees, not 70 -- and the skirt marked sharp on top, since
    # crown and sole meet at about 25 and smoothing alone would round it into
    # the memory-foam read the whole of v5 exists to kill.
    ST.smooth_by_angle(hd, 30.0)
    HD.mark_band(hd, lambda a, b: (a.z - 0.0175) * (b.z - 0.0175) < 0
                 and abs(a.y - b.y) < 0.006)
    ST.smooth_by_angle(fc, 26.0)
    for k in ("hosel", "ferrule", "shaft"):
        ST.smooth_by_angle(parts[k], 32.0)
    ST.smooth_by_angle(parts["grip"], 30.0)
    ST.smooth_by_angle(port, 28.0)

    metal = [hd, fc, port, parts["hosel"]]
    soft = [parts["ferrule"], parts["shaft"], parts["grip"]]
    HD.sit_on_floor(metal + soft)
    HD.measure(metal + soft, "driver")
    return metal, soft, [m_crown, m_sole, m_face, BADGE]


def main():
    argv = H.argv_after_dashes()
    H.reset_scene()
    H.set_engine("CYCLES" if "cycles" in argv else "EEVEE", samples=112)
    metal, soft, _m = build()
    subject = metal + soft
    lo, hi = H.bounds(subject)
    look = Vector(((lo.x + hi.x) * 0.5, (lo.y + hi.y) * 0.5,
                   (lo.z + hi.z) * 0.5))
    r = max((hi - lo).x, (hi - lo).y, (hi - lo).z) * 0.5
    HD.studio_hard(look, r, ev=EV)
    print("  tris %d" % ST.tris(subject))

    if "render" in argv:
        out = ST.out_dir("qa", "hero", "v5", NAME)
        ST.shots(subject, look, r, out,
                 [("three", -58.0, 22.0, 85.0), ("front", -90.0, 10.0, 85.0),
                  ("side", -4.0, 10.0, 85.0), ("top", -70.0, 66.0, 85.0)],
                 res=(900, 1150), margin=1.08)
        # AND THE HEAD ON ITS OWN. A whole driver in frame is a 1.1 m stick and
        # the head is 120 mm of it -- every construction claim above is about
        # something 10% of the frame wide, which is not a look, it is a guess.
        hlo, hhi = H.bounds(metal)
        hlook = Vector(((hlo.x + hhi.x) * 0.5, (hlo.y + hhi.y) * 0.5,
                        (hlo.z + hhi.z) * 0.5))
        hr = max((hhi - hlo).x, (hhi - hlo).y, (hhi - hlo).z) * 0.5
        HD.studio_hard(hlook, hr, ev=EV)
        # AND TAKE THE FLOOR AWAY. The sole is the one surface that faces the
        # ground, so photographing it means putting the camera under the club,
        # and with the cyc floor in place that frame is the underside of a white
        # plane -- the blank-frame guard refused it, correctly. A head study is
        # a floating study; the card behind is enough.
        ST._drop("CycFloor")
        ST.shots(metal, hlook, hr, out,
                 [("head-three", -54.0, 26.0, 92.0),
                  ("head-face", -90.0, 6.0, 92.0),
                  ("head-crown", -66.0, 72.0, 92.0),
                  ("head-sole", -66.0, -58.0, 92.0)],
                 res=(1100, 900), margin=1.10)

    if "export" in argv:
        import export_all as EX
        for ob in subject:
            if not ob.data.uv_layers:
                ST.unwrap(ob)
        ST.flatten_for_export(subject)
        EX.set_origin(subject, "base")
        # MACRO OCCLUSION, into the vertices -- the shadow a sole casts
        # into a cavity back, or a counter top over its own kick recess,
        # belongs to this object once and cannot live in a tiling map.
        import vertex_ao as VAO
        VAO.bake(subject)
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(
            ST.ROOT, "Assets", "models", "hero", "v5", "hard_driver.glb"), vertex_colors=True)


if __name__ == "__main__":
    main()
