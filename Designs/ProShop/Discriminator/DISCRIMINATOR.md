# What actually separates the pro shop's good assets from its bad ones

A measurement session, not a production pass. No asset was modified, no texture was
authored, no phase was begun.

**Why this exists.** The texture spike (`Spike/TEXTURE_VALIDATION.md`) proved that texture
improves an asset. It was then used to justify a twelve-file texture pass on the theory
that texture explains the room's good/bad gap. That theory lost its footing when the
material audit found the reception counter — named in `ART_BIBLE.md` §1 as the best thing
in the room — carries no maps at all. An untextured asset cannot be the best in the room
if texture is what makes assets good.

So the discriminator was measured across the whole population instead of inferred from
anchors. Two conclusions have already been produced by reasoning from two hand-picked
assets, and both were wrong.

---

## The answer, up front

**The hypothesis under test — part count and construction detail — is not supported.**
Across 40 assets, separable part count correlates with visual rank at **ρ = 0.03, p = 0.85**.
That is not a weak effect; it is no effect. Every other construction measure is
similarly flat: triangle count ρ = 0.12, distinct materials ρ = 0.04, bevelled corners
ρ = −0.11, merge factor ρ = 0.17 (and *positive*, i.e. slightly the wrong way).

**Nothing measured here is a strong discriminator.** The best single predictor reaches
ρ = 0.385, which accounts for about 15% of the ordering. There is no metric in this
report that a builder could optimise and expect a better-looking room.

**What separates the good from the bad is not a quantity at all.** The bottom of the
ranking is dominated by assets whose parts exist, are correctly built, and are assembled
so that they cannot be seen or do not connect. The worst asset in the set has a higher
triangle density than the best one by a factor of 28. It is not missing anything. It is
put together wrong.

**Consequence for the budget:** the twelve-file texture pass does not drop behind a
merged-mesh rebuild, because merged meshes do not predict quality — the single most
merged asset in the population ranks 7th of 40. It also should not proceed as planned.
The revised order is in §7.

---

## 1. Population and instruments

**Population: all 40 pro-shop props, `asset_061` through `asset_100`** — sheets 07
(furniture), 08 (cleaning), 09 (office) and 10 (safety). All four sheets are produced by
sibling builders in `tools/blender/build_assets_*.py`, so a construction difference
between them is something a builder can act on. Sheet 06 is the architectural shell and
is built by a different pipeline against different constraints; it is not in the
population and its absence is not an oversight.

Files audited are the ones the runtime actually loads, `vendor/models/assets_51_100/`,
which has already drifted from the authoring copy: `asset_065`'s shipped GLB is the Arm I
rebuild at 2.5 MB against a 68 KB original.

| Instrument | What it produces |
|---|---|
| `tools/qa/proshop-construction-audit.mjs` | Geometry read from GLB bytes: parts, shells, merge factor, triangles, surface area, materials, textured materials, bevel presence and width, flat-plane share, colour spread, animations, sockets |
| `tools/qa/proshop-screen-time.js` | Per-asset share of the player's view, by ID render over 3,552 poses |
| `tools/qa/proshop-asset-contact-sheet.js` | One identically-shot portrait of each asset, plus rendered detail-density and silhouette measures |
| `tools/qa/proshop-discriminator-analysis.mjs` | Spearman correlation and a top-decile/bottom-decile test |
| `tests/proshop-construction-audit.test.js` | Validates the bevel detector against geometry whose answer is known by construction |

Two measurements are not standard glTF statistics and the conclusions lean on them, so
they are stated plainly.

**Shells versus parts.** A glTF node holding a mesh is one thing the runtime can move.
That mesh may contain any number of disconnected islands welded into a single buffer.
`parts` counts nodes; `shells` counts connected components of the triangle graph after
welding coincident positions. `shells / parts` is the merge factor — how many physical
pieces are fused into each movable part. This is the "merged mesh" property under test and
it is invisible in a triangle count.

**Bevels.** Adjacency is rebuilt by welding positions, because Blender splits vertices at
hard edges on export and index-based adjacency cannot see across a seam. Faces are then
grouped into flat regions, and a chamfer is a *narrow strip with a real face either side* —
which is what distinguishes it from a tessellated curve, where a 16-segment cylinder turns
22° at every segment boundary and a naive dihedral test calls each one a bevel. Width is
the strip's hydraulic width `2A/P`, in millimetres.

The bevel detector is checked against a bare right-angle corner (must report one hard
corner), a 6 mm chamfer (must report one bevel of the authored width), a 16-segment
cylinder (must report neither), and a corner split across a Blender hard-edge seam (must
still weld into one shell). All four pass. This matters because the audit's finding is a
*negative* one — no asset in the population has a bare hard corner — and a detector that
never fires would produce the same output.

---

## 2. Screen time

Measured by ID render: every mesh is swapped for a flat unlit material whose colour
encodes which asset owns it, the scene is rendered from each sampled pose, and the pixels
are counted. Occlusion, perspective and the real lens fall out of the render, which is why
this is a render and not a bounding-box projection — the shelving unit behind the
partition subtends a large solid angle and is worth nothing, and only a depth-tested
render knows that.

**222 standable positions** on a 0.75 yd lattice (tested the way the walker tests it, plus
a floor-and-ceiling check so a point outside the shell cannot pass), × 8 yaws × 2 pitches
= **3,552 poses**. Zero unattributed pixels.

This is a **uniform prior over where the player can stand**, not a dwell-weighted one.
Nobody has measured dwell, and inventing a weight would put a thumb on exactly the scale
this audit exists to read.

| | mean share of frame | peak share | share of poses it appears in |
|---|---|---|---|
| back counter `062` | 1.855% | 47.1% | 33.0% |
| front counter `061` | 1.216% | 29.6% | 27.5% |
| shelving `064` | 0.871% | 65.1% | 5.2% |
| trophy cabinet `070` | 0.659% | 76.8% | 18.0% |
| *median of all 40* | *0.026%* | *2.2%* | *16.2%* |
| hose and wand `079` | 0.002% | 0.7% | 1.0% |

---

## 3. The ranking

Fixed before any correlation was computed, and before the construction numbers for most of
these assets had been looked at. Criteria, in priority order:

- **A — identifiability.** Does it read as the object it is named after, at a glance, at
  room distance? Failing this outranks every other defect because the player never gets to
  the second question.
- **B — coherence.** Do the parts touch, sit and connect where physics would put them?
- **C — secondary structure.** Panels, reveals, mouldings, glazing bars, hardware — or is
  it the bare box it started as?
- **D — material plausibility.** **E — proportion.**

| # | asset | # | asset | # | asset | # | asset |
|---|---|---|---|---|---|---|---|
| 1 | `070` trophy cabinet | 11 | `061` front counter | 21 | `088` key rack | 31 | `076` spray bottle |
| 2 | `083` desk lamp | 12 | `072` mop | 22 | `079` hose and wand | 32 | `098` sanitizer station |
| 3 | `064` shelving system | 13 | `089` clipboard | 23 | `069` coffee table | 33 | `082` filing cabinet |
| 4 | `094` exit sign | 14 | `086` corkboard | 24 | `085` telephone | 34 | `068` armchair |
| 5 | `091` fire extinguisher | 15 | `096` bulletin board | 25 | `067` sofa | 35 | `100` welcome mat |
| 6 | `065` worktable | 16 | `090` scorecard holder | 26 | `084` printer | 36 | `077` cloth and sponge |
| 7 | `081` office chair | 17 | `099` umbrella stand | 27 | `097` key cabinet | 37 | `078` pressure washer |
| 8 | `066` office desk | 18 | `074` broom | 28 | `093` security camera | 38 | `080` trash bag |
| 9 | `062` back counter | 19 | `071` vacuum | 29 | `075` dustpan | 39 | `073` mop bucket |
| 10 | `095` emergency light | 20 | `092` first aid cabinet | 30 | `063` fitting room | 40 | `087` wall clock |

Per-asset reasons are in `data/visual-ranking.json`. Portraits are in `frames/`.

---

## 4. What correlates

Spearman rank correlation, n = 40. Sign inverted so **positive means more of the property
goes with looking better**.

| property | ρ | p |
|---|---|---|
| share of poses it appears in | **0.385** | 0.014 * |
| visible detail density (best angle) | **0.374** | 0.017 * |
| emissive materials | 0.367 | 0.020 * |
| silhouette indentation | **0.343** | 0.030 * |
| mean screen time | 0.307 | 0.054 |
| visible detail density (mean of 12 angles) | 0.289 | 0.070 |
| share of surface that is flat plane | −0.283 | 0.077 |
| longest dimension | 0.274 | 0.088 |
| file size | 0.202 | 0.211 |
| **merge factor (shells per part)** | **0.174** | **0.283** |
| connected shells | 0.154 | 0.344 |
| median bevel width | 0.147 | 0.367 |
| has moving parts | −0.145 | 0.371 |
| triangle count | 0.123 | 0.449 |
| within-asset lightness spread | 0.110 | 0.501 |
| bevelled corners | −0.105 | 0.520 |
| triangle density per m² | −0.072 | 0.659 |
| sockets | 0.048 | 0.767 |
| distinct materials | 0.040 | 0.804 |
| drawn from the global static batch | 0.040 | 0.806 |
| **separable parts (mesh nodes)** | **0.030** | **0.854** |
| bare hard corners | 0.000 | 1.000 |

Full table, including the properties omitted here for length, in `data/correlation.json`.

Because a rank correlation over 40 is diluted by a large undifferentiated middle — most of
these assets are neither good nor bad and their ordering is close to arbitrary — each
property was also tested on the **top ten against the bottom ten**, where the ordering is
something anyone would agree with. AUC is the chance a top-ten asset scores higher than a
bottom-ten one; 0.5 is no separation.

| property | top median | bottom median | AUC | p |
|---|---|---|---|---|
| share of poses it appears in | 19.2% | 7.1% | **0.86** | 0.007 ** |
| silhouette indentation | 3.29 | 1.73 | 0.75 | 0.059 |
| share of surface that is flat plane | 0.81 | 0.88 | 0.25 | 0.059 |
| mean screen time | 0.189% | 0.024% | 0.75 | 0.064 |
| visible detail density (best angle) | 0.403 | 0.318 | 0.74 | 0.070 |
| longest dimension | 1.35 m | 0.79 m | 0.74 | 0.070 |
| **separable parts** | **8.5** | **7.5** | **0.63** | **0.31** |

### Reading this honestly

**The strongest predictor is not a construction property.** "Share of poses it appears in"
says the assets that get looked at are the ones that were built well. That is a statement
about where the author's effort went, not about what to build. It is a real finding — the
effort tracked visibility, which is the correct instinct — but it gives a builder nothing
to do to a bad asset except make it bigger.

**Two construction measures do carry signal**, both borderline: **silhouette indentation**
(how much shape the outline has — 3.29 vs 1.73) and **flat-plane share** in the negative
direction (bad assets are 88% flat plane, good ones 81% — the bad ones are boxier). Both
point the same way: assets that are still recognisably the primitive they started as rank
low. Neither reaches p < 0.05 on the decile test.

**Everything else is noise**, including every quantity the twelve-file plan was sized
against.

---

## 5. The hypothesis, tested

> "My hypothesis is part count and construction detail."

Not supported, and the counterexamples are specific rather than statistical:

* **`asset_081` office chair — 2 parts, merge factor 16.5, the most merged asset in the
  population — ranks 7th of 40.** It is one authored mesh containing 33 welded shells and
  it reads immediately as an executive chair.
* **`asset_072` mop — merge factor 21.6, the highest in the set — ranks 12th.** Its 108
  shells are the strand fan, and the strand fan is the reason it reads as a mop.
* **`asset_093` security camera — 6 parts, 6 shells, merge factor 1.00, perfectly
  separated — ranks 28th.**
* **`asset_100` welcome mat — 4 parts, 4 shells, merge factor 1.00 — ranks 35th.**
* **`asset_080` trash bag — 8 parts, 8 shells, merge factor 1.00 — ranks 38th.**

The top ten's median part count is 8.5; the bottom ten's is 7.5. The best asset in the set
has 15 parts and the third-best has 5.

**There are no merged-mesh assets that need rebuilding**, because merging is not what is
wrong with the assets that are wrong. Twelve assets have a merge factor of exactly 1.00 —
perfectly separated, one shell per part — and they are spread evenly across the ranking:
`083` at 2nd, `091` at 5th, `095` at 10th, `093` at 28th, `100` at 35th, `080` at 38th.

Two further nulls worth recording, because both were plausible:

* **Bevels do not discriminate, because they are universal.** `hardCorners` is **zero for
  all 40 assets**: every sharp corner in the pro shop is already chamfered, so the property
  has one value and cannot separate anything. Bevel *width* does vary — 0.37 mm to 16 mm —
  and correlates ρ = 0.147, p = 0.37. There is no bevel work to do.
* **Within-asset colour contrast does not discriminate** (ρ = 0.110, p = 0.50). The
  highest lightness spread in the population belongs to `asset_093`; the emergency light,
  10th, has almost none.

---

## 6. Best against worst

Only `asset_065` carries textures, so 39 of 40 are untextured and the pair the question
asks for is the top and bottom of the ranking.

**Best untextured: `asset_070` trophy display cabinet (rank 1).**
**Worst untextured: `asset_087` wall clock (rank 40).**

| | `070` cabinet | `087` clock |
|---|---|---|
| parts | 15 | 9 |
| shells | 23 | 20 |
| merge factor | 1.53 | 2.22 |
| triangles | 4,056 | 3,568 |
| surface area | 23.31 m² | 0.74 m² |
| **triangle density** | **174 /m²** | **4,829 /m²** |
| materials | 7 | 5 |
| bevelled corners | 136 | **212** |
| bare hard corners | 0 | 0 |
| flat-plane share | 0.845 | 0.920 |

The clock is not starved. It carries **28× the triangle density**, more bevelled corners,
a comparable shell count, and five materials against seven. On every quantity in this
report it is a competitive asset.

Its part list is also complete. It has a case, a bezel, a **cream dial face**, a dial, a
glass, a boss, and **three separate hands**:

```
MESH_ClockDial(1296t)  MESH_ClockBezel(476t)   MESH_ClockCase(476t)
MESH_ClockFace(428t)   MESH_ClockGlass(428t)   MESH_ClockBoss(140t)
MESH_ClockHourHand(108t)  MESH_ClockMinuteHand(108t)  MESH_ClockSecondHand(108t)
```

And it renders as **a bare brown dome with one hand and no dial** (`frames/asset_087.png`),
from every one of the twelve angles probed, including from below at player eye height.

### The one difference

Reading the parts' depth along the clock's facing axis:

| part | z-min | z-max | material |
|---|---|---|---|
| `MESH_ClockCase` | −0.0000 | 0.0520 | MediumWalnut |
| **`MESH_ClockFace`** | **0.0430** | **0.0490** | **ClockFace cream** |
| **`MESH_ClockBezel`** | **0.0430** | **0.0570** | **MediumWalnut** |
| `MESH_ClockGlass` | 0.0500 | 0.0540 | glass |
| `MESH_ClockHourHand` | 0.0535 | 0.0585 | black |

**The bezel starts at the same plane as the dial face and extends 8 mm in front of it.** It
is modelled as a filled cap rather than a ring, so the cream face and the dial it carries
sit behind a solid disc of walnut. The render confirms it: zero cream pixels, from any
angle. 0.146 m² of authored dial — 20% of the asset's entire surface — is invisible in the
shipped game.

**That is the difference to fix, and it is the only one that matters.** Not part count: the
parts are there. Not triangles: it has 28× the density of the best asset in the room. Not
bevels: it has more. Not texture: a dial face does not need one to read at 4 m. Open the
bezel into a ring and the clock joins the middle of the ranking without a single new
triangle.

### The same failure elsewhere

This is not one asset's bad luck. Three of the five worst are the same class of defect:

* **`073` mop bucket (rank 39)** — the wringer handle floats detached in mid-air above the
  bucket and the wringer body does not sit on the rim.
* **`078` pressure washer (rank 37)** — the hose-reel discs float clear of their axle and
  the wheels are half-buried in the base.
* **`087` wall clock (rank 40)** — the dial is behind the bezel.

None of these is a missing-detail failure. Every part was authored and every part is
placed somewhere it does not belong. That is an **assembly** defect, and no amount of
texture, geometry or part separation addresses it.

### A same-class control

The cabinet-versus-clock pair spans a 116× difference in surface area, so a same-class
comparison is worth having: `070` trophy cabinet (rank 1) against `082` filing cabinet
(rank 33) — both storage furniture, both untextured.

| | `070` (rank 1) | `082` (rank 33) |
|---|---|---|
| parts | 15 | 8 |
| triangles | 4,056 | 1,728 |
| materials | 7 | 2 |
| **visible detail density** | **0.268** | **0.070** |
| flat-plane share | 0.845 | 0.932 |

Within a class, the difference is real and it is **visible detail density — 3.8×**. The
filing cabinet spends 972 of its 1,728 triangles on one drawer bank and leaves every other
face a bare slab. This is the one place the "construction detail" hypothesis holds, and it
holds *within* an object class rather than across the population.

---

## 7. Revised order of work

> **Executed 2026-07-27** — items 1 and 2 are done; see `ASSEMBLY_FIXES.md` in this
> directory for the fixes, the part-visibility sweep that followed, and the before/after
> evidence in `frames_after/`.

The premise of the question was that if part separation beat texture, the texture pass
drops behind a merged-mesh rebuild. Neither is what the data supports.

1. **Fix the assembly defects. Three assets, no new geometry, no new textures.**
   `087` bezel-over-dial, `073` detached wringer handle, `078` floating hose reel. These
   are the three worst-ranked assets in the room and the fix is repositioning parts that
   already exist. Cheapest work in this document by a wide margin, and the only work that
   removes an outright *broken* read.

2. **Then re-ask whether the texture pass is worth twelve files.** Arm I stands: texture
   improves an asset, measured. What this session removes is the claim that texture
   explains the good/bad gap — it does not, because 39 of 40 assets are untextured and
   they occupy the whole range. The pass is a polish lever applied to assets that already
   read correctly, not a repair. Price it as polish.

3. **If the pass proceeds, sequence it by screen time, not by sheet order.** Screen time
   is the strongest measured correlate in this report, and the room's own budget already
   follows it. `062`, `061`, `064` and `070` are the four assets above 0.6% mean screen
   share; the median asset in the set is at 0.026%, roughly **70× less**. A texture on
   `079` (0.002%) is very close to a texture nobody sees.

4. **Do not spend anything on bevels or part separation.** Both are measured nulls. Every
   corner in the room is already chamfered, and merge factor runs the wrong way.

5. **Not in this room's budget, but larger than all of it:** the whole scene carries 547 MB
   of texture, of which **256 MB is twelve 2048² `tripo_image_*` maps on AI-generated
   course models**. That is more than the entire pro-shop interior (148.8 MB) and it is
   outside this slice.

---

## 8. Corrections made to the instruments during the session

Three, all of which had already produced a wrong number before they were caught. Recorded
because each would have been invisible in the output.

**The room draws ten of these assets from a merged batch.** `propPlacement.js`
`batchPlacedStaticVisuals` merges the non-animated, non-fixture props into one
`Assets61to100PlacedStaticBatch` and takes their source meshes off every camera layer
(`source.layers.mask = 0`) *rather than hiding them*. Those meshes still report
`visible === true` and still have bounds, but draw nothing. The first screen-time pass
reported `065`, `067`, `068`, `069`, `086`, `087`, `088`, `089`, `090` and `091` as never
appearing on screen, and the first portrait pass returned ten empty frames. Both tools now
restore the layer and hide the batch for the measurement, which draws identical geometry
in identical places with the pixels attributed to the asset that owns them.

**A fixed camera elevation photographed the ceiling.** The portrait rig originally used a
constant +20° downward three-quarter. For anything mounted above the player that
photographs the mounting plate — the face nobody in the game can see. `asset_093` was
ranked **worst in the set** on the strength of a view that does not exist: from below it
reads correctly as a dome camera. It has been moved from 40th to 28th. Elevation is now
derived per asset from the angle a standing eye makes with it. `asset_087` was re-checked
the same way and did not improve, which is why it kept last place.

**Choosing the camera angle by silhouette area photographed the backs of cabinets.** A flat
slab is the largest projection an object has, so "show the most of it" reliably picked the
one face with nothing on it. The angle is now chosen by visible *internal structure*, which
picks the face that has drawers, muntins and hardware on it.

A fourth, smaller: the first pass audited `Assets/assets_51_100/glb/`, which is the
authoring copy. The runtime loads `vendor/models/assets_51_100/`, and the two have already
drifted.

---

## 9. Incidental defects found

Neither was being looked for and neither is fixed.

* **`asset_096` bulletin board is never visible from any standable position.** It is
  present, `visible === true`, renders correctly when photographed, and scores 0.000% mean
  screen time across all 3,552 poses — the only asset in the room that is drawn and never
  seen. Its centre is at interior-local `(−4.10, 1.20, −5.42)`, past the room's −5.0 back
  wall. Worth a look before anyone spends effort on it.
* **`asset_063` fitting room is gated off in the starter state**, so it is the one asset in
  the population a new player never sees. It was force-shown to photograph it.

---

## Reproducing

```
node tools/qa/proshop-construction-audit.mjs --out Designs/ProShop/Discriminator/data/construction.json
node tools/qa/run-playwright.cjs tools/qa/proshop-screen-time.js
node tools/qa/run-playwright.cjs tools/qa/proshop-asset-contact-sheet.js
node tools/qa/proshop-discriminator-analysis.mjs
node --test tests/proshop-construction-audit.test.js
```

Seed pinned at `20260727` throughout. `data/visual-ranking.json` is the one input that is
not reproducible by running a command; it is a judgement, and it is recorded with its
criteria and a per-asset reason so it can be disagreed with specifically.
