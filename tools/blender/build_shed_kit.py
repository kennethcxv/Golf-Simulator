"""Build the maintenance shed's own prop kit for the Stage-1 shed scene.

These five props replace the Phase-3 placeholder furniture seams in
``src/render3d/clubhouse/shedInterior.js``: a wall tool rack, a pair of floor
parks, a window casing, a door frame, and a cluster of small clutter.

They are NOT Sheet 51-100 assets — they carry no reference-sheet number — so they
cannot use :func:`assets_51_100_lib.asset_root` (which requires an AssetIdentity in
the 51-100 range). Instead each part gets a local ``A_SHED_<PART>_ROOT`` empty and
ships through a small export wrapper that reuses the library's validator, saver,
exporter and studio-preview but drops the sheet-based path scheme. Everything else
— metres, +Z up, -Y front, the palette, collision proxies, the socket/mesh naming
contract — is exactly the Sheet 8 pipeline, so the same clean-reimport check applies.

Runtime GLBs land in ``vendor/models/shed/`` (committed like the sheet_08 GLBs);
canonical copies in ``Assets/shed/glb/``; sources in
``asset_sources/blender/shed/``.

    blender --background --factory-startup --python tools/blender/build_shed_kit.py -- --part all
    blender --background --factory-startup --python tools/blender/build_shed_kit.py -- --part wallrack --preview
    blender --background --factory-startup --python tools/blender/build_shed_kit.py -- --verify
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections.abc import Sequence
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import assets_51_100_lib as A

RUNTIME_DIR = A.REPO_ROOT / "vendor" / "models" / "shed"
CANONICAL_DIR = A.REPO_ROOT / "Assets" / "shed" / "glb"
SOURCE_DIR = A.REPO_ROOT / "asset_sources" / "blender" / "shed"
PREVIEW_DIR = A.REPO_ROOT / "qa" / "shed_stage1" / "kit_previews"

# The shed's south/east openings are both 1.6 x 1.2 m (sill 1.0), and the doorway is
# 1.35 m clear — mirrored from src/data/shedLayout.js (WINDOWS / DOOR) so the authored
# casings and frame drop straight onto the shell openings.
WINDOW_W, WINDOW_H = 1.6, 1.2
DOOR_CLEAR_W, DOOR_H = 1.35, 2.15

# The seven tools that hang on the rack, in mount order, plus the world footprints the
# park pads sit under. The floor-park drum/washer footprints are the world GLB bounds
# (asset 71 drum ~0.5 m, asset 78 washer ~0.65 x 0.8 m).
RACK_TOOLS = ("mop", "broom", "dustpan", "spray", "cloth", "sponge", "trashroll")

# mount -> "floor" enables the below-floor sanity check; walls/openings hang or frame an
# opening and legitimately cross their own origin, so they opt out (same rule the sheet
# viewmodels use).
PART_MOUNT = {
    "wallrack": "wall", "window": "wall", "door": "opening",
    "parks": "floor", "clutter": "floor",
}
REQUIRE_COLLISION = {
    "wallrack": True, "window": True, "door": False, "parks": False, "clutter": True,
}
BUDGETS = {"wallrack": 6000, "parks": 600, "window": 1200, "door": 800, "clutter": 4000}


def _mats() -> dict:
    p = A.palette_materials()
    return {
        "walnut": p["medium_walnut"],
        "oak": p["natural_oak"],
        "charcoal": p["warm_charcoal"],
        "brass": p["restrained_brass"],
        "steel": p["brushed_steel"],
        "green": p["deep_green"],
        "sage": p["muted_sage"],
        "yellow": p["safety_yellow"],
        "cream": p["warm_cream"],
        "glass": p["glass"],
        "black": A.material("SHED_MatteBlack", (0.016, 0.017, 0.018, 1.0), roughness=0.7),
        "rag_green": A.material("SHED_RagGreen", A.hex_to_linear_rgba("6E7C5A"), roughness=0.95),
        "rope": A.material("SHED_Rope", A.hex_to_linear_rgba("A98A5B"), roughness=0.92),
        "paint_can": A.material("SHED_PaintCan", A.hex_to_linear_rgba("9AA0A2"), roughness=0.4,
                                metallic=0.5),
        "paint_drip": A.material("SHED_PaintDrip", A.hex_to_linear_rgba("B7413A"), roughness=0.5),
        "solvent": A.material("SHED_Solvent", A.hex_to_linear_rgba("2B4A38"), roughness=0.35),
    }


def _root(part: str, dims: Sequence[float]) -> bpy.types.Object:
    """A shed-kit root empty mirroring asset_root's contract without the 51-100 identity."""

    name = f"A_SHED_{part.upper()}_ROOT"
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.20
    obj["asset_kit"] = "shed_stage1"
    obj["kit_part"] = part
    obj["units"] = "meters"
    obj["up_axis"] = "+Z"
    obj["front_axis"] = A.FRONT_AXIS
    obj["runtime_unit_conversion"] = "meters_to_yards_once:1.0936133"
    obj["visual_style"] = "Pinehollow shed service kit; walnut, charcoal, brass, safety yellow"
    obj["license"] = "Project-owned"
    obj["source_lineage"] = "original deterministic Blender Python"
    obj["mount"] = PART_MOUNT[part]
    obj["target_dimensions_m"] = json.dumps([float(v) for v in dims])
    return obj


def _grp(name: str, parent: bpy.types.Object) -> bpy.types.Object:
    obj = bpy.data.objects.new("LOD0_" + name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.05
    A.parent_keep_world(obj, parent)
    return obj


def _socket(name, parent, location, rotation=(0.0, 0.0, 0.0), **props):
    return A.socket(name, location=location, rotation=rotation, parent=parent, properties=props)


# A socket whose local -Z points at world +Z, so a tool hung on it drops downward.
UP = (math.pi, 0.0, 0.0)
DOWN = (0.0, 0.0, 0.0)


def _join(objects, name: str, parent: bpy.types.Object | None = None) -> bpy.types.Object:
    """Collapse finished detail meshes into one, preserving UVs and material slots.

    The shed shell probe caps the visible interior mesh count, and a kit prop authored as
    twenty small boxes is twenty draw calls for one silhouette, so each prop is joined down
    to a handful of meshes after the fact — exactly as the Sheet 8 builder does for bristles.
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


# ---------------------------------------------------------------------------
# Part builders


def build_wallrack() -> tuple[bpy.types.Object, tuple, tuple]:
    """Walnut pegboard panel + charcoal rail, seven brass hooks, two spring clips, and a
    deep-green painted 'shadow board' silhouette behind each slot."""

    dims = (1.62, 0.10, 0.92)
    root = _root("wallrack", dims)
    m = _mats()
    panel_w, panel_h = 1.60, 0.86
    body = _grp("RackBody", root)
    # Panel (thin in Y, wide in X, tall in Z). Front face toward -Y (into the room).
    frame = [
        A.box("RackPanel", (panel_w, 0.028, panel_h), (0.0, 0.014, 0.0), m["walnut"],
              parent=body, bevel=0.008),
        A.box("RackRailTop", (panel_w, 0.045, 0.055), (0.0, -0.010, panel_h / 2.0 - 0.030),
              m["charcoal"], parent=body, bevel=0.006),
        A.box("RackRailBottom", (panel_w, 0.045, 0.055), (0.0, -0.010, -panel_h / 2.0 + 0.030),
              m["charcoal"], parent=body, bevel=0.006),
    ]
    slots = len(RACK_TOOLS)
    x0 = -panel_w / 2.0 + 0.14
    step = (panel_w - 0.28) / (slots - 1)
    silhouettes = []
    hooks = []
    for i, tool in enumerate(RACK_TOOLS):
        sx = x0 + i * step
        # Deep-green shadow-board silhouette painted on the panel behind each slot.
        silhouettes.append(
            A.box(f"RackSilhouette_{tool}", (0.075, 0.003, 0.30), (sx, -0.001, -0.02),
                  m["green"], parent=body, bevel=0.001,
                  properties={"shadow_board": tool, "decorative_only": True}))
        # Hook or spring clip: cloth + sponge get sprung clips, the rest get brass hooks.
        if tool in ("cloth", "sponge"):
            hooks.append(A.box(f"RackClip_{tool}", (0.030, 0.055, 0.060), (sx, -0.036, 0.09),
                               m["steel"], parent=body, bevel=0.006))
        else:
            hooks.append(A.cylinder(f"RackHookStem_{tool}", 0.008, 0.075, (sx, -0.040, 0.10),
                                    m["brass"], rotation=(math.pi / 2.0, 0.0, 0.0),
                                    vertices=8, parent=body, bevel=0.002))
            hooks.append(A.cylinder(f"RackHookTip_{tool}", 0.008, 0.028, (sx, -0.070, 0.086),
                                    m["brass"], vertices=8, parent=body, bevel=0.002))
        _socket(f"Mount_{tool}", root, (sx, -0.070, 0.12), rotation=UP,
                hangs_tool=tool, kit_slot=True)
    _join(frame, "RackFrame", body)
    _join(silhouettes, "RackSilhouettes", body)
    _join(hooks, "RackHooks", body)
    A.collision_box("Panel", (panel_w, 0.10, panel_h), (0.0, 0.0, 0.0), parent=root)
    return root, dims, tuple(f"SOCKET_Mount_{t}" for t in RACK_TOOLS)


def build_parks() -> tuple[bpy.types.Object, tuple, tuple]:
    """Two floor pads with safety-yellow corner tape and a painted outline — parking spots
    for the shop vacuum drum and the pressure washer. No collision (walkable)."""

    dims = (1.96, 0.90, 0.01)
    root = _root("parks", dims)
    m = _mats()
    pads = _grp("Parks", root)
    decals = []

    # Flat floor decals: no bevels (they only add tris to a plane the eye reads as paint).
    def pad(name, cx, half_x, half_y):
        decals.append(A.box(f"{name}Pad", (half_x * 2.0, half_y * 2.0, 0.006), (cx, 0.0, 0.003),
                            m["charcoal"], parent=pads, bevel=0.0, uv="cube"))
        # Painted outline: a thin sage rectangle frame just inside the pad edge.
        for sx in (-1.0, 1.0):
            decals.append(A.box(f"{name}OutlineX{'L' if sx < 0 else 'R'}",
                                (0.02, half_y * 1.7, 0.007), (cx + sx * half_x * 0.86, 0.0, 0.004),
                                m["sage"], parent=pads, bevel=0.0, uv="cube"))
        for sy in (-1.0, 1.0):
            decals.append(A.box(f"{name}OutlineY{'B' if sy < 0 else 'F'}",
                                (half_x * 1.7, 0.02, 0.007), (cx, sy * half_y * 0.86, 0.004),
                                m["sage"], parent=pads, bevel=0.0, uv="cube"))
        # Safety-yellow corner tape.
        for sx in (-1.0, 1.0):
            for sy in (-1.0, 1.0):
                decals.append(A.box(f"{name}Tape{'L' if sx < 0 else 'R'}{'B' if sy < 0 else 'F'}",
                                    (0.11, 0.11, 0.008),
                                    (cx + sx * half_x * 0.82, sy * half_y * 0.82, 0.004),
                                    m["yellow"], parent=pads, bevel=0.0, uv="cube"))

    pad("Vacuum", -0.56, 0.34, 0.34)
    pad("Washer", 0.66, 0.42, 0.44)
    _join(decals, "ParkPads", pads)
    _socket("Park_vacuum", root, (-0.56, 0.0, 0.02), rotation=DOWN, parks="vacuum")
    _socket("Park_washer", root, (0.66, 0.0, 0.02), rotation=DOWN, parks="washer")
    return root, dims, ("SOCKET_Park_vacuum", "SOCKET_Park_washer")


def build_window() -> tuple[bpy.types.Object, tuple, tuple]:
    """Walnut window casing (frame + sash muntins + sill) sized to the shed opening
    (1.6 x 1.2), with a glass pane. Origin at the pane centre; collision on the frame."""

    dims = (WINDOW_W + 0.16, 0.14, WINDOW_H + 0.20)
    root = _root("window", dims)
    m = _mats()
    frame = _grp("WindowFrame", root)
    ow, oh = WINDOW_W + 0.14, WINDOW_H + 0.14   # outer frame span
    jamb = 0.075
    depth = 0.11
    # Four walnut frame members around the opening, plus two sash muntins, joined to one
    # casing mesh (the glass stays separate so the shed mount can hide it).
    members = [
        A.box("WindowHead", (ow, depth, jamb), (0.0, 0.0, oh / 2.0 - jamb / 2.0), m["walnut"],
              parent=frame, bevel=0.006),
        A.box("WindowSill", (ow, depth + 0.04, jamb + 0.02), (0.0, -0.01, -oh / 2.0 + jamb / 2.0),
              m["walnut"], parent=frame, bevel=0.006),
        A.box("WindowMuntinV", (0.05, depth - 0.04, oh - jamb * 2.0), (0.0, 0.0, 0.0),
              m["walnut"], parent=frame, bevel=0.004),
        A.box("WindowMuntinH", (ow - jamb * 2.0, depth - 0.04, 0.05), (0.0, 0.0, 0.0),
              m["walnut"], parent=frame, bevel=0.004),
    ]
    for sx in (-1.0, 1.0):
        members.append(A.box(f"WindowJamb{'L' if sx < 0 else 'R'}", (jamb, depth, oh - jamb * 2.0),
                             (sx * (ow / 2.0 - jamb / 2.0), 0.0, 0.0), m["walnut"],
                             parent=frame, bevel=0.006))
    _join(members, "WindowCasing", frame)
    # Glass pane, named so the shed mount can hide it (the shell owns the glazed pane +
    # the wipeable dirt film; this casing only dresses the opening).
    A.box("WindowGlass", (WINDOW_W, 0.010, WINDOW_H), (0.0, 0.0, 0.0), m["glass"],
          parent=frame, bevel=0.0, uv="cube", properties={"pane_glass": True})
    _socket("PaneCenter", root, (0.0, 0.0, 0.0), rotation=DOWN, pane=True)
    A.collision_box("Frame", (ow, depth, oh), (0.0, 0.0, 0.0), parent=root)
    return root, dims, ("SOCKET_PaneCenter",)


def build_door() -> tuple[bpy.types.Object, tuple, tuple]:
    """Door frame + head trim + weathered threshold sized to the shed doorway (1.35 clear).
    No collision — the opening stays passable."""

    dims = (DOOR_CLEAR_W + 0.30, 0.26, DOOR_H + 0.15)
    root = _root("door", dims)
    m = _mats()
    frame = _grp("DoorFrame", root)
    jamb = 0.10
    depth = 0.26
    outer_w = DOOR_CLEAR_W + jamb * 2.0
    # Origin at the threshold centre (floor), frame rises in +Z. Members joined to one mesh.
    members = [
        A.box("DoorHead", (outer_w, depth, jamb), (0.0, 0.0, DOOR_H + jamb / 2.0), m["walnut"],
              parent=frame, bevel=0.006),
        # Head trim proud of the head, and a weathered charcoal threshold strip on the floor.
        A.box("DoorHeadTrim", (outer_w + 0.10, depth * 0.55, 0.06),
              (0.0, -0.05, DOOR_H + jamb + 0.02), m["charcoal"], parent=frame, bevel=0.005),
        A.box("DoorThreshold", (DOOR_CLEAR_W + 0.04, depth, 0.03), (0.0, 0.0, 0.015),
              m["charcoal"], parent=frame, bevel=0.004, properties={"weathered": True}),
    ]
    for sx in (-1.0, 1.0):
        members.append(A.box(f"DoorJamb{'L' if sx < 0 else 'R'}", (jamb, depth, DOOR_H),
                             (sx * (DOOR_CLEAR_W / 2.0 + jamb / 2.0), 0.0, DOOR_H / 2.0),
                             m["walnut"], parent=frame, bevel=0.006))
    _join(members, "DoorFrame", frame)
    _socket("DoorCenter", root, (0.0, 0.0, DOOR_H / 2.0), rotation=DOWN, clear_width_m=DOOR_CLEAR_W)
    return root, dims, ("SOCKET_DoorCenter",)


def build_clutter() -> tuple[bpy.types.Object, tuple, tuple]:
    """A cluster of shed smalls: a paint-can trio (one tipped, with a dried drip ring), a
    solvent-bottle pair, a folded rag pile, and a coiled rope. One named group per prop,
    each with its own collision proxy."""

    dims = (1.36, 0.68, 0.23)
    root = _root("clutter", dims)
    m = _mats()

    cans = _grp("PaintCans", root)
    can_parts = []
    for i, (cx, cy) in enumerate(((-0.52, 0.06), (-0.40, -0.10), (-0.60, -0.16))):
        can_parts.append(A.cylinder(f"PaintCanBody_{i}", 0.078, 0.135, (cx, cy, 0.068),
                                    m["paint_can"], vertices=18, parent=cans, bevel=0.004))
        can_parts.append(A.cylinder(f"PaintCanLid_{i}", 0.082, 0.014, (cx, cy, 0.142),
                                    m["charcoal"], vertices=18, parent=cans, bevel=0.003))
        can_parts.append(A.torus(f"PaintCanRim_{i}", 0.070, 0.006, (cx, cy, 0.135), m["steel"],
                                 major_segments=16, minor_segments=6, parent=cans))
    # One can tipped on its side with a dried drip ring (a low prism) pooling from the lip.
    can_parts.append(A.cylinder("PaintCanTipped", 0.078, 0.135, (-0.20, 0.20, 0.078),
                                m["paint_can"], rotation=(math.pi / 2.0, 0.0, 0.3),
                                vertices=18, parent=cans, bevel=0.004))
    can_parts.append(A.profile_prism("PaintDripRing",
                     ((-0.11, 0.0), (0.11, 0.0), (0.08, 0.006), (-0.08, 0.006)),
                     0.14, (-0.10, 0.22, 0.0), m["paint_drip"], rotation=(0.0, 0.0, math.pi / 2.0),
                     parent=cans, bevel=0.001, properties={"dried_drip": True}))
    _join(can_parts, "PaintCans", cans)
    A.collision_box("PaintCans", (0.50, 0.44, 0.16), (-0.42, 0.02, 0.08), parent=root)

    solvent = _grp("Solvent", root)
    solvent_parts = []
    for i, cx in enumerate((0.16, 0.30)):
        solvent_parts.append(A.cylinder(f"SolventBody_{i}", 0.050, 0.180, (cx, -0.02, 0.090),
                                        m["solvent"], vertices=14, parent=solvent, bevel=0.006))
        solvent_parts.append(A.cylinder(f"SolventNeck_{i}", 0.018, 0.045, (cx, -0.02, 0.200),
                                        m["charcoal"], vertices=10, parent=solvent, bevel=0.003))
        solvent_parts.append(A.box(f"SolventLabel_{i}", (0.052, 0.001, 0.075), (cx, -0.072, 0.095),
                                   m["cream"], parent=solvent, bevel=0.0))
    _join(solvent_parts, "Solvent", solvent)
    A.collision_box("Solvent", (0.24, 0.14, 0.24), (0.23, -0.02, 0.12), parent=root)

    rags = _grp("RagPile", root)
    rag_parts = [
        A.box(f"RagFold_{i}", (0.22, 0.16, 0.028), (0.52 + dx, 0.22, 0.016 + dz), m["rag_green"],
              parent=rags, bevel=0.010, bevel_segments=2, rotation=(0.0, 0.0, ry))
        for i, (dz, dx, ry) in enumerate(((0.0, 0.0, 0.0), (0.028, 0.03, 0.4), (0.052, -0.02, -0.3)))
    ]
    _join(rag_parts, "RagPile", rags)
    A.collision_box("RagPile", (0.26, 0.20, 0.10), (0.53, 0.22, 0.05), parent=root)

    rope = _grp("Rope", root)
    rope_parts = [
        A.torus(f"RopeCoil_{i}", 0.11 - i * 0.018, 0.017, (0.52, -0.22, 0.020 + i * 0.030),
                m["rope"], major_segments=20, minor_segments=7, parent=rope)
        for i in range(3)
    ]
    _join(rope_parts, "Rope", rope)
    A.collision_box("Rope", (0.26, 0.26, 0.11), (0.52, -0.22, 0.055), parent=root)
    return root, dims, ()


BUILDERS = {
    "wallrack": build_wallrack,
    "parks": build_parks,
    "window": build_window,
    "door": build_door,
    "clutter": build_clutter,
}


# ---------------------------------------------------------------------------
# Publish + verify


def _publish(part: str, preview: bool) -> dict:
    # Geometry is fully index-driven (no `random`), so a constant seed keeps the scene
    # deterministic; the seed only feeds reset_scene's RNG, which nothing here reads.
    A.reset_scene(seed=A.DEFAULT_SEED)
    root, dims, required_sockets = BUILDERS[part]()
    report = A.validate_asset_scene(
        root, expected_dimensions=dims, required_sockets=required_sockets,
        require_collision=REQUIRE_COLLISION[part],
    )
    print("VALIDATION|" + json.dumps(report.to_dict(), sort_keys=True))
    report.raise_for_errors()
    tri = report.stats.get("triangleCount", 0)
    budget = BUDGETS[part]
    if tri > budget:
        raise RuntimeError(f"shed kit part {part} is {tri} tris, over budget {budget}")
    for directory in (SOURCE_DIR, CANONICAL_DIR, RUNTIME_DIR):
        directory.mkdir(parents=True, exist_ok=True)
    A.save_blend(SOURCE_DIR / f"shed_{part}.blend")
    A.export_glb(CANONICAL_DIR / f"shed_{part}.glb", root)
    runtime = A.export_glb(RUNTIME_DIR / f"shed_{part}.glb", root)
    if preview:
        PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
        A.render_studio_preview(root, PREVIEW_DIR / f"shed_{part}.png")
    return {"part": part, "triangles": tri, "budget": budget, "ok": report.ok,
            "runtimeGlb": str(runtime.relative_to(A.REPO_ROOT).as_posix())}


def _verify() -> int:
    """Cold-import each shipped kit GLB into a wiped scene and check the floor sits at ~0,
    the required sockets survived, and collision proxies keep their COL_ prefix."""

    problems: list[str] = []
    checked = 0
    for part in BUILDERS:
        path = RUNTIME_DIR / f"shed_{part}.glb"
        if not path.is_file():
            problems.append(f"{part}: missing {path}")
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        for block in (bpy.data.meshes, bpy.data.materials, bpy.data.objects):
            for datablock in list(block):
                if getattr(datablock, "users", 0) == 0:
                    block.remove(datablock)
        bpy.ops.import_scene.gltf(filepath=str(path))
        bpy.context.view_layer.update()
        roots = [o for o in bpy.context.scene.objects if o.parent is None and o.name.startswith("A_SHED_")]
        if len(roots) != 1:
            problems.append(f"{part}: expected one A_SHED_*_ROOT, found {len(roots)}")
            continue
        root = roots[0]
        meshes = [o for o in A.descendants(root) if o.type == "MESH"]
        visible = [o for o in meshes if not o.name.startswith("COL_")]
        cols = [o for o in meshes if o.name.startswith("COL_")]
        for o in A.descendants(root):
            if o is root:
                continue
            if not o.name.startswith(A._VALID_NODE_PREFIXES):
                problems.append(f"{part}: node {o.name} lacks an approved prefix")
        if not visible:
            problems.append(f"{part}: no visible mesh")
        try:
            bounds = A.world_bounds(root)
            floor_z = bounds.minimum[2]
            if part in ("parks", "clutter", "door") and floor_z < -0.02:
                problems.append(f"{part}: floor sits at z={floor_z:.3f} (expected ~0)")
        except ValueError as exc:
            problems.append(f"{part}: {exc}")
        if REQUIRE_COLLISION[part] and not cols:
            problems.append(f"{part}: expected a COL_ proxy, found none")
        sockets = sorted(o.name for o in A.descendants(root) if o.name.startswith("SOCKET_"))
        checked += 1
        print(f"KIT_VERIFY|{part}|visible={len(visible)}|collision={len(cols)}|"
              f"floorZ={floor_z:.4f}|sockets={','.join(sockets)}")
    if problems:
        for problem in problems:
            print(f"KIT_VERIFY_FAIL|{problem}")
        print("KIT_VERIFY|" + json.dumps({"ok": False, "checked": checked, "problems": problems}))
        return 1
    print("KIT_VERIFY|" + json.dumps({"ok": True, "checked": checked, "problems": []}))
    return 0


def _cli(argv: Sequence[str]) -> tuple[str, bool, bool]:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--part", default="all",
                        choices=(*BUILDERS.keys(), "all"))
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--verify", action="store_true")
    ns = parser.parse_args(list(argv))
    return ns.part, ns.preview, ns.verify


def main(argv: Sequence[str] | None = None) -> int:
    part, preview, verify = _cli(A.blender_cli_args(sys.argv) if argv is None else list(argv))
    if verify:
        return _verify()
    parts = list(BUILDERS) if part == "all" else [part]
    results = [_publish(p, preview) for p in parts]
    print("SHED_KIT_BUILD|" + json.dumps(results, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
