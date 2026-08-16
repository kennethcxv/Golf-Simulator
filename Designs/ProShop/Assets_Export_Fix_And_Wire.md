# FIX THE EXPORT, THEN WIRE IT ALL IN

You found the fault that explains a lot of this project's history: **the export
scrambles the asset.** The shipped rake is 1,750 mm tall with its base 786 mm
below the origin; its Blender scene is 970 mm. `bake_gltf_axis` permutes vertices
and leaves each object's location in the old convention.

And the reason nobody caught it: **every assertion and every render looks at the
Blender scene. The GLB is written last and never read again.** Correct frames,
passing checks, wrong file.

That is this session's whole first job. Nothing gets wired until it is closed.

---

## PART 1 — CLOSE THE EXPORT FAULT

**Apply the location-bake fix to the remaining 23 builders.** `build_rack` and
`build_register` already do it; you fixed rake, mower and spreader and watched
all three drop off the tell list.

**Verify every one with `control_export_roundtrip.py`** — build, export,
re-import, compare. Not a spot check: **all 40 files, each reporting its own
number.** The rake went 786.25 mm → 0.00; I want that column for the whole set.

**Then make it impossible to regress.** The round-trip check belongs inside the
export path, not beside it — a builder that writes a scrambled GLB should fail
its own build, the way a blank frame does now. Watch it fail on a deliberately
unbaked builder before you trust it.

**Re-export everything and confirm 0 of 40 stale and 0 of 40 scrambled.**

---

## PART 2 — THE TWO REMAINING ITERATES

**The hoodie folded** — your own weakest verdict, twice. If it cannot be made to
read as a hoodie in six rounds, cut it and say so; a shop rail without hoodies is
better than a shop rail with a lump on it.

**Tee and hoodie hung** — never started. Same panel work the polo hung got.

Everything else on the table is PASS.

---

## PART 3 — HALF B, PROPERLY THIS TIME

Only after Part 1 reports clean.

**Before you wire anything, get the baseline honest.** The suite is already red at
12 failures, none of them yours. **Name all twelve and record them**, so anyone
reading the wiring commits can tell your breakage from the existing kind. If any
of the twelve is trivially fixable, say which — do not fix them.

**Then wire, one asset at a time:**

1. Swap the file or the reference.
2. **Photograph it IN GAME.** Held at the camera for tools, on the shelf for
   merchandise, on the counter for the register and the bag. This is the real
   test and the reason these were built design-only.
3. **Look at that photograph.** The broom comparison proved the point — your
   bristles beat the shipping asset's and lost on materials. A studio render
   would never have told you that. If an asset does not survive the clubhouse
   lighting, that is a fault, and it goes back rather than in.
4. Golden gate and the suite after each one.
5. **If wiring an asset breaks anything — a golden that moves and should not, a
   new suite failure, a program count that jumps — REVERT THAT ONE ASSET**, note
   it, and move to the next.
6. Commit and push per asset, not in one lump.

**Report the delta per asset**, not totals: draws, materials, programs,
triangles, texture bytes. A parallel session is holding this game at 193 programs
and 2,325 standing draws and is actively measuring both.

**One thing you already flagged that matters here:** the apparel atlas is embedded
separately in all ten GLBs — ~12.6 MB of the 14.7 MB total is the same texture
repeated. Fix that before wiring the apparel, or you ship twelve copies of one
image.

---

## RULES

**Same discipline throughout.** Turntable at full size frame by frame, reference
beside every render, assertions verified failing on known-bad first, controls
instead of guessing when a fault survives a fix.

**Park anything past eight rounds** and say why.

**Cut anything that cannot be made good** and say why. The broom call was right
and it may be right again.

**Compact yourself when you run low and carry on.** Finish and push the asset you
are on first.

In the morning: the round-trip column for all 40 files, the wiring table with
per-asset deltas, what you reverted and why, and anything you decided without me.