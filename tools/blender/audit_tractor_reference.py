"""Print repeatable geometry metadata for the existing tractor reference assets.

Run from the repository root:
  blender --background --factory-startup --python tools/blender/audit_tractor_reference.py
"""

from __future__ import annotations

import json
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
ASSETS = (
    ROOT / "vendor" / "models" / "tractor_production.glb",
    ROOT / "vendor" / "models" / "mower_deck_production.glb",
    ROOT / "vendor" / "models" / "tractor_red.glb",
    ROOT / "vendor" / "models" / "tractor.glb",
    ROOT / "vendor" / "models" / "tractor_broken.glb",
    ROOT / "vendor" / "models" / "mower_deck.glb",
)


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for datablock in list(datablocks):
            datablocks.remove(datablock)


def inspect(path: Path) -> dict:
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    triangles = 0
    materials = set()
    missing_uv = []
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        materials.update(mat.name for mat in obj.data.materials if mat)
        if not obj.data.uv_layers:
            missing_uv.append(obj.name)
    minimum = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    maximum = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    dimensions = maximum - minimum
    return {
        "asset": path.relative_to(ROOT).as_posix(),
        "bytes": path.stat().st_size,
        "mesh_count": len(meshes),
        "triangles": triangles,
        "material_count": len(materials),
        "materials": sorted(materials),
        "dimensions_m_xyz": [round(v, 4) for v in dimensions],
        "bounds_min_xyz": [round(v, 4) for v in minimum],
        "bounds_max_xyz": [round(v, 4) for v in maximum],
        "missing_uv_meshes": missing_uv,
        "animations": sorted(bpy.data.actions.keys()),
        "objects": [
            {
                "name": obj.name,
                "parent": obj.parent.name if obj.parent else None,
                "type": obj.type,
            }
            for obj in sorted(bpy.context.scene.objects, key=lambda item: item.name)
        ],
    }


print(json.dumps([inspect(path) for path in ASSETS], indent=2))
