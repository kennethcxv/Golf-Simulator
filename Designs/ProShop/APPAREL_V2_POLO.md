# APPAREL V2 — THE POLO — **NOT DONE**

Round one of an item the cap needed seven rounds for. It builds, it passes, and
it is a first draft. Marked NOT DONE under the 45-minute rule rather than left
to look finished.

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

**7,908 tris, 19 parts, 2 materials, 171 pairs clean, 829 × 140 × 787 mm.**

## REFERENCE PULLED THIS ROUND

`polo-pattern.png` (the panel set), `polo-rail-shop.jpg` (a dozen folded stacks
— the most useful frame in the set), `polo-pique.jpg` (collar and placket at
macro), `polo-stack-shop.jpg`, `polo-lacoste.jpg`, `polo-merch-front.jpg`.

## WHAT THE FIRST FRAMES SAY — the list the next round works

Off `front` and `threequarter` at full frame:

1. **The collar barely exists.** It reads as a thin ring under the hanger, with
   no stand, no fall and no points. `CL.collar`'s `height` turned out to be a
   base offset rather than a height — it built an 87 mm toque before it was
   measured — and the corrected value has gone too far the other way.
2. **The sleeves are horizontal cylinders.** They need to fall further, and
   their section should be a lens: an empty sleeve is flat, not round.
3. **The hem is a hard scalloped zigzag**, visible right across the bottom.
4. **The body is too long and too straight** — it reads as a tabard. The waist
   and the hem flare are both too subtle at this length.
5. **The side seams do not read** at any distance.
6. **The placket is a raised bar** and its two buttons vanish against it.
7. **The garment does not drape over the hanger** — the shoulders are flat where
   they should peak on the hanger's ends.

## FIXED THIS ROUND, EACH FOUND BY MEASURING

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

The folded polo is written but unrendered. The tee, the hoodie and the trousers
are not started.
