# Assets 51-100 runtime integration QA

Date: 2026-07-19

Branch: `overnight/assets-51-100-runtime`

Base: `1dfb9de`

## Outcome

Assets 51-100 are integrated into the live clubhouse runtime. The runtime manifest is complete,
all 50 primary assets pass clean Blender reimport, assets 61-100 create 40 placed runtime roots
(41 instances), and every declared first-person cleaning variant uses its authored GLB. Normal-play
browser acceptance passed for world interaction, tool use, collision state, animation, audio/video,
fixture parenting, autosave, and reload.

The current simplified card and cash checkout paths pass. The older full physical checkout contract
is not accepted: its barcode-over-scanner step cannot be performed because the current simplified
mode intentionally uses click-to-bag and has no physical scanner. This limitation is recorded rather
than hidden by a direct state mutation.

All browser evidence below is gitignored local evidence under:

`qa/assets_51_100_master/overnight_assets_51_100_runtime`

## Blender and runtime asset gates

Fresh Blender 5.1.2 clean-reimport runs were performed for sheets 6, 7, 8, 9, and 10.

| Gate | Result |
|---|---:|
| Primary assets | 50/50 |
| Blender sources on disk | 50/50 |
| Runtime GLBs on disk | 50/50 |
| Clean reimport | 50/50 |
| Registry bound | 50/50 |
| Scene mounted | 50/50 |
| Required first-person builds | 8/8 |
| Missing required sockets | 0 |
| Missing required animations | 0 |
| World triangles | 184,004 |
| First-person triangles | 17,572 |

The browser runtime probe on the final optimized asset build reports:

| Runtime property | Result |
|---|---:|
| Expected / placed asset roots | 40 / 40 |
| Runtime instances | 41 |
| Failed loads | 0 |
| Normal interaction targets | 22 |
| Animated runtime assets | 15 |
| Emitted practical lights | 3 |
| Hidden authored collision proxies | 72 |
| Fitting-room structural colliders | 4 |
| Authored first-person tool variants | 9 |
| Per-asset static batches | 39 |
| Per-asset draw calls saved | 164 |
| Placed-scene draw calls saved | 124 |
| Total static draw calls saved | 288 |

Probe evidence:

`iterations/iteration-6/runtime-probe-optimized.json`

## Normal-control acceptance

The final optimized normal-control run passed with real canvas clicks, keyboard `E`/`W`, and held
mouse input. Deterministic pose setup was used only to approach targets; interaction itself used the
same controls as gameplay.

- 13 world interactions produced durable state transitions and non-zero authored transform deltas.
- Nine first-person pickup/use routes played their declared authored clips: vacuum, mop, broom,
  dustpan, spray bottle, cloth, sponge, pressure washer, and trash bag.
- The closed fitting curtain blocked traversal; the open curtain removed only its state-aware blocker.
- Assets 62 and 64 remained attached to their live movable fixtures before and after autosave/reload.
- The exact `shop.assetRuntime` state survived a full page reload.
- The run retained nine screenshots and a 27.5-second VP9/Opus WebM with a live audio track.
- Blocking console, page, and request diagnostics: zero.

Evidence:

`iterations/iteration-6/normal-controls-final-tip`

## Before baseline

The untouched baseline was captured before runtime placement work:

`baseline/iteration-0`

The final fixed-camera comparison set is:

`iterations/iteration-6/fixed-camera-optimized`

## Visual revision cycle 1 - iteration 3

Comparison input: untouched baseline and the first complete placed-asset camera set.

| # | Visible weakness found | Revision / verification |
|---:|---|---|
| 1 | Fitting-room camera was too close and cropped the curtain edge. | Pulled the three-quarter camera back. |
| 2 | Lounge focus prompt covered the cabinet and chair silhouettes. | Fixed-camera prompt suppression added. |
| 3 | Office focus prompt covered desk props. | Fixed-camera prompt suppression added. |
| 4 | Cleaning prompt sat over the mop-bucket grouping. | Fixed-camera prompt suppression added. |
| 5 | Checkout prompt obscured the customer-side counter read. | Fixed-camera prompt suppression added. |
| 6 | Vacuum body dominated the cleaning-bay foreground. | Cleaning cameras were moved laterally and raised. |
| 7 | Trash bag visually merged into the vacuum silhouette. | Trash bag moved to the disposal end of the bay. |
| 8 | Pressure washer sat too tight to the stock shelf in the review frame. | Dedicated clearance camera added. |
| 9 | Hand truck dominated the stockroom equipment shot. | Equipment framing widened and retargeted. |
| 10 | Seeded debris remained visible after the deterministic clean fixture changed state. | `rebuildReno()` now refreshes debris presentation. |
| 11 | Washer hose/wand was clipped at the frame edge. | Washer target and camera distance revised. |

Evidence:

- `iterations/iteration-3/fixed-camera`
- `iterations/iteration-3/normal-controls`

## Visual revision cycle 2 - iteration 4

Comparison input: iteration 3. This cycle reviewed the updated composition and the live checkout
camera route.

| # | Visible weakness found | Revision / verification |
|---:|---|---|
| 1 | Inherited cameras 1-13 still retained transient focus prompts. | Prompt suppression moved into the shared 1-50 fixture. |
| 2 | Far stock-shelf faces read as a dark green block. | Stock practical moved rearward and increased from 10 to 11 intensity. |
| 3 | Trash bag and vacuum still merged from one approach. | Trash bag X placement moved from 7.72 to 5.82. |
| 4 | Worktable framing blocked the cleaning grouping behind it. | Worktable and cleaning cameras were split into distinct reads. |
| 5 | Side props weakened the sanitizer/utility composition. | Entry-safety camera target moved toward the wall utility line. |
| 6 | Cash drawer opened too quickly to read as physical travel. | Opening stroke changed from about 0.31 seconds to one second. |
| 7 | Legacy register driver appeared on the fairway after the clubhouse world offset changed. | Driver now derives its pose from the live interior root. |
| 8 | Legacy register capture could begin before assets finished loading. | Driver now waits for the 40/40 runtime diagnostic. |
| 9 | Floor equipment filled too much of the stockroom foreground. | Stock equipment camera moved back and retargeted. |
| 10 | Empty upper wall dominated the cleaning-bay frame. | Camera pitch lowered and target moved into the prop group. |
| 11 | Exit sign and sanitizer were too small to establish the safety story. | Safety entrance framing tightened around both authored utilities. |

Evidence:

- `iterations/iteration-4/fixed-camera-final`
- `iterations/iteration-4/normal-controls`
- `iterations/iteration-4/checkout`

## Visual revision cycle 3 - iteration 5

Comparison input: iteration 4. This was a full-resolution crop and hierarchy review.

| # | Visible weakness found | Revision / verification |
|---:|---|---|
| 1 | Checkout counter over-dominated the customer-side frame. | Final camera moved back and widened. |
| 2 | Receipt printer was clipped in the checkout composition. | Checkout target shifted toward the full POS group. |
| 3 | Lounge coffee table felt cramped against the sofa. | Lounge camera moved left and back. |
| 4 | Trophy cabinet was squeezed against the right frame edge. | Lounge target shifted toward the cabinet center. |
| 5 | Office chair was cropped at the lower edge. | Office camera widened. |
| 6 | Course map was cut at the right edge. | Office target moved right with added distance. |
| 7 | Washer hose was cropped in the stockroom view. | Washer camera moved to the aisle. |
| 8 | Hand truck was cut in the equipment view. | Stock camera moved away from the foreground equipment. |
| 9 | Camera 20 spent too much area on blank upper wall. | Pitch lowered to the cleaning/storage working plane. |
| 10 | Camera 20 cut the vacuum shell. | Target moved deeper into the bay. |
| 11 | Camera 25 cut both the vacuum and bin. | Player-approach camera moved to X 9.55. |
| 12 | Camera 26 clipped shelf and box supports. | Shelf-support camera moved to X 8.80 and Z -3.05. |
| 13 | Camera 27 side objects weakened the entry utility focus. | Camera moved toward the center aisle. |
| 14 | Camera 28 cropped signage, bin, and wand simultaneously. | Washer-clearance camera moved closer to the aisle centerline. |
| 15 | Worktable frame clipped the trash bag at the left edge. | Worktable target moved right and down. |

Evidence:

- `iterations/iteration-5/fixed-camera`
- `iterations/iteration-5/normal-controls`

## Visual revision cycle 4 - iteration 6

Comparison input: iteration 5 and the first iteration-6 candidate. The candidate was corrected in
place, then the optimized runtime was captured again in a separate final directory.

| # | Visible weakness found | Revision / verification |
|---:|---|---|
| 1 | Cleaning camera could land behind the partition wall. | Final approach was moved to the unobstructed aisle. |
| 2 | Lounge right foreground contained distracting retail-rack clutter. | Lounge camera moved left and retargeted. |
| 3 | Two stock views repeated nearly the same subject hierarchy. | One view now emphasizes shelving; the other emphasizes equipment. |
| 4 | Vacuum shell still touched the lower edge in the near cleaning view. | Camera was raised and moved farther back. |
| 5 | Washer frame contained excessive empty floor. | Target raised toward the pump and hose reel. |
| 6 | Customer-side checkout remained a little tight around the printer. | Camera moved to X 5.0, Z 5.8 with shallower pitch. |
| 7 | Office map was still close to the right crop. | Office camera moved to X 6.5 and widened the room context. |
| 8 | Shelf-support view hid the lower boxes behind foreground equipment. | Camera moved to the right side of the aisle. |
| 9 | Sanitizer sat too near the safety frame edge. | Safety target shifted left while keeping the exit sign legible. |
| 10 | Worktable left edge retained disposal clutter. | Worktable camera moved right to center its task surface. |
| 11 | Fixed-camera prompts could reappear after inherited camera work. | Both shared and asset-specific fixtures now hide transient labels. |

Final full-resolution inspection accepted checkout, lounge, office, stockroom, worktable, cleaning
bay, safety entrance, and pressure-washer frames. No palette, transform, or silhouette artifact was
introduced by static batching.

Evidence:

- `iterations/iteration-6/fixed-camera`
- `iterations/iteration-6/fixed-camera-optimized`
- `iterations/iteration-6/normal-controls-final-tip`

## Checkout QA

### Current supported simplified checkout

The final patched tip passed both retained routes:

| Route | Result | Retained evidence |
|---|---|---|
| Card | PASS | 30 PNGs; 20,834,124-byte VP9/Opus WebM |
| Cash | PASS | 30 PNGs; 17,951,882-byte VP9/Opus WebM |

Both report zero console errors, page errors, or non-aborted request failures. Evidence:

`iterations/iteration-6/checkout-final-after-active-arrival`

The cash fixture proves a $35.72 total, $40.00 tender, and exact $4.28 change. The card fixture
includes pre-authorization exit plus a real decline and replacement-card recovery. Both routes
verify inventory, revenue, transaction history, receipt, bag handoff, customer departure, and
production-build hash stability.

The four-case save/reload suite also passed:

- Mid-scan rollback.
- Declined-card rollback.
- Selected-change rollback.
- Completed-card exact-once restore.

Every case loaded the same autosave twice and verified UI/physical cleanup plus financial,
inventory, ledger, customer, review, and statistics reconciliation. Evidence:

`iterations/iteration-6/save-reload-final-tip`

### Checkout lifecycle defect found and fixed

The first lifecycle smoke exposed a customer-arrival path where the player remained in cashier mode
between customers. The new transaction stayed at `WaitingForCashier`; payment and physical delivery
could proceed, but exact-once banking correctly refused because `CustomerLeaving` had never been
reached. `begin(customer)` now starts the same `EnteringCashierMode` beat used by normal `E` entry
when the cashier is already active.

The final lifecycle smoke passed 4/4 sales (two card, two cash), two normal enter/exit cycles, one
pre-authorization cancellation, one decline/recovery, two drawer open/close cycles, and four distinct
customer spawn/removal cycles. Forced-GC heap growth was 488,492 bytes, listener net stayed zero,
and post-cycle scene geometry/material/texture counts were stable. Smoke profile stability results
are informational rather than a replacement for the 200-sale master profile.

Evidence:

- Failed diagnostic retained at `performance/static-batch/lifecycle-smoke-final`
- Passing rerun at `performance/static-batch/lifecycle-smoke-final-2`

### Remaining checkout limitation

The legacy eleven-step physical checkout driver was run twice. The first attempt exposed and led to
the live-interior-offset/runtime-ready driver correction. The second attempt then stopped at the
actual product limitation: the legacy route requires moving a product barcode over a physical
scanner, while current simplified mode intentionally has no scanner and uses click-to-bag.

Evidence:

- `iterations/iteration-4/checkout/attempt-1-stale-world-offset`
- `iterations/iteration-4/checkout/attempt-2-legacy-physical-barcode-required`

Therefore the current supported card/cash experience is verified, but the full physical-scanner
checkout benchmark remains unfinished and must not be described as production-accepted.

## Matched performance comparison

Method: median of three samples for an untouched `1dfb9de` worktree versus median of three samples
for the optimized integration worktree. The before server's served `clubhouse.js` was hash-checked
against the detached baseline. Samples mistakenly taken from a different checkout-polish server were
quarantined under `performance/discarded-wrong-before-server-8468` and are not used below.

| Scenario | Before FPS / 1% low / worst ms | After FPS / 1% low / worst ms | Result |
|---|---:|---:|---|
| Idle exterior | 19.009 / 14.104 / 75.0 | 23.601 / 15.004 / 66.7 | Improved |
| Vacuum active | 84.059 / 45.620 / 33.2 | 79.133 / 49.751 / 25.0 | Average -5.9%; low and worst improved |
| Pressure washer active | 24.558 / 16.000 / 66.7 | 34.882 / 26.631 / 41.6 | Improved |

The acceptance threshold for the active-tool comparison was no more than 10% average-FPS regression
with no material low/worst-frame regression. Vacuum average FPS remains within that threshold while
its 1% low improves 9.1% and worst frame improves 24.7%.

| Median renderer metric | Before | After | Change |
|---|---:|---:|---:|
| Idle draw calls | 9,040 | 7,238 | -19.9% |
| Idle rendered triangles | 21,755,176 | 21,917,656 | +0.75% |
| Idle materials | 677 | 587 | -13.3% |
| Idle textures | 201 | 191 | -5.0% |
| Washer draw calls | 7,967 | 6,311 | -20.8% |
| Vacuum UI mutations / second | 8.154 | 8.360 | +2.5% |
| Event listeners | 91 | 91 | unchanged |
| Idle JS heap | 90,890,904 | 93,087,584 | +2.4% |

The scene-triangle traversal counter rises because the named/socket hierarchy and suppressed source
geometry remain available for animation and interaction; the renderer draw/triangle counters show
what is actually submitted. This non-destructive structure is required to preserve pivots, sockets,
save state, and authored clips.

Raw samples:

- Before: `performance/matched-stress-final/before-1` through `before-3`
- After: `performance/static-batch/after-palette-sample-1` through `after-palette-sample-3`
- Final residency: `performance/static-batch/runtime-asset-residency-final.json`

Final runtime residency measured 3,394 scene meshes, 2,904 visible meshes, 3,252,543 scene triangles,
624 materials, and 193 scene textures. The probe observed no blocking diagnostic.

## Console and request health

No final browser run reported a blocking console error, page error, or non-aborted request failure.
The retained non-blocking diagnostics are:

- A pre-existing ANGLE/HLSL `X4000` warning about a potentially uninitialized shader variable.
- Optional `tractor_broken.glb` and `shed.glb` fallback requests aborted during some fixed-camera
  boots; the normal-control final run only retained the optional `shed.glb` abort.

## Full automated test result

`node --test` completed in 334.9 seconds:

| Result | Count |
|---|---:|
| Total tests | 1,665 |
| Passed | 1,662 |
| Failed | 0 |
| Cancelled | 0 |
| Skipped | 3 |

The three existing skips are conditional tests for other gitignored Blender QA reports
(`nonretail_furniture_packed`, `nonretail_fixture_products`, and `provisions_products`). Assets
51-100 are not covered by those skips; their five fresh clean-reimport reports passed separately as
recorded above.

## Reproduction commands

Run from the isolated worktree with its server available at `QA_BASE_URL`:

```powershell
node tools/qa/assets-51-100-status.mjs
node --test

$env:QA_BASE_URL='http://localhost:8467/'
$env:QA_REPO_ROOT=(Get-Location).Path
node tools/qa/run-playwright.cjs tools/qa/assets-51-100-runtime-probe.js --bootstrap
node tools/qa/run-playwright.cjs tools/qa/assets-51-100-runtime-acceptance.js --bootstrap
node tools/qa/run-playwright.cjs tools/qa/assets-51-100-baseline.js --bootstrap
node tools/qa/run-playwright.cjs tools/qa/simplified-register-card.js --bootstrap
node tools/qa/run-playwright.cjs tools/qa/simplified-register-cash.js --bootstrap
node tools/qa/run-playwright.cjs tools/qa/simplified-register-save-reload.js --bootstrap
node tools/qa/run-playwright.cjs tools/qa/simplified-register-lifecycle-stress.js --bootstrap
```
