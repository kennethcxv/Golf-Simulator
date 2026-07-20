# STYLISED CUSTOMER / GOLFER PARTS
#
#   "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
#       --factory-startup --python tools/blender/build_character.py
#
# The game keeps its dependable procedural joint rig, while the visible pieces
# come from this Blender-authored kit. Each exported mesh has its origin at the
# joint that owns it (or its own true centre for headwear), transforms applied,
# simple UVs, and a named material slot. One unit is one game yard: assembled by
# characterAsset.js, the figure is 2.00 units / about 1.83 m tall at scale 1;
# the game's 0.87-0.99 customer variation spans believable adult heights.
#
# No external source asset is used. This script is the editable source of truth.

import bpy
import bmesh
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib_model import bevel  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = os.path.join(ROOT, 'vendor', 'models', 'clubhouse', 'character_parts.glb')


def wipe():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for blocks in (bpy.data.meshes, bpy.data.materials, bpy.data.objects):
        for block in list(blocks):
            if block.users == 0:
                blocks.remove(block)


def mat(name, color, rough=0.82):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1.0)
    shader.inputs['Roughness'].default_value = rough
    return material


def assign(obj, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)
    return obj


def ell(z, rx, ry, n=12, front=0.0):
    """An XY ring at Blender height Z. +Y becomes character-forward (-Z in Three)."""
    return [
        (rx * math.cos(2 * math.pi * i / n),
         front + ry * math.sin(2 * math.pi * i / n), z)
        for i in range(n)
    ]


def loft(name, rings):
    bm = bmesh.new()
    verts = [[bm.verts.new(point) for point in ring] for ring in rings]
    n = len(verts[0])
    for a, b in zip(verts, verts[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(tuple(reversed(verts[0])))
    bm.faces.new(tuple(verts[-1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def cube(name, size, loc=(0, 0, 0), rot=(0, 0, 0), radius=0.01):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if radius:
        bevel(obj, radius, 2)
    return obj


def sphere(name, radius, loc=(0, 0, 0), scale=(1, 1, 1), segments=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=radius, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return obj


def torus(name, major, minor, loc=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor, major_segments=16,
        minor_segments=6, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return obj


def apply_modifiers(obj):
    bpy.context.view_layer.objects.active = obj
    for modifier in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def finish_part(objects, name, material):
    for obj in objects:
        apply_modifiers(obj)
        assign(obj, material)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name
    # Geometry was authored around the rig pivot at world zero. Preserve its
    # world-space shape while making that pivot the exported object origin.
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR', center='MEDIAN')
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(62), island_margin=0.025)
    bpy.ops.object.mode_set(mode='OBJECT')
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.data.set_sharp_from_angle(angle=math.radians(52))
    return obj


def build_parts(materials):
    parts = []

    # A polo has a tapered waist, a soft shoulder line, a collar, and a short
    # button placket. These details survive the counter-distance silhouette.
    torso = loft('torso_body', [
        ell(0.00, 0.195, 0.108),
        ell(0.10, 0.215, 0.125),
        ell(0.40, 0.245, 0.140),
        ell(0.50, 0.226, 0.132),
        ell(0.54, 0.175, 0.112),
    ])
    collar = torus('collar', 0.092, 0.014, loc=(0, 0.005, 0.525), scale=(1.0, 0.72, 1.0))
    placket = cube('placket', (0.030, 0.012, 0.105), loc=(0, 0.128, 0.445), radius=0.004)
    parts.append(finish_part([torso, collar, placket], 'torso', materials['polo']))

    pelvis = loft('pelvis_body', [
        ell(-0.11, 0.155, 0.105),
        ell(-0.07, 0.180, 0.118),
        ell(0.07, 0.185, 0.122),
        ell(0.11, 0.165, 0.108),
    ])
    parts.append(finish_part([pelvis], 'pelvis', materials['khaki']))

    upper = loft('upper_arm_body', [
        ell(0.025, 0.076, 0.083),
        ell(-0.05, 0.074, 0.080),
        ell(-0.24, 0.061, 0.067),
        ell(-0.32, 0.058, 0.064),
    ])
    parts.append(finish_part([upper], 'upper_arm', materials['polo']))

    forearm = loft('forearm_body', [
        ell(0.015, 0.052, 0.057),
        ell(-0.10, 0.049, 0.053),
        ell(-0.235, 0.041, 0.046),
        ell(-0.275, 0.044, 0.049),
    ])
    palm = sphere('palm', 0.048, loc=(0, 0.004, -0.288), scale=(0.86, 0.70, 1.04), segments=12, rings=8)
    thumb = sphere('thumb', 0.024, loc=(0.041, 0.006, -0.280), scale=(0.72, 0.70, 1.28), segments=10, rings=6)
    fingers = []
    for index, x in enumerate((-0.027, -0.009, 0.009, 0.027)):
        finger = sphere('finger_%d' % index, 0.025,
                        loc=(x, 0.003, -0.326 + abs(x) * 0.08),
                        scale=(0.38, 0.56, 1.05), segments=8, rings=6)
        fingers.append(finger)
    parts.append(finish_part([forearm, palm, thumb, *fingers], 'forearm_hand', materials['skin']))

    thigh = loft('thigh_body', [
        ell(0.018, 0.083, 0.095),
        ell(-0.12, 0.079, 0.090),
        ell(-0.36, 0.066, 0.075),
        ell(-0.46, 0.061, 0.069),
    ])
    parts.append(finish_part([thigh], 'thigh', materials['khaki']))

    calf = loft('calf_body', [
        ell(0.012, 0.059, 0.067),
        ell(-0.11, 0.065, 0.072),
        ell(-0.31, 0.050, 0.058),
        ell(-0.405, 0.046, 0.052),
    ])
    parts.append(finish_part([calf], 'calf', materials['khaki']))

    # Low, rounded walking shoe with the weight over its heel and a readable toe.
    heel = cube('shoe_heel', (0.132, 0.145, 0.075), loc=(0, -0.025, 0.005), radius=0.024)
    toe = sphere('shoe_toe', 0.085, loc=(0, 0.090, 0.003), scale=(0.88, 1.34, 0.53), segments=12, rings=7)
    sole = cube('shoe_sole', (0.146, 0.265, 0.025), loc=(0, 0.035, -0.034), radius=0.009)
    parts.append(finish_part([heel, toe, sole], 'shoe', materials['shoe']))

    head = sphere('skull', 0.162, loc=(0, 0, 0.043), scale=(0.90, 0.86, 1.05), segments=14, rings=9)
    jaw = sphere('jaw', 0.101, loc=(0, 0.018, -0.055), scale=(0.90, 0.86, 0.78), segments=12, rings=8)
    nose = sphere('nose', 0.025, loc=(0, 0.137, 0.035), scale=(0.68, 1.05, 0.78), segments=8, rings=6)
    ear_l = sphere('ear_l', 0.030, loc=(0.146, 0, 0.043), scale=(0.52, 0.70, 1.0), segments=8, rings=6)
    ear_r = sphere('ear_r', 0.030, loc=(-0.146, 0, 0.043), scale=(0.52, 0.70, 1.0), segments=8, rings=6)
    neck = loft('neck', [ell(-0.205, 0.060, 0.055, n=12), ell(-0.105, 0.068, 0.063, n=12)])
    parts.append(finish_part([head, jaw, nose, ear_l, ear_r, neck], 'head', materials['skin']))

    eye_l = sphere('eye_l', 0.012, loc=(0.055, 0.136, 0.070), scale=(1.0, 0.45, 0.72), segments=10, rings=6)
    eye_r = sphere('eye_r', 0.012, loc=(-0.055, 0.136, 0.070), scale=(1.0, 0.45, 0.72), segments=10, rings=6)
    brow_l = cube('brow_l', (0.046, 0.008, 0.008), loc=(0.055, 0.141, 0.103), rot=(0, 0.08, -0.07), radius=0.003)
    brow_r = cube('brow_r', (0.046, 0.008, 0.008), loc=(-0.055, 0.141, 0.103), rot=(0, -0.08, 0.07), radius=0.003)
    mouth = cube('mouth', (0.052, 0.008, 0.008), loc=(0, 0.137, -0.020), radius=0.004)
    parts.append(finish_part([eye_l, eye_r, brow_l, brow_r, mouth], 'face_details', materials['detail']))

    # A baseball crown rises from a fitted band; a flattened complete sphere read
    # as a mushroom/beret from the register camera. The brim projects only forward.
    crown = loft('cap_crown', [
        ell(0.115, 0.150, 0.135, n=16, front=-0.004),
        ell(0.160, 0.158, 0.140, n=16, front=-0.004),
        ell(0.218, 0.130, 0.118, n=16, front=-0.004),
        ell(0.248, 0.090, 0.083, n=16, front=-0.004),
    ])
    brim = cube('cap_brim', (0.185, 0.175, 0.020), loc=(0, 0.118, 0.130), radius=0.022)
    band = torus('cap_band', 0.145, 0.008, loc=(0, -0.004, 0.124), scale=(1.0, 0.91, 1.0))
    parts.append(finish_part([crown, brim, band], 'cap', materials['cap']))

    hair = sphere('hair_shell', 0.174, loc=(0, -0.014, 0.145), scale=(1.01, 0.96, 0.66), segments=12, rings=8)
    hair_back = cube('hair_back', (0.230, 0.050, 0.105), loc=(0, -0.137, 0.075), radius=0.025)
    parts.append(finish_part([hair, hair_back], 'hair', materials['hair']))

    # The live game uses the same simple circular navigation/collision radius it
    # already used for the procedural figure. This proxy documents the authored
    # envelope and can be inspected independently; the loader intentionally skips it.
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.25, depth=1.82, location=(0, 0, 0.91))
    proxy = bpy.context.object
    proxy.name = 'COL_customer_capsule'
    assign(proxy, materials['collision'])
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    parts.append(proxy)

    return parts


def export(parts):
    bpy.ops.object.select_all(action='DESELECT')
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials='EXPORT',
    )
    print('character parts ->', OUT)


wipe()
MATERIALS = {
    'polo': mat('M_polo', (0.13, 0.31, 0.20), 0.90),
    'khaki': mat('M_khaki', (0.55, 0.50, 0.37), 0.92),
    'skin': mat('M_skin', (0.65, 0.39, 0.24), 0.78),
    'cap': mat('M_cap', (0.80, 0.78, 0.68), 0.88),
    'hair': mat('M_hair', (0.10, 0.065, 0.035), 0.95),
    'shoe': mat('M_shoe', (0.08, 0.065, 0.05), 0.90),
    'detail': mat('M_detail', (0.035, 0.028, 0.022), 0.86),
    'collision': mat('M_collision', (0.8, 0.05, 0.05), 1.0),
}
export(build_parts(MATERIALS))
