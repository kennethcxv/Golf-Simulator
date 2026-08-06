# P1 — the texture pass, 19 files, one block

Status: **done**. All 19 rebuilt, packed, verified and committed together. Suite 2791/0.

The brief: *"All 19 or zero. Per asset: CC0 sourced, UV, mapped, on-palette per ART_BIBLE
§7.4.1, through the shared pool and resolution ceiling. Report texture memory against the
150 MB threshold before and after. Screenshot each against its untextured version."*

The 19 are sheet 07's `061-064, 066-070` (065 was already textured and is untouched) and
sheet 08's `071-080`. The builders also publish 8 first-person variants of the sheet-08
tools; those rebuilt with the same materials and are included, so **27 files** ship.

---

## 1. What was actually built

### Colour does not move; only surface arrives

`tools/blender/palette.py` records that silently retinting already-shipped assets is not a
texture change, and it is right. So the pass is strictly additive: the builder keeps
authoring the colour it always authored, and the tint that multiplies the photograph is
**solved from that colour** at build time (`assets_51_100_lib.py`, `cc0_plan`). Nothing was
copied into a second table, so nothing can drift, and adding a map to a slot cannot change
the value it ships.

That inverts how 065 was done. 065 planned one asset against a written-down §8 target;
that does not scale to forty-odd authored colours across two sheets. The new
`cc0_calibrate.py --emit-family-stats` measures the **source** once and lets each builder
solve its own tint.

### Two modes, and which one a slot gets is measured

- **albedo** — the calibrated (desaturated, exposure-normalised) map multiplied by the
  solved tint, so the shipped mean lands exactly on the authored colour and grain rides on
  top. Plus normal and roughness.
- **surface** — normal and roughness only, over the flat authored colour.

The gate is `visible_span`: how many sRGB code values the grain spans **on this target**.
Not the source's contrast ratio — contrast survives calibration exactly, but the sRGB curve
is steeply compressive near black, so the same ratio spans ~48 code values on dark walnut
and ~3 on powder-coat. Threshold 8.

Surface mode is not a consolation prize. Matte rubber, powder-coat and moulded plastic carry
their character in surface response, not albedo variation; a base-colour map there costs
memory and changes nothing.

The Blender-side restatement of that gate was **cross-checked against the numpy original**
and agrees to 0.05 code values. Without that check the gate is an assertion.

### Sources

Three families existed (Wood051, Wood062, Metal032 — the 065 spike). Five were added, all
CC0 1.0 from ambientCG, fetched reproducibly by the new `tools/blender/fetch_cc0.py`, which
writes provenance to `asset_sources/textures/cc0_spike/SOURCES.json`.

| family | role |
|---|---|
| Wood051 | light oak — worktops, shelf boards |
| Wood062 | dark walnut — casework, tool handles |
| Metal032 | brass and powder-coat |
| **Leather011** | upholstery leather |
| **Fabric030** | curtain, mop yarn, bristle, microfibre |
| **Rubber004** | hose, matte mouldings, polythene |
| **PaintedMetal001** | painted service equipment |
| **Foam001** | sponge |

**Seven candidates were rejected on measurement**, recorded in `SOURCES.json`. The one worth
naming: `Plastic010` was the obvious pick for the machine shells and is **inert on both
channels** — albedo contrast 1.01, normal-map relief 0.0061. It would have cost 2.8 MB and
changed nothing on screen. `PaintedMetal001` carries 7× the relief for the same price.
`Fabric063`/`Fabric064` were rejected because their normalised means (0.518, 0.519) are still
too dark to carry a cream target by multiplication.

---

## 2. Two exporter defects, both found by reading the GLB back

**The roughness modulation was fiction.** The first implementation centred the map on the
authored roughness with `SUBTRACT → MULTIPLY → ADD`. It rendered correctly in Blender and
exported as the **raw map with no `roughnessFactor` at all** — the exporter matched "there is
a roughness image upstream" and discarded the arithmetic. A 0.52 walnut would have shipped
across the map's full range.

glTF defines `roughness = roughnessFactor × texture.g`, a multiply with no offset, so the only
expressible form is `factor = authored / mapMean`. That is now what ships, and the exported
factors match the offline solve exactly (0.994, 0.768, 0.723, 0.856, 0.784 on asset 061).

**That solve also rules 14 of 23 slots out.** Where `mapMean < authored`, multiply can only
smooth the surface further — a roughness map dragging a 0.93 sponge to 0.17 is a visible
regression. Those slots ship their flat authored roughness and no roughness map.

The base-colour half held: every albedo material ships a real `baseColorFactor`, as
`tests/proshop-basecolor-factor.test.js` demands.

---

## 3. The gate can measure visibility; it cannot measure appropriateness

`bucket_yellow` passed the albedo gate at span 39.2 and looked **wrong** — PaintedMetal001's
chipped-paint albedo on a moulded polypropylene bucket reads as staining, not wear. The
armchair's leather at UV scale 3.0 read as bubble-wrap quilting rather than grain.

Both were caught by looking at the renders, not by any number. Fixed by:

- leather UV 3.0 → 9.0
- an explicit `texture_mode="surface"` on the five moulded-plastic slots
  (`bucket_yellow`, `caution_black`, `bottle_white`, `trigger_green`, `safety_yellow`),
  each with its reason recorded in the builder and in the GLB's material extras

The reason lives in the builder rather than in a nudged threshold, because the threshold is
answering a different question and should keep answering it honestly.

---

## 4. Texture memory against the 150 MB threshold

Measured live in Electron through the running game, by
`tools/qa/proshop-texture-infrastructure.js` — the instrument §3's reopen condition is
written against.

| | interior slice | whole scene | distinct sources | above the 512² ceiling |
|---|---|---|---|---|
| before the pass | **155.3 MB** | 552.2 MB | 166 | 85.8 MB |
| after the pass | 199.3 MB | 596.2 MB | 199 | 85.8 MB |
| after + source sharing | **170.0 MB** | 566.9 MB | 177 | 85.8 MB |

**The threshold was already exceeded before this pass — 155.3 MB.** That is a pre-existing
condition, not something the pass created. The pass adds **+14.7 MB**.

Nothing the pass adds is above the resolution ceiling: `aboveCeilingMB` is identical in every
row. Every new map is 512², applied by `pack_ktx2.mjs --max-size 512 --no-compress` (KTX2
stays off per §3 — it needs a CSP relaxation this app has not adopted).

### The 29.3 MB the pass recovered

The first measurement was +44.0 MB for only 20 distinct images. The cause was in
`sharedTexturePool.js`: it shares whole `Texture` objects, so `repeat`/`offset` **must** be in
its key — replacing a texture tiled 2.4× with one tiled 6.0× would silently retile the asset.
But the GPU does not key on those at all; they are shader uniforms. So a world tool and its
first-person variant, tiling the same walnut at different scales, uploaded the same image
twice for no reason.

Added a second tier that shares the `Source` instead of the `Texture` — the decoded image
becomes one object while `repeat`/`offset` stay per-texture. **44.0 MB → 14.7 MB.** This also
helps the pre-existing baseline, and it is measured live rather than taken from the pool's own
displacement counter, which `TEXTURE_MEMORY_POLICY.md` records as over-reporting by ~25×.

### Static accounting, both bounds

`tools/blender/texture_footprint.mjs` (new) reports deduped and per-file bounds, because
quoting only the flattering one is the mistake the policy already documents. Sheets 07+08:
**12.00 MB → 26.67 MB deduped**, 20 distinct 512² sources, 20/20 files textured. The 12.00 MB
baseline reproduces the number the policy independently recorded for 065 — the instrument
agrees with a known value before it is used on an unknown one.

---

## 5. Screenshots — every asset against its untextured self

`tools/qa/p1-texture-pairs.js`, under Electron. The "before" half is not a memory: it is the
exact bytes git holds at HEAD for the same file, loaded into the same scene, at the same
camera, under the same lights, in the runtime renderer.

Renders in `qa/p1-texture/pairs/` (27 pairs), contact sheet at `qa/p1-texture/contact-after.png`.

**Negative control:** every asset is also compared against *itself* — the textured render
captured twice. Every self-pair returns 0.00%, so the differ is not reporting its own noise.

`changed` is the percentage of the pixels the object **covers**, not of the frame. The frame
was the wrong denominator and said so loudly: the pressure-washer hose first reported
`0.00%` because it is a thin dark line on a dark ground. It genuinely changes over 10.7% of
its own surface. That is the fourth time this cycle the instrument, not the game, was wrong.

| asset | changed | mean delta | control |
|---|---|---|---|
| `asset_068_lounge_armchair_sheet07` | 82.6% | 15.4 | 0 |
| `asset_069_lounge_coffee_table_sheet07` | 80.8% | 12.8 | 0 |
| `asset_077_cleaning_cloth_and_sponge_set` | 79.2% | 16.9 | 0 |
| `asset_070_trophy_display_cabinet` | 77.2% | 23.8 | 0 |
| `asset_066_office_laptop_desk` | 76.7% | 11.1 | 0 |
| `asset_067_clubhouse_lounge_sofa` | 74.1% | 10.4 | 0 |
| `asset_061_front_desk_counter_shell` | 73.1% | 9.5 | 0 |
| `asset_077_cleaning_cloth_and_sponge_set_fp` | 69.0% | 10.7 | 0 |
| `asset_062_back_counter_storage_cabinets` | 64.0% | 7.7 | 0 |
| `asset_074_broom_fp` | 58.1% | 7.9 | 0 |
| `asset_074_broom` | 55.3% | 7.7 | 0.01 |
| `asset_064_stockroom_shelving_system` | 43.2% | 6.2 | 0 |
| `asset_072_mop` | 38.4% | 5.6 | 0 |
| `asset_080_trash_bag` | 38.0% | 4.5 | 0 |
| `asset_080_trash_bag_fp` | 38.0% | 4.5 | 0 |
| `asset_072_mop_fp` | 37.1% | 5.3 | 0 |
| `asset_071_vacuum_cleaner` | 36.8% | 4.3 | 0 |
| `asset_078_pressure_washer` | 30.5% | 4.0 | 0 |
| `asset_063_pro_shop_fitting_room` | 29.7% | 2.6 | 0 |
| `asset_071_vacuum_cleaner_fp` | 24.4% | 2.6 | 0 |
| `asset_075_dustpan_fp` | 20.2% | 2.3 | 0 |
| `asset_075_dustpan` | 18.7% | 2.2 | 0 |
| `asset_076_cleaning_spray_bottle_fp` | 17.7% | 2.1 | 0 |
| `asset_073_mop_bucket_and_wringer` | 17.3% | 11.8 | 0 |
| `asset_076_cleaning_spray_bottle` | 16.8% | 2.0 | 0 |
| `asset_079_pressure_washer_hose_and_wand_fp` | 12.3% | 1.6 | 0 |
| `asset_079_pressure_washer_hose_and_wand` | 10.7% | 1.5 | 0 |

Median 38.0%. The floor is the dark rubber assets, which is the sRGB physics the gate already
predicted, not a failure to apply the pass — those assets carry relief, not albedo.

---

## 6. Geometry is untouched, and that is checked

- `gripToFloorYd` regenerated from the rebuilt broom: **1.2472016341042276**, the same
  authority value as before the pass. A material change that moved geometry would move this.
- The part-visibility sweep re-run over the new bytes: **the same 12 flagged parts**, all
  already whitelisted with reasons. No part became buried or unburied.
- Both were stale-evidence gates that correctly failed on rebuilt GLBs; both were regenerated
  rather than relaxed.

---

## 7. Left permanent

- `tests/proshop-cc0-texture-pass.test.js` (new, 4 tests) — every sheet 07/08 asset carries
  maps; every textured material records its family, mode and the reason for that mode; albedo
  and surface modes actually ship what they claim; sources are present and attributed as CC0;
  the statistics the builders divide by are non-zero. The pass cannot silently come undone.
- `tools/blender/fetch_cc0.py` — reproducible CC0 sourcing with provenance.
- `tools/blender/texture_footprint.mjs` — static footprint, both bounds.
- `tools/qa/p1-texture-pairs.js` — the before/after harness, with its self-pair control.
- `tools/qa/proshop-part-visibility.js` and `proshop-texture-infrastructure.js` now resolve
  their URLs against `document.baseURI` and skip the navigation when already on `file://`,
  so both run under Electron with no HTTP server. They previously required one.

## 8. Not done

- **A8** (broom hand pose and sleeves) remains open by instruction — reserved for the user's
  own grading, not to be marked complete here.
- **The 150 MB reopen condition is live and was live before this pass** (155.3 MB baseline,
  170.0 MB now). The lever it points at is KTX2, which needs full `'unsafe-eval'` in the CSP.
  That decision is the user's and nothing here depends on it. The cheaper levers, if wanted:
  drop `Foam001` (serves only asset 077, ~4 MB), drop `Leather011` (serves 067/068, ~4 MB), or
  extend source-sharing to the pre-existing 85.8 MB of above-ceiling textures, which is 5×
  larger than anything this pass added.
