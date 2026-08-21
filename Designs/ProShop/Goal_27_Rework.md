# GOAL 27 — THE REWORK

Your own hostile review returned 19 for 19 ITERATE. This is the rework, ordered
by how much I care.

**FIND REAL REFERENCE FOR EVERY ITEM ON THIS LIST.** Search the web for
photographs of the actual object before you model or draw anything, and put the
reference beside your result each round via `side_by_side.mjs`. Almost everything
below reads as a placeholder because it was designed from imagination. A golf
ball box, a polo shirt, a supermarket till and a banknote all have a very
specific look and none of them are being hit.

**TAKE YOUR TIME.** These read as quick work. I would rather have four things
that look real than sixteen that look drafted.

---

## 1 — THE APPAREL. Make actual garments, not boxes.

Right now the clothing is boxes. Model the real things, as real cloth:

- **POLO SHIRTS** — folded on a shelf AND on a hanger. Collar, placket with
  buttons, sleeves. The two states are genuinely different meshes and I need both.
- **T-SHIRTS** — folded and hung.
- **HOODIES** — the hood is the whole silhouette. Folded and hung.
- **TROUSERS / GOLF PANTS** — folded, with a visible waistband and creases.
- **CAPS** — crown, brim, adjuster at the back.

Folded cloth has soft edges, a visible fold line, and a slight sag — not six flat
faces. Hung garments drape from the shoulder and the hanger is part of the asset.

Colours and patterns are TEXTURES on shared meshes, not new models.

---

## 2 — THE GOLF BALLS AND THEIR PACKAGING

**RENAME EVERYTHING.** No real brand names, nothing that reads as a real brand,
no near-misses. Invent names that sound like golf-ball brands without being any
of them.

**MAKE THE NAMES FIT THE BOX.** Right now they do not sit properly on the
packaging. Lay the type out for the box it is actually printed on — a sleeve of
three and a dozen box are different shapes and need different layouts.

**FIND REAL REFERENCE.** Photograph-grade golf ball packaging: the sleeve, the
dozen box, the way the type and the ball graphic are arranged, the gloss, the
colour blocking. What is there now looks like a pencil sketch of a box.

Balls themselves need real dimples at the distance a player holds one.

---

## 3 — THE MONEY. Significantly better, and all different.

**THE NOTES ARE THE WORST OF IT.** Every one is the same green at the same size,
so a stack reads as photocopied.

- Every denomination gets a **genuinely different design** — different dominant
  colour, different portrait, different border pattern, different numeral
  placement. Look at how real currency differentiates denominations and do that,
  generically.
- **The art quality has to come up.** These look like pencil drawings. Real notes
  have fine guilloche line work, a portrait oval, a seal, a serial band, and
  crisp corner numerals. Find reference and get closer to it.
- **Coins too** — a readable device on the face, a proper rim, reeded edges where
  real coins have them.

**THE CARDS:** move the scheme icon UP so it stops overlapping the card number —
unless it is deliberately meant to overlap, in which case say so. And confirm no
mark resembles a real network.

---

## 4 — THE CASH REGISTER. Scrap it and start fresh.

I do not like the current design. Bin it.

**Look at how supermarket simulator games do their tills** — Supermarket
Simulator, Grocery Store Simulator, and their relatives. Find reference images.
That is the shape I want: a chunky modern POS unit, a real customer-facing
screen, a card terminal, a receipt printer, a scanner, a proper drawer.

**GIVE ME SEVERAL DESIGNS TO CHOOSE FROM.** Three or four distinct takes,
rendered side by side, and I will pick. Do not iterate one design to death before
I have seen the options.

Carry forward what was already right: notes in the top tray, coins beneath,
measured interior dimensions, and the drawer as a real compartment.

---

## 5 — THE WATER BOTTLE AND THE REST OF THE DRINKS

Take your time on these. A real sports bottle has a moulded grip profile, a
sports cap, a label that wraps with a visible seam, and a fill level. Cans have
a proper neck, a tab and a rim.

Reference first.

---

## 6 — THE DIVOT TOOL

Broken in your own review: the fork's prongs are flat cards with no thickness and
the pail's soil is a flat floating disc. Fix both. A divot tool is a small
two-pronged fork with a real handle — find a photograph.

---

## 7 — THE GREENS MOWER

Make it better. Your review found handlebars attached to nothing and a blank
frame where the reel should have been.

A real greens mower has a cutting cylinder with visible helical blades, a front
roller, a rear roller, a grass box, an engine block and a handlebar with
controls. Find reference. This one is worth doing properly — it is a big
silhouette that moves.

---

## WHAT APPLIES TO EVERYTHING

**REFERENCE FIRST, EVERY ROUND**, beside your render.

**THE ASSERTIONS ARE NOT WORKING.** Your review found parts passing through each
other in nine assets and loose parts in eleven — every one of which the existing
checks were supposed to catch. Before trusting any assertion again, run it
against a known-bad asset and confirm it fails.

**A BLANK RENDER IS A BUILD FAILURE.** Three of your evidence frames were blank
grey. A frame with no subject in it must never be citable.

**Review off the turntable at full size, frame by frame.** Never the contact
sheet.

**Materials are the hard budget** — the parallel session measured ~70 ms of cold
compile per program, so every new material family costs about a second off my
first load. Share one small library. Report new materials per asset.