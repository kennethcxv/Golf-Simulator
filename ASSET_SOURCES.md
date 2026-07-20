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

## Owner-supplied models (Assets/, 2026-07-09; fully integrated 2026-07-10)

20 GLBs dropped into Assets/ by the project owner (Tripo-generated to match the
Designs/ art direction; AI-generated, user-provided — treated as project-owned).
Full inventory/quality check 2026-07-10: all 20 import clean in Blender 5.1 AND
three r185 (qa/assets-inventory-sheet.png); single mesh + baked material each,
unit-normalized (scene-side scaling applied per use).

In use (vendor/models/ name ← Assets source):
- tractor_red.glb ← red+tractor — legacy fallback for the restored tractor
- tractor_broken.glb ← tractor — retained legacy reference; superseded in-game
- mower_deck.glb ← red+agricultural+machine — legacy mower fallback
- shed.glb / workbench.glb / tool_chest.glb / gas_can.glb / belt.glb — the
  maintenance-yard repair sequence
- leaves_pile.glb ← fallen+leaves+pile — yard junk chore + course litter piles
- hose_nozzle.glb / hand_fork.glb / bucket_soil.glb / rake.glb — the held
  hand tools (hose, divot kit ×2, bunker rake)
- tee_sign_broken.glb ← wooden+sign — the broken tee sign
- course_sign.glb ← golf+course+sign — the restored tee sign
- club_sign.glb ← golf+club+sign — the stone entrance sign (weathered by code)
- flagpole.glb — per-hole flagsticks (Task-1 finding: it was never a pennant)
- tee_markers.glb ← golf+swing+prop — the tee-marker pair on every open tee
- clubhouse_ext.glb ← house — original preserved unmodified; 2026-07-13 an
  optimized game-ready export shipped as clubhouse_ext_opt.glb (gltf-transform
  weld + meshopt simplify 0.2 + 1024² textures: 333,867→66,762 tris, 13.1→2.57
  MB) and is placed as the groundskeeper's residence on the entrance approach.
  It cannot be the enterable clubhouse (single watertight baked mesh, no
  interior/door parts — verified); the enterable building is purpose-built.
- golf+cart — staged for this arc: parked ambient cart by the clubhouse

vendor/models/tractor.glb is an original bpy-scripted fallback (project-owned).
The rigged-character GLB attempt failed at the Blender 5.1 → three r185 skin
boundary and was deleted; characters are procedural three.js figures
(src/render3d/characterAsset.js), no external assets.

## Production grounds tractor (2026-07-19)

The active tractor and rear finish mower are **original project-authored geometry**.
No downloaded, third-party, Tripo, Meshy, or Imagegen geometry or textures are used.
They are project-owned and reproducible with Blender 5.1 from:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
        --factory-startup --python tools/blender/build_tractor.py

| File | Purpose | Runtime geometry |
|---|---|---:|
| `vendor/models/tractor_production.glb` | Compact open-station grounds tractor with named steering, wheel, hood, and hitch pivots | 12,068 tris / 59 meshes |
| `vendor/models/mower_deck_production.glb` | Separate rear finish mower with deck and blade pivots | 1,268 tris / 15 meshes |
| `Assets/Blender/tractor_production.blend` | Editable source scene with the implement mounted at its real hitch | source only |

The tractor uses believable 2.02 × 3.47 × 2.22 m dimensions, a 1.85 m
wheelbase, applied mesh transforms, explicit `COL_` simplified collision meshes,
and the project's cream/green/sage/charcoal/walnut/brass material language. The
Blender MCP bridge was used to inspect the generated source hierarchy and pivots;
the repeatable script remains the authoritative build path.

The low-profile pop-up sprinkler head introduced with grounds planning is original
three.js geometry in `src/render3d/courseScene.js` (two instanced cylinders using the
project charcoal/brass palette). It has no external source, texture, or license.

## Audio (2026-07-13 production pass)

Every sound in the game is synthesized at runtime with WebAudio oscillators
and filtered noise (src/core/audio.js) — there are NO audio sample files in
the repo, so there is nothing to license. One-shots: doorbell, uiTick,
doorSwing, doorShut, scanBeep, wipe, laptopOpen, laptopBoot, equipTick,
chime, thunk; loops: hose/mower/vacuum/divot/rake tool beds, rain, birdsong,
distant ball-strikes (all procedural). The clubhouse ducks the outdoor
soundscape when you step inside.

## Interior textures (2026-07-13 production pass)

All clubhouse interior materials are canvas-procedural, generated at boot
(src/render3d/clubhouse/materials.js): walnut/oak/plaster/concrete/leather/
fabric/kraft, the club logo rug, signage, and product-box labels. No external
texture files beyond the two existing exterior normal maps (siding_nor.jpg,
roof_nor.jpg, project-owned).

## Clubhouse asset pass (2026-07-14) — vendor/models/clubhouse/

23 GLBs (2.0 MB total), **authored from scratch in this repo** and therefore
project-owned. No third-party assets, no AI generation services (Meshy/Tripo are
not authorised and were not used).

They are built headlessly by committed Blender scripts, so every one is
reproducible from source:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
        --factory-startup --python tools/blender/build_merch.py
    ... --python tools/blender/build_props.py
    ... --python tools/blender/inspect_glb.py     # renders previews + measures

| Script | Assets |
|---|---|
| `tools/blender/build_merch.py` | polo_hanging, polo_folded, jacket_hanging, glove, shoe, bag, head_driver, head_iron, head_wedge, head_putter, cap |
| `tools/blender/build_props.py` | chair_lounge, chair_office, trophy, register, scanner, cardterm, printer, cash_drawer, carton, carton_open, handtruck, pendant |
| `tools/blender/lib_model.py` | shared modelling helpers — `loft()`, `outline_solid()` |

Every material in these files is a NAMED SLOT (`M_fabric`, `M_leather`, `M_steel`,
…) with no authored look. `src/render3d/clubhouse/merch.js` remaps each slot onto
the shared clubhouse material kit at load, so the whole building draws from one
material library and the material count stays flat no matter how much stock is on
the shelves. Colours in the .py files exist only so the assets are legible if
opened in Blender.

Blender **5.1.2**, drives headlessly. The Blender MCP addon socket is not running
in this environment (recorded as a blocker); the headless CLI is the better
pipeline regardless, because the authoring scripts are committed rather than the
binaries being unexplainable artefacts.


## Register kit (2026-07-14)

`tools/blender/build_register.py` — project-owned, reproducible from source. No third-party
assets, no generation credits spent.

| Model | Notes |
|---|---|
| `cash_drawer.glb` | **REBUILT EMPTY.** Five bill wells for [50, 20, 10, 5, 1] and three coin cups for [0.25, 0.10, 0.05], matching DENOMS. |
| `basket.glb` | Shop basket: flared slatted tub, trapezoid handle. |
| `bag_open.glb` | The open carrier goods are dropped into (the closed one a customer walks out with is separate). |
| `impulse_rack.glb` | Three-tier counter rack of markers and tee packets, facing the queue. |
| `divider.glb` | Brass-ended baton on a weighted foot. |

### Why the drawer was rebuilt

The asset pass shipped a `cash_drawer.glb` with the notes and coins **modelled into it** —
five paper rectangles in the wells, brass discs in every cup. As set dressing that was
right; the ref shows an open till with money in it. As a thing a player has to *work* it
was useless, because `finish()` joins every part into a single mesh and **you cannot pick
up a note that is welded to the drawer**. SESSION_STATE had flagged the drawer as unplaced
for want of an open/close animation; the real blocker was that its money was scenery.

It ships as a carcass now and the money is spawned live from the till's real contents. The
drawer you look at IS the drawer you are holding: take three ones out of the well and there
are three fewer ones in it.

### The money itself is not modelled

Banknotes and coins are **canvas textures on thin geometry** (`registerMode.js`), because a
note IS its print — modelling one buys you a rectangle and the whole identity is in the
face. Guilloche linework, a crest, a denomination twice. The currency is invented,
**FAIRWAY RESERVE**, per the brief's "use fictional game currency" — and because printing a
real one would be forgery rendered at 60 fps.

### Convention, unchanged

1 unit = 1 game yard · Z-up in Blender, Y-up on export · materials are NAMED SLOTS
(`M_charcoal`, `M_kraft`, …) remapped onto the shared clubhouse kit at load, so a new prop
costs a draw call and not a material.
