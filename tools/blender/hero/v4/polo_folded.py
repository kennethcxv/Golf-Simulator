"""POLO, FOLDED -- v4. On a shop table.

Reference: qa/hero/v4/ref/folded-ref1.jpg -- a stack of folded polos, which is
this asset almost exactly. What it shows:

  * The COLLAR is splayed flat on the top ply with its two points angled
    forward, and it is the single thing that says polo. Two buttons below it.
  * A neck label showing under the collar.
  * The sleeve fold crossing the top as a long diagonal edge.
  * Three or four thin lips at the front, all different.
  * A size sticker on the front edge.
  * It is FLAT: about 45 mm for a garment 300 mm across.

v3's faults, from qa/hero/v3/apparel/polo-folded/polo-folded-eevee-hero.png:

  PF1  Identical stacked slabs.
  PF2  The collar is a rigid crescent handle sitting on top -- a tube, and it
       does not lie on anything.
  PF3  Buttons are studs on a raised strap.
  PF4  No sleeve fold, no label, no sticker.

    blender --factory-startup -b --python tools/blender/hero/v4/polo_folded.py
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
OUT = os.path.join(REPO, "qa", "hero", "v4", "polo-folded")

HALF_W, HALF_D = 0.1520, 0.1190
# THE PHOTOGRAPH'S STACK SHOWS FIVE OR SIX LIPS, not three.
PLIES = 6
PLY_T = 0.0062
PLY_GAP = 0.0026
STAGGER = 0.0062


def bulk(t, ply):
    """The sleeves are folded under the body, so the plies below the top one
    are noticeably deeper across the middle."""
    mid = math.exp(-((t - 0.48) / 0.32) ** 2)
    b = 1.0 + 0.24 * mid * (0.0 if ply >= PLIES - 1 else 1.0)
    if ply >= PLIES - 1:
        b += 0.22 * math.exp(-((t - 0.90) / 0.11) ** 2)   # the collar band
    return b


def collar(body):
    """Splayed flat on the top ply, with two points angled forward.

    v3's was a rigid crescent -- a swept tube laid over the stack, touching
    nothing. A collar that has been folded down lies ON the cloth: it is two
    rounded wings meeting at the centre back, thickest along their fold and
    thinning to their points.
    """
    out = []
    for sx in (-1, 1):
        NX, NY = 16, 12
        rows = []
        for j in range(NY + 1):
            v = j / NY
            row = []
            for i in range(NX + 1):
                u = i / NX
                # the wing: from the centre back out to the shoulder, and
                # forward to the point
                bx = sx * (0.014 + 0.104 * u)
                by = HALF_D * (0.965 - 0.30 * u ** 1.5)
                px = sx * (0.020 + 0.062 * u ** 1.25)
                py = HALF_D * (0.470 - 0.19 * u ** 1.6)
                x = bx + (px - bx) * v
                y = by + (py - by) * v
                hit, nrm = F.top_at(body, x, y)
                if hit is None:
                    continue
                n = (Vector(nrm) * 0.25 + Vector((0, 0, 1)) * 0.75).normalized()
                # THE POINT HAS TO BE A POINT. Thinning as u squared leaves a
                # rounded wing; the reference's collar ends in a crisp corner
                # because the two plies of the collar come together there.
                t = (0.0060 * math.sin(math.pi * min(1.0, v * 0.92 + 0.08))
                     * (1.0 - 0.86 * u ** 3.4))
                edge = min(D._smooth(u, 0.0, 0.05), D._smooth(1 - u, 0.0, 0.045))
                row.append(tuple(hit + n * (-0.0012 + (t + 0.0022) * edge)))
            if len(row) == NX + 1:
                rows.append(row)
        ob = D.grid_mesh("collar%+d" % sx, rows)
        D.shade_smooth(ob, 46.0)
        out.append(ob)

    # the two buttons, on the placket below the collar
    for k in range(2):
        y = HALF_D * (0.42 - 0.20 * k)
        hit, nrm = F.top_at(body, 0.006, y)
        if hit is None:
            continue
        import bmesh
        bpy.ops.mesh.primitive_cylinder_add(radius=0.0052, depth=0.0017,
                                            vertices=14,
                                            location=hit + Vector((0, 0, 0.0021)))
        b = bpy.context.object
        b.name = "button%d" % k
        bm = bmesh.new()
        bm.from_mesh(b.data)
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=0.0005,
                        segments=2, affect='EDGES')
        bm.to_mesh(b.data)
        bm.free()
        D.shade_smooth(b, 34.0)
        b.data.materials.append(ST.matte("PoloButton", (0.80, 0.79, 0.74),
                                         0.30))
        out.append(b)
    return out


def neck_label(body):
    """The woven label showing under the splayed collar -- it is in every
    folded shirt in the reference and it costs eight quads."""
    rows = []
    for j in range(5):
        v = j / 4.0
        row = []
        for i in range(9):
            u = i / 8.0
            x = -0.026 + 0.052 * u
            y = HALF_D * (0.905 - 0.085 * v)
            hit, nrm = F.top_at(body, x, y)
            if hit is None:
                continue
            row.append(tuple(hit + Vector((0, 0, 0.0009))))
        if len(row) == 9:
            rows.append(row)
    if len(rows) < 3:
        return []
    ob = D.grid_mesh("neck_label", rows)
    ob.data.materials.append(ST.matte("NeckLabel", (0.78, 0.77, 0.73), 0.60))
    D.shade_smooth(ob, 50.0)
    return [ob]


def sleeve_fold(body):
    """The long diagonal edge where the sleeve was folded across the body."""
    pts = []
    for i in range(21):
        t = i / 20.0
        x = -HALF_W * (0.94 - 0.20 * t)
        y = HALF_D * (0.86 - 1.72 * t)
        hit, nrm = F.top_at(body, x, y)
        if hit is not None:
            pts.append(hit + Vector((0, 0, 0.0011)))
    if len(pts) < 6:
        return []
    ob = D.topstitch("sleeve_fold", pts, radius=0.0019, sides=8)
    D.shade_smooth(ob, 42.0)
    return [ob]


def size_tag(body):
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromPolygons(
        [v.co.copy() for v in body.data.vertices],
        [tuple(p.vertices) for p in body.data.polygons])
    zs = [v.co.z for v in body.data.vertices]
    z0 = min(zs) + (max(zs) - min(zs)) * 0.48
    rows = []
    for j in range(7):
        z = z0 - 0.009 + 0.018 * (j / 6.0)
        row = []
        for i in range(9):
            x = 0.088 + 0.028 * (i / 8.0)
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
    D.shade_smooth(ob, 50.0)
    return [ob]


def pique_material(colour=(0.0225, 0.0640, 0.1180)):
    mat = bpy.data.materials.new("FoldedPique")
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Roughness"].default_value = 0.905
    if "Sheen Weight" in b.inputs:
        b.inputs["Sheen Weight"].default_value = 0.10
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.28
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 300.0
    n.inputs["Detail"].default_value = 4.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.075
    bump.inputs["Distance"].default_value = 0.0011
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
    made = [ST.shop_floor(lo.z - 0.001, value=0.30),
            ST.shop_wall(1.20, lo.z - 0.001)]
    off = []
    for k in range(1, 6):
        off.append((0.004 * k, -0.003 * k, (hi.z - lo.z) * 0.80 * k))
    for c in (-1, 1):
        for k in range(5):
            off.append((c * 0.345 + 0.004 * k, 0.006 * k,
                        (hi.z - lo.z) * 0.80 * k))
    made += ST.duplicate_along(subject, off, rot_jitter=0.055,
                               scale_jitter=0.010)
    mid = Vector((0.0, 0.0, lo.z + 0.11))
    ST.garment_lights(centre=(0.0, 0.0, mid.z + 0.28), scale=0.85, warm=True)
    ST.world_value(0.035)
    for label, az, el, d in (("retail", -104, 22, 1.28),
                             ("retail-q34", -132, 32, 1.18)):
        cam = H.camera(label, H.orbit_position(mid, d, az, el), mid, lens=58.0)
        H.render(cam, os.path.join(OUT, "polo-folded-v4-%s.png" % label),
                 res=(1360, 900))
    return made


def main():
    args = H.argv_after_dashes()
    H.reset_scene()
    os.makedirs(OUT, exist_ok=True)

    body = F.concertina("polo_folded", HALF_W, HALF_D, plies=PLIES,
                        ply_t=PLY_T, ply_gap=PLY_GAP, roll_r=0.0046,
                        nu=48, wander=0.0030, seed=8.1, squash=0.30,
                        bulk=bulk, stagger=STAGGER)
    F.undulate(body, amp=0.0021, seed=4.4, only_top=0.58)
    F.side_crease(body, -HALF_W * 0.26, depth=0.0028, width=0.011)

    col = collar(body)
    lab = neck_label(body)
    sf = sleeve_fold(body)
    tg = size_tag(body)

    cloth = pique_material()
    for o in [body] + [c for c in col if c.name.startswith("collar")] + list(sf):
        o.data.materials.append(cloth)

    subject = [body] + list(col) + list(lab) + list(sf) + list(tg)
    print("polo-folded v4: TRIS %d" % D.tri_count(subject))
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
    centre = (lo + hi) * 0.5
    _c, radius = H.subject_sphere(subject)
    ST.garment_lights(centre=centre, scale=radius * 1.9)
    ST.world_value(0.030)
    H.backdrop(center=centre, scale=radius * 1.6)
    for label, az, el, res in (("hero", -118, 28, (1000, 800)),
                               ("front", -90, 9, (1000, 700)),
                               ("side", -180, 9, (1000, 700)),
                               ("top", -90, 70, (900, 900))):
        d = H.fit_view(subject, centre,
                       Vector(H.orbit_position(centre, 1.0, az, el)) - centre,
                       76.0, res=res, margin=1.13)
        cam = H.camera(label, H.orbit_position(centre, d, az, el), centre,
                       lens=76.0)
        H.render(cam, os.path.join(OUT, "polo-folded-v4-%s.png" % label),
                 res=res)

    bd = bpy.data.objects.get("Backdrop")
    if bd is not None:
        bpy.data.objects.remove(bd, do_unlink=True)
    ST.world_value(0.055)
    d = H.fit_view(subject, centre,
                   Vector(H.orbit_position(centre, 1.0, -118, 28)) - centre,
                   76.0, res=(1040, 800), margin=1.09)
    cam = H.camera("compare", H.orbit_position(centre, d, -118, 28), centre,
                   lens=76.0)
    H.render(cam, os.path.join(OUT, "polo-folded-v4-compare.png"),
             res=(1040, 800))

    made = retail(subject, centre)
    for ob in made:
        bpy.data.objects.remove(ob, do_unlink=True)
    if "noexport" not in args:
        GLB = os.path.join(REPO, "Assets", "models", "hero", "v4")
        os.makedirs(GLB, exist_ok=True)
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(GLB, "apparel_polo_folded.glb"))
    print("renders in", OUT)


if __name__ == "__main__":
    main()
