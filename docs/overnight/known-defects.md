# Overnight known defects

## Open blockers

None — all four audited blockers are resolved; see the table below and the per-defect notes.

## Resolved blockers (2026-07-23 recovery session)

| ID | Resolution |
| --- | --- |
| `PERF-001` | Absolute failure no longer reproduces. Headed canonical matrix (2026-07-23, `qa/recovery-2026-07-22/perf/headed-v9/result.json`): `ok: true`, 9/9 cases pass — average FPS 74.997–102.372 (threshold 30), 1% lows 30.075–40.08 (threshold 12), worst frame ≤33.4 ms (threshold 100 ms), zero console/page errors, `performanceFailures: []`. The interim rendering work (half-resolution GTAO, 10 Hz fitted sun shadows) resolved the regression; the harness itself had gone stale twice (menu `Continue` accessor; player left outside the front-desk radius before the cashier `E`), both fixed in `tools/qa/resolution-fov-performance.js`. Residual rider: the paired base/candidate *relative* comparison was not re-run — re-establish it the next time a rendering change needs an A/B gate. |
| `CHECKOUT-001` | Fixed in commit `12837c4`. The inherited tree had replaced the choreographed CLICK TO SCAN AND BAG with an instant direct-to-bag shortcut; the authored choreography was restored and the strict driver was ported to the current production payment/delivery contract (automatic insert + keypad exact entry with deterministic-approval proof; authored self-delivery of receipt and bag). Both strict branches pass end-to-end: `qa/recovery-2026-07-22/checkout-final-card2/` and `.../checkout-final-cash2/` (`ok: true`, full scan/payment/delivery logs). 391/391 targeted register/checkout tests; full suite 2279/2279. |
| `ASSET-051-100-001` | Resolved by the exit condition's second branch: consolidated bindings supersede the 13 per-asset modules. All 30 sheet 08–10 assets are defined inline in `sheet08/09/10Manifest.js` via `defineBinding`, registered through `assetsRegistry.js` (binary-parsed by `tests/assets-51-100-runtime-bindings.test.js`, green), and individually placed in the scene by `propPlacement.js` `PLACED_ASSET_NUMBERS` (61–100 inclusive; imported by `clubhouse.js`/`fixtures.js`). `node tools/qa/assets-51-100-status.mjs` (2026-07-23): 50/50 registry-bound, 50/50 scene-mounted, 50/50 clean-reimport passed, 0 missing sockets/animations, statusTally "Verified complete": 50. |
| `SEC-ELECTRON-001` | Resolved by upgrade: the lock now resolves Electron `^39.8.10` and `npm audit` (full and `--omit=dev`, 2026-07-23) reports 0 vulnerabilities. Full app/test matrix rerun green (2279/2279). |

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

**RESOLVED 2026-07-23** — see the resolved-blockers table. Root cause was the reverse of the original observation by fix time: a later merge replaced the choreographed scan with a direct-to-bag shortcut, and the strict driver additionally pinned two since-removed contracts (card swipe; manual receipt/bag drags). The authored choreography was restored in production and the driver ported to the real contracts, with no weakening of the physical scan-hold/barcode-evidence assertions (commit `12837c4`).

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

**RESOLVED 2026-07-23** — consolidated in-manifest bindings supersede the per-asset modules; see the resolved-blockers table for the verification evidence.

### `SEC-ELECTRON-001` — direct Electron advisory

`npm audit --json` reports one direct high-severity vulnerable package entry for Electron `<=39.8.4`; the lock resolves Electron 33.4.11. The offered automatic resolution is Electron 43.1.1 and is semver-major. No dependency was changed on the QA branch.

**RESOLVED 2026-07-23** — Electron now resolves to `^39.8.10` (above the advisory's `<=39.8.4` range) and `npm audit` reports 0 vulnerabilities; see the resolved-blockers table.

## Open advisories

| ID | Severity | Summary | Recommendation |
| --- | --- | --- | --- |
| `CLEAN-SCUFF-001` | **RESOLVED 2026-07-23** (was P1 — campaign-blocking) | Confirmed real, two stacked causes: the floor-cleaning gate refused tool contact against architecture/inside fixture footprints, and the cloth/spray hook swallowed the contact entirely whenever its floor-plane aim failed or was blocked — wall-mounted targets were unreachable by construction. Fixed by (1) forwarding tool contact to the discrete-target map BEFORE the floor gate in `cleanWithTool` (one forward site, every tool class), and (2) the hook falling through with the tool's own socket contact when the floor aim is unusable, with hints only when contact does nothing. | Verified: close-stand wall wipe probe verdict `player-liftable` (spray 0.28 → cloth 1.0); NW corner cobweb clears through the carton footprint; 58/58 cleaning suites; loop-driver details improved 10/14 → 12/14 → full validation in the phase-2 acceptance run. |
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
| `QA-ASSET-REPORT-001` | Per-gate asset reports now expose the selected gate as top-level `ok` and preserve the combined result as `aggregateOk`, matching report semantics to the process exit code. |
