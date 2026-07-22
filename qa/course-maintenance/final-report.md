# Course maintenance vertical slice — final report

## Result

The release candidate delivers a complete groundskeeping day on data-selected
Hole 4. The player reviews a physical work board, inspects real one-yard turf
state, selects and operates equipment through normal first-person controls,
performs every requested maintenance task, sees localized before/after effects,
raises the real condition score from 62 to 75, saves, reloads, and receives a
verified 15/15 work-order state.

The implementation stays on `overnight/course-maintenance`, does not merge to
`main`, does not redesign the nine-hole course, and does not rewrite the editor.

## Delivered loop

- Data-driven hero selection and seven-surface, one-yard region model.
- Toggleable tablet/overlay inspection for height, target, moisture, health,
  fertilizer, disease, issues, bunker state, and recent maintenance.
- Push greens mower and existing tractor with start/stop, blade engagement,
  path cutting, target heights, visible overlap/misses/stripes, speed quality,
  wrong-surface feedback, particles, and audio loops.
- Local hose and sprinkler coverage with wetness, dry turf, overwatering,
  weather drying, controller/head state, and hourly persistence.
- Path-based rotary spreading with inventory, pending release, application
  risk, and delayed agronomic response.
- Six staged divots, three ball marks, seven bunker footprints, four bounded
  debris clusters, and a restrained moisture/heat/health/fertilizer disease
  model with inspection, treatment, and recovery.
- Eleven-category score connected to course rating and selected-green speed.
- Full state persistence, old-save migration, authored-course-change fallback,
  long-absence bounds, localized dirty rows, and coarse/fine synchronization.
- Project-owned Blender source and GLBs for the greens mower, spreader, and
  treatment sprayer; no external assets were downloaded.

Architecture and scaling details are in [architecture.md](architecture.md).
Hero-hole evidence is in [selected-hero-hole.md](selected-hero-hole.md).

## Gameplay acceptance

The final Playwright route uses the game UI, keyboard, pointer, mount controls,
blade toggle, held-tool actions, autosave, and a real page reload. Teleports are
limited to deterministic travel/setup so the 109.6-second run remains
repeatable. All twelve end-to-end assertions passed:

- route reviewed and tractor repaired;
- all divots, ball marks, footprints, and debris completed;
- mowing, irrigation, fertilizer, and treatment history persisted;
- reload count advanced;
- save/load was pending before reload;
- all 15 work-order steps completed only after reload;
- condition improved and did not regress through reload.

| State | Score | Work order | Divots | Ball marks | Footprints | Debris |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 62 | 0/15 | 0/6 | 0/3 | 0/7 | 0/4 |
| Before reload | 75 | 14/15 | 6/6 | 3/3 | 7/7 | 4/4 |
| After reload | 75 | 15/15 | 6/6 | 3/3 | 7/7 | 4/4 |

The authoritative result is [gameplay.json](final-release/gameplay.json), the
accepted final view is [14-after-reload.png](final-release/14-after-reload.png),
and the recorded route is [maintenance-route.webm](final-release/maintenance-route.webm).
Four review passes and their concrete revisions are documented in
[visual-iterations.md](visual-iterations.md).

## Performance comparison

Protocol: deterministic Willow Creek fixture; Chrome 150 headless; 1600x900,
DPR 1; five-second warm-up; three six-second samples for a fixed Hole 4 camera
and active normal-control tractor mowing; 60 mount/dismount cycles with
forced-GC checkpoints. Raw records are [baseline](baseline/performance/raw.json)
and [final](final-release/performance/raw.json).

| Metric | Baseline | Final | Delta | Gate/result |
| --- | ---: | ---: | ---: | --- |
| Idle average FPS | 308.602 | 349.907 | +13.38% | Pass (not below -10%) |
| Idle 1% low FPS | 40.407 | 236.008 | +484.07% | Pass |
| Idle worst frame | 107.433 ms | 48.467 ms | -54.89% | Pass |
| Idle draw calls/frame | 532.287 | 584.279 | +9.77% | Pass (< +15%) |
| Idle triangles/frame | 4,311,591 | 4,429,063 | +2.72% | Pass (< +15%) |
| Active average FPS | 332.338 | 359.330 | +8.12% | Pass |
| Active 1% low FPS | 62.683 | 308.298 | +391.83% | Pass |
| Active worst frame | 86.467 ms | 4.833 ms | -94.41% | Pass |
| Active draw calls/frame | 536.745 | 589.817 | +9.89% | Pass (< +15%) |
| Active triangles/frame | 4,465,640 | 4,582,563 | +2.62% | Pass (< +15%) |
| Geometries | 1,016 | 1,060 | +4.33% | Pass (< +15%) |
| Materials | 249 | 270 | +8.43% | Pass (< +15%) |
| Renderer textures | 199 | 203 | +2.01% | Pass (< +15%) |
| Estimated sized texture bytes | 5,365,559,360 | 5,367,312,448 | +0.03% | Pass (< +15%) |
| Save size | 329,549 B | 384,497 B | +16.67% | Pass (< +20%) |
| Save time | 6.6 ms | 4.3 ms | -34.85% | Pass |
| Load time | 2.2 ms | 7.4 ms | +236.36% | Relative gate miss; absolute < 16.7 ms |
| Active listener growth | 0 | 0 | 0 | Pass |

Load time is the one explicit relative-gate exception. The baseline has no
56,320-active-cell fine model to reconstruct, so its 2.2 ms value is not a
realistic proportional budget. The final 7.4 ms measurement includes JSON
parse, the full empire restore, fine-field decoding, topology reconstruction,
and coarse shadow capture, and remains below one 60 Hz frame. Earlier integrated
measurements were roughly 45 ms; cached layout restore and row-band decoding
removed that long-frame load. Save size and save time both pass their original
gates.

Forced-GC heap checkpoints after 20/40/60 normal mount cycles were 83.825,
82.556, and 83.151 MB. The initial cache allocation then plateaued within
1.27 MB, with no monotonic growth and no listener growth. Final active samples
recorded zero frames over 50 ms.

## Assets

Blender 5.1 inspection of the exported GLBs reports:

| Asset | Dimensions | Triangles | Materials | UVs | Collision proxy |
| --- | --- | ---: | ---: | --- | --- |
| Greens mower | 1.092 x 1.230 x 1.044 m | 3,228 | 6 | Yes | `COLLISION_GreensMower` |
| Rotary spreader | 0.790 x 1.070 x 0.993 m | 3,184 | 7 | Yes | `COLLISION_RotarySpreader` |
| Treatment sprayer | 0.560 x 0.220 x 0.658 m | 2,024 | 7 | Yes | `COLLISION_TreatmentSprayer` |

All visible meshes have UVs, transforms are applied, moving pieces remain
separate, and simplified collision proxies are present. Source/licensing is
recorded in `ASSET_SOURCES.md`.

## Verification

- Full repository suite: 527/527 tests passed in 95.65 seconds.
- Focused course-maintenance suite: 11/11 passed.
- Gameplay route: 12/12 assertions passed; 0 page errors.
- Performance: render/resource/save gates passed; load exception documented
  above; 0 listener growth; no monotonic forced-GC heap growth.
- Blender inspection: all three assets imported, rendered, measured, UV-valid,
  and collision-proxied.
- `git diff --check`: clean.

Known non-blocking console output is limited to the existing Canvas2D
`willReadFrequently` advisory and one ANGLE/THREE X4000 shader warning. The
failed model requests in raw QA logs are aborted in-flight loads caused by the
fixture's deliberate page reload/context close; the final route has no page
errors or missing required maintenance model.
