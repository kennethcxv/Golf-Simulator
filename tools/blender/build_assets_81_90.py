"""Build Sheet 09 production assets (81-90) for Pinehollow Golf Flipper.

Run from Blender, for example::

    blender --background --factory-startup --python tools/blender/build_assets_81_90.py -- --asset 81
    blender --background --factory-startup --python tools/blender/build_assets_81_90.py -- --asset 87 --preview

Sheet 9 is the office and service-desk dressing: the props that make the back office
read as a room somebody works in rather than a box with a desk in it.

Conventions carried from Sheets 6-8, all of them load-bearing:

* Metres, +Z up, player-facing side on -Y.
* Coordinates passed to any builder call are **world-space**. `parent_keep_world`
  preserves a child's world transform when it is parented, so authoring a pivot's
  children as offsets from that pivot silently places them somewhere else entirely.
* Sockets are authored before the group holding them is moved, so a socket can never
  drift away from the geometry it names.
* Wall-mounted assets set `mount = "wall"` on their root and put the origin on the
  mount point. Their geometry hangs below that origin, which is correct, and the
  shared validator skips its floor check for them on that basis.

Three of these -- the corkboard, the wall clock and the key rack -- ship no collision
by contract. They are wall dressing at head height; giving them blocking hulls would
snag a player walking past a noticeboard.

Branding is Pinehollow, expressed as original geometry. The reference sheet's rendered
"Pineview" marks and its generated label and reservation text are not reproduced.
"""

from __future__ import annotations

import json
import math
import sys
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path

import bpy

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import assets_51_100_lib as A


SLUGS = {
    81: "office_chair_sheet09",
    82: "filing_cabinet_sheet09",
    83: "desk_lamp",
    84: "office_printer",
    85: "office_telephone",
    86: "corkboard_noticeboard",
    87: "wall_clock",
    88: "key_rack",
    89: "reservation_clipboard",
    90: "scorecard_holder",
}

IDENTITIES = {n: A.AssetIdentity(n, slug) for n, slug in SLUGS.items()}

# The contract figure for each asset, recorded on the root. Where it differs from the
# built extent it is because it sizes the body and not the accessories -- the lamp is
# listed as a 0.18 base with a 0.55 height and a 0.65 reach, the printer's 0.38 is the
# case without its raised feed tray -- or because it lists width/height/depth for a flat
# object, as with the clipboard, whose 0.018 is board thickness.
SPEC_CONTRACT_DIMENSIONS = {
    81: (0.65, 0.65, 1.10), 82: (0.48, 0.62, 1.32), 83: (0.18, 0.65, 0.55),
    84: (0.43, 0.38, 0.25), 85: (0.22, 0.24, 0.12), 86: (0.90, 0.05, 0.65),
    87: (0.34, 0.065, 0.34), 88: (0.75, 0.08, 0.25), 89: (0.23, 0.33, 0.018),
    90: (0.38, 0.25, 0.28),
}

# What the shipped asset actually spans, measured from the built GLBs. Width (X),
# depth (Y), height (Z), metres.
DIMENSIONS = {
    81: (0.63, 0.61, 1.09),
    82: (0.49, 0.66, 1.34),
    83: (0.23, 0.65, 0.54),
    84: (0.43, 0.48, 0.27),
    85: (0.23, 0.22, 0.11),
    86: (0.90, 0.05, 0.65),
    87: (0.34, 0.065, 0.34),
    88: (0.75, 0.06, 0.23),
    89: (0.23, 0.33, 0.03),
    90: (0.38, 0.27, 0.28),
}

BUDGETS = {
    81: (22, 14000), 82: (20, 12000), 83: (18, 9000), 84: (18, 10000),
    85: (16, 7000), 86: (12, 5000), 87: (14, 6000), 88: (16, 6000),
    89: (10, 3500), 90: (14, 6000),
}

# Wall dressing at head height must not block a player walking past it.
COLLISION_EXPECTED = {
    81: True, 82: True, 83: True, 84: True, 85: True,
    86: False, 87: False, 88: False, 89: True, 90: True,
}

MOUNTS = {
    81: "floor", 82: "floor", 83: "surface", 84: "surface", 85: "surface",
    86: "wall", 87: "wall", 88: "wall", 89: "surface", 90: "surface",
}

REQUIRED_MARKERS = {
    81: ("SOCKET_Seat", "SOCKET_DeskAlignment", "SOCKET_PLACEMENT"),
    82: ("SOCKET_Drawer_01", "SOCKET_Drawer_02", "SOCKET_Drawer_03", "SOCKET_Drawer_04",
         "SOCKET_WallPlacement", "PIVOT_Drawer_01", "SOCKET_PLACEMENT"),
    83: ("SOCKET_Desk", "PIVOT_ArmLower", "PIVOT_ArmUpper", "PIVOT_Shade",
         "SOCKET_Bulb", "SOCKET_PLACEMENT"),
    84: ("SOCKET_Desk", "SOCKET_Cable", "SOCKET_PaperInput", "SOCKET_PaperOutput",
         "SOCKET_PLACEMENT"),
    85: ("SOCKET_Desk", "SOCKET_Handset", "SOCKET_CordBase", "SOCKET_Display",
         "PIVOT_Handset", "SOCKET_PLACEMENT"),
    86: ("SOCKET_WallMount", "SOCKET_Note_01", "SOCKET_Note_02", "SOCKET_Calendar",
         "SOCKET_TaskPosting", "SOCKET_PLACEMENT"),
    87: ("SOCKET_WallMount", "PIVOT_HourHand", "PIVOT_MinuteHand", "PIVOT_SecondHand",
         "SOCKET_PLACEMENT"),
    88: ("SOCKET_WallMount", "SOCKET_Key_01", "SOCKET_Key_02", "SOCKET_Key_03",
         "SOCKET_Key_04", "SOCKET_Key_05", "SOCKET_PLACEMENT"),
    89: ("SOCKET_Desk", "SOCKET_HandGrip", "SOCKET_Paper", "SOCKET_Pen", "SOCKET_PLACEMENT"),
    90: ("SOCKET_Desk", "SOCKET_Scorecards_01", "SOCKET_Scorecards_02",
         "SOCKET_Scorecards_03", "SOCKET_Pencils", "SOCKET_PLACEMENT"),
}

REQUIRED_ANIMATIONS = {
    81: ("OfficeChair_Swivel",),
    82: ("FilingDrawer_01_Open", "FilingDrawer_01_Close"),
    83: ("DeskLamp_SwitchOn", "DeskLamp_SwitchOff"),
    84: ("OfficePrinter_Print",),
    85: ("Telephone_HandsetLift", "Telephone_HandsetReplace", "Telephone_ButtonPress"),
    86: (), 87: (), 88: (), 89: (), 90: (),
}

FORWARD = (-math.pi / 2.0, 0.0, 0.0)
DOWN = (0.0, 0.0, 0.0)


def _group(name: str, parent: bpy.types.Object, **properties: object) -> bpy.types.Object:
    clean = name if name.startswith("LOD") else "LOD0_" + name
    obj = bpy.data.objects.new(clean, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.05
    obj["lod_level"] = 0
    for key, value in properties.items():
        obj[key] = value
    A.parent_keep_world(obj, parent)
    return obj


def _root(number: int, **properties: object):
    root = A.asset_root(IDENTITIES[number], DIMENSIONS[number])
    mesh_budget, triangle_budget = BUDGETS[number]
    root["production_sheet"] = "09"
    root["authored_units"] = "meters"
    root["runtime_unit_conversion"] = "meters_to_yards_once:1.0936133"
    root["front_side"] = "player-facing side is -Y"
    root["source_lineage"] = "original deterministic Blender Python; no candidate geometry imported"
    root["license"] = "Project-owned"
    root["visual_style"] = "Pinehollow clubhouse office; walnut, olive green, brass, warm charcoal"
    root["mesh_budget"] = mesh_budget
    root["triangle_budget"] = triangle_budget
    root["lod_policy"] = "authored LOD0 with runtime room/distance gating"
    root["mount"] = MOUNTS[number]
    root["collision_expected"] = COLLISION_EXPECTED[number]
    root["spec_contract_dimensions_m"] = json.dumps(SPEC_CONTRACT_DIMENSIONS[number])
    for key, value in properties.items():
        root[key] = value
    return root, A.palette_materials()


def _materials() -> dict[str, bpy.types.Material]:
    return {
        "office_green": A.material("S09_OfficeGreen", (0.052, 0.078, 0.055, 1.0), roughness=0.52),
        "black_leather": A.material("S09_BlackLeather", (0.030, 0.029, 0.031, 1.0),
                                    roughness=0.38, coat=0.16),
        "leather_seam": A.material("S09_LeatherSeam", (0.017, 0.016, 0.018, 1.0), roughness=0.46),
        "hard_black": A.material("S09_HardBlack", (0.024, 0.025, 0.027, 1.0), roughness=0.42),
        "matte_black": A.material("S09_MatteBlack", (0.015, 0.016, 0.017, 1.0), roughness=0.70),
        "cork": A.material("S09_Cork", (0.42, 0.28, 0.135, 1.0), roughness=0.88),
        "clock_face": A.material("S09_ClockFace", (0.80, 0.76, 0.66, 1.0), roughness=0.72),
        "paper": A.material("S09_Paper", (0.78, 0.77, 0.73, 1.0), roughness=0.85),
        "lamp_shade": A.material("S09_LampShadeGreen", (0.040, 0.105, 0.062, 1.0), roughness=0.44),
        "bulb_warm": A.material("S09_BulbWarm", (0.95, 0.80, 0.52, 1.0), roughness=0.24,
                                emission_color=(1.0, 0.82, 0.50), emission_strength=2.2),
        "display_lcd": A.material("S09_PhoneDisplay", (0.30, 0.40, 0.32, 1.0), roughness=0.28),
    }


def _marker(name: str, parent: bpy.types.Object, location=(0.0, 0.0, 0.0),
            rotation=(0.0, 0.0, 0.0), **properties: object) -> bpy.types.Object:
    return A.socket(name, location=location, rotation=rotation, parent=parent, properties=properties)


def _pivot(name: str, parent: bpy.types.Object, location=(0.0, 0.0, 0.0),
           rotation=(0.0, 0.0, 0.0), **properties: object) -> bpy.types.Object:
    return A.pivot(name, location=location, rotation=rotation, parent=parent, properties=properties)


def _placement(root: bpy.types.Object, contract: str) -> None:
    _marker("PLACEMENT", root, placement_contract=contract)


def _join(objects: Iterable[bpy.types.Object], name: str,
          parent: bpy.types.Object | None = None) -> bpy.types.Object:
    meshes = [obj for obj in objects if obj is not None and obj.type == "MESH"]
    if not meshes:
        raise ValueError(f"cannot join empty mesh collection for {name}")
    final = name if name.startswith("MESH_") else "MESH_" + name
    if len(meshes) == 1:
        meshes[0].name = final
        if parent is not None:
            A.parent_keep_world(meshes[0], parent)
        return meshes[0]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = final
    if parent is not None:
        A.parent_keep_world(joined, parent)
    return joined


def _wall_frame(name: str, parent: bpy.types.Object, mat: bpy.types.Material, *,
                width: float, height: float, depth: float, rail: float,
                center_z: float, face_y: float = 0.0) -> list[bpy.types.Object]:
    """A four-piece picture frame standing in the XZ plane, facing -Y."""

    half_w, half_h = width / 2.0, height / 2.0
    return [
        A.box(f"{name}_Top", (width, depth, rail), (0.0, face_y, center_z + half_h - rail / 2.0),
              mat, parent=parent, bevel=0.004),
        A.box(f"{name}_Bottom", (width, depth, rail), (0.0, face_y, center_z - half_h + rail / 2.0),
              mat, parent=parent, bevel=0.004),
        A.box(f"{name}_Left", (rail, depth, height - rail * 2.0),
              (-half_w + rail / 2.0, face_y, center_z), mat, parent=parent, bevel=0.004),
        A.box(f"{name}_Right", (rail, depth, height - rail * 2.0),
              (half_w - rail / 2.0, face_y, center_z), mat, parent=parent, bevel=0.004),
    ]


def _pinned_notes(name: str, parent: bpy.types.Object, paper: bpy.types.Material,
                  brass: bpy.types.Material, layout: Sequence[Sequence[float]],
                  face_y: float) -> None:
    """Papers pinned to a board. Deterministic layout, no generated text on them."""

    pieces = []
    for index, (x, z, w, h, tilt) in enumerate(layout):
        pieces.append(A.box(f"{name}_Sheet{index:02d}", (w, 0.0016, h), (x, face_y, z),
                            paper, parent=parent, bevel=0.001,
                            rotation=(0.0, math.radians(tilt), 0.0)))
        pieces.append(A.cylinder(f"{name}_Pin{index:02d}", 0.0055, 0.010,
                                 (x, face_y - 0.006, z + h / 2.0 - 0.018), brass,
                                 rotation=(math.pi / 2.0, 0.0, 0.0), vertices=8,
                                 parent=parent, bevel=0.001))
    _join(pieces, f"{name}_Content", parent)


def build_81() -> bpy.types.Object:
    root, p = _root(81, furniture_role="office_seating", desk_partner=66)
    m = _materials()
    base = _group("ChairBase", root)
    seat = _group("ChairSeat", root)

    # Five-star base. Casters touch the floor, which is what stops a chair from
    # looking like it is hovering next to the desk.
    #
    # The parts are authored individually and joined once each half is finished. A chair
    # is 30-odd little boxes and cylinders, and shipping them as 30 nodes costs a matrix
    # update and a draw call apiece for detail nobody resolves from across the office.
    # Joining respects the swivel: base parts and seat parts stay in separate meshes,
    # because the seat turns and the base does not.
    base_parts, seat_parts = [], []
    caster_r = 0.026
    for index in range(5):
        angle = index * math.tau / 5.0
        reach = 0.275
        cx, cy = math.cos(angle) * reach, math.sin(angle) * reach
        base_parts.append(A.box(f"ChairStar{index}", (0.052, reach, 0.030),
                                (cx / 2.0, cy / 2.0, 0.070), m["matte_black"], parent=base,
                                bevel=0.008, rotation=(0.0, 0.0, angle - math.pi / 2.0)))
        base_parts.append(A.cylinder(f"ChairCaster{index}", caster_r, 0.020, (cx, cy, caster_r),
                                     m["matte_black"], rotation=(0.0, math.pi / 2.0, 0.0),
                                     vertices=12, parent=base, bevel=0.003))
        base_parts.append(A.cylinder(f"ChairCasterStem{index}", 0.010, 0.034,
                                     (cx, cy, caster_r + 0.028), m["hard_black"], vertices=8,
                                     parent=base, bevel=0.002))
    base_parts.append(A.cylinder("ChairColumn", 0.042, 0.230, (0.0, 0.0, 0.200), m["matte_black"],
                                 vertices=16, parent=base, bevel=0.005))
    base_parts.append(A.cylinder("ChairGasCover", 0.052, 0.110, (0.0, 0.0, 0.150), m["hard_black"],
                                 vertices=16, parent=base, bevel=0.005))
    base_parts.append(A.box("ChairMech", (0.185, 0.215, 0.055), (0.0, 0.0, 0.335),
                            m["matte_black"], parent=base, bevel=0.008))
    _join(base_parts, "ChairBaseAssembly", base)

    seat_parts.append(A.box("ChairSeatPad", (0.500, 0.480, 0.105), (0.0, 0.0, 0.415),
                            m["black_leather"], parent=seat, bevel=0.036, bevel_segments=3))
    seat_parts.append(A.box("ChairSeatWelt", (0.510, 0.490, 0.020), (0.0, 0.0, 0.368),
                            m["leather_seam"], parent=seat, bevel=0.008))
    # Backrest rakes back slightly; a vertical slab reads as a bench, not a chair.
    seat_parts.append(A.box("ChairBackLower", (0.470, 0.095, 0.330), (0.0, 0.215, 0.630),
                            m["black_leather"], parent=seat, bevel=0.032, bevel_segments=3,
                            rotation=(math.radians(-8.0), 0.0, 0.0)))
    seat_parts.append(A.box("ChairBackUpper", (0.440, 0.090, 0.230), (0.0, 0.258, 0.925),
                            m["black_leather"], parent=seat, bevel=0.036, bevel_segments=3,
                            rotation=(math.radians(-8.0), 0.0, 0.0)))
    seat_parts.append(A.box("ChairHeadRoll", (0.420, 0.100, 0.070), (0.0, 0.272, 1.055),
                            m["black_leather"], parent=seat, bevel=0.030, bevel_segments=3,
                            rotation=(math.radians(-8.0), 0.0, 0.0)))
    # Shallow tufting, as the reference shows, without modelling every button.
    for col in range(3):
        for row in range(2):
            seat_parts.append(A.sphere(f"ChairTuft_{col}{row}", 0.014,
                                       (-0.130 + col * 0.130, 0.168 - row * 0.006,
                                        0.560 + row * 0.145),
                                       m["leather_seam"], segments=10, parent=seat))
    for side, sx in (("L", -1.0), ("R", 1.0)):
        seat_parts.append(A.box(f"ChairArmPad{side}", (0.060, 0.290, 0.040),
                                (sx * 0.283, 0.010, 0.595), p["medium_walnut"], parent=seat,
                                bevel=0.016, bevel_segments=3))
        seat_parts.append(A.box(f"ChairArmPost{side}", (0.032, 0.048, 0.180),
                                (sx * 0.268, 0.075, 0.490), m["matte_black"], parent=seat,
                                bevel=0.008))
    _join(seat_parts, "ChairSeatAssembly", seat)

    _marker("Seat", root, (0.0, -0.020, 0.470), rotation=FORWARD, seat_role="office")
    _marker("DeskAlignment", root, (0.0, -0.330, 0.415), rotation=FORWARD,
            aligns_with_asset=66, exit_route_clear=True)
    _placement(root, "origin centered between the casters on the floor; seat faces -Y")

    collision = _group("ChairCollision", root)
    A.collision_cylinder("ChairBaseHull", 0.300, 0.075, (0.0, 0.0, 0.040), parent=collision)
    A.collision_box("ChairSeatHull", (0.52, 0.50, 0.30), (0.0, 0.010, 0.470), parent=collision)
    A.collision_box("ChairBackHull", (0.47, 0.14, 0.62), (0.0, 0.235, 0.790), parent=collision)

    # The seat turns on the column; the base and casters stay put. The swivel has to own
    # the seat for the clip to move anything -- animating an empty group is a clip that
    # plays perfectly and does nothing, which no test would catch.
    swivel = _pivot("Swivel", root, (0.0, 0.0, 0.335),
                    moving_part="chair_swivel", rotation_axis="+Z")
    A.parent_keep_world(seat, swivel)
    A.animate_transform_clip(swivel, "OfficeChair_Swivel",
                             ({"frame": 1, "rotation": (0.0, 0.0, 0.0)},
                              {"frame": 30, "rotation": (0.0, 0.0, math.radians(26.0))},
                              {"frame": 60, "rotation": (0.0, 0.0, 0.0)}), interpolation="SINE")
    swivel.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    return root


def build_82() -> bpy.types.Object:
    root, p = _root(82, furniture_role="office_storage")
    m = _materials()
    shell = _group("CabinetShell", root)

    # The carcass stops at the plinth top (0.0555, 1 mm overlapped) instead of running to
    # the floor: at full height it swallowed the recessed black plinth entirely and the
    # authored shadow-gap reveal never existed on screen. Same box, same twelve
    # triangles, shorter.
    A.box("CabinetCarcass", (0.480, 0.620, 1.2655), (0.0, 0.0, 0.68725), m["office_green"],
          parent=shell, bevel=0.008)
    A.box("CabinetPlinth", (0.462, 0.600, 0.055), (0.0, 0.0, 0.028), m["matte_black"],
          parent=shell, bevel=0.006)
    A.box("CabinetTopCap", (0.492, 0.632, 0.016), (0.0, 0.0, 1.328), m["office_green"],
          parent=shell, bevel=0.005)

    # Four drawer faces. Only the top one animates by contract, so it gets a real pivot
    # and the rest are part of the static shell -- three more animated boxes would be
    # three more things to keep in sync for no gameplay gain.
    drawer_h = 0.290
    fronts = []
    for index in range(4):
        z = 0.115 + drawer_h / 2.0 + index * (drawer_h + 0.018)
        if index == 3:
            top_z = z
            continue
        fronts.append(A.box(f"CabinetFace_{index}", (0.452, 0.020, drawer_h),
                            (0.0, -0.311, z), m["office_green"], parent=shell, bevel=0.006))
        fronts.append(A.box(f"CabinetPull_{index}", (0.150, 0.024, 0.030),
                            (0.0, -0.328, z + 0.075), m["matte_black"], parent=shell, bevel=0.007))
        fronts.append(A.box(f"CabinetLabel_{index}", (0.086, 0.010, 0.030),
                            (0.0, -0.324, z - 0.070), m["matte_black"], parent=shell, bevel=0.004))
    _join(fronts, "CabinetLowerDrawers", shell)

    drawer = _pivot("Drawer_01", root, (0.0, -0.311, top_z),
                    moving_part="filing_drawer", slide_axis="-Y")
    A.box("CabinetTopFace", (0.452, 0.020, drawer_h), (0.0, -0.311, top_z),
          m["office_green"], parent=drawer, bevel=0.006)
    A.box("CabinetTopPull", (0.150, 0.024, 0.030), (0.0, -0.328, top_z + 0.075),
          m["matte_black"], parent=drawer, bevel=0.007)
    A.box("CabinetTopLabel", (0.086, 0.010, 0.030), (0.0, -0.324, top_z - 0.070),
          m["matte_black"], parent=drawer, bevel=0.004)
    A.box("CabinetTopBox", (0.430, 0.560, 0.255), (0.0, -0.020, top_z),
          m["matte_black"], parent=drawer, bevel=0.005)

    for index in range(4):
        z = 0.115 + drawer_h / 2.0 + index * (drawer_h + 0.018)
        _marker(f"Drawer_{index + 1:02d}", root, (0.0, -0.180, z), rotation=FORWARD,
                drawer_index=index + 1, animated=(index == 3))
    _marker("WallPlacement", root, (0.0, 0.315, 0.660), rotation=(math.pi / 2.0, 0.0, 0.0),
            backs_onto="wall")
    _placement(root, "origin centered on floor contact; drawer faces are -Y")

    collision = _group("CabinetCollision", root)
    A.collision_box("CabinetHull", (0.49, 0.63, 1.33), (0.0, 0.0, 0.665), parent=collision)

    # The pivot carries its own authored position, so the slide is animated relative to
    # it. Keyframing an absolute (0, 0, 0) drags the drawer, its face and its box down to
    # the asset origin -- which is what the first build of this cabinet did, and why it
    # measured 1.48 m tall with geometry 14 cm below the floor.
    closed = tuple(drawer.location)
    opened = (closed[0], closed[1] - 0.430, closed[2])
    A.animate_transform_clip(drawer, "FilingDrawer_01_Open",
                             ({"frame": 1, "location": closed}, {"frame": 16, "location": opened}),
                             interpolation="SINE")
    A.animate_transform_clip(drawer, "FilingDrawer_01_Close",
                             ({"frame": 1, "location": opened}, {"frame": 16, "location": closed}),
                             interpolation="SINE")
    drawer.location = closed
    bpy.context.view_layer.update()
    return root


def build_83() -> bpy.types.Object:
    root, p = _root(83, prop_role="task_light", restrained_illumination=True)
    m = _materials()
    body = _group("LampBody", root)

    A.cylinder("LampBase", 0.090, 0.028, (0.0, 0.0, 0.014), p["restrained_brass"],
               vertices=24, parent=body, bevel=0.005)
    A.cylinder("LampBaseCrown", 0.062, 0.022, (0.0, 0.0, 0.037), p["restrained_brass"],
               vertices=20, parent=body, bevel=0.004)
    # A small switch on the base, which is what the on/off clips actually move. It gets a
    # pivot at the knob rather than a group at the asset origin, so it turns on its own
    # axis instead of swinging a 6 cm arc around the lamp base.
    switch = _pivot("Switch", root, (0.062, -0.045, 0.040),
                    moving_part="lamp_switch", rotation_axis="+Y")
    A.cylinder("LampSwitchKnob", 0.011, 0.014, (0.062, -0.045, 0.040), m["matte_black"],
               vertices=10, parent=switch, bevel=0.002)

    # The arms reach up and forward to put the shade over the desk. Both segments lean
    # toward -Y; a lower arm that leans back and an upper that leans forward reads as a
    # zigzag rather than a task lamp.
    # A cylinder with rotation_euler.x = t points its length along (0, -sin t, cos t) --
    # verified in Blender, not assumed. Deriving each joint from that one function keeps
    # the chain connected; computing endpoints with the opposite sign, which is what this
    # did first, left the shade and upper arm floating a hand's width off the elbow.
    def segment(name, radius, length, start, tilt, parent_obj):
        dy, dz = -math.sin(tilt), math.cos(tilt)
        centre = (start[0], start[1] + dy * length / 2.0, start[2] + dz * length / 2.0)
        A.cylinder(name, radius, length, centre, p["restrained_brass"],
                   rotation=(tilt, 0.0, 0.0), vertices=12, parent=parent_obj, bevel=0.002)
        return (start[0], start[1] + dy * length, start[2] + dz * length)

    shoulder = (0.0, 0.0, 0.052)
    lower = _pivot("ArmLower", root, shoulder, moving_part="lamp_arm", rotation_axis="+X")
    elbow = segment("LampArmLower", 0.011, 0.360, shoulder, math.radians(20.0), lower)
    A.sphere("LampElbow", 0.018, elbow, p["restrained_brass"], segments=14, parent=lower)

    upper = _pivot("ArmUpper", lower, elbow, moving_part="lamp_arm", rotation_axis="+X")
    head = segment("LampArmUpper", 0.010, 0.280, elbow, math.radians(62.0), upper)

    shade = _pivot("Shade", upper, head, moving_part="lamp_shade", rotation_axis="+X")
    A.sphere("LampShadeJoint", 0.016, head, p["restrained_brass"], segments=12, parent=shade)
    # Conical shade, open end down: a task lamp throws light at the desk, not the room.
    A.profile_prism(
        "LampShadeWall",
        ((-0.115, head[2] - 0.075), (0.115, head[2] - 0.075),
         (0.052, head[2] - 0.008), (-0.052, head[2] - 0.008)),
        0.230, (0.0, head[1] - 0.075, 0.0), m["lamp_shade"],
        rotation=(0.0, 0.0, math.pi / 2.0), parent=shade, bevel=0.004,
    )
    A.cylinder("LampBulb", 0.024, 0.046, (0.0, head[1] - 0.075, head[2] - 0.052),
               m["bulb_warm"], vertices=14, parent=shade, bevel=0.004)

    _marker("Desk", root, (0.0, 0.0, 0.0), rotation=DOWN, sits_on_asset=66)
    _marker("Bulb", shade, (0.0, head[1] - 0.075, head[2] - 0.052), rotation=DOWN,
            light_anchor=True, restrained_intensity=True)
    _placement(root, "origin centered on the weighted base; light throws toward -Y")

    collision = _group("LampCollision", root)
    A.collision_cylinder("LampBaseHull", 0.092, 0.060, (0.0, 0.0, 0.030), parent=collision)

    off, on = (0.0, 0.0, 0.0), (0.0, math.radians(38.0), 0.0)
    A.animate_transform_clip(switch, "DeskLamp_SwitchOn",
                             ({"frame": 1, "rotation": off}, {"frame": 5, "rotation": on}),
                             interpolation="SINE")
    A.animate_transform_clip(switch, "DeskLamp_SwitchOff",
                             ({"frame": 1, "rotation": on}, {"frame": 5, "rotation": off}),
                             interpolation="SINE")
    switch.rotation_euler = off
    bpy.context.view_layer.update()
    return root


def build_84() -> bpy.types.Object:
    root, p = _root(84, prop_role="office_printer")
    m = _materials()
    body = _group("PrinterBody", root)

    A.box("PrinterCase", (0.430, 0.380, 0.185), (0.0, 0.0, 0.093), m["matte_black"],
          parent=body, bevel=0.012, bevel_segments=2)
    A.box("PrinterScannerLid", (0.430, 0.380, 0.048), (0.0, 0.0, 0.209), m["hard_black"],
          parent=body, bevel=0.010, bevel_segments=2)
    A.box("PrinterFeedTray", (0.300, 0.070, 0.030), (0.0, 0.190, 0.238), m["hard_black"],
          parent=body, bevel=0.006, rotation=(math.radians(28.0), 0.0, 0.0))
    # Output slot: a recess rather than a painted line, so it reads at desk distance.
    A.box("PrinterOutputRecess", (0.330, 0.030, 0.052), (0.0, -0.176, 0.126),
          m["hard_black"], parent=body, bevel=0.005)
    A.box("PrinterOutputLip", (0.320, 0.085, 0.014), (0.0, -0.215, 0.108),
          m["hard_black"], parent=body, bevel=0.005, rotation=(math.radians(-9.0), 0.0, 0.0))
    A.box("PrinterPaperDrawer", (0.400, 0.026, 0.055), (0.0, -0.196, 0.040),
          m["hard_black"], parent=body, bevel=0.006)
    A.box("PrinterControlPanel", (0.135, 0.090, 0.014), (-0.135, -0.130, 0.222),
          m["hard_black"], parent=body, bevel=0.005, rotation=(math.radians(-12.0), 0.0, 0.0))
    A.box("PrinterDisplay", (0.070, 0.044, 0.004), (-0.135, -0.136, 0.230),
          m["display_lcd"], parent=body, bevel=0.002, rotation=(math.radians(-12.0), 0.0, 0.0))

    # The sheet the print clip drives out of the slot.
    paper = _group("PrinterPaper", root)
    A.box("PrinterSheet", (0.210, 0.150, 0.0018), (0.0, -0.150, 0.118), m["paper"],
          parent=paper, bevel=0.001)

    _marker("Desk", root, (0.0, 0.0, 0.0), rotation=DOWN, sits_on="desk_or_counter")
    _marker("Cable", root, (0.170, 0.190, 0.030), rotation=(math.pi / 2.0, 0.0, 0.0), port="power_data")
    _marker("PaperInput", root, (0.0, 0.205, 0.250), rotation=DOWN)
    _marker("PaperOutput", root, (0.0, -0.205, 0.115), rotation=FORWARD, output_anchor=True)
    _placement(root, "origin centered on the printer footprint; output faces -Y")

    collision = _group("PrinterCollision", root)
    A.collision_box("PrinterHull", (0.44, 0.40, 0.25), (0.0, 0.0, 0.125), parent=collision)

    A.animate_transform_clip(paper, "OfficePrinter_Print",
                             ({"frame": 1, "location": (0.0, 0.075, 0.0)},
                              {"frame": 26, "location": (0.0, -0.062, 0.0)}),
                             interpolation="SINE")
    paper.location = (0.0, 0.075, 0.0)
    bpy.context.view_layer.update()
    return root


def build_85() -> bpy.types.Object:
    root, p = _root(85, prop_role="office_telephone")
    m = _materials()
    body = _group("PhoneBody", root)

    # Wedge base: taller at the back, as a desk phone is.
    A.profile_prism(
        "PhoneBase",
        ((-0.110, 0.004), (0.110, 0.004), (0.110, 0.052), (-0.110, 0.088)),
        0.220, (0.0, 0.0, 0.0), m["matte_black"], rotation=(0.0, 0.0, math.pi / 2.0),
        parent=body, bevel=0.005,
    )
    A.box("PhoneFoot", (0.205, 0.215, 0.008), (0.0, 0.0, 0.005), m["hard_black"],
          parent=body, bevel=0.003)
    keys = []
    for row in range(4):
        for col in range(3):
            keys.append(A.box(f"PhoneKey_{row}{col}", (0.019, 0.014, 0.005),
                              (-0.026 + col * 0.026, -0.028 + row * 0.021,
                               0.049 - row * 0.0035), m["hard_black"],
                              parent=body, bevel=0.001))
    for index in range(6):
        keys.append(A.box(f"PhoneSideKey_{index}", (0.014, 0.011, 0.005),
                          (0.066, -0.030 + index * 0.020, 0.048 - index * 0.002),
                          m["hard_black"], parent=body, bevel=0.001))
    _join(keys, "PhoneKeypad", body)
    A.box("PhoneDisplay", (0.070, 0.038, 0.004), (-0.030, 0.058, 0.070), m["display_lcd"],
          parent=body, bevel=0.002, rotation=(math.radians(-18.0), 0.0, 0.0))
    A.box("PhoneCradleL", (0.026, 0.070, 0.014), (-0.078, 0.010, 0.062), m["hard_black"],
          parent=body, bevel=0.004)
    A.box("PhoneCradleR", (0.026, 0.070, 0.014), (0.030, 0.010, 0.062), m["hard_black"],
          parent=body, bevel=0.004)
    # Coiled cord, four turns: visual only, no cable simulation by contract.
    for index in range(4):
        A.torus(f"PhoneCord_{index}", 0.020, 0.0035, (-0.115, 0.030 + index * 0.014, 0.030),
                m["hard_black"], rotation=(0.0, math.pi / 2.0, 0.0),
                major_segments=14, minor_segments=5, parent=body)

    handset = _pivot("Handset", root, (-0.024, 0.010, 0.072),
                     moving_part="phone_handset", rotation_axis="+Y")
    A.box("PhoneHandsetBar", (0.038, 0.180, 0.030), (-0.024, 0.010, 0.082),
          m["matte_black"], parent=handset, bevel=0.012, bevel_segments=2)
    A.box("PhoneHandsetEarpiece", (0.048, 0.052, 0.036), (-0.024, 0.078, 0.088),
          m["matte_black"], parent=handset, bevel=0.014, bevel_segments=2)
    A.box("PhoneHandsetMouthpiece", (0.048, 0.052, 0.036), (-0.024, -0.058, 0.088),
          m["matte_black"], parent=handset, bevel=0.014, bevel_segments=2)

    button = _group("PhoneButton", root)
    A.box("PhoneSpeakerKey", (0.021, 0.016, 0.006), (0.030, -0.052, 0.052),
          m["hard_black"], parent=button, bevel=0.002)

    _marker("Desk", root, (0.0, 0.0, 0.0), rotation=DOWN, sits_on="desk_or_counter")
    _marker("Handset", handset, (-0.024, 0.010, 0.092), rotation=DOWN)
    _marker("CordBase", root, (-0.115, 0.052, 0.030), rotation=(0.0, math.pi / 2.0, 0.0))
    _marker("Display", root, (-0.030, 0.058, 0.074), rotation=FORWARD)
    _placement(root, "origin centered on the phone footprint; keypad faces -Y")

    collision = _group("PhoneCollision", root)
    A.collision_box("PhoneHull", (0.22, 0.24, 0.12), (0.0, 0.0, 0.060), parent=collision)

    # Relative to the pivot's authored seat in the cradle, not to the asset origin.
    down = tuple(handset.location)
    up = (down[0], down[1], down[2] + 0.062)
    A.animate_transform_clip(handset, "Telephone_HandsetLift",
                             ({"frame": 1, "location": down},
                              {"frame": 10, "location": up,
                               "rotation": (math.radians(6.0), 0.0, 0.0)}), interpolation="SINE")
    A.animate_transform_clip(handset, "Telephone_HandsetReplace",
                             ({"frame": 1, "location": up,
                               "rotation": (math.radians(6.0), 0.0, 0.0)},
                              {"frame": 10, "location": down, "rotation": (0.0, 0.0, 0.0)}),
                             interpolation="SINE")
    A.animate_transform_clip(button, "Telephone_ButtonPress",
                             ({"frame": 1, "location": (0.0, 0.0, 0.0)},
                              {"frame": 3, "location": (0.0, 0.0, -0.0035)},
                              {"frame": 8, "location": (0.0, 0.0, 0.0)}), interpolation="SINE")
    handset.location = down
    handset.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    return root


def build_86() -> bpy.types.Object:
    root, p = _root(86, prop_role="office_noticeboard", content_driven=True)
    m = _materials()
    board = _group("CorkBoard", root)

    A.box("CorkPanel", (0.836, 0.022, 0.586), (0.0, -0.016, -0.325), m["cork"],
          parent=board, bevel=0.003)
    _wall_frame("CorkFrame", board, p["medium_walnut"], width=0.900, height=0.650,
                depth=0.044, rail=0.036, center_z=-0.325, face_y=-0.012)
    _pinned_notes("CorkNote", board, m["paper"], p["restrained_brass"], (
        (-0.255, -0.180, 0.150, 0.190, 2.5),
        (-0.060, -0.215, 0.130, 0.165, -3.0),
        (0.150, -0.170, 0.145, 0.200, 1.5),
        (0.290, -0.330, 0.130, 0.150, -2.0),
        (-0.250, -0.450, 0.160, 0.130, 1.0),
        (0.050, -0.470, 0.185, 0.130, -1.5),
    ), face_y=-0.029)

    _marker("WallMount", root, (0.0, 0.0, 0.0), rotation=(math.pi / 2.0, 0.0, 0.0),
            mount_surface="wall", hangs_below_origin=True)
    _marker("Note_01", root, (-0.255, -0.032, -0.180), rotation=FORWARD)
    _marker("Note_02", root, (0.150, -0.032, -0.170), rotation=FORWARD)
    _marker("Calendar", root, (0.290, -0.032, -0.330), rotation=FORWARD)
    _marker("TaskPosting", root, (-0.060, -0.032, -0.215), rotation=FORWARD)
    _placement(root, "origin on the wall mount point; board hangs below, face toward -Y")
    return root


def build_87() -> bpy.types.Object:
    root, p = _root(87, prop_role="wall_clock", driven_by="shared simulation clock")
    m = _materials()
    body = _group("ClockBody", root)

    # The case and bezel are solid cylinders, not rings, so whichever of these discs sits
    # furthest along -Y is the whole clock: at the original depths the bezel's front cap
    # stood 8 mm in front of the dial and the shipped asset rendered as a blank walnut
    # dome. The face must stay the frontmost opaque disc; case and bezel sit behind it,
    # with the bezel's 22 mm annulus reading as the rim around the dial.
    A.cylinder("ClockCase", 0.170, 0.052, (0.0, -0.020, -0.170), p["medium_walnut"],
               rotation=(math.pi / 2.0, 0.0, 0.0), vertices=40, parent=body, bevel=0.006)
    A.cylinder("ClockBezel", 0.172, 0.014, (0.0, -0.040, -0.170), p["medium_walnut"],
               rotation=(math.pi / 2.0, 0.0, 0.0), vertices=40, parent=body, bevel=0.004)
    A.cylinder("ClockFace", 0.150, 0.006, (0.0, -0.046, -0.170), m["clock_face"],
               rotation=(math.pi / 2.0, 0.0, 0.0), vertices=36, parent=body, bevel=0.002)
    A.cylinder("ClockGlass", 0.152, 0.004, (0.0, -0.052, -0.170), p["glass"],
               rotation=(math.pi / 2.0, 0.0, 0.0), vertices=36, parent=body, bevel=0.001)
    # Twelve markers rather than numerals: legible at distance and no generated text.
    ticks = []
    for index in range(12):
        angle = index * math.tau / 12.0
        major = index % 3 == 0
        radius = 0.126
        ticks.append(A.box(f"ClockTick_{index:02d}",
                           (0.011 if major else 0.006, 0.004, 0.030 if major else 0.018),
                           (math.sin(angle) * radius, -0.050,
                            -0.170 + math.cos(angle) * radius),
                           m["matte_black"], parent=body, bevel=0.001,
                           rotation=(0.0, -angle, 0.0)))
    _join(ticks, "ClockDial", body)
    A.cylinder("ClockBoss", 0.010, 0.014, (0.0, -0.055, -0.170), m["matte_black"],
               rotation=(math.pi / 2.0, 0.0, 0.0), vertices=12, parent=body, bevel=0.002)

    # Hands rotate about Y: the face stands in the XZ plane looking down -Y. Each hand is
    # authored pointing at twelve so the runtime can set an absolute angle from game time
    # rather than an offset from wherever the hand happened to be modelled.
    hour = _pivot("HourHand", root, (0.0, -0.056, -0.170),
                  moving_part="clock_hand", rotation_axis="+Y", points_at="12 at zero rotation")
    A.box("ClockHourHand", (0.014, 0.005, 0.088), (0.0, -0.056, -0.126), m["matte_black"],
          parent=hour, bevel=0.002)
    minute = _pivot("MinuteHand", root, (0.0, -0.060, -0.170),
                    moving_part="clock_hand", rotation_axis="+Y", points_at="12 at zero rotation")
    A.box("ClockMinuteHand", (0.010, 0.005, 0.126), (0.0, -0.060, -0.107), m["matte_black"],
          parent=minute, bevel=0.002)
    second = _pivot("SecondHand", root, (0.0, -0.063, -0.170),
                    moving_part="clock_hand", rotation_axis="+Y", points_at="12 at zero rotation")
    A.box("ClockSecondHand", (0.004, 0.004, 0.138), (0.0, -0.063, -0.101), p["restrained_brass"],
          parent=second, bevel=0.001)

    _marker("WallMount", root, (0.0, 0.0, 0.0), rotation=(math.pi / 2.0, 0.0, 0.0),
            mount_surface="wall", hangs_below_origin=True)
    _placement(root, "origin on the wall mount point; dial centre 0.17m below, facing -Y")
    return root


def build_88() -> bpy.types.Object:
    root, p = _root(88, prop_role="key_rack")
    m = _materials()
    board = _group("KeyRackBoard", root)

    A.box("KeyRackPanel", (0.750, 0.022, 0.190), (0.0, -0.011, -0.125),
          p["medium_walnut"], parent=board, bevel=0.006)
    A.box("KeyRackCrown", (0.750, 0.030, 0.048), (0.0, -0.015, -0.024),
          p["medium_walnut"], parent=board, bevel=0.008)
    # A routed nameplate recess stands in for a wordmark; no generated text ships.
    A.box("KeyRackPlate", (0.300, 0.008, 0.030), (0.0, -0.032, -0.026),
          p["restrained_brass"], parent=board, bevel=0.003,
          properties={"fictional_brand_motif": "pinehollow plate", "decorative_only": True})

    hooks, tags = [], []
    for index in range(5):
        x = -0.280 + index * 0.140
        hooks.append(A.cylinder(f"KeyHookPost_{index}", 0.005, 0.030, (x, -0.030, -0.128),
                                p["restrained_brass"], rotation=(math.pi / 2.0, 0.0, 0.0),
                                vertices=8, parent=board, bevel=0.001))
        hooks.append(A.torus(f"KeyHookCurl_{index}", 0.009, 0.0035, (x, -0.044, -0.136),
                             p["restrained_brass"], rotation=(0.0, math.pi / 2.0, 0.0),
                             major_segments=12, minor_segments=5, parent=board))
        # Fob and key hanging from each hook.
        tags.append(A.box(f"KeyFob_{index}", (0.026, 0.005, 0.042), (x, -0.044, -0.172),
                          m["matte_black"], parent=board, bevel=0.004))
        tags.append(A.box(f"KeyBlade_{index}", (0.009, 0.003, 0.036), (x, -0.044, -0.210),
                          p["restrained_brass"], parent=board, bevel=0.001))
    _join(hooks, "KeyRackHooks", board)
    _join(tags, "KeyRackKeys", board)

    _marker("WallMount", root, (0.0, 0.0, 0.0), rotation=(math.pi / 2.0, 0.0, 0.0),
            mount_surface="wall", hangs_below_origin=True)
    for index in range(5):
        _marker(f"Key_{index + 1:02d}", root, (-0.280 + index * 0.140, -0.046, -0.150),
                rotation=FORWARD, key_slot=index + 1)
    _placement(root, "origin on the wall mount point; hooks hang below, facing -Y")
    return root


def build_89() -> bpy.types.Object:
    root, p = _root(89, prop_role="reservation_clipboard")
    m = _materials()
    board = _group("Clipboard", root)

    # Lying flat, as it does on the front desk: 0.23 across, 0.33 front-to-back, 8 mm
    # thick. The contract lists this one as width/height/depth, so its "depth" is the
    # board's thickness rather than the space it occupies on the counter.
    A.box("ClipboardPanel", (0.230, 0.330, 0.008), (0.0, 0.0, 0.004), p["medium_walnut"],
          parent=board, bevel=0.004)
    A.box("ClipboardSheet", (0.205, 0.290, 0.0016), (0.0, -0.012, 0.009), m["paper"],
          parent=board, bevel=0.001)
    # Ruled lines as shallow geometry: a reservation sheet reads as a schedule without
    # printing fictional names into a texture.
    rules = []
    for index in range(8):
        rules.append(A.box(f"ClipboardRule_{index}", (0.180, 0.0012, 0.0008),
                           (0.0, -0.085 + index * 0.030, 0.0104), m["matte_black"],
                           parent=board, bevel=0.0002))
    _join(rules, "ClipboardRuling", board)
    A.box("ClipboardClipBase", (0.090, 0.036, 0.010), (0.0, 0.148, 0.014),
          p["brushed_steel"], parent=board, bevel=0.004)
    A.box("ClipboardClipArm", (0.078, 0.030, 0.006), (0.0, 0.140, 0.021),
          p["brushed_steel"], parent=board, bevel=0.003, rotation=(math.radians(-14.0), 0.0, 0.0))
    A.cylinder("ClipboardPen", 0.006, 0.130, (0.088, -0.030, 0.016), m["matte_black"],
               rotation=(math.pi / 2.0, 0.0, 0.0), vertices=10, parent=board, bevel=0.002)

    _marker("Desk", root, (0.0, 0.0, 0.0), rotation=DOWN, lies_on="desk")
    _marker("HandGrip", root, (0.0, 0.120, 0.022), rotation=FORWARD, hand="left")
    _marker("Paper", root, (0.0, -0.012, 0.010), rotation=DOWN, content_anchor=True)
    _marker("Pen", root, (0.088, -0.030, 0.022), rotation=DOWN)
    _placement(root, "origin centered under the board lying flat; clip toward +Y")

    collision = _group("ClipboardCollision", root)
    A.collision_box("ClipboardHull", (0.24, 0.34, 0.025), (0.0, 0.0, 0.012), parent=collision)
    return root


def build_90() -> bpy.types.Object:
    root, p = _root(90, prop_role="scorecard_holder")
    m = _materials()
    body = _group("HolderBody", root)

    A.box("HolderBase", (0.380, 0.250, 0.020), (0.0, 0.0, 0.010), p["medium_walnut"],
          parent=body, bevel=0.004)
    A.box("HolderBack", (0.380, 0.018, 0.270), (0.0, 0.116, 0.135), p["medium_walnut"],
          parent=body, bevel=0.005)
    for side, sx in (("L", -1.0), ("R", 1.0)):
        # Sloped side panels: tall at the back, low at the front, as the reference shows.
        A.profile_prism(
            f"HolderSide{side}",
            ((-0.125, 0.020), (0.125, 0.020), (0.125, 0.270), (-0.125, 0.120)),
            0.016, (sx * 0.182, 0.0, 0.0), p["medium_walnut"],
            rotation=(0.0, 0.0, math.pi / 2.0), parent=body, bevel=0.004,
        )
    dividers, cards = [], []
    for index in range(4):
        x = -0.187 + (index + 1) * 0.0748
        dividers.append(A.box(f"HolderDivider_{index}", (0.012, 0.230, 0.170),
                              (x, 0.006, 0.100), p["medium_walnut"], parent=body, bevel=0.004,
                              rotation=(math.radians(-11.0), 0.0, 0.0)))
    _join(dividers, "HolderDividers", body)
    for slot in range(3):
        x = -0.150 + slot * 0.0748
        cards.append(A.box(f"HolderCards_{slot}", (0.058, 0.190, 0.052),
                           (x, 0.010, 0.104), m["paper"], parent=body, bevel=0.003,
                           rotation=(math.radians(-11.0), 0.0, 0.0)))
    _join(cards, "HolderScorecards", body)
    pencils = []
    for index in range(6):
        pencils.append(A.cylinder(f"HolderPencil_{index}", 0.0042, 0.115,
                                  (0.135 + (index % 3) * 0.012, -0.010 + (index // 3) * 0.016, 0.078),
                                  p["natural_oak"], rotation=(math.radians(-11.0), 0.0, 0.0),
                                  vertices=8, parent=body, bevel=0.001))
    _join(pencils, "HolderPencils", body)
    A.torus("HolderCrest", 0.030, 0.005, (0.0, -0.126, 0.075), p["restrained_brass"],
            rotation=(math.pi / 2.0, 0.0, 0.0), major_segments=18, minor_segments=6,
            parent=body, properties={"fictional_brand_motif": "pinehollow ring",
                                     "decorative_only": True})

    _marker("Desk", root, (0.0, 0.0, 0.0), rotation=DOWN, sits_on="desk_or_counter")
    for slot in range(3):
        _marker(f"Scorecards_{slot + 1:02d}", root, (-0.150 + slot * 0.0748, 0.010, 0.135),
                rotation=DOWN, stack_slot=slot + 1)
    _marker("Pencils", root, (0.147, 0.000, 0.140), rotation=DOWN)
    _placement(root, "origin centered on the holder footprint; open slots face -Y")

    collision = _group("HolderCollision", root)
    A.collision_box("HolderHull", (0.39, 0.26, 0.28), (0.0, 0.0, 0.140), parent=collision)
    return root


BUILDERS: dict[int, Callable[[], bpy.types.Object]] = {
    81: build_81, 82: build_82, 83: build_83, 84: build_84, 85: build_85,
    86: build_86, 87: build_87, 88: build_88, 89: build_89, 90: build_90,
}


def _parse_cli(argv: Sequence[str]) -> tuple[int | None, A.BuildOptions]:
    selected: int | None = None
    forwarded: list[str] = []
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--asset":
            if index + 1 >= len(argv):
                raise SystemExit("--asset requires a number from 81 through 90")
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
        raise SystemExit(f"unsupported --asset {selected}; expected 81 through 90")
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
            require_collision=COLLISION_EXPECTED[number],
        )
        results.append({
            "asset": number,
            "paths": result.paths.as_relative_dict(),
            "canonical_sha256": result.canonical_sha256,
            "runtime_sha256": result.runtime_sha256,
            "validation": result.validation.to_dict(),
        })
    print("SHEET09_BUILD|" + json.dumps(results, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
