"""TEE, FOLDED -- v4. On a shop table.

Reference: qa/hero/v4/ref/folded-ref1.jpg for the fold, tee-hung-ref1.jpg for
the neck rib and the print.

v3's faults, from qa/hero/v3/apparel/tee-folded/tee-folded-eevee-hero.png:

  EF1  "Do not build a thick rectangular block and decorate it until it
       resembles a shirt" -- which is what it was. A folded tee is the
       THINNEST thing in this set, about 36 mm across 290, and v3's was 43 mm
       of uniform slab.
  EF2  The print is a flat card with a border.
  EF3  No neck rib, so nothing says which way up it is.

A folded tee has almost nothing on it. What it has is thinness, four crisp
thin lips at the front, a rib at the neck and a print. Getting the thinness
wrong is most of the fault.

    blender --factory-startup -b --python tools/blender/hero/v4/tee_folded.py
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
OUT = os.path.join(REPO, "qa", "hero", "v4", "tee-folded")

HALF_W, HALF_D = 0.1455, 0.1130
PLIES = 4
PLY_T = 0.0068
PLY_GAP = 0.0026


def bulk(t, ply):
    mid = math.exp(-((t - 0.48) / 0.34) ** 2)
    return 1.0 + 0.20 * mid * (0.0 if ply >= PLIES - 1 else 1.0)


def neck_rib(body):
    """The ribbed crew band showing at the back edge of the top ply."""
    pts = []
    for i in range(25):
        u = -1.0 + 2.0 * (i / 24.0)
        x = 0.062 * math.sin(u * 1.62)
        y = HALF_D * (0.930 - 0.085 * (1.0 - u * u))
        hit, nrm = F.top_at(body, x, y)
        if hit is not None:
            pts.append(hit + Vector((0, 0, 0.0014)))
    if len(pts) < 6:
        return []
    ob = D.topstitch("neck_rib", pts, radius=0.0027, sides=9)
    D.shade_smooth(ob, 44.0)
    return [ob]


def print_panel(body):
    """Ink on the top ply, conformed. No border, no card."""
    CX, CZ, R = 0.0, HALF_D * 0.06, 0.0505
    NA, NR = 40, 11
    rows = []
    for j in range(NR + 1):
        rr = R * (j / NR)
        row = []
        for i in range(NA):
            a = 2 * math.pi * i / NA
            x = CX + rr * math.sin(a)
            y = CZ + rr * math.cos(a) * 0.94
            hit, nrm = F.top_at(body, x, y)
            if hit is None:
                hit = Vector((x, y, 0.05))
            row.append(tuple(Vector(hit) + Vector((0, 0, 0.00085))))
        rows.append(row)
    ob = D.grid_mesh("print", rows, wrap_u=True)
    D.shade_smooth(ob, 50.0)
    ring = []
    for i in range(41):
        a = 2 * math.pi * i / 40.0
        hit, nrm = F.top_at(body, CX + R * 1.11 * math.sin(a),
                            CZ + R * 1.11 * math.cos(a) * 0.94)
        if hit is not None:
            ring.append(Vector(hit) + Vector((0, 0, 0.00085)))
    out = [ob]
    if len(ring) > 8:
        rg = D.topstitch("print_ring", ring, radius=0.0017, sides=8)
        D.shade_smooth(rg, 46.0)
        out.append(rg)
    return out


def sleeve_fold(body):
    out = []
    for sx in (-1, 1):
        pts = []
        for i in range(17):
            t = i / 16.0
            x = sx * HALF_W * (0.90 - 0.14 * t)
            y = HALF_D * (0.80 - 1.60 * t)
            hit, nrm = F.top_at(body, x, y)
            if hit is not None:
                pts.append(hit + Vector((0, 0, 0.0009)))
        if len(pts) > 6:
            ob = D.topstitch("sleeve_fold%+d" % sx, pts, radius=0.0014,
                             sides=8)
            D.shade_smooth(ob, 42.0)
            out.append(ob)
    return out


def size_tag(body):
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromPolygons(
        [v.co.copy() for v in body.data.vertices],
        [tuple(p.vertices) for p in body.data.polygons])
    zs = [v.co.z for v in body.data.vertices]
    z0 = min(zs) + (max(zs) - min(zs)) * 0.50
    rows = []
    for j in range(7):
        z = z0 - 0.008 + 0.016 * (j / 6.0)
        row = []
        for i in range(9):
            x = 0.082 + 0.026 * (i / 8.0)
            hit, _n, _i, _d = bvh.ray_cast(Vector((x, -0.40, z)),
                                           Vector((0.0, 1.0, 0.0)), 1.0)
            if hit is None:
                continue
            row.append(tuple(hit + Vector((0, -0.0006, 0))))
        if len(row) == 9:
            rows.append(row)
    if len(rows) < 3:
        return []
    ob = D.grid_mesh("size_tag", rows)
    ob.data.materials.append(ST.matte("SizeTag", (0.80, 0.79, 0.75), 0.55))
    D.shade_smooth(ob, 50.0)
    return [ob]


def jersey_material(colour=(0.5400, 0.5250, 0.4900)):
    mat = bpy.data.materials.new("FoldedJersey")
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
    n.inputs["Scale"].default_value = 560.0
    n.inputs["Detail"].default_value = 6.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.055
    bump.inputs["Distance"].default_value = 0.0008
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return mat


def retail(subject, centre):
    for n in ("Backdrop", "key", "fill", "rim", "under"):
        ob = bpy.data.objects.get(n)
        if ob is not None:
            bpy.data.objects.remove(ob, do_unlink=True)
    lo, hi = H.bounds(subject)
    made = [ST.shop_floor(lo.z - 0.001, value=0.30),
            ST.shop_wall(1.20, lo.z - 0.001)]
    off = []
    for k in range(1, 7):
        off.append((0.004 * k, -0.003 * k, (hi.z - lo.z) * 0.78 * k))
    for c in (-1, 1):
        for k in range(6):
            off.append((c * 0.330 + 0.004 * k, 0.006 * k,
                        (hi.z - lo.z) * 0.78 * k))
    made += ST.duplicate_along(subject, off, rot_jitter=0.060,
                               scale_jitter=0.010)
    mid = Vector((0.0, 0.0, lo.z + 0.11))
    ST.garment_lights(centre=(0.0, 0.0, mid.z + 0.28), scale=0.85, warm=True)
    ST.world_value(0.035)
    for label, az, el, d in (("retail", -104, 22, 1.24),
                             ("retail-q34", -132, 32, 1.16)):
        cam = H.camera(label, H.orbit_position(mid, d, az, el), mid, lens=58.0)
        H.render(cam, os.path.join(OUT, "tee-folded-v4-%s.png" % label),
                 res=(1360, 900))
    return made


def main():
    args = H.argv_after_dashes()
    H.reset_scene()
    os.makedirs(OUT, exist_ok=True)

    body = F.concertina("tee_folded", HALF_W, HALF_D, plies=PLIES,
                        ply_t=PLY_T, ply_gap=PLY_GAP, roll_r=0.0054,
                        nu=44, wander=0.0026, seed=9.4, squash=0.44,
                        bulk=bulk)
    F.undulate(body, amp=0.0016, seed=6.8, only_top=0.56)
    F.side_crease(body, -HALF_W * 0.24, depth=0.0022, width=0.010)

    nr = neck_rib(body)
    pr = print_panel(body)
    sf = sleeve_fold(body)
    tg = size_tag(body)

    cloth = jersey_material()
    rib = jersey_material((0.4600, 0.4460, 0.4150))
    ink = jersey_material((0.0640, 0.1450, 0.1050))
    body.data.materials.append(cloth)
    for o in nr + sf:
        o.data.materials.append(rib)
    for o in pr:
        o.data.materials.append(ink)

    subject = [body] + list(nr) + list(pr) + list(sf) + list(tg)
    print("tee-folded v4: TRIS %d" % D.tri_count(subject))
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
    for label, az, el, res in (("hero", -118, 28, (1000, 800)),
                               ("front", -90, 8, (1000, 680)),
                               ("side", -180, 8, (1000, 680)),
                               ("top", -90, 72, (900, 900))):
        d = H.fit_view(subject, centre,
                       Vector(H.orbit_position(centre, 1.0, az, el)) - centre,
                       76.0, res=res, margin=1.13)
        cam = H.camera(label, H.orbit_position(centre, d, az, el), centre,
                       lens=76.0)
        H.render(cam, os.path.join(OUT, "tee-folded-v4-%s.png" % label),
                 res=res)

    bd = bpy.data.objects.get("Backdrop")
    if bd is not None:
        bpy.data.objects.remove(bd, do_unlink=True)
    ST.world_value(0.055)
    d = H.fit_view(subject, centre,
                   Vector(H.orbit_position(centre, 1.0, -118, 28)) - centre,
                   76.0, res=(1040, 800), margin=1.05)
    cam = H.camera("compare", H.orbit_position(centre, d, -118, 28), centre,
                   lens=76.0)
    H.render(cam, os.path.join(OUT, "tee-folded-v4-compare.png"),
             res=(1040, 800))

    made = retail(subject, centre)
    for ob in made:
        bpy.data.objects.remove(ob, do_unlink=True)
    if "noexport" not in args:
        GLB = os.path.join(REPO, "Assets", "models", "hero", "v4")
        os.makedirs(GLB, exist_ok=True)
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(GLB, "apparel_tee_folded.glb"))
    print("renders in", OUT)


if __name__ == "__main__":
    main()
