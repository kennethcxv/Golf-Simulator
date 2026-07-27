"""Build the modern public-course clubhouse and its modular site kit.

This is an original, project-owned asset.  It deliberately does not touch the
legacy Tripo clubhouse sources.  All measurements are metres, +Z is up, and
the authored front/player side is -Y (matching the Sheet-6 clubhouse datum).

    blender --background --factory-startup \
      --python tools/blender/build_modern_public_clubhouse.py -- --preview

The finished starter building uses a compact 16.80 x 10.50 m footprint:
176.4 m2 / 1,898.8 sq ft.  The companion site contains exactly 52 marked
parking spaces, a 12 x 8.4 m cart barn, loading apron, sidewalks, landscaping,
and an intentionally unfurnished patio.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import assets_51_100_lib as A


BUILDING_W = 16.80
BUILDING_D = 10.50
FLOOR_Z = 0.27432
WALL_T = 0.23
EAVE_Z = 3.82
RIDGE_Z = 6.47
FRONT_Y = -BUILDING_D / 2.0
BACK_Y = BUILDING_D / 2.0
MAIN_DOOR_X = -0.73152
SERVICE_DOOR_Y = 3.29184
SERVICE_DOOR_WIDTH = 1.3716  # exact 1.50 yd live receiving contract
SERVICE_DOOR_RECT_HEIGHT = 2.58
SERVICE_DOOR_ARCH_CLEAR_HEIGHT = 2.55
OFFICE_DOOR_X = 7.55
OFFICE_DOOR_Y = -2.0 * 0.9144
OFFICE_DOOR_WIDTH = 1.3 * 0.9144
OFFICE_DOOR_HEIGHT = 2.5 * 0.9144
RESTROOM_EAST_X = 6.90
RESTROOM_SOUTH_Y = 3.25
RESTROOM_NORTH_Y = 5.00
RESTROOM_TOILET_X = 6.42
RESTROOM_TOILET_Y = 4.70
RESTROOM_SINK_X = 5.84
RESTROOM_SINK_Y = 4.70
CART_BARN_X = 24.50
CART_BARN_Y = 4.50
M_TO_FT = 3.280839895
M2_TO_FT2 = 10.763910417

SOURCE_DIR = REPO_ROOT / "asset_sources" / "blender" / "clubhouse"
RUNTIME_DIR = REPO_ROOT / "vendor" / "models" / "clubhouse"
PREVIEW_DIR = REPO_ROOT / "qa" / "clubhouse-modern" / "blender"

BUILDING_SOURCE = SOURCE_DIR / "modern_public_clubhouse_v1.blend"
BUILDING_GLB = RUNTIME_DIR / "modern_public_clubhouse_v1.glb"
BUILDING_PREVIEW = PREVIEW_DIR / "modern_public_clubhouse_v1.png"
SITE_SOURCE = SOURCE_DIR / "modern_public_clubhouse_site_v1.blend"
SITE_GLB = RUNTIME_DIR / "modern_public_clubhouse_site_v1.glb"
SITE_PREVIEW = PREVIEW_DIR / "modern_public_clubhouse_site_v1.png"
BUILDING_MANIFEST = PREVIEW_DIR / "modern_public_clubhouse_v1_manifest.json"
SITE_MANIFEST = PREVIEW_DIR / "modern_public_clubhouse_site_v1_manifest.json"


def cli() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset", choices=("all", "building", "site"), default="all")
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--no-save", action="store_true")
    parser.add_argument("--no-export", action="store_true")
    args = A.blender_cli_args()
    return parser.parse_args(args)


def group(name: str, parent: bpy.types.Object, **properties: object) -> bpy.types.Object:
    obj = bpy.data.objects.new(f"LOD0_{name}", None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.12
    obj["lod_level"] = 0
    for key, value in properties.items():
        obj[key] = value
    A.parent_keep_world(obj, parent)
    return obj


def materials() -> dict[str, bpy.types.Material]:
    palette = A.palette_materials()
    palette.update({
        # The facade is the optimistic mid-tone in the palette; deep golf green
        # stays on doors/signage instead of swallowing the whole building in shade.
        "sage_siding": A.material("MCP_SageFiberCement", A.hex_to_linear_rgba("7A8E7D"), roughness=0.72),
        "cream_plaster": A.material("MCP_WarmCreamPlaster", A.hex_to_linear_rgba("E7E0CF"), roughness=0.82),
        "charcoal_roof": A.material("MCP_ArchitecturalShingle", A.hex_to_linear_rgba("343635"), roughness=0.91),
        "stone": A.material("MCP_WarmLedgestone", A.hex_to_linear_rgba("716B5F"), roughness=0.96),
        "stone_light": A.material("MCP_WarmLedgestoneLight", A.hex_to_linear_rgba("918A7B"), roughness=0.95),
        "concrete": A.material("MCP_BroomFinishedConcrete", A.hex_to_linear_rgba("B9B4A8"), roughness=0.94),
        "concrete_dark": A.material("MCP_LoadingConcrete", A.hex_to_linear_rgba("918F88"), roughness=0.95),
        "asphalt": A.material("MCP_CleanAsphalt", A.hex_to_linear_rgba("3B3D3C"), roughness=0.98),
        "stripe": A.material("MCP_ParkingStripe", A.hex_to_linear_rgba("ECE7D7"), roughness=0.87),
        "accessible": A.material("MCP_AccessibleBlue", A.hex_to_linear_rgba("2D6382"), roughness=0.86),
        "mulch": A.material("MCP_WalnutMulch", A.hex_to_linear_rgba("4B3729"), roughness=1.0),
        "leaf_dark": A.material("MCP_LandscapeLeafDark", A.hex_to_linear_rgba("244D34"), roughness=0.87),
        "leaf_sage": A.material("MCP_LandscapeLeafSage", A.hex_to_linear_rgba("647B60"), roughness=0.89),
        "door_green": A.material("MCP_DeepGreenMetal", A.hex_to_linear_rgba("183B2A"), roughness=0.46, metallic=0.12),
        "glass": A.material("MCP_ClearStorefrontGlass", A.hex_to_linear_rgba("A9C2BD", 0.22), roughness=0.10, alpha=0.22, transmission=0.78, ior=1.45, double_sided=True),
        "interior_floor": A.material("MCP_NeutralInteriorFloor", A.hex_to_linear_rgba("A9A49A"), roughness=0.76),
        "ceiling": A.material("MCP_CleanAcousticCeiling", A.hex_to_linear_rgba("EEE9DC"), roughness=0.90),
        "light": A.material("MCP_WarmLightLens", A.hex_to_linear_rgba("FFF2CE"), roughness=0.34, emission_color=A.hex_to_linear_rgba("FFDFA4"), emission_strength=2.2),
        "sign_cream": A.material("MCP_SignLetterCream", A.hex_to_linear_rgba("FFF4D6"), roughness=0.42, emission_color=A.hex_to_linear_rgba("FFE5A8"), emission_strength=0.42),
    })
    return palette


def module_socket_pair(parent: bpy.types.Object, half_width: float, *, axis: str = "x") -> None:
    if axis == "x":
        A.socket("ModulePrevious", parent=parent, location=(-half_width, 0, 0), properties={"snap_axis": "+X"})
        A.socket("ModuleNext", parent=parent, location=(half_width, 0, 0), properties={"snap_axis": "+X"})
    else:
        A.socket("ModulePrevious", parent=parent, location=(0, -half_width, 0), properties={"snap_axis": "+Y"})
        A.socket("ModuleNext", parent=parent, location=(0, half_width, 0), properties={"snap_axis": "+Y"})


def join_meshes(name: str, objects: list[bpy.types.Object], parent: bpy.types.Object, **properties: object) -> bpy.types.Object | None:
    """Join same-material detail within one reusable module, preserving its hierarchy."""
    objects = [obj for obj in objects if obj and obj.type == "MESH"]
    if not objects:
        return None
    if len(objects) == 1:
        joined = objects[0]
        joined.name = f"MESH_{name}"
        A.apply_transforms(joined, rotation=True, scale=True)
        for key, value in properties.items():
            joined[key] = value
        A.parent_keep_world(joined, parent)
        return joined
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = f"MESH_{name}"
    A.apply_transforms(joined, rotation=True, scale=True)
    for key, value in properties.items():
        joined[key] = value
    A.parent_keep_world(joined, parent)
    return joined


def wall_piece(
    name: str,
    parent: bpy.types.Object,
    m: dict[str, bpy.types.Material],
    *,
    wall: str,
    center: float,
    length: float,
    z0: float,
    z1: float,
    role: str,
) -> bpy.types.Object:
    """Create one reusable wall infill with exterior lap siding and interior liner."""
    module = group(
        name,
        parent,
        module_family="wall-infill",
        module_role=role,
        reusable=True,
        length_m=round(length, 5),
        height_m=round(z1 - z0, 5),
    )
    module_socket_pair(module, length / 2.0, axis="x" if wall in ("front", "back") else "y")
    zc = (z0 + z1) / 2.0
    height = z1 - z0
    if wall == "front":
        base_dims, base_loc = (length, WALL_T, height), (center, FRONT_Y + WALL_T / 2.0, zc)
        outer_axis, outer = "y", FRONT_Y - 0.022
        inner_loc = (center, FRONT_Y + WALL_T + 0.014, zc)
        inner_dims = (length, 0.028, height)
    elif wall == "back":
        base_dims, base_loc = (length, WALL_T, height), (center, BACK_Y - WALL_T / 2.0, zc)
        outer_axis, outer = "y", BACK_Y + 0.022
        inner_loc = (center, BACK_Y - WALL_T - 0.014, zc)
        inner_dims = (length, 0.028, height)
    elif wall == "west":
        base_dims, base_loc = (WALL_T, length, height), (-BUILDING_W / 2.0 + WALL_T / 2.0, center, zc)
        outer_axis, outer = "x", -BUILDING_W / 2.0 - 0.022
        inner_loc = (-BUILDING_W / 2.0 + WALL_T + 0.014, center, zc)
        inner_dims = (0.028, length, height)
    else:
        base_dims, base_loc = (WALL_T, length, height), (BUILDING_W / 2.0 - WALL_T / 2.0, center, zc)
        outer_axis, outer = "x", BUILDING_W / 2.0 + 0.022
        inner_loc = (BUILDING_W / 2.0 - WALL_T - 0.014, center, zc)
        inner_dims = (0.028, length, height)
    A.box(f"{name}_Structural", base_dims, base_loc, m["sage_siding"], parent=module, bevel=0.008, properties={"structural_wall": True})
    A.box(f"{name}_InteriorLiner", inner_dims, inner_loc, m["cream_plaster"], parent=module, bevel=0.003, properties={"interior_finish": True})

    # A restrained 300 mm lap rhythm gives close-range scale without micro-detail.
    row_h = 0.30
    lap_parts: list[bpy.types.Object] = []
    row = 0
    z = z0 + row_h
    while z < z1 - 0.04:
        if wall in ("front", "back"):
            dims = (length, 0.028, 0.032)
            loc = (center, outer, z)
        else:
            dims = (0.028, length, 0.032)
            loc = (outer, center, z)
        lap_parts.append(A.box(f"{name}_Lap_{row:02d}", dims, loc, m["sage_siding"], parent=module, bevel=0.004, properties={"fiber_cement_lap": True, "course_m": row_h}))
        row += 1
        z += row_h
    join_meshes(f"{name}_LapCladding", lap_parts, module, fiber_cement_lap=True, course_m=row_h)
    return module


def window_module(
    name: str,
    parent: bpy.types.Object,
    m: dict[str, bpy.types.Material],
    *,
    wall: str,
    center: float,
    width: float,
    sill: float = 0.72,
    height: float = 2.25,
) -> bpy.types.Object:
    module = group(name, parent, module_family="storefront-window", reusable=True, width_m=width, height_m=height)
    module_socket_pair(module, width / 2.0, axis="x" if wall in ("front", "back") else "y")
    head = sill + height
    depth = 0.13
    frame = 0.105
    if wall in ("front", "back"):
        y = FRONT_Y - 0.025 if wall == "front" else BACK_Y + 0.025
        loc = lambda u, z: (center + u, y, z)
        dims_v = (frame, depth, height)
        dims_h = (width, depth, frame)
        glass_dims = (width - 2 * frame, 0.032, height - 2 * frame)
        glass_loc = (center, y, sill + height / 2.0)
        mullion_dims = (0.055, depth + 0.005, height - 2 * frame)
    else:
        x = -BUILDING_W / 2.0 - 0.025 if wall == "west" else BUILDING_W / 2.0 + 0.025
        loc = lambda u, z: (x, center + u, z)
        dims_v = (depth, frame, height)
        dims_h = (depth, width, frame)
        glass_dims = (0.032, width - 2 * frame, height - 2 * frame)
        glass_loc = (x, center, sill + height / 2.0)
        mullion_dims = (depth + 0.005, 0.055, height - 2 * frame)
    A.box(f"{name}_Glass", glass_dims, glass_loc, m["glass"], parent=module, bevel=0.002, properties={"cleanable_glass": True})
    for side, offset in (("L", -width / 2.0 + frame / 2.0), ("R", width / 2.0 - frame / 2.0)):
        A.box(f"{name}_Frame_{side}", dims_v, loc(offset, sill + height / 2.0), m["door_green"], parent=module, bevel=0.014)
    for side, z in (("Sill", sill + frame / 2.0), ("Head", head - frame / 2.0)):
        A.box(f"{name}_{side}", dims_h, loc(0, z), m["warm_cream"], parent=module, bevel=0.016)
    for index, offset in enumerate((-width / 6.0, width / 6.0)):
        A.box(f"{name}_Mullion_{index}", mullion_dims, loc(offset, sill + height / 2.0), m["door_green"], parent=module, bevel=0.009)
    # One horizontal transom reads as a practical storefront system from the lot.
    transom_dims = (width - 2 * frame, depth + 0.005, 0.055) if wall in ("front", "back") else (depth + 0.005, width - 2 * frame, 0.055)
    A.box(f"{name}_Transom", transom_dims, loc(0, sill + height * 0.67), m["door_green"], parent=module, bevel=0.009)
    return module


def aperture_wall(
    parent: bpy.types.Object,
    m: dict[str, bpy.types.Material],
    *,
    wall: str,
    openings: list[dict[str, float | str]],
) -> None:
    """Build a wall from reusable wall pieces around true door/window openings."""
    span_min = -BUILDING_W / 2.0 if wall in ("front", "back") else -BUILDING_D / 2.0
    span_max = BUILDING_W / 2.0 if wall in ("front", "back") else BUILDING_D / 2.0
    cursor = span_min
    for index, opening in enumerate(sorted(openings, key=lambda value: float(value["center"]))):
        center = float(opening["center"])
        width = float(opening["width"])
        left, right = center - width / 2.0, center + width / 2.0
        if left > cursor:
            wall_piece(f"{wall.title()}Solid_{index:02d}", parent, m, wall=wall, center=(cursor + left) / 2.0, length=left - cursor, z0=FLOOR_Z, z1=EAVE_Z, role="solid")
        sill = float(opening.get("sill", FLOOR_Z))
        height = float(opening["height"])
        head = sill + height
        if sill > FLOOR_Z + 0.001:
            wall_piece(f"{wall.title()}Below_{index:02d}", parent, m, wall=wall, center=center, length=width, z0=FLOOR_Z, z1=sill, role=f"below-{opening['kind']}")
        if head < EAVE_Z - 0.001:
            wall_piece(f"{wall.title()}Above_{index:02d}", parent, m, wall=wall, center=center, length=width, z0=head, z1=EAVE_Z, role=f"above-{opening['kind']}")
        cursor = right
    if cursor < span_max:
        wall_piece(f"{wall.title()}Solid_End", parent, m, wall=wall, center=(cursor + span_max) / 2.0, length=span_max - cursor, z0=FLOOR_Z, z1=EAVE_Z, role="solid")


def east_arch_opening_shoulders(
    parent: bpy.types.Object,
    m: dict[str, bpy.types.Material],
    *,
    center: float,
    rectangular_width: float,
    rectangular_height: float,
    clear_width: float,
    clear_height: float,
) -> None:
    """Shape a true arched rough opening inside an east-wall rectangle."""
    shoulders = group(
        "RearServiceArchedOpeningShoulders",
        parent,
        module_family="arched-door-infill",
        reusable=True,
        clear_width_m=round(clear_width, 5),
        clear_height_m=round(clear_height, 5),
    )
    radius = clear_width / 2.0
    spring = FLOOR_Z + clear_height - radius
    apex = FLOOR_Z + clear_height
    rectangular_head = FLOOR_Z + rectangular_height
    half_rect = rectangular_width / 2.0
    segments = 24
    left_arc = [
        (
            math.cos(math.pi - (math.pi / 2.0) * index / segments) * radius,
            spring + math.sin(math.pi - (math.pi / 2.0) * index / segments) * radius,
        )
        for index in range(segments + 1)
    ]
    right_arc = [
        (
            math.cos((math.pi / 2.0) * (1.0 - index / segments)) * radius,
            spring + math.sin((math.pi / 2.0) * (1.0 - index / segments)) * radius,
        )
        for index in range(segments + 1)
    ]
    profiles = {
        "Left": [(-half_rect, spring), *left_arc, (0.0, rectangular_head), (-half_rect, rectangular_head)],
        "Right": [(radius, spring), (half_rect, spring), (half_rect, rectangular_head), (0.0, rectangular_head), (0.0, apex), *right_arc[1:]],
    }
    layers = (
        ("Structural", BUILDING_W / 2.0 - WALL_T / 2.0, WALL_T, m["sage_siding"]),
        ("ExteriorFinish", BUILDING_W / 2.0 + 0.022, 0.028, m["sage_siding"]),
        ("InteriorLiner", BUILDING_W / 2.0 - WALL_T - 0.014, 0.028, m["cream_plaster"]),
    )
    for side, profile in profiles.items():
        for layer, x, depth, material in layers:
            A.profile_prism(
                f"RearServiceArchShoulder_{side}_{layer}",
                profile,
                depth,
                (x, center, 0.0),
                material,
                rotation=(0.0, 0.0, math.pi / 2.0),
                parent=shoulders,
                bevel=0.003 if layer == "Structural" else 0.0015,
                properties={
                    "arched_aperture_infill": True,
                    "side": side.lower(),
                    "finish_layer": layer.lower(),
                },
            )


def stone_water_table(parent: bpy.types.Object, m: dict[str, bpy.types.Material]) -> None:
    stone = group("MODULE_StoneWaterTable", parent, module_family="stone-veneer", reusable=True)
    height = 0.58
    depth = 0.09
    # Grade-level openings must remain physically and visually clear. Split the
    # modular stones at each jamb instead of laying a full water table behind
    # the doors; windows keep the course below their raised sills.
    grade_openings = {
        "Front": ((MAIN_DOOR_X, 1.80),),
        "East": ((0.15, 3.60), (SERVICE_DOOR_Y, SERVICE_DOOR_WIDTH)),
    }
    jamb_clearance = 0.055

    def visible_segments(start: float, end: float, wall: str) -> list[tuple[float, float]]:
        segments = [(start, end)]
        for center, width in grade_openings.get(wall, ()):
            cut_start = center - width / 2.0 - jamb_clearance
            cut_end = center + width / 2.0 + jamb_clearance
            split: list[tuple[float, float]] = []
            for segment_start, segment_end in segments:
                if segment_end <= cut_start or segment_start >= cut_end:
                    split.append((segment_start, segment_end))
                    continue
                if segment_start < cut_start:
                    split.append((segment_start, cut_start))
                if segment_end > cut_end:
                    split.append((cut_end, segment_end))
            segments = split
        return [(a, b) for a, b in segments if b - a >= 0.07]

    # Alternating 0.60 m blocks avoid a flat primitive while remaining stylized.
    for wall, count, total, fixed in (
        ("Front", 32, BUILDING_W, FRONT_Y - depth / 2.0),
        ("Back", 32, BUILDING_W, BACK_Y + depth / 2.0),
        ("West", 21, BUILDING_D, -BUILDING_W / 2.0 - depth / 2.0),
        ("East", 21, BUILDING_D, BUILDING_W / 2.0 + depth / 2.0),
    ):
        unit = total / count
        for index in range(count):
            unit_start = -total / 2.0 + index * unit
            unit_end = unit_start + unit
            z = 0.08 + height / 2.0 + (0.018 if index % 3 == 0 else 0)
            mat = m["stone_light"] if index % 4 in (0, 3) else m["stone"]
            for segment_index, (start, end) in enumerate(visible_segments(unit_start, unit_end, wall)):
                length = end - start
                u = (start + end) / 2.0
                if wall in ("Front", "Back"):
                    dims, loc = (length - 0.015, depth, height - 0.025), (u, fixed, z)
                else:
                    dims, loc = (depth, length - 0.015, height - 0.025), (fixed, u, z)
                A.box(
                    f"Stone_{wall}_{index:02d}_{segment_index}",
                    dims,
                    loc,
                    mat,
                    parent=stone,
                    bevel=0.022,
                    properties={"module_unit_m": unit, "door_apertures_clipped": True},
                )


def roof_system(parent: bpy.types.Object, m: dict[str, bpy.types.Material]) -> None:
    roof = group("MODULE_RoofSystem", parent, module_family="gable-roof", reusable=True, pitch_degrees=28.0)
    run = BUILDING_D / 2.0 + 0.48
    rise = RIDGE_Z - EAVE_Z
    angle = math.atan2(rise, run)
    slope_len = math.hypot(run, rise)
    center_z = (EAVE_Z + RIDGE_Z) / 2.0
    for side, y, rotation in (("Front", -run / 2.0, angle), ("Back", run / 2.0, -angle)):
        plane = A.box(f"Roof_{side}_Plane", (BUILDING_W + 1.05, slope_len, 0.16), (0, y, center_z), m["charcoal_roof"], parent=roof, rotation=(rotation, 0, 0), bevel=0.018, properties={"roof_module": side.lower()})
        plane["pivot_role"] = "roof-plane-center"
    A.box("Roof_RidgeCap", (BUILDING_W + 1.10, 0.20, 0.18), (0, 0, RIDGE_Z - 0.02), m["warm_charcoal"], parent=roof, bevel=0.055, properties={"roof_module": "ridge"})
    for side, y in (("Front", FRONT_Y - 0.46), ("Back", BACK_Y + 0.46)):
        A.box(f"Roof_{side}_Fascia", (BUILDING_W + 1.0, 0.16, 0.28), (0, y, EAVE_Z - 0.03), m["warm_cream"], parent=roof, bevel=0.018, properties={"trim_module": "fascia"})
        A.box(f"Roof_{side}_Gutter", (BUILDING_W + 0.88, 0.16, 0.14), (0, y - (0.04 if side == 'Front' else -0.04), EAVE_Z - 0.20), m["warm_charcoal"], parent=roof, bevel=0.052, properties={"roof_module": "gutter"})
    for x in (-9.18, 9.18):
        for y in (FRONT_Y - 0.48, BACK_Y + 0.48):
            A.cylinder(f"Downspout_{'W' if x < 0 else 'E'}_{'F' if y < 0 else 'B'}", 0.050, 3.36, (x, y, 1.92), m["warm_charcoal"], parent=roof, vertices=16, bevel=0.006, properties={"roof_module": "downspout"})
    A.socket("RoofExpansionWest", parent=roof, location=(-BUILDING_W / 2.0, 0, EAVE_Z))
    A.socket("RoofExpansionEast", parent=roof, location=(BUILDING_W / 2.0, 0, EAVE_Z))


def porch_system(parent: bpy.types.Object, m: dict[str, bpy.types.Material]) -> None:
    porch = group("MODULE_MainEntrancePorch", parent, module_family="cross-gable-porch", reusable=True, width_m=7.6, depth_m=3.35)
    porch_x = MAIN_DOOR_X
    slab_center_y = FRONT_Y - 1.34
    A.box("Porch_ConcreteSlab", (7.6, 2.68, FLOOR_Z), (porch_x, slab_center_y, FLOOR_Z / 2.0), m["concrete"], parent=porch, bevel=0.025, properties={"walkable": True})
    for step, (depth, y, height) in enumerate(((0.82, FRONT_Y - 3.10, 0.09), (0.88, FRONT_Y - 2.38, 0.18))):
        A.box(f"Porch_Step_{step}", (4.65 + step * 0.32, depth, height), (porch_x, y, height / 2.0), m["concrete"], parent=porch, bevel=0.018, properties={"step_rise_m": height})
    post_xs = (porch_x - 3.08, porch_x + 3.08)
    for index, x in enumerate(post_xs):
        col = group(f"MODULE_PorchColumn_{index}", porch, module_family="porch-column", reusable=True, pivot_role="base-center")
        A.box(f"Column_{index}_StoneFoot", (0.62, 0.62, 0.58), (x, FRONT_Y - 2.18, FLOOR_Z + 0.29), m["stone"], parent=col, bevel=0.045)
        A.box(f"Column_{index}_Plinth", (0.42, 0.42, 0.16), (x, FRONT_Y - 2.18, FLOOR_Z + 0.66), m["warm_cream"], parent=col, bevel=0.030)
        A.box(f"Column_{index}_Shaft", (0.30, 0.30, 2.44), (x, FRONT_Y - 2.18, FLOOR_Z + 1.96), m["warm_cream"], parent=col, bevel=0.025)
        A.box(f"Column_{index}_Capital", (0.48, 0.48, 0.22), (x, FRONT_Y - 2.18, 3.28), m["warm_cream"], parent=col, bevel=0.035)
        A.socket("ColumnTop", parent=col, location=(x, FRONT_Y - 2.18, 3.39))
    # Cross-gable roof over the entry, with its ridge running toward the lot.
    half_w = 4.02
    roof_eave = 3.48
    roof_peak = 5.33
    run = half_w
    rise = roof_peak - roof_eave
    angle = math.atan2(rise, run)
    length = math.hypot(run, rise)
    cy = FRONT_Y - 1.22
    cz = (roof_eave + roof_peak) / 2.0
    A.box("Porch_RoofWest", (length, 3.72, 0.15), (porch_x - run / 2.0, cy, cz), m["charcoal_roof"], parent=porch, rotation=(0, -angle, 0), bevel=0.018, properties={"roof_module": "porch-west"})
    A.box("Porch_RoofEast", (length, 3.72, 0.15), (porch_x + run / 2.0, cy, cz), m["charcoal_roof"], parent=porch, rotation=(0, angle, 0), bevel=0.018, properties={"roof_module": "porch-east"})
    A.box("Porch_Ridge", (0.18, 3.84, 0.18), (porch_x, cy, roof_peak - 0.03), m["warm_charcoal"], parent=porch, bevel=0.045)
    # A finished public entrance has a continuous soffit and a closed rear
    # gable where the cross-gable meets the main facade.  Leaving this volume
    # open exposed a bright triangular slice of sky from the normal player
    # approach and made the porch read as missing roof geometry.
    A.box(
        "Porch_Soffit",
        (7.72, 3.52, 0.08),
        (porch_x, cy, roof_eave - 0.10),
        m["warm_cream"],
        parent=porch,
        bevel=0.015,
        properties={"roof_module": "porch-soffit", "closes_roof_joint": True},
    )
    A.profile_prism(
        "Porch_RearGableInfill",
        [(-half_w, roof_eave), (0, roof_peak), (half_w, roof_eave)],
        0.14,
        (porch_x, FRONT_Y + 0.51, 0),
        m["sage_siding"],
        parent=porch,
        bevel=0.010,
        properties={"module_family": "gable-infill", "closes_roof_joint": True},
    )
    A.profile_prism("Porch_GableFace", [(-half_w, roof_eave), (0, roof_peak), (half_w, roof_eave)], 0.12, (porch_x, FRONT_Y - 3.08, 0), m["sage_siding"], parent=porch, bevel=0.010, properties={"module_family": "gable-face"})
    A.box("Porch_GableFascia", (8.20, 0.14, 0.19), (porch_x, FRONT_Y - 3.17, roof_eave), m["warm_cream"], parent=porch, bevel=0.016)
    sign = group("MODULE_BuildingSign", porch, module_family="signage", reusable=True)
    A.box("Sign_Backboard", (5.75, 0.11, 1.08), (porch_x, FRONT_Y - 3.18, 4.08), m["deep_green"], parent=sign, bevel=0.070)
    A.text_mesh("Sign_Pinehollow", "PINE HOLLOW", (porch_x, FRONT_Y - 3.245, 4.25), m["sign_cream"], size=0.49, depth=0.025, bevel=0.006, parent=sign, properties={"fictional_brand": True})
    A.text_mesh("Sign_GolfClub", "PUBLIC GOLF CLUB", (porch_x, FRONT_Y - 3.247, 3.88), m["restrained_brass"], size=0.18, depth=0.018, bevel=0.004, parent=sign, properties={"fictional_brand": True})
    A.socket("MainEntrance", parent=porch, location=(MAIN_DOOR_X, FRONT_Y, FLOOR_Z))


def door_frame(name: str, parent: bpy.types.Object, m: dict[str, bpy.types.Material], *, x: float, y: float, width: float, height: float, wall: str) -> bpy.types.Object:
    frame = group(name, parent, module_family="door-frame", reusable=True, width_m=width, height_m=height)
    t = 0.12
    if wall in ("front", "back"):
        dims_v, dims_h = (t, 0.24, height), (width + 2 * t, 0.24, t)
        loc = lambda ox, z: (x + ox, y, z)
    else:
        dims_v, dims_h = (0.24, t, height), (0.24, width + 2 * t, t)
        loc = lambda ox, z: (x, y + ox, z)
    A.box(f"{name}_JambL", dims_v, loc(-width / 2.0 - t / 2.0, FLOOR_Z + height / 2.0), m["warm_cream"], parent=frame, bevel=0.016)
    A.box(f"{name}_JambR", dims_v, loc(width / 2.0 + t / 2.0, FLOOR_Z + height / 2.0), m["warm_cream"], parent=frame, bevel=0.016)
    A.box(f"{name}_Header", dims_h, loc(0, FLOOR_Z + height + t / 2.0), m["warm_cream"], parent=frame, bevel=0.016)
    return frame


def hinged_door(name: str, parent: bpy.types.Object, m: dict[str, bpy.types.Material], *, x: float, y: float, width: float = 0.95, height: float = 2.15, rotation_z: float = 0.0) -> bpy.types.Object:
    # Author the closed leaf in the same rotated world frame as its pivot.  The
    # earlier version rotated only the empty and parent-kept an unrotated slab;
    # east/west doors therefore remained 0.92 m wide on world X and appeared as
    # paper-thin green slivers when viewed from the public room.
    along_x = math.cos(rotation_z)
    along_y = math.sin(rotation_z)
    hinge_x = x - along_x * width / 2.0
    hinge_y = y - along_y * width / 2.0
    pivot = A.pivot(
        name,
        parent=parent,
        location=(hinge_x, hinge_y, FLOOR_Z),
        rotation=(0, 0, rotation_z),
        properties={
            "moving_component": True,
            "hinge_axis": "+Z",
            "closed_rotation_z": rotation_z,
            "leaf_width_m": width,
            "leaf_height_m": height,
        },
    )
    A.box(
        f"{name}_Leaf",
        (width, 0.055, height),
        (x, y, FLOOR_Z + height / 2.0),
        m["door_green"],
        parent=pivot,
        rotation=(0, 0, rotation_z),
        bevel=0.024,
        properties={"door_leaf": True, "closed_pose": True},
    )
    handle_x = x + along_x * width * 0.31
    handle_y = y + along_y * width * 0.31
    # One through-spindle reads from both faces and remains aligned to the leaf
    # normal for north/south and east/west openings alike.
    A.cylinder(
        f"{name}_Lever",
        0.026,
        0.18,
        (handle_x, handle_y, FLOOR_Z + 1.02),
        m["restrained_brass"],
        parent=pivot,
        rotation=(math.pi / 2, 0, rotation_z),
        vertices=16,
        bevel=0.004,
        properties={"door_handle": True},
    )
    A.socket(
        f"{name}_Interaction",
        parent=pivot,
        location=(x, y, FLOOR_Z + 1.02),
        rotation=(0, 0, rotation_z),
        properties={"interaction_socket": True},
    )
    return pivot


def glazed_main_entrance(parent: bpy.types.Object, m: dict[str, bpy.types.Material]) -> None:
    """Author two independent storefront leaves on true outer hinge pivots."""
    entrance = group(
        "MODULE_MainEntranceDoors",
        parent,
        module_family="glazed-double-door",
        reusable=True,
        clear_width_m=1.80,
        clear_height_m=2.45,
    )
    opening_width = 1.80
    leaf_width = 0.87
    leaf_height = 2.39
    y = FRONT_Y - 0.035
    for side, hinge_x, direction in (
        ("Left", MAIN_DOOR_X - opening_width / 2.0, 1.0),
        ("Right", MAIN_DOOR_X + opening_width / 2.0, -1.0),
    ):
        pivot = A.pivot(
            f"MainEntrance{side}",
            parent=entrance,
            location=(hinge_x, y, FLOOR_Z),
            properties={
                "moving_component": True,
                "hinge_axis": "+Z",
                "main_leaf": side.lower(),
            },
        )
        cx = hinge_x + direction * leaf_width / 2.0
        rail = 0.085
        kick = 0.31
        A.box(f"MainEntrance{side}_Glass", (leaf_width - 2 * rail, 0.032, leaf_height - kick - rail), (cx, y, FLOOR_Z + kick + (leaf_height - kick - rail) / 2.0), m["glass"], parent=pivot, bevel=0.002, properties={"cleanable_glass": True})
        for edge, edge_x in (
            ("Outer", cx - leaf_width / 2.0 + rail / 2.0),
            ("Inner", cx + leaf_width / 2.0 - rail / 2.0),
        ):
            A.box(f"MainEntrance{side}_{edge}Stile", (rail, 0.075, leaf_height), (edge_x, y, FLOOR_Z + leaf_height / 2.0), m["door_green"], parent=pivot, bevel=0.012)
        A.box(f"MainEntrance{side}_HeadRail", (leaf_width, 0.075, rail), (cx, y, FLOOR_Z + leaf_height - rail / 2.0), m["door_green"], parent=pivot, bevel=0.012)
        A.box(f"MainEntrance{side}_KickPlate", (leaf_width - 2 * rail, 0.055, kick), (cx, y, FLOOR_Z + kick / 2.0), m["restrained_brass"], parent=pivot, bevel=0.010)
        handle_x = cx - direction * 0.27
        A.cylinder(f"MainEntrance{side}_Pull", 0.020, 0.48, (handle_x, y - 0.07, FLOOR_Z + 1.08), m["restrained_brass"], parent=pivot, vertices=16, bevel=0.004)
        A.socket(f"MainEntrance{side}Threshold", parent=pivot, location=(cx, y, FLOOR_Z))


def service_rooms(parent: bpy.types.Object, m: dict[str, bpy.types.Material]) -> None:
    rooms = group("MODULE_ServiceRoomPlan", parent, module_family="interior-room-plan", reusable=True, furnished=False)
    partition_x = 5.35
    # Employee room (front), storage (middle), restroom (rear). Retail and
    # operations furnishing remains runtime-authored; only the restroom's
    # permanent sanitary fitout belongs to this architectural source. Build the
    # spine around true rough openings. A former single full-height slab sat
    # coplanar behind the animated leaves, so open doors revealed solid wall.
    room_doors = (
        ("EMPLOYEE ROOM", -3.70, 0.98, 2.18),
        ("STORAGE", 0.20, 0.98, 2.18),
        ("IRRIGATION", 4.18, 0.98, 2.18),
    )
    spine_start = -BUILDING_D / 2.0 + WALL_T / 2.0
    spine_end = BUILDING_D / 2.0 - WALL_T / 2.0
    cursor = spine_start
    for index, (_, center_y, opening_width, opening_height) in enumerate(room_doors):
        opening_start = center_y - opening_width / 2.0
        opening_end = center_y + opening_width / 2.0
        if opening_start > cursor:
            A.box(
                f"Partition_ServiceSpine_Segment_{index:02d}",
                (WALL_T, opening_start - cursor, 3.16),
                (partition_x, (cursor + opening_start) / 2.0, FLOOR_Z + 1.58),
                m["cream_plaster"],
                parent=rooms,
                bevel=0.006,
                properties={"architectural_partition": True, "door_aperture": True},
            )
        header_height = 3.16 - opening_height
        A.box(
            f"Partition_ServiceSpine_Header_{index:02d}",
            (WALL_T, opening_width, header_height),
            (partition_x, center_y, FLOOR_Z + opening_height + header_height / 2.0),
            m["cream_plaster"],
            parent=rooms,
            bevel=0.006,
            properties={"architectural_partition": True, "door_aperture": True},
        )
        cursor = opening_end
    if cursor < spine_end:
        A.box(
            "Partition_ServiceSpine_Segment_End",
            (WALL_T, spine_end - cursor, 3.16),
            (partition_x, (cursor + spine_end) / 2.0, FLOOR_Z + 1.58),
            m["cream_plaster"],
            parent=rooms,
            bevel=0.006,
            properties={"architectural_partition": True, "door_aperture": True},
        )
    cross_start = partition_x + WALL_T / 2.0
    cross_end = BUILDING_W / 2.0 - WALL_T / 2.0
    office_left = OFFICE_DOOR_X - OFFICE_DOOR_WIDTH / 2.0
    office_right = OFFICE_DOOR_X + OFFICE_DOOR_WIDTH / 2.0
    # The front cross-wall retains the inherited office/stock doorway instead
    # of burying its authoritative architectural door in a solid GLB wall.
    for suffix, start, end in (
        ("West", cross_start, office_left),
        ("East", office_right, cross_end),
    ):
        A.box(
            f"Partition_ServiceCross_0_{suffix}",
            (end - start, WALL_T, 3.16),
            ((start + end) / 2.0, OFFICE_DOOR_Y, FLOOR_Z + 1.58),
            m["cream_plaster"],
            parent=rooms,
            bevel=0.006,
            properties={"architectural_partition": True, "office_door_aperture": True},
        )
    header_height = 3.16 - OFFICE_DOOR_HEIGHT
    A.box(
        "Partition_ServiceCross_0_Header",
        (OFFICE_DOOR_WIDTH, WALL_T, header_height),
        (OFFICE_DOOR_X, OFFICE_DOOR_Y, FLOOR_Z + OFFICE_DOOR_HEIGHT + header_height / 2.0),
        m["cream_plaster"],
        parent=rooms,
        bevel=0.006,
        properties={"architectural_partition": True, "office_door_aperture": True},
    )
    A.box(
        "Partition_ServiceCross_1",
        (cross_end - cross_start, WALL_T, 3.16),
        ((cross_start + cross_end) / 2.0, 2.25, FLOOR_Z + 1.58),
        m["cream_plaster"],
        parent=rooms,
        bevel=0.006,
        properties={"architectural_partition": True},
    )
    for label, y, opening_width, opening_height in room_doors:
        door_frame(f"Interior_{label.title().replace(' ', '')}_Frame", rooms, m, x=partition_x, y=y, width=opening_width, height=opening_height, wall="east")
        hinged_door(f"Interior_{label.title().replace(' ', '')}", rooms, m, x=partition_x, y=y, width=0.92, height=2.12, rotation_z=math.pi / 2.0)
        display_label = "RESTROOM" if label == "IRRIGATION" else label
        A.text_mesh(f"Interior_{label.title().replace(' ', '')}_Label", display_label, (partition_x - 0.145, y, 2.60), m["warm_charcoal"], size=0.125, depth=0.006, bevel=0.0015, rotation=(math.pi / 2, 0, -math.pi / 2), parent=rooms)

    # A compact, believable single-user restroom occupies the pod directly
    # behind the third service-spine door. The open south half preserves the
    # normal-controls route while the toilet and basin sit against the north
    # wall, away from the inward-swinging leaf.
    restroom = group(
        "MODULE_RestroomFitout",
        rooms,
        module_family="permanent-restroom-fitout",
        reusable=False,
        furnished=True,
    )
    restroom_center_y = (RESTROOM_SOUTH_Y + RESTROOM_NORTH_Y) / 2.0
    restroom_depth = RESTROOM_NORTH_Y - RESTROOM_SOUTH_Y
    cross_start = partition_x + WALL_T / 2.0
    cross_end = RESTROOM_EAST_X + WALL_T / 2.0
    cross_width = cross_end - cross_start
    cross_center_x = (cross_start + cross_end) / 2.0
    for name, dims, loc in (
        ("Restroom_EastWall", (WALL_T, restroom_depth, 3.16), (RESTROOM_EAST_X, restroom_center_y, FLOOR_Z + 1.58)),
        ("Restroom_SouthWall", (cross_width, WALL_T, 3.16), (cross_center_x, RESTROOM_SOUTH_Y, FLOOR_Z + 1.58)),
        ("Restroom_NorthWall", (cross_width, WALL_T, 3.16), (cross_center_x, RESTROOM_NORTH_Y, FLOOR_Z + 1.58)),
    ):
        A.box(name, dims, loc, m["cream_plaster"], parent=restroom, bevel=0.006, properties={"architectural_partition": True, "restroom_enclosure": True})

    clear_west = partition_x + WALL_T / 2.0
    clear_east = RESTROOM_EAST_X - WALL_T / 2.0
    clear_south = RESTROOM_SOUTH_Y + WALL_T / 2.0
    clear_north = RESTROOM_NORTH_Y - WALL_T / 2.0
    A.box(
        "Restroom_TileFloor",
        (clear_east - clear_west, clear_north - clear_south, 0.035),
        ((clear_west + clear_east) / 2.0, (clear_south + clear_north) / 2.0, FLOOR_Z + 0.0175),
        m["muted_sage"],
        parent=restroom,
        bevel=0.004,
        properties={"walkable": True, "permanent_restroom_fixture": True},
    )

    toilet = group("Restroom_Toilet", restroom, module_family="restroom-toilet", reusable=False)
    A.box("Restroom_ToiletPedestal", (0.42, 0.30, 0.42), (6.50, RESTROOM_TOILET_Y, FLOOR_Z + 0.21), m["cool_white"], parent=toilet, bevel=0.075, properties={"permanent_restroom_fixture": True})
    bowl = A.sphere("Restroom_ToiletBowl", 0.30, (RESTROOM_TOILET_X, RESTROOM_TOILET_Y, FLOOR_Z + 0.49), m["cool_white"], parent=toilet, segments=24, rings=12, properties={"permanent_restroom_fixture": True})
    bowl.scale = (1.12, 0.55, 0.43)
    A.apply_transforms(bowl)
    seat = A.torus("Restroom_ToiletSeat", 0.225, 0.030, (6.37, RESTROOM_TOILET_Y, FLOOR_Z + 0.615), m["warm_charcoal"], parent=toilet, major_segments=28, minor_segments=10, properties={"permanent_restroom_fixture": True})
    seat.scale = (1.22, 0.58, 1.0)
    A.apply_transforms(seat)
    A.box("Restroom_ToiletTank", (0.18, 0.34, 0.61), (6.68, RESTROOM_TOILET_Y, FLOOR_Z + 0.70), m["cool_white"], parent=toilet, bevel=0.045, properties={"permanent_restroom_fixture": True})
    A.box("Restroom_ToiletTankLid", (0.21, 0.37, 0.055), (6.68, RESTROOM_TOILET_Y, FLOOR_Z + 1.02), m["cool_white"], parent=toilet, bevel=0.018)
    A.cylinder("Restroom_ToiletFlush", 0.025, 0.018, (6.675, RESTROOM_TOILET_Y, FLOOR_Z + 1.055), m["restrained_brass"], parent=toilet, vertices=16, bevel=0.004)

    basin = group("Restroom_HandBasin", restroom, module_family="restroom-hand-basin", reusable=False)
    A.box("Restroom_BasinVanity", (0.52, 0.27, 0.70), (RESTROOM_SINK_X, RESTROOM_SINK_Y, FLOOR_Z + 0.35), m["muted_sage"], parent=basin, bevel=0.035, properties={"permanent_restroom_fixture": True})
    A.box("Restroom_BasinTop", (0.56, 0.30, 0.11), (RESTROOM_SINK_X, RESTROOM_SINK_Y - 0.01, FLOOR_Z + 0.735), m["cool_white"], parent=basin, bevel=0.045, properties={"permanent_restroom_fixture": True})
    A.box("Restroom_BasinInset", (0.34, 0.17, 0.025), (RESTROOM_SINK_X, RESTROOM_SINK_Y - 0.035, FLOOR_Z + 0.792), m["glass"], parent=basin, bevel=0.035)
    A.cylinder("Restroom_FaucetStem", 0.018, 0.18, (RESTROOM_SINK_X, RESTROOM_SINK_Y + 0.05, FLOOR_Z + 0.88), m["restrained_brass"], parent=basin, vertices=16, bevel=0.004)
    A.cylinder("Restroom_FaucetSpout", 0.016, 0.16, (RESTROOM_SINK_X, RESTROOM_SINK_Y - 0.02, FLOOR_Z + 0.96), m["restrained_brass"], parent=basin, vertices=16, rotation=(math.pi / 2, 0, 0), bevel=0.004)
    A.box("Restroom_Mirror", (0.62, 0.025, 0.74), (RESTROOM_SINK_X, RESTROOM_NORTH_Y - 0.128, FLOOR_Z + 1.52), m["glass"], parent=basin, bevel=0.016, properties={"permanent_restroom_fixture": True})
    for suffix, offset_x in (("West", -0.335), ("East", 0.335)):
        A.box(f"Restroom_MirrorFrame_{suffix}", (0.028, 0.035, 0.79), (RESTROOM_SINK_X + offset_x, RESTROOM_NORTH_Y - 0.142, FLOOR_Z + 1.52), m["medium_walnut"], parent=basin, bevel=0.006)
    for suffix, offset_z in (("Bottom", -0.395), ("Top", 0.395)):
        A.box(f"Restroom_MirrorFrame_{suffix}", (0.70, 0.035, 0.028), (RESTROOM_SINK_X, RESTROOM_NORTH_Y - 0.142, FLOOR_Z + 1.52 + offset_z), m["medium_walnut"], parent=basin, bevel=0.006)
    A.box("Restroom_LightLens", (0.52, 0.08, 0.10), (RESTROOM_SINK_X, RESTROOM_NORTH_Y - 0.17, FLOOR_Z + 2.07), m["light"], parent=basin, bevel=0.020, properties={"light_socket": True})
    A.socket("EmployeeRoomExpansion", parent=rooms, location=(partition_x, -3.70, FLOOR_Z))
    A.socket("StorageRoomExpansion", parent=rooms, location=(partition_x, 0.20, FLOOR_Z))
    A.socket("RestroomExpansion", parent=rooms, location=(partition_x, 4.18, FLOOR_Z))


def loading_door(parent: bpy.types.Object, m: dict[str, bpy.types.Material]) -> None:
    loading = group("MODULE_LoadingEntrance", parent, module_family="loading-entrance", reusable=True, width_m=3.6, height_m=3.05)
    x = BUILDING_W / 2.0 + 0.018
    center_y = 0.15
    width, height = 3.60, 3.05
    # True top pivot supports a future sectional-door animation.
    pivot = A.pivot("LoadingDoor", parent=loading, location=(x, center_y - width / 2.0, FLOOR_Z + height), rotation=(0, math.pi / 2, 0), properties={"moving_component": True, "hinge_axis": "+Y"})
    for row in range(9):
        z = FLOOR_Z + (row + 0.5) * height / 9.0
        A.box(f"LoadingDoor_Panel_{row:02d}", (0.075, width - 0.08, height / 9.0 - 0.018), (x, center_y, z), m["door_green"], parent=pivot, bevel=0.012, properties={"sectional_panel": True})
    for y in (center_y - width / 2.0 - 0.11, center_y + width / 2.0 + 0.11):
        A.box("LoadingDoor_Jamb", (0.18, 0.20, height + 0.25), (x, y, FLOOR_Z + height / 2.0), m["warm_cream"], parent=loading, bevel=0.018)
    A.box("LoadingDoor_Header", (0.18, width + 0.42, 0.24), (x, center_y, FLOOR_Z + height + 0.11), m["warm_cream"], parent=loading, bevel=0.018)
    A.box("LoadingDoor_Bumper", (0.22, width + 0.58, 0.16), (x + 0.05, center_y, FLOOR_Z + 0.08), m["warm_charcoal"], parent=loading, bevel=0.030)
    A.socket("LoadingApron", parent=loading, location=(x, center_y, FLOOR_Z))


def building_asset() -> bpy.types.Object:
    m = materials()
    root = A.asset_root(
        A.AssetIdentity(51, "modern_public_clubhouse_v1"),
        (BUILDING_W, BUILDING_D, 6.60),
        source_note="Original modular Course-2 clubhouse authored in-repository from Designs/ClubHouse references",
        license_note="Project-owned original; no external assets",
    )
    root["design_reference"] = "Designs/ClubHouse - Course 2 suburban public course"
    root["construction_era"] = "circa 2010"
    root["footprint_square_meters"] = round(BUILDING_W * BUILDING_D, 3)
    root["footprint_square_feet"] = round(BUILDING_W * BUILDING_D * M2_TO_FT2, 1)
    root["interior_furnished"] = False
    root["permanent_restroom_fitout"] = True
    root["expansion_ready"] = True

    architecture = group("ARCHITECTURE", root, modular=True, furnished=False)
    walls = group("MODULE_WallSystem", architecture, module_family="wall-system", reusable=True)
    windows = group("MODULE_WindowSystem", architecture, module_family="window-system", reusable=True)
    floors = group("MODULE_FloorAndCeiling", architecture, module_family="interior-shell", reusable=True, furnished=False)
    collisions = group("COLLISION_PROXIES", root, collision_authority="design-only")

    # Four 2.45 m storefronts across the arrival facade, with the exact legacy
    # double-door datum left unobstructed for the live interactive door asset.
    front_windows = (-6.80, -4.05, 2.45, 5.45)
    front_openings = [
        {"kind": "window", "center": x, "width": 2.45, "height": 2.25, "sill": 0.72}
        for x in front_windows
    ] + [{"kind": "main-door", "center": MAIN_DOOR_X, "width": 1.80, "height": 2.45, "sill": FLOOR_Z}]
    aperture_wall(walls, m, wall="front", openings=front_openings)
    for index, x in enumerate(front_windows):
        window_module(f"FrontStorefront_{index:02d}", windows, m, wall="front", center=x, width=2.45)
    door_frame("MainEntranceFrame", architecture, m, x=MAIN_DOOR_X, y=FRONT_Y - 0.02, width=1.80, height=2.45, wall="front")
    glazed_main_entrance(architecture, m)

    back_windows = (-6.45, -3.40, 0.10)
    back_openings = [{"kind": "window", "center": x, "width": 2.55, "height": 2.25, "sill": 0.72} for x in back_windows]
    aperture_wall(walls, m, wall="back", openings=back_openings)
    for index, x in enumerate(back_windows):
        window_module(f"RearPatioWindow_{index:02d}", windows, m, wall="back", center=x, width=2.55)

    west_windows = (-3.45, -0.35, 2.65)
    west_openings = [{"kind": "window", "center": y, "width": 2.35, "height": 2.10, "sill": 0.78} for y in west_windows]
    aperture_wall(walls, m, wall="west", openings=west_openings)
    for index, y in enumerate(west_windows):
        window_module(f"WestWindow_{index:02d}", windows, m, wall="west", center=y, width=2.35, sill=0.78, height=2.10)

    # East openings: one large loading door and one personnel door toward the rear.
    service_door_y = SERVICE_DOOR_Y
    service_door_width = SERVICE_DOOR_WIDTH
    # The rough arch is intentionally larger than the foreground finished
    # frame so its wall-depth reveal stays hidden from normal exterior angles.
    service_door_height = SERVICE_DOOR_RECT_HEIGHT
    east_openings = [
        {"kind": "loading-door", "center": 0.15, "width": 3.60, "height": 3.05, "sill": FLOOR_Z},
        {"kind": "arched-service-door", "center": service_door_y, "width": service_door_width, "height": service_door_height, "sill": FLOOR_Z},
    ]
    aperture_wall(walls, m, wall="east", openings=east_openings)
    east_arch_opening_shoulders(
        walls,
        m,
        center=service_door_y,
        rectangular_width=service_door_width,
        rectangular_height=service_door_height,
        clear_width=service_door_width,
        clear_height=SERVICE_DOOR_ARCH_CLEAR_HEIGHT,
    )
    loading_door(architecture, m)
    # Matches the established receiving-door datum: -3.6 game yards becomes
    # +3.29184 m in Blender because authored +Y exports to runtime -Z.
    service_frame = door_frame("RearServiceDoorFrame", architecture, m, x=BUILDING_W / 2.0 + 0.02, y=service_door_y, width=service_door_width, height=service_door_height, wall="east")
    hinged_door("RearServiceDoor", service_frame, m, x=BUILDING_W / 2.0 + 0.03, y=service_door_y, width=1.28, height=service_door_height - 0.06, rotation_z=math.pi / 2.0)

    stone_water_table(architecture, m)
    roof_system(architecture, m)
    porch_system(architecture, m)

    # Clean, neutral architectural surfaces plus the permanent restroom only:
    # no counter, shelving, lounge, office equipment, decor, or stock is baked.
    A.box("Interior_FloorSlab", (BUILDING_W - 2 * WALL_T, BUILDING_D - 2 * WALL_T, 0.16), (0, 0, FLOOR_Z - 0.08), m["interior_floor"], parent=floors, bevel=0.010, properties={"walkable": True, "furnished": False})
    A.box("Interior_Ceiling", (BUILDING_W - 2 * WALL_T, BUILDING_D - 2 * WALL_T, 0.10), (0, 0, 3.45), m["ceiling"], parent=floors, bevel=0.008, properties={"architectural_ceiling": True})
    for row, y in enumerate((-4.55, -1.50, 1.55, 4.60)):
        for column, x in enumerate((-7.45, -3.75, -0.05, 3.65, 7.35)):
            A.cylinder(f"CeilingLight_{row}_{column}", 0.145, 0.026, (x, y, 3.385), m["light"], parent=floors, vertices=24, bevel=0.008, properties={"light_socket": True})
    service_rooms(architecture, m)

    # Reusable expansion sockets live on every exterior face and at the service wing.
    for name, location, rotation in (
        ("MainEntrance", (MAIN_DOOR_X, FRONT_Y, FLOOR_Z), (0, 0, 0)),
        ("ExpansionWest", (-BUILDING_W / 2.0, 0, FLOOR_Z), (0, 0, math.pi / 2)),
        ("ExpansionEast", (BUILDING_W / 2.0, 3.8, FLOOR_Z), (0, 0, -math.pi / 2)),
        ("ExpansionRear", (0, BACK_Y, FLOOR_Z), (0, 0, math.pi)),
        ("Patio", (-3.6, BACK_Y, FLOOR_Z), (0, 0, math.pi)),
        ("CartBarn", (CART_BARN_X - 1.4, CART_BARN_Y, 0), (0, 0, 0)),
        ("SiteOrigin", (0, 0, 0), (0, 0, 0)),
    ):
        A.socket(name, parent=root, location=location, rotation=rotation, properties={"expansion_socket": "Expansion" in name or name in ("Patio", "CartBarn")})

    # Simplified collision design proxies. Runtime keeps the established analytic
    # layout authority, but these remain inspectable for future imported collision.
    A.collision_box("Floor", (BUILDING_W, BUILDING_D, FLOOR_Z), (0, 0, FLOOR_Z / 2.0), parent=collisions, purpose="walkable")
    A.collision_box("WallFrontWest", (8.0, WALL_T, 3.5), (-5.6, FRONT_Y, 1.75), parent=collisions)
    A.collision_box("WallFrontEast", (8.0, WALL_T, 3.5), (4.9, FRONT_Y, 1.75), parent=collisions)
    A.collision_box("WallBack", (BUILDING_W, WALL_T, 3.5), (0, BACK_Y, 1.75), parent=collisions)
    A.collision_box("WallWest", (WALL_T, BUILDING_D, 3.5), (-BUILDING_W / 2.0, 0, 1.75), parent=collisions)
    A.collision_box("WallEastFront", (WALL_T, 4.2, 3.5), (BUILDING_W / 2.0, -4.05, 1.75), parent=collisions)
    A.collision_box("WallEastRear", (WALL_T, 3.8, 3.5), (BUILDING_W / 2.0, 4.25, 1.75), parent=collisions)
    A.collision_box("PorchDeck", (7.6, 2.68, FLOOR_Z), (MAIN_DOOR_X, FRONT_Y - 1.34, FLOOR_Z / 2.0), parent=collisions, purpose="walkable")
    restroom_center_y = (RESTROOM_SOUTH_Y + RESTROOM_NORTH_Y) / 2.0
    restroom_depth = RESTROOM_NORTH_Y - RESTROOM_SOUTH_Y
    restroom_cross_start = 5.35 + WALL_T / 2.0
    restroom_cross_end = RESTROOM_EAST_X + WALL_T / 2.0
    restroom_cross_width = restroom_cross_end - restroom_cross_start
    restroom_cross_x = (restroom_cross_start + restroom_cross_end) / 2.0
    A.collision_box("RestroomEastWall", (WALL_T, restroom_depth, 3.16), (RESTROOM_EAST_X, restroom_center_y, FLOOR_Z + 1.58), parent=collisions)
    A.collision_box("RestroomSouthWall", (restroom_cross_width, WALL_T, 3.16), (restroom_cross_x, RESTROOM_SOUTH_Y, FLOOR_Z + 1.58), parent=collisions)
    A.collision_box("RestroomNorthWall", (restroom_cross_width, WALL_T, 3.16), (restroom_cross_x, RESTROOM_NORTH_Y, FLOOR_Z + 1.58), parent=collisions)
    A.collision_box("RestroomToilet", (0.72, 0.36, 1.06), (RESTROOM_TOILET_X, RESTROOM_TOILET_Y, FLOOR_Z + 0.53), parent=collisions)
    A.collision_box("RestroomSink", (0.52, 0.30, 0.82), (RESTROOM_SINK_X, RESTROOM_SINK_Y, FLOOR_Z + 0.41), parent=collisions)
    return root


def shrub(name: str, parent: bpy.types.Object, m: dict[str, bpy.types.Material], x: float, y: float, radius: float, sage: bool = False) -> bpy.types.Object:
    module = group(name, parent, module_family="landscape-shrub", reusable=True)
    leaf = m["leaf_sage"] if sage else m["leaf_dark"]
    A.cylinder(f"{name}_Trunk", radius * 0.12, radius * 0.85, (x, y, radius * 0.42), m["medium_walnut"], parent=module, vertices=12, bevel=0.008)
    for index, (ox, oy, scale) in enumerate(((-0.28, 0, 0.74), (0.22, -0.10, 0.82), (0.0, 0.20, 0.92))):
        A.sphere(f"{name}_Crown_{index}", radius * scale, (x + ox * radius, y + oy * radius, radius * (0.72 + index * 0.08)), leaf, parent=module, segments=16, rings=10, properties={"landscape_module": True})
    return module


def sidewalk_run(name: str, parent: bpy.types.Object, m: dict[str, bpy.types.Material], *, center: tuple[float, float], size: tuple[float, float], axis: str = "x") -> bpy.types.Object:
    module = group(name, parent, module_family="concrete-sidewalk", reusable=True, expansion_joint_spacing_m=1.5)
    w, d = size
    A.box(f"{name}_Slab", (w, d, 0.16), (center[0], center[1], 0.08), m["concrete"], parent=module, bevel=0.018, properties={"walkable": True})
    length = w if axis == "x" else d
    joints = max(1, int(length / 1.5))
    for index in range(1, joints):
        t = -length / 2.0 + index * length / joints
        dims = (0.025, d + 0.01, 0.012) if axis == "x" else (w + 0.01, 0.025, 0.012)
        loc = (center[0] + t, center[1], 0.166) if axis == "x" else (center[0], center[1] + t, 0.166)
        A.box(f"{name}_Joint_{index:02d}", dims, loc, m["concrete_dark"], parent=module, bevel=0.002, properties={"control_joint": True})
    module_socket_pair(module, length / 2.0, axis=axis)
    return module


def cart_barn(parent: bpy.types.Object, m: dict[str, bpy.types.Material]) -> bpy.types.Object:
    barn = group("MODULE_CartBarn", parent, module_family="cart-barn", reusable=True, width_m=12.0, depth_m=8.4, capacity_carts=16, furnished=False)
    cx, cy = CART_BARN_X, CART_BARN_Y
    width, depth, eave, peak = 12.0, 8.4, 3.35, 5.10
    A.box("CartBarn_Slab", (width, depth, 0.18), (cx, cy, 0.09), m["concrete_dark"], parent=barn, bevel=0.022, properties={"walkable": True})
    # Back/side wall modules and five open front bays; carts remain player-supplied.
    A.box("CartBarn_BackWall", (width, WALL_T, eave), (cx, cy + depth / 2.0 - WALL_T / 2.0, eave / 2.0), m["sage_siding"], parent=barn, bevel=0.010, properties={"wall_module": True})
    for side, x in (("W", cx - width / 2.0 + WALL_T / 2.0), ("E", cx + width / 2.0 - WALL_T / 2.0)):
        A.box(f"CartBarn_{side}_Wall", (WALL_T, depth, eave), (x, cy, eave / 2.0), m["sage_siding"], parent=barn, bevel=0.010, properties={"wall_module": True})
    for index in range(6):
        x = cx - width / 2.0 + index * (width / 5.0)
        A.box(f"CartBarn_FrontPost_{index}", (0.26, 0.30, eave), (x, cy - depth / 2.0 + 0.15, eave / 2.0), m["warm_cream"], parent=barn, bevel=0.022, properties={"column_module": True})
    run = depth / 2.0 + 0.35
    rise = peak - eave
    angle = math.atan2(rise, run)
    length = math.hypot(run, rise)
    cz = (eave + peak) / 2.0
    A.box("CartBarn_RoofFront", (width + 0.70, length, 0.14), (cx, cy - run / 2.0, cz), m["charcoal_roof"], parent=barn, rotation=(angle, 0, 0), bevel=0.016, properties={"roof_module": True})
    A.box("CartBarn_RoofBack", (width + 0.70, length, 0.14), (cx, cy + run / 2.0, cz), m["charcoal_roof"], parent=barn, rotation=(-angle, 0, 0), bevel=0.016, properties={"roof_module": True})
    A.box("CartBarn_Ridge", (width + 0.76, 0.18, 0.16), (cx, cy, peak - 0.02), m["warm_charcoal"], parent=barn, bevel=0.045)
    A.text_mesh("CartBarn_Sign", "CART BARN", (cx, cy - depth / 2.0 - 0.17, eave - 0.38), m["sign_cream"], size=0.30, depth=0.014, bevel=0.003, parent=barn)
    A.socket("CartBay0", parent=barn, location=(cx - 4.8, cy - depth / 2.0, 0))
    A.socket("CartBay4", parent=barn, location=(cx + 4.8, cy - depth / 2.0, 0))
    A.socket("CartBarnExpansion", parent=barn, location=(cx + width / 2.0, cy, 0), rotation=(0, 0, -math.pi / 2), properties={"expansion_socket": True})
    return barn


def site_asset() -> bpy.types.Object:
    m = materials()
    root = A.asset_root(
        A.AssetIdentity(51, "modern_public_clubhouse_site_v1"),
        (62.0, 62.0, 5.1),
        source_note="Original modular Course-2 clubhouse site authored in-repository from Designs/ClubHouse references",
        license_note="Project-owned original; no external assets",
    )
    root["parking_space_count"] = 52
    root["parking_capacity_class"] = "medium"
    root["site_furnished"] = False
    root["expansion_ready"] = True
    hardscape = group("SITE_Hardscape", root, modular=True)
    parking = group("MODULE_ParkingLot_52Space", hardscape, module_family="parking-lot", reusable=True, parking_spaces=52)
    landscape = group("SITE_Landscape", root, modular=True)
    collisions = group("COLLISION_PROXIES", root, collision_authority="design-only")

    # Four rows of thirteen standard spaces = exactly 52 marked spaces.
    lot_w, lot_d = 41.4, 38.4
    lot_cy = -30.1
    A.box("Parking_Asphalt", (lot_w, lot_d, 0.14), (0, lot_cy, 0.07), m["asphalt"], parent=parking, bevel=0.035, properties={"parking_spaces": 52})
    stall_w, stall_d = 2.65, 5.20
    row_centers = (-14.50, -25.55, -34.65, -45.70)
    start_x = -stall_w * 6.0
    for row, y in enumerate(row_centers):
        for col in range(13):
            x = start_x + col * stall_w
            space = group(f"MODULE_ParkingSpace_R{row:02d}_C{col:02d}", parking, module_family="parking-space", reusable=True, width_m=stall_w, depth_m=stall_d, parking_index=row * 13 + col)
            stripe_mat = m["accessible"] if row == 0 and col in (6, 7) else m["stripe"]
            for side, sx in (("L", x - stall_w / 2.0), ("R", x + stall_w / 2.0)):
                A.box(f"ParkingStripe_R{row:02d}_C{col:02d}_{side}", (0.085, stall_d, 0.018), (sx, y, 0.159), stripe_mat, parent=space, bevel=0.008, properties={"parking_stripe": True})
            if row == 0 and col in (6, 7):
                A.box(f"AccessibleField_{col}", (stall_w - 0.20, 1.00, 0.012), (x, y, 0.158), m["accessible"], parent=space, bevel=0.018, properties={"accessible_space": True})
            A.socket("VehicleCenter", parent=space, location=(x, y, 0.16), properties={"parking_index": row * 13 + col})

    # Curbs frame the lot but leave a 7 m drive opening at the south-east corner.
    for name, dims, loc in (
        ("Parking_CurbNorth", (lot_w, 0.24, 0.22), (0, lot_cy + lot_d / 2.0, 0.18)),
        ("Parking_CurbWest", (0.24, lot_d, 0.22), (-lot_w / 2.0, lot_cy, 0.18)),
        ("Parking_CurbEastNorth", (0.24, 25.0, 0.22), (lot_w / 2.0, -23.3, 0.18)),
        ("Parking_CurbSouthWest", (27.0, 0.24, 0.22), (-7.2, lot_cy - lot_d / 2.0, 0.18)),
    ):
        A.box(name, dims, loc, m["concrete"], parent=parking, bevel=0.025, properties={"curb_module": True})

    # Reusable two-lane entrance throat. The original parking rectangle ended
    # directly in rough terrain, leaving no believable vehicular connection.
    entrance_drive = group("MODULE_ParkingEntranceDrive", hardscape, module_family="parking-entrance-drive", reusable=True, width_m=14.0, depth_m=11.6)
    drive_cx, drive_cy = 27.70, -43.20
    A.box("Parking_EntranceDrive_Asphalt", (14.0, 11.6, 0.16), (drive_cx, drive_cy, 0.08), m["asphalt"], parent=entrance_drive, bevel=0.035, properties={"walkable": True, "vehicle_route": True})
    for edge, y in (("North", drive_cy + 5.80), ("South", drive_cy - 5.80)):
        A.box(f"Parking_EntranceDrive_Curb{edge}", (14.0, 0.24, 0.22), (drive_cx, y, 0.18), m["concrete"], parent=entrance_drive, bevel=0.025, properties={"curb_module": True})
    A.socket("ParkingEntranceRoad", parent=entrance_drive, location=(drive_cx + 7.0, drive_cy, 0.16), rotation=(0, 0, -math.pi / 2), properties={"expansion_socket": True})

    sidewalk_run("Sidewalk_Frontage", hardscape, m, center=(0, -8.10), size=(BUILDING_W + 2.4, 2.10), axis="x")
    sidewalk_run("Sidewalk_ParkingConnector", hardscape, m, center=(MAIN_DOOR_X, -11.20), size=(2.40, 4.10), axis="y")
    sidewalk_run("Sidewalk_Loading", hardscape, m, center=(11.0, 0.15), size=(3.0, 5.4), axis="y")

    # Loading apron aligns to the building's reusable loading-door socket.
    A.box("Loading_Apron", (8.8, 8.0, 0.20), (13.5, 0.15, 0.10), m["concrete_dark"], parent=hardscape, bevel=0.025, properties={"loading_apron": True})
    for index, y in enumerate((-2.25, 2.55)):
        A.cylinder(f"Loading_Bollard_{index}", 0.11, 1.08, (10.05, y, 0.54), m["safety_yellow"], parent=hardscape, vertices=20, bevel=0.018, properties={"bollard_module": True})

    cart_apron = group("MODULE_CartBarnApproach", hardscape, module_family="cart-barn-approach", reusable=True, width_m=12.6, depth_m=8.0)
    A.box("CartBarn_ApproachConcrete", (12.6, 8.0, 0.18), (24.20, -3.70, 0.09), m["concrete_dark"], parent=cart_apron, bevel=0.025, properties={"walkable": True, "cart_route": True})
    A.socket("CartRouteConnection", parent=cart_apron, location=(30.50, -3.70, 0.18), rotation=(0, 0, -math.pi / 2), properties={"expansion_socket": True})

    # Empty medium rear patio: modular pavers, planting edge, and expansion socket.
    patio = group("MODULE_OutdoorPatio", hardscape, module_family="outdoor-patio", reusable=True, furnished=False, width_m=10.8, depth_m=6.2)
    patio_cx, patio_cy = -3.85, 9.55
    for row in range(4):
        for col in range(7):
            pw, pd = 1.48, 1.46
            x = patio_cx - 4.44 + col * 1.48
            y = patio_cy - 2.19 + row * 1.46
            A.box(f"Patio_Paver_{row}_{col}", (pw - 0.025, pd - 0.025, 0.14), (x, y, 0.07), m["concrete"], parent=patio, bevel=0.018, properties={"patio_paver": True})
    A.socket("PatioFurnitureOrigin", parent=patio, location=(patio_cx, patio_cy, 0.15), properties={"player_customization_socket": True})
    A.socket("PatioExpansion", parent=patio, location=(patio_cx - 5.40, patio_cy, 0), rotation=(0, 0, math.pi / 2), properties={"expansion_socket": True})

    cart_barn(root, m)

    # Clean modern planting beds around the arrival and patio; all foliage is
    # project-authored stylized geometry and no external botanical asset is used.
    for name, dims, loc in (
        ("Bed_FrontWest", (7.2, 1.25, 0.12), (-5.7, -7.20, 0.06)),
        ("Bed_FrontEast", (5.8, 1.25, 0.12), (5.5, -7.20, 0.06)),
        ("Bed_PatioWest", (1.25, 6.4, 0.12), (-9.75, patio_cy, 0.06)),
        ("Bed_PatioNorth", (10.8, 1.20, 0.12), (patio_cx, 13.25, 0.06)),
    ):
        A.box(name, dims, loc, m["mulch"], parent=landscape, bevel=0.035, properties={"landscape_bed_module": True})
    for index, (x, y, r, sage) in enumerate((
        (-8.0, -7.25, 0.54, False), (-6.3, -7.25, 0.46, True), (-4.6, -7.25, 0.56, False),
        (3.6, -7.25, 0.48, True), (5.2, -7.25, 0.58, False), (7.0, -7.25, 0.46, True),
        (-9.75, 7.2, 0.52, False), (-9.75, 9.5, 0.46, True), (-9.75, 11.8, 0.56, False),
        (-7.4, 13.25, 0.48, True), (-4.5, 13.25, 0.56, False), (-1.4, 13.25, 0.48, True),
    )):
        shrub(f"LandscapeShrub_{index:02d}", landscape, m, x, y, r, sage)

    A.socket("BuildingOrigin", parent=root, location=(0, 0, 0))
    A.socket("ParkingExpansionSouth", parent=root, location=(0, lot_cy - lot_d / 2.0, 0), rotation=(0, 0, math.pi), properties={"expansion_socket": True})
    A.socket("DriveConnection", parent=root, location=(34.70, -43.20, 0), rotation=(0, 0, -math.pi / 2), properties={"expansion_socket": True})
    A.socket("IrrigationUtility", parent=root, location=(BUILDING_W / 2.0 + 1.5, 4.18, 0), properties={"utility_socket": True})

    A.collision_box("ParkingLot", (lot_w, lot_d, 0.14), (0, lot_cy, 0.07), parent=collisions, purpose="walkable")
    A.collision_box("ParkingEntranceDrive", (14.0, 11.6, 0.16), (drive_cx, drive_cy, 0.08), parent=collisions, purpose="walkable")
    A.collision_box("FrontSidewalk", (BUILDING_W + 2.4, 2.10, 0.16), (0, -8.10, 0.08), parent=collisions, purpose="walkable")
    A.collision_box("LoadingApron", (8.8, 8.0, 0.20), (13.5, 0.15, 0.10), parent=collisions, purpose="walkable")
    A.collision_box("CartBarnApproach", (12.6, 8.0, 0.18), (24.20, -3.70, 0.09), parent=collisions, purpose="walkable")
    A.collision_box("Patio", (10.8, 6.2, 0.14), (patio_cx, patio_cy, 0.07), parent=collisions, purpose="walkable")
    A.collision_box("CartBarnWest", (WALL_T, 8.4, 3.35), (CART_BARN_X - 6.0, CART_BARN_Y, 1.675), parent=collisions)
    A.collision_box("CartBarnEast", (WALL_T, 8.4, 3.35), (CART_BARN_X + 6.0, CART_BARN_Y, 1.675), parent=collisions)
    A.collision_box("CartBarnBack", (12.0, WALL_T, 3.35), (CART_BARN_X, CART_BARN_Y + 4.2, 1.675), parent=collisions)
    return root


def verify(root: bpy.types.Object, *, expected_parking: int | None = None) -> dict[str, object]:
    meshes = [obj for obj in A.descendants(root) if obj.type == "MESH" and not obj.get("collision_proxy")]
    collision = [obj for obj in A.descendants(root) if obj.get("collision_proxy")]
    sockets = [obj for obj in A.descendants(root) if obj.name.startswith("SOCKET_")]
    pivots = [obj for obj in A.descendants(root) if obj.name.startswith("PIVOT_")]
    untransformed = [obj.name for obj in meshes if any(abs(value - 1.0) > 1e-5 for value in obj.scale) or any(abs(value) > 1e-5 for value in obj.rotation_euler)]
    missing_uv = [obj.name for obj in meshes if not obj.data.uv_layers]
    generic = [obj.name for obj in A.descendants(root) if obj.name.split(".")[0] in {"Cube", "Cylinder", "Sphere", "Text", "Empty"}]
    reserved_pivot_extras = [obj.name for obj in A.descendants(root) if "pivot" in obj]
    parking_spaces = sum(1 for obj in A.descendants(root) if obj.get("module_family") == "parking-space")
    if untransformed:
        raise RuntimeError(f"Unapplied mesh rotation/scale: {untransformed[:8]}")
    if missing_uv:
        raise RuntimeError(f"Missing UVs: {missing_uv[:8]}")
    if generic:
        raise RuntimeError(f"Generic object names: {generic[:8]}")
    if reserved_pivot_extras:
        raise RuntimeError(f"Reserved glTF pivot extra used: {reserved_pivot_extras[:8]}")
    if expected_parking is not None and parking_spaces != expected_parking:
        raise RuntimeError(f"Expected {expected_parking} parking sockets, found {parking_spaces}")
    triangles = 0
    for obj in meshes:
        triangles += sum(len(poly.vertices) - 2 for poly in obj.data.polygons)
    result = {
        "root": root.name,
        "visibleMeshes": len(meshes),
        "collisionProxies": len(collision),
        "sockets": len(sockets),
        "pivots": len(pivots),
        "materials": len({mat.name for obj in meshes for mat in obj.data.materials if mat}),
        "triangles": triangles,
        "parkingSpaces": parking_spaces,
        "boundsMeters": A.world_bounds(root).__dict__,
    }
    print("MODERN_CLUBHOUSE_VERIFY|" + json.dumps(result, sort_keys=True))
    return result


def publish(kind: str, preview: bool, save: bool, export: bool) -> dict[str, object]:
    A.reset_scene(seed=240028 + (0 if kind == "building" else 1))
    root = building_asset() if kind == "building" else site_asset()
    report = verify(root, expected_parking=52 if kind == "site" else None)
    source = BUILDING_SOURCE if kind == "building" else SITE_SOURCE
    glb = BUILDING_GLB if kind == "building" else SITE_GLB
    image = BUILDING_PREVIEW if kind == "building" else SITE_PREVIEW
    manifest = BUILDING_MANIFEST if kind == "building" else SITE_MANIFEST
    if save:
        A.save_blend(source)
    if export:
        A.export_glb(glb, root)
    if preview:
        A.render_studio_preview(
            root,
            image,
            width=1600,
            height=1000,
            azimuth_degrees=38 if kind == "building" else 34,
            elevation_degrees=22 if kind == "building" else 47,
        )
    result = {
        "kind": kind,
        "ownership": "Project-owned original; no external assets",
        "source": source.relative_to(REPO_ROOT).as_posix(),
        "runtimeGlb": glb.relative_to(REPO_ROOT).as_posix(),
        "preview": image.relative_to(REPO_ROOT).as_posix() if preview else None,
        "dimensionsMeters": {
            "conditionedWidth": BUILDING_W,
            "conditionedDepth": BUILDING_D,
            "conditionedAreaSquareMeters": round(BUILDING_W * BUILDING_D, 3),
            "conditionedAreaSquareFeet": round(BUILDING_W * BUILDING_D * M2_TO_FT2, 1),
        },
        "interior": {
            "intentionallyEmpty": False if kind == "building" else True,
            "permanentFurniture": ["restroom-toilet", "restroom-hand-basin", "restroom-mirror"] if kind == "building" else [],
            "serviceRooms": ["employee", "storage", "restroom"] if kind == "building" else [],
        },
        "site": {
            "parkingSpaces": 52 if kind == "site" else None,
            "cartBarnMeters": [12.0, 8.4] if kind == "site" else None,
            "patioMeters": [10.8, 6.2] if kind == "site" else None,
            "loadingApronMeters": [8.8, 8.0] if kind == "site" else None,
        },
        "verification": report,
    }
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    result["manifest"] = manifest.relative_to(REPO_ROOT).as_posix()
    return result


def main() -> int:
    args = cli()
    kinds = ("building", "site") if args.asset == "all" else (args.asset,)
    results = [publish(kind, args.preview, not args.no_save, not args.no_export) for kind in kinds]
    print("MODERN_CLUBHOUSE_BUILD|" + json.dumps(results, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
