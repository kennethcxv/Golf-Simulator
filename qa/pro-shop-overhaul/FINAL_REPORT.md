# Golf Flipper pro-shop overhaul - final report

## Delivery

- Branch: `overnight/pro-shop-overhaul`
- Clean starting point: local `main` at `0c5137e5f0efac9627ce2309b9e66936f1eeb769`
- Original dirty worktree: preserved and not modified
- Scope: pro-shop retail floor, customer browsing/stocking integration, checkout acceptance, save safety, visual QA, and performance regression only
- Merge status: not merged

## Player-facing result

The shop now has a deliberate municipal-club retail plan: low new arrivals at the entrance; a continuous western club wall; northern ball, pegboard, and apparel presentations; an east-side bag, fitting-room, and shoe run; checkout-adjacent cold drinks, snacks, scorecards, and membership service; and tier-three Tour Vault and putting-studio destinations. Warm cream, deep golf green, muted sage, walnut, oak, charcoal, and restrained brass are shared across authored fixtures and runtime product presentation.

The sale catalog has 49 entries, of which 42 are physical retail lines and seven are renovation items. Seventeen retail SKUs were added for the missing putter, glove, pants, shorts, cap, divot tool, sunglasses, bottle, scorecard, drinks, snacks, bag, and shoe categories. All 289 possible displayed sale units use a single source of truth: exact authored capacities of 4-15 sockets per SKU in `fixtureSlots.js`. Every SKU has one home fixture. Browsing and stocking use separate authored sockets, and customers reserve them exclusively.

## Authored assets and licensing

Eleven project-owned GLBs were built by `tools/blender/build_shop_fixtures.py`: club wall, pegboard, apparel wall, low feature table, fitting room, drinks fridge, snack rack, service station, premium case, putting demo, and empty retail bag. Origins are floor-centre, transforms are applied, material slots are named and remapped to the existing clubhouse kit, moving/interactive roles stay separate, and collision uses simple game-side proxies. Raw Tripo assets were not modified.

No third-party asset was downloaded. `public/assets/textures/shop/turn-snacks-label-atlas.png` is original fictional packaging artwork generated with the preinstalled Imagegen workflow; it supplied the label language for TURN CRISPS, NINTH HOLE BAR, and CADDIE CRACKERS, while the rack and package geometry remain game/Blender-authored. Provenance is recorded in the repository `ASSET_SOURCES.md`.

## Checkout acceptance

`checkout-final/summary.json` records normal-control, player-facing card, cash, and partial-sale save/reload routes. Each completed sale scans two exact units, totals, takes payment, prints the receipt, bags, hands over, and waits for the customer to leave.

| Scenario | Result | Inventory/revenue invariant |
|---|---|---|
| Card | Passed | $66 revenue, 2 units, nothing held, no active transaction/customer; ball and glove shelves each 10 -> 9 |
| Cash | Passed | Exact $14 change interaction completed; same final $66 / 2-unit invariant and full cleanup |
| Save/reload halfway through scan | Passed | Both units returned, nothing held, zero phantom revenue, cash unchanged, register unlocked, no ghost sale |

The checkout evidence includes step-by-step screenshots and three recorded videos. The fix retained the existing transaction state machine and save architecture; it corrected screen-space palm placement and overlapping money hit selection.

## Visual and functional QA

- Baseline: 32 screenshots (16 starting + 16 fully stocked) and performance run.
- Round 1: 18-camera fully-stocked layout review.
- Rounds 2-4: 18 starting + 18 fully-stocked cameras per round.
- Final accepted round: 36 screenshots and one full-route video after the indoor-rain correction.
- Customer stress review: 10 active shoppers, 0.60-yard minimum separation, 15 reserved sockets, 15 unique reservations.
- Final browser capture: zero page errors; one known Chromium D3D shader compiler warning.
- Final automated suite: 519 passed, 0 failed.

The four review rounds and at least ten corrected weaknesses per round are itemized in `ITERATIONS.md`. `run.json` files preserve browser, viewport, state, camera, console, network, fixture-stock, and customer diagnostics.

## Performance comparison

Chrome was forced through SwiftShader on this host, so absolute frame rate is not representative of production hardware. The same route and viewport make the before/after scene counters useful. Because the six-second final full-shop sample was frame-starved, a 14-second full-shop sample was also recorded.

| Full tier-three shop + 10 shoppers | Baseline 6 s | Final extended 14 s | Change |
|---|---:|---:|---:|
| Average sampled FPS | 0.22 | 0.28 | +27.3% |
| Worst sampled frame | 4599.8 ms | 3708.2 ms | -19.4% |
| Visible meshes | 1,348 | 1,323 | -1.9% |
| Scene triangles | 2,125,241 | 2,064,350 | -2.9% |
| Unique materials | 296 | 316 | +6.8% |
| Unique textures | 173 | 194 | +12.1% |
| Active event listeners | 92 | 92 | no regression |

The exact six-second final scene snapshot was lighter still at 1,278 visible meshes and 2,043,601 scene triangles, but yielded no full-shop frame intervals under SwiftShader and is not used for the FPS comparison. The longer sample loaded more late assets and reached 104.96 MiB heap; the exact-duration comparison was 72.14 MiB baseline versus 71.51 MiB final. Normal `W` control moved 0.85 yards in the exact-duration route and 2.0 yards over the extended ten-second walk.

## Evidence index

- `baseline/` and `baseline-performance/run.json`: before state
- `iteration-1-layout/run.json`: floor-plan review
- `iteration-2-full/run.json`: merchandise presentation review
- `iteration-3-customer-flow-final/run.json`: shopper-flow stress review
- `iteration-4-final/run.json`: transaction/environment review before the rain correction
- `iteration-5-accepted/`: final after screenshots, run diagnostics, and video
- `checkout-final/`: card, cash, and save/reload screenshots, results, summary, and videos
- `final-performance/run.json`: exact six-second after comparison
- `final-performance-extended/run.json`: extended sampler used for final full-shop FPS

## Known environment diagnostics

Chromium's Windows D3D backend emits one non-fatal Three.js shader warning about a potentially uninitialized dynamic index. Some asynchronous, non-shop GLB prewarm requests report `net::ERR_ABORTED` when the QA page closes or a dynamic scene rebuild supersedes them. Required shop models are visibly present in the accepted screenshots, and there are no JavaScript page errors. No production blocker remains in the accepted checkout or shop routes.
