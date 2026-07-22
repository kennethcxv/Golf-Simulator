"""Pinehollow pro-shop merchandising hutch (ref: LHubgmUV).

One unified walnut hutch (continuous side panels): a lower cabinet with, per column, a
bank of three openable taupe drawers beside open cream shelves, a walnut counter, an
upper cream-slatwall display holding nine angled walnut shelves (each with a black
label holder), and a green "PRO SHOP" chalkboard in a walnut frame with brass corner
brackets, under a crown molding.  Molded plinth with brass corners.
"""
import sys
import math
sys.path.insert(0, "tools/blender")
import bpy
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


def _satin_wood(name, image, *, roughness=0.36, coat=0.13, tint=None):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    b.inputs["Roughness"].default_value = roughness
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.extension = "REPEAT"
    if tint:
        mix = nt.nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        mix.inputs[2].default_value = (*tint, 1.0)
        nt.links.new(tex.outputs["Color"], mix.inputs[1])
        nt.links.new(mix.outputs["Color"], b.inputs["Base Color"])
    else:
        nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    for k, v in (("Coat Weight", coat), ("Coat Roughness", 0.24)):
        if k in b.inputs:
            b.inputs[k].default_value = v
    return m


def M2_local(M):
    return {
        "walnut": _satin_wood("M_MhWalnut", L.wood_image("MhWalnut", "walnut"), tint=(1.34, 1.18, 0.96)),
        "cream": L.mat_tex("M_MhCream", _tex("MhCream", (0.66, 0.61, 0.50), seed=4), roughness=0.58),
        "taupe": L.mat_tex("M_MhTaupe", _tex("MhTaupe", (0.150, 0.113, 0.076), mottle=0.08, seed=6), roughness=0.55),
        "slat": M["slat"],
        "chalk": L.mat("M_MhChalk", (0.040, 0.072, 0.055), roughness=0.82),
        "chalktext": L.mat("M_MhChalkTxt", (0.80, 0.78, 0.70), roughness=0.8),
        "black": L.mat("M_MhBlack", (0.026, 0.028, 0.032), roughness=0.4, metallic=0.4),
        "brass": L.mat("M_MhBrass", (0.62, 0.46, 0.17), roughness=0.28, metallic=0.92),
        "bolt": L.mat("M_MhBolt", (0.12, 0.11, 0.10), roughness=0.32, metallic=0.75),
    }


# --------------------------------------------------------------------- helpers ---
def sign_text(name, text, cx, cz, hgt, mat, root, *, y=0.0, depth=0.005):
    bpy.ops.object.text_add(location=(cx, y, cz))
    o = bpy.context.active_object
    o.name = name
    o.data.body = text
    o.data.align_x = "CENTER"
    o.data.align_y = "CENTER"
    o.data.size = hgt
    o.data.extrude = depth
    o.rotation_euler = (math.radians(90), 0, 0)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    o.data.materials.clear()
    o.data.materials.append(mat)
    L.parent_keep(o, root)
    return o


def drawer(tag, cx, cz, box_w, box_h, front_y, depth, M2, root, *, travel=0.16, front_h=None, front_w=None):
    """A self-contained openable taupe drawer (joined into one movable node).  The taupe
    FRONT is a full-overlay panel (larger than the box) so it fully covers the compartment
    opening — no see-through crevice above/below; the cream box slides behind it."""
    fy = front_y - 0.004
    fh = front_h if front_h is not None else box_h + 0.02
    fw = front_w if front_w is not None else box_w + 0.02
    parts = [
        L.box(f"Dw{tag}Front", (fw, 0.016, fh), (cx, fy, cz), M2["taupe"], bevel=0.005),
        L.box(f"Dw{tag}Back", (box_w - 0.02, 0.010, box_h - 0.014), (cx, fy + 0.012 + depth, cz), M2["cream"], bevel=0.002),
        L.box(f"Dw{tag}Bot", (box_w - 0.016, depth, 0.007), (cx, fy + 0.012 + depth / 2, cz - box_h / 2 + 0.008), M2["cream"], bevel=0.002),
        L.box(f"Dw{tag}Pull", (fw * 0.32, 0.014, 0.015), (cx, fy - 0.012, cz), M2["black"], bevel=0.004),
    ]
    for ex in (-1, 1):
        parts.append(L.box(f"Dw{tag}Side{ex}", (0.008, depth, box_h - 0.014), (cx + ex * (box_w / 2 - 0.006), fy + 0.012 + depth / 2, cz), M2["cream"], bevel=0.002))
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    d = parts[0]
    d.name = f"Drawer_{tag}"
    d["movable"] = "drawer"
    d["slide_axis"] = "-Y"
    d["open_travel_m"] = travel
    L.parent_keep(d, root)
    return d


def angled_shelf(name, cx, cz, w, backY, frontY, M2, root):
    """A walnut display tray tilted back-high / front-low, mounted to the slatwall."""
    tilt = math.radians(13)
    depth = 0.21
    back_edge = backY - 0.045
    cy = back_edge - depth / 2
    half = depth / 2 * math.sin(tilt)
    L.box(f"{name}_tray", (w, depth, 0.013), (cx, cy, cz), M2["walnut"], rot=(tilt, 0, 0), bevel=0.003, parent=root)
    L.box(f"{name}_back", (w, 0.05, 0.012), (cx, (back_edge + backY) / 2 + 0.005, cz + half + 0.024), M2["walnut"], bevel=0.003, parent=root)
    fy = cy - depth / 2 * math.cos(tilt)
    fz = cz - half - 0.006
    L.box(f"{name}_lip", (w, 0.015, 0.024), (cx, fy, fz), M2["walnut"], bevel=0.003, parent=root)
    L.box(f"{name}_lbl", (0.055, 0.011, 0.02), (cx, fy - 0.011, fz), M2["black"], bevel=0.003, parent=root)
    for ex in (-1, 1):
        L.box(f"{name}_sup{ex}", (0.008, depth * 0.6, 0.012), (cx + ex * (w / 2 - 0.012), cy + 0.01, cz - 0.006), M2["walnut"], rot=(tilt, 0, 0), bevel=0.002, parent=root)


def build(M):
    M2 = M2_local(M)
    W, Dd = 1.32, 0.40
    root = L.asset_root("merch_hutch", (W, Dd, 1.64))
    backY = Dd / 2 - 0.02
    frontY = -Dd / 2 + 0.02
    cols = (-0.41, 0.0, 0.41)
    counter_z, top_z, sign_z, crown_z = 0.70, 1.36, 1.455, 1.57

    # ---- continuous walnut side panels tie the whole unit together ----
    for ex in (-1, 1):
        L.box(f"Side_{ex}", (0.032, Dd, crown_z - 0.10), (ex * (W / 2 - 0.016), 0, 0.10 + (crown_z - 0.10) / 2), M2["walnut"], bevel=0.005, parent=root)

    # ---- molded plinth + brass corner brackets ----
    L.box("PlinthBot", (W, Dd, 0.03), (0, 0, 0.015), M2["walnut"], bevel=0.006, parent=root)
    L.box("PlinthMid", (W - 0.04, Dd - 0.015, 0.055), (0, 0, 0.058), M2["walnut"], bevel=0.004, parent=root)
    L.box("PlinthTop", (W - 0.01, Dd, 0.018), (0, 0, 0.095), M2["walnut"], bevel=0.006, parent=root)
    for ex in (-1, 1):
        L.corner_bracket(f"PlCnr_{ex}", ex * (W / 2 - 0.035), frontY - 0.004, 0.13, M2, root, s=0.045)

    # ---- lower cabinet: back + counter, then per column drawers + open shelves ----
    L.box("CabBack", (W - 0.07, 0.02, counter_z - 0.12), (0, backY, 0.12 + (counter_z - 0.12) / 2), M2["cream"], bevel=0.0, parent=root)
    L.wood_slab("Counter", (W, Dd + 0.02, 0.03), (0, -0.006, counter_z), M2["walnut"], bevel=0.006, parent=root)
    # cream shelves span floor (on the plinth) to the counter underside -> no gap at top
    counter_under = counter_z - 0.016
    floor_z = 0.10
    sh_levels = tuple(floor_z + i * (counter_under - floor_z) / 3 for i in range(4))
    div_h = counter_under - floor_z
    div_cz = (floor_z + counter_under) / 2
    for c, cx in enumerate(cols):
        # walnut column dividers + a cream interior back (both reach the counter underside)
        for ex in (-1, 1):
            L.box(f"Div_{c}_{ex}", (0.014, Dd - 0.03, div_h), (cx + ex * 0.207, 0, div_cz), M2["walnut"], bevel=0.003, parent=root)
        L.box(f"ColBack_{c}", (0.41, 0.012, div_h), (cx, backY - 0.018, div_cz), M2["cream"], bevel=0.0, parent=root)
        # cream partition between the drawer bank (left) and the open shelves (right)
        L.box(f"MidDiv_{c}", (0.010, Dd - 0.06, div_h), (cx + 0.018, 0, div_cz), M2["cream"], bevel=0.002, parent=root)
        # drawer bank: cream compartment shelves (roofs/floors) + three openable drawers
        dbx, dbw = cx - 0.10, 0.20
        for z in sh_levels:
            L.box(f"DwSh_{c}_{z:.3f}", (dbw + 0.008, Dd - 0.06, 0.012), (dbx, -0.005, z), M2["cream"], bevel=0.002, parent=root)
        gap = sh_levels[1] - sh_levels[0]
        for r in range(3):
            cz = (sh_levels[r] + sh_levels[r + 1]) / 2
            drawer(f"{c}_{r}", dbx, cz, dbw - 0.02, gap - 0.03, frontY + 0.006, 0.29, M2, root, front_h=gap - 0.006, front_w=dbw + 0.012)
        # open shelves: cream compartments, each with its own roof
        sbx, sbw = cx + 0.116, 0.15
        for z in sh_levels:
            L.box(f"OpSh_{c}_{z:.3f}", (sbw, Dd - 0.08, 0.012), (sbx, -0.005, z), M2["cream"], bevel=0.002, parent=root)

    # ---- upper display: cream slatwall + black standards + nine angled shelves ----
    up_h = top_z - counter_z - 0.04
    L.box("Slatwall", (W - 0.06, 0.016, up_h), (0, backY - 0.006, counter_z + 0.02 + up_h / 2), M2["slat"], bevel=0.0, parent=root)
    for sx in (-0.615, -0.205, 0.205, 0.615):
        L.box(f"Std_{sx:.2f}", (0.014, 0.012, up_h - 0.03), (sx, backY - 0.016, counter_z + 0.02 + up_h / 2), M2["black"], bevel=0.002, parent=root)
    for c, cx in enumerate(cols):
        for r, z in enumerate((0.87, 1.09, 1.31)):
            angled_shelf(f"Shelf_{c}_{r}", cx, z, 0.38, backY, frontY, M2, root)

    # ---- top: solid walnut header with a green "PRO SHOP" chalkboard on its FRONT face,
    #      brass corner brackets + gold trim, capped by a crown molding ----
    front_face = -Dd / 2
    L.box("Header", (W - 0.06, Dd, 0.19), (0, 0, sign_z), M2["walnut"], bevel=0.006, parent=root)
    L.box("SignGold", (W - 0.20, 0.02, 0.155), (0, front_face - 0.006, sign_z), M2["brass"], bevel=0.0, parent=root)
    L.box("SignBoard", (W - 0.215, 0.022, 0.14), (0, front_face - 0.015, sign_z), M2["chalk"], bevel=0.004, parent=root)
    sign_text("SignText", "PRO SHOP", 0.0, sign_z, 0.075, M2["chalktext"], root, y=front_face - 0.031, depth=0.006)
    for ex in (-1, 1):
        L.corner_bracket(f"SgCnr_{ex}", ex * (W / 2 - 0.08), front_face - 0.006, sign_z, M2, root, s=0.045)
    L.box("CrownStep", (W - 0.03, Dd, 0.02), (0, 0, crown_z - 0.025), M2["walnut"], bevel=0.006, parent=root)
    L.box("Crown", (W + 0.02, Dd + 0.02, 0.045), (0, 0, crown_z + 0.008), M2["walnut"], bevel=0.008, parent=root)

    L.collision_box("COL_Base", (W, Dd, counter_z + 0.03), (0, 0, (counter_z + 0.03) / 2), M, parent=root)
    L.collision_box("COL_Upper", (W, Dd, crown_z + 0.03 - counter_z), (0, 0, counter_z + (crown_z + 0.03 - counter_z) / 2), M, parent=root)
    return root


L.run("merch_hutch", build)
