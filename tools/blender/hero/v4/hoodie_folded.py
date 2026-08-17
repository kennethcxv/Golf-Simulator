"""HOODIE, FOLDED -- v4. On a shop table.

Reference: qa/hero/v4/ref/folded-ref1.jpg for how a folded garment actually
reads (layered lips at the front edge, a long soft crease where the side was
folded in, an undulating top, nothing straight) and hoodie-hung-ref1.jpg for
the hood, the pocket and the cuffs.

v3's faults, from qa/hero/v3/apparel/hoodie-folded/hoodie-folded-eevee-hero.png:

  HF1  Stacked identical rounded slabs -- a mattress. Every ply the same
       thickness, the same width and the same edge.
  HF2  The hood is a BLOB sitting on top: an oval pillow with no opening and
       no relation to the garment under it.
  HF3  The top surface is a plane.
  HF4  The pocket is a bar.
  HF5  No cuffs anywhere, so nothing says which end the sleeves went.

A folded hoodie is thick. Three plies of fleece, not four of jersey, and the
bulk is uneven -- the sleeves are folded underneath and the garment is
noticeably deeper where they lie.

    blender --factory-startup -b --python tools/blender/hero/v4/hoodie_folded.py
        [-- noexport | cycles]
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
import folded as F  # noqa: E402

REPO = os.getcwd()
OUT = os.path.join(REPO, "qa", "hero", "v4", "hoodie-folded")

# A FOLDED GARMENT HAS MANY THIN LAYERS, NOT THREE FAT ONES. At 23 mm a ply
# is deeper than the shadow gap between plies, so the stack merges into one
# mass and the front edge shows a single lip -- which is a mattress. Five
# plies of 13 mm with a 5 mm gap gives the front edge the stack of lips that
# is the whole read in the reference.
HALF_W, HALF_D = 0.1585, 0.1180
PLIES = 5
PLY_T = 0.0130
PLY_GAP = 0.0050


def bulk(t, ply):
    """Where the garment is DEEPER. The sleeves are folded under the body, so
    the plies below the top one carry an extra 25% through the middle third;
    the bottom ply also carries the waistband's double thickness at its front
    edge."""
    mid = math.exp(-((t - 0.5) / 0.30) ** 2)
    b = 1.0 + 0.30 * mid * (0.0 if ply >= PLIES - 1 else 1.0)
    if ply < 1:
        b += 0.16 * math.exp(-((t - 0.12) / 0.16) ** 2)
    return b


def hood(body):
    """The hood, folded flat across the back of the stack.

    v3 put an oval pillow here and the first v4 cut put a bolster, which is
    the same mistake with rounder ends -- both read as bedding. A hood folded
    down is a WIDE FLAT FLAP about 35 mm thick with its opening showing as a
    slot along one edge, and it is nearly as wide as the garment.
    """
    zs = [v.co.z for v in body.data.vertices]
    top = max(zs)
    NX, NY = 30, 18
    HW, Y0, Y1 = HALF_W * 0.90, HALF_D * 0.06, HALF_D * 0.99
    rows = []
    for j in range(NY + 1):
        v = j / NY
        row = []
        for i in range(NX + 1):
            u = -1.0 + 2.0 * i / NX
            e = abs(u)
            # plan: a rounded rectangle whose far edge is the folded top
            w = HW * (1.0 - 0.10 * D._smooth(v, 0.72, 1.0))
            x = u * w
            y = Y0 + (Y1 - Y0) * v
            # section: thick in the middle, rolling closed at all four edges
            fx = (1.0 - e ** 5.0) ** 0.34
            fy = (math.sin(math.pi * min(1.0, v * 1.02 + 0.02)) ** 0.42)
            t = 0.0182 * fx * fy
            # the opening: a slot along the FRONT edge of the flap
            slot = 0.0115 * math.exp(-((v - 0.070) / 0.062) ** 2) * (1 - e ** 4)
            fold = 0.0028 * math.sin(2.6 * math.pi * u + 0.7) * fy
            z = top + 0.0022 + t + fold - slot
            row.append((x, y, z))
        rows.append(row)
    # ... and the same again for the underside, so it is a closed flap
    under = []
    for j in range(NY + 1):
        v = j / NY
        row = []
        for i in range(NX + 1):
            u = -1.0 + 2.0 * i / NX
            x, y, _z = rows[j][i]
            row.append((x, y, top + 0.0018))
        under.append(row)
    ob = D.grid_mesh("hood", rows + list(reversed(under)))
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=2e-4)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    D.shade_smooth(ob, 44.0)
    return ob


def pocket(body):
    """The kangaroo pocket, on the top ply, following its undulation."""
    NX, NY = 26, 14
    rows = []
    for jy in range(NY + 1):
        v = jy / NY
        y = -HALF_D * 0.62 + HALF_D * 0.86 * v
        row = []
        for ix in range(NX + 1):
            u = ix / NX
            x = -0.106 + 0.212 * u
            hit, nrm, = F.top_at(body, x, y)
            if hit is None:
                continue
            n = (Vector(nrm) * 0.3 + Vector((0, 0, 1)) * 0.7).normalized()
            edge = min(D._smooth(u, 0.0, 0.10), D._smooth(1 - u, 0.0, 0.10),
                       D._smooth(v, 0.0, 0.09), D._smooth(1 - v, 0.0, 0.09))
            lift = -0.0022 + 0.0082 * edge
            row.append(tuple(hit + n * lift))
        if len(row) == NX + 1:
            rows.append(row)
    ob = D.grid_mesh("pocket", rows)
    D.shade_smooth(ob, 48.0)
    # A SEAM, or the panel is invisible. A 4 mm rise with a soft boundary on a
    # 335 mm object reads as nothing at all; the stitch line round it is what
    # tells the eye there is a pocket there.
    out = [ob]
    ring = []
    for (uu, vv) in ([(i / 24.0, 0.02) for i in range(25)]
                     + [(0.98, i / 12.0) for i in range(13)]
                     + [(1.0 - i / 24.0, 0.98) for i in range(25)]
                     + [(0.02, 1.0 - i / 12.0) for i in range(13)]):
        x = -0.106 + 0.212 * uu
        y = -HALF_D * 0.80 + HALF_D * 0.74 * vv
        hit, nrm = F.top_at(body, x, y)
        if hit is None:
            continue
        ring.append(hit + Vector((0, 0, 0.0013)))
    if len(ring) > 8:
        st = D.topstitch("pocket_seam", ring, radius=0.00085)
        D.shade_smooth(st, 40.0)
        out.append(st)
    return out


def cuffs(body):
    """Ribbed cuffs showing at the fold, so the eye can tell where the sleeves
    went. v3 had none, and a folded hoodie with no cuff could be a towel."""
    zs = [v.co.z for v in body.data.vertices]
    lo, hi = min(zs), max(zs)
    out = []
    for i, (sx, zz, yy) in enumerate(((-1, 0.34, -0.30), (1, 0.30, -0.14))):
        z = lo + (hi - lo) * zz
        pts = []
        for j in range(13):
            t = j / 12.0
            pts.append(Vector((sx * (HALF_W * 0.985 + 0.0016),
                               HALF_D * yy + HALF_D * 0.52 * t,
                               z + 0.0022 * math.sin(t * 3.0))))
        ob = D.topstitch("cuff%d" % i, pts, radius=0.0052, sides=10)
        D.shade_smooth(ob, 42.0)
        out.append(ob)
    return out


def size_tag(body):
    """The size sticker on the front edge. Every folded garment in the
    reference has one, and it is the cheapest thing in the scene that says
    RETAIL rather than laundry."""
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromPolygons(
        [v.co.copy() for v in body.data.vertices],
        [tuple(p.vertices) for p in body.data.polygons])
    zs = [v.co.z for v in body.data.vertices]
    z0 = min(zs) + (max(zs) - min(zs)) * 0.46
    rows = []
    for j in range(7):
        z = z0 - 0.011 + 0.022 * (j / 6.0)
        row = []
        for i in range(9):
            x = 0.092 + 0.030 * (i / 8.0)
            hit, nrm, _i, _d = bvh.ray_cast(Vector((x, -0.40, z)),
                                            Vector((0.0, 1.0, 0.0)), 1.0)
            if hit is None:
                continue
            row.append(tuple(hit + Vector((0, -0.0007, 0))))
        if len(row) == 9:
            rows.append(row)
    if len(rows) < 3:
        rows = [[(0.092 + 0.030 * (i / 8.0), -HALF_D - 0.001,
                  z0 - 0.011 + 0.022 * (j / 6.0)) for i in range(9)]
                for j in range(7)]
    ob = D.grid_mesh("size_tag", rows)
    ob.data.materials.append(ST.matte("SizeTag", (0.80, 0.79, 0.75), 0.55))
    D.shade_smooth(ob, 50.0)
    return ob


def fleece_material(colour=(0.0295, 0.0345, 0.0620)):
    mat = bpy.data.materials.new("FoldedFleece")
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Roughness"].default_value = 0.955
    if "Sheen Weight" in b.inputs:
        b.inputs["Sheen Weight"].default_value = 0.085
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.24
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 340.0
    n.inputs["Detail"].default_value = 7.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.055
    bump.inputs["Distance"].default_value = 0.0016
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return mat


def retail(subject, centre):
    """Folded goods go on a TABLE, beside other folded goods."""
    for n in ("Backdrop", "key", "fill", "rim", "under"):
        ob = bpy.data.objects.get(n)
        if ob is not None:
            bpy.data.objects.remove(ob, do_unlink=True)
    lo, hi = H.bounds(subject)
    made = [ST.shop_floor(lo.z - 0.001, value=0.30)]
    made.append(ST.shop_wall(1.20, lo.z - 0.001))
    # a short stack of the same garment, and two neighbours either side
    off = []
    for k in range(1, 4):
        off.append((0.004 * k, -0.003 * k, (hi.z - lo.z) * 0.86 * k))
    for c in (-1, 1):
        for k in range(3):
            off.append((c * 0.365 + 0.004 * k, 0.006 * k,
                        (hi.z - lo.z) * 0.86 * k))
    made += ST.duplicate_along(subject, off, rot_jitter=0.055,
                               scale_jitter=0.010)
    mid = Vector((0.0, 0.0, lo.z + 0.10))
    ST.garment_lights(centre=(0.0, 0.0, mid.z + 0.30), scale=0.85, warm=True)
    ST.world_value(0.035)
    for label, az, el, d in (("retail", -104, 24, 1.30),
                             ("retail-q34", -132, 34, 1.20)):
        cam = H.camera(label, H.orbit_position(mid, d, az, el), mid, lens=58.0)
        H.render(cam, os.path.join(OUT, "hoodie-folded-v4-%s.png" % label),
                 res=(1360, 900))
    return made


def main():
    args = H.argv_after_dashes()
    H.reset_scene()
    os.makedirs(OUT, exist_ok=True)

    body = F.concertina("hoodie_folded", HALF_W, HALF_D, plies=PLIES,
                        ply_t=PLY_T, ply_gap=PLY_GAP, roll_r=0.0105,
                        nu=44, wander=0.0042, seed=3.3, squash=0.42,
                        bulk=bulk)
    F.undulate(body, amp=0.0032, seed=2.1, only_top=0.58)
    F.side_crease(body, -HALF_W * 0.30, depth=0.0042, width=0.013)
    F.side_crease(body, HALF_W * 0.36, depth=0.0030, width=0.011)
    hd = hood(body)
    pk = pocket(body)
    cf = cuffs(body)

    cloth = fleece_material()
    rib = fleece_material((0.0225, 0.0265, 0.0480))
    for o in [body, hd] + list(pk):
        o.data.materials.append(cloth)
    for o in cf:
        o.data.materials.append(rib)

    tag = size_tag(body)
    subject = [body, hd] + list(pk) + list(cf) + [tag]
    print("hoodie-folded v4: TRIS %d" % D.tri_count(subject))
    lo, hi = H.bounds(subject)
    print("  %.0f x %.0f x %.0f mm" % ((hi.x - lo.x) * 1000,
                                       (hi.y - lo.y) * 1000,
                                       (hi.z - lo.z) * 1000))

    H.set_engine("CYCLES" if "cycles" in args else "EEVEE", samples=96)
    centre = (lo + hi) * 0.5
    _c, radius = H.subject_sphere(subject)
    ST.garment_lights(centre=centre, scale=radius * 1.9)
    ST.world_value(0.030)
    H.backdrop(center=centre, scale=radius * 1.6)
    for label, az, el, res in (("hero", -122, 26, (1000, 800)),
                               ("front", -90, 9, (1000, 720)),
                               ("side", -180, 9, (1000, 720)),
                               ("top", -90, 66, (900, 900))):
        d = H.fit_view(subject, centre,
                       Vector(H.orbit_position(centre, 1.0, az, el)) - centre,
                       76.0, res=res, margin=1.14)
        cam = H.camera(label, H.orbit_position(centre, d, az, el), centre,
                       lens=76.0)
        H.render(cam, os.path.join(OUT, "hoodie-folded-v4-%s.png" % label),
                 res=res)

    bd = bpy.data.objects.get("Backdrop")
    if bd is not None:
        bpy.data.objects.remove(bd, do_unlink=True)
    ST.world_value(0.055)
    d = H.fit_view(subject, centre,
                   Vector(H.orbit_position(centre, 1.0, -122, 26)) - centre,
                   76.0, res=(1040, 800), margin=1.05)
    cam = H.camera("compare", H.orbit_position(centre, d, -122, 26), centre,
                   lens=76.0)
    H.render(cam, os.path.join(OUT, "hoodie-folded-v4-compare.png"),
             res=(1040, 800))

    made = retail(subject, centre)
    for ob in made:
        bpy.data.objects.remove(ob, do_unlink=True)
    if "noexport" not in args:
        GLB = os.path.join(REPO, "Assets", "models", "hero", "v4")
        os.makedirs(GLB, exist_ok=True)
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(GLB, "apparel_hoodie_folded.glb"))
    print("renders in", OUT)


if __name__ == "__main__":
    main()
