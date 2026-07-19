# Overnight integration gates

## Policy

An integration candidate may merge only when every mandatory gate is green against an immutable base and the candidate worktree is clean. A red gate cannot be replaced by compilation, unit tests, a simplified browser driver, or a screenshot. A waiver must name the exact gate, risk, owner, expiry, and rollback trigger.

The executable registry is `tools/qa/run-integration-gates.mjs`. It runs gates sequentially, retains stdout/stderr per step, continues across independent gate failures, and emits `integration-gates.json` plus `integration-gates.md`.

## Prerequisites

- isolated candidate worktree and branch;
- immutable base commit, not a moving branch name;
- Node 22 or newer;
- installed Chrome usable by Playwright;
- Blender 5.1, found through `BLENDER_BIN` or the newest `Program Files/Blender Foundation/Blender */blender.exe`;
- unique server port;
- at least 30 minutes for the serial full-test gate;
- no other headed GPU benchmark during performance collection.

`--start-server` refuses an already occupied URL so a candidate cannot silently test another worktree's server.

## Canonical workflow

### 1. Capture an immutable performance baseline

Serve the immutable base worktree on a unique port, then invoke the QA-branch probe against it:

```powershell
# In the base worktree
$env:PORT='8470'
node tools/serve.cjs

# In the QA/candidate tooling worktree
$env:QA_BASE_URL='http://127.0.0.1:8470/'
$env:RESOLUTION_FOV_QA_ROOT='qa/overnight/integration/base-performance'
$env:QA_PERF_PHASE='base'
$env:QA_PERF_SAMPLE_MS='3000'
$env:HEADED='1'
node tools/qa/run-playwright.cjs tools/qa/resolution-fov-performance.js --bootstrap
```

Archive `qa/overnight/integration/base-performance/result.json` with the immutable base SHA.

### 2. Run the candidate gates

```powershell
node tools/qa/run-integration-gates.mjs `
  --start-server `
  --port 8471 `
  --base <immutable-base-sha> `
  --performance-baseline qa/overnight/integration/base-performance/result.json `
  --out qa/overnight/integration/candidate
```

The performance-comparison gate expects the `resolution-fov` gate in the same run. Use `--only` for a bounded rerun, for example:

```powershell
node tools/qa/run-integration-gates.mjs `
  --start-server --port 8471 `
  --base <immutable-base-sha> `
  --performance-baseline qa/overnight/integration/base-performance/result.json `
  --out qa/overnight/integration/candidate-perf `
  --only resolution-fov,performance-comparison
```

List registry metadata without running anything:

```powershell
node tools/qa/run-integration-gates.mjs --list
```

## Mandatory contracts

| Gate ID | Acceptance contract | Primary evidence |
| --- | --- | --- |
| `boot` | Normal `Continue` reaches the live game, clubhouse, hidden veil, and non-lost WebGL context. | Browser result JSON |
| `console` | No console errors, page errors, or non-aborted request failures during normal boot. | Browser diagnostics |
| `shaders` | No unrunnable WebGL program, shader compile/link error, GL error, or lost context; real draw occurs. | Shader result and screenshot |
| `editor-tools` | Every production-tool checkpoint passes through normal UI; save/reload restores authored results; screenshots and headed video exist. | Checkpoints, 16 captures, video |
| `editor-performance` | Real terrain drag completes; scoped undo geometry equals a full rebuild; no page/console error. | Raw deltas and integrity record |
| `checkout-card` | Strict physical barcode rotation/drag, mouse card swipe, receipt tear, bagging, and customer handoff complete once. | Strict driver JSON, screenshots, VP9/Opus video |
| `checkout-cash` | Strict physical scan, cash acceptance, exact change, receipt tear, bagging, and customer handoff complete once. | Strict driver JSON, screenshots, VP9/Opus video |
| `assets-1-50` | Exact ordered range, unique IDs/stems, required source/reference/runtime artifacts, and every declared binding present. | Manifest audit JSON |
| `assets-51-100` | Same contract for 51–100. | Manifest audit JSON |
| `glb-clean-reimport` | Every declared GLB imports in factory-startup Blender with zero errors or warnings. | Blender report JSON |
| `runtime-paths` | Every literal runtime asset reference resolves to a file inside the repository. | Runtime-path audit JSON |
| `cleaning-sockets` | Tool registry and authored socket/pivot contracts pass. | Node tests |
| `cleaning-occlusion` | First-person tool occlusion and nozzle origin contracts pass. | Node tests and pressure-washer JSON |
| `cleaning-wetness` | Wetness, solution, grime, dry-cloth refusal, and persistence behave deterministically. | Node tests and live cleaning JSON |
| `cleaning-debris` | Broom conserves debris, consolidation is bounded, pickup transfers mass, and save serialization survives. | Node tests and live cleaning JSON |
| `cleaning-runtime` | Live broom, dustpan, vacuum, mop, spray, cloth, pressure washer, and unequip smoke return `ok:true`. | Browser JSON/screenshots |
| `save-reload` | Checkout and cleaning state survive actual page reload without duplicate banking, lost tender, or lost cleaning state. | Matrix JSON and contract tests |
| `resource-stabilization` | Lifecycle disposals pass; renderer resources and network resource count stabilize after reload/churn. | Tests and residency JSON |
| `resolution-fov` | Effective player FOV equals 50/60/75 at 1280×720, 1600×900, 1920×1080; cashier remains at authored FOV; no context/error/listener failure; absolute performance thresholds pass. | 12 screenshots plus metrics JSON |
| `performance-comparison` | Candidate stays inside relative frame-pacing and renderer/resource thresholds versus the immutable base report. | Comparison JSON |
| `full-tests` | Complete serial Node suite has zero failures. | TAP log and gate report |
| `branch-isolation` | Base resolves and is ancestor, expected branch is checked out, worktree is clean, and a QA-only branch changes no runtime path. | Branch comparison JSON |

## Performance thresholds

Absolute per case:

- average FPS ≥30;
- 1% low FPS ≥12;
- worst frame ≤100 ms;
- zero WebGL errors or lost contexts;
- effective FOV matches requested FOV within 0.01°;
- active event-listener growth ≤2.

Relative candidate versus base:

- average FPS below −10% fails when corroborated by a 1% low below −15% or a worst-frame increase above 25% and 5 ms;
- average FPS below −20% fails alone;
- draw calls: no increase above max(5 calls, 5%);
- triangles: no increase above max(1,000, 5%);
- unique materials: growth ≤2;
- estimated mipmapped texture bytes: growth ≤4 MiB;
- JS heap: growth ≤20 MiB;
- active event listeners: growth ≤2.

An uncorroborated cadence-only shift is retained as a warning. Repeated broad variance on unchanged production is still a red repeatability/environment gate; do not average it away.

## Asset-manifest rules

- A canonical/runtime SHA mismatch is advisory because an intentional optimized runtime GLB may differ.
- A missing source, reference, runtime GLB, escaped path, duplicate ID/stem, incomplete range, or missing declared runtime binding is mandatory red.
- If a declared per-asset binding was superseded by a consolidated manifest, update the authoritative spec and tests in the owning asset branch. Do not waive a path that the spec still declares required.
- For a CLI-selected asset gate, top-level `ok` describes that selected gate; `aggregateOk` retains the combined 1–100/path result. This keeps standalone reports consistent with their process exit code.

## Checkout non-substitution rule

The strict gates must use `register-acceptance-card.js` and `register-acceptance-cash.js`. The simplified register tests are useful for save/reload and regression coverage but cannot accept physical scanning, card movement, cash handling, receipt, bagging, or handoff.

## Evidence requirements

For every browser visual gate retain:

- before and after screenshots from fixed cameras;
- structured console/page/request diagnostics;
- functional result JSON;
- headed video for comprehensive editor and checkout acceptance;
- audio-bearing canvas video for checkout;
- environment, viewport, DPR, fixture, and camera/FOV metadata;
- performance metrics and raw or sufficiently detailed frame data.

Do not treat `/qa/` evidence as durable merely because it exists locally; the directory is ignored. Upload it to the integration artifact store or preserve the worktree until review closes.

## Waiver format

A waiver is valid only when all fields are present:

```text
Gate:
Defect ID:
Reason integration must proceed:
User-visible and data-loss risk:
Evidence reviewed:
Owner:
Expiry date or commit:
Rollback trigger:
Approver:
```

Checkout card/cash cannot be jointly waived with a generic “unit tests pass” statement. Security and performance waivers must be independent.
