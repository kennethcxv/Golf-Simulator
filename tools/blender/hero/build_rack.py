"""PART 2 — THE UNIVERSAL RACK. One gondola, three sizes, same model.

WHAT ALREADY EXISTED, photographed first as the queue asks:

  retail_gondola.glb          2,052 tris, 7 materials, 1.20 x 0.60 x 1.40
  asset_064_stockroom_...glb  2,652 tris, 3 materials, 1.83 x 0.61 x 2.13

The gondola READS CORRECTLY as a shop fixture and I am keeping it as the visual
reference. What it is not is the feature: it is one size, three FIXED shelves,
six real materials, and it exposes no measurable surface. The stockroom rack has
the better material budget but its shelf boards visibly stop short of the left
upright -- the exact "floating shelf" fault this asset has to assert against.

THE DELIVERABLE IS THE MEASURED TOP SURFACE, not the silhouette. Per shelf:
usable top rectangle, front lip height, clear height to the shelf above. Those
feed the footprint-aware packer that already exists for the counter, and a
beautiful gondola with no measurable surface fixes nothing.

Materials: FOUR, all from the shared library the outdoor tools use. Zero new.

UNITS ARE YARDS.

    blender --factory-startup -b --python tools/blender/hero/build_rack.py -- \
        [cycles] [break=shelves|lip|kick]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402
import outdoor_lib as OL  # noqa: E402

REPO = os.getcwd()
OUT_RENDER = os.path.join(REPO, "qa", "hero", "rack")
GLB_DIR = os.path.join(REPO, "Assets", "models", "hero")

WIDTH = 1.2000           # bay width, outside of upright to outside of upright
DEPTH = 0.4600
POST_W, POST_D = 0.0340, 0.0440
SHELF_T = 0.0190
LIP_H = 0.0260
SEAT = 0.0130            # how far a shelf runs INTO its upright
KICK_H = 0.0900
BACK_T = 0.0080

# low: see over it. standard: the floor run. tall: the back wall.
SIZES = [("low", 0.9000, 2, -1.5000), ("standard", 1.5000, 4, 0.0000),
         ("tall", 2.0500, 5, 1.5000)]


SLOT_N = 18              # punched slots down each upright
SLOT_W = 0.0110
SLOT_H = 0.0225
SLOT_D = 0.0055          # how far into the upright the slot is punched


def _slot(post, height, sx):
    """Punch the shelf-slot column into one upright.

    The one feature that makes shelving read as SHOP shelving rather than as a
    bookcase, and it was missing entirely. Cut, not painted: a boolean of one
    joined cutter per post, so it is a real recess that catches raking light.
    This is the largest object in the shop and the player walks its length.
    """
    lo = height * 0.10
    span = height * 0.80
    cutters = []
    for i in range(SLOT_N):
        z = lo + span * i / (SLOT_N - 1.0)
        # SHALLOW, and on the INNER face only. Cutting the full POST_W went
        # straight through the upright, and the very next shelf landed in the
        # void it left -- assert_rooted caught it on the first build, which is
        # the check doing exactly its job.
        cutters.append(HS.box(
            f"{post.name}_s{i}",
            (post.location.x - sx * (POST_W * 0.5 - SLOT_D * 0.5),
             post.location.y, z),
            (SLOT_D, SLOT_W, SLOT_H)))
    cut = HS.join(cutters, f"{post.name}_slots")
    m = post.modifiers.new("Slots", "BOOLEAN")
    m.operation, m.object, m.solver = "DIFFERENCE", cut, "EXACT"
    out = HS.apply_mods(post)
    bpy.data.objects.remove(cut, do_unlink=True)
    return out


def build_one(M, label, height, shelves, x0, broken=""):
    """One gondola. `x0` only parks it beside the others for the group shot."""
    p = {"label": label, "height": height, "shelves": [], "lips": []}
    hw, hd = WIDTH * 0.5, DEPTH * 0.5

    # ---- four uprights
    p["posts"] = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            p["posts"].append(HS.apply_mods(HS.box(
                f"{label}_Post_{sx}_{sy}".replace("-", "n"),
                (x0 + sx * (hw - POST_W * 0.5), sy * (hd - POST_D * 0.5),
                 height * 0.5),
                (POST_W, POST_D, height), bevel=0.0035, segments=2)))

    # ---- BASE FEET. A gondola upright does not meet the floor: it stands on a
    # levelling foot, and that foot is wider than the post so the whole run
    # reads as standing ON something rather than growing out of the boards.
    #
    # Worth doing where the slot columns were not, and for a reason the slot
    # measurement gave me: a foot changes the SILHOUETTE. The slots were a
    # 5.5 mm recess on an inner face -- interior detail, invisible at walking
    # distance, and it doubled the bay. Four feet are 96 triangles and they
    # change the outline against the floor, which is the one thing that reads
    # from across a shop.
    p["feet"] = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            p["feet"].append(HS.apply_mods(HS.box(
                f"{label}_Foot_{sx}_{sy}".replace("-", "n"),
                (x0 + sx * (hw - POST_W * 0.5), sy * (hd - POST_D * 0.5),
                 0.0075),
                (POST_W * 1.75, POST_D * 1.55, 0.0150),
                bevel=0.0028, segments=2)))

    # SLOT COLUMNS: TRIED AND REMOVED. A real gondola upright carries a punched
    # column of shelf slots, and _slot() below cuts one. Measured: it took the
    # standard bay from 872 to 1,736 triangles -- it DOUBLED the bay -- and at
    # the distance a player walks past shelving a 5.5 mm recess on an inner
    # face does not read at all. Kept in the file, not called, because the
    # measurement is the useful part: if this ever wants doing it wants doing
    # in the texture, not the mesh.

    # ---- back panel, let into the rear posts
    p["back"] = HS.apply_mods(HS.box(
        f"{label}_Back", (x0, hd - POST_D * 0.5, height * 0.5 + KICK_H * 0.35),
        (WIDTH - POST_W * 0.6, BACK_T, height - KICK_H * 0.7),
        bevel=0.0020, segments=1))

    # ---- kick plate at the base
    # FORWARD out of the posts, not down. The posts are full-height columns, so
    # dropping the kick plate 70mm left it still overlapping them and the
    # control passed.
    kick_out = 0.080 if broken == "kick" else 0.0
    p["kick"] = HS.apply_mods(HS.box(
        f"{label}_Kick", (x0, -hd + POST_D * 0.5 - kick_out, KICK_H * 0.5),
        (WIDTH - POST_W * 0.6, 0.0140, KICK_H), bevel=0.0020, segments=1))

    # ---- adjustable shelves. Every one runs SEAT into its uprights.
    # SHORTEN the shelf so its ends no longer reach the uprights. Floating it
    # UP left it between the same full-height posts and still seated -- the real
    # fault, and the one the stockroom rack has, is a board that stops short of
    # the upright. 40mm against a 13mm seat exceeds the overlap it undoes.
    short = 0.0800 if broken == "shelves" else 0.0
    float_up = 0.0
    span = height - KICK_H - 0.1100
    for i in range(shelves):
        z = KICK_H + 0.0700 + span * (i / max(1, shelves - 1)) * 0.92
        p["shelves"].append(HS.apply_mods(HS.box(
            f"{label}_Shelf_{i}",
            (x0, 0.0, z + float_up),
            (WIDTH - POST_W * 2 + SEAT * 2 - short, DEPTH - POST_D - 0.0060,
             SHELF_T), bevel=0.0020, segments=1)))
        # front lip. 0.040 of lip against a 0.026 lip is a break that exceeds
        # the overlap it undoes.
        lip_gap = 0.040 if broken == "lip" else 0.0
        p["lips"].append(HS.apply_mods(HS.box(
            f"{label}_Lip_{i}",
            (x0, -hd + POST_D * 0.5 + 0.0100,
             z + SHELF_T * 0.5 + LIP_H * 0.5 - 0.0060 + lip_gap),
            (WIDTH - POST_W * 2 + SEAT * 2, 0.0110, LIP_H),
            bevel=0.0018, segments=1)))

    for o in p["posts"] + p["feet"]:
        o.data.materials.append(M["poly"])
    p["back"].data.materials.append(M["poly"])
    p["kick"].data.materials.append(M["poly"])
    for o in p["shelves"]:
        o.data.materials.append(M["oak"])
    for o in p["lips"]:
        o.data.materials.append(M["steel"])
    # A PART WITH NO MATERIAL RENDERS DEFAULT WHITE, and that is how the feet
    # came out of their first render: correct geometry, right place, glowing
    # against a charcoal post. The same empty-slot fault the booleans hit. It
    # is one loop to make it impossible rather than remembered.
    bare = [o.name for o in flat(p) if not o.data.materials]
    if bare:
        raise SystemExit(
            "BUILD FAILED: parts with no material, which render default "
            "white: " + ", ".join(sorted(bare)))
    return p


def measure(p):
    """The deliverable. Read off the geometry, not off the constants."""
    rows = []
    left, right = p["posts"][0], p["posts"][2]
    inner_lo = max((left.matrix_world @ v.co).x for v in left.data.vertices)
    inner_hi = min((right.matrix_world @ v.co).x for v in right.data.vertices)
    tops = []
    for i, sh in enumerate(p["shelves"]):
        vs = [sh.matrix_world @ v.co for v in sh.data.vertices]
        top = max(v.z for v in vs)
        y0, y1 = min(v.y for v in vs), max(v.y for v in vs)
        lip_vs = [p["lips"][i].matrix_world @ v.co for v in p["lips"][i].data.vertices]
        lip_top = max(v.z for v in lip_vs)
        lip_y1 = max(v.y for v in lip_vs)
        tops.append(top)
        rows.append({
            "i": i, "top": top,
            # usable rectangle: between the uprights, and BEHIND the lip
            "w": inner_hi - inner_lo,
            "d": y1 - lip_y1,
            "lip": lip_top - top,
        })
    for i, r in enumerate(rows):
        r["clear"] = (rows[i + 1]["top"] - SHELF_T - r["top"]) if i + 1 < len(rows) \
            else (p["height"] - r["top"])
    return rows


def flat(p):
    """Every mesh in the bay, and CHECKED that it is every mesh.

    The feet were built, placed and then not listed here, so they were not
    counted, not asserted over, and not exported -- the bay still reported 872
    triangles with four new parts in the scene. A hand-written list of parts
    that has to be kept in step with the builder is the same fault shape as a
    hand-written list of assertion pairs, and it fails the same way: silently,
    on whatever was added last.
    """
    out = list(p["posts"]) + list(p["shelves"]) + list(p["lips"])         + list(p["feet"]) + [p["back"], p["kick"]]
    listed = {id(o) for o in out}
    missing = []
    for key, val in p.items():
        for ob in (val if isinstance(val, list) else [val]):
            if (hasattr(ob, "data") and getattr(ob.data, "vertices", None)
                    is not None and id(ob) not in listed):
                missing.append(f"{key}:{ob.name}")
    if missing:
        raise SystemExit(
            "BUILD FAILED: parts built but never listed in flat(), so nothing "
            "counts, checks or exports them: " + ", ".join(sorted(missing)))
    return out


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = next((x.split("=", 1)[1] for x in args if x.startswith("break=")), "")
    suffix = f"-BROKEN-{broken}" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=160 if engine == "CYCLES" else 100)
    M = OL.palette()
    racks = [build_one(M, lbl, h, n, x0, broken=broken)
             for (lbl, h, n, x0) in SIZES]

    for p in racks:
        # every shelf SEATED in its uprights, and the lip on the shelf
        HS.assert_rooted(p["shelves"], p["posts"][0],
                         f"{p['label']}: shelves seated in the left front upright",
                         min_verts=2, min_depth=0.0020)
        HS.assert_rooted(p["shelves"], p["posts"][2],
                         f"{p['label']}: shelves seated in the right front upright",
                         min_verts=2, min_depth=0.0020)
        for i, lip in enumerate(p["lips"]):
            HS.assert_touching(lip, p["shelves"][i],
                               f"{p['label']}: lip {i} must be on its shelf", 0.0025)
        HS.assert_boxes_overlap(p["kick"], p["posts"][0],
                                f"{p['label']}: the kick plate must meet the uprights")
        HS.assert_boxes_overlap(p["back"], p["posts"][1],
                                f"{p['label']}: the back panel must be let into the posts")

    print("")
    print("  === THE MEASURED TOP SURFACES (YARDS) — this is the deliverable ===")
    print("  size      shelf   usable top W x D    lip     clear above")
    total = 0
    for p in racks:
        for r in measure(p):
            print(f"  {p['label']:<9} {r['i']:<6} "
                  f"{r['w']:.4f} x {r['d']:.4f}   {r['lip']:.4f}  {r['clear']:.4f}")
        total += len(p["shelves"])
    print(f"  {total} shelves across three sizes, all from ONE model")
    print("")

    subject = [o for p in racks for o in flat(p)]
    one = flat(racks[1])
    print(f"TRIS {H.triangles(one)} for the standard bay "
          f"({len(one)} objects) — the hand is 5,179; "
          f"the existing gondola is 2,052 in 7 materials")
    print(f"  4 shared materials from outdoor_lib (poly, oak, steel + none new), "
          f"0 new for the whole rack family")

    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1400, 900), margin=1.10)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)
    for label, az, el in (("family", -90, 12), ("hero", -122, 18)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"rack{suffix}-{label}.png"), res=(1400, 900))

    sc, sr = H.subject_sphere(one)
    sd = H.fit_distance(sr, LENS, res=(1100, 1100), margin=1.14)
    tt = H.turntable(sc, sd, OUT_RENDER, f"rack{suffix}", views=8,
                     elevation=16.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"rack{suffix}-turntable.png"), cols=4)
    for label, az, el in (("bay", -120, 16), ("shelf", -90, 34), ("seat", -60, 4)):
        cam = H.camera(label, H.orbit_position(sc, sd, az, el), sc, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"rack{suffix}-{label}.png"), res=(1100, 1100))

    if not broken and engine == "CYCLES":
        for p in racks:
            parts = flat(p)
            for o in parts:
                o.location.x -= dict((s[0], s[3]) for s in SIZES)[p["label"]]
            bpy.context.view_layer.update()
            bpy.ops.object.select_all(action="DESELECT")
            for o in parts:
                o.select_set(True)
            bpy.context.view_layer.objects.active = parts[0]
            bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
            H.bake_gltf_axis(parts)
            root = H.named_root(f"Fixture_rack_{p['label']}", parts)
            out = os.path.join(GLB_DIR, f"retail_rack_{p['label']}.glb")
            H.export_glb(parts + [root], out)
            H.verify_sockets(out, [f"Fixture_rack_{p['label']}"])
        print(f"FINAL TRIS standard bay {H.triangles(one)}")


# Guarded so the module can be IMPORTED without building. An unguarded main()
# meant every audit that imported a builder silently re-rendered and re-exported
# its asset as a side effect. Blender runs a --python script as __main__, so the
# command line is unchanged.
if __name__ == "__main__":
    main()
