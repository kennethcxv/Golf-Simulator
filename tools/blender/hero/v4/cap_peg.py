"""CAP ON A PEG -- v4. The wall-display state.

The brief on v3's peg variant: "contains geometry that reads as a random
detached rod rather than a believable retail display." That is the whole
fault, and it is not a modelling problem so much as a staging one -- a cap on
a peg has to be HANGING ON something, tilted the way weight tilts it, with a
peg that is plainly fixed to a wall.

The cap itself is the asset from cap.py, unchanged. What is new here is the
peg (a wall plate, a rod that rises slightly so caps do not slide off, and a
ball end that stops them), and the cap's pose: hooked over the rod by its
sweatband, so the crown faces out, the visor hangs down and forward, and the
whole thing leans the few degrees gravity gives it.

    blender --factory-startup -b --python tools/blender/hero/v4/cap_peg.py
        [-- noexport | cycles]
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import bpy  # noqa: E402
from mathutils import Vector, Euler  # noqa: E402
import hero_lib as H  # noqa: E402
import drape as D  # noqa: E402
import stage as ST  # noqa: E402
import cap as C  # noqa: E402

REPO = os.getcwd()
OUT = os.path.join(REPO, "qa", "hero", "v4", "cap-peg")

PEG_Y = 0.0                  # the wall plane
TILT = math.radians(68.0)    # hooked over the rod, crown out, visor down
LEAN = math.radians(6.5)


def peg():
    """A wall peg: a plate, a rod that rises, and a ball that stops the stock
    sliding off. v3's was a bare rod floating beside the cap."""
    parts = []
    bpy.ops.mesh.primitive_cylinder_add(radius=0.0225, depth=0.0060,
                                        vertices=24,
                                        rotation=(math.pi / 2, 0, 0),
                                        location=(0.0, PEG_Y + 0.003, 0.0))
    plate = bpy.context.object
    plate.name = "peg_plate"
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(plate.data)
    bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=0.0011,
                    segments=3, affect='EDGES')
    bm.to_mesh(plate.data)
    bm.free()
    D.shade_smooth(plate, 36.0)
    parts.append(plate)

    pts = []
    for i in range(19):
        t = i / 18.0
        pts.append(Vector((0.0, PEG_Y - 0.088 * t,
                           0.0 + 0.020 * t * t)))
    rod = _sweep("peg_rod", pts, 0.0058, 0.0058, sides=14)
    D.shade_smooth(rod, 36.0)
    parts.append(rod)

    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0086, segments=18, ring_count=10,
                                         location=(0.0, PEG_Y - 0.090, 0.0206))
    ball = bpy.context.object
    ball.name = "peg_ball"
    D.shade_smooth(ball, 40.0)
    parts.append(ball)

    steel = ST.metal("PegSteel", (0.70, 0.71, 0.74), 0.22)
    for p in parts:
        p.data.materials.append(steel)
    return parts


def _sweep(name, pts, halfw, halfh, sides=10):
    import bmesh
    rows = []
    for i, p in enumerate(pts):
        tan = (pts[min(len(pts) - 1, i + 1)] - pts[max(0, i - 1)])
        tan = tan.normalized() if tan.length > 1e-9 else Vector((0, 1, 0))
        e1 = tan.cross(Vector((0, 0, 1)))
        if e1.length < 1e-6:
            e1 = tan.cross(Vector((1, 0, 0)))
        e1.normalize()
        e2 = tan.cross(e1).normalized()
        rows.append([tuple(p + e1 * (halfh * math.cos(2 * math.pi * k / sides))
                           + e2 * (halfw * math.sin(2 * math.pi * k / sides)))
                     for k in range(sides)])
    ob = D.grid_mesh(name, rows, wrap_u=True)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def build_cap():
    """cap.py's geometry, assembled and materialled the same way, then posed."""
    crown, band, visor = C.build()
    sm = C.seams(crown)
    eyes = C.eyelets()
    btn = C.button()
    emb = C.embroidery(crown)
    vst = C.visor_stitch(visor)

    D.solidify(crown, C.CLOTH_T, offset=-1.0)
    D.solidify(band, 0.0016, offset=-1.0)
    D.solidify(visor, C.VISOR_T, offset=0.0)
    crown = D.apply_all(crown)
    band = D.apply_all(band)
    visor = D.apply_all(visor)
    D.shade_smooth(crown, 46.0)
    D.shade_smooth(band, 44.0)
    D.shade_smooth(visor, 50.0)

    shell = C.twill_material("CapTwill", (0.2280, 0.0430, 0.0700), 0.80)
    thread = C.twill_material("CapThread", (0.1600, 0.0290, 0.0480), 0.74)
    ivory = C.twill_material("CapEmb", (0.7300, 0.6900, 0.6100), 0.66)
    lining = C.twill_material("CapBand", (0.0900, 0.0900, 0.0950), 0.88)
    brass = ST.metal("Eyelet", (0.68, 0.62, 0.48), 0.30)
    for o in (crown, visor, btn):
        o.data.materials.append(shell)
    band.data.materials.append(lining)
    for o in sm + vst:
        o.data.materials.append(thread)
    for o in emb:
        o.data.materials.append(ivory)
    for e in eyes:
        e.data.materials.append(brass)
    out = [crown, band, visor, btn] + sm + vst + emb + eyes
    # APPLY THE OBJECT TRANSFORMS FIRST. The eyelets and the button are made
    # with `primitive_*_add(location=...)`, so they carry that offset on the
    # OBJECT while `pose` transforms the mesh DATA -- the two compose and the
    # eyelets ended up as loose metal specks floating beside the peg, which is
    # precisely the "random detached geometry" the brief is complaining about.
    bpy.ops.object.select_all(action='DESELECT')
    for o in out:
        o.select_set(True)
    bpy.context.view_layer.objects.active = out[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.select_all(action='DESELECT')
    return out


def pose(objs, rod_end):
    """Hook the cap over the rod.

    SOLVE FOR THE POINT THAT TOUCHES, not for the bounding box. Rotating about
    x by +68 degrees turns the headband plane up so the crown faces out of the
    wall and the visor hangs; the BACK of the headband -- (0, HD, 0) in the
    build pose -- is then the highest point of the cap and the thing that
    rests on the rod. Placing it from the bounds instead landed the cap beside
    the peg looking up at the ceiling, which is v3's fault with new numbers.
    """
    from mathutils import Matrix
    rot = (Euler((TILT, 0.0, 0.0), 'XYZ').to_matrix().to_4x4()
           @ Euler((0.0, LEAN, 0.0), 'XYZ').to_matrix().to_4x4())
    back = rot @ Vector((0.0, C.HD, 0.0))

    # where on the rod it hangs, and how high the rod's top is there
    hang_y = PEG_Y - 0.055
    t = min(1.0, abs(hang_y - PEG_Y) / 0.088)
    rod_z = 0.020 * t * t + 0.0058

    shift = Matrix.Translation(Vector((0.0, hang_y - back.y,
                                       rod_z - back.z)))
    seen = set()
    for ob in objs:
        if ob.data.name in seen:
            continue
        seen.add(ob.data.name)
        ob.data.transform(shift @ rot)
        ob.data.update()
    # `hero_lib.bounds` reads ob.bound_box, which is CACHED and does not
    # refresh when mesh data is transformed directly -- in background mode
    # nothing triggers the depsgraph. The cap was posed correctly on the peg
    # from the first run; every camera was framing where it used to be.
    bpy.context.view_layer.update()
    print("  posed %d meshes; headband back at %.3f %.3f"
          % (len(seen), back.y, back.z))
    return objs


def main():
    args = H.argv_after_dashes()
    os.makedirs(OUT, exist_ok=True)
    H.reset_scene()

    capobjs = build_cap()
    pg = peg()
    rod_end = Vector((0.0, PEG_Y - 0.090, 0.0206))
    pose(capobjs, rod_end)

    subject = list(capobjs) + list(pg)
    print("cap-peg v4: TRIS %d" % D.tri_count(subject))
    lo, hi = H.bounds(subject)
    print("  %.0f x %.0f x %.0f mm" % ((hi.x - lo.x) * 1000,
                                       (hi.y - lo.y) * 1000,
                                       (hi.z - lo.z) * 1000))

    H.set_engine("CYCLES" if "cycles" in args else "EEVEE", samples=110)
    centre = (lo + hi) * 0.5
    # Frame from the BOUNDS. `subject_sphere` and `fit_view` both landed the
    # cap at a third of the frame here, and a cell that small in the contact
    # sheet is not a comparison anybody can make.
    span = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
    _c, radius = H.subject_sphere(subject)
    # AIM AT THE CAP, not at the bounding box. The peg's plate sits at the
    # wall and the visor hangs 140 mm below it, so the box centre is up behind
    # the crown and every framing computed from it looked over the cap's
    # shoulder.
    aim = Vector((0.0, (lo.y + hi.y) * 0.5, lo.z + (hi.z - lo.z) * 0.56))
    print("  span %.3f m, aim y %.3f z %.3f" % (span, aim.y, aim.z))
    ST.garment_lights(centre=centre, scale=radius * 1.6)
    ST.world_value(0.032)
    wall = ST.shop_wall(PEG_Y + 0.006, centre.z - 3.0, value=0.13)
    for label, az, el, res in (("hero", -118, 12, (960, 820)),
                               ("front", -90, 4, (900, 800)),
                               ("side", -168, 6, (1000, 780)),
                               ("low", -96, -14, (900, 800))):
        d = span * 2.90
        cam = H.camera(label, H.orbit_position(aim, d, az, el), aim,
                       lens=76.0)
        H.render(cam, os.path.join(OUT, "cap-peg-v4-%s.png" % label), res=res)

    bpy.data.objects.remove(wall, do_unlink=True)
    ST.world_value(0.055)
    d = span * 3.30
    cam = H.camera("compare", H.orbit_position(aim, d, -118, 10), aim,
                   lens=76.0)
    H.render(cam, os.path.join(OUT, "cap-peg-v4-compare.png"), res=(1000, 820))

    # retail: a wall of pegs, which is how caps are actually merchandised
    ST.shop_wall(PEG_Y + 0.006, centre.z - 3.0, value=0.13)
    made = ST.duplicate_along(subject,
                              [(-0.46, 0, 0.010), (-0.23, 0, -0.004),
                               (0.23, 0, 0.006), (0.46, 0, -0.008),
                               (-0.35, 0, -0.235), (-0.115, 0, -0.242),
                               (0.115, 0, -0.230), (0.35, 0, -0.238)],
                              rot_jitter=0.055, scale_jitter=0.010)
    mid = Vector((0.0, PEG_Y - 0.10, centre.z - 0.118))
    ST.garment_lights(centre=(0.0, PEG_Y - 0.30, mid.z + 0.20), scale=0.80,
                      warm=True)
    ST.world_value(0.038)
    for label, az, el, d in (("retail", -90, 4, 1.25),
                             ("retail-q34", -118, 10, 1.20)):
        cam = H.camera(label, H.orbit_position(mid, d, az, el), mid, lens=58.0)
        H.render(cam, os.path.join(OUT, "cap-peg-v4-%s.png" % label),
                 res=(1360, 900))
    for ob in made:
        bpy.data.objects.remove(ob, do_unlink=True)

    if "noexport" not in args:
        GLB = os.path.join(REPO, "Assets", "models", "hero", "v4")
        os.makedirs(GLB, exist_ok=True)
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(GLB, "apparel_cap_peg.glb"))
    print("renders in", OUT)


if __name__ == "__main__":
    main()
