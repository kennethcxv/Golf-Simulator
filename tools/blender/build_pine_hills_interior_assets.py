"""Build the original Pine Hills clubhouse interior asset supplement.

This builder intentionally creates only new, project-owned geometry.  It does
not load or modify Asset 61; that 2.93 m counter is the dimensional datum for
the 1.27 m front extension authored here.  Together they make a 4.20 m front
run, while the new module turns into a 2.10 m staff return.

Blender 5.1 invocation::

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
      --background --factory-startup \
      --python tools/blender/build_pine_hills_interior_assets.py

Optional selection::

    ... --python tools/blender/build_pine_hills_interior_assets.py -- \
      --only front_desk_return opening_drinks_cooler

Every source uses metres, +Z up and -Y as its presentation/front side.  All
materials are procedural, stylized PBR colours from the Pinehollow palette;
there are no external meshes, fonts or textures.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Sequence

import bpy


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import assets_51_100_lib as A


REPO_ROOT = SCRIPT_DIR.parents[1]
SOURCE_DIR = REPO_ROOT / "asset_sources" / "blender" / "clubhouse"
EXPORT_DIR = REPO_ROOT / "vendor" / "models" / "clubhouse"
BUILD_MANIFEST = SOURCE_DIR / "pine_hills_interior_asset_build_manifest_v1.json"


Vec3 = tuple[float, float, float]


@dataclass(frozen=True)
class AssetSpec:
    key: str
    stem: str
    root_name: str
    target_dimensions: Vec3
    builder: Callable[[], bpy.types.Object]
    required_nodes: tuple[str, ...]
    minimum_sockets: int = 1
    dimension_tolerance: float = 0.08

    @property
    def source_path(self) -> Path:
        return SOURCE_DIR / f"{self.stem}.blend"

    @property
    def export_path(self) -> Path:
        return EXPORT_DIR / f"{self.stem}.glb"


def _root(name: str, dimensions: Vec3, role: str, *, mount: str = "floor", **props: object) -> bpy.types.Object:
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.16
    root["asset_family"] = "Pine Hills clubhouse interior supplement"
    root["asset_role"] = role
    root["asset_version"] = 1
    root["units"] = "meters"
    root["up_axis"] = "+Z"
    root["front_axis"] = "-Y"
    root["mount"] = mount
    root["target_dimensions_m"] = json.dumps([round(v, 6) for v in dimensions])
    root["source"] = "Original deterministic Blender Python authored in-repository"
    root["license"] = "Project-owned"
    root["external_assets"] = False
    root["external_textures"] = False
    root["normal_strategy"] = "applied bevels plus weighted/auto-smoothed normals"
    root["uv_strategy"] = "non-overlapping primitive cube or smart UVs"
    root["visual_style"] = (
        "Pinehollow stylized PBR: warm cream, deep golf green, muted sage, "
        "medium walnut, natural oak, warm charcoal, restrained brass"
    )
    for key, value in props.items():
        root[key] = value
    return root


def _group(name: str, parent: bpy.types.Object, **props: object) -> bpy.types.Object:
    clean = name if name.startswith("GROUP_") else f"GROUP_{name}"
    obj = bpy.data.objects.new(clean, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.08
    for key, value in props.items():
        obj[key] = value
    A.parent_keep_world(obj, parent)
    return obj


def _weighted_normals(obj: bpy.types.Object) -> bpy.types.Object:
    """Apply weighted normals where Blender exposes the modifier.

    Blender 5.x can fall back to the already-applied bevel and auto-smooth path
    on geometry where the modifier is unavailable or inapplicable.
    """

    if obj.type != "MESH" or obj.get("collision_proxy"):
        return obj
    modifier = None
    try:
        modifier = obj.modifiers.new("WeightedNormals_Production", "WEIGHTED_NORMAL")
        if hasattr(modifier, "keep_sharp"):
            modifier.keep_sharp = True
        if hasattr(modifier, "weight"):
            modifier.weight = 45
        A.activate(obj)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj["weighted_normals_applied"] = True
    except Exception:
        if modifier is not None and modifier.name in obj.modifiers:
            obj.modifiers.remove(modifier)
        obj["weighted_normals_applied"] = False
        obj["normal_fallback"] = "bevel-hardened auto smooth"
    return obj


def _box(
    name: str,
    dimensions: Vec3,
    location: Vec3,
    material: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    rotation: Vec3 = (0.0, 0.0, 0.0),
    bevel: float = 0.006,
    bevel_segments: int = 2,
    properties: dict[str, object] | None = None,
) -> bpy.types.Object:
    obj = A.box(
        name,
        dimensions,
        location,
        material,
        rotation=rotation,
        parent=parent,
        bevel=bevel,
        bevel_segments=bevel_segments,
        uv="cube",
        properties=properties,
    )
    return _weighted_normals(obj)


def _cylinder(
    name: str,
    radius: float,
    depth: float,
    location: Vec3,
    material: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    rotation: Vec3 = (0.0, 0.0, 0.0),
    vertices: int = 16,
    bevel: float = 0.002,
    properties: dict[str, object] | None = None,
) -> bpy.types.Object:
    return A.cylinder(
        name,
        radius,
        depth,
        location,
        material,
        rotation=rotation,
        vertices=vertices,
        parent=parent,
        bevel=bevel,
        properties=properties,
    )


def _cone(
    name: str,
    radius_bottom: float,
    radius_top: float,
    depth: float,
    location: Vec3,
    material: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    rotation: Vec3 = (0.0, 0.0, 0.0),
    vertices: int = 16,
    bevel: float = 0.002,
    properties: dict[str, object] | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(
        vertices=max(8, int(vertices)),
        radius1=float(radius_bottom),
        radius2=float(radius_top),
        depth=float(depth),
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name if name.startswith("MESH_") else f"MESH_{name}"
    A.finish_mesh(obj, material, bevel=bevel, bevel_segments=2, uv="smart", smooth=True, properties=properties)
    A.parent_keep_world(obj, parent)
    return obj


def _ellipsoid(
    name: str,
    dimensions: Vec3,
    location: Vec3,
    material: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    rotation: Vec3 = (0.0, 0.0, 0.0),
    subdivisions: int = 2,
    properties: dict[str, object] | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=max(1, min(3, int(subdivisions))),
        radius=1.0,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name if name.startswith("MESH_") else f"MESH_{name}"
    obj.dimensions = dimensions
    A.finish_mesh(obj, material, uv="smart", smooth=True, properties=properties)
    A.parent_keep_world(obj, parent)
    return obj


def _socket(name: str, parent: bpy.types.Object, location: Vec3, **props: object) -> bpy.types.Object:
    return A.socket(name, location=location, parent=parent, properties=props)


def _placement_socket(parent: bpy.types.Object, *, mount: str = "floor") -> bpy.types.Object:
    return _socket(
        "PLACEMENT",
        parent,
        (0.0, 0.0, 0.0),
        placement_contract=f"origin is the {mount} placement datum; front is -Y",
    )


def _raised_panel_y(
    name: str,
    center: Vec3,
    width: float,
    height: float,
    frame: bpy.types.Material,
    inset: bpy.types.Material,
    parent: bpy.types.Object,
) -> None:
    x, y, z = center
    rail = min(0.065, width * 0.13, height * 0.13)
    _box(f"{name}_Inset", (width - 1.45 * rail, 0.030, height - 1.45 * rail), (x, y + 0.008, z), inset, parent, bevel=0.008)
    _box(f"{name}_StileL", (rail, 0.050, height), (x - width / 2 + rail / 2, y, z), frame, parent, bevel=0.009)
    _box(f"{name}_StileR", (rail, 0.050, height), (x + width / 2 - rail / 2, y, z), frame, parent, bevel=0.009)
    _box(f"{name}_RailTop", (width - 2 * rail, 0.050, rail), (x, y, z + height / 2 - rail / 2), frame, parent, bevel=0.009)
    _box(f"{name}_RailBottom", (width - 2 * rail, 0.050, rail), (x, y, z - height / 2 + rail / 2), frame, parent, bevel=0.009)


def _raised_panel_x(
    name: str,
    center: Vec3,
    width_y: float,
    height: float,
    frame: bpy.types.Material,
    inset: bpy.types.Material,
    parent: bpy.types.Object,
) -> None:
    x, y, z = center
    rail = min(0.065, width_y * 0.13, height * 0.13)
    _box(f"{name}_Inset", (0.030, width_y - 1.45 * rail, height - 1.45 * rail), (x - 0.008, y, z), inset, parent, bevel=0.008)
    _box(f"{name}_StileA", (0.050, rail, height), (x, y - width_y / 2 + rail / 2, z), frame, parent, bevel=0.009)
    _box(f"{name}_StileB", (0.050, rail, height), (x, y + width_y / 2 - rail / 2, z), frame, parent, bevel=0.009)
    _box(f"{name}_RailTop", (0.050, width_y - 2 * rail, rail), (x, y, z + height / 2 - rail / 2), frame, parent, bevel=0.009)
    _box(f"{name}_RailBottom", (0.050, width_y - 2 * rail, rail), (x, y, z - height / 2 + rail / 2), frame, parent, bevel=0.009)


def _brass_pull(name: str, location: Vec3, length: float, parent: bpy.types.Object, brass: bpy.types.Material) -> None:
    x, y, z = location
    _cylinder(f"{name}_Bar", 0.008, length, (x, y, z), brass, parent, rotation=(0.0, math.pi / 2.0, 0.0), vertices=12)
    for suffix, px in (("L", x - length * 0.38), ("R", x + length * 0.38)):
        _cylinder(f"{name}_Mount{suffix}", 0.012, 0.022, (px, y + 0.006, z), brass, parent, rotation=(math.pi / 2.0, 0.0, 0.0), vertices=12)


def build_front_desk_return() -> bpy.types.Object:
    """1.27 m front extension plus 2.10 m perpendicular staff return.

    Placement uses ``SOCKET_JoinAsset61_Right``: align it to the centre of the
    existing Asset61 right end.  The module then contributes 1.27 m to the
    2.93 m primary face for an exact 4.20 m reception frontage.
    """

    dims = (1.27, 2.10, 0.965)
    root = _root(
        "A_PINE_HILLS_FRONT_DESK_RETURN_V1_ROOT",
        dims,
        "modular front-desk extension and staff return",
        reference_asset="Asset61 front_desk_counter_shell",
        reference_asset_dimensions_m="2.93 x 0.91 x 0.965",
        module_front_extension_m=1.27,
        combined_front_run_m=4.20,
        staff_return_length_m=2.10,
        join_side="right",
        source_protection="Asset61 is referenced only; never loaded or modified",
    )
    palette = A.palette_materials()
    dark_walnut = A.material("PH_ReturnDarkWalnut", A.hex_to_linear_rgba("3B2117"), roughness=0.55)
    walnut_inset = A.material("PH_ReturnWalnutInset", A.hex_to_linear_rgba("704934"), roughness=0.59)
    shell = _group("FrontDeskReturnShell", root)
    joinery = _group("FrontDeskReturnJoinery", root)
    staff = _group("FrontDeskReturnStaffStorage", root)

    # Front segment occupies local y [-1.05, -0.14].  The perpendicular leg
    # continues from y=-0.14 to +1.05 at the outer/right end.
    _box("ReturnFrontPlinth", (1.22, 0.82, 0.075), (0.0, -0.595, 0.0375), dark_walnut, shell, bevel=0.016)
    _box("ReturnFrontCarcass", (1.17, 0.76, 0.76), (0.0, -0.595, 0.445), dark_walnut, shell, bevel=0.024, bevel_segments=3)
    _box("ReturnLegPlinth", (0.82, 1.14, 0.075), (0.205, 0.455, 0.0375), dark_walnut, shell, bevel=0.016)
    _box("ReturnLegCarcass", (0.76, 1.12, 0.76), (0.2175, 0.455, 0.445), dark_walnut, shell, bevel=0.024, bevel_segments=3)

    _box("ReturnFrontTop", (1.27, 0.91, 0.095), (0.0, -0.595, 0.9175), palette["medium_walnut"], shell, bevel=0.024, bevel_segments=3, properties={"placement_surface": True})
    _box("ReturnLegTop", (0.91, 1.19, 0.095), (0.18, 0.455, 0.9175), palette["medium_walnut"], shell, bevel=0.024, bevel_segments=3, properties={"placement_surface": True})
    # The former inlays ended exactly flush with the 0.965 m walnut tops.
    # Coincident faces shimmered into broad triangular patches in the player
    # camera. Seat each oak insert 3 mm into the substrate and leave a clean
    # 9 mm relief so the joinery reads intentionally at checkout distance.
    _box("ReturnFrontTopInlay", (1.10, 0.70, 0.012), (0.0, -0.595, 0.968), palette["natural_oak"], joinery, bevel=0.005)
    _box("ReturnLegTopInlay", (0.70, 1.02, 0.012), (0.18, 0.455, 0.968), palette["natural_oak"], joinery, bevel=0.005)
    _box("ReturnCornerJoinKey", (0.69, 0.024, 0.024), (0.18, -0.14, 0.954), palette["restrained_brass"], joinery, bevel=0.004, properties={"join_detail": True})

    _raised_panel_y("ReturnCustomerPanel", (0.0, -0.970, 0.48), 1.03, 0.58, dark_walnut, walnut_inset, joinery)
    _raised_panel_x("ReturnOuterPanelA", (0.6025, 0.185, 0.48), 0.43, 0.58, dark_walnut, walnut_inset, joinery)
    _raised_panel_x("ReturnOuterPanelB", (0.6025, 0.725, 0.48), 0.43, 0.58, dark_walnut, walnut_inset, joinery)
    for index, y in enumerate((-0.80, -0.14, 0.455, 1.00), 1):
        _box(f"ReturnOuterPilaster_{index:02d}", (0.065, 0.075, 0.76), (0.608, y, 0.445), palette["medium_walnut"], joinery, bevel=0.012)

    # Staff-facing shelf and drawers sit on the inside of the return leg.
    _box("ReturnStaffShelf", (0.38, 0.52, 0.045), (-0.015, 0.38, 0.34), palette["natural_oak"], staff, bevel=0.010, properties={"staff_storage": True})
    _box("ReturnStaffDivider", (0.045, 0.54, 0.62), (0.195, 0.38, 0.43), dark_walnut, staff, bevel=0.008)
    for index, z in enumerate((0.27, 0.50, 0.73), 1):
        _box(f"ReturnStaffDrawer_{index:02d}", (0.37, 0.038, 0.17), (0.0, -0.119, z), walnut_inset, staff, bevel=0.014)
        _brass_pull(f"ReturnStaffPull_{index:02d}", (0.0, -0.145, z), 0.14, staff, palette["restrained_brass"])

    _socket(
        "JoinAsset61_Right",
        root,
        (-0.635, -0.595, 0.0),
        join_role="align to centre of Asset61 right end",
        primary_asset_width_m=2.93,
        module_width_m=1.27,
        combined_front_run_m=4.20,
        recommended_module_root_offset_from_asset61_m="[2.10, 0.595, 0.0]",
    )
    _socket("ReturnCounterProp_01", root, (-0.18, -0.60, 0.965), surface="countertop")
    _socket("ReturnCounterProp_02", root, (0.18, 0.55, 0.965), surface="countertop")
    _socket("StaffChair", root, (-0.45, 0.42, 0.0), clearance_radius_m=0.42)
    _placement_socket(root)

    A.collision_box("COL_ReturnFrontHull", (1.17, 0.76, 0.82), (0.0, -0.595, 0.43), parent=root)
    A.collision_box("COL_ReturnLegHull", (0.76, 1.12, 0.82), (0.2175, 0.455, 0.43), parent=root)
    A.collision_box("COL_ReturnTopFront", (1.27, 0.91, 0.095), (0.0, -0.595, 0.9175), parent=root, purpose="placement-surface")
    A.collision_box("COL_ReturnTopLeg", (0.91, 1.19, 0.095), (0.18, 0.455, 0.9175), parent=root, purpose="placement-surface")
    return root


def _exact_pivot(name: str, location: Vec3, parent: bpy.types.Object, **props: object) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.10
    obj["marker_type"] = "pivot"
    for key, value in props.items():
        obj[key] = value
    A.parent_keep_world(obj, parent)
    return obj


def build_opening_drinks_cooler() -> bpy.types.Object:
    dims = (0.90, 0.68, 1.90)
    root = _root(
        "A_PINE_HILLS_OPENING_DRINKS_COOLER_V1_ROOT",
        dims,
        "opening retail drinks cooler",
        opening_component="COOLER_Door",
        door_hinge_axis="+Z",
        door_open_angle_degrees=-108.0,
        bottle_socket_count=24,
        shelf_count=4,
        animation_policy="independent open/close transform clips",
    )
    palette = A.palette_materials()
    cold_white = A.material("PH_CoolerInterior", A.hex_to_linear_rgba("D7DDD3"), roughness=0.60)
    cooler_glass = A.material(
        "PH_CoolerGlass",
        A.hex_to_linear_rgba("B8D0C9", 0.20),
        roughness=0.10,
        alpha=0.20,
        transmission=0.82,
        ior=1.45,
        double_sided=True,
    )
    cool_emissive = A.material(
        "PH_CoolerInteriorGlow",
        A.hex_to_linear_rgba("E7E1D4"),
        roughness=0.42,
        emission_color=A.hex_to_linear_rgba("FFF4E0")[:3],
        emission_strength=0.75,
    )
    shell = _group("CoolerCarcass", root)
    interior = _group("CoolerInterior", root)

    _box("CoolerBack", (0.90, 0.04, 1.90), (0.0, 0.32, 0.95), palette["warm_charcoal"], shell, bevel=0.012)
    for suffix, x in (("Left", -0.425), ("Right", 0.425)):
        _box(f"CoolerSide{suffix}", (0.05, 0.62, 1.90), (x, 0.03, 0.95), palette["warm_charcoal"], shell, bevel=0.016)
    _box("CoolerTop", (0.80, 0.62, 0.08), (0.0, 0.03, 1.86), palette["warm_charcoal"], shell, bevel=0.014)
    _box("CoolerBase", (0.80, 0.62, 0.08), (0.0, 0.03, 0.04), palette["warm_charcoal"], shell, bevel=0.014)
    _box("CoolerHeader", (0.80, 0.055, 0.22), (0.0, -0.2675, 1.72), palette["deep_green"], shell, bevel=0.010)
    _box("CoolerHeaderBadge", (0.26, 0.010, 0.075), (0.0, -0.300, 1.73), palette["natural_oak"], shell, bevel=0.012)
    _cylinder("CoolerHeaderGolfMark", 0.025, 0.012, (0.0, -0.310, 1.73), palette["restrained_brass"], shell, rotation=(math.pi / 2.0, 0.0, 0.0), vertices=16)
    _box("CoolerKick", (0.78, 0.065, 0.14), (0.0, -0.2675, 0.10), palette["rubber"], shell, bevel=0.010)
    _box("CoolerInteriorBack", (0.74, 0.025, 1.50), (0.0, 0.285, 0.93), cold_white, interior, bevel=0.006)
    _box("CoolerInteriorLight", (0.60, 0.025, 0.035), (0.0, 0.22, 1.57), cool_emissive, interior, bevel=0.005, properties={"emissive_fixture": True})

    shelf_heights = (0.34, 0.68, 1.02, 1.36)
    socket_index = 1
    for shelf_index, z in enumerate(shelf_heights, 1):
        _box(f"CoolerShelf_{shelf_index:02d}", (0.72, 0.48, 0.024), (0.0, 0.015, z), palette["brushed_steel"], interior, bevel=0.004, properties={"shelf_index": shelf_index})
        _box(f"CoolerShelfLip_{shelf_index:02d}", (0.72, 0.018, 0.035), (0.0, -0.230, z + 0.012), palette["restrained_brass"], interior, bevel=0.003)
        for x in (-0.30, -0.18, -0.06, 0.06, 0.18, 0.30):
            _socket(
                f"Bottle_{socket_index:02d}",
                root,
                (x, -0.075, z + 0.020),
                shelf_index=shelf_index,
                slot_index=((socket_index - 1) % 6) + 1,
                facing="-Y",
                bottle_clearance_m="0.10 x 0.12 x 0.28",
            )
            socket_index += 1

    # Exact runtime-facing name required by the integration.  The object's
    # origin is the physical lower-left vertical hinge line.
    hinge_location = (-0.420, -0.280, 0.0)
    door = _exact_pivot(
        "COOLER_Door",
        hinge_location,
        root,
        pivot_role="physical left vertical hinge",
        pivot_axis="+Z",
        moving_part=True,
        closed_rotation_radians=0.0,
        open_rotation_radians=round(math.radians(-108.0), 8),
    )
    A.pivot(
        "COOLER_Door",
        location=hinge_location,
        parent=root,
        properties={"pivot_role": "authored hinge datum for COOLER_Door", "axis": "+Z"},
    )
    _box("COOLER_DoorGlass", (0.76, 0.012, 1.48), (0.0, -0.310, 0.91), cooler_glass, door, bevel=0.004, properties={"moving_part": "COOLER_Door", "glass": True})
    for suffix, x in (("Left", -0.400), ("Right", 0.400)):
        _box(f"COOLER_DoorFrame{suffix}", (0.040, 0.035, 1.58), (x, -0.2975, 0.91), palette["warm_charcoal"], door, bevel=0.009, properties={"moving_part": "COOLER_Door"})
    for suffix, z in (("Bottom", 0.14), ("Top", 1.68)):
        _box(f"COOLER_DoorFrame{suffix}", (0.84, 0.035, 0.10), (0.0, -0.2975, z), palette["warm_charcoal"], door, bevel=0.009, properties={"moving_part": "COOLER_Door"})
    _cylinder("COOLER_DoorHandle", 0.012, 0.82, (0.355, -0.327, 0.92), palette["restrained_brass"], door, vertices=16, bevel=0.002, properties={"moving_part": "COOLER_Door", "grip": True})
    for suffix, z in (("Bottom", 0.56), ("Top", 1.28)):
        _cylinder(f"COOLER_DoorHandleMount{suffix}", 0.018, 0.040, (0.355, -0.307, z), palette["restrained_brass"], door, rotation=(math.pi / 2.0, 0.0, 0.0), vertices=12, properties={"moving_part": "COOLER_Door"})

    A.collision_box("COL_COOLER_Carcass", (0.90, 0.62, 1.90), (0.0, 0.03, 0.95), parent=root, purpose="blocking-carcass")
    A.collision_box("COL_COOLER_Door", (0.84, 0.035, 1.58), (0.0, -0.2975, 0.91), parent=door, purpose="state-aware-opening-door")
    _socket("Use", root, (0.0, -0.34, 1.0), interaction="open cooler door")
    _socket("PowerCable", root, (0.34, 0.34, 0.12), connection="wall power")
    _placement_socket(root)

    closed = (0.0, 0.0, 0.0)
    # Negative Z swings the left-hinged leaf into the customer-side -Y space;
    # positive Z would incorrectly pass the door through the cabinet.
    opened = (0.0, 0.0, math.radians(-108.0))
    A.animate_transform_clip(
        door,
        "COOLER_Door_Open",
        ({"frame": 1, "rotation": closed}, {"frame": 24, "rotation": opened}),
        interpolation="SINE",
    )
    A.animate_transform_clip(
        door,
        "COOLER_Door_Close",
        ({"frame": 1, "rotation": opened}, {"frame": 24, "rotation": closed}),
        interpolation="SINE",
    )
    door.rotation_euler = closed
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    return root


def build_golf_tv() -> bpy.types.Object:
    dims = (1.10, 0.17, 0.68)
    root = _root("A_PINE_HILLS_GOLF_TV_V1_ROOT", dims, "wall-mounted lounge golf television", mount="wall")
    palette = A.palette_materials()
    screen_black = A.material("PH_TVScreenBlack", A.hex_to_linear_rgba("07100D"), roughness=0.18, coat=0.15)
    sky = A.material("PH_TVSky", A.hex_to_linear_rgba("A9C8C2"), roughness=0.72)
    bright_green = A.material("PH_TVFairway", A.hex_to_linear_rgba("3C7550"), roughness=0.62)
    frame = _group("GolfTV", root)
    _box("GolfTVFrame", (1.10, 0.080, 0.68), (0.0, -0.030, 0.34), palette["warm_charcoal"], frame, bevel=0.020, bevel_segments=3)
    _box("GolfTVScreen", (1.00, 0.010, 0.56), (0.0, -0.075, 0.34), screen_black, frame, bevel=0.012, properties={"screen_surface": True})
    _box("GolfTVSky", (0.95, 0.004, 0.24), (0.0, -0.082, 0.465), sky, frame, bevel=0.002)
    _box("GolfTVFairway", (0.95, 0.004, 0.25), (0.0, -0.082, 0.220), bright_green, frame, bevel=0.002)
    A.profile_prism("GolfTVGreen", ((-0.42, 0.0), (0.44, 0.0), (0.31, 0.13), (-0.28, 0.16)), 0.004, (0.0, -0.085, 0.17), palette["muted_sage"], parent=frame, bevel=0.001)
    _cylinder("GolfTVFlagPole", 0.006, 0.26, (0.20, -0.090, 0.31), palette["warm_cream"], frame, vertices=10, bevel=0.001)
    A.profile_prism("GolfTVFlag", ((0.0, 0.0), (0.16, -0.045), (0.0, -0.09)), 0.004, (0.20, -0.093, 0.42), palette["restrained_brass"], parent=frame, bevel=0.001)
    _cylinder("GolfTVBall", 0.014, 0.006, (-0.18, -0.091, 0.19), palette["warm_cream"], frame, rotation=(math.pi / 2.0, 0.0, 0.0), vertices=14, bevel=0.001)
    _box("GolfTVWallBracket", (0.30, 0.060, 0.28), (0.0, 0.040, 0.34), palette["warm_charcoal"], frame, bevel=0.010)
    _box("GolfTVPowerLead", (0.020, 0.018, 0.20), (0.38, 0.015, 0.10), palette["rubber"], frame, bevel=0.004)
    _socket("WallMount", root, (0.0, 0.070, 0.34), normal="+Y", mount_height_recommended_m=1.45)
    _socket("Power", root, (0.38, 0.025, 0.0), connection="wall outlet")
    _socket("ChannelControl", root, (0.48, -0.080, 0.08), interaction="toggle golf broadcast")
    A.collision_box("COL_GolfTV", (1.10, 0.15, 0.68), (0.0, -0.005, 0.34), parent=root, purpose="wall-prop")
    return root


def build_water_cooler() -> bpy.types.Object:
    dims = (0.39, 0.47, 1.37)
    root = _root("A_PINE_HILLS_WATER_COOLER_V1_ROOT", dims, "public water cooler")
    palette = A.palette_materials()
    water_glass = A.material(
        "PH_WaterJugGlass",
        A.hex_to_linear_rgba("9DBFBE", 0.26),
        roughness=0.14,
        alpha=0.26,
        transmission=0.70,
        ior=1.33,
        double_sided=True,
    )
    water = A.material(
        "PH_WaterVolume",
        A.hex_to_linear_rgba("5E9C9C", 0.48),
        roughness=0.12,
        alpha=0.48,
        transmission=0.42,
        ior=1.33,
        double_sided=True,
    )
    body = _group("WaterCooler", root)
    _box("WaterCoolerBasePlinth", (0.34, 0.30, 0.08), (0.0, 0.03, 0.04), palette["warm_charcoal"], body, bevel=0.018)
    _box("WaterCoolerBody", (0.38, 0.36, 0.88), (0.0, 0.01, 0.48), palette["warm_cream"], body, bevel=0.035, bevel_segments=3)
    _box("WaterCoolerFrontInset", (0.30, 0.025, 0.44), (0.0, -0.183, 0.55), palette["muted_sage"], body, bevel=0.020)
    _box("WaterCoolerTopCollar", (0.34, 0.34, 0.08), (0.0, 0.01, 0.94), palette["warm_charcoal"], body, bevel=0.025)
    _cylinder("WaterCoolerJug", 0.17, 0.36, (0.0, 0.01, 1.18), water_glass, body, vertices=20, bevel=0.006)
    _cylinder("WaterCoolerJugShoulder", 0.135, 0.10, (0.0, 0.01, 1.32), water_glass, body, vertices=20, bevel=0.006)
    _cylinder("WaterCoolerWater", 0.145, 0.20, (0.0, 0.01, 1.08), water, body, vertices=20, bevel=0.002)
    _box("WaterCoolerDripTray", (0.30, 0.14, 0.045), (0.0, -0.210, 0.41), palette["warm_charcoal"], body, bevel=0.010)
    for suffix, x, material in (("Cold", -0.085, palette["muted_sage"]), ("Room", 0.085, palette["restrained_brass"])):
        _cylinder(f"WaterCoolerTap{suffix}", 0.022, 0.08, (x, -0.205, 0.66), material, body, rotation=(math.pi / 2.0, 0.0, 0.0), vertices=12)
        _box(f"WaterCoolerPaddle{suffix}", (0.055, 0.025, 0.055), (x, -0.245, 0.62), material, body, bevel=0.009)
    _box("WaterCoolerCupDispenser", (0.080, 0.070, 0.24), (0.155, -0.190, 0.73), palette["warm_charcoal"], body, bevel=0.018)
    _socket("UseCold", root, (-0.085, -0.27, 0.63), interaction="dispense water")
    _socket("CupStack", root, (0.155, -0.235, 0.73), item="paper cups")
    _socket("BottleRefill", root, (0.0, 0.01, 1.36), item="water jug")
    _placement_socket(root)
    A.collision_box("COL_WaterCoolerBody", (0.40, 0.38, 0.98), (0.0, 0.0, 0.49), parent=root)
    A.collision_cylinder("COL_WaterCoolerJug", 0.18, 0.38, (0.0, 0.01, 1.17), parent=root, purpose="upper-profile")
    return root


def _build_public_waste_bin(*, overflow: bool) -> bpy.types.Object:
    root_name = (
        "A_PINE_HILLS_PUBLIC_WASTE_BIN_OVERFLOW_V1_ROOT"
        if overflow
        else "A_PINE_HILLS_PUBLIC_WASTE_BIN_V1_ROOT"
    )
    dims = (0.50, 0.44, 0.86) if overflow else (0.44, 0.44, 0.68)
    role = "overflowing public waste bin cleanup target" if overflow else "public waste bin"
    root = _root(root_name, dims, role, cleanup_variant="overflow" if overflow else "clean")
    palette = A.palette_materials()
    bin_group = _group("PublicWasteBin", root)
    _box("WasteBinBody", (0.44, 0.40, 0.62), (0.0, 0.0, 0.31), palette["deep_green"], bin_group, bevel=0.030, bevel_segments=3)
    _box("WasteBinTopRim", (0.44, 0.44, 0.08), (0.0, 0.0, 0.64), palette["warm_charcoal"], bin_group, bevel=0.020)
    _box("WasteBinOpening", (0.30, 0.22, 0.010), (0.0, -0.025, 0.682), palette["soft_black"], bin_group, bevel=0.020)
    _box("WasteBinFrontPlaque", (0.22, 0.014, 0.08), (0.0, -0.207, 0.42), palette["restrained_brass"], bin_group, bevel=0.012)
    for index, x in enumerate((-0.13, 0.0, 0.13), 1):
        _box(f"WasteBinOakSlat_{index:02d}", (0.055, 0.014, 0.34), (x, -0.208, 0.23), palette["natural_oak"], bin_group, bevel=0.008)
    _socket("Discard", root, (0.0, -0.025, 0.70), interaction="discard small rubbish")
    _placement_socket(root)
    A.collision_box("COL_WasteBinBody", (0.44, 0.40, 0.66), (0.0, 0.0, 0.33), parent=root)

    if overflow:
        mess = _group("WasteBinOverflowCleanup", root, cleanup_target=True)
        paper_positions = (
            (-0.12, -0.04, 0.72, 0.16, 0.13, 0.11),
            (0.10, 0.03, 0.75, 0.18, 0.14, 0.12),
            (-0.02, -0.12, 0.80, 0.15, 0.12, 0.11),
            (0.15, -0.10, 0.69, 0.13, 0.11, 0.10),
        )
        for index, (x, y, z, sx, sy, sz) in enumerate(paper_positions, 1):
            _ellipsoid(f"WasteOverflowPaper_{index:02d}", (sx, sy, sz), (x, y, z), palette["paper"], mess, subdivisions=1, properties={"cleanup_piece": True})
        _cone("WasteOverflowCup", 0.055, 0.045, 0.17, (0.05, 0.08, 0.76), palette["warm_cream"], mess, rotation=(0.28, 0.18, 0.15), vertices=12, properties={"cleanup_piece": True})
        _box("WasteOverflowReceipt", (0.12, 0.08, 0.006), (-0.17, -0.08, 0.855), palette["paper"], mess, rotation=(0.10, 0.18, -0.20), bevel=0.002, properties={"cleanup_piece": True})
        _socket("CleanupTarget", root, (0.0, -0.10, 0.82), interaction="empty overflowing bin")
        A.collision_box("COL_WasteOverflowCleanup", (0.46, 0.42, 0.24), (0.0, -0.02, 0.74), parent=root, purpose="cleanup-target")
    return root


def build_public_waste_bin() -> bpy.types.Object:
    return _build_public_waste_bin(overflow=False)


def build_public_waste_bin_overflow() -> bpy.types.Object:
    return _build_public_waste_bin(overflow=True)


def build_front_desk_clutter() -> bpy.types.Object:
    dims = (0.72, 0.38, 0.24)
    root = _root("A_PINE_HILLS_FRONT_DESK_CLUTTER_V1_ROOT", dims, "front-desk clutter dressing kit", mount="counter")
    palette = A.palette_materials()
    dark_ceramic = A.material("PH_DeskMugCeramic", A.hex_to_linear_rgba("1F4B3A"), roughness=0.34, coat=0.18)
    clutter = _group("FrontDeskClutter", root, cleanup_target=True)

    # Pen cup with individual low-poly pens.
    _cylinder("PenCup", 0.047, 0.11, (-0.285, -0.07, 0.055), palette["warm_charcoal"], clutter, vertices=16, bevel=0.004)
    _cylinder("PenCupOpening", 0.039, 0.006, (-0.285, -0.07, 0.112), palette["soft_black"], clutter, vertices=16, bevel=0.001)
    for index, (dx, dy, tilt, material) in enumerate(((-0.015, 0.0, -0.08, palette["restrained_brass"]), (0.0, 0.012, 0.06, palette["deep_green"]), (0.016, -0.008, 0.10, palette["natural_oak"]), (0.008, 0.014, -0.05, palette["warm_cream"])), 1):
        _cylinder(f"Pen_{index:02d}", 0.004, 0.16, (-0.285 + dx, -0.07 + dy, 0.17), material, clutter, rotation=(tilt, tilt * 0.6, 0.0), vertices=8, bevel=0.001)

    # Receipt spike and a skewed receipt remain independently readable.
    _cylinder("ReceiptSpikeBase", 0.040, 0.012, (-0.10, 0.095, 0.006), palette["warm_charcoal"], clutter, vertices=14)
    _cone("ReceiptSpike", 0.010, 0.0015, 0.17, (-0.10, 0.095, 0.095), palette["restrained_brass"], clutter, vertices=12, bevel=0.001)
    _box("ReceiptOnSpike", (0.095, 0.070, 0.006), (-0.10, 0.095, 0.145), palette["paper"], clutter, rotation=(0.05, -0.08, 0.12), bevel=0.002)

    # Mug, paper stack and desk phone supply the lived-in service-counter read.
    _cylinder("CoffeeMug", 0.052, 0.105, (0.045, 0.085, 0.0525), dark_ceramic, clutter, vertices=18, bevel=0.004)
    _cylinder("CoffeeMugOpening", 0.043, 0.006, (0.045, 0.085, 0.108), palette["soft_black"], clutter, vertices=18, bevel=0.001)
    A.torus("CoffeeMugHandle", 0.038, 0.008, (0.105, 0.085, 0.062), dark_ceramic, rotation=(math.pi / 2.0, 0.0, 0.0), major_segments=16, minor_segments=6, parent=clutter)
    for index, (z, angle) in enumerate(((0.006, -0.03), (0.011, 0.02), (0.016, -0.01)), 1):
        _box(f"PaperStack_{index:02d}", (0.24, 0.28, 0.004), (-0.05, -0.085, z), palette["paper"], clutter, rotation=(0.0, 0.0, angle), bevel=0.001)
    _box("DeskPhoneBase", (0.29, 0.16, 0.045), (0.205, -0.025, 0.027), palette["warm_charcoal"], clutter, bevel=0.020)
    _box("DeskPhoneHandset", (0.27, 0.055, 0.050), (0.205, -0.025, 0.075), palette["soft_black"], clutter, bevel=0.022, bevel_segments=3)
    _box("DeskPhoneNote", (0.085, 0.070, 0.004), (0.305, 0.100, 0.010), palette["muted_sage"], clutter, rotation=(0.0, 0.0, 0.10), bevel=0.002)

    for name, loc in (
        ("PenCup", (-0.285, -0.07, 0.0)),
        ("ReceiptSpike", (-0.10, 0.095, 0.0)),
        ("Mug", (0.045, 0.085, 0.0)),
        ("Paper", (-0.05, -0.085, 0.0)),
        ("Phone", (0.205, -0.025, 0.0)),
        ("CleanupTarget", (0.0, -0.12, 0.12)),
    ):
        _socket(name, root, loc, dressing_component=name)
    _placement_socket(root, mount="counter")
    A.collision_box("COL_FrontDeskClutter", (0.72, 0.38, 0.22), (0.0, 0.0, 0.11), parent=root, purpose="counter-dressing")
    return root


def build_lounge_litter() -> bpy.types.Object:
    dims = (0.76, 0.60, 0.16)
    root = _root("A_PINE_HILLS_LOUNGE_LITTER_V1_ROOT", dims, "pizza box and empty-cup cleanup target", mount="table")
    palette = A.palette_materials()
    cardboard = A.material("PH_PizzaCardboard", A.hex_to_linear_rgba("C49A65"), roughness=0.82)
    litter = _group("LoungeLitter", root, cleanup_target=True)
    _box("PizzaBoxBase", (0.50, 0.46, 0.055), (-0.08, 0.02, 0.030), cardboard, litter, bevel=0.010)
    _box("PizzaBoxLid", (0.51, 0.47, 0.025), (-0.08, 0.005, 0.085), cardboard, litter, rotation=(0.07, 0.0, -0.025), bevel=0.009)
    _box("PizzaBoxLabel", (0.24, 0.16, 0.006), (-0.08, -0.015, 0.104), palette["deep_green"], litter, rotation=(0.07, 0.0, -0.025), bevel=0.018)
    _cylinder("PizzaBoxLogo", 0.045, 0.008, (-0.08, -0.025, 0.112), palette["restrained_brass"], litter, rotation=(0.0, math.pi / 2.0, 0.0), vertices=16)

    _cone("EmptyCupUpright", 0.055, 0.045, 0.15, (0.28, -0.15, 0.075), palette["warm_cream"], litter, vertices=14, bevel=0.003)
    A.torus("EmptyCupUprightRim", 0.046, 0.004, (0.28, -0.15, 0.151), palette["muted_sage"], major_segments=14, minor_segments=5, parent=litter)
    _cone("EmptyCupTipped", 0.052, 0.043, 0.14, (0.27, 0.15, 0.070), palette["warm_cream"], litter, rotation=(0.0, math.pi / 2.0, 0.22), vertices=14, bevel=0.003)
    A.torus("EmptyCupTippedRim", 0.044, 0.004, (0.34, 0.165, 0.055), palette["muted_sage"], rotation=(0.0, math.pi / 2.0, 0.22), major_segments=14, minor_segments=5, parent=litter)
    _box("LoungeNapkin", (0.16, 0.13, 0.005), (-0.30, -0.20, 0.012), palette["paper"], litter, rotation=(0.0, 0.0, 0.25), bevel=0.002)
    _socket("PizzaBox", root, (-0.08, 0.02, 0.0), cleanup_piece="pizza box")
    _socket("EmptyCup_01", root, (0.28, -0.15, 0.0), cleanup_piece="empty cup")
    _socket("EmptyCup_02", root, (0.27, 0.15, 0.0), cleanup_piece="empty cup")
    _socket("CleanupTarget", root, (0.0, -0.20, 0.12), interaction="clear lounge litter")
    _placement_socket(root, mount="table")
    A.collision_box("COL_LoungeLitter", (0.76, 0.60, 0.20), (0.0, 0.0, 0.10), parent=root, purpose="cleanup-target")
    return root


def build_fallen_frame() -> bpy.types.Object:
    dims = (0.64, 0.46, 0.06)
    root = _root("A_PINE_HILLS_FALLEN_FRAME_V1_ROOT", dims, "fallen picture-frame cleanup target")
    palette = A.palette_materials()
    frame = _group("FallenFrame", root, cleanup_target=True, authored_state="fallen-horizontal")
    _box("FallenFramePhoto", (0.54, 0.36, 0.010), (0.0, 0.0, 0.018), palette["muted_sage"], frame, bevel=0.003)
    _box("FallenFrameGlass", (0.55, 0.37, 0.006), (0.0, -0.002, 0.025), palette["glass"], frame, bevel=0.003)
    _box("FallenFrameRailNorth", (0.64, 0.055, 0.045), (0.0, 0.2025, 0.030), palette["medium_walnut"], frame, bevel=0.012)
    _box("FallenFrameRailSouth", (0.64, 0.055, 0.045), (0.0, -0.2025, 0.030), palette["medium_walnut"], frame, bevel=0.012)
    _box("FallenFrameRailWest", (0.055, 0.35, 0.045), (-0.2925, 0.0, 0.030), palette["medium_walnut"], frame, bevel=0.012)
    _box("FallenFrameRailEast", (0.055, 0.35, 0.045), (0.2925, 0.0, 0.030), palette["medium_walnut"], frame, bevel=0.012)
    _box("FallenFrameCourseStripe", (0.34, 0.055, 0.008), (0.0, -0.035, 0.032), palette["deep_green"], frame, rotation=(0.0, 0.0, -0.10), bevel=0.004)
    _cylinder("FallenFrameHanger", 0.010, 0.18, (0.0, 0.15, 0.055), palette["restrained_brass"], frame, rotation=(0.0, math.pi / 2.0, 0.0), vertices=10)
    _socket("CleanupTarget", root, (0.0, -0.18, 0.08), interaction="rehang fallen frame")
    _socket("WallMount", root, (0.0, 0.0, 0.0), restored_orientation="rotate vertical at runtime")
    _placement_socket(root)
    A.collision_box("COL_FallenFrame", (0.64, 0.46, 0.06), (0.0, 0.0, 0.03), parent=root, purpose="cleanup-target")
    return root


def _leaf(
    name: str,
    dimensions: Vec3,
    location: Vec3,
    rotation: Vec3,
    material: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    return _ellipsoid(name, dimensions, location, material, parent, rotation=rotation, subdivisions=2, properties={"plant_leaf": True})


def build_floor_plant() -> bpy.types.Object:
    dims = (0.76, 0.62, 1.23)
    root = _root("A_PINE_HILLS_FLOOR_PLANT_V1_ROOT", dims, "large broadleaf clubhouse plant", plant_variant="floor-broadleaf")
    palette = A.palette_materials()
    leaf_dark = A.material("PH_FloorPlantLeafDark", A.hex_to_linear_rgba("174A35"), roughness=0.72, double_sided=True)
    leaf_light = A.material("PH_FloorPlantLeafLight", A.hex_to_linear_rgba("47755B"), roughness=0.74, double_sided=True)
    plant = _group("FloorPlantBroadleaf", root)
    _cone("FloorPlantPot", 0.21, 0.17, 0.34, (0.0, 0.0, 0.17), palette["muted_sage"], plant, vertices=18, bevel=0.008)
    _cylinder("FloorPlantPotRim", 0.19, 0.055, (0.0, 0.0, 0.335), palette["natural_oak"], plant, vertices=18, bevel=0.006)
    _cylinder("FloorPlantSoil", 0.16, 0.018, (0.0, 0.0, 0.366), palette["medium_walnut"], plant, vertices=18, bevel=0.002)
    stems = (
        ((0.0, 0.0, 0.36), (-0.24, -0.03, 0.90)),
        ((0.0, 0.0, 0.36), (0.25, 0.02, 0.92)),
        ((0.0, 0.0, 0.36), (-0.06, -0.18, 1.02)),
        ((0.0, 0.0, 0.36), (0.08, 0.19, 1.04)),
        ((0.0, 0.0, 0.36), (-0.16, 0.15, 0.82)),
        ((0.0, 0.0, 0.36), (0.16, -0.14, 0.84)),
    )
    for index, (start, end) in enumerate(stems, 1):
        A.curve_tube(f"FloorPlantStem_{index:02d}", (start, end), 0.010, palette["deep_green"], parent=plant, resolution=1, bevel_resolution=1)
        ex, ey, ez = end
        angle = math.atan2(ey, ex) if abs(ex) + abs(ey) > 0.001 else 0.0
        _leaf(
            f"FloorPlantLeaf_{index:02d}",
            (0.25 if index < 3 else 0.22, 0.10, 0.44 if index < 5 else 0.36),
            (ex, ey, min(1.02, ez)),
            (0.18 * (-1 if ex < 0 else 1), 0.28 * (1 if ey < 0 else -1), angle),
            leaf_light if index % 2 else leaf_dark,
            plant,
        )
    _leaf("FloorPlantCrown", (0.24, 0.12, 0.42), (0.0, 0.0, 0.97), (0.0, 0.0, 0.0), leaf_dark, plant)
    _socket("Water", root, (0.0, -0.18, 0.36), interaction="water plant")
    _socket("DecorAnchor", root, (0.0, 0.0, 0.0), decor_variant="floor-broadleaf")
    _placement_socket(root)
    A.collision_cylinder("COL_FloorPlantPot", 0.22, 0.38, (0.0, 0.0, 0.19), parent=root)
    return root


def build_counter_plant() -> bpy.types.Object:
    dims = (0.26, 0.26, 0.65)
    root = _root("A_PINE_HILLS_COUNTER_PLANT_V1_ROOT", dims, "small upright counter plant", mount="counter", plant_variant="counter-spear")
    palette = A.palette_materials()
    leaf_dark = A.material("PH_CounterPlantLeafDark", A.hex_to_linear_rgba("173F32"), roughness=0.68, double_sided=True)
    leaf_sage = A.material("PH_CounterPlantLeafSage", A.hex_to_linear_rgba("6F8D73"), roughness=0.70, double_sided=True)
    plant = _group("CounterPlantSpear", root)
    _cone("CounterPlantPot", 0.13, 0.11, 0.20, (0.0, 0.0, 0.10), palette["warm_cream"], plant, vertices=16, bevel=0.006)
    _cylinder("CounterPlantPotBand", 0.125, 0.035, (0.0, 0.0, 0.195), palette["restrained_brass"], plant, vertices=16, bevel=0.004)
    _cylinder("CounterPlantSoil", 0.103, 0.015, (0.0, 0.0, 0.218), palette["medium_walnut"], plant, vertices=16, bevel=0.002)
    leaf_specs = (
        (-0.09, -0.03, 0.39, -0.22, 0.10, 0.34),
        (0.09, -0.02, 0.40, 0.22, -0.08, 0.35),
        (-0.03, 0.07, 0.45, 0.10, 0.18, 0.42),
        (0.04, 0.05, 0.49, -0.08, -0.12, 0.46),
        (0.0, -0.05, 0.47, 0.0, 0.0, 0.43),
    )
    for index, (x, y, z, rx, ry, height) in enumerate(leaf_specs, 1):
        A.profile_prism(
            f"CounterPlantLeaf_{index:02d}",
            ((-0.035, 0.0), (0.0, height), (0.035, 0.0)),
            0.016,
            (x, y, 0.205),
            leaf_sage if index % 2 else leaf_dark,
            rotation=(rx, ry, 0.0),
            parent=plant,
            bevel=0.003,
            properties={"plant_leaf": True},
        )
    _socket("Water", root, (0.0, -0.11, 0.22), interaction="water plant")
    _socket("DecorAnchor", root, (0.0, 0.0, 0.0), decor_variant="counter-spear")
    _placement_socket(root, mount="counter")
    A.collision_cylinder("COL_CounterPlantPot", 0.14, 0.23, (0.0, 0.0, 0.115), parent=root, purpose="counter-dressing")
    return root


SPECS: tuple[AssetSpec, ...] = (
    AssetSpec(
        "front_desk_return",
        "pine_hills_front_desk_return_v1",
        "A_PINE_HILLS_FRONT_DESK_RETURN_V1_ROOT",
        (1.27, 2.10, 0.965),
        build_front_desk_return,
        (
            "SOCKET_JoinAsset61_Right",
            "SOCKET_ReturnCounterProp_01",
            "SOCKET_StaffChair",
            "COL_ReturnFrontHull",
            "COL_ReturnLegHull",
        ),
        minimum_sockets=5,
        dimension_tolerance=0.025,
    ),
    AssetSpec(
        "opening_drinks_cooler",
        "pine_hills_opening_drinks_cooler_v1",
        "A_PINE_HILLS_OPENING_DRINKS_COOLER_V1_ROOT",
        (0.90, 0.68, 1.90),
        build_opening_drinks_cooler,
        (
            "COOLER_Door",
            "PIVOT_COOLER_Door",
            "MESH_COOLER_DoorGlass",
            "MESH_COOLER_DoorHandle",
            "COL_COOLER_Carcass",
            "COL_COOLER_Door",
            "SOCKET_Bottle_01",
            "SOCKET_Bottle_24",
        ),
        minimum_sockets=27,
        dimension_tolerance=0.025,
    ),
    AssetSpec(
        "golf_tv",
        "pine_hills_golf_tv_v1",
        "A_PINE_HILLS_GOLF_TV_V1_ROOT",
        (1.10, 0.17, 0.68),
        build_golf_tv,
        ("SOCKET_WallMount", "MESH_GolfTVScreen", "MESH_GolfTVFlag", "COL_GolfTV"),
        minimum_sockets=3,
    ),
    AssetSpec(
        "water_cooler",
        "pine_hills_water_cooler_v1",
        "A_PINE_HILLS_WATER_COOLER_V1_ROOT",
        (0.39, 0.47, 1.37),
        build_water_cooler,
        ("MESH_WaterCoolerJug", "SOCKET_UseCold", "SOCKET_CupStack", "COL_WaterCoolerBody"),
        minimum_sockets=4,
    ),
    AssetSpec(
        "public_waste_bin",
        "pine_hills_public_waste_bin_v1",
        "A_PINE_HILLS_PUBLIC_WASTE_BIN_V1_ROOT",
        (0.44, 0.44, 0.68),
        build_public_waste_bin,
        ("MESH_WasteBinOpening", "SOCKET_Discard", "COL_WasteBinBody"),
        minimum_sockets=2,
    ),
    AssetSpec(
        "public_waste_bin_overflow",
        "pine_hills_public_waste_bin_overflow_v1",
        "A_PINE_HILLS_PUBLIC_WASTE_BIN_OVERFLOW_V1_ROOT",
        (0.50, 0.44, 0.86),
        build_public_waste_bin_overflow,
        ("MESH_WasteOverflowPaper_01", "SOCKET_CleanupTarget", "COL_WasteOverflowCleanup"),
        minimum_sockets=3,
        dimension_tolerance=0.12,
    ),
    AssetSpec(
        "front_desk_clutter",
        "pine_hills_front_desk_clutter_v1",
        "A_PINE_HILLS_FRONT_DESK_CLUTTER_V1_ROOT",
        (0.72, 0.38, 0.24),
        build_front_desk_clutter,
        (
            "MESH_PenCup",
            "MESH_ReceiptSpike",
            "MESH_CoffeeMug",
            "MESH_PaperStack_01",
            "MESH_DeskPhoneBase",
            "SOCKET_CleanupTarget",
            "COL_FrontDeskClutter",
        ),
        minimum_sockets=7,
        dimension_tolerance=0.18,
    ),
    AssetSpec(
        "lounge_litter",
        "pine_hills_lounge_litter_v1",
        "A_PINE_HILLS_LOUNGE_LITTER_V1_ROOT",
        (0.76, 0.60, 0.16),
        build_lounge_litter,
        ("MESH_PizzaBoxBase", "MESH_EmptyCupUpright", "MESH_EmptyCupTipped", "SOCKET_CleanupTarget", "COL_LoungeLitter"),
        minimum_sockets=5,
        dimension_tolerance=0.16,
    ),
    AssetSpec(
        "fallen_frame",
        "pine_hills_fallen_frame_v1",
        "A_PINE_HILLS_FALLEN_FRAME_V1_ROOT",
        (0.64, 0.46, 0.06),
        build_fallen_frame,
        ("MESH_FallenFrameGlass", "SOCKET_CleanupTarget", "SOCKET_WallMount", "COL_FallenFrame"),
        minimum_sockets=3,
        dimension_tolerance=0.15,
    ),
    AssetSpec(
        "floor_plant",
        "pine_hills_floor_plant_v1",
        "A_PINE_HILLS_FLOOR_PLANT_V1_ROOT",
        (0.76, 0.62, 1.23),
        build_floor_plant,
        ("MESH_FloorPlantPot", "MESH_FloorPlantLeaf_01", "SOCKET_Water", "COL_FloorPlantPot"),
        minimum_sockets=3,
        dimension_tolerance=0.24,
    ),
    AssetSpec(
        "counter_plant",
        "pine_hills_counter_plant_v1",
        "A_PINE_HILLS_COUNTER_PLANT_V1_ROOT",
        (0.26, 0.26, 0.65),
        build_counter_plant,
        ("MESH_CounterPlantPot", "MESH_CounterPlantLeaf_01", "SOCKET_Water", "COL_CounterPlantPot"),
        minimum_sockets=3,
        dimension_tolerance=0.22,
    ),
)


def _descendants(root: bpy.types.Object) -> list[bpy.types.Object]:
    return A.descendants(root)


def _validate_build(spec: AssetSpec, root: bpy.types.Object) -> dict[str, object]:
    errors: list[str] = []
    warnings: list[str] = []
    nodes = _descendants(root)
    by_name = {obj.name: obj for obj in nodes}
    if root.name != spec.root_name:
        errors.append(f"root name {root.name!r} != {spec.root_name!r}")
    if root.parent is not None:
        errors.append("root has a parent")
    if any(abs(value) > 1e-6 for value in (*root.location, *root.rotation_euler)):
        errors.append(f"root transform is not identity: loc={tuple(root.location)} rot={tuple(root.rotation_euler)}")
    if any(abs(value - 1.0) > 1e-6 for value in root.scale):
        errors.append(f"root scale is not identity: {tuple(root.scale)}")
    for required in spec.required_nodes:
        if required not in by_name:
            errors.append(f"required node missing: {required}")

    visible_meshes = [obj for obj in nodes if obj.type == "MESH" and not obj.get("collision_proxy")]
    collisions = [obj for obj in nodes if obj.type == "MESH" and obj.get("collision_proxy")]
    sockets = [obj for obj in nodes if obj.type == "EMPTY" and obj.name.startswith("SOCKET_")]
    if not visible_meshes:
        errors.append("no visible meshes")
    if not collisions:
        errors.append("no collision proxies")
    if len(sockets) < spec.minimum_sockets:
        errors.append(f"socket count {len(sockets)} < {spec.minimum_sockets}")
    for obj in nodes:
        if obj.type in {"CAMERA", "LIGHT"}:
            errors.append(f"production hierarchy retains {obj.type}: {obj.name}")
        if obj.type != "MESH":
            continue
        if any(abs(value - 1.0) > 1e-5 for value in obj.scale):
            errors.append(f"unapplied scale on {obj.name}: {tuple(obj.scale)}")
        if any(abs(value) > 1e-5 for value in obj.rotation_euler):
            errors.append(f"unapplied rotation on {obj.name}: {tuple(obj.rotation_euler)}")
        if not obj.get("collision_proxy"):
            if not obj.data.uv_layers:
                errors.append(f"visible mesh has no UVs: {obj.name}")
            if not obj.data.materials or any(mat is None for mat in obj.data.materials):
                errors.append(f"visible mesh has invalid material slots: {obj.name}")

    bounds = A.world_bounds(root)
    for axis, actual, expected in zip("XYZ", bounds.size, spec.target_dimensions):
        allowed = max(0.012, expected * spec.dimension_tolerance)
        if abs(actual - expected) > allowed:
            errors.append(
                f"{axis} dimension {actual:.4f}m differs from target {expected:.4f}m "
                f"(allowed {allowed:.4f}m)"
            )
    if bounds.minimum[2] < -0.005:
        errors.append(f"visible geometry extends below placement plane: z={bounds.minimum[2]:.5f}")

    if spec.key == "opening_drinks_cooler":
        door = by_name.get("COOLER_Door")
        pivot = by_name.get("PIVOT_COOLER_Door")
        bottle_sockets = [obj for obj in sockets if obj.name.startswith("SOCKET_Bottle_")]
        if door is None or door.type != "EMPTY":
            errors.append("COOLER_Door is not a separate empty transform")
        else:
            expected_hinge = (-0.420, -0.280, 0.0)
            if max(abs(door.location[i] - expected_hinge[i]) for i in range(3)) > 1e-5:
                errors.append(f"COOLER_Door origin is not at hinge: {tuple(door.location)}")
            if not any(child.type == "MESH" for child in door.children_recursive):
                errors.append("COOLER_Door has no moving mesh descendants")
        if pivot is None or max(abs(pivot.location[i] - (-0.420, -0.280, 0.0)[i]) for i in range(3)) > 1e-5:
            errors.append("PIVOT_COOLER_Door datum is absent or misplaced")
        if len(bottle_sockets) != 24:
            errors.append(f"expected 24 bottle sockets, found {len(bottle_sockets)}")
        expected_names = {f"SOCKET_Bottle_{index:02d}" for index in range(1, 25)}
        missing = sorted(expected_names.difference(obj.name for obj in bottle_sockets))
        if missing:
            errors.append(f"bottle socket sequence has gaps: {missing}")
        if "COOLER_Door_Open" not in bpy.data.actions or "COOLER_Door_Close" not in bpy.data.actions:
            errors.append("cooler open/close animation clips are missing")

    polygons = 0
    triangles = 0
    material_names: set[str] = set()
    for obj in visible_meshes:
        polygons += len(obj.data.polygons)
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        material_names.update(mat.name for mat in obj.data.materials if mat)
    if triangles > 30000:
        warnings.append(f"triangle count {triangles} exceeds lightweight target 30000")

    report: dict[str, object] = {
        "key": spec.key,
        "root": root.name,
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "boundsMeters": bounds.to_dict(),
        "nodeCount": len(nodes),
        "visibleMeshCount": len(visible_meshes),
        "collisionMeshCount": len(collisions),
        "socketCount": len(sockets),
        "pivotCount": sum(1 for obj in nodes if obj.type == "EMPTY" and (obj.name.startswith("PIVOT_") or obj.get("marker_type") == "pivot")),
        "materialCount": len(material_names),
        "materialNames": sorted(material_names),
        "polygonCount": polygons,
        "triangleCount": triangles,
        "sourcePath": spec.source_path.relative_to(REPO_ROOT).as_posix(),
        "exportPath": spec.export_path.relative_to(REPO_ROOT).as_posix(),
        "requiredNodes": list(spec.required_nodes),
    }
    if errors:
        raise RuntimeError(f"{spec.key} build validation failed: " + "; ".join(errors))
    return report


def _parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--only",
        nargs="*",
        choices=[spec.key for spec in SPECS],
        help="build only the named asset keys; default builds the complete set",
    )
    return parser.parse_args(list(argv))


def main(argv: Sequence[str] | None = None) -> int:
    blender_args = A.blender_cli_args(sys.argv) if argv is None else list(argv)
    args = _parse_args(blender_args)
    selected = set(args.only or [spec.key for spec in SPECS])
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    reports: list[dict[str, object]] = []
    for index, spec in enumerate(SPECS, 1):
        if spec.key not in selected:
            continue
        A.reset_scene(seed=9100 + index)
        root = spec.builder()
        root["deterministic_seed"] = 9100 + index
        report = _validate_build(spec, root)
        A.save_blend(spec.source_path)
        A.export_glb(spec.export_path, root, include_animations=True)
        report["sourceBytes"] = spec.source_path.stat().st_size
        report["glbBytes"] = spec.export_path.stat().st_size
        report["sourceSha256"] = A.sha256_file(spec.source_path)
        report["glbSha256"] = A.sha256_file(spec.export_path)
        reports.append(report)
        print("PINE_HILLS_ASSET|" + json.dumps(report, sort_keys=True))

    manifest = {
        "schema": "pine-hills-interior-assets-v1",
        "blenderVersion": ".".join(str(value) for value in bpy.app.version),
        "units": "meters",
        "sourceLicense": "Project-owned original procedural geometry",
        "externalAssets": False,
        "externalTextures": False,
        "assetCount": len(reports),
        "assets": reports,
    }
    BUILD_MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"BUILD_MANIFEST|{BUILD_MANIFEST}|assets={len(reports)}")
    print("PINE_HILLS_INTERIOR_BUILD|" + json.dumps(manifest, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
