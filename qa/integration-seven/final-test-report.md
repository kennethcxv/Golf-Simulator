# Final integrated test report

Validated integration code head: `ec88eba401e812cf131a7008f4ec868e575435f6` plus the report-only cleaning assertion subsequently committed with this report set. Original main: `0c5137e5f0efac9627ce2309b9e66936f1eeb769`.

## Independent branch verification

| Branch | Full suite | Focused | Runtime/visual | Final classification |
|---|---:|---:|---|---|
| furniture customization | 534/534 | 18/18 | 26/26 normal-control placement gate; checkout/laptop/navigation/save pass | merge substantially as product commits |
| inventory delivery | 533/533 | 42/42 | delivery/unbox/carry/reserve/stock/recycle/save and 1,000-unit reconciliation pass | selected product commits; stale evidence rejected |
| customer simulation | 534/534 | 18/18 | arrivals, abandonment, queue, checkout, save/half-scan pass | selected product/QA commits plus canonical adapters |
| course maintenance | 527/527 | 11/11 | 12/12 physical route; save and hardware performance pass | selected product commits; brittle evidence rejected |
| golf operations | 538/538 | 30/30 | complete operating day, laptop booking/cancellation, save pass | selected product/performance commits plus integration repairs |
| economy progression | 535/535 | 19/19 | 17 laptop pages, property sale/recovery, 1,080-day balance run pass | selected product/reproducible-QA commits |
| player experience | 520/520 | 4/4 | menu/settings/accessibility, 100 pause and 100 mode cycles pass | selected product/acceptance commits; stale media rejected |

Exact source heads and per-branch evidence are in `branch-inventory.md` and `branch-review-matrix.md`.

## Integrated automated gates

- `git diff --check`: pass.
- Node parser checks over all changed `.js`, `.mjs`, and `.cjs`: pass.
- Final integration full suite before report-only QA changes: 635/635, 0 failed, 0 skipped, 153.35 seconds.
- Focused customer/golf canonical boundary: 45/45 pass after reservation-priority/reset repair.
- Protected card/customer/golf/inventory matrix: 70/70 pass after live-swipe refresh repair.
- Eight-source migration matrix: 8/8 pass; two reloads each; opaque future data and canonical identities preserved.
- Integrated logical soak: pass across six 100-operation domains.
- Conflict-marker/security/path/generated-artifact scans: pass with documented `DEV_LOG.md` divider exception.
- `npm pack --dry-run --json`: pass; 472 entries, 258,279,487 packed bytes, 310,151,953 unpacked bytes.
- Formatting script: unsupported/not defined.
- Type-check script: unsupported/not defined; JavaScript project.
- Production build/preview scripts: unsupported/not defined. Static repository server, package dry-run, and Electron smoke are the supported equivalents.

Clean release worktree `ff00fd76c78f04747d38084094ba23a722686587` results:

- `npm ci`: pass; 73 packages installed from the lockfile, 74 audited.
- Parser check: 237 tracked JavaScript/CommonJS/ESM files pass.
- Full suite: 635/635 pass, 0 failed/skipped, 115.82 seconds.
- Static server: served `state.js` SHA-256 matched the release worktree; fresh New Game reached live walk/clubhouse state with zero console/page/blocking-network errors.
- Electron: exact local binary stayed live for ten seconds, exposed the `GOLF EMPIRE` `index.html` target, owned one renderer/three child processes, and logged no fatal/unhandled exception. The captured process tree was stopped and its unique debug port closed.
- `npm pack --dry-run --json`: pass; 472 entries, 258,277,965 packed bytes, 310,163,125 unpacked bytes.
- `npm audit --json`: one inherited high Electron group; semver-major fix `43.1.1`, documented in `security-hygiene.md`.
- Detached release worktree remained Git-clean; only ignored QA logs were written.

Post-merge main `ce1b9d98944efe1e2751d65c4357c0c75bb7d549` results:

- `npm ci`: pass with the exact lockfile; the same documented Electron advisory remains.
- Parser/diff gate: all 237 tracked JavaScript files pass.
- Full suite: 635/635 pass, 0 failed/skipped, 121.16 seconds.
- Static smoke: served `state.js` SHA-256 matched disk; fresh New Game reached live walk/clubhouse state; zero console/page/blocking-network errors; owned server stopped.
- Electron smoke: `GOLF EMPIRE` file target and one renderer remained live for ten seconds; no fatal/unhandled log; all three captured child processes and unique debug port stopped.
- Main worktree was clean before report finalization.

## Application and UX

| Gate | Result |
|---|---|
| Main menu and accurate Continue metadata | pass |
| Safe New Game confirmation/difficulty selection | pass |
| Pause/unpause in walk, overview, editor, laptop, register and tee desk | pass |
| Return to menu and preference persistence | pass |
| Contextual HUD and shared-counter prompt priority | pass |
| Tutorial one-shot behavior and reset | pass |
| Notification cap/deduplication/cleanup | pass |
| Indoor two-item and outdoor ten-item tool wheels | pass |
| Settings/audio/UI scale/reduced motion/high contrast/invert/FOV | pass |
| Keyboard focus loops and modal escape paths | pass |
| Camera/FOV/input restoration | pass |
| Save failure/version/error presentation | pass; no raw stack trace shown to player |
| Audio pause/background/teardown lifecycle | pass |
| 100 pause + 100 mode transitions | pass; zero listener drift and no residual overlays |

## Checkout and clubhouse regression

- Card: two physical products scanned, real top-to-bottom card gesture accepted, `$66` banked exactly once, two units sold, receipt printed, bag handed off, no held stock remained.
- Cash: two physical products scanned, tender/change drawer path completed, receipt/bag/handoff completed, `$66` and two units reconciled exactly once.
- Half-scanned sale survived two reloads with stable lot/transaction identity.
- Checkout remained usable after placement, inventory, customer, golf-operation, economy, and UX integration.
- Front desk card gesture stays mounted during live once-per-second reservation refresh; real card and cash check-ins pass.
- Doors, laptop, retail register, front desk, delivery workspace, stockroom and lounge all remained reachable in normal-control routes.
- Cleaning: real tool-wheel selection and held LMB hit `sidingSE` at UV `(0.5, 0.2694)` and reduced persisted grime by `3.804`; tool audio suspended on background and stopped on release. Washing unit tests and save normalization also pass.

## Placement

- Floor, wall, counter and shelf placement: pass.
- Preview/final transform match, snap/rotate/fine nudge: pass.
- Invalid overlap, wall bounds, door swing, register workspace and navigation isolation: rejected correctly.
- Front counter, sofa, desk, chair, wall clock, security camera, exit sign, laptop, register, shelf and product-unit catalog paths: represented and visually inspected.
- Move, sell, store, cancel/undo and repeated-sale protection: pass.
- Save/reload transform preservation and stale-collider cleanup: pass.
- Authored models are batched without losing selectable proxies; seven batch meshes represent 15 authored roots.

## Inventory and delivery

- Orders debit once and create shipments/delivery states: pass.
- Receiving pad blockage safely falls back/retries: pass.
- Stable box IDs, exact contents, partial tape, individual flaps, visible contents and no duplication: pass.
- Box carry, armful carry, reserve rack, shelf capacity, customer-held allocations and sold/disposed stages remain distinct: pass.
- Abandonment restores stock; completed sale decrements once: pass.
- Empty flatten/recycle path and reorder ledger assertion: pass.
- Save/load at every stage and accelerated 1,000-unit conservation: pass.

## Customers and golf operations

- Gradual arrivals, physical doors, valid browse targets, product reservation, queue slots, lounge seats, leaving and blocked-path recovery: pass.
- One, ten and 50 accelerated customers; cash/card sale; out of stock; abandonment; blocked doorway; furniture repath; queue/checkout save: pass through focused/normal-control routes.
- Due reservation parties take arrival priority, while generic shoppers cannot steal the final capacity needed by a waiting party.
- Fixture reset/cancellation retires matching physical arrivals so orphaned QA/production parties do not starve the cap.
- Full operating day: early/on-time/late/prepaid/card/cash/walk-in/no-show/cancellation/reopened slot/course-access flows pass.
- Card payment `$64`; cash balance `$83.20` with `$16.80` change; stable unique finance/receipt/journal IDs; no duplicate booking or payment.
- Laptop-created party of three, same-day cancellation fee `$12`, refund `$84`, and reopened capacity: pass.

## Course maintenance

- Hero hole and real-state inspection: pass.
- Path-based mowing/stripes, grass-height updates, irrigation, fertilizer, divots, ball marks, bunker rake, debris and disease treatment: pass.
- Maintenance score improved 62 → 75; all 15 work-order steps persisted after autosave/reload.
- Existing coarse-course hooks and course editor/shader gates remain active; 66-domain focused regression and full suite pass.
- Final hardware performance: 119.91 FPS idle and 119.88 FPS active mowing, no frames over 50 ms, zero listener growth after 60 mount cycles.

## Economy and progression

- Checkout sales/COGS, booking revenue, order expense, fees/refunds/no-shows/cancellations, upgrades and property sale all enter the one immutable journal through stable IDs.
- Daily summary/reputation/pricing/condition/valuation explanations: pass.
- Fair/high/low and poor/average/skilled simulations: all balance gates pass across 1,080 simulated operating days.
- Duplicate reward, value-farming, negative quantity/price, normalized-ID collision, replay and instant-flip defenses: pass.
- Property keep, accept-without-sale, explicit permanent confirmation, exact payout, recovery snapshot and next market: pass.

## Save and soak

The latest-main and all seven branch representative saves migrate to state version 6, then reload twice without lost unknown root/holding/state data or duplicate canonical identities. Gameplay-specific placement, delivery, customer queue, checkout, check-in, maintenance, upgrade and property-sale saves pass.

Logical soak results:

- 100 placement operations; routes intact; undo history bounded at 40.
- 100 box carry interactions; inventory reconciled.
- 100 customer lifecycles; 0 active/queued at end; histories bounded.
- 100 check-ins; `$3,200` expected and actual cash; 100 unique finance entries.
- 100 maintenance strokes; 497 cells changed.
- 100 save/load cycles; stable identities/unknown data; final 20 saves within one byte.
- Heap retained after GC: 2,210,576 bytes; `CloseReq` delta 0; `PipeWrap` delta 0.
- Browser stress: 100 pause/resume and 100 mode transitions; listener delta 0; audio nodes/loops settle; no overlay leakage.

## Console, network and visual review

Accepted final routes have zero console errors and zero page exceptions. Failed requests are optional GLBs aborted during deliberate scene replacement/context teardown, not 404s or required-resource failures. Known non-blocking warnings are Canvas2D readback optimization and one GPU shader-initialization warning.

Manual visual review covered placement preview/furnished clubhouse/wall fixtures, delivery/open box/stockroom/shelves/recycling, customer browse/door/lounge/queue, golf check-in and receipts, hero-hole inspection/mowing/bunker rake, all economy laptop pages/property sale, and the main/pause/settings/HUD/tool-wheel UI. No blocking clipping, floating accepted object, broken active control, or unreadable final state was accepted. Evidence is local under `qa/integration-seven/final-visual-review/`; failed/superseded attempts are under `qa/integration-seven/debug-attempts/` and are intentionally ignored by repository policy.

## Known limitations

- No repository format, type-check, production build, or production preview script exists.
- The ten-customer paired sample recorded four isolated long frames and a lower aggregate 1% low than main, although mean FPS stayed within 1.25% and no leak accumulated.
- Full integration increases material references and representative save size; absolute load remained 5.7 ms and soak size stabilized.
- `npm audit` reports the pre-existing Electron 33 advisory group; the available fix is a major Electron 43 upgrade requiring separate validation.
- Optional GLB teardown aborts and Canvas/shader warnings remain non-blocking and documented.
