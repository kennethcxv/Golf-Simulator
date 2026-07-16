# FAIRHOLLOW UNITS — the Sheet-02 currency art (Designs/RefrenceImages, panels
# 11-19).  Engraved-style fictional banknotes with per-denomination landscape
# vignettes, seals, serials and signatures; relief coinage with laurel/numeral
# obverses and crown-and-crossed-clubs reverses, baked to color + normal maps.
# Original Fairhollow Golf Club artwork throughout — deliberately NOT any
# real-world currency (no US/EUR/JPY/GBP layouts, marks or portraits).
import math

import numpy as np

import checkout_kit_lib as K
import lib_props as L

# ============================================================ shared helpers ===

def _rect(w, h, x0, y0, x1, y1):
    m = np.zeros((h, w), bool)
    m[max(0, int(y0)):max(0, int(y1)), max(0, int(x0)):max(0, int(x1))] = True
    return m


def _poly_mask(w, h, pts):
    """Even-odd point-in-polygon mask; pts = [(x, y), ...]."""
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    inside = np.zeros((h, w), bool)
    j = len(pts) - 1
    for i in range(len(pts)):
        x0, y0 = pts[j]
        x1, y1 = pts[i]
        cond = ((y1 > yy) != (y0 > yy)) & (xx < (x0 - x1) * (yy - y1) / (y0 - y1 + 1e-9) + x1)
        inside ^= cond
        j = i
    return inside


def _blur(a, n=1):
    """Cheap 3x3 box blur, applied n times (numpy only — no scipy in Blender)."""
    for _ in range(n):
        a = (a
             + np.roll(a, 1, 0) + np.roll(a, -1, 0)
             + np.roll(a, 1, 1) + np.roll(a, -1, 1)
             + np.roll(np.roll(a, 1, 0), 1, 1) + np.roll(np.roll(a, 1, 0), -1, 1)
             + np.roll(np.roll(a, -1, 0), 1, 1) + np.roll(np.roll(a, -1, 0), -1, 1)) / 9.0
    return a


def _squiggle(arr, x0, x1, y, amp, col, seed):
    """A fictional signature: a flowing multi-frequency stroke plus a flourish."""
    rng = np.random.default_rng(seed)
    h, w = arr.shape[:2]
    f1, f2 = rng.uniform(0.09, 0.13), rng.uniform(0.23, 0.31)
    p1, p2 = rng.uniform(0, 6.28), rng.uniform(0, 6.28)
    n = 26
    xs = np.linspace(x0, x1, n)
    ys = y + amp * np.sin(xs * f1 + p1) + amp * 0.5 * np.sin(xs * f2 + p2)
    ys[0] -= amp * 1.6                       # an entry upstroke
    for i in range(n - 1):
        arr[K._seg_mask(w, h, xs[i], ys[i], xs[i + 1], ys[i + 1], 1.1)] = col
    # underline flourish
    arr[K._seg_mask(w, h, x0 + (x1 - x0) * 0.18, y + amp * 1.7, x1, y + amp * 1.2, 0.8)] = col
    return arr


def _serrated_seal(arr, cx, cy, r, asp, ink, ink2, mono):
    """An original club seal: serrated (cog-tooth) outer ring, inner ring, dots
    and the FH monogram.  Nothing copied from any state or bank seal."""
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    dy = (yy - cy) / asp
    rr = np.hypot(xx - cx, dy)
    ang = np.arctan2(dy, xx - cx)
    teeth = (np.floor((ang + math.pi) / (2 * math.pi / 36)).astype("int32") % 2) == 0
    edge = r * (0.94 + 0.06 * teeth)         # serration
    arr[(rr < edge) & (rr > r * 0.82)] = ink
    arr[(rr < r * 0.74) & (rr > r * 0.70)] = ink2
    dots = (np.floor((ang + math.pi) / (2 * math.pi / 18)).astype("int32") % 2 == 0) \
        & (rr > r * 0.76) & (rr < r * 0.80)
    arr[dots] = ink2
    K.draw_text(arr, mono, int(cx), int(cy), 3, tuple(ink))
    return arr


def _guilloche(arr, x0, x1, cy, amp, col, *, waves=2.0):
    """Two interleaved sine strands — the engraved lathework band."""
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    band = (xx >= x0) & (xx <= x1)
    om = 2 * math.pi / (44.0 / waves)
    for ph in (0.0, math.pi):
        d = np.abs(yy - (cy + amp * np.sin(xx * om + ph)))
        arr[band & (d < 1.4)] = col
    return arr


# ======================================================== vignette scenery =====
# Every scene draws inside a window rect in two/three ink tones over a pale sky,
# then gets an engraved hatch.  All silhouettes are composed from primitive
# masks — original art, no traced sources.

def _sky(arr, win, P):
    arr[win] = P["field"] * 1.16


def _hatch(arr, win, P, *, gap=3.6):
    """The engraved-plate pass: horizontal line work whose weight follows the
    local tone — thin ticks over the sky, heavy strokes through the darks.
    This is what turns flat fills into an engraving."""
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    lum = arr.mean(-1)
    ref = float(np.median(lum[win])) if win.any() else 0.5
    dark_amt = np.clip((ref + 0.22 - lum) * 2.0, 0.0, 1.0)
    lines = ((yy + 1.4 * np.sin(xx * 0.045)) % gap) < (0.6 + dark_amt * 2.0)
    m = win & lines
    arr[m] *= 0.84


def _ground(arr, w, h, win, y_horizon, P, tone=0.42):
    g = win & (np.mgrid[0:h, 0:w][0] > y_horizon)
    arr[g] = P["tint"] * tone + P["paper"] * 0.24
    return g


def _sun(arr, w, h, win, cx, cy, r, P):
    arr[K._ellipse_mask(w, h, cx, cy, r, r) & win] = P["pale"]
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    ring = win & (np.hypot(xx - cx, yy - cy) > r + 3) & (np.hypot(xx - cx, yy - cy) < r + 5)
    arr[ring] = P["field"] * 1.24


def _tree(arr, w, h, win, cx, base_y, s, col, col2=None):
    """A broadleaf: visible trunk and boughs under an irregular canopy."""
    c2 = col if col2 is None else col2
    arr[K._seg_mask(w, h, cx, base_y, cx + 1.5 * s, base_y - 14 * s, 1.7 * s) & win] = col
    arr[K._seg_mask(w, h, cx + 1 * s, base_y - 9 * s, cx - 6 * s, base_y - 17 * s, 1.0 * s) & win] = col
    arr[K._seg_mask(w, h, cx + 1 * s, base_y - 11 * s, cx + 8 * s, base_y - 18 * s, 0.9 * s) & win] = col
    lobes = ((0, -27, 13, 8, col), (-10, -22, 9, 6, c2), (11, -23, 9, 6, c2),
             (-5, -33, 9, 5.5, col), (6, -32, 8, 5, c2), (0, -19, 11, 6, col))
    for (ox, oy, rx, ry, cc) in lobes:
        arr[K._ellipse_mask(w, h, cx + ox * s, base_y + oy * s, rx * s, ry * s) & win] = cc
    # canopy shadow pocket where the boughs meet the leaves
    arr[K._ellipse_mask(w, h, cx - 2 * s, base_y - 17 * s, 2.6 * s, 1.1 * s) & win] = col * 0.82


def _conifer(arr, w, h, win, cx, base_y, s, col):
    """Three stacked triangle tiers on a stub trunk."""
    for (hw, b, t) in ((8.0, 2.0, 12.0), (6.2, 9.0, 19.0), (4.2, 16.0, 26.0)):
        arr[_poly_mask(w, h, [(cx - hw * s, base_y - b * s), (cx + hw * s, base_y - b * s),
                              (cx, base_y - t * s)]) & win] = col
    arr[K._seg_mask(w, h, cx, base_y, cx, base_y - 4 * s, 1.2 * s) & win] = col


def _scene_mountains(arr, w, h, x0, y0, x1, y1, P):
    """50 front: a mountain range over water with an arched stone bridge."""
    win = _rect(w, h, x0, y0, x1, y1)
    _sky(arr, win, P)
    _sun(arr, w, h, win, x0 + (x1 - x0) * 0.20, y0 + (y1 - y0) * 0.24, 15, P)
    cx = (x0 + x1) / 2
    ridge_far = [(x0, y0 + 118), (x0 + 90, y0 + 52), (x0 + 168, y0 + 96), (x0 + 252, y0 + 34),
                 (x0 + 330, y0 + 92), (x0 + 420, y0 + 48), (x1, y0 + 104), (x1, y1), (x0, y1)]
    arr[_poly_mask(w, h, ridge_far) & win] = P["tint"] * 0.34 + P["paper"] * 0.34
    ridge_near = [(x0, y0 + 150), (x0 + 130, y0 + 92), (x0 + 226, y0 + 138), (x0 + 348, y0 + 78),
                  (x0 + 470, y0 + 142), (x1, y0 + 118), (x1, y1), (x0, y1)]
    arr[_poly_mask(w, h, ridge_near) & win] = P["tint"] * 0.44 + P["paper"] * 0.24
    # snow caps: pale ticks under the two near summits
    for (sx, sy) in ((x0 + 130, y0 + 92), (x0 + 348, y0 + 78)):
        arr[_poly_mask(w, h, [(sx - 13, sy + 12), (sx + 13, sy + 12), (sx, sy)]) & win] = P["pale"] * 0.94
    water_y = y0 + int((y1 - y0) * 0.72)
    arr[win & (np.mgrid[0:h, 0:w][0] > water_y)] = P["tint"] * 0.30 + P["paper"] * 0.36
    # the stone bridge sits ON the waterline: parapet, deck, piers, and the
    # arch's reflection closing to an eye of pale water
    deck_y = water_y + 1
    arr[K._seg_mask(w, h, cx - 118, deck_y, cx + 118, deck_y, 3.2) & win] = P["ink"]
    arr[K._seg_mask(w, h, cx - 110, deck_y - 8, cx + 110, deck_y - 8, 1.4) & win] = P["ink"]
    for px_ in (cx - 92, cx + 92):
        arr[_rect(w, h, px_ - 6, deck_y, px_ + 6, deck_y + 26) & win] = P["ink"]
    arch = K._ellipse_mask(w, h, cx, deck_y + 4, 42, 30)
    arr[arch & win & (np.mgrid[0:h, 0:w][0] > deck_y + 2)] = P["field"] * 1.20
    ring = K._ellipse_mask(w, h, cx, deck_y + 4, 46, 34) & ~arch
    arr[ring & win & (np.mgrid[0:h, 0:w][0] > deck_y + 2)] = P["ink"]
    # ripples
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    rip = win & (yy > deck_y + 34) & (((xx * 0.5 + yy * 3.1) % 46) < 13) & ((yy % 9) < 1.6)
    arr[rip] = P["ink2"]
    _conifer(arr, w, h, win, x0 + 44, y1 - 6, 1.5, P["ink2"])
    _conifer(arr, w, h, win, x1 - 52, y1 - 4, 1.8, P["ink2"])
    _hatch(arr, win, P)


def _scene_oakbridge(arr, w, h, x0, y0, x1, y1, P):
    """10 front: the great oak by the pond, rail fence and footbridge."""
    win = _rect(w, h, x0, y0, x1, y1)
    _sky(arr, win, P)
    _sun(arr, w, h, win, x1 - (x1 - x0) * 0.18, y0 + (y1 - y0) * 0.22, 13, P)
    hor = y0 + int((y1 - y0) * 0.60)
    _ground(arr, w, h, win, hor, P)
    cx = (x0 + x1) / 2
    # a distant rail fence on the horizon, behind the water
    fy = hor + 10
    for i in range(6):
        fx = cx - 90 + i * 36
        arr[K._seg_mask(w, h, fx, fy - 12, fx, fy + 4, 1.1) & win] = P["ink2"]
    arr[K._seg_mask(w, h, cx - 90, fy - 6, cx + 90, fy - 6, 0.9) & win] = P["ink2"]
    pond = K._ellipse_mask(w, h, cx + 40, y1 - 36, 140, 26)
    arr[pond & win] = P["tint"] * 0.28 + P["paper"] * 0.36
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    rip = pond & win & ((yy % 7) < 1.3) & (((xx + yy * 2.0) % 40) < 14)
    arr[rip] = P["ink2"]
    # the arched footbridge crossing the pond's right lobe
    bx = cx + 128
    arr[K._ellipse_mask(w, h, bx, y1 - 40, 34, 15) & win & (yy > y1 - 46)] = P["field"] * 1.16
    deck = [(bx - 66, y1 - 42), (bx - 22, y1 - 56), (bx + 22, y1 - 56), (bx + 66, y1 - 42)]
    for i in range(3):
        arr[K._seg_mask(w, h, deck[i][0], deck[i][1], deck[i + 1][0], deck[i + 1][1], 3.0) & win] = P["ink"]
        arr[K._seg_mask(w, h, deck[i][0], deck[i][1] - 11, deck[i + 1][0], deck[i + 1][1] - 11, 1.2) & win] = P["ink"]
    for (px_, py_) in ((bx - 54, y1 - 45), (bx - 27, y1 - 55), (bx, y1 - 56), (bx + 27, y1 - 55), (bx + 54, y1 - 45)):
        arr[K._seg_mask(w, h, px_, py_ - 11, px_, py_, 1.0) & win] = P["ink"]
    # the oak, big on the left third
    _tree(arr, w, h, win, x0 + 150, y1 - 18, 4.4, P["ink"], P["ink2"])
    _hatch(arr, win, P)


def _scene_lighthouse(arr, w, h, x0, y0, x1, y1, P):
    """5 front: a lighthouse on the point — the club's coastal course."""
    win = _rect(w, h, x0, y0, x1, y1)
    _sky(arr, win, P)
    sea_y = y0 + int((y1 - y0) * 0.62)
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    arr[win & (yy > sea_y)] = P["tint"] * 0.34 + P["paper"] * 0.32
    rip = win & (yy > sea_y + 8) & ((yy % 8) < 1.5) & (((xx * 0.7 + yy * 2.4) % 52) < 17)
    arr[rip] = P["ink2"]
    cx = x0 + (x1 - x0) * 0.42
    base = sea_y + 12
    # headland
    arr[K._ellipse_mask(w, h, cx, base + 16, 120, 22) & win] = P["ink2"]
    arr[K._ellipse_mask(w, h, cx + 96, base + 22, 70, 14) & win] = P["tint"] * 0.30 + P["paper"] * 0.20
    # tapered tower with two pale bands
    top = y0 + int((y1 - y0) * 0.16)
    tw_b, tw_t = 26, 14
    arr[_poly_mask(w, h, [(cx - tw_b, base), (cx + tw_b, base), (cx + tw_t, top + 22), (cx - tw_t, top + 22)]) & win] = P["ink"]
    for f0, f1 in ((0.30, 0.44), (0.62, 0.76)):
        band = _poly_mask(w, h, [
            (cx - (tw_b + (tw_t - tw_b) * f0), base + (top + 22 - base) * f0),
            (cx + (tw_b + (tw_t - tw_b) * f0), base + (top + 22 - base) * f0),
            (cx + (tw_b + (tw_t - tw_b) * f1), base + (top + 22 - base) * f1),
            (cx - (tw_b + (tw_t - tw_b) * f1), base + (top + 22 - base) * f1)])
        arr[band & win] = P["pale"] * 0.92
    # gallery + lantern + dome
    arr[_rect(w, h, cx - 18, top + 14, cx + 18, top + 22) & win] = P["ink"]
    arr[_rect(w, h, cx - 10, top + 2, cx + 10, top + 14) & win] = P["pale"]
    arr[_rect(w, h, cx - 12, top - 2, cx + 12, top + 2) & win] = P["ink"]
    arr[K._ellipse_mask(w, h, cx, top - 4, 9, 6) & win] = P["ink"]
    # the lamp's soft halo
    halo = K._ellipse_mask(w, h, cx, top + 8, 26, 20) & ~K._ellipse_mask(w, h, cx, top + 8, 18, 13)
    arr[halo & win] = P["field"] * 1.26
    # gulls
    for (gx, gy, s) in ((x1 - 130, y0 + 52, 1.0), (x1 - 96, y0 + 74, 0.8), (x0 + 90, y0 + 66, 0.9)):
        arr[K._seg_mask(w, h, gx - 8 * s, gy, gx - 1 * s, gy - 5 * s, 1.0) & win] = P["ink"]
        arr[K._seg_mask(w, h, gx - 1 * s, gy - 5 * s, gx + 7 * s, gy - 1 * s, 1.0) & win] = P["ink"]
    _hatch(arr, win, P)


def _scene_heron(arr, w, h, x0, y0, x1, y1, P):
    """1 front: a heron standing in the reeds off the 7th tee."""
    win = _rect(w, h, x0, y0, x1, y1)
    _sky(arr, win, P)
    _sun(arr, w, h, win, x0 + (x1 - x0) * 0.78, y0 + (y1 - y0) * 0.20, 12, P)
    wy = y0 + int((y1 - y0) * 0.68)
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    arr[win & (yy > wy)] = P["tint"] * 0.32 + P["paper"] * 0.34
    rip = win & (yy > wy + 6) & ((yy % 8) < 1.4) & (((xx + yy * 1.8) % 44) < 15)
    arr[rip] = P["ink2"]
    cx, cy = x0 + (x1 - x0) * 0.46, wy - 34
    ink = P["ink"]
    # a slim wader: chest + rear hump, tail ticks
    arr[K._ellipse_mask(w, h, cx, cy, 26, 12) & win] = ink
    arr[K._ellipse_mask(w, h, cx - 14, cy - 5, 14, 10) & win] = ink
    arr[_poly_mask(w, h, [(cx - 34, cy + 2), (cx - 54, cy + 16), (cx - 28, cy + 10)]) & win] = ink
    # the S-neck rises from the chest
    arr[K._seg_mask(w, h, cx + 18, cy - 4, cx + 30, cy - 28, 3.6) & win] = ink
    arr[K._seg_mask(w, h, cx + 30, cy - 28, cx + 23, cy - 52, 3.0) & win] = ink
    arr[K._seg_mask(w, h, cx + 23, cy - 52, cx + 30, cy - 64, 2.6) & win] = ink
    # head, dagger beak, crest wisp, pale eye
    arr[K._ellipse_mask(w, h, cx + 31, cy - 66, 7, 5.5) & win] = ink
    arr[K._seg_mask(w, h, cx + 36, cy - 66, cx + 63, cy - 61, 1.7) & win] = ink
    arr[K._seg_mask(w, h, cx + 26, cy - 71, cx + 15, cy - 75, 1.1) & win] = ink
    arr[K._ellipse_mask(w, h, cx + 32, cy - 67, 1.5, 1.5) & win] = P["pale"]
    # legs: one planted, one cocked at the knee
    arr[K._seg_mask(w, h, cx + 3, cy + 9, cx + 5, wy + 18, 1.5) & win] = ink
    arr[K._seg_mask(w, h, cx - 8, cy + 9, cx - 15, cy + 26, 1.5) & win] = ink
    arr[K._seg_mask(w, h, cx - 15, cy + 26, cx - 9, wy + 16, 1.5) & win] = ink
    # reeds, both banks
    rng = np.random.default_rng(7)
    for i in range(9):
        rx = x0 + 24 + (i * 61 + int(rng.integers(0, 22))) % (x1 - x0 - 48)
        if abs(rx - cx) < 60:
            continue
        lean = rng.uniform(-8, 8)
        top_ = wy - rng.integers(34, 78)
        arr[K._seg_mask(w, h, rx, wy + 14, rx + lean, top_, 1.3) & win] = P["ink2"]
        arr[K._ellipse_mask(w, h, rx + lean, top_ - 4, 2.6, 7) & win] = P["ink2"]
    _hatch(arr, win, P)


def _scene_fairway(arr, w, h, x0, y0, x1, y1, P):
    """20 front: the Sheet-01 fairway — hills, pennant, sun (family continuity)."""
    win = _rect(w, h, x0, y0, x1, y1)
    _sky(arr, win, P)
    _sun(arr, w, h, win, x0 + (x1 - x0) * 0.22, y0 + (y1 - y0) * 0.26, 14, P)
    arr[K._ellipse_mask(w, h, x0 + (x1 - x0) * 0.34, y1 + 30, 250, 96) & win] = P["tint"] * 0.42 + P["paper"] * 0.20
    arr[K._ellipse_mask(w, h, x0 + (x1 - x0) * 0.78, y1 + 44, 280, 104) & win] = P["tint"] * 0.34 + P["paper"] * 0.30
    # bunkers
    arr[K._ellipse_mask(w, h, x0 + (x1 - x0) * 0.62, y1 - 40, 26, 8) & win] = P["pale"] * 0.9
    arr[K._ellipse_mask(w, h, x0 + (x1 - x0) * 0.30, y1 - 24, 20, 6) & win] = P["pale"] * 0.9
    K._crest_pennant(arr, x0 + (x1 - x0) * 0.55, y0 + (y1 - y0) * 0.52, 1.8, tuple(P["ink"]))
    _conifer(arr, w, h, win, x1 - 60, y1 - 10, 1.6, P["ink2"])
    _hatch(arr, win, P)


def _scene_clubhouse(arr, w, h, x0, y0, x1, y1, P):
    """50 back: the Fairhollow clubhouse — gabled hall, porch, club flag."""
    win = _rect(w, h, x0, y0, x1, y1)
    _sky(arr, win, P)
    hor = y0 + int((y1 - y0) * 0.72)
    _ground(arr, w, h, win, hor, P, tone=0.38)
    cx = (x0 + x1) / 2
    bw, bh = 150, 74                       # main hall half-width / height
    base = hor + 8
    wall = P["tint"] * 0.36 + P["paper"] * 0.30
    arr[_rect(w, h, cx - bw, base - bh, cx + bw, base) & win] = wall
    # clapboard courses on the hall wall
    yy2 = np.mgrid[0:h, 0:w][0]
    boards = _rect(w, h, cx - bw, base - bh, cx + bw, base) & ((yy2 % 7) < 1.2)
    arr[boards & win] = wall * 0.82
    arr[_poly_mask(w, h, [(cx - bw - 12, base - bh), (cx + bw + 12, base - bh), (cx, base - bh - 52)]) & win] = P["ink"]
    # porch: shadowed roof line + five pale posts over the wall
    arr[_rect(w, h, cx - bw - 34, base - 36, cx + bw + 34, base - 28) & win] = P["ink"]
    arr[_rect(w, h, cx - bw - 34, base - 28, cx + bw + 34, base - 24) & win] = P["ink2"]
    for i in range(6):
        px_ = cx - bw - 28 + i * ((2 * bw + 56) / 5)
        arr[_rect(w, h, px_ - 3, base - 28, px_ + 3, base) & win] = P["pale"] * 0.84
        arr[_rect(w, h, px_ + 1, base - 28, px_ + 3, base) & win] = P["ink2"]
    # windows + door: dark reveals with pale sashes
    for i in range(5):
        wx = cx - bw + 30 + i * ((2 * bw - 60) / 4)
        if i == 2:
            arr[_rect(w, h, wx - 13, base - 42, wx + 13, base) & win] = P["ink"]
            arr[_rect(w, h, wx - 9, base - 38, wx + 9, base) & win] = P["pale"] * 0.80
        else:
            arr[_rect(w, h, wx - 12, base - 54, wx + 12, base - 20) & win] = P["ink"]
            arr[_rect(w, h, wx - 9, base - 51, wx + 9, base - 23) & win] = P["pale"] * 0.90
            arr[_rect(w, h, wx - 1, base - 51, wx + 1, base - 23) & win] = P["ink2"]
            arr[_rect(w, h, wx - 9, base - 38, wx + 9, base - 36) & win] = P["ink2"]
    # gable vent + a proper club flag over the ridge
    arr[K._ellipse_mask(w, h, cx, base - bh - 24, 8, 10) & win] = P["pale"] * 0.9
    arr[K._ellipse_mask(w, h, cx, base - bh - 24, 5, 7) & win] = P["ink2"]
    arr[K._seg_mask(w, h, cx, base - bh - 50, cx, base - bh - 92, 1.6) & win] = P["ink"]
    arr[_poly_mask(w, h, [(cx, base - bh - 92), (cx + 38, base - bh - 83), (cx, base - bh - 74)]) & win] = P["ink"]
    # flanking trees + walk
    _tree(arr, w, h, win, x0 + 74, base + 8, 3.0, P["ink"], P["ink2"])
    _tree(arr, w, h, win, x1 - 74, base + 10, 3.2, P["ink"], P["ink2"])
    arr[_poly_mask(w, h, [(cx - 16, base), (cx + 16, base), (cx + 34, y1), (cx - 34, y1)]) & win] = P["pale"] * 0.82
    _hatch(arr, win, P)


def _scene_pavilion(arr, w, h, x0, y0, x1, y1, P):
    """10 back: the long veranda pavilion at the practice green."""
    win = _rect(w, h, x0, y0, x1, y1)
    _sky(arr, win, P)
    hor = y0 + int((y1 - y0) * 0.70)
    _ground(arr, w, h, win, hor, P, tone=0.38)
    cx = (x0 + x1) / 2
    base = hor + 14
    bw, bh = 190, 44
    # hip roof + low hall
    arr[_poly_mask(w, h, [(cx - bw - 26, base - bh), (cx + bw + 26, base - bh),
                          (cx + bw - 40, base - bh - 34), (cx - bw + 40, base - bh - 34)]) & win] = P["ink"]
    arr[_rect(w, h, cx - bw, base - bh, cx + bw, base) & win] = P["ink2"]
    # veranda posts + rail
    for i in range(8):
        px_ = cx - bw + 12 + i * ((2 * bw - 24) / 7)
        arr[_rect(w, h, px_ - 2, base - bh + 6, px_ + 2, base) & win] = P["ink"]
    arr[K._seg_mask(w, h, cx - bw + 6, base - 16, cx + bw - 6, base - 16, 1.2) & win] = P["ink"]
    # windows behind the posts
    for i in range(4):
        wx = cx - bw + 52 + i * ((2 * bw - 104) / 3)
        arr[_rect(w, h, wx - 14, base - bh + 12, wx + 14, base - 22) & win] = P["pale"] * 0.9
    # steps + a flag at the LEFT gable end, clear of the tree
    arr[_rect(w, h, cx - 30, base, cx + 30, base + 8) & win] = P["pale"] * 0.84
    arr[K._seg_mask(w, h, cx - bw - 14, base - bh - 4, cx - bw - 14, base - bh - 54, 1.3) & win] = P["ink"]
    arr[_poly_mask(w, h, [(cx - bw - 14, base - bh - 54), (cx - bw + 12, base - bh - 47), (cx - bw - 14, base - bh - 40)]) & win] = P["ink"]
    green = K._ellipse_mask(w, h, x0 + 92, y1 - 20, 74, 14)
    arr[green & win] = P["tint"] * 0.55 + P["paper"] * 0.24
    arr[K._seg_mask(w, h, x0 + 92, y1 - 24, x0 + 92, y1 - 52, 1.0) & win] = P["ink"]
    arr[_poly_mask(w, h, [(x0 + 92, y1 - 52), (x0 + 108, y1 - 47), (x0 + 92, y1 - 43)]) & win] = P["ink"]
    _tree(arr, w, h, win, x1 - 60, base + 6, 2.6, P["ink"], P["ink2"])
    _hatch(arr, win, P)


def _scene_sailboat(arr, w, h, x0, y0, x1, y1, P):
    """5 back: the regatta sloop off the coastal nine."""
    win = _rect(w, h, x0, y0, x1, y1)
    _sky(arr, win, P)
    sea_y = y0 + int((y1 - y0) * 0.64)
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    arr[win & (yy > sea_y)] = P["tint"] * 0.34 + P["paper"] * 0.32
    rip = win & (yy > sea_y + 4) & ((yy % 8) < 1.5) & (((xx * 0.8 + yy * 2.2) % 48) < 16)
    arr[rip] = P["ink2"]
    cx = (x0 + x1) / 2
    hull_y = sea_y + 6
    hull = K._ellipse_mask(w, h, cx, hull_y, 92, 34) & ~K._ellipse_mask(w, h, cx, hull_y - 16, 108, 34)
    arr[hull & win & (yy > hull_y - 2) & (yy < hull_y + 22)] = P["ink"]
    arr[K._seg_mask(w, h, cx, hull_y - 2, cx, hull_y - 128, 1.6) & win] = P["ink"]
    # main + jib, pale with ink luff lines
    main = _poly_mask(w, h, [(cx - 4, hull_y - 126), (cx - 4, hull_y - 12), (cx - 78, hull_y - 12)])
    jib = _poly_mask(w, h, [(cx + 4, hull_y - 108), (cx + 66, hull_y - 10), (cx + 4, hull_y - 10)])
    arr[main & win] = P["pale"] * 0.94
    arr[jib & win] = P["pale"] * 0.86
    arr[K._seg_mask(w, h, cx - 4, hull_y - 126, cx - 78, hull_y - 12, 1.1) & win] = P["ink2"]
    arr[K._seg_mask(w, h, cx + 4, hull_y - 108, cx + 66, hull_y - 10, 1.1) & win] = P["ink2"]
    # pennant + clouds + gulls
    arr[_poly_mask(w, h, [(cx, hull_y - 128), (cx + 20, hull_y - 123), (cx, hull_y - 118)]) & win] = P["ink"]
    for (gx, gy, s) in ((x0 + 96, y0 + 58, 1.0), (x1 - 110, y0 + 78, 0.85)):
        arr[K._seg_mask(w, h, gx - 8 * s, gy, gx - 1 * s, gy - 5 * s, 1.0) & win] = P["ink"]
        arr[K._seg_mask(w, h, gx - 1 * s, gy - 5 * s, gx + 7 * s, gy - 1 * s, 1.0) & win] = P["ink"]
    for (cx_, cy_, s) in ((x0 + 150, y0 + 40, 1.0), (x1 - 170, y0 + 34, 1.2)):
        arr[K._seg_mask(w, h, cx_ - 22 * s, cy_, cx_ + 22 * s, cy_, 3.0 * s) & win] = P["field"] * 1.24
        arr[K._seg_mask(w, h, cx_ - 8 * s, cy_ - 5, cx_ + 14 * s, cy_ - 5, 2.4 * s) & win] = P["field"] * 1.24
    _hatch(arr, win, P)


def _scene_lonetree(arr, w, h, x0, y0, x1, y1, P):
    """1 back: the lone oak on the practice lawn."""
    win = _rect(w, h, x0, y0, x1, y1)
    _sky(arr, win, P)
    hor = y0 + int((y1 - y0) * 0.66)
    _ground(arr, w, h, win, hor, P)
    cx = (x0 + x1) / 2
    _tree(arr, w, h, win, cx, y1 - 26, 5.6, P["ink"], P["ink2"])
    arr[K._ellipse_mask(w, h, cx + 30, y1 - 18, 84, 10) & win] = P["tint"] * 0.30 + P["paper"] * 0.18
    # a distant rail fence
    fy = hor + 22
    for i in range(4):
        fx = x0 + 60 + i * 44
        arr[K._seg_mask(w, h, fx, fy - 12, fx, fy + 6, 1.2) & win] = P["ink2"]
    arr[K._seg_mask(w, h, x0 + 60, fy - 7, x0 + 60 + 3 * 44, fy - 7, 1.0) & win] = P["ink2"]
    _sun(arr, w, h, win, x1 - 90, y0 + 54, 12, P)
    _hatch(arr, win, P)


def _scene_golfer(arr, w, h, x0, y0, x1, y1, P):
    """20 back: the Sheet-01 follow-through golfer (family continuity)."""
    win = _rect(w, h, x0, y0, x1, y1)
    _sky(arr, win, P)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hor = y0 + int((y1 - y0) * 0.78)
    _ground(arr, w, h, win, hor, P)
    K._stamp_golfer(arr, cx - 6, cy + 6, 2.1, tuple(P["ink"]))
    arr[K._seg_mask(w, h, cx - 96, hor + 2, cx + 96, hor + 2, 1.8) & win] = P["ink2"]
    arr[K._ellipse_mask(w, h, cx - 46, hor - 3, 3.5, 3.5) & win] = P["pale"]
    K._crest_pennant(arr, x0 + 70, cy + 10, 1.1, tuple(P["ink2"]))
    _hatch(arr, win, P)


_SCENES = {
    "mountains": _scene_mountains, "oakbridge": _scene_oakbridge,
    "lighthouse": _scene_lighthouse, "heron": _scene_heron,
    "fairway": _scene_fairway, "clubhouse": _scene_clubhouse,
    "pavilion": _scene_pavilion, "sailboat": _scene_sailboat,
    "lonetree": _scene_lonetree, "golfer": _scene_golfer,
}

# ============================================================== banknotes ======
# Physical note sizes step with value (Sheet 02): a size ladder is instantly
# readable and deliberately un-USD (all US notes share one size).
BILL_DIMS = {
    1: (0.122, 0.054), 5: (0.132, 0.057), 10: (0.142, 0.061),
    20: (0.149, 0.0635), 50: (0.156, 0.066),
}

BILL_STYLE = {
    # tint (linear), front scene, back scene, value word
    1: dict(tint=(0.095, 0.150, 0.300), scene="heron", back="lonetree", label="ONE"),
    5: dict(tint=(0.235, 0.130, 0.330), scene="lighthouse", back="sailboat", label="FIVE"),
    10: dict(tint=(0.230, 0.330, 0.085), scene="oakbridge", back="pavilion", label="TEN"),
    20: dict(tint=(0.070, 0.270, 0.100), scene="fairway", back="golfer", label="TWENTY"),
    50: dict(tint=(0.155, 0.200, 0.090), scene="mountains", back="clubhouse", label="FIFTY"),
}


def _bill_frame(arr, x0, y0, x1, y1, ink, ink2, field):
    """Ornate double border with corner rosettes and lathework bands."""
    w = arr.shape[1]
    arr[int(y0) + 12:int(y0) + 18, int(x0) + 14:int(x1) - 14] = ink
    arr[int(y1) - 18:int(y1) - 12, int(x0) + 14:int(x1) - 14] = ink
    arr[int(y0) + 12:int(y1) - 12, int(x0) + 12:int(x0) + 18] = ink
    arr[int(y0) + 12:int(y1) - 12, int(x1) - 18:int(x1) - 12] = ink
    arr[int(y0) + 24:int(y0) + 26, int(x0) + 24:int(x1) - 24] = ink2
    arr[int(y1) - 26:int(y1) - 24, int(x0) + 24:int(x1) - 24] = ink2
    arr[int(y0) + 24:int(y1) - 24, int(x0) + 24:int(x0) + 26] = ink2
    arr[int(y0) + 24:int(y1) - 24, int(x1) - 26:int(x1) - 24] = ink2
    h_ = arr.shape[0]
    for (cx, cy) in ((x0 + 42, y0 + 42), (x1 - 42, y0 + 42), (x0 + 42, y1 - 42), (x1 - 42, y1 - 42)):
        for r, c in ((17, ink), (12, field), (8, ink2), (4, ink)):
            arr[K._ellipse_mask(w, h_, cx, cy, r, r)] = c
    _guilloche(arr, x0 + 150, x1 - 150, y0 + 38, 7, ink2)
    _guilloche(arr, x0 + 150, x1 - 150, y1 - 38, 7, ink2)


def bill_img(denom, *, w=1024, h=1024):
    """A FAIRHOLLOW CLUB RESERVE NOTE in fictional UNITS — Sheet-02 art.
    Front on rows 0..506 (v .506..1), back on rows 518..1024 (v 0..0.494,
    u-mirrored on the mesh), paper edge strip straddling the v=0.5 seam."""
    st = BILL_STYLE[denom]
    rng = np.random.default_rng(170 + denom)
    tint = np.array(st["tint"], "float32")
    paper = np.array((0.58, 0.56, 0.47), "float32")
    field = tint * 0.58 + paper * 0.40
    ink = tint * 0.16 + np.array((0.02, 0.03, 0.02), "float32")
    ink2 = tint * 0.34 + np.array((0.06, 0.07, 0.05), "float32")
    pale = np.array((0.90, 0.88, 0.78), "float32")
    serial_ink = np.array((0.30, 0.09, 0.05), "float32")
    P = dict(tint=tint, paper=paper, field=field, ink=ink, ink2=ink2, pale=pale)
    label = st["label"]
    BW, BH = BILL_DIMS[denom]
    asp = (BW / BH) / 2.0                    # px aspect: circles need ry *= asp

    arr = np.ones((h, w, 3), "float32") * field
    arr *= (1.0 + (L._fbm(rng, w, h, 60, 60, 4)[..., None] - 0.5) * 0.06)
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    waves = ((yy + 2.6 * np.sin(xx * 0.045 + yy * 0.09)) % 6.0) < 1.7
    arr[waves] = arr[waves] * 0.90 + ink[None, :] * 0.05

    serial = f"FH {rng.integers(10 ** 7, 10 ** 8 - 1)} A"

    def corner_panels(y0, y1, npx):
        for (px0, py0) in ((34, y0 + 58), (w - 34 - 132, y0 + 58), (34, y1 - 58 - 84), (w - 34 - 132, y1 - 58 - 84)):
            arr[int(py0):int(py0) + 84, int(px0):int(px0) + 132] = tint * 0.28
            arr[int(py0) + 4:int(py0) + 6, int(px0) + 4:int(px0) + 128] = pale * 0.55
            arr[int(py0) + 78:int(py0) + 80, int(px0) + 4:int(px0) + 128] = pale * 0.55
            # engraved depth: a dark counter-relief behind the pale numeral
            K.draw_text(arr, str(denom), int(px0) + 66 + 3, int(py0) + 42 + 3, npx, tuple(ink * 0.7))
            K.draw_text(arr, str(denom), int(px0) + 66, int(py0) + 42, npx, tuple(pale))

    # --------------------------------------------------------------- FRONT ----
    y0, y1 = 0, 506
    _bill_frame(arr, 0, y0, w, y1, ink, ink2, field)
    corner_panels(y0, y1, 9 if denom < 10 else 7)
    K.draw_text(arr, "FAIRHOLLOW GOLF CLUB", w // 2, y0 + 86, 4, tuple(ink))
    K.draw_text(arr, "CLUB RESERVE NOTE", w // 2, y0 + 122, 2, tuple(ink2))
    # vignette window with double rule
    vx0, vy0, vx1, vy1 = 240, y0 + 152, w - 240, y1 - 122
    arr[int(vy0) - 6:int(vy0) - 2, int(vx0) - 6:int(vx1) + 6] = ink
    arr[int(vy1) + 2:int(vy1) + 6, int(vx0) - 6:int(vx1) + 6] = ink
    arr[int(vy0) - 6:int(vy1) + 6, int(vx0) - 6:int(vx0) - 2] = ink
    arr[int(vy0) - 6:int(vy1) + 6, int(vx1) + 2:int(vx1) + 6] = ink
    _SCENES[st["scene"]](arr, w, h, vx0, vy0, vx1, vy1, P)
    # seal (left) + ball medallion (right)
    _serrated_seal(arr, 132, (vy0 + vy1) / 2, 62, asp, ink, ink2, "FH")
    K.draw_text(arr, "RESERVE", 132, (vy0 + vy1) / 2 + 88, 1, tuple(ink2))
    K._stamp_golf_ball(arr, w - 130, (vy0 + vy1) / 2, 54, tuple(pale), tuple(ink2))
    # serial numbers, twice, in their own ink
    K.draw_text(arr, serial, 214, y0 + 136, 2, tuple(serial_ink), align="left")
    K.draw_text(arr, serial, w - 330, y1 - 86, 2, tuple(serial_ink), align="left")
    # microtext rule under the vignette
    micro = " - ".join(["FAIRHOLLOW GOLF CLUB RESERVE"] * 2)
    K.draw_text(arr, micro, w // 2, vy1 + 16, 1, tuple(ink2))
    # signatures + offices
    _squiggle(arr, 190, 340, y1 - 66, 6, ink, 40 + denom)
    K.draw_text(arr, "CLUB SECRETARY", 265, y1 - 44, 1, tuple(ink2))
    _squiggle(arr, w - 340, w - 190, y1 - 66, 6, ink, 90 + denom)
    K.draw_text(arr, "KEEPER OF THE GREEN", w - 265, y1 - 44, 1, tuple(ink2))
    # value banner
    value_text = f"{label} UNIT" if denom == 1 else f"{label} UNITS"
    arr[y1 - 84:y1 - 42, 372:w - 372] = tint * 0.30
    K.draw_text(arr, value_text, w // 2, y1 - 63, 3, tuple(pale))

    # ---------------------------------------------------------------- BACK ----
    y0, y1 = 518, h
    _bill_frame(arr, 0, y0, w, y1, ink, ink2, field)
    corner_panels(y0, y1, 7 if denom < 10 else 6)
    K.draw_text(arr, "FAIRHOLLOW GOLF CLUB", w // 2, y0 + 88, 4, tuple(ink))
    vx0, vy0, vx1, vy1 = 262, y0 + 150, w - 262, y1 - 118
    arr[int(vy0) - 6:int(vy0) - 2, int(vx0) - 6:int(vx1) + 6] = ink
    arr[int(vy1) + 2:int(vy1) + 6, int(vx0) - 6:int(vx1) + 6] = ink
    arr[int(vy0) - 6:int(vy1) + 6, int(vx0) - 6:int(vx0) - 2] = ink
    arr[int(vy0) - 6:int(vy1) + 6, int(vx1) + 2:int(vx1) + 6] = ink
    _SCENES[st["back"]](arr, w, h, vx0, vy0, vx1, vy1, P)
    K.draw_text(arr, "UNITED BY THE FAIRWAY", w // 2, y0 + 120, 1, tuple(ink2))
    arr[y1 - 92:y1 - 48, 340:w - 340] = tint * 0.30
    K.draw_text(arr, value_text, w // 2, y1 - 70, 3, tuple(pale))

    # ------------------------------------------------------------- wear -------
    # a fold goes THROUGH the paper: front and back share their crease lines
    # (the back's u is mirrored on the mesh, so mirror the positions here)
    crease_xs = [fx * w + float(rng.uniform(-14, 14)) for fx in (0.335, 0.655)]
    # edge grime: a soft gradient inside every outer border
    for (a, b) in ((0, 506), (518, h)):
        d = np.minimum.reduce([
            np.maximum(yy - a, 0), np.maximum(b - 1 - yy, 0),
            xx, (w - 1 - xx),
        ])
        g = np.clip(d / 30.0, 0, 1)[..., None]
        band = (yy >= a) & (yy < b)
        arr[band] = arr[band] * (0.90 + 0.10 * g[band])
        for cx0 in crease_xs:
            cxp = cx0 if a == 0 else (w - cx0)
            crease = band & (np.abs(xx - cxp) < 1.6)
            arr[crease] *= 0.93
            lit = band & (np.abs(xx - (cxp + 2.6)) < 1.2)
            arr[lit] = np.clip(arr[lit] * 1.05, 0, 1)
    # scattered handling flecks
    for _ in range(64):
        fx, fy = int(rng.integers(10, w - 10)), int(rng.integers(10, h - 10))
        if 500 < fy < 524:
            continue
        r = float(rng.uniform(0.8, 2.0))
        arr[K._ellipse_mask(w, h, fx, fy, r, r)] *= float(rng.uniform(0.82, 0.94))

    # paper edge strip: EXACTLY the uv window the mesh edge faces sample
    arr[507:517, 2:40] = paper * 1.05
    return K.np_image(f"Bill_{denom}", arr)


# ================================================================= coinage =====
# Monotonic size ladder (value grows with the coin — deliberately un-US),
# five distinct alloys, relief baked to color + a real normal map.
COIN_SPECS = {
    # code: (label, radius m, thickness m, segments)
    "01": ("1", 0.0090, 0.0014, 26),
    "05": ("5", 0.0105, 0.0016, 26),
    "10": ("10", 0.0120, 0.0018, 28),
    "25": ("25", 0.0130, 0.0020, 28),
    "50": ("50", 0.0150, 0.0022, 32),
}

COIN_STYLE = {
    # core rgb, collar rgb (None = mono-metal), roughness, value word, reeded?
    "01": dict(core=(0.420, 0.235, 0.130), ring=None, rough=0.46, word="ONE UNIT", reeded=False),
    "05": dict(core=(0.400, 0.410, 0.385), ring=None, rough=0.38, word="FIVE UNITS", reeded=True),
    "10": dict(core=(0.500, 0.360, 0.100), ring=None, rough=0.36, word="TEN UNITS", reeded=True),
    "25": dict(core=(0.480, 0.500, 0.545), ring=None, rough=0.30, word="TWENTY FIVE", reeded=True),
    "50": dict(core=(0.270, 0.280, 0.310), ring=(0.550, 0.400, 0.130), rough=0.33, word="FIFTY UNITS", reeded=True),
}


def _layer(w, h):
    """A scratch canvas for stamping shapes destined for the height field."""
    return np.zeros((h, w, 3), "float32")


def _arc_text(arr, hgt, text, cx, cy, r, a0, a1, px, col, hval, asp, *, bottom=False):
    """Stamp 5x7 glyphs along an arc, each rotated radially (classic coin
    legend).  Angles in radians, screen convention (y down; -pi/2 = top).
    bottom=True flips the glyph frame so a lower-arc legend reads upright
    (letter tops toward the coin centre)."""
    n = len(text)
    if n == 0:
        return
    h_, w_ = arr.shape[:2]
    colv = np.array(col, "float32")
    for i, ch in enumerate(text):
        glyph = K._F.get(ch.upper())
        if glyph is None or ch == " ":
            continue
        t = 0.5 if n == 1 else i / (n - 1)
        th = a0 + (a1 - a0) * t
        gx, gy = cx + r * math.cos(th), cy + r * math.sin(th) * asp
        if bottom:
            tangent = (math.sin(th), -math.cos(th))   # reading direction
            down = (math.cos(th), math.sin(th))       # away from the centre
        else:
            tangent = (-math.sin(th), math.cos(th))   # reading direction
            down = (-math.cos(th), -math.sin(th))     # toward the coin centre
        for rr_ in range(7):
            for cc_ in range(5):
                if glyph[rr_][cc_] != "1":
                    continue
                lx, ly = (cc_ - 2.0) * px, (rr_ - 3.0) * px
                ox = lx * tangent[0] + ly * down[0]
                oy = (lx * tangent[1] + ly * down[1]) * asp
                xa, ya = int(gx + ox - px / 2), int(gy + oy - px / 2)
                if 0 <= xa and xa + px <= w_ and 0 <= ya and ya + px <= h_:
                    arr[ya:ya + px, xa:xa + px] = colv
                    hgt[ya:ya + px, xa:xa + px] = np.maximum(hgt[ya:ya + px, xa:xa + px], hval)


def _crown(canvas, cx, cy, s, asp):
    """An original three-point club crown (band, points, pearls)."""
    h_, w_ = canvas.shape[:2]
    one = (1.0, 1.0, 1.0)
    band = _rect(w_, h_, cx - 16 * s, cy + 2 * s * asp, cx + 16 * s, cy + 8 * s * asp)
    canvas[band] = one
    pts = [(-12, 0), (0, -4), (12, 0)]
    for (ox, tip) in pts:
        canvas[_poly_mask(w_, h_, [
            (cx + (ox - 5) * s, cy + 2 * s * asp),
            (cx + (ox + 5) * s, cy + 2 * s * asp),
            (cx + ox * s, cy + (tip - 12) * s * asp)])] = one
        canvas[K._ellipse_mask(w_, h_, cx + ox * s, cy + (tip - 14) * s * asp, 2.2 * s, 2.2 * s * asp)] = one


def _crossed_clubs(canvas, cx, cy, s, asp):
    """Two crossed golf clubs — shafts, heads and butt caps."""
    h_, w_ = canvas.shape[:2]
    one = (1.0, 1.0, 1.0)
    for sgn in (-1, 1):
        x0, y0 = cx - sgn * 26 * s, cy - 30 * s * asp
        x1, y1 = cx + sgn * 26 * s, cy + 30 * s * asp
        canvas[K._seg_mask(w_, h_, x0, y0, x1, y1, 2.4 * s)] = one
        # driver head at the top end, toe out
        canvas[K._ellipse_mask(w_, h_, x0 - sgn * 5 * s, y0 - 3 * s * asp, 7.5 * s, 5.5 * s * asp)] = one
        # butt cap
        canvas[K._ellipse_mask(w_, h_, x1, y1 + 2 * s * asp, 3.2 * s, 3.2 * s * asp)] = one


def _leaf_sprig(canvas, cx, cy, s, asp):
    """The 1-unit reverse: a five-leaf sprig (original, not any state emblem)."""
    h_, w_ = canvas.shape[:2]
    one = (1.0, 1.0, 1.0)
    canvas[K._seg_mask(w_, h_, cx, cy + 34 * s * asp, cx, cy - 30 * s * asp, 1.8 * s)] = one
    leaves = [(0, -34, 0.0), (-14, -16, -0.6), (14, -16, 0.6), (-16, 6, -0.9), (16, 6, 0.9)]
    for (ox, oy, rot) in leaves:
        lx, ly = cx + ox * s, cy + oy * s * asp
        rx = 4.6 * s + 3.4 * s * abs(math.cos(rot))
        ry = (4.6 * s + 3.4 * s * abs(math.sin(rot))) * asp
        canvas[K._ellipse_mask(w_, h_, lx, ly, rx, ry)] = one
        canvas[K._seg_mask(w_, h_, cx, cy + oy * s * asp * 0.4, lx, ly, 0.9 * s)] = one


def coin_img(code, *, w=512, h=1024):
    """Sheet-02 coin faces: obverse = arc legend + laurel + numeral + ball,
    reverse = crown over crossed clubs (leaf sprig on the 1).  Returns
    (color_image, normal_image); relief lives in a real height field."""
    st = COIN_STYLE[code]
    label, _r, _t, _segs = COIN_SPECS[code]
    rng = np.random.default_rng(310 + int(code))
    core = np.array(st["core"], "float32")
    ring = None if st["ring"] is None else np.array(st["ring"], "float32")
    dark = core * 0.45
    bright = np.clip(core * 1.5, 0, 1)
    AY = (0.462 * h) / w                       # v-span of one face vs u-span

    arr = np.ones((h, w, 3), "float32") * core
    arr *= (1.0 + (L._fbm(rng, w, h, 40, 40, 4)[..., None] - 0.5) * 0.06)
    hgt = np.zeros((h, w), "float32")

    R = int(w * 0.462)                         # face radius in px (mesh edge = w/2)
    CORE_R = 0.56                              # bimetal core boundary (of R)

    def metal_at(rr_):
        """The local alloy per pixel: collar metal outside CORE_R on a bimetal."""
        if ring is None:
            return np.broadcast_to(core, (h, w, 3))
        return np.where((rr_ < R * CORE_R)[..., None], core, ring)

    def face(cy, front):
        cx = w / 2
        yy, xx = np.mgrid[0:h, 0:w].astype("float32")
        rr = np.hypot(xx - cx, (yy - cy) / AY)
        ang = np.arctan2((yy - cy) / AY, xx - cx)
        fmask = rr < (R + 22)
        metal_out = ring if ring is not None else core

        if ring is not None:                    # bimetallic collar + seam groove
            cm = fmask & (rr >= R * CORE_R)
            arr[cm] = ring * (1.0 + (L._fbm(rng, w, h, 40, 40, 3) - 0.5)[cm][..., None] * 0.05)
            seam = fmask & (rr > R * (CORE_R - 0.015)) & (rr < R * (CORE_R + 0.015))
            arr[seam] = (core * 0.5 + ring * 0.5) * 0.55
            hgt[fmask & (rr < R * (CORE_R - 0.015))] += 0.22
        # machining rings over whatever alloy is local
        arr[fmask] = np.clip(arr[fmask] * (1.0 + (np.sin(rr * 0.95) * 0.015)[fmask][..., None]), 0, 1)
        # raised rim + the turned shadow just inside it
        rim = fmask & (rr > R - 14) & (rr < R + 16)
        arr[rim] = np.clip(metal_out * 1.22, 0, 1)
        hgt[rim] = np.maximum(hgt[rim], 1.0)
        inner_shadow = fmask & (rr > R - 22) & (rr < R - 14)
        arr[inner_shadow] = metal_out * 0.68

        lm = metal_at(rr)                       # local alloy per pixel

        def relief(mask, tone, hval):
            arr[mask] = np.clip(lm[mask] * tone, 0, 1)
            hgt[mask] = np.maximum(hgt[mask], hval)

        if front:
            # laurel: two offset rows of tapered leaf lozenges, bound by rings
            side = (np.sin(ang) > -0.42)        # leave the top arc for the legend
            for (r0, r1, phase) in ((0.645, 0.715, 0.0), (0.725, 0.795, 0.5)):
                seg = (ang + math.pi) / (math.pi / 22) + phase
                frac = seg - np.floor(seg)
                taper = 4.0 * frac * (1.0 - frac)          # 0 at dash ends, 1 mid-leaf
                mid = (r0 + r1) / 2
                half = (r1 - r0) / 2
                lz = np.abs(rr / R - mid) < (half * (0.25 + 0.75 * taper))
                on = ((np.floor(seg).astype("int32") % 2) == 0)
                relief(fmask & lz & on & side, 0.78, 0.5)
            for br0, br1 in ((0.615, 0.632), (0.815, 0.832)):
                relief(fmask & (rr > R * br0) & (rr < R * br1) & side, 0.70, 0.32)
            # legend on the top arc, engraved
            leg_col = tuple((metal_out * 0.72).tolist())
            _arc_text(arr, hgt, st["word"], cx, cy, R * 0.72, -math.pi * 0.84, -math.pi * 0.16,
                      max(3, w // 128), leg_col, 0.55, AY)
            # the big minted numeral (the ref reads value-first at a glance)
            npx = 26 if len(label) < 2 else 18
            num_col = np.clip(ring * 1.05, 0, 1) if ring is not None else np.clip(core * 1.24, 0, 1)
            canvas = _layer(w, h)
            K.draw_text(canvas, label, int(cx), int(cy), npx, (1, 1, 1))
            m = canvas[..., 0] > 0.5
            sh = np.roll(np.roll(m, 4, axis=0), 4, axis=1) & ~m   # struck shadow
            arr[sh] = lm[sh] * 0.62
            arr[m] = num_col
            hgt[m] = np.maximum(hgt[m], 0.92)
            # the dimpled ball at the wreath's bottom tie
            canvas = _layer(w, h)
            K._stamp_golf_ball(canvas, int(cx), int(cy + R * 0.70 * AY), int(R * 0.115), (1, 1, 1), (0.4, 0.4, 0.4))
            m = canvas[..., 0] > 0.05
            shade = canvas[..., 0][m][..., None]
            arr[m] = np.clip(lm[m] * (0.72 + 0.52 * shade), 0, 1)
            hgt[m] = np.maximum(hgt[m], 0.30 + canvas[..., 0][m] * 0.45)
        else:
            relief(fmask & (rr > R * 0.84) & (rr < R * 0.865), 0.72, 0.35)
            # beaded border: minted dots around the collar
            bead_n = 44
            bead_seg = (ang + math.pi) / (2 * math.pi / bead_n)
            bfrac = bead_seg - np.floor(bead_seg)
            beads = (np.abs(rr / R - 0.905) < 0.022) & (np.abs(bfrac - 0.5) < 0.22)
            relief(fmask & beads, 1.16, 0.55)
            canvas = _layer(w, h)
            if code == "01":
                _leaf_sprig(canvas, cx, cy, w / 512 * 3.6, AY)
            else:
                _crown(canvas, cx, cy - R * 0.36 * AY, w / 512 * 2.8, AY)
                _crossed_clubs(canvas, cx, cy + R * 0.14 * AY, w / 512 * 3.2, AY)
            m = canvas[..., 0] > 0.5
            sh = np.roll(np.roll(m, 3, axis=0), 3, axis=1) & ~m
            arr[sh] = lm[sh] * 0.60
            relief(m, 0.72, 0.7)
            arc_col = tuple((metal_out * 0.72).tolist())
            _arc_text(arr, hgt, "FAIRHOLLOW", cx, cy, R * 0.70, -math.pi * 0.82, -math.pi * 0.18,
                      max(3, w // 150), arc_col, 0.5, AY)
            _arc_text(arr, hgt, "GOLF CLUB", cx, cy, R * 0.70, math.pi * 0.80, math.pi * 0.20,
                      max(3, w // 150), arc_col, 0.5, AY, bottom=True)

    face(int(h * 0.25), front=True)
    face(int(h * 0.75), front=False)

    # ------------------------------------------------ edge band at the seam ---
    edge_metal = ring if ring is not None else core
    band_rows = slice(h // 2 - 14, h // 2 + 14)
    band = np.ones((28, w, 3), "float32") * edge_metal * 0.88
    if st["reeded"]:
        reed = ((np.arange(w) // 3) % 2 == 0)
        band[:, reed] = edge_metal * 1.14
        hgt[band_rows, :] = np.where(reed[None, :], 0.5, 0.1)
    else:
        band *= (1.0 + (L._fbm(rng, w, 28, 60, 2, 2)[..., None] - 0.5) * 0.05)
        hgt[band_rows, :] = 0.25
    arr[band_rows] = np.clip(band, 0, 1)

    # ------------------------------------------------------------- wear -------
    wearn = L._fbm(rng, w, h, 9, 9, 3)
    hi = hgt > 0.62                              # crests polish bright
    arr[hi] = np.clip(arr[hi] * (1.0 + 0.16 * wearn[hi][..., None]), 0, 1)
    lo = (hgt > 0.01) & (hgt < 0.30)             # recesses hold tarnish
    arr[lo] *= (1.0 - 0.14 * (1 - wearn[lo])[..., None])
    # occlusion at relief boundaries
    gy_, gx_ = np.gradient(_blur(hgt, 1))
    ao = np.clip(np.hypot(gx_, gy_) * 1.8, 0, 0.30)
    arr *= (1.0 - ao[..., None] * 0.8)

    # ------------------------------------------------------- normal map -------
    hs = _blur(hgt, 2) * (w / 512 * 2.6)         # relief strength in px
    gy_, gx_ = np.gradient(hs)
    nx, ny, nz = -gx_, gy_, np.ones_like(hs)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nrm = np.stack([nx / ln, ny / ln, nz / ln], axis=-1) * 0.5 + 0.5
    col_img = K.np_image(f"Coin_{code}", arr)
    nrm_img = np_data_image(f"Coin_{code}_N", nrm)
    return col_img, nrm_img


def np_data_image(name, arr):
    """A packed NON-COLOR data image (normal maps) — raw values, no transfer."""
    import bpy
    h, w = arr.shape[:2]
    img = L._img(name, w, h)
    img.colorspace_settings.name = "Non-Color"
    rgba = np.concatenate([np.clip(arr[::-1], 0, 1), np.ones((h, w, 1), "float32")], axis=2)
    img.pixels[:] = rgba.ravel().tolist()
    img.update()
    img.pack()
    try:
        dup = img.copy()
        dup.filepath_raw = str(K.TEX_DIR / f"{name}.png")
        dup.file_format = "PNG"
        dup.save()
        bpy.data.images.remove(dup)
    except Exception:
        pass
    return img
