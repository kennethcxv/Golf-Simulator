"""APPAREL V2 — THE POLO, hung and folded.

Same rule as the cap: the shape comes from the PANELS. v1's hung polo was one
closed lens-section tube with a collar balanced on it, which is why it read as a
soft slab -- a tube has no side seam, no shoulder seam and no armhole, and those
three lines are most of what tells an eye it is a shirt.

WHAT THE REFERENCE SHOWS (ref/apparel, looked at at full size)

  polo-pattern.png     the panel set, plainly: a front, a back, two sleeves with
      ribbed cuffs, a collar with two points, a placket with buttons. Nothing
      else. Build those and the shape follows.

  polo-rail-shop.jpg   a dozen stacks on a shop shelf, and the most useful
      photograph in the set. A folded polo is WIDER THAN IT IS DEEP, about
      1.3:1. The collar lies splayed on top in a shallow wide V with a shadow
      under its fold. The sleeves fold back and read as two soft vertical
      ridges. Every single garment has a PRINTED SIZE BAND wrapped round one
      end -- it is on all twelve stacks and it is the strongest single cue that
      the thing is shop stock rather than laundry.

  polo-pique.jpg       the collar and placket at macro: the collar is a doubled
      band with a fine stitch line about 3 mm in from its edge, the placket is a
      separate strip with a stitched BOX at its bottom end, and the buttons sit
      in slit buttonholes.

  polo-stack-shop.jpg  the fold's front edge is a row of soft lips that do NOT
      line up, and the stack leans.

    blender --factory-startup -b --python tools/blender/hero/build_polo.py -- \\
        [cycles] [only=hung|folded] [way=fairway|...] [views=12] [noexport]
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
OUT_RENDER = os.path.join(REPO, "qa", "hero", "apparel_v2", "polo")
GLB_DIR = os.path.join(REPO, "Assets", "models", "hero")
ATLAS = os.path.join(REPO, "Assets", "models", "hero", "textures",
                     "apparel_atlas.png")
ATLAS_COLS, ATLAS_ROWS = 6, 5

# ---------------------------------------------------------------------------
# the hung polo, in metres, off a men's medium

SH_HALF = 0.2250               # half the shoulder width
Z_SH = 0.0000                  # the shoulder line; everything hangs below it
LENGTH = 0.6350                # shoulder to hem
NECK_HALF = 0.3300             # the neck opening, in u (fraction of the panel)
SHOULDER_DROP = 0.0360         # how far the shoulder seam falls to its point
SCOOP_FRONT = 0.0235           # a polo's neckline is nearly LEVEL; the
SCOOP_BACK = 0.0200            # opening is the PLACKET slit below it, not a
                               # deeper scoop. Cutting the front 64 mm lower
                               # left the collar with nothing level to sit on.
CLOTH = 0.0022

# The body is WIDER below the armhole than at the shoulder, which is the line
# that makes a hung shirt read as a hung shirt: the sleeves stand out above a
# narrower shoulder and the body falls away underneath.
WIDTH_PROFILE = ((0.00, 1.000), (0.14, 1.135), (0.52, 1.058), (1.00, 1.215))
DEPTH_CHEST = 0.0830
DEPTH_HEM = 0.0760


def _profile(table, v):
    for i in range(len(table) - 1):
        a, b = table[i], table[i + 1]
        if v <= b[0]:
            t = (v - a[0]) / (b[0] - a[0]) if b[0] > a[0] else 0.0
            t = t * t * (3.0 - 2.0 * t)
            return a[1] + (b[1] - a[1]) * t
    return table[-1][1]


def top_z(u, front):
    """The panel's top edge: shoulder seam outboard of the neck, scoop inboard.

    Two separate curves meeting at |u| = NECK_HALF, which is where a shoulder
    seam actually ends on a shirt.
    """
    a = abs(u)
    if a >= NECK_HALF:
        t = (a - NECK_HALF) / (1.0 - NECK_HALF)
        return Z_SH - SHOULDER_DROP * (t ** 1.25)
    scoop = SCOOP_FRONT if front else SCOOP_BACK
    return Z_SH - scoop * (1.0 - (a / NECK_HALF) ** 2) ** 0.85


def body_panel(front, u, v, seed=0.0):
    """One panel of the body. u runs side seam to side seam, v top to hem.

    y is zero at u = +/-1 by construction, so the two panels MEET along the side
    seams instead of being two halves of one tube that never had a seam.
    """
    w = SH_HALF * _profile(WIDTH_PROFILE, v)
    x = u * w
    # The top edge's shape must NOT reach the hem. Cloth hanging free forgets
    # the line it was cut on within a hand's width, and carrying top_z all the
    # way down meant the neck scoop, the shoulder drop and the hanger peak all
    # arrived at the bottom edge and read as a scalloped wave. It was fixed
    # twice as if it were a hem shape before it was traced to its source.
    settle = min(1.0, v / 0.32) ** 1.15
    top = top_z(u, front) * (1.0 - settle)
    z = top - LENGTH * v
    # THE HANGER'S ENDS are under the cloth at |u| ~ 0.85, so the shoulder line
    # peaks over them -- but only near the shoulder. Putting this in top_z()
    # instead carried both peaks the whole length of the panel and came out as
    # a four-humped wave along the hem, which read as a scallop and was fixed
    # twice as if it were one.
    z += 0.0060 * math.exp(-(((abs(u) - 0.845) / 0.145) ** 2)) * max(
        0.0, 1.0 - v / 0.22) ** 1.3
    # the hem dips a little at the sides, as a shirt hem does
    # a polo's hem is straight, with a small drop at the side vents
    z -= 0.0090 * (abs(u) ** 3.0) * (v ** 2.2)
    # A shirt on a hanger is nearly FLAT across the shoulders and only opens
    # out below the chest. Bowing to full depth at v=0 made the neck hole
    # 116 mm front-to-back and left the collar floating 28.9 mm off the
    # panel -- which the assembly check caught before any render did.
    # ...but the NECK is held open by the collar inside it, so the separation
    # is a function of u as well as v: wide at the centre back and front where
    # the collar sits, nearly nil out at the shoulder points where the cloth
    # lies over the hanger bar.
    open_up = 0.30 + 0.70 * min(1.0, (v / 0.34)) ** 1.4
    if abs(u) < NECK_HALF:
        open_up += 0.58 * (1.0 - (abs(u) / NECK_HALF) ** 2) * max(
            0.0, 1.0 - v / 0.22)
    depth = (DEPTH_CHEST + (DEPTH_HEM - DEPTH_CHEST) * v) * open_up
    bow = math.cos(u * math.pi * 0.5) ** 0.72
    # cloth hanging off a hanger falls in soft vertical folds
    fold = 0.0042 * math.sin(u * 5.2 + seed) * min(1.0, v * 2.6)
    y = (depth * bow + fold) * (-1.0 if front else 1.0)
    return Vector((x, y, z))


# ---------------------------------------------------------------------------
# the collar
#
# CL.collar could not do this one. It sweeps a four-row section round a circle,
# which is fine for a standing band and wrong for a polo: a polo collar rises
# off the neckline as a STAND, folds over at a crest, and falls outward and
# down to a free edge that ends in two points. Three separate things, and the
# fold crest is the one your eye actually reads.
#
# So it is a surface over (s along the neckline, t across the collar), and the
# neckline it follows is measured off the panels rather than assumed to be a
# circle -- which is what left the first attempt floating 28.9 mm clear.

GAP_U = 0.085                  # the points stop this far short of centre front
COLLAR_PROFILE = ((0.00, 0.0000, 0.0000),
                  (0.22, 0.0042, 0.0128),
                  (0.44, 0.0108, 0.0208),    # the fold crest
                  (0.62, 0.0208, 0.0172),
                  (0.82, 0.0312, 0.0082),
                  (1.00, 0.0398, -0.0038))   # the free edge, below the crest


def _interp2(table, t):
    for i in range(len(table) - 1):
        a, b = table[i], table[i + 1]
        if t <= b[0]:
            k = (t - a[0]) / (b[0] - a[0]) if b[0] > a[0] else 0.0
            k = k * k * (3.0 - 2.0 * k)
            return (a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k)
    return table[-1][1], table[-1][2]


def neck_path(s):
    """The neckline, from the right collar point round the back to the left."""
    run = NECK_HALF - GAP_U
    back = 2.0 * NECK_HALF
    d = s * (2.0 * run + back)
    if d <= run:
        return body_panel(True, GAP_U + d, 0.0)
    d -= run
    if d <= back:
        return body_panel(False, NECK_HALF - d, 0.0)
    return body_panel(True, -NECK_HALF + (d - back), 0.0)


def collar_surface(s, t):
    q = neck_path(s)
    n = Vector((q.x, q.y, 0.0))
    n = n.normalized() if n.length > 1e-6 else Vector((0.0, -1.0, 0.0))
    out, up = _interp2(COLLAR_PROFILE, t)
    # the two ends ARE the collar points: they splay wider and fall lower
    tip = max(0.0, 1.0 - min(s, 1.0 - s) / 0.17) ** 1.7
    out *= 1.0 + 0.58 * tip
    up -= 0.0245 * tip * (t ** 1.2)
    return q + n * out + Vector((0.0, 0.0, up))


def side_u(t01):
    """Panel u from a uniform sample, CLUSTERED AT THE SIDE SEAMS.

    The hung polo's side "reads as a hard vertical crease where the panels
    meet" -- and the section is not actually creased. y = D*cos(u*pi/2)**0.72
    arrives at the seam with an infinite slope, which is a smooth vertical
    tangent: the two panels meet ROUNDED. The crease is in the SAMPLING.

    With u uniform, the last step runs from u = 0.9 to 1.0, and over that step
    the depth falls from 25.4% to zero -- 21 mm of the section collapsed into
    one facet, sitting almost perpendicular to the one before it. That is the
    hard line, and no amount of reshaping the section removes it.

    sin() clusters the samples where the curve is tight: the last step becomes
    1.2% of u instead of 10%, eight times denser exactly at the turn. Same
    lesson as the collar's points -- a tight curve needs vertices ON it.
    """
    return math.sin((-1.0 + 2.0 * t01) * math.pi * 0.5)


def build_hung(p, way):
    # NU up from 21: sin() spends its samples at the seams, so the centre goes
    # from 0.10 to 0.157 of u per step and the placket sits on the centre.
    NU, NV = 25, 19
    for front in (True, False):
        key = "front" if front else "back"
        seed = 0.0 if front else 2.1
        surf = CL.grid_surface(
            f"Polo_{key.capitalize()}",
            (lambda f, s: (lambda u, v: body_panel(f, side_u(u), v, s)))(front, seed),
            nu=NU, nv=NV, smooth=True)
        p[key] = CL.smooth_by_angle(CL.thicken(surf, CLOTH, offset=-1.0
                                               if front else 1.0))

    # THE SEAMS. A side seam and a shoulder seam are the two lines v1 could not
    # have, because a tube has neither.
    for side, sgn in (("L", -1.0), ("R", 1.0)):
        pts, nrms = [], []
        for i in range(15):
            v = 0.030 + 0.955 * i / 14.0
            q = body_panel(True, sgn * 1.0, v)
            pts.append(q)
            nrms.append(Vector((sgn, 0.0, 0.0)))
        p[f"seam{side}"] = CL.framed_sweep(f"Polo_Seam{side}", pts, nrms,
                                           0.0030, 0.0022, sides=6, taper=2)
        pts, nrms = [], []
        for i in range(11):
            u = sgn * (NECK_HALF + (0.985 - NECK_HALF) * i / 10.0)
            q = Vector((u * SH_HALF, 0.0, top_z(u, True) + 0.0008))
            pts.append(q)
            nrms.append(Vector((0.0, 0.0, 1.0)))
        p[f"shoulder{side}"] = CL.framed_sweep(
            f"Polo_Shoulder{side}", pts, nrms, 0.0060, 0.0018, sides=6, taper=2)

    # sleeves off the shoulder points, with ribbed cuffs
    for side, sgn in (("L", -1.0), ("R", 1.0)):
        root = Vector((sgn * SH_HALF * 0.90, 0.0, Z_SH - SHOULDER_DROP * 0.72))
        d = Vector((sgn * 0.86, 0.0, -0.52)).normalized()
        p[f"sleeve{side}"] = CL.sleeve_from_body(
            f"Polo_Sleeve{side}", root, d, 0.1980, 0.0730, 0.0605,
            droop=0.20, sides=16, steps=9, seam_in=0.0180, flat=0.56)
        # THE ARMHOLE. A sleeve that simply emerges from a body has no seam,
        # and the join is the line that says the sleeve was sewn on.
        side_v = Vector((0.0, 0.0, 1.0)).cross(d).normalized()
        upv = d.cross(side_v).normalized()
        pts, nrms = [], []
        NA = 17
        for i in range(NA):
            ang = 2.0 * math.pi * i / NA
            r = 0.0715
            q = root + side_v * (math.cos(ang) * r) + upv * (
                math.sin(ang) * r * 0.56)
            pts.append(q)
            nrms.append((q - root).normalized())
        p[f"armhole{side}"] = CL.framed_sweep(
            f"Polo_Armhole{side}", pts, nrms, 0.0026, 0.0018, closed=True,
            sides=6)
        # THE CUFF HAS TO SIT ON THE SLEEVE, NOT PAST THE END OF IT. At
        # d*0.1950 with a 17.5 mm band it reached d*0.2038, while the sleeve's
        # closed tip stops at d*0.1868 -- so the ring stood 17 mm proud of the
        # cloth and you looked straight into a dark cavity. That is the "sleeve
        # ends in a flat disc" fault: not the sleeve's cap at all, but a cuff
        # hung off the end of it like a napkin ring. Centred on the sleeve's
        # last full ring now, with the closed tip coming through it.
        end = root + d * 0.1800
        end.z -= 0.0062
        p[f"cuff{side}"] = CL.ribbed_ring(f"Polo_Cuff{side}", end, d,
                                          0.0608, 0.0175, ribs=22, depth=0.0019)

    # the collar: one band round the neck with a V left open at the front
    NS, NT = 49, 7
    surf = CL.grid_surface("Polo_Collar", collar_surface, nu=NS, nv=NT,
                           smooth=True)
    p["collar"] = CL.smooth_by_angle(CL.thicken(surf, 0.0017, offset=0.0), 50.0)
    # the topstitch that runs round a collar's free edge
    pts, nrms = [], []
    for i in range(NS):
        sv = i / (NS - 1.0)
        q = collar_surface(sv, 0.885)
        nx = (collar_surface(sv, 0.885) - collar_surface(sv, 0.70))
        pts.append(q)
        nrms.append(Vector((0.0, 0.0, 1.0)) if nx.length < 1e-9
                    else Vector((0.0, 0.0, 1.0)))
    p["collar_stitch"] = CL.framed_sweep("Polo_CollarStitch", pts, nrms,
                                         0.0007, 0.0006, sides=4, taper=2)

    # THE PLACKET, with the stitched box at its foot the macro shows
    y_front = body_panel(True, 0.0, 0.10).y
    top = top_z(0.0, True)
    path = [Vector((0.0, y_front - 0.0016 - 0.0009 * k,
                    top + 0.0060 - 0.0175 * k)) for k in range(11)]
    p["placket"] = CL.strip("Polo_Placket", path, 0.0175, 0.0026, sides=8)
    box = path[-1]
    p["placket_box"] = CL.framed_sweep(
        "Polo_PlacketBox",
        [box + Vector((0.0175, 0.0, 0.0)), box + Vector((0.0175, 0.0, -0.0110)),
         box + Vector((-0.0175, 0.0, -0.0110)), box + Vector((-0.0175, 0.0, 0.0))],
        [Vector((0, -1, 0))] * 4, 0.0016, 0.0011, closed=True, sides=5)
    for k, t in enumerate((0.16, 0.52)):
        q = path[0].lerp(path[-1], t)
        p[f"button{k}"] = CL.stud(f"Polo_Button{k}", q + Vector((0, -0.0022, 0)),
                                  Vector((0, -1, 0)), 0.0062, 0.0030, sides=16)

    # THE HEM, as one closed loop: down the front, back along the back. The
    # first version walked u = cos(a) and switched panels at the sides, which
    # put a zigzag right across the bottom of every frame.
    pts, nrms = [], []
    NH = 64
    for i in range(NH):
        t = i / NH
        if t < 0.5:
            u = -0.995 + 2.0 * 0.995 * (t / 0.5)
            q = body_panel(True, u, 0.992)
            n = Vector((q.x, q.y * 2.4, 0.0)).normalized()
        else:
            u = 0.995 - 2.0 * 0.995 * ((t - 0.5) / 0.5)
            q = body_panel(False, u, 0.992)
            n = Vector((q.x, q.y * 2.4, 0.0)).normalized()
        pts.append(q)
        nrms.append(n)
    p["hem"] = CL.framed_sweep("Polo_Hem", pts, nrms, 0.0078, 0.0019,
                               closed=True, sides=6, square=0.82)

    # the chest badge, shaped and curved on to the front panel like the cap's
    NUC, NVC = 9, 9

    def crest(u, v):
        s = (-1.0 + 2.0 * u) * (1.0 - 0.10 * (1.0 - v))
        uu = -0.30 + s * 0.115
        vv = 0.155 + v * 0.072
        q = body_panel(True, uu, vv)
        return Vector((q.x, q.y - 0.0013, q.z))

    surf = CL.grid_surface("Polo_Badge", crest, nu=NUC, nv=NVC, smooth=True)
    # The badge printed PINE HILLS backwards, and flipping u did NOT fix it:
    # the mirroring came from solidify offset=+1, which puts the reversed
    # copy of the surface outermost so the face you see is the back of the
    # quad. offset=-1 keeps the original outside, exactly as the cap does.
    CL.grid_uv(surf, NUC, NVC, flip_v=True)
    p["badge"] = CL.thicken(surf, 0.0009, offset=-1.0)

    # the hanger
    body, hook = CL.hanger("Polo_Hanger", (0.0, 0.0, Z_SH + 0.0075),
                           halfw=SH_HALF * 0.86, drop=0.0330)
    p["hanger"], p["hook"] = body, hook
    return p


# ---------------------------------------------------------------------------
# the folded polo
#
# 1.3:1, wider than deep, off the rail photograph. v1 used 305 x 238, which is
# 1.28:1 and was never the problem -- the problem was that everything ON it was
# soft. This one gets the collar, the placket, the two sleeve ridges and the
# printed size band, and the band is the cue the reference has twelve of.

FOLD = (0.3080, 0.2360, 0.0450)


# SIX PLIES, NOT FOUR. Four in 45 mm makes each U-turn a 22 mm sausage and the
# front edge reads as two fat rolls; every folded polo in polo-rail-shop.jpg
# shows four to six THIN layers.
LEAVES = 6


def build_folded(p, way):
    w, d, h = FOLD
    # v3: ONE piece of cloth, folded, not a stack of separate pillows.
    p.update(CL.folded_ribbon("PoloFold", (0, 0, 0), FOLD, plies=LEAVES,
                              sag=0.0032, crease=0.0038, seed=0.7, wander=1.7))
    body = p["cloth"]
    # the ribbon hands out its own top surface; top_z's nearest-vertex answer
    # can land on the ply below and bury whatever is being placed
    top_at = p.pop("top_at")

    # the two sleeve folds, as ridges under the top leaf
    for k, sx in ((0, -1.0), (1, 1.0)):
        x = sx * w * 0.298
        z = top_at(x, 0.0)
        p[f"sleeve_fold{k}"] = CL.fold_line(
            f"PoloFold_Sleeve{k}", (x, -d * 0.40, z - 0.0008),
            (x + sx * 0.0060, d * 0.40, z - 0.0014), 0.0062, sides=9)

    # THE COLLAR, splayed flat with its points on the body
    cz = top_at(0.0, d * 0.30)
    # lift was 16.5 mm, which stood the whole band up off the shirt and was
    # most of why it read as a handle. A collar pressed under three more
    # garments is a few millimetres proud, no more, and 6.4 mm of thickness on
    # a doubled knit band was about twice life.
    p["collar"] = CL.collar_flat("PoloFold_Collar", (0.0, d * 0.300, cz),
                                 halfw=0.0570, back=0.0300, forward=0.0330,
                                 spread=1.66, reach=0.0430, thick=0.0034,
                                 lift=0.0062, sides=41, rows=8)

    # The placket runs OUT OF THE COLLAR'S V, with its two buttons. It used to
    # start 52 mm forward of the notch, so it read as a luggage tag lying on
    # the shirt rather than the opening the collar sits on either side of. It
    # starts under the collar now and its top end is hidden by it.
    top = top_at(0.0, d * 0.16)
    path = [Vector((0.0, 0.0800 - 0.0214 * k, top + 0.0012 - 0.0002 * k))
            for k in range(8)]
    p["placket"] = CL.strip("PoloFold_Placket", path, 0.0158, 0.0016, sides=8)
    for k, t in enumerate((0.24, 0.52)):
        q = path[0].lerp(path[-1], t)
        p[f"button{k}"] = CL.stud(f"PoloFold_Button{k}",
                                  q + Vector((0, 0, 0.0012)),
                                  Vector((0, 0, 1)), 0.0056, 0.0032, sides=14)

    # THE SIZE BAND. A printed paper band wrapped round one end of the
    # garment, on every stack in the reference.
    #
    # The first attempt built the path twice -- the second loop overwrote the
    # first -- and the surviving one put the band on a semicircular arc through
    # the air, so it rendered as a bag handle looped over the corner. It is a
    # band lying ON the cloth: down the front face, across the top, down the
    # back face, and it follows the garment's own surface the whole way.
    # THE BAND MUST LIE ON THE CLOTH, and the first two attempts had it
    # bridging: the top run was sampled off the garment but the wrap jumped
    # straight to a fixed height at y = +/-d/2, so where the leaf rolls away
    # under it the band carried on flat and stood off in the air. It read as a
    # plastic strap over the top rather than a paper band round it.
    #
    # So the top run is sampled across the part of the leaf that HAS a top
    # surface, and the turn down each face starts from wherever that run
    # actually ended.
    bx = w * 0.320
    NTOP = 16
    ys = [-d * 0.42 + (d * 0.84) * (i / (NTOP - 1.0)) for i in range(NTOP)]
    zs = [top_at(bx, y) + 0.0006 for y in ys]
    # top_z answers with the NEAREST VERTEX, so walking a straight line across
    # a polar grid the answer can jump a ring and bite a step out of the band's
    # edge. One pass takes the step out; more than that flattens the very
    # conformance this is for.
    for i in range(1, NTOP - 1):
        zs[i] = (zs[i - 1] + 2.0 * zs[i] + zs[i + 1]) * 0.25

    # The turn down each face has to clear the WIDEST leaf at this x, not a
    # nominal d/2 -- each leaf wanders by the better part of a centimetre and
    # the band was cutting through two of them.
    leaves = [p["cloth"]]
    y_front = CL.edge_y(leaves, bx, -1.0) - 0.0018
    y_back = CL.edge_y(leaves, bx, +1.0) + 0.0018

    # AN EXPLICIT L, not a blended curve. Easing y and z together sent the band
    # diagonally across the corner, and a diagonal there passes straight
    # through the second leaf -- which is what bit that notch out of it. Paper
    # goes out flat to past the widest ply and only then turns down, so the
    # band stays at the top height until it is clear of everything and drops
    # vertically after that. Nothing has to be tuned for it to miss.
    def wrap(y_face, y_top, z_top, sign):
        return [Vector((bx, y_face, h * 0.30)),
                Vector((bx, y_face, h * 0.70)),
                Vector((bx, y_face, z_top - 0.0035)),
                Vector((bx, y_face - sign * 0.0055, z_top + 0.0008)),
                Vector((bx, y_top, z_top))]

    band = list(wrap(y_front, ys[0], zs[0], -1.0))
    band += [Vector((bx, y, z)) for y, z in zip(ys, zs)][1:-1]
    back = wrap(y_back, ys[-1], zs[-1], +1.0)
    back.reverse()
    band += back
    # THE NORMAL COMES OFF THE PATH, not off a guess about which face we are
    # on. Handing the turn a flat (0, 1, 0) put the normal 43 degrees from the
    # tangent -- the band is turning down and running backwards at the same
    # time -- and `framed_sweep`'s frame all but collapsed, so the band came
    # out with a twist in it at the corner. This is the SAME fault as the hung
    # polo's hem band at its two side turns, and it is on record there.
    # The path is planar in x, so the in-plane perpendicular is exact.
    nrms = []
    for i in range(len(band)):
        tan = band[min(i + 1, len(band) - 1)] - band[max(i - 1, 0)]
        if tan.length < 1e-9:
            tan = Vector((0.0, 1.0, 0.0))
        tan.normalize()
        nrms.append(Vector((0.0, -tan.z, tan.y)).normalized())
    p["size_band"] = CL.framed_sweep("PoloFold_Band", band, nrms,
                                     0.0132, 0.0007, sides=6, square=0.88)
    return p


# ---------------------------------------------------------------------------
# materials and cells

WAYS = {
    "fairway": (2, 14),
    "cream": (11, 14),
    "navy": (0, 12),
    "sky": (3, 15),
    "coral": (7, 17),
}
CHEST_CELL, BADGE_CELL, RIB_CELL, TRIM_CELL = 18, 20, 22, 23


def cell_for(part, way):
    base, trim = WAYS[way]
    n = part.lower()
    if n == "badge":
        return CHEST_CELL
    if n in ("hanger", "hook", "size_band"):
        return TRIM_CELL
    if n.startswith("button"):
        return TRIM_CELL
    # A POLO'S COLLAR AND PLACKET ARE SELF-FABRIC. Putting them on the trim
    # cell made both a good bit darker than the body, so the collar read as a
    # dark bib applied to the shirt and the placket as a tag lying on it --
    # both of them separate objects rather than parts of one garment. Every
    # polo in polo-rail-shop.jpg has its collar in the body colour. The ribbed
    # cuffs keep the trim cell; on those the contrast is real.
    if n.startswith("cuff"):
        return trim
    return base


def materials():
    cloth = HS.pbr_textured("ApparelCloth", ATLAS, roughness=0.88)
    trim = HS.pbr_textured("ApparelTrim", ATLAS, roughness=0.42)
    return cloth, trim


DEEP = {
    "hung": [("front", "back"), ("front", "collar"), ("back", "collar"),
             ("collar", "collar_stitch"), ("front", "collar_stitch"),
             ("back", "collar_stitch"), ("collar_stitch", "hanger"),
             ("front", "placket"), ("front", "placket_box"),
             ("placket", "placket_box"), ("front", "badge"),
             ("front", "hem"), ("back", "hem"), ("front", "hanger"), ("back", "hanger"), ("hanger", "hook"),
             ("collar", "hanger"), ("collar", "hook"),
             ("front", "hook"), ("back", "hook")]
    + [(b, f"{s}{k}") for b in ("front", "back")
       for s in ("seam", "shoulder", "sleeve") for k in ("L", "R")]
    + [(f"sleeve{k}", f"seam{k}") for k in ("L", "R")]
    + [(f"sleeve{k}", f"shoulder{k}") for k in ("L", "R")]
    + [(f"sleeve{k}", f"cuff{k}") for k in ("L", "R")]
    + [(b, f"armhole{k}") for b in ("front", "back") for k in ("L", "R")]
    + [(f"sleeve{k}", f"armhole{k}") for k in ("L", "R")]
    + [(f"seam{k}", f"armhole{k}") for k in ("L", "R")]
    + [(f"shoulder{k}", f"armhole{k}") for k in ("L", "R")]
    + [("hanger", f"armhole{k}") for k in ("L", "R")]
    + [(f"sleeve{k}", "hanger") for k in ("L", "R")]
    + [(f"shoulder{k}", "collar") for k in ("L", "R")]
    + [(f"shoulder{k}", "hanger") for k in ("L", "R")]
    + [(f"seam{k}", "hem") for k in ("L", "R")]
    + [("placket", "collar"), ("placket", "button0"), ("placket", "button1"),
       ("collar", "button0"), ("placket", "collar_stitch")],
    # NOTE what is NOT here: no (leafI, leafJ) pair. The leaves are the whole
    # point of the rebuild and they have to stand clear of each other with air
    # between them, so if two of them touch this check is meant to fail.
    "folded": [("collar", "placket"), ("placket", "button0"),
               ("placket", "button1"), ("collar", "sleeve_fold0"),
               ("collar", "sleeve_fold1"),
               ("size_band", "sleeve_fold1"), ("size_band", "sleeve_fold0")]
    + [("cloth", o)
       for o in ("collar", "placket", "size_band", "button0", "button1",
                 "sleeve_fold0", "sleeve_fold1")],
}

STATES = {"hung": build_hung, "folded": build_folded}


def check(name, parts):
    mesh = {k: v for k, v in parts.items()
            if hasattr(v, "data") and getattr(v.data, "vertices", None)}
    HS.assert_all_one_piece(mesh, f"polo-{name}: every part is one piece")
    HS.assert_assembly(mesh, f"polo-{name}: the assembly", allow=DEEP[name])
    # v3: the plies are one surface now, so they cannot lace through each
    # other -- there is nothing left for assert_leaves_clear to police.


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    only = next((x.split("=", 1)[1] for x in args if x.startswith("only=")), "")
    way = next((x.split("=", 1)[1] for x in args if x.startswith("way=")),
               "fairway")
    views = int(next((x.split("=", 1)[1] for x in args
                      if x.startswith("views=")), "8"))
    suffix = "" if engine == "CYCLES" else "-eevee"

    for name in [k for k in STATES if not only or k == only]:
        H.reset_scene()
        H.set_engine(engine, samples=180 if engine == "CYCLES" else 96)
        cloth, trim = materials()
        parts = STATES[name]({}, way)
        for key, ob in parts.items():
            c = cell_for(key, way)
            if ob.get("explicit_uv"):
                CL.cell_offset(ob, c, ATLAS_COLS, ATLAS_ROWS)
            else:
                CL.texture_into_cell(ob, c, ATLAS_COLS, ATLAS_ROWS)
            ob.data.materials.append(trim if c == TRIM_CELL else cloth)
        check(name, parts)

        subject = [v for v in parts.values() if hasattr(v, "data")]
        lo, hi = H.bounds(subject)
        tag = f"polo-{name}-{way}"
        print(f"{tag}: TRIS {H.triangles(subject)} in {len(subject)} parts, "
              f"2 materials")
        print(f"  {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} x "
              f"{(hi.z - lo.z) * 1000:.0f} mm")

        centre, radius = H.subject_sphere(subject)
        H.studio(center=centre, scale=radius)
        H.backdrop(center=centre, scale=radius)
        out = os.path.join(OUT_RENDER, name)
        dist = H.fit_distance(radius, 76.0, res=(1000, 1000), margin=1.18)
        tt = H.turntable(centre, dist, out, f"{tag}{suffix}", views=views,
                         elevation=12.0, lens=76.0, res=(1000, 1000))
        H.contact_sheet(tt, os.path.join(out, f"{tag}{suffix}-turntable.png"),
                        cols=4)
        for label, az, el, lens in (("front", -90, 2, 82.0),
                                    ("side", 0, 4, 82.0),
                                    ("rear", 90, 4, 82.0),
                                    ("threequarter", -134, 16, 76.0),
                                    ("top", -90, 66, 76.0)):
            unit = H.orbit_position(Vector((0, 0, 0)), 1.0, az, el)
            d = H.fit_view(subject, centre, -unit, lens, res=(1200, 1200),
                           margin=1.16)
            cam = H.camera(label, H.orbit_position(centre, d, az, el), centre,
                           lens=lens)
            H.render(cam, os.path.join(out, f"{tag}{suffix}-{label}.png"),
                     res=(1200, 1200))
            if label == "threequarter":
                H.silhouette(subject, cam,
                             os.path.join(out, f"{tag}{suffix}-silhouette.png"),
                             res=(1000, 1000))
        if "noexport" not in args:
            H.bake_gltf_axis(subject)
            H.export_glb(subject, os.path.join(
                GLB_DIR, f"apparel_polo_{name}_{way}.glb"))


if __name__ == "__main__":
    main()
