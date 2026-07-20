# Canonical integration decisions

This document records architectural ownership before conflict resolution. Exact integration commit IDs and final file-level resolutions will be appended after each validated checkpoint.

## Placement

`src/sim/layout.js` plus the furniture branch's build-mode/placeable catalog is the single placement authority. It owns placement IDs, transform normalization, floor/wall/counter/shelf surfaces, validation, storage and sale state. Inventory cartons and stock use its primitives only where a player-adjustable persistent transform is appropriate; delivery spawn/recycling and shelf fixture slots remain inventory-domain constraints. There will be no second placement manager.

## Inventory

`src/sim/inventoryLifecycle.js` is the quantity authority. The conserved stages are ordered, in transit, delivered/unopened, opened/reserve, shelf, customer-held, sold, and disposed. Existing legacy shop counters remain derived compatibility views during migration and may not mutate independently. Order debit and sale completion use stable exact-once event IDs.

## Customers and golf operations

`src/sim/reservations.js` owns tee-time schedule, reservation/check-in/payment state, capacity, cancellations and no-shows. `src/sim/customerSimulation.js` owns physical people, navigation, browsing, product holds, queues, lounge behavior and departure. The two communicate through stable IDs/events. Customer AI may not create a second booking record or post booking money directly.

## Economy

`src/sim/economy.js` is the authoritative immutable, exact-once journal and the only owner of cash/profit posting. `src/sim/business.js` derives daily explanations and progression-facing summaries from that journal; it does not own a second ledger. Domain systems emit one stable event per economic fact and may not directly add cash while also posting a journal item. The legacy `ledger.today` cash lines are a centralized compatibility projection maintained by the journal and tested against replay/save-load.

Checkout posts revenue and cost of goods only after the canonical inventory lifecycle atomically moves customer-held units to sold. Reservations owns booking payments, refunds, cancellation/no-show fees, check-in outcomes and course-access outcomes, then adapts each to one journal ID. Inventory owns order expense IDs. Progression and property sale use their own stable command IDs and recovery records. Generated tee-sheet occupancy consumes the same quality/price demand curve as public rounds, preventing online booking deposits from bypassing price resistance.

## Course maintenance

`src/sim/turf.js` and the root turf arrays remain authoritative course-wide. `src/sim/courseMaintenance.js` owns the one-yard hero-hole detail grid, masks, treatment history, work orders, localized disease state and maintenance score, and synchronizes detail actions back to coarse turf. Outside the hero bounds, existing coarse mowing, irrigation, divot and bunker behavior remains active. Course rendering consumes both layers; economy consumes summarized condition outputs. There is no second course-wide turf ledger.

## UX, input, notifications and audio

The player-experience branch owns one menu/pause system, one notification queue, one tutorial state path, one settings persistence path, one tool-wheel presentation and one lifecycle-safe audio service. Gameplay modes retain their actions, while `src/main.js` arbitrates mode transitions and restores controller focus/FOV/pointer ownership on exit. Feature branches call the canonical notification API rather than mounting parallel queues.

## Save state

`src/sim/state.js` remains the root schema initializer/normalizer. Each domain exports deterministic normalization for its own subtree; root load runs them once and preserves unknown fields. Stable IDs and processed-event sets prevent duplicate objects, money, bookings or rewards after replay. A single migration plan will cover legacy main plus representative branch states.

## Dependencies and assets

No completed branch changes dependency metadata, so integration retains main's dependency graph and regenerates nothing unless final clean install detects drift. Authored Blender/GLB files from furniture, inventory and course maintenance are accepted only with their provenance/build sources and in-game verification; generated branch QA media is not a product dependency.

## Conflict policy

For every overlapping file, integration reads all selected patches and callers, combines compatible APIs, removes duplicate ownership, adds a focused regression, and reruns the owning feature. Whole-file “ours” or “theirs” resolutions are prohibited. `qa/integration-seven/overlap-map.json` is the complete pre-integration path inventory.
