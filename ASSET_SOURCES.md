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

## Pro-shop fixture pack (2026-07-19)

Sixteen GLBs are authored from scratch in this repository by
`tools/blender/build_shop_fixtures.py`. They are project-owned: no third-party
downloads, external textures, generated assets, or generation credits were used.

| Model | Role |
|---|---|
| `club_wall_bay.glb` | Two-row club bay with sole troughs and shaft/grip clips |
| `pegboard_wall.glb` | Carded-accessory wall with an authored hook grid |
| `apparel_wall.glb` | Folded-goods boards and a short outerwear rail |
| `ball_wall.glb` | Three-board ball wall with authored product-lane dividers |
| `hat_wall.glb` | Eight-facing wall bay that keeps headwear and shoppers off the same floor footprint |
| `shoe_wall.glb` | Three-board shoe wall with an integrated shallow try-on ledge |
| `basket_station.glb` | Open scorecard stand with two visible nested basket positions |
| `demo_club_rack.glb` | Three-putter trial rack parked beside the walkable demo mat |
| `feature_table.glb` | Low nested oak new-arrivals/apparel island |
| `fitting_room.glb` | Three-sided fitting room, curtain, mirror, bench, and interior garment hooks |
| `drinks_fridge.glb` | Glass-front compact cold case |
| `snack_rack.glb` | Four-tier turn-snack rack |
| `service_station.glb` | Scorecard and membership-information stand |
| `premium_case.glb` | Brass-framed glass Tour Vault cabinet |
| `putting_demo.glb` | Low felt demo mat, cup, aim marks, and backstop |
| `bag_empty.glb` | Premium stand-bag body without a sightline-blocking club fan |

Rebuild all sixteen with:

    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
        --factory-startup --python tools/blender/build_shop_fixtures.py

Origins are floor-centre, transforms are applied on export, dimensions use the
game's yard-scale convention, and named material slots are remapped onto the
shared clubhouse palette by `src/render3d/clubhouse/merch.js`. Simplified
collision remains in `src/data/shopLayout.js`, so visual detail never becomes a
high-poly physics mesh.

### Original refreshment label atlas

`public/assets/textures/shop/turn-snacks-label-atlas.png` is original fictional
packaging artwork generated for this project with the preinstalled OpenAI
Imagegen tool on 2026-07-19. It contains the invented TURN CRISPS, NINTH HOLE
BAR, and CADDIE CRACKERS fronts. Prompt constraints required a flat three-column
atlas in the clubhouse cream/green/sage/walnut/charcoal/brass palette, verbatim
fictional names, no real trademarks, and no watermark. It is used only as a
front-label texture; package geometry is rendered in Three.js and the physical
rack/fridge remain Blender-authored. No third-party source images were used.


## Register kit (2026-07-14)

`tools/blender/build_register.py` — project-owned, reproducible from source. No third-party
assets, no generation credits spent.

| Model | Notes |
|---|---|
| `cash_drawer.glb` | **REBUILT EMPTY.** Five bill wells for [50, 20, 10, 5, 1] and five coin cups for [0.50, 0.20, 0.10, 0.05, 0.01], matching DENOMS. |
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

## Assets 51–100 reuse for furniture customization (2026-07-19)

`vendor/models/assets_51_100/` is reused from the repository's verified
`overnight/assets-51-100-runtime` workstream. These GLBs are original,
project-owned Blender assets generated by the committed Sheet 6–10 production
scripts on that workstream; they are not downloaded marketplace, Poly Haven,
Sketchfab, Tripo, or other third-party assets. This branch consumes the existing
exports without rebuilding or altering their geometry.

The furniture system applies the authored `SOCKET_PLACEMENT`, floor/wall/surface
mount sockets, real-world dimensions, and simplified analytic collision metadata.
The original editable `.blend` sources and build scripts remain on the asset
workstream; this branch carries only the unchanged runtime GLBs needed by the game.

### Convention, unchanged

1 unit = 1 game yard · Z-up in Blender, Y-up on export · materials are NAMED SLOTS
(`M_charcoal`, `M_kraft`, …) remapped onto the shared clubhouse kit at load, so a new prop
costs a draw call and not a material.

## Production checkout kit (2026-07-15)

Six final checkout assets are authored entirely in this repository by the repeatable
`tools/blender/build_checkout_assets.py` script. They are project-owned originals:
no third-party downloads, marketplace models, generated geometry, or external texture
sources are used. Blender 5.1.2 saves an editable source for each asset under
`asset_sources/blender/cash_register/` and exports the shipped GLB beside the clubhouse
models under `vendor/models/clubhouse/`.

| Editable source / shipped export | Purpose |
|---|---|
| `checkout_counter.blend` / `checkout_counter.glb` | Walnut/oak cashier counter with customer, scanner, staging, bagging, drawer, and staff anchors |
| `checkout_cash_drawer.blend` / `checkout_cash_drawer.glb` | Animated housing, slide, labeled bill/coin insert, retaining clips, interaction anchors, simplified collisions |
| `checkout_scanner.blend` / `checkout_scanner.glb` | Recessed scanner glass and physical scan-volume anchors |
| `checkout_card_reader.blend` / `checkout_card_reader.glb` | ISO ID-1 chip slot, contactless details, ready/inserted card-pose anchors |
| `checkout_receipt_printer.blend` / `checkout_receipt_printer.glb` | Separate paper/roll parts with printing actions and collection anchor |
| `checkout_shopping_bag.blend` / `checkout_shopping_bag.glb` | Open kraft bag, separate handles, two grip anchors, packed-content and handoff anchors |

The companion `validate_checkout_assets.py` re-imports the shipped binaries and checks
metre-scale dimensions, applied transforms, anchors, collisions, actions, materials,
and triangle budgets. `render_checkout_assets.py` produces isolated, animated-state,
and assembled previews. The retained final validation is
`qa/cash-register-production/final/blender-validation.md`; previews are under
`qa/cash-register-production/model-previews-final/`. Runtime-generated POS, currency,
receipt, barcode, card, and brand graphics remain original canvas textures rather than
external image assets.

### Checkout product family library

Twenty-seven checkout-scale product families are authored by
`tools/blender/build_checkout_products.py`. Each run starts from Blender factory
settings, creates original project-owned geometry and the shared clubhouse PBR palette,
bakes Blender's smoothing modifier so the source stays self-contained, saves an
editable `.blend` in `asset_sources/blender/cash_register/`, and exports the matching
`.glb` to `vendor/models/clubhouse/`. No Tripo input, downloaded model, image texture,
linked Blender library, or third-party asset is used.

| Family IDs (each has matching `.blend` and `.glb`) | Retail purpose |
|---|---|
| `checkout_product_driver`, `checkout_product_iron_set`, `checkout_product_putter`, `checkout_product_wedge` | Full-size clubs and bundled iron set |
| `checkout_product_ball_carton` | Tier-tintable dozen-ball carton |
| `checkout_product_folded_polo`, `checkout_product_folded_jacket`, `checkout_product_cap`, `checkout_product_glove` | Folded apparel and wearable accessories |
| `checkout_product_tee_pouch`, `checkout_product_towel_roll`, `checkout_product_marker_blister` | Compact golf accessories and retail packs |
| `checkout_product_rangefinder`, `checkout_product_umbrella`, `checkout_product_stand_bag` | Equipment, including separate oversize handoff props |
| `checkout_product_shoe_pair`, `checkout_product_sock_pair`, `checkout_product_headcover` | Footwear and future headcover family |
| `checkout_product_visor`, `checkout_product_folded_bottom` | Pine Hills visor and folded pants/shorts family |
| `checkout_product_divot_tool_card`, `checkout_product_eyewear_case`, `checkout_product_scorecard` | Carded accessory, eyewear, and municipal scorecard families |
| `checkout_product_bottle`, `checkout_product_beverage_can`, `checkout_product_snack_pouch`, `checkout_product_snack_bar` | Checkout-ready cooler and snack families with cached SKU tint slots |

Every family includes `ANCHOR_ProductBarcode`, `ANCHOR_ProductGripPrimary`, a simplified
`COL_Product`, source/license metadata, and UVs; oversize families also include
`ANCHOR_ProductGripSecondary`. The retained independent source/import/runtime audit,
per-family previews, and contact sheet are under
`qa/cash-register-production/final/catalog-assets/independent-review/`.
The nine Pine Hills catalog additions also have a Blender 5.1 clean-factory
round-trip report at
`qa/pine-hills-clubhouse/blender/checkout-catalog-products-reimport.json`.

## Course 4 resort clubhouse (2026-07-20)

`tools/blender/build_resort_clubhouse_4000.py` reproducibly authors the luxury
Mediterranean resort clubhouse from Blender factory settings. All geometry,
materials, landscaping, signage, and water features are original project-owned
work; no Tripo source, downloaded model, marketplace asset, generated texture,
or third-party image is used.

The editable modular source is
`asset_sources/blender/clubhouse_resort_4000/clubhouse_resort_4000.blend`.
The canonical export is
`Assets/clubhouse_resort_4000/glb/clubhouse_resort_4000.glb`; a separately
optimized static-batch export is written to
`vendor/models/clubhouse/clubhouse_resort_4000.glb` for the runtime loader.
The 24.0 m by 15.5 m conditioned envelope is 372 m² / 4,004.17 sq ft. Linked
module masters cover arched windows, physical-hinge double doors, columns,
arcade bays, roof construction, palms, patio dining sets, staged golf carts,
guest bags, and cypress screening; site elements and architectural assemblies
remain separately named for future customization.

The building interior contains only permanent architecture—floor, wall liner,
ceiling, doors, windows, and structure. Its permanent-furniture manifest is
intentionally empty so player-owned furnishings remain authoritative. Simplified
`COL_*` proxies are separate from presentation meshes, all production transforms
are applied, and named sockets expose entrance, bag drop, cart staging, patio,
fountain, and west/east/rear expansion datums. Runtime static batching reduces
render submissions without flattening or overwriting the reusable Blender/GLB
source hierarchy.

## Course 2 modern public clubhouse (2026-07-20)

`tools/blender/build_modern_public_clubhouse.py` reproducibly authors the Course 2
modern suburban public clubhouse and its site from Blender factory settings. The
design is an original project-owned interpretation of the repository's
`Designs/ClubHouse/` references. No Tripo source, downloaded model, marketplace
asset, generated texture, or third-party image is incorporated into either GLB.

The editable building and site sources are
`asset_sources/blender/clubhouse/modern_public_clubhouse_v1.blend` and
`asset_sources/blender/clubhouse/modern_public_clubhouse_site_v1.blend`. Their
runtime exports are `vendor/models/clubhouse/modern_public_clubhouse_v1.glb` and
`vendor/models/clubhouse/modern_public_clubhouse_site_v1.glb`.

The conditioned envelope is exactly 19.20 m by 12.34 m: 236.928 m² / 2,550.3
sq ft. The site provides 52 marked parking spaces, a 12.0 m by 8.4 m open-bay
cart barn, an 8.8 m by 8.0 m loading apron, and a 10.8 m by 6.2 m empty patio.
Walls, infills, storefront windows, doors, trims, stone water table, roof,
gutters, porch columns, paving, parking stalls, cart-barn bays, landscaping,
and expansion datums remain separately named reusable modules. Moving parts use
dedicated physical pivots, simplified `COL_*` meshes are separate and hidden at
runtime, and authored sockets expose future structure, patio, utility, parking,
and furnishing expansion points. Runtime-only static batches reduce submissions
without deleting or flattening the reusable source hierarchy; transparent glass,
all moving pivots, named sockets, and hidden source modules stay individually
addressable.

The building contains permanent architecture and labeled employee, storage,
irrigation, and receiving rooms, but no retail fixtures, desks, stock, patio
furniture, carts, or other furnishings. Those remain player-owned placement
content rather than baked clubhouse geometry.

## Course 5 premium private-country-club architecture (2026-07-20)

`tools/blender/build_premium_clubhouse.py` reproducibly authors the Course 5
private-country-club building, modular construction kit, and arrival site from
Blender factory settings. The design is an original project-owned interpretation
of the repository's `Designs/ClubHouse/ChatGPT Image Jul 20, 2026, 02_52_25 PM.png`
Course 5 reference row. No Tripo source, downloaded model, marketplace asset, or
third-party texture is incorporated. Its limestone, brick, walnut, oak, slate,
copper, asphalt, and paver PBR maps are generated by the repository build script
and are project-owned.

The editable source is
`asset_sources/blender/premium_clubhouse/premium_clubhouse_architecture.blend`.
Canonical exports are
`Assets/premium_clubhouse/glb/premium_clubhouse_architecture.glb` and
`Assets/premium_clubhouse/glb/premium_clubhouse_modular_kit.glb`, mirrored
byte-for-byte into `vendor/models/premium_clubhouse/` for runtime loading. The
two-floor conditioned envelope is 32.0 m by 10.0 m: 640 m² / 6,888.9 sq ft.

The source retains reusable wall, window, door, trim, column, roof, chimney,
coffered-ceiling, sidewalk, veranda, stair, fountain, parking, lighting, and
landscape modules. Physical door pivots, simplified hidden `COL_*` meshes, and
named expansion, lighting, aperture, and furnishing sockets remain separate.
The interior contains permanent architecture only and is intentionally empty so
player-owned furnishing and decoration systems remain authoritative.

## Course 3 luxury mountain clubhouse (2026-07-20)

`tools/blender/build_mountain_clubhouse.py` reproducibly authors the Course 3
luxury mountain/woodland clubhouse and its surrounding arrival, service, and
course-view landscape from Blender factory settings. The design is an original
project-owned interpretation of the repository's
`Designs/ClubHouse/ChatGPT Image Jul 20, 2026, 02_52_25 PM.png` reference. No
Tripo source, downloaded model, marketplace asset, generated texture, or
third-party image is incorporated into the asset.

The editable source is
`asset_sources/blender/clubhouse/mountain_clubhouse_3000sqft.blend`. The
canonical export is `Assets/clubhouse/mountain_clubhouse_3000sqft.glb`, mirrored
byte-for-byte to
`vendor/models/clubhouse/mountain_clubhouse_3000sqft.glb` for runtime loading.
The conditioned footprint is 21.0 m by 13.275 m: 278.775 m² / 3,000.71 sq ft.

Reusable named modules cover walls, cedar panels and battens, stonework, doors,
windows, trim, timber columns and trusses, roof panels and seams, chimney and
fireplace parts, porches, patio, cartport, sidewalks, maintenance road,
landscape beds, boulders, pines, and rustic lighting. Physical door pivots,
simplified hidden `COL_*` meshes, and furnishing, utility, cart, delivery, and
expansion sockets remain separate. Runtime static batching preserves that
source hierarchy while reducing submissions. The interior contains permanent
architecture only and is intentionally empty so player furnishing and
decoration remain authoritative.

## Pro-shop clothing racks (2026-07-21)

`tools/blender/build_clothing_racks.py` reproducibly authors five progressively
upgraded retail clothing racks from the project-owned references in
`Designs/Clothing_Racks/`: Basic, Standard, Premium, High-End, and Luxury. All
geometry and all stylized PBR texture maps are original, deterministic project
work. No Tripo source, downloaded model, marketplace asset, external texture,
generated image, or third-party artwork is incorporated.

Editable sources are stored individually in
`Assets/pro_shop_furniture/source/clothing-racks/`; runtime GLBs are in
`vendor/models/pro_shop_furniture/clothing-racks/`. Each asset preserves three
strictly descending LOD hierarchies, a simplified `COLLISION_*` proxy, hanging
and shelf attachment bounds, placement and interaction nodes, and authored
lighting nodes where appropriate. Full provenance and exact paths are recorded
in `Assets/pro_shop_furniture/clothing-racks-manifest.json`.

## Pro-shop retail shelving (2026-07-21)

`tools/blender/build_retail_shelves.py` reproducibly authors the five retail
shelving tiers from Blender factory settings: Basic, Standard, Premium,
High-End, and Luxury. The designs are original project-owned interpretations of
the repository's `Designs/Shelves/` references. All geometry and stylized PBR
texture maps are generated locally by the build script; no Tripo source,
downloaded model, marketplace asset, external texture, generated image, or
third-party artwork is incorporated.

Editable sources are stored individually in
`Assets/pro_shop_furniture/source/retail-shelving/`; bundled runtime GLBs and
standalone LOD exports are in
`vendor/models/pro_shop_furniture/retail-shelving/`. Every tier retains applied
production transforms, three descending LODs, hidden multipart
`COLLISION_*` proxies, placement and wall-anchor datums, an interaction point,
and measured stocking zones. High-End and Luxury also retain six physical-hinge
cabinet doors, six storage zones, and authored warm-light attachment nodes.
Exact dimensions, capacities, source/export paths, triangle counts, texture
paths, and functional contracts are recorded in
`Assets/pro_shop_furniture/retail-shelving-manifest.json`.

## Pro-shop chairs (2026-07-21)

`tools/blender/build_chairs.py` reproducibly authors the five chair tiers from
Blender factory settings: Basic, Standard, Premium, High-End, and Luxury. The
designs are original project-owned interpretations of the repository's
`Designs/Chairs/` references. All geometry and stylized leather, plastic, and
walnut PBR maps are generated locally by the build script; no Tripo source,
downloaded model, marketplace asset, external texture, generated image, or
third-party artwork is incorporated.

Editable `.blend` sources are stored individually in
`Assets/pro_shop_furniture/source/chairs/`; canonical and standalone LOD GLBs
are in `Assets/pro_shop_furniture/exports/chairs/`, and bundled runtime GLBs are
in `vendor/models/pro_shop_furniture/chairs/`. Each tier retains three strictly
descending LODs, simplified `COL_*` collision proxies, placement and seating
anchors, two-sided entry/exit targets, hand and foot anchors, and validation
metadata. The office tiers additionally retain gas-lift, swivel, caster, desk
alignment, and recline pivots as applicable. Exact dimensions, animation clips,
triangle counts, PBR maps, character envelopes, desk-clearance checks, and
fresh GLB re-import results are recorded in
`qa/chairs/blender/blender-validation.json` and
`Assets/pro_shop_furniture/manifest.json`.

## Architectural door tiers (2026-07-21)

`tools/blender/build_architectural_doors.py` reproducibly authors five original,
project-owned architectural door assemblies from Blender factory settings:
Basic, Standard, Premium, High-End, and Luxury. The files in `Designs/Doors/`
are composition references only and remain byte-for-byte unmodified. No Tripo
source, downloaded model, marketplace asset, external texture, generated image,
or third-party artwork is incorporated.

Editable per-tier sources and the comparison scene are stored in
`Assets/architecture/doors/source/`; runtime GLBs are in
`vendor/models/architecture/doors/`. Project-owned procedural base-colour,
roughness, and normal maps are in `Assets/architecture/doors/textures/`. Every
tier retains three descending LODs, simplified hidden `COLLISION_*` proxies,
threshold/wall/interaction/navigation/lock datums, physical leaf, handle, latch,
and hinge pivots, and named animation clips. Luxury additionally retains two
independent leaves, inactive-leaf flush bolts, an astragal, and separate
clearance/interaction nodes; High-End retains its arched privacy-glass assembly.

Exact dimensions, hashes, triangle counts, reference hashes, source/export
paths, materials, pivots, animations, and the no-external-assets declaration are
recorded in `Assets/architecture/doors/doors-manifest.json`. Fresh-process GLB
re-import results are recorded in
`qa/doors/blender/architectural-door-reimport-validation.json`. License:
**Golf Flipper project-owned original work**.

## Pine Hills starting-clubhouse interior supplement (2026-07-22)

All assets below are original deterministic geometry generated in-repository by
`tools/blender/build_pine_hills_interior_assets.py` and verified by
`tools/blender/verify_pine_hills_interior_assets.py`. No external meshes,
textures, fonts, generated artwork, or third-party assets are used. Asset 61
was used only as a dimensional and style reference; its source was never
loaded, overwritten, or modified.

| Source | Runtime export | Asset | License |
|---|---|---|---|
| `asset_sources/blender/clubhouse/pine_hills_front_desk_return_v1.blend` | `vendor/models/clubhouse/pine_hills_front_desk_return_v1.glb` | 1.27 m front-desk extension with 2.10 m staff return | Project-owned |
| `asset_sources/blender/clubhouse/pine_hills_opening_drinks_cooler_v1.blend` | `vendor/models/clubhouse/pine_hills_opening_drinks_cooler_v1.glb` | Opening drinks cooler with hinged door and 24 bottle sockets | Project-owned |
| `asset_sources/blender/clubhouse/pine_hills_golf_tv_v1.blend` | `vendor/models/clubhouse/pine_hills_golf_tv_v1.glb` | Lounge golf television | Project-owned |
| `asset_sources/blender/clubhouse/pine_hills_water_cooler_v1.blend` | `vendor/models/clubhouse/pine_hills_water_cooler_v1.glb` | Public water cooler | Project-owned |
| `asset_sources/blender/clubhouse/pine_hills_public_waste_bin_v1.blend` | `vendor/models/clubhouse/pine_hills_public_waste_bin_v1.glb` | Public waste bin | Project-owned |
| `asset_sources/blender/clubhouse/pine_hills_public_waste_bin_overflow_v1.blend` | `vendor/models/clubhouse/pine_hills_public_waste_bin_overflow_v1.glb` | Overflowing-bin cleanup variant | Project-owned |
| `asset_sources/blender/clubhouse/pine_hills_front_desk_clutter_v1.blend` | `vendor/models/clubhouse/pine_hills_front_desk_clutter_v1.glb` | Front-desk operational dressing and clutter | Project-owned |
| `asset_sources/blender/clubhouse/pine_hills_lounge_litter_v1.blend` | `vendor/models/clubhouse/pine_hills_lounge_litter_v1.glb` | Pizza box and empty-cup cleanup dressing | Project-owned |
| `asset_sources/blender/clubhouse/pine_hills_fallen_frame_v1.blend` | `vendor/models/clubhouse/pine_hills_fallen_frame_v1.glb` | Fallen picture-frame cleanup target | Project-owned |
| `asset_sources/blender/clubhouse/pine_hills_floor_plant_v1.blend` | `vendor/models/clubhouse/pine_hills_floor_plant_v1.glb` | Large broadleaf floor plant | Project-owned |
| `asset_sources/blender/clubhouse/pine_hills_counter_plant_v1.blend` | `vendor/models/clubhouse/pine_hills_counter_plant_v1.glb` | Small upright counter plant | Project-owned |

The authoritative build and fresh GLB round-trip reports are
`asset_sources/blender/clubhouse/pine_hills_interior_asset_build_manifest_v1.json`
and `asset_sources/blender/clubhouse/pine_hills_interior_asset_verification_v1.json`.

### Pine Hills original texture art (2026-07-22)

The following raster sources were generated specifically for Golf Flipper with
the preinstalled built-in OpenAI Imagegen tool. No reference image, downloaded
asset, real club identity, trademark, or third-party artwork was supplied. The
generated files contain no text; exact Pine Hills and product wording is added
deterministically by the runtime canvas renderers. License/use: original
project-commissioned generated art for Golf Flipper, with use governed by the
applicable OpenAI terms; no third-party license or attribution requirement.

| Runtime source | Use | SHA-256 |
|---|---|---|
| `public/assets/textures/clubhouse/pine-hills-course-photo-v1.png` | Framed municipal-course photograph | `08AF808B0431DAA63A5F073EA615010797F7AA6A58AA1E1456829B6F67C091A4` |
| `public/assets/textures/clubhouse/pine-hills-tournament-poster-background-v1.png` | Text-free vintage tournament-poster background | `3E652431D1B13EA37925FA8C688C3BB3EA3FB8DC5F7F336862E901925AC1EA3B` |
| `public/assets/textures/shop/pine-hills-package-background-atlas-v1.png` | Four-quadrant balls/accessories/water/snacks package-art background atlas | `EA883F2E2DB1EB2FA3E9B8BCEF73313E6181CFB7122F5177C3CBAB3F10A00C2C` |

Course-photo prompt:

```text
Use case: stylized-concept
Asset type: original framed course-photo texture for a first-person golf clubhouse game
Primary request: create an original, text-free landscape image of a modest municipal golf course at golden hour, viewed from beside the first tee toward a rolling fairway and small green
Scene/backdrop: mature pines, worn but cared-for tee markers, slightly patchy summer turf, distant low foothills, no clubhouse visible
Style/medium: polished stylized editorial golf photography with lightly painterly texture, believable rather than photoreal, suitable for a warm municipal clubhouse interior
Composition/framing: horizontal 3:2 composition, strong fairway leading line, calm negative space, all important content within a generous safe margin for cropping into a frame
Lighting/mood: warm late-afternoon sunlight, nostalgic and welcoming, restrained contrast
Color palette: warm cream highlights, deep golf green, muted sage, natural oak-brown earth, soft blue-gray distance
Constraints: entirely original; no people; no logos; no typography; no letters; no numbers; no watermark; no border or picture frame; avoid luxury resort imagery and avoid hyperrealism
```

Tournament-poster prompt:

```text
Use case: stylized-concept
Asset type: original vintage tournament-poster background texture for a framed clubhouse wall prop
Primary request: create a text-free 1960s municipal golf tournament poster illustration background showing a golfer finishing a drive on a windswept public course
Scene/backdrop: low pine-covered hills, simple clubhouse flag in the far distance with no emblem, graphic clouds, lightly worn paper character
Style/medium: original mid-century screen-print illustration, bold simplified shapes, limited inks, believable aged offset-print texture, not a copy of any real poster or artist
Composition/framing: vertical 2:3 poster, golfer in lower-right third, large clean negative-space band across the upper third reserved for deterministic title lettering added later, generous safe margins
Lighting/mood: optimistic civic-event nostalgia, warm afternoon
Color palette: warm cream paper, deep golf green, muted sage, medium walnut brown, warm charcoal, restrained brass-gold accent
Constraints: no text; no letters; no numbers; no logos; no watermark; no border or picture frame; no real tournament, organization, person, or brand references; avoid photorealism
```

Package-background prompt:

```text
Use case: product-mockup
Asset type: original fictional golf pro-shop package-label background atlas for in-game texture use
Primary request: create one perfectly front-facing square texture atlas with four distinct text-free packaging-art panels arranged in an exact 2 by 2 grid
Panel 1 upper-left: abstract contour lines and a small dimpled golf-ball motif for golf balls
Panel 2 upper-right: crossed tee silhouettes and subtle diagonal stripes for golf accessories
Panel 3 lower-left: flowing fairway and pine silhouettes for bottled spring water
Panel 4 lower-right: simple sunburst over rolling greens for clubhouse snacks
Style/medium: polished stylized screen-printed packaging illustration, flat graphic shapes with restrained paper-grain texture, production-ready game texture source
Composition/framing: exact equal quadrants separated by a wide plain warm-cream gutter; every motif centered with generous internal safe margins; orthographic/front-on with no perspective, no box mockup, no shadows
Color palette: deep golf green, muted sage, warm cream, medium walnut, restrained brass, warm charcoal
Constraints: entirely original; no text; no letters; no numbers; no logos; no barcode; no watermark; no gradients crossing quadrant boundaries; no photographic objects; no package geometry; avoid tiny micro-detail
```

## Golf-cart progression fleet (2026-07-22)

`tools/blender/build_golf_carts.py` reproducibly authors five original,
project-owned golf-cart assemblies from Blender factory settings: Basic,
Standard, Premium, High-End, and Luxury. The owner-supplied images in
`Designs/Golf_Carts/` are visual references only; they are not distributed as
runtime textures or geometry. No Tripo source, downloaded model, marketplace
asset, external texture, generated artwork, or third-party asset is
incorporated.

Editable sources are in `asset_sources/blender/golf_carts/`; canonical runtime
GLBs and their per-tier integration metadata are in
`vendor/models/golf_carts/`. Project-authored paint-roughness and upholstery
roughness/normal maps are in `asset_sources/textures/golf_carts/`; these are
original generated pipeline outputs, not third-party downloads. Each asset
includes three descending LODs,
simplified `COL_*` collision meshes, seats and foot anchors, entry/exit points,
driver and chase camera anchors, parking/service/charging datums, golf-bag and
storage slots, functional steering and wheel pivots, and separately operable
closures appropriate to its tier. Exact dimensions, hierarchy, triangle and
material metrics, topology checks, source/export paths, and clean GLB re-import
results are recorded in
`qa/golf-carts/blender/iteration-04/golf_cart_build_report.json` and
`qa/golf-carts/blender/acceptance/golf_cart_acceptance_report.json`. License:
**Golf Flipper project-owned original work**. Current deterministic build:
`2.4.0-runtime-door-batching` with Blender `5.1.2`.
