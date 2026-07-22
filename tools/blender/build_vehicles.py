"""Production vehicle kit for Golf Flipper.

Builds original, project-owned grounds tractor, fleet golf-cart, and cart-care
station GLBs with runtime-addressable hierarchy, collision proxies, and explicit
near/far LOD groups.

Run all assets (the authored hierarchy is always preserved):
  "<blender>" --background --factory-startup --python tools/blender/build_vehicles.py

Add ``-- render`` to also refresh the studio previews.

Run a subset by adding its id after the flags:
  ... -- nojoin render fleet_golf_cart

Convention: metres, Z up, -Y forward, origin centred on the wheelbase.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import lib_props as L

L.EXPORT_DIR = L.ROOT / "vendor" / "models" / "vehicles"
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def vehicle_mats(M):
    """ restrained clubhouse palette, tuned for stylized outdoor PBR """
    M.update({
        "vehicle_green": L.mat("M_VehicleDeepGreen", (0.040, 0.145, 0.080), roughness=0.42, metallic=0.18),
        "vehicle_sage": L.mat("M_VehicleSage", (0.285, 0.390, 0.270), roughness=0.58),
        "vehicle_cream": L.mat("M_VehicleWarmCream", (0.790, 0.720, 0.580), roughness=0.54),
        "vehicle_charcoal": L.mat("M_VehicleWarmCharcoal", (0.055, 0.052, 0.046), roughness=0.62, metallic=0.26),
        "vehicle_glass": L.mat("M_VehicleGlass", (0.310, 0.470, 0.485), roughness=0.09, metallic=0.04, alpha=0.28),
        "vehicle_red": L.mat("M_VehicleTailRed", (0.620, 0.040, 0.025), roughness=0.25),
        "vehicle_light": L.mat("M_VehicleLamp", (1.000, 0.760, 0.340), roughness=0.18),
        "vehicle_rust": L.mat("M_VehicleRust", (0.270, 0.105, 0.030), roughness=0.96),
    })
    # Lamp emission survives glTF and is intensity-controlled by the runtime.
    lamp = M["vehicle_light"].node_tree.nodes.get("Principled BSDF")
    try:
        lamp.inputs["Emission Color"].default_value = (1.0, 0.58, 0.16, 1.0)
        lamp.inputs["Emission Strength"].default_value = 0.18
    except Exception:
        pass
    return M


def _mark_movable(obj, kind):
    obj["movable"] = kind
    return obj


def _join_meshes(objects, target_name):
    """Batch one static subassembly while retaining its operational parent pivot."""
    objects = [obj for obj in objects if obj and obj.type == "MESH"]
    if not objects:
        return None
    if len(objects) == 1:
        objects[0].name = target_name
        objects[0].data.name = target_name
        return objects[0]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    target = objects[0]
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()
    target.name = target_name
    target.data.name = target_name
    return target


def _batch_vehicle(root):
    """One draw-friendly mesh per static LOD and per independently moving assembly.

    Lamp lenses remain named meshes because the runtime changes their emission.
    Pivots, sockets, and collision proxies remain separate objects.
    """
    near = next((obj for obj in root.children if obj.name == "LOD0_Detail"), None)
    far = next((obj for obj in root.children if obj.name == "LOD1_Silhouette"), None)
    if near:
        _join_meshes([
            obj for obj in near.children
            if obj.type == "MESH" and not obj.name.startswith("LIGHT_")
        ], "LOD0_StaticBody")
        for pivot in [obj for obj in near.children if obj.type == "EMPTY"]:
            meshes = [obj for obj in pivot.children if obj.type == "MESH"]
            if pivot.name.startswith("PIVOT_Wheel_"):
                _join_meshes(meshes, pivot.name.replace("PIVOT_", ""))
            elif pivot.name == "PIVOT_SteeringWheel":
                _join_meshes(meshes, "SteeringWheel")
            elif pivot.name == "PIVOT_MowerDeck":
                _join_meshes(meshes, "MowerDeck")
            # Front wheels are nested one level below their steering pivots.
            for nested in [obj for obj in pivot.children if obj.type == "EMPTY"]:
                if nested.name.startswith("PIVOT_Wheel_"):
                    _join_meshes([obj for obj in nested.children if obj.type == "MESH"],
                                 nested.name.replace("PIVOT_", ""))
    if far:
        _join_meshes([obj for obj in far.children if obj.type == "MESH"], "LOD1_StaticBody")
    return root


def _wheel(name, loc, radius, width, M, parent, *, steer=False):
    """Wheel hierarchy: optional steering yaw pivot -> rolling axle pivot -> meshes."""
    outer = parent
    if steer:
        outer = _mark_movable(L.empty(f"PIVOT_Steer_{name}", loc, parent=parent), "steer")
    axle = _mark_movable(L.empty(f"PIVOT_Wheel_{name}", loc, parent=outer), "wheel")
    L.torus(f"Wheel_{name}_Tyre", radius * 0.72, radius * 0.28, loc, M["rubber"],
            rot=(0, math.radians(90), 0), parent=axle, mj=20, mn=8)
    L.cyl(f"Wheel_{name}_Hub", radius * 0.36, width + 0.018, loc, M["brass_dk"],
          rot=(0, math.radians(90), 0), verts=16, parent=axle)
    L.cyl(f"Wheel_{name}_Cap", radius * 0.14, width + 0.026, loc, M["brass"],
          rot=(0, math.radians(90), 0), verts=14, parent=axle)
    return axle


def _steering_wheel(loc, radius, M, parent):
    pivot = _mark_movable(L.empty("PIVOT_SteeringWheel", loc, parent=parent), "steering_wheel")
    L.torus("SteeringWheel_Rim", radius, 0.020, loc, M["vehicle_charcoal"],
            rot=(math.radians(68), 0, 0), parent=pivot, mj=20, mn=7)
    L.cyl("SteeringWheel_Hub", 0.036, 0.12, (loc[0], loc[1] + 0.045, loc[2] - 0.09),
          M["brass_dk"], rot=(math.radians(68), 0, 0), verts=14, parent=pivot)
    for angle in (0, 2.094, 4.188):
        dx = math.cos(angle) * radius * 0.48
        dz = math.sin(angle) * radius * 0.48
        L.box(f"SteeringWheel_Spoke_{angle:.2f}", (0.025, 0.020, radius * 0.86),
              (loc[0] + dx * 0.48, loc[1], loc[2] + dz * 0.48), M["vehicle_charcoal"],
              rot=(0, angle + math.pi / 2, math.radians(22)), bevel=0.006, parent=pivot)
    return pivot


def _lamp(name, loc, dims, M, parent, *, tail=False):
    # Recess the dark backing plate behind the lens surface. Keeping the two
    # coplanar (or putting the backing a few millimetres forward) makes the
    # opaque housing occlude the emissive lens from the player camera.
    housing_offset = -(dims[1] * 0.5 + 0.012) if tail else (dims[1] * 0.5 + 0.012)
    shell = L.box(f"{name}_Housing", (dims[0] + 0.025, dims[1] + 0.025, dims[2] + 0.025),
                  (loc[0], loc[1] + housing_offset, loc[2]),
                  M["vehicle_charcoal"], bevel=0.018, parent=parent)
    lens_mat = M["vehicle_red"] if tail else M["vehicle_light"]
    lens = L.rounded_box(name, dims, loc, lens_mat, corner=min(dims[0], dims[2]) * 0.22,
                         segments=3, bevel=0.003, parent=parent)
    lens["vehicle_light"] = "tail" if tail else "head"
    shell["vehicle_light_housing"] = True
    return lens


def _tractor_body(root, M, *, broken=False):
    near = L.empty("LOD0_Detail", parent=root, props={"lod": 0})
    far = L.empty("LOD1_Silhouette", parent=root, props={"lod": 1})

    # Frame, counterweight, rear axle and hood form a readable compact utility silhouette.
    L.box("Frame", (1.22, 2.58, 0.20), (0, 0.05, 0.57), M["vehicle_charcoal"], bevel=0.045, parent=near)
    L.rounded_box("Hood", (1.20, 1.25, 0.68), (0, -0.88, 1.10),
                  M["vehicle_green"], corner=0.15, segments=5, bevel=0.018, parent=near)
    L.rounded_box("Nose", (1.15, 0.18, 0.58), (0, -1.52, 1.05),
                  M["vehicle_charcoal"], corner=0.10, segments=4, parent=near)
    for x in (-0.36, -0.18, 0, 0.18, 0.36):
        L.box(f"GrilleSlat_{x:+.2f}", (0.045, 0.022, 0.37), (x, -1.622, 1.04),
              M["brass_dk"], bevel=0.007, parent=near)
    L.box("RearCounterweight", (1.28, 0.40, 0.42), (0, 1.34, 0.64),
          M["vehicle_sage"], bevel=0.10, parent=near)
    L.box("OperatorDeck", (1.36, 0.92, 0.12), (0, 0.48, 0.91),
          M["vehicle_charcoal"], bevel=0.028, parent=near)

    # Sculpted fenders, seat and roll-over structure.
    for sx in (-1, 1):
        L.rounded_box(f"RearFender_{'L' if sx < 0 else 'R'}", (0.30, 1.12, 0.18),
                      (sx * 0.69, 0.60, 1.18), M["vehicle_green"], corner=0.08,
                      segments=4, bevel=0.012, parent=near)
        L.box(f"Step_{'L' if sx < 0 else 'R'}", (0.26, 0.44, 0.07),
              (sx * 0.72, -0.12, 0.69), M["brass_dk"], bevel=0.020, parent=near)
        for yy in (-0.25, -0.08, 0.09):
            L.box(f"StepGrip_{sx}_{yy:+.2f}", (0.20, 0.022, 0.010),
                  (sx * 0.72, yy, 0.735), M["brass"], bevel=0.003, parent=near)

    L.rounded_box("SeatBase", (0.78, 0.62, 0.20), (0, 0.48, 1.19),
                  M["vehicle_cream"], corner=0.12, segments=5, parent=near)
    L.rounded_box("SeatBack", (0.78, 0.18, 0.65), (0, 0.78, 1.53),
                  M["vehicle_cream"], corner=0.11, segments=5, parent=near,
                  rot=(math.radians(-7), 0, 0))
    for sx in (-1, 1):
        L.box(f"ROPS_Post_{sx}", (0.085, 0.085, 1.42), (sx * 0.51, 0.82, 1.53),
              M["vehicle_charcoal"], bevel=0.018, parent=near)
    L.box("ROPS_Top", (1.10, 0.10, 0.09), (0, 0.82, 2.23),
          M["vehicle_charcoal"], bevel=0.020, parent=near)
    L.rounded_box("Canopy", (1.60, 1.46, 0.10), (0, 0.38, 2.28),
                  M["vehicle_cream"], corner=0.16, segments=5, bevel=0.010, parent=near)

    # Controls and service detail stay broad enough to read from the player camera.
    L.rounded_box("Dash", (0.78, 0.34, 0.32), (0, -0.10, 1.48),
                  M["vehicle_charcoal"], corner=0.07, segments=4, parent=near,
                  rot=(math.radians(-12), 0, 0))
    _steering_wheel((0, -0.02, 1.71), 0.23, M, near)
    L.cyl("Exhaust", 0.052, 0.95, (0.42, -0.90, 1.75), M["vehicle_charcoal"],
          verts=14, parent=near)
    L.cyl("ExhaustCap", 0.075, 0.035, (0.42, -0.90, 2.24), M["brass_dk"],
          verts=14, parent=near)
    L.box("PinehollowBadge", (0.36, 0.018, 0.12), (0, -1.625, 1.37),
          M["brass"], bevel=0.025, parent=near)
    for sx in (-1, 1):
        _lamp(f"LIGHT_Head_{'L' if sx < 0 else 'R'}", (sx * 0.38, -1.635, 1.20),
              (0.22, 0.035, 0.16), M, near)
        _lamp(f"LIGHT_Tail_{'L' if sx < 0 else 'R'}", (sx * 0.47, 1.555, 0.86),
              (0.15, 0.035, 0.11), M, near, tail=True)

    # Wheels are separate and carry exact runtime pivots.
    _wheel("FL", (-0.70, -1.08, 0.48), 0.46, 0.22, M, near, steer=True)
    _wheel("FR", (0.70, -1.08, 0.48), 0.46, 0.22, M, near, steer=True)
    _wheel("RL", (-0.79, 0.76, 0.62), 0.60, 0.27, M, near)
    _wheel("RR", (0.79, 0.76, 0.62), 0.60, 0.27, M, near)

    hitch = _mark_movable(L.empty("PIVOT_MowerDeck", (0, 1.62, 0.34), parent=near), "implement")
    if not broken:
        L.rounded_box("MowerDeck", (1.72, 0.78, 0.18), (0, 1.91, 0.22),
                      M["vehicle_sage"], corner=0.17, segments=5, bevel=0.012, parent=hitch)
        for sx in (-1, 1):
            L.cyl(f"MowerSpindle_{sx}", 0.17, 0.08, (sx * 0.45, 1.91, 0.33),
                  M["brass_dk"], verts=16, parent=hitch)
        L.box("MowerHitch", (0.12, 0.72, 0.10), (0, 1.43, 0.43),
              M["vehicle_charcoal"], rot=(math.radians(-11), 0, 0), bevel=0.018, parent=hitch)
        L.box("MowerSafetyBar", (1.55, 0.08, 0.10), (0, 2.27, 0.25),
              M["vehicle_charcoal"], bevel=0.025, parent=hitch)
        L.rounded_box("MowerDischargeChute", (0.42, 0.52, 0.09), (0.93, 2.02, 0.20),
                      M["brass_dk"], corner=0.08, segments=4, bevel=0.008,
                      rot=(0, 0, math.radians(-7)), parent=hitch)

    # Lightweight silhouette remains a separate runtime-controlled LOD.
    L.rounded_box("LOD1_TractorBody", (1.30, 2.70, 0.70), (0, -0.05, 0.96),
                  M["vehicle_green"], corner=0.18, segments=3, bevel=0.02, parent=far)
    L.box("LOD1_TractorCanopy", (1.55, 1.35, 0.12), (0, 0.38, 2.25),
          M["vehicle_cream"], bevel=0.06, parent=far)
    for sx in (-1, 1):
        L.cyl(f"LOD1_WheelFront_{sx}", 0.43, 0.20, (sx * 0.70, -1.05, 0.46),
              M["rubber"], rot=(0, math.radians(90), 0), verts=10, parent=far)
        L.cyl(f"LOD1_WheelRear_{sx}", 0.58, 0.24, (sx * 0.78, 0.75, 0.60),
              M["rubber"], rot=(0, math.radians(90), 0), verts=10, parent=far)

    # Gameplay sockets and simplified collision are exported as named extras.
    L.empty("SOCKET_Seat", (0, 0.42, 1.48), parent=root, props={"socket": "driver"})
    L.empty("SOCKET_Storage", (0, 1.27, 0.90), parent=root, props={"socket": "storage", "capacity": 2})
    L.empty("SOCKET_Hitch", (0, 1.63, 0.43), parent=root, props={"socket": "implement"})
    L.collision_box("COL_Chassis", (1.52, 2.88, 1.18), (0, 0.0, 0.63), M, parent=root)
    L.collision_box("COL_Canopy", (1.56, 1.35, 1.10), (0, 0.38, 1.74), M, parent=root)

    if broken:
        # Deliberate, readable neglect without copying the old external mesh.
        L.box("Broken_ServicePanel", (0.78, 0.06, 0.38), (-0.15, -0.85, 1.10),
              M["vehicle_rust"], rot=(math.radians(8), math.radians(-15), math.radians(9)),
              bevel=0.025, parent=near)
        L.torus("Broken_DriveBelt", 0.18, 0.018, (0.46, 0.70, 0.82), M["vehicle_rust"],
                rot=(0, math.radians(90), 0), parent=near, mj=16, mn=6)
    return _batch_vehicle(root)


def build_grounds_tractor(M):
    vehicle_mats(M)
    root = L.asset_root("grounds_tractor", (1.82, 3.72, 2.33))
    root["vehicle_type"] = "tractor"
    root["wheel_radius_m"] = 0.54
    return _tractor_body(root, M, broken=False)


def build_grounds_tractor_broken(M):
    vehicle_mats(M)
    root = L.asset_root("grounds_tractor_broken", (1.82, 3.30, 2.33))
    root["vehicle_type"] = "tractor_broken"
    root["wheel_radius_m"] = 0.54
    return _tractor_body(root, M, broken=True)


def build_fleet_golf_cart(M):
    vehicle_mats(M)
    root = L.asset_root("fleet_golf_cart", (1.24, 2.55, 1.82))
    root["vehicle_type"] = "golf_cart"
    root["wheel_radius_m"] = 0.265
    near = L.empty("LOD0_Detail", parent=root, props={"lod": 0})
    far = L.empty("LOD1_Silhouette", parent=root, props={"lod": 1})

    L.box("Chassis", (1.08, 2.24, 0.16), (0, 0.02, 0.38),
          M["vehicle_charcoal"], bevel=0.045, parent=near)
    L.rounded_box("FrontCowl", (1.10, 0.78, 0.48), (0, -0.78, 0.68),
                  M["vehicle_green"], corner=0.16, segments=5, bevel=0.018, parent=near)
    L.rounded_box("SideBody", (1.12, 1.34, 0.34), (0, 0.20, 0.63),
                  M["vehicle_sage"], corner=0.13, segments=5, bevel=0.014, parent=near)
    L.box("FloorMat", (0.86, 0.84, 0.045), (0, -0.04, 0.82),
          M["rubber"], bevel=0.012, parent=near)
    L.rounded_box("SeatBase", (1.00, 0.57, 0.18), (0, 0.30, 0.99),
                  M["vehicle_cream"], corner=0.12, segments=5, parent=near)
    L.rounded_box("SeatBack", (1.00, 0.16, 0.54), (0, 0.55, 1.26),
                  M["vehicle_cream"], corner=0.11, segments=5, parent=near,
                  rot=(math.radians(-5), 0, 0))
    L.rounded_box("RearStorageBed", (1.03, 0.74, 0.22), (0, 0.92, 0.87),
                  M["vehicle_charcoal"], corner=0.09, segments=4, parent=near)
    L.wood_slab("StorageBedInsert", (0.88, 0.58, 0.045), (0, 0.91, 1.00),
                M["oak"], parent=near, bevel=0.014, grain="x")
    L.box("StorageBedLip", (0.92, 0.055, 0.09), (0, 1.255, 1.01),
          M["brass_dk"], bevel=0.018, parent=near)
    for sx in (-1, 1):
        L.box(f"BagRail_{sx}", (0.045, 0.62, 0.65), (sx * 0.48, 0.96, 1.19),
              M["brass_dk"], bevel=0.014, parent=near)
        L.box(f"RoofPostFront_{sx}", (0.046, 0.046, 1.06), (sx * 0.48, -0.48, 1.30),
              M["vehicle_charcoal"], bevel=0.014, parent=near)
        L.box(f"RoofPostRear_{sx}", (0.046, 0.046, 1.06), (sx * 0.48, 0.52, 1.30),
              M["vehicle_charcoal"], bevel=0.014, parent=near)
    L.rounded_box("Canopy", (1.24, 1.80, 0.095), (0, 0.02, 1.80),
                  M["vehicle_cream"], corner=0.17, segments=5, bevel=0.012, parent=near)
    L.rounded_box("Windshield", (1.00, 0.035, 0.63), (0, -0.47, 1.42),
                  M["vehicle_glass"], corner=0.07, segments=4, bevel=0.005, parent=near,
                  rot=(math.radians(-9), 0, 0))
    L.rounded_box("Dash", (0.96, 0.28, 0.25), (0, -0.43, 1.08),
                  M["vehicle_charcoal"], corner=0.06, segments=4, parent=near,
                  rot=(math.radians(-10), 0, 0))
    _steering_wheel((-0.27, -0.34, 1.27), 0.18, M, near)
    L.box("FleetBadge", (0.35, 0.018, 0.12), (0, -1.18, 0.73),
          M["brass"], bevel=0.025, parent=near)

    for sx in (-1, 1):
        _lamp(f"LIGHT_Head_{'L' if sx < 0 else 'R'}", (sx * 0.34, -1.185, 0.72),
              (0.20, 0.035, 0.13), M, near)
        _lamp(f"LIGHT_Tail_{'L' if sx < 0 else 'R'}", (sx * 0.36, 1.145, 0.66),
              (0.14, 0.035, 0.10), M, near, tail=True)
    _wheel("FL", (-0.54, -0.74, 0.29), 0.27, 0.16, M, near, steer=True)
    _wheel("FR", (0.54, -0.74, 0.29), 0.27, 0.16, M, near, steer=True)
    _wheel("RL", (-0.54, 0.73, 0.29), 0.27, 0.16, M, near)
    _wheel("RR", (0.54, 0.73, 0.29), 0.27, 0.16, M, near)

    L.rounded_box("LOD1_CartBody", (1.10, 2.15, 0.47), (0, 0.00, 0.64),
                  M["vehicle_green"], corner=0.15, segments=3, bevel=0.02, parent=far)
    L.box("LOD1_CartRoof", (1.22, 1.78, 0.10), (0, 0.02, 1.79),
          M["vehicle_cream"], bevel=0.06, parent=far)
    for sx in (-1, 1):
        for yy in (-0.73, 0.72):
            L.cyl(f"LOD1_Wheel_{sx}_{yy:+.2f}", 0.255, 0.15, (sx * 0.53, yy, 0.28),
                  M["rubber"], rot=(0, math.radians(90), 0), verts=10, parent=far)

    L.empty("SOCKET_Seat", (-0.18, 0.22, 1.22), parent=root, props={"socket": "driver"})
    L.empty("SOCKET_Passenger", (0.24, 0.22, 1.22), parent=root, props={"socket": "passenger"})
    L.empty("SOCKET_Storage", (0, 0.91, 1.05), parent=root, props={"socket": "storage", "capacity": 4})
    L.empty("SOCKET_Key", (-0.14, -0.48, 1.09), parent=root, props={"socket": "key"})
    L.collision_box("COL_Chassis", (1.20, 2.38, 1.02), (0, 0, 0.57), M, parent=root)
    L.collision_box("COL_Canopy", (1.22, 1.78, 0.77), (0, 0.02, 1.42), M, parent=root)
    return _batch_vehicle(root)


def build_cart_fleet_station(M):
    """Two-point charging bank plus the starter fleet service locker."""
    M = vehicle_mats(M)
    root = L.asset_root("cart_fleet_station", (2.48, 0.62, 1.52))
    root["fixture_type"] = "cart_fleet_charging_and_service"
    root["charging_points"] = 2
    root["service_bays"] = 1
    near = L.empty("LOD0_Detail", parent=root, props={"lod": 0})
    far = L.empty("LOD1_Silhouette", parent=root, props={"lod": 1})

    L.rounded_box("StationPlinth", (2.48, 0.62, 0.12), (0, 0, 0.06),
                  M["vehicle_charcoal"], corner=0.07, segments=4, bevel=0.012, parent=near)
    L.rounded_box("ServiceLocker", (0.76, 0.48, 1.34), (0.82, 0.03, 0.74),
                  M["vehicle_green"], corner=0.08, segments=5, bevel=0.014, parent=near)
    L.box("ServiceLockerDoor", (0.62, 0.035, 1.08), (0.82, -0.225, 0.76),
          M["vehicle_sage"], bevel=0.025, parent=near)
    for z in (0.42, 0.72, 1.02):
        L.box(f"LockerVent_{z:.2f}", (0.42, 0.025, 0.025), (0.82, -0.25, z),
              M["vehicle_charcoal"], bevel=0.008, parent=near)
    L.box("LockerHandle", (0.035, 0.045, 0.22), (1.06, -0.27, 0.76),
          M["brass"], bevel=0.012, parent=near)

    for index, x in enumerate((-0.72, 0.02), start=1):
        L.rounded_box(f"Charger_{index}", (0.52, 0.42, 1.22), (x, 0.02, 0.68),
                      M["vehicle_green"], corner=0.09, segments=5, bevel=0.014, parent=near)
        L.rounded_box(f"ChargerDisplay_{index}", (0.31, 0.028, 0.22), (x, -0.215, 0.93),
                      M["vehicle_glass"], corner=0.045, segments=5, bevel=0.006, parent=near)
        L.box(f"ChargeReadyLamp_{index}", (0.12, 0.022, 0.045), (x, -0.238, 0.78),
              M["vehicle_light"], bevel=0.018, parent=near,
              props={"vehicle_light": "charge_ready"})
        L.torus(f"ChargeCableCoil_{index}", 0.145, 0.018, (x, -0.245, 0.48),
                M["vehicle_charcoal"], rot=(math.radians(90), 0, 0), parent=near, mj=18, mn=6)
        L.rounded_box(f"ChargeConnector_{index}", (0.08, 0.055, 0.20), (x + 0.17, -0.255, 0.51),
                      M["vehicle_charcoal"], corner=0.025, segments=4, bevel=0.006, parent=near,
                      rot=(0, 0, math.radians(-12)))
        L.box(f"BrassBand_{index}", (0.38, 0.03, 0.035), (x, -0.23, 1.16),
              M["brass_dk"], bevel=0.012, parent=near)

    L.box("StationHeader", (2.12, 0.16, 0.20), (-0.15, 0.02, 1.42),
          M["vehicle_cream"], bevel=0.055, parent=near)
    L.box("StationHeaderInset", (1.72, 0.035, 0.08), (-0.15, -0.078, 1.42),
          M["brass"], bevel=0.026, parent=near)
    for x in (-1.08, 1.08):
        L.box(f"StationBollard_{'L' if x < 0 else 'R'}", (0.12, 0.12, 0.66), (x, -0.18, 0.39),
              M["vehicle_charcoal"], bevel=0.035, parent=near)

    L.rounded_box("LOD1_Station", (2.44, 0.58, 1.42), (0, 0.02, 0.73),
                  M["vehicle_green"], corner=0.09, segments=3, bevel=0.018, parent=far)
    L.box("LOD1_Header", (2.12, 0.16, 0.20), (-0.15, 0.02, 1.42),
          M["vehicle_cream"], bevel=0.05, parent=far)
    L.collision_box("COL_Station", (2.48, 0.62, 1.52), (0, 0, 0.76), M, parent=root)
    return _batch_vehicle(root)


BUILDERS = {
    "grounds_tractor": build_grounds_tractor,
    "grounds_tractor_broken": build_grounds_tractor_broken,
    "fleet_golf_cart": build_fleet_golf_cart,
    "cart_fleet_station": build_cart_fleet_station,
}


requested = [arg for arg in ARGV if arg in BUILDERS]


def run_vehicle(asset_id, build_fn):
    """Build a vehicle without the generic static-mesh join pass.

    Vehicle lights, LODs, wheels, steering, and implement parts are addressed by
    name at runtime. The generic prop runner's optional join step is therefore
    never valid for this asset family, even when the caller supplies no flags.
    """
    L.reset_scene()
    materials = L.materials()
    root = build_fn(materials)
    L.save_and_export(asset_id, root, subdir="vehicles")
    if "render" in ARGV:
        L.render_preview(asset_id, root)
    print(f"COMPLETE|{asset_id}")


for asset_id in (requested or list(BUILDERS)):
    run_vehicle(asset_id, BUILDERS[asset_id])
