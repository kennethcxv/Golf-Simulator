"""HERO ASSET — THE DUSTPAN. Pan, lip, handle.

The player loads in holding this, so it is on screen before anything else in the
game is. The current one (tests/goldens/tool-dustpan.png) reads as a small black
trapezoid on a stick.

The pan is built as ONE LOFTED SHELL and then solidified, which is what makes
the lip continuous with the pan by construction rather than by intention: the
lip is simply where the shell's wall height goes to zero. `assert_one_piece`
holds it.

Hard surface: a lofted U-profile, a solidify, and a handle. No solving.

    blender --factory-startup -b --python tools/blender/hero/build_dustpan.py -- [cycles] [break-handle]
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
OUT_RENDER = os.path.join(REPO, "qa", "hero", "dustpan")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "dustpan.glb")

# The rail: (y, z, half-width, wall height) from the lip at the front to the top
# of the back wall. A domestic dustpan is 240 across the mouth and 225 deep, the
# lip is 2 mm thick and the back wall stands about 95.
RAIL = [
    # (y, z, half-width, wall height). WIDER THAN DEEP: 260 across the mouth by
    # 195 deep. The first version was 240 by 225 with the walls sweeping up into
    # points at the lip, and it read as a canoe -- a long narrow trough with a
    # gunwale, which is what a dustpan stops being the moment the mouth is not
    # obviously the widest thing about it.
    (0.0000, 0.0020, 0.1284, 0.0080),   # the LIP: a rim, not a knife edge. The
    (-0.0090, 0.0026, 0.1298, 0.0125),  # side walls START with real height --
    (-0.0300, 0.0046, 0.1300, 0.0215),  # tapering them to nothing at the front
    (-0.0600, 0.0088, 0.1292, 0.0350),  # left two knife-thin spikes standing up
    # WAS (-0.0550, ...) HERE, which is 5 mm FORWARD of the station before it.
    # The rail doubled back on itself, so the loft folded over and the fold is
    # the band of different tone that runs across the pan floor in every render
    # -- reported as "a shading discontinuity where the loft's lip rows change"
    # and looked for in the shading, the materials and the smoothing, none of
    # which it was in. assert_rail_monotonic below is the check that would have
    # said so in one line.
    (-0.0750, 0.0112, 0.1288, 0.0395),
    (-0.0900, 0.0142, 0.1266, 0.0435),
    (-0.1250, 0.0228, 0.1240, 0.0495),
    (-0.1550, 0.0334, 0.1214, 0.0520),
    (-0.1780, 0.0458, 0.1194, 0.0530),
    (-0.1900, 0.0625, 0.1184, 0.0440),
    (-0.1955, 0.0805, 0.1178, 0.0290),
]
PROFILE_STEPS = 15        # points across the U, wall -> floor -> wall
SHELL = 0.0032            # plastic thickness
FLANGE_W = 0.0075         # how far the wall top returns inward
FLANGE_T = 0.34           # how much of the wall profile the return takes
LIP_ROWS = 2              # rows that get the rubber material


def assert_rail_monotonic(rail):
    """A lofted rail that goes backwards folds the surface over itself.

    Nothing in the pipeline objects to it: the mesh is still closed, still one
    piece, still passes every assertion the dustpan has. It just has a crease
    across the floor that no amount of looking at materials or smoothing will
    explain. Cheap to check, and it has already been wrong once.
    """
    bad = [(i, rail[i][0], rail[i + 1][0]) for i in range(len(rail) - 1)
           if rail[i + 1][0] >= rail[i][0]]
    if bad:
        raise SystemExit(
            "BUILD FAILED: the dustpan rail doubles back on itself at "
            + "; ".join(f"station {i}->{i + 1}: y {a * 1000:.1f} then "
                        f"{b * 1000:.1f}" for i, a, b in bad))
    print(f"  rail assertion passed: {len(rail)} stations, y strictly "
          f"decreasing from {rail[0][0] * 1000:.0f} to "
          f"{rail[-1][0] * 1000:.0f} mm")


def loft_pan():
    """One shell: for every rail station, a U-shaped cross-section; bridged
    along the rail. The lip is where the wall height reaches zero, so it cannot
    be a separate piece."""
    assert_rail_monotonic(RAIL)
    verts, faces = [], []
    per = PROFILE_STEPS

    def wall_point(sgn, t, y, z, w, h):
        """t = 0 at the top of the wall, 1 where it meets the floor.

        THE TOP OF THE WALL IS A RETURNED FLANGE, not an edge. Solidify with
        use_rim caps a wall top with a flat 3.2 mm band, and against the light
        that band is a razor line running the length of both sides -- the
        "knife-edged wall tops" in the review. A moulded dustpan turns its wall
        over inward at the top: it is how the part gets its stiffness, and it
        gives the eye a rolled bead to read instead of a cut edge.
        """
        if t < FLANGE_T:
            k = t / FLANGE_T                       # across the returned lip
            inset = FLANGE_W * (1.0 - k)
            rise = 0.0013 * math.sin(math.pi * k)
            return Vector((sgn * (w - inset), y + 0.0016, z + h + rise))
        k = (t - FLANGE_T) / (1.0 - FLANGE_T)
        return Vector((sgn * w, y + 0.0016 * (1.0 - k), z + h * (1.0 - k)))

    def profile_point(idx, y, z, w, h):
        """Walk the U: down the left wall, across the floor, up the right."""
        wall = 5                       # points on each wall, 2 of them the lip
        floor_pts = per - wall * 2
        if idx < wall:
            return wall_point(-1.0, idx / (wall - 1.0), y, z, w, h)
        if idx < wall + floor_pts:
            t = (idx - wall) / (floor_pts - 1)
            x = -w + 2 * w * t
            # a shallow dish so the floor is not a flat plane
            # A shallow dish. At 2.2 mm it fought the rail's own curvature and
            # the smooth-shaded floor came out looking like crumpled foil.
            dip = -0.0008 * math.sin(math.pi * t)
            return Vector((x, y, z + dip))
        t = (idx - wall - floor_pts) / (wall - 1.0)
        return wall_point(1.0, 1.0 - t, y, z, w, h)

    # Subdivide the rail. Flat shading is right for moulded plastic, but nine
    # stations across a 195 mm floor showed as banding -- visible strips of
    # slightly different tone that read as a stepped surface rather than a
    # pressed one.
    fine = []
    for i in range(len(RAIL) - 1):
        a, b = RAIL[i], RAIL[i + 1]
        for k in range(2):
            t = k / 2
            fine.append(tuple(a[j] + (b[j] - a[j]) * t for j in range(4)))
    fine.append(RAIL[-1])

    for (y, z, w, h) in fine:
        for k in range(per):
            verts.append(profile_point(k, y, z, w, h))
    for i in range(len(fine) - 1):
        for k in range(per - 1):
            a = i * per + k
            faces.append((a, a + 1, a + per + 1, a + per))
    # SMOOTH BY ANGLE, not flat, and not smooth either.
    #
    # Flat was chosen because this is moulded plastic with pressed creases. But
    # the pan FLOOR is a smoothly curving surface -- it sweeps up 78 mm over its
    # length -- and flat-shading a curve facets the specular into rows. That is
    # the band across the floor, and it is why the band survived fixing the
    # folded rail: the fold was a real fault and a different one.
    #
    # By angle keeps both: the wall-to-floor crease is about 90 degrees and
    # stays hard, the flange return stays hard, and the floor's own gentle
    # curvature shades as the curve it is.
    ob = HS.mesh_from("DustpanShell", verts, faces, smooth=True)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(34.0))
    return ob, per


def build(broken=False):
    parts = {}
    shell, per = loft_pan()
    solid = shell.modifiers.new("Shell", "SOLIDIFY")
    solid.thickness = SHELL
    solid.offset = -1.0
    solid.use_rim = True
    pan = HS.apply_mods(shell)
    pan.name = "DustpanPan"
    parts["pan"] = pan

    # ---- the handle: a socket rising off the back wall, then a grip. Embedded
    # in the pan rather than abutting it, so the connection assertion has real
    # geometry to find.
    ang = math.radians(52.0)
    axis = Vector((0, -math.cos(ang), math.sin(ang)))
    root = Vector((0, -0.1890, 0.0760))
    if broken:
        # THE DELIBERATELY BROKEN VARIANT: the handle floats behind the pan,
        # which is the rake's fault exactly -- a part that looks placed and is
        # attached to nothing.
        root = root + Vector((0, -0.030, 0.020))
    rot = axis.to_track_quat("Z", "Y")
    neck = HS.cylinder("HandleNeck", root + axis * 0.030, 0.0112, 0.070,
                       verts=12, rotation=rot)
    grip = HS.cylinder("HandleGrip", root + axis * 0.098, 0.0096, 0.082,
                       verts=12, rotation=rot)
    cap = HS.cylinder("HandleCap", root + axis * 0.142, 0.0116, 0.009,
                      verts=12, rotation=rot)
    # A RUBBER GRIP SLEEVE and a hang hole. The handle was a plain telescopic
    # tube with nothing on it -- the fourth item on the review's list and the
    # only one geometry alone could answer. Kept in the same object so it stays
    # one part for the connection assertion, and given its material by position
    # the way the pan's lip is.
    sleeve = HS.cylinder("HandleSleeve", root + axis * 0.104, 0.0119, 0.062,
                         verts=12, rotation=rot)
    handle = HS.join([neck, grip, sleeve, cap], "DustpanHandle")
    parts["handle"] = handle

    # ---- materials. The lip is a REAL part boundary on a dustpan -- it is a
    # softer rubber strip so the pan can sit flat on the floor -- so it gets its
    # own material rather than the whole thing being one flood fill.
    # No clearcoat. A coat over a near-black base is a white specular sheet in a
    # bright studio, and the whole pan came out looking like brushed aluminium
    # while the source said charcoal.
    # ALL THREE WERE NEAR-BLACK GREY: 0.019/0.021/0.024, 0.062/0.058/0.052 and
    # 0.030/0.031/0.034. Three materials, one colour, and the review's words
    # were "one flat grey that reads as pressed sheet metal rather than moulded
    # plastic". Nothing about the geometry was going to fix that. Moulded
    # polypropylene has a colour; the rubber lip is the dark part, and the
    # handle is the only thing on it that is actually metal.
    # A dustpan is pressed sheet metal with a rubber lip; both were flat
    # colour, which is why a held tool 40 cm from the camera read as painted
    # card. `scale` is in Generated space -- roughly one noise cell per mm.
    body = HS.surface("DustpanBody", (0.024, 0.052, 0.044), rough=0.46,
                      scale=230.0, strength=0.15, dist=0.00028, spread=0.12)
    rubber = HS.surface("DustpanLip", (0.015, 0.014, 0.013), rough=0.88,
                        scale=170.0, strength=0.32, dist=0.00050, spread=0.16,
                        detail=5.0)
    steel = HS.pbr("DustpanHandle", (0.108, 0.112, 0.120), roughness=0.34,
                   metallic=1.0)
    pan.data.materials.append(body)
    pan.data.materials.append(rubber)
    handle.data.materials.append(steel)
    handle.data.materials.append(rubber)
    for poly in handle.data.polygons:
        d = (poly.center - root).dot(axis)
        if 0.073 < d < 0.135:
            poly.material_index = 1

    # The lip rows are the first LIP_ROWS rail stations, which on the solidified
    # mesh are the lowest-Y faces. Selecting by position rather than by index
    # keeps this correct if the solidify ever reorders anything.
    for poly in pan.data.polygons:
        c = poly.center
        if c.y > -0.026 and c.z < 0.022:
            poly.material_index = 1
    return parts


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    broken = "break-handle" in args
    suffix = "-BROKEN" if broken else ""

    H.reset_scene()
    H.set_engine(engine, samples=160 if engine == "CYCLES" else 96)
    parts = build(broken=broken)
    pan, handle = parts["pan"], parts["handle"]

    HS.assert_one_piece(pan, "the lip must be continuous with the pan")
    HS.assert_touching(handle, pan, "the handle must be attached to the pan",
                       max_gap=0.0015)

    subject = [pan, handle]

    # UVs and the grain BEFORE the renders. Generated-space noise on a

    # diagonal shaft in a big bounding box runs the wood grain ACROSS the

    # timber, which is the one thing that says painted dowel.

    HS.unwrap_and_grain(subject)
    print(f"TRIS {H.triangles(subject)} ({len(subject)} objects, 3 materials) "
          f"— the hand is 5,179")
    lo, hi = H.bounds(subject)
    print(f"  overall {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} x "
          f"{(hi.z - lo.z) * 1000:.0f} mm  (mouth {RAIL[0][2] * 2000:.0f} wide)")

    centre, radius = H.subject_sphere(subject)
    LENS = 74.0
    dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.22)
    H.studio(center=centre, scale=radius)
    H.backdrop(center=centre, scale=radius)

    tt = H.turntable(centre, dist, OUT_RENDER, f"dustpan{suffix}", views=8,
                     elevation=22.0, lens=LENS, res=(900, 900))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, f"dustpan{suffix}-turntable.png"), cols=4)
    # The mouth faces +Y, so the hero shot has to come from +Y. At -122 the
    # camera sat BEHIND the pan, the mouth was hidden entirely, and the thing
    # read as a boat hull in every frame I judged it from.
    for label, az, el in (("hero", 118, 30), ("mouth", 90, 10),
                          ("above", 90, 68), ("under", 90, -44)):
        cam = H.camera(label, H.orbit_position(centre, dist, az, el), centre, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"dustpan{suffix}-{label}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject, cam,
                         os.path.join(OUT_RENDER, f"dustpan{suffix}-silhouette.png"),
                         res=(900, 900))

    hfov = 2 * math.atan(math.tan(math.radians(66) / 2) * 16 / 9)
    d = (0.240 / 0.16) / (2 * math.tan(hfov / 2))
    app = H.camera_fov("Apparent", H.orbit_position(centre, d, 118, 26), centre, 66.0)
    app.data.sensor_fit = "VERTICAL"
    H.render(app, os.path.join(OUT_RENDER, f"dustpan{suffix}-apparent.png"), res=(1600, 900))

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
