"""HERO ASSET 1 — THE FIRST-PERSON HAND.

Reference: Designs/ProShop/Images/Goal_26/HandsRefrenceImage.png -- a right hand
wrapped around a shaft, seen from behind and slightly above.

WHY EIGHT PREVIOUS ROUNDS FAILED, as a modelling fact rather than as history:
the runtime hand is about twenty SEPARATE CONVEX PRIMITIVES -- a scaled sphere
for the palm, spheres for the thenar and each knuckle, capsules for every
phalanx. Twenty convex lumps sharing no surface cannot make a hand, because a
hand reads by CONTINUITY: the back of the hand is one plane that does not break
into fingers until past the knuckles, and the joints are bulges in a continuous
form rather than gaps between separate ones. Photographed, that build reads as a
bunch of grapes. The owner called it bobbles and he was right.

So this is ONE SURFACE. Metaball elements are laid along a skeleton and solved
into a single continuous isosurface: fingers grow out of the palm with a real
web at the base, the metacarpal heads raise a knuckle ridge that is part of the
same skin, and there is nowhere for a seam to appear because there are none.
Anisotropy comes from PLACEMENT -- the palm is a stack of capsule rows -- because
Blender 5.1's ellipsoid element produces no surface at all (probe_metaball.py).

Nails are the deliberate exception: separate glossy parts, raycast onto the
solved skin so they cannot float, because a nail is a genuinely different
material and it is the specular event that tells an eye this is a hand.

    blender --factory-startup -b --python tools/blender/hero/build_hand.py -- [--engine cycles]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector, Quaternion  # noqa: E402
import hero_lib as H  # noqa: E402
import metaball_lib as M  # noqa: E402

REPO = os.getcwd()
OUT_RENDER = os.path.join(REPO, "qa", "hero", "hand")
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "fp_hand.glb")

RESOLUTION = 0.00085
TRI_BUDGET = 4600

# ---------------------------------------------------------------------------
# ANATOMY, in metres, adult male, from anthropometric norms rather than
# invented: hand length 0.190 wrist crease to middle fingertip, breadth 0.088
# across the metacarpal heads, palm thickness 0.026, wrist breadth 0.058 and
# thickness 0.040. Every number below is a SURFACE size -- the metaball layer
# converts to field radii.
#
# Frame:  +X radial (thumb side, right hand)   +Y distal   +Z dorsal
# The glTF axis swap is baked into vertices at export, never left on a node.

BREADTH = 0.088
PALM_LEN = 0.095

# The MCP line is an ARC, not a row: middle furthest out, little shortest and
# lowest. A straight row of knuckles is one of the things that makes a modelled
# hand read as a glove.
MCP = {
    "index":  Vector((0.0290, 0.0905, 0.0060)),
    "middle": Vector((0.0090, 0.0955, 0.0080)),
    "ring":   Vector((-0.0115, 0.0910, 0.0060)),
    "little": Vector((-0.0305, 0.0820, 0.0015)),
}
PHALANX = {
    "index":  (0.0395, 0.0235, 0.0205),
    "middle": (0.0435, 0.0275, 0.0215),
    "ring":   (0.0400, 0.0255, 0.0205),
    "little": (0.0320, 0.0185, 0.0180),
}
# Base and tip surface radii per phalanx. A finger swells at each joint and
# pinches between them; that alternation is most of what makes a finger read as
# jointed rather than as a tube. 0.0100 base radius = a 20 mm finger, correct.
RADII = {
    "index":  ((0.0100, 0.0092), (0.0092, 0.0085), (0.0083, 0.0058)),
    "middle": ((0.0103, 0.0095), (0.0094, 0.0087), (0.0085, 0.0060)),
    "ring":   ((0.0097, 0.0089), (0.0089, 0.0082), (0.0080, 0.0056)),
    "little": ((0.0086, 0.0079), (0.0078, 0.0072), (0.0071, 0.0050)),
}

# THE GRIP: flexion at MCP, PIP, DIP. The spiral makes the little finger curl
# hardest and the index least, which is what a real hand does and what stops
# four fingers reading as a comb.
GRIP = (44.0, 60.0, 30.0)
SPIRAL = {"index": 0.92, "middle": 1.00, "ring": 1.05, "little": 1.11}
CONVERGE = {"index": -4.0, "middle": -1.0, "ring": 2.0, "little": 5.5}

SHAFT_TARGET = 0.0150     # a 30 mm handle, the diameter of the reference pole


# ---------------------------------------------------------------------------


def build_mass():
    obj, mball = M.new_metaball("HandMass", resolution=RESOLUTION)

    # ---- forearm. Flares toward the elbow and is oval in section, wider than
    # deep. Cut at 0.16 -- past that the viewmodel is out of frame.
    M.taper(mball, (0.0, -0.020, 0.001), (-0.005, -0.125, 0.003), 0.0205, 0.0292)

    # ---- wrist: the pinch. Narrower than the forearm AND than the hand, and
    # markedly flattened. Without it the hand is a club.
    for y, half_w, half_t in ((-0.014, 0.012, 0.0146), (0.000, 0.015, 0.0138),
                              (0.012, 0.019, 0.0130)):
        M.capsule(mball, (-half_w, y, 0.001), (half_w, y, 0.001), half_t)

    # ---- palm: capsule rows into a flat slab, arching across and along.
    # Half-thickness runs 0.0115 at the wrist to 0.0105 at the knuckles: a real
    # palm is 23-26 mm thick, not the 40 mm a sphere-based build ends up with.
    def profile(y):
        t = max(0.0, min(1.0, (y - 0.014) / (0.094 - 0.014)))
        half_t = 0.0100 + 0.0012 * math.sin(math.pi * t) - 0.0012 * t
        half_w = 0.0215 + 0.0125 * math.sin(math.pi * (0.25 + 0.75 * t))
        # the transverse arch: the palm cups, so its centre drifts dorsally
        z = 0.0015 + 0.0055 * t
        x = -0.0020 - 0.0015 * t
        return half_t, half_w, Vector((x, y, z))

    for y in M.row_positions(0.014, 0.094, 0.0100):
        half_t, half_w, c = profile(y)
        M.capsule(mball, c - Vector((half_w, 0, 0)), c + Vector((half_w, 0, 0)), half_t)

    # ---- thenar: the ball of the thumb, the biggest soft mass on a hand and
    # the thing that makes a gripping hand look like it is gripping.
    M.taper(mball, (0.0225, 0.0130, -0.0035), (0.0290, 0.0430, 0.0000), 0.0112, 0.0124)

    # ---- hypothenar: the pad along the little-finger edge. Deeper than people
    # expect, and the reason the ulnar silhouette of a fist is a curve.
    M.taper(mball, (-0.0265, 0.0180, -0.0010), (-0.0295, 0.0620, 0.0020), 0.0104, 0.0110)

    # ---- metacarpal heads: the knuckle ridge, raised proud of the palm plane
    # as its own lumps so the ridge is a feature of the surface rather than a
    # hoped-for consequence of the fingers meeting the palm.
    for name, p in MCP.items():
        scale = 0.88 if name == "little" else 1.0
        M.ball(mball, p + Vector((0, -0.0030, 0.0016)), 0.0112 * scale)

    # ---- fingers
    fingers = {}
    for name in ("index", "middle", "ring", "little"):
        angles = tuple(a * SPIRAL[name] for a in GRIP)
        fingers[name] = finger(mball, MCP[name], PHALANX[name], RADII[name],
                               angles, CONVERGE[name])

    # ---- thumb. Off the trapezium low and radial, across the front of the
    # grip, lying ALONG the shaft the way the reference shows rather than
    # clamping across it.
    thumb_pts = [Vector((0.0295, 0.0200, -0.0080)), Vector((0.0520, 0.0470, -0.0155)),
                 Vector((0.0535, 0.0745, -0.0080)), Vector((0.0465, 0.0920, 0.0020))]
    thumb_r = [(0.0140, 0.0118), (0.0115, 0.0100), (0.0098, 0.0068)]
    for i in range(3):
        M.taper(mball, thumb_pts[i], thumb_pts[i + 1], thumb_r[i][0], thumb_r[i][1])
        if i < 2:
            M.ball(mball, thumb_pts[i + 1], thumb_r[i][1] * 1.04)

    return obj, fingers, thumb_pts


def finger(mball, base, lengths, radii, angles, converge_deg):
    """Walk one finger from its knuckle to its tip, flexing at each joint.

    Returns the joint chain, the distal direction and the flexion axis, so the
    nail can be placed off the geometry rather than off a guess.
    """
    yaw = Quaternion(Vector((0, 0, 1)), math.radians(converge_deg))
    direction = (yaw @ Vector((0.055, 0.996, 0.045))).normalized()
    axis = (yaw @ Vector((1, 0, 0))).normalized()

    pos = Vector(base)
    joints = [pos.copy()]
    total = 0.0
    seg_dir = direction
    for i, (length, (r0, r1)) in enumerate(zip(lengths, radii)):
        total += angles[i]
        seg_dir = Quaternion(axis, math.radians(total)) @ direction
        end = pos + seg_dir * length
        M.taper(mball, pos, end, r0, r1)
        # THE JOINT: proud at every knuckle. On a flexed finger the joints are
        # the widest part and they are what catches the light.
        if i < len(lengths) - 1:
            M.ball(mball, end, r1 * 1.05)
        joints.append(end.copy())
        pos = end
    return {"joints": joints, "dir": seg_dir, "axis": axis,
            "tip_radius": radii[-1][1]}


# ---------------------------------------------------------------------------
# the grip, measured rather than assumed


def segment_distance(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.dot(ab))))
    return (p - (a + ab * t)).length


def fit_shaft(fingers, palm_points):
    """Measure the handle this curl is actually holding.

    "Would a hand hold it there" is a review question and it cannot be answered
    by placing a cylinder near the fingers and hoping. The first version of this
    searched for the point furthest from every finger segment and returned a
    95 mm handle, because nothing bounded the search: the further it walked from
    the hand the better its score got, so it walked to the edge of its own search
    window and reported that. An instrument whose best answer is "outside the
    object" is measuring the search window, not the grip.

    So this starts at the ANATOMICAL grip centre -- the centroid of each finger's
    knuckle, middle joint and tip, which is inside the curl by construction --
    and refines only within 8 mm of it. The clearance it returns is the real
    distance from that axis to the nearest finger or palm surface: positive means
    the hand is holding a handle of that radius, negative means the fingers are
    inside it.
    """
    axis = Vector((0, 0, 0))
    for f in fingers.values():
        axis += f["axis"]
    axis.normalize()

    FINGER_R = (0.0096, 0.0087, 0.0072)
    segments = []
    for f in fingers.values():
        j = f["joints"]
        for i in range(3):
            segments.append((j[i], j[i + 1], FINGER_R[i]))
    for p in palm_points:
        segments.append((p, p, 0.0115))

    origin = Vector((0, 0, 0))
    for f in fingers.values():
        j = f["joints"]
        origin += (j[1] + j[2] + j[3]) / 3.0
    origin /= len(fingers)

    u = axis.cross(Vector((0, 0, 1)))
    if u.length < 1e-6:
        u = axis.cross(Vector((0, 1, 0)))
    u.normalize()
    v = axis.cross(u).normalized()

    best = (origin, min(segment_distance(origin, a, b) - r for a, b, r in segments))
    step, reach = 0.0008, 0.008
    n = int(reach / step)
    for i in range(-n, n + 1):
        for k in range(-n, n + 1):
            p = origin + u * (i * step) + v * (k * step)
            clearance = min(segment_distance(p, a, b) - r for a, b, r in segments)
            if clearance > best[1]:
                best = (p, clearance)
    centre, clearance = best
    return centre, axis, clearance


# ---------------------------------------------------------------------------


def nail(name, hand_obj, base_inside, tip_dir, axis, width, length):
    """Place a nail ON the skin by raycasting the solved surface.

    The first build placed nails by arithmetic and they came out floating clear
    of the fingers -- the same class of fault as the rake's bristles in air. A
    ray from inside the distal phalanx outward through the dorsal side hits the
    skin exactly where the nail bed is, whatever the metaball solver did.
    """
    dorsal = axis.cross(tip_dir).normalized()
    if dorsal.dot(Vector((0, 0, 1))) < 0:
        dorsal = -dorsal

    hit, location, normal, _ = hand_obj.ray_cast(base_inside, dorsal, distance=0.05)
    if not hit:
        raise SystemExit(f"BUILD FAILED: no skin found for {name}; nail would float")
    normal = normal.normalized()
    # rebuild an orthonormal frame ON the surface so the plate lies flat on it
    along = (tip_dir - normal * tip_dir.dot(normal)).normalized()
    across = normal.cross(along).normalized()

    verts, faces = [], []
    cols, rows = 6, 5
    for r in range(rows):
        t = r / (rows - 1)
        for c in range(cols):
            s = c / (cols - 1) * 2 - 1
            half = width * 0.5 * (0.80 + 0.20 * math.sin(math.pi * (0.30 + 0.70 * t)))
            shrink = 1.0 - 0.30 * max(0.0, (t - 0.70) / 0.30) ** 2
            dome = (1.0 - s * s) * 0.0009
            verts.append(location
                         + along * (length * (t - 0.28))
                         + across * (s * half * shrink)
                         + normal * (dome - 0.0004))
    for r in range(rows - 1):
        for c in range(cols - 1):
            i = r * cols + c
            faces.append((i, i + 1, i + cols + 1, i + cols))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(p) for p in verts], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    solid = obj.modifiers.new("Solidify", "SOLIDIFY")
    solid.thickness = 0.0010
    solid.offset = 1.0
    return obj, location


# ---------------------------------------------------------------------------
# materials


def skin_material():
    mat = bpy.data.materials.new("Skin")
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.520, 0.268, 0.180, 1.0)
    b.inputs["Roughness"].default_value = 0.50
    # Skin is translucent. Without this the hand reads as painted plastic no
    # matter how good the silhouette is, and "coloured geometry" is exactly what
    # the review looks for.
    for key, value in (("Subsurface Weight", 0.26), ("Subsurface Scale", 0.007)):
        if key in b.inputs:
            b.inputs[key].default_value = value
    if "Subsurface Radius" in b.inputs:
        b.inputs["Subsurface Radius"].default_value = (0.032, 0.012, 0.008)
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.40
    return mat


def nail_material():
    mat = bpy.data.materials.new("Nail")
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.545, 0.300, 0.246, 1.0)
    b.inputs["Roughness"].default_value = 0.26
    if "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = 0.35
        b.inputs["Coat Roughness"].default_value = 0.16
    return mat


def shaft_material():
    mat = bpy.data.materials.new("Shaft")
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.180, 0.100, 0.052, 1.0)
    b.inputs["Roughness"].default_value = 0.40
    return mat


# ---------------------------------------------------------------------------


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"

    H.reset_scene()
    H.set_engine(engine, samples=128 if engine == "CYCLES" else 96)
    M.calibrate(RESOLUTION)

    mass_obj, fingers, thumb_pts = build_mass()
    hand = M.solve(mass_obj, "Hand")
    raw_faces = len(hand.data.polygons)
    print(f"  metaball solved to {raw_faces} faces")
    if raw_faces < 3000:
        raise SystemExit("BUILD FAILED: the solve is too coarse to be a hand; "
                         "elements are probably contributing no field again")

    bpy.context.view_layer.objects.active = hand
    hand.select_set(True)
    bpy.ops.object.shade_smooth()
    # Marching cubes leaves a fine ripple on every surface, and decimating that
    # ripple turns it into visible facets -- which is how a smooth arm ends up
    # looking like a caterpillar. Relax it before the triangle budget bites.
    sm = hand.modifiers.new("Relax", "SMOOTH")
    sm.factor = 0.55
    sm.iterations = 4

    lo, hi = H.bounds([hand])
    print(f"  bounds x {lo.x:+.4f}..{hi.x:+.4f}  y {lo.y:+.4f}..{hi.y:+.4f}"
          f"  z {lo.z:+.4f}..{hi.z:+.4f}")
    print(f"  breadth {hi.x - lo.x:.4f} m (anatomical target {BREADTH:.3f})")

    # ---- the grip, measured
    palm_pts = [Vector((-0.002, 0.045, 0.004)), Vector((-0.002, 0.075, 0.006))]
    centre, axis, clearance = fit_shaft(fingers, palm_pts)
    print(f"  largest handle this grip can hold: radius {clearance:.4f} m "
          f"({clearance * 2000:.1f} mm across), target {SHAFT_TARGET * 2000:.0f} mm")
    if clearance < 0.006:
        print("  WARNING: the curl is too tight to hold a broom handle")

    # ---- nails, raycast onto the solved skin
    nails = []
    NAIL = {"index": (0.0088, 0.0125), "middle": (0.0091, 0.0132),
            "ring": (0.0085, 0.0122), "little": (0.0074, 0.0102)}
    for name, f in fingers.items():
        w, l = NAIL[name]
        j = f["joints"]
        inside = j[-2].lerp(j[-1], 0.42)
        obj, hit = nail(f"Nail_{name}", hand, inside, f["dir"], f["axis"], w, l)
        nails.append(obj)
    t_dir = (thumb_pts[3] - thumb_pts[2]).normalized()
    t_axis = t_dir.cross(Vector((0, 0, 1))).normalized()
    obj, _ = nail("Nail_thumb", hand, thumb_pts[2].lerp(thumb_pts[3], 0.42),
                  t_dir, t_axis, 0.0106, 0.0138)
    nails.append(obj)
    print(f"  {len(nails)} nails raycast onto the skin (none floating)")

    skin, nailmat = skin_material(), nail_material()
    hand.data.materials.append(skin)
    for n in nails:
        n.data.materials.append(nailmat)
        bpy.context.view_layer.objects.active = n
        bpy.ops.object.shade_smooth()

    # ---- budget
    dec = hand.modifiers.new("Decimate", "DECIMATE")
    dec.ratio = 1.0
    bpy.context.view_layer.update()
    raw_tris = H.triangles([hand])
    dec.ratio = min(1.0, float(TRI_BUDGET) / max(1, raw_tris))
    bpy.context.view_layer.update()
    subject = [hand] + nails
    print(f"TRIS {H.triangles(subject)} (from {raw_tris} raw)   "
          f"{len(subject)} objects / 2 materials")

    # ---- the shaft, placed where the grip actually is
    half = 0.26
    bpy.ops.mesh.primitive_cylinder_add(radius=max(0.008, min(SHAFT_TARGET, clearance)),
                                        depth=half * 2, location=centre, vertices=32)
    shaft = bpy.context.active_object
    shaft.name = "ShaftProxy"
    shaft.rotation_mode = "QUATERNION"
    shaft.rotation_quaternion = axis.to_track_quat("Z", "Y")
    shaft.data.materials.append(shaft_material())
    bpy.ops.object.shade_smooth()

    # ---- renders. FRAMED FROM THE SUBJECT, never by eye: the previous pass put
    # the camera inside the hand and a frame the object overflows can only answer
    # questions about the lens. The forearm is clamped out of the framing sphere
    # so it runs out of shot instead of shrinking the hand to nothing.
    centre_view, sphere_r = H.subject_sphere(subject, weight_y=(-0.030, 0.140))
    LENS = 76.0
    dist = H.fit_distance(sphere_r, LENS, res=(1100, 1100), margin=1.30)
    H.studio(center=centre_view, scale=sphere_r)
    H.backdrop(center=centre_view, scale=sphere_r)
    print(f"  framing: centre {tuple(round(c, 4) for c in centre_view)} "
          f"radius {sphere_r:.4f} m, camera at {dist:.3f} m")

    tt = H.turntable(centre_view, dist, OUT_RENDER, "hand", views=8, elevation=16.0,
                     lens=LENS, res=(760, 760))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, "hand-turntable.png"), cols=4)

    hero = H.camera("Hero", H.orbit_position(centre_view, dist, -122, 24), centre_view, lens=LENS)
    H.render(hero, os.path.join(OUT_RENDER, "hand-hero.png"), res=(1100, 1100))
    dorsal = H.camera("Dorsal", H.orbit_position(centre_view, dist, -90, 52), centre_view, lens=LENS)
    H.render(dorsal, os.path.join(OUT_RENDER, "hand-dorsal.png"), res=(1100, 1100))
    ulnar = H.camera("Ulnar", H.orbit_position(centre_view, dist, -190, 10), centre_view, lens=LENS)
    H.render(ulnar, os.path.join(OUT_RENDER, "hand-ulnar.png"), res=(1100, 1100))
    H.silhouette(subject + [shaft], hero,
                 os.path.join(OUT_RENDER, "hand-silhouette.png"), res=(900, 900))

    # ---- APPARENT SIZE. Game camera is 66 deg vertical FOV at 16:9. In
    # hand-v8-lit.png the hand-and-forearm cluster spans about 9% of the frame
    # width, so the camera sits at the distance that reproduces that angular size
    # on a real-scale hand: the same pixels on screen, correctly lit for once.
    hfov = 2 * math.atan(math.tan(math.radians(66) / 2) * 16 / 9)
    dist = (0.115 / 0.09) / (2 * math.tan(hfov / 2))
    app = H.camera_fov("Apparent", H.orbit_position(centre_view, dist, -122, 20),
                       centre_view, 66.0)
    app.data.sensor_fit = "VERTICAL"
    H.render(app, os.path.join(OUT_RENDER, "hand-apparent.png"), res=(1600, 900))
    print(f"  apparent-size camera at {dist:.3f} m, 66 deg vertical FOV")

    # ---- export
    bpy.data.objects.remove(shaft, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    for n in nails:
        n.select_set(True)
    hand.select_set(True)
    bpy.context.view_layer.objects.active = hand
    bpy.ops.object.convert(target="MESH")
    exportable = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    H.bake_gltf_axis(exportable)
    H.export_glb(exportable, OUT_GLB)
    print(f"FINAL TRIS {H.triangles(exportable)}")


main()
