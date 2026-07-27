"""Shared original-geometry helpers for Golf Flipper's golf-cart fleet.

The helpers intentionally use only Blender primitives and deterministic mesh
construction.  No downloaded geometry, textures, logos, or manufacturer forms
enter the production assets.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Iterable, Sequence

import bpy
from mathutils import Vector


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.actions,
    ):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)


def rgba(hex_color: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    value = hex_color.lstrip("#")
    return tuple(int(value[index:index + 2], 16) / 255.0 for index in (0, 2, 4)) + (alpha,)


def material(
    name: str,
    color: str,
    roughness: float,
    metallic: float = 0.0,
    *,
    alpha: float = 1.0,
    transmission: float = 0.0,
    emission: str | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = rgba(color, alpha)
    mat.metallic = metallic
    mat.roughness = roughness
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba(color, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Alpha"].default_value = alpha
        transmission_input = bsdf.inputs.get("Transmission Weight") or bsdf.inputs.get("Transmission")
        if transmission_input:
            transmission_input.default_value = transmission
        if emission:
            emission_color = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
            emission_value = bsdf.inputs.get("Emission Strength")
            if emission_color:
                emission_color.default_value = rgba(emission, 1.0)
            if emission_value:
                emission_value.default_value = emission_strength
    if alpha < 1.0:
        try:
            # Smooth blended glass is materially easier to judge in the neutral
            # acceptance rig than a screen-door dither, and glTF preserves the
            # same alpha blend contract used by the browser renderer.
            mat.surface_render_method = "BLENDED"
        except (AttributeError, TypeError):
            try:
                mat.blend_method = "BLEND"
            except AttributeError:
                pass
        mat.use_transparency_overlap = False
    mat["golf_flipper_pbr"] = True
    mat["base_color_hex"] = color.upper()
    mat["roughness"] = roughness
    mat["metallic"] = metallic
    return mat


def assign(obj: bpy.types.Object, mat: bpy.types.Material | None) -> bpy.types.Object:
    if obj.type in {"MESH", "CURVE", "SURFACE"} and mat is not None:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    return obj


def empty(
    name: str,
    location=(0.0, 0.0, 0.0),
    rotation=(0.0, 0.0, 0.0),
    parent: bpy.types.Object | None = None,
    *,
    size: float = 0.10,
    display: str = "PLAIN_AXES",
    props: dict | None = None,
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = display
    obj.empty_display_size = size
    obj.location = location
    obj.rotation_euler = rotation
    if parent is not None:
        obj.parent = parent
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def parent_keep(obj: bpy.types.Object, parent: bpy.types.Object) -> bpy.types.Object:
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    bpy.context.view_layer.update()
    obj.matrix_world = world
    bpy.context.view_layer.update()
    return obj


def apply_mesh(
    obj: bpy.types.Object,
    *,
    bevel: float = 0.0,
    segments: int = 2,
    smooth: bool = False,
) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("Intentional manufactured edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = max(1, segments)
        modifier.limit_method = "ANGLE"
        modifier.angle_limit = math.radians(25)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    obj.select_set(False)
    return obj


def smart_uv(obj: bpy.types.Object, margin: float = 0.025) -> bpy.types.Object:
    if obj.type != "MESH" or not obj.data.polygons:
        return obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        bpy.ops.uv.smart_project(angle_limit=math.radians(58), island_margin=margin)
    except TypeError:
        bpy.ops.uv.smart_project(angle_limit=math.radians(58), margin_method="SCALED", island_margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)
    return obj


def box(
    name: str,
    dimensions: Sequence[float],
    location=(0.0, 0.0, 0.0),
    rotation=(0.0, 0.0, 0.0),
    mat: bpy.types.Material | None = None,
    *,
    bevel: float = 0.0,
    segments: int = 2,
    parent: bpy.types.Object | None = None,
    props: dict | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    apply_mesh(obj, bevel=bevel, segments=segments)
    assign(obj, mat)
    if parent is not None:
        parent_keep(obj, parent)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def cylinder(
    name: str,
    radius: float,
    depth: float,
    location=(0.0, 0.0, 0.0),
    rotation=(0.0, 0.0, 0.0),
    mat: bpy.types.Material | None = None,
    *,
    vertices: int = 20,
    bevel: float = 0.0,
    parent: bpy.types.Object | None = None,
    smooth: bool = True,
    props: dict | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    apply_mesh(obj, bevel=bevel, segments=2, smooth=smooth)
    assign(obj, mat)
    if parent is not None:
        parent_keep(obj, parent)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def torus(
    name: str,
    major_radius: float,
    minor_radius: float,
    location=(0.0, 0.0, 0.0),
    rotation=(0.0, 0.0, 0.0),
    mat: bpy.types.Material | None = None,
    *,
    major_segments: int = 28,
    minor_segments: int = 10,
    parent: bpy.types.Object | None = None,
    props: dict | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=major_segments,
        minor_segments=minor_segments,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    apply_mesh(obj, smooth=True)
    assign(obj, mat)
    if parent is not None:
        parent_keep(obj, parent)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def uv_sphere(
    name: str,
    radius: float,
    location=(0.0, 0.0, 0.0),
    scale=(1.0, 1.0, 1.0),
    mat: bpy.types.Material | None = None,
    *,
    segments: int = 20,
    rings: int = 10,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        radius=radius,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    apply_mesh(obj, smooth=True)
    assign(obj, mat)
    if parent is not None:
        parent_keep(obj, parent)
    return obj


def beam(
    name: str,
    start: Sequence[float],
    end: Sequence[float],
    radius: float,
    mat: bpy.types.Material | None,
    *,
    vertices: int = 12,
    parent: bpy.types.Object | None = None,
    props: dict | None = None,
) -> bpy.types.Object:
    first = Vector(start)
    second = Vector(end)
    delta = second - first
    obj = cylinder(
        name,
        radius,
        delta.length,
        location=(first + second) * 0.5,
        mat=mat,
        vertices=vertices,
        smooth=True,
    )
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(delta.normalized())
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    obj.rotation_mode = "XYZ"
    obj.select_set(False)
    if parent is not None:
        parent_keep(obj, parent)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def join_meshes(name: str, objects: Iterable[bpy.types.Object]) -> bpy.types.Object:
    items = [obj for obj in objects if obj is not None and obj.type == "MESH"]
    if not items:
        raise ValueError(f"join_meshes({name}) received no mesh objects")
    if len(items) == 1:
        items[0].name = name
        items[0].select_set(False)
        return items[0]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in items:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = items[0]
    bpy.ops.object.join()
    result = bpy.context.object
    result.name = name
    result.select_set(False)
    return result


def curve_tube(
    name: str,
    points: Sequence[Sequence[float]],
    radius: float,
    mat: bpy.types.Material | None,
    *,
    parent: bpy.types.Object | None = None,
    resolution: int = 2,
    bevel_resolution: int = 2,
    props: dict | None = None,
) -> bpy.types.Object:
    curve = bpy.data.curves.new(f"{name}_Curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = resolution
    curve.bevel_depth = radius
    curve.bevel_resolution = bevel_resolution
    curve.resolution_u = resolution
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, value in zip(spline.bezier_points, points):
        point.co = value
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    assign(obj, mat)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.name = name
    apply_mesh(obj, smooth=True)
    smart_uv(obj)
    if parent is not None:
        parent_keep(obj, parent)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def _superellipse(angle: float, exponent: float) -> tuple[float, float]:
    cosine = math.cos(angle)
    sine = math.sin(angle)
    power = 2.0 / exponent
    return (
        math.copysign(abs(cosine) ** power, cosine),
        math.copysign(abs(sine) ** power, sine),
    )


def loft_solid(
    name: str,
    sections: Sequence[dict],
    mat: bpy.types.Material | None,
    *,
    radial_segments: int = 16,
    exponent: float = 4.0,
    bevel: float = 0.0,
    parent: bpy.types.Object | None = None,
    props: dict | None = None,
) -> bpy.types.Object:
    """Create a rounded solid from X/Z superellipse rings along Blender Y."""
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for section in sections:
        y = float(section["y"])
        half_width = float(section["width"]) * 0.5
        z_min = float(section["z_min"])
        z_max = float(section["z_max"])
        z_center = (z_min + z_max) * 0.5
        half_height = (z_max - z_min) * 0.5
        local_exp = float(section.get("exponent", exponent))
        for index in range(radial_segments):
            angle = math.tau * index / radial_segments
            x_unit, z_unit = _superellipse(angle, local_exp)
            vertices.append((x_unit * half_width, y, z_center + z_unit * half_height))
    for row in range(len(sections) - 1):
        start = row * radial_segments
        next_start = (row + 1) * radial_segments
        for index in range(radial_segments):
            following = (index + 1) % radial_segments
            faces.append((start + index, start + following, next_start + following, next_start + index))
    faces.append(tuple(reversed(range(radial_segments))))
    last = (len(sections) - 1) * radial_segments
    faces.append(tuple(last + index for index in range(radial_segments)))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign(obj, mat)
    apply_mesh(obj, bevel=bevel, segments=2, smooth=True)
    smart_uv(obj)
    if parent is not None:
        parent_keep(obj, parent)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def descendants(root: bpy.types.Object) -> list[bpy.types.Object]:
    output = [root]
    for child in root.children:
        output.extend(descendants(child))
    return output


def mesh_bounds(objects: Iterable[bpy.types.Object], *, visible_only: bool = False) -> tuple[Vector, Vector]:
    points = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        if visible_only and (obj.hide_render or obj.get("collision_proxy") is True):
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points:
        return Vector(), Vector()
    minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    return minimum, maximum


def triangle_count(objects: Iterable[bpy.types.Object], prefix: str | None = None) -> int:
    total = 0
    for obj in objects:
        if obj.type != "MESH" or (prefix and not obj.name.startswith(prefix)):
            continue
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def export_root(root: bpy.types.Object, path: Path, *, animations: bool = True) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    items = descendants(root)
    for obj in items:
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_animations=animations,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )
    for obj in items:
        obj.select_set(False)


def look_at(obj: bpy.types.Object, target: Sequence[float]) -> None:
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_studio(
    target=(0.0, 0.0, 0.85),
    camera_location=(4.2, 5.2, 2.8),
    *,
    resolution=(1200, 900),
    neutral_hex="777A7A",
) -> bpy.types.Object:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = resolution[0]
    scene.render.resolution_y = resolution[1]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.45
    if scene.world is None:
        scene.world = bpy.data.worlds.new("GolfCart_StudioWorld")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    if background:
        background.inputs["Color"].default_value = rgba(neutral_hex, 1.0)
        background.inputs["Strength"].default_value = 0.45
    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.object
    camera.name = "QA_StudioCamera"
    camera.data.lens = 58
    look_at(camera, target)
    scene.camera = camera
    for name, energy, location, size in (
        ("Key", 1050, (-3.6, 3.6, 6.2), 4.5),
        ("Fill", 650, (4.4, 1.5, 3.8), 4.0),
        ("Rim", 900, (1.0, -4.5, 5.0), 3.5),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = f"QA_{name}"
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size
        look_at(light, target)
    floor_mat = material("QA_NeutralFloor", "555858", 0.92)
    box("QA_StudioFloor", (14.0, 14.0, 0.05), (0.0, 0.0, -0.035), mat=floor_mat, bevel=0.01)
    return camera


def remove_qa_objects() -> None:
    for obj in [item for item in list(bpy.data.objects) if item.name.startswith("QA_")]:
        bpy.data.objects.remove(obj, do_unlink=True)
