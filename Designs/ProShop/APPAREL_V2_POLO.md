# APPAREL V2 — THE POLO — **NOT DONE**

Five rounds in. The HUNG state now reads as a polo from the front and does not
from the side; the FOLDED state builds and reads as a moulded lid. Both are
marked NOT DONE rather than left to look finished. The cap took seven rounds
and this is not that yet.

Build: `blender --factory-startup -b --python tools/blender/hero/build_polo.py -- only=hung views=8`
Frames: `qa/hero/apparel_v2/polo/hung/`

## WHAT IS THERE

Panel-built, like the cap and for the same reason: v1's hung polo was one
closed lens-section tube, and a tube has no side seam, no shoulder seam and no
armhole — the three lines that say "shirt".

- **A front panel and a back panel**, each a solidified surface, meeting exactly
  at the side seams because y is zero at u = ±1 by construction.
- **Side seams and shoulder seams** as ridges on those joins.
- **Sleeves** growing off the shoulder points with **ribbed cuffs**.
- **A collar** round a level neckline, **a placket** with a stitched box at its
  foot and two buttons, a **turned hem** all the way round, a **shaped chest
  badge** conformed to the front panel, and a **hanger**.

**Hung: 9,980 tris, 22 parts, 2 materials, 231 pairs clean, 801 × 199 × 707 mm.**
**Folded: 6,510 tris, 8 parts, 310 × 247 × 59 mm.**
Blank gate clean over 98 frames.

## REFERENCE PULLED THIS ROUND

`polo-pattern.png` (the panel set), `polo-rail-shop.jpg` (a dozen folded stacks
— the most useful frame in the set), `polo-pique.jpg` (collar and placket at
macro), `polo-stack-shop.jpg`, `polo-lacoste.jpg`, `polo-merch-front.jpg`.

## WHERE IT STANDS, OFF THE FRAMES

**Hung, front** — reads as a polo. Level hem, a collar with a stand, a fold
crest and two points, a placket with two buttons that are visible, a chest
badge that reads, flat sleeves with ribbed cuffs, a waisted body.

**Hung, side** — does not. The body is a flat blade: 199 mm deep across an
801 mm span, so side-on it is a knife edge with a sleeve in front of it. The
sleeve's open end is a flat disc. This is the next round's whole job.

**Folded** — reads as a moulded plastic lid, which is v1's `folded()` fault
arriving unchanged. The collar is one curved sausage instead of a splayed V,
the placket sits flat on the top face instead of running out of the collar, the
size band loops over a corner like a bag handle, and the leaves read as three
concentric mouldings rather than soft cloth lips. It needs the same treatment
the cap's crown got: build the leaves as PANELS, not as one lofted block.

## FIXED ACROSS ROUNDS 2-5

- **Proportion**: 690 mm long read as a tabard; 635 mm with more hem flare and a
  real waist reads as a shirt.
- **The shoulders now peak over the hanger's ends** instead of falling straight
  to the points.
- **The hem's scalloped wave** was fixed twice as if it were a hem shape before
  being traced to its cause: the top edge's profile — neck scoop, shoulder drop
  and hanger peak — was being carried the entire length of the panel to the
  bottom edge. Cloth hanging free forgets the line it was cut on within a hand's
  width, so the top edge now settles out by v = 0.32 and the hem is level.
- **The hem band twisted** at the two side turns because the supplied normal was
  nearly parallel to the path tangent there and `framed_sweep`'s frame
  collapsed. The normal is taken from the geometry now.
- **A real collar**, because `CL.collar` cannot make one: a polo collar is a
  stand, a fold crest and a fall to a free edge with two points, and the crest
  is the line the eye reads. It is a surface over the neckline measured off the
  panels, with a topstitch round its free edge.
- **Armhole seams**, so the sleeves are sewn on rather than emerging.
- **The buttons were buried** 1 mm inside the placket's own front face.
- **The sleeves were round**; an empty sleeve is flat, and `sleeve_from_body`
  takes a section ratio now.

## FIXED IN ROUND ONE, EACH FOUND BY MEASURING

- **The collar floated 28.9 mm off the neck** because the panels bowed to full
  depth at the shoulder line, making the neck hole 116 mm front-to-back. A shirt
  on a hanger is nearly flat across the shoulders and only opens where the
  collar holds it, so the separation is now a function of u as well as v.
- **The neckline was cut 64 mm deeper at the front than the back**, so there was
  nothing level for a collar to sit on. A polo's neckline is level; the opening
  is the placket slit below it.
- **A size ticket on the side seam reported an unchanging 2.35 mm** across three
  different positions — the same signature as the drawer-face fault already on
  record in `assert_boxes_overlap`. It was removed rather than debugged: the
  reference puts printed size bands on FOLDED stock, not on hung garments.
- **The cuffs came out blue** on a green polo, because `RIB_CELL` is a
  fixed blue-grey ribbing swatch. The rib is geometry here, so the cuffs take
  the garment's own trim colour.
- **The chest badge printed rotated 180 degrees.** Flipping u did not fix it and
  neither did the solidify offset; the cause was that a garment's own v runs
  DOWN the body while a texture's v runs UP. `CL.grid_uv` has a `flip_v` now,
  and the two conventions are named where they meet.

## NOT STARTED

The tee, the hoodie and the trousers.
