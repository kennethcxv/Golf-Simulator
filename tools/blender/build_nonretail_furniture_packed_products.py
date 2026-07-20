"""Build truthful packed representations for the two FURNITURE1 decor SKUs.

Run from the repository root with Blender 5.1+:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
        --background --factory-startup \
        --python tools/blender/build_nonretail_furniture_packed_products.py

The outputs are not shipping cartons.  They are the one-per-crate product
bundles revealed after the furniture crate is opened:

* ``rug1`` is a 2.4 x 1.6 m lounge rug rolled onto a core and protected to an
  exact 1.18 W x 0.24 H x 0.24 D metre packed envelope.
* ``lounge1`` is a 2.1 m lounge suite represented by separated frame panels,
  compressed cushions and tensioned freight straps in an exact
  1.18 W x 0.80 H x 0.78 D metre packed envelope.

Geometry is original, procedural, project-owned work.  Existing Pinehollow
lounge source files and an in-game lounge screenshot are immutable visual
references only; this script hashes them before and after the build and never
opens them for editing.  No external asset is downloaded or embedded.

Authoring axes are X width, Y depth (-Y is the player-facing front), Z height.
The Y-up glTF export therefore reports runtime dimensions as X width, Y height,
Z depth.  Both assets rest on Z=0 and forbid runtime scaling.
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
    box,
    collision_box,
    cylinder,
    descendants,
    empty,
    finish_mesh,
    mat,
    parent_keep,
    reset_scene,
    text_mesh,
    torus,
)


SOURCE_DIR = ROOT / "asset_sources" / "blender" / "delivery"
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
QA_PASS = os.environ.get("NONRETAIL_FURNITURE_QA_PASS", "pass-01").strip() or "pass-01"
QA_DIR = ROOT / "qa" / "box_system_master" / "nonretail_furniture_packed" / QA_PASS
for directory in (SOURCE_DIR, EXPORT_DIR, QA_DIR):
    directory.mkdir(parents=True, exist_ok=True)

BUILD_VERSION = 1
RUG_ID = "packed_product_rug1"
LOUNGE_ID = "packed_product_lounge1"

# Dimensions are authoring X/Y/Z followed by runtime X/Y/Z.
SPECS = {
    RUG_ID: {
        "logical_sku": "rug1",
        "product_name": "Pine lounge rug",
        "author_dims": (1.18, 0.24, 0.24),
        "runtime_dims": (1.18, 0.24, 0.24),
        "physical_runtime_dims": (2.40, 0.018, 1.60),
        "packed_state": "rolled-on-core-with-end-blocks",
        "packed_orientation": "roll-lengthwise",
        "weight_lb": 24,
        "long_product": True,
        "reference_paths": (
            ROOT / "qa" / "clubhouse-production" / "pass-3" / "09-lounge.jpeg",
        ),
    },
    LOUNGE_ID: {
        "logical_sku": "lounge1",
        "product_name": "Lounge set",
        "author_dims": (1.18, 0.78, 0.80),
        "runtime_dims": (1.18, 0.80, 0.78),
        "physical_runtime_dims": (2.10, 0.90, 0.85),
        "packed_state": "flat-packed-frame-cushions-compressed",
        "packed_orientation": "panels-lengthwise",
        "weight_lb": 110,
        "long_product": False,
        "reference_paths": (
            ROOT / "Assets" / "checkout" / "source" / "lounge_armchair.blend",
            ROOT / "Assets" / "checkout" / "source" / "lounge_coffee_table.blend",
            ROOT / "Assets" / "checkout" / "source" / "lounge_side_table.blend",
        ),
    },
}

REQUIRED_NODES = {
    RUG_ID: {
        "RUG_PACKED_ASSEMBLY",
        "RUG_ROLL_BODY",
        "RUG_CORE",
        "RUG_END_BLOCK_WEST_FRONT_BOTTOM",
        "RUG_END_BLOCK_EAST_REAR_TOP",
        "RUG_BAND_WEST",
        "RUG_BAND_EAST",
        "RUG_LABEL_BACKING",
        "RUG_LABEL_TEXT",
        "PICKUP_TARGET",
        "PLACEMENT_TARGET",
        "SHELF_TARGET",
        "COL_PACKED_RUG1",
    },
    LOUNGE_ID: {
        "LOUNGE_PACKED_ASSEMBLY",
        "LOUNGE_BASE_PANEL",
        "LOUNGE_BACK_PANEL",
        "LOUNGE_SIDE_PANEL_WEST",
        "LOUNGE_SIDE_PANEL_EAST",
        "LOUNGE_TABLE_TOP_PANEL",
        "LOUNGE_COMPRESSED_CUSHION_01",
        "LOUNGE_COMPRESSED_CUSHION_02",
        "LOUNGE_COMPRESSED_CUSHION_03",
        "LOUNGE_STRAP_WEST_FRONT",
        "LOUNGE_STRAP_EAST_TOP",
        "LOUNGE_HARDWARE_POUCH",
        "PICKUP_TARGET",
        "PLACEMENT_TARGET",
        "SHELF_TARGET",
        "COL_PACKED_LOUNGE1",
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_hashes() -> dict[str, str]:
    result = {}
    for spec in SPECS.values():
        for path in spec["reference_paths"]:
            if not path.is_file():
                raise RuntimeError(f"project-owned reference source is missing: {path}")
            result[path.relative_to(ROOT).as_posix()] = sha256(path)
    return dict(sorted(result.items()))


def set_scene_metadata() -> None:
    scene = bpy.context.scene
    scene["asset_build_script"] = SCRIPT.relative_to(ROOT).as_posix()
    scene["asset_build_version"] = BUILD_VERSION
    scene["units"] = "meters"
    scene["external_downloads"] = 0
    scene["raw_sources_modified"] = False
    scene["purpose"] = "opened FURNITURE1 crate content representation"


def furniture_materials():
    # Pinehollow's stylized PBR palette.  Collision is intentionally invisible
    # but remains a separately named simple proxy in the exported hierarchy.
    materials = {
        "cream": mat("M_FreightWarmCream", (0.91, 0.86, 0.73, 1.0), roughness=0.78),
        "green": mat("M_FreightDeepGolfGreen", (0.055, 0.22, 0.12, 1.0), roughness=0.62),
        "sage": mat("M_FreightMutedSage", (0.38, 0.52, 0.40, 1.0), roughness=0.78),
        "sage_dark": mat("M_FreightSageShadow", (0.21, 0.34, 0.24, 1.0), roughness=0.82),
        "walnut": mat("M_FreightMediumWalnut", (0.28, 0.17, 0.095, 1.0), roughness=0.58),
        "oak": mat("M_FreightNaturalOak", (0.66, 0.47, 0.27, 1.0), roughness=0.64),
        "charcoal": mat("M_FreightWarmCharcoal", (0.055, 0.065, 0.075, 1.0), roughness=0.68),
        "brass": mat("M_FreightRestrainedBrass", (0.58, 0.39, 0.12, 1.0), roughness=0.34, metallic=0.74),
        "kraft": mat("M_FreightKraftProtection", (0.62, 0.43, 0.24, 1.0), roughness=0.88),
        "collision": mat("M_FreightCollision", (1.0, 0.0, 1.0, 0.0), roughness=1.0),
    }
    collision_material = materials["collision"]
    if hasattr(collision_material, "surface_render_method"):
        collision_material.surface_render_method = "DITHERED"
    collision_material.use_transparency_overlap = False
    return materials


def product_root(asset_id: str):
    spec = SPECS[asset_id]
    references = [path.relative_to(ROOT).as_posix() for path in spec["reference_paths"]]
    hashes = {path: sha256(ROOT / path) for path in references}
    return empty(
        asset_id,
        props={
            "asset_id": asset_id,
            "asset_version": BUILD_VERSION,
            "version": BUILD_VERSION,
            "logical_sku": spec["logical_sku"],
            "product_name": spec["product_name"],
            "asset_type": "nonretail_furniture_packed_product",
            "layout_id": "FURNITURE1",
            "units_per_box": 1,
            "packed_state": spec["packed_state"],
            "packed_orientation": spec["packed_orientation"],
            "target_dimensions_m": list(spec["author_dims"]),
            "runtime_dimensions_m": list(spec["runtime_dims"]),
            "physical_dimensions_runtime_m": list(spec["physical_runtime_dims"]),
            "unit_weight_lb": spec["weight_lb"],
            "long_product": spec["long_product"],
            "units": "meters",
            "front": "-Y (player-facing opened-crate side)",
            "rests_on": "Z=0",
            "allow_runtime_scale": False,
            "placement_fixture": "decor-floor",
            "source_references": ";".join(references),
            "source_hashes_json": json.dumps(hashes, sort_keys=True),
            "derivation": "original packed-state reinterpretation of immutable project-owned visual references",
            "source_geometry_copied": False,
            "raw_sources_modified": False,
            "external_assets": 0,
            "license": "Project-owned / UNLICENSED",
            "builder": SCRIPT.relative_to(ROOT).as_posix(),
        },
        size=0.045,
    )


def open_sleeve_x(name, radius, length, loc, material, *, parent, props=None, segments=32):
    """UV'd cylindrical strap sleeve around the X axis, intentionally uncapped."""
    half = length / 2
    vertices = []
    for x in (-half, half):
        for segment in range(segments):
            angle = math.tau * segment / segments
            vertices.append((loc[0] + x, loc[1] + radius * math.cos(angle), loc[2] + radius * math.sin(angle)))
    faces = []
    for segment in range(segments):
        following = (segment + 1) % segments
        faces.append((segment, following, segments + following, segments + segment))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate(clean_customdata=False)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish_mesh(obj, material, bevel_width=0.0, uv=False)
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        segment = polygon.index
        u0 = segment / segments
        u1 = (segment + 1) / segments
        for loop_index, uv in zip(polygon.loop_indices, ((u0, 0), (u1, 0), (u1, 1), (u0, 1))):
            uv_layer.data[loop_index].uv = uv
    parent_keep(obj, parent)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def packed_anchors(root, *, pickup_location, grip_mode):
    anchor(
        "PICKUP_TARGET",
        pickup_location,
        parent=root,
        kind="pickup",
        props={
            "grip_mode": grip_mode,
            "requires_equipment": grip_mode in {"handtruck", "pallet_jack"},
            "weight_class": "heavy" if grip_mode == "handtruck" else "freight",
        },
    )
    anchor(
        "PLACEMENT_TARGET",
        (0, 0, 0),
        parent=root,
        kind="placement",
        props={"upright_axis": "+Z", "front_axis": "-Y", "surface": "freight_or_floor"},
    )
    anchor(
        "SHELF_TARGET",
        (0, 0, 0),
        parent=root,
        kind="shelf",
        props={"upright_axis": "+Z", "front_axis": "-Y", "semantic_alias": "PLACEMENT_TARGET"},
    )


def build_rug():
    reset_scene()
    set_scene_metadata()
    materials = furniture_materials()
    root = product_root(RUG_ID)
    assembly = empty(
        "RUG_PACKED_ASSEMBLY",
        parent=root,
        size=0.035,
        props={
            "component": "rolled_rug_freight_bundle",
            "original_unrolled_dimensions_m": [2.40, 1.60, 0.018],
            "roll_axis": "+X/-X",
        },
    )

    # The warm-oak core runs almost the full packed length.  Its ends and the
    # restrained coil cues remain visible between four protective corner blocks.
    core = cylinder(
        "RUG_CORE",
        0.033,
        1.160,
        (0, 0, 0.120),
        materials["oak"],
        rot=(0, math.pi / 2, 0),
        vertices=24,
        bevel=0.0015,
        parent=assembly,
        props={
            "component": "rug_roll_core",
            "core_material": "recycled fibreboard with natural-oak end read",
            "separate_component": True,
        },
    )
    core["pivot_axis"] = "X"
    roll = cylinder(
        "RUG_ROLL_BODY",
        0.1075,
        1.112,
        (0, 0, 0.120),
        materials["green"],
        rot=(0, math.pi / 2, 0),
        vertices=36,
        bevel=0.0025,
        parent=assembly,
        props={
            "component": "rolled_wool_rug",
            "product_identity": "Pine lounge rug",
            "woven_face": "deep golf green with restrained sage roll edge",
            "compressed": True,
        },
    )
    roll["source_scale"] = 1.0

    for side, x, direction in (("WEST", -0.565, -1), ("EAST", 0.565, 1)):
        cylinder(
            f"RUG_ROLL_END_{side}",
            0.108,
            0.012,
            (x, 0, 0.120),
            materials["sage_dark"],
            rot=(0, math.pi / 2, 0),
            vertices=36,
            bevel=0.0008,
            parent=assembly,
            props={"component": "visible_roll_end", "side": side.lower()},
        )
        for index, radius in enumerate((0.057, 0.083), 1):
            coil = torus(
                f"RUG_COIL_CUE_{side}_{index:02d}",
                radius,
                0.0024,
                (x + direction * 0.007, 0, 0.120),
                materials["sage"],
                rot=(0, math.pi / 2, 0),
                parent=assembly,
            )
            coil["component"] = "restrained_roll_coil_cue"

    for tag, x in (("WEST", -0.315), ("EAST", 0.315)):
        open_sleeve_x(
            f"RUG_BAND_{tag}",
            0.1115,
            0.040,
            (x, 0, 0.120),
            materials["sage"],
            parent=assembly,
            props={
                "component": "removable_rug_band",
                "separate_component": True,
                "removable": True,
                "band_width_m": 0.040,
            },
        )

    # Eight true end blocks define the exact 1.18 x .24 x .24 envelope without
    # hiding the core and roll identity behind a featureless square cap.
    for side, x in (("WEST", -0.5675), ("EAST", 0.5675)):
        for fore, y in (("FRONT", -0.090), ("REAR", 0.090)):
            for level, z in (("BOTTOM", 0.030), ("TOP", 0.210)):
                block = box(
                    f"RUG_END_BLOCK_{side}_{fore}_{level}",
                    (0.045, 0.060, 0.060),
                    (x, y, z),
                    materials["cream"],
                    bevel=0.006,
                    parent=assembly,
                    props={
                        "component": "moulded_pulp_end_block",
                        "separate_component": True,
                        "recyclable": True,
                    },
                )
                block["packed_envelope_defining"] = True

    label = box(
        "RUG_LABEL_BACKING",
        (0.345, 0.004, 0.070),
        (0, -0.1130, 0.120),
        materials["cream"],
        bevel=0.003,
        parent=assembly,
        props={"component": "product_identity_card", "faces": "-Y"},
    )
    label["text"] = "PINE LOUNGE RUG"
    text = text_mesh(
        "RUG_LABEL_TEXT",
        "PINE LOUNGE RUG",
        (0, -0.1156, 0.120),
        materials["green"],
        size=0.030,
        rot=(math.pi / 2, 0, 0),
        parent=assembly,
    )
    text["component"] = "product_label_text"
    text["brand"] = "Pinehollow Golf"

    collision = collision_box(
        "COL_PACKED_RUG1",
        SPECS[RUG_ID]["author_dims"],
        (0, 0, 0.120),
        materials,
        parent=root,
    )
    collision["collision_shape"] = "long_roll_envelope"
    collision["simplified"] = True
    packed_anchors(root, pickup_location=(0, 0, 0.120), grip_mode="handtruck")
    return root


def freight_strap(name, dims, loc, material, parent, *, segment):
    strap = box(
        name,
        dims,
        loc,
        material,
        bevel=0.0015,
        parent=parent,
        props={
            "component": "tensioned_freight_strap",
            "segment": segment,
            "separate_component": True,
            "removable": True,
            "tensioned": True,
        },
    )
    return strap


def build_lounge():
    reset_scene()
    set_scene_metadata()
    materials = furniture_materials()
    root = product_root(LOUNGE_ID)
    assembly = empty(
        "LOUNGE_PACKED_ASSEMBLY",
        parent=root,
        size=0.055,
        props={
            "component": "flat_pack_lounge_freight_bundle",
            "installed_width_m": 2.10,
            "contents": "frame panels; table panel; three compressed cushions; hardware; straps",
        },
    )

    # Exact-depth skids establish a stable Z=0 freight base and protect the
    # walnut panels from the crate floor.
    for fore, y in (("FRONT", -0.360), ("REAR", 0.360)):
        skid = box(
            f"LOUNGE_SKID_{fore}",
            (1.180, 0.060, 0.040),
            (0, y, 0.020),
            materials["oak"],
            bevel=0.006,
            parent=assembly,
            props={"component": "freight_skid", "packed_envelope_defining": True},
        )
        skid["load_axis"] = "+Z"

    base_panel = box(
        "LOUNGE_BASE_PANEL",
        (1.100, 0.680, 0.090),
        (0, 0, 0.095),
        materials["walnut"],
        bevel=0.012,
        parent=assembly,
        props={
            "component": "flat_pack_frame_panel",
            "installed_component": "sofa seat base",
            "orientation": "panel_lengthwise",
            "source_scale": 1.0,
        },
    )
    base_panel["assembly_order"] = 1

    # Walnut slats, rails and separated side/back panels make this read as a
    # real dismantled 2.1 m lounge rather than a generic cuboid placeholder.
    for index, x in enumerate((-0.42, -0.21, 0.0, 0.21, 0.42), 1):
        box(
            f"LOUNGE_BASE_SLAT_{index:02d}",
            (0.090, 0.600, 0.030),
            (x, 0, 0.155),
            materials["oak"],
            bevel=0.005,
            parent=assembly,
            props={"component": "flat_pack_frame_slat", "installed_component": "seat support"},
        )

    back_panel = box(
        "LOUNGE_BACK_PANEL",
        (1.080, 0.070, 0.555),
        (0, 0.300, 0.4425),
        materials["walnut"],
        bevel=0.014,
        parent=assembly,
        props={
            "component": "flat_pack_frame_panel",
            "installed_component": "sofa back",
            "orientation": "panel_lengthwise",
            "source_scale": 1.0,
        },
    )
    back_panel["assembly_order"] = 2
    for index, x in enumerate((-0.36, 0.0, 0.36), 1):
        box(
            f"LOUNGE_BACK_RAIL_{index:02d}",
            (0.050, 0.082, 0.490),
            (x, 0.258, 0.4425),
            materials["oak"],
            bevel=0.006,
            parent=assembly,
            props={"component": "frame_joinery_rail", "visible_joinery": True},
        )

    for side, x in (("WEST", -0.535), ("EAST", 0.535)):
        panel = box(
            f"LOUNGE_SIDE_PANEL_{side}",
            (0.070, 0.660, 0.555),
            (x, -0.010, 0.4425),
            materials["walnut"],
            bevel=0.014,
            parent=assembly,
            props={
                "component": "flat_pack_frame_panel",
                "installed_component": f"sofa {side.lower()} arm/frame",
                "orientation": "panel_on_edge",
                "source_scale": 1.0,
            },
        )
        panel["assembly_order"] = 3
        box(
            f"LOUNGE_SIDE_INSET_{side}",
            (0.076, 0.500, 0.330),
            (x + (0.039 if side == "WEST" else -0.039), -0.010, 0.455),
            materials["sage_dark"],
            bevel=0.010,
            parent=assembly,
            props={"component": "protected_upholstery_side_inset", "compressed": True},
        )

    table_panel = box(
        "LOUNGE_TABLE_TOP_PANEL",
        (0.900, 0.460, 0.055),
        (0, -0.075, 0.2225),
        materials["walnut"],
        bevel=0.014,
        parent=assembly,
        props={
            "component": "flat_pack_table_panel",
            "installed_component": "lounge coffee table top",
            "source_scale": 1.0,
        },
    )
    table_panel["assembly_order"] = 4
    for index, x in enumerate((-0.300, -0.100, 0.100, 0.300), 1):
        leg = cylinder(
            f"LOUNGE_TABLE_LEG_{index:02d}",
            0.027,
            0.360,
            (x, -0.328, 0.360),
            materials["charcoal"],
            rot=(0, math.pi / 2, 0),
            vertices=12,
            bevel=0.003,
            parent=assembly,
            props={"component": "detached_table_leg", "separate_component": True},
        )
        leg["assembly_order"] = 5

    # Three independent sage cushions preserve the installed three-seat
    # identity.  Their low profile explicitly represents vacuum compression.
    for index, x in enumerate((-0.365, 0.0, 0.365), 1):
        cushion = box(
            f"LOUNGE_COMPRESSED_CUSHION_{index:02d}",
            (0.330, 0.445, 0.130),
            (x, -0.080, 0.735),
            materials["sage"],
            bevel=0.026,
            parent=assembly,
            props={
                "component": "vacuum_compressed_cushion",
                "installed_component": f"seat/back cushion set {index}",
                "compressed": True,
                "compression_ratio": 0.38,
                "separate_component": True,
                "source_scale": 1.0,
            },
        )
        cushion["assembly_order"] = 6
        # Restrained cream tissue bands help the three soft parts read as
        # separately wrapped cushions beneath the outer freight straps.
        box(
            f"LOUNGE_CUSHION_BAND_{index:02d}",
            (0.055, 0.451, 0.128),
            (x, -0.080, 0.735),
            materials["cream"],
            bevel=0.004,
            parent=assembly,
            props={"component": "cushion_compression_band", "removable": True},
        )

    hardware = box(
        "LOUNGE_HARDWARE_POUCH",
        (0.250, 0.026, 0.145),
        (0.345, -0.356, 0.470),
        materials["cream"],
        bevel=0.010,
        parent=assembly,
        props={
            "component": "labelled_hardware_pouch",
            "contents": "brass bolts; washers; hex key",
            "separate_component": True,
        },
    )
    hardware["assembly_order"] = 7
    for index, x in enumerate((0.285, 0.325, 0.365, 0.405), 1):
        cylinder(
            f"LOUNGE_HARDWARE_BOLT_{index:02d}",
            0.009,
            0.012,
            (x, -0.373, 0.475),
            materials["brass"],
            rot=(math.pi / 2, 0, 0),
            vertices=10,
            bevel=0.001,
            parent=assembly,
            props={"component": "visible_hardware_cue"},
        )

    # Two complete four-segment straps wrap the freight bundle at authored
    # x-positions.  They remain separate for a later unpack animation.
    for side, x in (("WEST", -0.355), ("EAST", 0.355)):
        freight_strap(
            f"LOUNGE_STRAP_{side}_FRONT",
            (0.044, 0.006, 0.760),
            (x, -0.387, 0.400),
            materials["green"],
            assembly,
            segment="front",
        )
        freight_strap(
            f"LOUNGE_STRAP_{side}_REAR",
            (0.044, 0.006, 0.760),
            (x, 0.387, 0.400),
            materials["green"],
            assembly,
            segment="rear",
        )
        freight_strap(
            f"LOUNGE_STRAP_{side}_TOP",
            (0.044, 0.780, 0.006),
            (x, 0, 0.797),
            materials["green"],
            assembly,
            segment="top",
        )
        freight_strap(
            f"LOUNGE_STRAP_{side}_BOTTOM",
            (0.044, 0.780, 0.006),
            (x, 0, 0.003),
            materials["green"],
            assembly,
            segment="bottom",
        )
        buckle = box(
            f"LOUNGE_STRAP_{side}_BUCKLE",
            (0.072, 0.018, 0.045),
            (x, -0.380, 0.495),
            materials["brass"],
            bevel=0.005,
            parent=assembly,
            props={"component": "freight_strap_buckle", "separate_component": True},
        )
        buckle["release_axis"] = "+Y"

    # Recyclable cream guards identify protected furniture corners and make the
    # packed silhouette intentional at first-person viewing distance.
    for side, x in (("WEST", -0.565), ("EAST", 0.565)):
        for fore, y in (("FRONT", -0.350), ("REAR", 0.350)):
            for level, z in (("BOTTOM", 0.075), ("TOP", 0.655)):
                box(
                    f"LOUNGE_CORNER_GUARD_{side}_{fore}_{level}",
                    (0.050, 0.080, 0.110),
                    (x, y, z),
                    materials["cream"],
                    bevel=0.009,
                    parent=assembly,
                    props={
                        "component": "moulded_pulp_corner_guard",
                        "recyclable": True,
                        "separate_component": True,
                    },
                )

    label = box(
        "LOUNGE_PARTS_LABEL",
        (0.370, 0.005, 0.090),
        (-0.175, -0.3865, 0.515),
        materials["cream"],
        bevel=0.004,
        parent=assembly,
        props={"component": "parts_and_orientation_label", "faces": "-Y"},
    )
    label["text"] = "LOUNGE SET / 1 OF 1"
    text = text_mesh(
        "LOUNGE_PARTS_LABEL_TEXT",
        "LOUNGE SET  1 OF 1",
        (-0.175, -0.3888, 0.515),
        materials["green"],
        size=0.027,
        rot=(math.pi / 2, 0, 0),
        parent=assembly,
    )
    text["component"] = "parts_label_text"

    collision = collision_box(
        "COL_PACKED_LOUNGE1",
        SPECS[LOUNGE_ID]["author_dims"],
        (0, 0, 0.400),
        materials,
        parent=root,
    )
    collision["collision_shape"] = "flat_pack_freight_envelope"
    collision["simplified"] = True
    packed_anchors(root, pickup_location=(0, 0, 0.445), grip_mode="pallet_jack")
    return root


BUILDERS = {RUG_ID: build_rug, LOUNGE_ID: build_lounge}


def visible_bounds(root):
    points = []
    bpy.context.view_layer.update()
    for obj in descendants(root):
        if obj.type != "MESH" or obj.name.startswith(("COL_", "COLLISION_", "VOLUME_")):
            continue
        for corner in obj.bound_box:
            points.append(obj.matrix_world @ Vector(corner))
    if not points:
        raise RuntimeError(f"{root.name} has no visible mesh bounds")
    low = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    high = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return low, high


def scene_metrics(root):
    nodes = descendants(root)
    meshes = [obj for obj in nodes if obj.type == "MESH"]
    visible_meshes = [obj for obj in meshes if not obj.name.startswith(("COL_", "COLLISION_", "VOLUME_"))]
    triangles = sum(sum(max(1, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in meshes)
    visible_triangles = sum(
        sum(max(1, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in visible_meshes
    )
    low, high = visible_bounds(root)
    author_dims = high - low
    material_names = sorted({
        slot.material.name
        for obj in meshes
        for slot in obj.material_slots
        if slot.material is not None
    })
    return {
        "nodes": len(nodes),
        "meshes": len(meshes),
        "visible_meshes": len(visible_meshes),
        "triangles": triangles,
        "visible_triangles": visible_triangles,
        "materials": material_names,
        "images": sorted(image.name for image in bpy.data.images if image.size[0] and image.size[1]),
        "visible_bounds_min_authoring": [round(value, 6) for value in low],
        "visible_bounds_max_authoring": [round(value, 6) for value in high],
        "visible_dimensions_authoring": [round(value, 6) for value in author_dims],
        "visible_dimensions_runtime": [round(author_dims.x, 6), round(author_dims.z, 6), round(author_dims.y, 6)],
    }


def validate_asset(asset_id: str, root):
    spec = SPECS[asset_id]
    nodes = descendants(root)
    by_name = {obj.name: obj for obj in nodes}
    missing = sorted(REQUIRED_NODES[asset_id] - set(by_name))
    if missing:
        raise RuntimeError(f"{asset_id} missing required nodes: {missing}")
    if root.get("asset_id") != asset_id or root.get("logical_sku") != spec["logical_sku"]:
        raise RuntimeError(f"{asset_id} root/SKU metadata mismatch")
    if root.get("layout_id") != "FURNITURE1" or root.get("packed_state") != spec["packed_state"]:
        raise RuntimeError(f"{asset_id} packed-state contract mismatch")
    if root.get("allow_runtime_scale") is not False:
        raise RuntimeError(f"{asset_id} must forbid runtime scaling")
    if root.get("raw_sources_modified") is not False or root.get("external_assets") != 0:
        raise RuntimeError(f"{asset_id} source provenance metadata mismatch")
    for anchor_name in ("PICKUP_TARGET", "PLACEMENT_TARGET", "SHELF_TARGET"):
        obj = by_name[anchor_name]
        if obj.type != "EMPTY" or obj.parent is not root or obj.get("anchor") is not True:
            raise RuntimeError(f"{asset_id}/{anchor_name} must be a direct root transform socket")
    collision_name = "COL_PACKED_RUG1" if asset_id == RUG_ID else "COL_PACKED_LOUNGE1"
    collision = by_name[collision_name]
    if collision.get("collision_proxy") is not True or collision.get("simplified") is not True:
        raise RuntimeError(f"{asset_id} collision must remain a simple proxy")
    for obj in nodes:
        if obj.type != "MESH":
            continue
        if any(abs(float(value) - 1.0) > 1e-5 for value in obj.scale):
            raise RuntimeError(f"{asset_id}/{obj.name} has unapplied scale {tuple(obj.scale)}")
        if any(abs(float(value)) > 1e-5 for value in obj.rotation_euler):
            raise RuntimeError(f"{asset_id}/{obj.name} has unapplied rotation {tuple(obj.rotation_euler)}")
        if obj.data.polygons and not obj.data.uv_layers:
            raise RuntimeError(f"{asset_id}/{obj.name} has no UV0")
    metrics = scene_metrics(root)
    for axis, (actual, expected) in enumerate(zip(metrics["visible_dimensions_authoring"], spec["author_dims"])):
        if abs(actual - expected) > 0.001:
            raise RuntimeError(
                f"{asset_id} visible author dimension axis {axis}: {actual} outside {expected} +/- .001"
            )
    if metrics["triangles"] > 18000:
        raise RuntimeError(f"{asset_id} exceeds 18k triangle budget: {metrics['triangles']}")
    if len(metrics["materials"]) > 10:
        raise RuntimeError(f"{asset_id} exceeds ten-material budget")
    return metrics


def add_build_info(asset_id: str) -> None:
    spec = SPECS[asset_id]
    text = bpy.data.texts.new("BUILD_INFO.txt")
    text.write(
        "Pinehollow Golf nonretail FURNITURE1 packed product\n"
        f"asset_id: {asset_id}\n"
        f"logical_sku: {spec['logical_sku']}\n"
        f"packed_state: {spec['packed_state']}\n"
        f"build_version: {BUILD_VERSION}\n"
        f"builder: {SCRIPT.relative_to(ROOT).as_posix()}\n"
        "units: metres\n"
        "source: original in-repository packed geometry derived from project-owned visual references\n"
        "license: project-owned / UNLICENSED\n"
        "external downloads: none\n"
        "raw source assets modified: false\n"
    )


def save_export(asset_id: str, root):
    metrics = validate_asset(asset_id, root)
    add_build_info(asset_id)
    blend_path = SOURCE_DIR / f"{asset_id}.blend"
    glb_path = EXPORT_DIR / f"{asset_id}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in descendants(root):
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
        export_animations=False,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )
    metrics.update({
        "asset_id": asset_id,
        "logical_sku": SPECS[asset_id]["logical_sku"],
        "packed_state": SPECS[asset_id]["packed_state"],
        "source": blend_path.relative_to(ROOT).as_posix(),
        "export": glb_path.relative_to(ROOT).as_posix(),
        "bytes": glb_path.stat().st_size,
        "qa_pass": QA_PASS,
    })
    (QA_DIR / f"{asset_id}_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf8")
    print(
        f"BUILT|{asset_id}|tris={metrics['triangles']}|bytes={metrics['bytes']}|"
        f"runtime_dims={metrics['visible_dimensions_runtime']}"
    )
    return metrics


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_preview(asset_id: str):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 760
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -1.15
    if scene.world is None:
        scene.world = bpy.data.worlds.new("QA_World")
    scene.world.color = (0.024, 0.035, 0.028)

    bpy.ops.object.camera_add(location=(1.65, -1.70, 1.10))
    camera = bpy.context.object
    camera.name = "QA_Camera"
    camera.data.lens = 58
    scene.camera = camera

    for name, energy, location, color, size in (
        ("Key", 560, (-1.4, -1.6, 2.4), (1.0, 0.86, 0.68), 2.0),
        ("Fill", 300, (1.8, -0.6, 1.5), (0.68, 0.86, 0.76), 1.7),
        ("Rim", 460, (0.3, 1.8, 2.0), (0.78, 0.88, 1.0), 1.6),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = f"QA_{name}"
        light.data.energy = energy
        light.data.color = color
        light.data.shape = "DISK"
        light.data.size = size
        look_at(light, (0, 0, 0.36))

    floor_material = mat("QA_FloorMaterial", (0.040, 0.060, 0.045, 1.0), roughness=0.93)
    box("QA_Floor", (4.0, 4.0, 0.025), (0, 0, -0.0175), floor_material, bevel=0.008)
    return camera


def render_previews(asset_id: str):
    # Collision proxies ship in the hierarchy for runtime lookup but must not
    # cast triangulation-shaped shadows across the visual QA turntable.
    for obj in bpy.data.objects:
        if obj.name.startswith(("COL_", "COLLISION_", "VOLUME_")):
            obj.hide_render = True
    camera = setup_preview(asset_id)
    if asset_id == RUG_ID:
        views = (
            ("front_three_quarter", (1.55, -1.48, 0.92), (0, 0, 0.12), 62),
            ("core_end_detail", (1.28, -0.72, 0.48), (0.32, 0, 0.12), 70),
        )
    else:
        views = (
            ("front_three_quarter", (1.72, -2.05, 1.42), (0, 0, 0.39), 58),
            ("panels_cushions_detail", (-1.45, -1.70, 1.48), (0, -0.03, 0.44), 62),
        )
    for name, location, target, lens in views:
        camera.location = location
        camera.data.lens = lens
        look_at(camera, target)
        bpy.context.scene.render.filepath = str(QA_DIR / f"{asset_id}_{name}.png")
        bpy.ops.render.render(write_still=True)
    for obj in list(bpy.data.objects):
        if obj.name.startswith("QA_"):
            bpy.data.objects.remove(obj, do_unlink=True)


def clean_reimport(asset_id: str):
    reset_scene()
    set_scene_metadata()
    glb_path = EXPORT_DIR / f"{asset_id}.glb"
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    root = bpy.data.objects.get(asset_id)
    if root is None:
        raise RuntimeError(f"clean reimport lost exact root {asset_id}")
    metrics = validate_asset(asset_id, root)
    report = {
        "asset_id": asset_id,
        "logical_sku": root.get("logical_sku"),
        "packed_state": root.get("packed_state"),
        "glb": glb_path.relative_to(ROOT).as_posix(),
        "root_metadata_preserved": root.get("asset_id") == asset_id,
        "required_nodes_preserved": REQUIRED_NODES[asset_id].issubset({obj.name for obj in descendants(root)}),
        "anchors_preserved": all(
            bpy.data.objects.get(name) is not None
            for name in ("PICKUP_TARGET", "PLACEMENT_TARGET", "SHELF_TARGET")
        ),
        "packed_state_preserved": root.get("packed_state") == SPECS[asset_id]["packed_state"],
        "no_runtime_scale": root.get("allow_runtime_scale") is False,
        "no_camera": len(bpy.data.cameras) == 0,
        "no_light": len(bpy.data.lights) == 0,
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
    print(
        f"REIMPORT_OK|{asset_id}|tris={metrics['triangles']}|"
        f"runtime_dims={metrics['visible_dimensions_runtime']}"
    )
    return report


def build_one(asset_id: str):
    root = BUILDERS[asset_id]()
    metrics = save_export(asset_id, root)
    render_previews(asset_id)
    return metrics


def main():
    target = os.environ.get("NONRETAIL_FURNITURE_TARGET", "").strip()
    asset_ids = tuple(BUILDERS) if not target else (target,)
    unknown = [asset_id for asset_id in asset_ids if asset_id not in BUILDERS]
    if unknown:
        raise RuntimeError(f"unknown NONRETAIL_FURNITURE_TARGET: {unknown[0]}")

    hashes_before = source_hashes()
    metrics = [build_one(asset_id) for asset_id in asset_ids]
    reimports = [clean_reimport(asset_id) for asset_id in asset_ids]
    hashes_after = source_hashes()
    if hashes_before != hashes_after:
        raise RuntimeError("immutable project-owned visual references changed during the build")

    report = {
        "builder": SCRIPT.relative_to(ROOT).as_posix(),
        "build_version": BUILD_VERSION,
        "qa_pass": QA_PASS,
        "asset_target": target or "all",
        "external_assets": [],
        "license": "Project-owned / UNLICENSED",
        "project_owned_reference_hashes_before": hashes_before,
        "project_owned_reference_hashes_after": hashes_after,
        "project_owned_references_unchanged": hashes_before == hashes_after,
        "raw_sources_modified": False,
        "assets": metrics,
        "reimports": reimports,
    }
    (QA_DIR / "nonretail_furniture_packed_build_report.json").write_text(
        json.dumps(report, indent=2), encoding="utf8"
    )
    print(
        f"COMPLETE|assets={len(metrics)}|qa_pass={QA_PASS}|"
        "project_owned_references_unchanged=true"
    )


if __name__ == "__main__":
    main()
