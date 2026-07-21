# Furniture Catalog Production Record

## Scope and retained evidence

The shipped catalog contains 310 purchasable objects: 62 furniture families with
Basic, Commercial, Retail, Boutique, and Luxury versions. The category split is
60 retail displays, 20 counters/desks, 30 seating, 20 tables, 25 storage, 45
lighting, 30 architectural, 35 decor, 20 guest-facility, and 25 operations SKUs.

Every row has a price, price unit, package quantity and transaction cost, quality,
brand tier, useful description, rendered 320x180 thumbnail, category, level gate,
reputation gate, maintenance/comfort/prestige values, five-tier links, model family,
and placement mode. Flooring is honestly quoted per square foot and purchased as a
2,400 sq-ft fitted-room package.

Retained local evidence (ignored by Git because `/qa/` is an evidence workspace):

- Blender build report: `qa/furniture_catalog/blender_build_report.json`
- Independent all-GLB re-import: `qa/furniture_catalog/blender_validation.json`
- Functional/save acceptance: `qa/furniture_catalog/iteration-02/result.json`
- Progression/elite visual acceptance: `qa/furniture_catalog/iteration-03/result.json`
- Final pricing/production-floor acceptance: `qa/furniture_catalog/iteration-04/result.json`
- Final screenshots: `qa/furniture_catalog/iteration-04/01-before-default-room.png`
  through `07-luxury-chair-player-camera.png`
- Final gameplay recording:
  `qa/furniture_catalog/iteration-04/video/page@73b7945f67b32d66a4f323c40148ff4a.webm`
- Baseline/final performance results: `qa/furniture_catalog/baseline/performance.json`
  and `qa/furniture_catalog/iteration-04/performance.json`

The three user-provided `Designs/ClubHouse` images were inspected at original
resolution and used for family coverage, progression, proportion, and palette. They
remain direction references rather than redistributed model textures; exact names and
licensing status are recorded in `ASSET_SOURCES.md` and the Blender manifest.

## Blender and runtime asset proof

- 62 editable `.blend` sources; each contains the complete five-tier family.
- 310 distinct GLBs and 310 distinct Blender-rendered thumbnails.
- Independent re-import result: 310 passed, 0 failed, 0 warnings.
- 219,708 total triangles; 10,400 maximum triangles on one SKU.
- Applied mesh transforms, metre-scale envelopes, exact mount sockets, simplified
  `COL_` collision objects, and named shared stylized-PBR material slots.
- Runtime GLBs reuse materials by stable slot name; duplicate imported materials are
  disposed after remapping.
- Room-wide installations modify the actual live production surfaces. In particular,
  Asset 59's visible instanced floor receives the selected catalog floor material; the
  hidden fallback slab is not mistaken for the player-facing surface.

## Four visual QA iterations

Each iteration used the real 1600x900 browser game. Gameplay operations used B/I,
catalog buttons, placement previews, E confirmation, pause autosave, and Continue.
Level/reputation, frozen time, paused customers, and clean-room setup were explicit QA
presentation fixtures only.

### Iteration 1 - coverage and first playable integration

1. No complete catalog -> defined 62 families and 310 immutable SKUs.
2. No consistent upgrade arc -> linked exactly five increasing tiers per family.
3. Missing purchase metadata -> added all required economy, quality, gate, value, and copy fields.
4. No catalog art -> authored 310 Blender thumbnail renders.
5. No physical catalog models -> authored/exported 310 distinct GLBs.
6. Catalog definitions could become free inventory -> kept ownership sparse and purchase-created only.
7. Static layout could not represent new SKUs -> added serialised dynamic furniture instances.
8. Placement paths differed by object -> routed floor, wall, surface, ceiling, installation, and vehicle modes through the unified validator.
9. Purchases were not durable -> added versioned ownership/history and save migration.
10. Imported models multiplied materials -> remapped every catalog material to the shared runtime kit.

### Iteration 2 - catalog usability and save proof

1. Locked tiers dominated the first page -> defaulted the filter to Basic.
2. Purchased items were buried under old stock -> put the catalog collection first.
3. Existing renovation inventory was visually overwhelming -> collapsed it behind a disclosure row.
4. Generic SVG silhouettes looked provisional -> replaced them with real 320x180 Blender renders.
5. Lazy thumbnails appeared late during paging -> eagerly load only the 12 current-page images.
6. Searching `Flooring` missed the family -> included family/category labels in the search index.
7. Searching `Wall paneling` missed hyphenated fields -> normalised hyphens and spaces.
8. Cards hid comparison information -> exposed tier progression and four numeric values.
9. A placed GLB could silently fall back -> added expected/rendered/failure diagnostics and asserted them.
10. State proof stopped before reload -> used pause-menu autosave and Continue to verify purchases, installs, placement, and exact transform.

Result: 11/11 browser assertions passed; real GLB placement, shared materials, normal
autosave/Continue, and clean feature diagnostics were retained in iteration 02.

### Iteration 3 - progression and visible transformation

1. Locked-card opacity made text translucent over the room -> kept card copy opaque and desaturated only its image.
2. A chair proof camera selected the last legal side and landed behind a rack -> stop on the first legal player side.
3. Finish diagnostics changed while the floor did not -> found the hidden-fallback/live-Asset-59 split.
4. Luxury flooring initially read like ordinary strip oak -> introduced an authored interlocking parquet material.
5. Installations initially changed only scalar values -> swap albedo, normal, roughness, and material response on room surfaces.
6. Reinstalling could retain a prior map -> restore the default material look before applying the active installation.
7. Installed effects lacked aggregate proof -> exposed and asserted maintenance, comfort, prestige, and installed counts.
8. Promotion might have granted stock accidentally -> asserted that the level/reputation fixture leaves purchase count at zero.
9. Rapid actions stacked toasts over visual evidence -> allow transient feedback to clear before final room captures.
10. Baseline shader and cancelled fallback requests looked like feature failures -> classify only the documented baseline warning/aborted replacements as allowed.

Result: all progression, lock, installation, real-GLB, value, and console assertions
passed. The run also exposed the per-square-foot transaction and live-floor defects
that were closed in iteration 04.

### Iteration 4 - final economy, production surface, and presentation

1. A `$20 / sq-ft` floor bought the whole room for $20 -> added a 2,400 sq-ft package and $48,000 luxury transaction.
2. The button obscured rate versus transaction -> display `$20 / sq-ft` plus `Buy room $48,000` and package copy.
3. XP and resale still used the displayed rate -> base both on the actual package purchase cost.
4. Asset 59 hid the material-changing fallback -> bind the selected finish to the live production floor mesh.
5. Fractional texture repeats clipped at instanced-cell edges -> use one complete seamless motif per authored floor cell.
6. The first parquet pass was overly glossy -> reduce normal response and use a satin 0.58 floor roughness.
7. The old `herringbone` player-facing name overstated the generated pattern -> rename it `Interlocking parquet hardwood floor`.
8. Loose cleaning debris undermined the elite comparison -> clear saved debris and its named visual in the presentation fixture.
9. The final chair view could be obscured -> retain the first legal actor side and fixed player camera.
10. Visual appearance lacked an authoritative live-surface assertion -> verify Asset 59 mesh count, texture repeat, roughness, price charge, values, and render failures in the result JSON.

Result: 13/13 final browser assertions passed. The UI showed `$20 / sq-ft`, charged
exactly $48,000, the live Asset 59 mesh used the installed parquet material, two
installed finishes and one placed luxury chair contributed values, every expected
placed model rendered, and no feature console/page errors occurred.

## Performance comparison

The clean `1dfb9de` base and the final feature were measured back-to-back from fresh
Relaxed games at the same 1600x900 viewport, fixed clubhouse camera, 2 PM lighting,
paused clock/walk-ins, six-second warmup, and three 300-frame samples per scenario.
The baseline recorded a 177.9 ms external host spike, so draw/resource deltas provide
the more conservative regression comparison; the feature did not regress frame rate.

- Idle average: 38.44 FPS baseline -> 86.88 FPS feature; 1% low: 9.85 -> 43.19 FPS.
- Catalog open: 78.18 FPS average and 20.25 FPS 1% low on the feature build.
- Two-frame draw calls: 3,634 -> 3,772 (+3.80%); rendered triangles: 14,044,654 ->
  13,767,722 (-1.97%).
- Scene materials: 729 -> 793 (+8.78%); scene textures: 203 -> 204; estimated texture
  memory increased only 43,691 bytes; renderer geometries increased 8.88%.
- Thirty normal close/open pairs added zero active listeners. Five idle catalog
  seconds produced zero DOM mutations; toggle-loop retained heap was 113,964 bytes.
- Both performance runs passed and reported no console errors, warnings, or page errors.

The final repository suite passed all 245 test files in four bounded shards (62, 61,
61, and 61 files) with zero failures. The Blender 5.1 Sheet-6 clean-reimport gate also
passed all 10 assets, 120 mandatory checks, and both cross-asset checks.

## Console policy

The retained Chrome runs contain no furniture-feature errors or page errors. The only
accepted diagnostic is the repository's pre-existing Three.js shader compiler warning;
some earlier runs also recorded `ERR_ABORTED` when a production GLB replaced an in-flight
fallback request. Both are explicitly classified in the QA driver instead of being
silently discarded.

## Regeneration

1. `node tools/blender/export_furniture_manifest.mjs`
2. Run Blender 5.1 in background mode with `tools/blender/build_furniture_catalog.py`.
3. Run Blender 5.1 in background mode with `tools/blender/validate_furniture_catalog.py`.
4. `node tools/qa/run-furniture-catalog.cjs`
5. `node tools/qa/run-furniture-catalog-progression.cjs`
6. `node tools/qa/run-furniture-catalog-final.cjs`
7. Run `tools/qa/furniture-performance.js` against the fixed baseline and final servers.
8. `npm test`
