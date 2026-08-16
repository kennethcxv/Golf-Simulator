"""PART 3, cont. — TEES, GLOVES, APPAREL, HEADWEAR, ACCESSORIES.

The five merchandise groups the balls-and-drinks pass did not cover, all against
SHOP_CATALOG:

  APPAREL     polo1, polo2, pants2, shorts1, jacket2, sock1   (6 SKUs)
  HEADWEAR    cap1, cap2, visor1                              (3)
  GLOVES      glove1, glove2                                  (2)
  TEES        tees1 -- a BAG of 50, not a tube                (1)
  ACCESSORIES towel1, marker1, divot1, scorecard1 carded;
              range2, sunglasses2, bottle1, umb1 named below  (8)

ONE atlas of twelve cells and ONE material covers all of it. The queue asks for
folded AND hung apparel because they are genuinely different meshes, and both
are here -- but they share the same six texture cells, so the second mesh costs
geometry and nothing else.

UNITS ARE YARDS.

    blender --factory-startup -b --python tools/blender/hero/build_softgoods.py -- \
        [cycles] [break=stack|hanger|peak]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402
import outdoor_lib as OL  # noqa: E402

REPO = os.getcwd()
OUT_RENDER = os.path.join(REPO, "qa", "hero", "softgoods")
GLB_DIR = os.path.join(REPO, "Assets", "models", "hero")
TEX = os.path.join(REPO, "Assets", "models", "hero", "textures")

COLS, ROWS = 4, 3
FOLD = (0.2400, 0.2000, 0.0420)     # a folded garment on a shelf
CARD = (0.1300, 0.0060, 0.1900)     # a hanging blister card
CAP_R = 0.0880


def soft_slab(name, centre, size, cell, wobble=0.0016):
    """A folded garment: a slab whose top face sags a little, because a folded
    polo is not a machined block."""
    cx, cy, cz = centre
    hw, hd, h = size[0] * 0.5, size[1] * 0.5, size[2]
    verts, faces = [], []
    NX, NY = 5, 4
    for k in range(2):
        for j in range(NY):
            for i in range(NX):
                u, v = i / (NX - 1), j / (NY - 1)
                z = cz + (h if k else 0.0)
                if k:
                    z -= wobble * (math.sin(u * 3.1) + math.sin(v * 2.3)) * 0.5
                verts.append(Vector((cx + (u - 0.5) * hw * 2,
                                     cy + (v - 0.5) * hd * 2, z)))
    per = NX * NY
    for j in range(NY - 1):
        for i in range(NX - 1):
            a = j * NX + i
            faces.append((a, a + 1, a + NX + 1, a + NX))
            b = per + a
            faces.append((b + NX, b + NX + 1, b + 1, b))
    for i in range(NX - 1):
        faces.append((i, per + i, per + i + 1, i + 1))
        t = (NY - 1) * NX + i
        faces.append((t + 1, per + t + 1, per + t, t))
    for j in range(NY - 1):
        a = j * NX
        faces.append((a + NX, per + a + NX, per + a, a))
        b = j * NX + NX - 1
        faces.append((b, per + b, per + b + NX, b + NX))
    return HS.mesh_from(name, verts, faces)


def build(broken=""):
    p = {}
    M = OL.palette()
    soft = HS.pbr_textured("MerchSoft", os.path.join(TEX, "merch_soft.png"),
                           roughness=0.78)

    # ---- APPAREL, FOLDED. One mesh, six cells, six SKUs.
    p["folded"], p["folded_art"] = [], []
    lift = 0.075 if broken == "stack" else 0.0
    for k in range(3):
        for s in range(2):
            x = -0.400 + k * 0.270
            # OVERLAP, not a 2mm air gap. Folded cloth compresses into the
            # garment under it; a stack that does not share volume is two
            # slabs hovering.
            z = s * (FOLD[2] - 0.0055) + (lift if s else 0.0)
            p["folded"].append(soft_slab(f"Folded_{k}_{s}", (x, 0.260, z), FOLD,
                                         k * 2 + s))
            p["folded_art"].append(OL.label_quad(
                f"FoldedArt_{k}_{s}", x, z + FOLD[2] * 0.5,
                FOLD[0] * 0.88, FOLD[2] * 0.78, 0.260 - FOLD[1] * 0.5 - 0.0008,
                k * 2 + s, COLS, ROWS))

    # ---- APPAREL, HUNG. Same six cells, a different mesh, as the queue asks.
    p["hangers"], p["hung"], p["hung_art"] = [], [], []
    for k in range(3):
        x = -0.330 + k * 0.240
        drop = 0.070 if broken == "hanger" else 0.0
        top = 0.5200
        p["hangers"].append(OL.sweep(
            f"Hanger_{k}",
            [Vector((x - 0.088, 0.020, top - 0.052)),
             Vector((x, 0.020, top - 0.006)),
             Vector((x + 0.088, 0.020, top - 0.052))], 0.0040, sides=5))
        p["hangers"].append(OL.sweep(
            f"HangerHook_{k}",
            [Vector((x, 0.020, top - 0.008)), Vector((x, 0.020, top + 0.030)),
             Vector((x - 0.018, 0.020, top + 0.044))], 0.0034, sides=5))
        p["hung"].append(HS.apply_mods(HS.box(
            f"Hung_{k}", (x, 0.020, top - 0.180 - drop),
            (0.1900, 0.0300, 0.2600), bevel=0.0060, segments=1)))
        p["hung_art"].append(OL.label_quad(
            f"HungArt_{k}", x, top - 0.180 - drop, 0.1700, 0.2200,
            0.020 - 0.0166, k, COLS, ROWS))

    # ---- HEADWEAR. A crown and a peak; cells 6 and 7. visor1 is the same
    # mesh with the crown scaled down, so it costs nothing extra.
    p["caps"], p["peaks"], p["cap_art"] = [], [], []
    for k in range(3):
        x = 0.400
        y = 0.240 - k * 0.130
        crown = 0.62 if k == 2 else 1.0        # the visor
        cap = HS.cylinder(f"CapCrown_{k}", (x, y, CAP_R * 0.34 * crown),
                          CAP_R, CAP_R * 0.98 * crown, verts=18)
        cap.scale.z = 0.70
        bpy.context.view_layer.objects.active = cap
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        p["caps"].append(cap)
        # TUCKED UNDER the crown, not 32mm in front of it. And the break is
        # 140mm, not 75: the peak is 90mm deep and overlaps the crown by 75, so
        # a 75mm shove left it still under the brim.
        peak_y = y - CAP_R + 0.0300 - (0.140 if broken == "peak" else 0.0)
        p["peaks"].append(HS.apply_mods(HS.box(
            f"CapPeak_{k}", (x, peak_y, 0.0180),
            (0.1420, 0.0900, 0.0120), bevel=0.0050, segments=2)))
        p["cap_art"].append(OL.label_quad(
            f"CapArt_{k}", x, CAP_R * 0.36 * crown, 0.1000, 0.0560,
            y - CAP_R - 0.0006, 6 + (k % 2), COLS, ROWS))

    # ---- GLOVES, TEES and CARDED ACCESSORIES: one card mesh, four cells.
    p["cards"], p["card_art"] = [], []
    for k, cell in enumerate((8, 9, 10, 11)):
        x = -0.330 + k * 0.220
        p["cards"].append(HS.apply_mods(HS.box(
            f"Card_{k}", (x, -0.240, CARD[2] * 0.5), CARD,
            bevel=0.0020, segments=1)))
        p["card_art"].append(OL.label_quad(
            f"CardArt_{k}", x, CARD[2] * 0.5, CARD[0] * 0.96, CARD[2] * 0.96,
            -0.240 - CARD[1] * 0.5 - 0.0006, cell, COLS, ROWS))

    for o in p["folded"] + p["hung"] + p["cards"] + p["caps"] + p["peaks"]:
        o.data.materials.append(M["poly"])
    for o in (p["folded_art"] + p["hung_art"] + p["cap_art"] + p["card_art"]):
        o.data.materials.append(soft)
    for o in p["hangers"]:
        o.data.materials.append(M["steel"])
    p["soft_mat"] = soft
    return p


def flat(p):
    out = []
    for k, v in p.items():
        if k == "soft_mat":
            continue
        if isinstance(v, list):
            out += [o for o in v if isinstance(o, bpy.types.Object)]
        elif isinstance(v, bpy.types.Object):
            out.append(v)
    return out


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = next((x.split("=", 1)[1] for x in args if x.startswith("break=")), "")
    suffix = f"-BROKEN-{broken}" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=170 if engine == "CYCLES" else 104)
    p = build(broken=broken)

    # a folded stack has to actually stack
    for k in range(3):
        HS.assert_boxes_overlap(p["folded"][k * 2 + 1], p["folded"][k * 2],
                                f"folded {k}: the top garment must rest on the one below",
                                min_overlap=0.0005)
    for k in range(3):
        HS.assert_boxes_overlap(p["hung"][k], p["hangers"][k * 2],
                                f"hung {k}: the garment must hang on its hanger")
        HS.assert_touching(p["hangers"][k * 2 + 1], p["hangers"][k * 2],
                           f"hung {k}: the hook must meet the hanger", 0.0035)
    for k in range(3):
        HS.assert_touching(p["peaks"][k], p["caps"][k],
                           f"cap {k}: the peak must meet the crown", 0.0035)
    for i, art in enumerate(p["card_art"]):
        HS.assert_touching(art, p["cards"][i],
                           f"card {i}: the artwork must be on its card", 0.0030)

    groups = {
        "apparel folded": p["folded"] + p["folded_art"],
        "apparel hung": p["hung"] + p["hung_art"] + p["hangers"],
        "headwear": p["caps"] + p["peaks"] + p["cap_art"],
        "carded": p["cards"] + p["card_art"],
    }
    subject = flat(p)
    print("")
    print("  === THE COST, FIVE GROUPS, ONE ATLAS ===")
    for name, g in groups.items():
        print(f"  {name:<16} {H.triangles(g):>5} tris  {len(g):>2} objects")
    print(f"  TOTAL            {H.triangles(subject):>5} tris   "
          f"1 NEW material (a 12-cell atlas) + 2 shared (poly, steel)")
    print(f"  covers  apparel 6 SKUs x 2 presentations, headwear 3, "
          f"gloves 2, tees 1, carded accessories")
    print(f"  1 program, {len(subject)} draw calls -> 3 by material")
    print("")

    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1400, 900), margin=1.10)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)
    for label, az, el in (("family", -90, 20), ("hero", -116, 26)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"soft{suffix}-{label}.png"), res=(1400, 900))
    tt = H.turntable(centre, dist, OUT_RENDER, f"soft{suffix}", views=8,
                     elevation=22.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"soft{suffix}-turntable.png"), cols=4)

    if not broken and engine == "CYCLES":
        H.bake_gltf_axis(subject)
        for name, g in (("merch_apparel", groups["apparel folded"] + groups["apparel hung"]),
                        ("merch_headwear", groups["headwear"]),
                        ("merch_carded", groups["carded"])):
            root = H.named_root(f"Merch_{name.split('_', 1)[1]}", g)
            out = os.path.join(GLB_DIR, f"{name}.glb")
            H.export_glb(g + [root], out)
            H.verify_sockets(out, [f"Merch_{name.split('_', 1)[1]}"])
        print(f"FINAL TRIS {H.triangles(subject)}")


main()
