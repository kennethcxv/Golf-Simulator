# Store Display Asset Library

This library contains 90 authored retail fixtures: all 18 requested display
families at five visibly and structurally increasing quality tiers. It was built
from the three supplied `Designs/ClubHouse` references without downloading or
embedding external assets.

## Family coverage

| Family | Asset IDs |
| --- | --- |
| Clothing racks | `pf_display_clothing_rack_t1` through `_t5` |
| Hat walls | `pf_display_hat_wall_t1` through `_t5` |
| Shoe displays | `pf_display_shoe_display_t1` through `_t5` |
| Golf club walls | `pf_display_golf_club_wall_t1` through `_t5` |
| Ball displays | `pf_display_ball_display_t1` through `_t5` |
| Accessory racks | `pf_display_accessory_rack_t1` through `_t5` |
| Snack shelving | `pf_display_snack_shelving_t1` through `_t5` |
| Drink refrigerators | `pf_display_drink_refrigerator_t1` through `_t5` |
| Impulse shelves | `pf_display_impulse_shelf_t1` through `_t5` |
| Checkout displays | `pf_display_checkout_display_t1` through `_t5` |
| Feature tables | `pf_display_feature_table_t1` through `_t5` |
| Window displays | `pf_display_window_display_t1` through `_t5` |
| Luxury display islands | `pf_display_luxury_display_island_t1` through `_t5` |
| Wall slat systems | `pf_display_wall_slat_system_t1` through `_t5` |
| Built-in cabinetry | `pf_display_built_in_cabinetry_t1` through `_t5` |
| Glass display towers | `pf_display_glass_display_tower_t1` through `_t5` |
| Corner shelving | `pf_display_corner_shelving_t1` through `_t5` |
| Rotating displays | `pf_display_rotating_display_t1` through `_t5` |

## Deliverables

- Editable Blender sources: `Assets/pro_shop/source/fixtures/store_displays/`
- Runtime GLBs: `Assets/pro_shop/glb/fixtures/pf_display_*_t*.glb`
- Per-asset manifest fragments: `Assets/pro_shop/manifests/fragments/`
- In-game lazy catalog: `src/data/storeDisplayCatalog.js`
- Isolated first-person review runtime: `src/render3d/clubhouse/storeDisplayRuntime.js`
- Repeatable authoring: `tools/blender/build_store_display_assets.py`
- Factory-clean GLB validation and comparison renders:
  `tools/blender/validate_store_display_assets.py`

The runtime loads no display geometry in ordinary gameplay. Add
`?storeDisplayShowroom=<family>` to the game URL to load one five-tier family
into the isolated review showroom. The public `clubhouse.storeDisplays` API can
then switch families without mutating player, shop, economy, or save state.

## Progression and technical contract

Within every family, tiers 1–5 strictly increase authored width, depth, height,
stock capacity, material grade, custom woodwork grade, integrated light count,
and complexity grade. The shared material progression is utility painted steel,
charcoal and natural oak, crafted oak and brass, walnut boutique casework, then
cream/walnut/brass/glass private-club millwork.

Every GLB is self-contained and UV mapped, carries reference and tier metadata,
has simplified `COL_` collision geometry and stock sockets, and exports without
cameras or Blender lights. Refrigerator doors, glass-tower doors, premium
cabinet doors, and rotating carousels remain separate moving parts with usable
pivots. Integrated illumination is represented by emissive fixture meshes so it
is stable in the game renderer.

## Validation evidence

Local QA evidence is written beneath `qa/store_display_assets/` and includes:

- clean Blender re-import reports and one uncropped five-tier sheet per family;
- four complete visual-review iterations, each with an explicit list of at least
  ten defects and corresponding revisions;
- a final 18-family browser pass, normal-control screenshot, and gameplay video;
- console, save-integrity, asset-footprint, and before/after performance reports.

`tests/store-display-assets.test.js` is the tracked acceptance contract for exact
family coverage, reference hashes, upgrade progression, manifest/catalog paths,
UVs, collisions, sockets, metadata, light counts, moving pivots, clean re-import,
and comparison-sheet coverage.
