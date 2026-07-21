"""Pinehollow walnut pedestal desk — openable drawers + door (ref: 48C3LcJG)."""
import sys
import math
sys.path.insert(0, "tools/blender")
import bpy
import lib_props as L


def drawer(tag, cx, cz, w, h, front_y, depth, M, root, travel=0.30):
    fy = front_y - 0.004
    parts = [
        L.box(f"Dw{tag}Front", (w, 0.016, h), (cx, fy, cz), M["walnut"], bevel=0.005),
        L.box(f"Dw{tag}Back", (w - 0.024, 0.012, h - 0.016), (cx, fy + 0.012 + depth, cz), M["walnut_dk"], bevel=0.002),
        L.box(f"Dw{tag}Bot", (w - 0.02, depth, 0.008), (cx, fy + 0.012 + depth / 2, cz - h / 2 + 0.01), M["walnut_dk"], bevel=0.002),
        L.cyl(f"Dw{tag}Bar", 0.007, 0.135, (cx, fy - 0.024, cz), M["brass"], rot=(0, math.radians(90), 0), verts=12),
    ]
    for ex in (-1, 1):
        parts.append(L.box(f"Dw{tag}Side{ex}", (0.010, depth, h - 0.016), (cx + ex * (w / 2 - 0.007), fy + 0.012 + depth / 2, cz), M["walnut_dk"], bevel=0.002))
        parts.append(L.cyl(f"Dw{tag}Post{ex}", 0.006, 0.024, (cx + ex * 0.06, fy - 0.012, cz), M["brass"], rot=(math.radians(90), 0, 0), verts=10))
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    d = parts[0]
    d.name = f"Drawer_{tag}"
    d["movable"] = "drawer"
    d["slide_axis"] = "-Y"
    d["open_travel_m"] = travel
    L.parent_keep(d, root)
    return d


def pedestal(side, cx, M, root, doors=False):
    W, D, top = 0.40, 0.60, 0.73
    base = 0.06
    front_y = -D / 2 - 0.01
    # carcass shell
    for ex in (-1, 1):
        L.box(f"Ped{side}Side{ex}", (0.020, D, top - base), (cx + ex * (W / 2 - 0.01), 0, (base + top) / 2), M["walnut"], bevel=0.004, parent=root)
        # shaker panel on the outer visible side
        if ex == (-1 if cx < 0 else 1):
            L.box(f"Ped{side}Panel", (0.012, D - 0.12, top - base - 0.12), (cx + ex * (W / 2 + 0.001), 0, (base + top) / 2), M["walnut"], bevel=0.01, parent=root)
    L.box(f"Ped{side}Back", (W, 0.018, top - base), (cx, D / 2 - 0.01, (base + top) / 2), M["walnut"], bevel=0.004, parent=root)
    L.box(f"Ped{side}Floor", (W, D, 0.016), (cx, 0, base + 0.008), M["walnut_dk"], bevel=0.003, parent=root)
    # face frame
    fr = 0.020
    L.box(f"Ped{side}FrTop", (W, fr, 0.03), (cx, front_y, top - 0.02), M["walnut"], bevel=0.003, parent=root)
    L.box(f"Ped{side}FrBot", (W, fr, 0.03), (cx, front_y, base + 0.02), M["walnut"], bevel=0.003, parent=root)
    for ex in (-1, 1):
        L.box(f"Ped{side}FrStile{ex}", (0.026, fr, top - base), (cx + ex * (W / 2 - 0.013), front_y, (base + top) / 2), M["walnut"], bevel=0.003, parent=root)
    L.plinth(f"Ped{side}Plinth", W + 0.02, D + 0.01, base, M, parent=root, cx=cx, toe="walnut")

    if doors:  # right pedestal: small drawer on top + a door below
        L.box(f"Ped{side}MidRail", (W, fr, 0.026), (cx, front_y, top - 0.14), M["walnut"], bevel=0.003, parent=root)
        drawer(side + "R", cx, top - 0.075, 0.35, 0.088, front_y, 0.42, M, root)
        L.cabinet_door(f"Ped{side}Door", cx, (base + top - 0.16) / 2 + 0.02, 0.35, top - base - 0.20, M, root, y=front_y - 0.006, pull="bar")
    else:      # left pedestal: two drawers
        L.box(f"Ped{side}MidRail", (W, fr, 0.026), (cx, front_y, (base + top) / 2), M["walnut"], bevel=0.003, parent=root)
        drawer(side + "1", cx, top - 0.11, 0.35, 0.155, front_y, 0.42, M, root)
        drawer(side + "2", cx, base + 0.13, 0.35, 0.155, front_y, 0.42, M, root)


def build(M):
    W, D, TOPZ, TT = 1.35, 0.66, 0.75, 0.038
    root = L.asset_root("desk", (W, D, 0.77))
    L.wood_slab("Top", (W, D, TT), (0, 0, TOPZ), M["walnut"], bevel=0.008, parent=root)
    L.box("TopEdge", (W + 0.004, 0.012, TT + 0.006), (0, -D / 2, TOPZ), M["walnut"], bevel=0.004, parent=root)
    pedestal("L", -0.445, M, root, doors=False)
    pedestal("R", 0.445, M, root, doors=True)
    # kneehole modesty panel + cable grommet
    L.box("Modesty", (0.49, 0.016, 0.34), (0, D / 2 - 0.03, 0.55), M["walnut"], bevel=0.003, parent=root)
    L.cyl("Grommet", 0.028, 0.02, (0, D / 2 - 0.045, 0.60), M["black"], rot=(math.radians(90), 0, 0), verts=20, parent=root)
    L.collision_box("COL_Desk", (W, D, TOPZ), (0, 0, TOPZ / 2), M, parent=root)
    return root


L.run("desk", build)
