"""Prime Fairways original brand marks + shared packaging scaffolds.

All artwork is composed procedurally into linear float arrays (top-down) with
proshop_lib's drawing kit — no third-party logos, no copied commercial art.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import proshop_lib as P


# ------------------------------------------------------------------ marks -----

def crest(arr, cx, cy, s, gold, *, field=(0.03, 0.033, 0.036), mono="PF"):
    """Shield crest: gold shield outline, dark field, gold monogram + chevron."""
    w2 = s * 0.42
    top = cy - s * 0.5
    waist = cy + s * 0.12
    tip = cy + s * 0.5
    for inset, col in ((0.0, gold), (0.09, field)):
        wi = w2 * (1 - inset * 1.8)
        ti, tp = top + s * inset, tip - s * inset * 1.4
        P.rect(arr, cx - wi, ti, cx + wi, waist, col)
        P.tri(arr, (cx - wi, waist), (cx + wi, waist), (cx, tp), col)
    P.draw_text(arr, mono, cx, cy - s * 0.10, max(1, int(s / 24)), gold)
    P.tri(arr, (cx - s * 0.15, cy + s * 0.26), (cx + s * 0.15, cy + s * 0.26), (cx, cy + s * 0.10), gold)
    return arr


def flag_mound(arr, cx, cy, s, col):
    """Flag-on-mound icon (bottles, scorecards): two mound arcs + pole + pennant."""
    P.disc(arr, cx - s * 0.18, cy + s * 0.32, s * 0.34, s * 0.13, col)
    P.disc(arr, cx + s * 0.22, cy + s * 0.38, s * 0.30, s * 0.11, col)
    P.rect(arr, cx - s * 0.02, cy - s * 0.48, cx + s * 0.02, cy + s * 0.30, col)
    P.tri(arr, (cx + s * 0.02, cy - s * 0.48), (cx + s * 0.02, cy - s * 0.22), (cx + s * 0.34, cy - s * 0.35), col)
    return arr


def arrow_mark(arr, cx, cy, s, col):
    """The PF performance 'A' arrow: peaked chevron with a cut counter."""
    P.tri(arr, (cx - s * 0.5, cy + s * 0.5), (cx + s * 0.5, cy + s * 0.5), (cx, cy - s * 0.5), col)
    # cut the inner counter with background sample just below centre
    bg = arr[min(arr.shape[0] - 1, int(cy + s * 0.75))][int(cx)].tolist()
    P.tri(arr, (cx - s * 0.22, cy + s * 0.5), (cx + s * 0.22, cy + s * 0.5), (cx, cy + s * 0.02), bg)
    return arr


def p_roundel(arr, cx, cy, r, col, *, bg=None):
    """P monogram in a thin circle (tee boxes / small goods)."""
    P.ring(arr, cx, cy, r, r, max(2, int(r * 0.12)), col)
    P.draw_text(arr, "P", cx, cy, max(1, int(r / 5)), col)
    return arr


def wordmark(arr, cx, cy, px, col, *, sub=None, sub_col=None):
    P.draw_text(arr, "PRIME FAIRWAYS", cx, cy, px, col)
    if sub:
        P.draw_text(arr, sub, cx, cy + px * 11, max(1, px - 1), sub_col or col)
    return arr


# ------------------------------------------------------- packaging scaffolds ---

def hangcard_arr(w, h, *, base, band, title, subtitle, accent, seed=7, sku="PF"):
    """Standard PF hang-card: euro-slot, gradient header band, title block,
    footer barcode.  Caller adds product-specific art in the middle window."""
    arr = P.canvas(base, w, h, ss=3, mottle=0.03, seed=seed)
    P.frame(arr, 4, 4, w - 4, h - 4, 3, band)
    # euro slot
    P.rect(arr, w * 0.34, h * 0.045, w * 0.66, h * 0.075, (0.05, 0.05, 0.05))
    P.disc(arr, w * 0.5, h * 0.06, w * 0.045, h * 0.02, (0.05, 0.05, 0.05))
    # header band (soft gradient)
    P.vgrad(arr, 4, h * 0.10, w - 4, h * 0.235, tuple(c * 1.25 for c in band), tuple(c * 0.8 for c in band))
    P.draw_text(arr, "PRIME FAIRWAYS", w // 2, int(h * 0.14), max(1, w // 170), accent)
    P.draw_text(arr, title, w // 2, int(h * 0.185), max(2, w // 110), (0.93, 0.92, 0.88))
    if subtitle:
        P.draw_text(arr, subtitle, w // 2, int(h * 0.222), max(1, w // 190), accent)
    # footer
    P.barcode(arr, int(w * 0.30), int(h * 0.905), int(w * 0.70), int(h * 0.975), seed=seed, digits=sku)
    return arr


def icon_row(arr, cx, cy, items, r, col, *, gap=None, px=1):
    gap = gap or int(r * 3.2)
    x = cx - gap * (len(items) - 1) / 2
    for label in items:
        P.ring(arr, x, cy, r, r, max(2, int(r * 0.16)), col)
        P.draw_text(arr, label, int(x), int(cy + r * 1.75), px, col)
        x += gap
    return arr
