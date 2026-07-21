"""Pinehollow slatwall shelving unit — arched sign, hook bars + green-edged shelves, 4-door base (ref: 3vNknZxu)."""
import sys
import math
sys.path.insert(0, "tools/blender")
import lib_props as L


def green_shelf(name, cx, cz, w, d, M, root):
    L.wood_slab(name, (w, d, 0.028), (cx, 0, cz), M["walnut"], bevel=0.005, parent=root)
    L.box(f"{name}_edge", (w + 0.004, 0.016, 0.05), (cx, -d / 2 - 0.006, cz), M["green"], bevel=0.004, parent=root)
    L.box(f"{name}_pin", (w + 0.006, 0.004, 0.006), (cx, -d / 2 - 0.014, cz + 0.018), M["gold"], bevel=0.0, parent=root)
    L.box(f"{name}_label", (0.07, 0.01, 0.03), (cx, -d / 2 - 0.014, cz), M["brass"], bevel=0.003, parent=root)


def hook_bar(name, cx, cz, y, M, root, n=3, span=0.34):
    L.box(f"{name}_bar", (span, 0.016, 0.016), (cx, y - 0.02, cz), M["black"], bevel=0.003, parent=root)
    for i in range(n):
        hx = cx - span / 2 + 0.05 + i * (span - 0.1) / max(1, n - 1)
        L.box(f"{name}_mnt{i}", (0.03, 0.014, 0.04), (hx, y, cz), M["black"], bevel=0.003, parent=root)
        L.cyl(f"{name}_prong{i}", 0.006, 0.10, (hx, y - 0.05, cz), M["black"], rot=(math.radians(90), 0, 0), verts=10, parent=root)
        L.cyl(f"{name}_tip{i}", 0.006, 0.02, (hx, y - 0.098, cz + 0.008), M["black"], verts=10, parent=root)


def build(M):
    W, Dd = 1.70, 0.50
    root = L.asset_root("slat_shelf", (W, Dd, 2.02))
    backY = Dd / 2 - 0.02
    frontY = -Dd / 2 + 0.02
    topZ = 1.72

    # ---- base cabinet: plinth (black corners) + 4 knob doors + counter ----
    baseH = 0.78
    L.plinth("Plinth", W, Dd, 0.10, M, parent=root, toe="black")
    for ex in (-1, 1):
        L.box(f"BaseSide_{ex}", (0.03, Dd, baseH - 0.10), (ex * (W / 2 - 0.015), 0, 0.10 + (baseH - 0.10) / 2), M["walnut"], bevel=0.004, parent=root)
    L.wood_slab("Counter", (W, Dd, 0.035), (0, 0, baseH), M["walnut"], bevel=0.006, parent=root)
    L.box("CounterEdge", (W, 0.016, 0.04), (0, frontY, baseH), M["green"], bevel=0.004, parent=root)
    for i in range(4):
        cx = -W / 2 + W / 8 + i * (W / 4)
        L.cabinet_door(f"Door_{i}", cx, 0.42, W / 4 - 0.03, baseH - 0.24, M, root, y=frontY + 0.002, pull="knob")

    # ---- upper: walnut sides + cream slatwall + arched sign ----
    for ex in (-1, 1):
        L.box(f"Side_{ex}", (0.04, Dd - 0.06, topZ - baseH), (ex * (W / 2 - 0.02), 0.03, baseH + (topZ - baseH) / 2), M["walnut"], bevel=0.005, parent=root)
    L.box("Slatwall", (W - 0.12, 0.016, topZ - baseH - 0.02), (0, backY, baseH + (topZ - baseH) / 2), M["slat"], bevel=0.0, parent=root)
    L.box("Crown", (W, Dd - 0.04, 0.05), (0, 0.02, topZ + 0.02), M["walnut"], bevel=0.006, parent=root)
    L.sign_panel("Sign", 0.0, topZ + 0.14, W - 0.5, 0.20, M, root, y=frontY + 0.16, arched=True, thick=0.022)

    # LEFT half: 3 hook bars ; RIGHT half: 4 green-edged shelves on brackets
    for r, z in enumerate((0.98, 1.24, 1.50)):
        hook_bar(f"Hooks_{r}", -W / 4, z, backY - 0.03, M, root, n=3, span=0.36)
    for i, z in enumerate((0.92, 1.14, 1.36, 1.58)):
        for ex in (-1, 1):
            L.box(f"Brk_{i}_{ex}", (0.018, 0.24, 0.03), (W / 4 + ex * (W / 4 - 0.12), 0.02, z - 0.02), M["steel"], bevel=0.003, parent=root)
        green_shelf(f"Shelf_{i}", W / 4, z, W / 2 - 0.06, 0.28, M, root)

    L.collision_box("COL_Base", (W, Dd, baseH), (0, 0, baseH / 2), M, parent=root)
    L.collision_box("COL_Upper", (W, Dd, topZ - baseH), (0, 0.02, baseH + (topZ - baseH) / 2), M, parent=root)
    return root


L.run("slat_shelf", build)
