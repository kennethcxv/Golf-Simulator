"""Phase 10: the fully assembled, fully stocked Prime Fairways pro shop.

Builds a warm retail room shell, places every fixture at its floor position,
stocks each via the Phase-6/7 placement plans (products at scale 1 on the
fixtures' named slots), saves prime_fairways_pro_shop_assembled.blend and
renders walkthrough views.

Run: blender --background --factory-startup --python tools/blender/assemble_pf_shop.py
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
from mathutils import Vector
import lib_props as L
import proshop_lib as P
import assemble_pf_stocked as A

ROOM_W, ROOM_D, ROOM_H = 9.6, 7.4, 3.1

# fixture id -> (x, y, rot_z_deg)  (fixtures face -Y at rot 0)
LAYOUT = [
    ("pf_fixture_apparel_wall", (-2.9, 3.28, 0)),
    ("pf_fixture_hat_wall", (-1.05, 3.33, 0)),
    ("pf_fixture_accessory_slatwall", (0.55, 3.31, 0)),
    ("pf_fixture_ball_shelf", (2.2, 3.36, 0)),
    ("pf_fixture_bag_display", (4.35, 1.6, -90)),
    ("pf_fixture_club_rack", (4.42, -0.6, -90)),
    ("pf_fixture_rangefinder_display", (4.42, -2.2, -90)),
    ("pf_fixture_shoe_display", (-4.42, 1.4, 90)),
    ("pf_fixture_snack_shelf", (-4.45, -0.6, 90)),
    ("pf_fixture_center_table", (-0.4, 0.9, 8)),
    ("pf_fixture_freestanding_gondola", (0.3, -1.3, -4)),
    ("pf_fixture_checkout_counter_shop", (-2.5, -2.4, 200)),
]


def room(M):
    wood = L.wood_slab("Room_Floor", (ROOM_W, ROOM_D, 0.05), (0, 0, -0.025), M["oak"])
    cream = P.m_tex("M_WallCream", P.np_image("WallCream", P.base_arr((0.55, 0.52, 0.44), 512, 512, mottle=0.03, seed=211)), rough=0.8)
    green = M["green"]
    for (nm, dims, loc) in [
        ("Room_WallBack", (ROOM_W, 0.1, ROOM_H), (0, ROOM_D / 2 + 0.05, ROOM_H / 2)),
        ("Room_WallLeft", (0.1, ROOM_D, ROOM_H), (-ROOM_W / 2 - 0.05, 0, ROOM_H / 2)),
        ("Room_WallRight", (0.1, ROOM_D, ROOM_H), (ROOM_W / 2 + 0.05, 0, ROOM_H / 2)),
    ]:
        L.box(nm, dims, loc, cream, bevel=0.0)
    # green wainscot band + baseboards
    for (nm, dims, loc) in [
        ("Room_WainBack", (ROOM_W, 0.03, 1.0), (0, ROOM_D / 2 - 0.015, 0.5)),
        ("Room_WainLeft", (0.03, ROOM_D, 1.0), (-ROOM_W / 2 + 0.015, 0, 0.5)),
        ("Room_WainRight", (0.03, ROOM_D, 1.0), (ROOM_W / 2 - 0.015, 0, 0.5)),
    ]:
        L.box(nm, dims, loc, green, bevel=0.0)
    for (nm, dims, loc) in [
        ("Room_BaseBack", (ROOM_W, 0.04, 0.12), (0, ROOM_D / 2 - 0.02, 0.06)),
        ("Room_BaseLeft", (0.04, ROOM_D, 0.12), (-ROOM_W / 2 + 0.02, 0, 0.06)),
        ("Room_BaseRight", (0.04, ROOM_D, 0.12), (ROOM_W / 2 - 0.02, 0, 0.06)),
    ]:
        L.box(nm, dims, loc, M["walnut"], bevel=0.0)
    # warm ceiling area lights
    for lx in (-2.4, 0.0, 2.4):
        for ly in (-1.6, 1.6):
            ld = bpy.data.lights.new(f"Shop_L{lx}{ly}", "AREA")
            ld.energy = 320
            ld.size = 1.4
            ld.color = (1.0, 0.86, 0.66)
            lo = bpy.data.objects.new(f"Shop_L{lx}{ly}", ld)
            lo.location = (lx, ly, ROOM_H - 0.08)
            bpy.context.collection.objects.link(lo)


def render_view(name, cam_pos, target, *, lens=26):
    sc = bpy.context.scene
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam = bpy.data.objects.new(name, cam_data)
    cam.location = cam_pos
    d = Vector(target) - Vector(cam_pos)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(cam)
    sc.camera = cam
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            sc.render.engine = eng
            break
        except Exception:
            continue
    try:
        sc.view_settings.view_transform = "AgX"
    except Exception:
        pass
    sc.render.resolution_x = 1600
    sc.render.resolution_y = 1000
    out = P.PREVIEW_DIR / "stocked" / f"shop_{name}.png"
    sc.render.filepath = str(out)
    bpy.ops.render.render(write_still=True)
    print(f"SHOPVIEW|{out.relative_to(P.ROOT)}")


def main():
    P.reset_scene()
    M = P.pf_materials()
    room(M)
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.48, 0.38, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.35
    bpy.context.scene.world = world

    for fx, (x, y, rz) in LAYOUT:
        fx_root, _ = A.import_glb(fx, kind="fixtures")
        fx_root.location = (x, y, 0)
        fx_root.rotation_euler = (0, 0, math.radians(rz))
        bpy.context.view_layer.update()
        slots = A.slot_map(fx_root)
        for row in A.PLANS[fx]():
            A.place(fx, fx_root, slots, *row[0:2], **(row[2] if len(row) > 2 else {}))
        print(f"SHOP_PLACED|{fx}")

    blend = A.ASSEMBLED / "prime_fairways_pro_shop_assembled.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), check_existing=False)
    print(f"SHOP_SAVED|{blend.relative_to(P.ROOT)}")

    render_view("entrance", (0.2, -5.6, 1.62), (0, 1.4, 1.25))
    render_view("apparel_corner", (1.6, -0.4, 1.60), (-2.6, 3.2, 1.3))
    render_view("clubs_corner", (2.3, -0.62, 1.52), (4.45, -0.60, 0.85), lens=30)
    render_view("bags_corner", (1.4, 3.0, 1.58), (4.5, 1.5, 1.1), lens=30)
    render_view("checkout", (-0.1, -0.4, 1.62), (-2.6, -2.5, 1.0))


main()
