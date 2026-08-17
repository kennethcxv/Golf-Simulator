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
PLIES = 8
PLY_T = 0.0079
PLY_GAP = 0.0034
STAGGER = 0.0075


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
    """The hood folded down as ANOTHER PLY, not as a pillow on the lid.

    Three cuts of this. v3 used an oval pillow; the first v4 cut a bolster;
    the second a flat flap that was still a smooth roll across the full width.
    All three read as bedding, and the reason is the same each time: a rounded
    section lying on a flat stack is a cushion whatever its outline.

    A hood folded down is just more cloth in the pile. It is FLAT, the same
    order of thickness as the plies under it, it covers the back half only,
    and its front edge is a folded roll with the face opening showing as a
    slot along it. Once it has a lip like the plies below, it stops being a
    separate object lying on top and becomes part of the fold.
    """
    zs = [v.co.z for v in body.data.vertices]
    top = max(zs)
    NX, NY = 34, 20
    HW = HALF_W * 0.955
    Y0, Y1 = -HALF_D * 0.10, HALF_D * 1.005
    T = 0.0098                        # a ply, not a bolster
    rows_top, rows_bot = [], []
    for j in range(NY + 1):
        v = j / NY
        y = Y0 + (Y1 - Y0) * v
        rt, rb = [], []
        for i in range(NX + 1):
            u = -1.0 + 2.0 * i / NX
            e = abs(u)
            w = HW * (1.0 - 0.035 * D._smooth(v, 0.80, 1.0))
            x = u * w + 0.0026 * math.sin(v * 5.1 + 1.2)
            # flat through the middle, rolling closed at every edge -- the
            # roll at v = 0 is the folded front edge and carries the opening
            fx = (1.0 - e ** 7.0) ** 0.30
            fy = min(1.0, (math.sin(math.pi * min(1.0, v * 0.97 + 0.03))
                           ** 0.30) * 1.06)
            half = 0.5 * T * fx * fy
            mid = top + 0.0016 + half
            fold = 0.0016 * math.sin(3.3 * math.pi * u + 0.7) * fy
            slot = 0.0042 * math.exp(-((v - 0.045) / 0.042) ** 2) * (1 - e ** 4)
            rt.append((x, y, mid + half + fold - slot))
            rb.append((x, y, mid - half + fold * 0.35))
        rows_top.append(rt)
        rows_bot.append(rb)
    ob = D.grid_mesh("hood", rows_top + list(reversed(rows_bot)))
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


def drawcords(body, hd, obstacles=()):
    """The two cords out of the hood, lying forward over the top ply.

    NOTHING ELSE IN THE STACK SAYS HOODIE. Folded, a hoodie is a rectangle of
    fleece with a lip: the hood is a ply, the pocket is a faint outline, the
    cuffs are under it. Every folded garment in the reference photograph is
    told apart by ONE detail sitting on top of it -- a collar on the polo, a
    waistband on the trousers, a print on the tee -- and for a hoodie that
    detail is the cords. They come out of the hood's front roll, cross the
    plies below it, and each ends in a metal aglet.
    """
    hz = max(v.co.z for v in hd.data.vertices)
    R = 0.0021

    # ONE tree over EVERYTHING the cord lies on. The first cut ray-cast at the
    # body only, so where the cord crossed the pocket panel -- which stands
    # proud of the body -- it passed straight through it, and the cords
    # rendered as four disconnected white dashes. `folded.top_at` caches its
    # BVH per object, so casting at several objects through it thrashes.
    from mathutils.bvhtree import BVHTree
    verts, faces = [], []
    for ob in (body, hd, *obstacles):
        n = len(verts)
        verts += [v.co.copy() for v in ob.data.vertices]
        faces += [tuple(n + i for i in p.vertices) for p in ob.data.polygons]
    bvh = BVHTree.FromPolygons(verts, faces)

    def surface(x, y):
        """The HIGHEST sample within a cord radius.

        A single ray down is not enough either: the top ply undulates by
        3.2 mm and its plan wanders by 6.2, so a cord laid on one sample sinks
        into the cloth bulging between samples. Same trap as the hoodie pocket
        and the tee print, third time.
        """
        best = None
        for dx, dy in ((0, 0), (R, 0), (-R, 0), (0, R), (0, -R),
                       (R * 0.7, R * 0.7), (-R * 0.7, -R * 0.7)):
            hit, _n, _i, _d = bvh.ray_cast(Vector((x + dx, y + dy, 0.40)),
                                           Vector((0.0, 0.0, -1.0)), 2.0)
            if hit is not None and (best is None or hit.z > best):
                best = hit.z
        return best

    out = []
    for sx in (-1, 1):
        pts = []
        for i in range(21):
            t = i / 20.0
            # out of the roll, down onto the stack, then away across it
            y = -0.010 - 0.098 * t
            x = sx * (0.020 + 0.052 * t ** 1.35
                      + 0.007 * math.sin(t * 4.1 + sx * 0.6))
            top = surface(x, y)
            base = hz - 0.0008 if top is None else top + R + 0.0013
            # it leaves the hood at the hood's height and settles in 25 mm
            z = base + (hz + 0.0026 - base) * math.exp(-(t / 0.16) ** 2)
            pts.append(Vector((x, y, z)))
        cord = D.topstitch("cord%+d" % sx, pts, radius=R, sides=8)
        D.shade_smooth(cord, 44.0)
        out.append(cord)

        tip = pts[-1]
        prev = pts[-3]
        d = (tip - prev)
        d = d.normalized() if d.length > 1e-6 else Vector((0, -1, 0))
        bpy.ops.mesh.primitive_cylinder_add(radius=0.0029, depth=0.0138,
                                            vertices=14)
        ag = bpy.context.object
        ag.name = "aglet%+d" % sx
        ag.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
        ag.location = tip + d * 0.0058
        bpy.ops.object.transform_apply(location=True, rotation=True,
                                       scale=True)
        D.shade_smooth(ag, 40.0)
        out.append(ag)
    return out


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
        y = -HALF_D * 0.86 + HALF_D * 0.68 * vv
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
    for n in ("Backdrop", "key", "fill", "rim", "top", "under"):
        ob = bpy.data.objects.get(n)
        if ob is not None:
            bpy.data.objects.remove(ob, do_unlink=True)
    # ob.bound_box is CACHED and the fold fields transform vertices
    # directly, so nothing refreshes it in background mode -- every
    # camera then frames where the garment used to be.
    bpy.context.view_layer.update()
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
                        ply_t=PLY_T, ply_gap=PLY_GAP, roll_r=0.0058,
                        nu=52, wander=0.0062, seed=3.3, squash=0.22,
                        bulk=bulk, stagger=STAGGER)
    F.undulate(body, amp=0.0032, seed=2.1, only_top=0.58)
    F.side_crease(body, -HALF_W * 0.30, depth=0.0042, width=0.013)
    F.side_crease(body, HALF_W * 0.36, depth=0.0030, width=0.011)
    hd = hood(body)
    pk = pocket(body)
    cf = cuffs(body)
    dc = drawcords(body, hd, obstacles=list(pk) + list(cf))

    cloth = fleece_material()
    rib = fleece_material((0.0225, 0.0265, 0.0480))
    # the cord is a flat braid, much lighter than the shell it hangs on
    cordmat = fleece_material((0.2050, 0.2120, 0.2350))
    for o in [body, hd] + list(pk):
        o.data.materials.append(cloth)
    for o in cf:
        o.data.materials.append(rib)
    for o in dc:
        o.data.materials.append(
            ST.metal("Aglet", (0.70, 0.71, 0.74), 0.26)
            if o.name.startswith("aglet") else cordmat)

    tag = size_tag(body)
    subject = [body, hd] + list(pk) + list(cf) + list(dc) + [tag]
    print("hoodie-folded v4: TRIS %d" % D.tri_count(subject))
    # ob.bound_box is CACHED and the fold fields transform vertices
    # directly, so nothing refreshes it in background mode -- every
    # camera then frames where the garment used to be.
    bpy.context.view_layer.update()
    lo, hi = H.bounds(subject)
    print("  %.0f x %.0f x %.0f mm" % ((hi.x - lo.x) * 1000,
                                       (hi.y - lo.y) * 1000,
                                       (hi.z - lo.z) * 1000))

    H.set_engine("CYCLES" if "cycles" in args else "EEVEE", samples=96)

    ST.exposure(0.25)
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
                   76.0, res=(1040, 800), margin=1.09)
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
