"""Build project-owned maintenance equipment with Blender 5.1.

Run headlessly with --factory-startup. Authoring units are metres; the game
converts metres to yards. Moving parts retain physical origins and each export
includes a simple COLLISION_* proxy hidden by the runtime.
"""

import bpy
import math
import os
from mathutils import Vector

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'vendor', 'models')
SOURCE = os.path.join(ROOT, 'Assets', 'Source')
os.makedirs(OUT, exist_ok=True)
os.makedirs(SOURCE, exist_ok=True)


def wipe():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)


def mat(name, color, rough=0.6, metal=0.0):
    result = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1.0)
    shader.inputs['Roughness'].default_value = rough
    shader.inputs['Metallic'].default_value = metal
    return result


M = {
    'green': mat('M_deep_golf_green', (0.075, 0.23, 0.12), 0.58),
    'sage': mat('M_muted_sage', (0.31, 0.43, 0.29), 0.72),
    'cream': mat('M_warm_cream', (0.84, 0.80, 0.66), 0.68),
    'charcoal': mat('M_warm_charcoal', (0.095, 0.09, 0.075), 0.74),
    'rubber': mat('M_rubber', (0.035, 0.038, 0.035), 0.96),
    'steel': mat('M_steel', (0.44, 0.47, 0.46), 0.32, 0.82),
    'brass': mat('M_restrained_brass', (0.56, 0.42, 0.13), 0.42, 0.72),
}


def parent_keep_world(obj, parent):
    if not parent:
        return
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world


def assign(obj, material):
    if obj.type == 'MESH':
        obj.data.materials.clear()
        obj.data.materials.append(material)
    return obj


def empty(name, location=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    parent_keep_world(obj, parent)
    return obj


def cube(name, dimensions, location, material, bevel=0.018, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new('Soft manufactured edges', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = 'ANGLE'
    assign(obj, material)
    parent_keep_world(obj, parent)
    return obj


def cylinder(name, radius, depth, location, rotation, material, vertices=16, parent=None, bevel=0.008):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth,
        location=location, rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel:
        modifier = obj.modifiers.new('Soft rim', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = 'ANGLE'
    assign(obj, material)
    parent_keep_world(obj, parent)
    return obj


def rod(name, start, end, radius, material, parent=None, vertices=12):
    start = Vector(start)
    end = Vector(end)
    delta = end - start
    obj = cylinder(name, radius, delta.length, (start + end) * 0.5, (0, 0, 0), material, vertices, parent, 0.004)
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(delta.normalized())
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.rotation_mode = 'XYZ'
    return obj


def hierarchy(root):
    result = [root]
    stack = list(root.children)
    while stack:
        obj = stack.pop()
        result.append(obj)
        stack.extend(obj.children)
    return result


def prepare(root):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in hierarchy(root):
        if obj.type != 'MESH' or obj.name.startswith('COLLISION_'):
            continue
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.shade_auto_smooth(angle=math.radians(42))
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.025)
        bpy.ops.object.mode_set(mode='OBJECT')
        obj.select_set(False)


def export(root, filename):
    prepare(root)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in hierarchy(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True, export_normals=True,
        export_texcoords=True, export_materials='EXPORT',
    )
    print('WROTE', path)


def build_mower():
    """1.10 m W x 1.23 m L x 1.05 m H walk-behind reel mower."""
    root = empty('GreensMower_ROOT')
    cube('MainFrame', (0.94, 0.42, 0.12), (0, 0.00, 0.30), M['green'], 0.035, root)
    cube('EngineHousing', (0.50, 0.34, 0.30), (0, 0.07, 0.49), M['green'], 0.055, root)
    cube('EngineTop_Cream', (0.34, 0.25, 0.07), (0, 0.06, 0.67), M['cream'], 0.025, root)
    cylinder('FuelCap', 0.045, 0.025, (0.12, 0.05, 0.72), (0, 0, 0), M['brass'], 14, root)
    for side in (-1, 1):
        tag = 'Left' if side < 0 else 'Right'
        cylinder('Wheel_%s_Pivot' % tag, 0.19, 0.10, (side * 0.49, 0.07, 0.22), (0, math.pi / 2, 0), M['rubber'], 18, root)
        cylinder('WheelHub_%s' % tag, 0.07, 0.112, (side * 0.49, 0.07, 0.22), (0, math.pi / 2, 0), M['brass'], 14, root)

    reel = empty('CuttingReel_Pivot', (0, -0.25, 0.18), root)
    cylinder('CuttingReel_Axle', 0.035, 0.86, (0, -0.25, 0.18), (0, math.pi / 2, 0), M['steel'], 14, reel)
    for blade in range(6):
        angle = blade * math.pi / 3
        item = cube(
            'ReelBlade_%02d' % (blade + 1), (0.80, 0.035, 0.055),
            (0, -0.25 + math.sin(angle) * 0.13, 0.18 + math.cos(angle) * 0.13),
            M['steel'], 0.008, reel,
        )
        item.rotation_euler.x = angle
    cylinder('FrontRoller_Pivot', 0.055, 0.90, (0, -0.38, 0.105), (0, math.pi / 2, 0), M['charcoal'], 18, root)

    handle = empty('Handle_Pivot', (0, 0.19, 0.42), root)
    rod('HandleRail_Left', (-0.32, 0.19, 0.42), (-0.30, 0.76, 1.03), 0.025, M['charcoal'], handle)
    rod('HandleRail_Right', (0.32, 0.19, 0.42), (0.30, 0.76, 1.03), 0.025, M['charcoal'], handle)
    rod('HandleGrip', (-0.34, 0.76, 1.03), (0.34, 0.76, 1.03), 0.035, M['rubber'], handle)
    empty('GRIP_push', (0, 0.76, 1.03), handle)
    lever = empty('BladeEngagementLever_Pivot', (0.22, 0.66, 0.92), handle)
    rod('BladeEngagementLever', (0.22, 0.66, 0.92), (0.22, 0.74, 1.02), 0.012, M['brass'], lever, 10)
    cylinder('BladeLeverKnob', 0.027, 0.055, (0.22, 0.75, 1.04), (math.pi / 2, 0, 0), M['charcoal'], 12, lever)

    proxy = cube('COLLISION_GreensMower', (1.05, 0.76, 0.66), (0, 0.02, 0.34), M['charcoal'], 0, root)
    proxy.display_type = 'WIRE'
    root['dimensions_m'] = '1.10 W x 1.23 L x 1.05 H'
    root['moving_parts'] = 'wheels, cutting reel, handle, blade lever'
    return root


def build_spreader():
    """0.79 m W x 1.07 m L x 0.99 m H rotary broadcast spreader."""
    root = empty('RotarySpreader_ROOT')
    frame = empty('Frame_ROOT', parent=root)
    rod('Axle', (-0.34, 0.0, 0.23), (0.34, 0.0, 0.23), 0.025, M['steel'], frame)
    for side in (-1, 1):
        tag = 'Left' if side < 0 else 'Right'
        cylinder('Wheel_%s_Pivot' % tag, 0.18, 0.08, (side * 0.35, 0, 0.23), (0, math.pi / 2, 0), M['rubber'], 18, frame)
        cylinder('Hub_%s' % tag, 0.06, 0.09, (side * 0.35, 0, 0.23), (0, math.pi / 2, 0), M['brass'], 14, frame)

    bpy.ops.mesh.primitive_cone_add(vertices=20, radius1=0.17, radius2=0.31, depth=0.40, location=(0, -0.04, 0.55))
    hopper = bpy.context.object
    hopper.name = 'Hopper'
    parent_keep_world(hopper, root)
    assign(hopper, M['sage'])
    modifier = hopper.modifiers.new('Rounded hopper rim', 'BEVEL')
    modifier.width = 0.018
    modifier.segments = 2
    cylinder('HopperRim', 0.315, 0.035, (0, -0.04, 0.76), (0, 0, 0), M['cream'], 20, root)
    cylinder('HopperLid', 0.285, 0.025, (0, -0.04, 0.785), (0, 0, 0), M['green'], 20, root)

    impeller = empty('BroadcastImpeller_Pivot', (0, -0.04, 0.17), root)
    cylinder('BroadcastImpeller', 0.25, 0.025, (0, -0.04, 0.17), (0, 0, 0), M['green'], 18, impeller)
    for angle in (0, math.pi / 2):
        vane = cube('ImpellerVane', (0.40, 0.025, 0.035), (0, -0.04, 0.195), M['brass'], 0.004, impeller)
        vane.rotation_euler.z = angle

    handle = empty('SpreaderHandle_Pivot', (0, 0.05, 0.34), root)
    rod('HandleRail_Left', (-0.20, 0.05, 0.34), (-0.28, 0.66, 1.00), 0.022, M['charcoal'], handle)
    rod('HandleRail_Right', (0.20, 0.05, 0.34), (0.28, 0.66, 1.00), 0.022, M['charcoal'], handle)
    rod('HandleGrip', (-0.31, 0.66, 1.00), (0.31, 0.66, 1.00), 0.032, M['rubber'], handle)
    empty('GRIP_push', (0, 0.66, 1.00), handle)
    gate = empty('ApplicationGateLever_Pivot', (0.18, 0.56, 0.91), handle)
    rod('ApplicationGateLever', (0.18, 0.56, 0.91), (0.18, 0.67, 1.00), 0.011, M['brass'], gate, 10)
    cylinder('GateLeverKnob', 0.026, 0.05, (0.18, 0.69, 1.02), (math.pi / 2, 0, 0), M['charcoal'], 12, gate)

    proxy = cube('COLLISION_RotarySpreader', (0.72, 0.72, 0.80), (0, 0.05, 0.42), M['charcoal'], 0, root)
    proxy.display_type = 'WIRE'
    root['dimensions_m'] = '0.79 W x 1.07 L x 0.99 H'
    root['moving_parts'] = 'wheels, broadcast impeller, handle, gate lever'
    return root


def build_treatment_sprayer():
    """0.56 m overall W x 0.22 m D x 0.66 m H handheld pump sprayer."""
    root = empty('TreatmentSprayer_ROOT')
    tank = cube('ChemicalTank', (0.27, 0.20, 0.36), (0, 0.0, 0.23), M['cream'], 0.055, root)
    cube('TankBase', (0.29, 0.22, 0.055), (0, 0.0, 0.065), M['green'], 0.025, root)
    cube('TankBand', (0.282, 0.212, 0.07), (0, 0.0, 0.255), M['sage'], 0.024, root)
    cylinder('PumpCollar', 0.082, 0.055, (0, 0.0, 0.445), (0, 0, 0), M['green'], 18, root)
    cylinder('PumpShaft_Pivot', 0.026, 0.17, (0, 0.0, 0.535), (0, 0, 0), M['steel'], 12, root)
    rod('PumpHandle', (-0.105, 0.0, 0.615), (0.105, 0.0, 0.615), 0.028, M['charcoal'], root)

    # A short flexible-hose silhouette made from bounded rigid sections, plus a
    # separate trigger wand. At first-person scale this reads cleanly without a
    # curve modifier or a texture dependency.
    rod('HoseLower', (0.135, 0.02, 0.18), (0.205, 0.03, 0.27), 0.014, M['rubber'], root, 10)
    rod('HoseUpper', (0.205, 0.03, 0.27), (0.225, -0.01, 0.39), 0.014, M['rubber'], root, 10)
    grip = empty('SprayerGrip_Pivot', (0.215, -0.01, 0.39), root)
    cube('TriggerGrip', (0.065, 0.07, 0.16), (0.215, -0.01, 0.43), M['green'], 0.018, grip)
    rod('SprayWand', (0.22, -0.01, 0.50), (0.34, -0.05, 0.62), 0.015, M['steel'], grip, 12)
    cylinder('AdjustableNozzle', 0.025, 0.09, (0.37, -0.06, 0.65),
             (0.0, math.radians(45), 0.0), M['brass'], 12, grip)
    cube('Trigger', (0.018, 0.055, 0.07), (0.19, -0.01, 0.47), M['brass'], 0.006, grip)
    empty('GRIP_treatment', (0.215, -0.01, 0.43), grip)

    proxy = cube('COLLISION_TreatmentSprayer', (0.34, 0.30, 0.58), (0.04, 0.0, 0.32), M['charcoal'], 0, root)
    proxy.display_type = 'WIRE'
    root['dimensions_m'] = '0.56 overall W x 0.22 D x 0.66 H'
    root['moving_parts'] = 'pump shaft, trigger grip'
    tank['contents'] = 'fictional low-toxicity turf treatment'
    return root


def validate(root, pivots):
    objects = hierarchy(root)
    names = {obj.name for obj in objects}
    missing = set(pivots) - names
    if missing:
        raise RuntimeError('Missing pivots: ' + ', '.join(sorted(missing)))
    for obj in objects:
        if obj.type == 'MESH' and any(abs(value - 1) > 1e-4 for value in obj.scale):
            raise RuntimeError('%s has unapplied scale' % obj.name)


wipe()
mower = build_mower()
spreader = build_spreader()
sprayer = build_treatment_sprayer()
validate(mower, ['CuttingReel_Pivot', 'Handle_Pivot', 'BladeEngagementLever_Pivot', 'GRIP_push'])
validate(spreader, ['BroadcastImpeller_Pivot', 'SpreaderHandle_Pivot', 'ApplicationGateLever_Pivot', 'GRIP_push.001'])
validate(sprayer, ['PumpShaft_Pivot', 'SprayerGrip_Pivot', 'GRIP_treatment'])
export(mower, 'greens_mower.glb')
export(spreader, 'rotary_spreader.glb')
export(sprayer, 'treatment_sprayer.glb')

# Exported assets stay centred at the origin; offset only for the editable source.
mower.location.x = -1.4
spreader.location.x = 0
sprayer.location.x = 1.4
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SOURCE, 'course_maintenance_equipment.blend'))
print('WROTE', os.path.join(SOURCE, 'course_maintenance_equipment.blend'))
