"""HERO ASSET — THE LEDGER BOOK. Closed, open, and a leaf mid-turn.

The only asset the player STUDIES rather than glances at, so it gets the things
a book actually has: cloth-over-board covers with a squared overhang, a rounded
spine with raised bands, a page block with real thickness and an UNEVEN
fore-edge, and a ribbon marker.

The open state needs a proper GUTTER -- two pages falling away into a spine, not
a flat card with a line drawn down it -- and a leaf that is its own object so it
can move, not a welded slab.

UNITS ARE YARDS, matching the game.

    blender --factory-startup -b --python tools/blender/hero/build_ledger.py -- [cycles] [closed] [break-gutter]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402

REPO = os.getcwd()
OUT_RENDER = os.path.join(REPO, "qa", "hero", "ledger")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "ledger_book.glb")

PAGE_W = 0.2150          # one page, spine to fore-edge
PAGE_D = 0.3050          # head to tail
BLOCK_T = 0.0420         # the page block's thickness, one half
BOARD_T = 0.0055
SQUARE = 0.0060          # how far the board overhangs the block
SPINE_R = 0.0300
GUTTER_DROP = 0.0165     # how far the pages fall into the gutter
LEAVES = 9               # individually modelled top leaves
COLS, ROWS = 15, 9


def page_surface(name, side, drop, lift=0.0, curl=0.0, z0=0.0):
    """One page: flat at the fore-edge, falling into the gutter at the spine.

    `drop` is the gutter depth. A page that is flat all the way to the spine is
    the "flat card with a line down it" read -- what makes a book look like a
    book is that the paper CURVES down into the binding.
    """
    verts, faces = [], []
    for j in range(ROWS):
        v = j / (ROWS - 1)
        y = (v - 0.5) * PAGE_D
        for i in range(COLS):
            u = i / (COLS - 1)
            x = side * (u * PAGE_W)
            # gutter: a smooth fall over the inner third
            g = drop * math.exp(-((u / 0.34) ** 2))
            # the sheet bows very slightly across its width
            bow = 0.0016 * math.sin(math.pi * u) * math.sin(math.pi * v)
            z = z0 - g + bow
            if lift:
                # a leaf mid-turn: rotate about the spine and let it curl
                a = lift * (u ** 0.85)
                r = u * PAGE_W
                x = side * (r * math.cos(a))
                z = z0 + r * math.sin(a) + curl * (u ** 2.2) - g * (1 - u)
            verts.append(Vector((x, y, z)))
    for j in range(ROWS - 1):
        for i in range(COLS - 1):
            a = j * COLS + i
            faces.append((a, a + 1, a + COLS + 1, a + COLS))
    ob = HS.mesh_from(name, verts, faces, smooth=True)
    uvl = ob.data.uv_layers.new(name="UVMap")
    for poly in ob.data.polygons:
        for li in poly.loop_indices:
            vi = ob.data.loops[li].vertex_index
            j, i = divmod(vi, COLS)
            # FLIP U ON THE LEFT PAGE. Its geometry is mirrored in x, so the
            # same UVs print the ruling backwards -- the margin rule ends up on
            # the fore-edge and the column headings read right-to-left.
            u = i / (COLS - 1)
            uvl.data[li].uv = (u if side > 0 else 1.0 - u, j / (ROWS - 1))
    solid = ob.modifiers.new("Paper", "SOLIDIFY")
    solid.thickness = 0.00035
    solid.offset = 0.0
    return HS.apply_mods(ob)


def block(name, side, top_z, thickness, broken=False):
    """The page block: a wedge whose FORE-EDGE is uneven.

    A clean-cut block reads as a plastic slab. Real paper stacks are ragged at
    the fore-edge and that ragged line is most of what says "paper" at a glance.
    """
    verts, faces = [], []
    LAYERS = 13
    for k in range(LAYERS):
        t = k / (LAYERS - 1)
        z = top_z - thickness * t
        for j in range(ROWS):
            v = j / (ROWS - 1)
            y = (v - 0.5) * PAGE_D
            # the fore-edge wobbles per layer and along the page
            wob = 0.0016 * math.sin(k * 2.3 + v * 5.1) + 0.0011 * math.sin(v * 11.0 + k)
            w = PAGE_W - 0.0012 + wob
            g = GUTTER_DROP * (1 - t) * 0.35
            verts.append(Vector((side * (w), y, z - g)))
            verts.append(Vector((side * 0.0020, y, z - g * 1.6)))
    per = ROWS * 2
    for k in range(LAYERS - 1):
        for j in range(ROWS - 1):
            a = k * per + j * 2
            faces.append((a, a + 2, a + per + 2, a + per))          # fore-edge
            faces.append((a + 1, a + per + 1, a + per + 3, a + 3))  # spine side
    # head and tail
    for k in range(LAYERS - 1):
        a = k * per
        faces.append((a, a + per, a + per + 1, a + 1))
        b = k * per + (ROWS - 1) * 2
        faces.append((b, b + 1, b + per + 1, b + per))
    # top and bottom caps
    for j in range(ROWS - 1):
        faces.append((j * 2, j * 2 + 1, (j + 1) * 2 + 1, (j + 1) * 2))
        base = (LAYERS - 1) * per
        faces.append((base + j * 2, base + (j + 1) * 2,
                      base + (j + 1) * 2 + 1, base + j * 2 + 1))
    return HS.mesh_from(name, verts, faces, smooth=False)


def build(opened=True, broken=False):
    parts = {}
    half = BLOCK_T

    # ---- boards, with the square (overhang) a hardback actually has
    boards = []
    for side in (-1, 1):
        b = HS.box(f"Board_{'L' if side < 0 else 'R'}",
                   (side * (PAGE_W * 0.5 + SQUARE * 0.5),
                    0, -half - BOARD_T * 0.5 - 0.0015),
                   (PAGE_W + SQUARE, PAGE_D + SQUARE * 2, BOARD_T),
                   bevel=0.0016, segments=2)
        boards.append(HS.apply_mods(b))
    parts["boards"] = boards

    # ---- spine: a rounded strip bridging the boards, with raised bands
    sv, sf = [], []
    SEG = 11
    for k in range(SEG):
        a = math.pi * (k / (SEG - 1))
        x = -math.cos(a) * SPINE_R * 0.30
        z = -half - BOARD_T - 0.0015 - math.sin(a) * SPINE_R * 0.42
        for j in (0, 1):
            sv.append(Vector((x, (j - 0.5) * (PAGE_D + SQUARE * 2), z)))
    for k in range(SEG - 1):
        a = k * 2
        sf.append((a, a + 1, a + 3, a + 2))
    spine = HS.mesh_from("LedgerSpine", sv, sf, smooth=True)
    sol = spine.modifiers.new("Board", "SOLIDIFY")
    sol.thickness = BOARD_T
    sol.offset = 1.0
    sol.use_rim = True
    parts["spine"] = HS.apply_mods(spine)

    # ---- page blocks and the leaves that sit on them
    pages, leaves = [], []
    for side in (-1, 1):
        pages.append(block(f"Block_{'L' if side < 0 else 'R'}", side, -0.0004,
                           half - 0.0035))
    parts["blocks"] = pages

    # THE DELIBERATELY BROKEN VARIANT flattens the gutter, which is the fault
    # this asset is most likely to ship with: two pages that meet at a drawn
    # line instead of falling away into a binding.
    drop = 0.0 if broken else GUTTER_DROP
    for n in range(LEAVES):
        side = -1 if n < LEAVES // 2 else 1
        k = n if side < 0 else n - LEAVES // 2
        z = -0.0004 + 0.00042 * (k + 1)
        leaves.append(page_surface(f"Leaf_{n}", side, drop, z0=z))
    # ---- THE LEAF MID-TURN: its own object, lifted off the spine and curling
    turning = page_surface("LeafTurning", 1, drop, lift=1.22,
                           curl=-0.028, z0=0.0032)
    parts["leaves"] = leaves
    parts["turning"] = turning

    # ---- ribbon marker out of the spine
    rv, rf = [], []
    RS = 9
    for k in range(RS):
        t = k / (RS - 1)
        y = -PAGE_D * 0.5 + 0.010 - t * 0.085
        # ON THE TOP LEAF, not on the block: nine leaves sit between them, so a
        # ribbon placed on the block floats 7 mm under the page it is marking.
        x = 0.055 + t * 0.070
        # FOLLOW THE PAGE. The leaf it lies on is itself falling into the
        # gutter, so a ribbon at a fixed height floats 10 mm over the paper at
        # the spine end and cuts through it at the fore-edge.
        u = x / PAGE_W
        z = (0.0017 - GUTTER_DROP * math.exp(-((u / 0.34) ** 2)) + 0.0009
             + 0.0026 * math.sin(t * 5.0) - t * 0.0016)
        for s in (-1, 1):
            rv.append(Vector((x, y + s * 0.0090, z)))
    for k in range(RS - 1):
        a = k * 2
        rf.append((a, a + 1, a + 3, a + 2))
    ribbon = HS.mesh_from("LedgerRibbon", rv, rf, smooth=True)
    sol = ribbon.modifiers.new("Cloth", "SOLIDIFY")
    sol.thickness = 0.0006
    sol.offset = 0.0
    parts["ribbon"] = HS.apply_mods(ribbon)

    cloth = HS.pbr("LedgerCloth", (0.042, 0.021, 0.016), roughness=0.88)
    paper = HS.pbr_textured(
        "LedgerPaper",
        os.path.join(REPO, "Assets", "models", "hero", "textures", "ledger_page.png"),
        roughness=0.95)
    board_paper = HS.pbr("LedgerBlockEdge", (0.480, 0.452, 0.386), roughness=0.95)
    silk = HS.pbr("LedgerRibbon", (0.185, 0.032, 0.030), roughness=0.62)
    for b in boards:
        b.data.materials.append(cloth)
    parts["spine"].data.materials.append(cloth)
    for p in pages:
        p.data.materials.append(board_paper)
    for p in leaves + [turning]:
        p.data.materials.append(paper)
    parts["ribbon"].data.materials.append(silk)
    return parts


def gutter_depth(leaf):
    """Measure the gutter off the LEAF, not off the constant that drew it."""
    vs = [v.co for v in leaf.data.vertices]
    near = [v.z for v in vs if abs(v.x) < PAGE_W * 0.06]
    far = [v.z for v in vs if abs(v.x) > PAGE_W * 0.80]
    if not near or not far:
        return None
    return (sum(far) / len(far)) - (sum(near) / len(near))


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = "break-gutter" in args
    suffix = "-BROKEN" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=180 if engine == "CYCLES" else 112)
    p = build(broken=broken)

    # ---- the assertions
    for leaf in p["leaves"]:
        HS.assert_touching(leaf, p["blocks"][0 if leaf.name.endswith(("0", "1", "2", "3")) else 1],
                           "a leaf must rest on its page block", max_gap=0.0030)
    # Bound to the PAGE BLOCK's inner edge, not to the cover spine. The cover
    # spine wraps the OUTSIDE of the book, 37 mm below the leaf's hinge, so
    # checking against it asks whether the paper touches the leather.
    HS.assert_touching(p["turning"], p["blocks"][1],
                       "the turning leaf must still be bound at the spine",
                       max_gap=0.0060, require_surface=True)
    HS.assert_touching(p["ribbon"], p["leaves"][-1],
                       "the ribbon must lie on the page it marks",
                       max_gap=0.0040, require_surface=True)

    g = gutter_depth(p["leaves"][0])
    print(f"  gutter depth measured on the leaf: {g * 1000:.2f} mm "
          f"(authored {GUTTER_DROP * 1000:.1f})")
    if g < GUTTER_DROP * 0.55:
        raise SystemExit(
            f"BUILD FAILED: the gutter is {g * 1000:.2f} mm deep — the pages are "
            f"a flat card with a line down the middle, not two pages meeting at "
            f"a spine")

    subject = (p["boards"] + [p["spine"]] + p["blocks"] + p["leaves"]
               + [p["turning"], p["ribbon"]])
    print(f"TRIS {H.triangles(subject)} ({len(subject)} objects, 3 materials) "
          f"— the hand is 5,179")
    lo, hi = H.bounds(subject)
    print(f"  overall {hi.x - lo.x:.4f} x {hi.y - lo.y:.4f} x {hi.z - lo.z:.4f} yd"
          f"   ({LEAVES} loose leaves + 1 turning)")

    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.20)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, f"ledger{suffix}", views=8,
                     elevation=30.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"ledger{suffix}-turntable.png"), cols=4)
    for label, az, el in (("hero", -118, 34), ("reading", -90, 58),
                          ("gutter", 0, 16), ("foredge", 180, 14)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"ledger{suffix}-{label}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject, cam,
                         os.path.join(OUT_RENDER, f"ledger{suffix}-silhouette.png"),
                         res=(900, 900))

    hfov = 2 * math.atan(math.tan(math.radians(66) / 2) * 16 / 9)
    d = (PAGE_W * 2 / 0.34) / (2 * math.tan(hfov / 2))
    app = H.camera_fov("Apparent", H.orbit_position(centre, d, -118, 40), centre, 66.0)
    app.data.sensor_fit = "VERTICAL"
    H.render(app, os.path.join(OUT_RENDER, f"ledger{suffix}-apparent.png"), res=(1600, 900))

    if not broken and engine == "CYCLES":
        H.bake_gltf_axis(subject)
        H.export_glb(subject, OUT_GLB)
        print(f"FINAL TRIS {H.triangles(subject)}")


main()
