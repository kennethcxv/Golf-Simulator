"""Reimport every checkout-kit GLB into a CLEAN Blender scene and verify it.

Checks, per asset: import succeeds, required node names exist, real-world
scale (bounds), object scale is applied (~1), materials on every visible mesh,
textures arrive packed, and the authored animation clips survived export.

Run:
    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
        --background --factory-startup --python tools/blender/verify_checkout_kit.py

Prints one VERIFY|<asset>|PASS/FAIL line per asset and exits 1 on any failure.
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
GLB_DIR = ROOT / "assets" / "checkout" / "glb"

KIT = [
    "checkout_counter", "pos_monitor", "cash_drawer", "payment_terminal",
    "barcode_scanner", "receipt_printer", "shopping_bag", "payment_card",
    "cash_bill_1", "cash_bill_5", "cash_bill_10", "cash_bill_20", "cash_bill_50",
    "cash_coin_01", "cash_coin_05", "cash_coin_05_sheet01", "cash_coin_10", "cash_coin_20", "cash_coin_50",
    "scannable_product_box", "customer_display", "loose_receipt", "cash_handoff_stack",
    "apparel_wall",
    # Asset Sheet 03: the retail fixture family
    "apparel_wall_display", "hat_wall", "accessory_slatwall", "club_rack",
    "putter_rack", "bag_display", "shoe_wall", "ball_shelf", "snack_shelf",
    "rangefinder_display",
    # Asset Sheet 04: the furniture family
    "merch_table", "retail_gondola", "apparel_table", "stock_shelving",
    "storage_tote_olive", "storage_tote_slate", "storage_tote_charcoal",
    "storage_tote_stone", "lounge_armchair", "lounge_coffee_table",
    "lounge_side_table", "office_desk", "office_chair", "filing_cabinet",
]

REQUIRED_NODES = {
    "checkout_counter": ["POS_MOUNT", "CASH_DRAWER_MOUNT", "CARD_TERMINAL_MOUNT",
                         "BARCODE_SCANNER_MOUNT", "RECEIPT_PRINTER_MOUNT", "CUSTOMER_DISPLAY_MOUNT",
                         "BAG_PLACEMENT", "UNSCANNED_ITEM_AREA", "SCANNED_ITEM_AREA",
                         "COL_CheckoutCounter", "SlatsFront", "LED_Front"],
    "pos_monitor": ["POS_Screen", "POS_Body", "POS_Stand", "POS_Base", "POS_CableChannel"],
    "cash_drawer": ["CashDrawer_Housing", "CashDrawer_Tray", "CashDrawer_Insert", "CashDrawer_Lock"]
                   + [f"BILL_{b}_SOCKET" for b in ("1", "5", "10", "20", "50")]
                   + [f"COIN_{c}_SOCKET" for c in ("01", "05", "10", "20", "50")],
    "payment_terminal": ["Terminal_Body", "Terminal_Screen", "Terminal_Keypad", "Terminal_CancelButton",
                         "Terminal_BackButton", "Terminal_ConfirmButton", "Terminal_ChipSlot",
                         "CARD_INSERT_SOCKET", "Terminal_NFCMark", "NFC_TAP_SOCKET"]
                        + [f"Terminal_Key_{d}" for d in range(10)],
    "receipt_printer": ["Printer_Body", "Printer_Cover", "Printer_OutputSlot", "Printer_Button",
                        "Printer_LED", "PaperRollPivot", "Receipt_Paper", "RECEIPT_OUTPUT_SOCKET",
                        "RECEIPT_TEAR_SOCKET", "RECEIPT_PICKUP_SOCKET", "ANCHOR_ReceiptFeed",
                        "ANCHOR_Tear", "ANCHOR_ReceiptPickup"],
    "shopping_bag": ["Bag_Body", "Bag_Handle_Left", "Bag_Handle_Right", "Bag_Artwork", "BAG_PICKUP_SOCKET",
                     "ANCHOR_BagDrop", "ANCHOR_BagContents", "ANCHOR_BagHandoff", "ANCHOR_ReceiptPocket",
                     "ANCHOR_BagHandleFront", "ANCHOR_BagHandleBack"]
                    + [f"BAG_ITEM_SOCKET_0{i}" for i in range(1, 5)],
    "loose_receipt": ["Receipt_Strip", "RECEIPT_FEED_SOCKET", "RECEIPT_HANDOFF_SOCKET"],
    "payment_card": ["Card_Body", "Card_Chip"],
    "apparel_wall": ["Slatwall", "Back_Panel", "Header", "Header_Sign", "Hanging_Rod",
                     "Folded_Shelf", "Cabinet_Body", "Cabinet_Door_L", "Cabinet_Door_R",
                     "Frame_Upright_L", "Frame_Upright_R", "COL_ApparelWall",
                     "Hook_Arm_01", "Hook_Arm_02"]
                    + [f"APPAREL_HANGER_SLOT_{i:02d}" for i in range(1, 5)]
                    + [f"APPAREL_FOLD_SLOT_{i:02d}" for i in range(1, 4)]
                    + [f"APPAREL_SHELF_SLOT_{i:02d}" for i in range(1, 3)]
                    + [f"APPAREL_HOOK_SLOT_{i:02d}" for i in range(1, 3)],
    # --- Asset Sheet 03 -------------------------------------------------------
    "apparel_wall_display": ["Slatwall", "Back_Panel", "Header", "Header_Sign",
                             "Base_Shelf", "Faceout_Arm_01", "Faceout_Arm_06",
                             "COL_ApparelWallDisplay"]
                            + [f"DISPLAY_ARM_SLOT_{i:02d}" for i in range(1, 7)]
                            + [f"DISPLAY_BASE_SLOT_{i:02d}" for i in range(1, 4)],
    "hat_wall": ["Slatwall", "Back_Panel", "Header", "Header_Sign", "Plinth",
                 "Peg_Arm_01", "Peg_Arm_12", "COL_HatWall"]
                + [f"HAT_PEG_SLOT_{i:02d}" for i in range(1, 13)],
    "accessory_slatwall": ["Slatwall", "Back_Panel", "Header", "Header_Sign",
                           "Shelf_01", "Shelf_02", "Shelf_03",
                           "Hook_Short_Plate_01", "Hook_Long_Plate_01", "Hook_Double_Plate_01",
                           "COL_AccessorySlatwall"]
                          + [f"ACC_SHELF_SLOT_{i:02d}" for i in range(1, 4)]
                          + [f"ACC_HOOK_SLOT_{i:02d}" for i in range(1, 7)],
    "club_rack": ["Base", "Trough_Felt_F", "Trough_Felt_R", "Head_Rail_F", "Head_Rail_R",
                  "End_Cap_L", "End_Cap_R", "Crest_Badge", "COL_ClubRack"]
                 + [f"CLUB_SLOT_F{i:02d}" for i in range(1, 10)]
                 + [f"CLUB_SLOT_R{i:02d}" for i in range(1, 10)],
    "putter_rack": ["Base", "Base_Felt", "Grip_Rail", "Cheek_L", "Cheek_R",
                    "Groove_Divider_01", "Groove_Divider_05", "COL_PutterRack"]
                   + [f"PUTTER_SLOT_{i:02d}" for i in range(1, 7)],
    "bag_display": ["Deck", "Lean_Rail", "Rail_Post_L", "Rail_Post_R", "Crest_Badge",
                    "COL_BagDisplay"]
                   + [f"BAG_SLOT_{i:02d}" for i in range(1, 5)],
    "shoe_wall": ["Slatwall", "Back_Panel", "Header", "Header_Sign", "Box_Shelf",
                  "Display_Board_01", "Display_Board_03",
                  "COL_ShoeWall"]
                 + [f"SHOE_SLOT_{i:02d}" for i in range(1, 7)]
                 + [f"SHOEBOX_SLOT_{i:02d}" for i in range(1, 4)],
    "ball_shelf": ["Side_L", "Side_R", "Top", "Back_Panel", "Board_01", "Board_02",
                   "Board_03", "Board_Lip_01", "Crest_Badge", "COL_BallShelf"]
                  + [f"BALL_SLOT_{i:02d}" for i in range(1, 16)],
    "snack_shelf": ["Frame_Post_LF", "Frame_Post_RB", "Back_Panel", "Shelf_01", "Shelf_04",
                    "COL_SnackShelf"]
                   + [f"SNACK_SHELF_SLOT_{i:02d}" for i in range(1, 5)]
                   + [f"DRINK_SLOT_{i:02d}" for i in range(1, 15)]
                   + [f"SNACK_SLOT_{i:02d}" for i in range(1, 11)],
    "rangefinder_display": ["Case_Base", "Case_Back", "Case_Cheek_L", "Case_Cheek_R",
                            "Tier_01", "Tier_02", "Acrylic_Front",
                            "Crest_Badge", "COL_RangefinderDisplay"]
                           + [f"RF_SLOT_{i:02d}" for i in range(1, 7)],
    # --- Asset Sheet 04 -------------------------------------------------------
    "merch_table": ["Top", "Lower_Shelf", "Shelf_Rail_L", "Shelf_Rail_R",
                    "Leg_01", "Leg_04", "Crest_Badge", "COL_MerchTable"]
                   + [f"MERCH_TABLE_SLOT_{i:02d}" for i in range(1, 7)]
                   + [f"MERCH_TABLE_LOWER_{i:02d}" for i in range(1, 5)],
    "retail_gondola": ["Plinth", "Spine", "Top_Cap", "Shelf_F01", "Shelf_B03",
                       "End_Slat_L", "End_Slat_R", "COL_RetailGondola"]
                      + [f"GONDOLA_SLOT_F{i:02d}" for i in range(1, 13)]
                      + [f"GONDOLA_SLOT_B{i:02d}" for i in range(1, 13)],
    "apparel_table": ["Top", "Lower_Shelf", "Shelf_Rail_L", "Shelf_Rail_R",
                      "Leg_01", "Leg_04", "Crest_Badge", "COL_ApparelTable"]
                     + [f"APPAREL_TABLE_SLOT_{i:02d}" for i in range(1, 9)]
                     + [f"APPAREL_TABLE_LOWER_{i:02d}" for i in range(1, 5)],
    "stock_shelving": ["Post_LF", "Post_RB", "Board_01", "Board_04", "Board_Lip_01",
                       "Brace_01a", "Brace_03b", "COL_StockShelving"]
                      + [f"STOCK_SHELF_SLOT_{i:02d}" for i in range(1, 5)],
    "storage_tote_olive": ["Tote_Body", "Rim_F", "Rim_B", "Rim_L", "Rim_R", "Grip_L", "Grip_R",
                           "Label_Holder", "Label_Card", "TOTE_STACK_SOCKET", "COL_StorageTote_olive"],
    "storage_tote_slate": ["Tote_Body", "Label_Card", "TOTE_STACK_SOCKET", "COL_StorageTote_slate"],
    "storage_tote_charcoal": ["Tote_Body", "Label_Card", "TOTE_STACK_SOCKET", "COL_StorageTote_charcoal"],
    "storage_tote_stone": ["Tote_Body", "Label_Card", "TOTE_STACK_SOCKET", "COL_StorageTote_stone"],
    "lounge_armchair": ["Base", "Seat_Cushion", "Arm_L", "Arm_R", "Arm_Roll_L", "Arm_Roll_R",
                        "Back", "Back_Cushion", "Back_Roll", "Foot_LF", "Foot_RB",
                        "COL_LoungeArmchair"],
    "lounge_coffee_table": ["Top", "Band", "Leg_01", "Leg_03", "Ring_Shelf",
                            "COL_LoungeCoffeeTable"],
    "lounge_side_table": ["Top", "Band", "Leg_01", "Leg_03", "Ring_Shelf",
                          "COL_LoungeSideTable"],
    "office_desk": ["Top", "Pedestal_L", "Pedestal_R", "Drawer_L01", "Drawer_R03",
                    "Pull_L01", "Modesty_Panel", "DESK_LAPTOP_SOCKET", "COL_OfficeDesk"],
    "office_chair": ["Star_Leg_01", "Star_Leg_05", "Caster_01", "Gas_Lift", "Seat", "Back",
                     "Arm_Post_L", "Arm_Pad_R", "COL_OfficeChair"],
    "filing_cabinet": ["Body", "Plinth", "Drawer_01", "Drawer_04", "Pull_01",
                       "Label_Frame_01", "Label_01", "Label_04", "COL_FilingCabinet"],
}

# asset: (axis-size checks in Blender Z-up space after import)
#   entries: (axis, min, max) using non-COL mesh world bounds
SIZE_CHECKS = {
    "checkout_counter": [(0, 2.4, 2.8), (2, 0.9, 1.05)],
    "payment_card": [(0, 0.080, 0.092), (1, 0.048, 0.058)],
    # Sheet-02 note ladder: value grows with the note
    "cash_bill_1": [(0, 0.117, 0.127)],
    "cash_bill_5": [(0, 0.127, 0.137)],
    "cash_bill_10": [(0, 0.137, 0.147)],
    "cash_bill_20": [(0, 0.151, 0.161), (1, 0.063, 0.069)],
    "cash_bill_50": [(0, 0.151, 0.161)],
    # Sheet-02 coin ladder: 18 mm copper up to the 30 mm bimetal 50
    "cash_coin_01": [(0, 0.0170, 0.0190)],
    "cash_coin_05": [(0, 0.0200, 0.0220)],
    "cash_coin_05_sheet01": [(0, 0.0230, 0.0250)],
    "cash_coin_10": [(0, 0.0230, 0.0250)],
    "cash_coin_20": [(0, 0.0250, 0.0270)],
    "cash_coin_50": [(0, 0.0290, 0.0310)],
    "shopping_bag": [(2, 0.30, 0.42)],   # rope handles arc ~55 mm above the rim
    "apparel_wall": [(0, 1.05, 1.15), (2, 2.15, 2.25)],
    # Sheet-03 envelopes straight off the sheet (W, H in Blender X/Z)
    "apparel_wall_display": [(0, 1.15, 1.25), (2, 2.15, 2.25)],
    "hat_wall": [(0, 0.95, 1.05), (2, 2.15, 2.25)],
    "accessory_slatwall": [(0, 0.95, 1.05), (2, 1.95, 2.05)],
    "club_rack": [(0, 1.15, 1.25), (2, 1.00, 1.12)],
    "putter_rack": [(0, 0.95, 1.05), (2, 0.90, 1.02)],
    "bag_display": [(0, 1.55, 1.65), (2, 1.02, 1.12)],
    "shoe_wall": [(0, 1.15, 1.25), (2, 1.95, 2.05)],
    "ball_shelf": [(0, 0.98, 1.08), (2, 1.15, 1.25)],
    "snack_shelf": [(0, 0.95, 1.05), (2, 1.55, 1.65)],
    "rangefinder_display": [(0, 0.55, 0.65), (2, 0.30, 0.40)],
    # Sheet-04 envelopes straight off the sheet
    "merch_table": [(0, 1.35, 1.45), (2, 0.70, 0.80)],
    "retail_gondola": [(0, 1.15, 1.25), (2, 1.35, 1.45)],
    "apparel_table": [(0, 1.55, 1.65), (2, 0.75, 0.85)],
    "stock_shelving": [(0, 1.15, 1.25), (2, 1.95, 2.05)],
    "storage_tote_olive": [(0, 0.55, 0.65), (2, 0.26, 0.34)],
    "storage_tote_slate": [(0, 0.55, 0.65), (2, 0.26, 0.34)],
    "storage_tote_charcoal": [(0, 0.55, 0.65), (2, 0.26, 0.34)],
    "storage_tote_stone": [(0, 0.55, 0.65), (2, 0.26, 0.34)],
    "lounge_armchair": [(0, 0.80, 0.90), (2, 0.80, 0.90)],
    "lounge_coffee_table": [(0, 0.95, 1.05), (2, 0.40, 0.50)],
    "lounge_side_table": [(0, 0.50, 0.60), (2, 0.33, 0.43)],
    "office_desk": [(0, 1.55, 1.65), (2, 0.70, 0.80)],
    "office_chair": [(0, 0.55, 0.70), (2, 1.02, 1.12)],
    "filing_cabinet": [(0, 0.43, 0.53), (2, 1.27, 1.37)],
}

REQUIRED_CLIPS = {
    "cash_drawer": {"CashDrawer_Open", "CashDrawer_Close"},
    "receipt_printer": {"Receipt_Print"},
}

COIN_CONTRACTS = {
    "cash_coin_50": {"code": "50", "cents": 50, "diameter": 0.030, "thickness": 0.0022, "tris": 300, "rough": 0.33},
    "cash_coin_20": {"code": "20", "cents": 20, "diameter": 0.026, "thickness": 0.0020, "tris": 284, "rough": 0.34},
    "cash_coin_10": {"code": "10", "cents": 10, "diameter": 0.024, "thickness": 0.0018, "tris": 252, "rough": 0.36},
    "cash_coin_05": {"code": "05", "cents": 5, "diameter": 0.021, "thickness": 0.0016, "tris": 220, "rough": 0.38},
    "cash_coin_01": {"code": "01", "cents": 1, "diameter": 0.018, "thickness": 0.0014, "tris": 188, "rough": 0.46},
}


def world_bounds(objs):
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != "MESH" or o.name.startswith("COL_"):
            continue
        for corner in o.bound_box:
            wc = o.matrix_world @ Vector(corner)
            mins = Vector(map(min, mins, wc))
            maxs = Vector(map(max, maxs, wc))
    return maxs - mins


def verify(asset):
    errors = []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = GLB_DIR / f"{asset}.glb"
    if not path.exists():
        return [f"missing file {path}"]
    try:
        bpy.ops.import_scene.gltf(filepath=str(path))
    except Exception as exc:  # noqa: BLE001
        return [f"import failed: {exc}"]
    objs = list(bpy.context.scene.objects)
    names = {o.name for o in objs}

    for need in REQUIRED_NODES.get(asset, []):
        if need not in names:
            errors.append(f"missing node {need}")

    size = world_bounds(objs)
    for (axis, lo, hi) in SIZE_CHECKS.get(asset, []):
        if not (lo <= size[axis] <= hi):
            errors.append(f"size axis{axis}={size[axis]:.4f} outside [{lo}, {hi}]")

    # scale must be applied (importer may carry the unit scale on the root only)
    for o in objs:
        if o.type == "MESH" and not o.name.startswith("COL_"):
            for s in o.matrix_world.to_scale():
                if not (0.98 <= s <= 1.02):
                    errors.append(f"{o.name} world scale {s:.3f} not applied")
                    break

    # every visible mesh needs a material; textures must be packed
    for o in objs:
        if o.type == "MESH" and not o.name.startswith("COL_"):
            if not o.data.materials or o.data.materials[0] is None:
                errors.append(f"{o.name} has no material")
    for img in bpy.data.images:
        if img.name == "Render Result":
            continue
        if img.packed_file is None and not img.filepath:
            errors.append(f"image {img.name} not packed")

    clips = {a.name for a in bpy.data.actions}
    for clip in REQUIRED_CLIPS.get(asset, set()):
        if not any(clip in c for c in clips):
            errors.append(f"missing animation clip {clip} (have {sorted(clips)})")

    coin = COIN_CONTRACTS.get(asset)
    if coin:
        visible = [o for o in objs if o.type == "MESH" and not o.name.startswith("COL_")]
        collisions = [o.name for o in objs if o.name.startswith("COL_")]
        if collisions:
            errors.append(f"coin must not ship collision proxies: {collisions}")
        if len(visible) != 1 or visible[0].name != "Coin_Body":
            errors.append(f"coin visible mesh contract invalid: {[o.name for o in visible]}")
        else:
            body = visible[0]
            body.data.calc_loop_triangles()
            triangles = len(body.data.loop_triangles)
            if triangles != coin["tris"]:
                errors.append(f"coin triangles {triangles} != {coin['tris']}")
            corners = [body.matrix_world @ Vector(corner) for corner in body.bound_box]
            mins = Vector(tuple(min(p[i] for p in corners) for i in range(3)))
            maxs = Vector(tuple(max(p[i] for p in corners) for i in range(3)))
            centre = (mins + maxs) * 0.5
            if centre.length > 1e-5:
                errors.append(f"coin bounds centre {tuple(round(v, 7) for v in centre)} is not origin")
            dims = maxs - mins
            if abs(dims.x - coin["diameter"]) > 0.0005 or abs(dims.y - coin["diameter"]) > 0.0005:
                errors.append(f"coin planar bounds {dims.x:.5f} x {dims.y:.5f} != {coin['diameter']:.5f}")
            if abs(dims.z - coin["thickness"]) > 0.0001:
                errors.append(f"coin thickness {dims.z:.5f} != {coin['thickness']:.5f}")
            mats = [m for m in body.data.materials if m]
            expected_mat = f"M_Coin{coin['code']}"
            if len(mats) != 1 or mats[0].name != expected_mat:
                errors.append(f"coin material contract {[m.name for m in mats]} != [{expected_mat}]")
            elif mats:
                mat = mats[0]
                if not mat.use_backface_culling:
                    errors.append("coin material exports double-sided")
                bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
                if bsdf is None:
                    errors.append("coin material has no Principled BSDF")
                else:
                    rough = float(bsdf.inputs["Roughness"].default_value)
                    metal = float(bsdf.inputs["Metallic"].default_value)
                    if abs(rough - coin["rough"]) > 0.002:
                        errors.append(f"coin roughness {rough:.3f} != {coin['rough']:.3f}")
                    if abs(metal - 0.92) > 0.002:
                        errors.append(f"coin metalness {metal:.3f} != 0.920")
        root = next((o for o in objs if o.name == asset), None)
        if root is None:
            errors.append(f"missing coin root {asset}")
        else:
            if root.get("asset_id") != asset or int(root.get("denomination_cents", -1)) != coin["cents"]:
                errors.append("coin root identity/denomination extras invalid")
            if "obverse" not in str(root.get("front", "")) or not str(root.get("reverse", "")):
                errors.append("coin face-orientation extras invalid")
        for suffix in ("", "_N"):
            image_name = f"Coin_{coin['code']}{suffix}"
            image = next((img for img in bpy.data.images if img.name == image_name), None)
            if image is None:
                errors.append(f"missing embedded image {image_name}")
            elif tuple(image.size) != (1024, 1024):
                errors.append(f"image {image_name} size {tuple(image.size)} != (1024, 1024)")
            elif suffix == "_N" and image.colorspace_settings.name != "Non-Color":
                errors.append(f"normal image {image_name} colorspace {image.colorspace_settings.name} != Non-Color")

    return errors


def main():
    failures = 0
    for asset in KIT:
        errors = verify(asset)
        if errors:
            failures += 1
            print(f"VERIFY|{asset}|FAIL|{'; '.join(errors)}")
        else:
            print(f"VERIFY|{asset}|PASS")
    print(f"VERIFY-SUMMARY|{len(KIT) - failures}/{len(KIT)} passed")
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
