"""Build the original Golf Flipper live-play prop kit.

Run:
  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --factory-startup --python tools/blender/build_golf_gameplay.py

Blender/glTF units are meters. The Three course uses yards and applies the
meter-to-yard conversion once when the kit loads.

Real-world targets:
  adult club       1.10 m long
  standing bag     0.30 m diameter x 0.92 m high
  starter podium   0.76 m wide x 0.52 m deep x 1.08 m high
  range basket     0.34 m x 0.25 m x 0.20 m
  golf ball        0.0427 m diameter

Every interactive assembly keeps its own root. GolfClub's origin is at the
grip pivot, GolfBag and StarterStand are floor-centred, and GolfBall is centred.
COLLIDER_* objects are simplified proxies and are hidden by the game renderer.
"""

import bpy
import math
import os


ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
GLB_PATH = os.path.join(ROOT, 'vendor', 'models', 'golf_gameplay_kit.glb')
BLEND_DIR = os.path.join(ROOT, 'Assets', 'Blender')
BLEND_PATH = os.path.join(BLEND_DIR, 'golf_gameplay_kit.blend')
os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)
os.makedirs(BLEND_DIR, exist_ok=True)


def wipe():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for blocks in (bpy.data.meshes, bpy.data.materials, bpy.data.curves):
        for block in list(blocks):
            if block.users == 0:
                blocks.remove(block)


def material(name, color, roughness=0.65, metallic=0.0):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1.0)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    return result


def assign(obj, mat):
    if getattr(obj.data, 'materials', None) is not None:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    return obj


def empty(name, location):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = 'PLAIN_AXES'
    obj.empty_display_size = 0.08
    obj.location = location
    bpy.context.collection.objects.link(obj)
    return obj


def cube(name, dimensions, location, mat, bevel=0.012, parent=None, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel:
        modifier = obj.modifiers.new('EdgeBevel', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = 'ANGLE'
    assign(obj, mat)
    obj.parent = parent
    return obj


def cylinder(name, radius, depth, location, mat, parent=None, vertices=16, rotation=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    if bevel:
        modifier = obj.modifiers.new('EdgeBevel', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = 'ANGLE'
    assign(obj, mat)
    obj.parent = parent
    return obj


def sphere(name, radius, location, mat, parent=None, segments=16, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    obj.parent = parent
    return obj


def torus(name, major, minor, location, mat, parent=None, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        major_segments=20,
        minor_segments=8,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    obj.parent = parent
    return obj


def cone(name, r1, r2, depth, location, mat, parent=None, vertices=20):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r2, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    obj.parent = parent
    bevel = obj.modifiers.new('SoftEdge', 'BEVEL')
    bevel.width = 0.012
    bevel.segments = 2
    return obj


def build_club(mats):
    # Root at the grip centre: the renderer rotates this object for address and swing.
    root = empty('GolfClub', (1.25, 0, 1.10))
    grip = cylinder('GolfClub_Grip', 0.015, 0.24, (0, 0, -0.12), mats['charcoal'], root, vertices=12)
    shaft = cylinder('GolfClub_Shaft', 0.006, 0.84, (0, 0, -0.66), mats['steel'], root, vertices=10)
    head = cube('GolfClub_Head', (0.095, 0.035, 0.052), (0.035, 0, -1.07), mats['steel'], 0.009, root, rotation=(0, 0.13, 0))
    face = cube('GolfClub_Face', (0.006, 0.038, 0.046), (0.085, 0, -1.069), mats['brass'], 0.002, root, rotation=(0, 0.13, 0))
    root['pivot'] = 'grip'
    root['length_m'] = 1.10
    return root, [grip, shaft, head, face]


def build_bag(mats):
    root = empty('GolfBag', (0, 0, 0))
    body = cone('GolfBag_Body', 0.145, 0.115, 0.80, (0, 0, 0.43), mats['green'], root)
    base = cylinder('GolfBag_Base', 0.145, 0.06, (0, 0, 0.03), mats['charcoal'], root, vertices=20, bevel=0.008)
    rim = torus('GolfBag_Rim', 0.115, 0.015, (0, 0, 0.84), mats['brass'], root)
    pocket = cube('GolfBag_Pocket', (0.18, 0.065, 0.28), (0, -0.135, 0.43), mats['sage'], 0.025, root, rotation=(0.08, 0, 0))
    strap = torus('GolfBag_Strap', 0.20, 0.018, (0.13, 0, 0.57), mats['leather'], root, rotation=(math.pi / 2, 0.2, 0))
    parts = [body, base, rim, pocket, strap]
    for side in (-1, 1):
        leg = cylinder(
            f'GolfBag_StandLeg_{"L" if side < 0 else "R"}',
            0.009,
            0.76,
            (side * 0.115, 0.115, 0.37),
            mats['steel'],
            root,
            vertices=8,
            rotation=(0.34 * side, 0.05, 0),
        )
        parts.append(leg)
    for index in range(5):
        x = (index - 2) * 0.042
        shaft = cylinder(f'GolfBag_ClubShaft_{index + 1}', 0.0045, 0.36 + (index % 2) * 0.05,
                         (x, 0.01, 0.99 + (index % 2) * 0.025), mats['steel'], root, vertices=8)
        grip = cylinder(f'GolfBag_ClubGrip_{index + 1}', 0.011, 0.10,
                        (x, 0.01, 1.20 + (index % 2) * 0.05), mats['charcoal'], root, vertices=10)
        parts.extend((shaft, grip))
    collider = cylinder('COLLIDER_GolfBag', 0.17, 0.86, (0, 0, 0.43), mats['collider'], root, vertices=8)
    collider['collision_proxy'] = True
    root['pivot'] = 'floor-center'
    root['dimensions_m'] = [0.30, 0.30, 0.92]
    return root, parts + [collider]


def build_starter(mats):
    root = empty('StarterStand', (-1.4, 0, 0))
    base = cube('StarterStand_Base', (0.76, 0.52, 0.09), (0, 0, 0.045), mats['oak'], 0.018, root)
    column = cube('StarterStand_Column', (0.50, 0.34, 0.83), (0, 0.01, 0.49), mats['walnut'], 0.025, root)
    top = cube('StarterStand_Desk', (0.76, 0.52, 0.09), (0, 0, 0.94), mats['oak'], 0.02, root, rotation=(-0.12, 0, 0))
    sign = cube('StarterStand_Sign', (0.48, 0.035, 0.22), (0, -0.275, 0.76), mats['cream'], 0.012, root)
    band = cube('StarterStand_BrassBand', (0.52, 0.02, 0.035), (0, -0.295, 0.76), mats['brass'], 0.004, root)
    clipboard = cube('StarterStand_Clipboard', (0.25, 0.32, 0.018), (0, -0.02, 1.005), mats['cream'], 0.008, root, rotation=(-0.12, 0, 0))
    clip = cube('StarterStand_Clip', (0.085, 0.025, 0.02), (0, -0.12, 1.04), mats['brass'], 0.003, root, rotation=(-0.12, 0, 0))
    collider = cube('COLLIDER_StarterStand', (0.80, 0.56, 1.08), (0, 0, 0.54), mats['collider'], 0, root)
    collider['collision_proxy'] = True
    root['pivot'] = 'floor-center'
    root['dimensions_m'] = [0.76, 0.52, 1.08]
    return root, [base, column, top, sign, band, clipboard, clip, collider]


def build_range_basket(mats):
    root = empty('RangeBasket', (0, 1.2, 0))
    basket = cone('RangeBasket_Body', 0.17, 0.135, 0.18, (0, 0, 0.10), mats['sage'], root, vertices=16)
    handle = torus('RangeBasket_Handle', 0.16, 0.012, (0, 0, 0.19), mats['charcoal'], root, rotation=(math.pi / 2, 0, 0))
    balls = []
    for index, (x, y) in enumerate(((-0.075, -0.04), (0, -0.055), (0.075, -0.035), (-0.04, 0.04), (0.04, 0.035))):
        balls.append(sphere(f'RangeBasket_Ball_{index + 1}', 0.02135, (x, y, 0.205), mats['ball'], root, 12, 6))
    root['pivot'] = 'floor-center'
    root['dimensions_m'] = [0.34, 0.25, 0.22]
    return root, [basket, handle] + balls


def build_ball(mats):
    root = empty('GolfBall', (1.25, 1.2, 0.02135))
    ball = sphere('GolfBall_Surface', 0.02135, (0, 0, 0), mats['ball'], root, 20, 10)
    root['pivot'] = 'true-center'
    root['diameter_m'] = 0.0427
    return root, [ball]


def build_starter_display(mats):
    root = empty('StarterDisplay', (-2.8, 0, 0))
    parts = [
        cube('StarterDisplay_LeftPost', (0.10, 0.12, 1.62), (-0.62, 0, 0.81), mats['walnut'], 0.012, root),
        cube('StarterDisplay_RightPost', (0.10, 0.12, 1.62), (0.62, 0, 0.81), mats['walnut'], 0.012, root),
        cube('StarterDisplay_Header', (1.40, 0.14, 0.28), (0, 0, 1.50), mats['green'], 0.018, root),
        cube('StarterDisplay_Screen', (1.28, 0.10, 0.66), (0, -0.025, 1.02), mats['charcoal'], 0.014, root),
        cube('StarterDisplay_Footer', (1.40, 0.14, 0.18), (0, 0, 0.62), mats['oak'], 0.016, root),
        cube('StarterDisplay_LeftFoot', (0.34, 0.42, 0.08), (-0.62, 0.08, 0.04), mats['oak'], 0.012, root),
        cube('StarterDisplay_RightFoot', (0.34, 0.42, 0.08), (0.62, 0.08, 0.04), mats['oak'], 0.012, root),
    ]
    collider = cube('COLLIDER_StarterDisplay', (1.46, 0.24, 1.70), (0, 0, 0.85), mats['collider'], 0, root)
    collider['collision_proxy'] = True
    root['pivot'] = 'floor-center'
    root['display_face_m'] = [1.28, 0.66]
    return root, parts + [collider]


def build_ball_dispenser(mats):
    root = empty('BallDispenser', (-4.4, 0, 0))
    body = cube('BallDispenser_Body', (0.62, 0.52, 1.16), (0, 0, 0.64), mats['sage'], 0.06, root)
    top = cube('BallDispenser_Top', (0.66, 0.56, 0.12), (0, 0, 1.24), mats['green'], 0.035, root)
    window = cube('BallDispenser_Window', (0.37, 0.025, 0.34), (0, -0.274, 0.92), mats['cream'], 0.018, root)
    chute = cube('BallDispenser_Chute', (0.31, 0.24, 0.16), (0, -0.33, 0.45), mats['charcoal'], 0.025, root, rotation=(0.16, 0, 0))
    button = cylinder('BallDispenser_Button', 0.045, 0.025, (0.20, -0.285, 0.68), mats['brass'], root, vertices=16, rotation=(math.pi / 2, 0, 0))
    collider = cube('COLLIDER_BallDispenser', (0.66, 0.58, 1.30), (0, 0, 0.65), mats['collider'], 0, root)
    collider['collision_proxy'] = True
    root['pivot'] = 'floor-center'
    root['capacity_balls'] = 240
    return root, [body, top, window, chute, button, collider]


def build_range_bay(mats):
    root = empty('RangeBay', (0, 2.4, 0))
    mat = cube('RangeBay_Mat', (1.75, 1.45, 0.055), (0, 0, 0.0275), mats['green'], 0.035, root)
    stance = cube('RangeBay_Stance', (1.10, 0.72, 0.018), (-0.18, 0.12, 0.066), mats['sage'], 0.025, root)
    tray = cube('RangeBay_BallTray', (0.20, 0.76, 0.075), (0.68, 0.12, 0.09), mats['charcoal'], 0.02, root)
    divider = cube('RangeBay_Divider', (0.055, 1.50, 0.78), (-0.86, 0, 0.39), mats['oak'], 0.02, root)
    number = cube('RangeBay_NumberPlate', (0.18, 0.035, 0.18), (-0.86, -0.67, 0.69), mats['cream'], 0.015, root)
    root['pivot'] = 'floor-center'
    root['dimensions_m'] = [1.75, 1.50, 0.78]
    return root, [mat, stance, tray, divider, number]


def build_warmup_net(mats):
    root = empty('WarmupNet', (2.2, 2.4, 0))
    parts = []
    for side in (-1, 1):
        parts.append(cylinder(f'WarmupNet_Post_{side}', 0.035, 2.35, (side * 1.18, 0, 1.175), mats['charcoal'], root, vertices=10))
    parts.append(cylinder('WarmupNet_TopRail', 0.035, 2.36, (0, 0, 2.33), mats['charcoal'], root, vertices=10, rotation=(0, math.pi / 2, 0)))
    parts.append(cube('WarmupNet_Back', (2.30, 0.035, 2.12), (0, 0.38, 1.08), mats['green'], 0.015, root))
    parts.append(cube('WarmupNet_Target', (0.54, 0.025, 0.54), (0, 0.35, 1.02), mats['cream'], 0.02, root))
    collider = cube('COLLIDER_WarmupNet', (2.46, 0.55, 2.40), (0, 0.20, 1.20), mats['collider'], 0, root)
    collider['collision_proxy'] = True
    root['pivot'] = 'floor-center'
    return root, parts + [collider]


def build_bag_rack(mats):
    root = empty('BagStagingRack', (4.2, 2.4, 0))
    parts = [
        cube('BagRack_Base', (1.80, 0.56, 0.10), (0, 0, 0.05), mats['oak'], 0.018, root),
        cube('BagRack_Back', (1.80, 0.10, 0.88), (0, 0.24, 0.49), mats['walnut'], 0.018, root),
        cube('BagRack_Rail', (1.70, 0.13, 0.13), (0, 0, 0.72), mats['brass'], 0.025, root),
    ]
    for index in range(5):
        parts.append(cylinder(f'BagRack_Divider_{index + 1}', 0.018, 0.44, ((index - 2) * 0.34, 0, 0.37), mats['charcoal'], root, vertices=8))
    collider = cube('COLLIDER_BagStagingRack', (1.86, 0.64, 0.94), (0, 0, 0.47), mats['collider'], 0, root)
    collider['collision_proxy'] = True
    root['pivot'] = 'floor-center'
    root['bag_slots'] = 4
    return root, parts + [collider]


def build_tee_markers(mats):
    root = empty('TeeMarkers', (5.8, 2.4, 0))
    parts = []
    for side in (-1, 1):
        base = cylinder(f'TeeMarker_Base_{side}', 0.12, 0.045, (side * 0.68, 0, 0.0225), mats['brass'], root, vertices=16)
        marker = sphere(f'TeeMarker_Ball_{side}', 0.095, (side * 0.68, 0, 0.12), mats['cream'], root, 16, 8)
        parts.extend((base, marker))
    root['pivot'] = 'tee-line-center'
    root['marker_separation_m'] = 1.36
    return root, parts


def build_practice_pin(mats):
    """A short, unmistakable practice-green target with a real cup rim."""
    root = empty('PracticePin', (7.2, 2.4, 0))
    parts = [
        torus('PracticePin_CupRim', 0.075, 0.012, (0, 0, 0.016), mats['charcoal'], root),
        cylinder('PracticePin_Pole', 0.014, 0.92, (0, 0, 0.46), mats['cream'], root, vertices=10),
        cube('PracticePin_Flag', (0.34, 0.025, 0.20), (0.17, 0, 0.80), mats['green'], 0.018, root),
        cube('PracticePin_FlagBand', (0.34, 0.028, 0.035), (0.17, -0.002, 0.735), mats['brass'], 0.008, root),
    ]
    root['pivot'] = 'cup-center-floor'
    root['dimensions_m'] = [0.42, 0.16, 0.92]
    return root, parts


def build_cart_service_bay(mats):
    """Open-sided return bay with visible wash, charge, and status equipment."""
    root = empty('CartServiceBay', (9.4, 2.4, 0))
    parts = [
        cube('CartServiceBay_Apron', (4.60, 3.20, 0.08), (0, 0, 0.04), mats['charcoal'], 0.06, root),
        cube('CartServiceBay_Roof', (4.75, 3.35, 0.16), (0, 0, 2.64), mats['green'], 0.06, root),
        cube('CartServiceBay_BackRail', (4.25, 0.16, 0.18), (0, 1.38, 1.32), mats['walnut'], 0.025, root),
        cube('CartServiceBay_StatusBoard', (1.45, 0.10, 0.72), (0, 1.28, 1.78), mats['cream'], 0.035, root),
        cube('CartServiceBay_StatusHeader', (1.45, 0.025, 0.16), (0, 1.215, 2.06), mats['green'], 0.018, root),
        cube('CartServiceBay_Charger', (0.46, 0.42, 1.06), (-1.74, 1.10, 0.57), mats['sage'], 0.055, root),
        cube('CartServiceBay_ChargerFace', (0.28, 0.025, 0.32), (-1.74, 0.877, 0.72), mats['charcoal'], 0.025, root),
        cylinder('CartServiceBay_ChargeLamp', 0.055, 0.028, (-1.74, 0.865, 0.96), mats['brass'], root, vertices=16, rotation=(math.pi / 2, 0, 0)),
        torus('CartServiceBay_HoseReel', 0.31, 0.045, (1.68, 1.24, 1.25), mats['brass'], root, rotation=(math.pi / 2, 0, 0)),
        cylinder('CartServiceBay_HoseHub', 0.10, 0.10, (1.68, 1.19, 1.25), mats['charcoal'], root, vertices=16, rotation=(math.pi / 2, 0, 0)),
        cube('CartServiceBay_StopLeft', (0.72, 0.18, 0.13), (-1.05, 0.82, 0.145), mats['oak'], 0.035, root),
        cube('CartServiceBay_StopRight', (0.72, 0.18, 0.13), (1.05, 0.82, 0.145), mats['oak'], 0.035, root),
    ]
    for x in (-2.12, 2.12):
        for y in (-1.35, 1.35):
            parts.append(cube(f'CartServiceBay_Post_{x}_{y}', (0.16, 0.16, 2.58), (x, y, 1.29), mats['oak'], 0.025, root))
    collider = cube('COLLIDER_CartServiceBay', (4.34, 0.24, 2.52), (0, 1.35, 1.26), mats['collider'], 0, root)
    collider['collision_proxy'] = True
    root['pivot'] = 'apron-center-floor'
    root['dimensions_m'] = [4.75, 3.35, 2.72]
    root['service_stages'] = ['return', 'unload', 'clean', 'charge', 'available']
    return root, parts + [collider]


def consolidate_render_meshes(root):
    """Keep one mesh per material under an asset root to bound GLB draw calls."""
    groups = {}
    for obj in list(root.children_recursive):
        if obj.type != 'MESH' or obj.name.startswith('COLLIDER_'):
            continue
        mat = obj.data.materials[0] if obj.data.materials else None
        groups.setdefault(mat, []).append(obj)

    for mat, objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1:
            bpy.ops.object.join()
        joined = objects[0]
        joined.name = f'{root.name}_{mat.name if mat else "Unpainted"}'
        joined.parent = root
        joined.data.materials.clear()
        if mat:
            joined.data.materials.append(mat)
        for polygon in joined.data.polygons:
            polygon.material_index = 0


def finalize(roots):
    for obj in list(bpy.context.scene.objects):
        if obj.type != 'MESH':
            continue
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        if not obj.name.startswith('COLLIDER_'):
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.025)
            bpy.ops.object.mode_set(mode='OBJECT')
            for polygon in obj.data.polygons:
                polygon.use_smooth = obj.name not in {'StarterStand_Sign', 'StarterStand_Clipboard'}
        obj.select_set(False)

    for root in roots:
        consolidate_render_meshes(root)

    bpy.context.scene['asset_license'] = 'Original Golf Flipper project asset; no external source.'
    bpy.context.scene['unit_system'] = 'METRIC'
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1.0
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials='EXPORT',
        export_extras=True,
    )
    print(f'WROTE {BLEND_PATH}')
    print(f'WROTE {GLB_PATH}')


wipe()
mats = {
    'cream': material('Pinehollow_Cream', (0.84, 0.80, 0.66), 0.72),
    'green': material('Pinehollow_DeepGreen', (0.055, 0.21, 0.105), 0.58),
    'sage': material('Pinehollow_Sage', (0.34, 0.46, 0.32), 0.72),
    'walnut': material('Pinehollow_Walnut', (0.25, 0.13, 0.07), 0.52),
    'oak': material('Pinehollow_Oak', (0.54, 0.36, 0.17), 0.62),
    'leather': material('Pinehollow_Leather', (0.31, 0.19, 0.09), 0.66),
    'charcoal': material('Pinehollow_Charcoal', (0.075, 0.085, 0.075), 0.78),
    'brass': material('Pinehollow_Brass', (0.62, 0.45, 0.13), 0.32, 0.82),
    'steel': material('Pinehollow_Steel', (0.50, 0.54, 0.51), 0.28, 0.88),
    'ball': material('GolfBall_Ivory', (0.93, 0.92, 0.82), 0.38),
    'collider': material('CollisionProxy', (1.0, 0.0, 1.0), 1.0),
}

roots = []
for builder in (
    build_bag, build_club, build_starter, build_range_basket, build_ball,
    build_starter_display, build_ball_dispenser, build_range_bay, build_warmup_net,
    build_bag_rack, build_tee_markers, build_practice_pin, build_cart_service_bay,
):
    root, _parts = builder(mats)
    roots.append(root)

assert abs(roots[0]['dimensions_m'][2] - 0.92) < 0.001
assert abs(roots[1]['length_m'] - 1.10) < 0.001
assert roots[1]['pivot'] == 'grip'
assert roots[2]['pivot'] == 'floor-center'
finalize(roots)
