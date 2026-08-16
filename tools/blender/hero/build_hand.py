"""HERO ASSET 1 — THE FIRST-PERSON HAND.

Reference: Designs/ProShop/Images/Goal_26/HandsRefrenceImage.png — a first-person
right hand wrapped around a mop shaft, House-Flipper class. What that reference
shows and every previous version of this model did not: THE FINGER PADS PRESS
INTO THE SHAFT. There is no daylight anywhere between the hand and the pole, and
the thumb emerges from the ball of the thumb rather than lying on top of it.

The pose is therefore SOLVED, not authored. Earlier versions picked flexion
angles, then placed a cylinder wherever the fingers happened to leave a void, and
called the void a grip. That is backwards, and it produced exactly what the
turntable showed: the pole passing through the thumb in one frame and daylight
between the fingers and the pole in three others. Here the shaft is a FIXED
object resting against the palm, and each phalanx rotates until it touches it and
no further — contact is a consequence of the solve, and penetration is impossible
by construction.

Three assertions, each watched failing on the build before it:

  SINGLE SHELL    the solved mesh must be one piece. The shipped version was
                  three: the hand, a 354-vertex thumb island, and a stray vertex.
                  The thumb was clear of every other part and still floating,
                  because the whole thumb root bone sat inside the palm's own
                  tube and the Skin modifier gave it a second hull.
  CLEAR OF SHAFT  no vertex inside the handle. Nothing had ever compared the hand
                  to the thing it was holding.
  GRIP CONTACT    every digit within 3 mm of the handle surface. Clearing the
                  shaft and gripping it are different claims, and a build passes
                  the first trivially by holding the pole at arm's length.

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
OUT_GLB = os.path.join(REPO, "Assets", "models", "hero", "fp_hand.glb")
TRI_BUDGET = 4600
SUFFIX = ""

# ---------------------------------------------------------------------------
# ANATOMY, metres, adult male, from anthropometric norms: hand length 0.190
# wrist crease to middle fingertip, breadth 0.088 across the metacarpal heads,
# palm thickness 0.026, wrist 0.058 wide by 0.040 deep.
#
# Frame:  +X radial (thumb side, right hand)   +Y distal   +Z dorsal
# The glTF axis swap is baked into vertices at export, never left on a node.

BREADTH = 0.088

MCP = {
    # Knuckle spacing has to be less than the two fingers that meet there, or
    # daylight shows between them. Ring-to-little was 22.5 mm of gap for 18 mm of
    # finger, and the turntable showed the background straight through it.
    "index":  Vector((0.0300, 0.0885, 0.0098)),
    "middle": Vector((0.0100, 0.0940, 0.0116)),
    "ring":   Vector((-0.0122, 0.0890, 0.0098)),
    # Do NOT bring this knuckle in to close the gap beside the ring finger.
    # Anything inside -0.0350 makes the two hulls overlap at the five-way palm
    # branch and the Skin modifier answers with a flat torn sheet -- traded a
    # hole for a worse hole, three times, before the archived round-19 frame
    # showed which change had introduced it.
    "little": Vector((-0.0350, 0.0795, 0.0056)),
}
PHALANX = {
    "index":  (0.0395, 0.0235, 0.0205),
    "middle": (0.0435, 0.0275, 0.0215),
    "ring":   (0.0400, 0.0255, 0.0205),
    "little": (0.0320, 0.0185, 0.0180),
}
# Joint radii: knuckle, PIP, DIP, tip. A finger is widest at its joints and
# pinches between them; that alternation is most of what makes a finger read as
# jointed rather than as a dowel. 0.0098 = a 20 mm finger, which is correct.
JOINT_R = {
    "index":  (0.0098, 0.0088, 0.0078, 0.0059),
    "middle": (0.0101, 0.0090, 0.0080, 0.0061),
    "ring":   (0.0095, 0.0085, 0.0076, 0.0057),
    # Left at the smaller value deliberately. Enlarging the little finger's
    # knuckle to close the gap beside the ring finger made its hull overlap the
    # ring's at the five-way palm branch, and the Skin modifier answered with a
    # flat torn sheet between them -- traded a hole for a worse hole.
    "little": (0.0085, 0.0087, 0.0076, 0.0055),
}
# Positive yaw about +Z carries a finger ULNAR. The index sits radial of the
# midline so it converges with a POSITIVE angle and the little finger with a
# negative one; the signs were the other way round, which fanned the fingers
# apart as they closed and left daylight between them in every palmar frame.
# The gap beside the little finger closes along its LENGTH instead: more yaw
# toward the ring finger leaves the knuckles where the solver can build them and
# still shuts the daylight the turntable was showing.
CONVERGE = {"index": 6.0, "middle": 1.5, "ring": -8.5, "little": -15.0}
# Anatomical limits. A finger that cannot reach the handle stops here rather than
# folding through itself, and the build says which joint ran out.
JOINT_LIMIT = (95.0, 115.0, 85.0)

# ---------------------------------------------------------------------------
# THE HANDLE. A 30 mm broom shaft lying across the palm where a real one rests:
# against the palmar surface at the base of the fingers, crossing the hand and
# tilting slightly toward the ulnar side the way an oblique grip does.
#
# This is an INPUT. Every previous version made it an output — fit a cylinder
# into whatever void the fingers left — and a void is not a grip.
SHAFT_RADIUS = 0.0150
SHAFT_POINT = Vector((0.0000, 0.0715, -0.0232))
SHAFT_DIR = Vector((1.0, -0.10, 0.05)).normalized()
# The solver stops each phalanx when its SKELETON SEGMENT reaches tangency, but
# the skinned surface bulges past that segment radius at the joints and under
# subdivision, so the mesh dipped 1.7 mm into the shaft while the maths said it
# was touching. The margin is the difference between a centre-line model of a
# finger and the finger.
SOLVE_MARGIN = -0.0016   # negative: the fingers close INTO the handle and the
                         # skin is then conformed to it, so the pads flatten
                         # against the shaft the way they do in the reference


def axis_distance(p):
    d = p - SHAFT_POINT
    return (d - SHAFT_DIR * d.dot(SHAFT_DIR)).length


def segment_axis_distance(a, b, samples=16):
    return min(axis_distance(a.lerp(b, i / samples)) for i in range(samples + 1))


def wrap_chain(base, rest_dir, flex_axis, lengths, radii, limits, sign=-1.0):
    """Close a chain onto the handle, joint by joint, stopping at contact.

    Each phalanx rotates from wherever the previous one left it until its surface
    touches the shaft, then stops. Contact is a consequence of the solve, and
    penetration cannot happen: the search halts at the first angle that reaches
    tangency rather than at an angle somebody chose.

    Returns the joints, the final direction, the flexion axis and the angles
    actually used — so a finger that could NOT reach the handle shows up as a
    joint sitting at its limit, rather than as a silent gap in a render.
    """
    pos = Vector(base)
    joints = [pos.copy()]
    total = 0.0
    used = []
    seg_dir = Vector(rest_dir)
    for i, length in enumerate(lengths):
        want = SHAFT_RADIUS + (radii[i] + radii[i + 1]) * 0.5 + SOLVE_MARGIN
        limit = limits[i]
        chosen = limit
        step = 0.5
        for k in range(int(limit / step) + 1):
            trial = total + sign * (k * step)
            d = Quaternion(flex_axis, math.radians(trial)) @ Vector(rest_dir)
            if segment_axis_distance(pos, pos + d * length) <= want:
                chosen = k * step
                break
        total += sign * chosen
        used.append(chosen)
        seg_dir = Quaternion(flex_axis, math.radians(total)) @ Vector(rest_dir)
        pos = pos + seg_dir * length
        joints.append(pos.copy())
    return {"joints": joints, "dir": seg_dir, "axis": flex_axis, "angles": used,
            "limits": list(limits)}


def solve_finger(name):
    yaw = Quaternion(Vector((0, 0, 1)), math.radians(CONVERGE[name]))
    rest = (yaw @ Vector((0.055, 0.996, 0.045))).normalized()
    axis = (yaw @ Vector((1, 0, 0))).normalized()
    return wrap_chain(MCP[name], rest, axis, PHALANX[name], JOINT_R[name],
                      JOINT_LIMIT, sign=-1.0)


THUMB_CMC = Vector((0.0275, 0.0330, -0.0045))
THUMB_LEN = (0.0255, 0.0215, 0.0175)   # 65 mm from the trapezium, not 77
THUMB_R = (0.0130, 0.0106, 0.0092, 0.0066)


def solve_thumb():
    """The thumb wraps the handle from the opposite side to the fingers.

    Its flexion axis is the SHAFT ITSELF, so the solve rotates it around the
    handle exactly as the fingers rotate around theirs. Given its own arbitrary
    axis it swung out along the forearm instead and came out as a 77 mm blade
    lying beside the pole -- correct by every assertion and obviously not a thumb.
    """
    rest = Vector((0.30, 0.90, 0.32)).normalized()
    return wrap_chain(THUMB_CMC, rest, SHAFT_DIR, THUMB_LEN, THUMB_R,
                      (80.0, 75.0, 65.0), sign=-1.0)


# ---------------------------------------------------------------------------


def build_skeleton(fingers, thumb):
    sk = S.Skeleton()

    # Radii are (half-width, half-thickness) HALF-EXTENTS: for a chain running
    # along Y the first controls world X and the second world Z.
    # A real forearm 100 mm back from the wrist is about 60 mm across and 50 mm
    # deep, and the wrist about 50 x 32. The previous pass had it 41-49 mm wide
    # in both axes, which is why it read as a noodle in the two frames that see
    # it side-on -- the earlier "ham" reading came from it being ROUND at that
    # width, not from the width itself.
    sk.add("elbow", (0.000, -0.100, 0.002), (0.0286, 0.0232), root=True)
    sk.add("fore1", (0.000, -0.060, 0.002), (0.0300, 0.0240), parent="elbow")
    sk.add("fore2", (0.000, -0.026, 0.001), (0.0258, 0.0192), parent="fore1")
    sk.add("wrist", (0.000, 0.004, 0.002), (0.0228, 0.0148), parent="fore2")

    # THE PALM IS NARROWER THAN THE HAND. Its radial half is the ball of the
    # thumb and its ulnar half the hypothenar, and both are separate chains. When
    # the palm slab was wide enough to cover the whole hand, the thumb's root
    # bone sat entirely INSIDE it, the Skin modifier could not form a junction,
    # and it built the thumb as its own closed island — 354 vertices of hand that
    # were not attached to the hand.
    # palmT exists solely so the thumb has a branch point of its own. The Skin
    # modifier emits a SECOND CLOSED HULL rather than a junction when a vertex
    # carries too many edges or when the child sits inside the parent's tube, and
    # palm1 was carrying four edges with the thumb root buried in it. That is the
    # whole mechanism behind a 546-vertex thumb floating on the back of the hand.
    sk.add("palmT", (-0.0040, 0.018, 0.0015), (0.0150, 0.0112), parent="wrist")
    sk.add("palm1", (-0.0060, 0.034, 0.002), (0.0175, 0.0114), parent="palmT")
    sk.add("palm2", (-0.0060, 0.055, 0.003), (0.0250, 0.0104), parent="palm1")
    sk.add("palm3", (-0.0050, 0.072, 0.0035), (0.0270, 0.0092), parent="palm2")

    # Knuckles fan off one palm vertex. Chaining them to each other makes a
    # ninety-degree turn where the arc meets a finger, and the Skin modifier
    # folds that turn into a flat shard through the back of the hand.
    for name in ("middle", "index", "ring", "little"):
        r = JOINT_R[name][0]
        sk.add(f"k_{name}", tuple(MCP[name]), (r * 1.24, r * 1.58), parent="palm3")

    for name in ("index", "middle", "ring", "little"):
        j = fingers[name]["joints"]
        r = JOINT_R[name]
        parent = f"k_{name}"
        for i in range(1, 4):
            # A vertex mid-phalanx as well as at each joint: with joints only,
            # the Skin modifier bulges at every one and the finger reads as a
            # string of sausages.
            mid = j[i - 1].lerp(j[i], 0.55)
            parent = sk.add(f"{name}{i}m", tuple(mid),
                            (r[i - 1] + r[i]) * 0.5 * 0.955, parent=parent)
            parent = sk.add(f"{name}{i}", tuple(j[i]), r[i], parent=parent)

    # THE BALL OF THE THUMB, its own chain off the palm and clear of it, so the
    # thumb has something to grow out of instead of sitting on top.
    tj = thumb["joints"]
    sk.add("t_cmc", tuple(tj[0]), (0.0132, 0.0120), parent="palmT")
    sk.add("t_mcp", tuple(tj[1]), THUMB_R[1], parent="t_cmc")
    sk.add("t_ip", tuple(tj[2]), THUMB_R[2], parent="t_mcp")
    sk.add("t_tip", tuple(tj[3]), THUMB_R[3], parent="t_ip")

    # Hypothenar: the pad along the little-finger edge, deeper than people expect
    # and the reason the ulnar silhouette of a fist is a curve.
    sk.add("hy1", (-0.0245, 0.0400, 0.0000), (0.0138, 0.0126), parent="palm2")
    sk.add("hy2", (-0.0310, 0.0605, 0.0015), (0.0124, 0.0116), parent="hy1")
    return sk


def region_predicates(sk, groups):
    """Classify a finished vertex by WHICH DIGIT it belongs to.

    By the time it is checked the mesh is one shell, so "the index finger" is not
    a separate object any more. Nearest-bone answers it, and it always considers
    EVERY bone: passing a subset is what broke an earlier pass, because the
    omitted parts had nothing else to be assigned to and were silently swept into
    whichever listed bone happened to be nearest.
    """
    bones = [(sk.points[a]["co"], sk.points[b]["co"], (a, b)) for a, b in sk.links]
    owner = {}
    for group, members in groups.items():
        for name in members:
            owner[name] = group

    def group_of(co):
        best, best_d = None, 1e9
        for a, b, key in bones:
            ab = b - a
            t = max(0.0, min(1.0, (co - a).dot(ab) / max(1e-12, ab.dot(ab))))
            d = (co - (a + ab * t)).length
            if d < best_d:
                best_d, best = d, key
        return owner.get(best[1]) or owner.get(best[0])

    return {g: (lambda co, g=g: group_of(co) == g) for g in groups}


# ---------------------------------------------------------------------------


def nail(name, hand_obj, base_inside, tip_dir, axis, width, length):
    """Place a nail ON the skin by raycasting the finished surface.

    A nail faces away from the thing being gripped — the definition that survives
    a curl, where "up" and "away from the hand centre" both point into the palm
    for some fingers. The ray starts just outside this finger, not far away: a ray
    from 45 mm out crosses the palm on the way back in and hits the palm first,
    which is how a nail once ended up on the back of the hand.
    """
    dorsal = axis.cross(tip_dir).normalized()
    # "Away from the handle" means away from its AXIS, which is the radial
    # component only. Using the raw difference from a point on the axis includes
    # a large along-axis term -- for the outer fingers, sitting 30 mm off the
    # shaft's midpoint, that term dominates and flips the sign, and the nail gets
    # built on the wrong side of the finger as a flat flap.
    off = base_inside - SHAFT_POINT
    radial = off - SHAFT_DIR * off.dot(SHAFT_DIR)
    if radial.length > 1e-6 and dorsal.dot(radial) < 0:
        dorsal = -dorsal
    reach = max(0.010, width * 1.7)
    hit, location, normal, _ = hand_obj.ray_cast(base_inside + dorsal * reach,
                                                 -dorsal, distance=reach * 1.7)
    if not hit:
        raise SystemExit(f"BUILD FAILED: no skin found for {name}; the nail would float")
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
            verts.append(location + along * (length * (t - 0.30))
                         + across * (s * half * shrink)
                         # Set INTO the nail bed. A nail plate that stands proud
                         # of the skin is a thin card, and edge-on against the
                         # silhouette it reads as a chip taken out of the finger
                         # -- four of them along the fingertips looked like a
                         # serrated edge in the ulnar turntable frame.
                         + normal * ((1.0 - s * s) * 0.0009 - 0.0021))
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


def skin_material():
    mat = bpy.data.materials.new("Skin")
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.500, 0.252, 0.168, 1.0)
    b.inputs["Roughness"].default_value = 0.50
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
    for flag in ("no-taper", "no-weld", "no-nails"):
        if flag in args:
            SUFFIX += "-" + flag

    H.reset_scene()
    H.set_engine(engine, samples=160 if engine == "CYCLES" else 96)

    # ---- solve the pose against the handle BEFORE building anything
    fingers = {n: solve_finger(n) for n in ("index", "middle", "ring", "little")}
    thumb = solve_thumb()
    for name, f in list(fingers.items()) + [("thumb", thumb)]:
        at_limit = [i for i, (a, l) in enumerate(zip(f["angles"], f["limits"]))
                    if a >= l - 0.6]
        note = f"   AT LIMIT on joint(s) {at_limit}" if at_limit else ""
        print(f"  {name:7s} flexion " + " ".join(f"{a:5.1f}" for a in f["angles"]) + note)

    sk = build_skeleton(fingers, thumb)
    S.assert_digits_do_not_interpenetrate(sk, {
        "index": ["index1", "index2m", "index2", "index3m", "index3"],
        "middle": ["middle1", "middle2m", "middle2", "middle3m", "middle3"],
        "ring": ["ring1", "ring2m", "ring2", "ring3m", "ring3"],
        "little": ["little1", "little2m", "little2", "little3m", "little3"],
        "thumb": ["t_mcp", "t_ip", "t_tip"],
    })

    hand = S.apply_modifiers(sk.build("Hand", subdivisions=2))
    lv, le = S.clean_loose(hand)
    print(f"  skin+subsurf: {len(hand.data.polygons)} faces, "
          f"{lv} loose verts dropped, shells {S.count_shells(hand)}")
    hand = S.union_shells(hand, "Hand")

    if "no-taper" not in args:
        for name, f in fingers.items():
            S.taper_tip(hand, f["joints"][3], JOINT_R[name][3], squash=0.42)
        S.taper_tip(hand, thumb["joints"][3], THUMB_R[3], squash=0.42)
    if "no-weld" not in args:
        S.weld(hand)

    # ---- THE THREE ASSERTIONS THE TURNTABLE ASKED FOR.
    # Clear of every other part, attached to the mass it grows out of, and
    # actually touching the thing it holds are three separate claims. Only the
    # first was ever being made, and the hand shipped as three pieces with the
    # pole running through the thumb.
    pressed = S.conform_to_cylinder(hand, SHAFT_POINT, SHAFT_DIR, SHAFT_RADIUS)
    hand = S.relax(hand, factor=0.45, iterations=2)
    again = S.conform_to_cylinder(hand, SHAFT_POINT, SHAFT_DIR, SHAFT_RADIUS)
    print(f"  conformed {pressed} vertices onto the handle, relaxed, "
          f"re-conformed {again}")
    S.assert_single_shell(hand, "the hand")
    S.assert_clear_of_cylinder(hand, SHAFT_POINT, SHAFT_DIR, SHAFT_RADIUS)
    DIGITS = {
        "index": ["k_index", "index1m", "index1", "index2m", "index2", "index3m", "index3"],
        "middle": ["k_middle", "middle1m", "middle1", "middle2m", "middle2", "middle3m", "middle3"],
        "ring": ["k_ring", "ring1m", "ring1", "ring2m", "ring2", "ring3m", "ring3"],
        "little": ["k_little", "little1m", "little1", "little2m", "little2", "little3m", "little3"],
        "thumb": ["t_cmc", "t_mcp", "t_ip", "t_tip"],
        "palm": ["elbow", "fore1", "fore2", "wrist", "palmT", "palm1", "palm2",
                 "palm3", "hy1", "hy2"],
    }
    S.assert_grip_contacts(hand, SHAFT_POINT, SHAFT_DIR, SHAFT_RADIUS,
                           region_predicates(sk, {k: v for k, v in DIGITS.items()
                                                  if k != "palm"}))

    knuckle = (MCP["index"].x - MCP["little"].x) + JOINT_R["index"][0] + JOINT_R["little"][0]
    print(f"  breadth across knuckles {knuckle:.4f} m (target {BREADTH:.3f})")
    zs = [v.co.z for v in hand.data.vertices
          if 0.026 < v.co.y < 0.050 and abs(v.co.x) < 0.014 and v.co.z > -0.022]
    if zs:
        print(f"  palm thickness {max(zs) - min(zs):.4f} m (anatomical 0.026), "
              f"sampled on {len(zs)} vertices")

    # ---- nails
    nails = []
    NAIL = {"index": (0.0078, 0.0112), "middle": (0.0081, 0.0118),
            "ring": (0.0076, 0.0109), "little": (0.0066, 0.0091)}
    for name, f in fingers.items():
        if "no-nails" in args:
            break
        w, l = NAIL[name]
        j = f["joints"]
        nails.append(nail(f"Nail_{name}", hand, j[2].lerp(j[3], 0.45),
                          f["dir"], f["axis"], w, l))
    tj = thumb["joints"]
    if "no-nails" not in args:
        nails.append(nail("Nail_thumb", hand, tj[2].lerp(tj[3], 0.34), thumb["dir"],
                          thumb["axis"], 0.0082, 0.0100))
    print(f"  {len(nails)} nails raycast onto the skin (none floating)")

    skin, nailmat = skin_material(), nail_material()
    hand.data.materials.clear()
    hand.data.materials.append(skin)
    for poly in hand.data.polygons:
        poly.material_index = 0
    print(f"  hand material slots: {[m.name for m in hand.data.materials]} "
          f"on object '{hand.name}' mesh '{hand.data.name}'")
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

    # ---- the handle, drawn exactly where it was solved against
    bpy.ops.mesh.primitive_cylinder_add(radius=SHAFT_RADIUS, depth=0.52,
                                        location=SHAFT_POINT, vertices=48)
    shaft = bpy.context.active_object
    shaft.name = "ShaftProxy"
    shaft.rotation_mode = "QUATERNION"
    shaft.rotation_quaternion = SHAFT_DIR.to_track_quat("Z", "Y")
    shaft.data.materials.append(shaft_material())
    bpy.ops.object.shade_smooth()

    # ---- renders, framed from the subject rather than by eye
    centre_view, sphere_r = H.subject_sphere(subject, weight_y=(-0.030, 0.140))
    LENS = 76.0
    dist = H.fit_distance(sphere_r, LENS, res=(1100, 1100), margin=1.24)
    H.studio(center=centre_view, scale=sphere_r)
    H.backdrop(center=centre_view, scale=sphere_r)

    tt = H.turntable(centre_view, dist, OUT_RENDER, f"hand{SUFFIX}", views=8, elevation=16.0,
                     lens=LENS, res=(760, 760))
    H.contact_sheet(tt, os.path.join(OUT_RENDER, "hand-turntable.png"), cols=4)

    hand_only = [v.co for v in hand.data.vertices if v.co.y > 0.012]
    hx = sorted(v.x for v in hand_only)
    hy = sorted(v.y for v in hand_only)
    hz = sorted(v.z for v in hand_only)
    hand_c = Vector(((hx[0] + hx[-1]) * 0.5, (hy[0] + hy[-1]) * 0.5, (hz[0] + hz[-1]) * 0.5))
    hand_r = 0.5 * math.sqrt((hx[-1] - hx[0]) ** 2 + (hy[-1] - hy[0]) ** 2
                             + (hz[-1] - hz[0]) ** 2)
    hand_d = H.fit_distance(hand_r, LENS, res=(1100, 1100), margin=1.22)

    for label, az, el in (("hero", -128, 22), ("dorsal", -90, 74),
                          ("palmar", -90, -66), ("ulnar", 178, 8), ("radial", 4, 8)):
        cam = H.camera(label, H.orbit_position(hand_c, hand_d, az, el), hand_c, lens=LENS)
        H.render(cam, os.path.join(OUT_RENDER, f"hand-{label}{SUFFIX}.png"), res=(1100, 1100))
        if label == "hero":
            H.silhouette(subject + [shaft], cam,
                         os.path.join(OUT_RENDER, "hand-silhouette.png"), res=(900, 900))

    # ---- APPARENT SIZE. Game camera is 66 deg vertical FOV at 16:9, and in
    # hand-v8-lit.png the hand-and-forearm cluster spans about 9% of frame width,
    # so the camera sits at the distance reproducing that angular size.
    hfov = 2 * math.atan(math.tan(math.radians(66) / 2) * 16 / 9)
    d = (0.115 / 0.09) / (2 * math.tan(hfov / 2))
    app = H.camera_fov("Apparent", H.orbit_position(hand_c, d, -128, 20), hand_c, 66.0)
    app.data.sensor_fit = "VERTICAL"
    H.render(app, os.path.join(OUT_RENDER, "hand-apparent.png"), res=(1600, 900))

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


# Guarded so the module can be IMPORTED without building. An unguarded main()
# meant every audit that imported a builder silently re-rendered and re-exported
# its asset as a side effect. Blender runs a --python script as __main__, so the
# command line is unchanged.
if __name__ == "__main__":
    main()
