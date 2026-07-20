"""Build the Pinehollow heavy-duty storage/shelving rack asset.

Run from the repository root:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
        --background --factory-startup \
        --python tools/blender/build_storage_rack.py

Optionally append `-- render` to also write a lit preview PNG:

    ... --python tools/blender/build_storage_rack.py -- render

Modelled from a single isolated reference of a boltless 5-tier industrial rack:
a dark gunmetal-charcoal frame (four slotted uprights, X end-bracing, box-section
step beams, wide foot plates, rivets) carrying five muted sage-green steel decks.

Authored in metres. Saves one traceable .blend under
asset_sources/blender/clubhouse/ and exports a hierarchical GLB into the existing
vendor/models/clubhouse/ pipeline. No third-party assets are downloaded or imported.

Coordinate convention (matches the clubhouse kit):
    X  left/right across the front       Y  depth; -Y is the player/front side
    Z  up
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy

SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[2]
SOURCE_DIR = ROOT / "asset_sources" / "blender" / "clubhouse"
EXPORT_DIR = ROOT / "vendor" / "models" / "clubhouse"
PREVIEW_DIR = ROOT / "qa" / "storage-rack"
SOURCE_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

BUILD_VERSION = 1
ASSET_ID = "storage_rack"

# real-world target size (m): a common heavy-duty 5-tier bay
W, D, H = 1.80, 0.60, 1.80
PX, PY = 0.875, 0.265            # upright centre x / y
FOOT_T = 0.014
POST_H = H - FOOT_T
LEVELS = [0.150, 0.552, 0.954, 1.356, 1.758]   # deck centre-z, 5 tiers

PALETTE = {
    "charcoal":  (0.042, 0.049, 0.057, 1.0),
    "channel":   (0.014, 0.017, 0.021, 1.0),
    "sage":      (0.128, 0.176, 0.106, 1.0),   # muted olive-sage; painted steel deck
    "steel":     (0.44, 0.48, 0.53, 1.0),
    "collision": (1.0, 0.0, 1.0, 0.0),
}


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.length_unit = "METERS"
    sc.unit_settings.scale_length = 1.0
    sc["asset_build_script"] = str(SCRIPT.relative_to(ROOT)).replace("\\", "/")
    sc["asset_build_version"] = BUILD_VERSION
    sc["units"] = "meters"


def mat(name, color, *, roughness=0.6, metallic=0.0):
    found = bpy.data.materials.get(name)
    if found:
        return found
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = color
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = color
    b.inputs["Roughness"].default_value = roughness
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Alpha"].default_value = color[3]
    if color[3] < 1.0 and hasattr(m, "surface_render_method"):
        m.surface_render_method = "DITHERED"
    return m


def materials():
    return {
        # painted matte steel reads dark and low-metallic; high metallic under a bright
        # key + AgX washed the frame pale grey and the decks white on the first pass.
        "charcoal": mat("M_RackCharcoal", PALETTE["charcoal"], roughness=0.55, metallic=0.18),
        "channel": mat("M_RackChannel", PALETTE["channel"], roughness=0.62, metallic=0.15),
        "sage": mat("M_RackSage", PALETTE["sage"], roughness=0.62, metallic=0.04),
        "steel": mat("M_RackSteel", PALETTE["steel"], roughness=0.36, metallic=0.85),
        "collision": mat("M_Collision", PALETTE["collision"], roughness=1.0),
    }


def activate(obj) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def finish_mesh(obj, material, *, bevel_width=0.0, uv=True):
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel_width > 0:
        mod = obj.modifiers.new("EdgeSoftening", "BEVEL")
        mod.width = bevel_width
        mod.segments = 2
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(38)
        activate(obj)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if material:
        obj.data.materials.clear()
        obj.data.materials.append(material)
    if uv and obj.data.polygons:
        activate(obj)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.03)
        bpy.ops.object.mode_set(mode="OBJECT")
    activate(obj)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    except Exception:
        pass
    return obj


def parent_keep(obj, parent):
    if parent is None:
        return obj
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_parent_inverse = parent.matrix_world.inverted()
    obj.matrix_world = world
    bpy.context.view_layer.update()
    return obj


def empty(name, loc=(0, 0, 0), *, parent=None, props=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    obj.empty_display_size = 0.10
    parent_keep(obj, parent)
    for k, v in (props or {}).items():
        obj[k] = v
    return obj


def box(name, dims, loc, material, *, rot=(0, 0, 0), bevel=0.004, parent=None, props=None):
    # Build axis-aligned at the origin, size it, THEN rotate — so a rotated strut
    # scales correctly (setting dimensions on an already-rotated cube would skew it).
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = name
    obj.dimensions = dims
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler = rot
    obj.location = loc
    finish_mesh(obj, material, bevel_width=(min(bevel, min(dims) * 0.24) if bevel else 0.0))
    parent_keep(obj, parent)
    for k, v in (props or {}).items():
        obj[k] = v
    return obj


def cyl(name, radius, depth, loc, material, *, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=radius, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    finish_mesh(obj, material, bevel_width=min(0.0015, radius * 0.3), uv=False)
    parent_keep(obj, parent)
    return obj


def collision_box(name, dims, loc, M, *, parent=None):
    obj = box(name, dims, loc, M["collision"], bevel=0.0, parent=parent,
              props={"collision_proxy": True, "shape": "box"})
    obj.display_type = "WIRE"
    obj.hide_render = True
    return obj


def build_rack(M):
    root = empty(ASSET_ID, props={
        "asset_id": ASSET_ID,
        "asset_version": BUILD_VERSION,
        "units": "meters",
        "front": "-Y (player side)",
        "target_dimensions_m": [W, D, H],
        "source": "Original Pinehollow Golf asset generated in-repository",
        "license": "Project-owned / UNLICENSED",
    })

    # ---- four uprights: foot plate, slotted post, channel inlay, top cap ----------
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * PX, sy * PY
            tag = f"{'L' if sx < 0 else 'R'}{'F' if sy < 0 else 'B'}"
            box(f"Foot_{tag}", (0.135, 0.115, FOOT_T), (x, y, FOOT_T / 2), M["charcoal"], bevel=0.003, parent=root)
            box(f"Post_{tag}", (0.050, 0.072, POST_H), (x, y, FOOT_T + POST_H / 2), M["charcoal"], bevel=0.005, parent=root)
            box(f"Cap_{tag}", (0.056, 0.078, 0.018), (x, y, H + 0.006), M["charcoal"], bevel=0.004, parent=root)
            # recessed slotted-rail channel down the outer X-face (reads as the punched upright)
            box(f"Channel_{tag}_side", (0.005, 0.052, POST_H * 0.9),
                (x + sx * 0.0255, y, FOOT_T + POST_H / 2), M["channel"], bevel=0.0, parent=root)
            # and a flush front channel on the two visible FRONT uprights, with real punched slots
            if sy < 0:
                yf = y - 0.036  # front post face
                box(f"Channel_{tag}_front", (0.026, 0.008, POST_H * 0.9),
                    (x, yf + 0.001, FOOT_T + POST_H / 2), M["channel"], bevel=0.0, parent=root)
                nslot = 18
                for k in range(nslot):
                    sz = FOOT_T + 0.13 + k * (POST_H * 0.84 / (nslot - 1))
                    box(f"Slot_{tag}_{k}", (0.013, 0.010, 0.016), (x, yf - 0.001, sz),
                        M["channel"], bevel=0.0, parent=root)

    # ---- five tiers: front & back step beams + a sage steel deck ------------------
    for i, lz in enumerate(LEVELS):
        bz = lz - 0.052
        box(f"BeamFront_{i}", (1.735, 0.045, 0.078), (0, -0.243, bz), M["charcoal"], bevel=0.005, parent=root)
        box(f"BeamBack_{i}", (1.735, 0.045, 0.078), (0, 0.243, bz), M["charcoal"], bevel=0.005, parent=root)
        # deck as a shallow tray: flat panel + a low downturned lip front and back
        box(f"Deck_{i}", (1.715, 0.556, 0.020), (0, 0, lz), M["sage"], bevel=0.004, parent=root)
        box(f"DeckLipF_{i}", (1.715, 0.012, 0.030), (0, -0.272, lz - 0.006), M["sage"], bevel=0.003, parent=root)
        box(f"DeckLipB_{i}", (1.715, 0.012, 0.030), (0, 0.272, lz - 0.006), M["sage"], bevel=0.003, parent=root)
        # rivets where each front beam meets the two front posts
        for sx in (-1, 1):
            cyl(f"Rivet_{i}_{sx}", 0.010, 0.014, (sx * (PX - 0.055), -0.222, bz),
                M["steel"], rot=(math.radians(90), 0, 0), parent=root)

    # ---- X cross-bracing on both ends (flat charcoal straps in the Y-Z plane) -----
    zb, zt, ye = 0.20, 1.70, 0.243
    for sx in (-1, 1):
        x = sx * PX
        for tag, (y0, y1) in (("a", (-ye, ye)), ("b", (ye, -ye))):
            dy, dz = (y1 - y0), (zt - zb)
            length = math.hypot(dy, dz)
            box(f"Brace_{'L' if sx < 0 else 'R'}_{tag}", (0.013, length, 0.052),
                (x, (y0 + y1) / 2, (zb + zt) / 2), M["charcoal"],
                rot=(math.atan2(dz, dy), 0, 0), bevel=0.003, parent=root)
        # a mid horizontal tie on each end, just for rigidity read
        box(f"Tie_{'L' if sx < 0 else 'R'}", (0.013, 0.52, 0.040), (x, 0, 0.95),
            M["charcoal"], bevel=0.003, parent=root)

    # ---- one solid collision proxy (the bay is not walk-through) ------------------
    collision_box("COL_StorageRack", (W, D, H), (0, 0, H / 2), M, parent=root)
    return root


def descendants(root):
    out = [root]
    stack = list(root.children)
    while stack:
        o = stack.pop(0)
        out.append(o)
        stack.extend(o.children)
    return out


def join_static(root):
    """The rack has no moving parts, so fuse every visible piece into one
    multi-material body (a handful of primitives, not 90+ nodes). The collision
    proxy stays a separate node so the game still reads it by its extras."""
    bpy.ops.object.select_all(action="DESELECT")
    bodies = [o for o in descendants(root) if o.type == "MESH" and not o.get("collision_proxy")]
    if len(bodies) < 2:
        return
    for o in bodies:
        o.select_set(True)
    target = bodies[0]
    target.name = "storage_rack_body"
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()


def save_and_export(root):
    txt = bpy.data.texts.new("BUILD_INFO.txt")
    txt.write(
        "Pinehollow Golf storage/shelving rack\n"
        f"asset_id: {ASSET_ID}\nbuild_version: {BUILD_VERSION}\n"
        f"builder: {SCRIPT.relative_to(ROOT).as_posix()}\nunits: metres\n"
        "source: original in-repository geometry; no third-party downloads\n"
    )
    blend_path = SOURCE_DIR / f"{ASSET_ID}.blend"
    glb_path = EXPORT_DIR / f"{ASSET_ID}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.object.select_all(action="DESELECT")
    sel = descendants(root)
    for o in sel:
        o.hide_viewport = False
        o.hide_render = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path), export_format="GLB", use_selection=True,
        export_apply=True, export_yup=True, export_normals=True, export_texcoords=True,
        export_materials="EXPORT", export_extras=True, export_cameras=False, export_lights=False,
    )
    print(f"BUILT|{ASSET_ID}|source={blend_path}|export={glb_path}|nodes={len(sel)}")
    return blend_path, glb_path


def render_preview(root):
    """A neutral 3/4 studio render, echoing the reference's grey backdrop."""
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    sc = bpy.context.scene
    # neutral seamless backdrop + floor
    ground = box("PreviewFloor", (14, 14, 0.05), (0, 0, -0.025),
                 mat("M_PreviewFloor", (0.55, 0.55, 0.57, 1.0), roughness=0.9))
    world = bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.66, 0.66, 0.68, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.55
    sc.world = world
    # key + fill + rim
    def light(name, kind, loc, energy, size=3.0, rot=(0, 0, 0)):
        ld = bpy.data.lights.new(name, kind)
        ld.energy = energy
        if kind == "AREA":
            ld.size = size
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        ob.rotation_euler = rot
        bpy.context.collection.objects.link(ob)
        return ob
    light("Key", "AREA", (3.2, -3.6, 4.2), 720, size=4.5, rot=(math.radians(48), 0, math.radians(42)))
    light("Fill", "AREA", (-3.8, -2.2, 2.4), 260, size=5.0, rot=(math.radians(64), 0, math.radians(-52)))
    light("Rim", "AREA", (-1.2, 3.8, 3.2), 380, size=3.0, rot=(math.radians(120), 0, math.radians(200)))
    # camera at a hero 3/4 front angle
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 60
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    cam.location = (2.75, -3.05, 1.72)
    cam.rotation_euler = (math.radians(75), 0, math.radians(41))
    bpy.context.collection.objects.link(cam)
    sc.camera = cam
    try:
        cam_data.dof.use_dof = False
    except Exception:
        pass
    # EEVEE, square, AgX
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            sc.render.engine = eng
            break
        except Exception:
            continue
    try:
        sc.view_settings.view_transform = "AgX"
    except Exception:
        pass
    sc.render.resolution_x = 1200
    sc.render.resolution_y = 1200
    sc.render.film_transparent = False
    sc.render.filepath = str(PREVIEW_DIR / "preview.png")
    bpy.ops.render.render(write_still=True)
    print(f"RENDER|{sc.render.filepath}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    reset_scene()
    M = materials()
    root = build_rack(M)
    join_static(root)
    save_and_export(root)
    if "render" in argv:
        render_preview(root)
    print(f"COMPLETE|asset={ASSET_ID}|source_dir={SOURCE_DIR}|export_dir={EXPORT_DIR}")


if __name__ == "__main__":
    main()
