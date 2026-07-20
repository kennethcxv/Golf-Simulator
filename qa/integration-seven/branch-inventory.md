# Seven-branch inventory

Audited main: `0c5137e5f0efac9627ce2309b9e66936f1eeb769` (original main `0c5137e5f0efac9627ce2309b9e66936f1eeb769`; local-only, no remote).

| Branch | Head | Fork | Ahead / behind | Commits | Files | + / - | Binary | Risk |
|---|---|---|---:|---:|---:|---:|---:|---|
| `overnight/furniture-customization` | `b271903ce5d9` | `0c5137e5f0ef` | 5 / 0 | 5 | 69 | +3140 / -389 | 58 | high |
| `overnight/inventory-delivery-loop` | `12600d497cb9` | `0c5137e5f0ef` | 5 / 0 | 5 | 180 | +12910 / -453 | 130 | high |
| `overnight/customer-simulation` | `3cfbca443add` | `0c5137e5f0ef` | 6 / 0 | 6 | 113 | +14223 / -617 | 78 | high |
| `overnight/course-maintenance` | `2a0ab21a735b` | `0c5137e5f0ef` | 4 / 0 | 4 | 77 | +12036 / -47 | 50 | high |
| `overnight/golf-operations` | `52cfe7e12b01` | `0c5137e5f0ef` | 13 / 0 | 13 | 49 | +6531 / -189 | 25 | high |
| `overnight/economy-progression` | `16b757055e88` | `0c5137e5f0ef` | 5 / 0 | 5 | 268 | +17573 / -227 | 193 | high |
| `overnight/player-experience-polish` | `bf072a1e1d26` | `0c5137e5f0ef` | 5 / 0 | 5 | 231 | +13193 / -468 | 171 | high |

The companion JSON contains every changed/new/deleted file, every binary asset, commit metadata, QA-report path, and package/save/shared-system classification.

## overnight/furniture-customization

- Scope: Unified floor, wall, counter, and shelf placement; move/store/sell; collision and persistence.
- Latest commit: `b271903ce5d99478f026b0000b344dc957fe1255` at 2026-07-19T18:39:31-07:00
- New/deleted files: 62 / 0
- Package or lockfile changes: none
- Save-schema changes: src/sim/layout.js — canonical persisted transforms, storage/sale state, and legacy layout normalization
- Shared systems: `src/main.js`, `src/render3d/clubhouse.js`, `src/render3d/clubhouse/buildMode.js`, `src/styles.css`
- Potential overlap: inventory physical objects, customer navigation, UX input ownership, shared clubhouse rendering
- Claimed state: Branch report/evidence claims production acceptance.
- Rerun evidence: Fresh 26/26 normal-control placement route, save/reload, customer navigation, laptop access, 534/534 tests, syntax and hardware performance passed. Retail card evidence did not perform the required physical swipe.

## overnight/inventory-delivery-loop

- Scope: Conserved ordered/in-transit/boxed/reserve/shelf/customer-held/sold/disposed inventory lifecycle and physical receiving workspace.
- Latest commit: `12600d497cb94a8c3dd4983c6b311f2687c8e7e5` at 2026-07-19T20:03:58-07:00
- New/deleted files: 163 / 0
- Package or lockfile changes: none
- Save-schema changes: src/sim/state.js; src/sim/inventoryLifecycle.js; src/sim/deliveries.js — stable shipment/box IDs and staged quantity normalization
- Shared systems: `src/main.js`, `src/sim/checkout.js`, `src/sim/shop.js`, `src/ui/laptop.js`, `src/render3d/clubhouse.js`
- Potential overlap: placement primitives, customer reservations, economy order ledger, checkout exact-once sale completion
- Claimed state: Branch acceptance evidence claims complete conserved delivery loop.
- Rerun evidence: Fresh normal-control delivery/unbox/carry/stock/recycle route and save/reload passed; 1,000-unit reconciliation and 533/533 tests passed. Reorder browser assertion was stale because it compared total cash against concurrent clock expenses; ledger/order debit itself was exact.

## overnight/customer-simulation

- Scope: Persistent physical customer lifecycle, arrivals, browsing, reservations, queueing, checkout, lounge use, recovery, and satisfaction.
- Latest commit: `3cfbca443adde45b2f8e224e36b4c88f1483fc65` at 2026-07-19T18:53:48-07:00
- New/deleted files: 106 / 0
- Package or lockfile changes: none
- Save-schema changes: src/sim/customerSimulation.js; src/sim/state.js; src/sim/reservations.js — persisted lifecycle with safe checkout/queue recovery
- Shared systems: `src/sim/reservations.js`, `src/sim/reviews.js`, `src/sim/state.js`, `src/render3d/clubhouse.js`
- Potential overlap: inventory reservation ownership, golf reservation events, economy reputation outputs, course scene resource accounting
- Claimed state: Branch final report claims production acceptance.
- Rerun evidence: Fresh lifecycle, abandonment/restock, reservation timing, save-during-scan and repeated reload passed; 534/534 tests passed. Branch diff has one trailing-whitespace defect, and its forced-software-renderer performance evidence is not usable for acceptance.

## overnight/course-maintenance

- Scope: Hero-hole turf state, inspection, mowing, irrigation, fertilization, repairs, bunker raking, treatment, scoring, tools, and visuals.
- Latest commit: `2a0ab21a735beb2b011a8625b3bd7a17c0a4391a` at 2026-07-19T20:45:06-07:00
- New/deleted files: 71 / 0
- Package or lockfile changes: none
- Save-schema changes: src/sim/courseMaintenance.js; src/sim/state.js — normalized turf grid, masks, work order, disease, and maintenance score
- Shared systems: `src/main.js`, `src/render3d/courseScene.js`, `src/styles.css`, `ASSET_SOURCES.md`
- Potential overlap: course render lifecycle, UX tool/input ownership, economy condition/valuation, shared asset provenance
- Claimed state: Branch release QA claims route and performance acceptance.
- Rerun evidence: Fresh no-video route passed all 12 assertions and real save/reload; hardware performance and 60 mount cycles passed; 527/527 tests passed. Checked-in QA had a brittle fixed wait/personal Playwright path, video capture was unstable, and one floating dark rectangle is visible near a treatment route.

## overnight/golf-operations

- Scope: Deterministic tee sheet, reservations, arrivals, check-in, walk-ins, no-shows/cancellations, payment context, course-access and booking ledger events.
- Latest commit: `52cfe7e12b013fc699382e076fe9bc443e77b815` at 2026-07-19T18:34:15-07:00
- New/deleted files: 40 / 0
- Package or lockfile changes: none
- Save-schema changes: src/sim/reservations.js; src/sim/state.js; src/sim/economy.js — stable booking IDs, lifecycle states, payment and exact-once event markers
- Shared systems: `src/main.js`, `src/ui/laptop.js`, `src/render3d/clubhouse.js`, `src/render3d/clubhouse/registerMode.js`, `src/styles.css`
- Potential overlap: customer physical lifecycle, economy ledger, UX focus/pause lifecycle, front-desk/retail checkout input
- Claimed state: Branch documentation claims accepted golf operations day and laptop workflows.
- Rerun evidence: Fresh full operating day passed with prepaid/card/cash, walk-in, exact stable transactions, 538/538 tests, no errors and stable hardware runtime. Full laptop rerun timed out under forced software rendering; receipt contrast is weak and front-desk normal exit left the controller unfocused.

## overnight/economy-progression

- Scope: Exact-once ledger, summaries, pricing, reputation, upgrades, condition, explainable valuation, guarded sale flow, and anti-exploit invariants.
- Latest commit: `16b757055e8887c6dd4e16cc36f693da8138bcb2` at 2026-07-19T18:37:34-07:00
- New/deleted files: 241 / 0
- Package or lockfile changes: none
- Save-schema changes: src/sim/business.js; src/sim/state.js; src/sim/propertyProgression.js; src/sim/reputation.js — normalized ledger/event IDs, summaries, upgrades, appraisal and sale recovery state
- Shared systems: `src/sim/economy.js`, `src/sim/checkout.js`, `src/sim/reservations.js`, `src/sim/shop.js`, `src/ui/laptop.js`, `src/ui/ui.js`
- Potential overlap: inventory purchase/sale events, golf booking payments, customer satisfaction/reputation, course/property condition, UX notification/UI framework
- Claimed state: Branch acceptance evidence claims coherent progression and guarded sale flow.
- Rerun evidence: Fresh poor/average/skilled simulations, exact ledger evidence, 17-page browser tour, explicit sale confirmation/recovery, 535/535 tests and 120 FPS hardware sample passed with no console/page errors.

## overnight/player-experience-polish

- Scope: Main/pause menus, contextual HUD/prompts, tutorials, notifications, settings/accessibility, tool wheel, audio and lifecycle-safe transitions.
- Latest commit: `bf072a1e1d26cce631daa19d351525b4d5acf941` at 2026-07-19T18:57:52-07:00
- New/deleted files: 216 / 0
- Package or lockfile changes: none
- Save-schema changes: src/core/storage.js; src/core/preferences.js; src/sim/tutorial.js — version-aware slot metadata, preference persistence and tutorial reset/version state
- Shared systems: `src/main.js`, `src/styles.css`, `src/ui/laptop.js`, `src/ui/ui.js`, `src/render3d/courseScene.js`, `src/render3d/clubhouse/buildMode.js`
- Potential overlap: all input modes, notifications from every system, save/load presentation, audio/renderer teardown, economy laptop pages
- Claimed state: Branch acceptance evidence claims production UX gates.
- Rerun evidence: Fresh 15-screen normal and accessibility routes, 100 pause/resume and 100 mode transitions, save failure/version recovery, audio lifecycle, 520/520 tests and hardware performance passed. One persistent contextual notification remains by design after cleanup; checked-in prose claiming zero is stale.

## Explicitly excluded active branch

- Branch: `overnight/gameplay-progression`
- Head: `3ddb082f90cdb78325e633ec722fd04a3bf98fdf`
- Active worktree: `C:\Users\Kenneth\Documents\GitHub\Golf-Flipper-gameplay-progression`
- Uncommitted state: dirty (3 tracked paths and 1 untracked path); contents were not inspected.
- Explicitly excluded; active worktree and branch were not entered, modified, merged, cherry-picked, reset, rebased, cleaned, or pruned.
