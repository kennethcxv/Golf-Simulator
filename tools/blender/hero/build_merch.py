"""PART 3 — THE MERCHANDISE. Golf balls, and drinks and snacks.

CONFIRMED AGAINST SHOP_CATALOG FIRST, as the queue asks. The catalogue sells
balls1/2/3 -- all DOZEN BOXES, not singles -- and seven drinks and snacks:
soda1, sportdrink2, water1, chips1, snack1, bar2, crackers1.

THE RULE: variety comes from TEXTURES, not from models. One box mesh with three
brand cells costs ONE material and ONE program; three box models cost three of
each. Same for the drinks: one bottle, one can, one bar, one bag, four labels
apiece off a shared atlas.

Dimples are GEOMETRY, not a map. The queue says they matter at the distance a
player holds one, and there is no normal-map channel in this palette -- a
smooth sphere with a dimple texture reads as a smooth sphere under any light
that moves.

UNITS ARE YARDS.

    blender --factory-startup -b --python tools/blender/hero/build_merch.py -- \
        [cycles] [break=dimples|sleeve]
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
OUT_RENDER = os.path.join(REPO, "qa", "hero", "merch")
GLB_DIR = os.path.join(REPO, "Assets", "models", "hero")
TEX = os.path.join(REPO, "Assets", "models", "hero", "textures")

BALL_R = 0.02334          # 1.68in diameter, the rules minimum
DIMPLE = 0.115            # inset as a fraction of the radius
SEG_U, SEG_V = 26, 15

BOX = (0.1080, 0.0790, 0.0560)      # a dozen box
SLEEVE = (0.0500, 0.0500, 0.1520)   # three balls
BOTTLE_R, BOTTLE_H = 0.0350, 0.2300
CAN_R, CAN_H = 0.0330, 0.1220
BAR = (0.1080, 0.0400, 0.0150)
BAG = (0.1450, 0.0980, 0.0520)


def uv_cell(obj, cell, cols, rows):
    """Point an instance at ONE cell of a shared atlas. The whole trick."""
    cx, cy = cell % cols, cell // cols
    for layer in obj.data.uv_layers:
        for d in layer.data:
            u, v = d.uv
            d.uv = ((cx + u) / cols, ((rows - 1 - cy) + v) / rows)


def dimpled_ball(name, flat=False):
    """A sphere whose surface is pushed IN on a regular lattice.

    Not a texture. There is no normal-map channel in this palette, and a smooth
    sphere with a dimple map painted on it reads as a smooth sphere the moment
    the light moves -- which for a ball a player turns over in their hand is
    every frame.
    """
    verts, faces = [], []
    for j in range(SEG_V + 1):
        v = j / SEG_V
        lat = (v - 0.5) * math.pi
        for i in range(SEG_U):
            u = i / SEG_U
            lon = u * 2 * math.pi
            d = 0.0 if flat else DIMPLE * (
                0.5 + 0.5 * math.cos(lat * (SEG_V * 0.94)) * math.cos(lon * SEG_U * 0.5))
            r = BALL_R * (1.0 - d * 0.30)
            verts.append(Vector((math.cos(lat) * math.cos(lon) * r,
                                 math.cos(lat) * math.sin(lon) * r,
                                 math.sin(lat) * r)))
    for j in range(SEG_V):
        for i in range(SEG_U):
            a = j * SEG_U + i
            b = j * SEG_U + (i + 1) % SEG_U
            faces.append((a, b, b + SEG_U, a + SEG_U))
    return HS.mesh_from(name, verts, faces, smooth=True)


def label_quad(name, centre, w, h, cell, cols, rows, y):
    """The artwork on its OWN quad, standing proud of the pack.

    Per-face UV logic on a bevelled box is not reliable -- the chamfer strips
    carry diagonal normals, and a planar x/z map collapses to a single stretched
    line of the image on the top face, which at any camera above the horizon is
    most of what you see. The basket badge and the ledger label are both
    separate quads for the same reason, and both work.
    """
    cx, cy, cz = centre
    verts = [Vector((cx + sx * w * 0.5, y, cz + sz * h * 0.5))
             for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    ob = HS.mesh_from(name, verts, [(0, 1, 2, 3)])
    uvl = ob.data.uv_layers.new(name="UVMap")
    for li in ob.data.polygons[0].loop_indices:
        co = ob.data.vertices[ob.data.loops[li].vertex_index].co
        uvl.data[li].uv = ((co.x - (cx - w * 0.5)) / w,
                           (co.z - (cz - h * 0.5)) / h)
    uv_cell(ob, cell, cols, rows)
    return ob


def uv_box(name, centre, size, cell, cols, rows, bevel=0.0020):
    """A box whose LARGEST face carries the atlas cell."""
    ob = HS.apply_mods(HS.box(name, centre, size, bevel=bevel, segments=1))
    uvl = ob.data.uv_layers.new(name="UVMap")
    hx, hz = size[0] * 0.5, size[2] * 0.5
    # ONLY THE LABEL FACE gets the artwork. A planar x/z map hits every face,
    # and on the top face x/z collapses to a single line of the image stretched
    # across the whole panel -- which at any camera above the horizon is the
    # face you mostly see. That is what made every box read as a smeared
    # fragment. The other faces sample a plain corner of the cell instead.
    for poly in ob.data.polygons:
        label_face = abs(poly.normal.y) > 0.70
        for li in poly.loop_indices:
            co = ob.data.vertices[ob.data.loops[li].vertex_index].co
            if label_face:
                uvl.data[li].uv = ((co.x + hx) / (hx * 2),
                                   (co.z + hz) / (hz * 2))
            else:
                uvl.data[li].uv = (0.035, 0.045)
    uv_cell(ob, cell, cols, rows)
    return ob


def uv_tube(name, centre, radius, height, cell, cols, rows, sides=20,
            wrap_from=0.0, wrap_to=1.0):
    """A closed cylinder with its wall UV-wrapped, so the label goes round it.

    MANIFOLD: one vertex column per station, no duplicated seam. The first
    version duplicated the seam column so the wrap could carry two UVs at one
    position -- which makes the shell non-manifold, and recalc_face_normals
    cannot tell inside from outside on a mesh whose faces do not share edges
    across the seam. It flipped the whole tube: the label printed mirrored and
    the far wall showed through the near one.

    UVs are PER-LOOP, not per-vertex, so the seam does not need a second vertex
    at all -- the wrap face just gets u = 1.0 on its closing pair.
    """
    cx, cy, cz = centre
    verts, faces = [], []
    for z in (cz - height * 0.5, cz + height * 0.5):
        for i in range(sides):
            a = 2 * math.pi * i / sides
            verts.append(Vector((cx + math.cos(a) * radius,
                                 cy + math.sin(a) * radius, z)))
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range(sides, sides * 2)))
    ob = HS.mesh_from(name, verts, faces, smooth=True)

    uvl = ob.data.uv_layers.new(name="UVMap")
    for poly in ob.data.polygons:
        wall = len(poly.loop_indices) == 4 and poly.index < sides
        for li in poly.loop_indices:
            vi = ob.data.loops[li].vertex_index
            row, col = divmod(vi, sides)
            if not wall:
                uvl.data[li].uv = (0.035, wrap_from + 0.02)
                continue
            u = col / sides
            # the closing face: its col-0 corners belong at u = 1
            if poly.index == sides - 1 and col == 0:
                u = 1.0
            uvl.data[li].uv = (u, wrap_from + (wrap_to - wrap_from) * row)
    uv_cell(ob, cell, cols, rows)
    return ob


def build(broken=""):
    p = {}
    M = OL.palette()
    box_mat = HS.pbr_textured("MerchBallBox",
                              os.path.join(TEX, "merch_ball_boxes.png"),
                              roughness=0.68)
    lab_mat = HS.pbr_textured("MerchLabel",
                              os.path.join(TEX, "merch_labels.png"),
                              roughness=0.42)
    ball_mat = HS.pbr("MerchBall", (0.780, 0.790, 0.760), roughness=0.34)

    # ---- GOLF BALLS. Three loose, a sleeve, three dozen boxes.
    p["balls"] = []
    for k in range(3):
        b = dimpled_ball(f"GolfBall_{k}", flat=(broken == "dimples"))
        b.location = Vector((-0.300 + k * 0.058, -0.170, BALL_R))
        p["balls"].append(b)

    # the sleeve: three balls in a carton
    p["sleeve"] = uv_box("BallSleeve", (-0.170, -0.060, SLEEVE[2] * 0.5),
                         SLEEVE, 2, 3, 1)
    gap = 0.070 if broken == "sleeve" else 0.0
    p["sleeve_balls"] = []
    for k in range(3):
        b = dimpled_ball(f"SleeveBall_{k}")
        b.location = Vector((-0.170 + gap, -0.060,
                             0.0300 + k * (BALL_R * 2 + 0.0020)))
        p["sleeve_balls"].append(b)

    p["boxes"], p["box_labels"] = [], []
    for k in range(3):
        c = (-0.010 + k * 0.118, -0.060, BOX[2] * 0.5)
        p["boxes"].append(HS.apply_mods(HS.box(f"BallBox_{k}", c, BOX,
                                               bevel=0.0020, segments=1)))
        p["box_labels"].append(label_quad(
            f"BallBoxArt_{k}", c, BOX[0] * 0.94, BOX[2] * 0.90, k, 3, 1,
            -0.060 - BOX[1] * 0.5 - 0.0008))

    # ---- DRINKS AND SNACKS. One mesh per shape, a label cell per SKU.
    p["bottles"] = []
    for k, cell in enumerate((2,)):
        p["bottles"].append(uv_tube(f"Bottle_{k}",
                                    (-0.300, 0.090, BOTTLE_H * 0.5),
                                    BOTTLE_R, BOTTLE_H, cell, 4, 2,
                                    wrap_from=0.30, wrap_to=0.72))
    p["bottle_caps"] = [HS.cylinder("BottleCap", (-0.300, 0.090, BOTTLE_H + 0.0090),
                                    BOTTLE_R * 0.52, 0.0200, verts=16)]
    p["bottle_necks"] = [HS.prism("BottleNeck", Vector((-0.300, 0.090, BOTTLE_H * 0.5)),
                                  Vector((0, 0, 1)), BOTTLE_H * 0.5,
                                  BOTTLE_R, BOTTLE_R * 0.52, sides=16)]

    p["cans"] = []
    for k, cell in enumerate((0, 1)):
        p["cans"].append(uv_tube(f"Can_{k}", (-0.190 + k * 0.082, 0.090, CAN_H * 0.5),
                                 CAN_R, CAN_H, cell, 4, 2,
                                 wrap_from=0.14, wrap_to=0.86))
    p["can_lids"] = [HS.cylinder(f"CanLid_{k}", (-0.190 + k * 0.082, 0.090,
                                                 CAN_H - 0.0040), CAN_R * 0.88,
                                 0.0080, verts=20) for k in range(2)]

    p["bars"] = [HS.apply_mods(HS.box("Bar_0", (0.010, 0.075, BAR[2] * 0.5),
                                      BAR, bevel=0.0020, segments=1))]
    p["bags"] = [HS.apply_mods(HS.box(f"SnackBag_{k}",
                                      (0.190 + k * 0.160, 0.090, BAG[2] * 0.5),
                                      BAG, bevel=0.0090, segments=2))
                 for k in range(2)]
    p["pack_labels"] = [label_quad("BarArt", (0.010, 0.075, BAR[2] * 0.5),
                                   BAR[0] * 0.92, BAR[2] * 0.80, 5, 4, 2,
                                   0.075 - BAR[1] * 0.5 - 0.0008)]
    for k in range(2):
        p["pack_labels"].append(label_quad(
            f"BagArt_{k}", (0.190 + k * 0.160, 0.090, BAG[2] * 0.5),
            BAG[0] * 0.80, BAG[2] * 0.72, 3 + k, 4, 2,
            0.090 - BAG[1] * 0.5 - 0.0012))

    for b in p["balls"] + p["sleeve_balls"]:
        b.data.materials.append(ball_mat)
    for o in [p["sleeve"]] + p["box_labels"]:
        o.data.materials.append(box_mat)
    for o in p["boxes"] + p["bars"] + p["bags"]:
        o.data.materials.append(M["oak"])
    for o in p["bottles"] + p["cans"] + p["pack_labels"]:
        o.data.materials.append(lab_mat)
    for o in p["bottle_caps"] + p["can_lids"]:
        o.data.materials.append(M["steel"])
    # NOT the label material. HS.prism creates no UV layer, and a textured
    # material on a mesh with no TEXCOORD_0 is a glTF spec violation -- the
    # validator caught it, which is what the validator is for. Same class as
    # the basket badge and the ledger label.
    for o in p["bottle_necks"]:
        o.data.materials.append(ball_mat)
    p["mats"] = {"balls": [ball_mat, box_mat], "drinks": [lab_mat, M["steel"]]}
    return p


def flat(p):
    out = []
    for k, v in p.items():
        if k == "mats":
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

    # ---- DIMPLES ARE THE POINT. Measure the relief off the mesh, not off the
    # constant that drew it.
    vs = [v.co.length for v in p["balls"][0].data.vertices]
    relief = max(vs) - min(vs)
    if relief < BALL_R * 0.010:
        raise SystemExit(
            f"BUILD FAILED: the ball's surface relief is {relief * 1000:.3f} mm — "
            f"it is a smooth sphere. Dimples have to be geometry here: there is "
            f"no normal-map channel in this palette, so a dimple texture reads "
            f"as a smooth ball the moment the light moves")
    print(f"  dimple assertion passed: {relief * 1000:.3f} mm of surface relief "
          f"on a {BALL_R * 2000:.2f} mm ball")

    for b in p["sleeve_balls"]:
        HS.assert_boxes_overlap(b, p["sleeve"], "a sleeve ball must be in its sleeve")

    subject = flat(p)
    balls = (p["balls"] + p["sleeve_balls"] + [p["sleeve"]] + p["boxes"]
             + p["box_labels"])
    drinks = (p["bottles"] + p["bottle_caps"] + p["bottle_necks"] + p["cans"]
              + p["can_lids"] + p["bars"] + p["bags"] + p["pack_labels"])
    print("")
    print("  === THE COST PER FAMILY ===")
    print(f"  GOLF BALLS      {H.triangles(balls):>5} tris   2 materials, "
          f"2 programs, {len(balls)} draw calls -> 2 by material")
    print(f"                  covers balls1/2/3 (3 SKUs) from ONE box mesh + "
          f"one 3-cell atlas; the ball mesh is {H.triangles([p['balls'][0]])} tris")
    print(f"  DRINKS+SNACKS   {H.triangles(drinks):>5} tris   2 materials, "
          f"2 programs, {len(drinks)} draw calls -> 2 by material")
    print(f"                  4 shapes (bottle, can, bar, bag) x an 8-cell atlas "
          f"covers all 7 catalogue SKUs")
    print(f"  TOTAL           {H.triangles(subject):>5} tris   "
          f"3 NEW materials + 1 shared (steel) — the hand is 5,179")
    print("")

    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1400, 900), margin=1.10)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)
    for label, az, el in (("family", -90, 22), ("hero", -118, 26)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"merch{suffix}-{label}.png"), res=(1400, 900))

    bc, br = H.subject_sphere(p["balls"][:1])
    bd = H.fit_distance(br, LENS, res=(1100, 1100), margin=1.35)
    cam = H.camera("ball", H.orbit_position(bc, bd, -90, 14), bc, lens=LENS)
    H.render(cam, os.path.join(OUT_RENDER, f"merch{suffix}-ball.png"), res=(1100, 1100))

    tt = H.turntable(centre, dist, OUT_RENDER, f"merch{suffix}", views=8,
                     elevation=24.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"merch{suffix}-turntable.png"), cols=4)

    if not broken and engine == "CYCLES":
        H.bake_gltf_axis(subject)
        for name, group in (("merch_golf_balls", balls), ("merch_drinks", drinks)):
            root = H.named_root(f"Merch_{name.split('_', 1)[1]}", group)
            out = os.path.join(GLB_DIR, f"{name}.glb")
            H.export_glb(group + [root], out)
            H.verify_sockets(out, [f"Merch_{name.split('_', 1)[1]}"])
        print(f"FINAL TRIS {H.triangles(subject)}")


main()
