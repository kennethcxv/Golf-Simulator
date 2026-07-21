# Natural Checkout Acceptance

Date: 2026-07-20

Branch: `overnight/pro-shop-overhaul`

Harness: `tools/qa/pro-shop-natural-checkout.mjs`

## Protocol

- Every attempt starts in a new isolated browser context and creates a fresh empire through the visible menu.
- The player walks from the outdoor spawn, opens the hinged pro-shop door, crosses the threshold, and reaches the cashier with normal keyboard controls.
- The store clock is paused with the normal Space control during an open hour. Renderer-driven ambient customers continue their authored routes while unrelated time-driven economy changes remain fixed.
- A sale is accepted only after an ambient customer enters, browses a fixture, removes a real unit from starter shelf stock, joins the physical queue, and creates the transaction through `register.begin`.
- The player completes the physical interaction with E, pointer drags/clicks, T, D, the receipt, carrier, and customer handoff.
- The harness never calls `prepareCheckoutQa`, `sendToCounter`, or `debugSpawn`; it never sets customer, transaction, inventory, player, or payment state.

## Accepted Results

Evidence root: `qa/pro-shop-overhaul/natural-checkout-acceptance`

| Method | Attempt | Natural customer | Product | Ledger result | Inventory result | Duration |
| --- | ---: | --- | --- | --- | --- | ---: |
| Cash | 1 | Quinn B. | `tees1`, $6 | units 0 -> 1; revenue $0 -> $6 | shelf 14 -> 13 | 66.9 s |
| Card | 2 | Alex R. | `glove1`, $19 | units 0 -> 1; revenue $0 -> $19 | shelf 4 -> 3 | 101.2 s |

Both routes ended with empty held inventory, no active register mode, no transaction, and no customer retained at the register. Each method includes the full screenshot sequence, `result.json`, and recorded WebM gameplay.

## Diagnostics

- No page errors or application errors occurred.
- Cash logged the recurring Three.js/D3D11 X4000 shader warning already recorded by the visual passes; card logged no console warning.
- Failed requests were `net::ERR_ABORTED` GLB loads at isolated-context teardown, not HTTP failures or missing assets.
