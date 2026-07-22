"""Prime Fairways divot tools (R06): classic steel / folding black / slim cutout /
folding sage — loose tools + hang-card retail versions."""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import lib_props as L
import proshop_lib as P
import pf_brand as B

DGREEN = (0.055, 0.14, 0.075)


def prongs(prefix, M, parent, *, y0, z, length=0.032, gap=0.008, taper=0.7, mat=None):
    mt = mat or M["satin"]
    for sx in (-1, 1):
        P.loft(f"{prefix}_prong{sx}",
               [(sx * gap / 2, y0, z, 0.0032, 0.0016),
                (sx * gap / 2 * 0.9, y0 + length * 0.6, z, 0.0026, 0.0013),
                (sx * gap / 2 * 0.82, y0 + length, z, 0.0008, 0.0006)],
               (0, 0, 0), mt, parent=parent, ring=8, uv=False)


def build_classic(M):
    aid = "pf_divot_classic"
    root = P.asset_root(aid, (0.022, 0.075, 0.006), category="divot_tools")
    satin = M["satin"]
    body = P.pillow(f"{aid}_body", (0.021, 0.042, 0.0045), (0, -0.012, 0.003), satin, round_frac=0.75, parent=root, uv=False)
    L.cyl(f"{aid}_markerrim", 0.0085, 0.0052, (0, -0.021, 0.0032), M["brass"], parent=root, verts=20)
    L.cyl(f"{aid}_marker", 0.0072, 0.0058, (0, -0.021, 0.0034), P.m_flat("M_DivGreen", DGREEN, rough=0.35), parent=root, verts=20)
    # knurl patch
    kn = P.m_tex("M_DivKnurl", P.np_image("DivKnurl", P.base_arr((0.30, 0.31, 0.33), 64, 64, mottle=0.22, seed=81)), rough=0.5, metal=0.6)
    P.pillow(f"{aid}_knurl", (0.014, 0.014, 0.0052), (0, -0.001, 0.003), kn, round_frac=0.5, parent=root)
    prongs(aid, M, root, y0=0.008, z=0.0028)
    P.collision_box(f"COL_{aid}", (0.024, 0.078, 0.008), (0, 0, 0.004), M, root)
    P.product_sockets(root, pickup=(0, -0.01, 0.005))
    return root


def build_folding_black(M):
    aid = "pf_divot_folding_black"
    root = P.asset_root(aid, (0.024, 0.070, 0.009), category="divot_tools")
    blk = P.m_flat("M_DivBlack", (0.030, 0.032, 0.036), rough=0.4, metal=0.3)
    P.pillow(f"{aid}_body", (0.023, 0.048, 0.0075), (0, -0.010, 0.0045), blk, round_frac=0.85, parent=root, uv=False)
    L.cyl(f"{aid}_markerrim", 0.0088, 0.0055, (0, -0.020, 0.0052), M["brass"], parent=root, verts=20)
    L.cyl(f"{aid}_marker", 0.0074, 0.0062, (0, -0.020, 0.0054), P.m_flat("M_DivGreen", DGREEN, rough=0.35), parent=root, verts=20)
    L.cyl(f"{aid}_button", 0.0035, 0.0062, (0, 0.006, 0.0052), M["brass"], parent=root, verts=14)
    prongs(aid, M, root, y0=0.012, z=0.0040, length=0.028)
    P.collision_box(f"COL_{aid}", (0.026, 0.074, 0.011), (0, 0, 0.0055), M, root)
    P.product_sockets(root, pickup=(0, -0.008, 0.007))
    return root


def build_slim(M):
    aid = "pf_divot_slim"
    root = P.asset_root(aid, (0.020, 0.078, 0.005), category="divot_tools")
    satin = M["satin"]
    body = P.pillow(f"{aid}_body", (0.019, 0.050, 0.0038), (0, -0.011, 0.0026), satin, round_frac=0.6, parent=root, uv=False)
    cutter = L.box("slimcut", (0.0075, 0.020, 0.01), (0, -0.013, 0.0026), M["collision"], bevel=0.0, uv=False)
    P.boolean_cut(body, cutter)
    L.cyl(f"{aid}_marker", 0.0078, 0.0048, (0, -0.030, 0.0028), P.m_flat("M_DivDark", (0.06, 0.062, 0.066), rough=0.5), parent=root, verts=20)
    for i in range(3):
        L.box(f"{aid}_line{i}", (0.016, 0.0012, 0.0044), (0, 0.0035 + i * 0.0032, 0.0026), M["black"], bevel=0.0, parent=root, uv=False)
    prongs(aid, M, root, y0=0.012, z=0.0024, length=0.030)
    P.collision_box(f"COL_{aid}", (0.022, 0.082, 0.007), (0, 0, 0.0035), M, root)
    P.product_sockets(root, pickup=(0, -0.01, 0.004))
    return root


def build_folding_sage(M):
    aid = "pf_divot_folding_sage"
    root = P.asset_root(aid, (0.024, 0.068, 0.009), category="divot_tools")
    sage = P.m_flat("M_DivSage", (0.20, 0.26, 0.16), rough=0.45)
    P.pillow(f"{aid}_scaleL", (0.022, 0.044, 0.0036), (0, -0.012, 0.0068), sage, round_frac=0.8, parent=root, uv=False)
    P.pillow(f"{aid}_scaleR", (0.022, 0.044, 0.0036), (0, -0.012, 0.0022), sage, round_frac=0.8, parent=root, uv=False)
    P.pillow(f"{aid}_forkstow", (0.014, 0.040, 0.0024), (0, -0.008, 0.0045), M["satin"], round_frac=0.6, parent=root, uv=False)
    L.cyl(f"{aid}_pivot", 0.0042, 0.0095, (0, -0.028, 0.0045), M["brass"], parent=root, verts=16)
    L.cyl(f"{aid}_button", 0.0036, 0.0095, (0, 0.002, 0.0045), M["brass"], parent=root, verts=14)
    prongs(aid, M, root, y0=0.010, z=0.0045, length=0.030)
    P.collision_box(f"COL_{aid}", (0.026, 0.072, 0.011), (0, 0, 0.0055), M, root)
    P.product_sockets(root, pickup=(0, -0.008, 0.007))
    return root


CARD = (0.09, 0.0022, 0.15)


def hangcard(aid, title, sub, M, tool_builder):
    W, T, H = CARD
    root = P.asset_root(aid, (W, 0.014, H), category="divot_tools")
    arr = B.hangcard_arr(512, 852, base=(0.80, 0.78, 0.70), band=(0.10, 0.16, 0.10), title=title,
                         subtitle=sub, accent=(0.72, 0.62, 0.38), seed=83, sku="8 41200 7742")
    m = P.m_tex(f"M_{aid}_card", P.np_image(f"Card_{aid}", arr), rough=0.6)
    card = P.uv_box(f"{aid}_card", (W, T, H), (0, 0, H / 2), m, parent=root, bevel=0.0008,
                    face_uv={"-Y": (0, 0, 1, 1), "+Y": (0, 0, 1, 1)})
    cutter = L.box("slotcut", (0.028, 0.02, 0.005), (0, 0, H * 0.94), M["collision"], bevel=0.0, uv=False)
    P.boolean_cut(card, cutter)
    tool = tool_builder(M)
    tool.name = f"{aid}_item"
    tool.location = (0, -T - 0.004, H * 0.47)
    tool.rotation_euler = (math.radians(90), 0, 0)
    L.parent_keep(tool, root)
    for o in list(tool.children):
        if o.name.startswith("COL_") or o.name in ("PICKUP_SOCKET", "SHELF_ANCHOR"):
            bpy.data.objects.remove(o, do_unlink=True)
    P.collision_box(f"COL_{aid}", (W, 0.016, H), (0, -0.005, H / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H * 0.5), hang=(0, 0, H * 0.94))
    return root


REG = {
    "pf_divot_classic": build_classic,
    "pf_divot_folding_black": build_folding_black,
    "pf_divot_slim": build_slim,
    "pf_divot_folding_sage": build_folding_sage,
    "pf_divot_classic_card": lambda M: hangcard("pf_divot_classic_card", "DIVOT TOOL", "BRUSHED STEEL", M, build_classic),
    "pf_divot_folding_black_card": lambda M: hangcard("pf_divot_folding_black_card", "FOLDING TOOL", "MAGNETIC MARKER", M, build_folding_black),
    "pf_divot_slim_card": lambda M: hangcard("pf_divot_slim_card", "TOUR DIVOT TOOL", "SLIM PROFILE", M, build_slim),
    "pf_divot_folding_sage_card": lambda M: hangcard("pf_divot_folding_sage_card", "FOLDING TOOL", "FIELD EDITION", M, build_folding_sage),
}

META = {a: {"name": n, "variant": v, "price": p, "fixture": "pf_fixture_accessory_slatwall",
            "slot_type": ("hook_card" if a.endswith("_card") else "loose"), "packaging": ("hang-card" if a.endswith("_card") else "loose")}
        for a, n, v, p in [
            ("pf_divot_classic", "Classic Divot Tool", "steel_green", 11.99),
            ("pf_divot_folding_black", "Folding Divot Tool", "black_brass", 16.99),
            ("pf_divot_slim", "Slim Tour Divot Tool", "steel", 13.99),
            ("pf_divot_folding_sage", "Folding Divot Tool Field", "sage_brass", 18.99),
            ("pf_divot_classic_card", "Classic Divot Tool (Card)", "steel_green", 11.99),
            ("pf_divot_folding_black_card", "Folding Divot Tool (Card)", "black_brass", 16.99),
            ("pf_divot_slim_card", "Slim Tour Divot Tool (Card)", "steel", 13.99),
            ("pf_divot_folding_sage_card", "Folding Divot Tool Field (Card)", "sage_brass", 18.99)]}

P.run_batch(REG, kind="products", category_of=lambda a: "divot_tools", manifest_extra=lambda a: META.get(a))
