"""GOAL 27 REWORK, ITEM 1 — THE APPAREL. Actual garments, not boxes.

Reference (downloaded, and looked at, in ref/apparel):

  polo-folded-stack.jpg  a stack of folded polos on a shop table. The collar
                         splayed open on top, two white buttons, and a row of
                         soft lips down the front edge where the leaves end.
  polo-flat.jpg          a polo laid flat: collar stand and points, placket
                         width, ribbed cuffs, side vent at the hem.
  polo-hung-rack.jpg     folded polos by colour on a shelf, edges irregular.
  tee-folded.jpg         folded tees stacked -- no collar, so the read is the
                         print and the layered front lips.
  hoodie-hung.jpg        the hood is a fat soft roll standing above the
                         shoulders; drawcords hang on the chest; kangaroo
                         pocket is a band with a shadow at its top edge.
  trousers-stack.jpg     folded trousers: a FAT CYLINDRICAL ROLL at the fold
                         end, waistband and a welt pocket on top.
  cap.jpg                six panels with seams, a button at the apex, eyelets,
                         a stiff brim with a stitched border.

Eight meshes, two materials, one atlas. Colours are texture cells on a shared
material, per the brief -- a colourway must never cost a program.

    blender --factory-startup -b --python tools/blender/hero/build_apparel.py -- \
        [cycles] [only=polo|tee|hoodie|trousers|cap] [break=collar|hood|lips]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Quaternion, Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402
import cloth_lib as CL  # noqa: E402

REPO = os.getcwd()
OUT_RENDER = os.path.join(REPO, "qa", "hero", "apparel")
GLB_DIR = os.path.join(REPO, "Assets", "models", "hero")

# A folded polo measures about 300 x 240 x 50 mm on a shop table.
FOLD_POLO = (0.3050, 0.2380, 0.0520)
FOLD_TEE = (0.2900, 0.2260, 0.0430)
FOLD_HOOD = (0.3200, 0.2600, 0.0960)
FOLD_TROU = (0.3300, 0.2050, 0.0780)


# ---------------------------------------------------------------------------
# materials: TWO, shared by all eight meshes


ATLAS = os.path.join(REPO, "Assets", "models", "hero", "textures",
                     "apparel_atlas.png")

# The 24-cell atlas: 0-11 colourways, 12-17 their contrast partners, 18 chest
# roundel, 19 tee front, 20 sleeve badge, 21 cap monogram, 22 ribbing, 23 trim.
# ONE material for all of it -- a colourway must never cost a program.
ATLAS_COLS, ATLAS_ROWS = 6, 4
# Eight garments, eight different colourways: "a rail of eight identical navy
# garments is not a shop".
CELL = {"polo-folded": 2, "polo-hung": 0, "tee-folded": 11, "tee-hung": 1,
        "hoodie-folded": 6, "hoodie-hung": 9, "trousers-folded": 4, "cap": 5}
# each colourway's darker partner, for contrast trim
CONTRAST = {0: 12, 1: 13, 2: 14, 3: 15, 4: 16, 5: 17,
            6: 12, 7: 17, 8: 13, 9: 14, 10: 16, 11: 13}
CHEST_CELL, TEEFRONT_CELL, BADGE_CELL = 18, 19, 20
CAPMONO_CELL, RIB_CELL, TRIM_CELL = 21, 22, 23


def cell_for(part, garment):
    """Which atlas cell a PART wears. Contrast trim, prints and ribbing are all
    cells, not materials."""
    base = CELL[garment]
    n = part.lower()
    if "print" in n:
        return TEEFRONT_CELL if garment.startswith("tee") else CHEST_CELL
    if "badge" in n:
        return BADGE_CELL
    if "mono" in n:
        return CAPMONO_CELL
    if any(k in n for k in ("hanger", "hook", "tag")):
        return TRIM_CELL
    if any(k in n for k in ("buckle", "button")):
        # a covered button and a plastic buckle are the cap's own trim
        # colour, not white -- as white they read as studs
        return CONTRAST[base]
    if any(k in n for k in ("cuff", "collar", "neck_rib", "seam", "waistband",
                            "welt", "rib", "sweatband", "strap", "brim",
                            "stitch", "lip", "placket")):
        return CONTRAST[base]
    return base


def materials():
    """ONE cloth material for every garment, ONE trim material for the hardware.

    Rendered untextured, every one of these read as moulded plastic whatever
    its shape -- cloth breaks up light at a scale the eye reads at 18 inches,
    and a flat albedo has none of it.
    """
    cloth = HS.pbr_textured("ApparelCloth", ATLAS, roughness=0.88)
    trim = HS.pbr_textured("ApparelTrim", ATLAS, roughness=0.40)
    return cloth, trim


# ---------------------------------------------------------------------------
# the garments


def polo_folded(origin=(0, 0, 0), broken=""):
    """A folded polo. The collar is the asset -- see the reference."""
    ox, oy, oz = origin
    p = {}
    w, d, h = FOLD_POLO
    p["body"] = CL.folded("PoloFold_Body", (ox, oy, oz), FOLD_POLO,
                          leaves=3, sag=0.0030, crease=0.0034, seed=0.4)

    # the sleeve folded underneath shows as a soft ridge across the body
    p["sleeve_ridge"] = CL.fold_line(
        "PoloFold_SleeveRidge",
        (ox - w * 0.42, oy - d * 0.26, oz + h - 0.0040),
        (ox - w * 0.14, oy + d * 0.06, oz + h - 0.0052),
        radius=0.0125, sink=0.52)

    # the collar, splayed open at the back edge of the fold. Its base comes
    # from the MEASURED top face: the nominal fold height is above the sagged
    # surface, and a collar placed there sinks into the shirt.
    cz = CL.top_z(p["body"], ox + w * 0.03, oy + d * 0.20) + 0.0018
    if broken == "collar":
        # THE BROKEN VARIANT: the collar lifted clear of the shirt. It still
        # looks like a collar from directly above, which is how a detached one
        # ships.
        cz += 0.020
    p["collar"] = CL.collar_flat("PoloFold_Collar",
                                 (ox + w * 0.03, oy + d * 0.20, cz),
                                 # A 15 mm lift on a 6 mm section read as a
                                 # sausage laid across the shirt. A pressed
                                 # collar is WIDE and SHALLOW: half the lift,
                                 # two-thirds the thickness, more spread.
                                 halfw=w * 0.245, back=d * 0.160,
                                 forward=d * 0.150, spread=2.05,
                                 reach=d * 0.235, thick=0.0042, lift=0.0088)

    # placket and buttons, running forward out of the collar's V
    pl = []
    for s in range(9):
        t = s / 8.0
        pl.append(Vector((ox + w * 0.02 + 0.0025 * math.sin(t * 3),
                          oy + d * 0.16 - d * 0.44 * t,
                          oz + h + 0.0008 - 0.0010 * t)))
    p["placket"] = CL.strip("PoloFold_Placket", pl, 0.0092, 0.0030)
    for i, t in enumerate((0.26, 0.62)):
        p[f"button{i}"] = HS.cylinder(
            f"PoloFold_Button{i}",
            (ox + w * 0.02, oy + d * 0.16 - d * 0.44 * t,
             oz + h + 0.0034 - 0.0010 * t),
            0.0062, 0.0028, verts=14)

    # the chest logo, on the top face of the fold where a shopper sees it
    p["print"] = CL.decal(
        "PoloFold_Chest",
        (ox - w * 0.26, oy - d * 0.20,
         CL.top_z(p["body"], ox - w * 0.26, oy - d * 0.20) - 0.0006),
        (0, 0, 1), (0.0400, 0.0400))

    # the size tag, protruding from the right edge. MEASURED against the body,
    # not predicted: guessing put it 19.93 mm inside and then, re-guessed, clear
    # of the shirt entirely, and assert_assembly failed both.
    tag_hw = 0.0165
    ex = CL.edge_x(p["body"], oz + h * 0.50, oy - d * 0.10)
    p["tag"] = HS.box("PoloFold_Tag",
                      (ox + ex + tag_hw - 0.0030, oy - d * 0.10, oz + h * 0.50),
                      (tag_hw * 2, 0.0170, 0.0014))
    return p


def polo_hung(origin=(0, 0, 0), broken=""):
    ox, oy, oz = origin
    p = {}
    SH = oz + 0.3200
    p["hanger"], p["hook"] = CL.hanger("PoloHung_Hanger", (ox, oy, SH), halfw=0.0880,
                                          drop=0.0540, rod=0.0058)
    p["body"] = CL.draped("PoloHung_Body", SH - 0.0130, 0.2050, 0.2320,
                          0.3050, 0.0760, centre=(ox, oy), neck=0.0300,
                          shoulder_drop=0.0140)
    for side in (-1, 1):
        nm = "L" if side < 0 else "R"
        d = Vector((side * 0.58, 0, -0.815))
        p[f"sleeve{nm}"] = CL.sleeve_from_body(
            f"PoloHung_Sleeve{nm}",
            (ox + side * 0.0790, oy, SH - 0.0250), d, 0.1180, 0.0362, 0.0288,
            droop=0.10, cuff=0.10)
        # the armhole seam: what actually reads as "attached"
        p[f"seam{nm}"] = CL.ribbed_ring(
            f"PoloHung_Seam{nm}",
            (ox + side * 0.0790, oy, SH - 0.0250), d, 0.0364, 0.0060,
            ribs=1, depth=0.0004, sides=20)
        p[f"cuff{nm}"] = CL.ribbed_ring(
            f"PoloHung_Cuff{nm}",
            Vector((ox + side * 0.0790, oy, SH - 0.0250))
            + Vector(d).normalized() * 0.1105, d, 0.0296, 0.0130,
            ribs=16, depth=0.0013)
    # The collar wraps the NECK OPENING, which is well below the shoulder peaks:
    # placed level with the shoulders it stood 20 mm above the shirt and out the
    # back of it, and assert_assembly called it loose. Both numbers come from
    # the drape's own parameters now.
    neck_z = SH - 0.0130 - 0.0140 - 0.0300
    p["collar"] = CL.collar("PoloHung_Collar", (ox, oy - 0.0090, neck_z + 0.0235),
                            halfw=0.0505, depth=0.0245, height=0.0270,
                            thickness=0.0072, sink=0.0055, gap=0.70)
    # the placket rides HALF SUNK in the chest, at the surface the body actually
    # has at each height
    # The placket starts at the NECK LINE, not at the shoulders: above the neck
    # line there is no shirt at x=0, only the hollow between the shoulders.
    pl, R = [], 0.0058
    for s in range(9):
        t = s / 8.0
        z = neck_z - 0.0060 - 0.0880 * t
        pl.append(Vector((ox, CL.surface_y(p["body"], ox, z) + R * 0.42, z)))
    p["placket"] = CL.strip("PoloHung_Placket", pl, 0.0105, 0.0030)
    # a CHEST LOGO and a SLEEVE BADGE. "Prints and logos on the texture: that
    # is what makes fabric read as merchandise rather than cloth."
    lz = neck_z - 0.0480
    p["print"] = CL.decal("PoloHung_Chest",
                          (ox + 0.0480, CL.surface_y(p["body"], ox + 0.0480, lz)
                           + 0.0006, lz),
                          (0, -1, 0), (0.0400, 0.0400))
    bz = SH - 0.0800
    p["badge"] = CL.decal(
        "PoloHung_Badge",
        (ox - 0.1080, oy - 0.0230, bz), (-0.55, -0.83, 0), (0.0250, 0.0175))

    for i, t in enumerate((0.18, 0.55)):
        z = neck_z - 0.0060 - 0.0880 * t
        p[f"button{i}"] = HS.cylinder(
            f"PoloHung_Button{i}",
            (ox, CL.surface_y(p["body"], ox, z) - R * 0.30, z),
            0.0056, 0.0026, verts=12,
            rotation=Quaternion((1, 0, 0), math.pi / 2))
    return p


def tee_folded(origin=(0, 0, 0), broken=""):
    """A folded tee. Without a polo's collar there is very little to identify
    it, so the three things that do the work are a RIBBED NECK you can see, the
    SLEEVE EDGES showing at the sides of the fold, and a PRINT on the front --
    all three called out in the review as missing."""
    ox, oy, oz = origin
    w, d, h = FOLD_TEE
    p = {"body": CL.folded("TeeFold_Body", (ox, oy, oz), FOLD_TEE,
                           leaves=4, sag=0.0026, crease=0.0026, seed=1.7)}
    surf = CL.top_z(p["body"], ox, oy + d * 0.20)

    # THE NECK RIB, as real ribbed geometry rather than a smooth arc
    arc = []
    for si in range(15):
        t = si / 14.0
        a = math.pi * (0.14 + 0.72 * t)
        rr = 1.0 + 0.10 * math.cos(22 * a)
        arc.append(Vector((ox + math.cos(a) * w * 0.185 * rr,
                           oy + d * 0.235 + math.sin(a) * d * 0.115 * rr,
                           surf + 0.0022)))
    p["neck_rib"] = CL._sweep("TeeFold_NeckRib", arc, 0.0068, sides=7)

    # THE SLEEVE EDGES: a folded tee shows the sleeve fold at each side
    for i, sgn in enumerate((-1, 1)):
        p[f"sleeve_edge{i}"] = CL.fold_line(
            f"TeeFold_SleeveEdge{i}",
            (ox + sgn * w * 0.34, oy - d * 0.30, surf - 0.0040),
            (ox + sgn * w * 0.30, oy + d * 0.26, surf - 0.0048),
            radius=0.0115, sides=10, sink=0.50)
    p["sleeve_ridge"] = CL.fold_line(
        "TeeFold_SleeveRidge",
        (ox - w * 0.26, oy - d * 0.02, surf - 0.0032),
        (ox + w * 0.22, oy - d * 0.16, surf - 0.0038),
        radius=0.0092, sides=8, sink=0.58)

    # THE PRINT, as a decal that lands exactly where it is put
    p["print"] = CL.decal("TeeFold_Print",
                          (ox - w * 0.02, oy - d * 0.06, surf + 0.0012),
                          (0, 0, 1), (w * 0.44, d * 0.34))
    return p


def tee_hung(origin=(0, 0, 0), broken=""):
    ox, oy, oz = origin
    p = {}
    SH = oz + 0.3100
    p["hanger"], p["hook"] = CL.hanger("TeeHung_Hanger", (ox, oy, SH), halfw=0.0860,
                                          drop=0.0520, rod=0.0058)
    p["body"] = CL.draped("TeeHung_Body", SH - 0.0120, 0.2000, 0.2280,
                          0.2950, 0.0720, centre=(ox, oy), neck=0.0250,
                          shoulder_drop=0.0130)
    for side in (-1, 1):
        nm = "L" if side < 0 else "R"
        d = Vector((side * 0.60, 0, -0.80))
        p[f"sleeve{nm}"] = CL.sleeve_from_body(
            f"TeeHung_Sleeve{nm}",
            (ox + side * 0.0770, oy, SH - 0.0240), d, 0.1060, 0.0358, 0.0300,
            droop=0.09, cuff=0.06)
        p[f"seam{nm}"] = CL.ribbed_ring(
            f"TeeHung_Seam{nm}",
            (ox + side * 0.0770, oy, SH - 0.0240), d, 0.0360, 0.0060,
            ribs=1, depth=0.0004, sides=20)
    # a RIBBED crew neck, not a smooth tube
    neck_z = SH - 0.0120 - 0.0130 - 0.0250
    ring = []
    for s in range(25):
        a = 2 * math.pi * s / 24.0
        rr = 1.0 + 0.055 * math.cos(18 * a)
        ring.append(Vector((ox + math.cos(a) * 0.0345 * rr,
                            oy + math.sin(a) * 0.0195 * rr,
                            neck_z + 0.0155 - 0.0035 * math.cos(a))))
    p["neck_rib"] = CL._sweep("TeeHung_NeckRib", ring, 0.0058, sides=7)
    pz = neck_z - 0.0760
    p["print"] = CL.decal("TeeHung_Print",
                          (ox, CL.surface_y(p["body"], ox, pz) + 0.0006, pz),
                          (0, -1, 0), (0.0980, 0.0820))
    return p


def hoodie_folded(origin=(0, 0, 0), broken=""):
    ox, oy, oz = origin
    w, d, h = FOLD_HOOD
    p = {"body": CL.folded("HoodFold_Body", (ox, oy, oz), FOLD_HOOD,
                           leaves=2, sag=0.0034, crease=0.0030, seed=2.4)}
    # the hood folded on top: a fat soft roll across the back half
    hz = oz + h + 0.0140
    if broken == "hood":
        hz += 0.026
    # A FOLDED HOODIE SHOWS ITS HOOD as a distinct mass on top of the stack --
    # that was the whole of the "does not read as a hoodie" verdict. A plain
    # roll is not enough: this is a rounded pillow with its own rim, sitting
    # across the back third.
    # A FOLDED HOOD is a wedge lying across the back of the stack with its
    # OPENING EDGE facing forward -- that edge is the whole identification, and
    # a plain roll (which is what this was) has none of it.
    hood_rings = []
    for k in range(17):
        t = k / 16.0
        span = math.sqrt(max(0.0, 1.0 - (2 * t - 1) ** 2 * 0.92))
        ring = []
        for i in range(22):
            a2 = 2 * math.pi * i / 22
            # a wedge section: deep at the back, tapering to the front lip
            back = 0.5 + 0.5 * math.cos(a2)
            depth = d * 0.205 * (0.35 + 0.65 * back)
            rise = 0.0330 * (0.30 + 0.70 * back)
            ring.append(Vector((ox - w * 0.33 + w * 0.66 * t,
                                oy + d * 0.105 + math.sin(a2) * depth * span,
                                hz + math.cos(a2) * rise * span
                                - 0.0060 * (1 - span))))
        hood_rings.append(ring)
    p["hood"] = CL.loft("HoodFold_Hood", hood_rings, smooth=True)
    # the opening's rolled edge, standing proud along the front of the wedge
    p["hood_rim"] = CL.fold_line(
        "HoodFold_HoodRim",
        (ox - w * 0.30, oy - d * 0.030, hz + 0.0055),
        (ox + w * 0.30, oy - d * 0.030, hz + 0.0055),
        radius=0.0135, sides=12, sink=0.30)
    p["cord"] = HS.cylinder("HoodFold_Cord",
                            (ox - w * 0.05, oy - d * 0.24,
                             CL.top_z(p["body"], ox - w * 0.05, oy - d * 0.06)
                             - 0.0008),
                            0.0032, 0.1000, verts=8,
                            rotation=Quaternion((0, 1, 0), math.pi / 2))
    return p


def hoodie_hung(origin=(0, 0, 0), broken=""):
    ox, oy, oz = origin
    p = {}
    SH = oz + 0.3600
    p["hanger"], p["hook"] = CL.hanger("HoodHung_Hanger", (ox, oy, SH), halfw=0.0900,
                                          drop=0.0560, rod=0.0058)
    p["body"] = CL.draped("HoodHung_Body", SH - 0.0150, 0.2350, 0.2450,
                          0.3400, 0.1050, centre=(ox, oy), neck=0.0180,
                          shoulder_drop=0.0150)
    # THE HOOD HAS AN OPENING. The first version was a bent tube -- a ring, as
    # the review said, with the hanger's hook showing straight through it. A
    # hood is a ROLLED RIM around a hole with a SHELL behind it, and the two
    # together are what makes it read as something you could put your head in.
    # BEHIND the neck, not over it. At y=-0.005 the hood sat around the
    # hanger's hook and the hook poked out through the shell as a white
    # speck -- visible in tt04 only, which is where the last version of
    # this same fault was caught too.
    rim_c = Vector((ox, oy + 0.0225, SH + 0.0215))
    RIM_A, RIM_B = 0.0620, 0.0530          # the opening's half-width and height
    rim_pts = []
    for s_i in range(29):
        a_i = 2 * math.pi * s_i / 28
        rim_pts.append(rim_c + Vector((math.cos(a_i) * RIM_A, 0.0,
                                       math.sin(a_i) * RIM_B))
                       + Vector((0.0, math.sin(a_i) * 0.0130, 0.0)))
    p["hood_rim"] = CL._sweep("HoodHung_Rim", rim_pts, 0.0072, sides=9)

    # the shell behind the opening: a dome the head would go into
    def hood_shell(u, v):
        a_i = 2 * math.pi * u
        # v 0 at the rim, 1 at the back of the hood
        depth = 0.0940 * v
        # the shell starts at FULL rim width so it closes the opening from
        # most angles; a shell narrower than its rim reads as a bare ring
        k = math.sqrt(max(0.0, 1.0 - v * v * 0.58))
        return rim_c + Vector((math.cos(a_i) * RIM_A * 1.02 * k,
                               0.0075 + depth,
                               math.sin(a_i) * RIM_B * 0.98 * k
                               - 0.0090 * v * v))
    shell = CL.grid_surface("HoodHung_Shell", hood_shell, nu=29, nv=11,
                            smooth=True)
    CL._weld_and_cap(shell)
    p["hood"] = shell

    for side in (-1, 1):
        nm = "L" if side < 0 else "R"
        d = Vector((side * 0.36, 0, -0.933))
        p[f"sleeve{nm}"] = CL.sleeve_from_body(
            f"HoodHung_Sleeve{nm}",
            (ox + side * 0.0905, oy, SH - 0.0300), d, 0.2160, 0.0462, 0.0318,
            droop=0.05, cuff=0.14)
        p[f"seam{nm}"] = CL.ribbed_ring(
            f"HoodHung_Seam{nm}",
            (ox + side * 0.0905, oy, SH - 0.0300), d, 0.0464, 0.0064,
            ribs=1, depth=0.0004, sides=20)
        p[f"cuff{nm}"] = CL.ribbed_ring(
            f"HoodHung_Cuff{nm}",
            Vector((ox + side * 0.0905, oy, SH - 0.0300))
            + Vector(d).normalized() * 0.2035, d, 0.0326, 0.0165,
            ribs=14, depth=0.0018)
        p[f"cord{nm}"] = HS.cylinder(
            f"HoodHung_Cord{nm}", (ox + side * 0.0170, oy - 0.0430,
                                   SH - 0.0900),
            0.0030, 0.0900, verts=8)
    # kangaroo pocket: a band across the lower front
    # the kangaroo pocket: a patch with a real lip at its top edge, which is
    # what casts the shadow line the reference shows
    prings = []
    for s in range(13):
        t = s / 12.0
        x = ox + (t - 0.5) * 0.1820
        bulge = 1.0 - 0.30 * abs(t - 0.5) * 2
        ring = []
        for i in range(12):
            b = 2 * math.pi * i / 12
            ring.append(Vector((x, oy - 0.0455 + math.sin(b) * 0.0145 * bulge,
                                SH - 0.2130 + math.cos(b) * 0.0350)))
        prings.append(ring)
    p["pocket"] = CL.loft("HoodHung_Pocket", prings, smooth=True)
    lip = []
    for s in range(13):
        t = s / 12.0
        x = ox + (t - 0.5) * 0.1860
        lip.append(Vector((x, oy - 0.0505, SH - 0.1790 - 0.0035 * math.cos(t * 3))))
    p["pocket_lip"] = CL.strip("HoodHung_PocketLip", lip, 0.0075, 0.0038)
    return p


def trousers_folded(origin=(0, 0, 0), broken=""):
    ox, oy, oz = origin
    w, d, h = FOLD_TROU
    p = {"body": CL.folded("TrouFold_Body", (ox, oy, oz), FOLD_TROU,
                           leaves=2, sag=0.0028, crease=0.0026, seed=3.1)}
    # THE FOLD END IS A FAT ROLL -- it is the whole read on the reference stack
    p["fold_roll"] = CL.fold_line("TrouFold_Roll",
                                  (ox - w * 0.46, oy - d * 0.40, oz + h * 0.52),
                                  (ox - w * 0.46, oy + d * 0.40, oz + h * 0.52),
                                  radius=h * 0.44, sides=14, sink=0.30)
    # DEEPER RELIEF. The waistband, loops and pocket were all modelled and all
    # vanished under lighting -- the review's words. Everything here is 2-3x
    # the old projection, which is what it takes to cast a shadow at the
    # distance a player stands.
    p["waistband"] = CL.fold_line("TrouFold_Waistband",
                                  (ox + w * 0.355, oy - d * 0.42, oz + h + 0.0035),
                                  (ox + w * 0.355, oy + d * 0.42, oz + h + 0.0035),
                                  radius=0.0225, sides=14, sink=0.34)
    for i, sgn in enumerate((-1, 1)):
        p[f"loop{i}"] = HS.box(f"TrouFold_Loop{i}",
                               (ox + w * 0.355, oy + sgn * d * 0.21,
                                oz + h + 0.0125),
                               (0.0210, 0.0115, 0.0115), bevel=0.0022)
    # a welt pocket: a raised patch with a flap over it, as the reference has
    # A WELT POCKET is two lips with a slot between them, not a slab stuck on
    # the leg. The slab read as a floating plate; the slot casts the shadow
    # that makes it read as a pocket.
    px, py = ox + w * 0.045, oy + d * 0.150
    pz = CL.top_z(p["body"], px, py)
    for i, off in enumerate((-0.0130, 0.0130)):
        p[f"pocket_welt{i}"] = CL.strip(
            f"TrouFold_Welt{i}",
            [Vector((px - 0.0395, py + off, pz + 0.0018)),
             Vector((px, py + off * 1.06, pz + 0.0026)),
             Vector((px + 0.0395, py + off, pz + 0.0018))],
            0.0092, 0.0046)
    p["pocket"] = CL.strip(
        "TrouFold_PocketFlap",
        [Vector((px - 0.0360, py + 0.0195, pz + 0.0034)),
         Vector((px + 0.0360, py + 0.0195, pz + 0.0034))], 0.0105, 0.0038)
    return p


def cap(origin=(0, 0, 0), broken=""):
    """A six-panel cap, built the way one is made.

    The first version was a smooth dome with a tongue and it read as a lump --
    the owner's word, and the right one. Reference (ref/apparel/cap-detail.jpg,
    cap-variety.jpg) says the whole identity is in six things:

      SIX PANELS with stitched seams radiating from the crown
      a COVERED BUTTON at the crown, in a CONTRASTING colour
      EYELETS, one per panel
      a brim in a CONTRASTING colour with a DARKER UNDERSIDE
      three CONCENTRIC STITCH ROWS following the brim's edge
      a SWEATBAND inside the opening and a SNAPBACK STRAP at the back

    Every one of those is geometry here, and the relief is 2-3x what the first
    version used, because the note on that version was that the seams and
    eyelets did not survive the render.
    """
    ox, oy, oz = origin
    p = {}
    R = 0.0930
    CROWN_H = 0.0855
    PANELS = 6

    def crown_pt(a, t):
        """t 0 at the rim, 1 at the crown button."""
        phi = (math.pi * 0.5) * t * 0.94
        # panels bulge between the seams and pinch AT them
        seam = 1.0 - 0.030 * math.cos(PANELS * a) ** 8
        bulge = 1.0 + 0.022 * math.sin(PANELS * a + math.pi / 2) ** 2 * (1 - t)
        r = R * math.cos(phi) ** 0.76 * seam * bulge
        # a cap is taller at the front than the back
        rake = 1.0 + 0.10 * math.cos(a)
        z = oz + CROWN_H * math.sin(phi) * rake
        return Vector((ox + math.cos(a) * r, oy + math.sin(a) * r * 0.965, z))

    rings = []
    LAT, SEG = 13, 72
    for k in range(LAT + 1):
        t = k / LAT
        rings.append([crown_pt(2 * math.pi * i / SEG, t) for i in range(SEG)])
    p["crown"] = CL.loft("Cap_Crown", rings, close_bottom=True, close_top=True,
                         smooth=True)

    # THE SEAMS. Piping along each of the six panel joins, from the button down
    # to the rim. This is what makes it read as a made object rather than a
    # moulded dome, and it is the part that vanished at the old relief.
    for i in range(PANELS):
        a = 2 * math.pi * i / PANELS + math.pi / PANELS
        path = [crown_pt(a, 1.0 - 0.985 * (s / 12.0)) for s in range(13)]
        p[f"seam{i}"] = CL._sweep(f"Cap_Seam{i}", path, 0.0026, sides=6)

    # the covered button, and the stitch ring around its base
    top = crown_pt(0.0, 1.0)
    p["button"] = HS.cylinder("Cap_Button", (ox, oy, top.z - 0.0014), 0.0092,
                              0.0072, verts=14)
    p["buttonring"] = CL._sweep(
        "Cap_ButtonRing",
        [Vector((ox + math.cos(2 * math.pi * s / 16) * 0.0128,
                 oy + math.sin(2 * math.pi * s / 16) * 0.0128,
                 top.z - 0.0016)) for s in range(17)], 0.0016, sides=6)

    # eyelets, one per panel, on the panel centre line
    for i in range(PANELS):
        a = 2 * math.pi * i / PANELS
        c = crown_pt(a, 0.46)
        p[f"eyelet{i}"] = HS.cylinder(
            f"Cap_Eyelet{i}", (c.x * 0.992, c.y * 0.992, c.z), 0.0027, 0.0050,
            verts=8, rotation=Quaternion(Vector((-math.sin(a), math.cos(a), 0)),
                                          math.pi / 2))

    # ---- the brim: a curved PLATE, not a tube swept along its outline.
    # The first version lofted a small circular section along the edge curve,
    # which produced four floating hoops and no brim at all -- a brim is a
    # surface, so it is built as one and given thickness.
    ROOT_Y = -R * 0.52
    REACH = 0.1090

    def brim_surf(u, v):
        # A TONGUE: full width at the root, easing in, then rounding off at the
        # tip. The first version kept 58% of its width at v=1, so the brim
        # ended in a flat chopped edge.
        halfw = R * 0.99 * (1.0 - 0.34 * v * v) * math.sqrt(max(0.0, 1.0 - v ** 8))
        y = ROOT_Y - REACH * v
        z = oz + 0.0186 - 0.0355 * (v ** 1.45) + 0.0140 * u * u
        return Vector((ox + u * halfw, oy + y, z))

    plate = CL.grid_surface("Cap_Brim", lambda u, v: brim_surf(-1 + 2 * u, v),
                            nu=27, nv=13, smooth=True)
    mod = plate.modifiers.new("Thick", "SOLIDIFY")
    mod.thickness = 0.0068
    mod.offset = 0.0
    mod.use_rim = True
    p["brim"] = HS.apply_mods(plate)
    if broken == "peak":
        p["brim"].location.y -= 0.045

    # THREE CONCENTRIC STITCH ROWS following the brim edge, as the reference
    # has. Each is the PERIMETER OF A SHRUNKEN BRIM walked through the same
    # surface function, so it follows the real curve -- walking u and v by hand
    # produced three chevrons.
    for row, d in enumerate((0.052, 0.108, 0.164)):
        path = []
        vmax = 1.0 - d * 1.15
        umax = 1.0 - d * 1.25
        N = 15
        for sidx in range(N + 1):                   # up the left edge
            path.append(brim_surf(-umax, 0.10 + (vmax - 0.10) * sidx / N))
        for sidx in range(1, N):                    # across the tip
            path.append(brim_surf(-umax + 2 * umax * sidx / N, vmax))
        for sidx in range(N + 1):                   # down the right edge
            path.append(brim_surf(umax, vmax - (vmax - 0.10) * sidx / N))
        path = [Vector((q.x, q.y, q.z + 0.0040)) for q in path]
        p[f"stitch{row}"] = CL._sweep(f"Cap_Stitch{row}", path, 0.0013, sides=5)

    # the sweatband, just inside the rim
    # INSIDE the crown. At 0.955 of the rim radius with a 5.2 mm section it
    # bulged past the crown's silhouette and read as a scalloped skirt all the
    # way round -- visible in tt02 and tt05 and invisible in the hero shot,
    # which is the whole argument for reviewing off the turntable.
    band = []
    for si in range(37):
        a = 2 * math.pi * si / 36
        c = crown_pt(a, 0.055)
        band.append(Vector((c.x * 0.895, c.y * 0.895, c.z + 0.0085)))
    p["sweatband"] = CL._sweep("Cap_Sweatband", band, 0.0042, sides=8)

    # THE REAR CLOSURE, as a band that follows the rim.
    # Two flat strips read as fins sticking out of the back of the cap: a strip
    # is oriented by its path tangent and world up, so on a curving crown its
    # width axis swings away from the surface. A swept tube has no width axis
    # to get wrong, and an adjuster band is round anyway. Caught in tt05 and
    # invisible in the hero shot.
    for k, side in enumerate((-1, 1)):
        pts = []
        for si in range(9):
            t = si / 8.0
            a = math.pi + side * (0.70 - 0.60 * t)
            c = crown_pt(a, 0.085 + 0.030 * t)
            pts.append(Vector((c.x * 1.012, c.y * 1.012, c.z + 0.0015)))
        p[f"strap{k}"] = CL._sweep(f"Cap_Strap{k}", pts, 0.0058, sides=7)
    # THE FRONT MONOGRAM. A cap without a mark on the front is a blank, and a
    # decal lands its artwork exactly where it is put.
    front = crown_pt(-math.pi / 2, 0.30)
    p["mono"] = CL.decal("Cap_Mono",
                         (ox, front.y * 1.010, front.z + 0.0020),
                         (0, -1, 0.22), (0.0620, 0.0330), lift=0.0014)

    cb = crown_pt(math.pi, 0.118)
    p["buckle"] = HS.box("Cap_Buckle", (cb.x * 1.020, cb.y * 1.020, cb.z + 0.0016),
                         (0.0125, 0.0095, 0.0086), bevel=0.0016)
    return p


GARMENTS = {
    "polo-folded": polo_folded, "polo-hung": polo_hung,
    "tee-folded": tee_folded, "tee-hung": tee_hung,
    "hoodie-folded": hoodie_folded, "hoodie-hung": hoodie_hung,
    "trousers-folded": trousers_folded, "cap": cap,
}

# Pairs where one part is deliberately deep inside another. Each is a decision
# on the record, which is the point of the list -- a pair that is NOT here and
# interpenetrates is a build failure now.
DEEP = {
    # A soft feature half-sunk into cloth so it merges -- a sleeve ridge under a
    # fold, the fat roll at a trouser fold, a waistband, a neck rib. Deep is the
    # intent for these: only the top of the roll should show.
    "polo-folded": [("body", "sleeve_ridge"), ("body", "print"),
                    ("sleeve_ridge", "print")],
    "tee-folded": [("body", "sleeve_ridge"), ("body", "neck_rib"),
                   ("body", "sleeve_edge0"), ("body", "sleeve_edge1"),
                   ("body", "print"), ("sleeve_ridge", "print")],
    # the hood's rolled edge is part of the hood, and the hood sits on the fold
    "hoodie-folded": [("body", "hood"), ("body", "cord"),
                      ("hood", "hood_rim"), ("body", "hood_rim")],
    # An armhole SEAM sits at the join by definition, and a CUFF wraps the end
    # of the sleeve it belongs to -- both are named rather than defaulted.
    "polo-hung": [("hanger", "hook"), ("body", "hook"), ("body", "hanger"), ("body", "collar"), ("body", "sleeveL"),
                  ("body", "sleeveR"), ("body", "placket"),
                  ("hanger", "sleeveL"), ("hanger", "sleeveR"),
                  ("hanger", "collar"), ("body", "seamL"), ("body", "seamR"),
                  ("seamL", "sleeveL"), ("seamR", "sleeveR"),
                  ("cuffL", "sleeveL"), ("cuffR", "sleeveR"),
                  ("body", "print"), ("sleeveL", "badge"),
                  ("body", "badge")],
    "tee-hung": [("hanger", "hook"), ("body", "hook"), ("body", "hanger"), ("body", "sleeveL"), ("body", "sleeveR"),
                 ("body", "neck_rib"), ("hanger", "sleeveL"),
                 ("hanger", "sleeveR"), ("hanger", "neck_rib"),
                 ("body", "seamL"), ("body", "seamR"),
                 ("seamL", "sleeveL"), ("seamR", "sleeveR"),
                 ("body", "print")],
    "hoodie-hung": [("hanger", "hook"), ("body", "hook"), ("body", "hanger"), ("body", "sleeveL"), ("body", "sleeveR"),
                    ("body", "hood"), ("body", "pocket"), ("body", "cordL"),
                    ("body", "cordR"), ("hanger", "hood"), ("hanger", "sleeveL"),
                    ("hanger", "sleeveR"), ("hood", "sleeveL"),
                    ("hood", "sleeveR"), ("body", "seamL"), ("body", "seamR"),
                    ("hood", "hood_rim"), ("body", "hood_rim"),
                    ("hanger", "hood_rim"), ("hook", "hood_rim"),
                    ("hood", "hook"), ("pocket", "pocket_lip"),
                    ("body", "pocket_lip"),
                    ("seamL", "sleeveL"), ("seamR", "sleeveR"),
                    ("cuffL", "sleeveL"), ("cuffR", "sleeveR"),
                    ("hood", "seamL"), ("hood", "seamR")],
    # A sweatband is inside the cap and the seams and eyelets are sewn through
    # it -- each named, so anything NOT named that interpenetrates still fails.
    "cap": [("crown", "brim"), ("crown", "button"), ("crown", "sweatband"),
            ("crown", "buttonring"), ("brim", "stitch0"), ("brim", "stitch1"),
            ("brim", "stitch2"), ("crown", "strap0"), ("crown", "strap1")]
           + [("crown", "mono")]
           + [("crown", f"eyelet{i}") for i in range(6)]
           + [("crown", f"seam{i}") for i in range(6)]
           + [("sweatband", f"seam{i}") for i in range(6)]
           + [("brim", f"seam{i}") for i in range(6)],
    "trousers-folded": [("body", "fold_roll"), ("body", "waistband"),
                        ("body", "pocket"), ("fold_roll", "waistband"),
                        ("body", "pocket_welt0"), ("body", "pocket_welt1"),
                        ("pocket", "pocket_welt1"), ("waistband", "loop0"),
                        ("waistband", "loop1")],
}


def check(name, parts):
    """Every pair, every part, with the deliberate ones named."""
    mesh = {k: v for k, v in parts.items()
            if hasattr(v, "data") and getattr(v.data, "vertices", None) is not None}
    HS.assert_all_one_piece(mesh, f"{name}: every part is one piece")
    HS.assert_assembly(mesh, f"{name}: the assembly", allow=DEEP.get(name, ()))


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    only = next((x.split("=", 1)[1] for x in args if x.startswith("only=")), "")
    broken = next((x.split("=", 1)[1] for x in args if x.startswith("break=")), "")
    suffix = f"-BROKEN-{broken}" if broken else ("-eevee" if engine == "EEVEE" else "")

    todo = [k for k in GARMENTS if not only or k.startswith(only)]
    for name in todo:
        H.reset_scene()
        H.set_engine(engine, samples=180 if engine == "CYCLES" else 96)
        cloth, trim = materials()
        parts = GARMENTS[name](broken=broken)
        for key, ob in parts.items():
            c = cell_for(key, name)
            if ob.get("explicit_uv"):
                CL.cell_offset(ob, c, ATLAS_COLS, ATLAS_ROWS)
            else:
                CL.texture_into_cell(ob, c, ATLAS_COLS, ATLAS_ROWS)
            hard = c == TRIM_CELL
            ob.data.materials.append(trim if hard else cloth)
        if not broken:
            check(name, parts)

        subject = [v for v in parts.values() if hasattr(v, "data")]
        print(f"{name}: TRIS {H.triangles(subject)} in {len(subject)} parts, "
              f"2 materials")
        lo, hi = H.bounds(subject)
        print(f"  {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} x "
              f"{(hi.z - lo.z) * 1000:.0f} mm")

        centre, radius = H.subject_sphere(subject)
        LENS = 76.0
        dist = H.fit_distance(radius, LENS, res=(1000, 1000), margin=1.20)
        H.studio(center=centre, scale=radius)
        H.backdrop(center=centre, scale=radius)
        out = os.path.join(OUT_RENDER, name)
        tt = H.turntable(centre, dist, out, f"{name}{suffix}", views=8,
                         elevation=20.0, lens=LENS, res=(900, 900))
        H.contact_sheet(tt, os.path.join(out, f"{name}{suffix}-turntable.png"))
        for label, az, el in (("hero", -122, 26), ("top", -90, 62),
                              ("front", -90, 8)):
            cam = H.camera(label, H.orbit_position(centre, dist, az, el),
                           centre, lens=LENS)
            H.render(cam, os.path.join(out, f"{name}{suffix}-{label}.png"),
                     res=(1100, 1100))
            if label == "hero":
                H.silhouette(subject, cam,
                             os.path.join(out, f"{name}{suffix}-silhouette.png"),
                             res=(900, 900))
        if not broken and engine == "CYCLES":
            H.bake_gltf_axis(subject)
            H.export_glb(subject, os.path.join(GLB_DIR, f"apparel_{name.replace('-', '_')}.glb"))


if __name__ == "__main__":
    main()
