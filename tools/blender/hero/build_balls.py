"""GOAL 27 REWORK, ITEM 2 — GOLF BALLS AND THEIR PACKAGING.

Reference: ref/balls/dimples.jpg (a ball at hand distance -- the dimples are
deep, they overlap, and they read as shadow not as texture) and
ref/balls/ball-boxes.jpg (glossy dark card, metallic type, colour blocking, a
feature list in a ruled column).

Three meshes:

  BALL     real geometry dimples, displaced into a dense sphere. A printed
           dimple pattern dies the moment the ball is lit from the side, and a
           ball is held at 18 inches.
  SLEEVE   a sleeve of three: a tall square tube, its four side panels mapped
           to a wrap whose type is set FOR that narrow panel.
  DOZEN    a dozen box: a wide shallow slab, its front, top and end mapped to a
           sheet whose type is set large across the long axis.

Faces are UV-mapped BY HAND, not smart-projected, because the whole point of
item 2 is that the type sits properly on the box it is printed on -- and a
smart-projected box puts the brand across a corner.

UNITS ARE YARDS.

    blender --factory-startup -b --python tools/blender/hero/build_balls.py -- \
        [cycles] [line=kestrel|longspur|vantage|halcyon] [break=lid|dimples]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402
import cloth_lib as CL  # noqa: E402

REPO = os.getcwd()
OUT_RENDER = os.path.join(REPO, "qa", "hero", "balls")
GLB_DIR = os.path.join(REPO, "Assets", "models", "hero")
TEX = os.path.join(REPO, "Assets", "models", "hero", "textures")

# A golf ball is 42.7 mm across; in yards that is 0.0467.
BALL_R = 0.02335
# A sleeve of three: 43 x 43 x 138 mm.
SLEEVE = (0.0470, 0.0470, 0.1510)
# A dozen box: 112 x 84 x 45 mm.
DOZEN = (0.1225, 0.0919, 0.0492)


def dimpled_ball(name, centre, radius=BALL_R, rings=54, seg=72,
                 dimples=232, depth=0.052, broken=False):
    """A sphere with dimples DISPLACED INTO IT, not printed on it.

    Dimple centres are a Fibonacci sphere, which is what gives a real ball its
    non-repeating pattern -- a lat/long grid of dimples reads as a beach ball
    because the rows line up at the poles.
    """
    cx, cy, cz = centre
    # dimple centres as unit vectors
    centres = []
    ga = math.pi * (3.0 - math.sqrt(5.0))
    for i in range(dimples):
        z = 1.0 - 2.0 * (i + 0.5) / dimples
        r = math.sqrt(max(0.0, 1.0 - z * z))
        a = ga * i
        centres.append(Vector((math.cos(a) * r, math.sin(a) * r, z)))
    # a dimple's angular radius, from packing the sphere with `dimples` caps
    cap = math.sqrt(4.0 / dimples) * 0.62

    def surf(n):
        if broken:
            return Vector((cx, cy, cz)) + n * radius
        best = max(n.dot(c) for c in centres)
        ang = math.acos(max(-1.0, min(1.0, best)))
        t = min(1.0, ang / cap)
        # a spherical cap profile, flat at the rim
        d = (1.0 - t * t) ** 1.35 * depth * radius
        return Vector((cx, cy, cz)) + n * (radius - d)

    # POLES ARE SINGLE VERTICES. A lat/long grid that repeats the pole `seg`
    # times leaves degenerate quads and a boundary edge loop, so the sphere is
    # not a closed surface and assert_assembly refuses to measure it -- which
    # is exactly what it did on the first build.
    verts, faces = [], []
    for j in range(1, rings):
        phi = math.pi * j / rings
        for i in range(seg):
            th = 2 * math.pi * i / seg
            verts.append(surf(Vector((math.sin(phi) * math.cos(th),
                                      math.sin(phi) * math.sin(th),
                                      math.cos(phi)))))
    north = len(verts)
    verts.append(surf(Vector((0, 0, 1))))
    south = len(verts)
    verts.append(surf(Vector((0, 0, -1))))
    for j in range(rings - 2):
        for i in range(seg):
            a = j * seg + i
            b = j * seg + (i + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    last = (rings - 2) * seg
    for i in range(seg):
        faces.append((north, (i + 1) % seg, i))
        faces.append((south, last + i, last + (i + 1) % seg))
    return HS.mesh_from(name, verts, faces, smooth=True)


def _uv_box(obj, by_normal):
    """Assign UVs BY MEASURED FACE NORMAL, not by index order.

    Indexing by polygon order put the front panel's artwork on the top of the
    dozen box: mesh_from recalculates normals, which can reorder the loops and
    the polygons, so the sixth face is not reliably the sixth face. The normal
    is a property of the geometry and cannot drift.

    `by_normal` maps ('bottom','top','front','back','left','right') to a quad.
    """
    axes = {"bottom": Vector((0, 0, -1)), "top": Vector((0, 0, 1)),
            "front": Vector((0, -1, 0)), "back": Vector((0, 1, 0)),
            "left": Vector((-1, 0, 0)), "right": Vector((1, 0, 0))}
    uv = obj.data.uv_layers.new(name="UVMap")
    for p in obj.data.polygons:
        n = p.normal
        key = max(axes, key=lambda k: n.dot(axes[k]))
        quad = by_normal[key]
        for k, li in enumerate(p.loop_indices):
            uv.data[li].uv = quad[k]


def rounded_box(name, centre, size, bevel=0.0030, uvs=None):
    """A carton: six quads in a known order, UV-MAPPED BEFORE THE CHAMFER.

    The bevel renumbers and splits polygons, so UVs assigned after it land on
    whichever face happens to hold that index -- the first build came out as
    plain orange and plain navy with no artwork anywhere on it. Mapping the six
    quads first and letting the bevel interpolate is the only order that works.
    """
    cx, cy, cz = centre
    hx, hy, hz = size[0] * 0.5, size[1] * 0.5, size[2] * 0.5
    v = [Vector((cx + sx * hx, cy + sy * hy, cz + sz * hz))
         for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
    # index: z*4 + y*2 + x
    faces = [
        (0, 1, 3, 2),      # 0 bottom
        (4, 6, 7, 5),      # 1 top
        (0, 4, 5, 1),      # 2 front  (-y)
        (2, 3, 7, 6),      # 3 back   (+y)
        (0, 2, 6, 4),      # 4 left   (-x)
        (1, 5, 7, 3),      # 5 right  (+x)
    ]
    obj = HS.mesh_from(name, v, faces, smooth=False)
    if uvs is not None:
        _uv_box(obj, uvs)
    mod = obj.modifiers.new("Bevel", "BEVEL")
    mod.width = bevel
    mod.segments = 2
    mod.limit_method = "ANGLE"
    return HS.apply_mods(obj)


def rect(u0, v0, u1, v1):
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


def sleeve(name, centre, broken=""):
    """A sleeve of three. The wrap is four panels in a row; the two wide faces
    get the printed panel, the two narrow ones the vertical strip."""
    P = 0.25
    uvs = {
        "bottom": rect(0.02 * P, 0.02, 0.98 * P, 0.06),
        "top": rect(0.02 * P, 0.94, 0.98 * P, 0.98),
        "front": rect(0 * P, 0.0, 1 * P, 1.0),      # printed panel
        "back": rect(3 * P, 0.0, 2 * P, 1.0),       # printed panel
        "left": rect(1 * P, 0.0, 2 * P, 1.0),       # vertical strip
        "right": rect(4 * P, 0.0, 3 * P, 1.0),      # vertical strip
    }
    return rounded_box(name, centre, SLEEVE, bevel=0.0022, uvs=uvs)


def dozen(name, centre, broken=""):
    """A dozen box. Front and top carry the artwork; the ends take the back
    strip, which is where a real box puts its feature list."""
    uvs = {
        "front": rect(0.0, 0.5, 0.625, 1.0),
        "top": rect(0.625, 0.5, 1.0, 1.0),
        "back": rect(0.625, 0.5, 0.0, 1.0),
        "left": rect(0.30, 0.0, 0.70, 0.5),
        "right": rect(0.70, 0.0, 0.30, 0.5),
        "bottom": rect(0.02, 0.02, 0.20, 0.16),
    }
    return rounded_box(name, centre, DOZEN, bevel=0.0026, uvs=uvs)


LINES = ("kestrel", "longspur", "vantage", "halcyon")


def build(line="kestrel", broken=""):
    p = {}
    p["ball"] = dimpled_ball("Ball", (0, 0, BALL_R),
                             broken=(broken == "dimples"))
    p["sleeve"] = sleeve("Sleeve", (0.0900, 0, SLEEVE[2] * 0.5))
    p["dozen"] = dozen("DozenBox", (-0.1250, 0, DOZEN[2] * 0.5))

    ball_mat = HS.pbr("BallCover", (0.905, 0.905, 0.880), roughness=0.30)
    p["ball"].data.materials.append(ball_mat)
    for key, tex in (("sleeve", f"ball_sleeve_{line}.png"),
                     ("dozen", f"ball_dozen_{line}.png")):
        mat = HS.pbr_textured(f"Carton_{key}", os.path.join(TEX, tex),
                              roughness=0.22)
        p[key].data.materials.append(mat)
    return p


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    line = next((x.split("=", 1)[1] for x in args if x.startswith("line=")),
                "kestrel")
    broken = next((x.split("=", 1)[1] for x in args if x.startswith("break=")), "")
    suffix = f"-BROKEN-{broken}" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=190 if engine == "CYCLES" else 96)
    p = build(line=line, broken=broken)
    mesh = {k: v for k, v in p.items() if hasattr(v, "data")}
    if not broken:
        HS.assert_all_one_piece(mesh, "balls: every part is one piece")
        # The three sit apart on a shelf, so nothing may touch anything --
        # require_attached off, and any contact at all is a fault.
        HS.assert_assembly(mesh, "balls: nothing may intersect",
                           require_attached=False)

    subject = list(mesh.values())
    print(f"balls: TRIS {H.triangles(subject)} in {len(subject)} parts, "
          f"3 materials (ball {H.triangles([p['ball']])})")
    for k in ("ball", "sleeve", "dozen"):
        lo, hi = H.bounds([p[k]])
        print(f"  {k:7s} {(hi.x - lo.x) * 1000:6.1f} x {(hi.y - lo.y) * 1000:6.1f} "
              f"x {(hi.z - lo.z) * 1000:6.1f} mm")

    centre, radius = H.subject_sphere(subject)
    LENS = 78.0
    dist = H.fit_distance(radius, LENS, res=(1000, 1000), margin=1.16)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)
    tt = H.turntable(centre, dist, OUT_RENDER, f"balls{suffix}", views=8,
                     elevation=20.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"balls{suffix}-turntable.png"))
    for label, az, el in (("hero", -120, 22), ("front", -90, 8),
                          ("top", -90, 62)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre,
                       lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"balls{suffix}-{label}.png"),
                 res=(1200, 1200))
    # the ball ALONE, at the size a hand holds it
    bc, br = H.subject_sphere([p["ball"]])
    bd = H.fit_distance(br, LENS, res=(1000, 1000), margin=1.05)
    cam = H.camera("ballclose", H.orbit_position(bc, bd, -120, 18), bc, lens=LENS)
    H.render(cam, os.path.join(OUT_RENDER, f"balls{suffix}-ball.png"),
             res=(1100, 1100))

    if not broken and engine == "CYCLES":
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(GLB_DIR, f"balls_{line}.glb"))


if __name__ == "__main__":
    main()
