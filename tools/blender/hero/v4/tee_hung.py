"""TEE, HUNG -- v4. A cotton jersey T-shirt on a hanger.

Reference: qa/hero/v4/ref/tee-hung-ref1.jpg. Cotton jersey is the LIGHTEST
cloth in this set and behaves nothing like the hoodie's fleece: it is thin, it
hangs close, and its folds are small, numerous and sharp-cornered rather than
broad. That is one number in the cloth preset and three in the fold field, and
getting it wrong is what made every v3 shirt the same garment in different
sizes.

v3's faults, from qa/hero/v3/apparel/tee-hung/tee-hung-eevee-front.png:

  E1  A rigid slab body with cylindrical sleeves.
  E2  The neck rib is a torus laid on the shoulders.
  E3  The chest print is a flat CARD -- it carries its own background colour
      and a crisp rectangular border, so it reads as a sticker.
  E4  A level, rigid hem.

    blender --factory-startup -b --python tools/blender/hero/v4/tee_hung.py
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
import shirt as SH  # noqa: E402

REPO = os.getcwd()
OUT = os.path.join(REPO, "qa", "hero", "v4", "tee-hung")

NU = 72
HEM_Z = -0.712
CHEST_Z = -0.222

SPEC = dict(
    nu=NU, row_h=0.0160, body_n=3.5,
    hem_z=HEM_Z, chest_z=CHEST_Z,
    # jersey hangs CLOSE: 62 mm of half-depth against the polo's 72 and the
    # hoodie's 79. Thin cloth has nothing to hold it out.
    # 650 mm across a 510 mm chest is the polo's fault again -- sleeves
    # standing off the body. A tee on a hanger measures about 590.
    profile=[(-0.712, 0.255, 0.0530),
             (-0.620, 0.256, 0.0560),
             (-0.480, 0.256, 0.0595),
             (-0.350, 0.256, 0.0615),
             (-0.222, 0.255, 0.0620)],
    hem_lift=dict(front=0.0, side=0.012, back=0.004),
    ctrl_a=(0.262, 0.0730),
    ctrl_a_z=dict(front=-0.172, side=-0.142, back=-0.164),
    shoulder=(0.222, 0.0690),
    shoulder_z=dict(front=-0.114, side=-0.040, back=-0.098),
    ctrl_b=(0.166, 0.0705),
    ctrl_b_z=dict(front=-0.068, side=-0.011, back=-0.050),
    neck=(0.0925, 0.0755), neck_cy=0.008,
    neck_z=dict(front=-0.040, side=0.003, back=0.010),
    yoke_a=8, yoke_b=7,
    arm_u=6, arm_v=(1, 8),
    pin_rows=(9, 14), pin_cols=10,
    pin_soft=0.038, pin_fade=0.170, pin_free_z=-0.620,
    jitter=0.0014, seed=7.7,
)

CLOTH_T = 0.0016             # jersey, and it shows at the hem


BAR_DROP = 0.034             # the bar sits INSIDE the neck, not above it
# just inside the shoulder point (0.222) so the tips cannot poke through
HANGER_HALF = 0.1935
HANGER_Z = -0.004 - BAR_DROP


def bar_z(x):
    # Shapes the hanger only. The garment's shoulder comes from the yoke in
    # SPEC and the pin group, NOT from this -- there is no hanger collider.
    #
    # The crew neckline is at z = -0.040 at centre front and the bar was at
    # -0.004, so the hanger crossed the neck opening 36 mm ABOVE it and hid
    # the collar behind a chrome tube from every front camera. A hanger goes
    # inside the shirt.
    return -0.004 - BAR_DROP - 0.045 * (min(abs(x), 0.202) / 0.202) ** 1.35


def _sweep(name, pts, halfw, halfh, sides=10):
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
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def hanger():
    """The shop's black moulded hanger.

    Every reference board -- hoodie, polo, tee, and the retail racks behind
    all three -- hangs its stock on the same black moulded hanger with a
    chrome hook. A white wire tube was the one part of each hung render that
    was visibly not shop stock.
    """
    return ST.top_hanger(half_w=HANGER_HALF, z=HANGER_Z, drop=0.048,
                         y=-0.004, hook_h=0.092)


def neckband(body, neck_idx):
    """The ribbed crew collar, as a ROLLED EDGE round the neck opening.

    v3 used a torus floating on the shoulders and the note said "not a torus",
    so this was rebuilt as a flat 18 mm strip lying on the yoke -- and a flat
    strip lying on a near-horizontal yoke is edge-on from every camera in
    front of the garment. It rendered as nothing at all, which is worse: the
    board's DETAIL crop is 40% ribbed collar and it is the first thing that
    says jersey tee rather than sheet of cloth.

    The right object is neither. A crew neck is a strip of 1x1 rib folded
    double and sewn round the opening, so its section is a ROLL: it turns up
    out of the neckline, over, and back down onto the yoke, standing about
    4 mm proud with the fold as its silhouette. Twenty-eight ribs across it,
    in geometry, because at 72 columns the body cannot carry them.
    """
    ring = [Vector(body.data.vertices[i].co) for i in neck_idx]
    n_ring = len(ring)
    c = sum(ring, Vector()) / n_ring
    NA = 4 * n_ring                      # 288 columns: the ribs need them
    NV = 10
    ROLL_R = 0.0042                      # half the folded band's thickness
    WIDTH = 0.0190                       # 19 mm of rib showing
    RIBS = 96

    def at(a):
        """the neckline, resampled to NA columns"""
        g = a * n_ring / NA
        k0 = int(g) % n_ring
        k1 = (k0 + 1) % n_ring
        return ring[k0].lerp(ring[k1], g - int(g))

    rows = []
    for j in range(NV + 1):
        v = j / NV
        row = []
        for i in range(NA):
            b = at(i)
            nrm = Vector((b.x - c.x, b.y - c.y, 0.0))
            nrm = nrm.normalized() if nrm.length > 1e-6 else Vector((0, 1, 0))
            # a half-turn of the roll: in and up, over the fold, out and down
            th = math.pi * v
            out = -math.cos(th) * ROLL_R
            up = math.sin(th) * ROLL_R
            # ... and the whole roll walks outward over the yoke as it goes
            walk = WIDTH * v
            rib = 0.00055 * math.cos(RIBS * 2 * math.pi * i / NA) \
                * math.sin(math.pi * v) ** 0.5
            p = (b + nrm * (out + walk + rib)
                 + Vector((0, 0, up - 0.0088 * v * v)))
            row.append(tuple(p))
        rows.append(row)
    ob = D.grid_mesh("neckband", rows, wrap_u=True)
    D.shade_smooth(ob, 26.0)
    return ob


def chest_print(body):
    """Ink ON the jersey, following it.

    E3 is the fault that turned up on four separate v3 garments: a flat quad
    carrying its own background colour, so the print arrived with a rectangle
    round it. A print has no border and no thickness worth speaking of -- it
    is a patch of the shirt with a different colour and a slightly stiffer
    hand, so it is conformed to the cloth and lifted by a third of a
    millimetre.
    """
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromPolygons(
        [v.co.copy() for v in body.data.vertices],
        [tuple(p.vertices) for p in body.data.polygons])
    CX, CZ, R = 0.0, -0.352, 0.0245
    NA, NR = 48, 14
    rows = []
    for j in range(NR + 1):
        rr = R * (j / NR)
        row = []
        for i in range(NA):
            a = 2 * math.pi * i / NA
            # a rounded shield, not a disc -- a circle reads as a badge
            x = CX + rr * math.sin(a)
            z = CZ + rr * math.cos(a) * 0.96
            hit, nrm, _i, _d = bvh.ray_cast(Vector((x, -0.50, z)),
                                            Vector((0.0, 1.0, 0.0)), 1.2)
            if hit is None:
                hit, nrm = Vector((x, -0.060, z)), Vector((0, -1, 0))
            nrm = (Vector(nrm) * 0.45 + Vector((0, -1, 0)) * 0.55).normalized()
            # IT HAS TO CLEAR THE SHELL *AND* THE FOLDS BETWEEN ITS SAMPLES.
            # At 0.34 mm the print sat inside a body solidified to 1.6 mm and
            # only shards surfaced. At 0.55 mm past the shell it cleared the
            # shell but not the cloth bulging between its 4 mm samples on a
            # 16 mm grid, so the jersey punched white holes through the ink.
            row.append(tuple(hit + nrm * (CLOTH_T * 0.5 + 0.0017)))
        rows.append(row)
    ob = D.grid_mesh("print", rows, wrap_u=True)
    D.shade_smooth(ob, 50.0)
    # NO RING. The board's hung tee carries no roundel at all and its folded
    # sibling carries a small line-art flag; an outlined filled disc is a
    # badge, and a badge is what E3 was about.
    # (kept, empty, so the caller's signature does not change)
    ring = []
    for i in range(49):
        a = 2 * math.pi * i / 48.0
        x = CX + R * 1.10 * math.sin(a)
        z = CZ + R * 1.10 * math.cos(a) * 0.96
        hit, nrm, _i, _d = bvh.ray_cast(Vector((x, -0.50, z)),
                                        Vector((0.0, 1.0, 0.0)), 1.2)
        if hit is None:
            continue
        nrm = (Vector(nrm) * 0.45 + Vector((0, -1, 0)) * 0.55).normalized()
        ring.append(hit + nrm * (CLOTH_T * 0.5 + 0.0017))
    rg = D.topstitch("print_ring", ring, radius=0.0021, sides=8)
    D.shade_smooth(rg, 46.0)

    # A PLAIN DISC IS A STAIN, NOT A PRINT. The reference tees all carry a
    # graphic inside the field; a flat coloured circle reads as a mark on the
    # cloth. A flag on a pole and two crossed clubs is the club's device and
    # it is four runs of ink.
    def at(ux, uz):
        hit, nrm, _i, _d = bvh.ray_cast(
            Vector((CX + ux * R, -0.50, CZ + uz * R * 0.94)),
            Vector((0.0, 1.0, 0.0)), 1.2)
        if hit is None:
            return None
        nrm = (Vector(nrm) * 0.45 + Vector((0, -1, 0)) * 0.55).normalized()
        return hit + nrm * (CLOTH_T * 0.5 + 0.0023)

    marks = []
    def run(name, pts, r=0.00135):
        got = [p for p in (at(*q) for q in pts) if p is not None]
        if len(got) > 2:
            o = D.topstitch(name, got, radius=r, sides=7)
            D.shade_smooth(o, 46.0)
            marks.append(o)

    run("mk_pole", [(-0.10, -0.62 + 1.28 * (i / 8.0)) for i in range(9)])
    run("mk_flag_a", [(-0.10 + 0.46 * (i / 6.0),
                       0.62 - 0.10 * math.sin(math.pi * i / 6.0))
                      for i in range(7)], r=0.00120)
    run("mk_flag_b", [(-0.10 + 0.46 * (i / 6.0),
                       0.30 + 0.08 * math.sin(math.pi * i / 6.0))
                      for i in range(7)], r=0.00120)
    run("mk_flag_c", [(0.36, 0.30 + 0.32 * (i / 4.0)) for i in range(5)],
        r=0.00115)
    run("mk_club_a", [(-0.44 + 0.80 * (i / 6.0), -0.20 - 0.34 * (i / 6.0))
                      for i in range(7)], r=0.00125)
    run("mk_club_b", [(0.36 - 0.80 * (i / 6.0), -0.20 - 0.34 * (i / 6.0))
                      for i in range(7)], r=0.00125)
    return ob, rg, marks


def hem_stitch(body):
    out = []
    for side in (-1.0, 1.0):
        pts = []
        for i in range(33):
            x = -0.240 + 0.480 * (i / 32.0)
            p = D.on_surface(body, x, HEM_Z + 0.019, out=0.0010, axis_y=side)
            if p is not None:
                pts.append(p)
        if len(pts) > 4:
            ob = D.topstitch("hem%+.0f" % side, pts, radius=0.00050)
            D.shade_smooth(ob, 40.0)
            out.append(ob)
    return out


def jersey_material(colour=(0.5400, 0.5250, 0.4900)):
    mat = bpy.data.materials.new("TeeJersey")
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Roughness"].default_value = 0.93
    if "Sheen Weight" in b.inputs:
        b.inputs["Sheen Weight"].default_value = 0.11
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.22
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 520.0
    n.inputs["Detail"].default_value = 6.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.06
    bump.inputs["Distance"].default_value = 0.0009
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
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
    made.append(ST.shop_floor(lo.z - 0.55))
    made.append(ST.shop_wall(0.95, lo.z - 0.55))
    made += ST.duplicate_along(subject,
                               [(-0.74, 0.008, -0.003), (-0.37, -0.005, 0.002),
                                (0.37, 0.004, -0.002), (0.74, -0.008, 0.001)],
                               rot_jitter=0.075, scale_jitter=0.011)
    mid = Vector((0.0, 0.0, centre.z))
    ST.garment_lights(centre=(0.0, 0.0, mid.z + 0.30), scale=1.28, warm=True)
    ST.world_value(0.035)
    for label, az, el, d in (("retail", -90, 4, 3.00),
                             ("retail-q34", -124, 9, 2.85)):
        cam = H.camera(label, H.orbit_position(mid, d, az, el), mid, lens=62.0)
        H.render(cam, os.path.join(OUT, "tee-hung-v4-%s.png" % label),
                 res=(1360, 900))
    return made


def main():
    args = H.argv_after_dashes()
    H.reset_scene()
    os.makedirs(OUT, exist_ok=True)

    sh = SH.Shirt(SPEC)
    body = sh.shell("tee")
    SH.audit(body, "shell", allow_nonmanifold=0)
    sh.openings()
    print("  %d verts hard on the hanger" % sh.pin())
    hg = list(hanger())
    if "nosim" not in args:
        moved, spikes = sh.solve("jersey", frames=90)
        print("  DRAPE max travel %.0f mm, despiked %d" % (moved * 1000, spikes))

    parts = []
    for sign in (+1, -1):
        parts.append(sh.sleeve(
            # A TEE SLEEVE DROPS. Bowing the path out 42 mm before it falls
            # makes a cap sleeve standing off the shoulder; in the reference
            # the sleeve's outer edge carries on down the line of the body and
            # tapers hard to its hem.
            # A tee sleeve does not taper to a tube. The armhole is about
            # 460 mm round and the cuff about 340: three quarters, not half.
            sign, "sleeve%d" % sign, drop=0.206, axis_x=0.259,
            outer=0.0570, depth=0.0455,
            section=[(0.00, 1.00, 1.00), (0.45, 0.90, 0.92),
                     (0.82, 0.79, 0.84), (1.00, 0.74, 0.81)],
            rows=18, cuff_t=0.84, cuff_pinch=0.045,
            fold=(0.062, 0.034), bow=0.026,
            # 3.4 mm is two thicknesses of jersey and a hair. At 7.2 the
            # sleeve stood off the body far enough that a slot of BACKGROUND
            # showed through at the armhole, and the sleeve read as a flap
            # bolted to a slab rather than as part of the shirt.
            clear=0.0034, hem_curl=0.017))
    sh.join(parts)
    SH.audit(body, "assembled")

    # JERSEY FOLDS ARE SMALL AND MANY. The hoodie's nine broad folds on this
    # cloth would read as upholstery; thin cotton buckles at a much shorter
    # wavelength and the creases are sharper.
    D.drape_folds(body, amp=1.0, z_top=-0.175, z_bot=HEM_Z,
                  harmonics=[(13, 0.0094, 1.2), (7, 0.0067, -0.7),
                             (22, 0.0034, 1.9)],
                  seed=4.9, side_bias=0.34,
                  pred=lambda co: co.z < -0.175,
                  gate=lambda co: 1.0 - D._smooth(abs(co.x), 0.165, 0.225))

    nb = neckband(body, sh.neck_idx)
    pr, prr, marks = chest_print(body)
    # THE BOARD'S HUNG TEE CARRIES NO ROUNDEL. Its folded sibling has a small
    # line-art flag and that is the whole of the branding on this garment; a
    # filled disc with an outline round it is a badge, which is fault E3 in a
    # different colour. The disc and its ring go; the flag stays.
    for dead in (pr, prr):
        bpy.data.objects.remove(dead, do_unlink=True)
    pr = prr = None
    hs = hem_stitch(body)

    D.solidify(body, CLOTH_T, offset=0.0)
    D.solidify(nb, 0.0019, offset=0.0)
    body = D.apply_all(body)
    nb = D.apply_all(nb)
    for o in (body, nb):
        D.shade_smooth(o, 50.0)

    cloth = jersey_material()
    rib = jersey_material((0.4600, 0.4460, 0.4150))
    ink = jersey_material((0.0640, 0.1450, 0.1050))
    body.data.materials.append(cloth)
    nb.data.materials.append(rib)

    for m in marks:
        m.data.materials.append(ink)
    for o in hs:
        o.data.materials.append(rib)

    subject = [body, nb] + list(marks) + list(hs) + hg
    print("tee-hung v4: TRIS %d" % D.tri_count(subject))
    # ob.bound_box is CACHED and the fold fields transform vertices
    # directly, so nothing refreshes it in background mode -- every
    # camera then frames where the garment used to be.
    bpy.context.view_layer.update()
    lo, hi = H.bounds(subject)
    print("  %.0f x %.0f x %.0f mm" % ((hi.x - lo.x) * 1000,
                                       (hi.y - lo.y) * 1000,
                                       (hi.z - lo.z) * 1000))

    H.set_engine("CYCLES" if "cycles" in args else "EEVEE", samples=96)

    ST.exposure(-0.86)
    centre = (lo + hi) * 0.5
    _c, radius = H.subject_sphere(subject)
    ST.garment_lights(centre=centre, scale=radius)
    ST.world_value(0.030)
    H.backdrop(center=centre, scale=radius)
    dist = H.fit_view(subject, centre, Vector((0, 1, 0)), 80.0,
                      res=(820, 1000), margin=1.10)
    for label, az, el in (("front", -90, 2), ("q34", -128, 8),
                          ("side", -180, 3), ("back", 90, 3)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre,
                       lens=80.0)
        H.render(cam, os.path.join(OUT, "tee-hung-v4-%s.png" % label),
                 res=(820, 1000))

    bd = bpy.data.objects.get("Backdrop")
    if bd is not None:
        bpy.data.objects.remove(bd, do_unlink=True)
    ST.world_value(0.055)
    tight = H.fit_view(subject, centre, Vector((0, 1, 0)), 80.0,
                       res=(860, 1040), margin=1.09)
    cam = H.camera("compare", H.orbit_position(centre, tight, -90, 1), centre,
                   lens=80.0)
    H.render(cam, os.path.join(OUT, "tee-hung-v4-compare.png"),
             res=(860, 1040))

    made = retail(subject, centre)
    for ob in made:
        bpy.data.objects.remove(ob, do_unlink=True)
    if "noexport" not in args:
        GLB = os.path.join(REPO, "Assets", "models", "hero", "v4")
        os.makedirs(GLB, exist_ok=True)
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(GLB, "apparel_tee_hung.glb"))
    print("renders in", OUT)


if __name__ == "__main__":
    main()
