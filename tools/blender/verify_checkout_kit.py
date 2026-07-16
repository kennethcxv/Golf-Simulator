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
    "cash_coin_01", "cash_coin_05", "cash_coin_10", "cash_coin_25", "cash_coin_50",
    "scannable_product_box", "customer_display", "loose_receipt", "cash_handoff_stack",
    "apparel_wall",
]

REQUIRED_NODES = {
    "checkout_counter": ["POS_MOUNT", "CASH_DRAWER_MOUNT", "CARD_TERMINAL_MOUNT",
                         "BARCODE_SCANNER_MOUNT", "RECEIPT_PRINTER_MOUNT", "CUSTOMER_DISPLAY_MOUNT",
                         "BAG_PLACEMENT", "UNSCANNED_ITEM_AREA", "SCANNED_ITEM_AREA",
                         "COL_CheckoutCounter", "SlatsFront", "LED_Front"],
    "pos_monitor": ["POS_Screen", "POS_Body", "POS_Stand", "POS_Base"],
    "cash_drawer": ["CashDrawer_Housing", "CashDrawer_Tray", "CashDrawer_Insert", "CashDrawer_Lock"]
                   + [f"BILL_{b}_SOCKET" for b in ("1", "5", "10", "20", "50")]
                   + [f"COIN_{c}_SOCKET" for c in ("01", "05", "10", "25", "50")],
    "payment_terminal": ["Terminal_Body", "Terminal_Screen", "Terminal_Keypad", "Terminal_CancelButton",
                         "Terminal_BackButton", "Terminal_ConfirmButton", "Terminal_ChipSlot",
                         "CARD_INSERT_SOCKET"] + [f"Terminal_Key_{d}" for d in range(10)],
    "receipt_printer": ["Printer_Body", "Printer_Cover", "Printer_OutputSlot", "Printer_Button",
                        "Printer_LED", "Receipt_Paper"],
    "shopping_bag": ["Bag_Body", "Bag_Handle_Left", "Bag_Handle_Right", "Bag_Artwork", "BAG_PICKUP_SOCKET"]
                    + [f"BAG_ITEM_SOCKET_0{i}" for i in range(1, 5)],
    "payment_card": ["Card_Body", "Card_Chip"],
    "apparel_wall": ["Slatwall", "Back_Panel", "Header", "Header_Sign", "Hanging_Rod",
                     "Folded_Shelf", "Cabinet_Body", "Cabinet_Door_L", "Cabinet_Door_R",
                     "Frame_Upright_L", "Frame_Upright_R", "COL_ApparelWall",
                     "Hook_Arm_01", "Hook_Arm_02"]
                    + [f"APPAREL_HANGER_SLOT_{i:02d}" for i in range(1, 5)]
                    + [f"APPAREL_FOLD_SLOT_{i:02d}" for i in range(1, 4)]
                    + [f"APPAREL_SHELF_SLOT_{i:02d}" for i in range(1, 3)]
                    + [f"APPAREL_HOOK_SLOT_{i:02d}" for i in range(1, 3)],
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
    "cash_bill_20": [(0, 0.144, 0.154)],
    "cash_bill_50": [(0, 0.151, 0.161)],
    # Sheet-02 coin ladder: 18 mm copper up to the 30 mm bimetal 50
    "cash_coin_01": [(0, 0.0170, 0.0190)],
    "cash_coin_05": [(0, 0.0200, 0.0220)],
    "cash_coin_10": [(0, 0.0230, 0.0250)],
    "cash_coin_25": [(0, 0.0250, 0.0270)],
    "cash_coin_50": [(0, 0.0290, 0.0310)],
    "shopping_bag": [(2, 0.30, 0.42)],   # rope handles arc ~55 mm above the rim
    "apparel_wall": [(0, 1.05, 1.15), (2, 2.15, 2.25)],
}

REQUIRED_CLIPS = {
    "cash_drawer": {"CashDrawer_Open", "CashDrawer_Close"},
    "receipt_printer": {"Receipt_Print"},
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
