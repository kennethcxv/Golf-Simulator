# Customer Simulation Baseline

Captured 2026-07-19 on `overnight/customer-simulation` at local `main` commit
`0c5137e5f0efac9627ce2309b9e66936f1eeb769`.

No Git remote is configured in this repository, so currency could be verified only
against the local `main` ref. The original checkout at
`C:\Users\Kenneth\Documents\GitHub\Golf-Flipper` was dirty on
`integration/all-verified-work-2026-07-18`; it was left untouched. This work runs in
the isolated worktree
`C:\Users\Kenneth\Documents\GitHub\Golf-Flipper-customer-simulation`.

## Launch and fixed conditions

- Server: `PORT=8463 node tools/serve.cjs`
- Browser: Chrome headless through Playwright
- Viewport: 1600 x 900 CSS pixels, device scale factor 1
- Game time: 10:00 AM for visual captures
- Controls smoke: click game canvas, hold `W` 350 ms, hold `A` 250 ms, release
  pointer lock with `Escape`, then resume through the visible menu
- Repeatable fixture: six stocked customers (five normal entry routes plus one
  inventory-accounted card shopper sent to the register)
- Valid visual run: `visual-20260719-162724.json`
- Valid recording: `video/20260719-162724/page@2fd4f4ddf05ec30d4afdb08dd0a7b9cf.webm`

Fixed cameras are defined in `tools/qa/customer-simulation-visual.mjs`:

1. Exterior approach
2. Entry door from inside
3. Browsing floor
4. Register queue
5. Lounge

## Baseline findings

Ranked by player impact:

1. **Critical — entry crowd overlap:** five customers occupy effectively the same
   exterior approach area in `02-entry-door.png`; bodies interpenetrate and read as
   one cluster.
2. **Critical — no successful natural entry in the observed path:** after 8.5 seconds,
   all five natural customers still report the generic `walk` stop outside. Only the
   diagnostic register customer reached an indoor activity.
3. **High — closed-door pile-up:** the entry slab remains closed while the clustered
   group waits immediately outside. There is no visible approach-slot or entry-slot
   coordination.
4. **High — lifecycle is not observable:** QA can see only `walk`, `counter`, and
   scattered booleans. It cannot distinguish scheduled, approaching, waiting for
   door, entering, browsing, queueing, paying, leaving, or recovery transitions.
5. **High — browsing floor has no customers:** `03-browsing-floor.png` contains stocked
   displays but no shopper, inspection pose, browse occupancy, or product decision.
6. **High — queue behavior is unproven:** `04-register-queue.png` shows one stationary
   shopper at the counter. There is no multi-person spacing, ordered advance, capacity,
   or abandonment evidence.
7. **High — no front-desk physical wait:** reservation check-in is a global register
   prompt; the current visual reservation proxy does not remain at the desk for the
   player.
8. **Medium — product handoff is visually weak:** the register shopper is rigid, fills
   the foreground, and does not visibly stage a real product from hand to counter in
   the baseline frame.
9. **Medium — lounge is scenery only:** `05-lounge.png` has no occupied chair, window
   look, noticeboard use, or other ambient behavior.
10. **Medium — navigation recovery has no evidence:** the records expose only a short
    `stuckT` value; there is no last-progress timestamp, recovery attempt sequence,
    alternate approach, safe anchor, or emergency timeout.
11. **Medium — arrivals lack authored exterior variation:** customers use one spawn
    region in grass rather than varied exterior/parking arrival anchors feeding a
    shared approach.
12. **Medium — character resources are not shared:** the 12-customer stress fixture
    increased visible material count from roughly 219 to 301 and JS heap from roughly
    55 MB to 97 MB.
13. **Low — duplicate names/looks are conspicuous in a small group:** the valid probe
    contains repeated names in the same six-person visit.
14. **Low — onboarding UI obscures simulation review:** tutorial cards and completion
    toasts cover the lower-left and lower-center portions of fixed visual frames.

## Console and network

- Console errors: 0
- Page errors: 0
- Repeated warning: Canvas2D readback would benefit from `willReadFrequently`
- Several optional GLB requests were aborted when the QA context closed. They were not
  HTTP failures and did not produce console errors.
- Active event listeners after the visual path: 102

## Performance baseline

Raw data: `performance/performance-20260719-163122.json`.

The test browser uses software WebGL at 1600 x 900, so absolute frame rates are not a
shipping-hardware estimate. They are a repeatable before/after regression signal.

| Metric | Idle | 12 customers |
|---|---:|---:|
| Average FPS | 0.502 | 0.442 |
| 1% low FPS | 0.420 | 0.365 |
| Worst frame | 2408.6 ms | 4436.5 ms |
| Aggregated draw calls in sampled app frame | 3690 | 5703.3 |
| Aggregated rendered triangles in sampled app frame | 10,309,003 | 11,572,294 |
| Visible material count | 219 | 301 |
| Estimated reachable texture bytes | 6,169,904,533 | 6,352,116,459 |
| Precise JS heap used | 55,432,352 B | 96,886,446 B |
| Active event listeners | 92 | 92 |
| HUD mutation records/second | 1.003 | 0.884 |

Before judging the final comparison, the proposed gate is:

- no more than 10% lower average or 1% low FPS in either identical scenario;
- no more than 5% additional draw calls, rendered triangles, material count, or
  estimated texture bytes attributable to customer simulation;
- no unbounded JS heap growth across repeated lifecycle runs;
- zero active-listener growth after repeated customer spawn/despawn and checkout
  interactions;
- no increase in HUD mutation frequency attributable to customer state.

The implementation should materially improve the 12-customer material and heap deltas
through shared resources and pooling.

