"""Build Golf Flipper's production ceiling-light progression in Blender 5.1.

The five progression fixtures (plus the reusable Premium single downlight) are
original project-owned geometry authored against Designs/Lights.  The script
creates editable .blend sources, LOD0/1/2 GLBs, runtime copies, on/off studio
previews, a progression comparison, and a clean-scene re-import report.

Run from the repository root:
    blender --background --factory-startup --python tools/blender/build_ceiling_lights.py

No network or third-party asset is used.  Blender Z is up; every fixture origin
is the ceiling contact centre. Visible components extend toward -Z while the
Premium rough-in cans deliberately extend above the ceiling plane toward +Z.
"""

from __future__ import annotations

import bmesh
import json
import math
import os
import re
import shutil
from pathlib import Path

import bpy
from mathutils import Vector


REPO = Path(os.environ.get("GF_REPO_ROOT", Path(__file__).resolve().parents[2])).resolve()
ASSET_ROOT = REPO / "Assets" / "ceiling_lights"
SOURCE_ROOT = ASSET_ROOT / "source"
EXPORT_ROOT = ASSET_ROOT / "exports"
PREVIEW_ROOT = ASSET_ROOT / "previews"
RUNTIME_ROOT = REPO / "vendor" / "models" / "ceiling_lights"
QA_ROOT = REPO / "qa" / "ceiling-lights" / "blender"
MANIFEST_PATH = ASSET_ROOT / "manifest.json"
REPORT_PATH = QA_ROOT / "validation.json"

TAU = math.tau
M: dict[str, bpy.types.Material] = {}


def log(message: str) -> None:
    print(f"[ceiling-lights] {message}", flush=True)


def ensure_dirs() -> None:
    for path in (ASSET_ROOT, SOURCE_ROOT, EXPORT_ROOT, PREVIEW_ROOT, RUNTIME_ROOT, QA_ROOT):
        path.mkdir(parents=True, exist_ok=True)


def factory_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.world = bpy.data.worlds.new("CeilingLight_StudioWorld")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs[0].default_value = (0.18, 0.19, 0.20, 1.0)
    background.inputs[1].default_value = 0.36
    global M
    M = {}


def principled_input(node, *names):
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            return socket
    return None


def material(
    name: str,
    color: tuple[float, float, float],
    roughness: float,
    metallic: float = 0.0,
    *,
    alpha: float = 1.0,
    transmission: float = 0.0,
    ior: float = 1.45,
    emission: tuple[float, float, float] | None = None,
    emission_strength: float = 0.0,
    emitter: bool = False,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, alpha)
    node = mat.node_tree.nodes.get("Principled BSDF")
    if node:
        principled_input(node, "Base Color").default_value = (*color, 1.0)
        principled_input(node, "Roughness").default_value = roughness
        principled_input(node, "Metallic").default_value = metallic
        alpha_input = principled_input(node, "Alpha")
        if alpha_input:
            alpha_input.default_value = alpha
        transmission_input = principled_input(node, "Transmission Weight", "Transmission")
        if transmission_input:
            transmission_input.default_value = transmission
        ior_input = principled_input(node, "IOR")
        if ior_input:
            ior_input.default_value = ior
        emission_input = principled_input(node, "Emission Color", "Emission")
        strength_input = principled_input(node, "Emission Strength")
        if emission_input and emission:
            emission_input.default_value = (*emission, 1.0)
        if strength_input:
            strength_input.default_value = emission_strength
    if alpha < 1.0:
        try:
            mat.surface_render_method = "DITHERED"
        except (AttributeError, TypeError):
            pass
    if emitter:
        mat["gf_light_emitter"] = True
        mat["emissive_on_intensity"] = emission_strength
        mat["emissive_off_intensity"] = 0.0
    return mat


def build_materials() -> None:
    global M
    M = {
        "paint_white": material("MAT_PowderCoat_WarmWhite", (0.82, 0.81, 0.76), 0.34, 0.10),
        "paint_utility": material("MAT_PowderCoat_UtilityWhite", (0.70, 0.71, 0.68), 0.42, 0.12),
        "rear_white": material("MAT_RearHousing_White", (0.55, 0.56, 0.53), 0.49, 0.16),
        "charcoal": material("MAT_WarmCharcoal_Metal", (0.055, 0.058, 0.052), 0.34, 0.76),
        "black": material("MAT_Track_MatteBlack", (0.018, 0.020, 0.018), 0.38, 0.70),
        "black_knob": material("MAT_AdjustmentKnob_Black", (0.025, 0.026, 0.024), 0.62, 0.48),
        "cable": material("MAT_SuspensionCable", (0.035, 0.038, 0.037), 0.50, 0.72),
        "bronze": material("MAT_Premium_DarkBronze", (0.145, 0.082, 0.042), 0.30, 0.84),
        "bronze_dark": material("MAT_Premium_Recess", (0.014, 0.010, 0.008), 0.66, 0.42),
        "reflector": material("MAT_Reflector_SatinMetal", (0.68, 0.61, 0.50), 0.18, 0.92),
        "brass": material("MAT_AntiqueBrass", (0.44, 0.25, 0.070), 0.28, 0.87),
        "brass_highlight": material("MAT_PolishedBrass_Accent", (0.62, 0.37, 0.105), 0.18, 0.92),
        "brass_age": material("MAT_AgedBrass_Recess", (0.24, 0.115, 0.028), 0.42, 0.80),
        "ivory": material("MAT_CandleSleeve_Ivory", (0.78, 0.73, 0.61), 0.54, 0.02),
        "frosted": material("MAT_FrostedDiffuser_Unlit", (0.79, 0.81, 0.80), 0.48, 0.0, alpha=0.88, transmission=0.10),
        "lens": material("MAT_WarmLens_Unlit", (0.69, 0.58, 0.40), 0.32, 0.03, alpha=0.94, transmission=0.08),
        "bulb_glass": material("MAT_CandleBulb_Clear", (0.84, 0.75, 0.55), 0.12, 0.02, alpha=0.26, transmission=0.42, ior=1.47),
        "crystal": material("MAT_FacetedCrystal", (0.66, 0.75, 0.76), 0.15, 0.06, alpha=0.32, transmission=0.36, ior=1.46),
        "emit_cool": material("MAT_Emitter_4250K", (0.93, 0.97, 1.0), 0.26, emission=(0.93, 0.97, 1.0), emission_strength=4.2, emitter=True),
        "emit_neutral": material("MAT_Emitter_3800K", (1.0, 0.91, 0.78), 0.25, emission=(1.0, 0.91, 0.78), emission_strength=4.5, emitter=True),
        "emit_premium": material("MAT_Emitter_3250K", (1.0, 0.75, 0.46), 0.22, emission=(1.0, 0.75, 0.46), emission_strength=5.2, emitter=True),
        "emit_track": material("MAT_Emitter_2950K", (1.0, 0.66, 0.34), 0.20, emission=(1.0, 0.66, 0.34), emission_strength=5.7, emitter=True),
        "emit_candle": material("MAT_Emitter_2700K", (1.0, 0.56, 0.22), 0.18, emission=(1.0, 0.56, 0.22), emission_strength=6.1, emitter=True),
    }


def parented(obj: bpy.types.Object, parent: bpy.types.Object | None) -> bpy.types.Object:
    if parent is not None:
        obj.parent = parent
    return obj


def apply_rotation_scale(obj: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.select_set(False)


def bevel_object(obj: bpy.types.Object, width: float, segments: int = 2) -> None:
    if width <= 0:
        return
    modifier = obj.modifiers.new("Manufactured edge bevel", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    modifier.angle_limit = math.radians(32)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def box(name, size, loc, mat=None, *, bevel=0.0, segments=2, rotation=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.dimensions = size
    obj.rotation_euler = rotation
    apply_rotation_scale(obj)
    obj.location = loc
    parented(obj, parent)
    if mat:
        obj.data.materials.append(mat)
    bevel_object(obj, min(bevel, min(size) * 0.22), segments)
    return obj


def cylinder(name, radius, depth, loc, mat=None, *, vertices=24, rotation=(0, 0, 0), parent=None, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth)
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.rotation_euler = rotation
    apply_rotation_scale(obj)
    obj.location = loc
    parented(obj, parent)
    if mat:
        obj.data.materials.append(mat)
    if bevel:
        bevel_object(obj, min(bevel, radius * 0.24, depth * 0.22), 2)
    for polygon in obj.data.polygons:
        polygon.use_smooth = abs(polygon.normal.z) < 0.85
    return obj


def cone(name, radius1, radius2, depth, loc, mat=None, *, vertices=24, rotation=(0, 0, 0), parent=None, bevel=0.0):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2, depth=depth)
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.rotation_euler = rotation
    apply_rotation_scale(obj)
    obj.location = loc
    parented(obj, parent)
    if mat:
        obj.data.materials.append(mat)
    if bevel:
        bevel_object(obj, min(bevel, min(radius1, radius2) * 0.22, depth * 0.18), 2)
    for polygon in obj.data.polygons:
        polygon.use_smooth = abs(polygon.normal.z) < 0.85
    return obj


def torus(name, major_radius, minor_radius, loc, mat=None, *, major_segments=32, minor_segments=8, rotation=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=major_segments,
        minor_segments=minor_segments,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.rotation_euler = rotation
    apply_rotation_scale(obj)
    obj.location = loc
    parented(obj, parent)
    if mat:
        obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def annulus(
    name, outer_radius, inner_radius, depth, loc, mat=None, *,
    segments=32, rotation=(0, 0, 0), parent=None, bevel=0.0,
):
    """Closed, shallow manufactured ring used for flush trims and retainers."""
    vertices = []
    faces = []
    half = depth * 0.5
    for index in range(segments):
        angle = TAU * index / segments
        cosine = math.cos(angle)
        sine = math.sin(angle)
        vertices.extend((
            (outer_radius * cosine, outer_radius * sine, -half),
            (outer_radius * cosine, outer_radius * sine, half),
            (inner_radius * cosine, inner_radius * sine, -half),
            (inner_radius * cosine, inner_radius * sine, half),
        ))
    for index in range(segments):
        nxt = (index + 1) % segments
        ob, ot, ib, it = index * 4, index * 4 + 1, index * 4 + 2, index * 4 + 3
        nob, not_, nib, nit = nxt * 4, nxt * 4 + 1, nxt * 4 + 2, nxt * 4 + 3
        faces.extend((
            (ot, not_, nit, it),
            (nob, ob, ib, nib),
            (ob, nob, not_, ot),
            (nib, ib, it, nit),
        ))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.rotation_euler = rotation
    apply_rotation_scale(obj)
    obj.location = loc
    parented(obj, parent)
    if mat:
        obj.data.materials.append(mat)
    if bevel:
        bevel_object(obj, min(bevel, depth * 0.22, (outer_radius - inner_radius) * 0.18), 2)
    for polygon in obj.data.polygons:
        polygon.use_smooth = abs(polygon.normal.z) < 0.85
    return obj


def sphere(name, radius, loc, mat=None, *, segments=20, rings=12, scale=(1, 1, 1), parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=radius)
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.scale = scale
    apply_rotation_scale(obj)
    obj.location = loc
    parented(obj, parent)
    if mat:
        obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def lathe_profile(name, profile, loc, mat=None, *, segments=20, parent=None):
    vertices = []
    faces = []
    rings = []
    for radius, z in profile:
        if radius <= 1e-5:
            rings.append([len(vertices)])
            vertices.append((0.0, 0.0, z))
        else:
            ring = []
            for index in range(segments):
                angle = TAU * index / segments
                ring.append(len(vertices))
                vertices.append((radius * math.cos(angle), radius * math.sin(angle), z))
            rings.append(ring)
    for lower, upper in zip(rings, rings[1:]):
        if len(lower) == 1 and len(upper) > 1:
            for index in range(len(upper)):
                faces.append((lower[0], upper[index], upper[(index + 1) % len(upper)]))
        elif len(upper) == 1 and len(lower) > 1:
            for index in range(len(lower)):
                faces.append((lower[index], upper[0], lower[(index + 1) % len(lower)]))
        else:
            for index in range(len(lower)):
                nxt = (index + 1) % len(lower)
                faces.append((lower[index], upper[index], upper[nxt], lower[nxt]))
    # Close profiles whose first or last sample has a non-zero radius.  Most
    # lathed pieces are visually nested, but keeping every source mesh sealed
    # avoids hidden open boundaries and makes the assets safe for later edits.
    if len(rings[0]) > 1:
        faces.append(tuple(reversed(rings[0])))
    if len(rings[-1]) > 1:
        faces.append(tuple(rings[-1]))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    parented(obj, parent)
    if mat:
        obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def curve_tube(name, points, radius, mat=None, *, resolution=5, bevel_resolution=2, parent=None):
    data = bpy.data.curves.new(f"{name}_Curve", "CURVE")
    data.dimensions = "3D"
    data.resolution_u = resolution
    data.bevel_depth = radius
    data.bevel_resolution = bevel_resolution
    data.resolution_u = resolution
    data.use_fill_caps = True
    spline = data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coords in zip(spline.bezier_points, points):
        point.co = coords
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    if mat:
        obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    # Blender's 3D curve conversion does not reliably preserve bevel caps in
    # every supported version.  Fill any remaining boundary loops explicitly.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    pending = {edge for edge in bm.edges if edge.is_boundary}
    while pending:
        seed = pending.pop()
        component = [seed]
        stack = [seed]
        while stack:
            edge = stack.pop()
            for vertex in edge.verts:
                for linked in vertex.link_edges:
                    if linked in pending:
                        pending.remove(linked)
                        component.append(linked)
                        stack.append(linked)
        edge_set = set(component)
        start = component[0].verts[0]
        current = start
        previous = None
        ordered = [start]
        for _ in range(len(component)):
            candidates = [edge for edge in current.link_edges if edge in edge_set and edge is not previous]
            if not candidates:
                break
            edge = candidates[0]
            nxt = edge.other_vert(current)
            previous = edge
            current = nxt
            if current is start:
                break
            ordered.append(current)
        if current is start and len(ordered) == len(component):
            try:
                bm.faces.new(ordered)
            except ValueError:
                pass
        else:
            bmesh.ops.holes_fill(bm, edges=component, sides=0)
    if bm.faces:
        bm.to_mesh(obj.data)
        obj.data.update()
    bm.free()
    obj.select_set(False)
    parented(obj, parent)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def empty(name, loc=(0, 0, 0), *, rotation=(0, 0, 0), parent=None, display="PLAIN_AXES", size=0.055):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = rotation
    obj.empty_display_type = display
    obj.empty_display_size = size
    parented(obj, parent)
    return obj


def light_object(
    name,
    kind,
    loc,
    color,
    *,
    energy,
    runtime_intensity,
    runtime_range,
    parent,
    spot_angle=math.radians(70),
    spot_blend=0.55,
):
    data = bpy.data.lights.new(f"{name}_Data", kind)
    data.color = color
    data.energy = energy
    data.use_custom_distance = True
    data.cutoff_distance = runtime_range / 1.0936133
    data.use_shadow = False
    if kind == "SPOT":
        data.spot_size = spot_angle
        data.spot_blend = spot_blend
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    parented(obj, parent)
    obj["gf_runtime_light"] = True
    obj["runtime_intensity"] = runtime_intensity
    obj["runtime_range_yards"] = runtime_range
    obj["runtime_angle_radians"] = spot_angle if kind == "SPOT" else 0.0
    obj["runtime_penumbra"] = spot_blend if kind == "SPOT" else 0.0
    obj["cast_shadow"] = False
    obj["on_energy_watts"] = energy
    return obj


def collision_box(name, size, loc, parent):
    obj = box(name, size, loc, None, parent=parent)
    obj.display_type = "WIRE"
    obj.hide_render = True
    obj["collision_proxy"] = True
    obj["placement_only"] = True
    return obj


def collision_cylinder(name, radius, depth, loc, parent, vertices=16):
    obj = cylinder(name, radius, depth, loc, None, vertices=vertices, parent=parent)
    obj.display_type = "WIRE"
    obj.hide_render = True
    obj["collision_proxy"] = True
    obj["placement_only"] = True
    return obj


def descendants(root):
    result = []
    stack = [root]
    while stack:
        obj = stack.pop()
        result.append(obj)
        stack.extend(obj.children)
    return result


def mesh_objects(root):
    return [obj for obj in descendants(root) if obj.type == "MESH"]


def export_motion_parent(obj, root):
    """Return the nearest authored pivot that must remain independently movable."""
    current = obj.parent
    while current and current is not root:
        if current.type == "EMPTY" and (
            "_YawPivot" in current.name or "_TiltPivot" in current.name
        ):
            return current
        current = current.parent
    return root


def optimize_export_hierarchy(root):
    """Batch static render meshes without flattening authored source or controls.

    The editable .blend is saved before this runs. Runtime GLBs can therefore
    share one draw per material/rigid pivot while the source keeps named screws,
    rails, trim pieces, crystals, and rough-in components. Collision proxies and
    Premium above-ceiling service parts stay separate so placement metadata and
    concealment diagnostics remain explicit.
    """
    hide_hierarchy(root, False)
    bpy.context.view_layer.update()
    candidates = []
    for obj in mesh_objects(root):
        if obj.get("collision_proxy") or "COLLISION_" in obj.name:
            continue
        if obj.get("above_ceiling") is True:
            continue
        candidates.append(obj)

    groups = {}
    for obj in candidates:
        parent = export_motion_parent(obj, root)
        materials = tuple(mat.name if mat else "<none>" for mat in obj.data.materials)
        groups.setdefault((parent, materials), []).append(obj)

    source_meshes = len(mesh_objects(root))
    batch_count = 0
    merged_meshes = 0
    for (parent, material_names), objects in groups.items():
        if len(objects) < 2:
            continue
        objects = sorted(objects, key=lambda candidate: candidate.name)
        bpy.context.view_layer.update()
        for obj in objects:
            world = obj.matrix_world.copy()
            obj.parent = parent
            obj.matrix_world = world
            obj.hide_set(False)
            obj.hide_render = False
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        active = objects[0]
        bpy.context.view_layer.objects.active = active
        bpy.ops.object.join()
        material_label = material_names[0] if material_names else "Unmaterialed"
        material_label = material_label.removeprefix("MAT_").replace(" ", "_")[:36]
        pivot_label = "Root" if parent is root else parent.name[-32:]
        active.name = f"BATCH_{pivot_label}_{material_label}"
        active.data.name = f"{active.name}_Mesh"
        active["optimized_export_batch"] = True
        active["batched_source_meshes"] = len(objects)
        batch_count += 1
        merged_meshes += len(objects) - 1

    bpy.context.view_layer.update()
    return {
        "sourceMeshes": source_meshes,
        "exportMeshes": len(mesh_objects(root)),
        "batches": batch_count,
        "mergedMeshes": merged_meshes,
        "preservedMovingPivots": sorted(
            obj.name for obj in descendants(root)
            if obj.type == "EMPTY" and ("_YawPivot" in obj.name or "_TiltPivot" in obj.name)
        ),
    }


def ensure_uvs(root) -> None:
    seen = set()
    for obj in mesh_objects(root):
        mesh = obj.data
        if mesh in seen or obj.name.startswith(("COLLISION_", "LOD1_COLLISION_", "LOD2_COLLISION_")):
            continue
        seen.add(mesh)
        if mesh.uv_layers:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        obj.hide_set(False)
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.025)
        bpy.ops.object.mode_set(mode="OBJECT")
        obj.select_set(False)


def root_object(name, *, level, dimensions, metadata):
    suffix = "" if level == 0 else f"_LOD{level}"
    root = empty(f"{name}{suffix}", display="CUBE", size=0.08)
    root["asset_id"] = name
    root["lod_level"] = level
    root["units"] = "meters"
    root["up_axis"] = "+Z"
    root["front_axis"] = "-Y"
    root["origin_contract"] = "ceiling mounting centre"
    root["dimensions_m"] = list(dimensions)
    for key, value in metadata.items():
        root[key] = value
    return root


def common_nodes(root, dimensions, *, level, collision="box"):
    width, height, depth = dimensions
    prefix = "" if level == 0 else f"LOD{level}_"
    placement = empty(f"{prefix}PLACEMENT_ANCHOR", parent=root, display="ARROWS", size=0.08)
    placement["mount"] = "ceiling"
    snap = empty(f"{prefix}CEILING_SNAP_ANCHOR", parent=root, display="CIRCLE", size=0.07)
    snap["surface_offset_m"] = 0.0
    footprint = empty(f"{prefix}PLACEMENT_FOOTPRINT", parent=root, display="CUBE", size=0.08)
    footprint["width_m"] = width
    footprint["depth_m"] = depth
    footprint["vertical_drop_m"] = height
    front = empty(f"{prefix}FRONT_DIRECTION", (0, -depth * 0.52, -0.02), parent=root, display="SINGLE_ARROW", size=0.10)
    front["forward"] = [0.0, -1.0, 0.0]
    interaction = empty(
        f"{prefix}LIGHT_CONTROL_INTERACTION",
        (0, 0, -min(max(height * 0.46, 0.08), 0.58)),
        parent=root,
        display="SPHERE",
        size=0.075,
    )
    interaction["interaction_type"] = "light-control"
    interaction["toggle_state"] = "isOn"
    collision_name = f"{prefix}COLLISION_{root.get('asset_id')}"
    if collision == "cylinder":
        return collision_cylinder(collision_name, width * 0.5, height, (0, 0, -height * 0.5), root)
    return collision_box(collision_name, (width, depth, height), (0, 0, -height * 0.5), root)


def set_fixture_state(root, on: bool) -> None:
    materials = set()
    for obj in descendants(root):
        if obj.type == "LIGHT":
            obj.data.energy = float(obj.get("on_energy_watts", obj.data.energy)) if on else 0.0
        if obj.type != "MESH":
            continue
        for mat in obj.data.materials:
            if mat and mat.get("gf_light_emitter"):
                materials.add(mat)
    for mat in materials:
        node = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
        strength = principled_input(node, "Emission Strength") if node else None
        if strength:
            strength.default_value = float(mat.get("emissive_on_intensity", 1.0)) if on else 0.0


def hide_hierarchy(root, hidden: bool) -> None:
    for obj in descendants(root):
        obj.hide_render = hidden or obj.name.startswith(("COLLISION_", "LOD1_COLLISION_", "LOD2_COLLISION_"))
        obj.hide_set(hidden)


def add_basic(level=0):
    asset = "CeilingLight_Basic"
    dims = (1.45, 0.56, 0.16)
    root = root_object(asset, level=level, dimensions=dims, metadata={
        "fixture_tier": "basic", "color_temperature_k": 4250,
        "default_on": True, "power_draw_watts": 42, "minimum_ceiling_height_m": 2.55,
    })
    prefix = "" if level == 0 else f"LOD{level}_"
    seg = 24 if level == 0 else 16 if level == 1 else 10
    detail = level == 0
    for index, x in enumerate((-0.54, 0.54), 1):
        cylinder(f"{prefix}CeilingMount_{index:02d}", 0.038, 0.018, (x, 0, -0.009), M["paint_utility"], vertices=seg, parent=root, bevel=0.002)
        if level < 2:
            torus(
                f"{prefix}CeilingMountBead_{index:02d}", 0.030, 0.003,
                (x, 0, -0.017), M["charcoal"], major_segments=seg,
                minor_segments=5, parent=root,
            )
        cylinder(f"{prefix}Cable_{index:02d}", 0.0032, 0.385, (x, 0, -0.205), M["cable"], vertices=8 if level < 2 else 6, parent=root)
        cylinder(f"{prefix}CableFitting_Upper_{index:02d}", 0.014, 0.030, (x, 0, -0.026), M["charcoal"], vertices=seg, parent=root, bevel=0.002)
        if level < 2:
            cylinder(f"{prefix}CableFitting_Lower_{index:02d}", 0.014, 0.036, (x, 0, -0.404), M["charcoal"], vertices=seg, parent=root, bevel=0.002)
            torus(
                f"{prefix}CableFittingCollar_{index:02d}", 0.014, 0.0025,
                (x, 0, -0.420), M["charcoal"], major_segments=seg,
                minor_segments=5, parent=root,
            )
    box(f"{prefix}Housing", (1.42, 0.145, 0.105), (0, 0, -0.455), M["paint_utility"], bevel=0.008, segments=2 if level == 0 else 1, parent=root)
    box(f"{prefix}Diffuser", (1.355, 0.118, 0.045), (0, -0.001, -0.518), M["frosted"], bevel=0.012, segments=3 if level == 0 else 1, parent=root)
    box(f"{prefix}EmissiveSurface", (1.315, 0.088, 0.012), (0, -0.001, -0.535), M["emit_cool"], bevel=0.005, segments=1, parent=root)
    if detail:
        for x in (-0.704, 0.704):
            box(f"EndCap_{'Left' if x < 0 else 'Right'}", (0.022, 0.151, 0.112), (x, 0, -0.455), M["paint_white"], bevel=0.003, parent=root)
            for y in (-0.036, 0.036):
                cylinder(
                    f"EndCapFastener_{'L' if x < 0 else 'R'}_{'F' if y < 0 else 'B'}",
                    0.005, 0.005, (x + (-0.013 if x < 0 else 0.013), y, -0.455),
                    M["charcoal"], vertices=12, rotation=(0, math.pi / 2, 0),
                    parent=root, bevel=0.001,
                )
        for y in (-0.061, 0.061):
            box(f"HousingSeam_{'Front' if y < 0 else 'Rear'}", (1.31, 0.004, 0.012), (0, y, -0.492), M["rear_white"], bevel=0.001, parent=root)
            box(
                f"DiffuserRetainer_{'Front' if y < 0 else 'Rear'}",
                (1.325, 0.006, 0.032), (0, y * 0.96, -0.518),
                M["paint_white"], bevel=0.0015, parent=root,
            )
        for x in (-0.43, 0.43):
            cylinder(f"InternalTube_{'L' if x < 0 else 'R'}", 0.012, 0.51, (x, 0, -0.515), M["emit_cool"], vertices=12, rotation=(0, math.pi / 2, 0), parent=root)
    for index, x in enumerate((-0.36, 0.36), 1):
        light_object(
            f"{prefix}LIGHT_LINEAR_{'LEFT' if index == 1 else 'RIGHT'}", "SPOT", (x, 0, -0.545),
            (0.86, 0.93, 1.0), energy=58, runtime_intensity=6.1, runtime_range=7.6,
            parent=root, spot_angle=math.radians(104), spot_blend=0.72,
        )
    if level == 0:
        center = empty("LIGHT_LINEAR_CENTER", (0, 0, -0.54), parent=root, display="CIRCLE", size=0.08)
        center["anchor_only"] = True
    common_nodes(root, dims, level=level)
    return root


def add_standard(level=0):
    asset = "CeilingLight_Standard"
    dims = (0.62, 0.075, 0.62)
    root = root_object(asset, level=level, dimensions=dims, metadata={
        "fixture_tier": "standard", "color_temperature_k": 3800,
        "default_on": True, "power_draw_watts": 36, "minimum_ceiling_height_m": 2.35,
    })
    prefix = "" if level == 0 else f"LOD{level}_"
    rail = 0.038 if level < 2 else 0.046
    if level == 2:
        # At distance, one recessed backplate produces the same readable white
        # border around the diffuser for a fraction of the geometry.
        box(f"{prefix}Frame_Backplate", (0.62, 0.62, 0.052), (0, 0, -0.044), M["paint_white"], bevel=0.004, segments=1, parent=root)
    else:
        box(f"{prefix}RearHousing", (0.57, 0.57, 0.038), (0, 0, -0.027), M["rear_white"], bevel=0.006, segments=2 if level == 0 else 1, parent=root)
        for side, size, loc in (
            ("Front", (0.62, rail, 0.052), (0, -0.291, -0.044)),
            ("Rear", (0.62, rail, 0.052), (0, 0.291, -0.044)),
            ("Left", (rail, 0.62 - rail * 2, 0.052), (-0.291, 0, -0.044)),
            ("Right", (rail, 0.62 - rail * 2, 0.052), (0.291, 0, -0.044)),
        ):
            box(f"{prefix}Frame_{side}", size, loc, M["paint_white"], bevel=0.006, segments=2 if level == 0 else 1, parent=root)
    box(f"{prefix}DiffuserPanel", (0.548, 0.548, 0.018), (0, 0, -0.070), M["frosted"], bevel=0.005, segments=2, parent=root)
    box(f"{prefix}EmissivePanel", (0.522, 0.522, 0.006), (0, 0, -0.080), M["emit_neutral"], bevel=0.003, segments=1, parent=root)
    if level < 2:
        channel = 0.010 if level == 0 else 0.014
        for side, size, loc in (
            ("Front", (0.548, channel, 0.008), (0, -0.269, -0.075)),
            ("Rear", (0.548, channel, 0.008), (0, 0.269, -0.075)),
            ("Left", (channel, 0.528, 0.008), (-0.269, 0, -0.075)),
            ("Right", (channel, 0.528, 0.008), (0.269, 0, -0.075)),
        ):
            box(
                f"{prefix}InnerShadowChannel_{side}", size, loc,
                M["charcoal"], bevel=0.0015, segments=1, parent=root,
            )
    if level == 0:
        box(
            "OpticalFilm", (0.495, 0.495, 0.0025), (0, 0, -0.0845),
            M["frosted"], bevel=0.001, segments=1, parent=root,
        )
        for index, (x, y) in enumerate((
            (-0.282, -0.282), (0.282, -0.282),
            (-0.282, 0.282), (0.282, 0.282),
        ), 1):
            box(
                f"FrameCornerCap_{index:02d}", (0.042, 0.042, 0.006),
                (x, y, -0.073), M["paint_white"], bevel=0.002, parent=root,
            )
            cylinder(
                f"FrameFastener_{index:02d}", 0.0045, 0.003,
                (x, y, -0.077), M["rear_white"], vertices=12, parent=root,
                bevel=0.0008,
            )
    light_object(
        f"{prefix}LIGHT_PANEL_CENTER", "SPOT", (0, 0, -0.085), (1.0, 0.85, 0.68),
        energy=105, runtime_intensity=12.2, runtime_range=9.2, parent=root,
        spot_angle=math.radians(118), spot_blend=0.82,
    )
    common_nodes(root, dims, level=level)
    return root


def downlight_unit(parent, index, *, level, prefix, create_light=True):
    seg = 32 if level == 0 else 20 if level == 1 else 12
    unit = empty(f"{prefix}Downlight_{index:02d}", parent=parent, display="CIRCLE", size=0.08)
    unit["installation"] = "recessed above ceiling"
    unit["recess_depth_m"] = 0.124
    unit["visible_drop_m"] = 0.020

    # The rough-in can starts above the mounting plane. The game ceiling hides
    # this service geometry; only the shallow trim and optic remain player-visible.
    housing = cylinder(
        f"{prefix}Downlight_{index:02d}_RoughInHousing", 0.074, 0.120,
        (0, 0, 0.064), M["bronze_dark"], vertices=seg, parent=unit,
        bevel=0.002 if level < 2 else 0.0,
    )
    housing["above_ceiling"] = True
    cutout = empty(
        f"{prefix}Downlight_{index:02d}_CEILING_CUTOUT", (0, 0, 0.001),
        parent=unit, display="CIRCLE", size=0.082,
    )
    cutout["diameter_m"] = 0.164
    cutout["recess_depth_m"] = 0.124
    if level == 0:
        junction = box(
            f"Downlight_{index:02d}_JunctionBox", (0.085, 0.052, 0.043),
            (0.083, 0, 0.105), M["charcoal"], bevel=0.004, parent=unit,
        )
        junction["above_ceiling"] = True
        for side, x in (("Left", -0.094), ("Right", 0.094)):
            clip = box(
                f"Downlight_{index:02d}_SpringClip_{side}", (0.036, 0.012, 0.056),
                (x, 0, 0.038), M["charcoal"], bevel=0.002,
                rotation=(0, math.radians(-18 if x < 0 else 18), 0), parent=unit,
            )
            clip["above_ceiling"] = True
        for fin_index, y in enumerate((-0.045, -0.015, 0.015, 0.045), 1):
            fin = box(
                f"Downlight_{index:02d}_ThermalFin_{fin_index:02d}",
                (0.118, 0.006, 0.024), (0, y, 0.110), M["bronze_dark"],
                bevel=0.001, parent=unit,
            )
            fin["above_ceiling"] = True

    annulus(
        f"{prefix}Downlight_{index:02d}_FlushTrim", 0.092, 0.066, 0.012,
        (0, 0, -0.003), M["bronze"], segments=seg, parent=unit,
        bevel=0.0018 if level < 2 else 0.0008,
    )
    cylinder(
        f"{prefix}Downlight_{index:02d}_ShadowAperture", 0.066, 0.006,
        (0, 0, -0.008), M["bronze_dark"], vertices=seg, parent=unit,
    )
    if level < 2:
        annulus(
            f"{prefix}Downlight_{index:02d}_GimbalBezel", 0.064, 0.046, 0.006,
            (0, 0, -0.010), M["bronze"], segments=seg, parent=unit,
            bevel=0.0012,
        )
    cone(
        f"{prefix}Downlight_{index:02d}_RecessedReflector", 0.057, 0.041,
        0.010, (0, 0, -0.011), M["reflector"], vertices=seg,
        parent=unit, bevel=0.001,
    )
    if level == 0:
        annulus(
            f"Downlight_{index:02d}_LensRetainer", 0.045, 0.039, 0.003,
            (0, 0, -0.016), M["bronze"], segments=seg, parent=unit,
            bevel=0.0007,
        )
    cylinder(
        f"{prefix}Downlight_{index:02d}_Lens", 0.040, 0.004,
        (0, 0, -0.017), M["lens"], vertices=seg, parent=unit,
        bevel=0.0008,
    )
    cylinder(
        f"{prefix}Downlight_{index:02d}_Emitter", 0.034, 0.002,
        (0, 0, -0.020), M["emit_premium"], vertices=seg, parent=unit,
    )
    if level == 0:
        torus(
            f"Downlight_{index:02d}_OpticBead", 0.032, 0.0018,
            (0, 0, -0.0215), M["reflector"], major_segments=seg,
            minor_segments=5, parent=unit,
        )
    anchor = empty(f"{prefix}LIGHT_DOWNLIGHT_{index:02d}_ANCHOR", (0, 0, -0.022), parent=unit, display="CIRCLE", size=0.045)
    anchor["beam_direction"] = [0.0, 0.0, -1.0]
    if create_light:
        light_object(
            f"{prefix}LIGHT_DOWNLIGHT_{index:02d}", "SPOT", (0, 0, -0.024), (1.0, 0.67, 0.39),
            energy=72, runtime_intensity=7.4, runtime_range=7.0, parent=unit,
            spot_angle=math.radians(62), spot_blend=0.64,
        )
    return unit


def add_premium_single(level=0):
    asset = "CeilingLight_Premium_Single"
    dims = (0.184, 0.020, 0.184)
    root = root_object(asset, level=level, dimensions=dims, metadata={
        "fixture_tier": "premium", "color_temperature_k": 3250,
        "default_on": True, "power_draw_watts": 18, "minimum_ceiling_height_m": 2.35,
        "progression_primary": False, "recess_depth_m": 0.124,
        "visible_below_ceiling_m": 0.020,
    })
    prefix = "" if level == 0 else f"LOD{level}_"
    downlight_unit(root, 1, level=level, prefix=prefix, create_light=True)
    common_nodes(root, dims, level=level, collision="cylinder")
    return root


def add_premium_triple(level=0):
    asset = "CeilingLight_Premium_Triple"
    dims = (0.86, 0.020, 0.64)
    root = root_object(asset, level=level, dimensions=dims, metadata={
        "fixture_tier": "premium", "progression_asset_id": "CeilingLight_Premium",
        "color_temperature_k": 3250, "default_on": True,
        "power_draw_watts": 54, "minimum_ceiling_height_m": 2.35,
        "coordinated_lights": True, "recess_depth_m": 0.124,
        "visible_below_ceiling_m": 0.020,
    })
    prefix = "" if level == 0 else f"LOD{level}_"
    for index, position in enumerate(((-0.33, 0.18, 0), (0.33, 0.18, 0), (0, -0.25, 0)), 1):
        unit = downlight_unit(root, index, level=level, prefix=prefix, create_light=True)
        unit.location = position
    common_nodes(root, dims, level=level)
    return root


def spotlight_head(root, index, x, *, level, prefix):
    seg = 32 if level == 0 else 20 if level == 1 else 12
    adapter = cylinder(
        f"{prefix}TrackAdapter_{index:02d}", 0.052, 0.036, (x, 0, -0.083),
        M["black"], vertices=seg, parent=root, bevel=0.003,
    )
    adapter["track_position"] = index
    if level < 2:
        torus(
            f"{prefix}TrackAdapterCollar_{index:02d}", 0.044, 0.004,
            (x, 0, -0.101), M["black_knob"], major_segments=seg,
            minor_segments=5, parent=root,
        )
    cylinder(
        f"{prefix}Stem_{index:02d}", 0.017, 0.085, (x, 0, -0.138),
        M["black"], vertices=seg, parent=root, bevel=0.002,
    )
    yaw = empty(
        f"{prefix}Spotlight_{index:02d}_YawPivot", (x, 0, -0.164),
        parent=root, display="ARROWS", size=0.062,
    )
    yaw["pivot_axis"] = "local Z"
    yaw["min_degrees"] = -160.0
    yaw["max_degrees"] = 160.0
    yaw["interaction_type"] = "spotlight-yaw"
    for side, sx in (("Left", -0.078), ("Right", 0.078)):
        box(
            f"{prefix}Spotlight_{index:02d}_Yoke_{side}", (0.019, 0.034, 0.174),
            (sx, 0, -0.090), M["black"], bevel=0.005,
            segments=2 if level == 0 else 1, parent=yaw,
        )
    box(
        f"{prefix}Spotlight_{index:02d}_YokeBridge", (0.174, 0.034, 0.027),
        (0, 0, -0.012), M["black"], bevel=0.006,
        segments=2 if level == 0 else 1, parent=yaw,
    )
    tilt = empty(
        f"{prefix}Spotlight_{index:02d}_TiltPivot", (0, 0, -0.146),
        parent=yaw, display="ARROWS", size=0.058,
    )
    tilt["pivot_axis"] = "local X"
    tilt["min_degrees"] = -50.0
    tilt["max_degrees"] = 50.0
    tilt["downward_sweep_degrees"] = 100.0
    tilt["interaction_type"] = "spotlight-tilt"
    if level < 2:
        lathe_profile(
            f"{prefix}Spotlight_{index:02d}_Body",
            [
                (0.054, 0.012), (0.064, 0.002), (0.068, -0.030),
                (0.073, -0.105), (0.080, -0.166), (0.074, -0.184),
            ],
            (0, 0, 0), M["black"], segments=seg, parent=tilt,
        )
    else:
        cone(
            f"{prefix}Spotlight_{index:02d}_Body", 0.078, 0.068, 0.185,
            (0, 0, -0.090), M["black"], vertices=seg, parent=tilt,
            bevel=0.004,
        )
    cylinder(
        f"{prefix}Spotlight_{index:02d}_RearCollar", 0.056, 0.034,
        (0, 0, 0.010), M["black_knob"], vertices=seg, parent=tilt, bevel=0.003,
    )
    cylinder(
        f"{prefix}Spotlight_{index:02d}_Reflector", 0.061, 0.027,
        (0, 0, -0.184), M["reflector"], vertices=seg, parent=tilt, bevel=0.002,
    )
    cylinder(
        f"{prefix}Spotlight_{index:02d}_Lens", 0.052, 0.011,
        (0, 0, -0.201), M["lens"], vertices=seg, parent=tilt, bevel=0.002,
    )
    cylinder(
        f"{prefix}Spotlight_{index:02d}_Emitter", 0.043, 0.004,
        (0, 0, -0.209), M["emit_track"], vertices=seg, parent=tilt,
    )
    if level < 2:
        torus(
            f"{prefix}Spotlight_{index:02d}_FrontRetainer", 0.061, 0.004,
            (0, 0, -0.205), M["black_knob"], major_segments=seg,
            minor_segments=5, parent=tilt,
        )
        for band_index, z in enumerate((-0.004, -0.026), 1):
            torus(
                f"{prefix}Spotlight_{index:02d}_CoolingBand_{band_index:02d}",
                0.058 + band_index * 0.002, 0.0025, (0, 0, z),
                M["black_knob"], major_segments=seg, minor_segments=5,
                parent=tilt,
            )
        for side, sx in (("Left", -0.091), ("Right", 0.091)):
            cylinder(
                f"{prefix}Spotlight_{index:02d}_Knob_{side}", 0.025 if level == 0 else 0.020,
                0.018, (sx, 0, 0), M["black_knob"], vertices=16 if level == 0 else 10,
                rotation=(0, math.pi / 2, 0), parent=tilt, bevel=0.002,
            )
    interact = empty(
        f"{prefix}INTERACT_Spotlight_{index:02d}", (0, -0.095, -0.12),
        parent=tilt, display="SPHERE", size=0.055,
    )
    interact["interaction_type"] = "spotlight-adjust"
    interact["head_index"] = index
    light_object(
        f"{prefix}LIGHT_SPOT_{index:02d}", "SPOT", (0, 0, -0.216), (1.0, 0.57, 0.26),
        energy=84, runtime_intensity=9.8, runtime_range=8.4, parent=tilt,
        spot_angle=math.radians(43), spot_blend=0.46,
    )
    return yaw, tilt


def add_high_end(level=0):
    asset = "CeilingLight_HighEnd"
    dims = (1.28, 0.43, 0.28)
    root = root_object(asset, level=level, dimensions=dims, metadata={
        "fixture_tier": "high-end", "color_temperature_k": 2950,
        "default_on": True, "power_draw_watts": 72, "minimum_ceiling_height_m": 2.55,
        "adjustable_heads": 3, "yaw_limit_degrees": 160.0, "tilt_sweep_degrees": 100.0,
    })
    prefix = "" if level == 0 else f"LOD{level}_"
    box(
        f"{prefix}Track", (1.24, 0.078, 0.058), (0, 0, -0.034),
        M["black"], bevel=0.009, segments=3 if level == 0 else 1, parent=root,
    )
    box(
        f"{prefix}CeilingMount", (0.48, 0.105, 0.025), (0, 0, -0.012),
        M["black"], bevel=0.006, segments=2 if level == 0 else 1, parent=root,
    )
    if level < 2:
        box(
            f"{prefix}TrackLowerChannel", (1.165, 0.034, 0.007),
            (0, 0, -0.065), M["black_knob"], bevel=0.002,
            segments=1, parent=root,
        )
        for side, y in (("Front", -0.025), ("Rear", 0.025)):
            box(
                f"{prefix}TrackContactRail_{side}", (1.12, 0.006, 0.005),
                (0, y, -0.069), M["charcoal"], bevel=0.001,
                segments=1, parent=root,
            )
    if level < 2:
        for side, x in (("Left", -0.619), ("Right", 0.619)):
            box(
                f"{prefix}TrackEndCap_{side}", (0.022, 0.081, 0.059),
                (x, 0, -0.034), M["black_knob"], bevel=0.004, parent=root,
            )
            if level == 0:
                cylinder(
                    f"TrackEndFastener_{side}", 0.007, 0.004,
                    (x + (-0.012 if x < 0 else 0.012), -0.041, -0.034),
                    M["black_knob"], vertices=12, rotation=(math.pi / 2, 0, 0), parent=root,
                )
        if level == 0:
            for index, x in enumerate((-0.18, 0.18), 1):
                cylinder(
                    f"CeilingMountFastener_{index:02d}", 0.006, 0.004,
                    (x, -0.052, -0.018), M["black_knob"], vertices=12,
                    rotation=(math.pi / 2, 0, 0), parent=root,
                    bevel=0.001,
                )
    defaults = ((-0.14, 0.14), (0.03, -0.03), (0.16, -0.12))
    for index, (x, angles) in enumerate(zip((-0.42, 0.0, 0.42), defaults), 1):
        yaw, tilt = spotlight_head(root, index, x, level=level, prefix=prefix)
        yaw.rotation_euler.z = angles[0]
        tilt.rotation_euler.x = angles[1]
        if level == 0:
            yaw["default_radians"] = angles[0]
            tilt["default_radians"] = angles[1]
    common_nodes(root, dims, level=level)
    return root


def crystal_drop(name, loc, size, *, level, parent):
    segments = 12 if level == 0 else 8 if level == 1 else 6
    obj = lathe_profile(
        name,
        [
            (0.0, size * 0.50),
            (size * 0.24, size * 0.20),
            (size * 0.34, -size * 0.10),
            (size * 0.18, -size * 0.35),
            (0.0, -size * 0.58),
        ],
        loc, M["crystal"], segments=segments, parent=parent,
    )
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    obj["optimized_crystal"] = True
    return obj


def candle_assembly(root, index, radius, angle, cup_z, *, level, prefix):
    seg = 28 if level == 0 else 18 if level == 1 else 12
    x = radius * math.cos(angle)
    y = radius * math.sin(angle)
    cup = empty(f"{prefix}CandleAssembly_{index:02d}", (x, y, 0), parent=root, display="CIRCLE", size=0.045)
    cone(
        f"{prefix}CandleCup_{index:02d}", 0.044, 0.088, 0.060,
        (0, 0, cup_z), M["brass_highlight"], vertices=seg, parent=cup, bevel=0.003,
    )
    torus(
        f"{prefix}CandleCupRim_{index:02d}", 0.073, 0.008,
        (0, 0, cup_z + 0.031), M["brass"], major_segments=seg, minor_segments=6,
        parent=cup,
    )
    if level < 2:
        torus(
            f"{prefix}CandleCupLowerBead_{index:02d}", 0.043, 0.006,
            (0, 0, cup_z - 0.029), M["brass_age"], major_segments=seg,
            minor_segments=5, parent=cup,
        )
    sleeve_height = 0.205 if level < 2 else 0.19
    cylinder(
        f"{prefix}CandleSleeve_{index:02d}", 0.031, sleeve_height,
        (0, 0, cup_z + 0.030 + sleeve_height * 0.5), M["ivory"],
        vertices=seg, parent=cup, bevel=0.003,
    )
    if level < 2:
        cylinder(
            f"{prefix}CandleSocketCollar_{index:02d}", 0.038, 0.022,
            (0, 0, cup_z + 0.041), M["brass_highlight"], vertices=seg,
            parent=cup, bevel=0.002,
        )
    socket = empty(
        f"{prefix}BULB_SOCKET_{index:02d}", (0, 0, cup_z + 0.030 + sleeve_height),
        parent=cup, display="CIRCLE", size=0.028,
    )
    socket["serviceable_component"] = "bulb"
    if level < 2:
        lathe_profile(
            f"{prefix}Bulb_{index:02d}",
            [(0.0, -0.055), (0.030, -0.038), (0.038, 0.0), (0.025, 0.070), (0.010, 0.105), (0.0, 0.125)],
            (0, 0, cup_z + 0.030 + sleeve_height + 0.055),
            M["bulb_glass"], segments=seg, parent=cup,
        )
    flame = sphere(
        f"{prefix}EmissiveCandle_{index:02d}", 0.018,
        (0, 0, cup_z + 0.030 + sleeve_height + 0.044), M["emit_candle"],
        segments=12 if level < 2 else 8, rings=8 if level < 2 else 5,
        scale=(0.55, 0.55, 1.55), parent=cup,
    )
    flame["visual_bulb_index"] = index
    if level == 0:
        cylinder(
            f"CandleWick_{index:02d}", 0.0028, 0.026,
            (0, 0, cup_z + 0.030 + sleeve_height + 0.038),
            M["charcoal"], vertices=8, parent=cup,
        )
    return (x, y, cup_z), cup


def add_luxury(level=0):
    asset = "CeilingLight_Luxury"
    dims = (1.58, 1.28, 1.58)
    root = root_object(asset, level=level, dimensions=dims, metadata={
        "fixture_tier": "luxury", "color_temperature_k": 2700,
        "default_on": True, "power_draw_watts": 156, "minimum_ceiling_height_m": 3.20,
        "visual_candle_count": 12, "runtime_light_count": 3,
        "crystal_strategy": "faceted shared-style drops; no per-crystal physics or shadows",
    })
    prefix = "" if level == 0 else f"LOD{level}_"
    seg = 36 if level == 0 else 24 if level == 1 else 14
    curve_res = 6 if level == 0 else 4 if level == 1 else 2
    curve_bevel = 2 if level == 0 else 1

    # Load-bearing canopy, stem, collars, and central bowl.
    cylinder(f"{prefix}CeilingCanopy", 0.145, 0.045, (0, 0, -0.022), M["brass"], vertices=seg, parent=root, bevel=0.005)
    torus(f"{prefix}CanopyBead", 0.118, 0.012, (0, 0, -0.047), M["brass_highlight"], major_segments=seg, minor_segments=8, parent=root)
    if level < 2:
        annulus(
            f"{prefix}CanopyMountPlate", 0.154, 0.132, 0.010,
            (0, 0, -0.004), M["brass_age"], segments=seg, parent=root,
            bevel=0.0015,
        )
    if level == 0:
        for screw_index, angle in enumerate((45, 135, 225, 315), 1):
            radians = math.radians(angle)
            cylinder(
                f"CanopyFastener_{screw_index:02d}", 0.0055, 0.0035,
                (0.139 * math.cos(radians), 0.139 * math.sin(radians), -0.010),
                M["brass_highlight"], vertices=12, parent=root, bevel=0.0008,
            )
    cone(f"{prefix}CanopyBell", 0.072, 0.122, 0.080, (0, 0, -0.080), M["brass"], vertices=seg, parent=root, bevel=0.004)
    cylinder(f"{prefix}CentralStem", 0.027, 0.285, (0, 0, -0.245), M["brass_highlight"], vertices=seg, parent=root, bevel=0.004)
    for idx, (z, radius) in enumerate(((-0.125, 0.052), (-0.355, 0.055), (-0.442, 0.075)), 1):
        torus(f"{prefix}StemCollar_{idx:02d}", radius, 0.013, (0, 0, z), M["brass_age"], major_segments=seg, minor_segments=8, parent=root)
    lathe_profile(
        f"{prefix}CentralBody",
        [(0.050, 0.0), (0.092, -0.055), (0.102, -0.145), (0.076, -0.230), (0.130, -0.275), (0.155, -0.345)],
        (0, 0, -0.390), M["brass"], segments=seg, parent=root,
    )
    cone(f"{prefix}LowerBowl", 0.115, 0.205, 0.145, (0, 0, -0.765), M["brass_age"], vertices=seg, parent=root, bevel=0.006)
    torus(f"{prefix}LowerBowlRim", 0.188, 0.015, (0, 0, -0.692), M["brass_highlight"], major_segments=seg, minor_segments=8, parent=root)
    if level < 2:
        torus(
            f"{prefix}LowerBowlLowerBead", 0.112, 0.011,
            (0, 0, -0.838), M["brass"], major_segments=seg,
            minor_segments=6, parent=root,
        )
    lathe_profile(
        f"{prefix}BottomFinial",
        [(0.075, 0.0), (0.048, -0.075), (0.060, -0.125), (0.025, -0.205), (0.0, -0.255)],
        (0, 0, -0.838), M["brass"], segments=seg, parent=root,
    )

    lower_positions = []
    upper_positions = []
    # Eight broad lower arms and four tighter upper arms retain the reference's two-tier silhouette.
    for index in range(8):
        angle = math.radians(22.5 + index * 45)
        direction = Vector((math.cos(angle), math.sin(angle), 0))
        points = [
            tuple(direction * 0.13 + Vector((0, 0, -0.675))),
            tuple(direction * 0.30 + Vector((0, 0, -0.875))),
            tuple(direction * 0.58 + Vector((0, 0, -0.805))),
            tuple(direction * 0.735 + Vector((0, 0, -0.602))),
        ]
        curve_tube(
            f"{prefix}LowerArm_{index + 1:02d}", points, 0.018 if level < 2 else 0.021,
            M["brass"], resolution=curve_res, bevel_resolution=curve_bevel, parent=root,
        )
        if level < 2:
            sphere(
                f"{prefix}LowerArmRosette_{index + 1:02d}", 0.038,
                tuple(direction * 0.145 + Vector((0, 0, -0.682))),
                M["brass_age"], segments=12 if level == 0 else 8,
                rings=8 if level == 0 else 5, scale=(1.15, 1.15, 0.72),
                parent=root,
            )
        if level == 0:
            scroll_points = [
                tuple(direction * 0.16 + Vector((0, 0, -0.610))),
                tuple(direction * 0.33 + Vector((0, 0, -0.760))),
                tuple(direction * 0.50 + Vector((0, 0, -0.700))),
                tuple(direction * 0.61 + Vector((0, 0, -0.625))),
            ]
            curve_tube(
                f"LowerArmScroll_{index + 1:02d}", scroll_points, 0.0085, M["brass_highlight"],
                resolution=5, bevel_resolution=1, parent=root,
            )
        position, _ = candle_assembly(
            root, index + 1, 0.735, angle, -0.602, level=level, prefix=prefix,
        )
        lower_positions.append(position)

    for inner in range(4):
        index = inner + 9
        angle = math.radians(inner * 90)
        direction = Vector((math.cos(angle), math.sin(angle), 0))
        points = [
            tuple(direction * 0.085 + Vector((0, 0, -0.430))),
            tuple(direction * 0.20 + Vector((0, 0, -0.595))),
            tuple(direction * 0.38 + Vector((0, 0, -0.520))),
            tuple(direction * 0.485 + Vector((0, 0, -0.435))),
        ]
        curve_tube(
            f"{prefix}UpperArm_{inner + 1:02d}", points, 0.017 if level < 2 else 0.020,
            M["brass_highlight"], resolution=curve_res, bevel_resolution=curve_bevel, parent=root,
        )
        if level < 2:
            sphere(
                f"{prefix}UpperArmRosette_{inner + 1:02d}", 0.032,
                tuple(direction * 0.10 + Vector((0, 0, -0.445))),
                M["brass_age"], segments=12 if level == 0 else 8,
                rings=8 if level == 0 else 5, scale=(1.12, 1.12, 0.70),
                parent=root,
            )
        position, _ = candle_assembly(
            root, index, 0.485, angle, -0.435, level=level, prefix=prefix,
        )
        upper_positions.append(position)

    # Restrained real-time light budget: twelve emissive candles, only three non-shadow lights.
    light_object(
        f"{prefix}LIGHT_CHANDELIER_CENTER", "POINT", (0, 0, -0.64), (1.0, 0.50, 0.19),
        energy=125, runtime_intensity=13.8, runtime_range=10.8, parent=root,
    )
    for index, x in enumerate((-0.40, 0.40), 1):
        light_object(
            f"{prefix}LIGHT_CHANDELIER_SUPPORT_{index:02d}", "POINT", (x, 0, -0.58),
            (1.0, 0.54, 0.23), energy=42, runtime_intensity=3.6,
            runtime_range=6.6, parent=root,
        )
    if level == 0:
        for index, (x, y, z) in enumerate(lower_positions + upper_positions, 1):
            anchor = empty(f"LIGHT_CANDLE_{index:02d}", (x, y, z + 0.25), parent=root, display="CIRCLE", size=0.035)
            anchor["visual_only"] = True

    # Crystal chains and drops are faceted, reusable in visual language, and deliberately sparse at LODs.
    drop_index = 1
    chain_step = 1 if level == 0 else 2 if level == 1 else 4
    for index in range(0, 8, chain_step):
        current = lower_positions[index]
        nxt = lower_positions[(index + 1) % 8]
        p0 = Vector((current[0], current[1], current[2] - 0.035))
        p3 = Vector((nxt[0], nxt[1], nxt[2] - 0.035))
        middle = (p0 + p3) * 0.5
        middle.z -= 0.22 if level < 2 else 0.15
        curve_tube(
            f"{prefix}CrystalChain_{index + 1:02d}",
            [tuple(p0), tuple((p0 + middle) * 0.5 + Vector((0, 0, -0.04))), tuple(middle), tuple((middle + p3) * 0.5 + Vector((0, 0, -0.04))), tuple(p3)],
            0.0032 if level == 0 else 0.004, M["crystal"],
            resolution=3 if level == 0 else 2, bevel_resolution=0, parent=root,
        )
        crystal_drop(
            f"{prefix}CrystalDrop_{drop_index:02d}",
            (current[0], current[1], current[2] - 0.145), 0.105 if level < 2 else 0.12,
            level=level, parent=root,
        )
        drop_index += 1
        crystal_drop(
            f"{prefix}CrystalDrop_{drop_index:02d}", tuple(middle + Vector((0, 0, -0.10))),
            0.12 if level == 0 else 0.13, level=level, parent=root,
        )
        drop_index += 1
        if level == 0:
            for bead in range(1, 4):
                t = bead / 4
                pos = p0.lerp(p3, t)
                pos.z -= math.sin(math.pi * t) * 0.20
                crystal_drop(
                    f"CrystalChainBead_{index + 1:02d}_{bead:02d}", tuple(pos), 0.040,
                    level=1, parent=root,
                )

    upper_step = 1 if level < 2 else 2
    for index in range(0, 4, upper_step):
        x, y, z = upper_positions[index]
        crystal_drop(
            f"{prefix}UpperCrystalDrop_{index + 1:02d}", (x, y, z - 0.155),
            0.09 if level < 2 else 0.11, level=level, parent=root,
        )
    crystal_drop(
        f"{prefix}CenterCrystal", (0, 0, -1.205), 0.19 if level < 2 else 0.17,
        level=level, parent=root,
    )
    if level == 0:
        for angle_deg in (0, 60, 120, 180, 240, 300):
            angle = math.radians(angle_deg)
            radius = 0.27
            curve_tube(
                f"CenterCrystalChain_{angle_deg:03d}",
                [
                    (0.09 * math.cos(angle), 0.09 * math.sin(angle), -0.80),
                    (radius * math.cos(angle), radius * math.sin(angle), -1.02),
                    (0.12 * math.cos(angle), 0.12 * math.sin(angle), -1.15),
                    (0, 0, -1.205),
                ],
                0.0028, M["crystal"], resolution=3, bevel_resolution=0, parent=root,
            )

    common_nodes(root, dims, level=level, collision="cylinder")
    return root


ASSET_SPECS = [
    {
        "key": "basic", "asset": "CeilingLight_Basic", "file": "ceiling_light_basic",
        "builder": add_basic, "dimensionsM": [1.45, 0.56, 0.16], "primary": True,
        "reference": "Designs/Lights/Basic.png", "colorTemperatureK": 4250,
        "powerDrawWatts": 42, "runtimeLightCount": 2, "runtimeIntensity": [6.1, 6.1],
        "runtimeRangeYards": [7.6, 7.6],
    },
    {
        "key": "standard", "asset": "CeilingLight_Standard", "file": "ceiling_light_standard",
        "builder": add_standard, "dimensionsM": [0.62, 0.075, 0.62], "primary": True,
        "reference": "Designs/Lights/Standard.png", "colorTemperatureK": 3800,
        "powerDrawWatts": 36, "runtimeLightCount": 1, "runtimeIntensity": [12.2],
        "runtimeRangeYards": [9.2],
    },
    {
        "key": "premium_single", "asset": "CeilingLight_Premium_Single", "file": "ceiling_light_premium_single",
        "builder": add_premium_single, "dimensionsM": [0.184, 0.020, 0.184], "primary": False,
        "reference": "Designs/Lights/Premium.png", "colorTemperatureK": 3250,
        "powerDrawWatts": 18, "runtimeLightCount": 1, "runtimeIntensity": [7.4],
        "runtimeRangeYards": [7.0],
    },
    {
        "key": "premium", "asset": "CeilingLight_Premium_Triple", "file": "ceiling_light_premium_triple",
        "builder": add_premium_triple, "dimensionsM": [0.86, 0.020, 0.64], "primary": True,
        "reference": "Designs/Lights/Premium.png", "colorTemperatureK": 3250,
        "powerDrawWatts": 54, "runtimeLightCount": 3, "runtimeIntensity": [7.4, 7.4, 7.4],
        "runtimeRangeYards": [7.0, 7.0, 7.0],
    },
    {
        "key": "high_end", "asset": "CeilingLight_HighEnd", "file": "ceiling_light_high_end",
        "builder": add_high_end, "dimensionsM": [1.28, 0.43, 0.28], "primary": True,
        "reference": "Designs/Lights/High-End.png", "colorTemperatureK": 2950,
        "powerDrawWatts": 72, "runtimeLightCount": 3, "runtimeIntensity": [9.8, 9.8, 9.8],
        "runtimeRangeYards": [8.4, 8.4, 8.4],
    },
    {
        "key": "luxury", "asset": "CeilingLight_Luxury", "file": "ceiling_light_luxury",
        "builder": add_luxury, "dimensionsM": [1.58, 1.28, 1.58], "primary": True,
        "reference": "Designs/Lights/Luxury.png", "colorTemperatureK": 2700,
        "powerDrawWatts": 156, "runtimeLightCount": 3, "runtimeIntensity": [13.8, 3.6, 3.6],
        "runtimeRangeYards": [10.8, 6.6, 6.6],
    },
]


def triangle_count(root, include_collision=False):
    total = 0
    for obj in mesh_objects(root):
        if not include_collision and ("COLLISION_" in obj.name or obj.get("collision_proxy")):
            continue
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def render_bounds(root):
    points = []
    bpy.context.view_layer.update()
    for obj in mesh_objects(root):
        if "COLLISION_" in obj.name or obj.get("collision_proxy"):
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points:
        return None
    mins = [min(point[index] for point in points) for index in range(3)]
    maxs = [max(point[index] for point in points) for index in range(3)]
    return {
        "min": [round(value, 5) for value in mins],
        "max": [round(value, 5) for value in maxs],
        "dimensions": [round(maxs[index] - mins[index], 5) for index in range(3)],
    }


def topology_issues(root):
    issues = []
    for obj in mesh_objects(root):
        if "COLLISION_" in obj.name or obj.get("collision_proxy"):
            continue
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        non_manifold = sum(1 for edge in bm.edges if not edge.is_manifold)
        zero_faces = sum(1 for face in bm.faces if face.calc_area() < 1e-10)
        bm.free()
        if non_manifold:
            issues.append(f"{obj.name}: {non_manifold} non-manifold edges")
        if zero_faces:
            issues.append(f"{obj.name}: {zero_faces} zero-area faces")
    return issues


def track_motion_validation(root):
    if root.get("asset_id") != "CeilingLight_HighEnd":
        return None
    records = []
    for index in range(1, 4):
        yaw = next((obj for obj in descendants(root) if obj.name == f"Spotlight_{index:02d}_YawPivot"), None)
        tilt = next((obj for obj in descendants(root) if obj.name == f"Spotlight_{index:02d}_TiltPivot"), None)
        light = next((obj for obj in descendants(root) if obj.name == f"LIGHT_SPOT_{index:02d}"), None)
        if not yaw or not tilt or not light:
            records.append({"head": index, "ok": False, "reason": "missing pivot or light"})
            continue
        original_yaw = yaw.rotation_euler.z
        original_tilt = tilt.rotation_euler.x
        directions = []
        for yaw_angle, tilt_angle in ((0, 0), (math.radians(-160), math.radians(-50)), (math.radians(160), math.radians(50))):
            yaw.rotation_euler.z = yaw_angle
            tilt.rotation_euler.x = tilt_angle
            bpy.context.view_layer.update()
            direction = light.matrix_world.to_quaternion() @ Vector((0, 0, -1))
            directions.append([round(value, 4) for value in direction.normalized()])
        yaw.rotation_euler.z = original_yaw
        tilt.rotation_euler.x = original_tilt
        bpy.context.view_layer.update()
        records.append({
            "head": index,
            "ok": len({tuple(direction) for direction in directions}) == 3,
            "directions": directions,
            "lightParent": light.parent.name,
        })
    return records


def validate_source(spec, roots, source_path):
    root, lod1, lod2 = roots
    issues = []
    exact_default = re.compile(r"^(Cube|Cylinder|Cone|Sphere|Torus|Empty|Material)(\.\d+)?$")
    bad_names = [obj.name for obj in bpy.context.scene.objects if exact_default.match(obj.name)]
    if bad_names:
        issues.append(f"default Blender object names: {bad_names[:8]}")
    for lod_root in roots:
        missing_uv = [
            obj.name for obj in mesh_objects(lod_root)
            if "COLLISION_" not in obj.name and not obj.data.uv_layers
        ]
        if missing_uv:
            issues.append(f"{lod_root.name}: meshes without UVs: {missing_uv[:6]}")
        unapplied = [
            obj.name for obj in mesh_objects(lod_root)
            if any(abs(value - 1.0) > 0.001 for value in obj.scale)
            or any(abs(value) > 0.001 for value in obj.rotation_euler)
        ]
        if unapplied:
            issues.append(f"{lod_root.name}: unapplied mesh transforms: {unapplied[:6]}")
        issues.extend(f"{lod_root.name}: {entry}" for entry in topology_issues(lod_root))
    triangles = {"LOD0": triangle_count(root), "LOD1": triangle_count(lod1), "LOD2": triangle_count(lod2)}
    if not (triangles["LOD0"] > triangles["LOD1"] > triangles["LOD2"]):
        issues.append(f"LOD triangle counts are not descending: {triangles}")
    names = {obj.name for obj in descendants(root)}
    required = {
        "PLACEMENT_ANCHOR", "CEILING_SNAP_ANCHOR", "PLACEMENT_FOOTPRINT",
        "FRONT_DIRECTION", "LIGHT_CONTROL_INTERACTION",
    }
    missing = sorted(required - names)
    if missing:
        issues.append(f"missing placement nodes: {missing}")
    if not any(name.startswith("COLLISION_") for name in names):
        issues.append("missing collision proxy")
    lights = [obj for obj in descendants(root) if obj.type == "LIGHT"]
    if len(lights) != spec["runtimeLightCount"]:
        issues.append(f"runtime light count {len(lights)} != {spec['runtimeLightCount']}")
    emitter_materials = sorted({
        mat.name for obj in mesh_objects(root) for mat in obj.data.materials
        if mat and mat.get("gf_light_emitter")
    })
    if not emitter_materials:
        issues.append("no on/off emissive material")
    motion = track_motion_validation(root)
    if motion and not all(record["ok"] for record in motion):
        issues.append("one or more spotlight pivot tests failed")
    bounds = render_bounds(root)
    ceiling_cutouts = sorted(
        obj.name for obj in descendants(root) if obj.name.endswith("_CEILING_CUTOUT")
    )
    above_ceiling = sorted(
        obj.name for obj in descendants(root) if obj.get("above_ceiling") is True
    )
    if spec["key"] in {"premium", "premium_single"}:
        expected = 3 if spec["key"] == "premium" else 1
        if len(ceiling_cutouts) != expected:
            issues.append(f"recessed cutouts {len(ceiling_cutouts)} != {expected}")
        if len(above_ceiling) < expected:
            issues.append("recessed rough-in housing is not authored above the ceiling")
        if not bounds or bounds["min"][2] < -0.026 or bounds["max"][2] < 0.115:
            issues.append(f"recessed vertical bounds do not straddle the ceiling correctly: {bounds}")
    return {
        "source": source_path.relative_to(REPO).as_posix(),
        "objects": len(descendants(root)),
        "meshes": len(mesh_objects(root)),
        "materials": sorted({mat.name for obj in mesh_objects(root) for mat in obj.data.materials if mat}),
        "emitterMaterials": emitter_materials,
        "runtimeLights": [obj.name for obj in lights],
        "triangles": triangles,
        "renderBoundsM": bounds,
        "ceilingCutouts": ceiling_cutouts,
        "aboveCeilingComponents": above_ceiling,
        "trackMotion": motion,
        "issues": issues,
    }


def select_hierarchy(root):
    bpy.ops.object.select_all(action="DESELECT")
    selected = descendants(root)
    saved = []
    for obj in selected:
        saved.append((obj, obj.hide_render, obj.hide_get()))
        obj.hide_set(False)
        # Selection is authoritative for export.  Collision proxies must survive
        # even though they never render in Blender or Three.js.
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    return saved


def export_glb(root, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    saved = select_hierarchy(root)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_extras=True,
        export_cameras=False,
        export_lights=True,
        export_animations=False,
    )
    for obj, hide_render, hidden in saved:
        obj.hide_render = hide_render
        obj.hide_set(hidden)
        obj.select_set(False)
    log(f"exported {path.relative_to(REPO).as_posix()}")


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def preview_material(name, color, roughness):
    existing = bpy.data.materials.get(name)
    return existing or material(name, color, roughness)


def add_area(name, energy, size, loc, target):
    data = bpy.data.lights.new(f"{name}_Data", "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    look_at(obj, target)
    return obj


def add_preview_studio(spec, camera_scale=1.0, target_override=None):
    width, height, depth = spec["dimensionsM"]
    span = max(width, depth, height * 0.85)
    ceiling_size = max(3.6, width * 3.0, depth * 3.0)
    ceiling = box(
        "PREVIEW_Ceiling", (ceiling_size, ceiling_size, 0.045), (0, 0, 0.025),
        preview_material("PREVIEW_NeutralCeiling", (0.39, 0.40, 0.41), 0.82), bevel=0.004,
    )
    floor_z = -max(height + 0.82, 1.28)
    floor = box(
        "PREVIEW_Floor", (ceiling_size, ceiling_size, 0.04), (0, 0, floor_z),
        preview_material("PREVIEW_NeutralFloor", (0.18, 0.19, 0.20), 0.72), bevel=0.0,
    )
    target = target_override or (0, 0, -height * 0.48)
    distance = max(1.65, span * 2.35) * camera_scale
    camera_loc = (distance * 0.56, -distance, -height * 0.44)
    bpy.ops.object.camera_add(location=camera_loc)
    camera = bpy.context.object
    camera.name = "PREVIEW_Camera"
    camera.data.name = "PREVIEW_CameraData"
    camera.data.lens = 58
    look_at(camera, target)
    bpy.context.scene.camera = camera
    add_area("PREVIEW_Key", 720 * max(0.6, span * span), max(1.8, span * 1.9), (-span * 1.3, -span * 1.8, 1.25), target)
    add_area("PREVIEW_Fill", 430 * max(0.6, span * span), max(1.6, span * 1.7), (span * 1.6, -span * 0.5, 0.25), target)
    add_area("PREVIEW_Rim", 520 * max(0.6, span * span), max(1.5, span * 1.5), (span * 0.4, span * 1.6, 0.75), target)
    return camera


def render_still(path, *, resolution=(768, 768)):
    path.parent.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    if not path.exists():
        raise RuntimeError(f"Blender did not write preview {path}")
    log(f"rendered {path.relative_to(REPO).as_posix()}")


def clear_preview_studio():
    for obj in list(bpy.context.scene.objects):
        if obj.name.startswith("PREVIEW_"):
            bpy.data.objects.remove(obj, do_unlink=True)


def named_descendant(root, name):
    return next((obj for obj in descendants(root) if obj.name == name), None)


def render_previews(spec, roots):
    root, lod1, lod2 = roots
    hide_hierarchy(root, False)
    hide_hierarchy(lod1, True)
    hide_hierarchy(lod2, True)
    camera = add_preview_studio(spec)
    paths = {}
    set_fixture_state(root, False)
    paths["off"] = PREVIEW_ROOT / f"{spec['file']}_off.png"
    render_still(paths["off"])
    set_fixture_state(root, True)
    paths["on"] = PREVIEW_ROOT / f"{spec['file']}_on.png"
    render_still(paths["on"])

    if spec["key"] == "high_end":
        pivots = []
        for index in range(1, 4):
            yaw = named_descendant(root, f"Spotlight_{index:02d}_YawPivot")
            tilt = named_descendant(root, f"Spotlight_{index:02d}_TiltPivot")
            pivots.append((yaw, tilt, yaw.rotation_euler.z, tilt.rotation_euler.x))
            yaw.rotation_euler.z = 0
            tilt.rotation_euler.x = 0
        bpy.context.view_layer.update()
        paths["straightDown"] = PREVIEW_ROOT / "ceiling_light_high_end_straight_down.png"
        render_still(paths["straightDown"])
        aimed = ((-0.80, 0.48), (0.06, -0.30), (0.82, 0.60))
        for (yaw, tilt, _, _), (yaw_value, tilt_value) in zip(pivots, aimed):
            yaw.rotation_euler.z = yaw_value
            tilt.rotation_euler.x = tilt_value
        bpy.context.view_layer.update()
        paths["aimed"] = PREVIEW_ROOT / "ceiling_light_high_end_aimed.png"
        render_still(paths["aimed"])
        for yaw, tilt, yaw_value, tilt_value in pivots:
            yaw.rotation_euler.z = yaw_value
            tilt.rotation_euler.x = tilt_value
        bpy.context.view_layer.update()

    if spec["key"] == "luxury":
        camera.location = (0.95, -1.52, -0.57)
        camera.data.lens = 68
        look_at(camera, (0.18, 0, -0.61))
        paths["closeup"] = PREVIEW_ROOT / "ceiling_light_luxury_brass_crystal_closeup.png"
        render_still(paths["closeup"])
        hide_hierarchy(root, True)
        hide_hierarchy(lod2, False)
        set_fixture_state(lod2, True)
        camera.location = (4.25, -7.4, -1.15)
        camera.data.lens = 72
        look_at(camera, (0, 0, -0.62))
        paths["lodDistance"] = PREVIEW_ROOT / "ceiling_light_luxury_lod2_distance.png"
        render_still(paths["lodDistance"])
        hide_hierarchy(lod2, True)
        hide_hierarchy(root, False)
        set_fixture_state(root, True)

    clear_preview_studio()
    hide_hierarchy(root, False)
    hide_hierarchy(lod1, True)
    hide_hierarchy(lod2, True)
    set_fixture_state(root, True)
    return {key: path.relative_to(REPO).as_posix() for key, path in paths.items()}


def non_manifold_counts(objects):
    total = 0
    for obj in objects:
        if obj.type != "MESH" or "COLLISION_" in obj.name:
            continue
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        total += sum(1 for edge in bm.edges if not edge.is_manifold)
        bm.free()
    return total


def validate_reimport(spec, glb_path, level=0):
    factory_scene()
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    objects = list(bpy.context.scene.objects)
    names = {obj.name for obj in objects}
    meshes = [obj for obj in objects if obj.type == "MESH"]
    lights = [obj for obj in objects if obj.type == "LIGHT"]
    colliders = [obj for obj in meshes if "COLLISION_" in obj.name or obj.get("collision_proxy")]
    issues = []
    prefix = "" if level == 0 else f"LOD{level}_"
    root_name = spec["asset"] if level == 0 else f"{spec['asset']}_LOD{level}"
    if root_name not in names:
        issues.append(f"missing root {root_name}")
    for required in ("PLACEMENT_ANCHOR", "CEILING_SNAP_ANCHOR", "PLACEMENT_FOOTPRINT", "FRONT_DIRECTION", "LIGHT_CONTROL_INTERACTION"):
        node_name = f"{prefix}{required}"
        if node_name not in names:
            issues.append(f"missing re-imported node {node_name}")
    if not colliders:
        issues.append("collision proxy did not survive GLB")
    if len(lights) != spec["runtimeLightCount"]:
        issues.append(f"re-imported lights {len(lights)} != {spec['runtimeLightCount']}")
    unapplied = [obj.name for obj in meshes if any(abs(value - 1.0) > 0.001 for value in obj.scale)]
    if unapplied:
        issues.append(f"re-imported mesh scales not applied: {unapplied[:6]}")
    missing_materials = [obj.name for obj in meshes if "COLLISION_" not in obj.name and not obj.data.materials]
    if missing_materials:
        issues.append(f"re-imported meshes without materials: {missing_materials[:6]}")
    missing_uvs = [obj.name for obj in meshes if "COLLISION_" not in obj.name and not obj.data.uv_layers]
    if missing_uvs:
        issues.append(f"re-imported meshes without UVs: {missing_uvs[:6]}")
    # glTF preserves the rendered surface but deliberately splits vertices at
    # UV and normal seams.  Those splits appear as boundary edges after Blender
    # re-import, so manifold validation is performed on the source meshes above.
    split_boundary_edges = non_manifold_counts(objects)
    if spec["key"] == "high_end":
        for index in range(1, 4):
            yaw = next((obj for obj in objects if obj.name == f"{prefix}Spotlight_{index:02d}_YawPivot"), None)
            tilt = next((obj for obj in objects if obj.name == f"{prefix}Spotlight_{index:02d}_TiltPivot"), None)
            light = next((obj for obj in objects if obj.name == f"{prefix}LIGHT_SPOT_{index:02d}"), None)
            if not yaw or not tilt or not light or tilt.parent is not yaw or light.parent is not tilt:
                issues.append(f"spotlight {index:02d} pivot/light hierarchy not preserved")
    ceiling_cutouts = sorted(name for name in names if name.endswith("_CEILING_CUTOUT"))
    above_ceiling = sorted(obj.name for obj in objects if obj.get("above_ceiling") is True)
    if spec["key"] in {"premium", "premium_single"}:
        expected = 3 if spec["key"] == "premium" else 1
        if len(ceiling_cutouts) != expected:
            issues.append(f"re-imported recessed cutouts {len(ceiling_cutouts)} != {expected}")
        if len(above_ceiling) < expected:
            issues.append("re-imported rough-in housing metadata missing")
    materials = sorted({mat.name for obj in meshes for mat in obj.data.materials if mat})
    return {
        "glb": glb_path.relative_to(REPO).as_posix(),
        "objects": len(objects),
        "meshes": len(meshes),
        "materials": materials,
        "lights": [obj.name for obj in lights],
        "collisionMeshes": [obj.name for obj in colliders],
        "ceilingCutouts": ceiling_cutouts,
        "aboveCeilingComponents": above_ceiling,
        "splitBoundaryEdgesAfterImport": split_boundary_edges,
        "topologyValidation": "source meshes validated before glTF UV/normal seam splitting",
        "issues": issues,
    }


def build_one(spec):
    factory_scene()
    build_materials()
    roots = [spec["builder"](level) for level in range(3)]
    root, lod1, lod2 = roots
    for lod_root in roots:
        ensure_uvs(lod_root)
    hide_hierarchy(root, False)
    hide_hierarchy(lod1, True)
    hide_hierarchy(lod2, True)
    source_path = SOURCE_ROOT / f"{spec['file']}.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path), check_existing=False, compress=True)
    source_validation = validate_source(spec, roots, source_path)

    export_optimization = {}
    for level, lod_root in enumerate(roots):
        export_optimization[f"LOD{level}"] = optimize_export_hierarchy(lod_root)
    hide_hierarchy(root, False)
    hide_hierarchy(lod1, True)
    hide_hierarchy(lod2, True)

    glb_paths = {
        "LOD0": EXPORT_ROOT / f"{spec['file']}.glb",
        "LOD1": EXPORT_ROOT / f"{spec['file']}_lod1.glb",
        "LOD2": EXPORT_ROOT / f"{spec['file']}_lod2.glb",
    }
    export_glb(root, glb_paths["LOD0"])
    export_glb(lod1, glb_paths["LOD1"])
    export_glb(lod2, glb_paths["LOD2"])
    runtime_paths = {}
    for lod_name, glb_path in glb_paths.items():
        runtime_path = RUNTIME_ROOT / glb_path.name
        shutil.copy2(glb_path, runtime_path)
        runtime_paths[lod_name] = runtime_path.relative_to(REPO).as_posix()

    previews = render_previews(spec, roots)
    reimports = {
        lod_name: validate_reimport(spec, glb_path, int(lod_name[-1]))
        for lod_name, glb_path in glb_paths.items()
    }
    issues = [*source_validation["issues"]]
    for lod_name, validation in reimports.items():
        issues.extend(f"{lod_name}: {issue}" for issue in validation["issues"])
    record = {
        "key": spec["key"],
        "asset": spec["asset"],
        "progressionPrimary": spec["primary"],
        "reference": spec["reference"],
        "dimensionsM": spec["dimensionsM"],
        "source": source_path.relative_to(REPO).as_posix(),
        "exports": {key: value.relative_to(REPO).as_posix() for key, value in glb_paths.items()},
        "runtime": runtime_paths,
        "previews": previews,
        "colorTemperatureK": spec["colorTemperatureK"],
        "powerDrawWatts": spec["powerDrawWatts"],
        "runtimeLightCount": spec["runtimeLightCount"],
        "runtimeIntensity": spec["runtimeIntensity"],
        "runtimeRangeYards": spec["runtimeRangeYards"],
        "sourceValidation": source_validation,
        "exportOptimization": export_optimization,
        "reimportValidation": reimports["LOD0"],
        "reimportValidations": reimports,
        "issues": issues,
    }
    log(f"{spec['asset']}: {source_validation['triangles']} issues={len(issues)}")
    return record


def set_imported_scene_state(on):
    for obj in bpy.context.scene.objects:
        if obj.type == "LIGHT" and not obj.name.startswith("PREVIEW_"):
            if "preview_saved_energy" not in obj:
                obj["preview_saved_energy"] = obj.data.energy
            obj.data.energy = float(obj["preview_saved_energy"]) if on else 0.0
        if obj.type != "MESH":
            continue
        for mat in obj.data.materials:
            if not mat or "Emitter_" not in mat.name:
                continue
            node = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
            strength = principled_input(node, "Emission Strength") if node else None
            if strength:
                if "preview_saved_emission" not in mat:
                    mat["preview_saved_emission"] = strength.default_value
                strength.default_value = float(mat["preview_saved_emission"]) if on else 0.0


def build_comparison(records):
    factory_scene()
    primary = [record for record in records if record["progressionPrimary"]]
    positions = (-4.0, -2.3, -0.75, 1.2, 3.7)
    roots = []
    for record, x in zip(primary, positions):
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(REPO / record["exports"]["LOD0"]))
        imported = [obj for obj in bpy.context.scene.objects if obj not in before]
        for obj in imported:
            if "COLLISION_" in obj.name or obj.get("collision_proxy"):
                obj.hide_render = True
        root = next((obj for obj in imported if obj.name == record["asset"]), None)
        if not root:
            root = next((obj for obj in imported if obj.parent is None), None)
        if root:
            root.location.x = x
            roots.append(root)
    ceiling_mat = material("PREVIEW_ComparisonCeiling", (0.41, 0.42, 0.43), 0.82)
    box("PREVIEW_ComparisonCeiling", (10.0, 3.4, 0.05), (0, 0, 0.028), ceiling_mat)
    floor_mat = material("PREVIEW_ComparisonFloor", (0.17, 0.18, 0.19), 0.74)
    box("PREVIEW_ComparisonFloor", (10.0, 4.5, 0.05), (0, 0, -2.0), floor_mat)
    target = (0, 0, -0.63)
    bpy.ops.object.camera_add(location=(0.0, -13.0, -0.82))
    camera = bpy.context.object
    camera.name = "PREVIEW_ComparisonCamera"
    camera.data.lens = 45
    look_at(camera, target)
    bpy.context.scene.camera = camera
    add_area("PREVIEW_ComparisonKey", 2600, 5.5, (-3.2, -4.5, 2.8), target)
    add_area("PREVIEW_ComparisonFill", 1700, 4.5, (4.0, -2.0, 1.0), target)
    scene = bpy.context.scene
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 800
    comparison_source = SOURCE_ROOT / "ceiling_lights_comparison.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(comparison_source), check_existing=False, compress=True)
    set_imported_scene_state(False)
    off_path = PREVIEW_ROOT / "ceiling_lights_progression_off.png"
    render_still(off_path, resolution=(1600, 800))
    set_imported_scene_state(True)
    on_path = PREVIEW_ROOT / "ceiling_lights_progression_on.png"
    render_still(on_path, resolution=(1600, 800))
    return {
        "source": comparison_source.relative_to(REPO).as_posix(),
        "off": off_path.relative_to(REPO).as_posix(),
        "on": on_path.relative_to(REPO).as_posix(),
        "assets": [record["asset"] for record in primary],
    }


def write_reports(records, comparison):
    failures = [
        {"asset": record["asset"], "issues": record["issues"]}
        for record in records if record["issues"]
    ]
    payload = {
        "assetFamily": "Golf Flipper Ceiling Lights",
        "generator": "tools/blender/build_ceiling_lights.py",
        "blenderVersion": bpy.app.version_string,
        "units": "meters",
        "orientation": {"up": "+Z", "front": "-Y", "origin": "ceiling mounting centre"},
        "references": [
            "Designs/Lights/Basic.png", "Designs/Lights/Standard.png",
            "Designs/Lights/Premium.png", "Designs/Lights/High-End.png",
            "Designs/Lights/Luxury.png",
        ],
        "externalAssets": [],
        "externalTextures": [],
        "license": "Original Golf Flipper project-owned procedural geometry; project-owned design references only.",
        "assets": records,
        "comparison": comparison,
        "summary": {
            "assetCount": len(records),
            "progressionAssetCount": sum(1 for record in records if record["progressionPrimary"]),
            "passed": len(records) - len(failures),
            "failed": len(failures),
            "failures": failures,
        },
    }
    MANIFEST_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    REPORT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload


def main():
    ensure_dirs()
    records = []
    for spec in ASSET_SPECS:
        log(f"building {spec['asset']}")
        records.append(build_one(spec))
    comparison = build_comparison(records)
    payload = write_reports(records, comparison)
    print(json.dumps({
        "built": len(records),
        "passed": payload["summary"]["passed"],
        "failed": payload["summary"]["failed"],
        "manifest": MANIFEST_PATH.relative_to(REPO).as_posix(),
        "report": REPORT_PATH.relative_to(REPO).as_posix(),
        "sources": [record["source"] for record in records],
        "exports": [record["exports"]["LOD0"] for record in records],
    }, indent=2), flush=True)
    if payload["summary"]["failed"]:
        raise RuntimeError(f"{payload['summary']['failed']} ceiling-light assets failed Blender validation")


if __name__ == "__main__":
    main()
