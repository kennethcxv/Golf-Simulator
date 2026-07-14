# AUTONOMOUS BACKLOG — Production Overhaul

Working queue for the autonomous overhaul session opened 2026-07-14.
Priorities are law: **P0 before P1 before P2 before P3.** No P2/P3 expansion while a P0 defect stands.

Status vocabulary: `todo` · `doing` · `done` · `blocked` · `deferred`
Every `done` row must name the commit **and** the verification that was actually run —
not "implemented in code".

Baseline at session open: **267 tests green**, frame median 8.3 ms / worst 8.7 ms,
70 shader programs, 1383 geometries, 152 textures, zero console errors on cold boot.

---

## P0 — Stability and blocking defects

### P0-1 · Course-map input drift
- **Impact** Opening the map sends the camera sliding right, forever. Reported as the #1 defect.
- **Effort** S · **Deps** none
- **Repro (before/D1)** Two independent mechanisms, both measured live:
  - **A** A movement key physically down when the map opens keeps driving the overview camera:
    camera target x **−9.49 → +135.09 in 0.9 s** (+144.6 yd).
  - **B** `held.delete(e.key)` in `main.js` is **case-sensitive**, while the tracked list is
    lowercase-only. Chrome reports `KeyboardEvent.key` against the live modifier state, so
    releasing **D while Shift (run) is held** delivers `keyup{key:'D'}` — which never deletes
    `'d'`. The key is stranded in the set permanently. Result: **+237.9 yd of rightward drift in
    1.5 s with hands completely off the keyboard**, and it never stops.
    (`walkHeld` two files over already lowercases — the overview set was simply missed.)
- **Fix** Shared `heldKeys` input module: lowercase-normalised, repeat-safe, cleared on every mode
  transition / blur / pointer-lock change, and requiring *fresh* input after a transition.
- **Verify** Unit tests for the stranding + fresh-input rule; live: open/close the map 30× and
  measure zero drift.
- **Status** **done** · commit `46512cb` · 8 unit tests; live 30/30 cycles seeded with both poison
  sequences → **worst idle drift 0.0000 yd**, deliberate pan still 79.4 yd. Tests 267 → 275.

### P0-2 · Player depenetration, stuck detection, and recovery
- **Impact** "The player can lose movement and be forced to restart." No recovery exists.
- **Effort** M · **Deps** none
- **Repro (before/D3)** `walk.unstick` **absent**, last-safe-position history **absent**, unstuck
  menu option **absent**. `walkTryMove` only rejects moves *into* colliders — it has no notion of
  already being inside one, so an overlapped player has every candidate move rejected. Player
  placed in the fixture cluster holding W for 1.2 s travels **0.227 yd** (unobstructed ≈ 5 yd).
- **Fix** AABB depenetration each frame (min-translation push-out), rolling last-safe-position
  ring buffer, stuck detector (pressing move + near-zero displacement + overlapping), escalating
  recovery (depenetrate → last safe → nearest nav-free point), pause-menu **Unstuck**.
- **Verify** Unit tests for depenetration vectors + escalation; live: force-overlap every fixture
  class and confirm automatic escape.
- **Status** **done** · commit `0baac43` · 21 unit tests. Live: **159/159 forced overlaps escaped**
  (worst 759 ms); normal walking 8.6 yd with **0 false rescues**; main entrance 4/4 passes both
  sides walking+running, 0 stuck. Pause-menu **Unstuck** added.
- **Also fixed here** Door occupancy — filmed the stockroom door closing across the player's path
  and found the auto-close consulted nobody. `doorMath.sweptBy()` now gates both the timer and the
  manual [E] close. Live: shopper parked in the doorway holds it open **5.2 s+** (was: swept
  through them at 2.5 s); an empty doorway still closes at **2.4 s**.

### P0-3 · Laptop readability and mouse interaction
- **Impact** Screen unreadable; no cursor; the laptop is the game's entire management surface.
- **Effort** M · **Deps** none
- **Repro (before/D2)** Seated at the laptop the physical screen fills **9.7 % of the viewport**
  (39.6 % w × 24.7 % h) against the brief's **70–85 %** target — a 7× shortfall. `cursorVisible:
  false`: there is no cursor at all; the UI is driven by keys.
- **Fix** Seated focus camera framed on the screen quad (fit to 78 % height with bezel + a strip of
  keyboard showing), pointer-ray → screen-UV cursor mapping, hover/click/scroll, safe exit.
- **Verify** Unit tests for the UV mapping + fit maths; live: cursor lands on the element under it
  at 5 screen positions, click-through works, Esc always exits.
- **Status** **done** · commit `0f51120` · 7 unit tests. Live at 1600×900: screen 507×309 px →
  **1179×692 px**, coverage 9.7 % area → **53.7 %** (73.7 % w × 76.9 % h, inside the 70–85 % band on
  both linear axes). 5/5 cursor hit-tests exact; click navigates; wheel scrolls `.lt-content`;
  Esc always exits. The UI is a real DOM projected on the lid, so the cursor was always native —
  it was simply too far away to read.

### P0-4 · Boxes never disappear — *carried over, verified*
- **Status** done (previous pass, commit `00e240a`) · re-verified this session: drop/pickup/save/load
  round-trip holds coordinates exactly.

### P0-5 · Performance hitches — *carried over, verified*
- **Status** done (previous pass, commit `e3d9298`) · re-measured this session: median **8.3 ms**,
  p99 8.6 ms, worst **8.7 ms** over 180 frames. No spikes.

### P0-6 · Customer hard-locks — *carried over, verified*
- **Status** done (previous pass, commit `b89dfa7`) · grid A* + repath + stuck recovery.

### P0-7 · Save corruption / inventory duplication
- **Impact** Silent economy corruption.
- **Effort** S · **Deps** none
- **Fix** Audit every path that mutates inventory (box take, stock, checkout, refund) for
  double-credit; property-test a long random action sequence for unit conservation.
- **Verify** Conservation test: units in boxes + on shelves + sold == units ordered.
- **Status** **done** · commit `7cd5afe` · Found a real leak: `pickFromShelf` removes a unit the
  instant a shopper lifts it, and **three** removal paths plus scene-dispose deleted shoppers
  without returning their cart. 500-step randomised conservation property test + live proof:
  12 units in 6 shoppers, all forced off the floor → **0 lost**.

---

## P1 — Core physical loop

### P1-1 · Pressure-washing system (exterior)
- **Impact** The brief forbids exterior grime clearing by E/vacuum/cloth — it must be a washer.
  Current build clears siding with a generic E verb. Direct violation.
- **Effort** L · **Deps** P0-2
- **Fix** Grime *mask* per surface (not a boolean), soap → dwell → wash for heavy stains, water jet
  + mist + wet-darkening, mask erosion at the real stream contact point, persistence, tool tiers.
- **Verify** Unit tests for mask erosion, soap dwell, heavy-stain gating; live: wash a wall and see
  the clean material revealed under the stream.
- **Status** **done** · commit `f547d32` · 8 unit tests. Live: stream held on one spot scrubbed
  **4 of 432 cells to zero with 376 untouched** — it cleans where the water lands and nowhere else.
  Water alone on the foundation stalled at **0.726 → 0.42 (= HEAVY_FLOOR)** with the game saying
  why; soap → dwell → jet took the same cells to **0.0**. The forbidden `[E]` scrub is deleted.

### P1-2 · Fixture placement / build mode
- **Impact** "The player needs freedom to place and move fixtures." Whole missing system.
- **Effort** XL · **Deps** P0-2 (nav rebuild), P0-1
- **Fix** In-world build mode: pick up / move / rotate / place / store / sell / repair, ghost preview,
  validity rules (doors, checkout access, customer routes, overlaps), nav rebake on commit,
  category assignment per fixture, full save persistence.
- **Verify** Unit tests for every validity rule + save round-trip; live: rebuild the store layout
  and confirm customers still route and check out.
- **Status** **done** · commit `050b7b5` · 12 rule tests. `sim/layout.js` = player overrides on the
  designed plan + `routesIntact()` floodfill. Live: refused at the door ("That is inside a wall")
  and over another unit ("That overlaps the Apparel tables"); a legal move persisted; then
  **176 customer samples on the rearranged floor, 0 fixture penetrations**.

### P1-3 · Checkout staff-space + register workspace
- **Impact** "Insufficient room behind the checkout counter; difficulty entering the staff side."
- **Effort** S · **Deps** none
- **Status** **done** · commit `c85cc76` · Measured: the till corridor was **0.55 yd** and a person
  is **0.68 yd** — the player literally could not fit behind their own register. Counter moved
  north, back counter to the wall → **1.17 yd** working corridor, 6 tests hold it open. Live: the
  corridor scans clear across its width, the player walks 7.5 yd of it, and from `staffStand` the
  prompt reads "Ring up Drew H. — [E] scan Tee bag (50)".

### P1-4 · Box sizes by contents + visible contents + tactile stocking
- **Impact** One box size for everything; stocking is not tactile.
- **Effort** M · **Deps** none
- **Status** todo

### P1-5 · Cleaning/tool animation quality (hands, sway, particles, audio)
- **Effort** M · **Deps** P1-1
- **Status** todo

### P1-6 · Tutorial extended to the full loop (27 steps, per brief Phase 20)
- **Effort** M · **Deps** P1-1, P1-2, P1-4
- **Status** todo

---

## P2 — Progression and management

- **P2-1 Reviews driven by real experience factors** — **done** · commit `73eeb03` · 8 factors, each
  a predicate over live state; a factor that didn't happen to you isn't scored. Live: *"The prices
  were fair, but half the shelves were bare — I could not find what I came for."* Laptop Reviews
  page shows the factor bars as a to-do list.
- **P2-2 Analytics that explain themselves** — **done** · same commit · `explainVisitors()`:
  *"Visitors fell 40% to 18 — rain, a course condition of 46 and a reputation of 30."*
- **P2-3 Employees**: hire, hourly wage, roles that do real physical work. **todo**
- **P2-4 Expenses on a schedule**: rent, utilities, wages, maintenance, with warnings. **todo**
- **P2-5 Weather → attendance**, rain decisions (open/close/discount). **todo**
- **P2-6 Golf-cart condition and fleet progression.** **todo**
- **P2-7 Level/unlock gating for tools, fixtures, suppliers.** **todo**
- **P2-8 Inventory page**: shelf/backroom/incoming, reorder point, margin, velocity. **todo**

---

## P3 — Production polish

- **P3-1 Exterior detail pass** (windows, trim, roof, landscaping, signage) — partially done. **todo**
- **P3-2 Stockroom organisation** (ref panel 6: shelving, hand truck, clutter). **todo**
- **P3-3 Character models + animation blending.** **todo**
- **P3-4 Checkout props + first-person hands.** **todo**
- **P3-5 Audio pass.** **todo**
- **P3-6 Optimisation** (instancing, atlases, LODs). **todo**

---

## Blocked / needs external generation

Tracked in `ASSET_REQUESTS.md`. Meshy/Tripo generation spends the owner's credits and is **not**
authorised autonomously — every hero asset that truly needs generation is written up there instead,
and the in-engine procedural version ships in the meantime.
