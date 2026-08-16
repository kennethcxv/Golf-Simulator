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

# Which atlas cell each garment wears. Twelve colourways, ONE material -- the
# eight meshes between them cost the shop two programs, not sixteen.
CELL = {"polo-folded": 2, "polo-hung": 0, "tee-folded": 1, "tee-hung": 7,
        "hoodie-folded": 6, "hoodie-hung": 9, "trousers-folded": 4, "cap": 5}
TRIM_CELL = 11


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
                                 halfw=w * 0.205, back=d * 0.150,
                                 forward=d * 0.135, spread=1.72,
                                 reach=d * 0.150, thick=0.0062, lift=0.0155)

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
    p["hanger"] = CL.hanger("PoloHung_Hanger", (ox, oy, SH), halfw=0.0880,
                            drop=0.0540, rod=0.0058)
    p["body"] = CL.draped("PoloHung_Body", SH - 0.0130, 0.2050, 0.2320,
                          0.3050, 0.0760, centre=(ox, oy), neck=0.0300,
                          shoulder_drop=0.0140)
    for side in (-1, 1):
        nm = "L" if side < 0 else "R"
        p[f"sleeve{nm}"] = CL.sleeve(
            f"PoloHung_Sleeve{nm}",
            (ox + side * 0.0800, oy, SH - 0.0300),
            (side * 0.62, 0, -0.78), 0.1150, 0.0330, 0.0270, droop=0.10)
    # The collar wraps the NECK OPENING, which is well below the shoulder peaks:
    # placed level with the shoulders it stood 20 mm above the shirt and out the
    # back of it, and assert_assembly called it loose. Both numbers come from
    # the drape's own parameters now.
    neck_z = SH - 0.0130 - 0.0140 - 0.0300
    p["collar"] = CL.collar("PoloHung_Collar", (ox, oy - 0.0100, neck_z + 0.0200),
                            halfw=0.0430, depth=0.0200, height=0.0190,
                            thickness=0.0060, sink=0.0060)
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
    for i, t in enumerate((0.18, 0.55)):
        z = neck_z - 0.0060 - 0.0880 * t
        p[f"button{i}"] = HS.cylinder(
            f"PoloHung_Button{i}",
            (ox, CL.surface_y(p["body"], ox, z) - R * 0.30, z),
            0.0056, 0.0026, verts=12,
            rotation=Quaternion((1, 0, 0), math.pi / 2))
    return p


def tee_folded(origin=(0, 0, 0), broken=""):
    ox, oy, oz = origin
    w, d, h = FOLD_TEE
    p = {"body": CL.folded("TeeFold_Body", (ox, oy, oz), FOLD_TEE,
                           leaves=4, sag=0.0026, crease=0.0022, seed=1.7)}
    # the neck rib shows as a shallow arc near the back edge
    arc = []
    for s in range(11):
        t = s / 10.0
        a = math.pi * (0.18 + 0.64 * t)
        arc.append(Vector((ox + math.cos(a) * w * 0.16,
                           oy + d * 0.22 + math.sin(a) * d * 0.10,
                           oz + h - 0.0030)))
    p["neck_rib"] = CL._sweep("TeeFold_NeckRib", arc, 0.0072, sides=8)
    p["sleeve_ridge"] = CL.fold_line(
        "TeeFold_SleeveRidge",
        (ox - w * 0.38, oy + d * 0.02, oz + h - 0.0038),
        (ox + w * 0.34, oy - d * 0.12, oz + h - 0.0044),
        radius=0.0105, sink=0.55)
    return p


def tee_hung(origin=(0, 0, 0), broken=""):
    ox, oy, oz = origin
    p = {}
    SH = oz + 0.3100
    p["hanger"] = CL.hanger("TeeHung_Hanger", (ox, oy, SH), halfw=0.0860,
                            drop=0.0520, rod=0.0058)
    p["body"] = CL.draped("TeeHung_Body", SH - 0.0120, 0.2000, 0.2280,
                          0.2950, 0.0720, centre=(ox, oy), neck=0.0250,
                          shoulder_drop=0.0130)
    for side in (-1, 1):
        nm = "L" if side < 0 else "R"
        p[f"sleeve{nm}"] = CL.sleeve(
            f"TeeHung_Sleeve{nm}",
            (ox + side * 0.0780, oy, SH - 0.0280),
            (side * 0.66, 0, -0.75), 0.1000, 0.0325, 0.0280, droop=0.10)
    ring = []
    for s in range(19):
        a = 2 * math.pi * s / 18.0
        ring.append(Vector((ox + math.cos(a) * 0.0330,
                            oy + math.sin(a) * 0.0180,
                            SH - 0.0150 - 0.0040 * math.cos(a))))
    p["neck_rib"] = CL._sweep("TeeHung_NeckRib", ring, 0.0062, sides=8)
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
    p["hood"] = CL.fold_line("HoodFold_Hood",
                             (ox - w * 0.30, oy + d * 0.20, hz),
                             (ox + w * 0.30, oy + d * 0.20, hz),
                             radius=0.0290, sides=14, sink=0.62)
    p["cord"] = HS.cylinder("HoodFold_Cord",
                            (ox - w * 0.05, oy - d * 0.06,
                             CL.top_z(p["body"], ox - w * 0.05, oy - d * 0.06)
                             - 0.0008),
                            0.0032, 0.1000, verts=8,
                            rotation=Quaternion((0, 1, 0), math.pi / 2))
    return p


def hoodie_hung(origin=(0, 0, 0), broken=""):
    ox, oy, oz = origin
    p = {}
    SH = oz + 0.3600
    p["hanger"] = CL.hanger("HoodHung_Hanger", (ox, oy, SH), halfw=0.0900,
                            drop=0.0560, rod=0.0058)
    p["body"] = CL.draped("HoodHung_Body", SH - 0.0150, 0.2350, 0.2450,
                          0.3400, 0.1050, centre=(ox, oy), neck=0.0180,
                          shoulder_drop=0.0150)
    # THE HOOD IS THE SILHOUETTE: a big soft roll sitting behind the shoulders
    rings = []
    for s in range(13):
        t = s / 12.0
        a = math.pi * t
        cx = ox + math.cos(a) * 0.0800
        cz = SH - 0.0200 + math.sin(a) * 0.0620
        r = 0.0300 + 0.0130 * math.sin(math.pi * t)
        ring = []
        for i in range(12):
            b = 2 * math.pi * i / 12
            ring.append(Vector((cx + math.cos(b) * r * 0.55,
                                oy + 0.0180 + math.sin(b) * r,
                                cz + math.cos(b) * r * 0.52)))
        rings.append(ring)
    p["hood"] = CL.loft("HoodHung_Hood", rings, smooth=True)
    for side in (-1, 1):
        nm = "L" if side < 0 else "R"
        p[f"sleeve{nm}"] = CL.sleeve(
            f"HoodHung_Sleeve{nm}",
            (ox + side * 0.0920, oy, SH - 0.0340),
            (side * 0.40, 0, -0.92), 0.2100, 0.0430, 0.0300, droop=0.06)
        p[f"cord{nm}"] = HS.cylinder(
            f"HoodHung_Cord{nm}", (ox + side * 0.0170, oy - 0.0430,
                                   SH - 0.0900),
            0.0030, 0.0900, verts=8)
    # kangaroo pocket: a band across the lower front
    prings = []
    for s in range(11):
        t = s / 10.0
        x = ox + (t - 0.5) * 0.1750
        ring = []
        for i in range(10):
            b = 2 * math.pi * i / 10
            ring.append(Vector((x, oy - 0.0470 + math.sin(b) * 0.0110,
                                SH - 0.2150 + math.cos(b) * 0.0330)))
        prings.append(ring)
    p["pocket"] = CL.loft("HoodHung_Pocket", prings, smooth=True)
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
    p["waistband"] = CL.fold_line("TrouFold_Waistband",
                                  (ox + w * 0.36, oy - d * 0.40, oz + h - 0.0060),
                                  (ox + w * 0.36, oy + d * 0.40, oz + h - 0.0060),
                                  radius=0.0130, sides=12, sink=0.42)
    for i, s in enumerate((-1, 1)):
        p[f"loop{i}"] = HS.box(f"TrouFold_Loop{i}",
                               (ox + w * 0.36, oy + s * d * 0.20, oz + h - 0.0018),
                               (0.0170, 0.0090, 0.0042))
    p["pocket"] = HS.box("TrouFold_Pocket",
                         (ox + w * 0.06, oy + d * 0.14, oz + h - 0.0026),
                         (0.0620, 0.0450, 0.0022))
    return p


def cap(origin=(0, 0, 0), broken=""):
    """Six panels, a button, eyelets, a curved brim, a rear adjuster."""
    ox, oy, oz = origin
    p = {}
    R = 0.0930
    rings = []
    LAT = 11
    for k in range(LAT + 1):
        t = k / LAT
        # stop just short of the pole: a ring of radius zero is a
        # degenerate cap and leaves the crown an open surface, which
        # assert_assembly now refuses to measure
        a = (math.pi * 0.5) * t * 0.93
        r = R * math.cos(a) ** 0.78
        z = oz + R * 0.86 * math.sin(a)
        ring = []
        SEG = 36
        for i in range(SEG):
            b = 2 * math.pi * i / SEG
            # six panel seams: a shallow crease every 60 degrees
            seam = 1.0 - 0.016 * abs(math.cos(3.0 * b)) ** 6
            ring.append(Vector((ox + math.cos(b) * r * seam,
                                oy + math.sin(b) * r * seam * 0.96,
                                z)))
        rings.append(ring)
    p["crown"] = CL.loft("Cap_Crown", rings, close_bottom=True,
                         close_top=True, smooth=True)
    p["button"] = HS.cylinder("Cap_Button", (ox, oy, oz + R * 0.86 - 0.0015),
                              0.0068, 0.0060, verts=12)
    for i in range(6):
        b = math.pi / 6 + 2 * math.pi * i / 6
        p[f"eyelet{i}"] = HS.cylinder(
            f"Cap_Eyelet{i}",
            (ox + math.cos(b) * R * 0.56, oy + math.sin(b) * R * 0.54,
             oz + R * 0.62),
            0.0034, 0.0050, verts=8)
    # the brim: a curved tongue, thicker at the root
    brings = []
    STEPS = 10
    for s in range(STEPS + 1):
        t = s / STEPS
        y = oy - R * 0.62 - 0.1050 * t
        droop = -0.0230 * t * t
        halfw = R * (0.99 - 0.30 * t * t)
        th = 0.0075 * (1.0 - 0.45 * t)
        ring = []
        for i in range(18):
            a = 2 * math.pi * i / 18
            ring.append(Vector((ox + math.cos(a) * halfw,
                                y + math.sin(a) * th * 0.35,
                                oz + 0.0180 + droop + math.sin(a) * th
                                - (1 - math.cos(a)) * 0.0)))
        brings.append(ring)
    p["brim"] = CL.loft("Cap_Brim", brings, smooth=True)
    if broken == "peak":
        p["brim"].location.y -= 0.045
    # the rear adjuster strap
    p["adjuster"] = HS.box("Cap_Adjuster",
                           (ox, oy + R * 0.80, oz + 0.0230),
                           (0.0560, 0.0130, 0.0060))
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
    "polo-folded": [("body", "sleeve_ridge")],
    "tee-folded": [("body", "sleeve_ridge"), ("body", "neck_rib")],
    "hoodie-folded": [("body", "hood"), ("body", "cord")],
    "polo-hung": [("body", "hanger"), ("body", "collar"), ("body", "sleeveL"),
                  ("body", "sleeveR"), ("body", "placket"),
                  ("hanger", "sleeveL"), ("hanger", "sleeveR"),
                  ("hanger", "collar")],
    "tee-hung": [("body", "hanger"), ("body", "sleeveL"), ("body", "sleeveR"),
                 ("body", "neck_rib"), ("hanger", "sleeveL"),
                 ("hanger", "sleeveR"), ("hanger", "neck_rib")],
    "hoodie-hung": [("body", "hanger"), ("body", "sleeveL"), ("body", "sleeveR"),
                    ("body", "hood"), ("body", "pocket"), ("body", "cordL"),
                    ("body", "cordR"), ("hanger", "hood"), ("hanger", "sleeveL"),
                    ("hanger", "sleeveR"), ("hood", "sleeveL"),
                    ("hood", "sleeveR")],
    "cap": [("crown", "brim"), ("crown", "adjuster"), ("crown", "button")]
           + [("crown", f"eyelet{i}") for i in range(6)],
    "trousers-folded": [("body", "fold_roll"), ("body", "waistband"),
                        ("body", "pocket"), ("fold_roll", "waistband")],
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
            hard = any(k in key for k in ("button", "hanger", "eyelet", "tag"))
            CL.texture_into_cell(ob, TRIM_CELL if hard else CELL[name])
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
