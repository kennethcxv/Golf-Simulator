# Golf gameplay performance comparison

The before and after decision captures use system Chrome 150, a 1600 x 900 viewport, repository-default quality, the same first-tee camera and lighting, an eight-second warm-up, and three five-second samples per scenario. Raw samples and screenshots are retained beside each JSON report.

The baseline active scene contains eight legacy ambient golfers. The final active scene is deliberately heavier and more representative: four canonical parties, nine named golfers, two assigned carts, live equipment, course facilities, and bounded ball/shot presentation.

## Decision sample

| Metric (median) | Baseline, 8 ambient golfers | Final, 9 canonical golfers + 2 carts | Change |
| --- | ---: | ---: | ---: |
| Average FPS | 120.00 | 119.60 | -0.3% |
| 1% low FPS | 117.42 | 86.71 | -26.2% |
| Worst frame | 8.6 ms | 16.7 ms | +8.1 ms |
| Draw calls | 3,236 | 3,342 | +3.3% |
| Rendered triangles | 10,097,192 | 10,597,108 | +5.0% |
| Scene triangles | 1,781,371 | 1,847,846 | +3.7% |
| Materials | 269 | 282 | +4.8% |
| Textures | 163 | 163 | 0.0% |
| Estimated texture bytes | 6,169,904,533 | 6,169,904,533 | 0.0% |
| JS heap | 114,807,872 | 80,125,016 | -30.2% |
| UI callbacks / second | 120.2 | 119.8 | -0.3% |

Final active raw runs averaged 120.0, 119.6, and 119.39 FPS. The 1% low and worst-frame percentage gates miss the deliberately strict near-120-FPS baseline tolerance, but the final medians still remain above 60 FPS and at or below one 60 Hz frame. There is no sustained throughput regression.

## Idle scene

| Metric (median) | Baseline | Final | Change |
| --- | ---: | ---: | ---: |
| Average FPS | 119.99 | 117.60 | -2.0% |
| Draw calls | 2,436 | 2,698 | +10.8% |
| Rendered triangles | 10,076,936 | 9,957,304 | -1.2% |
| Scene triangles | 1,777,411 | 1,739,088 | -2.2% |
| Materials | 219 | 235 | +7.3% |
| Textures | 163 | 160 | -1.8% |

Two idle samples each contained one late-load/host scheduling stall; the third ran at 120 FPS with a 113.42 FPS 1% low. The active samples after that transition were stable. Additional reruns made during heavy host contention are retained as `after-live-host-noise*.json` rather than substituted for the controlled decision run.

## Scaling and leak checks

- Ball presentation uses a fixed 24-instance mesh and one fixed trajectory line draw call.
- Persisted presentation history is capped at 32 shot records.
- Course parties use near/mid/far simulation tiers; only five characters were in the final camera frustum while all nine canonical golfer visuals were present.
- Facility, bag, club, basket, and starter GLB parts are consolidated by material while preserving asset roots, real dimensions, pivots, UVs, colliders, and material separation.
- Active listeners were 96 before and after the repeated idle/live route; listener delta was 0 and registration delta was 0.
- Texture count and estimated texture memory did not grow under the live fixture.
- The final live heap was lower than baseline and showed no monotonic growth across repeated interactions.

## Evidence

- Baseline: `baseline/performance/before-main.json`
- Final decision run: `final/performance/after-live.json`
- Final fixed-camera screenshots: `final/performance/after-live-idle.png` and `after-live-ambient.png`
- Rejected host-noise reruns: `final/performance/after-live-host-noise.json`, `after-live-host-noise-2.json`, and `after-live-host-noise-3.json`
