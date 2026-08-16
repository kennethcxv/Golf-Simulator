"""GOAL 27 — THE CASH REGISTER, BUILT PROPERLY. Design C, the LANE HEAD.

WHY C. Of the four options it is the one the brief actually asked for -- "a
chunky modern POS unit, a real customer-facing screen, a card terminal, a
receipt printer, a scanner, a proper drawer" -- and it is closest to
ref/register/selfcheckout.jpg. It also has the largest drawer of the four
(350 x 270 x 59 mm), which matters because a note is 171 mm long and has to lie
ACROSS the bays with room to be picked up. D, the timber clubhouse till, is the
one that belongs in a golf shop rather than a supermarket, and it is the
alternative if you would rather have character than genre.

This supersedes build_register.py, which is the design you told me to bin.

WHAT "PROPERLY" MEANS HERE, from the brief, each one a thing in this file:

  CHAMFERS ON EVERY HARD EDGE     nothing moulded has a knife edge, and that
                                  single change is most of what separates a
                                  real object from a box
  REAL PART BOUNDARIES            panel plates standing proud with gaps between
                                  them, a parting seam round the shell, a bezel
                                  that stands off its screen, a slot with depth
  ACTUAL KEYS                     a 4x4 grid of individual chamfered keys with
                                  gaps, two of them coloured
  THE DRAWER FRONT IS THE SHELL   a panel recessed into the body with an even
                                  gap all round, not a slab stuck on
  A SCREEN WITH SOMETHING ON IT   emissive, carrying a real till interface

The triangle budget is deliberately spent. This is the object the player looks
at through every transaction.

UNITS ARE YARDS.

    blender --factory-startup -b --python tools/blender/hero/build_lane_head.py -- \\
        [cycles] [shut] [break=keys]
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
OUT_RENDER = os.path.join(REPO, "qa", "hero", "register_c")
GLB_DIR = os.path.join(REPO, "Assets", "models", "hero")
TEX = os.path.join(REPO, "Assets", "models", "hero", "textures",
                   "register_screens.png")

W, D, HH = 0.4200, 0.3600, 0.1520
NOTE_L, COIN_D = 0.1706, 0.0265
GAP = 0.0032
CHAMFER = 0.0026


def panel(name, centre, size, bevel=CHAMFER, seg=2):
    return HS.box(name, centre, size, bevel=bevel, segments=seg)


def screen_quad(name, centre, size, normal=(0, -1, 0), tilt=0.0, cell=0):
    """An emissive panel with a UI on it, UV'd from VERTEX POSITION so the
    interface is not packed and rotated by a projection -- the apparel decals
    took four attempts to learn that and this is the same problem."""
    c = Vector(centre)
    n = Vector(normal).normalized()
    up = Vector((0, 0, 1))
    side = n.cross(up).normalized()
    up = side.cross(n).normalized()
    if tilt:
        # ABOUT +X, matching rotation_euler on the bezel box. Rotating about
        # `side` -- which is -X for a forward-facing panel -- tilted the screen
        # the OPPOSITE way from its bezel, so the two leaned apart and the
        # screen poked out below the frame. Same axis, same sign, or they
        # diverge.
        q = Quaternion(Vector((1.0, 0.0, 0.0)), math.radians(tilt))
        n.rotate(q)
        up.rotate(q)
    w, h = size[0] * 0.5, size[1] * 0.5
    verts, faces = [], []
    for sgn in (0, 1):
        base = c + n * (0.0016 * sgn)
        for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append(base + side * (sx * w) + up * (sy * h))
    faces.append((3, 2, 1, 0))
    faces.append((4, 5, 6, 7))
    for i in range(4):
        j = (i + 1) % 4
        faces.append((i, j, j + 4, i + 4))
    obj = HS.mesh_from(name, verts, faces, smooth=False)
    uv = obj.data.uv_layers.new(name="UVMap")
    for poly in obj.data.polygons:
        flat = abs(poly.normal.dot(n)) > 0.7
        for li in poly.loop_indices:
            co = obj.data.vertices[obj.data.loops[li].vertex_index].co
            if not flat:
                uv.data[li].uv = (0.02, (cell + 0.02) / 2.0)
                continue
            rel = co - c
            u = min(1.0, max(0.0, 0.5 - rel.dot(side) / (2 * w)))
            v = min(1.0, max(0.0, 0.5 + rel.dot(up) / (2 * h)))
            # cell 0 is the top half of the sheet, cell 1 the bottom
            uv.data[li].uv = (u, (1 - cell + v) / 2.0)
    obj["screen"] = True
    return obj


def keypad(prefix, origin, cols=4, rows=4, key=0.0225, gap=0.0042, broken=False):
    """ACTUAL KEYS. A flat panel with a texture reads as a sticker; keys read as
    keys because each catches its own highlight and casts its own shadow into
    the gap beside it."""
    ox, oy, oz = origin
    p = {}
    span_x = cols * key + (cols - 1) * gap
    span_y = rows * key + (rows - 1) * gap
    p[f"{prefix}_surround"] = panel(
        f"{prefix}_Surround", (ox, oy, oz - 0.0042),
        (span_x + 0.0165, span_y + 0.0165, 0.0105), bevel=0.0022)
    for r in range(rows):
        for c in range(cols):
            x = ox - span_x * 0.5 + key * 0.5 + c * (key + gap)
            y = oy - span_y * 0.5 + key * 0.5 + r * (key + gap)
            lift = 0.010 if broken else 0.0
            ob = panel(f"{prefix}_Key{r}{c}", (x, y, oz + 0.0028 + lift),
                       (key, key, 0.0072), bevel=0.0013)
            # A COUPLE OF COLOURED FUNCTION KEYS. On a real till the two keys
            # the cashier hits a hundred times a day are the only ones that are
            # not black, and it is the first thing you notice about a keypad.
            if (r, c) in ((0, cols - 1), (1, cols - 1)):
                ob["accent"] = True
            p[f"{prefix}_k{r}{c}"] = ob
    return p, span_x, span_y


def _face_centre(box_centre, tilt_deg, depth, up_offset=0.0):
    """Where a tilted box's FRONT FACE actually is.

    A box rotates about its own centre; a screen quad is built about a point.
    Placing the quad by eye left the screen 6 mm low in its bezel with a thick
    grey band under it, which is the sort of thing that reads as "wrong" long
    before anyone can say why.
    """
    c = Vector(box_centre)
    t = math.radians(tilt_deg)
    fwd = Vector((0.0, -math.cos(t), -math.sin(t)))     # -Y, rotated about X
    up = Vector((0.0, -math.sin(t), math.cos(t)))
    return c + fwd * (depth * 0.5 + 0.0006) + up * up_offset


def _tray(name, centre, size, wall=0.0055):
    cx, cy, cz = centre
    w, d, h = size
    outer = HS.box(name, (cx, cy, cz), (w, d, h))
    inner = HS.box(f"{name}_void", (cx, cy, cz + wall),
                   (w - 2 * wall, d - 2 * wall, h))
    mod = outer.modifiers.new("Cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = inner
    mod.solver = "EXACT"
    out = HS.apply_mods(outer)
    bpy.data.objects.remove(inner, do_unlink=True)
    out.name = name
    return out


def build(drawer_open=True, broken=""):
    p = {}
    # ---- the shell: a core with PANEL PLATES standing proud, so the part
    # boundaries are real geometry with real shadow lines
    p["core"] = panel("Reg_Core", (0, 0, HH * 0.5), (W - 0.010, D - 0.010, HH),
                      bevel=0.0040)
    p["kick"] = panel("Reg_Kick", (0, 0, 0.0115), (W - 0.026, D - 0.026, 0.0230),
                      bevel=0.0030)
    for k, sx in enumerate((-1, 1)):
        p[f"side{k}"] = panel(f"Reg_Side{k}",
                              (sx * (W * 0.5 - 0.0042), 0, HH * 0.53),
                              (0.0084, D - 0.030, HH - 0.048), bevel=0.0022)
    p["back"] = panel("Reg_Back", (0, D * 0.5 - 0.0042, HH * 0.53),
                      (W - 0.030, 0.0084, HH - 0.048), bevel=0.0022)
    p["seam"] = panel("Reg_Seam", (0, 0, HH - 0.0300),
                      (W - 0.004, D - 0.004, 0.0042), bevel=0.0016)
    p["deck"] = panel("Reg_Deck", (0, 0.0180, HH + 0.0060),
                      (W - 0.014, D - 0.050, 0.0130), bevel=0.0034)

    # ---- the drawer front, RECESSED INTO the shell with an even gap all round
    dw, dh = W - 0.070, 0.0810
    dz = 0.0640
    slide = 0.1450 if drawer_open else 0.0
    p["drawer_recess"] = panel("Reg_DrawerRecess",
                               (0, -D * 0.5 + 0.0150, dz),
                               (dw + 2 * GAP, 0.0150, dh + 2 * GAP), bevel=0.0018)
    p["drawer_front"] = panel("Reg_DrawerFront",
                              (0, -D * 0.5 + 0.0060 - slide, dz),
                              (dw, 0.0155, dh), bevel=0.0028)
    p["drawer_pull"] = panel("Reg_DrawerPull",
                             (0, -D * 0.5 - 0.0032 - slide, dz),
                             (dw * 0.52, 0.0080, 0.0155), bevel=0.0028)

    # ---- the drawer: notes above, coins beneath
    box_d = D * 0.76
    ny = -D * 0.5 + 0.0060 - slide + box_d * 0.5 + 0.012
    p["drawer_box"] = _tray("Reg_DrawerBox", (0, ny, dz - 0.0020),
                            (dw - 0.012, box_d, 0.0700))
    iw = dw - 0.034
    idp = box_d - 0.022
    note_h = 0.0330
    p["note_tray"] = _tray("Reg_NoteTray", (0, ny + 0.0090, dz + 0.0130),
                           (iw, idp * 0.90, note_h), wall=0.0035)
    for i in range(3):
        x = -iw * 0.5 + iw * (i + 1) / 4.0
        p[f"ndiv{i}"] = panel(f"Reg_NoteDiv{i}", (x, ny + 0.0090, dz + 0.0140),
                              (0.0030, idp * 0.82, note_h * 0.80), bevel=0.0008)
    for i in range(5):
        x = -iw * 0.5 + iw * (i + 0.5) / 5.0
        p[f"cdiv{i}"] = panel(f"Reg_CoinDiv{i}", (x, ny - idp * 0.31, dz - 0.0160),
                              (0.0026, idp * 0.30, 0.0300), bevel=0.0008)

    # ---- the riser and the cashier screen, bezel standing proud
    rz = HH + 0.0130
    p["riser"] = panel("Reg_Riser", (0, 0.1180, rz + 0.0620),
                       (0.1560, 0.0700, 0.1300), bevel=0.0050)
    p["riser_seam"] = panel("Reg_RiserSeam", (0, 0.1180, rz + 0.0620),
                            (0.1600, 0.0740, 0.0040), bevel=0.0014)
    p["bezel"] = panel("Reg_Bezel", (0, 0.0865, rz + 0.1420),
                       (0.3080, 0.0210, 0.2120), bevel=0.0038)
    p["bezel"].rotation_mode = "XYZ"
    p["bezel"].rotation_euler = (math.radians(-22), 0, 0)
    # THE SCREEN SITS ON THE BEZEL'S FRONT FACE, computed rather than guessed.
    # A box rotates about its own centre and a quad is built about a point, so
    # placing the quad "near" the bezel left a thick grey band below the screen
    # and a thin one above -- the two were diverging by 6 mm.
    p["screen"] = screen_quad("Reg_Screen", _face_centre(
        (0, 0.0865, rz + 0.1420), -22, 0.0210), (0.2820, 0.1880),
        normal=(0, -1, 0), tilt=-22, cell=0)

    # ---- the customer display on a pole
    p["pole"] = CL._sweep("Reg_Pole",
                          [Vector((0.1660, 0.1420, HH)),
                           Vector((0.1660, 0.1420, HH + 0.2420))], 0.0092,
                          sides=10)
    p["cust_bezel"] = panel("Reg_CustBezel", (0.1660, 0.1500, HH + 0.2780),
                            (0.1300, 0.0180, 0.0880), bevel=0.0030)
    p["cust_bezel"].rotation_mode = "XYZ"
    p["cust_bezel"].rotation_euler = (math.radians(12), 0, 0)
    p["cust_screen"] = screen_quad("Reg_CustScreen", _face_centre(
        (0.1660, 0.1500, HH + 0.2780), 12, 0.0180), (0.1120, 0.0700),
        normal=(0, -1, 0), tilt=12, cell=1)

    # ---- the keypad, with real keys
    kp, _, _ = keypad("Reg_Pad", (-0.1120, -0.0480, HH + 0.0135),
                      broken=(broken == "keys"))
    p.update(kp)

    # ---- the scanner plate, recessed into the deck
    p["scan_recess"] = panel("Reg_ScanRecess", (0.0480, -0.0500, HH + 0.0122),
                             (0.1420, 0.1420, 0.0090), bevel=0.0020)
    p["scan_glass"] = panel("Reg_ScanGlass", (0.0480, -0.0500, HH + 0.0142),
                            (0.1300, 0.1300, 0.0035), bevel=0.0012)

    # ---- the receipt printer: a housing with a SLOT that has depth
    px, py = 0.1560, -0.0180
    p["printer"] = panel("Reg_Printer", (px, py, HH + 0.0430),
                         (0.0700, 0.0960, 0.0620), bevel=0.0034)
    p["printer_lid"] = panel("Reg_PrinterLid", (px, py + 0.0060, HH + 0.0745),
                             (0.0640, 0.0800, 0.0080), bevel=0.0022)
    p["printer_slot"] = panel("Reg_PrinterSlot", (px, py - 0.0330, HH + 0.0700),
                              (0.0560, 0.0090, 0.0070), bevel=0.0016)
    p["paper"] = HS.cylinder("Reg_Paper", (px, py - 0.0348, HH + 0.0742),
                             0.0042, 0.0520, verts=12,
                             rotation=Quaternion(Vector((0, 1, 0)), math.pi / 2))

    # ---- the card terminal, its OWN DEVICE on a stalk
    tx, ty, tz = -0.0180, -0.1560, HH + 0.0640
    p["term_stalk"] = CL._sweep("Reg_TermStalk",
                                [Vector((tx, ty + 0.0320, HH + 0.0060)),
                                 Vector((tx, ty + 0.0140, tz - 0.0180))],
                                0.0072, sides=8)
    p["term_body"] = panel("Reg_TermBody", (tx, ty, tz),
                           (0.0740, 0.0260, 0.1180), bevel=0.0042)
    p["term_body"].rotation_mode = "XYZ"
    p["term_body"].rotation_euler = (math.radians(34), 0, 0)
    p["term_screen"] = screen_quad("Reg_TermScreen", _face_centre(
        (tx, ty, tz), 34, 0.0260, up_offset=0.0185), (0.0580, 0.0450),
        normal=(0, -1, 0), tilt=34, cell=1)
    tkp, _, _ = keypad("Reg_TermPad", (tx, ty - 0.0250, tz - 0.0330),
                       cols=3, rows=2, key=0.0125, gap=0.0028)
    p.update(tkp)
    return p, (iw, idp, 0.0690), note_h


def materialise(parts):
    body = HS.pbr("Reg_BodyMat", (0.108, 0.116, 0.126), roughness=0.46)
    dark = HS.pbr("Reg_DarkMat", (0.042, 0.045, 0.050), roughness=0.58)
    metal = HS.pbr("Reg_MetalMat", (0.585, 0.594, 0.602), roughness=0.30,
                   metallic=0.88)
    # ONE accent, not two. The register costs five materials rather than four,
    # and the fifth buys the coloured function keys.
    accent = HS.pbr("Reg_AccentMat", (0.118, 0.430, 0.242), roughness=0.42)
    glow = HS.pbr_textured("Reg_ScreenMat", TEX, roughness=0.16)
    # THE SCREEN EMITS. pbr_textured has no emission argument, so the image goes
    # into the emission socket as well as base colour -- the previous register's
    # monitor was dead in both engines because nothing ever wired one.
    nt = glow.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    img = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
    if "Emission Color" in bsdf.inputs:
        nt.links.new(img.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 2.6
    for name, ob in parts.items():
        n = name.lower()
        if ob.get("screen"):
            m = glow
        elif ob.get("accent"):
            m = accent
        elif any(k in n for k in ("pull", "scan_glass", "paper", "pole")):
            m = metal
        elif any(k in n for k in ("_k", "pad", "term", "printer", "bezel",
                                  "drawer_box", "tray", "ndiv", "cdiv",
                                  "recess", "slot", "seam", "kick")):
            m = dark
        else:
            m = body
        ob.data.materials.append(m)
    return 5


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = next((x.split("=", 1)[1] for x in args if x.startswith("break=")), "")
    shut = "shut" in args
    suffix = ((f"-BROKEN-{broken}" if broken else "")
              + ("-shut" if shut else "")
              + ("" if engine == "CYCLES" else "-eevee"))

    H.reset_scene()
    H.set_engine(engine, samples=190 if engine == "CYCLES" else 96)
    parts, interior, note_h = build(drawer_open=not shut, broken=broken)
    mats = materialise(parts)

    mesh = {k: v for k, v in parts.items() if hasattr(v, "data")}
    if not broken:
        HS.assert_all_one_piece(mesh, "register: every part is one piece")
        # A till is a shell with things RECESSED INTO it and a drawer INSIDE it.
        # Every such pair is named; anything else that interpenetrates fails.
        inner = [n for n in mesh if any(k in n for k in
                 ("drawer", "ndiv", "cdiv", "note_tray"))]
        shell = ["core", "deck", "seam", "kick", "back", "side0", "side1"]
        keys = [n for n in mesh if "_k" in n and "Pad" in n]
        allow = [(a, b) for a in inner for b in shell]
        allow += [(a, b) for i, a in enumerate(inner) for b in inner[i + 1:]]
        allow += [(k, "Reg_Pad_surround") for k in keys]
        allow += [(k, "Reg_TermPad_surround") for k in keys]
        allow += [(k, h) for k in keys for h in ("core", "deck", "term_body",
                                                 "term_screen")]
        allow += [(a, b) for a in ("Reg_Pad_surround", "Reg_TermPad_surround")
                  for b in ("core", "deck", "term_body", "term_screen",
                            "term_stalk")]
        allow += [("riser", "riser_seam"), ("riser", "bezel"),
                  ("bezel", "screen"), ("cust_bezel", "cust_screen"),
                  ("pole", "cust_bezel"), ("printer", "printer_lid"),
                  ("printer", "printer_slot"), ("printer", "paper"),
                  ("printer_slot", "paper"), ("term_body", "term_screen"),
                  ("term_body", "term_stalk"), ("scan_recess", "scan_glass"),
                  ("core", "scan_recess"), ("core", "drawer_recess"),
                  ("deck", "scan_recess"), ("deck", "scan_glass"),
                  ("core", "riser"), ("core", "pole"), ("core", "printer"),
                  ("core", "term_stalk"), ("deck", "term_stalk"),
                  ("deck", "riser"), ("deck", "printer"), ("deck", "pole"),
                  ("core", "deck"), ("core", "seam"), ("core", "kick"),
                  ("core", "back"), ("core", "side0"), ("core", "side1"),
                  ("seam", "side0"), ("seam", "side1"), ("seam", "back"),
                  ("core", "drawer_front"), ("drawer_recess", "drawer_front")]
        HS.assert_assembly(mesh, "the register", require_attached=False,
                           max_depth=0.0130, allow=allow)

    subject = list(mesh.values())
    lo, hi = H.bounds(subject)
    print(f"register C: TRIS {H.triangles(subject)} in {len(subject)} parts, "
          f"{mats} materials")
    print(f"  overall {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} "
          f"x {(hi.z - lo.z) * 1000:.0f} mm")
    print(f"  DRAWER INTERIOR {interior[0] * 1000:.0f} x "
          f"{interior[1] * 1000:.0f} x {interior[2] * 1000:.0f} mm")
    print(f"    note tray {note_h * 1000:.0f} mm deep, 4 bays "
          f"({interior[0] / 4 * 1000:.0f} mm each; a note is "
          f"{NOTE_L * 1000:.0f} mm long and lies ACROSS them)")
    print(f"    coin well beneath, 5 bays ({interior[0] / 5 * 1000:.0f} mm "
          f"each; a coin is {COIN_D * 1000:.0f} mm across)")

    centre, radius = H.subject_sphere(subject)
    LENS = 76.0
    dist = H.fit_distance(radius, LENS, res=(1000, 1000), margin=1.18)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)
    tt = H.turntable(centre, dist, OUT_RENDER, f"register{suffix}", views=8,
                     elevation=18.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER,
                                     f"register{suffix}-turntable.png"))
    for label, az, el, zoom in (("hero", -118, 20, 1.0), ("front", -90, 8, 1.0),
                                ("cashier", -62, 34, 0.86),
                                ("cust", 74, 12, 1.0),
                                ("keys", -100, 40, 0.52)):
        cam = H.camera(label, H.orbit_position(centre, dist * zoom, az, el),
                       centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"register{suffix}-{label}.png"),
                 res=(1200, 1200))
    if not broken and engine == "CYCLES" and not shut:
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(GLB_DIR, "register_lane_head.glb"))


if __name__ == "__main__":
    main()
