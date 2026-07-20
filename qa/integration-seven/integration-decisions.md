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

The integration keeps feature ownership below that presentation layer: inventory owns stock and checkout lots, reservations owns the tee desk, course maintenance owns equipment strokes, placement owns build transforms, and economy owns marketplace eligibility and property-sale commands. `P` is routed to the single pause overlay before modal gameplay handlers. Active tools and audio are cancelled for pause, scene/menu changes, laptop/front-desk entry, backgrounding and teardown; maintenance strokes finalize once before a transition. The indoor and outdoor tool belts are contextual views of one selector rather than competing maintenance menus. Tool-wheel regression coverage asserts all ten outdoor entries, normal checkout prompt priority at the shared counter, 100 pause cycles, 100 camera cycles, notification deduplication, audio suspension and zero listener growth.

## Save state

`src/sim/state.js` remains the root schema initializer/normalizer. Each domain exports deterministic normalization for its own subtree; root load runs them once and preserves unknown fields. Stable IDs and processed-event sets prevent duplicate objects, money, bookings or rewards after replay. A single migration plan will cover legacy main plus representative branch states.

## Dependencies and assets

No completed branch changes dependency metadata. Integration adds `playwright@1.61.1` as an exact development-only dependency because accepted, tracked browser QA tools import Playwright and a clean checkout otherwise cannot run the required gates. npm regenerated the lockfile; the runtime dependency graph remains unchanged. Authored Blender/GLB files from furniture, inventory and course maintenance are accepted only with their provenance/build sources and in-game verification; generated branch QA media is not a product dependency.

## Conflict policy

For every overlapping file, integration reads all selected patches and callers, combines compatible APIs, removes duplicate ownership, adds a focused regression, and reruns the owning feature. Whole-file “ours” or “theirs” resolutions are prohibited. `qa/integration-seven/overlap-map.json` is the complete pre-integration path inventory.

## Final cross-system resolutions

- **Placement + inventory rendering:** the shared clubhouse frame calls both delivery and placement updates, and teardown releases both domains' listeners, meshes, colliders and caches. Player-adjustable persistent objects use layout transforms; shipment pad/worktable/recycling/shelf slots remain inventory constraints.
- **Static authored geometry:** 15 loaded authored placement roots retain invisible selectable/collision proxies while compatible visible materials/geometries are combined into seven static batches. This removed a measured 24.4% of draw calls and 16.6% of rendered triangles in the comparable integrated view without changing transforms or selection.
- **Customers + reservations:** due reservation parties sort ahead of generic retail traffic. If a due party cannot fit, remaining capacity is held rather than consumed by a shopper. Moving/cancelling/resetting a reservation updates or retires only its matching physical arrival. Regression tests cover priority, capacity hold, move without duplication and reset cleanup.
- **Front desk + live simulation:** the once-per-second reservation refresh is signature-driven, but it is deferred while the card surface owns pointer capture. A real card swipe and concurrent reservation status changes therefore cannot replace the gesture DOM mid-swipe.
- **Economy + golf demand:** generated tee-sheet deposits and public rounds use the same price-demand signal. Reservations still own booking state; the journal alone owns cash/profit posting.
- **Schema collision:** independently claimed version-4 migrations were ordered rather than overwritten. State version 4 covers inventory, version 5 adds course maintenance, and version 6 adds journal/reputation/business normalization while retaining customer/reservation recovery and unknown-data passthrough.
- **UX + gameplay input:** pause wins before mode-local handlers; modal exits stop/finalize active tools exactly once; checkout retains prompt priority at the shared counter; tool wheel selection does not leak input; lifecycle closure does not steal look focus.
- **Cleaning regression:** the final player-experience stress route now proves a real wash-plane hit and persisted grime reduction under normal tool-wheel/LMB controls, in addition to audio/background teardown.
- **Portability:** browser tools accept environment URLs/output roots, and Blender rebuild instructions resolve `blender` through `PATH`. The only recorded personal path is the task-required QA evidence for the excluded active worktree.

## Final dependency and warning disposition

Playwright `1.61.1` is an exact development-only dependency needed by tracked QA tools. No runtime library was added or upgraded. The inherited Electron 33 audit group remains disclosed because the available fix is a major Electron 43 upgrade requiring separate validation. Canvas readback and GPU shader warnings plus optional GLB teardown aborts are documented; accepted routes have no console error, page exception, required-resource 404 or listener leak.
