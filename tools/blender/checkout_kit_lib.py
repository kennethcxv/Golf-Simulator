"""Shared library for the Golf Empire / Prime Fairways checkout asset kit.

Authoring convention (matches the repo pipeline):
    X  left/right across the counter
    Y  depth; -Y is the staff/player side, +Y is the customer side
    Z  up, metres, base sits on Z=0 unless an asset documents otherwise

Outputs:
    assets/checkout/source/<id>.blend
    assets/checkout/glb/<id>.glb        (Y-up GLB, animations + extras)
    assets/checkout/textures/<img>.png  (generated albedo dumps, for reference)
    assets/checkout/previews/<id>.png   (studio render)
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_props as L  # geometry + fbm/lin2srgb texture core

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
KIT = ROOT / "assets" / "checkout"
SOURCE_DIR = KIT / "source"
GLB_DIR = KIT / "glb"
TEX_DIR = KIT / "textures"
PREVIEW_DIR = KIT / "previews"
for d in (SOURCE_DIR, GLB_DIR, TEX_DIR, PREVIEW_DIR):
    d.mkdir(parents=True, exist_ok=True)

BUILD_VERSION = 1
FPS = 30


# ================================================================== scene ======

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.length_unit = "METERS"
    sc.render.fps = FPS
    sc.frame_start = 1
    sc.frame_end = 60
    sc["asset_build_script"] = "tools/blender/build_checkout_kit.py"
    sc["asset_build_version"] = BUILD_VERSION


# ============================================================= bitmap font =====
# compact 5x7 font — enough glyphs for stylized currency/packaging text

_F = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
    "X": ["10001", "01010", "00100", "00100", "00100", "01010", "10001"],
    "Y": ["10001", "01010", "00100", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
    "$": ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
    "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
    "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
    ".": ["00000", "00000", "00000", "00000", "00000", "00110", "00110"],
    ":": ["00000", "00110", "00110", "00000", "00110", "00110", "00000"],
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
}


def draw_text(arr, text, cx, cy, px, rgb, *, align="center"):
    """Stamp 5x7 bitmap text into a float HxWx3 array. px = pixel size of one font cell."""
    import numpy as np
    text = text.upper()
    gw, gh = 6 * px, 7 * px                       # glyph cell incl. 1px spacing
    total_w = gw * len(text) - px
    x0 = int(cx - total_w / 2) if align == "center" else int(cx)
    y0 = int(cy - gh / 2)
    h, w = arr.shape[:2]
    col = np.array(rgb, "float32")
    for gi, ch in enumerate(text):
        glyph = _F.get(ch)
        if glyph is None:
            continue
        gx = x0 + gi * gw
        for r in range(7):
            for c in range(5):
                if glyph[r][c] == "1":
                    ya, yb = y0 + r * px, y0 + (r + 1) * px
                    xa, xb = gx + c * px, gx + (c + 1) * px
                    if 0 <= ya and yb <= h and 0 <= xa and xb <= w:
                        arr[ya:yb, xa:xb] = col
    return arr


# ============================================================== textures =======

def np_image(name, arr):
    """Write a float32 HxWx3 LINEAR array as a packed sRGB image + dump PNG.
    Arrays are authored top-down (row 0 = visual top); Blender stores bottom-up,
    so rows are reversed here.  Therefore v=1 samples array row 0."""
    import numpy as np
    h, w = arr.shape[:2]
    img = L._img(name, w, h)
    img.colorspace_settings.name = "sRGB"     # BEFORE pixels — switching after discards the buffer
    srgb = L.lin2srgb(np.clip(arr[::-1], 0, 1))
    rgba = np.concatenate([srgb, np.ones((h, w, 1), "float32")], axis=2)
    img.pixels[:] = rgba.ravel().tolist()
    img.update()
    img.pack()
    # dump a reference PNG via a throwaway COPY so the packed original never
    # becomes file-associated (img.save() on the original breaks its colorspace)
    try:
        dup = img.copy()
        dup.filepath_raw = str(TEX_DIR / f"{name}.png")
        dup.file_format = "PNG"
        dup.save()
        bpy.data.images.remove(dup)
    except Exception:
        pass
    return img


def noise_base(base, w, h, *, mottle=0.06, seed=3, cells=14):
    import numpy as np
    rng = np.random.default_rng(seed)
    b = np.array(base, "float32")
    field = (L._fbm(rng, w, h, cells, cells, 5) - 0.5) * (mottle * 2.0)
    micro = (rng.random((h, w)).astype("float32") - 0.5) * 0.02
    return np.clip(b[None, None, :] * (1.0 + field + micro)[..., None], 0, 1)


def plastic_img(name, base, *, seed=5, w=512, h=512, mottle=0.05):
    return np_image(name, noise_base(base, w, h, mottle=mottle, seed=seed, cells=18))


def brushed_img(name, base, *, seed=7, w=512, h=512):
    import numpy as np
    rng = np.random.default_rng(seed)
    b = np.array(base, "float32")
    streak = np.repeat((rng.random((1, w)).astype("float32") - 0.5), h, axis=0) * 0.16
    mott = (L._fbm(rng, w, h, 10, 10, 4) - 0.5) * 0.10
    arr = np.clip(b[None, None, :] * (1.0 + streak + mott)[..., None], 0, 1)
    return np_image(name, arr)


def kraft_img(name="KraftPaper", *, seed=11, w=512, h=512, base=(0.255, 0.150, 0.075)):
    import numpy as np
    rng = np.random.default_rng(seed)
    b = np.array(base, "float32")
    fib = (L._fbm(rng, w, h, 60, 6, 4) - 0.5) * 0.14      # horizontal fibres
    mott = (L._fbm(rng, w, h, 9, 9, 5) - 0.5) * 0.12
    fleck = (rng.random((h, w)).astype("float32") > 0.9985).astype("float32") * 0.18
    arr = np.clip(b[None, None, :] * (1.0 + fib + mott)[..., None] + fleck[..., None] * 0.3, 0, 1)
    return np_image(name, arr)


def receipt_img(name="ReceiptPaper", *, w=256, h=512):
    """A printed receipt: header, item lines, divider, total, footer."""
    import numpy as np
    arr = np.full((h, w, 3), 0.87, "float32")
    arr *= (1.0 + (np.random.default_rng(5).random((h, w, 1)).astype("float32") - 0.5) * 0.03)
    ink = (0.10, 0.10, 0.11)
    draw_text(arr, "PRIME FAIRWAYS", w // 2, 40, 2, ink)
    draw_text(arr, "PRO SHOP RECEIPT", w // 2, 66, 2, ink)
    for i, (item, price) in enumerate([("GOLF MUG", "24.00"), ("TEES 50PK", "6.50"), ("GLOVE", "18.99")]):
        y = 120 + i * 34
        draw_text(arr, item, 18, y, 2, ink, align="left")
        draw_text(arr, price, w - 90, y, 2, ink, align="left")
    arr[236:239, 16:w - 16] = 0.35
    draw_text(arr, "TOTAL", 18, 268, 2, ink, align="left")
    draw_text(arr, "$49.49", w - 110, 268, 2, ink, align="left")
    draw_text(arr, "THANK YOU", w // 2, 330, 2, ink)
    arr[368:371, 40:w - 40] = 0.55
    return np_image(name, arr)


def _ellipse_mask(w, h, cx, cy, rx, ry):
    import numpy as np
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    return ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1.0


def bill_img(denom, tint, *, w=512, h=512):
    """Stylized Prime Fairways reserve note — front on the top half, back on the bottom.
    Deliberately NOT a reproduction of real currency."""
    import numpy as np
    rng = np.random.default_rng(17 + denom)
    base = np.array(tint, "float32")
    arr = np.ones((h, w, 3), "float32") * base
    arr *= (1.0 + (L._fbm(rng, w, h, 40, 40, 4)[..., None] - 0.5) * 0.10)
    ink = (0.070, 0.105, 0.075)
    ink2 = (0.16, 0.19, 0.15)
    label = {1: "ONE", 5: "FIVE", 10: "TEN", 20: "TWENTY", 50: "FIFTY"}[denom]

    def face(y0, y1, front):
        fh = y1 - y0
        # borders
        arr[y0 + 8:y0 + 12, 12:w - 12] = ink
        arr[y1 - 12:y1 - 8, 12:w - 12] = ink
        arr[y0 + 8:y1 - 8, 12:16] = ink
        arr[y0 + 8:y1 - 8, w - 16:w - 12] = ink
        arr[y0 + 18:y0 + 20, 22:w - 22] = ink2
        arr[y1 - 20:y1 - 18, 22:w - 22] = ink2
        cy = y0 + fh // 2
        if front:
            draw_text(arr, "PRIME FAIRWAYS", w // 2, y0 + 38, 2, ink)
            draw_text(arr, "RESERVE NOTE", w // 2, y0 + 62, 1, ink2)
            # centre medallion
            m = _ellipse_mask(w, h, w / 2, cy + 8, 78, 58)
            arr[m] = np.array(tint, "float32") * 0.82
            ring = _ellipse_mask(w, h, w / 2, cy + 8, 78, 58) & ~_ellipse_mask(w, h, w / 2, cy + 8, 70, 50)
            arr[ring] = ink
            draw_text(arr, f"${denom}", w // 2, cy + 8, 4, ink)
            draw_text(arr, label, w // 2, y1 - 34, 2, ink)
            # corner numerals
            for cx_, cy_ in ((44, y0 + 40), (w - 44, y0 + 40), (44, y1 - 40), (w - 44, y1 - 40)):
                draw_text(arr, str(denom), cx_, cy_, 3, ink)
            # side seals
            s1 = _ellipse_mask(w, h, 92, cy + 4, 30, 30) & ~_ellipse_mask(w, h, 92, cy + 4, 24, 24)
            s2 = _ellipse_mask(w, h, w - 92, cy + 4, 30, 30) & ~_ellipse_mask(w, h, w - 92, cy + 4, 24, 24)
            arr[s1] = ink2
            arr[s2] = ink2
        else:
            draw_text(arr, "GOLF EMPIRE", w // 2, y0 + 40, 2, ink2)
            m = _ellipse_mask(w, h, w / 2, cy + 6, 96, 52)
            arr[m] = np.array(tint, "float32") * 0.86
            draw_text(arr, label, w // 2, cy + 6, 3, ink)
            for cx_, cy_ in ((44, y0 + 40), (w - 44, y0 + 40), (44, y1 - 40), (w - 44, y1 - 40)):
                draw_text(arr, str(denom), cx_, cy_, 3, ink2)

    face(0, h // 2, front=True)       # array rows 0..h/2 = v 0.5..1 = FRONT region
    face(h // 2, h, front=False)      # array rows h/2..h = v 0..0.5 = BACK region
    return np_image(f"Bill_{denom}", arr)


def coin_img(code, label, copper, *, w=256, h=256):
    """Coin face art: rim ring + centre denomination.  Top 16px = side-band strip."""
    import numpy as np
    rng = np.random.default_rng(31 + int(code))
    base = np.array((0.42, 0.30, 0.20) if copper else (0.44, 0.45, 0.48), "float32")
    dark = base * 0.55
    arr = np.ones((h, w, 3), "float32") * base
    arr *= (1.0 + (L._fbm(rng, w, h, 30, 30, 4)[..., None] - 0.5) * 0.08)
    c = (w / 2, h / 2 + 8)
    rim = _ellipse_mask(w, h, c[0], c[1], 105, 105) & ~_ellipse_mask(w, h, c[0], c[1], 92, 92)
    arr[rim] = dark
    inner = _ellipse_mask(w, h, c[0], c[1], 60, 60) & ~_ellipse_mask(w, h, c[0], c[1], 55, 55)
    arr[inner] = dark
    draw_text(arr, label, int(c[0]), int(c[1]) - 12, 3, dark)
    draw_text(arr, "CENTS" if code != "100" else "DOLLAR", int(c[0]), int(c[1]) + 30, 1, dark)
    arr[0:16, :] = base * 0.8         # side band strip
    return np_image(f"Coin_{code}", arr)


def card_img(*, w=512, h=512):
    """Prime Fairways member card — generic fake data only."""
    import numpy as np
    rng = np.random.default_rng(7)
    blue = np.array((0.055, 0.13, 0.30), "float32")
    arr = np.ones((h, w, 3), "float32") * blue
    arr *= (1.0 + (L._fbm(rng, w, h, 26, 26, 4)[..., None] - 0.5) * 0.10)
    white = (0.82, 0.85, 0.88)
    # ---- front (array rows 0..h/2 = v 0.5..1) ----
    sweep = _ellipse_mask(w, h, w * 0.15, 40, 260, 120) & (np.mgrid[0:h, 0:w][0] < h // 2)
    arr[sweep] *= 0.82
    draw_text(arr, "PRIME FAIRWAYS", w - 150, 36, 2, white, align="left")
    arr[70:110, 46:104] = blue * 0.7                                    # chip zone marker
    for r_ in (14, 22, 30):                                             # contactless arcs
        ring = _ellipse_mask(w, h, w - 60, 90, r_ + 3, r_ + 3) & ~_ellipse_mask(w, h, w - 60, 90, r_ - 1, r_ - 1)
        ring &= (np.mgrid[0:h, 0:w][1] >= w - 60)
        arr[ring] = white
    draw_text(arr, "1234 5678 9012 3456", w // 2, 165, 3, white)
    draw_text(arr, "VALID 12/28", 46, 205, 2, white, align="left")
    draw_text(arr, "S FAIRWAY", 46, 234, 2, white, align="left")
    # ---- back (array rows h/2..h = v 0..0.5) ----
    y0 = h // 2
    arr[y0 + 24:y0 + 70, :] = np.array((0.03, 0.035, 0.045), "float32")           # mag stripe
    arr[y0 + 100:y0 + 140, 30:w - 120] = np.array((0.75, 0.76, 0.78), "float32")  # signature
    draw_text(arr, "123", w - 70, y0 + 120, 2, (0.1, 0.1, 0.12))
    draw_text(arr, "GOLF EMPIRE MEMBER CARD", w // 2, y0 + 190, 1, white)
    return np_image("PaymentCard", arr)


def barcode_img(name="Barcode", *, w=256, h=128, seed=3):
    import numpy as np
    rng = np.random.default_rng(seed)
    arr = np.ones((h, w, 3), "float32") * 0.88
    x = 22
    while x < w - 26:
        bw_ = int(rng.integers(2, 7))
        if rng.random() > 0.42:
            arr[18:h - 34, x:x + bw_] = 0.05
        x += bw_ + int(rng.integers(2, 5))
    draw_text(arr, "8 50026 73841 7", w // 2, h - 18, 1, (0.05, 0.05, 0.05))
    return np_image(name, arr)


def product_box_img(*, w=1024, h=1024):
    """Atlas for the Prime Fairways Golf Mug box.
    Quadrants: TL=front, TR=side(with barcode), BL=top/bottom flaps, BR=back."""
    import numpy as np
    rng = np.random.default_rng(23)
    kraft = np.array((0.255, 0.150, 0.075), "float32")
    arr = np.ones((h, w, 3), "float32") * kraft
    fib = (L._fbm(rng, w, h, 90, 9, 4)[..., None] - 0.5) * 0.10
    arr *= (1.0 + fib)
    ink = (0.10, 0.085, 0.06)
    green = (0.16, 0.22, 0.15)
    charcoal = (0.055, 0.06, 0.065)
    cream = (0.62, 0.575, 0.47)

    # regions in ARRAY coords (top-down).  UV regions after flip:
    #   front  = u 0..0.5,  v 0.5..1   (array x 0..512,   rows 0..512)
    #   side   = u 0.5..1,  v 0.5..1   (array x 512..1024, rows 0..512)
    #   flaps  = u 0..0.5,  v 0..0.5   (array x 0..512,   rows 512..1024)
    #   back   = u 0.5..1,  v 0..0.5   (array x 512..1024, rows 512..1024)
    # ---- front ----
    fx, fy = 0, 0
    draw_text(arr, "PRIME FAIRWAYS", fx + 256, fy + 48, 2, ink)
    draw_text(arr, "GOLF MUG", fx + 256, fy + 92, 4, ink)
    draw_text(arr, "12 OZ / 355 ML", fx + 256, fy + 130, 2, ink)
    circle = _ellipse_mask(w, h, fx + 256, fy + 268, 120, 120)
    arr[circle] = green
    mug = _ellipse_mask(w, h, fx + 246, fy + 268, 62, 60)
    arr[mug] = charcoal
    handle = _ellipse_mask(w, h, fx + 318, fy + 268, 30, 26) & ~_ellipse_mask(w, h, fx + 318, fy + 268, 18, 14)
    arr[handle] = charcoal
    arr[fy + 400:fy + 480, fx + 24:fx + 488] = np.array(charcoal, "float32")
    for i, txt in enumerate(("DISH SAFE", "MICRO SAFE", "PF CLUB")):
        cxx = fx + 120 + i * 136
        ring = _ellipse_mask(w, h, cxx, fy + 428, 22, 22) & ~_ellipse_mask(w, h, cxx, fy + 428, 18, 18)
        arr[ring] = cream
        draw_text(arr, txt, cxx, fy + 464, 1, cream)
    # ---- side (leaf motif + barcode panel) ----
    sx, sy = w // 2, 0
    draw_text(arr, "PRIME FAIRWAYS", sx + 256, sy + 52, 2, ink)
    arr[sy + 100:sy + 320, sx + 236:sx + 244] = np.array(green, "float32")
    for i in range(4):
        leaf = _ellipse_mask(w, h, sx + 216 - i * 6, sy + 140 + i * 52, 26, 12)
        leaf |= _ellipse_mask(w, h, sx + 264 + i * 6, sy + 170 + i * 52, 26, 12)
        arr[leaf] = np.array(green, "float32")
    arr[sy + 342:sy + 452, sx + 150:sx + 400] = np.array((0.88, 0.88, 0.86), "float32")
    bx = sx + 168
    while bx < sx + 380:
        bw_ = int(rng.integers(2, 7))
        if rng.random() > 0.42:
            arr[sy + 372:sy + 434, bx:bx + bw_] = 0.05
        bx += bw_ + int(rng.integers(2, 5))
    draw_text(arr, "8 50026 73841 7", sx + 274, sy + 446, 1, (0.05, 0.05, 0.05))
    # ---- flaps (seam + tape lines) ----
    tx, ty = 0, h // 2
    arr[ty + 250:ty + 262, tx + 20:tx + 492] = kraft * 0.75
    arr[ty + 160:ty + 168, tx + 20:tx + 492] = kraft * 0.85
    arr[ty + 344:ty + 352, tx + 20:tx + 492] = kraft * 0.85
    draw_text(arr, "PF", tx + 256, ty + 92, 3, ink)
    # ---- back (info lines + white label) ----
    bx0, by0 = w // 2, h // 2
    draw_text(arr, "PRIME FAIRWAYS GOLF MUG", bx0 + 256, by0 + 72, 1, ink)
    for i in range(7):
        yy = by0 + 130 + i * 34
        arr[yy:yy + 6, bx0 + 60:bx0 + 452] = kraft * 0.72
    arr[by0 + 392:by0 + 452, bx0 + 330:bx0 + 452] = np.array((0.88, 0.88, 0.86), "float32")
    return np_image("ProductBoxAtlas", arr)


# ============================================================== materials ======

def m_flat(name, rgb, *, rough=0.6, metal=0.0, emit=None, estr=0.0, alpha=1.0, ds=False):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Alpha"].default_value = alpha
    if emit:
        sock = b.inputs.get("Emission Color") or b.inputs.get("Emission")
        if sock:
            sock.default_value = (*emit, 1.0)
        if b.inputs.get("Emission Strength"):
            b.inputs["Emission Strength"].default_value = estr
    if alpha < 1.0 and hasattr(m, "surface_render_method"):
        m.surface_render_method = "BLENDED"
    if ds:
        m.use_backface_culling = False
    m.diffuse_color = (*rgb, alpha)
    return m


def m_tex(name, img, *, rough=0.6, metal=0.0, ds=False, emit_img=False, estr=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    t.extension = "REPEAT"
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    if emit_img:
        sock = b.inputs.get("Emission Color") or b.inputs.get("Emission")
        if sock:
            nt.links.new(t.outputs["Color"], sock)
        if b.inputs.get("Emission Strength"):
            b.inputs["Emission Strength"].default_value = estr
    if ds:
        m.use_backface_culling = False
    return m


def kit_materials():
    """The shared checkout palette (stylized-PBR, glTF-safe)."""
    return {
        # structure
        "charcoal": m_tex("M_CharcoalPlastic", plastic_img("CharcoalPlastic", (0.031, 0.034, 0.040), seed=5), rough=0.48),
        "black": m_tex("M_MatteBlackMetal", plastic_img("MatteBlackMetal", (0.016, 0.017, 0.019), seed=8, mottle=0.04), rough=0.42, metal=0.35),
        "cream": m_tex("M_CreamPanel", plastic_img("CreamPanel", (0.62, 0.575, 0.47), seed=4, mottle=0.03), rough=0.55),
        "cream_lit": m_flat("M_CreamLit", (0.66, 0.62, 0.52), rough=0.5, emit=(0.66, 0.62, 0.52), estr=0.55),
        "alu": m_tex("M_BrushedAlu", brushed_img("BrushedAlu", (0.34, 0.35, 0.37)), rough=0.35, metal=0.85),
        "walnut": m_tex("M_KitWalnut", L.wood_image("KitWalnut", "walnut"), rough=0.38),
        "green": m_flat("M_DeepGreen", (0.024, 0.075, 0.048), rough=0.5),
        "sage": m_flat("M_Sage", (0.135, 0.190, 0.135), rough=0.62),
        "brass": m_flat("M_KitBrass", (0.58, 0.42, 0.15), rough=0.3, metal=0.9),
        # devices
        "plastic_mid": m_tex("M_MidPlastic", plastic_img("MidPlastic", (0.055, 0.060, 0.068), seed=9), rough=0.5),
        "tray_gray": m_tex("M_TrayGray", plastic_img("TrayGray", (0.52, 0.535, 0.55), seed=12, mottle=0.025), rough=0.5),
        "rubber": m_flat("M_KitRubber", (0.018, 0.019, 0.021), rough=0.88),
        "screen_off": m_flat("M_ScreenOff", (0.012, 0.014, 0.017), rough=0.18, emit=(0.02, 0.025, 0.03), estr=0.35),
        "led_red": m_flat("M_LedRed", (0.55, 0.02, 0.01), rough=0.3, emit=(1.0, 0.05, 0.02), estr=2.0),
        "led_green": m_flat("M_LedGreen", (0.05, 0.5, 0.1), rough=0.3, emit=(0.1, 1.0, 0.2), estr=1.5),
        "scan_red": m_flat("M_ScanWindow", (0.14, 0.008, 0.006), rough=0.15, emit=(0.7, 0.03, 0.01), estr=0.22, alpha=0.9, ds=True),
        "btn_red": m_flat("M_BtnRed", (0.52, 0.035, 0.02), rough=0.45),
        "btn_yellow": m_flat("M_BtnYellow", (0.72, 0.50, 0.04), rough=0.45),
        "btn_green": m_flat("M_BtnGreen", (0.05, 0.42, 0.10), rough=0.45),
        "key_dark": m_flat("M_KeyDark", (0.026, 0.028, 0.032), rough=0.5),
        # paper / soft
        "kraft": m_tex("M_Kraft", kraft_img(), rough=0.78, ds=True),
        "paper": m_flat("M_Paper", (0.86, 0.85, 0.80), rough=0.8, ds=True),
        "rope": m_flat("M_Rope", (0.055, 0.055, 0.06), rough=0.85),
        "collision": m_flat("M_Collision", (1.0, 0.0, 1.0), rough=1.0, alpha=0.0),
    }


# ============================================================== geometry =======

def empty(name, loc=(0, 0, 0), rot=(0, 0, 0), *, parent=None, size=0.05, props=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.empty_display_type = "ARROWS"
    o.empty_display_size = size
    o.location = loc
    o.rotation_euler = rot
    if parent is not None:
        o.parent = parent
    for k, v in (props or {}).items():
        o[k] = v
    return o


def asset_root(asset_id, dims):
    return empty(asset_id, props={
        "asset_id": asset_id, "asset_version": BUILD_VERSION, "units": "meters",
        "front": "-Y (player side)", "target_dimensions_m": list(dims),
        "source": "Original Prime Fairways asset generated in-repository",
        "license": "Project-owned / UNLICENSED",
    })


def uv_plane(name, w, h, loc, mat, *, rot=(0, 0, 0), parent=None, uv=(0, 0, 1, 1)):
    """A single quad facing -Y with a clean rectangular UV layout (u0,v0,u1,v1)."""
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in ((-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2))]
    f = bm.faces.new(v)
    f.normal_update()
    if f.normal.y > 0:
        bmesh.ops.reverse_faces(bm, faces=[f])
    layer = bm.loops.layers.uv.new("UVMap")
    u0, v0, u1, v1 = uv
    coords = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    for loop, c in zip(f.loops, coords):
        loop[layer].uv = c
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.rotation_euler = rot
    o.location = loc
    me.materials.append(mat)
    if parent is not None:
        L.parent_keep(o, parent)
    return o


def uv_box(name, dims, loc, mat, *, rot=(0, 0, 0), parent=None, face_uv=None, bevel=0.0):
    """A box whose six faces get explicit UV rects from face_uv:
    {'-Y':(u0,v0,u1,v1), '+Y':..., '-X':..., '+X':..., '+Z':..., '-Z':...}"""
    w, d, h = dims
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for vtx in bm.verts:
        vtx.co.x *= w
        vtx.co.y *= d
        vtx.co.z *= h
    bm.normal_update()
    layer = bm.loops.layers.uv.new("UVMap")
    default = (0.0, 0.0, 0.02, 0.02)
    for f in bm.faces:
        n = f.normal
        if abs(n.y) > 0.5:
            key = "-Y" if n.y < 0 else "+Y"
            axes = (0, 2)     # u from x, v from z
            flip_u = n.y > 0
        elif abs(n.x) > 0.5:
            key = "-X" if n.x < 0 else "+X"
            axes = (1, 2)
            flip_u = n.x < 0
        else:
            key = "+Z" if n.z > 0 else "-Z"
            axes = (0, 1)
            flip_u = False
        u0, v0, u1, v1 = (face_uv or {}).get(key, default)
        dim = (w, d, h)
        for loop in f.loops:
            co = loop.vert.co
            tu = co[axes[0]] / dim[axes[0]] + 0.5
            tv = co[axes[1]] / dim[axes[1]] + 0.5
            if flip_u:
                tu = 1.0 - tu
            loop[layer].uv = (u0 + (u1 - u0) * tu, v0 + (v1 - v0) * tv)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.rotation_euler = rot
    o.location = loc
    me.materials.append(mat)
    if bevel > 0:
        L.activate(o)
        md = o.modifiers.new("bev", "BEVEL")
        md.width = bevel
        md.segments = 2
        md.limit_method = "ANGLE"
        md.angle_limit = math.radians(40)
        bpy.ops.object.modifier_apply(modifier=md.name)
    if parent is not None:
        L.parent_keep(o, parent)
    return o


def collision_box(name, dims, loc, M, parent):
    o = L.box(name, dims, loc, M["collision"], bevel=0.0, parent=parent, uv=False)
    o["collision_proxy"] = True
    o.display_type = "WIRE"
    o.hide_render = True
    return o


# ============================================================== animation ======

def key_loc(obj, frame, loc):
    obj.location = loc
    obj.keyframe_insert(data_path="location", frame=frame)


def key_rot(obj, frame, rot):
    obj.rotation_euler = rot
    obj.keyframe_insert(data_path="rotation_euler", frame=frame)


def finish_clip(obj, clip_name):
    """Name the active action and stash it to an NLA track so multiple named
    clips survive glTF export (exporter runs in ACTIONS mode)."""
    ad = obj.animation_data
    if not ad or not ad.action:
        raise RuntimeError(f"no action to finish on {obj.name}")
    act = ad.action
    act.name = clip_name
    act.use_fake_user = True
    track = ad.nla_tracks.new()
    track.name = clip_name
    start = int(act.frame_range[0])
    strip = track.strips.new(clip_name, start, act)
    strip.name = clip_name
    track.mute = True
    ad.action = None
    return act


# ========================================================== save / export ======

def save_and_export(asset_id, root):
    bpy.context.scene.frame_set(1)
    blend_path = SOURCE_DIR / f"{asset_id}.blend"
    glb_path = GLB_DIR / f"{asset_id}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)

    bpy.ops.object.select_all(action="DESELECT")
    objs = L.descendants(root)
    for o in objs:
        o.hide_viewport = False
        o.hide_render = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_animations=True,
        export_force_sampling=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )
    print(f"BUILT|{asset_id}|source={blend_path.relative_to(ROOT)}|glb={glb_path.relative_to(ROOT)}|nodes={len(objs)}")
    return blend_path, glb_path


def render_preview(asset_id, root, *, azimuth=33, elevation=12, name=None):
    out = PREVIEW_DIR / f"{name or asset_id}.png"
    for o in bpy.data.objects:
        if o.get("collision_proxy"):
            o.hide_render = True
    mins, maxs = L._world_bounds(root)
    C = Vector(((mins[0] + maxs[0]) / 2, (mins[1] + maxs[1]) / 2, (mins[2] + maxs[2]) / 2))
    S = max(0.05, max(maxs[i] - mins[i] for i in range(3)))
    sc = bpy.context.scene
    L.box("PreviewFloor", (max(20, S * 8), max(20, S * 8), 0.04), (C.x, C.y, mins[2] - 0.02),
          m_flat("M_Floor", (0.55, 0.55, 0.57), rough=0.9), bevel=0.0, uv=False)
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.72, 0.72, 0.74, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.45
    sc.world = world

    def sun(name, energy, rot):
        d = bpy.data.lights.new(name, "SUN")
        d.energy = energy
        d.angle = math.radians(6)
        ob = bpy.data.objects.new(name, d)
        ob.rotation_euler = rot
        bpy.context.collection.objects.link(ob)
    sun("Key", 2.0, (math.radians(52), 0, math.radians(30)))
    sun("Fill", 0.8, (math.radians(60), 0, math.radians(-65)))
    sun("Rim", 0.9, (math.radians(118), 0, math.radians(185)))
    soft = bpy.data.lights.new("Soft", "AREA")
    soft.energy = 14 * S * S + 1.5
    soft.size = S * 2.2
    softob = bpy.data.objects.new("Soft", soft)
    az = math.radians(azimuth)
    softob.location = C + Vector((math.sin(az) * 0.4, -1.0, 0.8)) * (S * 2.1)
    softob.rotation_euler = (math.radians(55), 0, az)
    bpy.context.collection.objects.link(softob)

    el = math.radians(elevation)
    dist = S * 2.6 + 0.02
    cam_pos = C + Vector((math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el))) * dist
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 60
    cam = bpy.data.objects.new("Cam", cam_data)
    cam.location = cam_pos
    cam.rotation_euler = (C - cam_pos).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(cam)
    sc.camera = cam
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            sc.render.engine = eng
            break
        except Exception:
            continue
    try:
        sc.view_settings.view_transform = "AgX"
    except Exception:
        pass
    sc.render.resolution_x = 1100
    sc.render.resolution_y = 1100
    sc.render.filepath = str(out)
    bpy.ops.render.render(write_still=True)
    print(f"PREVIEW|{out.relative_to(ROOT)}")
