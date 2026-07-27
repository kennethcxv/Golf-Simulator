"""Incremental Course-3 iteration-04 asset patch.

Adds the final two-bay cartport structure and moves patio-door glazing to the
course-facing side. The primary generator contains the same construction.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import assets_51_100_lib as A
import build_mountain_clubhouse as B


def material(name: str) -> bpy.types.Material:
    return bpy.data.materials[f"MAT_{name}"]


def remove_previous_cartport_patch() -> None:
    prefixes = (
        "MESH_CartportFrontDivider",
        "MESH_CartportRearDivider",
        "MESH_CartportFrontCrossHeader",
        "MESH_CartportRearCrossHeader",
        "MESH_CartportFrontBayBrace",
        "MESH_CartportRearBayBrace",
    )
    for obj in list(bpy.data.objects):
        if obj.name.startswith(prefixes):
            bpy.data.objects.remove(obj, do_unlink=True)


def move_patio_glazing_outward() -> None:
    for obj in bpy.data.objects:
        if "PatioEntrance" not in obj.name:
            continue
        if "GlassLite" in obj.name:
            # Clean-build local Y changes from -0.012 m to +0.012 m.
            obj.location.y = 0.012
        elif "_Rail_" in obj.name:
            # Clean-build local Y changes from -0.026 m to +0.026 m.
            obj.location.y = 0.026


def add_cartport_bay_structure() -> None:
    parent = bpy.data.objects["LOD0_CoveredGolfCartParking"]
    mats = {
        "timber": material("Lodge_HeavyTimberWalnut"),
        "stone_a": material("Lodge_FieldstoneGranite"),
        "stone_b": material("Lodge_FieldstoneWarm"),
        "stone_c": material("Lodge_FieldstoneSage"),
        "stone_d": material("Lodge_FieldstoneCharcoal"),
        "mortar": material("Lodge_WarmMortar"),
    }
    x0 = -B.BUILDING_W / 2.0 - B.CARTPORT_W
    x1 = -B.BUILDING_W / 2.0
    y0 = B.FRONT_Y + 0.10
    y1 = y0 + B.CARTPORT_D
    bay_divider_x = (x0 + x1) * 0.5
    for side, y, seed, public_direction in (
        ("Front", y0 + 0.28, 735, -1.0),
        ("Rear", y1 - 0.28, 736, 1.0),
    ):
        B.stone_pier(f"Cartport{side}DividerBase", bay_divider_x, y, 0.13, 0.86,
                     mats, parent, seed=seed, size=0.68,
                     public_direction=public_direction)
        B.box(f"Cartport{side}DividerPost", (0.32, 0.32, 2.92),
              (bay_divider_x, y, 2.30), mats["timber"], parent,
              family="heavy_timber_column", bevel=0.022, cart_bay_divider=True)
        B.beam_between(f"Cartport{side}CrossHeader", (x0 + 0.32, y, 3.62),
                       (x1 - 0.25, y, 4.10), (0.28, 0.28), mats["timber"], parent)
        B.beam_between(f"Cartport{side}BayBraceWest",
                       (bay_divider_x, y, 3.20), (bay_divider_x - 1.05, y, 3.83),
                       (0.16, 0.16), mats["timber"], parent,
                       family="cartport_knee_brace")
        B.beam_between(f"Cartport{side}BayBraceEast",
                       (bay_divider_x, y, 3.20), (bay_divider_x + 1.05, y, 3.94),
                       (0.16, 0.16), mats["timber"], parent,
                       family="cartport_knee_brace")


def main() -> None:
    root = bpy.data.objects["A_MOUNTAIN_LODGE_CLUBHOUSE_ROOT"]
    remove_previous_cartport_patch()
    move_patio_glazing_outward()
    add_cartport_bay_structure()
    report = B.audit(root)
    if not report["ok"]:
        raise RuntimeError("iteration-04 asset audit failed: " + json.dumps(report, sort_keys=True))
    A.save_blend(B.SOURCE_PATH)
    A.export_glb(B.CANONICAL_PATH, root, include_animations=True)
    A.export_glb(B.RUNTIME_PATH, root, include_animations=True)
    A.render_studio_preview(root, B.PREVIEW_PATH, width=1600, height=1000,
                            azimuth_degrees=32.0, elevation_degrees=22.0)
    B.REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("MOUNTAIN_CLUBHOUSE_ITERATION04_AUDIT|" + json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
