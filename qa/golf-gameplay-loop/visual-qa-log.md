# Golf gameplay visual QA log

All accepted iterations launched the repository game normally in system Chrome at 1600 x 900. Booking, movement, interaction, speed changes, save/load, and laptop actions came from keyboard or pointer input. `window.__fw` was read only for assertions and metrics; no accepted run wrote game state, clock, camera, routes, or simulation state.

## Acceptance index

| Iteration | Route and evidence | Controls | Diagnostics | Result |
| --- | --- | ---: | --- | --- |
| 1 | `development/normal-route-a-2/` | 281 recorded inputs, 9 screenshots, WebM | 0 page errors, 0 console errors; 7 menu-scene `ERR_ABORTED` model requests | Walking round completed in 137.1 minutes with a 9-hole card and one 4-star experience review |
| 2 | `visual-iterations/iteration-02-route-a/` | 277 inputs, 9 screenshots, WebM | 0 page errors, 0 console errors; 7 menu-scene `ERR_ABORTED` requests | Revised walking round completed in 123.1 minutes; 120.0 average FPS and 109.89 FPS 1% low |
| 3 | `visual-iterations/iteration-03-route-b-accepted/` | 537 inputs, 11 screenshots, WebM | 0 page errors, 0 console errors; 8 menu-scene `ERR_ABORTED` requests | One cart stayed `cart-1` from assignment through return; 113.7-minute ride, 9-hole card, one review |
| 4 | `visual-iterations/iteration-04-final/` | 239 inputs, 7 screenshots, WebM | 0 page errors, 0 console errors, 0 failed requests | Two same-slot groups created organic waiting and one player marshal intervention; both completed exactly once |

The final post-iteration cart correction is independently proven in `routes/route-b-service-accepted-3/`: 211 normal inputs, 2 screenshots, WebM, 0 page errors, 0 console errors, 0 failed requests, persistent charging followed by one unassigned available state.

## Iteration 1 - walking baseline

Representative frames: `04-route-a-practice-facility.png`, `08-route-a-tee-shot.png`, and `09-route-a-walking-group.png` in `development/normal-route-a-2/`.

Ranked defects found:

1. Accumulated look input left the tee-shot and walking frames aimed almost entirely at turf.
2. The alleged tee-shot frame did not contain a readable golfer, ball, or landing corridor.
3. The walking frame showed only a ground shadow, so party movement could not be judged.
4. The PUTTING GREEN sign was oversized relative to the distant facility.
5. Starter, stand, and bags were too small to read from the chosen observation point.
6. The generic turf-inspection prompt occupied the visual center of every exterior frame.
7. The unrelated onboarding task competed with the golf subject in the lower left.
8. Practice surfaces read as broad texture regions with weak equipment silhouettes.
9. No operational HUD context was visible in the weakest exterior frames.
10. The single green grass texture dominated the image and flattened depth cues.
11. The group-to-reservation connection was provable in state but not legible in the missed frames.

Revision before iteration 2:

- Reset pitch at every observation point and tightened fixed target pitch.
- Replaced straight observer walks with collision-aware BFS movement and bounded sidesteps.
- Paused the normal simulation before framing so the observed party could not outrun the physical player.
- Selected closer, free observer cells around practice, starter, tee, and live party positions.
- Retained full normal-control booking, arrival, check-in, speed, and interaction paths.

Comparison: iteration 2 restores a stable horizon, readable practice sign, complete starter/tee context, and a visible two-person walking party. It turns the first run from functional-only evidence into judgeable player-camera evidence.

## Iteration 2 - revised walking route

Representative frames: `04-route-a-practice-facility.png`, `08-route-a-tee-shot.png`, and `09-route-a-walking-group.png` in `visual-iterations/iteration-02-route-a/`.

Ranked defects found:

1. The tee-shot capture still landed after the ball presentation window and emphasized bags/tee furniture.
2. The walking figures were readable but rigid and minimally expressive at distance.
3. The golf bags merged visually with the first-tee sign and one another.
4. Starter service information was too small to read without the laptop.
5. Practice props were sparse relative to the breadth of the facility lawn.
6. No frame demonstrated a riding party or a true cart assignment.
7. Ball flight was functionally recorded but too brief for repeatable nearby observation.
8. The central maintenance prompt still competed with golf subjects.
9. Party status disappeared outside the compact HUD's active display range.
10. No cart cleaning, charging, or availability feedback existed in this walking-only pass.
11. The optional model requests still aborted when the menu scene was replaced.

Revision before iteration 3:

- Added a complete ride-specific QA route: cart-inclusive booking, check-in, assignment, loading, travel, parking, return, service, fleet availability, scorecard, and review.
- Added persistent cart service phases and kept service carts visible after party unload.
- Added the original CartServiceBay Blender root, collider, materials, and in-game integration.
- Added cart entry/exit, seated, bag load/unload, and parked-cart presentation states.
- Extended nearby shot presentation time at normal speed so live swings and balls can be observed without writing the clock.
- Added parsed-GLB caching so scene replacement no longer generates repeated optional-model aborts.

Comparison: iteration 3 proves the system is no longer a walking-only showcase. The same cart ID is visible across the full transaction and returns to the fleet, while its screenshots expose concrete rider and service-sign problems for the next revision.

## Iteration 3 - cart round

Representative frames: `04-route-b-cart-loading.png`, `08-route-b-on-course-cart.png`, and `10-route-b-cart-charging.png` in `visual-iterations/iteration-03-route-b-accepted/`.

Ranked defects found:

1. Seated riders were visibly too high over the cart bench.
2. Rider and cart-entry poses could read as standing behind the vehicle rather than entering it.
3. Two blocky golfer silhouettes overlapped in perspective at some approach angles.
4. The CART SERVICE wayfinding label and live CLEANING/CHARGING label occupied the same screen band.
5. The live status badge was wider than necessary and obscured the facility sign.
6. The service bay was visually mixed with maintenance buildings and needed a stronger authored silhouette.
7. The cart-return frame did not clearly distinguish cleaning from charging without its text badge.
8. The generic surface prompt obscured the bottom edge of party/cart subjects.
9. Tree scale around the return bay competed with the smaller service building.
10. The cart-follow screenshot often reached the party after it had already parked for its next shot.
11. Early accepted runs still saw aborted scene-model fetches during transitions.

Revision before iteration 4 and final service proof:

- Lowered rider roots from the earlier raised placement and kept seat offsets formation-specific.
- Smoothed heading changes and separated entry/exit from persistent seated travel.
- Separated the facility label and live badge; the final badge is 0.82 world-width at 1.2 m above grade, immediately over the cart roof.
- Anchored charging duration to the actual cleaning-to-charging transition and prevented a coarse tick from collapsing both phases.
- Added a regression test for that coarse service tick.
- Added collision-aware sightline selection and bounded path replanning to the QA observer.
- Made the physical outdoor starter-desk interaction independent of optional GLB loading.
- Added the final `route-b-service-accepted-3` after-frame and exact state assertions.

Comparison: the supplemental final frame shows CHARGING above the cart with a clear gap below CART SERVICE. The same `cart-1` then becomes unassigned and available exactly once; no wall-clipped frame is accepted.

## Iteration 4 - congestion and marshal response

Representative frames: `03-route-c-starter-spacing.png`, `04-route-c-pace-alert.png`, `05-route-c-marshal-enroute.png`, `06-route-c-marshal-complete.png`, and `07-route-c-complete.png` in `visual-iterations/iteration-04-final/`.

Ranked defects found:

1. Starter furniture remains small at medium first-person distance.
2. The starter lawn has limited staging detail beyond the essential stand, display, bags, and staff.
3. The Course laptop page is information-dense when two simultaneous alerts are open.
4. The first marshal task retains the hole where it was created while its party continues to later holes.
5. The player intervention is contextual UI rather than a visible marshal character in early game.
6. The confirmation toast can persist across two adjacent evidence frames.
7. Low-condition turf causes every hole to appear in the problem-hole rollup, reducing prioritization value.
8. Distant golfer detail remains deliberately coarse under MID simulation fidelity.
9. Dense starter queues can briefly occlude the player camera if the player walks directly into them.
10. The simplified figures do not yet provide high-fidelity finger/club IK.
11. Scorecard rows below the laptop fold require scrolling to inspect all nine holes.

Final fixes and disposition:

- Completed player-dispatched marshal tasks after plausible travel and applied bounded pace credit instead of teleporting a group.
- Closed unhandled pace alerts when their party left the property, eliminating orphan tasks from the final Course page.
- Changed the live Course page to rerender only when its relevant signature changes, removing periodic full-page churn.
- Verified two exact-once completions/reviews, one marshal visit, 9 minutes of organic trailing-party wait, and no unsafe-shot event.
- Accepted the remaining items above as presentation limitations; none breaks the authoritative round, safety, save, fleet, or review contracts.

Comparison: iteration 4 adds a visibly actionable operations loop absent from iterations 1-3. Alert -> player en route -> complete is shown, the completed task disappears, both groups return cards, and no departed-party alert remains.

## Final diagnostics

- Route A accepted: walking practice, starter release, nine holes, card, review.
- Route B accepted plus final service proof: one cart from assignment through unassigned availability.
- Route C accepted: same-slot separation, real waiting, congestion, player marshal response, two completions.
- All accepted final runs have zero page errors and zero console errors.
- The final congestion, save/load, full-load, and service runs have zero failed requests.
- Rejected development directories are not referenced as acceptance evidence.
