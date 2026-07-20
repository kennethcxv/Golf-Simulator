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

## 6. Economy and progression

- Source head: `16b757055e8887c6dd4e16cc36f693da8138bcb2`.
- Strategy: cherry-pick core journal/progression commit `42ab47e`, explainable property/UI commit `36f4b26`, reusable deterministic QA commit `20a20c8`, and controlled benchmark repair `7488c53`; reject generated branch evidence commit `16b7570`.
- Integrated commits: `c845f09`, `74ecc4f`, `497ab67`, `d6e993d`; integration repair: `862f990923a24b9ccaa5c30c4828e22a7dd5b970`.
- Canonical ledger: `economy.js` owns immutable exact-once journal entries, cash/profit effects and the legacy cash-line projection. `business.js` derives daily explanations and progression summaries from that journal. It is not a second ledger.
- Shared-system reconciliation: reservations remains the full golf-operations model; the economy branch's smaller competing reservation model was rejected. Inventory orders remain in `inventoryLifecycle.js`; the legacy shop-order path was not revived. Checkout moves the exact customer-held lot allocations to sold before journal revenue and cost of goods post. Customer review IDs are stable across both the persistent simulation and physical renderer adapter.
- Save conflict: the integrated schema is version 6: version 4 inventory lifecycle, version 5 course maintenance, then version 6 journal, reputation and business normalization. Day close begins before the reservation horizon rolls so advance booking cash is posted to the operating day that accepted it. Both business and course-maintenance subtrees restore without discarding unknown root data.
- Pricing conflict found by integration QA: generated reservations originally multiplied deposits/prepayments by the configured green fee without applying price demand, while public rounds did apply it. Repair `862f990` makes tee-sheet generation consume the same fair-fee demand signal, adds deterministic regression coverage, and improves the balance artifact with matched fair/high/low controls plus category totals.
- Focused tests after repair: golf operations and economy progression passed 37/37. Full suite passed 624/624 in 132.2 seconds. Parser checks, diff check and package dry-run passed; dependency metadata remains unchanged.
- Deterministic balance gate: nine scenarios, five matched seeds, 24 closed days each (1,080 simulated operating days). Every gate passed. Matched full-stock/default-condition net profit was `$24,537.38` fair, `$11,532.46` maximum and `$10,527.77` minimum. Average operation remained below acquisition cost for the season; skilled operation beat average; understocking and course neglect hurt; poor operation avoided bankruptcy; restored sale was meaningful; no next-tier sale bypass occurred.
- Evidence generator: 12 machine-readable artifacts regenerated from the integrated contracts. Checkout uses a real customer-held unit; golf evidence uses prepaid arrival, confirmation and check-in; all nine adversarial checks passed, including duplicate checkout, duplicate sale proceeds, repeated no-show/upgrade, stock/furniture value farming, negative quantities, instant flip and normalized-ID collision.
- Normal-control browser gate: all 17 laptop pages loaded, the HUD stayed suppressed behind the laptop, console errors were 0, page errors were 0, and 24 repeated navigation cycles ended at the same 109 active-listener upper bound. The explicit property route passed keep, accept-without-sale, permanent confirmation, exact payout, recovery snapshot and next-market checks. All 16 failed requests were optional GLB loads aborted by deliberate scene/UI transitions; none was a 404 or blocking resource failure.
- Performance checkpoint at 1600 x 900: fixed-camera laptop route averaged 109.39 FPS idle (59.41 one-percent-low) and 117.62 FPS during repeated navigation (41.24 one-percent-low); one 91.7 ms interactive long frame was observed. These are checkpoint measurements, not a claim of improvement; the final controlled before/after and soak gates remain authoritative.
- Visual inspection: pricing tradeoffs, itemized finances, golf subledger explanation, valuation contributions, readiness, current offer, permanent-sale confirmation and post-sale market were readable with no visible clipping of active controls. Long pages scroll correctly. Generated screenshots/video remain ignored under repository QA-output policy and are not product commits.
- Decision: accept the economy architecture and explainable UI with the integrated inventory, reservations, customer and course boundaries above. Final save-matrix, checkout-production, security/hygiene and system-wide performance/soak gates remain pending.
