"""CAP -- v4. A premium six-panel golf cap.

Reference: qa/hero/v4/ref/cap-ref1.jpg (a black cap held in the hand, dead side
on: the crown's real profile, two eyelets, the visor's concentric topstitching
and its thin edge) and cap-ref2.jpg (front three-quarter: the centre-front
seam, the covered button, embroidery sitting IN the twill).

What the brief says about v3, and what the frames show
(qa/hero/v3/apparel/cap/cap-eevee-hero.png):

  C1  The crown is a swollen HEMISPHERE -- helmet-like, inflated rather than
      sewn. A real crown is longer front-to-back than it is wide, and its apex
      sits BEHIND centre.
  C2  Six panels do not read at all.
  C3  Panel seams are raised CABLES running over the dome, like the ribs of a
      beach ball. Real ones are a crease and a line of thread.
  C4  The brim is a warped, thick, shovel-like plate with stepped concentric
      ridges. It reads as a scallop shell.
  C5  The crown-to-visor transition is melted.
  C6  The monogram is a flat CARD floating on the front panel with a visible
      rectangular border.
  C7  There is a rubber-band-like ring round the back.

Construction: the crown is a grid over an OVAL base with the apex offset back,
each panel very slightly convex between its seams; the seams are creases plus
thread. The visor is its own swept plate with a real curl and a 3.5 mm edge.

    blender --factory-startup -b --python tools/blender/hero/v4/cap.py
        [-- noexport | cycles]
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import hero_lib as H  # noqa: E402
import drape as D  # noqa: E402
import stage as ST  # noqa: E402

REPO = os.getcwd()
OUT = os.path.join(REPO, "qa", "hero", "v4", "cap")

# --------------------------------------------------------------------------
# MEASUREMENTS -- a 58 cm adult cap, in metres. The headband plane is z = 0.
# A HEAD IS NOT ROUND: 195 mm front-to-back against 155 mm across, and getting
# that one ratio right is most of the difference between a cap and a helmet.

NU = 96                      # 16 columns per panel
NV = 22
HW, HD = 0.0778, 0.0972      # base half-axes: across, front-to-back
BASE_N = 2.35                # a head is a rounded rectangle, not an ellipse
CROWN_H = 0.1040
APEX_Y = 0.0125              # ... and the apex sits BEHIND centre

# THE PROFILE IS A SUPERELLIPSE, NOT A BEZIER TO A POINT. A quadratic run from
# the headband to the apex arrives there along the line from its control point,
# which is a CONE -- the first render was a witch's hat. r = (1 - w^n)^(1/m)
# leaves the base near-vertical and flattens over the top, which is what a
# blocked crown does, and it lets the back be fuller than the front by nothing
# more than a change of exponent.
PROF_M = 2.55
PROF_N = dict(front=1.85, side=2.15, back=2.45)

PANELS = 6
SEAM_DIP = 0.0011            # the crease at a seam
PANEL_BULGE = 0.0016         # ... and the swell between two of them

VISOR_SPAN = 1.290           # radians either side of centre front
VISOR_REACH = 0.0715
VISOR_DROP = 0.0395
VISOR_T = 0.0042

BAND_H = 0.030               # the sweatband inside the base
CLOTH_T = 0.0022


def se(hw, hd, th, n=BASE_N):
    sx, sy = math.sin(th), -math.cos(th)
    x = hw * math.copysign(abs(sx) ** (2.0 / n), sx) if sx else 0.0
    y = hd * math.copysign(abs(sy) ** (2.0 / n), sy) if sy else 0.0
    return x, y


def fbs(th):
    c, s = math.cos(th), abs(math.sin(th))
    f, b, sd = max(0.0, c) ** 1.6, max(0.0, -c) ** 1.6, s ** 1.6
    tot = f + b + sd or 1.0
    return f / tot, b / tot, sd / tot


def mix(table, th):
    f, b, s = fbs(th)
    return table["front"] * f + table["back"] * b + table["side"] * s


def bez(p0, p1, p2, t):
    return ((1 - t) ** 2 * Vector(p0) + 2 * (1 - t) * t * Vector(p1)
            + t * t * Vector(p2))


def panel_wave(th):
    """Each panel swells a little between its two seams, and the seam itself is
    a crease. v3 put a raised CABLE on the seam, which is the one thing a sewn
    seam never does -- two pieces of cloth pulled together dip inward."""
    c = math.cos(PANELS * th)          # +1 exactly on a seam
    return -SEAM_DIP * max(0.0, c) ** 1.4 + PANEL_BULGE * max(0.0, -c) ** 0.8


def crown_at(th, t):
    """A point on the crown. t = 0 at the headband, 1 at the apex."""
    w = min(1.0, max(0.0, t))
    rs = (1.0 - w ** mix(PROF_N, th)) ** (1.0 / PROF_M)
    z = CROWN_H * w
    cy = APEX_Y * w ** 1.35
    bx, by = se(HW, HD, th)
    p = Vector((bx * rs, cy + by * rs, z))
    r = Vector((p.x, p.y - cy, 0.0))
    if r.length > 1e-6:
        p = p + r.normalized() * (panel_wave(th) * math.sin(math.pi * w) ** 0.55)
    return p


def crown_rows():
    return [[tuple(crown_at(2 * math.pi * k / NU, j / NV)) for k in range(NU)]
            for j in range(NV + 1)]


def visor_rows():
    """The bill: swept forward off the crown's front arc, dropping as it goes
    and curling harder at the corners.

    v3's was a flat plate with stepped concentric ridges cut into it. A real
    visor is a single curved surface about 3.5 mm thick whose stitching is
    THREAD, and its silhouette from the side is a shallow arc, not a shovel.
    """
    NU_V, NV_V = 40, 12
    rows = []
    for j in range(NV_V + 1):
        v = j / NV_V
        row = []
        for i in range(NU_V + 1):
            a = -1.0 + 2.0 * i / NU_V
            th = a * VISOR_SPAN
            bx, by = se(HW, HD, th)
            e = abs(a)
            # THE CORNERS DIE ON THE HEADBAND. Carrying 15 mm of reach out to
            # the ends left the bill a wedge that swept back into the crown at
            # a corner; on a real cap the outer edge is one arc that returns to
            # the band. The drop follows the reach so the corners cannot dive
            # below the band while extending nowhere.
            reach = VISOR_REACH * (1.0 - e ** 1.75)
            drop = VISOR_DROP * (0.16 + 0.84 * (reach / VISOR_REACH))
            out = Vector((0.46 * math.sin(th), -math.cos(th), 0.0)).normalized()
            p = Vector((bx, by, -0.0022 - 0.004 * (1.0 - e ** 2))) \
                + out * (reach * v)
            p.z -= drop * (v ** 1.15)
            # the bill is dished ACROSS as well as along
            p.z += 0.0075 * (1.0 - e ** 2) * math.sin(math.pi * v) * 0.5
            row.append(tuple(p))
        rows.append(row)
    return rows


def sweatband_rows():
    rows = []
    for j in range(5):
        t = j / 4.0
        row = []
        for k in range(NU):
            th = 2 * math.pi * k / NU
            bx, by = se(HW * (1.0 - 0.012 * t), HD * (1.0 - 0.012 * t), th)
            # INSIDE, AND IT HAS TO TAPER FASTER THAN THE CROWN DOES. At a
            # fixed inset the band's top edge came out 0.3 mm inside a shell
            # 2.2 mm thick and punched through the front panel as a dark
            # crescent -- the crown narrows as it rises and the band must
            # narrow faster.
            k = 1.0 - 0.075 * t
            row.append((bx * 0.930 * k, by * 0.942 * k, 0.0030 + BAND_H * t))
        rows.append(row)
    return rows


# --------------------------------------------------------------------------


def seams(crown):
    """Six lines of thread down the panel joins, and the concentric rows on the
    visor. Both are the read that v3 replaced with tube geometry."""
    out = []
    for s in range(PANELS):
        th = 2 * math.pi * s / PANELS
        pts = []
        for j in range(15):
            t = 0.035 + 0.93 * (j / 14.0)
            p = crown_at(th, t)
            r = Vector((p.x, p.y - APEX_Y * t ** 1.35, 0.0))
            n = r.normalized() if r.length > 1e-6 else Vector((0, 1, 0))
            pts.append(p + n * 0.0012 + Vector((0, 0, 0.0004)))
        ob = D.topstitch(f"seam{s}", pts, radius=0.00062)
        D.shade_smooth(ob, 40.0)
        out.append(ob)
    return out


def visor_stitch(visor):
    """Three rows following the edge, ON TOP -- ref1 shows them clearly.

    Snapping them to the visor with `find_nearest` put half of them on the
    UNDERSIDE, where they rendered as a fan of ribs under the bill. The
    parametric surface is the mid-surface; lifting off it by half the bill's
    thickness puts the thread where thread goes.
    """
    out = []
    for r in range(3):
        v = 0.935 - 0.075 * r
        pts = []
        for i in range(41):
            a = -1.0 + 2.0 * i / 40.0
            th = a * VISOR_SPAN * 0.985
            bx, by = se(HW, HD, th)
            e = abs(a)
            reach = VISOR_REACH * (1.0 - e ** 1.75)
            drop = VISOR_DROP * (0.16 + 0.84 * (reach / VISOR_REACH))
            out_d = Vector((0.46 * math.sin(th), -math.cos(th),
                            0.0)).normalized()
            p = (Vector((bx, by, -0.0022 - 0.004 * (1.0 - e ** 2)))
                 + out_d * (reach * v))
            p.z -= drop * (v ** 1.15)
            p.z += 0.0075 * (1.0 - e ** 2) * math.sin(math.pi * v) * 0.5
            p.z += VISOR_T * 0.5 + 0.0009
            if reach > 0.004:
                pts.append(p)
        if len(pts) > 4:
            ob = D.topstitch("vstitch%d" % r, pts, radius=0.00048)
            D.shade_smooth(ob, 40.0)
            out.append(ob)
    return out


def eyelets():
    out = []
    for s in range(PANELS):
        th = 2 * math.pi * (s + 0.5) / PANELS
        t = 0.42
        p = crown_at(th, t)
        r = Vector((p.x, p.y - APEX_Y * t ** 1.35, 0.0)).normalized()
        bpy.ops.mesh.primitive_torus_add(major_radius=0.0029,
                                         minor_radius=0.00085,
                                         major_segments=14, minor_segments=6,
                                         location=p + r * 0.0004)
        e = bpy.context.object
        e.name = f"eyelet{s}"
        e.rotation_mode = 'QUATERNION'
        e.rotation_quaternion = r.to_track_quat('Z', 'Y')
        bpy.ops.object.transform_apply(location=False, rotation=True,
                                       scale=False)
        D.shade_smooth(e, 38.0)
        out.append(e)
    return out


def button():
    import bmesh
    rows = []
    for j in range(7):
        t = j / 6.0
        r = 0.0088 * math.cos(t * math.pi * 0.5) ** 0.55
        z = CROWN_H + 0.0016 + 0.0040 * math.sin(t * math.pi * 0.5)
        rows.append([(r * math.cos(2 * math.pi * k / 16),
                      APEX_Y + r * math.sin(2 * math.pi * k / 16), z)
                     for k in range(16)])
    b = D.grid_mesh("button", rows, wrap_u=True)
    bm = bmesh.new()
    bm.from_mesh(b.data)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
    bm.to_mesh(b.data)
    bm.free()
    D.shade_smooth(b, 40.0)
    return b


def embroidery(crown):
    """A mark stitched INTO the front panel.

    v3's was a flat quad with its own background colour, so it read as a card
    with a border -- the fault appeared on four separate garments. Raised satin
    stitch conforms to the crown and casts its own small shadow.
    """
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromPolygons(
        [v.co.copy() for v in crown.data.vertices],
        [tuple(p.vertices) for p in crown.data.polygons])

    def at(u, w):
        """u across the front panel, w up it."""
        th = -0.505 + 0.62 * u
        p = crown_at(th, 0.20 + 0.30 * w)
        loc, nrm, _i, _d = bvh.find_nearest(p, 0.03)
        if loc is None or nrm is None:
            return p
        return loc + nrm * 0.0011

    out = []
    # a flag on a pole -- three runs of satin stitch, all following the crown
    pole = [at(0.34, 0.06 + 0.86 * (i / 10.0)) for i in range(11)]
    out.append(D.topstitch("emb_pole", pole, radius=0.00115, sides=7))
    flag = []
    for i in range(11):
        t = i / 10.0
        flag.append(at(0.34 + 0.30 * t, 0.92 - 0.16 * math.sin(t * math.pi)))
    out.append(D.topstitch("emb_flag_top", flag, radius=0.00100, sides=7))
    flag2 = []
    for i in range(11):
        t = i / 10.0
        flag2.append(at(0.34 + 0.30 * t, 0.62 + 0.10 * math.sin(t * math.pi)))
    out.append(D.topstitch("emb_flag_bot", flag2, radius=0.00100, sides=7))
    edge = [at(0.64, 0.62 + 0.30 * (i / 6.0)) for i in range(7)]
    out.append(D.topstitch("emb_flag_edge", edge, radius=0.00095, sides=7))
    for o in out:
        D.shade_smooth(o, 44.0)
    return out


def twill_material(name, colour, rough=0.80):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Roughness"].default_value = rough
    if "Sheen Weight" in b.inputs:
        b.inputs["Sheen Weight"].default_value = 0.07
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.32
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 900.0
    n.inputs["Detail"].default_value = 6.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.05
    bump.inputs["Distance"].default_value = 0.0007
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return mat


# --------------------------------------------------------------------------


def build():
    H.reset_scene()
    crown = D.grid_mesh("crown", crown_rows(), wrap_u=True)
    D.weld(crown, 3e-4)
    band = D.grid_mesh("sweatband", sweatband_rows(), wrap_u=True)
    visor = D.grid_mesh("visor", visor_rows())
    D.shade_smooth(visor, 52.0)
    return crown, band, visor


def retail(subject, centre):
    """Caps on a shop shelf, which is the other way they are merchandised --
    the peg wall is the cap-peg asset's context, this is this one's."""
    for n in ("Backdrop", "key", "fill", "rim", "under"):
        ob = bpy.data.objects.get(n)
        if ob is not None:
            bpy.data.objects.remove(ob, do_unlink=True)
    lo, hi = H.bounds(subject)
    made = [ST.shop_floor(lo.z - 0.001, value=0.30),
            ST.shop_wall(0.62, lo.z - 0.001)]
    off = []
    for c in (-2, -1, 1, 2):
        off.append((c * 0.212, 0.004 * c, 0.0))
    for c in (-2, -1, 0, 1, 2):
        off.append((c * 0.212 + 0.006, 0.245, 0.0))
    made += ST.duplicate_along(subject, off, rot_jitter=0.10,
                               scale_jitter=0.012)
    mid = Vector((0.0, 0.10, lo.z + 0.06))
    ST.garment_lights(centre=(0.0, 0.0, mid.z + 0.26), scale=0.80, warm=True)
    ST.world_value(0.035)
    for label, az, el, d in (("retail", -96, 26, 1.05),
                             ("retail-q34", -126, 34, 1.00)):
        cam = H.camera(label, H.orbit_position(mid, d, az, el), mid, lens=56.0)
        H.render(cam, os.path.join(OUT, "cap-v4-%s.png" % label),
                 res=(1360, 900))
    return made


def main():
    args = H.argv_after_dashes()
    crown, band, visor = build()
    os.makedirs(OUT, exist_ok=True)

    sm = seams(crown)
    eyes = eyelets()
    btn = button()
    emb = embroidery(crown)
    vst = visor_stitch(visor)

    D.solidify(crown, CLOTH_T, offset=-1.0)
    D.solidify(band, 0.0016, offset=-1.0)
    D.solidify(visor, VISOR_T, offset=0.0)
    crown = D.apply_all(crown)
    band = D.apply_all(band)
    visor = D.apply_all(visor)
    D.shade_smooth(crown, 46.0)
    D.shade_smooth(band, 44.0)
    D.shade_smooth(visor, 50.0)

    shell = twill_material("CapTwill", (0.2280, 0.0430, 0.0700), 0.80)
    thread = twill_material("CapThread", (0.1600, 0.0290, 0.0480), 0.74)
    ivory = twill_material("CapEmb", (0.7300, 0.6900, 0.6100), 0.66)
    lining = twill_material("CapBand", (0.0900, 0.0900, 0.0950), 0.88)
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

    subject = [crown, band, visor, btn, *sm, *vst, *emb, *eyes]
    print(f"cap v4: TRIS {D.tri_count(subject)}")
    lo, hi = H.bounds(subject)
    print(f"  {(hi.x - lo.x) * 1000:.0f} x {(hi.y - lo.y) * 1000:.0f} x "
          f"{(hi.z - lo.z) * 1000:.0f} mm")

    H.set_engine("CYCLES" if "cycles" in args else "EEVEE", samples=110)
    centre = (lo + hi) * 0.5
    _c, radius = H.subject_sphere(subject)
    ST.garment_lights(centre=centre, scale=radius * 1.5)
    ST.world_value(0.035)
    H.backdrop(center=centre, scale=radius * 1.4)
    for label, az, el, res in (("front", -90, 6, (900, 760)),
                               ("q34", -128, 16, (900, 760)),
                               ("side", -180, 4, (980, 720)),
                               ("back", 90, 8, (900, 760)),
                               ("top", -90, 68, (860, 860))):
        d = H.fit_view(subject, centre,
                       Vector(H.orbit_position(centre, 1.0, az, el)) - centre,
                       78.0, res=res, margin=1.13)
        cam = H.camera(label, H.orbit_position(centre, d, az, el), centre,
                       lens=78.0)
        H.render(cam, os.path.join(OUT, f"cap-v4-{label}.png"), res=res)

    bd = bpy.data.objects.get("Backdrop")
    if bd is not None:
        bpy.data.objects.remove(bd, do_unlink=True)
    ST.world_value(0.055)
    # the reference is a dead side view, so the comparison has to be one too
    d = H.fit_view(subject, centre,
                   Vector(H.orbit_position(centre, 1.0, -168, 7)) - centre,
                   78.0, res=(1060, 760), margin=1.05)
    cam = H.camera("compare", H.orbit_position(centre, d, -168, 7), centre,
                   lens=78.0)
    H.render(cam, os.path.join(OUT, "cap-v4-compare.png"), res=(1060, 760))

    made = retail(subject, centre)
    for ob in made:
        bpy.data.objects.remove(ob, do_unlink=True)
    if "noexport" not in args:
        GLB = os.path.join(REPO, "Assets", "models", "hero", "v4")
        os.makedirs(GLB, exist_ok=True)
        H.bake_gltf_axis(subject)
        H.export_glb(subject, os.path.join(GLB, "apparel_cap.glb"))
    print("renders in", OUT)


if __name__ == "__main__":
    main()
