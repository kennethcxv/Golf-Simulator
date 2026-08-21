# APPAREL v6 — CLOSE THE GAP TO PRODUCTION

v5 was the first version built the right way and it beat v4 decisively. **It is
still not production ready, and this time you have the diagnosis in your own
words.**

Two things go first, before any modelling.

---

## PART 0 — GET REAL REFERENCE ON DISK. You said you had none.

Your own report: *"No reference column. There's no hardgoods reference board on
disk and I have no way to save photos to disk, so I built from construction."*

**That is the single biggest difference between the assets that came out well and
the ones that did not.** The dustpan, the money, the register and the golf balls
all had photographs beside every render. The garments had one board for the whole
set and one photo each for the hoodie, tee and trousers.

**Fix it:**

- **You can fetch images** — you did it in an earlier session with the Wikimedia
  Commons API and saved them under `qa/hero/v4/ref/`. Do that again, properly.
- **Four to six photographs per garment**, and specifically these angles, because
  they are the ones that caught faults last time:
  - a hung garment **from the side**, so the depth is a measurement and not a guess
  - **a folded stack from a low angle**, so ply edges and shadow slots read
  - **construction close-ups** — a collar seam, a cuff rib, a placket stitch line,
    a hood opening, a waistband and its loops
  - **a shop rail with several garments on it**, for how they actually sit
- Save them under `Designs/ProShop/Apparel/v6/<asset>/` and **put the reference
  in the comparison sheet for every single round.**

**If you genuinely cannot fetch and save images, say so in one line and stop** —
do not spend another session building from construction alone. That approach has
now produced five revisions.

---

## PART 1 — THE FAULTS YOU NAMED AND LEFT

You listed these yourself. Every one is still open:

- **The cap's visor is too large for its crown**, and the back strap reads weakly.
- **The folded trousers' plies splay.**
- **Small nicks survive at the polo's armhole** in the back view.
- **The hoodie's crown keeps one flat facet.**
- **The towel's waffle exists in the flat panel and is gone after
  fold/settle/press** — you measured 8 distinct z values over 5.50 mm before, and
  nothing after, and did not isolate which step eats it. **Isolate it.** It is
  almost certainly the same fault class you hit three times in one session: *a
  feature smaller than its sampling.*

**Fix all five before adding anything new.** Named residuals that survive a
session become permanent.

---

## PART 2 — WHAT "PRODUCTION READY" ACTUALLY NEEDS

v5 has correct construction. What it does not have:

**MATERIAL DEPTH.** Every garment is procedural noise on colour and bump. A real
knit at shop distance has visible wales, a heather twist, a sheen that changes
across a fold, and a nap direction. **This is now the biggest gap** — the
construction is right and the surfaces still read as one flat fabric.

**REAL BRANDING AND PRINT.** These are shop goods. Chest logos, sleeve badges,
printed fronts, woven labels, hang tags, size stickers, contrast collars. **A rail
of unmarked navy garments is not a shop**, and you flagged this in v4 and it never
landed.

**COLOURWAYS.** Only the polo has five. **Every garment needs three or four**, as
atlas cells, not materials.

**THE CREASES A PRESSED GARMENT HAS.** Your solve produces sag and seam roll.
A hung shirt in a shop also has two or three broad soft creases from being folded
in a box, and a folded stack has compression where the plies bear on each other.

---

## RULES — WHAT WORKED IN v5, KEPT

**One asset, one review.** v5's round counts were polo 8, hoodie 1, tee 2,
trousers 2 — a mechanism ported and called done. **Each garment gets its own
fault list by frame number and its own rounds.**

**Measure the thing that is wrong.** Every real v5 fix came from a number: width
against sag caught the 14% shrink, hem depth caught the seam inflation, ply count
caught the fold tower. **Keep printing the measurement that would have caught the
fault.**

**Watch for "a feature smaller than its sampling."** It hit you three times in one
session and each time it presented as a broken material. When a detail vanishes,
check the grid pitch before the shader.

**No harmonic terms. Crisp edges at ~25-30°.** Both held and both are why v5 works.

**REFERENCE | v5 | v6 sheet for every asset, full size.**

**Park at twelve rounds** with the reason written, or cut it.

**Export and round-trip each asset as you finish it**, then verify in game with
`apparel-v5-ingame.js`. Do not accumulate ten unexported assets.

Compact at 80% and carry on.