# Golf Flipper pro-shop overhaul - final report

Date: 2026-07-20

## 1. Branch

`overnight/pro-shop-overhaul`, developed in the dedicated worktree `C:/Users/Kenneth/Documents/GitHub/Golf-Flipper-pro-shop-overhaul`. It has not been merged into `main`; the original worktree was not modified.

## 2. Starting commit

`0c5137e5f0efac9627ce2309b9e66936f1eeb769` (local `main`). Baseline provenance, launch protocol, 516-test starting suite, player-camera findings, and initial metrics are in `baseline-audit.md`.

## 3. Final commit

- Final implementation commit: `f4cb3b6` (`assets(shop): complete fitting-room hardware`).
- Final documentation commit: branch `HEAD`, the commit containing this report and the closed completion audit.

## 4. Commits

Twenty-one focused implementation/evidence commits follow the starting commit:

1. `431c28c` - `audit(shop): map fixtures products and visual blockers`
2. `9a349e8` - `feat(shop): author retail floor plan and fixture sockets`
3. `a919162` - `feat(shop): install authored pro-shop fixture pack`
4. `d8f7672` - `fix(shop): clarify club and bag presentations`
5. `4cea27a` - `fix(checkout): make cash handoffs production-safe`
6. `1fc80ca` - `fix(weather): shelter the pro shop from rain`
7. `df008a4` - `test(shop): record final visual and transaction acceptance`
8. `0be56c0` - `test(perf): verify the sheltered final shop`
9. `dcc62fc` - `chore(shop): normalize acceptance evidence`
10. `2c3a442` - `audit(shop): reopen unmet production gates`
11. `1892462` - `feat(shop): make tiers and customer experiences physical`
12. `f22627d` - `feat(shop): replace key retail fixtures with Blender modules`
13. `82277e1` - `art(shop): complete first acceptance visual pass`
14. `572462c` - `art(shop): complete second acceptance visual pass`
15. `616036e` - `art(shop): complete third acceptance visual pass`
16. `8be3dc8` - `art(shop): complete fourth acceptance visual pass`
17. `8b59597` - `test(checkout): prove natural card and cash sales`
18. `1e249d2` - `fix(shop): prove physical stocking and reload routes`
19. `c388539` - `test(shop): prove mixed shoppers and full-store route`
20. `a09342d` - `perf(shop): stabilize repeated customer and laptop routes`
21. `f4cb3b6` - `assets(shop): complete fitting-room hardware`

## 5. Floor-plan changes

The municipal clubhouse remains a 21 x 13.5 game-unit shell with a roughly 16 x 13 sales floor and a distinct office/stockroom wing. The retail plan now uses:

- Low New Arrivals and apparel tables on the entry/centre sightline.
- A continuous western driver/iron/putter wall.
- Northern ball, accessory, apparel, and hat wall bays.
- Eastern bags, fitting, shoes, cold drinks, snacks, and scorecard/member service.
- A clear southeast checkout production line and employee corridor.
- Tier-3 Tour Vault and putting studio destinations outside circulation.
- Authored main aisle, door, checkout, office, laptop, stockroom, receiving, and emergency routes.

Fixture placement, rotation, footprint, browsing side, stocking side, collision, and tier activation are data-owned in `src/data/shopLayout.js`. Layout/build-mode/socket/tier/checkout/door tests and Routes A/B/E prove the plan through normal controls.

## 6. Assets rebuilt

The production fixture pack contains 15 fixture GLBs plus one empty tour-bag GLB: club wall, pegboard, apparel wall, ball wall, hat wall, shoe wall, basket station, demo rack, feature table, fitting room, drinks fridge, snack rack, service station, premium case, putting demo, and empty retail bag. The fitting room's final pass includes curtain, mirror, bench, interior garment hooks, inset exterior panels, and named shared-material slots.

The register kit includes an empty live cash drawer, basket, open carrier, impulse rack, and divider. Existing project-authored merch/prop packs provide clothing, shoes, caps, bags, club heads, register hardware, printer, chairs, trophy, cartons, hand truck, and pendants.

No raw Tripo asset was overwritten and no third-party model was downloaded.

## 7. Blender sources

- `tools/blender/build_shop_fixtures.py` - complete fixture pack and empty bag; Blender 5.1.2 headless build.
- `tools/blender/build_merch.py` - apparel, cap, shoe, bag, and club-head products.
- `tools/blender/build_props.py` - furniture, register hardware, cartons, hand truck, and lighting props.
- `tools/blender/build_register.py` - empty cash drawer, basket, carrier, impulse rack, divider.
- `tools/blender/lib_model.py` - shared modelling helpers.
- `tools/blender/inspect_glb.py` - shipped triangle/material/UV/bounds inspection and preview rendering.

The scripts are the editable source of truth; no opaque `.blend` source is required. Exports use applied transforms, floor-centre origins, Y-up glTF conversion, named material slots, and game-side simplified collision.

## 8. GLB paths

Primary fixture outputs, all under `vendor/models/clubhouse/`:

- `club_wall_bay.glb`, `pegboard_wall.glb`, `apparel_wall.glb`
- `ball_wall.glb`, `hat_wall.glb`, `shoe_wall.glb`
- `basket_station.glb`, `demo_club_rack.glb`, `feature_table.glb`
- `fitting_room.glb`, `drinks_fridge.glb`, `snack_rack.glb`
- `service_station.glb`, `premium_case.glb`, `putting_demo.glb`, `bag_empty.glb`

Register/transaction outputs in the same directory: `cash_drawer.glb`, `basket.glb`, `bag_open.glb`, `impulse_rack.glb`, `divider.glb`, `register.glb`, `scanner.glb`, `cardterm.glb`, and `printer.glb`.

Merchandise outputs include `polo_hanging.glb`, `polo_folded.glb`, `jacket_hanging.glb`, `glove.glb`, `shoe.glb`, `shoe_pro.glb`, `cap.glb`, `cap_pro.glb`, `bag.glb`, and the four `head_*.glb` club families. `ASSET_SOURCES.md` records ownership and generation.

## 9. Product-display changes

The 49-entry shop catalog contains 42 physical retail lines and seven renovation items. All retail SKUs have exactly one eligible home fixture at each supported tier. Full premium presentation is 289 real units across exact 4-15-unit capacities; no decorative duplicate stock is used to fake fullness.

`fixtureSlots.js` owns capacity and product poses. Empty, partial, and full states render the exact saved count in bottom/fixture-supported order. SKU forms distinguish club shafts/heads/grips, ball cartons, hanging/folded apparel, shoes, bags, cans/bottles, snack packs, carded accessories, eyewear, umbrellas, towels, and scorecards. Shared stock geometry/materials and GLB instances prevent one unique material per unit.

## 10. Clothing

Polos have folded and hanging forms; jackets use a separate hanging silhouette; pants and shorts are folded; gloves and socks have appropriate small-goods presentation. The low feature table and perimeter apparel bay keep the central sightline open. Department signs, price rails, fitting links, and three-position table browsing are integrated. Customer Route C records apparel and fitting visits.

## 11. Clubs

Drivers, irons, wedges, and putters use distinct project-authored heads on readable shafts/grips. Three architectural wall bays provide sole troughs, lower rails, and upper clips so clubs no longer pass through cabinetry or float. Premium display heroes use deliberate scale/rotation on presentation cards. The demo area adds a separate three-putter rack and short customer putter-sweep state.

## 12. Shoes

The Blender shoe wall has three angled shelves, integrated under-shelf lighting, size-box ledges, restrained sign/price presentation, and an authored browse/try-on side. Standard tier introduces the shoe area; Route B orders, receives, and physically stocks North Ridge spikes; Route C records shoe browsing.

## 13. Hats

The former overcrowded radial tree was replaced by an eight-facing Blender wall module with visible brass pegs/stops. Caps use fitted domes, shorter pitched brims, color variants, exact sockets, and an aisle-safe browse point. The compact wall placement preserves the main aisle.

## 14. Bags

Bag stock uses a four-position platform with readable spacing, restrained category/price signage, and authored browsing/stocking sides. Empty-bag bodies remove the former uniform sightline-blocking club fans. Premium and base variants use shared leather/fabric/metal materials and remain separate from the checkout carrier.

## 15. Accessories

The north pegboard presents tees, towels, markers, divot tools, rangefinder, sunglasses, bottle, and umbrella with category-appropriate card/hook/riser forms. The ball wall, basket station, scorecard service stand, premium case, and checkout impulse rack give small goods clear homes. Invalid-category and full-capacity stocking is rejected without losing held inventory.

## 16. Checkout

The original transaction state machine and save authority were preserved. The rebuilt physical environment includes counter, employee corridor, staging tray, scanner volume, register display, live empty drawer and money, card terminal, receipt printer, bagging zone, basket set-down, impulse rack, scorecard/member service, clear queue, and customer handoff.

Natural acceptance does not call `prepareCheckoutQa`, `sendToCounter`, `debugSpawn`, or write inventory/customer/transaction/player state:

| Method | Customer and product | Physical result | Ledger/inventory result |
|---|---|---|---|
| Cash | Quinn B., `tees1` | Scan, total, take/deposit cash, drawer/change, receipt, bag, handoff, departure | $6 and one unit; shelf 14 -> 13; no held UID/transaction/customer |
| Card | Alex R., `glove1` | Scan, total, terminal approval, receipt, bag, handoff, departure | $19 and one unit; shelf 4 -> 3; no held UID/transaction/customer |

Deterministic component evidence additionally covers two-item card/cash, exact $14 change, and interrupted-sale reload rollback.

## 17. Snacks/drinks

The glass-front compact cold case presents water, sports drink, and soda. The adjacent four-tier rack presents TURN CRISPS, NINTH HOLE BAR, and CADDIE CRACKERS. Full presentation contains 24 drink and 24 snack units with exact sockets, category signs, prices, refrigerator/display lighting, and valid browsing points. The fictional label atlas is original Imagegen artwork; geometry remains Blender/Three.js-authored. The fridge is static because product selection does not require opening a door.

## 18. Fitting room

Premium tier unlocks a three-sided enclosure with a parked curtain, clear opening, bench, full-height mirror, two brass garment hooks, focused light, sign, walkable interior, and simple three-wall collision. Apparel/shoe stops can link to its exclusive occupancy socket and correct facing target. The short fitting state adds patience without implementing complex undressing. Socket, routing, save, visual, and Route C evidence cover it.

## 19. Lighting

The retail pass combines neutral-warm daylight, restrained general pendants/cans, club/apparel display strips, checkout task light, refrigerator light, and limited shadows. Basic/standard/premium scales are explicit: basic remains usable, standard restores the full practical rig, and premium increases display emphasis/accent. Four visual iterations corrected orange cast, blown print fields, inconsistent sign tone, and premium-case readability. Save/load reconstructs the derived tier exactly.

## 20. Materials

The shared Pinehollow kit standardizes warm cream, deep green, muted sage, medium walnut, natural oak, warm charcoal, restrained brass, dark rubber, clear/display glass, kraft, fabric, and leather. Canvas-procedural textures provide stylized PBR variation without external downloads. Blender `M_*` slots remap to this kit at runtime. Repeated full-store measurements hold 303 unique materials, 194 textures, and 6,091.66 MiB estimated uncompressed-plus-mips texture dimensions with no repeated growth.

## 21. Customer browsing

Every stock-bearing fixture has authored, transformed browse sockets and faces its product. Fitting, putting, and premium destinations have separate experience sockets. Reservations are exclusive and collision/routing tests keep them out of furniture.

Accepted Route C ran ten shoppers and observed club, apparel, shoe, hat/accessory, fitting, putting, premium, snack/drink, basket, queue, and checkout behavior. Four shoppers visibly used baskets, maximum queue depth was five, 14 distinct fixtures/experiences were visited, and sold/abandoned held UIDs remained safe. The customer state machine was extended through adapters; it was not replaced.

## 22. Stocking

The physical loop is supplier laptop -> real lead time -> delivery pad -> carry carton -> stockroom -> cut tape -> open flaps -> carry armful -> correct fixture -> hold E -> visible sockets. Prompts expose product, current count, capacity, and validity. Route A/B physically stocks Range-rock balls and newly unlocked shoes. Unit tests cover sealed/partial/empty cartons, full shelves, category rejection, remaining armfuls, conservation, and no duplication. The service door now opens automatically for cartons and unpacked goods.

## 23. Shop tiers

The current progression architecture supports:

- Basic: limited active fixtures/categories/customer cap, modest but functional lighting and checkout.
- Standard: broader categories, bags/shoes, improved light scale, more presentation/capacity.
- Premium: fitting room, putting studio/demo rack, Tour Vault, premium fixture/accent lighting, full 42-line catalog, and larger shopper capacity.

Tier visibility is physical, not a laptop-only number. Route B proves normal laptop purchasing, delivery, placement, stock, and world change. Tier/routing/save tests cover all three. A tier-4 luxury economy was not invented because none exists in the current progression system.

## 24. Save migration

Persisted/derived reconstruction covers fixture layout/rotation/storage, tier, sockets, per-SKU shelf/back stock, display/tier variants, lighting, signs/active fixtures, fitting/demo/premium destinations, checkout state, boxes/orders/held units, and removed legacy fixtures.

Route E used the real Esc menu to save/load untouched basic, upgraded, and partially stocked payloads. Cash, tier, every SKU, decor, layout, boxes, orders, held records, no duplicate fixtures, no stuck reload customer, and lighting reconstruction were exact in all three. Unit coverage also verifies premium sockets and partial states round-trip and legacy saves migrate safely.

## 25. Performance before/after

Accepted protocol: Chrome 150, ANGLE D3D11, 1600 x 900/DPR 1, same quality/state/cameras/warm-up, three six-second empty/stress samples, three four-second normal walks, exactly ten shoppers at each stress start, and a warmed 30-cycle laptop soak. The valid comparison baseline is the earliest same-environment D3D11 pass; its single samples make percentages directional.

| Scenario | Baseline avg / 1% low | Final median avg / 1% low | Draw-call delta | Scene-triangle delta | GPU geometry delta |
|---|---:|---:|---:|---:|---:|
| Empty/basic | 61.74 / 17.15 | 119.66 / 117.65 | +1.3% | +0.1% | +1.3% |
| Full/premium/10 shoppers | 16.39 / 8.00 | 32.67 / 20.00 | +3.1% | +0.5% | +2.5% |
| Full/premium normal walk | 93.75 / 40.00 | 112.26 / 59.88 | +11.9% | +0.6% | +2.6% |

Thirty laptop cycles completed with one root, no leftover overlay, exact FOV 60/near 0.15 restoration, listeners 85 -> 85, and heap 83.92 -> 93.34 MiB (+9.42). Repeated customer resets initially exposed a 1,565 -> 1,830 -> 2,092 GPU-geometry leak; idempotent procedural-character disposal fixed it to 1,320 -> 1,319 -> 1,317. The final fitting-hook asset check remained at 35.43/23.98 stress FPS and 1,319 geometries. Full raw results and declared gates are in `PERFORMANCE_ACCEPTANCE.md`.

## 26. Tests

- Final `npm test`: **533 passed, 0 failed, 0 skipped, 0 cancelled**.
- Changed JavaScript and QA harnesses pass `node --check`; `git diff --check` passes.
- There is no `build` script in `package.json`. The production path is validated via the served browser game, Playwright normal-control routes, and the Node suite.
- Contract coverage includes fixtures/GLBs/material slots, layout/collision/routes, product/category/sockets, empty/partial/full stock, checkout space/state/save, doors, laptop geometry/projection, tier/lighting, save migration, no duplicates/conservation, and character resource disposal.

## 27. QA paths

Authoritative reports:

- `qa/pro-shop-overhaul/COMPLETION_AUDIT.md`
- `qa/pro-shop-overhaul/ITERATIONS.md`
- `qa/pro-shop-overhaul/NATURAL_CHECKOUT.md`
- `qa/pro-shop-overhaul/ROUTES_A_B_E.md`
- `qa/pro-shop-overhaul/ROUTES_C_D.md`
- `qa/pro-shop-overhaul/PERFORMANCE_ACCEPTANCE.md`

Accepted evidence roots:

- Visual: `acceptance-visual-1-before/`, `acceptance-visual-1-after/`, `acceptance-visual-2-before/`, `acceptance-visual-2-after-accepted/`, `acceptance-visual-3-before/`, `acceptance-visual-3-after/`, `acceptance-visual-4-before/`, `acceptance-visual-4-after-accepted/`
- Natural checkout: `natural-checkout-acceptance/`
- Routes A/B/E: `routes-a-b-e-acceptance/`
- Routes C/D: `routes-c-d-acceptance-final/`
- Repeated performance: `performance-acceptance/`
- Final fitting asset: `fitting-hook-validation/` and `fitting-performance-validation/`

Every accepted visual run preserves browser/version/viewport/state/cameras, normal movement and clock proof, console/network diagnostics, screenshots, and route video where required. Across the committed QA tree there are more than 438 screenshots and 17 videos; older diagnostic folders remain clearly separate from the accepted paths above.

## 28. Known limitations

- Current progression has tiers 1-3 only. No unsupported luxury/tier-4 economy or invisible upgrade was invented.
- The putting studio is a short customer retail animation, not a player ball-physics minigame. This is deliberate and matches the instruction not to turn it into full golf gameplay.
- The refrigerator door is static because current browsing/selection does not require opening it.
- There is no dynamic sale-promotion system, so no fake sale sign is displayed. Price rails and category/wayfinding signs are real.
- Natural ambient checkout is timing-dependent by design; accepted cash/card evidence took 66.9 and 101.2 seconds.
- The valid D3D11 pre-overhaul baseline has one sample per scenario; final acceptance has three. Current absolute budgets and leak checks are authoritative; percentage deltas are directional.
- Chrome's Windows D3D compiler emits a non-fatal X4000 warning. Some asynchronous GLB requests end `ERR_ABORTED` when isolated QA contexts close or scenes are deliberately replaced. Accepted runs have no JavaScript page errors or HTTP 4xx/5xx asset failures.
- The repository has no configured remote and no build script. Nothing was merged into `main`.

## Final disposition

The shop floor is intentional, the starting presentation remains modest, premium ownership is visible, products and fixtures are physically credible, natural checkout and stock delivery work through normal controls, save/load is exact, repeated performance is inside declared budgets, all regression tests pass, accepted screenshots/videos exist, and the work remains isolated on the requested committed branch.
