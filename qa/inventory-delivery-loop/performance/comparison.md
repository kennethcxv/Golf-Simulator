# Inventory delivery performance comparison

Outcome: **PASS**. Three acceptance-ready candidate runs were compared by
median against the clean-main `0c5137e` baseline at the same 1600 x 900 camera
poses. Every candidate run reconciled inventory, retained one customer-held
unit, reported zero listener growth, and captured no console errors, page
errors, or non-aborted request failures.

The fixture covers nine simultaneous boxes, all 25 retail lines filled before
the held-product pick, one real customer-held glove, opened visible contents,
a player-carried armful, a normal-control shelf update, five laptop cycles, and
100 full-state serializations per run.

## Median comparison

| Metric | Clean main | Candidate median | Change |
| --- | ---: | ---: | ---: |
| Stress average FPS | 145.73 | 181.39 | +24.47% |
| Stress 1% low FPS | 56.24 | 118.81 | +111.26% |
| Stress worst frame | 27.8 ms | 8.5 ms | -69.42% |
| Stress draw calls | 2,083.81 | 2,189 | +5.05% |
| Rendered triangles | 6,879,226 | 6,896,778 | +0.26% |
| Scene triangles | 2,121,665 | 2,189,575 | +3.20% |
| Materials | 250 | 283 | +13.20% |
| Textures | 182 | 183 | +0.55% |
| Estimated texture memory | 6,059.73 MiB | 6,060.73 MiB | +0.02% |
| Sampled JS heap | 84.08 MiB | 74.15 MiB | -11.81% |
| Renderer geometries | 1,178 | 1,082 | -8.15% |
| Scene objects | 1,497 | 1,703 | +13.76% |
| Visible meshes | 1,235 | 1,357 | +9.88% |
| Idle average FPS | 150.35 | 181.70 | +20.85% |
| Idle 1% low FPS | 74.96 | 119.05 | +58.82% |
| Idle worst frame | 13.9 ms | 8.4 ms | -39.57% |
| Idle draw calls | 1,923 | 2,041 | +6.14% |
| Idle materials | 252 | 289 | +14.68% |
| Idle textures | 174 | 184 | +5.75% |

Candidate-only workload medians were 60.6 ms for the complete nine-order
submission, arrival, and one batched stock/box rebuild; 3.528 ms average, 4.6
ms p95, and 5.9 ms worst for full-state serialization; and 0.98 MiB forced-GC
heap growth. The post-interaction idle prompt mutation rate was zero.

The arrival number is an intentionally conservative wall-clock envelope around
all nine order submissions plus unloading and both renderer rebuilds. It is not
substituted for a frame sample; the separately sampled warm worst frame was 8.5
ms. All three arrival samples were 65 ms or less.

## Acceptance envelope

- Average and 1% low FPS may not regress by more than 10%.
- Worst-frame time may not increase by more than 20%.
- Draw calls, triangles, materials, textures, and scene-resource counts may not
  increase by more than 15%.
- The complete nine-order arrival/rebuild must stay at or below 75 ms.
- Serialization must stay below 10 ms average and 15 ms p95.
- Median forced-GC growth must stay at or below 5 MiB.
- Listener growth, runtime errors, and reconciliation discrepancies must be zero.

The largest resource increase is idle material count at 14.68%, inside the
15% envelope. Frame pacing improved rather than regressed, and all remaining
gates pass. Raw samples are retained in `final-run-1/`, `final-run-2/`, and
`final-run-3/`; machine-readable aggregation is in `comparison.json`.

The clean-main result marked itself not acceptance-ready only because the older
harness counted nine expected aborted optional-GLB fallback probes as request
failures. It had zero console/page errors, and its frame/resource numbers are
still the fixed baseline used above. Candidate diagnostics classify those known
fallback probes and still reject every non-aborted failure.
