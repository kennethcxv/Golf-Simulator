"""HERO ASSET — THE CASH REGISTER / TILL. Drawer, monitor, shell.

The reward loop, and the thing the owner looks at through every transaction.

REVISION PASS. Four things were wrong and all four are structural, not cosmetic:

1. THE DRAWER WAS BACKWARDS. Notes belong in the raised tray, coins in the wells
   BENEATH. It is now two levels: five coin channels running the full depth of
   the floor, and a note platform resting on those channel walls over the rear
   half. Coins are beneath the notes because the channels run under the
   platform, and the front half of every channel stays open so you can see them.

2. IT WAS A GREY BOX. The shell is now a lower CARCASS (which is what the drawer
   comes out of) and an upper DECK (which is fixed), split by a recessed band.
   Keypad in a raised bezel, receipt slot, coin lip, brand plate, deck vents.

3. "THE BOX UNDER THE MONITOR STAYS CLOSED WHEN THE DRAWER OPENS." It is not a
   drawer and never was -- it is the fixed housing. The fault is that it READ as
   a drawer. The carcass/deck split is the fix: the moving part is now the only
   part that looks like it moves.

4. THE MONITOR DID NOT MATCH THE GAME. The in-game head is specified in
   tools/blender/build_checkout_kit.py: a 0.352 x 0.2225 16:10 glass opening,
   a uniform 0.011 bezel, a 0.020 chin, 0.030 deep, tilted -7 degrees, with the
   live 0.34 x 0.2125 canvas hung on POS_Screen. This one is built to that spec
   rather than to a guess. It was 0.306 x 0.196 at -16 degrees.

The monitor is EMISSIVE, so this renders in both Cycles and EEVEE.

UNITS ARE YARDS.

    blender --factory-startup -b --python tools/blender/hero/build_register.py -- \
        [cycles] [break=insert|dividers|notebay|keys]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector, Matrix  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402

REPO = os.getcwd()
TEX = os.path.join(REPO, "Assets", "models", "hero", "textures")
OUT_RENDER = os.path.join(REPO, "qa", "hero", "register")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "cash_register.glb")

# ---- the shell, in three bands: carcass (moves nothing), recessed band, deck
# WIDER than it was. Six note bays each need a note's 0.0725 across, so
# 6 x 0.0725 + 5 dividers = 0.4625 of usable width minimum -- a 0.4400 body
# gave 0.3940 and the bays came out 0.0611, narrower than the money that goes
# in them. The layout the drawer owes decides the box, not the other way round.
BODY_W, BODY_D = 0.5400, 0.4600
CARCASS_H = 0.1280
BAND_H = 0.0080
DECK_H = 0.0600
BODY_H = CARCASS_H + BAND_H + DECK_H          # 0.196

# ---- the drawer
DRAWER_W, DRAWER_D, DRAWER_H = 0.5060, 0.3900, 0.0880
WALL = 0.0060
OPEN = 0.3200                 # 82% out: at 0.26 most of the note platform
                              # was still inside the machine and the whole point
                              # of the two-level revision could not be seen
DRAWER_Z = 0.0110

# ONE LEVEL, TWO BANKS. Six note bays -- one per denomination -- and four coin
# wells, one per coin. Every divider is the same height and stands on the same
# floor: there is no raised platform any more.
NOTE_BAYS = 6                 # 1, 5, 10, 20, 50, 100
COIN_BAYS = 4                 # quarter, dime, nickel, penny
BANK_WALL_H = 0.0380
# WHY THERE IS A SEPARATE INSERT SLAB, and not dividers sunk into the drawer.
# The tray is built by SOLIDIFY with a rim, and its inner floor surface lands at
# z = 0.0035, NOT at the 6 mm the wall thickness implies -- so the floor is
# 3.5 mm thick and NO foot can ever be more than ~1.75 mm inside it, against a
# 1.5 mm requirement. Sinking further made the reading WORSE (1.46 -> 0.80) as
# the nearest surface flipped to the drawer's outer bottom.
# Two things only came out of printing closest_point_on_mesh for all eight
# vertices: that floor thickness, and the fact that a thin box has NO vertices
# over the floor at all -- every one of its eight is an end corner, so the
# assertion could only ever sample the ends. That is why burying the ends 3 mm
# deeper did not move the number by a thousandth.
# A real cash drawer holds a lift-out till insert. Modelling the part that
# actually exists gives the feet something thick to root in.
INSERT_Z0 = 0.0020
INSERT_T = 0.0120
SINK = 0.0060                 # foot depth into the 12 mm insert slab
NOTE_SHARE = 0.64             # share of the depth given to the note bank
DIV_T = 0.0055

# What has to fit, from build_money.py. These are the numbers the layout owes.
NOTE_FLAT = (0.17060, 0.07251)
COIN_MAX_D = 0.02653          # a quarter

# ---- the monitor head, copied from the in-game kit spec
GLASS = (0.3520, 0.2225)      # 16:10, the live canvas hangs here
BEZEL = 0.0110
CHIN = 0.0200
HEAD_D = 0.0300
TILT = math.radians(-7.0)
HEAD = Vector((0, 0.1300, BODY_H + 0.0560 + 0.1320))


# --------------------------------------------------------------- the drawer --

def tray():
    """The drawer as a real tray: floor, four walls, a rim."""
    hw, hd = DRAWER_W * 0.5, DRAWER_D * 0.5
    verts, faces = [], []
    for z in (0.0, DRAWER_H):
        for (x, y) in ((hw, hd), (-hw, hd), (-hw, -hd), (hw, -hd)):
            verts.append(Vector((x, y, z)))
    for i in range(4):
        j = (i + 1) % 4
        faces.append((i, j, j + 4, i + 4))
    faces.append((3, 2, 1, 0))
    ob = HS.mesh_from("DrawerShell", verts, faces)
    sol = ob.modifiers.new("Wall", "SOLIDIFY")
    sol.thickness, sol.offset, sol.use_rim = WALL, -1.0, True
    return HS.apply_mods(ob)


def wall_strip(name, x, y0, y1, z0, z1, t, segs=6, along="y"):
    """A divider wall with cross-sections ALONG its length, not just at its two
    ends. A plain box has eight vertices and all eight are end corners, so any
    assertion that samples vertices can only ever sample the ends -- which is
    why burying the ends deeper moved the rooting number by nothing at all, and
    why nothing of a wall-to-wall divider ever lands inside the note platform
    it is supposed to be holding up."""
    verts, faces = [], []
    for s in range(segs + 1):
        y = y0 + (y1 - y0) * s / segs
        for (dx, dz) in ((-t / 2, z0), (t / 2, z0), (t / 2, z1), (-t / 2, z1)):
            verts.append(Vector((x + dx, y, dz)) if along == "y"
                         else Vector((y, x + dx, dz)))
    for s in range(segs):
        a, b = s * 4, (s + 1) * 4
        for k in range(4):
            q = (k + 1) % 4
            faces.append((a + k, a + q, b + q, b + k))
    faces.append((3, 2, 1, 0))
    last = segs * 4
    faces.append((last, last + 1, last + 2, last + 3))
    return HS.mesh_from(name, verts, faces)


def insert(broken=""):
    """One level, two banks. Notes at the back, coins at the front, one cross
    wall between them and every divider standing on the same floor."""
    hw = DRAWER_W * 0.5 - WALL
    hd = DRAWER_D * 0.5 - WALL
    ins_z = INSERT_Z0 + (0.020 if broken == "insert" else 0.0)
    insert_base = HS.apply_mods(HS.box(
        "TillInsert", (0, 0, ins_z + INSERT_T * 0.5),
        (hw * 2 + 0.0080, hd * 2 + 0.0080, INSERT_T)))
    top = ins_z + INSERT_T
    if broken == "dividers":
        # every divider lifted off the insert. It still looks like a divided
        # drawer from above, which is why it ships.
        top += 0.020
    z0, z1 = top - SINK, top + BANK_WALL_H

    split_y = hd - (hd * 2) * NOTE_SHARE
    cross = wall_strip("Div_Bank", split_y, -hw - 0.0020, hw + 0.0020,
                       z0, z1, DIV_T, segs=8, along="x")

    bays = 9 if broken == "notebay" else NOTE_BAYS
    note_divs = [wall_strip(f"Div_Note_{i}", -hw + (hw * 2) * i / bays,
                            split_y, hd + 0.0020, z0, z1, DIV_T, segs=5)
                 for i in range(1, bays)]
    coin_divs = [wall_strip(f"Div_Coin_{i}", -hw + (hw * 2) * i / COIN_BAYS,
                            -hd - 0.0020, split_y, z0, z1, DIV_T, segs=5)
                 for i in range(1, COIN_BAYS)]
    money = fill_drawer(hw, hd, top, split_y)
    return insert_base, cross, note_divs, coin_divs, split_y, money


def fill_drawer(hw, hd, top, split_y):
    """Put money in the till.

    The drawer is the hero pose -- it is rendered OPEN, and the whole reason the
    body was widened to 540 mm was so six note bays could each hold a real
    note's 72.5 mm. It has been empty in every frame: an open till with nothing
    in it, at the one prop the player stands in front of for every transaction.

    Notes are thin stacks with the real money artwork on top, in four of the six
    bays and at different heights, because a till mid-shift is not uniformly
    full. Coins are short stacks of discs in three of the four wells.
    """
    out = []
    NOTE_W, NOTE_L = 0.07251, 0.17060
    bay_w = (hw * 2) / NOTE_BAYS
    # denomination cell in money_notes.png (3 x 2), and how deep the stack is
    plan = ((0, 0.0062), (1, 0.0044), (3, 0.0090), (4, 0.0028))
    for i, (cell, thick) in enumerate(plan):
        bi = (0, 1, 3, 4)[i]
        cx = -hw + bay_w * (bi + 0.5)
        cy = (split_y + hd) * 0.5
        stack = HS.apply_mods(HS.box(
            f"NoteStack_{bi}", (cx, cy, top + thick * 0.5),
            (NOTE_W * 0.97, NOTE_L * 0.94, thick), bevel=0.0008, segments=1))
        # the top face carries the note art; every other face is paper edge
        note_uv(stack, cell, 3, 2)
        out.append(stack)

    coin_w = (hw * 2) / COIN_BAYS
    for i, (cell, n, r, t) in enumerate(((0, 5, 0.01327, 0.00191),
                                         (1, 4, 0.01160, 0.00214),
                                         (3, 6, 0.00953, 0.00152))):
        cx = -hw + coin_w * (i + 0.5)
        cy = (split_y + -hd) * 0.5
        for k in range(n):
            c = HS.cylinder(f"Coin_{i}_{k}", (cx, cy, top + t * (k + 0.5)),
                            r, t, verts=16)
            out.append(c)
    return out


def note_uv(ob, cell, cols, rows):
    """Map the stack's TOP face into one cell of the note sheet."""
    me = ob.data
    layer = me.uv_layers.new(name="UVMap") if not me.uv_layers         else me.uv_layers.active
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    cx, cy = cell % cols, cell // cols
    for poly in me.polygons:
        up = poly.normal.z > 0.5
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            u = (co.x - x0) / max(1e-9, x1 - x0) if up else 0.02
            v = (co.y - y0) / max(1e-9, y1 - y0) if up else 0.02
            layer.data[li].uv = ((cx + u) / cols,
                                 ((rows - 1 - cy) + v) / rows)
    return ob


def bay_sizes(divs, lo, hi, axis):
    """Bay widths read off the GEOMETRY -- the gaps between the dividers that
    are actually there, bounded by the host that is actually there. Reading the
    authoring constant back would pass on a drawer whose dividers had moved."""
    spans = sorted((min(v[axis] for v in dv), max(v[axis] for v in dv))
                   for dv in ([d.matrix_world @ v.co for v in d.data.vertices]
                              for d in divs))
    widths, cur = [], lo
    for (a, b) in spans:
        widths.append(a - cur)
        cur = b
    widths.append(hi - cur)
    return widths


def extent(obj, axis):
    vs = [obj.matrix_world @ v.co for v in obj.data.vertices]
    return min(v[axis] for v in vs), max(v[axis] for v in vs)


# ---------------------------------------------------------------- the shell --

def screen_uv(ob, cell, cols, rows):
    """Plane-map the screen quad's front face into one cell of the sheet.

    The panel is a thin box, so only the faces pointing at the viewer get the
    artwork; everything else collapses to the cell's corner, which is black.
    """
    me = ob.data
    layer = me.uv_layers.new(name="UVMap") if not me.uv_layers         else me.uv_layers.active
    xs = [v.co.x for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    x0, x1 = min(xs), max(xs)
    z0, z1 = min(zs), max(zs)
    cx, cy = cell % cols, cell // cols
    for poly in me.polygons:
        front = poly.normal.y < -0.5
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            u = (co.x - x0) / max(1e-9, x1 - x0) if front else 0.0
            v = (co.z - z0) / max(1e-9, z1 - z0) if front else 0.0
            layer.data[li].uv = ((cx + u) / cols,
                                 ((rows - 1 - cy) + v) / rows)
    return ob


def head_part(name, size, local, bevel=0.0030):
    """A box in the monitor head's own frame, then tilted and placed with it."""
    ob = HS.apply_mods(HS.box(name, (0, 0, 0), size, bevel=bevel, segments=2))
    ob.rotation_euler = (TILT, 0, 0)
    ob.location = HEAD + (Matrix.Rotation(TILT, 3, "X") @ Vector(local))
    return ob


def build(broken=""):
    p = {}

    # ---- shell: carcass, recessed band, deck. The split is what tells the eye
    # which part of this machine moves.
    p["carcass"] = HS.apply_mods(HS.box(
        "TillCarcass", (0, 0, CARCASS_H * 0.5), (BODY_W, BODY_D, CARCASS_H),
        bevel=0.0055, segments=2))
    p["band"] = HS.apply_mods(HS.box(
        "TillBand", (0, 0, CARCASS_H + BAND_H * 0.5),
        (BODY_W - 0.0080, BODY_D - 0.0080, BAND_H), bevel=0.0020, segments=2))
    deck_z = CARCASS_H + BAND_H
    p["deck"] = HS.apply_mods(HS.box(
        "TillDeck", (0, 0, deck_z + DECK_H * 0.5), (BODY_W, BODY_D, DECK_H),
        bevel=0.0055, segments=2))

    # deck vents down the right flank -- a fixed housing has cooling, a drawer
    # does not. This is part of making the deck stop reading as a drawer.
    p["vents"] = [HS.apply_mods(HS.box(
        f"DeckVent_{i}", (BODY_W * 0.5 - 0.0016, 0.0700 - i * 0.0260,
                          deck_z + DECK_H * 0.5),
        (0.0060, 0.0080, 0.0320))) for i in range(3)]

    # ---- keypad in a RAISED BEZEL, recessed inside it
    p["bezel"] = HS.apply_mods(HS.box(
        "KeypadBezel", (0, -0.1250, BODY_H + 0.0060),
        (0.2640, 0.1660, 0.0120), bevel=0.0030, segments=2))
    p["keypad"] = HS.apply_mods(HS.box(
        "Keypad", (0, -0.1250, BODY_H + 0.0075),
        (0.2360, 0.1380, 0.0110), bevel=0.0025, segments=2))

    # 20 real keys. The pad was a featureless dark slab and it is the second
    # largest surface on the machine after the screen -- a till with no keys on
    # its keypad is the same fault as a guard with no trigger in it.
    keys, KW, KD, KG = [], 0.0400, 0.0270, 0.0060
    key_lift = 0.020 if broken == "keys" else 0.0
    kz = BODY_H + 0.0130 + key_lift
    for r in range(4):
        for c in range(5):
            keys.append(HS.apply_mods(HS.box(
                f"Key_{r}_{c}",
                (-(4 * (KW + KG)) * 0.5 + c * (KW + KG),
                 -0.1250 + (1.5 - r) * (KD + KG), kz),
                (KW, KD, 0.0090), bevel=0.0015, segments=1)))
    p["keys"] = keys

    # ---- receipt slot: a recessed dark mouth in the deck top, with a printer
    # bezel standing proud behind it
    p["printer"] = HS.apply_mods(HS.box(
        "PrinterHousing", (-0.1320, 0.1450, BODY_H + 0.0110),
        (0.1560, 0.1200, 0.0260), bevel=0.0040, segments=2))
    p["slot"] = HS.apply_mods(HS.box(
        "ReceiptSlot", (-0.1320, 0.1150, BODY_H + 0.0200),
        (0.1280, 0.0090, 0.0140)))

    # ---- coin lip: a moulded cup at the front right of the deck, where change
    # is actually handed over
    # A raised dish with a mat in it, not a panel lying flush on the deck. Flush
    # read as a sheet of paper someone had left there.
    # DARK, and pulled inboard. Shell-coloured and proud at the deck's front
    # edge it read from the side as a shelf hanging off the machine; a dark
    # dish on a light deck reads as a change tray at any angle.
    p["coin_cup"] = HS.apply_mods(HS.box(
        "CoinTray", (0.1400, -0.1650, BODY_H + 0.0025),
        (0.1300, 0.0760, 0.0110), bevel=0.0025, segments=2))
    p["coin_lip"] = HS.apply_mods(HS.box(
        "CoinMat", (0.1400, -0.1650, BODY_H + 0.0050),
        (0.1120, 0.0580, 0.0040), bevel=0.0010, segments=1))

    # ---- drawer, insert, face, pull
    p["drawer"] = tray()
    ins, cross, note_divs, coin_divs, split_y, money = insert(broken=broken)
    # the money rides WITH the drawer -- it is in the drawer
    moving = ([p["drawer"], ins, cross] + coin_divs + note_divs
              + money)
    p["money"] = money
    for o in moving:
        o.location += Vector((0, -OPEN, DRAWER_Z))
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    for o in moving:
        o.select_set(True)
    bpy.context.view_layer.objects.active = moving[0]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    p["insert"], p["cross"] = ins, cross
    p["coin_divs"], p["note_divs"] = coin_divs, note_divs
    p["split_y"] = split_y - OPEN

    # The bevel rounds the back edge, so the face's rearmost plane is inboard of
    # its nominal half-thickness -- flush by arithmetic was 4.3 mm short in fact.
    p["face"] = HS.apply_mods(HS.box(
        "DrawerFace", (0, -OPEN - DRAWER_D * 0.5 + 0.0060, 0.0640),
        (BODY_W * 0.96, 0.0180, 0.1180), bevel=0.0040, segments=2))
    p["brand"] = HS.apply_mods(HS.box(
        "BrandPlate", (0, -OPEN - DRAWER_D * 0.5 - 0.0025, 0.0880),
        (0.2200, 0.0080, 0.0340), bevel=0.0020, segments=2))
    p["pull"] = HS.apply_mods(HS.box(
        "DrawerPull", (0, -OPEN - DRAWER_D * 0.5 - 0.0090, 0.0480),
        (0.1600, 0.0140, 0.0220), bevel=0.0050, segments=2))

    # ---- monitor, built to the in-game kit's numbers
    p["stalk"] = HS.cylinder("MonStalk", (0, 0.1300, BODY_H + 0.0280),
                             0.0190, 0.0580, verts=14)
    gw, gh = GLASS
    bw = gw + 2 * BEZEL
    p["bez_top"] = head_part("MonBezelTop", (bw, HEAD_D, BEZEL),
                             (0, 0, gh / 2 + BEZEL / 2))
    p["bez_bot"] = head_part("MonBezelBottom", (bw, HEAD_D, BEZEL),
                             (0, 0, -gh / 2 - BEZEL / 2))
    p["bez_l"] = head_part("MonBezelLeft", (BEZEL, HEAD_D, gh),
                           (-gw / 2 - BEZEL / 2, 0, 0))
    p["bez_r"] = head_part("MonBezelRight", (BEZEL, HEAD_D, gh),
                           (gw / 2 + BEZEL / 2, 0, 0))
    p["backing"] = head_part("MonBacking", (bw - 0.0060, 0.0140, gh + 2 * BEZEL - 0.0060),
                             (0, 0.0140, 0))
    p["chin"] = head_part("MonChin", (bw, HEAD_D + 0.0020, CHIN),
                          (0, 0, -gh / 2 - BEZEL - CHIN / 2))
    p["rear"] = head_part("MonRear", (0.3000, 0.0260, 0.2000), (0, 0.0300, -0.0050),
                          bevel=0.0060)
    p["mon_vents"] = [head_part(f"MonVent_{i}", (0.1100, 0.0040, 0.0045),
                                (0, 0.0445, 0.0450 - i * 0.0180), bevel=0.0)
                      for i in range(3)]
    # TWO surfaces, because that is what the game has: a dark glass panel
    # filling the 0.352 x 0.2225 opening, and the LIVE canvas floating 2 mm
    # proud of it at exactly 0.34 x 0.2125 = 16:10. One quad sized to the
    # opening would have put a 1.582 screen under a 1.600 canvas.
    p["glass"] = head_part("MonGlass", (gw - 0.0040, 0.0030, gh - 0.0040),
                           (0, -0.0100, 0), bevel=0.0)
    p["screen"] = head_part("MonScreen", (0.3400, 0.0012, 0.2125),
                            (0, -0.0125, 0), bevel=0.0)
    screen_uv(p["screen"], cell=0, cols=1, rows=2)
    dot = HS.cylinder("MonHomeDot", (0, 0, 0), 0.0035, 0.0024, verts=12)
    dot.rotation_euler = (math.radians(90) + TILT, 0, 0)
    dot.location = HEAD + (Matrix.Rotation(TILT, 3, "X")
                           @ Vector((0, -HEAD_D / 2 - 0.0002,
                                     -gh / 2 - BEZEL - CHIN / 2)))
    p["dot"] = dot

    # ---- FIVE materials now, and the fifth earns it. The machine was four
    # tones of grey with one green screen and no specular event anywhere on it;
    # the golf-assets rule is that every asset needs at least one thing that
    # catches light. Brass does that AND carries the colour onto the brand
    # plate, the change-tray mat, the pull and the monitor's home dot, which is
    # a real part family rather than a tint sprinkled about.
    shellmat = HS.pbr("TillShell", (0.021, 0.058, 0.040), roughness=0.44)
    trim = HS.pbr("TillTrim", (0.020, 0.023, 0.026), roughness=0.38)
    # a WARM SAND drawer, not another grey: notes and coins are what goes in it
    # and they have to read against the tray rather than into it
    inner = HS.pbr("TillDrawer", (0.168, 0.148, 0.118), roughness=0.74)
    brass = HS.pbr("TillBrass", (0.402, 0.276, 0.092), roughness=0.28,
                   metallic=0.88)
    # THE ARTWORK ALREADY EXISTED. make_register_art.mjs has been generating
    # register_screens.png -- a real till layout with line items, right-aligned
    # prices and a total -- and this build was not using it: the screen was a
    # flat emissive colour. I replaced that with a procedural node chain, which
    # looked right in Blender and exported as a PURE WHITE GLOWING PANEL,
    # because a node chain on Base Color carries nothing into a GLB. A baked
    # image does, and this one is better than the chain anyway.
    glow = HS.pbr_textured("TillScreen",
                           os.path.join(TEX, "register_screens.png"),
                           roughness=0.20)
    _g = glow.node_tree
    _tex = next(n for n in _g.nodes if n.type == "TEX_IMAGE")
    _b = _g.nodes["Principled BSDF"]
    if "Emission Color" in _b.inputs:
        _g.links.new(_tex.outputs["Color"], _b.inputs["Emission Color"])
        _b.inputs["Emission Strength"].default_value = 2.2

    # the monitor head stays CHARCOAL, like the kit's does in game -- a bezel
    # painted the same green as the machine reads as a screen glued to a box
    for key in ("carcass", "deck", "face", "printer"):
        p[key].data.materials.append(shellmat)
    for key in ("bez_top", "bez_bot", "bez_l", "bez_r", "chin", "rear"):
        p[key].data.materials.append(trim)
    for key in ("band", "bezel", "keypad", "slot", "stalk", "coin_cup",
                "backing", "glass", "brand"):
        p[key].data.materials.append(trim)
    # the pull is the only brass on the drawer face. Brass on the brand plate
    # too made the two read as a matched pair of bars rather than a recessed
    # panel above a handle.
    for key in ("pull", "coin_lip", "dot"):
        p[key].data.materials.append(brass)
    for o in p["keys"]:
        o.data.materials.append(trim)
    for o in p["vents"] + p["mon_vents"]:
        o.data.materials.append(trim)
    for o in [p["drawer"], p["insert"], p["cross"]] + coin_divs + note_divs:
        o.data.materials.append(inner)
    p["screen"].data.materials.append(glow)
    # THE MONEY IN THE TILL. The notes carry the same money_notes.png the money
    # asset uses, so a note in the drawer and a note in the hand are the same
    # printing; the coins carry money_coins.png.
    notes_mat = HS.pbr_textured("TillNotes",
                                os.path.join(TEX, "money_notes.png"),
                                roughness=0.72)
    coins_mat = HS.pbr("TillCoins", (0.4020, 0.2760, 0.0920),
                       roughness=0.30, metallic=0.82)
    for o in p["money"]:
        o.data.materials.append(
            notes_mat if o.name.startswith("NoteStack") else coins_mat)
    p["materials"] = [shellmat, trim, inner, glow, brass, notes_mat, coins_mat]
    return p


def flat(p):
    out = []
    for v in p.values():
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
    H.set_engine(engine, samples=200 if engine == "CYCLES" else 128)
    p = build(broken=broken)

    # NOT assert_touching: the insert is a press-fit 4 mm into the side walls,
    # so it stays "attached" however far it is lifted off the floor and the
    # control passed. The claim is that it RESTS ON THE FLOOR, so the probe is a
    # point at the middle of its underside, which is in the floor slab when it
    # is seated and in the open cavity when it is not.
    ix, iy, iz = (extent(p["insert"], a) for a in (0, 1, 2))
    seat = HS.point_depth_inside(p["drawer"], Vector(
        ((ix[0] + ix[1]) * 0.5, (iy[0] + iy[1]) * 0.5, iz[0] + 0.0005)))
    if seat <= 0:
        raise SystemExit(
            f"BUILD FAILED: the till insert is not resting on the drawer floor — "
            f"its underside reads {seat * 1000:.2f} mm (negative is open air)")
    print(f"  connection assertion passed: the till insert rests on the drawer "
          f"floor ({seat * 1000:.2f} mm into it)")
    HS.assert_rooted(p["coin_divs"] + p["note_divs"] + [p["cross"]], p["insert"],
                     "the two banks' dividers", min_verts=3, min_depth=0.0015)
    HS.assert_rooted(p["keys"], p["keypad"], "keypad keys",
                     min_verts=3, min_depth=0.0010)
    HS.assert_boxes_overlap(p["face"], p["drawer"],
                            "the drawer face must be on the drawer")
    HS.assert_touching(p["pull"], p["face"], "the pull must be on the face", 0.0020)
    HS.assert_touching(p["brand"], p["face"], "the brand plate must be on the face", 0.0020)
    # A DECLARED DEEP SEAT, measured first. The slot sits 11.00 mm inside the
    # housing and that is what a receipt slot IS -- a mouth cut into the
    # printer, not a part resting against it. Ceiling set to the measured
    # depth plus a millimetre so the check still bites if it ever moves;
    # raising MAX_SEAT_DEPTH globally instead would throw away the assertion
    # that caught the wand's grip 20 mm inside its own shell.
    HS.assert_touching(p["slot"], p["printer"],
                       "the receipt slot must be in the printer", 0.0020,
                       max_depth=0.0120)
    HS.assert_touching(p["coin_cup"], p["deck"], "the coin tray must sit on the deck", 0.0020)
    HS.assert_touching(p["coin_lip"], p["coin_cup"], "the mat must be in the coin tray", 0.0020)
    HS.assert_touching(p["stalk"], p["deck"], "the monitor stalk must meet the deck", 0.0025)
    HS.assert_touching(p["glass"], p["bez_top"], "the glass must fill its bezel", 0.0025)
    HS.assert_touching(p["screen"], p["glass"], "the live canvas must lie on the glass", 0.0025)

    # ---- THE LAYOUT, measured off the geometry. HW is the true usable width;
    # the insert slab is 4 mm proud of it each side to press-fit into the walls,
    # and measuring against the slab would have read the two end bays 4 mm wider
    # than they are.
    HW = DRAWER_W * 0.5 - WALL
    note_w = min(bay_sizes(p["note_divs"], -HW, HW, 0))
    coin_w = min(bay_sizes(p["coin_divs"], -HW, HW, 0))
    cy0, cy1 = extent(p["drawer"], 1)
    xy0, xy1 = extent(p["cross"], 1)
    note_d = (cy1 - WALL) - xy1
    coin_d = xy0 - (cy0 + WALL)
    dz0, dz1 = extent(p["drawer"], 2)
    wz = extent(p["note_divs"][0], 2)

    if note_w < NOTE_FLAT[1] or note_d < NOTE_FLAT[0]:
        raise SystemExit(
            f"BUILD FAILED: a note is {NOTE_FLAT[0] * 1000:.0f} x "
            f"{NOTE_FLAT[1] * 1000:.0f} mm and the note bay is only "
            f"{note_d * 1000:.0f} x {note_w * 1000:.0f} — bills cannot lie flat")
    if coin_w < COIN_MAX_D:
        raise SystemExit(
            f"BUILD FAILED: a quarter is {COIN_MAX_D * 1000:.1f} mm across and "
            f"the coin well is {coin_w * 1000:.1f} mm wide")

    print("")
    print("  === THE DRAWER: ONE LEVEL, TWO BANKS (YARDS) ===")
    print(f"  BACK  — {NOTE_BAYS} note bays, one per denomination "
          f"(1 5 10 20 50 100)")
    print(f"          each {note_d:.4f} deep x {note_w:.4f} wide")
    print(f"          a note is {NOTE_FLAT[0]:.4f} x {NOTE_FLAT[1]:.4f} — "
          f"{(note_d - NOTE_FLAT[0]) * 1000:.0f} mm and "
          f"{(note_w - NOTE_FLAT[1]) * 1000:.1f} mm to spare")
    print(f"  FRONT — {COIN_BAYS} coin wells, one per coin "
          f"(quarter dime nickel penny)")
    print(f"          each {coin_d:.4f} deep x {coin_w:.4f} wide")
    print(f"          the largest coin is {COIN_MAX_D:.4f} across")
    print(f"  every divider {BANK_WALL_H:.4f} high on one floor; "
          f"{dz1 - wz[1]:.4f} clear to the rim")
    print("")
    print(f"  MONITOR  glass {GLASS[0]:.4f} x {GLASS[1]:.4f} "
          f"(the game's canvas is 1024x640 = 1.600), "
          f"bezel {BEZEL:.4f}, chin {CHIN:.4f}, tilt {math.degrees(TILT):.0f} deg")
    print("")

    subject = [o for o in flat(p)]

    # UVs and the grain BEFORE the renders, as everywhere else. The screen's

    # own chain runs off TexCoord Object and carries no TexNoise, so this

    # cannot touch it.

    HS.unwrap_and_grain(subject)
    print(f"TRIS {H.triangles(subject)} ({len(subject)} objects, "
          f"{len(p['materials'])} materials) — the hand is 5,179")

    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.18)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, f"register{suffix}", views=8,
                     elevation=24.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"register{suffix}-turntable.png"), cols=4)

    dc, dr = H.subject_sphere([p["drawer"], p["insert"], p["cross"]]
                              + p["coin_divs"] + p["note_divs"])
    dd = H.fit_distance(dr, LENS, res=(1100, 1100), margin=1.12)
    for label, az, el, c, d in (("hero", -118, 28, centre, dist),
                                ("front", -90, 10, centre, dist),
                                ("side", 0, 12, centre, dist),
                                ("drawer", -90, 58, dc, dd),
                                ("levels", -132, 26, dc, dd)):
        cam = H.camera(label, H.orbit_position(c, d, az, el), c, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"register{suffix}-{label}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject, cam,
                         os.path.join(OUT_RENDER, f"register{suffix}-silhouette.png"),
                         res=(900, 900))

    hfov = 2 * math.atan(math.tan(math.radians(66) / 2) * 16 / 9)
    d = (BODY_W / 0.34) / (2 * math.tan(hfov / 2))
    app = H.camera_fov("Apparent", H.orbit_position(centre, d, -118, 26), centre, 66.0)
    app.data.sensor_fit = "VERTICAL"
    H.render(app, os.path.join(OUT_RENDER, f"register{suffix}-apparent.png"), res=(1600, 900))

    if not broken:
        # the screen's Base Color is CONTENT, not microvariation -- see the
        # keep argument's note in hardsurface_lib
        HS.flatten_for_export(subject, keep={"TillScreen"})
        H.bake_gltf_axis(subject)
        H.export_glb(subject, OUT_GLB)
        print(f"FINAL TRIS {H.triangles(subject)}")


# Guarded so the module can be IMPORTED without building. An unguarded main()
# meant every audit that imported a builder silently re-rendered and re-exported
# its asset as a side effect. Blender runs a --python script as __main__, so the
# command line is unchanged.
if __name__ == "__main__":
    main()
