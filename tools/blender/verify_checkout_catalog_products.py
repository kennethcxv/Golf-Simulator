"""Clean-reimport verification for the expanded sellable checkout catalog.

Run from the repository root::

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
        --background --factory-startup \
        --python tools/blender/verify_checkout_catalog_products.py

The verifier imports each runtime GLB into a fresh factory scene and writes
stable JSON evidence beneath ``qa/pine-hills-clubhouse/blender``.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[2]
GLB_DIR = ROOT / "vendor" / "models" / "clubhouse"
REPORT = ROOT / "qa" / "pine-hills-clubhouse" / "blender" / "checkout-catalog-products-reimport.json"
TOLERANCE = 0.08

# Dimensions are expressed in the Blender authoring convention: X width,
# Y depth, Z height. The glTF runtime converts these to Three.js X/Y/Z.
ASSETS = {
    "checkout_product_visor": (0.208, 0.210, 0.070),
    "checkout_product_folded_bottom": (0.230, 0.195, 0.095),
    "checkout_product_divot_tool_card": (0.130, 0.020, 0.100),
    "checkout_product_eyewear_case": (0.160, 0.070, 0.060),
    "checkout_product_bottle": (0.072, 0.072, 0.220),
    "checkout_product_scorecard": (0.150, 0.105, 0.005),
    "checkout_product_beverage_can": (0.066, 0.066, 0.122),
    "checkout_product_snack_pouch": (0.160, 0.0715, 0.195),
    "checkout_product_snack_bar": (0.150, 0.025, 0.055),
}

REQUIRED = {
    "ANCHOR_ProductBarcode",
    "ANCHOR_ProductGripPrimary",
    "COL_Product",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def rounded(values):
    return [round(float(value), 6) for value in values]


def visible_bounds(objects):
    low = Vector((math.inf, math.inf, math.inf))
    high = Vector((-math.inf, -math.inf, -math.inf))
    found = False
    for obj in objects:
        if obj.type != "MESH" or obj.name.startswith("COL_") or obj.hide_get():
            continue
        found = True
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            low.x = min(low.x, point.x)
            low.y = min(low.y, point.y)
            low.z = min(low.z, point.z)
            high.x = max(high.x, point.x)
            high.y = max(high.y, point.y)
            high.z = max(high.z, point.z)
    if not found:
        raise RuntimeError("no visible production meshes")
    return low, high


def verify(stem: str, target):
    path = GLB_DIR / f"{stem}.glb"
    issues = []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    objects = list(bpy.context.scene.objects)
    names = {obj.name for obj in objects}
    root = bpy.data.objects.get(stem)

    if root is None:
        issues.append(f"missing exact root {stem}")
    for required in sorted(REQUIRED):
        if required not in names:
            issues.append(f"missing {required}")
    if any(obj.type in {"CAMERA", "LIGHT"} for obj in objects):
        issues.append("runtime artifact contains a camera or light")

    visible = [obj for obj in objects if obj.type == "MESH" and not obj.name.startswith("COL_")]
    for obj in visible:
        if not obj.data.materials or obj.data.materials[0] is None:
            issues.append(f"{obj.name} has no material")
        if not obj.data.uv_layers:
            issues.append(f"{obj.name} has no UV map")
        scale = obj.matrix_world.to_scale()
        if any(abs(float(value) - 1.0) > 1.0e-5 for value in scale):
            issues.append(f"{obj.name} has unapplied world scale {rounded(scale)}")

    low, high = visible_bounds(objects)
    actual = high - low
    for axis, (value, expected) in enumerate(zip(actual, target)):
        ratio = float(value) / float(expected)
        if not 1.0 - TOLERANCE <= ratio <= 1.0 + TOLERANCE:
            issues.append(
                f"visible axis {axis} is {float(value):.6f}m; expected {expected:.6f}m (+/-8%)"
            )
    if low.z < -0.001 or low.z > 0.008:
        issues.append(f"counter-contact minimum Z is {low.z:.6f}m")

    if root is not None:
        metadata_target = tuple(float(value) for value in root.get("target_dimensions_m", ()))
        if len(metadata_target) != 3 or any(abs(a - b) > 1.0e-6 for a, b in zip(metadata_target, target)):
            issues.append(f"target_dimensions_m metadata is {metadata_target}")
        if root.get("units") != "meters":
            issues.append("root units metadata is not meters")
        if root.get("license") != "Project-owned / UNLICENSED":
            issues.append("root license metadata drifted")

    triangles = sum(len(obj.data.loop_triangles) for obj in visible)
    return {
        "asset": stem,
        "path": path.relative_to(ROOT).as_posix(),
        "sha256": sha256(path),
        "bytes": path.stat().st_size,
        "ok": not issues,
        "issues": issues,
        "visibleMeshes": len(visible),
        "triangles": triangles,
        "boundsMinM": rounded(low),
        "boundsMaxM": rounded(high),
        "dimensionsM": rounded(actual),
        "targetDimensionsM": list(target),
    }


def main():
    results = [verify(stem, target) for stem, target in ASSETS.items()]
    report = {
        "schemaVersion": 1,
        "kind": "checkout-catalog-products-clean-reimport",
        "blenderVersion": bpy.app.version_string,
        "builder": "tools/blender/build_checkout_products.py",
        "verifier": SCRIPT.relative_to(ROOT).as_posix(),
        "ok": all(result["ok"] for result in results),
        "assets": results,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    for result in results:
        print(f"VERIFY|{result['asset']}|{'PASS' if result['ok'] else 'FAIL'}")
        for issue in result["issues"]:
            print(f"  ISSUE|{issue}")
    print(f"REPORT|{REPORT.relative_to(ROOT).as_posix()}")
    raise SystemExit(0 if report["ok"] else 1)


if __name__ == "__main__":
    main()
