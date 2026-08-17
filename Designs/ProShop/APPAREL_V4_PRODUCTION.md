# APPAREL v4 — the production-art rebuild

Governed by `APPAREL_PRODUCTION_ART_BRIEF.md`. That brief overrides the v2/v3
quality bar: **real retail merchandise is the source of truth, not v3, not an
assertion, and not "it beats v2".**

v3 stays on disk untouched as the CURRENT column of every comparison.

---

## Why v3 failed, in one sentence

**Every v3 garment was a surface of revolution with primitives bolted on**, and
that single choice produced the entire fault board. A lofted tube's rings are
level, so it cannot have a shoulder. Its rings are convex, so it cannot have a
fold. Its rings are closed curves of one radius, so it cannot have a hem that
wanders — and the only way to widen one is to grow the radius, which is why the
hoodie flared into a bell with its widest point at the hem. Everything else had
to be a separate primitive stuck to the outside: a cylinder for a sleeve, a bar
for a pocket, a disc for a hood, two slabs for shoulders.

No amount of tuning fixes that. The construction had to go.

---

## Method

`tools/blender/hero/v4/` — `drape.py` (library), `stage.py` (lighting and
retail staging), `compare.mjs` (the REAL | CURRENT | NEW sheet), and one module
per garment.

**A hybrid, arrived at the hard way.** The body is genuinely simulated: a
panelled shell with real armholes cut into the yoke, hung from the strip a
hanger actually touches, dropped under gravity with self-collision. That solve
is well conditioned and gives the silhouette and the drape for free.

The sleeves and the hood are **not** simulated, after five solves that were.
Free-hanging pieces destroyed every one:

| solve | what happened | cause |
|---|---|---|
| 1 | garment left the scene at 19 m | hanger collider crossed the pinned shoulder strip |
| 2 | crumpled sack, 300 mm spikes | sleeves swung 90° and dragged the shoulder in |
| 3 | body compressed 250 mm, wet-paper wrinkles | `mass` is PER VERTEX — 7,000 verts at 0.45 weighs two tonnes |
| 4 | sleeves concertina'd into accordion pleats | `self_friction` 6 makes a settled sleeve grip and stack |
| 5 | whole garment collapsed sideways | free hood swung and took the neck with it |

Isolating the body alone settled it in 43 mm of travel with a clean silhouette.
So: **simulate the body, author everything else against the simulated result** —
grown from where the solve actually left the armholes and the neckline, given
fold structure by hand, and projected out of the body so they lie on it without
passing through it. The brief allows sculpted drape and shrinkwrap. Unlike the
solve, it cannot diverge.

---

## Asset 1 of 10 — HOODIE HUNG

**Real references** `qa/hero/v4/ref/hoodie-hung-ref1.jpg`, `-ref2.jpg`
(Holzweiler navy pullover hoodie on a wooden hanger, front and upper body;
Wikimedia Commons, kept out of the repo under gitignored `qa/`).

**Comparison** `qa/hero/v4/hoodie-hung/hoodie-hung-REF-v3-v4.png`
— REAL | CURRENT (v3) | NEW (v4), matched height.

**Retail context** `hoodie-hung-v4-retail.png`, `-retail-q34.png` — five on a
chrome rail in shop light. The brief calls this the deciding image.

### Fault list from the v3 turntable, and what replaced it

| # | v3 fault (frame) | v4 |
|---|---|---|
| H1 | body flares into a BELL, widest at the hem (`hoodie-hung-front`) | straight with a slight taper in; measured 630 × 864 mm against 626 × 830 derived from the reference |
| H2 | no waistband at all — the hem is the rim of the loft | ribbed band pulled in 15 mm, 18 gathers blousing over it, a 2.6 mm seam groove at the join |
| H3 | two hard-edged slabs on the shoulders like pauldrons | a real shoulder CORNER: two Bézier segments meeting at the shoulder point (one quadratic can only make a dome) |
| H4 | sleeves are tapered cylinders at a fixed angle (`-hero`) | flattened tubes lying on the side seam, section parallel-transported so "up at the armhole" becomes "outboard at the cuff" |
| H5 | cuffs are rings clamped on the end | a pinch seam and a fuller band below it |
| H6 | hood is a flat disc / bagel (`-front`, `-side`) | a roll of cloth arching over the back of the neck, with a bowl lining so the neck is a dark cavity you see into |
| H7 | kangaroo pocket is a rounded bar standing 20 mm proud | a 372 mm trapezoid with two diagonal hand openings; stitched edges tucked 2.4 mm UNDER the body's skin so the seam is a line, not a cliff |
| H8 | drawstrings are two engraved grooves | swept cords ray-cast onto the chest so they follow it |
| H9 | flat albedo — reads as moulded plastic | navy fleece: 0.955 roughness, 8.5% sheen, fine noise on the BUMP only |

### Instrument and pipeline traps this pass hit

- **Solidify's even-offset divides by the sine of the corner angle.** Two sharp
  seam corners extruded a 3.4 mm shell into an **18 metre** spike. Off, plus a
  clamp.
- **`find_nearest` drifts inward** where a surface curves away — it minimises
  3D distance, so a 372 mm pocket outline conformed to a 313 mm panel. Ray-cast
  instead; it preserves the two coordinates you care about.
- **Laplacian relax shrinks an open sheet** — every boundary vertex has
  neighbours on one side only. Freeze the boundary.
- **Nearest-point projection collapses a sleeve onto a torso**: many deep
  vertices share one nearest point and land on the same square millimetre.
  Project along a radial ray instead, and skip grazing hits.
- **`bake_gltf_axis` rotates the meshes**, so any render staged after it shoots
  the underside of the rack from inside the garments.
- **hero_lib's `studio()` is built for hard-surface props.** Its 38 W fill
  erases exactly the shading a fold is made of. `stage.garment_lights` uses a
  quarter of it.
- **`fit_distance` frames the bounding SPHERE** — a garment is far taller than
  it is deep, so it landed at a third of the frame beside a reference photo
  that filled its tile. `fit_view` was already in hero_lib for this, put there
  when the cap hit it.

### Numbers

- **33,872 tris**, 2 materials, 640 × 293 × 842 mm
- topology: 0 non-manifold, 0 zero-area, 0 zero-length
- **glTF: 0 failed, 0 warnings** (`Assets/models/hero/v4/apparel_hoodie_hung.glb`)

### Verdict

**Clearly closes the major visual gap.** Shoulder line, hanging tapered
sleeves, kangaroo pocket with both openings reading, ribbed waistband,
drawcords, hood mass with a visible neck cavity — none of which v3 had in any
form. It survives being overlapped by four of its own kind on a rail.

**Still short of the reference**, honestly: the hood is tighter and more
compact than the reference's big soft roll, the cuff ribbing reads as a seam
rather than as ribs (72 columns cannot resolve 6 mm ribs — that belongs in the
texture), and the body's folds are softer than real fleece.

**NOT YET DONE for this asset:** in-game verification.

---

## Remaining nine

Priority order from the brief: trousers hung, cap, polo hung, tee hung, hoodie
folded, trousers folded, polo folded, tee folded, cap display/peg.

Each gets its own references, its own frame-numbered fault list, and its own
visual review. The library is shared; **a shared code change never means
another garment passes.**
