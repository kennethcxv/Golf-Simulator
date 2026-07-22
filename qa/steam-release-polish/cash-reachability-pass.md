# Cash reachability repair

Date: 2026-07-19

Scope: functional repair before the four required visual-polish iterations. This
does not claim checkout or the wider release-polish goal complete.

## Baseline failure

The normal-controls cash route stopped at `cash-drawer`. Visible money clicks
either toggled the drawer or selected the wrong neighboring denomination, leaving
the transaction unable to hand back the required change.

## Repairs

- Extended drawer travel from 0.34 to 0.44 yards so the rear coin cups clear the
  counter slab while retaining a 0.71-yard staff corridor.
- Aligned the drawer-pull hotspot to the Blender model's actual leading edge and
  reduced it to the physical pull dimensions.
- Prioritized visible drawer money while the till is open.
- Rotated in-drawer notes front-to-back in their 7.6 cm wells, eliminating overlap
  between neighboring denominations.
- Added a cash-working camera composition that keeps both the open till and the
  customer's hand inside the viewport.
- Expanded the Playwright ledger diagnostics to record tender, deposit, drawer,
  and held-change state after each physical click.

## Evidence

- `functional-cash-pass/result.json` records the complete 20-step route.
- `functional-cash-pass/01-customer-at-counter.png` through
  `functional-cash-pass/13-done.png` are fixed-camera checkpoints.
- `functional-cash-pass/video/cash-normal-controls.webm` records the run.

Observed acceptance facts:

- The harness requested `$10 x1 + $1 x4`; the held ledger reached exactly that.
- Revenue remained `$0` through payment, change, receipt, and bagging.
- Final customer handoff banked `$66`, sold 2 units, and reduced held stock to 0.
- Browser console/page error count: 0.
- Unit suite: 516 passed, 0 failed.

Known presentation/performance warnings remain tracked for the upcoming visual
and performance passes, including Canvas2D readback warnings, bootstrap-aborted
model requests, shader warnings, stale register hints, and non-register turf HUD.
