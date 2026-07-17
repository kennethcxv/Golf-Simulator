"""Pinehollow slatwall accessory stand (ref: QyQfqVNF).

A tall walnut stand: a molded plinth with a black base band, one openable drawer with a
brass cup pull, curved swept walnut sides, a green slatwall (gold slat lines) holding
twelve black peg-hook display arms (4x3), and an arched green nameplate with gold trim.
"""
import sys
import math
sys.path.insert(0, "tools/blender")
import bpy
import bmesh
import lib_props as L


# ------------------------------------------------------------------ materials ----
def _tex(name, base_lin, *, mottle=0.10, seed=5, w=512, h=512):
    import numpy as np
    img = L._img(name, w, h)
    rng = np.random.default_rng(seed)
    base = np.array(base_lin, "float32")
    mott = (L._fbm(rng, w, h, 12, 12, 5) - 0.5) * (mottle * 2.0)
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


def _felt(name, image, *, roughness=0.7, sheen=0.4):
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
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    if "Sheen Weight" in b.inputs:
        b.inputs["Sheen Weight"].default_value = sheen
    return m


def M2_local(M):
    return {
        "walnut": _satin_wood("M_AsWalnut", L.wood_image("AsWalnut", "walnut"), tint=(1.30, 1.15, 0.95)),
        "green": _felt("M_AsGreen", _tex("AsGreen", (0.026, 0.060, 0.042), mottle=0.12, seed=4), roughness=0.72, sheen=0.5),
        "gold": L.mat("M_AsGold", (0.74, 0.56, 0.20), roughness=0.24, metallic=0.95),
        "brass": L.mat("M_AsBrass", (0.60, 0.44, 0.16), roughness=0.28, metallic=0.9),
        "black": L.mat("M_AsBlack", (0.026, 0.028, 0.032), roughness=0.42, metallic=0.35),
        "bolt": L.mat("M_AsBolt", (0.12, 0.11, 0.10), roughness=0.32, metallic=0.75),
    }


# --------------------------------------------------------------------- helpers ---
def fin(name, x, thick, prof, mat, root, *, bevel=0.004):
    """Extrude a (y,z) outline along X for a shaped side panel."""
    bm = bmesh.new()
    verts = [bm.verts.new((0.0, y, z)) for (y, z) in prof]
    bm.faces.new(verts)
    ret = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    ext = [e for e in ret["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=ext, vec=(thick, 0, 0))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(-thick / 2, 0, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.location = (x, 0, 0)
    L._finish(o, mat, bevel=bevel, uv=True)
    L.parent_keep(o, root)
    return o


def arched_panel(name, cx, cz, w, h, thick, y, mat, root, *, arch=0.34, bevel=0.004):
    """A flat panel with an arched (curved) top, extruded in Y — faces -Y."""
    hw, hh = w / 2, h / 2
    spring = hh - h * arch
    pts = [(-hw, -hh), (hw, -hh), (hw, spring)]
    n = 14
    for i in range(1, n):
        t = i / n
        pts.append((hw - w * t, spring + (hh - spring) * math.sin(t * math.pi)))
    pts.append((-hw, spring))
    bm = bmesh.new()
    verts = [bm.verts.new((px, 0.0, pz)) for (px, pz) in pts]
    bm.faces.new(verts)
    ret = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    ext = [e for e in ret["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=ext, vec=(0, thick, 0))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, -thick / 2, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.location = (cx, y, cz)
    L._finish(o, mat, bevel=bevel, uv=True)
    L.parent_keep(o, root)
    return o


def drawer(tag, cx, cz, box_w, box_h, front_y, depth, M2, root, *, travel=0.18, front_h=None, front_w=None):
    """Openable walnut shaker drawer (joined movable node) with a brass cup pull."""
    fy = front_y - 0.004
    fh = front_h if front_h is not None else box_h + 0.02
    fw = front_w if front_w is not None else box_w + 0.02
    parts = [
        L.box(f"Dw{tag}Front", (fw, 0.018, fh), (cx, fy, cz), M2["walnut"], bevel=0.005),
        L.box(f"Dw{tag}Panel", (fw - 0.06, 0.012, fh - 0.05), (cx, fy - 0.009, cz), M2["walnut"], bevel=0.010),
        L.box(f"Dw{tag}Back", (box_w - 0.02, 0.010, box_h - 0.014), (cx, fy + 0.012 + depth, cz), M2["walnut"], bevel=0.002),
        L.box(f"Dw{tag}Bot", (box_w - 0.016, depth, 0.007), (cx, fy + 0.012 + depth / 2, cz - box_h / 2 + 0.008), M2["walnut"], bevel=0.002),
    ]
    for ex in (-1, 1):
        parts.append(L.box(f"Dw{tag}Side{ex}", (0.008, depth, box_h - 0.014), (cx + ex * (box_w / 2 - 0.006), fy + 0.012 + depth / 2, cz), M2["walnut"], bevel=0.002))
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    d = parts[0]
    d.name = f"Drawer_{tag}"
    L.brass_cup_pull(f"Dw{tag}Pull", cx, fy - 0.012, cz, {"brass": M2["brass"]}, d, w=0.10)
    d["movable"] = "drawer"
    d["slide_axis"] = "-Y"
    d["open_travel_m"] = travel
    L.parent_keep(d, root)
    return d


def peg_arm(name, ax, az, slat_y, M2, root):
    """A black faceout peg arm: mount plate -> forward bar (slight down slope) -> upturned tip."""
    length = 0.225
    tilt = math.radians(-5)
    drop = length * math.sin(math.radians(5))
    L.box(f"{name}_mnt", (0.034, 0.026, 0.056), (ax, slat_y - 0.005, az), M2["black"], bevel=0.003, parent=root)
    L.box(f"{name}_arm", (0.017, length, 0.017), (ax, slat_y - length / 2 - 0.012, az - drop / 2), M2["black"], rot=(tilt, 0, 0), bevel=0.003, parent=root)
    L.box(f"{name}_tip", (0.017, 0.017, 0.036), (ax, slat_y - length - 0.012, az - drop + 0.016), M2["black"], bevel=0.003, parent=root)


def build(M):
    M2 = M2_local(M)
    W, Dd = 0.56, 0.32
    root = L.asset_root("accessory_stand", (W, Dd, 1.20))
    backY = Dd / 2 - 0.02
    frontY = -Dd / 2 + 0.02
    base_z, case_top = 0.10, 0.90

    # ---- molded plinth: black base band + stepped walnut ----
    L.box("BaseBand", (W + 0.02, Dd + 0.02, 0.035), (0, 0, 0.0175), M2["black"], bevel=0.006, parent=root)
    L.box("PlinthBot", (W, Dd, 0.028), (0, 0, 0.049), M2["walnut"], bevel=0.005, parent=root)
    L.box("PlinthTop", (W - 0.03, Dd - 0.015, 0.03), (0, 0, 0.085), M2["walnut"], bevel=0.006, parent=root)

    # ---- curved swept walnut sides + back + top cap ----
    sprof = [(backY, base_z), (backY, case_top), (frontY + 0.03, case_top),
             (frontY, case_top - 0.07), (frontY, base_z)]
    for ex in (-1, 1):
        fin(f"Side_{ex}", ex * (W / 2 - 0.016), 0.03, sprof, M2["walnut"], root)
    L.box("Back", (W - 0.06, 0.02, case_top - base_z), (0, backY, (base_z + case_top) / 2), M2["walnut"], bevel=0.004, parent=root)
    L.wood_slab("TopCap", (W + 0.02, Dd + 0.02, 0.03), (0, 0, case_top + 0.015), M2["walnut"], bevel=0.006, parent=root)

    # ---- green slatwall with gold slat lines ----
    sw_z0, sw_z1 = 0.36, case_top - 0.02
    L.box("Slatwall", (W - 0.10, 0.016, sw_z1 - sw_z0), (0, backY - 0.02, (sw_z0 + sw_z1) / 2), M2["green"], bevel=0.0, parent=root)
    for i in range(9):
        z = sw_z0 + 0.03 + i * (sw_z1 - sw_z0 - 0.06) / 8
        L.box(f"SlatLine_{i}", (W - 0.10, 0.006, 0.004), (0, backY - 0.028, z), M2["gold"], bevel=0.0, parent=root)

    # ---- one openable drawer, enclosed by a walnut floor + roof so its top isn't visible ----
    L.box("DrawerFloor", (W - 0.09, Dd - 0.05, 0.014), (0, 0.0, 0.108), M2["walnut"], bevel=0.004, parent=root)
    L.box("DrawerRoof", (W - 0.09, Dd - 0.05, 0.016), (0, 0.0, 0.352), M2["walnut"], bevel=0.004, parent=root)
    drawer("Main", 0.0, 0.232, W - 0.15, 0.20, frontY + 0.004, 0.26, M2, root, front_h=0.226, front_w=W - 0.10)

    # ---- twelve black peg-hook arms (4 rows x 3 cols) ----
    slat_y = backY - 0.028
    for rz in (0.46, 0.58, 0.70, 0.82):
        for ax in (-0.155, 0.0, 0.155):
            peg_arm(f"Peg_{rz:.2f}_{ax:.2f}", ax, rz, slat_y, M2, root)

    # ---- single arched green nameplate with a gold frame ----
    sign_z, sign_y = case_top + 0.18, frontY + 0.05
    arched_panel("SignFrame", 0.0, sign_z, W - 0.10, 0.30, 0.026, sign_y, M2["walnut"], root, arch=0.38)
    arched_panel("SignGold", 0.0, sign_z, W - 0.135, 0.264, 0.030, sign_y - 0.008, M2["gold"], root, arch=0.36, bevel=0.0)
    arched_panel("SignGreen", 0.0, sign_z, W - 0.155, 0.244, 0.034, sign_y - 0.014, M2["green"], root, arch=0.35, bevel=0.003)

    L.collision_box("COL_Case", (W, Dd, case_top), (0, 0, case_top / 2), M, parent=root)
    L.collision_box("COL_Sign", (W - 0.06, 0.06, 0.28), (0, frontY + 0.06, sign_z), M, parent=root)
    return root


L.run("accessory_stand", build)
