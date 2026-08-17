# APPAREL V3 — THE SAME RIGOUR YOU GIVE EVERYTHING ELSE

The concertina was the right call and the knit atlas fix was real. But the
apparel still does not get the treatment the hard-surface assets get, and I can
show you the numbers: **polo 8 rounds, hoodie 1, tee 2, trousers 2.** You built a
mechanism on the polo and ported it to three others without reviewing them as
their own assets.

The wand got measured until it read 0.00 mm. The hand got twenty-six rounds and a
pixel unprojection. The dustpan got a watched-fail on its own shipped data.
**The garments got a port.**

That stops here.

---

## SET UP V3 PROPERLY FIRST

**New folder: `tools/blender/hero/v3/`** — builders, library, references and
renders. v2 stays on disk untouched as the comparison baseline. Every v3 garment
gets rendered **beside its v2 self** at the same scale, lighting and camera, the
way you did the broom. If v3 does not clearly beat v2, it is not done.

**Blender for everything**, same pipeline as every other hero asset: turntable at
full size frame by frame, assertions in the build, round-trip gate on export,
blank-frame gate. No exceptions because it is cloth.

---

## EACH GARMENT IS ITS OWN ASSET

Polo, tee, hoodie, trousers, cap. Folded and hung. **Ten deliverables, each
reviewed on its own frames** — not "the mechanism works, therefore they all pass."

For each one, in order:

1. **Reference beside the render, every round.** You have 8 for the polo and 1
   each for hoodie, tee and trousers. Fix that before you build — three or four
   per garment, showing construction, hung side views, and folded stacks at a low
   angle.
2. **Write the fault list BY FRAME NUMBER before fixing anything**, as a hostile
   lead artist would. You did this for the hand and the dustpan and it worked.
3. Fix, re-render, re-review.
4. **Park at twelve rounds** with the reason written down, or cut it.

**A garment is not done because the one before it was.**

---

## THE ASSERTIONS YOU ARE MISSING

Every cloth check you have tests construction. None of them test whether it
**reads** as cloth. That is why the review keeps collapsing into "the listed
faults are gone".

Build measurable ones, each watched failing on a known-bad case first — same as
`assert_leaves_clear`, which earned its keep the moment you drove leaves 4 mm
into each other and the general check sailed through:

- **Relief depth.** Seams, ribs, hems and stitch lines must project far enough to
  cast a shadow at player distance. Measure it. A collar that washes out is a
  measurable failure, not a taste call.
- **Silhouette irregularity.** No two plies, hems or edges may agree within a
  tolerance. Dead-level and evenly-spaced are the two things that read as
  manufactured, and you have fixed both by hand twice now.
- **No flat caps.** Every loft end closed or tucked. You have hit this on the
  sleeve, the cuff, the hood end and the sleeve tip — four times, same fault,
  never assertable.
- **Every part reachable by light.** The buried collar came from `top_z`
  returning a lower ply. That is a check, not a comment.

---

## THE THINGS YOU ALREADY LISTED AS NOT DONE

Take all of them:

- **The hung garments** — none have had the concertina/relief treatment.
- **Multiple colourways per garment.** Only the polo has five. A rail of eight
  identical navy garments is not a shop.
- **The tee's print floats above the cloth.** UV it onto the surface.
- **Topstitching and sleeve badges** — both on the relief-and-plainness list.
- **`build_apparel`'s polo collar** is still the old part.

---

## RULES

**Reference beside every render, every round. Turntable at full size, frame by
frame, never the contact sheet.**

**Controls instead of guessing** when a fault survives a fix.

**v2-vs-v3 side by side for every garment**, and show me both.

**Park at twelve or cut**, and say why.

Compact at 80% and carry on. Finish and push the garment you are on first.

In the morning: the ten-garment table with rounds spent, the v2/v3 comparison
frames, what you cut and why, and what is still not good enough.