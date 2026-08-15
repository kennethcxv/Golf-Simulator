"""HERO ASSET 1 — THE FIRST-PERSON HAND.

Reference: Designs/ProShop/Images/Goal_26/HandsRefrenceImage.png -- a right hand
wrapped around a shaft, seen from behind and slightly above.

WHY THE RUNTIME HAND FAILS, as a modelling fact rather than as history: it is
about twenty SEPARATE CONVEX PRIMITIVES -- a scaled sphere for the palm, spheres
for the thenar and each knuckle, a capsule per phalanx. Twenty convex lumps
sharing no surface cannot make a hand, because a hand reads by CONTINUITY: the
back of the hand is one plane that does not break into fingers until past the
knuckles, and the joints are bulges in a continuous form rather than gaps between
separate ones. Photographed, that build reads as a bunch of grapes. The owner
called it bobbles and he was right.

Metaballs fixed the continuity and cost the features: everything blends into
everything, so the fingers sank into the palm and the knuckle ridge smoothed off.
Three rounds moved those faults around without fixing them.

So the hand is a SKELETON SKINNED AND SUBDIVIDED. The Skin modifier sweeps one
surface along the bones of a hand: fingers stay separate because nothing blends,
the knuckle arc is a real branch and therefore a real ridge, and the result is
quads that subdivide smooth instead of marching-cube ripple. The palm is squashed
to a slab afterwards rather than by radii, because the skin frame rotates with
the chain and a slab defined that way twists as the palm arches into the wrist.

Nails are separate glossy parts, raycast onto the finished skin so they cannot
float: a nail is a genuinely different material and it is the specular event that
tells an eye at a glance that this is a hand.

    blender --factory-startup -b --python tools/blender/hero/build_hand.py -- [cycles]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector, Quaternion  # noqa: E402
import hero_lib as H  # noqa: E402
import skin_lib as S  # noqa: E402

REPO = os.getcwd()
OUT_RENDER = os.path.join(REPO, "qa", "hero", "hand")
SUFFIX = ""
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "fp_hand.glb")
TRI_BUDGET = 4600

# ---------------------------------------------------------------------------
# ANATOMY, metres, adult male, from anthropometric norms rather than invented:
# hand length 0.190 wrist crease to middle fingertip, breadth 0.088 across the
# metacarpal heads, palm thickness 0.026, wrist 0.058 wide by 0.040 deep.
#
# Frame:  +X radial (thumb side, right hand)   +Y distal   +Z dorsal
# The glTF axis swap is baked into vertices at export, never left on a node.

BREADTH = 0.088

MCP = {
    "index":  Vector((0.0310, 0.0885, 0.0098)),
    "middle": Vector((0.0100, 0.0940, 0.0116)),
    "ring":   Vector((-0.0125, 0.0890, 0.0098)),
    "little": Vector((-0.0350, 0.0795, 0.0056)),
}
PHALANX = {
    "index":  (0.0395, 0.0235, 0.0205),
    "middle": (0.0435, 0.0275, 0.0215),
    "ring":   (0.0400, 0.0255, 0.0205),
    "little": (0.0320, 0.0185, 0.0180),
}
# Joint radii: knuckle, PIP, DIP, tip. A finger is widest at its joints and
# pinches between them, and that alternation is most of what makes a finger read
# as jointed rather than as a dowel. 0.0100 = a 20 mm finger, which is correct.
JOINT_R = {
    "index":  (0.0098, 0.0088, 0.0078, 0.0059),
    "middle": (0.0101, 0.0090, 0.0080, 0.0061),
    "ring":   (0.0095, 0.0085, 0.0076, 0.0057),
    "little": (0.0085, 0.0076, 0.0068, 0.0051),
}

# THE GRIP: flexion at MCP, PIP, DIP for a 30 mm handle. The spiral makes the
# little finger curl hardest and the index least -- what a real hand does, and
# what stops four fingers reading as a comb.
GRIP = (55.0, 76.0, 33.0)
SPIRAL = {"index": 0.92, "middle": 1.00, "ring": 1.05, "little": 1.12}
CONVERGE = {"index": -5.0, "middle": -1.5, "ring": 2.5, "little": 6.5}

SHAFT_TARGET = 0.0150     # 30 mm handle, the diameter of the reference pole


def finger_joints(name):
    """Walk one finger from its knuckle to its tip, flexing at each joint."""
    yaw = Quaternion(Vector((0, 0, 1)), math.radians(CONVERGE[name]))
    direction = (yaw @ Vector((0.055, 0.996, 0.045))).normalized()
    axis = (yaw @ Vector((1, 0, 0))).normalized()
    angles = [a * SPIRAL[name] for a in GRIP]

    pos = Vector(MCP[name])
    joints = [pos.copy()]
    total = 0.0
    seg = direction
    for length, angle in zip(PHALANX[name], angles):
        # NEGATIVE. A rotation about +X carries +Y toward +Z, which is the back
        # of the hand: every previous round of this hand HYPEREXTENDED its
        # fingers backwards over the knuckles instead of curling them into a
        # grip, which is why the fingers sat above the shaft in every render and
        # why the nail rays found no skin above the distal phalanx. Flexion is a
        # rotation toward the palm, so the angle is negative.
        total -= angle
        seg = Quaternion(axis, math.radians(total)) @ direction
        pos = pos + seg * length
        joints.append(pos.copy())
    return joints, seg, axis


def build_skeleton():
    sk = S.Skeleton()

    # ---- forearm -> wrist -> palm. The wrist is the PINCH: narrower than the
    # forearm and than the hand. Without it the hand is a club.
    # Radii are (half-width, half-thickness) HALF-EXTENTS in metres, measured
    # from probe: for a chain running along Y the first controls world X and the
    # second world Z. That is the whole reason the palm can be a 76 mm plate that
    # is 26 mm thick without squashing anything afterwards -- and the squash was
    # the source of two separate bugs, because it moved geometry the rest of the
    # build had already calculated against.
    sk.add("elbow", (0.000, -0.100, 0.002), (0.0228, 0.0186), root=True)
    sk.add("fore1", (0.000, -0.060, 0.002), (0.0244, 0.0196), parent="elbow")
    sk.add("fore2", (0.000, -0.026, 0.001), (0.0214, 0.0166), parent="fore1")
    sk.add("wrist", (0.000, 0.004, 0.002), (0.0238, 0.0150), parent="fore2")
    sk.add("palm1", (-0.001, 0.030, 0.002), (0.0322, 0.0114), parent="wrist")
    sk.add("palm2", (-0.002, 0.055, 0.003), (0.0358, 0.0104), parent="palm1")
    # A VALLEY before the ridge. Subdivision smooths a 5 mm step over a 76 mm
    # form into nothing, so the knuckles need something to stand out FROM: this
    # vertex pinches the hand just proximal to the metacarpal heads, and the
    # knuckle arc then reads as a ridge instead of as a slightly thicker pillow.
    sk.add("palm3", (-0.002, 0.072, 0.0035), (0.0360, 0.0092), parent="palm2")

    # ---- the knuckle arc. Chained rather than fanned from one point: four
    # edges off a single vertex makes a lumpy star junction, whereas a chain
    # through the metacarpal heads IS the knuckle ridge and gives the surface
    # the feature the whole read depends on.
    # Every knuckle hangs off the SAME palm vertex. The obvious alternative --
    # chaining the metacarpal heads to each other so the arc is literally a ridge
    # -- turns nearly ninety degrees at each end where the arc meets a finger,
    # and the Skin modifier folds that turn into a flat shard sticking out of the
    # back of the hand. It survived hiding the nails, skipping the fingertip
    # taper and skipping the weld, which is how it was traced to the junction
    # rather than tuned around for a fourth round. Raising branch_smoothing made
    # it larger. A fan has no turn to fold.
    sk.add("k_middle", tuple(MCP["middle"]), (0.0128, 0.0163), parent="palm3")
    sk.add("k_index", tuple(MCP["index"]), (0.0122, 0.0158), parent="palm3")
    sk.add("k_ring", tuple(MCP["ring"]), (0.0120, 0.0155), parent="palm3")
    sk.add("k_little", tuple(MCP["little"]), (0.0106, 0.0138), parent="palm3")

    # ---- fingers
    fingers = {}
    for name in ("index", "middle", "ring", "little"):
        joints, tip_dir, axis = finger_joints(name)
        r = JOINT_R[name]
        parent = f"k_{name}"
        for i in range(1, 4):
            # A vertex mid-phalanx as well as at each joint. With joints only,
            # the Skin modifier bulges at every one and the finger reads as a
            # string of sausages; a point in between lets the segment pinch, and
            # the pinch-and-swell is what makes a finger read as jointed.
            mid = joints[i - 1].lerp(joints[i], 0.55)
            parent = sk.add(f"{name}{i}m", tuple(mid),
                            (r[i - 1] + r[i]) * 0.5 * 0.955, parent=parent)
            parent = sk.add(f"{name}{i}", tuple(joints[i]), r[i], parent=parent)
        fingers[name] = {"joints": joints, "dir": tip_dir, "axis": axis}

    # ---- thenar: the ball of the thumb, biggest soft mass on a hand and the
    # thing that makes a gripping hand look like it is gripping. It is the fat
    # radius on the first thumb bone, not a separate lump.
    thumb = [Vector((0.0255, 0.0330, -0.0060)), Vector((0.0515, 0.0470, -0.0165)),
             Vector((0.0555, 0.0700, -0.0125)), Vector((0.0505, 0.0862, -0.0070))]
    sk.add("t_cmc", tuple(thumb[0]), (0.0166, 0.0140), parent="palm1")
    sk.add("t_mcp", tuple(thumb[1]), 0.0122, parent="t_cmc")
    sk.add("t_ip", tuple(thumb[2]), 0.0103, parent="t_mcp")
    sk.add("t_tip", tuple(thumb[3]), 0.0076, parent="t_ip")

    # ---- hypothenar: the pad along the little-finger edge, deeper than people
    # expect, and the reason the ulnar silhouette of a fist is a curve.
    sk.add("hy1", (-0.0245, 0.0345, 0.0000), (0.0138, 0.0126), parent="palm1")
    sk.add("hy2", (-0.0310, 0.0605, 0.0015), (0.0124, 0.0116), parent="hy1")

    return sk, fingers, thumb


# ---------------------------------------------------------------------------


def segment_distance(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.dot(ab))))
    return (p - (a + ab * t)).length


def fit_shaft(fingers, palm_points):
    """Measure the handle this curl is actually holding.

    Two earlier versions of this were wrong in opposite directions and both
    reported a number that looked like an answer.

    The first searched for the point furthest from every finger and reported a
    95 mm handle, because nothing bounded it: the further it walked from the hand
    the better its score, so it walked to the edge of its own search window and
    reported that.

    The second started at the centroid of each finger's joints and refined within
    8 mm. But the centroid of a tightly curled finger lands ON the finger, not in
    the void it encloses, so the search began inside solid geometry and could
    never reach the grip. That is why opening the curl by twenty-four degrees
    moved the reported handle by 0.6 mm -- the number was not measuring the curl
    at all.

    What actually defines the handle is ENCLOSURE: a point is in the grip only if
    the things around it surround it. So this sweeps the whole plausible region
    and keeps the largest circle whose contacts span every direction -- if all
    the nearby surfaces lie to one side, the point is beside the hand rather than
    inside its grip, however much clearance it has.
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
        segments.append((Vector(p), Vector(p), 0.0110))

    u = axis.cross(Vector((0, 0, 1)))
    if u.length < 1e-6:
        u = axis.cross(Vector((0, 1, 0)))
    u.normalize()
    v = axis.cross(u).normalized()

    def closest_on(p, a, b):
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.dot(ab))))
        return a + ab * t

    def enclosed(p):
        """Do the surrounding surfaces span every direction, or only one side?"""
        angles = []
        for a, b, r in segments:
            d = closest_on(p, a, b) - p
            if d.length > 0.055:
                continue
            angles.append(math.atan2(d.dot(v), d.dot(u)))
        if len(angles) < 3:
            return False
        angles.sort()
        gaps = [angles[i + 1] - angles[i] for i in range(len(angles) - 1)]
        gaps.append(angles[0] + 2 * math.pi - angles[-1])
        return max(gaps) < math.radians(170)

    origin = Vector((0, 0, 0))
    for f in fingers.values():
        origin += f["joints"][1]
    origin /= len(fingers)

    best = (origin, -1e9)
    step = 0.0012
    n = int(0.040 / step)
    for i in range(-n, n + 1):
        for k in range(-n, n + 1):
            p = origin + u * (i * step) + v * (k * step)
            if not enclosed(p):
                continue
            clearance = min((p - closest_on(p, a, b)).length - r for a, b, r in segments)
            if clearance > best[1]:
                best = (p, clearance)
    if best[1] < -1e8:
        print("  WARNING: no enclosed point found; this curl does not close on anything")
        return origin, axis, 0.0
    return best[0], axis, best[1]


def nail(name, hand_obj, base_inside, tip_dir, axis, width, length, grip_centre):
    """Place a nail ON the skin by raycasting the finished surface.

    An earlier build placed nails by arithmetic and they came out floating clear
    of the fingers -- the same class of fault as the rake's bristles in air. A ray
    from inside the distal phalanx outward through the dorsal side hits the skin
    exactly where the nail bed is, whatever the surface did.
    """
    # A nail faces AWAY FROM THE THING BEING GRIPPED. That is the definition
    # that survives a curl: "up" and "away from the hand centre" both point into
    # the palm for some fingers once they close, and the index and thumb nails
    # came out as shards stuck through the back of the hand because of it.
    dorsal = axis.cross(tip_dir).normalized()
    if dorsal.dot(base_inside - grip_centre) < 0:
        dorsal = -dorsal

    # Cast from just outside THIS finger, not from far away. A ray starting
    # 45 mm out crosses the palm on its way back in and hits the palm first,
    # which is exactly how a nail ended up on the back of the hand. Starting a
    # bit more than one finger-width out can only hit the finger it belongs to.
    reach = max(0.010, width * 1.7)
    start = base_inside + dorsal * reach
    hit, location, normal, _ = hand_obj.ray_cast(start, -dorsal, distance=reach * 1.7)
    if not hit:
        raise SystemExit(
            f"BUILD FAILED: no skin found for {name}; the nail would float. "
            f"ray from {tuple(round(c, 4) for c in start)} "
            f"toward {tuple(round(c, 3) for c in -dorsal)}")
    normal = normal.normalized()
    along = (tip_dir - normal * tip_dir.dot(normal)).normalized()
    across = normal.cross(along).normalized()

    verts, faces = [], []
    cols, rows = 6, 5
    for r in range(rows):
        t = r / (rows - 1)
        for c in range(cols):
            s = c / (cols - 1) * 2 - 1
            half = width * 0.5 * (0.78 + 0.22 * math.sin(math.pi * (0.30 + 0.70 * t)))
            shrink = 1.0 - 0.32 * max(0.0, (t - 0.68) / 0.32) ** 2
            dome = (1.0 - s * s) * 0.0010
            verts.append(location + along * (length * (t - 0.30))
                         + across * (s * half * shrink)
                         + normal * (dome - 0.0013))
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
    return obj


# ---------------------------------------------------------------------------


def skin_material():
    mat = bpy.data.materials.new("Skin")
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.500, 0.252, 0.168, 1.0)
    b.inputs["Roughness"].default_value = 0.50
    # Skin is translucent. Without this the hand reads as painted plastic
    # however good the silhouette is, and "coloured geometry" is exactly what
    # the review is looking for.
    for key, value in (("Subsurface Weight", 0.28), ("Subsurface Scale", 0.008)):
        if key in b.inputs:
            b.inputs[key].default_value = value
    if "Subsurface Radius" in b.inputs:
        b.inputs["Subsurface Radius"].default_value = (0.034, 0.013, 0.008)
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.40
    return mat


def nail_material():
    mat = bpy.data.materials.new("Nail")
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.596, 0.330, 0.268, 1.0)
    b.inputs["Roughness"].default_value = 0.20
    if "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = 0.40
        b.inputs["Coat Roughness"].default_value = 0.14
    return mat


def shaft_material():
    mat = bpy.data.materials.new("Shaft")
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.170, 0.094, 0.048, 1.0)
    b.inputs["Roughness"].default_value = 0.42
    return mat


# ---------------------------------------------------------------------------


def main():
    args = H.argv_after_dashes()
    engine = "CYCLES" if "cycles" in args else "EEVEE"
    global SUFFIX
    for flag in ("no-taper", "no-weld"):
        if flag in args:
            SUFFIX += "-" + flag
    H.reset_scene()
    H.set_engine(engine, samples=160 if engine == "CYCLES" else 96)

    sk, fingers, thumb = build_skeleton()

    # Digits that are meant to be separate must not be inside one another. The
    # thumb tip sat inside the index knuckle for three rounds and came out of the
    # solver as a flat shard through the back of the hand.
    S.assert_digits_do_not_interpenetrate(sk, {
        # The knuckle arc is deliberately a continuous ridge -- the metacarpal
        # heads abut and are chained in the skeleton -- so the check starts past
        # them, at the free part of each digit where separation is the point.
        "index": ["index1", "index2m", "index2", "index3m", "index3"],
        "middle": ["middle1", "middle2m", "middle2", "middle3m", "middle3"],
        "ring": ["ring1", "ring2m", "ring2", "ring3m", "ring3"],
        "little": ["little1", "little2m", "little2", "little3m", "little3"],
        "thumb": ["t_mcp", "t_ip", "t_tip"],
    })

    hand = sk.build("Hand", subdivisions=2)
    hand = S.apply_modifiers(hand)
    print(f"  skinned and subdivided to {len(hand.data.polygons)} faces")

    # No squash pass. The width and thickness are in the skeleton's own radii
    # now, which is both simpler and safer: every squash variant moved geometry
    # that the nail rays and the grip measurement had already been calculated
    # against, and both of those failed silently before the build caught them.

    # Fingertips: the skin modifier caps a chain flat, which reads as a cut-off
    # dowel and is the most obvious "modelled hand" tell after the silhouette.
    if "no-taper" not in args:
        for name, f in fingers.items():
            S.taper_tip(hand, f["joints"][3], JOINT_R[name][3], squash=0.42)
        S.taper_tip(hand, thumb[3], 0.0076, squash=0.42)
    if "no-weld" not in args:
        S.weld(hand)

    bpy.context.view_layer.objects.active = hand
    bpy.ops.object.shade_smooth()

    lo, hi = H.bounds([hand])
    knuckle_span = (MCP["index"].x - MCP["little"].x) + JOINT_R["index"][0] + JOINT_R["little"][0]
    print(f"  bounds x {lo.x:+.4f}..{hi.x:+.4f}  y {lo.y:+.4f}..{hi.y:+.4f}"
          f"  z {lo.z:+.4f}..{hi.z:+.4f}")
    print(f"  breadth across knuckles {knuckle_span:.4f} m (target {BREADTH:.3f})")

    # Sampled PROXIMAL of the knuckles and dorsal of the deep curl. The obvious
    # band -- mid-palm, near the centre line -- is where the fingertips come to
    # rest once the hand closes, so it was reporting the depth of the whole fist
    # and calling it the palm.
    zs = [v.co.z for v in hand.data.vertices
          if 0.026 < v.co.y < 0.050 and abs(v.co.x) < 0.014 and v.co.z > -0.022]
    if zs:
        print(f"  palm thickness {max(zs) - min(zs):.4f} m (anatomical 0.026), "
              f"sampled on {len(zs)} vertices")


    # ---- the grip, measured before the nails: they aim away from it
    centre, axis, clearance = fit_shaft(fingers, [(-0.002, 0.048, 0.004), (-0.002, 0.074, 0.006)])
    print(f"  handle this grip encloses: radius {clearance:.4f} m "
          f"({clearance * 2000:.1f} mm across), target {SHAFT_TARGET * 2000:.0f} mm")

    # ---- nails
    nails = []
    NAIL = {"index": (0.0088, 0.0122), "middle": (0.0091, 0.0128),
            "ring": (0.0086, 0.0119), "little": (0.0074, 0.0099)}
    for name, f in fingers.items():
        w, l = NAIL[name]
        j = f["joints"]
        nails.append(nail(f"Nail_{name}", hand, j[2].lerp(j[3], 0.45),
                          f["dir"], f["axis"], w, l, centre))
    t_dir = (thumb[3] - thumb[2]).normalized()
    nails.append(nail("Nail_thumb", hand, thumb[2].lerp(thumb[3], 0.45), t_dir,
                      t_dir.cross(Vector((0, 0, 1))).normalized(), 0.0090, 0.0116, centre))
    print(f"  {len(nails)} nails raycast onto the skin (none floating)")

    skin, nailmat = skin_material(), nail_material()
    hand.data.materials.append(skin)
    for n in nails:
        n.data.materials.append(nailmat)
        bpy.context.view_layer.objects.active = n
        bpy.ops.object.shade_smooth()

    dec = hand.modifiers.new("Decimate", "DECIMATE")
    dec.ratio = 1.0
    bpy.context.view_layer.update()
    raw = H.triangles([hand])
    dec.ratio = min(1.0, float(TRI_BUDGET) / max(1, raw))
    bpy.context.view_layer.update()
    subject = [hand] + nails
    print(f"TRIS {H.triangles(subject)} (from {raw} raw)   "
          f"{len(subject)} objects / 2 materials")

    # ---- the shaft, placed where the grip actually is
    bpy.ops.mesh.primitive_cylinder_add(
        radius=max(0.008, min(SHAFT_TARGET, clearance)), depth=0.52,
        location=centre, vertices=32)
    shaft = bpy.context.active_object
    shaft.name = "ShaftProxy"
    shaft.rotation_mode = "QUATERNION"
    shaft.rotation_quaternion = axis.to_track_quat("Z", "Y")
    shaft.data.materials.append(shaft_material())
    bpy.ops.object.shade_smooth()

    # ---- renders, framed from the subject rather than by eye
    centre_view, sphere_r = H.subject_sphere(subject, weight_y=(-0.030, 0.140))
    LENS = 76.0
    dist = H.fit_distance(sphere_r, LENS, res=(1100, 1100), margin=1.24)
    H.studio(center=centre_view, scale=sphere_r)
    H.backdrop(center=centre_view, scale=sphere_r)
    print(f"  framing radius {sphere_r:.4f} m, camera at {dist:.3f} m")

    tt = H.turntable(centre_view, dist, OUT_RENDER, "hand", views=8, elevation=16.0,
                     lens=LENS, res=(760, 760))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, "hand-turntable.png"), cols=4)

    # The detail shots frame the HAND, not the whole subject. Orbiting the
    # subject centre put the "dorsal" camera looking straight down the forearm,
    # so the back of the hand was never in any of those frames and the forearm
    # seen end-on read as a pillow swallowing the fingers -- a camera fault I
    # spent two rounds trying to model my way out of.
    hand_only = [v.co for v in hand.data.vertices if v.co.y > 0.012]
    hx = sorted(v.x for v in hand_only)
    hy = sorted(v.y for v in hand_only)
    hz = sorted(v.z for v in hand_only)
    hand_c = Vector(((hx[0] + hx[-1]) * 0.5, (hy[0] + hy[-1]) * 0.5, (hz[0] + hz[-1]) * 0.5))
    hand_r = 0.5 * math.sqrt((hx[-1] - hx[0]) ** 2 + (hy[-1] - hy[0]) ** 2 + (hz[-1] - hz[0]) ** 2)
    hand_d = H.fit_distance(hand_r, LENS, res=(1100, 1100), margin=1.22)
    print(f"  hand-only framing: radius {hand_r:.4f} m, camera at {hand_d:.3f} m")

    for label, az, el in (("hero", -128, 22),      # three-quarter, thumb side
                          ("dorsal", -90, 74),     # straight down on the back
                          ("palmar", -90, -66),    # straight up at the palm
                          ("ulnar", 178, 8),       # little-finger edge
                          ("radial", 4, 8)):       # thumb edge
        cam = H.camera(label, H.orbit_position(hand_c, hand_d, az, el), hand_c, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"hand-{label}{SUFFIX}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject + [shaft], cam,
                         os.path.join(OUT_RENDER, "hand-silhouette.png"), res=(900, 900))
        if label == "dorsal":
            # CONTROL: the same frame with the nails hidden. A lump on the back
            # of the hand is either a nail in the wrong place or the skin itself,
            # and those need completely different fixes -- this says which
            # without anyone having to guess from one picture.
            for n in nails:
                n.hide_render = True
            H.render(cam, os.path.join(OUT_RENDER, "hand-dorsal-nonails.png"), res=(1100, 1100))
            for n in nails:
                n.hide_render = False

    # ---- APPARENT SIZE. Game camera is 66 deg vertical FOV at 16:9. In
    # hand-v8-lit.png the hand-and-forearm cluster spans about 9% of frame width,
    # so the camera sits at the distance reproducing that angular size on a
    # real-scale hand: the same pixels on screen, correctly lit for once.
    hfov = 2 * math.atan(math.tan(math.radians(66) / 2) * 16 / 9)
    d = (0.115 / 0.09) / (2 * math.tan(hfov / 2))
    app = H.camera_fov("Apparent", H.orbit_position(centre_view, d, -122, 20), centre_view, 66.0)
    app.data.sensor_fit = "VERTICAL"
    H.render(app, os.path.join(OUT_RENDER, "hand-apparent.png"), res=(1600, 900))
    print(f"  apparent-size camera at {d:.3f} m, 66 deg vertical FOV")

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
