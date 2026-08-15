"""Build Sheet 07 production assets (61-70) for Pinehollow Golf Flipper.

Run from Blender, for example::

    blender --background --factory-startup --python tools/blender/build_assets_61_70.py -- --asset 61
    blender --background --factory-startup --python tools/blender/build_assets_61_70.py -- --asset 70 --preview
    blender --background --factory-startup --python tools/blender/build_assets_61_70.py -- --asset 65 --untextured

All geometry is original, deterministic, authored in metres, +Z up, with the
player/customer-facing side on -Y.  Existing checkout and clubhouse candidates
are scale/context references only; this builder never loads, edits, or overwrites
those sources.  The shared Assets 51-100 library owns source and GLB destinations.
"""

from __future__ import annotations

import json
import math
import sys
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path

import bpy

# Blender does not consistently add the executed script's directory to sys.path.
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import assets_51_100_lib as A


IDENTITIES = {
    61: A.AssetIdentity(61, "front_desk_counter_shell"),
    62: A.AssetIdentity(62, "back_counter_storage_cabinets"),
    63: A.AssetIdentity(63, "pro_shop_fitting_room"),
    64: A.AssetIdentity(64, "stockroom_shelving_system"),
    65: A.AssetIdentity(65, "stockroom_worktable"),
    66: A.AssetIdentity(66, "office_laptop_desk"),
    67: A.AssetIdentity(67, "clubhouse_lounge_sofa"),
    68: A.AssetIdentity(68, "lounge_armchair_sheet07"),
    69: A.AssetIdentity(69, "lounge_coffee_table_sheet07"),
    70: A.AssetIdentity(70, "trophy_display_cabinet"),
}

# Width (X), depth (Y), height (Z), in metres.
DIMENSIONS = {
    61: (2.93, 0.91, 0.965),
    62: (3.20, 0.62, 2.15),
    63: (1.55, 1.55, 2.45),
    64: (1.83, 0.61, 2.13),
    65: (1.80, 0.75, 0.92),
    66: (1.60, 0.80, 0.76),
    67: (2.15, 0.95, 0.90),
    68: (0.85, 0.90, 0.90),
    69: (1.10, 0.65, 0.45),
    70: (1.50, 0.45, 2.10),
}

BUDGETS = {
    61: (28, 28000), 62: (28, 28000), 63: (28, 28000), 64: (28, 28000),
    65: (28, 28000), 66: (28, 28000), 67: (20, 22000), 68: (20, 22000),
    69: (20, 22000), 70: (28, 28000),
}

REQUIRED_MARKERS = {
    61: ("SOCKET_POS", "SOCKET_CashDrawer", "SOCKET_CardTerminal", "SOCKET_ReceiptPrinter",
         "SOCKET_Scanner", "SOCKET_ProductStage", "SOCKET_Bagging", "SOCKET_PLACEMENT"),
    62: ("SOCKET_CabinetNext", "SOCKET_CounterProp_01", "SOCKET_CounterProp_02",
         "SOCKET_InternalShelf", "SOCKET_PLACEMENT"),
    63: ("PIVOT_Curtain", "SOCKET_Bench", "SOCKET_Hook_01", "SOCKET_Hook_02",
         "SOCKET_Mirror", "SOCKET_InteriorLight", "SOCKET_PLACEMENT"),
    64: ("SOCKET_ShelfLevel_01", "SOCKET_ShelfLevel_02", "SOCKET_ShelfLevel_03",
         "SOCKET_ShelfLevel_04", "SOCKET_ShelfNext", "SOCKET_PLACEMENT"),
    65: ("SOCKET_BoxOpening", "SOCKET_PackageStage", "SOCKET_Tool_01", "SOCKET_Tool_02",
         "SOCKET_LowerShelf", "SOCKET_PLACEMENT"),
    66: ("SOCKET_Laptop", "SOCKET_Lamp", "SOCKET_ChairPlacement", "SOCKET_OfficeProp_01",
         "SOCKET_CableGrommet", "SOCKET_PLACEMENT"),
    67: ("SOCKET_Seat_01", "SOCKET_Seat_02", "SOCKET_Seat_03", "SOCKET_LoungeTable",
         "SOCKET_PLACEMENT"),
    68: ("SOCKET_Seat", "SOCKET_SideTable", "SOCKET_PLACEMENT"),
    69: ("SOCKET_Magazine_01", "SOCKET_Magazine_02", "SOCKET_Cup", "SOCKET_Decor",
         "SOCKET_LowerShelf", "SOCKET_PLACEMENT"),
    70: ("PIVOT_DoorLeft", "PIVOT_DoorRight", "SOCKET_Trophy_01", "SOCKET_Trophy_02",
         "SOCKET_Plaque_01", "SOCKET_Collectible_01", "SOCKET_InteriorLight",
         "SOCKET_PLACEMENT"),
}

REQUIRED_ANIMATIONS = {
    61: (),
    62: ("CabinetDoor_Open", "CabinetDoor_Close", "CabinetDrawer_Open", "CabinetDrawer_Close"),
    63: ("FittingCurtain_Open", "FittingCurtain_Close"),
    64: (), 65: (), 66: (), 67: (), 68: (), 69: (),
    70: ("DisplayDoorLeft_Open", "DisplayDoorLeft_Close", "DisplayDoorRight_Open", "DisplayDoorRight_Close"),
}


def _group(name: str, parent: bpy.types.Object, **properties: object) -> bpy.types.Object:
    clean = name if name.startswith("LOD") else "LOD0_" + name
    obj = bpy.data.objects.new(clean, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.08
    obj["lod_level"] = 0
    for key, value in properties.items():
        obj[key] = value
    A.parent_keep_world(obj, parent)
    return obj


def _root(number: int, **properties: object) -> tuple[bpy.types.Object, dict[str, bpy.types.Material]]:
    identity = IDENTITIES[number]
    root = A.asset_root(identity, DIMENSIONS[number])
    mesh_budget, triangle_budget = BUDGETS[number]
    root["production_sheet"] = "07"
    root["authored_units"] = "meters"
    root["runtime_unit_conversion"] = "meters_to_yards_once:1.0936133"
    root["front_side"] = "customer/player side is -Y"
    root["source_lineage"] = "original deterministic Blender Python; no candidate geometry imported"
    root["license"] = "Project-owned"
    root["visual_style"] = "Pinehollow traditional clubhouse; stylized PBR walnut, oak, green, charcoal, brass"
    root["mesh_budget"] = mesh_budget
    root["triangle_budget"] = triangle_budget
    root["lod_policy"] = "authored LOD0 with runtime room/distance gating"
    for key, value in properties.items():
        root[key] = value
    return root, A.palette_materials(textured=True)


def _materials() -> dict[str, bpy.types.Material]:
    return {
        # CC0 families per slot. Colours are unchanged - the tint that multiplies each
        # map is solved from the value already written here (assets_51_100_lib CC0 block).
        # The mirror and the cabinet light take none: a normal map on a specular pane or
        # an emissive lens is a defect rather than a detail.
        "dark_walnut": A.material("S07_DarkWalnut", (0.105, 0.050, 0.026, 1.0), roughness=0.52,
                                  texture="Wood062", uv_scale=2.4),
        "walnut_inset": A.material("S07_WalnutInset", (0.19, 0.090, 0.045, 1.0), roughness=0.58,
                                   texture="Wood062", uv_scale=2.8),
        "leather": A.material("S07_ChestnutLeather", (0.19, 0.075, 0.035, 1.0), roughness=0.42, coat=0.13,
                              texture="Leather011", uv_scale=9.0),
        "leather_shadow": A.material("S07_LeatherShadow", (0.075, 0.025, 0.012, 1.0), roughness=0.50,
                                     texture="Leather011", uv_scale=9.0),
        "curtain": A.material("S07_GreenCurtain", (0.045, 0.14, 0.095, 1.0), roughness=0.82, double_sided=True,
                              texture="Fabric030", uv_scale=3.5),
        "mirror": A.material("S07_Mirror", (0.42, 0.52, 0.51, 1.0), roughness=0.08, metallic=0.72),
        "warm_light": A.material("S07_WarmCabinetLight", (0.72, 0.49, 0.19, 1.0), roughness=0.28,
                                  emission_color=(1.0, 0.56, 0.22), emission_strength=1.6),
    }


def _box(name, dims, loc, mat, parent, **kwargs):
    return A.box(name, dims, loc, mat, parent=parent, **kwargs)


def _marker(name: str, root: bpy.types.Object, location=(0.0, 0.0, 0.0),
            rotation=(0.0, 0.0, 0.0), **properties: object) -> bpy.types.Object:
    return A.socket(name, location=location, rotation=rotation, parent=root, properties=properties)


def _placement(root: bpy.types.Object) -> None:
    _marker("PLACEMENT", root, placement_contract="origin centered on finished floor; front is -Y")


def _join_meshes(objects: Iterable[bpy.types.Object], name: str,
                 parent: bpy.types.Object | None = None) -> bpy.types.Object:
    """Join already-finished detail meshes without discarding UVs/material slots."""

    meshes = [obj for obj in objects if obj is not None and obj.type == "MESH"]
    if not meshes:
        raise ValueError(f"cannot join empty mesh collection for {name}")
    if len(meshes) == 1:
        joined = meshes[0]
        joined.name = name if name.startswith("MESH_") else "MESH_" + name
        if parent is not None:
            A.parent_keep_world(joined, parent)
        return joined
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name if name.startswith("MESH_") else "MESH_" + name
    if parent is not None:
        A.parent_keep_world(joined, parent)
    return joined


def _raised_panel(name: str, center: tuple[float, float, float], size: tuple[float, float, float],
                  frame_mat: bpy.types.Material, inset_mat: bpy.types.Material,
                  parent: bpy.types.Object, front_y: bool = True) -> list[bpy.types.Object]:
    """Create a traditional five-piece frame and recessed center panel."""

    width, depth, height = size
    x, y, z = center
    rail = min(0.075, width * 0.16, height * 0.16)
    proud = depth
    pieces = [
        _box(f"{name}_Inset", (width - rail * 1.55, depth * 0.62, height - rail * 1.55),
             (x, y + (depth * 0.18 if front_y else -depth * 0.18), z), inset_mat, parent,
             bevel=min(0.018, rail * 0.25)),
        _box(f"{name}_StileL", (rail, proud, height), (x - width / 2 + rail / 2, y, z),
             frame_mat, parent, bevel=0.010),
        _box(f"{name}_StileR", (rail, proud, height), (x + width / 2 - rail / 2, y, z),
             frame_mat, parent, bevel=0.010),
        _box(f"{name}_RailTop", (width - 2 * rail, proud, rail), (x, y, z + height / 2 - rail / 2),
             frame_mat, parent, bevel=0.010),
        _box(f"{name}_RailBottom", (width - 2 * rail, proud, rail), (x, y, z - height / 2 + rail / 2),
             frame_mat, parent, bevel=0.010),
    ]
    return pieces


def _brass_pull(name: str, location: tuple[float, float, float], length: float,
                parent: bpy.types.Object, brass: bpy.types.Material) -> list[bpy.types.Object]:
    x, y, z = location
    return [
        A.cylinder(f"{name}_Bar", 0.009, length, (x, y, z), brass,
                   rotation=(0.0, math.pi / 2.0, 0.0), vertices=12, parent=parent, bevel=0.002),
        A.cylinder(f"{name}_MountL", 0.014, 0.024, (x - length * 0.38, y + 0.006, z), brass,
                   rotation=(math.pi / 2.0, 0.0, 0.0), vertices=12, parent=parent, bevel=0.002),
        A.cylinder(f"{name}_MountR", 0.014, 0.024, (x + length * 0.38, y + 0.006, z), brass,
                   rotation=(math.pi / 2.0, 0.0, 0.0), vertices=12, parent=parent, bevel=0.002),
    ]


def _cushion(name: str, dims: tuple[float, float, float], loc: tuple[float, float, float],
             mat: bpy.types.Material, parent: bpy.types.Object, bevel=0.045) -> bpy.types.Object:
    return _box(name, dims, loc, mat, parent, bevel=bevel, bevel_segments=3,
                properties={"upholstery_part": True, "stylized_soft_form": True})


def build_61() -> bpy.types.Object:
    root, p = _root(61, fixture_role="checkout_shell", checkout_hardware_owned_elsewhere=True,
                    customer_side="-Y", staff_side="+Y", staff_corridor_clear=True)
    m = _materials()
    body = _group("CounterBody", root)
    details = _group("CounterJoinery", root)
    _placement(root)

    # Layered plinth, recessed body, and deep molded top match the traditional reference silhouette.
    _box("CounterPlinth", (2.84, 0.82, 0.075), (0.0, 0.015, 0.0375), m["dark_walnut"], body, bevel=0.018)
    # THE STAFF BAY IS OPEN (B7, 2026-08-03).
    #
    # This was one solid 2.72 x 0.76 x 0.76 slab filling the whole carcass
    # volume, so everything the staff face is supposed to contain — the divider,
    # the lower shelf — was sealed inside it. The part-visibility sweep reported
    # StaffDivider at zero pixels from all directions, and the note said proud
    # placement would breach the asset's own staff_corridor_clear contract, so
    # the bay needed carving open. That is what this is: the carcass is now the
    # panels AROUND a recess rather than the block that filled it.
    #
    # Deliberately assembled from panels rather than bored with a boolean. The
    # cut is rectilinear and axis-aligned, so the panels ARE the result a
    # boolean would produce, with none of its material re-indexing or n-gon
    # surprises, and every piece stays inside the old slab's own footprint —
    # nothing gains a millimetre toward the +Y aisle, so staff_corridor_clear
    # holds by construction.
    #
    #   x -1.36 .. -0.55   drawer bank, still solid: it carries the three
    #                      drawer faces at x -0.87
    #   x -0.55 .. +1.30   the open bay, customer-side wall only
    #   x +1.30 .. +1.36   the right end panel that closes it
    #   z 0.065 .. 0.115   the bay deck the shelf and divider stand on
    _box("CounterCarcassDrawerBank", (0.81, 0.76, 0.76), (-0.955, 0.035, 0.445),
         m["dark_walnut"], body, bevel=0.026)
    _box("CounterCarcassFrontWall", (1.85, 0.27, 0.76), (0.375, -0.210, 0.445),
         m["dark_walnut"], body, bevel=0.026)
    _box("CounterCarcassEndPanel", (0.06, 0.76, 0.76), (1.330, 0.035, 0.445),
         m["dark_walnut"], body, bevel=0.020)
    _box("CounterCarcassBayDeck", (1.85, 0.49, 0.05), (0.375, 0.170, 0.090),
         p["natural_oak"], body, bevel=0.010,
         properties={"staff_storage": True})
    _box("CounterTop", (2.93, 0.91, 0.095), (0.0, 0.0, 0.9175), p["medium_walnut"], body,
         bevel=0.026, bevel_segments=3, properties={"placement_surface": True})
    # Keep the oak field visibly proud of the 0.965 m walnut surface.  The old
    # 0.956 m centre put both top faces on the exact same plane, producing a
    # camera-dependent zebra shimmer across the player's checkout workspace.
    _box("CounterTopInlay", (2.70, 0.70, 0.018), (0.0, -0.025, 0.958), p["natural_oak"], details,
         bevel=0.008, properties={"decorative_inlay": True, "relief_m": 0.002})

    # Customer face: three joined raised panels and readable pilasters.
    front_pieces: list[bpy.types.Object] = []
    for index, x in enumerate((-0.91, 0.0, 0.91), 1):
        front_pieces.extend(_raised_panel(f"CustomerPanel{index}", (x, -0.375, 0.48),
                                         (0.77, 0.055, 0.58), m["dark_walnut"],
                                         m["walnut_inset"], details))
    _join_meshes(front_pieces, "CustomerRaisedPanelSet", details)
    pilasters = [
        _box(f"CustomerPilaster{i}", (0.085, 0.075, 0.76), (x, -0.397, 0.445),
             p["medium_walnut"], details, bevel=0.014)
        for i, x in enumerate((-1.34, -0.455, 0.455, 1.34), 1)
    ]
    _join_meshes(pilasters, "CustomerPilasterSet", details)

    # Staff face stays within the shell footprint and leaves the +Y aisle entirely clear.
    _box("StaffLowerShelf", (1.18, 0.30, 0.055), (0.42, 0.265, 0.31), p["natural_oak"], body,
         bevel=0.012, properties={"staff_storage": True})
    _box("StaffDivider", (0.055, 0.31, 0.65), (-0.18, 0.255, 0.43), m["dark_walnut"], body,
         bevel=0.010)
    drawer_faces = [
        _box(f"StaffDrawer{i}", (0.54, 0.045, 0.17), (-0.87, 0.395, z),
             m["walnut_inset"], details, bevel=0.018)
        for i, z in enumerate((0.27, 0.48, 0.69), 1)
    ]
    _join_meshes(drawer_faces, "StaffDrawerFrontSet", details)
    pulls: list[bpy.types.Object] = []
    for i, z in enumerate((0.27, 0.48, 0.69), 1):
        pulls.extend(_brass_pull(f"StaffPull{i}", (-0.87, 0.426, z), 0.16, details,
                                  p["restrained_brass"]))
    _join_meshes(pulls, "StaffBrassPullSet", details)

    # Hardware datums share the physical top plane; no register component is duplicated here.
    top_z = 0.965
    sockets = {
        "POS": (-0.78, -0.10, top_z),
        "CashDrawer": (-0.78, 0.12, 0.78),
        "CardTerminal": (0.58, -0.27, top_z),
        "ReceiptPrinter": (-0.23, -0.10, top_z),
        "Scanner": (0.18, -0.25, top_z),
        "ProductStage": (0.78, -0.06, top_z),
        "Bagging": (1.16, 0.13, top_z),
    }
    for name, loc in sockets.items():
        _marker(name, root, loc, socket_role="checkout_mount", mount_plane_z_m=top_z)

    collision = _group("CounterCollision", root, runtime_navigation="blocking")
    A.collision_box("CounterMainHull", (2.72, 0.76, 0.76), (0.0, 0.035, 0.445), parent=collision)
    A.collision_box("CounterTop", (2.93, 0.91, 0.095), (0.0, 0.0, 0.9175), parent=collision,
                    purpose="blocking-placement")
    A.collision_box("CounterStaffPedestal", (0.62, 0.36, 0.70), (-0.87, 0.25, 0.42), parent=collision)
    return root


def build_62() -> bpy.types.Object:
    root, p = _root(62, fixture_role="modular_back_counter", separate_moving_components=True)
    m = _materials()
    carcass = _group("CabinetCarcass", root)
    fronts = _group("CabinetFronts", root)
    _placement(root)

    _box("BaseToeKick", (3.12, 0.54, 0.10), (0.0, 0.02, 0.05), m["dark_walnut"], carcass, bevel=0.014)
    _box("BaseCarcass", (3.08, 0.57, 0.76), (0.0, 0.015, 0.46), m["dark_walnut"], carcass, bevel=0.022)
    _box("Countertop", (3.20, 0.62, 0.075), (0.0, 0.0, 0.8775), p["natural_oak"], carcass,
         bevel=0.020, properties={"placement_surface": True})
    # The Pine Hills tee sheet and club mark share this back-counter bay.  Keep
    # the tall storage silhouette as an open hutch frame instead of an opaque
    # wall cabinet that masks both operational boards from the player camera.
    hutch_frame = [
        _box("HutchUprightWest", (0.10, 0.30, 1.18), (-1.54, 0.14, 1.515),
             m["dark_walnut"], carcass, bevel=0.018),
        _box("HutchUprightEast", (0.10, 0.30, 1.18), (1.54, 0.14, 1.515),
             m["dark_walnut"], carcass, bevel=0.018),
    ]
    _join_meshes(hutch_frame, "OpenHutchUprightSet", carcass)
    _box("WallCrown", (3.20, 0.54, 0.09), (0.0, 0.04, 2.105), p["medium_walnut"], carcass,
         bevel=0.020)
    _box("Backsplash", (3.04, 0.055, 0.13), (0.0, 0.275, 0.98), p["muted_sage"], carcass,
         bevel=0.008)

    # A hinged base-cabinet door and sliding drawer remain true independent
    # components, with the same persisted pivot and clip names as before.
    door_hinge = A.pivot("CabinetDoor", location=(-1.52, -0.282, 0.48), parent=root,
                         properties={"pivot_role": "left vertical hinge", "axis": "+Z"})
    door_parts = _raised_panel("AnimatedBaseDoor", (-1.16, -0.292, 0.48), (0.72, 0.038, 0.55),
                               m["dark_walnut"], m["walnut_inset"], door_hinge)
    _join_meshes(door_parts, "AnimatedBaseCabinetDoor", door_hinge)
    drawer_pivot = A.pivot("CabinetDrawer", location=(0.39, -0.295, 0.68), parent=root,
                           properties={"pivot_role": "drawer slide datum", "axis": "-Y"})
    _box("AnimatedBaseDrawer", (0.72, 0.055, 0.20), (0.39, -0.302, 0.68),
         m["walnut_inset"], drawer_pivot, bevel=0.016, properties={"moving_part": "drawer"})

    # Remaining fronts complete the base run while the centre bay leaves room
    # for the real drawer instead of stacking coplanar panels behind it.
    static_fronts: list[bpy.types.Object] = []
    for index, (x, z, w, h) in enumerate(((-0.39, 0.48, 0.72, 0.55),
                                          (0.39, 0.355, 0.72, 0.29),
                                          (1.16, 0.48, 0.72, 0.55)), 1):
        static_fronts.extend(_raised_panel(f"StaticFront{index}", (x, -0.292, z),
                                           (w, 0.038, h), m["dark_walnut"], m["walnut_inset"], fronts))
    _join_meshes(static_fronts, "StaticCabinetFrontSet", fronts)
    _box("InternalShelf", (0.66, 0.39, 0.035), (-1.16, 0.045, 0.48), p["natural_oak"], carcass,
         bevel=0.008, properties={"visible_when_door_open": True})

    _join_meshes(_brass_pull("AnimatedDoorPull", (-1.16, -0.322, 0.48), 0.13,
                              door_hinge, p["restrained_brass"]),
                 "AnimatedDoorBrassPull", door_hinge)
    _join_meshes(_brass_pull("AnimatedDrawerPull", (0.39, -0.337, 0.68), 0.13,
                              drawer_pivot, p["restrained_brass"]),
                 "AnimatedDrawerBrassPull", drawer_pivot)
    pulls: list[bpy.types.Object] = []
    for i, (x, y, z) in enumerate(((-0.39, -0.322, 0.48),
                                   (0.39, -0.322, 0.355),
                                   (1.16, -0.322, 0.48)), 1):
        pulls.extend(_brass_pull(f"StaticCabinetPull{i}", (x, y, z), 0.13,
                                  fronts, p["restrained_brass"]))
    _join_meshes(pulls, "StaticCabinetBrassPullSet", fronts)

    _marker("CabinetNext", root, (1.60, 0.0, 0.0), module_width_m=3.20)
    _marker("CounterProp_01", root, (-0.62, -0.03, 0.915), surface="countertop")
    _marker("CounterProp_02", root, (0.62, -0.03, 0.915), surface="countertop")
    _marker("InternalShelf", root, (-1.16, 0.045, 0.50), visible_when_door_open=True)

    collision = _group("CabinetCollision", root)
    A.collision_box("BaseCabinetHull", (3.08, 0.57, 0.86), (0.0, 0.015, 0.48), parent=collision)
    A.collision_box("HutchUprightWest", (0.10, 0.30, 1.18), (-1.54, 0.14, 1.515), parent=collision)
    A.collision_box("HutchUprightEast", (0.10, 0.30, 1.18), (1.54, 0.14, 1.515), parent=collision)
    A.collision_box("AnimatedDoor", (0.72, 0.038, 0.55), (-1.16, -0.292, 0.48),
                    parent=door_hinge, purpose="state-aware-door")
    A.collision_box("AnimatedDrawer", (0.72, 0.055, 0.20), (0.39, -0.302, 0.68),
                    parent=drawer_pivot, purpose="state-aware-drawer")

    closed_rot = (0.0, 0.0, 0.0)
    open_rot = (0.0, 0.0, math.radians(105.0))
    A.animate_transform_clip(door_hinge, "CabinetDoor_Open",
                             ({"frame": 1, "rotation": closed_rot}, {"frame": 22, "rotation": open_rot}),
                             interpolation="SINE")
    A.animate_transform_clip(door_hinge, "CabinetDoor_Close",
                             ({"frame": 1, "rotation": open_rot}, {"frame": 22, "rotation": closed_rot}),
                             interpolation="SINE")
    base = (0.39, -0.295, 0.68)
    extended = (0.39, -0.575, 0.68)
    A.animate_transform_clip(drawer_pivot, "CabinetDrawer_Open",
                             ({"frame": 1, "location": base}, {"frame": 18, "location": extended}),
                             interpolation="SINE")
    A.animate_transform_clip(drawer_pivot, "CabinetDrawer_Close",
                             ({"frame": 1, "location": extended}, {"frame": 18, "location": base}),
                             interpolation="SINE")
    door_hinge.rotation_euler = closed_rot
    drawer_pivot.location = base
    bpy.context.view_layer.update()
    return root


def build_63() -> bpy.types.Object:
    root, p = _root(63, fixture_role="fitting_room", cloth_simulation=False,
                    curtain_interaction="controlled transform clips")
    m = _materials()
    shell = _group("FittingRoomShell", root)
    interior = _group("FittingRoomInterior", root)
    _placement(root)

    # Full-depth side walls and rear wall form a private but forgiving walk-in enclosure.
    _box("WestWall", (0.20, 1.55, 2.35), (-0.675, 0.0, 1.175), p["warm_cream"], shell, bevel=0.018)
    _box("EastWall", (0.20, 1.55, 2.35), (0.675, 0.0, 1.175), p["warm_cream"], shell, bevel=0.018)
    _box("RearWall", (1.15, 0.16, 2.35), (0.0, 0.695, 1.175), p["warm_cream"], shell, bevel=0.018)
    _box("FrontHeader", (1.15, 0.18, 0.20), (0.0, -0.685, 2.25), m["dark_walnut"], shell, bevel=0.024)
    crown_parts = [
        _box("CrownWest", (0.25, 1.55, 0.10), (-0.65, 0.0, 2.40), m["dark_walnut"], shell, bevel=0.018),
        _box("CrownEast", (0.25, 1.55, 0.10), (0.65, 0.0, 2.40), m["dark_walnut"], shell, bevel=0.018),
        _box("CrownRear", (1.05, 0.20, 0.10), (0.0, 0.675, 2.40), m["dark_walnut"], shell, bevel=0.018),
        _box("CrownFront", (1.05, 0.20, 0.10), (0.0, -0.675, 2.40), m["dark_walnut"], shell, bevel=0.018),
    ]
    _join_meshes(crown_parts, "FittingRoomCrown", shell)
    wainscot = [
        _box("WainscotWest", (0.215, 1.50, 0.78), (-0.665, 0.0, 0.39), p["deep_green"], shell, bevel=0.012),
        _box("WainscotEast", (0.215, 1.50, 0.78), (0.665, 0.0, 0.39), p["deep_green"], shell, bevel=0.012),
        _box("WainscotRear", (1.10, 0.175, 0.78), (0.0, 0.688, 0.39), p["deep_green"], shell, bevel=0.012),
    ]
    _join_meshes(wainscot, "FittingRoomWainscot", shell)

    # The bench shares the room's dark walnut rather than introducing a ninth material
    # for one seat, which is what put this asset over its 8-material budget.
    _box("BenchSeat", (0.82, 0.38, 0.09), (0.0, 0.43, 0.48), m["dark_walnut"], interior,
         bevel=0.025, properties={"sittable": True})
    bench_legs = [
        _box("BenchLegWest", (0.09, 0.32, 0.44), (-0.34, 0.43, 0.22), m["dark_walnut"], interior, bevel=0.012),
        _box("BenchLegEast", (0.09, 0.32, 0.44), (0.34, 0.43, 0.22), m["dark_walnut"], interior, bevel=0.012),
    ]
    _join_meshes(bench_legs, "BenchLegSet", interior)
    _box("MirrorGlass", (0.54, 0.025, 1.02), (0.0, 0.598, 1.48), m["mirror"], interior, bevel=0.008)
    mirror_frame = [
        _box("MirrorFrameL", (0.045, 0.04, 1.10), (-0.292, 0.584, 1.48), p["restrained_brass"], interior, bevel=0.008),
        _box("MirrorFrameR", (0.045, 0.04, 1.10), (0.292, 0.584, 1.48), p["restrained_brass"], interior, bevel=0.008),
        _box("MirrorFrameTop", (0.63, 0.04, 0.045), (0.0, 0.584, 2.008), p["restrained_brass"], interior, bevel=0.008),
        _box("MirrorFrameBottom", (0.63, 0.04, 0.045), (0.0, 0.584, 0.952), p["restrained_brass"], interior, bevel=0.008),
    ]
    _join_meshes(mirror_frame, "MirrorFrame", interior)
    hooks: list[bpy.types.Object] = []
    for index, x in enumerate((-0.44, 0.44), 1):
        hooks.append(A.cylinder(f"Hook{index}Stem", 0.018, 0.06, (x, 0.582, 1.42),
                                p["restrained_brass"], rotation=(math.pi / 2.0, 0.0, 0.0),
                                vertices=12, parent=interior, bevel=0.002))
        hooks.append(A.torus(f"Hook{index}Loop", 0.040, 0.009, (x, 0.545, 1.38),
                             p["restrained_brass"], rotation=(math.pi / 2.0, 0.0, 0.0),
                             major_segments=16, minor_segments=6, parent=interior))
    _join_meshes(hooks, "FittingHookSet", interior)
    _box("InteriorLightLens", (0.38, 0.16, 0.035), (0.0, 0.15, 2.405), m["warm_light"], interior,
         bevel=0.012, properties={"emissive_fixture": True})

    A.cylinder("CurtainRail", 0.022, 1.22, (0.0, -0.72, 2.16), p["restrained_brass"],
               rotation=(0.0, math.pi / 2.0, 0.0), vertices=16, parent=shell, bevel=0.003)
    curtain_pivot = A.pivot("Curtain", location=(-0.57, -0.735, 2.12), parent=root,
                            properties={"pivot_role": "curtain fixed rail end", "axis": "+X slide/scale"})
    pleats: list[bpy.types.Object] = []
    for index in range(10):
        x = -0.515 + index * 0.1145
        y = -0.735 + (0.018 if index % 2 else -0.018)
        pleats.append(_box(f"CurtainPleat{index + 1:02d}", (0.135, 0.045, 1.80),
                           (x, y, 1.20), m["curtain"], curtain_pivot,
                           bevel=0.018, bevel_segments=3, properties={"moving_part": "curtain"}))
    _join_meshes(pleats, "FittingCurtainPleated", curtain_pivot)

    _marker("Bench", root, (0.0, 0.43, 0.525), interaction="sit_or_place")
    _marker("Hook_01", root, (-0.44, 0.545, 1.38), interaction="hang_apparel")
    _marker("Hook_02", root, (0.44, 0.545, 1.38), interaction="hang_apparel")
    _marker("Mirror", root, (0.0, 0.57, 1.48), interaction="reflective_surface")
    _marker("InteriorLight", root, (0.0, 0.15, 2.405), fixture="emissive_only")

    collision = _group("FittingRoomCollision", root)
    A.collision_box("WestWall", (0.20, 1.55, 2.35), (-0.675, 0.0, 1.175), parent=collision)
    A.collision_box("EastWall", (0.20, 1.55, 2.35), (0.675, 0.0, 1.175), parent=collision)
    A.collision_box("RearWall", (1.15, 0.16, 2.35), (0.0, 0.695, 1.175), parent=collision)
    A.collision_box("Bench", (0.82, 0.38, 0.53), (0.0, 0.43, 0.265), parent=collision)

    closed_scale = (1.0, 1.0, 1.0)
    open_scale = (0.18, 1.0, 1.0)
    A.animate_transform_clip(curtain_pivot, "FittingCurtain_Open",
                             ({"frame": 1, "scale": closed_scale}, {"frame": 24, "scale": open_scale}),
                             interpolation="SINE")
    A.animate_transform_clip(curtain_pivot, "FittingCurtain_Close",
                             ({"frame": 1, "scale": open_scale}, {"frame": 24, "scale": closed_scale}),
                             interpolation="SINE")
    curtain_pivot.scale = closed_scale
    bpy.context.view_layer.update()
    return root


def build_64() -> bpy.types.Object:
    root, p = _root(64, fixture_role="stockroom_modular_shelving", runtime_instancing=True,
                    adjustable_levels=True)
    frame = _group("ShelvingFrame", root)
    _placement(root)
    post_x = 1.77 / 2.0
    post_y = 0.55 / 2.0
    posts = [
        _box(f"Upright_{x_label}_{y_label}", (0.055, 0.055, 2.13), (x, y, 1.065),
             p["warm_charcoal"], frame, bevel=0.008)
        for x_label, x in (("W", -post_x), ("E", post_x))
        for y_label, y in (("Front", -post_y), ("Rear", post_y))
    ]
    _join_meshes(posts, "ShelvingUprightSet", frame)
    footplates = [
        _box(f"Footplate{i}", (0.06, 0.06, 0.018), (x, y, 0.009), p["warm_charcoal"], frame, bevel=0.006)
        for i, (x, y) in enumerate(((-post_x, -post_y), (-post_x, post_y),
                                    (post_x, -post_y), (post_x, post_y)), 1)
    ]
    _join_meshes(footplates, "ShelvingFootplateSet", frame)
    levels = (0.28, 0.76, 1.24, 1.72)
    shelves = []
    lips = []
    for index, z in enumerate(levels, 1):
        shelves.append(_box(f"ShelfDeck{index}", (1.72, 0.55, 0.045), (0.0, 0.0, z),
                            p["natural_oak"], frame, bevel=0.008,
                            properties={"placement_level": index, "instanced_module": True}))
        lips.extend((
            _box(f"ShelfLip{index}Front", (1.78, 0.035, 0.085), (0.0, -0.285, z - 0.005),
                 p["warm_charcoal"], frame, bevel=0.006),
            _box(f"ShelfLip{index}Rear", (1.78, 0.035, 0.085), (0.0, 0.285, z - 0.005),
                 p["warm_charcoal"], frame, bevel=0.006),
        ))
    _join_meshes(shelves, "AdjustableShelfDeckSet", frame)
    _join_meshes(lips, "ShelfLipSet", frame)
    braces = []
    for index, (z0, z1, flip) in enumerate(((0.30, 0.74, False), (0.78, 1.22, True),
                                             (1.26, 1.70, False), (1.74, 2.08, True)), 1):
        x0, x1 = (-0.83, 0.83) if not flip else (0.83, -0.83)
        dx, dz = x1 - x0, z1 - z0
        braces.append(_box(f"RearBrace{index}", (math.hypot(dx, dz), 0.024, 0.024),
                            ((x0 + x1) / 2.0, 0.292, (z0 + z1) / 2.0),
                            p["warm_charcoal"], frame,
                            rotation=(0.0, -math.atan2(dz, dx), 0.0), bevel=0.004))
    _join_meshes(braces, "RearCrossBraceSet", frame)
    for index, z in enumerate(levels, 1):
        _marker(f"ShelfLevel_{index:02d}", root, (0.0, 0.0, z + 0.025),
                placement_level=index, usable_width_m=1.66, usable_depth_m=0.50)
    _marker("ShelfNext", root, (0.915, 0.0, 0.0), module_width_m=1.83)
    collision = _group("ShelvingCollision", root)
    A.collision_box("UprightFrame", (1.83, 0.12, 2.13), (0.0, 0.245, 1.065), parent=collision)
    for index, z in enumerate(levels, 1):
        A.collision_box(f"ShelfLevel{index}", (1.72, 0.55, 0.045), (0.0, 0.0, z),
                        parent=collision, purpose="blocking-placement")
    return root


# ===== CC0 textured materials, asset 065 =====
# Source: ambientCG.com, Creative Commons CC0 1.0 Universal. Commercial use permitted,
# attribution optional ("You can include the raw files in your project, for example a
# video game" - https://ambientcg.com/license). Maps in
# asset_sources/textures/cc0_spike/.
#
# TINT EXPORT — the defect that was here, and why the node type below is load-bearing.
#
# This recipe previously built its base-colour tint with a `ShaderNodeMixRGB`, and every
# tint was silently dropped at export: all four textured materials shipped with NO
# `baseColorFactor` at all, which glTF defaults to (1,1,1,1), so each surface arrived as
# the raw untinted ambientCG photograph.  Nothing failed.  That, not colour arithmetic,
# is what put Spike/TEXTURE_VALIDATION.md Arm F off palette.
#
# The cause is exact and is in the exporter, not in Blender's shading.  Both node types
# render identically in the viewport, so the .blend looked right.
# `io_scene_gltf2/blender/exp/material/search_node_tree.py::get_multiply_factors`
# recognises a base-colour factor only when ALL of these hold:
#
#     prev.node.type == 'MIX'          <- ShaderNodeMix.  A ShaderNodeMixRGB reports
#                                         type 'MIX_RGB' and never matches.
#     prev.node.data_type == 'RGBA'
#     prev.node.blend_type == 'MULTIPLY'
#     Factor is a constant exactly 1.0 <- 0.9 does not match either
#     one of A_Color / B_Color is an unconnected constant
#
# So: ShaderNodeMix, RGBA, MULTIPLY, Factor pinned to 1.0, tint on the constant socket.
# `tests/proshop-basecolor-factor.test.js` reads the exported GLB back and fails if a
# material carrying an albedo map ships without a factor, because a silent drop is
# exactly the kind of defect that survives review.
_CC0_DIR = Path(__file__).resolve().parents[2] / "asset_sources" / "textures" / "cc0_spike"
_CAL_MANIFEST = (Path(__file__).resolve().parents[2] / "asset_sources" / "textures"
                 / "cc0_calibrated" / "asset_065_calibration.json")


def _tint_base_colour(nt, source_socket, bsdf, tint):
    """Multiply an albedo by a constant tint so the exporter emits a baseColorFactor.

    Every property set here is required by the exporter's pattern match; see the block
    above before changing any of them.
    """
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    # RGBA sockets by index: ShaderNodeMix carries one A/B pair per data type and they
    # all share the display names "A" and "B", so a name lookup is ambiguous.
    nt.links.new(source_socket, mix.inputs[6])   # A_Color <- texture
    mix.inputs[7].default_value = tuple(tint)    # B_Color <- constant, becomes the factor
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    return mix


def _textured_material(name, cc0_id, *, tint=None, uv_scale=2.0, metallic=0.0,
                       roughness_boost=0.0, has_metalness=False, albedo_path=None):
    """Principled BSDF driven by CC0 Color/Roughness/NormalGL maps.

    Colour space matters and is easy to get silently wrong: Color is sRGB, Roughness and
    Normal are Non-Color. NormalGL is the OpenGL convention, which is what glTF expects.

    `albedo_path` overrides the base-colour map only, leaving roughness/normal on the
    original source — ART_BIBLE §7.4.1 calibrates the albedo and nothing else, because
    roughness and normal are data rather than colour.
    """
    mat = bpy.data.materials.new(name if name.startswith("MAT_") else "MAT_" + name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    texco = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (uv_scale, uv_scale, 1.0)
    nt.links.new(texco.outputs["UV"], mapping.inputs["Vector"])

    def img(suffix, non_color):
        path = _CC0_DIR / f"{cc0_id}_1K-JPG_{suffix}.jpg"
        if suffix == "Color" and albedo_path is not None:
            path = albedo_path
        if not path.exists():
            return None
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(str(path), check_existing=True)
        # The repo's asset validator rejects unpacked textures (texture-not-packed), and
        # correctly so: an unpacked image is a path dependency that breaks the moment the
        # .blend moves. Pack it into the file so the export is self-contained.
        if not node.image.packed_file:
            node.image.pack()
        if non_color:
            node.image.colorspace_settings.name = "Non-Color"
        nt.links.new(mapping.outputs["Vector"], node.inputs["Vector"])
        return node

    col = img("Color", False)
    if col is not None:
        if tint is not None:
            _tint_base_colour(nt, col.outputs["Color"], bsdf, tint)
        else:
            nt.links.new(col.outputs["Color"], bsdf.inputs["Base Color"])

    rgh = img("Roughness", True)
    if rgh is not None:
        if roughness_boost:
            add = nt.nodes.new("ShaderNodeMath")
            add.operation = "ADD"
            add.inputs[1].default_value = roughness_boost
            add.use_clamp = True
            nt.links.new(rgh.outputs["Color"], add.inputs[0])
            nt.links.new(add.outputs["Value"], bsdf.inputs["Roughness"])
        else:
            nt.links.new(rgh.outputs["Color"], bsdf.inputs["Roughness"])

    nrm = img("NormalGL", True)
    if nrm is not None:
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(nrm.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

    if has_metalness:
        met = img("Metalness", True)
        if met is not None:
            nt.links.new(met.outputs["Color"], bsdf.inputs["Metallic"])
        else:
            bsdf.inputs["Metallic"].default_value = metallic
    else:
        bsdf.inputs["Metallic"].default_value = metallic
    return mat


# Per-slot settings that are geometry and material response, not colour: they are the
# same in every arm, so a difference between arms is only ever the albedo pipeline.
_SLOTS_65 = {
    "natural_oak": dict(source="Wood051", uv_scale=2.2),
    "medium_walnut": dict(source="Wood062", uv_scale=2.6),
    "warm_charcoal": dict(source="Metal032", uv_scale=3.0, roughness_boost=0.12),
    "restrained_brass": dict(source="Metal032", uv_scale=4.0, metallic=1.0),
}


def _cc0_materials_65() -> dict:
    """Calibrated textured materials for asset 065 — ART_BIBLE §7.4.1.

    The tints are NOT authored here.  They are solved by
    ``python tools/blender/cc0_calibrate.py --emit 065`` from the measured mean
    luminance of each calibrated map, and read back from the manifest it writes.  A
    tint that is computed from the map it multiplies is the only kind that lands on
    the palette value; an eyeballed one is off by an amount that scales with how
    saturated the source photograph happened to be.
    """
    if not _CAL_MANIFEST.exists():
        raise SystemExit(
            f"missing {_CAL_MANIFEST}\n"
            "run: python tools/blender/cc0_calibrate.py --emit 065"
        )
    manifest = json.loads(_CAL_MANIFEST.read_text(encoding="utf-8"))
    repo = Path(__file__).resolve().parents[2]

    materials = {}
    for entry in manifest["materials"]:
        slot = _SLOTS_65[entry["key"]]
        if entry["source"] != slot["source"]:
            raise SystemExit(
                f"calibration manifest maps {entry['key']} to {entry['source']}, "
                f"builder expects {slot['source']}"
            )
        if not entry["reachable"]:
            raise SystemExit(f"{entry['name']}: {entry['note']}")
        settings = {k: v for k, v in slot.items() if k != "source"}
        materials[entry["key"]] = _textured_material(
            f"CC065_{entry['name']}", entry["source"],
            # Solved in linear, which is what a Blender Base Color socket and a glTF
            # baseColorFactor both hold. Writing the sRGB floats here is the Arm C bug.
            tint=(*entry["tintLinear"], 1.0),
            albedo_path=repo / entry["calibratedMap"],
            **settings,
        )
    return materials


# Arm A of the texture validation: the same geometry with the flat palette materials it
# had before any CC0 map was introduced. It is the control the whole texture thesis is
# measured against, so it has to be rebuildable rather than remembered.
#   blender ... --python tools/blender/build_assets_61_70.py -- --asset 65 --untextured
UNTEXTURED = False


def build_65() -> bpy.types.Object:
    root, p = _root(65, fixture_role="delivery_worktable", full_top_placement_surface=True)
    if not UNTEXTURED:
        p = {**p, **_cc0_materials_65()}  # asset-065-local textured override
    frame = _group("WorktableFrame", root)
    _placement(root)
    _box("OakWorktop", (1.80, 0.75, 0.085), (0.0, 0.0, 0.8775), p["natural_oak"], frame,
         bevel=0.003, bevel_segments=2, properties={"placement_surface": True, "delivery_setdown": True})
    _box("WorktopDarkEdge", (1.72, 0.67, 0.035), (0.0, 0.0, 0.823), p["medium_walnut"], frame,
         bevel=0.003)
    legs = [
        _box(f"Leg{i}", (0.085, 0.085, 0.80), (x, y, 0.40), p["warm_charcoal"], frame, bevel=0.003)
        for i, (x, y) in enumerate(((-0.80, -0.285), (-0.80, 0.285),
                                    (0.80, -0.285), (0.80, 0.285)), 1)
    ]
    _join_meshes(legs, "WorktableLegSet", frame)
    aprons = [
        _box("ApronFront", (1.58, 0.06, 0.13), (0.0, -0.30, 0.75), p["warm_charcoal"], frame, bevel=0.003),
        _box("ApronRear", (1.58, 0.06, 0.13), (0.0, 0.30, 0.75), p["warm_charcoal"], frame, bevel=0.003),
        _box("ApronWest", (0.06, 0.52, 0.13), (-0.80, 0.0, 0.75), p["warm_charcoal"], frame, bevel=0.003),
        _box("ApronEast", (0.06, 0.52, 0.13), (0.80, 0.0, 0.75), p["warm_charcoal"], frame, bevel=0.003),
    ]
    _join_meshes(aprons, "WorktableApronFrame", frame)
    _box("LowerShelf", (1.55, 0.52, 0.055), (0.0, 0.0, 0.25), p["medium_walnut"], frame,
         bevel=0.003, properties={"storage_surface": True})
    corner_caps = [
        _box(f"CornerCap{i}", (0.12, 0.12, 0.012), (x, y, 0.926), p["restrained_brass"], frame, bevel=0.0015)
        for i, (x, y) in enumerate(((-0.82, -0.31), (-0.82, 0.31),
                                    (0.82, -0.31), (0.82, 0.31)), 1)
    ]
    _join_meshes(corner_caps, "WorktableCornerCapSet", frame)
    for name, loc, role in (
        ("BoxOpening", (-0.43, -0.04, 0.92), "delivery_box_open"),
        ("PackageStage", (0.38, -0.04, 0.92), "package_setdown"),
        ("Tool_01", (0.69, 0.19, 0.92), "tool_mount"),
        ("Tool_02", (0.69, -0.19, 0.92), "tool_mount"),
        ("LowerShelf", (0.0, 0.0, 0.28), "storage"),
    ):
        _marker(name, root, loc, socket_role=role)
    collision = _group("WorktableCollision", root)
    A.collision_box("Worktop", (1.80, 0.75, 0.085), (0.0, 0.0, 0.8775), parent=collision,
                    purpose="blocking-placement")
    A.collision_box("WestLegFrame", (0.16, 0.62, 0.80), (-0.80, 0.0, 0.40), parent=collision)
    A.collision_box("EastLegFrame", (0.16, 0.62, 0.80), (0.80, 0.0, 0.40), parent=collision)
    A.collision_box("LowerShelf", (1.55, 0.52, 0.055), (0.0, 0.0, 0.25), parent=collision,
                    purpose="blocking-placement")
    return root


def build_66() -> bpy.types.Object:
    root, p = _root(66, fixture_role="management_desk", laptop_flow_owner="runtime laptop interaction",
                    chair_exit_clear=True)
    m = _materials()
    body = _group("OfficeDeskBody", root)
    details = _group("OfficeDeskJoinery", root)
    _placement(root)
    _box("DeskTop", (1.60, 0.80, 0.075), (0.0, 0.0, 0.7225), p["medium_walnut"], body,
         bevel=0.024, bevel_segments=3, properties={"placement_surface": True})
    _box("DeskTopInset", (1.38, 0.62, 0.014), (0.0, -0.02, 0.753), m["dark_walnut"], details,
         bevel=0.008)
    _box("WestPedestal", (0.39, 0.66, 0.64), (-0.57, 0.045, 0.36), m["dark_walnut"], body, bevel=0.022)
    _box("EastPedestal", (0.39, 0.66, 0.64), (0.57, 0.045, 0.36), m["dark_walnut"], body, bevel=0.022)
    _box("RearModestyPanel", (0.70, 0.055, 0.43), (0.0, 0.335, 0.42), m["dark_walnut"], body,
         bevel=0.014)
    plinths = [
        _box("WestPlinth", (0.45, 0.70, 0.075), (-0.57, 0.045, 0.0375), p["medium_walnut"], body, bevel=0.014),
        _box("EastPlinth", (0.45, 0.70, 0.075), (0.57, 0.045, 0.0375), p["medium_walnut"], body, bevel=0.014),
    ]
    _join_meshes(plinths, "DeskPlinthSet", body)
    drawer_faces = []
    pulls = []
    for side, x in (("West", -0.57), ("East", 0.57)):
        for index, z in enumerate((0.20, 0.40, 0.60), 1):
            drawer_faces.append(_box(f"{side}Drawer{index}", (0.325, 0.045, 0.16),
                                     (x, -0.307, z), m["walnut_inset"], details, bevel=0.016))
            pulls.extend(_brass_pull(f"{side}Pull{index}", (x, -0.338, z), 0.12,
                                      details, p["restrained_brass"]))
    _join_meshes(drawer_faces, "OfficeDeskDrawerFrontSet", details)
    _join_meshes(pulls, "OfficeDeskBrassPullSet", details)
    # The knee aperture remains 0.70 m wide and clear from -Y through the chair socket.
    _marker("Laptop", root, (0.0, -0.10, 0.76), mount="desktop", forward="-Y")
    _marker("Lamp", root, (-0.57, 0.16, 0.76), mount="desktop")
    _marker("ChairPlacement", root, (0.0, -0.78, 0.0), clearance_radius_m=0.42)
    _marker("OfficeProp_01", root, (0.52, 0.12, 0.76), mount="desktop")
    _marker("CableGrommet", root, (0.0, 0.27, 0.76), cable_route="rear")
    collision = _group("OfficeDeskCollision", root)
    A.collision_box("Desktop", (1.60, 0.80, 0.075), (0.0, 0.0, 0.7225), parent=collision,
                    purpose="blocking-placement")
    A.collision_box("WestPedestal", (0.45, 0.70, 0.68), (-0.57, 0.045, 0.34), parent=collision)
    A.collision_box("EastPedestal", (0.45, 0.70, 0.68), (0.57, 0.045, 0.34), parent=collision)
    return root


def _seat_piping(parent: bpy.types.Object, p: dict[str, bpy.types.Material],
                 centers: Sequence[tuple[float, float, float]], width: float,
                 depth: float) -> bpy.types.Object:
    pipes = []
    for index, (x, y, z) in enumerate(centers, 1):
        points = ((x - width / 2, y - depth / 2, z), (x + width / 2, y - depth / 2, z),
                  (x + width / 2, y + depth / 2, z), (x - width / 2, y + depth / 2, z))
        pipes.append(A.curve_tube(f"SeatPiping{index}", points, 0.008, p["restrained_brass"],
                                  parent=parent, cyclic=True, resolution=1, bevel_resolution=1,
                                  properties={"upholstery_piping": True}))
    return _join_meshes(pipes, "SeatPipingSet", parent)


def _tuft_buttons(name: str, parent: bpy.types.Object, mat: bpy.types.Material,
                  xs: Sequence[float], zs: Sequence[float], y: float) -> bpy.types.Object:
    buttons = []
    for row, z in enumerate(zs):
        offset = (xs[1] - xs[0]) / 2.0 if len(xs) > 1 and row % 2 else 0.0
        for col, x in enumerate(xs):
            candidate = x + offset
            if candidate > max(xs) + 0.001:
                continue
            buttons.append(A.sphere(f"{name}_{row + 1}_{col + 1}", 0.017, (candidate, y, z), mat,
                                    segments=12, rings=6, parent=parent,
                                    properties={"upholstery_tuft": True}))
    return _join_meshes(buttons, name, parent)


def build_67() -> bpy.types.Object:
    root, p = _root(67, furniture_family="sheet07_lounge", seat_count=3, upholstery="stylized chestnut leather")
    m = _materials()
    frame = _group("SofaFrame", root)
    upholstery = _group("SofaUpholstery", root)
    _placement(root)
    _box("SofaBase", (2.03, 0.95, 0.24), (0.0, 0.0, 0.25), m["dark_walnut"], frame, bevel=0.045,
         bevel_segments=3)
    _box("SofaBackPanel", (1.83, 0.18, 0.48), (0.0, 0.365, 0.62), m["leather"], upholstery,
         bevel=0.060, bevel_segments=3)
    A.cylinder("SofaBackRoll", 0.08, 1.99, (0.0, 0.36, 0.82), m["leather"],
               rotation=(0.0, math.pi / 2.0, 0.0), vertices=24, parent=upholstery, bevel=0.004)
    arm_blocks = []
    arm_rolls = []
    for side, x in (("West", -0.99), ("East", 0.99)):
        arm_blocks.append(_box(f"SofaArm{side}", (0.16, 0.82, 0.47), (x, -0.02, 0.47),
                               m["leather"], upholstery, bevel=0.055, bevel_segments=3))
        arm_rolls.append(A.cylinder(f"SofaArmRoll{side}", 0.085, 0.77, (x, -0.025, 0.69),
                                    m["leather"], rotation=(math.pi / 2.0, 0.0, 0.0),
                                    vertices=20, parent=upholstery, bevel=0.004))
    _join_meshes(arm_blocks, "SofaArmBlockSet", upholstery)
    _join_meshes(arm_rolls, "SofaArmRollSet", upholstery)
    seat_centers = ((-0.63, -0.095, 0.48), (0.0, -0.095, 0.48), (0.63, -0.095, 0.48))
    seats = [_cushion(f"SofaSeat{index}", (0.59, 0.58, 0.15), loc, m["leather"], upholstery)
             for index, loc in enumerate(seat_centers, 1)]
    _join_meshes(seats, "SofaSeatCushionSet", upholstery)
    backs = [_cushion(f"SofaBackCushion{index}", (0.57, 0.14, 0.35), (x, 0.255, 0.66),
                      m["leather"], upholstery, bevel=0.038)
             for index, x in enumerate((-0.62, 0.0, 0.62), 1)]
    _join_meshes(backs, "SofaBackCushionSet", upholstery)
    _seat_piping(upholstery, p, [(x, y, z + 0.075) for x, y, z in seat_centers], 0.55, 0.54)
    _tuft_buttons("SofaTuftButtonSet", upholstery, m["leather_shadow"],
                  (-0.72, -0.36, 0.0, 0.36, 0.72), (0.59, 0.70, 0.79), 0.176)
    feet = [A.cylinder(f"SofaFoot{i}", 0.045, 0.13, (x, y, 0.065), p["medium_walnut"],
                       vertices=12, parent=frame, bevel=0.006)
            for i, (x, y) in enumerate(((-0.88, -0.34), (-0.88, 0.34),
                                        (0.88, -0.34), (0.88, 0.34)), 1)]
    _join_meshes(feet, "SofaFootSet", frame)
    for index, x in enumerate((-0.63, 0.0, 0.63), 1):
        _marker(f"Seat_{index:02d}", root, (x, -0.10, 0.56), sit_destination=True)
    _marker("LoungeTable", root, (0.0, -1.04, 0.0), companion_asset=69)
    collision = _group("SofaCollision", root)
    A.collision_box("SofaBody", (1.83, 0.88, 0.56), (0.0, 0.01, 0.31), parent=collision)
    A.collision_box("SofaBack", (1.99, 0.24, 0.48), (0.0, 0.35, 0.66), parent=collision)
    A.collision_box("SofaArms", (2.15, 0.82, 0.48), (0.0, -0.02, 0.48), parent=collision)
    return root


def build_68() -> bpy.types.Object:
    root, p = _root(68, furniture_family="sheet07_lounge", seat_count=1,
                    material_match_asset=67, upholstery="stylized chestnut leather")
    m = _materials()
    frame = _group("ArmchairFrame", root)
    upholstery = _group("ArmchairUpholstery", root)
    _placement(root)
    _box("ArmchairBase", (0.77, 0.90, 0.24), (0.0, 0.0, 0.25), m["dark_walnut"], frame,
         bevel=0.040, bevel_segments=3)
    _box("ArmchairBack", (0.61, 0.17, 0.50), (0.0, 0.34, 0.62), m["leather"], upholstery,
         bevel=0.055, bevel_segments=3)
    A.cylinder("ArmchairBackRoll", 0.07, 0.85, (0.0, 0.34, 0.83), m["leather"],
               rotation=(0.0, math.pi / 2.0, 0.0), vertices=22, parent=upholstery, bevel=0.004)
    arm_blocks = []
    arm_rolls = []
    for side, x in (("West", -0.35), ("East", 0.35)):
        arm_blocks.append(_box(f"ArmchairArm{side}", (0.15, 0.76, 0.47), (x, -0.025, 0.47),
                               m["leather"], upholstery, bevel=0.050, bevel_segments=3))
        arm_rolls.append(A.cylinder(f"ArmchairRoll{side}", 0.075, 0.70, (x, -0.03, 0.69),
                                    m["leather"], rotation=(math.pi / 2.0, 0.0, 0.0),
                                    vertices=20, parent=upholstery, bevel=0.004))
    _join_meshes(arm_blocks, "ArmchairArmBlockSet", upholstery)
    _join_meshes(arm_rolls, "ArmchairArmRollSet", upholstery)
    _cushion("ArmchairSeat", (0.52, 0.54, 0.15), (0.0, -0.09, 0.48), m["leather"], upholstery)
    _cushion("ArmchairBackCushion", (0.51, 0.13, 0.37), (0.0, 0.245, 0.66),
             m["leather"], upholstery, bevel=0.038)
    _seat_piping(upholstery, p, ((0.0, -0.09, 0.555),), 0.49, 0.50)
    _tuft_buttons("ArmchairTuftButtonSet", upholstery, m["leather_shadow"],
                  (-0.16, 0.0, 0.16), (0.60, 0.72, 0.80), 0.169)
    feet = [A.cylinder(f"ArmchairFoot{i}", 0.038, 0.13, (x, y, 0.065), p["medium_walnut"],
                       vertices=12, parent=frame, bevel=0.005)
            for i, (x, y) in enumerate(((-0.31, -0.31), (-0.31, 0.31),
                                        (0.31, -0.31), (0.31, 0.31)), 1)]
    _join_meshes(feet, "ArmchairFootSet", frame)
    _marker("Seat", root, (0.0, -0.09, 0.56), sit_destination=True)
    _marker("SideTable", root, (0.61, -0.04, 0.0), companion_asset=69)
    collision = _group("ArmchairCollision", root)
    A.collision_box("ArmchairBody", (0.77, 0.84, 0.56), (0.0, 0.0, 0.31), parent=collision)
    A.collision_box("ArmchairBack", (0.85, 0.22, 0.50), (0.0, 0.34, 0.65), parent=collision)
    return root


def build_69() -> bpy.types.Object:
    root, p = _root(69, furniture_family="sheet07_lounge", table_shape="rectangular",
                    material_match_assets="67,68")
    m = _materials()
    frame = _group("CoffeeTableFrame", root)
    _placement(root)
    _box("CoffeeTableTop", (1.10, 0.65, 0.075), (0.0, 0.0, 0.4125), p["medium_walnut"], frame,
         bevel=0.022, bevel_segments=3, properties={"placement_surface": True})
    _box("CoffeeTableInset", (0.91, 0.47, 0.014), (0.0, 0.0, 0.443), m["walnut_inset"], frame,
         bevel=0.008, properties={"decorative_inlay": True})
    aprons = [
        _box("CoffeeApronFront", (0.91, 0.055, 0.11), (0.0, -0.265, 0.345), m["dark_walnut"], frame, bevel=0.010),
        _box("CoffeeApronRear", (0.91, 0.055, 0.11), (0.0, 0.265, 0.345), m["dark_walnut"], frame, bevel=0.010),
        _box("CoffeeApronWest", (0.055, 0.48, 0.11), (-0.455, 0.0, 0.345), m["dark_walnut"], frame, bevel=0.010),
        _box("CoffeeApronEast", (0.055, 0.48, 0.11), (0.455, 0.0, 0.345), m["dark_walnut"], frame, bevel=0.010),
    ]
    _join_meshes(aprons, "CoffeeTableApronFrame", frame)
    legs = [
        _box(f"CoffeeLeg{i}", (0.085, 0.085, 0.34), (x, y, 0.17), m["dark_walnut"], frame, bevel=0.012)
        for i, (x, y) in enumerate(((-0.45, -0.24), (-0.45, 0.24),
                                    (0.45, -0.24), (0.45, 0.24)), 1)
    ]
    _join_meshes(legs, "CoffeeTableLegSet", frame)
    _box("CoffeeTableLowerShelf", (0.86, 0.43, 0.045), (0.0, 0.0, 0.15), p["natural_oak"], frame,
         bevel=0.014, properties={"placement_surface": True})
    shelf_trim = [
        _box("ShelfTrimFront", (0.89, 0.035, 0.07), (0.0, -0.225, 0.15), m["dark_walnut"], frame, bevel=0.006),
        _box("ShelfTrimRear", (0.89, 0.035, 0.07), (0.0, 0.225, 0.15), m["dark_walnut"], frame, bevel=0.006),
    ]
    _join_meshes(shelf_trim, "CoffeeTableShelfTrim", frame)
    for name, loc, role in (
        ("Magazine_01", (-0.25, -0.08, 0.45), "magazine"),
        ("Magazine_02", (0.08, 0.05, 0.45), "magazine"),
        ("Cup", (0.34, -0.11, 0.45), "drink"),
        ("Decor", (0.32, 0.13, 0.45), "decor"),
        ("LowerShelf", (0.0, 0.0, 0.175), "lower_storage"),
    ):
        _marker(name, root, loc, socket_role=role)
    collision = _group("CoffeeTableCollision", root)
    A.collision_box("Tabletop", (1.10, 0.65, 0.075), (0.0, 0.0, 0.4125), parent=collision,
                    purpose="blocking-placement")
    A.collision_box("LowerShelf", (0.86, 0.43, 0.045), (0.0, 0.0, 0.15), parent=collision,
                    purpose="blocking-placement")
    A.collision_box("LegEnvelope", (0.98, 0.56, 0.34), (0.0, 0.0, 0.17), parent=collision)
    return root


def _door_frame(name: str, center_x: float, center_z: float, width: float, height: float,
                y: float, wood: bpy.types.Material, glass: bpy.types.Material,
                parent: bpy.types.Object) -> tuple[bpy.types.Object, bpy.types.Object]:
    rail = 0.065
    pieces = [
        _box(f"{name}StileL", (rail, 0.035, height), (center_x - width / 2 + rail / 2, y, center_z),
             wood, parent, bevel=0.010),
        _box(f"{name}StileR", (rail, 0.035, height), (center_x + width / 2 - rail / 2, y, center_z),
             wood, parent, bevel=0.010),
        _box(f"{name}RailTop", (width - 2 * rail, 0.035, rail),
             (center_x, y, center_z + height / 2 - rail / 2), wood, parent, bevel=0.010),
        _box(f"{name}RailBottom", (width - 2 * rail, 0.035, rail),
             (center_x, y, center_z - height / 2 + rail / 2), wood, parent, bevel=0.010),
        _box(f"{name}RailMid", (width - 2 * rail, 0.035, 0.045), (center_x, y, center_z),
             wood, parent, bevel=0.008),
    ]
    joined = _join_meshes(pieces, name + "WoodFrame", parent)
    glass_obj = _box(name + "Glass", (width - 2 * rail - 0.02, 0.012, height - 2 * rail - 0.02),
                     (center_x, y + 0.012, center_z), glass, parent, bevel=0.004,
                     properties={"glass_door": True})
    return joined, glass_obj


def build_70() -> bpy.types.Object:
    root, p = _root(70, fixture_role="lit_trophy_display", separate_moving_components=True,
                    interior_light="restrained emissive mesh; no shipped Blender light")
    m = _materials()
    carcass = _group("DisplayCabinetCarcass", root)
    interior = _group("DisplayCabinetInterior", root)
    _placement(root)
    # Traditional full-height case with crown, glass display bay, and lower storage.
    _box("DisplayBack", (1.34, 0.10, 1.87), (0.0, 0.17, 1.04), p["deep_green"], carcass, bevel=0.012)
    sides = [
        _box("DisplaySideWest", (0.10, 0.42, 1.94), (-0.68, 0.0, 1.03), m["dark_walnut"], carcass, bevel=0.018),
        _box("DisplaySideEast", (0.10, 0.42, 1.94), (0.68, 0.0, 1.03), m["dark_walnut"], carcass, bevel=0.018),
    ]
    _join_meshes(sides, "DisplayCabinetSideSet", carcass)
    # The crown reuses the lighter inset walnut, which keeps its tonal lift off the dark
    # carcass without a ninth material for a single moulding.
    _box("DisplayCrown", (1.50, 0.45, 0.11), (0.0, 0.0, 2.045), m["walnut_inset"], carcass,
         bevel=0.024, bevel_segments=3)
    _box("DisplayPlinth", (1.46, 0.44, 0.10), (0.0, 0.0, 0.05), m["dark_walnut"], carcass, bevel=0.018)
    _box("LowerStorageCarcass", (1.30, 0.40, 0.53), (0.0, 0.01, 0.365), m["dark_walnut"], carcass,
         bevel=0.018)
    lower_fronts = []
    for index, x in enumerate((-0.325, 0.325), 1):
        lower_fronts.extend(_raised_panel(f"LowerDoor{index}", (x, -0.205, 0.37),
                                          (0.60, 0.035, 0.39), m["dark_walnut"],
                                          m["walnut_inset"], carcass))
    _join_meshes(lower_fronts, "DisplayLowerDoorSet", carcass)
    shelves = [
        _box(f"DisplayShelf{index}", (1.22, 0.34, 0.035), (0.0, 0.02, z), p["natural_oak"], interior,
             bevel=0.010, properties={"collectible_surface": True, "shelf_index": index})
        for index, z in enumerate((0.82, 1.22, 1.62), 1)
    ]
    _join_meshes(shelves, "DisplayShelfSet", interior)
    _box("InteriorLightLens", (1.02, 0.12, 0.025), (0.0, 0.06, 1.94), m["warm_light"], interior,
         bevel=0.008, properties={"emissive_fixture": True})

    left_pivot = A.pivot("DoorLeft", location=(-0.65, -0.215, 1.35), parent=root,
                         properties={"pivot_role": "left glass-door hinge", "axis": "+Z"})
    right_pivot = A.pivot("DoorRight", location=(0.65, -0.215, 1.35), parent=root,
                          properties={"pivot_role": "right glass-door hinge", "axis": "+Z"})
    _door_frame("DisplayDoorLeft", -0.325, 1.35, 0.63, 1.12, -0.217,
                m["dark_walnut"], p["glass"], left_pivot)
    _door_frame("DisplayDoorRight", 0.325, 1.35, 0.63, 1.12, -0.217,
                m["dark_walnut"], p["glass"], right_pivot)
    for index, x in enumerate((-0.055, 0.055), 1):
        A.cylinder(f"DisplayDoorPull{index}", 0.012, 0.16, (x, -0.248, 1.35),
                   p["restrained_brass"], vertices=12,
                   parent=(left_pivot if x < 0 else right_pivot), bevel=0.003,
                   properties={"moving_part": "display_door_handle"})
    # A restrained crest/inlay breaks up the large lower plinth without text or third-party marks.
    crest = A.torus("DisplayCrest", 0.072, 0.010, (0.0, -0.226, 0.36), p["restrained_brass"],
                    rotation=(math.pi / 2.0, 0.0, 0.0), major_segments=20, minor_segments=6,
                    parent=carcass, properties={"fictional_brand_motif": "pinehollow ring"})
    crest["decorative_only"] = True

    for name, loc, role in (
        ("Trophy_01", (-0.34, -0.03, 0.84), "trophy"),
        ("Trophy_02", (0.34, -0.03, 0.84), "trophy"),
        ("Plaque_01", (-0.30, 0.10, 1.24), "plaque"),
        ("Collectible_01", (0.31, 0.02, 1.64), "collectible"),
        ("InteriorLight", (0.0, 0.06, 1.94), "emissive_fixture"),
    ):
        _marker(name, root, loc, socket_role=role)
    collision = _group("DisplayCabinetCollision", root)
    A.collision_box("DisplayMainHull", (1.50, 0.42, 2.10), (0.0, 0.015, 1.05), parent=collision)
    A.collision_box("DisplayDoorLeft", (0.63, 0.035, 1.12), (-0.325, -0.217, 1.35),
                    parent=left_pivot, purpose="state-aware-door")
    A.collision_box("DisplayDoorRight", (0.63, 0.035, 1.12), (0.325, -0.217, 1.35),
                    parent=right_pivot, purpose="state-aware-door")
    closed = (0.0, 0.0, 0.0)
    left_open = (0.0, 0.0, math.radians(105.0))
    right_open = (0.0, 0.0, math.radians(-105.0))
    A.animate_transform_clip(left_pivot, "DisplayDoorLeft_Open",
                             ({"frame": 1, "rotation": closed}, {"frame": 24, "rotation": left_open}),
                             interpolation="SINE")
    A.animate_transform_clip(left_pivot, "DisplayDoorLeft_Close",
                             ({"frame": 1, "rotation": left_open}, {"frame": 24, "rotation": closed}),
                             interpolation="SINE")
    A.animate_transform_clip(right_pivot, "DisplayDoorRight_Open",
                             ({"frame": 1, "rotation": closed}, {"frame": 24, "rotation": right_open}),
                             interpolation="SINE")
    A.animate_transform_clip(right_pivot, "DisplayDoorRight_Close",
                             ({"frame": 1, "rotation": right_open}, {"frame": 24, "rotation": closed}),
                             interpolation="SINE")
    left_pivot.rotation_euler = closed
    right_pivot.rotation_euler = closed
    bpy.context.view_layer.update()
    return root


BUILDERS: dict[int, Callable[[], bpy.types.Object]] = {
    61: build_61, 62: build_62, 63: build_63, 64: build_64, 65: build_65,
    66: build_66, 67: build_67, 68: build_68, 69: build_69, 70: build_70,
}


def _parse_cli(argv: Sequence[str]) -> tuple[int | None, A.BuildOptions]:
    global UNTEXTURED
    selected: int | None = None
    forwarded: list[str] = []
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--untextured":
            UNTEXTURED = True
            A.set_cc0_enabled(False)
            index += 1
            continue
        if arg == "--asset":
            if index + 1 >= len(argv):
                raise SystemExit("--asset requires a number from 61 through 70")
            selected = int(argv[index + 1])
            index += 2
            continue
        if arg.startswith("--asset="):
            selected = int(arg.split("=", 1)[1])
            index += 1
            continue
        forwarded.append(arg)
        index += 1
    if selected is not None and selected not in BUILDERS:
        raise SystemExit(f"unsupported --asset {selected}; expected 61 through 70")
    return selected, A.parse_asset_cli(forwarded)


def main(argv: Sequence[str] | None = None) -> int:
    selected, options = _parse_cli(A.blender_cli_args(sys.argv) if argv is None else list(argv))
    numbers = [selected] if selected is not None else sorted(BUILDERS)
    results: list[dict[str, object]] = []
    for number in numbers:
        A.reset_scene(seed=options.seed + number)
        root = BUILDERS[number]()
        root["deterministic_seed"] = options.seed + number
        result = A.publish_asset(
            IDENTITIES[number], root, options=options,
            expected_dimensions=DIMENSIONS[number],
            required_sockets=REQUIRED_MARKERS[number],
            required_animations=REQUIRED_ANIMATIONS[number],
            require_collision=True,
        )
        results.append({
            "asset": number,
            "paths": result.paths.as_relative_dict(),
            "canonical_sha256": result.canonical_sha256,
            "runtime_sha256": result.runtime_sha256,
            "validation": result.validation.to_dict(),
        })
    print("SHEET07_BUILD|" + json.dumps(results, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
