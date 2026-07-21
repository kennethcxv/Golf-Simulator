"""Pinehollow golf-bag storage rack (ref: 3Bvm9daj).

A premium 4-bay rack: a molded walnut base, curved S-profile walnut divider fins and
arched end panels with green-leather insets + gold pinstripe, ribbed black bay mats
with heel-stops, a black-steel top rail with curved shepherd's-hook holder arms, and
a green nameplate sign with gold trim on posts with brass ball finials.  Bays ~0.24 m
clear so the golf_bag (0.21 m) drops in.
"""
import sys
import math
sys.path.insert(0, "tools/blender")
import bpy
import bmesh
import lib_props as L
from mathutils import Vector


# ------------------------------------------------------------------ materials ----
def _tex(name, base_lin, *, mottle=0.10, seed=5, w=512, h=512):
    import numpy as np
    img = L._img(name, w, h)
    rng = np.random.default_rng(seed)
    base = np.array(base_lin, "float32")
    mott = (L._fbm(rng, w, h, 12, 12, 5) - 0.5) * (mottle * 2.0)
    micro = (rng.random((h, w)).astype("float32") - 0.5) * 0.045
    val = np.clip(1.0 + mott + micro, 0.66, 1.36)[..., None]
    lin = np.clip(base * val, 0, 1)
    L._write(img, np.concatenate([L.lin2srgb(lin), np.ones((h, w, 1), "float32")], axis=2))
    return img


def _satin_wood(name, image, *, roughness=0.36, coat=0.14):
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
    for k, v in (("Coat Weight", coat), ("Coat Roughness", 0.24)):
        if k in b.inputs:
            b.inputs[k].default_value = v
    return m


def _mat_sheen(name, image, *, roughness=0.7, sheen=0.4):
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
        "walnut": _satin_wood("M_RkWalnut", L.wood_image("RkWalnut", "walnut")),
        "green": _mat_sheen("M_RkGreen", _tex("RkGreen", (0.020, 0.055, 0.038), mottle=0.14, seed=4), roughness=0.66, sheen=0.5),
        "gold": L.mat("M_RkGold", (0.74, 0.56, 0.20), roughness=0.24, metallic=0.95),
        "brass": L.mat("M_RkBrass", (0.62, 0.46, 0.17), roughness=0.28, metallic=0.92),
        "steel": L.mat("M_RkSteel", (0.045, 0.047, 0.052), roughness=0.36, metallic=0.55),
        "rubber": L.mat_tex("M_RkRubber", _tex("RkRubber", (0.020, 0.020, 0.022), mottle=0.16, seed=9), roughness=0.9),
    }


# --------------------------------------------------------------------- helpers ---
def _centroid(prof):
    cy = sum(p[0] for p in prof) / len(prof)
    cz = sum(p[1] for p in prof) / len(prof)
    return cy, cz


def _scale_prof(prof, s):
    cy, cz = _centroid(prof)
    return [(cy + (y - cy) * s, cz + (z - cz) * s) for (y, z) in prof]


def fin(name, x, thick, prof, mat, root, *, bevel=0.003, uv=True):
    """A walnut divider fin: extrude a (y,z) outline along X for thickness."""
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
    L._finish(o, mat, bevel=bevel, uv=uv)
    L.parent_keep(o, root)
    return o


def inset_fin(name, x, prof, M2, root, base_thick, *, gold=0.84, grn=0.77):
    """Walnut fin + a green-leather inset with a thin gold pinstripe (both faces)."""
    fin(name, x, base_thick, prof, M2["walnut"], root)
    fin(f"{name}_gold", x, base_thick + 0.005, _scale_prof(prof, gold), M2["gold"], root, bevel=0.0, uv=False)
    fin(f"{name}_grn", x, base_thick + 0.009, _scale_prof(prof, grn), M2["green"], root, bevel=0.0)


def tube(name, pts, r, mat, root, *, verts=10):
    P = [Vector(p) for p in pts]
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]
        mid = (a + b) * 0.5
        d = b - a
        if d.length < 1e-5:
            continue
        L.cyl(f"{name}_{i}", r, d.length * 1.08, (mid.x, mid.y, mid.z), mat, rot=d.to_track_quat("Z", "Y").to_euler(), verts=verts, parent=root)
    for j, p in enumerate(P):
        L.sphere(f"{name}_j{j}", r * 1.02, (p.x, p.y, p.z), mat, parent=root, segs=verts)


def divider_profile(yb, yf, H, n=16):
    """S-curved fin: full-height at the back, a sweeping curved front edge."""
    prof = [(yb, 0.0), (yb, H)]
    for i in range(1, n + 1):
        t = i / n
        ease = t * t * (3 - 2 * t)
        z = H * (1 - t) + 0.03
        y = yb + (yf - yb) * ease - 0.05 * math.sin(t * math.pi)
        prof.append((y, z))
    prof.append((yf, 0.0))
    return prof


def endpanel_profile(yb, yf, H, n=14):
    """Fuller end panel with an arched top sweeping from the back down to the front."""
    prof = [(yb, 0.0), (yb, H)]
    for i in range(1, n + 1):
        t = i / n
        z = H - (H - H * 0.44) * (t ** 1.7)
        y = yb + (yf - yb) * (t * t * (3 - 2 * t))
        prof.append((y, z))
    prof.append((yf, 0.0))
    return prof


def build(M):
    M2 = M2_local(M)
    W, Dd = 1.22, 0.54
    root = L.asset_root("bag_rack", (W, Dd, 1.05))
    panels = (-0.54, -0.27, 0.0, 0.27, 0.54)
    bays = (-0.405, -0.135, 0.135, 0.405)
    base_z = 0.10
    yb, yf = Dd / 2 - 0.04, -Dd / 2 + 0.05

    # ---- molded walnut base + black feet ----
    L.box("BaseBot", (W, Dd, 0.028), (0, 0, 0.014), M2["walnut"], bevel=0.006, parent=root)
    L.box("BaseMid", (W - 0.05, Dd - 0.05, 0.05), (0, 0, 0.053), M2["walnut"], bevel=0.004, parent=root)
    L.box("BaseTop", (W - 0.02, Dd - 0.02, 0.022), (0, 0, 0.089), M2["walnut"], bevel=0.008, parent=root)
    for sx in (-1, 1):
        for sy in (-1, 1):
            L.cyl(f"Foot_{sx}{sy}", 0.02, 0.02, (sx * (W / 2 - 0.05), sy * (Dd / 2 - 0.05), 0.01), M2["steel"], verts=14, parent=root)

    # ---- bay mats + black heel-stops ----
    for bx in bays:
        L.box(f"Mat_{bx:.2f}", (0.20, Dd - 0.12, 0.010), (bx, 0.01, base_z + 0.006), M2["rubber"], bevel=0.002, parent=root)
        for r in range(4):                                    # ribs
            L.box(f"MatRib_{bx:.2f}_{r}", (0.20, 0.012, 0.004), (bx, -0.13 + r * 0.06, base_z + 0.012), M2["rubber"], bevel=0.001, parent=root)
        L.box(f"Stop_{bx:.2f}", (0.11, 0.05, 0.03), (bx, -Dd / 2 + 0.10, base_z + 0.02), M2["steel"], bevel=0.006, parent=root)

    # ---- 3 internal curved divider fins + 2 arched end panels (all with green/gold insets) ----
    dprof = divider_profile(yb, yf, 0.46)
    for x in (-0.27, 0.0, 0.27):
        inset_fin(f"Div_{x:.2f}".replace("-", "n"), x, [(y, z + base_z) for (y, z) in dprof], M2, root, 0.026)
    eprof = endpanel_profile(yb, yf, 0.52)
    for ex in (-1, 1):
        inset_fin(f"End_{ex}", ex * 0.54, [(y, z + base_z) for (y, z) in eprof], M2, root, 0.03)

    # ---- solid walnut back wall with a green/gold inset panel per bay ----
    y_wall = Dd / 2 - 0.03
    wall_top = base_z + 0.47
    wall_h = wall_top - base_z
    L.box("BackWall", (W - 0.03, 0.03, wall_h), (0, y_wall, (base_z + wall_top) / 2), M2["walnut"], bevel=0.006, parent=root)
    for bx in bays:
        L.box(f"BkGold_{bx:.2f}", (0.215, 0.006, wall_h - 0.06), (bx, y_wall - 0.016, (base_z + wall_top) / 2), M2["gold"], bevel=0.0, parent=root)
        L.box(f"BkGrn_{bx:.2f}", (0.19, 0.010, wall_h - 0.09), (bx, y_wall - 0.021, (base_z + wall_top) / 2), M2["green"], bevel=0.004, parent=root)

    # ---- black-steel top rail along the wall + posts + brass finials + green nameplate sign ----
    rail_y, rail_z = y_wall, wall_top + 0.012
    L.cyl("Rail", 0.013, W - 0.03, (0, rail_y, rail_z), M2["steel"], rot=(0, math.radians(90), 0), verts=16, parent=root)
    post_top = rail_z + 0.30
    for ex in (-1, 1):
        px = ex * 0.39                                    # under the sign ends so it isn't floating
        L.box(f"Post_{ex}", (0.026, 0.026, post_top - rail_z + 0.08), (px, rail_y, (rail_z - 0.04 + post_top) / 2), M2["steel"], bevel=0.003, parent=root)
        # bracket tying the post to the back rail/wall
        L.box(f"PostBrk_{ex}", (0.05, 0.032, 0.032), (px, rail_y - 0.004, rail_z), M2["steel"], bevel=0.004, parent=root)
        L.sphere(f"Finial_{ex}", 0.024, (px, rail_y, post_top + 0.03), M2["brass"], parent=root, segs=18)
    sign_z = post_top - 0.12
    L.box("SignFrame", (0.80, 0.03, 0.20), (0, rail_y, sign_z), M2["steel"], bevel=0.008, parent=root)
    L.box("SignGold", (0.75, 0.034, 0.17), (0, rail_y - 0.002, sign_z), M2["gold"], bevel=0.004, parent=root)
    L.box("SignGreen", (0.72, 0.038, 0.145), (0, rail_y - 0.004, sign_z), M2["green"], bevel=0.006, parent=root)
    L.box("SignGoldLine", (0.70, 0.040, 0.12), (0, rail_y - 0.006, sign_z), M2["gold"], bevel=0.0, parent=root)
    L.box("SignGreen2", (0.685, 0.042, 0.105), (0, rail_y - 0.008, sign_z), M2["green"], bevel=0.004, parent=root)
    L.sign_text("SignText", "GOLF BAGS", 0.0, sign_z, 0.055, M2, root, y=rail_y - 0.033, depth=0.006)

    L.collision_box("COL_Body", (W, Dd, 0.62), (0, 0, 0.31), M, parent=root)
    L.collision_box("COL_Sign", (0.84, 0.06, 0.24), (0, rail_y, sign_z), M, parent=root)
    return root


L.run("bag_rack", build)
