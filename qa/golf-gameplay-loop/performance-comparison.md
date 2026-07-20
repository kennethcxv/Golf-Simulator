# Golf gameplay performance comparison

## Decision evidence

The production scaling decision uses the normal-control full-tee-sheet run at `performance/route-e-performance-accepted/`. It launched a fresh property, booked 12 parties through the physical laptop, checked them in through four physical desk sessions, kept all parties authoritative, walked the player from the starter to a previously far group, completed every round, forced exposed garbage collection only for measurement, and recorded four screenshots plus WebM.

The retained pre-change baseline at `baseline/performance/before-main.json` used the same 1600 x 900 system-Chrome environment and repository quality defaults. Its eight ambient golfers were renderer-owned scenery rather than full rounds, so geometry comparisons are contextual; the Route E frame-time and bounded-resource checks are the actual acceptance gate.

## Frame-time results

| Scenario | Average FPS | 1% low | p95 | p99 | >33 ms hitches | Worst |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline, 8 ambient figures | 120.0 | 117.42 | not recorded | not recorded | not recorded | 8.6 ms |
| 12 active canonical parties at starter | 118.0 | 59.28 | 8.5 ms | 16.6 ms | 0 | 18.2 ms |
| Player moved to prior FAR party | 120.0 | 115.47 | 8.5 ms | 8.6 ms | 0 | 8.7 ms |
| All 12 rounds settled | 120.0 | 111.52 | 8.4 ms | 8.6 ms | 0 | 10.3 ms |

The active starter scene contains 12 simultaneous authoritative groups, 6 walking and 6 riding, rather than eight decorative walkers. It sustains 118 average FPS with no frame over 33 ms. The moved and settled samples return to 120 FPS with 1% lows above 111 FPS.

## Tier transition proof

Before movement the renderer reported 4 NEAR and 8 FAR parties. `Load Test 02` was FAR at 270.0 yards. The player physically crossed the course with normal movement; afterward that same party was NEAR, while the scene reported 2 NEAR, 2 MID, and 8 FAR. Its party ID, hole 7 progress, route, scorecard, wait reasons, transport, and ball ownership remained intact.

Tier policy:

- NEAR: all party characters, full animation updates, visible pooled balls/trails, physical cart presentation.
- MID: one representative character per party, throttled animation, canonical route movement and sampled shots.
- FAR: authoritative event/round progress without scene objects or unnecessary ball/animation work.

Crossing a boundary reconstructs presentation from the same authoritative party rather than spawning a second simulation.

## Bounded resources and memory

| Metric | Result |
| --- | ---: |
| Peak active parties | 12 |
| Exact-once completed rounds | 12 |
| Exact-once experience reviews | 12 |
| Party-pool shells after completion | 12 |
| Ball-pool capacity | 24 |
| Peak active balls | 3 |
| Active balls after settlement | 0 |
| Event ring | 2,400 / 2,400 bounded entries |
| Baseline JS heap | 199.02 MiB |
| Active JS heap | 206.02 MiB |
| Settled JS heap | 206.91 MiB |
| Settled growth | 7.88 MiB |
| Fleet after settlement | 8 available, 0 assigned |

The parsed-GLB cache keeps one decoded prototype per model and clones object hierarchies while sharing geometry, material, and texture resources. Course parties also use bounded character, cart, bag, ball, trajectory, presentation-shot, and event pools. No monotonic heap, listener, cart, ball, party, texture, or event growth was observed.

## Acceptance checks

Every Route E gate is `true` in `evidence.json`:

- `twelveRoundsExactlyOnce`
- `twelveReviewsExactlyOnce`
- `targetBecameNear`
- `tierMixObserved`
- `resourcesBounded`
- `fleetReleased`
- `activePerformanceAcceptable`
- `heapSettled`

Diagnostics: 0 page errors, 0 console errors, 0 failed requests. The route recorded 375 normal inputs and took 179.5 seconds.
