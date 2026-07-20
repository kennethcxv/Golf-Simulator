# Golf Operations Visual QA Log

Review method: fixed 1600x900 player-camera captures, recorded normal-control routes, console/page-error capture, listener instrumentation, DOM mutation auditing, and deterministic state assertions. The retained artifacts show both the starting point and the accepted result.

## Iteration 1 — baseline

References: [front desk](baseline/01-front-desk-fixed-camera.png), [legacy tee sheet](baseline/02-legacy-tee-sheet.png), [automatic charge](baseline/05-single-key-auto-charge.png), and [baseline evidence](baseline/baseline.json).

| Finding | Disposition |
| --- | --- |
| The reservation name and physical customer name did not match. | Fixed: reservation IDs now drive exact arrival NPC identity. |
| Repeated generic names made the queue visibly implausible. | Fixed: seeded pools enforce within-day name uniqueness. |
| All fixture golfers could effectively appear at opening. | Fixed: staggered planned arrivals cover early, on-time, late, and absent outcomes. |
| Pressing one interaction key charged and completed golf without confirmation. | Fixed: confirmation, tender, receipt, and check-in are explicit stages. |
| Golf check-in reused an opaque single-step charge rather than an adapted payment context. | Fixed: separate golf transaction state uses the existing cash/card mechanics. |
| There was no visible cash, card, prepaid, or deposit state. | Fixed: tender choice, amount due, deposit, change, card swipe, and receipts are visible. |
| Party membership and headcount were not operationally represented. | Fixed: holder, named members, membership/guest tags, and party size are shown. |
| The laptop exposed one simple reservation per slot, not capacity or pairing. | Fixed: each card shows reserved places, remaining places, and paired reservations. |
| There was no walk-in availability workflow. | Fixed: front desk lists real eligible slots and validates headcount. |
| Late, no-show, and cancellation policy was absent from the player surface. | Fixed: state chips, explicit actions, confirmation copy, and policy text are present. |
| No golf-specific receipt or stable subledger relationship was inspectable. | Fixed: receipts and operations finance IDs are persisted and displayed. |
| Repeated laptop navigation added 117 active listeners in the baseline harness. | Fixed: cached shell nodes/listeners; final audit delta is zero. |

## Iteration 2 — front desk operating day

References: [arrival](iteration-04/01-arrival-at-counter.png), [desk](iteration-04/02-tee-desk-open.png), [card receipt](iteration-04/05-card-receipt.png), [cash flow](iteration-04/06-cash-drawer.png), [walk-in](iteration-04/09-walk-in-created.png), and [video](iteration-04/operating-day.webm).

| Finding | Disposition |
| --- | --- |
| Periodic front-desk refresh interrupted an in-progress physical card swipe. | Fixed: render signatures preserve interaction state while data is unchanged. |
| The walk-in action fell below the panel at 1600x900. | Fixed: queue/detail layout and action density were tightened. |
| A missing optional note rendered as the literal word `null`. | Fixed: empty values now use intentional fallback copy. |
| The customer at the desk faced away from the player. | Fixed: counter wait transform and facing direction were corrected. |
| An internal numeric date key leaked into player-facing details. | Fixed: formatted weekday/date labels are used. |
| Party-size text was repeated in the subtitle and detail grid. | Fixed: the hierarchy now states the information once at each useful level. |
| A stale success notice persisted after selecting another reservation. | Fixed: transient feedback resets on context changes. |
| Walk-in party size invented an unrelated named golfer in the customer queue. | Fixed: one holder NPC represents the party; headcount remains on the booking. |
| Decimal-dollar arithmetic exposed awkward cent values. | Fixed: all golf accounting stores and formats integer cents at boundaries. |
| HUD/tutorial fragments competed with the modal desk. | Fixed: they hide while the front-desk mode is active. |
| The first receipt treatment was too small to read comfortably. | Fixed: receipt hierarchy, width, contrast, and exact amount/change lines were enlarged. |
| Idle refresh rebuilt controls and risked listener churn. | Fixed: stable render signatures; accepted route has zero listener and mutation delta. |

## Iteration 3 — laptop booking office

References: [home](laptop-iteration-05-final/01-home-operations-alerts.png), [tee sheet](laptop-iteration-05-final/02-capacity-aware-tee-sheet.png), [booking](laptop-iteration-05-final/03-prepaid-party-booked.png), [cancellation](laptop-iteration-05-final/04-cancellation-confirmation.png), and [finance](laptop-iteration-05-final/06-operations-subledger.png).

| Finding | Disposition |
| --- | --- |
| New booking fields inherited dark input colors and were hard to read on cream cards. | Fixed: laptop-specific input specificity supplies white fields and dark text. |
| World HUD/tutorial content overlapped the projected laptop. | Fixed: laptop mode owns visibility just as other focus modes do. |
| A no-show payment chip could read as if money were still due. | Fixed: terminal no-show chips show retained fee/refund outcome. |
| A canceled prepaid booking could read simply as “paid.” | Fixed: cancellation chips lead with fee and refund state. |
| No-shows and cancellations inflated expected players/utilization. | Fixed: operational summary excludes terminal bookings from expected play. |
| Past same-day slots were still actionable from the booking form. | Fixed: elapsed slots are disabled and rejected in the core validator. |
| The zero-late alert had incorrect plural/conditional wording. | Fixed: summary grammar is count-aware. |
| Main-ledger operation rows exposed raw camel-case category names. | Fixed: readable operation labels are used consistently. |
| A prior-day effective event posted into a mismatched finance day. | Fixed: entries reconcile on actual posting day and retain effective-day audit metadata. |
| Seven-day horizon logic opened an eighth date. | Fixed: today through day +6 is the exact configurable seven-day window. |
| Scrolling projected laptop content could shift the 3D navigation target. | Fixed: the QA route re-resolves projected bounds after content scrolling. |
| The home page did not summarize live front-desk urgency after booking changes. | Fixed: utilization, waiting/next arrival, exact golf cash, late/no-show alerts, and waiting parties are live. |

## Iteration 4 — stability and acceptance refinement

References: [complete laptop workflow](laptop-iteration-04-final/evidence.json), [current-head idle audit](laptop-idle-final/evidence.json), [policy](laptop-iteration-04-final/07-live-schedule-and-policy.png), and [normal exit](laptop-iteration-04-final/09-normal-escape-return.png).

| Finding | Disposition |
| --- | --- |
| Laptop status buttons were recreated every clock refresh, registering six extra listeners during the full route. | Fixed: status elements are cached and only changed values are written. |
| Status text/class assignments still produced idle mutation callbacks. | Fixed: assignments are guarded by value comparisons; final application-DOM count is zero. |
| The QA fixture inherited the production clock after a slow load and could begin past opening. | Fixed: the deterministic reset pins the operating day to opening time. |
| A projected click at the laptop bezel edge was intermittently clipped. | Fixed: controls scroll into view and click centers are recalculated. |
| Whole-document transform mutations from the 3D projection obscured application UI churn. | Fixed in audit: the observer is scoped to `.lt-status` and `.lt-content`. |
| A long diagnostic stdout stream could trigger an `EPIPE` in constrained runners. | Fixed in harness: evidence is written to JSON and console output stays compact. |
| The final screenshot-heavy rerun exhausted the host software renderer after completing the finance step. | Documented: current-head frames through finance/video are retained; complete prior visual exit plus a lightweight current-head exit audit close the evidence chain. |
| The later identical performance harness captured only five/six frames in eight seconds under degraded SwiftShader. | Documented: invalid FPS is not used; resource counts and the earlier reliable five-second routes are reported. |
| Optional GLB requests are sometimes aborted while scenes are replaced. | Classified: pre-existing/non-fatal; page errors remain zero. |
| Canvas readback emits repeated `willReadFrequently` warnings. | Classified: pre-existing warning; the final audit separately reports zero console errors. |
| Pending payment could have been mistaken for completion if the desk closed mid-flow. | Verified/fixed: pending state survives close/reload and requires resume or explicit cancellation; no money moves on abandonment. |
| Normal `Escape` needed to restore focus and remove modal body classes. | Verified: both front desk and laptop close normally and restore gameplay state. |

## Accepted visual result

The front desk is readable from the actual cashier camera, clearly separate from merchandise checkout, and fast to operate. The palette follows warm cream, deep golf green, muted sage, walnut, warm charcoal, and restrained brass. The projected laptop keeps its existing visual system while adding dense operational information without obscuring normal navigation. Receipts, status chips, policy notices, exact money, capacity, and current actions remain legible at the tested 1600x900 viewport.
