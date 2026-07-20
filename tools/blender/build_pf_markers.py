"""Prime Fairways ball markers (R07): coin / enamel / clip / engraved,
each as a loose marker + a retail hang-card version."""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import bmesh
import lib_props as L
import proshop_lib as P
import pf_brand as B

DGREEN = (0.055, 0.14, 0.075)


def coin(name, r, h, mat, loc, parent, *, steps=28):
    """Cylinder whose top cap maps the full texture (v 0.08..1), side maps a strip."""
    bm = bmesh.new()
    top, bot = [], []
    for i in range(steps):
        a = 2 * math.pi * i / steps
        x, y = math.sin(a) * r, -math.cos(a) * r
        top.append(bm.verts.new((x, y, h)))
        bot.append(bm.verts.new((x, y, 0)))
    uvl = bm.loops.layers.uv.new("UVMap")
    ftop = bm.faces.new(top)
    for lp in ftop.loops:
        c = lp.vert.co
        lp[uvl].uv = (c.x / (2 * r) + 0.5, (-c.y / (2 * r) + 0.5) * 0.92 + 0.08)
    fbot = bm.faces.new(tuple(reversed(bot)))
    for lp in fbot.loops:
        c = lp.vert.co
        lp[uvl].uv = (c.x / (2 * r) + 0.5, (-c.y / (2 * r) + 0.5) * 0.92 + 0.08)
    for i in range(steps):
        f = bm.faces.new((bot[i], bot[(i + 1) % steps], top[(i + 1) % steps], top[i]))
        for lp in f.loops:
            lp[uvl].uv = (0.5, 0.03)
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.location = loc
    me.materials.append(mat)
    L.activate(o)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    except Exception:
        pass
    L.parent_keep(o, parent)
    return o


# ------------------------------------------------------------- marker faces ----

def enamel_face():
    w = h = 256
    arr = P.canvas((0.50, 0.51, 0.54), w, h, ss=3, mottle=0.03, seed=71)
    P.rect(arr, 0, 0, w, 20, (0.42, 0.43, 0.46))
    P.disc(arr, 128, 138, 100, 100, DGREEN)
    P.ring(arr, 128, 138, 104, 104, 8, (0.62, 0.63, 0.66))
    P.ring(arr, 128, 138, 74, 74, 5, (0.62, 0.63, 0.66))
    # tee icon
    P.rect(arr, 108, 88, 148, 100, (0.70, 0.71, 0.74))
    P.tri(arr, (108, 100), (148, 100), (128, 128), (0.70, 0.71, 0.74))
    P.rect(arr, 122, 118, 134, 176, (0.70, 0.71, 0.74))
    P.tri(arr, (122, 176), (134, 176), (128, 190), (0.70, 0.71, 0.74))
    return P.np_image("MarkerEnamel", arr)


def clip_face():
    import numpy as np
    w = h = 256
    arr = P.base_arr((0.42, 0.20, 0.10), w, h, mottle=0.05, seed=73)
    arr[0:20, :] = [0.34, 0.16, 0.08]
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    cell = 26.0
    ox = np.where(((yy // cell) % 2) > 0.5, cell / 2, 0.0)
    px_ = ((xx + ox) % cell) / cell - 0.5
    py_ = (yy % cell) / cell - 0.5
    d2 = px_ ** 2 + py_ ** 2
    dim = np.clip(1.0 - d2 * 8.0, 0, 1)
    arr *= (1.0 - dim * 0.28)[..., None]
    return P.np_image("MarkerClip", arr)


def engraved_face():
    w = h = 256
    arr = P.canvas((0.46, 0.47, 0.49), w, h, ss=3, mottle=0.04, seed=77)
    P.rect(arr, 0, 0, w, 20, (0.38, 0.39, 0.41))
    dark = (0.24, 0.25, 0.27)
    P.ring(arr, 128, 138, 100, 100, 6, dark)
    # laurel dashes
    for s in (-1, 1):
        for i in range(8):
            a = math.radians(24 + i * 17)
            P.disc(arr, 128 + s * math.sin(a) * 84, 138 + math.cos(a) * 84, 7, 4, dark)
    # flag scene
    P.disc(arr, 118, 168, 52, 16, dark)
    P.disc(arr, 150, 176, 40, 12, (0.33, 0.34, 0.36))
    P.rect(arr, 126, 84, 130, 168, dark)
    P.tri(arr, (130, 84), (130, 110), (162, 97), dark)
    P.disc(arr, 100, 120, 22, 10, (0.33, 0.34, 0.36))
    P.disc(arr, 160, 132, 18, 8, (0.33, 0.34, 0.36))
    return P.np_image("MarkerEngraved", arr)


# ----------------------------------------------------------------- builders ----

def build_coin(M):
    aid = "pf_marker_coin"
    r = 0.0155
    root = P.asset_root(aid, (r * 2, r * 2, 0.004), category="ball_markers")
    brass = P.m_flat("M_MarkerBrass", (0.46, 0.32, 0.11), rough=0.32, metal=0.9)
    L.cyl(f"{aid}_base", r, 0.0032, (0, 0, 0.0016), brass, parent=root, verts=28)
    L.cyl(f"{aid}_inner", r * 0.82, 0.0042, (0, 0, 0.0021), P.m_flat("M_MarkerBrassIn", (0.52, 0.37, 0.13), rough=0.26, metal=0.9), parent=root, verts=24)
    P.collision_box(f"COL_{aid}", (r * 2.2, r * 2.2, 0.006), (0, 0, 0.003), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.004))
    return root


def build_enamel(M):
    aid = "pf_marker_enamel"
    r = 0.016
    root = P.asset_root(aid, (r * 2, r * 2, 0.0045), category="ball_markers")
    m = P.m_tex("M_MarkerEnamel", enamel_face(), rough=0.28, metal=0.55)
    coin(f"{aid}_body", r, 0.0042, m, (0, 0, 0), root)
    P.collision_box(f"COL_{aid}", (r * 2.2, r * 2.2, 0.006), (0, 0, 0.003), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.004))
    return root


def build_clip(M):
    aid = "pf_marker_clip"
    r = 0.0165
    root = P.asset_root(aid, (r * 2, r * 2 + 0.014, 0.018), category="ball_markers")
    m = P.m_tex("M_MarkerClipTex", clip_face(), rough=0.35, metal=0.75)
    coin(f"{aid}_face", r, 0.0038, m, (0, 0, 0.0145), root)
    copper = P.m_flat("M_MarkerCopper", (0.36, 0.17, 0.09), rough=0.4, metal=0.85)
    # magnetic hat clip behind
    pts = P.smooth_wire([(0, 0.002, 0.013), (0, 0.011, 0.015), (0, 0.014, 0.008), (0, 0.012, 0.002), (0, 0.004, 0.0)], n=14)
    P.tube_path(f"{aid}_clip", pts, 0.0016, copper, parent=root)
    L.box(f"{aid}_clipplate", (0.012, 0.0018, 0.010), (0, 0.0035, 0.008), copper, bevel=0.0008, parent=root, uv=False)
    P.collision_box(f"COL_{aid}", (r * 2.2, r * 2 + 0.016, 0.021), (0, 0.002, 0.0105), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.016))
    return root


def build_engraved(M):
    aid = "pf_marker_engraved"
    r = 0.0175
    root = P.asset_root(aid, (r * 2, r * 2, 0.005), category="ball_markers")
    m = P.m_tex("M_MarkerEngraved", engraved_face(), rough=0.4, metal=0.6)
    coin(f"{aid}_body", r, 0.0035, m, (0, 0, 0.0012), root)
    pew = P.m_flat("M_MarkerPewter", (0.30, 0.31, 0.33), rough=0.42, metal=0.7)
    L.cyl(f"{aid}_rim", r, 0.0018, (0, 0, 0.001), pew, parent=root, verts=28)
    P.collision_box(f"COL_{aid}", (r * 2.2, r * 2.2, 0.006), (0, 0, 0.003), M, root)
    P.product_sockets(root, pickup=(0, 0, 0.004))
    return root


CARD = (0.075, 0.0022, 0.12)


def hangcard(aid, title, sub, band, M, marker_builder):
    W, T, H = CARD
    root = P.asset_root(aid, (W, 0.012, H), category="ball_markers")
    arr = B.hangcard_arr(512, 820, base=(0.80, 0.78, 0.70), band=band, title=title, subtitle=sub,
                         accent=(0.72, 0.62, 0.38), seed=79, sku="8 41200 5521")
    m = P.m_tex(f"M_{aid}_card", P.np_image(f"Card_{aid}", arr), rough=0.6)
    card = P.uv_box(f"{aid}_card", (W, T, H), (0, 0, H / 2), m, parent=root, bevel=0.0008,
                    face_uv={"-Y": (0, 0, 1, 1), "+Y": (0, 0, 1, 1)})
    cutter = L.box("slotcut", (0.024, 0.02, 0.0045), (0, 0, H * 0.938), M["collision"], bevel=0.0, uv=False)
    P.boolean_cut(card, cutter)
    sub_root = marker_builder(M)
    sub_root.name = f"{aid}_item"
    sub_root.location = (0, -T - 0.001, H * 0.44)
    sub_root.rotation_euler = (math.radians(90), 0, 0)
    L.parent_keep(sub_root, root)
    for o in list(sub_root.children):
        if o.name.startswith("COL_") or o.name in ("PICKUP_SOCKET", "SHELF_ANCHOR"):
            bpy.data.objects.remove(o, do_unlink=True)
    P.collision_box(f"COL_{aid}", (W, 0.014, H), (0, -0.004, H / 2), M, root)
    P.product_sockets(root, pickup=(0, 0, H * 0.5), hang=(0, 0, H * 0.94))
    return root


REG = {
    "pf_marker_coin": build_coin,
    "pf_marker_enamel": build_enamel,
    "pf_marker_clip": build_clip,
    "pf_marker_engraved": build_engraved,
    "pf_marker_coin_card": lambda M: hangcard("pf_marker_coin_card", "COIN MARKER", "SOLID BRASS", (0.10, 0.16, 0.10), M, build_coin),
    "pf_marker_enamel_card": lambda M: hangcard("pf_marker_enamel_card", "ENAMEL MARKER", "TOURNAMENT GREEN", (0.10, 0.16, 0.10), M, build_enamel),
    "pf_marker_clip_card": lambda M: hangcard("pf_marker_clip_card", "MAGNETIC MARKER", "HAT CLIP + COIN", (0.10, 0.16, 0.10), M, build_clip),
    "pf_marker_engraved_card": lambda M: hangcard("pf_marker_engraved_card", "ENGRAVED MARKER", "PREMIUM PEWTER", (0.10, 0.16, 0.10), M, build_engraved),
}

META = {a: {"name": n, "variant": v, "price": p, "fixture": "pf_fixture_accessory_slatwall",
            "slot_type": ("hook_card" if a.endswith("_card") else "loose"), "packaging": ("hang-card" if a.endswith("_card") else "loose")}
        for a, n, v, p in [
            ("pf_marker_coin", "Brass Coin Marker", "brass", 6.99),
            ("pf_marker_enamel", "Enamel Tee Marker", "green", 9.99),
            ("pf_marker_clip", "Magnetic Clip Marker", "copper", 12.99),
            ("pf_marker_engraved", "Engraved Premium Marker", "pewter", 14.99),
            ("pf_marker_coin_card", "Brass Coin Marker (Card)", "brass", 6.99),
            ("pf_marker_enamel_card", "Enamel Tee Marker (Card)", "green", 9.99),
            ("pf_marker_clip_card", "Magnetic Clip Marker (Card)", "copper", 12.99),
            ("pf_marker_engraved_card", "Engraved Premium Marker (Card)", "pewter", 14.99)]}

P.run_batch(REG, kind="products", category_of=lambda a: "ball_markers", manifest_extra=lambda a: META.get(a))
