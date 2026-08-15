"""HERO ASSET — THE CHECKOUT BAG (FrontDeskShoppingBag), on the counter.

A WHOLE FOODS PAPER GROCERY BAG: kraft brown, flat rectangular base, creased
side gussets, a rolled top rim, walls standing open and holding their shape. Not
a soft slumping sack.

ITS JOB IS TO BE A CONTAINER, so the interior volume is the deliverable and the
silhouette is not. Goods have been phasing into this bag across three playtests
because the counter layout clears a GUESSED rectangle (0.40 x 0.24 yd) while the
real object measures 0.54 x 0.45 — a keep-out 35% too narrow and 86% too shallow,
which is why a check comparing the layout against that same rect passed twice.

So this models the cavity as real geometry and MEASURES it. Every interior number
in the build output is read off the built mesh, never restated from the input
constants: a floor rectangle that comes from the same variable that drew the
floor proves nothing.

UNITS ARE YARDS, because the game's are. A 12 x 7 x 17 inch grocery bag is
0.3333 x 0.1944 x 0.4722 yd, and the game applies BAG_PRESENTATION_SCALE = 1.35
on top, so both figures are reported.

    blender --factory-startup -b --python tools/blender/hero/build_bag.py -- [cycles] [break-interior]
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
OUT_RENDER = os.path.join(REPO, "qa", "hero", "bag")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "checkout_bag.glb")

# ---- YARDS. A standard 12 x 7 x 17 inch kraft grocery sack.
WIDTH = 0.33333          # 12"
DEPTH = 0.19444          # 7"
HEIGHT = 0.47222         # 17"
WALL = 0.0042            # paper plus the stiffness a standing bag needs
CORNER = 0.0075          # the corner crease radius: nearly sharp
GUSSET = 0.0075          # how far the side-panel centre crease pulls in
RIM_ROLL = 0.0180        # the folded-over top band
GAME_SCALE = 1.35        # BAG_PRESENTATION_SCALE, applied by the game
# What the checkout has to be able to drop in.
LOAD = (0.190, 0.115, 0.230)

STEPS_LONG = 7           # points along each long wall
STEPS_SHORT = 7          # points along each short wall


def section(z, inset=0.0, flare=0.0, crease=True):
    """A rounded RECTANGLE with creases -- not a superellipse.

    The superellipse used before made a soft-cornered tube that read as a leather
    tote. A grocery bag is a folded rectangle: four hard corner creases and a
    centre crease down each side panel, which is what the gusset leaves behind
    when the bag is opened out.
    """
    hw = WIDTH * 0.5 - inset + flare
    hd = DEPTH * 0.5 - inset + flare
    r = max(0.0006, CORNER - inset * 0.5)
    pts = []

    def corner(cx, cy, a0, a1, n=3):
        for k in range(n):
            a = a0 + (a1 - a0) * (k / (n - 1))
            pts.append(Vector((cx + math.cos(a) * r, cy + math.sin(a) * r, z)))

    def wall(x0, y0, x1, y1, n, axis):
        for k in range(1, n):
            t = k / n
            x = x0 + (x1 - x0) * t
            y = y0 + (y1 - y0) * t
            if crease:
                # A SHARP V, not a dimple. At 3 mm with a wide falloff the
                # gusset was invisible and the side panels read as flat plastic;
                # the crease on a real bag is a hard fold down the panel centre.
                pull = GUSSET * max(0.0, 1.0 - abs(t - 0.5) * 2.2)
                if axis == "x":
                    y -= math.copysign(pull, y)
                else:
                    x -= math.copysign(pull, x)
            pts.append(Vector((x, y, z)))

    corner(hw - r, hd - r, 0.0, math.pi / 2)
    wall(hw - r, hd, -(hw - r), hd, STEPS_LONG, "x")
    corner(-(hw - r), hd - r, math.pi / 2, math.pi)
    wall(-hw, hd - r, -hw, -(hd - r), STEPS_SHORT, "y")
    corner(-(hw - r), -(hd - r), math.pi, math.pi * 1.5)
    wall(-(hw - r), -hd, hw - r, -hd, STEPS_LONG, "x")
    corner(hw - r, -(hd - r), math.pi * 1.5, math.pi * 2)
    wall(hw, -(hd - r), hw, hd - r, STEPS_SHORT, "y")
    return pts


# ---- USE, not damage. The bag read as a CAD box: perfectly symmetric walls, a
# rim that was an exact rectangle, gussets creased identically on both sides. A
# real grocery bag has been folded flat, opened out and carried, and none of
# those survive it. All of the following is DETERMINISTIC -- reproducible builds
# matter more than statistically good noise, so it is a fixed harmonic sum
# rather than anything seeded by a clock.
USE_BOW = 0.0105         # how far a wall panel bows in or out at mid-height
USE_RIM = 0.0068         # how far the rim wanders off a true rectangle
USE_LEAN = 0.0060        # the whole carrier leans, because bags do
FOLD_H = 0.0016          # the ridge left by having been flattened


def use_offset(i, n, z_t):
    """A smooth, continuous bow around the section and up the height."""
    ang = 2 * math.pi * i / n
    bow = (0.60 * math.sin(ang * 2 + 0.70)
           + 0.40 * math.sin(ang * 3 - 1.90)
           + 0.30 * math.sin(ang * 5 + 2.60))
    # bows most in the middle of the height and vanishes at the base and rim,
    # which is where a bag is actually stiff
    return bow * math.sin(math.pi * min(1.0, max(0.0, z_t)))


def used(pts, z_t, bow=USE_BOW, rim=0.0, lean=USE_LEAN):
    n = len(pts)
    out = []
    for i, p in enumerate(pts):
        r = Vector((p.x, p.y))
        d = bow * use_offset(i, n, z_t)
        if rim:
            # NON-harmonic frequencies. A single sin(4*theta) gave four
            # symmetric lobes and read as a designed scallop rather than an
            # edge that has been handled; incommensurate terms never repeat
            # around the section.
            u = 2 * math.pi * i / n
            d += rim * (math.sin(u * 3.7 + 0.90)
                        + 0.62 * math.sin(u * 6.3 - 2.10)
                        + 0.38 * math.sin(u * 9.1 + 1.35)) * 0.62
        nrm = r.normalized() if r.length > 1e-6 else Vector((1, 0))
        out.append(Vector((p.x + nrm.x * d + lean * z_t * z_t,
                           p.y + nrm.y * d + lean * 0.45 * z_t * z_t,
                           p.z + (rim * 0.42 * (
                               math.sin(2 * math.pi * i / n * 2.3 - 1.10)
                               + 0.55 * math.sin(2 * math.pi * i / n * 5.7 + 0.30))
                               if rim else 0.0))))
    return out


def loft(name, rings, close_bottom=True, close_top=False, smooth=False):
    n = len(rings[0])
    verts, faces = [], []
    for r in rings:
        verts.extend(r)
    for r in range(len(rings) - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append((r * n + i, r * n + j, (r + 1) * n + j, (r + 1) * n + i))
    if close_bottom:
        faces.append(tuple(range(n - 1, -1, -1)))
    if close_top:
        b = (len(rings) - 1) * n
        faces.append(tuple(range(b, b + n)))
    return HS.mesh_from(name, verts, faces, smooth=smooth)


def build(broken=False):
    parts = {}

    # ---- the carrier. Walls essentially vertical with a whisper of flare, then
    # a rolled rim: out, up, and back down, which is the fold that makes a paper
    # bag hold its mouth open instead of slumping.
    rings = []
    for (t, flare) in ((0.000, 0.0), (0.030, 0.0006), (0.300, 0.0016),
                       (0.620, 0.0022), (0.880, 0.0024), (0.955, 0.0022)):
        rings.append(used(section(HEIGHT * t, flare=flare), t))
    for (t, f, rim) in ((0.985, 0.30, 0.8), (1.000, 0.42, 1.0),
                        (0.985, 0.52, 0.9), (0.952, 0.46, 0.6)):
        rings.append(used(section(HEIGHT * t, flare=0.0022 + RIM_ROLL * f),
                          t, rim=USE_RIM * rim))
    outer = loft("BagOuter", rings)
    HS.wrap_uvs(outer, rings)
    solid = outer.modifiers.new("Paper", "SOLIDIFY")
    solid.thickness = WALL
    solid.offset = 1.0
    solid.use_rim = True
    parts["bag"] = HS.apply_mods(outer)

    # ---- THE CAVITY, as its own closed mesh. This is the deliverable.
    # 0.060, not 0.030. Units are YARDS here, so a 0.030 shrink left 4.7 of
    # clearance and the broken variant passed -- a broken variant that does not
    # break is worth nothing, and it only showed up because it was run first.
    shrink = 0.060 if broken else 0.0
    # THE SAME deformation, so the measured cavity is the cavity of the bag
    # that now has a slump in it. Bowing only the outer shell would have left
    # the interior numbers describing a bag that no longer exists.
    inner_rings = []
    for (t, flare) in ((0.0, 0.0), (0.30, 0.0016), (0.62, 0.0022), (0.93, 0.0024)):
        inner_rings.append(used(
            section(WALL + (HEIGHT * 0.950 - WALL) * t,
                    inset=WALL + shrink, flare=flare), t * 0.95))
    interior = loft("BagInterior", inner_rings, close_top=True)
    parts["interior"] = interior

    # ---- the fold ridges left by having been flattened. The bag lies on its
    # face at the checkout counter, so its base is on camera.
    parts["folds"] = [HS.apply_mods(HS.box(
        f"BaseFold_{k}", (0, sy * DEPTH * 0.170, FOLD_H * 0.35),
        (WIDTH * 0.92, 0.0060, FOLD_H * 2.0), bevel=0.0006, segments=1))
        for k, sy in enumerate((-1, 1))]

    # ---- handles: flat kraft ribbon, both ends glued inside the rim
    handles = []
    for side in (-1, 1):
        pts, faces = [], []
        STEPS, RING = 13, 6
        for s in range(STEPS):
            t = s / (STEPS - 1)
            a = math.pi * t
            cx = math.cos(a) * (WIDTH * 0.27)
            cz = HEIGHT * 0.952 - 0.014 + math.sin(a) * (HEIGHT * 0.23)
            cy = side * (DEPTH * 0.5 - GUSSET * 0.4)
            dirv = Vector((-math.sin(a), 0, math.cos(a)))
            u = Vector((0, 1, 0))
            v = dirv.cross(u).normalized()
            for k in range(RING):
                b = 2 * math.pi * k / RING
                # a flat ribbon, not a cord
                # Flat kraft RIBBON: 1.8 thin against the panel, 10.5 wide.
                # At 2.6 x 7.2 it still read as round cord.
                pts.append(Vector((cx, cy, cz))
                           + u * (math.cos(b) * 0.0018)
                           + v * (math.sin(b) * 0.0105))
        for s in range(STEPS - 1):
            for k in range(RING):
                q = (k + 1) % RING
                faces.append((s * RING + k, s * RING + q,
                              (s + 1) * RING + q, (s + 1) * RING + k))
        faces.append(tuple(range(RING - 1, -1, -1)))
        base = (STEPS - 1) * RING
        faces.append(tuple(range(base, base + RING)))
        handles.append(HS.mesh_from(f"BagHandle_{'F' if side < 0 else 'B'}",
                                    pts, faces, smooth=True))
    parts["handles"] = handles

    kraft = HS.pbr_textured(
        "BagKraft",
        os.path.join(REPO, "Assets", "models", "hero", "textures",
                     "checkout_bag_print.png"),
        roughness=0.97)
    cord = HS.pbr("BagHandleKraft", (0.165, 0.086, 0.034), roughness=0.98)
    inner = HS.pbr("BagInner", (0.120, 0.062, 0.024), roughness=0.97)
    parts["bag"].data.materials.append(kraft)
    interior.data.materials.append(inner)
    for h in handles + parts["folds"]:
        h.data.materials.append(cord)
    return parts


def measure_interior(interior):
    """Read the cavity off the MESH.

    Floor rectangle, wall height, opening rectangle -- each measured from the
    vertices that are actually there, so the numbers cannot be a restatement of
    the constants that drew it. That distinction is the whole reason this asset
    exists: the bug in the game is a layout clearing a rectangle somebody wrote
    down rather than the shape the goods have to go into.
    """
    vs = [interior.matrix_world @ v.co for v in interior.data.vertices]
    zs = sorted(v.z for v in vs)
    z_lo, z_hi = zs[0], zs[-1]

    def rect_at(z, band=0.004):
        near = [v for v in vs if abs(v.z - z) <= band]
        if not near:
            return None
        return (max(v.x for v in near) - min(v.x for v in near),
                max(v.y for v in near) - min(v.y for v in near))

    return {"floor": rect_at(z_lo), "opening": rect_at(z_hi),
            "height": z_hi - z_lo}


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = "break-interior" in args
    suffix = "-BROKEN" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=160 if engine == "CYCLES" else 96)
    p = build(broken=broken)

    for f in p["folds"]:
        HS.assert_touching(f, p["bag"], "a base fold must be on the bag", 0.0025)
    HS.assert_fits_inside(p["interior"], LOAD,
                          "the bag has to hold what checkout packs into it",
                          margin=0.0040)
    for h in p["handles"]:
        HS.assert_touching(h, p["bag"], "a handle must be attached to the bag",
                           max_gap=0.0025)

    m = measure_interior(p["interior"])
    lo, hi = H.bounds([p["bag"]] + p["handles"])
    ex, ey = hi.x - lo.x, hi.y - lo.y
    print("")
    print("  === THE INTERIOR, measured off the cavity mesh (YARDS) ===")
    print(f"  floor rectangle    {m['floor'][0]:.4f} x {m['floor'][1]:.4f}"
          f"   at game scale {m['floor'][0]*GAME_SCALE:.4f} x {m['floor'][1]*GAME_SCALE:.4f}")
    print(f"  opening rectangle  {m['opening'][0]:.4f} x {m['opening'][1]:.4f}"
          f"   at game scale {m['opening'][0]*GAME_SCALE:.4f} x {m['opening'][1]*GAME_SCALE:.4f}")
    print(f"  usable wall height {m['height']:.4f}"
          f"                  at game scale {m['height']*GAME_SCALE:.4f}")
    print(f"  exterior footprint {ex:.4f} x {ey:.4f}"
          f"   at game scale {ex*GAME_SCALE:.4f} x {ey*GAME_SCALE:.4f}")
    print(f"  the authored keep-out is 0.40 x 0.24 — this bag needs "
          f"{ex*GAME_SCALE:.3f} x {ey*GAME_SCALE:.3f}")
    print("")

    subject = [p["bag"]] + p["handles"] + p["folds"]
    print(f"TRIS {H.triangles(subject)} ({len(subject)} objects, 2 materials) "
          f"— the hand is 5,179")

    p["interior"].hide_render = True
    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.20)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, f"bag{suffix}", views=8,
                     elevation=18.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"bag{suffix}-turntable.png"), cols=4)
    # The PRINTED FACE is the +Y panel, so the hero camera has to be on +Y. At
    # -124 it was looking at the back panel and judging the artwork off the
    # smaller mark -- the same wrong-side fault as the spray bottle.
    for label, az, el in (("hero", 118, 26), ("front", 90, 8),
                          ("into", 90, 64), ("side", 0, 8)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"bag{suffix}-{label}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject, cam,
                         os.path.join(OUT_RENDER, f"bag{suffix}-silhouette.png"),
                         res=(900, 900))

    hfov = 2 * math.atan(math.tan(math.radians(66) / 2) * 16 / 9)
    d = (WIDTH * GAME_SCALE / 0.30) / (2 * math.tan(hfov / 2))
    app = H.camera_fov("Apparent", H.orbit_position(centre, d, 118, 22), centre, 66.0)
    app.data.sensor_fit = "VERTICAL"
    H.render(app, os.path.join(OUT_RENDER, f"bag{suffix}-apparent.png"), res=(1600, 900))

    if not broken and engine == "CYCLES":
        H.bake_gltf_axis(subject)
        H.export_glb(subject, OUT_GLB)
        print(f"FINAL TRIS {H.triangles(subject)}")


main()
