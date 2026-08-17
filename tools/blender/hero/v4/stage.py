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


def garment_lights(centre=(0, 0, 0), scale=1.0, warm=False):
    """A key you can see the folds by."""
    c = Vector(centre)
    s = max(0.25, scale)
    k = (1.0, 0.965, 0.92) if warm else (1, 1, 1)
    _area("key", c + Vector((-1.55, -2.05, 1.85)) * s, c,
          energy=118.0 * s * s, size=1.5 * s, colour=k)
    # a QUARTER of hero_lib's fill. Cloth needs the shadow side to stay dark.
    _area("fill", c + Vector((2.30, -1.35, 0.30)) * s, c,
          energy=9.0 * s * s, size=3.0 * s, colour=(0.90, 0.93, 1.0))
    _area("rim", c + Vector((0.85, 2.45, 1.55)) * s, c,
          energy=42.0 * s * s, size=1.1 * s, colour=(0.94, 0.96, 1.0))
    _area("under", c + Vector((0.0, -1.20, -1.75)) * s, c,
          energy=5.0 * s * s, size=2.4 * s, colour=(0.92, 0.94, 1.0))


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
