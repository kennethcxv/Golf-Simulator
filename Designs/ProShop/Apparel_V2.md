# APPAREL V2

Start over on the apparel. Not another tuning round on v1 — a second version,
built from the reference, from scratch.

**Nothing else this session.** No register, no packaging, no tools. Just the
clothes, until they are right.

**They all read as blocks.** Soft-edged blocks, but blocks. The cap is the worst
by a distance — it does not read as a cap at all, and it is the item a player
sees hanging at eye level on a wall rail.

---

## THE PROBLEM, NAMED

v1 was built as **primitives with cloth-ish surface treatment applied on top** — a
rounded box for a folded shirt, a lofted tube for a cap crown. That is why every
garment reads as a block: the underlying form is a block, and softening its edges
does not change what it is.

**A garment's shape comes from its PANELS.** A polo is a front, a back, two
sleeves, a collar and a placket, joined at seams. A cap is six triangular panels
meeting at a button, with a brim stitched to the band. Build the panels and the
shape follows. Round off a box and it stays a box.

That is the change v2 has to make. If you find yourself starting from a cube or a
cylinder and smoothing it, stop.

---

## REFERENCE. Get much more of it than last time.

You pulled seven photographs for v1. Get **three or four per garment**, and get
the ones that show construction:

- A folded polo photographed **from a low angle**, so the fold layers read.
- A cap **from the front, the side, and three-quarter** — the crown curve is
  different in every one.
- A folded hoodie showing **where the hood sits** on the stack.
- Hung garments showing **how the shoulder meets the hanger** and how the fabric
  falls from it.
- Close shots of **ribbing, seams and stitch lines** so the relief depth is
  informed rather than guessed.

Put them beside every render, every round. When a render does not match, say
which photograph it fails against.

---

## THE CAP — do this one first, and do it properly

It is the worst item and the most structured, so getting it right sets the bar.

- **Six panels**, each a curved triangle from brim to crown, with a **visible
  seam** between every pair.
- **A button at the crown** where the six meet.
- **Eyelets** — two per panel on the real thing.
- **A curved brim** with a contrasting underside, a stitch line following its
  edge, and a real curve across its width as well as along its length.
- **A sweatband** visible at the front inside edge.
- **A closure at the back** — a snapback strap with holes, or a buckle.
- **Multiple colourways**, and a front panel that can carry a logo.

A cap has more structure than any other garment on the list. If it reads as a
dome, it is wrong.

---

## THEN THE REST

**POLO, folded and hung.** Collar with a real splayed V, placket with buttons,
sleeves that **grow from the shoulder** rather than being pushed into it. The
sleeve join was your own diagnosis and it fixes three garments at once.

**T-SHIRT, folded and hung.** The neck rib as real geometry, sleeve edges visible
at the sides of the fold, a printed front.

**HOODIE, folded and hung.** Hung: a hood with a real **opening**, not a ring,
and the hanger hook must not show through it. Folded: the hood reads as a
distinct mass on top of the stack — your own verdict was that it does not read as
a hoodie at all.

**TROUSERS, folded.** Waistband, belt loops and pocket deep enough to survive the
render. Yours vanish.

---

## WHAT MAKES THEM LOOK REAL RATHER THAN MODELLED

**Deeper relief on everything.** Seams, ribbing and stitch lines all disappeared
in v1. Two to three times deeper, or in the texture as well as the geometry.

**More colourways, and prints.** A rail of identical navy garments is not a shop.
Chest logos, sleeve badges, printed tee fronts — all atlas cells, not materials.

**Asymmetry.** Real folded cloth is never perfectly square. A slight lean, an
uneven top layer, one sleeve edge showing more than the other.

**Ribbing that reads as ribbing** at the distance a player stands.

---

## HOW TO WORK IT

**Take your time. The cap alone is worth several rounds.**

**Review off the turntable at full size, frame by frame**, beside the reference.
Never the contact sheet.

**Passing the assertions is not done.** Every v1 garment passed every check and
still looks like a first draft. The checks prove it is built correctly, not that
it is finished.

**The bar: would this be on a shelf in a game I paid for?** If the honest answer
is no, keep going.

Materials stay on the shared library — colourways and prints are atlas cells. The
parallel session measured ~70 ms of cold compile per program, so a new material
family costs real load time.

Show me the cap on its own when you think it is right, before you do the rest.