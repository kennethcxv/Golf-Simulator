"""Build the Golf Flipper checkout asset kit (reference: Asset Sheet 01).

All branding is original and fictional (FAIRHOLLOW GOLF CLUB / LINKSPAY /
UNITS currency) — no real-world brands, currency or card networks.

Run from the repository root:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
        --background --factory-startup \
        --python tools/blender/build_checkout_kit.py -- [asset ...]

With no arguments every asset is built.  Outputs land in assets/checkout/
(source/, glb/, textures/, previews/).  The live game assets under
vendor/models/clubhouse are NOT touched by this build.
"""

from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_props as L
import checkout_kit_lib as K


# ================================================================ counter ======

def _slat_wall(name, width, height, mat, *, seed, parent, thick=0.016, slat_w=0.050, gap=0.011):
    """A run of vertical oak boards (one bmesh).  Local frame: boards span X,
    height Z from 0, outer face toward -Y.  Every board samples its own narrow
    u-slice of the vertical-grain oak sheet, with tiny depth jitter so the wall
    catches light like real timber, not like a printed panel."""
    rng = random.Random(seed)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    pitch = slat_w + gap
    count = max(1, int((width + gap) // pitch))
    x0 = -(count * pitch - gap) / 2
    for i in range(count):
        xa = x0 + i * pitch
        xb = xa + slat_w
        jy = rng.uniform(-0.0012, 0.0012)
        u0 = rng.uniform(0.02, 0.90)
        v0 = rng.uniform(0.0, 0.25)
        corners = {}
        for (kx, x) in (("a", xa), ("b", xb)):
            for (ky, y) in (("f", -thick / 2 + jy), ("r", thick / 2 + jy)):
                for (kz, z) in (("0", 0.0), ("1", height)):
                    corners[kx + ky + kz] = bm.verts.new((x, y, z))
        du = 0.075
        dv = 0.70
        faces = (
            (("af0", "bf0", "bf1", "af1"), lambda x, z: (u0 + (x - xa) / slat_w * du, v0 + z / height * dv)),   # front
            (("br0", "ar0", "ar1", "br1"), lambda x, z: (u0 + (xb - x) / slat_w * du, v0 + z / height * dv)),   # back
            (("bf0", "br0", "br1", "bf1"), lambda x, z: (u0 + du, v0 + z / height * dv)),                        # right edge
            (("ar0", "af0", "af1", "ar1"), lambda x, z: (u0, v0 + z / height * dv)),                             # left edge
            (("af1", "bf1", "br1", "ar1"), lambda x, z: (u0 + (x - xa) / slat_w * du, v0 + dv)),                 # top
            (("ar0", "br0", "bf0", "af0"), lambda x, z: (u0 + (x - xa) / slat_w * du, v0)),                      # bottom
        )
        for keys, uvf in faces:
            f = bm.faces.new(tuple(corners[k] for k in keys))
            for loop in f.loops:
                co = loop.vert.co
                loop[uvl].uv = uvf(co.x, co.z)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    me.materials.append(mat)
    if parent is not None:
        L.parent_keep(o, parent)
    return o


def build_checkout_counter(M):
    """Sheet 01 counter: black countertop, light-oak vertical slat front and
    ends, warm LED accent under the top edge, recessed dark plinth.  The
    authored envelope (2.60 x 0.85, top at 0.95) and every placement mount are
    LOCKED — fixtures.js non-uniform-scales this onto the shop plan."""
    W, D, TOP = 2.60, 0.85, 0.95
    TT = 0.042
    root = K.asset_root("checkout_counter", (W, D, TOP + TT / 2))
    staff_y = -D / 2
    cust_y = D / 2

    # --- countertop: deep-black slab with a soft rounded edge, overhanging ---
    L.rounded_box("Countertop", (W, D, TT), (0, 0, TOP - TT / 2), M["counter_black"], corner=0.03, bevel=0.008, uv=True, parent=root)

    # --- body (inset from the customer face so the top overhangs the slats;
    # the slats stop 14 mm short of the slab, leaving a shadow reveal that the
    # LED strip lives in) ---
    body_z0, body_z1 = 0.055, TOP - TT - 0.014
    bh = body_z1 - body_z0
    # right register cabinet (closed, staff side)
    L.box("CabinetRight", (0.95, D - 0.10, bh), (0.795, -0.01, body_z0 + bh / 2), M["charcoal"], bevel=0.006, parent=root)
    # customer-side backing panel behind the slats + solid end panels
    L.box("PanelCustomer", (W - 0.05, 0.045, bh), (0, cust_y - 0.062, body_z0 + bh / 2), M["charcoal"], bevel=0.004, parent=root)
    L.box("PanelEndLeft", (0.045, D - 0.10, bh), (-W / 2 + 0.0425, -0.01, body_z0 + bh / 2), M["charcoal"], bevel=0.004, parent=root)
    L.box("PanelEndRight", (0.045, D - 0.10, bh), (W / 2 - 0.0425, -0.01, body_z0 + bh / 2), M["charcoal"], bevel=0.004, parent=root)

    # --- the light-oak slat skin: full customer face + both ends ---
    slats_f = _slat_wall("SlatsFront", W - 0.02, bh, M["oak_slat"], seed=61, parent=root)
    slats_f.location = (0, cust_y - 0.030, body_z0)
    for (sx, seed, flip, tag) in ((-W / 2 + 0.012, 71, -1, "L"), (W / 2 - 0.012, 79, 1, "R")):
        end = _slat_wall(f"SlatsEnd_{tag}", D - 0.12, bh, M["oak_slat"], seed=seed, parent=root)
        end.location = (sx, -0.02, body_z0)
        end.rotation_euler = (0, 0, math.radians(90 * flip))

    # --- warm LED accent living in the shadow reveal between slats and slab ---
    L.box("LED_Front", (W - 0.10, 0.008, 0.009), (0, cust_y - 0.030, TOP - TT - 0.007), M["led_warm"], bevel=0.0, parent=root)
    L.box("LED_EndL", (0.008, D - 0.16, 0.009), (-W / 2 + 0.014, -0.02, TOP - TT - 0.007), M["led_warm"], bevel=0.0, parent=root)
    L.box("LED_EndR", (0.008, D - 0.16, 0.009), (W / 2 - 0.014, -0.02, TOP - TT - 0.007), M["led_warm"], bevel=0.0, parent=root)

    # --- open staff shelf (kept: the register side reads busy and real) ---
    ix0, ix1 = -1.23, 0.32
    iw = ix1 - ix0
    icx = (ix0 + ix1) / 2
    L.box("ShelfBack", (iw, 0.024, bh), (icx, cust_y - 0.11, body_z0 + bh / 2), M["cream_lit"], bevel=0.0, parent=root)
    L.box("ShelfTopLine", (iw, D - 0.22, 0.024), (icx, -0.07, body_z1 - 0.012), M["cream_lit"], bevel=0.0, parent=root)
    L.box("ShelfFloor", (iw, D - 0.22, 0.024), (icx, -0.07, body_z0 + 0.012), M["cream_lit"], bevel=0.0, parent=root)
    L.box("ShelfMid", (iw, D - 0.24, 0.03), (icx, -0.08, 0.52), M["cream_lit"], bevel=0.004, parent=root)
    for sx in (ix0, ix1):
        L.box(f"ShelfSide_{sx:.2f}", (0.024, D - 0.22, bh), (sx, -0.07, body_z0 + bh / 2), M["cream_lit"], bevel=0.0, parent=root)
    L.box("ShelfLipTop", (iw + 0.05, 0.014, 0.02), (icx, staff_y + 0.007, body_z1 - 0.01), M["alu"], bevel=0.002, parent=root)
    L.box("ShelfLipMid", (iw + 0.05, 0.014, 0.02), (icx, staff_y + 0.007, 0.535), M["alu"], bevel=0.002, parent=root)

    # --- recessed dark plinth ---
    L.box("Plinth", (W - 0.14, D - 0.14, 0.058), (0, 0, 0.029), M["counter_black"], bevel=0.003, parent=root)

    # --- placement empties (locators) ---
    K.empty("POS_MOUNT", (0.86, 0.16, TOP), (0, 0, 0), parent=root, props={"mount": "pos_monitor"})
    K.empty("CASH_DRAWER_MOUNT", (0.86, 0.035, 0.72), (0, 0, 0), parent=root, props={"mount": "cash_drawer", "note": "origin = back-centre-bottom of drawer housing"})
    K.empty("CARD_TERMINAL_MOUNT", (0.38, -0.30, TOP), (0, 0, 0), parent=root, props={"mount": "payment_terminal"})
    K.empty("BARCODE_SCANNER_MOUNT", (0.44, 0.14, TOP), (0, 0, 0), parent=root, props={"mount": "barcode_scanner"})
    K.empty("RECEIPT_PRINTER_MOUNT", (1.13, 0.20, TOP), (0, 0, 0), parent=root, props={"mount": "receipt_printer"})
    K.empty("CUSTOMER_DISPLAY_MOUNT", (1.14, 0.33, TOP), (0, 0, math.pi), parent=root, props={"mount": "customer_display"})
    K.empty("BAG_PLACEMENT", (-1.02, -0.08, TOP), parent=root, props={"mount": "shopping_bag"})
    K.empty("UNSCANNED_ITEM_AREA", (0.02, 0.06, TOP), parent=root, props={"area": "unscanned", "extent_m": [0.62, 0.5]})
    K.empty("SCANNED_ITEM_AREA", (-0.62, 0.0, TOP), parent=root, props={"area": "scanned", "extent_m": [0.6, 0.55]})

    K.collision_box("COL_CheckoutCounter", (W, D, TOP), (0, 0, TOP / 2), M, root)
    return root


# ============================================================ pos monitor ======

def build_pos_monitor(M):
    """Sheet 01 POS: a slim 16:10 touchscreen on a curved matte-black pedestal
    with a cable channel down its back and a weighted base.  The POS_Screen
    quad's local centre, size family and the head's place/tilt are LOCKED —
    the game hangs its 0.34 x 0.2125 live canvas on that node."""
    root = K.asset_root("pos_monitor", (0.40, 0.30, 0.44))

    # weighted base: black slab, soft racetrack corners, rubber underline
    base = L.rounded_box("POS_Base", (0.26, 0.21, 0.020), (0, 0.02, 0.012), M["counter_black"], corner=0.05, bevel=0.005, uv=True)
    L.parent_keep(base, root)
    L.rounded_box("POS_BasePad", (0.23, 0.18, 0.006), (0, 0.02, 0.003), M["rubber"], corner=0.045, bevel=0.001, uv=False, parent=root)
    # curved pedestal: leaning column, slightly waisted, with a cable groove
    stand = L.rounded_box("POS_Stand", (0.105, 0.050, 0.225), (0, 0.062, 0.125), M["charcoal"], corner=0.024, bevel=0.006, uv=True, rot=(math.radians(-13), 0, 0))
    L.parent_keep(stand, root)
    L.box("POS_CableChannel", (0.020, 0.010, 0.20), (0, 0.0885, 0.118), M["black"], bevel=0.002, rot=(math.radians(-13), 0, 0), parent=root)
    L.cyl("POS_CableGrommet", 0.011, 0.012, (0, 0.085, 0.026), M["rubber"], rot=(math.radians(20), 0, 0), verts=14, parent=root)

    # display head: assemble children at LOCAL coords with the body at identity,
    # then move/tilt the body so every child follows (parent_keep semantics).
    body = K.empty("POS_Body", (0, 0, 0), (0, 0, 0), parent=root, props={"component": "display_head"})
    ow, oh = 0.352, 0.2225                    # glass opening (16:10, fits the live canvas)
    fw = fh = 0.011                           # slim uniform bezel
    chin = 0.020                              # branded chin under the glass
    bw = ow + 2 * fw
    bd = 0.030
    L.box("POS_BezelTop", (bw, bd, fh), (0, 0, oh / 2 + fh / 2), M["charcoal"], bevel=0.004, parent=body)
    L.box("POS_BezelBottom", (bw, bd, fh), (0, 0, -oh / 2 - fh / 2), M["charcoal"], bevel=0.004, parent=body)
    L.box("POS_BezelLeft", (fw, bd, oh), (-ow / 2 - fw / 2, 0, 0), M["charcoal"], bevel=0.004, parent=body)
    L.box("POS_BezelRight", (fw, bd, oh), (ow / 2 + fw / 2, 0, 0), M["charcoal"], bevel=0.004, parent=body)
    L.box("POS_Bezel", (bw - 0.006, 0.014, oh + 2 * fh - 0.006), (0, 0.014, 0), M["charcoal"], bevel=0.003, parent=body)  # backing plate
    L.box("POS_Chin", (bw, bd + 0.002, chin), (0, 0, -oh / 2 - fh - chin / 2), M["charcoal"], bevel=0.004, parent=body)
    L.cyl("POS_HomeDot", 0.0035, 0.0022, (0, -bd / 2 - 0.0002, -oh / 2 - fh - chin / 2), M["brass"], rot=(math.radians(90), 0, 0), verts=12, parent=body)
    # slim rear shell with vent slots
    L.rounded_box("POS_Rear", (0.30, 0.026, 0.20), (0, 0.030, -0.005), M["plastic_mid"], corner=0.03, bevel=0.006, uv=True, parent=body)
    for i in range(3):
        L.box(f"pos_vent{i}", (0.11, 0.004, 0.0045), (0, 0.0445, 0.045 - i * 0.018), M["black"], bevel=0.0, parent=body)
    # recessed glass: separate mesh, clean rectangular UVs; the live canvas
    # parents onto this node and floats 2 mm proud of it
    scr = K.uv_plane("POS_Screen", ow - 0.004, oh - 0.004, (0, -0.010, 0.0), M["glass_black"], parent=body)
    scr["dynamic_screen"] = True
    scr["screen_px"] = [1024, 640]
    # place + tilt the assembled head (LOCKED: cameras frame this pose)
    body.location = (0, 0.045, 0.295)
    body.rotation_euler = (math.radians(-10), 0, 0)

    K.collision_box("COL_POSMonitor", (0.42, 0.26, 0.45), (0, 0.03, 0.225), M, root)
    return root


# ============================================================ cash drawer ======

def _join(parts, name, origin=(0, 0, 0)):
    """Join loose meshes into one object with its origin at `origin`."""
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = parts[0]
    o.name = name
    bpy.context.scene.cursor.location = origin
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    return o


def build_cash_drawer(M):
    """Origin: back-centre-bottom of the stationary housing.  Opens toward -Y."""
    HW, HD, HH = 0.42, 0.46, 0.13                  # housing outer dims
    root = K.asset_root("cash_drawer", (HW, HD, HH))

    # --- stationary housing (joined) ---
    t = 0.016
    hp = [
        L.box("h_bottom", (HW, HD, t), (0, -HD / 2, t / 2), M["charcoal"], bevel=0.004),
        L.box("h_top", (HW, HD, t), (0, -HD / 2, HH - t / 2), M["charcoal"], bevel=0.004),
        L.box("h_left", (t, HD, HH - 2 * t), (-HW / 2 + t / 2, -HD / 2, HH / 2), M["charcoal"], bevel=0.004),
        L.box("h_right", (t, HD, HH - 2 * t), (HW / 2 - t / 2, -HD / 2, HH / 2), M["charcoal"], bevel=0.004),
        L.box("h_back", (HW - 2 * t, t, HH - 2 * t), (0, -t / 2, HH / 2), M["charcoal"], bevel=0.003),
        # slide rails
        L.box("h_railL", (0.008, HD - 0.05, 0.012), (-HW / 2 + t + 0.006, -HD / 2, 0.035), M["alu"], bevel=0.002),
        L.box("h_railR", (0.008, HD - 0.05, 0.012), (HW / 2 - t - 0.006, -HD / 2, 0.035), M["alu"], bevel=0.002),
    ]
    housing = _join(hp, "CashDrawer_Housing")
    L.parent_keep(housing, root)

    # --- sliding tray (front face + floor + walls), origin at back-bottom-centre ---
    TW, TD = HW - 2 * t - 0.006, HD - t - 0.008    # tray outer dims
    tp = [
        L.box("t_floor", (TW, TD, 0.012), (0, -t - TD / 2, t + 0.008), M["plastic_mid"], bevel=0.002),
        L.box("t_left", (0.012, TD, 0.07), (-TW / 2 + 0.006, -t - TD / 2, t + 0.045), M["plastic_mid"], bevel=0.002),
        L.box("t_right", (0.012, TD, 0.07), (TW / 2 - 0.006, -t - TD / 2, t + 0.045), M["plastic_mid"], bevel=0.002),
        L.box("t_back", (TW - 0.02, 0.012, 0.07), (0, -t - 0.006, t + 0.045), M["plastic_mid"], bevel=0.002),
        # front face proud of the housing + brushed pull lip
        L.box("t_face", (HW + 0.012, 0.026, HH + 0.012), (0, -HD - 0.013, HH / 2), M["charcoal"], bevel=0.006),
        L.box("t_pull", (0.20, 0.020, 0.022), (0, -HD - 0.034, HH - 0.028), M["alu"], bevel=0.005),
    ]
    tray = _join(tp, "CashDrawer_Tray")
    tray["movable"] = "drawer"
    tray["slide_axis"] = "-Y"
    tray["open_travel_m"] = 0.36
    L.parent_keep(tray, root)

    # lock cylinder on the face, with the key left in it (reference detail)
    lock = L.cyl("CashDrawer_Lock", 0.016, 0.012, (0, -HD - 0.030, HH / 2 - 0.014), M["alu"], rot=(math.radians(90), 0, 0), verts=20)
    L.box("lock_key", (0.004, 0.012, 0.018), (0, -HD - 0.035, HH / 2 - 0.014), M["black"], bevel=0.0, parent=lock)
    L.cyl("lock_keyshaft", 0.0028, 0.014, (0, -HD - 0.044, HH / 2 - 0.014), M["alu"], rot=(math.radians(90), 0, 0), verts=10, parent=lock)
    key_bow = L.cyl("lock_keybow", 0.0085, 0.0025, (0, -HD - 0.052, HH / 2 - 0.020), M["black"], rot=(math.radians(90), 0, 0), verts=14, parent=lock)
    L.cyl("lock_keyhole", 0.0028, 0.0028, (0, -HD - 0.052, HH / 2 - 0.024), M["alu"], rot=(math.radians(90), 0, 0), verts=8, parent=key_bow)
    L.parent_keep(lock, tray)

    # --- removable light-gray insert: 5 bill wells (back) + 5 coin cups (front) ---
    IW, ID = TW - 0.03, TD - 0.05
    ix0 = -IW / 2
    iy_back = -t - 0.02                            # insert back edge
    bill_d, coin_d = 0.20, 0.15
    wall = 0.006
    iz = t + 0.014                                 # insert floor top
    ip = [L.box("i_floor", (IW, ID, 0.008), (0, iy_back - ID / 2, iz), M["tray_gray"], bevel=0.002)]
    # perimeter walls
    ip.append(L.box("i_back", (IW, wall, 0.055), (0, iy_back - wall / 2, iz + 0.030), M["tray_gray"], bevel=0.001))
    ip.append(L.box("i_front", (IW, wall, 0.045), (0, iy_back - ID + wall / 2, iz + 0.025), M["tray_gray"], bevel=0.001))
    ip.append(L.box("i_left", (wall, ID, 0.055), (ix0 + wall / 2, iy_back - ID / 2, iz + 0.030), M["tray_gray"], bevel=0.001))
    ip.append(L.box("i_right", (wall, ID, 0.055), (-ix0 - wall / 2, iy_back - ID / 2, iz + 0.030), M["tray_gray"], bevel=0.001))
    # bill/coin separator
    ip.append(L.box("i_mid", (IW, wall, 0.05), (0, iy_back - bill_d, iz + 0.027), M["tray_gray"], bevel=0.001))
    pitch = IW / 5
    for i in range(1, 5):
        x = ix0 + i * pitch
        ip.append(L.box(f"i_bdiv{i}", (wall, bill_d, 0.05), (x, iy_back - bill_d / 2, iz + 0.027), M["tray_gray"], bevel=0.001))
        ip.append(L.box(f"i_cdiv{i}", (wall, coin_d, 0.04), (x, iy_back - bill_d - coin_d / 2, iz + 0.022), M["tray_gray"], bevel=0.001))
    # angled bill weights (clip detail, one per well)
    for i in range(5):
        x = ix0 + pitch / 2 + i * pitch
        ip.append(L.box(f"i_clip{i}", (pitch - 0.03, 0.05, 0.004), (x, iy_back - 0.06, iz + 0.038), M["alu"], rot=(math.radians(-14), 0, 0), bevel=0.001))
    insert = _join(ip, "CashDrawer_Insert")
    L.parent_keep(insert, tray)

    # --- money placement sockets (children of the tray so they slide with it) ---
    bills = ["1", "5", "10", "20", "50"]
    coins = ["01", "05", "10", "25", "50"]
    for i, b in enumerate(bills):
        x = ix0 + pitch / 2 + i * pitch
        K.empty(f"BILL_{b}_SOCKET", (x, iy_back - bill_d / 2, iz + 0.020), (0, 0, 0), parent=tray, size=0.03,
                props={"socket": "bill", "denomination": b})
    for i, c in enumerate(coins):
        x = ix0 + pitch / 2 + i * pitch
        K.empty(f"COIN_{c}_SOCKET", (x, iy_back - bill_d - coin_d / 2, iz + 0.016), (0, 0, 0), parent=tray, size=0.02,
                props={"socket": "coin", "denomination": c})

    # --- animations: CashDrawer_Open / CashDrawer_Close on the tray ---
    open_frames = int(0.6 * K.FPS)                 # 0.6 s
    K.key_loc(tray, 1, (0, 0, 0))
    K.key_loc(tray, 1 + open_frames, (0, -0.36, 0))
    K.finish_clip(tray, "CashDrawer_Open")
    K.key_loc(tray, 1, (0, -0.36, 0))
    K.key_loc(tray, 1 + open_frames, (0, 0, 0))
    K.finish_clip(tray, "CashDrawer_Close")
    tray.location = (0, 0, 0)

    K.collision_box("COL_CashDrawer", (HW + 0.02, HD + 0.03, HH + 0.02), (0, -HD / 2 - 0.014, HH / 2), M, root)
    return root


# ======================================================== payment terminal =====

def _label(text, size, depth, loc, mat, parent, rot=(0, 0, 0), name=None):
    bpy.ops.object.text_add(location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name or f"lbl_{text}"
    o.data.body = text
    o.data.align_x = "CENTER"
    o.data.align_y = "CENTER"
    o.data.size = size
    o.data.extrude = 0               # flat print — glyph sides never read at 7 mm
    o.data.resolution_u = 2          # keycap glyphs, not print typography
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    # curve conversion leaves dense triangle fans; dissolve the coplanar faces
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.dissolve_limited(angle_limit=math.radians(4))
    bpy.ops.object.mode_set(mode="OBJECT")
    o.data.materials.clear()
    o.data.materials.append(mat)
    o.rotation_euler = rot
    o.location = loc
    if parent is not None:
        L.parent_keep(o, parent)
    return o


def build_payment_terminal(M):
    """Handheld card terminal reclined on a wedge.  Origin: bottom-centre of body.
    Keypad follows the real POS-pad convention: 3x3 digits, then a colour row
    [X red][0][O green] aligned to the same three columns (nothing overhangs the
    shell), and a wide yellow correction bar beneath — zero sits square under
    the 8 where a thumb expects it."""
    BW, BD, BH = 0.088, 0.034, 0.196
    root = K.asset_root("payment_terminal", (BW, 0.10, BH))

    # assemble upright with the body empty at identity, tilt afterwards
    body = K.empty("Terminal_Body", (0, 0, 0), parent=root, props={"component": "terminal_body"})
    L.rounded_box("Terminal_Shell", (BW, BD, BH), (0, 0, BH / 2), M["charcoal"], corner=0.016, bevel=0.005, uv=True, parent=body)
    # glossy visor band around the screen zone + alu hairline + recessed glass
    scr_w, scr_h = 0.070, 0.064
    scr_z = BH - 0.048
    L.rounded_box("t_visor", (scr_w + 0.012, 0.0022, scr_h + 0.016), (0, -BD / 2 - 0.0002, scr_z), M["glass_black"], corner=0.005, segments=3, bevel=0.0008, uv=True, parent=body)
    L.box("t_screenline", (scr_w + 0.006, 0.0026, scr_h + 0.006), (0, -BD / 2 - 0.0004, scr_z), M["alu"], bevel=0.0006, parent=body)
    L.box("Terminal_ScreenRecess", (scr_w + 0.004, 0.006, scr_h + 0.004), (0, -BD / 2 + 0.001, scr_z), M["black"], bevel=0.001, parent=body)
    scr = K.uv_plane("Terminal_Screen", scr_w, scr_h, (0, -BD / 2 - 0.0035, scr_z), M["glass_black"], parent=body)
    scr["dynamic_screen"] = True
    scr["screen_px"] = [480, 440]
    # speaker dots + embossed brand under the glass
    for i in range(4):
        L.cyl(f"t_spk{i}", 0.0012, 0.002, (-0.012 + i * 0.008, -BD / 2 - 0.001, BH - 0.010), M["black"], rot=(math.radians(90), 0, 0), verts=8, parent=body)
    _label("FAIRHOLLOW", 0.0046, 0.0005, (0, -BD / 2 - 0.0006, scr_z - scr_h / 2 - 0.0105), M["sage"], body,
           rot=(math.radians(90), 0, 0), name="t_brand")

    # keypad: 3x3 digits, colour row on the same columns, wide correction bar,
    # all seated in a recessed black deck like a production pad
    keypad = K.empty("Terminal_Keypad", (0, 0, 0), parent=body, props={"component": "keypad"})
    key_w, key_h, key_d = 0.0225, 0.0125, 0.0045
    pitch_x, pitch_z = 0.0265, 0.0155
    z0 = scr_z - scr_h / 2 - 0.024
    deck_h = 4 * pitch_z + key_h + 0.012
    deck_c = (z0 + (z0 - 4 * pitch_z)) / 2
    L.rounded_box("t_deck", (0.080, 0.003, deck_h), (0, -BD / 2 + 0.0002, deck_c), M["black"], corner=0.006, segments=3, bevel=0.001, uv=True, parent=body)
    digit_mat = K.m_flat("M_KeyText", (0.88, 0.88, 0.90), rough=0.4)

    def key(name, mat_, glyph, cx, cz, w=key_w, h=key_h, glyph_px=0.0072):
        k = L.rounded_box(name, (w, key_d, h), (cx, -BD / 2 - key_d / 2 + 0.001, cz), mat_, corner=0.0035, segments=3, bevel=0.0018, uv=True, parent=keypad)
        k["key"] = glyph
        _label(glyph, glyph_px, 0.0006, (cx, -BD / 2 - key_d - 0.0002, cz - 0.0008), digit_mat, keypad,
               rot=(math.radians(90), 0, 0), name=f"t_glyph_{name.removeprefix('Terminal_')}")
        return k

    for n in range(1, 10):
        cx = (-1 + (n - 1) % 3) * pitch_x
        cz = z0 - ((n - 1) // 3) * pitch_z
        key(f"Terminal_Key_{n}", M["key_dark"], str(n), cx, cz)
    zb = z0 - 3 * pitch_z
    key("Terminal_CancelButton", M["btn_red"], "X", -pitch_x, zb)
    key("Terminal_Key_0", M["key_dark"], "0", 0, zb)
    key("Terminal_ConfirmButton", M["btn_green"], "O", pitch_x, zb)
    key("Terminal_BackButton", M["btn_yellow"], "-", 0, zb - pitch_z, w=key_w + 2 * pitch_x, h=0.0105, glyph_px=0.0075)

    # chip slot at the bottom front + card socket (card 85.6 x 54 mm enters short-edge first)
    slot = L.box("Terminal_ChipSlot", (0.062, 0.020, 0.010), (0, -BD / 2 + 0.002, 0.011), M["black"], bevel=0.002, parent=body)
    L.box("t_slotgap", (0.058, 0.016, 0.0028), (0, -BD / 2 - 0.004, 0.008), M["black"], bevel=0.0, parent=body)
    L.box("t_slotlip", (0.066, 0.0045, 0.0022), (0, -BD / 2 - 0.0035, 0.0145), M["alu"], bevel=0.0008, parent=body)
    L.cyl("t_slotled", 0.0016, 0.002, (0.036, -BD / 2 - 0.0008, 0.011), M["led_green"], rot=(math.radians(90), 0, 0), verts=10, parent=body)
    K.empty("CARD_INSERT_SOCKET", (0, -BD / 2 + 0.004, 0.007), (math.radians(-14), 0, 0), parent=body, size=0.03,
            props={"socket": "payment_card", "insert_axis": "-Z", "note": "card slides up along local +Z, chip end leading, face toward -Y"})

    # recline the body and add the rear support wedge
    tilt = math.radians(-34)
    body.rotation_euler = (tilt, 0, 0)
    body.location = (0, 0.0, 0.0)
    L.box("Terminal_Stand", (0.056, 0.054, 0.035), (0, 0.056, 0.0175), M["plastic_mid"], bevel=0.006, rot=(math.radians(24), 0, 0), parent=root)

    K.collision_box("COL_Terminal", (0.10, 0.14, 0.175), (0, 0.022, 0.0875), M, root)
    return root


# ========================================================= barcode scanner =====

def build_barcode_scanner(M):
    root = K.asset_root("barcode_scanner", (0.12, 0.15, 0.24))

    b = L.rounded_box("Scanner_Base", (0.115, 0.135, 0.034), (0, 0.01, 0.017), M["charcoal"], corner=0.028, bevel=0.006, uv=True)
    L.parent_keep(b, root)
    # two-segment angled stand with a pivot knuckle
    st = K.empty("Scanner_Stand", (0, 0, 0), parent=root, props={"component": "stand"})
    L.box("s_lower", (0.040, 0.045, 0.075), (0, 0.022, 0.065), M["charcoal"], bevel=0.008, rot=(math.radians(12), 0, 0), parent=st)
    L.cyl("s_knuckle", 0.024, 0.052, (0, 0.012, 0.105), M["plastic_mid"], rot=(0, math.radians(90), 0), verts=20, parent=st)
    L.box("s_upper", (0.038, 0.042, 0.075), (0, -0.004, 0.14), M["charcoal"], bevel=0.008, rot=(math.radians(-10), 0, 0), parent=st)

    # head assembled at identity then tilted forward-down
    head = K.empty("Scanner_Head", (0, 0, 0), parent=root, props={"component": "head"})
    L.rounded_box("s_headshell", (0.102, 0.080, 0.118), (0, 0.012, 0), M["charcoal"], corner=0.024, bevel=0.008, uv=True, parent=head)
    L.rounded_box("s_headfront", (0.092, 0.02, 0.104), (0, -0.032, 0), M["black"], corner=0.02, bevel=0.004, uv=True, parent=head)
    win = K.uv_plane("Scanner_Window", 0.074, 0.086, (0, -0.0435, 0), M["scan_red"], parent=head)
    win["dynamic_emissive"] = True
    L.box("Scanner_LED", (0.052, 0.003, 0.006), (0, -0.0432, 0.038), M["led_red"], bevel=0.0, parent=head)
    L.cyl("s_sidebtn", 0.012, 0.006, (0.052, 0.012, 0.02), M["plastic_mid"], rot=(0, math.radians(90), 0), verts=16, parent=head)
    K.empty("SCAN_RAY_ORIGIN", (0, -0.040, 0), (math.radians(-90), 0, 0), parent=head, size=0.04,
            props={"emit_axis": "+Z(local) => outward -Y after head tilt", "note": "ray origin inside the red window"})
    head.location = (0, -0.01, 0.185)
    head.rotation_euler = (math.radians(14), 0, 0)

    K.collision_box("COL_Scanner", (0.12, 0.15, 0.245), (0, 0.005, 0.1225), M, root)
    return root


# ========================================================= receipt printer =====

def _curved_strip(name, w, length, mat, *, segments=12, curl=0.18, parent=None):
    """A vertical paper strip, slightly curled toward -Y at the top, UV 0..1."""
    bm = bmesh.new()
    layer_verts = []
    for i in range(segments + 1):
        t = i / segments
        z = t * length
        y = -curl * length * (t ** 2) * 0.35
        v0 = bm.verts.new((-w / 2, y, z))
        v1 = bm.verts.new((w / 2, y, z))
        layer_verts.append((v0, v1))
    uvl = bm.loops.layers.uv.new("UVMap")
    for i in range(segments):
        (a0, a1), (b0, b1) = layer_verts[i], layer_verts[i + 1]
        f = bm.faces.new((a0, a1, b1, b0))
        t0, t1 = i / segments, (i + 1) / segments
        uvs = [(0, t0), (1, t0), (1, t1), (0, t1)]
        for loop, uv in zip(f.loops, uvs):
            loop[uvl].uv = uv
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    me.materials.append(mat)
    if parent is not None:
        L.parent_keep(o, parent)
    return o


def build_receipt_printer(M):
    root = K.asset_root("receipt_printer", (0.15, 0.19, 0.13))
    paper_mat = K.m_tex("M_ReceiptPaper", K.receipt_img(), rough=0.8, ds=True)

    body = L.rounded_box("Printer_Body", (0.145, 0.185, 0.092), (0, 0.006, 0.046), M["charcoal"], corner=0.02, bevel=0.006, uv=True)
    L.parent_keep(body, root)
    # rounded paper-roll cover over the rear half
    cover = L.cyl("Printer_Cover", 0.052, 0.132, (0, 0.038, 0.086), M["plastic_mid"], rot=(0, math.radians(90), 0), verts=28)
    L.parent_keep(cover, root)
    L.box("p_coverseam", (0.135, 0.003, 0.02), (0, -0.028, 0.095), M["black"], bevel=0.0, parent=root)
    # output slot on the front slope + serrated tear lip
    L.box("Printer_OutputSlot", (0.096, 0.010, 0.014), (0, -0.045, 0.098), M["black"], bevel=0.002, parent=root)
    L.box("p_tearlip", (0.096, 0.006, 0.016), (0, -0.0625, 0.097), M["alu"], bevel=0.001, parent=root)
    # front control panel: status LEDs + feed button on a black deck
    L.box("p_panel", (0.085, 0.004, 0.032), (0, -0.0845, 0.051), M["black"], bevel=0.003, parent=root)
    L.cyl("Printer_LED", 0.004, 0.004, (-0.028, -0.0875, 0.056), M["led_green"], rot=(math.radians(90), 0, 0), verts=10, parent=root)
    L.cyl("p_led_paper", 0.003, 0.004, (-0.028, -0.0875, 0.044), M["btn_yellow"], rot=(math.radians(90), 0, 0), verts=10, parent=root)
    L.cyl("Printer_Button", 0.011, 0.006, (0.024, -0.0875, 0.050), M["plastic_mid"], rot=(math.radians(90), 0, 0), verts=16, parent=root)
    # side vents + rear cable boss
    for s in (-1, 1):
        for i in range(3):
            L.box(f"p_vent{'L' if s < 0 else 'R'}{i}", (0.0035, 0.052, 0.005), (s * 0.0715, 0.030, 0.028 + i * 0.014), M["black"], bevel=0.0, parent=root)
    L.cyl("p_cableboss", 0.0075, 0.014, (0.042, 0.096, 0.032), M["rubber"], rot=(math.radians(90), 0, 0), verts=12, parent=root)

    # receipt paper: starts mostly hidden in the slot, feeds upward
    paper = _curved_strip("Receipt_Paper", 0.068, 0.105, paper_mat, curl=0.22)
    paper["dynamic_screen"] = True
    paper.location = (0, -0.0545, 0.004)
    L.parent_keep(paper, root)
    frames = int(1.2 * K.FPS)
    K.key_loc(paper, 1, (0, -0.0545, 0.004))
    K.key_loc(paper, 1 + frames, (0, -0.0545, 0.085))
    K.finish_clip(paper, "Receipt_Print")
    paper.location = (0, -0.0545, 0.004)

    K.collision_box("COL_Printer", (0.15, 0.19, 0.14), (0, 0.005, 0.07), M, root)
    return root


# ============================================================ shopping bag =====

def _rope_arc(name, cx, y, z_top, radius, mat, parent, *, segs=9, tilt=0.0):
    """A rope handle: semicircular arc of small cylinders + sphere joints."""
    pts = []
    for i in range(segs + 1):
        a = math.pi * i / segs
        pts.append(Vector((cx - radius * math.cos(a), y, z_top + radius * math.sin(a) * 0.75)))
    grp = K.empty(name, (0, 0, 0), parent=parent)
    for i in range(segs):
        a, b = pts[i], pts[i + 1]
        mid = (a + b) / 2
        d = b - a
        L.cyl(f"{name}_s{i}", 0.0035, d.length * 1.15, mid, mat, rot=d.to_track_quat("Z", "Y").to_euler(), verts=6, bevel=0, parent=grp)
    for i in (0, segs):
        L.sphere(f"{name}_e{i}", 0.0042, pts[i], mat, parent=grp, segs=6)
    if tilt:
        grp.rotation_euler = (tilt, 0, 0)
    return grp


def build_shopping_bag(M):
    BW, BD, BH = 0.40, 0.185, 0.345               # kraft grocery-boutique bag
    root = K.asset_root("shopping_bag", (BW, BD, BH))
    taper = 0.012                                  # top slightly wider than base
    rim_rng = random.Random(41)                    # a used bag, not an extruded box

    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    # ring profiles bottom->top with a mid crease on the gusset (short) sides
    rings = []
    for (z, s, gusset_in) in ((0.0, 0.0, 0.0), (0.005, 0.0, 0.0), (BH * 0.55, taper * 0.5, 0.016), (BH, taper, 0.0)):
        w2, d2 = BW / 2 + s, BD / 2 + s * 0.6
        ring = [
            (-w2, -d2), (0, -d2 - 0.004), (w2, -d2),            # front edge (slight bow)
            (w2, -d2 + 0.001), (w2, 0), (w2, d2),               # right gusset w/ crease vert
            (w2 - 0.001, d2), (0, d2 + 0.004), (-w2, d2),       # back
            (-w2, d2 - 0.001), (-w2, 0), (-w2, -d2 + 0.001),    # left gusset
        ]
        ring = [(x if abs(x) < w2 - 0.0005 else x, y) for (x, y) in ring]
        verts = []
        for (x, y) in ring:
            gx = x
            if abs(y) < 0.001 and abs(abs(x) - w2) < 0.002:      # gusset centre crease pulls inward
                gx = x - math.copysign(gusset_in, x)
            # the open rim sags and flares a couple of millimetres — paper, not card
            zz = z + (rim_rng.uniform(-0.0045, 0.0060) if z >= BH - 1e-6 else 0.0)
            verts.append(bm.verts.new((gx, y, zz)))
        rings.append(verts)
    n = len(rings[0])
    for r in range(len(rings) - 1):
        for i in range(n):
            a, b = rings[r][i], rings[r][(i + 1) % n]
            c, d = rings[r + 1][(i + 1) % n], rings[r + 1][i]
            f = bm.faces.new((a, b, c, d))
            for loop in f.loops:
                co = loop.vert.co
                u = (math.atan2(co.y, co.x) / (2 * math.pi)) % 1.0
                loop[uvl].uv = (u * 4.0, co.z / BH * 2.0)
    bottom = bm.faces.new(tuple(reversed(rings[0])))
    for loop in bottom.loops:
        loop[uvl].uv = (loop.vert.co.x * 2, loop.vert.co.y * 2)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("Bag_Body")
    bm.to_mesh(me)
    bm.free()
    body = bpy.data.objects.new("Bag_Body", me)
    bpy.context.collection.objects.link(body)
    me.materials.append(M["olive"])
    L.activate(body)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    except Exception:
        pass
    body.rotation_euler = (0, 0, math.radians(1.5))            # subtle natural asymmetry
    L.parent_keep(body, root)
    # folded top hem + bottom seam
    L.box("bag_hem_f", (BW + 0.02, 0.006, 0.018), (0, -BD / 2 - taper * 0.6, BH - 0.009), M["olive"], bevel=0.001, parent=root)
    L.box("bag_hem_b", (BW + 0.02, 0.006, 0.018), (0, BD / 2 + taper * 0.6, BH - 0.009), M["olive"], bevel=0.001, parent=root)
    L.box("bag_seam", (BW - 0.03, BD - 0.02, 0.004), (0, 0, 0.006), M["olive"], bevel=0.001, parent=root)

    # shadowed interior: a darker olive liner hugging the tapered walls, so the
    # open top reads as a real cavity instead of the sheet's backfaces
    tilt_y = math.atan2(taper, BH)
    tilt_x = math.atan2(taper * 0.6, BH)
    L.box("bag_liner_f", (BW - 0.034, 0.0035, BH - 0.05), (0, -(BD / 2 + taper * 0.3) + 0.003, BH / 2 + 0.006), M["olive_dark"], bevel=0.0, rot=(-tilt_x, 0, 0), parent=root)
    L.box("bag_liner_b", (BW - 0.034, 0.0035, BH - 0.05), (0, (BD / 2 + taper * 0.3) - 0.003, BH / 2 + 0.006), M["olive_dark"], bevel=0.0, rot=(tilt_x, 0, 0), parent=root)
    # the gusset sides crease 16 mm inward at mid-height — keep the side liners
    # vertical and behind the crease so they never pierce the sheet
    L.box("bag_liner_l", (0.0035, BD - 0.030, BH - 0.05), (-(BW / 2 - 0.015), 0, BH / 2 + 0.006), M["olive_dark"], bevel=0.0, parent=root)
    L.box("bag_liner_r", (0.0035, BD - 0.030, BH - 0.05), ((BW / 2 - 0.015), 0, BH / 2 + 0.006), M["olive_dark"], bevel=0.0, parent=root)
    L.box("bag_liner_floor", (BW - 0.036, BD - 0.032, 0.005), (0, 0, 0.0145), M["olive_dark"], bevel=0.0, parent=root)

    _rope_arc("Bag_Handle_Left", 0, -BD / 2 - 0.002, BH - 0.01, 0.085, M["rope"], root)
    _rope_arc("Bag_Handle_Right", 0, BD / 2 + 0.002, BH - 0.01, 0.085, M["rope"], root, tilt=math.radians(-3))
    # punched grommets where the rope enters the sheet
    for gx in (-0.085, 0.085):
        for (gy, rr) in ((-BD / 2 - 0.004, 0), (BD / 2 + 0.004, 0)):
            L.cyl(f"bag_grommet_{gx:+.2f}_{gy:+.2f}", 0.0068, 0.004, (gx, gy, BH - 0.012), M["olive_dark"],
                  rot=(math.radians(90), 0, 0), verts=8, bevel=0, parent=root)

    # THE FAIRHOLLOW PRINT: gold crest-and-quote panel on the staff-facing
    # front (authored -Y → in-game +z at rotation zero), just proud of the
    # sheet like a screen print. Original club branding only.
    art_mat = K.m_tex("M_BagArtwork", K.bag_art_img(), rough=0.74, ds=True)
    K.uv_plane("Bag_Artwork", 0.30, 0.30,
               (0, -BD / 2 - taper * 0.6 - 0.0025, BH * 0.50), art_mat, parent=root)

    for i, (sx, sy) in enumerate(((-0.09, -0.03), (0.09, -0.03), (-0.09, 0.045), (0.09, 0.045))):
        K.empty(f"BAG_ITEM_SOCKET_0{i + 1}", (sx, sy, 0.02), parent=root, size=0.03, props={"socket": "bag_item", "slot": i + 1})
    K.empty("BAG_PICKUP_SOCKET", (0, 0, BH + 0.055), parent=root, size=0.04, props={"socket": "bag_pickup"})

    K.collision_box("COL_Bag", (BW + 0.03, BD + 0.03, BH), (0, 0, BH / 2), M, root)
    return root


# ============================================================ payment card =====

def _rounded_card_mesh(name, w, hgt, r, thick, mat, *, front_v=(0.5, 1.0), back_v=(0.0, 0.5)):
    """A rounded-rect card lying in XY (thickness +Z), top face UV->front region,
    bottom face UV->back region, edges pinched to a texture corner."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    pts = []
    corners = [(w / 2 - r, hgt / 2 - r, 0), (-w / 2 + r, hgt / 2 - r, math.pi / 2),
               (-w / 2 + r, -hgt / 2 + r, math.pi), (w / 2 - r, -hgt / 2 + r, 3 * math.pi / 2)]
    for cx, cy, a0 in corners:
        for i in range(7):
            a = a0 + (math.pi / 2) * i / 6
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    verts = [bm.verts.new((x, y, 0)) for (x, y) in pts]
    face = bm.faces.new(verts)
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    ext_verts = [e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=ext_verts, vec=(0, 0, thick))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            u = co.x / w + 0.5
            if f.normal.z > 0.5:
                v0, v1 = front_v
                loop[uvl].uv = (u, v0 + (co.y / hgt + 0.5) * (v1 - v0))
            elif f.normal.z < -0.5:
                v0, v1 = back_v
                loop[uvl].uv = (1 - u, v0 + (co.y / hgt + 0.5) * (v1 - v0))
            else:
                loop[uvl].uv = (0.01, 0.51)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    me.materials.append(mat)
    return o


def build_payment_card(M):
    """Origin: card centre.  Card lies in XY, face up (+Z), chip end toward -Y? No:
    chip sits near -X end of the face; insert direction documented on the socket."""
    CW, CH, CT = 0.0856, 0.054, 0.0009
    root = K.asset_root("payment_card", (CW, CH, CT))
    card_mat = K.m_tex("M_PaymentCard", K.card_img(), rough=0.42)
    body = _rounded_card_mesh("Card_Body", CW, CH, 0.0035, CT, card_mat)
    L.parent_keep(body, root)
    chip = L.rounded_box("Card_Chip", (0.0115, 0.0092, 0.0005), (-0.0303, 0.0102, CT + 0.00025), K.m_flat("M_CardChip", (0.62, 0.48, 0.18), rough=0.32, metal=0.9), corner=0.0015, bevel=0.0, uv=True)
    L.parent_keep(chip, root)
    contact = K.m_flat("M_ChipLine", (0.34, 0.25, 0.09), rough=0.4, metal=0.8)
    for i, oy in enumerate((-0.0019, 0.0019)):
        L.box(f"chip_line{i}", (0.0115, 0.0006, 0.00012), (-0.0303, 0.0102 + oy, CT + 0.00056), contact, bevel=0.0, parent=chip)
    L.box("chip_line_v", (0.0006, 0.0092, 0.00012), (-0.0303, 0.0102, CT + 0.00056), contact, bevel=0.0, parent=chip)
    root["orientation"] = "face up +Z; chip near -X edge; insert short edge (-X) first into terminal slot"
    return root


# ======================================================= cash denominations ====

BILL_TINTS = {
    # saturated, glance-distinct note colours (fictional UNITS currency, not a
    # reproduction of any real note). Values are LINEAR floats — mid-greys turn
    # pastel after the sRGB transfer, so saturation lives well below 0.5 on the
    # muted channels.  1 sage, 5 violet, 10 amber, 20 fairway green, 50 rose
    1: (0.30, 0.42, 0.14), 5: (0.27, 0.15, 0.42), 10: (0.58, 0.24, 0.05),
    20: (0.09, 0.32, 0.11), 50: (0.48, 0.10, 0.13),
}
COIN_SPECS = {                                     # code: (label, radius, thickness)
    "01": ("1", 0.00953, 0.00152),
    "05": ("5", 0.01060, 0.00195),
    "10": ("10", 0.00895, 0.00135),
    "25": ("25", 0.01213, 0.00175),
    "50": ("50", 0.01530, 0.00215),
}


def make_bill_builder(denom):
    def build(M):
        root = K.asset_root(f"cash_bill_{denom}", (0.156, 0.066, 0.0008))
        mat = K.m_tex(f"M_Bill{denom}", K.bill_img(denom, BILL_TINTS[denom]), rough=0.62)
        # edge faces sample the pale paper strip painted across the texture's
        # centre seam — note edges read as paper, never as border ink
        edge = (0.005, 0.495, 0.035, 0.505)
        face_uv = {"+Z": (0, 0.5, 1, 1), "-Z": (0, 0.0, 1, 0.5),
                   "-Y": edge, "+Y": edge, "-X": edge, "+X": edge}
        b = K.uv_box("Bill_Body", (0.156, 0.066, 0.0008), (0, 0, 0), mat, face_uv=face_uv)
        L.parent_keep(b, root)
        root["denomination_units"] = denom
        return root
    return build


def make_coin_builder(code):
    def build(M):
        label, radius, thick = COIN_SPECS[code]
        root = K.asset_root(f"cash_coin_{code}", (radius * 2, radius * 2, thick))
        img = K.coin_img(code, label)
        mat = K.m_tex(f"M_Coin{code}", img, rough=0.34, metal=0.9)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=26, radius1=radius, radius2=radius, depth=thick)
        uvl = bm.loops.layers.uv.new("UVMap")
        for f in bm.faces:
            if abs(f.normal.z) > 0.5:
                # obverse maps to the texture's top half, reverse (mirrored u)
                # to the bottom half
                for loop in f.loops:
                    co = loop.vert.co
                    u = co.x / (radius * 2) + 0.5
                    vv = co.y / (radius * 2) + 0.5
                    if f.normal.z > 0:
                        loop[uvl].uv = (u, 0.517 + vv * 0.462)
                    else:
                        loop[uvl].uv = (1 - u, 0.021 + vv * 0.462)
            else:
                # side faces wrap the reeded band at the centre seam; unwrap the
                # angle per-face so the 0/1 wrap never smears across one quad
                angs = [(math.atan2(l.vert.co.y, l.vert.co.x) / (2 * math.pi)) % 1.0 for l in f.loops]
                if max(angs) - min(angs) > 0.5:
                    angs = [a + 1.0 if a < 0.5 else a for a in angs]
                for loop, a in zip(f.loops, angs):
                    loop[uvl].uv = (a * 8.0, 0.5 + (0.006 if loop.vert.co.z > 0 else -0.006))
        me = bpy.data.meshes.new("Coin_Body")
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new("Coin_Body", me)
        bpy.context.collection.objects.link(o)
        me.materials.append(mat)
        L.activate(o)
        md = o.modifiers.new("bev", "BEVEL")
        md.width = thick * 0.18
        md.segments = 1
        bpy.ops.object.modifier_apply(modifier=md.name)
        try:
            bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
        except Exception:
            pass
        L.parent_keep(o, root)
        root["denomination_cents"] = int(code)
        return root
    return build


# ======================================================= scannable product =====

def build_scannable_product_box(M):
    BW, BD, BH = 0.112, 0.112, 0.138
    root = K.asset_root("scannable_product_box", (BW, BD, BH))
    atlas = K.m_tex("M_ProductBox", K.product_box_img(), rough=0.72)
    face_uv = {
        "-Y": (0.0, 0.5, 0.5, 1.0),      # front art
        "+X": (0.5, 0.5, 1.0, 1.0),      # side w/ printed barcode
        "-X": (0.5, 0.5, 1.0, 1.0),
        "+Y": (0.5, 0.0, 1.0, 0.5),      # back info panel
        "+Z": (0.0, 0.0, 0.5, 0.5),      # top flaps
        "-Z": (0.0, 0.0, 0.5, 0.5),      # bottom flaps
    }
    box = K.uv_box("ProductBox_Body", (BW, BD, BH), (0, 0, BH / 2), atlas, face_uv=face_uv, bevel=0.0025)
    L.parent_keep(box, root)
    # top flap seam groove
    L.box("box_seam", (0.0025, BD - 0.01, 0.0018), (0, 0, BH + 0.0002), K.m_flat("M_BoxSeam", (0.16, 0.10, 0.05), rough=0.8), bevel=0.0, parent=root)
    # dedicated barcode plane (slightly proud on -X side) for easy scanner alignment
    bc = K.uv_plane("PRODUCT_BARCODE", 0.052, 0.028, (0, 0, 0), K.m_tex("M_BoxBarcode", K.barcode_img("BoxBarcode"), rough=0.6))
    bc.rotation_euler = (0, 0, math.radians(90))
    bc.location = (-BW / 2 - 0.0006, 0, 0.032)
    L.parent_keep(bc, root)
    K.empty("PRODUCT_GRAB_SOCKET", (0, 0, BH * 0.55), parent=root, size=0.04, props={"socket": "grab"})
    K.collision_box("COL_ProductBox", (BW, BD, BH), (0, 0, BH / 2), M, root)
    return root


# ============================================================ helper assets ====

def build_customer_display(M):
    root = K.asset_root("customer_display", (0.22, 0.16, 0.35))
    L.rounded_box("CustDisp_Base", (0.16, 0.13, 0.02), (0, 0, 0.01), M["charcoal"], corner=0.03, bevel=0.005, uv=True, parent=root)
    L.cyl("CustDisp_Pole", 0.011, 0.20, (0, 0.01, 0.12), M["black"], verts=14, parent=root)
    head = K.empty("CustDisp_Head", (0, 0, 0), parent=root, props={"component": "display_head"})
    L.rounded_box("CustDisp_Frame", (0.21, 0.022, 0.135), (0, 0, 0), M["charcoal"], corner=0.012, bevel=0.004, uv=True, parent=head)
    scr = K.uv_plane("CustomerDisplay_Screen", 0.185, 0.11, (0, -0.0115, 0), M["screen_off"], parent=head)
    scr["dynamic_screen"] = True
    scr["screen_px"] = [512, 300]
    head.location = (0, 0.01, 0.285)
    head.rotation_euler = (math.radians(8), 0, math.pi)        # faces +Y (customer side)
    K.collision_box("COL_CustomerDisplay", (0.22, 0.14, 0.36), (0, 0, 0.18), M, root)
    return root


def build_loose_receipt(M):
    root = K.asset_root("loose_receipt", (0.07, 0.15, 0.02))
    paper_mat = K.m_tex("M_ReceiptPaper", K.receipt_img(), rough=0.8, ds=True)
    strip = _curved_strip("Receipt_Strip", 0.068, 0.15, paper_mat, segments=14, curl=0.5)
    strip.rotation_euler = (math.radians(-86), 0, 0)           # lying nearly flat, slight curl up
    strip.location = (0, 0.075, 0.001)
    L.parent_keep(strip, root)
    return root


def build_cash_handoff_stack(M):
    """A pure attachment rig: parent + ordered sockets for bill/coin instances."""
    root = K.asset_root("cash_handoff_stack", (0.16, 0.07, 0.03))
    root["usage"] = "parent bill GLBs to STACK_BILL_SOCKET_0n (fanned), coins to STACK_COIN_SOCKET_0n"
    for i in range(5):
        K.empty(f"STACK_BILL_SOCKET_0{i + 1}", (0, i * 0.004, 0.0012 * i),
                (0, 0, math.radians(-6 + i * 3)), parent=root, size=0.03,
                props={"socket": "bill", "order": i + 1})
    for i in range(4):
        K.empty(f"STACK_COIN_SOCKET_0{i + 1}", (-0.03 + i * 0.02, -0.045, 0.002),
                parent=root, size=0.02, props={"socket": "coin", "order": i + 1})
    K.empty("CASH_ATTACH", (0, 0, 0), parent=root, size=0.05, props={"socket": "hand_attach"})
    return root


# =============================================================== runner ========

BUILDERS = {
    "checkout_counter": build_checkout_counter,
    "pos_monitor": build_pos_monitor,
    "cash_drawer": build_cash_drawer,
    "payment_terminal": build_payment_terminal,
    "barcode_scanner": build_barcode_scanner,
    "receipt_printer": build_receipt_printer,
    "shopping_bag": build_shopping_bag,
    "payment_card": build_payment_card,
    **{f"cash_bill_{d}": make_bill_builder(d) for d in (1, 5, 10, 20, 50)},
    **{f"cash_coin_{c}": make_coin_builder(c) for c in ("01", "05", "10", "25", "50")},
    "scannable_product_box": build_scannable_product_box,
    "customer_display": build_customer_display,
    "loose_receipt": build_loose_receipt,
    "cash_handoff_stack": build_cash_handoff_stack,
}


def requested():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        return list(BUILDERS)
    for a in argv:
        if a not in BUILDERS:
            raise SystemExit(f"unknown asset '{a}'; choices: {', '.join(BUILDERS)}")
    return argv


# extra camera angles: (suffix, azimuth, elevation) — the default preview looks
# at the staff (-Y) side; these capture the faces the default angle hides
EXTRA_PREVIEWS = {
    "checkout_counter": [("checkout_counter_front", 208, 14)],
    "shopping_bag": [("shopping_bag_top", 33, 55)],
    "payment_terminal": [("payment_terminal_front", 356, 22)],
}


def main():
    for asset_id in requested():
        K.reset_scene()
        M = K.kit_materials()
        root = BUILDERS[asset_id](M)
        K.save_and_export(asset_id, root)
        K.render_preview(asset_id, root)
        for (name, az, el) in EXTRA_PREVIEWS.get(asset_id, []):
            K.render_preview(asset_id, root, azimuth=az, elevation=el, name=name)
    print("COMPLETE")


if __name__ == "__main__":
    main()
