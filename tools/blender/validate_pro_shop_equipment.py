"""Validate shipped pro-shop equipment GLBs, not their authoring scenes.

Run from the repository root:

  blender --background --factory-startup \
    --python tools/blender/validate_pro_shop_equipment.py -- checkout

The manifest is the inventory contract.  This script catches export-time name,
hierarchy, UV, transform, collision, animation, scale, and metadata regressions.
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "vendor" / "models" / "pro_shop_equipment" / "_manifest.json"
MAX_TRIANGLES = 20_000
TIERS = ("municipal", "public", "premium", "high_end", "country_club")
CHECKOUT = {"pos_terminal", "card_reader", "receipt_printer", "cash_drawer"}


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.actions):
        for datablock in list(datablocks):
            datablocks.remove(datablock)


def mesh_bounds(meshes):
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    if not points:
        return (0.0, 0.0, 0.0)
    return tuple(max(v[i] for v in points) - min(v[i] for v in points) for i in range(3))


def canonical_name(name):
    return re.sub(r"\.\d{3}$", "", name)


def exact_node(objects, name):
    return next((obj for obj in objects if obj.name == name), None)


def required_nodes(entry):
    family = entry["familyId"]
    tier = entry["tierId"]
    level = entry["qualityLevel"]
    if family == "pos_terminal":
        return {"POS_TiltPivot", "POS_Screen", "ANCHOR_Screen", "ANCHOR_Player", "COL_POS_Base", "COL_POS_Display"}
    if family == "card_reader":
        nodes = {
            "Reader_TiltPivot", "Terminal_Screen", "Terminal_ChipSlot",
            "CARD_INSERT_SOCKET", "CARD_SWIPE_START", "CARD_SWIPE_END",
            "Terminal_Key_0", "Terminal_Key_5", "Terminal_CancelButton",
            "Terminal_BackButton", "Terminal_ConfirmButton", "COL_CardReader",
        }
        if level >= 3:
            nodes.add("NFC_TAP_SOCKET")
        return nodes
    if family == "receipt_printer":
        return {
            "Printer_LidPivot", "ReceiptPaperFeed", "ReceiptPaper",
            "RECEIPT_OUTPUT_SOCKET", "RECEIPT_PICKUP_SOCKET", "COL_ReceiptPrinter",
        }
    if family == "cash_drawer":
        bill_codes = (1, 5, 10, 20) if tier == "municipal" else (1, 5, 10, 20, 50)
        coin_codes = (1, 5, 10, 20) if tier == "municipal" else (1, 5, 10, 20, 50)
        return {
            "DrawerSlide", "CashDrawer_Housing", "CashDrawer_Tray",
            "ANCHOR_DrawerGrip", "COL_CashDrawerHousing",
            *(f"BILL_{code}_SOCKET" for code in bill_codes),
            *(f"COIN_{code:02d}_SOCKET" for code in coin_codes),
        }
    return set()


def validate(entry):
    clear_scene()
    path = ROOT / entry["glb"]
    errors = []
    if not path.exists():
        return [f"missing file: {entry['glb']}"], {}
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()
    objects = list(bpy.context.scene.objects)
    names = {obj.name for obj in objects}
    duplicate_suffixes = sorted(name for name in names if re.search(r"\.\d{3}$", name))
    if duplicate_suffixes:
        errors.append("non-canonical node names: " + ", ".join(duplicate_suffixes))

    missing = sorted(required_nodes(entry) - names)
    if missing:
        errors.append("missing nodes: " + ", ".join(missing))

    roots = [obj for obj in objects if obj.get("asset_id") == entry["id"]]
    if len(roots) != 1:
        errors.append(f"asset root count is {len(roots)}, expected 1")
        root = None
    else:
        root = roots[0]
        expected_props = {
            "equipment_family": entry["familyId"],
            "quality_tier": entry["tierId"],
            "quality_level": entry["qualityLevel"],
            "units": "meters",
        }
        for key, value in expected_props.items():
            if root.get(key) != value:
                errors.append(f"root metadata {key}={root.get(key)!r}, expected {value!r}")

    meshes = [obj for obj in objects if obj.type == "MESH"]
    visible = [obj for obj in meshes if not obj.name.startswith("COL_")]
    collisions = [obj for obj in meshes if obj.name.startswith("COL_")]
    if not visible:
        errors.append("no visible mesh geometry")
    if not collisions:
        errors.append("no collision meshes")
    bad_collision = [obj.name for obj in collisions if not obj.get("collision_proxy")]
    if bad_collision:
        errors.append("collision metadata missing: " + ", ".join(sorted(bad_collision)))

    bad_uv = [obj.name for obj in visible if obj.data.polygons and not obj.data.uv_layers]
    if bad_uv:
        errors.append("missing visible UVs: " + ", ".join(sorted(bad_uv)))
    bad_scale = [
        obj.name for obj in meshes
        if any(not math.isclose(float(value), 1.0, abs_tol=1e-4) for value in obj.scale)
    ]
    if bad_scale:
        errors.append("unapplied mesh scale: " + ", ".join(sorted(bad_scale)))
    empty = [obj.name for obj in meshes if not obj.data.polygons]
    if empty:
        errors.append("empty meshes: " + ", ".join(sorted(empty)))
    degenerate = [
        obj.name for obj in meshes
        if any(poly.area <= 1e-12 for poly in obj.data.polygons)
    ]
    if degenerate:
        errors.append("degenerate faces: " + ", ".join(sorted(degenerate)))

    triangles = 0
    materials = set()
    for obj in visible:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        materials.update(mat.name for mat in obj.data.materials if mat)
    if triangles > MAX_TRIANGLES:
        errors.append(f"triangle budget exceeded: {triangles} > {MAX_TRIANGLES}")

    actions = [action for action in bpy.data.actions if action.frame_range.length > 0]
    if entry["familyId"] in CHECKOUT and not actions:
        errors.append("no exported animation")

    dims = mesh_bounds(visible)
    target = tuple(float(value) for value in entry["targetDimensionsM"])
    # Blender's glTF round trip restores axes, but authoring envelopes allow
    # small overhangs such as drawer faces and receipt paper.
    for axis, actual, expected in zip("XYZ", dims, target):
        if actual < expected * 0.45 or actual > expected * 1.25:
            errors.append(f"{axis} bound {actual:.3f}m outside envelope for {expected:.3f}m target")

    if entry["familyId"] == "cash_drawer":
        slide = exact_node(objects, "DrawerSlide")
        if slide is not None and (slide.get("slide_axis") != "-Y" or float(slide.get("open_travel_m", 0)) <= 0):
            errors.append("invalid drawer slide contract")
        for obj in objects:
            if obj.name.startswith(("BILL_", "COIN_")) and obj.name.endswith("_SOCKET"):
                if obj.parent is None or obj.parent.name != "DrawerSlide":
                    errors.append(f"socket is not parented to DrawerSlide: {obj.name}")

    stats = {
        "objects": len(objects), "meshes": len(visible), "triangles": triangles,
        "materials": len(materials), "collisions": len(collisions),
        "actions": len(actions), "dimensions": dims, "bytes": path.stat().st_size,
    }
    return errors, stats


def main():
    if not MANIFEST.exists():
        raise SystemExit(f"Missing manifest: {MANIFEST}")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    requested = set(argv)
    entries = manifest["assets"]
    if requested:
        entries = [
            entry for entry in entries
            if entry["id"] in requested
            or entry["familyId"] in requested
            or ("checkout" in requested and entry["familyId"] in CHECKOUT)
        ]
    if not entries:
        raise SystemExit("No manifest assets matched the requested selectors")
    failed = False
    print("PRO_SHOP_EQUIPMENT_VALIDATION|source=shipped_glb|units=meters")
    for entry in entries:
        errors, stats = validate(entry)
        if errors:
            failed = True
            print(f"FAIL|{entry['id']}|" + " | ".join(errors))
        else:
            dims = stats["dimensions"]
            print(
                f"PASS|{entry['id']}|objects={stats['objects']}|meshes={stats['meshes']}|"
                f"tris={stats['triangles']}|materials={stats['materials']}|"
                f"collisions={stats['collisions']}|actions={stats['actions']}|"
                f"dims={dims[0]:.3f}x{dims[1]:.3f}x{dims[2]:.3f}|bytes={stats['bytes']}"
            )
    if failed:
        raise SystemExit(1)
    print(f"COMPLETE|assets={len(entries)}|status=PASS")


if __name__ == "__main__":
    main()
