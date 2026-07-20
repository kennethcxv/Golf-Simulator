# Customer Simulation Acceptance Matrix

Date: 2026-07-19

Branch: `overnight/customer-simulation`

| Scenario | Evidence | Result |
|---|---|---|
| Empty retail display | `empty, low, and full-stock shopper fixtures preserve real inventory accounting` verifies unavailable specific-item demand, no cart entry, no held unit, and availability feedback. | Pass |
| One remaining unit / competing shoppers | The same test proves the last real unit can be reserved once, the second shopper is refused, and abandonment returns exactly one unit. | Pass |
| Full display / multi-item basket | The same test reserves two distinct UIDs, decrements the shelf twice, and restores both without duplication. The final queue frame shows the basket contents. | Pass |
| Single reservation | Functional browser cases cover early, on-time, 30-minute-late, and missed-window reservations through the normal `E` control. | Pass |
| Reservation party | `a reservation party arrives together but only its lead owns check-in intent` verifies one lead plus three lounge guests sharing the party/reservation. | Pass |
| No-show | `no-shows never spawn...` verifies the scheduled record resolves to `No-show` without an active actor. | Pass |
| Walk-in tee request | Functional browser case collects one $32 green fee through normal `E` and records successful check-in. | Pass |
| Browser | Final visual evidence records a browser moving to an authored display socket and cycling browse/inspect/select states. | Pass |
| Specific-item shopper | Final visual evidence records the requested `balls1` unit as a real held UID and shows the carry pose. | Pass |
| Lounge visitor | Final visual evidence covers two independently claimed lounge sockets, seated/talk animation, and clean release/reselection. | Pass |
| One, two, and many customers | Domain tests cover one visitor and a FIFO pair; final visual uses seven visitors; performance stress uses the hard cap of twelve. | Pass |
| Exterior approach and entry | Final screenshots/video show approach, door wait, coordinated opening, passage claim, and entry with no recovery or teleport. | Pass |
| FIFO shared service line | Domain test verifies capacity and no cutting; final visual shows retail customers at positions 0 and 1; front-desk cases use the same service point. | Pass |
| Card checkout | Physical Playwright run scans, totals, presents/authorizes card, prints receipt, bags, hands over, consumes two held UIDs, and banks $66 / two units only at completion. | Pass |
| Cash checkout | Physical Playwright run takes/deposits tender, counts exact change from visible drawer stacks, hands it back, prints receipt, bags, hands over, and banks $66 / two units. | Pass |
| Slow service / abandonment | Functional browser run expires the second shopper's real patience, returns the held glove, increments lost sales once, and displays player feedback. | Pass |
| Early / on-time / late arrival | Functional browser run accepts −30, 0, and +30 minute arrivals and collects the snapshotted $32 fee once. | Pass |
| Missed late window | Functional browser run rejects +60 minutes, leaves the booking unplayed, charges $0, and sends the visitor away. | Pass |
| Satisfaction and review evidence | Domain test derives a dissatisfied outcome and review payload from wait, availability, congestion, checkout, condition, and pricing factors with plain-language reasons. | Pass |
| Navigation recovery | Domain test verifies exact escalation: repath → alternate approach → release optional target → safe anchor → hidden emergency reposition. | Pass |
| Save during browse / queue | Domain save tests release optional browse occupancy and preserve FIFO queue identity. | Pass |
| Save during checkout | Functional run autosaves a half-scanned two-item sale and performs two real reloads. Each reload restores one customer, two matching cart/held UIDs, one queue entry, zero revenue/units, and a physical `2 to scan` retry. | Pass |
| Scene exit / re-entry | Domain test proves idempotent recovery; functional reload screenshots show the restored actor and products after clubhouse re-entry. | Pass |
| Long-run cleanup | Fifty accelerated visits end with zero active visitors, zero queued visitors, bounded history, and bounded transition history. | Pass |
| Listener/UI stability | Long A/B performance runs keep 92 active listeners before/after and the HUD at its existing approximately 1 Hz cadence. | Pass |

## Automated totals

- Full repository suite: 534 passed, 0 failed.
- Customer-specific domain suite: 18 passed, 0 failed.
- Functional browser matrix: passed, 0 console/page errors.
- Card physical checkout: passed, 0 console/page errors.
- Cash physical checkout: passed, 0 console/page errors.
- Final visual run: 7 active visitors, FIFO queue length 2, 0 recoveries, 0 emergency repositions, 0 console/page errors.
