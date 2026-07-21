# Golf Operations Acceptance Report

Status: accepted on `overnight/golf-operations`; not merged to `main`.

Implementation was built from clean `main` at `0c5137e`. The validated implementation head before this evidence-only commit is `9b0f1bc`. No external assets were added, and the existing merchandise checkout, customer simulation, laptop shell, economy ledger, and save container remain the integration boundaries.

## Outcome

The game now supports a continuous golf-customer operation:

`reservation -> staggered arrival -> front-desk confirmation -> adapted cash/card/prepaid/deposit payment -> whole-party check-in -> course access -> departure event`

The same data drives the projected front desk, the existing laptop, arrival NPCs, finance summaries, and save/load. Walk-ins consume real slot capacity. Late, no-show, advance-cancellation, and same-day-cancellation policies expose their rules and post stable, exact-once finance entries.

## Acceptance matrix

| Requirement | Implementation and evidence | Result |
| --- | --- | --- |
| Data-driven tee sheet | Configurable opening/closing time, interval, capacity, party limit, horizon, grace period, closures, pairing, and dated rolling slots in `src/sim/reservations.js`; [projected schedule](laptop-iteration-05-final/02-capacity-aware-tee-sheet.png) | Pass |
| Believable deterministic demand | Seeded production horizon, varied parties/payment/outcome states, unique names within each day, reputation/turf/weather demand inputs; [idle audit](laptop-idle-final/evidence.json) reports days 0-6, 38 bookings, and unique names | Pass |
| Staggered arrivals | Early, on-time, late, and absent arrival plans emit due/arrived/late/no-show events; [front-desk arrival](iteration-04/01-arrival-at-counter.png) | Pass |
| Front-desk workflow | Normal `E` interaction at the existing register pose; confirm, add guest, move, late, no-show, cancel, payment, check-in, and walk-in actions; [desk open](iteration-04/02-tee-desk-open.png) and [recorded operating day](iteration-04/operating-day.webm) | Pass |
| Payment | Prepaid, deposit/balance, full cash, full card, supported member pass, receipt, decline/retry/cancel, pending reload, and exact-once transaction IDs; [card receipt](iteration-04/05-card-receipt.png), [cash drawer](iteration-04/06-cash-drawer.png), [cash receipt](iteration-04/07-cash-receipt.png) | Pass |
| Walk-ins and full slots | Slot selection uses actual capacity, opening hours, closure, conflicts, and lead time; [availability](iteration-04/08-walk-in-availability.png), [created walk-in](iteration-04/09-walk-in-created.png), and [full-slot schedule](laptop-iteration-05-final/02-capacity-aware-tee-sheet.png) | Pass |
| Late/no-show/cancellation policy | Readable policy, one-time fee/refund, reopened capacity, persisted terminal state; [cancellation confirmation](laptop-iteration-05-final/04-cancellation-confirmation.png), [reopened slot/history](laptop-iteration-05-final/05-cancelled-history-and-reopened-capacity.png), and [workflow assertions](laptop-iteration-04-final/evidence.json) | Pass |
| Party and course access | Every party member is checked in, course/hole access is assigned, queue state clears, actual start is retained, and a course-departure event is emitted; covered by `tests/golf-operations.test.js` and the operating-day route | Pass |
| Existing laptop integration | Live home alerts and operations summary; capacity-aware bookings, party editor, status history, policy, and finance views; [home](laptop-iteration-05-final/01-home-operations-alerts.png), [subledger](laptop-iteration-05-final/06-operations-subledger.png), [policy](laptop-iteration-04-final/07-live-schedule-and-policy.png) | Pass |
| Financial reconciliation | Stable subledger IDs for revenue, deposits, balances, refunds, cancellation fees, no-show fees, and walk-ins; cash deltas reconcile to the main ledger on posting day; [subledger](laptop-iteration-05-final/06-operations-subledger.png) and [exact values](laptop-iteration-04-final/evidence.json) | Pass |
| Save/load | Schedule, names, parties, payment/pending transaction, arrival, check-in, cancellation, no-show, access, events, and ledger relationships persist; legacy reservations migrate; repeated reload is idempotent | Pass |
| Normal controls and exit | Front desk and laptop are entered through player controls and close with normal `Escape`; [front-desk evidence](iteration-04/evidence.json), [laptop evidence](laptop-iteration-04-final/evidence.json), [final idle audit](laptop-idle-final/evidence.json) | Pass |
| Regression and stability | 538/538 full tests, 81/81 focused checkout/register tests, 30/30 golf-operations tests, no page errors, no console errors in the final audit, zero active-listener/registration delta, and zero application-DOM idle mutation callbacks | Pass |

## Deterministic operating day

The seed `20260719` produces a repeatable fixture with an early prepaid party, on-time card party, late cash/deposit party, no-show, cancellation, full paired slot, and walk-in opportunity. The browser route performs player-facing interactions and advances only the deterministic QA clock.

Representative exact values from [front-desk evidence](iteration-04/evidence.json):

- Card party: `$64.00`, receipt `GOLF-0-2-6`, paid and checked in once.
- Cash/deposit party: `$12.80` deposit plus `$83.20` balance; `$100.00` tender and `$16.80` change; both receipts retained.
- Walk-in: party of two assigned to a real 8:30 AM opening with the holder `Rowan Mercer`.
- Front-desk idle: 103 connected listeners before and after, no new registrations, and zero UI mutation callbacks over five seconds.

Representative exact values from [laptop workflow evidence](laptop-iteration-04-final/evidence.json):

- `Jordan Vale`, `Mara Vale`, and `Ellis Vale` reserve a three-player 9:00 AM slot.
- `$96.00` is prepaid once by card with receipt `GOLF-0-8-6`.
- Same-day cancellation retains a `$12.00` fee, refunds `$84.00`, reopens capacity, and creates stable fee/refund entry IDs.
- The fixture's operations subledger reconciles `$256.00` booking revenue, `$27.80` deposits, and `$116.00` refunds to `$167.80` net golf cash already reflected in the main ledger.

## Test results

Run on 2026-07-19 (America/Los_Angeles):

```text
npm test
538 tests, 538 passed, 0 failed

node --test tests/checkout.test.js tests/checkout-payment.test.js tests/checkout-space.test.js tests/register-abandon.test.js tests/register-complete.test.js tests/register-money.test.js tests/register-payment.test.js tests/register-scanzone.test.js tests/register-scan.test.js
81 tests, 81 passed, 0 failed

node --test tests/golf-operations.test.js tests/reservations.test.js
30 tests, 30 passed, 0 failed
```

The golf tests explicitly cover save before arrival, pending payment reload, after check-in, grace-period/no-show reload, day-boundary horizon rolling, repeated reload, duplicate prevention, and old-save migration.

## Browser QA

All accepted routes use the real game in Chromium at 1600x900. Direct state access is limited to installing a deterministic fixture, positioning the fixed QA camera, and advancing the accelerated QA clock. Entry, navigation, fields, buttons, card swipe, cash tender, check-in, booking, cancellation, and exit use the normal player-facing controls.

- Baseline: [screenshots, metrics, and console capture](baseline/baseline.json), plus [baseline video](baseline/baseline-route.webm).
- Front desk: [complete evidence](iteration-04/evidence.json), nine screenshots, and [operating-day video](iteration-04/operating-day.webm).
- Laptop: [complete workflow evidence](laptop-iteration-04-final/evidence.json), current-head screenshots through finance in `laptop-iteration-05-final`, and [current-head video](laptop-iteration-05-final/laptop-operations-route.webm).
- Final stability: [current-head idle audit](laptop-idle-final/evidence.json).
- Review history: [visual QA findings and revisions](visual-qa.md).

The final lightweight current-head audit reports no page errors, no console errors, no active-listener delta, no listener-registration delta, and no idle mutations inside `.lt-status` or `.lt-content`. The complete front-desk route likewise reports no page errors and zero idle UI/listener growth.

## Performance comparison

The first reliable same-environment baseline sampled 524 frames over five seconds: 104.67 average FPS, 16.61 1%-low FPS, and a 72.3 ms worst frame. The accepted front-desk route later sampled 681 frames over five seconds: 136.11 average FPS, 68.09 1%-low FPS, and a 16.8 ms worst frame. These runs differ in operational scene state, so they are evidence of acceptable play rather than a strict benchmark.

The subsequent identical before/after harness encountered a host SwiftShader collapse and produced only six/five samples over eight seconds. Its sub-1-FPS values are not statistically valid and are retained without being used to claim a speedup or regression. The comparable resource snapshot remained bounded: after versus before used 3,472 versus 3,764 draw calls, 1,777,525 versus 1,848,147 scene triangles, 224 versus 256 materials, the same 163 textures, the same estimated texture bytes, and zero listener delta in both runs. See [before](performance/before-main.json) and [after](performance/after-golf-operations.json).

## Known environment messages

The full routes contain pre-existing Canvas2D `willReadFrequently` warnings and aborted optional GLB requests during scene churn. They produced no page errors and are not golf-operations failures. A final current-head run separates actual `console.error` messages from warnings and reports none.

The current-head laptop video run completed the booking, cancellation, capacity-reopen, and finance workflow, then the software renderer exhausted resources while requesting an additional screenshot. The complete prior visual run is retained for the final home/normal-exit frames; the visually identical current-head idle audit independently confirms normal `Escape`, application stability, and no listener churn.

## Reproduction

From this branch, start the static game server:

```powershell
node tools/serve.cjs
```

Set `PLAYWRIGHT_MODULE` to an installed Playwright package and `QA_URL` to the server URL, then run:

```powershell
node tools/qa/golf-operations-journey.cjs
node tools/qa/golf-operations-laptop.cjs
node tools/qa/golf-operations-laptop-idle.cjs
node tools/qa/golf-operations-performance.cjs
```

Use `QA_OUT` for an isolated artifact directory; use `QA_ITERATION` for the front-desk route label. Each route exits nonzero on failed assertions.
