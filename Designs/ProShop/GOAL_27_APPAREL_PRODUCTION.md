# GOAL 27 — THE APPAREL, PRODUCTION PASS

The iteration on my own ITERATE verdict. Every fault I named last time is
addressed below, with what changed and what it measures.

Build: `blender --factory-startup -b --python tools/blender/hero/build_apparel.py -- cycles`
Atlas: `node tools/blender/hero/make_apparel_art.mjs`
Set:   `qa/hero/apparel/all-eight.png`, plus a turntable per garment.

---

## THE CAP — rebuilt, not adjusted

It was "a lump with one colourway". It is now built the way a cap is made, from
`ref/apparel/cap-detail.jpg` and `cap-variety.jpg`:

| the reference has | now |
|---|---|
| six panels with stitched seams | six gores with a **seam piping tube** along each join, from the button to the rim |
| a covered button at the crown | a fabric button in the **contrast** colour with its own stitch ring |
| eyelets | six, one per panel, seated in the crown |
| a contrasting brim with a darker underside | the brim takes the **contrast atlas cell**; crown and brim now differ |
| three stitch rows following the brim edge | three, each the **perimeter of a shrunken brim** walked through the same surface function |
| a sweatband | a band inside the rim |
| a rear closure | two straps and a buckle |
| a front mark | a **PH monogram decal** on the front panels |

Two things went wrong on the way and both are worth recording:

- **The brim came out as four floating hoops.** I had lofted a small circular
  section *along the brim's outline* — that is a tube, not a brim. A brim is a
  surface, so it is now a grid surface with thickness.
- **The stitch rows came out as chevrons diving 30 mm into the crown.** They
  were walked in u/v by hand, and the outline collapses to a point at its ends,
  which sits at the brim root under the crown.

## THE SLEEVES — one fix, three garments

`sleeve_from_body()` replaces `sleeve()`. The root ring starts *inside* the body
so there is no gap to see, the section is a **lens** rather than a circle
because an empty sleeve is flat, and each one gets an **armhole seam ring** at
the join — which is the part that actually reads as "attached" — and a **ribbed
cuff**. Polo, tee and hoodie all use it.

## THE HOODIE

**Hung:** the hood was a ring with the hanger's hook showing through it. It is
now a **rolled rim around an opening with a shell behind it**, the shell at full
rim width so it closes the hole. The kangaroo pocket gained a **lip** at its top
edge, which is what casts the shadow line the reference shows.

**Folded:** was my own weakest verdict — "does not read as a hoodie at all". The
hood is now a **wedge lying across the stack with its opening edge facing
forward**, at 1.6x the mass and 1.5x the rise of the roll it replaced.

## THE TROUSERS

Waistband, loops and pocket all vanished under lighting. The waistband is now
1.7x the radius and stands proud rather than half-sunk; the loops are 2.7x the
volume; and the pocket is a **welt** — two lips with a slot between them —
instead of a raised slab, because the slot is what casts the shadow.

## THE FOLDED TEE

Was "a soft slab with a faint neck arc". It now has a **ribbed neck** as real
geometry, **sleeve fold edges** down both sides of the fold, and a **printed
front**.

## COLOURWAYS AND PRINTS

The atlas went from 12 cells to **24**: twelve colourways, six contrast partners
for trim, and six print cells — chest roundel, tee front, sleeve badge, cap
monogram, ribbing, trim. **Eight garments, eight different colourways**: "a rail
of eight identical navy garments is not a shop."

Prints are **decals** — thin geometry with explicit UVs — not atlas cells on the
garment body, because a smart-projected island packs and rotates the artwork.
Getting that right took three tries and every one is worth recording, because
the third is the same fault the brief lists as item 3:

1. smart-projected: the chest logos came out as **tall thin slivers** and the
   tee front read "HILLS" squeezed into a narrow box — **stretched type**
2. explicit corner UVs: came out **rotated 90 degrees**, because `mesh_from`
   recalculates normals and reorders the loops
3. UVs derived from **vertex position**: upright, correct aspect — but
   **mirrored**, because `side = n.cross(up)` points to the viewer's left

It reads correctly on the fourth. The fix is the same one the basket badge
needed: derive UVs from position, then read the render rather than the maths.

---

## COST

| asset | triangles | parts |
|---|---|---|
| cap | 6,956 | 24 |
| polo-folded | 5,934 | 8 |
| trousers-folded | 5,426 | 8 |
| hoodie-folded | 5,486 | 4 |
| tee-folded | 5,244 | 6 |
| hoodie-hung | 5,098 | 15 |
| polo-hung | 4,072 | 15 |
| tee-hung | 2,822 | 9 |

**MATERIALS: still 2** for the whole family — one cloth, one trim, both reading
the same 24-cell atlas. Twelve colourways, six contrast trims and six prints
cost zero extra programs.

## WHAT I STILL WOULD NOT CALL PERFECT

- **hoodie-folded** is the weakest of the eight. It reads as a hoodie on a shelf
  beside a hung one; in isolation it is marginal.
- The **folded items** are convincing as folded cloth but generic — a shopper
  tells them apart by the collar, the hood and the print, not by the fold.
- The **cap's crown** could take one more round of rake so it sits lower at the
  back than the front, which the reference does more strongly than this.
