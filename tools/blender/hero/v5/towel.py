"""shop-towel -- a tri-folded golf towel on a carabiner.

The brief: "Soft goods again, and the folding machinery from folded.py already
exists. A tri-fold with a carabiner."

It does, and this is the cheapest test of whether the apparel method really
generalises: a towel is one rectangular panel, so if the fold hinge is right
the whole object is three folds and a clip. Nothing is sculpted.

WHAT MAKES A TOWEL READ AS A TOWEL and not as a folded sheet of card:

  * a HEM on all four sides -- a turned, stitched border that is thicker and
    denser than the field, and the only thing on the object with a hard edge;
  * a WAFFLE FIELD, cut as real relief in a piecewise grid, because a golf
    towel's whole visual identity is that texture;
  * a GROMMET and a CARABINER at one corner, which is what says "golf" rather
    than "bathroom".

The folds go through `fold.fold`, the same hinge the folded garments use: the
axis sits half way between the flap and what it lands on, so the panels either
side stay rigid and what comes out is flat faces meeting at crisp lines.

Run: blender --factory-startup -b --python towel.py -- render export
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import hero_lib as H  # noqa: E402
import studio as ST  # noqa: E402
import hard as HD  # noqa: E402
import fold as FD  # noqa: E402
import folded as FO  # noqa: E402

NAME = "shop-towel"
EV = -0.05

W, Lg = 0.400, 0.560       # a real golf towel, flat
THICK = 0.0055             # terry is thick, and the fold radius follows it
HEM = 0.022
CLOTH = (0.0455, 0.1105, 0.0672)     # a deep course green
HEMC = (0.0362, 0.0895, 0.0545)


def panel():
    """A flat towel: a hemmed border round a waffled field.

    The waffle is a piecewise grid -- a raised land, a flat groove, a raised
    land -- and never a wave, which for a texture at this pitch is the whole
    difference between terry and quilting.
    """
    # SAMPLE THE FEATURE, NOT THE PANEL. At 92 x 126 the grid spacing is
    # 4.35 mm and the waffle groove was 3 mm, so most grooves got no vertex at
    # all and the towel rendered as a smooth silicone pouch. Third time this
    # session a feature smaller than the sampling has come back as "the
    # material is broken": the grip's 7 mm butt cap with 9 mm rows, the driver
    # back with a ring every 4 mm, and this.
    NU, NV = 132, 186
    rows = []
    for j in range(NV + 1):
        y = -Lg * 0.5 + Lg * j / NV
        row = []
        for i in range(NU + 1):
            x = -W * 0.5 + W * i / NU
            # inside the hem? the border is a flat, slightly thicker band
            dx = min(x + W * 0.5, W * 0.5 - x)
            dy = min(y + Lg * 0.5, Lg * 0.5 - y)
            edge = min(dx, dy)
            if edge < HEM:
                z = THICK * (0.62 + 0.38 * min(1.0, edge / (HEM * 0.35)))
            else:
                # WAFFLE: 16 mm pitch, a 7 mm groove, flat either side. Two
                # grid samples land inside every groove and two on every land.
                gx = ((x + 10.0) % 0.016) < 0.007
                gy = ((y + 10.0) % 0.016) < 0.007
                z = THICK * (0.66 if (gx or gy) else 1.0)
            row.append((x, y, z))
        rows.append(row)
    top = ST.grid("towel_top", rows)
    # and the underside, so the towel is a solid with a real edge
    bot = ST.grid("towel_bot", [[(p[0], p[1], 0.0) for p in r]
                                for r in reversed(rows)])
    ob = ST.join("towel_panel", [top, bot])
    HD.fill_loop(ob)
    return ob


def build():
    ob = panel()
    fabric = ST.fabric("TowelTerry", CLOTH, rough=0.93, weave=0.0022,
                       sheen=0.06, scale_mm=300.0)
    ob.data.materials.append(fabric)

    # THE TRI-FOLD: in thirds the long way, then in half. Radius follows the
    # thickness, because a fold's radius IS the material -- the folded garments
    # failed by picking a radius first and getting a tower.
    r = THICK * 1.15
    (x0, x1), (y0, y1), _z = FO.span(ob)
    FD.fold(ob, 'x', x0 + (x1 - x0) / 3.0, r, side=-1)
    (x0, x1), (y0, y1), _z = FO.span(ob)
    FD.fold(ob, 'x', x1 - (x1 - x0) / 2.0, r * 1.7, side=+1)
    (x0, x1), (y0, y1), _z = FO.span(ob)
    FD.fold(ob, 'y', (y0 + y1) * 0.5, r * 2.6, side=-1)
    FD.settle(ob, floor_z=0.0, sag=0.0018, corner=0.48)
    FD.press(ob)
    FO.centre_xy(ob)
    ST.crisp(ob, dissolve=1.4, sharp=26.0, crease=30.0)
    FO.check_stack(ob, "towel")

    # THE GROMMET AND THE CARABINER at one corner
    # ON THE SURFACE UNDER IT, not at the stack's global maximum. z1 is the
    # highest point anywhere on the towel -- a fold ridge on the far side --
    # so the grommet and its carabiner floated a centimetre clear of the
    # corner they are supposed to be fixed through.
    (x0, x1), (y0, y1), (z0, z1) = FO.span(ob)
    gx, gy = x0 + 0.034, y1 - 0.030
    near = [v.co.z for v in ob.data.vertices
            if abs(v.co.x - gx) < 0.016 and abs(v.co.y - gy) < 0.016]
    if not near:
        raise SystemExit("BUILD FAILED: no towel surface under the grommet")
    gz = max(near)
    grom = HD.revolve("towel_grommet",
                      [(0.0042, 0.0), (0.0042, 0.0018), (0.0082, 0.0022),
                       (0.0092, 0.0008), (0.0088, -0.0016), (0.0042, -0.0016)],
                      sides=22)
    for v in grom.data.vertices:
        v.co = Vector((v.co.x + gx, v.co.y + gy, v.co.z + gz - 0.0006))
    grom.data.update()

    path = []
    for i in range(30):
        a = math.pi * 2.0 * (i / 29.0) * 0.86 - 0.35
        path.append(Vector((gx + 0.0225 * math.sin(a),
                            gy - 0.0018,
                            gz + 0.0265 - 0.0225 * math.cos(a))))
    clip = ST.sweep("towel_clip", path, 0.0026, 0.0026, sides=10)

    grom.data.materials.append(HD.brushed("TowelGrommet", (0.66, 0.64, 0.60),
                                          rough=0.30))
    clip.data.materials.append(HD.brushed("TowelClip", (0.60, 0.62, 0.66),
                                          rough=0.22))
    ST.smooth_by_angle(grom, 30.0)
    ST.smooth_by_angle(clip, 32.0)

    objs = [ob, grom, clip]
    HD.sit_on_floor(objs)
    HD.measure(objs, "towel")
    return objs


def main():
    argv = H.argv_after_dashes()
    H.reset_scene()
    H.set_engine("CYCLES" if "cycles" in argv else "EEVEE", samples=112)
    objs = build()
    lo, hi = H.bounds(objs)
    look = Vector(((lo.x + hi.x) * 0.5, (lo.y + hi.y) * 0.5,
                   (lo.z + hi.z) * 0.5))
    r = max((hi - lo).x, (hi - lo).y, (hi - lo).z) * 0.5
    HD.studio_hard(look, r, ev=EV, world=0.24)
    print("  tris %d" % ST.tris(objs))
    out = ST.out_dir("qa", "hero", "v5", NAME)
    if "render" in argv:
        ST.shots(objs, look, r, out,
                 [("three", -58.0, 30.0, 85.0), ("front", -90.0, 16.0, 85.0),
                  ("top", -70.0, 64.0, 85.0), ("side", -6.0, 14.0, 85.0)],
                 res=(1100, 900), margin=1.14)
        # AND A CLOSE-UP. The waffle is 1.9 mm of relief on a 300 mm stack, so
        # in a wide frame it is four pixels and the towel reads as a smooth
        # silicone pouch -- which is what two rounds of this looked like before
        # the relief was measured directly and found to be entirely present.
        # A texture claim needs a frame at the texture's own scale.
        dlook = Vector((look.x - 0.055, look.y + 0.045, hi.z - 0.004))
        HD.studio_hard(dlook, 0.055, ev=EV, world=0.24)
        ST.shots(objs, dlook, 0.055, out,
                 [("detail", -60.0, 30.0, 95.0)], res=(1100, 900), margin=1.02)
    if "export" in argv:
        import export_all as EX
        for o in objs:
            if not o.data.uv_layers:
                ST.unwrap(o)
        ST.flatten_for_export(objs)
        EX.set_origin(objs, "base")
        H.bake_gltf_axis(objs)
        H.export_glb(objs, os.path.join(
            ST.ROOT, "Assets", "models", "hero", "v5", "hard_towel.glb"))


if __name__ == "__main__":
    main()
