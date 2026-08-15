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


def mesh_from(name, verts, faces, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
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
        coat=0.0, emission=None):
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
    return mat
