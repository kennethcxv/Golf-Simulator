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
    body_h = SPONGE[2] * (1 - SCOUR_FRAC)
    # ONE block, two materials split by height. Stacking a second solid on top
    # gave the scour pad a rim that overhung the body and read as a lid with a
    # seam -- a bonded abrasive layer is flush with the sides, and the only thing
    # that changes at the boundary is the surface.
    sponge = rounded_block("Sponge", (0, 0, SPONGE[2] * 0.5),
                           SPONGE, roundness=0.34, cols=18, stacks=11)
    return sponge


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
    solid = cloth.modifiers.new("Thickness", "SOLIDIFY")
    solid.thickness = 0.0030
    solid.offset = 0.0
    solid.use_rim = True
    cloth = HS.apply_mods(cloth)
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

    foam = HS.pbr("SpongeFoam", (0.620, 0.360, 0.022), roughness=0.95)
    scour = HS.pbr("SpongeScour", (0.014, 0.062, 0.026), roughness=0.92)
    fabric = HS.pbr("ClothFabric", (0.016, 0.070, 0.115), roughness=0.97)
    sponge.data.materials.append(foam)
    sponge.data.materials.append(scour)
    cloth.data.materials.append(fabric)
    for poly in sponge.data.polygons:
        if poly.center.z > SPONGE[2] * (1.0 - SCOUR_FRAC):
            poly.material_index = 1

    HS.assert_no_overlap(cloth, sponge, "the cloth must not be inside the sponge",
                         min_gap=0.0020)

    subject = [sponge, cloth]
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
        H.bake_gltf_axis(subject)
        H.export_glb(subject, OUT_GLB)
        print(f"FINAL TRIS {H.triangles(subject)}")


# Guarded so the module can be IMPORTED without building. An unguarded main()
# meant every audit that imported a builder silently re-rendered and re-exported
# its asset as a side effect. Blender runs a --python script as __main__, so the
# command line is unchanged.
if __name__ == "__main__":
    main()
