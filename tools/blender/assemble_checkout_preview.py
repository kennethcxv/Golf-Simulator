"""Assemble the full checkout station from the exported kit GLBs and capture the
eight required preview renders from a first-person cashier viewpoint.

Run:
    "<blender>" --background --factory-startup --python tools/blender/assemble_checkout_preview.py

Outputs:
    assets/checkout/source/checkout_assembled_preview.blend
    assets/checkout/previews/station_*.png
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector, Matrix

sys.path.insert(0, str(Path(__file__).resolve().parent))
import checkout_kit_lib as K

ROOT = K.ROOT
GLB = K.GLB_DIR
OUT = K.PREVIEW_DIR


def import_glb(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(GLB / f"{name}.glb"))
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    root = roots[0] if len(roots) == 1 else None
    if root is None:
        holder = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(holder)
        for r in roots:
            r.parent = holder
        root = holder
    for o in new:
        if o.name.startswith("COL_"):
            o.hide_render = True
            o.hide_viewport = True
        # imported actions would override manual scenario posing at render time
        if o.animation_data:
            o.animation_data_clear()
    return root, new


def world_of(objs, name):
    for o in objs:
        if o.name == name or o.name.startswith(name):
            return o.matrix_world.translation.copy()
    raise KeyError(name)


def main():
    K.reset_scene()

    counter, cobjs = import_glb("checkout_counter")
    mounts = {n: world_of(cobjs, n) for n in (
        "POS_MOUNT", "CASH_DRAWER_MOUNT", "CARD_TERMINAL_MOUNT", "BARCODE_SCANNER_MOUNT",
        "RECEIPT_PRINTER_MOUNT", "CUSTOMER_DISPLAY_MOUNT", "BAG_PLACEMENT",
        "UNSCANNED_ITEM_AREA", "SCANNED_ITEM_AREA")}

    monitor, _ = import_glb("pos_monitor")
    monitor.location = mounts["POS_MOUNT"]
    drawer, dobjs = import_glb("cash_drawer")
    drawer.location = mounts["CASH_DRAWER_MOUNT"]
    tray0 = next(o for o in dobjs if o.name == "CashDrawer_Tray")
    tray0.location = (0, 0, 0)                     # importer leaves the animation start pose
    terminal, tobjs = import_glb("payment_terminal")
    terminal.location = mounts["CARD_TERMINAL_MOUNT"]
    scanner, _ = import_glb("barcode_scanner")
    scanner.location = mounts["BARCODE_SCANNER_MOUNT"]
    printer, pobjs = import_glb("receipt_printer")
    printer.location = mounts["RECEIPT_PRINTER_MOUNT"]
    printer.rotation_euler = (0, 0, math.radians(-12))
    paper0 = next(o for o in pobjs if o.name == "Receipt_Paper")
    paper0.location = (0, -0.0545, 0.004)          # rest pose (importer leaves anim start)
    disp, _ = import_glb("customer_display")
    disp.location = mounts["CUSTOMER_DISPLAY_MOUNT"]
    bag, _ = import_glb("shopping_bag")
    bag.location = mounts["BAG_PLACEMENT"]
    bag.rotation_euler = (0, 0, math.radians(6))

    boxes = []
    for i, off in enumerate((Vector((-0.16, 0.02, 0)), Vector((0.02, -0.08, 0)), Vector((0.14, 0.10, 0)))):
        b, _ = import_glb("scannable_product_box")
        b.name = f"ProductBox_{i}"
        b.location = mounts["UNSCANNED_ITEM_AREA"] + off
        b.rotation_euler = (0, 0, math.radians(-25 + i * 40))
        boxes.append(b)

    card, _ = import_glb("payment_card")
    card.location = mounts["CARD_TERMINAL_MOUNT"] + Vector((0.0, -0.02, -0.35))  # parked out of sight
    # bills + coins into the open-drawer sockets
    tray = next(o for o in dobjs if o.name == "CashDrawer_Tray")
    fills = []
    for denom in ("1", "5", "10", "20", "50"):
        broot, _ = import_glb(f"cash_bill_{denom}")
        sock = next(o for o in dobjs if o.name == f"BILL_{denom}_SOCKET")
        broot.parent = sock
        broot.location = (0, 0, 0.002)
        broot.rotation_euler = (0, 0, math.radians(90))
        fills.append(broot)
    for code in ("01", "05", "10", "25", "50"):
        criot, _ = import_glb(f"cash_coin_{code}")
        sock = next(o for o in dobjs if o.name == f"COIN_{code}_SOCKET")
        criot.parent = sock
        criot.location = (0, 0, 0.003)
        fills.append(criot)

    # ---- lighting + camera (first-person cashier) ----
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.68, 0.66, 0.62, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.55
    bpy.context.scene.world = world

    def sun(name, e, rot):
        d = bpy.data.lights.new(name, "SUN")
        d.energy = e
        d.angle = math.radians(8)
        ob = bpy.data.objects.new(name, d)
        ob.rotation_euler = rot
        bpy.context.collection.objects.link(ob)
    sun("Key", 2.2, (math.radians(50), 0, math.radians(35)))
    sun("Fill", 0.9, (math.radians(58), 0, math.radians(-70)))
    area = bpy.data.lights.new("Soft", "AREA")
    area.energy = 320
    area.size = 2.6
    aob = bpy.data.objects.new("Soft", area)
    aob.location = (0.2, -1.4, 2.3)
    aob.rotation_euler = (math.radians(35), 0, 0)
    bpy.context.collection.objects.link(aob)
    bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 0, 0))
    floor = bpy.context.active_object
    floor.name = "Floor"
    floor.data.materials.append(K.m_flat("M_Floor", (0.28, 0.22, 0.16), rough=0.8))

    cam_data = bpy.data.cameras.new("CashierCam")
    cam_data.lens = 24
    cam = bpy.data.objects.new("CashierCam", cam_data)
    bpy.context.collection.objects.link(cam)
    sc = bpy.context.scene
    sc.camera = cam

    def look(cam_pos, target):
        cam.location = cam_pos
        cam.rotation_euler = (Vector(target) - Vector(cam_pos)).to_track_quat("-Z", "Y").to_euler()

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
    sc.render.resolution_x = 1280
    sc.render.resolution_y = 800

    def shot(name):
        sc.render.filepath = str(OUT / f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"SHOT|{name}")

    cashier_eye = (0.35, -1.30, 1.66)

    # 1) empty station
    bag.hide_render = True
    for b in boxes:
        b.hide_render = True
    for f in fills:
        f.hide_render = True
    card.hide_render = True
    look(cashier_eye, (0.45, 0.25, 0.85))
    shot("station_1_empty")

    # 2) products waiting + bag back
    bag.hide_render = False
    for b in boxes:
        b.hide_render = False
    look(cashier_eye, (0.15, 0.2, 0.85))
    shot("station_2_products_waiting")

    # 3) product passing the scanner
    scan_pos = mounts["BARCODE_SCANNER_MOUNT"]
    boxes[0].location = scan_pos + Vector((0.0, -0.16, 0.14))
    boxes[0].rotation_euler = (0, 0, math.radians(90))
    look((0.42, -1.15, 1.62), (scan_pos.x, scan_pos.y, 1.02))
    shot("station_3_scanning")

    # 4) card inserted into the terminal (aligned to the CARD_INSERT_SOCKET axes)
    card.hide_render = False
    sock = next(o for o in tobjs if o.name == "CARD_INSERT_SOCKET")
    sw = sock.matrix_world
    insert_dir = -(sw.to_quaternion() @ Vector((0, 0, 1)))     # card travels along socket -Z when out
    x_card = insert_dir.normalized()                            # card long axis points out of the slot
    n_card = (sw.to_quaternion() @ Vector((0, -1, 0))).normalized()  # face normal out of terminal face
    y_card = n_card.cross(x_card).normalized()
    basis = Matrix((x_card, y_card, n_card)).transposed().to_4x4()
    card.matrix_world = Matrix.Translation(sw.translation + insert_dir * 0.030) @ basis
    tpos = mounts["CARD_TERMINAL_MOUNT"]
    look((0.38, -0.95, 1.55), (tpos.x, tpos.y, 0.96))
    shot("station_4_card_inserted")

    # 5) drawer closed
    look((0.86, -1.05, 1.58), (0.86, 0.1, 0.80))
    shot("station_5_drawer_closed")

    # 6) drawer open with cash
    tray.location = (0, -0.36, 0)
    for f in fills:
        f.hide_render = False
    shot("station_6_drawer_open")

    # 7) receipt printing
    tray.location = (0, 0, 0)
    for f in fills:
        f.hide_render = True
    paper = next(o for o in bpy.data.objects if o.name.startswith("Receipt_Paper"))
    paper.location = paper.location + Vector((0, 0, 0.081))
    ppos = mounts["RECEIPT_PRINTER_MOUNT"]
    look((0.95, -0.90, 1.56), (ppos.x, ppos.y, 1.02))
    shot("station_7_receipt_printing")

    # 8) bag containing products
    boxes[1].location = bag.matrix_world.translation + Vector((0, 0, 0.16))
    boxes[1].rotation_euler = (0, 0, math.radians(12))
    boxes[2].location = bag.matrix_world.translation + Vector((0.05, 0.02, 0.10))
    bpos = mounts["BAG_PLACEMENT"]
    look((-0.75, -1.15, 1.60), (bpos.x, bpos.y, 0.95))
    shot("station_8_bag_with_products")

    bpy.ops.wm.save_as_mainfile(filepath=str(K.SOURCE_DIR / "checkout_assembled_preview.blend"), check_existing=False)
    print("ASSEMBLED|checkout_assembled_preview.blend")


if __name__ == "__main__":
    main()
