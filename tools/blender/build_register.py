# THE REGISTER KIT — the things a cashier's hands actually touch.
#
#   "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
#       --factory-startup --python tools/blender/build_register.py
#
# Same rules as build_merch.py / build_props.py: 1 unit == 1 game yard, Z-up
# (glTF converts to Y-up on export), materials are NAMED SLOTS remapped onto the
# shared clubhouse kit at load time.
#
# THE CASH DRAWER IS REBUILT HERE, EMPTY, AND THAT IS THE POINT.
#
# The asset pass shipped a cash_drawer.glb with the notes and coins MODELLED INTO
# IT — five paper rectangles in the wells, three brass discs in each cup. As set
# dressing that was right: the ref shows an open till with money in it. As a thing
# a player has to work, it is useless, because `finish()` joins every part into a
# single mesh. You cannot pick up a note that is welded to the drawer.
#
# So the drawer ships as a carcass: wells, cups, dividers, and nothing in them.
# The money is spawned live from the till's actual contents (src/sim/register.js),
# which means the drawer you look at is the drawer you are holding — take three
# ones out and there are three fewer ones in the well.
#
# Five bill wells for [50, 20, 10, 5, 1] and three coin cups for [0.20, 0.10, 0.05],
# matching DENOMS exactly. The old model had five and FOUR, so a cup would have sat
# permanently empty with no denomination to hold.
#
# Blender -Y becomes game +Z on export, and the drawer slides out toward +Z (the
# staff side). So the wells at Blender y=-0.08 land NEAREST the player: notes are
# what you reach for most, so they are what your hand falls on first.

import bpy
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib_model import bevel  # noqa: E402

OUT = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..',
    'vendor', 'models', 'clubhouse'))
os.makedirs(OUT, exist_ok=True)


def wipe():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.objects):
        for b in list(block):
            if b.users == 0:
                block.remove(b)


def mat(name, color, rough=0.6, metal=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (color[0], color[1], color[2], 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def materials():
    return {
        'leather': mat('M_leather', (0.55, 0.33, 0.18), rough=0.55),
        'fabric': mat('M_fabric', (0.35, 0.45, 0.36), rough=0.92),
        'wood': mat('M_wood', (0.29, 0.21, 0.14), rough=0.55),
        'darkwood': mat('M_darkwood', (0.18, 0.13, 0.09), rough=0.60),
        'steel': mat('M_steel', (0.72, 0.74, 0.77), rough=0.28, metal=1.0),
        'brass': mat('M_brass', (0.79, 0.63, 0.15), rough=0.30, metal=0.9),
        'darkmetal': mat('M_darkmetal', (0.13, 0.14, 0.16), rough=0.35, metal=0.9),
        'charcoal': mat('M_charcoal', (0.10, 0.11, 0.13), rough=0.55),
        'plastic': mat('M_plastic', (0.20, 0.22, 0.26), rough=0.45),
        'rubber': mat('M_rubber', (0.10, 0.10, 0.11), rough=0.95),
        'kraft': mat('M_kraft', (0.72, 0.55, 0.36), rough=0.88),
        'white': mat('M_white', (0.94, 0.93, 0.90), rough=0.55),
        'paper': mat('M_paper', (0.93, 0.91, 0.85), rough=0.85),
    }


def cube(name, size, loc=(0, 0, 0), rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    return o


def cyl(name, r, h, loc=(0, 0, 0), rot=(0, 0, 0), verts=14):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=verts,
                                        location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    return o


def tube(name, r, h, thick, loc=(0, 0, 0), rot=(0, 0, 0), verts=16):
    """A hollow ring — a basket rim, a cup wall. Two cylinders, boolean'd."""
    outer = cyl(name, r, h, loc=loc, rot=rot, verts=verts)
    inner = cyl(name + '_i', r - thick, h * 1.2, loc=loc, rot=rot, verts=verts)
    m = outer.modifiers.new('cut', 'BOOLEAN')
    m.operation = 'DIFFERENCE'
    m.object = inner
    bpy.context.view_layer.objects.active = outer
    bpy.ops.object.modifier_apply(modifier='cut')
    bpy.data.objects.remove(inner, do_unlink=True)
    return outer


def assign(o, material):
    o.data.materials.clear()
    o.data.materials.append(material)
    return o


def finish(objs, name):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.shade_auto_smooth(angle=math.radians(38))
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True, export_normals=True,
        export_texcoords=True, export_materials='EXPORT')
    print('  -> %s.glb' % name)
    return o


# ================================================================== DRAWER ====
def build_cash_drawer(M):
    """An EMPTY till. Five bill wells, three coin cups, and nothing in them —
    the money is spawned live from the drawer's real contents, so what you see is
    what you have. Origin at the drawer's centre, on its floor."""
    parts = []

    shell = cube('shell', (0.42, 0.36, 0.10), loc=(0, 0, 0.05))
    bevel(shell, 0.008, 2)
    assign(shell, M['charcoal'])
    parts.append(shell)

    tray = cube('tray', (0.40, 0.34, 0.014), loc=(0, 0, 0.098))
    assign(tray, M['plastic'])
    parts.append(tray)

    # THE FACE PLATE GOES ON THE LEADING EDGE. Blender -Y becomes game +Z, and the
    # drawer slides out toward +Z (the staff side) — so the face has to be at -Y or
    # it trails behind, buried in the counter carcass, and what the player sees
    # sliding toward them is the open BACK of the drawer.
    face = cube('face', (0.44, 0.018, 0.115), loc=(0, -0.188, 0.056))
    bevel(face, 0.006, 2)
    assign(face, M['darkmetal'])
    parts.append(face)
    pull = cube('pull', (0.16, 0.022, 0.018), loc=(0, -0.202, 0.086))
    bevel(pull, 0.005, 2)
    assign(pull, M['steel'])
    parts.append(pull)

    # FIVE bill wells, right behind the face: [50, 20, 10, 5, 1]. Six dividers make
    # five wells. Notes are what a cashier reaches for most, so they are what the
    # hand falls on first.
    for i in range(6):
        x = -0.190 + i * 0.076
        div = cube('welldiv', (0.005, 0.15, 0.048), loc=(x, -0.095, 0.124))
        assign(div, M['plastic'])
        parts.append(div)
    for y in (-0.170, -0.020):
        wall = cube('wellwall', (0.385, 0.005, 0.048), loc=(0, y, 0.124))
        assign(wall, M['plastic'])
        parts.append(wall)

    # a spring ROLLER across each well — the thing that actually holds notes down.
    # The first cut made these thin discs standing on edge, and they rendered as
    # coins balanced on the dividers.
    for i in range(5):
        x = -0.152 + i * 0.076
        clip = cyl('clip', 0.009, 0.062, loc=(x, -0.062, 0.146),
                   rot=(0, math.pi / 2, 0), verts=8)
        assign(clip, M['steel'])
        parts.append(clip)

    # THREE coin cups behind them: [0.20, 0.10, 0.05]. The old drawer had five wells
    # and FOUR cups, so one cup sat permanently empty with no denomination to hold.
    for i in range(3):
        x = -0.11 + i * 0.11
        cup = tube('coincup', 0.048, 0.042, 0.006, loc=(x, 0.098, 0.120), verts=12)
        assign(cup, M['plastic'])
        parts.append(cup)
        floor = cyl('cupfloor', 0.044, 0.005, loc=(x, 0.098, 0.102), verts=12)
        assign(floor, M['plastic'])
        parts.append(floor)

    return finish(parts, 'cash_drawer')


# ================================================================== BASKET ====
def build_basket(M):
    """A shop basket. NOTE cube() takes FULL dimensions, not half-extents — the
    first cut of this file read them as halves and built a 0.6 yd crate: too wide,
    too shallow, with a handle splayed like a broken easel and one arm falling into
    the tub. A real hand basket is 44 x 31 x 22 cm and DEEP for its footprint; the
    depth is most of what stops it reading as a tray.

    What makes a basket a basket: it is deeper than it looks, it tapers in toward
    the base, you can see through the sides, and the handle is a flat trapezoid you
    could actually get a fist under."""
    parts = []
    L, W, H = 0.44, 0.31, 0.22      # full length, full width, height
    BL, BW = 0.38, 0.25             # the base is smaller — the tub tapers out

    base = cube('base', (BL, BW, 0.014), loc=(0, 0, 0.007))
    assign(base, M['plastic'])
    parts.append(base)

    # four slatted walls, leaned out so the tub flares toward the rim
    lean = 0.13
    for k in range(3):
        z = 0.042 + k * 0.062
        out = z * lean
        for sy in (-1, 1):
            o = cube('slat', (L - 0.02 + out * 2, 0.012, 0.040),
                     loc=(0, sy * (BW / 2 + out), z), rot=(sy * -lean, 0, 0))
            assign(o, M['plastic'])
            parts.append(o)
        for sx in (-1, 1):
            o = cube('slat', (0.012, W - 0.02 + out * 2, 0.040),
                     loc=(sx * (BL / 2 + out), 0, z), rot=(0, sx * lean, 0))
            assign(o, M['plastic'])
            parts.append(o)

    # corner posts tie the slats together and give the silhouette its edges
    for sx in (-1, 1):
        for sy in (-1, 1):
            post = cube('post', (0.020, 0.020, H),
                        loc=(sx * (BL / 2 + 0.014), sy * (BW / 2 + 0.014), H / 2),
                        rot=(0, sx * lean * 0.5, sy * 0))
            assign(post, M['plastic'])
            parts.append(post)

    # the rim: a rolled edge all the way round, at full flare
    fl = H * lean
    for sy in (-1, 1):
        o = cube('rim', (L + fl, 0.024, 0.022), loc=(0, sy * (W / 2), H))
        bevel(o, 0.006, 2)
        assign(o, M['plastic'])
        parts.append(o)
    for sx in (-1, 1):
        o = cube('rim', (0.024, W, 0.022), loc=(sx * (L / 2 + fl / 2), 0, H))
        bevel(o, 0.006, 2)
        assign(o, M['plastic'])
        parts.append(o)

    # THE HANDLE — a flat trapezoid: a grip bar along the long axis, carried on two
    # arms that lean outward as they drop to the rim at each end. This is the shape
    # you can actually get a hand under, and it is what a raised basket handle is.
    GY = H + 0.13
    grip = cyl('grip', 0.014, 0.24, loc=(0, 0, GY), rot=(0, math.pi / 2, 0), verts=10)
    assign(grip, M['rubber'])
    parts.append(grip)
    for sx in (-1, 1):
        top = sx * 0.11
        bot = sx * (L / 2 + fl / 2 - 0.02)
        mx = (top + bot) / 2
        mz = (GY + H) / 2
        length = math.hypot(bot - top, GY - H)
        # The bar's own +Z runs from its BOTTOM to its TOP, so the angle has to
        # describe the up-and-INWARD direction (rim → grip). The first cut used
        # atan2(bot - top, ...), which points it up-and-outward: the arms splayed
        # past the grip and crossed clean over it in the render.
        ang = math.atan2(top - bot, GY - H)
        arm = cube('harm', (0.016, 0.016, length), loc=(mx, 0, mz), rot=(0, ang, 0))
        assign(arm, M['steel'])
        parts.append(arm)

    return finish(parts, 'basket')


# ================================================================ PAPER BAG ====
def build_bag_open(M):
    """An OPEN carrier standing on the bagging mat, mouth up, ready to be filled.
    The shop already has a closed bag (the one a customer walks out with); this is
    the one you drop goods INTO, so its mouth has to be a hole, not a lid."""
    parts = []
    W, D, H = 0.13, 0.075, 0.19   # half-extents; a real small carrier

    for sx, sy in ((0, -1), (0, 1)):
        o = cube('wall', (W * 2, 0.004, H * 2), loc=(0, sy * D, H))
        assign(o, M['kraft'])
        parts.append(o)
    for sx in (-1, 1):
        o = cube('wall', (0.004, D * 2, H * 2), loc=(sx * W, 0, H))
        assign(o, M['kraft'])
        parts.append(o)
    floor = cube('floor', (W * 2, D * 2, 0.005), loc=(0, 0, 0.002))
    assign(floor, M['kraft'])
    parts.append(floor)

    # the rolled top edge — the tell that it is paper and not a cardboard box
    for sy in (-1, 1):
        o = cube('lip', (W * 2 + 0.008, 0.012, 0.014), loc=(0, sy * D, H * 2 - 0.004))
        bevel(o, 0.004, 2)
        assign(o, M['kraft'])
        parts.append(o)
    for sx in (-1, 1):
        o = cube('lip', (0.012, D * 2, 0.014), loc=(sx * W, 0, H * 2 - 0.004))
        bevel(o, 0.004, 2)
        assign(o, M['kraft'])
        parts.append(o)

    # twisted paper handles
    for sy in (-1, 1):
        for sx in (-1, 1):
            o = cyl('hrise', 0.005, 0.055,
                    loc=(sx * 0.055, sy * D, H * 2 + 0.024), verts=6)
            assign(o, M['kraft'])
            parts.append(o)
        span = cyl('hspan', 0.005, 0.115, loc=(0, sy * D, H * 2 + 0.050),
                   rot=(0, math.pi / 2, 0), verts=6)
        assign(span, M['kraft'])
        parts.append(span)

    return finish(parts, 'bag_open')


# ============================================================ IMPULSE RACK ====
def build_impulse_rack(M):
    """The little tiered rack of ball markers and tee packets that sits on the
    counter facing the queue. Its whole job is to be looked at while you wait.

    The first cut put the side panels at x = +/-0.255 on a back that was only 0.26
    WIDE — because cube() takes full dimensions and I read them as half-extents. The
    sides floated clear of the rack in the render, detached in mid-air. Whole width
    is 0.34 now, and the sides sit ON it."""
    parts = []
    W = 0.34            # full width
    HW = W / 2          # 0.17

    back = cube('back', (W, 0.012, 0.24), loc=(0, 0.038, 0.12))
    bevel(back, 0.004, 2)
    assign(back, M['darkwood'])
    parts.append(back)

    for i in range(3):
        z = 0.048 + i * 0.076
        y = 0.006 - i * 0.006          # each tier steps slightly forward as it rises
        shelf = cube('shelf', (W - 0.03, 0.058, 0.008), loc=(0, y, z))
        assign(shelf, M['darkwood'])
        parts.append(shelf)
        lip = cube('lip', (W - 0.03, 0.007, 0.017), loc=(0, y - 0.027, z + 0.011))
        assign(lip, M['brass'])
        parts.append(lip)
        # the goods: little packets, tilted back against the tier behind them
        for k in range(3):
            x = -0.098 + k * 0.098
            pk = cube('packet', (0.082, 0.016, 0.070), loc=(x, y + 0.002, z + 0.038),
                      rot=(0.20, 0, 0))
            bevel(pk, 0.003, 1)
            assign(pk, M['white'])
            parts.append(pk)

    for sx in (-1, 1):
        side = cube('side', (0.012, 0.10, 0.24), loc=(sx * (HW - 0.006), 0.010, 0.12))
        assign(side, M['darkwood'])
        parts.append(side)

    return finish(parts, 'impulse_rack')


# ================================================================= DIVIDER ====
def build_divider(M):
    """The bar you lay down between one order and the next. A brass-ended baton
    on a weighted foot — it exists to be a boundary you can see."""
    parts = []
    bar = cube('bar', (0.05, 0.44, 0.030), loc=(0, 0, 0.028))
    bevel(bar, 0.006, 2)
    assign(bar, M['darkwood'])
    parts.append(bar)
    for sy in (-1, 1):
        cap = cyl('cap', 0.026, 0.016, loc=(0, sy * 0.225, 0.028),
                  rot=(math.pi / 2, 0, 0), verts=10)
        assign(cap, M['brass'])
        parts.append(cap)
    foot = cube('foot', (0.06, 0.10, 0.012), loc=(0, 0, 0.006))
    bevel(foot, 0.003, 2)
    assign(foot, M['darkmetal'])
    parts.append(foot)
    return finish(parts, 'divider')


# ==================================================================== main ====
if __name__ == '__main__':
    builders = [
        build_cash_drawer,   # REBUILT — empty, so the money can be real
        build_basket,
        build_bag_open,
        build_impulse_rack,
        build_divider,
    ]
    for b in builders:
        wipe()
        b(materials())
    print('\n=== BUILT %d REGISTER PIECES -> %s ===' % (len(builders), OUT))
