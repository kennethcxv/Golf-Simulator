# Production golf gameplay loop report

## Outcome

`overnight/golf-gameplay-loop` now contains a deterministic, persisted, player-visible golf operating day from reservation handoff through practice, starter release, shot-by-shot play, walking or riding travel, pace response, completion, review, and safe recovery after save/load. It remains isolated in `Golf-Flipper-golf-gameplay-loop` and has not been merged.

The implementation preserves the accepted golf-operations transaction boundary. Reservation confirmation, exact-once payment, receipts, ledger posting, check-in, and course-access events remain authoritative; the new golf-day adapter consumes that access exactly once and owns live course play from there.

## Implemented loop

- One canonical golf-day model owns active parties, golfer identities, practice occupancy, starter state, route progress, shots, balls, carts, pace, scorecards, congestion, marshal responses, completion summaries, and presentation pools.
- Parties arrive early, select bounded practice space, travel over real passable cells to staging, queue at the starter, receive an announcement, wait for safe separation, and release to the first tee.
- Shot choice responds to distance, lie, skill, course condition, and shot count. The same deterministic shot record drives launch, flight, bounce/roll, stop, scoring, and presentation.
- Walkers and carts follow cached course-derived route networks, use explicit green/next-tee transitions, and preserve party order rather than teleporting between holes.
- The cart fleet has eight persisted records with assignment, condition, trips, position, return, and availability. Riding presentation includes seated golfers.
- Pace derives from actual elapsed practice, travel, shot, and safety-wait time. Shared holes and lagging groups create congestion and a visible marshal response.
- Hole-by-hole scorecards, pace, condition observations, completion, cart return, golfer memory, and one experience review are finalized exactly once.
- Active shots recover safely after load; parties, carts, review effects, and round-completion effects do not duplicate.
- Near/mid/far tiers keep every party authoritative while limiting camera-side presentation work. Balls, trails, and event history are bounded.

## Player-facing presentation

- Original Blender-authored golf bag, club, starter stand, range basket, and 42.7 mm ball use real-world dimensions, applied transforms, UVs, correct roots/pivots, simplified colliders, and the Pinehollow cream/green/sage/walnut/oak/charcoal/brass palette.
- The repeatable Blender build and inspection scripts produce both the source `.blend` and integrated `.glb`; no external asset was downloaded.
- Checked-in golfers appear by name with distinct clothing, clubs, bags, swing states, and group-relative placement.
- Practice areas, starter furniture/staff, staging, moving carts, seated riders, launched balls, and shot trails are visible from the player camera.
- A compact live-course HUD reports active groups, starter queue, carts, current score, phase, transport, waiting, and behind-pace status without dominating the first-person view.
- Laptop Course and Carts pages show live group operations, congestion, marshal feedback, recent completions, and the real cart fleet.

## Verification

- `npm test`: 551 passed, 0 failed.
- Golf-day tests cover exact-once handoff, practice capacity, starter safety, congestion/marshal work, accelerated completion, cart return, scorecards, persistent golfer updates, one review, save/load recovery, and bounded pools.
- Route tests cover deterministic caching, all live holes, real surface restrictions, unique facilities, and cache invalidation after course edits.
- Shot tests cover club/lie/skill behavior, hazard avoidance, deterministic planning, and complete trajectory presentation.
- Final browser route: 9 screenshots and WebM; 4 parties, 9 golfers, 2 carts; page errors 0, console errors 0, non-aborted request failures 0.
- Independent front-desk route: prepaid, card, cash/change, receipts, check-in, walk-in, finance reconciliation, normal exit; page errors 0 and listener growth 0.
- Four inspect/revise/compare passes plus the final route are documented in `visual-qa-log.md`.
- Performance decision run: 119.6 median active FPS; draw calls +3.3%, rendered triangles +5.0%, textures unchanged, heap -30.2%, and listener delta 0 versus the retained baseline.

## Source and licensing

- Gameplay kit source: `Assets/Blender/golf_gameplay_kit.blend`.
- Integrated model: `vendor/models/golf_gameplay_kit.glb`.
- Build/inspection scripts: `tools/blender/build_golf_gameplay.py` and `inspect_golf_gameplay.py`.
- License/source declaration embedded in the Blender scene: original Golf Flipper project asset; no external source.
- Raw Tripo and existing third-party assets were not overwritten or downloaded.

## Evidence index

- Baseline audit and before captures: `qa/golf-gameplay-loop/baseline-audit.md` and `baseline/`.
- Visual iteration log: `qa/golf-gameplay-loop/visual-qa-log.md`.
- Final screenshots/video/state: `qa/golf-gameplay-loop/final/`.
- Performance comparison and raw metrics: `qa/golf-gameplay-loop/performance-comparison.md` and `final/performance/`.
- Blender inspection preview: `qa/golf-gameplay-loop/assets/golf-gameplay-kit.png`.

## Known non-blocking diagnostics

Chrome reports the repository's existing Canvas2D `willReadFrequently` warnings and one Three.js shader compiler warning. Optional GLB requests can be aborted during scene churn; the QA gate treats only non-aborted failures as hard failures, and that count is zero. Host-contended performance reruns are retained separately and are not substituted for the controlled decision capture.
