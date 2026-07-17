"""Asset Sheet 03 — the retail fixture family (assets 21-30).

Modular pro-shop fixtures in the established store language: warm walnut,
black steel, dark charcoal, deep green accents, brass hardware.  Everything
is original and fictional (FAIRHOLLOW GOLF CLUB) — no real brands.

Every builder returns a kit asset root (front toward -Y, z up from 0, meters)
and records its FIT CONTRACT: the numbers were measured from the live game
product GLBs (qa/sheet03/measure_products.mjs):

    head_driver  0.111 x 0.109 x 0.122   pivot at hosel, head y -0.087..+0.022
    head_iron    0.101 x 0.100 x 0.026   head y -0.084..+0.016
    head_wedge   0.101 x 0.110 x 0.034
    head_putter  0.115 x 0.080 x 0.052   head y -0.074..+0.006
    cap_pro      0.271 x 0.138 x 0.175   pivot at brim plane, bill runs +x
    glove        0.137 x 0.168 x 0.028   stood upright
    shoe_pro     0.141 x 0.167 x 0.301   length runs z
    rangefinder  0.048 x 0.083 x 0.121   sits on its base
    bag          0.343 x 1.540 x 0.359   stand bag WITH its club fan
    ball box     0.165 x 0.120 x 0.125   procedural (BALL_BOX_GEO)
    carton       0.120 x 0.100 x 0.110   procedural smalls (CARTON_GEO)
    towel roll   dia 0.10  x 0.22        procedural
    sock roll    dia 0.064 x 0.08        procedural
"""

from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy
import bmesh

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_props as L
import checkout_kit_lib as K


# ============================================================ textures ==========

GOLD = (0.52, 0.36, 0.11)
PALE_GOLD = (0.66, 0.52, 0.26)


def _crest(arr, cx, cy, s, gold, pale):
    """The Fairhollow roundel: ring, crossed clubs, ball at the cross.  Pure
    numpy; s is the outer ring radius in px."""
    import numpy as np
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    r = np.hypot(xx - cx, yy - cy)
    ring = (np.abs(r - s) < s * 0.075)
    ring |= (np.abs(r - s * 0.80) < s * 0.035)
    arr[ring] = gold
    # crossed club shafts (two diagonals through the centre)
    for ang in (0.72, math.pi - 0.72):
        dx, dy = math.cos(ang), math.sin(ang)
        t = (xx - cx) * dx + (yy - cy) * dy
        d = np.abs(-(xx - cx) * dy + (yy - cy) * dx)
        shaft = (d < s * 0.045) & (np.abs(t) < s * 0.62)
        arr[shaft] = gold
        # a small head block at the lower end of each shaft
        hx, hy = cx - dx * s * 0.62, cy + abs(dy) * s * 0.62
        head = (np.hypot(xx - hx, yy - hy) < s * 0.11)
        arr[head] = gold
    ball = r < s * 0.17
    arr[ball] = pale
    dim = ((xx.astype(int) + yy.astype(int)) % 5 < 1) & (r < s * 0.14)
    arr[dim] = tuple(c * 0.82 for c in pale)


def crest_header_img(name="RetailCrestHeader", *, w=1024, h=176):
    """Charcoal header banner with gold rules and the club roundel — the shared
    header face for the Sheet-03 wall fixtures (crest only, per the sheet)."""
    import numpy as np
    arr = K.noise_base((0.030, 0.033, 0.038), w, h, mottle=0.05, seed=31, cells=10).copy()
    arr[22:25, 30:w - 30] = GOLD
    arr[h - 25:h - 22, 30:w - 30] = GOLD
    _crest(arr, w // 2, h // 2, h * 0.31, GOLD, PALE_GOLD)
    return K.np_image(name, arr)


def crest_badge_img(name="RetailCrestBadge", *, w=256, h=256):
    """Square crest badge for rails and plinths."""
    import numpy as np
    arr = K.noise_base((0.030, 0.033, 0.038), w, h, mottle=0.05, seed=32, cells=6).copy()
    _crest(arr, w // 2, h // 2, w * 0.36, GOLD, PALE_GOLD)
    return K.np_image(name, arr)


def label_img(name, lines, base, ink, *, w=256, h=128, band=None, repeat=False):
    """A small product label: mottled field, optional accent band, stacked text.
    Glyphs are ~4*px wide, so px derives from the text so nothing overflows the
    canvas (overflow renders as garbage).  repeat=True prints each line twice
    at the quarter points — for bands wrapped fully around a bottle."""
    import numpy as np
    arr = K.noise_base(base, w, h, mottle=0.04, seed=sum(map(ord, name)) % 97 + 3, cells=6).copy()
    if band:
        arr[int(h * 0.70):int(h * 0.86), :] = band
    ys = np.linspace(h * 0.30, h * 0.62, num=len(lines)) if len(lines) > 1 else [h * 0.45]
    span = (w // 2) if repeat else w
    for text, y in zip(lines, ys):
        px = max(4, min(10, int(span / (max(1, len(text)) * 5.0))))
        if repeat:
            K.draw_text(arr, text, w // 4, int(y), px, ink)
            K.draw_text(arr, text, (3 * w) // 4, int(y), px, ink)
        else:
            K.draw_text(arr, text, w // 2, int(y), px, ink)
    return K.np_image(name, arr)


def shoebox_img(name="ShoeBoxArt", *, w=512, h=256):
    """Kraft shoe-box side: brand line + a size chip.  (Glyphs are ~4*px wide:
    px 10 keeps ten letters inside a 512 canvas — px 13 overflowed and printed
    garbage.)"""
    import numpy as np
    arr = K.noise_base((0.24, 0.145, 0.072), w, h, mottle=0.05, seed=41, cells=8).copy()
    K.draw_text(arr, "FAIRHOLLOW", w // 2, int(h * 0.34), 8, (0.055, 0.06, 0.05))
    K.draw_text(arr, "FOOTWEAR CO.", w // 2, int(h * 0.58), 6, (0.055, 0.06, 0.05))
    arr[int(h * 0.74):int(h * 0.92), int(w * 0.40):int(w * 0.60)] = (0.055, 0.06, 0.05)
    K.draw_text(arr, "UK 9", w // 2, int(h * 0.83), 5, (0.62, 0.55, 0.42))
    return K.np_image(name, arr)


# ============================================================ small parts =======

def hslat(name, width, height, mat, *, seed, parent=None, thick=0.016, board_h=0.092, gap=0.012):
    """Horizontal retail slatwall (one bmesh): boards span X, stacked up Z from
    0, faces toward -Y.  Grain runs along each board; every board samples its
    own slice of the oak sheet with a little depth jitter (same construction
    the Sheet-02 apparel wall proved out)."""
    rng = random.Random(seed)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    pitch = board_h + gap
    count = max(1, int((height + gap) // pitch))
    zbase = (height - (count * pitch - gap)) / 2
    for i in range(count):
        za = zbase + i * pitch
        zb = za + board_h
        jy = rng.uniform(-0.0012, 0.0012)
        u0 = rng.uniform(0.02, 0.90)
        v0 = rng.uniform(0.0, 0.28)
        du, dv = 0.075, 0.70
        corners = {}
        for (kx, x) in (("a", -width / 2), ("b", width / 2)):
            for (ky, y) in (("f", -thick / 2 + jy), ("r", thick / 2 + jy)):
                for (kz, z) in (("0", za), ("1", zb)):
                    corners[kx + ky + kz] = bm.verts.new((x, y, z))
        faces = (
            (("af0", "bf0", "bf1", "af1"), lambda x, z: (u0 + (z - za) / board_h * du, v0 + (x / width + 0.5) * dv)),
            (("br0", "ar0", "ar1", "br1"), lambda x, z: (u0 + (z - za) / board_h * du, v0 + (0.5 - x / width) * dv)),
            (("af1", "bf1", "br1", "ar1"), lambda x, z: (u0 + du, v0 + (x / width + 0.5) * dv)),
            (("ar0", "br0", "bf0", "af0"), lambda x, z: (u0, v0 + (x / width + 0.5) * dv)),
            (("bf0", "br0", "br1", "bf1"), lambda x, z: (u0 + (z - za) / board_h * du, v0 + dv)),
            (("ar0", "af0", "af1", "ar1"), lambda x, z: (u0 + (z - za) / board_h * du, v0)),
        )
        for keys, uvf in faces:
            f = bm.faces.new(tuple(corners[k] for k in keys))
            for loop in f.loops:
                co = loop.vert.co
                loop[uvl].uv = uvf(co.x, co.z)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    me.materials.append(mat)
    if parent is not None:
        L.parent_keep(o, parent)
    return o


def prism_x(name, profile_yz, width, mat, *, loc=(0, 0, 0), parent=None):
    """A prism extruded along X from a (y, z) profile polygon — side panels
    with sloped tops (rangefinder case cheeks, angled supports)."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    n = len(profile_yz)
    va = [bm.verts.new((-width / 2, y, z)) for (y, z) in profile_yz]
    vb = [bm.verts.new((width / 2, y, z)) for (y, z) in profile_yz]
    faces = [bm.faces.new(va[::-1]), bm.faces.new(vb)]
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new((va[i], va[j], vb[j], vb[i])))
    for f in faces:
        for loop in f.loops:
            co = loop.vert.co
            loop[uvl].uv = ((co.y + co.x) * 1.4 % 1.0, (co.z + 0.1) * 1.4 % 1.0)
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


def wall_frame(root, M, W, D, H, *, back_h=None, back_seed=60):
    """The shared wall-fixture chassis: black steel uprights + forward feet +
    top rail, charcoal back rails, and a finished horizontal-slat back (these
    units can stand mid-floor).  Returns the y of the slat plane's face."""
    BACKP = D / 2
    for sx, tag in ((-1, "L"), (1, "R")):
        x = sx * (W / 2 - 0.026)
        L.box(f"Frame_Upright_{tag}", (0.05, 0.05, H - 0.02), (x, BACKP - 0.045, (H - 0.02) / 2), M["black"], bevel=0.004, parent=root)
        L.box(f"Frame_Foot_{tag}", (0.05, D - 0.05, 0.04), (x, 0.0, 0.02), M["black"], bevel=0, parent=root)
    L.box("Frame_TopRail", (W - 0.055, 0.05, 0.045), (0, BACKP - 0.045, H - 0.042), M["black"], bevel=0, parent=root)
    bh = back_h if back_h is not None else H - 0.30
    L.box("Back_Rail_Top", (W - 0.10, 0.020, 0.06), (0, BACKP - 0.010, 0.14 + bh - 0.03), M["charcoal"], bevel=0, parent=root)
    L.box("Back_Rail_Bottom", (W - 0.10, 0.020, 0.06), (0, BACKP - 0.010, 0.17), M["charcoal"], bevel=0, parent=root)
    back = hslat("Back_Panel", W - 0.10, bh - 0.10, M["oak_slat"], seed=back_seed, thick=0.013, board_h=0.14, gap=0.004)
    back.location = (0, BACKP - 0.009, 0.20)
    back.rotation_euler = (0, 0, math.pi)
    L.parent_keep(back, root)
    return BACKP


def crest_header(root, M, W, D, H, *, depth=0.16):
    """Charcoal header carcass + the gold crest banner on its face."""
    BACKP = D / 2
    L.box("Header", (W, depth, 0.18), (0, BACKP - depth / 2, H - 0.09), M["charcoal"], bevel=0.005, parent=root)
    sign = K.uv_plane("Header_Sign", W - 0.06, 0.155, (0, BACKP - depth - 0.0015, H - 0.09),
                      K.m_tex("M_RetailHeader", crest_header_img(), rough=0.62))
    L.parent_keep(sign, root)
    return sign


def slat_hook(root, M, tag, x, z, backp, *, arm=0.105, double=False, kind="hook"):
    """A removable slatwall hook: plate on the slat, brass arm(s) tipped up.
    kind names the mesh family (Hook_Short/Hook_Long/Hook_Double)."""
    L.box(f"{kind}_Plate_{tag}", (0.036, 0.012, 0.065), (x, backp - 0.012 / 2 - 0.016, z), M["black"], bevel=0, parent=root)
    xs = (x - 0.014, x + 0.014) if double else (x,)
    for i, ax in enumerate(xs):
        a = L.cyl(f"{kind}_Arm_{tag}{'ab'[i] if double else ''}", 0.0052, arm, (ax, backp - 0.022 - arm / 2 * 0.985, z - 0.012 + arm / 2 * 0.105), M["brass"], verts=10, bevel=0, parent=root)
        a.rotation_euler = (math.radians(84), 0, 0)
        L.cyl(f"{kind}_Tip_{tag}{'ab'[i] if double else ''}", 0.0070, 0.010, (ax, backp - 0.024 - arm * 0.985, z - 0.012 + arm * 0.105), M["brass"], verts=10, bevel=0, parent=root)


def bracket_shelf(root, M, tag, w, depth, z, backp, *, mat_key="oak_slat", thick=0.024):
    """An oak shelf board on two black brackets, hung off the slatwall."""
    L.rounded_box(f"Shelf_{tag}", (w, depth, thick), (0, backp - 0.02 - depth / 2, z), M[mat_key],
                  corner=0.006, bevel=0.003, segments=3, uv=True, parent=root)
    for sx, side in ((-1, "L"), (1, "R")):
        L.box(f"Shelf_Bracket_{tag}{side}", (0.022, depth - 0.05, 0.018),
              (sx * (w / 2 - 0.06), backp - 0.02 - depth / 2 + 0.01, z - thick / 2 - 0.011), M["black"], bevel=0, parent=root)
    return z + thick / 2


# ============================================================ prop stock ========

def prop_bottle(root, tag, x, y, z, body_mat, band_img, cap_mat, *, r=0.031, h=0.205):
    """A drink bottle: body, wrapped label band, cap.  ~70 tris."""
    L.cyl(f"Prop_Bottle_{tag}", r, h, (x, y, z + h / 2), body_mat, verts=9, bevel=0, parent=root)
    L.cyl(f"Prop_BottleBand_{tag}", r + 0.0012, h * 0.34, (x, y, z + h * 0.42), band_img, verts=9, bevel=0, parent=root)
    L.cyl(f"Prop_BottleCap_{tag}", r * 0.42, 0.020, (x, y, z + h + 0.010), cap_mat, verts=8, bevel=0, parent=root)


def prop_chip(root, tag, x, y, z, bag_mat, label_mat, *, w=0.135, d=0.045, h=0.175, ry=0.0):
    """A chip bag: pillow box + crimped top + front label decal.  ~30 tris.
    ry is a small facing jitter (each part turns about its own centre)."""
    g = L.box(f"Prop_Chip_{tag}", (w, d, h), (x, y, z + h / 2), bag_mat, bevel=0, parent=root)
    crimp = L.box(f"Prop_ChipCrimp_{tag}", (w * 0.94, d * 0.35, 0.016), (x, y, z + h + 0.006), bag_mat, bevel=0, parent=root)
    lab = K.uv_plane(f"Prop_ChipLabel_{tag}", w * 0.82, h * 0.52, (x, y - d / 2 - 0.0015, z + h * 0.52), label_mat)
    L.parent_keep(lab, root)
    for o in (g, crimp, lab):
        o.rotation_euler = (0, 0, ry)


def prop_bar_tray(root, tag, x, y, z, tray_mat, bar_mat, label_mat, *, w=0.17, d=0.13, h=0.075):
    """An open counter tray of energy bars."""
    L.box(f"Prop_BarTray_{tag}", (w, d, 0.012), (x, y, z + 0.006), tray_mat, bevel=0, parent=root)
    L.box(f"Prop_BarTrayBack_{tag}", (w, 0.010, h), (x, y + d / 2 - 0.005, z + h / 2), tray_mat, bevel=0, parent=root)
    for sx in (-1, 1):
        L.box(f"Prop_BarTraySide_{tag}{'LR'[sx > 0]}", (0.010, d, h * 0.6), (x + sx * (w / 2 - 0.005), y, z + h * 0.3), tray_mat, bevel=0, parent=root)
    for i in range(3):
        b = L.box(f"Prop_Bar_{tag}{i}", (w - 0.03, 0.016, h - 0.018), (x, y - d / 2 + 0.022 + i * 0.022, z + (h - 0.018) / 2 + 0.008), bar_mat, bevel=0, parent=root)
        b.rotation_euler = (math.radians(-8), 0, 0)
    lab = K.uv_plane(f"Prop_BarLabel_{tag}", w * 0.8, 0.05, (x, y - d / 2 - 0.0015, z + 0.038), label_mat)
    L.parent_keep(lab, root)


def prop_shoebox(root, M, tag, x, y, z, art_mat, *, w=0.31, d=0.19, h=0.115, ry=0.0):
    """A kraft shoe box with a lid and printed side."""
    b = L.box(f"Prop_ShoeBox_{tag}", (w, d, h - 0.02), (x, y, z + (h - 0.02) / 2), M["kraft"], bevel=0, parent=root)
    lid = L.box(f"Prop_ShoeBoxLid_{tag}", (w + 0.008, d + 0.008, 0.024), (x, y, z + h - 0.012), M["kraft"], bevel=0, parent=root)
    lab = K.uv_plane(f"Prop_ShoeBoxLabel_{tag}", w * 0.8, h * 0.55, (x, y - d / 2 - 0.0015, z + h * 0.42), art_mat)
    for o in (b, lid, lab):
        o.rotation_euler = (0, 0, ry)
    L.parent_keep(lab, root)
    return h


# ============================================================ the builders ======

def build_hat_wall(M):
    """Sheet-03 #22: the hat wall — slatwall with wood backing, twelve
    removable brass pegs in four rows of three.  1.00 x 0.30 x 2.20.

    Fit: cap_pro is 0.271 wide x 0.138 tall x 0.175 deep; pegs at 0.30 x-pitch
    and 0.40 z-pitch give every cap 3 cm of air side-to-side and a full hat of
    headroom, and the 0.115 arm stands the crown clear of the slats."""
    W, D, H = 1.00, 0.30, 2.20
    root = K.asset_root("hat_wall", (W, D, H))
    BACKP = wall_frame(root, M, W, D, H, back_h=H - 0.32, back_seed=62)

    slats = hslat("Slatwall", W - 0.10, 1.70, M["oak_slat"], seed=21)
    slats.location = (0, BACKP - 0.055, 0.30)
    L.parent_keep(slats, root)
    crest_header(root, M, W, D, H)
    L.box("Plinth", (W - 0.06, D - 0.06, 0.11), (0, 0, 0.055), M["counter_black"], bevel=0.004, parent=root)

    rows = (0.62, 1.02, 1.42, 1.82)
    cols = (-0.30, 0.0, 0.30)
    n = 0
    for z in rows:
        for x in cols:
            n += 1
            tag = f"{n:02d}"
            L.box(f"Peg_Plate_{tag}", (0.034, 0.011, 0.052), (x, BACKP - 0.066, z), M["black"], bevel=0, parent=root)
            arm = L.cyl(f"Peg_Arm_{tag}", 0.0075, 0.115, (x, BACKP - 0.072 - 0.056, z + 0.012), M["brass"], verts=9, bevel=0, parent=root)
            arm.rotation_euler = (math.radians(78), 0, 0)
            K.empty(f"HAT_PEG_SLOT_{tag}", (x, BACKP - 0.072 - 0.112, z + 0.030), parent=root, size=0.04,
                    props={"socket": "hat_peg", "order": n})

    K.collision_box("COL_HatWall", (W, D, H), (0, 0, H / 2), M, root)
    return root


def build_accessory_slatwall(M):
    """Sheet-03 #23: the accessory slatwall — slat panel, three bracket
    shelves, and the three hook families as separate removable meshes
    (short, long, double).  1.00 x 0.30 x 2.00.

    Fit: the 0.26 shelves carry the 0.12-cube smalls cartons four across at
    0.115 pitch, four dia-0.10 towel rolls, eight dia-0.064 sock rolls, or a
    two-rank fan of eight 0.137-wide gloves; the hooks hold headcover /
    carded dressing above the top shelf."""
    W, D, H = 1.00, 0.30, 2.00
    root = K.asset_root("accessory_slatwall", (W, D, H))
    BACKP = wall_frame(root, M, W, D, H, back_h=H - 0.32, back_seed=63)

    slats = hslat("Slatwall", W - 0.10, 1.54, M["oak_slat"], seed=23)
    slats.location = (0, BACKP - 0.055, 0.26)
    L.parent_keep(slats, root)
    crest_header(root, M, W, D, H)
    L.box("Plinth", (W - 0.06, D - 0.06, 0.10), (0, 0, 0.05), M["counter_black"], bevel=0.004, parent=root)

    for i, z in enumerate((0.55, 0.95, 1.35)):
        bracket_shelf(root, M, f"{i + 1:02d}", W - 0.08, 0.26, z, BACKP)
        K.empty(f"ACC_SHELF_SLOT_{i + 1:02d}", (0, BACKP - 0.06, z), parent=root, size=0.04,
                props={"socket": "shelf_mount", "order": i + 1})

    hooks = (
        ("Hook_Short", "01", -0.30, 1.54, 0.075, False),
        ("Hook_Short", "02", 0.30, 1.54, 0.075, False),
        ("Hook_Long", "01", 0.0, 1.54, 0.130, False),
        ("Hook_Long", "02", 0.0, 1.72, 0.130, False),
        ("Hook_Double", "01", -0.30, 1.72, 0.105, True),
        ("Hook_Double", "02", 0.30, 1.72, 0.105, True),
    )
    for i, (kind, tag, x, z, arm, dbl) in enumerate(hooks):
        slat_hook(root, M, tag, x, z, BACKP, arm=arm, double=dbl, kind=kind)
        K.empty(f"ACC_HOOK_SLOT_{i + 1:02d}", (x, BACKP - 0.03 - arm, z - 0.012), parent=root, size=0.035,
                props={"socket": "hook", "order": i + 1})

    K.collision_box("COL_AccessorySlatwall", (W, D, H), (0, 0, H / 2), M, root)
    return root


def build_ball_shelf(M):
    """Sheet-03 #28: the golf ball shelf — walnut case, three boards on
    brass pins with drilled pin rails (the 'adjustable shelves'), gallery
    lips.  1.00 x 0.35 x 1.20.

    Fit: a dozen-box is 0.165 x 0.120 x 0.125; five per board at 0.175 pitch
    leaves 10 mm between boxes, and the 0.34 board gaps give 0.19 of air over
    every row."""
    W, D, H = 1.00, 0.35, 1.20
    root = K.asset_root("ball_shelf", (W, D, H))
    BACKP = D / 2

    for sx, tag in ((-1, "L"), (1, "R")):
        L.box(f"Side_{tag}", (0.05, D - 0.02, H - 0.05), (sx * (W / 2 - 0.025), 0, (H - 0.05) / 2), M["walnut"], bevel=0.004, parent=root)
        L.box(f"PinRail_{tag}", (0.012, 0.02, 0.86), (sx * (W / 2 - 0.055), -0.05, 0.62), M["charcoal"], bevel=0, parent=root)
    L.box("Back_Panel", (W - 0.08, 0.022, H - 0.14), (0, BACKP - 0.035, (H - 0.14) / 2 + 0.02), M["walnut"], bevel=0, parent=root)
    L.rounded_box("Top", (W + 0.02, D + 0.01, 0.05), (0, 0, H - 0.025), M["walnut"], corner=0.008, bevel=0.004, segments=3, uv=True, parent=root)
    L.box("Plinth", (W - 0.05, D - 0.06, 0.10), (0, 0, 0.05), M["counter_black"], bevel=0.004, parent=root)
    badge = K.uv_plane("Crest_Badge", 0.09, 0.09, (0, -D / 2 - 0.0012, H - 0.025), K.m_tex("M_RetailBadge", crest_badge_img(), rough=0.62))
    L.parent_keep(badge, root)

    boards = (0.30, 0.64, 0.98)
    n = 0
    for bi, z in enumerate(boards):
        L.rounded_box(f"Board_{bi + 1:02d}", (W - 0.10, 0.30, 0.034), (0, -0.01, z), M["walnut"], corner=0.005, bevel=0.003, segments=3, uv=True, parent=root)
        L.box(f"Board_Lip_{bi + 1:02d}", (W - 0.10, 0.010, 0.020), (0, -0.01 - 0.155, z + 0.004), M["brass"], bevel=0, parent=root)
        for px in (-1, 1):
            L.cyl(f"Board_Pin_{bi + 1:02d}{'LR'[px > 0]}", 0.006, 0.02, (px * (W / 2 - 0.055), -0.05, z - 0.023), M["brass"], verts=6, bevel=0, parent=root, rot=(0, math.pi / 2, 0))
        top = z + 0.017
        for c in range(5):
            n += 1
            K.empty(f"BALL_SLOT_{n:02d}", ((c - 2) * 0.175, -0.09, top + 0.0005), parent=root, size=0.04,
                    props={"socket": "ball_box", "order": n})

    K.collision_box("COL_BallShelf", (W, D, H), (0, 0, H / 2), M, root)
    return root


def build_shoe_wall(M):
    """Sheet-03 #27: the shoe wall — slat back, three angled display boards
    with brass toe lips, and a bottom shelf stacked with branded shoe boxes.
    1.20 x 0.35 x 2.00.

    Fit: shoe_pro is 0.141 x 0.167 x 0.301; a pair is two shoes toed apart
    (0.30 wide).  Two pair positions per board at +-0.28 leave 0.28 between
    pairs; the boards are 0.32 deep so a 0.301 shoe sits fully on the wood
    at the display angle (-0.18 rad, the angle the game already poses)."""
    W, D, H = 1.20, 0.35, 2.00
    root = K.asset_root("shoe_wall", (W, D, H))
    BACKP = wall_frame(root, M, W, D, H, back_h=H - 0.32, back_seed=64)

    slats = hslat("Slatwall", W - 0.10, 1.56, M["oak_slat"], seed=27)
    slats.location = (0, BACKP - 0.055, 0.24)
    L.parent_keep(slats, root)
    crest_header(root, M, W, D, H)
    L.box("Plinth", (W - 0.06, D - 0.06, 0.10), (0, 0, 0.05), M["counter_black"], bevel=0.004, parent=root)

    n = 0
    for bi, z in enumerate((0.62, 1.02, 1.42)):
        b = L.rounded_box(f"Display_Board_{bi + 1:02d}", (W - 0.10, 0.32, 0.026), (0, BACKP - 0.045 - 0.16, z), M["walnut"],
                          corner=0.005, bevel=0.003, segments=3, uv=True, parent=root)
        b.rotation_euler = (-0.18, 0, 0)
        lip = L.box(f"Board_Lip_{bi + 1:02d}", (W - 0.10, 0.010, 0.022), (0, BACKP - 0.045 - 0.315, z - 0.032), M["brass"], bevel=0, parent=root)
        lip.rotation_euler = (-0.18, 0, 0)
        for sx in (-1, 1):
            L.box(f"Board_Cleat_{bi + 1:02d}{'LR'[sx > 0]}", (0.020, 0.024, 0.05), (sx * (W / 2 - 0.10), BACKP - 0.062, z - 0.012), M["black"], bevel=0, parent=root)
        for sx in (-1, 1):
            n += 1
            K.empty(f"SHOE_SLOT_{n:02d}", (sx * 0.28, BACKP - 0.045 - 0.16, z + 0.014), parent=root, size=0.04,
                    props={"socket": "shoe_pair", "order": n})

    L.rounded_box("Box_Shelf", (W - 0.08, 0.32, 0.028), (0, 0.0, 0.24), M["walnut"], corner=0.005, bevel=0.003, segments=3, uv=True, parent=root)
    art = K.m_tex("M_ShoeBoxArt", shoebox_img(), rough=0.75)
    xs = (-0.40, -0.065, 0.28)
    for i, x in enumerate(xs):
        h = prop_shoebox(root, M, f"{i * 2 + 1:02d}", x, 0.0, 0.256, art, ry=(i - 1) * 0.05)
        prop_shoebox(root, M, f"{i * 2 + 2:02d}", x, 0.0, 0.256 + h, art, ry=(i - 1) * 0.05 + 0.03)
        K.empty(f"SHOEBOX_SLOT_{i + 1:02d}", (x, 0.0, 0.256), parent=root, size=0.04,
                props={"socket": "shoe_box", "order": i + 1})

    K.collision_box("COL_ShoeWall", (W, D, H), (0, 0, H / 2), M, root)
    return root


def build_apparel_wall_display(M):
    """Sheet-03 #21: the apparel wall display — the face-out companion to the
    Sheet-02 apparel wall: two rows of three face-out arms over a folded base
    shelf.  1.20 x 0.45 x 2.20.  (Sheet-02's rod module is untouched; this is
    the display configuration the sheet draws.)

    Fit: a hanging polo is 0.523 wide with a 0.678 drop, a jacket 0.575/0.785.
    Arms at 0.40 x-pitch face-out overlap like a real waterfall wall; the low
    row at 1.18 hangs a polo hem to 0.50, which clears the 0.47 top of a
    three-high folded stack on the 0.28 base shelf."""
    W, D, H = 1.20, 0.45, 2.20
    root = K.asset_root("apparel_wall_display", (W, D, H))
    BACKP = wall_frame(root, M, W, D, H, back_h=H - 0.32, back_seed=65)

    slats = hslat("Slatwall", W - 0.10, 1.66, M["oak_slat"], seed=29)
    slats.location = (0, BACKP - 0.105, 0.40)
    L.parent_keep(slats, root)
    crest_header(root, M, W, D, H)

    # folded base: black plinth + oak terrace shelf
    L.box("Base_Body", (W - 0.06, 0.42, 0.20), (0, 0.01, 0.14), M["charcoal"], bevel=0.005, parent=root)
    L.rounded_box("Base_Shelf", (W - 0.02, 0.44, 0.032), (0, 0.0, 0.256), M["oak_slat"], corner=0.008, bevel=0.004, segments=3, uv=True, parent=root)
    L.box("Plinth", (W - 0.10, 0.38, 0.075), (0, 0.01, 0.0375), M["counter_black"], bevel=0.004, parent=root)

    n = 0
    for z in (1.98, 1.18):
        for x in (-0.40, 0.0, 0.40):
            n += 1
            tag = f"{n:02d}"
            L.box(f"Faceout_Plate_{tag}", (0.036, 0.012, 0.065), (x, BACKP - 0.111, z - 0.02), M["black"], bevel=0, parent=root)
            L.box(f"Faceout_Arm_{tag}", (0.018, 0.30, 0.018), (x, BACKP - 0.117 - 0.15, z), M["black"], bevel=0, parent=root)
            L.box(f"Faceout_Stop_{tag}", (0.018, 0.018, 0.038), (x, BACKP - 0.117 - 0.30, z + 0.019), M["black"], bevel=0, parent=root)
            K.empty(f"DISPLAY_ARM_SLOT_{tag}", (x, BACKP - 0.117 - 0.27, z + 0.02), parent=root, size=0.04,
                    props={"socket": "faceout", "order": n})
    for i, x in enumerate((-0.38, 0.0, 0.38)):
        K.empty(f"DISPLAY_BASE_SLOT_{i + 1:02d}", (x, -0.02, 0.272), parent=root, size=0.04,
                props={"socket": "folded", "order": i + 1})

    K.collision_box("COL_ApparelWallDisplay", (W, D, H), (0, 0, H / 2), M, root)
    return root


def build_club_rack(M):
    """Sheet-03 #24: the golf club rack — a floor-standing double-rank rack:
    walnut base with two felt-lined grip troughs, black steel end frames, and
    two notched walnut head rails (nine shaft slots each side).
    1.20 x 0.40 x 1.10.

    Fit: the game builds a club as shaft+grip+head with the head at the slot
    point, so the rack is sized from the heads: slots at 0.1125 pitch clear
    the 0.111-wide driver head; the notch gaps are 0.025 for the 0.017 shaft;
    rail top at 1.01 seats a full-length driver's head (pivot 0.055 + 1.05
    shaft = 1.105) right on the comb, heads showing above the frame exactly
    as the sheet draws."""
    W, D, H = 1.20, 0.40, 1.10
    root = K.asset_root("club_rack", (W, D, H))

    L.rounded_box("Base", (W, D, 0.075), (0, 0, 0.0875), M["walnut"], corner=0.010, bevel=0.004, segments=3, uv=True, parent=root)
    L.box("Base_Kick", (W - 0.08, D - 0.08, 0.05), (0, 0, 0.025), M["counter_black"], bevel=0, parent=root)
    felt = K.m_flat("M_TroughFelt", (0.030, 0.075, 0.045), rough=0.92)
    for sy, tag in ((1, "F"), (-1, "R")):
        y = -sy * 0.075          # front trough toward -Y
        L.box(f"Trough_Floor_{tag}", (W - 0.14, 0.10, 0.012), (0, y, 0.131), M["walnut"], bevel=0, parent=root)
        fp = K.uv_plane(f"Trough_Felt_{tag}", W - 0.15, 0.085, (0, y, 0.1375), felt)
        fp.rotation_euler = (math.radians(-90), 0, 0)
        L.parent_keep(fp, root)
        L.box(f"Trough_Lip_{tag}", (W - 0.14, 0.014, 0.030), (0, y - sy * 0.055, 0.146), M["walnut"], bevel=0, parent=root)
    L.box("Trough_Spine", (W - 0.14, 0.020, 0.030), (0, 0, 0.146), M["walnut"], bevel=0, parent=root)

    # end frames: an A-pair of posts a side, tops drawn in under a shared cap
    for sx, tag in ((-1, "L"), (1, "R")):
        x = sx * (W / 2 - 0.035)
        for sy, sub in ((-1, "a"), (1, "b")):
            bar = L.box(f"End_Bar_{tag}{sub}", (0.032, 0.050, 0.905), (x, sy * 0.075, 0.5775), M["black"], bevel=0, parent=root)
            bar.rotation_euler = (sy * -0.045, 0, 0)
        L.box(f"End_Cap_{tag}", (0.036, 0.21, 0.032), (x, 0, 1.046), M["black"], bevel=0.003, parent=root)
    L.box("Cross_Brace", (W - 0.10, 0.030, 0.030), (0, 0, 0.52), M["black"], bevel=0, parent=root)
    badge = K.uv_plane("Crest_Badge", 0.075, 0.075, (0, -D / 2 - 0.0012, 0.0875), K.m_tex("M_RetailBadge", crest_badge_img(), rough=0.62))
    L.parent_keep(badge, root)

    # the two notched head rails (combs), one per rank
    SLOT_XS = [(k - 4) * 0.1125 for k in range(9)]
    for sy, tag in ((-1, "F"), (1, "R")):
        y = sy * 0.075
        L.box(f"Head_Rail_{tag}", (W - 0.06, 0.050, 0.026), (0, y, 0.955), M["walnut"], bevel=0.003, parent=root)
        for j in range(10):
            left = -(W - 0.06) / 2 if j == 0 else SLOT_XS[j - 1] + 0.0125
            right = (W - 0.06) / 2 if j == 9 else SLOT_XS[j] - 0.0125
            L.box(f"Head_Tooth_{tag}{j:02d}", (right - left, 0.050, 0.042), ((left + right) / 2, y, 0.989), M["walnut"], bevel=0, parent=root)
        for k, x in enumerate(SLOT_XS):
            K.empty(f"CLUB_SLOT_{tag}{k + 1:02d}", (x, y, 0.99), parent=root, size=0.035,
                    props={"socket": "club_shaft", "order": k + 1, "rank": tag})

    K.collision_box("COL_ClubRack", (W, D, H), (0, 0, H / 2), M, root)
    return root


def build_putter_rack(M):
    """Sheet-03 #25: the putter rack — walnut base with six felt-lined head
    grooves between dividers, walnut cheeks, black upper grip rail with brass
    trim.  1.00 x 0.35 x 1.00.

    Fit: head_putter is 0.115 heel-to-toe and 0.052 deep, hanging 0.074 below
    its hosel pivot; grooves at 0.15 pitch with 0.025 dividers give each head
    10 mm of air, and an 0.80 shaft stands the grip at 0.96 against the 0.83
    rail (the rail catches the rubber, as the sheet draws)."""
    W, D, H = 1.00, 0.35, 1.00
    root = K.asset_root("putter_rack", (W, D, H))

    L.rounded_box("Base", (W, D, 0.07), (0, 0, 0.075), M["walnut"], corner=0.010, bevel=0.004, segments=3, uv=True, parent=root)
    L.box("Base_Kick", (W - 0.07, D - 0.07, 0.04), (0, 0, 0.02), M["counter_black"], bevel=0, parent=root)
    felt = K.m_flat("M_PutterFelt", (0.030, 0.075, 0.045), rough=0.92)
    fp = K.uv_plane("Base_Felt", W - 0.10, D - 0.11, (0, -0.005, 0.1105), felt)
    fp.rotation_euler = (math.radians(-90), 0, 0)
    L.parent_keep(fp, root)
    L.box("Brass_Trim", (W - 0.02, 0.012, 0.014), (0, -D / 2 + 0.006, 0.117), M["brass"], bevel=0, parent=root)

    SLOT_XS = [(k - 2.5) * 0.15 for k in range(6)]
    for j in range(5):                      # five interior dividers; the cheeks close the end grooves
        L.box(f"Groove_Divider_{j + 1:02d}", (0.025, 0.24, 0.055), ((j - 2) * 0.15, -0.005, 0.138), M["walnut"], bevel=0, parent=root)
    for sx, tag in ((-1, "L"), (1, "R")):
        L.box(f"Cheek_{tag}", (0.05, D - 0.04, 0.93), (sx * (W / 2 - 0.025), 0.02, 0.535), M["walnut"], bevel=0.004, parent=root)
    rail = L.box("Grip_Rail", (W - 0.10, 0.035, 0.055), (0, -0.02, 0.83), M["black"], bevel=0.003, parent=root)
    L.box("Grip_Rail_Pad", (W - 0.11, 0.010, 0.045), (0, -0.0405, 0.83), M["rubber"], bevel=0, parent=root)
    badge = K.uv_plane("Crest_Badge", 0.07, 0.07, (0, -D / 2 - 0.0012, 0.075), K.m_tex("M_RetailBadge", crest_badge_img(), rough=0.62))
    L.parent_keep(badge, root)

    for k, x in enumerate(SLOT_XS):
        K.empty(f"PUTTER_SLOT_{k + 1:02d}", (x, -0.045, 0.185), parent=root, size=0.035,
                props={"socket": "putter_head", "order": k + 1})

    K.collision_box("COL_PutterRack", (W, D, H), (0, 0, H / 2), M, root)
    return root


def build_bag_display(M):
    """Sheet-03 #26: the golf bag display — a walnut floor platform on a black
    steel frame with a rear lean rail.  1.60 x 0.44 platform, rail at 1.05.

    Fit: the display bag (with its club fan) is 0.343 wide and spans z
    -0.160..+0.199 about its base centre; four positions at 0.38 pitch, each
    at depth -0.01 with lean -0.075, put every footprint on the deck and rest
    the bag's back on the rail face (rail centre y -0.245, r 0.016)."""
    W, D, H = 1.60, 0.44, 1.10
    root = K.asset_root("bag_display", (W, D, H))

    L.rounded_box("Deck", (W, D, 0.055), (0, 0, 0.0925), M["walnut"], corner=0.012, bevel=0.004, segments=3, uv=True, parent=root)
    L.box("Deck_Skirt", (W - 0.05, D - 0.05, 0.068), (0, 0, 0.032), M["counter_black"], bevel=0, parent=root)
    for i in (-1, 0, 1):
        L.box(f"Deck_Seam_{i + 2:02d}", (0.006, D - 0.02, 0.003), (i * 0.40, 0, 0.121), M["charcoal"], bevel=0, parent=root)
    badge = K.uv_plane("Crest_Badge", 0.08, 0.08, (0, -D / 2 - 0.0012, 0.075), K.m_tex("M_RetailBadge", crest_badge_img(), rough=0.62))
    L.parent_keep(badge, root)

    # rear lean rail on two posts rising just behind the deck
    for sx, tag in ((-1, "L"), (1, "R")):
        x = sx * (W / 2 - 0.06)
        L.box(f"Rail_Post_{tag}", (0.038, 0.038, 1.06), (x, 0.245, 0.53), M["black"], bevel=0, parent=root)
        L.box(f"Rail_Foot_{tag}", (0.07, 0.07, 0.018), (x, 0.245, 0.009), M["black"], bevel=0, parent=root)
    rail = L.cyl("Lean_Rail", 0.016, W - 0.08, (0, 0.245, 1.05), M["black"], verts=12, bevel=0, parent=root)
    rail.rotation_euler = (0, math.radians(90), 0)

    for i, x in enumerate((-0.57, -0.19, 0.19, 0.57)):
        K.empty(f"BAG_SLOT_{i + 1:02d}", (x, -0.01, 0.12), parent=root, size=0.05,
                props={"socket": "bag", "order": i + 1})

    K.collision_box("COL_BagDisplay", (W, D, 0.14), (0, 0, 0.07), M, root)
    return root


def build_snack_shelf(M):
    """Sheet-03 #29: the snack & drink shelf — black steel frame, four walnut
    shelves at mixed heights, stocked with original fictional goods (props):
    spring water, sport drinks, crisps, bars, candy.  1.00 x 0.45 x 1.60."""
    W, D, H = 1.00, 0.45, 1.60
    root = K.asset_root("snack_shelf", (W, D, H))

    for sx in (-1, 1):
        for sy in (-1, 1):
            L.box(f"Frame_Post_{'LR'[sx > 0]}{'FB'[sy > 0]}", (0.042, 0.042, H - 0.02),
                  (sx * (W / 2 - 0.025), sy * (D / 2 - 0.025), (H - 0.02) / 2), M["black"], bevel=0, parent=root)
    L.box("Frame_Crown", (W, 0.06, 0.05), (0, D / 2 - 0.03, H - 0.025), M["black"], bevel=0.003, parent=root)
    L.box("Back_Panel", (W - 0.08, 0.018, H - 0.24), (0, D / 2 - 0.035, (H - 0.24) / 2 + 0.06), M["charcoal"], bevel=0, parent=root)
    L.box("Kick", (W - 0.06, D - 0.06, 0.05), (0, 0, 0.025), M["counter_black"], bevel=0, parent=root)
    badge = K.uv_plane("Crest_Badge", 0.08, 0.08, (0, -D / 2 - 0.024, H - 0.025), K.m_tex("M_RetailBadge", crest_badge_img(), rough=0.62))
    L.parent_keep(badge, root)

    shelf_zs = (0.16, 0.58, 0.98, 1.30)
    for i, z in enumerate(shelf_zs):
        L.rounded_box(f"Shelf_{i + 1:02d}", (W - 0.05, D - 0.06, 0.028), (0, 0, z), M["walnut"], corner=0.006, bevel=0.003, segments=3, uv=True, parent=root)
        L.box(f"Shelf_Rail_{i + 1:02d}", (W - 0.05, 0.008, 0.018), (0, -D / 2 + 0.035, z + 0.022), M["black"], bevel=0, parent=root)
        K.empty(f"SNACK_SHELF_SLOT_{i + 1:02d}", (0, 0, z + 0.014), parent=root, size=0.04,
                props={"socket": "shelf_mount", "order": i + 1})

    # --- prop stock (all fictional) ------------------------------------------
    ink = (0.055, 0.06, 0.05)
    cream = (0.72, 0.68, 0.58)
    m_sport = K.m_flat("M_SportBottle", (0.10, 0.28, 0.16), rough=0.35)
    m_water = K.m_flat("M_WaterBottle", (0.55, 0.62, 0.66), rough=0.15)
    m_cap = K.m_flat("M_BottleCap", (0.045, 0.05, 0.055), rough=0.5)
    band_sport = K.m_tex("M_SportLabel", label_img("SportLabel", ["BIRDIE", "FUEL"], (0.05, 0.16, 0.10), cream, band=GOLD, repeat=True), rough=0.5)
    band_water = K.m_tex("M_WaterLabel", label_img("WaterLabel", ["GREENSIDE", "SPRING"], (0.60, 0.64, 0.66), ink, band=(0.10, 0.30, 0.42), repeat=True), rough=0.4)
    top1 = shelf_zs[0] + 0.014
    top2 = shelf_zs[1] + 0.014
    for i in range(7):
        x = (i - 3) * 0.13
        prop_bottle(root, f"S{i + 1:02d}", x, -0.055, top1, m_sport, band_sport, m_cap, r=0.033, h=0.215)
        prop_bottle(root, f"W{i + 1:02d}", x, -0.055, top2, m_water, band_water, m_cap, r=0.029, h=0.195)

    m_bag1 = K.m_flat("M_ChipBag1", (0.32, 0.10, 0.05), rough=0.45)
    m_bag2 = K.m_flat("M_ChipBag2", (0.07, 0.16, 0.09), rough=0.45)
    lab_chip1 = K.m_tex("M_ChipLabel1", label_img("ChipLabel1", ["FAIRWAY", "CRISPS"], (0.36, 0.12, 0.06), cream), rough=0.5)
    lab_chip2 = K.m_tex("M_ChipLabel2", label_img("ChipLabel2", ["FAIRWAY", "CRISPS"], (0.08, 0.18, 0.10), cream), rough=0.5)
    top3 = shelf_zs[2] + 0.014
    for i in range(5):
        x = (i - 2) * 0.175
        prop_chip(root, f"{i + 1:02d}", x, -0.03, top3, m_bag1 if i % 2 else m_bag2,
                  lab_chip1 if i % 2 else lab_chip2, ry=(i % 3 - 1) * 0.06)

    m_tray = K.m_flat("M_BarTray", (0.16, 0.09, 0.045), rough=0.7)
    m_bar = K.m_flat("M_ClubBar", (0.42, 0.30, 0.12), rough=0.55)
    lab_bar = K.m_tex("M_BarLabel", label_img("BarLabel", ["CLUB BAR"], (0.30, 0.20, 0.08), ink), rough=0.5)
    top4 = shelf_zs[3] + 0.014
    prop_bar_tray(root, "01", -0.28, -0.02, top4, m_tray, m_bar, lab_bar)
    prop_bar_tray(root, "02", -0.06, -0.02, top4, m_tray, m_bar, lab_bar)
    m_candy = K.m_flat("M_CandyBox", (0.34, 0.26, 0.08), rough=0.5)
    lab_candy = K.m_tex("M_CandyLabel", label_img("CandyLabel", ["DROPS"], (0.40, 0.30, 0.10), ink, w=128, h=64), rough=0.5)
    for i in range(3):
        x = 0.18 + i * 0.10
        L.box(f"Prop_Candy_{i + 1:02d}", (0.085, 0.06, 0.10), (x, -0.03, top4 + 0.05), m_candy, bevel=0, parent=root)
        lb = K.uv_plane(f"Prop_CandyLabel_{i + 1:02d}", 0.07, 0.05, (x, -0.03 - 0.031, top4 + 0.052), lab_candy)
        L.parent_keep(lb, root)

    K.collision_box("COL_SnackShelf", (W, D, H), (0, 0, H / 2), M, root)
    return root


def build_rangefinder_display(M):
    """Sheet-03 #30: the rangefinder display — a countertop optics case:
    charcoal body, two felt-topped stepped tiers of three, acrylic front
    panel, prop retail boxes.  0.60 x 0.60 x 0.35.

    Fit: a rangefinder is 0.048 x 0.083 x 0.121; tier positions at 0.18
    x-pitch and 0.10 tier rise present six units at eye level when the case
    stands on the 0.98 back counter."""
    W, D, H = 0.60, 0.60, 0.35
    root = K.asset_root("rangefinder_display", (W, D, H))

    L.rounded_box("Case_Base", (W, D, 0.06), (0, 0, 0.03), M["charcoal"], corner=0.010, bevel=0.004, segments=3, uv=True, parent=root)
    felt = K.m_flat("M_CaseFelt", (0.048, 0.115, 0.068), rough=0.92)
    # (top z, y centre, depth): a low walnut step in front, a tall one behind —
    # walnut against the charcoal shell so the terracing actually reads
    tiers = ((0.11, -0.15, 0.24), (0.22, 0.115, 0.27))
    for i, (zt, yc, dd) in enumerate(tiers):
        L.box(f"Tier_{i + 1:02d}", (W - 0.06, dd, zt - 0.06), (0, yc, (zt + 0.06) / 2), M["walnut"], bevel=0.003, parent=root)
        fp = K.uv_plane(f"Tier_Felt_{i + 1:02d}", W - 0.08, dd - 0.02, (0, yc, zt + 0.0012), felt)
        fp.rotation_euler = (math.radians(-90), 0, 0)
        L.parent_keep(fp, root)
    # back wall + crest
    L.box("Case_Back", (W - 0.02, 0.025, H - 0.06), (0, D / 2 - 0.0125, (H - 0.06) / 2 + 0.06), M["charcoal"], bevel=0.003, parent=root)
    badge = K.uv_plane("Crest_Badge", 0.10, 0.10, (0, D / 2 - 0.026, H - 0.09), K.m_tex("M_RetailBadge", crest_badge_img(), rough=0.62))
    L.parent_keep(badge, root)
    # sloped side cheeks: low at the front rail, full height at the back
    prof = [(-D / 2 + 0.01, 0.06), (D / 2 - 0.01, 0.06), (D / 2 - 0.01, H), (-D / 2 + 0.01, 0.20)]
    for sx, tag in ((-1, "L"), (1, "R")):
        prism_x(f"Case_Cheek_{tag}", prof, 0.022, M["charcoal"], loc=(sx * (W / 2 - 0.011), 0, 0), parent=root)
    # acrylic front: a steep short pane over the LOW tier only — the rear tier
    # presents open-air above it (the sheet's angled-top look)
    acr = K.m_flat("M_Acrylic", (0.80, 0.85, 0.88), rough=0.06, alpha=0.16, ds=True)
    glass = K.uv_plane("Acrylic_Front", W - 0.06, 0.24, (0, 0, 0), acr)
    glass.rotation_euler = (math.radians(-62), 0, 0)
    glass.location = (0, -0.205, 0.165)
    L.parent_keep(glass, root)
    L.box("Acrylic_Rail", (W - 0.04, 0.020, 0.014), (0, -D / 2 + 0.02, 0.067), M["brass"], bevel=0, parent=root)

    boxart = K.m_tex("M_OpticBox", label_img("OpticBox", ["LONGVIEW", "OPTICS"], (0.05, 0.07, 0.09), (0.62, 0.55, 0.42), w=256, h=256), rough=0.6)
    for i, x in enumerate((-0.245, 0.245)):
        L.box(f"Prop_OpticBox_{i + 1:02d}", (0.058, 0.09, 0.115), (x, 0.115, 0.22 + 0.0575), M["charcoal"], bevel=0, parent=root)
        lb = K.uv_plane(f"Prop_OpticBoxLabel_{i + 1:02d}", 0.048, 0.095, (x, 0.115 - 0.046, 0.22 + 0.058), boxart)
        L.parent_keep(lb, root)

    n = 0
    for (zt, yc, dd) in tiers:
        for x in (-0.18, 0.0, 0.18):
            n += 1
            K.empty(f"RF_SLOT_{n:02d}", (x, yc + 0.02, zt + 0.001), parent=root, size=0.03,
                    props={"socket": "rangefinder", "order": n})

    K.collision_box("COL_RangefinderDisplay", (W, D, H), (0, 0, H / 2), M, root)
    return root


# ============================================================ registry ==========

BUILDERS = {
    "hat_wall": build_hat_wall,
    "accessory_slatwall": build_accessory_slatwall,
    "ball_shelf": build_ball_shelf,
    "shoe_wall": build_shoe_wall,
    "apparel_wall_display": build_apparel_wall_display,
    "club_rack": build_club_rack,
    "putter_rack": build_putter_rack,
    "bag_display": build_bag_display,
    "snack_shelf": build_snack_shelf,
    "rangefinder_display": build_rangefinder_display,
}

EXTRA_PREVIEWS = {
    "hat_wall": [("hat_wall_front", 25, 8), ("hat_wall_back", 208, 6)],
    "accessory_slatwall": [("accessory_slatwall_front", 25, 8)],
    "ball_shelf": [("ball_shelf_front", 25, 8)],
    "shoe_wall": [("shoe_wall_front", 25, 8)],
    "apparel_wall_display": [("apparel_wall_display_front", 25, 8)],
    "club_rack": [("club_rack_front", 25, 10), ("club_rack_end", 118, 10)],
    "putter_rack": [("putter_rack_front", 25, 10)],
    "bag_display": [("bag_display_front", 25, 12)],
    "snack_shelf": [("snack_shelf_front", 25, 8)],
    "rangefinder_display": [("rangefinder_display_front", 12, 18)],
}
