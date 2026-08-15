"""Hard-surface helpers, and the assertion that has failed twice in this project.

"Many small things attached to one big thing" is the shape of both the mop's
strands and the rake's bristles, and both shipped FLOATING IN AIR. Neither had a
check, and neither fault is visible in any number you would naturally print --
a bristle 5 mm below its block has a perfectly reasonable position, length and
triangle count.

So the property is ROOT and CONNECTION, measured on the geometry:

  assert_rooted     every small part must have vertices genuinely INSIDE the
                    host's volume, by a real depth. Not "near", not "aligned
                    with" -- inside, measured by closest-point-on-mesh and the
                    sign of the surface normal.
  assert_touching   two separate parts that are meant to meet must have surfaces
                    within a tolerance of each other.
  assert_one_piece  a part that is meant to be a single continuous object -- a
                    pan and its lip -- must be one shell.

Single-shell does NOT apply to these assets as a whole: a broom legitimately has
a block, a ferrule and bristles as separate objects. Root and connection are the
properties, not one shell.
"""

import math

import bpy
import bmesh
from mathutils import Vector


# ---------------------------------------------------------------------------
# the assertions


def point_depth_inside(host, p_world):
    """How far inside `host` is world point `p_world`? Negative means outside.

    Uses closest-point-on-mesh and the sign of the surface normal, which is exact
    for the convex blocks and shells these assets are made of.

    The point is converted into the HOST'S LOCAL SPACE first, because
    closest_point_on_mesh takes local coordinates. The first version passed world
    coordinates straight in, which is silently correct for a host whose origin
    happens to sit at the world origin -- true for the broom block and the
    dustpan pan, and false for the spray bottle's head, where it reported a
    nozzle sunk 7 mm into the head as being 2.2 mm outside it.
    """
    local = host.matrix_world.inverted() @ p_world
    ok, loc, nrm, _ = host.closest_point_on_mesh(local)
    if not ok:
        return -1e9
    return -(local - loc).dot(nrm.normalized())


def assert_rooted(parts, host, label, min_verts=3, min_depth=0.0015):
    """Every small part must be genuinely seated in the big one.

    This is the check the mop's strands and the rake's bristles never had. It
    measures the PART'S OWN VERTICES against the host volume, so it cannot be
    satisfied by a root position that some other code was supposed to honour.
    """
    faults = []
    shallow = []
    for part in parts:
        mw = part.matrix_world
        depths = sorted((point_depth_inside(host, mw @ v.co) for v in part.data.vertices),
                        reverse=True)
        inside = [d for d in depths if d >= min_depth]
        if len(inside) < min_verts:
            faults.append(f"{part.name}: only {len(inside)} vertices are "
                          f"{min_depth * 1000:.1f} mm inside {host.name} "
                          f"(deepest {depths[0] * 1000:+.2f} mm)")
        else:
            shallow.append(depths[0])
    if faults:
        raise SystemExit(
            f"BUILD FAILED: {len(faults)} of {len(parts)} {label} are not rooted "
            f"in {host.name}\n  " + "\n  ".join(faults[:6])
            + (f"\n  ... and {len(faults) - 6} more" if len(faults) > 6 else ""))
    print(f"  rooted assertion passed: {len(parts)} {label} seated in "
          f"{host.name}, shallowest {min(shallow) * 1000:.1f} mm deep")


def surface_gap(a, b):
    """Smallest distance from any vertex of `a` to the surface of `b`."""
    mwa = a.matrix_world
    best = 1e9
    for v in a.data.vertices:
        ok, loc, _, _ = b.closest_point_on_mesh(b.matrix_world.inverted() @ (mwa @ v.co))
        if ok:
            best = min(best, ((b.matrix_world @ loc) - (mwa @ v.co)).length)
    return best


def assert_touching(a, b, label, max_gap=0.0015):
    """Connected means ABUTTING or EMBEDDED, and the first version only tested
    the first.

    surface_gap returns an unsigned distance, so a socket sunk 6 mm into a block
    reports a 6 mm "gap" and fails for being too well attached. Anything with
    vertices inside the other part is connected by definition, so that is
    checked first.
    """
    mwa = a.matrix_world
    deepest = max((point_depth_inside(b, mwa @ v.co) for v in a.data.vertices),
                  default=-1e9)
    if deepest > 0.0002:
        print(f"  connection assertion passed: {a.name} is embedded in "
              f"{b.name} by {deepest * 1000:.2f} mm ({label})")
        return
    gap = surface_gap(a, b)
    if gap > max_gap:
        raise SystemExit(
            f"BUILD FAILED: {label} -- {a.name} is {gap * 1000:.2f} mm from "
            f"{b.name} and not embedded in it, so it is not attached")
    print(f"  connection assertion passed: {a.name} meets {b.name} "
          f"at {gap * 1000:.2f} mm ({label})")


def assert_no_overlap(a, b, label, min_gap=0.0008):
    """Two parts that must NOT be inside each other.

    The inverse of assert_touching, and it needs its own instrument: a cloth
    lying against a sponge passes every "is it attached" test precisely because
    it is touching, and interpenetration is invisible from most angles because
    the buried part is buried.
    """
    mwa = a.matrix_world
    deepest = max((point_depth_inside(b, mwa @ v.co) for v in a.data.vertices),
                  default=-1e9)
    if deepest > 0:
        raise SystemExit(
            f"BUILD FAILED: {label} -- {a.name} is {deepest * 1000:.2f} mm INSIDE "
            f"{b.name}. They must sit against each other, not through each other.")
    gap = surface_gap(a, b)
    if gap < min_gap:
        raise SystemExit(
            f"BUILD FAILED: {label} -- {a.name} and {b.name} are only "
            f"{gap * 1000:.2f} mm apart, under the {min_gap * 1000:.1f} mm minimum")
    print(f"  separation assertion passed: {a.name} clears {b.name} by "
          f"{gap * 1000:.2f} mm ({label})")


def assert_fits_inside(interior, size, label, margin=0.0030, samples=5):
    """A box of `size` must fit inside `interior` with clearance all round.

    The shopping bag's whole job is holding goods, and goods have phased through
    it across three playtests. A bag modelled as a shape with no measured cavity
    can only be tested against a guessed rectangle -- so the cavity is real
    geometry and this walks the probe's corners and edge midpoints against it.
    """
    sx, sy, sz = (v * 0.5 for v in size)
    lo, hi = None, None
    for v in interior.data.vertices:
        w = interior.matrix_world @ v.co
        lo = w.copy() if lo is None else Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
        hi = w.copy() if hi is None else Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    # SEARCH for a placement rather than assume one. The first version parked
    # the probe exactly `margin` above the cavity floor and then required
    # `margin` of clearance, so the bottom face sat on the boundary by
    # construction and the test reported +3.00 mm against a 3.0 mm requirement --
    # it was measuring its own placement, not the bag.
    base = (lo + hi) * 0.5
    best = -1e9
    for step in range(9):
        centre = base.copy()
        centre.z = lo.z + sz + (hi.z - lo.z - 2 * sz) * (step / 8.0)
        worst = 1e9
        for i in range(samples):
            for j in range(samples):
                for k in range(samples):
                    if not (i in (0, samples - 1) or j in (0, samples - 1)
                            or k in (0, samples - 1)):
                        continue          # surface of the probe only
                    p = centre + Vector((
                        sx * (2 * i / (samples - 1) - 1),
                        sy * (2 * j / (samples - 1) - 1),
                        sz * (2 * k / (samples - 1) - 1)))
                    worst = min(worst, point_depth_inside(interior, p))
        best = max(best, worst)
    worst = best
    if worst < margin:
        raise SystemExit(
            f"BUILD FAILED: {label} -- a {size[0]:.4f} x {size[1]:.4f} x "
            f"{size[2]:.4f} load does not fit in {interior.name}: the tightest "
            f"corner has {worst:+.5f} of clearance, {margin:.5f} required")
    # Units are whatever the asset is authored in -- metres for the tools, YARDS
    # for the checkout bag, because the game's are. Printing "mm" regardless was
    # a label that would have been believed.
    print(f"  clearance assertion passed: a {size[0]:.4f} x {size[1]:.4f} x "
          f"{size[2]:.4f} load clears {interior.name} by {worst:.5f} at its "
          f"tightest ({label})")


def shells(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    seen, sizes = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, size = [v], 0
        seen.add(v.index)
        while stack:
            cur = stack.pop()
            size += 1
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        sizes.append(size)
    bm.free()
    return sorted(sizes, reverse=True)


def assert_one_piece(obj, label):
    s = shells(obj)
    if len(s) != 1:
        raise SystemExit(f"BUILD FAILED: {label} -- {obj.name} is {len(s)} "
                         f"separate pieces {s[:6]}, and it must be continuous")
    print(f"  continuity assertion passed: {obj.name} is one piece ({label})")


# ---------------------------------------------------------------------------
# construction


def recalc_normals(obj):
    """Make every face point outward.

    Not cosmetic. point_depth_inside decides inside-vs-outside from the SIGN of
    the surface normal, so a mesh wound inward makes the test report the exact
    opposite -- and it does it quietly: a point 106 mm outside a 44 mm sponge
    came back as 106 mm INSIDE it. Every assertion in this module that uses
    depth inherits that lie, which includes the rooting check the bristles rely
    on, so normals are fixed at construction rather than trusted.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def mesh_from(name, verts, faces, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    recalc_normals(ob)
    return ob


def box(name, centre, size, bevel=0.0, segments=2):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=centre)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = Vector(size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        m = ob.modifiers.new("Bevel", "BEVEL")
        m.width = bevel
        m.segments = segments
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(40)
    return ob


def cylinder(name, centre, radius, depth, verts=16, rotation=None, cap="NGON"):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth,
                                        location=centre, vertices=verts,
                                        end_fill_type=cap)
    ob = bpy.context.active_object
    ob.name = name
    if rotation is not None:
        ob.rotation_mode = "QUATERNION"
        ob.rotation_quaternion = rotation
    return ob


def prism(name, base, direction, length, radius_a, radius_b, sides=5, twist=0.0):
    """A tapering n-sided prism -- the cheap unit a bristle tuft is made of.

    Five sides rather than a cylinder: at the size a tuft occupies on screen the
    silhouette difference is invisible and the triangle difference is not.
    """
    d = Vector(direction).normalized()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(up).normalized()
    v = d.cross(u).normalized()
    verts, faces = [], []
    for ring, (t, r) in enumerate(((0.0, radius_a), (1.0, radius_b))):
        centre = Vector(base) + d * (length * t)
        for i in range(sides):
            a = 2 * math.pi * i / sides + twist * t
            verts.append(centre + u * (math.cos(a) * r) + v * (math.sin(a) * r))
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range(sides, sides * 2)))
    return mesh_from(name, verts, faces)


def join(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    return ob


def apply_mods(obj):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    return bpy.context.view_layer.objects.active


def pbr(name, colour, roughness=0.5, metallic=0.0, transmission=0.0, ior=1.45,
        coat=0.0, emission=None, alpha=1.0):
    """`alpha` is the transparency a RASTER engine can draw.

    Transmission is a path-tracing feature. Cycles renders a transmissive bottle
    beautifully and EEVEE renders it as a dark opaque blob -- and the game is a
    raster renderer, so a translucent asset authored with transmission has been
    authored for the engine that will never draw it. Alpha reads in both, and it
    is what a Three.js material would use.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Roughness"].default_value = roughness
    b.inputs["Metallic"].default_value = metallic
    if transmission and "Transmission Weight" in b.inputs:
        b.inputs["Transmission Weight"].default_value = transmission
    if "IOR" in b.inputs:
        b.inputs["IOR"].default_value = ior
    if coat and "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = coat
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        for attr, value in (("blend_method", "BLEND"),
                            ("surface_render_method", "BLENDED")):
            if hasattr(mat, attr):
                try:
                    setattr(mat, attr, value)
                except (TypeError, AttributeError):
                    pass
        if hasattr(mat, "show_transparent_back"):
            mat.show_transparent_back = True
    return mat
