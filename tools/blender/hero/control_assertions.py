"""NEGATIVE CONTROL for the rebuilt assertions.

The brief: "Before trusting any assertion again, run it against a known-bad
asset and confirm it fails." The known-bad assets are not hypothetical — they
are the ones already shipped:

  the WAND     grip driven 20.26 mm into a body 41.6 mm thick
  the DUSTPAN  handle that is three disconnected cylinders
  the BASKET   handles that the OLD instrument called 71.85 mm inside a 6 mm shell

Each new assertion is run against the fault it exists to catch, and against a
synthetic pair that is genuinely correct, because an assertion that fails
everything proves as little as one that fails nothing.

    blender --factory-startup -b --python tools/blender/hero/control_assertions.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402

WRONG = []


def expect(name, want_fail, fn):
    try:
        fn()
        got, msg = False, ""
    except SystemExit as e:
        got, msg = True, str(e).splitlines()[0]
    ok = got == want_fail
    print(f"  {'ok  ' if ok else '!! WRONG'}  {name}")
    print(f"          {'FAILED: ' + msg if got else 'passed'}")
    if not ok:
        WRONG.append(name)


print()
print("=" * 78)
print("PART 1 — the depth ceiling, on a synthetic pair where the truth is known")
print("=" * 78)
H.reset_scene()
host = HS.box("Host", (0, 0, 0), (0.100, 0.100, 0.100))
for depth_mm, want_fail, why in ((1.5, False, "seated 1.5 mm: attached"),
                                 (20.0, True, "20 mm in: the wand's fault"),
                                 (49.0, True, "49 mm in: out the far side")):
    peg = HS.box(f"Peg{depth_mm}", (0, 0, 0.050 + 0.025 - depth_mm / 1000.0),
                 (0.020, 0.020, 0.050))
    expect(f"assert_touching, peg {depth_mm:4.1f} mm into a 100 mm block "
           f"({why})", want_fail,
           lambda p=peg: HS.assert_touching(p, host, "seating", max_gap=0.0015))
peg = HS.box("PegFloat", (0, 0, 0.090), (0.020, 0.020, 0.050))
expect("assert_touching, peg floating 10 mm clear (the old gap check)", True,
       lambda: HS.assert_touching(peg, host, "seating", max_gap=0.0015))

print()
print("=" * 78)
print("PART 2 — assert_assembly against the SHIPPED WAND")
print("  the pair it must catch is grip/body, which no shipped assertion named")
print("=" * 78)
import build_wand as WD  # noqa: E402

H.reset_scene()
H.set_engine("EEVEE", samples=8)
w = WD.build()
wand_parts = {k: v for k, v in w.items()
              if hasattr(v, "data") and getattr(v.data, "vertices", None) is not None}
print(f"  {len(wand_parts)} parts -> "
      f"{len(wand_parts) * (len(wand_parts) - 1) // 2} pairs")
expect("assert_assembly on the shipped wand", True,
       lambda: HS.assert_assembly(wand_parts, "the wand as it shipped"))

print()
print("  and the same call with the deep pairs declared deliberate:")
expect("assert_assembly, grip/socket + socket/body allow-listed", True,
       lambda: HS.assert_assembly(
           wand_parts, "the wand with two pairs declared",
           allow=[("grip", "socket"), ("socket", "body")]))

print()
print("=" * 78)
print("PART 3 — assert_all_one_piece against the SHIPPED DUSTPAN")
print("=" * 78)
import build_dustpan as DP  # noqa: E402

H.reset_scene()
H.set_engine("EEVEE", samples=8)
d = DP.build()
print(f"  pan shells {HS.shells(d['pan'])}   handle shells {HS.shells(d['handle'])}")
expect("assert_one_piece(pan) — the one the builder ships", False,
       lambda: HS.assert_one_piece(d["pan"], "the pan"))
expect("assert_all_one_piece(all parts) — the one it does not", True,
       lambda: HS.assert_all_one_piece({"pan": d["pan"], "handle": d["handle"]},
                                       "the dustpan as it shipped"))

print()
print("=" * 78)
print("PART 4 — the cavity fix, against the BASKET the old test lied about")
print("=" * 78)
import build_basket as BK  # noqa: E402

H.reset_scene()
H.set_engine("EEVEE", samples=8)
p = BK.build()
for i, h in enumerate(p["handles"]):
    mw = h.matrix_world
    depths = [HS.point_depth_inside(p["body"], mw @ v.co) for v in h.data.vertices]
    n = sum(1 for x in depths if x > 0)
    print(f"  handle {i}: {n}/{len(depths)} verts in the WALL, deepest "
          f"{max(depths) * 1000:+.2f} mm      (old instrument: 12 and 33 verts, "
          f"up to +71.85 mm, all of it cavity)")
    if n > 8:
        WRONG.append(f"handle {i} still reads as inside the shell")
expect("assert_rooted(bosses) still finds the bosses genuinely in the wall", False,
       lambda: HS.assert_rooted(p["bosses"], p["body"], "handle pivot bosses",
                                min_verts=3, min_depth=0.0015))
expect("assert_no_overlap(handleA, handleB) — they really do clear", False,
       lambda: HS.assert_no_overlap(p["handles"][0], p["handles"][1],
                                    "the two handles", min_gap=0.0015))

print()
if WRONG:
    raise SystemExit("CONTROL FAILED: " + "; ".join(WRONG))
print("CONTROL PASSED — every new assertion has now been watched failing on the "
      "real fault it exists to catch, and passing on geometry that is correct.")
