"""Asset Sheet 04 — retail fixtures & furniture (assets 31-40).

The floor furniture in the established store language: warm walnut, black
powder-coated steel, charcoal, restrained brass, deep green felt, leather in
the lounge, industrial steel in the stockroom and office. Original fictional
branding only (FAIRHOLLOW GOLF CLUB).

Every builder returns a kit asset root (front toward -Y, z up from 0, meters).
Fit sources (measured live product GLBs + game contracts):

    polo_folded    0.300 x 0.063 x 0.250   stacks 3-high per slot
    carton (case)  0.42  x 0.31  x 0.37    backroom dressing on the racks
    laptop deck    LAPTOP.deck (core/laptopRig) sits ON the office desk top
    player reach   1.55 yd from the register stand (checkout-space tests)
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
import bmesh

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_props as L
import checkout_kit_lib as K
import checkout_retail_lib as K3


# ============================================================ materials =========

def leather_img(name, base, *, seed=51, w=512, h=512):
    """Warm upholstery leather: broad mottle + fine pore grain + a few soft
    crease shadows, so the big cushions read as hide, not painted plastic."""
    import numpy as np
    rng = np.random.default_rng(seed)
    b = np.array(base, "float32")
    field = (L._fbm(rng, w, h, 9, 9, 5) - 0.5) * 0.22
    pores = (rng.random((h, w)).astype("float32") - 0.5) * 0.05
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    creases = np.zeros((h, w), "float32")
    for k in range(5):
        cx, cy = rng.uniform(0.15, 0.85) * w, rng.uniform(0.15, 0.85) * h
        ang = rng.uniform(0, math.pi)
        d = np.abs((xx - cx) * math.sin(ang) - (yy - cy) * math.cos(ang))
        creases -= np.exp(-(d / 6.0) ** 2) * 0.10
    arr = np.clip(b[None, None, :] * (1.0 + field + pores + creases)[..., None], 0, 1)
    return K.np_image(name, arr)


def tote_label_img(name, line, *, w=256, h=128, header=True):
    """The paper card in a tote's label holder (or a bare drawer label when
    header=False). Glyphs run ~5*px wide, so each line's px derives from the
    canvas span — long lines shrink instead of overflowing into noise."""
    import numpy as np
    arr = K.noise_base((0.80, 0.78, 0.72), w, h, mottle=0.03, seed=57, cells=5).copy()
    ink = (0.10, 0.11, 0.10)
    if header:
        arr[10:14, 12:w - 12] = (0.16, 0.30, 0.20)
        hpx = max(1, int(w * 0.90 / (len("FAIRHOLLOW SUPPLY") * 5)))
        K.draw_text(arr, "FAIRHOLLOW SUPPLY", w // 2, int(h * 0.34), hpx, ink)
        lpx = max(1, int(w * 0.78 / (max(len(line), 8) * 5)))
        K.draw_text(arr, line, w // 2, int(h * 0.66), lpx, ink)
    else:
        lpx = max(1, int(w * 0.85 / (max(len(line), 6) * 5)))
        K.draw_text(arr, line, w // 2, h // 2, lpx, ink)
    return K.np_image(name, arr)


def furniture_mats(M):
    """Sheet-04 additions to the shared kit palette (built once per scene)."""
    return {
        "leather": K.m_tex("M_ClubLeather", leather_img("ClubLeather", (0.148, 0.080, 0.044)), rough=0.52),
        "leather_black": K.m_tex("M_TaskLeather", leather_img("TaskLeather", (0.052, 0.054, 0.058), seed=53), rough=0.48),
        "filing_steel": K.m_tex("M_FilingSteel", K.plastic_img("FilingSteel", (0.230, 0.250, 0.240), seed=55, mottle=0.05), rough=0.42, metal=0.45),
        "tote_olive": K.m_tex("M_ToteOlive", K.plastic_img("ToteOlive", (0.135, 0.165, 0.095), seed=61), rough=0.62),
        "tote_slate": K.m_tex("M_ToteSlate", K.plastic_img("ToteSlate", (0.150, 0.190, 0.250), seed=62), rough=0.62),
        "tote_charcoal": K.m_tex("M_ToteCharcoal", K.plastic_img("ToteCharcoal", (0.095, 0.100, 0.108), seed=63), rough=0.62),
        "tote_stone": K.m_tex("M_ToteStone", K.plastic_img("ToteStone", (0.400, 0.390, 0.360), seed=64), rough=0.62),
    }


# ============================================================ small parts =======

def tapered_box(name, top, bot, h, loc, mat, *, parent=None, z0=0.0):
    """A tote-style tapered prism: `top`=(w,d) at z0+h, `bot`=(w,d) at z0.
    Planar per-face UVs; one bmesh."""
    tw, td = top
    bw, bd = bot
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    lo = [bm.verts.new((sx * bw / 2, sy * bd / 2, z0)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    hi = [bm.verts.new((sx * tw / 2, sy * td / 2, z0 + h)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    faces = [bm.faces.new(lo[::-1]), bm.faces.new(hi)]
    for i in range(4):
        j = (i + 1) % 4
        faces.append(bm.faces.new((lo[i], lo[j], hi[j], hi[i])))
    for f in faces:
        for loop in f.loops:
            co = loop.vert.co
            loop[uvl].uv = ((co.x + co.y) * 1.2 % 1.0, (co.z - z0) / max(h, 0.01) * 0.8 + 0.1)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    o.location = loc
    bpy.context.collection.objects.link(o)
    me.materials.append(mat)
    if parent is not None:
        L.parent_keep(o, parent)
    return o


def steel_leg_frame(root, M, W, D, H, *, inset=0.06, leg=0.045, tag=""):
    """Four black steel legs + connecting aprons under a table top."""
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        L.box(f"Leg_{tag}{i + 1:02d}", (leg, leg, H), (sx * (W / 2 - inset), sy * (D / 2 - inset), H / 2), M["black"], bevel=0.003, parent=root)
    for sy, side in ((-1, "F"), (1, "B")):
        L.box(f"Apron_{tag}{side}", (W - inset * 2 - leg, 0.032, 0.07), (0, sy * (D / 2 - inset), H - 0.045), M["black"], bevel=0, parent=root)
    for sx, side in ((-1, "L"), (1, "R")):
        L.box(f"Apron_{tag}{side}", (0.032, D - inset * 2 - leg, 0.07), (sx * (W / 2 - inset), 0, H - 0.045), M["black"], bevel=0, parent=root)


# ============================================================ the builders ======

def build_merch_table(M):
    """Sheet-04 #31: the center merchandise table — 1.40 x 0.80 x 0.75,
    two-tier: walnut top + lower display shelf on a black steel frame.
    In-game it takes the centre-floor feature spot; the featured stock is
    dressed onto MERCH_TABLE_SLOT_01..06 (top) and _LOWER_01..04."""
    W, D, H = 1.40, 0.80, 0.75
    root = K.asset_root("merch_table", (W, D, H))
    steel_leg_frame(root, M, W, D, H - 0.04)
    L.rounded_box("Top", (W, D, 0.040), (0, 0, H - 0.020), M["walnut"], corner=0.012, bevel=0.005, segments=3, uv=True, parent=root)
    L.rounded_box("Lower_Shelf", (W - 0.16, D - 0.14, 0.028), (0, 0, 0.28), M["walnut"], corner=0.008, bevel=0.004, segments=3, uv=True, parent=root)
    for sx in (-1, 1):
        L.box(f"Shelf_Rail_{'LR'[sx > 0]}", (0.024, D - 0.16, 0.05), (sx * (W / 2 - 0.085), 0, 0.28), M["black"], bevel=0, parent=root)
    badge = K.uv_plane("Crest_Badge", 0.07, 0.07, (0, -D / 2 + 0.055, H - 0.0405), K.m_tex("M_RetailBadge", K3.crest_badge_img(), rough=0.62))
    badge.rotation_euler = (math.radians(-90), 0, 0)
    L.parent_keep(badge, root)
    n = 0
    for zy in (-0.20, 0.20):
        for x in (-0.45, 0.0, 0.45):
            n += 1
            K.empty(f"MERCH_TABLE_SLOT_{n:02d}", (x, zy, H + 0.001), parent=root, size=0.04,
                    props={"socket": "display", "order": n})
    for i, x in enumerate((-0.45, -0.15, 0.15, 0.45)):
        K.empty(f"MERCH_TABLE_LOWER_{i + 1:02d}", (x, 0, 0.295), parent=root, size=0.04,
                props={"socket": "display_low", "order": i + 1})
    K.collision_box("COL_MerchTable", (W, D, H), (0, 0, H / 2), M, root)
    return root


def build_apparel_table(M):
    """Sheet-04 #33: the folded apparel table — 1.60 x 0.90 x 0.80, heavy
    walnut top with an open storage shelf below.

    Fit: a folded polo is 0.30 x 0.25 and stacks 3-high (0.063/unit): the top
    carries EIGHT stack positions (4 x 2 at 0.38 / 0.42 pitch) — both polo
    lanes' twelve units land here with air between every stack."""
    W, D, H = 1.60, 0.90, 0.80
    root = K.asset_root("apparel_table", (W, D, H))
    steel_leg_frame(root, M, W, D, H - 0.055, inset=0.07, leg=0.05)
    L.rounded_box("Top", (W, D, 0.055), (0, 0, H - 0.0275), M["walnut"], corner=0.015, bevel=0.006, segments=3, uv=True, parent=root)
    L.rounded_box("Lower_Shelf", (W - 0.18, D - 0.16, 0.030), (0, 0, 0.25), M["walnut"], corner=0.008, bevel=0.004, segments=3, uv=True, parent=root)
    for sx in (-1, 1):
        L.box(f"Shelf_Rail_{'LR'[sx > 0]}", (0.024, D - 0.18, 0.05), (sx * (W / 2 - 0.095), 0, 0.25), M["black"], bevel=0, parent=root)
    badge = K.uv_plane("Crest_Badge", 0.07, 0.07, (0, -D / 2 + 0.06, H - 0.0555), K.m_tex("M_RetailBadge", K3.crest_badge_img(), rough=0.62))
    badge.rotation_euler = (math.radians(-90), 0, 0)
    L.parent_keep(badge, root)
    n = 0
    for zy in (-0.21, 0.21):
        for x in (-0.57, -0.19, 0.19, 0.57):
            n += 1
            K.empty(f"APPAREL_TABLE_SLOT_{n:02d}", (x, zy, H + 0.001), parent=root, size=0.04,
                    props={"socket": "folded_stack", "order": n})
    for i, x in enumerate((-0.54, -0.18, 0.18, 0.54)):
        K.empty(f"APPAREL_TABLE_LOWER_{i + 1:02d}", (x, 0, 0.266), parent=root, size=0.04,
                props={"socket": "folded_stack_low", "order": i + 1})
    K.collision_box("COL_ApparelTable", (W, D, H), (0, 0, H / 2), M, root)
    return root


def build_retail_gondola(M):
    """Sheet-04 #32: the freestanding gondola — 1.20 x 0.60 x 1.40, double
    sided: three oak shelves each face off a walnut spine, slatwall end
    panels for hooks, black plinth and top cap. Ships EMPTY; the twelve
    slots per face await future product lines."""
    W, D, H = 1.20, 0.60, 1.40
    root = K.asset_root("retail_gondola", (W, D, H))
    L.box("Plinth", (W - 0.04, D - 0.06, 0.10), (0, 0, 0.05), M["counter_black"], bevel=0.004, parent=root)
    L.box("Spine", (W - 0.06, 0.05, H - 0.145), (0, 0, (H - 0.145) / 2 + 0.10), M["walnut"], bevel=0.004, parent=root)
    L.rounded_box("Top_Cap", (W, D * 0.36, 0.045), (0, 0, H - 0.0225), M["walnut"], corner=0.010, bevel=0.005, segments=3, uv=True, parent=root)
    shelf_zs = (0.34, 0.72, 1.06)
    n = {"F": 0, "B": 0}
    for sy, face in ((-1, "F"), (1, "B")):
        for si, z in enumerate(shelf_zs):
            L.rounded_box(f"Shelf_{face}{si + 1:02d}", (W - 0.08, 0.235, 0.024), (0, sy * 0.145, z), M["oak_slat"],
                          corner=0.005, bevel=0.003, segments=3, uv=True, parent=root)
            L.box(f"Shelf_Lip_{face}{si + 1:02d}", (W - 0.08, 0.010, 0.018), (0, sy * 0.256, z + 0.004), M["brass"], bevel=0, parent=root)
            for bx in (-1, 1):
                L.box(f"Shelf_Bracket_{face}{si + 1:02d}{'LR'[bx > 0]}", (0.020, 0.20, 0.016),
                      (bx * (W / 2 - 0.10), sy * 0.13, z - 0.020), M["black"], bevel=0, parent=root)
            for k, x in enumerate((-0.42, -0.14, 0.14, 0.42)):
                n[face] += 1
                K.empty(f"GONDOLA_SLOT_{face}{n[face]:02d}", (x, sy * 0.15, z + 0.013), parent=root, size=0.03,
                        props={"socket": "gondola_shelf", "order": n[face], "face": face})
    # slatwall end panels facing OUTWARD (hooks clip on later, like the
    # accessory wall): the slat's -Y face rotates to -X on the left end, +X on
    # the right
    for sx, tag in ((-1, "L"), (1, "R")):
        end = K3.hslat(f"End_Slat_{tag}", 0.52, 1.195, M["oak_slat"], seed=71 + (sx > 0), thick=0.014, board_h=0.088, gap=0.010)
        end.location = (sx * (W / 2 - 0.012), 0, 0.16)
        end.rotation_euler = (0, 0, sx * math.pi / 2)
        L.parent_keep(end, root)
        badge = K.uv_plane(f"Crest_Badge_{tag}", 0.09, 0.09, (sx * (W / 2 - 0.002), 0, H - 0.14),
                           K.m_tex("M_RetailBadge", K3.crest_badge_img(), rough=0.62))
        badge.rotation_euler = (0, 0, sx * math.pi / 2)
        L.parent_keep(badge, root)
    K.collision_box("COL_RetailGondola", (W, D, H), (0, 0, H / 2), M, root)
    return root


def build_stock_shelving(M):
    """Sheet-04 #34: the stockroom shelving unit — 1.20 x 0.50 x 2.00, heavy
    duty: black steel angle posts, four pale board shelves with front lips,
    X-braced back. The backroom's carton dressing lands on the boards
    (tops at 0.145 / 0.645 / 1.145 / 1.645)."""
    W, D, H = 1.20, 0.50, 2.00
    root = K.asset_root("stock_shelving", (W, D, H))
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        L.box(f"Post_{'L' if sx < 0 else 'R'}{'F' if sy < 0 else 'B'}", (0.055, 0.055, H),
              (sx * (W / 2 - 0.03), sy * (D / 2 - 0.03), H / 2), M["black"], bevel=0, parent=root)
        L.box(f"Foot_{'L' if sx < 0 else 'R'}{'F' if sy < 0 else 'B'}", (0.10, 0.10, 0.016),
              (sx * (W / 2 - 0.03), sy * (D / 2 - 0.03), 0.008), M["black"], bevel=0, parent=root)
    boards = (0.128, 0.628, 1.128, 1.628)
    for i, z in enumerate(boards):
        L.box(f"Board_{i + 1:02d}", (W - 0.03, D - 0.04, 0.035), (0, 0, z), M["oak_slat"], bevel=0.003, parent=root)
        L.box(f"Board_Lip_{i + 1:02d}", (W - 0.03, 0.014, 0.045), (0, -D / 2 + 0.035, z + 0.005), M["black"], bevel=0, parent=root)
        K.empty(f"STOCK_SHELF_SLOT_{i + 1:02d}", (0, 0, z + 0.0175), parent=root, size=0.04,
                props={"socket": "stock_board", "order": i + 1})
    # X-bracing across the back
    for k in range(3):
        z0, z1 = boards[k] + 0.03, boards[k + 1] - 0.03
        length = math.hypot(W - 0.12, z1 - z0)
        for direction in (1, -1):
            brace = L.box(f"Brace_{k + 1:02d}{'ab'[direction > 0]}", (length, 0.018, 0.014),
                          (0, D / 2 - 0.02, (z0 + z1) / 2), M["black"], bevel=0, parent=root)
            brace.rotation_euler = (0, direction * math.atan2(z1 - z0, W - 0.12), 0)
    K.collision_box("COL_StockShelving", (W, D, H), (0, 0, H / 2), M, root)
    return root


def make_tote_builder(color_key, label_line):
    def build(M):
        """Sheet-04 #35: a stackable backroom tote — 0.60 x 0.40 x 0.30,
        tapered body, stack rim, grip recesses, front label holder."""
        F = furniture_mats(M)
        W, D, H = 0.60, 0.40, 0.30
        name = f"storage_tote_{color_key}"
        root = K.asset_root(name, (W, D, H))
        body = F[f"tote_{color_key}"]
        tapered_box("Tote_Body", (W, D), (W - 0.08, D - 0.06), H - 0.03, (0, 0, 0), body, parent=root)
        # stack rim: four bars framing the mouth (the next tote's base seats inside)
        for sy in (-1, 1):
            L.box(f"Rim_{'FB'[sy > 0]}", (W, 0.030, 0.030), (0, sy * (D / 2 - 0.015), H - 0.015), body, bevel=0.003, parent=root)
        for sx in (-1, 1):
            L.box(f"Rim_{'LR'[sx > 0]}", (0.030, D - 0.06, 0.030), (sx * (W / 2 - 0.015), 0, H - 0.015), body, bevel=0.003, parent=root)
        # the walls taper (0.04/0.03 narrower at the base over body_h), so
        # surface features must ride the slanted face, not the top footprint
        body_h = H - 0.03
        lean_f = math.atan2(0.03, body_h)
        lean_s = math.atan2(0.04, body_h)
        zg = H - 0.055
        side_x = (W - 0.08) / 2 + 0.04 * (zg / body_h)
        for sx in (-1, 1):
            grip = L.box(f"Grip_{'LR'[sx > 0]}", (0.022, 0.14, 0.035), (sx * (side_x + 0.002), 0, zg), M["charcoal"], bevel=0, parent=root)
            grip.rotation_euler = (0, sx * lean_s, 0)
        zl = H - 0.115
        face_y = (D - 0.06) / 2 + 0.03 * (zl / body_h)
        hold = L.box("Label_Holder", (0.19, 0.012, 0.12), (0, -(face_y + 0.004), zl), M["charcoal"], bevel=0, parent=root)
        hold.rotation_euler = (lean_f, 0, 0)
        lab = K.uv_plane("Label_Card", 0.165, 0.095, (0, -(face_y + 0.013), zl),
                         K.m_tex(f"M_ToteLabel_{color_key}", tote_label_img(f"ToteLabel_{color_key}", label_line), rough=0.8))
        lab.rotation_euler = (lean_f, 0, 0)
        L.parent_keep(lab, root)
        K.empty("TOTE_STACK_SOCKET", (0, 0, H - 0.012), parent=root, size=0.04, props={"socket": "tote_stack"})
        K.collision_box(f"COL_StorageTote_{color_key}", (W, D, H), (0, 0, H / 2), M, root)
        return root
    return build


def build_lounge_armchair(M):
    """Sheet-04 #36: the lounge armchair — 0.85 x 0.85 x 0.85 leather club
    chair: rolled arms, tufted-look back cushion, walnut feet."""
    F = furniture_mats(M)
    W, D, H = 0.85, 0.85, 0.85
    root = K.asset_root("lounge_armchair", (W, D, H))
    lea = F["leather"]
    L.rounded_box("Base", (W, D - 0.06, 0.30), (0, 0.03, 0.21), lea, corner=0.06, bevel=0.010, segments=4, uv=True, parent=root)
    L.rounded_box("Seat_Cushion", (W - 0.26, 0.56, 0.14), (0, 0.10, 0.42), lea, corner=0.05, bevel=0.012, segments=4, uv=True, parent=root)
    for sx in (-1, 1):
        L.rounded_box(f"Arm_{'LR'[sx > 0]}", (0.13, D - 0.10, 0.30), (sx * (W / 2 - 0.065), 0.01, 0.505), lea,
                      corner=0.035, bevel=0.010, segments=4, uv=True, parent=root)
        roll = L.cyl(f"Arm_Roll_{'LR'[sx > 0]}", 0.068, D - 0.12, (sx * (W / 2 - 0.065), 0.01, 0.655), lea, verts=14, bevel=0, parent=root)
        roll.rotation_euler = (math.radians(90), 0, 0)
    back = L.rounded_box("Back", (W - 0.02, 0.15, 0.52), (0, D / 2 - 0.10, 0.56), lea, corner=0.04, bevel=0.010, segments=4, uv=True, parent=root)
    back.rotation_euler = (math.radians(-7), 0, 0)
    cushion = L.rounded_box("Back_Cushion", (W - 0.28, 0.10, 0.36), (0, D / 2 - 0.185, 0.545), lea, corner=0.05, bevel=0.012, segments=4, uv=True, parent=root)
    cushion.rotation_euler = (math.radians(-7), 0, 0)
    roll = L.cyl("Back_Roll", 0.062, W - 0.06, (0, D / 2 - 0.115, 0.825), lea, verts=14, bevel=0, parent=root)
    roll.rotation_euler = (0, math.radians(90), 0)

    # Tufting. The docstring has always claimed a "tufted-look back cushion",
    # but nothing carried it in geometry, so every mass shared one flat leather
    # and the chair read as a single soft blob. Sunk buttons in a diamond grid
    # give the back the shadow breaks the reference sheet shows.
    for r, (count, z) in enumerate(((3, 0.475), (2, 0.615))):
        for c in range(count):
            u = (c - (count - 1) / 2) * 0.145
            btn = L.cyl(f"Tuft_Button_{r + 1}{c + 1}", 0.021, 0.020,
                        (u, D / 2 - 0.245, z), lea, verts=10, bevel=0, parent=root)
            btn.rotation_euler = (math.radians(83), 0, 0)

    # Tapered walnut feet. The old 28 mm stubs were invisible under the skirt;
    # the reference stands the chair on legs you can actually see.
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        L.frustum(f"Foot_{'L' if sx < 0 else 'R'}{'F' if sy < 0 else 'B'}", 0.042, 0.028, 0.11,
                  (sx * (W / 2 - 0.09), sy * (D / 2 - 0.11), 0.055), M["walnut"],
                  segments=8, parent=root)
    K.collision_box("COL_LoungeArmchair", (W, D, H), (0, 0, H / 2), M, root)
    return root


def _round_table(root, M, name_prefix, radius, height):
    """Round walnut top + black ring band + three flat legs + lower support ring.

    The sheet names a "lower support ring" for #37, and the reference shows a
    slender steel hoop passing the legs. This was a solid walnut disc, which
    read as a second shelf and lost the open look the reference has."""
    L.cyl(f"{name_prefix}Top", radius, 0.042, (0, 0, height - 0.021), M["walnut"], verts=28, bevel=0.006, parent=root)
    L.cyl(f"{name_prefix}Band", radius - 0.025, 0.035, (0, 0, height - 0.058), M["black"], verts=28, bevel=0, parent=root)
    for k in range(3):
        a = k * math.tau / 3 + math.pi / 6
        leg = L.box(f"{name_prefix}Leg_{k + 1:02d}", (0.055, 0.022, height - 0.075), (math.cos(a) * (radius - 0.06), math.sin(a) * (radius - 0.06), (height - 0.075) / 2), M["black"], bevel=0, parent=root)
        leg.rotation_euler = (0, 0, a)
    L.torus(f"{name_prefix}Support_Ring", radius * 0.62, 0.011, (0, 0, 0.10), M["black"], parent=root, mj=24, mn=6)


def build_lounge_coffee_table(M):
    """Sheet-04 #37: the round lounge coffee table — dia 1.00 x 0.45, walnut
    top on a black steel frame with a lower ring shelf."""
    root = K.asset_root("lounge_coffee_table", (1.00, 1.00, 0.45))
    _round_table(root, M, "", 0.50, 0.45)
    K.collision_box("COL_LoungeCoffeeTable", (1.00, 1.00, 0.45), (0, 0, 0.225), M, root)
    return root


def build_lounge_side_table(M):
    """Sheet-04 #37 companion: the smaller nesting side table — dia 0.55 x 0.38
    (the pair shown beside the main table in the reference)."""
    root = K.asset_root("lounge_side_table", (0.55, 0.55, 0.38))
    _round_table(root, M, "", 0.275, 0.38)
    K.collision_box("COL_LoungeSideTable", (0.55, 0.55, 0.38), (0, 0, 0.19), M, root)
    return root


def build_office_desk(M):
    """Sheet-04 #38: the executive office desk — 1.60 x 0.80 x 0.75: walnut
    top, two drawer pedestals with brass pulls, modesty panel. The office
    laptop seats on DESK_LAPTOP_SOCKET (top surface 0.75, front toward -Y
    where the chair stands)."""
    W, D, H = 1.60, 0.80, 0.75
    root = K.asset_root("office_desk", (W, D, H))
    L.rounded_box("Top", (W, D, 0.045), (0, 0, H - 0.0225), M["walnut"], corner=0.012, bevel=0.005, segments=3, uv=True, parent=root)
    for sx, tag in ((-1, "L"), (1, "R")):
        px = sx * (W / 2 - 0.24)
        L.box(f"Pedestal_{tag}", (0.44, D - 0.10, 0.63), (px, 0.01, 0.375), M["charcoal"], bevel=0.005, parent=root)
        L.box(f"Pedestal_Kick_{tag}", (0.38, D - 0.16, 0.06), (px, 0.01, 0.03), M["counter_black"], bevel=0, parent=root)
        for di, z in enumerate((0.20, 0.40, 0.585)):
            L.box(f"Drawer_{tag}{di + 1:02d}", (0.385, 0.020, 0.155), (px, -D / 2 + 0.045, z), M["walnut"], bevel=0.004, parent=root)
            pull = L.cyl(f"Pull_{tag}{di + 1:02d}", 0.0065, 0.09, (px, -D / 2 + 0.030, z + 0.045), M["brass"], verts=8, bevel=0, parent=root)
            pull.rotation_euler = (0, math.radians(90), 0)
    L.box("Modesty_Panel", (W - 0.92, 0.025, 0.42), (0, D / 2 - 0.08, 0.46), M["charcoal"], bevel=0.004, parent=root)
    K.empty("DESK_LAPTOP_SOCKET", (0.05, -0.06, H + 0.001), parent=root, size=0.05, props={"socket": "laptop"})
    K.collision_box("COL_OfficeDesk", (W, D, H), (0, 0, H / 2), M, root)
    return root


def build_office_chair(M):
    """Sheet-04 #39: the padded office chair — 0.65 x 0.65 x 1.10: five-star
    caster base, gas lift, black leather seat/back, armrests."""
    F = furniture_mats(M)
    W, D, H = 0.65, 0.65, 1.10
    root = K.asset_root("office_chair", (W, D, H))
    lea = F["leather_black"]
    for k in range(5):
        a = k * math.tau / 5 + math.pi / 2
        leg = L.box(f"Star_Leg_{k + 1:02d}", (0.30, 0.045, 0.035), (math.cos(a) * 0.15, math.sin(a) * 0.15, 0.055), M["charcoal"], bevel=0.003, parent=root)
        leg.rotation_euler = (0, 0, a)
        L.cyl(f"Caster_{k + 1:02d}", 0.024, 0.03, (math.cos(a) * 0.28, math.sin(a) * 0.28, 0.026), M["black"], verts=10, bevel=0, parent=root)
    L.cyl("Gas_Lift", 0.026, 0.24, (0, 0, 0.20), M["black"], verts=12, bevel=0, parent=root)
    L.cyl("Lift_Boot", 0.040, 0.10, (0, 0, 0.12), M["charcoal"], verts=12, bevel=0, parent=root)
    L.rounded_box("Seat", (0.50, 0.50, 0.105), (0, 0.01, 0.435), lea, corner=0.05, bevel=0.010, segments=4, uv=True, parent=root)
    back = L.rounded_box("Back", (0.47, 0.095, 0.55), (0, D / 2 - 0.115, 0.795), lea, corner=0.055, bevel=0.010, segments=4, uv=True, parent=root)
    back.rotation_euler = (math.radians(-5), 0, 0)
    L.box("Back_Spine", (0.06, 0.03, 0.30), (0, D / 2 - 0.155, 0.52), M["charcoal"], bevel=0.003, parent=root)
    for sx in (-1, 1):
        L.box(f"Arm_Post_{'LR'[sx > 0]}", (0.028, 0.028, 0.16), (sx * 0.27, -0.02, 0.545), M["charcoal"], bevel=0, parent=root)
        L.rounded_box(f"Arm_Pad_{'LR'[sx > 0]}", (0.065, 0.26, 0.028), (sx * 0.27, -0.02, 0.635), M["rubber"], corner=0.02, bevel=0.005, segments=3, uv=True, parent=root)
    K.collision_box("COL_OfficeChair", (0.62, 0.62, H), (0, 0, H / 2), M, root)
    return root


def build_filing_cabinet(M):
    """Sheet-04 #40: the four-drawer filing cabinet — 0.48 x 0.62 x 1.32,
    steel body, recessed pulls, label holders."""
    F = furniture_mats(M)
    W, D, H = 0.48, 0.62, 1.32
    root = K.asset_root("filing_cabinet", (W, D, H))
    steel = F["filing_steel"]
    L.box("Body", (W, D, H - 0.03), (0, 0, (H - 0.03) / 2 + 0.03), steel, bevel=0.007, parent=root)
    L.box("Plinth", (W - 0.04, D - 0.04, 0.05), (0, 0, 0.025), M["counter_black"], bevel=0, parent=root)
    for i in range(4):
        z = 0.20 + i * 0.30
        L.box(f"Drawer_{i + 1:02d}", (W - 0.05, 0.018, 0.255), (0, -D / 2 - 0.002, z + 0.10), steel, bevel=0.004, parent=root)
        L.box(f"Pull_{i + 1:02d}", (0.13, 0.020, 0.030), (0, -D / 2 - 0.016, z + 0.185), M["charcoal"], bevel=0, parent=root)
        L.box(f"Label_Frame_{i + 1:02d}", (0.09, 0.008, 0.045), (0, -D / 2 - 0.014, z + 0.115), M["charcoal"], bevel=0, parent=root)
        word = ("LEDGERS", "SUPPLIERS", "STAFF", "COURSE")[i]
        lab = K.uv_plane(f"Label_{i + 1:02d}", 0.075, 0.032, (0, -D / 2 - 0.019, z + 0.115),
                         K.m_tex(f"M_FileLabel_{i + 1}", tote_label_img(f"FileLabel_{i + 1}", word, w=128, h=64, header=False), rough=0.8))
        L.parent_keep(lab, root)
    K.collision_box("COL_FilingCabinet", (W, D, H), (0, 0, H / 2), M, root)
    return root


# ============================================================ registry ==========

BUILDERS = {
    "merch_table": build_merch_table,
    "retail_gondola": build_retail_gondola,
    "apparel_table": build_apparel_table,
    "stock_shelving": build_stock_shelving,
    "storage_tote_olive": make_tote_builder("olive", "RANGE STOCK"),
    "storage_tote_slate": make_tote_builder("slate", "APPAREL"),
    "storage_tote_charcoal": make_tote_builder("charcoal", "HARDWARE"),
    "storage_tote_stone": make_tote_builder("stone", "RETURNS"),
    "lounge_armchair": build_lounge_armchair,
    "lounge_coffee_table": build_lounge_coffee_table,
    "lounge_side_table": build_lounge_side_table,
    "office_desk": build_office_desk,
    "office_chair": build_office_chair,
    "filing_cabinet": build_filing_cabinet,
}

EXTRA_PREVIEWS = {
    "merch_table": [("merch_table_front", 25, 10)],
    "retail_gondola": [("retail_gondola_front", 25, 8), ("retail_gondola_end", 115, 8)],
    "apparel_table": [("apparel_table_front", 25, 10)],
    "stock_shelving": [("stock_shelving_front", 25, 8)],
    "lounge_armchair": [("lounge_armchair_front", 15, 8)],
    "office_desk": [("office_desk_front", 25, 10)],
    "office_chair": [("office_chair_front", 15, 8)],
    "filing_cabinet": [("filing_cabinet_front", 20, 8)],
}
