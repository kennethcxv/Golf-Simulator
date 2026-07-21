"""Re-import and validate every shipped furniture-catalog GLB in Blender 5.1.

Usage:
  blender --background --factory-startup \
    --python tools/blender/validate_furniture_catalog.py -- --all
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import bpy


REPO = Path(__file__).resolve().parents[2]
MANIFEST = REPO / "tools" / "blender" / "furniture_catalog_manifest.json"
OUTPUT_JSON = REPO / "qa" / "furniture_catalog" / "blender_validation.json"
OUTPUT_MD = REPO / "qa" / "furniture_catalog" / "blender_validation.md"
MOVING_MODELS = {
    "office-desk", "back-counter", "member-locker", "storage-cabinet",
    "towel-storage", "trophy-case", "interior-door", "exterior-door",
    "restroom-stall",
}


def arguments() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--family", action="append", default=[])
    return parser.parse_args(argv)


def clear_import() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.images,
                       bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for datablock in list(collection):
            collection.remove(datablock, do_unlink=True)


def close(a: float, b: float, tolerance: float = 0.015) -> bool:
    return abs(float(a) - float(b)) <= tolerance


def validate_tier(family: dict, tier: dict) -> dict:
    clear_import()
    path = REPO / tier["glb"]
    errors: list[str] = []
    warnings: list[str] = []
    if not path.is_file():
        return {"skuId": tier["skuId"], "path": tier["glb"], "ok": False,
                "errors": ["missing GLB"], "warnings": []}
    try:
        bpy.ops.import_scene.gltf(filepath=str(path))
    except Exception as exc:  # Blender reports importer details on stdout too.
        return {"skuId": tier["skuId"], "path": tier["glb"], "ok": False,
                "errors": [f"import failed: {exc}"], "warnings": []}

    objects = list(bpy.context.scene.objects)
    roots = [obj for obj in objects if obj.get("asset_id") == tier["skuId"]]
    if len(roots) != 1:
        errors.append(f"expected one metadata root, found {len(roots)}")
    root = roots[0] if roots else None
    if root:
        for key, expected in {
            "family_id": family["familyId"],
            "model_family": family["modelFamily"],
            "tier": tier["id"],
            "placement_mode": family["placementMode"],
            "units": "meters",
        }.items():
            if root.get(key) != expected:
                errors.append(f"root {key}={root.get(key)!r}, expected {expected!r}")

    collisions = [obj for obj in objects if obj.name.startswith("COL_")]
    if len(collisions) != 1:
        errors.append(f"expected one simplified collision mesh, found {len(collisions)}")
    elif collisions[0].get("collision_type") != "simple_box":
        errors.append("collision proxy is missing simple_box metadata")

    expected_socket = {
        "wall": "SOCKET_WallMount",
        "ceiling": "SOCKET_CeilingMount",
    }.get(family["placementMode"], "SOCKET_PLACEMENT")
    sockets = [obj for obj in objects if obj.name == expected_socket]
    if len(sockets) != 1:
        errors.append(f"expected exactly one {expected_socket}, found {len(sockets)}")

    dims = family["dimensionsM"]
    if collisions:
        collision = collisions[0]
        actual = (collision.dimensions.x, collision.dimensions.y, collision.dimensions.z)
        expected = (dims["width"], dims["depth"], dims["height"])
        if not all(close(value, target) for value, target in zip(actual, expected)):
            errors.append(f"collision dimensions {tuple(round(v, 4) for v in actual)} != {expected}")

    meshes = [obj for obj in objects if obj.type == "MESH"]
    visible_meshes = [obj for obj in meshes if not obj.name.startswith("COL_")]
    if not visible_meshes:
        errors.append("no visible mesh geometry")
    unapplied = [obj.name for obj in meshes if any(not close(value, 1.0, 0.001) for value in obj.scale)]
    if unapplied:
        errors.append(f"unapplied mesh scale: {', '.join(unapplied[:8])}")

    materials = sorted({slot.material.name for obj in visible_meshes for slot in obj.material_slots if slot.material})
    invalid_materials = [name for name in materials if not name.startswith("M_FURN_")]
    if invalid_materials:
        errors.append(f"materials outside shared furniture naming: {invalid_materials}")

    moving = [obj for obj in objects if bool(obj.get("moving_component"))]
    invalid_moving = [obj.name for obj in moving if not obj.parent or not obj.parent.name.startswith("PIVOT_")]
    if invalid_moving:
        errors.append(f"moving components lack authored pivots: {invalid_moving}")
    if family["modelFamily"] in MOVING_MODELS and not moving:
        errors.append("family requires a separate moving component and pivot")

    triangles = 0
    for obj in visible_meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    if triangles > 30000:
        errors.append(f"triangle budget exceeded: {triangles} > 30000")
    elif triangles > 16000:
        warnings.append(f"high triangle count: {triangles}")

    return {
        "skuId": tier["skuId"],
        "familyId": family["familyId"],
        "tier": tier["id"],
        "path": tier["glb"],
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "fileBytes": path.stat().st_size,
        "objectCount": len(objects),
        "visibleMeshCount": len(visible_meshes),
        "triangleCount": triangles,
        "materialNames": materials,
        "movingComponentCount": len(moving),
        "socket": expected_socket,
    }


def main() -> None:
    args = arguments()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    selected = set(args.family)
    families = [row for row in manifest["families"] if not selected or row["familyId"] in selected]
    unknown = selected - {row["familyId"] for row in families}
    if unknown:
        raise SystemExit(f"unknown families: {', '.join(sorted(unknown))}")
    results = [validate_tier(family, tier) for family in families for tier in family["tiers"]]
    failures = [row for row in results if not row["ok"]]
    warnings = [warning for row in results for warning in row["warnings"]]
    report = {
        "schema": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "blenderVersion": bpy.app.version_string,
        "manifest": str(MANIFEST.relative_to(REPO)).replace("\\", "/"),
        "familyCount": len(families),
        "objectCount": len(results),
        "passed": len(results) - len(failures),
        "failed": len(failures),
        "warningCount": len(warnings),
        "triangleTotal": sum(row.get("triangleCount", 0) for row in results),
        "maxTriangles": max((row.get("triangleCount", 0) for row in results), default=0),
        "results": results,
    }
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# Furniture catalog Blender validation",
        "",
        f"- Blender: {report['blenderVersion']}",
        f"- Imported: {report['objectCount']} GLBs across {report['familyCount']} families",
        f"- Passed: {report['passed']}",
        f"- Failed: {report['failed']}",
        f"- Warnings: {report['warningCount']}",
        f"- Total triangles: {report['triangleTotal']:,}",
        f"- Largest asset: {report['maxTriangles']:,} triangles",
        "",
    ]
    if failures:
        lines += ["## Failures", ""]
        for row in failures:
            lines.append(f"- `{row['skuId']}`: {'; '.join(row['errors'])}")
    else:
        lines += ["Every shipped catalog GLB re-imported with its metadata root, applied mesh scale, "
                  "one simplified collision proxy, correct placement socket, shared material names, "
                  "moving-part pivots where required, believable manifest envelope, and triangle budget intact."]
    OUTPUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("objectCount", "passed", "failed", "warningCount", "triangleTotal", "maxTriangles")}))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
