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
