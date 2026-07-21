"""Pinehollow golf cart bag (ref: d5B6NL5g) — detailed, sized to fit a bag_rack bay.

Forest-green suede body with a black upper panel, tiered cream pockets with brass
zippers + brown pull-tabs, a full-length side apparel zipper, cream piping along the
seams, a brown mesh-divider cuff with brass rivets + D-ring, a padded strap with brass
clips, two black stand rods, and a molded tread base.  Body ~0.19 m wide so it drops
into a bag_rack bay (0.22 x 0.46 m mat, 0.25 m divider pitch).
"""
import sys
import math
sys.path.insert(0, "tools/blender")
import bpy
import bmesh
import lib_props as L
from mathutils import Vector


# ------------------------------------------------------------------ materials ----
def _fbm(rng, w, h, cells, octaves=5, gain=0.55):
    """Fractal (multi-octave) value noise — natural fine grain, not blocky blobs."""
    import numpy as np
    out = np.zeros((h, w), "float32")
    amp, total, c = 1.0, 0.0, float(cells)
    for _ in range(octaves):
        out = out + amp * L._vnoise(rng, w, h, max(1, int(round(c))), max(1, int(round(c))))
        total += amp
        amp *= gain
        c *= 2.0
    return out / total


def _hide_img(name, base_lin, *, mottle=0.10, pebble=0.0, seed=5, w=512, h=512):
    """Leather/suede albedo with natural multi-octave grain (linear -> sRGB)."""
    import numpy as np
    img = L._img(name, w, h)
    rng = np.random.default_rng(seed)
    base = np.array(base_lin, "float32")
    mott = (_fbm(rng, w, h, 12, 5) - 0.5) * (mottle * 2.0)
    peb = (_fbm(rng, w, h, 55, 4) - 0.5) * (pebble * 2.0)
    micro = (rng.random((h, w)).astype("float32") - 0.5) * 0.05
    val = np.clip(1.0 + mott + peb + micro, 0.64, 1.4)[..., None]
    lin = np.clip(base * val, 0, 1)
    L._write(img, np.concatenate([L.lin2srgb(lin), np.ones((h, w, 1), "float32")], axis=2))
    return img


def _rough_img(name, base_r, var, seed, w=512, h=512):
    """A non-colour roughness map (fractal) so highlights vary across the surface."""
    import numpy as np
    img = L._img(name, w, h)
    rng = np.random.default_rng(seed)
    r = np.clip(base_r + (_fbm(rng, w, h, 14, 5) - 0.5) * (var * 2.0)
                + (rng.random((h, w)).astype("float32") - 0.5) * 0.05, 0.08, 0.96).astype("float32")
    rgb = np.stack([r, r, r], -1)
    img.pixels[:] = np.concatenate([rgb, np.ones((h, w, 1), "float32")], axis=2).ravel().tolist()
    img.colorspace_settings.name = "Non-Color"
    img.update()
    img.pack()
    return img


def _pbr(name, img, *, roughness=0.7, metallic=0.0, sheen=0.0, coat=0.0, rough_img=None):
    """Principled material with optional fabric sheen / satin coat / roughness map."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    b.inputs["Metallic"].default_value = metallic
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.extension = "REPEAT"
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    if rough_img is not None:
        rt = nt.nodes.new("ShaderNodeTexImage")
        rt.image = rough_img
        rt.extension = "REPEAT"
        nt.links.new(rt.outputs["Color"], b.inputs["Roughness"])
    else:
        b.inputs["Roughness"].default_value = roughness
    for k, v in (("Sheen Weight", sheen), ("Coat Weight", coat), ("Coat Roughness", 0.3)):
        if v and k in b.inputs:
            b.inputs[k].default_value = v
    return m


def _brass_img(name, base_lin, seed=19, w=256, h=256):
    import numpy as np
    img = L._img(name, w, h)
    rng = np.random.default_rng(seed)
    base = np.array(base_lin, "float32")
    streak = np.repeat((rng.random((1, w)).astype("float32") - 0.5), h, axis=0) * 0.12
    mottle = (L._vnoise(rng, w, h, 10, 10) - 0.5) * 0.24
    val = np.clip(1.0 + streak + mottle, 0.6, 1.45)[..., None]
    lin = np.clip(base * val, 0, 1)
    L._write(img, np.concatenate([L.lin2srgb(lin), np.ones((h, w, 1), "float32")], axis=2))
    return img


def M2_local(M):
    return {
        "green": _pbr("M_BagGreen", _hide_img("BagGreen", (0.028, 0.074, 0.049), mottle=0.13, seed=3), rough_img=_rough_img("BagGreenR", 0.72, 0.18, 3), sheen=0.45),
        "greendk": _pbr("M_BagGreenDk", _hide_img("BagGreenDk", (0.019, 0.050, 0.035), mottle=0.18, seed=8), roughness=0.86, sheen=0.55),
        "cream": _pbr("M_BagCream", _hide_img("BagCream", (0.60, 0.53, 0.40), mottle=0.11, seed=5), rough_img=_rough_img("BagCreamR", 0.70, 0.16, 5), sheen=0.4),
        "brown": _pbr("M_BagBrown", _hide_img("BagBrown", (0.138, 0.074, 0.037), mottle=0.10, pebble=0.13, seed=7), rough_img=_rough_img("BagBrownR", 0.44, 0.24, 7), coat=0.28),
        "black": _pbr("M_BagBlack", _hide_img("BagBlack", (0.020, 0.020, 0.024), mottle=0.10, pebble=0.11, seed=11), rough_img=_rough_img("BagBlackR", 0.46, 0.22, 11), coat=0.22),
        "brass": L.mat_tex("M_BagBrass", _brass_img("BagBrass", (0.46, 0.33, 0.12)), roughness=0.30, metallic=0.92),
        "zipm": L.mat_tex("M_BagZip", _brass_img("BagZipM", (0.32, 0.25, 0.13), seed=23), roughness=0.38, metallic=0.88),
        "rubber": L.mat("M_BagRubber", (0.022, 0.022, 0.024), roughness=0.86),
        "thread": L.mat("M_BagThread", (0.09, 0.058, 0.032), roughness=0.5),
    }


# --------------------------------------------------------------------- helpers ---
def oval_tube(name, rx0, ry0, rx1, ry1, z0, z1, mat, root, segs=48):
    bm = bmesh.new()
    hgt = z1 - z0
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=rx0, radius2=rx1, depth=hgt)
    for v in bm.verts:
        t = (v.co.z + hgt / 2) / hgt
        rx = rx0 * (1 - t) + rx1 * t
        ry = ry0 * (1 - t) + ry1 * t
        if rx > 1e-6:
            v.co.y *= ry / rx
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.location = (0, 0, (z0 + z1) / 2)
    L._finish(o, mat, bevel=0.0, uv=True)
    L.parent_keep(o, root)
    return o


def pillow(name, dims, loc, mat, root, *, rot=(0, 0, 0), rnd=0.42, seg=5, uv=True):
    """A soft padded pad: a cube with every edge heavily rounded + smooth-shaded,
    so pockets/panels bulge organically instead of reading as hard blocks."""
    w, d, h = dims
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= w
        v.co.y *= d
        v.co.z *= h
    bm.normal_update()
    off = min(w, d, h) * min(0.49, rnd)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=off, segments=seg, profile=0.5, affect="EDGES")
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.rotation_euler = rot
    o.location = loc
    L._finish(o, mat, bevel=0.0, uv=uv, smooth=56)
    L.parent_keep(o, root)
    return o


def tube(name, pts, r, mat, root, *, verts=10, uv=True, caps=True):
    """A smooth tube following pts (a chain of cylinders + rounded joints/ends)."""
    P = [Vector(p) for p in pts]
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]
        mid = (a + b) * 0.5
        d = b - a
        if d.length < 1e-5:
            continue
        L.cyl(f"{name}_{i}", r, d.length * 1.06, (mid.x, mid.y, mid.z), mat, rot=d.to_track_quat("Z", "Y").to_euler(), verts=verts, parent=root, uv=uv)
    joints = P if caps else P[1:-1]
    for j, p in enumerate(joints):
        L.sphere(f"{name}_j{j}", r * 1.02, (p.x, p.y, p.z), mat, parent=root, segs=verts)


def ellipse_pts(rx, ry, n, phase=0.0):
    return [(rx * math.cos(2 * math.pi * i / n + phase), ry * math.sin(2 * math.pi * i / n + phase)) for i in range(n)]


def rivets(name, cx, cy, rx, ry, z, n, M, root, r=0.005):
    for i, (dx, dy) in enumerate(ellipse_pts(rx, ry, n)):
        nrm = Vector((dx / (rx * rx), dy / (ry * ry), 0)).normalized()
        L.cyl(f"{name}_{i}", r, 0.010, (cx + dx, cy + dy, z),
              M["brass"], rot=(math.atan2(nrm.y, 1) if False else 0, 0, 0), verts=8, parent=root)


def piping(name, pts, mat, root, r=0.004):
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        mid = (a + b) * 0.5
        d = b - a
        if d.length < 1e-5:
            continue
        L.cyl(f"{name}_{i}", r, d.length * 1.12, (mid.x, mid.y, mid.z), mat, rot=d.to_track_quat("Z", "Y").to_euler(), verts=7, parent=root)


def zipper(name, pts, M2, root, *, pull_t=0.62, pull_len=0.03, out=-1):
    """A thin antique-brass zipper line along pts, with a slider + hanging brown pull."""
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        mid = (a + b) * 0.5
        d = b - a
        if d.length < 1e-5:
            continue
        L.box(f"{name}_t{i}", (0.006, 0.004, d.length * 1.25), (mid.x, mid.y, mid.z), M2["zipm"], rot=d.to_track_quat("Z", "Y").to_euler(), bevel=0.0, parent=root)
    k = max(1, min(len(pts) - 2, int(pull_t * (len(pts) - 1))))
    p = Vector(pts[k])
    L.box(f"{name}_slider", (0.010, 0.008, 0.013), (p.x, p.y + out * 0.004, p.z), M2["brass"], bevel=0.003, parent=root)
    L.cyl(f"{name}_ring", 0.005, 0.006, (p.x, p.y + out * 0.010, p.z - 0.012), M2["brass"], rot=(math.radians(90), 0, 0), verts=8, parent=root)
    L.box(f"{name}_pull", (0.011, 0.006, pull_len), (p.x, p.y + out * 0.013, p.z - 0.018 - pull_len * 0.5), M2["brown"], bevel=0.003, parent=root)


def pocket(name, cx, cz, w, d, h, front_y, M2, root, *, face="cream", pipe="green", two_zip=False):
    """A soft padded pocket that bulges out of the body: a contrast piping pad behind
    a rounded face pad (both embedded into the body), with a thin arced brass zipper."""
    py = front_y - d * 0.30                          # back edge sinks ~0.2d into the body
    pillow(f"{name}_trim", (w + 0.018, d * 0.55, h + 0.018), (cx, py + d * 0.40, cz), M2[pipe], root, rnd=0.40)
    pillow(name, (w, d, h), (cx, py, cz), M2[face], root, rnd=0.46)
    # contrast stitching following the pocket face
    st = [(cx + math.cos(math.radians(a)) * (w * 0.5 - 0.013), py - d * 0.36, cz + math.sin(math.radians(a)) * (h * 0.5 - 0.013)) for a in range(0, 361, 20)]
    piping(f"{name}_st", st, M2["thread"], root, r=0.0013)
    zy = py - d * 0.44
    ztop = cz + h * 0.24
    arc = [(cx + (i / 8 - 0.5) * w * 0.78, zy - abs(i / 8 - 0.5) * 0.016, ztop + (0.5 - abs(i / 8 - 0.5)) * 0.010) for i in range(9)]
    if two_zip:
        zipper(f"{name}_zipA", arc, M2, root, pull_t=0.40)
        zipper(f"{name}_zipB", arc, M2, root, pull_t=0.58)
    else:
        zipper(f"{name}_zip", arc, M2, root, pull_t=0.72)


def build(M):
    M2 = M2_local(M)
    root = L.asset_root("golf_bag", (0.24, 0.34, 0.90))

    z0, z1 = 0.09, 0.80
    rxb, ryb, rxt, ryt = 0.076, 0.102, 0.090, 0.130     # slim oval, ~0.18 wide => fits a 0.22 bay

    def front_y(z):
        t = (z - z0) / (z1 - z0)
        return -(ryb + (ryt - ryb) * t)

    def side_x(z):
        t = (z - z0) / (z1 - z0)
        return rxb + (rxt - rxb) * t

    # ---- molded base: black tread shell + brown band + rivets + lift loop + feet ----
    L.rounded_box("BaseShell", (2 * rxb + 0.024, 2 * ryb + 0.024, 0.055), (0, 0, 0.028), M2["rubber"], corner=0.055, bevel=0.012, uv=True, parent=root)
    for tx in (-0.05, 0.0, 0.05):                                   # tread ribs underneath
        L.box(f"Tread_{tx:.2f}", (0.014, 2 * ryb - 0.02, 0.014), (tx, 0, 0.007), M2["rubber"], bevel=0.003, parent=root)
    L.rounded_box("BaseBlk", (2 * rxb + 0.02, 2 * ryb + 0.02, 0.05), (0, 0, 0.078), M2["black"], corner=0.055, bevel=0.01, uv=True, parent=root)
    L.rounded_box("BaseBand", (2 * rxb + 0.022, 2 * ryb + 0.022, 0.03), (0, 0, 0.095), M2["brown"], corner=0.055, bevel=0.008, uv=True, parent=root)
    rivets("BaseRiv", 0, 0, rxb + 0.008, ryb + 0.008, 0.095, 10, M2, root)
    L.box("BaseLoop", (0.05, 0.028, 0.045), (0, -ryb - 0.018, 0.11), M2["brown"], bevel=0.012, parent=root)

    # ---- body: clean two-tone oval tube (green lower, black upper) sharing a seam ----
    zsplit = 0.63
    tm = (zsplit - z0) / (z1 - z0)
    rxm = rxb + (rxt - rxb) * tm
    rym = ryb + (ryt - ryb) * tm
    oval_tube("BodyGreen", rxb, ryb, rxm, rym, z0, zsplit + 0.002, M2["green"], root)
    blk = oval_tube("BodyBlk", rxm, rym, rxt, ryt, zsplit, z1, M2["black"], root)
    # cream piping ring around the whole green/black seam
    ring = [(rxm * math.cos(math.radians(a)), rym * math.sin(math.radians(a)), zsplit) for a in range(0, 361, 18)]
    piping("SeamRing", ring, M2["cream"], root, r=0.0035)

    # ---- top: a REAL recessed club-divider well cut into the body (you look down into slots) ----
    well_floor = z1 - 0.085
    cutter = L.rounded_box("WellCut", (2 * (rxt - 0.019), 2 * (ryt - 0.019), 0.30), (0, 0, well_floor + 0.15), M2["black"], corner=ryt - 0.019, bevel=0.0, uv=False)
    L.activate(blk)
    mc = blk.modifiers.new("well", "BOOLEAN"); mc.operation = "DIFFERENCE"; mc.object = cutter; mc.solver = "EXACT"
    bpy.ops.object.modifier_apply(modifier=mc.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
    for p in blk.data.polygons:
        p.material_index = 0
    # dark velour floor + divider grid inside the cavity (the recess reads as club slots)
    L.rounded_box("WellFloor", (2 * (rxt - 0.021), 2 * (ryt - 0.021), 0.014), (0, 0, well_floor + 0.006), M2["greendk"], corner=ryt - 0.021, bevel=0.004, uv=True, parent=root)
    dz = (well_floor + z1) / 2 + 0.004
    dh = z1 - well_floor - 0.004
    for dx in (-0.052, 0.0, 0.052):                                  # dividers span to the walls
        L.box(f"DivV_{dx:.2f}", (0.006, 2 * (ryt - 0.010), dh), (dx, 0, dz), M2["greendk"], bevel=0.002, parent=root)
    L.box("DivH", (2 * (rxt - 0.010), 0.006, dh), (0, 0, dz), M2["greendk"], bevel=0.002, parent=root)
    # a sunken round putter well occupying one corner compartment
    L.cyl("PutterWell", 0.023, dh, (rxt - 0.056, ryt - 0.072, dz), M2["greendk"], verts=18, parent=root, uv=True)
    # brown cuff band around the rim (hole reveals the well below)
    cuff_z = z1 - 0.012
    cuff = L.rounded_box("Cuff", (2 * rxt + 0.008, 2 * ryt + 0.012, 0.058), (0, 0, cuff_z), M2["brown"], corner=0.068, bevel=0.012, uv=True, parent=root)
    hole = L.rounded_box("CuffHole", (2 * (rxt - 0.018), 2 * (ryt - 0.018), 0.14), (0, 0, cuff_z), M2["brown"], corner=ryt - 0.018, bevel=0.0, uv=False)
    L.activate(cuff)
    md = cuff.modifiers.new("cut", "BOOLEAN"); md.operation = "DIFFERENCE"; md.object = hole; md.solver = "EXACT"
    bpy.ops.object.modifier_apply(modifier=md.name)
    bpy.data.objects.remove(hole, do_unlink=True)
    for p in cuff.data.polygons:
        p.material_index = 0
    rivets("CuffRiv", 0, 0, rxt + 0.012, ryt + 0.012, cuff_z, 14, M2, root)
    cs = [((rxt + 0.006) * math.cos(math.radians(a)), (ryt + 0.006) * math.sin(math.radians(a)), cuff_z + 0.028) for a in range(0, 361, 14)]
    piping("CuffStitch", cs, M2["thread"], root, r=0.0013)
    for dx in (-1, 1):
        L.torus(f"DRing_{dx}", 0.015, 0.004, (dx * 0.03, -ryt - 0.008, cuff_z + 0.008), M2["brass"], rot=(math.radians(90), 0, 0), parent=root, mj=14, mn=7)

    # ---- tiered front pockets (flatter so they hug the body) + side apparel zipper ----
    pocket("PockUp", -0.012, 0.53, 0.128, 0.044, 0.145, front_y(0.53), M2, root, face="cream", pipe="green", two_zip=True)
    pocket("PockLo", -0.012, 0.31, 0.150, 0.050, 0.185, front_y(0.31), M2, root, face="cream", pipe="green")
    pocket("PockBot", -0.010, 0.155, 0.132, 0.044, 0.125, front_y(0.155), M2, root, face="green", pipe="cream")
    # long side apparel zipper on the green panel, below the seam
    fz = [(0.055, front_y(0.30 + i * 0.04) - 0.006, 0.30 + i * 0.04) for i in range(8)]
    zipper("SideZip", fz, M2, root, pull_t=0.5, pull_len=0.04)
    # valuables/accessory zipper across the black upper front (follows the body curve)
    rxc, ryc = side_x(0.735), -front_y(0.735)
    vz = [((i / 6 - 0.5) * 2 * rxc * 0.66, -ryc * math.sqrt(max(0.0, 1 - ((i / 6 - 0.5) * 1.32) ** 2)) - 0.004, 0.735) for i in range(7)]
    zipper("ValZip", vz, M2, root, pull_t=0.68, pull_len=0.03)
    # a row of brass tee-holder grommets on the bottom pocket
    for i in range(5):
        tx = -0.05 + i * 0.025
        L.cyl(f"Tee_{i}", 0.005, 0.014, (tx, front_y(0.155) - 0.05, 0.20), M2["brass"], rot=(math.radians(90), 0, 0), verts=8, parent=root)

    # ---- brown grab handle: a smooth padded tube arch on the black upper, ends embedded ----
    hyf = front_y(0.67) - 0.028
    hb = front_y(0.64) + 0.006
    hpts = [(-0.046, hb, 0.625), (-0.048, hyf + 0.006, 0.66), (-0.03, hyf, 0.688),
            (0.0, hyf - 0.004, 0.696), (0.03, hyf, 0.688), (0.048, hyf + 0.006, 0.66), (0.046, hb, 0.625)]
    tube("Handle", hpts, 0.013, M2["brown"], root, verts=10)

    # ---- padded shoulder strap draped down the LEFT SIDE (off the front pockets) ----
    P0, P1, P2 = Vector((-0.064, -0.03, 0.795)), Vector((-0.104, 0.02, 0.55)), Vector((-0.070, -0.018, 0.31))
    N = 14
    pts = [(1 - t) ** 2 * P0 + 2 * (1 - t) * t * P1 + t * t * P2 for t in (i / (N - 1) for i in range(N))]
    for i in range(N - 1):
        a, b = pts[i], pts[i + 1]
        mid = (a + b) * 0.5
        d = b - a
        eul = d.to_track_quat("Z", "Y").to_euler()
        mat = M2["brown"] if (i <= 1 or i >= N - 3) else M2["green"]
        L.box(f"Strap_{i}", (0.030, 0.014, d.length * 1.24), (mid.x, mid.y, mid.z), mat, rot=(eul.x, eul.y, eul.z), bevel=0.006, parent=root)
    for pp in (P0, P2):
        L.cyl(f"Clip_{pp.z:.2f}", 0.009, 0.028, (pp.x, pp.y, pp.z), M2["brass"], rot=(math.radians(90), 0, 0), verts=10, parent=root)
    L.box("StrapBuckle", (0.034, 0.016, 0.028), (pts[7].x, pts[7].y, pts[7].z), M2["brass"], bevel=0.004, parent=root)

    # ---- two straight parallel black stand rods along the back (+Y), clipped to the body ----
    rod_y = ryt - 0.012
    for ex in (-1, 1):
        L.cyl(f"Rod_{ex}", 0.007, 0.80, (ex * 0.05, rod_y, 0.44), M2["black"], verts=12, parent=root)
        L.cyl(f"RodFoot_{ex}", 0.012, 0.028, (ex * 0.05, rod_y, 0.05), M2["rubber"], verts=12, parent=root)
        L.sphere(f"RodCap_{ex}", 0.010, (ex * 0.05, rod_y, 0.842), M2["rubber"], parent=root, segs=10)
        for bz in (0.30, 0.58):                          # small clips tying each rod to the body
            L.box(f"RodClip_{ex}_{bz:.2f}", (0.013, 0.042, 0.010), (ex * 0.05, rod_y - 0.019, bz), M2["black"], bevel=0.002, parent=root)

    L.collision_box("COL", (2 * rxt + 0.03, 2 * ryt + 0.10, 0.86), (0, -0.02, 0.44), M, parent=root)
    return root


L.run("golf_bag", build)
