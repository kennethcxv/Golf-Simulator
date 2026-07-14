# CLUBHOUSE MERCHANDISE — Blender authoring
#
#   "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
#       --factory-startup --python tools/blender/build_merch.py
#
# Writes GLBs to vendor/models/clubhouse/.
#
# WHY THESE AND NOT THE FURNITURE: the audit found the millwork is already
# beveled, plinthed and crowned. The MERCHANDISE is what makes the shop read as
# a prototype — polos were flat saturated slabs, driver heads were squashed
# spheres, bags were cylinders, shoes were lumps.
#
# Units: 1 Blender unit == 1 game yard (~1 m), real-world dimensions throughout.
# Blender is Z-up; the glTF exporter converts to Y-up, which is what three wants.
#
# MATERIALS ARE NAMED SLOTS, NOT LOOKS. Every material is `M_<slot>`; at load the
# game remaps each slot onto the shared clubhouse material kit, so wood is one
# species and leather one hide across the building and the material count stays
# flat. Colours here only make the asset legible if opened in Blender.

import bpy
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib_model import (loft, outline_solid, ring_yz, ring_xy, ring_xz,
                       bevel, subsurf)

OUT = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..',
    'vendor', 'models', 'clubhouse'))
os.makedirs(OUT, exist_ok=True)

N = 12  # ring resolution — the interior is draw-call bound, not tri bound, but
        # there is no reason to spend triangles where a bevel reads the same


# ----------------------------------------------------------------- helpers ---
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


def cube(name, size, loc=(0, 0, 0), rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    return o


def cyl(name, r, h, loc=(0, 0, 0), rot=(0, 0, 0), verts=12):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=verts,
                                        location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    return o


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
    print('WROTE %-16s -> %s' % (name, os.path.basename(path)))
    return path


def materials():
    return {
        'fabric': mat('M_fabric', (0.35, 0.45, 0.36), rough=0.92),
        'trim': mat('M_trim', (0.92, 0.92, 0.88), rough=0.90),
        'leather': mat('M_leather', (0.55, 0.33, 0.18), rough=0.55),
        'rubber': mat('M_rubber', (0.10, 0.10, 0.11), rough=0.95),
        'steel': mat('M_steel', (0.72, 0.74, 0.77), rough=0.28, metal=1.0),
        'darkmetal': mat('M_darkmetal', (0.13, 0.14, 0.16), rough=0.35, metal=0.9),
        'wood': mat('M_wood', (0.29, 0.21, 0.14), rough=0.55),
        'plastic': mat('M_plastic', (0.20, 0.22, 0.26), rough=0.45),
        'white': mat('M_white', (0.94, 0.93, 0.90), rough=0.55),
    }


# =============================================================== GARMENTS ====
# A shirt is a flat garment: one silhouette, filled, given thickness, softened.
# Measured against a real polo: ~0.52 m across with the sleeves out, not 0.68.
# The sleeves also DROOP — a shirt on a hanger does not hold its arms out level.
POLO_OUTLINE = [
    (-0.150, -0.680),   # hem, left
    (-0.158, -0.300),   # waist
    (-0.142, -0.268),   # underarm
    (-0.246, -0.330),   # sleeve cuff, lower  (drooped)
    (-0.262, -0.232),   # sleeve cuff, upper
    (-0.166, -0.136),   # shoulder
    (-0.062, -0.112),   # neck
    (0.000, -0.154),    # the collar notch
    (0.062, -0.112),
    (0.166, -0.136),
    (0.262, -0.232),
    (0.246, -0.330),
    (0.142, -0.268),
    (0.158, -0.300),
    (0.150, -0.680),    # hem, right
]


def build_polo(M):
    """Hanging polo. Pivot at the HOOK, so it hangs off a rail at any height."""
    parts = []
    body = outline_solid('shirt', POLO_OUTLINE, 0.055, plane='xz')
    bevel(body, 0.012, 2)
    subsurf(body, 1)
    assign(body, M['fabric'])
    parts.append(body)

    # collar band sitting into the notch, and the placket below it
    col = cube('collar', (0.15, 0.075, 0.030), loc=(0, 0, -0.132))
    bevel(col, 0.008, 2)
    assign(col, M['trim'])
    parts.append(col)
    plk = cube('placket', (0.030, 0.062, 0.115), loc=(0, 0.006, -0.212))
    bevel(plk, 0.004, 2)
    assign(plk, M['trim'])
    parts.append(plk)

    # hanger: a bar that stays INSIDE the shoulder line, plus a wire hook
    for s in (-1, 1):
        bar = cube('hangbar', (0.185, 0.018, 0.013),
                   loc=(s * 0.082, 0, -0.116), rot=(0, s * 0.16, 0))
        bevel(bar, 0.004, 2)
        assign(bar, M['wood'])
        parts.append(bar)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.026, minor_radius=0.004,
                                     location=(0, 0, -0.030),
                                     rotation=(math.pi / 2, 0, 0),
                                     major_segments=14, minor_segments=6)
    hk = bpy.context.object
    hk.name = 'hook'
    assign(hk, M['steel'])
    parts.append(hk)
    return finish(parts, 'polo_hanging')


def build_polo_folded(M):
    """A folded polo: soft slab, sleeve folds visible, collar tab proud."""
    parts = []
    body = cube('fold', (0.30, 0.25, 0.042), loc=(0, 0, 0.021))
    bevel(body, 0.012, 2)
    subsurf(body, 1)
    assign(body, M['fabric'])
    parts.append(body)
    # the two sleeve folds tucked under, which is what says "folded" not "slab"
    for s in (-1, 1):
        fold = cube('sleevefold', (0.085, 0.16, 0.026),
                    loc=(s * 0.095, -0.02, 0.050), rot=(0, 0, s * 0.10))
        bevel(fold, 0.008, 2)
        subsurf(fold, 1)
        assign(fold, M['fabric'])
        parts.append(fold)
    tab = cube('collar', (0.105, 0.050, 0.016), loc=(0, 0.086, 0.052))
    bevel(tab, 0.005, 2)
    assign(tab, M['trim'])
    parts.append(tab)
    return finish(parts, 'polo_folded')


def build_jacket(M):
    """Outerwear: longer body, full sleeves, a zip. Same silhouette, grown."""
    outline = []
    for (x, z) in POLO_OUTLINE:
        # longer in the body, longer in the sleeve
        z2 = z * 1.16 if z < -0.30 else z
        x2 = x * 1.10 if abs(x) > 0.25 else x * 1.04
        outline.append((x2, z2))
    parts = []
    body = outline_solid('jacket', outline, 0.075, plane='xz')
    bevel(body, 0.014, 2)
    subsurf(body, 1)
    assign(body, M['fabric'])
    parts.append(body)
    zip_ = cube('zip', (0.014, 0.085, 0.52), loc=(0, 0.004, -0.44))
    assign(zip_, M['trim'])
    parts.append(zip_)
    col = cube('collar', (0.17, 0.090, 0.055), loc=(0, 0, -0.140))
    bevel(col, 0.010, 2)
    assign(col, M['fabric'])
    parts.append(col)
    for s in (-1, 1):
        bar = cube('hangbar', (0.195, 0.018, 0.013),
                   loc=(s * 0.086, 0, -0.120), rot=(0, s * 0.16, 0))
        bevel(bar, 0.004, 2)
        assign(bar, M['wood'])
        parts.append(bar)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.026, minor_radius=0.004,
                                     location=(0, 0, -0.032),
                                     rotation=(math.pi / 2, 0, 0),
                                     major_segments=14, minor_segments=6)
    hk = bpy.context.object
    hk.name = 'hook'
    assign(hk, M['steel'])
    parts.append(hk)
    return finish(parts, 'jacket_hanging')


def build_glove(M):
    """Cabretta glove, laid flat. One silhouette — palm, four fingers, thumb."""
    o = [
        (-0.048, -0.062),  # cuff, left
        (-0.048, 0.030),
        (-0.072, 0.048),   # thumb
        (-0.060, 0.076),
        (-0.040, 0.058),
        (-0.038, 0.092),   # index
        (-0.022, 0.096),
        (-0.020, 0.062),
        (-0.006, 0.062),
        (-0.004, 0.100),   # middle
        (0.012, 0.100),
        (0.014, 0.062),
        (0.026, 0.062),
        (0.028, 0.094),    # ring
        (0.043, 0.092),
        (0.044, 0.058),
        (0.052, 0.056),
        (0.056, 0.080),    # little
        (0.068, 0.076),
        (0.062, 0.030),
        (0.048, -0.062),   # cuff, right
    ]
    parts = []
    g = outline_solid('glove', o, 0.020, plane='xz')
    bevel(g, 0.005, 2)
    subsurf(g, 1)
    assign(g, M['white'])
    parts.append(g)
    cuff = cube('cuff', (0.096, 0.028, 0.020), loc=(0, 0, -0.058))
    bevel(cuff, 0.005, 2)
    assign(cuff, M['trim'])
    parts.append(cuff)
    return finish(parts, 'glove')


# ================================================================== FOOTWEAR ==
def build_shoe(M):
    """Golf shoe, 0.30 m. Pivot at the sole.

    The first loft came out a smooth loaf — a bread roll, not a shoe. Two causes:
    subsurf melted every edge away, and the profile fell monotonically from heel
    to toe so there was no ankle and no instep. A shoe reads from THREE landmarks:
    a tall vertical heel, a DIP at the instep where the laces sit, and a low
    rounded toe box. So: no subsurf, and the profile dips."""
    parts = []

    # UPPER — the dip at x=-0.04 is the instep; the heel stands tall behind it
    up = [
        ring_yz(-0.146, 0, 0.062, 0.040, 0.050, N, zfloor=0.028),  # heel, tall
        ring_yz(-0.118, 0, 0.064, 0.049, 0.054, N, zfloor=0.028),  # ankle collar
        ring_yz(-0.086, 0, 0.054, 0.053, 0.045, N, zfloor=0.028),  # ...drops
        ring_yz(-0.040, 0, 0.046, 0.056, 0.037, N, zfloor=0.028),  # INSTEP dip
        ring_yz(0.014, 0, 0.045, 0.057, 0.034, N, zfloor=0.028),   # ball, widest
        ring_yz(0.064, 0, 0.043, 0.053, 0.031, N, zfloor=0.028),   # toe box
        ring_yz(0.108, 0, 0.041, 0.042, 0.026, N, zfloor=0.028),
        ring_yz(0.146, 0, 0.039, 0.021, 0.014, N, zfloor=0.028),   # toe tip
    ]
    upper = loft('upper', up)
    bevel(upper, 0.006, 2)          # bevel only — subsurf destroys the landmarks
    assign(upper, M['leather'])
    parts.append(upper)

    # ankle collar: a raised rim at the back, which is what says "there is a foot
    # hole here" and stops the heel reading as a solid lump
    collar = loft('collar', [
        ring_yz(-0.128, 0, 0.104, 0.044, 0.020, N),
        ring_yz(-0.096, 0, 0.098, 0.047, 0.018, N),
    ])
    bevel(collar, 0.004, 2)
    assign(collar, M['trim'])
    parts.append(collar)

    # SOLE — same plan shape, thin, with a lifted toe
    sl = [
        ring_yz(-0.150, 0, 0.016, 0.042, 0.016, N),
        ring_yz(-0.118, 0, 0.014, 0.051, 0.014, N),
        ring_yz(-0.086, 0, 0.013, 0.055, 0.013, N),
        ring_yz(-0.040, 0, 0.013, 0.058, 0.013, N),
        ring_yz(0.014, 0, 0.013, 0.059, 0.013, N),
        ring_yz(0.064, 0, 0.014, 0.055, 0.013, N),
        ring_yz(0.108, 0, 0.018, 0.044, 0.012, N),
        ring_yz(0.152, 0, 0.026, 0.022, 0.010, N),
    ]
    sole = loft('sole', sl)
    bevel(sole, 0.004, 2)
    assign(sole, M['rubber'])
    parts.append(sole)

    # tongue sitting IN the instep dip, and laces across it
    tongue = cube('tongue', (0.078, 0.046, 0.014), loc=(-0.022, 0, 0.082),
                  rot=(0, -0.16, 0))
    bevel(tongue, 0.004, 2)
    assign(tongue, M['leather'])
    parts.append(tongue)
    for i in range(3):
        lace = cyl('lace', 0.0042, 0.066, loc=(-0.052 + i * 0.030, 0, 0.086 + i * 0.002),
                   rot=(math.pi / 2, 0, 0), verts=6)
        assign(lace, M['white'])
        parts.append(lace)
    return finish(parts, 'shoe')


# ====================================================================== BAG ===
def build_bag(M):
    """Stand bag, ~0.90 m body. Pivot at the base, centred.

    The first two attempts read as a thermos flask, and the reason was not the
    body — it was that A GOLF BAG WITH NO CLUBS IN IT IS JUST A BIN. What makes
    the silhouette legible at ten feet is the fan of club heads out of the top
    (ref 7). So the clubs ship WITH the bag, and the body got wider, with a real
    front pocket panel instead of two small bumps."""
    parts = []
    body = loft('body', [
        ring_xy(0.015, 0, 0, 0.125, 0.108, N, yback=-0.076),
        ring_xy(0.080, 0, 0, 0.134, 0.116, N, yback=-0.082),
        ring_xy(0.340, 0, 0, 0.142, 0.124, N, yback=-0.088),
        ring_xy(0.610, 0, 0, 0.152, 0.132, N, yback=-0.094),
        ring_xy(0.800, 0, 0, 0.162, 0.140, N, yback=-0.100),
    ])
    bevel(body, 0.006, 2)
    assign(body, M['fabric'])
    parts.append(body)

    # cuff + club dividers
    cuff = loft('cuff', [
        ring_xy(0.800, 0, 0, 0.166, 0.144, N, yback=-0.102),
        ring_xy(0.876, 0, 0, 0.172, 0.150, N, yback=-0.106),
    ])
    bevel(cuff, 0.005, 2)
    assign(cuff, M['plastic'])
    parts.append(cuff)
    for a in (0.0, math.pi / 2):
        d = cube('divider', (0.32, 0.010, 0.052), loc=(0, 0, 0.858), rot=(0, 0, a))
        assign(d, M['plastic'])
        parts.append(d)

    foot = loft('foot', [
        ring_xy(0.000, 0, 0, 0.142, 0.124, N, yback=-0.088),
        ring_xy(0.042, 0, 0, 0.128, 0.110, N, yback=-0.078),
    ])
    bevel(foot, 0.005, 2)
    assign(foot, M['rubber'])
    parts.append(foot)

    # one big front pocket panel + a smaller ball pocket, both cut INTO the body
    pk = cube('pocket_main', (0.185, 0.105, 0.230), loc=(0, 0.078, 0.330))
    bevel(pk, 0.014, 2)
    assign(pk, M['fabric'])
    parts.append(pk)
    zipl = cube('pocket_zip', (0.175, 0.020, 0.014), loc=(0, 0.130, 0.430))
    assign(zipl, M['rubber'])
    parts.append(zipl)
    pk2 = cube('pocket_ball', (0.120, 0.085, 0.130), loc=(0.090, 0.055, 0.610),
               rot=(0, 0, -0.30))
    bevel(pk2, 0.012, 2)
    assign(pk2, M['fabric'])
    parts.append(pk2)

    # carry strap: a flat band down the SPINE, not a worm off the side
    band = []
    for i in range(6):
        t = i / 5.0
        z = 0.30 + t * 0.50
        y = -0.108 - math.sin(t * math.pi) * 0.055
        band.append(ring_xy(z, 0, y, 0.038, 0.014, 8))
    strap = loft('strap', band)
    bevel(strap, 0.003, 2)
    assign(strap, M['rubber'])   # dark padded webbing; M_trim made it a white worm
    parts.append(strap)

    # stand legs
    for s in (-1, 1):
        leg = cyl('leg', 0.009, 0.64, loc=(s * 0.090, -0.115, 0.340),
                  rot=(0.24, 0, 0), verts=8)
        assign(leg, M['steel'])
        parts.append(leg)

    # THE CLUBS — a fan of shafts with real heads. This is the silhouette.
    fan = [(-0.055, -0.030, -0.16, 0.10), (-0.020, 0.030, -0.07, 0.05),
           (0.020, -0.045, 0.06, 0.12), (0.058, 0.025, 0.15, -0.04),
           (0.000, -0.005, 0.00, -0.10)]
    for i, (ox, oy, tiltx, tilty) in enumerate(fan):
        shaft = cyl('shaft', 0.006, 0.66, loc=(ox, oy, 1.16),
                    rot=(tilty, tiltx, 0), verts=8)
        assign(shaft, M['steel'])
        parts.append(shaft)
        gx = ox + math.sin(tiltx) * 0.33
        gy = oy - math.sin(tilty) * 0.33
        grip = cyl('grip', 0.009, 0.16, loc=(gx, gy, 1.46),
                   rot=(tilty, tiltx, 0), verts=8)
        assign(grip, M['rubber'])
        parts.append(grip)
        # heads sit down in the cuff — a wood cover for two, irons for the rest
        if i < 2:
            hd = cyl('headcover', 0.030, 0.090, loc=(ox * 1.2, oy * 1.2, 0.930),
                     rot=(tilty, tiltx, 0), verts=10)
            assign(hd, M['fabric'])
        else:
            hd = cube('ironhead', (0.040, 0.014, 0.030),
                      loc=(ox * 1.2, oy * 1.2, 0.925), rot=(tilty, tiltx, 0))
            bevel(hd, 0.003, 2)
            assign(hd, M['steel'])
        parts.append(hd)
    return finish(parts, 'bag')


# ================================================================ CLUB HEADS ==
def _hosel(M, at, tilt):
    h = cyl('hosel', 0.0075, 0.060, loc=at, rot=(0, tilt, 0), verts=10)
    assign(h, M['steel'])
    return h


def build_driver_head(M):
    """460cc driver: a lofted pear, flat crown, flat sole. Pivot at the shaft entry."""
    parts = []
    head = loft('head', [
        ring_xz(-0.052, 0.006, -0.052, 0.040, 0.026, N, zfloor=-0.074),  # face
        ring_xz(-0.022, 0.004, -0.052, 0.052, 0.031, N, zfloor=-0.076),
        ring_xz(0.014, 0.000, -0.051, 0.056, 0.032, N, zfloor=-0.076),
        ring_xz(0.046, -0.004, -0.050, 0.048, 0.027, N, zfloor=-0.074),
        ring_xz(0.070, -0.008, -0.048, 0.026, 0.016, N, zfloor=-0.062),   # tail
    ])
    bevel(head, 0.004, 2)
    subsurf(head, 1)
    assign(head, M['darkmetal'])
    parts.append(head)
    face = cyl('face', 0.036, 0.007, loc=(-0.054, 0.006, -0.052),
               rot=(0, math.pi / 2, 0), verts=14)
    assign(face, M['steel'])
    parts.append(face)
    parts.append(_hosel(M, (-0.028, 0.020, -0.008), 0.22))
    return finish(parts, 'head_driver')


def _blade(M, name, face_r, tall, sole_w, hosel_at):
    """An iron/wedge blade, lofted HEEL-TO-TOE along X.

    The first cut lofted this along Y by mistake, which made the blade a thin
    slab in the wrong plane — so the sole flange and the hosel both floated
    clear of it in the render. Rings in y-z, marching along x, is the shape."""
    parts = []
    blade = loft('blade', [
        ring_yz(0.000, 0, -0.048, face_r, tall, 10, zfloor=-0.048 - tall),  # heel
        ring_yz(0.028, 0, -0.048, face_r * 1.08, tall * 1.06, 10, zfloor=-0.048 - tall),
        ring_yz(0.058, 0, -0.050, face_r * 1.08, tall, 10, zfloor=-0.048 - tall),
        ring_yz(0.082, 0, -0.054, face_r * 0.88, tall * 0.80, 10, zfloor=-0.048 - tall),  # toe
    ])
    bevel(blade, 0.003, 2)
    assign(blade, M['steel'])
    parts.append(blade)
    # sole flange, sunk INTO the bottom of the blade so it reads as one head
    sole = cube('sole', (0.090, sole_w, 0.012), loc=(0.042, 0.000, -0.048 - tall))
    bevel(sole, 0.004, 2)
    assign(sole, M['steel'])
    parts.append(sole)
    parts.append(_hosel(M, hosel_at, 0.10))
    return finish(parts, name)


def build_iron_head(M):
    return _blade(M, 'head_iron', 0.011, 0.030, 0.026, (-0.004, 0.0, -0.014))


def build_wedge_head(M):
    """Wedge: taller face, wider sole."""
    return _blade(M, 'head_wedge', 0.013, 0.036, 0.034, (-0.004, 0.0, -0.010))


def build_putter_head(M):
    """Blade putter with a flange and a sight line."""
    parts = []
    blade = cube('blade', (0.112, 0.028, 0.024), loc=(0.030, 0, -0.062))
    bevel(blade, 0.004, 2)
    assign(blade, M['steel'])
    parts.append(blade)
    flange = cube('flange', (0.098, 0.026, 0.013), loc=(0.030, -0.024, -0.066))
    bevel(flange, 0.004, 2)
    assign(flange, M['steel'])
    parts.append(flange)
    sight = cube('sight', (0.009, 0.030, 0.003), loc=(0.030, 0, -0.049))
    assign(sight, M['darkmetal'])
    parts.append(sight)
    parts.append(_hosel(M, (-0.020, 0, -0.024), 0.05))
    return finish(parts, 'head_putter')


# ====================================================================== CAP ===
def build_cap(M):
    """Six-panel cap with a curved bill. Pivot at the brim line."""
    parts = []
    crown = loft('crown', [
        ring_xy(0.000, 0, 0, 0.093, 0.098, 14),
        ring_xy(0.028, 0, 0, 0.090, 0.095, 14),
        ring_xy(0.055, 0, 0, 0.080, 0.084, 14),
        ring_xy(0.076, 0, 0, 0.060, 0.063, 14),
        ring_xy(0.089, 0, 0, 0.032, 0.034, 14),
        ring_xy(0.095, 0, 0, 0.008, 0.008, 14),
    ])
    bevel(crown, 0.004, 2)
    subsurf(crown, 1)
    assign(crown, M['fabric'])
    parts.append(crown)

    # BILL — a flat plate lofted FORWARD along Y, curving down at the tip.
    # The first cut lofted this along Z between two horizontal ellipses, which
    # builds a squashed vertical tube: it rendered as a small nub, not a bill.
    # Rings in x-z (wide, thin), marching along y, is the shape.
    bill = []
    for i in range(5):
        t = i / 4.0
        y = 0.055 + t * 0.115
        w = 0.094 * (1.0 - 0.38 * t * t)          # tapers toward the tip
        drop = 0.006 - 0.030 * t * t              # and curves down
        bill.append(ring_xz(y, 0, drop, w, 0.008, 10))
    b = loft('bill', bill)
    bevel(b, 0.003, 2)
    assign(b, M['fabric'])
    parts.append(b)

    btn = cyl('button', 0.010, 0.008, loc=(0, 0, 0.098), verts=8)
    assign(btn, M['fabric'])
    parts.append(btn)
    return finish(parts, 'cap')


# ==================================================================== main ===
if __name__ == '__main__':
    builders = [
        build_polo, build_polo_folded, build_jacket, build_glove,
        build_shoe, build_bag,
        build_driver_head, build_iron_head, build_wedge_head, build_putter_head,
        build_cap,
    ]
    for b in builders:
        wipe()
        b(materials())
    print('\n=== BUILT %d ASSETS -> %s ===' % (len(builders), OUT))
