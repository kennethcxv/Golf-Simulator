"""Prime Fairways shoe line v2 (R13): proper lasts, welted outsoles, midsole
stripes, eyelets + laced crisscross (or BOA dial / knit sock), toe-cap seams,
heel tabs, side logos, tread normals.  Right-foot display shoes, toe -Y."""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import lib_props as L
import proshop_lib as P
import pf_brand as B

LEN = 0.30

# (y, z, rx, rz) stations of the upper, heel(y=0) -> toe(y=-LEN)
LAST = [
    (-0.004, 0.052, 0.0335, 0.036),
    (-0.022, 0.058, 0.0405, 0.046),
    (-0.058, 0.062, 0.0435, 0.052),
    (-0.100, 0.058, 0.0455, 0.0475),
    (-0.150, 0.050, 0.0505, 0.038),
    (-0.205, 0.040, 0.0495, 0.026),
    (-0.252, 0.034, 0.0395, 0.019),
    (-0.283, 0.029, 0.027, 0.0145),
    (-0.295, 0.026, 0.0165, 0.009),
]
SOLE = [(y, 0.012, rx * 1.03 + 0.003, 0.011) for (y, z, rx, rz) in LAST]


def instep_top(y):
    """Height of the upper surface at station y (for mounting lacing hardware)."""
    pts = [(st[0], st[1] + st[3]) for st in LAST]
    for (y0, t0), (y1, t1) in zip(pts, pts[1:]):
        if y1 <= y <= y0:
            f = (y - y0) / (y1 - y0)
            return t0 + (t1 - t0) * f
    return pts[0][1]


def upper(aid, mat, parent, *, sock=False):
    secs = [(0, y, z, rx, rz) for (y, z, rx, rz) in LAST]
    if sock:
        secs[0] = (0, -0.004, 0.062, 0.030, 0.043)
        secs.insert(0, (0, -0.010, 0.066, 0.0285, 0.040))
    o = P.loft(f"{aid}_upper", secs, (0, 0, 0), mat, parent=parent, ring=18, uv=True)
    # carve the ankle opening: depress the crown between heel and instep
    for v in o.data.vertices:
        if -0.105 < v.co.y < -0.012 and v.co.z > 0.058:
            k = 1.0 - min(1.0, abs(v.co.x) / 0.030)
            depth = (0.058 + (v.co.z - 0.058) * 0.10) - v.co.z
            v.co.z += depth * k
    # collar rim around the opening
    rim = []
    for i in range(15):
        a = math.pi * 2 * i / 14
        rx = 0.0245 + 0.004 * math.cos(a)
        rim.append((math.sin(a) * rx, -0.058 + math.cos(a) * 0.047, 0.0655 + math.cos(a) * 0.008))
    P.tube_path(f"{aid}_collarrim", P.smooth_wire(rim, n=20), 0.0042, mat, parent=parent, verts=8)
    return o


def outsole(aid, sole_mat, tread_mat, parent):
    secs = [(0, y, z, rx, rz) for (y, z, rx, rz) in SOLE]
    P.loft(f"{aid}_outsole", secs, (0, 0, 0), sole_mat, parent=parent, ring=16, uv=True)
    # midsole side stripe (slightly proud ring band, clipped before the toe)
    band = [(0, y, 0.017, rx * 1.012, 0.0045) for (y, z, rx, rz) in SOLE[:-2]]
    P.loft(f"{aid}_midsole", band, (0, 0, 0), tread_mat, parent=parent, ring=14, uv=False)


def toe_seam(aid, sm, parent, *, station=4):
    y, z, rx, rz = LAST[station]
    pts = []
    for i in range(11):
        a = math.pi * (i / 10)
        pts.append((math.cos(a) * rx * 0.97, y + 0.004 - abs(math.sin(a)) * 0.012, z + math.sin(a) * rz * 0.95))
    P.tube_path(f"{aid}_toeseam", pts, 0.0009, sm, parent=parent, verts=4)


def eyestay_laces(aid, mat, lace_mat, parent, M, *, pairs=4):
    ty = -0.126
    tz = instep_top(ty)
    es = P.pillow(f"{aid}_eyestay", (0.042, 0.066, 0.012), (0, ty, tz - 0.002), mat, round_frac=0.6, parent=parent, uv=False)
    es.rotation_euler = (math.radians(-14), 0, 0)
    tg = P.pillow(f"{aid}_tongue", (0.032, 0.052, 0.011), (0, ty - 0.006, tz + 0.0045), mat, round_frac=0.8, parent=parent, uv=False)
    tg.rotation_euler = (math.radians(-14), 0, 0)
    for i in range(pairs):
        yy = -0.150 + i * 0.016
        zz = instep_top(yy) + 0.0035
        for sx in (-1, 1):
            e = L.torus(f"{aid}_eyelet{i}{sx}", 0.0026, 0.001, (sx * 0.0185, yy, zz), M["satin"], parent=parent, mj=10, mn=5)
            e.rotation_euler = (math.radians(75), 0, 0)
        if i < pairs - 1:
            for sx in (-1, 1):
                lc = L.box(f"{aid}_lace{i}{sx}", (0.041, 0.0035, 0.0056), (0, yy + 0.008, zz + 0.0035), lace_mat, bevel=0.0012, parent=parent, uv=False)
                lc.rotation_euler = (math.radians(-14), math.radians(sx * 26), 0)
    yy = -0.150 + (pairs - 1) * 0.016
    L.box(f"{aid}_lacetop", (0.038, 0.0035, 0.0056), (0, yy + 0.005, instep_top(yy) + 0.0075), lace_mat, bevel=0.0012, parent=parent, uv=False)


def boa(aid, mat, parent, M):
    ty = -0.126
    tz = instep_top(ty)
    es = P.pillow(f"{aid}_eyestay", (0.042, 0.066, 0.012), (0, ty, tz - 0.002), mat, round_frac=0.6, parent=parent, uv=False)
    es.rotation_euler = (math.radians(-14), 0, 0)
    dy = -0.102
    dz = instep_top(dy) + 0.002
    L.cyl(f"{aid}_dialbase", 0.0145, 0.007, (0, dy, dz), P.m_flat("M_DialBase", (0.05, 0.052, 0.056), rough=0.4), parent=parent, verts=18)
    L.cyl(f"{aid}_dial", 0.0115, 0.009, (0, dy, dz + 0.005), P.m_tex("M_DialKnurl", P.np_image("DialKnurl", P.base_arr((0.30, 0.38, 0.20), 64, 64, mottle=0.04, seed=145)), rough=0.35, normal=P.nrm_img("knurl", strength=1.6), uvscale=4.0), parent=parent, verts=18)
    wire = P.m_flat("M_BoaWire", (0.55, 0.56, 0.58), rough=0.3, metal=0.8)
    for i in range(3):
        yy = -0.152 + i * 0.018
        zz = instep_top(yy) + 0.003
        for sx in (-1, 1):
            w = L.box(f"{aid}_wire{i}{sx}", (0.040, 0.0016, 0.0022), (0, yy + 0.008, zz + 0.003), wire, bevel=0.0006, parent=parent, uv=False)
            w.rotation_euler = (math.radians(-14), math.radians(sx * 24), 0)


def heel_parts(aid, acc_mat, parent, M, *, tag_text="PF"):
    P.pillow(f"{aid}_heelclip", (0.064, 0.042, 0.070), (0, -0.014, 0.050), acc_mat, round_frac=0.7, parent=parent, uv=False)
    pts = P.smooth_wire([(0, 0.0145, 0.075), (0, 0.024, 0.087), (0, 0.0145, 0.096)], n=8)
    P.tube_path(f"{aid}_pulltab", pts, 0.0028, acc_mat, parent=parent, verts=6)
    arr = P.canvas((0.05, 0.055, 0.06), 128, 64, ss=3, mottle=0.02, seed=141)
    B.arrow_mark(arr, 40, 32, 40, (0.80, 0.79, 0.74))
    P.draw_text(arr, tag_text, 88, 34, 2, (0.80, 0.79, 0.74))
    m = P.m_tex(f"M_ShoeTab_{aid}", P.np_image(f"ShoeTab_{aid}", arr), rough=0.5)
    P.uv_box(f"{aid}_heeltab", (0.026, 0.0016, 0.016), (0, 0.0165, 0.058), m, parent=parent,
             face_uv={"+Y": (0, 0, 1, 1), "-Y": (0, 0, 1, 1)})


def side_logo(aid, parent, base, accent):
    arr = P.canvas(base, 96, 96, ss=3, mottle=0.02, seed=143)
    B.arrow_mark(arr, 48, 48, 62, accent)
    m = P.m_tex(f"M_SideLogo_{aid}", P.np_image(f"SideLogo_{aid}", arr), rough=0.55)
    lg = P.uv_box(f"{aid}_sidelogo", (0.0022, 0.030, 0.026), (0.0505, -0.115, 0.045), m, parent=parent,
                  face_uv={"+X": (0, 0, 1, 1), "-X": (0, 0, 1, 1)})
    lg.rotation_euler = (0, math.radians(-6), math.radians(-6))


def spikes_or_nubs(aid, parent, M, *, spiked):
    if spiked:
        sp = P.m_flat("M_Spike", (0.62, 0.63, 0.60), rough=0.4)
        for (sx, sy) in [(-0.026, -0.245), (0.026, -0.245), (-0.034, -0.185), (0.034, -0.185),
                         (-0.030, -0.120), (0.030, -0.120), (-0.020, -0.045), (0.020, -0.045)]:
            L.cyl(f"{aid}_spk{sx:.3f}{sy:.3f}", 0.0068, 0.004, (sx, sy, 0.004), sp, parent=parent, verts=10)
            L.cyl(f"{aid}_spkc{sx:.3f}{sy:.3f}", 0.003, 0.007, (sx, sy, 0.003), sp, parent=parent, verts=8)
    else:
        nub = P.m_flat("M_Nub", (0.30, 0.40, 0.20), rough=0.6)
        for iy in range(7):
            for ix in (-0.026, 0.0, 0.026):
                L.cyl(f"{aid}_nub{ix:.3f}{iy}", 0.0045, 0.0045, (ix * (1.0 - iy * 0.05), -0.262 + iy * 0.041, 0.0032), nub, parent=parent, verts=6)


def base_shoe(aid, M, *, upper_mat, sole_mat, mid_mat, acc_mat, spiked, closure, base_col, acc_col, tag):
    root = P.asset_root(aid, (0.108, LEN, 0.115), category="shoes")
    outsole(aid, sole_mat, mid_mat, root)
    upper(aid, upper_mat, root, sock=(closure == "sock"))
    sm = P.m_flat(f"M_ShoeSeam_{aid}", tuple(c * 0.7 for c in base_col), rough=0.75)
    toe_seam(aid, sm, root)
    lace = P.m_flat(f"M_Lace_{aid}", tuple(c * 0.5 for c in base_col), rough=0.85)
    if closure == "lace":
        eyestay_laces(aid, upper_mat, lace, root, M)
    elif closure == "boa":
        boa(aid, upper_mat, root, M)
    else:   # sock knit collar
        P.loft(f"{aid}_collar", [(0, -0.008, 0.064, 0.0295, 0.042), (0, -0.020, 0.070, 0.0285, 0.040)],
               (0, 0, 0), upper_mat, parent=root, ring=14, uv=False)
    heel_parts(aid, acc_mat, root, M, tag_text=tag)
    side_logo(aid, root, base_col, acc_col)
    spikes_or_nubs(aid, root, M, spiked=spiked)
    P.collision_box(f"COL_{aid}", (0.106, LEN, 0.12), (0, -LEN / 2 + 0.005, 0.06), M, root)
    P.product_sockets(root, pickup=(0, -0.14, 0.06))
    return root


def spiked_pro(M):
    base = (0.78, 0.77, 0.73)
    return base_shoe("pf_shoe_spiked_pro", M,
                     upper_mat=P.fabric_mat("M_ShoeWhiteV2", base, "leather", rough=0.42, nstr=0.5, seed=147),
                     sole_mat=P.m_tex("M_SoleWhite", P.np_image("SoleWhiteAlb", P.base_arr((0.80, 0.80, 0.78), 256, 256, mottle=0.02, seed=149)), rough=0.55, normal=P.nrm_img("knurl", strength=0.8), uvscale=3.0),
                     mid_mat=P.m_flat("M_MidGrey", (0.30, 0.31, 0.32), rough=0.5),
                     acc_mat=P.m_flat("M_ShoeGrey", (0.28, 0.29, 0.30), rough=0.5),
                     spiked=True, closure="boa", base_col=base, acc_col=(0.30, 0.38, 0.27), tag="PRO")


def knit_flex(M):
    base = (0.05, 0.07, 0.13)
    return base_shoe("pf_shoe_knit_flex", M,
                     upper_mat=P.fabric_mat("M_ShoeKnitV2", base, "knit", rough=0.8, nstr=1.2, seed=151),
                     sole_mat=P.m_flat("M_SoleWhite2", (0.80, 0.80, 0.78), rough=0.55),
                     mid_mat=P.m_flat("M_MidWhite", (0.86, 0.86, 0.84), rough=0.5),
                     acc_mat=P.m_flat("M_ShoeNavyAcc", (0.09, 0.12, 0.20), rough=0.6),
                     spiked=False, closure="sock", base_col=base, acc_col=(0.75, 0.76, 0.78), tag="FLEX")


def saddle_classic(M):
    base = (0.78, 0.77, 0.73)
    root = base_shoe("pf_shoe_saddle_classic", M,
                     upper_mat=P.fabric_mat("M_ShoeWhiteV2", base, "leather", rough=0.42, nstr=0.5, seed=147),
                     sole_mat=P.m_flat("M_SoleTan", (0.35, 0.28, 0.20), rough=0.6),
                     mid_mat=P.m_flat("M_WeltTan", (0.45, 0.37, 0.27), rough=0.55),
                     acc_mat=P.fabric_mat("M_ShoeNavyL", (0.05, 0.07, 0.14), "leather", rough=0.45, nstr=0.5, seed=153),
                     spiked=True, closure="lace", base_col=base, acc_col=(0.30, 0.38, 0.27), tag="CLS")
    navy = P.fabric_mat("M_ShoeNavyL", (0.05, 0.07, 0.14), "leather", rough=0.45, nstr=0.5, seed=153)
    P.pillow("pf_shoe_saddle_classic_saddle", (0.104, 0.070, 0.052), (0, -0.128, 0.040), navy, round_frac=0.55, parent=root, uv=False)
    return root


def waterproof_trail(M):
    base = (0.055, 0.058, 0.062)
    return base_shoe("pf_shoe_waterproof_trail", M,
                     upper_mat=P.fabric_mat("M_ShoeCharV2", base, "leather", rough=0.48, nstr=0.55, seed=155),
                     sole_mat=P.m_tex("M_SoleGrey", P.np_image("SoleGreyAlb", P.base_arr((0.42, 0.43, 0.44), 256, 256, mottle=0.03, seed=157)), rough=0.6, normal=P.nrm_img("knurl", strength=1.0), uvscale=3.0),
                     mid_mat=P.m_flat("M_MidGrey2", (0.52, 0.53, 0.54), rough=0.5),
                     acc_mat=P.m_flat("M_ShoeGreenAcc", (0.25, 0.34, 0.16), rough=0.55),
                     spiked=False, closure="lace", base_col=base, acc_col=(0.45, 0.55, 0.32), tag="WPF")


REG = {
    "pf_shoe_spiked_pro": spiked_pro,
    "pf_shoe_knit_flex": knit_flex,
    "pf_shoe_saddle_classic": saddle_classic,
    "pf_shoe_waterproof_trail": waterproof_trail,
}

META = {a: {"name": n, "variant": v, "price": p, "fixture": "pf_fixture_shoe_display", "slot_type": "shoe_tier", "packaging": "display single"}
        for a, n, v, p in [
            ("pf_shoe_spiked_pro", "PF Tour Spiked Shoe", "white_dial", 179.99),
            ("pf_shoe_knit_flex", "PF Knit Flex Spikeless", "navy_knit", 129.99),
            ("pf_shoe_saddle_classic", "PF Classic Saddle Shoe", "white_navy", 159.99),
            ("pf_shoe_waterproof_trail", "PF Waterproof Trail Shoe", "charcoal", 149.99)]}

P.run_batch(REG, kind="products", category_of=lambda a: "shoes", manifest_extra=lambda a: META.get(a))
