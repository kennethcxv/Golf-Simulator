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
LENGTH = 0.6900                # shoulder to hem
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
WIDTH_PROFILE = ((0.00, 1.000), (0.14, 1.130), (0.55, 1.088), (1.00, 1.164))
DEPTH_CHEST = 0.0580
DEPTH_HEM = 0.0500


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
    top = top_z(u, front)
    z = top - LENGTH * v
    # the hem dips a little at the sides, as a shirt hem does
    z += 0.0130 * (1.0 - abs(u) ** 1.6) * (v ** 2.4)
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


def build_hung(p, way):
    NU, NV = 21, 19
    for front in (True, False):
        key = "front" if front else "back"
        seed = 0.0 if front else 2.1
        surf = CL.grid_surface(
            f"Polo_{key.capitalize()}",
            (lambda f, s: (lambda u, v: body_panel(f, -1 + 2 * u, v, s)))(front, seed),
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
                                           0.0026, 0.0016, sides=6, taper=2)
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
        d = Vector((sgn * 0.93, 0.0, -0.37)).normalized()
        p[f"sleeve{side}"] = CL.sleeve_from_body(
            f"Polo_Sleeve{side}", root, d, 0.2050, 0.0700, 0.0570,
            droop=0.10, sides=16, steps=9, seam_in=0.0180)
        end = root + d * 0.2020
        p[f"cuff{side}"] = CL.ribbed_ring(f"Polo_Cuff{side}", end, d,
                                          0.0575, 0.0180, ribs=20, depth=0.0016)

    # the collar: one band round the neck with a V left open at the front
    # `height` in CL.collar is a BASE OFFSET, not the collar's height: the rows
    # stack a further `stand` on top of it, so height=0.062 built a collar
    # 87 mm tall -- a chef's toque standing clear of the neckline, which is why
    # it read as loose however wide it was made. Measured, not guessed.
    p["collar"] = CL.collar("Polo_Collar", (0.0, 0.0, Z_SH - 0.0180),
                            SH_HALF * NECK_HALF * 1.00, 0.0520,
                            0.0270, thickness=0.0070, sides=44,
                            point_drop=0.58, gap=0.74, fall=0.42)

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
        p[f"button{k}"] = CL.stud(f"Polo_Button{k}", q + Vector((0, 0.0010, 0)),
                                  Vector((0, -1, 0)), 0.0058, 0.0034, sides=14)

    # the hem, turned and stitched all the way round
    pts, nrms = [], []
    N = 56
    for i in range(N):
        a = 2.0 * math.pi * i / N
        u = math.cos(a)
        q = body_panel(math.sin(a) < 0.0, u, 0.988)
        pts.append(q)
        n = Vector((0.0, -1.0 if math.sin(a) < 0 else 1.0, 0.0))
        if abs(u) > 0.96:
            n = Vector((1.0 if u > 0 else -1.0, 0.0, 0.0))
        pts[-1] = q
        nrms.append(n)
    p["hem"] = CL.framed_sweep("Polo_Hem", pts, nrms, 0.0090, 0.0016,
                               closed=True, sides=6, square=0.80)

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


def build_folded(p, way):
    w, d, h = FOLD
    p["body"] = CL.folded("PoloFold_Body", (0, 0, 0), FOLD, leaves=4,
                          sag=0.0032, crease=0.0038, seed=0.7)

    # the two sleeve folds, as ridges under the top leaf
    for k, sx in ((0, -1.0), (1, 1.0)):
        x = sx * w * 0.298
        z = CL.top_z(p["body"], x, 0.0)
        p[f"sleeve_fold{k}"] = CL.fold_line(
            f"PoloFold_Sleeve{k}", (x, -d * 0.40, z - 0.0020),
            (x + sx * 0.0060, d * 0.40, z - 0.0026), 0.0062, sides=9)

    # THE COLLAR, splayed flat with its points on the body
    cz = CL.top_z(p["body"], 0.0, d * 0.30)
    p["collar"] = CL.collar_flat("PoloFold_Collar", (0.0, d * 0.300, cz),
                                 halfw=0.0570, back=0.0300, forward=0.0330,
                                 spread=1.66, reach=0.0330, thick=0.0064,
                                 lift=0.0165, sides=35, rows=7)

    # the placket running down out of the collar's V, with its two buttons
    top = CL.top_z(p["body"], 0.0, d * 0.16)
    path = [Vector((0.0, d * 0.16 - 0.0148 * k, top + 0.0016 - 0.0002 * k))
            for k in range(8)]
    p["placket"] = CL.strip("PoloFold_Placket", path, 0.0165, 0.0024, sides=8)
    for k, t in enumerate((0.14, 0.55)):
        q = path[0].lerp(path[-1], t)
        p[f"button{k}"] = CL.stud(f"PoloFold_Button{k}",
                                  q + Vector((0, 0, 0.0012)),
                                  Vector((0, 0, 1)), 0.0056, 0.0032, sides=14)

    # THE SIZE BAND. A printed paper band wrapped round one end of the garment,
    # on every stack in the reference. It is the difference between shop stock
    # and laundry, and no version of this garment has ever had one.
    bx = w * 0.330
    band = []
    NB = 26
    for i in range(NB):
        t = i / (NB - 1.0)
        ang = math.pi * t
        band.append(Vector((bx, -d * 0.5 - 0.004 + (d + 0.008) * t,
                            h * 0.5 + 0.0)))
    # wrap it: down the front, across the top, down the back
    band = []
    for i in range(NB):
        t = i / (NB - 1.0)
        a = math.pi * (t - 0.5)
        band.append(Vector((bx,
                            math.sin(a) * (d * 0.5 + 0.0055),
                            h * 0.5 - 0.0010 + math.cos(a) * 0.0 )))
    for i, q in enumerate(band):
        t = i / (NB - 1.0)
        edge = min(t, 1.0 - t)
        q.z = CL.top_z(p["body"], bx, q.y) + 0.0012 if edge > 0.055 else q.z
    p["size_band"] = CL.framed_sweep("PoloFold_Band", band,
                                     [Vector((0, 0, 1))] * NB,
                                     0.0180, 0.0011, sides=6, square=0.85,
                                     taper=2)
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
    if (n.startswith("button") or n.startswith("cuff")
            or n == "collar" or n.startswith("placket")):
        return trim
    return base


def materials():
    cloth = HS.pbr_textured("ApparelCloth", ATLAS, roughness=0.88)
    trim = HS.pbr_textured("ApparelTrim", ATLAS, roughness=0.42)
    return cloth, trim


DEEP = {
    "hung": [("front", "back"), ("front", "collar"), ("back", "collar"),
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
    + [(f"sleeve{k}", "hanger") for k in ("L", "R")]
    + [(f"shoulder{k}", "collar") for k in ("L", "R")]
    + [(f"shoulder{k}", "hanger") for k in ("L", "R")]
    + [(f"seam{k}", "hem") for k in ("L", "R")]
    + [("placket", "collar"), ("placket", "button0"), ("placket", "button1"),
       ("collar", "button0")],
    "folded": [("body", "collar"), ("body", "placket"), ("body", "size_band"),
               ("body", "sleeve_fold0"), ("body", "sleeve_fold1"),
               ("collar", "placket"), ("placket", "button0"),
               ("placket", "button1"), ("body", "button0"),
               ("body", "button1"), ("collar", "sleeve_fold0"),
               ("collar", "sleeve_fold1"), ("body", "sleeve_fold0"),
               ("size_band", "sleeve_fold1"), ("size_band", "sleeve_fold0")],
}

STATES = {"hung": build_hung, "folded": build_folded}


def check(name, parts):
    mesh = {k: v for k, v in parts.items()
            if hasattr(v, "data") and getattr(v.data, "vertices", None)}
    HS.assert_all_one_piece(mesh, f"polo-{name}: every part is one piece")
    HS.assert_assembly(mesh, f"polo-{name}: the assembly", allow=DEEP[name])


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
        if engine == "CYCLES" and "noexport" not in args:
            H.bake_gltf_axis(subject)
            H.export_glb(subject, os.path.join(
                GLB_DIR, f"apparel_polo_{name}_{way}.glb"))


if __name__ == "__main__":
    main()
