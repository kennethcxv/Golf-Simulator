# Overnight QA baseline — 2026-07-18

## Verdict

**NOT READY FOR INTEGRATION.** Boot, console, shaders, editor tools, editor save/reload, cleaning behavior, generic save/reload, GLB import, resource stabilization, asset paths, assets 1–50, and the full Node suite are green. The following mandatory gates are red:

- strict physical checkout, card and cash;
- declared runtime bindings for assets 51–100;
- absolute player-camera performance and headed-run repeatability;
- dependency security pending an Electron major upgrade or signed waiver.

No production source was changed during this audit. The only runtime-adjacent edit is a corrected QA driver position derived from the live clubhouse transform.

## Audit identity and isolation

| Field | Value |
| --- | --- |
| Required base name | `overnight/base-2026-07-18` |
| Named base status | Missing locally; `git fetch --all` found no remotes and no remote ref |
| Immutable fallback base | `1dfb9de646c6785b027ddb023dda1e3a6af9a5c6` |
| Fallback justification | Common starting commit of every available overnight branch and reflog |
| QA branch | `overnight/qa-audit` |
| QA worktree | `<REPOSITORY_ROOT>-qa-audit` |
| Original worktree | Not modified; it was already dirty and was treated as out of scope |
| Isolated server | `http://127.0.0.1:8469/` from the QA worktree |
| Browser | Chrome 150, Playwright isolated context, DPR 1 |
| GPU | NVIDIA GeForce RTX 5080 through ANGLE D3D11 |
| Blender | 5.1, factory startup |
| Node | Node 22 line used by the repository |

All retained runtime evidence is under `qa/overnight/` or the existing canonical QA roots. `/qa/` is ignored by default, so CI or the integration owner must archive it before deleting this worktree.

## Gate results

| Gate | Status | Result and evidence |
| --- | --- | --- |
| Boot | PASS | Normal `Continue` reached `screen=game`, live scene and clubhouse, hidden load veil, live WebGL context. `qa/overnight/integration/iteration-03/boot/result.json` |
| Console errors | PASS | Zero console errors and page errors on boot. One non-fatal ANGLE shader warning remains. `qa/overnight/integration/iteration-03/console/result.json` |
| Course shaders | PASS | 140 programs, zero broken programs, `glError=0`, context live. `qa/overnight/integration/iteration-03/shaders/result.json` |
| Editor tools | PASS | Six of six comprehensive checkpoints, zero blockers, 16 screenshots, 20.1 MB video. `qa/overnight/integration/iteration-04-editor/editor-tools/result.json` |
| Editor stroke performance | PASS | 81.82 average FPS, 26.63 1% low, 41.6 ms worst, no frame over 100 ms; scoped undo matched 1,040,403 vertex components byte-for-byte. `qa/overnight/integration/iteration-04-editor/editor-performance/result.json` |
| Strict checkout — card | **FAIL** | First click auto-scans/stages the held item before its barcode can be rotated. `qa/overnight/integration/iteration-04-checkout/checkout-card/result.json` |
| Strict checkout — cash | **FAIL** | Same physical-scan blocker; cash tender, change, receipt, bagging, and handoff are unreachable. `qa/overnight/integration/iteration-04-checkout/checkout-cash/result.json` |
| Assets 1–50 manifest | PASS | 50 ordered records, required source/runtime artifacts and declared bindings present. `qa/overnight/integration/iteration-03/assets-1-50/result.json` |
| Assets 51–100 manifest | **FAIL** | Required artifacts exist, but 13 declared runtime integration files are absent. `qa/overnight/integration/iteration-03/assets-51-100/result.json` |
| Clean GLB reimport | PASS | 58 GLBs imported under factory-startup Blender; zero errors and warnings. `qa/overnight/integration/iteration-04-glb/glb-clean-reimport/result.json` |
| Runtime asset paths | PASS | Every literal runtime GLB/image/audio/data path resolved inside the repository. `qa/overnight/integration/iteration-03/runtime-paths/result.json` |
| Cleaning sockets and occlusion | PASS | Static socket/occlusion contracts and live pressure-washer nozzle origin passed. |
| Cleaning wetness and debris | PASS | Broom conserved debris and consolidated 38→34 entries; dustpan collected 0.44; mop left wetness; dry cloth refused; spray/wipe cleaned. `qa/overnight/integration/iteration-04-runtime/cleaning-runtime/cleaning-tools-result.json` |
| Cleaning runtime | PASS | Cleaning tool smoke and pressure washer returned `ok:true`, zero errors. `qa/overnight/integration/iteration-04-runtime/cleaning-runtime/pressure-washer-result.json` |
| Save/reload | PASS | Contract tests and real page-reload matrix passed with zero console/page/request errors. `qa/overnight/integration/iteration-04-runtime/save-reload/result.json` |
| Resource stabilization | PASS | Lifecycle tests passed. Runtime: 1,444 geometries, 258 renderer textures, 3,162 meshes, 703 materials, 59 GLB requests; no actionable diagnostic error. `qa/overnight/integration/iteration-04-runtime/resource-stabilization/runtime-asset-residency.json` |
| Resolution/FOV functional | PASS | Effective player FOV matched 50/60/75 at 1280×720, 1600×900, and 1920×1080; checkout stayed at its authored 50° FOV at all three resolutions; no listener growth. `qa/overnight/performance/final-v6-candidate/result.json` |
| Absolute player performance | **FAIL** | Canonical run failed 7/9 cases: 15.903–31.137 average FPS, 2.449 minimum 1% low, 408.4 ms worst. `qa/overnight/performance/final-v7-canonical/result.json` |
| Performance repeatability | **FAIL** | With identical production and stable 729 materials/639,859,944 estimated texture bytes, 4/9 v6 paired cases crossed relative thresholds. Matrix average FPS delta was only +0.411%, indicating large per-case headed variance. `qa/overnight/performance/final-v6-comparison.json` |
| Full Node suite | PASS | 1,669 pass, 0 fail, 3 skip; 1,672 tests in 1,236.911 seconds. `qa/overnight/integration/iteration-04-full-tests/integration-gates.json` |
| Dependency audit | **FAIL / WAIVER REQUIRED** | `npm audit --json`: one direct high-severity Electron finding aggregating advisories; installed Electron is 33.4.11 and the offered fix is semver-major 43.1.1. |

## Checkout blocker proof

Both strict branches fail at `scan and stage three physical products` with:

> Mouse wheel did not rotate u1's barcode toward the scanner (dot undefined).

The card flow history records these transitions in approximately 0.4 ms:

1. `WaitingForScan → ProductHeld` (`picked-product:u1`)
2. `ProductHeld → ProductScanning` (`ringing-product:u1`)
3. `ProductScanning → ProductScanned` (`bagged-product:u1`)

The blocked state has `u1.scanned=true` and `u1.staged=true` before the driver can send its first real mouse-wheel notch. This is a production interaction failure, not a stale camera or test-hook failure. Both branches retained five screenshots, Playwright video, and a separate VP9/Opus canvas recording with one live audio track and non-silent sample windows. Neither branch recorded a console error, page error, or non-aborted request failure.

## Performance baseline details

The production-tool editor run remained stable across reload:

- baseline: 118.48 average FPS, 117.65 1% low;
- final: 119.30 average FPS, 116.28 1% low;
- final/baseline ratios: 1.007 average, 0.988 1% low;
- stable post-reload samples: 1,658 geometries, 264 textures, 250 resources;
- final: 1,663 geometries and 264 textures, within the gate's bound.

The player-camera matrix is materially worse despite asset barriers, disabled organic walk-ins, locked time/weather, fixed camera, DPR 1, and a warm pass through every projection:

- canonical average FPS range: 15.903–31.137;
- minimum 1% low: 2.449 FPS;
- maximum frame: 408.4 ms;
- stable material count: 729;
- stable estimated mipmapped texture footprint: 639,859,944 bytes;
- event-listener growth: 0;
- effective player FOVs: exactly 50, 60, and 75;
- checkout authored FOV: exactly 50 at every resolution.

Absolute thresholds are average FPS ≥30, 1% low ≥12, and worst frame ≤100 ms. The paired comparison additionally fails relative changes below −10% average when corroborated by a low/worst regression, severe average changes below −20%, renderer/resource growth, or listener growth.

## Visual QA iterations

### Iteration 1 — inherited strict-checkout baseline

Evidence: `qa/overnight/baseline/checkout/card/` and `qa/overnight/baseline/checkout/cash/`, including audio-bearing video.

Visible/evidence weaknesses found:

1. The retained camera was outside on the course, not at the register.
2. No counter was visible.
3. No customer was visible.
4. No physical products were visible.
5. No scanner was visible.
6. No card reader or cash drawer was visible.
7. No receipt printer was visible.
8. No bagging surface was visible.
9. Card and cash evidence looked indistinguishable.
10. The failure occurred before any player-facing checkout action could be judged.

QA fix: derive the player stand from `clubhouse().interior.position` instead of a stale absolute world coordinate. Production was not changed.

### Iteration 2 — corrected checkout position

Evidence: `qa/overnight/iterations/02-checkout-position/checkout/card/` and `/cash/`.

Visible/interaction weaknesses found:

1. The first product auto-scanned on pickup; barcode rotation was bypassed.
2. The held product disappeared into staged state before wheel feedback.
3. The oversized customer body obscured much of the counter.
4. Customer proportions read as rough placeholder geometry.
5. Product silhouettes were small, pale, and difficult to identify.
6. The scanner target had weak visual affordance.
7. The card terminal was very small relative to the work surface.
8. The receipt printer's purpose was not visually obvious.
9. The secondary monitor was a featureless black rectangle.
10. Large areas of retail shelving were empty.
11. Cardboard boxes cluttered and occluded the counter/background.
12. Checkout props had limited value/contrast separation from the dark counter.

QA fix: retain the correct camera and make the strict wheel/drag assertion fail closed. Production weaknesses remain open.

### Iteration 3 — initial resolution/performance evidence

Evidence: `qa/overnight/performance/before/` and instrumentation-smoke roots.

Visible/evidence weaknesses found:

1. A `Click to play` veil contaminated retained walk-camera frames.
2. The frame showed the front-desk landing screen, not an active transaction.
3. There was no checkout customer.
4. There were no transaction products.
5. Payment-branch state was absent.
6. The initial report claimed draw calls and triangles of `1`, which represented only the last post-process pass.
7. Requested FOV values were recorded without verifying effective FOV.
8. Cashier-mode 50/60/75 images were identical because the authored checkout camera reset to 50°.
9. Organic walk-ins could change the scene between cases.
10. Lazy screen-dependent materials appeared during measured cases.
11. Short frame samples overreacted to 16.7/25 ms display-cadence quantization.
12. The matrix did not separate player FOV from checkout's authored FOV.

QA fixes: cumulative renderer sampling, effective-FOV assertions, player/cashier matrices, organic-walk-in suppression, asset barrier, full warm traversal, longer samples, and absolute thresholds.

### Iteration 4 — canonical editor and checkout review

Evidence: `qa/course_master_final/overnight-integration-gate/`, `qa/overnight/integration/iteration-04-checkout/`, and `qa/overnight/performance/final-v7-canonical/`.

Visible/product weaknesses found:

1. Physical barcode interaction remains absent in both payment branches.
2. The customer dominates the cashier view and blocks the placement belt.
3. Avatar face/body construction remains visibly placeholder-like.
4. Small white products lack readable product/packaging identity at play distance.
5. The scanner still lacks a strong illuminated target/read feedback.
6. The idle secondary display remains black and visually dead.
7. The POS screen text is dense and small at 1280×720.
8. Background shelves remain conspicuously empty.
9. Counter-adjacent boxes add clutter without improving the transaction read.
10. The bagging mat occupies a large foreground area but gives no progress feedback.
11. Editor water banks and stream edges are visibly jagged/blocky.
12. The editor's invalid object ghost can collapse to a tiny red ring and is hard to read.
13. Several editor top-bar labels truncate at 1600×900.
14. Repeated foliage shapes create visual noise and obvious patterning.
15. Terrain/fairway transitions are flat and low contrast from the flyover camera.

QA fixes: stable evidence capture and explicit gate outcomes only. These production-polish issues were not altered on the audit branch.

## Exact validation commands

```powershell
node --test --test-concurrency=1

node tools/qa/run-integration-gates.mjs `
  --base-url http://127.0.0.1:8469/ `
  --base 1dfb9de646c6785b027ddb023dda1e3a6af9a5c6 `
  --out qa/overnight/integration/<run> `
  --only <comma-separated-gates>

node tools/qa/compare-performance-runs.mjs `
  --before qa/overnight/performance/final-v6-baseline/result.json `
  --after qa/overnight/performance/final-v6-candidate/result.json `
  --out qa/overnight/performance/final-v6-comparison.json

node tools/qa/compare-integration-branch.mjs `
  --base 1dfb9de646c6785b027ddb023dda1e3a6af9a5c6 `
  --head HEAD `
  --expected-branch overnight/qa-audit `
  --qa-only `
  --out qa/overnight/branch-comparison.json
```

Allow at least 30 minutes for the complete serial Node suite; the measured run took 20 minutes 36.9 seconds.
