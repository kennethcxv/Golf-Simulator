# APPAREL V3 — THE TEN-GARMENT TABLE

The brief's bar: **v3 renders beside v2 at the same scale and light, and if it
does not clearly beat v2 it is not done.** Every garment gets its own fault
list, named by the frame it was found in, before anything is changed.

## THE TABLE

| # | garment | v3 exists | compared to v2 | rounds | verdict |
|---|---|---|---|---|---|
| 1 | polo folded | yes | **yes** | 7 (v3 line) | **PASSES** — beats v2, F4 residual |
| 2 | tee folded | yes | **yes** | 6 | **PASSES** — beats v2, T7 residual |
| 3 | hoodie folded | yes, ported | no | 0 | ported, never reviewed as its own asset |
| 4 | trousers folded | yes, ported | no | 0 | ported, never reviewed as its own asset |
| 5 | polo hung | v2 only | no | 0 | not started |
| 6 | tee hung | v2 only | no | 0 | not started |
| 7 | hoodie hung | v2 only | no | 0 | not started |
| 8 | trousers hung | **does not exist** | no | 0 | has never been built, in any version |
| 9 | cap | v2 only | no | 0 | not started |
| 10 | cap second state | **does not exist** | no | 0 | the cap has one state |

Two of the ten have never been built at all. That is worth saying plainly
rather than leaving it to be discovered: "polo, tee, hoodie, trousers, cap,
folded and hung" is ten, and the tree contains eight.

## GARMENT 1 — POLO FOLDED. PASSES.

Frames: `qa/hero/v3/compare/polo-folded-{low,front,hero,top}.png`, v2 LEFT,
v3 RIGHT.

- **F1 — the cut end is a staircase.** RESOLVED. Two 164-sided n-gon caps
  standing as a flat wall with a step per ply. Now a hem: see THE X END below.
- **F2 — three rolls against v2's four.** RESOLVED at `plies=8, gap=0.0021`;
  `polo-folded-low.png` shows four rolls with genuinely dark slots against
  v2's four soft lips with none.
- **F3 — the slots are shallower and lighter than v2's.** RESOLVED, same frame.
- **F4 — v3's base is a dead-straight horizontal line.** OPEN, minor. v2's
  base sags slightly and v3's does not.
- **F5 — the size tag floats clear of the shirt.** Found on
  `polo-folded-top.png` after the hem landed. It measured as a 4.21 mm
  OVERLAP, so the numbers said it was attached: mid-height on an eight-ply
  stack falls in the gap BETWEEN plies, and out at the edge the hem has closed
  to a knife edge, so the overlap was with a sliver of nothing. It now hangs
  from under the top ply and the edge is measured at that same height.

## GARMENT 2 — TEE FOLDED. PASSES.

Frames: `qa/hero/v3/compare/tee-folded-{low,front,hero,top}.png`.

- **T1 — the print is a hard-edged white card.** RESOLVED, and this is the
  brief's own item. Two halves: the cell's `#e8e8e4` background on a `#e6decc`
  shirt, and a flat quad hovering over a domed surface catching a rim of
  shadow. The cell is now composited over a knit tile with the SAME base and
  SAME seed as the shirt's own cell, and at 2.6x resolution so the nap is the
  same size in world terms inside the print as outside it; the patch is built
  from the builder's own `top_at` so it follows the cloth. Compare the two on
  `tee-folded-top.png`: v2's card has a crisp rectangular border, v3 has ink.
- **T2 — the neck rib reads as a pale worm.** OPEN. Present in both versions.
- **T3 — v3's outline is a chamfered octagon.** RESOLVED. The footprint froze
  at 81% depth through the hem, so the end was a wall with only the thickness
  rounded. The hem radius now takes the depth in as well.
- **T4 — the x end is a fin / a faceted block / a spike.** RESOLVED. Three
  wrong cuts, all the same wrong idea; see THE X END below.
- **T5 — v3's top face carries the knit nap, v2's is smooth.** v3 wins.
- **T6 — the outline buckles into waves and cuts a corner off.** RESOLVED.
  `wander=1.7` came over from the polo's eighth round without being looked at.
  A tee is folded neatly; what it has instead of wander is thinner cloth and
  more of it (`plies=7`). Settled at 1.06, which is what the outline check
  needs to clear 3% of the garment's depth.
- **T7 — the sleeve folds stood 0.8 mm proud.** RESOLVED to 3.64 mm. The
  review had asked for the sleeve edges to SHOW; at 0.8 mm they cost tris and
  read as nothing. Residual: a faint rectangle is still discernible where the
  print patch's nap meets the garment's, at about a third of its old strength.

## THE X END: FOUR CUTS, THREE OF THEM WRONG THE SAME WAY

Worth writing down because the pattern is the point, not the geometry.

1. **An n-gon cap** over the whole section: a flat wall with a step per ply.
2. **Tuck stations past u = 1**, where the superellipse is undefined. Clamped,
   they collapsed the section flat — the tuck became the wall it replaced.
3. **Floored** instead of clamped: a blunt faceted block with a 6 mm spike.
4. **A nose scaling the whole section to a pole**: a 17 mm cone on each end,
   because the section spans the garment's DEPTH and its radius is nothing
   like a fold radius.

All three failures assume the garment converges to a point at its ends. It
does not. Fold a tee and look at the left edge: the plies are still there,
stacked, full depth. What closes is the cloth's own THICKNESS — the top and
bottom faces of each ply meet round a hem of about half a ply. So the sweep
now runs at full section to `U0 = 1 - hem`, and over the hem the offset from
the centreline shrinks on a circular arc to zero. The ribbon closes onto its
own centreline, which is what a hem is. The same radius takes the depth in at
the corner, so the plan view rounds instead of chamfering.

A side effect worth having: the garment is finally the width it says it is.
The pushed-out tuck made it 13% wider than its own size.

## THE FOUR CHECKS NOW GATE EVERY GARMENT

They existed and passed their control; they were not wired to anything. Aimed
at real garments they failed on the first run and found four faults per
garment that four rounds of looking had missed:

- **flat caps** — the neck rib, the placket, the sleeve ridge and both buttons
  all ended in an n-gon plate. `loft` can now close on a dome, `_sweep`,
  `fold_line` and `strip` do, and a shirt button is a domed disc with a rim
  instead of a 14-gon plug.
- **relief** — the tee's sleeve folds at 0.8 mm, i.e. invisible at player
  distance. Prints are exempt BY NAME and deliberately: a screen print has no
  relief, and demanding 2.2 mm of it would force back the card T1 removed.
- **buried** — the same sleeve folds at 33% exposed, just under the bar.
- **irregularity** — the polo's outline had three of nine stations inside
  0.6 mm.

Two of those four findings were the instrument's fault, not the garment's, and
both are fixed in the instrument:

- `silhouette` sampled with bands WIDER than the station pitch, so two
  neighbouring stations could return the same extreme vertex and report it as
  two measurements that agree exactly. That is the instrument talking to
  itself. Bands now abut.
- `assert_irregular`'s pairwise-distinctness test is a category error on
  samples of a smooth curve: near any crest the neighbours agree because the
  curve has a turning point there, and forcing them apart puts back the
  buckled outline of T6. Ply edges in a stack are separate things; nine
  samples along one outline are not. Curve callers pass `min_gap=0` and a
  `min_range` instead, scaled to 3% of the garment's own depth so it is not a
  number tuned on the polo and inherited by everything.

`assert_not_buried` also now REFUSES rather than printing a pass when it has
judged nothing, which is how a check certifies air.

## THREE BUGS THE COMPARISON ITSELF FOUND

Placing two garments side by side is an instrument, and it caught what a
single centred render never could:

1. **`edge_x` returns a magnitude, not a coordinate.** `max(abs(x))` is the
   half-width only when the garment sits at x = 0 — true of every render this
   has ever had. Off-centre, the size tag flew 400 mm clear.
2. **`edge_x` returned 0.0 when it found nothing.** Making it refuse revealed
   that on the v2 polo it finds no surface at the height it is asked about, so
   **v2's size tag has been placed off a silent zero in every render it has
   ever had.** Left in v2 deliberately: a baseline has to be what shipped.
3. **`top_at` had already drifted from the surface it claims it cannot drift
   from** — it domed on u alone at 0.80 with a height weighting the sweep does
   not have, while the surface domes on u AND y at 0.62/0.72 flat. Every trim
   that sits on the cloth was placed off that wrong number.
