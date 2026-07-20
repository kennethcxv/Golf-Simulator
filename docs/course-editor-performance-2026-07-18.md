# Course Editor Performance and Stability Report - 2026-07-18

Status: **PASS locally**. The final isolated branch is functionally green, the final measured editor workloads contain no frame above 100 ms, save/reload and exact discard preserve state, and the repository-wide test suite has zero failures.

## Isolation and scope

- Branch: `overnight/course-editor-performance`
- Worktree: `<REPOSITORY_ROOT>-course-editor-performance`
- Base commit: `1dfb9de` (`integration/all-verified-work-2026-07-18`)
- Original checkout: not modified by this work
- Remote status: no Git remotes are configured, so the branch cannot be pushed from this checkout
- Scope: course-editor responsiveness, transaction safety, lifecycle stability, normal-control QA, and supporting diagnostics only

No external or generated assets were downloaded. The existing Blender 5.1 verifier was run only to satisfy an unrelated repository test gate; it did not rewrite raw assets.

## Result

The editor now keeps common terrain and surface-paint work regional from mutation through simulation, derived-field generation, GPU upload, and renderer refresh. Undo, redo, and discard use the operation's actual dirty footprint instead of treating every action as a whole-course rebuild. Long discard work is tiled across animation frames. Feature dependencies rebuild only when the changed area intersects them.

The transaction path also restores exact pre-edit identity: hole, object, path, and vector ID counters; absent-versus-present paint storage; holes; sections; objects; paths; vectors; elevation; and zone data all return to the captured baseline. Save/reload was exercised through visible controls and showed no structural drift.

## Implementation summary

- Added sparse paint operations and exact regional derived-field updates.
- Added rectangular `DataTexture` uploads and partial turf/terrain buffer updates.
- Scoped live terrain, paint, stamp, undo, redo, and rollback rendering.
- Preserved local dirty footprints in depth-only vector history entries.
- Rebuilt water and paths after terrain edits only when their bounds intersect the edit.
- Replaced repeated-undo discard with exact baseline inversion and tiled renderer refresh.
- Preserved transaction identity and the distinction between a missing paint array and an all-zero array.
- Added bounded runtime counters for visual-field, distance-field, texture-upload, terrain, and turf work.
- Stabilized editor camera reprojection and focused selected stream/bridge features.
- Improved control-point, selection, and legal/illegal placement feedback.
- Kept the tool rail and contextual tip visible while long tool panels scroll internally.
- Added dedicated utility-control, stroke-performance, lifecycle-soak, and strict master-frame QA coverage.

## Performance comparison

The baseline and final stroke probes used the same headed Chromium route and retained raw `requestAnimationFrame` deltas. The final figures below are from the committed tree.

| Metric | Baseline | Final | Change |
| --- | ---: | ---: | ---: |
| Terrain stroke average FPS | 72.91 | 73.95 | +1.4% |
| Terrain stroke worst frame | 58.3 ms | 58.5 ms | effectively unchanged |
| Terrain frames over 100 ms | 0 | 0 | pass |
| Paint stroke average FPS | 57.68 | 68.65 | +19.0% |
| Paint stroke average frame | 17.336 ms | 14.567 ms | -16.0% |
| Paint stroke 1% low | 4.71 FPS | 16.03 FPS | +240.3% |
| Paint stroke worst frame | 349.9 ms | 66.5 ms | -81.0% |
| Paint frames over 100 ms | 1 | 0 | hitch removed |
| Paint GPU texture uploads | 4,553 calls | 52 calls | -98.9% |
| Paint GPU upload volume | 132,861,656 B | 2,614,176 B | -98.0% |

Final input-to-next-frame latency during paint was 9.7 ms median and 14.4 ms maximum over 25 samples.

### Measured operation costs

| Operation | Whole-course/reference path | Scoped production path |
| --- | ---: | ---: |
| Live terrain tick | 1,238.4 ms full rebuild median | 0.8 ms median |
| Paint stamp | 208.8 ms full stamp median | 22.4 ms scoped median |
| Undo refresh | 1,238.0 ms full median | 28.6 ms scoped median |
| Paint visual field | n/a | 5.16 ms average, 21.4 ms max |
| Paint distance field | n/a | 1.188 ms average, 2.1 ms max |
| Paint texture upload | n/a | 0.096 ms average, 0.2 ms max |
| Terrain regional refresh | n/a | 1.412 ms average, 2.1 ms max |
| Water dependency rebuild | n/a | 0.9 ms median |
| Path dependency rebuild | n/a | 7.6 ms median |
| Object dependency rebuild | n/a | 0.8 ms median |

The synthetic whole-course/reference calls remain in the probe to show the avoided cost; normal live editor paths use the scoped variants.

### Strict master-frame gate

The final master run forces collection of the evidence sweep's screenshot allocations before, never during, each measured interval. It records `framesOver100ms` per scenario and cannot return `ok: true` if any timed scenario crosses the ceiling.

| Scenario | Average FPS | 1% low | Worst frame | Frames over 100 ms |
| --- | ---: | ---: | ---: | ---: |
| Whole-course overview idle | 40.04 | 22.84 | 50.0 ms | 0 |
| Normal editor orbit | 96.86 | 26.69 | 41.7 ms | 0 |
| Normal playtest shot | 103.94 | 51.84 | 25.0 ms | 0 |

## Transaction and utility coverage

The utility audit passed all of the following through visible controls in one editor session:

- All ten tool panels: Select, Terrain, Paint, Tee, Green, Bunker, Water, Objects, Paths, and Measure.
- All five object categories: Trees, Shrubs, Rocks, Props, and Decor.
- Statistics and all four lighting previews.
- Multi-point measurement and right-click clear.
- Terrain and paint edits.
- Hole settings, reorder, duplicate, delete, add, Undo, and Redo.
- Exact Discard without restarting the editor.

Discard restored identical before/after fingerprints for core state, all identity counters, structural collections, zones, elevation, and the absent paint field. Its 54 measured frames had a 66.6 ms worst frame and zero frames over 100 ms. Regional rollback costs peaked at 12.4 ms for the visual field and 2.5 ms for a terrain tile.

The production action route separately passed green boundary/pin editing, bunker edit/delete/undo, pond and stream editing, path/bridge edit/delete/undo, legal and colliding object ghosts, object move/rotate/scale/duplicate/remove, visible save/reload, selected-tee playtest, bridge surface authority, and a normal hold/release swing.

## Long-session stability

The lifecycle soak completed 12 cycles each of edit/undo/redo, hole and camera changes, editor close/reopen, and editor/playtest round trips without restarting the game.

- 703 sampled edit frames; 52.99 average FPS; 8.5 ms median; 83.4 ms worst; 0 frames over 100 ms.
- Playtest scene-node slope: 0 across 12 round trips.
- Sampled window/document/canvas listener delta: 0.
- Full-document listener count: +2 during the complete app workflow; the sampled editor-owned targets remained flat.
- Forced-GC heap delta: +7 MB across the soak.
- Stable per-cycle renderer plateau: 1,500 geometries, 258 textures, 141 programs, and 4,844 scene nodes.
- Leak detector findings: none.
- Visible Save duration: 2,135 ms; structural drift after reload: none.
- Console errors: none.

The final strict master pass separately recorded a +3.86 MB forced-GC heap delta and zero sampled-target listener growth.

## Visual and functional QA

The headed browser runs used Chromium 150 at 1600 x 900 with screenshots and WebM capture enabled. The master route covered all nine holes, five camera presets, flyover, ground-level playtest views, editor orbit, and a normal shot. App console errors, page errors, request failures, and HTTP errors were zero.

Chrome/ANGLE emitted one known generated-shader advisory about `dyn_index_vec4_float4_int`. The driver records it separately as benign; there were no application errors or failed shader links.

See [course-editor-visual-qa-2026-07-18.md](course-editor-visual-qa-2026-07-18.md) for the four-pass visual defect audit and final visual limitations.

## Automated test record

Commands and final results:

- `npm test`: 1,662 tests; 1,659 passed; 0 failed; 3 intentionally skipped; 396.133 seconds on the final tree.
- The three skips are existing clean-Blender evidence checks whose local reports are intentionally ignored by Git.
- `node --test tests/assets-51-60-reimport-report.test.js`: 1 passed after running the repository's pinned Blender verifier.
- `node --check tools/qa/course-master-final.js`: passed.
- All browser QA result files listed below report `ok: true` on the committed game tree or on the subsequently committed master-gate driver.

The previously missing Sheet-6 evidence was generated with Blender 5.1.2 through:

`C:\Program Files\Blender Foundation\Blender 5.1\blender.exe --background --factory-startup --python tools/blender/verify_assets_51_60_reimport.py`

It passed all ten assets with zero failed checks. The generated evidence remains local and ignored, as designed by the repository.

## Evidence index

Result JSON:

- Baseline stroke: `qa/course-editor-performance/baseline/expanded/result.json`
- Final stroke: `qa/course-editor-performance/stroke-post-commit/result.json`
- Utility and exact discard: `qa/course-editor-performance/utility-final-03/result.json`
- Lifecycle soak: `qa/course-editor-performance/lifecycle-post-commit/result.json`
- Final strict master gate: `qa/course-editor-performance/master-gated-final/result.json`
- Production actions: `qa/course-editor-performance/action-timings-final/result.json`
- Final visual pass: `qa/course-editor-performance/visual-iteration-04-final/result.json`

Screenshots:

- Baseline: `qa/course_master_final/course-editor-performance-baseline-tools-fixed-driver/`
- Final production actions: `qa/course_master_final/course-editor-performance-action-timings-final/`
- Final utility audit: `qa/course_master_final/course-editor-performance-utility-final-03/`
- Final lifecycle soak: `qa/course_master_final/course-editor-performance-lifecycle-post-commit/`
- Final strict master: `qa/course_master_final/course-editor-performance-master-gated-final/`
- Final visual pass: `qa/course_master_final/course-editor-performance-visual-iteration-04-final/`

Videos:

- `qa/course-editor-performance/action-timings-final/video/`
- `qa/course-editor-performance/utility-final-03/video/`
- `qa/course-editor-performance/lifecycle-post-commit/video/`
- `qa/course-editor-performance/master-gated-final/video/`
- `qa/course-editor-performance/visual-iteration-04-final/video/`

The `qa/` evidence tree is intentionally ignored by Git and remains available in this worktree.

## Commits

- `e077656` - isolate course-editor browser drivers
- `8e45c51` - scope live terrain and paint refreshes
- `79ffd03` - stabilize visual feedback and rollback
- `940633a` - add runtime performance and lifecycle evidence
- `2a31d65` - follow the async discard refresh helper in static tests
- `b0ae00f` - gate the master workload on the 100 ms ceiling

## Handoff limitations

- The branch is complete and committed locally, but it cannot be pushed because this repository has no configured remote.
- Local screenshots, video, and generated Blender evidence are ignored artifacts; preserve the worktree if those files are needed for review.
- Small placed props are necessarily subtler than their screen-space legality ring at a whole-hole aerial zoom. The interaction state remains unambiguous, and closer camera views reveal the prop silhouette; this is recorded as a non-blocking visual limitation rather than hidden.
