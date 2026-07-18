"""Headless validation for the production checkout GLBs.

Run from the repository root:

    blender --background --factory-startup \
        --python tools/blender/validate_checkout_assets.py

The validator imports the shipped files rather than inspecting the authoring
scene.  That catches hierarchy, naming, UV, transform, collision, anchor and
animation problems introduced during GLB export.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"

REQUIREMENTS = {
    "checkout_product_staging_tray": {
        "nodes": {"ProductStagingTrayBase", "ProductStagingTrayInset", "ANCHOR_ProductStagingSurface"},
        "min_anchors": 1,
        "min_collisions": 1,
        "actions": set(),
    },
    "checkout_change_handoff_tray": {
        "nodes": {"ChangeHandoffTrayBase", "ChangeHandoffTrayFelt", "ANCHOR_ChangeHandoffSurface", "ANCHOR_ChangePickup"},
        "min_anchors": 2,
        "min_collisions": 1,
        "actions": set(),
    },
    "checkout_counter": {
        "nodes": {"ANCHOR_POS", "ANCHOR_DrawerHousing", "ANCHOR_Scanner", "ANCHOR_CardReader", "ANCHOR_ReceiptPrinter", "ANCHOR_Bag"},
        "min_anchors": 11,
        "min_collisions": 3,
        "actions": set(),
    },
    "checkout_cash_drawer": {
        "nodes": {
            "DrawerSlide",
            "DrawerLockPivot",
            "BillClipPivot_1",
            "BillClipPivot_5",
            "BillClipPivot_10",
            "BillClipPivot_20",
            "BillClipPivot_50",
            "BillLabelText_1",
            "BillLabelText_5",
            "BillLabelText_10",
            "BillLabelText_20",
            "BillLabelText_50",
            "CoinLabelText_5",
            "CoinLabelText_10",
            "CoinLabelText_20",
            "CoinLabelText_50",
            "CoinLabelText_1",
            "ANCHOR_DrawerClosed",
            "ANCHOR_DrawerOpen",
        },
        "min_anchors": 14,
        "min_collisions": 2,
        "actions": {"DrawerSlide_OpenHoldClose", "DrawerLock_Unlock", "BillClip_1_Lift", "BillClip_5_Lift", "BillClip_10_Lift", "BillClip_20_Lift", "BillClip_50_Lift"},
    },
    "checkout_scanner": {
        "nodes": {"ScannerGlass", "ScannerBeam", "ANCHOR_ScanZone", "ANCHOR_ScanNormal", "ANCHOR_BeamEmitter", "ANCHOR_ScannerGrip"},
        "min_anchors": 4,
        "min_collisions": 1,
        "actions": set(),
    },
    "checkout_card_reader": {
        "nodes": {"ReaderScreen", "ContactlessPad", "ChipSlot", "ANCHOR_Screen", "ANCHOR_Contactless", "ANCHOR_ChipSlot", "ANCHOR_CardReady", "ANCHOR_CardInserted", "ANCHOR_CardGrip"},
        "min_anchors": 6,
        "min_collisions": 1,
        "actions": set(),
    },
    "checkout_receipt_printer": {
        "nodes": {"PrinterLidPivot", "ReceiptPaper", "PaperRollPivot", "ANCHOR_ReceiptFeed", "ANCHOR_Tear", "ANCHOR_ReceiptPickup", "ANCHOR_PaperRoll"},
        "min_anchors": 4,
        "min_collisions": 1,
        "actions": {"ReceiptPaper_PrintFeed", "PrinterLid_ServiceOpen", "PaperRoll_Feed"},
    },
    "checkout_shopping_bag": {
        "nodes": {"BagHandleFrontPivot", "BagHandleBackPivot", "ANCHOR_BagDrop", "ANCHOR_BagContents", "ANCHOR_BagHandleFront", "ANCHOR_BagHandleBack", "ANCHOR_BagHandoff", "ANCHOR_ReceiptPocket"},
        "min_anchors": 6,
        "min_collisions": 1,
        "actions": {"BagHandleFront_Gather", "BagHandleBack_Gather"},
    },
}


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.actions):
        for datablock in list(datablocks):
            datablocks.remove(datablock)


def mesh_bounds(meshes: list[bpy.types.Object]) -> tuple[float, float, float]:
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    return tuple(max(v[i] for v in points) - min(v[i] for v in points) for i in range(3))


def near_identity_scale(obj: bpy.types.Object, tolerance: float = 1e-4) -> bool:
    return all(math.isclose(value, 1.0, abs_tol=tolerance) for value in obj.scale)


def validate(asset_id: str, spec: dict) -> tuple[list[str], dict]:
    clear_scene()
    path = EXPORT_DIR / f"{asset_id}.glb"
    errors: list[str] = []
    if not path.exists():
        return [f"missing file: {path}"], {}

    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()
    objects = list(bpy.context.scene.objects)
    names = {obj.name for obj in objects}
    meshes = [obj for obj in objects if obj.type == "MESH"]
    visible_meshes = [
        obj
        for obj in meshes
        if not obj.name.startswith("COL_")
        and not obj.name.startswith("VOLUME_")
        and obj.name != "ScannerBeam"
    ]
    anchors = [obj for obj in objects if obj.name.startswith("ANCHOR_")]
    collisions = [obj for obj in meshes if obj.name.startswith("COL_")]

    missing_nodes = sorted(spec["nodes"] - names)
    if missing_nodes:
        errors.append("missing nodes: " + ", ".join(missing_nodes))
    if len(anchors) < spec["min_anchors"]:
        errors.append(f"anchors {len(anchors)} < {spec['min_anchors']}")
    if len(collisions) < spec["min_collisions"]:
        errors.append(f"collisions {len(collisions)} < {spec['min_collisions']}")
    if not visible_meshes:
        errors.append("no visible mesh geometry")

    bad_uv = [obj.name for obj in meshes if obj.data.polygons and not obj.data.uv_layers]
    if bad_uv:
        errors.append("missing UVs: " + ", ".join(sorted(bad_uv)))
    bad_scale = [obj.name for obj in meshes if not near_identity_scale(obj)]
    if bad_scale:
        errors.append("unapplied mesh scale: " + ", ".join(sorted(bad_scale)))

    empty_meshes = [obj.name for obj in meshes if not obj.data.polygons]
    if empty_meshes:
        errors.append("empty meshes: " + ", ".join(sorted(empty_meshes)))
    degenerate = []
    for obj in meshes:
        if any(poly.area <= 1e-12 for poly in obj.data.polygons):
            degenerate.append(obj.name)
    if degenerate:
        errors.append("degenerate faces: " + ", ".join(sorted(degenerate)))

    action_names = {action.name for action in bpy.data.actions}
    missing_actions = sorted(spec["actions"] - action_names)
    if missing_actions:
        errors.append("missing actions: " + ", ".join(missing_actions))
    zero_actions = [action.name for action in bpy.data.actions if action.frame_range.length <= 0]
    if zero_actions:
        errors.append("zero-length actions: " + ", ".join(sorted(zero_actions)))

    if asset_id == "checkout_cash_drawer":
        slide = bpy.data.objects.get("DrawerSlide")
        if slide is not None:
            if slide.get("axis") != "-Y" or not math.isclose(float(slide.get("travel_m", 0.0)), 0.34, abs_tol=1e-5):
                errors.append("drawer slide axis/travel metadata is invalid")
        for denomination in (1, 5, 10, 20, 50):
            pivot = bpy.data.objects.get(f"BillClipPivot_{denomination}")
            label = bpy.data.objects.get(f"BillLabelText_{denomination}")
            well = bpy.data.objects.get(f"BillWellFelt_{denomination}")
            anchor = bpy.data.objects.get(f"ANCHOR_BillWell_{denomination}")
            if pivot is not None and (pivot.parent is None or pivot.parent.name != "DrawerSlide" or pivot.get("hinge_axis") != "X"):
                errors.append(f"invalid bill-clip hierarchy/pivot: {denomination}")
            if label is not None and (label.parent is None or label.parent.name != f"BillClipPivot_{denomination}"):
                errors.append(f"invalid bill-label hierarchy: {denomination}")
            if well is not None:
                clear_width = float(well.get("clear_width_m", 0.0))
                clear_depth = float(well.get("clear_depth_m", 0.0))
                if clear_width < 0.070 or clear_depth < 0.180:
                    errors.append(f"bill well does not fit currency: {denomination}")
            if anchor is not None and (anchor.parent is None or anchor.parent.name != "DrawerSlide"):
                errors.append(f"invalid bill-well anchor hierarchy: {denomination}")
        for cents in (1, 5, 10, 20, 50):
            label = bpy.data.objects.get(f"CoinLabelText_{cents}")
            anchor = bpy.data.objects.get(f"ANCHOR_CoinCup_{cents}")
            if label is not None and (label.parent is None or label.parent.name != "DrawerSlide"):
                errors.append(f"invalid coin-label hierarchy: {cents}")
            if anchor is not None and (anchor.parent is None or anchor.parent.name != "DrawerSlide"):
                errors.append(f"invalid coin-cup anchor hierarchy: {cents}")
        expected_collision_parents = {"COL_DrawerHousing": "DrawerHousing", "COL_DrawerSlide": "DrawerSlide"}
        for collision_name, parent_name in expected_collision_parents.items():
            collision = bpy.data.objects.get(collision_name)
            if collision is not None and (collision.parent is None or collision.parent.name != parent_name):
                errors.append(f"invalid collision hierarchy: {collision_name}")

    if asset_id == "checkout_card_reader":
        slot = bpy.data.objects.get("ChipSlot")
        if slot is not None and float(slot.get("clear_width_m", 0.0)) < 0.090:
            errors.append("chip slot does not provide believable ID-1 card clearance")
        if any(name in names for name in ("CardSwipeChannel", "SwipeRailInner", "SwipeRailOuter", "SwipeGroove")):
            errors.append("obsolete swipe-channel geometry remains in the chip reader")
        ready = bpy.data.objects.get("ANCHOR_CardReady")
        inserted = bpy.data.objects.get("ANCHOR_CardInserted")
        if ready is not None and inserted is not None:
            travel = (ready.matrix_world.translation - inserted.matrix_world.translation).length
            if travel < 0.065 or travel > 0.095:
                errors.append(f"card insertion travel is implausible: {travel:.3f} m")

    tris = 0
    materials = set()
    for obj in visible_meshes:
        obj.data.calc_loop_triangles()
        tris += len(obj.data.loop_triangles)
        materials.update(material.name for material in obj.data.materials if material)
    dims = mesh_bounds(visible_meshes) if visible_meshes else (0.0, 0.0, 0.0)
    stats = {
        "objects": len(objects),
        "meshes": len(visible_meshes),
        "triangles": tris,
        "materials": len(materials),
        "anchors": len(anchors),
        "collisions": len(collisions),
        "actions": len(action_names),
        "dimensions": dims,
        "bytes": path.stat().st_size,
    }
    return errors, stats


def main() -> None:
    failed = False
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    chosen = argv or list(REQUIREMENTS)
    unknown = [asset_id for asset_id in chosen if asset_id not in REQUIREMENTS]
    if unknown:
        raise SystemExit(f"Unknown checkout assets: {', '.join(unknown)}")
    print("CHECKOUT_ASSET_VALIDATION|units=meters|source=shipped_glb")
    for asset_id in chosen:
        spec = REQUIREMENTS[asset_id]
        errors, stats = validate(asset_id, spec)
        if errors:
            failed = True
            print(f"FAIL|{asset_id}|" + " | ".join(errors))
            continue
        dims = stats["dimensions"]
        print(
            f"PASS|{asset_id}|objects={stats['objects']}|meshes={stats['meshes']}|"
            f"tris={stats['triangles']}|materials={stats['materials']}|"
            f"anchors={stats['anchors']}|collisions={stats['collisions']}|"
            f"actions={stats['actions']}|dims={dims[0]:.3f}x{dims[1]:.3f}x{dims[2]:.3f}|"
            f"bytes={stats['bytes']}"
        )
    if failed:
        raise SystemExit("Checkout asset validation failed")
    print(f"COMPLETE|assets={len(chosen)}")


if __name__ == "__main__":
    main()
