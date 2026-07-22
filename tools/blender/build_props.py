# CLUBHOUSE PROPS — the operational kit and the furniture.
#
#   blender --background \
#       --factory-startup --python tools/blender/build_props.py
#
# Pass-1 review named these the ten weakest things still visible:
#   the register was three black slabs, the lounge chairs orange blobs, the
#   trophies gold cylinders, the pendant a flat black box, the delivery cartons
#   plain cubes with no tape or flaps, and the stockroom had no hand truck at all.
#
# Same rules as build_merch.py: 1 unit == 1 game yard, Z-up (glTF converts),
# materials are NAMED SLOTS remapped onto the shared kit at load.

import bpy
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib_model import loft, ring_xy, ring_yz, ring_xz, bevel, subsurf

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


def torus(name, R, r, loc=(0, 0, 0), rot=(0, 0, 0), seg=16, mseg=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc,
                                     rotation=rot, major_segments=seg, minor_segments=mseg)
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
    print('WROTE %-18s -> %s' % (name, os.path.basename(path)))
    return path


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
        'tape': mat('M_tape', (0.83, 0.76, 0.60), rough=0.40),
        'screen': mat('M_screen', (0.05, 0.09, 0.06), rough=0.20),
        'glass': mat('M_glass', (0.90, 0.93, 0.95), rough=0.08),
        'white': mat('M_white', (0.94, 0.93, 0.90), rough=0.55),
        'paper': mat('M_paper', (0.93, 0.91, 0.85), rough=0.85),
    }


# =============================================================== FURNITURE ===
def build_lounge_chair(M):
    """Leather club chair (ref 8): rolled arms, a deep seat, a buttoned back.
    Was six beveled boxes and read as a blob. Pivot at the floor, centred."""
    parts = []
    # seat cushion — soft, with a real crown
    seat = cube('seat', (0.72, 0.66, 0.16), loc=(0, 0, 0.40))
    bevel(seat, 0.045, 3)
    subsurf(seat, 1)
    assign(seat, M['leather'])
    parts.append(seat)
    # base skirt under it
    skirt = cube('skirt', (0.78, 0.72, 0.26), loc=(0, 0, 0.20))
    bevel(skirt, 0.020, 2)
    assign(skirt, M['leather'])
    parts.append(skirt)
    # back: reclined, with a rolled top rail
    back = cube('back', (0.72, 0.16, 0.56), loc=(0, -0.30, 0.66), rot=(-0.14, 0, 0))
    bevel(back, 0.040, 3)
    subsurf(back, 1)
    assign(back, M['leather'])
    parts.append(back)
    roll = cyl('backroll', 0.075, 0.72, loc=(0, -0.345, 0.94),
               rot=(0, math.pi / 2, 0), verts=12)
    assign(roll, M['leather'])
    parts.append(roll)
    # ROLLED ARMS — the detail that makes a club chair a club chair
    for s in (-1, 1):
        arm = cube('arm', (0.15, 0.66, 0.30), loc=(s * 0.315, -0.02, 0.50))
        bevel(arm, 0.030, 3)
        assign(arm, M['leather'])
        parts.append(arm)
        armroll = cyl('armroll', 0.078, 0.66, loc=(s * 0.315, -0.02, 0.64),
                      rot=(math.pi / 2, 0, 0), verts=12)
        assign(armroll, M['leather'])
        parts.append(armroll)
    # a green cushion, and four turned legs
    cush = cube('cushion', (0.44, 0.14, 0.30), loc=(0.14, -0.20, 0.60),
                rot=(0.30, 0, 0.20))
    bevel(cush, 0.030, 3)
    subsurf(cush, 1)
    assign(cush, M['fabric'])
    parts.append(cush)
    for sx in (-1, 1):
        for sy in (-1, 1):
            leg = cyl('leg', 0.030, 0.16, loc=(sx * 0.31, sy * 0.28, 0.08), verts=8)
            assign(leg, M['darkwood'])
            parts.append(leg)
    return finish(parts, 'chair_lounge')


def build_office_chair(M):
    """Task chair: was a black blob. Pivot at the floor, centred."""
    parts = []
    seat = cube('seat', (0.46, 0.44, 0.09), loc=(0, 0, 0.46))
    bevel(seat, 0.025, 3)
    subsurf(seat, 1)
    assign(seat, M['fabric'])
    parts.append(seat)
    back = cube('back', (0.42, 0.08, 0.50), loc=(0, -0.20, 0.76), rot=(-0.16, 0, 0))
    bevel(back, 0.025, 3)
    subsurf(back, 1)
    assign(back, M['fabric'])
    parts.append(back)
    for s in (-1, 1):
        arm = cube('arm', (0.05, 0.30, 0.04), loc=(s * 0.24, -0.02, 0.60))
        bevel(arm, 0.012, 2)
        assign(arm, M['charcoal'])
        parts.append(arm)
        post = cube('armpost', (0.04, 0.04, 0.12), loc=(s * 0.24, 0.06, 0.53))
        assign(post, M['charcoal'])
        parts.append(post)
    col = cyl('gaslift', 0.032, 0.30, loc=(0, 0, 0.30), verts=10)
    assign(col, M['charcoal'])
    parts.append(col)
    hub = cyl('hub', 0.055, 0.05, loc=(0, 0, 0.13), verts=10)
    assign(hub, M['charcoal'])
    parts.append(hub)
    for i in range(5):
        a = i * math.pi * 2 / 5
        spoke = cube('spoke', (0.24, 0.035, 0.025),
                     loc=(math.cos(a) * 0.12, math.sin(a) * 0.12, 0.12),
                     rot=(0, 0, a))
        bevel(spoke, 0.008, 2)
        assign(spoke, M['charcoal'])
        parts.append(spoke)
        caster = cyl('caster', 0.028, 0.022,
                     loc=(math.cos(a) * 0.235, math.sin(a) * 0.235, 0.028),
                     rot=(math.pi / 2, 0, a), verts=8)
        assign(caster, M['rubber'])
        parts.append(caster)
    return finish(parts, 'chair_office')


def build_trophy(M):
    """A cup with HANDLES on a plinth. Was a gold cylinder. Pivot at the base."""
    parts = []
    base = cube('plinth', (0.11, 0.11, 0.045), loc=(0, 0, 0.022))
    bevel(base, 0.006, 2)
    assign(base, M['darkwood'])
    parts.append(base)
    foot = cyl('foot', 0.045, 0.020, loc=(0, 0, 0.055), verts=14)
    bevel(foot, 0.004, 2)
    assign(foot, M['brass'])
    parts.append(foot)
    stem = cyl('stem', 0.014, 0.055, loc=(0, 0, 0.092), verts=10)
    assign(stem, M['brass'])
    parts.append(stem)
    # the bowl: a lofted cup, wide at the rim
    bowl = loft('bowl', [
        ring_xy(0.118, 0, 0, 0.020, 0.020, 14),
        ring_xy(0.140, 0, 0, 0.048, 0.048, 14),
        ring_xy(0.175, 0, 0, 0.058, 0.058, 14),
        ring_xy(0.205, 0, 0, 0.055, 0.055, 14),
    ])
    bevel(bowl, 0.003, 2)
    assign(bowl, M['brass'])
    parts.append(bowl)
    for s in (-1, 1):
        h = torus('handle', 0.032, 0.006, loc=(s * 0.062, 0, 0.172),
                  rot=(math.pi / 2, 0, 0), seg=12, mseg=6)
        assign(h, M['brass'])
        parts.append(h)
    return finish(parts, 'trophy')


# ============================================================== THE REGISTER ==
def build_register(M):
    """POS terminal: a screen on a real stand, not a slab on a stick."""
    parts = []
    base = cube('base', (0.20, 0.16, 0.020), loc=(0, 0, 0.010))
    bevel(base, 0.006, 2)
    assign(base, M['charcoal'])
    parts.append(base)
    neck = cube('neck', (0.045, 0.035, 0.13), loc=(0, -0.02, 0.085), rot=(0.12, 0, 0))
    bevel(neck, 0.006, 2)
    assign(neck, M['charcoal'])
    parts.append(neck)
    shell = cube('shell', (0.34, 0.030, 0.24), loc=(0, -0.045, 0.26), rot=(0.18, 0, 0))
    bevel(shell, 0.008, 2)
    assign(shell, M['charcoal'])
    parts.append(shell)
    screen = cube('screen', (0.31, 0.006, 0.21), loc=(0, -0.062, 0.262), rot=(0.18, 0, 0))
    assign(screen, M['screen'])
    parts.append(screen)
    return finish(parts, 'register')


def build_scanner(M):
    """Handheld barcode gun in its cradle (ref: panel 8 shows it in hand)."""
    parts = []
    body = cube('body', (0.055, 0.16, 0.055), loc=(0, 0.02, 0.145), rot=(0.35, 0, 0))
    bevel(body, 0.012, 3)
    assign(body, M['charcoal'])
    parts.append(body)
    head = cube('head', (0.058, 0.045, 0.048), loc=(0, 0.10, 0.175), rot=(0.35, 0, 0))
    bevel(head, 0.010, 3)
    assign(head, M['charcoal'])
    parts.append(head)
    win = cube('window', (0.046, 0.006, 0.034), loc=(0, 0.122, 0.181), rot=(0.35, 0, 0))
    assign(win, M['glass'])
    parts.append(win)
    grip = cube('grip', (0.046, 0.052, 0.115), loc=(0, -0.032, 0.062), rot=(-0.10, 0, 0))
    bevel(grip, 0.012, 3)
    assign(grip, M['rubber'])
    parts.append(grip)
    cradle = cube('cradle', (0.085, 0.10, 0.020), loc=(0, -0.01, 0.010))
    bevel(cradle, 0.006, 2)
    assign(cradle, M['charcoal'])
    parts.append(cradle)
    return finish(parts, 'scanner')


def build_cardterm(M):
    """Card reader: a wedge with a keypad and a screen, tilted at the customer."""
    parts = []
    body = cube('body', (0.10, 0.15, 0.045), loc=(0, 0, 0.022))
    bevel(body, 0.008, 2)
    assign(body, M['charcoal'])
    parts.append(body)
    face = cube('face', (0.10, 0.14, 0.030), loc=(0, 0.004, 0.052), rot=(-0.34, 0, 0))
    bevel(face, 0.008, 2)
    assign(face, M['charcoal'])
    parts.append(face)
    scr = cube('screen', (0.075, 0.048, 0.004), loc=(0, 0.036, 0.073), rot=(-0.34, 0, 0))
    assign(scr, M['screen'])
    parts.append(scr)
    for row in range(4):
        for col in range(3):
            k = cube('key', (0.017, 0.013, 0.005),
                     loc=(-0.022 + col * 0.022, -0.005 - row * 0.019,
                          0.058 - row * 0.006), rot=(-0.34, 0, 0))
            assign(k, M['plastic'])
            parts.append(k)
    return finish(parts, 'cardterm')


def build_printer(M):
    """Receipt printer with a slot and a curl of paper."""
    parts = []
    body = cube('body', (0.15, 0.19, 0.115), loc=(0, 0, 0.058))
    bevel(body, 0.010, 3)
    assign(body, M['charcoal'])
    parts.append(body)
    lid = cube('lid', (0.145, 0.12, 0.020), loc=(0, 0.028, 0.122), rot=(-0.14, 0, 0))
    bevel(lid, 0.006, 2)
    assign(lid, M['charcoal'])
    parts.append(lid)
    slip = cube('slip', (0.10, 0.075, 0.003), loc=(0, 0.085, 0.135), rot=(-0.55, 0, 0))
    assign(slip, M['paper'])
    parts.append(slip)
    return finish(parts, 'printer')


# ============================================================== STOCKROOM ====
def build_carton(M):
    """Delivery carton, CLOSED: flaps folded down with a tape seam. Was a cube."""
    parts = []
    body = cube('body', (0.42, 0.36, 0.30), loc=(0, 0, 0.15))
    bevel(body, 0.006, 2)
    assign(body, M['kraft'])
    parts.append(body)
    for s in (-1, 1):
        flap = cube('flap', (0.42, 0.175, 0.010), loc=(0, s * 0.088, 0.303))
        bevel(flap, 0.003, 2)
        assign(flap, M['kraft'])
        parts.append(flap)
    tape = cube('tape', (0.055, 0.37, 0.004), loc=(0, 0, 0.309))
    assign(tape, M['tape'])
    parts.append(tape)
    label = cube('label', (0.13, 0.004, 0.09), loc=(0.06, -0.181, 0.19))
    assign(label, M['paper'])
    parts.append(label)
    return finish(parts, 'carton')


def build_carton_open(M):
    """Delivery carton, OPEN: four flaps splayed up. What you see after [E] Open."""
    parts = []
    body = cube('body', (0.42, 0.36, 0.30), loc=(0, 0, 0.15))
    bevel(body, 0.006, 2)
    assign(body, M['kraft'])
    parts.append(body)
    for s in (-1, 1):
        flap = cube('flapY', (0.42, 0.010, 0.175),
                    loc=(0, s * 0.196, 0.375), rot=(s * 0.55, 0, 0))
        bevel(flap, 0.003, 2)
        assign(flap, M['kraft'])
        parts.append(flap)
        flapx = cube('flapX', (0.010, 0.36, 0.175),
                     loc=(s * 0.226, 0, 0.375), rot=(0, -s * 0.55, 0))
        bevel(flapx, 0.003, 2)
        assign(flapx, M['kraft'])
        parts.append(flapx)
    return finish(parts, 'carton_open')


def build_handtruck(M):
    """The red hand truck from ref 8 — the stockroom had nothing like it."""
    parts = []
    for s in (-1, 1):
        rail = cube('rail', (0.035, 0.035, 1.05), loc=(s * 0.16, 0, 0.56),
                    rot=(0.10, 0, 0))
        bevel(rail, 0.006, 2)
        assign(rail, M['darkmetal'])
        parts.append(rail)
    for z in (0.30, 0.70, 1.02):
        rung = cube('rung', (0.36, 0.030, 0.030), loc=(0, -0.055 + z * 0.10, z))
        bevel(rung, 0.005, 2)
        assign(rung, M['darkmetal'])
        parts.append(rung)
    toe = cube('toeplate', (0.38, 0.24, 0.018), loc=(0, 0.115, 0.035), rot=(0.06, 0, 0))
    bevel(toe, 0.004, 2)
    assign(toe, M['darkmetal'])
    parts.append(toe)
    for s in (-1, 1):
        wheel = cyl('wheel', 0.095, 0.045, loc=(s * 0.195, -0.02, 0.095),
                    rot=(0, math.pi / 2, 0), verts=14)
        assign(wheel, M['rubber'])
        parts.append(wheel)
        hub = cyl('hub', 0.030, 0.050, loc=(s * 0.195, -0.02, 0.095),
                  rot=(0, math.pi / 2, 0), verts=10)
        assign(hub, M['steel'])
        parts.append(hub)
        # The rails are TILTED 0.10 rad, so their tops land at y = -sin(0.10)*0.525
        # ~= -0.052, not y = 0. Putting the grips at y = +0.108 left them floating
        # in mid-air behind the truck. Sit them on the rail ends and stick out.
        grip = cyl('grip', 0.020, 0.12, loc=(s * 0.205, -0.052, 1.078),
                   rot=(0, math.pi / 2, 0), verts=8)
        assign(grip, M['rubber'])
        parts.append(grip)
    return finish(parts, 'handtruck')


# ================================================================ LIGHTING ===
def build_pendant(M):
    """Lantern pendant (refs 1/3/4): an iron cage with warm glass, on a chain.
    Was a flat black box with white panels. Pivot at the CEILING mount."""
    parts = []
    canopy = cyl('canopy', 0.055, 0.020, loc=(0, 0, -0.010), verts=12)
    bevel(canopy, 0.004, 2)
    assign(canopy, M['darkmetal'])
    parts.append(canopy)
    for i in range(4):
        link = torus('link', 0.016, 0.004, loc=(0, 0, -0.055 - i * 0.028),
                     rot=(math.pi / 2 * (i % 2), 0, 0), seg=10, mseg=5)
        assign(link, M['darkmetal'])
        parts.append(link)
    top = cyl('cap', 0.075, 0.030, loc=(0, 0, -0.185), verts=4)
    bevel(top, 0.006, 2)
    assign(top, M['darkmetal'])
    parts.append(top)
    # the cage: four corner posts, tapered — a lantern, not a box
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        post = cube('post', (0.014, 0.014, 0.24),
                    loc=(math.cos(a) * 0.072, math.sin(a) * 0.072, -0.320),
                    rot=(math.sin(a) * 0.10, -math.cos(a) * 0.10, 0))
        assign(post, M['darkmetal'])
        parts.append(post)
    glass = loft('glass', [
        ring_xy(-0.205, 0, 0, 0.070, 0.070, 4),
        ring_xy(-0.435, 0, 0, 0.090, 0.090, 4),
    ])
    assign(glass, M['glass'])
    parts.append(glass)
    base = cyl('base', 0.098, 0.022, loc=(0, 0, -0.448), verts=4)
    bevel(base, 0.005, 2)
    assign(base, M['darkmetal'])
    parts.append(base)
    finial = cyl('finial', 0.014, 0.040, loc=(0, 0, -0.478), verts=8)
    assign(finial, M['darkmetal'])
    parts.append(finial)
    return finish(parts, 'pendant')


# ==================================================================== main ===
if __name__ == '__main__':
    builders = [
        build_lounge_chair, build_office_chair, build_trophy,
        build_register, build_scanner, build_cardterm, build_printer,
        # The production drawer is built only by build_checkout_assets.py.  Keeping
        # this legacy builder in the list used to overwrite the interactive empty
        # drawer with welded notes and an incompatible fourth coin cup.
        build_carton, build_carton_open, build_handtruck, build_pendant,
    ]
    for b in builders:
        wipe()
        b(materials())
    print('\n=== BUILT %d PROPS -> %s ===' % (len(builders), OUT))
