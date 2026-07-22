# Full integration audit — 2026-07-21

## Outcome

| Item | Result |
|---|---|
| Integration branch | `integration/all-branches` |
| Verified code head | `45d1761d943b2e1653428b48f20596d5ba8ce40d` |
| Baseline `main` | `857bd2b4ff16a1f9ca6d1d32b607505081d19f27` |
| Local branch coverage | 41/41 local branch heads are ancestors of the integration head |
| Full automated suite | 2,151 tests: 2,148 pass, 0 fail, 3 skip |
| Production checkout | Card and cash routes pass through normal browser controls |
| General browser QA | Pass; 15 screenshots and one gameplay video |
| Performance | Frame pacing passes; resource-budget comparison fails |
| Remote publication | Blocked: this repository has no configured Git remote |

The local integration is functionally stable and contains every local branch tip. It should not be merged to `main` yet because the merged scene exceeds the pre-merge heap, triangle, material, and visible-texture budgets. The branch also cannot be pushed or opened as a pull request until a remote is configured.

## Safety and scope

- The pre-existing dirty worktree at `C:\Users\Kenneth\Documents\GitHub\Golf-Flipper` was not modified.
- Integration and QA ran in the isolated worktree `C:\Users\Kenneth\Documents\GitHub\Golf-Flipper-seven-main-baseline-20260719`.
- QA screenshots, videos, TAP logs, and JSON results remain ignored under `qa/`; no generated evidence was added to the production commit.
- No external or third-party assets were downloaded.
- Production asset hashes were checked before and after both final checkout routes and were unchanged.

## Merge and repair sequence

The branch fan-in was recorded by these merge commits:

| Commit | Integrated work |
|---|---|
| `9e50ba1` | Pro-shop furniture and its previously merged overnight work |
| `066b438` | Material upgrades |
| `96c7c54` | Pro-shop equipment |
| `67638de` | Store display assets |
| `05b6de1` | Furniture catalog |
| `fd4e5ae` | Store generation |
| `9e8bd3b` | Course 1 failing-municipal property |
| `e997f75` | Property expansion and world overhaul |
| `1c9acab` | Final checkout polish |

Semantic reconciliation then landed as:

| Commit | Reconciliation |
|---|---|
| `8b1bef1` | Shared runtime, build-mode, progression, state, and QA contracts |
| `4e3c104` | Complete catalog packaging and delivery GLB consistency |
| `9f52f6a` | Cross-domain save migrations and recovery safety |
| `99f361b` | Physical receiving, shipment, placement, and stock conservation |
| `a8359fd` | Shop layout migrations and generated fixture ownership |
| `f061b91` | Player-facing reservations, reviews, maintenance, and asset contracts |
| `45d1761` | Production checkout runtime, shared UI/runtime closure, and final QA contracts |

## Conflicts and resolutions

This integration contained both merge-text conflicts and more important semantic conflicts where auto-merged code compiled but violated another branch's runtime contract.

| Area | Conflict | Resolution |
|---|---|---|
| `src/main.js` | Later UI, maintenance, golf-day, reservation, delivery, sale-confirmation, and input handlers referenced imports or helpers absent from the fan-in result. One `I` key case also fell through into vehicle lights. | Restored the dependency closure, panel construction, maintenance handlers, tool cancellation, and the missing `break`. |
| `src/render3d/courseScene.js` | Course/editor, maintenance, shader, render-budget, tool-socket, and interaction work auto-merged with missing helpers and a stale hold-interaction path. | Restored the canonical imports/helpers, equipment batching, focused labels, and current interaction ownership. |
| `src/render3d/clubhouse.js` | The Course 1 municipal replacement was applied as a global clubhouse skin, suppressing the full pro shop and placing a service-room door through checkout on other properties. | Scoped the municipal environment to `willow-creek`; all other properties retain the production pro shop. |
| Simplified register | Checkout generations disagreed on scanner input, terminal keypad ownership, card insertion, cash acceptance, drawer choreography, fulfillment, and debug/QA endpoints. Several accepted helpers had been removed while their call sites remained. | Restored physical keypad/card entry, fixed one-click product scanning and bagging, retained authored cash drawer/change handling, preserved automatic receipt/bag delivery, restored missing helper definitions, and removed obsolete duplicate drag/swipe paths. |
| Checkout presentation | Register and terminal screen planes z-fought with their hardware; tender/card props could be technically in view while hidden behind the counter lip; the card amount display did not invalidate after entry. | Added stable screen depth/polygon offset, lifted hand-aligned payment props into the cashier frame, and included entry state in the terminal render signature. |
| Save and state schemas | Save-stability, property, shop-generation, maintenance, marketplace, and editor changes each assumed different latest-domain shapes. | Reconciled migrations in the existing authorities and retained legacy recovery behavior rather than replacing whole domains. |
| Shop/layout/fixtures | Authored furniture, generated rooms, provisions, apparel, and stored fixtures disagreed on IDs, occupancy, migration, and stock semantics. | Kept stable IDs, migrated older layouts, preserved owned/stored inventory, and updated the production contracts together. |
| Delivery assets | Catalog visuals and delivery packages disagreed on model stems, dimensions, orientation, and evidence expectations. | Rebuilt/reconciled the affected authored packages and aligned runtime lookup plus validation contracts. Raw source assets were preserved. |
| QA contracts | Two source-inspection tests still required the removed manual cash-sort flow and duplicate receipt-tear call sites. | Updated the tests to the accepted one-click physical deposit and shared transition-local tear cue; no runtime assertion was weakened. |

## Production checkout acceptance

Both final routes used the browser runner with an operational Flatiron Meadows fixture, normal player-facing clicks/keys, deterministic products, real transaction state, and production-build hash guards.

### Card

- Result: pass.
- Exact sale: `$37.95`; cash and shop-sales ledger each increased by `$37.95`; zero loss.
- Three distinct products were physically scanned and bagged.
- Empty and incorrect terminal amounts were rejected.
- The entered amount visibly reads `$37.95` on the physical reader.
- The first normal card attempt declined; the replacement card approved.
- Receipt printing, receipt handoff, bag handoff, customer ownership, review, reputation, inventory decrement, and customer departure completed.
- Evidence: 36/36 referenced PNGs, 35.998-second VP9/Opus video, one audio track with 233 non-silent sample windows.
- Browser diagnostics: zero console errors, page errors, or request failures.
- Result: `qa/full-integration/checkout-final-3/card-result.json`.
- Visual evidence: `qa/full-integration/checkout-final-3/card/card/`.

### Cash

- Result: pass.
- Exact sale: `$35.72`; customer tender `$40.00`; exact change `$4.28`; zero loss.
- The two `$20` notes are visible in the customer presentation frame.
- Drawer travel, tender deposit, bill and coin wells, under-change rejection, excessive-change rejection, undo, clear, exact selection, physical change handoff, receipt, bag, banking, inventory, review, and departure completed.
- Evidence: 32/32 referenced PNGs, 31.473-second VP9/Opus video, one audio track with 250 non-silent sample windows.
- Browser diagnostics: zero console errors, page errors, or request failures.
- Result: `qa/full-integration/checkout-final-3/cash-result.json`.
- Visual evidence: `qa/full-integration/checkout-final-3/cash/cash/`.

Both routes report `productionBuildSnapshot.unchanged: true` across 1,341 production files.

## General functional and visual QA

The final player-experience pass covered the main menu, settings, new-game dialog, property market, loading, exterior HUD, entrance prompt, checkout environment, pause overview, pause settings, accessibility, controls, tool wheel, course overview, and pause-from-overview return.

- Evidence: 15 screenshots and `player-experience-acceptance.webm`.
- Console errors: 0.
- Page errors: 0.
- One `golf_bag.glb` request was intentionally aborted during navigation/teardown; no unexpected request failure occurred.
- Before set: `qa/player-experience-polish/iterations/full-integration-baseline/`.
- Final set: `qa/player-experience-polish/iterations/full-integration-final-4/`.

## Automated tests

Final authoritative run:

```text
tests 2151
pass 2148
fail 0
skipped 3
duration 316220.079 ms
```

The ignored TAP record is `qa/full-integration/full-test-final.tap`; stderr is empty. Focused syntax, undefined-helper, checkout audio/camera, card geometry, payment-presentation, register-flow, cash, and evidence gates were also green before the full run.

## Performance comparison

Scenario: fixed exterior camera at 2:00 PM, 5-second warm-up, three 600-frame samples at 1440×900 in headless Chrome.

| Metric | Baseline | Final | Change | Gate |
|---|---:|---:|---:|---|
| Average FPS | 116.29 | 120.00 | +3.19% | Pass |
| 1% low FPS | 58.49 | 116.31 | +98.83% | Pass |
| Worst frame | 33.4 ms | 9.5 ms | -71.56% | Pass |
| UI mutations/frame | 0.0911 | 0.0061 | -93.29% | Pass |
| Draw calls/frame | 4,238 | 1,865 | -55.99% | Pass |
| Rendered triangles/frame | 5,560,606 | 7,351,135 | +32.20% | **Fail** |
| Final JS heap | 106,561,379 B | 350,666,092 B | +229.07% | **Fail** |
| Materials | 252 | 763 | +202.78% | **Fail** |
| Visible textures | 149 | 194 | +30.20% | **Fail** |
| Resident textures | 213 | 65 | -69.48% | Pass |
| Estimated texture memory | 4,830,479,725 B | 610,332,701 B | -87.36% | Pass |

The comparator also reports `scenarioMatch: false` because the baseline and final scripts use different wording for the same fixed-camera scenario. Its listener gate incorrectly marks a delta of `-3` as a leak even though listener count decreased. Neither harness issue changes the four real resource-budget failures above.

Two initial GLB requests were deliberately aborted by the loader (`golf_bag.glb` and the municipal property GLB); both are classified as expected. There were no console or page errors.

- Baseline: `qa/player-experience-polish/performance/full-integration-baseline/`.
- Final: `qa/player-experience-polish/performance/full-integration-final/`.

## Remaining blockers

1. **Resource regression:** optimize or explicitly accept the increases in heap, triangles, materials, and visible textures, then rerun an apples-to-apples performance gate.
2. **No publication target:** `git remote -v` is empty. Fetch, push, remote comparison, and pull-request creation were impossible. No remote was invented or added.

After those are resolved, push `integration/all-branches`, open the review, and merge it into `main` through the normal protected-branch workflow. Do not recreate the integration by selectively merging local feature tips; all 41 local branch heads are already contained here.
