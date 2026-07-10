# GOLF COURSE FLIPPER — ASSET SOURCES

Every external asset in this repo, its origin, and its license. CC0 requires no
attribution; this file exists as good practice for a commercial release.

## Ground / building PBR textures (vendor/textures/)

All from **Poly Haven** (https://polyhaven.com) — license **CC0**
(https://polyhaven.com/license), free for commercial use, no attribution required.
Downloaded 2026-07-09 at 1K JPG (diffuse + GL normal).

| Files | Poly Haven asset | Used for |
|---|---|---|
| fairway_diff/nor.jpg | `leafy_grass` — polyhaven.com/a/leafy_grass | Fairways, greens, tees (tint/tiling varied per zone) |
| rough_diff/nor.jpg | `sparse_grass` — polyhaven.com/a/sparse_grass | Rough |
| sand_diff/nor.jpg | `sand_01` — polyhaven.com/a/sand_01 | Bunkers |
| path_diff/nor.jpg | `gravel_road` — polyhaven.com/a/gravel_road | Cart paths |
| scrub_diff/nor.jpg | `brown_mud_leaves_01` — polyhaven.com/a/brown_mud_leaves_01 | Out-of-play forest floor |
| siding_diff/nor.jpg | `worn_planks` — polyhaven.com/a/worn_planks | Clubhouse walls |
| roof_diff/nor.jpg | `roof_tiles_14` — polyhaven.com/a/roof_tiles_14 | Clubhouse roof |

## Water

| File | Source | License |
|---|---|---|
| vendor/textures/waternormals.jpg | three.js repository, examples/textures (github.com/mrdoob/three.js) | MIT (three.js) |

Note: `vendor/addons/objects/Water.js` (MIT, three.js examples) carries two small
FAIRWAY STATE patches, flagged with comments in the file: grazing reflectance is
capped and the mirror sample desaturated/tinted so ponds read as water under this
project's single-tonemap (OutputPass) pipeline.

## Code (vendored)

| Files | Source | License |
|---|---|---|
| vendor/three.module.js, three.core.js, addons/* | three.js r0.185 npm package / examples | MIT |

## Trees (vendor/models/trees/)

From **Kenney — Nature Kit 2.1** (https://kenney.nl/assets/nature-kit) — license **CC0**
(License.txt in the pack confirms), free for commercial use, no attribution required.
Downloaded 2026-07-09. Models: `tree_default`, `tree_oak`, `tree_detailed`, `tree_fat`,
`tree_pineDefaultA`, `tree_pineRoundB` (.glb). The kit's pastel palette is remapped at
load time to realistic foliage/bark tones; geometry unmodified.

Quaternius packs were the first choice per the brief but expose no direct download
(Patreon-gated page); Kenney was the sanctioned CC0 fallback.

v5 note: an AI-generated tree pass (Tripo / tripo3d.ai) was attempted as a possible
upgrade-alongside candidate but no Tripo credentials or working Blender-addon bridge
exist in this environment, so no AI-generated assets were produced or added — the
Kenney set above remains the sole tree source. Details in KNOWN_ISSUES.md and DEV_LOG.md.

## Visual-style pass note (2026-07-09, Designs/ reference matching)

How the assets above are USED changed with the style pass (see the STYLE GUIDE in
DEV_LOG.md): the terrain shader now takes only LUMINANCE from the Poly Haven photo
sets and applies flat saturated zone tints over it, and the clubhouse materials
dropped the worn_planks/roof_tiles albedo entirely (flat cream/sage color + their
normal maps only). No files were added or removed. The Designs/ folder holds 8
ChatGPT-generated reference images (project-internal art direction only — NOT
shipped game assets, and not for redistribution as artwork).

Reference-image direction NOT fully achievable with current assets, honestly:
- The references' dense photoreal grass blades and flower beds have no counterpart
  asset (and the mandate is stylized anyway) — turf reads as clean tinted fields.
- The references' clubhouse clock tower, feather flags, entrance sign, and banner
  props don't exist as models; the building matches by palette, not silhouette.
- Characters are restyled primitives — no rigged/clothed character models exist in
  the repo (no Mixamo pipeline despite the brief's reference to one).
- The physical Sky shader cannot reach the references' deep zenith blue at the
  bright exposure the style needs; sprite cumulus supply the cloud language.
