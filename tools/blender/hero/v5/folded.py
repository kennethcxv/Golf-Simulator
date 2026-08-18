"""Folding a garment: the same pattern, laid flat and actually folded.

The brief on v4's four folded garments: "stacks of pillows -- uniform thickness,
every edge the same radius, too tall for their footprint, and no visible sleeve
folds, which is the single thing that says folded shirt." That is exactly right,
and it is right because v4's folded garments are literally that -- separate slab
objects arranged in a pile. There was never a sleeve to fold and never a neckline
to end up on top.

Here a folded garment is the SAME drafted pattern as its hanging twin, with its
trim already on it, laid flat and put through the sequence a shop assistant uses:

    1. fold the right sleeve in across the body
    2. fold the left sleeve in
    3. fold the right side of the body in, the sleeve riding on it
    4. fold the left side in
    5. fold the shoulders down over the hem, so the neck finishes on top

Each fold is a rotation through 180 degrees around a real hinge (see fold.py) and
the panels either side of it are RIGID -- so what comes out is flat faces meeting
at crisp lines, the sleeve folds show as stepped edges on the sides, and the neck
is visible on the top face. Those three things are the whole difference between a
folded shirt and a cushion.
"""

import math

import bmesh
import bpy
from mathutils import Vector

import fold as FD
import studio as ST


def lay_flat(ob, face_up=True):
    """Turn the hanging draft onto a table.

    The garment is drafted in the XZ plane running down in -z with its pressed
    depth in y. Laid flat, the length runs in +y from the neck and the depth
    becomes the stack's height. `face_up` puts the FRONT panel uppermost, which
    is what the folded reference shows -- the neck and the collar are on top.
    """
    s = -1.0 if face_up else 1.0
    for v in ob.data.vertices:
        x, y, z = v.co.x, v.co.y, v.co.z
        v.co = Vector((x, -z, s * y))
    ob.data.update()
    FD.lay_flat(ob, 0.0)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def centre_xy(ob):
    """Put the folded stack over the origin.

    Folding moves the garment sideways -- the first folded tee finished 120 mm
    off centre and floated beside its shelf rather than on it, which reads as a
    placement bug and is one.
    """
    (a, b), (c, d), _z = span(ob)
    dx, dy = (a + b) * 0.5, (c + d) * 0.5
    for v in ob.data.vertices:
        v.co.x -= dx
        v.co.y -= dy
    ob.data.update()
    return ob


def span(ob):
    xs = [v.co.x for v in ob.data.vertices]
    ys = [v.co.y for v in ob.data.vertices]
    zs = [v.co.z for v in ob.data.vertices]
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


def fold_shirt(ob, body_half, sleeve_r=0.0055, side_r=0.0085, last_r=0.0135,
               side_at=0.38, hood_at=None, hood_r=0.014, label=""):
    """The five folds. `body_half` is the body's half-width before folding.

    `hood_at` folds the hood down onto the back FIRST, which is the step a shop
    assistant does before anything else and which the first folded hoodie missed
    -- its hood stayed standing and the stack read as a rumpled bundle.
    """
    if hood_at is not None:
        FD.fold(ob, 'y', hood_at, hood_r, side=-1)
    (x0, x1), (y0, y1), _z = span(ob)
    steps = [
        dict(axis='x', cut=+body_half * 0.985, radius=sleeve_r, side=+1),
        dict(axis='x', cut=-body_half * 0.985, radius=sleeve_r, side=-1),
        dict(axis='x', cut=+body_half * side_at, radius=side_r, side=+1),
        dict(axis='x', cut=-body_half * side_at, radius=side_r, side=-1),
    ]
    FD.fold_seq(ob, steps)
    (x0, x1), (y0, y1), _z = span(ob)
    mid = (y0 + y1) * 0.5
    FD.fold(ob, 'y', mid, last_r, side=-1)
    FD.settle(ob, floor_z=0.0, sag=0.0022, corner=0.52)
    FD.press(ob)
    centre_xy(ob)
    (a, b), (c, d), (e, f) = span(ob)
    print("  fold %-14s %.0f x %.0f mm footprint, %.0f mm tall"
          % (label or ob.name, (b - a) * 1000, (d - c) * 1000, (f - e) * 1000))
    return ob


def fold_trousers(ob, leg_r=0.0075, last_r=0.0145, label=""):
    """Trousers fold differently: leg on leg, then in half, then in half again."""
    (x0, x1), (y0, y1), _z = span(ob)
    FD.fold(ob, 'x', (x0 + x1) * 0.5, leg_r, side=+1)
    # TWO FOLDS ACROSS, NOT THREE. Three put eight plies in the stack and the
    # free edges came off as a staircase, because a trouser leg TAPERS: every
    # ply is a different length and folding again multiplies the difference
    # rather than hiding it. The reference pair is folded leg-on-leg and then
    # once across, and it reads as a rectangle.
    (x0, x1), (y0, y1), _z = span(ob)
    FD.fold(ob, 'y', (y0 + y1) * 0.5, last_r * 1.25, side=+1)
    FD.settle(ob, floor_z=0.0, sag=0.0020, corner=0.50)
    FD.press(ob)
    centre_xy(ob)
    (a, b), (c, d), (e, f) = span(ob)
    print("  fold %-14s %.0f x %.0f mm footprint, %.0f mm tall"
          % (label or ob.name, (b - a) * 1000, (d - c) * 1000, (f - e) * 1000))
    return ob


def check_stack(ob, label=""):
    """A folded garment is WIDER THAN IT IS TALL, by a lot.

    The brief's word for v4's is "too tall for their footprint", so it is worth
    measuring rather than eyeballing: a folded tee on a shop table is about
    300 x 240 and 40 tall, which is a height of an eighth of its width. Anything
    over a third is a pile, not a fold.
    """
    (a, b), (c, d), (e, f) = span(ob)
    w = max(b - a, d - c)
    h = f - e
    ratio = h / max(1e-6, w)
    if ratio > 0.34:
        raise SystemExit(
            "FOLD FAILED: %s is %.0f mm tall on a %.0f mm footprint (%.2f). "
            "That is a pile, not a fold." % (label or ob.name, h * 1000,
                                             w * 1000, ratio))
    print("  stack %-13s %.0f mm on %.0f mm = %.2f" % (label or ob.name,
                                                       h * 1000, w * 1000,
                                                       ratio))
    return ratio


def shelf_shadow(ob, z=0.0):
    """Drop the folded garment so it rests on the shelf at z."""
    lo = min(v.co.z for v in ob.data.vertices)
    for v in ob.data.vertices:
        v.co.z += z - lo
    ob.data.update()
    return ob
