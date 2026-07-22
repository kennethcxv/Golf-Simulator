"""Build the Course 1 failing-municipal site and reusable property kit.

Authoritative units are meters. The clubhouse asset is intentionally excluded:
this file produces a separately placeable property GLB whose origin matches the
clubhouse origin (building front is -Y). The site supports twenty parking bays,
two accessible bays, an empty-player clubhouse, and future property expansion.
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
import random
import sys
from collections import Counter
from pathlib import Path

import bpy
from mathutils import Vector


REPO = Path(r"C:\Users\Kenneth\Documents\GitHub\Golf-Flipper-course1-failing-municipal")
ARCH_SCRIPT = REPO / "tools" / "blender" / "build_course1_municipal.py"
SOURCE_DIR = REPO / "asset_sources" / "blender" / "course1_municipal"
CANONICAL_DIR = REPO / "Assets" / "course1_municipal" / "glb"
RUNTIME_DIR = REPO / "vendor" / "models" / "course1_municipal"
TEXTURE_DIR = REPO / "Assets" / "course1_municipal" / "textures"
BLEND_PATH = SOURCE_DIR / "course1_municipal_property_v001.blend"
GLB_NAME = "course1_municipal_property.glb"

SITE_W = 46.0
SITE_D = 52.0
SITE_CENTER_Y = -6.0
LOT_W = 30.5
LOT_D = 19.0
LOT_CENTER_Y = -17.6
LOT_TOP_Z = -0.02
PARKING_SPACES = 20
ACCESSIBLE_SPACES = 2


def load_architecture_helpers():
    spec = importlib.util.spec_from_file_location("course1_architecture_helpers", ARCH_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


arch = load_architecture_helpers()


def value_noise(x: float, y: float, cell: float, seed: int) -> float:
    """Deterministic bilinear value noise without block-shaped hash cells."""
    gx, gy = x / cell, y / cell
    x0, y0 = math.floor(gx), math.floor(gy)
    tx, ty = gx - x0, gy - y0
    tx = tx * tx * (3.0 - 2.0 * tx)
    ty = ty * ty * (3.0 - 2.0 * ty)
    a = arch._hash_noise(x0, y0, seed)
    b = arch._hash_noise(x0 + 1, y0, seed)
    c = arch._hash_noise(x0, y0 + 1, seed)
    d = arch._hash_noise(x0 + 1, y0 + 1, seed)
    ab = a + (b - a) * tx
    cd = c + (d - c) * tx
    return ab + (cd - ab) * ty


def make_site_texture(name: str, mode: str, size: int = 512) -> bpy.types.Image:
    """Generate project-owned, seamless stylized site base color."""
    TEXTURE_DIR.mkdir(parents=True, exist_ok=True)
    path = TEXTURE_DIR / f"{name}.png"
    image = bpy.data.images.new(name, width=size, height=size, alpha=True)
    pixels = [0.0] * (size * size * 4)
    for y in range(size):
        for x in range(size):
            fine = arch._hash_noise(x, y, 177)
            broad = value_noise(x, y, 11.0, 331)
            coarse = value_noise(x, y, 58.0, 991)
            if mode == "asphalt":
                aggregate = 0.145 + broad * 0.045 + (fine - 0.5) * 0.035
                pale_stone = fine > 0.987
                rgb = [aggregate * 0.98, aggregate * 0.96, aggregate * 0.91]
                if pale_stone:
                    rgb = [c + 0.12 for c in rgb]
            elif mode == "grass":
                dry = coarse * 0.08
                green = 0.22 + broad * 0.085 + (fine - 0.5) * 0.025
                rgb = [green * 0.62 + dry, green * 1.05 + dry * 0.6, green * 0.61]
            elif mode == "putting_green":
                # Subtle, repeatable mower bands keep the small practice green
                # visually maintained without making it look like bright felt.
                band = 0.018 if math.sin(math.tau * x / 64.0) > 0.0 else -0.012
                green = 0.205 + broad * 0.045 + (fine - 0.5) * 0.012 + band
                rgb = [green * 0.43, green * 0.94, green * 0.50]
            elif mode == "accessible_blue":
                # A small amount of aggregate-colored abrasion is baked into
                # the field so the paint reads as maintained but not new.
                worn = fine > 0.965 or coarse > 0.90
                blue = 0.18 + broad * 0.035
                rgb = [blue * 0.37, blue * 0.82, blue * 1.04]
                if worn:
                    rgb = [0.18 + broad * 0.025, 0.19 + broad * 0.022,
                           0.19 + broad * 0.020]
            elif mode == "old_wood":
                grain = value_noise(x, y, 22.0, 727)
                value = 0.24 + broad * 0.08 + (grain - 0.5) * 0.055
                rgb = [value * 1.12, value * 0.79, value * 0.48]
            elif mode == "dirt":
                value = 0.25 + broad * 0.10 + (fine - 0.5) * 0.035
                rgb = [value * 1.10, value * 0.83, value * 0.55]
            else:
                value = 0.45 + (fine - 0.5) * 0.08
                rgb = [value, value, value]
            index = (y * size + x) * 4
            pixels[index:index + 4] = [max(0.0, min(1.0, c)) for c in rgb] + [1.0]
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    return image


def smart_uv(obj: bpy.types.Object) -> None:
    if obj.type != "MESH":
        return
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(island_margin=0.035)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)


def planar_uv(obj: bpy.types.Object, meters_per_repeat: float) -> None:
    """Write continuous XY world-scale UVs for broad horizontal surfaces."""
    if obj.type != "MESH":
        return
    mesh = obj.data
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    uv_layer = mesh.uv_layers.new(name="UVMap")
    divisor = max(0.001, meters_per_repeat)
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            vertex = mesh.vertices[vertex_index].co
            uv_layer.data[loop_index].uv = (vertex.x / divisor, vertex.y / divisor)


def organic_pad(name: str, points, z: float, thickness: float, mat,
                target, module: str) -> bpy.types.Object:
    verts = [(x, y, 0.0) for x, y in points]
    mesh = bpy.data.meshes.new(name + "_MESH")
    mesh.from_pydata(verts, [], [tuple(range(len(verts)))])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    obj.location.z = z
    mesh.materials.append(mat)
    arch.tag(obj, module)
    planar_uv(obj, 3.2)
    solidify = obj.modifiers.new("PadThickness", "SOLIDIFY")
    solidify.thickness = thickness
    solidify.offset = -1.0
    bevel = obj.modifiers.new("SoftPerimeter", "BEVEL")
    bevel.width = 0.055
    bevel.segments = 2
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    return obj


def tapered_container(name: str, loc, bottom_dims, top_dims, height: float,
                      mat, target, module: str) -> bpy.types.Object:
    """Create a true tapered utility container instead of a scaled cube."""
    bx, by = bottom_dims[0] / 2.0, bottom_dims[1] / 2.0
    tx, ty = top_dims[0] / 2.0, top_dims[1] / 2.0
    verts = [(-bx, -by, 0.0), (bx, -by, 0.0), (bx, by, 0.0), (-bx, by, 0.0),
             (-tx, -ty, height), (tx, -ty, height), (tx, ty, height), (-tx, ty, height)]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
             (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    mesh = bpy.data.meshes.new(name + "_MESH")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    obj.location = loc
    mesh.materials.append(mat)
    arch.tag(obj, module)
    smart_uv(obj)
    bevel = obj.modifiers.new("ContainerEdgeSoftening", "BEVEL")
    bevel.width = 0.055
    bevel.segments = 2
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    return obj


def create_site_terrain(mats, target) -> None:
    nx, ny = 18, 20
    xmin, xmax = -SITE_W / 2.0, SITE_W / 2.0
    ymin = SITE_CENTER_Y - SITE_D / 2.0
    ymax = SITE_CENTER_Y + SITE_D / 2.0
    verts = []
    rng = random.Random(1401)
    for iy in range(ny + 1):
        y = ymin + (ymax - ymin) * iy / ny
        for ix in range(nx + 1):
            x = xmin + (xmax - xmin) * ix / nx
            edge = min(ix, nx - ix, iy, ny - iy)
            blend = min(1.0, edge / 2.0)
            z = -0.13 + rng.uniform(-0.025, 0.025) * blend - (1.0 - blend) * 0.08
            verts.append((x, y, z))
    faces = []
    for iy in range(ny):
        for ix in range(nx):
            a = iy * (nx + 1) + ix
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    mesh = bpy.data.meshes.new("SITE_GRADE_MESH")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("SITE_GRADED_LAWN", mesh)
    target.objects.link(obj)
    mesh.materials.append(mats["grass"])
    arch.tag(obj, "MOD_GRADED_SITE_TERRAIN")
    # One continuous UV field prevents the visible per-grid-square seams that
    # smart projection created in the earlier composite review.
    planar_uv(obj, 5.0)
    obj["real_dimensions_m"] = [SITE_W, SITE_D]

    # Wear is carried by the blended grass texture and small weed/dry-grass
    # modules. Flat brown polygons failed the first composite visual review and
    # are deliberately excluded from the production asset.


def faded_line(name: str, x: float, y0: float, y1: float, mat, target) -> None:
    """A stripe assembled from offset paint segments, not an unbroken new line."""
    length = y1 - y0
    segments = 4
    gap = 0.18
    segment_length = (length - gap * (segments - 1)) / segments
    rng = random.Random(name)
    for index in range(segments):
        center = y0 + segment_length / 2.0 + index * (segment_length + gap)
        piece = arch.box(f"{name}_SEG_{index}",
                         (0.085 + rng.uniform(-0.008, 0.006),
                          segment_length * rng.uniform(0.88, 1.0), 0.008),
                         (x + rng.uniform(-0.018, 0.018), center, LOT_TOP_Z + 0.008),
                         mat, target, bevel=0.004, module="MOD_FADED_PARKING_STRIPE")
        piece["condition"] = "faded_operational"


def create_accessible_symbol(name: str, x: float, y: float, mats, target) -> None:
    blue = arch.box(f"{name}_BLUE_FIELD", (2.35, 1.65, 0.007),
                    (x, y, LOT_TOP_Z + 0.009), mats["accessible_blue"], target,
                    bevel=0.055, module="MOD_ACCESSIBLE_PAINT_FIELD")
    blue["accessible_marking"] = True
    # Markings sit at paint-film height. Earlier round 35 mm tubes read as
    # raised sculpture from the player camera rather than a road stencil.
    z = LOT_TOP_Z + 0.014
    arch.cylinder(f"{name}_HEAD", 0.105, 0.004, (x - 0.02, y + 0.50, z),
                  mats["stripe"], target, vertices=24,
                  module="MOD_ACCESSIBLE_SYMBOL")
    arch.curve_tube(f"{name}_BODY", [(x - 0.02, y + 0.35, z),
                                      (x - 0.02, y - 0.05, z),
                                      (x + 0.28, y - 0.17, z)],
                    0.012, mats["stripe"], target, "MOD_ACCESSIBLE_SYMBOL")
    arch.curve_tube(f"{name}_ARM", [(x - 0.02, y + 0.20, z),
                                     (x + 0.28, y + 0.14, z)],
                    0.012, mats["stripe"], target, "MOD_ACCESSIBLE_SYMBOL")
    wheel_points = []
    for step in range(17):
        angle = math.radians(215 + step * 16)
        wheel_points.append((x + 0.03 + math.cos(angle) * 0.34,
                             y - 0.18 + math.sin(angle) * 0.34, z))
    arch.curve_tube(f"{name}_WHEEL", wheel_points, 0.012, mats["stripe"], target,
                    "MOD_ACCESSIBLE_SYMBOL")


def create_parking_and_walks(mats, target, collision) -> None:
    lot = arch.box("PARKING_ASPHALT_FIELD", (LOT_W, LOT_D, 0.12),
                   (0.0, LOT_CENTER_Y, LOT_TOP_Z - 0.06), mats["asphalt"], target,
                   bevel=0.10, module="MOD_PARKING_ASPHALT_FIELD")
    arch.scale_uv(lot, LOT_W / 4.0, LOT_D / 4.0)
    lot["parking_spaces"] = PARKING_SPACES

    # Ten near-building spaces: a standards-scaled pair of 2.65 m accessible
    # stalls shares one explicit 1.50 m transfer aisle.
    near_items = ([('space', 2.70)] * 6 + [('accessible', 2.65), ('aisle', 1.50),
                  ('accessible', 2.65)] + [('space', 2.70)] * 2)
    cursor = -sum(width for _, width in near_items) / 2.0
    near_centers = []
    accessible_centers = []
    transfer_aisle_center = None
    near_boundaries = [cursor]
    for kind, width in near_items:
        center = cursor + width / 2.0
        if kind != 'aisle':
            near_centers.append(center)
        if kind == 'accessible':
            accessible_centers.append(center)
        elif kind == 'aisle':
            transfer_aisle_center = center
        cursor += width
        near_boundaries.append(cursor)
    for index, x in enumerate(near_boundaries):
        faded_line(f"PARKING_NEAR_BOUNDARY_{index:02d}", x, -14.30, -9.25,
                   mats["stripe"], target)

    # Ten standard far-row bays centered inside the same paved width.
    far_width = 2.82
    far_start = -far_width * 5.0
    far_boundaries = [far_start + index * far_width for index in range(11)]
    far_centers = [far_start + (index + 0.5) * far_width for index in range(10)]
    for index, x in enumerate(far_boundaries):
        faded_line(f"PARKING_FAR_BOUNDARY_{index:02d}", x, -25.95, -20.90,
                   mats["stripe"], target)

    accessible_indices = (6, 7)
    for ordinal, center in enumerate(accessible_centers):
        create_accessible_symbol(f"ACCESSIBLE_BAY_{ordinal + 1}", center,
                                 -11.75, mats, target)
        arch.cylinder(f"ACCESSIBLE_SIGN_POLE_{ordinal}", 0.027, 1.45,
                      (center, -9.03, 0.72), mats["aluminum"], target,
                      vertices=16, module="MOD_ACCESSIBLE_SIGN_POLE")
        arch.box(f"ACCESSIBLE_SIGN_PANEL_{ordinal}", (0.52, 0.035, 0.60),
                 (center, -9.055, 1.40), mats["accessible_blue"], target,
                 bevel=0.035, module="MOD_ACCESSIBLE_SIGN_PANEL")
        arch.text_mesh(f"ACCESSIBLE_SIGN_TEXT_{ordinal}", "RESERVED",
                       (center, -9.078, 1.40), 0.070, mats["stripe"], target,
                       extrude=0.003)
    for stripe_index in range(6):
        y = -13.78 + stripe_index * 0.83
        arch.box(f"ACCESS_AISLE_HATCH_{stripe_index}", (1.05, 0.055, 0.004),
                 (transfer_aisle_center, y, LOT_TOP_Z + 0.009), mats["stripe"], target,
                 bevel=0.003, module="MOD_ACCESS_AISLE_HATCH",
                 rotation=(0.0, 0.0, math.radians(38)))

    # Concrete wheel stops remain separate replaceable modules.
    for row_name, centers, y in (("NEAR", near_centers, -9.78),
                                 ("FAR", far_centers, -21.42)):
        for index, x in enumerate(centers):
            if row_name == "NEAR" and index in accessible_indices:
                continue
            stop = arch.box(f"WHEEL_STOP_{row_name}_{index:02d}", (1.72, 0.19, 0.13),
                            (x, y, LOT_TOP_Z + 0.065), mats["concrete"], target,
                            bevel=0.035, module="MOD_CONCRETE_WHEEL_STOP")
            stop.rotation_euler.z = math.radians((-0.5 if index % 4 == 0 else 0.0))

    # Modular walk panels connect porch, ramp, accessible parking and service.
    walk_y = -8.18
    for index in range(11):
        x = -7.50 + index * 1.50
        panel = arch.box(f"FRONT_WALK_PANEL_{index:02d}", (1.47, 1.48, 0.11),
                         (x, walk_y, 0.025), mats[f"concrete_{index % 3}"], target,
                         bevel=0.018, module="MOD_SIDEWALK_PANEL_1500")
        panel["real_dimensions_m"] = [1.47, 1.48, 0.11]
    # Replaceable connector slabs close the landscaped trench between the
    # clubhouse ramp, public walk, and curb ramp while keeping visible joints.
    for name, dims, loc, mat_key in (
        ("RAMP_WALK_CONNECTOR_A", (1.44, 0.74, 0.10), (4.70, -7.73, 0.022), "concrete_1"),
        ("RAMP_WALK_CONNECTOR_B", (1.38, 0.74, 0.10), (5.88, -8.42, 0.020), "concrete_0"),
    ):
        panel = arch.box(name, dims, loc, mats[mat_key], target,
                         bevel=0.018, module="MOD_SIDEWALK_CONNECTOR")
        panel["real_dimensions_m"] = list(dims)
    arch.box("ACCESSIBLE_CURB_RAMP", (2.05, 1.35, 0.10),
             (6.05, -9.22, 0.015), mats["concrete_1"], target,
             bevel=0.025, module="MOD_ACCESSIBLE_CURB_RAMP",
             rotation=(math.radians(2.5), 0.0, 0.0))
    arch.box("CURB_RAMP_TACTILE_FIELD", (1.82, 0.62, 0.016),
             (6.05, -9.69, 0.073), mats["warning_yellow"], target,
             bevel=0.025, module="MOD_TACTILE_WARNING_FIELD")
    for row in range(4):
        for column in range(9):
            arch.cylinder(f"TACTILE_DOME_{row:02d}_{column:02d}", 0.027, 0.018,
                          (5.33 + column * 0.18, -9.90 + row * 0.14, 0.090),
                          mats["warning_yellow"], target, vertices=12,
                          module="MOD_TACTILE_WARNING_DOME")

    # Aged curbs define the lot without sealing future expansion edges.
    arch.box("LOT_CURB_WEST", (0.18, LOT_D - 1.2, 0.18),
             (-LOT_W / 2.0 - 0.02, LOT_CENTER_Y, 0.015), mats["concrete_2"], target,
             bevel=0.025, module="MOD_PARKING_CURB")
    arch.box("LOT_CURB_EAST", (0.18, LOT_D - 4.2, 0.18),
             (LOT_W / 2.0 + 0.02, LOT_CENTER_Y + 1.5, 0.015), mats["concrete_2"], target,
             bevel=0.025, module="MOD_PARKING_CURB")
    arch.box("LOT_CURB_SOUTH", (LOT_W - 2.8, 0.18, 0.18),
             (-1.4, LOT_CENTER_Y - LOT_D / 2.0, 0.015), mats["concrete_2"], target,
             bevel=0.025, module="MOD_PARKING_CURB")

    # Entry apron at the southeast corner remains open to the municipal road.
    apron = arch.box("PARKING_ENTRY_APRON", (5.2, 7.2, 0.12),
                     (12.2, -29.0, LOT_TOP_Z - 0.06), mats["asphalt"], target,
                     bevel=0.10, module="MOD_ENTRY_DRIVE_APRON")
    arch.scale_uv(apron, 2.0, 2.7)

    cracks = [
        [(-12.5, -18.0, LOT_TOP_Z + 0.002), (-10.8, -17.5, LOT_TOP_Z + 0.002), (-9.4, -18.1, LOT_TOP_Z + 0.002), (-7.8, -17.8, LOT_TOP_Z + 0.002)],
        [(1.8, -23.7, LOT_TOP_Z + 0.002), (3.1, -22.9, LOT_TOP_Z + 0.002), (4.7, -23.3, LOT_TOP_Z + 0.002), (5.8, -22.4, LOT_TOP_Z + 0.002)],
        [(9.0, -15.8, LOT_TOP_Z + 0.002), (10.2, -16.4, LOT_TOP_Z + 0.002), (11.5, -16.0, LOT_TOP_Z + 0.002)],
        [(-4.0, -10.1, LOT_TOP_Z + 0.002), (-3.1, -11.0, LOT_TOP_Z + 0.002), (-2.2, -11.4, LOT_TOP_Z + 0.002)],
    ]
    for index, points in enumerate(cracks):
        arch.curve_tube(f"PARKING_CRACK_{index}", points, 0.004, mats["asphalt_crack"],
                        target, "MOD_ASPHALT_CRACK")

    for name, dims, loc in (
        ("COL_FRONT_WALK", (16.5, 1.5, 0.12), (0.0, walk_y, 0.025)),
        ("COL_CURB_RAMP", (2.05, 1.35, 0.10), (6.05, -9.22, 0.015)),
    ):
        proxy = arch.box(name, dims, loc, mats["collision"], collision,
                         bevel=0.0, module="COL_WALKABLE", collision=True)
        proxy.hide_render = True


def create_cart_path(mats, target) -> None:
    points = [(-14.0, -10.0), (-15.4, -7.0), (-15.1, -3.4), (-13.5, 0.2),
              (-12.8, 4.2), (-10.8, 7.0)]
    for index, ((x0, y0), (x1, y1)) in enumerate(zip(points, points[1:])):
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy)
        angle = math.atan2(dy, dx)
        segment = arch.box(f"CART_PATH_SEGMENT_{index:02d}", (length + 0.45, 2.55, 0.09),
                           ((x0 + x1) / 2.0, (y0 + y1) / 2.0, -0.025),
                           mats["cart_path"], target, bevel=0.30,
                           module="MOD_CART_PATH_2500", rotation=(0.0, 0.0, angle))
        arch.scale_uv(segment, max(1.0, length / 2.0), 1.2)


def create_putting_green(mats, target) -> None:
    cx, cy = -12.8, 10.0
    points = []
    for step in range(24):
        angle = math.tau * step / 24.0
        radius_x = 4.6 * (1.0 + 0.05 * math.sin(angle * 3.0))
        radius_y = 3.3 * (1.0 + 0.06 * math.cos(angle * 2.0))
        points.append((cx + math.cos(angle) * radius_x,
                       cy + math.sin(angle) * radius_y))
    green = organic_pad("PRACTICE_PUTTING_GREEN", points, -0.015, 0.09,
                        mats["putting_green"], target, "MOD_PRACTICE_GREEN")
    green["practice_only"] = True
    arch.cylinder("PUTTING_CUP_COLLAR", 0.075, 0.016, (cx + 1.0, cy + 0.4, 0.006),
                  mats["cup"], target, vertices=28, module="MOD_PRACTICE_CUP")
    arch.cylinder("PUTTING_FLAGSTICK", 0.018, 2.25, (cx + 1.0, cy + 0.4, 1.12),
                  mats["flagpole"], target, vertices=16, module="MOD_PRACTICE_FLAGSTICK")
    create_wavy_flag("PUTTING_FLAG", (cx + 1.02, cy + 0.4, 1.95), 0.82, 0.48,
                     mats["flag_green"], target, "MOD_PRACTICE_FLAG")


def create_wavy_flag(name: str, loc, width: float, height: float, mat, target,
                     module: str) -> bpy.types.Object:
    cols, rows = 6, 3
    verts = []
    for row in range(rows + 1):
        z = height * (0.5 - row / rows)
        for col in range(cols + 1):
            x = width * col / cols
            y = math.sin(col / cols * math.pi * 2.2) * 0.045 * (col / cols)
            verts.append((x, y, z))
    faces = []
    for row in range(rows):
        for col in range(cols):
            a = row * (cols + 1) + col
            faces.append((a, a + 1, a + cols + 2, a + cols + 1))
    mesh = bpy.data.meshes.new(name + "_MESH")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    obj.location = loc
    mesh.materials.append(mat)
    arch.tag(obj, module)
    smart_uv(obj)
    solidify = obj.modifiers.new("FlagClothThickness", "SOLIDIFY")
    solidify.thickness = 0.004
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    return obj


def create_bench_and_trash(mats, target) -> None:
    bx, by = -5.7, -7.35
    for index, z in enumerate((0.46, 0.59, 0.72)):
        arch.box(f"BENCH_BACK_SLAT_{index}", (1.75, 0.075, 0.10), (bx, by + 0.20, z),
                 mats["oak"], target, bevel=0.018, module="MOD_BENCH_WOOD_SLAT")
    for index, y in enumerate((by - 0.18, by - 0.02, by + 0.14)):
        arch.box(f"BENCH_SEAT_SLAT_{index}", (1.75, 0.12, 0.075), (bx, y, 0.48),
                 mats["oak"], target, bevel=0.018, module="MOD_BENCH_WOOD_SLAT")
    for side in (-1, 1):
        x = bx + side * 0.68
        arch.curve_tube(f"BENCH_FRAME_{side:+d}",
                        [(x, by - 0.22, 0.10), (x, by - 0.22, 0.48),
                         (x, by + 0.20, 0.48), (x, by + 0.20, 0.82)],
                        0.035, mats["warm_charcoal"], target, "MOD_BENCH_METAL_FRAME")
    arch.cylinder("TRASH_CAN_BODY", 0.27, 0.78, (-7.05, by, 0.39),
                  mats["trash_green"], target, vertices=32, module="MOD_PUBLIC_TRASH_CAN")
    arch.cylinder("TRASH_CAN_RIM", 0.30, 0.07, (-7.05, by, 0.79),
                  mats["warm_charcoal"], target, vertices=32, module="MOD_PUBLIC_TRASH_CAN")
    arch.cylinder("TRASH_CAN_OPENING", 0.20, 0.018, (-7.05, by, 0.83),
                  mats["void"], target, vertices=32, module="MOD_PUBLIC_TRASH_CAN")


def create_road_sign_and_flagpole(mats, target) -> None:
    sx, sy = -9.3, -27.8
    for side in (-1, 1):
        arch.box(f"ROADSIDE_SIGN_POST_{side:+d}", (0.18, 0.18, 2.25),
                 (sx + side * 1.55, sy, 1.00), mats["sign_post"], target,
                 bevel=0.018, module="MOD_SIGN_POST")
        arch.box(f"ROADSIDE_SIGN_FOOT_{side:+d}", (0.55, 0.48, 0.18),
                 (sx + side * 1.55, sy, 0.02), mats["concrete_1"], target,
                 bevel=0.035, module="MOD_SIGN_FOOTING")
    arch.box("ROADSIDE_SIGN_PANEL", (3.55, 0.14, 1.30), (sx, sy, 1.55),
             mats["sign_green"], target, bevel=0.085, module="MOD_ROADSIDE_SIGN_PANEL")
    arch.box("ROADSIDE_SIGN_INSET", (3.24, 0.025, 0.98), (sx, sy - 0.083, 1.55),
             mats["sign_green_faded"], target, bevel=0.055, module="MOD_ROADSIDE_SIGN_INSET")
    arch.text_mesh("ROADSIDE_SIGN_TITLE", "PINE HILLS", (sx, sy - 0.102, 1.78),
                   0.31, mats["sign_letter"], target, extrude=0.008)
    arch.text_mesh("ROADSIDE_SIGN_SUBTITLE", "MUNICIPAL GOLF", (sx, sy - 0.104, 1.44),
                   0.15, mats["sign_letter"], target, extrude=0.006)
    arch.text_mesh("ROADSIDE_SIGN_PUBLIC", "PUBLIC COURSE", (sx, sy - 0.106, 1.18),
                   0.105, mats["sign_letter"], target, extrude=0.004)

    fx, fy = -7.2, -8.05
    arch.cylinder("MUNICIPAL_FLAGPOLE", 0.045, 7.2, (fx, fy, 3.55),
                  mats["flagpole"], target, vertices=24, module="MOD_FLAGPOLE")
    arch.cylinder("FLAGPOLE_FINIAL", 0.09, 0.16, (fx, fy, 7.22),
                  mats["brass"], target, vertices=20, module="MOD_FLAGPOLE_FINIAL")
    arch.cylinder("FLAGPOLE_BASE", 0.28, 0.28, (fx, fy, 0.05),
                  mats["concrete_1"], target, vertices=28, module="MOD_FLAGPOLE_BASE")
    create_wavy_flag("MUNICIPAL_COURSE_FLAG", (fx + 0.04, fy, 6.45), 1.55, 0.88,
                     mats["flag_green"], target, "MOD_MUNICIPAL_FLAG")


def create_hinged_leaf(name: str, hinge, width: float, height: float, direction: int,
                       mat, target, module: str) -> bpy.types.Object:
    x0, x1 = ((0.0, width) if direction > 0 else (-width, 0.0))
    verts = [(x, y, z) for z in (0.0, height) for y in (-0.035, 0.035) for x in (x0, x1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1),
             (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    mesh = bpy.data.meshes.new(name + "_MESH")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    obj.location = hinge
    mesh.materials.append(mat)
    arch.tag(obj, module)
    obj["pivot_contract"] = "physical_hinge_axis"
    obj["hinge_axis"] = "local_z"
    obj["swing_degrees"] = 105.0
    smart_uv(obj)
    bevel = obj.modifiers.new("DoorEdgeSoftening", "BEVEL")
    bevel.width = 0.012
    bevel.segments = 2
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    return obj


def create_hinged_lid(name: str, hinge_center, width: float, depth: float,
                       mat, target) -> bpy.types.Object:
    """Create a horizontal lid with its origin on the full rear hinge edge."""
    x0, x1 = -width / 2.0, width / 2.0
    y0, y1 = -depth, 0.0
    z0, z1 = -0.025, 0.025
    verts = [(x, y, z) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1),
             (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    mesh = bpy.data.meshes.new(name + "_MESH")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    obj.location = hinge_center
    mesh.materials.append(mat)
    arch.tag(obj, "MOD_DUMPSTER_HINGED_LID")
    obj["pivot_contract"] = "physical_rear_hinge_edge"
    obj["hinge_axis"] = "local_x"
    obj["swing_degrees"] = 82.0
    smart_uv(obj)
    bevel = obj.modifiers.new("LidEdgeSoftening", "BEVEL")
    bevel.width = 0.018
    bevel.segments = 2
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    return obj


def create_maintenance_shed(mats, target, collision) -> None:
    cx, cy = 10.0, 10.8
    width, depth = 5.2, 4.2
    floor_z, eave_z = -0.02, 2.65
    arch.box("SHED_CONCRETE_PAD", (width + 0.55, depth + 0.70, 0.14),
             (cx, cy - 0.10, -0.055), mats["concrete_2"], target,
             bevel=0.035, module="MOD_SHED_FOUNDATION")
    # Rear and side wall panels are separate 1.3 m serviceable modules.
    for side in (-1, 1):
        x = cx + side * width / 2.0
        for index in range(3):
            y = cy - depth / 2.0 + (index + 0.5) * depth / 3.0
            arch.box(f"SHED_SIDE_{side:+d}_{index}", (0.16, depth / 3.0 - 0.02, eave_z),
                     (x, y, eave_z / 2.0), mats["shed_siding"], target,
                     bevel=0.006, module="MOD_SHED_WALL_PANEL")
    for index in range(4):
        x = cx - width / 2.0 + (index + 0.5) * width / 4.0
        arch.box(f"SHED_BACK_{index}", (width / 4.0 - 0.02, 0.16, eave_z),
                 (x, cy + depth / 2.0, eave_z / 2.0), mats["shed_siding"], target,
                 bevel=0.006, module="MOD_SHED_WALL_PANEL")
    door_w = 2.65
    side_run = (width - door_w) / 2.0
    for side in (-1, 1):
        x = cx + side * (door_w / 2.0 + side_run / 2.0)
        arch.box(f"SHED_FRONT_WALL_{side:+d}", (side_run, 0.16, eave_z),
                 (x, cy - depth / 2.0, eave_z / 2.0), mats["shed_siding"], target,
                 bevel=0.006, module="MOD_SHED_WALL_PANEL")
    arch.box("SHED_FRONT_HEADER", (door_w, 0.16, 0.45),
             (cx, cy - depth / 2.0, 2.425), mats["shed_siding"], target,
             bevel=0.006, module="MOD_SHED_WALL_HEADER")
    # Physical board-and-batten rhythm, corner boards and door casing keep the
    # small utility building in the same modular language as the clubhouse.
    for side in (-1, 1):
        x = cx + side * (width / 2.0 + 0.095)
        for index in range(9):
            y = cy - depth / 2.0 + 0.25 + index * 0.46
            arch.box(f"SHED_SIDE_BATTEN_{side:+d}_{index:02d}",
                     (0.045, 0.060, eave_z - 0.08), (x, y, eave_z / 2.0),
                     mats["shed_siding"], target, bevel=0.006,
                     module="MOD_SHED_SIDING_BATTEN")
    for face, y in (("BACK", cy + depth / 2.0 + 0.095),
                    ("FRONT", cy - depth / 2.0 - 0.095)):
        for index in range(11):
            x = cx - width / 2.0 + 0.26 + index * 0.47
            if face == "FRONT" and abs(x - cx) < door_w / 2.0 + 0.08:
                continue
            arch.box(f"SHED_{face}_BATTEN_{index:02d}",
                     (0.060, 0.045, eave_z - 0.08), (x, y, eave_z / 2.0),
                     mats["shed_siding"], target, bevel=0.006,
                     module="MOD_SHED_SIDING_BATTEN")
    for sx in (-1, 1):
        for sy in (-1, 1):
            arch.box(f"SHED_CORNER_TRIM_{sx:+d}_{sy:+d}", (0.16, 0.16, eave_z + 0.08),
                     (cx + sx * width / 2.0, cy + sy * depth / 2.0, eave_z / 2.0),
                     mats["shed_trim"], target, bevel=0.010,
                     module="MOD_SHED_CORNER_TRIM")
    front_y = cy - depth / 2.0 - 0.075
    for side in (-1, 1):
        arch.box(f"SHED_DOOR_JAMB_{side:+d}", (0.11, 0.24, 2.31),
                 (cx + side * (door_w / 2.0 + 0.045), front_y, 1.105),
                 mats["shed_trim"], target, bevel=0.010, module="MOD_SHED_DOOR_CASING")
    arch.box("SHED_DOOR_HEAD", (door_w + 0.20, 0.24, 0.12),
             (cx, front_y, 2.26), mats["shed_trim"], target,
             bevel=0.010, module="MOD_SHED_DOOR_CASING")
    left = create_hinged_leaf("SHED_DOOR_LEFT", (cx - door_w / 2.0 + 0.04,
                              cy - depth / 2.0 - 0.05, 0.0), door_w / 2.0 - 0.05,
                              2.20, 1, mats["shed_door"], target, "MOD_SHED_HINGED_DOOR")
    right = create_hinged_leaf("SHED_DOOR_RIGHT", (cx + door_w / 2.0 - 0.04,
                               cy - depth / 2.0 - 0.05, 0.0), door_w / 2.0 - 0.05,
                               2.20, -1, mats["shed_door"], target, "MOD_SHED_HINGED_DOOR")
    left["door_id"], right["door_id"] = "shed_left", "shed_right"
    for leaf, direction in ((left, 1), (right, -1)):
        for rail_index, z in enumerate((0.38, 1.10, 1.82)):
            panel = arch.box(f"{leaf.name}_RAIL_{rail_index}",
                             (door_w / 2.0 - 0.22, 0.035, 0.095),
                             (leaf.location.x + direction * (door_w / 4.0 - 0.02),
                              leaf.location.y - 0.05, z), mats["shed_trim"], target,
                             bevel=0.008, module="MOD_SHED_DOOR_RAIL")
            panel.parent = leaf
            panel.matrix_parent_inverse = leaf.matrix_world.inverted()
        handle = arch.cylinder(f"{leaf.name}_HANDLE", 0.026, 0.13,
                               (leaf.location.x + direction * (door_w / 2.0 - 0.22),
                                leaf.location.y - 0.09, 1.06), mats["brass"], target,
                               vertices=16, module="MOD_SHED_DOOR_HANDLE",
                               rotation=(math.radians(90), 0.0, 0.0))
        handle.parent = leaf
        handle.matrix_parent_inverse = leaf.matrix_world.inverted()
    arch.box("SHED_ENTRY_APRON", (3.20, 1.05, 0.10),
             (cx, cy - depth / 2.0 - 0.55, -0.005), mats["concrete_1"], target,
             bevel=0.025, module="MOD_SHED_ENTRY_APRON")
    arch.box("SHED_DOOR_LIGHT_BACKPLATE", (0.18, 0.08, 0.24),
             (cx, cy - depth / 2.0 - 0.14, 2.47), mats["warm_charcoal"], target,
             bevel=0.018, module="MOD_SHED_EXTERIOR_LIGHT")
    arch.cylinder("SHED_DOOR_LIGHT_GLOBE", 0.085, 0.14,
                  (cx, cy - depth / 2.0 - 0.20, 2.31), mats["exterior_globe"], target,
                  vertices=20, module="MOD_SHED_EXTERIOR_LIGHT",
                  rotation=(math.radians(90), 0.0, 0.0))

    rise = width / 2.0 * 0.30
    ridge_z = eave_z + rise
    roof_run = width / 2.0 + 0.35
    roof_depth = depth + 0.75
    slope = math.hypot(roof_run, roof_run * 0.30)
    angle = math.atan(0.30)
    z = ridge_z - roof_run * 0.30 / 2.0
    for side in (-1, 1):
        roof = arch.box(f"SHED_ROOF_{side:+d}", (slope, roof_depth, 0.09),
                        (cx + side * roof_run / 2.0, cy, z), mats["shed_roof"], target,
                        bevel=0.007, module="MOD_SHED_ROOF_FIELD",
                        rotation=(0.0, side * angle, 0.0))
        arch.scale_uv(roof, slope / 1.3, roof_depth / 1.3)
    arch.box("SHED_RIDGE", (0.18, roof_depth + 0.04, 0.11),
             (cx, cy, ridge_z + 0.025), mats["shed_roof"], target,
             bevel=0.018, module="MOD_SHED_ROOF_RIDGE")
    outer_eave_z = ridge_z - roof_run * 0.30
    for side, label in ((-1, "WEST"), (1, "EAST")):
        eave_x = cx + side * roof_run
        arch.box(f"SHED_EAVE_FASCIA_{label}", (0.085, roof_depth, 0.16),
                 (eave_x, cy, outer_eave_z), mats["shed_trim"], target,
                 bevel=0.008, module="MOD_SHED_ROOF_FASCIA")
        arch.curve_tube(f"SHED_GUTTER_{label}",
                        [(eave_x + side * 0.055, cy - roof_depth / 2.0 + 0.08,
                          outer_eave_z - 0.09),
                         (eave_x + side * 0.055, cy + roof_depth / 2.0 - 0.08,
                          outer_eave_z - 0.09)],
                        0.035, mats["aluminum"], target, "MOD_SHED_GUTTER")
    for face, y in (("FRONT", cy - roof_depth / 2.0),
                    ("BACK", cy + roof_depth / 2.0)):
        for side in (-1, 1):
            arch.curve_tube(f"SHED_RAKE_{face}_{side:+d}",
                            [(cx, y, ridge_z),
                             (cx + side * width / 2.0, y, eave_z)],
                            0.038, mats["shed_trim"], target, "MOD_SHED_RAKE_TRIM")
    # Final louvered vent on the west side.
    arch.box("SHED_VENT_RECESS", (0.025, 0.78, 0.55),
             (cx - width / 2.0 - 0.09, cy + 0.55, 1.65), mats["void"], target,
             bevel=0.010, module="MOD_SHED_VENT")
    for index in range(5):
        arch.box(f"SHED_VENT_LOUVER_{index}", (0.06, 0.65, 0.045),
                 (cx - width / 2.0 - 0.12, cy + 0.55,
                  1.45 + index * 0.10), mats["aluminum"], target,
                 bevel=0.006, module="MOD_SHED_VENT_LOUVER")
    for name, dims, loc in (
        ("COL_SHED_WEST", (0.18, depth, eave_z), (cx - width / 2.0, cy, eave_z / 2.0)),
        ("COL_SHED_EAST", (0.18, depth, eave_z), (cx + width / 2.0, cy, eave_z / 2.0)),
        ("COL_SHED_BACK", (width, 0.18, eave_z), (cx, cy + depth / 2.0, eave_z / 2.0)),
    ):
        proxy = arch.box(name, dims, loc, mats["collision"], collision,
                         bevel=0.0, module="COL_SHED", collision=True)
        proxy.hide_render = True


def create_utilities_and_dumpster(mats, target) -> None:
    # Rear loading pad and building-mounted electrical infrastructure.
    for index in range(4):
        arch.box(f"LOADING_PAD_PANEL_{index}", (1.45, 1.45, 0.12),
                 (3.95, 5.75 + index * 1.43, -0.01), mats[f"concrete_{index % 3}"],
                 target, bevel=0.020, module="MOD_LOADING_PAD_PANEL")
    arch.box("ELECTRICAL_SERVICE_PANEL", (0.78, 0.18, 1.15),
             (2.15, 5.01, 1.20), mats["utility_green"], target,
             bevel=0.035, module="MOD_ELECTRICAL_SERVICE_PANEL")
    arch.box("ELECTRICAL_PANEL_DOOR", (0.66, 0.035, 1.02),
             (2.15, 4.90, 1.20), mats["utility_green_light"], target,
             bevel=0.022, module="MOD_ELECTRICAL_PANEL_DOOR")
    for index in range(3):
        arch.cylinder(f"ELECTRICAL_CONDUIT_{index}", 0.022, 1.05,
                      (1.88 + index * 0.16, 4.96, 2.27), mats["aluminum"], target,
                      vertices=14, module="MOD_ELECTRICAL_CONDUIT")

    # HVAC condenser with real grille depth and raised fan guard.
    hx, hy = -0.25, 5.35
    arch.box("HVAC_CONDENSER_BODY", (1.15, 0.82, 1.05), (hx, hy, 0.55),
             mats["hvac_body"], target, bevel=0.065, module="MOD_HVAC_CONDENSER")
    arch.box("HVAC_FRONT_RECESS", (0.92, 0.035, 0.78), (hx, hy - 0.43, 0.56),
             mats["void"], target, bevel=0.055, module="MOD_HVAC_GRILLE_RECESS")
    for index in range(9):
        arch.box(f"HVAC_GRILLE_VERTICAL_{index}", (0.025, 0.045, 0.70),
                 (hx - 0.40 + index * 0.10, hy - 0.46, 0.56), mats["aluminum"], target,
                 bevel=0.004, module="MOD_HVAC_GRILLE_BAR")
    for index in range(7):
        arch.box(f"HVAC_GRILLE_HORIZONTAL_{index}", (0.86, 0.045, 0.022),
                 (hx, hy - 0.465, 0.29 + index * 0.09), mats["aluminum"], target,
                 bevel=0.004, module="MOD_HVAC_GRILLE_BAR")
    arch.cylinder("HVAC_TOP_FAN_GUARD", 0.34, 0.035, (hx, hy, 1.095),
                  mats["warm_charcoal"], target, vertices=32, module="MOD_HVAC_FAN_GUARD")

    # Three-sided timber dumpster enclosure with separately hinged gates.
    cx, cy = 9.8, 3.5
    arch.box("DUMPSTER_PAD", (4.2, 3.5, 0.12), (cx, cy, -0.03),
             mats["concrete_2"], target, bevel=0.035, module="MOD_DUMPSTER_PAD")
    for side, x in ((-1, cx - 2.0), (1, cx + 2.0)):
        for index in range(9):
            y = cy - 1.50 + index * 0.36
            arch.box(f"DUMPSTER_SCREEN_SIDE_{side:+d}_{index}", (0.14, 0.29, 1.95),
                     (x, y, 0.95), mats["screen_wood"], target,
                     bevel=0.012, module="MOD_DUMPSTER_SCREEN_SLAT")
    for index in range(11):
        x = cx - 1.80 + index * 0.36
        arch.box(f"DUMPSTER_SCREEN_BACK_{index}", (0.29, 0.14, 1.95),
                 (x, cy + 1.60, 0.95), mats["screen_wood"], target,
                 bevel=0.012, module="MOD_DUMPSTER_SCREEN_SLAT")
    for side in (-1, 1):
        arch.box(f"DUMPSTER_GATE_POST_{side:+d}", (0.22, 0.22, 2.10),
                 (cx + side * 2.0, cy - 1.58, 1.00), mats["warm_charcoal"], target,
                 bevel=0.018, module="MOD_DUMPSTER_GATE_POST")
    left = create_hinged_leaf("DUMPSTER_GATE_LEFT", (cx - 1.93, cy - 1.58, 0.0),
                              1.90, 1.90, 1, mats["dumpster_dark"], target,
                              "MOD_DUMPSTER_HINGED_GATE")
    right = create_hinged_leaf("DUMPSTER_GATE_RIGHT", (cx + 1.93, cy - 1.58, 0.0),
                               1.90, 1.90, -1, mats["dumpster_dark"], target,
                               "MOD_DUMPSTER_HINGED_GATE")
    left["door_id"], right["door_id"] = "dumpster_gate_left", "dumpster_gate_right"
    for leaf, direction in ((left, 1), (right, -1)):
        for index in range(8):
            fraction = (index + 0.5) / 8.0
            slat = arch.box(f"{leaf.name}_SLAT_{index:02d}", (0.17, 0.055, 1.72),
                            (leaf.location.x + direction * fraction * 1.90,
                             leaf.location.y - 0.055, 0.95), mats["screen_wood"], target,
                            bevel=0.010, module="MOD_DUMPSTER_GATE_SLAT")
            slat.parent = leaf
            slat.matrix_parent_inverse = leaf.matrix_world.inverted()
        for index, z in enumerate((0.18, 0.95, 1.72)):
            rail = arch.box(f"{leaf.name}_RAIL_{index}", (1.82, 0.075, 0.12),
                            (leaf.location.x + direction * 0.95,
                             leaf.location.y - 0.075, z), mats["warm_charcoal"], target,
                            bevel=0.010, module="MOD_DUMPSTER_GATE_RAIL")
            rail.parent = leaf
            rail.matrix_parent_inverse = leaf.matrix_world.inverted()
        handle = arch.cylinder(f"{leaf.name}_HANDLE", 0.025, 0.14,
                               (leaf.location.x + direction * 1.72,
                                leaf.location.y - 0.13, 1.02), mats["brass"], target,
                               vertices=16, module="MOD_DUMPSTER_GATE_HANDLE",
                               rotation=(math.radians(90), 0.0, 0.0))
        handle.parent = leaf
        handle.matrix_parent_inverse = leaf.matrix_world.inverted()

    # True tapered dumpster assembled from final body panels, pockets, lid
    # and casters. The lid keeps its own rear hinge for later interaction.
    tapered_container("DUMPSTER_BODY", (cx, cy + 0.10, 0.12),
                      (1.95, 1.02), (2.28, 1.28), 1.20,
                      mats["dumpster_green"], target, "MOD_DUMPSTER_BODY")
    for index in range(5):
        arch.box(f"DUMPSTER_FRONT_RIB_{index}", (0.055, 0.055, 0.92),
                 (cx - 0.78 + index * 0.39, cy - 0.555, 0.72),
                 mats["dumpster_dark"], target, bevel=0.010,
                 module="MOD_DUMPSTER_BODY_RIB")
    for side in (-1, 1):
        arch.box(f"DUMPSTER_FORK_POCKET_{side:+d}", (0.34, 0.18, 0.48),
                 (cx + side * 0.72, cy - 0.57, 0.73), mats["dumpster_dark"], target,
                 bevel=0.028, module="MOD_DUMPSTER_FORK_POCKET")
    lid = create_hinged_lid("DUMPSTER_LID", (cx, cy + 0.71, 1.36),
                            2.14, 1.16, mats["dumpster_dark"], target)
    lid["door_id"] = "dumpster_lid"
    for ix in (-0.82, 0.82):
        for iy in (-0.43, 0.43):
            arch.cylinder("DUMPSTER_CASTER", 0.09, 0.08,
                          (cx + ix, cy + 0.10 + iy, 0.09), mats["rubber"], target,
                          vertices=18, module="MOD_DUMPSTER_CASTER",
                          rotation=(math.radians(90), 0.0, 0.0))


def create_cart_charging(mats, target) -> None:
    cx, cy = -10.3, -1.3
    arch.box("CART_CHARGING_PAD", (6.3, 4.2, 0.11), (cx, cy, -0.015),
             mats["concrete_1"], target, bevel=0.040, module="MOD_CHARGING_PAD")
    for side in (-1, 1):
        x = cx + side * 2.65
        for y in (cy - 1.55, cy + 1.55):
            arch.box("CHARGING_CANOPY_POST", (0.16, 0.16, 2.55), (x, y, 1.23),
                     mats["canopy_frame"], target, bevel=0.016,
                     module="MOD_CHARGING_CANOPY_POST")
    roof_angle = math.radians(2.0)
    arch.box("CHARGING_CANOPY_ROOF", (6.0, 3.8, 0.12), (cx, cy, 2.55),
             mats["canopy_roof"], target, bevel=0.025, module="MOD_CHARGING_CANOPY_ROOF",
             rotation=(roof_angle, 0.0, 0.0))
    # Raised standing seams, fascia and underside beams turn the canopy into a
    # finished utility structure rather than a single unarticulated slab.
    for index in range(15):
        x = cx - 2.80 + index * 0.40
        arch.box(f"CHARGING_ROOF_SEAM_{index:02d}", (0.035, 3.72, 0.040),
                 (x, cy, 2.625), mats["canopy_frame"], target,
                 bevel=0.006, module="MOD_CHARGING_ROOF_SEAM",
                 rotation=(roof_angle, 0.0, 0.0))
    for side, y in (("FRONT", cy - 1.92), ("BACK", cy + 1.92)):
        arch.box(f"CHARGING_CANOPY_FASCIA_{side}", (6.05, 0.12, 0.25),
                 (cx, y, 2.50), mats["canopy_frame"], target,
                 bevel=0.012, module="MOD_CHARGING_CANOPY_FASCIA")
    for index, x in enumerate((cx - 2.65, cx, cx + 2.65)):
        arch.box(f"CHARGING_CANOPY_BEAM_{index}", (0.16, 3.45, 0.18),
                 (x, cy, 2.43), mats["canopy_frame"], target,
                 bevel=0.012, module="MOD_CHARGING_CANOPY_BEAM")
    arch.box("CHARGING_CANOPY_SIGN_PANEL", (2.75, 0.07, 0.42),
             (cx, cy - 2.00, 2.45), mats["utility_green"], target,
             bevel=0.040, module="MOD_CHARGING_CANOPY_SIGN")
    arch.text_mesh("CHARGING_CANOPY_SIGN_TEXT", "CART CHARGING",
                   (cx, cy - 2.045, 2.45), 0.17, mats["sign_letter"], target,
                   extrude=0.005)
    for index, x in enumerate((cx - 1.85, cx, cx + 1.85)):
        arch.box(f"CHARGING_PEDESTAL_{index}", (0.34, 0.27, 1.05),
                 (x, cy + 1.65, 0.52), mats["utility_green"], target,
                 bevel=0.045, module="MOD_CART_CHARGER_PEDESTAL")
        arch.box(f"CHARGING_FACE_{index}", (0.24, 0.035, 0.31),
                 (x, cy + 1.49, 0.70), mats["warm_charcoal"], target,
                 bevel=0.025, module="MOD_CART_CHARGER_FACE")
        arch.cylinder(f"CHARGING_STATUS_LIGHT_{index}", 0.025, 0.012,
                      (x, cy + 1.465, 0.78), mats["status_light"], target,
                      vertices=16, module="MOD_CART_CHARGER_STATUS_LIGHT",
                      rotation=(math.radians(90), 0.0, 0.0))
        arch.curve_tube(f"CHARGING_CABLE_{index}",
                        [(x + 0.08, cy + 1.47, 0.61), (x + 0.27, cy + 1.35, 0.40),
                         (x + 0.38, cy + 1.48, 0.25)],
                        0.018, mats["rubber"], target, "MOD_CART_CHARGING_CABLE")


def create_parking_lights_and_weeds(mats, target) -> None:
    for index, (x, y) in enumerate(((-13.8, -18.0), (13.8, -18.0), (7.0, -27.0))):
        arch.cylinder(f"PARKING_LIGHT_POLE_{index}", 0.055, 5.8, (x, y, 2.82),
                      mats["light_pole"], target, vertices=18, module="MOD_PARKING_LIGHT_POLE")
        arch.box(f"PARKING_LIGHT_ARM_{index}", (0.65, 0.10, 0.10),
                 (x + 0.27, y, 5.68), mats["light_pole"], target,
                 bevel=0.022, module="MOD_PARKING_LIGHT_ARM")
        arch.box(f"PARKING_LIGHT_HEAD_{index}", (0.48, 0.25, 0.13),
                 (x + 0.56, y, 5.60), mats["light_head"], target,
                 bevel=0.045, module="MOD_PARKING_LIGHT_HEAD")
        arch.box(f"PARKING_LIGHT_LENS_{index}", (0.38, 0.18, 0.025),
                 (x + 0.56, y, 5.525), mats["exterior_globe"], target,
                 bevel=0.018, module="MOD_PARKING_LIGHT_LENS")

    weed_positions = [(-15.3, -10.2), (-15.1, -15.6), (-15.0, -23.4),
                      (15.1, -12.0), (15.2, -19.4), (-7.8, -8.8),
                      (8.2, -8.8), (6.8, 5.4), (-6.8, 3.5), (12.1, 6.6),
                      (-18.0, 5.3), (-16.5, 12.5)]
    for index, (x, y) in enumerate(weed_positions):
        create_weed_clump(f"WEED_CLUMP_{index:02d}", (x, y, -0.02),
                          0.28 + (index % 3) * 0.06, mats["weed"], target, 700 + index)


def create_weed_clump(name: str, loc, height: float, mat, target, seed: int) -> None:
    rng = random.Random(seed)
    verts, faces = [], []
    blades = 9
    for blade in range(blades):
        angle = math.tau * blade / blades + rng.uniform(-0.18, 0.18)
        radius = rng.uniform(0.03, 0.16)
        x, y = math.cos(angle) * radius, math.sin(angle) * radius
        h = height * rng.uniform(0.65, 1.10)
        width = rng.uniform(0.018, 0.035)
        tangent = Vector((-math.sin(angle) * width, math.cos(angle) * width, 0.0))
        base = len(verts)
        verts.extend([(x - tangent.x, y - tangent.y, 0.0),
                      (x + tangent.x, y + tangent.y, 0.0),
                      (x + math.cos(angle) * 0.06, y + math.sin(angle) * 0.06, h)])
        faces.append((base, base + 1, base + 2))
    mesh = bpy.data.meshes.new(name + "_MESH")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    obj.location = loc
    mesh.materials.append(mat)
    arch.tag(obj, "MOD_WEED_CLUMP")
    smart_uv(obj)


def validate_scene(production, collision) -> dict:
    meshes = [obj for obj in production.all_objects if obj.type == "MESH"]
    collision_meshes = [obj for obj in collision.all_objects if obj.type == "MESH"]
    missing_uv = [obj.name for obj in meshes if len(obj.data.uv_layers) == 0]
    unapplied = [obj.name for obj in meshes if any(abs(v - 1.0) > 1e-5 for v in obj.scale)]
    nonfinite = []
    for obj in meshes + collision_meshes:
        values = list(obj.location) + list(obj.rotation_euler) + list(obj.scale)
        if not all(math.isfinite(value) for value in values):
            nonfinite.append(obj.name)
    modules = Counter(obj.get("module_id", "UNCLASSIFIED") for obj in production.all_objects)
    hinged = [obj for obj in production.all_objects if obj.get("hinge_axis")]
    return {
        "asset": GLB_NAME,
        "blender_version": bpy.app.version_string,
        "site_dimensions_m": [SITE_W, SITE_D],
        "parking_spaces": PARKING_SPACES,
        "accessible_spaces": ACCESSIBLE_SPACES,
        "production_objects": len(production.all_objects),
        "render_meshes": len(meshes),
        "collision_meshes": len(collision_meshes),
        "materials": len({mat.name for obj in meshes for mat in obj.data.materials}),
        "module_counts": dict(sorted(modules.items())),
        "missing_uv": missing_uv,
        "unapplied_scale": unapplied,
        "nonfinite": nonfinite,
        "hinged_components": [{"name": obj.name, "pivot": obj.get("pivot_contract"),
                               "axis": obj.get("hinge_axis"),
                               "swing_degrees": obj.get("swing_degrees")}
                              for obj in hinged],
    }


def main() -> None:
    arch.clear_scene()
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    CANONICAL_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    root = arch.collection("COURSE1_MUNICIPAL_PROPERTY")
    production = arch.collection("LOD0_PROPERTY", root)
    collision = arch.collection("COLLISION_PROXIES", root)

    asphalt_tex = make_site_texture("municipal_parking_asphalt_basecolor", "asphalt")
    grass_tex = make_site_texture("municipal_patchy_grass_basecolor", "grass")
    putting_green_tex = make_site_texture("municipal_putting_green_basecolor", "putting_green")
    accessible_blue_tex = make_site_texture("municipal_faded_accessible_blue_basecolor", "accessible_blue")
    wood_tex = make_site_texture("municipal_weathered_wood_basecolor", "old_wood")
    dirt_tex = make_site_texture("municipal_compacted_dirt_basecolor", "dirt")
    concrete_tex = arch.make_texture("municipal_aged_concrete_basecolor", "concrete")
    roof_tex = arch.make_texture("municipal_asphalt_roof_basecolor", "asphalt_roof")

    mats = {
        "grass": arch.material("M_PatchyMunicipalGrass", (0.24, 0.33, 0.19, 1.0), 0.98, texture=grass_tex),
        "putting_green": arch.material("M_ThinPracticeGreen", (0.09, 0.24, 0.115, 1.0), 0.94,
                                           texture=putting_green_tex),
        "weed": arch.material("M_CurbWeeds", (0.21, 0.31, 0.12, 1.0), 0.96),
        "dirt": arch.material("M_CompactedDirt", (0.31, 0.24, 0.14, 1.0), 0.98, texture=dirt_tex),
        "asphalt": arch.material("M_CrackedParkingAsphalt", (0.14, 0.14, 0.13, 1.0), 0.97, texture=asphalt_tex),
        "cart_path": arch.material("M_OldCartPathAsphalt", (0.17, 0.17, 0.15, 1.0), 0.97, texture=asphalt_tex),
        "asphalt_crack": arch.material("M_AsphaltCrack", (0.035, 0.033, 0.030, 1.0), 1.0),
        "stripe": arch.material("M_FadedParkingStripe", (0.53, 0.50, 0.39, 1.0), 0.95),
        "accessible_blue": arch.material("M_FadedAccessibleBlue", (0.075, 0.19, 0.27, 1.0), 0.94,
                                             texture=accessible_blue_tex),
        "warning_yellow": arch.material("M_FadedWarningYellow", (0.61, 0.48, 0.11, 1.0), 0.91),
        "concrete": arch.material("M_PropertyConcrete", (0.47, 0.45, 0.40, 1.0), 0.94, texture=concrete_tex),
        "concrete_0": arch.material("M_PropertyConcrete_A", (0.48, 0.46, 0.41, 1.0), 0.94, texture=concrete_tex),
        "concrete_1": arch.material("M_PropertyConcrete_B", (0.44, 0.43, 0.39, 1.0), 0.95, texture=concrete_tex),
        "concrete_2": arch.material("M_PropertyConcrete_C", (0.51, 0.48, 0.42, 1.0), 0.95, texture=concrete_tex),
        "warm_charcoal": arch.material("M_PropertyWarmCharcoal", (0.085, 0.08, 0.072, 1.0), 0.78, 0.16),
        "aluminum": arch.material("M_PropertyOldAluminum", (0.28, 0.29, 0.27, 1.0), 0.58, 0.38),
        "brass": arch.material("M_PropertyRestrainedBrass", (0.45, 0.29, 0.095, 1.0), 0.42, 0.58),
        "rubber": arch.material("M_PropertyRubber", (0.035, 0.032, 0.028, 1.0), 0.96),
        "void": arch.material("M_PropertyDarkRecess", (0.012, 0.014, 0.013, 1.0), 1.0),
        "oak": arch.material("M_AgedBenchOak", (0.38, 0.23, 0.11, 1.0), 0.91, texture=wood_tex),
        "trash_green": arch.material("M_PublicTrashGreen", (0.07, 0.18, 0.12, 1.0), 0.85, 0.10),
        "sign_post": arch.material("M_OldSignPosts", (0.21, 0.15, 0.08, 1.0), 0.93, texture=wood_tex),
        "sign_green": arch.material("M_RoadSignDeepGreen", (0.06, 0.17, 0.11, 1.0), 0.87),
        "sign_green_faded": arch.material("M_RoadSignFadedInset", (0.14, 0.26, 0.18, 1.0), 0.91),
        "sign_letter": arch.material("M_RoadSignCreamLetters", (0.75, 0.70, 0.57, 1.0), 0.85),
        "flagpole": arch.material("M_OldFlagpoleAluminum", (0.38, 0.40, 0.38, 1.0), 0.48, 0.45),
        "flag_green": arch.material("M_MunicipalFlagGreen", (0.07, 0.22, 0.13, 1.0), 0.82),
        "cup": arch.material("M_PuttingCup", (0.82, 0.78, 0.63, 1.0), 0.55, 0.20),
        "shed_siding": arch.material("M_ShedFadedSiding", (0.18, 0.27, 0.20, 1.0), 0.91),
        "shed_trim": arch.material("M_ShedAgedTrim", (0.62, 0.58, 0.48, 1.0), 0.88),
        "shed_door": arch.material("M_ShedServiceDoor", (0.13, 0.22, 0.16, 1.0), 0.89),
        "shed_roof": arch.material("M_ShedAsphaltRoof", (0.10, 0.095, 0.085, 1.0), 0.95, texture=roof_tex),
        "screen_wood": arch.material("M_DumpsterScreenWood", (0.29, 0.20, 0.11, 1.0), 0.94, texture=wood_tex),
        "dumpster_green": arch.material("M_DumpsterGreen", (0.055, 0.17, 0.105, 1.0), 0.86, 0.08),
        "dumpster_dark": arch.material("M_DumpsterDark", (0.035, 0.065, 0.045, 1.0), 0.90, 0.05),
        "utility_green": arch.material("M_UtilityCabinetGreen", (0.19, 0.27, 0.21, 1.0), 0.82, 0.12),
        "utility_green_light": arch.material("M_UtilityCabinetDoor", (0.25, 0.33, 0.27, 1.0), 0.84, 0.10),
        "hvac_body": arch.material("M_HVACBody", (0.38, 0.40, 0.37, 1.0), 0.70, 0.32),
        "canopy_frame": arch.material("M_ChargingCanopyFrame", (0.12, 0.14, 0.13, 1.0), 0.72, 0.34),
        "canopy_roof": arch.material("M_ChargingCanopyRoof", (0.16, 0.21, 0.18, 1.0), 0.80, 0.24),
        "status_light": arch.material("M_ChargerStatusLight", (0.24, 0.62, 0.24, 1.0), 0.34,
                                      emission_strength=0.55),
        "light_pole": arch.material("M_ParkingLightPole", (0.12, 0.13, 0.12, 1.0), 0.68, 0.36),
        "light_head": arch.material("M_ParkingLightHead", (0.09, 0.10, 0.09, 1.0), 0.74, 0.28),
        "exterior_globe": arch.material("M_ParkingLightLens", (0.80, 0.73, 0.54, 1.0), 0.38, emission_strength=0.35),
        "collision": arch.material("M_PropertyCollision", (1.0, 0.0, 1.0, 1.0), 1.0),
    }

    create_site_terrain(mats, production)
    create_parking_and_walks(mats, production, collision)
    create_cart_path(mats, production)
    create_putting_green(mats, production)
    create_bench_and_trash(mats, production)
    create_road_sign_and_flagpole(mats, production)
    create_cart_charging(mats, production)
    create_maintenance_shed(mats, production, collision)
    create_utilities_and_dumpster(mats, production)
    create_parking_lights_and_weeds(mats, production)

    root["asset_id"] = "course1_municipal_property"
    root["source_license"] = "Project-owned original; based only on user-provided Designs/ClubHouse boards"
    root["real_dimensions_m"] = [SITE_W, SITE_D]
    root["parking_spaces"] = PARKING_SPACES
    root["accessible_spaces"] = ACCESSIBLE_SPACES
    root["future_expansion_ready"] = True
    root["reference_board"] = "Designs/ClubHouse/ChatGPT Image Jul 20, 2026, 02_52_34 PM.png"

    audit = validate_scene(production, collision)
    if audit["missing_uv"] or audit["unapplied_scale"] or audit["nonfinite"]:
        raise RuntimeError(f"Course 1 property audit failed: {json.dumps(audit, indent=2)}")
    if audit["parking_spaces"] != 20 or audit["accessible_spaces"] != 2:
        raise RuntimeError("Parking capacity contract failed")
    if len(audit["hinged_components"]) != 5:
        raise RuntimeError(f"Expected five hinged property components, got {len(audit['hinged_components'])}")

    bpy.context.scene["course1_municipal_property_audit"] = json.dumps(audit)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), check_existing=False)
    arch.export_collection(production, collision, CANONICAL_DIR / GLB_NAME)
    arch.export_collection(production, collision, RUNTIME_DIR / GLB_NAME)
    report_path = SOURCE_DIR / "course1_municipal_property_audit.json"
    report_path.write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "blend": str(BLEND_PATH),
                      "canonical_glb": str(CANONICAL_DIR / GLB_NAME),
                      "runtime_glb": str(RUNTIME_DIR / GLB_NAME),
                      "audit": audit}, indent=2))


if __name__ == "__main__":
    main()
