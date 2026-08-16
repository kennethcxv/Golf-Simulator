"""NEGATIVE CONTROL for the blank-frame guard.

A guard that has never been watched failing is a guard that proves nothing, so
this makes it fail on purpose four ways before anyone trusts a green build:

  A  the exact historical bug -- the dustpan's "under" camera at -44 degrees
     with the backdrop left visible, which is what shipped. Must FAIL.
  B  a camera aimed at empty sky, the general "no subject" case. Must FAIL.
  C  the normal hero camera. Must PASS -- a guard that fails everything is
     just as useless as one that fails nothing.
  D  the SAME under-camera with the fix active. Must PASS, because hiding the
     backdrop is what that shot needed.

It also re-scores the eleven blank frames already on disk against the guard's
own statistic, so the threshold is shown to separate real data and not just
this scene.

    blender --factory-startup -b --python tools/blender/hero/control_blank_guard.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import hero_lib as H  # noqa: E402
import hardsurface_lib as HS  # noqa: E402

OUT = os.path.join(os.getcwd(), "qa", "hero", "_control")
os.makedirs(OUT, exist_ok=True)
FAILURES = []


def expect(name, want_fail, fn):
    try:
        fn()
        got = "passed"
    except SystemExit as e:
        got = "FAILED THE BUILD"
        msg = str(e).splitlines()[0]
    ok = (got != "passed") == want_fail
    verdict = "  ok " if ok else "  !! WRONG"
    print(f"{verdict}  {name}: guard {got} "
          f"(wanted {'a failure' if want_fail else 'a pass'})")
    if got != "passed":
        print(f"          {msg}")
    if not ok:
        FAILURES.append(name)


# ---------------------------------------------------------------------------
# calibration against the frames already on disk
print("CALIBRATION — the guard's own statistic on frames that already exist")
known_blank = [
    "qa/hero/dustpan/dustpan-under.png", "qa/hero/rake/rake-under.png",
    "qa/hero/mower/mower-reel.png", "qa/hero/hand/hand-palmar.png",
    "qa/hero/broom/broom-under.png", "qa/hero/spreader/spreader-spinner.png",
]
known_good = [
    "qa/hero/dustpan/dustpan-hero.png", "qa/hero/rake/rake-tt00.png",
    "qa/hero/hand/hand-tt03.png", "qa/hero/wand/wand-gun.png",
    "qa/hero/basket/basket-tt00.png", "qa/hero/ledger/ledger-tt00.png",
]
worst_blank, best_good, still_blank = 0.0, 1e9, 0
for f in known_blank:
    if os.path.exists(f):
        s = H.frame_edge_score(f)
        # A listed blank that now scores high has been REPAIRED by the backdrop
        # fix -- rebuilding its asset is the intended outcome, so it drops out
        # of the calibration set rather than breaking it.
        if s >= H.BLANK_EDGE_MIN:
            print(f"    (repaired, no longer blank: {s:7.2f}  {f})")
            continue
        worst_blank = max(worst_blank, s)
        still_blank += 1
        print(f"    blank  {s:7.2f}  {f}")
for f in known_good:
    if os.path.exists(f):
        s = H.frame_edge_score(f)
        best_good = min(best_good, s)
        print(f"    good   {s:7.2f}  {f}")
print(f"  worst blank {worst_blank:.2f} | threshold {H.BLANK_EDGE_MIN} | "
      f"best real frame {best_good:.2f}   "
      f"(separation {best_good / max(worst_blank, 0.01):.0f}x)")
if still_blank < 3:
    FAILURES.append(f"only {still_blank} un-repaired blanks left on disk to "
                    f"calibrate against; the control needs a fresh sample")
elif not (worst_blank < H.BLANK_EDGE_MIN < best_good):
    FAILURES.append("threshold does not separate the two populations")
print()

# ---------------------------------------------------------------------------
# a scene to shoot: the dustpan, framed exactly as its builder frames it
import build_dustpan as DP  # noqa: E402  (its main() renders the real set)

H.reset_scene()
H.set_engine("EEVEE", samples=16)
parts = DP.build()
subject = [parts["pan"], parts["handle"]]
centre, radius = H.subject_sphere(subject)
LENS = 74.0
dist = H.fit_distance(radius, LENS, res=(1100, 1100), margin=1.22)
H.studio(center=centre, scale=radius)
floor = H.backdrop(center=centre, scale=radius)

under_loc = H.orbit_position(centre, dist, 90, -44)
print(f"THE GEOMETRY: subject centre z {centre.z:+.4f}, backdrop plane z "
      f"{floor.location.z:+.4f}, 'under' camera z {under_loc.z:+.4f}")
print(f"  the under-camera sits {(floor.location.z - under_loc.z) * 1000:.0f} mm "
      f"BELOW the backdrop, looking up at its back face.")
print(f"  cameras go under the card below about "
      f"{-__import__('math').degrees(__import__('math').asin(1.05 * radius / dist)):.1f} "
      f"degrees of elevation; every blank frame in the set is below that and "
      f"every surviving frame is above it.\n")

print("CONTROLS")

# A — the historical bug, reproduced by defeating the fix
cam_a = H.camera("under_bug", under_loc, centre, lens=LENS)


def shoot_with_backdrop_visible():
    """Render the way it shipped: backdrop left in front of the lens."""
    scene = bpy.context.scene
    scene.camera = cam_a
    scene.render.resolution_x = scene.render.resolution_y = 900
    scene.render.filepath = os.path.join(OUT, "A-historical-bug.png")
    bpy.ops.render.render(write_still=True)
    H.assert_frame_has_subject(os.path.join(OUT, "A-historical-bug.png"))


expect("A  under-camera, backdrop visible (what shipped)", True,
       shoot_with_backdrop_visible)

# B — aimed at nothing at all
cam_b = H.camera("empty", (centre.x, centre.y - dist, centre.z + dist * 2.0),
                 (centre.x, centre.y - dist * 4, centre.z + dist * 6), lens=LENS)
expect("B  camera aimed at empty sky", True,
       lambda: H.render(cam_b, os.path.join(OUT, "B-empty-sky.png"), res=(900, 900)))

# C — a real frame must still pass
cam_c = H.camera("hero", H.orbit_position(centre, dist, 118, 30), centre, lens=LENS)
expect("C  the normal hero camera", False,
       lambda: H.render(cam_c, os.path.join(OUT, "C-hero.png"), res=(900, 900)))

# D — the same under-view, with the fix doing its job
cam_d = H.camera("under_fixed", under_loc, centre, lens=LENS)
expect("D  the under-camera with the backdrop fix", False,
       lambda: H.render(cam_d, os.path.join(OUT, "D-under-fixed.png"), res=(900, 900)))

print()
if FAILURES:
    raise SystemExit("CONTROL FAILED: " + "; ".join(FAILURES))
print("CONTROL PASSED: the guard fails on blank frames, passes on real ones, "
      f"and the fix turns the historical blank into a real frame.\n  evidence: {OUT}")
