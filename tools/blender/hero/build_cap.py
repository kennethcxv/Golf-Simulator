"""APPAREL V2 — THE CAP, built out of its panels.

v1 was a lofted dome with decoration sitting on top of it, and the owner's word
for the result was "a lump". He is right, and the reason is structural rather
than cosmetic: a dome with six tubes glued to it is a dome, and no amount of
softening makes it a cap. So nothing here is inherited from v1.

WHAT THE REFERENCE ACTUALLY SHOWS (ref/apparel, looked at at full size)

  cap-bfp-front / -left / -rear / -right   one cap, four square-on views, which
      is the set v1 never had. The crown is NOT a hemisphere. Front-on it is a
      wide low arch whose sides drop nearly vertically; in profile the front
      face is steep and the back is a long gentle slope, so the button sits
      FORWARD of the middle of the base oval. The widest point of the crown is
      about two-fifths of the way up, not at the base -- a blocked crown flares
      over the head and tucks back in at the sweatband.

  cap-bfp-rear    the single biggest thing v1 got wrong. The back of a cap is
      not closed. Two panels are cut away in a wide U and you look straight
      into the inside of the hat; a strap crosses the bottom of the opening.
      Three of eight turntable frames are of the back of this object.

  cap-detail      the seams. Each panel join is a narrow RIDGE with the panel
      dished slightly either side of it, not a length of piping laid on top.
      And the bill carries four or five concentric stitch rows following its
      outline, which is most of what tells you the bill is stiffened.

  cap-variety     the bill's double curvature -- it droops along its length AND
      arches across its width, so the two corners point down and forward.

HOW IT IS BUILT

  Six PANEL objects, each its own solidified surface spanning 60 degrees, each
  dished toward its own middle and tucked in at its two edges. Six SEAM ridges
  sit in the grooves the tucks make. The panels stop short of the apex and
  leave a real hole, which is what the button is for. The back two panels have
  their bottom edge lifted into the U, and the strap bridges it.

  Nothing is a decorated primitive. If a part could be made by rounding off a
  box, it is the wrong part.

    blender --factory-startup -b --python tools/blender/hero/build_cap.py -- \
        [cycles] [way=cream|navy|...] [views=12] [noexport]
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
OUT_RENDER = os.path.join(REPO, "qa", "hero", "apparel_v2", "cap")
GLB_DIR = os.path.join(REPO, "Assets", "models", "hero")
ATLAS = os.path.join(REPO, "Assets", "models", "hero", "textures",
                     "apparel_atlas.png")
ATLAS_COLS, ATLAS_ROWS = 6, 6

# ---------------------------------------------------------------------------
# the measurements, in metres, off a 56 cm head
#
# The base is an OVAL and the long axis runs front-to-back, because a head is
# longer than it is wide. v1 used a circle scaled 0.965 in y, which is the wrong
# way round and is half of why it read as a melon.

AX, AY = 0.0820, 0.0965        # base oval: 164 mm across, 193 mm front-to-back
CROWN_H = 0.1000               # base ring to the top of the fabric
APEX_Y = -0.0075               # the button sits 7.5 mm FORWARD of centre
SH_EXP = 0.68                  # <1 keeps the crown wide as it climbs
RISE_EXP = 0.90                # >0.5 makes the sides steep at the base
FLARE = 0.055                  # the blocked crown's bulge, peaking near t=0.42
STIFF = 0.085                  # buckram: the two front panels stand up flat
CLOTH = 0.0026                 # fabric thickness

PANELS = 6
SPAN = 2.0 * math.pi / PANELS
T_TOP = 0.985                  # the panels stop here and leave the button hole
OPEN_HALF = math.radians(44.0)  # the back opening's half-angle
T_OPEN = 0.225                 # how far up the opening's arch reaches
EYELETS_PER_PANEL = 2

# THE BILL. Round 1 built it as "root curve plus a forward reach", with the fall
# and the cross-arch driven by the parameter v. That produced a 19 mm drop at
# the two side corners across only 13 mm of forward travel -- a vertical CLIFF,
# which the side view showed as a rectangular notch and the underside view as a
# hard triangular flap. The fix is that both curvatures are now driven by the
# DISTANCE ACTUALLY TRAVELLED FORWARD, so where the bill is short it stays flat
# and only the long middle falls away.
BRIM_HALF = math.radians(66.0)  # how much of the base the bill is sewn to
REACH = 0.0675                 # bill length at the centre
FULL = 0.62                    # plan fullness; higher pulls the sides in
TILT = 0.300                   # it leaves the crown already 17 degrees down
DROOP = 0.0440                 # total fall at the centre of the tip
ARCH = 0.0280                  # cross-curl, so the corners point down and out
BRIM_T = 0.0044
CURVE = (DROOP - TILT * REACH) / (REACH * REACH)


# ---------------------------------------------------------------------------
# the crown surface
#
# A cap is a surface of revolution only in the crudest sense. This one is a
# blend from a base OVAL to a single apex, with three separate deformations that
# each come from a specific photograph.


def _shape(t):
    """Horizontal scale at height parameter t, 1 at the base and 0 at the apex.

    The FLARE term is why this is not a hemisphere: it lifts the scale above 1
    around t=0.42, so the crown is wider a third of the way up than it is at the
    sweatband. Both rear views show that, and without it the cap tapers straight
    off the head like a swimming cap.
    """
    return (math.cos(math.pi * t * 0.5) ** SH_EXP) * (
        1.0 + FLARE * math.sin(math.pi * (t ** 0.8)))


def _rise(t):
    return math.sin(math.pi * t * 0.5) ** RISE_EXP


def crown_point(a, t, mult=1.0):
    """a = 0 is the CENTRE FRONT seam; the front of the cap faces -y."""
    s = _shape(t) * mult
    front = max(0.0, math.cos(a))
    s *= 1.0 + STIFF * (front ** 3) * math.sin(math.pi * (t ** 0.75))
    x = AX * math.sin(a) * s
    y = -AY * math.cos(a) * s + APEX_Y * (1.0 - s)
    return Vector((x, y, CROWN_H * _rise(t)))


def crown_normal(a, t, mult=1.0):
    """Outward surface normal, measured off the surface rather than assumed.

    Every part that sits ON the crown -- a seam ridge, an eyelet, the hem, the
    crest -- is placed along this. v1 oriented its parts by the path tangent and
    world up, and its own comment records what that cost: "on a curving crown
    its width axis swings away from the surface", which is how the back straps
    ended up as fins.
    """
    h = 2e-3
    du = crown_point(a + h, t, mult) - crown_point(a - h, t, mult)
    t0, t1 = max(0.0, t - h * 3), min(1.0, t + h * 3)
    dv = crown_point(a, t1, mult) - crown_point(a, t0, mult)
    n = du.cross(dv)
    if n.length < 1e-9:
        return Vector((math.sin(a), -math.cos(a), 0.0)).normalized()
    return n.normalized()


def _wrap(x):
    return (x + math.pi) % (2.0 * math.pi) - math.pi


def t_low(a):
    """Where this azimuth's panel STARTS. Zero everywhere except across the back,
    where the two panels are cut away into the U you look through."""
    d = abs(_wrap(a - math.pi))
    if d >= OPEN_HALF:
        return 0.0
    return T_OPEN * 0.5 * (1.0 + math.cos(math.pi * d / OPEN_HALF))


def panel_mult(j, s):
    """A panel is dished toward its middle and TUCKED at its two seams.

    That tuck is the whole difference between a seam and a stripe. The panel
    edges drop about a millimetre below the ideal crown, the seam ridge sits in
    the groove the two tucks make, and the result reads as two pieces of cloth
    sewn together rather than a line drawn on a dome.
    """
    dip = 0.012 * (math.exp(-((s / 0.075) ** 2))
                   + math.exp(-(((1.0 - s) / 0.075) ** 2)))
    bulge = 0.010 * math.sin(math.pi * s) ** 1.3
    # Real cloth is not six identical pieces. A sixth of a percent per panel is
    # invisible as a number and is exactly what stops the turntable looking
    # machined.
    jitter = 0.006 * math.sin(2.9 * j + 0.7)
    return 1.0 + bulge - dip + jitter


def panel_surface(j, s, t01):
    """The hem ROLLS UNDER over the bottom tenth of the panel.

    Without it, solidify leaves a flat 2.6 mm band facing outward and down all
    the way round the base, and it lit up as a hard white line across the side
    view -- a plastic trim strip on a cloth hat. Fabric turned up and stitched
    curves in; the band still exists but it now faces the floor.
    """
    a = j * SPAN + s * SPAN
    tl = t_low(a)
    roll = 1.0 - 0.022 * (max(0.0, 1.0 - t01 / 0.10) ** 1.6)
    # A THIRD OF A MILLIMETRE of slack, wandering across each panel. Cloth over
    # a form is never a clean surface of revolution, and without this the crown
    # holds one unbroken specular sweep from seam to seam and reads moulded.
    # Small enough that it never competes with the seams; large enough that the
    # highlight breaks.
    wave = 0.0040 * math.sin(math.pi * (1.6 * s + 0.37 * j)) * math.sin(
        math.pi * (t01 ** 0.9))
    return crown_point(a, tl + (T_TOP - tl) * t01,
                       panel_mult(j, s) * roll * (1.0 + wave))


def oval_pt(a, k=1.0, z=0.0):
    return Vector((AX * math.sin(a) * k, -AY * math.cos(a) * k, z))


def oval_n(a):
    n = Vector((AY * math.sin(a), -AX * math.cos(a), 0.0))
    return n.normalized()


# ---------------------------------------------------------------------------
# construction helpers


# ---------------------------------------------------------------------------
# the parts


def build_crown(p):
    NU, NV = 11, 13
    for j in range(PANELS):
        surf = CL.grid_surface(
            f"Cap_Panel{j}",
            (lambda jj: (lambda u, v: panel_surface(jj, u, v)))(j),
            nu=NU, nv=NV, smooth=True)
        p[f"panel{j}"] = CL.smooth_by_angle(CL.thicken(surf, CLOTH, offset=-1.0))

    # THE SEAMS, sitting in the grooves the panel tucks leave. 2.4 mm of relief
    # from the floor of the groove to the top of the ridge, against v1's raised
    # tube on a smooth surface.
    for j in range(PANELS):
        a = j * SPAN
        tl = t_low(a)
        pts, nrms = [], []
        N = 14
        for k in range(N + 1):
            t = tl + 0.008 + (T_TOP - tl - 0.004) * (k / N)
            pts.append(crown_point(a, t))
            nrms.append(crown_normal(a, t))
        p[f"seam{j}"] = CL.framed_sweep(f"Cap_Seam{j}", pts, nrms,
                                     0.0021, 0.0012, sides=6, taper=2)

    # THE HEM. Follows the base edge all the way round INCLUDING the arch, which
    # is what binds the opening and stops the cut looking like a hole punched in
    # a dome.
    #
    # Round 1 made it 1.6 x 0.8 mm and stood it 0.4 mm OFF the surface, and the
    # close-up called it what it was: a bent green wire laid round the opening.
    # A bound edge is wider than it is deep and it is PART OF the edge, so this
    # one is flatter and sunk into the fabric rather than resting on it.
    #
    # AND IT IS TWO PIECES, because on a real cap it is two pieces. The hem
    # round the front and sides is the crown's own cloth turned up, so it is the
    # crown's colour; the tape that binds the cut edge of the back opening is a
    # separate piece and it is the contrast colour. Round 3 ran one contrast
    # ring the whole way round and the side view showed the result: a green
    # racing stripe along the bottom of a cream hat.
    def edge_run(name, a0, a1, n):
        pts, nrms = [], []
        for i in range(n):
            a = a0 + (a1 - a0) * i / (n - 1.0)
            t = t_low(a) + 0.028
            pts.append(crown_point(a, t) - crown_normal(a, t) * 0.0002)
            nrms.append(crown_normal(a, t))
        return CL.framed_sweep(name, pts, nrms, 0.0019, 0.0006, sides=6,
                            square=0.75, taper=2)

    back = math.pi - OPEN_HALF
    p["hem"] = edge_run("Cap_Hem", -(back - 0.04), back - 0.04, 46)
    p["archbind"] = edge_run("Cap_ArchBind", math.pi - OPEN_HALF - 0.12,
                             math.pi + OPEN_HALF + 0.12, 26)

    # THE BUTTON, over the hole the six panels leave. A cap does not come to a
    # point; it comes to a 17 mm hole with a covered button on it.
    apex_z = CROWN_H * _rise(1.0)
    rings = []
    BR, BH, SEG = 0.0094, 0.0062, 16
    for (rf, zf) in ((1.00, -0.0052), (1.00, -0.0012),
                     (0.97, 0.0018), (0.86, 0.0042),
                     (0.63, 0.0062), (0.30, 0.0072)):
        rings.append([Vector((math.cos(2 * math.pi * i / SEG) * BR * rf,
                              APEX_Y + math.sin(2 * math.pi * i / SEG) * BR * rf,
                              apex_z - 0.0018 + zf)) for i in range(SEG)])
    p["button"] = CL.loft("Cap_Button", rings, close_bottom=True,
                          close_top=True, smooth=True)

    # EYELETS. Sewn, not punched: a ring of thread standing 1.9 mm off the
    # panel. A hole cut through the crown would show daylight through the hat in
    # a renderer with backface culling, which is what the game uses.
    for j in range(PANELS):
        for e in range(EYELETS_PER_PANEL):
            s = (0.30, 0.70)[e] if EYELETS_PER_PANEL == 2 else 0.5
            k = j * EYELETS_PER_PANEL + e
            s += 0.020 * math.sin(1.9 * k + 0.4)
            a = j * SPAN + s * SPAN
            tl = t_low(a)
            t = tl + (T_TOP - tl) * (0.36 + 0.016 * math.sin(2.3 * k + 0.9))
            m = panel_mult(j, s)
            c = crown_point(a, t, m)
            n = crown_normal(a, t, m)
            p[f"eyelet{j}_{e}"] = CL.torus(f"Cap_Eyelet{j}_{e}", c + n * 0.0002,
                                        n, 0.0026 * (1.0 + 0.05 * math.sin(1.7 * k)),
                                        0.00090, mseg=9, nseg=4)
    return p


def brim_reach(u):
    return REACH * (max(0.0, 1.0 - u * u) ** FULL)


def brim_surf(u, v):
    """u across the bill (-1..1), v from the root at the crown to the tip.

    Both curvatures are functions of d, the distance ACTUALLY TRAVELLED
    forward, not of v. That is the whole difference from round 1: v runs 0..1
    everywhere, including at the sides where the bill is only 6 mm long, so a
    fall expressed in v put a 19 mm drop into 13 mm of bill and built a cliff.
    In d, a short bill barely falls at all, which is what a short bill does.

    The root sits 1.2 mm INSIDE the crown so the seam disappears under the hem
    instead of standing off it as a lip.
    """
    a = u * BRIM_HALF
    root = crown_point(a, 0.045)
    root = root - crown_normal(a, 0.045) * 0.0012
    d = brim_reach(u) * v
    fwd = (Vector((0.0, -1.0, 0.0)) * 0.74
           + Vector((math.sin(a), -math.cos(a), 0.0)) * 0.26).normalized()
    q = root + fwd * d
    q.z = (root.z - TILT * d - CURVE * d * d
           - ARCH * (u * u) * ((d / REACH) ** 0.6))
    return q


def build_brim(p):
    NU, NV = 25, 7
    UMAX = 0.985
    plate = CL.grid_surface(
        "Cap_Brim", lambda u, v: brim_surf(-UMAX + 2 * UMAX * u, v),
        nu=NU, nv=NV, smooth=True)
    p["brim"] = CL.smooth_by_angle(CL.thicken(plate, BRIM_T, offset=0.0), 55.0)

    # The FREE outline -- up one side, round the tip, down the other -- with an
    # inward direction at every point, taken off the surface itself. The stitch
    # rows are that outline stepped in by a fixed distance, so they stay
    # parallel to the edge instead of turning into the three chevrons v1 got by
    # walking u and v by hand.
    edge, inward, up = [], [], []
    NS, NT = 5, 31
    # V0 = 0.10 ran the rows all the way back to where the bill meets the crown,
    # and the tapered ends came out as a spray of thin needles against the
    # fabric. Stitching stops before the seam allowance on a real bill too.
    V0 = 0.30

    def sample(u, v, du, dv):
        q = brim_surf(u, v)
        a1 = brim_surf(u + du, v + dv) - q
        return q, a1

    for i in range(NS):                       # left side, root to tip
        v = V0 + (1.0 - V0) * (i / NS)
        q, d = sample(-UMAX, v, 0.055, 0.0)
        edge.append(q)
        inward.append(d.normalized())
    for i in range(NT + 1):                   # round the tip
        u = -UMAX + 2 * UMAX * (i / NT)
        q, d = sample(u, 1.0, 0.0, -0.10)
        edge.append(q)
        inward.append(d.normalized())
    for i in range(NS):                       # right side, tip back to root
        v = 1.0 - (1.0 - V0) * ((i + 1) / NS)
        q, d = sample(UMAX, v, -0.055, 0.0)
        edge.append(q)
        inward.append(d.normalized())
    for i in range(len(edge)):
        j = min(i + 1, len(edge) - 1)
        k = max(i - 1, 0)
        tan = (edge[j] - edge[k])
        n = tan.cross(inward[i])
        up.append(n.normalized() if n.length > 1e-9 else Vector((0, 0, 1)))
    up = [u if u.z > 0 else -u for u in up]

    # the rolled binding, right on the edge
    p["binding"] = CL.framed_sweep(
        "Cap_Binding", [e + up[i] * 0.0001 for i, e in enumerate(edge)],
        up, 0.0018, 0.0018, sides=6)

    # And the stitch rows. Round 1 ran them at 0.9 x 0.7 mm and 5.2 / 11.2 /
    # 17.6 mm in, which read as four parallel LEDGES -- corrugation, not
    # stitching. Thread is thinner than that and the rows sit closer together.
    for row, d in enumerate((0.0042, 0.0088, 0.0138)):
        pts = [edge[i] + inward[i] * d + up[i] * (BRIM_T * 0.5 + 0.0002)
               for i in range(len(edge))]
        p[f"stitch{row}"] = CL.framed_sweep(f"Cap_Stitch{row}", pts, up,
                                         0.0007, 0.00045, sides=4, taper=3)

    # THE BILL SEAM. Without it the bill simply intersects the crown and the
    # junction reads as a slot cut in the fabric -- clearly visible in the side
    # view of round 2 as a dark wedge under the crown's bottom edge. A real bill
    # is sewn in, the seam is topstitched, and that line is what makes the two
    # pieces look joined rather than merged.
    pts, nrms = [], []
    NB = 25
    for i in range(NB):
        a = (-1.0 + 2.0 * i / (NB - 1)) * BRIM_HALF * 0.98
        t = 0.052
        pts.append(crown_point(a, t) + crown_normal(a, t) * 0.0004)
        nrms.append(crown_normal(a, t))
    p["billseam"] = CL.framed_sweep("Cap_BillSeam", pts, nrms,
                                 0.0019, 0.0008, sides=6, square=0.75, taper=2)
    return p


def build_lining(p):
    """The sweatband. It is only there because the back is open: you look
    straight through the U at the inside of the hat, and an empty shell is what
    would be there instead."""
    pts, nrms = [], []
    N = 44
    for i in range(N):
        a = 2.0 * math.pi * i / N
        c = oval_pt(a, 0.980, 0.0158)
        pts.append(c)
        nrms.append(oval_n(a))
    p["sweatband"] = CL.framed_sweep("Cap_Sweatband", pts, nrms,
                                  0.0130, 0.0015, closed=True, sides=6,
                                  square=0.80)
    return p


def _tail(name, a0, a1, out, zt=0.0040, zb=0.0182, nu=25):
    """One snapback tail. Its ends are ROUNDED and they SINK INTO the crown.

    Round 3 rounded them and they still read, in the side view, as a jagged tab
    stuck to the side of the hat -- because rounding an end that is standing
    3 mm proud of the fabric only changes the shape of the thing that is
    standing proud. A strap end is sewn under, so over the last twelfth of its
    run this one dives 2.5 mm inward and finishes inside the panel.
    """
    zc, hh = 0.5 * (zt + zb), 0.5 * (zb - zt)

    def f(u, v):
        a = a0 + (a1 - a0) * u
        end = min(1.0, min(u, 1.0 - u) / 0.120)
        base = oval_pt(a, 1.006) + oval_n(a) * (out - 0.0042 * (1.0 - end))
        s = 0.52 + 0.48 * math.sin(math.pi * 0.5 * end)
        base.z = (zc - hh * s) + 2.0 * hh * s * v
        return base
    surf = CL.grid_surface(name, f, nu=nu, nv=3, smooth=True)
    return CL.thicken(surf, 0.0022, offset=0.0)


def build_snapback(p):
    """A real snapback: a pegged tail, a punched tail, and two pegs engaged.

    The holes are cut, not painted -- boolean DIFFERENCE, which is the operation
    that has been reliable in this project, against the union of swept tubes
    which has not.
    """
    PITCH = 0.115
    peg_as = [math.pi + 0.10 - k * PITCH for k in range(6)]
    hole_as = [math.pi + 0.10 - m * PITCH for m in (0, 1, -1, -2, -3, -4)]

    # The overhang past the arch feet was 0.21 rad, which put the tail ends out
    # at the crown's widest point where they broke the silhouette and read, in
    # the side view, as a black bracket clipped to the hat. A strap is sewn in
    # AT the feet; 0.11 rad is enough to bury the end and no more.
    left = _tail("Cap_StrapPeg", math.pi - OPEN_HALF - 0.06, math.pi + 0.145,
                 -0.0016)
    right = _tail("Cap_StrapHole", math.pi - 0.07, math.pi + OPEN_HALF + 0.06,
                  0.0012)

    cutters = []
    for i, a in enumerate(hole_as):
        n = oval_n(a)
        base = oval_pt(a, 1.006) + n * (0.0012 - 0.010)
        base.z = 0.0111
        cutters.append(HS.prism(f"Cap_HoleCut{i}", base, n, 0.020,
                                0.0022, 0.0022, sides=16))
    cut = HS.join(cutters, "Cap_HoleCutter")
    mod = right.modifiers.new("Punch", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cut
    mod.solver = "EXACT"
    right = HS.apply_mods(right)
    bpy.data.objects.remove(cut, do_unlink=True)
    # SHADE BY ANGLE, not smooth. The boolean re-triangulates the tail, and a
    # fully smooth normal across those new triangles rendered as a row of
    # diamond-shaped highlights down a strap that is supposed to be a flat
    # moulded band -- clear in the macro of the back and faintly present in the
    # rear view. The hole rims want to be sharp anyway.
    p["strap_holes"] = CL.smooth_by_angle(right, 30.0)
    p["strap_pegs"] = CL.smooth_by_angle(left, 30.0)

    for i, a in enumerate(peg_as):
        n = oval_n(a)
        base = oval_pt(a, 1.006) + n * (-0.0016 + 0.0004)
        base.z = 0.0111
        p[f"peg{i}"] = CL.stud(f"Cap_Peg{i}", base, n, 0.0019, 0.0048)
    return p


def build_crest(p):
    """The front badge as an APPLIED PATCH, shaped and curved to the crown.

    v1's was a flat rectangular card standing off the front, and it read as
    exactly that. A patch is a shield of fabric sewn on with a satin edge, so
    this one is a shaped surface sampled off the crown's own function, lifted
    1.4 mm, given thickness, and bordered.
    """
    A_HALF, T0, T1 = 0.368, 0.130, 0.428
    NU, NV = 11, 9

    def outline_w(tau):
        w = math.sqrt(max(0.0, 1.0 - (1.0 - tau) ** 2.6))
        if tau > 0.90:
            w *= 1.0 - 0.42 * ((tau - 0.90) / 0.10) ** 2
        return max(0.06, w)

    def f(u, v):
        tau = v
        s = (-1.0 + 2.0 * u) * outline_w(tau)
        a = s * A_HALF
        t = T0 + (T1 - T0) * tau
        return crown_point(a, t) + crown_normal(a, t) * 0.0014

    surf = CL.grid_surface("Cap_Crest", f, nu=NU, nv=NV, smooth=True)
    # flip_u=False. The first render printed PINE HILLS backwards: the grid's
    # u=0 column is at a = -A_HALF, which is -x, which is the viewer's LEFT on
    # a cap facing -y, so u already runs left-to-right and flipping it mirrored
    # the wordmark. Read the render, not the maths.
    CL.grid_uv(surf, NU, NV, flip_u=False)
    p["crest"] = CL.thicken(surf, 0.0011, offset=-1.0)

    pts, nrms = [], []
    for i in range(NV):
        tau = i / (NV - 1.0)
        pts.append(f(0.0, tau))
    for i in range(1, NU):
        pts.append(f(i / (NU - 1.0), 1.0))
    for i in range(NV - 2, -1, -1):
        tau = i / (NV - 1.0)
        pts.append(f(1.0, tau))
    for i in range(NU - 2, 0, -1):
        pts.append(f(i / (NU - 1.0), 0.0))
    for q in pts:
        d = q - Vector((0.0, 0.0, q.z))
        nrms.append(crown_normal(math.atan2(q.x / AX, -(q.y - APEX_Y) / AY)
                                 if d.length > 1e-9 else 0.0, 0.32))
    p["crest_edge"] = CL.framed_sweep("Cap_CrestEdge", pts, nrms,
                                   0.0010, 0.0008, closed=True, sides=5)
    return p


def build(way="cream"):
    p = {}
    build_crown(p)
    build_brim(p)
    build_lining(p)
    build_snapback(p)
    build_crest(p)
    return p


# ---------------------------------------------------------------------------
# materials: still ONE cloth and ONE trim, still one atlas

WAYS = {
    # crown, bill, bill-binding+trim
    "cream": (11, 2, 14),
    "navy": (0, 11, 12),
    "fairway": (2, 11, 14),
    "burgundy": (5, 11, 17),
    "stone": (8, 9, 16),
}
CREST_CELL, UNDERBRIM_CELL, SWEAT_CELL = 24, 25, 26
# Cell 27 is the near-black plastic the snapback used to wear. Nothing on the
# cap wears it now -- the closure moved to the cap's own trim colour, because in
# black it read as hardware bolted to a hat -- but the cell stays on the sheet
# for whatever needs a moulded surface next.
PLASTIC_CELL = 27


def cell_for(part, way):
    crown, bill, trim = WAYS[way]
    n = part.lower()
    if n.startswith("crest"):
        return trim if "edge" in n else CREST_CELL
    if n.startswith("stitch") or n == "binding":
        return crown
    if n == "brim":
        return bill
    if n == "sweatband":
        return SWEAT_CELL
    # The snapback in near-black plastic read as hardware bolted to a hat. On
    # the reference caps the closure is the cap's own trim colour and it
    # disappears into the garment, which is what a closure should do.
    if n.startswith("strap") or n.startswith("peg"):
        return trim
    if n.startswith("eyelet") or n in ("button", "archbind",
                                       "billseam"):
        return trim
    return crown


def materials():
    cloth = HS.pbr_textured("ApparelCloth", ATLAS, roughness=0.88)
    trim = HS.pbr_textured("ApparelTrim", ATLAS, roughness=0.42)
    return cloth, trim


def uv_two_cell(obj, top_cell, bot_cell):
    """The bill's underside is never the colour of its top. One object, two
    cells, chosen per face off the face normal."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.20, island_margin=0.015)
    bpy.ops.object.mode_set(mode="OBJECT")
    uv = obj.data.uv_layers.active
    M = 0.06
    for poly in obj.data.polygons:
        cell = bot_cell if poly.normal.z < -0.25 else top_cell
        cx = cell % ATLAS_COLS
        cy = ATLAS_ROWS - 1 - cell // ATLAS_COLS
        for li in poly.loop_indices:
            u, v = uv.data[li].uv
            u = M + min(1.0, max(0.0, u)) * (1.0 - 2 * M)
            v = M + min(1.0, max(0.0, v)) * (1.0 - 2 * M)
            uv.data[li].uv = ((cx + u) / ATLAS_COLS, (cy + v) / ATLAS_ROWS)
    obj["explicit_uv"] = True
    return obj


# ---------------------------------------------------------------------------
# the assertions
#
# Pairs where one part is deliberately inside another. Every one is a decision
# on the record; anything NOT here that interpenetrates is a build failure.

def deep_pairs():
    allow = [("brim", "sweatband"), ("brim", "hem"), ("brim", "billseam"),
             ("crest", "crest_edge"), ("sweatband", "hem"),
             ("billseam", "hem"), ("billseam", "sweatband"),
             ("archbind", "hem"), ("archbind", "sweatband"),
             ("archbind", "strap_pegs"), ("archbind", "strap_holes")]
    for j in range(PANELS):
        allow += [(f"panel{j}", "sweatband"), (f"panel{j}", "brim"),
                  (f"panel{j}", "hem"), (f"panel{j}", "crest"),
                  (f"panel{j}", "crest_edge"), (f"panel{j}", "billseam"),
                  (f"panel{j}", "strap_pegs"), (f"panel{j}", "strap_holes")]
        for k in range(PANELS):
            allow.append((f"panel{j}", f"seam{k}"))
        allow.append((f"seam{j}", "brim"))
        allow.append((f"seam{j}", "billseam"))
        allow.append((f"seam{j}", "hem"))
        allow.append((f"seam{j}", "archbind"))
        allow.append((f"panel{j}", "archbind"))
        allow.append((f"seam{j}", "sweatband"))
        allow.append((f"seam{j}", "button"))
        allow.append((f"seam{j}", "crest"))
        allow.append((f"seam{j}", "crest_edge"))
        allow.append((f"panel{j}", "button"))
        for e in range(EYELETS_PER_PANEL):
            for k in range(PANELS):
                allow.append((f"panel{k}", f"eyelet{j}_{e}"))
    for i in range(6):
        allow += [(f"peg{i}", "strap_pegs"), (f"peg{i}", "strap_holes")]
    allow.append(("strap_pegs", "strap_holes"))
    return allow


def check(parts):
    mesh = {k: v for k, v in parts.items()
            if hasattr(v, "data") and getattr(v.data, "vertices", None)}
    HS.assert_all_one_piece(mesh, "cap v2: every part is one piece")
    HS.assert_assembly(mesh, "cap v2: the assembly", allow=deep_pairs())


# ---------------------------------------------------------------------------


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    way = next((x.split("=", 1)[1] for x in args if x.startswith("way=")),
               "cream")
    views = int(next((x.split("=", 1)[1] for x in args
                      if x.startswith("views=")), "12"))
    suffix = "" if engine == "CYCLES" else "-eevee"
    tag = f"cap-{way}"

    H.reset_scene()
    H.set_engine(engine, samples=180 if engine == "CYCLES" else 96)
    cloth, trim = materials()
    parts = build(way)

    crown_cell, bill_cell, trim_cell = WAYS[way]
    for key, ob in parts.items():
        if key == "brim":
            uv_two_cell(ob, bill_cell, UNDERBRIM_CELL)
        elif ob.get("explicit_uv"):
            CL.cell_offset(ob, cell_for(key, way), ATLAS_COLS, ATLAS_ROWS)
        else:
            CL.texture_into_cell(ob, cell_for(key, way), ATLAS_COLS, ATLAS_ROWS)
        # The closure is the only moulded part on the cap, so it is the only
        # one on the glossier material. Everything else is cloth, whatever
        # colour cell it wears.
        hard = key.startswith("strap") or key.startswith("peg")
        ob.data.materials.append(trim if hard else cloth)

    check(parts)

    subject = [v for v in parts.values() if hasattr(v, "data")]
    lo, hi = H.bounds(subject)
    print(f"{tag}: TRIS {H.triangles(subject)} in {len(subject)} parts, "
          f"2 materials")
    print(f"  {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} x "
          f"{(hi.z - lo.z) * 1000:.0f} mm")

    centre, radius = H.subject_sphere(subject)
    LENS = 76.0
    dist = H.fit_distance(radius, LENS, res=(1000, 1000), margin=1.18)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    out = os.path.join(OUT_RENDER, way)
    tt = H.turntable(centre, dist, out, f"{tag}{suffix}", views=views,
                     elevation=14.0, lens=LENS, res=(1000, 1000))
    H.contact_sheet(tt, os.path.join(out, f"{tag}{suffix}-turntable.png"),
                    cols=4)

    # The named shots the review actually argues over. The reference set is
    # front / left / rear / right square-on, so the render set is too -- a
    # comparison you cannot line up is a comparison nobody makes.
    for label, az, el, lens, marg in (
            ("front", -90, 4, 82.0, 1.18),
            ("side", 0, 5, 82.0, 1.18),
            ("rear", 90, 9, 82.0, 1.18),
            ("threequarter", -132, 20, 76.0, 1.20),
            ("top", -90, 68, 76.0, 1.20)):
        # Framed off the PROJECTED extent, not the bounding sphere -- see
        # fit_view. Square-on, the sphere is more than twice the height of what
        # the camera actually sees, and the cap floated in a third of the frame.
        unit = H.orbit_position(Vector((0, 0, 0)), 1.0, az, el)
        d = H.fit_view(subject, centre, -unit, lens, res=(1200, 1200),
                       margin=marg)
        cam = H.camera(label, H.orbit_position(centre, d, az, el), centre,
                       lens=lens)
        H.render(cam, os.path.join(out, f"{tag}{suffix}-{label}.png"),
                 res=(1200, 1200))
        if label == "threequarter":
            H.silhouette(subject, cam,
                         os.path.join(out, f"{tag}{suffix}-silhouette.png"),
                         res=(1000, 1000))

    # and two close-ups, because the seams and the stitch rows are the claim
    # UNDERBRIM IS AIMED AT THE BILL, NOT AT THE CAP. Orbiting the subject
    # centre at -14 degrees put the camera level with the bill's tip, so the
    # frame named "underbrim" photographed the crown's interior through the base
    # opening and the bill's underside never appeared in it. The face split was
    # measured at 50/50 by area with a mean normal.z of -0.738, so the geometry
    # was right the whole time and the CAMERA was the thing reporting.
    for label, at, az, el, r, lens in (
            ("crown-detail", (0.0, 0.0, 0.078), -120, 34, 0.220, 72.0),
            ("brim-detail", (0.0, -0.105, -0.010), -100, 22, 0.200, 72.0),
            ("back-detail", (0.0, 0.075, 0.020), 96, 10, 0.220, 72.0),
            ("underbrim", (0.0, -0.075, -0.012), -90, -44, 0.300, 52.0),
            ("inside", (0.0, 0.020, 0.020), -78, -50, 0.330, 52.0)):
        c = Vector(at)
        cam = H.camera(label, H.orbit_position(c, r, az, el), c, lens=lens)
        H.render(cam, os.path.join(out, f"{tag}{suffix}-{label}.png"),
                 res=(1200, 1200))

    if "noexport" not in args:
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(GLB_DIR, f"apparel_cap_{way}.glb"))


if __name__ == "__main__":
    main()
