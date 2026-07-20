# Routes C and D acceptance

Accepted artifact: `routes-c-d-acceptance-final/cash/result.json`

Supporting mixed-floor cameras: `acceptance-visual-4-after/customer-flow/`

## Protocol

The run boots a fresh Relaxed empire and walks through the real shop door to the cashier. A documented setup fixture then removes one pre-existing ambient shopper, sets the shop to Premium, fills all 42 retail lines to their authored capacities (289 units), rebuilds the real stock visuals, disables additional ambient arrivals, and calls the shipped `debugSpawn` route exactly ten times.

That fixture is reported as a state write and is used only to establish the repeatable Route C/D stress state. It does not set a shopper's stops, cart, queue state, transaction, payment method, or player pose. From that point onward shoppers use the production navigation, shelf-debit, basket, queue, and `register.begin` paths. The player uses normal keyboard and pointer controls for checkout and walks normally to the physical laptop afterward. `prepareCheckoutQa` and `debugSpawn` are never used in the checkout path; `sendToCounter` is never used at all.

## Route C — customer browsing

The accepted read-only 100 ms route trace recorded:

- Exactly ten active shoppers; no eleventh ambient arrival.
- Club visits at `rack_drivers`, `rack_irons`, and `rack_putters`.
- Apparel visits at `table_polos`, `shelf_small`, `fittingroom`, and the bag area.
- Shoe visits at `shoerack`.
- Four visible basket users: Morgan W., Riley P., Robin K., and Drew H.
- Five queued users and a maximum queue depth of five.
- Fourteen distinct visited fixtures/experiences, including the putting demo and Tour Vault.

All ten browsing assertions are true in the accepted result: ten customers, assigned and actually observed club/apparel/shoe browsing, basket use, queue use, and laptop use.

## Route D — full-store stress gameplay

Riley P. naturally entered, browsed the accessories wall, removed `umb1` from the full shelf, joined the production queue, and caused `register.begin`. The player then completed the cash transaction through the physical register sequence:

1. Enter register mode with E.
2. Drag the umbrella through the scanner.
3. Total with T.
4. Pick up customer cash.
5. Open the physical drawer with D.
6. Deposit the tender.
7. Select and hand over change.
8. Take the printed receipt.
9. Bag the item.
10. Hand the carrier to the customer.

Sales moved from 0 to 1 unit and $0 to $26 revenue. The sold UID `u2` was absent from `shop.held` afterward; other held UIDs belonged to the remaining active shoppers and were correctly retained. The player then walked from checkout to the office, opened the physical laptop with E, selected Inventory, verified the full authored capacities, and closed it with Escape. Only one laptop root existed.

## Evidence

- `01-door-open-normal-route.jpg`
- `02-cashier-ready.jpg`
- `02b-full-premium-ten-customers.jpg`
- `03-natural-customer-at-counter.jpg`
- `03b-stress-basket-queue.jpg`
- `04-register-mode.jpg`
- `05-all-items-scanned.jpg`
- `06-cash-tender.jpg`
- `07-cash-drawer-open.jpg`
- `08-change-complete.jpg`
- `09-receipt-printed.jpg`
- `10-all-items-bagged.jpg`
- `11-sale-finished-customer-departing.jpg`
- `12-full-store-laptop.jpg`
- `video/attempt-02.webm`
- `result.json`
- `summary.json`

The accepted attempt produced no console warning, console error, page error, or HTTP error. One GLB request (`clubhouse/rangefinder.glb`) was aborted during isolated-context teardown.

Frame timing and resource-count acceptance is intentionally not claimed here; it is handled by the separate repeated performance protocol.

