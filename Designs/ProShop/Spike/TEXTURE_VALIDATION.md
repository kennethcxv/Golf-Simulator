# Texture Validation Spike — one asset, before a 20-file pass

Branch `spike/texture-validation`, off `eb2555b`. **Throwaway. Do not merge.**

`BIBLE_VALIDATION.md` concluded that texture presence — not bevel, palette or contact — is
what separates the room's best assets from its worst. This tested that on the same object,
with the same three poses and the same protocol, so it is directly comparable to Arms A–D.

**Result up front: yes, texture explains the gap, and it is not close.** One arm moved the
object further than the previous spike's three arms combined. But it is not a drop-in fix,
and the naive version of it would add roughly **1.7 GB of texture memory**.

---

## Subject, arms and protocol

`asset_065_stockroom_worktable`. Arm A is **reused unchanged** — the control GLB on this
branch is byte-identical (`212b820ef98bc717`) to the build Arm A was shot against.

| Arm | Change |
|---|---|
| **A** | control, untouched |
| **E** | A + albedo, roughness, normal maps. Nothing else. |
| **F** | E + the Arm D geometry fixes (3 mm bevels, corner-cap seating) |

Fixed seed 20260727, 1600 × 900, FOV 66 asserted per frame, clock pinned 13:00, customers
hidden, doors closed, toasts suppressed. Rebuilt through the real Blender pipeline each arm.
**Only asset 065 was touched.**

### Source and licence

**ambientCG.com — Creative Commons CC0 1.0 Universal.** Verified directly at
`https://ambientcg.com/license`:

> *"All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License…
> You can copy, modify, distribute and perform the assets, even for commercial purposes, all
> without asking permission. You can include the raw files in your project, for example a
> video game."*

Attribution is optional. **Commercial use is permitted.** Sets used, 1K JPG, Color +
Roughness + NormalGL: **Wood051** (worktop), **Wood062** (shelf and edge), **Metal032**
(legs, aprons, caps). Extracted to `asset_sources/textures/cc0_spike/`.

---

## 1. Does texture explain the gap?

**Yes.** `bible/compare/whole-table.png` — the control's flat orange-tan worktop and flat
reddish shelf become timber with visible grain; the flat black legs become painted metal
with tonal variation. The object reads as furniture for the first time across seven arms.

For scale: Arms B, C and D changed bevels, palette hex, roughness and contact and left the
object reading as coloured boxes. Arm E changed only the maps and transformed it.

### Two findings that change the shape of the work

**Texture makes geometry defects *more* visible, not less.**
`bible/compare/leg-floor-contact.png` — in the control, the flat tan worktop **hid** the
coplanar corner-cap defect. In Arm E the wood grain makes the same defect obvious as a black
smear across it. In Arm F, seated proud, it reads as a deliberate plate.

**Arm F is the best of all seven arms.** So the geometry pass is not made redundant by
texturing — it becomes *more* necessary, because texture removes the flatness that was
concealing errors. Sequence a defect sweep **with** the texture pass, not instead of one.

### What I got wrong, reported rather than hidden

**The arm drifted off-palette.** My tint multipliers, applied over CC0 colour maps that carry
their own mid-tones, pushed the worktop from light oak to dark walnut and the legs from
near-black to grey. The brass cap reads dark rather than brass — tint `(1.25, 0.98, 0.46)`
over Metal032 at metallic 1 does not land on the palette's `A8823C`. **§8 of the art bible
would fail this arm.**

That is a real result, not just an error: **"apply a map" and "hit the palette" are two
separate jobs**, and the second is where the time goes. The estimate below carries it.

---

## 2. Hours per asset

Measured on this asset, then scaled. Elapsed here is not transferable — this asset has a
committed Python builder, the capture harness already existed, and rebuild is one command.

| Stage | Elapsed here | Hand-authored estimate | Notes |
|---|---|---|---|
| **Sourcing** | ~2 min | **0.5–1.0 h** | Includes licence verification. Per *material family*, not per asset — three sets covered the whole object, and would cover most of sheet_07 |
| **UV work** | ~45 s (verification only) | **0 h for sheet_07/08** | **`TEXCOORD_0` already exists on every mesh.** The builder already unwraps. Budget 1.5–3 h only for assets that turn out not to be unwrapped |
| **Mapping + palette calibration** | ~2 min | **1.5–3.0 h** | The node graph is minutes. Calibrating tints so the textured result lands on the bible palette is the real work, and I did not finish it here |
| **Export + validate** | ~1 min | **0.25 h** | One command; the validator is strict and helpful |
| **Geometry defect sweep** (Arm F) | ~45 s | **0.5–1.0 h** | Newly required, because texture exposes what flatness hid |
| **Total per asset** | **~6 min** | **2.75–5.25 h** | |

**For 20 files: roughly 55–105 hours**, against the 60–120 h you were being asked to
authorise — but see §3, because you should not do all 20.

One process note worth carrying: the repo's validator rejects unpacked textures
(`texture-not-packed`) and is right to — an unpacked image is a path dependency that breaks
when the `.blend` moves. `image.pack()` is required before export.

---

## 3. Do all 20 need it? Ranked by screen time in the pro shop

**No. Roughly half the value sits in six files.** Ranked by how much of the player's view
each occupies *in the pro shop specifically*.

### Tier 1 — high screen time, do these first (6 files)

| Asset | Why |
|---|---|
| **061 front_desk_counter_shell** | The counter is in frame in 4 of the 10 baseline camera poses. Highest screen time in the room |
| **062 back_counter_storage_cabinets** | Directly behind the counter, in every checkout framing |
| **074 broom** | **Held in first person.** Arm's-length magnification is the highest in the game, and it is the Phase 6 benchmark tool |
| **072 mop** | Same — held, and one of the four belt tools |
| **067 clubhouse_lounge_sofa** | Large, in the entrance sightline and the wide overview |
| **070 trophy_display_cabinet** | Player-facing display furniture at eye level |

### Tier 2 — moderate, worth doing after Tier 1 (6 files)

`068 lounge_armchair`, `069 lounge_coffee_table`, `063 pro_shop_fitting_room`,
`075 dustpan`, `076 cleaning_spray_bottle`, `077 cleaning_cloth_and_sponge_set` — the last
three are held in first person but are small and briefly on screen.

### Tier 3 — low priority, defer or skip (8 files)

`064 stockroom_shelving_system`, `065 stockroom_worktable` (**this spike's own subject**),
`066 office_laptop_desk`, `071 vacuum_cleaner`, `073 mop_bucket_and_wringer`,
`078 pressure_washer`, `079 pressure_washer_hose_and_wand`, `080 trash_bag`.

These live in the stockroom, the office, or the cleaning bay — rooms the player passes
through rather than shops in. Note the irony: **the asset I validated on is Tier 3.** I chose
it for testability, not visibility, and that was the right call for a controlled test but it
means the visible payoff of this exact change is small.

**Recommended: 12 files (Tiers 1 and 2), ~33–63 h.** Defer Tier 3 until the room reads.

---

## 4. Does this change the rebuild-vs-edit split?

**Mostly no — it sharpens it, and moves one asset.**

`BIBLE_VALIDATION.md` split on **mesh count**: assets with separable parts can be rescued,
single merged meshes cannot. That holds and is reinforced — texturing a single-mesh blob
still leaves you with one UV island and no part hierarchy to vary material across.

| # | Hero asset | Previous | Now |
|---|---|---|---|
| 1 | Checkout counter | edit + texture | **unchanged** — Tier 1, do first |
| 2 | Cash-register assembly | edit only | **unchanged** — already textured |
| 3 | Laptop workstation | edit + texture | **downgrade to defer** — desk is Tier 3 (office); the laptop itself already uses textured procedural materials |
| 4 | Main wall shelving | edit + texture | **unchanged** |
| 5 | Freestanding merchandise fixture | REBUILD | **unchanged** — 1 mesh |
| 6 | Clothing / hat display | REBUILD | **unchanged** — 1 mesh, plus a missing file |
| 7 | Golf bag display / club wall bay | edit / REBUILD | **unchanged** |
| 8 | Cleaning-tool station | edit + texture | **split** — the *held* tools (broom, mop) move to Tier 1; the *station* furniture drops to Tier 3 |

The one genuine change: **first-person tools deserve priority the earlier ranking missed.**
A broom at arm's length is a larger share of the player's screen than any fixture in the room.

---

## 5. What does this cost in texture memory and draw calls?

Measured live at the entrance-sightline pose, against `BASELINE_PERFORMANCE.md`:

| Metric | Baseline | With 1 textured asset |
|---|---|---|
| Textures in memory | 297 | **308** (+11) |
| 1024² textures | 23 | **39** (+16) |
| Draw calls | ~3,015 | **2,445** — no increase |
| Shader programs | 244 | **239** — no increase |
| **Est. texture memory, this asset alone** | — | **85.3 MB** |

### The headline risk

**Draw calls and programs do not move — texture memory does, catastrophically.**

One asset with nine embedded 1K maps added **~85 MB** of estimated resident texture memory
and grew the GLB from **70 KB to 10.7 MB (152×)**. Extrapolated naively:

| Approach | Est. texture memory, 20 files |
|---|---|
| Per-asset embedded 1K (what this spike did) | **~1.7 GB — unacceptable** |
| Per-asset embedded 512² | ~425 MB — still unacceptable |
| Per-asset embedded 256² | ~106 MB — borderline |
| **Shared library, ~12 images total, 512²** | **~13 MB — the answer** |

**The fix is not smaller textures, it is shared ones.** These 20 assets need perhaps four
material families between them — oak, walnut, powder-coated metal, brass. If every asset
embeds its own copy, the cost multiplies by 20 for no visual gain. If they share one library,
it is paid once.

Two things stand in the way today, both worth fixing before the pass rather than after:

* Assets 61–100 load through the **plain uncached `GLTFLoader`** (`clubhouse.js:1133`), so
  embedded copies are not deduplicated across files.
* `sharedTexturePool.js` interns textures by named family, but only for **merch-loaded**
  roots. It does not cover this path.

**Recommendation: extend the shared texture pool to the props path, and reference a shared
material library rather than embedding per asset — before texturing file number two.**
Doing 12 files the way I did this one would add roughly a gigabyte for no benefit.

Also note this is measured on an RTX 5080 with 16 GB of VRAM. On a minimum-spec machine the
naive approach would not merely be wasteful, it would not fit.

---

## Verdict

1. **Texture is the answer.** It moved the asset further than bevel, palette and contact
   combined, and `BIBLE_VALIDATION.md`'s conclusion holds.
2. **But it is not just "apply a map."** Palette recalibration is the real cost, and a
   geometry defect sweep becomes *more* necessary once flatness stops hiding errors.
3. **Do 12 files, not 20** — Tiers 1 and 2, ~33–63 h.
4. **Solve texture sharing first.** Otherwise the pass costs ~1.7 GB of VRAM and buys nothing
   that a shared library would not buy for ~13 MB.

---
---

# Addendum — does calibration keep the improvement?

Added 2026-07-27 on `feature/pro-shop-vertical-slice`. **This document is no longer a
throwaway.** The spike branch was never merged, but the arms above are the evidence base for
the texture decision, so the file was brought over from `7e0c6cd` and this addendum attached
to it.

## The question

The arms above validated the texture thesis, and every one of them was **raw untinted
ambientCG photographs** — not by design, but because Blender 5.1's exporter silently dropped
the base-colour tint. ART_BIBLE §7.4.1 calibration collapses those maps to luminance and
multiplies by one palette colour, which removes every hue difference between grain lines.
So: does the calibrated asset keep the improvement?

## New arms

| Arm | Pipeline | GLB | Resident |
|---|---|---|---|
| **A** | untextured — flat palette materials, the control | 68 KB | 0 |
| **F** | raw CC0 albedo, **tint dropped on export** | 3.00 MB | 12.0 MB |
| **I** | calibrated albedo + solved `baseColorFactor` | 2.58 MB | 12.0 MB |

Arms A and I were rebuilt through the real Blender pipeline for this addendum. Arm F is the
GLB that was shipping on this branch before the fix, preserved byte-for-byte at
`Designs/ProShop/Spike/armF_reference/asset_065_armF.glb` so the comparison stays
reproducible after the tree moved on. All three shot by `tools/qa/spike-bible-arm.js` at seed
20260727, FOV asserted per frame, customers hidden, doors closed.

**The defect Arm I fixes.** Blender's glTF exporter recognises a base-colour factor from
exactly one node pattern (`search_node_tree.py::get_multiply_factors`): `ShaderNodeMix`,
`data_type` RGBA, `blend_type` MULTIPLY, `Factor` a constant 1.0. The builder used
`ShaderNodeMixRGB`, whose node type is `MIX_RGB`. Both render identically in Blender's
viewport. Every tint was dropped, and all four textured materials shipped with no
`baseColorFactor`, which glTF defines as (1,1,1,1). `tests/proshop-basecolor-factor.test.js`
now fails on that, and was verified against the pre-fix tree, where it does.

---

## Part 1 — Arm I vs Arm A: does calibrated texture still beat untextured?

**Yes, and by more than the raw-photo arm did.**

Plates: `bible/compare/cal-worktop-surface.png` (worktop at 2x),
`bible/compare/cal-worktop-leg.png` (leg and lower shelf at 2x).

Measured on a pure-surface region of the worktop, same camera, all three arms
(`compare_arms.py --surface A F I`; the sampled regions are saved to
`bible/compare/surface-regions.png` so the boxes can be checked rather than trusted):

| Arm | Worktop mean | Gap to §8 medium walnut | **detail** |
|---|---|---|---|
| A untextured | `#B68E62` | 114.0 | **0.97** |
| F raw, tint dropped | `#4A3F38` | 36.0 | **2.16** |
| **I calibrated** | `#6E503B` | **13.4** | **3.02** |

`detail` is the standard deviation of the region after subtracting a Gaussian blur of itself
— the blur keeps the lighting gradient and discards the grain, so the residual is grain
alone. An untextured surface scores near zero on it by construction, and Arm A does (0.97).
A total-variance number would not have worked: Arm A's *spread* is 43.1, only marginally
below Arm I's 46.4, because both are dominated by the same light falling across the same
surface.

**Arm I carries 3.1x the surface detail of the untextured control, and 1.4x that of the
raw-photo arm.** By eye on the crops the difference is not subtle: Arm A's worktop is a
smooth orange gradient with no incident whatsoever; Arm I's has legible grain lines running
its length.

**Calibration made the grain more visible, not less, and the reason is worth keeping.**
Exposure normalisation preserves contrast *ratio* exactly — that is why it was chosen. But
the sRGB transfer curve is steeply compressive near black. Wood051's raw mean luminance is
0.0388 linear; medium walnut's red channel sits at 0.147. The same 1.95 ratio spans about 17
code values at the first and about 33 at the second. Arm F's grain was not absent, it was
crushed into the bottom of the curve.

---

## Part 2 — Arm I vs Arm F: how much of F's improvement survives?

**All of it on the wood, and the metal improves for a different reason.**

Whole-frame pixel differences, same camera (`compare_arms.py A F I`), meanAbs of 255:

| Pair | three-quarter | front-elevation | floor-contact |
|---|---|---|---|
| A vs F | 4.99 | 3.73 | 2.92 |
| A vs I | 3.30 | 2.55 | 1.84 |
| F vs I | 2.86 | 2.36 | 1.48 |

Reported for completeness, and they should not be read as a ranking. A mean absolute
difference cannot separate *detail that was added* from *colour that moved*, and between A
and I both happened at once. The crops are the instrument; this table only establishes that
the arms are genuinely different from one another.

**The visible change is the legs.** Arm F's legs render as a pale blue-grey — the raw
Metal032 photograph, untinted, reading as painted aluminium in a room whose §8 value for that
part is black powder-coat `#1C1E1F`. Measured on the leg region: Arm F `#3A3E3D` at luminance
60.8, Arm A `#040403` at 3.9, Arm I `#010101` at 1.0. On the plate the Arm F worktable looks
like it came from a different game. That is the dropped tint, and it is the single largest
visual defect in the arm that validated the texture thesis.

### The finding that changes §7.4.1

The same leg measurement carries a result calibration was not expected to produce:

| Region | A | F | **I** |
|---|---|---|---|
| worktop `detail` | 0.97 | 2.16 | **3.02** |
| leg `detail` | 0.28 | 2.05 | **0.09** |

**The calibrated leg carries less visible variation than the untextured control.** Its map is
invisible. Arm F's 2.05 is not texture showing through — it is the wrong colour showing
through, a pale surface where a near-black one belongs.

This is not a calibration bug; it is arithmetic §7.4.1 did not account for. Visible grain
depends on the source's contrast ratio **and** on how bright the palette target is, through
the same sRGB compression that helped the worktop. Predicted span in code values, from
`cc0_calibrate.py --emit 065`:

| Material | Source | Source contrast | §8 target | **Visible span** |
|---|---|---|---|---|
| MediumWalnut | Wood051 | 1.95 | `#6B4A2F` | **33.1** |
| DarkWalnut | Wood062 | 3.17 | `#3E2A1B` | **34.5** |
| BlackPowderCoat | Metal032 | 1.14 | `#1C1E1F` | **2.4** |
| MutedBrass | Metal032 | 1.14 | `#A8823C` | **9.7** |

The last two rows are the same photograph at the same contrast, and they differ by 4x. **A
gate on source contrast alone cannot tell them apart** — which is what §7.4.1 shipped with.
The gate is now on the product, and 2.4 code values is below any threshold at which a
difference is visible.

**Consequence for the Tier 1 pass: do not spend texture budget on black powder-coat
surfaces.** Racks, brackets, shelf standards and stands are all `#1C1E1F` per §8. Whatever
map goes on them will be invisible. That is three maps per family not worth authoring,
downloading, storing or paying VRAM for.

---

## Part 3 — does Arm I read as the same production as the reception counter?

**No. They read as two different games — and it is the counter that is wrong.**

Plate: `bible/compare/palette-calibration-worktop.png`, the [V] gate §7.4.1 asks for.

**A note on the plate.** The gate specifies both surfaces in one frame. One frame is not
possible: `LegacyServicePartition_x_5.7_0` is a solid wall between the stockroom and the shop
floor, and `tools/qa/proshop-counter-worktop-sightline.js` raycast six candidate camera
positions — the partition is the first hit on every sightline to the worktop from the shop
side. The plate is therefore a **matched-camera pair**: identical 1.6 yd standoff, identical
eye height, identical lens, cameras computed from each subject's live bounding box rather
than typed in, and asserted equal in `arm.json`. Pitch differs by 0.107 rad, which is exactly
the two surfaces' own height difference. The substitution is printed on the plate.

**The measurement.** `tools/qa/proshop-counter-material-audit.js` reads every material on the
counter run out of the running game:

```
reception counter run (asset_061):   0/6  materials textured
back counter         (asset_062):   0/7  materials textured
stockroom worktable  (asset_065):   4/15 materials textured
```

**The reception counter has no maps at all.** Not low-resolution, not uncalibrated — none.
Its `detail` reads 15.7 only because the sampled band crosses the counter's own moulding
lines; the field between them is a flat gradient, visible at 2x in
`bible/compare/cal-counter-surface.png`.

So the [V] gate's premise does not hold. It was written as "both are medium walnut; if they
read as two different woods, calibration failed." They do read as two different woods, and
neither half of the premise survives contact:

* The counter **top** is `MAT_PH_NaturalOak` `#B98A59` — 109 away from §8 medium walnut. It
  is the carcass below that carries `MAT_PH_MediumWalnut` `#704934`.
* The counter is untextured, so the comparison is not calibrated wood against uncalibrated
  wood. It is **textured wood against no wood**.

**Which one is wrong: the counter.** ART_BIBLE §1 names the reception counter as the
best-in-room anchor and §7.4 requires texture on hero surfaces. The largest hero surface in
the room has none. Arm I is the asset behaving correctly; the counter is the asset that has
not had the pass yet. It is `asset_061`, already inside Tier 1.

**Sequencing consequence, and it is not free.** Until the counter is textured, the stockroom
worktable is the only surface in the room carrying grain, and it looks conspicuously out of
place — the inconsistency is real, and a reviewer walking the room will see it. **Texture
`asset_061` and `asset_062` first**, not last, so the room converges through the pass rather
than diverging through the middle of it.

---

## Verdict

1. **Calibration keeps the improvement, and increases it on wood.** 3.02 detail against 0.97
   untextured and 2.16 raw. §7.4.1 does not need rethinking on its main claim.
2. **It fixes a large defect the raw arm shipped** — legs reading as pale aluminium instead
   of black powder-coat, because the tint never reached the GLB.
3. **§7.4.1 needed one correction, now made.** Its acceptance gate tested source contrast,
   which cannot distinguish a map that will be visible from one that will not. The gate is
   now on predicted visible span, and it rules out texturing black powder-coat entirely.
4. **The [V] gate's premise was wrong about the room.** The counter is untextured. The answer
   to "which one is wrong" is the counter, and it should be textured first.

## Corrections to earlier work on this branch

* **`ART_BIBLE.md` §7.3 and `TEXTURE_MEMORY_POLICY.md` §1 claimed the reception counter
  supplies 701 texels/yd.** It supplies none — it has no textures. The 701 figure came from
  an unnamed 1024x640 map behind the counter that the probe's ray reached instead. A surface
  with no texture is invisible to a texel-density probe, which walks past it to whatever is
  behind. The *requirement* curve is unaffected — it is measured from the camera and the
  display, not from the surface — so the 768 texels/yd hero ceiling stands. Both documents
  are corrected.
* **`Metal032` was flagged as failing the §7.4.1 contrast gate at 1.14.** Still true, and it
  now has a measured visible consequence. The right response is not a replacement source: it
  is not to texture black powder-coat at all.

## Reproducing

```bash
python tools/blender/cc0_calibrate.py --emit 065
blender --background --factory-startup --python tools/blender/build_assets_61_70.py -- --asset 65
blender --background --factory-startup --python tools/blender/build_assets_61_70.py -- --asset 65 --untextured
node tools/blender/pack_ktx2.mjs --in <runtime.glb> --out <runtime.glb> --max-size 512 --no-compress

node tools/serve.cjs                                                     # port 8457
ARM=I node tools/qa/run-playwright.cjs tools/qa/spike-bible-arm.js
node tools/qa/run-playwright.cjs tools/qa/proshop-counter-material-audit.js
node tools/qa/run-playwright.cjs tools/qa/proshop-counter-worktop-sightline.js

python Designs/ProShop/Spike/compare_arms.py A F I
python Designs/ProShop/Spike/compare_arms.py --surface A F I
python Designs/ProShop/Spike/bible_crops.py A F I
```
