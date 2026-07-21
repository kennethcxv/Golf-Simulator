"""Build the two Pinehollow provisions products used by the delivery system.

Run from the repository root with Blender 5.1+:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
        --background --factory-startup \
        --python tools/blender/build_provisions_products.py

The Fairway Spring bottle is original procedural geometry.  The Bunker Bites
asset is a traceable derivative of the immutable, project-owned
``Assets/pro_shop/glb/products/pf_snack_chips.glb`` source.  The source GLB and
its corresponding raw .blend are only read; neither is modified.

Coordinate convention while authoring is X width, Y depth (-Y is the product
front), Z height.  Blender's glTF export becomes X width, Y height, Z depth at
runtime.  All measurements are metres and both roots rest on Z=0.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector


SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[2]
sys.path.insert(0, str(SCRIPT.parent))

from build_checkout_assets import (  # noqa: E402
    activate,
    anchor,
    apply_rotation_scale,
    box,
    collision_box,
    cylinder,
    descendants,
    empty,
    finish_mesh,
    mat,
    parent_keep,
    reset_scene,
    torus,
)


SOURCE_DIR = ROOT / "asset_sources" / "blender" / "provisions"
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
QA_PASS = os.environ.get("PROVISIONS_ASSET_QA_PASS", "pass-01").strip() or "pass-01"
QA_DIR = ROOT / "qa" / "box_system_master" / "provisions_assets" / QA_PASS
SOURCE_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
QA_DIR.mkdir(parents=True, exist_ok=True)

BUILD_VERSION = 1
WATER_ID = "provisions_fairway_spring_water"
SNACK_ID = "provisions_bunker_bites_chips"
WATER_AUTHOR_DIMS = (0.068, 0.068, 0.218)  # X width, Y depth, Z height
SNACK_AUTHOR_DIMS = (0.160, 0.0715, 0.195)
WATER_RUNTIME_DIMS = (0.068, 0.218, 0.068)  # Three.js X/Y/Z
SNACK_RUNTIME_DIMS = (0.160, 0.195, 0.0715)
IMMUTABLE_SNACK_GLB = ROOT / "Assets" / "pro_shop" / "glb" / "products" / "pf_snack_chips.glb"
IMMUTABLE_SNACK_BLEND = ROOT / "Assets" / "pro_shop" / "source" / "products" / "snacks" / "pf_snack_chips.blend"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def set_scene_metadata() -> None:
    scene = bpy.context.scene
    scene["asset_build_script"] = SCRIPT.relative_to(ROOT).as_posix()
    scene["asset_build_version"] = BUILD_VERSION
    scene["units"] = "meters"
    scene["external_downloads"] = 0
    scene["raw_sources_modified"] = False


def product_root(asset_id: str, author_dims, runtime_dims, logical_sku: str, source: str):
    return empty(
        asset_id,
        props={
            "asset_id": asset_id,
            "asset_version": BUILD_VERSION,
            "version": BUILD_VERSION,
            "logical_sku": logical_sku,
            "asset_type": "retail_provisions_product",
            "units": "meters",
            "front": "-Y (player/customer-facing product front)",
            "target_dimensions_m": list(author_dims),
            "runtime_dimensions_m": list(runtime_dims),
            "source": source,
            "license": "Project-owned / UNLICENSED",
            "builder": SCRIPT.relative_to(ROOT).as_posix(),
            "external_assets": 0,
            "allow_runtime_scale": False,
        },
        size=0.025,
    )


def provisions_materials():
    # Pinehollow palette, deliberately restrained and shared between products.
    materials = {
        "cream": mat("M_ProvisionsCream", (0.91, 0.86, 0.73, 1.0), roughness=0.72),
        "green": mat("M_ProvisionsDeepGreen", (0.055, 0.22, 0.12, 1.0), roughness=0.52),
        "sage": mat("M_ProvisionsSage", (0.38, 0.52, 0.40, 1.0), roughness=0.62),
        "charcoal": mat("M_ProvisionsCharcoal", (0.055, 0.065, 0.075, 1.0), roughness=0.58),
        "pet": mat("M_FairwaySpringPET", (0.69, 0.86, 0.84, 0.28), roughness=0.15),
        "water": mat("M_FairwaySpringWater", (0.39, 0.69, 0.66, 0.64), roughness=0.22),
        "collision": mat("M_ProvisionsCollision", (1.0, 0.0, 1.0, 0.0), roughness=1.0),
    }
    # Alpha blending is explicit so Three's GLTFLoader preserves the clear-ish PET read.
    for key in ("pet", "water", "collision"):
        material = materials[key]
        if hasattr(material, "surface_render_method"):
            material.surface_render_method = "DITHERED"
        material.use_transparency_overlap = False
    return materials


def lathe_mesh(name: str, profile, material, *, parent, segments=32, props=None):
    """Create a UV'd closed surface of revolution around Z from (radius, z)."""
    vertices = []
    uvs = []
    for ring_index, (radius, height) in enumerate(profile):
        v = ring_index / max(1, len(profile) - 1)
        for segment in range(segments):
            angle = math.tau * segment / segments
            vertices.append((radius * math.cos(angle), radius * math.sin(angle), height))
            uvs.append((segment / segments, v))
    faces = []
    for ring_index in range(len(profile) - 1):
        current = ring_index * segments
        following = (ring_index + 1) * segments
        for segment in range(segments):
            next_segment = (segment + 1) % segments
            faces.append((
                current + segment,
                current + next_segment,
                following + next_segment,
                following + segment,
            ))
    faces.append(tuple(reversed(range(segments))))
    top_start = (len(profile) - 1) * segments
    faces.append(tuple(top_start + index for index in range(segments)))

    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate(clean_customdata=False)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish_mesh(obj, material, bevel_width=0.0, uv=False)
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            if polygon.index == len(mesh.polygons) - 2:
                x, y, _ = mesh.vertices[vertex_index].co
                uv_layer.data[loop_index].uv = (0.5 + x / 0.068, 0.5 + y / 0.068)
            elif polygon.index == len(mesh.polygons) - 1:
                x, y, _ = mesh.vertices[vertex_index].co
                uv_layer.data[loop_index].uv = (0.5 + x / 0.068, 0.5 + y / 0.068)
            else:
                uv_layer.data[loop_index].uv = uvs[vertex_index]
    parent_keep(obj, parent)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


PIXEL_GLYPHS = {
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "F": ("11111", "10000", "10000", "11110", "10000", "10000", "10000"),
    "G": ("01110", "10001", "10000", "10111", "10001", "10001", "01110"),
    "I": ("11111", "00100", "00100", "00100", "00100", "00100", "11111"),
    "L": ("10000", "10000", "10000", "10000", "10000", "10000", "11111"),
    "M": ("10001", "11011", "10101", "10101", "10001", "10001", "10001"),
    "N": ("10001", "11001", "11001", "10101", "10011", "10011", "10001"),
    "P": ("11110", "10001", "10001", "11110", "10000", "10000", "10000"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "S": ("01111", "10000", "10000", "01110", "00001", "00001", "11110"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
    "W": ("10001", "10001", "10001", "10101", "10101", "11011", "10001"),
    "Y": ("10001", "10001", "01010", "00100", "00100", "00100", "00100"),
    "0": ("01110", "10001", "10011", "10101", "11001", "10001", "01110"),
    "5": ("11111", "10000", "10000", "11110", "00001", "00001", "11110"),
    " ": ("000", "000", "000", "000", "000", "000", "000"),
}


def pixel_text(name: str, text: str, center, material, *, parent, pixel=0.00072):
    """Cheap, readable 5x7 label lettering made from merged front-facing quads."""
    glyphs = [PIXEL_GLYPHS[character] for character in text.upper()]
    widths = [len(glyph[0]) for glyph in glyphs]
    total_width = sum(widths) * pixel + max(0, len(glyphs) - 1) * pixel
    start_x = center[0] - total_width / 2
    y = center[1]
    baseline = center[2] - 3.5 * pixel
    vertices = []
    faces = []
    cursor = start_x
    for glyph, width in zip(glyphs, widths):
        for row_index, row in enumerate(glyph):
            column = 0
            while column < width:
                if row[column] != "1":
                    column += 1
                    continue
                run_start = column
                while column < width and row[column] == "1":
                    column += 1
                run_width = column - run_start
                x0 = cursor + run_start * pixel
                x1 = x0 + run_width * pixel
                z1 = baseline + (7 - row_index) * pixel
                z0 = z1 - pixel
                offset = len(vertices)
                vertices.extend(((x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)))
                faces.append((offset, offset + 1, offset + 2, offset + 3))
        cursor += (width + 1) * pixel
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate(clean_customdata=False)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish_mesh(obj, material, bevel_width=0.0, uv=False)
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for corner, loop_index in enumerate(polygon.loop_indices):
            uv_layer.data[loop_index].uv = ((0, 0), (1, 0), (1, 1), (0, 1))[corner]
    parent_keep(obj, parent)
    obj["component"] = "low_poly_label_text"
    return obj


def curved_label_panel(name, radius, height, center_z, half_angle, material, *, parent, segments=12):
    """A front-facing label field that follows the bottle instead of floating as a card."""
    vertices = []
    faces = []
    for index in range(segments + 1):
        t = index / segments
        angle = -math.pi / 2 - half_angle + (2 * half_angle * t)
        x = math.cos(angle) * radius
        y = math.sin(angle) * radius
        vertices.extend(((x, y, center_z - height / 2), (x, y, center_z + height / 2)))
    for index in range(segments):
        offset = index * 2
        faces.append((offset, offset + 2, offset + 3, offset + 1))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate(clean_customdata=False)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish_mesh(obj, material, bevel_width=0.0, uv=False)
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for corner, loop_index in enumerate(polygon.loop_indices):
            vertex = mesh.loops[loop_index].vertex_index
            column = vertex // 2
            upper = vertex % 2
            uv_layer.data[loop_index].uv = (column / segments, upper)
    parent_keep(obj, parent)
    obj["component"] = "curved_front_label_field"
    obj["conforms_to_bottle"] = True
    return obj


def add_barcode_geometry(root, materials):
    # A deliberately simple scannable-looking code on the back of the paper label.
    box(
        "WATER_BARCODE_BACKING",
        (0.028, 0.00055, 0.022),
        (0.0, 0.0332, 0.106),
        materials["cream"],
        bevel=0.0005,
        parent=root,
    )
    widths = (1, 2, 1, 1, 3, 1, 2, 1, 2, 1, 1, 2, 1)
    cursor = -0.0114
    unit = 0.00072
    for index, width_units in enumerate(widths, start=1):
        width = width_units * unit
        height = 0.0145 if index % 4 else 0.0120
        box(
            f"WATER_BARCODE_BAR_{index:02d}",
            (width, 0.00035, height),
            (cursor + width / 2, 0.03365, 0.1075),
            materials["charcoal"],
            bevel=0.0,
            parent=root,
        )
        cursor += width + unit


def build_water():
    reset_scene()
    set_scene_metadata()
    materials = provisions_materials()
    root = product_root(
        WATER_ID,
        WATER_AUTHOR_DIMS,
        WATER_RUNTIME_DIMS,
        "water1",
        "Original in-repository Blender geometry; no external source assets",
    )
    root["product_name"] = "Fairway Spring Water"
    root["package"] = "sealed 500 ml PET bottle"
    root["nominal_volume_ml"] = 500
    root["flavor"] = "still spring water"

    bottle_profile = [
        (0.0295, 0.0000),
        (0.0322, 0.0025),
        (0.0340, 0.0070),
        (0.0334, 0.0160),
        (0.0328, 0.0500),
        (0.0330, 0.1450),
        (0.0322, 0.1660),
        (0.0290, 0.1780),
        (0.0220, 0.1870),
        (0.0152, 0.1935),
        (0.0152, 0.1990),
    ]
    lathe_mesh(
        "WATER_BOTTLE_PET",
        bottle_profile,
        materials["pet"],
        parent=root,
        segments=40,
        props={"component": "clear_pet_bottle", "recyclable": True, "pet_resin_code": 1},
    )
    liquid_profile = [
        (0.0285, 0.0050),
        (0.0308, 0.0080),
        (0.0308, 0.1580),
        (0.0294, 0.1690),
        (0.0240, 0.1760),
    ]
    lathe_mesh(
        "WATER_LIQUID",
        liquid_profile,
        materials["water"],
        parent=root,
        segments=32,
        props={"component": "liquid_fill", "fill_volume_ml": 500},
    )

    # Subtle PET ribs give the small first-person prop a manufactured silhouette.
    for index, height in enumerate((0.018, 0.039, 0.151, 0.162), start=1):
        torus(
            f"WATER_PET_GRIP_RING_{index:02d}",
            0.0318,
            0.00075,
            (0, 0, height),
            materials["pet"],
            parent=root,
        )

    # Paper label remains a physically separate wrap, with a front identity panel and
    # a real geometric barcode on the reverse.  It stays inside the 68 mm envelope.
    cylinder(
        "WATER_LABEL_WRAP",
        0.0330,
        0.0510,
        (0, 0, 0.1060),
        materials["cream"],
        vertices=40,
        bevel=0.0004,
        parent=root,
        props={"component": "paper_label", "removable": True},
    )
    cylinder(
        "WATER_LABEL_GREEN_TOP",
        0.03315,
        0.0080,
        (0, 0, 0.1275),
        materials["green"],
        vertices=40,
        bevel=0.0002,
        parent=root,
    )
    cylinder(
        "WATER_LABEL_GREEN_BOTTOM",
        0.03315,
        0.0065,
        (0, 0, 0.08375),
        materials["sage"],
        vertices=40,
        bevel=0.0002,
        parent=root,
    )
    curved_label_panel(
        "WATER_LABEL_FRONT_FIELD",
        0.03335,
        0.0260,
        0.1075,
        math.radians(49),
        materials["green"],
        parent=root,
    )
    # Golf-flag crest, restrained and legible at shelf distance.
    box("WATER_LABEL_FLAG_STEM", (0.0014, 0.00045, 0.012), (-0.017, -0.03355, 0.120), materials["cream"], bevel=0.0002, parent=root)
    box("WATER_LABEL_FLAG", (0.0090, 0.00045, 0.0055), (-0.0125, -0.03355, 0.123), materials["sage"], bevel=0.0006, parent=root)
    pixel_text(
        "WATER_LABEL_FAIRWAY",
        "FAIRWAY",
        (0.006, -0.03375, 0.1170),
        materials["cream"],
        parent=root,
        pixel=0.00078,
    )
    pixel_text(
        "WATER_LABEL_SPRING",
        "SPRING",
        (0.004, -0.03375, 0.1075),
        materials["cream"],
        parent=root,
        pixel=0.00082,
    )
    pixel_text(
        "WATER_LABEL_STILL_500ML",
        "STILL 500 ML",
        (0.004, -0.03375, 0.0970),
        materials["cream"],
        parent=root,
        pixel=0.00038,
    )
    add_barcode_geometry(root, materials)

    cylinder(
        "WATER_NECK_FINISH",
        0.0152,
        0.0070,
        (0, 0, 0.1970),
        materials["pet"],
        vertices=32,
        bevel=0.0005,
        parent=root,
    )
    cylinder(
        "WATER_TAMPER_BAND",
        0.0163,
        0.0050,
        (0, 0, 0.2015),
        materials["sage"],
        vertices=32,
        bevel=0.00045,
        parent=root,
        props={"component": "tamper_band", "sealed": True},
    )
    cap = cylinder(
        "WATER_CAP",
        0.0164,
        0.0140,
        (0, 0, 0.2110),
        materials["green"],
        vertices=32,
        bevel=0.00065,
        parent=root,
        props={"component": "cap", "separate_component": True, "twist_axis": "+Z"},
    )
    cap["pivot_z_m"] = 0.204
    for index in range(16):
        angle = math.tau * index / 16
        radius = 0.0162
        ridge = box(
            f"WATER_CAP_RIDGE_{index + 1:02d}",
            (0.0022, 0.0010, 0.0095),
            (radius * math.cos(angle), radius * math.sin(angle), 0.2105),
            materials["sage"],
            rot=(0, 0, angle),
            bevel=0.0,
            parent=root,
        )
        ridge["component"] = "cap_knurl"

    collision = collision_box(
        "COL_PROVISIONS_WATER",
        WATER_AUTHOR_DIMS,
        (0, 0, WATER_AUTHOR_DIMS[2] / 2),
        materials,
        parent=root,
    )
    collision["collision_shape"] = "upright_bottle_envelope"
    collision["simplified"] = True
    anchor(
        "BARCODE_AREA",
        (0, 0.0340, 0.1060),
        rot=(math.pi / 2, 0, math.pi),
        parent=root,
        kind="barcode",
        props={"width_m": 0.028, "height_m": 0.022, "surface": "label_back"},
    )
    anchor(
        "PICKUP_TARGET",
        (0, 0, 0.119),
        parent=root,
        kind="pickup",
        props={"grip_mode": "small", "preferred_hand": "primary"},
    )
    anchor(
        "SHELF_TARGET",
        (0, 0, 0),
        parent=root,
        kind="shelf",
        props={"upright_axis": "+Z", "label_faces": "-Y"},
    )
    return root


def build_snack():
    reset_scene()
    set_scene_metadata()
    if not IMMUTABLE_SNACK_GLB.is_file() or not IMMUTABLE_SNACK_BLEND.is_file():
        raise RuntimeError("immutable project-owned Bunker Bites source is missing")
    before_hash = sha256(IMMUTABLE_SNACK_GLB)
    before_blend_hash = sha256(IMMUTABLE_SNACK_BLEND)
    bpy.ops.import_scene.gltf(filepath=str(IMMUTABLE_SNACK_GLB))
    root = bpy.data.objects.get("pf_snack_chips")
    if root is None:
        raise RuntimeError("project-owned snack source lost its pf_snack_chips root")
    root.name = SNACK_ID
    root["asset_id"] = SNACK_ID
    root["asset_version"] = BUILD_VERSION
    root["version"] = BUILD_VERSION
    root["logical_sku"] = "snack1"
    root["asset_type"] = "retail_provisions_product"
    root["units"] = "meters"
    root["front"] = "-Y (player/customer-facing product front)"
    root["target_dimensions_m"] = list(SNACK_AUTHOR_DIMS)
    root["runtime_dimensions_m"] = list(SNACK_RUNTIME_DIMS)
    root["product_name"] = "Bunker Bites Potato Chips"
    root["flavor"] = "sour cream and chive"
    root["package"] = "sealed pillow pouch"
    root["source"] = IMMUTABLE_SNACK_GLB.relative_to(ROOT).as_posix()
    root["source_blend"] = IMMUTABLE_SNACK_BLEND.relative_to(ROOT).as_posix()
    root["source_sha256"] = before_hash
    root["source_blend_sha256"] = before_blend_hash
    root["derivation"] = "renamed production derivative; geometry and embedded project-owned label preserved at 1:1 scale"
    root["license"] = "Project-owned / UNLICENSED"
    root["builder"] = SCRIPT.relative_to(ROOT).as_posix()
    root["external_assets"] = 0
    root["allow_runtime_scale"] = False

    body = bpy.data.objects.get("pf_snack_chips_body")
    collision = bpy.data.objects.get("COL_pf_snack_chips")
    pickup = bpy.data.objects.get("PICKUP_SOCKET")
    shelf = bpy.data.objects.get("SHELF_ANCHOR")
    barcode = bpy.data.objects.get("BARCODE_AREA")
    if not all((body, collision, pickup, shelf, barcode)):
        raise RuntimeError("project-owned snack source hierarchy is incomplete")
    body.name = "SNACK_POUCH_BODY"
    body["component"] = "printed_pillow_pouch"
    body["identity"] = "Bunker Bites / sour cream and chive"
    body["source_scale"] = 1.0
    collision.name = "COL_PROVISIONS_SNACK"
    collision["collision_shape"] = "pouch_envelope"
    collision["simplified"] = True
    pickup.name = "PICKUP_TARGET"
    pickup["anchor"] = True
    pickup["anchor_kind"] = "pickup"
    pickup["grip_mode"] = "small"
    shelf.name = "SHELF_TARGET"
    shelf["anchor"] = True
    shelf["anchor_kind"] = "shelf"
    shelf["upright_axis"] = "+Z"
    shelf["label_faces"] = "-Y"
    barcode["anchor"] = True
    barcode["anchor_kind"] = "barcode"
    barcode["width_m"] = 0.038
    barcode["height_m"] = 0.024
    barcode["surface"] = "printed_pouch_back"
    empty(
        "SNACK_SOURCE_DERIVATION",
        parent=root,
        size=0.015,
        props={
            "immutable_source": IMMUTABLE_SNACK_GLB.relative_to(ROOT).as_posix(),
            "immutable_source_sha256": before_hash,
            "source_scale": 1.0,
            "external_downloads": 0,
        },
    )

    # The import/export round trip must not mutate either immutable source.
    if sha256(IMMUTABLE_SNACK_GLB) != before_hash or sha256(IMMUTABLE_SNACK_BLEND) != before_blend_hash:
        raise RuntimeError("immutable Bunker Bites source changed during derivation")
    return root


REQUIRED_NODES = {
    WATER_ID: {
        "WATER_BOTTLE_PET",
        "WATER_LIQUID",
        "WATER_LABEL_WRAP",
        "WATER_LABEL_FRONT_FIELD",
        "WATER_TAMPER_BAND",
        "WATER_CAP",
        "WATER_BARCODE_BACKING",
        "BARCODE_AREA",
        "PICKUP_TARGET",
        "SHELF_TARGET",
        "COL_PROVISIONS_WATER",
    },
    SNACK_ID: {
        "SNACK_POUCH_BODY",
        "SNACK_SOURCE_DERIVATION",
        "BARCODE_AREA",
        "PICKUP_TARGET",
        "SHELF_TARGET",
        "COL_PROVISIONS_SNACK",
    },
}


def visible_bounds(root):
    points = []
    bpy.context.view_layer.update()
    for obj in descendants(root):
        if obj.type != "MESH" or obj.name.startswith(("COL_", "COLLISION_", "VOLUME_")):
            continue
        for corner in obj.bound_box:
            points.append(obj.matrix_world @ Vector(corner))
    if not points:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    lo = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    hi = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return lo, hi


def scene_metrics(root):
    nodes = descendants(root)
    meshes = [obj for obj in nodes if obj.type == "MESH"]
    visible_meshes = [obj for obj in meshes if not obj.name.startswith(("COL_", "COLLISION_", "VOLUME_"))]
    triangles = sum(sum(max(1, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in meshes)
    visible_triangles = sum(sum(max(1, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in visible_meshes)
    material_names = sorted({slot.material.name for obj in meshes for slot in obj.material_slots if slot.material})
    image_names = sorted({image.name for image in bpy.data.images if image.size[0] and image.size[1]})
    lo, hi = visible_bounds(root)
    return {
        "nodes": len(nodes),
        "meshes": len(meshes),
        "visible_meshes": len(visible_meshes),
        "triangles": triangles,
        "visible_triangles": visible_triangles,
        "materials": material_names,
        "images": image_names,
        "visible_bounds_min_authoring": [round(value, 6) for value in lo],
        "visible_bounds_max_authoring": [round(value, 6) for value in hi],
        "visible_dimensions_authoring": [round(value, 6) for value in (hi - lo)],
        "visible_dimensions_runtime": [round((hi - lo).x, 6), round((hi - lo).z, 6), round((hi - lo).y, 6)],
    }


def validate_asset(asset_id: str, root):
    by_name = {obj.name: obj for obj in descendants(root)}
    missing = sorted(REQUIRED_NODES[asset_id] - set(by_name))
    if missing:
        raise RuntimeError(f"{asset_id} missing required nodes: {missing}")
    if root.get("asset_id") != asset_id or root.get("units") != "meters":
        raise RuntimeError(f"{asset_id} root metadata invalid")
    if root.get("allow_runtime_scale") is not False:
        raise RuntimeError(f"{asset_id} must forbid runtime product scaling")
    for obj in descendants(root):
        if obj.type != "MESH":
            continue
        if any(abs(float(scale) - 1.0) > 1e-5 for scale in obj.scale):
            raise RuntimeError(f"{asset_id}/{obj.name} has unapplied scale {tuple(obj.scale)}")
        if obj.data.polygons and not obj.data.uv_layers:
            raise RuntimeError(f"{asset_id}/{obj.name} has no UV map")
    if any(by_name[name].type != "EMPTY" for name in ("BARCODE_AREA", "PICKUP_TARGET", "SHELF_TARGET")):
        raise RuntimeError(f"{asset_id} anchors must be transform sockets, not visible meshes")
    for name in ("BARCODE_AREA", "PICKUP_TARGET", "SHELF_TARGET"):
        if by_name[name].parent is not root:
            raise RuntimeError(f"{asset_id}/{name} must be a direct child of the asset root")
    metrics = scene_metrics(root)
    expected = WATER_AUTHOR_DIMS if asset_id == WATER_ID else SNACK_AUTHOR_DIMS
    tolerance = 0.0020 if asset_id == WATER_ID else 0.0002
    for index, (actual, target) in enumerate(zip(metrics["visible_dimensions_authoring"], expected)):
        if abs(actual - target) > tolerance:
            raise RuntimeError(f"{asset_id} dimension axis {index}: {actual} outside target {target} +/- {tolerance}")
    if metrics["triangles"] > 12000:
        raise RuntimeError(f"{asset_id} exceeds 12k triangle budget: {metrics['triangles']}")
    if len(metrics["materials"]) > 12:
        raise RuntimeError(f"{asset_id} exceeds 12 material budget")
    return metrics


def add_build_info(asset_id: str, source_note: str):
    text = bpy.data.texts.new("BUILD_INFO.txt")
    text.write(
        "Pinehollow Golf provisions product\n"
        f"asset_id: {asset_id}\n"
        f"build_version: {BUILD_VERSION}\n"
        f"builder: {SCRIPT.relative_to(ROOT).as_posix()}\n"
        "units: metres\n"
        f"source: {source_note}\n"
        "license: project-owned / UNLICENSED\n"
        "external downloads: none\n"
        "raw source assets modified: false\n"
    )


def save_export(asset_id: str, root, source_note: str):
    metrics = validate_asset(asset_id, root)
    add_build_info(asset_id, source_note)
    blend_path = SOURCE_DIR / f"{asset_id}.blend"
    glb_path = EXPORT_DIR / f"{asset_id}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in descendants(root):
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_animations=False,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )
    metrics.update({
        "asset_id": asset_id,
        "logical_sku": root["logical_sku"],
        "target_dimensions_authoring_m": list(root["target_dimensions_m"]),
        "target_dimensions_runtime_m": list(root["runtime_dimensions_m"]),
        "source": blend_path.relative_to(ROOT).as_posix(),
        "export": glb_path.relative_to(ROOT).as_posix(),
        "bytes": glb_path.stat().st_size,
        "qa_pass": QA_PASS,
    })
    (QA_DIR / f"{asset_id}_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf8")
    print(f"BUILT|{asset_id}|tris={metrics['triangles']}|bytes={metrics['bytes']}|dims={metrics['visible_dimensions_authoring']}")
    return metrics


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_preview(asset_id: str):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -1.35
    if scene.world is None:
        scene.world = bpy.data.worlds.new("QA_World")
    scene.world.color = (0.020, 0.030, 0.023)

    bpy.ops.object.camera_add(location=(0.30, -0.42, 0.28))
    camera = bpy.context.object
    camera.name = "QA_Camera"
    camera.data.lens = 62 if asset_id == WATER_ID else 58
    scene.camera = camera
    target_height = 0.108 if asset_id == WATER_ID else 0.0975
    for name, energy, location, color, size in (
        ("Key", 42, (-0.35, -0.42, 0.48), (1.0, 0.88, 0.70), 0.52),
        ("Fill", 18, (0.38, -0.15, 0.28), (0.68, 0.86, 0.75), 0.44),
        ("Rim", 34, (0.05, 0.34, 0.42), (0.78, 0.90, 1.0), 0.38),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = f"QA_{name}"
        light.data.energy = energy
        light.data.color = color
        light.data.shape = "DISK"
        light.data.size = size
        look_at(light, (0, 0, target_height))
    floor_material = mat("QA_FloorMaterial", (0.035, 0.055, 0.042, 1.0), roughness=0.92)
    box("QA_Floor", (0.80, 0.80, 0.012), (0, 0, -0.009), floor_material, bevel=0.004)
    return camera, target_height


def render_previews(asset_id: str):
    camera, target_height = setup_preview(asset_id)
    if asset_id == WATER_ID:
        views = (
            ("front_three_quarter", (0.22, -0.34, 0.245)),
            ("barcode_back", (-0.16, 0.34, 0.235)),
        )
    else:
        views = (
            ("front_three_quarter", (0.31, -0.48, 0.285)),
            ("barcode_back", (-0.27, 0.48, 0.275)),
        )
    for name, location in views:
        camera.location = location
        look_at(camera, (0, 0, target_height))
        bpy.context.scene.render.filepath = str(QA_DIR / f"{asset_id}_{name}.png")
        bpy.ops.render.render(write_still=True)
    for obj in [candidate for candidate in list(bpy.data.objects) if candidate.name.startswith("QA_")]:
        bpy.data.objects.remove(obj, do_unlink=True)


def clean_reimport(asset_id: str):
    reset_scene()
    set_scene_metadata()
    glb_path = EXPORT_DIR / f"{asset_id}.glb"
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    root = bpy.data.objects.get(asset_id)
    if root is None:
        raise RuntimeError(f"clean reimport lost {asset_id} root")
    metrics = validate_asset(asset_id, root)
    report = {
        "asset_id": asset_id,
        "glb": glb_path.relative_to(ROOT).as_posix(),
        "root_metadata_preserved": root.get("asset_id") == asset_id,
        "required_nodes_preserved": REQUIRED_NODES[asset_id].issubset({obj.name for obj in descendants(root)}),
        "anchors_preserved": all(bpy.data.objects.get(name) is not None for name in ("BARCODE_AREA", "PICKUP_TARGET", "SHELF_TARGET")),
        "no_runtime_scale": root.get("allow_runtime_scale") is False,
        "nodes": metrics["nodes"],
        "meshes": metrics["meshes"],
        "triangles": metrics["triangles"],
        "materials": metrics["materials"],
        "images": metrics["images"],
        "visible_dimensions_authoring": metrics["visible_dimensions_authoring"],
        "visible_dimensions_runtime": metrics["visible_dimensions_runtime"],
        "clean_reimport": True,
    }
    (QA_DIR / f"{asset_id}_reimport.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(f"REIMPORT_OK|{asset_id}|tris={metrics['triangles']}|runtime_dims={metrics['visible_dimensions_runtime']}")
    return report


def build_one(asset_id: str):
    if asset_id == WATER_ID:
        root = build_water()
        source_note = "original in-repository procedural geometry; no external source assets"
    else:
        root = build_snack()
        source_note = (
            f"derived 1:1 from immutable project-owned {IMMUTABLE_SNACK_GLB.relative_to(ROOT).as_posix()}; "
            f"raw source {IMMUTABLE_SNACK_BLEND.relative_to(ROOT).as_posix()} untouched"
        )
    metrics = save_export(asset_id, root, source_note)
    render_previews(asset_id)
    return metrics


def main():
    target = os.environ.get("PROVISIONS_ASSET_TARGET", "").strip()
    assets = (WATER_ID, SNACK_ID) if not target else (target,)
    unknown = [asset_id for asset_id in assets if asset_id not in (WATER_ID, SNACK_ID)]
    if unknown:
        raise RuntimeError(f"unknown PROVISIONS_ASSET_TARGET: {unknown[0]}")
    source_hashes_before = {
        "glb": sha256(IMMUTABLE_SNACK_GLB),
        "blend": sha256(IMMUTABLE_SNACK_BLEND),
    }
    metrics = [build_one(asset_id) for asset_id in assets]
    reimports = [clean_reimport(asset_id) for asset_id in assets]
    source_hashes_after = {
        "glb": sha256(IMMUTABLE_SNACK_GLB),
        "blend": sha256(IMMUTABLE_SNACK_BLEND),
    }
    if source_hashes_before != source_hashes_after:
        raise RuntimeError("immutable Bunker Bites sources changed during build")
    report = {
        "builder": SCRIPT.relative_to(ROOT).as_posix(),
        "build_version": BUILD_VERSION,
        "qa_pass": QA_PASS,
        "asset_target": target or "all",
        "external_assets": [],
        "project_owned_sources": [
            IMMUTABLE_SNACK_GLB.relative_to(ROOT).as_posix(),
            IMMUTABLE_SNACK_BLEND.relative_to(ROOT).as_posix(),
        ],
        "immutable_source_hashes_before": source_hashes_before,
        "immutable_source_hashes_after": source_hashes_after,
        "immutable_sources_unchanged": source_hashes_before == source_hashes_after,
        "assets": metrics,
        "reimports": reimports,
    }
    (QA_DIR / "provisions_products_build_report.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(f"COMPLETE|assets={len(metrics)}|qa_pass={QA_PASS}|immutable_sources_unchanged=true")


if __name__ == "__main__":
    main()
