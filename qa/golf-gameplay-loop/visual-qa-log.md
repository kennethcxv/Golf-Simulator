# Golf gameplay visual QA log

Browser QA used system Chrome 150 at 1600 x 900 with repository-default quality. The repeatable fixture contains four scheduled parties (nine golfers), two walking groups, two riding groups, four arrival/check-in paths, a shared first-tee time, staggered later tee times, and an accelerated operating day. Cameras are fixed after entering the game and moving through normal controls.

## Iteration record

| Pass | Inspection focus | Revision made | Comparison result |
| --- | --- | --- | --- |
| Baseline | First tee, clubhouse lawn, current swing, ambient walker, and static cart | Captured the disconnected pre-change course and authored the source/system audit | Confirmed that check-in ended at the register and no authoritative live round was visible |
| 1 | Practice occupancy, starter staging, first live party, walking and riding silhouettes | Projected canonical parties into the course; added practice, starter, bags, clubs, carts, balls, and live UI | Named checked-in groups became visible and persistent, but staging, scale, and shot readability needed work |
| 2 | Safe facility cells, party spacing, practice-to-starter travel, cart placement | Made facility cells unique, routed the practice handoff, added overflow staging, and offset parked carts | Removed facility stacking and teleporting; retained four distinct groups through the handoff |
| 3 | First-tee call, score semantics, swing/ball feedback, player-camera label density | Added a real called-to-tee state, corrected pre-round/current-hole scoring, gated practice status, added a one-draw-call flight trail, and made party labels proximity-only | The tee shot became readable and the HUD stopped showing false scores or stale practice activity |
| 4 | Full-day pace pressure, remote simulation, asset cost, wayfinding scale | Bounded shot history and ball instances, selected only the newest accelerated shot per party, consolidated GLB submeshes by material, and reduced facility signage | Nine golfers and two carts remained coherent through congestion while active draw-call growth fell to 3.3% over baseline |
| Final | Normal-control entry, practice, starter call, live shot, walking, cart play, congestion, laptop operations, and front-desk exit | No further gameplay change required | Nine final screenshots, two recorded browser journeys, zero page errors, zero console errors, and zero non-aborted request failures |

The complete per-pass captures are retained in `iteration-1` through `iteration-4`. Final proof is in `final`.

## Visible defects found and resolved

1. Check-in had no course handoff. A checked-in reservation now creates one canonical, persisted round party.
2. Golfers were random ambient figures. Visible identities now come from the reservation and golfer records.
3. Practice had no physical or operational presence. Range, putting, and short-game zones now have capacity, occupancy, props, and player-facing signage.
4. Multiple groups could share a facility point. Route construction now allocates distinct, passable practice and staging cells.
5. Practice groups teleported into the starter line. Parties now traverse a real cached walk/cart route and expose a traveling-to-starter state.
6. The first tee had no starter. It now has an original stand, starter character, queue, announcements, safe release, and overflow staging.
7. The swing had no club or readable impact. A correctly pivoted club follows the articulated grip through address and swing poses.
8. Shots had no ball. A bounded ball pool now presents flight, bounce/roll progress, and a restrained trajectory trail.
9. Accelerated history could display many old shots at once. Presentation history is bounded and the renderer selects the newest shot per party.
10. Golfers walked directly or teleported between holes. Walking and cart travel now use cached passable course routes and explicit hole transitions.
11. The cart was static scenery. A persisted eight-cart fleet now assigns, transports, parks, returns, and reports condition and trips.
12. Riding golfers stood beside moving carts. Rider presentation now uses a seated pose and cart-relative placement.
13. Pre-round HUD rows showed misleading negative scores. Live score only uses completed holes plus strokes on the current hole.
14. Practice labels remained visible after groups reached the course. Activity detail is now phase-gated.
15. Hole and party labels dominated the first-person camera. Hole badges were reduced, party names became proximity-only, and facility signs were resized to course scale.
16. Parked carts and waiting golfers overlapped. Party/cart offsets and unique staging positions keep silhouettes readable.
17. The course laptop only exposed aggregate history. It now reports live groups, holes, phase, score, transport, waiting, congestion, marshal response, practice occupancy, and recent completions.
18. The cart laptop said carts were not simulated. It now shows the real fleet, assignment, availability, condition, and lifetime trips.

## Final visual evidence

| File | Proof |
| --- | --- |
| `final/01-practice-short-game.png` | Four parties occupy distinct practice positions with equipment, working carts, and live status |
| `final/02-starter-lineup.png` | Starter queue and overflow staging before release |
| `final/03-starter-call.png` | Avery Monroe called to the tee while three groups remain queued |
| `final/04-live-shot-and-ball.png` | Golfer, club, first-tee shot, and visible flight trail |
| `final/05-walking-group.png` | Walking party traveling together on the canonical course route |
| `final/06-riding-cart.png` | Assigned cart carrying its seated party |
| `final/07-pace-congestion.png` | Shared-hole pressure, wait/behind values, and watch-level response |
| `final/08-laptop-live-course.png` | Full live-operations course view and marshal feedback |
| `final/09-laptop-cart-fleet.png` | Eight-cart fleet with two assignments and six available carts |
| `final/video/*.webm` | Continuous normal-control final route |
| `final/front-desk/operating-day.webm` | Independent reservation/payment/check-in/walk-in/exit journey |

## Console and request review

- Page errors: 0.
- Console errors: 0.
- Non-aborted request failures: 0.
- Existing Canvas2D `willReadFrequently` and Three.js shader compiler warnings remain warnings only.
- Optional GLB requests aborted during scene churn are retained in evidence and excluded from hard failures; every non-aborted request completed.
