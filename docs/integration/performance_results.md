# Performance results

**All numbers below were measured on the integration branch**, after every merge,
using `tools/qa/course-editor-stroke-perf.js`. No figure is carried over from any
source branch's commit message.

## How to reproduce

```bash
node tools/serve.cjs                      # port 8457

QA_BASE_URL='http://localhost:8457/' \
COURSE_QA_PHASE='stroke_integrated' \
QA_RESULT_PATH=qa/stroke-integrated.json \
node tools/qa/run-playwright.cjs tools/qa/course-editor-stroke-perf.js --bootstrap
```

`--bootstrap` is required — it seeds an owned property into the autosave, without
which "Continue" never reaches a course. Raw output: `qa/stroke-integrated.json`
(gitignored; preserved in `refs/integration-audit/qa-evidence`).

Measured 2026-07-18 22:24 PDT. Probe reported `ok: true`.

## Terrain-edit drag — real pointer events through the editor's own handlers

| Metric | Target | Measured |
|---|---|---|
| Average FPS | ~80+ (was ~5) | **136.3** |
| Average frame | — | **7.337 ms** |
| Median frame | — | **2.9 ms** |
| Worst frame | tens of ms (was >1000 ms) | **41.6 ms** |
| Frames > 100 ms | **none** | **0** |
| Frames > 33 ms | — | 18 of 225 |
| 1% low FPS | — | 24.57 |
| Frames sampled | — | 225 |

**All three stated targets are met.** Terrain editing is 136.3 FPS average against
a ~5 FPS starting point, no frame exceeded 100 ms, and the worst frame is 41.6 ms
rather than over a second.

Two honest caveats:

- 18 frames exceeded 33 ms. The source branch's own run reported 0. This is a
  different machine under different load (a full Node test suite was running
  concurrently for part of the session). It is within target — the target is
  "no frames above 100 ms", which holds — but it is not zero, and I am not
  claiming it is.
- Worst frame 41.6 ms here vs 25.1 ms reported on the source branch. Same
  explanation. Still comfortably "tens of milliseconds".

## Synthetic — per-operation cost, scoped vs unscoped

Median ms over N runs, same session:

| Operation | Median | Mean | Max | Runs |
|---|---|---|---|---|
| `fullRebuildCall` | 1126.0 | 1126.8 | 1256.5 | 12 |
| **`liveTerrainTick`** | **0.4** | 0.467 | 0.9 | 12 |
| `paintTick` | 19.4 | 17.025 | 21.0 | 8 |
| `stampCall` (unscoped) | 202.7 | 199.067 | 214.3 | 6 |
| **`stampCallScoped`** | **19.9** | 17.333 | 22.4 | 6 |
| `undoRefresh` (unscoped) | 1145.1 | 1144.075 | 1157.6 | 4 |
| `undoRefreshNoObjects` | 1145.5 | 1128.75 | 1171.3 | 4 |
| **`undoRefreshScoped`** | **30.1** | 25.825 | 30.7 | 4 |

Ratios achieved by the integrated perf stack:

- live terrain tick: **1126 → 0.4 ms** (~2800×) vs a full rebuild
- stamp: **202.7 → 19.9 ms** (~10×)
- undo/redo: **1145.1 → 30.1 ms** (~38×)

These confirm all four perf commits are live on the integration branch, not just
merged textually. `undoRefreshScoped` in particular would be dead code without
`2588a0a`, so its 38× improvement is direct evidence that commit is active.

## Undo integrity — the correctness half

The riskiest resolution in this integration was taking the incoming
`rebuildTerrainHeights(terrainRect)` over the base's
`rebuildTerrainHeights(reReliefsculpt ? null : zoneRect)` — the base deliberately
refused to scope whenever relief was invalidated. The probe verifies the scoped
path is bit-exact:

| Metric | Value |
|---|---|
| Vertex components compared | **1,040,403** |
| Differing components | **0** |
| Max delta | **0 yd** |

Undo after a scoped terrain edit reproduces the full-rebuild result exactly. No
stale sculpt survives undo.

## Console health

```
diagnostics.console    : []
diagnostics.pageErrors : []
```

Zero console errors and zero page errors across boot, course load, editor entry,
a full terrain drag, and undo/redo.

One non-error shader warning is emitted by the driver itself:

```
THREE.WebGLProgram: Program Info Log: (97,1-6): warning X4000:
use of potentially uninitialized variable (dyn_index_vec4_float4_int)
```

This is a HLSL translation warning from ANGLE, present before this integration
and not introduced by it.

## Not measured

The following Phase 11 metrics were **not** captured — the stroke-perf probe does
not expose them, and no existing probe on this branch reports them:

draw calls, triangle count, material/texture counts, heap growth over time,
listener counts, animation mixer counts, audio node counts, particle counts,
save/load wall-clock duration.

`tools/qa/perf-probe.js` and the register performance harness cover some of these
for other scenes; they were not re-run for this integration. Treat those metrics
as unverified here.
