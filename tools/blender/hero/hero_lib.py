"""HERO ASSET STUDIO — lighting, cameras, turntables, silhouettes, export.

GOAL 27 is DESIGN ONLY: nothing is wired into the game this session, so the
renders ARE the evidence. Every asset judgement this project has got wrong was
made in a dark clubhouse at 6:01 AM, so the whole point of this module is that
the frame is lit properly, neutral, and repeatable before anyone argues about
proportion.

What it gives every asset, identically:

  TURNTABLE   n views around the object at a fixed elevation. Proportion faults
              that hide at one angle do not hide across eight.
  CLOSE       a three-quarter hero framing, the shot an art review argues over.
  SILHOUETTE  the object as a black shape on white. The brief asks "would you
              recognise it as a black shape?" and that is not a question you can
              answer from a lit render -- specular and colour do too much work.
  APPARENT    the object at the size and field of view the PLAYER gets. A model
              that only survives a close-up has not survived.

The lighting is a neutral three-point studio, not an HDRI: an HDRI bakes a
location's colour into the frame and this project already has a history of
arguing about a fault that was really a light. Grey world, white key, cool fill,
bright rim. Nothing here flatters the model.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

# ---------------------------------------------------------------------------
# scene


def reset_scene():
    """Empty the file. --factory-startup still ships a cube, a light, a camera."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.objects,
                  bpy.data.metaballs, bpy.data.cameras, bpy.data.lights):
        for item in list(block):
            block.remove(item, do_unlink=True)


def set_engine(engine="EEVEE", samples=64):
    """EEVEE for iteration, Cycles for the frames that get reviewed.

    EEVEE Next renders headless on this machine (there is a real GPU behind the
    background context); Cycles falls back to CPU and is roughly 8x slower, which
    is affordable for a final pass and not for a loop.
    """
    scene = bpy.context.scene
    if engine.upper().startswith("CYCLES"):
        scene.render.engine = "CYCLES"
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
        scene.cycles.max_bounces = 6
    else:
        # Blender 5.x calls it BLENDER_EEVEE_NEXT; 4.1 and earlier BLENDER_EEVEE.
        avail = [i.identifier for i in
                 bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
        scene.render.engine = ("BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in avail
                               else "BLENDER_EEVEE")
        try:
            scene.eevee.taa_render_samples = max(32, samples)
            scene.eevee.use_raytracing = True
        except AttributeError:
            pass
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX" if _has_view_transform("AgX") else "Filmic"
    scene.view_settings.look = "None"
    # AgX lifts midtones hard, and this studio is bright. Left at 0 EV a charcoal
    # dustpan renders as brushed aluminium and near-black bristles render as grey
    # wire -- both were read as missing materials before the exposure was the
    # thing that had never been set.
    scene.view_settings.exposure = -0.9


def _has_view_transform(name):
    try:
        items = bpy.types.ColorManagedViewSettings.bl_rna.properties[
            "view_transform"].enum_items
        return name in [i.identifier for i in items]
    except Exception:
        return False


def world_grey(value=0.045):
    """A dim neutral world. Not zero -- a black world makes every unlit face read
    as a hole, and half this project's 'missing geometry' scares were that."""
    world = bpy.data.worlds.new("Studio")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (value, value, value, 1.0)
    bg.inputs[1].default_value = 1.0
    bpy.context.scene.world = world
    return world


def _area(name, loc, look_at, energy, size, color=(1, 1, 1)):
    light = bpy.data.lights.new(name, type="AREA")
    light.energy = energy
    light.size = size
    light.color = color
    obj = bpy.data.objects.new(name, light)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    _aim(obj, look_at)
    return obj


def _aim(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def studio(center=(0, 0, 0), scale=1.0, key=130.0, fill=38.0, rim=105.0):
    """Three-point studio, sized to the subject.

    `scale` is roughly the subject's radius in metres. Light energy is scaled by
    distance squared so a 5 cm object and a 50 cm object come out at the same
    exposure and can be compared to each other.
    """
    c = Vector(center)
    d = max(0.12, scale * 3.2)
    p = d * d  # inverse-square compensation

    lights = [
        _area("Key", c + Vector((-d * 0.9, -d * 0.9, d * 0.95)), c,
              key * p, d * 0.9, (1.0, 0.97, 0.93)),
        _area("Fill", c + Vector((d * 1.1, -d * 0.6, d * 0.2)), c,
              fill * p, d * 1.3, (0.88, 0.93, 1.0)),
        _area("Rim", c + Vector((d * 0.2, d * 1.2, d * 0.8)), c,
              rim * p, d * 0.6, (1.0, 1.0, 1.0)),
        # A dim bounce from below so the underside is legible rather than black.
        _area("Bounce", c + Vector((0, -d * 0.4, -d * 1.1)), c,
              fill * 0.45 * p, d * 1.4, (0.95, 0.95, 0.98)),
    ]
    world_grey()
    return lights


def backdrop(center=(0, 0, 0), scale=1.0, value=0.16):
    """A large mid-grey card behind and below. Gives the object something to cast
    onto -- a contact shadow is most of what tells an eye an object has volume."""
    d = max(0.2, scale * 4.0)
    mesh = bpy.ops.mesh.primitive_plane_add(size=d * 6, location=(center[0], center[1], center[2] - scale * 1.05))
    floor = bpy.context.active_object
    floor.name = "Backdrop"
    mat = bpy.data.materials.new("BackdropMat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (value, value, value, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.85
    floor.data.materials.append(mat)
    return floor


# ---------------------------------------------------------------------------
# cameras


def camera(name, loc, look_at, lens=50.0, ortho=False, ortho_scale=1.0):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    if ortho:
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = ortho_scale
    obj = bpy.data.objects.new(name, cam_data)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    _aim(obj, look_at)
    return obj


def camera_fov(name, loc, look_at, fov_deg):
    """A camera specified by FIELD OF VIEW rather than focal length, because the
    game specifies its camera that way and 'apparent size' has to match it."""
    cam_data = bpy.data.cameras.new(name)
    cam_data.sensor_fit = "HORIZONTAL"
    cam_data.lens_unit = "FOV"
    cam_data.angle = math.radians(fov_deg)
    obj = bpy.data.objects.new(name, cam_data)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    _aim(obj, look_at)
    return obj


def fit_distance(subject_radius, lens_or_fov, res=(1000, 1000), is_fov=False, margin=1.28):
    """How far back the camera has to be for the subject to FIT.

    Framing by hand put the first hand render's camera inside the model, and a
    frame the object overflows cannot answer a proportion question -- it can only
    answer a question about the lens. Every hero shot in this session is framed
    from the subject's own bounding radius so that never happens again.
    """
    if is_fov:
        half = math.radians(lens_or_fov) * 0.5
    else:
        # Blender's default 36 mm sensor, fitted to the narrower image axis.
        half = math.atan(18.0 / lens_or_fov)
        if res[0] < res[1]:
            half = math.atan((18.0 * res[0] / res[1]) / lens_or_fov)
    return subject_radius * margin / math.tan(half)


def subject_sphere(objects, weight_y=None):
    """Centre and radius of the subject, so shots frame the thing and not its
    bounding box corner. `weight_y` clamps a long tail -- a forearm should run
    out of frame rather than shrink the hand to nothing."""
    lo, hi = bounds(objects)
    if weight_y is not None:
        lo = Vector((lo.x, max(lo.y, weight_y[0]), lo.z))
        hi = Vector((hi.x, min(hi.y, weight_y[1]), hi.z))
    center = (lo + hi) * 0.5
    radius = max(0.001, (hi - lo).length * 0.5)
    return center, radius


def orbit_position(center, radius, azimuth_deg, elevation_deg):
    az = math.radians(azimuth_deg)
    el = math.radians(elevation_deg)
    return Vector((
        center[0] + radius * math.cos(el) * math.cos(az),
        center[1] + radius * math.cos(el) * math.sin(az),
        center[2] + radius * math.sin(el),
    ))


# ---------------------------------------------------------------------------
# rendering


def render(cam, path, res=(1100, 1100)):
    scene = bpy.context.scene
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print(f"  rendered {os.path.basename(path)}")
    return path


def turntable(center, radius, out_dir, prefix, views=8, elevation=18.0,
              lens=68.0, res=(900, 900)):
    """`views` cameras evenly around the subject. Written as separate files
    rather than an animation so each one can be looked at."""
    paths = []
    for i in range(views):
        az = -90.0 + (360.0 / views) * i
        cam = camera(f"TT{i}", orbit_position(center, radius, az, elevation),
                     center, lens=lens)
        paths.append(render(cam, os.path.join(out_dir, f"{prefix}-tt{i:02d}.png"), res))
        bpy.data.objects.remove(cam, do_unlink=True)
    return paths


def silhouette(objects, cam, path, res=(900, 900)):
    """Black shape on white. Every material is swapped for a pure black emission
    and the world is driven to white, so nothing but the outline survives.

    This is a genuinely different question from the lit render: a silhouette that
    reads as a bag of lumps is a silhouette fault however nicely it is shaded.
    """
    scene = bpy.context.scene
    black = bpy.data.materials.new("SilBlack")
    black.use_nodes = True
    nt = black.node_tree
    nt.nodes.clear()
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs[0].default_value = (0, 0, 0, 1)
    emit.inputs[1].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(emit.outputs[0], out.inputs[0])

    saved = []
    for ob in objects:
        if ob.type != "MESH":
            continue
        saved.append((ob, list(ob.data.materials)))
        ob.data.materials.clear()
        ob.data.materials.append(black)

    world = scene.world
    old_bg = world.node_tree.nodes["Background"].inputs[0].default_value[:]
    old_str = world.node_tree.nodes["Background"].inputs[1].default_value
    world.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 6.0
    lights = [o for o in scene.objects if o.type == "LIGHT"]
    hidden = [(l, l.hide_render) for l in lights]
    for l in lights:
        l.hide_render = True
    floor = bpy.data.objects.get("Backdrop")
    floor_hidden = floor.hide_render if floor else None
    if floor:
        floor.hide_render = True
    old_view = scene.view_settings.view_transform
    scene.view_settings.view_transform = "Standard"

    render(cam, path, res)

    scene.view_settings.view_transform = old_view
    for ob, mats in saved:
        ob.data.materials.clear()
        for m in mats:
            ob.data.materials.append(m)
    world.node_tree.nodes["Background"].inputs[0].default_value = old_bg
    world.node_tree.nodes["Background"].inputs[1].default_value = old_str
    for l, was in hidden:
        l.hide_render = was
    if floor is not None:
        floor.hide_render = floor_hidden
    return path


def contact_sheet(paths, out_path, cols=4):
    """Tile the turntable into one image so a reviewer sees every angle at once.

    Uses Blender's own compositor-free image API: load, paste pixel buffers. No
    external dependency, and it runs in the same process that made the frames.
    """
    import numpy as np
    imgs = []
    for p in paths:
        img = bpy.data.images.load(p)
        w, h = img.size
        buf = np.asarray(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
        imgs.append(buf)
        bpy.data.images.remove(img)
    if not imgs:
        return None
    h, w, _ = imgs[0].shape
    rows = (len(imgs) + cols - 1) // cols
    sheet = np.zeros((rows * h, cols * w, 4), dtype=np.float32)
    sheet[..., 3] = 1.0
    for i, buf in enumerate(imgs):
        r, c = divmod(i, cols)
        # Blender pixel buffers are bottom-up; place rows from the bottom so the
        # sheet reads in the same order as the file names.
        rr = rows - 1 - r
        sheet[rr * h:(rr + 1) * h, c * w:(c + 1) * w] = buf
    out = bpy.data.images.new("Sheet", width=cols * w, height=rows * h, alpha=True)
    out.pixels = sheet.reshape(-1).tolist()
    out.filepath_raw = out_path
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    print(f"  contact sheet {os.path.basename(out_path)}")
    return out_path


# ---------------------------------------------------------------------------
# measurement and export


def triangles(objects):
    total = 0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for ob in objects:
        if ob.type != "MESH":
            continue
        eval_ob = ob.evaluated_get(depsgraph)
        mesh = eval_ob.to_mesh()
        mesh.calc_loop_triangles()
        total += len(mesh.loop_triangles)
        eval_ob.to_mesh_clear()
    return total


def bounds(objects):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in objects:
        if ob.type != "MESH":
            continue
        for corner in ob.bound_box:
            world = ob.matrix_world @ Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], world[i])
                hi[i] = max(hi[i], world[i])
    return lo, hi


def bake_gltf_axis(objects):
    """Blender +Y -> glTF -Z, established by marker probe off exported accessor
    bounds. Baked into the VERTICES, never left as an object rotation: the
    exporter reports nodeRot null because it bakes transforms, and the runtime
    swap takes geometry only, so anything at node level is silently dropped.

        (x, y, z)_blender  ->  (x, z, -y)_gltf
    """
    for ob in objects:
        if ob.type == "EMPTY":
            # A SOCKET has no vertices to bake the swap into, so its LOCATION
            # takes it instead. Skipping non-meshes here (which this function
            # used to do) leaves every socket in Blender space while the mesh
            # around it moves -- the hand would close on empty air, which is
            # the exact fault this part exists to kill.
            x, y, z = ob.location
            ob.location = Vector((x, z, -y))
            continue
        if ob.type != "MESH":
            continue
        for v in ob.data.vertices:
            x, y, z = v.co
            v.co = Vector((x, z, -y))
        ob.data.update()


def export_glb(objects, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=False,   # the swap is already in the vertices
    )
    size = os.path.getsize(path)
    print(f"  exported {os.path.basename(path)}  ({size} bytes)")
    return path


def socket(name, location):
    """A named EMPTY at the exact point a hand closes.

    gripsFor() resolves these out of the loaded GLB every frame and returns
    null for anything it cannot find, at which point the tool falls back to
    LEGACY_GRIPS -- static numbers never reconciled with the manifest, which is
    why the rake's hands sit 0.81 yd from the rake. Authoring the socket into
    the mesh is what makes the fallback path unreachable.
    """
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = "PLAIN_AXES"
    ob.empty_display_size = 0.02
    ob.location = Vector(location)
    bpy.context.collection.objects.link(ob)
    return ob


def verify_sockets(path, names):
    """Read the exported GLB's own node names out of the FILE.

    Not via Blender's importer. The importer renames on collision, so a
    perfectly good SOCKET_GripPrimary comes back as SOCKET_GripPrimary.002
    purely because the object that produced it is still in the scene -- and a
    check that tolerated the suffix would equally have tolerated a genuinely
    suffixed node, which gripsFor() cannot resolve because it looks the name up
    exactly. Parsing the glTF JSON chunk asks the file the same question the
    game asks it.
    """
    import json
    import struct
    with open(path, "rb") as fh:
        blob = fh.read()
    magic, _ver, _len = struct.unpack_from("<4sII", blob, 0)
    if magic != b"glTF":
        raise SystemExit(f"BUILD FAILED: {path} is not a GLB")
    off, doc = 12, None
    while off < len(blob):
        clen, ctype = struct.unpack_from("<II", blob, off)
        if ctype == 0x4E4F534A:
            doc = json.loads(blob[off + 8: off + 8 + clen].decode("utf-8"))
            break
        off += 8 + clen + (-clen % 4)
    if doc is None:
        raise SystemExit(f"BUILD FAILED: {path} has no JSON chunk")
    present = [n.get("name", "") for n in doc.get("nodes", [])]
    for want in names:
        if want not in present:
            raise SystemExit(
                f"BUILD FAILED: {os.path.basename(path)} has no node named "
                f"{want}. The tool will fall back to LEGACY_GRIPS and the hands "
                f"will sit where the table says, not where the grip is. "
                f"Nodes in the file: {sorted(present)}")
    print(f"  sockets verified IN THE FILE {os.path.basename(path)}: "
          f"{', '.join(names)}  (of {len(present)} nodes)")
    return present


def argv_after_dashes():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
