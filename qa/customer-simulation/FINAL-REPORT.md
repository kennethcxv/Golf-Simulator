# Production Customer Simulation — Final Report

Date: 2026-07-19

Branch: `overnight/customer-simulation`

Base: `0c5137e`

Status: accepted in the isolated worktree; not merged

## Outcome

The clubhouse now runs a bounded, persistent, player-facing customer simulation instead of a renderer-only shopper loop. Visitors arrive from outside, coordinate through the real entrance, choose intent-specific activities, claim authored interaction/occupancy sockets, reserve actual inventory, share one FIFO retail/front-desk line, use the existing physical checkout, react to service quality, leave through the door, and survive save/load at safe lifecycle checkpoints.

The implementation preserves the existing inventory, register, reservation, economy, review, management, and save architectures. The domain owns customer truth in `state.shop.customerSimulation`; the Three.js layer renders and advances that truth through narrow adapters.

## Shipped behavior

- One explicit lifecycle state per visitor, with legal transitions and bounded state/transition history.
- Pro-shop shopper, reservation check-in, walk-in tee request, browser, specific-item shopper, and lounge intents.
- Planned staggered arrivals, reservation party grouping, typical 10–20 minute early arrivals, late arrivals, no-shows, active cap 12, queue cap 6, and queue-pressure throttling that preserves scheduled guests.
- Exterior spawn/arrival/approach sockets, single door-passage ownership, real door animation, authored browse clearances, lounge occupancy, and safe anchors.
- Real shelf-unit reservation by stable UID; no visual-only products, duplication, or silent deletion.
- Shared FIFO service line for retail and front desk, visible patience feedback, wait tracking, abandonment, lost-sale accounting, and product return.
- Existing physical card/cash register transaction retained: scanning, payment, receipt, bagging, and handoff remain the only path that banks a retail sale.
- Front-desk `E` interaction for early/on-time/late reservations and walk-ins, with the snapshotted green fee charged exactly once; arrivals beyond 45 minutes are declined without a fee.
- Browse, inspect, reach, carry, stage, pay-card, pay-cash, receive, talk, sit, door, and leave poses on pooled shared character assets.
- Satisfaction derived from wait, cleanliness, store/course condition, availability, pricing, congestion, checkout, and check-in evidence; dissatisfied visits always generate review evidence.
- Recovery escalation in the required order, with teleport reserved for hidden emergency reposition after four safer actions.
- Save version 4 persistence for active visitors, cart UIDs, queue order, path/target checkpoint data, arrival schedule, counters, metrics, and experience evidence. Renderer-only transaction objects are cleared on reload and checkout visitors return to a safe retry state without repeating payment.

## Verification

The final repository suite passes 534/534 tests. The detailed scenario mapping is in [TEST-MATRIX.md](TEST-MATRIX.md).

Player-facing browser evidence:

- [Functional result](functional/2026-07-19T-functional-final/functional.json): five normal-control front-desk policies, patience abandonment, physical half-scan, game autosave, and two reloads; passed with zero console/page errors.
- [Card checkout result](checkout/2026-07-19T-checkout-card-final/checkout.json): $66 / two units banked, sale-specific held units 2 → 0; passed with zero console/page errors.
- [Cash checkout result](checkout/2026-07-19T-checkout-cash-final/checkout.json): exact $14 change, receipt, bagging, handoff, $66 / two units banked; passed with zero console/page errors.
- [Final visual diagnostics](final-visual/visual-2026-07-19T-final-visual-4.json), [visual review](final-visual/REVIEW.md), five screenshots, and WebM: seven-visitor mixed-intent cast, real door, lounge, browse/carry, FIFO queue, and visible patience; zero console/page errors.
- Four documented visual passes: [iteration 1](iteration-1/REVIEW.md), [iteration 2](iteration-2/REVIEW.md), [iteration 3](iteration-3/REVIEW.md), and [iteration 4](iteration-4/REVIEW.md).

## Performance comparison

The formal comparison uses detached clean main `0c5137e` and the final branch with identical Chrome headless/SwiftShader flags, 1600×900 viewport, fixed cameras, 3-second warmup, three 12-second samples per scenario, listener instrumentation, and HUD mutation observation.

| Metric | Idle delta | 12-customer delta | Gate |
|---|---:|---:|---:|
| Average FPS | −2.17% | +2.90% | no worse than −10% |
| 1% low FPS | −4.29% | +13.16% | no worse than −10% |
| Draw calls | +0.07% | +0.92% | no more than +5% |
| Triangles | −0.10% | −0.08% | no more than +5% |
| Materials | −1.51% | −16.17% | no more than +5% |
| Estimated texture bytes | 0.00% | 0.00% | no more than +5% |
| JS heap | +0.25% | +4.54% | no more than +5% |
| Active listeners | 92 → 92 | 92 → 92 | no growth |

Raw reports: [clean-main baseline](long-baseline/performance/performance-20260719-long-baseline.json) and [final branch](long-final/performance/performance-20260719-long-final.json). Absolute SwiftShader FPS is not representative of hardware play; the controlled deltas are the acceptance signal. HUD mutations remain at the existing approximately 1 Hz cadence.

## Visual revision record

Across four inspected iterations, the work corrected entrance alignment, camera composition, actor facing, product placement, basket readability, queue spacing, patience visibility, sitting height and limb direction, chair approach/easing, door timing, and visual fixture coverage. The accepted final run contains no customer recovery or emergency reposition event.

## Asset and licensing record

No external asset was downloaded. Customer characters, carried goods, basket contents, indicators, and interaction sockets use original code, existing project materials/assets, and shared procedural geometry. No raw Tripo or third-party source was modified.

## Stable commits

- `7434e7d` — baseline evidence
- `4c9b426` — persistent lifecycle and arrivals
- `173f4aa` — physical clubhouse integration
- `86303b4` — seating, carrying, orientation, and visual polish
- `5741dde` — gameplay, checkout, visual, and performance acceptance gates
