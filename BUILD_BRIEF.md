# FAIRWAY STATE — BUILD BRIEF (v2, authoritative)

The working directive this project follows. Preserved verbatim in substance from the
project owner's brief of 2026-07-09, which superseded the earlier Unity direction.

## Runtime & architecture

- Vanilla JavaScript / HTML5 Canvas for the course design, turf simulation, membership,
  and progression systems — a top-down/2.5D management view (the proven format of this
  exact genre: GolfTopia and Under Par Golf Architect are both top-down).
- Three.js used specifically and only for the walkable pro shop interior — a first-person
  space (WASD + Pointer Lock, simple room collision). Do not extend Three.js/first-person
  movement to the course itself.
- Electron shell from early on, so save/load and later Steamworks integration don't
  require restructuring.
- Simulation logic (turf, economy, golfer satisfaction, inventory) in plain,
  headless-testable modules, decoupled from rendering.
- Git initialized immediately; commit after every meaningful chunk of working progress.

## Asset situation

No existing asset library. Build with procedural/placeholder visuals (colored zones,
simple shapes/geometric props); log anything needing a real art pass in KNOWN_ISSUES.md.
Never block on missing art.

## v1 scope

- One course (start with 9 holes, expandable to 18).
- Full terrain-editing tools in the top-down view, available at any time during play —
  renovation is an ongoing part of the game with real cost, real downtime (hole
  unplayable + reputation ding until finished), real payoff in course rating.
- Full turf simulation: per-zone health (green speed, fairway density, rough length);
  mowing (frequency/height/pattern), irrigation (coverage/schedule, drought vs.
  overwatering), fertilization, diagnosable disease (dollar spot + brown patch minimum)
  with plain-language causes; weather + seasons; condition measurably affects play
  quality; one status per zone by default, detail on demand. Unit tests on core
  transitions.
- Membership/hospitality: 3-4 tiers (pricing/privileges/guest policy), guest passes,
  corporate outings, reciprocal clubs, amenities (restaurant, practice facility,
  instruction), staff with skill progression, dynamic pricing vs. reputation/condition.
- Pro shop (the walkable Three.js scene): bounded first-person interior; inventory
  (clubs, balls, apparel, accessories, rentals) with supplier ordering, lead times,
  seasonal shifts; walk the floor to restock and arrange displays; customers reactive to
  actual shop state (stock, staffing, prices) — not an open-ended autonomous shopping AI;
  club fitting + rentals tied into the persistent golfer system; shop staffing; retail
  pricing distinct from green fees.
- Persistent golfers: named, recurring, remember course AND shop history; 100+ distinct
  thoughts each tied to a specific checkable condition; skill evolution; prestigious-member
  or leave-forever arcs with visible reputation consequences.
- Progression: underfunded fixer-upper start; research/unlock tree (turf equipment,
  amenities, membership tiers, shop inventory tiers, tournament rights); prestige rating
  gating golfer/event/sponsorship tiers; endgame major tournament.
- Relaxed/Realistic toggle — same systems and UI, different tolerances and pressure.
- Save/load, core sound design, tutorial arc woven into the opening hours.

## Verification

- Unit tests for all core sim logic, run after every significant change — primary
  verification for the top-down systems.
- Chrome DevTools MCP / Playwright MCP to actually launch and interact with everything
  visual (walk the shop, confirm collision/restocking/customers, check console errors).
- Nothing is "done" because it compiles — it must run and produce the described behavior.

## Working rules

- Fully autonomous; never stop to ask questions; log every judgment call in DEV_LOG.md.
- Build order: (1) shell + course view/editing → (2) turf sim → (3) membership/staffing →
  (4) walkable pro shop → (5) persistent golfers → (6) progression/prestige/toggle →
  (7) polish (sound, tutorial, UI). Advance only when the current phase runs and passes
  tests.
- Balance numbers are judgment calls, logged briefly; tuned post-playtesting regardless.
- Commit per phase referencing the phase.

## Deliverables

A build playable end-to-end (edit/maintain course, walk/stock the shop, persistent
golfer opinions across both, membership/staff management, club progression), DEV_LOG.md,
KNOWN_ISSUES.md (what needs real art), TESTING_CHECKLIST.md matching what was built.
