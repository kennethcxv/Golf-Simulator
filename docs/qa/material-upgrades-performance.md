# Construction finish performance QA

## Result

The integrated construction-finish library passes all 32 predeclared performance gates. The accepted comparison uses three matched runs from the exact pre-change commit and three matched runs from the final implementation on the same machine, browser configuration, viewport, camera, and gameplay state.

- Baseline commit: `1dfb9de`
- Branch under test: `feature/material-upgrades`
- Viewport: 1600 x 900, device scale factor 1
- Aggregation: per-field median across `run01`, `run02`, and `run03`
- Scenarios: fixed idle exterior view, active vacuum, and active pressure washer
- Accepted baseline: `qa/assets/material-upgrades-performance/matched-before/run01..03/runner-result.json`
- Accepted implementation: `qa/assets/material-upgrades-performance/final-v3-after/run01..03/runner-result.json`
- Comparison: `qa/assets/material-upgrades-performance/accepted-final-comparison/sheet06-performance-comparison.json`
- Outcome: 32 passed, 0 failed

The performance runner preserves its frozen inherited scenario source and only accepts `QA_BASE_URL` as a runtime-origin override. This lets the exact same scripted workload target the detached baseline server and the feature server without changing camera positions, timings, tool states, sampling duration, or thresholds.

## Matched medians

| Scenario | Metric | Before | After | Change |
| --- | ---: | ---: | ---: | ---: |
| Idle exterior | Average FPS | 18.79 | 26.00 | +38.4% |
| Idle exterior | 1% low FPS | 8.68 | 18.47 | +112.8% |
| Idle exterior | Worst frame | 130.5 ms | 58.3 ms | -55.3% |
| Vacuum active | Average FPS | 71.15 | 115.20 | +61.9% |
| Vacuum active | 1% low FPS | 38.99 | 65.08 | +66.9% |
| Vacuum active | Worst frame | 27.7 ms | 16.8 ms | -39.4% |
| Pressure washer active | Average FPS | 23.61 | 31.51 | +33.4% |
| Pressure washer active | 1% low FPS | 18.43 | 24.04 | +30.4% |
| Pressure washer active | Worst frame | 58.3 ms | 41.7 ms | -28.5% |

The non-throughput gates also pass. Event listeners remain exactly 91. The median idle scene is 5,044 nodes against a 5,478-node ceiling, with 1,691 resident geometries, 680 materials, and 191 renderer textures. Vacuum UI activity is 7.98 mutations/second against the fixed 9.22 ceiling; the pressure-washer route remains at exactly zero measured UI mutations.

## Memory and residency

| Measurement | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Effective-scene textures | 175 | 170 | -5 |
| Conservative allocated texture estimate | 591.20 MB | 589.53 MB | -1.67 MB |
| Renderer-resident textures | 258 | 250 | -8 |
| Effective Sheet 6 instances | 909 | 642 | -267 |
| Effective Sheet 6 triangles | 233,072 | 200,900 | -32,172 |
| New Sheet 6 shadow casters | 0 | 0 | 0 |

Texture memory is a deterministic conservative estimate based on image dimensions, RGBA8 allocation, and a full mip chain (or compressed mip byte lengths where exposed); Three.js does not expose authoritative GPU byte residency. Evidence is in `qa/assets/material-upgrades-performance/texture-before.json` and `texture-after.json`.

Median JavaScript heap usage is bounded at 77.11 to 92.30 MB for idle (+19.70%), 95.17 to 108.11 MB for vacuum (+13.59%), and 96.31 to 94.78 MB for pressure washing (-1.59%). The idle/vacuum increase is the expected retained authored construction library rather than repeated state growth: listener count is unchanged, repeated visual updates are signature-gated, and template-library nodes are detached from the live scene after production assembly.

## Runtime safeguards

- Source GLB template roots are retained for variant resources but detached after the production scene is assembled, avoiding hidden-node traversal and rendering overhead.
- Architecture, assembly, and direct-construction signatures prevent dirt/grime simulation ticks from rebuilding unchanged finish geometry, door state, garage state, or lighting state.
- Repeated instanced variants are idempotent, and flooring geometry, material, and matrices are recomputed only when the selected finish or source resource actually changes.
- Direct door, garage, and landscape-light diagnostics reuse unchanged selection results.

These optimizations preserve the player-facing result: final visual QA, normal-control purchase/reload runs, and the recorded lighting purchase sequence use the same production runtime measured here.

## Rejected captures

Superseded exploratory sets under `qa/assets/material-upgrades-performance/` are not accepted comparison inputs. In particular, the `final-v2-after` set contained an isolated external 405.6 ms scheduling stall. The entire set was rejected rather than selecting favorable samples; the final `final-v3-after` three-run set was captured cleanly and used in full. Earlier captures taken while another performance process was active were also rejected as contaminated.
