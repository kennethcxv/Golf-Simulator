"""Original world-polish assets for the Property Expansion overhaul.

Builds two project-owned, gameplay-ready GLBs:

* ``maintenance_yard_dressing`` — a 9.4 m x 8.0 m organized service apron
  with boundary rails, drainage, parking stops, a grounds rack, hose reel,
  parts storage, signage, and simple collision proxies.
* ``golfer_iron`` — a 1.04 m stylized iron with its origin and ``SOCKET_Grip``
  at the player's top-hand grip so the runtime can parent it directly to an
  articulated wrist.

The assets use only original geometry and the Pinehollow palette. No external
sources or textures are involved.

Run:
  "<blender>" --background --factory-startup \
    --python tools/blender/build_world_polish.py -- render

Convention: metres, Z up, -Y forward. Static visual geometry is batched while
collision proxies and sockets remain separately named in the exported GLB.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import lib_props as L

L.EXPORT_DIR = L.ROOT / "vendor" / "models" / "world"
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def world_mats():
    return {
        # lib_props receives linear values; these settle near warm mid-grey in
        # the game's bright outdoor tone map instead of bleaching toward white.
        "yard_gravel": L.mat("M_YardCompactedGravel", (0.095, 0.088, 0.074), roughness=0.98),
        "yard_concrete": L.mat("M_YardWarmConcrete", (0.175, 0.160, 0.135), roughness=0.93),
        "yard_green": L.mat("M_YardDeepGolfGreen", (0.030, 0.115, 0.060), roughness=0.52, metallic=0.08),
        "yard_sage": L.mat("M_YardMutedSage", (0.255, 0.345, 0.235), roughness=0.72),
        "yard_oak": L.mat("M_YardNaturalOak", (0.425, 0.245, 0.105), roughness=0.72),
        "yard_charcoal": L.mat("M_YardWarmCharcoal", (0.045, 0.042, 0.037), roughness=0.70, metallic=0.25),
        "yard_brass": L.mat("M_YardRestrainedBrass", (0.395, 0.245, 0.065), roughness=0.44, metallic=0.72),
        "yard_red": L.mat("M_YardSafetyRed", (0.390, 0.055, 0.030), roughness=0.62),
        "iron_steel": L.mat("M_IronBrushedSteel", (0.430, 0.455, 0.470), roughness=0.30, metallic=0.92),
        "iron_face": L.mat("M_IronFace", (0.285, 0.300, 0.315), roughness=0.40, metallic=0.88),
        "iron_grip": L.mat("M_IronGrip", (0.025, 0.055, 0.035), roughness=0.88),
        "iron_brass": L.mat("M_IronFerruleBrass", (0.370, 0.225, 0.055), roughness=0.38, metallic=0.80),
    }


def _collision(name, dims, loc, mat_, parent):
    proxy = L.box(name, dims, loc, mat_, bevel=0, parent=parent)
    proxy["collision_proxy"] = True
    proxy["collision_shape"] = "box"
    return proxy


def _fence_post(name, x, y, M, parent):
    L.box(name, (0.14, 0.14, 1.48), (x, y, 0.74), M["yard_green"], bevel=0.018, parent=parent)
    L.frustum(f"{name}_Cap", 0.115, 0.052, 0.08, (x, y, 1.52),
              M["yard_brass"], segments=4, parent=parent)


def _grounds_tool(name, x, y, kind, M, parent):
    # Handles have individually believable lengths but are static rack dressing.
    handle = L.cyl(f"{name}_Handle", 0.018, 1.28, (x, y, 0.80), M["yard_oak"], verts=12,
                   bevel=0.002, parent=parent)
    handle.rotation_euler[1] = math.radians(-7 if kind == "rake" else 5)
    L.activate(handle)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    if kind == "rake":
        L.box(f"{name}_Head", (0.46, 0.045, 0.055), (x + 0.075, y, 0.17),
              M["yard_charcoal"], bevel=0.008, parent=parent)
        for index in range(9):
            L.box(f"{name}_Tine_{index:02d}", (0.018, 0.03, 0.18),
                  (x - 0.12 + index * 0.04, y, 0.085), M["yard_charcoal"],
                  bevel=0.003, parent=parent)
    elif kind == "shovel":
        L.rounded_box(f"{name}_Blade", (0.25, 0.055, 0.30), (x - 0.06, y, 0.16),
                      M["yard_charcoal"], corner=0.055, segments=4, bevel=0.006, parent=parent)
    else:
        L.box(f"{name}_Broom", (0.34, 0.10, 0.13), (x - 0.045, y, 0.11),
              M["yard_sage"], bevel=0.025, parent=parent)


def build_maintenance_yard(M):
    root = L.asset_root("maintenance_yard_dressing", (9.40, 8.00, 1.74))
    root["source"] = "Original Golf Flipper production asset"
    root["license"] = "Project-owned"
    root["real_world_dimensions_m"] = "9.40 x 8.00 x 1.74"
    root["palette"] = "Pinehollow warm cream, golf green, sage, oak, charcoal, brass"

    # Compacted service surface, inset concrete vehicle bay, and drainage edge.
    L.rounded_box("CompactedServiceApron", (9.40, 8.00, 0.070), (0, 0, 0.035),
                  M["yard_gravel"], corner=0.18, segments=5, bevel=0.006, parent=root)
    L.rounded_box("TractorServicePad", (4.45, 4.75, 0.045), (-1.95, -0.75, 0.0775),
                  M["yard_concrete"], corner=0.13, segments=4, bevel=0.004, parent=root)
    L.box("DrainageChannel", (8.55, 0.20, 0.055), (0, -3.57, 0.085),
          M["yard_charcoal"], bevel=0.025, parent=root)
    for index in range(18):
        L.box(f"DrainSlot_{index:02d}", (0.24, 0.225, 0.008),
              (-4.05 + index * 0.48, -3.57, 0.117), M["yard_brass"], bevel=0.003, parent=root)

    # Vehicle bay markings and wheel stops make the machinery look parked, not scattered.
    for x in (-3.85, -0.10):
        L.box(f"BayStripe_{x:+.2f}", (0.055, 4.20, 0.018), (x, -0.72, 0.111),
              M["yard_brass"], bevel=0.005, parent=root)
    for x in (-3.35, -0.70):
        L.rounded_box(f"WheelStop_{x:+.2f}", (0.85, 0.18, 0.15), (x, 1.24, 0.17),
                      M["yard_charcoal"], corner=0.055, segments=4, bevel=0.004, parent=root)

    # A restrained U-shaped boundary: airy timber rails instead of a suburban privacy wall.
    # The authored shed closes the rear-right boundary in game, so the rail
    # intentionally stops at its west wall instead of passing through it.
    for x in (-4.52, -2.26, 0.0):
        _fence_post(f"BackFencePost_{x:+.2f}", x, 3.78, M, root)
    for z in (0.56, 1.18):
        L.box(f"BackFenceRail_{z:.2f}", (4.66, 0.075, 0.075), (-2.26, 3.78, z),
              M["yard_oak"], bevel=0.012, parent=root)
    for y in (-3.38, -1.12, 1.14):
        _fence_post(f"EastFencePost_{y:+.2f}", 4.52, y, M, root)
    for z in (0.56, 1.18):
        L.box(f"EastFenceRail_{z:.2f}", (0.075, 4.66, 0.075), (4.52, -1.12, z),
              M["yard_oak"], bevel=0.012, parent=root)

    # Grounds rack with three correctly scaled hand tools.
    L.rounded_box("GroundsRackBack", (2.10, 0.20, 1.56), (3.62, 1.72, 0.84),
                  M["yard_green"], corner=0.075, segments=4, bevel=0.010, parent=root)
    for z in (0.42, 0.84, 1.26):
        L.box(f"RackSlat_{z:.2f}", (1.88, 0.08, 0.055), (3.62, 1.585, z),
              M["yard_brass"], bevel=0.010, parent=root)
    _grounds_tool("GroundsRake", 3.10, 1.47, "rake", M, root)
    _grounds_tool("GroundsShovel", 3.62, 1.47, "shovel", M, root)
    _grounds_tool("GroundsBroom", 4.10, 1.47, "broom", M, root)

    # Hose reel and two lidded parts bins bring readable day-to-day utility.
    L.box("HoseReelStand", (0.62, 0.46, 0.76), (3.86, -2.40, 0.43),
          M["yard_green"], bevel=0.035, parent=root)
    L.cyl("HoseReelDrum", 0.31, 0.36, (3.86, -2.64, 0.61), M["yard_charcoal"],
          rot=(math.radians(90), 0, 0), verts=20, bevel=0.012, parent=root)
    L.torus("HoseCoil", 0.235, 0.035, (3.86, -2.84, 0.61), M["yard_sage"],
            rot=(math.radians(90), 0, 0), parent=root, mj=24, mn=8)
    L.box("HoseCrank", (0.28, 0.035, 0.035), (4.07, -2.86, 0.72),
          M["yard_brass"], rot=(0, math.radians(25), 0), bevel=0.006, parent=root)
    for index, x in enumerate((1.28, 2.06)):
        L.rounded_box(f"PartsBin_{index + 1}", (0.62, 0.72, 0.62), (x, 3.20, 0.39),
                      M["yard_sage"], corner=0.08, segments=4, bevel=0.008, parent=root)
        L.box(f"PartsBinLid_{index + 1}", (0.68, 0.76, 0.08), (x, 3.20, 0.73),
              M["yard_green"], bevel=0.028, parent=root)

    # Small branded service marker at the outer front corner. Extruded lettering
    # remains legible without introducing a one-off texture resource.
    for x in (1.16, 2.54):
        L.box(f"GroundsSignPost_{x:+.2f}", (0.09, 0.09, 1.05), (x, -3.26, 0.56),
              M["yard_green"], bevel=0.014, parent=root)
    L.rounded_box("GroundsSignBoard", (1.62, 0.10, 0.52), (1.85, -3.26, 0.99),
                  M["yard_green"], corner=0.075, segments=4, bevel=0.008, parent=root)
    for z in (0.765, 1.215):
        L.box(f"GroundsSignBorderH_{z:.3f}", (1.46, 0.045, 0.025), (1.85, -3.325, z),
              M["yard_brass"], bevel=0.004, parent=root)
    for x in (1.14, 2.56):
        L.box(f"GroundsSignBorderV_{x:+.2f}", (0.025, 0.045, 0.45), (x, -3.325, 0.99),
              M["yard_brass"], bevel=0.004, parent=root)
    L.sign_text("GroundsSignText", "GROUNDS", 1.85, 1.00, 0.21, M, root,
                y=-3.325, depth=0.008)

    # Runtime-addressable placement sockets.
    L.empty("SOCKET_TractorBay", (-2.00, -0.80, 0.10), parent=root,
            props={"socket": "vehicle", "heading_degrees": 0})
    L.empty("SOCKET_ServiceBay", (0.85, -0.80, 0.10), parent=root,
            props={"socket": "service", "heading_degrees": 0})

    _collision("COL_BackFence", (4.78, 0.22, 1.55), (-2.26, 3.78, 0.775),
               M["yard_charcoal"], root)
    _collision("COL_EastFence", (0.22, 4.78, 1.55), (4.52, -1.12, 0.775),
               M["yard_charcoal"], root)
    _collision("COL_GroundsRack", (2.18, 0.72, 1.62), (3.62, 1.60, 0.81),
               M["yard_charcoal"], root)
    _collision("COL_GroundsSign", (1.72, 0.32, 1.30), (1.85, -3.26, 0.65),
               M["yard_charcoal"], root)
    return root


def build_golfer_iron(M):
    root = L.asset_root("golfer_iron", (0.16, 0.07, 1.04))
    root["source"] = "Original Golf Flipper production asset"
    root["license"] = "Project-owned"
    root["real_world_length_m"] = 1.04
    # `pivot` is reserved by Three's GLTFLoader and must be a numeric vector;
    # use a descriptive extras key so a human-readable string cannot be parsed
    # as an Object3D translation.
    root["pivot_role"] = "Top-hand grip at local origin"

    # Geometry extends down -Z from the exact grip pivot. The exported root can
    # therefore be parented to either articulated hand without compensating for
    # a floor-origin convention.
    L.cyl("Grip", 0.0155, 0.245, (0, 0, -0.1225), M["iron_grip"], verts=16,
          bevel=0.003, parent=root)
    for z in (-0.035, -0.085, -0.135, -0.185):
        L.torus(f"GripRing_{abs(z):.3f}", 0.0158, 0.0018, (0, 0, z),
                M["iron_brass"], parent=root, mj=16, mn=5)
    L.cyl("Shaft", 0.0058, 0.765, (0, 0, -0.6275), M["iron_steel"], verts=12,
          bevel=0.001, parent=root)
    L.cyl("Ferrule", 0.011, 0.052, (0, 0, -1.004), M["iron_grip"], verts=14,
          bevel=0.002, parent=root)
    L.rounded_box("IronHead", (0.142, 0.052, 0.066), (0.046, 0, -1.035),
                  M["iron_steel"], corner=0.018, segments=5, bevel=0.004, parent=root,
                  rot=(0, math.radians(-10), math.radians(-5)))
    L.box("IronFace", (0.116, 0.009, 0.049), (0.055, -0.031, -1.035),
          M["iron_face"], rot=(0, math.radians(-10), math.radians(-5)),
          bevel=0.006, parent=root)
    for index in range(5):
        L.box(f"FaceGroove_{index + 1}", (0.094, 0.003, 0.0018),
              (0.055, -0.036, -1.055 + index * 0.009), M["iron_brass"],
              rot=(0, math.radians(-10), math.radians(-5)), bevel=0, parent=root)
    L.empty("SOCKET_Grip", (0, 0, 0), parent=root,
            props={"socket": "character_grip", "axis": "shaft extends -Z"})
    L.empty("SOCKET_ClubFace", (0.055, -0.036, -1.035), parent=root,
            props={"socket": "impact_face"})
    return root


BUILDERS = {
    "maintenance_yard_dressing": build_maintenance_yard,
    "golfer_iron": build_golfer_iron,
}


def _triangles(root):
    return sum(
        sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons)
        for obj in L.descendants(root)
        if obj.type == "MESH" and not obj.get("collision_proxy")
    )


def main():
    requested = [arg for arg in ARGV if arg in BUILDERS]
    do_render = "render" in ARGV
    for asset_id in (requested or list(BUILDERS)):
        L.reset_scene()
        M = {**L.materials(), **world_mats()}
        root = BUILDERS[asset_id](M)
        L.join_static(root)
        triangles = _triangles(root)
        mins, maxs = L._world_bounds(root)
        path = L.save_and_export(asset_id, root, subdir="world")
        print(
            f"STATS|{asset_id}|tris={triangles}|"
            f"bounds={tuple(round(v, 4) for v in mins)}..{tuple(round(v, 4) for v in maxs)}|"
            f"glb={path}"
        )
        if do_render:
            # The iron deliberately hangs below its grip-origin. Raise only the
            # post-export preview instance so lib_props' generic floor does not
            # hide the negative-Z shaft; the saved BLEND and GLB keep the exact
            # wrist pivot authored above.
            if asset_id == "golfer_iron":
                root.location.z = 1.09
                bpy.context.view_layer.update()
            L.render_preview(asset_id, root, azimuth=42, elevation=29)
        print(f"COMPLETE|{asset_id}")


main()
