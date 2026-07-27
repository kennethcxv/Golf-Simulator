"""Reimport and validate every generated pro-shop furniture GLB in Blender.

Run with Blender 4.x/5.x in background mode or through Blender MCP. The report is
written to qa/pro_shop_furniture/asset-verification.json.
"""

import json
import math
import os
from pathlib import Path

import bpy


REPO = Path(os.environ.get('GF_REPO_ROOT', Path(__file__).resolve().parents[2])).resolve()
MANIFEST_PATH = REPO / 'Assets' / 'pro_shop_furniture' / 'manifest.json'
REPORT_PATH = REPO / 'qa' / 'pro_shop_furniture' / 'asset-verification.json'


def clean_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for collection in (
        bpy.data.meshes, bpy.data.curves, bpy.data.materials,
        bpy.data.cameras, bpy.data.lights,
    ):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)


def near_one(value):
    return math.isclose(value, 1.0, rel_tol=0, abs_tol=0.001)


def check_asset(key, entry):
    clean_scene()
    glb_path = REPO / entry['glb']
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    objects = list(bpy.context.scene.objects)
    meshes = [obj for obj in objects if obj.type == 'MESH']
    colliders = [obj for obj in meshes if obj.name.startswith('COL_')]
    visible_meshes = [obj for obj in meshes if not obj.name.startswith('COL_')]
    sockets = [obj for obj in objects if obj.name.startswith('SOCKET_')]
    pivots = [obj for obj in objects if obj.name.startswith('PIVOT_')]
    issues = []

    if not glb_path.exists():
        issues.append('missing GLB')
    if len(visible_meshes) != entry['meshCount']:
        issues.append(f"mesh count {len(visible_meshes)} != manifest {entry['meshCount']}")
    if len(colliders) != 1:
        issues.append(f'expected one collider, found {len(colliders)}')
    if not any(obj.name.startswith('SOCKET_PLACEMENT') for obj in sockets):
        issues.append('missing SOCKET_PLACEMENT')

    missing_materials = [obj.name for obj in visible_meshes if not obj.data.materials]
    if missing_materials:
        issues.append(f'meshes without materials: {missing_materials[:4]}')
    missing_uvs = [obj.name for obj in visible_meshes if len(obj.data.uv_layers) == 0]
    if missing_uvs:
        issues.append(f'meshes without UVs: {missing_uvs[:4]}')
    scaled = [obj.name for obj in meshes if not all(near_one(value) for value in obj.scale)]
    if scaled:
        issues.append(f'unapplied mesh scales: {scaled[:4]}')

    if colliders:
        actual = sorted(round(value, 3) for value in colliders[0].dimensions)
        expected = sorted(round(value, 3) for value in entry['dimensionsM'])
        if any(abs(a - b) > 0.015 for a, b in zip(actual, expected)):
            issues.append(f'collider dimensions {actual} != expected {expected}')

    category = entry['category']
    tier = entry['tier']
    if category in ('office-cabinets', 'wall-cabinets', 'storage-cabinets'):
        door_pivots = [obj for obj in pivots if obj.name.startswith('PIVOT_CabinetDoor')]
        if len(door_pivots) != 2 or any(not pivot.children for pivot in door_pivots):
            issues.append(f'cabinet door pivots invalid: {len(door_pivots)}')
    if category == 'locker-units':
        door_pivots = [obj for obj in pivots if obj.name.startswith('PIVOT_LockerDoor')]
        if len(door_pivots) < 2 or any(not pivot.children for pivot in door_pivots):
            issues.append(f'locker door pivots invalid: {len(door_pivots)}')
    if category == 'fitting-rooms' and tier in ('luxury', 'executive'):
        door_pivots = [obj for obj in pivots if obj.name.startswith('PIVOT_FittingRoomDoor')]
        if len(door_pivots) != 1 or not door_pivots[0].children:
            issues.append(f'fitting-room door pivot invalid: {len(door_pivots)}')

    return {
        'asset': key,
        'glb': entry['glb'],
        'dimensionsM': entry['dimensionsM'],
        'visibleMeshes': len(visible_meshes),
        'materials': len({mat.name for obj in visible_meshes for mat in obj.data.materials if mat}),
        'uvMappedMeshes': len(visible_meshes) - len(missing_uvs),
        'colliders': len(colliders),
        'sockets': len(sockets),
        'pivots': len(pivots),
        'issues': issues,
    }


def main():
    manifest = json.loads(MANIFEST_PATH.read_text('utf-8'))
    records = [check_asset(key, entry) for key, entry in sorted(manifest.items())]
    failures = [record for record in records if record['issues']]
    report = {
        'assetCount': len(records),
        'passed': len(records) - len(failures),
        'failed': len(failures),
        'failures': failures,
        'assets': records,
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + '\n', 'utf-8')
    print(json.dumps({
        'assetCount': report['assetCount'],
        'passed': report['passed'],
        'failed': report['failed'],
        'report': str(REPORT_PATH),
    }))
    if failures:
        raise RuntimeError(f'{len(failures)} pro-shop furniture GLBs failed verification')


if __name__ == '__main__':
    main()
