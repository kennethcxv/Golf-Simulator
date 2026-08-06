"""Build Pinehollow checkout product-family props.

Run from the repository root:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
        --background --factory-startup \
        --python tools/blender/build_checkout_products.py

The library is intentionally compact: one checkout-scale authored silhouette per
sellable family, shared by sibling SKUs at runtime.  Geometry, materials and source
files are original project-owned work.  No raw Tripo or third-party asset is opened.

Coordinate convention: X product length/width, Y depth (-Y faces the cashier), Z up.
All dimensions are metres and every root origin rests on the counter at Z=0.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy

SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[2]
sys.path.insert(0, str(SCRIPT.parent))

from build_checkout_assets import (  # noqa: E402
    activate,
    anchor,
    apply_rotation_scale,
    box,
    collision_box,
    curve_tube,
    cylinder,
    descendants,
    empty,
    finish_mesh,
    mat,
    materials,
    panel_mesh,
    parent_keep,
    reset_scene,
    text_mesh,
    torus,
)


SOURCE_DIR = ROOT / "asset_sources" / "blender" / "cash_register"
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
SOURCE_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
BUILD_VERSION = 3


def product_materials():
    M = materials()
    # These exact slot names are remapped by src/render3d/clubhouse/merch.js.
    M["fabric"] = mat("M_fabric", (0.58, 0.58, 0.56, 1), roughness=0.90)
    M["leather"] = mat("M_leather", (0.60, 0.60, 0.58, 1), roughness=0.58)
    M["sku_accent"] = mat("M_SKUAccent", (0.38, 0.52, 0.40, 1), roughness=0.52)
    return M


def root_for(asset_id, dims):
    return empty(
        asset_id,
        props={
            "asset_id": asset_id,
            "asset_version": BUILD_VERSION,
            "units": "meters",
            "target_dimensions_m": list(dims),
            "front": "-Y (cashier side)",
            "source": "Original Pinehollow Golf geometry generated in-repository",
            "license": "Project-owned / UNLICENSED",
            "builder": SCRIPT.relative_to(ROOT).as_posix(),
        },
        size=0.06,
    )


def sphere(name, radius, loc, material, *, scale=(1, 1, 1), parent=None, segments=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=radius, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    finish_mesh(obj, material, bevel_width=0)
    parent_keep(obj, parent)
    return obj


def cone(name, radius1, radius2, depth, loc, material, *, rot=(0, 0, 0), parent=None, vertices=16):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=loc,
        rotation=rot,
    )
    obj = bpy.context.object
    obj.name = name
    finish_mesh(obj, material, bevel_width=0.0015)
    parent_keep(obj, parent)
    return obj


def flat_label_text(name, text, loc, material, *, size, parent=None):
    """Low-poly front-label type for small products repeated across fixtures."""
    bpy.ops.object.text_add(location=loc, rotation=(math.pi / 2, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.data.body = text
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.size = size
    obj.data.resolution_u = 1
    obj.data.extrude = 0.00012
    obj.data.bevel_depth = 0.0
    obj.data.materials.append(material)
    activate(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.name = name
    finish_mesh(obj, material, bevel_width=0.0)
    parent_keep(obj, parent)
    return obj


def common_finish(root, dims, M, *, barcode, primary, secondary=None, collision=None, barcode_kind="tag"):
    anchor(
        "ANCHOR_ProductBarcode",
        barcode,
        parent=root,
        kind="barcode",
        props={"surface": barcode_kind, "label_width_m": 0.068, "label_height_m": 0.034},
    )
    anchor("ANCHOR_ProductGripPrimary", primary, parent=root, kind="grip", props={"hand": "primary"})
    if secondary is not None:
        anchor("ANCHOR_ProductGripSecondary", secondary, parent=root, kind="grip", props={"hand": "support"})
        root["grip_mode"] = "two-hand"
        root["separate_handoff"] = True
    else:
        root["grip_mode"] = "medium" if max(dims) >= 0.25 else "small"
        root["separate_handoff"] = False
    collision_box("COL_Product", collision or dims, (0, 0, (collision or dims)[2] / 2), M, parent=root)
    return root


def club_base(asset_id, kind, length, M):
    dims = (length, 0.12, 0.10)
    root = root_for(asset_id, dims)
    shaft_z = 0.044
    cylinder("ClubShaft", 0.006, length - 0.08, (-0.015, 0, shaft_z), M["steel"], rot=(0, math.pi / 2, 0), vertices=12, parent=root)
    cylinder("ClubGrip", 0.014, 0.23, (-length / 2 + 0.135, 0, shaft_z), M["rubber"], rot=(0, math.pi / 2, 0), vertices=12, parent=root)
    cylinder("Ferrule", 0.010, 0.028, (length / 2 - 0.085, 0, shaft_z), M["brass"], rot=(0, math.pi / 2, 0), vertices=12, parent=root)
    cylinder("SkuAccentBand", 0.011, 0.045, (-length * 0.18, 0, shaft_z), M["sku_accent"], rot=(0, math.pi / 2, 0), vertices=12, parent=root)
    hx = length / 2 - 0.035
    if kind == "driver":
        sphere("DriverHead", 0.050, (hx, 0, 0.049), M["sku_accent"], scale=(1.22, 0.78, 0.72), parent=root)
        box("DriverFace", (0.013, 0.076, 0.058), (hx + 0.041, -0.004, 0.048), M["steel"], bevel=0.004, parent=root)
    elif kind == "putter":
        box("PutterBlade", (0.13, 0.052, 0.032), (hx - 0.025, 0, 0.022), M["steel"], bevel=0.007, parent=root)
        box("PutterInsert", (0.105, 0.003, 0.018), (hx - 0.025, -0.027, 0.022), M["sku_accent"], bevel=0.002, parent=root)
    else:
        points = [(-0.048, 0.010), (0.040, 0.016), (0.052, 0.080), (-0.018, 0.066)]
        blade = panel_mesh("WedgeHead", [(hx + x, z) for x, z in points], 0.028, 0, M["steel"], parent=root, bevel=0.004)
        blade.rotation_euler.z = math.radians(-5 if kind == "wedge" else 4)
        apply_rotation_scale(blade)
    return common_finish(
        root,
        dims,
        M,
        barcode=(-length * 0.18, -0.064, 0.050),
        primary=(0.04, 0, 0.050),
        secondary=(-length * 0.23, 0, 0.050),
        collision=(length, 0.12, 0.10),
        barcode_kind="shaft-tag",
    )


def build_driver(M):
    return club_base("checkout_product_driver", "driver", 1.16, M)


def build_putter(M):
    return club_base("checkout_product_putter", "putter", 0.96, M)


def build_wedge(M):
    return club_base("checkout_product_wedge", "wedge", 0.98, M)


def build_iron_set(M):
    dims = (1.04, 0.16, 0.12)
    root = root_for("checkout_product_iron_set", dims)
    for index, y in enumerate((-0.045, 0, 0.045)):
        length = 1.00 + index * 0.018
        cylinder(f"IronShaft_{index + 1}", 0.0055, length - 0.07, (-0.015, y, 0.047 + index * 0.004), M["steel"], rot=(0, math.pi / 2, 0), vertices=10, parent=root)
        cylinder(f"IronGrip_{index + 1}", 0.012, 0.21, (-length / 2 + 0.125, y, 0.047 + index * 0.004), M["rubber"], rot=(0, math.pi / 2, 0), vertices=10, parent=root)
        hx = length / 2 - 0.035
        panel_mesh(
            f"IronHead_{index + 1}",
            [(hx - 0.048, 0.010), (hx + 0.040, 0.016), (hx + 0.050, 0.079), (hx - 0.020, 0.066)],
            0.022,
            y,
            M["steel"],
            parent=root,
            bevel=0.003,
        )
    box("IronSetBellyBand", (0.12, 0.155, 0.070), (-0.18, 0, 0.052), M["sku_accent"], bevel=0.008, parent=root)
    text_mesh("IronSetMark", "3 IRON SET", (-0.18, -0.079, 0.053), M["cream"], size=0.018, rot=(math.pi / 2, 0, 0), parent=root)
    return common_finish(root, dims, M, barcode=(-0.18, -0.084, 0.052), primary=(0.04, 0, 0.055), secondary=(-0.28, 0, 0.055), barcode_kind="shaft-band")


def build_ball_carton(M):
    dims = (0.155, 0.115, 0.075)
    root = root_for("checkout_product_ball_carton", dims)
    box("BallDozenCarton", dims, (0, 0, dims[2] / 2), M["cream"], bevel=0.006, parent=root)
    box("BallDozenBand", (0.157, 0.117, 0.024), (0, 0, 0.043), M["sku_accent"], bevel=0.003, parent=root)
    for i in range(3):
        sphere(f"BallWindow_{i + 1}", 0.014, ((i - 1) * 0.034, -0.058, 0.043), M["offwhite"], parent=root, segments=12, rings=8)
    text_mesh("BallCartonMark", "12", (0, -0.059, 0.020), M["green"], size=0.018, rot=(math.pi / 2, 0, 0), parent=root)
    return common_finish(root, dims, M, barcode=(0, -0.061, 0.038), primary=(0, 0, 0.045), collision=dims, barcode_kind="carton-side")


def folded_garment(asset_id, jacket, M):
    dims = (0.21 if jacket else 0.20, 0.17 if jacket else 0.16, 0.09 if jacket else 0.075)
    root = root_for(asset_id, dims)
    fabric = M["fabric"]
    box("FoldedBody", (dims[0], dims[1], dims[2] * 0.72), (0, 0, dims[2] * 0.36), fabric, bevel=0.018, parent=root)
    box("FoldedSleeveLeft", (dims[0] * 0.36, dims[1] * 0.82, dims[2] * 0.36), (-dims[0] * 0.25, 0.006, dims[2] * 0.78), fabric, bevel=0.012, parent=root, rot=(0, 0, math.radians(-3)))
    box("FoldedSleeveRight", (dims[0] * 0.36, dims[1] * 0.82, dims[2] * 0.36), (dims[0] * 0.25, -0.004, dims[2] * 0.78), fabric, bevel=0.012, parent=root, rot=(0, 0, math.radians(3)))
    # Two clean convex strips form the collar. The previous single concave six-gon
    # triangulated into zero-area faces during glTF export on some Blender builds.
    collar_y = -dims[1] / 2 - 0.003
    box("FoldedCollarLeft", (0.058, 0.004, 0.014), (-0.022, collar_y, 0.074), M["cream"], rot=(0, math.radians(28), 0), bevel=0.002, parent=root)
    box("FoldedCollarRight", (0.058, 0.004, 0.014), (0.022, collar_y, 0.074), M["cream"], rot=(0, math.radians(-28), 0), bevel=0.002, parent=root)
    if jacket:
        box("JacketZip", (0.006, 0.004, 0.076), (0, -dims[1] / 2 - 0.004, 0.046), M["brass"], bevel=0.001, parent=root)
        box("JacketStormFlap", (0.030, 0.006, 0.055), (0.020, -dims[1] / 2 - 0.005, 0.045), M["charcoal"], bevel=0.002, parent=root)
    return common_finish(root, dims, M, barcode=(dims[0] * 0.30, -dims[1] / 2 - 0.008, 0.040), primary=(0, 0, 0.055), collision=dims, barcode_kind="apparel-tag")


def build_folded_polo(M):
    return folded_garment("checkout_product_folded_polo", False, M)


def build_folded_jacket(M):
    return folded_garment("checkout_product_folded_jacket", True, M)


def build_hanging_polo(M):
    """Compact face-out polo for the four-across Sheet-03 apparel display.

    The general clubhouse polo is correctly life-sized for a rail, but scaling
    only its X axis to fit four waterfall arms turns it into a long flat strip.
    This authored presentation keeps believable shoulders, tucked short sleeves,
    a collar/placket and a real hanger inside the same 255 mm retail envelope.
    The root remains the hook/arm contact so existing sockets and pivots do not
    move when the visual changes.
    """
    dims = (0.255, 0.078, 0.700)
    root = root_for("checkout_product_hanging_polo", dims)
    root["pivot_description"] = "hanger hook / waterfall-arm contact at local origin"
    root["placement"] = "four-across face-out apparel display"
    root["product_kind"] = "compact hanging polo"

    outline = [
        (-0.105, -0.665), (-0.110, -0.300), (-0.103, -0.270),
        (-0.124, -0.250), (-0.126, -0.185), (-0.082, -0.116),
        (-0.037, -0.096), (0.000, -0.132), (0.037, -0.096),
        (0.082, -0.116), (0.126, -0.185), (0.124, -0.250),
        (0.103, -0.270), (0.110, -0.300), (0.105, -0.665),
    ]
    panel_mesh("HangingPoloBody", outline, 0.052, 0.0, M["fabric"], parent=root, bevel=0.010)

    # Folded-back sleeve faces and construction seams keep the deliberately
    # compact display silhouette readable without widening its socket pitch.
    for sx, tag in ((-1, "L"), (1, "R")):
        panel_mesh(
            f"HangingPoloSleeve_{tag}",
            [(sx * 0.075, -0.121), (sx * 0.123, -0.186),
             (sx * 0.120, -0.250), (sx * 0.092, -0.276)],
            0.012, -0.032, M["fabric"], parent=root, bevel=0.004,
        )
        curve_tube(
            f"HangingPoloSleeveSeam_{tag}",
            [(sx * 0.084, -0.039, -0.143), (sx * 0.112, -0.039, -0.195),
             (sx * 0.107, -0.039, -0.247)],
            0.0018, M["cream"], parent=root,
        )

    panel_mesh(
        "HangingPoloCollar_L",
        [(-0.076, -0.108), (-0.006, -0.139), (-0.018, -0.190), (-0.090, -0.136)],
        0.008, -0.033, M["cream"], parent=root, bevel=0.002,
    )
    panel_mesh(
        "HangingPoloCollar_R",
        [(0.006, -0.139), (0.076, -0.108), (0.090, -0.136), (0.018, -0.190)],
        0.008, -0.033, M["cream"], parent=root, bevel=0.002,
    )
    box("HangingPoloPlacket", (0.019, 0.007, 0.110), (0, -0.034, -0.215),
        M["cream"], bevel=0.002, parent=root)
    for index, z in enumerate((-0.185, -0.220, -0.255), start=1):
        cylinder(f"HangingPoloButton_{index}", 0.0032, 0.006,
                 (0, -0.039, z), M["brass"], rot=(math.pi / 2, 0, 0),
                 vertices=10, parent=root)
    box("HangingPoloChestMark", (0.020, 0.006, 0.016), (0.060, -0.034, -0.272),
        M["brass"], bevel=0.002, parent=root)
    box("HangingPoloHem", (0.198, 0.006, 0.009), (0, -0.033, -0.658),
        M["cream"], bevel=0.0015, parent=root)

    curve_tube(
        "HangingPoloHanger",
        [(-0.105, 0.014, -0.133), (0, 0.014, -0.055), (0.105, 0.014, -0.133)],
        0.006, M["walnut"], parent=root,
    )
    curve_tube(
        "HangingPoloHook",
        [(0, 0.012, -0.056), (0, 0.012, -0.012), (0.006, 0.012, 0.020),
         (0.028, 0.012, 0.032), (0.044, 0.012, 0.012), (0.034, 0.012, -0.008)],
        0.0035, M["steel"], parent=root,
    )
    empty("HANGER_SOCKET", (0, 0, 0), parent=root, size=0.025,
          props={"socket": "hanger", "pivot_role": "waterfall_arm_contact"})
    collision_box("COL_HangingPolo", (0.255, 0.078, 0.605),
                  (0, 0, -0.360), M, parent=root)
    return root


def build_hanging_jacket(M):
    """Compact front-facing display jacket for Sheet-02's four-place rail.

    The older clubhouse jacket is a realistic 0.575 m across and cannot fit
    four abreast on a 1.20 m wall without severe interpenetration.  This retail
    presentation silhouette keeps its sleeves folded behind the torso, yielding
    a 0.25 m read while preserving a full 0.75 m drop.  The root origin is the
    hanger/rod contact point rather than the garment's lower bound."""
    dims = (0.255, 0.080, 0.790)
    root = root_for("checkout_product_hanging_jacket", dims)
    # GLTFLoader reserves the exact extras key ``pivot`` for a numeric pivot
    # vector reconstructed by the exporter/loader contract.  Descriptive text
    # under that key is interpreted as coordinates and poisons the root matrix.
    root["pivot_description"] = "hanger hook / rail contact at local origin"
    root["placement"] = "front-facing apparel wall display"

    outline = [
        (-0.108, -0.748), (-0.112, -0.275), (-0.124, -0.238),
        (-0.120, -0.158), (-0.078, -0.112), (-0.036, -0.098),
        (0.000, -0.137), (0.036, -0.098), (0.078, -0.112),
        (0.120, -0.158), (0.124, -0.238), (0.112, -0.275),
        (0.108, -0.748),
    ]
    panel_mesh("HangingJacketBody", outline, 0.055, 0.0, M["fabric"], parent=root, bevel=0.010)

    # Folded-back sleeve panels and restrained construction lines keep the
    # narrow silhouette believable instead of reading as a scaled shirt slab.
    for sx, tag in ((-1, "L"), (1, "R")):
        sleeve = [
            (sx * 0.075, -0.130), (sx * 0.121, -0.168),
            (sx * 0.110, -0.485), (sx * 0.078, -0.430),
        ]
        panel_mesh(f"HangingJacketSleeve_{tag}", sleeve, 0.012, -0.034,
                   M["fabric"], parent=root, bevel=0.004)
        curve_tube(
            f"HangingJacketSeam_{tag}",
            [(sx * 0.083, -0.041, -0.150), (sx * 0.104, -0.041, -0.285),
             (sx * 0.091, -0.041, -0.455)],
            0.0018, M["cream"], parent=root,
        )
        box(f"HangingJacketPocket_{tag}", (0.060, 0.006, 0.010),
            (sx * 0.059, -0.033, -0.505), M["charcoal"],
            rot=(0, math.radians(sx * 10), math.radians(sx * 8)), bevel=0.002, parent=root)

    panel_mesh("HangingJacketCollar_L",
               [(-0.078, -0.110), (-0.006, -0.145), (-0.018, -0.205), (-0.096, -0.142)],
               0.008, -0.034, M["cream"], parent=root, bevel=0.002)
    panel_mesh("HangingJacketCollar_R",
               [(0.006, -0.145), (0.078, -0.110), (0.096, -0.142), (0.018, -0.205)],
               0.008, -0.034, M["cream"], parent=root, bevel=0.002)
    box("HangingJacketZip", (0.008, 0.007, 0.535), (0, -0.034, -0.468),
        M["charcoal"], bevel=0.001, parent=root)
    box("HangingJacketHem", (0.210, 0.006, 0.010), (0, -0.033, -0.741),
        M["charcoal"], bevel=0.0015, parent=root)
    box("HangingJacketChestMark", (0.022, 0.006, 0.018), (0.060, -0.034, -0.270),
        M["brass"], bevel=0.002, parent=root)

    # A real hanger remains full-width inside the shoulders.  The open wire hook
    # straddles the root so every runtime socket can sit exactly on the rail.
    curve_tube("HangingJacketHanger",
               [(-0.105, 0.015, -0.135), (0, 0.015, -0.056), (0.105, 0.015, -0.135)],
               0.006, M["walnut"], parent=root)
    curve_tube("HangingJacketHook",
               [(0, 0.012, -0.058), (0, 0.012, -0.012), (0.006, 0.012, 0.020),
                (0.028, 0.012, 0.032), (0.044, 0.012, 0.012), (0.034, 0.012, -0.008)],
               0.0035, M["steel"], parent=root)
    empty("HANGER_SOCKET", (0, 0, 0), parent=root, size=0.025,
          props={"socket": "hanger", "pivot_role": "rail_contact"})
    collision_box("COL_HangingJacket", (0.255, 0.080, 0.690),
                  (0, 0, -0.410), M, parent=root)
    return root


def build_cap(M):
    dims = (0.21, 0.19, 0.115)
    root = root_for("checkout_product_cap", dims)
    sphere("CapCrown", 0.082, (0, 0.015, 0.052), M["fabric"], scale=(1.0, 0.92, 0.72), parent=root, segments=24, rings=12)
    panel_mesh("CapBrim", [(-0.092, 0.034), (-0.072, 0.070), (0.072, 0.070), (0.092, 0.034), (0.060, 0.018), (-0.060, 0.018)], 0.080, -0.072, M["fabric"], parent=root, bevel=0.006)
    panel_mesh("CapBrimUnder", [(-0.086, 0.034), (-0.066, 0.065), (0.066, 0.065), (0.086, 0.034), (0.055, 0.021), (-0.055, 0.021)], 0.070, -0.074, M["charcoal"], parent=root, bevel=0.004)
    for index, x in enumerate((-0.052, 0, 0.052), start=1):
        curve_tube(f"CapPanelSeam_{index}", [(x * 0.45, -0.012, 0.108), (x, -0.035, 0.073)],
                   0.0016, M["cream"], parent=root)
    sphere("CapTopButton", 0.006, (0, 0.015, 0.111), M["brass"], scale=(1, 1, 0.65), parent=root, segments=12, rings=7)
    for index, x in enumerate((-0.045, 0.045), start=1):
        torus(f"CapEyelet_{index}", 0.004, 0.0012, (x, -0.057, 0.083), M["brass"], rot=(math.pi / 2, 0, 0), parent=root)
    cylinder("CapCrest", 0.013, 0.004, (0, -0.0795, 0.072), M["brass"], rot=(math.pi / 2, 0, 0), vertices=16, parent=root)
    box("CapCrestSlash", (0.017, 0.0045, 0.0025), (0, -0.082, 0.072), M["charcoal"], rot=(0, math.radians(30), 0), bevel=0.0005, parent=root)
    return common_finish(root, dims, M, barcode=(0.065, 0.085, 0.040), primary=(0, 0.005, 0.055), collision=(0.20, 0.18, 0.11), barcode_kind="inside-tag")


def build_glove(M):
    dims = (0.18, 0.035, 0.22)
    root = root_for("checkout_product_glove", dims)
    panel_mesh("GlovePalm", [(-0.060, 0.006), (-0.072, 0.090), (-0.040, 0.155), (0.050, 0.145), (0.072, 0.065), (0.050, 0.008)], 0.024, 0, M["leather"], parent=root, bevel=0.006)
    for i, (x, length) in enumerate(((-0.045, 0.070), (-0.016, 0.090), (0.014, 0.086), (0.043, 0.070))):
        cylinder(f"GloveFinger_{i + 1}", 0.012, length, (x, 0, 0.135 + length / 2), M["leather"], vertices=12, bevel=0.003, parent=root)
    cylinder("GloveThumb", 0.014, 0.068, (0.068, 0, 0.082), M["leather"], rot=(0, math.radians(35), 0), vertices=12, parent=root)
    box("GloveCuff", (0.105, 0.030, 0.036), (-0.005, 0, 0.018), M["green"], bevel=0.006, parent=root)
    return common_finish(root, dims, M, barcode=(-0.050, -0.020, 0.032), primary=(0, 0, 0.080), collision=dims, barcode_kind="cuff-tag")


def build_tee_pouch(M):
    dims = (0.13, 0.035, 0.12)
    root = root_for("checkout_product_tee_pouch", dims)
    box("TeePouchBody", dims, (0, 0, 0.060), M["kraft"], bevel=0.009, parent=root)
    box("TeePouchHeader", (0.105, 0.038, 0.026), (0, 0, 0.103), M["green"], bevel=0.004, parent=root)
    cylinder("TeePouchHangHole", 0.007, 0.040, (0, 0, 0.107), M["charcoal"], rot=(math.pi / 2, 0, 0), vertices=14, parent=root)
    for i in range(5):
        cylinder(f"VisibleTee_{i + 1}", 0.0025, 0.072, ((i - 2) * 0.017, -0.020, 0.050 + abs(i - 2) * 0.003), M["cream"], vertices=8, parent=root)
        cylinder(f"TeeCup_{i + 1}", 0.006, 0.003, ((i - 2) * 0.017, -0.020, 0.086 + abs(i - 2) * 0.003), M["cream"], vertices=10, parent=root)
    return common_finish(root, dims, M, barcode=(0, 0.020, 0.055), primary=(0, 0, 0.060), collision=dims, barcode_kind="package-back")


def build_towel(M):
    dims = (0.20, 0.085, 0.085)
    root = root_for("checkout_product_towel_roll", dims)
    cylinder("TowelRoll", 0.041, 0.20, (0, 0, 0.043), M["fabric"], rot=(0, math.pi / 2, 0), vertices=24, bevel=0.003, parent=root)
    cylinder("TowelBand", 0.043, 0.032, (0, 0, 0.043), M["green"], rot=(0, math.pi / 2, 0), vertices=24, bevel=0.002, parent=root)
    curve_tube("TowelLoop", [(0.095, 0, 0.055), (0.125, 0, 0.095), (0.095, 0, 0.115)], 0.004, M["brass"], parent=root)
    return common_finish(root, dims, M, barcode=(0.015, -0.045, 0.044), primary=(0, 0, 0.045), collision=dims, barcode_kind="belly-tag")


def build_marker(M):
    dims = (0.14, 0.025, 0.105)
    root = root_for("checkout_product_marker_blister", dims)
    box("MarkerBackingCard", (dims[0], 0.010, dims[2]), (0, 0.002, 0.0525), M["cream"], bevel=0.004, parent=root)
    for i, x in enumerate((-0.034, 0.034)):
        cylinder(f"BallMarker_{i + 1}", 0.025, 0.004, (x, -0.006, 0.052), M["brass"] if i == 0 else M["green"], rot=(math.pi / 2, 0, 0), vertices=24, parent=root)
        torus(f"MarkerBlister_{i + 1}", 0.028, 0.0025, (x, -0.010, 0.052), M["glass"], rot=(math.pi / 2, 0, 0), parent=root)
    return common_finish(root, dims, M, barcode=(0, 0.014, 0.052), primary=(0, 0, 0.055), collision=dims, barcode_kind="package-back")


def build_rangefinder(M):
    dims = (0.19, 0.15, 0.105)
    root = root_for("checkout_product_rangefinder", dims)
    box("RangefinderBody", (0.145, 0.118, 0.088), (0, 0, 0.052), M["charcoal"], bevel=0.025, parent=root)
    box("RangefinderGrip", (0.080, 0.124, 0.095), (-0.036, 0, 0.050), M["rubber"], bevel=0.020, parent=root)
    for x, name in ((0.067, "Objective"), (-0.067, "Eyepiece")):
        cylinder(f"Rangefinder{name}Barrel", 0.034 if x > 0 else 0.026, 0.027, (x, 0, 0.058), M["plastic"], rot=(0, math.pi / 2, 0), vertices=20, parent=root)
        cylinder(f"Rangefinder{name}Glass", 0.027 if x > 0 else 0.020, 0.003, (x + (0.015 if x > 0 else -0.015), 0, 0.058), M["glass"], rot=(0, math.pi / 2, 0), vertices=20, parent=root)
    torus("RangefinderObjectiveBezel", 0.031, 0.0035, (0.083, 0, 0.058), M["brass"], rot=(0, math.pi / 2, 0), parent=root)
    box("RangefinderTopScreen", (0.050, 0.047, 0.005), (0.014, 0.006, 0.1015), M["glass"], bevel=0.006, parent=root)
    for index, (x, y) in enumerate(((0.046, -0.022), (0.046, 0.026)), start=1):
        cylinder(f"RangefinderButton_{index}", 0.010, 0.007, (x, y, 0.103), M["brass"], vertices=16, parent=root)
    box("RangefinderSideCrest", (0.004, 0.030, 0.030), (0.074, -0.035, 0.061), M["brass"], bevel=0.005, parent=root)
    curve_tube("RangefinderLanyard", [(-0.075, 0.040, 0.035), (-0.105, 0.065, 0.020), (-0.080, 0.080, 0.010)], 0.003, M["sage"], parent=root)
    return common_finish(root, dims, M, barcode=(-0.045, -0.068, 0.052), primary=(-0.025, 0, 0.055), collision=(0.19, 0.15, 0.105), barcode_kind="lanyard-tag")


def build_umbrella(M):
    dims = (0.84, 0.11, 0.105)
    root = root_for("checkout_product_umbrella", dims)
    cylinder("UmbrellaShaft", 0.007, 0.76, (-0.020, 0, 0.048), M["steel"], rot=(0, math.pi / 2, 0), vertices=10, parent=root)
    cone("FoldedCanopy", 0.052, 0.018, 0.58, (0.080, 0, 0.050), M["fabric"], rot=(0, math.pi / 2, 0), parent=root, vertices=18)
    box("UmbrellaKeeper", (0.045, 0.112, 0.025), (-0.055, 0, 0.050), M["brass"], bevel=0.006, parent=root)
    torus("UmbrellaCrook", 0.042, 0.008, (-0.388, 0, 0.065), M["charcoal"], rot=(math.pi / 2, 0, 0), parent=root)
    cylinder("UmbrellaTip", 0.006, 0.055, (0.408, 0, 0.048), M["brass"], rot=(0, math.pi / 2, 0), vertices=10, parent=root)
    return common_finish(root, dims, M, barcode=(-0.055, -0.060, 0.052), primary=(-0.12, 0, 0.052), secondary=(0.19, 0, 0.052), collision=dims, barcode_kind="keeper-tag")


def build_stand_bag(M):
    dims = (0.72, 0.30, 0.25)
    root = root_for("checkout_product_stand_bag", dims)
    # The visible mesh—not only the collision box—honours the declared
    # 72 x 30 x 25 cm envelope.  Keeping the aspect ratio authored prevents the
    # runtime's uniform GLB fit from shrinking a full-size bag into a tiny prop.
    cone("StandBagBody", 0.120, 0.092, 0.70, (0, 0, 0.125), M["fabric"], rot=(0, math.pi / 2, 0), parent=root, vertices=18)
    torus("StandBagTopRim", 0.092, 0.012, (0.35, 0, 0.125), M["charcoal"], rot=(0, math.pi / 2, 0), parent=root)
    torus("StandBagBaseRim", 0.087, 0.010, (-0.35, 0, 0.125), M["charcoal"], rot=(0, math.pi / 2, 0), parent=root)
    # The open top is the strongest bag read at aisle distance. A four-way
    # divider replaces the former empty tube silhouette without changing the
    # envelope that the delivery and handoff code already use.
    box("StandBagDividerFrontBack", (0.012, 0.166, 0.014), (0.351, 0, 0.125), M["brass"], bevel=0.003, parent=root)
    box("StandBagDividerLeftRight", (0.012, 0.014, 0.166), (0.351, 0, 0.125), M["brass"], bevel=0.003, parent=root)
    box("StandBagPocket", (0.22, 0.075, 0.13), (-0.03, -0.105, 0.110), M["green"], bevel=0.018, parent=root)
    box("StandBagBallPocket", (0.13, 0.068, 0.09), (0.18, -0.102, 0.105), M["sage"], bevel=0.014, parent=root)
    box("StandBagPocketFlap", (0.155, 0.012, 0.042), (0.010, -0.145, 0.158), M["sku_accent"], bevel=0.009, parent=root)
    box("StandBagPocketZip", (0.128, 0.005, 0.006), (0.010, -0.152, 0.160), M["brass"], bevel=0.001, parent=root)
    curve_tube("StandBagFrontPiping", [(-0.265, -0.112, 0.176), (-0.020, -0.130, 0.205), (0.270, -0.108, 0.174)], 0.004, M["cream"], parent=root)
    cylinder("StandBagCrest", 0.025, 0.004, (0.190, -0.142, 0.112), M["brass"], rot=(math.pi / 2, 0, 0), vertices=18, parent=root)
    curve_tube("StandBagShoulderStrap", [(-0.24, 0.105, 0.18), (-0.02, 0.14, 0.225), (0.20, 0.105, 0.19)], 0.014, M["charcoal"], parent=root)
    for i, y in enumerate((-0.065, 0.065)):
        cylinder(f"StandLeg_{i + 1}", 0.007, 0.50, (-0.03, y, 0.058), M["steel"], rot=(0, math.pi / 2 - math.radians(11), 0), vertices=10, parent=root)
        box(f"StandLegFoot_{i + 1}", (0.050, 0.025, 0.012), (-0.267, y, 0.012), M["rubber"], bevel=0.004, parent=root)
    return common_finish(root, dims, M, barcode=(-0.08, -0.160, 0.140), primary=(-0.02, 0.115, 0.220), secondary=(0.19, 0.080, 0.200), collision=(0.72, 0.30, 0.25), barcode_kind="strap-tag")


def shoe_piece(prefix, x, y, M, root, splay):
    box(f"{prefix}Sole", (0.245, 0.082, 0.025), (x, y, 0.014), M["rubber"], rot=(0, 0, splay), bevel=0.010, parent=root)
    box(f"{prefix}Midsole", (0.226, 0.078, 0.022), (x + 0.004, y, 0.030), M["cream"], rot=(0, 0, splay), bevel=0.010, parent=root)
    box(f"{prefix}Upper", (0.205, 0.073, 0.065), (x - 0.010, y, 0.054), M["leather"], rot=(0, 0, splay), bevel=0.026, parent=root)
    sphere(f"{prefix}Toe", 0.047, (x + math.cos(splay) * 0.082, y + math.sin(splay) * 0.082, 0.050), M["leather"], scale=(1.15, 0.82, 0.68), parent=root, segments=18, rings=10)
    box(f"{prefix}Tongue", (0.082, 0.052, 0.032), (x - 0.038, y, 0.083), M["green"], rot=(0, 0, splay), bevel=0.012, parent=root)
    box(f"{prefix}Saddle", (0.073, 0.078, 0.024), (x + 0.002, y, 0.072), M["sku_accent"], rot=(0, 0, splay), bevel=0.009, parent=root)
    box(f"{prefix}HeelCounter", (0.047, 0.079, 0.055), (x - 0.096, y, 0.057), M["sage"], rot=(0, 0, splay), bevel=0.014, parent=root)
    for lace in range(3):
        lx = x - 0.020 + lace * 0.022
        curve_tube(f"{prefix}Lace_{lace + 1}", [(lx, y - 0.032, 0.082), (lx, y + 0.032, 0.082)], 0.002, M["cream"], parent=root)
    curve_tube(f"{prefix}QuarterPiping", [(x - 0.083, y - 0.038, 0.067), (x - 0.010, y - 0.040, 0.081), (x + 0.058, y - 0.036, 0.062)], 0.002, M["brass"], parent=root)
    for sx in (-0.065, 0, 0.065):
        cylinder(f"{prefix}Spike_{sx}", 0.005, 0.010, (x + sx, y, 0.002), M["brass"], vertices=8, parent=root)


def build_shoe_pair(M):
    dims = (0.29, 0.205, 0.105)
    root = root_for("checkout_product_shoe_pair", dims)
    shoe_piece("Left", 0, -0.052, M, root, math.radians(-5))
    shoe_piece("Right", 0, 0.052, M, root, math.radians(5))
    return common_finish(root, dims, M, barcode=(0.025, -0.110, 0.070), primary=(0, 0, 0.060), collision=dims, barcode_kind="lace-tag")


def build_shoe_box(M):
    """Fairhollow retail shoe carton sized for Asset 27's authored sockets.

    This is intentionally a retail package rather than a freight carton: the
    removable lid, fitted base, end label and barcode all remain readable at
    the player's shelf-view distance.  The root origin is the physical centre
    of the lower face, so placement sockets can rest it directly on a shelf.
    """
    dims = (0.310, 0.190, 0.115)
    root = root_for("checkout_product_shoe_box", dims)
    root["pivot_description"] = "base-centre shelf contact at local Z=0"
    root["placement"] = "retail shoe-wall shelf; label faces -Y"
    root["product_kind"] = "retail shoe box"
    root["fictional_brand"] = "Fairhollow Golf"
    root["separate_lid"] = True

    # A close-fitting formed-fibre base and a separately named lift-off lid.
    # The green lid provides the family identity from aisle distance while the
    # kraft body keeps the package grounded in the shop's restrained palette.
    box("ShoeBoxBase", (0.302, 0.182, 0.093), (0, 0, 0.0465),
        M["kraft"], bevel=0.006, parent=root,
        props={"component": "retail_carton_base", "pivot_role": "base_contact"})
    box("ShoeBoxLid", (0.310, 0.190, 0.024), (0, 0, 0.101),
        M["green"], bevel=0.005, parent=root,
        props={"component": "removable_lid", "grip_edge": "front_and_sides"})
    box("ShoeBoxLidTopPanel", (0.202, 0.108, 0.0015), (0, 0, 0.11375),
        M["cream"], bevel=0.0006, parent=root)
    for side, angle in ((-1, -18), (1, 18)):
        box(f"ShoeBoxLidCrest_{'L' if side < 0 else 'R'}",
            (0.058, 0.014, 0.001), (side * 0.026, 0, 0.1145),
            M["brass"], rot=(0, 0, math.radians(angle)), bevel=0.0004, parent=root)

    # The end label is intentionally geometry-based so it survives the runtime
    # material-slot remap and remains project-owned without an external texture.
    label_y = -0.0925
    box("ShoeBoxFrontLabel", (0.286, 0.003, 0.060), (0, label_y, 0.047),
        M["cream"], bevel=0.002, parent=root,
        props={"label_role": "brand_size", "label_facing": "-Y"})
    box("ShoeBoxBrandBand", (0.166, 0.0012, 0.017), (-0.057, -0.0940, 0.0665),
        M["green"], bevel=0.001, parent=root)
    flat_label_text("ShoeBoxBrand", "FAIRHOLLOW", (-0.057, -0.0938, 0.0665),
                    M["cream"], size=0.0135, parent=root)
    flat_label_text("ShoeBoxModel", "TOUR SPIKE", (-0.057, -0.0938, 0.0435),
                    M["charcoal"], size=0.012, parent=root)
    flat_label_text("ShoeBoxFit", "MEN  /  WATER RESISTANT", (-0.057, -0.0938, 0.0275),
                    M["charcoal"], size=0.0055, parent=root)

    box("ShoeBoxSizeBadge", (0.038, 0.0012, 0.044), (0.119, -0.0940, 0.047),
        M["green"], bevel=0.002, parent=root,
        props={"label_role": "shoe_size", "size_us": "10"})
    flat_label_text("ShoeBoxSize", "10", (0.119, -0.0938, 0.047),
                    M["cream"], size=0.018, parent=root)

    # TAGS (2026-08-06): "hunt every tag/QR reference, delete all." Twelve
    # charcoal bars used to be printed across this front label as a physical
    # retail code. The brand, model, fit and size printing stays — that is a
    # shoe box's own packaging — but the code is gone.
    return common_finish(
        root,
        dims,
        M,
        barcode=(0.046, -0.095, 0.038),   # the ANCHOR keeps its place; the printed bars are gone
        primary=(0, 0, 0.066),
        collision=dims,
        barcode_kind="carton-side",
    )


def build_sock_pair(M):
    dims = (0.15, 0.105, 0.065)
    root = root_for("checkout_product_sock_pair", dims)
    for index, y in enumerate((-0.027, 0.027)):
        cylinder(f"SockRoll_{index + 1}", 0.032, 0.135, (0, y, 0.034), M["fabric"], rot=(0, math.pi / 2, 0), vertices=16, parent=root)
        torus(f"SockCuff_{index + 1}", 0.026, 0.005, (-0.067, y, 0.034), M["cream"], rot=(0, math.pi / 2, 0), parent=root)
    box("SockPairBand", (0.054, 0.112, 0.068), (0, 0, 0.034), M["green"], bevel=0.006, parent=root)
    return common_finish(root, dims, M, barcode=(0, 0.058, 0.034), primary=(0, 0, 0.040), collision=dims, barcode_kind="apparel-band")


def build_headcover(M):
    dims = (0.14, 0.12, 0.20)
    root = root_for("checkout_product_headcover", dims)
    cylinder("HeadcoverSock", 0.045, 0.12, (0, 0, 0.060), M["fabric"], vertices=16, parent=root)
    sphere("HeadcoverHood", 0.068, (0, 0, 0.145), M["fabric"], scale=(0.85, 0.80, 1.0), parent=root, segments=20, rings=12)
    curve_tube("HeadcoverPiping", [(-0.045, -0.046, 0.140), (0, -0.058, 0.200), (0.045, -0.046, 0.140)], 0.003, M["cream"], parent=root)
    text_mesh("HeadcoverMark", "P", (0, -0.060, 0.150), M["brass"], size=0.035, rot=(math.pi / 2, 0, 0), parent=root)
    return common_finish(root, dims, M, barcode=(0.045, -0.065, 0.075), primary=(0, 0, 0.095), collision=dims, barcode_kind="apparel-tag")


def build_visor(M):
    """Open-crown Pine Hills visor sized for checkout and the hat wall."""
    dims = (0.208, 0.210, 0.070)
    root = root_for("checkout_product_visor", dims)
    root["fictional_brand"] = "Pine Hills Municipal Golf"

    # A softly rounded bill reaches the retail envelope while the fabric band
    # remains visibly open above it.  The rear strap is separately named so a
    # future size-adjust interaction can animate it without rebuilding the prop.
    box("VisorBill", (0.208, 0.112, 0.012), (0, -0.049, 0.006),
        M["fabric"], bevel=0.034, parent=root)
    box("VisorBillUnder", (0.196, 0.104, 0.004), (0, -0.050, 0.0025),
        M["charcoal"], bevel=0.031, parent=root)
    torus("VisorHeadBand", 0.094, 0.010, (0, 0.010, 0.050),
          M["fabric"], parent=root)
    box("VisorFrontBand", (0.174, 0.024, 0.050), (0, -0.083, 0.045),
        M["fabric"], bevel=0.010, parent=root)
    box("VisorRearAdjuster", (0.072, 0.014, 0.018), (0, 0.098, 0.044),
        M["charcoal"], bevel=0.005, parent=root,
        props={"component": "adjustable_rear_strap"})
    box("VisorCrest", (0.066, 0.004, 0.026), (0, -0.0965, 0.048),
        M["sku_accent"], bevel=0.006, parent=root)
    flat_label_text("VisorBrand", "PINE HILLS", (0, -0.099, 0.048),
                    M["cream"], size=0.009, parent=root)
    return common_finish(
        root, dims, M,
        barcode=(0.068, 0.103, 0.043),
        primary=(0, 0, 0.045),
        collision=(0.208, 0.210, 0.070),
        barcode_kind="inside-tag",
    )


def build_folded_bottom(M):
    """Shared folded trouser/short silhouette with a truthful waist and fly."""
    dims = (0.230, 0.195, 0.095)
    root = root_for("checkout_product_folded_bottom", dims)
    box("FoldedBottomLower", (0.230, 0.195, 0.055), (0, 0, 0.0275),
        M["fabric"], bevel=0.016, parent=root)
    box("FoldedBottomUpper", (0.218, 0.184, 0.044), (0, -0.003, 0.073),
        M["fabric"], bevel=0.014, parent=root)
    box("FoldedWaistBand", (0.222, 0.032, 0.014), (0, -0.078, 0.089),
        M["sku_accent"], bevel=0.004, parent=root)
    box("FoldedFly", (0.008, 0.076, 0.004), (0.020, -0.031, 0.096),
        M["brass"], bevel=0.001, parent=root)
    # TAGS: FoldedSizeTag is gone — a cream size tag stitched onto folded
    # trousers is exactly the signage this sweep is removing.
    return common_finish(
        root, dims, M,
        barcode=(0.070, -0.100, 0.070),
        primary=(0, 0, 0.055),
        collision=dims,
        barcode_kind="apparel-tag",
    )


def build_divot_tool_card(M):
    dims = (0.130, 0.020, 0.100)
    root = root_for("checkout_product_divot_tool_card", dims)
    box("DivotBackingCard", dims, (0, 0, dims[2] / 2),
        M["cream"], bevel=0.004, parent=root)
    # U-shaped repair tool: two tines, a palm plate, and a brass marker.
    box("DivotToolSpine", (0.054, 0.004, 0.034), (0, -0.008, 0.057),
        M["steel"], bevel=0.006, parent=root)
    for index, x in enumerate((-0.016, 0.016), start=1):
        box(f"DivotToolTine_{index}", (0.010, 0.004, 0.040),
            (x, -0.008, 0.026), M["steel"], bevel=0.003, parent=root)
    cylinder("DivotBallMarker", 0.017, 0.004, (0, -0.008, 0.074),
             M["sku_accent"], rot=(math.pi / 2, 0, 0), vertices=20, parent=root)
    box("DivotHeader", (0.112, 0.004, 0.018), (0, -0.008, 0.090),
        M["green"], bevel=0.003, parent=root)
    return common_finish(
        root, dims, M,
        barcode=(0, 0.012, 0.048),
        primary=(0, 0, 0.052),
        collision=dims,
        barcode_kind="package-back",
    )


def build_eyewear_case(M):
    dims = (0.160, 0.070, 0.060)
    root = root_for("checkout_product_eyewear_case", dims)
    box("EyewearCaseLower", (0.160, 0.070, 0.036), (0, 0, 0.018),
        M["charcoal"], bevel=0.025, parent=root)
    box("EyewearCaseLid", (0.158, 0.068, 0.026), (0, 0, 0.047),
        M["sku_accent"], bevel=0.024, parent=root,
        props={"component": "hinged_case_lid"})
    curve_tube("EyewearLensMark", [(-0.048, -0.036, 0.051), (-0.016, -0.038, 0.051),
                                    (0, -0.036, 0.046), (0.016, -0.038, 0.051),
                                    (0.048, -0.036, 0.051)],
               0.0025, M["brass"], parent=root)
    return common_finish(
        root, dims, M,
        barcode=(0, 0.037, 0.030),
        primary=(0, 0, 0.036),
        collision=dims,
        barcode_kind="package-back",
    )


def build_bottle(M):
    dims = (0.072, 0.072, 0.220)
    root = root_for("checkout_product_bottle", dims)
    cylinder("BottleBody", 0.036, 0.178, (0, 0, 0.089),
             M["plastic"], vertices=24, parent=root)
    cone("BottleShoulder", 0.036, 0.020, 0.026, (0, 0, 0.184),
         M["plastic"], parent=root, vertices=24)
    cylinder("BottleNeck", 0.019, 0.018, (0, 0, 0.205),
             M["plastic"], vertices=20, parent=root)
    cylinder("BottleCap", 0.021, 0.012, (0, 0, 0.214),
             M["charcoal"], vertices=20, parent=root)
    cylinder("BottleLabelBand", 0.0365, 0.070, (0, 0, 0.105),
             M["sku_accent"], vertices=24, parent=root)
    box("BottleLabelCrest", (0.026, 0.003, 0.028), (0, -0.0375, 0.108),
        M["cream"], bevel=0.004, parent=root)
    return common_finish(
        root, dims, M,
        barcode=(0, 0.039, 0.103),
        primary=(0, 0, 0.112),
        collision=dims,
        barcode_kind="package-back",
    )


def build_scorecard(M):
    dims = (0.150, 0.105, 0.005)
    root = root_for("checkout_product_scorecard", dims)
    root["fictional_brand"] = "Pine Hills Municipal Golf"
    box("ScorecardStock", dims, (0, 0, dims[2] / 2),
        M["cream"], bevel=0.002, parent=root)
    box("ScorecardHeader", (0.138, 0.020, 0.0005), (0, -0.041, 0.00475),
        M["green"], bevel=0.001, parent=root)
    # A deterministic brass course crest replaces raster lettering on the
    # five-millimetre stock; exact Pine Hills wording is supplied by the live
    # POS/price-label layer while the physical card retains the saved brand ID.
    box("ScorecardCrestPole", (0.002, 0.014, 0.0005), (-0.010, -0.041, 0.00475),
        M["brass"], bevel=0.0, parent=root)
    box("ScorecardCrestFlag", (0.020, 0.008, 0.0005), (0, -0.044, 0.00475),
        M["brass"], bevel=0.001, parent=root)
    box("ScorecardFold", (0.002, 0.105, 0.0005), (0, 0, 0.00475),
        M["brass"], bevel=0.0, parent=root)
    for index, x in enumerate((-0.054, -0.027, 0.027, 0.054), start=1):
        box(f"ScorecardGridV_{index}", (0.001, 0.070, 0.0005), (x, 0.012, 0.00475),
            M["sage"], bevel=0.0, parent=root)
    for index, y in enumerate((-0.018, 0.004, 0.026, 0.048), start=1):
        box(f"ScorecardGridH_{index}", (0.130, 0.001, 0.0005), (0, y, 0.00475),
            M["sage"], bevel=0.0, parent=root)
    return common_finish(
        root, dims, M,
        barcode=(0.050, 0.054, 0.003),
        primary=(0, 0, 0.004),
        collision=dims,
        barcode_kind="package-back",
    )


def build_beverage_can(M):
    dims = (0.066, 0.066, 0.122)
    root = root_for("checkout_product_beverage_can", dims)
    cylinder("BeverageCanBody", 0.033, 0.122, (0, 0, 0.061),
             M["sku_accent"], vertices=24, parent=root)
    torus("BeverageCanTopRim", 0.029, 0.0025, (0, 0, 0.120),
          M["steel"], parent=root)
    torus("BeverageCanBaseRim", 0.029, 0.0025, (0, 0, 0.002),
          M["steel"], parent=root)
    box("BeverageCanPullTab", (0.020, 0.009, 0.002), (0, -0.006, 0.122),
        M["charcoal"], bevel=0.003, parent=root)
    box("BeverageCanLabel", (0.024, 0.003, 0.046), (0, -0.034, 0.062),
        M["cream"], bevel=0.005, parent=root)
    return common_finish(
        root, dims, M,
        barcode=(0, 0.035, 0.058),
        primary=(0, 0, 0.064),
        collision=dims,
        barcode_kind="package-back",
    )


def build_snack_pouch(M):
    dims = (0.160, 0.0715, 0.195)
    root = root_for("checkout_product_snack_pouch", dims)
    box("SnackPouchBody", (0.160, 0.0715, 0.175), (0, 0, 0.0975),
        M["sku_accent"], bevel=0.018, parent=root)
    box("SnackPouchTopCrimp", (0.160, 0.069, 0.014), (0, 0, 0.188),
        M["cream"], bevel=0.003, parent=root)
    box("SnackPouchBottomCrimp", (0.160, 0.069, 0.014), (0, 0, 0.007),
        M["cream"], bevel=0.003, parent=root)
    box("SnackPouchLabel", (0.104, 0.003, 0.086), (0, -0.037, 0.105),
        M["cream"], bevel=0.012, parent=root)
    box("SnackPouchCourseStripe", (0.070, 0.002, 0.010), (0, -0.039, 0.116),
        M["green"], bevel=0.003, parent=root)
    return common_finish(
        root, dims, M,
        barcode=(0, 0.038, 0.094),
        primary=(0, 0, 0.105),
        collision=dims,
        barcode_kind="package-back",
    )


def build_snack_bar(M):
    dims = (0.150, 0.025, 0.055)
    root = root_for("checkout_product_snack_bar", dims)
    box("SnackBarWrapper", dims, (0, 0, dims[2] / 2),
        M["sku_accent"], bevel=0.008, parent=root)
    for index, x in enumerate((-0.067, 0.067), start=1):
        box(f"SnackBarCrimp_{index}", (0.016, 0.024, 0.054), (x, 0, 0.0275),
            M["cream"], bevel=0.003, parent=root)
    box("SnackBarLabel", (0.080, 0.003, 0.036), (0, -0.011, 0.028),
        M["cream"], bevel=0.006, parent=root)
    box("SnackBarStripe", (0.052, 0.001, 0.008), (0, -0.012, 0.030),
        M["green"], bevel=0.002, parent=root)
    return common_finish(
        root, dims, M,
        barcode=(0, 0.014, 0.028),
        primary=(0, 0, 0.032),
        collision=dims,
        barcode_kind="package-back",
    )


BUILDERS = {
    "checkout_product_driver": build_driver,
    "checkout_product_iron_set": build_iron_set,
    "checkout_product_putter": build_putter,
    "checkout_product_wedge": build_wedge,
    "checkout_product_ball_carton": build_ball_carton,
    "checkout_product_folded_polo": build_folded_polo,
    "checkout_product_folded_jacket": build_folded_jacket,
    "checkout_product_hanging_polo": build_hanging_polo,
    "checkout_product_hanging_jacket": build_hanging_jacket,
    "checkout_product_cap": build_cap,
    "checkout_product_glove": build_glove,
    "checkout_product_tee_pouch": build_tee_pouch,
    "checkout_product_towel_roll": build_towel,
    "checkout_product_marker_blister": build_marker,
    "checkout_product_rangefinder": build_rangefinder,
    "checkout_product_umbrella": build_umbrella,
    "checkout_product_stand_bag": build_stand_bag,
    "checkout_product_shoe_pair": build_shoe_pair,
    "checkout_product_shoe_box": build_shoe_box,
    "checkout_product_sock_pair": build_sock_pair,
    "checkout_product_headcover": build_headcover,
    "checkout_product_visor": build_visor,
    "checkout_product_folded_bottom": build_folded_bottom,
    "checkout_product_divot_tool_card": build_divot_tool_card,
    "checkout_product_eyewear_case": build_eyewear_case,
    "checkout_product_bottle": build_bottle,
    "checkout_product_scorecard": build_scorecard,
    "checkout_product_beverage_can": build_beverage_can,
    "checkout_product_snack_pouch": build_snack_pouch,
    "checkout_product_snack_bar": build_snack_bar,
}


def add_build_info(asset_id):
    text = bpy.data.texts.new("BUILD_INFO.txt")
    text.write(
        "Pinehollow Golf checkout product family\n"
        f"asset_id: {asset_id}\n"
        f"build_version: {BUILD_VERSION}\n"
        f"builder: {SCRIPT.relative_to(ROOT).as_posix()}\n"
        "units: metres\n"
        "source: original in-repository geometry; no external assets\n"
        "raw Tripo sources: untouched and not imported\n"
    )


def bake_linked_smoothing(root):
    """Make editable sources portable instead of retaining Blender's asset link.

    Blender 5.1 implements ``shade_auto_smooth`` as a linked Geometry Nodes asset.
    Baking that modifier preserves the authored normals while removing the implicit
    dependency on the local Blender installation's geometry-nodes essentials file.
    """
    for obj in descendants(root):
        if obj.type != "MESH":
            continue
        for modifier in list(obj.modifiers):
            node_group = getattr(modifier, "node_group", None)
            if modifier.type != "NODES" or node_group is None or not node_group.name.startswith("Smooth by Angle"):
                continue
            activate(obj)
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    # Applying the modifiers leaves the linked node-group IDs cached with zero
    # meaningful scene users. Remove those IDs explicitly before the orphan pass;
    # otherwise Blender writes library stubs into every editable source file.
    for node_group in list(bpy.data.node_groups):
        if node_group.library is not None:
            bpy.data.node_groups.remove(node_group)
    bpy.data.orphans_purge(do_recursive=True)
    while bpy.data.libraries:
        bpy.data.libraries.remove(bpy.data.libraries[0])
    linked = [library.filepath for library in bpy.data.libraries]
    if linked:
        raise RuntimeError(f"checkout source retains linked Blender libraries: {linked}")


def save_and_export(asset_id, root):
    bake_linked_smoothing(root)
    add_build_info(asset_id)
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
        export_animations=False,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )
    print(f"BUILT|{asset_id}|source={blend_path}|export={glb_path}|nodes={len(selected)}")


def render_product_preview(asset_id, root):
    """Render the audited retail package without adding preview rig to source."""
    audited = {
        "checkout_product_hanging_polo",
        "checkout_product_cap",
        "checkout_product_rangefinder",
        "checkout_product_stand_bag",
        "checkout_product_shoe_pair",
        "checkout_product_shoe_box",
    }
    if asset_id not in audited:
        return
    # Reuse the cash-register kit's established studio setup and canonical
    # Assets/checkout/previews destination.  The .blend and GLB were already
    # saved above, so the temporary floor/lights/camera never enter either asset.
    from checkout_kit_lib import render_preview

    render_preview(asset_id, root, azimuth=32, elevation=22)


def requested_assets():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if not args:
        return list(BUILDERS)
    unknown = sorted(set(args) - set(BUILDERS))
    if unknown:
        raise SystemExit(f"Unknown product assets: {', '.join(unknown)}")
    return args


def main():
    chosen = requested_assets()
    for asset_id in chosen:
        reset_scene()
        M = product_materials()
        root = BUILDERS[asset_id](M)
        save_and_export(asset_id, root)
        render_product_preview(asset_id, root)
    print(f"COMPLETE|assets={len(chosen)}|source_dir={SOURCE_DIR}|export_dir={EXPORT_DIR}")


if __name__ == "__main__":
    main()
