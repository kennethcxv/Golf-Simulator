# Cleaning gameplay overnight QA

Date: 2026-07-18/19 (America/Los_Angeles)

Branch: `overnight/cleaning-gameplay`

Requested base: `overnight/base-2026-07-18` (not present locally)

Actual immutable base: `1dfb9de646c6785b027ddb023dda1e3a6af9a5c6`

Gameplay milestone: `74d35d7 feat(cleaning): build first-person cleaning lifecycle`

No external or generated assets were downloaded. The implementation uses the repository's existing
Sheet-8 world props and first-person GLBs.

## Evidence

- Baseline: `qa/overnight/cleaning-gameplay/baseline/`
- Final screenshots: `qa/overnight/cleaning-gameplay/final/screenshots/` (18 PNGs)
- Player-view video with the game's WebAudio mix:
  `qa/overnight/cleaning-gameplay/final/cleaning-gameplay-normal-controls.webm`
- Machine-readable result: `qa/overnight/cleaning-gameplay/final/acceptance-result.json`
- Repeatable driver: `tools/qa/cleaning-gameplay-acceptance.js`

The final driver recorded 56/56 passing assertions through `F`, left/right mouse holds, `E`, `X`,
and the pause-menu save/load controls. Direct state access was limited to deterministic dirt/debris
fixtures and fixed camera poses.

## Visual QA iteration 0 — baseline

Fixed conditions: 1440x900, DPR 1, clear 14:00 lighting, default first-person FOV. Ranked defects:

1. Critical — cloth was not visible; only a detached sleeve occupied the working corner.
2. Critical — sponge was not visible.
3. Critical — trash bag had no held silhouette or fill state.
4. Critical — active/equipped frames were indistinguishable for seven indoor tools.
5. High — spray bottle had no readable bottle/nozzle/trigger silhouette.
6. High — spray emitted no droplets or impact feedback.
7. High — vacuum hose read as a disconnected floating segment.
8. High — vacuum had no visible suction path.
9. High — two-handed tools showed one detached fist and no support hand.
10. High — dustpan had no visible grip.
11. High — pressure-washer water read as an opaque wedge.
12. High — pressure-washer impact read as a static white clump.
13. Medium — washer trigger/lance showed no active motion.
14. High — the bucket/wringer was buried in clutter and props.
15. High — mop work left no readable wet stroke.
16. High — pan/bag capacity had no visual state.
17. Medium — hands were coarse, oversized, and disconnected at the wrist.
18. Medium — all debris read as identical low-poly stones.
19. Medium — tool messages could stack over the lower working area.
20. Medium — the original cleaning-corner composition blocked its own approach.

Disposition: implementation required; see the baseline defect ledger beside the images for the
per-frame evidence.

## Visual QA iteration 1 — authored viewmodels integrated

Ranked defects after loading the existing first-person GLBs and their sockets:

1. Critical — compact cloth/sponge/bag roots loaded but sat too low to read from the player camera.
2. High — the spray trigger pivot inherited an exported evaluated offset and detached from the head.
3. High — inherited procedural hand poses still obscured compact authored tools.
4. High — support hands did not align to authored secondary-grip sockets.
5. High — the vacuum visual improved, but the hose/canister relationship remained ambiguous.
6. High — active clips existed but were not yet tied to the input-held state.
7. High — pressure-washer wedge geometry still dominated the authored lance.
8. High — particle points rendered as hard square sprites.
9. High — bag geometry did not communicate empty/partial/full/tied state.
10. Medium — mop and broom heads clipped low at ordinary working pitch.
11. Medium — the world cleaning bay still shared the abandoned-clutter footprint.
12. Medium — debris still lacked a readable litter-versus-grit distinction.

Revision: adopted authored grip/contact sockets, added AnimationMixers, repaired the spray pivot at
load, and retained the procedural geometry only as a no-blank-frame fallback.

## Visual QA iteration 2 — hands, motion, and particles

Ranked defects after the first feedback pass:

1. High — hands remained too large relative to the spray bottle.
2. High — cloth fingers formed a single block instead of a flat wiping pose.
3. High — the first spray particle scale obscured the contact point.
4. High — washer impact was improved but the beam remained too broad.
5. High — suction motes moved, but their square silhouette read as sparks.
6. High — the mop wet mask was functional but too subtle under warm indoor light.
7. Medium — trash-bag full scale filled too much of the lower frame.
8. Medium — broom/dustpan work feedback needed clearer start/stop timing.
9. Medium — stowing during a held input could leave the last effect visible for one frame.
10. Medium — compact tools still needed distinct one-hand poses.
11. Medium — all floor debris shared one material and silhouette.
12. Medium — equip messages obscured comparisons when tools were cycled quickly.

Revision: reduced limb/cuff scale, added capsule fingers and tool-specific poses, tied clips and
audio loops to held input, changed particles to a soft round canvas texture, and replaced the
washer wedge with a narrow beam, directional droplets, and mist.

## Visual QA iteration 3 — lifecycle and world loop

Ranked defects after functional capacity/state integration:

1. High — dustpan collection needed partial-cluster handling at the capacity boundary.
2. High — bag collection initially accepted grit that should remain for broom/pan/vacuum play.
3. High — no world verb connected pan load to bag load.
4. High — loaded bags had no tie-before-disposal rule.
5. High — mop charge existed without a physical service interaction.
6. High — bucket water did not yet expose clean/dirty/empty feedback.
7. High — save healing had to migrate legacy `reno.pan`/`reno.bag` aliases safely.
8. Medium — clutter at `(7.62, 1.31)` physically covered the cleaning bay on a fresh property.
9. Medium — static vacuum and fresh-bag props narrowed the stockroom approach lane.
10. Medium — the waste-station prompt competed with recycling actions.
11. Medium — wet/solution resources needed reload verification mid-task.
12. Medium — repeated switching needed a resource/listener stress boundary.

Revision: added finite pan/bag/mop/bucket state, partial collection with conservation, normal `E`/`X`
bay verbs, tie/dispose at the stockroom waste station, migration/healing, stateful bag/bucket visuals,
wall-side prop placement, and save/reload coverage. The pre-existing clutter is intentionally removed
with its normal `E` restoration verb before the bay becomes available.

## Visual QA iteration 4 — final acceptance frames

Ranked final findings across the two fixed bay cameras, nine active tools, three FOV/resolution
captures, capacity states, and disposal state:

1. Pass — every authored held tool has a readable player-camera silhouette.
2. Pass — spray droplets leave the nozzle and land at the same reachable surface the simulation uses.
3. Pass — vacuum/sweep/mop/wipe/scrub effects are soft round particles rather than square sprites.
4. Pass — the washer stream is narrow, nozzle-aligned, directional, and accompanied by mist.
5. Pass — empty/full/tied bag stages are visibly distinct and the full bag remains held.
6. Pass — bucket, wall tools, supply set, vacuum, litter bag, and waste station are readable from
   walk-free stockroom positions after the normal clutter-removal action.
7. Pass — wet floor feedback is visible without turning the floor into a mirror.
8. Pass — tools remain projected in frame at 1280x720/FOV 50, 1600x900/FOV 66, and
   1920x1080/FOV 90.
9. Minor — hands remain deliberately stylized and low-detail; no intersection hides a grip or socket.
10. Minor — the headless browser displays its normal `Click to play` pointer-lock hint in evidence.
11. Minor — the spray impact contains a bright wet highlight at steep downward angles, but the bottle,
    nozzle, particle path, and target remain legible.
12. Minor — one ANGLE shader compiler warning appears; console errors and failed requests are zero.

Disposition: no critical/high visual defects remain. Minor findings are consistent with the game's
stylized direction or browser-driver presentation and do not block normal play.

## Functional matrix

| Scenario | Normal route | Result |
| --- | --- | --- |
| Broom | `F`, hold left mouse | Moves/consolidates; 1.8 debris conserved |
| Dustpan | `F`, hold left mouse | Stops at 1.8 capacity; 0.5 overflow remains |
| Pan to bag | focus bay, `E` | Entire 1.8 load transferred |
| Vacuum | `F`, hold left mouse | Contact-socket suction, motes, clip, loop audio |
| Mop dry | `F`, hold left mouse | Refuses with `mop-dry`; no charge spent |
| Mop service | focus bucket, `E` | 24 charge, water consumed, wring count increments |
| Mop/carpet | hold left mouse | Refuses with `carpet`; no charge spent |
| Water change | focus bucket, `X` | Fresh/clean/100%, change count increments |
| Spray/cloth | `F`, mouse, `F`, mouse | Solution laid, then consumed while grime falls |
| Sponge | `F`, three mouse holds | Three accepted stubborn-grime passes |
| Trash bag | `F`, hold left mouse | Litter only, finite 7.5 capacity, overflow conserved |
| Tie/dispose | bay `E`, waste `E` | Tied load preserved; fresh bag installed; totals persist |
| Pressure washer | outdoor `F`, right/left mouse | Soap and wash change a real exterior surface |
| Active switch | hold mouse, press `F` | Input/effects/clip/audio stop immediately |
| Save/reload | pause Save/Load controls | Mid-task resources and dirt fields restored |
| Stress | 100 normal `F` presses | No live DOM, listener, scene, texture, geometry, or program growth |

## Performance

Matched conditions: 1440x900, DPR 1, indoor floor camera, 2.5-second samples, three samples per
scenario. Medians are used because the browser occasionally schedules a single long frame.

| Scenario | Baseline median FPS | Final median FPS | Retention |
| --- | ---: | ---: | ---: |
| Indoor idle | 93.57 | 115.44 | 123.4% |
| Vacuum active | 95.75 | 112.44 | 117.4% |
| Indoor idle 1% low | 41.55 | 59.88 | 144.1% |
| Vacuum active 1% low | 53.76 | 59.76 | 111.2% |

After 100 normal tool switches: live DOM nodes `308 -> 308`, event listeners `92 -> 92`, scene
nodes `4828 -> 4828`, geometries `1511 -> 1511`, textures `260 -> 260`, shader programs
`145 -> 145`.

## Verification

- Focused cleaning/state/save/resource/washing suite: 64 passed, 0 failed; the seven independent
  socket/occlusion tests also passed (71 total).
- Browser acceptance: 56 passed, 0 failed.
- Console errors: 0.
- Failed requests: 0.
- One non-fatal ANGLE shader compiler warning was recorded verbatim in the JSON evidence.
- Full repository suite: 1,665 passed, 3 skipped, 1 failed. The lone failure is the unrelated
  environment/evidence gate `tests/assets-51-60-reimport-report.test.js`: it requires the absent
  Sheet-6 Blender report produced by `tools/blender/verify_assets_51_60_reimport.py`. The filtered
  rerun reproduced only that assertion; it does not execute or reference cleaning gameplay.
