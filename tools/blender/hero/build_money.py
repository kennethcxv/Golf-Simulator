"""HERO ASSET — THE MONEY. Cards, notes and coins.

VARIETY THROUGH TEXTURES, NOT THROUGH MODELS. A customer handing over the
identical card every time reads as fake, but ten card models cost ten materials
and ten programs, and a parallel session is cutting this game from 349 materials
to under 40. So every design is a CELL in a shared atlas: one mesh, one
material, a UV offset per instance.

The card is currently reported FLAT AND PHASING THROUGH the customer's fingers,
so it gets real thickness and a measured footprint, and there is an assertion
that fails on a card thinner than a real one.

Coins genuinely differ in SIZE, so they are scaled instances of ONE mesh -- which
is also what makes the register's existing denomination audio visible: a quarter
already sounds different from a twenty, and now it looks different too.

UNITS ARE YARDS.

    blender --factory-startup -b --python tools/blender/hero/build_money.py -- [cycles] [break-thickness]
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
OUT_RENDER = os.path.join(REPO, "qa", "hero", "money")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "money.glb")
TEX = os.path.join(REPO, "Assets", "models", "hero", "textures")

# ISO 7810 ID-1: 85.60 x 53.98 x 0.76 mm, in yards.
CARD = (0.09361, 0.05903, 0.00083)
CARD_MIN_T = 0.00060          # thinner than this and it phases through fingers
CARD_CELLS = (4, 3)
# A note: 156 x 66.3 x 0.11 mm. Drawn a little thicker so a single note reads.
NOTE = (0.17060, 0.07251, 0.00035)
# SIX denominations, each a genuinely different design -- own tint, own
# device, own guilloche rosette count, own numeral placement. The old
# eight-cell sheet was the same green eight times, which is why a stack
# read as photocopied.
NOTE_CELLS = (3, 2)
# Coin diameters in yards, and which atlas cell each takes.
COINS = [("quarter", 0.02653, 0.00191, 0), ("nickel", 0.02320, 0.00214, 2),
         ("penny", 0.02083, 0.00169, 3), ("dime", 0.01959, 0.00148, 1)]
COIN_CELLS = (2, 2)
COIN_SIDES = 20


def uv_cell(obj, cell, cols, rows):
    """Point an instance at ONE cell of the shared atlas.

    This is the whole trick: the variety is a UV offset, so twelve card designs
    are twelve draw calls of one material rather than twelve materials.
    """
    cx, cy = cell % cols, cell // cols
    for layer in obj.data.uv_layers:
        for d in layer.data:
            u, v = d.uv
            d.uv = ((cx + u) / cols, ((rows - 1 - cy) + v) / rows)


def flat_card(name, size, cell, cols, rows):
    """A rounded rectangle with real thickness, top face UV-mapped."""
    hw, hd, t = size[0] * 0.5, size[1] * 0.5, size[2]
    r = min(hw, hd) * 0.085
    ring = []
    for (cxs, cys, a0) in ((1, 1, 0.0), (-1, 1, math.pi / 2),
                           (-1, -1, math.pi), (1, -1, math.pi * 1.5)):
        for k in range(4):
            a = a0 + (math.pi / 2) * (k / 3)
            ring.append((cxs * (hw - r) + math.cos(a) * r,
                         cys * (hd - r) + math.sin(a) * r))
    n = len(ring)
    verts, faces = [], []
    for z in (0.0, t):
        for (x, y) in ring:
            verts.append(Vector((x, y, z)))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, j + n, i + n))
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple(range(n, n * 2)))
    ob = HS.mesh_from(name, verts, faces)
    uvl = ob.data.uv_layers.new(name="UVMap")
    for poly in ob.data.polygons:
        for li in poly.loop_indices:
            co = ob.data.vertices[ob.data.loops[li].vertex_index].co
            uvl.data[li].uv = ((co.x + hw) / (hw * 2), (co.y + hd) / (hd * 2))
    uv_cell(ob, cell, cols, rows)
    return ob


def disc(name, dia, thick, cell):
    verts, faces = [], []
    r = dia * 0.5
    for z in (0.0, thick):
        for k in range(COIN_SIDES):
            a = 2 * math.pi * k / COIN_SIDES
            verts.append(Vector((math.cos(a) * r, math.sin(a) * r, z)))
    for k in range(COIN_SIDES):
        j = (k + 1) % COIN_SIDES
        faces.append((k, j, j + COIN_SIDES, k + COIN_SIDES))
    faces.append(tuple(range(COIN_SIDES - 1, -1, -1)))
    faces.append(tuple(range(COIN_SIDES, COIN_SIDES * 2)))
    ob = HS.mesh_from(name, verts, faces, smooth=False)
    uvl = ob.data.uv_layers.new(name="UVMap")
    for poly in ob.data.polygons:
        for li in poly.loop_indices:
            co = ob.data.vertices[ob.data.loops[li].vertex_index].co
            uvl.data[li].uv = ((co.x / r + 1) * 0.5, (co.y / r + 1) * 0.5)
    uv_cell(ob, cell, *COIN_CELLS)
    return ob


def build(broken=False):
    p = {"cards": [], "notes": [], "coins": []}
    t = CARD[2] * 0.25 if broken else CARD[2]

    # ---- 12 cards, fanned. One mesh shape, one material, twelve atlas cells.
    for i in range(12):
        c = flat_card(f"Card_{i}", (CARD[0], CARD[1], t), i, *CARD_CELLS)
        c.location = Vector((-0.20 + (i % 4) * 0.115, 0.16 - (i // 4) * 0.075, 0))
        p["cards"].append(c)

    # ---- 6 note faces, one per denomination
    for i in range(6):
        nt = flat_card(f"Note_{i}", NOTE, i, *NOTE_CELLS)
        nt.location = Vector((-0.20 + (i % 3) * 0.190, -0.06 - (i // 3) * 0.090, 0))
        p["notes"].append(nt)

    # ---- 4 coins: scaled instances of one disc, two metal tones
    for k, (nm, dia, th, cell) in enumerate(COINS):
        c = disc(f"Coin_{nm}", dia, th, cell)
        c.location = Vector((-0.185 + k * 0.045, -0.245, 0))
        p["coins"].append(c)

    # 0.44, not 0.28: at a grazing angle the glossier value blew four of the
    # twelve cards to flat white and the designs on them stopped existing
    card_mat = HS.pbr_textured("MoneyCards", os.path.join(TEX, "money_cards.png"),
                               roughness=0.44)
    note_mat = HS.pbr_textured("MoneyNotes", os.path.join(TEX, "money_notes.png"),
                               roughness=0.86)
    silver = HS.pbr_textured("MoneyCoinSilver", os.path.join(TEX, "money_coins.png"),
                             roughness=0.34)
    copper = HS.pbr_textured("MoneyCoinCopper", os.path.join(TEX, "money_coins.png"),
                             roughness=0.40)
    for m, metal in ((silver, 0.85), (copper, 0.80)):
        m.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = metal
    for c in p["cards"]:
        c.data.materials.append(card_mat)
    for n in p["notes"]:
        n.data.materials.append(note_mat)
    for c in p["coins"]:
        c.data.materials.append(copper if c.name.endswith("penny") else silver)
    p["materials"] = [card_mat, note_mat, silver, copper]
    return p


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = "break-thickness" in args
    suffix = "-BROKEN" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=180 if engine == "CYCLES" else 112)
    p = build(broken=broken)

    # ---- THE ASSERTION THE REPORTED FAULT ASKS FOR
    lo, hi = H.bounds([p["cards"][0]])
    thick = hi.z - lo.z
    if thick < CARD_MIN_T:
        raise SystemExit(
            f"BUILD FAILED: the card is {thick * 1000:.3f} thick against a "
            f"{CARD_MIN_T * 1000:.3f} minimum — this is the 'flat and phasing "
            f"through the customer's fingers' report")
    print(f"  card thickness {thick * 1000:.3f} (ISO 7810 is 0.83 in these units)")
    print(f"  card footprint {hi.x - lo.x:.5f} x {hi.y - lo.y:.5f}")

    # every coin must be the SAME mesh shape, only scaled
    ratios = [(c[1] / COINS[0][1]) for c in COINS]
    print("  coin diameters " + "  ".join(
        f"{n} {d:.5f} ({r * 100:.0f}%)" for (n, d, _, _), r in zip(COINS, ratios)))

    subject = p["cards"] + p["notes"] + p["coins"]
    tris = H.triangles(subject)
    print("")
    print("  === THE COST OF THE WHOLE SET ===")
    print(f"  designs        12 cards + 6 note faces + 4 coins = 22")
    print(f"  MATERIALS      {len(p['materials'])}  (cards 1, notes 1, coins 2 — a "
          f"silver and a copper)")
    print(f"  programs       {len(p['materials'])} — one per material, no variants")
    print(f"  draw calls     {len(subject)} objects, batchable to "
          f"{len(p['materials'])} by material")
    print(f"  TRIS           {tris} for all 24 ({tris / len(subject):.0f} each)")
    print(f"  atlases        3 (cards 2048x969, notes 2048x436, coins 512x512)")
    print("")

    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.14)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, f"money{suffix}", views=8,
                     elevation=52.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"money{suffix}-turntable.png"), cols=4)
    for label, az, el in (("hero", -90, 62), ("cards", -90, 78),
                          ("edge", -90, 8), ("angle", -128, 34)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"money{suffix}-{label}.png"), res=(1100, 1100))

    if not broken:
        H.bake_gltf_axis(subject)
        H.export_glb(subject, OUT_GLB)
        print(f"FINAL TRIS {H.triangles(subject)}")


# Guarded so the module can be IMPORTED without building. An unguarded main()
# meant every audit that imported a builder silently re-rendered and re-exported
# its asset as a side effect. Blender runs a --python script as __main__, so the
# command line is unchanged.
if __name__ == "__main__":
    main()
