"""Pinehollow pro-shop checkout counter (ref: eHVMAqF2).

The flagship fixture: a U-shaped walnut counter (open to the staff side, +Y) with
charcoal honed-granite tops on the customer perimeter, a lowered centre transaction
ledge, cream vertical-beadboard panels framed in deep green with gold pinstripes,
integrated rounded walnut corner pilasters with green collar bands, a brass foot
rail, and a staff work deck with cabinet banks (openable drawers) and a cup well.
"""
import sys
import math
sys.path.insert(0, "tools/blender")
import bpy
import bmesh
import lib_props as L


# ------------------------------------------------------------------ materials ----
def _tex(name, base_lin, *, mottle=0.08, seed=5, w=512, h=512):
    import numpy as np
    img = L._img(name, w, h)
    rng = np.random.default_rng(seed)
    base = np.array(base_lin, "float32")
    mott = (L._fbm(rng, w, h, 11, 11, 5) - 0.5) * (mottle * 2.0)
    micro = (rng.random((h, w)).astype("float32") - 0.5) * 0.04
    val = np.clip(1.0 + mott + micro, 0.7, 1.32)[..., None]
    lin = np.clip(base * val, 0, 1)
    L._write(img, np.concatenate([L.lin2srgb(lin), np.ones((h, w, 1), "float32")], axis=2))
    return img


def _granite_img(name="CtrGranite", w=512, h=512):
    """Honed charcoal granite: soft broad clouds + fine mineral speckle (linear)."""
    import numpy as np
    img = L._img(name, w, h)
    rng = np.random.default_rng(4)
    base = np.array([0.052, 0.055, 0.060], "float32")
    broad = (L._fbm(rng, w, h, 7, 7, 5) - 0.5) * 0.35
    fine = (rng.random((h, w)).astype("float32") - 0.5) * 0.10
    spq = rng.random((h, w)).astype("float32")
    speck = np.where(spq > 0.992, 1.8, 0.0) + np.where(spq < 0.006, -0.5, 0.0)
    val = np.clip(1.0 + broad + fine + speck, 0.45, 3.5)[..., None]
    lin = np.clip(base * val, 0, 1)
    L._write(img, np.concatenate([L.lin2srgb(lin), np.ones((h, w, 1), "float32")], axis=2))
    return img


def _beadboard_img(name="CtrBeadboard", w=512, h=512):
    """Cream vertical beadboard: plank stripes with a groove + bead highlight."""
    import numpy as np
    img = L._img(name, w, h)
    rng = np.random.default_rng(9)
    base = np.array([0.585, 0.545, 0.44], "float32")
    x = np.arange(w, dtype="float32")
    period = 64.0                                   # one plank
    t = (x % period) / period
    groove = np.exp(-((t - 0.94) ** 2) / 0.0009) * 0.38 + np.exp(-((t - 0.06) ** 2) / 0.0009) * 0.18
    bead = np.exp(-((t - 0.5) ** 2) / 0.02) * -0.05
    prof = (1.0 - groove + bead)[None, :, None]
    plank_var = np.repeat(rng.random((1, int(np.ceil(w / period)))), period, axis=1)[:, :w]
    var = (plank_var - 0.5)[..., None] * 0.05
    fine = (rng.random((h, w, 1)).astype("float32") - 0.5) * 0.03
    lin = np.clip(base[None, None, :] * (prof + var + fine), 0, 1)
    L._write(img, np.concatenate([L.lin2srgb(lin.astype("float32")), np.ones((h, w, 1), "float32")], axis=2))
    return img


def _satin(name, image, *, rough=0.36, coat=0.12, metal=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = image
    t.extension = "REPEAT"
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    for k, v in (("Coat Weight", coat), ("Coat Roughness", 0.22)):
        if k in b.inputs:
            b.inputs[k].default_value = v
    return m


def M2_local(M):
    return {
        "walnut": _satin("M_CtrWalnut", L.wood_image("CtrWalnut", "walnut"), rough=0.36, coat=0.14),
        "granite": _satin("M_CtrGranite", _granite_img(), rough=0.24, coat=0.20),
        "bead": _satin("M_CtrBead", _beadboard_img(), rough=0.5, coat=0.06),
        "green": L.mat("M_CtrGreen", (0.028, 0.062, 0.040), roughness=0.42),
        "gold": L.mat("M_CtrGold", (0.68, 0.52, 0.19), roughness=0.26, metallic=0.95),
        "brass": L.mat("M_CtrBrass", (0.60, 0.44, 0.16), roughness=0.28, metallic=0.92),
        "dark": L.mat("M_CtrDark", (0.030, 0.030, 0.033), roughness=0.6),
    }


# -------------------------------------------------------------------- helpers ----
def bead_panel(name, cx, cz, w, h, M2, root, *, y, face=-1, planks_m=0.085):
    """A framed beadboard panel on a Y-facing surface: green border + gold pinstripe
    + cream beadboard field with exact vertical-plank UV tiling."""
    # green frame
    L.box(f"{name}_frame", (w, 0.018, h), (cx, y, cz), M2["green"], bevel=0.004, parent=root)
    # gold pinstripe (thin raised border just inside the frame)
    gw, gh = w - 0.055, h - 0.055
    t = 0.004
    off = 0.011 * face
    for sz in (-1, 1):
        L.box(f"{name}_gpH{sz}", (gw, t, t), (cx, y + off, cz + sz * gh / 2), M2["gold"], bevel=0.0, parent=root)
        L.box(f"{name}_gpV{sz}", (t, t, gh), (cx + sz * gw / 2, y + off, cz), M2["gold"], bevel=0.0, parent=root)
    # beadboard field with explicit UVs (u repeats per plank)
    fw, fh = w - 0.09, h - 0.09
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in ((-fw / 2, 0, -fh / 2), (fw / 2, 0, -fh / 2), (fw / 2, 0, fh / 2), (-fw / 2, 0, fh / 2))]
    f = bm.faces.new(v)
    f.normal_update()
    if (f.normal.y > 0) != (face > 0):
        bmesh.ops.reverse_faces(bm, faces=[f])
    uvl = bm.loops.layers.uv.new("UVMap")
    reps = max(1.0, fw / planks_m)
    for loop in f.loops:
        c = loop.vert.co
        loop[uvl].uv = ((c.x / fw + 0.5) * reps, c.z / fh + 0.5)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.location = (cx, y + 0.013 * face, cz)
    me.materials.append(M2["bead"])
    L.parent_keep(o, root)


def pilaster(name, x, y, z0, z1, M2, root, *, r=0.085):
    """An integrated rounded walnut corner pilaster with green collar bands."""
    L.rounded_box(name, (2 * r, 2 * r, z1 - z0), (x, y, (z0 + z1) / 2), M2["walnut"], corner=r * 0.98, segments=8, bevel=0.004, uv=True, parent=root)
    for bz in (z0 + 0.13, z1 - 0.14):
        L.rounded_box(f"{name}_band{bz:.2f}", (2 * r + 0.012, 2 * r + 0.012, 0.045), (x, y, bz), M2["green"], corner=r + 0.005, segments=8, bevel=0.003, uv=False, parent=root)


def drawer(tag, cx, cz, w, h, front_y, depth, M2, root, travel=0.32):
    """A staff-side openable drawer (slides toward +Y); knob joined so it travels too."""
    fy = front_y + 0.004
    parts = [
        L.box(f"Dw{tag}F", (w, 0.018, h), (cx, fy, cz), M2["walnut"], bevel=0.004),
        L.box(f"Dw{tag}B", (w - 0.024, 0.012, h - 0.016), (cx, fy - 0.012 - depth, cz), M2["dark"], bevel=0.002),
        L.box(f"Dw{tag}Bot", (w - 0.02, depth, 0.008), (cx, fy - 0.012 - depth / 2, cz - h / 2 + 0.01), M2["dark"], bevel=0.002),
        L.cyl(f"Dw{tag}Knob", 0.011, 0.026, (cx, fy + 0.016, cz), M2["brass"], rot=(math.radians(90), 0, 0), verts=14),
    ]
    for ex in (-1, 1):
        parts.append(L.box(f"Dw{tag}S{ex}", (0.010, depth, h - 0.016), (cx + ex * (w / 2 - 0.007), fy - 0.012 - depth / 2, cz), M2["dark"], bevel=0.002))
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    d = parts[0]
    d.name = f"Drawer_{tag}"
    d["movable"] = "drawer"
    d["slide_axis"] = "+Y"
    d["open_travel_m"] = travel
    L.parent_keep(d, root)
    return d


def build(M):
    M2 = M2_local(M)
    W, D = 3.0, 1.5
    root = L.asset_root("checkout_counter", (W, D, 1.06))
    front_y = -D / 2                      # customer face
    wing_top, ledge_top, deck_top = 1.02, 0.92, 0.74
    gt = 0.045                            # granite thickness
    fr_d = 0.62                           # front run depth
    fr_cy = front_y + fr_d / 2            # front run centre y
    ret_w = 0.60                          # side return width
    notch_w = 1.15                        # transaction notch width

    # ---- plinth (rounded walnut base) ----
    L.rounded_box("Plinth", (W - 0.02, D - 0.02, 0.055), (0, 0, 0.0275), M2["walnut"], corner=0.10, bevel=0.005, uv=True, parent=root)
    L.rounded_box("PlinthShadow", (W - 0.06, D - 0.06, 0.012), (0, 0, 0.061), M2["green"], corner=0.09, bevel=0.002, uv=False, parent=root)
    L.box("WellFloor", (W - 2 * 0.60 - 0.05, D - 0.62 - 0.04, 0.014), (0, ( -1.5 + 0.62 + 1.5 ) / 2 + 0.0, 0.075), M2["walnut"], bevel=0.003, parent=root)

    # ---- bodies (walnut) ----
    # front run: two wings + lowered notch section
    wing_w = (W - notch_w) / 2
    for ex in (-1, 1):
        L.box(f"WingBody_{ex}", (wing_w, fr_d, wing_top - 0.05), (ex * (notch_w / 2 + wing_w / 2), fr_cy, 0.05 + (wing_top - 0.05) / 2), M2["walnut"], bevel=0.006, parent=root)
    L.box("NotchBody", (notch_w, fr_d, ledge_top - 0.05), (0, fr_cy, 0.05 + (ledge_top - 0.05) / 2), M2["walnut"], bevel=0.006, parent=root)
    # rounded step cheeks easing the notch into the wings
    for ex in (-1, 1):
        L.rounded_box(f"StepCheek_{ex}", (0.16, fr_d - 0.02, wing_top - ledge_top), (ex * (notch_w / 2 + 0.02), fr_cy, ledge_top + (wing_top - ledge_top) / 2 - 0.02), M2["walnut"], corner=0.075, segments=7, bevel=0.005, uv=True, parent=root)
    # side returns (customer height), open to staff side
    ret_cy = front_y + fr_d + (D - fr_d) / 2
    ret_d = D - fr_d
    for ex in (-1, 1):
        L.box(f"ReturnBody_{ex}", (ret_w, ret_d, wing_top - 0.05), (ex * (W / 2 - ret_w / 2), ret_cy, 0.05 + (wing_top - 0.05) / 2), M2["walnut"], bevel=0.006, parent=root)

    # ---- granite tops (rounded, slight overhang) ----
    for ex in (-1, 1):
        L.rounded_box(f"GraniteWing_{ex}", (wing_w + 0.05, fr_d + 0.05, gt), (ex * (notch_w / 2 + wing_w / 2), fr_cy, wing_top + gt / 2), M2["granite"], corner=0.06, bevel=0.0, uv=True, parent=root)
        L.rounded_box(f"GraniteReturn_{ex}", (ret_w + 0.05, ret_d + 0.03, gt), (ex * (W / 2 - ret_w / 2), ret_cy, wing_top + gt / 2), M2["granite"], corner=0.06, bevel=0.0, uv=True, parent=root)
    L.rounded_box("GraniteLedge", (notch_w + 0.03, fr_d + 0.04, gt), (0, fr_cy, ledge_top + gt / 2), M2["granite"], corner=0.05, bevel=0.0, uv=True, parent=root)
    # green trim line under each granite edge (customer side)
    for ex in (-1, 1):
        L.box(f"TrimWing_{ex}", (wing_w - 0.02, 0.016, 0.035), (ex * (notch_w / 2 + wing_w / 2), front_y - 0.004, wing_top - 0.03), M2["green"], bevel=0.003, parent=root)
    L.box("TrimLedge", (notch_w - 0.02, 0.016, 0.035), (0, front_y - 0.004, ledge_top - 0.03), M2["green"], bevel=0.003, parent=root)

    # ---- corner pilasters with green bands (proud of both faces like the reference) ----
    for ex in (-1, 1):
        pilaster(f"PilasterFront_{ex}", ex * (W / 2 - 0.052), front_y + 0.052, 0.03, wing_top, M2, root)
        pilaster(f"PilasterBack_{ex}", ex * (W / 2 - 0.052), D / 2 - 0.052, 0.03, wing_top, M2, root)

    # ---- beadboard panels: customer front + return outer faces ----
    panel_h = 0.62
    panel_z = 0.42
    for ex in (-1, 1):
        bead_panel(f"PanelWing_{ex}", ex * (notch_w / 2 + wing_w / 2), panel_z, wing_w - 0.28, panel_h, M2, root, y=front_y - 0.002, face=-1)
    bead_panel("PanelNotch", 0, panel_z - 0.04, notch_w - 0.18, panel_h - 0.10, M2, root, y=front_y - 0.002, face=-1)
    for ex in (-1, 1):
        o_y = ret_cy
        # outer side faces (±X): build with a rotated group — use a thin proxy wall then panel via rotation
        L.box(f"SideFrame_{ex}", (0.018, ret_d - 0.28, panel_h), (ex * (W / 2 + 0.002), o_y, panel_z), M2["green"], bevel=0.004, parent=root)
        L.box(f"SideBead_{ex}", (0.012, ret_d - 0.36, panel_h - 0.09), (ex * (W / 2 + 0.006), o_y, panel_z), M2["bead"], bevel=0.002, parent=root)
        for sz in (-1, 1):
            L.box(f"SideGoldH_{ex}{sz}", (0.004, ret_d - 0.33, 0.004), (ex * (W / 2 + 0.010), o_y, panel_z + sz * (panel_h - 0.055) / 2), M2["gold"], bevel=0.0, parent=root)

    # ---- brass foot rail (front + wrap to returns) ----
    rail_z = 0.145
    L.cyl("FootRail", 0.015, W - 0.36, (0, front_y - 0.052, rail_z), M2["brass"], rot=(0, math.radians(90), 0), verts=18, parent=root)
    for ex in (-1, 1):
        L.sphere(f"RailEnd_{ex}", 0.017, (ex * (W / 2 - 0.18), front_y - 0.052, rail_z), M2["brass"], parent=root, segs=12)
    for bx in (-1.05, -0.35, 0.35, 1.05):
        L.box(f"RailPost_{bx:.2f}", (0.022, 0.05, 0.03), (bx, front_y - 0.028, rail_z), M2["brass"], bevel=0.004, parent=root)
        L.cyl(f"RailFoot_{bx:.2f}", 0.006, 0.09, (bx, front_y - 0.05, rail_z - 0.055), M2["brass"], verts=10, parent=root)

    # ---- staff side: work deck + cabinet banks + cup well ----
    deck_d = 0.55
    deck_cy = front_y + fr_d + deck_d / 2 - 0.02
    L.rounded_box("DeckGranite", (W - 2 * ret_w - 0.06, deck_d, 0.035), (0, deck_cy, deck_top + 0.0175), M2["granite"], corner=0.03, bevel=0.0, uv=True, parent=root)
    L.box("DeckUpstand", (W - 2 * ret_w - 0.06, 0.025, 0.07), (0, front_y + fr_d + 0.01, deck_top + 0.05), M2["walnut"], bevel=0.004, parent=root)
    # two cabinet banks under the deck, knee gap in the middle
    bank_w = 0.62
    for ex in (-1, 1):
        bx = ex * (bank_w / 2 + 0.33)
        L.box(f"CabBank_{ex}", (bank_w, deck_d - 0.06, deck_top - 0.05), (bx, deck_cy, 0.05 + (deck_top - 0.05) / 2), M2["walnut"], bevel=0.005, parent=root)
        cab_face_y = deck_cy + (deck_d - 0.06) / 2
        drawer(f"{'L' if ex < 0 else 'R'}", bx, deck_top - 0.115, bank_w - 0.10, 0.115, cab_face_y, 0.36, M2, root)
        L.cabinet_door(f"CabDoorA_{ex}", bx - (bank_w / 4 - 0.006), (deck_top - 0.20) / 2 + 0.05, bank_w / 2 - 0.06, deck_top - 0.30, M2, root, y=cab_face_y + 0.012, pull="knob")
        L.cabinet_door(f"CabDoorB_{ex}", bx + (bank_w / 4 - 0.006), (deck_top - 0.20) / 2 + 0.05, bank_w / 2 - 0.06, deck_top - 0.30, M2, root, y=cab_face_y + 0.012, pull="knob")
    # cup/trash well on the left wing granite
    L.torus("CupRing", 0.062, 0.012, (-1.02, fr_cy - 0.05, wing_top + gt), M2["brass"], rot=(0, 0, 0), parent=root, mj=22, mn=10)
    L.cyl("CupHole", 0.056, 0.012, (-1.02, fr_cy - 0.05, wing_top + gt - 0.002), M2["dark"], verts=22, parent=root)

    # ---- collision (transparent proxies) ----
    L.collision_box("COL_Front", (W, fr_d + 0.06, wing_top + gt), (0, fr_cy, (wing_top + gt) / 2), M, parent=root)
    for ex in (-1, 1):
        L.collision_box(f"COL_Return_{ex}", (ret_w + 0.04, ret_d, wing_top + gt), (ex * (W / 2 - ret_w / 2), ret_cy, (wing_top + gt) / 2), M, parent=root)
    L.collision_box("COL_Deck", (W - 2 * ret_w - 0.04, deck_d, deck_top + 0.04), (0, deck_cy, (deck_top + 0.04) / 2), M, parent=root)
    return root


L.run("checkout_counter", build)
