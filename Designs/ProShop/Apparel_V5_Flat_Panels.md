# APPAREL v5 — MATCH Designs/ProShop/Apparel/Image1.png

Four revisions have failed and I know why now. This brief tells you the cause and
the method. **Read all of it before opening Blender.**

---

## THE TARGET

**`Designs/ProShop/Apparel/Image1.png` is the shape truth for all ten assets.**
Match that style exactly — same construction language, same crispness, same
flatness, same level of detail. **Golf merchandise instead of whatever it shows**,
but the *style* is not negotiable and not to be reinterpreted.

Open it. Look at it for a while before you write any code. Then keep it open
beside every render you make, every round.

---

## WHY v2, v3 AND v4 ALL FAILED — THE SAME TWO CAUSES

**1. UNIFORM SMOOTHING.** Every edge, fold, hem and seam on every asset is
rounded to the same radius. Real cloth is the opposite: **crisp fold edges with
near-zero radius, and broad FLAT panels between them.** Uniform rounding is what
makes a garment read as memory foam, and it is present in all ten assets right
now.

**2. SINE-WAVE RIPPLE. STOP THIS COMPLETELY.** The code is full of
`0.135 * sin(3.1 * pi * u)` harmonic terms added to fake folds. **Sine ripple
reads as melted wax or corrugated card, never as cloth.** It is why they look
"wavy". Delete every harmonic fold term in the apparel path. All of them. Do not
retune them, do not reduce the amplitude — remove them.

**Real cloth folds are PIECEWISE: flat facets meeting at lines.** A fold is a
crease, not a wave. Two flat areas and a sharp transition.

---

## THE METHOD — THIS IS THE PART THAT CHANGES

**Stop building closed 3D garment volumes and then simulating them.** That is
what every previous revision did, and by the time the sim runs the volume is
already wrong — no amount of fold work reaches past it. That is why fifty rounds
produced no fundamental improvement.

**Build flat 2D panels, sew them, then let gravity act. That is how garments are
actually modelled.**

For a hung polo: front panel, back panel, two sleeve panels, collar, placket —
each a **flat sheet** laid out like a sewing pattern. Join the seams. Pin at the
hanger. Then simulate. Blender does all of this natively.

For a folded garment: **build a flat panel and fold it.** Not a stack of shapes
that resembles folded clothing — an actual sheet, folded, resting on a shelf. The
sleeve folds must come from the sleeves actually folding.

**If the current procedural cloth system cannot do this, replace it.** You are
explicitly allowed to delete `cloth_lib` and start over. Use real modelling:
subdivision, solidify, shrinkwrap, edge creases, cloth sim, sculpting, retopology
— whatever the shape needs. **Do not force all ten through one universal
generator.** That constraint is part of what has gone wrong.

---

## SET UP v5 CLEANLY

**New folder: `tools/blender/hero/v5/`.** v4 stays on disk for comparison.

Every asset renders **beside Image1.png and beside its v4 self**, same scale, same
lighting, same camera. **If v5 does not clearly beat v4 against the reference,
it is not done.**

---

## THE TEN, EACH ITS OWN ASSET

polo-hung, tee-hung, hoodie-hung, trousers-hung, cap, polo-folded, tee-folded,
hoodie-folded, trousers-folded, cap-peg.

**For each one, in this order:**

1. Open Image1.png. Open the current v4 turntable.
2. **Write the fault list by frame number BEFORE editing anything.**
3. Fix the silhouette first — flat panels, correct proportions.
4. Then construction — collars, cuffs, waistbands, hoods emerging from the
   garment rather than stuck on.
5. Then folds — **creases, not waves.**
6. Then material.
7. Render front, three-quarter, side, back, and top for the folded ones.
8. **REFERENCE | v4 | v5** comparison sheet.
9. Critique it yourself against Image1.png and iterate.

**A garment does not pass because the one before it passed.** Each gets its own
review.

**Specific faults in the current set you must fix:**

- **The polo and tee sleeves are Renaissance puff sleeves** — huge round shoulder
  caps ballooning outward. There is no armhole; the sleeve is an inflated tube
  stuck on the side.
- **The cap's visor has concentric ridges** like a scallop shell. That is loft
  rings showing through.
- **All four folded garments are stacks of pillows** — uniform thickness, every
  edge the same radius, too tall for their footprint, and **no visible sleeve
  folds**, which is the single thing that says "folded shirt".

---

## RULES

**Reference beside every render, every round. Full-size turntable frames, frame by
frame — never the contact sheet.**

**No sine waves anywhere in the apparel path.**

**No uniform smoothing — crisp folds, flat panels.**

**Do not build more QA frameworks.** Measure only when it fixes something visible.
The overwhelming majority of the time goes into the meshes.

**If you are tweaking the same bad construction for a third round, stop and
rebuild it with a different method.**

**Park at twelve rounds** with the reason written down, or cut it.

Technical gates only after the art is right. Compact at 80% and carry on.