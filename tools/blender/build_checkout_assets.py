"""Build the production Pinehollow cash-register asset kit.

Run from the repository root:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
        --background --factory-startup \
        --python tools/blender/build_checkout_assets.py

The script is the sole build entry point for the production checkout kit.  It
authors in metres, saves one traceable .blend source per asset under
asset_sources/blender/cash_register/, and exports hierarchical GLBs into the
existing vendor/models/clubhouse/ pipeline.

Coordinate convention:
    X  left/right across the counter
    Y  depth; -Y is the staff/player side, +Y is the customer side
    Z  up

Raw Tripo files are never opened or modified by this build.
"""

from __future__ import annotations

import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector


SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[2]
SOURCE_DIR = ROOT / "asset_sources" / "blender" / "cash_register"
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
SOURCE_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

BUILD_VERSION = 5

PALETTE = {
    "cream": (0.91, 0.86, 0.73, 1.0),
    "offwhite": (0.95, 0.93, 0.86, 1.0),
    "green": (0.055, 0.22, 0.12, 1.0),
    "sage": (0.38, 0.52, 0.40, 1.0),
    "walnut": (0.28, 0.17, 0.095, 1.0),
    "walnut_dark": (0.13, 0.075, 0.040, 1.0),
    "oak": (0.66, 0.47, 0.27, 1.0),
    "charcoal": (0.055, 0.065, 0.075, 1.0),
    "plastic": (0.12, 0.14, 0.16, 1.0),
    "rubber": (0.025, 0.030, 0.035, 1.0),
    "brass": (0.58, 0.39, 0.12, 1.0),
    "steel": (0.52, 0.57, 0.62, 1.0),
    "glass": (0.38, 0.65, 0.70, 0.30),
    "paper": (0.96, 0.94, 0.86, 1.0),
    "kraft": (0.62, 0.43, 0.24, 1.0),
    "red": (0.95, 0.035, 0.025, 0.22),
    "led_green": (0.08, 0.85, 0.23, 1.0),
    "collision": (1.0, 0.0, 1.0, 0.0),
}


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # CI and local rebuilds should replace the generated sources without leaving
    # .blend1 backup artifacts in the repository.
    bpy.context.preferences.filepaths.save_version = 0
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    scene.render.fps = 30
    scene.frame_start = 1
    scene.frame_end = 90
    scene["asset_build_script"] = str(SCRIPT.relative_to(ROOT)).replace("\\", "/")
    scene["asset_build_version"] = BUILD_VERSION
    scene["units"] = "meters"


def mat(
    name: str,
    color: tuple[float, float, float, float],
    *,
    roughness: float = 0.6,
    metallic: float = 0.0,
    emissive: tuple[float, float, float] | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    found = bpy.data.materials.get(name)
    if found:
        return found
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = color
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Alpha"].default_value = color[3]
    if emissive:
        socket = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        if socket:
            socket.default_value = (*emissive, 1.0)
        strength = bsdf.inputs.get("Emission Strength")
        if strength:
            strength.default_value = emission_strength
    if color[3] < 1.0:
        if hasattr(material, "surface_render_method"):
            material.surface_render_method = "DITHERED"
        material.use_transparency_overlap = False
    return material


def materials() -> dict[str, bpy.types.Material]:
    return {
        "cream": mat("M_Cream", PALETTE["cream"], roughness=0.58),
        "offwhite": mat("M_OffWhite", PALETTE["offwhite"], roughness=0.68),
        "green": mat("M_DeepGreen", PALETTE["green"], roughness=0.52),
        "sage": mat("M_Sage", PALETTE["sage"], roughness=0.66),
        "walnut": mat("M_Walnut", PALETTE["walnut"], roughness=0.50),
        "walnut_dark": mat("M_DarkWalnut", PALETTE["walnut_dark"], roughness=0.56),
        "oak": mat("M_NaturalOak", PALETTE["oak"], roughness=0.57),
        "charcoal": mat("M_Charcoal", PALETTE["charcoal"], roughness=0.43),
        "plastic": mat("M_Plastic", PALETTE["plastic"], roughness=0.48),
        "rubber": mat("M_Rubber", PALETTE["rubber"], roughness=0.90),
        "brass": mat("M_Brass", PALETTE["brass"], roughness=0.30, metallic=0.88),
        "steel": mat("M_Steel", PALETTE["steel"], roughness=0.27, metallic=0.92),
        "glass": mat("M_Glass", PALETTE["glass"], roughness=0.10),
        "paper": mat("M_Paper", PALETTE["paper"], roughness=0.88),
        "kraft": mat("M_Kraft", PALETTE["kraft"], roughness=0.83),
        "screen": mat(
            "M_Screen",
            (0.025, 0.055, 0.040, 1.0),
            roughness=0.18,
            emissive=(0.015, 0.09, 0.045),
            emission_strength=0.45,
        ),
        "beam": mat(
            "M_ScannerBeam",
            PALETTE["red"],
            roughness=0.20,
            emissive=(1.0, 0.0, 0.0),
            emission_strength=4.0,
        ),
        "led": mat(
            "M_StatusLED",
            PALETTE["led_green"],
            roughness=0.18,
            emissive=(0.04, 1.0, 0.15),
            emission_strength=3.5,
        ),
        "warm_led": mat(
            "M_WarmCounterLED",
            (0.96, 0.58, 0.18, 1.0),
            roughness=0.24,
            emissive=(1.0, 0.42, 0.08),
            emission_strength=2.4,
        ),
        "collision": mat("M_Collision", PALETTE["collision"], roughness=1.0),
    }


def activate(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_rotation_scale(obj: bpy.types.Object) -> None:
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def finish_mesh(
    obj: bpy.types.Object,
    material: bpy.types.Material | None,
    *,
    bevel_width: float = 0.0,
    bevel_segments: int = 2,
    uv: bool = True,
) -> bpy.types.Object:
    apply_rotation_scale(obj)
    if bevel_width > 0:
        mod = obj.modifiers.new("EdgeSoftening", "BEVEL")
        mod.width = bevel_width
        mod.segments = bevel_segments
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(36)
        activate(obj)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if material:
        obj.data.materials.clear()
        obj.data.materials.append(material)
    if uv and obj.data.polygons:
        activate(obj)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.03)
        bpy.ops.object.mode_set(mode="OBJECT")
    activate(obj)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(42))
    except Exception:
        pass
    return obj


def parent_keep(obj: bpy.types.Object, parent: bpy.types.Object | None) -> bpy.types.Object:
    if parent is None:
        return obj
    # Newly linked empties do not have an evaluated matrix_world until the view
    # layer updates.  Without this update their authored location collapses to
    # the parent's origin, destroying hinge, slide and interaction pivots.
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_parent_inverse = parent.matrix_world.inverted()
    obj.matrix_world = world
    bpy.context.view_layer.update()
    return obj


def empty(
    name: str,
    loc=(0.0, 0.0, 0.0),
    rot=(0.0, 0.0, 0.0),
    *,
    parent: bpy.types.Object | None = None,
    display: str = "PLAIN_AXES",
    size: float = 0.06,
    props: dict | None = None,
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = rot
    obj.empty_display_type = display
    obj.empty_display_size = size
    parent_keep(obj, parent)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def asset_root(asset_id: str, dimensions: tuple[float, float, float]) -> bpy.types.Object:
    root = empty(
        asset_id,
        props={
            "asset_id": asset_id,
            "asset_version": BUILD_VERSION,
            "units": "meters",
            "front": "-Y (staff/player side)",
            "target_dimensions_m": list(dimensions),
            "source": "Original Pinehollow Golf asset generated in-repository",
            "license": "Project-owned / UNLICENSED",
        },
        size=0.10,
    )
    return root


def box(
    name: str,
    dims,
    loc,
    material,
    *,
    rot=(0.0, 0.0, 0.0),
    bevel=0.004,
    parent=None,
    props=None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    finish_mesh(obj, material, bevel_width=min(bevel, min(dims) * 0.24) if bevel else 0.0)
    parent_keep(obj, parent)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def cylinder(
    name: str,
    radius: float,
    depth: float,
    loc,
    material,
    *,
    rot=(0.0, 0.0, 0.0),
    vertices=20,
    bevel=0.002,
    parent=None,
    props=None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=loc,
        rotation=rot,
    )
    obj = bpy.context.object
    obj.name = name
    finish_mesh(obj, material, bevel_width=min(bevel, radius * 0.35, depth * 0.2) if bevel else 0.0)
    parent_keep(obj, parent)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def torus(
    name: str,
    major_radius: float,
    minor_radius: float,
    loc,
    material,
    *,
    rot=(0.0, 0.0, 0.0),
    parent=None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=24,
        minor_segments=8,
        location=loc,
        rotation=rot,
    )
    obj = bpy.context.object
    obj.name = name
    finish_mesh(obj, material)
    parent_keep(obj, parent)
    return obj


def panel_mesh(
    name: str,
    front_points: list[tuple[float, float]],
    thickness: float,
    y: float,
    material,
    *,
    parent=None,
    bevel=0.003,
) -> bpy.types.Object:
    """Create a closed X/Z silhouette extruded through Y."""
    half = thickness / 2.0
    verts = [(x, y - half, z) for x, z in front_points]
    verts += [(x, y + half, z) for x, z in front_points]
    n = len(front_points)
    faces = [tuple(range(n)), tuple(range(n, n * 2))[::-1]]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish_mesh(obj, material, bevel_width=bevel)
    parent_keep(obj, parent)
    return obj


def curve_tube(
    name: str,
    points: list[tuple[float, float, float]],
    radius: float,
    material,
    *,
    parent=None,
) -> bpy.types.Object:
    curve = bpy.data.curves.new(name + "Curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for bp, point in zip(spline.bezier_points, points):
        bp.co = point
        bp.handle_left_type = "AUTO"
        bp.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    activate(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.name = name
    finish_mesh(obj, material)
    parent_keep(obj, parent)
    return obj


def text_mesh(
    name: str,
    text: str,
    loc,
    material,
    *,
    size: float,
    rot=(math.pi / 2, 0.0, 0.0),
    parent=None,
) -> bpy.types.Object:
    bpy.ops.object.text_add(location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.data.body = text
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.size = size
    obj.data.extrude = 0.0007
    obj.data.bevel_depth = 0.0004
    obj.data.bevel_resolution = 1
    obj.data.materials.append(material)
    activate(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.name = name
    finish_mesh(obj, material, bevel_width=0.0)
    parent_keep(obj, parent)
    return obj


def collision_box(name: str, dims, loc, M, *, parent=None) -> bpy.types.Object:
    obj = box(
        name,
        dims,
        loc,
        M["collision"],
        bevel=0.0,
        parent=parent,
        props={"collision_proxy": True, "shape": "box"},
    )
    obj.display_type = "WIRE"
    obj.show_in_front = True
    return obj


def anchor(name: str, loc, *, rot=(0.0, 0.0, 0.0), parent=None, kind="interaction", props=None):
    values = {"anchor": True, "anchor_kind": kind}
    values.update(props or {})
    return empty(name, loc, rot, parent=parent, display="ARROWS", size=0.045, props=values)


def set_action_name(obj: bpy.types.Object, name: str) -> None:
    if obj.animation_data and obj.animation_data.action:
        obj.animation_data.action.name = name
        # Blender 5.0 moved action curves behind layered action slots.  Keyframes
        # inserted through Object.keyframe_insert already use Bezier interpolation;
        # naming the action is the only cross-version operation needed here.


def key_location(obj: bpy.types.Object, frame: int, value) -> None:
    obj.location = value
    obj.keyframe_insert(data_path="location", frame=frame)


def key_rotation(obj: bpy.types.Object, frame: int, value) -> None:
    obj.rotation_euler = value
    obj.keyframe_insert(data_path="rotation_euler", frame=frame)


def build_drawer(M):
    root = asset_root("checkout_cash_drawer", (0.50, 0.80, 0.18))
    housing = empty("DrawerHousing", parent=root, props={"component": "static_housing"})

    box("HousingTop", (0.50, 0.46, 0.024), (0, 0, 0.168), M["charcoal"], bevel=0.006, parent=housing)
    box("HousingBottom", (0.50, 0.46, 0.018), (0, 0, 0.009), M["charcoal"], bevel=0.004, parent=housing)
    box("HousingLeft", (0.024, 0.46, 0.15), (-0.238, 0, 0.086), M["charcoal"], bevel=0.004, parent=housing)
    box("HousingRight", (0.024, 0.46, 0.15), (0.238, 0, 0.086), M["charcoal"], bevel=0.004, parent=housing)
    box("HousingBack", (0.45, 0.024, 0.15), (0, 0.218, 0.086), M["charcoal"], bevel=0.004, parent=housing)
    box("HousingBrassLine", (0.42, 0.012, 0.010), (0, -0.226, 0.155), M["brass"], bevel=0.003, parent=housing)

    slide = empty(
        "DrawerSlide",
        (0, 0, 0.020),
        parent=root,
        props={"component": "moving_slide", "axis": "-Y", "travel_m": 0.34},
    )
    box("SlideFloor", (0.44, 0.40, 0.018), (0, -0.005, 0.038), M["plastic"], bevel=0.003, parent=slide)
    box("SlideLeftWall", (0.018, 0.39, 0.105), (-0.211, -0.005, 0.082), M["plastic"], bevel=0.003, parent=slide)
    box("SlideRightWall", (0.018, 0.39, 0.105), (0.211, -0.005, 0.082), M["plastic"], bevel=0.003, parent=slide)
    box("SlideBackWall", (0.405, 0.018, 0.105), (0, 0.185, 0.082), M["plastic"], bevel=0.003, parent=slide)
    box("DrawerFace", (0.48, 0.026, 0.145), (0, -0.220, 0.088), M["charcoal"], bevel=0.007, parent=slide)
    box("DrawerPull", (0.18, 0.026, 0.024), (0, -0.240, 0.110), M["steel"], bevel=0.007, parent=slide)
    box("CashTray", (0.415, 0.355, 0.009), (0, -0.005, 0.052), M["plastic"], bevel=0.002, parent=slide)

    # A US bill is approximately 0.156 x 0.066 m.  Each 0.076 x 0.190 m
    # clear well therefore gives the bill 5 mm of side clearance and enough
    # length for a natural finger pickup while keeping denominations separated.
    bills = [1, 5, 10, 20, 50]
    x0 = -0.164
    pitch = 0.082
    well_width = pitch - 0.006
    well_depth = 0.190
    for i in range(6):
        x = x0 - pitch / 2 + i * pitch
        box(f"BillDivider_{i}", (0.006, 0.190, 0.045), (x, -0.095, 0.078), M["plastic"], bevel=0.001, parent=slide)
        box(
            f"BillDividerCap_{i}",
            (0.004, 0.184, 0.004),
            (x, -0.095, 0.102),
            M["sage"],
            bevel=0.001,
            parent=slide,
        )
    box("BillWellFront", (0.420, 0.006, 0.045), (0, -0.192, 0.078), M["plastic"], bevel=0.001, parent=slide)
    box("BillWellBack", (0.420, 0.006, 0.045), (0, 0.002, 0.078), M["plastic"], bevel=0.001, parent=slide)

    clip_pivots = []
    for i, denom in enumerate(bills):
        x = x0 + i * pitch
        box(
            f"BillWellFelt_{denom}",
            (well_width - 0.004, well_depth - 0.008, 0.004),
            (x, -0.095, 0.059),
            M["green"],
            bevel=0.001,
            parent=slide,
            props={
                "component": "bill_well_liner",
                "denomination": float(denom),
                "clear_width_m": well_width,
                "clear_depth_m": well_depth,
                "fits_bill_width_m": 0.066,
                "fits_bill_length_m": 0.156,
            },
        )
        anchor(
            f"ANCHOR_BillWell_{denom}",
            (x, -0.095, 0.085),
            parent=slide,
            kind="denomination",
            props={
                "denomination": float(denom),
                "currency_type": "bill",
                "well_width_m": well_width,
                "well_depth_m": well_depth,
            },
        )
        pivot = empty(
            f"BillClipPivot_{denom}",
            (x, 0.005, 0.118),
            parent=slide,
            props={"component": "bill_clip", "denomination": float(denom), "hinge_axis": "X"},
        )
        cylinder(
            f"BillClipHinge_{denom}",
            0.008,
            0.054,
            (x, 0.004, 0.118),
            M["brass"],
            rot=(0, math.pi / 2, 0),
            vertices=12,
            bevel=0.001,
            parent=pivot,
        )
        box(f"BillClipArm_{denom}", (0.014, 0.125, 0.010), (x, -0.058, 0.118), M["charcoal"], bevel=0.003, parent=pivot)
        cylinder(
            f"BillClipRoller_{denom}",
            0.009,
            0.058,
            (x, -0.122, 0.118),
            M["brass"],
            rot=(0, math.pi / 2, 0),
            vertices=12,
            bevel=0.001,
            parent=pivot,
        )
        box(
            f"BillLabelPlate_{denom}",
            (0.056, 0.030, 0.005),
            (x, -0.122, 0.129),
            M["cream"],
            bevel=0.002,
            parent=pivot,
            props={"component": "denomination_label", "denomination": float(denom), "currency_type": "bill"},
        )
        label_text = text_mesh(
            f"BillLabelText_{denom}",
            f"${denom}",
            (x, -0.122, 0.133),
            M["green"],
            size=0.016 if denom < 10 else 0.014,
            rot=(0.0, 0.0, 0.0),
            parent=pivot,
        )
        label_text["component"] = "denomination_label_text"
        label_text["denomination"] = float(denom)
        label_text["currency_type"] = "bill"
        clip_pivots.append(pivot)

    # Five compact coin cups mirror the live exact-cent denomination set. Their
    # 82 mm pitch matches the bill wells while retaining 8 mm between rims.
    coins = [(1, -0.164), (5, -0.082), (10, 0.0), (25, 0.082), (50, 0.164)]
    for cents, x in coins:
        torus(f"CoinCupRim_{cents}", 0.037, 0.005, (x, 0.108, 0.080), M["brass"], parent=slide)
        cylinder(f"CoinCupFloor_{cents}", 0.032, 0.006, (x, 0.108, 0.055), M["green"], vertices=20, bevel=0.001, parent=slide)
        box(
            f"CoinLabelPlate_{cents}",
            (0.052, 0.004, 0.024),
            (x, 0.049, 0.074),
            M["cream"],
            bevel=0.002,
            parent=slide,
            props={"component": "denomination_label", "denomination": cents / 100.0, "currency_type": "coin"},
        )
        coin_text = text_mesh(
            f"CoinLabelText_{cents}",
            f"{cents}c",
            (x, 0.046, 0.074),
            M["green"],
            size=0.012 if cents < 10 else 0.011,
            parent=slide,
        )
        coin_text["component"] = "denomination_label_text"
        coin_text["denomination"] = cents / 100.0
        coin_text["currency_type"] = "coin"
        anchor(
            f"ANCHOR_CoinCup_{cents}",
            (x, 0.108, 0.085),
            parent=slide,
            kind="denomination",
            props={"denomination": cents / 100.0, "currency_type": "coin"},
        )

    latch = empty("DrawerLockPivot", (0, -0.230, 0.090), parent=housing, props={"hinge_axis": "Z"})
    box("DrawerLockTongue", (0.040, 0.010, 0.012), (0.018, -0.238, 0.090), M["brass"], bevel=0.003, parent=latch)

    anchor("ANCHOR_DrawerPull", (0, -0.248, 0.110), parent=slide, kind="grip")
    anchor("ANCHOR_DrawerClosed", (0, 0, 0.020), parent=root, kind="pose")
    anchor("ANCHOR_DrawerOpen", (0, -0.34, 0.020), parent=root, kind="pose")
    anchor("ANCHOR_CashDeposit", (0, -0.04, 0.150), parent=slide, kind="drop_zone", props={"radius_m": 0.25})

    collision_box("COL_DrawerHousing", (0.50, 0.46, 0.18), (0, 0, 0.09), M, parent=housing)
    collision_box("COL_DrawerSlide", (0.46, 0.41, 0.14), (0, -0.01, 0.09), M, parent=slide)

    key_location(slide, 1, (0, 0, 0.020))
    key_location(slide, 9, (0, 0, 0.020))
    key_location(slide, 24, (0, -0.34, 0.020))
    key_location(slide, 58, (0, -0.34, 0.020))
    key_location(slide, 76, (0, 0, 0.020))
    set_action_name(slide, "DrawerSlide_OpenHoldClose")

    key_rotation(latch, 1, (0, 0, 0))
    key_rotation(latch, 5, (0, 0, math.radians(28)))
    key_rotation(latch, 10, (0, 0, 0))
    set_action_name(latch, "DrawerLock_Unlock")

    for pivot in clip_pivots:
        key_rotation(pivot, 1, (0, 0, 0))
        key_rotation(pivot, 28, (0, 0, 0))
        key_rotation(pivot, 36, (math.radians(-52), 0, 0))
        key_rotation(pivot, 48, (math.radians(-52), 0, 0))
        key_rotation(pivot, 55, (0, 0, 0))
        set_action_name(pivot, pivot.name.replace("Pivot", "") + "_Lift")

    bpy.context.scene.frame_set(1)
    return root


def build_scanner(M):
    root = asset_root("checkout_scanner", (0.24, 0.30, 0.19))
    body = empty("ScannerBody", parent=root)
    box("ScannerBase", (0.24, 0.30, 0.040), (0, 0, 0.020), M["charcoal"], bevel=0.012, parent=body)
    box("ScannerDeck", (0.215, 0.255, 0.060), (0, 0.006, 0.064), M["plastic"], rot=(math.radians(-7), 0, 0), bevel=0.012, parent=body)
    box("ScannerGlass", (0.178, 0.190, 0.006), (0, -0.002, 0.099), M["glass"], rot=(math.radians(-7), 0, 0), bevel=0.004, parent=body)
    box("ScannerBeamLens", (0.158, 0.014, 0.006), (0, -0.072, 0.108), M["beam"], rot=(math.radians(-7), 0, 0), bevel=0.002, parent=body)
    box("ScannerStatusBar", (0.050, 0.010, 0.005), (0.068, 0.105, 0.105), M["led"], rot=(math.radians(-7), 0, 0), bevel=0.002, parent=body)
    beam = box(
        "ScannerBeam",
        (0.175, 0.140, 0.075),
        (0, -0.030, 0.147),
        M["beam"],
        bevel=0.0,
        parent=root,
        props={"effect_mesh": True, "default_visible": False},
    )
    beam.display_type = "WIRE"

    anchor(
        "ANCHOR_ScanZone",
        (0, -0.015, 0.155),
        parent=root,
        kind="volume",
        props={"size_x_m": 0.24, "size_y_m": 0.24, "size_z_m": 0.18},
    )
    anchor("ANCHOR_ScanNormal", (0, -0.010, 0.108), rot=(math.radians(-7), 0, 0), parent=root, kind="direction")
    anchor("ANCHOR_BeamEmitter", (0, -0.072, 0.112), rot=(math.radians(-7), 0, 0), parent=root, kind="effect")
    anchor("ANCHOR_ScannerGrip", (0, -0.120, 0.045), parent=root, kind="grip")
    collision_box("COL_Scanner", (0.24, 0.30, 0.105), (0, 0, 0.0525), M, parent=root)
    return root


def build_card_reader(M):
    root = asset_root("checkout_card_reader", (0.15, 0.21, 0.11))
    body = empty("CardReaderBody", parent=root)
    box("ReaderLowerShell", (0.112, 0.205, 0.050), (0, 0, 0.027), M["charcoal"], bevel=0.014, parent=body)
    box("ReaderUpperShell", (0.108, 0.185, 0.040), (0, 0.006, 0.061), M["plastic"], rot=(math.radians(-9), 0, 0), bevel=0.012, parent=body)
    box("ReaderScreen", (0.070, 0.046, 0.004), (0, 0.040, 0.084), M["screen"], rot=(math.radians(-9), 0, 0), bevel=0.003, parent=body)
    box("ContactlessPad", (0.074, 0.038, 0.004), (0, 0.094, 0.075), M["green"], rot=(math.radians(-9), 0, 0), bevel=0.006, parent=body)
    for ring_radius in (0.010, 0.017, 0.024):
        torus("ContactlessWave_%02d" % round(ring_radius * 1000), ring_radius, 0.0015, (0, 0.094, 0.078), M["brass"], rot=(0, 0, 0), parent=body)

    for row in range(4):
        for col in range(3):
            name = f"Key_{row + 1}_{col + 1}"
            x = -0.025 + col * 0.025
            y = 0.005 - row * 0.026
            material = M["plastic"] if row < 3 else (M["green"] if col == 2 else M["cream"])
            box(name, (0.019, 0.017, 0.006), (x, y, 0.083 - row * 0.004), material, rot=(math.radians(-9), 0, 0), bevel=0.004, parent=body)

    # ISO/IEC 7810 ID-1 cards are 85.60 mm wide.  The 96 mm clear slot and
    # shallow funnel leave believable tolerance while remaining readable from
    # the first-person camera.  This replaces the obsolete side swipe rail.
    chip_slot = box(
        "ChipSlot",
        (0.096, 0.011, 0.009),
        (0, -0.104, 0.034),
        M["rubber"],
        bevel=0.002,
        parent=body,
        props={"clear_width_m": 0.096, "card_standard": "ISO_IEC_7810_ID_1"},
    )
    box("ChipSlotBezelTop", (0.112, 0.018, 0.008), (0, -0.101, 0.044), M["charcoal"], bevel=0.003, parent=body)
    box("ChipSlotBezelBottom", (0.112, 0.018, 0.008), (0, -0.101, 0.024), M["charcoal"], bevel=0.003, parent=body)
    box("StatusLED", (0.020, 0.005, 0.006), (-0.035, -0.101, 0.055), M["led"], bevel=0.002, parent=body)

    anchor("ANCHOR_Screen", (0, 0.040, 0.087), rot=(math.radians(-9), 0, 0), parent=root, kind="screen", props={"width_m": 0.068, "height_m": 0.044})
    anchor("ANCHOR_Contactless", (0, 0.094, 0.080), rot=(math.radians(-9), 0, 0), parent=root, kind="payment")
    anchor("ANCHOR_ChipSlot", (0, -0.111, 0.034), parent=root, kind="payment", props={"clear_width_m": 0.096})
    anchor("ANCHOR_CardReady", (0, -0.200, 0.034), parent=root, kind="card_pose", props={"insertion_u": 0.0})
    anchor("ANCHOR_CardInserted", (0, -0.125, 0.034), parent=root, kind="card_pose", props={"insertion_u": 1.0})
    anchor("ANCHOR_CardGrip", (0, -0.180, 0.034), parent=root, kind="grip")
    collision_box("COL_CardReader", (0.15, 0.21, 0.11), (0, 0, 0.055), M, parent=root)
    return root


def receipt_paper(name: str, width: float, length: float, material, *, parent=None):
    verts = [
        (-width / 2, 0, 0),
        (width / 2, 0, 0),
        (width / 2, -length, 0),
        (-width / 2, -length, 0),
    ]
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish_mesh(obj, material, bevel_width=0.0)
    parent_keep(obj, parent)
    return obj


def build_printer(M):
    root = asset_root("checkout_receipt_printer", (0.19, 0.23, 0.27))
    body = empty("PrinterBody", parent=root)
    box("PrinterLowerShell", (0.185, 0.225, 0.120), (0, 0, 0.060), M["charcoal"], bevel=0.014, parent=body)
    box("PrinterFrontPanel", (0.170, 0.020, 0.085), (0, -0.112, 0.070), M["plastic"], bevel=0.008, parent=body)
    box("PrinterFeedSlot", (0.110, 0.010, 0.012), (0, -0.080, 0.132), M["rubber"], bevel=0.003, parent=body)
    box("PrinterStatusLED", (0.028, 0.008, 0.007), (0.060, -0.116, 0.095), M["led"], bevel=0.002, parent=body)

    roll_pivot = empty("PaperRollPivot", (0, 0.035, 0.100), parent=root, props={"axis": "X"})
    cylinder("PaperRoll", 0.045, 0.105, (0, 0.035, 0.100), M["paper"], rot=(0, math.pi / 2, 0), vertices=28, bevel=0.002, parent=roll_pivot)
    cylinder("PaperRollCore", 0.013, 0.110, (0, 0.035, 0.100), M["kraft"], rot=(0, math.pi / 2, 0), vertices=20, bevel=0.001, parent=roll_pivot)

    lid = empty("PrinterLidPivot", (0, 0.095, 0.120), parent=root, props={"component": "moving_lid", "hinge_axis": "X"})
    box("PrinterLid", (0.175, 0.145, 0.026), (0, 0.027, 0.139), M["plastic"], bevel=0.010, parent=lid)
    box("PrinterTearBar", (0.115, 0.012, 0.010), (0, -0.050, 0.146), M["steel"], bevel=0.002, parent=lid)

    feed = empty("ReceiptFeedPivot", (0, -0.083, 0.139), rot=(math.radians(7), 0, 0), parent=root, props={"component": "moving_receipt", "axis": "-Y"})
    paper = receipt_paper("ReceiptPaper", 0.095, 0.180, M["paper"], parent=feed)
    paper.location = (0, 0.160, 0)
    paper["printable_surface"] = True

    anchor("ANCHOR_PaperRoll", (0, 0.035, 0.100), parent=root, kind="pivot")
    anchor("ANCHOR_ReceiptFeed", (0, -0.083, 0.141), rot=(math.radians(7), 0, 0), parent=root, kind="feed")
    anchor("ANCHOR_Tear", (0, -0.090, 0.148), parent=root, kind="tear")
    anchor("ANCHOR_ReceiptPickup", (0, -0.190, 0.165), parent=root, kind="grip")
    collision_box("COL_ReceiptPrinter", (0.19, 0.23, 0.15), (0, 0, 0.075), M, parent=root)

    key_location(paper, 1, (0, 0.160, 0))
    key_location(paper, 10, (0, 0.160, 0))
    key_location(paper, 38, (0, 0.000, 0))
    key_location(paper, 62, (0, 0.000, 0))
    set_action_name(paper, "ReceiptPaper_PrintFeed")

    key_rotation(roll_pivot, 1, (0, 0, 0))
    key_rotation(roll_pivot, 38, (math.radians(220), 0, 0))
    set_action_name(roll_pivot, "PaperRoll_Feed")

    key_rotation(lid, 1, (0, 0, 0))
    key_rotation(lid, 70, (0, 0, 0))
    key_rotation(lid, 82, (math.radians(-55), 0, 0))
    set_action_name(lid, "PrinterLid_ServiceOpen")
    bpy.context.scene.frame_set(1)
    return root


def build_bag(M):
    root = asset_root("checkout_shopping_bag", (0.32, 0.18, 0.51))
    body = empty("ShoppingBagBody", parent=root)
    W_BOTTOM, W_TOP, D, H = 0.28, 0.32, 0.18, 0.38
    front = [(-W_BOTTOM / 2, 0), (W_BOTTOM / 2, 0), (W_TOP / 2, H), (-W_TOP / 2, H)]
    panel_mesh("BagFront", front, 0.005, -D / 2, M["kraft"], parent=body, bevel=0.002)
    panel_mesh("BagBack", front, 0.005, D / 2, M["kraft"], parent=body, bevel=0.002)
    side = [(-D / 2, 0), (D / 2, 0), (D / 2, H), (-D / 2, H)]
    left = panel_mesh("BagLeftGusset", side, 0.005, -W_TOP / 2, M["kraft"], parent=body, bevel=0.002)
    left.rotation_euler[2] = math.pi / 2
    apply_rotation_scale(left)
    right = panel_mesh("BagRightGusset", side, 0.005, W_TOP / 2, M["kraft"], parent=body, bevel=0.002)
    right.rotation_euler[2] = math.pi / 2
    apply_rotation_scale(right)
    box("BagFloor", (W_BOTTOM, D, 0.008), (0, 0, 0.004), M["kraft"], bevel=0.003, parent=body)
    box("BagFrontLip", (W_TOP + 0.010, 0.013, 0.016), (0, -D / 2, H - 0.006), M["cream"], bevel=0.005, parent=body)
    box("BagBackLip", (W_TOP + 0.010, 0.013, 0.016), (0, D / 2, H - 0.006), M["cream"], bevel=0.005, parent=body)
    box("BagInteriorShadow", (W_BOTTOM * 0.88, D * 0.80, 0.010), (0, 0, 0.030), M["charcoal"], bevel=0.003, parent=body)

    badge = box("PinehollowBadge", (0.205, 0.005, 0.105), (0, -D / 2 - 0.004, 0.225), M["green"], bevel=0.009, parent=body)
    badge["original_branding"] = True
    text_mesh("PinehollowWordmark", "PINEHOLLOW", (0, -D / 2 - 0.008, 0.238), M["cream"], size=0.026, parent=body)
    text_mesh("ProShopWordmark", "PRO SHOP", (0, -D / 2 - 0.008, 0.203), M["brass"], size=0.015, parent=body)

    front_pivot = empty("BagHandleFrontPivot", (0, -D / 2, H - 0.010), parent=root, props={"component": "moving_handle", "hinge_axis": "X"})
    back_pivot = empty("BagHandleBackPivot", (0, D / 2, H - 0.010), parent=root, props={"component": "moving_handle", "hinge_axis": "X"})
    curve_tube(
        "BagHandleFront",
        [(-0.095, -D / 2, H - 0.010), (-0.095, -D / 2, H + 0.095), (0, -D / 2, H + 0.125), (0.095, -D / 2, H + 0.095), (0.095, -D / 2, H - 0.010)],
        0.006,
        M["kraft"],
        parent=front_pivot,
    )
    curve_tube(
        "BagHandleBack",
        [(-0.095, D / 2, H - 0.010), (-0.095, D / 2, H + 0.095), (0, D / 2, H + 0.125), (0.095, D / 2, H + 0.095), (0.095, D / 2, H - 0.010)],
        0.006,
        M["kraft"],
        parent=back_pivot,
    )

    anchor("ANCHOR_BagDrop", (0, 0, H + 0.035), parent=root, kind="drop_zone", props={"radius_m": 0.20})
    anchor("ANCHOR_BagContents", (0, 0, 0.16), parent=root, kind="contents")
    anchor("ANCHOR_BagHandleFront", (0, -D / 2, H + 0.110), parent=front_pivot, kind="grip")
    anchor("ANCHOR_BagHandleBack", (0, D / 2, H + 0.110), parent=back_pivot, kind="grip")
    anchor("ANCHOR_BagHandoff", (0, 0, H + 0.125), parent=root, kind="handoff")
    anchor("ANCHOR_ReceiptPocket", (0, -0.055, 0.27), parent=root, kind="receipt")
    collision_box("COL_ShoppingBag", (0.32, 0.18, 0.38), (0, 0, 0.19), M, parent=root)
    contents = collision_box("VOLUME_BagContents", (0.25, 0.13, 0.28), (0, 0, 0.17), M, parent=root)
    contents["contents_volume"] = True

    key_rotation(front_pivot, 1, (math.radians(-24), 0, 0))
    key_rotation(front_pivot, 15, (math.radians(-24), 0, 0))
    key_rotation(front_pivot, 32, (0, 0, 0))
    set_action_name(front_pivot, "BagHandleFront_Gather")
    key_rotation(back_pivot, 1, (math.radians(24), 0, 0))
    key_rotation(back_pivot, 15, (math.radians(24), 0, 0))
    key_rotation(back_pivot, 32, (0, 0, 0))
    set_action_name(back_pivot, "BagHandleBack_Gather")
    bpy.context.scene.frame_set(1)
    return root


def build_counter(M):
    """Production shell for reference Asset 01.

    The live checkout reach/collision plan is deliberately 3.10 x 0.96 m, so
    this build preserves that tested footprint and every ANCHOR_/COL_ contract.
    Its visible language follows the sheet: black worktop, vertical natural-oak
    slats, a warm reveal light, recessed dark plinth and an open staff shelf.
    """
    root = asset_root("checkout_counter", (3.10, 0.96, 1.00))
    furniture = empty("CheckoutCounterFurniture", parent=root)

    box("CounterTop", (3.10, 0.96, 0.070), (0, 0, 0.965), M["charcoal"], bevel=0.020, parent=furniture)
    box("CustomerApronBacking", (2.98, 0.055, 0.80), (0, 0.422, 0.510), M["charcoal"], bevel=0.008, parent=furniture)
    box("CounterPlinth", (3.00, 0.72, 0.090), (0, 0.035, 0.045), M["charcoal"], bevel=0.010, parent=furniture)

    # Individually modelled slats keep real shadow gaps at first-person range.
    slat_count = 48
    slat_pitch = 2.92 / slat_count
    slat_width = slat_pitch - 0.009
    for index in range(slat_count):
        x = -1.46 + slat_pitch * (index + 0.5)
        material = M["oak"] if index % 5 else M["walnut"]
        box(
            f"CustomerOakSlat_{index + 1:02d}",
            (slat_width, 0.034, 0.735),
            (x, 0.462, 0.515),
            material,
            bevel=0.0,
            parent=furniture,
        )
    # Carry the same rhythm around both end cheeks so the model reads finished
    # from the queue and from either end of the island.
    end_pitch = 0.82 / 13
    for side, x in (("L", -1.506), ("R", 1.506)):
        for index in range(13):
            y = -0.39 + end_pitch * (index + 0.5)
            material = M["oak"] if index % 4 else M["walnut"]
            box(
                f"EndOakSlat_{side}_{index + 1:02d}",
                (0.034, end_pitch - 0.009, 0.735),
                (x, y, 0.515),
                material,
                bevel=0.0,
                parent=furniture,
            )

    box("CounterLEDFront", (2.94, 0.012, 0.012), (0, 0.470, 0.910), M["warm_led"], bevel=0.002, parent=furniture)
    box("CounterLEDEndL", (0.012, 0.84, 0.012), (-1.520, 0.0, 0.910), M["warm_led"], bevel=0.002, parent=furniture)
    box("CounterLEDEndR", (0.012, 0.84, 0.012), (1.520, 0.0, 0.910), M["warm_led"], bevel=0.002, parent=furniture)

    # Closed equipment cabinets flank a warm, stocked staff-side shelf. The
    # original all-cream cavity clipped under shop lighting and read unfinished
    # across the lower third of the first-person checkout frame.
    box("StaffCabinetLeft", (1.10, 0.62, 0.82), (-0.88, -0.090, 0.455), M["charcoal"], bevel=0.014, parent=furniture)
    box("StaffCabinetRight", (0.82, 0.62, 0.82), (1.02, -0.090, 0.455), M["charcoal"], bevel=0.014, parent=furniture)
    box("StaffShelfBack", (0.74, 0.035, 0.70), (0.10, 0.185, 0.500), M["walnut_dark"], bevel=0.004, parent=furniture)
    box("StaffShelfFloor", (0.74, 0.54, 0.035), (0.10, -0.065, 0.155), M["oak"], bevel=0.004, parent=furniture)
    box("StaffShelfMid", (0.74, 0.54, 0.035), (0.10, -0.065, 0.515), M["oak"], bevel=0.004, parent=furniture)
    box("StaffShelfTop", (0.74, 0.54, 0.035), (0.10, -0.065, 0.850), M["oak"], bevel=0.004, parent=furniture)
    box("StaffShelfSideL", (0.035, 0.54, 0.73), (-0.270, -0.065, 0.505), M["walnut"], bevel=0.004, parent=furniture)
    box("StaffShelfSideR", (0.035, 0.54, 0.73), (0.470, -0.065, 0.505), M["walnut"], bevel=0.004, parent=furniture)
    box("StaffReceiptStock", (0.28, 0.32, 0.14), (-0.085, -0.110, 0.243), M["cream"], bevel=0.010, parent=furniture)
    box("StaffReceiptStockBand", (0.18, 0.010, 0.036), (-0.085, -0.275, 0.244), M["green"], bevel=0.002, parent=furniture)
    for index in range(4):
        box(
            f"StaffFoldedBagStock_{index + 1:02d}",
            (0.27, 0.30, 0.022),
            (0.285, -0.095, 0.548 + index * 0.026),
            M["sage"] if index % 2 == 0 else M["kraft"],
            bevel=0.003,
            parent=furniture,
        )
    box("DrawerBay", (0.54, 0.035, 0.20), (-0.66, -0.414, 0.765), M["charcoal"], bevel=0.006, parent=furniture)

    box("StagingInlay", (0.78, 0.40, 0.010), (-0.10, 0.155, 1.006), M["green"], bevel=0.006, parent=furniture)
    box("BaggingInlay", (0.72, 0.38, 0.010), (0.94, -0.120, 1.006), M["sage"], bevel=0.006, parent=furniture)
    box("ScannerInlay", (0.30, 0.32, 0.012), (0.15, 0.020, 1.008), M["charcoal"], bevel=0.008, parent=furniture)

    cylinder("CustomerFootRail", 0.017, 2.76, (0, 0.500, 0.185), M["brass"], rot=(0, math.pi / 2, 0), vertices=16, bevel=0.002, parent=furniture)
    for x in (-1.32, 1.32):
        cylinder(f"FootRailBracket_{x:+.2f}", 0.012, 0.22, (x, 0.402, 0.185), M["brass"], rot=(math.pi / 2, 0, 0), vertices=12, bevel=0.002, parent=furniture)

    anchor("ANCHOR_POS", (-0.62, -0.12, 1.015), parent=root, kind="equipment")
    anchor("ANCHOR_DrawerHousing", (-0.66, -0.39, 0.690), parent=root, kind="equipment")
    anchor("ANCHOR_Scanner", (0.15, 0.020, 1.015), parent=root, kind="equipment")
    anchor("ANCHOR_CardReader", (-0.68, 0.290, 1.015), rot=(0, 0, math.pi), parent=root, kind="equipment")
    anchor("ANCHOR_ReceiptPrinter", (0.60, -0.20, 1.015), parent=root, kind="equipment")
    anchor("ANCHOR_Bag", (1.02, -0.10, 1.015), parent=root, kind="equipment")
    anchor("ANCHOR_Staging", (-0.10, 0.155, 1.025), parent=root, kind="surface", props={"size_x_m": 0.78, "size_y_m": 0.40})
    anchor("ANCHOR_Bagging", (0.94, -0.120, 1.025), parent=root, kind="surface", props={"size_x_m": 0.72, "size_y_m": 0.38})
    anchor("ANCHOR_StaffStand", (0.05, -1.05, 0), parent=root, kind="standing_position")
    anchor("ANCHOR_CustomerStand", (-0.62, 1.05, 0), rot=(0, 0, math.pi), parent=root, kind="standing_position")
    anchor("ANCHOR_StaffEntrance", (1.85, -0.50, 0), parent=root, kind="opening", props={"clear_width_m": 0.90})

    collision_box("COL_CounterLeft", (1.18, 0.78, 0.91), (-0.89, 0.02, 0.455), M, parent=root)
    collision_box("COL_CounterCenter", (0.72, 0.32, 0.82), (0.10, 0.25, 0.41), M, parent=root)
    collision_box("COL_CounterRight", (0.86, 0.78, 0.91), (1.03, 0.02, 0.455), M, parent=root)
    return root


BUILDERS = {
    "checkout_counter": build_counter,
    "checkout_cash_drawer": build_drawer,
    "checkout_scanner": build_scanner,
    "checkout_card_reader": build_card_reader,
    "checkout_receipt_printer": build_printer,
    "checkout_shopping_bag": build_bag,
}


def descendants(root: bpy.types.Object) -> list[bpy.types.Object]:
    out = [root]
    stack = list(root.children)
    while stack:
        obj = stack.pop(0)
        out.append(obj)
        stack.extend(obj.children)
    return out


def add_build_info(asset_id: str) -> None:
    text = bpy.data.texts.new("BUILD_INFO.txt")
    text.write(
        "Pinehollow Golf cash-register production asset\n"
        f"asset_id: {asset_id}\n"
        f"build_version: {BUILD_VERSION}\n"
        f"builder: {SCRIPT.relative_to(ROOT).as_posix()}\n"
        "units: metres\n"
        "source: original in-repository geometry; no third-party downloads\n"
        "raw Tripo sources: untouched and not imported by this build\n"
    )


def save_and_export(asset_id: str, root: bpy.types.Object) -> tuple[Path, Path]:
    add_build_info(asset_id)
    bpy.context.scene.frame_set(1)
    blend_path = SOURCE_DIR / f"{asset_id}.blend"
    glb_path = EXPORT_DIR / f"{asset_id}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)

    bpy.ops.object.select_all(action="DESELECT")
    selected = descendants(root)
    for obj in selected:
        obj.hide_viewport = False
        obj.hide_render = False
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
        export_animations=True,
        export_force_sampling=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )
    print(f"BUILT|{asset_id}|source={blend_path}|export={glb_path}|nodes={len(selected)}")
    return blend_path, glb_path


def requested_assets() -> list[str]:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if not argv:
        return list(BUILDERS)
    chosen = []
    for name in argv:
        if name not in BUILDERS:
            raise SystemExit(f"Unknown checkout asset '{name}'. Choices: {', '.join(BUILDERS)}")
        chosen.append(name)
    return chosen


def main() -> None:
    chosen = requested_assets()
    for asset_id in chosen:
        reset_scene()
        M = materials()
        root = BUILDERS[asset_id](M)
        save_and_export(asset_id, root)
    print(f"COMPLETE|assets={len(chosen)}|source_dir={SOURCE_DIR}|export_dir={EXPORT_DIR}")


if __name__ == "__main__":
    main()
