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
`-compare.png` (no floor, tight), **a `-REF-v3-v4.png` — all ten have one** —
and `-retail.png` / `-retail-q34.png`.

**Verdict against the real reference, per asset**, after the residual pass:

| asset | reference | held up | still short of the photo |
|---|---|---|---|
| hoodie-hung | Holzweiler navy hoodie on a hanger | shoulder corner, hood mass, ribbed bands, pocket, cords | shoulders a touch square |
| trousers-hung | stone chinos, flat | waistband, belt loops, fly, pockets, crease, taper, leg drape | — closest match in the set |
| cap | black cap, dead side on | crown profile, six panels, eyelets, visor curl and stitching | crown-to-visor gap reads slightly dark |
| polo-hung | blue polo, worn | collar stand/fall/points, placket, shirt-tail hem | body still a little straight-sided |
| tee-hung | red tees on a market rail | sleeves now DROP instead of capping; 552 mm silhouette | print is a plain roundel, not a graphic |
| hoodie-folded | JCPenney folded polos | eight staggered lips, hood as a ply, sticker | plan corners crisper than the photo's |
| trousers-folded | JCPenney folded polos | one end a roll, the other the waistband | — |
| polo-folded | JCPenney folded polos | collar splayed with CRISP points, label, sleeve fold | fewer lips than the photo's stack |
| tee-folded | JCPenney folded polos | thinnest in the set at 40 mm, four lips | — |
| cap-peg | the cap itself | hangs by its headband, crown out, visor down | **no photograph of a peg display** — the staging is reasoned, not referenced |

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

---

# ROUND 2 — the reference boards (2026-08-17)

Ten reference boards arrived under `Designs/ProShop/Apparel`, one per asset,
each with front / back / side / detail / retail-context panels. They are now
the shape truth and they **supersede the Wikimedia photographs** for every
judgement about proportion, construction and trim. Copies live at
`qa/hero/v4/ref/board/<asset>.png` and every REFERENCE | CURRENT | NEW sheet
now uses the board rather than a single photograph.

## What the boards changed that no photograph had shown

Three of these applied to every hung garment at once and were wrong on all four.

**1. The hanger.** Every board — hoodie, polo, tee, and the retail racks behind
all three — hangs its stock on the same **black moulded shop hanger with a
chrome hook**, and the trousers hang from a **black clamp hanger** that GRIPS
the waistband. All four garments were on white wire. It was the single most
visible non-retail tell in the set. `stage.top_hanger` and
`stage.clamp_hanger` now serve all five.

**2. Depth.** The boards' SIDE VIEW panels show a hung garment is very nearly
FLAT. The hoodie was 150 mm front-to-back on a 508 mm chest — a bolster. That
one number is the whole of the "inflated / rounded block / pillow" reading, and
no amount of fold work reaches past it. Now 88 mm.

**3. Trim scale.** Ribbing, seams, creases and topstitch were all built at
"correct" millimetre sizes and were invisible at the size the asset is actually
looked at. The trouser crease was 2.4 mm on a 105 mm leg; the board reads the
trousers by that line before it reads the pockets. Now 5.2.

## Per-asset, against its board

| # | Asset | What the board forced | State |
|---|---|---|---|
| 1 | hoodie-hung | −33 mm half-width, +35 mm length, HALF the depth, modelled 208-column waistband, hood ends buried, face facing, armhole seams, pocket down onto the band | **rebuilt** |
| 2 | trousers-hung | black clamp hanger, legs taper to 2/3, crease 2.4 → 5.2 mm, thread stops being the same material as the cloth | **rebuilt** |
| 3 | cap | back closure added from nothing: keyhole cut as a real GAP, webbing strap, slide buckle | **rebuilt** |
| 4 | polo-hung | black hanger, calm front panel, sleeves attached at 4.2 mm clearance with a hem lobe | improved |
| 5 | tee-hung | black hanger inside the neck, crew collar rebuilt as a ROLL (96 ribs, 288 columns), roundel deleted | **rebuilt** |
| 6 | hoodie-folded | hood rebuilt a FIFTH time — as the arched hollow roll the board shows, with a binding round its mouth; 8 thin plies → 5 fat; tonal cords | **rebuilt** |
| 7 | trousers-folded | 4 plies, crease, waistband | improved |
| 8 | polo-folded | 6 thin plies → 4 fat, collar given a 9 mm STAND so it throws a shadow, third button | improved |
| 9 | tee-folded | 3 → 4 plies, roundel deleted for a 42 mm off-centre flag, neck rib 2.7 → 6.2 mm roll, slate blue, scratch-lines killed | **rebuilt** |
| 10 | cap-peg | SLATWALL, flat bracket plate, rod long again so the chrome ball clears the crown, tilt 78° → 62° | **rebuilt** |

## Traps this round added to the list

- **Cloth mass is per vertex — and the right value scales with AREA, not with
  the cloth.** Flattening the hoodie cost 40% of its surface without changing
  the vertex count, so the same 0.090 was that much denser against springs
  whose rest lengths shrank with it. Travel went 44 mm → 188, the hem stretched
  into a pouch hanging out below the waistband, and the hem's own height spread
  over 31 mm. Third time this arithmetic has arrived looking like a modelling
  failure. `drape.add_cloth` now takes a `mass` override.
- **Angular ribbing smears on a flattened section.** Ribs driven off the angle
  about the garment's axis are even on a tube and wildly uneven on a
  superellipse at n = 3.4: dx/dθ runs away at centre front, so 150 ribs per
  turn arrived as twenty broad corrugations across the front panel and a blur
  at the side seams. Rib pitch has to be ARC LENGTH, which the shader cannot
  reach without UVs — so the waistband is modelled at 208 columns.
- **Trim built from the profile table lands on a body that has moved.** The
  waistband was lofted from `BODY_PROFILE` while the body is simulated and then
  fold-displaced; it came out skewed across a hem 31 mm from where the table
  said. Build trim from the BODY's own rings, and level its bottom edge under
  the lowest point of the cloth.
- **Thread the same colour as the cloth is not a seam.** Every groove and
  topstitch on the trousers was correct and invisible because the stitch
  objects carried the garment material.
- **A flat strip on a horizontal yoke is edge-on from every front camera.** The
  tee's crew collar was rebuilt as a flat band specifically to avoid v3's
  "torus laid on the shoulders", and rendered as nothing at all. The right
  object is a ROLL.
- **A detail that reads as a scratch is worse than no detail.** Piped
  "sleeve fold" seams laid on the folded tee and polo read as scratches across
  the ply; the board shows a soft crease in the cloth and no line at all.
- **A geometry change moves the props that were tuned around it.** Flattening
  the hoodie put the hanger's tips through the shoulders and left the hood
  roll's end caps outside the front surface as two curved flaps that read as a
  shirt collar; raising the hood 30 mm then pushed the hanger's shoulder out of
  the neck as a black beak. Re-look at every attached part after any change to
  the body's envelope.

## Technical gates, this round

- glTF: `node tools/validate-gltf.mjs Assets/models/hero/v4` → **10 files,
  0 failed, 0 warnings.**
- Export round-trip: 0.000 mm on nine, 0.199 mm on the cap (the buckle's
  baked rotation).
- Lint ratchet: **323, green** against the frozen baseline.
- vendor-models: **127 up to date, 0 problems.**

## STILL NOT DONE

- **In-game verification.** Nothing is wired: grepping the renderer for
  `hero/v4` and for every `apparel_*` GLB name returns nothing, and v3 was
  never wired either. The shop's apparel comes from
  `vendor/models/checkout/apparel_*` and
  `vendor/models/clubhouse/apparel_wall.glb` plus procedural proxies. Wiring v4
  is a NEW integration and needs an owner decision about where in the pro shop
  these ten states go — it is not a swap.
- The hoodie's hood has a cavity but no lining texture inside it.
- The cap's keyhole edge is a quad-skip staircase at 96 columns.

---

# REQUIRED FINAL DELIVERY — round 2, against the boards

Contact sheet for all ten: **`qa/hero/v4/CONTACT-v4.png`**, with the same ten in
v3 beside it at `CONTACT-v3.png`.

Every asset's REFERENCE | CURRENT | NEW sheet is
`qa/hero/v4/<asset>/<asset>-REF-v3-v4.png`, and the REFERENCE column is that
asset's board. Studio angles (front / three-quarter / side / back / top or low)
and two retail-context frames are in the same directory as
`<asset>-v4-<label>.png`.

**In-game render: NOT AVAILABLE for any of the ten** — see the blocked note at
the end. Every VISUAL VERDICT below is therefore against the board and the
retail-context frame only, and PASS condition 10 of the brief is unmet for all
ten by the same cause.

| Asset | Board | Major old faults | What was rebuilt | Tris | Materials | Technical | Visual verdict |
|---|---|---|---|---|---|---|---|
| **hoodie-hung** | `board/hoodie-hung.png` | inflated pillow body, no waistband ribs the eye could read, hood a lump with no opening, white wire hanger, pocket a flat rectangle | body −33 mm half-width, +35 mm long and HALF as deep; waistband modelled at 208 columns on arc-length rib pitch and built from the body's own hem; hood ends buried, facing added, cavity opened; armhole seams; pocket dropped onto the band; heather marl | 49,968 | fleece, cord, hardware | glTF clean, round-trip 0.000 mm | **PRODUCTION READY** |
| **trousers-hung** | `board/trousers-hung.png` | straight tube legs, invisible crease and seams, wire-and-wood hanger | legs taper to two thirds; crease 2.4 → 5.2 mm; every groove and topstitch raised and the thread given its own material; black moulded clamp hanger | 37,012 | chino, thread, button, hanger, steel | glTF clean, 0.000 mm | **PRODUCTION READY** |
| **cap** | `board/cap.png` | no back at all; flat ramp bill; embroidery standing off the panel as wire; eyelets rendering as charcoal | keyhole cut as a real gap and BOUND; webbing strap and slide buckle; bill re-profiled as an arc with a cross-curl; device sunk to 0.4 mm in a tonal thread; trim metal fixed | 17,392 | twill, thread, webbing, band, emb, brass, steel | glTF clean, round-trip **0.199 mm** (buckle's baked rotation) | **PRODUCTION READY** |
| **polo-hung** | `board/polo-hung.png` | collar two thin tabs near the neck; sleeve to the elbow; an 11 mm crease dead down the centre front; armhole slots | collar fall 34.5 → 45.5 mm with points that reach the placket; sleeve to mid-bicep with a hem lobe; front panel calmed (side bias 0.40 → 0.66); clearance to two thicknesses of pique | 24,816 | pique, thread, button, hanger | glTF clean, 0.000 mm | **PRODUCTION READY** |
| **tee-hung** | `board/tee-hung.png` | 131 mm filled roundel dead centre; crew collar invisible; boxy at 0.75 w/h; wire hanger | roundel deleted for the board's small line-art flag; collar rebuilt as a ROLL, 96 ribs at 288 columns; 70 mm narrower to 0.69; a fifth flatter; black hanger inside the neck | 33,012 | jersey, rib, ink, hanger | glTF clean, 0.000 mm | **PRODUCTION READY** |
| **hoodie-folded** | `board/hoodie-folded.png` | hood flat and invisible; eight thin plies reading as several garments; cords brighter than anything else in frame | hood rebuilt (fifth cut) as the arched hollow roll with a bound mouth; 8 → 5 fat staggered plies; cords tonal with gunmetal tips | 23,240 | fleece, rib, cord, aglet, tag | glTF clean, 0.000 mm | **PRODUCTION READY** |
| **trousers-folded** | `board/trousers-folded.png` | flat slab; button too large and bright | 4 plies, waistband and loops standing proud, crease, smaller darker button | 13,296 | chino, thread, tag | glTF clean, 0.000 mm | **PRODUCTION READY** |
| **polo-folded** | `board/polo-folded.png` | collar cut flat into the ply so it cast no shadow; six thin plies; two buttons | collar given a 9 mm stand along its fold; 6 → 4 fat plies; third button | 15,080 | pique, thread, button, tag | glTF clean, 0.000 mm | **PRODUCTION READY** |
| **tee-folded** | `board/tee-folded.png` | 101 mm filled roundel in the middle of the ply; neck rib a 2.7 mm thread; two piped seams reading as scratches; off-white | roundel deleted for a 42 mm off-centre flag; rib a 6.2 mm rolled band; seams down to 0.55 mm; 4 plies; slate blue | 13,172 | jersey, rib, ink | glTF clean, 0.000 mm | **PRODUCTION READY** |
| **cap-peg** | `board/cap-peg.png` | a cap in front of a flat grey plane, peg invisible | slatwall; flat bracket plate; rod long again and the cap hung near the bracket so the chrome ball clears the crown; tilt 78° → 62° | 17,500 | (cap's set) + peg steel | glTF clean, 0.000 mm | **PRODUCTION READY** |

## Still visibly imperfect, and named

- **hoodie-hung** — the hood's cavity is dark but has no lining texture inside
  it; the board's shows a seam and a lighter twill lining.
- **polo-hung** — a faint vertical shading step remains at the lower centre
  front. It is a fold's edge meeting the auto-smooth angle, not a seam, and it
  survives at reduced fold amplitude.
- **cap** — the keyhole's binding hides the quad-skip staircase from the back
  view; from a steep low angle the step is still findable.
- All ten — no UV work has been done. Nothing is textured; the fabric character
  is procedural noise on colour and bump only. That is within the brief's
  "microvariation rather than a perfect repeating grid", but it means the
  §UV/MATERIAL/EXPORT requirements about texel density and logo stretching are
  vacuous rather than met.
