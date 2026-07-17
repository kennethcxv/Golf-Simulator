"""Pinehollow golf club display wall — Drivers/Irons/Wedges/Putters (ref: HCR9LxGV)."""
import sys
import math
sys.path.insert(0, "tools/blender")
import lib_props as L


def build(M):
    W, Dd = 1.92, 0.50
    root = L.asset_root("club_wall", (W, Dd, 2.10))
    backY = Dd / 2 - 0.02
    frontY = -Dd / 2 + 0.02
    cols = (-0.66, -0.22, 0.22, 0.66)
    rails = (-0.88, -0.44, 0.0, 0.44, 0.88)
    labels = ("DRIVERS", "IRONS", "WEDGES", "PUTTERS")

    # ---- base cabinet: plinth + 4 doors + oak counter ----
    baseH = 0.80
    L.plinth("Plinth", W, Dd, 0.10, M, parent=root, toe="walnut")
    for ex in (-1, 1):
        L.box(f"BaseSide_{ex}", (0.03, Dd, baseH - 0.10), (ex * (W / 2 - 0.015), 0, 0.10 + (baseH - 0.10) / 2), M["walnut"], bevel=0.004, parent=root)
    L.wood_slab("Counter", (W, Dd, 0.04), (0, 0, baseH), M["oak"], bevel=0.006, parent=root)
    for i in range(4):
        cx = -W / 2 + W / 8 + i * (W / 4)
        L.cabinet_door(f"Door_{i}", cx, 0.45, W / 4 - 0.03, baseH - 0.24, M, root, y=frontY + 0.002, pull="bar")

    # ---- upper hutch: sides, crown, cream back, green sign ----
    topZ = 1.95
    for ex in (-1, 1):
        L.box(f"Side_{ex}", (0.05, Dd, topZ - baseH), (ex * (W / 2 - 0.025), 0, baseH + (topZ - baseH) / 2), M["walnut"], bevel=0.005, parent=root)
    L.box("Back", (W - 0.10, 0.016, topZ - baseH - 0.04), (0, backY, baseH + (topZ - baseH) / 2), M["cream"], bevel=0.0, parent=root)
    L.box("Crown", (W, Dd, 0.06), (0, 0, topZ + 0.03), M["walnut"], bevel=0.006, parent=root)
    L.sign_panel("Sign", 0.0, topZ - 0.02, 0.44, 0.16, M, root, y=backY - 0.06, thick=0.022)

    # vertical black rails
    for rx in rails:
        L.box(f"Rail_{rx:.2f}", (0.022, 0.03, topZ - baseH - 0.06), (rx, backY - 0.03, baseH + (topZ - baseH) / 2), M["steel"], bevel=0.003, parent=root)

    tilt = math.radians(-15)
    for c, cx in enumerate(cols):
        # club-head display shelves near the top (3 small angled walnut shelves)
        for r, z in enumerate((1.60, 1.68, 1.76)):
            hx = cx - 0.13 + r * 0.13
            L.box(f"Head_{c}_{r}", (0.11, 0.10, 0.012), (hx, frontY + 0.07, z), M["walnut"], rot=(tilt, 0, 0), bevel=0.003, parent=root)
        # grip holders near the bottom (black U-frames on short arms)
        for r in range(3):
            hx = cx - 0.13 + r * 0.13
            gz = 1.05 + r * 0.02
            L.box(f"GripArm_{c}_{r}", (0.016, 0.10, 0.016), (hx, backY - 0.08, gz), M["black"], bevel=0.003, parent=root)
            L.box(f"Grip_{c}_{r}", (0.05, 0.016, 0.05), (hx, backY - 0.14, gz), M["black"], bevel=0.006, parent=root)
        # category label on the counter
        L.sign_panel(f"Lbl_{c}", cx, baseH + 0.045, 0.20, 0.055, M, root, y=frontY - 0.005, thick=0.016)
        L.sign_text(f"LblT_{c}", labels[c], cx, baseH + 0.045, 0.03, M, root, y=frontY - 0.02)

    L.collision_box("COL_Base", (W, Dd, baseH), (0, 0, baseH / 2), M, parent=root)
    L.collision_box("COL_Upper", (W, Dd, topZ - baseH + 0.1), (0, 0, baseH + (topZ - baseH) / 2), M, parent=root)
    return root


L.run("club_wall", build)
