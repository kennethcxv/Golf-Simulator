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
import re
import sys

import bpy
import numpy as np
from mathutils import Vector, Matrix

# ---------------------------------------------------------------------------
# the blank-frame guard
#
# Eleven frames in the shipped hero set contained NO SUBJECT -- a flat grey card
# and nothing else -- and three of them were cited as evidence in a report. The
# cause was one thing in every case: `backdrop()` puts a large plane 1.05 subject
# radii BELOW the subject, and any camera at an elevation under about -12 degrees
# sits beneath that plane and photographs its underside. Every under-, palmar-,
# reel- and spinner-view in the set was such a camera.
#
# Two changes close it. `render()` now HIDES the backdrop when the camera is
# below it (an under-view wants the object's underside, never the floor's), and
# then MEASURES the written frame and fails the build if the frame is empty.
#
# The threshold is measured, not guessed. `blank_frame_scan.mjs` scored all 569
# frames in qa/hero: the eleven blank ones scored 0.9-1.5 on this statistic and
# the next frame up scored 40.9. Anything between separates them; 8.0 is a
# 5x margin on one side and a 5x margin on the other.
BLANK_EDGE_MIN = 8.0
_ALLOW_BLANK = {"on": False}      # only the negative control turns this off


def frame_edge_score(path):
    """99.9th percentile of the local gradient magnitude of a written frame.

    An image holding any object has hard edges somewhere. An image that is only
    the world gradient plus a flat card has none -- both are smooth by
    construction, which is what makes this separate them by a factor of 30 and
    not by a few percent.
    """
    # Absolute: bpy resolves a relative path against the .blend, not the cwd,
    # and factory-startup has no .blend.
    img = bpy.data.images.load(os.path.abspath(path), check_existing=False)
    try:
        # Raw values. Left as sRGB the guard would be measuring the view
        # transform as much as the frame.
        img.colorspace_settings.name = "Non-Color"
        w, h = img.size
        buf = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(buf)
    finally:
        bpy.data.images.remove(img)
    a = buf.reshape(h, w, 4)
    g = (a[:, :, 0] * 0.299 + a[:, :, 1] * 0.587 + a[:, :, 2] * 0.114) * 255.0
    step = max(1, w // 240)           # match the scanner's sample density
    g = g[::step, ::step]
    gx = g[1:-1, 2:] - g[1:-1, :-2]
    gy = g[2:, 1:-1] - g[:-2, 1:-1]
    return float(np.percentile(np.hypot(gx, gy).ravel(), 99.9))


def assert_frame_has_subject(path):
    score = frame_edge_score(path)
    if score < BLANK_EDGE_MIN and not _ALLOW_BLANK["on"]:
        raise SystemExit(
            f"BUILD FAILED: {os.path.basename(path)} contains no subject "
            f"(edge score {score:.2f}, floor {BLANK_EDGE_MIN}). The camera "
            f"photographed empty space or the back of the backdrop. A frame "
            f"with nothing in it must never reach the report -- three of these "
            f"were cited as evidence in Goal 27.")
    return score


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


def fit_view(objects, look_at, direction, lens, res=(1200, 1200), margin=1.06):
    """Distance at which the subject's PROJECTED extent fills the frame.

    fit_distance frames the bounding SPHERE, which is right for a compact
    object and wasteful for a long one. A cap is 269 mm front-to-back and
    142 mm tall, so its sphere is nearly two and a half times the height of its
    front silhouette, and the square-on views came out with the cap occupying
    about a third of the frame. Beside a reference photograph that fills its
    tile, that is not a comparison anybody can make.

    This measures the subject's real half-extents along the camera's own right
    and up axes and fits the tighter of the two.

    `direction` points FROM the camera TOWARD the subject.
    """
    d = Vector(direction).normalized()
    right = d.cross(Vector((0.0, 0.0, 1.0)))
    if right.length < 1e-6:
        right = Vector((1.0, 0.0, 0.0))
    right.normalize()
    up = right.cross(d).normalized()
    c = Vector(look_at)
    hw = hh = 1e-6
    for ob in objects:
        if ob.type != "MESH":
            continue
        mw = ob.matrix_world
        for v in ob.data.vertices:
            r = (mw @ v.co) - c
            hw = max(hw, abs(r.dot(right)))
            hh = max(hh, abs(r.dot(up)))
    # Blender fits the 36 mm sensor to the LONGER image axis.
    half_long = math.atan(18.0 / lens)
    ratio = min(res) / float(max(res))
    half_short = math.atan(math.tan(half_long) * ratio)
    half_x = half_long if res[0] >= res[1] else half_short
    half_y = half_short if res[0] >= res[1] else half_long
    return max(hw * margin / math.tan(half_x), hh * margin / math.tan(half_y))


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

    # A camera BELOW the backdrop sees nothing but the back of the backdrop.
    # Hiding it is what an under-view wanted in the first place -- the point of
    # the shot is the object's underside, and the floor was never the subject.
    floor = bpy.data.objects.get("Backdrop")
    was_hidden = None
    if floor is not None and cam.location.z < floor.location.z:
        was_hidden = floor.hide_render
        floor.hide_render = True
        print(f"  (backdrop hidden: {os.path.basename(path)} is shot from "
              f"{(floor.location.z - cam.location.z) * 1000:.0f} mm below it)")
    try:
        bpy.ops.render.render(write_still=True)
    finally:
        if was_hidden is not None:
            floor.hide_render = was_hidden

    score = assert_frame_has_subject(path)
    print(f"  rendered {os.path.basename(path)}  (edge {score:.0f})")
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


def drop_to_floor(objects, clearance=0.0):
    """Put the asset's BASE at z = 0 before the axis bake.

    Every prop the game loads sits with its base on the ground: measured, the
    in-game rake, hose, spreader and mower all have min height exactly 0. The
    hero exports straddle the origin instead -- only 6 of 39 have a base at
    zero -- so dropping one into the world as-is buries it to the waist. That
    is the single systematic thing standing between these assets and being
    wireable, and it is here rather than in the game because the convention is
    the exporter's job.

    Call it IMMEDIATELY BEFORE bake_gltf_axis, on the same object list.

    SOCKETS MOVE TOO. An empty has no vertices to translate, so its location
    takes the shift -- exactly as bake_gltf_axis has to do for the axis swap.
    Shifting the mesh and not the socket would put the hand where the tool used
    to be, which is the fault that function's comment already warns about.
    """
    zs = []
    for ob in objects:
        if ob.type == "MESH":
            mw = ob.matrix_world
            zs.extend((mw @ v.co).z for v in ob.data.vertices)
    if not zs:
        raise SystemExit("BUILD FAILED: drop_to_floor: no mesh vertices to "
                         "measure a base from")
    was = min(zs)
    drop = was - clearance
    for ob in objects:
        if ob.type == "MESH":
            # MEASURE IN WORLD, SHIFT IN LOCAL -- and they are not the same
            # thing the moment an object carries a rotation or a scale. The
            # first version subtracted `drop` straight off v.co.z, which is
            # local, and the rake still shipped with its base 48.9 mm under the
            # floor while this function printed "now 0.0". A part built with
            # HS.cylinder(rotation=...) has a non-identity matrix_world and its
            # local z is not the world's.
            #
            # v_world' = M @ v_local + d, so v_local' = v_local + M^-1 @ d.
            local = ob.matrix_world.inverted().to_3x3() @ Vector((0.0, 0.0, -drop))
            for v in ob.data.vertices:
                v.co += local
            ob.data.update()
        else:
            ob.location = Vector((ob.location.x, ob.location.y,
                                  ob.location.z - drop))

    # AND CHECK IT. This function reported success while being wrong, which is
    # the one thing an instrument must not do.
    now = []
    for ob in objects:
        if ob.type == "MESH":
            mw = ob.matrix_world
            now.extend((mw @ v.co).z for v in ob.data.vertices)
    got = min(now)
    if abs(got - clearance) > 1e-5:
        raise SystemExit(
            f"BUILD FAILED: drop_to_floor asked for a base at "
            f"{clearance * 1000:.1f} mm and got {got * 1000:+.3f} mm")
    print(f"  dropped to floor: base was {was * 1000:+.1f} mm, now "
          f"{got * 1000:.1f} mm (verified)")
    return drop


def _part_bounds(objs):
    """World bounds per part, keyed by name with any .001 suffix removed."""
    # THE EVALUATED MESH, not the raw one. export_apply=True means the exporter
    # writes the mesh with its MODIFIERS ON, so measuring ob.data.vertices
    # compares the file against geometry that was never in it. The lane head's
    # Reg_TermBody came out 1.71 mm adrift on nothing worse than a live bevel,
    # which is the tell: a scramble is hundreds of millimetres, a modifier is
    # one or two.
    dg = bpy.context.evaluated_depsgraph_get()
    out = {}
    for ob in objs:
        if ob.type != "MESH":
            continue
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        if not me.vertices:
            ev.to_mesh_clear()
            continue
        mw = ob.matrix_world
        pts = [mw @ v.co for v in me.vertices]
        ev.to_mesh_clear()
        out[re.sub(r"[.]\d{3}$", "", ob.name)] = (
            Vector((min(q.x for q in pts), min(q.y for q in pts),
                    min(q.z for q in pts))),
            Vector((max(q.x for q in pts), max(q.y for q in pts),
                    max(q.z for q in pts))))
    return out


def bake_gltf_axis(objects):
    """Blender +Y -> glTF -Z, established by marker probe off exported accessor
    bounds. Baked into the VERTICES, never left as an object rotation: the
    exporter reports nodeRot null because it bakes transforms, and the runtime
    swap takes geometry only, so anything at node level is silently dropped.

        (x, y, z)_blender  ->  (x, z, -y)_gltf
    """
    global _PRE_BAKE
    _PRE_BAKE = {
        "parts": _part_bounds([o for o in objects if o.type == "MESH"]),
        "socks": {o.name: o.matrix_world.translation.copy()
                  for o in objects if o.type == "EMPTY"},
    }

    # FLATTEN THE OBJECT TRANSFORM FIRST, or the permutation is only half done.
    #
    # This function used to permute the VERTICES and leave each object's own
    # matrix alone, and the exporter writes that matrix through unchanged. So
    # any part with a non-identity transform shipped with its geometry in the
    # new convention and its position still in the old one. The bunker rake's
    # grip sits at (0, -0.7481, 0.8463) and went out 748 mm BELOW the origin
    # instead of 846 mm along it: 1,750 mm tall in the file against 970 mm in
    # the scene.
    #
    # Nothing caught it for the length of this project because every assertion
    # and every render looks at the BLENDER SCENE, and the GLB is written last
    # and never read again. Correct frames, passing checks, wrong file.
    #
    # build_rack and build_register worked around it with a transform_apply
    # before calling this. Doing it HERE fixes all 25 builders at once and
    # cannot be forgotten by the next one, which is the whole reason it is here
    # rather than in another 23 call sites.
    for ob in objects if BAKE_TRANSFORMS else ():
        if ob.type != "MESH":
            continue
        if ob.data.users > 1:
            raise SystemExit(
                f"BUILD FAILED: bake_gltf_axis: {ob.name} shares its mesh data "
                f"with {ob.data.users - 1} other object(s), so baking its "
                f"transform into the vertices would move them too. Make it "
                f"single-user before exporting.")
        mw = ob.matrix_world.copy()
        if (mw - Matrix.Identity(4)).to_3x3().determinant() != 0.0 or                 mw.translation.length > 0.0:
            for v in ob.data.vertices:
                v.co = mw @ v.co
            ob.matrix_world = Matrix.Identity(4)
            ob.data.update()

    for ob in objects:
        if ob.type == "EMPTY":
            # A SOCKET has no vertices to bake the swap into, so its LOCATION
            # takes it instead. Skipping non-meshes here (which this function
            # used to do) leaves every socket in Blender space while the mesh
            # around it moves -- the hand would close on empty air, which is
            # the exact fault this part exists to kill.
            # WORLD location, for the same reason the meshes are flattened.
            x, y, z = ob.matrix_world.translation
            ob.matrix_world = Matrix.Identity(4)
            ob.location = Vector((x, z, -y))
            continue
        if ob.type != "MESH":
            continue
        for v in ob.data.vertices:
            x, y, z = v.co
            v.co = Vector((x, z, -y))
        ob.data.update()


EXPORT_TOL = 2e-4          # 0.2 mm, well under anything that reads

# Switched off ONLY by control_export_roundtrip.py, to reproduce the fault the
# round-trip check exists to catch. A check that has never been watched failing
# is not a check.
BAKE_TRANSFORMS = True

# What the asset looked like BEFORE the axis swap, stashed by bake_gltf_axis so
# export_glb can check the written file against it. It has to be the PRE-bake
# scene: comparing against the post-bake scene compares the file with something
# that carries the very fault being looked for, and the two agree. The first
# version of the round-trip check did exactly that and passed a build with the
# transform bake switched off.
_PRE_BAKE = None


def export_glb(objects, path, verify=True):
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
    if verify:
        assert_export_faithful(objects, path)
    return path


def assert_export_faithful(objects, path, tol=EXPORT_TOL):
    """READ THE FILE BACK. The one check this pipeline never had.

    Every assertion here runs on the Blender scene and every render photographs
    it. The GLB is written last, and until now nothing ever looked at it again
    -- so an export that scrambled the asset was invisible to all of it. That
    is exactly what happened: the rake shipped 1,750 mm tall against a 970 mm
    scene, with correct frames and a full set of passing checks.

    So: re-import what was just written, put it back through the axis
    permutation, and compare it with what was meant to go out. They must be the
    same object. A builder that writes a scrambled GLB now fails its own build,
    the way one that writes a blank frame does.
    """
    # PER PART, not one bounding box over the lot.
    #
    # A box over the whole asset is blind to a part that moves INSIDE it: with
    # the transform bake off, the rake's grip is 846 mm out of place and the
    # whole-asset box shifts 2.54 mm, because the grip is small and stays
    # within what the shaft and head already describe.
    #
    # And the comparison is against the PRE-BAKE scene, captured by
    # bake_gltf_axis. The importer undoes the axis swap on its way in, so a
    # faithful file comes back exactly where the asset started.
    if _PRE_BAKE is None:
        raise SystemExit(
            "BUILD FAILED: assert_export_faithful ran with nothing stashed -- "
            "bake_gltf_axis must be called on these objects first, or there "
            "is nothing to compare the file against.")
    # ONLY THE PARTS THIS CALL IS EXPORTING. A builder may bake once and then
    # write several files out of the same scene -- build_merch does exactly
    # that, five sets in one pass -- and the stash then holds every part in the
    # scene. Comparing all of them against one file reports the other four
    # sets' parts as "missing", which is what it did: thirteen bottles, cans
    # and snack bags declared absent from merch_golf_balls.glb. The file was
    # fine; the check was asking the wrong question.
    mine = {re.sub(r"[.]\d{3}$", "", o.name)
            for o in objects if o.type == "MESH"}
    want = {n: b for n, b in _PRE_BAKE["parts"].items() if n in mine}
    want_socks = {n: q for n, q in _PRE_BAKE["socks"].items()
                  if n in {o.name for o in objects if o.type == "EMPTY"}}
    if not want:
        raise SystemExit(
            f"BUILD FAILED: nothing this export writes was in the pre-bake "
            f"stash for {os.path.basename(path)} -- bake_gltf_axis was called "
            f"on a different set of objects, so the file is unverified.")

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    fresh = [o for o in bpy.data.objects if o not in before]
    try:
        got = _part_bounds([o for o in fresh if o.type == "MESH"])
        got_socks = {}
        for ob in fresh:
            if ob.type == "EMPTY":
                # THE ORIGINALS ARE STILL IN THE SCENE, so Blender hands the
                # re-imported copies ".001" and a plain name match finds
                # nothing. The first run reported both of the rake's sockets
                # missing from a file that has them.
                base = re.sub(r"[.]\d{3}$", "", ob.name)
                if base in want_socks:
                    got_socks[base] = ob.matrix_world.translation.copy()
        if not got:
            raise SystemExit(
                f"BUILD FAILED: {os.path.basename(path)} came back with no "
                f"mesh parts at all")

        worst, worst_name = 0.0, ""
        absent = []
        for name, (lo, hi) in want.items():
            if name not in got:
                absent.append(name)
                continue
            glo, ghi = got[name]
            d = max(abs(glo.x - lo.x), abs(ghi.x - hi.x), abs(glo.y - lo.y),
                    abs(ghi.y - hi.y), abs(glo.z - lo.z), abs(ghi.z - hi.z))
            if d > worst:
                worst, worst_name = d, name
        drift = {n: (got_socks[n] - q).length
                 for n, q in want_socks.items() if n in got_socks}
        missing = [n for n in want_socks if n not in got_socks]

        if worst > tol or missing or absent or any(d > tol for d in drift.values()):
            NL = chr(10)
            msg = [
                f"BUILD FAILED: {os.path.basename(path)} is not the asset "
                f"that was built. Worst part '{worst_name}' moved "
                f"{worst * 1000:.2f} mm (limit {tol * 1000:.2f}), over "
                f"{len(want)} parts.",
            ]
            if absent:
                msg.append(f"  parts missing from the file: {absent}")
            if missing:
                msg.append(f"  sockets missing from the file: {missing}")
            far = {n: round(d * 1000, 2) for n, d in drift.items() if d > tol}
            if far:
                msg.append(f"  sockets that moved (mm): {far}")
            raise SystemExit(NL.join(msg))
        print(f"  round trip faithful: {len(want)} parts, worst "
              f"{worst * 1000:.3f} mm"
              + (f", {len(drift)} socket(s) exact" if drift else ""))
        return worst
    finally:
        for ob in fresh:
            bpy.data.objects.remove(ob, do_unlink=True)


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


def named_root(name, objects):
    """A named parent node for a pushed tool.

    The mower and the spreader currently export with NO root: their parts land
    directly under `Scene`, which is the same naming gap that made Tool_rake
    unfindable for two sessions. A tool the code cannot name is a tool the code
    cannot place.
    """
    root = bpy.data.objects.new(name, None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 0.08
    bpy.context.collection.objects.link(root)
    for ob in objects:
        ob.parent = root
        ob.matrix_parent_inverse = root.matrix_world.inverted()
    return root


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
