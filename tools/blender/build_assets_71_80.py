"""Build Sheet 08 production assets (71-80) for Pinehollow Golf Flipper.

Run from Blender, for example::

    blender --background --factory-startup --python tools/blender/build_assets_71_80.py -- --asset 71
    blender --background --factory-startup --python tools/blender/build_assets_71_80.py -- --asset 79 --preview

Sheet 8 is the cleaning kit, and it differs from Sheets 6-7 in one structural way:
eight of these ten assets ship twice. A tool that lives in the stockroom and a tool
held in front of the camera are the same object with different obligations -- the
world copy needs collision and rests on the floor, the first-person copy needs no
collision, is authored in the held pose, and carries the grip and emission sockets
the viewmodel actually reads. Building them from one geometry function keeps the two
from drifting; `--asset 71` publishes both.

Orientation contract
--------------------
Everything is metres, +Z up, front/player-facing side on -Y, as with the rest of the
range. World variants sit as the object rests: origin on the floor contact point.
First-person variants are authored in the held pose with the tool pointing forward
along -Y.

Emission sockets matter more here than anywhere else in the project. `toolSockets.js`
treats a socket's local -Z as the direction it emits, so a socket that aims a jet is
rotated (-pi/2, 0, 0) to map -Z onto forward -Y. The whole point of Asset 79 is that
the water leaves the nozzle rather than a hand-tuned camera offset, and that is only
true if SOCKET_SprayEmission sits exactly at the lance tip.

Branding is Pinehollow. The reference art renders "Pineview" marks, which are
AI-generated label artwork and deliberately not reproduced -- motifs here are
original geometry, no third-party or generated text.
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
    71: "vacuum_cleaner",
    72: "mop",
    73: "mop_bucket_and_wringer",
    74: "broom",
    75: "dustpan",
    76: "cleaning_spray_bottle",
    77: "cleaning_cloth_and_sponge_set",
    78: "pressure_washer",
    79: "pressure_washer_hose_and_wand",
    80: "trash_bag",
}

IDENTITIES = {n: A.AssetIdentity(n, slug) for n, slug in SLUGS.items()}

# Assets 73 (bucket) and 78 (washer machine) are floor equipment; they are never held,
# so they ship world-only. The rest are carried and need a viewmodel.
FIRST_PERSON = (71, 72, 74, 75, 76, 77, 79, 80)
FP_IDENTITIES = {n: A.AssetIdentity(n, SLUGS[n], first_person=True) for n in FIRST_PERSON}

# The Sheet 8 contract sizes the *machine or body* of each tool -- it lists asset 71 as
# 0.48 x 0.58 x 0.67 with a separate 2.20 m hose, and asset 79 as a 0.95 m wand with a
# separate 7.50 m hose. Those are the numbers to build the body to, and they are recorded
# on every root as `spec_body_dimensions_m`.
SPEC_BODY_DIMENSIONS = {
    71: (0.48, 0.58, 0.67), 72: (0.32, 0.32, 1.45), 73: (0.55, 0.42, 0.92),
    74: (0.48, 0.09, 1.50), 75: (0.32, 0.30, 0.85), 76: (0.10, 0.07, 0.28),
    77: (0.35, 0.35, 0.09), 78: (0.62, 0.72, 0.95), 79: (0.18, 0.95, 0.30),
    80: (0.55, 0.42, 0.75),
}

# What the shipped asset actually spans, which is what a bounds check can meaningfully
# assert. It differs from the contract wherever an asset ships its accessories: 71
# includes a parked wand and a coiled hose, 73 includes the wringer lever standing proud
# of the tub, 79 includes 7.5 m of hose coiled into a 0.5 m loop. Width (X), depth (Y),
# height (Z), metres. These are measured from the built GLBs, not estimated.
DIMENSIONS = {
    71: (0.68, 0.91, 0.65),
    72: (0.29, 0.29, 1.46),
    73: (0.54, 0.66, 0.93),
    74: (0.48, 0.55, 1.39),
    75: (0.30, 0.28, 0.82),
    76: (0.08, 0.10, 0.26),
    77: (0.36, 0.19, 0.06),
    78: (0.65, 0.72, 0.75),
    79: (0.51, 1.40, 0.22),
    80: (0.50, 0.38, 0.76),
}

# Viewmodels are authored with the origin on the primary grip, so their bounds are
# measured about the hand rather than about a floor.
FP_DIMENSIONS = {
    71: (0.25, 1.11, 0.57),
    72: (0.29, 1.17, 0.91),
    74: (0.48, 1.03, 1.06),
    75: (0.30, 0.61, 0.73),
    76: (0.08, 0.10, 0.26),
    77: (0.32, 0.15, 0.07),
    79: (0.13, 1.10, 0.38),
    80: (0.50, 0.38, 0.76),
}

BUDGETS = {
    71: (26, 20000), 72: (18, 14000), 73: (26, 18000), 74: (18, 14000),
    75: (14, 9000), 76: (16, 9000), 77: (14, 8000), 78: (30, 22000),
    79: (22, 16000), 80: (12, 9000),
}

REQUIRED_MARKERS = {
    71: ("SOCKET_Carry", "SOCKET_Grip", "SOCKET_HoseBody", "SOCKET_HoseWand",
         "SOCKET_DirtIntake", "SOCKET_Audio", "SOCKET_PLACEMENT"),
    72: ("SOCKET_Carry", "SOCKET_GripPrimary", "SOCKET_GripSupport",
         "SOCKET_FloorContact", "SOCKET_Drip", "SOCKET_PLACEMENT"),
    73: ("SOCKET_Carry", "SOCKET_MopInsertion", "SOCKET_Wringer", "SOCKET_WaterSurface",
         "SOCKET_Drip", "PIVOT_WringerLever", "SOCKET_PLACEMENT"),
    74: ("SOCKET_Carry", "SOCKET_GripPrimary", "SOCKET_GripSupport",
         "SOCKET_FloorContact", "SOCKET_DebrisPush", "SOCKET_PLACEMENT"),
    75: ("SOCKET_Carry", "SOCKET_Grip", "SOCKET_PanIntake", "SOCKET_DebrisFill",
         "SOCKET_Emptying", "SOCKET_PLACEMENT"),
    76: ("SOCKET_Carry", "SOCKET_Grip", "SOCKET_Trigger", "SOCKET_SprayEmission",
         "SOCKET_LiquidLevel", "PIVOT_Trigger", "SOCKET_PLACEMENT"),
    77: ("SOCKET_ClothGrip", "SOCKET_ClothContact", "SOCKET_SpongeGrip",
         "SOCKET_SpongeContact", "SOCKET_PLACEMENT"),
    78: ("SOCKET_Carry", "SOCKET_WaterInlet", "SOCKET_PressureOutlet", "SOCKET_Hose",
         "SOCKET_Audio", "SOCKET_PLACEMENT"),
    79: ("SOCKET_HoseMachine", "SOCKET_HoseGun", "SOCKET_GripPrimary", "SOCKET_GripSupport",
         "SOCKET_Trigger", "SOCKET_SprayEmission", "PIVOT_Trigger", "SOCKET_PLACEMENT"),
    80: ("SOCKET_Carry", "SOCKET_Grip", "SOCKET_Opening", "SOCKET_TrashFill",
         "SOCKET_Disposal", "SOCKET_PLACEMENT"),
}

REQUIRED_ANIMATIONS = {
    71: (), 72: (), 74: (), 75: (), 77: (), 80: (),
    73: ("Bucket_WringerClose", "Bucket_WringerOpen", "Bucket_LeverDown", "Bucket_LeverUp"),
    76: ("SprayBottle_Trigger",),
    78: ("PressureWasher_WheelRoll",),
    79: ("WasherWand_TriggerDown", "WasherWand_TriggerUp"),
}

# Equip/unequip/stroke clips are viewmodel motion, authored on the first-person copy.
FP_REQUIRED_MARKERS = {
    71: ("SOCKET_GripPrimary", "SOCKET_GripSupport", "SOCKET_DirtIntake", "SOCKET_Audio"),
    72: ("SOCKET_GripPrimary", "SOCKET_GripSupport", "SOCKET_FloorContact", "SOCKET_Drip"),
    74: ("SOCKET_GripPrimary", "SOCKET_GripSupport", "SOCKET_FloorContact", "SOCKET_DebrisPush"),
    75: ("SOCKET_Grip", "SOCKET_PanIntake", "SOCKET_DebrisFill"),
    76: ("SOCKET_Grip", "SOCKET_Trigger", "SOCKET_SprayEmission", "PIVOT_Trigger"),
    77: ("SOCKET_ClothGrip", "SOCKET_ClothContact", "SOCKET_SpongeGrip", "SOCKET_SpongeContact"),
    79: ("SOCKET_GripPrimary", "SOCKET_GripSupport", "SOCKET_Trigger",
         "SOCKET_SprayEmission", "PIVOT_Trigger"),
    80: ("SOCKET_Grip", "SOCKET_Opening", "SOCKET_TrashFill"),
}

FP_REQUIRED_ANIMATIONS = {
    71: ("Vacuum_Equip", "Vacuum_Unequip", "Vacuum_Start", "Vacuum_Stop", "Vacuum_FloorHeadContact"),
    72: ("Mop_Equip", "Mop_Unequip", "Mop_StrokeLeft", "Mop_StrokeRight", "Mop_HeadCompress"),
    74: ("Broom_Equip", "Broom_Unequip", "Broom_SweepLeft", "Broom_SweepRight", "Broom_BristleContact"),
    75: ("Dustpan_Equip", "Dustpan_Unequip", "Dustpan_SetDown", "Dustpan_PickUp", "Dustpan_Empty"),
    76: ("SprayBottle_Equip", "SprayBottle_Unequip", "SprayBottle_Trigger"),
    77: ("Cloth_Equip", "Cloth_Unequip", "Cloth_Wipe", "Sponge_Equip", "Sponge_Unequip", "Sponge_Scrub"),
    79: ("WasherWand_Equip", "WasherWand_Unequip", "WasherWand_TriggerDown",
         "WasherWand_TriggerUp", "WasherWand_Recoil"),
    80: ("TrashBag_Equip", "TrashBag_Unequip", "TrashBag_Tie", "TrashBag_Dispose"),
}

# A socket's local -Z is the direction it emits. Held tools point down -Y, so an
# emission socket is rotated a quarter turn about X to face the same way.
FORWARD = (-math.pi / 2.0, 0.0, 0.0)
DOWN = (0.0, 0.0, 0.0)  # local -Z already points at the floor


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


def _root(number: int, *, first_person: bool = False, **properties: object):
    identity = FP_IDENTITIES[number] if first_person else IDENTITIES[number]
    dims = FP_DIMENSIONS[number] if first_person else DIMENSIONS[number]
    root = A.asset_root(identity, dims)
    mesh_budget, triangle_budget = BUDGETS[number]
    root["production_sheet"] = "08"
    root["authored_units"] = "meters"
    root["runtime_unit_conversion"] = "meters_to_yards_once:1.0936133"
    root["front_side"] = "player-facing side is -Y"
    root["source_lineage"] = "original deterministic Blender Python; no candidate geometry imported"
    root["license"] = "Project-owned"
    root["visual_style"] = "Pinehollow service equipment; stylized PBR green, charcoal, brass, safety yellow"
    root["mesh_budget"] = mesh_budget
    root["triangle_budget"] = triangle_budget
    root["lod_policy"] = "authored LOD0 with runtime room/distance gating"
    root["representation"] = "first-person" if first_person else "world"
    # The contract figure for the body, kept alongside the measured full-asset extent so
    # the two are never confused for one another.
    root["spec_body_dimensions_m"] = json.dumps(SPEC_BODY_DIMENSIONS[number])
    if first_person:
        root["viewmodel_collision"] = "disabled"
        root["held_pose_axis"] = "tool points forward along -Y"
    for key, value in properties.items():
        root[key] = value
    return root, A.palette_materials()


def _materials() -> dict[str, bpy.types.Material]:
    return {
        "machine_green": A.material("S08_MachineGreen", (0.030, 0.088, 0.052, 1.0), roughness=0.44),
        "machine_shell": A.material("S08_MachineShell", (0.055, 0.130, 0.082, 1.0), roughness=0.40),
        "hard_black": A.material("S08_HardBlack", (0.021, 0.022, 0.024, 1.0), roughness=0.41),
        "matte_black": A.material("S08_MatteBlack", (0.014, 0.015, 0.016, 1.0), roughness=0.72),
        "hose_black": A.material("S08_HoseBlack", (0.026, 0.027, 0.030, 1.0), roughness=0.58),
        "bag_black": A.material("S08_BagPolyethylene", (0.017, 0.018, 0.020, 1.0), roughness=0.29, coat=0.22),
        "bucket_yellow": A.material("S08_BucketYellow", (0.62, 0.44, 0.030, 1.0), roughness=0.47),
        "caution_black": A.material("S08_CautionMark", (0.035, 0.032, 0.020, 1.0), roughness=0.55),
        "mop_cotton": A.material("S08_MopCotton", (0.68, 0.63, 0.52, 1.0), roughness=0.88),
        "bristle": A.material("S08_Bristle", (0.038, 0.036, 0.034, 1.0), roughness=0.80),
        "ash_handle": A.material("S08_AshHandle", (0.44, 0.31, 0.165, 1.0), roughness=0.62),
        "bottle_white": A.material("S08_BottleWhite", (0.74, 0.73, 0.70, 1.0), roughness=0.36),
        "bottle_fluid": A.material("S08_CleanerFluid", (0.24, 0.42, 0.28, 1.0), roughness=0.18,
                                   alpha=0.55, transmission=0.55, double_sided=True),
        "trigger_green": A.material("S08_TriggerGreen", (0.045, 0.175, 0.095, 1.0), roughness=0.42),
        "cloth_green": A.material("S08_MicrofibreGreen", (0.055, 0.155, 0.105, 1.0), roughness=0.90),
        "sponge_yellow": A.material("S08_SpongeYellow", (0.72, 0.58, 0.115, 1.0), roughness=0.93),
        "sponge_scour": A.material("S08_SpongeScour", (0.048, 0.115, 0.062, 1.0), roughness=0.95),
        "safety_yellow": A.material("S08_SafetyYellow", (0.72, 0.52, 0.045, 1.0), roughness=0.52),
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
    """Join finished detail meshes, preserving UVs and material slots.

    Bristles and mop strands are authored as dozens of small pieces because that is
    the honest way to model them, but shipping 60 draw calls for one broom head is
    not. Joining collapses them into a single mesh after the fact.
    """

    meshes = [obj for obj in objects if obj is not None and obj.type == "MESH"]
    if not meshes:
        raise ValueError(f"cannot join empty mesh collection for {name}")
    final_name = name if name.startswith("MESH_") else "MESH_" + name
    if len(meshes) == 1:
        meshes[0].name = final_name
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
    joined.name = final_name
    if parent is not None:
        A.parent_keep_world(joined, parent)
    return joined


def _caster(name: str, location: tuple[float, float, float], parent: bpy.types.Object,
            mats: dict, radius: float = 0.035) -> list[bpy.types.Object]:
    """A swivel caster: rubber tyre, hub, and the fork/stem that mounts it."""

    x, y, z = location
    return [
        A.cylinder(f"{name}_Tyre", radius, 0.022, (x, y, z), mats["matte_black"],
                   rotation=(0.0, math.pi / 2.0, 0.0), vertices=14, parent=parent, bevel=0.004),
        A.cylinder(f"{name}_Hub", radius * 0.42, 0.026, (x, y, z), mats["hard_black"],
                   rotation=(0.0, math.pi / 2.0, 0.0), vertices=10, parent=parent, bevel=0.002),
        A.cylinder(f"{name}_Stem", 0.012, 0.048, (x, y, z + radius + 0.020), mats["hard_black"],
                   vertices=10, parent=parent, bevel=0.002),
    ]


def _fan_strands(name: str, parent: bpy.types.Object, mat: bpy.types.Material, *,
                 count: int, origin: tuple[float, float, float], length: float,
                 spread: float, radius: float, flare: float = 0.30) -> list[bpy.types.Object]:
    """Radial hanging strands, for a cotton mop head.

    Each strand is a thin box tilted outward. Deterministic by construction: the angle
    comes from the index, never from a random seed, so two builds are byte-identical.
    """

    x0, y0, z0 = origin
    pieces = []
    for index in range(count):
        angle = (index / count) * math.tau
        # Alternate the tilt so the skirt reads as layered rather than a cone.
        tilt = spread * (1.0 - flare * (index % 3) / 3.0)
        cx = x0 + math.cos(angle) * radius * 0.55
        cy = y0 + math.sin(angle) * radius * 0.55
        pieces.append(
            A.box(f"{name}_{index:02d}", (0.014, 0.014, length),
                  (cx, cy, z0 - length / 2.0), mat, parent=parent, bevel=0.002,
                  rotation=(math.sin(angle) * tilt, -math.cos(angle) * tilt, 0.0))
        )
    return pieces


def _bristle_block(name: str, parent: bpy.types.Object, mat: bpy.types.Material, *,
                   width: float, depth: float, height: float,
                   center: tuple[float, float, float], columns: int, rows: int) -> list[bpy.types.Object]:
    """A grid of bristle tufts under a broom block."""

    x0, y0, z0 = center
    pieces = []
    for col in range(columns):
        for row in range(rows):
            cx = x0 + (col / max(1, columns - 1) - 0.5) * width
            cy = y0 + (row / max(1, rows - 1) - 0.5) * depth if rows > 1 else y0
            pieces.append(
                A.box(f"{name}_{col:02d}_{row}", (width / columns * 0.72, depth / max(1, rows) * 0.66, height),
                      (cx, cy, z0 - height / 2.0), mat, parent=parent, bevel=0.002)
            )
    return pieces


# ---------------------------------------------------------------------------
# Shared tool geometry. Each returns the group it filled, so the world and
# first-person builders compose the same shapes instead of describing them twice.


def _mop_geometry(parent: bpy.types.Object, m: dict, *, tip_z: float = 0.0,
                  rake: float = 0.0) -> dict:
    """Cotton string mop whose fibres rest at `tip_z` and whose handle leans by `rake`.

    `rake` is the angle off vertical, leaning toward +Y. It exists because the held
    copy cannot simply be the standing copy turned on its side: a real mop head stays
    flat on the floor while the handle angles up to the hands, and rigidly rotating the
    whole tool lifts half the fibres off the ground. Raking the handle while leaving
    the head level is what the first-person reference actually shows.
    """

    handle_len = 1.45 - 0.26
    dy, dz = math.sin(rake), math.cos(rake)
    collar_y, collar_z = dy * 0.26, tip_z + dz * 0.26

    def along(distance: float) -> tuple[float, float, float]:
        return (0.0, dy * distance, tip_z + dz * distance)

    A.cylinder("MopHandle", 0.016, handle_len, along(0.26 + handle_len / 2.0),
               m["ash_handle"], rotation=(rake, 0.0, 0.0), vertices=14, parent=parent, bevel=0.003)
    A.cylinder("MopHandleCap", 0.018, 0.030, along(0.26 + handle_len + 0.004),
               m["hard_black"], rotation=(rake, 0.0, 0.0), vertices=14, parent=parent, bevel=0.003)
    A.cylinder("MopCollar", 0.042, 0.085, along(0.240),
               m["hard_black"], rotation=(rake, 0.0, 0.0), vertices=16, parent=parent, bevel=0.004)
    A.cylinder("MopBand", 0.050, 0.028, along(0.188),
               m["hard_black"], rotation=(rake, 0.0, 0.0), vertices=16, parent=parent, bevel=0.003)
    # Fibres hang under gravity regardless of how the handle is held.
    strands = _fan_strands("MopStrand", parent, m["mop_cotton"], count=26,
                           origin=(0.0, dy * 0.178, tip_z + 0.185), length=0.185,
                           spread=0.62, radius=0.16)
    _join(strands, "MopFibres", parent)
    return {
        "collar": (0.0, collar_y, collar_z),
        "contact": (0.0, dy * 0.178, tip_z + 0.006),
        "drip": (0.0, dy * 0.178, tip_z + 0.070),
        "grip_primary": along(1.16),
        "grip_support": along(0.84),
        "tip_top": along(1.45),
    }


def _broom_geometry(parent: bpy.types.Object, m: dict, *, floor_z: float = 0.0,
                    rake: float = math.radians(22.0)) -> dict:
    """Push broom: wooden block head, black bristles, handle entering at `rake`.

    As with the mop, the block stays flat on the floor and only the handle angle
    changes between the stored copy and the held copy.
    """

    bristle_h = 0.085
    block_z = floor_z + bristle_h + 0.030
    A.box("BroomBlock", (0.48, 0.075, 0.060), (0.0, 0.0, block_z), m["ash_handle"],
          parent=parent, bevel=0.008)
    A.box("BroomBlockCap", (0.44, 0.062, 0.016), (0.0, 0.0, block_z + 0.036),
          m["ash_handle"], parent=parent, bevel=0.005)
    bristles = _bristle_block("BroomBristle", parent, m["bristle"], width=0.455, depth=0.055,
                              height=bristle_h, center=(0.0, 0.0, block_z - 0.030),
                              columns=22, rows=2)
    _join(bristles, "BroomBristles", parent)
    # The handle meets the block through a ferrule; the lean is what makes a push broom
    # readable as a push broom rather than a yard brush.
    tilt = rake
    handle_len = 1.32
    base_z = block_z + 0.048
    dy, dz = math.sin(tilt), math.cos(tilt)

    def along(distance: float) -> tuple[float, float, float]:
        return (0.0, dy * distance, base_z + dz * distance)

    A.cylinder("BroomFerrule", 0.026, 0.075, along(0.030), m["hard_black"],
               rotation=(tilt, 0.0, 0.0), vertices=12, parent=parent, bevel=0.003)
    A.cylinder("BroomHandle", 0.0155, handle_len, along(handle_len / 2.0), m["ash_handle"],
               rotation=(tilt, 0.0, 0.0), vertices=14, parent=parent, bevel=0.003)
    return {
        "block_z": block_z, "tilt": tilt, "handle_len": handle_len,
        "contact": (0.0, 0.0, floor_z + 0.004),
        "debris_push": (0.0, -0.055, floor_z + 0.020),
        "grip_primary": along(handle_len * 0.86),
        "grip_support": along(handle_len * 0.55),
        "tip": along(handle_len),
    }


def _dustpan_geometry(parent: bpy.types.Object, m: dict, *, floor_z: float = 0.0,
                      rake: float = 0.0) -> dict:
    """Long-handled dustpan: sloped pan, front lip, handle leaning back by `rake`."""

    pan_w, pan_d = 0.30, 0.235
    lip_z = floor_z + 0.004
    # The pan floor is a wedge rather than a flat plate so debris reads as sliding in.
    A.profile_prism(
        "DustpanFloor",
        ((-pan_d / 2.0, lip_z), (pan_d / 2.0, lip_z + 0.085), (pan_d / 2.0, lip_z + 0.100),
         (-pan_d / 2.0, lip_z + 0.012)),
        pan_w, (0.0, 0.0, 0.0), m["matte_black"], rotation=(0.0, 0.0, math.pi / 2.0),
        parent=parent, bevel=0.003,
    )
    A.box("DustpanLip", (pan_w, 0.020, 0.008), (0.0, -pan_d / 2.0 - 0.006, lip_z + 0.002),
          m["hard_black"], parent=parent, bevel=0.002)
    for side, sx in (("L", -1.0), ("R", 1.0)):
        A.box(f"DustpanWall{side}", (0.012, pan_d, 0.088),
              (sx * (pan_w / 2.0 - 0.006), 0.006, lip_z + 0.050), m["matte_black"],
              parent=parent, bevel=0.003)
    A.box("DustpanBack", (pan_w, 0.014, 0.115), (0.0, pan_d / 2.0 - 0.004, lip_z + 0.062),
          m["matte_black"], parent=parent, bevel=0.004)
    handle_len = 0.66
    base_y, base_z = pan_d / 2.0 + 0.010, lip_z + 0.118
    dy, dz = math.sin(rake), math.cos(rake)

    def along(distance: float) -> tuple[float, float, float]:
        return (0.0, base_y + dy * distance, base_z + dz * distance)

    A.cylinder("DustpanHandle", 0.014, handle_len, along(handle_len / 2.0),
               m["hard_black"], rotation=(rake, 0.0, 0.0), vertices=12, parent=parent, bevel=0.003)
    A.cylinder("DustpanHandleGrip", 0.020, 0.115, along(handle_len - 0.070),
               m["matte_black"], rotation=(rake, 0.0, 0.0), vertices=12, parent=parent, bevel=0.004)
    A.torus("DustpanHangLoop", 0.020, 0.005, along(handle_len + 0.016), m["hard_black"],
            rotation=(math.pi / 2.0 + rake, 0.0, 0.0), major_segments=16, minor_segments=6,
            parent=parent)
    return {
        "pan_depth": pan_d,
        "intake": (0.0, -pan_d / 2.0 + 0.02, lip_z + 0.02),
        "fill": (0.0, 0.010, lip_z + 0.030),
        "empty": (0.0, -pan_d / 2.0 - 0.03, lip_z + 0.02),
        "grip": along(handle_len - 0.070),
    }


def _spray_bottle_geometry(parent: bpy.types.Object, m: dict, *, base_z: float = 0.0) -> dict:
    """Trigger spray bottle: squared body, shoulder, collar, trigger head, nozzle."""

    body_h = 0.168
    A.box("SprayBody", (0.082, 0.058, body_h), (0.0, 0.0, base_z + body_h / 2.0),
          m["bottle_white"], parent=parent, bevel=0.012, bevel_segments=3)
    # A visible fluid level is what makes the bottle read as a consumable rather than a prop.
    A.box("SprayFluid", (0.070, 0.047, body_h * 0.62), (0.0, 0.0, base_z + body_h * 0.31),
          m["bottle_fluid"], parent=parent, bevel=0.008,
          properties={"liquid_level_proxy": True})
    A.profile_prism(
        "SprayShoulder",
        ((-0.041, base_z + body_h), (0.041, base_z + body_h),
         (0.021, base_z + body_h + 0.030), (-0.021, base_z + body_h + 0.030)),
        0.058, (0.0, 0.0, 0.0), m["bottle_white"], rotation=(0.0, 0.0, math.pi / 2.0),
        parent=parent, bevel=0.004,
    )
    neck_z = base_z + body_h + 0.030
    A.cylinder("SprayCollar", 0.021, 0.026, (0.0, 0.0, neck_z + 0.013), m["trigger_green"],
               vertices=16, parent=parent, bevel=0.003)
    head_z = neck_z + 0.030
    A.box("SprayHead", (0.036, 0.052, 0.034), (0.0, -0.008, head_z + 0.017),
          m["trigger_green"], parent=parent, bevel=0.008, bevel_segments=2)
    A.cylinder("SprayNozzle", 0.009, 0.030, (0.0, -0.044, head_z + 0.021), m["trigger_green"],
               rotation=(math.pi / 2.0, 0.0, 0.0), vertices=12, parent=parent, bevel=0.002)
    A.cylinder("SprayNozzleTip", 0.0055, 0.008, (0.0, -0.061, head_z + 0.021), m["hard_black"],
               rotation=(math.pi / 2.0, 0.0, 0.0), vertices=10, parent=parent, bevel=0.001)
    # An original ring motif stands in for a label. No generated text ships.
    A.torus("SprayBrandRing", 0.020, 0.0035, (0.0, -0.030, base_z + body_h * 0.60),
            m["trigger_green"], rotation=(math.pi / 2.0, 0.0, 0.0),
            major_segments=18, minor_segments=6, parent=parent,
            properties={"fictional_brand_motif": "pinehollow ring", "decorative_only": True})
    nozzle_tip = (0.0, -0.066, head_z + 0.021)
    return {"head_z": head_z, "nozzle_tip": nozzle_tip, "grip": (0.0, 0.010, neck_z - 0.045)}


def _spray_trigger(parent: bpy.types.Object, m: dict, head_z: float) -> bpy.types.Object:
    """The trigger, on its own pivot so it can be squeezed.

    `parent_keep_world` preserves a child's world transform when it is parented, so
    every coordinate here is world-space even though the blade is a child of the
    pivot. Authoring these as pivot-local offsets put the blade under the floor.
    """

    pivot = _pivot("Trigger", parent, (0.0, -0.020, head_z + 0.004),
                   moving_part="spray_trigger", rotation_axis="+X")
    A.box("SprayTriggerBlade", (0.024, 0.014, 0.040), (0.0, -0.014, head_z - 0.016),
          m["trigger_green"], parent=pivot, bevel=0.004)
    return pivot


def _washer_gun_geometry(parent: bpy.types.Object, m: dict, *, origin_z: float = 0.0) -> dict:
    """Pressure-washer gun and lance, authored pointing forward along -Y.

    The lance tip is the single most important coordinate on Sheet 8: it is where the
    jet is emitted and where the cleaning ray starts. Everything else here is dressing.

    `origin_z` lifts the whole assembly. Coordinates are world-space -- `parent_keep_world`
    means a group's transform cannot be used to move geometry that is parented into it
    afterwards -- so the world copy, which has to rest on a floor rather than hang from
    a hand, passes the lift in here instead.
    """

    grip_top_z = origin_z
    # Pistol grip, raked back so the wrist sits naturally.
    A.box("GunGrip", (0.042, 0.056, 0.145), (0.0, 0.055, grip_top_z - 0.082),
          m["hard_black"], parent=parent, bevel=0.012, bevel_segments=3,
          rotation=(math.radians(-13.0), 0.0, 0.0))
    A.box("GunGripStrap", (0.046, 0.020, 0.100), (0.0, 0.082, grip_top_z - 0.072),
          m["matte_black"], parent=parent, bevel=0.006)
    A.box("GunBody", (0.048, 0.150, 0.062), (0.0, 0.010, grip_top_z + 0.006),
          m["hard_black"], parent=parent, bevel=0.010, bevel_segments=2)
    A.box("GunShroud", (0.052, 0.070, 0.048), (0.0, -0.028, grip_top_z + 0.010),
          m["matte_black"], parent=parent, bevel=0.008)
    # Trigger guard: a safety-yellow loop is the single strongest read in the reference.
    A.torus("GunTriggerGuard", 0.040, 0.0075, (0.0, 0.030, grip_top_z - 0.040),
            m["safety_yellow"], rotation=(0.0, math.pi / 2.0, 0.0),
            major_segments=18, minor_segments=6, parent=parent)
    A.cylinder("GunHoseInlet", 0.017, 0.055, (0.0, 0.092, grip_top_z - 0.140), m["hard_black"],
               rotation=(math.radians(-13.0), 0.0, 0.0), vertices=12, parent=parent, bevel=0.003)
    A.cylinder("GunInletNut", 0.021, 0.020, (0.0, 0.098, grip_top_z - 0.166),
               m["restrained_brass"] if "restrained_brass" in m else m["hard_black"],
               rotation=(math.radians(-13.0), 0.0, 0.0), vertices=12, parent=parent, bevel=0.002)
    lance_len = 0.60
    lance_mid_y = -0.075 - lance_len / 2.0
    A.cylinder("WandLance", 0.0125, lance_len, (0.0, lance_mid_y, grip_top_z + 0.010),
               m["matte_black"], rotation=(math.pi / 2.0, 0.0, 0.0), vertices=14,
               parent=parent, bevel=0.002)
    tip_y = -0.075 - lance_len
    A.cylinder("WandTipCollar", 0.017, 0.045, (0.0, tip_y - 0.020, grip_top_z + 0.010),
               m["safety_yellow"], rotation=(math.pi / 2.0, 0.0, 0.0), vertices=12,
               parent=parent, bevel=0.002)
    A.cylinder("WandNozzle", 0.0105, 0.038, (0.0, tip_y - 0.058, grip_top_z + 0.010),
               m["hard_black"], rotation=(math.pi / 2.0, 0.0, 0.0), vertices=12,
               parent=parent, bevel=0.002)
    nozzle_tip = (0.0, tip_y - 0.079, grip_top_z + 0.010)
    return {
        "nozzle_tip": nozzle_tip,
        "grip_primary": (0.0, 0.058, grip_top_z - 0.062),
        "grip_support": (0.0, -0.150, grip_top_z + 0.010),
        "trigger_anchor": (0.0, 0.030, grip_top_z - 0.022),
        "hose_inlet": (0.0, 0.104, grip_top_z - 0.178),
    }


def _washer_trigger(parent: bpy.types.Object, m: dict, anchor) -> bpy.types.Object:
    """Trigger blade on its own pivot. World-space coordinates, as everywhere here."""

    pivot = _pivot("Trigger", parent, anchor, moving_part="washer_trigger", rotation_axis="+X")
    A.box("WandTriggerBlade", (0.020, 0.016, 0.046),
          (anchor[0], anchor[1] + 0.004, anchor[2] - 0.024),
          m["hard_black"], parent=pivot, bevel=0.004)
    return pivot


def _vacuum_wand_geometry(parent: bpy.types.Object, m: dict) -> dict:
    """Vacuum wand and floor head, authored pointing forward/down along -Y.

    The head is what touches the floor, so `intake` is returned in the same frame the
    caller will hang SOCKET_DirtIntake on. Suction that starts anywhere else is the
    defect this asset exists to remove.
    """

    wand_len = 0.72
    A.cylinder("VacWand", 0.019, wand_len, (0.0, -wand_len / 2.0 + 0.05, 0.30),
               m["matte_black"], rotation=(math.radians(74.0), 0.0, 0.0), vertices=14,
               parent=parent, bevel=0.002)
    A.cylinder("VacWandGrip", 0.026, 0.150, (0.0, 0.140, 0.475), m["hard_black"],
               rotation=(math.radians(74.0), 0.0, 0.0), vertices=14, parent=parent, bevel=0.004)
    A.cylinder("VacWandCollar", 0.023, 0.040, (0.0, -0.115, 0.140), m["hard_black"],
               rotation=(math.radians(74.0), 0.0, 0.0), vertices=12, parent=parent, bevel=0.002)
    # Floor head: a wide shallow wedge with a brush strip along its leading edge.
    A.profile_prism(
        "VacHeadShell",
        ((-0.105, 0.020), (0.105, 0.020), (0.080, 0.078), (-0.070, 0.078)),
        0.245, (0.0, -0.150, 0.0), m["matte_black"], rotation=(0.0, 0.0, math.pi / 2.0),
        parent=parent, bevel=0.005,
    )
    A.box("VacHeadSole", (0.245, 0.185, 0.018), (0.0, -0.150, 0.010), m["hard_black"],
          parent=parent, bevel=0.004)
    strip = _bristle_block("VacHeadBrush", parent, m["bristle"], width=0.225, depth=0.016,
                           height=0.014, center=(0.0, -0.232, 0.010), columns=16, rows=1)
    _join(strip, "VacHeadBrushStrip", parent)
    A.cylinder("VacHeadNeck", 0.021, 0.070, (0.0, -0.095, 0.062), m["hard_black"],
               rotation=(math.radians(74.0), 0.0, 0.0), vertices=12, parent=parent, bevel=0.003)
    return {
        "intake": (0.0, -0.196, 0.006),
        "grip_primary": (0.0, 0.150, 0.492),
        "grip_support": (0.0, 0.020, 0.318),
        "hose_wand": (0.0, 0.205, 0.545),
    }


def _trash_bag_geometry(parent: bpy.types.Object, m: dict, *, base_z: float = 0.0) -> dict:
    """Tied refuse sack.

    The spec forbids cloth simulation, so the slump is authored: a wide soft base, a
    tapered shoulder, a gathered neck and a pair of ears. Heavy bevels do the rest.
    """

    A.box("BagBase", (0.50, 0.38, 0.30), (0.0, 0.0, base_z + 0.150), m["bag_black"],
          parent=parent, bevel=0.090, bevel_segments=4)
    A.box("BagBelly", (0.46, 0.35, 0.24), (0.0, 0.0, base_z + 0.360), m["bag_black"],
          parent=parent, bevel=0.085, bevel_segments=4)
    A.box("BagShoulder", (0.31, 0.25, 0.16), (0.0, 0.0, base_z + 0.545), m["bag_black"],
          parent=parent, bevel=0.062, bevel_segments=3)
    A.cylinder("BagNeck", 0.055, 0.070, (0.0, 0.0, base_z + 0.640), m["bag_black"],
               vertices=14, parent=parent, bevel=0.014)
    A.box("BagKnot", (0.105, 0.085, 0.055), (0.0, 0.0, base_z + 0.688), m["bag_black"],
          parent=parent, bevel=0.022, bevel_segments=3)
    for side, sx, tilt in (("L", -1.0, 0.55), ("R", 1.0, -0.55)):
        A.box(f"BagEar{side}", (0.115, 0.075, 0.030), (sx * 0.072, 0.0, base_z + 0.722),
              m["bag_black"], parent=parent, bevel=0.014, rotation=(0.0, tilt, 0.0))
    return {"knot_z": base_z + 0.700, "opening": (0.0, 0.0, base_z + 0.660)}


# ---------------------------------------------------------------------------
# World builders


def build_71() -> bpy.types.Object:
    root, p = _root(71, tool_role="powered_cleaning", intake_driven_cleaning=True)
    m = _materials()
    body = _group("VacuumBody", root)
    rig = _group("VacuumHoseRig", root)

    A.cylinder("VacDrum", 0.235, 0.375, (0.0, 0.0, 0.205), m["machine_green"],
               vertices=28, parent=body, bevel=0.010)
    A.cylinder("VacDrumRib", 0.242, 0.022, (0.0, 0.0, 0.150), m["machine_shell"],
               vertices=28, parent=body, bevel=0.004)
    A.cylinder("VacLid", 0.238, 0.130, (0.0, 0.0, 0.455), m["hard_black"],
               vertices=28, parent=body, bevel=0.012)
    A.cylinder("VacMotorDome", 0.170, 0.105, (0.0, 0.0, 0.555), m["hard_black"],
               vertices=24, parent=body, bevel=0.020)
    A.cylinder("VacExhaust", 0.058, 0.030, (0.0, 0.0, 0.612), m["matte_black"],
               vertices=16, parent=body, bevel=0.004)
    # Carry handle across the lid.
    A.box("VacHandleBar", (0.028, 0.185, 0.026), (0.0, 0.0, 0.640), m["matte_black"],
          parent=body, bevel=0.010)
    for sy in (-1.0, 1.0):
        A.box(f"VacHandlePost{'F' if sy < 0 else 'B'}", (0.024, 0.026, 0.062),
              (0.0, sy * 0.088, 0.600), m["matte_black"], parent=body, bevel=0.006)
    for side, sx, sy in (("FL", -1.0, -1.0), ("FR", 1.0, -1.0), ("BL", -1.0, 1.0), ("BR", 1.0, 1.0)):
        _caster(f"VacCaster{side}", (sx * 0.145, sy * 0.145, 0.035), body, m, radius=0.033)
    # Latches read as the drum being removable, which is what a shop vac is.
    for sx in (-1.0, 1.0):
        A.box(f"VacLatch{'L' if sx < 0 else 'R'}", (0.030, 0.022, 0.055),
              (sx * 0.232, 0.0, 0.400), m["matte_black"], parent=body, bevel=0.006)
    inlet = A.cylinder("VacInletPort", 0.046, 0.055, (0.0, -0.238, 0.300), m["hard_black"],
                       rotation=(math.pi / 2.0, 0.0, 0.0), vertices=16, parent=body, bevel=0.004)
    inlet["port_role"] = "hose_body_connection"

    # A corrugated hose arcing up over the drum and down to a wand parked against it.
    # Kept tight deliberately: a shop vac stored in a cleaning bay has its hose coiled,
    # and a sprawling 1.2 m footprint would claim floor the stockroom does not have.
    A.curve_tube("VacHose", (
        (0.0, -0.262, 0.300), (-0.070, -0.330, 0.420), (0.080, -0.300, 0.560),
        (0.250, -0.190, 0.470), (0.300, -0.090, 0.330),
    ), 0.026, m["hose_black"], parent=rig, resolution=3, bevel_resolution=4)

    wand = _group("VacuumWandAssembly", root)
    geom = _vacuum_wand_geometry(wand, m)
    # Author the wand's own sockets while the assembly is still at its authored origin,
    # then move the group as a whole. Creating them after the move would strand
    # SOCKET_DirtIntake at the untransformed position, so suction would be emitted from
    # empty air beside the floor head -- the exact defect this sheet exists to remove.
    _marker("HoseWand", wand, geom["hose_wand"], rotation=FORWARD, port="wand_inlet")
    _marker("DirtIntake", wand, geom["intake"], rotation=DOWN,
            effect_role="suction_origin", cleaning_contact=True)
    # The world copy parks the wand upright against the drum rather than in a held pose.
    wand.location = (0.315, 0.055, 0.0)
    wand.rotation_euler = (math.radians(-8.0), 0.0, math.radians(-10.0))

    _marker("Carry", root, (0.0, 0.0, 0.640), grip_role="two_hand_lift")
    _marker("Grip", root, (0.0, 0.0, 0.640), grip_role="carry_handle")
    _marker("HoseBody", root, (0.0, -0.262, 0.300), rotation=FORWARD, port="drum_inlet")
    _marker("Audio", root, (0.0, 0.0, 0.555), audio_role="motor_loop")
    _placement(root, "origin centered on floor contact; front is -Y")

    collision = _group("VacuumCollision", root)
    A.collision_cylinder("VacDrumHull", 0.245, 0.640, (0.0, 0.0, 0.320), parent=collision)
    A.collision_box("VacHeadHull", (0.25, 0.20, 0.09), (0.33, -0.465, 0.045), parent=collision)
    return root


def build_72() -> bpy.types.Object:
    root, p = _root(72, tool_role="manual_cleaning", contact_driven_cleaning=True)
    m = _materials()
    tool = _group("MopTool", root)
    geom = _mop_geometry(tool, m, tip_z=0.0)
    _marker("Carry", root, (0.0, 0.0, 0.72), grip_role="single_hand_carry")
    _marker("GripPrimary", root, geom["grip_primary"], rotation=FORWARD, hand="right")
    _marker("GripSupport", root, geom["grip_support"], rotation=FORWARD, hand="left")
    _marker("FloorContact", root, geom["contact"], rotation=DOWN,
            cleaning_contact=True, effect_role="wet_stroke_origin")
    _marker("Drip", root, geom["drip"], rotation=DOWN, effect_role="drip_origin")
    _placement(root, "origin at mop fibre floor contact; handle rises in +Z")
    collision = _group("MopCollision", root)
    A.collision_cylinder("MopHandleHull", 0.05, 1.19, (0.0, 0.0, 0.845), parent=collision)
    A.collision_cylinder("MopHeadHull", 0.16, 0.28, (0.0, 0.0, 0.140), parent=collision)
    return root


def build_73() -> bpy.types.Object:
    root, p = _root(73, fixture_role="cleaning_bay", water_state_owner=True)
    m = _materials()
    tub = _group("BucketTub", root)
    frame = _group("BucketFrame", root)

    # Tapered tub: wider at the rim, as a moulded bucket is.
    A.profile_prism(
        "BucketWall",
        ((-0.215, 0.105), (0.215, 0.105), (0.255, 0.470), (-0.255, 0.470)),
        0.40, (0.0, 0.0, 0.0), m["bucket_yellow"], rotation=(0.0, 0.0, math.pi / 2.0),
        parent=tub, bevel=0.008,
    )
    A.box("BucketFloor", (0.42, 0.385, 0.022), (0.0, 0.0, 0.116), m["bucket_yellow"],
          parent=tub, bevel=0.006)
    A.box("BucketRim", (0.535, 0.405, 0.024), (0.0, 0.0, 0.478), m["bucket_yellow"],
          parent=tub, bevel=0.008)
    # A still water plane the runtime can retint between clean and dirty.
    water = A.box("BucketWater", (0.475, 0.360, 0.008), (0.0, 0.0, 0.352), m["bottle_fluid"],
                  parent=tub, bevel=0.002)
    water["water_surface_proxy"] = True
    water["state_tintable"] = "clean|dirty"
    # Caution motif: original chevron geometry, no generated text.
    for index in range(3):
        A.box(f"BucketCaution_{index}", (0.030, 0.006, 0.070),
              (-0.060 + index * 0.060, -0.204, 0.300), m["caution_black"],
              parent=tub, bevel=0.002, rotation=(0.0, math.radians(24.0), 0.0),
              properties={"decorative_only": True})
    A.box("BucketDrainSpout", (0.070, 0.030, 0.050), (0.215, 0.0, 0.170), m["bucket_yellow"],
          parent=tub, bevel=0.008)

    for side, sx, sy in (("FL", -1.0, -1.0), ("FR", 1.0, -1.0), ("BL", -1.0, 1.0), ("BR", 1.0, 1.0)):
        _caster(f"BucketCaster{side}", (sx * 0.205, sy * 0.155, 0.038), frame, m, radius=0.036)

    # Wringer: a fixed cage plus a hinged press on its own pivot.
    wringer = _group("BucketWringer", root)
    A.box("WringerBody", (0.335, 0.230, 0.180), (0.0, 0.115, 0.600), m["matte_black"],
          parent=wringer, bevel=0.012)
    for sx in (-1.0, 1.0):
        A.box(f"WringerLeg{'L' if sx < 0 else 'R'}", (0.030, 0.028, 0.135),
              (sx * 0.150, 0.115, 0.470), m["matte_black"], parent=wringer, bevel=0.006)
    for index in range(5):
        A.box(f"WringerSlat_{index}", (0.300, 0.016, 0.014),
              (0.0, 0.030 + index * 0.040, 0.520), m["hard_black"], parent=wringer, bevel=0.003)

    # The lever swings about a pivot at the back of the wringer. Its parts are placed in
    # world space, not as offsets from that pivot: `parent_keep_world` preserves a
    # child's world transform when parenting, so pivot-relative numbers would put the
    # press plate 5 cm under the floor rather than inside the cage.
    lever = _pivot("WringerLever", root, (0.0, 0.235, 0.690),
                   moving_part="wringer_lever", rotation_axis="+X")
    A.box("WringerPressPlate", (0.300, 0.150, 0.032), (0.0, 0.150, 0.635),
          m["matte_black"], parent=lever, bevel=0.008)
    # A fairly upright lever, as in the reference: raked far enough back to grab, but not
    # so far that the handle doubles the bucket's floor footprint.
    A.cylinder("WringerLeverArm", 0.016, 0.280, (0.0, 0.313, 0.806), m["matte_black"],
               rotation=(math.radians(34.0), 0.0, 0.0), vertices=12, parent=lever, bevel=0.004)
    A.cylinder("WringerLeverGrip", 0.024, 0.110, (0.0, 0.361, 0.877), m["hard_black"],
               rotation=(math.radians(34.0), 0.0, 0.0), vertices=12, parent=lever, bevel=0.005)

    _marker("Carry", root, (0.0, 0.361, 0.885), grip_role="lever_push")
    _marker("MopInsertion", root, (0.0, 0.115, 0.640), rotation=DOWN,
            insertion_tolerance_m=0.14, accepts_asset=72)
    _marker("Wringer", root, (0.0, 0.115, 0.560), rotation=DOWN)
    _marker("WaterSurface", root, (0.0, -0.060, 0.356), rotation=DOWN)
    _marker("Drip", root, (0.0, 0.115, 0.500), rotation=DOWN, effect_role="drip_origin")
    _placement(root, "origin centered on floor contact; wringer faces +Y, spout on +X")

    collision = _group("BucketCollision", root)
    A.collision_box("BucketTubHull", (0.55, 0.42, 0.40), (0.0, 0.0, 0.290), parent=collision)
    A.collision_box("BucketWringerHull", (0.34, 0.24, 0.22), (0.0, 0.115, 0.610),
                    parent=collision, purpose="non-blocking-interaction")

    closed, opened = (0.0, 0.0, 0.0), (math.radians(-46.0), 0.0, 0.0)
    A.animate_transform_clip(lever, "Bucket_WringerClose",
                             ({"frame": 1, "rotation": opened}, {"frame": 18, "rotation": closed}),
                             interpolation="SINE")
    A.animate_transform_clip(lever, "Bucket_WringerOpen",
                             ({"frame": 1, "rotation": closed}, {"frame": 18, "rotation": opened}),
                             interpolation="SINE")
    A.animate_transform_clip(lever, "Bucket_LeverDown",
                             ({"frame": 1, "rotation": (0.0, 0.0, 0.0)},
                              {"frame": 12, "rotation": (math.radians(-30.0), 0.0, 0.0)}),
                             interpolation="SINE")
    A.animate_transform_clip(lever, "Bucket_LeverUp",
                             ({"frame": 1, "rotation": (math.radians(-30.0), 0.0, 0.0)},
                              {"frame": 12, "rotation": (0.0, 0.0, 0.0)}),
                             interpolation="SINE")
    lever.rotation_euler = closed
    bpy.context.view_layer.update()
    return root


def build_74() -> bpy.types.Object:
    root, p = _root(74, tool_role="manual_cleaning", moves_debris=True)
    m = _materials()
    tool = _group("BroomTool", root)
    geom = _broom_geometry(tool, m, floor_z=0.0)
    _marker("Carry", root, geom["grip_support"], grip_role="single_hand_carry")
    _marker("GripPrimary", root, geom["grip_primary"], rotation=FORWARD, hand="right")
    _marker("GripSupport", root, geom["grip_support"], rotation=FORWARD, hand="left")
    _marker("FloorContact", root, geom["contact"], rotation=DOWN,
            cleaning_contact=True, contact_width_m=0.455)
    _marker("DebrisPush", root, geom["debris_push"], rotation=FORWARD,
            effect_role="debris_push_origin", push_width_m=0.455)
    _placement(root, "origin at bristle floor contact; handle rakes toward +Y")
    collision = _group("BroomCollision", root)
    A.collision_box("BroomHeadHull", (0.48, 0.09, 0.13), (0.0, 0.0, 0.065), parent=collision)
    A.collision_cylinder("BroomHandleHull", 0.045, geom["handle_len"],
                         (0.0, geom["tip"][1] * 0.5, geom["tip"][2] * 0.5),
                         rotation=(geom["tilt"], 0.0, 0.0), parent=collision)
    return root


def build_75() -> bpy.types.Object:
    root, p = _root(75, tool_role="manual_cleaning", collects_debris=True)
    m = _materials()
    tool = _group("DustpanTool", root)
    geom = _dustpan_geometry(tool, m, floor_z=0.0)
    _marker("Carry", root, geom["grip"], grip_role="single_hand_carry")
    _marker("Grip", root, geom["grip"], rotation=FORWARD, hand="right")
    _marker("PanIntake", root, geom["intake"], rotation=FORWARD,
            collection_tolerance_m=0.22, forgiving_intake=True)
    _marker("DebrisFill", root, geom["fill"], rotation=DOWN, fill_state_anchor=True)
    _marker("Emptying", root, geom["empty"], rotation=FORWARD, effect_role="empty_release")
    _placement(root, "origin at pan lip floor contact; opening faces -Y")
    collision = _group("DustpanCollision", root)
    A.collision_box("DustpanPanHull", (0.32, 0.26, 0.13), (0.0, 0.010, 0.062), parent=collision)
    A.collision_cylinder("DustpanHandleHull", 0.030, 0.66, (0.0, 0.128, 0.452), parent=collision)
    return root


def build_76() -> bpy.types.Object:
    root, p = _root(76, tool_role="manual_cleaning", applies_solution=True)
    m = _materials()
    tool = _group("SprayBottle", root)
    geom = _spray_bottle_geometry(tool, m, base_z=0.0)
    trigger = _spray_trigger(tool, m, geom["head_z"])
    _marker("Carry", root, geom["grip"], grip_role="single_hand_carry")
    _marker("Grip", root, geom["grip"], rotation=FORWARD, hand="right")
    _marker("Trigger", root, (0.0, -0.026, geom["head_z"] - 0.014), rotation=FORWARD)
    _marker("SprayEmission", root, geom["nozzle_tip"], rotation=FORWARD,
            effect_role="spray_origin", cone_degrees=17.0, reach_m=1.35)
    _marker("LiquidLevel", root, (0.0, 0.0, 0.104), rotation=DOWN, liquid_level_anchor=True)
    _placement(root, "origin centered on bottle base; nozzle faces -Y")
    collision = _group("SprayCollision", root)
    A.collision_box("SprayBottleHull", (0.10, 0.075, 0.28), (0.0, -0.006, 0.140), parent=collision)
    rest, pulled = (0.0, 0.0, 0.0), (math.radians(19.0), 0.0, 0.0)
    A.animate_transform_clip(trigger, "SprayBottle_Trigger",
                             ({"frame": 1, "rotation": rest}, {"frame": 5, "rotation": pulled},
                              {"frame": 11, "rotation": rest}), interpolation="SINE")
    trigger.rotation_euler = rest
    bpy.context.view_layer.update()
    return root


def build_77() -> bpy.types.Object:
    root, p = _root(77, tool_role="manual_cleaning", set_asset=True)
    m = _materials()
    stack = _group("ClothStack", root)
    # Two folded cloths, the top one offset so the set reads as a stack.
    A.box("ClothFoldedLower", (0.235, 0.185, 0.030), (-0.045, 0.030, 0.015),
          m["cloth_green"], parent=stack, bevel=0.010, bevel_segments=3)
    A.box("ClothFoldedUpper", (0.215, 0.170, 0.026), (-0.052, 0.042, 0.043),
          m["cloth_green"], parent=stack, bevel=0.010, bevel_segments=3)
    A.box("ClothFoldSeam", (0.212, 0.010, 0.022), (-0.052, -0.030, 0.043),
          m["cloth_green"], parent=stack, bevel=0.006)
    sponge = _group("SpongeSet", root)
    A.box("SpongeFoam", (0.110, 0.070, 0.030), (0.145, -0.020, 0.015),
          m["sponge_yellow"], parent=sponge, bevel=0.010, bevel_segments=3)
    A.box("SpongeScourPad", (0.108, 0.068, 0.011), (0.145, -0.020, 0.035),
          m["sponge_scour"], parent=sponge, bevel=0.005)
    _marker("ClothGrip", root, (-0.050, 0.036, 0.058), rotation=FORWARD, hand="right")
    _marker("ClothContact", root, (-0.050, 0.036, 0.000), rotation=DOWN,
            cleaning_contact=True, contact_radius_m=0.13)
    _marker("SpongeGrip", root, (0.145, -0.020, 0.042), rotation=FORWARD, hand="right")
    _marker("SpongeContact", root, (0.145, -0.020, 0.000), rotation=DOWN,
            cleaning_contact=True, contact_radius_m=0.07, scrub_tool=True)
    _placement(root, "origin centered on the set resting on a shelf; front is -Y")
    collision = _group("ClothSetCollision", root)
    A.collision_box("ClothStackHull", (0.24, 0.19, 0.06), (-0.048, 0.036, 0.030), parent=collision)
    A.collision_box("SpongeHull", (0.115, 0.075, 0.045), (0.145, -0.020, 0.022), parent=collision)
    return root


def build_78() -> bpy.types.Object:
    root, p = _root(78, tool_role="powered_machine", grounded_during_use=True)
    m = _materials()
    frame = _group("WasherFrame", root)
    shell = _group("WasherShell", root)

    for sx in (-1.0, 1.0):
        A.box(f"FrameRail{'L' if sx < 0 else 'R'}", (0.032, 0.660, 0.032),
              (sx * 0.265, 0.0, 0.070), m["matte_black"], parent=frame, bevel=0.006)
    A.box("FrameCrossFront", (0.560, 0.032, 0.032), (0.0, -0.315, 0.070), m["matte_black"],
          parent=frame, bevel=0.006)
    A.box("FrameCrossBack", (0.560, 0.032, 0.032), (0.0, 0.315, 0.070), m["matte_black"],
          parent=frame, bevel=0.006)
    A.box("FrameDeck", (0.545, 0.600, 0.024), (0.0, 0.0, 0.100), m["matte_black"],
          parent=frame, bevel=0.005)
    # Big rear wheels and small front feet: this machine is dragged, not driven.
    wheels = []
    for sx in (-1.0, 1.0):
        wheels.append(A.cylinder(f"WasherWheel{'L' if sx < 0 else 'R'}", 0.105, 0.045,
                                 (sx * 0.300, 0.235, 0.105), m["matte_black"],
                                 rotation=(0.0, math.pi / 2.0, 0.0), vertices=20,
                                 parent=frame, bevel=0.005))
        A.cylinder(f"WasherHub{'L' if sx < 0 else 'R'}", 0.038, 0.050,
                   (sx * 0.300, 0.235, 0.105), m["hard_black"],
                   rotation=(0.0, math.pi / 2.0, 0.0), vertices=12, parent=frame, bevel=0.003)
        A.box(f"WasherFoot{'L' if sx < 0 else 'R'}", (0.045, 0.055, 0.055),
              (sx * 0.245, -0.290, 0.028), m["hard_black"], parent=frame, bevel=0.006)

    A.box("WasherEngineBlock", (0.400, 0.400, 0.245), (0.0, 0.045, 0.240), m["machine_green"],
          parent=shell, bevel=0.018, bevel_segments=2)
    A.box("WasherEngineCowl", (0.360, 0.340, 0.085), (0.0, 0.045, 0.400), m["machine_shell"],
          parent=shell, bevel=0.020, bevel_segments=2)
    A.cylinder("WasherAirFilter", 0.085, 0.110, (0.0, 0.240, 0.430), m["hard_black"],
               rotation=(math.pi / 2.0, 0.0, 0.0), vertices=18, parent=shell, bevel=0.008)
    A.cylinder("WasherMuffler", 0.052, 0.170, (0.195, 0.130, 0.330), m["matte_black"],
               rotation=(0.0, 0.0, math.radians(12.0)), vertices=14, parent=shell, bevel=0.005)
    # Brass pump head, the single warmest note on an otherwise dark machine.
    A.box("WasherPumpBody", (0.230, 0.185, 0.140), (0.0, -0.215, 0.205),
          p["restrained_brass"], parent=shell, bevel=0.012)
    A.cylinder("WasherPumpBoss", 0.052, 0.075, (0.0, -0.300, 0.215), p["restrained_brass"],
               rotation=(math.pi / 2.0, 0.0, 0.0), vertices=16, parent=shell, bevel=0.004)
    A.cylinder("WasherInletPort", 0.026, 0.055, (-0.120, -0.300, 0.165), m["hard_black"],
               rotation=(math.pi / 2.0, 0.0, 0.0), vertices=12, parent=shell, bevel=0.003)
    A.cylinder("WasherOutletPort", 0.019, 0.055, (0.120, -0.300, 0.165), p["restrained_brass"],
               rotation=(math.pi / 2.0, 0.0, 0.0), vertices=12, parent=shell, bevel=0.003)
    # Push handle.
    for sx in (-1.0, 1.0):
        A.cylinder(f"WasherHandlePost{'L' if sx < 0 else 'R'}", 0.017, 0.470,
                   (sx * 0.230, 0.300, 0.500), m["matte_black"],
                   rotation=(math.radians(14.0), 0.0, 0.0), vertices=12, parent=frame, bevel=0.003)
    A.cylinder("WasherHandleBar", 0.019, 0.480, (0.0, 0.360, 0.735), m["matte_black"],
               rotation=(0.0, math.pi / 2.0, 0.0), vertices=14, parent=frame, bevel=0.003)
    # Hose reel with a coiled hose, straight from the reference.
    reel = _group("WasherHoseReel", root)
    A.cylinder("ReelDrum", 0.088, 0.150, (0.0, -0.120, 0.560), m["matte_black"],
               rotation=(0.0, math.pi / 2.0, 0.0), vertices=20, parent=reel, bevel=0.006)
    for sx in (-1.0, 1.0):
        A.cylinder(f"ReelFlange{'L' if sx < 0 else 'R'}", 0.135, 0.014,
                   (sx * 0.082, -0.120, 0.560), m["hard_black"],
                   rotation=(0.0, math.pi / 2.0, 0.0), vertices=22, parent=reel, bevel=0.003)
    for index in range(4):
        A.torus(f"ReelCoil_{index}", 0.108 + index * 0.008, 0.013,
                (0.0, -0.120, 0.560), m["hose_black"], rotation=(0.0, math.pi / 2.0, 0.0),
                major_segments=22, minor_segments=7, parent=reel)
    A.cylinder("ReelCrank", 0.010, 0.090, (0.104, -0.190, 0.560), m["hard_black"],
               rotation=(0.0, math.pi / 2.0, 0.0), vertices=10, parent=reel, bevel=0.002)

    _marker("Carry", root, (0.0, 0.360, 0.740), grip_role="push_handle")
    _marker("WaterInlet", root, (-0.120, -0.330, 0.165), rotation=FORWARD, port="garden_hose_in")
    _marker("PressureOutlet", root, (0.120, -0.330, 0.165), rotation=FORWARD, port="high_pressure_out")
    _marker("Hose", root, (0.0, -0.205, 0.560), rotation=FORWARD, port="reel_feed", connects_asset=79)
    _marker("Audio", root, (0.0, 0.045, 0.300), audio_role="engine_loop")
    _placement(root, "origin centered on floor contact; pump and ports face -Y")

    collision = _group("WasherCollision", root)
    A.collision_box("WasherBodyHull", (0.62, 0.68, 0.62), (0.0, 0.0, 0.330), parent=collision)
    A.collision_cylinder("WasherWheelHullL", 0.108, 0.050, (-0.300, 0.235, 0.105),
                         rotation=(0.0, math.pi / 2.0, 0.0), parent=collision)
    A.collision_cylinder("WasherWheelHullR", 0.108, 0.050, (0.300, 0.235, 0.105),
                         rotation=(0.0, math.pi / 2.0, 0.0), parent=collision)

    roll = _group("WasherWheelSpin", root)
    A.animate_transform_clip(roll, "PressureWasher_WheelRoll",
                             ({"frame": 1, "rotation": (0.0, 0.0, 0.0)},
                              {"frame": 24, "rotation": (0.0, math.tau, 0.0)}),
                             interpolation="LINEAR")
    bpy.context.view_layer.update()
    return root


def build_79() -> bpy.types.Object:
    root, p = _root(79, tool_role="powered_cleaning", emission_socket_authoritative=True)
    m = _materials()
    gun = _group("WasherGun", root)
    # The world copy rests on the floor instead of hanging from a hand, so the whole
    # assembly is authored lifted: at 0.175 the bottom of the grip clears the floor by
    # 2 cm and the lance runs level.
    geom = _washer_gun_geometry(gun, m, origin_z=0.175)
    trigger = _washer_trigger(gun, m, geom["trigger_anchor"])

    hose = _group("WasherHoseRun", root)
    # A limited-segment coil, as the collision note requires: readable, not simulated.
    A.curve_tube("WasherHoseCoil", (
        (0.0, 0.140, 0.020), (0.230, 0.230, 0.020), (0.330, 0.430, 0.020),
        (0.190, 0.610, 0.020), (-0.060, 0.560, 0.020), (-0.140, 0.360, 0.020),
        (-0.040, 0.205, 0.020), (0.150, 0.235, 0.020),
    ), 0.018, m["hose_black"], parent=hose, resolution=3, bevel_resolution=4)
    A.cylinder("HoseMachineCoupler", 0.023, 0.060, (0.150, 0.250, 0.020), p["restrained_brass"],
               rotation=(math.pi / 2.0, 0.0, 0.0), vertices=12, parent=hose, bevel=0.003)

    _marker("HoseMachine", root, (0.150, 0.278, 0.020), rotation=FORWARD,
            port="machine_end", connects_asset=78)
    _marker("HoseGun", root, geom["hose_inlet"], rotation=FORWARD, port="gun_end")
    _marker("GripPrimary", root, geom["grip_primary"], rotation=FORWARD, hand="right")
    _marker("GripSupport", root, geom["grip_support"], rotation=FORWARD, hand="left")
    _marker("Trigger", root, geom["trigger_anchor"], rotation=FORWARD)
    _marker("SprayEmission", root, geom["nozzle_tip"], rotation=FORWARD,
            effect_role="jet_origin", authoritative_emission=True,
            jet_degrees=9.0, mist_degrees=24.0, reach_m=7.0)
    _placement(root, "origin centered under the resting gun; lance points -Y")

    collision = _group("WandCollision", root)
    A.collision_box("WandGunHull", (0.19, 0.30, 0.21), (0.0, 0.030, 0.115), parent=collision)
    A.collision_cylinder("WandLanceHull", 0.030, 0.62, (0.0, -0.380, 0.185),
                         rotation=(math.pi / 2.0, 0.0, 0.0), parent=collision)

    rest, pulled = (0.0, 0.0, 0.0), (math.radians(23.0), 0.0, 0.0)
    A.animate_transform_clip(trigger, "WasherWand_TriggerDown",
                             ({"frame": 1, "rotation": rest}, {"frame": 5, "rotation": pulled}),
                             interpolation="SINE")
    A.animate_transform_clip(trigger, "WasherWand_TriggerUp",
                             ({"frame": 1, "rotation": pulled}, {"frame": 6, "rotation": rest}),
                             interpolation="SINE")
    trigger.rotation_euler = rest
    bpy.context.view_layer.update()
    return root


def build_80() -> bpy.types.Object:
    root, p = _root(80, tool_role="manual_cleaning", state_mesh_driven=True)
    m = _materials()
    bag = _group("TrashBag", root)
    geom = _trash_bag_geometry(bag, m, base_z=0.0)
    _marker("Carry", root, (0.0, 0.0, geom["knot_z"]), grip_role="single_hand_carry")
    _marker("Grip", root, (0.0, 0.0, geom["knot_z"]), rotation=FORWARD, hand="right")
    _marker("Opening", root, geom["opening"], rotation=DOWN, opening_radius_m=0.075)
    _marker("TrashFill", root, (0.0, 0.0, 0.240), rotation=DOWN,
            fill_states="empty|partial|full|tied")
    _marker("Disposal", root, (0.0, -0.180, 0.300), rotation=FORWARD, effect_role="dispose_release")
    _placement(root, "origin centered on floor contact; knot rises in +Z")
    collision = _group("TrashBagCollision", root)
    A.collision_hull("TrashBagHull", (
        (-0.25, -0.19, 0.0), (0.25, -0.19, 0.0), (0.25, 0.19, 0.0), (-0.25, 0.19, 0.0),
        (-0.16, -0.13, 0.46), (0.16, -0.13, 0.46), (0.16, 0.13, 0.46), (-0.16, 0.13, 0.46),
        (-0.06, -0.05, 0.72), (0.06, -0.05, 0.72), (0.06, 0.05, 0.72), (-0.06, 0.05, 0.72),
    ), parent=collision)
    return root


# ---------------------------------------------------------------------------
# First-person builders. Same geometry, held pose, no collision.


def _fp_root(number: int, **properties: object):
    return _root(number, first_person=True, **properties)


def _equip_clips(target: bpy.types.Object, prefix: str,
                 *, drop=(0.0, -0.28, -0.34), tilt=(-18.0, 0.0, 9.0)) -> None:
    """Equip/unequip: the tool rises into its held pose and drops back out.

    Home is read from the group's current transform, not assumed to be identity. The
    mop, broom and dustpan are positioned into their held poses before this is called,
    and an equip clip that keyframed them to the origin would snap the tool across the
    screen on every draw. `drop` and `tilt` are offsets from that pose, so the stowed
    position stays correct whatever the rest pose is.
    """

    home_loc = tuple(target.location)
    home_rot = tuple(target.rotation_euler)
    stow_loc = tuple(home_loc[i] + drop[i] for i in range(3))
    stow_rot = tuple(home_rot[i] + math.radians(tilt[i]) for i in range(3))

    A.animate_transform_clip(target, f"{prefix}_Equip",
                             ({"frame": 1, "location": stow_loc, "rotation": stow_rot},
                              {"frame": 9, "location": home_loc, "rotation": home_rot}),
                             interpolation="SINE")
    A.animate_transform_clip(target, f"{prefix}_Unequip",
                             ({"frame": 1, "location": home_loc, "rotation": home_rot},
                              {"frame": 8, "location": stow_loc, "rotation": stow_rot}),
                             interpolation="SINE")
    target.location = home_loc
    target.rotation_euler = home_rot


def _stroke_clips(target: bpy.types.Object, left_name: str, right_name: str, *, yaw: float) -> None:
    """Alternating left/right work strokes, swept about the grip.

    The tool rests at identity and the stroke yaws it around the vertical axis through
    the hand, which is what a mop or broom pass actually looks like from behind it.
    """

    for name, sign in ((left_name, 1.0), (right_name, -1.0)):
        A.animate_transform_clip(target, name, (
            {"frame": 1, "rotation": (0.0, 0.0, 0.0)},
            {"frame": 10, "rotation": (math.radians(4.0), 0.0, math.radians(yaw) * sign)},
            {"frame": 20, "rotation": (0.0, 0.0, 0.0)},
        ), interpolation="SINE")
    target.rotation_euler = (0.0, 0.0, 0.0)


def build_71_fp() -> bpy.types.Object:
    root, p = _root(71, first_person=True, tool_role="powered_cleaning")
    m = _materials()
    held = _group("VacuumHeld", root)
    geom = _vacuum_wand_geometry(held, m)
    # A short hose tail sells the wand as connected to something off-screen.
    A.curve_tube("VacHoseTail", (
        (0.0, 0.205, 0.545), (0.06, 0.330, 0.500), (0.10, 0.430, 0.395),
    ), 0.026, m["hose_black"], parent=held, resolution=3, bevel_resolution=4)
    _marker("GripPrimary", held, geom["grip_primary"], rotation=FORWARD, hand="right")
    _marker("GripSupport", held, geom["grip_support"], rotation=FORWARD, hand="left")
    _marker("DirtIntake", held, geom["intake"], rotation=DOWN,
            effect_role="suction_origin", cleaning_contact=True, authoritative_emission=True)
    _marker("Audio", held, geom["grip_primary"], audio_role="motor_loop")
    _hold_at_grip(held, geom["grip_primary"])
    _equip_clips(held, "Vacuum")
    home = tuple(held.location)
    A.animate_transform_clip(held, "Vacuum_Start",
                             ({"frame": 1, "rotation": (0.0, 0.0, 0.0)},
                              {"frame": 4, "rotation": (math.radians(-2.2), 0.0, 0.0)},
                              {"frame": 12, "rotation": (0.0, 0.0, 0.0)}), interpolation="SINE")
    A.animate_transform_clip(held, "Vacuum_Stop",
                             ({"frame": 1, "rotation": (0.0, 0.0, 0.0)},
                              {"frame": 9, "rotation": (math.radians(1.4), 0.0, 0.0)},
                              {"frame": 16, "rotation": (0.0, 0.0, 0.0)}), interpolation="SINE")
    A.animate_transform_clip(held, "Vacuum_FloorHeadContact",
                             ({"frame": 1, "location": home},
                              {"frame": 6, "location": (home[0], home[1], home[2] - 0.012)},
                              {"frame": 14, "location": home}), interpolation="SINE")
    held.location = home
    held.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    return root


def _hold_at_grip(held: bpy.types.Object, grip: Sequence[float]) -> None:
    """Shift a held assembly so the primary grip lands on the asset origin.

    First-person GLBs are attached to a hand, not stood on a floor, so the origin that
    is useful is the one the hand is at. Doing it by moving the group after the parts
    and sockets are parented keeps geometry and sockets in lockstep -- the alternative,
    hand-computing every socket in post-transform space, is how a nozzle ends up 4 cm
    from the water it emits.
    """

    held.location = (-float(grip[0]), -float(grip[1]), -float(grip[2]))
    bpy.context.view_layer.update()


def build_72_fp() -> bpy.types.Object:
    root, p = _root(72, first_person=True, tool_role="manual_cleaning")
    m = _materials()
    held = _group("MopHeld", root)
    # Head flat on the floor ahead of the player, handle raking back to the hands.
    geom = _mop_geometry(held, m, tip_z=0.0, rake=math.radians(52.0))
    _marker("GripPrimary", held, geom["grip_primary"], rotation=FORWARD, hand="right")
    _marker("GripSupport", held, geom["grip_support"], rotation=FORWARD, hand="left")
    _marker("FloorContact", held, geom["contact"], rotation=DOWN,
            cleaning_contact=True, contact_radius_m=0.17, authoritative_emission=True)
    _marker("Drip", held, geom["drip"], rotation=DOWN, effect_role="drip_origin")
    _hold_at_grip(held, geom["grip_primary"])
    _equip_clips(held, "Mop")
    _stroke_clips(held, "Mop_StrokeLeft", "Mop_StrokeRight", yaw=14.0)
    home = tuple(held.location)
    A.animate_transform_clip(held, "Mop_HeadCompress",
                             ({"frame": 1, "location": home},
                              {"frame": 6, "location": (home[0], home[1], home[2] - 0.020)},
                              {"frame": 14, "location": home}), interpolation="SINE")
    held.location = home
    held.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    return root


def build_74_fp() -> bpy.types.Object:
    root, p = _root(74, first_person=True, tool_role="manual_cleaning")
    m = _materials()
    held = _group("BroomHeld", root)
    # Block flat on the floor, handle raked back steeply toward the hands.
    geom = _broom_geometry(held, m, floor_z=0.0, rake=math.radians(48.0))
    _marker("GripPrimary", held, geom["grip_primary"], rotation=FORWARD, hand="right")
    _marker("GripSupport", held, geom["grip_support"], rotation=FORWARD, hand="left")
    _marker("FloorContact", held, geom["contact"], rotation=DOWN,
            cleaning_contact=True, contact_width_m=0.455, authoritative_emission=True)
    _marker("DebrisPush", held, geom["debris_push"], rotation=FORWARD,
            effect_role="debris_push_origin", push_width_m=0.455)
    _hold_at_grip(held, geom["grip_primary"])
    _equip_clips(held, "Broom")
    _stroke_clips(held, "Broom_SweepLeft", "Broom_SweepRight", yaw=20.0)
    home = tuple(held.location)
    A.animate_transform_clip(held, "Broom_BristleContact",
                             ({"frame": 1, "location": home},
                              {"frame": 5, "location": (home[0], home[1], home[2] - 0.016)},
                              {"frame": 13, "location": home}), interpolation="SINE")
    held.location = home
    held.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    return root


def build_75_fp() -> bpy.types.Object:
    root, p = _root(75, first_person=True, tool_role="manual_cleaning")
    m = _materials()
    held = _group("DustpanHeld", root)
    # Pan flat on the floor, handle leaning back to the hand.
    geom = _dustpan_geometry(held, m, floor_z=0.0, rake=math.radians(30.0))
    _marker("Grip", held, geom["grip"], rotation=FORWARD, hand="right")
    _marker("PanIntake", held, geom["intake"], rotation=FORWARD,
            collection_tolerance_m=0.22, forgiving_intake=True, authoritative_emission=True)
    _marker("DebrisFill", held, geom["fill"], rotation=DOWN, fill_state_anchor=True)
    _hold_at_grip(held, geom["grip"])
    _equip_clips(held, "Dustpan")
    home = tuple(held.location)
    down = (home[0], home[1] - 0.10, home[2] - 0.14)
    A.animate_transform_clip(held, "Dustpan_SetDown",
                             ({"frame": 1, "location": home, "rotation": (0.0, 0.0, 0.0)},
                              {"frame": 12, "location": down,
                               "rotation": (math.radians(-6.0), 0.0, 0.0)}), interpolation="SINE")
    A.animate_transform_clip(held, "Dustpan_PickUp",
                             ({"frame": 1, "location": down,
                               "rotation": (math.radians(-6.0), 0.0, 0.0)},
                              {"frame": 12, "location": home,
                               "rotation": (0.0, 0.0, 0.0)}), interpolation="SINE")
    # Tipping the pan up is how a full one is emptied into a bag.
    A.animate_transform_clip(held, "Dustpan_Empty",
                             ({"frame": 1, "rotation": (0.0, 0.0, 0.0)},
                              {"frame": 10, "rotation": (math.radians(88.0), 0.0, 0.0)},
                              {"frame": 22, "rotation": (0.0, 0.0, 0.0)}),
                             interpolation="SINE")
    held.location = home
    held.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    return root


def build_76_fp() -> bpy.types.Object:
    root, p = _root(76, first_person=True, tool_role="manual_cleaning")
    m = _materials()
    held = _group("SprayHeld", root)
    geom = _spray_bottle_geometry(held, m, base_z=0.0)
    trigger = _spray_trigger(held, m, geom["head_z"])
    _marker("Grip", held, geom["grip"], rotation=FORWARD, hand="right")
    _marker("Trigger", held, (0.0, -0.026, geom["head_z"] - 0.014), rotation=FORWARD)
    _marker("SprayEmission", held, geom["nozzle_tip"], rotation=FORWARD,
            effect_role="spray_origin", authoritative_emission=True,
            cone_degrees=17.0, reach_m=1.35)
    _hold_at_grip(held, geom["grip"])
    _equip_clips(held, "SprayBottle")
    rest, pulled = (0.0, 0.0, 0.0), (math.radians(19.0), 0.0, 0.0)
    A.animate_transform_clip(trigger, "SprayBottle_Trigger",
                             ({"frame": 1, "rotation": rest}, {"frame": 4, "rotation": pulled},
                              {"frame": 10, "rotation": rest}), interpolation="SINE")
    trigger.rotation_euler = rest
    bpy.context.view_layer.update()
    return root


def build_77_fp() -> bpy.types.Object:
    root, p = _root(77, first_person=True, tool_role="manual_cleaning")
    m = _materials()
    cloth = _group("ClothHeld", root)
    # In hand the cloth is bunched, not folded flat on a shelf.
    A.box("ClothBody", (0.175, 0.150, 0.058), (0.0, 0.0, 0.030), m["cloth_green"],
          parent=cloth, bevel=0.026, bevel_segments=3)
    A.box("ClothFoldA", (0.150, 0.036, 0.042), (0.0, -0.055, 0.048), m["cloth_green"],
          parent=cloth, bevel=0.016, bevel_segments=2)
    A.box("ClothFoldB", (0.145, 0.032, 0.038), (0.0, 0.058, 0.044), m["cloth_green"],
          parent=cloth, bevel=0.015, bevel_segments=2)
    sponge = _group("SpongeHeld", root)
    A.box("SpongeFoam", (0.110, 0.070, 0.030), (0.180, 0.0, 0.022),
          m["sponge_yellow"], parent=sponge, bevel=0.010, bevel_segments=3)
    A.box("SpongeScourPad", (0.108, 0.068, 0.011), (0.180, 0.0, 0.001),
          m["sponge_scour"], parent=sponge, bevel=0.005)
    _marker("ClothGrip", root, (0.0, 0.0, 0.058), rotation=FORWARD, hand="right")
    _marker("ClothContact", root, (0.0, 0.0, 0.000), rotation=DOWN,
            cleaning_contact=True, contact_radius_m=0.10, authoritative_emission=True)
    _marker("SpongeGrip", root, (0.180, 0.0, 0.040), rotation=FORWARD, hand="right")
    _marker("SpongeContact", root, (0.180, 0.0, -0.006), rotation=DOWN,
            cleaning_contact=True, contact_radius_m=0.06, scrub_tool=True)
    _equip_clips(cloth, "Cloth")
    _equip_clips(sponge, "Sponge")
    A.animate_transform_clip(cloth, "Cloth_Wipe", (
        {"frame": 1, "location": (0.0, 0.0, 0.0), "rotation": (0.0, 0.0, 0.0)},
        {"frame": 8, "location": (0.085, 0.0, -0.012), "rotation": (0.0, 0.0, math.radians(-7.0))},
        {"frame": 16, "location": (-0.085, 0.0, -0.012), "rotation": (0.0, 0.0, math.radians(7.0))},
        {"frame": 24, "location": (0.0, 0.0, 0.0), "rotation": (0.0, 0.0, 0.0)},
    ), interpolation="SINE")
    A.animate_transform_clip(sponge, "Sponge_Scrub", (
        {"frame": 1, "location": (0.0, 0.0, 0.0)},
        {"frame": 5, "location": (0.030, -0.022, -0.008)},
        {"frame": 10, "location": (-0.030, 0.022, -0.008)},
        {"frame": 15, "location": (0.0, 0.0, 0.0)},
    ), interpolation="SINE")
    for group in (cloth, sponge):
        group.location = (0.0, 0.0, 0.0)
        group.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    return root


def build_79_fp() -> bpy.types.Object:
    root, p = _root(79, first_person=True, tool_role="powered_cleaning",
                    emission_socket_authoritative=True)
    m = _materials()
    held = _group("WandHeld", root)
    geom = _washer_gun_geometry(held, m)
    trigger = _washer_trigger(held, m, geom["trigger_anchor"])
    A.curve_tube("WandHoseTail", (
        (0.0, 0.104, -0.178), (0.05, 0.230, -0.235), (0.09, 0.330, -0.330),
    ), 0.018, m["hose_black"], parent=held, resolution=3, bevel_resolution=4)
    _marker("GripPrimary", held, geom["grip_primary"], rotation=FORWARD, hand="right")
    _marker("GripSupport", held, geom["grip_support"], rotation=FORWARD, hand="left")
    _marker("Trigger", held, geom["trigger_anchor"], rotation=FORWARD)
    # The one socket the whole pressure-washer feature depends on.
    _marker("SprayEmission", held, geom["nozzle_tip"], rotation=FORWARD,
            effect_role="jet_origin", authoritative_emission=True,
            jet_degrees=9.0, mist_degrees=24.0, reach_m=7.0)
    _hold_at_grip(held, geom["grip_primary"])
    _equip_clips(held, "WasherWand")
    rest, pulled = (0.0, 0.0, 0.0), (math.radians(23.0), 0.0, 0.0)
    A.animate_transform_clip(trigger, "WasherWand_TriggerDown",
                             ({"frame": 1, "rotation": rest}, {"frame": 4, "rotation": pulled}),
                             interpolation="SINE")
    A.animate_transform_clip(trigger, "WasherWand_TriggerUp",
                             ({"frame": 1, "rotation": pulled}, {"frame": 6, "rotation": rest}),
                             interpolation="SINE")
    # Recoil settles back rather than snapping, so holding the trigger reads as steady pressure.
    home = tuple(held.location)
    A.animate_transform_clip(held, "WasherWand_Recoil", (
        {"frame": 1, "location": home, "rotation": (0.0, 0.0, 0.0)},
        {"frame": 3, "location": (home[0], home[1] + 0.022, home[2] + 0.006),
         "rotation": (math.radians(2.6), 0.0, 0.0)},
        {"frame": 12, "location": home, "rotation": (0.0, 0.0, 0.0)},
    ), interpolation="SINE")
    trigger.rotation_euler = rest
    held.location = home
    held.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    return root


def build_80_fp() -> bpy.types.Object:
    root, p = _root(80, first_person=True, tool_role="manual_cleaning")
    m = _materials()
    held = _group("BagHeld", root)
    geom = _trash_bag_geometry(held, m, base_z=0.0)
    # Carried from the knot, so the bag hangs below the hand.
    held.location = (0.0, 0.0, -0.70)
    bpy.context.view_layer.update()
    _marker("Grip", root, (0.0, 0.0, 0.0), rotation=FORWARD, hand="right")
    _marker("Opening", root, (0.0, 0.0, -0.040), rotation=DOWN, opening_radius_m=0.075)
    _marker("TrashFill", root, (0.0, 0.0, -0.460), rotation=DOWN,
            fill_states="empty|partial|full|tied")
    A.animate_transform_clip(held, "TrashBag_Equip",
                             ({"frame": 1, "location": (0.0, -0.24, -1.02)},
                              {"frame": 10, "location": (0.0, 0.0, -0.70)}), interpolation="SINE")
    A.animate_transform_clip(held, "TrashBag_Unequip",
                             ({"frame": 1, "location": (0.0, 0.0, -0.70)},
                              {"frame": 9, "location": (0.0, -0.24, -1.02)}), interpolation="SINE")
    # Carry sway: the bag is heavy and soft, so it lags the hand.
    A.animate_transform_clip(held, "TrashBag_Tie", (
        {"frame": 1, "rotation": (0.0, 0.0, 0.0)},
        {"frame": 8, "rotation": (0.0, 0.0, math.radians(26.0))},
        {"frame": 18, "rotation": (0.0, 0.0, 0.0)},
    ), interpolation="SINE")
    A.animate_transform_clip(held, "TrashBag_Dispose", (
        {"frame": 1, "location": (0.0, 0.0, -0.70), "rotation": (0.0, 0.0, 0.0)},
        {"frame": 10, "location": (0.0, -0.34, -0.52), "rotation": (math.radians(-22.0), 0.0, 0.0)},
        {"frame": 18, "location": (0.0, -0.52, -1.05), "rotation": (math.radians(-38.0), 0.0, 0.0)},
    ), interpolation="SINE")
    held.location = (0.0, 0.0, -0.70)
    held.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    return root


BUILDERS: dict[int, Callable[[], bpy.types.Object]] = {
    71: build_71, 72: build_72, 73: build_73, 74: build_74, 75: build_75,
    76: build_76, 77: build_77, 78: build_78, 79: build_79, 80: build_80,
}

FP_BUILDERS: dict[int, Callable[[], bpy.types.Object]] = {
    71: build_71_fp, 72: build_72_fp, 74: build_74_fp, 75: build_75_fp,
    76: build_76_fp, 77: build_77_fp, 79: build_79_fp, 80: build_80_fp,
}


def _parse_cli(argv: Sequence[str]) -> tuple[int | None, bool, A.BuildOptions]:
    selected: int | None = None
    world_only = False
    forwarded: list[str] = []
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--asset":
            if index + 1 >= len(argv):
                raise SystemExit("--asset requires a number from 71 through 80")
            selected = int(argv[index + 1])
            index += 2
            continue
        if arg.startswith("--asset="):
            selected = int(arg.split("=", 1)[1])
            index += 1
            continue
        if arg == "--world-only":
            world_only = True
            index += 1
            continue
        forwarded.append(arg)
        index += 1
    if selected is not None and selected not in BUILDERS:
        raise SystemExit(f"unsupported --asset {selected}; expected 71 through 80")
    return selected, world_only, A.parse_asset_cli(forwarded)


def main(argv: Sequence[str] | None = None) -> int:
    selected, world_only, options = _parse_cli(
        A.blender_cli_args(sys.argv) if argv is None else list(argv))
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
            "asset": number, "representation": "world",
            "paths": result.paths.as_relative_dict(),
            "canonical_sha256": result.canonical_sha256,
            "runtime_sha256": result.runtime_sha256,
            "validation": result.validation.to_dict(),
        })
        if world_only or number not in FP_BUILDERS:
            continue
        A.reset_scene(seed=options.seed + number + 500)
        fp_root = FP_BUILDERS[number]()
        fp_root["deterministic_seed"] = options.seed + number + 500
        fp_result = A.publish_asset(
            FP_IDENTITIES[number], fp_root, options=options,
            expected_dimensions=FP_DIMENSIONS[number],
            required_sockets=FP_REQUIRED_MARKERS[number],
            required_animations=FP_REQUIRED_ANIMATIONS[number],
            require_collision=False,
        )
        results.append({
            "asset": number, "representation": "first-person",
            "paths": fp_result.paths.as_relative_dict(),
            "canonical_sha256": fp_result.canonical_sha256,
            "runtime_sha256": fp_result.runtime_sha256,
            "validation": fp_result.validation.to_dict(),
        })
    print("SHEET08_BUILD|" + json.dumps(results, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
