# Property Expansion / World Overhaul — Baseline Audit

Captured 2026-07-19 before implementation. This is a factual starting-point record, not a completion claim.

## Branch and preservation boundary

- Target branch: `overnight/property-expansion-world-overhaul`
- Isolated worktree: `C:\Users\Kenneth\Documents\GitHub\Golf-Flipper-property-expansion-world-overhaul`
- Start commit: `0c5137e5f0efac9627ce2309b9e66936f1eeb769` (`main`, `Register production Phase 8: the card swipe as a judged gesture (pure)`)
- No Git remote is configured, so the local `main` ref is the only authoritative base available.
- The original repository worktree was already dirty on `integration/all-verified-work-2026-07-18`; it and every other agent worktree were left untouched.
- Dependency install: `npm ci` succeeded. It reported one high-severity audit item; no automatic dependency rewrite was attempted.
- Baseline unit/integration suite: **516/516 passing** (`npm test`).

## Checkout priority gate

Checkout is not accepted on the start commit. `REGISTER.md` and `SESSION_STATE.md` explicitly list missing actor-led goods, card, cash, receipt, bag and customer-hand-off motion; missing player hands; roughly 22 named register animations; placeholder customers; and no recorded end-to-end proof. A state transition or passing unit test therefore cannot unlock unrelated production work.

A later clean branch, `overnight/checkout-polish` at `473b0e18`, contains focused physical-checkout commits and four iterations of prior QA. It is only a candidate for integration: after this audit is checkpointed, it must be merged into this isolated branch and both card and cash routes must be replayed through normal controls with new recordings, save/load checks, console checks and matched performance evidence. The prior branch's report is useful evidence, but is not being treated as proof for this branch.

## Repeatable browser baseline

The baseline used Chrome through the repository's Playwright harness, a deterministic save fixture, 1600×900 at device scale 1, 14:00 game time, and fixed world anchor `bx=-8`, `bz=228`. The run completed with `ok: true` and wrote 19 screenshots plus `baseline-result.json`.

Run from the isolated worktree while the game is served on port 8467:

```powershell
$env:QA_BASE_URL='http://localhost:8467/'
$env:QA_RESULT_PATH='qa/property-expansion-world-overhaul/baseline/baseline-result.json'
node 'C:\Users\Kenneth\Documents\GitHub\Golf-Flipper-checkout-polish\tools\qa\run-playwright.cjs' tools/qa/property-overhaul-baseline.js --bootstrap
```

The fixture seeds data only to make the requested scenes reachable. Editor, laptop, cleaning tools and active-tool captures are entered through their normal keyboard/mouse controls.

## Current system map

| Area | Current source of truth | Baseline capability / gap |
|---|---|---|
| Interior cleaning | `src/sim/shop.js`, `src/render3d/clubhouse/dirt.js`, `src/render3d/clubhouse.js` | Grime grid and vacuum interaction exist; the held vacuum is primitive and has no physical full-machine asset or hands. |
| Exterior washing | `src/sim/washing.js`, `src/render3d/clubhouse/washing.js`, `src/render3d/courseScene.js` | Persistent washable masks and tiered washer logic exist; held rig/effects are placeholder geometry. |
| Hands and tools | `src/render3d/fpHands.js`, `src/render3d/courseScene.js` | A small purpose-built hand helper exists, but tool setup is distributed and several tools do not share a production-quality rig/animation contract. |
| Furniture / fixtures | `src/sim/layout.js`, `src/render3d/clubhouse/buildMode.js`, `src/data/shopLayout.js` | Existing fixtures can be moved with collision/path validation. Supplier decor is tracked in shop stock and fixed decor spots, not a general owned, storable, per-property placement inventory. |
| Course editing | `src/sim/terrainEdit.js`, `src/ui/worksPanel.js`, `src/render3d/courseScene.js` | Surface painting, sculpting, tee/pin changes and hole markers exist. There is no sellable landscaping catalog, tree-placement preview, property inventory, robust history, search/filter hierarchy or commercial feedback loop. |
| Trees | `src/render3d/courseScene.js`, `vendor/models/trees/` | Six Kenney CC0 variants are loaded/instanced with procedural fallback. They are not purchasable/removable species assets and have no explicit LOD/collision objects. |
| Tractor | `src/sim/tractor.js`, `src/render3d/courseScene.js` | Repair progression and driving exist. The restored and broken AI models are single baked meshes, so wheels, steering and attachments cannot move independently. |
| Golf cart | `src/render3d/courseScene.js`, `vendor/models/golf_cart.glb` | One ambient/traversal cart exists. `src/ui/laptop.js` explicitly states that a fleet, cart condition and assignment are not simulated. The asset is monolithic. |
| Green fees / customers | `src/sim/club.js`, `src/sim/reservations.js`, `src/sim/rounds.js`, `src/sim/golfers.js` | Green-fee pricing, reservations, check-in and golfers exist. Cart fees, cart eligibility/assignment/use/return and fleet operating economics do not. |
| Shop progression | `src/sim/shop.js`, `src/ui/laptop.js`, `src/data/shopItems.js` | Stock, deliveries, fixtures, cleanliness and capped decor finish exist. Progression is mostly a condition number and fixed catalog rather than clearly readable tier unlocks tied to floor presentation. |
| Property market | `src/sim/valuation.js`, `src/sim/marketplace.js`, `src/sim/property.js`, `src/sim/empire.js`, `src/ui/marketplacePanel.js`, `src/ui/empirePanel.js` | Honest live valuation, listings, purchase/sale, shared wallet, switching and passive parked-property simulation already exist. Auction/offer flow and the requested deeper cross-property inventory/fleet lifecycle are absent. |
| Deliveries | `src/sim/shop.js`, `src/sim/deliveries.js`, `src/ui/laptop.js` | Physical carton receiving/opening/stocking exists. Standard lead times are multi-day; UI exposes day/window language rather than a useful short real-time ETA and express choice. |
| Characters | `src/render3d/characterAsset.js`, `src/render3d/clubhouse.js`, `src/render3d/courseScene.js` | Code-built articulated figures work in the sim. They remain visibly primitive, with block limbs, weak hands/faces, floating headwear and limited transaction acting on the start commit. |
| Save/load | `src/sim/state.js`, `src/sim/empire.js`, `src/core/storage.js` | State and empire snapshots include property, tractor, shop, reservations and holdings; migrations preserve old saves. Every new inventory, fleet, editor and placement schema needs additive defaults and legacy fixtures. |

## Asset inventory and classification

The Blender 5.1.2 audit imported the runtime GLBs without editing or overwriting their sources. Full hierarchy, transforms, UV, origins and preview renders are in `baseline/blender/asset-audit.json`.

| Runtime asset | Meshes | Triangles | Materials | Asset-space dimensions (m) | Classification | Production blocker |
|---|---:|---:|---:|---|---|---|
| `tractor_red.glb` | 1 | 59,533 | 1 | 0.588 × 0.980 × 0.744 | weak | Monolithic Tripo mesh; no wheel/steering/attachment pivots, collision proxy, animation or LOD. |
| `tractor_broken.glb` | 1 | 68,221 | 1 | 0.981 × 0.564 × 0.791 | weak | Monolithic and higher-poly than the repaired model; no moving/repair parts, collision proxy or LOD. |
| `tractor.glb` scripted fallback | 43 | 1,628 | 7 | 1.440 × 3.885 × 2.434 | placeholder | Useful named-piece structure, but visibly crude and still lacks authored animation/collision/LOD. |
| `golf_cart.glb` | 1 | 48,073 | 1 | 0.981 × 0.447 × 0.591 | weak | Monolithic Tripo mesh; wheels and steering cannot articulate; no collision proxy or LOD. |
| `shed.glb` | 1 | 54,074 | 1 | 0.980 × 0.906 × 0.858 | weak | Baked single mesh, dense for a static prop and inconsistent with the stylized world. |
| `leaves_pile.glb` | 1 | 19,435 | 1 | 0.878 × 0.979 × 0.434 | weak | Dense single-purpose prop with no LOD. |
| `club_sign.glb` | 1 | 15,407 | 1 | 0.548 × 0.979 × 0.721 | weak | Baked text/style and no LOD; scale dominates the approach in player view. |
| `tee_sign_broken.glb` | 1 | 20,006 | 1 | 0.304 × 0.405 × 0.979 | weak | Dense monolith with no replaceable board/leg parts or LOD. |
| `course_sign.glb` | 1 | 17,692 | 1 | 0.153 × 0.383 × 0.979 | weak | Dense monolith with no reusable text/marker surface or LOD. |
| `clubhouse_ext_opt.glb` | 1 | 66,711 | 1 | 0.568 × 0.982 × 0.492 | weak | Optimized but still monolithic/baked; visibly stretched at current in-game scale. |
| `tree_default.glb` | 1 | 114 | 2 | 0.755 × 0.654 × 1.708 | placeholder | Extremely simple pastel/faceted silhouette; no authored collision or LOD naming. |
| `tree_oak.glb` | 1 | 196 | 2 | 0.641 × 0.740 × 1.226 | placeholder | Species reads as a faceted blob; no authored collision or LOD naming. |
| `tree_pineDefaultA.glb` | 1 | 230 | 2 | 0.532 × 0.532 × 1.546 | placeholder | Generic cone stack; no authored collision or LOD naming. |

No runtime GLB exists for a vacuum machine, a rigged first-person vacuum, a pressure-washer machine, a rigged first-person washer, or a production rigged character. The owner-supplied Tripo originals remain protected. Existing source/license records identify those models as owner-provided project assets, the tree kit as Kenney CC0, and the scripted fallback/register/interior kits as project-owned. No external assets were downloaded during this audit.

## Visible baseline defects

| ID | Location / evidence | Defect and impact |
|---|---|---|
| B01 | `01-clubhouse-exterior.png` | Exterior composition is flat and visually dirty; the oversized foreground club sign competes with the building instead of guiding arrival. |
| B02 | `02-front-entrance.png` | The arrival view reads from inside/through the threshold, with floor litter and weak wayfinding; the entrance does not yet present a polished first impression. |
| B03 | `03-maintenance-yard.png` | AI-scanned shed, machinery and debris have incompatible density/material language beside the simplified course world. |
| B04 | `04-current-tractor.png` | The photoreal/baked tractor is always staged as a rigid object; no wheel rotation, steering, suspension, attachment joints or readable functional controls. |
| B05 | `05-current-golf-cart.png` | The ambient cart is a rigid green monolith with no wheel/steering articulation, no fleet identity and no visible customer-use loop. |
| B06 | `06-current-shed.png` | Dense baked shed lacks modular doors/interior/readable interaction and looks imported rather than authored for the warm cream/green/walnut palette. |
| B07 | `07-current-sign.png` | Sign scale and baked surface dominate the approach, while no reusable typography/status treatment connects it to property progression. |
| B08 | `08-current-house.png` | Groundskeeper house side/back is visibly distorted and stretched in game; the attractive isolated scan does not survive current world scale/placement. |
| B09 | `09-current-leaf-pile.png` | Dense leaf scan sits as an isolated mound without convincing contact, cleanup breakup or stylized integration. |
| B10 | `10-current-character-and-hat.png` | Character has box torso/limbs, sphere head, minimal face/hands and a floating flat hat; product carry/handoff does not read as believable acting. |
| B11 | `11-current-shop-and-register.png` | Shop is functional but visually sparse and cluttered; fixture quality, aisle presentation and register focus fall short of the benchmark bar. |
| B12 | `12-current-vacuum.png` | Held vacuum is oversized floating primitive geometry; no visible hands, hose, body, grip or believable tool scale. |
| B13 | `13-current-vacuum-active.png` | Active state is almost visually identical to idle; no strong contact animation, floor-head motion, dust response or readable completion feedback. |
| B14 | `14-current-pressure-washer.png` | Washer is a floating black pipe/low-poly hand with no machine body, hose path, two-hand grip, recoil or convincing silhouette. |
| B15 | `15-current-pressure-washer-active.png` | Spray reads as a small yellow blob instead of a directional water jet with mist, wet response and surface contact. |
| B16 | `16-course-and-tree-baseline.png` | Tree species are pastel low-poly cylinders/blobs with weak canopy/trunk proportion and little authored landscaping structure. |
| B17 | `17-current-course-editor-no-tree-placement.png` | Editor is a compact debug-like panel limited to surface/sculpt/hole markers; no landscaping catalog, tree preview, inventory, search/filter, history or clear commercial feedback. |
| B18 | `18-current-delivery-eta.png` | Delivery shows “Later this week” and a day/window, leaving a multi-day wait and no express option or useful short countdown. |
| B19 | `19-performance-fixed-camera.png` | The view contains 1,262 visible meshes, about 2.00M scene triangles and 269 materials, leaving limited headroom for a richer world without batching/LOD/resource work. |
| B20 | Runtime diagnostics | Repeated Canvas2D readback warnings, a Three shader warning and aborted lazy-model requests pollute diagnostics even though no page/console error was raised. |

## Performance baseline

| Sample | Average FPS | 1% low FPS | Worst frame | Geometry resources | Texture resources | JS heap |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 89.06 | 71.43 | 16.7 ms | 1,186 | 227 | 122.6 MB |
| 2 | 88.90 | 71.43 | 61.3 ms | 1,301 | 227 | 133.0 MB |
| 3 | 90.34 | 60.24 | 16.8 ms | 1,301 | 227 | 158.5 MB |

Scene traversal at the fixed camera found 1,262 visible meshes, 2,002,447 triangles and 269 distinct materials, with 22 active `window` event listeners. Texture-memory bytes and UI-update frequency were not instrumented and are recorded as `null`, not guessed.

The baseline script's composer path resets `renderer.info`, so its reported one draw call / one rendered triangle values are invalid and must not be used for comparison. Before the matched after-run, the instrumentation must measure a full rendered frame without the reset or use a scene/renderer hook that produces credible calls and submitted-triangle counts. The scene traversal numbers above remain valid as the initial complexity reference.

## Narrow implementation order and gates

1. Checkpoint this audit and all raw baseline evidence without touching other worktrees.
2. Integrate the clean checkout candidate, replay both card and cash routes with normal controls, and repair anything that prevents complete physical goods/payment/receipt/bag/customer handoffs, safe save/load, clean console output, video/audio proof or stable performance.
3. Build one additive, migrated ownership/placement foundation shared by shop furniture, landscaping and property-scoped inventory. Preserve current retail stock and all legacy saves.
4. Expand the course editor through that foundation: catalog/search/filter, previews, legal placement/removal, costs/refunds, undo/redo, readable feedback and valuation/operations consequences.
5. Replace production-blocking cleaning, cart and tractor assets through repeatable Blender scripts with real dimensions, named moving pieces/pivots, simplified collision and LOD; integrate them into normal gameplay before calling the assets done.
6. Add cart fleet, fee, assignment/use/return/condition/economics and connect it to existing reservations, golfers, rounds, reviews and valuation.
7. Deepen shop tiers, delivery ETA/express choice, character acting, entrance cleanup and property/multi-location flows only through existing source-of-truth systems.
8. Add migration fixtures and lifecycle tests for every schema, then run four full inspect/fix/compare browser iterations, matched performance, all normal routes, screenshots and recordings.
9. Commit only independently stable increments and finish with a clean target worktree.

Risk controls: no raw Tripo overwrite, no unapproved download, no parallel property source of truth, no cosmetic fake for a missing simulation, and no later milestone while checkout acceptance is still open.
