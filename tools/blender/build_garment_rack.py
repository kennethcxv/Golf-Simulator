"""Pinehollow rolling garment/display rack — black frame, hang rail, casters (ref: B1JC4BWX)."""
import sys
import math
sys.path.insert(0, "tools/blender")
import lib_props as L


def build(M):
    W, Dd = 0.88, 0.46
    px, py = 0.42, 0.175
    root = L.asset_root("garment_rack", (W, Dd, 1.05))

    mount = 0.0
    for sx in (-1, 1):
        for sy in (-1, 1):
            mount = L.caster(f"Cast_{sx}{sy}", sx * (px - 0.02), sy * py, 0.0, M, root, wheel_r=0.045)

    # base frame (black steel) holding a walnut shelf
    bz = mount + 0.02
    L.box("BaseFrF", (2 * px, 0.045, 0.05), (0, -py, bz), M["steel"], bevel=0.004, parent=root)
    L.box("BaseFrB", (2 * px, 0.045, 0.05), (0, py, bz), M["steel"], bevel=0.004, parent=root)
    for sx in (-1, 1):
        L.box(f"BaseFrS_{sx}", (0.045, 2 * py, 0.05), (sx * px, 0, bz), M["steel"], bevel=0.004, parent=root)
    L.wood_slab("Shelf", (2 * px - 0.05, 2 * py - 0.02, 0.028), (0, 0, bz + 0.028), M["walnut"], bevel=0.005, parent=root)

    # two end posts + brass caps
    post_top = 0.82
    for sx in (-1, 1):
        x = sx * px
        L.box(f"Post_{sx}", (0.044, 0.055, post_top - bz), (x, 0, (bz + post_top) / 2), M["steel"], bevel=0.004, parent=root)
        L.box(f"Cap_{sx}", (0.05, 0.06, 0.02), (x, 0, post_top + 0.005), M["brass"], bevel=0.004, parent=root)

    # top hang rail (round black tube)
    L.cyl("HangRail", 0.022, 2 * px, (0, 0, post_top - 0.02), M["steel"], rot=(0, math.radians(90), 0), verts=20, parent=root)

    # green nameplate sign on two short posts above the rail
    for sx in (-1, 1):
        L.box(f"SignPost_{sx}", (0.016, 0.02, 0.11), (sx * 0.09, 0, post_top + 0.045), M["steel"], bevel=0.003, parent=root)
    L.sign_panel("Sign", 0.0, post_top + 0.15, 0.30, 0.11, M, root, y=0.0, thick=0.02)

    L.collision_box("COL_Base", (2 * px + 0.06, Dd, 0.20), (0, 0, bz + 0.05), M, parent=root)
    L.collision_box("COL_Frame", (2 * px + 0.06, 0.12, post_top), (0, 0, post_top / 2), M, parent=root)
    return root


L.run("garment_rack", build)
