"""Lighting and retail staging for the v4 apparel.

Two things live here because both are judgements about PRESENTATION rather than
about any one garment.

The studio rig in hero_lib is built for hard-surface props: a bright key, a
strong fill and a strong rim, which is exactly right for reading the silhouette
of a rake and exactly wrong for cloth. Fill light is the enemy of drape -- a
fold is only visible because one flank of it is darker than the other, and a
38-watt fill 90 degrees off the key erases precisely that. Garments get a
harder key, a fill four times weaker, and a rim only strong enough to separate
them from the backdrop.

The rail is here because the brief is right that the isolated grey studio shot
is the flattering one. A garment on a rail beside its neighbours has to survive
being overlapped, being lit from above like a shop, and being seen at the angle
a customer walks past at.
"""

import math

import bpy
from mathutils import Vector


def _sweep(name, pts, halfw, halfh, sides=12, up=(0.0, 0.0, 1.0), cap=True):
    """A closed tube of elliptical section swept along a polyline."""
    import bmesh
    import drape as D
    rows = []
    for i, p in enumerate(pts):
        p = Vector(p)
        nxt = Vector(pts[min(len(pts) - 1, i + 1)])
        prv = Vector(pts[max(0, i - 1)])
        tan = nxt - prv
        tan = tan.normalized() if tan.length > 1e-9 else Vector((1, 0, 0))
        e1 = tan.cross(Vector(up))
        if e1.length < 1e-6:
            e1 = tan.cross(Vector((1, 0, 0)))
        e1.normalize()
        e2 = tan.cross(e1).normalized()
        rows.append([tuple(p + e1 * (halfw * math.cos(2 * math.pi * k / sides))
                           + e2 * (halfh * math.sin(2 * math.pi * k / sides)))
                     for k in range(sides)])
    ob = D.grid_mesh(name, rows, wrap_u=True)
    if cap:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.to_mesh(ob.data)
        bm.free()
    return ob


def _join(name, parts):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    parts[0].name = name
    return parts[0]


def top_hanger(half_w=0.212, z=0.0, drop=0.052, y=0.0, hook_h=0.086,
               name="hanger"):
    """The BLACK MOULDED HANGER every reference board hangs a top on.

    Not a wire. All four reference boards -- hoodie, polo, tee and the retail
    racks behind them -- use the same shop hanger: a moulded shoulder bar,
    deep and square in section at the middle, tapering and turning up at the
    tips, with a short neck post and a chrome hook. A 9 mm wire tube reads as
    a coat hanger from a hotel wardrobe and it was the one part of every hung
    render that was visibly not shop stock.

    The shoulder bar's TOP edge is what the garment lies on, so `z` is that
    line at centre and the bar drops `drop` to the tips.
    """
    import drape as D
    prof = []
    N = 30
    for i in range(N + 1):
        u = -1.0 + 2.0 * i / N
        e = abs(u)
        # the tips turn UP again in the last eighth, the way a moulded
        # hanger's shoulder tip does
        dz = -drop * (e ** 1.22) + drop * 0.14 * D._smooth(e, 0.84, 1.0)
        prof.append(Vector((u * half_w, y, z + dz)))
    # section: 26 mm tall at the middle, 13 at the tips, 12 mm front-to-back
    rows = []
    SIDES = 14
    for i, p in enumerate(prof):
        e = abs(-1.0 + 2.0 * i / N)
        hh = 0.5 * (0.0250 - 0.0126 * e ** 1.5)
        hw = 0.5 * 0.0122
        nxt = prof[min(N, i + 1)]
        prv = prof[max(0, i - 1)]
        tan = (nxt - prv)
        tan = tan.normalized() if tan.length > 1e-9 else Vector((1, 0, 0))
        e2 = Vector((0.0, 1.0, 0.0))
        e1 = e2.cross(tan).normalized()
        # sit the bar so its TOP edge follows the profile line
        c = p - e1 * hh
        row = []
        for k in range(SIDES):
            a = 2 * math.pi * k / SIDES
            # a rounded rectangle, not an ellipse -- the section is flat
            sx, sy = math.cos(a), math.sin(a)
            row.append(tuple(c
                             + e1 * (hh * math.copysign(abs(sx) ** 0.55, sx))
                             + e2 * (hw * math.copysign(abs(sy) ** 0.55, sy))))
        rows.append(row)
    bar = D.grid_mesh(name + "_bar", rows, wrap_u=True)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(bar.data)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(bar.data)
    bm.free()
    D.shade_smooth(bar, 42.0)

    post = _sweep(name + "_post",
                  [Vector((0.0, y, z - 0.004)), Vector((0.0, y, z + 0.014)),
                   Vector((0.0, y, z + 0.030))], 0.0062, 0.0050, sides=12)
    D.shade_smooth(post, 40.0)
    body = _join(name, [bar, post])
    body.data.materials.append(matte("HangerBody", (0.0190, 0.0195, 0.0215),
                                     rough=0.44))

    hp = [Vector((0.0, y, z + 0.026)), Vector((0.0, y, z + 0.040))]
    for i in range(19):
        a = math.pi * 1.16 * (i / 18.0) - 0.10
        hp.append(Vector((0.0215 * math.sin(a) * 0.90, y - 0.0016,
                          z + hook_h - 0.0215 * math.cos(a) * 0.92)))
    hook = _sweep(name + "_hook", hp, 0.0028, 0.0028, sides=10)
    D.shade_smooth(hook, 40.0)
    hook.data.materials.append(metal("HangerHook", (0.74, 0.75, 0.78), 0.19))
    return body, hook


def clamp_hanger(half_w=0.178, z=0.0, y=0.0, grip=0.150, hook_h=0.090,
                 name="clamphanger"):
    """The trouser hanger: a flat black bar with two sprung clamps.

    The hung-trousers board shows the waistband GRIPPED, not draped over a
    rail -- the bar sits above the waistband and two clamps bite it at the
    hips. Draping the waistband over a round bar (what the first cut did) is
    how a towel hangs, and it left the trousers reading as a folded pair of
    legs rather than as stock on a rack.
    """
    import drape as D
    parts = []
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    bar = bpy.context.object
    bar.name = name + "_bar"
    bar.scale = (half_w, 0.0062, 0.0112)
    bar.location = (0.0, y, z)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    _bevel(bar, 0.0020, 3)
    D.shade_smooth(bar, 40.0)
    parts.append(bar)

    for sx in (-1, 1):
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        jaw = bpy.context.object
        jaw.name = "%s_jaw%+d" % (name, sx)
        jaw.scale = (0.0215, 0.0125, 0.0210)
        jaw.location = (sx * grip, y, z - 0.0245)
        bpy.ops.object.transform_apply(location=True, rotation=True,
                                       scale=True)
        _bevel(jaw, 0.0022, 3)
        D.shade_smooth(jaw, 40.0)
        parts.append(jaw)
    body = _join(name, parts)
    body.data.materials.append(matte("ClampBody", (0.0190, 0.0195, 0.0215),
                                     rough=0.44))

    springs = []
    for sx in (-1, 1):
        # a small spring pin, not a chrome bar. At 30 mm long and 5 mm across
        # these rendered as two white blocks either side of the waistband and
        # were the brightest thing in the frame.
        bpy.ops.mesh.primitive_cylinder_add(
            radius=0.0030, depth=0.0126, vertices=12,
            rotation=(0.0, math.pi / 2, 0.0),
            location=(sx * grip, y - 0.0104, z - 0.0155))
        s = bpy.context.object
        s.name = "%s_spring%+d" % (name, sx)
        D.shade_smooth(s, 40.0)
        springs.append(s)
    hp = [Vector((0.0, y, z + 0.008)), Vector((0.0, y, z + 0.024))]
    for i in range(19):
        a = math.pi * 1.16 * (i / 18.0) - 0.10
        hp.append(Vector((0.0215 * math.sin(a) * 0.90, y - 0.0016,
                          z + hook_h - 0.0215 * math.cos(a) * 0.92)))
    springs.append(_sweep(name + "_hook", hp, 0.0028, 0.0028, sides=10))
    D.shade_smooth(springs[-1], 40.0)
    steel = _join(name + "_steel", springs)
    steel.data.materials.append(metal("ClampSteel", (0.74, 0.75, 0.78), 0.19))
    return body, steel


def _bevel(ob, offset, segments=3):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=offset,
                    segments=segments, affect='EDGES')
    bm.to_mesh(ob.data)
    bm.free()


def slatwall(y, z_mid, name="Slatwall", value=0.30, rows=9, pitch=0.076):
    """The shop wall the cap-peg board hangs its pegs on.

    A flat plane is not a shop wall. Slatwall is the fixture every cap display
    in the reference is mounted to, and its horizontal aluminium-lipped
    grooves are most of what tells the eye this is retail and not a studio.
    """
    import drape as D
    bpy.ops.mesh.primitive_plane_add(size=6.0, rotation=(math.pi / 2, 0, 0),
                                     location=(0, y, z_mid))
    face = bpy.context.object
    face.name = name
    face.data.materials.append(matte(name + "Panel",
                                     (value, value * 0.995, value * 0.985),
                                     rough=0.72))
    grooves = []
    for r in range(rows):
        gz = z_mid + (r - (rows - 1) * 0.5) * pitch
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        g = bpy.context.object
        g.name = "%s_groove%d" % (name, r)
        g.scale = (3.0, 0.0090, 0.0062)
        g.location = (0.0, y - 0.0044, gz)
        bpy.ops.object.transform_apply(location=True, rotation=True,
                                       scale=True)
        D.shade_smooth(g, 34.0)
        grooves.append(g)
    rail = _join(name + "_rails", grooves)
    rail.data.materials.append(metal(name + "Insert", (0.62, 0.63, 0.65),
                                     0.22))
    return [face, rail]


def _area(name, loc, look_at, energy, size, colour=(1, 1, 1)):
    d = bpy.data.lights.new(name, type='AREA')
    d.energy = energy
    d.size = size
    d.color = colour
    ob = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    direction = Vector(look_at) - Vector(loc)
    ob.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    return ob


def exposure(ev=0.60):
    """Undo hero_lib's prop exposure.

    `hero_lib.set_engine` ends with `view_settings.exposure = -0.9`, set so a
    white-plastic prop would not clip. Navy fleece has a linear albedo around
    0.03: nearly a stop under AgX, which already crushes the low end, it
    renders as black with a rim on it. The first ten comparison sheets were all
    dark for this reason and it read as ten separate material faults.

    ONE STOP CANNOT SERVE THE WHOLE RAIL. The set runs from 0.03 navy to 0.54
    off-white -- four and a quarter stops of albedo. Opening up far enough to
    see the hoodie turned the maroon cap into dusty pink. A shop photographs a
    black hoodie and a white tee at different stops too, so each garment picks
    its own here.

    Garments call this AFTER set_engine.
    """
    bpy.context.scene.view_settings.exposure = ev


def garment_lights(centre=(0, 0, 0), scale=1.0, warm=False):
    """A key you can see the folds by, and enough of it for a dark colour."""
    c = Vector(centre)
    s = max(0.25, scale)
    k = (1.0, 0.965, 0.92) if warm else (1, 1, 1)
    _area("key", c + Vector((-1.55, -2.05, 1.85)) * s, c,
          energy=142.0 * s * s, size=1.5 * s, colour=k)
    # a QUARTER of hero_lib's fill. Cloth needs the shadow side to stay dark.
    _area("fill", c + Vector((2.30, -1.35, 0.30)) * s, c,
          energy=11.0 * s * s, size=3.0 * s, colour=(0.90, 0.93, 1.0))
    _area("rim", c + Vector((0.85, 2.45, 1.55)) * s, c,
          energy=52.0 * s * s, size=1.1 * s, colour=(0.94, 0.96, 1.0))
    # A shop lights its stock from the ceiling. Without this the top of a
    # folded stack is the darkest part of it, which no shop photograph shows.
    _area("top", c + Vector((-0.25, -0.10, 2.60)) * s, c,
          energy=46.0 * s * s, size=2.6 * s, colour=(1.0, 0.985, 0.96))
    _area("under", c + Vector((0.0, -1.20, -1.75)) * s, c,
          energy=6.0 * s * s, size=2.4 * s, colour=(0.92, 0.94, 1.0))


def world_value(v=0.028):
    w = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (v, v, v * 1.12, 1.0)
        bg.inputs[1].default_value = 1.0


def matte(name, colour, rough=0.86):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Roughness"].default_value = rough
    return m


def metal(name, colour=(0.72, 0.73, 0.76), rough=0.24):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Metallic"].default_value = 1.0
    b.inputs["Roughness"].default_value = rough
    return m


def rail(z, x0=-1.15, x1=1.15, r=0.016, y=0.0):
    """A chrome hanging rail with two uprights."""
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=(x1 - x0), vertices=20,
                                        rotation=(0, math.pi / 2, 0),
                                        location=((x0 + x1) / 2, y, z))
    bar = bpy.context.object
    bar.name = "rail"
    bar.data.materials.append(metal("RailChrome"))
    posts = []
    for x in (x0 + 0.02, x1 - 0.02):
        bpy.ops.mesh.primitive_cylinder_add(radius=r * 0.72, depth=0.62,
                                            vertices=16,
                                            location=(x, y, z + 0.31))
        p = bpy.context.object
        p.name = f"post{len(posts)}"
        p.data.materials.append(metal("RailChrome2"))
        posts.append(p)
    return [bar] + posts


def shop_floor(z, value=0.115):
    bpy.ops.mesh.primitive_plane_add(size=14.0, location=(0, 0, z))
    f = bpy.context.object
    f.name = "ShopFloor"
    f.data.materials.append(matte("ShopFloor", (value, value * 0.98,
                                                value * 0.94), rough=0.55))
    return f


def shop_wall(y, z, value=0.16):
    bpy.ops.mesh.primitive_plane_add(size=14.0, rotation=(math.pi / 2, 0, 0),
                                     location=(0, y, z + 3.0))
    w = bpy.context.object
    w.name = "ShopWall"
    w.data.materials.append(matte("ShopWall", (value * 1.02, value,
                                               value * 0.95), rough=0.88))
    return w


def duplicate_along(objs, offsets, rot_jitter=0.0, scale_jitter=0.0):
    """Copies of a garment down a rail.

    Every neighbour is the same mesh turned and nudged -- which is what a rail
    of one style in one size actually looks like, and it is the only way to see
    whether the asset survives being overlapped by its own kind.
    """
    out = []
    for i, (dx, dy, dz) in enumerate(offsets):
        rot = rot_jitter * math.sin(i * 2.399 + 0.7)
        sc = 1.0 + scale_jitter * math.sin(i * 1.771 + 1.3)
        for ob in objs:
            c = ob.copy()
            c.data = ob.data
            bpy.context.collection.objects.link(c)
            c.location = (ob.location.x + dx, ob.location.y + dy,
                          ob.location.z + dz)
            c.rotation_euler = (0.0, 0.0, rot)
            c.scale = (sc, sc, sc)
            out.append(c)
    return out
