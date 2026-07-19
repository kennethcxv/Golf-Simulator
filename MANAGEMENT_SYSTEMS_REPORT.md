# Golf Flipper Management Systems Report

## Build identity

- Branch: `overnight/management-systems`
- Isolated worktree: `C:\Users\Kenneth\Documents\GitHub\Golf-Flipper-management-systems`
- Base commit: `1dfb9de646c6785b027ddb023dda1e3a6af9a5c6`
- Original worktree: inspected only; its unrelated dirty files were not changed

## Player-facing result

The office laptop is now a seven-destination management console organized around decisions the live simulation actually honors:

- Home gives an actionable progression objective plus current booking, stock, and turf risks.
- Bookings shows capacity, outstanding balances, complete party/round/transport/rental/payment details, and the handoff to the physical front-desk monitor.
- Pro Shop combines truthful inventory risk, named suppliers and freight, order confirmations, exact price/demand controls, and physical delivery status.
- Course removes ponds and bunkers from turf treatment, ranks real grass issues, recommends care from live moisture/nutrient/height/wear/disease values, and previews the exact upgrade-aware charge.
- Upgrades separates course improvements, renovations/amenities, staff coverage and outcomes, and equipment.
- Business combines finances, causal reviews, membership pricing/roster health, and the existing real featured-merchandise demand lever.
- Settings separates general preferences from persisted physical-checkout accessibility controls.

No duplicate economy, inventory, checkout, reservation, review, staff, or progression authority was added. The UI reads and writes the existing simulation models.

## Connected business loop

A dedicated integration test carries one state through the complete model boundary:

1. Place a 12-unit Fairway Supply order and book its goods plus freight once.
2. Move the exact same units from transit into a labeled physical carton.
3. Cut the tape, open all four flaps, carry two six-unit armfuls, and stock the authored ball wall.
4. Create a booking, bank its deposit, and settle the balance through the shared physical-register card state machine.
5. Pick one stocked product, scan it, approve card payment, print and pack the receipt, bag it, hand it over, and bank one sale.
6. Hire staff, renovate an amenity, unlock the premium supplier, post a causal review, and close utilities, wages, dues, sales, and works into the same books.
7. Serialize and deserialize the club with exact cash, inventory, tickets, reviews, staff, prices, dues, marketing, renovation, progression, and ledger state.

The browser acceptance routes separately prove the full player choreography with normal keyboard and mouse controls.

## Browser acceptance evidence

All paths below are local QA artifacts under the isolated worktree. The repository intentionally ignores `/qa/`, so large screenshots and videos are not part of the Git commits.

- Laptop baseline and before screenshots: `qa/management/baseline/`
- Four documented visual review/revision passes: `qa/management/iterations/iteration-{1..4}.md`
- Final 1600x900 page/tab screenshots: `qa/management/iterations/iteration-4-after/`
- 1280x720 and 1920x1080 screenshots/results: `qa/management/resolutions/`
- Supplier order and authored van/label delivery: `qa/management/acceptance/order-delivery/`
- Physical cutter/unbox/two-trip stocking: `qa/management/acceptance/unbox-stock/`
- Reservation, walk-in cash check-in, no-show and two reloads: `qa/management/acceptance/front-desk/`
- Card/cash register matrix with audio/video: `qa/management/acceptance/register/`
- Player-controlled autosave/reload persistence: `qa/management/acceptance/persistence/`

Key accepted outcomes:

- Order: 16 polos from Sunday Round Apparel; $256 goods + $20 freight = one $276 debit; two readable labeled cartons; one shipment; no duplicate charge or arrival.
- Stocking: cutter equipped; tape and four flaps opened; 6 + 6 units carried; carton 12 -> 0, shelf 0 -> 12, hands 0; no lost or duplicated stock.
- Front desk: reservation lounge/arrival and Escape hierarchy; capacity-safe walk-in; one $64 cash ticket; no-show deposit and fee provenance unchanged through two normal Save/Load cycles.
- Card checkout: three physical products, one $37.95 ticket, one unit removed from each shelf, decline/retry, receipt and bag handoff.
- Cash checkout: three physical products, one $35.72 ticket, $40 tender, exact $4.28 change, under/over/excess rejection boundaries, authored drawer midpoint, receipt and bag handoff.
- Strengthened 1600x900 business outcome: both normal-control sales also banked their ticket total to cash and `ledger.today.revenue.shopSales` exactly once, created exactly one causal gameplay review, and moved reputation from 30.0 to 30.6. The review cited the observed wait-time and clubhouse-exterior factors. Structured results and fresh 30-frame audio/video evidence are under `qa/management/acceptance/register/1600x900/{card,cash}/`.
- Register resolution matrix: card and cash pass at 1280x720, 1600x900, and 1920x1080; every run references all 30 PNGs and preserves production build hashes.
- Persistence: green fee, ball markup, membership dues, featured category, club name, and reduced checkout camera motion survive production autosave, full reload, and Continue exactly.

## Performance comparison

The comparable before/after scenario is the physical laptop at 1600x900, DPR 1, the fixed office-chair camera at day-local 09:00, a 2.5-second warm-up, a six-second sample, traversal of every available management destination, and ten normal `E`/`Escape` open/close cycles. FPS is derived from `requestAnimationFrame`; scene counts come from Three.js; DOM/listener/heap values come from Chrome DevTools Protocol. GPU-resident texture bytes are unavailable from Three.js and are explicitly unmeasured.

The repository has no published performance budget. The acceptance tolerance used here is under 5% movement in average/1%-low FPS, under 2 ms worst-frame movement, no post-cycle listener growth, under 5 MB post-GC heap growth, and live heap below 250 MB. Those bounds preserve a stable 120 Hz presentation while catching persistent UI leaks.

| Metric | Before | After | Absolute delta | Percent delta |
| --- | ---: | ---: | ---: | ---: |
| Average FPS | 120.00 | 120.00 | 0.00 | 0.00% |
| 1% low FPS | 117.65 | 117.30 | -0.35 | -0.30% |
| Worst frame | 8.5 ms | 8.6 ms | +0.1 ms | +1.18% |
| Draw calls | 1 | 1 | 0 | 0.00% |
| Rendered triangles | 1 | 1 | 0 | 0.00% |
| Scene geometries | 2,658 | 2,658 | 0 | 0.00% |
| Scene materials | 768 | 768 | 0 | 0.00% |
| Scene textures | 205 | 205 | 0 | 0.00% |
| UI mutations / second | 1.0 | 1.0 | 0.0 | 0.00% |
| Post-cycle listeners | 99 | 99 | 0 | 0.00% |
| Post-cycle DOM nodes | 793 | 794 | +1 | +0.13% |
| Post-cycle JS heap | 53.98 MB | 54.35 MB | +0.37 MB | +0.69% |

The expanded application legitimately creates more transient UI while every new tab is visited: the pre-GC open-laptop sample moved from 157.44 MB / 225 listeners / 2,190 DOM nodes to 192.52 MB / 593 listeners / 6,055 DOM nodes. The after route includes 17 page-level tabs that do not exist in the legacy traversal, so those transient counts are workload rather than an apples-to-apples leak comparison. After closing the laptop, ten repeated cycles, and collection, listeners returned to exactly 99 and heap/DOM deltas were only +0.69%/+0.13%; FPS and scene resources stayed flat. The after run reported zero console errors, page errors, or failed requests. The only warning was the same Chromium `X4000` shader compiler warning present in the baseline.

The resolution samples also passed all pages, 17 tabs, and ten cycles:

- 1280x720: 119.83 average FPS, 103.76 1% low, 16.6 ms worst frame, 53.74 MB post-cycle heap.
- 1920x1080: 119.83 average FPS, 101.27 1% low, 16.6 ms worst frame, 54.10 MB post-cycle heap.

## Automated verification

- Syntax checks: every changed JavaScript/MJS file passes `node --check`.
- Focused management/business regression: 183/183 passing.
- Single-state connected business loop: 1/1 passing.
- Cashier QA provenance contracts after timing hardening: 3/3 passing.
- Completion-audit rerun: 28/28 changed management/turf checks, 3/3 cashier provenance checks, all 13 changed JavaScript/MJS files pass syntax checks, and `git diff --check` passes.
- Strengthened checkout/business acceptance: card and cash pass at 1600x900 with exact cash, shop-sales ledger, inventory, and causal-review deltas in addition to the physical transaction gates.
- `git diff --check`: passing.
- Full-suite baseline: 1,654 passed, 1 failed, 3 skipped out of 1,658 tests.
- Final low-concurrency full suite: 1,659 passed, 1 failed, 3 skipped out of 1,663 tests. All five added tests and the corrected QA provenance contract pass. The sole failure is the identical baseline Blender evidence gate.
- Completion-audit low-concurrency full suite on the final QA/report change: 1,659 passed, 1 failed, 3 skipped out of 1,663 tests in 1,288,786 ms. Its sole failure is again the identical baseline Blender evidence gate; retained TAP is `qa/management/final/full-tests-completion-audit-final.tap`.

## Known limitations

- `tests/assets-51-60-reimport-report.test.js` remains red before and after this branch because `generated/blender/assets_51_60_reimport_report.json` has not been produced by the required Blender verification script. This branch does not run Blender or fabricate that evidence.
- Paid advertising campaigns are not simulated. Marketing exposes the real featured-category attention nudge and live demand drivers, and explicitly says paid campaigns are unavailable.
- The recurring Chromium `X4000` shader warning remains unchanged from baseline.
- The named ref `overnight/base-2026-07-18` is no longer present. Isolation is still directly provable: `50c8614^`, the branch merge-base, and the original integration worktree HEAD are all `1dfb9de646c6785b027ddb023dda1e3a6af9a5c6`.
- No Git remote is configured in this repository, so this branch cannot be pushed until a maintainer adds or restores the intended remote.

## Integration

Review the isolated branch from its base, then integrate its focused commits onto the intended integration branch. Do not copy the ignored QA media into production artifacts unless evidence archival is desired.

```powershell
git log --oneline 1dfb9de646c6785b027ddb023dda1e3a6af9a5c6..overnight/management-systems
git diff --stat 1dfb9de646c6785b027ddb023dda1e3a6af9a5c6..overnight/management-systems
```
