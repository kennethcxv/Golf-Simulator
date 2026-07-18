"""Build Sheet 10 production assets (91-100) for Pinehollow Golf Flipper.

Run from Blender, for example::

    blender --background --factory-startup --python tools/blender/build_assets_91_100.py -- --asset 91
    blender --background --factory-startup --python tools/blender/build_assets_91_100.py -- --asset 94 --preview

Sheet 10 is safety, signage and utilities -- the fixtures that make a clubhouse read as
a building people are allowed into. Most of it hangs on a wall or a ceiling and most of
it must not be solid: five of the ten ship no collision by contract, because an
extinguisher sign or a camera that blocks a doorway is worse than no camera at all.

Conventions carried from Sheets 6-9:

* Metres, +Z up, player-facing side on -Y.
* Coordinates are world-space. `parent_keep_world` preserves a child's world transform
  when parenting, so a pivot's children are authored where they actually are, not as
  offsets from the pivot.
* Animation clips are keyed relative to a pivot's authored position, never to an
  absolute origin -- doing the latter silently drags the moving part to the asset root.
* Sockets are authored before the group holding them moves.
* Wall and ceiling fixtures set `mount` on their root and put the origin on the mount
  point, so their geometry hangs below it. `collision_expected` records whether shipping
  no collision is the design or a defect. Both the shared validator and the reimport
  verifier read these rather than assuming a floor-standing solid.

The only text that ships on this sheet is EXIT, on asset 94, built from box strokes
rather than a font so it cannot depend on what Blender happens to have installed. It is
a generic safety legend, not a mark. Everything else uses original Pinehollow geometry;
the reference sheet's rendered "Pineview" wordmarks and its generated label copy are not
reproduced.
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
    91: "fire_extinguisher",
    92: "first_aid_kit_cabinet",
    93: "security_camera",
    94: "exit_sign",
    95: "emergency_light",
    96: "bulletin_board",
    97: "key_cabinet",
    98: "hand_sanitizer_station",
    99: "umbrella_stand",
    100: "floor_mat_welcome_mat",
}

IDENTITIES = {n: A.AssetIdentity(n, slug) for n, slug in SLUGS.items()}

SPEC_CONTRACT_DIMENSIONS = {
    91: (0.16, 0.34, 0.55), 92: (0.42, 0.16, 0.55), 93: (0.18, 0.18, 0.13),
    94: (0.48, 0.085, 0.22), 95: (0.42, 0.13, 0.24), 96: (0.95, 0.055, 0.70),
    97: (0.48, 0.16, 0.65), 98: (0.13, 0.12, 0.31), 99: (0.34, 0.34, 0.62),
    100: (1.20, 0.75, 0.012),
}

# Measured from the built GLBs. Width (X), depth (Y), height (Z), metres.
DIMENSIONS = {
    91: (0.20, 0.18, 0.57),
    92: (0.42, 0.18, 0.55),
    93: (0.18, 0.18, 0.11),
    94: (0.45, 0.10, 0.21),
    95: (0.42, 0.18, 0.21),
    96: (0.95, 0.05, 0.70),
    97: (0.48, 0.18, 0.65),
    98: (0.13, 0.13, 0.31),
    99: (0.36, 0.36, 0.62),
    100: (1.20, 0.75, 0.02),
}

BUDGETS = {
    91: (18, 9000), 92: (18, 9000), 93: (12, 5000), 94: (16, 6000),
    95: (16, 7000), 96: (12, 6000), 97: (18, 9000), 98: (14, 6000),
    99: (12, 6000), 100: (8, 2500),
}

# Safety fixtures that a player must be able to walk past.
COLLISION_EXPECTED = {
    91: True, 92: True, 93: False, 94: False, 95: False,
    96: False, 97: True, 98: True, 99: True, 100: False,
}

MOUNTS = {
    91: "wall", 92: "wall", 93: "ceiling", 94: "wall", 95: "wall",
    96: "wall", 97: "wall", 98: "wall", 99: "floor", 100: "floor",
}

REQUIRED_MARKERS = {
    91: ("SOCKET_WallBracket", "SOCKET_Carry", "SOCKET_Grip", "SOCKET_Hose",
         "SOCKET_Nozzle", "SOCKET_PLACEMENT"),
    92: ("SOCKET_WallMount", "PIVOT_Door", "SOCKET_Handle", "SOCKET_Shelf_01",
         "SOCKET_Shelf_02", "SOCKET_PLACEMENT"),
    93: ("SOCKET_CeilingMount", "PIVOT_Lens", "SOCKET_CableEntry", "SOCKET_PLACEMENT"),
    94: ("SOCKET_WallMount", "SOCKET_LightLeft", "SOCKET_LightRight", "SOCKET_PLACEMENT"),
    95: ("SOCKET_WallMount", "PIVOT_LightHeadLeft", "PIVOT_LightHeadRight",
         "SOCKET_Indicator", "SOCKET_PLACEMENT"),
    96: ("SOCKET_WallMount", "SOCKET_Notice_01", "SOCKET_Notice_02", "SOCKET_Tournament",
         "SOCKET_GuestInfo", "SOCKET_PLACEMENT"),
    97: ("SOCKET_WallMount", "PIVOT_Door", "SOCKET_Lock", "SOCKET_Key_01",
         "SOCKET_Key_02", "SOCKET_Key_03", "SOCKET_PLACEMENT"),
    98: ("SOCKET_WallMount", "SOCKET_Hand", "SOCKET_Dispense", "SOCKET_DripTray",
         "SOCKET_Refill", "SOCKET_PLACEMENT"),
    99: ("SOCKET_FloorPlacement", "SOCKET_Umbrella_01", "SOCKET_Umbrella_02",
         "SOCKET_Umbrella_03", "SOCKET_DrainTray", "SOCKET_PLACEMENT"),
    100: ("SOCKET_FloorPlacement", "SOCKET_DirtMask", "SOCKET_WetnessMask", "SOCKET_PLACEMENT"),
}

REQUIRED_ANIMATIONS = {
    91: (), 93: (), 94: (), 95: (), 96: (), 99: (), 100: (),
    92: ("FirstAidDoor_Open", "FirstAidDoor_Close"),
    97: ("KeyCabinetDoor_Open", "KeyCabinetDoor_Close"),
    98: ("Sanitizer_Dispense",),
}

FORWARD = (-math.pi / 2.0, 0.0, 0.0)
DOWN = (0.0, 0.0, 0.0)
WALL = (math.pi / 2.0, 0.0, 0.0)


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
    root["production_sheet"] = "10"
    root["authored_units"] = "meters"
    root["runtime_unit_conversion"] = "meters_to_yards_once:1.0936133"
    root["front_side"] = "player-facing side is -Y"
    root["source_lineage"] = "original deterministic Blender Python; no candidate geometry imported"
    root["license"] = "Project-owned"
    root["visual_style"] = "Pinehollow clubhouse safety and utilities; safety red, cool white, walnut, brass"
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
        "extinguisher_red": A.material("S10_ExtinguisherRed", (0.42, 0.035, 0.028, 1.0),
                                       roughness=0.34, coat=0.20),
        "cabinet_white": A.material("S10_CabinetWhite", (0.72, 0.72, 0.70, 1.0), roughness=0.42),
        "sign_white": A.material("S10_SignWhite", (0.76, 0.76, 0.74, 1.0), roughness=0.48),
        "housing_cream": A.material("S10_HousingCream", (0.68, 0.66, 0.60, 1.0), roughness=0.52),
        "hard_black": A.material("S10_HardBlack", (0.022, 0.023, 0.025, 1.0), roughness=0.42),
        "matte_black": A.material("S10_MatteBlack", (0.014, 0.015, 0.016, 1.0), roughness=0.70),
        "hose_black": A.material("S10_HoseBlack", (0.026, 0.027, 0.030, 1.0), roughness=0.58),
        "first_aid_green": A.material("S10_FirstAidGreen", (0.035, 0.30, 0.115, 1.0), roughness=0.46),
        "cork": A.material("S10_Cork", (0.42, 0.28, 0.135, 1.0), roughness=0.88),
        "paper": A.material("S10_Paper", (0.78, 0.77, 0.73, 1.0), roughness=0.85),
        "stand_green": A.material("S10_StandGreen", (0.038, 0.082, 0.052, 1.0), roughness=0.48),
        "mat_green": A.material("S10_MatGreen", (0.032, 0.062, 0.042, 1.0), roughness=0.92),
        "mat_border": A.material("S10_MatBorder", (0.052, 0.090, 0.062, 1.0), roughness=0.90),
        "mat_rubber": A.material("S10_MatRubber", (0.018, 0.019, 0.020, 1.0), roughness=0.95),
        # Emissive legends stay restrained: an exit sign should read across a lobby, not
        # bloom out the wall it is mounted on.
        "exit_red": A.material("S10_ExitRed", (0.60, 0.045, 0.030, 1.0), roughness=0.40,
                               emission_color=(1.0, 0.10, 0.06), emission_strength=1.5),
        "lamp_lens": A.material("S10_LampLens", (0.86, 0.82, 0.68, 1.0), roughness=0.22,
                                emission_color=(1.0, 0.92, 0.74), emission_strength=1.2),
        "indicator_green": A.material("S10_Indicator", (0.10, 0.62, 0.22, 1.0), roughness=0.30,
                                      emission_color=(0.20, 1.0, 0.35), emission_strength=0.9),
        "gauge_face": A.material("S10_GaugeFace", (0.74, 0.72, 0.66, 1.0), roughness=0.55),
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


def _letter_strokes(letter: str, x: float, z: float, height: float,
                    thickness: float) -> list[tuple[tuple[float, float, float], tuple[float, float, float]]]:
    """Box strokes for one EXIT letter, as ((size), (centre)) pairs in X/Z.

    Built from primitives rather than `text_mesh` so the sign never depends on which
    fonts the machine running the build happens to have.
    """

    h, t = height, thickness
    w = height * 0.62
    half_w, half_h = w / 2.0, h / 2.0
    strokes: list[tuple[tuple[float, float, float], tuple[float, float, float]]] = []
    if letter == "E":
        strokes.append(((t, t, h), (x - half_w + t / 2.0, 0.0, z)))
        for offset in (half_h - t / 2.0, 0.0, -half_h + t / 2.0):
            strokes.append(((w, t, t), (x, 0.0, z + offset)))
    elif letter == "X":
        diagonal = math.hypot(w, h) * 0.94
        for sign in (1.0, -1.0):
            angle = math.atan2(h, w) * sign
            strokes.append(((diagonal, t, t), (x, 0.0, z), angle))
    elif letter == "I":
        strokes.append(((t, t, h), (x, 0.0, z)))
    elif letter == "T":
        strokes.append(((w, t, t), (x, 0.0, z + half_h - t / 2.0)))
        strokes.append(((t, t, h), (x, 0.0, z)))
    return strokes


def _exit_legend(parent: bpy.types.Object, mat: bpy.types.Material, *,
                 centre_z: float, face_y: float, height: float = 0.105) -> None:
    """The word EXIT, centred, as extruded box strokes."""

    thickness = height * 0.20
    spacing = height * 0.78
    letters = "EXIT"
    start = -(len(letters) - 1) * spacing / 2.0
    pieces = []
    for index, letter in enumerate(letters):
        x = start + index * spacing
        for stroke in _letter_strokes(letter, x, centre_z, height, thickness):
            size, centre = stroke[0], stroke[1]
            angle = stroke[2] if len(stroke) > 2 else 0.0
            pieces.append(A.box(f"ExitGlyph_{letter}_{len(pieces):02d}",
                                (size[0], size[1], size[2]),
                                (centre[0], face_y, centre[2]), mat,
                                parent=parent, bevel=0.0015,
                                rotation=(0.0, angle, 0.0)))
    _join(pieces, "ExitLegend", parent)


def _wall_frame(name: str, parent: bpy.types.Object, mat: bpy.types.Material, *,
                width: float, height: float, depth: float, rail: float,
                centre_z: float, face_y: float) -> None:
    half_w, half_h = width / 2.0, height / 2.0
    pieces = [
        A.box(f"{name}_Top", (width, depth, rail), (0.0, face_y, centre_z + half_h - rail / 2.0),
              mat, parent=parent, bevel=0.004),
        A.box(f"{name}_Bottom", (width, depth, rail), (0.0, face_y, centre_z - half_h + rail / 2.0),
              mat, parent=parent, bevel=0.004),
        A.box(f"{name}_Left", (rail, depth, height - rail * 2.0),
              (-half_w + rail / 2.0, face_y, centre_z), mat, parent=parent, bevel=0.004),
        A.box(f"{name}_Right", (rail, depth, height - rail * 2.0),
              (half_w - rail / 2.0, face_y, centre_z), mat, parent=parent, bevel=0.004),
    ]
    _join(pieces, f"{name}_Frame", parent)


def build_91() -> bpy.types.Object:
    root, p = _root(91, safety_role="fire_extinguisher")
    m = _materials()
    body = _group("ExtinguisherBody", root)
    bracket = _group("ExtinguisherBracket", root)

    # Bracket first: the origin is the wall fixing, and the bottle hangs off it.
    A.box("BracketPlate", (0.070, 0.014, 0.150), (0.0, 0.007, -0.130), m["matte_black"],
          parent=bracket, bevel=0.004)
    A.box("BracketArm", (0.060, 0.075, 0.022), (0.0, -0.030, -0.075), m["matte_black"],
          parent=bracket, bevel=0.005)
    A.torus("BracketStrap", 0.088, 0.008, (0.0, -0.088, -0.185), m["matte_black"],
            rotation=(math.pi / 2.0, 0.0, 0.0), major_segments=20, minor_segments=6,
            parent=bracket)

    cylinder_z = -0.330
    A.cylinder("ExtinguisherShell", 0.080, 0.360, (0.0, -0.088, cylinder_z),
               m["extinguisher_red"], vertices=28, parent=body, bevel=0.014)
    A.sphere("ExtinguisherBase", 0.080, (0.0, -0.088, cylinder_z - 0.168),
             m["extinguisher_red"], segments=24, parent=body)
    A.cylinder("ExtinguisherShoulder", 0.062, 0.055, (0.0, -0.088, cylinder_z + 0.195),
               m["extinguisher_red"], vertices=24, parent=body, bevel=0.014)
    A.cylinder("ExtinguisherNeck", 0.026, 0.040, (0.0, -0.088, cylinder_z + 0.238),
               p["brushed_steel"], vertices=16, parent=body, bevel=0.004)
    # Valve head, carry handle and squeeze lever.
    A.box("ValveBody", (0.048, 0.070, 0.048), (0.0, -0.088, cylinder_z + 0.278),
          p["brushed_steel"], parent=body, bevel=0.008)
    A.box("ValveCarryHandle", (0.030, 0.090, 0.014), (0.0, -0.060, cylinder_z + 0.316),
          p["brushed_steel"], parent=body, bevel=0.005)
    A.box("ValveSqueezeLever", (0.026, 0.086, 0.011), (0.0, -0.062, cylinder_z + 0.296),
          p["brushed_steel"], parent=body, bevel=0.004, rotation=(math.radians(5.0), 0.0, 0.0))
    A.torus("ValvePinRing", 0.014, 0.0035, (0.038, -0.088, cylinder_z + 0.294),
            p["restrained_brass"], rotation=(0.0, math.pi / 2.0, 0.0),
            major_segments=14, minor_segments=5, parent=body)
    A.cylinder("PressureGauge", 0.020, 0.016, (0.0, -0.132, cylinder_z + 0.276),
               m["gauge_face"], rotation=(math.pi / 2.0, 0.0, 0.0), vertices=16,
               parent=body, bevel=0.003)
    # Hose sweeping down the side to a horn.
    A.curve_tube("ExtinguisherHose", (
        (0.030, -0.088, cylinder_z + 0.268), (0.086, -0.108, cylinder_z + 0.180),
        (0.092, -0.120, cylinder_z + 0.020), (0.070, -0.128, cylinder_z - 0.110),
    ), 0.010, m["hose_black"], parent=body, resolution=3, bevel_resolution=4)
    A.cylinder("ExtinguisherHorn", 0.020, 0.055, (0.066, -0.130, cylinder_z - 0.155),
               m["matte_black"], vertices=14, parent=body, bevel=0.004)
    # Instruction panel as a recessed plate; no generated label text ships.
    A.box("ExtinguisherLabel", (0.098, 0.004, 0.130), (0.0, -0.166, cylinder_z + 0.010),
          m["sign_white"], parent=body, bevel=0.003,
          properties={"decorative_only": True, "label_is_geometry": True})

    _marker("WallBracket", root, (0.0, 0.0, 0.0), rotation=WALL, mount_surface="wall")
    _marker("Carry", root, (0.0, -0.060, cylinder_z + 0.322), rotation=DOWN, grip_role="carry_handle")
    _marker("Grip", root, (0.0, -0.062, cylinder_z + 0.300), rotation=FORWARD, hand="right")
    _marker("Hose", root, (0.030, -0.088, cylinder_z + 0.268), rotation=FORWARD, port="hose_root")
    _marker("Nozzle", root, (0.066, -0.130, cylinder_z - 0.186), rotation=DOWN,
            effect_role="discharge_origin")
    _placement(root, "origin on the wall bracket fixing; bottle hangs below, front is -Y")

    collision = _group("ExtinguisherCollision", root)
    A.collision_cylinder("ExtinguisherHull", 0.090, 0.560, (0.0, -0.088, cylinder_z + 0.010),
                         parent=collision)
    return root


def build_92() -> bpy.types.Object:
    root, p = _root(92, safety_role="first_aid_cabinet")
    m = _materials()
    shell = _group("FirstAidShell", root)

    A.box("FirstAidBack", (0.420, 0.018, 0.550), (0.0, 0.072, -0.275), m["cabinet_white"],
          parent=shell, bevel=0.005)
    for side, sx in (("L", -1.0), ("R", 1.0)):
        A.box(f"FirstAidSide{side}", (0.016, 0.160, 0.550), (sx * 0.202, 0.0, -0.275),
              m["cabinet_white"], parent=shell, bevel=0.004)
    A.box("FirstAidTop", (0.420, 0.160, 0.016), (0.0, 0.0, -0.008), m["cabinet_white"],
          parent=shell, bevel=0.004)
    A.box("FirstAidBottom", (0.420, 0.160, 0.016), (0.0, 0.0, -0.542), m["cabinet_white"],
          parent=shell, bevel=0.004)
    for index, z in enumerate((-0.190, -0.360)):
        A.box(f"FirstAidShelf_{index}", (0.386, 0.144, 0.012), (0.0, 0.004, z),
              m["cabinet_white"], parent=shell, bevel=0.003)
    # Fictional supplies: boxes and bottles, seated on the shelves rather than floating.
    supplies = []
    for index, (x, z, w, d, h, mat) in enumerate((
        (-0.130, -0.150, 0.090, 0.070, 0.070, m["cabinet_white"]),
        (-0.020, -0.155, 0.070, 0.060, 0.060, m["first_aid_green"]),
        (0.090, -0.148, 0.085, 0.065, 0.075, m["cabinet_white"]),
        (-0.120, -0.320, 0.075, 0.060, 0.068, m["first_aid_green"]),
        (0.010, -0.322, 0.080, 0.062, 0.064, m["cabinet_white"]),
        (0.120, -0.318, 0.070, 0.058, 0.072, m["first_aid_green"]),
    )):
        supplies.append(A.box(f"FirstAidSupply_{index}", (w, d, h), (x, 0.004, z + h / 2.0),
                              mat, parent=shell, bevel=0.005))
    _join(supplies, "FirstAidSupplies", shell)

    door = _pivot("Door", root, (-0.204, -0.076, -0.275),
                  moving_part="cabinet_door", rotation_axis="+Z")
    A.box("FirstAidDoorPanel", (0.404, 0.020, 0.534), (0.0, -0.070, -0.275),
          m["cabinet_white"], parent=door, bevel=0.005)
    A.box("FirstAidDoorGlass", (0.330, 0.006, 0.460), (0.0, -0.070, -0.275),
          p["glass"], parent=door, bevel=0.002)
    # Green cross: the standard first-aid legend, built as two bars.
    A.box("FirstAidCrossV", (0.036, 0.006, 0.110), (0.0, -0.084, -0.275),
          m["first_aid_green"], parent=door, bevel=0.002)
    A.box("FirstAidCrossH", (0.110, 0.006, 0.036), (0.0, -0.084, -0.275),
          m["first_aid_green"], parent=door, bevel=0.002)
    A.cylinder("FirstAidHandle", 0.008, 0.070, (0.166, -0.090, -0.275),
               p["brushed_steel"], vertices=10, parent=door, bevel=0.002)

    _marker("WallMount", root, (0.0, 0.0, 0.0), rotation=WALL, mount_surface="wall")
    _marker("Handle", root, (0.166, -0.096, -0.275), rotation=FORWARD)
    _marker("Shelf_01", root, (0.0, 0.004, -0.184), rotation=DOWN)
    _marker("Shelf_02", root, (0.0, 0.004, -0.354), rotation=DOWN)
    _placement(root, "origin on the wall mount point; cabinet hangs below, door faces -Y")

    collision = _group("FirstAidCollision", root)
    A.collision_box("FirstAidHull", (0.43, 0.17, 0.56), (0.0, 0.010, -0.275), parent=collision)

    closed = tuple(door.rotation_euler)
    opened = (closed[0], closed[1], closed[2] + math.radians(105.0))
    A.animate_transform_clip(door, "FirstAidDoor_Open",
                             ({"frame": 1, "rotation": closed}, {"frame": 22, "rotation": opened}),
                             interpolation="SINE")
    A.animate_transform_clip(door, "FirstAidDoor_Close",
                             ({"frame": 1, "rotation": opened}, {"frame": 22, "rotation": closed}),
                             interpolation="SINE")
    door.rotation_euler = closed
    bpy.context.view_layer.update()
    return root


def build_93() -> bpy.types.Object:
    root, p = _root(93, safety_role="security_camera")
    m = _materials()
    body = _group("CameraBody", root)

    A.cylinder("CameraMountPlate", 0.090, 0.014, (0.0, 0.0, -0.007), m["housing_cream"],
               vertices=24, parent=body, bevel=0.003)
    A.cylinder("CameraCollar", 0.078, 0.030, (0.0, 0.0, -0.029), m["housing_cream"],
               vertices=24, parent=body, bevel=0.005)
    # Dome hangs below the collar. A hemisphere would be ideal; a squashed sphere with
    # the top hidden inside the collar costs less and reads identically from the floor.
    dome = A.sphere("CameraDome", 0.088, (0.0, 0.0, -0.052), m["hard_black"],
                    segments=28, parent=body)
    dome.scale = (1.0, 1.0, 0.62)
    A.apply_transforms(dome, scale=True)
    A.cylinder("CameraCableEntry", 0.016, 0.030, (0.0, 0.058, -0.008), m["housing_cream"],
               vertices=12, parent=body, bevel=0.003)

    lens = _pivot("Lens", root, (0.0, 0.0, -0.062), moving_part="camera_lens", rotation_axis="+Z")
    A.cylinder("CameraLensBarrel", 0.030, 0.036, (0.0, -0.022, -0.070), m["matte_black"],
               rotation=(math.radians(58.0), 0.0, 0.0), vertices=16, parent=lens, bevel=0.004)
    A.cylinder("CameraLensGlass", 0.024, 0.008, (0.0, -0.036, -0.079), p["glass"],
               rotation=(math.radians(58.0), 0.0, 0.0), vertices=16, parent=lens, bevel=0.002)

    _marker("CeilingMount", root, (0.0, 0.0, 0.0), rotation=DOWN, mount_surface="ceiling")
    _marker("CableEntry", root, (0.0, 0.058, 0.004), rotation=DOWN, port="cable")
    _placement(root, "origin on the ceiling mount point; dome hangs below")
    return root


def build_94() -> bpy.types.Object:
    root, p = _root(94, safety_role="exit_sign", restrained_emissive=True)
    m = _materials()
    body = _group("ExitSignBody", root)

    A.box("ExitHousing", (0.330, 0.070, 0.200), (0.0, -0.040, -0.115), m["sign_white"],
          parent=body, bevel=0.008)
    A.box("ExitFacePanel", (0.310, 0.008, 0.180), (0.0, -0.078, -0.115), m["sign_white"],
          parent=body, bevel=0.004)
    A.box("ExitCanopy", (0.120, 0.055, 0.020), (0.0, -0.026, -0.012), m["sign_white"],
          parent=body, bevel=0.005)
    _exit_legend(body, m["exit_red"], centre_z=-0.115, face_y=-0.086, height=0.105)
    # Small emergency lamps flanking the housing, as the reference shows.
    for side, sx in (("Left", -1.0), ("Right", 1.0)):
        A.box(f"ExitLampBody{side}", (0.062, 0.058, 0.062), (sx * 0.196, -0.040, -0.115),
              m["sign_white"], parent=body, bevel=0.010)
        A.cylinder(f"ExitLampLens{side}", 0.022, 0.014, (sx * 0.196, -0.072, -0.115),
                   m["lamp_lens"], rotation=(math.pi / 2.0, 0.0, 0.0), vertices=14,
                   parent=body, bevel=0.003)

    _marker("WallMount", root, (0.0, 0.0, 0.0), rotation=WALL, mount_surface="wall_above_door")
    _marker("LightLeft", root, (-0.196, -0.080, -0.115), rotation=FORWARD)
    _marker("LightRight", root, (0.196, -0.080, -0.115), rotation=FORWARD)
    _placement(root, "origin on the wall mount above the doorway; legend faces -Y")
    return root


def build_95() -> bpy.types.Object:
    root, p = _root(95, safety_role="emergency_light", restrained_emissive=True)
    m = _materials()
    body = _group("EmergencyBody", root)

    A.box("EmergencyHousing", (0.320, 0.110, 0.190), (0.0, -0.055, -0.135),
          m["housing_cream"], parent=body, bevel=0.010, bevel_segments=2)
    A.box("EmergencyBackPlate", (0.320, 0.012, 0.212), (0.0, 0.004, -0.135),
          m["housing_cream"], parent=body, bevel=0.004)
    A.box("EmergencyBatteryVent", (0.200, 0.006, 0.050), (0.0, -0.112, -0.196),
          m["housing_cream"], parent=body, bevel=0.003)
    A.sphere("EmergencyIndicator", 0.008, (0.122, -0.112, -0.204), m["indicator_green"],
             segments=12, parent=body)

    # Two adjustable heads on real pivots, so a runtime can aim them if it ever needs to.
    # They sit outboard of the housing, which is what gives the fixture its 0.42 span.
    for side, sx in (("Left", -1.0), ("Right", 1.0)):
        head_x = sx * 0.172
        pivot = _pivot(f"LightHead{side}", root, (head_x, -0.100, -0.108),
                       moving_part="emergency_head", rotation_axis="+Z")
        A.cylinder(f"EmergencyHeadBody{side}", 0.040, 0.062, (head_x, -0.128, -0.108),
                   m["housing_cream"], rotation=(math.pi / 2.0, 0.0, 0.0), vertices=18,
                   parent=pivot, bevel=0.006)
        A.cylinder(f"EmergencyHeadLens{side}", 0.034, 0.012, (head_x, -0.162, -0.108),
                   m["lamp_lens"], rotation=(math.pi / 2.0, 0.0, 0.0), vertices=18,
                   parent=pivot, bevel=0.003)
        A.cylinder(f"EmergencyHeadYoke{side}", 0.008, 0.048, (head_x, -0.100, -0.108),
                   m["housing_cream"], rotation=(0.0, math.pi / 2.0, 0.0), vertices=10,
                   parent=pivot, bevel=0.002)

    _marker("WallMount", root, (0.0, 0.0, 0.0), rotation=WALL, mount_surface="wall")
    _marker("Indicator", root, (0.110, -0.118, -0.196), rotation=FORWARD)
    _placement(root, "origin on the wall mount point; heads face -Y")
    return root


def build_96() -> bpy.types.Object:
    root, p = _root(96, prop_role="public_bulletin_board", content_driven=True)
    m = _materials()
    board = _group("BulletinBoard", root)

    A.box("BulletinCork", (0.880, 0.024, 0.630), (0.0, -0.016, -0.350), m["cork"],
          parent=board, bevel=0.003)
    _wall_frame("BulletinFrame", board, p["medium_walnut"], width=0.950, height=0.700,
                depth=0.048, rail=0.040, centre_z=-0.350, face_y=-0.012)
    notices = []
    for index, (x, z, w, h, tilt) in enumerate((
        (-0.290, -0.200, 0.190, 0.230, 1.8),
        (-0.045, -0.185, 0.165, 0.200, -2.4),
        (0.215, -0.215, 0.200, 0.250, 1.2),
        (-0.300, -0.480, 0.175, 0.170, -1.6),
        (-0.040, -0.500, 0.150, 0.150, 2.2),
        (0.240, -0.495, 0.190, 0.180, -1.0),
    )):
        notices.append(A.box(f"BulletinSheet_{index}", (w, 0.0016, h), (x, -0.030, z),
                             m["paper"], parent=board, bevel=0.001,
                             rotation=(0.0, math.radians(tilt), 0.0)))
        notices.append(A.cylinder(f"BulletinPin_{index}", 0.0055, 0.010,
                                  (x, -0.036, z + h / 2.0 - 0.018), p["restrained_brass"],
                                  rotation=(math.pi / 2.0, 0.0, 0.0), vertices=8,
                                  parent=board, bevel=0.001))
    _join(notices, "BulletinContent", board)

    _marker("WallMount", root, (0.0, 0.0, 0.0), rotation=WALL, mount_surface="wall")
    _marker("Notice_01", root, (-0.290, -0.033, -0.200), rotation=FORWARD)
    _marker("Notice_02", root, (-0.045, -0.033, -0.185), rotation=FORWARD)
    _marker("Tournament", root, (0.215, -0.033, -0.215), rotation=FORWARD)
    _marker("GuestInfo", root, (0.240, -0.033, -0.495), rotation=FORWARD)
    _placement(root, "origin on the wall mount point; board hangs below, face toward -Y")
    return root


def build_97() -> bpy.types.Object:
    root, p = _root(97, prop_role="key_cabinet")
    m = _materials()
    shell = _group("KeyCabinetShell", root)

    A.box("KeyCabinetBack", (0.480, 0.016, 0.650), (0.0, 0.072, -0.325),
          p["medium_walnut"], parent=shell, bevel=0.005)
    for side, sx in (("L", -1.0), ("R", 1.0)):
        A.box(f"KeyCabinetSide{side}", (0.016, 0.160, 0.650), (sx * 0.232, 0.0, -0.325),
              p["medium_walnut"], parent=shell, bevel=0.004)
    A.box("KeyCabinetTop", (0.480, 0.160, 0.016), (0.0, 0.0, -0.008), p["medium_walnut"],
          parent=shell, bevel=0.004)
    A.box("KeyCabinetBottom", (0.480, 0.160, 0.016), (0.0, 0.0, -0.642), p["medium_walnut"],
          parent=shell, bevel=0.004)
    # Interior hook rows with hanging keys.
    hooks = []
    for row in range(3):
        z = -0.150 - row * 0.150
        for col in range(4):
            x = -0.150 + col * 0.100
            hooks.append(A.cylinder(f"KeyCabHook_{row}{col}", 0.004, 0.024, (x, 0.050, z),
                                    p["restrained_brass"], rotation=(math.pi / 2.0, 0.0, 0.0),
                                    vertices=8, parent=shell, bevel=0.001))
            hooks.append(A.box(f"KeyCabTag_{row}{col}", (0.020, 0.004, 0.030),
                               (x, 0.040, z - 0.026), m["matte_black"], parent=shell, bevel=0.003))
            hooks.append(A.box(f"KeyCabBlade_{row}{col}", (0.007, 0.002, 0.026),
                               (x, 0.040, z - 0.054), p["restrained_brass"],
                               parent=shell, bevel=0.001))
    _join(hooks, "KeyCabinetKeys", shell)

    door = _pivot("Door", root, (-0.234, -0.076, -0.325),
                  moving_part="cabinet_door", rotation_axis="+Z")
    A.box("KeyCabinetDoorPanel", (0.462, 0.020, 0.634), (0.0, -0.070, -0.325),
          p["medium_walnut"], parent=door, bevel=0.005)
    A.box("KeyCabinetDoorInset", (0.390, 0.008, 0.560), (0.0, -0.078, -0.325),
          p["medium_walnut"], parent=door, bevel=0.006)
    A.torus("KeyCabinetCrest", 0.052, 0.006, (0.0, -0.086, -0.325), p["restrained_brass"],
            rotation=(math.pi / 2.0, 0.0, 0.0), major_segments=20, minor_segments=6,
            parent=door, properties={"fictional_brand_motif": "pinehollow ring",
                                     "decorative_only": True})
    A.cylinder("KeyCabinetLock", 0.014, 0.024, (0.190, -0.086, -0.325),
               p["restrained_brass"], rotation=(math.pi / 2.0, 0.0, 0.0), vertices=14,
               parent=door, bevel=0.003)

    _marker("WallMount", root, (0.0, 0.0, 0.0), rotation=WALL, mount_surface="wall")
    _marker("Lock", root, (0.190, -0.094, -0.325), rotation=FORWARD)
    for index in range(3):
        _marker(f"Key_{index + 1:02d}", root, (-0.150 + index * 0.100, 0.044, -0.176),
                rotation=FORWARD, key_slot=index + 1)
    _placement(root, "origin on the wall mount point; cabinet hangs below, door faces -Y")

    collision = _group("KeyCabinetCollision", root)
    A.collision_box("KeyCabinetHull", (0.49, 0.17, 0.66), (0.0, 0.010, -0.325), parent=collision)

    closed = tuple(door.rotation_euler)
    opened = (closed[0], closed[1], closed[2] + math.radians(112.0))
    A.animate_transform_clip(door, "KeyCabinetDoor_Open",
                             ({"frame": 1, "rotation": closed}, {"frame": 22, "rotation": opened}),
                             interpolation="SINE")
    A.animate_transform_clip(door, "KeyCabinetDoor_Close",
                             ({"frame": 1, "rotation": opened}, {"frame": 22, "rotation": closed}),
                             interpolation="SINE")
    door.rotation_euler = closed
    bpy.context.view_layer.update()
    return root


def build_98() -> bpy.types.Object:
    root, p = _root(98, prop_role="hand_sanitizer_station")
    m = _materials()
    body = _group("SanitizerBody", root)

    A.box("SanitizerBackPlate", (0.130, 0.014, 0.310), (0.0, 0.007, -0.155),
          m["cabinet_white"], parent=body, bevel=0.005)
    A.box("SanitizerHousing", (0.120, 0.100, 0.230), (0.0, -0.050, -0.130),
          m["cabinet_white"], parent=body, bevel=0.012, bevel_segments=2)
    # A translucent window showing the refill level.
    A.box("SanitizerLevelWindow", (0.050, 0.006, 0.140), (0.0, -0.101, -0.130),
          p["glass"], parent=body, bevel=0.003)
    A.box("SanitizerNozzle", (0.036, 0.030, 0.020), (0.0, -0.066, -0.256),
          m["hard_black"], parent=body, bevel=0.005)
    A.box("SanitizerDripTray", (0.110, 0.070, 0.014), (0.0, -0.060, -0.300),
          m["cabinet_white"], parent=body, bevel=0.005)
    A.box("SanitizerTrayLip", (0.110, 0.008, 0.020), (0.0, -0.093, -0.294),
          m["cabinet_white"], parent=body, bevel=0.003)
    A.torus("SanitizerCrest", 0.024, 0.004, (0.0, -0.101, -0.052), m["first_aid_green"],
            rotation=(math.pi / 2.0, 0.0, 0.0), major_segments=16, minor_segments=5,
            parent=body, properties={"fictional_brand_motif": "pinehollow ring",
                                     "decorative_only": True})

    plate = _group("SanitizerPushPlate", root)
    A.box("SanitizerPlate", (0.090, 0.016, 0.052), (0.0, -0.104, -0.216),
          m["cabinet_white"], parent=plate, bevel=0.006)

    _marker("WallMount", root, (0.0, 0.0, 0.0), rotation=WALL, mount_surface="wall")
    _marker("Hand", root, (0.0, -0.090, -0.286), rotation=DOWN, hand_target=True)
    _marker("Dispense", root, (0.0, -0.066, -0.268), rotation=DOWN, effect_role="dispense_origin")
    _marker("DripTray", root, (0.0, -0.060, -0.292), rotation=DOWN)
    _marker("Refill", root, (0.0, -0.050, -0.020), rotation=DOWN, liquid_level_anchor=True)
    _placement(root, "origin on the wall mount point; dispenser hangs below, front is -Y")

    collision = _group("SanitizerCollision", root)
    A.collision_box("SanitizerHull", (0.14, 0.12, 0.32), (0.0, -0.040, -0.155), parent=collision)

    rest = tuple(plate.location)
    pressed = (rest[0], rest[1] + 0.012, rest[2])
    A.animate_transform_clip(plate, "Sanitizer_Dispense",
                             ({"frame": 1, "location": rest},
                              {"frame": 4, "location": pressed},
                              {"frame": 12, "location": rest}), interpolation="SINE")
    plate.location = rest
    bpy.context.view_layer.update()
    return root


def build_99() -> bpy.types.Object:
    root, p = _root(99, prop_role="umbrella_stand")
    m = _materials()
    body = _group("UmbrellaStand", root)

    A.cylinder("StandWall", 0.170, 0.600, (0.0, 0.0, 0.310), m["stand_green"],
               vertices=32, parent=body, bevel=0.008)
    # Hollow it out: a solid cylinder reads as a bin, not a stand you put things into.
    A.cylinder("StandBore", 0.152, 0.560, (0.0, 0.0, 0.336), m["matte_black"],
               vertices=32, parent=body, bevel=0.004)
    A.cylinder("StandRim", 0.176, 0.024, (0.0, 0.0, 0.602), m["stand_green"],
               vertices=32, parent=body, bevel=0.006)
    A.cylinder("StandBase", 0.176, 0.030, (0.0, 0.0, 0.015), m["stand_green"],
               vertices=32, parent=body, bevel=0.006)
    A.cylinder("StandDrainTray", 0.150, 0.012, (0.0, 0.0, 0.042), m["matte_black"],
               vertices=28, parent=body, bevel=0.003)
    for index in range(2):
        A.torus(f"StandBand_{index}", 0.172, 0.006, (0.0, 0.0, 0.180 + index * 0.230),
                p["restrained_brass"], major_segments=28, minor_segments=6, parent=body)
    A.torus("StandCrest", 0.046, 0.005, (0.0, -0.170, 0.400), p["restrained_brass"],
            rotation=(math.pi / 2.0, 0.0, 0.0), major_segments=18, minor_segments=6,
            parent=body, properties={"fictional_brand_motif": "pinehollow ring",
                                     "decorative_only": True})

    # Contents come from the authored closed-umbrella product rather than being modelled
    # here, so the stand has three seating sockets and ships empty.
    _marker("FloorPlacement", root, (0.0, 0.0, 0.0), rotation=DOWN)
    for index in range(3):
        angle = index * math.tau / 3.0
        _marker(f"Umbrella_{index + 1:02d}", root,
                (math.cos(angle) * 0.072, math.sin(angle) * 0.072, 0.055),
                rotation=DOWN, slot=index + 1, accepts="closed_umbrella")
    _marker("DrainTray", root, (0.0, 0.0, 0.048), rotation=DOWN)
    _placement(root, "origin centered on floor contact; crest faces -Y")

    collision = _group("StandCollision", root)
    A.collision_cylinder("StandHull", 0.178, 0.620, (0.0, 0.0, 0.310), parent=collision)
    return root


def build_100() -> bpy.types.Object:
    root, p = _root(100, prop_role="entrance_mat", cleanable_surface=True)
    m = _materials()
    mat = _group("FloorMat", root)

    # Thin, and deliberately lifted 2 mm off the floor plane. A mat authored at exactly
    # z=0 z-fights with the floor it lies on from across the room.
    base_z = 0.002
    A.box("MatBacking", (1.200, 0.750, 0.006), (0.0, 0.0, base_z + 0.003), m["mat_rubber"],
          parent=mat, bevel=0.002)
    A.box("MatPile", (1.160, 0.710, 0.006), (0.0, 0.0, base_z + 0.009), m["mat_green"],
          parent=mat, bevel=0.002)
    # Border inlay, as a frame of four bars rather than a texture.
    border = []
    for name, size, centre in (
        ("Top", (1.060, 0.030, 0.002), (0.0, 0.290, base_z + 0.013)),
        ("Bottom", (1.060, 0.030, 0.002), (0.0, -0.290, base_z + 0.013)),
        ("Left", (0.030, 0.610, 0.002), (-0.515, 0.0, base_z + 0.013)),
        ("Right", (0.030, 0.610, 0.002), (0.515, 0.0, base_z + 0.013)),
    ):
        border.append(A.box(f"MatBorder{name}", size, centre, m["mat_border"],
                            parent=mat, bevel=0.001))
    _join(border, "MatBorderInlay", mat)
    A.torus("MatCrest", 0.115, 0.010, (0.0, 0.0, base_z + 0.013), m["mat_border"],
            major_segments=28, minor_segments=6, parent=mat,
            properties={"fictional_brand_motif": "pinehollow ring", "decorative_only": True})

    _marker("FloorPlacement", root, (0.0, 0.0, 0.0), rotation=DOWN,
            lift_above_floor_m=base_z, avoids_z_fighting=True)
    _marker("DirtMask", root, (0.0, 0.0, base_z + 0.014), rotation=DOWN,
            mask_extent_m=(1.16, 0.71), cleanable=True, accepts_tools="vacuum|broom|mop")
    _marker("WetnessMask", root, (0.0, 0.0, base_z + 0.014), rotation=DOWN,
            mask_extent_m=(1.16, 0.71), wetness_surface=True)
    _placement(root, "origin centered on the mat; long axis is X, entrance side is -Y")
    return root


BUILDERS: dict[int, Callable[[], bpy.types.Object]] = {
    91: build_91, 92: build_92, 93: build_93, 94: build_94, 95: build_95,
    96: build_96, 97: build_97, 98: build_98, 99: build_99, 100: build_100,
}


def _parse_cli(argv: Sequence[str]) -> tuple[int | None, A.BuildOptions]:
    selected: int | None = None
    forwarded: list[str] = []
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--asset":
            if index + 1 >= len(argv):
                raise SystemExit("--asset requires a number from 91 through 100")
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
        raise SystemExit(f"unsupported --asset {selected}; expected 91 through 100")
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
    print("SHEET10_BUILD|" + json.dumps(results, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
