# Routes A, B, and E acceptance

Accepted artifact: `routes-a-b-e-acceptance/result.json`

## Outcome

The final run passed in 302.6 seconds with 133 recorded normal-control steps and no game-state writes from the harness.

- Route A: created a fresh Relaxed empire through the visible menus, bought Willow Creek, entered through the main door, circulated the complete retail floor, received a Range-rock carton, opened it with the box cutter and flaps, carried its contents through both doors, and stocked the authored ball-wall socket with hold-E.
- Route B: opened the physical office laptop, bought stock and a potted-plant upgrade, waited the real supplier lead time, received physical cartons, placed the plant at its authored entrance socket, and stocked the new North Ridge shoe category at the shoe wall. The resulting fixture labels show `Range-rock dozen 3/15` and `North Ridge spikes 1/6`.
- Route E: used Esc > Save game for untouched basic, physically upgraded, and partially stocked states; then used Esc > Load game for all three. Cash, tier, every SKU shelf/back count, decor, layout, carton state, orders, and held units matched their actual slot payloads exactly.

All nine acceptance assertions passed:

- `basicExact`
- `upgradedExact`
- `partialExact`
- `plantPlaced`
- `partialBallsPreserved`
- `newCategoryStocked`
- `noDuplicateFixtures`
- `noStuckReloadCustomers`
- `lightingReconstructed`

The reload runtime arrays were empty in the accepted run. The harness also accepts a newly spawned shopper only when it is within the tier capacity, at the first route stop, has finite coordinates, and owns no cart, queue, or checkout state; that prevents a legitimate fresh ambient spawn from being mislabeled as a persisted customer.

## Evidence

- `01-main-door-normal-entry.jpg`
- `02-basic-store-circulation.jpg`
- `03-laptop-orders-placed.jpg`
- `04-orders-landed.jpg`
- `05-upgrade-placed.jpg`
- `06-starter-stock-placed.jpg`
- `06b-new-category-stocked.jpg`
- `07-partial-state-reloaded.jpg`
- `video/page@3b19103df279963f243aa4efe390092f.webm`
- `result.json`

The post-reload screenshot is inside the reconstructed ball-wall aisle. The saved/reloaded numerical shelf proof in `result.json` is authoritative because player camera pitch is intentionally not part of the save payload.

## Functional fix and regression test

The physical route found that an unpacked armful owned E for its carry action and therefore could not manually open the service door. `armsFullForDoor()` now opens the automatic service door for both carried cartons and unpacked goods. `tests/stockroom-door-carry.test.js` covers carton, unpacked-goods, and empty-hands behavior. The focused door/unboxing run passed 20/20.

## Browser diagnostics

The gameplay assertions and screenshots completed, but this run is not described as console-clean:

- Three WebGL/Three warnings were recorded: the recurring D3D X4000 diagnostic and a 3D-texture upload diagnostic.
- Forty-eight GLTFLoader blob-texture errors and 41 aborted model requests were recorded across three deliberate scene replacements and final browser teardown. These are asynchronous loader teardown diagnostics, not missing shop state; the reconstructed fixtures, lighting, stock, and interactions all passed. They remain listed in the raw result for the final performance/console audit.

