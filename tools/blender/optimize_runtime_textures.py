"""Cap embedded runtime GLB atlases without touching the raw owner assets.

Usage (Blender 5.1):

    blender --background --factory-startup \
      --python tools/blender/optimize_runtime_textures.py -- --stage qa/texture-stage
    blender --background --factory-startup \
      --python tools/blender/optimize_runtime_textures.py -- --apply

The first form writes validated candidates beneath a staging directory. The
second atomically replaces only derived ``vendor/models`` GLBs after reimporting
each candidate and proving that triangle counts, material counts, transforms,
and bounds survived. ``Assets/`` is never opened for writing.
"""

import argparse
import json
import math
import os
import sys

import bpy
import mathutils


ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
MAX_DIMENSION = 1024

# Every derived GLB that still carried a 4096px embedded image at the release
# audit. The preserved vendor/models/clubhouse_ext.glb is intentionally absent;
# the runtime uses its already-optimized clubhouse_ext_opt.glb sibling.
RUNTIME_GLBS = [
    'vendor/models/tractor_broken.glb',
    'vendor/models/mower_deck.glb',
    'vendor/models/shed.glb',
    'vendor/models/workbench.glb',
    'vendor/models/tool_chest.glb',
    'vendor/models/gas_can.glb',
    'vendor/models/belt.glb',
    'vendor/models/leaves_pile.glb',
    'vendor/models/tractor_red.glb',
    'vendor/models/hose_nozzle.glb',
    'vendor/models/hand_fork.glb',
    'vendor/models/bucket_soil.glb',
    'vendor/models/rake.glb',
    'vendor/models/tee_sign_broken.glb',
    'vendor/models/course_sign.glb',
    'vendor/models/club_sign.glb',
    'vendor/models/flagpole.glb',
    'vendor/models/tee_markers.glb',
    'vendor/models/golf_cart.glb',
    'vendor/models/clubhouse/armchair.glb',
    'vendor/models/clubhouse/office_chair.glb',
    'vendor/models/clubhouse/cardterm_pro.glb',
    'vendor/models/clubhouse/kiosk.glb',
    'vendor/models/clubhouse/display_shelf.glb',
    'vendor/models/clubhouse/shoe_pro.glb',
    'vendor/models/clubhouse/cap_pro.glb',
    'vendor/models/clubhouse/headcover.glb',
    'vendor/models/clubhouse/rangefinder.glb',
]


def wipe():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for blocks in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.objects,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for block in list(blocks):
            blocks.remove(block)


def resize_scene_images(max_dimension=MAX_DIMENSION):
    """Resize loaded images proportionally and return an audit record."""
    changed = []
    for image in list(bpy.data.images):
        width, height = image.size[:]
        longest = max(width, height)
        if longest <= max_dimension or longest <= 0:
            continue
        scale = max_dimension / longest
        target = (
            max(1, int(round(width * scale))),
            max(1, int(round(height * scale))),
        )
        image.scale(*target)
        image.update()
        # GLB imports are packed. Repacking after scale forces the exporter to
        # use the resized pixels instead of copying the original JPEG bytes.
        image.pack()
        changed.append({
            'name': image.name,
            'before': [width, height],
            'after': [target[0], target[1]],
        })
    return changed


def scene_stats():
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    triangles = 0
    corners = []
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        corners.extend(obj.matrix_world @ mathutils.Vector(corner) for corner in obj.bound_box)
    if corners:
        bounds = [
            min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners),
            max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners),
        ]
    else:
        bounds = [0.0] * 6
    images = [[int(image.size[0]), int(image.size[1])] for image in bpy.data.images]
    return {
        'meshes': len(meshes),
        'triangles': triangles,
        'materials': len(bpy.data.materials),
        'images': images,
        'bounds': bounds,
    }


def close_enough(a, b, epsilon=1e-4):
    return all(math.isclose(x, y, abs_tol=epsilon) for x, y in zip(a, b))


def validate(before, after):
    errors = []
    for key in ('meshes', 'triangles', 'materials'):
        if before[key] != after[key]:
            errors.append('%s changed: %s -> %s' % (key, before[key], after[key]))
    if not close_enough(before['bounds'], after['bounds']):
        errors.append('world bounds changed: %s -> %s' % (before['bounds'], after['bounds']))
    oversized = [size for size in after['images'] if max(size) > MAX_DIMENSION]
    if oversized:
        errors.append('oversized images remain: %s' % oversized)
    return errors


def export_candidate(source, destination):
    wipe()
    bpy.ops.import_scene.gltf(filepath=source)
    before = scene_stats()
    resized = resize_scene_images()
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=destination,
        export_format='GLB',
        export_yup=True,
        export_materials='EXPORT',
        export_image_format='JPEG',
        export_jpeg_quality=82,
    )

    wipe()
    bpy.ops.import_scene.gltf(filepath=destination)
    after = scene_stats()
    errors = validate(before, after)
    return {
        'source': os.path.relpath(source, ROOT).replace('\\', '/'),
        'sourceBytes': os.path.getsize(source),
        'candidateBytes': os.path.getsize(destination),
        'resized': resized,
        'before': before,
        'after': after,
        'errors': errors,
    }


def args_from_blender():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--stage', default='qa/steam-release-polish/texture-budget/staged')
    parser.add_argument('--only', action='append', default=[])
    return parser.parse_args(argv)


def main():
    args = args_from_blender()
    stage_root = os.path.join(ROOT, args.stage)
    chosen = RUNTIME_GLBS
    if args.only:
        needles = set(args.only)
        chosen = [rel for rel in chosen if rel in needles or os.path.splitext(os.path.basename(rel))[0] in needles]
        missing = needles - {rel for rel in chosen} - {os.path.splitext(os.path.basename(rel))[0] for rel in chosen}
        if missing:
            raise RuntimeError('Unknown --only entries: %s' % sorted(missing))

    audit = []
    for rel in chosen:
        source = os.path.join(ROOT, rel)
        candidate = os.path.join(stage_root, rel)
        record = export_candidate(source, candidate)
        audit.append(record)
        status = 'PASS' if not record['errors'] else 'FAIL'
        print('%s %-55s %8d -> %8d bytes, %d image(s) resized' % (
            status, rel, record['sourceBytes'], record['candidateBytes'], len(record['resized'])))
        for error in record['errors']:
            print('  !! ' + error)
        if args.apply and not record['errors']:
            os.replace(candidate, source)

    os.makedirs(stage_root, exist_ok=True)
    audit_path = os.path.join(stage_root, 'audit.json')
    with open(audit_path, 'w', encoding='utf-8') as handle:
        json.dump({'maxDimension': MAX_DIMENSION, 'applied': args.apply, 'assets': audit}, handle, indent=2)
        handle.write('\n')
    if any(record['errors'] for record in audit):
        raise RuntimeError('Texture-budget validation failed; see ' + audit_path)
    print('Validated %d runtime GLBs; audit: %s' % (len(audit), audit_path))


if __name__ == '__main__':
    main()
