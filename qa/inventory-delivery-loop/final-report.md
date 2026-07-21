# Physical inventory and delivery loop - final report

Status: **accepted on `overnight/inventory-delivery-loop`**. The branch was
created from clean main commit `0c5137e`, has not been merged into main, and the
implementation milestone is `5b0f39b`.

## Delivered system

The laptop, supplier, physical world, stockroom, shop floor, customers, and
existing register now share one authoritative lot ledger. Every quantity is
owned by exactly one of these stages:

```text
in transit + delivered unopened + opened box + reserve + shelf
+ customer held + sold + explicitly disposed/lost
```

Supplier lots retain order, line, SKU, cost, and provenance. Atomic keyed moves
transfer exact lot allocations between stages; retries replay their recorded
result instead of charging or moving stock twice. QA reconciliation compares
the ledger with orders, physical box contents, player carry, reserve, shelves,
and customer-held records and reports discrepancies without silently repairing
them. Legacy saves receive explicit migration/opening-balance lots only where
the old architecture had no provenance to recover.

Orders now retain the requested ID, supplier, lines, quantity and unit cost per
SKU, goods/freight/total costs, creation time, processing and dispatch states,
ETA, delivered and receiving states, physical box IDs, unreceived quantity,
completion state, history, and idempotency key. Multi-SKU baskets group into
supplier orders with one supplier freight charge. An order is funded once,
failed validation is free, safe cancellation refunds once, and repeated submit
events return the original result. The existing laptop screens read these real
orders and inbound shipments; their navigation and visual architecture were
not redesigned.

The physical route is now:

1. A short delivery-van sequence reverses to the receiving door, opens its rear
   doors, waits through unload, and departs with player notification.
2. Nine stable marked pad slots are preferred. Twelve compact two-tier fallback
   slots remain west of the door clearway. A full 21-carton area blocks later
   vans without deleting their paid orders; clearing a bay lets the next wave
   reuse that exact slot.
3. Every carton has a persistent ID, parent order and supplier, exact
   line/lot-based contents, initial and remaining quantities, weight class,
   location/carrier, tape/open/flap state, transform and surface slot, damage
   state, and disposal state.
4. The player carries one carton, places it on the authored worktable or rack,
   holds the visible cutter along the seam, opens two correctly pivoted flaps,
   and sees bounded real product silhouettes update with remaining quantity.
5. Armfuls retain lot allocations. Loose reserve is visibly grouped and
   quantity-labelled on the authored stock shelves; unopened cartons occupy
   separate rack bays and must be picked back up before opening.
6. Reserve products can be physically taken from the rack and stocked one at a
   time onto only their compatible authored display. Capacity, partial stock,
   leftovers, empty/low/full appearance, facing, and existing product assets
   remain authoritative.
7. A customer pick atomically moves one allocated unit from shelf to
   customer-held. Abandonment returns it. The existing card and cash register
   sequences leave revenue and sold stock unchanged through scan, tender,
   authorization/change, receipt, and bagging; handoff performs the single
   customer-held-to-sold transfer and banks revenue. Stale, missing, or replayed
   baskets fail atomically.
8. Empty cartons remain physical, flatten only when empty, and leave the world
   only at the authored recycling station. Disposal/loss of product requires an
   explicit audited ledger operation.
9. Shelf and total-stock states feed the existing inventory laptop with
   supplier availability, current incoming quantity, earliest ETA, OUT/LOW
   status, and an advisory quantity. Reorder requires an explicit player order;
   no automation was introduced.

The save schema is version 4. Orders, lots, keyed operations, shipment waves,
box identities and transforms, tape/flaps/contents, player carry, reserve,
shelf, held, sold, and disposal data are serialized. Customer-held stock is
written to disk and safely returned on load because renderer-owned customers do
not survive a reload. A partially cut carton remains delivered-unopened until
the first flap opens; legacy visual inference is used only when the explicit
`inventoryOpened` field is absent.

## Authored assets and licensing

The repeatable Blender 5.1 builder created a worktable, stock shelf, box cutter,
two-stream recycling station, and delivery van. Source `.blend` files and GLBs
are retained. All geometry is metre-scale, transforms are applied, larger props
have simplified `COL_*` meshes, moving van doors remain separate with hinge
pivots, and every GLB passed a clean reimport.

| Asset | Triangles | Materials |
| --- | ---: | ---: |
| Worktable | 1,364 | 6 |
| Stock shelf | 18,176 | 5 |
| Box cutter | 540 | 4 |
| Recycling station | 7,196 | 7 |
| Delivery van | 31,268 | 10 |

The kit is project-owned original work with no external inputs. No Tripo or
third-party source was modified or downloaded. Provenance and counts are in
[`assets/inventory_delivery_asset_build.json`](assets/inventory_delivery_asset_build.json),
with source notes in
[`asset_sources/blender/inventory_delivery/README.md`](../../asset_sources/blender/inventory_delivery/README.md).

## Test matrix

`npm test` passes **533/533**. The focused lifecycle matrix also passes 7/7 and
covers every requested combination:

| Requested case | Retained proof |
| --- | --- |
| One SKU, one box, ten boxes, multiple SKUs/suppliers | Exact manifests, three supplier groups, shared freight, unique box IDs |
| Blocked delivery and simultaneous arrivals | 23 same-minute vans fill 9 pad + 12 fallback slots, block two, then recover into a vacated stable slot |
| Delivery while away | Accelerated clock lands the real order without requiring the clubhouse renderer |
| Save before/after arrival | Same order/box IDs and quantities; replay charge is zero |
| Save during opening | 43% tape progress survives while inventory remains delivered-unopened |
| Save with partial contents/carry | Seven units remain in the same box and five allocated units remain in hand |
| Save while carrying/placed | Same carried carton survives; worktable x/y/z/rotation/surface/slot survive |
| Partial/full shelf and leftovers | Hold stocking stops at capacity and leaves the final three-unit armful intact |
| Customer abandonment | Held unit returns to the shelf with exact allocation |
| Successful/replayed/stale sale | Two units sell and $56 banks once; replay and mixed stale basket mutate nothing |
| Reorder | Advice is read-only; normal laptop submission creates one funded incoming order |
| Empty-box disposal | Every box drains, flattens, recycles, and leaves no product behind |
| 100 deliveries / 1,000 units | 100 orders and boxes fully unpack/recycle; reserve rises by exactly 1,000 and reconciliation remains exact |

The full suite also retains the earlier register abandonment, mid-sale reload,
box collision, delivery-window, legacy-save, shelf compatibility, tutorial, and
save architecture coverage.

## Browser functional and visual evidence

All retained gameplay evidence uses Chromium at 1600 x 900. Direct fixtures are
used only to establish deterministic stock and delivery load; the player-facing
actions use trusted keyboard/mouse input through normal controls.

| Requirement | Evidence |
| --- | --- |
| Order creation and live shipment state | [`01-live-orders.png`](final-normal-controls/01-live-orders.png) |
| Van delivery and preferred receiving | [`02-van-and-pad.png`](final-normal-controls/02-van-and-pad.png) |
| Safe fallback / blocked-zone layout | [`03-safe-fallback-ten.png`](final-normal-controls/03-safe-fallback-ten.png) and the 23-order matrix |
| Closed worktable carton | [`04-worktable-sealed.png`](final-normal-controls/04-worktable-sealed.png) |
| Cutter and flap-state progression | [`smoke/result.json`](smoke/result.json) and [`02-after-cut.png`](smoke/02-after-cut.png) |
| Open box and truthful visible contents | [`05-worktable-open-contents.png`](final-normal-controls/05-worktable-open-contents.png) |
| Individual-product carry and hands | [`06-product-carry-hands.png`](final-normal-controls/06-product-carry-hands.png) |
| Loose stockroom reserve and take-back | [`07-loose-reserve-rack.png`](final-normal-controls/07-loose-reserve-rack.png), [`07b-reserve-armful.png`](final-normal-controls/07b-reserve-armful.png) |
| Compatible retail shelf stocking | [`07c-retail-shelf-stocked.png`](final-normal-controls/07c-retail-shelf-stocked.png) |
| Unopened carton rack | [`08-unopened-carton-rack.png`](final-normal-controls/08-unopened-carton-rack.png) |
| Empty-box recycling | [`09-recycling-before.png`](final-normal-controls/09-recycling-before.png), [`10-recycling-after.png`](final-normal-controls/10-recycling-after.png) |
| Customer pickup and staged checkout | [`card/01-customer-at-counter.png`](checkout/card/01-customer-at-counter.png) |
| Card sale | [`card/result.json`](checkout/card/result.json) and [`card/13-done.png`](checkout/card/13-done.png) |
| Cash, physical tender/change, sale | [`cash/result.json`](checkout/cash/result.json) and [`cash/09-change-counted.png`](checkout/cash/09-change-counted.png) |
| Low stock and explicit reorder | [`reorder/result.json`](reorder/result.json) and [`03-reorder-submitted.png`](reorder/03-reorder-submitted.png) |
| Actual autosave and reload | [`save-load/result.json`](save-load/result.json), before/after screenshots |
| Exact final reconciliation | [`final-normal-controls/result.json`](final-normal-controls/result.json) |
| Performance | [`performance/comparison.md`](performance/comparison.md) and three raw runs |

The final normal-control path moved reserve from 6 to 0, shelf from 0 to 6,
cleared carry, recycled the flat carton, and ended reconciled with no captured
console/page/request errors. It retained 12 screenshots and this full recording:
[`normal-controls video`](final-normal-controls/video-pass3/page@89f96b380a531110bed480981572786d.webm).

The card and cash recordings both begin with the customer picking one `balls3`
and one `glove1` unit (each shelf 10 to 9, customer-held 0 to 2). Duplicate scan
and premature-total guards work. Revenue and sold counts remain zero through
payment, receipt, and bagging, then handoff alone banks **$66**, moves exactly
two units to sold, and clears held stock. Both reconcile with zero captured
errors or non-aborted failed requests:
[`card video`](checkout/card/video-pass2/page@a3f729e4ee15ca8dc07ae538ef6a5d13.webm),
[`cash video`](checkout/cash/video-pass2/page@7f1cd0d6a3d844a781b2d62c8f02c5f4.webm).

The reorder recording starts with `balls2` physically out of stock, adds 12
units through the normal laptop controls, submits once, and changes cash from
$250,000 to $249,820: $168 goods plus $12 freight. It creates exactly one
12-unit in-transit lot with supplier and ETA and remains reconciled:
[`reorder video`](reorder/video/page@444c954fd9ef276d2149407468360b64.webm).

The actual autosave/reload proof preserves two box identities, order fields,
worktable surface slot 0 and transform, 55% tape progress, fully open flaps,
12 sealed units, six opened-box units, and a six-unit lot-allocated armful
byte-for-byte. Both sides reconcile and report no captured errors.

## Visual iteration record

Four complete visual passes each retained ten screenshots, a structured result,
and a ranked review of at least twelve visible weaknesses:

- [`iteration-2/visual-review.md`](iteration-2/visual-review.md): flap direction,
  hidden contents, rack cameras, carry hands, fallback order, van spacing.
- [`iteration-3/visual-review.md`](iteration-3/visual-review.md): content height,
  reserve transforms, focus theft, recycling placement, receiving congestion.
- [`iteration-4/visual-review.md`](iteration-4/visual-review.md): 3D focus,
  top-first compact fallback, stable slots, clearway, reserve density.
- [`iteration-5/visual-review.md`](iteration-5/visual-review.md): authored hand
  truck, saved-layout migration, rack/recycling clearance and feedback.

The focused final pass then exercised the revised route again on a migrated
persistent profile. This satisfies the required before/after, functional QA,
visual QA, console check, performance comparison, screenshots, and video loop.

## Performance result

Performance passes the explicit envelope in
[`performance/comparison.json`](performance/comparison.json). Against clean main,
the three-run candidate median improved stress average FPS from 145.73 to
181.39, 1% low from 56.24 to 118.81, and worst frame from 27.8 ms to 8.5 ms.
Draw calls rose 5.05%, rendered triangles 0.26%, textures 0.55%, and the largest
tracked resource increase was idle materials at 14.68%, within the 15% gate.

The complete nine-order submission/arrival/batched rebuild median was 60.6 ms
(65 ms maximum). One hundred serializations measured 3.528 ms average, 4.6 ms
p95, and 5.9 ms worst by median run. Forced-GC growth was 0.98 MiB median;
listener growth was zero. All three runs retained one customer-held unit,
reconciled, and were acceptance-ready.

## Diagnostics and residual non-blockers

- Every accepted result has zero captured console errors and page errors.
- Checkout/reorder browser transport logs contain only the project's existing
  aborted optional-GLB fallback probes; non-aborted failures are zero. The
  performance harness classifies the same known probes and rejects all others.
- Existing Canvas2D `willReadFrequently` and Chrome/D3D shader warnings remain;
  neither is introduced as an error or grows across repeated interactions.
- The existing shop/customer art style outside this feature remains intentionally
  unchanged. No laptop redesign, customer-AI redesign, checkout-state-machine
  redesign, save-architecture rewrite, economy expansion, or unrelated system
  was added.

No inventory discrepancy, duplication route, disappearing-product route,
runtime error, save/load mismatch, or acceptance-blocking visual defect remains
in the tested matrix.
