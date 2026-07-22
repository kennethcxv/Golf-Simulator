# Checkout, Delivery, and Groundskeeping Baseline

Captured July 19, 2026 on `overnight/checkout-delivery-groundskeeping-balance`,
branched from clean local `main` at `0c5137e5f0efac9627ce2309b9e66936f1eeb769`.

This is the pre-implementation checkpoint for the checkout-delivery-groundskeeping
balance pass. The ignored `qa/checkout-delivery-groundskeeping-balance/baseline/`
folder contains the full-resolution captures and raw performance samples.

## Reference audit

- Inspected the authored reference boards under `Designs/`, including the warm
  cream, golf green, walnut, oak, charcoal, and restrained-brass checkout and
  clubhouse direction.
- Inspected the existing register, basket, open bag, and closed bag GLBs under
  `vendor/models/clubhouse/`.
- Inspected the current red tractor, fallback tractor, broken tractor, and mower
  deck with `tools/blender/audit_tractor_reference.py`.
- The current red tractor is one rigid 59,533-triangle mesh with one material.
  It has no separately animated wheels, steering, seat, hood, hitch, or controls.
- The unused fallback tractor is 1,628 triangles across 43 meshes and supplies
  useful proportion and part-separation reference, but it is not production art.

## Checkout baseline

- Cash was exercised through normal first-person controls from customer arrival
  through counted change at 1600x900.
- The customer abandoned after the fixed 45-second patience timer while the
  physical cash transaction was still active, so receipt and handoff could not
  be reached in the baseline run.
- The monitor is legible only at a glance: total, tender, change due, selected
  amount, and remaining amount do not have a stable hierarchy.
- Drawer and denomination targets sit at the lower edge of the camera frame.
- A customer holds one generic floating category cube while the checkout stages
  a second representation of the same SKU. There is no basket lifecycle.
- The final shopping bag is assembled from primitive boxes rather than the
  existing authored bag asset.
- Held inventory is already reserved in the authoritative ledger and checkout
  recovery returns it on load. That behavior must remain exact.

Baseline images: `baseline/register-cash/01` through `09` and
`baseline/customer-floating-product-1600x900.png`.

## Delivery baseline

- Placing, partially unpacking, saving, and reloading six orders preserved all
  seven boxes and exact quantities with no console errors.
- Supplier cards communicate only `ships in 2d/3d/4d`; the cart lacks a concrete
  ETA, and the Orders and Deliveries pages expose broad multi-day language.
- Delivery simulation already persists deterministic minute and day fields, but
  the catalog lead-time constants force ordinary play into a two-to-four-day
  wait. There is no paid express tier.

Baseline images: `baseline/delivery/laptop-orders.png`,
`laptop-deliveries.png`, and `laptop-supplier.png`.

## Tractor and maintenance baseline

- The repaired tractor is a glossy red closed-cab import with a visually
  detached mower deck. It reads unlike the game's established clubhouse art.
- Driving works through the normal `E` and movement controls, but the tractor is
  runtime-only: transform, condition, attachment, and parking state do not save.
- The Course Works panel is correctly limited to construction and surface tools.
- The Grounds panel exposes whole-zone automatic mowing, irrigation, and
  fertilizer policies on day one. Manual hose, rake, and mowing interactions
  exist, while divots and ball marks are represented only by generic aggregate
  wear. There are no persistent work orders, equipment reservations, or earned
  automation tiers.

Baseline images: `baseline/tractor-{front,rear,side,three-quarter,player-view}`,
`baseline/course-editor-design-mode-1600x900.png`, and
`baseline/grounds-automatic-policy-panel-1600x900.png`.

## Performance baseline

Protocol: Chrome 150, 1600x900, device scale 1, default quality, fixed save and
camera fixtures, 2.5-second warm-up, then a six-second sample. Raw frame deltas,
heap, renderer counters, listener counts, and UI mutation counts are in
`performance/baseline-*-raw.json`.

| Scenario | Avg FPS | 1% low | Worst frame | Scene tris | Heap | UI updates/s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Tractor idle | 81.12 | 21.14 | 58.4 ms | 1,944,084 | 487.9 MB | 163.17 |
| Tractor driving | 86.83 | 60.24 | 55.6 ms | 1,944,110 | 508.4 MB | 174.50 |
| Ten shoppers | 105.84 | 59.88 | 19.5 ms | 2,008,572 | 161.5 MB | 212.83 |
| Active checkout | 81.18 | 39.84 | 36.1 ms | 2,011,408 | 202.5 MB | 163.50 |

The acceptance tolerance for the same final scenarios is no more than a 5%
average-FPS regression, no more than a 10% 1%-low regression, no persistent
listener growth, and no unbounded growth from repeated checkout, basket, or
tractor cycles. The original tractor is not a useful asset budget; the replacement
target is no more than 35,000 visible LOD0 triangles with separate moving parts.

## Automated baseline

`npm test` passes all 516 tests before production changes.

## Ordered implementation boundaries

1. Preserve register state-machine, money, ledger, and recovery semantics while
   adding live-transform camera anchors, state-aware framing, readable amounts,
   and a transaction-safe customer wait.
2. Add one authoritative basket and bag lifecycle around the existing SKU
   reservation ledger; visuals may follow state but never own inventory.
3. Replace day-scale supplier pacing with deterministic balanced ETAs and a paid
   express option without weakening physical boxes or save recovery.
4. Build an original palette-matched tractor through a repeatable Blender script,
   integrate separated moving parts and saveable ownership/condition/location,
   then retain manual mowing as a meaningful early-game job.
5. Replace immediate day-one whole-zone automation with persistent work orders,
   manual service loops, equipment reservation, staff progression, and explicitly
   earned automation while keeping Course Works construction-only.

