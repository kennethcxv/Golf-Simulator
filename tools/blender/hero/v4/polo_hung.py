"""POLO, HUNG -- v4. A pique golf polo on a hanger.

Reference: qa/hero/v4/ref/polo-hung-ref1.jpg (a blue polo worn: the collar's
stand and fall, its points, the three-button placket ending in a box, and the
turned band on the short sleeve) and -ref2.jpg (pique knit close to).

v3's faults, from qa/hero/v3/apparel/polo-hung/polo-hung-eevee-front.png:

  P1  A huge stiff PONCHO with cylinder sleeves projecting sideways.
  P2  The collar is a rigid crescent laid on top of the shoulders -- no stand,
      no fall, no points, and it does not meet the placket.
  P3  The placket is a raised luggage strap.
  P4  Buttons are studs.
  P5  A level hem. A polo's hem drops at the centres and rides up at the
      vents.
  P6  No side vents.

Body, yoke, armholes and sleeves come from `shirt.py`, which is the hoodie's
machinery extracted once it worked. The collar, the placket, the buttons, the
vents, the shirt-tail hem and the pique are this garment's own, and it gets
its own review against its own photograph.

    blender --factory-startup -b --python tools/blender/hero/v4/polo_hung.py
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
OUT = os.path.join(REPO, "qa", "hero", "v4", "polo-hung")

NU = 72
HEM_Z = -0.720
CHEST_Z = -0.225

SPEC = dict(
    nu=NU, row_h=0.0162, body_n=3.3,
    hem_z=HEM_Z, chest_z=CHEST_Z,
    # 658 mm across against a 540 mm chest plus sleeves is BOXY. A polo on a
    # hanger measures about 600; the extra came from sleeves standing too far
    # off the body and a chest carried at its full flat width all the way down.
    # A POLO IS CUT WITH SHAPE. Straight-sided from chest to hem reads as a
    # sack; the real one narrows a little through the waist and opens again
    # over the hip.
    profile=[(-0.720, 0.253, 0.0578),
             (-0.640, 0.255, 0.0600),
             (-0.520, 0.247, 0.0622),
             (-0.380, 0.252, 0.0672),
             (-0.225, 0.263, 0.0705)],
    hem_lift=dict(front=0.0, side=0.046, back=0.010),
    ctrl_a=(0.276, 0.0845),
    ctrl_a_z=dict(front=-0.176, side=-0.145, back=-0.168),
    shoulder=(0.225, 0.0800),
    shoulder_z=dict(front=-0.118, side=-0.042, back=-0.102),
    ctrl_b=(0.163, 0.0815),
    ctrl_b_z=dict(front=-0.072, side=-0.012, back=-0.054),
    neck=(0.0885, 0.0715), neck_cy=0.010,
    neck_z=dict(front=-0.034, side=0.004, back=0.011),
    yoke_a=8, yoke_b=7,
    arm_u=6, arm_v=(1, 8),
    pin_rows=(9, 14), pin_cols=10,
    pin_soft=0.048, pin_fade=0.170, pin_free_z=-0.615,
    jitter=0.0013, seed=5.1,
)

CLOTH_T = 0.0021
# THE COLLAR'S ENDS MEET THE PLACKET. At 0.255 rad the two points stopped
# short of it and left a hole at the centre front you could see the hanger
# through.
COLLAR_GAP = 0.140           # radians of neckline the placket takes
PLACKET_LEN = 0.152
PLACKET_HW = 0.0165


# just inside the shoulder point (0.225) so the tips cannot poke through
HANGER_HALF = 0.1965
HANGER_Z = -0.004


def bar_z(x):
    return -0.004 - 0.046 * (min(abs(x), 0.205) / 0.205) ** 1.35


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


def collar(body, neck_idx):
    """A collar is a band with a STAND, a FALL and two POINTS.

    v3's was a rigid crescent laid on the shoulders. The real thing leaves the
    neckline going up and slightly out, folds back on itself, and comes down
    and outward over the yoke -- its cross-section is a hairpin, so the
    silhouette at the back is the FOLD, not a cut edge. At the front the two
    ends run out into points that lie almost flat on the chest.
    """
    ring = [Vector(body.data.vertices[i].co) for i in neck_idx]
    c = sum(ring, Vector()) / len(ring)
    NUC, NVC = 56, 9
    rows = []
    for j in range(NVC + 1):
        v = j / NVC
        row = []
        for i in range(NUC + 1):
            a = i / NUC
            th = COLLAR_GAP + a * (2 * math.pi - 2 * COLLAR_GAP)
            k = int(round(th / (2 * math.pi) * len(ring))) % len(ring)
            b = Vector(ring[k])
            n = Vector((b.x - c.x, b.y - c.y, 0.0))
            n = n.normalized() if n.length > 1e-6 else Vector((0, 1, 0))
            # the points: the last 18% at each end lies flatter and reaches out
            e = min(a, 1.0 - a) / 0.18
            pt = 1.0 - min(1.0, e) ** 1.3
            # A BIGGER COLLAR. Beside the board the wings read as thin tabs
            # near the neck: the board's collar is a broad band whose fold
            # throws a shadow the whole way round and whose points come down
            # ONTO the chest to frame the placket.
            stand_h = 0.0345 * (1.0 - 0.70 * pt)
            fall_h = 0.0455 + 0.0210 * pt
            fall_out = 0.0330 + 0.0215 * pt
            fold = b + Vector((0, 0, stand_h)) + n * 0.0055
            tip = (b + Vector((0, 0, stand_h - fall_h))
                   + n * (0.0055 + fall_out))
            p = SH.bez(b, fold, tip, v)
            p = p + n * (0.0042 * math.sin(math.pi * v) * (1.0 - 0.5 * pt))
            row.append(tuple(p))
        rows.append(row)
    ob = D.grid_mesh("collar", rows)
    D.shade_smooth(ob, 48.0)
    return ob


def _button(centre, normal, r=0.0053, t=0.0016):
    import bmesh
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=t, vertices=14,
                                        location=centre)
    b = bpy.context.object
    b.name = "button"
    n = Vector(normal).normalized()
    b.rotation_mode = 'QUATERNION'
    b.rotation_quaternion = n.to_track_quat('Z', 'Y')
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bm = bmesh.new()
    bm.from_mesh(b.data)
    bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=0.0005,
                    segments=2, affect='EDGES')
    bm.to_mesh(b.data)
    bm.free()
    D.shade_smooth(b, 34.0)
    return b


def placket(body):
    """Two overlapping strips with three buttons.

    Tucked at its sides and its foot like the hoodie's pocket, for the same
    reason: carried out to the boundary, the clearance the panel needs to
    stand off the body becomes a cliff all the way round it.
    """
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromPolygons(
        [v.co.copy() for v in body.data.vertices],
        [tuple(p.vertices) for p in body.data.polygons])
    Z0 = -0.030
    NX, NY = 12, 26
    rows = []
    for jy in range(NY + 1):
        v = jy / NY
        z = Z0 - PLACKET_LEN * v
        row = []
        for ix in range(NX + 1):
            u = ix / NX
            x = -PLACKET_HW + 2 * PLACKET_HW * u
            hit, nrm, _i, _d = bvh.ray_cast(Vector((x, -0.50, z)),
                                            Vector((0.0, 1.0, 0.0)), 1.2)
            if hit is None:
                continue
            nrm = (Vector(nrm) * 0.3 + Vector((0, -1, 0)) * 0.7).normalized()
            edge = min(D._smooth(u, 0.0, 0.16), D._smooth(1 - u, 0.0, 0.16),
                       D._smooth(1 - v, 0.0, 0.045))
            lift = -0.0016 + (CLOTH_T * 0.5 + 0.0022) * edge
            lift += 0.0011 * D._smooth(u, 0.44, 0.56) * edge
            row.append(tuple(hit + nrm * lift))
        if len(row) == NX + 1:
            rows.append(row)
    pl = D.grid_mesh("placket", rows)
    D.shade_smooth(pl, 48.0)

    studs = []
    for i in range(3):
        z = Z0 - 0.026 - 0.048 * i
        hit, nrm, _i, _d = bvh.ray_cast(Vector((0.0, -0.50, z)),
                                        Vector((0.0, 1.0, 0.0)), 1.2)
        if hit is None:
            continue
        studs.append(_button(hit + Vector((0, -0.0050, 0)), (0, -1, 0)))
    box = []
    zb = Z0 - PLACKET_LEN + 0.004
    for i in range(13):
        t = i / 12.0
        x = -PLACKET_HW * 0.86 + 2 * PLACKET_HW * 0.86 * t
        hit, _n, _i, _d = bvh.ray_cast(Vector((x, -0.50, zb)),
                                       Vector((0.0, 1.0, 0.0)), 1.2)
        if hit is not None:
            box.append(hit + Vector((0, -0.0034, 0)))
    if len(box) > 4:
        ob = D.topstitch("placket_box", box, radius=0.00058)
        D.shade_smooth(ob, 40.0)
        studs.append(ob)
    return pl, studs


def vents(body):
    """A short stitched slit at each side seam, where the hem rides up."""
    out = []
    for sx in (-1, 1):
        for side in (-1.0, 1.0):
            pts = []
            for i in range(9):
                t = i / 8.0
                z = HEM_Z + 0.046 + 0.052 * t
                p = D.on_surface(body, sx * 0.252, z, out=0.0012, axis_y=side)
                if p is not None:
                    pts.append(p)
            if len(pts) > 4:
                ob = D.topstitch("vent%+d%+.0f" % (sx, side), pts,
                                 radius=0.00062)
                D.shade_smooth(ob, 40.0)
                out.append(ob)
    return out


def pique_material():
    """Pique knit: crisper than jersey, its waffle at a scale the eye reads as
    texture rather than as a pattern."""
    mat = bpy.data.materials.new("PoloPique")
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.0225, 0.0640, 0.1180, 1.0)
    b.inputs["Roughness"].default_value = 0.905
    if "Sheen Weight" in b.inputs:
        b.inputs["Sheen Weight"].default_value = 0.10
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.28
    waffle = nt.nodes.new("ShaderNodeTexNoise")
    waffle.inputs["Scale"].default_value = 260.0
    waffle.inputs["Detail"].default_value = 4.0
    waffle.inputs["Roughness"].default_value = 0.42
    fine = nt.nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 820.0
    mixn = nt.nodes.new("ShaderNodeMix")
    mixn.data_type = "FLOAT"
    mixn.inputs["Factor"].default_value = 0.40
    nt.links.new(waffle.outputs["Fac"], mixn.inputs[2])
    nt.links.new(fine.outputs["Fac"], mixn.inputs[3])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.085
    bump.inputs["Distance"].default_value = 0.0013
    nt.links.new(mixn.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    # RESTRAINED COLOUR MICROVARIATION, at the scale of the yarn.
    # Flat albedo is most of why cloth reads as moulded plastic: the bump only
    # moves the normal, so a surface facing the key at one angle is one flat
    # value across the whole panel. Coarse noise on colour reads as dirt --
    # scale 88 on the hoodie came out as camouflage -- so this sits an order
    # of magnitude finer and a fraction as strong.
    _v = nt.nodes.new("ShaderNodeTexNoise")
    _v.inputs["Scale"].default_value = 560.0
    _v.inputs["Detail"].default_value = 5.0
    _v.inputs["Roughness"].default_value = 0.52
    _c = b.inputs["Base Color"].default_value
    _t = nt.nodes.new("ShaderNodeMix")
    _t.data_type = "RGBA"
    _t.inputs["A"].default_value = (_c[0] * 0.885, _c[1] * 0.885,
                                    _c[2] * 0.885, 1.0)
    _t.inputs["B"].default_value = (_c[0] * 1.115, _c[1] * 1.115,
                                    _c[2] * 1.115, 1.0)
    nt.links.new(_v.outputs["Fac"], _t.inputs["Factor"])
    nt.links.new(_t.outputs[2], b.inputs["Base Color"])

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
                               [(-0.78, 0.008, -0.003), (-0.39, -0.005, 0.002),
                                (0.39, 0.004, -0.002), (0.78, -0.008, 0.001)],
                               rot_jitter=0.070, scale_jitter=0.011)
    mid = Vector((0.0, 0.0, centre.z))
    ST.garment_lights(centre=(0.0, 0.0, mid.z + 0.30), scale=1.30, warm=True)
    ST.world_value(0.035)
    for label, az, el, d in (("retail", -90, 4, 3.10),
                             ("retail-q34", -124, 9, 2.95)):
        cam = H.camera(label, H.orbit_position(mid, d, az, el), mid, lens=62.0)
        H.render(cam, os.path.join(OUT, "polo-hung-v4-%s.png" % label),
                 res=(1360, 900))
    return made


def main():
    args = H.argv_after_dashes()
    H.reset_scene()
    os.makedirs(OUT, exist_ok=True)

    sh = SH.Shirt(SPEC)
    body = sh.shell("polo")
    SH.audit(body, "shell", allow_nonmanifold=0)
    sh.openings()
    print("  %d verts hard on the hanger" % sh.pin())
    hg = list(hanger())
    if "nosim" not in args:
        moved, spikes = sh.solve("pique", frames=90)
        print("  DRAPE max travel %.0f mm, despiked %d" % (moved * 1000, spikes))

    parts = []
    for sign in (+1, -1):
        parts.append(sh.sleeve(
            # A POLO SLEEVE STOPS AT MID-BICEP. At 206 mm of drop it hung
            # nearly to the elbow, and at 0.83 of the armhole it stayed nearly
            # as wide the whole way -- the board's tapers hard and ends high.
            sign, "sleeve%d" % sign, drop=0.186, axis_x=0.256,
            outer=0.0455, depth=0.0420,
            section=[(0.00, 1.00, 1.00), (0.45, 0.91, 0.92),
                     (0.82, 0.79, 0.82), (1.00, 0.73, 0.77)],
            rows=18, cuff_t=0.82, cuff_pinch=0.095,
            fold=(0.058, 0.030), bow=0.030,
            # pique is 2.0 mm; 7.2 mm of clearance opened a slot of background
            # at each armhole, the same fault the tee had
            clear=0.0029, hem_curl=0.019))
    sh.join(parts)
    SH.audit(body, "assembled")

    # 0.40 of side bias let an 11 mm crease run dead down the CENTRE FRONT for
    # 340 mm. Straight, central and full depth, it reads as a seam splitting
    # the shirt, not as drape. The front and back panels of a hanging polo are
    # broad and calm; the folds gather at the sides.
    D.drape_folds(body, amp=1.0, z_top=-0.180, z_bot=HEM_Z,
                  harmonics=[(9, 0.0086, 0.8), (5, 0.0084, -0.5),
                             (17, 0.0032, 1.5)],
                  seed=2.4, side_bias=0.66,
                  pred=lambda co: co.z < -0.180,
                  gate=lambda co: 1.0 - D._smooth(abs(co.x), 0.170, 0.230))

    col = collar(body, sh.neck_idx)
    pl, studs = placket(body)
    vt = vents(body)

    D.solidify(body, CLOTH_T, offset=0.0)
    D.solidify(col, 0.0026, offset=0.0)
    D.solidify(pl, 0.0020, offset=0.0)
    body = D.apply_all(body)
    col = D.apply_all(col)
    pl = D.apply_all(pl)
    for o in (body, col, pl):
        # 48 degrees left a hard shading break wherever a drape fold's flank
        # steepened past it -- a straight vertical step down the lower centre
        # front that read as a seam splitting the shirt. Cloth has no facets;
        # the only edges that should ever go flat here are the collar's fold
        # and the placket's, and both are well past 70.
        D.shade_smooth(o, 70.0)

    cloth = pique_material()
    pearl = ST.matte("PoloButton", (0.80, 0.79, 0.74), 0.30)
    for o in [body, col, pl] + list(vt):
        o.data.materials.append(cloth)
    for b in studs:
        b.data.materials.append(pearl)

    subject = [body, col, pl] + list(vt) + list(studs) + hg
    print("polo-hung v4: TRIS %d" % D.tri_count(subject))
    # ob.bound_box is CACHED and the fold fields transform vertices
    # directly, so nothing refreshes it in background mode -- every
    # camera then frames where the garment used to be.
    bpy.context.view_layer.update()
    lo, hi = H.bounds(subject)
    print("  %.0f x %.0f x %.0f mm" % ((hi.x - lo.x) * 1000,
                                       (hi.y - lo.y) * 1000,
                                       (hi.z - lo.z) * 1000))

    H.set_engine("CYCLES" if "cycles" in args else "EEVEE", samples=96)

    ST.exposure(-0.22)
    # UVs and the grain BEFORE the first render, not just before the
    # export: the studio frames are the evidence, so they have to be of
    # the asset that ships.
    for _ob in subject:
        D.unwrap(_ob)
    ST.grain_follows_cloth(subject)
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
        H.render(cam, os.path.join(OUT, "polo-hung-v4-%s.png" % label),
                 res=(820, 1000))
    top = Vector((0.0, -0.02, -0.045))
    cam = H.camera("detail-collar", H.orbit_position(top, 0.44, -104, 16), top,
                   lens=64.0)
    H.render(cam, os.path.join(OUT, "polo-hung-v4-detail-collar.png"),
             res=(900, 760))

    bd = bpy.data.objects.get("Backdrop")
    if bd is not None:
        bpy.data.objects.remove(bd, do_unlink=True)
    ST.world_value(0.055)
    tight = H.fit_view(subject, centre, Vector((0, 1, 0)), 80.0,
                       res=(860, 1040), margin=1.30)
    cam = H.camera("compare", H.orbit_position(centre, tight, -90, 1), centre,
                   lens=80.0)
    H.render(cam, os.path.join(OUT, "polo-hung-v4-compare.png"),
             res=(860, 1040))

    made = retail(subject, centre)
    for ob in made:
        bpy.data.objects.remove(ob, do_unlink=True)
    if "noexport" not in args:
        GLB = os.path.join(REPO, "Assets", "models", "hero", "v4")
        os.makedirs(GLB, exist_ok=True)
        # UVS BEFORE THE AXIS BAKE. Most of these primitives shipped with no
        # TEXCOORD_0 at all, which makes every texel-density and
        # logo-stretching requirement vacuous rather than met, and means
        # nothing here could ever carry a printed label or a baked weave.
        for _ob in subject:
            D.unwrap(_ob, label=_ob.name)
        ST.flatten_for_export(subject)
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(GLB, "apparel_polo_hung.glb"))
    print("renders in", OUT)


if __name__ == "__main__":
    main()
