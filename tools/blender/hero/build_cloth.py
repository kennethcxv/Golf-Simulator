"""HERO ASSET — THE CLOTH AND SPONGE. A belt tool, drawn closest to the camera.

Both are SOFT SURFACE: no hard edges anywhere, because the one thing that gives
away a modelled sponge is a crisp corner. The sponge is a rounded block whose
faces bow outward the way compressed foam does; the cloth is a folded sheet with
a rolled edge at the fold and a soft wave along the free edges.

They are two objects and they must not be inside each other -- `assert_no_overlap`
is the inverse of the attachment check and it needs to be, because a cloth
resting against a sponge passes every "is it attached" test precisely BY
touching, and interpenetration is invisible from most angles since the buried
part is buried.

    blender --factory-startup -b --python tools/blender/hero/build_cloth.py -- [cycles] [break-overlap]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402

REPO = os.getcwd()
OUT_RENDER = os.path.join(REPO, "qa", "hero", "cloth")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "cloth_sponge.glb")

SPONGE = (0.112, 0.074, 0.044)      # a household sponge, mm-accurate
SCOUR_FRAC = 0.30                   # the green abrasive layer's share of height
CLOTH = (0.150, 0.115)              # folded footprint


def rounded_block(name, centre, size, roundness=0.34, cols=14, stacks=9):
    """A SUPERELLIPSOID -- a box with soft corners, not a sphere.

    The exponent is the whole thing. The first version used 1 - bulge = 0.84,
    which is within rounding distance of 1, and 1 is an ellipsoid: the sponge
    came out as an oval disc. A rounded box wants roughly 0.35, and the shape
    walks continuously from box to sphere as it rises to 1, so this is the one
    parameter that decides whether it reads as foam or as a pebble.
    """
    cx, cy, cz = centre
    hx, hy, hz = (v * 0.5 for v in size)
    e = roundness

    def p(val, ex):
        return math.copysign(abs(val) ** ex, val) if abs(val) > 1e-9 else 0.0

    verts, faces = [], []
    for i in range(stacks + 1):
        v = -math.pi / 2 + math.pi * i / stacks
        cv, sv = math.cos(v), math.sin(v)
        for j in range(cols):
            u = -math.pi + 2 * math.pi * j / cols
            cu, su = math.cos(u), math.sin(u)
            verts.append(Vector((
                cx + hx * p(cv, e) * p(cu, e),
                cy + hy * p(cv, e) * p(su, e),
                cz + hz * p(sv, e))))
    for i in range(stacks):
        for j in range(cols):
            a = i * cols + j
            b = i * cols + (j + 1) % cols
            faces.append((a, b, b + cols, a + cols))
    return HS.mesh_from(name, verts, faces, smooth=True)


def build_sponge(broken=False):
    """Two layers, a real part boundary: foam body and abrasive pad."""
    # ONE block, two materials split by height. Stacking a second solid on top
    # gave the scour pad a rim that overhung the body and read as a lid with a
    # seam -- a bonded abrasive layer is flush with the sides, and the only thing
    # that changes at the boundary is the surface.
    sponge = rounded_block("Sponge", (0, 0, SPONGE[2] * 0.5),
                           SPONGE, roundness=0.34, cols=44, stacks=27)
    pit_and_squash(sponge)
    return sponge


def pit_and_squash(ob):
    """Open-cell foam, and a sponge that has been used.

    A smooth superellipsoid is a bar of soap. What identifies foam is that its
    surface is PITTED -- open cells breaking the skin -- and pits sit on the
    silhouette, so a bump map cannot do it: at 44 x 27 the block carries them
    for 2,300 triangles. Three octaves, because one gives a golf ball.

    And a sponge in a bucket is not a machined solid. It has been squeezed:
    one long face bows in, the opposite one out, and the whole block leans a
    couple of degrees off square. Perfect symmetry is most of what made this
    read as a primitive with rounded corners.
    """
    import random
    rnd = random.Random(70154)
    # a fixed set of cell centres on the unit sphere, so the pitting is stable
    cells = []
    for _ in range(78):
        v = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
        if v.length < 1e-6:
            continue
        cells.append((v.normalized(), rnd.uniform(0.55, 1.0)))

    hx, hy, hz = (v * 0.5 for v in SPONGE)
    cz = SPONGE[2] * 0.5
    for vert in ob.data.vertices:
        p = vert.co
        d = Vector(((p.x) / hx, (p.y) / hy, (p.z - cz) / hz))
        n = d.normalized() if d.length > 1e-6 else Vector((0, 0, 1))
        # pits: a well wherever the surface passes near a cell centre
        pit = 0.0
        for (c, w) in cells:
            k = max(0.0, n.dot(c))
            pit = max(pit, w * (k ** 34.0))
        # a finer second octave so the skin is never locally smooth
        fine = (math.sin(p.x * 640.0 + 1.3) * math.sin(p.y * 590.0 - 0.4)
                * math.sin(p.z * 610.0 + 2.1))
        off = -0.0043 * pit - 0.00095 * fine
        # the squeeze: one flank in, the other out, and a slight lean
        off += 0.0022 * n.y * (1.0 - abs(n.z) ** 2)
        off -= 0.0014 * (n.x ** 2) * n.y
        vert.co = p + n * off
    ob.data.update()


def surface_material(name, colour, rough, scale, strength, dist, spread,
                     detail=6.0):
    """A cloth/foam material with a real surface: noise on the BUMP for the
    texture and a narrow tint either side on COLOUR for the microvariation.

    The apparel pass learned both halves of this the hard way. Bump alone
    leaves a panel facing the key at one flat value across its whole width;
    colour variation coarser than the yarn or the cell reads as staining.
    """
    mat = HS.pbr(name, colour, roughness=rough)
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = 0.58
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = dist
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    v = nt.nodes.new("ShaderNodeTexNoise")
    v.inputs["Scale"].default_value = scale * 0.42
    v.inputs["Detail"].default_value = 4.0
    t = nt.nodes.new("ShaderNodeMix")
    t.data_type = "RGBA"
    lo, hi = 1.0 - spread, 1.0 + spread
    t.inputs["A"].default_value = (colour[0] * lo, colour[1] * lo,
                                   colour[2] * lo, 1.0)
    t.inputs["B"].default_value = (colour[0] * hi, colour[1] * hi,
                                   colour[2] * hi, 1.0)
    nt.links.new(v.outputs["Fac"], t.inputs["Factor"])
    nt.links.new(t.outputs[2], b.inputs["Base Color"])
    return mat


def sweep_tube(name, pts, radius, sides=8):
    """A closed tube along a polyline. Used for the cloth's overlocked hem --
    the only edge detail a folded microfibre cloth actually has."""
    verts, faces = [], []
    n = len(pts)
    for i, p in enumerate(pts):
        tan = Vector(pts[min(n - 1, i + 1)]) - Vector(pts[max(0, i - 1)])
        tan = tan.normalized() if tan.length > 1e-9 else Vector((0, 1, 0))
        e1 = tan.cross(Vector((0, 0, 1)))
        if e1.length < 1e-6:
            e1 = tan.cross(Vector((1, 0, 0)))
        e1.normalize()
        e2 = tan.cross(e1).normalized()
        for k in range(sides):
            a = 2 * math.pi * k / sides
            verts.append(Vector(p) + e1 * (radius * math.cos(a))
                         + e2 * (radius * math.sin(a)))
    for i in range(n - 1):
        for k in range(sides):
            a = i * sides + k
            b = i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    return HS.mesh_from(name, verts, faces, smooth=True)


def build_cloth(broken=False):
    """A cloth FOLDED OVER ITSELF: two layers with a rolled fold at one end.

    The first version was a single wavy sheet, which reads as a rubber mat. What
    makes a folded cloth read is the fold edge -- a soft roll with the two layers
    running back from it and the free edges not quite aligned.
    """
    ox = SPONGE[0] * 0.5 + CLOTH[0] * 0.5 + 0.026
    STEPS, ROWS = 26, 11
    verts, faces = [], []
    for j in range(ROWS):
        t = j / (ROWS - 1)
        y = (t - 0.5) * CLOTH[1]
        wave = 0.0035 * math.sin(t * math.pi * 1.8)
        for i in range(STEPS):
            u = i / (STEPS - 1)
            if u < 0.44:                       # upper layer, running to the fold
                k = u / 0.44
                x = -CLOTH[0] * 0.5 + k * CLOTH[0] * 0.94
                z = 0.0125 + wave * (1 - k) * 0.6
            elif u < 0.56:                     # the fold: a half-round roll
                k = (u - 0.44) / 0.12
                a = math.pi * k
                x = CLOTH[0] * 0.44 + math.sin(a) * 0.0068
                z = 0.0072 + math.cos(a) * 0.0053
            else:                              # lower layer, running back
                k = (u - 0.56) / 0.44
                x = CLOTH[0] * 0.44 - k * CLOTH[0] * 0.90
                z = 0.0020 + wave * k * 0.4
            verts.append(Vector((ox + x, y, z)))
    for j in range(ROWS - 1):
        for i in range(STEPS - 1):
            a = j * STEPS + i
            faces.append((a, a + 1, a + STEPS + 1, a + STEPS))
    cloth = HS.mesh_from("Cloth", verts, faces, smooth=True)
    # A MICROFIBRE CLOTH HAS AN OVERLOCKED EDGE, and a real one does not lie
    # with its two free edges parallel. Both were missing and the render was a
    # flat blue slab: the hem is the only line on the object.
    hem = []
    for j in range(ROWS):
        t = j / (ROWS - 1)
        y = (t - 0.5) * CLOTH[1]
        hem.append(Vector((ox - CLOTH[0] * 0.5 + 0.0030 * math.sin(t * 5.1),
                           y, 0.0138 + 0.0035 * math.sin(t * math.pi * 1.8)
                           * 0.6)))
    stitch = sweep_tube("ClothHem", hem, 0.0016, sides=7)
    solid = cloth.modifiers.new("Thickness", "SOLIDIFY")
    solid.thickness = 0.0030
    solid.offset = 0.0
    solid.use_rim = True
    cloth = HS.apply_mods(cloth)
    if stitch is not None:
        bpy.ops.object.select_all(action='DESELECT')
        stitch.select_set(True)
        cloth.select_set(True)
        bpy.context.view_layer.objects.active = cloth
        bpy.ops.object.join()
    if broken:
        # THE DELIBERATELY BROKEN VARIANT: slide the cloth into the sponge. It
        # still looks like a cloth beside a sponge from three of eight angles,
        # which is exactly why interpenetration ships.
        cloth.location = Vector((-0.135, 0, 0.010))
        bpy.context.view_layer.update()
    return cloth


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = "break-overlap" in args
    suffix = "-BROKEN" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=160 if engine == "CYCLES" else 96)

    sponge = build_sponge()
    cloth = build_cloth(broken=broken)

    # MUTED, AND WITH A SURFACE. The first pass was flat saturated primary
    # colour on three smooth objects -- a toy sponge and a rubber mat. Real
    # retail cleaning stock is duller than that, and the thing that actually
    # identifies each of these is its SURFACE: open cells on the foam, coarse
    # matted fibre on the scour pad, a fine pile on the microfibre.
    # SCALE IS IN GENERATED SPACE, WHICH IS THE BOUNDING BOX -- 0 to 1, not
    # metres. 900 on a 112 mm sponge is eight noise cells per millimetre:
    # sub-pixel at any camera that shows the whole object, so it averaged to
    # flat and both objects rendered as untextured colour. About one cell per
    # millimetre is what the eye reads as foam or as pile, which on this
    # bounding box is 120-260.
    foam = surface_material("SpongeFoam", (0.520, 0.318, 0.036),
                            rough=0.96, scale=135.0, strength=0.46,
                            dist=0.0013, spread=0.20)
    scour = surface_material("SpongeScour", (0.020, 0.064, 0.030),
                             rough=0.94, scale=260.0, strength=0.70,
                             dist=0.0010, spread=0.30, detail=8.0)
    fabric = surface_material("ClothFabric", (0.034, 0.086, 0.128),
                              rough=0.975, scale=210.0, strength=0.26,
                              dist=0.00055, spread=0.10)
    sponge.data.materials.append(foam)
    sponge.data.materials.append(scour)
    cloth.data.materials.append(fabric)
    n_scour = 0
    for poly in sponge.data.polygons:
        if poly.center.z > SPONGE[2] * (1.0 - SCOUR_FRAC):
            poly.material_index = 1
            n_scour += 1
    print(f"  scour pad: {n_scour} of {len(sponge.data.polygons)} faces")
    if n_scour < 40:
        raise SystemExit("BUILD FAILED: the scour pad got no faces -- the pit "
                         "displacement has moved the top below the split")

    HS.assert_no_overlap(cloth, sponge, "the cloth must not be inside the sponge",
                         min_gap=0.0020)

    subject = [sponge, cloth]

    # UVs and the grain BEFORE the renders. Generated-space noise on a

    # diagonal shaft in a big bounding box runs the wood grain ACROSS the

    # timber, which is the one thing that says painted dowel.

    HS.unwrap_and_grain(subject)
    print(f"TRIS {H.triangles(subject)} ({len(subject)} objects, 3 materials) "
          f"— the hand is 5,179")
    lo, hi = H.bounds(subject)
    print(f"  overall {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} x "
          f"{(hi.z - lo.z) * 1000:.0f} mm")

    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.22)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, f"cloth{suffix}", views=8,
                     elevation=24.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"cloth{suffix}-turntable.png"), cols=4)
    for label, az, el in (("hero", -124, 30), ("side", 0, 10),
                          ("above", -90, 72), ("low", -90, 6)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"cloth{suffix}-{label}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject, cam,
                         os.path.join(OUT_RENDER, f"cloth{suffix}-silhouette.png"),
                         res=(900, 900))

    hfov = 2 * math.atan(math.tan(math.radians(66) / 2) * 16 / 9)
    d = (0.150 / 0.20) / (2 * math.tan(hfov / 2))
    app = H.camera_fov("Apparent", H.orbit_position(centre, d, -124, 26), centre, 66.0)
    app.data.sensor_fit = "VERTICAL"
    H.render(app, os.path.join(OUT_RENDER, f"cloth{suffix}-apparent.png"), res=(1600, 900))

    if not broken:
        HS.flatten_for_export(subject)
        H.bake_gltf_axis(subject)
        H.export_glb(subject, OUT_GLB)
        print(f"FINAL TRIS {H.triangles(subject)}")


# Guarded so the module can be IMPORTED without building. An unguarded main()
# meant every audit that imported a builder silently re-rendered and re-exported
# its asset as a side effect. Blender runs a --python script as __main__, so the
# command line is unchanged.
if __name__ == "__main__":
    main()
