"""Apply the fourth fieldstone chimney face to an existing validated clubhouse blend.

This is a deterministic incremental authoring path for visual iteration. The primary
generator contains the same construction, so a clean rebuild produces the same result.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import assets_51_100_lib as A
import build_mountain_clubhouse as B


def remove_previous_front_face() -> None:
    for obj in list(bpy.data.objects):
        if "ChimneyFrontFace" in obj.name:
            bpy.data.objects.remove(obj, do_unlink=True)


def main() -> None:
    root = bpy.data.objects["A_MOUNTAIN_LODGE_CLUBHOUSE_ROOT"]
    parent = bpy.data.objects["LOD0_StoneFireplaceAndChimney"]
    mats = {
        "mortar": bpy.data.materials["MAT_Lodge_WarmMortar"],
        "stone_a": bpy.data.materials["MAT_Lodge_FieldstoneGranite"],
        "stone_b": bpy.data.materials["MAT_Lodge_FieldstoneWarm"],
        "stone_c": bpy.data.materials["MAT_Lodge_FieldstoneSage"],
        "stone_d": bpy.data.materials["MAT_Lodge_FieldstoneCharcoal"],
    }
    remove_previous_front_face()
    cx = 6.55
    cy = B.BACK_Y - 0.12
    B.stone_veneer("ChimneyFrontFace", "x", cy - 0.31, cx - 1.20, cx + 1.20,
                    0.10, 8.90, mats, parent, seed=815, surface_direction=-1.0)
    report = B.audit(root)
    if not report["ok"]:
        raise RuntimeError("incremental chimney audit failed: " + json.dumps(report, sort_keys=True))
    A.save_blend(B.SOURCE_PATH)
    A.export_glb(B.CANONICAL_PATH, root, include_animations=True)
    A.export_glb(B.RUNTIME_PATH, root, include_animations=True)
    A.render_studio_preview(root, B.PREVIEW_PATH, width=1600, height=1000,
                            azimuth_degrees=32.0, elevation_degrees=22.0)
    B.REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("MOUNTAIN_CLUBHOUSE_PATCH_AUDIT|" + json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
