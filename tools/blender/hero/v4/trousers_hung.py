"""TROUSERS, HUNG -- v4. Golf chinos on a clamp hanger.

Reference: qa/hero/v4/ref/trousers-hung-ref1.png (a wire clamp hanger gripping
a pair of trousers, showing the clamp bar and how the cloth hangs off it) and
-ref2.jpg (stone chinos laid flat: waistband, belt loops, fly and button,
curved slash pockets at the hips, front pleats, a straight leg with a slight
taper, plain hems).

What v3 got wrong -- from qa/hero/v3/apparel/trousers-hung/trousers-hung-eevee-hero.png:

  T1  TWO EXTRUDED TUBES. Perfectly straight, perfectly parallel, constant
      taper, no drape at all. It read as PVC pipe.
  T2  The waistband was a hard cylinder ring stuck on the top.
  T3  Belt loops were floating rods at random angles, not attached to anything.
  T4  "Pockets" were two little sausages laid diagonally across the hips.
  T5  The crotch was a hard V notch cut between the tubes.
  T6  No fly, no button, no seams, no crease.
  T7  The hanger was a flat oval plate with a hook -- not a clamp, and not
      touching the waistband.
  T8  Turn-ups were flat rings round the bottom of each pipe.

THE TOPOLOGY IS THE WHOLE PROBLEM, and it is why v3 gave up and used tubes. A
pair of trousers is a surface with THREE boundaries -- one waist, two hems --
and no single lofted tube has that. It cannot be built by sweeping a section
down a path, which is the only thing v3's library could do.

Built here as a SEAT that tucks under two LEGS: the seat's section tapers from
the hip down to the envelope of the two thighs and its bottom boundary is a
lambda whose apex is the crotch, so the legs emerge from under it without a
seam line crossing them. The legs run up inside the seat where nothing can see
them.

    blender --factory-startup -b --python tools/blender/hero/v4/trousers_hung.py
        [-- nosim | noexport | cycles]
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import drape as D  # noqa: E402
import stage as ST  # noqa: E402

REPO = os.getcwd()
OUT = os.path.join(REPO, "qa", "hero", "v4", "trousers-hung")

# --------------------------------------------------------------------------
# MEASUREMENTS -- men's 32 x 32 golf chino, in metres. Waistband top is z = 0.

NU = 64
Z_WAIST_BOT = -0.042         # the waistband is 42 mm deep
Z_HIP = -0.215
Z_CROTCH = -0.298            # apex of the seat's lambda
Z_SEAT_SIDE = -0.445         # ... and where its edge dies on the thigh
Z_KNEE = -0.690
Z_HEM = -1.050

# seat: half-width / half-depth against height
# CLAMPED AT THE WAIST, TROUSERS HANG FLAT. The first cut carried a 112 mm
# half-depth through the hip, which is a body's dimension, not a garment's --
# it rendered as jodhpurs. The clamp presses the band nearly shut and the
# depth only opens up where the two legs are inside.
SEAT_PROFILE = [
    (-0.445, 0.203, 0.0735),
    (-0.330, 0.216, 0.0790),
    (-0.215, 0.224, 0.0800),
    (-0.100, 0.216, 0.0605),
    (-0.042, 0.209, 0.0425),
    (0.000, 0.208, 0.0390),
]
SEAT_N = 3.2

LEG_X = 0.1075               # each leg's axis
# THE BOARD'S LEGS TAPER. 103.5 at the thigh down to 81.5 at the hem is very
# nearly a straight tube and it read as loose slacks; a golf trouser closes to
# about two thirds of its thigh width, and the taper is most of what says
# "tailored" before any seam is visible.
LEG_PROFILE = [              # half-width / half-depth against height
    (-1.050, 0.0672, 0.0520),
    (-0.690, 0.0790, 0.0625),
    (-0.445, 0.0925, 0.0730),
    (-0.230, 0.1035, 0.0830),
]
LEG_N = 2.9
LEG_TOP = -0.230             # runs up INSIDE the seat

CLOTH_T = 0.0026             # chino is thinner than fleece


def lerp2(table, z):
    if z <= table[0][0]:
        return table[0][1], table[0][2]
    if z >= table[-1][0]:
        return table[-1][1], table[-1][2]
    for (z0, a0, b0), (z1, a1, b1) in zip(table, table[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            t = t * t * (3 - 2 * t)
            return a0 + (a1 - a0) * t, b0 + (b1 - b0) * t
    return table[-1][1], table[-1][2]


def se(hw, hd, th, n):
    sx, sy = math.sin(th), -math.cos(th)
    x = hw * math.copysign(abs(sx) ** (2.0 / n), sx) if sx else 0.0
    y = hd * math.copysign(abs(sy) ** (2.0 / n), sy) if sy else 0.0
    return x, y


def seat_bottom_z(th):
    """The seat's lower boundary: a lambda with its apex at the crotch.

    Straight across, the seat's edge would draw a line over both thighs where
    no seam exists. Dipping to the sides it dies exactly where the thigh
    surface is, and rising to the centre it becomes the crotch.
    """
    side = abs(math.sin(th)) ** 1.25
    return Z_CROTCH + (Z_SEAT_SIDE - Z_CROTCH) * side


def seat_rows():
    """Rows that END ON THE LAMBDA.

    Cutting the boundary by skipping quads leaves a STAIRCASE -- the edge can
    only turn at a quad corner, and at 16 mm columns that is a flight of steps
    right across the front of the garment, which is exactly how it rendered.
    Running each column's rows from the waist down to ITS OWN bottom z makes
    the boundary the curve itself.
    """
    NV = 30
    rows = []
    for j in range(NV + 1):
        t = j / NV
        row = []
        for k in range(NU):
            th = 2 * math.pi * k / NU
            z = seat_bottom_z(th) * t
            hw, hd = lerp2(SEAT_PROFILE, z)
            x, y = se(hw, hd, th, SEAT_N)
            # the last few rows duck INWARD so the boundary finishes under the
            # leg surface instead of floating in front of it
            # THE RIM HAS TO END UP INSIDE THE LEG. At 5.5% the seat was
            # still 20 mm wider than the thigh where it stopped, and its
            # 2.6 mm solidified edge hung outside as two rectangular flaps
            # that read as saddlebags.
            duck = D._smooth(t, 0.78, 1.0)
            row.append((x * (1 - 0.125 * duck), y * (1 - 0.20 * duck), z))
        rows.append(row)
    return rows


def leg_rows(sign):
    zs, z = [], LEG_TOP
    while z > Z_HEM + 1e-6:
        zs.append(z)
        z -= 0.0175
    zs.append(Z_HEM)
    rows = []
    for z in zs:
        hw, hd = lerp2(LEG_PROFILE, z)
        row = []
        for k in range(NU):
            th = 2 * math.pi * k / NU
            x, y = se(hw, hd, th, LEG_N)
            # the legs hang together and swing very slightly forward
            # A HANGING LEG IS NOT A PLUMB LINE. Chino is stiff but it still
            # sways, and two dead-straight parallel columns is the tell that
            # made v3's read as pipe. Each leg wanders a few millimetres, and
            # the two wander differently.
            g = D._smooth(-z, 0.30, 1.05)
            sway = (0.0075 * math.sin((-z) * 5.4 + (1.9 if sign > 0 else 0.3))
                    + 0.0034 * math.sin((-z) * 11.1 - sign * 2.2)) * g
            cx = sign * LEG_X - sign * 0.012 * g + sway
            cy = (-0.006 * D._smooth(-z, 0.25, 1.05)
                  + 0.0050 * math.sin((-z) * 4.1 + sign * 1.1) * g)
            row.append((cx + x, cy + y, z))
        rows.append(row)
    return rows


# --------------------------------------------------------------------------


def clamp_hanger():
    """A wire clamp hanger gripping the waistband, as in the reference.

    v3 hung these off a flat oval plate that touched nothing. A clamp hanger is
    a wire frame and a bar, and the bar has to be ON the cloth.
    """
    parts = []
    BAR_Z = -0.020
    # A CLAMP GRIPS. The first cut put the bar at y = -101 mm and the waistband
    # front is at -40, so it floated 60 mm off the cloth holding nothing.
    for sy, nm in ((-0.0505, "front"), (0.0505, "back")):
        bar = _sweep(f"clamp_bar_{nm}",
                     [Vector((-0.198, sy, BAR_Z)), Vector((0.198, sy, BAR_Z))],
                     0.0082, 0.0125, sides=10)
        bar.data.materials.append(
            ST.matte(f"ClampBar{nm}", (0.58, 0.47, 0.30), 0.55))
        parts.append(bar)

    wire = []
    for sx in (-1, 1):
        wire += [Vector((sx * 0.168, -0.0505, BAR_Z + 0.004)),
                 Vector((sx * 0.168, -0.0505, BAR_Z + 0.058)),
                 Vector((sx * 0.150, -0.040, BAR_Z + 0.092)),
                 Vector((sx * 0.052, -0.026, BAR_Z + 0.108))]
    frame = _sweep("clamp_frameL", wire[:4], 0.0024, 0.0024, sides=8)
    frame2 = _sweep("clamp_frameR", wire[4:], 0.0024, 0.0024, sides=8)
    hook = []
    for i in range(30):
        a = math.pi * 1.10 * (i / 29.0) - math.pi * 0.05
        hook.append(Vector((0.0230 * math.sin(a) * 0.86, -0.026,
                            0.128 + 0.0230 * (1 - math.cos(a)))))
    stem = _sweep("clamp_hook",
                  [Vector((0.0, -0.026, BAR_Z + 0.100)),
                   Vector((0.0, -0.026, 0.128))] + hook[1:], 0.0026, 0.0026,
                  sides=8)
    for w in (frame, frame2, stem):
        w.data.materials.append(ST.metal("ClampWire", (0.70, 0.71, 0.73), 0.22))
        parts.append(w)
    for p in parts:
        D.shade_smooth(p, 40.0)
    return parts


def _sweep(name, pts, halfw, halfh, sides=10, close=True):
    import bmesh
    rows = []
    for i, p in enumerate(pts):
        tan = (pts[min(len(pts) - 1, i + 1)] - pts[max(0, i - 1)])
        tan = tan.normalized() if tan.length > 1e-9 else Vector((1, 0, 0))
        e1 = tan.cross(Vector((0, 1, 0)))
        if e1.length < 1e-6:
            e1 = tan.cross(Vector((0, 0, 1)))
        e1.normalize()
        e2 = tan.cross(e1).normalized()
        rows.append([tuple(p + e1 * (halfh * math.cos(2 * math.pi * k / sides))
                           + e2 * (halfw * math.sin(2 * math.pi * k / sides)))
                     for k in range(sides)])
    ob = D.grid_mesh(name, rows, wrap_u=True)
    if close:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
        bm.to_mesh(ob.data)
        bm.free()
    return ob


def belt_loops(body):
    """Seven loops, standing off the waistband and sewn top and bottom."""
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromPolygons([v.co.copy() for v in body.data.vertices],
                               [tuple(p.vertices) for p in body.data.polygons])
    out = []
    for i, th in enumerate((0.0, 0.62, 1.30, math.pi - 0.62, math.pi,
                            math.pi + 0.62, 2 * math.pi - 0.62)):
        pts, ok = [], True
        for j in range(7):
            z = -0.002 - 0.048 * (j / 6.0)
            hw, hd = lerp2(SEAT_PROFILE, z)
            x, y = se(hw, hd, th, SEAT_N)
            d = Vector((x, y, 0.0))
            if d.length < 1e-6:
                ok = False
                break
            n = d.normalized()
            # the middle of the loop stands off; the two ends are sewn down
            bow = math.sin(math.pi * (j / 6.0)) ** 0.7
            pts.append(Vector((x, y, z)) + n * (0.0058 * bow - 0.0012))
        if not ok:
            continue
        lp = _sweep(f"loop{i}", pts, 0.0090, 0.0022, sides=8)
        D.shade_smooth(lp, 44.0)
        out.append(lp)
    return out


def fly_and_pockets(body):
    """The lines that say TROUSERS: a fly, a waistband seam, two curved slash
    pockets, and a pressed crease down the front of each leg.

    All of it is a GROOVE in the cloth, not a tube laid on top. v3's pockets
    were two sausages across the hips, which is what happens when the only
    tool is a swept cylinder.
    """
    me = body.data
    for v in me.vertices:
        p = v.co
        depth = 0.0
        # waistband seam, all the way round
        depth = max(depth, 0.0034 * math.exp(-((p.z - Z_WAIST_BOT) / 0.0042) ** 2))
        # THE BAND IS STIFFENED, so it stands a couple of millimetres proud of
        # the cloth below it -- without that it is just a seam and the eye
        # reads one continuous panel from clamp to crotch.
        if p.z > Z_WAIST_BOT:
            depth -= 0.0034 * D._smooth(p.z, Z_WAIST_BOT, Z_WAIST_BOT + 0.008)
        if p.y < 0.0:                                    # FRONT only
            # the fly: a vertical seam right of centre, from the band down
            fy = math.exp(-((p.x - 0.017) / 0.0060) ** 2)
            fz = D._smooth(p.z, -0.185, -0.160) * (1.0 - D._smooth(p.z, -0.050, -0.042))
            depth = max(depth, 0.0042 * fy * fz)
            # ... and its topstitch, 12 mm out
            ty = math.exp(-((p.x - 0.029) / 0.0030) ** 2)
            depth = max(depth, 0.0019 * ty * fz)
            # slash pockets: a curve from the waistband seam out to the hip
            for sx in (-1, 1):
                t = max(0.0, min(1.0, (p.z + 0.048) / -0.150))
                px = sx * (0.088 + 0.108 * t ** 0.72)
                depth = max(depth, 0.0040
                            * math.exp(-((p.x - px) / 0.0075) ** 2)
                            * D._smooth(t, 0.02, 0.10)
                            * (1.0 - D._smooth(t, 0.86, 1.0)))
        if p.z < Z_CROTCH:
            # the pressed crease, front and back of each leg
            for sx in (-1, 1):
                # a RIDGE, and wide enough that a 16 mm column grid can
                # actually resolve it -- at sigma 7.5 mm only one column
                # moved and the crease was invisible
                cr = math.exp(-((p.x - sx * LEG_X) / 0.0155) ** 2)
                # A PRESSED CREASE IS A HARD EDGE. At 2.4 mm on a 105 mm leg
                # it is a shading nuance; the board reads the trousers by this
                # line before it reads the pockets or the fly.
                depth -= 0.0052 * cr
        d = Vector((p.x, p.y, 0.0))
        if d.length > 1e-6:
            v.co = p - d.normalized() * depth


def seam_lines(body):
    """Fly, pocket mouths, waistband and hems as real thread.

    Displacement cannot do these: the seams are 1-2 mm wide and the mesh has
    16 mm between columns, so every groove `fly_and_pockets` cut came out
    invisible. Thread lying on the cloth is both cheaper and correct.
    """
    out = []

    def run(name, pts, side=-1.0, r=0.00110):
        got = []
        for (x, z) in pts:
            p = D.on_surface(body, x, z, out=0.0013, axis_y=side)
            if p is not None:
                got.append(p)
        if len(got) < 3:
            return
        ob = D.topstitch(name, got, radius=r)
        D.shade_smooth(ob, 40.0)
        out.append(ob)

    # the waistband seam, front and back
    for side in (-1.0, 1.0):
        run(f"seam_band{side:+.0f}",
            [(-0.204 + 0.408 * i / 40.0, Z_WAIST_BOT) for i in range(41)],
            side=side, r=0.00125)
    # the fly, and its topstitch curving in at the bottom
    fly = [(0.017, -0.045 - 0.128 * (i / 18.0)) for i in range(19)]
    fly += [(0.017 - 0.017 * math.sin(math.pi * 0.5 * (i / 6.0)),
             -0.173 - 0.010 * (i / 6.0)) for i in range(1, 7)]
    run("seam_fly", fly, r=0.00115)
    run("seam_fly_top", [(x + 0.0125, z) for (x, z) in fly[:19]], r=0.00092)
    # the two slash pockets
    for sx in (-1, 1):
        pk = []
        for i in range(19):
            t = i / 18.0
            pk.append((sx * (0.083 + 0.112 * t ** 0.74), -0.050 - 0.150 * t))
        run(f"seam_pocket{sx:+d}", pk, r=0.00080)
    # the hems
    for sx in (-1, 1):
        for side in (-1.0, 1.0):
            run(f"seam_hem{sx:+d}{side:+.0f}",
                [(sx * LEG_X - 0.081 + 0.162 * i / 16.0, Z_HEM + 0.030)
                 for i in range(17)], side=side, r=0.00070)
    return out


def button(centre, normal, r=0.0072, t=0.0022):
    import bmesh
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=t, vertices=16,
                                        location=centre)
    b = bpy.context.object
    b.name = "fly_button"
    n = Vector(normal).normalized()
    b.rotation_mode = 'QUATERNION'
    b.rotation_quaternion = n.to_track_quat('Z', 'Y')
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bm = bmesh.new()
    bm.from_mesh(b.data)
    bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=0.0007,
                    segments=2, affect='EDGES')
    bm.to_mesh(b.data)
    bm.free()
    D.shade_smooth(b, 34.0)
    return b


# --------------------------------------------------------------------------


def build():
    args = H.argv_after_dashes()
    H.reset_scene()

    seat = D.grid_mesh("seat", seat_rows(), wrap_u=True)

    legs = [D.grid_mesh(f"leg{s}", leg_rows(s), wrap_u=True) for s in (-1, 1)]
    bpy.ops.object.select_all(action='DESELECT')
    for o in legs:
        o.select_set(True)
    seat.select_set(True)
    bpy.context.view_layer.objects.active = seat
    bpy.ops.object.join()
    body = seat
    body.name = "trousers"
    D.weld(body, 2e-5)
    D.jitter(body, 0.0011, seed=4.3)

    # chino is a woven: it holds its shape and folds in a few broad places
    D.drape_folds(body, amp=1.0, z_top=-0.230, z_bot=Z_HEM,
                  harmonics=[(7, 0.0082, 0.7), (13, 0.0036, -1.1),
                             (4, 0.0054, 0.35)],
                  seed=3.1, side_bias=0.42,
                  pred=lambda co: co.z < -0.230)
    D.drape_folds(body, amp=1.0, z_top=-0.060, z_bot=-0.300,
                  harmonics=[(9, 0.0030, 0.4)], seed=2.2, side_bias=0.30,
                  pred=lambda co: -0.300 < co.z < -0.060)
    fly_and_pockets(body)
    D.cleanup(body)
    return body, args


def main():
    body, args = build()
    os.makedirs(OUT, exist_ok=True)

    stitches = seam_lines(body)
    loops = belt_loops(body)
    # The board's hanger is the shop's black moulded clamp hanger, the same
    # family as the hoodie/polo/tee hangers. The wire-and-wood one read as
    # something out of a dry cleaner's.
    hb, hs = ST.clamp_hanger(half_w=0.196, z=0.022, y=0.0, grip=0.158,
                             hook_h=0.112)
    hanger = [hb, hs]
    hw0, hd0 = lerp2(SEAT_PROFILE, -0.030)
    btn = button((0.017, -hd0 - 0.0016, -0.030), (0.0, -1.0, 0.0))

    D.solidify(body, CLOTH_T, offset=0.0)
    body = D.apply_all(body)
    D.shade_smooth(body, 44.0)

    cloth = chino_material()
    body.data.materials.append(cloth)
    for lp in loops:
        lp.data.materials.append(cloth)
    btn.data.materials.append(ST.matte("FlyButton", (0.30, 0.24, 0.15), 0.42))

    # thread is not the same colour as the cloth it is sewn with -- at the
    # identical albedo every seam in the garment was a silhouette-free groove
    # and the render read as one smooth grey tube from clamp to hem
    thread = chino_material((0.1180, 0.1090, 0.0885))
    for st in stitches:
        st.data.materials.append(thread)
    subject = [body, *loops, *stitches, btn, *hanger]
    print(f"trousers-hung v4: TRIS {D.tri_count(subject)}")
    # ob.bound_box is CACHED and the fold fields transform vertices
    # directly, so nothing refreshes it in background mode -- every
    # camera then frames where the garment used to be.
    bpy.context.view_layer.update()
    lo, hi = H.bounds(subject)
    print(f"  {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} x "
          f"{(hi.z - lo.z) * 1000:.0f} mm")

    H.set_engine("CYCLES" if "cycles" in args else "EEVEE", samples=96)

    ST.exposure(-0.20)
    centre = (lo + hi) * 0.5
    _c, radius = H.subject_sphere(subject)
    dist = H.fit_view(subject, centre, Vector((0, 1, 0)), 80.0,
                      res=(700, 1180), margin=1.10)
    ST.garment_lights(centre=centre, scale=radius)
    ST.world_value(0.030)
    H.backdrop(center=centre, scale=radius)
    for label, az, el in (("front", -90, 2), ("q34", -128, 7),
                          ("side", -180, 3), ("back", 90, 3)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre,
                       lens=80.0)
        H.render(cam, os.path.join(OUT, f"trousers-hung-v4-{label}.png"),
                 res=(700, 1180))
    for label, at, d in (("detail-waist", Vector((0.0, -0.05, -0.075)), 0.60),
                         ("detail-hem", Vector((0.0, -0.02, -0.960)), 0.62)):
        cam = H.camera(label, H.orbit_position(at, d, -96, 8), at, lens=64.0)
        H.render(cam, os.path.join(OUT, f"trousers-hung-v4-{label}.png"),
                 res=(880, 720))

    bd = bpy.data.objects.get("Backdrop")
    if bd is not None:
        bpy.data.objects.remove(bd, do_unlink=True)
    ST.world_value(0.055)
    tight = H.fit_view(subject, centre, Vector((0, 1, 0)), 80.0,
                       res=(720, 1200), margin=1.09)
    cam = H.camera("compare", H.orbit_position(centre, tight, -90, 1), centre,
                   lens=80.0)
    H.render(cam, os.path.join(OUT, "trousers-hung-v4-compare.png"),
             res=(720, 1200))

    made = retail(subject, centre)
    for ob in made:
        bpy.data.objects.remove(ob, do_unlink=True)
    if "noexport" not in args:
        GLB = os.path.join(REPO, "Assets", "models", "hero", "v4")
        os.makedirs(GLB, exist_ok=True)
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(GLB, "apparel_trousers_hung.glb"))
    print("renders in", OUT)


def chino_material(colour=(0.196, 0.176, 0.138)):
    """Woven cotton twill: crisper than fleece, a touch of sheen off the twill."""
    mat = bpy.data.materials.new("ChinoTwill")
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Roughness"].default_value = 0.86
    if "Sheen Weight" in b.inputs:
        b.inputs["Sheen Weight"].default_value = 0.055
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.30
    tw = nt.nodes.new("ShaderNodeTexNoise")
    tw.inputs["Scale"].default_value = 420.0
    tw.inputs["Detail"].default_value = 6.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.045
    bump.inputs["Distance"].default_value = 0.0012
    nt.links.new(tw.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return mat


def retail(subject, centre):
    for n in ("Backdrop", "key", "fill", "rim", "top", "under"):
        ob = bpy.data.objects.get(n)
        if ob is not None:
            bpy.data.objects.remove(ob, do_unlink=True)
    # ob.bound_box is CACHED and the fold fields transform vertices
    # directly, so nothing refreshes it in background mode -- every
    # camera then frames where the garment used to be.
    bpy.context.view_layer.update()
    lo, hi = H.bounds(subject)
    made = list(ST.rail(hi.z - 0.010, x0=-1.30, x1=1.30))
    made.append(ST.shop_floor(lo.z - 0.16))
    made.append(ST.shop_wall(0.95, lo.z - 0.16))
    made += ST.duplicate_along(subject,
                               [(-0.76, 0.008, -0.003), (-0.38, -0.005, 0.002),
                                (0.38, 0.004, -0.002), (0.76, -0.008, 0.001)],
                               rot_jitter=0.065, scale_jitter=0.010)
    mid = Vector((0.0, 0.0, centre.z))
    ST.garment_lights(centre=(0.0, 0.0, mid.z + 0.30), scale=1.45, warm=True)
    ST.world_value(0.035)
    for label, az, el, d in (("retail", -90, 3, 3.60),
                             ("retail-q34", -124, 8, 3.30)):
        cam = H.camera(label, H.orbit_position(mid, d, az, el), mid, lens=62.0)
        H.render(cam, os.path.join(OUT, f"trousers-hung-v4-{label}.png"),
                 res=(1360, 900))
    return made


if __name__ == "__main__":
    main()
