"""Pinehollow "GOLF BALLS" display cabinet — angled shelves + 2-door base (ref: 2v49JthG)."""
import sys
import math
sys.path.insert(0, "tools/blender")
import lib_props as L


def build(M):
    W, Dd = 1.05, 0.52
    root = L.asset_root("golf_balls_display", (W, Dd, 1.56))
    backY = Dd / 2 - 0.02

    # ---- base cabinet (z 0..0.52) ----
    baseH = 0.52
    L.plinth("BasePlinth", W, Dd, 0.06, M, parent=root, toe="walnut")
    for ex in (-1, 1):
        L.box(f"BaseSide_{ex}", (0.028, Dd, baseH - 0.06), (ex * (W / 2 - 0.014), 0, 0.06 + (baseH - 0.06) / 2), M["walnut"], bevel=0.004, parent=root)
    L.box("BaseBack", (W, 0.02, baseH - 0.06), (0, backY, 0.06 + (baseH - 0.06) / 2), M["walnut"], bevel=0.004, parent=root)
    L.wood_slab("Counter", (W, Dd, 0.03), (0, 0, baseH), M["walnut"], bevel=0.005, parent=root)
    for sx in (-1, 1):
        L.cabinet_door(f"Door_{sx}", sx * 0.255, 0.30, 0.49, 0.40, M, root, y=-Dd / 2 + 0.012, pull="bar")

    # ---- upper hutch (z 0.55..1.55) ----
    hutchY = 0.24                     # hutch is shallower; its back sits toward +Y
    hutch_backY = Dd / 2 - 0.02
    hutch_front = hutch_backY - hutchY
    for ex in (-1, 1):
        L.box(f"HutchSide_{ex}", (0.028, hutchY + 0.02, 1.00), (ex * (W / 2 - 0.014), hutch_backY - hutchY / 2, baseH + 0.03 + 0.50), M["walnut"], bevel=0.004, parent=root)
    # cream slat back
    L.box("HutchBack", (W - 0.06, 0.018, 1.00), (0, hutch_backY, baseH + 0.03 + 0.50), M["cream"], bevel=0.0, parent=root)
    # crown
    L.box("Crown", (W, hutchY + 0.05, 0.05), (0, hutch_backY - hutchY / 2, baseH + 1.06), M["walnut"], bevel=0.006, parent=root)

    # 4 angled shelves
    tilt = math.radians(-13)
    for i, z in enumerate((0.66, 0.85, 1.04, 1.23)):
        cz = baseH + z - 0.52 + 0.20
        L.box(f"Shelf_{i}", (W - 0.10, 0.24, 0.020), (0, hutch_front + 0.10, cz), M["walnut"], rot=(tilt, 0, 0), bevel=0.004, parent=root)
        L.box(f"ShelfLip_{i}", (W - 0.10, 0.014, 0.05), (0, hutch_front - 0.02, cz - 0.03), M["acrylic"], bevel=0.003, parent=root)
        L.box(f"Label_{i}", (0.06, 0.012, 0.038), (0, hutch_front - 0.03, cz - 0.03), M["brass"], bevel=0.004, parent=root)

    # top sign: green nameplate + gold GOLF BALLS
    signZ = baseH + 1.00
    L.sign_panel("Sign", 0.0, signZ, W - 0.18, 0.17, M, root, y=hutch_front - 0.01, thick=0.02)
    L.sign_text("SignText", "GOLF BALLS", 0.0, signZ, 0.085, M, root, y=hutch_front - 0.03)
    for ex in (-1, 1):
        L.corner_bracket(f"Cnr_{ex}", ex * (W / 2 - 0.03), hutch_front - 0.01, baseH + 1.05, M, root, s=0.05)

    L.collision_box("COL_Base", (W, Dd, baseH), (0, 0, baseH / 2), M, parent=root)
    L.collision_box("COL_Hutch", (W, hutchY + 0.05, 1.04), (0, hutch_backY - hutchY / 2, baseH + 0.55), M, parent=root)
    return root


L.run("golf_balls_display", build)
