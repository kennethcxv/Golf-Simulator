"""Gravity, and nothing else.

The cloth plumbing from v4 minus everything that faked a fold. There is no
`drape_folds` here and no harmonic term anywhere in v5 -- the only source of
curvature in a v5 garment is the solver acting on flat panels.

The presets are STIFFER than v4's by a wide margin and the solves are SHORT.
That is deliberate and it is measured off the reference rather than off physics:
a garment in Image1.png has been pressed and hung, and a pressed garment on a
hanger has two or three large soft creases and otherwise lies flat. v4 ran 150
frames of a floppy jersey and got a wet towel. What is wanted is the first
second of settling -- the hem finding level, the sleeve deciding which way to
hang, one diagonal crease from each shoulder -- and then stop.

`mass` is PER VERTEX in Blender's solver and does not scale with area, so these
numbers belong to a mesh of roughly this density (3-4 mm quads). Change the grid
and they move with it. That trap cost three rounds in v4.
"""

import bpy
from mathutils import Vector

PRESETS = {
    # cotton jersey, a tee: light, but pressed
    "jersey": dict(mass=0.050, tension=34.0, compression=34.0, shear=18.0,
                   bending=6.5, air=1.1),
    # pique, a polo: crisper again, holds a collar
    "pique": dict(mass=0.058, tension=44.0, compression=44.0, shear=26.0,
                  bending=11.0, air=1.1),
    # brushed-back fleece, a hoodie: heavy and thick, big soft folds
    "fleece": dict(mass=0.072, tension=52.0, compression=52.0, shear=32.0,
                   bending=22.0, air=1.2),
    # woven performance twill, trousers: holds a pressed crease
    "twill": dict(mass=0.068, tension=64.0, compression=64.0, shear=44.0,
                  bending=38.0, air=1.0),
}


def cloth(ob, preset, pin=None, quality=8, damping=2.6, self_dist=0.0028,
          mass=None, pin_stiffness=12.0, self_coll=False):
    """SELF-COLLISION OFF BY DEFAULT, and this is measured rather than assumed.

    A flat-pressed garment is two panels 27 mm apart joined by a rolled seam, and
    the roll's rows sit 3-4 mm apart. Blender's self-collision pushes apart any
    two elements closer than `self_distance_min`, which includes adjacent rows of
    that roll -- thousands of small repulsions all pointing outward along every
    seam, and their sum contracts the garment. Measured on the tee shell at
    44 frames:

        self-collision ON   sag -125 mm   width 776 mm   (drafted 906)
        self-collision OFF  sag   +5 mm   width 895 mm

    That is not a sag figure at all, it is a 14% shrink, and the sag number on
    its own hides it -- which is why the sweep printed both. Turn it on only for
    a garment whose parts genuinely rest on each other (a hoodie's sleeves, a
    fold), and then with a distance smaller than the seam's row pitch.
    """
    p = PRESETS[preset]
    m = ob.modifiers.new("Cloth", 'CLOTH')
    s = m.settings
    s.quality = quality
    s.mass = p["mass"] if mass is None else mass
    s.tension_stiffness = p["tension"]
    s.compression_stiffness = p["compression"]
    s.shear_stiffness = p["shear"]
    s.bending_stiffness = p["bending"]
    s.air_damping = p["air"]
    s.tension_damping = damping * 5.0
    s.compression_damping = damping * 5.0
    s.shear_damping = damping * 5.0
    s.bending_damping = damping * 0.8
    s.bending_model = 'ANGULAR'
    if pin:
        s.vertex_group_mass = pin
        s.pin_stiffness = pin_stiffness
    c = m.collision_settings
    c.use_self_collision = self_coll
    c.self_distance_min = self_dist
    c.self_friction = 0.4
    c.distance_min = 0.0028
    c.friction = 0.7
    c.collision_quality = 4
    return m


def collide(ob, thickness=0.0025, damping=0.35, friction=0.5):
    ob.modifiers.new("Collision", 'COLLISION')
    ob.collision.thickness_outer = thickness
    ob.collision.thickness_inner = thickness
    ob.collision.damping_factor = damping
    ob.collision.cloth_friction = friction * 80.0
    return ob


def bake(frames, gravity=(0.0, 0.0, -9.81)):
    """Step the frames. `ptcache.bake` needs a window in 5.x; stepping does not."""
    scene = bpy.context.scene
    scene.use_gravity = True
    scene.gravity = gravity
    scene.frame_start, scene.frame_end = 1, frames
    for ob in bpy.data.objects:
        for m in ob.modifiers:
            if m.type == 'CLOTH':
                m.point_cache.frame_start = 1
                m.point_cache.frame_end = frames
    dg = bpy.context.evaluated_depsgraph_get()
    for f in range(1, frames + 1):
        scene.frame_set(f)
        dg.update()


def freeze(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, depsgraph=dg)
    me.name = ob.data.name + "_baked"
    old = ob.data
    ob.data = me
    ob.modifiers.clear()
    bpy.data.meshes.remove(old)
    bpy.context.scene.frame_set(1)
    return ob


def group_verts(ob, name, thresh=0.5):
    if name not in ob.vertex_groups:
        return []
    gi = ob.vertex_groups[name].index
    out = []
    for v in ob.data.vertices:
        for g in v.groups:
            if g.group == gi and g.weight > thresh:
                out.append(v.index)
                break
    return out


def pin_from_groups(ob, name, weights, soft=None, taper=None):
    """Pin by PATTERN, not by height.

    The first cut pinned "everything above z = -66 mm", which caught the shoulder
    seams and missed the centre of the neckline at -82 mm -- so the front panel's
    neck edge, held by nothing but the tension of two shoulder seams, sagged
    240 mm and took the neckband down the chest with it. It looked like a torn
    garment and it was a pinning error.

    The pattern already knows which vertices are the neckline, the shoulder seam,
    the hem and the cuffs, because `flat_shell` marked them. Pin those. A neck rib
    is stiff trim and a hanger holds the shoulder: both are genuinely pinned.
    """
    g = ob.vertex_groups.new(name=name)
    total = 0
    for gname, w in weights.items():
        idxs = group_verts(ob, gname)
        if not idxs:
            raise SystemExit(
                "PIN FAILED: vertex group %r is empty. The draft did not mark "
                "it, or `freeze` dropped the groups." % gname)
        if taper is None:
            g.add(idxs, min(1.0, w), 'REPLACE')
        else:
            # LET THE SKIRT GO. Pinning the whole seam at one weight holds the
            # silhouette but leaves the garment with no creases at all, and a
            # pressed shirt on a hanger does have two or three soft ones below
            # the chest. The seam is stiff where the garment is supported and
            # freer where it hangs, so the pin tapers down the body.
            for i in idxs:
                g.add([i], min(1.0, w * taper(ob.data.vertices[i].co)),
                      'REPLACE')
        total += len(idxs)
    if soft is not None:
        for i, v in enumerate(ob.data.vertices):
            w = soft(v.co)
            if w > 0.0:
                g.add([i], min(1.0, w), 'ADD')
    print("  pinned %d verts from %s" % (total, sorted(weights)))
    return g


def soft_pin(ob, name, fn):
    """A pin group with partial weights: 1 where the hanger holds it, a light
    spring elsewhere, 0 where gravity should be the only author."""
    g = ob.vertex_groups.new(name=name)
    n = 0
    for i, v in enumerate(ob.data.vertices):
        w = fn(v.co)
        if w > 0.0:
            g.add([i], min(1.0, w), 'REPLACE')
            n += 1
    return g, n


def sag(ob, before):
    """How far the lowest point fell. The number that tells you the mass is
    wrong before the render does."""
    now = min(v.co.z for v in ob.data.vertices)
    return (before - now) * 1000.0


def lowest(ob):
    return min(v.co.z for v in ob.data.vertices)


def width(ob):
    xs = [v.co.x for v in ob.data.vertices]
    return max(xs) - min(xs)


def settle(ob, preset, pin, frames=40, mass=None, damping=2.6, label="",
           self_coll=False, self_dist=0.0028, quality=8):
    """Pin, solve, freeze, and report BOTH sag and width.

    Width is here because the sag figure alone passed a solve that had shrunk the
    garment 14% across the sleeves.
    """
    before, w0 = lowest(ob), width(ob)
    cloth(ob, preset, pin=pin, mass=mass, damping=damping, quality=quality,
          self_coll=self_coll, self_dist=self_dist)
    bake(frames)
    freeze(ob)
    d = sag(ob, before)
    dw = (width(ob) - w0) * 1000.0
    print("  settle %-14s %s %d frames: hem %+.0f mm, width %+.0f mm of %.0f"
          % (label or ob.name, preset, frames, d, dw, w0 * 1000.0))
    if abs(dw) > 0.06 * w0 * 1000.0:
        raise SystemExit(
            "SOLVE FAILED: the garment changed width by %.0f mm (%.1f%%). That "
            "is not drape, it is instability -- check self-collision against the "
            "seam row pitch." % (dw, 100.0 * dw / (w0 * 1000.0)))
    return d
