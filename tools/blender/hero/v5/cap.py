"""cap. Six gores, a visor built as one plate, and no loft rings anywhere.

REFERENCE: Image1.png has no cap, so the style comes from the sheet -- crisp
panels, a clear seam between them, matte fabric, muted colour, and no uniform
rounding. The brief names v4's fault exactly: "the cap's visor has concentric
ridges like a scallop shell. That is loft rings showing through." It is right,
and the cause is that v4 lofted the visor as a stack of rings, so every ring
boundary is a shading discontinuity across the one surface the player looks at
straight on.

A CAP CROWN IS SIX FLAT GORES, which is the flat-panel method applied to a rigid
thing: each gore is a pattern piece bounded by two seams and the head opening,
sewn to its neighbours, and the dome is the CONSEQUENCE of the sewing. Each panel
here is drafted slightly flatter than a sphere would be, so a cap reads as six
facets meeting at six raised seams -- which is what a cap is and what the brief's
"flat panels, crisp lines" asks for.

The visor is ONE grid, swept in both directions at once: no rings, so nothing to
show through.

Run: blender --factory-startup -b --python cap.py -- render
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bmesh
import bpy
from mathutils import Vector

import hero_lib as H
import studio as ST
import pattern as PT

NAME = "cap"
SHELL = (0.1240, 0.0158, 0.0322)
LINING = (0.0300, 0.0170, 0.0192)
STITCH = (0.1420, 0.1180, 0.1050)
EV = -1.02

# a fitted six-panel cap: 185 mm across, 157 mm front to back at the band,
# 103 mm tall, with a 62 mm visor
#
# MEASURED, because "the visor is too large for its crown" is three numbers and
# not an impression. Against the reference side elevations:
#
#            v5      v6     reference
#   visor width / crown width   1.10    0.96    never exceeds the crown --
#                                               the ends tuck into the band
#   reach / crown height        0.73    0.60
#   drop  / crown height        0.39    0.28
#   crown depth                175 mm  157 mm   a head is not round
#
# The width was the one doing the damage: at 202.8 mm on a 185 mm crown the
# visor stood proud on both sides in every view, which is what reads as "too
# large" long before the length does.
R_X, R_Y = 0.0925, 0.0785
RISE = 0.1035
BAND_Z = 0.0
GORES = 6
SEAM = 0.0016


def crown_radius(a, v):
    """The crown's half-width at angle `a` round and height fraction `v`.

    Slightly FLATTER than a hemisphere between the seams and pulled in at them,
    so the six panels read as facets. A cap is not a ball.
    """
    # the profile: full at the band, closing to nothing at the button, and
    # fuller than a circle in the middle third -- a cap's crown is a dome with a
    # nearly vertical wall for the first 30 mm above the band
    prof = (1.0 - v ** 3.00) ** 0.40
    # the panel facet: each gore's centre stands a little proud of the chord
    g = (a * GORES / (2 * math.pi)) % 1.0
    facet = 1.0 - 0.055 * (1.0 - math.cos(2 * math.pi * g)) * 0.5
    return prof * facet


def crown():
    NA, NV = GORES * 22, 30
    rows = []
    for iv in range(NV + 1):
        v = iv / NV
        z = BAND_Z + RISE * (v ** 0.82)
        row = []
        for ia in range(NA):
            a = 2 * math.pi * ia / NA
            k = crown_radius(a, v)
            row.append((R_X * k * math.cos(a), R_Y * k * math.sin(a), z))
        rows.append(row)
    ob = ST.grid("cap_crown", rows, wrap_u=True)
    return ob


def gore_seams():
    """A raised welt along each of the six seams: real geometry, not a groove."""
    parts = []
    for g in range(GORES):
        a = 2 * math.pi * (g + 0.5) / GORES
        pts = []
        for iv in range(19):
            v = iv / 18.0
            z = BAND_Z + RISE * (v ** 0.82)
            k = crown_radius(a, v)
            pts.append(Vector((R_X * k * math.cos(a), R_Y * k * math.sin(a),
                               z)))
        parts.append(ST.sweep("cap_seam%d" % g, pts, SEAM, SEAM * 0.62,
                              sides=6, cap=False,
                              taper=lambda t: max(0.16, 1.0 - t ** 2.2)))
    return ST.join("cap_seams", parts)


def visor_point(u, v, span=1.86, reach=0.0620, drop=0.0292, curl=0.0168):
    """One point on the visor surface. `u` runs across, `v` out from the band.

    The reach TAPERS TO NOTHING at the two ends, so the visor's outline is a
    rounded projection that merges into the band -- the first cut kept the full
    reach all the way round and pushed the ends out sideways, which came out as a
    flat paddle detached from the crown.
    """
    a = -math.pi / 2 + u * span * 0.5
    bx, by = R_X * math.cos(a), R_Y * math.sin(a)
    # the ellipse's own outward normal, not the circle's
    nx, ny = R_Y * math.cos(a), R_X * math.sin(a)
    n = math.hypot(nx, ny) or 1.0
    r = reach * (math.cos(u * math.pi * 0.5) ** 0.52)
    z = BAND_Z + 0.0032 - drop * (v ** 2.05) + curl * (u * u) * (v ** 1.7)
    return (bx + nx / n * r * v, by + ny / n * r * v, z)


def visor(thick=0.0031):
    """ONE grid, swept across and out at the same time.

    v4 lofted this as a stack of rings and every ring boundary showed as a ridge
    -- the scallop shell the brief names. Here `u` runs across the visor and `v`
    runs out from the band to the tip, so the surface has no rings in it at all.
    """
    NU, NV = 54, 16
    rows = [[visor_point(-1.0 + 2.0 * iu / NU, iv / NV) for iu in range(NU + 1)]
            for iv in range(NV + 1)]
    top = ST.grid("cap_visor", rows, wrap_u=False)
    m = top.modifiers.new("Solidify", 'SOLIDIFY')
    m.thickness = thick
    m.offset = -1.0
    m.use_even_offset = False
    m.thickness_clamp = 1.5
    return top


def band(height=0.0285, out=0.0012):
    """The sweatband's outside face: a crisp step round the bottom of the crown."""
    NA = GORES * 22
    rows = []
    for iv in range(4):
        v = iv / 3.0
        z = BAND_Z - height * v
        row = []
        for ia in range(NA):
            a = 2 * math.pi * ia / NA
            k = crown_radius(a, 0.0) * (1.0 + out / R_X * (1.0 - abs(v - 0.5) * 2))
            row.append((R_X * k * math.cos(a), R_Y * k * math.sin(a), z))
        rows.append(row)
    return ST.grid("cap_band", rows, wrap_u=True)


def strap():
    """An adjustable strap that is actually ON THE OUTSIDE of the band.

    "The back strap reads weakly" was not a proportion. The strap was swept at
    1.006 of the band radius and the BAND ITSELF stands 1.2 mm proud, so the
    webbing was inside the thing it is supposed to sit on and the only part
    visible from behind was the buckle -- a pale box floating at the hem. It is
    3.5 mm proud here, which is a real strap on a real band.

    And it now has what makes a strap legible at three metres rather than at
    thirty centimetres: a row of adjustment holes on one arm and a slide with
    the tail threaded through it on the other. The holes are recessed dark
    discs rather than boolean cuts -- at any distance the player will ever see
    this cap, a hole IS a dark disc, and a boolean through a swept ribbon is a
    lot of risk for a result that renders the same.
    """
    parts, holes = [], []
    NA = 22
    PROUD = 1.0 + 0.0035 / R_X          # 3.5 mm outboard of the band
    ZS = BAND_Z - 0.0118
    for side in (-1, 1):
        pts = []
        for i in range(NA + 1):
            t = i / NA
            a = math.pi / 2 + side * (0.09 + t * 0.52)
            k = crown_radius(a, 0.0)
            pts.append(Vector((R_X * k * PROUD * math.cos(a),
                               R_Y * k * PROUD * math.sin(a), ZS)))
        parts.append(ST.sweep("cap_strap%d" % side, pts, 0.0094, 0.0019,
                              sides=6))
        # the adjustment holes, on the left arm only -- the right one is the
        # tail that goes through the slide
        if side < 0:
            for h in range(7):
                t = 0.22 + 0.108 * h
                a = math.pi / 2 + side * (0.09 + t * 0.52)
                k = crown_radius(a, 0.0) * (PROUD + 0.0016 / R_X)
                c = Vector((R_X * k * math.cos(a), R_Y * k * math.sin(a), ZS))
                out = Vector((math.cos(a), math.sin(a), 0.0)).normalized()
                holes.append(ST.sweep("cap_hole%d" % h,
                                      [c - out * 0.0013, c + out * 0.0006],
                                      0.0021, 0.0021, sides=14))
    # THE SLIDE BRIDGES THE GAP. Off at 0.30 rad it sat on one arm and the
    # back view showed two straps that stopped short of each other with
    # nothing between them.
    ka = math.pi / 2 + 0.045
    kk = crown_radius(ka, 0.0) * (PROUD + 0.0022 / R_X)
    # ROTATE THE VERTICES, NOT THE OBJECT. `ST.box` bakes the placement into
    # the mesh and leaves the object at the identity, so setting
    # `.rotation_euler` afterwards spins the box about the WORLD origin -- the
    # buckle swung 101.59 mm and the export round-trip refused the file. It is
    # the counter's "ST.box already places the part" trap wearing a rotation.
    buckle = ST.box("cap_buckle", (0.0, 0.0, 0.0),
                    (0.0128, 0.0032, 0.0118), bevel=0.0009)
    ang = ka + math.pi / 2
    ca, sa = math.cos(ang), math.sin(ang)
    at = Vector((R_X * kk * math.cos(ka), R_Y * kk * math.sin(ka), ZS))
    for v in buckle.data.vertices:
        x, y = v.co.x, v.co.y
        v.co = Vector((x * ca - y * sa + at.x, x * sa + y * ca + at.y,
                       v.co.z + at.z))
    buckle.data.update()
    return ST.join("cap_strap", parts), buckle, holes


def button():
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0072, segments=18,
                                         ring_count=10,
                                         location=(0.0, 0.0, BAND_Z + RISE))
    b = bpy.context.object
    b.name = "cap_button"
    b.scale = (1.0, 1.0, 0.62)
    bpy.ops.object.transform_apply(scale=True)
    return b


def eyelets():
    parts = []
    for g in range(GORES):
        a = 2 * math.pi * (g + 0.5) / GORES
        v = 0.44
        k = crown_radius(a, v)
        p = Vector((R_X * k * math.cos(a), R_Y * k * math.sin(a),
                    BAND_Z + RISE * (v ** 0.82)))
        bpy.ops.mesh.primitive_torus_add(
            major_radius=0.0034, minor_radius=0.0013, major_segments=12,
            minor_segments=6, location=p,
            rotation=(math.pi / 2, 0.0, a + math.pi / 2))
        e = bpy.context.object
        e.name = "cap_eyelet%d" % g
        parts.append(e)
    return ST.join("cap_eyelets", parts)


def visor_stitch(rowv=0.80):
    """Two rows of topstitching following the visor's own curve."""
    parts = []
    for k, rv in enumerate((0.76, 0.895)):
        pts = []
        for iu in range(49):
            u = -0.93 + 1.86 * iu / 48
            p = Vector(visor_point(u, rv))
            # LIFT ALONG THE SURFACE NORMAL, not along +z. On a visor that curls
            # up at the sides, a +z lift puts the stitch line on the UNDERSIDE at
            # the two ends -- the same fault v4's had.
            q = Vector(visor_point(u, rv + 0.02)) - Vector(visor_point(u,
                                                                      rv - 0.02))
            w = Vector(visor_point(u + 0.03, rv)) - Vector(visor_point(u - 0.03,
                                                                       rv))
            nrm = q.cross(w)
            if nrm.length > 1e-9:
                nrm.normalize()
                if nrm.z < 0:
                    nrm = -nrm
            else:
                nrm = Vector((0, 0, 1))
            pts.append(p + nrm * 0.0009)
        parts.append(PT.topstitch("cap_stitch%d" % k, pts, radius=0.00072))
    return ST.join("cap_stitch", parts)


def build():
    cr = crown()
    ST.smooth_by_angle(cr, 24.0)
    seams = gore_seams()
    ST.smooth_by_angle(seams, 30.0)
    bd = band()
    ST.smooth_by_angle(bd, 24.0)
    vs = ST.apply_mods(visor())
    ST.smooth_by_angle(vs, 30.0)
    st = visor_stitch()
    ST.smooth_by_angle(st, 34.0)
    btn = button()
    ST.smooth_by_angle(btn, 30.0)
    strapob, buckle, holes = strap()
    ST.smooth_by_angle(strapob, 28.0)
    ST.smooth_by_angle(buckle, 26.0)
    eye = eyelets()
    ST.smooth_by_angle(eye, 34.0)

    shell = ST.fabric("CapTwill", SHELL, rough=0.72, weave=0.0008, sheen=0.13,
                      scale_mm=260.0, rib=150, rib_depth=0.00022, rib_angle=44.0)
    dark = ST.fabric("CapUnder", LINING, rough=0.78, weave=0.0009, sheen=0.08,
                     scale_mm=240.0)
    # Stitching is a twisted thread, so it gets the cord tile like the
    # hoodie drawcord. As ST.matte it was the one cloth on the cap with no
    # grain at all, and assert_maps would have called it an unmapped fabric.
    thread = ST.fabric("CapThread", STITCH, rough=0.52, scale_mm=90.0,
                       maps="cord")
    cloth = ST.join("cap_shell", [cr, seams, bd, btn])
    cloth.data.materials.append(shell)
    strapob.data.materials.append(dark)

    # the UNDERSIDE of a visor is a different, darker cloth on every cap made,
    # and it is most of what stops the visor reading as a moulded plastic scoop
    vs.data.materials.append(shell)
    vs.data.materials.append(dark)
    for poly in vs.data.polygons:
        if poly.normal.z < -0.28:
            poly.material_index = 1

    st.data.materials.append(thread)
    # EYELETS ARE EMBROIDERED, NOT CHROMED. They were joined to the buckle and
    # the pair given a mirror material, so six bright rings sat on a matte
    # twill cap and read as machine screws. On every cap in the reference the
    # eyelet is worked in thread the colour of the panel with a dark hole in
    # the middle -- which is the same object the strap's adjustment holes are.
    darkbits = ST.join("cap_dark", [eye] + holes)
    darkbits.data.materials.append(ST.matte("CapEyelet", LINING, rough=0.62))
    buckle.data.materials.append(ST.chrome("CapMetal", (0.60, 0.57, 0.54), 0.34))
    return [cloth, vs, st, darkbits, strapob], [buckle]


def main():
    argv = H.argv_after_dashes()
    H.reset_scene()
    H.set_engine("CYCLES" if "cycles" in argv else "EEVEE", samples=96)
    cloth_objs, metal_objs = build()
    subject = cloth_objs + metal_objs
    lo, hi = H.bounds(subject)
    look = Vector(((lo.x + hi.x) * 0.5, (lo.y + hi.y) * 0.5,
                   (lo.z + hi.z) * 0.5))
    r = max((hi - lo).x, (hi - lo).y, (hi - lo).z) * 0.5
    ST.world_value(0.34)
    ST.retail_light(centre=look, scale=r)
    ST.cyc(centre=look, scale=r)
    ST.exposure(EV)
    ST.no_white(cloth_objs)
    print("  tris %d" % ST.tris(subject))
    if "render" in argv:
        ST.shots(subject, look, r, ST.out_dir("qa", "hero", "v5", NAME),
                 [("front", -90.0, 8.0, 85.0), ("three", -46.0, 20.0, 85.0),
                  ("side", 0.0, 6.0, 85.0), ("back", 90.0, 10.0, 85.0),
                  ("top", -70.0, 58.0, 85.0)], res=(1050, 900))


if __name__ == "__main__":
    main()
