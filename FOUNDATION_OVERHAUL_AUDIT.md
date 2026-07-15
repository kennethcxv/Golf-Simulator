# FOUNDATION OVERHAUL — P0 AUDIT

The brief lists collision, placement, navigation and inventory as P0 and asks for a
recorded baseline before any change. This is that baseline. It is written after a full
read of the live systems, not a guess — and the honest headline is that **most of the P0
foundation already exists and is tested.** The defects that remain are specific holes in
otherwise-real systems, not missing systems. This audit names the holes, and this session
closes the two that are most player-visible and lowest-risk.

Evidence for this pass lives in `qa/foundation-overhaul/{before,after}/` (gitignored).

---

## What already exists (so we do not rebuild it)

| System | Where | State |
|---|---|---|
| Fixture placement validation | `src/sim/layout.js` `validatePlacement` | **Real & tested** — rejects overlap, wall penetration, both doorways, till workspace, and runs a full flood-fill walkability check (`routesIntact`). `tests/build-mode.test.js`. |
| Build mode w/ green/red ghost | `src/render3d/clubhouse/buildMode.js` | **Real & tested** — `B` to enter, live ghost sized from `FIXTURE_HALF`, grid-snap, colour driven by `validatePlacement`, `R` rotate, `X` store. |
| Player depenetration + unstuck | `src/core/unstick.js`, wired `courseScene.js:1404-1461` | **Real & tested** — per-frame push-out, safe-trail, stuck monitor (700ms→lastSafe, 1800ms→nearestFree), manual pause-menu Unstuck. `tests/stuck-recovery.test.js`. |
| Customer pathfinding | `src/render3d/clubhouse/nav.js` | **Real & tested** — grid-baked A\* with string-pulled waypoints, rebakes on collider change. `tests/customer-nav.test.js`. |
| Door "never close through an actor" | `src/data/doorMath.js` `sweptBy` | **Real & tested** — swept-arc predicate. `tests/door-occupancy.test.js`. |
| Physical box loop | `src/sim/deliveries.js` | **Real & tested** — tape→flaps→contents→empty→flatten→recycle, no auto-flatten (gated on `isEmpty`), save-migrated. |

The brief's complaints (2)–(6), (9), (15) therefore reduce to **coverage gaps** in these
systems, catalogued next.

---

## P0 defects — confirmed, prioritised

### D1 — Delivery boxes occupy no space *(FIXING THIS SESSION)*
**Complaint:** #3 boxes intersect walls; #15 customers push into / clip through boxes.
**Reproduction:** `qa/foundation-overhaul/before/01-box-clips-wall.png` (a case dropped
into the north ball wall) and `02-box-in-doorway-customer-walks-through.png` (a carton on
the welcome mat in the open doorway; a customer walks straight through it).
**Root cause — two independent holes:**
1. `src/sim/deliveries.js:194-209` `putDownBox()` writes `{x,z,ry}` with **zero validation**;
   `src/render3d/clubhouse.js:2103-2114` `boxDropSpot()` only guards the coarse `isInside`
   envelope (ignores partitions, fixtures, doorways, other boxes).
2. `src/render3d/clubhouse.js:1967-2021` `rebuildBoxes()` builds a mesh but **never calls
   `addCol`**, so a set-down box is a pure visual. It blocks neither the player (its collider
   is absent from `propColliders`) nor customers (the nav grid bakes from that same list —
   `clubhouse.js:2527`). `data/boxes.js:107` even ships a `boxRadius()` "used by the collider"
   that nothing calls.
**Planned fix:** a pure `legalBoxDrop(state, box, x, z, ry)` in `sim/layout.js` reusing the
existing wall/partition/fixture/doorway machinery (reject + snap to nearest legal spot);
`boxDropSpot()` routes the player's drop through it; `rebuildBoxes()` registers a box
collider (footprint from `boxDims`) and bumps the collider version so the nav grid re-bakes.
**Verification:** new `tests/box-placement.test.js` (pure); after-evidence screenshot of the
box snapped to a legal spot; live check that `propColliders` gains a box collider.

### D2 — A door can close through the player *(FIXING THIS SESSION)*
**Complaint:** #9 player becomes stuck in a door.
**Root cause:** `src/render3d/clubhouse/doors.js:305-317` `doorBlockedBy()` gates the auto-close
and manual close against **customers and boxes only** — the player is deliberately excluded
(the sole backstop is a bespoke radial push at `doors.js:373-391` that only runs while the
slab is actively animating and does not consult `unstick.js`'s real depenetration).
**Planned fix:** include the player's body in `doorBlockedBy()` via the existing `sweptBy`
predicate, so a door holds open while the player stands in its swing.
**Verification:** extend `tests/door-occupancy.test.js`; after-evidence of the door held open
with the player in the threshold.

### D3 — Doors are invisible to the customer pathfinder *(deferred, next P0)*
`clubhouse.js:2527` bakes the nav grid from `custCols.filter(c => !c.door)` and
`doors.js:224` marks door colliders `door:true`, so A\* treats every doorway as permanently
open. A stalled customer at a shut door is only rescued by a velocity-gated auto-open that
does not re-fire once movement is zero — the mechanical source of "customers stuck at doors."
Bigger and riskier than D1/D2; the box-collider work (D1) is a prerequisite piece of the same
nav-bake plumbing, so this lands next.

### D4 — Player / other customers are not in the nav plan *(deferred)*
Only `addCol` geometry is baked; the player and other shoppers are handled by a reactive
same-frame clamp (`resolveCustomer`, `clubhouse.js:2483-2516`). Planned paths aim through
them; a determined block takes ~3s of visible shoving before the random sidestep frees it.

### D5 — Decor / permanent dressing placement is unvalidated *(deferred, latent)*
`placeDecor` (`sim/shop.js:281-293`) checks inventory + spot-occupancy only, no geometry;
wall art is hand-tuned `{x,z,ry}` with no wall/window/partition check (DEV_LOG D5: the course
photo once overlapped a window). The default layout is currently hand-clean, so this is latent,
not active — but nothing prevents recurrence if `WINDOWS`/`PARTITIONS` are retuned.

### D6 — Two disagreeing walkability models & render-collider drift *(deferred, correctness)*
`sim/layout.js solidAt` (0.25 cell, R=0.34, fixtures+partitions only) vs runtime
`nav.js`/`propColliders` (0.3 cell, R=0.32, +doors/clutter/decor). And render colliders in
`fixtures.js` are hand-typed literals that already drift from `FIXTURE_HALF` (rack 3.0×0.9 vs
3.0×1.0; short backshelf 0.9×1.7 vs 0.9×2.0). One source of truth is the eventual fix.

### Not-defects (verified, so we don't "fix" what works)
- **Box auto-flatten** — does **not** happen; flatten is gated on `isEmpty` in both sim and
  render. The "closes too early" feel is only that a full armful empties a *small* carton in
  one `[E]`. Tunable, not broken.
- **Inventory** — there is no general inventory (only the single `carry` stack). That's a P1
  build (Phase 7), not a P0 integrity defect; deferred to its phase.

---

## This session's scope
D1 (boxes occupy real space) and D2 (doors respect the player) — two named top defects, both
extensions of tested systems, both verifiable headlessly and on-camera. Everything else is
recorded above as the honest, prioritised P0 backlog.
