"""TROUSERS, FOLDED -- v4. On a shop table.

Reference: qa/hero/v4/ref/folded-ref1.jpg for how folded goods read, and
trousers-hung-ref2.jpg for the waistband, belt loops, fly button and pockets.

v3's faults, from qa/hero/v3/apparel/trousers-folded/trousers-folded-eevee-hero.png:

  TF1  Folded BEDDING. Identical slabs again.
  TF2  Random bars laid on top called a waistband and a pocket.
  TF3  Nothing distinguishes the two ends, so there is no telling which end
       the waistband is and which is the fold.

Trousers fold differently from a shirt and it is the one thing that makes
them recognisable: the legs are laid together and folded across, so ONE end
is a fat rounded roll of doubled leg and the OTHER carries the waistband, the
belt loops and the button. A folded pair with two identical ends is a towel.

    blender --factory-startup -b --python tools/blender/hero/v4/trousers_folded.py
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
OUT = os.path.join(REPO, "qa", "hero", "v4", "trousers-folded")

HALF_W, HALF_D = 0.1680, 0.1030
PLIES = 4
PLY_T = 0.0128
PLY_GAP = 0.0044
BAND_H = 0.0225


def bulk(t, ply):
    """The doubled leg is thicker through the middle; the waistband end of the
    top ply carries its own stiffened band."""
    mid = math.exp(-((t - 0.52) / 0.34) ** 2)
    b = 1.0 + 0.22 * mid
    if ply >= PLIES - 1:
        b += 0.30 * math.exp(-((t - 0.94) / 0.10) ** 2)
    return b


def waistband(body):
    """The band across one end of the top ply, standing proud with a seam
    under it. This is the cue that tells you which end is which."""
    NX, NY = 30, 6
    y0, y1 = HALF_D * 0.58, HALF_D * 0.995
    rows = []
    for j in range(NY + 1):
        v = j / NY
        y = y0 + (y1 - y0) * v
        row = []
        for i in range(NX + 1):
            u = i / NX
            x = -HALF_W * 0.965 + 2 * HALF_W * 0.965 * u
            hit, nrm = F.top_at(body, x, y)
            if hit is None:
                continue
            n = (Vector(nrm) * 0.25 + Vector((0, 0, 1)) * 0.75).normalized()
            edge = min(D._smooth(u, 0.0, 0.045), D._smooth(1 - u, 0.0, 0.045),
                       D._smooth(v, 0.0, 0.16))
            row.append(tuple(hit + n * (-0.0018 + 0.0062 * edge)))
        if len(row) == NX + 1:
            rows.append(row)
    ob = D.grid_mesh("waistband", rows)
    D.shade_smooth(ob, 46.0)

    loops = []
    for lx in (-0.72, -0.24, 0.24, 0.72):
        pts = []
        ok = True
        for k in range(7):
            t = k / 6.0
            y = y0 + (y1 - y0) * (0.10 + 0.82 * t)
            hit, nrm = F.top_at(body, HALF_W * 0.965 * lx, y)
            if hit is None:
                ok = False
                break
            bow = math.sin(math.pi * t) ** 0.7
            pts.append(hit + Vector((0, 0, 0.0044 + 0.0042 * bow)))
        if ok:
            lp = D.topstitch("loop%.0f" % (lx * 100), pts, radius=0.0021,
                             sides=7)
            D.shade_smooth(lp, 42.0)
            loops.append(lp)
    return [ob] + loops


def welt_pocket(body):
    """A back welt pocket on the top ply: two stitch lines and a lip."""
    out = []
    y = HALF_D * 0.20
    pts = []
    for i in range(19):
        x = -0.062 + 0.124 * (i / 18.0)
        hit, nrm = F.top_at(body, x, y + 0.004 * math.sin(i * 0.7))
        if hit is not None:
            pts.append(hit + Vector((0, 0, 0.0022)))
    if len(pts) > 6:
        ob = D.topstitch("welt", pts, radius=0.0018, sides=8)
        D.shade_smooth(ob, 42.0)
        out.append(ob)
    pts2 = []
    for i in range(19):
        x = -0.062 + 0.124 * (i / 18.0)
        hit, nrm = F.top_at(body, x, y - 0.017)
        if hit is not None:
            pts2.append(hit + Vector((0, 0, 0.0012)))
    if len(pts2) > 6:
        ob = D.topstitch("welt_seam", pts2, radius=0.00080)
        D.shade_smooth(ob, 40.0)
        out.append(ob)
    return out


def fly_button(body):
    hit, nrm = F.top_at(body, -0.016, HALF_D * 0.545)
    if hit is None:
        return []
    import bmesh
    bpy.ops.mesh.primitive_cylinder_add(radius=0.0068, depth=0.0021,
                                        vertices=14,
                                        location=hit + Vector((0, 0, 0.0026)))
    b = bpy.context.object
    b.name = "fly_button"
    bm = bmesh.new()
    bm.from_mesh(b.data)
    bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=0.0006,
                    segments=2, affect='EDGES')
    bm.to_mesh(b.data)
    bm.free()
    D.shade_smooth(b, 34.0)
    b.data.materials.append(ST.matte("FlyButton", (0.30, 0.24, 0.15), 0.42))
    return [b]


def size_tag(body):
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromPolygons(
        [v.co.copy() for v in body.data.vertices],
        [tuple(p.vertices) for p in body.data.polygons])
    zs = [v.co.z for v in body.data.vertices]
    z0 = min(zs) + (max(zs) - min(zs)) * 0.44
    rows = []
    for j in range(7):
        z = z0 - 0.010 + 0.020 * (j / 6.0)
        row = []
        for i in range(9):
            x = 0.098 + 0.030 * (i / 8.0)
            hit, _n, _i, _d = bvh.ray_cast(Vector((x, -0.40, z)),
                                           Vector((0.0, 1.0, 0.0)), 1.0)
            if hit is None:
                continue
            row.append(tuple(hit + Vector((0, -0.0007, 0))))
        if len(row) == 9:
            rows.append(row)
    if len(rows) < 3:
        return []
    ob = D.grid_mesh("size_tag", rows)
    ob.data.materials.append(ST.matte("SizeTag", (0.80, 0.79, 0.75), 0.55))
    D.shade_smooth(ob, 70.0)
    return [ob]


def chino_material(colour=(0.196, 0.176, 0.138)):
    mat = bpy.data.materials.new("FoldedChino")
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Roughness"].default_value = 0.865
    if "Sheen Weight" in b.inputs:
        b.inputs["Sheen Weight"].default_value = 0.055
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.30
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 430.0
    n.inputs["Detail"].default_value = 6.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.05
    bump.inputs["Distance"].default_value = 0.0012
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    # RESTRAINED COLOUR MICROVARIATION, at the scale of the yarn.
    # Flat albedo is most of why cloth reads as moulded plastic: the bump only
    # moves the normal, so a surface facing the key at one angle is one flat
    # value across the whole panel. Coarse noise on colour reads as dirt --
    # scale 88 on the hoodie came out as camouflage -- so this sits an order
    # of magnitude finer and a fraction as strong.
    _v = nt.nodes.new("ShaderNodeTexNoise")
    _v.inputs["Scale"].default_value = 470.0
    _v.inputs["Detail"].default_value = 6.0
    _v.inputs["Roughness"].default_value = 0.52
    _c = b.inputs["Base Color"].default_value
    _t = nt.nodes.new("ShaderNodeMix")
    _t.data_type = "RGBA"
    _t.inputs["A"].default_value = (_c[0] * 0.850, _c[1] * 0.850,
                                    _c[2] * 0.850, 1.0)
    _t.inputs["B"].default_value = (_c[0] * 1.150, _c[1] * 1.150,
                                    _c[2] * 1.150, 1.0)
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
    made = [ST.shop_floor(lo.z - 0.001, value=0.30),
            ST.shop_wall(1.20, lo.z - 0.001)]
    off = []
    for k in range(1, 4):
        off.append((0.004 * k, -0.003 * k, (hi.z - lo.z) * 0.88 * k))
    for c in (-1, 1):
        for k in range(3):
            off.append((c * 0.380 + 0.004 * k, 0.006 * k,
                        (hi.z - lo.z) * 0.88 * k))
    made += ST.duplicate_along(subject, off, rot_jitter=0.050,
                               scale_jitter=0.009)
    mid = Vector((0.0, 0.0, lo.z + 0.09))
    ST.garment_lights(centre=(0.0, 0.0, mid.z + 0.28), scale=0.85, warm=True)
    ST.world_value(0.035)
    for label, az, el, d in (("retail", -104, 24, 1.30),
                             ("retail-q34", -132, 34, 1.20)):
        cam = H.camera(label, H.orbit_position(mid, d, az, el), mid, lens=58.0)
        H.render(cam, os.path.join(OUT, "trousers-folded-v4-%s.png" % label),
                 res=(1360, 900))
    return made


def main():
    args = H.argv_after_dashes()
    H.reset_scene()
    os.makedirs(OUT, exist_ok=True)

    body = F.concertina("trousers_folded", HALF_W, HALF_D, plies=PLIES,
                        ply_t=PLY_T, ply_gap=PLY_GAP, roll_r=0.0092,
                        nu=44, wander=0.0030, seed=6.7, squash=0.36,
                        bulk=bulk)
    F.undulate(body, amp=0.0022, seed=5.5, only_top=0.60)
    F.side_crease(body, -HALF_W * 0.02, depth=0.0030, width=0.014)

    wb = waistband(body)
    wp = welt_pocket(body)
    fb = fly_button(body)
    tg = size_tag(body)

    cloth = chino_material()
    for o in [body] + list(wb) + list(wp):
        o.data.materials.append(cloth)

    subject = [body] + list(wb) + list(wp) + list(fb) + list(tg)
    print("trousers-folded v4: TRIS %d" % D.tri_count(subject))
    # ob.bound_box is CACHED and the fold fields transform vertices
    # directly, so nothing refreshes it in background mode -- every
    # camera then frames where the garment used to be.
    bpy.context.view_layer.update()
    lo, hi = H.bounds(subject)
    print("  %.0f x %.0f x %.0f mm" % ((hi.x - lo.x) * 1000,
                                       (hi.y - lo.y) * 1000,
                                       (hi.z - lo.z) * 1000))

    H.set_engine("CYCLES" if "cycles" in args else "EEVEE", samples=96)

    ST.exposure(-0.52)
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
                               ("front", -90, 9, (1000, 700)),
                               ("side", -180, 9, (1000, 700)),
                               ("top", -90, 66, (900, 900))):
        d = H.fit_view(subject, centre,
                       Vector(H.orbit_position(centre, 1.0, az, el)) - centre,
                       76.0, res=res, margin=1.14)
        cam = H.camera(label, H.orbit_position(centre, d, az, el), centre,
                       lens=76.0)
        H.render(cam, os.path.join(OUT, "trousers-folded-v4-%s.png" % label),
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
    H.render(cam, os.path.join(OUT, "trousers-folded-v4-compare.png"),
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
        H.export_glb(subject,
                     os.path.join(GLB, "apparel_trousers_folded.glb"))
    print("renders in", OUT)


if __name__ == "__main__":
    main()
