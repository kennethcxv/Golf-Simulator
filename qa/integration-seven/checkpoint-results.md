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
