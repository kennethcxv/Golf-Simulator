# Iteration 4 — Responsive checkout hardening and lifecycle

## Scope

This final checkout pass hardened normal-control leave/re-entry, 1280×720 HUD fit,
mid-transaction recovery, input priority, customer timing, and dynamic Three.js
resource ownership. It did not change the pure register transaction rules, price
calculation, revenue authority, or save schema.

The before reference is the accepted iteration-3 card/cash evidence in
`../iteration-3-feedback/`. Final after evidence is in `card-1280-final-3/`,
`cash-1280-final/`, `recovery-final/`, `performance-final/`, and
`performance-100-cycles-final/`.

## Defect list and fixes

1. Escape guidance said “Step back,” although it leaves register mode. It now says
   “Leave register.”
2. Escape during a product drag could leave the product floating at carry height.
   Register mode now records and restores the exact pre-grab origin.
3. Escape during a card drag could retain an invisible swipe gesture. Leave now
   cancels the swipe, restores the card to the top, and clears swipe feedback.
4. An open transaction drawer could visually close after re-entry while simulation
   still reported it open. Entry now synchronizes the physical drawer target from
   transaction state.
5. Checkout toasts could remain after leaving the till. Checkout-channel notices
   are explicitly cleared without deleting world/system notices.
6. The 1280×720 player-camera framing had no automated viewport proof. The route
   now records HUD/toast bounds and rejects off-screen or overlapping UI.
7. Re-entry clicks used a fixed timing assumption while the focus camera was still
   moving. The route waits for measured camera stability.
8. Browser re-entry skipped the visible “Click to play” step after pointer release.
   QA now performs that normal canvas click before `[E]`.
9. Recovery compared serialized currency with strict floating-point equality and
   could report a false money change. It now uses a half-cent tolerance.
10. The performance route could count the first upload of checkout hands as
    transition growth. It warms the normal hand path before the active baseline.
11. The original 25-transition test did not prove long-session behavior. A
    100-cycle normal Escape/`E` gate now runs with a non-expiring soak fixture.
12. Post-stress memory was sampled before renderer residency settled. The harness
    now requires repeated stable geometry/texture samples before recording.
13. Departed customers detached unique character primitives without disposing
    them. Character creation now captures its owned geometry/material set and
    exposes idempotent disposal.
14. Shopper-held product boxes were detached on payment, give-up, or departure
    without disposal. All three paths now release their unique mesh resources.
15. Final patience-ring geometry/materials were not disposed with the customer.
    Customer teardown now releases them and the clubhouse disposes the base ring.
16. Ambient golfers used the same per-character primitives and could churn during
    a long checkout session. Both golfer removal paths now call character disposal.
17. Every shelf-count change detached the old merged stock display without
    disposing its GPU buffers. Dynamic stock geometry/material ownership is now
    explicit, while shared GLB geometry and cached kit materials remain untouched.
18. Customer patience kept draining while the cashier was actively serving the
    transaction, allowing long but valid payment paths to abandon mid-service.
    Patience now pauses only while register mode is active and resumes if the player
    walks away.
19. The terminal’s invisible click target could win the raycast over the visible
    card after an incomplete swipe. The visible card now owns that overlap while a
    swipe is legal.
20. The performance fixture itself could expire during the deliberately abnormal
    100-cycle soak. Test-only patience is extended so re-entry failures measure the
    register, not correct customer abandonment.

## Functional and visual acceptance

- Card: `card-1280-final-3/result.json` reports `ok: true`, zero application
  errors, both re-entry checks green, all five hand checkpoints visible, incomplete
  swipe feedback, accepted physical swipe, receipt, two-item bagging/handoff, $66
  revenue, and zero held/order-held units. Nineteen screenshots and one WebM cover
  the complete normal-control route.
- Cash: `cash-1280-final/result.json` reports `ok: true`, zero application errors,
  held-object restoration and open-drawer re-entry green, all seven hand checkpoints
  visible, correct denomination flow, receipt, bagging/handoff, $66 revenue, and
  zero held/order-held units. Nineteen screenshots and one WebM are present.
- Responsive visual review accepted the 1280×720 HUD, toast separation, card
  failure state, drawer denomination readability, receipt, carrier, and articulated
  customer/cashier hands. Key after frames are card
  `07-card-swipe-incomplete.png` and `12a-handoff-motion.png`, plus cash
  `07a-drawer-reentered-open.png`, `09-change-counted.png`, and
  `12a-handoff-motion.png`.
- Save/load: `recovery-final/result.json` restores the two in-flight units to their
  shelves, clears held and ghost transaction state, preserves cash, and banks no
  revenue. Both before/after screenshots and a WebM are present.
- Console/network: all accepted runs contain zero page errors, application console
  errors, and real request failures. The only diagnostic is the known Chromium/ANGLE
  shader X4000 warning.

## Performance acceptance

- Three identical final 25-cycle samples and a contemporaneous pre-iteration-4
  control are documented in `../performance-before-after.md`.
- Under the same host contention, the final adjacent run is slightly faster than
  control: 47.94 vs 46.49 idle FPS and 110.24 vs 108.72 register FPS, with lower
  CPU render time and 108.3 vs 120.8 MiB used heap.
- Twenty-five-cycle renderer geometry growth fell from +132 in the adjacent control
  to +9 final; textures and listeners stayed at zero growth.
- `performance-100-cycles-final/result.json` completes 100/100 normal re-entries,
  zero listener growth, zero texture growth, stable post-run residency, and +9
  renderer geometries. The pre-disposal run grew by +194.
- Register Canvas2D work remains event-driven: zero `fillText`, seven `fillRect`,
  and zero `getImageData` calls during the active eight-second sample.

## Result

Iteration 4 is accepted for the player-facing checkout scope. Card, cash, responsive
HUD, interruption recovery, save/load conservation, visual feedback, and measured
lifecycle behavior are demonstrated through normal gameplay controls. Project-wide
scene complexity and the Chromium/ANGLE warning remain documented follow-up risks;
they are not regressions introduced by this checkout increment.
