# APPAREL V3 — THE TEN-GARMENT TABLE

The brief's bar: **v3 renders beside v2 at the same scale and light, and if it
does not clearly beat v2 it is not done.** One of ten is reviewed against that
bar so far, and it does not pass it.

## THE TABLE

| # | garment | v3 exists | compared to v2 | rounds | verdict |
|---|---|---|---|---|---|
| 1 | polo folded | yes | **yes** | 3 (v3 line) | **NOT DONE** — F1-F4 below |
| 2 | polo hung | v2 only | no | 0 | not started |
| 3 | tee folded | yes, ported | no | 0 | ported, never reviewed as its own asset |
| 4 | tee hung | v2 only | no | 0 | not started |
| 5 | hoodie folded | yes, ported | no | 0 | ported, never reviewed as its own asset |
| 6 | hoodie hung | v2 only | no | 0 | not started |
| 7 | trousers folded | yes, ported | no | 0 | ported, never reviewed as its own asset |
| 8 | trousers hung | **does not exist** | no | 0 | has never been built, in any version |
| 9 | cap | v2 only | no | 0 | not started |
| 10 | cap second state | **does not exist** | no | 0 | the cap has one state |

Two of the ten have never been built at all. That is worth saying plainly
rather than leaving it to be discovered: "polo, tee, hoodie, trousers, cap,
folded and hung" is ten, and the tree contains eight.

## GARMENT 1 — POLO FOLDED. NOT DONE.

Frames: `qa/hero/v3/compare/polo-folded-{low,front,hero,top}.png`, v2 LEFT,
v3 RIGHT.

Fault list off `polo-folded-low.png`, the low angle the brief asks for:

- **F1 — the cut end is a staircase.** IMPROVED, NOT RESOLVED. It was two
  164-sided n-gon caps, one per x end, standing as a flat vertical wall with a
  step per ply. Now tucked to a pole over three stations; still visibly
  stepped.
- **F2 — three rolls against v2's four**, and each one thicker. Untouched.
- **F3 — the slots between rolls are shallower and lighter than v2's.**
  Untouched.
- **F4 — v3's base is a dead-straight horizontal line.** Untouched.

**v2's ply edges still read softer and more like cloth than v3's.** v3 has more
structure — real alternating folds, a wandering raw edge — and reads more
rigid. The concertina is the right construction and it is not yet paying for
itself at this angle.

## WHAT THE V3 SETUP BOUGHT, WHICH IS REAL

- `tools/blender/hero/v3/` with its own library, garments, atlas and renders.
  v2 is restored **byte-for-byte to aba0da9** and keeps its own bugs, because a
  baseline has to be what actually shipped.
- Two atlases, so the material is compared honestly instead of both sides
  sharing whichever generator ran last.
- **Four checks that ask whether it reads as cloth**, each watched failing on
  the real fault: relief depth, silhouette irregularity, no flat caps, not
  buried. One of them failed its own control as a false positive first and was
  changed from vertex-counting to area-weighting because of it.

## THREE BUGS THE COMPARISON FOUND IN ITS FIRST FRAME

Placing two garments side by side is itself an instrument, and it caught what
a single centred render never could:

1. **`edge_x` returns a magnitude, not a coordinate.** `max(abs(x))` is the
   half-width only when the garment sits at x = 0 — true of every render this
   has ever had. Off-centre, the size tag flew 400 mm clear of the shirt.
2. **`edge_x` returned 0.0 when it found nothing.** Making it refuse revealed
   that on the v2 polo it finds no surface at the height it is asked about, so
   **v2's size tag has been placed off a silent zero in every render it has
   ever had**, sitting mid-garment instead of at the edge.
3. **The tuck that fixes F1 did nothing on its first cut**, because tuck
   stations sit past u = ±1 where the footprint factor goes negative and
   clamps to zero, collapsing the section flat.

Only fix 3 is in v3 alone; 1 and 2 are described but left in v2 deliberately.
