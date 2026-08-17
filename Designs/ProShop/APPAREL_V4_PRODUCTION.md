# APPAREL v4 — the production-art rebuild

Governed by `APPAREL_PRODUCTION_ART_BRIEF.md`. That brief overrides the v2/v3
quality bar: **real retail merchandise is the source of truth, not v3, not an
assertion, and not "it beats v2".**

v3 stays on disk untouched as the CURRENT column of every comparison.

**Contact sheet: `qa/hero/v4/CONTACT-v4.png`** (all ten) beside
`qa/hero/v4/CONTACT-v3.png` (the same ten in v3).

---

## Why v3 failed, in one sentence

**Every v3 garment was a surface of revolution with primitives bolted on**, and
that single choice produced the entire fault board. A lofted tube's rings are
level, so it cannot have a shoulder. Its rings are convex, so it cannot have a
fold. Its rings are closed curves of one radius, so it cannot have a hem that
wanders — and the only way to widen one is to grow the radius, which is why the
hoodie flared into a bell with its widest point at the hem. Everything else had
to be a separate primitive stuck to the outside: a cylinder for a sleeve, a bar
for a pocket, a disc for a hood, two slabs for shoulders, a cable for a seam.

A pair of trousers made it plainest. That surface has THREE boundaries — one
waist, two hems — and nothing swept down a path has three boundaries, so v3
gave up and used two tubes.

---

## Method

`tools/blender/hero/v4/` — `drape.py` (simulation, fold fields, projection,
cleanup), `shirt.py` (the hanging-top machinery), `folded.py` (the concertina),
`stage.py` (lighting and retail staging), `compare.mjs` and `contact.mjs`, and
one module per garment.

**A hybrid, arrived at the hard way.** The hanging bodies are genuinely
simulated: a panelled shell with real armholes cut into the yoke, hung from the
strip a hanger actually touches, dropped under gravity with self-collision.
That solve is well conditioned and gives the silhouette and the drape for free.

Sleeves, hoods and collars are **not** simulated, after five solves that were.
Free-hanging pieces destroyed every one:

| solve | what happened | cause |
|---|---|---|
| 1 | garment left the scene at 19 m | hanger collider crossed the pinned shoulder strip |
| 2 | crumpled sack, 300 mm spikes | sleeves swung 90° and dragged the shoulder in |
| 3 | body compressed 250 mm, wet-paper wrinkles | `mass` is PER VERTEX — 7,000 verts at 0.45 weighs two tonnes |
| 4 | sleeves concertina'd into accordion pleats | `self_friction` 6 makes a settled sleeve grip and stack |
| 5 | whole garment collapsed sideways | free hood swung and took the neck with it |

Isolating the body alone settled it in 43 mm with a clean silhouette. So:
**simulate the body, author everything else against the simulated result** —
grown from where the solve actually left the armholes and the neckline, given
fold structure by hand, and projected out of the body along a radial ray so it
lies on it without passing through it. The brief allows sculpted drape and
shrinkwrap. Unlike the solve, it cannot diverge.

`shirt.py` was extracted only after the hoodie proved the technique, and a
shared change is never treated as a pass for another garment: every one has its
own references, its own frame-numbered fault list and its own review.

---

## The ten

Every asset: `qa/hero/v4/<name>/` holds studio views, detail close-ups, a
`-compare.png` (no floor, tight), a `-REF-v3-v4.png` where a reference exists,
and `-retail.png` / `-retail-q34.png`.

| # | asset | tris | mm | what was rebuilt |
|---|---|---|---|---|
| 1 | hoodie-hung | 38,352 | 640×293×842 | body simulated; shoulder corner; hood as an arching roll; kangaroo pocket tucked under the skin; ribbed waistband with 18 gathers; cords ray-cast onto the chest |
| 2 | trousers-hung | 37,036 | 454×173×1227 | seat tucking under two legs, lambda crotch; clamp hanger that grips; fly, pockets and hems as thread |
| 3 | cap | 16,604 | 166×269×158 | superellipse crown over an oval base, apex behind centre; six panels as creases; visor corners dying on the headband; stitching on top of the bill |
| 4 | polo-hung | 24,644 | 610×231×853 | collar with a stand, a fall and points; three-button placket with a box; shirt-tail hem; side vents |
| 5 | tee-hung | 23,948 | 588×226×836 | jersey drape (13 folds, not 9); neck rib as a sewn strip; roundel print clear of the folds |
| 6 | hoodie-folded | 28,992 | 332×264×104 | five thin plies with shadow between them; hood as a flat flap with an opening slot; pocket seam; size sticker |
| 7 | trousers-folded | 13,296 | 351×240×79 | one end a fat roll of doubled leg, the other the waistband with four belt loops and a button |
| 8 | polo-folded | 13,636 | 315×262×53 | collar splayed flat with points; neck label; sleeve-fold diagonal |
| 9 | tee-folded | 14,172 | 303×245×40 | the thinnest in the set — four crisp lips, neck rib, conformed print |
| 10 | cap-peg | 18,604 | 165×199×283 | a wall peg with a plate and a stop ball; the cap hooked over the rod by its headband, crown out, visor hanging |

**Real references** live in gitignored `qa/hero/v4/ref/` (Wikimedia Commons):
`hoodie-hung-ref1/2`, `trousers-hung-ref1/2`, `cap-ref1/2`, `polo-hung-ref1/2`,
`tee-hung-ref1`, `folded-ref1/2`.

---

## Traps this pass hit, and what each cost

Each of these produced a render that looked like a modelling failure and was
something else.

- **Cloth `mass` is PER VERTEX**, and spring stiffness does not scale with
  resolution. The 0.3 default on a 7,000-vertex garment is two tonnes. It
  compressed 250 mm under its own weight and crumpled.
- **Solidify's even-offset divides by the sine of the corner angle.** Two sharp
  seam corners extruded a 3.4 mm shell into an **eighteen metre** spike.
- **`find_nearest` drifts inward** where a surface curves away — it minimises
  3D distance, so a 372 mm pocket outline conformed to a 313 mm panel. Ray-cast
  instead.
- **Nearest-point projection collapses a sleeve onto a torso**: many deep
  vertices share one nearest point. Project along a radial ray, and skip
  grazing hits, where `dist` swings between neighbours.
- **Laplacian relax shrinks an open sheet** — boundary vertices have neighbours
  on one side only.
- **A panel conformed to a mid-surface must clear the shell AND the folds.**
  Three separate assets fragmented on this: the pocket at 1.6 mm inside a
  3.4 mm shell, the tee print at 0.34 mm, and the print again at 0.55 mm past
  the shell but still inside cloth bulging between its samples.
- **A 1 mm seam cannot be a displacement** on a 16 mm grid. Thread on top.
- **A superellipse will not make a hem.** At hw 150 / ht 6 even an exponent of 6
  rounds the corner over 18 mm of width. Stadium sections by arc length.
- **A quadratic Bézier arrives at its endpoint along the line from its control
  point** — so it makes a cone, not a crown, and reaches only a quarter of the
  way toward its control, which put the hoodie's shoulder 60 mm low.
- **`hero_lib.bounds` reads `ob.bound_box`, which is CACHED.** Transform mesh
  data in background mode and nothing refreshes it. The cap was posed correctly
  on its peg from the first run; every camera was framing where it used to be.
- **`bake_gltf_axis` rotates the meshes**, so any render staged after it shoots
  the underside of the rack from inside the garments.
- **Objects made with `primitive_*_add(location=…)` carry that offset on the
  OBJECT.** Transform the mesh data too and the two compose — the cap's eyelets
  became loose metal specks beside the peg.
- **hero_lib's `studio()` is built for hard-surface props.** Its 38 W fill
  erases exactly the shading a fold is made of; `stage.garment_lights` uses a
  quarter of it. Sheen at 0.30 washed navy out to grey for the same reason.
- **`fit_distance` frames the bounding SPHERE.** A garment is far taller than it
  is deep. `fit_view` was already in hero_lib for this, put there when the cap
  hit it.

---

## The residual pass

The first time through, four assets were shipped with faults I had NAMED and
not fixed. The brief forbids exactly that — "do not call it PASS until it
looks commercially shippable" — so they were reopened:

| asset | named fault | closed by |
|---|---|---|
| hoodie-folded | "still faintly bedding-like square-on" | 8 staggered thin plies instead of 5 flush ones, so each lip stands clear of its neighbour; and the hood rebuilt a THIRD time as another PLY rather than a bolster |
| hoodie-hung | "cuff ribbing reads as a seam, not ribs" | real ribbed cuffs as geometry, plus angle-driven rib normals on the waistband |
| hoodie-hung | "hood tighter than the reference's" | fatter roll, and asymmetric — a dropped hood never lands even |
| polo-hung | "slightly boxy" | 658 mm across a 540 mm chest was wrong; sleeves brought in and the body tapered, now 610 |
| trousers-hung | "legs a touch stiff" | each leg sways a few millimetres, and the two sway differently |
| tee-hung | *found on the sheet, not named before* | the polo's fault again — 650 mm across a 510 mm chest, now 588 |

Two things that came out of it and are worth keeping:

- **Every lip needs its own depth.** With all plies ending at the same y, a
  five-ply stack showed TWO lips, each a 45 mm bolster of two plies bonded by
  a U-turn. Staggering them by 7 mm is the whole difference between a stack of
  cloth and a mattress.
- **Ribbing splits by axis.** The angle about the garment's axis gives correct
  wrapped ribs on a waistband and *three ribs across a whole cuff*, because a
  cuff sits 250 mm off that axis. Waistband in the shader, cuff in geometry.

---

## Technical gates

- **glTF: 10 files, 0 failed, 0 warnings**
- **Export round-trip: 0.000 mm worst part**, every asset
- **Topology: 0 non-manifold, 0 zero-area, 0 zero-length** on every assembled mesh
- **Suite: 3662 pass / 11 fail** — the recorded baseline by NAME, not just by
  count: 30, 42, 66, 72, 400, 1937, 2202, 2219, 2220, 2971, 3483. No new
  failures. The change set is additive (new files under
  `tools/blender/hero/v4/` and `Assets/models/hero/v4/` only)
- **Lint ratchet: 323, green.** **Vendor-models: 127 up to date, 0 problems**

---

## NOT DONE

- **In-game verification — the brief's tenth PASS condition is unmet for all
  ten**, and it is worth being exact about why. Grepping the renderer for
  `hero/v3`, `hero/v4` and every `apparel_*` GLB name returns NOTHING: **the
  v3 hero apparel was never wired either.** The shop's apparel today comes
  from `vendor/models/checkout/apparel_*` and `vendor/models/clubhouse/
  apparel_wall.glb` plus procedural product proxies.

  So this is not a swap of v3 for v4 — it is a NEW integration, and it needs a
  decision that is not mine to make: where in the pro shop these ten states
  go, which fixtures carry them, and how they enter the vendor-models
  manifest. Attempting it unattended risks the golden gate for no art gain.
  The assets are built, exported and validated and are ready for it.
- Residual visual gaps, per asset, are named in the commit messages.
