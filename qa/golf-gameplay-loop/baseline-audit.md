# Golf gameplay loop baseline audit

Captured 2026-07-19/20 on `overnight/golf-gameplay-loop` before gameplay implementation.

## Source control and validation

- Starting commit: `0c5137e5f0efac9627ce2309b9e66936f1eeb769` (`Register production Phase 8: the card swipe as a judged gesture (pure)`).
- `main` and the new branch both pointed to that commit at capture time.
- No Git remote is configured, so local `main` is the authoritative latest main.
- The original worktree was on `integration/all-verified-work-2026-07-18` with user-owned checkout changes. It was not switched, cleaned, reset, or edited.
- The requested branch was created in the isolated sibling worktree `Golf-Flipper-golf-gameplay-loop`.
- `git worktree list --porcelain` was inspected before branch creation. All listed worktrees remain untouched.
- Starting test gate: `npm test` passed 516/516 tests in 3.54 seconds.
- Dependency install reported one pre-existing high-severity audit finding. No dependency was upgraded as part of this audit.

## Browser capture protocol

- Launch path: repository static server (`node tools/serve.cjs`) and the real game in Chromium.
- Browser route: New Empire -> Buy -> normal `W` movement -> fixed evidence cameras -> normal `E` reservation check-in.
- Baseline browser: Chromium 149.0.7827.55, 1600x900, device scale factor 1.
- Performance browser: system Chrome 150.0.7871.127, 1600x900, device scale factor 1, repository quality defaults.
- Fixture: opening day at 9:20 AM, `lastRounds = 50`, one 10:00 AM walking-party reservation. State access fixes time, demand, and camera only; the visible check-in uses the normal player control.
- Fixed camera coordinates and raw state evidence are retained in [baseline.json](baseline/baseline.json).
- Full route recording: [baseline-route.webm](baseline/baseline-route.webm).

## Baseline evidence

| Evidence | What it proves |
| --- | --- |
| [First tee](baseline/01-first-tee.png) | Hole furniture exists, but there is no starter, staging line, on-deck position, tee-time display, safe-release state, party equipment, or cart parking logic. The floating hole badge dominates the player view. |
| [Clubhouse/practice lawn](baseline/02-clubhouse-practice-area-missing.png) | The grounds include a maintenance shed and equipment but no driving bays, range targets, practice green occupancy, chipping area, warm-up net, ball dispenser, bag staging, or starter stand. |
| [After check-in](baseline/03-after-check-in.png) | Normal `E` check-in collects the $32 fee and changes the reservation to `played`, then leaves no visible party or course handoff. |
| [Ambient golfer movement](baseline/04-current-golfer-movement.png) | Procedural figures can walk along a straight tee-to-pin interpolation, but their existence is derived from yesterday's aggregate round count, not checked-in parties. |
| [Current swing](baseline/05-current-swing-no-ball.png) | The current `Swing` mode has no club, address ball, impact point, launched ball, flight, landing, reaction, bag, or shot result. |
| [Static member cart](baseline/06-static-member-cart.png) | A golf-cart model exists as a non-operational ambient prop. It has no fleet record, assignment, seats, route, condition, return state, or golfer integration. |

## Authoritative system audit

| System | Current evidence | Status | Finding |
| --- | --- | --- | --- |
| Tee-time schedule | `src/sim/reservations.js`, `src/ui/laptop.js` | Incomplete | Main has one reservation per 30-minute slot and a booked/cancelled/played/no-show status. It has no party headcount, capacity, arrival classification, confirmation, payment lifecycle, starter queue, or actual tee release. |
| Production booking/check-in reference | unmerged `overnight/golf-operations` | Reusable interface | The accepted branch adds deterministic parties, arrivals, capacity, confirmation, exact-once payment, course-access events, walk-ins, cancellations, no-shows, finance reconciliation, and save migration. It deliberately stops at a synthetic course-departure event and does not simulate the round. This branch should be integrated, not rebuilt. |
| Check-in | `checkInReservation`, clubhouse register prompt, baseline state | Placeholder | A single `E` changes `booked -> played` and posts green-fee revenue. The baseline party NPC failed to reach the queue after more than an in-game hour, while the register prompt still allowed payment. No persistent round party is created. |
| Customer state | `src/render3d/clubhouse.js` | Disconnected | Clubhouse customers are renderer-owned transient objects. `isGolfer` only means the NPC took a counter route. The checked-in reservation name and the visible NPC identity do not match, and neither survives as a course party. |
| Golfer records | `src/sim/golfers.js` | Partial | Persistent golfer ID, name, handicap-like skill, persona, satisfaction, memory, membership, and aggregate history exist. Shot tendencies, active ball, animation/location/target, equipment, and recovery state do not. |
| Round simulation | `src/sim/rounds.js` | Aggregate only | One daily function chooses golfers, fabricates a nine-hole total score, computes one wait number from daily volume, changes satisfaction/skill, applies turf wear, and writes memories. It has no active party, hole/stroke sequence, time progression, location, exact shot, cart, safety, scorecard, completion event, or recovery. |
| Round state machine | search plus baseline `activeRounds: null` | Missing | No authoritative party state exists. Reservation `played`, renderer booleans, and daily aggregate math are unrelated facts. |
| Practice facilities | course layout and player-camera evidence | Missing | No practice zones, occupancy, selection, timing, balls, targets, animation, capacity, or recall-to-tee behavior exists. |
| Starter/first tee | course scene and player-camera evidence | Missing | Tee markers and a broken sign exist; starter NPC, stand, queue, safety hold, announcements, release, delay logging, and actual-start ownership do not. |
| Golf shots | `characterAsset.js`, `courseScene.js` | Placeholder | A 2.6-second procedural arm/torso motion is labeled `Swing`. It has no club, grip, address/waggle/impact/follow-through phases, lie/club/skill outcome, safety target, or shot event. |
| Ball flight | repository search and player-camera evidence | Missing | There is no course golf-ball entity or pool, trajectory, terrain collision, bounce, roll, stop, sound, remote simulation, or cleanup. Merchandise golf balls are unrelated. |
| Walking movement | `courseScene.js:updateGolfers` | Placeholder | Ambient figures interpolate on a straight tee-to-pin line, add random lateral offset, and randomly jump to another hole at the green. They ignore fairway waypoints, paths, greens etiquette, bunkers, water, party spacing, bags, shots, and next-hole topology. |
| Golf-cart movement | course scene and laptop Carts page | Missing | The laptop explicitly says carts are not simulated. The visible green cart is ambient. The drivable object in `courseScene.js` is the player's maintenance tractor, not a golfer cart. |
| Course route network | `startingCourse.js`, `course.js` | Missing | Starting-hole corridor waypoints are paint instructions only and are not retained on hole records. There is no canonical walking/cart node graph, tee approach, green parking, turn point, hole transition, clubhouse return, or cart-barn return. |
| Animations | `characterAsset.js` | Placeholder | Only `Walk`, `Idle`, `Swing`, and `Browse` exist. The swing has no club and the rig has no golf-specific hand alignment. Cart entry/exit, bag handling, putting, chipping, bunker play, reactions, scorecard, conversation, ball pickup, and round completion are absent. |
| Pace of play | aggregate `waitMin` in `rounds.js` | Missing | A single daily wait estimate is not pace simulation. There are no tee intervals, hole times, group-ahead distances, landing-zone occupancy, waiting reasons, congestion levels, alerts, problem holes, or unsafe-shot prevention. |
| Ranger/marshal | repository search | Missing | No task, alert, contextual action, employee role, patrol, intervention, or pace effect exists. |
| Scorecards | golfer memory and aggregate score | Missing | The game stores one total score/par in visit memory. It has no hole rows, per-hole par/strokes/penalties, running score, tee set, start/finish, pace, condition observations, returned card, or persisted round summary. |
| Round completion | aggregate daily tick | Missing | No final-hole state, clubhouse return, scorecard handoff, cart return, release, cleaning/charging, exact-once completion, or group despawn exists. |
| Reviews | `src/sim/reviews.js`, `src/data/thoughts.js` | Partial | Reviews correctly gate shop cleanliness, exterior, aggregate course condition, stock, prices, green fee, and checkout queue. They do not read a specific round's start delay, pace, practice, greens/bunkers/rough observations, cart experience, staff response, value, design, or completion record. |
| Experience rating | club/review aggregates | Missing | There is no per-round component score, problem-hole analysis, average pace/wait, congestion, cart demand, skill distribution, or exact-once feed to demand/reputation/value. |
| Save/load | `src/sim/state.js` | Partial | The JSON snapshot persists broad simulation objects and reservations. There is no active round state to persist or restore, no stable shot/hole checkpoint policy, and therefore no duplicate guard for parties, balls, carts, round completion, or reviews. |
| Performance scaling | ambient cap in `courseScene.js` | Incomplete | Course walkers cap at ten, but every visible character owns unique materials/geometries and updates every frame. There are no near/mid/far simulation tiers, pooled balls/carts/characters, route cache, remote round model, or tier transition contract. |
| Player-facing operations UI | laptop/club panels | Partial | Tee sheet, aggregate rounds, reviews, and an honest “carts are not simulated” message exist. There is no course-operations map for party states, pace, congestion, marshal tasks, scorecards, or carts. |
| QA routes | `tools/qa`, `tests` | Missing for live rounds | Existing tests cover aggregate scoring, reservations, reviews, save container, and course validity. None drives a walking round, cart round, congestion, active-round save/load, or full-tee-sheet tier transition. |

## Existing invariants to preserve

- Green-fee and checkout revenue must remain exact once and reconcile through the ledger.
- Reservation IDs, golfer IDs, RNG state, course/turf arrays, and legacy saves must remain loadable.
- Daily aggregate economics must not double-count a newly simulated round. The live loop must become the source of completed-round summaries, with a compatibility fallback only for unsimulated/parked properties.
- Existing course condition, maintenance wear, reviews, reputation, membership, shop, property valuation, and tutorial interfaces should receive adapters rather than parallel replacement systems.
- The player maintenance tractor must remain distinct from the golfer-cart fleet.

## Read-only branch/reference decision

- `overnight/golf-operations` is directly applicable and starts from the same `0c5137e` main commit. Its reservation/course-access API is the correct upstream boundary.
- `overnight/customer-simulation` is a separate accepted visitor implementation with a different, legacy reservation model. Wholesale combination would overwrite the stronger golf-operations lifecycle; only isolated customer presentation ideas are safe references.
- Course-maintenance and course-visual branches contain useful QA cameras and future route/visual work, but they are independent active worktrees and were not modified or copied wholesale.
- No third-party assets were downloaded. No asset license record changed during the audit.

## Visual defect list, ranked by player impact

1. Check-in visibly ends at the register instead of handing a party to the course.
2. No starter, queue, or safe first-tee release exists.
3. The swing has no club or ball, so it reads as an arm gesture rather than golf.
4. Ambient golfers are unrelated to named reservations and can appear anywhere.
5. Golfers walk straight through course corridors without shot destinations or group behavior.
6. Hole transitions are random teleports to unrelated holes.
7. The golf cart is static scenery and the laptop confirms no cart simulation.
8. The clubhouse grounds have no readable practice facility or pre-round staging.
9. No scorecard, shot feedback, pace status, or round completion is visible.
10. The oversized floating hole-number badge obscures the landing corridor at first-person scale.
11. Golfers have no bag, club, ball, or equipment silhouette.
12. Swing framing exposes severe pose ambiguity: hands are separated and no impact point is readable.
13. The first tee lacks party positions, on-deck space, starter furniture, and cart/bag parking.
14. Course life is sparse and incoherent: figures do not form groups or acknowledge one another.
15. Operational information is split between aggregate laptop numbers and unrelated ambient actors.

## Performance baseline and gate

The first video harness encountered a host SwiftShader collapse and retained its sub-1-FPS raw sample in `baseline.json`; it is not used for regression judgment.

The decision baseline is [before-main.json](baseline/performance/before-main.json), captured in system Chrome after an eight-second warm-up with three five-second samples per scenario. All six runs exceeded 600 or approximately 600 frames and passed the sample-validity gate.

| Metric (median) | Idle first tee | 8 ambient golfers |
| --- | ---: | ---: |
| Average FPS | 119.99 | 120.00 |
| 1% low FPS | 114.50 | 117.42 |
| Worst frame | 9.1 ms | 8.6 ms |
| Draw calls | 2,436 | 3,236 |
| Rendered triangles | 10,076,936 | 10,097,192 |
| Scene triangles | 1,777,411 | 1,781,371 |
| Materials | 219 | 269 |
| Textures | 163 | 163 |
| JS heap | 110,803,986 bytes | 114,807,872 bytes |
| Active listeners | 92 | 92 |
| UI mutation callbacks | 120.2/second | 120.2/second |

The texture estimate is retained as `6,169,904,533` bytes using `width x height x RGBA8 x mip factor`; it is an estimator, not a direct GPU-memory reading.

Proposed completion tolerances for the identical final harness:

- Median average FPS: no more than 10% lower.
- Median 1% low FPS: no more than 15% lower.
- Median worst-frame time: no more than 15% higher without an explained one-time transition sample.
- Near full-party draw calls, rendered triangles, materials, and heap: no more than 15% above the matching instance-count scenario unless the added fidelity is measured and justified.
- Active listeners and listener registrations: zero growth after repeated route/UI interactions.
- Heap, ball pool, cart pool, character pool, and UI mutation frequency: bounded with no monotonic growth.

## Console and network baseline

- Page errors: 0.
- Console errors: 0.
- Repeated pre-existing Canvas2D `willReadFrequently` warnings were captured.
- One Three.js shader compiler warning was captured in the performance run.
- Several optional GLB requests were aborted during scene churn. They are retained in raw evidence and must not increase in the final route.

## Implementation order derived from the audit

1. Integrate the accepted golf-operations lifecycle and replace its synthetic auto-departure with a starter/round adapter.
2. Add one deterministic persisted golf-day state: parties, golfers, carts, balls, scorecards, starter queue, congestion, marshal tasks, summaries, pools, and exact-once ledgers.
3. Build route data from actual holes and course zones, then implement practice/starter/shot/movement/pace/completion transitions headlessly.
4. Replace ambient random walkers with visible projections of authoritative parties, using near/mid/far simulation tiers.
5. Add operational laptop/course-map views and experience-based reviews.
6. Run the required walking, cart, congestion, save/load, and performance routes plus four complete visual-QA iterations.
