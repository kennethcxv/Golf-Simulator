# Integration checkpoint results

## 1. Furniture customization

- Source head: `b271903ce5d99478f026b0000b344dc957fe1255`
- Strategy: cherry-pick all five coherent product commits; preserve authorship and asset provenance.
- Integrated commits: `b33ef02`, `dcdd394`, `1d7e035`, `1547d96`, `44433f3`.
- Conflicts: none at this checkpoint.
- Parser: 185 JavaScript files passed.
- Focused tests: 18/18 passed.
- Full tests: 534/534 passed.
- Diff check: passed.
- Earlier fresh normal-control branch gate: 26/26 passed, including preview/final transform, floor/wall/counter/shelf placement, invalid collision, door clearance, move/store/sell, undo, save/reload, customer navigation, checkout and laptop access.
- Decision: unified catalog/layout/build mode is now canonical placement; later physical-system conflicts must adapt to it.

## 2. Inventory and delivery

- Source head: `12600d497cb94a8c3dd4983c6b311f2687c8e7e5`.
- Strategy: cherry-pick product commits `3022dce` and `5b0f39b`; exclude baseline/generated-evidence commits.
- Integrated commits: `f592d23`, `9c08b41`.
- Conflict: `src/render3d/clubhouse.js` updated the delivery vehicle and furniture preview in the same frame. Resolution keeps `updateDeliveryVehicle(dt)` and passes `dtMs` to the canonical placement builder; teardown now releases both placement listeners/visuals and every inventory-owned mesh/material/collider/cache.
- Rejected conflict path: `tools/qa/inventory-delivery-baseline.js` depended on an intentionally unselected baseline commit and was not present on main. The portable smoke/visual/save/reorder tools from the product commit are retained.
- QA repair: reorder acceptance now verifies the isolated `shopOrders` ledger delta, not total cash drift while unrelated clock expenses are allowed to post.
- Parser: 192 JavaScript files passed.
- Focused tests: 29 inventory tests plus all 18 placement tests passed (47/47).
- Full tests: 551/551 passed.
- Runtime smoke: fresh Relaxed property purchase reached walk mode and the live clubhouse with no console/page/blocking-request errors.
- Diff/conflict-marker check: passed.
- Decision: `inventoryLifecycle.js` is the canonical conserved quantity model; placement remains the transform authority.

## 3. Golf operations

- Source head: `52cfe7e12b013fc699382e076fe9bc443e77b815`.
- Strategy: cherry-pick the four core product commits and two laptop mutation/listener fixes; exclude baseline, timing-only QA adjustments, and generated evidence.
- Integrated commits: `2d9df6e`, `7d2b1f6`, `cdc6fb6`, `93936fe`, `5bab6b6`, `648f802`.
- Conflict: `src/ui/laptop.js` had one import-boundary conflict. Resolution retains inventory lifecycle quoting, fallback receiving, fixture capacity and exact order APIs while adding operations summaries, finance and policy APIs. Both page families use one laptop shell.
- Parser: 199 JavaScript files passed.
- Focused tests: all golf-operations/reservations plus prior inventory/placement suites passed.
- Full tests: 573/573 passed.
- Runtime smoke: fresh property purchase reached walk mode/live clubhouse with no console/page/blocking-request errors.
- Branch evidence interpretation: `walk.isFocused() === false` after closing the tee desk is correct—it proves the cashier camera latch was released. The nearly blank cash-receipt screenshot was captured during the 320 ms print animation; final visual QA will wait for animation completion instead of changing a functional receipt path prematurely.
- Diff/conflict-marker check: passed.
- Decision: reservations owns schedule/capacity/check-in/payment state and stable golf finance events; future customer integration consumes its IDs/events without duplicating bookings.

## 4. Customer simulation

- Source head: `3cfbca443adde45b2f8e224e36b4c88f1483fc65`.
- Strategy: cherry-pick the persistent lifecycle, physical-customer, visual-polish and final acceptance commits; exclude baseline/generated-evidence commits.
- Integrated commits: `08f080b`, `cd29103`, `f431718`, `7675995`; integration repairs: `45ce43e` and the customer checkpoint commit that records this section.
- Canonical boundary: `customerSimulation.js` owns physical identity, movement lifecycle, queues, stock reservation and satisfaction. `reservations.js` alone owns tee sheets, booking state, payment and course access. The 3D layer now opens the canonical tee-desk UI and never posts green-fee revenue directly.
- Conflict resolution: the legacy inline clubhouse customer controller was removed in favor of `clubhouse/customers.js`; placement, delivery rendering and the shared retail register were retained. A physical walk-in claims the one booking created by golf operations, and successful check-in callbacks release that same physical party.
- Regression coverage: booking moves update one arrival instead of duplicating it; active cancellation releases the matching party; prepaid physical binding and release do not post duplicate finance entries; full-stock customer fixtures enter through the inventory lifecycle ledger.
- Parser: all JavaScript/CommonJS/ESM sources passed.
- Focused tests: 58 customer, golf-operations and inventory-integration tests passed; protected register/inventory focused matrix later passed 46/46.
- Full tests: 593/593 passed.
- Runtime smoke: fresh property purchase reached walk mode/live clubhouse with no console/page/blocking-request errors.
- Normal-control customer gate: early, on-time and late reservations, cancellation, walk-in creation, patience abandonment, a half-scanned save and two reloads all passed; zero console/page errors.
- Checkout regression: distinct card and cash runs each scanned two physical items, completed payment/receipt/bagging/handoff, banked exactly two units for `$66`, reconciled the lifecycle ledger and ended with zero customer-held units.
- QA repairs: the front-desk harness now drives confirmation, cash settlement and course access through the canonical UI; it uses official operations reset and auditable inventory fixture intake. The checkout wrapper now honors the requested mode and fails on the register harness's own reconciliation result.
- Product repair found by normal controls: typing a walk-in holder now updates the existing Create button immediately; the prior button remained disabled until an unrelated rerender.
- Visual inspection: the tee-desk completion screens are legible and preserve the physical customer/counter context. Character styling remains intentionally low-poly and will be reviewed again in the final cross-system visual pass.
- Diff/conflict-marker check: passed.

## 5. Course maintenance

- Source head: `2a0ab21a735beb2b011a8625b3bd7a17c0a4391a`.
- Strategy: cherry-pick product commits `d402f17` and `9b664de`; exclude the branch baseline and generated-evidence commits. The completed branch's brittle, machine-specific QA script was executed from committed history for this checkpoint but was not imported into the integration branch.
- Integrated commits: `30ab3f1`, `fc42ff5`; integration test repair: `dc07075`.
- Save conflict: inventory and course maintenance independently called different schemas version 4. The integrated schema is version 5: inventory migration/recovery remains first, then customer and reservation recovery, followed by compressed hero-hole maintenance restoration. The golf migration assertion now follows the exported canonical version instead of hard-coding 4.
- Canonical boundary: the existing coarse `turf` arrays remain authoritative for the whole course. `courseMaintenance.js` adds a one-yard hero-hole detail model whose actions synchronize back to coarse turf. Outside the hero bounds, divot repair, bunker raking and tractor mowing explicitly delegate to the established coarse hooks instead of disabling them.
- Main-loop conflict: both tee-desk refresh and the maintenance tablet refresh run; both panels are mounted in the single game UI; pointer-lock hints account for the maintenance tablet without reverting the integrated `walkLockHint` implementation.
- Blender asset validation: all three project-authored GLBs load with applied real-world scale, UVs, named materials and one simplified collision proxy each. Greens mower: 1.092 x 1.230 x 1.044 m, 3,228 triangles. Rotary spreader: 0.790 x 1.070 x 0.993 m, 3,184 triangles. Treatment sprayer: 0.560 x 0.220 x 0.658 m, 2,024 triangles. Source/license provenance is recorded in `ASSET_SOURCES.md`.
- Focused tests: course maintenance, course shader/editor, checkout, customers, golf operations and inventory passed 66/66. Full suite passed 604/604. Parser, diff check and package dry-run passed.
- Runtime smoke: fresh property purchase reached walk mode/live clubhouse with zero console errors, page errors or blocking request failures.
- Normal-control route: all 12 acceptance assertions passed through physical inspection, mower blade engagement, mowing, irrigation, fertilizer, disease treatment, six divots, three ball marks, seven bunker footprints, four debris items, tractor mowing, autosave and reload. Condition improved from 62 to 75 and all 15 work-order steps persisted.
- Harness stability: the first two recorded browser contexts closed nondeterministically at different elapsed times/actions; an instrumented third run completed and both Chrome and ffmpeg exited normally. No Windows crash, page error, console error or deterministic gameplay fault was found. This flake remains recorded for final soak/recording validation.
- Performance checkpoint at 1600 x 900: idle 119.79 average FPS / 116.39 one-percent-low; active mowing 119.80 / 116.64; zero frames over 50 ms. Idle/active draw calls were 612.27/619.62. Sixty normal mount/dismount cycles had zero active-listener growth; forced-GC heap checkpoints stabilized at 77.2-77.4 MB after the initial rise. Save was 544,363 bytes, 5.2 ms to serialize/store and 6.5 ms to parse/deserialize on the QA machine.
- Visual inspection: yard equipment, work board, one-yard feedback, mowing, bunker raking and the completed tablet are legible and grounded from the player camera. The pre-existing narrow top-edge camera artifact is still visible in some outdoor views and remains a final visual-polish defect.
- Decision: accept the simulation and physical route with the integration fallbacks above; retain the source branch and defer generated evidence to the final integrated visual-review set.
