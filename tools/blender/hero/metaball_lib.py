"""Metaball construction that knows what Blender actually does.

Two facts, both measured by tools/blender/hero/probe_metaball.py on Blender
5.1.2 rather than assumed, because assuming them cost a whole build:

  1. THE ELLIPSOID ELEMENT PRODUCES NO SURFACE. Not at any size, not at any
     radius from 0.0165 to 0.5, not at any stiffness from 1 to 10. Every
     anisotropic mass in the first hand -- palm, wrist, forearm, thenar,
     hypothenar, every knuckle -- was an ellipsoid, which is why that render
     showed four fingers and a thumb floating in space with no hand behind them.
     Anisotropy has to come from PLACEMENT: rows of capsules make a slab.

  2. THE SURFACE IS NOT AT THE ELEMENT RADIUS. Blender's ball field is
     stiffness * (1 - (d/radius)^2)^3 and the surface is where the sum reaches
     the threshold, so with the defaults (stiffness 2.0, threshold 0.62) the
     surface sits at 0.5685 * radius. Solving that:

         (1 - (d/r)^2)^3 = 0.62/2.0  ->  d/r = 0.5685

     which matches the probe's measured 0.5570 / 0.5685 / 0.5567 across three
     radii. Passing an intended finger radius straight in makes a finger 55% of
     the thickness you asked for, and that is exactly what the first build did.

  3. OVERLAPPING ELEMENTS INFLATE. Two balls distance s apart sum their fields,
     so a chain is fatter than one ball unless the spacing is chosen for it. At
     the midpoint of a pair the surface radius is sqrt(0.4628*r^2 - (s/2)^2),
     which equals the single-ball 0.5685*r exactly when s = 0.75*r. Below that
     the chain swells, above it the chain scallops. So chains here space at
     0.75 * element radius and come out the thickness they were asked for.

Everything in this module therefore takes SURFACE radii in metres -- the size
the thing actually is -- and converts internally.
"""

import math

import bpy
from mathutils import Vector

STIFFNESS = 2.0
THRESHOLD = 0.62

# d/r at which a single element's field equals the threshold.
SURFACE_FACTOR = (1.0 - (THRESHOLD / STIFFNESS) ** (1.0 / 3.0)) ** 0.5
# spacing along a chain that neither inflates nor scallops it
CHAIN_SPACING = 0.75


def element_radius(surface_radius):
    return surface_radius / SURFACE_FACTOR


def new_metaball(name, resolution=0.0009):
    mball = bpy.data.metaballs.new(name)
    mball.resolution = resolution
    mball.render_resolution = resolution
    mball.threshold = THRESHOLD
    obj = bpy.data.objects.new(name, mball)
    bpy.context.collection.objects.link(obj)
    return obj, mball


def ball(mball, loc, surface_r):
    el = mball.elements.new(type="BALL")
    el.co = Vector(loc)
    el.radius = element_radius(surface_r)
    el.stiffness = STIFFNESS
    return el


def capsule(mball, a, b, surface_r):
    """A single CAPSULE element spanning a to b. Cheaper and cleaner than a
    chain when the radius does not need to change along the run."""
    a, b = Vector(a), Vector(b)
    d = b - a
    length = d.length
    if length < 1e-6:
        return ball(mball, a, surface_r)
    el = mball.elements.new(type="CAPSULE")
    el.co = (a + b) * 0.5
    el.size_x = length * 0.5
    el.radius = element_radius(surface_r)
    el.stiffness = STIFFNESS
    el.rotation = d.normalized().to_track_quat("X", "Z")
    return el


def taper(mball, a, b, surface_r0, surface_r1, ease=0.85):
    """A run whose radius changes along its length -- a finger, a forearm.

    Blender's capsule cannot taper and a finger that does not taper is a dowel,
    so this lays balls at the non-inflating spacing and varies the radius.
    """
    a, b = Vector(a), Vector(b)
    span = (b - a).length
    step = CHAIN_SPACING * element_radius(min(surface_r0, surface_r1))
    n = max(2, int(math.ceil(span / step)))
    for i in range(n + 1):
        t = i / n
        ball(mball, a.lerp(b, t), surface_r0 + (surface_r1 - surface_r0) * (t ** ease))


def slab(mball, rows, thickness_at, width_at, centre_at):
    """A flat mass built from capsule rows -- the shape an ellipsoid would have
    made if the ellipsoid worked.

    `rows` is a list of parameters along the slab's long axis; the three
    callables return half-thickness, half-width and centre for a given row, so a
    palm can arch and taper instead of being a brick.
    """
    made = []
    for t in rows:
        half_t = thickness_at(t)
        half_w = width_at(t)
        c = Vector(centre_at(t))
        axis = Vector((1, 0, 0))
        made.append(capsule(mball, c - axis * half_w, c + axis * half_w, half_t))
    return made


def row_positions(start, end, surface_r):
    """Rows laid at the non-inflating spacing, always including both ends."""
    step = CHAIN_SPACING * element_radius(surface_r)
    n = max(1, int(round(abs(end - start) / step)))
    return [start + (end - start) * (i / n) for i in range(n + 1)]


def solve(mball_obj, name="Solved"):
    """Convert the metaball to a real mesh and drop the metaball."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(mball_obj.evaluated_get(dg))
    mesh.name = name
    bpy.data.objects.remove(mball_obj, do_unlink=True)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def calibrate(resolution=0.0009):
    """Solve one ball of known intended size and report the error.

    Runs every build. The constants above are derived rather than fitted, but a
    Blender version that changes the field function would silently make every
    asset the wrong thickness, and a build that prints its own calibration
    cannot do that quietly.
    """
    want = 0.0100
    obj, mball = new_metaball("Calib", resolution=resolution)
    ball(mball, (0, 0, 0), want)
    solved = solve(obj, "Calib")
    xs = [v.co.x for v in solved.data.vertices]
    got = (max(xs) - min(xs)) * 0.5
    bpy.data.objects.remove(solved, do_unlink=True)
    err = (got - want) / want
    print(f"  metaball calibration: asked {want:.4f} m radius, got {got:.4f} m "
          f"({err:+.1%})")
    if abs(err) > 0.08:
        raise SystemExit(
            f"BUILD FAILED: metaball surface is {err:+.1%} off the requested "
            f"radius; SURFACE_FACTOR {SURFACE_FACTOR:.4f} no longer describes "
            f"this Blender build")
    return got / want
