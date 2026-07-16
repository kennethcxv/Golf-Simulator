"""Shared library for the Golf Flipper checkout asset kit (Sheet 01).

All branding is ORIGINAL and fictional: the club is FAIRHOLLOW GOLF CLUB, the
payment network is LINKSPAY, and the cash is a fictional club currency
denominated in UNITS.  No real-world currency, card network, or golf brand
artwork is reproduced anywhere in this kit.

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
    "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
    ",": ["00000", "00000", "00000", "00000", "00110", "00110", "01100"],
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


OLIVE_PAPER = (0.062, 0.076, 0.034)      # deep olive carrier stock (linear)
GOLD_INK = (0.52, 0.36, 0.11)            # screen-printed gold ink (linear)
PALE_GOLD = (0.66, 0.52, 0.26)


def _olive_field(rng, w, h):
    """Olive paper base with vertical fibre + mottle, shared by bag body + art
    so the printed panel disappears into the sheet."""
    import numpy as np
    base = np.array(OLIVE_PAPER, "float32")
    arr = np.ones((h, w, 3), "float32") * base
    fib = (L._fbm(rng, w, h, 54, 6, 4) - 0.5) * 0.13          # vertical paper fibres
    mott = (L._fbm(rng, w, h, 9, 9, 5) - 0.5) * 0.10
    arr *= (1.0 + fib + mott)[..., None]
    fleck = (rng.random((h, w)).astype("float32") > 0.9988).astype("float32")
    arr += fleck[..., None] * np.array((0.10, 0.09, 0.05), "float32")
    return np.clip(arr, 0, 1)


def olive_paper_img(name="OlivePaper", *, w=512, h=512):
    """The bag body sheet: olive stock with two faint fold shadows so the paper
    reads creased even where geometry is flat.  Tiles 4x2 around the bag."""
    import numpy as np
    rng = np.random.default_rng(19)
    arr = _olive_field(rng, w, h)
    for fx in (0.31, 0.74):                                   # soft vertical creases
        x = int(fx * w)
        dist = np.abs(np.arange(w, dtype="float32") - x)
        shade = np.clip(1.0 - dist / 26.0, 0, 1) * 0.16
        arr *= (1.0 - shade)[None, :, None]
        edge = np.clip(1.0 - np.abs(dist - 5.0) / 2.2, 0, 1) * 0.10
        arr *= (1.0 + edge)[None, :, None]                    # bright fold ridge
    return np_image(name, arr)


def bag_art_img(name="BagArtwork", *, w=768, h=768):
    """The FAIRHOLLOW GOLF CLUB carrier print: gold double-ring crest (crossed
    clubs under a dimpled ball), wordmark and quote — original branding,
    screen-printed in gold on the olive sheet."""
    import numpy as np
    rng = np.random.default_rng(31)
    arr = _olive_field(rng, w, h)
    gold = np.array(GOLD_INK, "float32")
    pale = np.array(PALE_GOLD, "float32")

    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    cx, cy, R = w / 2, 262.0, 188.0
    d = np.hypot(xx - cx, yy - cy)

    # crest: thin double ring in gold ink
    arr[(d > R - 7) & (d < R)] = gold
    arr[(d > R - 22) & (d < R - 17)] = gold
    inside = d < R - 22

    # crossed club shafts with simple heads
    for (x0, y0, x1, y1) in ((cx - 108, cy + 96, cx + 96, cy - 78), (cx + 108, cy + 96, cx - 96, cy - 78)):
        m = _seg_mask(w, h, x0, y0, x1, y1, 6) & inside
        arr[m] = gold
    arr[_ellipse_mask(w, h, cx + 104, cy - 86, 20, 13) & inside] = gold   # wood head
    arr[_ellipse_mask(w, h, cx - 104, cy - 86, 15, 15) & inside] = gold   # iron head
    # dimpled ball above the cross
    _stamp_golf_ball(arr, cx, cy - 118, 30, pale, tuple(gold * 0.85))
    # tee chevron under the cross
    arr[_seg_mask(w, h, cx - 16, cy + 118, cx, cy + 138, 5) & inside] = gold
    arr[_seg_mask(w, h, cx + 16, cy + 118, cx, cy + 138, 5) & inside] = gold

    # wordmark + rules + quote (original)
    draw_text(arr, "FAIRHOLLOW", w // 2, 530, 8, tuple(gold))
    draw_text(arr, "GOLF CLUB", w // 2, 596, 4, tuple(pale))
    arr[624:627, 150:w - 150] = gold
    draw_text(arr, "PLAY THE GAME.", w // 2, 664, 3, tuple(pale))
    draw_text(arr, "ENJOY THE JOURNEY.", w // 2, 700, 3, tuple(pale))
    return np_image(name, arr)


def oakslat_img(name="OakSlat", *, w=1024, h=1024):
    """Light natural oak with VERTICAL grain (ring lines run along V) for the
    counter's slat front.  Each slat samples a narrow random u-slice, so
    neighbouring boards carry different figure."""
    import numpy as np
    rng = np.random.default_rng(27)
    U = np.linspace(0, 1, w, dtype="float32")[None, :] * np.ones((h, 1), "float32")
    warp = (L._fbm(rng, w, h, 3, 8, 4) - 0.5) * 0.10
    rings = U * 22.0 + warp
    grain = (0.5 - 0.5 * np.cos(rings * 2 * np.pi)) ** 2.2
    pore = np.clip(0.5 + (L._fbm(rng, w, h, 90, 5, 4) - 0.5) * 1.6, 0, 1)
    drift = L._fbm(rng, w, h, 2, 5, 3)
    base = np.array((0.400, 0.300, 0.185), "float32")
    dark = np.array((0.270, 0.192, 0.112), "float32")
    light = np.array((0.490, 0.385, 0.255), "float32")
    tone = base[None, None, :] * (1 - drift[..., None]) + light[None, None, :] * drift[..., None]
    col = tone * (1 - 0.26 * grain[..., None]) + dark[None, None, :] * (0.26 * grain[..., None])
    col = np.clip(col * (0.94 + 0.09 * pore[..., None]), 0, 1)
    return np_image(name, col)


def apparel_header_img(name="ApparelHeader", *, w=1024, h=176):
    """The APPAREL category header board: charcoal field, cream lettering,
    thin brass rules — the retail sign language of the club."""
    import numpy as np
    rng = np.random.default_rng(23)
    base = np.array((0.020, 0.022, 0.026), "float32")
    arr = np.ones((h, w, 3), "float32") * base
    arr *= (1.0 + (L._fbm(rng, w, h, 30, 8, 3)[..., None] - 0.5) * 0.10)
    gold = np.array((0.52, 0.36, 0.11), "float32")
    arr[24:27, 56:w - 56] = gold * 0.8
    arr[h - 27:h - 24, 56:w - 56] = gold * 0.8
    draw_text(arr, "APPAREL", w // 2, h // 2, 9, (0.62, 0.575, 0.47))
    return np_image(name, arr)


def receipt_img(name="ReceiptPaper", *, w=256, h=768):
    """A printed thermal receipt (matches the reference sheet): club header,
    date/register line, item lines, rules, bold total, paid line, barcode and
    the send-off quote.  Faint thermal banding keeps it from reading flat."""
    import numpy as np
    rng = np.random.default_rng(5)
    arr = np.full((h, w, 3), 0.845, "float32")
    arr *= (1.0 + (rng.random((h, w, 1)).astype("float32") - 0.5) * 0.03)
    band = (np.sin(np.arange(h, dtype="float32") * 0.55) * 0.008)[:, None, None]
    arr = np.clip(arr * (1.0 + band), 0, 1)                    # thermal feed banding
    ink = (0.085, 0.09, 0.10)
    soft = (0.30, 0.31, 0.33)
    draw_text(arr, "FAIRHOLLOW", w // 2, 36, 3, ink)
    draw_text(arr, "GOLF CLUB", w // 2, 66, 2, ink)
    draw_text(arr, "PRO SHOP", w // 2, 92, 1, soft)
    arr[108:110, 20:w - 20] = np.array(soft, "float32")
    draw_text(arr, "REG 01", 20, 128, 1, soft, align="left")
    draw_text(arr, "CLERK 03", w - 118, 128, 1, soft, align="left")
    draw_text(arr, "06/12 2:41 PM", 20, 150, 1, soft, align="left")
    arr[166:168, 20:w - 20] = np.array(soft, "float32")
    items = [("GOLF GLOVE", "25.00"), ("PREM BALLS X2", "48.00"), ("PERF POLO", "45.00")]
    for i, (item, price) in enumerate(items):
        y = 194 + i * 30
        draw_text(arr, item, 20, y, 1, ink, align="left")
        draw_text(arr, price, w - 86, y, 1, ink, align="left")
    arr[282:284, 20:w - 20] = np.array(soft, "float32")
    draw_text(arr, "SUBTOTAL", 20, 306, 1, ink, align="left")
    draw_text(arr, "118.00", w - 92, 306, 1, ink, align="left")
    draw_text(arr, "TOTAL", 20, 340, 2, ink, align="left")
    draw_text(arr, "118.00", w - 110, 340, 2, ink, align="left")
    draw_text(arr, "PAID - MEMBER CARD", 20, 372, 1, soft, align="left")
    arr[392:394, 20:w - 20] = np.array(soft, "float32")
    x = 34                                                     # footer barcode
    while x < w - 40:
        bw_ = int(rng.integers(2, 6))
        if rng.random() > 0.4:
            arr[416:466, x:x + bw_] = np.array(ink, "float32")
        x += bw_ + int(rng.integers(2, 4))
    draw_text(arr, "THANK YOU!", w // 2, 506, 2, ink)
    draw_text(arr, "SEE YOU ON", w // 2, 538, 1, soft)
    draw_text(arr, "THE FAIRWAY.", w // 2, 560, 1, soft)
    return np_image(name, arr)


def _ellipse_mask(w, h, cx, cy, rx, ry):
    import numpy as np
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    return ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1.0


def _seg_mask(w, h, x0, y0, x1, y1, r):
    """Pixels within distance r of the segment (x0,y0)-(x1,y1) — a thick stroke."""
    import numpy as np
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    dx, dy = float(x1 - x0), float(y1 - y0)
    ln2 = max(dx * dx + dy * dy, 1e-6)
    t = np.clip(((xx - x0) * dx + (yy - y0) * dy) / ln2, 0.0, 1.0)
    return np.hypot(xx - (x0 + t * dx), yy - (y0 + t * dy)) <= r


def _stamp_golfer(arr, cx, cy, s, color):
    """An engraved golfer at follow-through, composed from strokes.  `s` scales
    a ~56px-tall figure; original silhouette, no source artwork traced."""
    import numpy as np
    h, w = arr.shape[:2]
    col = np.array(color, "float32")
    strokes = [
        # torso, leaning back into the finish
        (cx - 1 * s, cy - 14 * s, cx + 3 * s, cy + 2 * s, 3.4 * s),
        # front leg planted, back leg toe-down behind
        (cx + 3 * s, cy + 2 * s, cx + 1 * s, cy + 22 * s, 2.4 * s),
        (cx + 3 * s, cy + 2 * s, cx + 11 * s, cy + 20 * s, 2.2 * s),
        # arms swung up over the lead shoulder
        (cx - 1 * s, cy - 11 * s, cx - 11 * s, cy - 20 * s, 2.1 * s),
        # club shaft wrapped high behind the back
        (cx - 11 * s, cy - 20 * s, cx + 6 * s, cy - 30 * s, 1.1 * s),
    ]
    for (x0, y0, x1, y1, r) in strokes:
        arr[_seg_mask(w, h, x0, y0, x1, y1, r)] = col
    # head + cap brim
    arr[_ellipse_mask(w, h, cx - 3 * s, cy - 21 * s, 4.6 * s, 4.6 * s)] = col
    arr[_seg_mask(w, h, cx - 8 * s, cy - 22 * s, cx - 3 * s, cy - 23 * s, 1.2 * s)] = col
    # club head
    arr[_ellipse_mask(w, h, cx + 7 * s, cy - 31 * s, 2.6 * s, 1.8 * s)] = col
    return arr


def _stamp_golf_ball(arr, cx, cy, r, pale, dimple):
    """A dimpled ball medallion: pale disk + a hex-ish grid of dimple dots."""
    import numpy as np
    h, w = arr.shape[:2]
    arr[_ellipse_mask(w, h, cx, cy, r, r)] = np.array(pale, "float32")
    step = max(3, int(r * 0.38))
    row = 0
    y = cy - r + step
    while y < cy + r - step * 0.4:
        off = (step // 2) if (row % 2) else 0
        x = cx - r + step + off
        while x < cx + r - step * 0.4:
            if (x - cx) ** 2 + (y - cy) ** 2 <= (r - step * 0.9) ** 2:
                arr[_ellipse_mask(w, h, x, y, max(1.2, r * 0.085), max(1.2, r * 0.085))] = np.array(dimple, "float32")
            x += step
        y += step
        row += 1
    return arr


def _crest_pennant(arr, cx, cy, s, color):
    """The Fairhollow mark: a flag pole with a pennant over two fairway hills."""
    import numpy as np
    h, w = arr.shape[:2]
    col = np.array(color, "float32")
    arr[_seg_mask(w, h, cx + 4 * s, cy - 30 * s, cx + 4 * s, cy + 14 * s, 1.6 * s)] = col
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    pen = (yy > cy - 30 * s) & (yy < cy - 16 * s) & (xx < cx + 4 * s) \
        & (xx > cx + 4 * s - 1.5 * ((yy - (cy - 30 * s)) + 2 * s))
    arr[pen] = col
    return arr


def bill_img(denom, tint, *, w=512, h=512):
    """A FAIRHOLLOW CLUB NOTE in fictional UNITS — engraved-style field with a
    fairway vignette, dimpled-ball medallion, bold corner numerals and a value
    banner (front), golfer engraving (back).  Front on the top half of the
    texture, back on the bottom.  Deliberately NOT any real-world currency."""
    import numpy as np
    rng = np.random.default_rng(17 + denom)
    tintv = np.array(tint, "float32")
    paper = np.array((0.58, 0.56, 0.47), "float32")
    field = tintv * 0.52 + paper * 0.48
    ink = tintv * 0.16 + np.array((0.02, 0.03, 0.02), "float32")
    ink2 = tintv * 0.34 + np.array((0.06, 0.07, 0.05), "float32")
    pale = np.array((0.90, 0.88, 0.78), "float32")
    label = {1: "ONE", 5: "FIVE", 10: "TEN", 20: "TWENTY", 50: "FIFTY"}[denom]

    arr = np.ones((h, w, 3), "float32") * field
    arr *= (1.0 + (L._fbm(rng, w, h, 40, 40, 4)[..., None] - 0.5) * 0.07)
    # engraved wavy scanlines across the whole sheet
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    waves = ((yy + 2.6 * np.sin(xx * 0.055 + yy * 0.11)) % 5.0) < 1.5
    arr[waves] = arr[waves] * 0.90 + ink[None, :] * 0.045

    def frame(y0, y1):
        arr[y0 + 8:y0 + 12, 10:w - 10] = ink
        arr[y1 - 12:y1 - 8, 10:w - 10] = ink
        arr[y0 + 8:y1 - 8, 10:14] = ink
        arr[y0 + 8:y1 - 8, w - 14:w - 10] = ink
        arr[y0 + 16:y0 + 17, 18:w - 18] = ink2
        arr[y1 - 17:y1 - 16, 18:w - 18] = ink2

    # ------------------------------- FRONT (array rows 0..h/2 = v 0.5..1) ----
    y0, y1 = 0, h // 2
    cy = (y0 + y1) // 2
    frame(y0, y1)
    # bold corner value panels (drawer-glance readability)
    npx = 3 if denom < 10 else 2
    for (px0, py0) in ((16, y0 + 14), (w - 78, y0 + 14), (16, y1 - 62), (w - 78, y1 - 62)):
        arr[py0:py0 + 48, px0:px0 + 62] = tintv * 0.30
        draw_text(arr, str(denom), px0 + 31, py0 + 24, npx + 1, pale)
    draw_text(arr, "FAIRHOLLOW GOLF CLUB", w // 2, y0 + 30, 2, tuple(ink))
    draw_text(arr, "CLUB RESERVE NOTE", w // 2, y0 + 54, 1, tuple(ink2))
    # central fairway vignette
    vg = _ellipse_mask(w, h, w / 2, cy + 10, 118, 62)
    ring = vg & ~_ellipse_mask(w, h, w / 2, cy + 10, 112, 56)
    arr[vg] = field * 1.10
    hill1 = _ellipse_mask(w, h, w / 2 - 52, cy + 74, 150, 58) & vg
    hill2 = _ellipse_mask(w, h, w / 2 + 74, cy + 86, 170, 62) & vg
    arr[hill1] = tintv * 0.42 + paper * 0.20
    arr[hill2] = tintv * 0.34 + paper * 0.30
    sun = _ellipse_mask(w, h, w / 2 - 74, cy - 24, 15, 15) & vg
    arr[sun] = pale
    _crest_pennant(arr, w / 2 + 26, cy + 8, 1.5, tuple(ink))
    arr[ring] = ink
    # ball medallion (right) + monogram ring (left)
    _stamp_golf_ball(arr, w - 108, cy + 6, 25, tuple(pale), tuple(ink2))
    mr = _ellipse_mask(w, h, 108, cy + 6, 27, 27) & ~_ellipse_mask(w, h, 108, cy + 6, 23, 23)
    arr[mr] = ink2
    draw_text(arr, "FH", 108, cy + 6, 2, tuple(ink))
    # bottom value banner
    arr[y1 - 44:y1 - 20, 128:w - 128] = tintv * 0.30
    draw_text(arr, f"{label} UNITS", w // 2, y1 - 32, 2, tuple(pale))

    # ------------------------------- BACK (array rows h/2..h = v 0..0.5) -----
    y0, y1 = h // 2, h
    cy = (y0 + y1) // 2
    frame(y0, y1)
    draw_text(arr, "FAIRHOLLOW GOLF CLUB", w // 2, y0 + 32, 2, tuple(ink))
    for (cx_, cy_) in ((46, y0 + 40), (w - 46, y0 + 40), (46, y1 - 42), (w - 46, y1 - 42)):
        draw_text(arr, str(denom), cx_, cy_, 3, tuple(ink2))
    # engraved golfer over a ground line
    med = _ellipse_mask(w, h, w / 2, cy + 8, 96, 66)
    arr[med] = field * 1.08
    ring = med & ~_ellipse_mask(w, h, w / 2, cy + 8, 90, 60)
    _stamp_golfer(arr, w / 2 - 4, cy + 6, 1.7, tuple(ink))
    arr[_seg_mask(w, h, w / 2 - 72, cy + 48, w / 2 + 72, cy + 48, 1.6) & med] = ink2
    arr[_ellipse_mask(w, h, w / 2 - 34, cy + 44, 3, 3)] = pale
    arr[ring] = ink
    draw_text(arr, f"{label} UNITS", w // 2, y1 - 34, 2, tuple(ink))
    # pale strip straddling the texture's centre seam: the mesh's edge faces
    # sample uv (0.005..0.035, 0.495..0.505) here — paper edge, not border ink
    arr[h // 2 - 6:h // 2 + 6, 0:22] = paper * 1.05
    return np_image(f"Bill_{denom}", arr)


COIN_METALS = {
    # code: (core metal, ring metal or None) — linear floats.  50 is the
    # bimetallic hero (gold ring / silver core) from the reference sheet.
    "01": ((0.42, 0.26, 0.15), None),                          # copper
    "05": ((0.40, 0.40, 0.36), None),                          # warm nickel
    "10": ((0.47, 0.48, 0.52), None),                          # bright silver
    "25": ((0.46, 0.47, 0.50), None),                          # silver, laurel
    "50": ((0.47, 0.48, 0.52), (0.52, 0.38, 0.14)),            # gold ring + silver core
}


def coin_img(code, label, *, w=256, h=512):
    """Coin art with DISTINCT faces: obverse (rows 0..256, v .5..1) carries the
    laurel ring + denomination + ball mark; reverse (rows 256..512) carries the
    golfer engraving.  A reeded band straddles the centre seam (v ~0.5) for the
    cylinder's side faces.  Fictional UNITS coinage, not any real coin."""
    import numpy as np
    core, ringm = COIN_METALS[code]
    rng = np.random.default_rng(31 + int(code))
    base = np.array(core, "float32")
    dark = base * 0.48
    bright = np.clip(base * 1.45, 0, 1)
    arr = np.ones((h, w, 3), "float32") * base
    arr *= (1.0 + (L._fbm(rng, w, h, 30, 30, 4)[..., None] - 0.5) * 0.075)
    # radial brush: faint concentric machining rings on both faces
    for cy_face in (128, 384):
        yy, xx = np.mgrid[0:h, 0:w].astype("float32")
        rr = np.hypot(xx - 128, yy - cy_face)
        spin = (np.sin(rr * 1.9) * 0.020)[..., None]
        band = (rr < 108)[..., None]
        arr = np.clip(arr * (1.0 + spin * band), 0, 1)

    def face(cy, front):
        c = (w / 2, cy)
        R = 121                                                 # mesh edge sits at r=128
        if ringm is not None:                                   # bimetallic collar
            ring = _ellipse_mask(w, h, c[0], c[1], R, R) & ~_ellipse_mask(w, h, c[0], c[1], 78, 78)
            rv = np.array(ringm, "float32")
            arr[ring] = rv
            arr[_ellipse_mask(w, h, c[0], c[1], 80, 80) & ~_ellipse_mask(w, h, c[0], c[1], 77, 77)] = rv * 0.55
        # raised rim: bright crest line + shadow just inside the edge
        arr[_ellipse_mask(w, h, c[0], c[1], R + 7, R + 7) & ~_ellipse_mask(w, h, c[0], c[1], R - 4, R - 4)] = \
            np.clip(np.array(ringm, "float32") * 1.28, 0, 1) if ringm is not None else bright
        arr[_ellipse_mask(w, h, c[0], c[1], R - 4, R - 4) & ~_ellipse_mask(w, h, c[0], c[1], R - 8, R - 8)] = \
            (np.array(ringm, "float32") if ringm is not None else base) * 0.62
        if front:
            # laurel wreath: fine paired leaf-dashes in two side arcs
            yy, xx = np.mgrid[0:h, 0:w].astype("float32")
            ang = np.arctan2(yy - c[1], xx - c[0])
            rr = np.hypot(xx - c[0], yy - c[1])
            deep = dark * 0.8
            side = (np.abs(np.cos(ang)) > 0.35)                 # leave top/bottom gaps
            leaf = ((np.floor((ang + np.pi) / (np.pi / 26)).astype("int32") % 2) == 0)
            arr[leaf & side & (rr > 96) & (rr < 104)] = deep
            arr[side & (rr > 106) & (rr < 108.5)] = deep        # binding rings
            arr[side & (rr > 91) & (rr < 93.5)] = deep
            draw_text(arr, label, int(c[0]), int(c[1]) - 10, 6 if len(label) < 2 else 5, tuple(dark * 0.72))
            draw_text(arr, "UNITS", int(c[0]), int(c[1]) + 44, 1, tuple(dark * 0.72))
            _stamp_golf_ball(arr, int(c[0]), int(c[1]) + 82, 14, tuple(bright), tuple(dark))
        else:
            _stamp_golfer(arr, int(c[0]) - 2, int(c[1]) - 2, 1.7, tuple(dark))
            arr[_seg_mask(w, h, c[0] - 56, c[1] + 38, c[0] + 56, c[1] + 38, 1.6)
                & _ellipse_mask(w, h, c[0], c[1], 100, 100)] = dark
            draw_text(arr, "FAIRHOLLOW", int(c[0]), int(c[1]) - 84, 1, tuple(dark))
            draw_text(arr, "GOLF CLUB", int(c[0]), int(c[1]) + 84, 1, tuple(dark))

    face(128, front=True)
    face(384, front=False)
    # reeded side band across the centre seam (v ~0.488..0.512)
    edge = np.array(ringm, "float32") if ringm is not None else base
    band = np.ones((12, w, 3), "float32") * edge * 0.86
    reed = ((np.arange(w) // 3) % 2 == 0)
    band[:, reed] = edge * 1.12
    arr[h // 2 - 6:h // 2 + 6] = np.clip(band, 0, 1)
    return np_image(f"Coin_{code}", arr)


def card_img(*, w=1024, h=1024):
    """The FAIRHOLLOW GOLF CLUB member card on the fictional LINKSPAY network.
    Navy field, gold crest and embossed-look numerals (pale glyph over a dark
    offset shadow).  Generic fake data only — original, non-real branding."""
    import numpy as np
    rng = np.random.default_rng(7)
    navy = np.array((0.032, 0.080, 0.205), "float32")
    arr = np.ones((h, w, 3), "float32") * navy
    arr *= (1.0 + (L._fbm(rng, w, h, 26, 26, 4)[..., None] - 0.5) * 0.08)
    gold = GOLD_INK
    pale = PALE_GOLD
    white = (0.80, 0.83, 0.86)
    shadow = tuple(navy * 0.42)
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    # ---- front (array rows 0..h/2 = v 0.5..1) ----
    sweep = (((xx + yy * 1.6) > 900) & ((xx + yy * 1.6) < 1240)) & (yy < h // 2)
    arr[sweep] *= 0.84                                          # diagonal satin band
    draw_text(arr, "FAIRHOLLOW", 44, 44, 4, gold, align="left")
    draw_text(arr, "GOLF CLUB", 44, 84, 2, pale, align="left")
    # crest top-right: double gold ring around a bold pennant
    for (r0, r1) in ((58, 52), (46, 43)):
        arr[_ellipse_mask(w, h, 924, 88, r0, r0) & ~_ellipse_mask(w, h, 924, 88, r1, r1)] = np.array(gold, "float32")
    arr[_seg_mask(w, h, 934, 58, 934, 120, 3.2)] = np.array(gold, "float32")
    pen = (yy > 58) & (yy < 92) & (xx < 934) & (xx > 934 - 1.15 * (yy - 54))
    arr[pen & _ellipse_mask(w, h, 924, 88, 43, 43)] = np.array(gold, "float32")
    # chip seat marker (the physical chip mesh sits over this)
    arr[104:216, 80:222] = navy * 0.72
    arr[104:108, 80:222] = np.array(gold, "float32") * 0.6
    arr[212:216, 80:222] = np.array(gold, "float32") * 0.6
    # contactless arcs beside the chip
    for r_ in (26, 42, 58):
        ring = _ellipse_mask(w, h, 292, 160, r_ + 5, r_ + 5) & ~_ellipse_mask(w, h, 292, 160, r_ - 3, r_ - 3)
        arr[ring & (xx >= 292) & (np.abs(yy - 160) < (r_ + 5) * 0.72)] = np.array(white, "float32")
    # embossed number: dark drop shadow first, pale-gold glyphs on top
    draw_text(arr, "1234 5678 9012 3456", w // 2 + 4, 325, 4, shadow)
    draw_text(arr, "1234 5678 9012 3456", w // 2, 320, 4, pale)
    draw_text(arr, "CLUB MEMBER", 46, 424, 3, shadow, align="left")
    draw_text(arr, "CLUB MEMBER", 43, 420, 3, pale, align="left")
    draw_text(arr, "VALID 12/28", 46, 468, 2, white, align="left")
    # fictional network mark, bottom right
    arr[_seg_mask(w, h, 856, 458, 876, 438, 5)] = np.array(gold, "float32")
    arr[_seg_mask(w, h, 876, 438, 896, 458, 5)] = np.array(gold, "float32")
    arr[_seg_mask(w, h, 856, 458, 876, 478, 5)] = np.array(gold, "float32")
    arr[_seg_mask(w, h, 876, 478, 896, 458, 5)] = np.array(gold, "float32")
    draw_text(arr, "LINKSPAY", 950, 458, 2, pale)
    # ---- back (array rows h/2..h = v 0..0.5) ----
    y0 = h // 2
    arr[y0 + 20:y0 + 24, 24:w - 24] = np.array(gold, "float32") * 0.7
    arr[y0 + 48:y0 + 144, :] = np.array((0.028, 0.032, 0.040), "float32")          # mag stripe
    arr[y0 + 196:y0 + 282, 60:w - 200] = np.array((0.74, 0.75, 0.77), "float32")   # signature
    for i in range(4):                                                              # security squiggle
        ys = y0 + 208 + i * 18
        arr[ys:ys + 3, 76:w - 216] = np.array((0.58, 0.59, 0.62), "float32")
    draw_text(arr, "123", w - 260, y0 + 240, 3, (0.09, 0.09, 0.11))
    draw_text(arr, "LINKSPAY", w // 2, y0 + 356, 3, gold)
    draw_text(arr, "FICTIONAL CLUB PAYMENT NETWORK", w // 2, y0 + 402, 1, white)
    draw_text(arr, "FAIRHOLLOW GOLF CLUB MEMBER SERVICES", w // 2, y0 + 440, 1, white)
    arr[y0 + 486:y0 + 490, 24:w - 24] = np.array(gold, "float32") * 0.7
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


def m_tex(name, img, *, rough=0.6, metal=0.0, ds=False, emit_img=False, estr=0.0, normal=None, normal_strength=1.0):
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
    if normal is not None:
        # baked tangent-space relief (glTF exports this as normalTexture)
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = normal
        tn.extension = "REPEAT"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
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
        "olive": m_tex("M_OlivePaper", olive_paper_img(), rough=0.82, ds=True),
        "olive_dark": m_flat("M_OliveDark", (0.030, 0.038, 0.017), rough=0.88, ds=True),
        "paper": m_flat("M_Paper", (0.86, 0.85, 0.80), rough=0.8, ds=True),
        "rope": m_flat("M_Rope", (0.135, 0.085, 0.045), rough=0.9),
        # counter finishes
        "oak_slat": m_tex("M_OakSlat", oakslat_img(), rough=0.52),
        "counter_black": m_tex("M_CounterBlack", plastic_img("CounterBlack", (0.014, 0.015, 0.017), seed=14, mottle=0.05), rough=0.34),
        "led_warm": m_flat("M_LedWarm", (1.0, 0.72, 0.38), rough=0.4, emit=(1.0, 0.72, 0.38), estr=3.0),
        "glass_black": m_flat("M_GlassBlack", (0.010, 0.012, 0.015), rough=0.08),
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
        "source": "Original Fairhollow Golf Club asset, modelled in-repository (no external/AI meshes)",
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
    # idempotent: drop any rig a previous render of this scene left behind
    for o in list(bpy.data.objects):
        if o.name.split(".")[0] in ("PreviewFloor", "Key", "Fill", "Rim", "Soft", "Cam"):
            bpy.data.objects.remove(o, do_unlink=True)
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
