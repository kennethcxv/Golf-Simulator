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
        [cycles] [break=insert|dividers|platform|notebay|keys]
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
OUT_RENDER = os.path.join(REPO, "qa", "hero", "register")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "cash_register.glb")

# ---- the shell, in three bands: carcass (moves nothing), recessed band, deck
BODY_W, BODY_D = 0.4400, 0.4600
CARCASS_H = 0.1280
BAND_H = 0.0080
DECK_H = 0.0600
BODY_H = CARCASS_H + BAND_H + DECK_H          # 0.196

# ---- the drawer
DRAWER_W, DRAWER_D, DRAWER_H = 0.4060, 0.3900, 0.1080
WALL = 0.0060
OPEN = 0.3200                 # 82% out: at 0.26 most of the note platform
                              # was still inside the machine and the whole point
                              # of the two-level revision could not be seen
DRAWER_Z = 0.0110

COIN_BAYS = 5                 # channels front-to-back on the floor
NOTE_BAYS = 4                 # bays on the raised platform
COIN_WALL_H = 0.0420          # channel wall height; also the platform's support
PLATFORM_T = 0.0050
NOTE_WALL_H = 0.0220
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
NOTE_SHARE = 0.52             # share of the drawer's depth the platform covers
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
    """Two levels. Coin channels on the floor running the FULL depth; a note
    platform resting on their walls over the rear share. That is what makes
    "coins beneath notes" true of the geometry and not just of the words."""
    hw = DRAWER_W * 0.5 - WALL
    hd = DRAWER_D * 0.5 - WALL
    # The TILL INSERT's base slab. A real cash drawer holds a lift-out insert
    # and the dividers are moulded into THAT, not sunk into the drawer floor --
    # which is also the only structure that can be asserted here. See INSERT_T.
    ins_z = INSERT_Z0 + (0.020 if broken == "insert" else 0.0)
    insert_base = HS.apply_mods(HS.box(
        "TillInsert", (0, 0, ins_z + INSERT_T * 0.5),
        (hw * 2 + 0.0080, hd * 2 + 0.0080, INSERT_T)))
    top = ins_z + INSERT_T

    if broken == "dividers":
        # every divider lifted off the insert. It still looks like a divided
        # drawer from above, which is why it ships.
        top += 0.020

    coin_divs = []
    for i in range(1, COIN_BAYS):
        x = -hw + (hw * 2) * i / COIN_BAYS
        coin_divs.append(wall_strip(
            f"Div_Coin_{i}", x, -hd - 0.0020, hd + 0.0020,
            top - SINK, top + COIN_WALL_H, DIV_T, segs=6))

    # A cross wall through the OPEN front section. Without it the coin section
    # is five long troughs, which is what note bays look like in a real till --
    # coins live in short wells, and the wells are what makes the two levels
    # read as two different jobs rather than one tray at two heights.
    split_y = hd - (hd * 2) * NOTE_SHARE
    coin_divs.append(wall_strip(
        "Div_CoinCross", (-hd + split_y) * 0.5, -hw - 0.0020, hw + 0.0020,
        top - SINK, top + COIN_WALL_H, DIV_T, segs=6, along="x"))
    plat_z = ins_z + INSERT_T + COIN_WALL_H - 0.0020   # 2 mm into the wall tops
    if broken == "platform":
        # 20 mm, not 2: the platform overlaps its walls by 2 mm, so a small
        # shove leaves it still seated and the control proves nothing.
        plat_z += 0.020
    plat_d = hd - split_y
    platform = HS.apply_mods(HS.box(
        "NotePlatform", (0, split_y + plat_d * 0.5, plat_z + PLATFORM_T * 0.5),
        (hw * 2, plat_d, PLATFORM_T)))

    bays = 6 if broken == "notebay" else NOTE_BAYS
    note_divs = []
    for i in range(1, bays):
        x = -hw + (hw * 2) * i / bays
        b = HS.box(f"Div_Note_{i}",
                   (x, split_y + plat_d * 0.5,
                    plat_z + PLATFORM_T + NOTE_WALL_H * 0.5 - 0.0010),
                   (DIV_T, plat_d - 0.0040, NOTE_WALL_H + 0.0020))
        note_divs.append(HS.apply_mods(b))

    # A retaining lip along the platform's front edge. Without it the note bays
    # end in a 5 mm cliff over the coin wells and a bill laid flat would slide
    # straight off the front -- the tray would measure correctly and still not
    # hold anything.
    note_divs.append(HS.apply_mods(HS.box(
        "NoteLip", (0, split_y + 0.0035, plat_z + PLATFORM_T + 0.0060),
        (hw * 2 - 0.0040, 0.0050, 0.0160))))
    return insert_base, coin_divs, platform, note_divs, split_y


def bay_sizes(divs, host, axis):
    """Bay widths read off the GEOMETRY -- the gaps between the dividers that
    are actually there, bounded by the host that is actually there. Reading the
    authoring constant back would pass on a drawer whose dividers had moved."""
    hv = [host.matrix_world @ v.co for v in host.data.vertices]
    lo, hi = min(v[axis] for v in hv), max(v[axis] for v in hv)
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
    ins, coin_divs, platform, note_divs, split_y = insert(broken=broken)
    moving = [p["drawer"], ins, platform] + coin_divs + note_divs
    for o in moving:
        o.location += Vector((0, -OPEN, DRAWER_Z))
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    for o in moving:
        o.select_set(True)
    bpy.context.view_layer.objects.active = moving[0]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    p["insert"], p["platform"] = ins, platform
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
    dot = HS.cylinder("MonHomeDot", (0, 0, 0), 0.0035, 0.0024, verts=12)
    dot.rotation_euler = (math.radians(90) + TILT, 0, 0)
    dot.location = HEAD + (Matrix.Rotation(TILT, 3, "X")
                           @ Vector((0, -HEAD_D / 2 - 0.0002,
                                     -gh / 2 - BEZEL - CHIN / 2)))
    p["dot"] = dot

    # ---- four materials, on real part boundaries. No fifth: the brand plate
    # and the coin lip use the trim, which is the same break the band uses.
    shellmat = HS.pbr("TillShell", (0.052, 0.056, 0.062), roughness=0.46)
    trim = HS.pbr("TillTrim", (0.022, 0.024, 0.028), roughness=0.38)
    inner = HS.pbr("TillDrawer", (0.030, 0.033, 0.038), roughness=0.72)
    glow = HS.pbr("TillScreen", (0.030, 0.120, 0.075), roughness=0.22)
    em = glow.node_tree.nodes["Principled BSDF"]
    if "Emission Color" in em.inputs:
        em.inputs["Emission Color"].default_value = (0.075, 0.520, 0.330, 1.0)
        em.inputs["Emission Strength"].default_value = 2.4

    for key in ("carcass", "deck", "face", "printer", "bez_top", "bez_bot",
                "bez_l", "bez_r", "chin", "rear"):
        p[key].data.materials.append(shellmat)
    for key in ("band", "bezel", "keypad", "slot", "pull", "stalk", "brand",
                "coin_lip", "coin_cup", "backing", "dot", "glass"):
        p[key].data.materials.append(trim)
    for o in p["keys"]:
        o.data.materials.append(trim)
    for o in p["vents"] + p["mon_vents"]:
        o.data.materials.append(trim)
    for o in [p["drawer"], p["insert"], p["platform"]] + coin_divs + note_divs:
        o.data.materials.append(inner)
    p["screen"].data.materials.append(glow)
    p["materials"] = [shellmat, trim, inner, glow]
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
    HS.assert_rooted(p["coin_divs"], p["insert"], "coin channel walls",
                     min_verts=3, min_depth=0.0015)
    # Tested wall-INTO-platform, not platform-into-wall: the platform spans the
    # full width so none of its vertices land inside a 5.5 mm divider, which is
    # the wand's flange fault exactly. The wall's top corners DO land in the
    # platform, so that is the direction that measures the join.
    HS.assert_touching(p["coin_divs"][0], p["platform"],
                       "the note platform must rest on the coin channel walls",
                       max_gap=0.0020)
    HS.assert_rooted(p["note_divs"], p["platform"], "note bay dividers",
                     min_verts=3, min_depth=0.0008)
    HS.assert_rooted(p["keys"], p["keypad"], "keypad keys",
                     min_verts=3, min_depth=0.0010)
    HS.assert_boxes_overlap(p["face"], p["drawer"],
                            "the drawer face must be on the drawer")
    HS.assert_touching(p["pull"], p["face"], "the pull must be on the face", 0.0020)
    HS.assert_touching(p["brand"], p["face"], "the brand plate must be on the face", 0.0020)
    HS.assert_touching(p["slot"], p["printer"], "the receipt slot must be in the printer", 0.0020)
    HS.assert_touching(p["coin_cup"], p["deck"], "the coin tray must sit on the deck", 0.0020)
    HS.assert_touching(p["coin_lip"], p["coin_cup"], "the mat must be in the coin tray", 0.0020)
    HS.assert_touching(p["stalk"], p["deck"], "the monitor stalk must meet the deck", 0.0025)
    HS.assert_touching(p["glass"], p["bez_top"], "the glass must fill its bezel", 0.0025)
    HS.assert_touching(p["screen"], p["glass"], "the live canvas must lie on the glass", 0.0025)

    # ---- THE LAYOUT THE REVISION ASKS FOR, measured off the geometry
    # the retaining lip runs the full width, so it is not a bay boundary --
    # leaving it in made the measured bay -296 mm wide
    uprights = [d for d in p["note_divs"] if "Lip" not in d.name]
    note_w = min(bay_sizes(uprights, p["platform"], 0))
    py0, py1 = extent(p["platform"], 1)
    note_d = py1 - py0
    runners = [d for d in p["coin_divs"] if "Cross" not in d.name]
    coin_w = min(bay_sizes(runners, p["insert"], 0))
    cy0, cy1 = extent(p["drawer"], 1)
    coin_open_d = py0 - (cy0 + WALL)
    dz0, dz1 = extent(p["drawer"], 2)
    pz0, pz1 = extent(p["platform"], 2)
    clear_above_note = dz1 - pz1
    nz = extent(p["note_divs"][0], 2)
    clear_above_walls = dz1 - nz[1]

    if note_w < NOTE_FLAT[1] or note_d < NOTE_FLAT[0]:
        raise SystemExit(
            f"BUILD FAILED: a note is {NOTE_FLAT[0] * 1000:.0f} x "
            f"{NOTE_FLAT[1] * 1000:.0f} mm and the note bay is only "
            f"{note_d * 1000:.0f} x {note_w * 1000:.0f} — bills cannot lie flat")
    if coin_w < COIN_MAX_D:
        raise SystemExit(
            f"BUILD FAILED: a quarter is {COIN_MAX_D * 1000:.1f} mm across and "
            f"the coin channel is {coin_w * 1000:.1f} mm wide")

    print("")
    print("  === THE DRAWER, TWO LEVELS, measured off the geometry (YARDS) ===")
    print(f"  TOP — {NOTE_BAYS} note bays   {note_d:.4f} deep x {note_w:.4f} wide "
          f"x {NOTE_WALL_H:.4f} walls")
    print(f"        a note is        {NOTE_FLAT[0]:.4f} x {NOTE_FLAT[1]:.4f} — "
          f"lies flat with {(note_d - NOTE_FLAT[0]) * 1000:.0f} mm to spare")
    print(f"        clearance above  {clear_above_note:.4f} to the rim "
          f"({clear_above_walls:.4f} above the bay walls)")
    print(f"  BOTTOM — {COIN_BAYS} coin channels  {coin_w:.4f} wide x "
          f"{COIN_WALL_H:.4f} deep, running the full floor")
    print(f"        open in front of the platform for {coin_open_d:.4f}")
    print(f"        a quarter is     {COIN_MAX_D:.4f} across")
    print(f"  platform sits {(pz0 - dz0) * 1000:.1f} mm above the drawer floor")
    print("")
    print(f"  MONITOR  glass {GLASS[0]:.4f} x {GLASS[1]:.4f} "
          f"({GLASS[0] / GLASS[1]:.3f} — the game's canvas is 1024x640 = 1.600), "
          f"bezel {BEZEL:.4f}, chin {CHIN:.4f}, tilt {math.degrees(TILT):.0f} deg")
    print("")

    subject = [o for o in flat(p)]
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

    dc, dr = H.subject_sphere([p["drawer"], p["insert"], p["platform"]] + p["coin_divs"]
                              + p["note_divs"])
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

    if not broken and engine == "CYCLES":
        H.bake_gltf_axis(subject)
        H.export_glb(subject, OUT_GLB)
        print(f"FINAL TRIS {H.triangles(subject)}")


main()
