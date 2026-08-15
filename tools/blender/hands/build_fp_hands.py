# PLAYTEST 5, ITEM 6.1 — THE FIRST-PERSON HAND, MODELLED.
#
#   blender --factory-startup -b --python tools/blender/hands/build_fp_hands.py
#
# (No --noaudio. Blender 5.1 consumes it as a filename and exits having done
# nothing, which cost this project two runs that looked like hangs.)
#
# WHY THIS SHAPE OF SCRIPT. The hand is ARTICULATED: src/render3d/fpHands.js
# poses it by writing joint rotations every time a tool changes, and five poses
# depend on that. So this cannot export "a hand" -- a single posed mesh would be
# rigid in the hand's one job. It exports ONE MESH PER JOINT SEGMENT, each with
# its origin AT THAT JOINT'S PIVOT, so the runtime can drop them into the joint
# hierarchy that already exists and the pose maths is untouched.
#
# WHAT MAKES A CAPSULE READ AS A CAPSULE, from the reference photograph:
#   * a capsule is CIRCULAR in section; a finger is ~1.3x wider than it is deep
#   * a capsule is UNIFORM along its length; a phalanx tapers toward the tip
#   * a capsule has no KNUCKLE; a real finger bulges at each joint, which is what
#     catches the light and makes the segments read as one finger rather than
#     three sausages
#   * a capsule meets its neighbour with a visible seam; overlapping the joint
#     spheres closes it
#
# Each of those is a parameter below rather than a modelling gesture, so the shape
# is reproducible and adjustable from the report's numbers.

import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector

OUT = os.path.join(os.getcwd(), "Assets", "hands")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)


def new_mesh(name):
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob, me


def finish(ob, me, bm, smooth=True):
    # THE AXIS, BAKED INTO THE VERTICES. Settled with a marker probe rather than
    # guessed -- three markers, one per candidate Blender axis, read back off the
    # exported glTF accessor bounds:
    #
    #     Blender -Z  ->  glTF -Y      (what the first build did: fingers pointed down)
    #     Blender +Y  ->  glTF -Z      <- the axis fpHands lays fingers along
    #     Blender +X  ->  glTF +X
    #
    # So the parts are authored along -Z for readability (it matches the runtime's
    # own axis) and rotated into Blender +Y HERE, in the vertex data. Not as an
    # object rotation: the exporter reported `nodeRot: null` on every probe, so it
    # bakes transforms -- and the runtime swap takes GEOMETRY ONLY, so anything
    # left at node level would be silently dropped. That is what beat the second
    # attempt, where an object-level rotate-and-apply left the parts wrong and cut
    # the drawable count from 72 to 22.
    for v in bm.verts:
        x, y, z = v.co.x, v.co.y, v.co.z
        v.co = Vector((x, -z, y))
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob.data = me
    return ob


def ring(bm, centre, half_w, half_d, segments, verts_out):
    """One elliptical cross-section. Ellipse, not circle: that single change is
    most of what stops a finger reading as a tube."""
    ring_verts = []
    for i in range(segments):
        a = (i / segments) * math.tau
        v = bm.verts.new((
            centre.x + math.cos(a) * half_w,
            centre.y + math.sin(a) * half_d,
            centre.z,
        ))
        ring_verts.append(v)
    verts_out.append(ring_verts)
    return ring_verts


def bridge(bm, a, b):
    n = len(a)
    for i in range(n):
        bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))


def cap(bm, ring_verts, centre, flip=False):
    c = bm.verts.new(centre)
    n = len(ring_verts)
    for i in range(n):
        tri = (ring_verts[i], ring_verts[(i + 1) % n], c)
        bm.faces.new(tri if not flip else tuple(reversed(tri)))
    return c


def segment(name, length, base_w, base_d, tip_w, tip_d,
            knuckle_bulge=0.14, tip_round=True, sections=7, segments=12):
    """A phalanx: origin at the JOINT, running down -Z, tapering, with a bulge at
    the base where the knuckle is and a rounded tip.

    -Z because that is the axis fpHands already lays fingers along; keeping it
    means the authored part drops into the existing joint with no rotation."""
    ob, me = new_mesh(name)
    bm = bmesh.new()
    rings = []
    for s in range(sections):
        t = s / (sections - 1)
        # taper from base to tip
        w = base_w + (tip_w - base_w) * t
        d = base_d + (tip_d - base_d) * t
        # THE KNUCKLE. A raised cosine over the first third: widest right at the
        # joint, gone by mid-segment. Without it three segments read as three
        # separate objects however well they are placed.
        if t < 0.34:
            bulge = knuckle_bulge * (0.5 + 0.5 * math.cos((t / 0.34) * math.pi))
            w *= 1.0 + bulge
            d *= 1.0 + bulge * 0.72
        z = -length * t
        ring(bm, Vector((0, 0, z)), w, d, segments, rings)
    # close the base flat against the previous joint (hidden inside the bulge)
    cap(bm, rings[0], (0, 0, 0.0006), flip=True)
    for i in range(len(rings) - 1):
        bridge(bm, rings[i], rings[i + 1])
    if tip_round:
        # a rounded fingertip, built as two shrinking rings and a point rather
        # than a hemisphere, so it stays elliptical all the way to the end
        last = rings[-1]
        z = -length
        for k, (sw, sd, dz) in enumerate(((0.78, 0.80, 0.28), (0.44, 0.47, 0.46))):
            r = ring(bm, Vector((0, 0, z - tip_w * dz)), tip_w * sw, tip_d * sd, segments, rings)
            bridge(bm, last, r)
            last = r
        cap(bm, last, (0, 0, z - tip_w * 0.62))
    else:
        cap(bm, rings[-1], (0, 0, -length))
    return finish(ob, me, bm)


def palm(name, width, depth, length, mirror=1.0):
    """The palm: a rounded wedge that is THICKER on the thumb side (the thenar
    mass) and thinner at the outer edge, and slightly cupped. A box or a scaled
    sphere reads as a paddle; the asymmetry is what makes it read as a hand."""
    ob, me = new_mesh(name)
    bm = bmesh.new()
    rings = []
    sections = 8
    segments = 14
    for s in range(sections):
        t = s / (sections - 1)
        # narrows toward the fingers, and the wrist end is rounded off
        w = width * (0.62 + 0.38 * math.sin(math.pi * (0.28 + 0.72 * t)))
        d = depth * (0.74 + 0.26 * math.sin(math.pi * t))
        z = length * (0.18 - t)
        rv = []
        for i in range(segments):
            a = (i / segments) * math.tau
            cx = math.cos(a) * w
            cy = math.sin(a) * d
            # THENAR: build out the thumb side of the palm, strongest at the wrist
            thenar = 0.30 * w * max(0.0, math.cos(a) * mirror) * (1.0 - t) ** 0.8
            # CUP: the palm face is slightly hollow, the back slightly domed
            cup = -0.16 * d * max(0.0, -math.sin(a)) * math.sin(math.pi * t)
            rv.append(bm.verts.new((cx + thenar * mirror, cy + cup, z)))
        rings.append(rv)
    cap(bm, rings[0], (0, 0, length * 0.18 + depth * 0.35), flip=True)
    for i in range(len(rings) - 1):
        bridge(bm, rings[i], rings[i + 1])
    cap(bm, rings[-1], (0, 0, length * (0.18 - 1.0) - depth * 0.20))
    return finish(ob, me, bm)


def forearm(name, length, wrist_w, wrist_d, elbow_w, elbow_d):
    """Wrist to sleeve. Runs +Z (back toward the camera), oval and flattening
    toward the wrist, which is what makes the wrist read as a wrist."""
    ob, me = new_mesh(name)
    bm = bmesh.new()
    rings = []
    sections = 6
    segments = 14
    for s in range(sections):
        t = s / (sections - 1)
        w = wrist_w + (elbow_w - wrist_w) * t
        d = wrist_d + (elbow_d - wrist_d) * t
        ring(bm, Vector((0, 0, length * t)), w, d, segments, rings)
    cap(bm, rings[0], (0, 0, -wrist_d * 0.4), flip=True)
    for i in range(len(rings) - 1):
        bridge(bm, rings[i], rings[i + 1])
    cap(bm, rings[-1], (0, 0, length + 0.004))
    return finish(ob, me, bm)


# --------------------------------------------------------------- the hand
# Dimensions are the ones fpHands already uses, so the authored parts drop into
# the existing joints without moving a pivot. FINGERS[i] = (length, thickness).
FINGERS = [
    ("Index", 0.070, 0.0182),
    ("Middle", 0.076, 0.0190),
    ("Ring", 0.070, 0.0176),
    ("Little", 0.058, 0.0158),
]

built = []
for fname, flen, fthick in FINGERS:
    # proportions from the runtime: prox 0.40 of length, mid 0.34, dist 0.26
    built.append(segment(f"{fname}Prox", flen * 0.40, fthick * 0.50, fthick * 0.40,
                         fthick * 0.46, fthick * 0.37))
    built.append(segment(f"{fname}Mid", flen * 0.34, fthick * 0.46, fthick * 0.37,
                         fthick * 0.42, fthick * 0.34))
    built.append(segment(f"{fname}Dist", flen * 0.26, fthick * 0.42, fthick * 0.34,
                         fthick * 0.34, fthick * 0.29, knuckle_bulge=0.09))

built.append(segment("ThumbProx", 0.032, 0.0116, 0.0098, 0.0104, 0.0088))
built.append(segment("ThumbDist", 0.027, 0.0104, 0.0088, 0.0086, 0.0076, knuckle_bulge=0.08))
built.append(palm("Palm", 0.0335, 0.0165, 0.082, mirror=1.0))
built.append(forearm("Forearm", 0.115, 0.0210, 0.0158, 0.0295, 0.0250))

# AXIS. The parts are authored running down -Z because that is the axis fpHands
# lays fingers along -- but `export_yup=True` converts Blender Z-up to glTF Y-up,
# mapping (x, y, z) -> (x, z, -y), so an authored -Z arrives in the runtime as +Y
# and every finger points at the ceiling. Photographed: the first build put the
# fingers out as straight rods away from the shaft, worse than the capsules.
#
# Rotating +90 deg about X and APPLYING it before export sends -Z to +Y, which the
# yup conversion then sends back to -Z. Done here rather than by authoring along
# +Y so the section functions above still read in the axis the runtime uses.
tris = 0
for ob in built:
    tris += sum(len(p.vertices) - 2 for p in ob.data.polygons)

path = os.path.join(OUT, "fp_hand.glb")
bpy.ops.export_scene.gltf(
    filepath=path,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    use_selection=False,
)
print(f"HANDS_OK parts={len(built)} triangles={tris} -> {path}")
