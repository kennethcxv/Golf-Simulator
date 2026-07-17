"""Pinehollow wall shelving unit — black posts, cream slatwall, walnut shelves, 4-door base (ref: coJH2Uug)."""
import sys
sys.path.insert(0, "tools/blender")
import lib_props as L


def green_shelf(name, cx, cz, w, d, M, root):
    L.wood_slab(name, (w, d, 0.028), (cx, 0, cz), M["walnut"], bevel=0.005, parent=root)
    L.box(f"{name}_edge", (w + 0.004, 0.016, 0.05), (cx, -d / 2 - 0.006, cz), M["green"], bevel=0.004, parent=root)
    L.box(f"{name}_pin", (w + 0.006, 0.004, 0.006), (cx, -d / 2 - 0.014, cz + 0.018), M["gold"], bevel=0.0, parent=root)
    L.box(f"{name}_label", (0.07, 0.01, 0.03), (cx, -d / 2 - 0.014, cz), M["brass"], bevel=0.003, parent=root)


def build(M):
    W, Dd = 1.72, 0.50
    root = L.asset_root("wall_shelf", (W, Dd, 1.98))
    backY = Dd / 2 - 0.02
    frontY = -Dd / 2 + 0.02

    # ---- base cabinet + plinth + 4 doors + counter ----
    baseH = 0.80
    L.plinth("Plinth", W, Dd, 0.10, M, parent=root, toe="black")
    for ex in (-1, 1):
        L.box(f"BaseSide_{ex}", (0.03, Dd, baseH - 0.10), (ex * (W / 2 - 0.015), 0, 0.10 + (baseH - 0.10) / 2), M["walnut"], bevel=0.004, parent=root)
    L.box("BaseBack", (W, 0.02, baseH - 0.10), (0, backY, 0.10 + (baseH - 0.10) / 2), M["walnut"], bevel=0.004, parent=root)
    L.wood_slab("Counter", (W, Dd, 0.035), (0, 0, baseH), M["walnut"], bevel=0.006, parent=root)
    for i in range(4):
        cx = -W / 2 + W / 8 + i * (W / 4)
        L.cabinet_door(f"Door_{i}", cx, 0.44, W / 4 - 0.03, baseH - 0.24, M, root, y=frontY + 0.002, pull="bar")

    # ---- upper: black posts + cream slatwall + 3 shelves + green sign ----
    postTop = 1.94
    for ex in (-1, 1):
        L.box(f"Post_{ex}", (0.05, 0.06, postTop - baseH), (ex * (W / 2 - 0.05), backY - 0.02, baseH + (postTop - baseH) / 2), M["steel"], bevel=0.004, parent=root)
        L.box(f"Cap_{ex}", (0.056, 0.066, 0.02), (ex * (W / 2 - 0.05), backY - 0.02, postTop + 0.005), M["brass"], bevel=0.004, parent=root)
    L.box("Slatwall", (W - 0.18, 0.016, postTop - baseH - 0.12), (0, backY, baseH + 0.06 + (postTop - baseH - 0.12) / 2), M["slat"], bevel=0.0, parent=root)
    for i, z in enumerate((0.95, 1.28, 1.61)):
        # black bracket standards under each shelf
        for ex in (-1, 1):
            L.box(f"Brk_{i}_{ex}", (0.02, 0.24, 0.03), (ex * (W / 2 - 0.14), 0.02, z - 0.02), M["steel"], bevel=0.003, parent=root)
        green_shelf(f"Shelf_{i}", 0.0, z, W - 0.16, 0.30, M, root)
    # green rectangular sign spanning the post tops
    L.sign_panel("Sign", 0.0, postTop - 0.02, W - 0.20, 0.14, M, root, y=backY - 0.06, thick=0.022)

    L.collision_box("COL_Base", (W, Dd, baseH), (0, 0, baseH / 2), M, parent=root)
    L.collision_box("COL_Upper", (W, 0.14, postTop - baseH), (0, backY - 0.03, baseH + (postTop - baseH) / 2), M, parent=root)
    return root


L.run("wall_shelf", build)
