"""Tile every preview render into 5x5 contact sheets (with name strips) for
fast visual grading.  Output: assets/pro_shop/previews/audit/sheet_*.png"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import numpy as np
import proshop_lib as P

OUT = P.PREVIEW_DIR / "audit"
OUT.mkdir(parents=True, exist_ok=True)
THUMB = 256
GRID = 5

sources = []
for sub in ("products", "fixtures", "stocked"):
    d = P.PREVIEW_DIR / sub
    if d.exists():
        sources += sorted(d.glob("*.png"))


def load_thumb(path):
    img = bpy.data.images.load(str(path))
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1, :, :3]
    step = max(1, w // THUMB)
    t = px[::step, ::step][:THUMB, :THUMB]
    if t.shape[0] != THUMB or t.shape[1] != THUMB:
        pad = np.ones((THUMB, THUMB, 3), np.float32) * 0.2
        pad[:t.shape[0], :t.shape[1]] = t
        t = pad
    bpy.data.images.remove(img)
    return t


def label(arr, text):
    # simple dark strip + text via proshop draw (1x)
    arr[-26:, :] = arr[-26:, :] * 0.25
    P.draw_text(arr, text[:30].upper(), THUMB // 2, THUMB - 13, 1, (0.95, 0.95, 0.92))
    return arr


sheet_i = 0
for start in range(0, len(sources), GRID * GRID):
    batch = sources[start:start + GRID * GRID]
    sheet = np.ones((GRID * THUMB, GRID * THUMB, 3), np.float32) * 0.12
    for i, p in enumerate(batch):
        r, c = divmod(i, GRID)
        t = label(load_thumb(p), p.stem.replace("pf_", ""))
        sheet[r * THUMB:(r + 1) * THUMB, c * THUMB:(c + 1) * THUMB] = t
    out = bpy.data.images.new(f"sheet_{sheet_i}", GRID * THUMB, GRID * THUMB)
    rgba = np.concatenate([sheet[::-1], np.ones((GRID * THUMB, GRID * THUMB, 1), np.float32)], axis=2)
    out.pixels[:] = rgba.ravel().tolist()
    out.filepath_raw = str(OUT / f"sheet_{sheet_i:02d}.png")
    out.file_format = "PNG"
    out.save()
    print(f"SHEET|{out.filepath_raw}|{len(batch)} thumbs")
    sheet_i += 1
print(f"DONE|{len(sources)} previews in {sheet_i} sheets")
