"""Build Golf Flipper's original compact grounds tractor and rear mower.

Run from the repository root:
  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
      --factory-startup --python tools/blender/build_tractor.py

Authored at real compact-tractor dimensions in metres, Z-up. Blender +Y is the
tractor's forward direction and exports to the game's -Z forward direction.
Moving components remain separate under named pivots for runtime animation.
No third-party geometry, textures, logos or manufacturer-specific forms are used.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = ROOT / "vendor" / "models"
SOURCE_DIR = ROOT / "Assets" / "Blender"
QA_DIR = ROOT / "qa" / "checkout-delivery-groundskeeping-balance" / "current" / "tractor"
TRACTOR_GLB = MODEL_DIR / "tractor_production.glb"
MOWER_GLB = MODEL_DIR / "mower_deck_production.glb"
SOURCE_BLEND = SOURCE_DIR / "tractor_production.blend"
PREVIEW = QA_DIR / "blender-preview.png"
REPORT = QA_DIR / "blender-build-report.json"

for folder in (MODEL_DIR, SOURCE_DIR, QA_DIR):
    folder.mkdir(parents=True, exist_ok=True)


def wipe() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for blocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(blocks):
            if block.users == 0:
                blocks.remove(block)


def material(name: str, color: str, roughness: float, metallic: float = 0.0):
    value = color.lstrip("#")
    rgb = tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def empty(name: str, location=(0, 0, 0), rotation=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.12
    obj.location = location
    obj.rotation_euler = rotation
    if parent:
        obj.parent = parent
    return obj


def apply_mesh(obj, bevel=0.0, segments=2):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel:
        mod = obj.modifiers.new("Soft industrial edges", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)
    return obj


def cube(name, dimensions, location=(0, 0, 0), rotation=(0, 0, 0), mat=None, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    apply_mesh(obj, bevel)
    if mat:
        assign(obj, mat)
    return obj


def cylinder(name, radius, depth, location=(0, 0, 0), rotation=(0, 0, 0), mat=None, vertices=16, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth,
                                        location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    apply_mesh(obj, bevel)
    if mat:
        assign(obj, mat)
    return obj


def torus(name, major, minor, location=(0, 0, 0), rotation=(0, 0, 0), mat=None, major_segments=20, minor_segments=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     major_segments=major_segments, minor_segments=minor_segments,
                                     location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    apply_mesh(obj)
    if mat:
        assign(obj, mat)
    return obj


def sphere(name, radius, location=(0, 0, 0), scale=(1, 1, 1), mat=None, segments=16, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    apply_mesh(obj)
    if mat:
        assign(obj, mat)
    return obj


def parent_keep(obj, parent):
    # Blender can leave a freshly created Empty's matrix_world stale until the
    # dependency graph updates. Reading it early makes children inherit the
    # pivot offset twice in exported glTF (most visibly the hinged hood).
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    bpy.context.view_layer.update()
    obj.matrix_world = world
    bpy.context.view_layer.update()
    return obj


def join_meshes(name, objects):
    """Join same-material detail pieces to keep runtime draw calls predictable."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    result = bpy.context.object
    result.name = name
    result.select_set(False)
    return result


def beam(name, start, end, radius, mat, vertices=12):
    a, b = Vector(start), Vector(end)
    delta = b - a
    obj = cylinder(name, radius, delta.length, location=(a + b) / 2, mat=mat, vertices=vertices)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(delta.normalized())
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    obj.rotation_mode = "XYZ"
    obj.select_set(False)
    return obj


def descendants(root):
    result = [root]
    for child in root.children:
        result.extend(descendants(child))
    return result


def export_root(root, path: Path):
    bpy.ops.object.select_all(action="DESELECT")
    items = descendants(root)
    for obj in items:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True,
        export_apply=True, export_extras=True, export_yup=True,
        export_materials="EXPORT", export_cameras=False, export_lights=False,
    )
    for obj in items:
        obj.select_set(False)


def look_at(obj, point):
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat("-Z", "Y").to_euler()


wipe()

M = {
    "green": material("GF Deep Golf Green", "254C34", 0.48, 0.12),
    "green_dark": material("GF Dark Green", "183426", 0.58, 0.18),
    "sage": material("GF Muted Sage", "789276", 0.66, 0.04),
    "cream": material("GF Warm Cream", "E7DDC3", 0.62, 0.02),
    "charcoal": material("GF Warm Charcoal", "292B28", 0.56, 0.62),
    "rubber": material("GF Tire Rubber", "171816", 0.93, 0.0),
    "brass": material("GF Restrained Brass", "9B7B35", 0.34, 0.74),
    "walnut": material("GF Medium Walnut", "60442D", 0.72, 0.0),
    "red": material("GF Safety Red", "A64B36", 0.5, 0.15),
    "amber": material("GF Signal Amber", "D99A34", 0.38, 0.15),
    "glass": material("GF Lamp Glass", "EAD99B", 0.24, 0.05),
}

# --- tractor ---------------------------------------------------------------------
tractor = empty("TractorRoot")
tractor["asset_id"] = "golf_flipper_compact_grounds_tractor_v1"
tractor["source"] = "Original project-authored Blender Python geometry"
tractor["dimensions_m_xyz"] = [2.02, 3.47, 2.22]
tractor["wheelbase_m"] = 1.85
tractor["seat_position_xyz_m"] = [0.0, -0.48, 1.25]
tractor["steering_position_xyz_m"] = [0.0, 0.12, 1.38]
tractor["hitch_position_xyz_m"] = [0.0, -1.72, 0.49]
tractor["collision_radius_game"] = 1.15

static = []
static += [cube("Chassis", (1.18, 2.55, 0.25), (0, 0.02, 0.58), mat=M["charcoal"], bevel=0.07)]
static += [cube("BellyPan", (1.05, 1.55, 0.22), (0, 0.18, 0.78), mat=M["green_dark"], bevel=0.06)]
static += [cube("RearBody", (1.35, 0.90, 0.58), (0, -0.68, 0.93), mat=M["green"], bevel=0.12)]
static += [cube("HoodLower", (1.18, 1.30, 0.48), (0, 0.65, 0.92), mat=M["green"], bevel=0.13)]
static += [cube("HoodTop", (1.08, 1.18, 0.18), (0, 0.58, 1.20), rotation=(math.radians(-2), 0, 0), mat=M["sage"], bevel=0.08)]
static += [cube("Nose", (1.12, 0.26, 0.52), (0, 1.31, 0.92), mat=M["green_dark"], bevel=0.08)]
static += [cube("FrontBumper", (1.30, 0.15, 0.18), (0, 1.51, 0.56), mat=M["charcoal"], bevel=0.035)]
static += [cube("Floorboard", (1.18, 0.82, 0.10), (0, -0.18, 0.93), mat=M["charcoal"], bevel=0.04)]
static += [cube("Step_L", (0.32, 0.55, 0.10), (-0.78, -0.12, 0.62), mat=M["charcoal"], bevel=0.035)]
static += [cube("Step_R", (0.32, 0.55, 0.10), (0.78, -0.12, 0.62), mat=M["charcoal"], bevel=0.035)]

# grille slats and lights
static += [cube("GrilleFrame", (0.90, 0.07, 0.36), (0, 1.455, 0.94), mat=M["charcoal"], bevel=0.02)]
for x in (-0.32, -0.16, 0, 0.16, 0.32):
    static.append(cube(f"GrilleSlat_{x:+.2f}", (0.045, 0.035, 0.28), (x, 1.50, 0.94), mat=M["brass"], bevel=0.008))
for x in (-0.38, 0.38):
    static.append(cylinder(f"Headlamp_{'L' if x < 0 else 'R'}", 0.105, 0.08, (x, 1.49, 1.22),
                           rotation=(math.pi / 2, 0, 0), mat=M["glass"], vertices=16, bevel=0.015))
    static.append(cylinder(f"HeadlampBezel_{'L' if x < 0 else 'R'}", 0.135, 0.055, (x, 1.445, 1.22),
                           rotation=(math.pi / 2, 0, 0), mat=M["brass"], vertices=16))

# fenders, seat, controls
for x, side in ((-0.72, "L"), (0.72, "R")):
    static.append(cube(f"RearFender_{side}", (0.38, 1.02, 0.13), (x, -0.76, 1.08), mat=M["green"], bevel=0.10))
static += [cube("SeatBase", (0.82, 0.52, 0.18), (0, -0.52, 1.27), mat=M["walnut"], bevel=0.11)]
static += [cube("SeatBack", (0.82, 0.16, 0.62), (0, -0.79, 1.56), rotation=(math.radians(-8), 0, 0), mat=M["walnut"], bevel=0.11)]
static += [cube("Dashboard", (0.86, 0.22, 0.32), (0, 0.06, 1.29), rotation=(math.radians(-8), 0, 0), mat=M["charcoal"], bevel=0.07)]
static += [cylinder("Gauge", 0.09, 0.018, (-0.20, -0.055, 1.37), rotation=(math.radians(82), 0, 0), mat=M["cream"], vertices=16)]
static += [cylinder("SteeringColumn", 0.045, 0.62, (0, -0.04, 1.30), rotation=(math.radians(-22), 0, 0), mat=M["charcoal"], vertices=12)]

steering = empty("SteeringWheel", (0, 0.10, 1.52), (math.radians(64), 0, 0), tractor)
steering["animation_axis"] = "local_z"
steer_ring = torus("SteeringWheel_Rim", 0.19, 0.025, mat=M["charcoal"], major_segments=18, minor_segments=6)
steer_ring.parent = steering
for angle in (0, 2 * math.pi / 3, 4 * math.pi / 3):
    beam_obj = beam(f"SteeringSpoke_{angle:.2f}", (0, 0, 0), (math.cos(angle) * 0.17, math.sin(angle) * 0.17, 0), 0.012, M["brass"], 8)
    beam_obj.parent = steering
static += [cylinder("SteeringHub", 0.045, 0.055, mat=M["brass"], vertices=12)]
static[-1].parent = steering

# Open ROPS/canopy: recognizable protection without the old enclosed-cab bulk.
for x, side in ((-0.66, "L"), (0.66, "R")):
    static.append(beam(f"ROPS_Post_{side}", (x, -0.83, 1.08), (x, -0.72, 2.04), 0.055, M["charcoal"], 12))
static += [beam("ROPS_Crossbar", (-0.66, -0.72, 2.02), (0.66, -0.72, 2.02), 0.055, M["charcoal"], 12)]
static += [cube("Canopy", (1.66, 1.48, 0.10), (0, -0.18, 2.15), mat=M["cream"], bevel=0.09)]
static += [cube("CanopyGreenInset", (1.38, 1.20, 0.035), (0, -0.18, 2.095), mat=M["sage"], bevel=0.045)]
static += [sphere("Beacon", 0.09, (0.53, -0.72, 2.24), scale=(1, 1, 0.75), mat=M["amber"], segments=14, rings=7)]

# Exhaust and intake silhouette.
static += [beam("ExhaustStack", (0.48, 0.54, 1.20), (0.48, 0.60, 1.92), 0.055, M["charcoal"], 12)]
static += [cylinder("ExhaustCap", 0.085, 0.035, (0.48, 0.60, 1.95), mat=M["charcoal"], vertices=12)]
static += [beam("AirIntake", (-0.45, 0.54, 1.18), (-0.45, 0.58, 1.62), 0.045, M["charcoal"], 12)]
static += [cylinder("AirPrecleaner", 0.10, 0.13, (-0.45, 0.58, 1.68), mat=M["charcoal"], vertices=14, bevel=0.02)]

# Wheels: named steering and roll pivots, with chunky low-frequency turf tread.
def wheel(name, x, y, radius, width, steer=False):
    steering_parent = empty(f"Steer_{name[-2:]}", (x, y, radius), parent=tractor) if steer else tractor
    roll = empty(name, (0, 0, 0), parent=steering_parent) if steer \
        else empty(name, (x, y, radius), parent=steering_parent)
    roll["animation_axis"] = "local_x"
    tire = torus(f"{name}_Tire", radius - 0.095, 0.095, (x, y, radius),
                 rotation=(0, math.pi / 2, 0), mat=M["rubber"], major_segments=20, minor_segments=8)
    rubber = [tire]
    for i in range(12):
        a = i * math.tau / 12
        tread = cube(f"{name}_Tread_{i:02d}", (width + 0.05, 0.13, 0.075),
                     (x, y + (radius + 0.005) * math.cos(a), radius + (radius + 0.005) * math.sin(a)),
                     rotation=(a, 0, 0), mat=M["rubber"], bevel=0.012)
        rubber.append(tread)
    parent_keep(join_meshes(f"{name}_TireAndTread", rubber), roll)
    hub = cylinder(f"{name}_Hub", radius * 0.35, width + 0.025, (x, y, radius),
                   rotation=(0, math.pi / 2, 0), mat=M["brass"], vertices=16, bevel=0.018)
    parent_keep(hub, roll)
    cap = cylinder(f"{name}_Cap", radius * 0.16, width + 0.055, (x, y, radius),
                   rotation=(0, math.pi / 2, 0), mat=M["charcoal"], vertices=14, bevel=0.012)
    parent_keep(cap, roll)
    return roll


for x, side in ((-0.83, "L"), (0.83, "R")):
    wheel(f"Wheel_F{side}", x, 0.98, 0.39, 0.29, steer=True)
for x, side in ((-0.82, "L"), (0.82, "R")):
    wheel(f"Wheel_R{side}", x, -0.87, 0.56, 0.38)

# Rear hitch and attachment point.
static += [beam("LiftArm_L", (-0.42, -1.06, 0.64), (-0.48, -1.65, 0.43), 0.035, M["charcoal"], 10)]
static += [beam("LiftArm_R", (0.42, -1.06, 0.64), (0.48, -1.65, 0.43), 0.035, M["charcoal"], 10)]
static += [beam("TopLink", (0, -1.02, 0.82), (0, -1.62, 0.58), 0.035, M["brass"], 10)]
static += [cylinder("HitchPin", 0.075, 0.18, (0, -1.72, 0.49), rotation=(0, math.pi / 2, 0), mat=M["brass"], vertices=14)]
hitch = empty("Mower_Hitch", (0, -1.72, 0.49), parent=tractor)
hitch["attachment"] = "rear_finish_mower"

# A hood hinge is authored even though routine gameplay currently keeps it shut.
hood_pivot = empty("Hood_Pivot", (0, -0.02, 1.05), parent=tractor)
hood_pivot["animation_axis"] = "local_x"
for hood_name in ("HoodLower", "HoodTop", "Nose", "GrilleFrame"):
    parent_keep(bpy.data.objects[hood_name], hood_pivot)

for obj in static:
    if obj.parent is None:
        parent_keep(obj, tractor)

# One primitive footprint is the authoritative simplified collision mesh.
collision = cube("COL_Tractor", (1.90, 3.18, 1.30), (0, -0.02, 0.70), mat=M["red"])
collision.display_type = "WIRE"
collision.hide_render = True
collision["collision_shape"] = "box"
parent_keep(collision, tractor)

# --- mower -----------------------------------------------------------------------
mower = empty("MowerRoot", (0, -1.72, 0.49))
mower["asset_id"] = "golf_flipper_rear_finish_mower_v1"
mower["source"] = "Original project-authored Blender Python geometry"
mower["dimensions_m_xyz"] = [2.42, 1.32, 0.52]
mower_pivot = empty("MowerDeck_Pivot", parent=mower)
mower_pivot["animation_axis"] = "local_x"
mower_parts = []
mower_parts += [cube("MowerDeck", (2.34, 1.02, 0.22), (0, -2.42, 0.25), mat=M["green"], bevel=0.14)]
mower_parts += [cube("MowerRearSkirt", (2.40, 0.10, 0.30), (0, -2.92, 0.27), mat=M["sage"], bevel=0.04)]
mower_parts += [cube("MowerFrontRail", (2.20, 0.10, 0.18), (0, -1.94, 0.34), mat=M["charcoal"], bevel=0.035)]
mower_parts += [cylinder("Gearbox", 0.18, 0.28, (0, -2.29, 0.50), mat=M["charcoal"], vertices=16, bevel=0.025)]
mower_parts += [beam("PTO_Shaft", (0, -1.74, 0.45), (0, -2.22, 0.52), 0.055, M["brass"], 12)]
mower_parts += [beam("MowerBrace_L", (-0.45, -1.86, 0.40), (-0.75, -2.42, 0.72), 0.035, M["charcoal"], 10)]
mower_parts += [beam("MowerBrace_R", (0.45, -1.86, 0.40), (0.75, -2.42, 0.72), 0.035, M["charcoal"], 10)]
for x in (-0.74, 0, 0.74):
    mower_parts.append(cylinder(f"BladeDisc_{x:+.2f}", 0.39, 0.035, (x, -2.46, 0.11), mat=M["charcoal"], vertices=18))
for x, side in ((-1.08, "L"), (1.08, "R")):
    mower_parts.append(torus(f"GaugeWheel_{side}", 0.11, 0.045, (x, -2.77, 0.16), rotation=(0, math.pi / 2, 0), mat=M["rubber"], major_segments=14, minor_segments=6))
    mower_parts.append(cylinder(f"GaugeHub_{side}", 0.05, 0.12, (x, -2.77, 0.16), rotation=(0, math.pi / 2, 0), mat=M["brass"], vertices=12))
for obj in mower_parts:
    parent_keep(obj, mower_pivot)
mower_col = cube("COL_MowerDeck", (2.42, 1.18, 0.34), (0, -2.44, 0.24), mat=M["red"])
mower_col.display_type = "WIRE"
mower_col.hide_render = True
mower_col["collision_shape"] = "box"
parent_keep(mower_col, mower)

# Exports use roots at origin. The mower's authored source position is restored
# afterward so the .blend opens as a complete attached machine.
export_root(tractor, TRACTOR_GLB)
mower_source_loc = mower.location.copy()
mower.location = (0, 0, 0)
bpy.context.view_layer.update()
export_root(mower, MOWER_GLB)
mower.location = mower_source_loc
bpy.context.view_layer.update()

# Presentation camera and light live only in the source .blend / QA preview.
bpy.ops.object.camera_add(location=(4.9, 5.6, 3.4))
camera = bpy.context.object
camera.name = "PresentationCamera"
camera.data.lens = 55
look_at(camera, (0, -0.30, 1.02))
bpy.context.scene.camera = camera
bpy.ops.object.light_add(type="AREA", location=(3.8, 2.6, 6.2))
key = bpy.context.object
key.name = "PresentationKey"
key.data.energy = 1150
key.data.shape = "DISK"
key.data.size = 4.0
look_at(key, (0, 0, 0.8))
bpy.ops.object.light_add(type="AREA", location=(-3.2, -2.2, 3.2))
fill = bpy.context.object
fill.name = "PresentationFill"
fill.data.energy = 700
fill.data.size = 3.0
look_at(fill, (0, -0.4, 0.9))
bpy.context.scene.world.color = (0.035, 0.05, 0.04)
bpy.context.scene.render.engine = "BLENDER_EEVEE"
bpy.context.scene.render.resolution_x = 1200
bpy.context.scene.render.resolution_y = 800
bpy.context.scene.render.resolution_percentage = 100
bpy.context.scene.render.image_settings.file_format = "PNG"
bpy.context.scene.render.filepath = str(PREVIEW)
bpy.context.scene.render.film_transparent = False
bpy.context.scene.view_settings.look = "AgX - Medium High Contrast"
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_BLEND))
bpy.ops.render.render(write_still=True)


def stats(root):
    meshes = [o for o in descendants(root) if o.type == "MESH"]
    triangles = 0
    missing_uv = []
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        if not obj.data.uv_layers:
            missing_uv.append(obj.name)
    return {
        "objects": len(descendants(root)),
        "meshes": len(meshes),
        "triangles": triangles,
        "missing_uv": missing_uv,
    }


report = {
    "tractor": stats(tractor),
    "mower": stats(mower),
    "outputs": {
        "tractor_glb": str(TRACTOR_GLB.relative_to(ROOT)),
        "tractor_bytes": TRACTOR_GLB.stat().st_size,
        "mower_glb": str(MOWER_GLB.relative_to(ROOT)),
        "mower_bytes": MOWER_GLB.stat().st_size,
        "source_blend": str(SOURCE_BLEND.relative_to(ROOT)),
    },
    "anchors": {
        "wheelbase_m": 1.85,
        "seat_xyz_m": [0.0, -0.48, 1.25],
        "steering_xyz_m": [0.0, 0.10, 1.52],
        "hitch_xyz_m": [0.0, -1.72, 0.49],
    },
}
REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
