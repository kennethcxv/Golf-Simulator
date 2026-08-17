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

# A FOLDED GARMENT HAS MANY THIN LAYERS, NOT THREE FAT ONES -- but not eight
# either. At 23 mm a ply is deeper than the shadow gap between plies and the
# stack merges into a mattress; at 8 mm there are so many lips that the pile
# reads as several garments rather than one folded hoodie. The board's side
# profile shows FIVE edges: two fat plies making the front rolls and three
# more showing at the folded end.
HALF_W, HALF_D = 0.1585, 0.1180
PLIES = 5
PLY_T = 0.0132
PLY_GAP = 0.0042
STAGGER = 0.0098


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
    """The hood, as the ARCHED HOLLOW ROLL the board shows it to be.

    Four cuts came before this. v3 used an oval pillow; the first v4 cut a
    bolster; the second a flat flap; the third made it another PLY -- flat,
    ply-thick, with its own lip -- on the reasoning that a rounded section
    lying on a flat stack is a cushion whatever its outline.

    That reasoning was right about cushions and wrong about this garment. The
    reference board is unambiguous: on a folded hoodie the hood is the biggest
    single form in the frame. It lies across the BACK of the stack as a soft
    arched tube standing 50 mm proud, its face opening turned up and forward
    so you look into the cavity, and its front edge is a thick rolled binding.
    Made flat it disappears and the stack could be any garment; the drawcords
    were carrying the entire identity on their own.

    So: a tube swept along the back edge, its section a C opened towards the
    viewer, with a binding round the opening.
    """
    zs = [v.co.z for v in body.data.vertices]
    top = max(zs)
    NX, NA = 40, 26
    HW = HALF_W * 0.90
    Y_MID = HALF_D * 0.46
    R0, R1 = 0.0176, 0.0362           # section radius at the ends / at centre

    def spine(u):
        k = max(0.0, 1.0 - u * u)
        return Vector((u * HW,
                       Y_MID - 0.012 * k ** 0.8,
                       top + 0.0034 + 0.0182 * k ** 0.55))

    def radius(u):
        k = max(0.0, 1.0 - u * u)
        # not even: a folded hood slumps a little to one side
        return (R0 + (R1 - R0) * k ** 0.62) * (1.0 + 0.10 * math.sin(u * 1.4))

    rows = []
    for i in range(NX + 1):
        u = -1.0 + 2.0 * i / NX
        c = spine(u)
        r = radius(u)
        row = []
        for j in range(NA):
            a = 2 * math.pi * j / NA
            # THE CAVITY. The front-upper quadrant is drawn IN towards the
            # spine so the roll is a C and not a sausage -- that hollow, and
            # the shadow in it, is what says hood.
            #
            # Stated as a Gaussian on the section angle, because the first cut
            # wrote it as a product of two clamped trig terms and put the
            # hollow at the BACK: a = 0 is +y here, which is away from the
            # camera, so "front-up" is near 1.3 pi and not near 1.7.
            d = (a - 1.30 * math.pi + math.pi) % (2 * math.pi) - math.pi
            squash = 1.0 - 0.60 * math.exp(-(d / 0.62) ** 2)
            # ... and it is flattened where it lies on the stack
            floor = 1.0 - 0.30 * max(0.0, math.sin(a)) ** 1.6
            f = (1.0 + 0.085 * math.sin(3.1 * math.pi * u + 1.0)
                 * math.sin(a + 0.4)
                 + 0.045 * math.sin(a * 3.0 - u * 2.0))
            p = c + Vector((0.0,
                            r * f * squash * math.cos(a) * 1.24,
                            r * f * squash * floor * -math.sin(a)))
            row.append(tuple(p))
        rows.append(row)
    ob = D.grid_mesh("hood", rows, wrap_u=True)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    D.shade_smooth(ob, 42.0)

    # the binding round the face opening -- a 9 mm rolled hem, and the one
    # line in the frame that tells the eye where the hood's mouth is
    bind = []
    for i in range(NX + 1):
        u = -0.985 + 1.97 * (i / NX)
        c = spine(u)
        r = radius(u)
        a = 1.08 * math.pi
        bind.append(c + Vector((0.0, r * math.cos(a) * 1.30,
                                r * -math.sin(a) * 0.90)))
    bd = D.topstitch("hood_binding", bind, radius=0.0046, sides=10)
    D.shade_smooth(bd, 44.0)
    bpy.ops.object.select_all(action='DESELECT')
    bd.select_set(True)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.join()
    ob.name = "hood"
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
    D.shade_smooth(ob, 70.0)
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
    # RESTRAINED COLOUR MICROVARIATION, at the scale of the yarn.
    # Flat albedo is most of why cloth reads as moulded plastic: the bump only
    # moves the normal, so a surface facing the key at one angle is one flat
    # value across the whole panel. Coarse noise on colour reads as dirt --
    # scale 88 on the hoodie came out as camouflage -- so this sits an order
    # of magnitude finer and a fraction as strong.
    _v = nt.nodes.new("ShaderNodeTexNoise")
    _v.inputs["Scale"].default_value = 640.0
    _v.inputs["Detail"].default_value = 5.0
    _v.inputs["Roughness"].default_value = 0.52
    _c = b.inputs["Base Color"].default_value
    _t = nt.nodes.new("ShaderNodeMix")
    _t.data_type = "RGBA"
    _t.inputs["A"].default_value = (_c[0] * 0.790, _c[1] * 0.790,
                                    _c[2] * 0.790, 1.0)
    _t.inputs["B"].default_value = (_c[0] * 1.210, _c[1] * 1.210,
                                    _c[2] * 1.210, 1.0)
    nt.links.new(_v.outputs["Fac"], _t.inputs["Factor"])
    nt.links.new(_t.outputs[2], b.inputs["Base Color"])

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
    # THE CORDS ARE THE GARMENT'S COLOUR. Pale grey braid on navy fleece is
    # what a cheap hoodie does; the board's cords are navy with dark gunmetal
    # tips, and they read by their round highlight and their shadow, not by
    # contrast. At 0.205 they were the brightest thing in the frame.
    cordmat = fleece_material((0.0455, 0.0520, 0.0880))
    for o in [body, hd] + list(pk):
        o.data.materials.append(cloth)
    for o in cf:
        o.data.materials.append(rib)
    for o in dc:
        o.data.materials.append(
            ST.metal("Aglet", (0.31, 0.32, 0.34), 0.30)
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
    # UVs and the grain BEFORE the first render, not just before the
    # export: the studio frames are the evidence, so they have to be of
    # the asset that ships.
    for _ob in subject:
        D.unwrap(_ob)
    ST.grain_follows_cloth(subject)
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
        # UVS BEFORE THE AXIS BAKE. Most of these primitives shipped with no
        # TEXCOORD_0 at all, which makes every texel-density and
        # logo-stretching requirement vacuous rather than met, and means
        # nothing here could ever carry a printed label or a baked weave.
        for _ob in subject:
            D.unwrap(_ob, label=_ob.name)
        ST.flatten_for_export(subject)
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(GLB, "apparel_hoodie_folded.glb"))
    print("renders in", OUT)


if __name__ == "__main__":
    main()
