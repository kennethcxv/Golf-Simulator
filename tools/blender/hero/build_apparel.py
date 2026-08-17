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
ATLAS_COLS, ATLAS_ROWS = 6, 6
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
    p.update(CL.folded_ribbon("PoloFold", (ox, oy, oz), FOLD_POLO,
                              plies=6, sag=0.0030, crease=0.0034, seed=0.4,
                              wander=1.7))
    body = p["cloth"]
    top_at = p.pop("top_at")

    # the sleeve folded underneath shows as a soft ridge across the body
    p["sleeve_ridge"] = CL.fold_line(
        "PoloFold_SleeveRidge",
        (ox - w * 0.42, oy - d * 0.26, oz + h - 0.0040),
        (ox - w * 0.14, oy + d * 0.06, oz + h - 0.0052),
        radius=0.0125, sink=0.52)

    # the collar, splayed open at the back edge of the fold. Its base comes
    # from the MEASURED top face: the nominal fold height is above the sagged
    # surface, and a collar placed there sinks into the shirt.
    cz = top_at(ox + w * 0.03, oy + d * 0.20) + 0.0018
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
         top_at(ox - w * 0.26, oy - d * 0.20) - 0.0006),
        (0, 0, 1), (0.0400, 0.0400))

    # the size tag, protruding from the right edge. MEASURED against the body,
    # not predicted: guessing put it 19.93 mm inside and then, re-guessed, clear
    # of the shirt entirely, and assert_assembly failed both.
    tag_hw = 0.0165
    ex = CL.edge_x(body, oz + h * 0.50, oy - d * 0.10)
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
    p = dict(CL.folded_ribbon("TeeFold", (ox, oy, oz), FOLD_TEE,
                              plies=6, sag=0.0026, crease=0.0026, seed=1.7,
                              wander=1.7))
    body = p["cloth"]
    top_at = p.pop("top_at")
    surf = top_at(ox, oy + d * 0.20)

    # THE NECK RIB, as real ribbed geometry rather than a smooth arc
    # A 10% SCALLOP AT 22 CYCLES IS NOT RIBBING, it is a tear. Sampled at 15
    # points the scallop aliases badly, and on a 13.6 mm sausage floating
    # 2.2 mm clear of the cloth the whole thing rendered as a ragged white
    # strip laid on the shirt -- it read as a rip, not a neckline. Ribbing is
    # FINE relief on a band that lies down: the band is the cue, the rib is
    # texture on it. Sampled dense enough to carry what is left of it.
    arc = []
    for si in range(41):
        t = si / 40.0
        a = math.pi * (0.14 + 0.72 * t)
        rr = 1.0 + 0.016 * math.cos(26 * a)
        arc.append(Vector((ox + math.cos(a) * w * 0.185 * rr,
                           oy + d * 0.235 + math.sin(a) * d * 0.115 * rr,
                           surf + 0.0004)))
    p["neck_rib"] = CL._sweep("TeeFold_NeckRib", arc, 0.0034, sides=8)

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


# A tee's proportions off a men's medium, in the same terms the polo uses.
TEE_SPEC = {
    "sh_half": 0.2060, "length": 0.5600, "neck_half": 0.3600,
    "shoulder_drop": 0.0320, "scoop_front": 0.0330, "scoop_back": 0.0230,
    "width_profile": ((0.00, 1.000), (0.15, 1.120), (0.55, 1.070),
                      (1.00, 1.150)),
    "depth_chest": 0.0790, "depth_hem": 0.0740,
}
TEE_CLOTH = 0.0020


def tee_hung(origin=(0, 0, 0), broken=""):
    """PANELS, like the polo. CL.draped made one closed lens-section tube, and
    a tube has no side seam, no shoulder seam and no armhole -- so the tee hung
    came out as a slab with a scalloped hem, a neck slot like a carrier bag's
    handle and two sleeves floating off it at angles."""
    ox, oy, oz = origin
    p = {}
    SH = oz + 0.3100
    panel, side_u, top_edge = CL.hung_body(TEE_SPEC)
    NU, NV = 25, 19
    for front in (True, False):
        key = "front" if front else "back"
        seed = 0.0 if front else 1.7
        surf = CL.grid_surface(
            f"TeeHung_{key.capitalize()}",
            (lambda f, sd: (lambda u, v: panel(f, side_u(u), v, sd)
                            + Vector((ox, oy, SH))))(front, seed),
            nu=NU, nv=NV, smooth=True)
        p[key] = CL.smooth_by_angle(
            CL.thicken(surf, TEE_CLOTH, offset=-1.0 if front else 1.0))

    # the three lines a tube cannot have
    for nm, sgn in (("L", -1.0), ("R", 1.0)):
        pts, nrms = [], []
        for k in range(15):
            v = 0.030 + 0.955 * k / 14.0
            pts.append(panel(True, sgn, v) + Vector((ox, oy, SH)))
            nrms.append(Vector((sgn, 0.0, 0.0)))
        p[f"seam{nm}"] = CL.framed_sweep(f"TeeHung_Seam{nm}", pts, nrms,
                                         0.0028, 0.0020, sides=6, taper=2)
        pts, nrms = [], []
        for k in range(11):
            u = sgn * (TEE_SPEC["neck_half"]
                       + (0.985 - TEE_SPEC["neck_half"]) * k / 10.0)
            pts.append(Vector((ox + u * TEE_SPEC["sh_half"], oy,
                               SH + top_edge(u, True) + 0.0008)))
            nrms.append(Vector((0.0, 0.0, 1.0)))
        p[f"shoulder{nm}"] = CL.framed_sweep(
            f"TeeHung_Shoulder{nm}", pts, nrms, 0.0055, 0.0016, sides=6,
            taper=2)

        # sleeves off the shoulder points, flat because an empty sleeve is
        # THE ROOT HAS TO SIT WHERE THE BODY HAS DEPTH. At u = 0.90, v = 0 the
        # panel is 6 mm from its centre plane -- the shoulder is deliberately
        # flat there -- so a 70 mm sleeve hung off it reads as a mug stuck to a
        # razor edge, which is what the first render showed on both sides.
        # Measured off the panel at v = 0.10, where there is something to sew
        # into, and the radius brought down to match what it meets.
        anchor = panel(True, sgn * 0.885, 0.10) + Vector((ox, oy, SH))
        root = Vector((anchor.x, oy, anchor.z + 0.0090))
        dvec = Vector((sgn * 0.80, 0.0, -0.60)).normalized()
        p[f"sleeve{nm}"] = CL.sleeve_from_body(
            f"TeeHung_Sleeve{nm}", root, dvec, 0.1560, 0.0620, 0.0530,
            droop=0.16, sides=16, steps=8, seam_in=0.0240, flat=0.50)
        sv = Vector((0.0, 0.0, 1.0)).cross(dvec).normalized()
        uv = dvec.cross(sv).normalized()
        pts, nrms = [], []
        NA = 17
        for k in range(NA):
            a = 2.0 * math.pi * k / NA
            q = root + sv * (math.cos(a) * 0.0608) + uv * (
                math.sin(a) * 0.0608 * 0.50)
            pts.append(q)
            nrms.append((q - root).normalized())
        p[f"armhole{nm}"] = CL.framed_sweep(
            f"TeeHung_Armhole{nm}", pts, nrms, 0.0024, 0.0016, closed=True,
            sides=6)
        # A TEE SLEEVE HAS A HEM, NOT A RIBBED CUFF -- and the ribbed band was
        # making the fault as well as being wrong. ribbed_ring is a band
        # CENTRED on its point, so with the sleeve's closed tip 3 mm behind its
        # outer face there was a shallow annular recess, and looking down the
        # sleeve that is a hollow mouth. The same shape of fault as the polo's
        # "flat disc", which was also a ring hung off the end of the cloth.
        #
        # sleeve_from_body already closes its own tip to a slot. All this needs
        # is the stitch line of the hem, set back on the cloth where it belongs.
        hem_c = root + dvec * 0.1170
        hem_pts, hem_n = [], []
        hs = Vector((0.0, 0.0, 1.0)).cross(dvec).normalized()
        hu = dvec.cross(hs).normalized()
        for k in range(19):
            a = 2.0 * math.pi * k / 18.0
            q = hem_c + hs * (math.cos(a) * 0.0568) + hu * (
                math.sin(a) * 0.0568 * 0.50)
            hem_pts.append(q)
            hem_n.append((q - hem_c).normalized())
        p[f"cuff{nm}"] = CL.framed_sweep(
            f"TeeHung_Cuff{nm}", hem_pts, hem_n, 0.0042, 0.0016, closed=True,
            sides=6)

    # A RIBBED CREW NECK on the panel neckline, measured off the panels rather
    # than floated at a guessed height.
    ring = []
    for k in range(33):
        a = 2 * math.pi * k / 32.0
        uu = math.cos(a) * TEE_SPEC["neck_half"] * 0.97
        frontish = math.sin(a) < 0.0
        q = panel(frontish, uu, 0.0) + Vector((ox, oy, SH))
        rr = 1.0 + 0.05 * math.cos(20 * a)
        ring.append(Vector((q.x * rr, q.y * 1.02, q.z + 0.0030)))
    p["neck_rib"] = CL._sweep("TeeHung_NeckRib", ring, 0.0056, sides=8)

    # the hem, turned as a real band all the way round
    hem, hnrm = [], []
    NH = 41
    for k in range(NH):
        t = k / (NH - 1.0)
        frontish = t < 0.5
        uu = side_u((t * 2.0) if frontish else (2.0 - t * 2.0))
        q = panel(frontish, uu, 1.0) + Vector((ox, oy, SH))
        hem.append(q)
        hnrm.append(Vector((0.0, 0.0, 1.0)))
    p["hem"] = CL.framed_sweep("TeeHung_Hem", hem, hnrm, 0.0090, 0.0026,
                               sides=6, closed=True)

    p["hanger"], p["hook"] = CL.hanger(
        "TeeHung_Hanger", (ox, oy, SH + 0.0180), halfw=0.0860, drop=0.0520,
        rod=0.0058)

    # PLACED OFF THE PANEL, not off a guessed height. Asking surface_y for a
    # z picked by eye failed outright -- "the part being placed there is off
    # the garment, not on it" -- and the panel function already knows exactly
    # where its own surface is.
    chest = panel(True, 0.0, 0.30) + Vector((ox, oy, SH))
    p["print"] = CL.decal("TeeHung_Print",
                          (chest.x, chest.y - 0.0016, chest.z),
                          (0, -1, 0), (0.0980, 0.0820))
    return p


def hoodie_folded(origin=(0, 0, 0), broken=""):
    ox, oy, oz = origin
    w, d, h = FOLD_HOOD
    # a hoodie is thick cloth: fewer, fatter plies than a polo
    p = dict(CL.folded_ribbon("HoodFold", (ox, oy, oz), FOLD_HOOD,
                              plies=4, sag=0.0034, crease=0.0030, seed=2.4,
                              wander=1.5))
    body = p["cloth"]
    top_at = p.pop("top_at")
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
    # THE OPENING IS THE HOOD. Everything else about a folded hood is a soft
    # lump, and a soft lump is what this was twice: the span term
    # sqrt(1 - (2t-1)^2 * 0.92) tapers at BOTH ends, which is an ellipsoid,
    # which is a bread roll. Then the "opening edge" was a separate tube laid
    # along the front of a CLOSED dome -- and a tube on a closed surface is a
    # moulding, not a mouth.
    #
    # Same lesson as the folded leaves: you cannot get a slot out of one
    # surface. The mouth is cut with a boolean DIFFERENCE (reliable here, where
    # union of swept tubes is not), so there is a real cavity with a real rim
    # where the two surfaces meet, and something for the light not to reach.
    hood_rings = []
    for k in range(17):
        t = k / 16.0
        # flat across most of its length and rounded only at the very ends: a
        # hood folded across a stack is a WEDGE, not an egg
        # never 0: a ring collapsed to a point makes degenerate faces and the
        # loft caps them as a hard flat diagonal, which is the sharp face that
        # showed on the left end
        # A FLAP, not a dome. Rounded hard at the two ends so there is no flat
        # facet where the loft caps it, and flat across everything between.
        span = max(0.22, min(1.0, (1.0 - abs(2 * t - 1) ** 5.0) * 1.9))
        ring = []
        for i2 in range(24):
            a2 = 2 * math.pi * i2 / 24
            back = 0.5 + 0.5 * math.cos(a2)
            # LOW AND WIDE. At 36 mm of rise over a 0.68w span it stood up
            # like a suitcase handle, and with a bar across its mouth that is
            # exactly what it read as. A hood folded onto a stack is a soft
            # band across the back third, barely proud of the cloth.
            depth = d * 0.240 * (0.32 + 0.68 * back)
            rise = 0.0165 * (0.30 + 0.70 * back)
            # cloth, not a moulding: the flap wanders along its length and
            # sags a little between its ends
            rise *= 1.0 + 0.10 * math.sin(t * 7.1 + 0.6)
            depth *= 1.0 + 0.055 * math.sin(t * 4.3 + 2.2)
            ring.append(Vector((ox - w * 0.40 + w * 0.80 * t,
                                oy + d * 0.115 + math.sin(a2) * depth * span,
                                hz + math.cos(a2) * rise * span
                                - 0.0060 * (1 - span))))
        hood_rings.append(ring)
    # TUCK THE ENDS CLOSED. CL.loft caps the first and last ring with a flat
    # n-gon, and on a ring that is still 22% of full span that cap is a hard
    # diagonal facet -- clearly visible on the left end of the flap in three
    # rounds of renders. Cloth does not end in a plate; it rolls over. Same
    # move as the sleeve cuff.
    def tuck(ring, k):
        cx = sum(q.x for q in ring) / len(ring)
        cy = sum(q.y for q in ring) / len(ring)
        cz = sum(q.z for q in ring) / len(ring)
        # The nose has to stay ROUND. Pushing a ring shrunk to 15% a further
        # 14.8 mm out makes a spike, and the render grew a small fin at each
        # end. The push has to stay inside what the shrinking ring can still
        # cover, so it is roughly proportional to the width that is left.
        push = (0.0038, 0.0062, 0.0074)[k]
        shrink = (0.82, 0.56, 0.26)[k]
        sgn = -1.0 if ring is hood_rings[0] else 1.0
        return [Vector((cx + sgn * push + (q.x - cx) * shrink,
                        cy + (q.y - cy) * shrink,
                        cz + (q.z - cz) * shrink)) for q in ring]

    hood_rings = ([tuck(hood_rings[0], k) for k in (2, 1, 0)] + hood_rings
                  + [tuck(hood_rings[-1], k) for k in (0, 1, 2)])
    hood = CL.loft("HoodFold_Hood", hood_rings, smooth=True)

    # the cutter: a flattened ellipsoid driven into the front face, tilted so
    # the mouth looks forward and a little up, the way a hood lying on its back
    # does
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=28, ring_count=16,
                                         location=(ox - w * 0.005,
                                                   oy - d * 0.078,
                                                   hz + 0.0056))
    cut = bpy.context.active_object
    cut.name = "HoodFold_Mouth"
    cut.scale = (w * 0.300, d * 0.105, 0.0132)
    cut.rotation_euler = (math.radians(-22.0), 0.0, 0.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    m = hood.modifiers.new("Mouth", "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.object = cut
    m.solver = "EXACT"
    hood = HS.apply_mods(hood)
    bpy.data.objects.remove(cut, do_unlink=True)
    p["hood"] = CL.smooth_by_angle(hood, 38.0)

    # the rolled edge now runs ROUND THE MOUTH the boolean cut, instead of
    # lying across a closed dome
    rim, rnrm = [], []
    for k in range(19):
        u = -1.0 + 2.0 * k / 18.0
        rim.append(Vector((ox + u * w * 0.296,
                           oy - d * 0.070 + 0.0150 * u * u,
                           hz + 0.0104 - 0.0074 * u * u)))
        rnrm.append(Vector((0.0, -0.55, 1.0)).normalized())
    p["hood_rim"] = CL.framed_sweep("HoodFold_HoodRim", rim, rnrm,
                                    0.0062, 0.0038, sides=8)
    # THE DRAWCORDS. On a folded hoodie these and the pocket are what identify
    # it -- the hood is just a soft band. This was ONE cylinder lying under the
    # rim where nothing could see it. Two cords now, running out of the mouth
    # and down across the top face, each with a metal tip, laid on the MEASURED
    # surface rather than at a nominal height.
    for ci, cx in enumerate((-w * 0.075, w * 0.055)):
        path_pts, nrm = [], []
        for k in range(10):
            t = k / 9.0
            y = oy - d * 0.075 - d * 0.300 * t
            wob = 0.0065 * math.sin(t * 3.1 + ci * 2.0) * t
            z = (hz + 0.0060) * (1.0 - t) + (
                top_at(cx + wob, y) + 0.0028) * t
            path_pts.append(Vector((cx + wob, y, z)))
            nrm.append(Vector((0.0, 0.0, 1.0)))
        p[f"cord{ci}"] = CL.framed_sweep(f"HoodFold_Cord{ci}", path_pts, nrm,
                                         0.0030, 0.0026, sides=6)
        tip = path_pts[-1]
        p[f"cord_tip{ci}"] = HS.cylinder(
            f"HoodFold_CordTip{ci}", (tip.x, tip.y - 0.0075, tip.z),
            0.0035, 0.0130, verts=8,
            rotation=Quaternion((1, 0, 0), math.pi / 2))

    return p


# A hoodie is boxier than a tee and longer: wider through the shoulder, almost
# no waist, and it hangs heavier so the hem barely flares.
HOOD_SPEC = {
    "sh_half": 0.2360, "length": 0.6100, "neck_half": 0.3400,
    "shoulder_drop": 0.0400, "scoop_front": 0.0260, "scoop_back": 0.0200,
    "width_profile": ((0.00, 1.000), (0.16, 1.075), (0.60, 1.055),
                      (1.00, 1.060)),
    "depth_chest": 0.1000, "depth_hem": 0.0940, "hem_side_drop": 0.0045,
}
HOOD_CLOTH = 0.0030


def hoodie_hung(origin=(0, 0, 0), broken=""):
    """PANELS, like the polo and the tee. The hoodie's hood, pocket and cords
    always read; the BODY under them was a draped tube with a scalloped hem and
    two stiff pipes for sleeves."""
    ox, oy, oz = origin
    p = {}
    SH = oz + 0.3600
    panel, side_u, top_edge = CL.hung_body(HOOD_SPEC)
    NU, NV = 25, 19
    for front in (True, False):
        key = "front" if front else "back"
        seed = 0.0 if front else 2.4
        surf = CL.grid_surface(
            f"HoodHung_{key.capitalize()}",
            (lambda f, sd: (lambda u, v: panel(f, side_u(u), v, sd)
                            + Vector((ox, oy, SH))))(front, seed),
            nu=NU, nv=NV, smooth=True)
        p[key] = CL.smooth_by_angle(
            CL.thicken(surf, HOOD_CLOTH, offset=-1.0 if front else 1.0))

    for nm, sgn in (("L", -1.0), ("R", 1.0)):
        pts, nrms = [], []
        for k in range(15):
            v = 0.030 + 0.955 * k / 14.0
            pts.append(panel(True, sgn, v) + Vector((ox, oy, SH)))
            nrms.append(Vector((sgn, 0.0, 0.0)))
        p[f"seam{nm}"] = CL.framed_sweep(f"HoodHung_Seam{nm}", pts, nrms,
                                         0.0032, 0.0022, sides=6, taper=2)
        pts, nrms = [], []
        for k in range(11):
            u = sgn * (HOOD_SPEC["neck_half"]
                       + (0.985 - HOOD_SPEC["neck_half"]) * k / 10.0)
            pts.append(Vector((ox + u * HOOD_SPEC["sh_half"], oy,
                               SH + top_edge(u, True) + 0.0010)))
            nrms.append(Vector((0.0, 0.0, 1.0)))
        p[f"shoulder{nm}"] = CL.framed_sweep(
            f"HoodHung_Shoulder{nm}", pts, nrms, 0.0062, 0.0018, sides=6,
            taper=2)

        # long sleeves, hanging much closer to the body than a tee's, and
        # anchored where the panel HAS depth rather than on its flat shoulder
        anchor = panel(True, sgn * 0.885, 0.11) + Vector((ox, oy, SH))
        root = Vector((anchor.x, oy, anchor.z + 0.0100))
        dvec = Vector((sgn * 0.40, 0.0, -0.92)).normalized()
        p[f"sleeve{nm}"] = CL.sleeve_from_body(
            f"HoodHung_Sleeve{nm}", root, dvec, 0.3450, 0.0730, 0.0455,
            droop=0.05, sides=16, steps=11, seam_in=0.0260, flat=0.62)
        sv = Vector((0.0, 0.0, 1.0)).cross(dvec).normalized()
        uv = dvec.cross(sv).normalized()
        pts, nrms = [], []
        for k in range(17):
            a = 2.0 * math.pi * k / 17
            q = root + sv * (math.cos(a) * 0.0716) + uv * (
                math.sin(a) * 0.0716 * 0.62)
            pts.append(q)
            nrms.append((q - root).normalized())
        p[f"armhole{nm}"] = CL.framed_sweep(
            f"HoodHung_Armhole{nm}", pts, nrms, 0.0026, 0.0018, closed=True,
            sides=6)
        # a hoodie DOES have a ribbed cuff -- seated ON the sleeve with the
        # closed tip proud of it, which is the whole lesson of the polo's
        # "flat disc" and the tee's hollow sleeve
        end = root + dvec * 0.3060
        p[f"cuff{nm}"] = CL.ribbed_ring(f"HoodHung_Cuff{nm}", end, dvec,
                                        0.0468, 0.0230, ribs=16, depth=0.0020)

    # THE HOOD: a rolled rim round a hole with a shell behind it, sat BEHIND
    # the neck so the hanger's hook does not show through it. Measured off the
    # panel's own neckline instead of a nominal height -- it used to float
    # clear of the shoulders like a helmet.
    neck_back = panel(False, 0.0, 0.0) + Vector((ox, oy, SH))
    # BIGGER AND LOWER. At 70 x 57 mm sat 30 mm above the neckline it read as
    # a small pod parked behind the shoulders with daylight under it. A hood is
    # nearly as wide as the neck opening and it SITS ON the neckline -- the
    # gap under it is the fault, not the shape.
    rim_c = Vector((ox, neck_back.y + 0.0230, neck_back.z + 0.0120))
    RIM_A, RIM_B = 0.0980, 0.0760
    rim_pts = []
    for s_i in range(29):
        a_i = 2 * math.pi * s_i / 28
        rim_pts.append(rim_c + Vector((math.cos(a_i) * RIM_A, 0.0,
                                       math.sin(a_i) * RIM_B))
                       + Vector((0.0, math.sin(a_i) * 0.0140, 0.0)))
    p["hood_rim"] = CL._sweep("HoodHung_Rim", rim_pts, 0.0078, sides=9)

    def hood_shell(u, v):
        a_i = 2 * math.pi * u
        depth = 0.1240 * v
        k = math.sqrt(max(0.0, 1.0 - v * v * 0.58))
        return rim_c + Vector((math.cos(a_i) * RIM_A * 1.02 * k,
                               0.0080 + depth,
                               math.sin(a_i) * RIM_B * 0.98 * k
                               - 0.0100 * v * v))
    shell = CL.grid_surface("HoodHung_Shell", hood_shell, nu=29, nv=11,
                            smooth=True)
    CL._weld_and_cap(shell)
    p["hood"] = shell

    # the cords, out of the rim and down the chest, ON the measured panel
    for ci, sgn in ((0, -1.0), (1, 1.0)):
        cpts, cn = [], []
        for k in range(9):
            t = k / 8.0
            v = 0.055 + 0.330 * t
            q = panel(True, sgn * 0.085, v) + Vector((ox, oy, SH))
            cpts.append(Vector((q.x, q.y - 0.0042, q.z)))
            cn.append(Vector((0.0, -1.0, 0.0)))
        p[f"cord{ci}"] = CL.framed_sweep(f"HoodHung_Cord{ci}", cpts, cn,
                                         0.0030, 0.0026, sides=6)

    # THE KANGAROO POCKET, conformed to the panel rather than floated in front
    # of it: a patch with a real lip at its top edge, which is what casts the
    # shadow line the reference shows.
    prings = []
    for s_i in range(13):
        t = s_i / 12.0
        uu = (t - 0.5) * 0.94
        base = panel(True, uu, 0.62) + Vector((ox, oy, SH))
        bulge = 1.0 - 0.30 * abs(t - 0.5) * 2
        ring = []
        for i2 in range(12):
            b = 2 * math.pi * i2 / 12
            ring.append(Vector((base.x,
                                base.y - 0.0100 + math.sin(b) * 0.0135 * bulge,
                                base.z + math.cos(b) * 0.0380)))
        prings.append(ring)
    p["pocket"] = CL.loft("HoodHung_Pocket", prings, smooth=True)
    lip = []
    for s_i in range(13):
        t = s_i / 12.0
        uu = (t - 0.5) * 0.96
        q = panel(True, uu, 0.545) + Vector((ox, oy, SH))
        lip.append(Vector((q.x, q.y - 0.0052, q.z)))
    p["pocket_lip"] = CL.strip("HoodHung_PocketLip", lip, 0.0078, 0.0040)

    hem, hnrm = [], []
    NH = 41
    for k in range(NH):
        t = k / (NH - 1.0)
        frontish = t < 0.5
        uu = side_u((t * 2.0) if frontish else (2.0 - t * 2.0))
        hem.append(panel(frontish, uu, 1.0) + Vector((ox, oy, SH)))
        hnrm.append(Vector((0.0, 0.0, 1.0)))
    p["hem"] = CL.framed_sweep("HoodHung_Hem", hem, hnrm, 0.0135, 0.0038,
                               sides=6, closed=True)

    p["hanger"], p["hook"] = CL.hanger(
        "HoodHung_Hanger", (ox, oy, SH + 0.0200), halfw=0.0900, drop=0.0560,
        rod=0.0058)
    return p


def trousers_folded(origin=(0, 0, 0), broken=""):
    ox, oy, oz = origin
    w, d, h = FOLD_TROU
    p = dict(CL.folded_ribbon("TrouFold", (ox, oy, oz), FOLD_TROU,
                              plies=5, sag=0.0028, crease=0.0026, seed=3.1,
                              wander=1.4))
    body = p["cloth"]
    top_at = p.pop("top_at")
    # THE FOLD END IS A FAT ROLL -- it is the whole read on the reference stack
    p["fold_roll"] = CL.fold_line("TrouFold_Roll",
                                  (ox - w * 0.46, oy - d * 0.40, oz + h * 0.52),
                                  (ox - w * 0.46, oy + d * 0.40, oz + h * 0.52),
                                  radius=h * 0.44, sides=14, sink=0.30)
    # DEEPER RELIEF. The waistband, loops and pocket were all modelled and all
    # vanished under lighting -- the review's words. Everything here is 2-3x
    # the old projection, which is what it takes to cast a shadow at the
    # distance a player stands.
    # ...but relief measured off the NOMINAL fold height is relief measured
    # off nothing. oz + h is where the block used to end; the stack's real top
    # is lower, so a 22.5 mm tube put there stood 20 mm clear of the cloth and
    # read as an open trough lying across the trousers with the belt loops
    # stranded on its rim. It sits on the MEASURED surface now, at a radius a
    # waistband actually has.
    wx = ox + w * 0.355
    wz = top_at(wx, oy) + 0.0020
    p["waistband"] = CL.fold_line("TrouFold_Waistband",
                                  (wx, oy - d * 0.40, wz),
                                  (wx, oy + d * 0.40, wz),
                                  radius=0.0115, sides=14, sink=0.55)
    for i, sgn in enumerate((-1, 1)):
        p[f"loop{i}"] = HS.box(f"TrouFold_Loop{i}",
                               (wx, oy + sgn * d * 0.21, wz + 0.0034),
                               (0.0175, 0.0092, 0.0082), bevel=0.0018)
    # a welt pocket: a raised patch with a flap over it, as the reference has
    # A WELT POCKET is two lips with a slot between them, not a slab stuck on
    # the leg. The slab read as a floating plate; the slot casts the shadow
    # that makes it read as a pocket.
    px, py = ox + w * 0.045, oy + d * 0.150
    pz = top_at(px, py)
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
    # The tee hung is PANELS now, so "body" is front and back, and a sleeve
    # sewn into a body is supposed to be inside it -- seam_in drives it there
    # on purpose. Same set the polo hung declares.
    "tee-hung": [("hanger", "hook"), ("hanger", "neck_rib"),
                 ("neck_rib", "hem")]
    + [(b, o) for b in ("front", "back")
       for o in ("hook", "hanger", "sleeveL", "sleeveR", "neck_rib", "print",
                 "hem", "seamL", "seamR", "shoulderL", "shoulderR",
                 "armholeL", "armholeR", "cuffL", "cuffR")]
    + [("front", "back")]
    + [(f"sleeve{k}", f"seam{k}") for k in ("L", "R")]
    + [(f"sleeve{k}", f"shoulder{k}") for k in ("L", "R")]
    + [(f"sleeve{k}", f"armhole{k}") for k in ("L", "R")]
    + [(f"sleeve{k}", f"cuff{k}") for k in ("L", "R")]
    + [(f"seam{k}", f"armhole{k}") for k in ("L", "R")]
    + [(f"shoulder{k}", f"armhole{k}") for k in ("L", "R")]
    + [(f"seam{k}", "hem") for k in ("L", "R")]
    + [("hanger", f"sleeve{k}") for k in ("L", "R")]
    + [("hanger", f"shoulder{k}") for k in ("L", "R")],
    "hoodie-hung": [("hanger", "hook"), ("hood", "hood_rim"),
                    ("hood", "hanger"), ("hood", "hook"),
                    ("hood_rim", "hanger"), ("hood_rim", "hook"),
                    ("pocket", "pocket_lip")]
    + [(b, o) for b in ("front", "back")
       for o in ("hook", "hanger", "sleeveL", "sleeveR", "hood", "hood_rim",
                 "pocket", "pocket_lip", "cord0", "cord1", "hem",
                 "seamL", "seamR", "shoulderL", "shoulderR",
                 "armholeL", "armholeR", "cuffL", "cuffR")]
    + [("front", "back")]
    + [(f"sleeve{k}", f"seam{k}") for k in ("L", "R")]
    + [(f"sleeve{k}", f"shoulder{k}") for k in ("L", "R")]
    + [(f"sleeve{k}", f"armhole{k}") for k in ("L", "R")]
    + [(f"sleeve{k}", f"cuff{k}") for k in ("L", "R")]
    + [(f"seam{k}", f"armhole{k}") for k in ("L", "R")]
    + [(f"shoulder{k}", f"armhole{k}") for k in ("L", "R")]
    + [(f"seam{k}", "hem") for k in ("L", "R")]
    + [("hanger", f"sleeve{k}") for k in ("L", "R")]
    + [("hanger", f"shoulder{k}") for k in ("L", "R")]
    + [("hood", f"shoulder{k}") for k in ("L", "R")]
    + [("hood_rim", f"shoulder{k}") for k in ("L", "R")]
    + [(f"cord{n}", "pocket") for n in (0, 1)]
    + [(f"cord{n}", "pocket_lip") for n in (0, 1)]
    + [(f"cord{n}", "hood_rim") for n in (0, 1)],
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
    allow = list(DEEP.get(name, ()))
    # v3: the folded garments are ONE ribbon of cloth, so "body" in the pair
    # table means the single "cloth" shell rather than a set of leaves.
    if "cloth" in mesh:
        allow = ([pr for pr in allow if "body" not in pr]
                 + [("cloth", o) for pr in allow if "body" in pr
                    for o in pr if o != "body"])
    leaves = sorted(k for k in mesh if k.startswith("leaf"))
    if leaves:
        # The folded body is a STACK now. Every pair that named "body" was
        # naming the one lofted block that used to be there, and it means all
        # of the leaves -- expanded here rather than in four hand-written
        # tables, because a pair list you have to remember to extend per
        # garment is the exact shape of fault assert_assembly exists to stop.
        allow = ([pr for pr in allow if "body" not in pr]
                 + [(lf, o) for pr in allow if "body" in pr
                    for o in pr if o != "body" for lf in leaves])
    HS.assert_all_one_piece(mesh, f"{name}: every part is one piece")
    HS.assert_assembly(mesh, f"{name}: the assembly", allow=allow)
    if leaves:
        CL.assert_leaves_clear(mesh, f"{name}: the leaves stand clear")


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
        if not broken:
            H.bake_gltf_axis(subject)
            H.export_glb(subject, os.path.join(GLB_DIR, f"apparel_{name.replace('-', '_')}.glb"))


if __name__ == "__main__":
    main()
