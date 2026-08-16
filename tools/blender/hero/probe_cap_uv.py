"""WHICH ATLAS CELL DOES EACH PART ACTUALLY LAND IN?

Two parts are rendering in a colour nobody assigned them: one snapback tail is
pale where the plastic cell is near-black, and the bill's underside is the
colour of its top where a dedicated charcoal cell exists for it. Both of those
are UV addressing, not modelling, and the way to find out is to read the UVs
off the finished mesh rather than to read the code that wrote them.

    blender --factory-startup -b --python tools/blender/hero/probe_cap_uv.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import hero_lib as H  # noqa: E402
import cloth_lib as CL  # noqa: E402
import build_cap as C  # noqa: E402

COLS, ROWS = C.ATLAS_COLS, C.ATLAS_ROWS
NAME = {0: "navy", 2: "fairway", 11: "cream", 14: "fairway-dark",
        24: "crest", 25: "underbrim", 26: "sweatband", 27: "plastic"}

H.reset_scene()
H.set_engine("EEVEE", samples=8)
parts = C.build("cream")
way = "cream"

print()
print(f"{'part':<16}{'asked for':<22}{'u range':<20}{'v range':<20}cells hit")
print("-" * 100)
bad = []
for key, ob in parts.items():
    if key == "brim":
        C.uv_two_cell(ob, C.WAYS[way][1], C.UNDERBRIM_CELL)
    elif ob.get("explicit_uv"):
        CL.cell_offset(ob, C.cell_for(key, way), COLS, ROWS)
    else:
        CL.texture_into_cell(ob, C.cell_for(key, way), COLS, ROWS)
    want = C.cell_for(key, way)
    uv = ob.data.uv_layers.active
    us = [d.uv[0] for d in uv.data]
    vs = [d.uv[1] for d in uv.data]
    hit = set()
    for u, v in zip(us, vs):
        cx = min(COLS - 1, max(0, int(u * COLS)))
        cy = min(ROWS - 1, max(0, int(v * ROWS)))
        hit.add((ROWS - 1 - cy) * COLS + cx)
    want_txt = f"{want} {NAME.get(want, '')}"
    hits = ",".join(f"{c}{'(' + NAME[c] + ')' if c in NAME else ''}"
                    for c in sorted(hit))
    flag = ""
    if key == "brim":
        if {C.WAYS[way][1], C.UNDERBRIM_CELL} - hit:
            flag = "  <-- MISSING one of its two cells"
            bad.append(key)
    elif hit != {want}:
        flag = "  <-- WRONG"
        bad.append(key)
    print(f"{key:<16}{want_txt:<22}{min(us):+.4f}..{max(us):+.4f}   "
          f"{min(vs):+.4f}..{max(vs):+.4f}   {hits}{flag}")

print()
print("cell 27 (plastic) occupies "
      f"u {3 / COLS:.4f}..{4 / COLS:.4f}, v {0 / ROWS:.4f}..{1 / ROWS:.4f}")
print()
if bad:
    print("PARTS IN THE WRONG CELL: " + ", ".join(bad))
else:
    print("every part lands in exactly the cell it was assigned")
