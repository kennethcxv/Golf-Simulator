"""v5 apparel: the BRIGHT retail studio Image1.png is shot in, plus crisping.

Two things live here and both are about the reference rather than about any one
garment.

THE LIGHT. v4 used a dark studio on purpose -- a hard key and a fill four times
weaker, because "fill light is the enemy of drape". That is true when the subject
is a draped garment photographed for its folds, and Image1.png is not that. It is
a near-white cell with a garment sitting in it, lit so evenly that the darkest
part of the slate-blue sweater is a little over half the value of the brightest,
with no black side and no visible key direction beyond a gentle top-left bias.
The whole v4 rail read muddy beside it, and the cause is the lighting rig, not
ten separate material faults. So: a bright bounce environment, a broad soft key,
a real fill, and a backdrop that goes to near-white.

THE CRISPING. `shade_smooth(ob, 70)` was on every v4 garment, and 70 degrees is
past every fold a garment has -- so every crease the solver produced was averaged
out of the normals and what was left was uniform roundness. That single number is
most of the "memory foam" read. Here nothing gets a smoothing angle above 32, and
`crisp()` additionally runs a limited dissolve so that a region which really is
flat becomes ONE flat n-gon instead of a hundred quads with rounding error
between them. Flat panels, crisp lines between them: that is the reference's
construction language and it is a topology property, not a shader one.
"""

import math
import os

import bpy
import bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(HERE))))


def out_dir(*parts):
    """An ABSOLUTE output path under the repo.

    Blender resolves a relative `render.filepath` against the blend file, and
    these scripts run with no blend file -- so "qa/hero/v5/..." landed in
    C:\\qa\\hero\\v5 and hero_lib's own frame check then failed to read back the
    file it had just written.
    """
    p = os.path.join(ROOT, *parts)
    os.makedirs(p, exist_ok=True)
    return p


# ---------------------------------------------------------------------------
# light


def _drop(name):
    """Remove an existing object of this name before making another.

    Blender renames a collision to `key.001` and lights it anyway, so calling
    retail_light twice in one script silently DOUBLES the rig -- ten lamps and
    two backdrops. The driver's head close-ups came back two stops blown with a
    white card floating in mid-frame, and nothing said so: the exposure looked
    like a material bug and cost a round chasing near-black materials that were
    correct all along.
    """
    ob = bpy.data.objects.get(name)
    if ob is not None:
        bpy.data.objects.remove(ob, do_unlink=True)


def _area(name, loc, look_at, energy, size, colour=(1, 1, 1), shape='SQUARE',
          size_y=None):
    _drop(name)
    d = bpy.data.lights.new(name, type='AREA')
    d.energy = energy
    d.size = size
    if size_y is not None:
        d.shape = 'RECTANGLE'
        d.size_y = size_y
    d.color = colour
    ob = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    direction = Vector(look_at) - Vector(loc)
    ob.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    return ob


LIGHTS = ("key", "fill", "top", "bounce", "cyc_wash")
SET = ("Cyc", "CycFloor") + LIGHTS
# the rig's offsets from the subject, filled in by retail_light so aim_lights can
# turn the whole set with the camera
_RIG = {}


def retail_light(centre=(0, 0, 0), scale=1.0):
    """The reference's light: soft, bright, and nearly shadowless.

    Measured off Image1.png rather than guessed. On the slate sweater the lit
    shoulder is 0.62 sRGB and the shaded flank 0.44 -- about two thirds of a
    stop, where v4's rig gave four. Getting that means the environment does most
    of the work and the key only tips it, which is why `world_value` here is an
    order of magnitude above hero_lib's 0.045 and the fill is not a quarter of
    the key but two thirds of it.
    """
    c = Vector(centre)
    s = max(0.25, scale)
    p = s * s
    _RIG.clear()
    for nm, off in (("key", (-1.15, -1.75, 1.60)), ("fill", (1.80, -1.30, 0.35)),
                    ("top", (-0.15, -0.20, 2.40)),
                    ("bounce", (0.10, -0.95, -1.55)),
                    ("cyc_wash", (0.0, -0.30, 0.10))):
        _RIG[nm] = tuple(v * s for v in off)
    _area("key", c + Vector((-1.15, -1.75, 1.60)) * s, c,
          energy=124.0 * p, size=2.2 * s, colour=(1.0, 0.992, 0.978))
    _area("fill", c + Vector((1.80, -1.30, 0.35)) * s, c,
          energy=44.0 * p, size=3.2 * s, colour=(0.965, 0.978, 1.0))
    _area("top", c + Vector((-0.15, -0.20, 2.40)) * s, c,
          energy=74.0 * p, size=3.0 * s, colour=(1.0, 0.995, 0.985))
    _area("bounce", c + Vector((0.10, -0.95, -1.55)) * s, c,
          energy=26.0 * p, size=3.2 * s, colour=(0.98, 0.985, 1.0))
    # washes the card behind the subject so the background goes to paper white
    # instead of to the mid grey a lit plane naturally lands on
    _area("cyc_wash", c + Vector((0.0, -0.30, 0.10)) * s,
          c + Vector((0.0, 3.0, 0.0)) * s,
          energy=54.0 * p, size=3.4 * s, colour=(1.0, 1.0, 1.0))


def aim_lights(centre, azimuth_deg):
    """Turn the whole rig with the camera.

    Every lamp sits on the -y side, which is right for a front view and turns the
    BACK view into a silhouette -- the polo's back render came out as a dark
    shape with a rim on it, and the same would be true of all ten. A product
    photographer moves the lights round with the camera rather than shooting one
    side of a fixed set, and the reference's cells are evenly lit from wherever
    they are seen. The offsets are the ones `retail_light` built with; only their
    bearing changes.
    """
    a = math.radians(azimuth_deg + 90.0)
    c, s = math.cos(a), math.sin(a)
    cen = Vector(centre)
    for name, off in _RIG.items():
        ob = bpy.data.objects.get(name)
        if ob is None:
            continue
        o = Vector(off)
        p = cen + Vector((o.x * c - o.y * s, o.x * s + o.y * c, o.z))
        ob.location = p
        aim = cen
        if name == "cyc_wash":
            d = (cen - p)
            d.z = 0.0
            aim = cen - d * 3.0
        ob.rotation_euler = (aim - p).to_track_quat('-Z', 'Y').to_euler()


def world_value(v=0.34):
    w = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (v, v, v * 1.005, 1.0)
        bg.inputs[1].default_value = 1.0


def exposure(ev=0.10):
    """`hero_lib.set_engine` leaves this at -0.9 for white-plastic props.

    A bright studio needs far less of that correction than a dark one did, but
    the set still runs from a near-black cap lining to an off-white tee, so each
    garment picks its own stop. The number here is stops relative to AgX's
    default, not an absolute.
    """
    bpy.context.scene.view_settings.exposure = ev


def cyc(centre=(0, 0, 0), scale=1.0, value=0.84):
    """A white card behind and below -- the reference's ground.

    Not a mid-grey backdrop. Every cell of Image1.png is paper white with a soft
    contact shadow, and against 0.16 grey a cream polo has nothing to be cream
    against. The floor is a separate plane so a folded garment can sit ON
    something while a hung one has the card only behind it.
    """
    c = Vector(centre)
    d = max(0.6, scale * 7.0)
    _drop("Cyc")
    _drop("CycFloor")
    bpy.ops.mesh.primitive_plane_add(size=d, rotation=(math.pi / 2, 0, 0),
                                     location=(c.x, c.y + scale * 2.1, c.z))
    back = bpy.context.object
    back.name = "Cyc"
    m = matte("CycCard", (value, value, value * 0.995), rough=0.90)
    back.data.materials.append(m)
    bpy.ops.mesh.primitive_plane_add(size=d, location=(c.x, c.y,
                                                      c.z - scale * 1.02))
    floor = bpy.context.object
    floor.name = "CycFloor"
    floor.data.materials.append(m)
    return [back, floor]


def aim_cyc(centre, scale, direction):
    """Put the white card BEHIND the subject for this camera.

    A fixed card at +y is behind the subject for a front view and in front of the
    lens for a back view -- the first back render was a photograph of the back of
    the backdrop, and hero_lib's own blank-frame guard caught it. The card
    follows the camera round.
    """
    back = bpy.data.objects.get("Cyc")
    if back is None:
        return
    d = Vector(direction).normalized()
    d.z = 0.0
    if d.length < 1e-6:
        d = Vector((0.0, 1.0, 0.0))
    d.normalize()
    c = Vector(centre)
    back.location = c + d * (scale * 2.1)
    back.rotation_euler = (-d).to_track_quat('Z', 'Y').to_euler()


def shots(subject, look, radius, out, plan, res=(900, 1150), margin=1.07):
    """Render the named views. `plan` is (tag, azimuth, elevation, lens)."""
    import hero_lib as H
    paths = []
    for tag, az, el, lens in plan:
        a, e = math.radians(az), math.radians(el)
        d = Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a),
                    math.sin(e)))
        aim_cyc(look, radius, -d)
        aim_lights(look, az)
        dist = H.fit_view(subject, look, -d, lens, res=res, margin=margin)
        cam = H.camera("cam_" + tag, Vector(look) + d * dist, look, lens=lens)
        paths.append(H.render(cam, os.path.join(out, "%s.png" % tag), res=res))
    return paths


# ---------------------------------------------------------------------------
# crisping: the part that stops cloth reading as foam


def smooth_by_angle(ob, angle=30.0):
    """Shade smooth, but keep any edge that turns more than `angle` HARD.

    v4 passed 70 here. A garment's sharpest real feature -- a pressed fold, a
    hem turn, the edge of a lapel -- turns between 35 and 90 degrees, so 70
    smoothed nearly all of them and the ones it kept it kept by accident. The
    default here is chosen to sit BELOW a fold and ABOVE the facet noise of a
    curved panel: 30 degrees means a fold is a line and a chest is smooth.
    """
    for p in ob.data.polygons:
        p.use_smooth = True
    mod = ob.modifiers.new("Smooth by Angle", 'NODES')
    ng = bpy.data.node_groups.get("Smooth by Angle")
    if ng is None:
        try:
            bpy.ops.object.select_all(action='DESELECT')
            ob.select_set(True)
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))
            ob.modifiers.remove(mod)
            return
        except Exception:
            ob.modifiers.remove(mod)
            return
    mod.node_group = ng
    for k in mod.keys():
        if k.startswith("Socket") or k.startswith("Input"):
            try:
                mod[k] = math.radians(angle)
            except Exception:
                pass


def flatten_panels(ob, angle=2.2):
    """Turn every genuinely flat region into ONE face.

    This is the geometric half of "flat panels with crisp folds". A limited
    dissolve at a couple of degrees cannot touch a fold -- a fold turns tens of
    degrees -- but it eats every interior edge of a panel that is actually
    planar. What comes out is large flat n-gons meeting at the fold lines, which
    is both the reference's construction language and, usefully, a third of the
    triangles.

    Run it AFTER the sim and BEFORE the shading angle.
    """
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    before = len(bm.faces)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(angle),
                             verts=bm.verts[:], edges=bm.edges[:],
                             use_dissolve_boundaries=False,
                             delimit={'NORMAL'})
    after = len(bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return before, after


def crease_edges(ob, angle=34.0):
    """Flag the fold lines SHARP on the mesh itself.

    Belt and braces with `smooth_by_angle`, which is a modifier and therefore
    only a render-time opinion: the sharp flag is mesh data and survives an
    export, a bevel and a join. A fold that exists only as a smoothing angle
    disappears the moment anything else touches the mesh.

    (The bmesh crease layer is gone in Blender 5.x -- creases moved to generic
    attributes -- and it was never the part that mattered here.)
    """
    n = 0
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    sharp = []
    for i, e in enumerate(bm.edges):
        if len(e.link_faces) != 2:
            continue
        try:
            a = e.calc_face_angle()
        except ValueError:
            continue
        if math.degrees(a) > angle:
            e.smooth = False
            sharp.append(i)
            n += 1
    bm.to_mesh(ob.data)
    bm.free()
    for i in sharp:
        if i < len(ob.data.edges):
            ob.data.edges[i].use_edge_sharp = True
    ob.data.update()
    return n


def crisp(ob, dissolve=2.2, sharp=30.0, crease=34.0):
    """The whole treatment, in the order that works."""
    b, a = flatten_panels(ob, dissolve)
    n = crease_edges(ob, crease)
    smooth_by_angle(ob, sharp)
    print("  crisp %-16s faces %d -> %d, %d fold edges marked"
          % (ob.name, b, a, n))
    return a


def bevel_edges(ob, offset=0.0013, segments=2, angle=32.0):
    """A SMALL radius on the fold lines only.

    The brief's first cause is uniform smoothing, and the fix is not zero
    rounding -- a zero-radius cloth edge aliases and reads as paper. It is
    rounding proportional to the CLOTH, applied only where the cloth actually
    turns. 1.3 mm on a 1 mm jersey is the width of the yarn at the fold. Every
    v4 asset had a 4 mm bevel on everything.
    """
    m = ob.modifiers.new("Bevel", 'BEVEL')
    m.width = offset
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.harden_normals = False
    m.miter_outer = 'MITER_ARC'
    return m


def apply_mods(ob):
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    return bpy.context.view_layer.objects.active


# ---------------------------------------------------------------------------
# materials


def matte(name, colour, rough=0.86, sheen=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Roughness"].default_value = rough
    if sheen and "Sheen Weight" in b.inputs:
        b.inputs["Sheen Weight"].default_value = sheen
        b.inputs["Sheen Roughness"].default_value = 0.45
    return m


def fabric(name, colour, rough=0.83, weave=0.0016, sheen=0.10, scale_mm=520.0,
           rib=0, rib_depth=0.0004, rib_angle=0.0, pique=0.0):
    """Cloth: a matte base, a little sheen, and grain at the scale of the yarn.

    The grain is a bump only. v4 also drove Base Color through a Mix for
    microvariation, which is what made every garment export WHITE -- the glTF
    writer emits baseColorFactor only for an unlinked constant. Keeping colour
    unlinked here means `flatten_for_export` has nothing to undo and the shipped
    garment is the colour it was rendered.

    `scale_mm` is the object's longest span in millimetres: TexNoise Scale is in
    GENERATED space, so one noise cell per millimetre is scale == span_mm.
    """
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Roughness"].default_value = rough
    if "Sheen Weight" in b.inputs:
        b.inputs["Sheen Weight"].default_value = sheen
        b.inputs["Sheen Roughness"].default_value = 0.42
        b.inputs["Sheen Tint"].default_value = (1.0, 1.0, 1.0, 1.0)
    prev = None
    if rib > 0 and pique > 0.0:
        # PIQUE IS A LATTICE, NOT A WALE. A polo is not jersey: the knit is a
        # honeycomb of small raised cells, and in the reference macro it is the
        # single most identifying thing about the cloth -- more than the colour
        # and more than the collar. One set of bands gives ribbing, which is
        # what a cuff has. TWO sets crossed give the cell.
        #
        # Multiplied, not added: two triangle waves summed make a diagonal
        # corduroy, because the sum is large along either band. The product is
        # only large where both are, which is the raised cell, and that is the
        # honest description of a knit where two yarn systems interlock.
        uvn = nt.nodes.new("ShaderNodeUVMap")
        legs = []
        for sgn in (-1.0, 1.0):
            mp = nt.nodes.new("ShaderNodeMapping")
            mp.inputs["Rotation"].default_value = (
                0.0, 0.0, math.radians(rib_angle + sgn * 45.0))
            nt.links.new(uvn.outputs["UV"], mp.inputs["Vector"])
            w = nt.nodes.new("ShaderNodeTexWave")
            w.wave_type = 'BANDS'
            w.bands_direction = 'X'
            w.wave_profile = 'TRI'
            w.inputs["Scale"].default_value = float(rib)
            w.inputs["Distortion"].default_value = 0.0
            w.inputs["Detail"].default_value = 0.0
            nt.links.new(mp.outputs["Vector"], w.inputs["Vector"])
            legs.append(w)
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = 'MULTIPLY'
        nt.links.new(legs[0].outputs["Fac"], mul.inputs[0])
        nt.links.new(legs[1].outputs["Fac"], mul.inputs[1])
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.80
        bump.inputs["Distance"].default_value = rib_depth * pique
        nt.links.new(mul.outputs["Value"], bump.inputs["Height"])
        prev = bump
    elif rib > 0:
        # A KNIT RIB, and it is a TRIANGLE wave, not a sine one.
        #
        # This is material, not a fold: the reference's knits show fine vertical
        # wales about 3 mm apart and that texture is most of what makes them read
        # as knitted rather than as painted. The brief bans harmonic terms added
        # to FAKE FOLDS, and a triangle profile is also the honest shape here --
        # a wale is two flat flanks meeting at a line, which is exactly what the
        # brief asks folds to be.
        #
        # Driven off UV, not Generated: in Generated space the pattern is a slice
        # through a 3-D volume normalised to the bounding box, so on a sleeve --
        # a thin diagonal part of a 900 mm box -- it smears along the sleeve's
        # axis. In UV space it follows the panel, which is what a wale does.
        uvn = nt.nodes.new("ShaderNodeUVMap")
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(rib_angle))
        nt.links.new(uvn.outputs["UV"], mp.inputs["Vector"])
        w = nt.nodes.new("ShaderNodeTexWave")
        w.wave_type = 'BANDS'
        w.bands_direction = 'X'
        w.wave_profile = 'TRI'
        w.inputs["Scale"].default_value = float(rib)
        w.inputs["Distortion"].default_value = 0.0
        w.inputs["Detail"].default_value = 0.0
        nt.links.new(mp.outputs["Vector"], w.inputs["Vector"])
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.55
        bump.inputs["Distance"].default_value = rib_depth
        nt.links.new(w.outputs["Fac"], bump.inputs["Height"])
        prev = bump
    if weave > 0.0:
        n = nt.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = scale_mm
        n.inputs["Detail"].default_value = 2.0
        n.inputs["Roughness"].default_value = 0.55
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.30
        bump.inputs["Distance"].default_value = weave
        nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
        if prev is not None:
            nt.links.new(prev.outputs["Normal"], bump.inputs["Normal"])
        prev = bump
    if prev is not None:
        nt.links.new(prev.outputs["Normal"], b.inputs["Normal"])
    return m


def wood(name, colour=(0.365, 0.242, 0.132), rough=0.42, span_mm=440.0):
    """The hanger. Image1.png hangs every top on a LIGHT WOOD hanger with a
    chrome hook -- not the black moulded shop hanger the previous board showed.
    Grain runs along the bar, so the noise is stretched on one axis."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Roughness"].default_value = rough
    if "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = 0.22
        b.inputs["Coat Roughness"].default_value = 0.24
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = span_mm * 0.30
    n.inputs["Detail"].default_value = 4.0
    map_ = nt.nodes.new("ShaderNodeMapping")
    map_.inputs["Scale"].default_value = (0.06, 1.0, 1.0)
    tex = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(tex.outputs["Generated"], map_.inputs["Vector"])
    nt.links.new(map_.outputs["Vector"], n.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.16
    bump.inputs["Distance"].default_value = 0.0008
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def chrome(name, colour=(0.78, 0.79, 0.81), rough=0.16):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Metallic"].default_value = 0.88
    b.inputs["Roughness"].default_value = rough
    return m


def flatten_for_export(objects, keep=()):
    """Put a real baseColorFactor back where a node chain drives Base Color.

    v5 keeps colour unlinked in `fabric` precisely so this has nothing to do,
    but it stays as a guard: this is the fault that shipped ten WHITE garments
    while every render was correct, and it is cheap to keep checking.
    """
    seen, fixed = set(), 0
    for ob in objects:
        if ob.type != "MESH":
            continue
        for mat in ob.data.materials:
            if mat is None or mat.name in seen or not mat.use_nodes:
                continue
            seen.add(mat.name)
            if mat.name in keep:
                continue
            nt = mat.node_tree
            bsdf = next((n for n in nt.nodes
                         if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf is None:
                continue
            sock = bsdf.inputs["Base Color"]
            if not sock.is_linked:
                continue
            src = sock.links[0].from_node
            cols = [i.default_value for i in src.inputs
                    if i.type == "RGBA" and not i.is_linked]
            if not cols:
                continue
            n = len(cols)
            avg = [sum(c[k] for c in cols) / n for k in range(3)]
            for link in list(sock.links):
                nt.links.remove(link)
            sock.default_value = (avg[0], avg[1], avg[2], 1.0)
            fixed += 1
    print("  export colour: %d of %d materials had a linked Base Color"
          % (fixed, len(seen)))
    return fixed


def no_white(objects):
    """Fail the build if a material would ship as untinted white."""
    bad = []
    for ob in objects:
        if ob.type != "MESH":
            continue
        for mat in ob.data.materials:
            if mat is None or not mat.use_nodes:
                continue
            b = next((n for n in mat.node_tree.nodes
                      if n.type == "BSDF_PRINCIPLED"), None)
            if b is None:
                continue
            c = b.inputs["Base Color"]
            if c.is_linked:
                if not any(n.type in ("TEX_IMAGE",)
                           for n in mat.node_tree.nodes):
                    bad.append(mat.name)
            elif min(c.default_value[:3]) > 0.90:
                bad.append(mat.name)
    if bad:
        raise SystemExit("BUILD FAILED: would ship white: %s" % sorted(set(bad)))
    return True


# ---------------------------------------------------------------------------
# geometry odds and ends


def join(name, parts):
    parts = [p for p in parts if p is not None]
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    parts[0].name = name
    return parts[0]


def clear_set():
    for n in SET:
        ob = bpy.data.objects.get(n)
        if ob is not None:
            bpy.data.objects.remove(ob, do_unlink=True)


def sweep(name, pts, halfw, halfh, sides=12, up=(0.0, 0.0, 1.0), cap=True,
          taper=None):
    """A closed tube of elliptical section swept along a polyline."""
    rows = []
    n = len(pts)
    for i, p in enumerate(pts):
        p = Vector(p)
        nxt = Vector(pts[min(n - 1, i + 1)])
        prv = Vector(pts[max(0, i - 1)])
        tan = nxt - prv
        tan = tan.normalized() if tan.length > 1e-9 else Vector((1, 0, 0))
        e1 = tan.cross(Vector(up))
        if e1.length < 1e-6:
            e1 = tan.cross(Vector((1, 0, 0)))
        e1.normalize()
        e2 = tan.cross(e1).normalized()
        k = 1.0 if taper is None else taper(i / max(1, n - 1))
        rows.append([tuple(p + e1 * (halfw * k * math.cos(2 * math.pi * j / sides))
                           + e2 * (halfh * k * math.sin(2 * math.pi * j / sides)))
                     for j in range(sides)])
    ob = grid(name, rows, wrap_u=True)
    if cap:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.to_mesh(ob.data)
        bm.free()
    return ob


def grid(name, rows, wrap_u=False, skip=None, uv=True):
    """`rows[v][u]` -> a quad mesh with a (u, v) UV map."""
    nv = len(rows)
    nu = len(rows[0])
    verts = [Vector(p) for row in rows for p in row]
    faces = []
    ulim = nu if wrap_u else nu - 1
    for v in range(nv - 1):
        for u in range(ulim):
            if skip is not None and skip(u, v):
                continue
            u2 = (u + 1) % nu
            faces.append((v * nu + u, v * nu + u2,
                          (v + 1) * nu + u2, (v + 1) * nu + u))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if uv and faces:
        lay = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            for li in poly.loop_indices:
                vi = me.loops[li].vertex_index
                lay.data[li].uv = ((vi % nu) / max(1, nu - 1),
                                   (vi // nu) / max(1, nv - 1))
    ob["nu"], ob["nv"] = nu, nv
    return ob


def box(name, centre, half, bevel=0.0, segments=2):
    """`half` is the HALF-extent, so a size-1 cube scales by twice it.

    Written as `2 * h * 0.5` first time round, which is h -- so every box in v5
    came out at half its intended size. The shelf under the folded tee was a
    150 mm coaster and the trouser clamp's bar was 8 mm deep, and both read as
    "the prop is too small" rather than as one arithmetic slip.
    """
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    ob = bpy.context.object
    ob.name = name
    ob.scale = tuple(2.0 * h for h in half)
    ob.location = centre
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if bevel > 0.0:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=bevel,
                        segments=segments, affect='EDGES')
        bm.to_mesh(ob.data)
        bm.free()
    return ob


def unwrap(ob, angle=64.0, margin=0.004):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    if not ob.data.uv_layers:
        ob.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle),
                             island_margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def tris(objs):
    n = 0
    for ob in objs:
        if ob.type != "MESH":
            continue
        for p in ob.data.polygons:
            n += max(0, len(p.vertices) - 2)
    return n
