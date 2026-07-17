"""Pinehollow walnut coffee table (ref: 8toLiCHN).

A refined piece: a rounded walnut top with a recessed cream-suede inlay and brass
L-corner caps, four tapered splayed legs with brass collars + foot caps, a slatted
walnut lower shelf, and a decorative oval (racetrack) riser tray holding a brass
card-holder.
"""
import sys
import math
sys.path.insert(0, "tools/blender")
import bpy
import lib_props as L
from mathutils import Vector


def _cream_img(name="CTCream", w=256, h=256):
    """Warm cream suede: light beige with a soft low-contrast nap (authored in linear)."""
    import numpy as np
    img = L._img(name, w, h)
    rng = np.random.default_rng(5)
    base = np.array([0.71, 0.62, 0.45], "float32")
    mott = (L._vnoise(rng, w, h, 26, 26) - 0.5) * 0.10
    fine = (rng.random((h, w)).astype("float32") - 0.5) * 0.03
    val = np.clip(1.0 + mott + fine, 0.82, 1.14)[..., None]
    lin = np.clip(base * val, 0, 1)
    L._write(img, np.concatenate([L.lin2srgb(lin), np.ones((h, w, 1), "float32")], axis=2))
    return img


def _brass_img(name="CTBrass", w=256, h=256):
    """Warm satin brass: soft brushed streaks + mottle so it reads as real metal (linear)."""
    import numpy as np
    img = L._img(name, w, h)
    rng = np.random.default_rng(17)
    base = np.array([0.62, 0.45, 0.155], "float32")
    streak = np.repeat((rng.random((1, w)).astype("float32") - 0.5), h, axis=0) * 0.14
    mottle = (L._vnoise(rng, w, h, 12, 12) - 0.5) * 0.22
    fine = (rng.random((h, w)).astype("float32") - 0.5) * 0.06
    val = np.clip(1.0 + streak + mottle + fine, 0.66, 1.4)[..., None]
    lin = np.clip(base * val, 0, 1)
    L._write(img, np.concatenate([L.lin2srgb(lin), np.ones((h, w, 1), "float32")], axis=2))
    return img


def _satin_wood_mat(name, image, *, roughness=0.34, coat=0.14):
    """Textured wood finished with a thin lacquer coat, for a satin furniture sheen."""
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


def M2_local(M):
    m = dict(M)
    m["walnut"] = _satin_wood_mat("M_CTWalnut", L.wood_image("CTWalnut", "walnut"), roughness=0.34, coat=0.15)
    m["cream"] = L.mat_tex("M_CTCream", _cream_img(), roughness=0.66, metallic=0.0)
    m["brass"] = L.mat_tex("M_CTBrass", _brass_img(), roughness=0.26, metallic=0.9)
    m["brass_dk"] = L.mat("M_CTBrassDk", (0.42, 0.30, 0.11), roughness=0.34, metallic=0.9)
    return m


def inlay_top(name, w, d, cz, M2, root, *, tt=0.05, rim=0.058, depth=0.013, corner=0.05, ox=0.0, oy=0.0):
    """Walnut rounded top with a shallow recess cut from its face, filled by a cream inlay."""
    blank = L.rounded_box(name, (w, d, tt), (ox, oy, cz), M2["walnut"], corner=corner, bevel=0.006, uv=False)
    cav = L.rounded_box(name + "_cav", (w - 2 * rim, d - 2 * rim, tt), (ox, oy, cz + tt - depth),
                        M2["walnut"], corner=max(0.02, corner - rim + 0.02), bevel=0.0, uv=False)
    L.activate(blank)
    md = blank.modifiers.new("cut", "BOOLEAN")
    md.operation = "DIFFERENCE"
    md.object = cav
    md.solver = "EXACT"
    bpy.ops.object.modifier_apply(modifier=md.name)
    bpy.data.objects.remove(cav, do_unlink=True)
    for p in blank.data.polygons:
        p.material_index = 0
    L.activate(blank)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    L.parent_keep(blank, root)
    # cream inlay filling the recess, sitting just below the walnut rim
    top_s = cz + tt / 2
    ih = depth + 0.010
    L.rounded_box(name + "_inlay", (w - 2 * rim - 0.004, d - 2 * rim - 0.004, ih),
                  (ox, oy, top_s - 0.002 - ih / 2), M2["cream"],
                  corner=max(0.018, corner - rim + 0.018), bevel=0.003, uv=True, parent=root)
    return top_s


def corner_cap(sx, sy, W, Dd, cz, tt, M2, root):
    """Slim brass L-cap hugging a top corner: two thin face plates + a small top piece."""
    xe, ye = sx * W / 2, sy * Dd / 2
    th, ln, hz = 0.010, 0.098, 0.052
    ztop = cz + tt / 2
    zc = ztop - hz / 2 + 0.001
    L.box(f"CapX_{sx}{sy}", (th, ln, hz), (xe + sx * 0.004, ye - sy * (0.012 + ln / 2), zc),
          M2["brass"], bevel=0.002, parent=root)
    L.box(f"CapY_{sx}{sy}", (ln, th, hz), (xe - sx * (0.012 + ln / 2), ye + sy * 0.004, zc),
          M2["brass"], bevel=0.002, parent=root)
    L.box(f"CapT_{sx}{sy}", (0.05, 0.05, 0.009), (xe - sx * 0.03, ye - sy * 0.03, ztop + 0.001),
          M2["brass"], bevel=0.003, parent=root)


def leg(name, sx, sy, lx, ly, z_top, M2, root):
    """A refined leg: a straight square top block, a brass collar, then a tapered
    shaft (gently splayed, softened edges) to a brass foot cap flat on the floor.
    A 4-sided frustum's radius is to the corners, so width = r*sqrt(2)."""
    bx, by = sx * lx, sy * ly
    blk = 0.056                                  # block width
    blk_h = 0.062
    shaft_z = z_top - blk_h
    r_top = blk / 2 * 1.414 * 0.98               # shaft top matches the block width
    r_foot = 0.038 / 2 * 1.414                   # solid ~38 mm foot
    # straight square top block (the corner cap wraps its top)
    L.box(f"{name}_blk", (blk, blk, blk_h + 0.014), (bx, by, z_top - (blk_h + 0.014) / 2), M2["walnut"], bevel=0.004, parent=root)
    # brass collar at the block/shaft junction
    L.box(f"{name}_collar", (blk + 0.006, blk + 0.006, 0.020), (bx, by, shaft_z + 0.003), M2["brass"], bevel=0.003, parent=root)
    # tapered shaft, gently splayed outward
    spl = 0.024
    Pt = Vector((bx, by, shaft_z + 0.006))
    Pb = Vector((sx * (lx + spl), sy * (ly + spl), 0.028))
    d = Pb - Pt
    length = d.length
    center = (Pt + Pb) * 0.5
    eul = d.to_track_quat("-Z", "Y").to_euler()
    rot = (eul.x, eul.y, eul.z)
    L.frustum(f"{name}_shaft", r_foot, r_top, length, (center.x, center.y, center.z), M2["walnut"],
              segments=4, rot=rot, parent=root, uv=True, bevel=0.004)
    # brass foot cap sitting flat on the floor
    L.box(f"{name}_foot", (0.048, 0.048, 0.032), (Pb.x, Pb.y, 0.016), M2["brass"], bevel=0.005, parent=root)
    return Pt, Pb


def slat_shelf(name, w, d, z, M2, root):
    """A slatted walnut shelf: planks running along X with fine seams, in a thin frame."""
    n = 6
    pd = (d - 0.02) / n
    for i in range(n):
        y = -d / 2 + 0.01 + pd * (i + 0.5)
        L.wood_slab(f"{name}_s{i}", (w - 0.02, pd - 0.005, 0.020), (0, y, z), M2["walnut"], bevel=0.003, grain="x")
    # slim walnut edge frame around the planks
    for ey in (-1, 1):
        L.box(f"{name}_fY{ey}", (w, 0.016, 0.026), (0, ey * (d / 2 - 0.008), z), M2["walnut"], bevel=0.004, parent=root)
    for ex in (-1, 1):
        L.box(f"{name}_fX{ex}", (0.016, d, 0.026), (ex * (w / 2 - 0.008), 0, z), M2["walnut"], bevel=0.004, parent=root)


def riser(cx, cy, top_s, M2, root):
    """Oval (racetrack) walnut riser tray with a cream inlay, raised on a plinth, + brass card-holder."""
    tw, td, tt = 0.46, 0.175, 0.05
    base_z = top_s + 0.075               # tray-slab centre
    tray_s = base_z + tt / 2
    # plinth (smaller racetrack) leaving an open gap under the tray on the long sides
    L.rounded_box("RiserPlinth", (0.28, 0.11, 0.055), (cx, cy, top_s + 0.0275), M2["walnut"],
                  corner=0.055, bevel=0.004, uv=True, parent=root)
    # tray body: walnut racetrack with a recessed cream inlay
    inlay_top("RiserTray", tw, td, base_z, M2, root, tt=tt, rim=0.03, depth=0.012, corner=td / 2, ox=cx, oy=cy)
    # brass card-holder centred on the tray: base -> stem -> upright wire frame.
    # the stem meets the frame's bottom bar (it must not poke up into the opening).
    hx, hy = cx, cy
    fw, fh, bar = 0.094, 0.068, 0.006
    frame_bot = tray_s + 0.052
    L.cyl("CardBase", 0.028, 0.012, (hx, hy, tray_s + 0.006), M2["brass"], verts=24, parent=root, uv=True)
    L.cyl("CardStem", 0.006, frame_bot - (tray_s + 0.006), (hx, hy, (tray_s + 0.006 + frame_bot) / 2), M2["brass"], verts=14, parent=root, uv=True)
    for dz in (0.0, fh):                                   # bottom + top bars
        L.box(f"CardH_{dz:.3f}", (fw, bar, bar), (hx, hy, frame_bot + dz), M2["brass"], bevel=0.0, parent=root)
    for dx in (-fw / 2, fw / 2):                           # side bars
        L.box(f"CardV_{dx:.3f}", (bar, bar, fh + bar), (hx + dx, hy, frame_bot + fh / 2), M2["brass"], bevel=0.0, parent=root)


def build(M):
    M2 = M2_local(M)
    W, Dd = 1.06, 0.60
    TT = 0.05
    cz = 0.42 - TT / 2                       # top slab centre (surface at 0.42)
    root = L.asset_root("coffee_table", (W, Dd, 0.47))

    lx, ly = 0.492, 0.268
    z_top = cz - TT / 2 + 0.005

    # apron rails under the top (subtle walnut skirt tying the leg blocks together)
    apZ = cz - TT / 2 - 0.03
    L.box("ApronF", (2 * lx - 0.05, 0.03, 0.05), (0, -(ly - 0.028), apZ), M2["walnut"], bevel=0.004, parent=root)
    L.box("ApronB", (2 * lx - 0.05, 0.03, 0.05), (0, (ly - 0.028), apZ), M2["walnut"], bevel=0.004, parent=root)
    for ex in (-1, 1):
        L.box(f"ApronS_{ex}", (0.03, 2 * ly - 0.05, 0.05), (ex * (lx - 0.028), 0, apZ), M2["walnut"], bevel=0.004, parent=root)

    # legs + brass, then the slatted shelf snug between them
    for sx in (-1, 1):
        for sy in (-1, 1):
            leg(f"Leg_{sx}{sy}", sx, sy, lx, ly, z_top, M2, root)
    slat_shelf("Shelf", 2 * lx - 0.028, 2 * ly - 0.018, 0.135, M2, root)   # edges tuck into the legs

    # the walnut top with cream inlay + brass corner caps
    top_s = inlay_top("Top", W, Dd, cz, M2, root)
    for sx in (-1, 1):
        for sy in (-1, 1):
            corner_cap(sx, sy, W, Dd, cz, TT, M2, root)

    # oval riser tray, centred in X and set slightly back, + centred brass card-holder
    riser(0.0, 0.05, top_s, M2, root)

    L.collision_box("COL_Table", (W, Dd, cz + TT / 2), (0, 0, (cz + TT / 2) / 2), M, parent=root)
    return root


L.run("coffee_table", build)
