# Cleaning gameplay overnight QA

Date: 2026-07-18/19 (America/Los_Angeles)

Branch: `overnight/cleaning-gameplay`

Requested base: `overnight/base-2026-07-18` (not present locally)

Actual immutable base: `1dfb9de646c6785b027ddb023dda1e3a6af9a5c6`

Stable milestones:

- `74d35d7 feat(cleaning): build first-person cleaning lifecycle`
- `2f90b8b test(cleaning): add production acceptance evidence`
- `6752c3f fix(cleaning): add fading washer surface wetness`

No raw Tripo file, Blender source, GLB, checkout flow, or course-generation system was changed. No
external or generated asset was downloaded. The implementation integrates the repository's existing
Sheet-8 world props and authored first-person GLBs.

## Evidence and reproduction

- Immutable-base evidence: `qa/overnight/cleaning-gameplay/baseline/`
- Final screenshots: `qa/overnight/cleaning-gameplay/final/screenshots/` (42 PNGs)
- Player-view video with the game's WebAudio mix:
  `qa/overnight/cleaning-gameplay/final/cleaning-gameplay-normal-controls.webm`
- Machine-readable result: `qa/overnight/cleaning-gameplay/final/acceptance-result.json`
- Repeatable acceptance driver: `tools/qa/cleaning-gameplay-acceptance.js`
- Repeatable immutable-base performance driver: `tools/qa/cleaning-performance-baseline.js`

Launch with `PORT=8463 node tools/serve.cjs`, then start a clean game through the title menu. The
acceptance driver uses the real `F`, held left/right mouse, `E`, `X`, and pause-menu Save/Load routes.
Direct state access is restricted to deterministic dirt/debris fixtures, fixed cameras, weather/time,
and diagnostics. It recorded 64/64 passing assertions and 73 normal-control actions.

Fixed visual conditions were clear 14:00 lighting and DPR 1. The primary cameras were:

- floor: `(-5.5, 3.2)`, yaw `0`, pitch `-0.62` (compact-tool review at pitch `-0.82`)
- west bay: `(6.30, -2.25)` toward `(7.85, 1.08)`, pitch `-0.10`
- east bay: `(8.55, -1.25)` toward `(7.65, 1.08)`, pitch `-0.22`
- exterior washer: `(5.6, 9.2)` toward `(5.6, 6.5)`, pitch `0.06`

The FOV matrix covers every one of the nine tools at 1280x720/FOV 50, 1600x900/FOV 66, and
1920x1080/FOV 90. All 27 cases retained projected tool geometry and every expected hand. Maximum
live hand-to-authored-grip distance was 0.00610 world units.

## Visual QA iteration 0 - baseline

Ranked defects from the player camera:

1. Critical - cloth was absent; only a detached sleeve occupied the working corner.
2. Critical - sponge was absent.
3. Critical - trash bag had no held silhouette or fill state.
4. Critical - equipped and active frames were indistinguishable for seven indoor tools.
5. High - spray bottle had no readable bottle, nozzle, or trigger silhouette.
6. High - spray emitted no droplets or impact feedback.
7. High - vacuum hose read as a disconnected floating segment.
8. High - vacuum had no visible suction path.
9. High - two-handed tools showed one detached fist and no support hand.
10. High - dustpan had no visible grip.
11. High - pressure-washer water read as an opaque wedge.
12. High - pressure-washer impact read as a static white clump.
13. High - the bucket and wringer were buried in clutter.
14. High - mop work left no readable wet stroke.
15. Medium - hands were oversized and disconnected at the wrist.

Disposition: implementation required.

## Visual QA iteration 1 - authored viewmodels integrated

1. Critical - cloth, sponge, and bag roots loaded too low to read.
2. High - the spray trigger inherited an exported evaluated offset and detached from its head.
3. High - inherited hand poses obscured compact authored tools.
4. High - support hands did not align to secondary-grip sockets.
5. High - the vacuum hose/canister relationship remained ambiguous.
6. High - active clips were not tied to held input.
7. High - the washer wedge still dominated the lance.
8. High - particle points rendered as hard square sprites.
9. High - bag geometry did not communicate empty, partial, full, or tied states.
10. Medium - mop and broom heads clipped at ordinary working pitch.
11. Medium - the world cleaning bay shared the abandoned-clutter footprint.
12. Medium - debris lacked a litter-versus-grit distinction.

Revision: adopted authored grip/contact sockets, added animation mixers, repaired the spray pivot at
load, and retained procedural geometry only as a no-blank-frame fallback.

## Visual QA iteration 2 - hands, motion, and particles

1. High - hands remained too large relative to the spray bottle.
2. High - cloth fingers formed a block instead of a flat wiping pose.
3. High - the initial spray-particle scale obscured the contact point.
4. High - the washer beam remained too broad.
5. High - suction motes moved but read as square sparks.
6. High - the mop wet mask was too subtle under warm indoor light.
7. Medium - full bag scale occupied too much of the lower frame.
8. Medium - broom/dustpan feedback needed clearer start/stop timing.
9. Medium - stowing during held input could leave feedback for one frame.
10. Medium - compact tools needed distinct one-hand poses.
11. Medium - floor debris shared one material and silhouette.
12. Medium - equip messages obscured fast comparisons.

Revision: reduced limb/cuff scale, added capsule fingers and tool-specific poses, tied clips and loop
audio to held input, introduced a soft round particle texture, and replaced the washer wedge with a
narrow beam, directional droplets, and mist.

## Visual QA iteration 3 - lifecycle and world loop

1. High - dustpan collection needed partial-cluster handling at capacity.
2. High - bag collection accepted grit that belongs to broom, pan, or vacuum play.
3. High - no world verb transferred pan load to bag load.
4. High - loaded bags had no tie-before-disposal rule.
5. High - mop charge existed without a physical service interaction.
6. High - bucket water lacked clean, dirty, and empty feedback.
7. High - save healing had to migrate legacy `reno.pan`/`reno.bag` aliases safely.
8. Medium - fresh-property clutter physically covered the cleaning bay.
9. Medium - static vacuum and bag props narrowed the stockroom approach.
10. Medium - waste-station and recycling prompts competed.
11. Medium - wet and solution resources needed mid-task reload verification.
12. Medium - repeated switching needed a listener/resource boundary.

Revision: added finite pan/bag/mop/bucket state, partial collection with conservation, normal `E`/`X`
bay verbs, tie/dispose at the waste station, migration/healing, stateful bag/bucket visuals, and
wall-side prop placement. Fresh-property clutter is removed through its normal `E` restoration verb.

## Visual QA iteration 4 - first acceptance pass

1. Pass - all nine held tools had readable working silhouettes.
2. Pass - spray droplets left the nozzle and landed at the simulated contact.
3. Pass - vacuum, sweep, mop, wipe, and scrub used soft feedback rather than square sprites.
4. Pass - the washer stream was narrow, directional, misted, and surface-local.
5. Pass - empty, full, and tied bag stages were visibly distinct.
6. Pass - the cleaning-bay props remained readable from walk-free stockroom positions.
7. Pass - wet floor feedback read without making the floor mirror-like.
8. Pass - all tools remained in frame at the low, default, and high FOV captures.
9. Minor - hands remained deliberately stylized and low-detail.
10. Minor - the headless browser showed its normal `Click to play` pointer-lock hint.
11. Minor - steep spray impacts produced a bright highlight while remaining legible.
12. Pass - console errors and unexpected failed requests were zero.

The pass exposed two lifecycle-only defects that static frame review did not reveal; iterations 5 and
6 closed them before the final evidence run.

## Visual QA iteration 5 - live animated grips

1. Critical - hands sampled authored sockets only once, then clips moved the sockets away.
2. High - the defect affected primary and support grips differently.
3. High - two-handed tools made the separation most obvious.
4. High - the separation remained visible across FOVs.
5. High - bind-pose screenshots could mask it.
6. Medium - cached grip diagnostics falsely looked stable.
7. Medium - animation timing changed the apparent severity.
8. Medium - tool placement offsets could not repair a moving mismatch.
9. Pass - the source GLBs contained valid named grip sockets.
10. Pass - contact/nozzle sockets already followed their animated hierarchy.

Revision: the viewmodel now resolves grip sockets after mixer advance every frame, and first-person
hands resample those live positions without rebuilding geometry or changing the authored pose.

## Visual QA iteration 6 - repeated-switch action lifecycle

1. Critical - after the lifecycle and 100 switches, the low-FOV trash bag lost most of its silhouette.
2. High - fresh reloads passed, making the defect sequence-dependent.
3. High - clamped equip/unequip actions accumulated stale blended poses.
4. High - bag animation showed the largest displacement.
5. High - hand projection alone could pass while tool projection failed.
6. Medium - static placement changes helped a fresh pose but not the stressed pose.
7. Medium - the failure appeared only after repeated normal `F` cycling.
8. Medium - the mixer reported no active work clip despite the residual blend.
9. Pass - stopping prior actions before each transition removed the stale pose.
10. Pass - the 100-switch browser stress then retained all nine singular viewmodels.

Revision: every equip transition stops the previous mixer's actions before playing the new equip or
unequip clip. A regression test reproduces repeated transitions and verifies the socket returns to the
same pose.

## Visual QA iteration 7 - exterior performance and final acceptance

1. High - a corrected matched immutable-base run exposed an exterior washer FPS regression.
2. High - indoor detail props were rendering through the clubhouse shell from the washer camera.
3. High - the pre-fix washer view fell to roughly 27 FPS versus roughly 35 FPS on base.
4. High - the fix could not remove facade/entrance props visible from the porch.
5. High - the fix could not alter colliders, save data, or gameplay state.
6. Medium - the porch camera needed to retain full detail until actually outside.
7. Medium - prop diagnostics needed to state detailed and visible counts.
8. Pass - all 30 props remain eligible inside and on the porch.
9. Pass - only five facade/entrance props remain eligible at the exterior washer camera.
10. Pass - the final washer median improved beyond base with fewer calls and triangles.

Revision: camera-only rendering LOD retires deep interior dressing beyond 1.5 yards outside the
clubhouse footprint while retaining props 93, 94, 98, 99, and 100. It does not touch prop placement,
colliders, interactions, or persistence. The final 42-frame review found no remaining critical/high
visual defect.

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
| Water change | focus bucket, `X` | Fresh/clean/100%; change count increments |
| Spray/cloth | `F`, mouse, `F`, mouse | Solution laid, then consumed while grime falls |
| Sponge | `F`, three mouse holds | Three accepted stubborn-grime passes |
| Trash bag | `F`, hold left mouse | Litter only, finite 7.5 capacity, overflow conserved |
| Tie/dispose | bay `E`, waste `E` | Tied load preserved; fresh bag installed; totals persist |
| Pressure washer | outdoor `F`, right/left mouse | Soap/wash affect a real surface; wet sheen appears, fades, dries |
| Active switch | hold mouse, press `F` | Input, effect, clip, and loop audio stop immediately |
| Save/reload | pause Save/Load controls | Mid-task resources and dirt fields restore safely |
| Stress | 100 normal `F` presses | No DOM, listener, scene, or GPU-resource growth |

## Media and browser diagnostics

- Video: 63,021,998 bytes, 190,019 ms, VP9/Opus, one video track and one audio track.
- Game audio: peak 0.044767; all 3,633 sampled windows were non-silent.
- Screenshots: 42 total, including all 27 tool/FOV combinations.
- Console errors: 0.
- Console warnings: 0.
- Failed requests: 0.

## Matched performance comparison

Both worktrees used 1440x900, DPR 1, identical fixed cameras, 2.5-second samples, and three samples
per scenario. Values below are medians. Render counters include complete EffectComposer work.

| Scenario | FPS base -> final | 1% low base -> final | Worst ms base -> final | Calls base -> final | Triangles base -> final |
| --- | ---: | ---: | ---: | ---: | ---: |
| Indoor idle | 119.87 -> 119.97 | 71.60 -> 71.60 | 24.9 -> 16.8 | 497.54 -> 533.67 | 4.565M -> 4.570M |
| Vacuum active | 119.96 -> 119.66 | 71.94 -> 60.12 | 16.6 -> 16.7 | 513.58 -> 601.62 | 4.571M -> 4.581M |
| Washer idle | 35.90 -> 45.66 | 24.04 -> 29.99 | 41.6 -> 33.4 | 3716.66 -> 3164.25 | 7.637M -> 7.384M |
| Washer active | 34.46 -> 45.01 | 24.04 -> 29.99 | 41.6 -> 33.4 | 3719.09 -> 3161.90 | 7.649M -> 7.383M |

Declared gates all pass: average-FPS retention at least 75%, 1%-low retention at least 65%, calls at
most 1.25x, triangles at most 1.15x, and bounded resource/listener/UI additions. Across scenarios the
largest additions were 6 materials, 85 geometries, 2 resident textures, 2 scene-referenced textures,
8 shader programs, and 3 listeners. Estimated scene-referenced decoded RGBA8 texture memory plus
mip chains changed from 610.393 MiB to 610.401 MiB (+8 KiB). The largest final median heap was
225.87 MiB, below the 384 MiB post-GC ceiling; maximum median UI mutation rate was 0.3992/s.

After 100 normal tool switches: live DOM nodes `308 -> 308`, listeners `102 -> 102`, scene nodes
`4828 -> 4828`, geometries `1511 -> 1511`, textures `260 -> 260`, programs `145 -> 145`, and
post-GC heap `224,976,287 -> 222,273,591` bytes.

## Verification

- Focused cleaning, state, save, resource, washing, socket/occlusion, and prop-LOD suite: 95 passed,
  0 failed.
- Browser acceptance: 64 passed, 0 failed.
- Final browser route: 0 console errors, 0 warnings, 0 failed requests.
- Full repository suite: 1,672 passed, 3 skipped, 1 failed. The sole failure is the unrelated
  environment/evidence gate `tests/assets-51-60-reimport-report.test.js`, which requires the absent
  clean-Blender Sheet-6 report produced by `tools/blender/verify_assets_51_60_reimport.py`; it does
  not execute or reference cleaning gameplay.
