"""HERO ASSET 11 — THE CUSTOMER BASKET.

The hand-carry basket shoppers take round the floor. A SEPARATE object from the
checkout bag: `customer-basket` in the game (clubhouse.js, instantiated from
merch at scale 0.66), where the checkout bag is `FrontDeskShoppingBag` on the
counter.

Publix-style: moulded plastic, tapered so they stack, an open top, a ribbed
shell, and two handles that fold down onto the rim. Its design is MOULDED rather
than printed — vertical ribs and a badge — because that is what injection
tooling gives you and a printed decal on a shop basket looks like a sticker.

UNITS ARE YARDS, matching the checkout bag and the game.

    blender --factory-startup -b --python tools/blender/hero/build_basket.py -- [cycles] [break=handles|boss]
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
OUT_RENDER = os.path.join(REPO, "qa", "hero", "basket")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "customer_basket.glb")
ART = os.path.join(REPO, "Assets", "models", "hero", "textures",
                   "customer_basket_print.png")

# A 480 x 330 x 250 mm hand basket, in yards, tapering so they nest.
TOP = (0.5250, 0.3610)
BOTTOM = (0.4370, 0.2840)
HEIGHT = 0.2730
WALL = 0.0060
CORNER = 0.0420
# 12 shallow ribs, not 22 deep ones. The corduroy was an ALIASING artefact as
# much as a design one: at 22 ribs over a 52-point section there were 2.4
# points per rib, so every rib was a hard two-facet ridge. Fewer ribs on a
# denser section is what turns stripes you see first into texture you notice
# on the second look.
RIBS = 12
RIB_DEPTH = 0.0030
LOAD = (0.330, 0.200, 0.170)

STEPS_LONG = 16
STEPS_SHORT = 10
CORNER_STEPS = 6


def section(t, inset=0.0, ribs=True):
    """Rounded rectangle, tapered by height fraction t, with moulded ribs."""
    hw = (BOTTOM[0] + (TOP[0] - BOTTOM[0]) * t) * 0.5 - inset
    hd = (BOTTOM[1] + (TOP[1] - BOTTOM[1]) * t) * 0.5 - inset
    r = max(0.002, CORNER - inset)
    z = HEIGHT * t
    pts = []

    def push(x, y):
        if ribs:
            # the rib pattern runs vertically, so it is a function of the
            # position AROUND the section and nothing else
            a = math.atan2(y, x)
            # PHASE OFFSET so the front-face centre lands in a valley. Without
            # it, atan2 at the middle of the front face is -pi/2 and
            # cos(-pi/2 * 12) is exactly 1 -- a rib crest straight through the
            # middle of the badge, splitting the wordmark in half.
            d = RIB_DEPTH * (0.5 + 0.5 * math.cos(a * RIBS + math.pi))
            n = Vector((x, y)).normalized() if (x or y) else Vector((1, 0))
            x += n.x * d
            y += n.y * d
        pts.append(Vector((x, y, z)))

    def corner(cx, cy, a0, a1, n=CORNER_STEPS):
        for k in range(n):
            a = a0 + (a1 - a0) * (k / (n - 1))
            push(cx + math.cos(a) * r, cy + math.sin(a) * r)

    def wall(x0, y0, x1, y1, n):
        for k in range(1, n):
            u = k / n
            push(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u)

    corner(hw - r, hd - r, 0.0, math.pi / 2)
    wall(hw - r, hd, -(hw - r), hd, STEPS_LONG)
    corner(-(hw - r), hd - r, math.pi / 2, math.pi)
    wall(-hw, hd - r, -hw, -(hd - r), STEPS_SHORT)
    corner(-(hw - r), -(hd - r), math.pi, math.pi * 1.5)
    wall(-(hw - r), -hd, hw - r, -hd, STEPS_LONG)
    corner(hw - r, -(hd - r), math.pi * 1.5, math.pi * 2)
    wall(hw, -(hd - r), hw, hd - r, STEPS_SHORT)
    return pts


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


def pivot_boss(name, centre, radius=0.0105, half=0.0200, rings=9, sides=8):
    """The lug a handle pivots in, driven THROUGH the rim wall.

    The handle arcs used to stop at the rim's surface, which measured as
    attached and read as resting on it. This is the wand's hose fitting again:
    the fix is to model the shank a real part has.

    Built with cross-sections along its axis rather than as a plain cylinder,
    because a cylinder's vertices are all on its two end caps -- one cap in the
    cavity, one outside the shell, and nothing in the 6 mm of wall between them
    for the rooting assertion to find.
    """
    cx, cy, cz = centre
    verts, faces = [], []
    for s in range(rings):
        y = cy - half + (2 * half) * s / (rings - 1)
        for k in range(sides):
            a = 2 * math.pi * k / sides
            verts.append(Vector((cx + math.cos(a) * radius, y,
                                 cz + math.sin(a) * radius)))
    for s in range(rings - 1):
        for k in range(sides):
            q = (k + 1) % sides
            faces.append((s * sides + k, s * sides + q,
                          (s + 1) * sides + q, (s + 1) * sides + k))
    faces.append(tuple(range(sides - 1, -1, -1)))
    b = (rings - 1) * sides
    faces.append(tuple(range(b, b + sides)))
    return HS.mesh_from(name, verts, faces, smooth=True)


def wall_centre(body, x, z, side):
    """Find the middle of the shell wall at (x, z) by probing along Y.

    Hand-derived from the section this was ~2 mm out, and when the rib phase
    moved the surface by 3 mm two of the four bosses fell out of the material
    entirely. The wall's position is a function of the taper, the rib phase at
    that angle and the solidify offset -- so measure it rather than predict it.
    """
    hits = [side * (0.1450 + k * 0.0005) for k in range(160)]
    inside = [y for y in hits
              if HS.point_depth_inside(body, Vector((x, y, z))) > 0]
    return (inside[0] + inside[-1]) * 0.5 if inside else side * 0.1830


def build(broken=""):
    parts = {}

    rings = [section(t) for t in (0.0, 0.06, 0.30, 0.60, 0.86, 0.96)]
    # the rim rolls out and back, which is where a moulded basket gets its
    # stiffness and its stacking ledge
    rings.append([Vector((p.x * 1.020, p.y * 1.030, HEIGHT * 0.985)) for p in section(0.96, ribs=False)])
    rings.append([Vector((p.x * 1.022, p.y * 1.032, HEIGHT * 1.000)) for p in section(0.96, ribs=False)])
    rings.append([Vector((p.x * 1.008, p.y * 1.012, HEIGHT * 0.972)) for p in section(0.96, ribs=False)])
    # smooth-shaded: flat shading on a 12-rib moulding draws every facet edge
    body = loft("BasketBody", rings, smooth=True)
    solid = body.modifiers.new("Shell", "SOLIDIFY")
    solid.thickness = WALL
    solid.offset = 1.0
    solid.use_rim = True
    parts["body"] = HS.apply_mods(body)

    inner = [section(t, inset=WALL, ribs=False) for t in (0.02, 0.30, 0.60, 0.95)]
    parts["interior"] = loft("BasketInterior", inner, close_top=True)

    # ---- two folding handles, meeting over the middle. Pivots sit on the long
    # rim rails, which is what lets a real basket's handles drop flat.
    handles = []
    for side in (-1, 1):
        pts, faces = [], []
        STEPS, RING = 13, 6
        for s in range(STEPS):
            t = s / (STEPS - 1)
            a = math.pi * t
            # Rise from the rim rail and LEAN toward the middle without meeting.
            # Converging both arcs on one centre point drove them 45 mm through
            # each other -- real basket handles sit side by side at the apex with
            # a finger's gap, which is also what lets them fold flat past one
            # another.
            rise = math.sin(a)
            # The base of the arc has to land IN THE RIM MATERIAL, not inside
            # the cavity behind it: the rim rolls out to 1.03x the section and
            # then takes a 6 mm shell, so its outer face is further out than the
            # nominal top half-depth and a pivot placed at TOP/2 sat 2.6 mm shy.
            cy = side * ((TOP[1] * 0.5 + 0.0045) * (1 - rise) + 0.0125 * rise)
            cz = HEIGHT * 0.940 + rise * (HEIGHT * 0.60)
            cx = math.cos(a) * (TOP[0] * 0.30)
            if broken == "handles":
                # THE DELIBERATELY BROKEN VARIANT: both handles lifted clear of
                # the rim. A handle that floats above its pivot still looks like
                # a handle from the front, which is why it would ship.
                cz += 0.030
            tangent = Vector((-math.sin(a) * (TOP[0] * 0.30), 0,
                              math.cos(a) * (HEIGHT * 0.58))).normalized()
            u = Vector((0, 1, 0))
            v = tangent.cross(u).normalized()
            for k in range(RING):
                b = 2 * math.pi * k / RING
                pts.append(Vector((cx, cy, cz))
                           + u * (math.cos(b) * 0.0092)
                           + v * (math.sin(b) * 0.0062))
        for s in range(STEPS - 1):
            for k in range(RING):
                q = (k + 1) % RING
                faces.append((s * RING + k, s * RING + q,
                              (s + 1) * RING + q, (s + 1) * RING + k))
        faces.append(tuple(range(RING - 1, -1, -1)))
        base = (STEPS - 1) * RING
        faces.append(tuple(range(base, base + RING)))
        handles.append(HS.mesh_from(f"BasketHandle_{'F' if side < 0 else 'B'}",
                                    pts, faces, smooth=True))
    parts["handles"] = handles

    # ---- four pivot bosses, one per handle end, driven through the rim wall
    bosses = []
    for side in (-1, 1):
        for sx in (-1, 1):
            # 40 mm, not 4: the boss passes through 6 mm of wall and sticks out
            # both sides, so a small shove leaves it still in the material.
            out = side * 0.040 if broken == "boss" else 0.0
            cz = HEIGHT * 0.940 + (0.030 if broken == "handles" else 0.0)
            cx = sx * TOP[0] * 0.30
            cy = wall_centre(parts["body"], cx, cz, side) + out
            bosses.append(pivot_boss(
                f"Pivot_{'F' if side < 0 else 'B'}{'L' if sx < 0 else 'R'}",
                (cx, cy, cz)))
    parts["bosses"] = bosses

    # ---- the moulded badge on the front face
    # Bigger. At 46% of the width the wordmark was 13 px in the hero frame and
    # the badge read as a blank plate with something on it.
    bw, bh = TOP[0] * 0.62, HEIGHT * 0.40
    # THE BADGE FOLLOWS THE TAPER. The shell widens with height, so a flat plate
    # sits proud at its bottom edge and is PIERCED BY THE RIBS at its top -- the
    # rib tips came through the artwork and read as the wordmark breaking up.
    def wall_y(z):
        t = z / HEIGHT
        # -hd, minus the rib crest, minus the SOLIDIFY WALL (the shell is
        # offset outward by it), minus a hair. Leaving the wall out put the
        # badge 3.8 mm inside the outer surface and the ribs occluded all but
        # two slivers of it.
        # 0.8 mm PROUD of the crest, not 0.4 mm inside it. A moulded badge
        # stands off the shell; sitting inside the crest let the ribs through.
        return (-(BOTTOM[1] + (TOP[1] - BOTTOM[1]) * t) * 0.5
                - RIB_DEPTH - WALL - 0.0008)

    verts, faces = [], []
    for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        z = HEIGHT * 0.52 + sz * bh * 0.5
        verts.append(Vector((sx * bw * 0.5, wall_y(z), z)))
    faces.append((0, 1, 2, 3))
    badge = HS.mesh_from("BasketBadge", verts, faces)
    # UVs FROM VERTEX POSITION, not loop order. mesh_from recalculates normals,
    # which reorders the quad's loops, so a fixed (0,0)(1,0)(1,1)(0,1) sequence
    # lands on whichever corners it happens to hit and twists the mapping into a
    # bow-tie -- the artwork came out as sheared white streaks. Position is
    # winding-independent.
    uv = badge.data.uv_layers.new(name="UVMap")
    z0 = HEIGHT * 0.52 - bh * 0.5
    for li in badge.data.polygons[0].loop_indices:
        co = badge.data.vertices[badge.data.loops[li].vertex_index].co
        # u straight from x. Flipping it "because the badge faces -Y" printed
        # the wordmark backwards -- the winding already handles which way the
        # face is seen, so the flip was a second correction on top of one that
        # had already happened.
        uv.data[li].uv = ((co.x + bw * 0.5) / bw, (co.z - z0) / bh)
    # NO SOLIDIFY. Thickening the badge generated back and rim faces with no
    # UVs of their own, and the face we actually see ended up sampling those --
    # the artwork came out as scrambled white marks. A moulded badge only needs
    # to stand proud of the shell, which the offset already does.
    parts["badge"] = badge

    poly = HS.pbr("BasketPlastic", (0.022, 0.062, 0.038), roughness=0.52)
    grip = HS.pbr("BasketGrip", (0.020, 0.022, 0.025), roughness=0.46)
    plate = HS.pbr_textured("BasketBadge", ART, roughness=0.36)
    parts["body"].data.materials.append(poly)
    parts["interior"].data.materials.append(poly)
    parts["badge"].data.materials.append(plate)
    for h in handles + bosses:
        h.data.materials.append(grip)
    return parts


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = next((x.split("=", 1)[1] for x in args if x.startswith("break=")), "")
    suffix = f"-BROKEN-{broken}" if broken else ("-eevee" if engine == "EEVEE" else "")

    H.reset_scene()
    H.set_engine(engine, samples=160 if engine == "CYCLES" else 96)
    p = build(broken=broken)

    for h in p["handles"]:
        HS.assert_touching(h, p["body"], "a handle must be attached to the rim",
                           max_gap=0.0025, require_surface=True)
    HS.assert_rooted(p["bosses"], p["body"], "handle pivot bosses",
                     min_verts=3, min_depth=0.0015)
    HS.assert_no_overlap(p["handles"][0], p["handles"][1],
                         "the two handles must not be inside each other",
                         min_gap=0.0015)
    # The tolerance is the RIB DEPTH, not a hair. The badge is a four-corner
    # quad on a ribbed wall, so a corner can land in a valley and the measured
    # gap is to the valley floor rather than to the crest the badge is actually
    # seated on. Asking for 2 mm against a 5.5 mm rib is asking the wrong
    # question.
    HS.assert_touching(p["badge"], p["body"],
                       "the badge must be seated on the ribbed shell",
                       max_gap=RIB_DEPTH + WALL * 0.5)
    HS.assert_fits_inside(p["interior"], LOAD,
                          "the basket has to hold a shop's worth of goods",
                          margin=0.0040)

    subject = [p["body"], p["badge"]] + p["handles"] + p["bosses"]
    print(f"TRIS {H.triangles(subject)} ({len(subject)} objects, 3 materials) "
          f"— the hand is 5,179")
    lo, hi = H.bounds(subject)
    print(f"  overall {hi.x - lo.x:.4f} x {hi.y - lo.y:.4f} x {hi.z - lo.z:.4f} yd"
          f"   ({RIBS} moulded ribs)")

    p["interior"].hide_render = True
    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.20)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, f"basket{suffix}", views=8,
                     elevation=20.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"basket{suffix}-turntable.png"), cols=4)
    for label, az, el in (("hero", -118, 26), ("front", -90, 10),
                          ("into", -90, 66), ("side", 0, 10)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"basket{suffix}-{label}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject, cam,
                         os.path.join(OUT_RENDER, f"basket{suffix}-silhouette.png"),
                         res=(900, 900))

    hfov = 2 * math.atan(math.tan(math.radians(66) / 2) * 16 / 9)
    d = (TOP[0] * 0.66 / 0.30) / (2 * math.tan(hfov / 2))
    app = H.camera_fov("Apparent", H.orbit_position(centre, d, -118, 22), centre, 66.0)
    app.data.sensor_fit = "VERTICAL"
    H.render(app, os.path.join(OUT_RENDER, f"basket{suffix}-apparent.png"), res=(1600, 900))

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
