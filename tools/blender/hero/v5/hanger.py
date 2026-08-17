"""The hanger, the trouser clamp and the peg -- as Image1.png shows them.

The previous board showed black moulded shop hangers and v4 built those. THIS
reference shows something different in every hung cell, and it is not a detail:
a flat LIGHT WOOD hanger, a shallow shoulder bar with square-cut ends, a short
turned neck and a bright CHROME hook bent into a fat open question mark. Against
a white cell the wood is the only warm thing in the frame and it reads as retail
immediately; a black hanger against white reads as a wardrobe.

The bar profile is measured off the reference cells: the shoulder line drops
about a sixth of its half-width from centre to tip, the bar is roughly 13 mm
deep and 22 mm tall at centre, and the ends are cut square rather than turned up.
"""

import math

import bpy
from mathutils import Vector

import studio as ST


def wood_hanger(half_w=0.196, z=0.0, drop=0.036, y=0.0, hook_h=0.108,
                name="hanger", tone=(0.372, 0.252, 0.140)):
    """A flat wooden hanger with a chrome hook.

    `z` is the TOP edge of the shoulder bar at centre -- the line the garment
    lies on -- and the bar falls `drop` to the tips.
    """
    N = 26
    prof = []
    for i in range(N + 1):
        u = -1.0 + 2.0 * i / N
        e = abs(u)
        prof.append(Vector((u * half_w, y, z - drop * (e ** 1.30))))

    rows = []
    SIDES = 12
    for i, p in enumerate(prof):
        e = abs(-1.0 + 2.0 * i / N)
        hh = 0.5 * (0.0224 - 0.0106 * e ** 1.4)
        hw = 0.5 * 0.0132
        nxt = prof[min(N, i + 1)]
        prv = prof[max(0, i - 1)]
        tan = (nxt - prv)
        tan = tan.normalized() if tan.length > 1e-9 else Vector((1, 0, 0))
        e2 = Vector((0.0, 1.0, 0.0))
        e1 = e2.cross(tan).normalized()
        c = p - e1 * hh
        row = []
        for k in range(SIDES):
            a = 2 * math.pi * k / SIDES
            sx, sy = math.cos(a), math.sin(a)
            # square section with a small radius: a planed hanger, not a dowel
            row.append(tuple(c
                             + e1 * (hh * math.copysign(abs(sx) ** 0.30, sx))
                             + e2 * (hw * math.copysign(abs(sy) ** 0.30, sy))))
        rows.append(row)
    bar = ST.grid(name + "_bar", rows, wrap_u=True)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(bar.data)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(bar.data)
    bm.free()

    post = ST.box(name + "_post", (0.0, y, z + 0.013),
                  (0.0062, 0.0058, 0.0155), bevel=0.0016)
    body = ST.join(name, [bar, post])
    ST.smooth_by_angle(body, 26.0)
    body.data.materials.append(ST.wood(name + "Wood", tone, span_mm=400.0))

    hp = [Vector((0.0, y, z + 0.020)), Vector((0.0, y, z + 0.034))]
    for i in range(21):
        a = math.pi * 1.30 * (i / 20.0) - 0.12
        hp.append(Vector((0.0232 * math.sin(a) * 0.92, y - 0.0014,
                          z + hook_h - 0.0232 * math.cos(a) * 0.94)))
    hook = ST.sweep(name + "_hook", hp, 0.0031, 0.0031, sides=10)
    ST.smooth_by_angle(hook, 34.0)
    hook.data.materials.append(ST.chrome(name + "Hook"))
    return body, hook


def clamp_hanger(half_w=0.170, z=0.0, y=0.0, grip=0.140, hook_h=0.104,
                 name="clamphanger", tone=(0.372, 0.252, 0.140)):
    """The trouser hanger: a flat wooden bar with two sprung jaws.

    The waistband is GRIPPED, not draped over a rail. Draped is how a towel
    hangs and it left the v4 trousers reading as a folded pair of legs.
    """
    parts = [ST.box(name + "_bar", (0.0, y, z), (half_w, 0.0068, 0.0118),
                    bevel=0.0016)]
    for sx in (-1, 1):
        parts.append(ST.box("%s_jaw%+d" % (name, sx),
                            (sx * grip, y, z - 0.0232),
                            (0.0160, 0.0102, 0.0166), bevel=0.0018))
    body = ST.join(name, parts)
    ST.smooth_by_angle(body, 26.0)
    body.data.materials.append(ST.wood(name + "Wood", tone, span_mm=360.0))

    steel = []
    for sx in (-1, 1):
        bpy.ops.mesh.primitive_cylinder_add(
            radius=0.0029, depth=0.0122, vertices=12,
            rotation=(0.0, math.pi / 2, 0.0),
            location=(sx * grip, y - 0.0106, z - 0.0148))
        s = bpy.context.object
        s.name = "%s_spring%+d" % (name, sx)
        steel.append(s)
    hp = [Vector((0.0, y, z + 0.008)), Vector((0.0, y, z + 0.024))]
    for i in range(21):
        a = math.pi * 1.30 * (i / 20.0) - 0.12
        hp.append(Vector((0.0232 * math.sin(a) * 0.92, y - 0.0014,
                          z + hook_h - 0.0232 * math.cos(a) * 0.94)))
    steel.append(ST.sweep(name + "_hook", hp, 0.0031, 0.0031, sides=10))
    st = ST.join(name + "_steel", steel)
    ST.smooth_by_angle(st, 34.0)
    st.data.materials.append(ST.chrome(name + "Steel"))
    return body, st


def wall_peg(y=0.0, z=0.0, length=0.108, name="peg"):
    """A chrome peg out of a shop wall, with a ball end."""
    pts = [Vector((0.0, y, z)), Vector((0.0, y - length * 0.55, z - 0.004)),
           Vector((0.0, y - length, z - 0.016))]
    rod = ST.sweep(name + "_rod", pts, 0.0058, 0.0058, sides=12)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0102, segments=18,
                                         ring_count=12,
                                         location=(0.0, y - length, z - 0.017))
    ball = bpy.context.object
    ball.name = name + "_ball"
    base = ST.box(name + "_base", (0.0, y + 0.004, z), (0.019, 0.006, 0.019),
                  bevel=0.0022)
    ob = ST.join(name, [rod, ball, base])
    ST.smooth_by_angle(ob, 34.0)
    ob.data.materials.append(ST.chrome(name + "Chrome", rough=0.22))
    return ob


def shelf(z=0.0, y=0.0, half_w=0.34, half_d=0.20, name="Shelf",
          tone=(0.545, 0.470, 0.372)):
    """A pale wood shop shelf for the folded stacks to sit on.

    Image1.png's folded cells sit on nothing -- pure white -- but a stack with no
    ground under it has no contact shadow, and the contact shadow is most of what
    says the pile is resting rather than floating. A shelf lip also gives the
    front fold edge something to be crisp against.
    """
    top = ST.box(name, (0.0, y, z - 0.009), (half_w, half_d, 0.009),
                 bevel=0.0022)
    ST.smooth_by_angle(top, 26.0)
    top.data.materials.append(ST.wood(name + "Wood", tone, rough=0.52,
                                      span_mm=680.0))
    return top
