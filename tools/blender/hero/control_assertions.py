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
print("=" * 78)
print("PART 5 — the COPLANAR GRAZE, on the two cap panels that exposed it")
print("  a single axis-aligned parity ray is exact until it runs ALONG a face,")
print("  and everything in this project has a flat bottom at z = 0")
print("=" * 78)
import build_cap as CP  # noqa: E402
from mathutils import Vector  # noqa: E402

H.reset_scene()
cp = {}
CP.build_crown(cp)
lhs, rhs = cp["panel3"], cp["panel2"]


def worst_depth(inside_fn):
    worst, where = -1e9, None
    for v in lhs.data.vertices:
        w = lhs.matrix_world @ v.co
        local = rhs.matrix_world.inverted() @ w
        ok, loc, _n, _i = rhs.closest_point_on_mesh(local)
        if not ok:
            continue
        d = (local - loc).length
        d = d if inside_fn(local) else -d
        if d > worst:
            worst, where = d, w
    return worst, where


single_x = lambda p: HS._crossings(rhs, p, Vector((1.0, 0.0, 0.0)), 1e-6, 64)
old, old_at = worst_depth(single_x)
new, _new_at = worst_depth(lambda p: HS.point_inside(rhs, rhs.matrix_world @ p))

print(f"  ONE +x ray (the shipped instrument): {old * 1000:+8.2f} mm  "
      f"at z = {old_at.z * 1000:+.2f} mm")
print(f"  three tilted rays, majority:         {new * 1000:+8.2f} mm")
if old < 0.050:
    WRONG.append("the +x graze no longer reproduces, so this control proves "
                 "nothing about the fix")
if new > 0.0006:
    WRONG.append(f"two adjacent panels still read as {new * 1000:.2f} mm "
                 f"inside each other")
expect("assert_assembly on the two back panels alone", False,
       lambda: HS.assert_assembly({"panel2": rhs, "panel3": lhs},
                                  "two adjacent cap panels"))

print()
print("=" * 78)
print("PART 6 — the EMPTY MATERIAL SLOT a boolean leaves behind")
print("  the fault: append() lands in slot 1, the polygons all read slot 0,")
print("  and the part renders in Blender's default white with perfect UVs")
print("=" * 78)
H.reset_scene()


def punch(name):
    t = HS.box(name, (0, 0, 0), (0.100, 0.060, 0.020))
    c = HS.box(name + "Cut", (0, 0, 0), (0.020, 0.020, 0.080))
    m = t.modifiers.new("Punch", "BOOLEAN")
    m.operation, m.object, m.solver = "DIFFERENCE", c, "EXACT"
    return t, c


# RAW: convert() with no slot cleanup, which is what apply_mods used to do.
raw, rawcut = punch("SlotRaw")
bpy.context.view_layer.objects.active = raw
bpy.ops.object.select_all(action="DESELECT")
raw.select_set(True)
bpy.ops.object.convert(target="MESH")
raw = bpy.context.view_layer.objects.active
bpy.data.objects.remove(rawcut, do_unlink=True)
rawslots = list(raw.data.materials)
rawidx = sorted({p.material_index for p in raw.data.polygons})
print(f"  raw convert(): {len(rawslots)} slot(s) "
      f"{[m and m.name for m in rawslots]}, polygons use {rawidx}")
if not (rawslots and all(m is None for m in rawslots)):
    WRONG.append("the boolean no longer leaves an empty slot, so this control "
                 "proves nothing about the fix")

target, cutter = punch("SlotTarget")
punched = HS.apply_mods(target)
bpy.data.objects.remove(cutter, do_unlink=True)

slots = list(punched.data.materials)
idx = sorted({p.material_index for p in punched.data.polygons})
print(f"  apply_mods():  {len(slots)} slot(s) {[m and m.name for m in slots]}"
      f", polygons use material_index {idx}")
mat = HS.pbr("SlotProof", (0.2, 0.5, 0.3))
punched.data.materials.append(mat)
used = {punched.data.materials[p.material_index] for p in punched.data.polygons}
print(f"  after append(): polygons resolve to {[m and m.name for m in used]}")
if used != {mat}:
    WRONG.append("a boolean result still renders with no material after "
                 "append() -- the empty slot is back")
print(f"  ok    every face of the punched part resolves to {mat.name}")

print()
print("=" * 78)
print("PART 7 - the folded stack: leaves that lace through each other")
print("=" * 78)
# The whole point of folded_stack is that the leaves are SEPARATE closed
# shells with air between them. Two ways that can go wrong and both have to be
# caught: leaves driven through each other, and leaves floating apart. The
# second one is not hypothetical -- the first build of it failed exactly that
# way with "leaf0 touches nothing".
import cloth_lib as CL  # noqa: E402

for gap_mm, want_fail, why in ((0.9, False, "0.9 mm apart: a stack, in contact"),
                               (-4.0, True, "-4 mm: leaves laced through"),
                               (9.0, True, "9 mm apart: leaves floating")):
    H.reset_scene()
    parts = CL.folded_stack("Ctl", (0, 0, 0), (0.300, 0.230, 0.048),
                            leaves=4, gap=gap_mm / 1000.0, seed=0.3)
    expect(f"folded_stack at gap {gap_mm:+.1f} mm -- {why}", want_fail,
           lambda p=parts: CL.assert_leaves_clear(p, "control: the stack"))

H.reset_scene()
parts = CL.folded_stack("CtlShell", (0, 0, 0), (0.300, 0.230, 0.048),
                        leaves=4, seed=0.3)
shells = {n: HS.shells(o) for n, o in parts.items()}
bad = {n: s for n, s in shells.items() if len(s) != 1}
print(f"  every leaf is one closed shell: "
      f"{ {n: len(s) for n, s in shells.items()} }")
if bad:
    WRONG.append(f"a leaf came out in pieces: {bad}")
closed = {n: HS.is_closed(o) for n, o in parts.items()}
print(f"  every leaf is watertight: {closed}")
if not all(closed.values()):
    WRONG.append("a leaf is not a closed surface, so no parity test on the "
                 "stack means anything")

expect("assert_leaves_clear on parts with no leaves -- must refuse, not pass",
       True,
       lambda: CL.assert_leaves_clear({"body": parts["leaf0"]}, "control: empty"))

print()
if WRONG:
    raise SystemExit("CONTROL FAILED: " + "; ".join(WRONG))
print("CONTROL PASSED — every new assertion has now been watched failing on the "
      "real fault it exists to catch, and passing on geometry that is correct.")
