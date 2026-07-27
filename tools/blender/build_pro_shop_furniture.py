"""Build the complete Pinehollow pro-shop furniture library in Blender.

The script creates 23 categories x 5 genuinely different construction tiers,
exports one runtime GLB per piece, renders a preview, writes a manifest, and
saves one editable .blend source library per category. No external asset or
texture is used.

Chunked Blender MCP usage:
    import os, runpy
    os.environ['GF_REPO_ROOT'] = r'C:\\path\\to\\Golf-Flipper'
    os.environ['GF_FURNITURE_START'] = '0'
    os.environ['GF_FURNITURE_END'] = '5'
    runpy.run_path(r'C:\\path\\tools\\blender\\build_pro_shop_furniture.py', run_name='__main__')
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

import bpy
from mathutils import Vector


REPO = Path(os.environ.get('GF_REPO_ROOT', Path(__file__).resolve().parents[2])).resolve()
ASSET_ROOT = REPO / 'Assets' / 'pro_shop_furniture'
SOURCE_ROOT = ASSET_ROOT / 'source'
PREVIEW_ROOT = ASSET_ROOT / 'previews'
RUNTIME_ROOT = REPO / 'vendor' / 'models' / 'pro_shop_furniture'

TIERS = [
    ('basic', 'Basic', (0.86, 0.94, 0.88), 1),
    ('standard', 'Standard', (1.00, 1.00, 1.00), 2),
    ('premium', 'Premium', (1.14, 1.035, 1.10), 3),
    ('luxury', 'Luxury', (1.28, 1.07, 1.20), 4),
    ('executive', 'Executive', (1.44, 1.10, 1.30), 5),
]

# slug, label, nominal Standard-tier dimensions (metres), wall mounted
CATEGORIES = [
    ('checkout-counters', 'Checkout Counter', (2.40, 1.00, 0.82), False),
    ('office-desks', 'Office Desk', (1.65, 0.78, 0.78), False),
    ('tables', 'Merchandising Table', (1.65, 0.94, 0.92), False),
    ('coffee-tables', 'Coffee Table', (1.15, 0.47, 0.68), False),
    ('benches', 'Clubhouse Bench', (1.65, 0.92, 0.62), False),
    ('office-cabinets', 'Office Cabinet', (1.15, 1.95, 0.48), False),
    ('wall-cabinets', 'Wall Cabinet', (1.25, 0.92, 0.34), True),
    ('storage-cabinets', 'Storage Cabinet', (1.25, 2.05, 0.58), False),
    ('golf-bag-displays', 'Golf Bag Display', (1.45, 1.48, 0.78), False),
    ('hat-displays', 'Hat Display', (1.20, 1.88, 0.58), False),
    ('shirt-displays', 'Shirt Display', (1.55, 2.02, 0.62), False),
    ('glass-showcases', 'Glass Showcase', (1.48, 1.92, 0.56), False),
    ('jewelry-cases', 'Jewelry Case', (1.35, 1.02, 0.62), False),
    ('display-islands', 'Display Island', (1.75, 1.32, 1.18), False),
    ('freestanding-shelving', 'Freestanding Shelving', (1.55, 2.02, 0.58), False),
    ('wall-shelving', 'Wall Shelving', (1.55, 1.72, 0.34), True),
    ('pegboard-walls', 'Pegboard Wall', (1.48, 1.78, 0.16), True),
    ('checkout-islands', 'Checkout Island', (2.05, 1.00, 1.12), False),
    ('waiting-area-furniture', 'Waiting Area Suite', (2.35, 0.98, 1.05), False),
    ('locker-units', 'Locker Unit', (1.42, 2.08, 0.52), False),
    ('fitting-rooms', 'Fitting Room', (1.45, 2.30, 1.45), False),
    ('mirrors', 'Clubhouse Mirror', (1.08, 1.82, 0.10), True),
    ('reception-desks', 'Reception Desk', (2.55, 1.12, 0.92), False),
]

ROOT = None
M = {}
LEVEL = 1


def clean_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def material(name, color, roughness=0.58, metallic=0.0, alpha=1.0, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, alpha)
    node = mat.node_tree.nodes.get('Principled BSDF')
    if node:
        if node.inputs.get('Base Color'):
            node.inputs['Base Color'].default_value = (*color, 1)
        if node.inputs.get('Roughness'):
            node.inputs['Roughness'].default_value = roughness
        if node.inputs.get('Metallic'):
            node.inputs['Metallic'].default_value = metallic
        transmission = node.inputs.get('Transmission Weight') or node.inputs.get('Transmission')
        if transmission and alpha < 0.7:
            transmission.default_value = 0.72
        if node.inputs.get('Alpha'):
            node.inputs['Alpha'].default_value = alpha
        if emission:
            emission_input = node.inputs.get('Emission Color') or node.inputs.get('Emission')
            strength_input = node.inputs.get('Emission Strength')
            if emission_input:
                emission_input.default_value = (*emission, 1)
            if strength_input:
                strength_input.default_value = 2.2
    if alpha < 1:
        mat.surface_render_method = 'DITHERED' if hasattr(mat, 'surface_render_method') else 'BLENDED'
    return mat


def palette(tier_id, level):
    prefix = f'PF_{tier_id.title()}'
    colors = {
        1: {
            'body': (0.34, 0.36, 0.34), 'wood': (0.62, 0.53, 0.39),
            'dark': (0.105, 0.115, 0.11), 'cream': (0.72, 0.70, 0.64),
            'green': (0.10, 0.22, 0.16), 'sage': (0.39, 0.45, 0.38),
        },
        2: {
            'body': (0.54, 0.43, 0.29), 'wood': (0.58, 0.40, 0.22),
            'dark': (0.13, 0.14, 0.13), 'cream': (0.78, 0.73, 0.62),
            'green': (0.075, 0.24, 0.14), 'sage': (0.42, 0.50, 0.40),
        },
        3: {
            'body': (0.28, 0.37, 0.28), 'wood': (0.55, 0.32, 0.15),
            'dark': (0.25, 0.13, 0.065), 'cream': (0.82, 0.76, 0.63),
            'green': (0.045, 0.20, 0.105), 'sage': (0.43, 0.54, 0.42),
        },
        4: {
            'body': (0.30, 0.155, 0.075), 'wood': (0.42, 0.22, 0.09),
            'dark': (0.18, 0.075, 0.035), 'cream': (0.86, 0.80, 0.67),
            'green': (0.035, 0.16, 0.08), 'sage': (0.39, 0.48, 0.36),
        },
        5: {
            'body': (0.15, 0.065, 0.03), 'wood': (0.34, 0.15, 0.055),
            'dark': (0.095, 0.035, 0.018), 'cream': (0.89, 0.82, 0.66),
            'green': (0.022, 0.115, 0.055), 'sage': (0.34, 0.43, 0.31),
        },
    }[level]
    return {
        'body': material(prefix + '_Body', colors['body'], 0.66 if level < 3 else 0.52),
        'wood': material(prefix + '_Oak', colors['wood'], 0.58 if level < 3 else 0.44),
        'dark': material(prefix + '_Walnut', colors['dark'], 0.42),
        'cream': material(prefix + '_Cream', colors['cream'], 0.62),
        'green': material(prefix + '_GolfGreen', colors['green'], 0.50),
        'sage': material(prefix + '_Sage', colors['sage'], 0.62),
        'metal': material(prefix + '_CharcoalSteel', (0.10, 0.105, 0.10), 0.32, 0.72),
        'brass': material(prefix + '_RestrainedBrass', (0.52, 0.35, 0.10), 0.28, 0.78),
        'glass': material(prefix + '_Glass', (0.30, 0.52, 0.45), 0.08, 0.04, 0.14),
        'fabric': material(prefix + '_LeatherFabric', (0.08, 0.25, 0.14), 0.72),
        'mirror': material(prefix + '_Mirror', (0.72, 0.82, 0.80), 0.08, 0.92),
        'light': material(prefix + '_WarmLED', (1.0, 0.74, 0.36), 0.26, 0, 1, (1.0, 0.46, 0.12)),
        'black': material(prefix + '_Recess', (0.025, 0.03, 0.025), 0.84),
    }


def parented(obj, parent=None):
    obj.parent = parent or ROOT
    return obj


def cube(name, size, loc, mat=None, bevel=None, parent=None, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        obj.data.materials.append(mat)
    radius = min(size) * 0.12 if bevel is None else bevel
    if radius > 0.001:
        mod = obj.modifiers.new('Soft commercial edges', 'BEVEL')
        mod.width = min(radius, min(size) * 0.22)
        mod.segments = 1 if LEVEL < 3 else 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return parented(obj, parent)


def cylinder(name, radius, depth, loc, mat=None, rotation=(0, 0, 0), vertices=None, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices or (12 + LEVEL * 2), radius=radius, depth=depth,
        location=loc, rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    if mat:
        obj.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return parented(obj, parent)


def sphere(name, radius, loc, mat=None, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12 + LEVEL * 2, ring_count=8, radius=radius, location=loc)
    obj = bpy.context.object
    obj.name = name
    if mat:
        obj.data.materials.append(mat)
    return parented(obj, parent)


def empty(name, loc=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = 'PLAIN_AXES'
    obj.empty_display_size = 0.10
    obj.location = loc
    bpy.context.collection.objects.link(obj)
    return parented(obj, parent)


def door_panel(name, width, height, depth, hinge, mat, opens_right=True):
    pivot = empty('PIVOT_' + name, hinge)
    direction = 1 if opens_right else -1
    return cube(name, (width, height, depth), (direction * width / 2, 0, 0), mat, 0.012, pivot)


def horizontal_rod(name, length, loc, mat, radius=0.018):
    return cylinder(name, radius, length, loc, mat, (0, math.pi / 2, 0))


def vertical_rod(name, height, loc, mat, radius=0.022):
    return cylinder(name, radius, height, loc, mat, (math.pi / 2, 0, 0))


def depth_rod(name, length, loc, mat, radius=0.018):
    return cylinder(name, radius, length, loc, mat)


def trim_frame(prefix, w, h, z, mat, y0=0.12, inset=0.07):
    cube(prefix + '_TrimTop', (w - inset * 2, 0.035, 0.025), (0, y0 + h - inset, z), mat, 0.006)
    cube(prefix + '_TrimBottom', (w - inset * 2, 0.035, 0.025), (0, y0 + inset, z), mat, 0.006)
    cube(prefix + '_TrimLeft', (0.035, h - inset * 2, 0.025), (-w / 2 + inset, y0 + h / 2, z), mat, 0.006)
    cube(prefix + '_TrimRight', (0.035, h - inset * 2, 0.025), (w / 2 - inset, y0 + h / 2, z), mat, 0.006)


def panel_frame(prefix, w, h, z, x=0, y=0.12, mat=None, rail=0.035):
    finish = mat or M['dark']
    cube(prefix + '_Top', (w, rail, 0.028), (x, y + h / 2, z), finish, 0.006)
    cube(prefix + '_Bottom', (w, rail, 0.028), (x, y - h / 2, z), finish, 0.006)
    cube(prefix + '_Left', (rail, h, 0.028), (x - w / 2, y, z), finish, 0.006)
    cube(prefix + '_Right', (rail, h, 0.028), (x + w / 2, y, z), finish, 0.006)


def prestige_details(prefix, w, h, d):
    if LEVEL >= 3:
        cube(prefix + '_Plinth', (w * 0.96, 0.075, d * 0.94), (0, 0.038, 0), M['dark'], 0.012)
    if LEVEL >= 4:
        cube(prefix + '_BrassToeKick', (w * 0.84, 0.025, 0.018), (0, 0.09, -d / 2 - 0.012), M['brass'], 0.004)
    if LEVEL >= 5:
        cube(prefix + '_SteppedPlinth', (w, 0.045, d), (0, 0.022, 0), M['wood'], 0.012)


def build_checkout(w, h, d):
    top_mat = M['cream'] if LEVEL == 1 else M['wood'] if LEVEL < 4 else M['dark']
    cube('Counter_Worktop', (w, 0.10 + LEVEL * 0.008, d), (0, h - 0.055, 0), top_mat, 0.035)
    front_h = h * (0.48 if LEVEL == 1 else 0.72)
    cube('Counter_Front', (w * (0.78 if LEVEL == 1 else 0.96), front_h, 0.10), (0, h * 0.40, -d / 2 + 0.05), M['body'], 0.025)
    cube('Counter_StaffShelf', (w * 0.78, 0.055, d * 0.56), (0, h * 0.54, d * 0.12), M['cream'], 0.016)
    for x in (-w * 0.43, w * 0.43):
        end_size = (0.07, h * 0.82, 0.07) if LEVEL == 1 else (0.10, h * 0.80, d * 0.86)
        cube('Counter_End', end_size, (x, h * 0.42, 0), M['metal'] if LEVEL == 1 else M['body'], 0.02)
    for i in range(LEVEL):
        x = (-0.32 + i * 0.64 / max(1, LEVEL - 1)) * w
        cube(f'Counter_Drawer_{i+1}', (w * 0.20, 0.12, 0.045), (x, h * 0.66, d * 0.47), M['wood'], 0.012)
        horizontal_rod(f'Counter_Handle_{i+1}', w * 0.10, (x, h * 0.66, d * 0.50), M['metal'], 0.012)
    if LEVEL >= 2:
        panel_count = min(4, LEVEL - 1)
        panel_w = w * 0.78 / panel_count
        for index in range(panel_count):
            x = -w * 0.39 + panel_w * (index + 0.5)
            panel_frame(f'Counter_Panel_{index+1}', panel_w * 0.88, h * 0.48, -d / 2 - 0.012, x, h * 0.42, M['dark'])
    if LEVEL >= 4:
        cube('Counter_IntegratedLight', (w * 0.72, 0.014, 0.012), (0, h * 0.70, -d / 2 - 0.025), M['light'], 0.002)
    if LEVEL >= 5:
        cube('Counter_CustomerLedge', (w * 0.46, 0.07, d * 0.22), (w * 0.18, h * 0.76, -d * 0.48), M['green'], 0.02)
        for index in range(6):
            x = -w * 0.34 + index * w * 0.136
            cube(f'Counter_Flute_{index+1}', (0.026, h * 0.38, 0.024), (x, h * 0.42, -d / 2 - 0.035), M['wood'], 0.006)
    prestige_details('Counter', w, h, d)


def build_office_desk(w, h, d):
    cube('Desk_Top', (w, 0.075 + LEVEL * 0.008, d), (0, h - 0.05, 0), M['wood'], 0.03)
    if LEVEL == 1:
        for x in (-w * 0.42, w * 0.42):
            for z in (-d * 0.36, d * 0.36):
                cube('Desk_SteelLeg', (0.055, h * 0.88, 0.055), (x, h * 0.44, z), M['metal'], 0.009)
        cube('Desk_UtilityDrawer', (w * 0.34, 0.14, d * 0.62), (-w * 0.20, h * 0.68, 0), M['body'], 0.012)
        return
    pedestal_w = w * (0.18 + LEVEL * 0.015)
    for side in (-1, 1):
        x = side * (w / 2 - pedestal_w / 2 - 0.04)
        cube('Desk_Pedestal', (pedestal_w, h * 0.78, d * 0.78), (x, h * 0.39, d * 0.03), M['body'], 0.022)
        for row in range(1 + LEVEL // 2):
            y = h * (0.24 + row * 0.20)
            cube(f'Desk_Drawer_{side}_{row}', (pedestal_w * 0.82, 0.13, 0.035), (x, y, -d * 0.385), M['wood'], 0.01)
            horizontal_rod(f'Desk_Pull_{side}_{row}', pedestal_w * 0.42, (x, y, -d * 0.415), M['metal'], 0.009)
    cube('Desk_Modesty', (w * 0.64, h * 0.52, 0.045), (0, h * 0.35, d * 0.35), M['green' if LEVEL >= 3 else 'body'], 0.014)
    if LEVEL >= 4:
        cube('Desk_RaisedGallery', (w * 0.48, 0.10, d * 0.22), (0, h + 0.04, d * 0.26), M['dark'], 0.022)
        cube('Desk_LeatherWritingPad', (w * 0.46, 0.012, d * 0.46), (0, h + 0.012, -d * 0.08), M['green'], 0.008)
    if LEVEL >= 5:
        cube('Desk_ExecutiveReturn', (w * 0.42, 0.075, d * 0.72), (w * 0.27, h * 0.73, d * 0.36), M['dark'], 0.025)
        panel_frame('Desk_ExecutiveFront', w * 0.52, h * 0.42, -d * 0.42, 0, h * 0.38, M['wood'])
    prestige_details('Desk', w, h, d)


def build_table(w, h, d, coffee=False):
    top_t = 0.055 + LEVEL * 0.01
    cube('Table_Top', (w, top_t, d), (0, h - top_t / 2, 0), M['cream'] if LEVEL == 1 else M['wood'] if LEVEL < 4 else M['dark'], 0.035)
    leg = 0.055 + LEVEL * 0.012
    if LEVEL <= 2:
        for x in (-w * 0.41, w * 0.41):
            for z in (-d * 0.36, d * 0.36):
                cube('Table_Leg', (leg, h - top_t, leg), (x, (h - top_t) / 2, z), M['metal'] if LEVEL == 1 else M['wood'], 0.012)
    else:
        for x in (-w * 0.31, w * 0.31):
            cube('Table_Trestle', (w * 0.12, h * 0.66, d * 0.62), (x, h * 0.37, 0), M['body'], 0.025)
            cube('Table_TrestleFoot', (w * 0.25, 0.07, d * 0.82), (x, 0.06, 0), M['dark'], 0.018)
            if LEVEL >= 4:
                panel_frame('Table_Pedestal', w * 0.085, h * 0.42, -d * 0.325, x, h * 0.38, M['brass'], 0.018)
        cube('Table_CenterStretcher', (w * 0.62, 0.075, 0.075), (0, h * 0.34, 0), M['dark'], 0.012)
        for z in (-d * 0.43, d * 0.43):
            cube('Table_Apron', (w * 0.82, h * 0.11, 0.045), (0, h * 0.79, z), M['wood'], 0.012)
    if LEVEL == 2:
        cube('Table_LowerShelf', (w * 0.78, 0.045, d * 0.68), (0, h * (0.28 if coffee else 0.34), 0), M['body'], 0.015)
    if LEVEL >= 4:
        for x in (-w * 0.23, w * 0.23):
            cube('Table_Inlay', (0.018, 0.008, d * 0.82), (x, h + 0.006, 0), M['brass'], 0.002)
    if LEVEL >= 5:
        vertical_rod('Table_CenterMedallion', 0.012, (0, h + 0.008, 0), M['green'], min(w, d) * 0.12)
        for edge in (-1, 1):
            cube('Table_BreadboardEnd', (w * 0.10, top_t + 0.025, d * 1.02), (edge * w * 0.45, h - top_t / 2, 0), M['wood'], 0.025)


def build_bench(w, h, d):
    seat_y = h * 0.46
    cube('Bench_Seat', (w * 0.90, 0.12, d * 0.70), (0, seat_y, 0.05), M['wood'], 0.035)
    for x in (-w * 0.38, w * 0.38):
        cube('Bench_Leg', (0.10, seat_y, d * 0.52), (x, seat_y / 2, 0.05), M['dark' if LEVEL >= 3 else 'metal'], 0.018)
        if LEVEL >= 3:
            cube('Bench_Arm', (0.075, 0.075, d * 0.74), (x, seat_y + 0.24, 0), M['wood'], 0.018)
    if LEVEL >= 2:
        cube('Bench_Back', (w * 0.90, h * 0.38, 0.10), (0, h * 0.76, d * 0.26), M['fabric'] if LEVEL >= 4 else M['wood'], 0.025, rotation=(math.radians(-6), 0, 0))
    if LEVEL >= 3:
        cube('Bench_Cushion', (w * 0.82, 0.09, d * 0.58), (0, seat_y + 0.09, 0), M['fabric'], 0.04)
    if LEVEL >= 4:
        for index in range(3 + LEVEL):
            x = -w * 0.32 + index * w * 0.64 / (2 + LEVEL)
            sphere(f'Bench_Tuft_{index+1}', 0.025, (x, h * 0.78, d * 0.20), M['brass'] if LEVEL == 5 else M['dark'])
    if LEVEL >= 5:
        for x in (-w * 0.45, w * 0.45):
            cube('Bench_Wing', (0.09, h * 0.46, d * 0.28), (x, h * 0.73, d * 0.12), M['dark'], 0.025)
    prestige_details('Bench', w, h, d)


def cabinet(w, h, d, wall=False, storage=False):
    back_z = d * 0.48
    cube('Cabinet_Back', (w, h, 0.055), (0, h / 2, back_z), M['body'], 0.014)
    cube('Cabinet_Top', (w, 0.07, d), (0, h - 0.035, 0), M['wood'], 0.02)
    cube('Cabinet_Bottom', (w, 0.07, d), (0, 0.035, 0), M['dark'], 0.014)
    for x in (-w / 2 + 0.035, w / 2 - 0.035):
        cube('Cabinet_Side', (0.07, h, d), (x, h / 2, 0), M['body'], 0.015)
    shelves = 1 + LEVEL // 2
    for i in range(shelves):
        y = h * (i + 1) / (shelves + 1)
        cube(f'Cabinet_Shelf_{i+1}', (w * 0.88, 0.035, d * 0.88), (0, y, 0), M['wood'], 0.008)
    panel_w = w * 0.43
    for side in (-1, 1):
        hinge_x = side * (w / 2 - 0.07)
        pivot = empty(f'PIVOT_CabinetDoor_{side}', (hinge_x, h * 0.52, -d / 2 - 0.02))
        mat = M['metal'] if LEVEL == 1 else M['glass'] if LEVEL >= 4 and not storage else M['wood']
        cube(f'Cabinet_Door_{side}', (panel_w, h * 0.78, 0.035), (-side * panel_w / 2, 0, 0), mat, 0.012, pivot)
        vertical_rod(f'Cabinet_Handle_{side}', h * 0.16, (-side * panel_w * 0.42, 0, -0.035), M['brass' if LEVEL >= 4 else 'metal'], 0.012).parent = pivot
        if LEVEL >= 2 and (LEVEL < 4 or storage):
            for y in (-h * 0.22, h * 0.22):
                cube(f'Cabinet_DoorRail_{side}', (panel_w * 0.78, 0.025, 0.018), (-side * panel_w / 2, y, -0.028), M['dark'], 0.004, pivot)
    if LEVEL >= 3:
        trim_frame('Cabinet', w * 0.84, h * 0.70, -d / 2 - 0.045, M['dark'], h * 0.13)
    if LEVEL >= 4:
        for index in range(shelves):
            y = h * (index + 1) / (shelves + 1) - 0.03
            cube(f'Cabinet_LED_{index+1}', (w * 0.70, 0.012, 0.012), (0, y, -d * 0.46), M['light'], 0.002)
    if LEVEL >= 5:
        cube('Cabinet_Cornice', (w * 1.04, 0.11, d * 1.06), (0, h - 0.055, 0), M['dark'], 0.025)
        for x in (-w * 0.45, w * 0.45):
            cube('Cabinet_FlutedPilaster', (0.075, h * 0.76, 0.065), (x, h * 0.48, -d * 0.49), M['wood'], 0.018)
    prestige_details('Cabinet', w, h, d)


def build_bag_display(w, h, d):
    cube('BagDisplay_Base', (w, 0.13, d), (0, 0.065, 0), M['dark'], 0.035)
    cube('BagDisplay_Back', (w * 0.90, h * 0.76, 0.09), (0, h * 0.52, d * 0.40), M['body'], 0.025)
    slots = 2 + LEVEL
    for i in range(slots):
        x = -w * 0.38 + i * (w * 0.76 / max(1, slots - 1))
        vertical_rod(f'BagCup_{i+1}', 0.09, (x, 0.18, 0), M['green'], d * 0.10)
        vertical_rod(f'BagDivider_{i+1}', h * 0.66, (x, h * 0.45, -d * 0.30), M['metal'], 0.018)
        depth_rod(f'BagLoop_{i+1}', d * 0.52, (x, h * 0.68, -d * 0.20), M['brass' if LEVEL >= 4 else 'metal'], 0.018)
    if LEVEL >= 3:
        cube('BagDisplay_Header', (w * 0.82, 0.20, 0.10), (0, h * 0.90, d * 0.36), M['green'], 0.03)
    if LEVEL >= 5:
        for x in (-w * 0.46, w * 0.46):
            cube('BagDisplay_EndTower', (w * 0.09, h * 0.78, d * 0.76), (x, h * 0.45, d * 0.05), M['dark'], 0.025)
            cube('BagDisplay_EndCap', (w * 0.13, 0.10, d * 0.86), (x, h * 0.88, d * 0.05), M['wood'], 0.022)
        cube('BagDisplay_CountryClubSign', (w * 0.56, h * 0.13, 0.055), (0, h * 0.96, d * 0.36), M['cream'], 0.025)
        panel_frame('BagDisplay_SignFrame', w * 0.52, h * 0.10, d * 0.385, 0, h * 0.96, M['brass'], 0.018)
    prestige_details('BagDisplay', w, h, d)


def build_hat_display(w, h, d):
    cube('HatDisplay_Base', (w * 0.82, 0.11, d * 0.82), (0, 0.055, 0), M['dark'], 0.035)
    cube('HatDisplay_Spine', (w * 0.22, h * 0.88, d * 0.20), (0, h * 0.48, 0), M['body'], 0.028)
    rows = 2 + LEVEL
    for row in range(rows):
        y = h * (0.24 + row * 0.60 / max(1, rows - 1))
        for side in (-1, 1):
            x = side * w * (0.25 + (0.07 if LEVEL >= 4 else 0))
            horizontal_rod(f'HatPeg_{row}_{side}', w * 0.28, (x, y, -d * 0.05), M['brass' if LEVEL >= 4 else 'metal'], 0.018)
            sphere(f'HatStop_{row}_{side}', 0.026, (side * w * 0.40, y, -d * 0.05), M['brass'])
    if LEVEL >= 3:
        cube('HatDisplay_Canopy', (w, 0.09, d * 0.72), (0, h * 0.94, 0), M['wood'], 0.028)
    if LEVEL >= 4:
        cube('HatDisplay_MirrorPanel', (w * 0.34, h * 0.66, 0.018), (0, h * 0.50, d * 0.14), M['mirror'], 0.012)
        cube('HatDisplay_Light', (w * 0.62, 0.014, 0.012), (0, h * 0.88, -d * 0.14), M['light'], 0.002)
    if LEVEL >= 5:
        cube('HatDisplay_BaseCabinet', (w * 0.72, h * 0.14, d * 0.72), (0, h * 0.09, 0), M['dark'], 0.025)
        for side in (-1, 1):
            cube('HatDisplay_ExecutiveWing', (w * 0.10, h * 0.78, d * 0.12), (side * w * 0.43, h * 0.48, 0), M['wood'], 0.018)
    prestige_details('HatDisplay', w, h, d)


def build_shirt_display(w, h, d):
    cube('ShirtDisplay_Back', (w, h * 0.86, 0.08), (0, h * 0.48, d * 0.40), M['body'], 0.022)
    cube('ShirtDisplay_Base', (w, 0.10, d), (0, 0.05, 0), M['dark'], 0.028)
    horizontal_rod('Shirt_Rail', w * 0.76, (0, h * 0.66, d * 0.12), M['metal'], 0.026)
    shelves = 1 + LEVEL // 2
    for i in range(shelves):
        y = h * (0.22 + i * 0.18)
        cube(f'Shirt_FoldShelf_{i+1}', (w * 0.72, 0.045, d * 0.58), (0, y, d * 0.03), M['wood'], 0.012)
    if LEVEL >= 3:
        for x in (-w * 0.34, w * 0.34):
            vertical_rod('Shirt_DisplayPost', h * 0.72, (x, h * 0.43, d * 0.25), M['dark'], 0.025)
    if LEVEL >= 4:
        cube('ShirtDisplay_IntegratedLight', (w * 0.68, 0.014, 0.012), (0, h * 0.82, -d * 0.04), M['light'], 0.002)
        cube('ShirtDisplay_Canopy', (w * 0.92, 0.10, d * 0.72), (0, h * 0.91, d * 0.05), M['dark'], 0.025)
    if LEVEL >= 5:
        for x in (-w * 0.44, w * 0.44):
            cube('ShirtDisplay_SideTower', (w * 0.10, h * 0.82, d * 0.82), (x, h * 0.46, d * 0.04), M['body'], 0.025)
            panel_frame('ShirtDisplay_TowerPanel', w * 0.07, h * 0.56, -d * 0.40, x, h * 0.48, M['brass'], 0.016)
        cube('ShirtDisplay_Cornice', (w * 1.04, 0.12, d * 0.90), (0, h - 0.06, d * 0.03), M['wood'], 0.028)
    prestige_details('ShirtDisplay', w, h, d)


def build_showcase(w, h, d, jewelry=False):
    base_h = h * (0.56 if jewelry else 0.24)
    cube('Showcase_Plinth', (w, base_h, d), (0, base_h / 2, 0), M['metal'] if LEVEL == 1 else M['body'] if LEVEL == 2 else M['dark'], 0.025)
    case_h = h - base_h - 0.08
    y = base_h + case_h / 2
    cube('Showcase_GlassFront', (w * 0.88, case_h, 0.025), (0, y, -d / 2), M['glass'], 0.006)
    cube('Showcase_GlassBack', (w * 0.88, case_h, 0.025), (0, y, d / 2), M['glass'], 0.006)
    if LEVEL >= 2:
        for x in (-w * 0.46, w * 0.46):
            cube('Showcase_GlassSide', (0.025, case_h, d * 0.90), (x, y, 0), M['glass'], 0.005)
    for x in (-w * 0.46, w * 0.46):
        cube('Showcase_Post', (0.055, case_h, 0.055), (x, y, 0), M['brass' if LEVEL >= 4 else 'metal'], 0.008)
    shelves = LEVEL
    for i in range(shelves):
        sy = base_h + case_h * (i + 1) / (shelves + 1)
        cube(f'Showcase_GlassShelf_{i+1}', (w * 0.84, 0.018, d * 0.78), (0, sy, 0), M['glass'], 0.003)
    cube('Showcase_Cap', (w, 0.08, d), (0, h - 0.04, 0), M['wood'], 0.025)
    if LEVEL >= 4:
        cube('Showcase_LED', (w * 0.78, 0.014, 0.014), (0, h - 0.10, -d * 0.42), M['light'], 0.002)
    if LEVEL >= 3 and jewelry:
        for index in range(LEVEL - 2):
            x = (-0.24 + index * 0.48 / max(1, LEVEL - 3)) * w
            cube(f'Jewelry_Drawer_{index+1}', (w * 0.24, base_h * 0.18, 0.035), (x, base_h * 0.58, -d / 2 - 0.018), M['wood'], 0.008)
            horizontal_rod(f'Jewelry_Pull_{index+1}', w * 0.10, (x, base_h * 0.58, -d / 2 - 0.04), M['brass'], 0.008)
    if LEVEL >= 5:
        cube('Showcase_LockingRail', (w * 0.82, 0.045, 0.035), (0, base_h + case_h * 0.48, -d / 2 - 0.028), M['brass'], 0.006)
        cube('Showcase_Cornice', (w * 1.04, 0.105, d * 1.04), (0, h - 0.052, 0), M['dark'], 0.025)
        for x in (-w * 0.30, w * 0.30):
            cube('Showcase_BaseDoor', (w * 0.25, base_h * 0.48, 0.035), (x, base_h * 0.44, -d / 2 - 0.018), M['body'], 0.012)
            panel_frame('Showcase_BaseDoorPanel', w * 0.20, base_h * 0.34, -d / 2 - 0.045, x, base_h * 0.44, M['wood'], 0.018)
    prestige_details('Showcase', w, h, d)


def build_island(w, h, d):
    cube('Island_Base', (w, 0.13, d), (0, 0.065, 0), M['dark'], 0.035)
    cube('Island_Core', (w * 0.42, h * 0.70, d * 0.42), (0, h * 0.38, 0), M['body'], 0.03)
    levels = 1 + LEVEL
    for i in range(levels):
        t = (i + 1) / levels
        sw = w * (0.92 - t * 0.28)
        sd = d * (0.92 - t * 0.28)
        cube(f'Island_Deck_{i+1}', (sw, 0.055, sd), (0, h * (0.18 + i * 0.58 / levels), 0), M['wood'], 0.02)
    if LEVEL >= 4:
        for x, z in ((-w * .38, -d * .38), (w * .38, -d * .38), (-w * .38, d * .38), (w * .38, d * .38)):
            vertical_rod('Island_BrassPost', h * 0.54, (x, h * 0.40, z), M['brass'], 0.018)
    if LEVEL >= 5:
        for x in (-w * 0.36, w * 0.36):
            cube('Island_BaseDrawer', (w * 0.24, h * 0.13, 0.045), (x, h * 0.13, -d * 0.46), M['body'], 0.012)
            horizontal_rod('Island_DrawerPull', w * 0.10, (x, h * 0.13, -d * 0.49), M['brass'], 0.009)
        cube('Island_SignCanopy', (w * 0.52, 0.10, d * 0.28), (0, h * 0.94, 0), M['green'], 0.025)
    prestige_details('Island', w, h, d)


def build_shelving(w, h, d, wall=False):
    if wall:
        cube('WallShelf_Back', (w, h, 0.06), (0, h / 2, d * 0.38), M['body'], 0.018)
    else:
        for x in (-w * 0.46, w * 0.46):
            for z in (-d * 0.38, d * 0.38):
                vertical_rod('Shelf_Upright', h * 0.94, (x, h * 0.50, z), M['metal' if LEVEL < 3 else 'dark'], 0.025)
        if LEVEL >= 3:
            for x in (-w * 0.48, w * 0.48):
                cube('Shelf_MillworkSide', (0.07, h * 0.92, d), (x, h * 0.49, 0), M['body'], 0.018)
    count = 2 + LEVEL
    for i in range(count):
        y = h * (0.08 + i * 0.82 / max(1, count - 1))
        cube(f'Shelf_{i+1}', (w * 0.92, 0.045, d * (0.82 if wall else 0.92)), (0, y, 0), M['wood'], 0.012)
        if LEVEL >= 4:
            cube(f'Shelf_LED_{i+1}', (w * 0.72, 0.012, 0.012), (0, y - 0.035, -d * 0.42), M['light'], 0.002)
    if LEVEL >= 3:
        cube('Shelf_Header', (w, 0.15, d * 0.82), (0, h * 0.94, 0), M['green'], 0.025)
    if LEVEL >= 5:
        cube('Shelf_Cornice', (w * 1.04, 0.10, d * 1.02), (0, h - 0.05, 0), M['dark'], 0.025)
        cube('Shelf_BaseCabinet', (w * 0.92, h * 0.16, d * 0.92), (0, h * 0.09, 0), M['body'], 0.025)
    prestige_details('Shelving', w, h, d)


def build_pegboard(w, h, d):
    cube('Pegboard_Frame', (w, h, d), (0, h / 2, 0), M['wood'], 0.025)
    cube('Pegboard_Field', (w * 0.88, h * 0.86, d * 0.24), (0, h * 0.50, -d * 0.42), M['sage'], 0.008)
    cols = 4 + LEVEL * 2
    rows = 5 + LEVEL
    for row in range(rows):
        for col in range(cols):
            x = -w * 0.37 + col * (w * 0.74 / max(1, cols - 1))
            y = h * 0.18 + row * (h * 0.64 / max(1, rows - 1))
            depth_rod(f'PegHole_{row}_{col}', 0.009, (x, y, -d * 0.57), M['black'], 0.012)
    for i in range(1 + LEVEL):
        x = -w * 0.32 + i * w * 0.64 / max(1, LEVEL)
        depth_rod(f'PegHook_{i+1}', d * 1.5, (x, h * (0.38 + 0.08 * (i % 2)), -d * 0.92), M['brass' if LEVEL >= 4 else 'metal'], 0.012)
    prestige_details('Pegboard', w, h, d)


def build_checkout_island(w, h, d):
    cube('CheckoutIsland_Base', (w, 0.12, d), (0, 0.06, 0), M['dark'], 0.035)
    cube('CheckoutIsland_Core', (w * 0.80, h * 0.72, d * 0.72), (0, h * 0.42, 0), M['body'], 0.03)
    cube('CheckoutIsland_Top', (w, 0.09, d), (0, h - 0.045, 0), M['wood' if LEVEL < 4 else 'dark'], 0.04)
    for side in (-1, 1):
        shelves = 1 + LEVEL // 2
        for i in range(shelves):
            y = h * (0.25 + i * 0.20)
            cube(f'Island_ServiceShelf_{side}_{i}', (w * 0.52, 0.04, d * 0.22), (0, y, side * d * 0.43), M['wood'], 0.012)
    if LEVEL >= 3:
        cube('CheckoutIsland_RaisedTillDeck', (w * 0.42, 0.11, d * 0.38), (-w * 0.17, h + 0.04, 0), M['dark'], 0.025)
        panel_count = LEVEL - 1
        panel_w = w * 0.70 / panel_count
        for index in range(panel_count):
            x = -w * 0.35 + panel_w * (index + 0.5)
            panel_frame(f'CheckoutIsland_FrontPanel_{index+1}', panel_w * 0.84, h * 0.44, -d * 0.38, x, h * 0.43, M['dark'])
    if LEVEL >= 4:
        cube('CheckoutIsland_TaskLight', (w * 0.62, 0.014, 0.012), (0, h * 0.72, -d * 0.39), M['light'], 0.002)
        for x in (-w * 0.43, w * 0.43):
            cube('CheckoutIsland_BrassCorner', (0.035, h * 0.62, 0.035), (x, h * 0.39, -d * 0.38), M['brass'], 0.008)
    if LEVEL >= 5:
        cube('CheckoutIsland_BaggingWing', (w * 0.34, 0.075, d * 0.52), (w * 0.31, h * 0.72, -d * 0.20), M['green'], 0.025)
        cube('CheckoutIsland_ReceiptCubbies', (w * 0.26, h * 0.24, d * 0.20), (-w * 0.28, h * 0.47, d * 0.35), M['body'], 0.018)
    prestige_details('CheckoutIsland', w, h, d)


def build_waiting(w, h, d):
    seat_w = w * (0.28 if LEVEL < 4 else 0.25)
    count = 2 if LEVEL < 3 else 3 if LEVEL < 5 else 4
    for i in range(count):
        x = (i - (count - 1) / 2) * seat_w * 1.12
        cube(f'Waiting_Seat_{i}', (seat_w, 0.13, d * 0.60), (x, h * 0.43, 0), M['fabric'], 0.05)
        cube(f'Waiting_Back_{i}', (seat_w, h * 0.44, 0.13), (x, h * 0.69, d * 0.25), M['fabric'], 0.05, rotation=(math.radians(-7), 0, 0))
        for lx in (-seat_w * 0.38, seat_w * 0.38):
            cube('Waiting_Leg', (0.055, h * 0.40, 0.055), (x + lx, h * 0.20, 0), M['dark'], 0.01)
        if LEVEL >= 2:
            for ax in (-seat_w * 0.48, seat_w * 0.48):
                cube('Waiting_Arm', (0.055, 0.075, d * 0.54), (x + ax, h * 0.54, 0), M['wood'], 0.018)
        if LEVEL >= 4:
            for button in (-seat_w * 0.20, seat_w * 0.20):
                sphere('Waiting_Tuft', 0.022, (x + button, h * 0.70, d * 0.18), M['brass'] if LEVEL == 5 else M['dark'])
    if LEVEL >= 2:
        cube('Waiting_SideTable', (w * 0.18, 0.055, d * 0.45), (w * 0.40, h * 0.47, 0), M['wood'], 0.025)
        vertical_rod('Waiting_TableStem', h * 0.42, (w * 0.40, h * 0.24, 0), M['metal'], 0.035)
    prestige_details('Waiting', w, h, d)


def build_lockers(w, h, d):
    cube('Lockers_Carcass', (w, h, d), (0, h / 2, 0), M['body'], 0.024)
    columns = 2 + LEVEL // 2
    rows = 1 if LEVEL < 3 else 2
    cell_w = w * 0.90 / columns
    cell_h = h * 0.86 / rows
    for row in range(rows):
        for col in range(columns):
            x = -w * 0.45 + cell_w * (col + 0.5)
            y = h * 0.08 + cell_h * (row + 0.5)
            pivot = empty(f'PIVOT_LockerDoor_{row}_{col}', (x - cell_w * 0.44, y, -d / 2 - 0.025))
            cube(f'Locker_Door_{row}_{col}', (cell_w * 0.88, cell_h * 0.88, 0.035), (cell_w * 0.44, 0, 0), M['wood' if LEVEL >= 3 else 'metal'], 0.012, pivot)
            for vent in range(2 + LEVEL // 2):
                cube('Locker_Vent', (cell_w * 0.34, 0.012, 0.012), (cell_w * 0.43, cell_h * (0.24 + vent * 0.07), -0.026), M['black'], 0.002, pivot)
            sphere('Locker_Knob', 0.018, (cell_w * 0.76, 0, -0.04), M['brass' if LEVEL >= 4 else 'metal'], pivot)
            if LEVEL >= 3:
                cube('Locker_NumberPlate', (cell_w * 0.22, cell_h * 0.08, 0.018), (cell_w * 0.44, cell_h * 0.18, -0.04), M['brass'], 0.004, pivot)
    if LEVEL >= 4:
        cube('Locker_Crown', (w * 1.03, 0.10, d * 1.04), (0, h - 0.05, 0), M['dark'], 0.024)
    if LEVEL >= 5:
        cube('Locker_Bench', (w * 0.76, 0.09, d * 0.68), (0, 0.43, -d * 0.64), M['wood'], 0.025)
        for x in (-w * 0.30, w * 0.30):
            cube('Locker_BenchLeg', (0.07, 0.40, 0.07), (x, 0.20, -d * 0.64), M['dark'], 0.012)
    prestige_details('Lockers', w, h, d)


def build_fitting_room(w, h, d):
    cube('FittingRoom_Back', (w, h, 0.075), (0, h / 2, d / 2 - 0.04), M['body'], 0.018)
    for x in (-w / 2 + 0.04, w / 2 - 0.04):
        cube('FittingRoom_Side', (0.075, h, d), (x, h / 2, 0), M['body'], 0.018)
    cube('FittingRoom_Header', (w, 0.20, d * 0.18), (0, h - 0.10, -d * 0.40), M['green'], 0.03)
    cube('FittingRoom_Bench', (w * 0.68, 0.10, d * 0.32), (0, 0.46, d * 0.27), M['wood'], 0.025)
    if LEVEL < 4:
        folds = 5 + LEVEL * 2
        for i in range(folds):
            x = -w * 0.45 + i * w * 0.90 / max(1, folds - 1)
            cube(f'Curtain_Fold_{i}', (w * 0.90 / folds, h * 0.74, 0.035), (x, h * 0.51, -d / 2), M['fabric'], 0.015)
        horizontal_rod('Curtain_Rod', w * 0.94, (0, h * 0.90, -d / 2), M['brass' if LEVEL >= 3 else 'metal'], 0.018)
    else:
        pivot = empty('PIVOT_FittingRoomDoor', (-w * 0.46, h * 0.50, -d / 2))
        cube('FittingRoom_Door', (w * 0.90, h * 0.78, 0.055), (w * 0.45, 0, 0), M['dark'], 0.025, pivot)
        sphere('FittingRoom_Handle', 0.025, (w * 0.80, 0, -0.05), M['brass'], pivot)
        for y in (-h * 0.20, h * 0.20):
            cube('FittingRoom_DoorRail', (w * 0.70, 0.035, 0.018), (w * 0.45, y, -0.04), M['brass'], 0.005, pivot)
        for x in (w * 0.16, w * 0.74):
            cube('FittingRoom_DoorStile', (0.035, h * 0.58, 0.018), (x, 0, -0.04), M['brass'], 0.005, pivot)
        cube('FittingRoom_Threshold', (w * 0.94, 0.045, d * 0.16), (0, 0.025, -d * 0.46), M['brass'], 0.008)
        cube('FittingRoom_CeilingLight', (w * 0.45, 0.014, d * 0.22), (0, h - 0.03, 0), M['light'], 0.003)
        for panel_index, panel_y in enumerate((-h * 0.18, h * 0.18)):
            for edge_y in (-h * 0.10, h * 0.10):
                cube(f'FittingRoom_InsetRail_{panel_index}_{edge_y}', (w * 0.48, 0.028, 0.018), (w * 0.45, panel_y + edge_y, -0.052), M['wood'], 0.004, pivot)
            for edge_x in (w * 0.24, w * 0.66):
                cube(f'FittingRoom_InsetStile_{panel_index}_{edge_x}', (0.028, h * 0.20, 0.018), (edge_x, panel_y, -0.052), M['wood'], 0.004, pivot)
        for side in (-1, 1):
            sphere('FittingRoom_CoatHook', 0.022, (side * w * 0.32, h * 0.68, d * 0.38), M['brass'])
    if LEVEL >= 5:
        cube('FittingRoom_ExecutiveCornice', (w * 1.04, 0.12, d * 1.02), (0, h - 0.06, 0), M['dark'], 0.025)
        cube('FittingRoom_InteriorShelf', (w * 0.66, 0.055, d * 0.24), (0, h * 0.78, d * 0.34), M['wood'], 0.015)
        horizontal_rod('FittingRoom_HangingRail', w * 0.58, (0, h * 0.70, d * 0.24), M['brass'], 0.018)
        for x in (-w * 0.36, w * 0.36):
            cube('FittingRoom_FlutedSide', (0.065, h * 0.72, 0.055), (x, h * 0.48, -d * 0.50), M['wood'], 0.015)
    if LEVEL >= 3:
        cube('FittingRoom_InteriorMirror', (w * 0.52, h * 0.54, 0.018), (0, h * 0.56, d / 2 - 0.085), M['mirror'], 0.01)
    prestige_details('FittingRoom', w, h, d)


def build_mirror(w, h, d):
    frame = 0.055 + LEVEL * 0.009
    cube('Mirror_Glass', (w - frame * 2, h - frame * 2, d * 0.20), (0, h / 2, -d * 0.20), M['mirror'], 0.018)
    for x in (-w / 2 + frame / 2, w / 2 - frame / 2):
        cube('Mirror_FrameSide', (frame, h, d), (x, h / 2, 0), M['wood' if LEVEL < 4 else 'dark'], 0.022)
    for y in (frame / 2, h - frame / 2):
        cube('Mirror_FrameRail', (w, frame, d), (0, y, 0), M['wood' if LEVEL < 4 else 'dark'], 0.022)
    if LEVEL >= 2:
        cube('Mirror_LowerShelf', (w * 0.72, 0.055, d * 2.2), (0, h * 0.08, -d * 0.70), M['wood'], 0.018)
    if LEVEL >= 3:
        cube('Mirror_Header', (w * 0.82, h * 0.08, d * 0.92), (0, h * 0.94, 0), M['green'], 0.018)
    if LEVEL >= 4:
        cube('Mirror_LED_Left', (0.016, h * 0.78, 0.012), (-w * 0.42, h * 0.50, -d * 0.62), M['light'], 0.002)
        cube('Mirror_LED_Right', (0.016, h * 0.78, 0.012), (w * 0.42, h * 0.50, -d * 0.62), M['light'], 0.002)
    if LEVEL >= 5:
        for x in (-w * 0.48, w * 0.48):
            cube('Mirror_SconceArm', (0.055, h * 0.20, d * 0.58), (x, h * 0.72, -d * 0.52), M['brass'], 0.012)
            sphere('Mirror_SconceGlobe', h * 0.055, (x, h * 0.82, -d * 0.88), M['light'])


def build_reception(w, h, d):
    segments = 3 + LEVEL
    for i in range(segments):
        angle = math.radians(-28 + 56 * i / max(1, segments - 1))
        x = math.sin(angle) * w * 0.32
        z = -math.cos(angle) * d * 0.16
        cube(f'Reception_FrontSegment_{i}', (w * 0.76 / segments, h * 0.78, 0.12), (x, h * 0.42, z - d * 0.33), M['body'], 0.025, rotation=(0, angle, 0))
    cube('Reception_Worktop', (w, 0.10, d), (0, h - 0.05, 0), M['dark' if LEVEL >= 3 else 'wood'], 0.045)
    cube('Reception_StaffDesk', (w * 0.68, 0.055, d * 0.52), (0, h * 0.70, d * 0.14), M['cream'], 0.018)
    for x in (-w * 0.43, w * 0.43):
        cube('Reception_End', (0.10, h * 0.82, d * 0.84), (x, h * 0.43, 0), M['body'], 0.025)
    if LEVEL >= 3:
        trim_frame('Reception', w * 0.72, h * 0.56, -d / 2 - 0.04, M['dark'])
    if LEVEL >= 4:
        cube('Reception_LogoPlaque', (w * 0.30, h * 0.18, 0.025), (0, h * 0.48, -d / 2 - 0.09), M['green'], 0.035)
        sphere('Reception_GolfMark', h * 0.055, (0, h * 0.48, -d / 2 - 0.12), M['brass'])
    if LEVEL >= 5:
        for index in range(7):
            x = -w * 0.31 + index * w * 0.103
            cube(f'Reception_Flute_{index+1}', (0.024, h * 0.44, 0.024), (x, h * 0.40, -d * 0.53), M['wood'], 0.005)
        cube('Reception_ExecutiveWing', (w * 0.26, h * 0.68, d * 0.72), (w * 0.37, h * 0.36, d * 0.08), M['body'], 0.035)
    prestige_details('Reception', w, h, d)


def build_category_geometry(slug, w, h, d):
    if slug == 'checkout-counters': build_checkout(w, h, d)
    elif slug == 'office-desks': build_office_desk(w, h, d)
    elif slug == 'tables': build_table(w, h, d)
    elif slug == 'coffee-tables': build_table(w, h, d, True)
    elif slug == 'benches': build_bench(w, h, d)
    elif slug in ('office-cabinets', 'wall-cabinets', 'storage-cabinets'):
        cabinet(w, h, d, slug == 'wall-cabinets', slug == 'storage-cabinets')
    elif slug == 'golf-bag-displays': build_bag_display(w, h, d)
    elif slug == 'hat-displays': build_hat_display(w, h, d)
    elif slug == 'shirt-displays': build_shirt_display(w, h, d)
    elif slug == 'glass-showcases': build_showcase(w, h, d)
    elif slug == 'jewelry-cases': build_showcase(w, h, d, True)
    elif slug == 'display-islands': build_island(w, h, d)
    elif slug == 'freestanding-shelving': build_shelving(w, h, d)
    elif slug == 'wall-shelving': build_shelving(w, h, d, True)
    elif slug == 'pegboard-walls': build_pegboard(w, h, d)
    elif slug == 'checkout-islands': build_checkout_island(w, h, d)
    elif slug == 'waiting-area-furniture': build_waiting(w, h, d)
    elif slug == 'locker-units': build_lockers(w, h, d)
    elif slug == 'fitting-rooms': build_fitting_room(w, h, d)
    elif slug == 'mirrors': build_mirror(w, h, d)
    elif slug == 'reception-desks': build_reception(w, h, d)
    else: raise ValueError(f'No furniture builder for {slug}')


def create_asset(category, tier):
    global ROOT, M, LEVEL
    slug, label, base, wall = category
    tier_id, tier_label, scales, level = tier
    LEVEL = level
    w, h, d = (round(base[index] * scales[index], 4) for index in range(3))
    ROOT = None
    ROOT = empty(f'PF_{slug.replace("-", "_").upper()}_{tier_id.upper()}')
    # Builders use the game's X/Y-up/Z-depth convention. Rotate the authored
    # hierarchy once into Blender's X/Y-depth/Z-up convention before preview and
    # glTF export; Blender's exporter then performs its normal Y-up conversion.
    ROOT.rotation_euler.x = math.radians(90)
    ROOT['asset_id'] = f'pro-shop-furniture:{slug}:{tier_id}'
    ROOT['category'] = slug
    ROOT['tier'] = tier_id
    ROOT['tier_level'] = level
    ROOT['dimensions_m'] = [w, h, d]
    ROOT['dimension_scales'] = list(scales)
    ROOT['source'] = 'Golf Flipper original procedural Blender library'
    M = palette(tier_id, level)
    build_category_geometry(slug, w, h, d)

    if wall:
        for child in ROOT.children:
            child.location.z += d / 2

    socket = empty('SOCKET_PLACEMENT')
    socket['mount'] = 'wall' if wall else 'floor'
    empty('SOCKET_SURFACE', (0, h, d * 0.08))
    if slug in ('checkout-counters', 'checkout-islands', 'reception-desks'):
        empty('SOCKET_REGISTER', (-w * 0.18, h, 0))
        empty('SOCKET_SERVICE', (w * 0.24, h, 0))
    if 'shelv' in slug or 'display' in slug or 'showcase' in slug or 'cases' in slug:
        for index in range(1 + level):
            empty(f'SOCKET_PRODUCT_{index+1:02d}', (
                -w * 0.32 + index * w * 0.64 / max(1, level), h * 0.56, 0,
            ))

    collision = cube(
        f'COL_{slug.replace("-", "_").upper()}_{tier_id.upper()}',
        (w, h, d), (0, h / 2, d / 2 if wall else 0), None, 0,
    )
    collision.display_type = 'WIRE'
    collision.hide_render = True
    collision['collision_proxy'] = True
    return ROOT, (w, h, d), label, tier_label


def descendants(root):
    result = []
    stack = [root]
    while stack:
        item = stack.pop()
        result.append(item)
        stack.extend(item.children)
    return result


def export_glb(root, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in descendants(root):
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True, export_extras=True,
        export_cameras=False, export_lights=False,
    )


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def render_preview(root, dims, path, other_roots):
    w, h, d = dims
    for other in other_roots:
        hidden = other is not root
        for obj in descendants(other):
            obj.hide_render = hidden or obj.name.startswith('COL_')
    bpy.ops.mesh.primitive_plane_add(size=max(5.0, w * 3.0), location=(0, 0, 0))
    floor = bpy.context.object
    floor.name = 'PREVIEW_Floor'
    floor.data.materials.append(material('PREVIEW_WarmCream', (0.55, 0.50, 0.41), 0.82))
    bpy.ops.object.camera_add(location=(w * 1.35 + 1.0, d * 1.7 + 2.0, h * 0.92 + 0.7))
    camera = bpy.context.object
    camera.name = 'PREVIEW_Camera'
    camera.data.lens = 58
    look_at(camera, (0, 0, h * 0.48))
    bpy.context.scene.camera = camera
    for name, energy, size, loc in (
        ('PREVIEW_Key', 850, 4.0, (-3.0, 4.0, 4.6)),
        ('PREVIEW_Fill', 500, 3.0, (4.0, 1.0, 2.8)),
        ('PREVIEW_Rim', 650, 3.0, (1.0, -4.0, 4.0)),
    ):
        bpy.ops.object.light_add(type='AREA', location=loc)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.shape = 'DISK'
        light.data.size = size
        look_at(light, (0, 0, h * 0.48))
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.world.color = (0.055, 0.07, 0.055)
    path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    for obj in list(bpy.context.scene.objects):
        if obj.name.startswith('PREVIEW_'):
            bpy.data.objects.remove(obj, do_unlink=True)
    for other in other_roots:
        for obj in descendants(other):
            obj.hide_render = obj.name.startswith('COL_')


def build_category(category, manifest):
    clean_scene()
    slug = category[0]
    roots = []
    for tier_index, tier in enumerate(TIERS):
        root, dims, label, tier_label = create_asset(category, tier)
        roots.append(root)
        runtime_path = RUNTIME_ROOT / slug / f'{tier[0]}.glb'
        preview_path = PREVIEW_ROOT / slug / f'{tier[0]}.png'
        export_glb(root, runtime_path)
        render_preview(root, dims, preview_path, roots)
        mesh_count = sum(1 for obj in descendants(root) if obj.type == 'MESH' and not obj.name.startswith('COL_'))
        manifest[f'{slug}:{tier[0]}'] = {
            'category': slug,
            'label': label,
            'tier': tier[0],
            'tierLabel': tier_label,
            'tierLevel': tier[3],
            'dimensionsM': list(dims),
            'meshCount': mesh_count,
            'glb': runtime_path.relative_to(REPO).as_posix(),
            'preview': preview_path.relative_to(REPO).as_posix(),
            'source': (SOURCE_ROOT / f'{slug}.blend').relative_to(REPO).as_posix(),
            'license': 'Original Golf Flipper project asset; no external source',
        }
        root.location.x = (tier_index - 2) * category[2][0] * 2.0
    SOURCE_ROOT.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_ROOT / f'{slug}.blend'))


def main():
    ASSET_ROOT.mkdir(parents=True, exist_ok=True)
    manifest_path = ASSET_ROOT / 'manifest.json'
    manifest = json.loads(manifest_path.read_text('utf-8')) if manifest_path.exists() else {}
    start = max(0, int(os.environ.get('GF_FURNITURE_START', '0')))
    end = min(len(CATEGORIES), int(os.environ.get('GF_FURNITURE_END', str(len(CATEGORIES)))))
    for index in range(start, end):
        build_category(CATEGORIES[index], manifest)
        manifest_path.write_text(json.dumps(dict(sorted(manifest.items())), indent=2) + '\n', 'utf-8')
    print(json.dumps({'builtCategories': end - start, 'start': start, 'end': end, 'piecesInManifest': len(manifest)}))


if __name__ == '__main__':
    main()
