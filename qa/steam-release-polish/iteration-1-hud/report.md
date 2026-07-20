# Visual iteration 1 — checkout guidance and feedback

Date: 2026-07-19

Scenario: fixed 1600×900 cashier camera, deterministic two-item order, normal
mouse/keyboard controls. Card and cash were each replayed from customer arrival
through final handoff.

Before references:

- `baseline/checkout-card-video/02-register-mode.png`
- `baseline/checkout-card-video/06-card-presented.png`
- `baseline/checkout-cash/07-drawer-open.png`
- `baseline/checkout-cash/09-change-counted.png`

After references:

- `iteration-1-hud/card/02-register-mode.png`
- `iteration-1-hud/card/07-card-swipe-incomplete.png`
- `iteration-1-hud/card/10-receipt-printed.png`
- `iteration-1-hud/card/11-bagged.png`
- `iteration-1-hud/cash/07-drawer-open.png`
- `iteration-1-hud/cash/09-change-counted.png`

## Defects listed before the pass and resolved

| # | Visible / interaction defect | Resolution and after evidence |
|---:|---|---|
| 1 | Bottom guidance said “Drag goods” through every later stage. | Live stage title/detail now changes from Scan through Handoff; card frames 07, 10, and 11. |
| 2 | `T total up` remained visible when Total was illegal. | T appears only after all items scan; unit guidance test and card frame 02. |
| 3 | `D drawer` remained visible during card, receipt, and bagging. | D appears only when the cash drawer can legally open/close; card frames contain no D. |
| 4 | The bottom bar overlapped the open drawer and money targets. | Guidance moved to a compact top status surface; cash frames 07 and 09 leave the till clear. |
| 5 | Course `Normal / Health / Moisture` controls stayed visible at checkout. | Register mode hides the course-layer switcher; all after frames. |
| 6 | There was no checkout phase/progress presentation. | Five-step Scan / Pay / Receipt / Bag / Handoff strip tracks the live transaction. |
| 7 | Swipe failure feedback existed only on the reader face, which the cashier could not see. | `Complete the swipe` is now the primary amber status title; card frame 07. |
| 8 | The active total was readable only on a small oblique POS display. | Status header carries the live scanned total in high-contrast tabular type. |
| 9 | Customer/order context was confined to tiny POS text. | Status header identifies `CHECKOUT · Morgan W.` throughout the sale. |
| 10 | Toasts accumulated without a bound and obscured the center work area. | Toasts deduplicate, cap at two during checkout, and sit below the persistent guidance. |
| 11 | Register mode used an aiming crosshair cursor for grab/drag interactions. | Cursor changes among default, grab, and grabbing from the real raycast target. |
| 12 | Cash feedback did not distinguish take/open/deposit/count/handoff. | Each cash sub-stage has one explicit instruction and only its legal control; cash frames 07 and 09. |

## Verification

- Card route: incomplete swipe refused; full physical swipe approved; receipt,
  bagging, and handoff completed; final revenue `$66`, units `2`, held `0`.
- Cash route: tender accepted, drawer opened, notes deposited, exact `$14` change
  counted and handed back; receipt, bagging, and handoff completed; final revenue
  `$66`, units `2`, held `0`.
- Browser/page error count: 0 on both routes.
- Pure guidance coverage: scanning, total, card feedback, all cash sub-stages,
  receipt, bagging, and handoff.

## Weaknesses carried into iteration 2

1. Customer body and face remain crude primitives.
2. The handoff palm is detached from the customer arm.
3. Customer, item, tender, receipt, and bag handoffs lack authored animation.
4. The bag remains visible after the sale banks.
5. Scanned products vanish into the carrier rather than visibly filling it.
6. Receipt is a rigid flat strip with no feed/curl/take motion.
7. Card floats without a customer-to-cashier hand animation.
8. Card reader screen still faces the customer and is weak from the cashier view.
9. Checkout lacks player hands for grab/deposit/change/handoff actions.
10. POS and device audio/feedback still need a dedicated polish pass.

The formal three-run after-performance comparison is deferred until the fourth
visual revision so it measures the completed checkout visual task against the
recorded baseline under identical conditions.
