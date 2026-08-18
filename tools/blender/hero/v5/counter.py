"""shop-counter -- the front desk, built as joinery.

THE BRIEF: "This is still a grey box in my game and the player stands at it for
every transaction... a top with an edge profile, a front panel, a kick, a
customer-side shelf, and the countertop the register and ledger already sit on.
Highest-visibility fixture in the shop."

IT DOES NOT GET WIRED IN HERE. `pine-hills-v2` suppresses assets 61, 62 and 63
to grey volumes on purpose and CLAUDE.md says the greybox stays -- so this
builds, renders and exports the asset, and placing it is a separate decision
that is the owner's. Building the thing he cannot see is not the same as
switching his variant.

WHAT MAKES A DESK READ AS JOINERY rather than as a box:

  * THE EDGE PROFILE. A worktop is not a slab with a uniform bevel; it is a
    section -- a bullnose or a chamfer, a shadow reveal underneath, and a
    thinner sub-rail behind that. That profile is EXTRUDED along the length
    here, which is how a top is actually made, and it is the one thing that
    catches a highlight in a single line along the whole desk.
  * THE REVEAL. The front panel sits back from the top and back from the kick,
    so there are two shadow lines running the length of the fixture. Boxes
    stacked flush have none, and that is most of why a greybox reads as a
    greybox even after it is textured.
  * THE KICK. A recessed plinth, so the desk does not appear to grow out of the
    floor. 100 mm tall, set back 55 mm.
  * TWO HEIGHTS. A 900 mm staff worktop where the register and the ledger sit,
    and a 1060 mm customer bar in front of it that hides the till from the
    customer's side. Every real pro shop counter has both, and the step between
    them is where the player's hands go.

Run: blender --factory-startup -b --python counter.py -- render export
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import hero_lib as H  # noqa: E402
import studio as ST  # noqa: E402
import hard as HD  # noqa: E402

NAME = "shop-counter"
EV = -0.10

L = 2.400          # length, customer side runs along x
D = 0.640          # staff worktop depth
H_WORK = 0.900     # staff worktop surface
H_BAR = 1.060      # customer bar surface
D_BAR = 0.300
KICK_H, KICK_SET = 0.100, 0.055

OAK = (0.104, 0.0605, 0.0322)      # the carcass and the front panel
TOPW = (0.640, 0.612, 0.560)       # a pale solid-surface worktop
DARK = (0.086, 0.078, 0.070)       # the kick
BRASS = (0.702, 0.552, 0.262)


def extrude_x(name, profile, x0, x1, cap=True):
    """Sweep a (y, z) profile along x -- how a worktop is actually made."""
    rows = [[(x, y, z) for y, z in profile] for x in (x0, x1)]
    ob = ST.grid(name, rows, wrap_u=True)
    if cap:
        HD.fill_loop(ob)
    return ob


def top_profile(y0, y1, z, thick, nose=0.012, reveal=0.007):
    """The section of a counter top, front to back.

    Front to back: the nose is chamfered top and bottom with a flat between --
    a real arris, not a radius -- then the underside steps BACK by `reveal` to
    throw a shadow line, then runs flat to the wall. Four straight runs and
    three short chamfers; nothing here is a curve, which is why the highlight
    is a line.
    """
    return [
        (y0 + nose, z),                       # top face, at the nose
        (y0, z - nose * 0.55),                # top chamfer
        (y0, z - thick + nose * 0.55),        # the nose's flat front
        (y0 + nose * 0.9, z - thick),         # bottom chamfer
        (y0 + reveal + nose, z - thick),      # underside
        (y0 + reveal + nose, z - thick - 0.018),   # the shadow reveal, down
        (y1, z - thick - 0.018),              # sub-rail, back to the wall
        (y1, z),
    ]


def build():
    parts = {}

    # THE CARCASS -- staff side, set back from everything in front of it
    # ST.box PLACES THE PART. Setting .location afterwards as well moved this
    # one twice -- 620 mm deep instead of 310 and 948 mm up instead of 474 --
    # and the desk measured 1030 x 1372 from a design that is 760 x 1060.
    parts["carcass"] = ST.box("counter_carcass",
                              (0.0, D * 0.5 - 0.010,
                               KICK_H + (H_WORK - 0.052 - KICK_H) * 0.5),
                              (L * 0.5 - 0.018, D * 0.5 - 0.030,
                               (H_WORK - 0.052 - KICK_H) * 0.5),
                              bevel=0.0016)

    # THE KICK -- recessed, so the fixture does not grow out of the floor
    parts["kick"] = ST.box("counter_kick",
                           (0.0, D * 0.5 + KICK_SET * 0.5, KICK_H * 0.5),
                           (L * 0.5 - 0.030, D * 0.5 - KICK_SET, KICK_H * 0.5))

    # THE FRONT PANEL -- customer side, standing proud of the carcass and
    # stopping short of the top, which is the second shadow line
    parts["front"] = ST.box("counter_front",
                            (0.0, -0.012, KICK_H + (H_BAR - 0.048 - KICK_H) * 0.5),
                            (L * 0.5, 0.014, (H_BAR - 0.048 - KICK_H) * 0.5))

    # A HORIZONTAL RAIL across the front panel: one more line down the length,
    # and the thing a fixture has that a box does not
    # a real foot/hand rail: 44 mm proud of the panel and 34 mm deep, so it
    # throws its own shadow. At 8 mm it was an olive hairline.
    parts["rail"] = ST.box("counter_rail", (0.0, -0.048, 0.742),
                           (L * 0.5 - 0.060, 0.017, 0.017), bevel=0.0026)

    # THE TWO TOPS, each an extruded profile
    parts["work"] = extrude_x("counter_work",
                              top_profile(0.030, D, H_WORK, 0.040),
                              -L * 0.5 + 0.006, L * 0.5 - 0.006)
    parts["bar"] = extrude_x("counter_bar",
                             top_profile(-0.120, -0.120 + D_BAR, H_BAR, 0.046),
                             -L * 0.5, L * 0.5)

    # THE CUSTOMER-SIDE SHELF, under the bar's overhang, for a bag
    parts["shelf"] = ST.box("counter_shelf", (0.0, -0.062, 0.700),
                            (L * 0.5 - 0.090, 0.052, 0.011), bevel=0.0016)
    brackets = []
    for sx in (-1, 1):
        brackets.append(ST.box("counter_brk%+d" % sx,
                               (sx * (L * 0.5 - 0.150), -0.062, 0.660),
                               (0.008, 0.048, 0.030), bevel=0.0014))
    parts["brackets"] = ST.join("counter_brackets", brackets)

    # END PANELS, proud of the front panel so the desk has a returned edge
    ends = []
    for sx in (-1, 1):
        ends.append(ST.box("counter_end%+d" % sx,
                           (sx * (L * 0.5 - 0.009), D * 0.5 - 0.070,
                            KICK_H + (H_WORK - 0.052 - KICK_H) * 0.5),
                           (0.009, D * 0.5 - 0.030,
                            (H_WORK - 0.052 - KICK_H) * 0.5)))
    parts["ends"] = ST.join("counter_ends", ends)

    m_oak = ST.wood("CounterOak", OAK, rough=0.42, span_mm=900.0)
    m_top = ST.matte("CounterTop", TOPW, rough=0.34)
    m_dark = ST.matte("CounterKick", DARK, rough=0.70)
    m_brass = HD.brushed("CounterBrass", BRASS, rough=0.30)
    # THE BAG SHELF IS JOINERY, not a second worktop. Given the worktop
    # material it read as a third counter surface halfway down the front
    # panel, which is the one thing a customer-side ledge must not do.
    for k in ("carcass", "front", "ends", "shelf"):
        parts[k].data.materials.append(m_oak)
    for k in ("work", "bar"):
        parts[k].data.materials.append(m_top)
    parts["kick"].data.materials.append(m_dark)
    parts["rail"].data.materials.append(m_brass)
    parts["brackets"].data.materials.append(m_brass)

    objs = list(parts.values())
    for ob in objs:
        # 22 degrees: joinery is flat panels and arrises. Anything that
        # smooths a 30-degree chamfer into its neighbour has thrown away the
        # only line the top has.
        ST.smooth_by_angle(ob, 22.0)
    HD.sit_on_floor(objs)
    HD.measure(objs, "counter")
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
    HD.studio_hard(look, r, ev=EV, world=0.22)
    print("  tris %d" % ST.tris(objs))
    out = ST.out_dir("qa", "hero", "v5", NAME)
    if "render" in argv:
        ST.shots(objs, look, r, out,
                 [("three", -58.0, 18.0, 62.0), ("front", -90.0, 6.0, 62.0),
                  ("side", -4.0, 8.0, 62.0), ("staff", 84.0, 26.0, 62.0)],
                 res=(1200, 900), margin=1.10)
        # AND THE EDGE, which is the whole claim. A 2.4 m desk in frame makes
        # the profile four pixels tall.
        elook = Vector((-L * 0.42, -0.06, 0.98))
        HD.studio_hard(elook, 0.20, ev=EV, world=0.22)
        ST.shots(objs, elook, 0.20, out,
                 [("edge", -64.0, 16.0, 95.0)], res=(1200, 900), margin=1.05)
    if "export" in argv:
        import export_all as EX
        for ob in objs:
            if not ob.data.uv_layers:
                ST.unwrap(ob)
        ST.flatten_for_export(objs)
        EX.set_origin(objs, "base")
        # MACRO OCCLUSION, into the vertices -- the shadow a sole casts
        # into a cavity back, or a counter top over its own kick recess,
        # belongs to this object once and cannot live in a tiling map.
        import vertex_ao as VAO
        VAO.bake(objs)
        H.bake_gltf_axis(objs)
        H.export_glb(objs, os.path.join(
            ST.ROOT, "Assets", "models", "hero", "v5", "hard_counter.glb"), vertex_colors=True)


if __name__ == "__main__":
    main()
