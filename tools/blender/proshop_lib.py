"""Shared library for the Prime Fairways pro-shop retail asset kit.

Everything in assets/pro_shop is built through this module.  It layers on top of
lib_props (geometry / wood / export core) and adds:

  * retail texture generators (fabrics, leathers, carbon, chrome, board stock)
  * a bitmap-text + shape drawing kit for original PF packaging art
  * placement-socket helpers with the manifest property contract
  * per-asset manifest fragments (id, dims, tris, textures, sockets)
  * batch runner: one Blender session builds many assets

Convention: X width, Y depth (-Y = front/player side), Z up, metres, base Z=0.

Run any builder:
  "<blender>" --background --factory-startup --python tools/blender/build_pf_<x>.py -- all render
"""

from __future__ import annotations

import json
import math
import sys
import traceback
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_props as L

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
KIT = ROOT / "assets" / "pro_shop"
SOURCE_DIR = KIT / "source"
GLB_DIR = KIT / "glb"
TEX_DIR = KIT / "textures"
PREVIEW_DIR = KIT / "previews"
MANIFEST_DIR = KIT / "manifests"
FRAGMENT_DIR = MANIFEST_DIR / "fragments"

BUILD_VERSION = 1
STD = json.loads((MANIFEST_DIR / "scale_standards.json").read_text())

PF_NAVY = (0.026, 0.040, 0.075)
PF_CREAM = (0.82, 0.77, 0.63)
PF_SAGE = (0.315, 0.385, 0.280)
PF_CHARCOAL = (0.048, 0.052, 0.058)
PF_GREEN = (0.022, 0.088, 0.048)
PF_GOLD = (0.60, 0.44, 0.16)
PF_KRAFT = (0.28, 0.165, 0.085)
PF_BOARD = (0.86, 0.845, 0.79)
INK = (0.055, 0.06, 0.055)


def reset_scene():
    L.reset_scene()
    _NRM_CACHE.clear()   # image datablocks die with the old scene
    sc = bpy.context.scene
    sc["asset_build_script"] = "tools/blender/proshop_lib.py"
    sc["asset_build_version"] = BUILD_VERSION


# ============================================================ 2D drawing kit ====
# 5x7 bitmap font (superset of the checkout kit's) — stylized retail print.

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
    ",": ["00000", "00000", "00000", "00000", "00110", "00110", "01000"],
    ":": ["00000", "00110", "00110", "00000", "00110", "00110", "00000"],
    "'": ["00110", "00110", "00100", "00000", "00000", "00000", "00000"],
    "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
    "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
    "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
    ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
    "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
    "*": ["00000", "10101", "01110", "11111", "01110", "10101", "00000"],
    "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
    "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
    "°": ["01100", "10010", "01100", "00000", "00000", "00000", "00000"],
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
}


def text_w(text, px):
    return 6 * px * len(text) - px


def _cell(arr, xa, ya, xb, yb, col, s):
    """One glyph cell: filled rect + rounded corner discs so strokes read smooth."""
    import numpy as np
    h, w = arr.shape[:2]
    r = max(1, int((xb - xa) * 0.34))
    x0, x1 = max(0, int(xa - r * 0.2)), min(w, int(xb + r * 0.2))
    y0, y1 = max(0, int(ya - r * 0.2)), min(h, int(yb + r * 0.2))
    if x1 <= x0 or y1 <= y0:
        return
    if s <= 1:
        arr[max(0, int(ya)):min(h, int(yb)), max(0, int(xa)):min(w, int(xb))] = np.array(col, "float32")
        return
    yy, xx = np.mgrid[y0:y1, x0:x1].astype("float32")
    cxm = np.clip(xx, xa + r, xb - r)
    cym = np.clip(yy, ya + r, yb - r)
    m = ((xx - cxm) ** 2 + (yy - cym) ** 2) <= (r * 1.25) ** 2
    sub = arr[y0:y1, x0:x1]
    sub[m] = np.array(col, "float32")


def draw_text(arr, text, cx, cy, px, rgb, *, align="center"):
    """Stamp 5x7 grid text (rounded strokes on supersampled canvases)."""
    s = _ss(arr)
    text = text.upper()
    px = px * s
    cx, cy = cx * s, cy * s
    gw, gh = 6 * px, 7 * px
    total_w = gw * len(text) - px
    if align == "center":
        x0 = cx - total_w / 2
    elif align == "right":
        x0 = cx - total_w
    else:
        x0 = cx
    y0 = cy - gh / 2
    for gi, ch in enumerate(text):
        glyph = _F.get(ch)
        if glyph is None:
            continue
        gx = x0 + gi * gw
        for r in range(7):
            for c in range(5):
                if glyph[r][c] == "1":
                    _cell(arr, gx + c * px, y0 + r * px, gx + (c + 1) * px, y0 + (r + 1) * px, rgb, s)
    return arr


def rect(arr, x0, y0, x1, y1, rgb):
    import numpy as np
    s = _ss(arr)
    h, w = arr.shape[:2]
    x0, x1 = max(0, int(x0 * s)), min(w, int(x1 * s))
    y0, y1 = max(0, int(y0 * s)), min(h, int(y1 * s))
    if x1 > x0 and y1 > y0:
        arr[y0:y1, x0:x1] = np.array(rgb, "float32")
    return arr


def frame(arr, x0, y0, x1, y1, t, rgb):
    rect(arr, x0, y0, x1, y0 + t, rgb)
    rect(arr, x0, y1 - t, x1, y1, rgb)
    rect(arr, x0, y0, x0 + t, y1, rgb)
    rect(arr, x1 - t, y0, x1, y1, rgb)
    return arr


def ellipse_mask(w, h, cx, cy, rx, ry):
    import numpy as np
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    return ((xx - cx) / max(rx, 1e-6)) ** 2 + ((yy - cy) / max(ry, 1e-6)) ** 2 <= 1.0


def disc(arr, cx, cy, rx, ry, rgb):
    import numpy as np
    s = _ss(arr)
    h, w = arr.shape[:2]
    arr[ellipse_mask(w, h, cx * s, cy * s, rx * s, ry * s)] = np.array(rgb, "float32")
    return arr


def ring(arr, cx, cy, rx, ry, t, rgb):
    import numpy as np
    s = _ss(arr)
    h, w = arr.shape[:2]
    m = ellipse_mask(w, h, cx * s, cy * s, rx * s, ry * s) & ~ellipse_mask(w, h, cx * s, cy * s, (rx - t) * s, (ry - t) * s)
    arr[m] = np.array(rgb, "float32")
    return arr


def tri(arr, p0, p1, p2, rgb):
    """Filled triangle (small, loop-free barycentric fill)."""
    import numpy as np
    s = _ss(arr)
    p0 = (p0[0] * s, p0[1] * s)
    p1 = (p1[0] * s, p1[1] * s)
    p2 = (p2[0] * s, p2[1] * s)
    h, w = arr.shape[:2]
    xs = [p0[0], p1[0], p2[0]]
    ys = [p0[1], p1[1], p2[1]]
    x0, x1 = max(0, int(min(xs))), min(w, int(max(xs)) + 1)
    y0, y1 = max(0, int(min(ys))), min(h, int(max(ys)) + 1)
    if x1 <= x0 or y1 <= y0:
        return arr
    yy, xx = np.mgrid[y0:y1, x0:x1].astype("float32")
    def edge(a, b):
        return (xx - a[0]) * (b[1] - a[1]) - (yy - a[1]) * (b[0] - a[0])
    e0, e1, e2 = edge(p0, p1), edge(p1, p2), edge(p2, p0)
    m = ((e0 >= 0) & (e1 >= 0) & (e2 >= 0)) | ((e0 <= 0) & (e1 <= 0) & (e2 <= 0))
    sub = arr[y0:y1, x0:x1]
    sub[m] = np.array(rgb, "float32")
    return arr


def barcode(arr, x0, y0, x1, y1, *, seed=3, digits="8 50026 73841 7"):
    import numpy as np
    rng = np.random.default_rng(seed)
    rect(arr, x0, y0, x1, y1, (0.88, 0.88, 0.86))
    x = x0 + 8
    while x < x1 - 10:
        bw = int(rng.integers(2, 6))
        if rng.random() > 0.42:
            rect(arr, x, y0 + 6, x + bw, y1 - 16, (0.05, 0.05, 0.05))
        x += bw + int(rng.integers(2, 4))
    draw_text(arr, digits, (x0 + x1) // 2, y1 - 9, 1, (0.05, 0.05, 0.05))
    return arr


def vgrad(arr, x0, y0, x1, y1, top_rgb, bot_rgb):
    """Vertical gradient fill — soft premium panels instead of flat colour."""
    import numpy as np
    s = _ss(arr)
    h, w = arr.shape[:2]
    xa, xb = max(0, int(x0 * s)), min(w, int(x1 * s))
    ya, yb = max(0, int(y0 * s)), min(h, int(y1 * s))
    if xb <= xa or yb <= ya:
        return arr
    t = np.linspace(0, 1, yb - ya, dtype="float32")[:, None, None]
    a = np.array(top_rgb, "float32")[None, None, :]
    b = np.array(bot_rgb, "float32")[None, None, :]
    arr[ya:yb, xa:xb] = a * (1 - t) + b * t
    return arr


def vignette(arr, amount=0.16):
    """Radial darkening toward corners — makes flat print read as lit/soft."""
    import numpy as np
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    d = (((xx / w) - 0.5) ** 2 + ((yy / h) - 0.5) ** 2) * 2.4
    a = np.asarray(arr)
    a *= (1.0 - amount * np.clip(d, 0, 1))[..., None]
    return arr


# ============================================================== np textures =====

def _ss(arr):
    return int(getattr(arr, "ss", 1))


def canvas(base, w, h, *, ss=3, mottle=0.04, seed=3, cells=14):
    """A supersampled drawing canvas: author with FINAL-resolution coordinates;
    every drawing op scales internally and np_image box-downsamples -> crisp
    anti-aliased print instead of jagged pixels."""
    import numpy as np
    arr = base_arr(base, w * ss, h * ss, mottle=mottle, seed=seed, cells=cells)
    c = arr.view(type("Canvas", (np.ndarray,), {}))
    c.ss = ss
    return c


def wrap_canvas(arr, ss=3):
    """Tag an externally-generated (already ss-scaled) array as a canvas."""
    import numpy as np
    c = np.ascontiguousarray(arr).view(type("Canvas", (np.ndarray,), {}))
    c.ss = ss
    return c


def downsample(arr, f):
    import numpy as np
    a = np.asarray(arr, dtype="float32")
    h, w = a.shape[:2]
    h2, w2 = (h // f) * f, (w // f) * f
    a = a[:h2, :w2]
    return a.reshape(h2 // f, f, w2 // f, f, a.shape[2]).mean(axis=(1, 3))


def np_image(name, arr, *, dump=True, data=False):
    """float32 HxWx3 LINEAR, top-down -> packed image (+ PNG dump).
    Supersampled canvases are box-filtered down.  data=True stores Non-Color
    (normal/roughness/metallic maps) without the sRGB encode."""
    import numpy as np
    f = _ss(arr)
    if f > 1:
        arr = downsample(arr, f)
    arr = np.asarray(arr, dtype="float32")
    h, w = arr.shape[:2]
    img = L._img(name, w, h)
    img.colorspace_settings.name = "Non-Color" if data else "sRGB"   # BEFORE pixels
    body = np.clip(arr[::-1], 0, 1)
    if not data:
        body = L.lin2srgb(body)
    rgba = np.concatenate([body, np.ones((h, w, 1), "float32")], axis=2)
    img.pixels[:] = rgba.ravel().tolist()
    img.update()
    img.pack()
    if dump:
        try:
            TEX_DIR.mkdir(parents=True, exist_ok=True)
            dup = img.copy()
            dup.filepath_raw = str(TEX_DIR / f"{name}.png")
            dup.file_format = "PNG"
            dup.save()
            bpy.data.images.remove(dup)
        except Exception:
            pass
    return img


def height_to_normal(hgt, *, strength=1.0):
    """Top-down height field -> OpenGL-convention tangent normal map array."""
    import numpy as np
    a = np.asarray(hgt, dtype="float32")
    gy, gx = np.gradient(a)
    nx = -gx * strength
    ny = gy * strength          # v runs opposite to array rows
    nz = np.ones_like(a)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln, ny / ln, nz / ln], axis=2) * 0.5 + 0.5


def noise_field(w, h, *, seed=3, cells=14, octaves=5):
    import numpy as np
    rng = np.random.default_rng(seed)
    return L._fbm(rng, w, h, cells, cells, octaves)


def base_arr(base, w, h, *, mottle=0.05, seed=3, cells=14):
    import numpy as np
    b = np.array(base, "float32")
    f = (noise_field(w, h, seed=seed, cells=cells) - 0.5) * (mottle * 2)
    rng = np.random.default_rng(seed + 1)
    micro = (rng.random((h, w)).astype("float32") - 0.5) * 0.02
    return np.clip(b[None, None, :] * (1.0 + f + micro)[..., None], 0, 1)


def fabric_arr(base, w=512, h=512, *, kind="pique", seed=5):
    """Cloth albedo: pique (dot grid), knit (fine courses), fleece (soft),
    twill (diagonal), canvas (cross weave), ripstop (grid)."""
    import numpy as np
    b = np.array(base, "float32")
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    if kind == "pique":
        cell = 6.0
        px_, py_ = (xx % cell) / cell - 0.5, (yy % cell) / cell - 0.5
        dot = np.clip(1.0 - (px_ ** 2 + py_ ** 2) * 9.0, 0, 1)
        tex = 1.0 - dot * 0.16
        odd = ((yy // cell) % 2).astype(bool)
        tex2 = np.where(odd, np.roll(tex, int(cell / 2), axis=1), tex)
        field = tex2
    elif kind == "knit":
        field = 1.0 - 0.10 * (0.5 + 0.5 * np.sin(yy * (2 * np.pi / 4.0)))
        field *= 1.0 - 0.05 * (0.5 + 0.5 * np.sin(xx * (2 * np.pi / 9.0) + np.sin(yy * 0.7)))
    elif kind == "fleece":
        field = 1.0 + (L._fbm(rng, w, h, 40, 40, 5) - 0.5) * 0.14
    elif kind == "twill":
        diag = ((xx + yy * 2.0) % 8.0) / 8.0
        field = 1.0 - 0.12 * np.clip(1.0 - abs(diag - 0.5) * 4.0, 0, 1)
    elif kind == "canvas":
        field = 1.0 - 0.10 * (0.5 + 0.5 * np.sin(xx * (2 * np.pi / 6.0)))
        field *= 1.0 - 0.10 * (0.5 + 0.5 * np.sin(yy * (2 * np.pi / 6.0)))
    elif kind == "ripstop":
        g = ((xx % 24) < 1.6) | ((yy % 24) < 1.6)
        field = np.where(g, 0.93, 1.0)
        field = field * (1.0 + (L._fbm(rng, w, h, 30, 30, 4) - 0.5) * 0.05)
    else:
        field = np.ones((h, w), "float32")
    drift = 1.0 + (L._fbm(rng, w, h, 5, 5, 4) - 0.5) * 0.10
    return np.clip(b[None, None, :] * (field * drift)[..., None], 0, 1)


def fabric_img(name, base, *, kind="pique", seed=5, w=512, h=512):
    return np_image(name, fabric_arr(base, w, h, kind=kind, seed=seed))


def leather_arr(base, w=512, h=512, *, seed=9, pebble=0.10):
    import numpy as np
    b = np.array(base, "float32")
    rng = np.random.default_rng(seed)
    peb = (L._fbm(rng, w, h, 70, 70, 4) - 0.5) * pebble
    pore = (rng.random((h, w)).astype("float32") - 0.5) * 0.04
    drift = (L._fbm(rng, w, h, 6, 6, 4) - 0.5) * 0.08
    return np.clip(b[None, None, :] * (1.0 + peb + pore + drift)[..., None], 0, 1)


def carbon_img(name="CarbonWeave", *, w=512, h=512, seed=3):
    """2x2 twill carbon-fibre weave for club crowns (dark, subtle)."""
    import numpy as np
    yy, xx = np.mgrid[0:h, 0:w]
    cw = 16
    tow = (((xx // cw) + (yy // cw)) % 2).astype("float32")
    along_x = 0.5 + 0.5 * np.sin((xx % cw) / cw * np.pi)
    along_y = 0.5 + 0.5 * np.sin((yy % cw) / cw * np.pi)
    sheen = np.where(tow > 0.5, along_x, along_y).astype("float32")
    base = 0.012 + sheen * 0.03
    rng = np.random.default_rng(seed)
    base = base * (1.0 + (L._fbm(rng, w, h, 8, 8, 3) - 0.5) * 0.2)
    arr = np.stack([base * 0.95, base * 1.0, base * 1.08], axis=2).astype("float32")
    return np_image(name, np.clip(arr, 0, 1))


def board_img(name, base=PF_BOARD, *, seed=15, w=512, h=512):
    """Smooth premium retail board with the faintest fibre."""
    import numpy as np
    rng = np.random.default_rng(seed)
    b = np.array(base, "float32")
    fib = (L._fbm(rng, w, h, 50, 8, 4) - 0.5) * 0.035
    arr = np.clip(b[None, None, :] * (1.0 + fib)[..., None], 0, 1)
    return np_image(name, arr)


def kraft_arr(w=512, h=512, *, seed=11, base=PF_KRAFT):
    import numpy as np
    rng = np.random.default_rng(seed)
    b = np.array(base, "float32")
    fib = (L._fbm(rng, w, h, 60, 6, 4) - 0.5) * 0.14
    mott = (L._fbm(rng, w, h, 9, 9, 5) - 0.5) * 0.12
    fleck = (rng.random((h, w)).astype("float32") > 0.9985).astype("float32") * 0.18
    return np.clip(b[None, None, :] * (1.0 + fib + mott)[..., None] + fleck[..., None] * 0.3, 0, 1)


# ======================================================== detail-map generators ==

def fabric_height(kind, w=512, h=512, *, seed=5):
    """Height field matching fabric_arr's weaves, for normal maps."""
    import numpy as np
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    if kind == "pique":
        cell = 6.0
        px_, py_ = (xx % cell) / cell - 0.5, (yy % cell) / cell - 0.5
        hgt = np.clip(1.0 - (px_ ** 2 + py_ ** 2) * 9.0, 0, 1)
        odd = ((yy // cell) % 2).astype(bool)
        hgt = np.where(odd, np.roll(hgt, int(cell / 2), axis=1), hgt)
    elif kind == "knit":
        hgt = 0.5 + 0.5 * np.sin(yy * (2 * np.pi / 4.0))
        hgt = hgt * 0.7 + 0.3 * (0.5 + 0.5 * np.sin(xx * (2 * np.pi / 9.0) + np.sin(yy * 0.7)))
    elif kind == "twill":
        diag = ((xx + yy * 2.0) % 8.0) / 8.0
        hgt = np.clip(1.0 - abs(diag - 0.5) * 4.0, 0, 1)
    elif kind == "canvas":
        hgt = (0.5 + 0.5 * np.sin(xx * (2 * np.pi / 6.0))) * (0.5 + 0.5 * np.sin(yy * (2 * np.pi / 6.0)))
    elif kind == "ripstop":
        g = ((xx % 24) < 2.0) | ((yy % 24) < 2.0)
        hgt = np.where(g, 1.0, 0.4) * (0.7 + 0.3 * np.sin(xx * (2 * np.pi / 3.0)))
    elif kind == "fleece":
        hgt = L._fbm(rng, w, h, 60, 60, 5)
    elif kind == "leather":
        hgt = L._fbm(rng, w, h, 70, 70, 4)
    elif kind == "dimple":
        cell = 26.0
        ox = np.where(((yy // cell) % 2) > 0.5, cell / 2, 0.0)
        px_ = ((xx + ox) % cell) / cell - 0.5
        py_ = (yy % cell) / cell - 0.5
        hgt = -np.clip(1.0 - (px_ ** 2 + py_ ** 2) * 9.0, 0, 1)
    elif kind == "flute":       # vertical bottle flutes
        hgt = 0.5 + 0.5 * np.sin(xx * (2 * np.pi / 42.0))
    elif kind == "rib":         # horizontal grip ribs
        hgt = 0.5 + 0.5 * np.sin(yy * (2 * np.pi / 14.0))
    elif kind == "knurl":
        hgt = (0.5 + 0.5 * np.sin((xx + yy) * (2 * np.pi / 9.0))) * (0.5 + 0.5 * np.sin((xx - yy) * (2 * np.pi / 9.0)))
    elif kind == "wood":
        v = np.linspace(0, 1, h, dtype="float32")[:, None] * np.ones((1, w), "float32")
        warp = (L._fbm(rng, w, h, 6, 2, 4) - 0.5) * 0.10
        hgt = 0.5 - 0.5 * np.cos((v * 8.5 + warp) * 2 * np.pi)
        hgt = hgt * 0.5 + L._fbm(rng, w, h, 9, 200, 4) * 0.5
    elif kind == "crinkle":     # foil / wrapper crinkle
        hgt = L._fbm(rng, w, h, 26, 26, 6)
    else:
        hgt = np.zeros((h, w), "float32")
    return hgt


_NRM_CACHE = {}


def nrm_img(kind, *, strength=1.4, w=512, h=512, seed=5):
    key = f"NRM_{kind}_{strength}_{w}"
    if key in _NRM_CACHE:
        return _NRM_CACHE[key]
    img = np_image(key, height_to_normal(fabric_height(kind, w, h, seed=seed), strength=strength), data=True, dump=False)
    _NRM_CACHE[key] = img
    return img


def rough_img_from(kind, base=0.55, amp=0.25, *, w=256, h=256, seed=9):
    import numpy as np
    hgt = fabric_height(kind, w, h, seed=seed)
    r = np.clip(base + (hgt - hgt.mean()) * amp, 0.05, 0.98)
    return np_image(f"RGH_{kind}_{base}", np.stack([r, r, r], axis=2), data=True, dump=False)


# ================================================================= materials =====

def m_flat(name, rgb, *, rough=0.6, metal=0.0, alpha=1.0, emit=None, estr=0.0, ds=False):
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


def m_tex(name, img, *, rough=0.6, metal=0.0, ds=False, normal=None, nstr=1.0,
          rough_img=None, metal_img=None, coat=0.0, uvscale=None):
    """Textured PBR material.  normal/rough_img/metal_img take Non-Color images
    (np_image(..., data=True)); coat adds a clearcoat (glTF KHR clearcoat)."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    mapping = None
    if uvscale:
        uvn = nt.nodes.new("ShaderNodeTexCoord")
        mapping = nt.nodes.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = (uvscale, uvscale, 1)
        nt.links.new(uvn.outputs["UV"], mapping.inputs["Vector"])

    def tex_node(image, noncolor=False):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = image
        t.extension = "REPEAT"
        if mapping is not None:
            nt.links.new(mapping.outputs["Vector"], t.inputs["Vector"])
        return t

    t = tex_node(img)
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    if normal is not None:
        tn = tex_node(normal, noncolor=True)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = nstr
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    if rough_img is not None:
        tr = tex_node(rough_img, noncolor=True)
        nt.links.new(tr.outputs["Color"], b.inputs["Roughness"])
    if metal_img is not None:
        tm = tex_node(metal_img, noncolor=True)
        nt.links.new(tm.outputs["Color"], b.inputs["Metallic"])
    if coat > 0:
        for sock in ("Coat Weight", "Clearcoat"):
            if b.inputs.get(sock):
                b.inputs[sock].default_value = coat
                break
    if ds:
        m.use_backface_culling = False
    return m


def fabric_mat(name, base, kind, *, rough=0.7, nstr=1.2, seed=5, ds=False):
    """One-call cloth/leather material: matching albedo + normal + roughness maps."""
    if kind == "leather":
        alb = np_image(f"{name}_alb", leather_arr(base, 512, 512, seed=seed, pebble=0.12))
    else:
        alb = np_image(f"{name}_alb", fabric_arr(base, 512, 512, kind=kind, seed=seed))
    return m_tex(name, alb, rough=rough, normal=nrm_img(kind, strength=nstr),
                 rough_img=rough_img_from(kind, base=rough, amp=0.18), ds=ds)


def pf_materials():
    """Structural + hard-goods palette shared by every pro-shop asset."""
    M = {
        "walnut": m_tex("M_PSWalnut", L.wood_image("PSWalnut", "walnut"), rough=0.38,
                        normal=nrm_img("wood", strength=0.7), coat=0.25),
        "oak": m_tex("M_PSOak", L.wood_image("PSOak", "oak"), rough=0.42,
                     normal=nrm_img("wood", strength=0.6), coat=0.2),
        "black": m_tex("M_PSBlackSteel", np_image("PSBlackSteel", base_arr((0.016, 0.017, 0.019), 512, 512, seed=8, mottle=0.04)), rough=0.42, metal=0.35),
        "charcoal": m_tex("M_PSCharcoal", np_image("PSCharcoal", base_arr(PF_CHARCOAL, 512, 512, seed=5)), rough=0.5,
                          normal=nrm_img("leather", strength=0.35)),
        "steel": m_flat("M_PSSteel", (0.34, 0.35, 0.37), rough=0.35, metal=0.85),
        "chrome": m_flat("M_PSChrome", (0.62, 0.64, 0.67), rough=0.12, metal=1.0),
        "satin": m_tex("M_PSSatin", np_image("PSSatinAlb", base_arr((0.44, 0.46, 0.49), 256, 256, seed=41, mottle=0.02)), rough=0.30, metal=0.9,
                       normal=nrm_img("crinkle", strength=0.12)),
        "brass": m_flat("M_PSBrass", (0.58, 0.42, 0.15), rough=0.28, metal=0.92),
        "gold": m_flat("M_PSGold", (0.74, 0.58, 0.24), rough=0.20, metal=0.95),
        "green": m_flat("M_PSGreen", PF_GREEN, rough=0.5),
        "green_felt": m_tex("M_PSGreenFelt", np_image("PSGreenFeltAlb", base_arr((0.045, 0.130, 0.085), 256, 256, seed=43, mottle=0.05)), rough=0.85,
                            normal=nrm_img("fleece", strength=0.8)),
        "cream": m_flat("M_PSCream", (0.62, 0.575, 0.47), rough=0.55),
        "navy": m_flat("M_PSNavy", PF_NAVY, rough=0.55),
        "sage": m_flat("M_PSSage", (0.135, 0.190, 0.135), rough=0.6),
        "rubber": m_flat("M_PSRubber", (0.018, 0.019, 0.021), rough=0.88),
        "grip_rubber": m_tex("M_PSGrip", np_image("PSGripRubber", base_arr((0.020, 0.021, 0.023), 256, 256, seed=21, mottle=0.10)), rough=0.82,
                             normal=nrm_img("rib", strength=1.6), uvscale=3.0),
        "carbon": m_tex("M_PSCarbon", carbon_img(), rough=0.22, metal=0.3, coat=0.8,
                        normal=nrm_img("knurl", strength=0.15)),
        "glass": m_flat("M_PSLensGlass", (0.06, 0.10, 0.16), rough=0.05, metal=0.0),
        "lens_blue": m_flat("M_PSLensBlue", (0.10, 0.16, 0.34), rough=0.06, metal=0.3),
        "kraft": m_tex("M_PSKraft", np_image("PSKraft", kraft_arr()), rough=0.78,
                       normal=nrm_img("canvas", strength=0.25)),
        "board": m_tex("M_PSBoard", board_img("PSBoard"), rough=0.6),
        "paper": m_flat("M_PSPaper", (0.86, 0.85, 0.80), rough=0.8, ds=True),
        "emissive_warm": m_flat("M_PSLamp", (0.9, 0.78, 0.55), rough=0.4, emit=(1.0, 0.82, 0.55), estr=3.0),
        "collision": m_flat("M_Collision", (1.0, 0.0, 1.0), rough=1.0, alpha=0.0),
    }
    return M


# ================================================================== geometry =====

def uv_plane(name, w, h, loc, mat, *, rot=(0, 0, 0), parent=None, uv=(0, 0, 1, 1)):
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in ((-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2))]
    f = bm.faces.new(v)
    f.normal_update()
    if f.normal.y > 0:
        bmesh.ops.reverse_faces(bm, faces=[f])
    layer = bm.loops.layers.uv.new("UVMap")
    u0, v0, u1, v1 = uv
    for loop, c in zip(f.loops, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]):
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
    """Box with explicit per-face UV rects: {'-Y':(u0,v0,u1,v1), '+Y','-X','+X','+Z','-Z'}."""
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
            axes = (0, 2)
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


def lathe(name, profile, loc, mat, *, steps=28, parent=None, rot=(0, 0, 0), smooth=52, uv=True, scale_y=1.0, angle=2 * math.pi):
    """Revolve an (r, z) profile around +Z.  Profile bottom-to-top; r=0 endpoints
    close the shape.  scale_y squashes the result for oval bodies; angle < 2pi
    makes a partial revolve (visor brims, arches)."""
    bm = bmesh.new()
    verts = [bm.verts.new((max(r, 0.0), 0, z)) for r, z in profile]
    for i in range(len(verts) - 1):
        bm.edges.new((verts[i], verts[i + 1]))
    bmesh.ops.spin(bm, geom=list(bm.verts) + list(bm.edges), cent=(0, 0, 0), axis=(0, 0, 1),
                   angle=angle, steps=steps, use_merge=(angle >= 2 * math.pi - 1e-6))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    holes = [e for e in bm.edges if e.is_boundary]
    if holes:
        bmesh.ops.holes_fill(bm, edges=holes)
    if scale_y != 1.0:
        for v in bm.verts:
            v.co.y *= scale_y
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.rotation_euler = rot
    o.location = loc
    L._finish(o, mat, bevel=0.0, uv=uv, smooth=smooth)
    L.parent_keep(o, parent)
    return o


def pillow(name, dims, loc, mat, *, round_frac=0.42, segments=3, parent=None, rot=(0, 0, 0), uv=True):
    """A soft-rounded box (all 12 edges beveled) — folded garments, cushions, grips."""
    w, d, h = dims
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= w
        v.co.y *= d
        v.co.z *= h
    r = min(w, d, h) * 0.5 * min(round_frac, 0.96)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=r, segments=segments, profile=0.5, affect="EDGES")
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.rotation_euler = rot
    o.location = loc
    L._finish(o, mat, bevel=0.0, uv=uv, smooth=60)
    L.parent_keep(o, parent)
    return o


def loft(name, sections, loc, mat, *, parent=None, rot=(0, 0, 0), ring=16, smooth=55, uv=True, cap=True, plane="xz"):
    """Skin a chain of oval cross-sections into a closed hull (shoes, bags,
    club heads, garment volumes).  Each section: (cx, cy, cz, r1, r2).
    plane='xz': rings span X/Z (chain along Y).  plane='yz': rings span Y/Z
    (chain along X)."""
    bm = bmesh.new()
    rings = []
    for (cx, cy, cz, r1, r2) in sections:
        ringv = []
        for i in range(ring):
            a = 2 * math.pi * i / ring
            if plane == "xz":
                ringv.append(bm.verts.new((cx + math.cos(a) * r1, cy, cz + math.sin(a) * r2)))
            elif plane == "xy":
                ringv.append(bm.verts.new((cx + math.cos(a) * r1, cy + math.sin(a) * r2, cz)))
            else:
                ringv.append(bm.verts.new((cx, cy + math.cos(a) * r1, cz + math.sin(a) * r2)))
        rings.append(ringv)
    for a, b in zip(rings, rings[1:]):
        for i in range(ring):
            bm.faces.new((a[i], a[(i + 1) % ring], b[(i + 1) % ring], b[i]))
    if cap:
        bm.faces.new(tuple(reversed(rings[0])))
        bm.faces.new(tuple(rings[-1]))
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.rotation_euler = rot
    o.location = loc
    L._finish(o, mat, bevel=0.0, uv=uv, smooth=smooth)
    L.parent_keep(o, parent)
    return o


def tube_path(name, points, radius, mat, *, parent=None, verts=10, smooth=60):
    """A round tube swept along a polyline (hooks, hanger wires, rails, handles)."""
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    sp = curve.splines.new("POLY")
    sp.points.add(len(points) - 1)
    for p, pt in zip(sp.points, points):
        p.co = (pt[0], pt[1], pt[2], 1.0)
    curve.bevel_depth = radius
    curve.bevel_resolution = max(1, verts // 4)
    curve.use_fill_caps = True
    o = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(o)
    L.activate(o)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    o.name = name
    L._finish(o, mat, bevel=0.0, uv=False, smooth=smooth)
    L.parent_keep(o, parent)
    return o


def smooth_wire(pts, n=24):
    """Catmull-Rom smooth of a polyline (for tube_path inputs)."""
    if len(pts) < 3:
        return pts
    P = [Vector(p) for p in pts]
    P = [P[0]] + P + [P[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        steps = max(2, n // (len(P) - 3))
        for t in [j / steps for j in range(steps)]:
            t2, t3 = t * t, t * t * t
            v = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            out.append(tuple(v))
    out.append(tuple(P[-2]))
    return out


def window_panel(prefix, W, H, T, win, atlas_mat, region, parent, *, y=0.0):
    """A W x H x T front panel with a rectangular window hole, built from 4 strips
    whose UVs sample the matching sub-rects of `region`=(u0,v0,u1,v1)."""
    u0, v0, u1, v1 = region
    wx0, wz0, wx1, wz1 = win  # window rect in panel coords (origin bottom-left)

    def sub(px0, pz0, px1, pz1, tag):
        cw, ch = px1 - px0, pz1 - pz0
        if cw <= 0.001 or ch <= 0.001:
            return
        uu0 = u0 + (u1 - u0) * (px0 / W)
        uu1 = u0 + (u1 - u0) * (px1 / W)
        vv0 = v0 + (v1 - v0) * (pz0 / H)
        vv1 = v0 + (v1 - v0) * (pz1 / H)
        uv_box(f"{prefix}_{tag}", (cw, T, ch), (px0 + cw / 2 - W / 2, y, pz0 + ch / 2), atlas_mat,
               parent=parent, face_uv={"-Y": (uu0, vv0, uu1, vv1), "+Y": (uu0, vv0, uu1, vv1),
                                       "-X": (uu0, vv0, uu0 + 0.001, vv1), "+X": (uu1 - 0.001, vv0, uu1, vv1),
                                       "+Z": (uu0, vv1 - 0.001, uu1, vv1), "-Z": (uu0, vv0, uu1, vv0 + 0.001)})
    sub(0, 0, W, wz0, "botstrip")
    sub(0, wz1, W, H, "topstrip")
    sub(0, wz0, wx0, wz1, "lstrip")
    sub(wx1, wz0, W, wz1, "rstrip")


def boolean_cut(target, cutter):
    """DIFFERENCE with material safety (assign before apply; re-index after)."""
    L.activate(target)
    md = target.modifiers.new("cut", "BOOLEAN")
    md.operation = "DIFFERENCE"
    md.object = cutter
    md.solver = "EXACT"
    L.activate(target)
    bpy.ops.object.modifier_apply(modifier=md.name)
    for p in target.data.polygons:
        p.material_index = 0
    bpy.data.objects.remove(cutter, do_unlink=True)
    return target


# ============================================================ sockets / props ====

def asset_root(asset_id, dims, *, category, kind="product", extra=None):
    props = {
        "asset_id": asset_id, "asset_version": BUILD_VERSION, "units": "meters",
        "front": "-Y (player side)", "target_dimensions_m": list(dims),
        "pf_kind": kind, "pf_category": category,
        "source": "Original Prime Fairways asset generated in-repository",
        "license": "Project-owned / UNLICENSED",
    }
    props.update(extra or {})
    return L.empty(asset_id, props=props)


def socket(name, loc, parent, *, rot=(0, 0, 0), props=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.empty_display_type = "ARROWS"
    o.empty_display_size = 0.05
    o.location = loc
    o.rotation_euler = rot
    if parent is not None:
        o.parent = parent
    for k, v in (props or {}).items():
        o[k] = v
    return o


def slot(name, loc, parent, *, rot=(0, 0, 0), slot_type, accepts, max_dims, forward="-Y"):
    """A fixture placement slot.  max_dims = (w, d, h) capacity at scale 1."""
    return socket(name, loc, parent, rot=rot, props={
        "slot": True, "slot_type": slot_type, "accepts": ",".join(accepts),
        "max_w": round(max_dims[0], 4), "max_d": round(max_dims[1], 4), "max_h": round(max_dims[2], 4),
        "forward": forward,
    })


def product_sockets(root, *, pickup, anchor=None, barcode=None, hang=None):
    socket("PICKUP_SOCKET", pickup, root, props={"socket": "pickup"})
    socket("SHELF_ANCHOR", anchor or (0, 0, 0), root, props={"socket": "shelf_anchor"})
    if barcode:
        socket("BARCODE_AREA", barcode, root, props={"socket": "barcode"})
    if hang:
        socket("HANG_POINT", hang, root, props={"socket": "hang"})


def collision_box(name, dims, loc, M, parent):
    o = L.box(name, dims, loc, M["collision"], bevel=0.0, parent=parent, uv=False)
    o["collision_proxy"] = True
    o.display_type = "WIRE"
    o.hide_render = True
    return o


# ======================================================== manifest / measure =====

def measure(root):
    mins, maxs = L._world_bounds(root)
    dims = [round(maxs[i] - mins[i], 4) for i in range(3)]
    tris = 0
    texset = set()
    for o in L.descendants(root):
        if o.type != "MESH" or o.get("collision_proxy"):
            continue
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
        for m in o.data.materials:
            if m and m.use_nodes:
                for n in m.node_tree.nodes:
                    if n.type == "TEX_IMAGE" and n.image:
                        texset.add(f"{n.image.name}:{n.image.size[0]}x{n.image.size[1]}")
    sockets = [o.name for o in L.descendants(root) if o.type == "EMPTY" and (o.get("socket") or o.get("slot"))]
    return {"dims_m": dims, "min_z": round(mins[2], 4), "tris": tris,
            "textures": sorted(texset), "sockets": sorted(sockets)}


def record_manifest(entry):
    FRAGMENT_DIR.mkdir(parents=True, exist_ok=True)
    p = FRAGMENT_DIR / f"{entry['id']}.json"
    p.write_text(json.dumps(entry, indent=1))


# ============================================================ export / render ====

def save_and_export(asset_id, root, *, kind, category):
    src_dir = SOURCE_DIR / kind / category
    glb_dir = GLB_DIR / kind
    src_dir.mkdir(parents=True, exist_ok=True)
    glb_dir.mkdir(parents=True, exist_ok=True)
    blend_path = src_dir / f"{asset_id}.blend"
    glb_path = glb_dir / f"{asset_id}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.object.select_all(action="DESELECT")
    objs = L.descendants(root)
    for o in objs:
        o.hide_viewport = False
        o.hide_render = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path), export_format="GLB", use_selection=True,
        export_apply=True, export_yup=True, export_normals=True, export_texcoords=True,
        export_materials="EXPORT", export_extras=True, export_cameras=False, export_lights=False,
    )
    print(f"BUILT|{asset_id}|glb={glb_path.relative_to(ROOT)}|nodes={len(objs)}")
    return blend_path, glb_path


def render_preview(asset_id, root, *, subdir="products", azimuth=33, elevation=14, name=None, warm=False):
    out_dir = PREVIEW_DIR / subdir
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{name or asset_id}.png"
    for o in bpy.data.objects:
        if o.get("collision_proxy"):
            o.hide_render = True
    mins, maxs = L._world_bounds(root)
    C = Vector(((mins[0] + maxs[0]) / 2, (mins[1] + maxs[1]) / 2, (mins[2] + maxs[2]) / 2))
    S = max(0.05, max(maxs[i] - mins[i] for i in range(3)))
    sc = bpy.context.scene
    floor_col = (0.50, 0.47, 0.42) if warm else (0.55, 0.55, 0.57)
    L.box("PreviewFloor", (max(20, S * 8), max(20, S * 8), 0.04), (C.x, C.y, mins[2] - 0.02),
          m_flat("M_Floor", floor_col, rough=0.9), bevel=0.0, uv=False)
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    bgcol = (0.62, 0.55, 0.45, 1.0) if warm else (0.72, 0.72, 0.74, 1.0)
    world.node_tree.nodes["Background"].inputs[0].default_value = bgcol
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.5 if warm else 0.45
    sc.world = world

    def sun(nm, energy, rot, col=(1, 1, 1)):
        d = bpy.data.lights.new(nm, "SUN")
        d.energy = energy
        d.angle = math.radians(6)
        d.color = col
        ob = bpy.data.objects.new(nm, d)
        ob.rotation_euler = rot
        bpy.context.collection.objects.link(ob)
    if warm:
        sun("Key", 1.7, (math.radians(50), 0, math.radians(28)), (1.0, 0.88, 0.70))
        sun("Fill", 0.7, (math.radians(60), 0, math.radians(-65)), (1.0, 0.92, 0.78))
        sun("Rim", 0.8, (math.radians(118), 0, math.radians(185)), (1.0, 0.95, 0.85))
    else:
        sun("Key", 2.0, (math.radians(52), 0, math.radians(30)))
        sun("Fill", 0.8, (math.radians(60), 0, math.radians(-65)))
        sun("Rim", 0.9, (math.radians(118), 0, math.radians(185)))
    soft = bpy.data.lights.new("Soft", "AREA")
    soft.energy = 14 * S * S + 1.5
    soft.size = S * 2.2
    if warm:
        soft.color = (1.0, 0.85, 0.65)
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


# ================================================================ batch runner ===

def run_batch(registry, *, kind, category_of, default=None, manifest_extra=None):
    """registry: {asset_id: build_fn(M) -> root}.  argv selects ids / 'all';
    'render' adds previews; 'nojoin' skips join_static.  Builds each asset in a
    fresh scene inside ONE Blender session and records manifest fragments."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    want_render = "render" in argv
    nojoin = "nojoin" in argv
    ids = [a for a in argv if a in registry]
    if not ids:
        ids = default or list(registry.keys())
    failed = []
    for aid in ids:
        try:
            reset_scene()
            M = pf_materials()
            root = registry[aid](M)
            # bake every mesh's local rotation/scale before joining — parts posed
            # after creation would otherwise distort into the join target's frame
            for o in L.descendants(root):
                if o.type == "MESH":
                    L.activate(o)
                    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
            if not nojoin:
                L.join_static(root)
            stats = measure(root)
            save_and_export(aid, root, kind=kind, category=category_of(aid))
            entry = {"id": aid, "kind": kind, "category": category_of(aid), **stats,
                     "glb": f"assets/pro_shop/glb/{kind}/{aid}.glb",
                     "blend": f"assets/pro_shop/source/{kind}/{category_of(aid)}/{aid}.blend"}
            if manifest_extra:
                entry.update(manifest_extra(aid) or {})
            record_manifest(entry)
            if want_render:
                render_preview(aid, root, subdir=kind)
            print(f"COMPLETE|{aid}")
        except Exception:
            traceback.print_exc()
            failed.append(aid)
            print(f"FAILED|{aid}")
    if failed:
        print(f"BATCH_FAILED|{','.join(failed)}")
        sys.exit(1)
    print(f"BATCH_OK|{len(ids)} assets")
