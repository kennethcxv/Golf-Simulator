# Living golf course production report

## 1. Branch

`overnight/golf-gameplay-loop`, developed only in `C:\Users\Kenneth\Documents\GitHub\Golf-Flipper-golf-gameplay-loop`. It was not merged into `main`. The original worktree and every other active worktree were left untouched.

## 2. Starting commit

`0c5137e5f0efac9627ce2309b9e66936f1eeb769` (`Register production Phase 8: the card swipe as a judged gesture (pure)`). The branch/worktree audit and starting 516-test gate are retained in `baseline-audit.md`.

## 3. Final commit

The commit containing this report and the accepted QA bundles is the final handoff commit. Its immutable hash is reported by `git rev-parse HEAD` in the final user handoff, because a file cannot contain its own commit hash without changing that hash.

## 4. Commits

Milestones from the recorded starting commit:

- `dae3783` audit(golf): map current round and course-life systems
- `db29b34` Build deterministic golf operations core
- `d03773f` Build the player-facing tee desk
- `476a959` Roll golf bookings through production lifecycle
- `6588f9c` Build the golf operations booking office
- `15950a5` Harden projected laptop QA scrolling
- `538ed83` Pin golf operations QA to opening day
- `cef7ab1` Stop laptop status listener churn
- `694af72` Assert idle stability in golf operations QA
- `035f5da` Eliminate idle laptop status mutations
- `f3ec1cd` Wait for laptop interaction in idle QA
- `c4eea46` Scope laptop churn audit to application DOM
- `d34e5f4` Build deterministic live golf round simulation
- `617785e` Render canonical golfers and live course operations
- `eba1e85` Document and validate the production golf loop
- `d7bb2ab` feat(golf): complete living round operations
- `0c53e61` feat(render): present scalable course life and cart service
- `30e683f` test(qa): drive complete golf-day routes with normal controls

The final documentation/evidence commit follows those milestones and is the hash reported at handoff.

## 5. Round architecture

`golfDay` is the single persisted authority for checked-in parties, individual golfers, practice, starter order, shots, balls, travel, carts, pace, congestion, marshal tasks, scorecards, completion, experience, reviews, pools, and exact-once metrics. Parties move through explicit states covering preparation, routed practice, starter queue/call, tee, shot, ball flight, walking/riding, safe waits, green/putting, hole transition, return, card handoff, departure, review, despawn, and recovery.

Each party retains its persistent party/reservation IDs, scheduled and actual start, hole/phase, route, transport/cart, pace and delays, scorecard, observations, satisfaction inputs, and final experience. Each golfer retains persistent ID/name/skill/tendencies, ball and score ownership, animation, position/target, equipment, and recovery metadata. Seeded decisions and stable hashes keep routes, practice choice, and shots deterministic enough for repeatable QA and save/load.

## 6. Practice systems

Early arrivals choose range, putting, or chipping from arrival time, skill/persona, amenity availability, capacity, and tee proximity. Parties follow the real route to unique facility cells. The range has six bays, eight bounded buckets, warm-up, six-shot sessions, targets, pooled balls, and recall. Putting/chipping have finite sequences, ball pickup, practice pins, occupancy, and early starter release. Practice cannot run past the scheduled callback window.

Original Blender roots add the ball dispenser, range bay, warm-up net, range basket, practice pin, bag rack, bags, clubs, balls, and signage. No third-party asset was downloaded.

## 7. Starter system

The starter owns queue order, next-up/on-deck staging, tee-time display, announcements, actual start, scheduled interval, landing-area safety, and release. The second same-slot Route C party waits for separation and a clear first landing area. Announcements are rate-limited. An outdoor starter-desk interaction provides arrivals/check-in/walk-ins and now remains functional even while the optional gameplay-kit GLB is loading.

## 8. Shot model

Seeded shot planning selects driver, wood, iron, wedge, chip, bunker shot, or putt from remaining distance, lie, skill, tendencies, rough/bunker/green condition, wind, hole geometry, and safety. Candidate targets are sampled and rejected for buildings, map bounds, impossible terrain clearance, and occupied landing zones. Scores derive from completed shot outcomes and penalties; they are not fabricated as a disconnected end-of-day total.

Nearby characters present address, waggle/practice, driver/iron/chip/bunker/putt motion, impact, follow-through, watching, reaction, walking with bag, cart entry/exit, waiting, scorecard, pickup, conversation, celebration/frustration, and return. Club visibility and pivots follow the active pose.

## 9. Ball-flight model

The authoritative shot stores start, landing, stop, apex, flight/bounce/roll timing, lie, club, outcome, and collision facts. Presentation samples a restrained parametric arc, terrain-aware landing, bounce, roll, stop, shadow/trail, launch/landing audio, and reaction. Near shots receive enough normal-speed presentation time to be visible; MID shots are sampled and FAR shots remain abstract. A fixed 24-ball pool, bounded 32-shot presentation history, and one reusable trail prevent leaks.

## 10. Walking routes

Walking parties use the shared course-derived route network for clubhouse/practice/starter travel, tee approach, playable corridors, ball locations, safe green approach, next-hole transitions, turn, and clubhouse return. Route generation respects water, bunkers, buildings, maintenance exclusions, and inappropriate green crossings. Formation offsets keep golfers together while bags move with the lead golfer.

## 11. Cart routes

Riding parties request one of eight persisted carts. Assignment, loading, path travel, fairway access where allowed, tee/green parking, shot return, next-hole transition, barn return, unload, cleaning, charging, and availability all use the same authoritative route/party. Distant carts use route progress rather than vehicle physics; nearby carts are visible physical scene objects with seated/entry presentation.

After return, a cart is immediately unassigned and owns an observable cleaning/charging interval. A coarse tick cannot collapse both phases. The final service proof follows the same `cart-1` into persistent charging and then one unassigned available state.

## 12. Pace system

Pace records expected/elapsed round time, scheduled interval, actual delay, per-hole time/target, walking/cart travel, shot time, practice time, search time, safety waits, group-ahead/behind distance, wait reasons, maintenance/weather delays, and intervention credit. The starter and hole safety checks prevent shots into an occupied landing area or green. Pace boost is bounded and expires; it never teleports a group.

## 13. Congestion system

Congestion uses `clear`, `light`, `moderate`, `heavy`, and `gridlocked`, derived from real group spacing, waits, and behind-pace values. It is visible in the compact Course Live HUD and laptop Course page without permanently filling the center view. Route C creates two legitimate same-slot groups, 9 minutes of trailing-party waiting, a gridlocked slow lead party, and no unsafe-shot event.

## 14. Marshal system

Early game creates player alerts with investigate/contextual pace-reminder actions. Player dispatch changes alert -> en route -> complete after plausible travel and grants limited intervention credit. Hired marshals can be assigned as patrol staff through the existing staff system and likewise travel before affecting pace. Completed tasks disappear; alerts for parties that depart are closed so no orphan work remains.

## 15. Scorecards

Every party owns nine persisted rows with hole, par, tee set, strokes and penalties per golfer, completion, start/finish/duration, pace target, and condition snapshot. Running/current-hole score is distinct from completed-hole score. Cards return after the round, remain in completion summaries, appear in the laptop, update persistent golfer history, and feed difficulty/problem-hole analysis. Generated scores are bounded to possible hole outcomes.

## 16. Round completion

After hole nine, walkers route to the clubhouse; riders follow the barn return path, exit, unload, and release the cart. Both return scorecards, record finish/duration/pace/waits/conditions/cart/value/service, update persistent golfers, post one completion, create one review, mark course departure, leave, and return their party shell to the pool. Exact-once guards prevent permanent hole-nine groups or repeated completion effects.

## 17. Review integration

Completed-round experience combines arrival, check-in, punctuality, pace, course quality/design, cart, practice, value, and service. Review templates cite only supported facts such as actual waiting, late start, green/bunker/rough condition, cart state, scenery/design, check-in, or value. Each review carries its round and golfer IDs and posts once through the existing review/reputation interface. Aggregates feed reputation, demand, pricing feedback, valuation, and upgrade recommendations without double-applying complaints.

## 18. Save policy

The complete policy is in `save-load/policy.md`. Active parties, golfers, hole/state, scorecard, route, cart, practice/starter, delays, satisfaction, congestion, marshal tasks, pools, and exact-once ledgers serialize normally. Stable travel/wait states resume. An in-flight shot restores to the same golfer's address checkpoint, releases its transient ball, and records one recovery event rather than serializing a half-animation. Loaded games remain paused until player input.

Route D saved and loaded practice, first-tee flight, mid-hole, riding transition, and final-hole states through the normal pause/slot UI. It preserved seed/IDs/hole/transport/cart/completed score and finished with one round, one review, one recovery, and no duplicate balls or effects.

## 19. Performance tiers

NEAR owns full characters/animations, visible balls, frequent updates, and physical cart presentation. MID renders one representative character per party with throttled animation and sampled movement/flight. FAR retains authoritative coarse round/route progress without scene objects. Tier crossing reconstructs presentation from the same party record.

Route E proves 12 simultaneous parties (6 walk, 6 ride), 4 NEAR/8 FAR at the starter, then 2 NEAR/2 MID/8 FAR after the player physically moved to a prior FAR party. Active performance was 118 FPS average, 59.28 FPS 1% low, no >33 ms hitch; moved performance was 120/115.47 with no hitch. All 12 rounds/reviews completed exactly once; heap growth settled at 7.88 MiB, event ring at 2,400, party pool at 12, ball capacity at 24/0 active, and all eight carts available.

Parsed GLBs are cached once and cloned with shared decoded geometry/material/texture resources. Character, bag, cart, ball, trail, event, and party resources are bounded.

## 20. Tests

- Final full suite: 564 passed, 0 failed, 0 skipped, 30.35 seconds.
- Focused round/service gate: 15 passed, including coarse service ticks, exact-once full load, save checkpoints, stale marshal alerts, and tier integrity.
- JavaScript syntax gate: all 14 changed entry points passed `node --check`.
- `git diff --check`: passed.
- Blender 5.1.2 imported the shipped GLB and validated all 13 roots, dimensions, UV/material presence, transforms, and required simplified colliders. CartServiceBay is 4.75 x 3.35 x 2.72 m, 1,844 triangles, 7 materials.
- Accepted final browser routes: 0 page errors and 0 console errors. Final congestion, save/load, performance, and service runs also have 0 failed requests.

## 21. QA paths

- Audit/before evidence: `qa/golf-gameplay-loop/baseline-audit.md` and `baseline/`
- Four visual iterations and defect/fix comparison: `visual-qa-log.md`
- Iteration 1 walking baseline: `development/normal-route-a-2/`
- Route A / iteration 2: `visual-iterations/iteration-02-route-a/`
- Route B / iteration 3: `visual-iterations/iteration-03-route-b-accepted/`
- Final cart service correction: `routes/route-b-service-accepted-3/`
- Route C / iteration 4: `visual-iterations/iteration-04-final/`
- Route D: `routes/route-d-recovery-cache/`
- Route E: `performance/route-e-performance-accepted/`
- Save policy: `save-load/policy.md`
- Performance comparison: `performance-comparison.md`
- Blender preview: `assets/golf-gameplay-kit.png`

Each accepted directory contains `evidence.json`, fixed screenshots, and a recorded WebM. Rejected development attempts are not part of this acceptance index.

## 22. Known limitations

- Characters are intentionally stylized procedural figures; finger-level grip IK, cloth, and high-fidelity facial animation are outside this scoped production pass.
- Early player marshal response is a contextual operations action, not a visible on-course marshal conversation. Hired patrol behavior is simulated and tested.
- Practice/starter staging is functional and readable but uses restrained furniture/detail rather than a dense resort-scale scene.
- A player who deliberately walks into a dense starter queue can briefly have the camera occluded by nearby bodies; it does not alter party state or navigation.
- Ball flight is deterministic sampled motion rather than full rigid-body aerodynamics, especially at MID/FAR tiers.
- The live service badge is a screen-facing status marker above the cart; the service bay itself is authored 3D geometry.
- Chrome may emit non-fatal Canvas2D `willReadFrequently` and shader compiler warnings. Accepted final routes contain no console errors; warning text is retained in raw evidence.
