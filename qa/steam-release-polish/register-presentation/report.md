# Final Register Presentation Pass

## Outcome

The checkout-first production gate is accepted. Card and cash transactions complete through
normal player controls, use physical objects for every accounting step, survive interruption,
and recover safely from a mid-sale save. The final presentation pass added the remaining
customer basket, live card-session timeout, counter hierarchy, restrained typography, and
checkout sightline work without changing the proven transaction rules.

## Changes

- Customers carry a filled authored basket, set it on the counter, and remove it on sale,
  cancellation, give-up, or scene teardown.
- Card presentation starts a visible 15-second session. Timeout returns the card and exposes a
  clean retry; holding the card pauses the countdown so the player is not punished mid-gesture.
- The POS, terminal, scanner, printer, receipt, bagging carrier, and five engraved workflow
  stations now read as one left-to-right transaction surface.
- Restoration clutter moved out of the customer/register sightline with versioned save migration.
- Operational signage uses title-case sans-serif; club branding uses serif; transactional data
  retains monospace. Unrelated course-condition controls stay hidden in first person and checkout.
- A successful card swipe clears any earlier failure toast so authorization feedback cannot
  contradict the accepted physical gesture.

## Four visual iterations

| Iteration | Route | Finding and revision | Result |
|---|---|---|---|
| 1 | `iteration-1-card/` | Full card sale passed. Visual review found an oversized basket and inverted workflow plaques. | Revised scale, hierarchy, and plaque orientation. |
| 2 | `iteration-2-timeout/` | The live timeout appeared and expired correctly; retry exposed an expired-card pick race in the driver. | Driver and card reset were corrected; diagnostic frames retained. |
| 3 | `iteration-3-timeout-retry/` | Timeout, retry, judged swipe, receipt, bagging, and handoff all passed. | Accepted with zero console/runner diagnostics. |
| 4 | `iteration-4-final-cash/` | Complete cash route exercised tender, drawer, deposit, change, receipt, bag, and handoff. | Accepted with zero console/runner diagnostics. |

The later release verification in `final-routes/register-card-final-3/` repeats the full card
route at 1920x1080, including interrupted drag recovery, interrupted swipe recovery, refusal of
an incomplete swipe, animated authorization, receipt, bag fill, and customer handoff. The final
authorization frame contains no stale warning.

## Stability and accounting

- `final-routes/register-recovery-final/result.json`: two held units return to their original
  shelves after mid-sale save/reload; held ledger and ghost transaction clear; cash and revenue
  remain identical.
- `iteration-4-hardening/`: 100/100 accelerated checkout transitions, zero listener growth, and
  stable resource counts.
- `final-routes/performance-final/result.json`: 25/25 normal Escape/`E` reentries, zero listener
  growth, zero reentry failures, and stable idle/active/post-stress renderer samples.
- `final-routes/shader-final/result.json`: no shader or runner diagnostics.
- `final-routes/electron-final-2/result.json`: real Electron 43 runtime, native saves, Continue,
  WebGL, pointer lock, navigation denial, cleanup, and zero console/CSP errors all pass.

## Remaining checkout boundary

Pocket retrieval and individual shelf-pick gestures remain stylized state transitions rather
than bespoke skeletal clips. The impulse rack is scenery, not inventory. These are honest visual
boundaries; neither affects transaction correctness, normal controls, save safety, or the accepted
player-facing checkout loop.
