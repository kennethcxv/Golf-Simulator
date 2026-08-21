# GOAL 27 — PRODUCTION READY

These are first drafts and they look it. This pass is about finishing them, not
about getting more of them.

**Take your time.** I would rather you spend the whole session on the apparel and
the register and have both be genuinely good than touch eight things and leave
them all at draft.

**Your own verdict on the apparel was ITERATE on all eight** — you were right.
This is that iteration, and it needs to go much further than one round.

---

## 1 — THE APPAREL. All of it, properly.

**THE CAP IS THE WORST OF THEM.** It reads as a lump and it has one colourway.

- Real cap construction: **six panels with visible seams**, a stitched button at
  the crown, eyelets, a curved brim with a contrasting underside and a stitch
  line following its edge, a sweatband, and a rear closure — snapback strap or a
  buckle.
- **Multiple colourways**, like every other garment. It should not be the one
  item with a single texture cell.
- Your own note says the panel seams and eyelets do not survive the render. That
  means the relief is too shallow — 2–3× deeper, or put them in the texture as
  well as the geometry.

**THE SLEEVES FIX THREE GARMENTS AT ONCE.** You identified it yourself: sleeves
are cylinders pushed into a shoulder, not sleeves growing out of one. Fix the
shoulder join so the polo, the tee and the hoodie all read as clothing.

**THE HOODIE.** Hung, the hood is a ring rather than an opening and the hanger
hook shows through it. Folded, it does not read as a hoodie at all — that was
your own weakest verdict. A folded hoodie shows the hood as a distinct mass on
top of the stack. Give it that.

**THE TROUSERS.** The waistband, belt loops and pocket are too shallow and vanish
in the render. Deepen the relief until they survive at the distance a player sees
them.

**THE FOLDED TEE.** A soft slab with a faint neck arc. It needs the neck rib as
real geometry, the sleeve edges visible at the sides of the fold, and enough of
a printed front showing to say what it is.

**AND ACROSS ALL OF THEM:**

- **More colourways and more variety.** These are shop stock — a rail of eight
  identical navy garments is not a shop.
- **Prints and logos** on the texture: a chest logo, a sleeve badge, a printed
  tee front. That is what makes fabric read as merchandise rather than cloth.
- **The knit needs to read at the distance I see it.** Ribbed collars and cuffs
  should show as ribbing, not as smooth trim.

---

## 2 — THE CASH REGISTER. It looks like a first draft made of boxes.

Low-poly and squared-off. Pick whichever of your four designs you think is
strongest, tell me which and why, and then **build it properly**:

- **Chamfers and fillets on every hard edge.** Nothing in a moulded plastic
  product has a knife edge. That single change is most of what separates a real
  object from a box.
- **Real part boundaries** — panel gaps, a parting seam, a screen bezel that
  stands proud, a raised keypad surround, a receipt slot with depth, a card
  terminal that reads as its own device.
- **Actual keys on the keypad**, not a flat panel. Individual keys, gaps between
  them, a couple of coloured function keys.
- **The drawer front as part of the shell**, not a slab stuck on it — your own
  review flagged that on all four.
- **The screen** now that emission is wired: give it something on it. A till
  interface, even simple, reads a hundred times better than a lit rectangle.

Take the triangle budget you need. This is the object I look at through every
transaction and it can afford more than 1,000 triangles.

---

## 3 — THE STRETCHED TYPE

Text on some of the packaging is stretched — the golf ball boxes on their side
faces are the clearest case.

The cause is almost certainly UVs assigned per face without regard for the face's
aspect ratio, so type laid out for a wide panel gets squeezed onto a narrow one.

**Fix it properly rather than nudging it:** lay out each face's artwork for that
face's real proportions, and check every face of every package — sleeve, dozen
box, and anything else carrying type. Render each one square-on and read the text
back. **If you cannot read it comfortably in the render, it is wrong.**

---

## HOW TO WORK THIS

**Reference beside every render, every round.** You already have the photographs
in `ref/`. Get more where you need them — a six-panel cap, a folded hoodie, a POS
terminal.

**Review off the turntable at full size, frame by frame.** Never the contact
sheet.

**Do not stop at the first version that passes the assertions.** Passing the
checks means it is built correctly. It does not mean it looks finished, and every
one of these passed its checks while looking like a draft.

**The bar is: would this be in a game I paid for?** If the honest answer is no,
it is not done.

Materials stay on the shared library — the parallel session measured ~70 ms of
cold compile per program, so new material families cost me load time. Colourways
and prints are atlas cells, not materials.

Show me the apparel when it is genuinely done, then the register.