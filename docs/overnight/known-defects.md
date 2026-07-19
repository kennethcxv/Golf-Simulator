# Overnight known defects

## Open blockers

| ID | Severity | Gate | Summary | Exit condition |
| --- | --- | --- | --- | --- |
| `CHECKOUT-001` | P0 | `checkout-card`, `checkout-cash` | Pickup auto-scans and auto-stages the first product before physical barcode rotation/drag. | Both strict branches complete through receipt, bagging, and handoff with normal controls and retained video. |
| `PERF-001` | P1 | `resolution-fov`, `performance-comparison` | Player-camera shop performance misses absolute thresholds and is non-repeatable across headed paired runs. | Every matrix case passes absolute thresholds and an immutable base/candidate pair passes relative thresholds on an isolated GPU. |
| `ASSET-051-100-001` | P1 | `assets-51-100` | Thirteen manifest-declared runtime binding modules do not exist. | Add the bindings, or deliberately revise the authoritative manifest and owning tests if consolidated bindings supersede them. |
| `SEC-ELECTRON-001` | P1 | release security | Electron 33.4.11 produces one direct high-severity npm audit finding aggregating multiple Electron advisories. | Upgrade to a supported patched Electron line and rerun the app/test matrix, or obtain an explicit time-bounded security waiver. |

### `CHECKOUT-001` — physical scan bypass

Reproduction:

```powershell
$env:QA_BASE_URL='http://127.0.0.1:8469/'
$env:HEADED='1'
$env:REGISTER_QA_ROOT='qa/overnight/repro/checkout'
$env:VIDEO_DIR='qa/overnight/repro/checkout/video'
node tools/qa/run-playwright.cjs tools/qa/register-acceptance-card.js --bootstrap
node tools/qa/run-playwright.cjs tools/qa/register-acceptance-cash.js --bootstrap
```

Observed on both branches:

- blocker step: `scan and stage three physical products`;
- error: `Mouse wheel did not rotate u1's barcode toward the scanner (dot undefined)`;
- `WaitingForScan → ProductHeld → ProductScanning → ProductScanned` occurs in about 0.4 ms;
- `u1` is already `scanned=true, staged=true`;
- no transaction is banked and the customer remains waiting;
- console/page/non-aborted request errors: zero.

Evidence: `qa/overnight/integration/iteration-04-checkout/`.

Owner suggestion: checkout/register interaction owner. Do not fix by weakening the strict driver or substituting the simplified click-to-scan flow.

### `PERF-001` — absolute and repeatability failure

Canonical absolute run, RTX 5080 / Chrome 150 / DPR 1:

- 7 of 9 cases failed;
- average FPS range: 15.903–31.137;
- minimum 1% low: 2.449 FPS;
- maximum frame: 408.4 ms;
- stable 729 materials and 639,859,944 estimated mipmapped texture bytes;
- listener growth: 0;
- effective FOV: exact 50/60/75;
- cashier authored FOV: 50 at all resolutions.

Paired v6 comparison with unchanged production:

- matrix-average FPS delta: +0.411%;
- matrix-average 1% low delta: −12.818%;
- matrix-average worst-frame delta: +40.372%;
- 4 of 9 cases crossed relative thresholds despite stable resources.

Evidence: `qa/overnight/performance/final-v7-canonical/result.json` and `qa/overnight/performance/final-v6-comparison.json`.

Owner suggestion: rendering/performance owner. Profile player-camera shop rendering on an otherwise idle machine; preserve the fixed fixture and do not compare a warm candidate against a cold base.

### `ASSET-051-100-001` — missing declared bindings

Missing files:

1. Asset 75 — `src/render3d/assets51to100/asset_075_dustpan.js`
2. Asset 76 — `src/render3d/assets51to100/asset_076_cleaning_spray_bottle.js`
3. Asset 77 — `src/render3d/assets51to100/asset_077_cleaning_cloth_and_sponge_set.js`
4. Asset 80 — `src/render3d/assets51to100/asset_080_trash_bag.js`
5. Asset 85 — `src/render3d/assets51to100/asset_085_office_telephone.js`
6. Asset 88 — `src/render3d/assets51to100/asset_088_key_rack.js`
7. Asset 91 — `src/render3d/assets51to100/asset_091_fire_extinguisher.js`
8. Asset 92 — `src/render3d/assets51to100/asset_092_first_aid_kit_cabinet.js`
9. Asset 93 — `src/render3d/assets51to100/asset_093_security_camera.js`
10. Asset 94 — `src/render3d/assets51to100/asset_094_exit_sign.js`
11. Asset 95 — `src/render3d/assets51to100/asset_095_emergency_light.js`
12. Asset 97 — `src/render3d/assets51to100/asset_097_key_cabinet.js`
13. Asset 98 — `src/render3d/assets51to100/asset_098_hand_sanitizer_station.js`

All required source/reference/runtime artifacts exist, literal runtime paths resolve, and all 58 declared GLBs cleanly reimport. The failure is specifically the manifest-to-binding contract.

### `SEC-ELECTRON-001` — direct Electron advisory

`npm audit --json` reports one direct high-severity vulnerable package entry for Electron `<=39.8.4`; the lock resolves Electron 33.4.11. The offered automatic resolution is Electron 43.1.1 and is semver-major. No dependency was changed on the QA branch.

## Open advisories

| ID | Severity | Summary | Recommendation |
| --- | --- | --- | --- |
| `SHADER-WARN-001` | P2 | ANGLE emits X4000, potentially uninitialized `dyn_index_vec4_float4_int`, on every tested boot. No broken program or GL error was observed. | Identify the generated shader/material and initialize the dynamic index path; keep warning visible until removed. |
| `QA-BASE-001` | P2 | Required named base ref and all Git remotes are absent. Audit used common SHA `1dfb9de…`. | Create/push the authoritative base ref and verify its SHA before integration. |
| `QA-PORTABILITY-001` | P2 | 79 legacy QA files retain port 8457 without `QA_BASE_URL`; 47 contain the original absolute repository path. | Convert incrementally. The integration-critical registry scripts are already worktree-safe and covered by tests. |
| `QA-ELECTRON-SAVE-001` | P2 | `tools/qa-electron-saves.mjs` still targets FAIRWAY STATE names, paths, UI labels, and state APIs. It is not a valid Golf Flipper native-save gate. | Rewrite against current product name, target URL, storage keys, UI controls, and state model before claiming native Electron save acceptance. |
| `MEMORY-001` | P2 | Residency estimates 639,859,944 mipmapped texture bytes and 543,948,800 decoded RGBA bytes retained across 111 decoded images. | Establish platform budgets and measure GPU/process memory on target minimum hardware. Current gate proves stabilization, not budget compliance. |
| `VIS-CHECKOUT-001` | P2 | Customer scale/proportions, tiny products/terminal, black secondary display, sparse shelves, counter clutter, and weak scanner feedback reduce production polish. | Resolve after `CHECKOUT-001`, then repeat four-loop visual QA from the player camera. |
| `VIS-EDITOR-001` | P2 | Jagged water edges, low-contrast terrain transitions, repetitive foliage, truncated top labels, and weak invalid-object ghost readability remain. | Address in an editor visual-polish branch after checkout acceptance. |

## Resolved QA defects in this branch

| ID | Resolution |
| --- | --- |
| `QA-REGISTER-POSITION-001` | Strict driver now derives the cashier stand from the live interior transform; normal `E` reaches the register. |
| `QA-WORKTREE-001` | Integration-critical drivers honor `QA_BASE_URL` and write beneath `process.cwd()` or caller-provided roots. |
| `QA-REIMPORT-EVIDENCE-001` | Sheet-6 clean Blender report regenerated: 10/10 assets, all mandatory checks and two cross-asset checks green. |
| `QA-BLENDER-DISCOVERY-001` | Gate runner resolves `BLENDER_BIN` or installed Blender Foundation versions instead of assuming `blender` is on PATH. |
| `QA-FOV-MATRIX-001` | Probe now records effective FOV, separates player and authored cashier cameras, disables organic walk-ins, waits asset barriers, warms all cases, and samples cumulative renderer work. |
