"""Prime Fairways hat line v2 (R02) — reference-fidelity build:
panel seams, stitched brims with edge binding, ropes seated on the crown,
eyelets, buttons, fabric normal maps.

  pf_hat_structured  cream 5-panel rope cap (navy rope)
  pf_hat_performance sage perforated cap (speckled rope)
  pf_hat_visor       navy visor
  pf_hat_bucket      cream bucket hat (sage band)
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import lib_props as L
import proshop_lib as P

CREAM = (0.72, 0.68, 0.57)
SAGE = (0.30, 0.36, 0.26)
NAVY = (0.045, 0.06, 0.11)
CHARCOAL = (0.055, 0.058, 0.062)

CROWN_PROF = [(1.000, 0.00), (0.998, 0.28), (0.960, 0.55), (0.870, 0.76), (0.700, 0.90), (0.430, 0.975), (0.0, 1.0)]


def face_front(o):
    from mathutils import Matrix
    cx = sum(v.co.x for v in o.data.vertices) / len(o.data.vertices)
    cy = sum(v.co.y for v in o.data.vertices) / len(o.data.vertices)
    o.data.transform(Matrix.Rotation(-math.pi / 2 - math.atan2(cy, cx), 4, "Z"))
    return o


def crown(prefix, mat, seam_mat, parent, *, r=0.0885, hgt=0.098, z=0.022, sy=1.10, seams=6):
    prof = [(r * a, hgt * b) for a, b in CROWN_PROF]
    P.lathe(f"{prefix}_crown", prof, (0, 0.004, z), mat, steps=28, parent=parent, scale_y=sy, uv=True)
    # panel seam ridges from near the button down to the base edge
    for k in range(seams):
        a = 2 * math.pi * k / seams + math.pi / seams
        pts = []
        for (ra, zb) in CROWN_PROF[:-1][::-1]:
            rr = r * ra + 0.0012
            pts.append((math.cos(a) * rr, math.sin(a) * rr * sy + 0.004, z + hgt * zb))
        P.tube_path(f"{prefix}_seam{k}", P.smooth_wire(pts, n=14), 0.0011, seam_mat, parent=parent, verts=6)
    # closing band at the crown base (hides the brim junction)
    band = P.lathe(f"{prefix}_baseband", [(r + 0.0015, 0.0), (r + 0.0015, 0.012), (r - 0.001, 0.012), (r - 0.001, 0.0)],
                   (0, 0.004, z - 0.002), mat, steps=28, scale_y=sy, uv=False, smooth=60)
    L.parent_keep(band, parent)
    # button
    L.cyl(f"{prefix}_buttonbase", 0.006, 0.004, (0, 0.004, z + hgt + 0.001), seam_mat, parent=parent, verts=12)
    L.sphere(f"{prefix}_button", 0.0072, (0, 0.004, z + hgt + 0.004), mat, parent=parent, segs=12)
    # side eyelets on the upper panels
    for sx in (-1, 1):
        e = L.torus(f"{prefix}_eyelet{sx}", 0.0042, 0.0014, (0, 0, 0), mat, parent=parent, mj=12, mn=6)
        e.location = (sx * r * 0.55, 0.004 - r * sy * 0.50, z + hgt * 0.64)
        e.rotation_euler = (math.radians(62), 0, math.radians(-sx * 36))


def brim(prefix, mat, stitch_mat, parent, *, r_in=0.060, r_out=0.152, z=0.030, tilt=0.24, thick=0.0052, arc=2.02, curl=0.010):
    o = P.lathe(f"{prefix}_brim",
                [(r_in, 0.0), (r_out * 0.985, 0.0), (r_out, thick * 0.5), (r_out * 0.985, thick), (r_in, thick)],
                (0, 0, 0), mat, steps=22, angle=arc, uv=True, smooth=60)
    face_front(o)
    o.rotation_euler.x = tilt
    o.location = (0, -0.018, z)
    for v in o.data.vertices:
        v.co.z -= (abs(v.co.x) / r_out) ** 2 * curl * r_out / 0.148
    L.parent_keep(o, parent)
    ca, sa = math.cos(tilt), math.sin(tilt)

    def rim_world(a, rr, lift):
        x = math.cos(a) * rr
        yl = math.sin(a) * rr
        wy = yl * ca - lift * sa - 0.018
        wz = z + yl * sa + lift * ca - (abs(x) / r_out) ** 2 * curl * r_out / 0.148
        return (x, wy, wz)

    # stitch arcs sitting just above the brim cloth
    for si, rr in enumerate((r_out - 0.008, r_out - 0.017, r_out - 0.026, r_out - 0.035)):
        pts = [rim_world(-math.pi / 2 + (arc * 0.94) * (i / 14 - 0.5), rr, thick + 0.0008) for i in range(15)]
        P.tube_path(f"{prefix}_stitch{si}", pts, 0.0006, stitch_mat, parent=parent, verts=4)
    # rolled edge binding along the outer rim
    pts = [rim_world(-math.pi / 2 + arc * (i / 16 - 0.5), r_out, thick * 0.5) for i in range(17)]
    P.tube_path(f"{prefix}_binding", pts, thick * 0.62, mat, parent=parent, verts=8)
    return o


def rope(prefix, mat, parent, *, rx=0.0905, ry=0.1005, z=0.030, tube=0.0042):
    pts = [(math.cos(a) * rx, math.sin(a) * ry + 0.004, z) for a in
           [-math.pi / 2 + math.pi * 0.66 * (i / 14 - 0.5) for i in range(15)]]
    P.tube_path(f"{prefix}_rope", pts, tube, mat, parent=parent, verts=10)
    for sx in (0, -1):
        L.sphere(f"{prefix}_ropeend{sx}", tube * 1.12, pts[sx], mat, parent=parent, segs=8)


def build_structured(M):
    aid = "pf_hat_structured"
    root = P.asset_root(aid, (0.185, 0.265, 0.115), category="hats",
                        extra={"material_variants": "hat_cream,hat_sage,hat_navy,hat_charcoal"})
    fab = P.fabric_mat("M_HatCreamV2", CREAM, "canvas", rough=0.72, nstr=0.9, seed=111)
    seam = P.m_flat("M_HatSeamCream", tuple(c * 0.82 for c in CREAM), rough=0.75)
    stitch = P.m_flat("M_HatStitch", tuple(c * 0.6 for c in CREAM), rough=0.8)
    crown(aid, fab, seam, root)
    brim(aid, fab, stitch, root)
    rope(aid, P.m_flat("M_HatRopeNavy", NAVY, rough=0.55), root)
    P.collision_box(f"COL_{aid}", (0.19, 0.27, 0.125), (0, -0.02, 0.062), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.07))
    return root


def build_performance(M):
    aid = "pf_hat_performance"
    root = P.asset_root(aid, (0.185, 0.265, 0.115), category="hats",
                        extra={"material_variants": "hat_cream,hat_sage,hat_navy,hat_charcoal"})
    import numpy as np
    arr = P.fabric_arr(SAGE, 512, 512, kind="knit", seed=113)
    yy, xx = np.mgrid[0:512, 0:512]
    dots = (((xx % 13) < 4) & ((yy % 13) < 4) & (yy > 150) & (yy < 390)).astype("float32")
    arr = np.clip(arr * (1.0 - dots[..., None] * 0.5), 0, 1)
    fab = P.m_tex("M_HatSagePerfV2", P.np_image("HatSagePerfV2", arr), rough=0.62,
                  normal=P.nrm_img("knit", strength=1.0), rough_img=P.rough_img_from("knit", 0.62, 0.15))
    seam = P.m_flat("M_HatSeamSage", tuple(c * 0.8 for c in SAGE), rough=0.7)
    stitch = P.m_flat("M_HatStitchSage", tuple(c * 0.55 for c in SAGE), rough=0.8)
    crown(aid, fab, seam, root)
    brim(aid, fab, stitch, root)
    rope_arr = P.base_arr((0.75, 0.75, 0.72), 128, 32, mottle=0.02, seed=115)
    rng = np.random.default_rng(9)
    for _ in range(70):
        px, py = rng.integers(0, 124), rng.integers(0, 28)
        rope_arr[py:py + 3, px:px + 3] = (0.06, 0.07, 0.10)
    rope(aid, P.m_tex("M_HatRopeSpeck", P.np_image("HatRopeSpeck", rope_arr), rough=0.6), root)
    P.collision_box(f"COL_{aid}", (0.19, 0.27, 0.125), (0, -0.02, 0.062), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.07))
    return root


def build_visor(M):
    aid = "pf_hat_visor"
    root = P.asset_root(aid, (0.185, 0.24, 0.085), category="hats",
                        extra={"material_variants": "hat_cream,hat_sage,hat_navy,hat_charcoal"})
    fab = P.fabric_mat("M_HatNavyV2", NAVY, "canvas", rough=0.68, nstr=0.9, seed=117)
    stitch = P.m_flat("M_HatStitchNavy", (0.14, 0.16, 0.24), rough=0.8)
    brim(aid, fab, stitch, root, z=0.034, tilt=0.27)
    arc = math.radians(285)
    band = P.lathe(f"{aid}_band",
                   [(0.0940, 0.0), (0.0952, 0.024), (0.0940, 0.048), (0.0890, 0.048), (0.0890, 0.0)],
                   (0, 0.002, 0.012), fab, steps=24, angle=arc, uv=True, smooth=60)
    face_front(band)
    band.rotation_euler.x = 0.08
    L.parent_keep(band, root)
    sweat = P.lathe(f"{aid}_sweat", [(0.0885, 0.004), (0.0885, 0.044), (0.0855, 0.044), (0.0855, 0.004)],
                    (0, 0.002, 0.012), P.fabric_mat("M_HatTerry", (0.42, 0.42, 0.41), "fleece", rough=0.85, seed=119),
                    steps=20, angle=arc, uv=False)
    face_front(sweat)
    sweat.rotation_euler.x = 0.08
    L.parent_keep(sweat, root)
    # rolled top edge of the band
    pts = []
    for i in range(19):
        a = -math.pi / 2 + arc * (i / 18 - 0.5)
        pts.append((math.cos(a) * 0.0945, math.sin(a) * 0.0945 + 0.002, 0.059))
    P.tube_path(f"{aid}_bindtop", pts, 0.0022, fab, parent=root, verts=6)
    # rear velcro closure straps bridging the gap
    for sy, wq in ((0.086, 0.032), (0.072, 0.028)):
        L.box(f"{aid}_strap{int(sy*1000)}", (wq, 0.006, 0.022), (0.0, sy, 0.036), fab, bevel=0.002, parent=root, uv=False)
    P.collision_box(f"COL_{aid}", (0.19, 0.245, 0.09), (0, -0.02, 0.045), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.05))
    return root


def build_bucket(M):
    aid = "pf_hat_bucket"
    root = P.asset_root(aid, (0.30, 0.30, 0.115), category="hats",
                        extra={"material_variants": "hat_cream,hat_sage,hat_navy,hat_charcoal"})
    fab = P.fabric_mat("M_HatCreamB2", CREAM, "canvas", rough=0.74, nstr=0.35, seed=121)
    stitch = P.m_flat("M_HatStitchB", tuple(c * 0.6 for c in CREAM), rough=0.8)
    prof = [(0.150, 0.000), (0.153, 0.005), (0.149, 0.011), (0.098, 0.030), (0.0925, 0.045),
            (0.089, 0.075), (0.086, 0.098), (0.070, 0.110), (0.038, 0.1145), (0.0, 0.115)]
    P.lathe(f"{aid}_body", prof, (0, 0, 0), fab, steps=30, parent=root, uv=True)
    # brim stitch rings following the slope + crown seam ring
    for rr, zz in ((0.142, 0.0035), (0.128, 0.0105), (0.113, 0.0185), (0.101, 0.0265)):
        s = L.torus(f"{aid}_stitch{int(rr*1000)}", rr, 0.0007, (0, 0, zz), stitch, parent=root, mj=36, mn=4)
        s.scale = (1, 1, 0.5)
    L.torus(f"{aid}_crownseam", 0.0875, 0.0011, (0, 0, 0.094),
            P.m_flat("M_HatSeamCrB", tuple(c * 0.82 for c in CREAM), rough=0.75), parent=root, mj=30, mn=5)
    L.cyl(f"{aid}_band", 0.0945, 0.024, (0, 0, 0.052), P.fabric_mat("M_HatBandSage2", SAGE, "canvas", rough=0.66, nstr=0.3, seed=123), parent=root, verts=30)
    L.cyl(f"{aid}_bandstripe", 0.0952, 0.0045, (0, 0, 0.052), P.m_flat("M_HatStripe", (0.82, 0.82, 0.78), rough=0.6), parent=root, verts=30)
    for sx in (-1, 1):
        e = L.torus(f"{aid}_eyelet{sx}", 0.0045, 0.0016, (0, 0, 0), M["brass"], parent=root, mj=12, mn=6)
        e.location = (sx * 0.058, -0.062, 0.086)
        e.rotation_euler = (math.radians(70), 0, math.radians(sx * 40))
    P.collision_box(f"COL_{aid}", (0.305, 0.305, 0.12), (0, 0, 0.06), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.08))
    return root


REG = {
    "pf_hat_structured": build_structured,
    "pf_hat_performance": build_performance,
    "pf_hat_visor": build_visor,
    "pf_hat_bucket": build_bucket,
}

META = {
    "pf_hat_structured": {"name": "PF Structured Rope Cap", "variant": "cream_navy", "price": 29.99, "fixture": "pf_fixture_hat_wall", "slot_type": "hat_shelf", "packaging": "none"},
    "pf_hat_performance": {"name": "PF Performance Perf Cap", "variant": "sage", "price": 32.99, "fixture": "pf_fixture_hat_wall", "slot_type": "hat_shelf", "packaging": "none"},
    "pf_hat_visor": {"name": "PF Tour Visor", "variant": "navy", "price": 24.99, "fixture": "pf_fixture_hat_wall", "slot_type": "hat_shelf", "packaging": "none"},
    "pf_hat_bucket": {"name": "PF Bucket Hat", "variant": "cream_sage", "price": 34.99, "fixture": "pf_fixture_hat_wall", "slot_type": "hat_shelf", "packaging": "none"},
}

P.run_batch(REG, kind="products", category_of=lambda a: "hats", manifest_extra=lambda a: META.get(a))
