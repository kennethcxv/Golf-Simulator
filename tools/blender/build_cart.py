"""Pinehollow utility cart — 2-tier olive service cart on casters (ref: cuqdMiqA).

A careful, detailed build: rounded-corner recessed trays with a rolled rim, four
square gunmetal posts with bolt pairs at every tray corner, an angled tubular
handle with a rubber grip, and detailed swivel casters (olive hubs + brass brakes).
"""
import sys
import math
sys.path.insert(0, "tools/blender")
import bpy
import bmesh
import lib_props as L


def _lin2srgb(c):
    """Encode a linear albedo field to sRGB — _write tags images sRGB, so authoring
    in linear and converting here makes the render decode back to the intended value."""
    import numpy as np
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055).astype("float32")


def _warm_metal_img(name, base_lin, tint, w=256, h=256):
    """Brushed warm anthracite (authored in linear): subtle vertical brush + mottle."""
    import numpy as np
    img = L._img(name, w, h)
    rng = np.random.default_rng(7)
    streak = np.repeat((rng.random((1, w)).astype("float32") - 0.5), h, axis=0) * 0.24
    mottle = (L._vnoise(rng, w, h, 11, 11) - 0.5) * 0.30
    fine = (rng.random((h, w)).astype("float32") - 0.5) * 0.10
    val = np.clip(1.0 + streak + mottle + fine, 0.6, 1.5)[..., None]
    lin = np.clip(base_lin * np.array(tint, "float32") * val, 0, 1)
    L._write(img, np.concatenate([_lin2srgb(lin), np.ones((h, w, 1), "float32")], axis=2))
    return img


def _olive_img(name="CartOlivePaint", w=256, h=256):
    """Satin olive-drab paint (authored in linear): tone drift + orange-peel + speckle."""
    import numpy as np
    img = L._img(name, w, h)
    rng = np.random.default_rng(3)
    base = np.array([0.138, 0.152, 0.094], "float32")
    drift = (L._vnoise(rng, w, h, 5, 5) - 0.5) * 0.20
    peel = (L._vnoise(rng, w, h, 48, 48) - 0.5) * 0.10
    fine = (rng.random((h, w)).astype("float32") - 0.5) * 0.04
    val = np.clip(1.0 + drift + peel + fine, 0.74, 1.26)[..., None]
    lin = np.clip(base * val, 0, 1)
    L._write(img, np.concatenate([_lin2srgb(lin), np.ones((h, w, 1), "float32")], axis=2))
    return img


def _rubber_img(name="CartRubberTex", w=192, h=192):
    """Matte black rubber (authored in linear): fine grain + faint mottle."""
    import numpy as np
    img = L._img(name, w, h)
    rng = np.random.default_rng(11)
    base = np.array([0.030, 0.030, 0.033], "float32")
    grain = (rng.random((h, w)).astype("float32") - 0.5) * 0.06
    mott = (L._vnoise(rng, w, h, 24, 24) - 0.5) * 0.03
    val = np.clip(1.0 + grain + mott, 0.5, 1.6)[..., None]
    lin = np.clip(base * val, 0, 1)
    L._write(img, np.concatenate([_lin2srgb(lin), np.ones((h, w, 1), "float32")], axis=2))
    return img


def M_local():
    gun_img = _warm_metal_img("CartGun", 0.085, (1.14, 1.02, 0.86))
    gun2_img = _warm_metal_img("CartGun2", 0.115, (1.10, 1.03, 0.90))
    return {
        "olive": L.mat_tex("M_CartOlive", _olive_img(), roughness=0.47, metallic=0.05),
        "gun": L.mat_tex("M_CartGun", gun_img, roughness=0.43, metallic=0.58),
        "gun2": L.mat_tex("M_CartGun2", gun2_img, roughness=0.34, metallic=0.72),
        "rubber": L.mat_tex("M_CartRubber", _rubber_img(), roughness=0.86, metallic=0.0),
        "brass": L.mat("M_CartBrass", (0.66, 0.49, 0.19), roughness=0.26, metallic=0.92),
        "bolt": L.mat("M_CartBolt", (0.120, 0.110, 0.096), roughness=0.32, metallic=0.75),
    }


def _rbox(name, w, d, h, corner, z):
    """A rounded-rect prism (vertical corners rounded), centred at (0,0,z)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= w
        v.co.y *= d
        v.co.z *= h
    bm.normal_update()
    if corner > 0:
        vedges = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > h * 0.4]
        bmesh.ops.bevel(bm, geom=vedges, offset=corner, segments=6, profile=0.5, affect="EDGES")
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.location = (0, 0, z)
    return o


def tray_pan(name, cz, w, d, M, root):
    """A pressed-steel tray: rounded corners, recessed floor, rolled rim (boolean-cut)."""
    rim, wall, floor_t, corner = 0.052, 0.016, 0.012, 0.026
    blank = _rbox(name, w, d, rim, corner, cz)
    blank.data.materials.append(M["olive"])
    cav = _rbox(name + "_cav", w - 2 * wall, d - 2 * wall, rim, max(0.004, corner - wall), cz + floor_t)
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
    b2 = blank.modifiers.new("b", "BEVEL")
    b2.width = 0.004
    b2.segments = 2
    b2.limit_method = "ANGLE"
    b2.angle_limit = math.radians(50)
    bpy.ops.object.modifier_apply(modifier=b2.name)
    L.activate(blank)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    try:
        L.activate(blank)
        bpy.ops.object.shade_auto_smooth(angle=math.radians(46))
    except Exception:
        pass
    L.parent_keep(blank, root)
    return blank


def caster(name, x, y, brake_dir, M, root):
    """Detailed swivel caster: chunky black tyre, olive hub + dark cap, gunmetal fork + swivel, ridged brass brake."""
    wr = 0.056
    axis = (0, math.radians(90), 0)
    L.cyl(f"{name}_tyre", wr, 0.033, (x, y, wr), M["rubber"], rot=axis, verts=34, parent=root, bevel=0.011, uv=True)
    L.cyl(f"{name}_hub", wr * 0.58, 0.037, (x, y, wr), M["olive"], rot=axis, verts=30, parent=root, bevel=0.003, uv=True)
    L.cyl(f"{name}_cap", 0.013, 0.041, (x, y, wr), M["bolt"], rot=axis, verts=14, parent=root)
    # fork/yoke — compact, straddling the wheel
    for ex in (-1, 1):
        L.box(f"{name}_fork{ex}", (0.010, 0.058, wr * 1.15), (x + ex * 0.025, y, wr + 0.024), M["gun2"], bevel=0.003, parent=root)
    L.box(f"{name}_forkTop", (0.060, 0.058, 0.020), (x, y, wr + 0.066), M["gun2"], bevel=0.004, parent=root)
    # swivel bearing + mount plate (post sits on this)
    L.cyl(f"{name}_swivel", 0.028, 0.024, (x, y, wr + 0.083), M["gun2"], verts=24, parent=root, uv=True)
    L.box(f"{name}_plate", (0.05, 0.05, 0.013), (x, y, wr + 0.10), M["gun"], bevel=0.003, parent=root)
    # brass total-lock brake pedal (ridged), angled out on `brake_dir` (-Y front / +Y back)
    by = y + brake_dir * (wr + 0.014)
    L.box(f"{name}_brake", (0.038, 0.058, 0.011), (x, by, 0.030), M["brass"], rot=(math.radians(26 * brake_dir), 0, 0), bevel=0.002, parent=root)
    for r in range(3):
        L.box(f"{name}_brR{r}", (0.038, 0.006, 0.005), (x, by + brake_dir * (-0.014 + r * 0.014), 0.036), M["brass"], rot=(math.radians(26 * brake_dir), 0, 0), parent=root)
    return wr + 0.107


def studs(name, x, y, z, nx, ny, M, root):
    """Two bolt heads on the outward X face (nx) and/or the outward Y face (ny) of a post."""
    if nx:
        for dz in (-0.020, 0.020):
            L.cyl(f"{name}_x{dz:.3f}", 0.008, 0.010, (x + nx * 0.021, y, z + dz), M["bolt"], rot=(0, math.radians(90), 0), verts=12, parent=root)
    if ny:
        for dz in (-0.020, 0.020):
            L.cyl(f"{name}_y{dz:.3f}", 0.008, 0.010, (x, y + ny * 0.023, z + dz), M["bolt"], rot=(math.radians(90), 0, 0), verts=12, parent=root)


def build(M0):
    M = M_local()
    root = L.asset_root("cart", (0.82, 0.46, 0.90))
    px, py = 0.328, 0.212
    tw, td = 0.616, 0.40
    bot_z, top_z = 0.32, 0.68

    mount = 0.0
    for sx in (-1, 1):
        for sy in (-1, 1):
            mount = caster(f"Cast_{sx}{sy}", sx * px, sy * py, sy, M, root)

    # four square posts + top caps, a square collar-bracket + bolt pairs at each tray corner
    post_top = 0.72
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * px, sy * py
            L.box(f"Post_{sx}{sy}", (0.028, 0.032, post_top - mount), (x, y, (mount + post_top) / 2), M["gun"], bevel=0.004, parent=root)
            L.box(f"Cap_{sx}{sy}", (0.036, 0.040, 0.014), (x, y, post_top + 0.004), M["gun2"], bevel=0.004, parent=root)
            for tz in (bot_z, top_z):
                L.box(f"Collar_{sx}{sy}_{tz:.2f}", (0.037, 0.041, 0.078), (x, y, tz), M["gun2"], bevel=0.005, parent=root)
                studs(f"Bolt_{sx}{sy}_{tz:.2f}", x, y, tz, sx, sy, M, root)

    # trays
    tray_pan("TrayBot", bot_z, tw, td, M, root)
    tray_pan("TrayTop", top_z, tw, td, M, root)

    # angled tubular handle at the -X end with a rubber grip (nearly upright, slight push-lean)
    hz = 0.81
    hx = -px - 0.040
    for sy in (-1, 1):
        y = sy * py
        dx, dz = (hx - (-px)), (hz - (post_top - 0.01))
        length = math.hypot(dx, dz)
        L.cyl(f"HUp_{sy}", 0.015, length + 0.03, ((-px + hx) / 2, y, (post_top - 0.01 + hz) / 2), M["gun"], rot=(0, math.atan2(dx, dz), 0), verts=18, parent=root, uv=True)
    L.cyl("HBar", 0.015, 2 * py + 0.03, (hx, 0, hz), M["gun"], rot=(math.radians(90), 0, 0), verts=18, parent=root, uv=True)
    L.cyl("Grip", 0.020, 0.33, (hx, 0, hz), M["rubber"], rot=(math.radians(90), 0, 0), verts=26, parent=root, bevel=0.004, uv=True)
    for sy in (-1, 1):
        L.cyl(f"GripCap_{sy}", 0.021, 0.012, (hx, sy * 0.165, hz), M["gun2"], rot=(math.radians(90), 0, 0), verts=16, parent=root, uv=True)

    L.collision_box("COL_Cart", (0.74, 0.46, post_top), (0, 0, post_top / 2), M0, parent=root)
    L.collision_box("COL_Handle", (0.13, 2 * py, 0.22), (hx, 0, hz - 0.09), M0, parent=root)
    return root


L.run("cart", build)
