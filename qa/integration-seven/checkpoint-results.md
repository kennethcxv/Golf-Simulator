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
