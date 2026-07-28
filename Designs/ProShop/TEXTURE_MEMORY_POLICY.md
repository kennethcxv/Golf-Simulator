# Texture memory policy — three levers

Status: **infrastructure built and validated on one asset.** Not a proposal.
Branch: `feature/pro-shop-vertical-slice`. Date: 2026-07-27.

The 12-file Tier 1 texture pass was blocked on a projected texture-memory cost. This
document reports what each of the three available levers actually buys, measured rather
than estimated, and what is still a decision for a human.

---

## 0. The measured unit

Everything below is anchored on one real asset rather than an assumption.

`asset_065` (stockroom worktable), rebuilt through the Blender builder on this branch,
is **byte-identical to the `Spike/TEXTURE_VALIDATION.md` Arm F GLB**
(`sha256 ed8f78e7…82467`, 10,730,792 bytes). That determinism is what makes it usable as
a control.

It carries **9 embedded images** — three CC0 material families (Wood051, Wood062,
Metal032), each contributing albedo, metallicRoughness and normal. All 1024².

| Config | Bytes/texel | Per map (1024², + mip chain) | asset_065 total |
|---|---|---|---|
| 1024² RGBA8 | 4 | 5.33 MB | **48.0 MB** |
| 512² RGBA8 | 4 | 1.33 MB | **12.0 MB** |
| 1024² BC7 | 1 | 1.33 MB | 12.0 MB |
| 512² BC7 | 1 | 0.33 MB | **3.0 MB** |

The 48.0 MB, 12.0 MB and 3.0 MB figures are read from the shipped GLBs, not computed
from a spreadsheet. The shipped 12.0 MB is confirmed independently in the running game:
`tools/qa/proshop-texture-infrastructure.js` reports asset_065 at **9 sources, 12.00 MB**.

> **Count sources, not textures.** The live probe first reported 16 textures and 21.33 MB
> for the same asset. That was an instrumentation error. three.js keys GPU uploads on
> `(Source, texture-parameter key)` — `WebGLTextures` at `three.module.js:11729` — and the
> parameter key does **not** include `repeat`/`offset`, which are shader uniforms rather
> than sampler state. The GLB's 12 texture definitions are clones of 9 images differing
> only in their `KHR_texture_transform`, so they cost **9** uploads, not 12 and not 16.
> Counting `Texture` instances over-reports. All three probes now key on `source.uuid`,
> after which the live figure and the file agree exactly.

> **Correction to an earlier number.** I previously projected ~85 MB per asset and
> ~1.7 GB for a 20-file pass. The measured figure is 48 MB per asset, so the naive
> 20-file projection was ~960 MB. The conclusion — that the naive path is unaffordable —
> is unchanged, but the number was 1.8× too pessimistic.

---

## 1. Resolution

**What it is.** Fewer texels. Applied to the runtime GLB by
`tools/blender/pack_ktx2.mjs --max-size 512`.

**Justification is measured, not conventional.** `tools/qa/proshop-texel-density.js`
casts three rays per sample — the pixel, one right, one down — and reads back both the
world hit point and the UV, giving `pixelsPerYard` (what the display resolves) and
`texelsPerYard` (what the asset supplies) at the same surface point. The analytic
prediction `H / (2 d tan(fov/2))` agrees with the ray measurement to within 1 % at 2 yd
(346 vs 350), so the instrument is sound.

| Standoff | `pixelsPerYard` required |
|---|---|
| 0.5 yd (collision-limited closest approach; body radius is 0.34 yd) | 767 |
| 1 yd | 693 |
| 2 yd | 350 |
| 3 yd | 237 |

Adopted ceiling: **768 texels/yd for hero surfaces, 384 standing, 256 background** — see
`ART_BIBLE.md` §7.3 for the full table and the tile-size derivation.

**Verified against a real surface.**

* The rebuilt `asset_065` worktop at 512² supplies **1029 texels/yd** against **646**
  required at its closest approach — 1.6× headroom, minimum mip 0.67, so mip 0 is never
  sampled. At 256² it would supply 514 and go under at arm's length.

So 512² is the right ceiling by measurement. It is not a rounding.

> **Correction, 2026-07-27.** This section previously offered a second anchor: that the
> reception counter supplies **701 texels/yd** against 767 needed. The counter has **no
> textures at all** (`tools/qa/proshop-counter-material-audit.js`: 0 of 6 materials). The
> 701 came from an unnamed 1024×640 map behind it — an untextured surface has no UV
> derivative, so a texel-density sample passes through it to whatever is behind. The
> ceiling itself is unaffected: the requirement curve is a property of the camera and the
> display, not of any surface. See `Spike/TEXTURE_VALIDATION.md` addendum.

**What it buys: 4×.**

---

## 2. Sharing

**What it is.** One texture instance per (image, sampler state) across every GLB in the
build, rather than per file. `src/render3d/sharedTexturePool.js`.

glTF preserves image names — Blender writes the datablock name into `images[i].name` and
GLTFLoader copies it onto `texture.name` — so source identity survives the round trip and
can key a pool. Verified on the real GLB: its nine images are named `Wood051_1K-JPG_Color`
and so on.

The sampler state is part of the key and that is load-bearing. three.js keeps `repeat`,
`offset`, `rotation` and the wrap modes on the **Texture**, not the Material, so two
assets tiling the same walnut at different scales genuinely need two instances and
collapsing them would silently retile one. This is why the pass must standardise tile size
per material family: standardising is what makes sharing pay, not merely permits it.

`clubhouse.js`'s props loader moved from the bare `GLTFLoader` to `CachedGLTFLoader`,
which is what puts sheet_07/08 on this path at all.

**What it buys today: 6.6 MB, 1.2 %.** Measured by
`tools/qa/proshop-texture-sharing-ab.js`, which loads the same seed twice — interning off,
then on — and compares what the renderer actually holds.

**I had to correct my own instrumentation here.** The pool's internal counter reported
166 MB "avoided". The A/B says 6.6 MB. The counter over-reports by ~25× because a
displaced texture that would never have been uploaded frees nothing. It is now named
`displacedBytes`, documented as an upper bound, and the A/B is named as the authority.

**1.2 % is the expected result, not a disappointing one.** sheet_07 and sheet_08 embed no
textures at all today, so there is nothing yet for them to share. The lever's value is
entirely prospective — and retrofitting it after twelve files ship means rebuilding
twelve files.

**What it buys on the Tier 1 pass: 5.1×**, under the family assumption in §4.

---

## 3. Format — KTX2/Basis — **REJECTED**

> **Decision, 2026-07-27: rejected. Do not pursue.**
>
> Sharing plus the resolution ceiling project the twelve-file Tier 1 pass to **~28 MB**.
> That is not a problem. The format lever buys 4× on a number that is already fine, and
> the price is full `'unsafe-eval'` in a shipping Electron application. The trade is not
> worth taking.
>
> **The `'wasm-unsafe-eval'` CSP change has been reverted.** `index.html` carries no eval
> relaxation of any kind. The KTX2 runtime path is dormant behind an explicit opt-in
> (`globalThis.__FW_ENABLE_KTX2`) and attaches no loader by default.
>
> **Condition that reopens this:** measured texture memory on the full slice exceeding
> **150 MB**. Measure it with `tools/qa/proshop-texture-infrastructure.js`, which reports
> resident bytes keyed on texture *sources* at two scopes and evaluates the condition
> directly; do not reopen on a projection.
>
> **Measured position on the day the decision was taken:**
>
> | Scope | Resident | Above the §7.3 512 ceiling |
> |---|---|---|
> | Slice — clubhouse interior | **148.8 MB** | 43 maps, **81.7 MB** |
> | Whole scene — incl. course, sky, terrain | 547.0 MB | 84 maps, 463.5 MB |
>
> Two things follow, and neither changes the decision.
>
> **The slice is 1.2 MB under its own threshold before the Tier 1 pass has started.** It
> will cross 150 MB during the pass. That is expected and is not a reason to reopen: 81.7 MB
> of the slice sits above the resolution ceiling this policy already adopted, so the lever
> that is kept has more headroom left in the room than the lever that was rejected would
> buy. **Spend the resolution lever on the existing 81.7 MB before reconsidering format.**
>
> **The real texture-memory problem in this game is outside the slice.** 256 MB of the
> scene's 547 MB is twelve 2048² `tripo_image_*` maps on AI-generated course models — one
> asset family costing more than the entire pro shop. It is out of scope here and named so
> it is not mistaken for slice cost.

The measurements below are kept because they are what the decision rests on, and because
a reopen should not have to re-derive them.

**What it is.** The texture stays GPU-compressed all the way onto the card. This is the
only lever that changes resident bytes per texel; PNG vs JPEG changes download size only,
because the GPU is handed decoded RGBA either way.

**Encode: working, no native binary required.** `ktx2-encoder` (wasm) plus `sharp`, driven
by `tools/blender/pack_ktx2.mjs`. `@gltf-transform/cli` was evaluated and rejected: its
`etc1s`/`uastc` commands shell out to KTX-Software's `ktx` binary, which is not installed
and would be a native dependency. Encode cost for asset_065's nine maps: **7.6 s**.

Codec follows the slot: ETC1S for base colour and emissive, UASTC for normals (ETC1S
picks block endpoints for perceptual colour, which is the wrong objective for geometry),
ETC1S for metallicRoughness.

**Transcode: 4×, not 8×.** three.js r185's `KTX2Loader` priority list is ASTC → BPTC →
S3TC. This machine reports **BPTC available**, so *both* ETC1S and UASTC transcode to
**BC7 at 1 byte/texel**. BC1 at 0.5 bytes/texel is only reached when BPTC is absent, so
an "ETC1S gives 8×" assumption would be wrong on every GPU this game targets.

**Measured on asset_065:** GLB 10.23 MB → **0.97 MB**; resident 48.0 MB → **3.0 MB**
combined with the resolution ceiling, a **16×** reduction.

### The blocker that decided it

KTX2 cannot run under this app's Content Security Policy. Two distinct violations appear
when a compressed asset loads, and they need different relaxations:

1. `WebAssembly.instantiate` is refused. Clearing this needs **`'wasm-unsafe-eval'`** —
   the narrow keyword, which permits WASM compilation only and still forbids JavaScript
   `eval()` and `Function()`.
2. With that cleared, the next one fires: `EvalError: Evaluating a string as JavaScript`.
   This needs full **`'unsafe-eval'`**, document-wide. The cause is specific and not
   configurable: three.js ships Binomial's Emscripten **embind** build of the Basis
   transcoder, and embind's `craftInvokerFunction` constructs its invokers dynamically
   from a string — `vendor/addons/libs/basis/basis_transcoder.js` offset 33264,
   `newFunc(Function, args)`. It is not three.js's own code.

Narrower alternatives, all dead ends:

* Confining the relaxation to the transcoder's Web Worker via a per-response CSP header —
  works over HTTP, fails in the packaged Electron app, which loads from `file://` where
  no headers are sent.
* A non-embind Basis build — Binomial does not publish one.
* Transcoding without the worker — `KTX2Loader` has no such path.

So the cost of the format lever is not one line of config; it is re-enabling dynamic code
evaluation for the entire document, permanently, in a shipping desktop application. Set
against a 28 MB → 7 MB saving on a budget that was never in danger, it was declined.

**What it would have bought: 4×. Rejected — the number it improves is not a problem.**

---

## 4. Projection for the 12-file Tier 1 pass

**Tier 1** = sheet_07's ten (`asset_061`–`asset_070`) plus the broom (`074`) and mop
(`072`).

**Assumptions, stated because two of them are design decisions rather than measurements:**

* **3 maps per material family** — measured. The exporter merges roughness and metalness
  into one `metallicRoughnessTexture`, so asset_065's three families produce nine images.
* **3 families per asset** — measured on asset_065.
* **7 distinct families across all twelve files** — *proposed, not measured*: medium
  walnut, dark walnut, brushed steel, black powder-coat, upholstery, brass, plaster.
  This gives 12 × 3 = 36 family-uses over 7 families, a reuse factor of **5.1×**.

So: **108 map instances, 21 unique maps.**

| Configuration | Instances paid for | Resident | vs baseline |
|---|---|---|---|
| **Baseline** — 1024², RGBA8, per-file | 108 | **576 MB** | 1× |
| Sharing only | 21 | 112 MB | 5.1× |
| Resolution only (512²) | 108 | 144 MB | 4.0× |
| Format only (1024² BC7) | 108 | 144 MB | 4.0× |
| Resolution + format | 108 | 36 MB | 16× |
| **Sharing + resolution — SHIPPED** | 21 | **28 MB** | **20.6×** |
| Sharing + format | 21 | 28 MB | 20.6× |
| All three | 21 | 7 MB | 82× |

**The shipped configuration is sharing + resolution: 28 MB.** The two rows involving the
format lever are retained as the evidence behind the §3 rejection, not as options. The
reopen threshold of 150 MB sits above every row in the sensitivity table below except the
degenerate no-reuse case, which is the point of setting it there.

**Sensitivity of the sharing figure.** The 5.1× depends entirely on the family count,
which is the one assumption I have not measured:

| Distinct families | Reuse | Sharing + resolution |
|---|---|---|
| 5 | 7.2× | 20 MB |
| **7 (proposed)** | **5.1×** | **28 MB** |
| 12 | 3.0× | 48 MB |
| 36 (no reuse at all) | 1.0× | 144 MB |

Even the worst case — every asset with its own bespoke families — lands at 144 MB, versus
576 MB naive. The floor is set by the resolution lever, which needs no assumptions.

---

## 5. Validation on asset_065

Three arms, same fixed camera (`tools/qa/spike-bible-arm.js`: poses pinned, customers
hidden, doors forced closed, FOV asserted), differing only in the texture pipeline.

| Arm | Pipeline | GLB | Resident |
|---|---|---|---|
| **F** | 1024², uncompressed — the control | 10.23 MB | 48.0 MB |
| **H** | 512², uncompressed | 2.87 MB | 12.0 MB |
| **G** | 512² + KTX2 | 0.97 MB | 3.0 MB |

Pixel difference, `Designs/ProShop/Spike/compare_arms.py`:

| Pair | Shot | meanAbs | p99 | % pixels > 2/255 |
|---|---|---|---|---|
| F vs H | three-quarter | 0.234 | 3.0 | 1.94 % |
| F vs H | front-elevation | 0.362 | 5.0 | 4.32 % |
| F vs H | floor-contact | 0.197 | 3.0 | 1.97 % |
| **F vs G** | three-quarter | **0.326** | 4.0 | 4.94 % |
| **F vs G** | front-elevation | **0.429** | 5.0 | 6.38 % |
| **F vs G** | floor-contact | **0.243** | 3.0 | 3.54 % |
| H vs G | front-elevation | 0.421 | 5.0 | 6.29 % |

**Scale reference:** during the lighting spike a single stray NPC in frame produced a
meanAbs of **4.2**. Every difference here is an order of magnitude below that, and the
p99 sits at 3–5/255. Confirmed by eye on the stacked plates in
`Designs/ProShop/Spike/bible/compare/pipeline-*.png` — the worktop grain, the leg finish
and the shelf are indistinguishable across all three.

**Answer to the question asked: yes, the compressed path looks identical to Arm F. The
compression settings are right.** Twelve files can go through it.

---

## 6. What is shipped, and what is not

**Shipped on this branch:**

* `asset_065` runtime GLB at **512², uncompressed** — 12.0 MB, down from 48.0 MB.
* Cross-file texture sharing, live on every GLB path.
* `tools/blender/pack_ktx2.mjs`, retained for its `--no-compress` resolution path, which
  is how the 512 ceiling is applied. Its encode path still works and is what a reopen
  would use.
* `tests/proshop-texture-budget.test.js` — reads dimensions out of the shipped GLBs and
  fails if anything exceeds 512. Verified by restoring the 1024² asset: the test fails.
  It also fails if any shipped GLB declares `KHR_texture_basisu`, which is what keeps a
  compressed asset from reaching a runtime that can no longer transcode one.

**Reverted:**

* The `'wasm-unsafe-eval'` CSP keyword. `index.html` is back to
  `script-src 'self' 'sha256-…'` and carries a comment pointing here, so the next person
  who hits the WASM refusal reads the decision before widening the policy.
* KTX2 runtime attachment. `initKTX2` returns null and `getKTX2Loader` stays null unless
  `globalThis.__FW_ENABLE_KTX2` is set. A GLB carrying `KHR_texture_basisu` now fails at
  parse time with a legible GLTFLoader error instead of an `EvalError` inside a worker.

**Deliberately not done:**

* **Palette calibration of asset_065.** The task was to confirm the new pipeline looks
  *identical* to Arm F; recolouring the asset in the same change would have made that
  comparison impossible. The procedure is written up at `ART_BIBLE.md` §7.4.1 and the
  tooling exists (`tools/blender/cc0_calibrate.py`), but no asset has been through it.

* **Fixing the tint-drop defect.** Found while reading the Arm F GLB: its four textured
  materials have **no `baseColorFactor` at all**. Blender 5.1's glTF exporter does not
  recognise the builder's MixRGB-multiply pattern as a base-colour factor, so every tint
  was silently dropped and the surfaces ship as raw untinted ambientCG photographs.
  **This, not subtle colour arithmetic, is the actual cause of Arm F's palette drift.**
  It is recorded in `build_assets_61_70.py` as a known defect and belongs with the Tier 1
  pass.

* **`Metal032` remains below the §7.4.1 contrast gate** at p90/p10 = 1.14. It needs a
  replacement source before the pass, not during it.

---

## 7. Reproducing any of this

```bash
node tools/serve.cjs                                              # port 8457

node tools/qa/run-playwright.cjs tools/qa/proshop-texel-density.js
node tools/qa/run-playwright.cjs tools/qa/proshop-texture-sharing-ab.js
node tools/qa/run-playwright.cjs tools/qa/proshop-texture-infrastructure.js

python tools/blender/cc0_calibrate.py --report
node tools/blender/pack_ktx2.mjs --in <runtime.glb> --report

"/c/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
  --factory-startup --python tools/blender/build_assets_61_70.py -- --asset 65
node tools/blender/pack_ktx2.mjs --in <built.glb> --out <runtime.glb> --max-size 512 --no-compress

ARM=F node tools/qa/run-playwright.cjs tools/qa/spike-bible-arm.js
python Designs/ProShop/Spike/compare_arms.py F H G
```
