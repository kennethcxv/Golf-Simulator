# APPAREL V3 — THE TEN-GARMENT TABLE

The brief's bar: **v3 renders beside v2 at the same scale and light, and if it
does not clearly beat v2 it is not done.** Every garment gets its own fault
list, named by the frame it was found in, before anything is changed.

All frames are `qa/hero/v3/compare/<garment>-{hero,front,low,top}.png`, and in
every one of them **v2 is on the LEFT and v3 on the RIGHT**.

## THE TABLE

| # | garment | compared to v2 | rounds | verdict |
|---|---|---|---|---|
| 1 | polo folded | yes | 7 | **PASSES** — F4 residual |
| 2 | tee folded | yes | 6 | **PASSES** — T2, T7 residual |
| 3 | hoodie folded | yes | 3 | **PASSES** — H3, H9 residual |
| 4 | trousers folded | yes | 3 | **PASSES** — P1 residual |
| 5 | polo hung | yes | 9 | **PASSES** — PH8 residual |
| 6 | tee hung | yes | 2 | **PASSES** — TH2, TH3, TH4, TH5 residual |
| 7 | hoodie hung | yes | 4 | **PASSES** — HH2, HH3, HH4 residual |
| 8 | cap | yes | 4 | **PASSES** — C2, C3 residual |
| 9 | trousers hung | **impossible** | 0 | **NOT DONE** — has never been built, in any version |
| 10 | cap, second state | **impossible** | 0 | **NOT DONE** — the cap has one state |

**Eight of ten are reviewed and pass. Two cannot be compared at all, because
there is no v2 of them to compare against.** "Polo, tee, hoodie, trousers,
cap, folded and hung" is ten and the tree contains eight; the missing two were
never built by anyone. Building them is real work and it is not a comparison —
saying so is more use than a frame with one garment in it.

---

## GARMENT 1 — POLO FOLDED

- **F1 — the cut end is a staircase.** RESOLVED. Two 164-sided n-gon caps
  standing as a flat wall with a step per ply. See THE X END below.
- **F2 — three rolls against v2's four.** RESOLVED at `plies=8, gap=0.0021`.
  `polo-folded-low.png`: four rolls with dark slots against v2's four soft
  lips with none.
- **F3 — the slots are shallower and lighter than v2's.** RESOLVED, same frame.
- **F4 — v3's base is a dead-straight horizontal line.** OPEN, minor.
- **F5 — the size tag floats clear of the shirt** (`polo-folded-top.png`).
  RESOLVED. It measured a 4.21 mm OVERLAP, so the numbers said attached:
  mid-height on an eight-ply stack falls in the GAP between plies, and out at
  the edge the hem has closed to a knife edge, so the overlap was with a
  sliver of nothing. It hangs from under the top ply now.

## GARMENT 2 — TEE FOLDED

- **T1 — the print is a hard-edged white card.** RESOLVED; the brief's own
  item. Two halves: a `#e8e8e4` cell field on a `#e6decc` shirt, and a flat
  quad hovering over a domed surface catching a rim of shadow. The cell is
  composited over a knit tile with the SAME base and seed as the shirt's own,
  at 2.6x so the nap matches in world terms, and the patch follows `top_at`.
  `tee-folded-top.png`: v2 has a crisp rectangular border, v3 has ink.
- **T2 — the neck rib reads as a pale worm.** OPEN. Present in both.
- **T3 — v3's outline is a chamfered octagon.** RESOLVED — the hem radius
  takes the depth in at the corner as well as closing the thickness.
- **T4 — the x end is a fin / a faceted block / a spike.** RESOLVED; see below.
- **T5 — v3's top face carries the knit nap, v2's is smooth.** v3 wins.
- **T6 — the outline buckles into waves and cuts a corner off.** RESOLVED.
  `wander=1.7` came over from the polo's eighth round unexamined. A tee is
  folded neatly; what it has instead of wander is thinner cloth and more of it.
- **T7 — the sleeve folds stood 0.8 mm proud.** RESOLVED to 3.64 mm. Residual:
  a faint rectangle is still discernible around the print, about a third of
  its old strength.

## GARMENT 3 — HOODIE FOLDED

On the first frame **v2 beat v3 outright.** Fault list off
`hoodie-folded-hero.png`:

- **H1 — two soft plies against v2's four; it reads as a pillow.** RESOLVED,
  and the first fix made it worse. "A hoodie is thick cloth: fewer, fatter
  plies" was right about the cloth and wrong about the result; widening the
  gap to 3 mm was wrong again, because what makes a slot dark is a NARROW deep
  valley and a wide gap just fattens the U-turn until neighbouring rolls
  merge. Six plies at 1.8 mm.
- **H2 — the hood is a bolster with a hard straight bottom edge.** RESOLVED.
  It was placed at a nominal height over a cloth that domes several
  millimetres under it; it sits on the measured surface now and lies flat, as
  `ref/apparel/hoodie-shop.jpg` has it.
- **H3 — the drawcords are thin wires with blob tips.** OPEN.
- **H4 — the silhouette bulges like a duvet.** RESOLVED with the ply change.
- **H5 — no kangaroo pocket at all**, in either version, and it is the one
  thing on a hoodie nothing else in the shop has. BUILT.
- **H6 — the hood is 56 n-gons of 5/6/7/24 sides.** RESOLVED by triangulating
  the boolean's cut rim, not by loosening the rule.
- **H8 — the pocket is a slab with a hard wall.** RESOLVED: a kangaroo pocket
  is stitched at the sides and bottom and open only at the top, and the
  geometry says which is which now.
- **H9 — the hood flattened into a square-cornered card.** PARTLY RESOLVED
  (longer taper at each end); still reads flat at the low angle.
- **H10 — the pocket mouth is a suitcase handle.** RESOLVED — 8.5 mm of bar
  became a hemmed welt.

`plies=6` gives THREE fold rolls, not five, and that is correct: a concertina
puts two plies in every roll. v2's four lips are four free edges on the same
side of the garment, which is not a thing a folded shirt has.

## GARMENT 4 — TROUSERS FOLDED

- **P1 — the top face is a smooth moulded lid.** OPEN in both.
- **P2 — the pockets read as punched slots / raised bars.** RESOLVED — two
  welt lips and the shadow between them.
- **P3 — the waistband is a diagonal rolling pin.** RESOLVED. A waistband is
  a doubled STRIP as wide as your hand running the full depth at the end of
  the fold, and what you see of it is the seam line where it joins the leg.
- **P4 — nothing says trousers: no pressed crease, no belt loops.** RESOLVED.
  Three loops ACROSS the band at uneven spacing, and a pressed crease running
  the length of the leg — the single thing that separates folded trousers
  from a folded towel.
- **P5 — pocket 31% exposed, welt 34%** (the gate's own finding). RESOLVED,
  and raising the welt made it WORSE, 34% to 24%, which is how the flap was
  caught: it spanned py+0.009 to py+0.030 and the upper welt py+0.008 to
  py+0.018, so the flap swallowed the welt whole. A welt pocket is two lips
  and a shadow; a flap goes over a slot, not on top of one of its lips.
- **P6 — three belt loops evenly spaced read as a radiator grille.** RESOLVED.

## GARMENT 5 — POLO HUNG

v2 and v3 were **byte-identical** here, and it was the worst asset of the ten.

- **PH1 — the hem is a hard zigzag, like torn paper.** RESOLVED in `draped()`,
  so the tee and hoodie hung states get it too: a shirttail that rises at the
  side seams and waves, sampled at 33 points round the section instead of 25.
- **PH2 — the sleeves stick out horizontally as sausages.** RESOLVED — but the
  first cut hung them at 0.335 and put the cuffs INSIDE the shirt body, which
  assembly cannot see because sleeve-and-body are allow-listed to overlap.
- **PH3 — the shoulder seams are dark roll bars.** RESOLVED by deleting them.
  No placement could have saved them: the armhole is inside the body's own
  silhouette, so a ring there measures 17-20% exposed wherever it is put. An
  armhole seam is stitching, not a moulding.
- **PH4 — no drape; the body is a flat slab.** RESOLVED — folds at three
  scales instead of one sine.
- **PH5 — no collar.** It was there and buried; visible now the drape and the
  hanger are right.
- **PH6 — the chest logo is a flat green card on a navy shirt.** RESOLVED —
  ink on the shirt's own knit, one cell per colourway.
- **PH7 — ten parts with n-gon caps.** RESOLVED.
- **PH8 — the hem reads as two points with a notch between them.** OPEN.

Also found here: the placket measured 1.33 mm proud because `+ R` is INTO the
shirt (front is -y), and both cuffs measured 0% exposed — rings of a single
radius on a lens-section sleeve, flush on the wide axis and floating in mid
air on the narrow one. Sleeves emit their own bands now, off the same
expression that built them, so a band hugs its sleeve by construction.

## GARMENT 6 — TEE HUNG

**Three of the four cloth checks were certifying air on this garment.** The
block was keyed on a part called `cloth` or `body`; a panel-built garment has
neither, so it printed "flat-cap assertion passed" and nothing else.

- **TH1 — the print is a cream card on a white tee, with a cut corner.**
  RESOLVED. One print cell cannot serve two shirt colours once the print is
  ink; and a flat quad on a panel that curves round the chest lifts at the
  corners. `surface_decal` conforms a print to a parametric panel.
  `tee-hung-front.png` is the clearest frame in the set: v2's mark is a small
  crop on a hard-edged card, v3's is the whole wordmark lying on the cloth.
- **TH2 — the body is a stiff bell with visible wall thickness at the hem.** OPEN.
- **TH3 — the cuffs read as pipe collars.** OPEN.
- **TH4 — no visible neck rib.** OPEN.
- **TH5 — a dead-straight moulded seam line down the side.** OPEN.

The comparison also found that **v2's chest print is cropped**, showing only
the top of the mark. Left as it is; the baseline is what shipped.

## GARMENT 7 — HOODIE HUNG

- **HH1 — the hood is a flat oval disc standing up like a car headrest.**
  RESOLVED. Two flat plates were doing all of it: one across the back of the
  shell, one across the rim opening. A hood is a bag with a hole in it and the
  hole is the part that reads; it runs from deep inside the lining, out
  through the rim, over the crown and back to a point now, and it slumps.
- **HH2 — the body is a stiff bell with no folds.** OPEN.
- **HH3 — the shoulders read as football pads.** OPEN.
- **HH4 — the pocket is a single floating lozenge.** OPEN.
- **HH5 — no ribbed waist.** RESOLVED. It was a horizontal flange 27 mm wide
  and 7.6 mm thick — the cut edge of a moulded shell with a lip on it.
- **HH6 — the hood shell and pocket end in flat plates.** RESOLVED.

## GARMENT 8 — THE CAP

- **C1 — the monogram is a hard-edged dark card cutting across a panel seam.**
  RESOLVED, and it is the last of the four sticker faults. Ink on the cap's
  own burgundy knit, conformed to the crown through its parametric function.
  `cap-front.png`: v2 is a flat card standing off the crown with a corner tab.
- **C2 — the crown reads as a smooth riding helmet, not six panels.** OPEN.
- **C3 — the brim is a wide flat shovel.** OPEN.
- **C4 — crown, button and all six eyelets end in flat plates.** RESOLVED.
  Eyelets were 8-sided cylinders with a plate at each end, reading as rivets;
  they are rings of thread now.

---

## THE X END: FOUR CUTS, THREE OF THEM WRONG THE SAME WAY

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
bottom faces of each ply meet round a hem of about half a ply. The ribbon now
closes onto its own centreline, which is what a hem is, and the same radius
rounds the corner in plan. Side effect worth having: the garment is finally
the width it says it is. The pushed-out tuck made it 13% wider.

## WHAT THE FOUR CHECKS FOUND ONCE THEY WERE POINTED AT REAL GARMENTS

They existed, passed their control, and gated nothing. Wired in, they failed
on the first run of every garment and found faults that four rounds of looking
had missed — the cuff that was never drawn, the sweatband entirely inside the
crown, the placket sunk into the chest, the flap that swallowed a welt, twelve
separate parts ending in flat plates.

**Three findings were the instrument's fault, not the garment's, and all three
are fixed in the instrument:**

- `silhouette` sampled with bands WIDER than the station pitch, so two
  neighbouring stations could return the same extreme vertex and report it as
  two measurements that agree exactly — 142.5 / 142.5 on the polo. That is
  the instrument talking to itself.
- `assert_irregular`'s pairwise-distinctness test is a category error on
  samples of a smooth curve: near any crest the neighbours agree because the
  curve has a turning point there, and forcing them apart puts back the
  buckled outline of T6. Curve callers pass `min_gap=0` and a `min_range`
  scaled to 3% of the garment's own depth.
- the relief/burial block skipped every panel-built garment silently, because
  it was keyed on two part names. The host is found by area now, and it is
  every big panel rather than the biggest one — measuring the host against
  itself printed -0.00 mm.

**Two exemptions from relief, both named and both printed so they cannot
hide:** marks are ink (demanding 2.2 mm of a print forces back the card), and
linings are inside the garment on purpose (a sweatband measuring -3.89 mm
proud is the correct answer). Both are still judged for burial — and that is
what caught the sweatband at 0%.

`assert_not_buried` also refuses rather than printing a pass when it has
judged nothing, which is how a check certifies air.

## THREE BUGS THE COMPARISON ITSELF FOUND IN V2

Placing two garments side by side is an instrument. All three are described
and **left in v2 deliberately** — a baseline has to be what shipped.

1. **`edge_x` returns a magnitude, not a coordinate.** `max(abs(x))` is the
   half-width only when the garment sits at x = 0, true of every render it has
   ever had. Off-centre the size tag flew 400 mm clear.
2. **`edge_x` returned 0.0 when it found nothing**, so v2's size tag has been
   placed off a silent zero in every render it has ever had. `top_z` does the
   same on the hoodie and refuses at 268 mm, which meant v2 could not be built
   off-origin at all — the comparison builds both sides at zero and moves them.
3. **v2's hung-tee chest print is cropped**, showing only the top of the mark.

And one in v3's own library: **`top_at` had already drifted from the surface
it claims it cannot drift from** — it domed on u alone at 0.80 with a height
weighting the sweep does not have, while the surface domes on u AND y at
0.62/0.72 flat. Every trim that sits on the cloth was placed off that number.

## STILL OUTSTANDING FROM THE BRIEF

- **Garments 9 and 10 do not exist** and cannot be compared. Building them is
  the next piece of work on this line.
- Multiple colourways per garment: the atlas now carries 35 cells and four of
  them are per-colourway marks, but no garment is built twice.
- Topstitching and sleeve badges beyond the polo's.
- `build_apparel`'s polo collar is still the old part — deliberately, it is
  the baseline.
