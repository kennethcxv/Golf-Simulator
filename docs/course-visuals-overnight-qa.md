# Course Visuals Overnight QA

This log records the fixed-camera, normal-control browser review for branch
`overnight/course-visuals`. Evidence is generated beneath
`qa/course_master_final/<phase>/` and is intentionally not committed.

## Fixed protocol

- Browser viewport: 1600 x 900, headed Chromium.
- Deterministic bootstrap: relaxed game, seed 424242.
- Entry: normal Course Editor controls, then normal Playtest controls for each hole.
- Every pass captures course overview; aerial, tee, landing, approach, green,
  ground-preview, editor-orbit, flyover-mid, and playtest-tee views for all nine holes.
- Every pass records console errors, page errors, failed requests, video, and the
  same overview/orbit/playtest performance scenarios.

## Baseline — `baseline-20260718-final`

Result: pass. App console errors: 0. Page errors: 0. Failed requests: 0.
The only browser diagnostic was a benign ANGLE generated-shader warning.

| Scenario | Average FPS | 1% low FPS | Worst frame | Calls/frame | Triangles/frame |
| --- | ---: | ---: | ---: | ---: | ---: |
| Course overview idle | 37.27 | 22.97 | 49.9 ms | 1715.44 | 7,357,163 |
| H1 editor orbit | 78.67 | 21.39 | 50.0 ms | 583.46 | 4,916,771 |
| H1 playtest shot | 72.70 | 24.10 | 77.7 ms | 305.80 | 6,635,173 |

Static census: 744 materials; estimated texture memory 698.22 MiB. Forced-GC
heap delta: +4,926,540 bytes. Full-document listener delta: +2.

### Iteration 1 baseline defect review

1. Critical — H2 Approach View intersects a large tree canopy, hiding most of
   the target from the player/editor camera.
2. Critical — H6 Approach View intersects several broadleaf canopies, hiding
   the right half of the green complex.
3. High — customer checkout speech can leak into the paused Course Editor and
   contaminate course review screenshots.
4. High — landing, approach, and flyover cameras sit too high and far away,
   reducing holes to miniature strips instead of golf-scale landscapes.
5. High — authored tree rows remain close enough to the corridor for canopies
   to form repeated walls and obstruct target lines.
6. High — the property and boundary belts overuse similarly sized low-poly
   crowns, making the forest read as stamped rather than composed.
7. High — cart paths render as dark charcoal ribbons that visually bisect and
   dominate several holes.
8. High — pond reflections form hard white mirror bands, especially around
   Millpond and the scenic ponds visible from H7/H8.
9. High — rough, heavy rough, and native scrub collapse into one muddy olive
   value, weakening routing and edge readability.
10. Medium — fairway mowing bands are strong enough to overpower terrain shape
    and make otherwise distinct routes share the same visual treatment.
11. Medium — greens use an excessively dark collar, emphasizing a repeated
    circular plate instead of the authored pear/kidney/cape outlines.
12. Medium — all green sizes cluster tightly despite different strategy and
    par, further weakening nine-hole identity.
13. Medium — bunker sand reads cold gray in shade rather than warm cream; some
    aerial bunkers flatten into pale blobs.
14. Medium — H2's left bunker exposes a turf island/open bite that reads as a
    geometry error from the approach preset.
15. Medium — initial disease feedback produces near-white confetti marks on
    H6/H8 greens instead of believable muted turf stress.
16. Medium — near-camera turf tips are too bright and uniform, reading as pale
    triangular shards across teeing grounds.
17. Medium — scattered rocks and shrubs are frequent enough to read as random
    noise rather than restrained landscape accents.
18. Medium — aerial frames include so much adjacent routing that individual
    hole identity is diluted.
19. Low — deep canopy shadows crush into near-black patches and disconnect tree
    crowns from the otherwise warm daytime palette.
20. Low — the distant ridge/forest silhouette repeats at a consistent height,
    giving several ground views a wallpaper-like horizon.

### Iteration 1 fixes and comparison — `iteration-01`

Result: pass. App console errors: 0. Page errors: 0. Failed requests: 0.

- Cleared H2 and H6 target lines by moving authored canopy beyond the playing
  edge, reducing filler density, and lowering normal landing/approach cameras.
- Reframed flyovers at golf scale and lowered green views while retaining full
  strategic-hazard safe bounds.
- Separated fairway/rough/native values, warmed sand and paths, softened mowing
  contrast and green collars, muted disease speckling, and integrated blade tips.
- Suppressed clubhouse dialogue while the editor is active and cleared any
  transient shop toast on entry.
- Reduced overview rendered instances from 6,749 to 6,214, meshes from 3,450
  to 3,419, and materials from 744 to 734.

| Scenario | Baseline FPS | Iteration 1 FPS | Baseline 1% low | Iteration 1 1% low | Baseline calls/frame | Iteration 1 calls/frame |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Course overview idle | 37.27 | 59.33 | 22.97 | 37.34 | 1715.44 | 1566.75 |
| H1 editor orbit | 78.67 | 96.86 | 21.39 | 16.27 | 583.46 | 576.60 |
| H1 playtest shot | 72.70 | 111.44 | 24.10 | 59.69 | 305.80 | 298.61 |

The orbit aggregate contains one 100.1 ms outlier in its third repeat; the
other two repeats improved to 32.68 and 27.73 FPS 1% lows. This remains open
until later identical passes show whether it is repeatable or transient.

### Iteration 2 defect review

1. Critical — pond reflection still saturates into a broad white diagonal band
   in H7/H9 aerial views; the first reflection mix reduced but did not cap it.
2. High — H2's left bunker still pinches around a near-enclosed turf island.
3. High — generic bunker radial jitter creates occasional narrow necks that
   look accidental rather than like maintainable flashed-sand shapes.
4. High — H6 and H8 frame-hole views give too much visual weight to an adjacent
   fairway, weakening the identity of both short par threes.
5. High — the boundary forest remains a high-frequency species scatter rather
   than coherent pine/broadleaf stands.
6. Medium — distant boundary density is still heavy enough to read as a solid
   repeated wallpaper in several ground and approach views.
7. Medium — H6's warm path now reads correctly as paving but occupies a strong
   diagonal through its target composition.
8. Medium — small rocks remain conspicuous in several approach foregrounds,
   especially H2/H6, competing with the green complex.
9. Medium — close grass is better integrated but the seven-ribbon patches still
   reveal a regular shard vocabulary at low inspection height.
10. Medium — water banks remain uniformly dark and geometric even where the
    water surface color is improved.
11. Low — the far ridge has a long, even silhouette through the H6 approach
    horizon and needs more layered height rhythm.
12. Low — one H1 editor-orbit performance repeat has a 100.1 ms spike; later
    identical samples must confirm it is not a repeatable flora-repack hitch.

### Iteration 2 fixes and comparison — `iteration-02`

Result: pass. App console errors: 0. Page errors: 0. Failed requests: 0.

- Capped the reflection contribution before the water color mix, preserving a
  readable blue-green surface in H5/H7/H8/H9 instead of a white mirror band.
- Reduced generic bunker radial variance, matched the editor preview generator,
  and added a 256-seed maintainable-envelope/self-crossing regression test.
- Composed the boundary as quieter pine and broadleaf stands, reduced distant
  filler, and replaced the single repeated horizon with three offset ridges.
- Added authored H6/H8 frame-hole headings and removed conspicuous foreground
  rock noise around the short-hole target corridors.
- Reduced overview rendered instances from 6,214 to 5,645, meshes from 3,419 to
  3,393, materials from 734 to 731, and forced-GC heap delta to +4,048,424 bytes.

| Scenario | Baseline FPS | Iteration 2 FPS | Baseline 1% low | Iteration 2 1% low | Baseline calls/frame | Iteration 2 calls/frame |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Course overview idle | 37.27 | 47.47 | 22.97 | 26.60 | 1715.44 | 1565.20 |
| H1 editor orbit | 78.67 | 87.95 | 21.39 | 26.29 | 583.46 | 543.63 |
| H1 playtest shot | 72.70 | 104.48 | 24.10 | 56.75 | 305.80 | 299.68 |

The iteration-1 orbit spike did not repeat: all three iteration-2 orbit samples
held between 25.75 and 30.06 FPS at the 1% low. Triangle counts also fell below
baseline in every scenario (6.66M overview, 4.49M orbit, 5.95M playtest).

### Iteration 3 defect review

1. High — H2's left bunker remains a C-shaped sand contour with a near-enclosed
   turf pocket; bounded raw points alone do not prevent a spline overshoot.
2. High — H3's tee sign clips the lower-left edge of the normal player camera.
3. High — H4's tee sign sits inside the primary shot corridor and competes with
   the intended dogleg reveal.
4. High — H6's approach/green presets still share too much screen area with the
   neighboring fairway and its path.
5. High — H8's approach/green presets likewise allow the adjacent routing to
   weaken the short hole's pond-and-green identity.
6. Medium — pale disease flecks remain conspicuous on H6/H8 greens, reading as
   paper scraps rather than restrained turf stress.
7. Medium — H7's flyover exposes broad, dark native masks beside the path as
   disconnected puddle-like shapes.
8. Medium — H6's flyover foreground is dominated by a Y-shaped cart-path
   junction before the target complex becomes the visual subject.
9. Medium — H9's flyover gives equal weight to parallel paths on both sides,
   flattening the home-hole hierarchy.
10. Medium — multiple par-three green views retain more neighboring tee/fairway
    context than is useful for reading their own bunker lips and contours.
11. Low — close-cut disease response varies too sharply between individual
    noise spots even though the underlying severity field is smooth.
12. Low — H3/H4 tee furniture uses the default placement grammar despite their
    very different arrival and opening-shot directions.

### Iteration 3 fixes and comparison — `iteration-03-clean`

Result: pass. App console errors: 0. Page errors: 0. Failed requests: 0. An
earlier overlapping runner ended one clubhouse request with `ERR_ABORTED`; the
isolated clean rerun below had no request failures and is the accepted pass.

- Added authored maintainable bunker outlines and spline/self-crossing tests,
  then retained the bounded generator for newly edited hazards.
- Moved H3/H4 furniture out of their normal shot cameras.
- Added authored approach, green, flyover, and context framing for H6/H8 so the
  target complexes lead those player-facing views.
- Reduced disease contrast and shifted the residual response into embedded
  olive turf stress.
- Held the overview at 5,645 rendered instances, 3,388 meshes, and 732
  materials; forced-GC heap delta was +4,038,688 bytes.

| Scenario | Baseline FPS | Iteration 3 FPS | Baseline 1% low | Iteration 3 1% low | Calls/frame | Triangles/frame |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Course overview idle | 37.27 | 35.63 | 22.97 | 14.41 | 1573.61 | 6,731,856 |
| H1 editor orbit | 78.67 | 74.46 | 21.39 | 10.43 | 547.73 | 4,433,104 |
| H1 playtest shot | 72.70 | 81.51 | 24.10 | 36.78 | 306.89 | 5,990,371 |

Geometry, calls, instances, materials, and heap remained below baseline, but
the overview and orbit frame timings contain 83.3 ms and 175.1 ms outliers.
Performance therefore remains open until the fourth identical pass; no final
performance claim uses this noisy sample alone.

### Iteration 4 defect review

1. Critical — the apparently enclosed turf in H2 is not a malformed bunker:
   a coarse countryside underlay intersects the deepest sand floor and renders
   above the real hazard surface.
2. Critical — the underlay has no runtime clearance assertion, so another
   bunker or pond carve could expose the same false surface elsewhere.
3. High — H6's frame-hole shoulder still exposes too much of Cascades despite
   the focused approach and green presets.
4. High — H8's frame-hole shoulder still gives H5/H7 more central screen space
   than the selected pond-and-green axis.
5. High — iteration 3's overview and orbit frame-time outliers prevent a stable
   performance comparison even though submitted geometry is lower.
6. Medium — the seven-ribbon close-grass patch still resolves as a repeated
   star/shard vocabulary at low inspection height.
7. Medium — each grass instance submits 28 triangles where the dense lattice
   can preserve coverage with 20, increasing playtest cost without visible gain.
8. Medium — H7's dark native transition masks read as isolated puddles beside
   the path instead of a continuous managed-to-wild gradient.
9. Medium — H6's pale path junction remains the brightest foreground shape in
   the flyover and competes with the green complex.
10. Medium — H9's two path branches carry equal visual weight and flatten the
    homeward route hierarchy.
11. Medium — exposed pond beds are dark enough to create a geometric shoreline
    ring under the otherwise improved blue-green water.
12. Low — render objects for the playable terrain and countryside underlay are
    unnamed, making a repeatable browser clearance probe unnecessarily fragile.

### Iteration 4 fixes and final visual acceptance — `final-acceptance`

Result: pass. App console errors: 0. Page errors: 0. Failed requests: 0. Both
the initial scene and Course Editor asset barriers completed. The only browser
diagnostic was the documented benign ANGLE generated-shader warning.

- Identified H2's false turf island as the coarse countryside underlay showing
  through the deeper authored bunker floor, then tucked the underlay eight yards
  below the playable interior transition.
- Named the playable terrain and environment underlay and added a real-browser
  vertical-ray clearance probe at every authored bunker and pond centroid. The
  minimum final clearance is 1.6839 yd; violations: 0 at the 0.25 yd gate.
- Added H2's maintainable bunker outlines and retained the bounded procedural
  generator for editor-created hazards, with deterministic spline and
  self-crossing regression coverage.
- Finished route-specific H6/H8 approach, green, context, and flyover metadata;
  restored their route-centered full-hole headings after an oblique experiment
  made neighboring fairways more prominent.
- Moved H3/H4 tee furniture clear of the normal shot picture, reduced disease
  contrast, softened path/native/pond-bed values, and compressed pond reflection
  range so water remains rippled blue-green without white or false-mesh bands.
- Rebuilt each close-grass patch from seven ribbons to five (28 to 20 triangles
  per patch), darkened blade tints into the turf palette, and kept blades absent
  from sand, water, paths, and the aerial overview.
- The H2 bunker underlay defect is absent in approach, green, flyover, orbit, and
  normal play cameras. All nine tee, landing, approach, green, ground-preview,
  flyover, editor-orbit, aerial, and playtest-tee images were manually reviewed.

Final visual census at the course overview: 5,645 rendered instances, 3,388
meshes, 732 materials, 1,523 geometries, 142 programs, and an estimated 698.22
MiB of scene-reachable RGBA8 texture sources. Compared with baseline, the scene
uses 1,104 fewer rendered instances, 62 fewer meshes, and 12 fewer materials.
The forced-GC heap delta was +4,141,312 bytes; full-document listener delta +2;
sampled-target listener delta 0; overview UI mutation records 0.

Evidence:

- Full result: `qa/course_master_final/final-acceptance/results.json`
- Nine-hole screenshots: `qa/course_master_final/final-acceptance/holes/`,
  `camera_presets/`, `flyovers/`, `editor_orbit/`, and `ground_level/`
- Recorded run: `qa/course_master_final/final-acceptance/video/`
- Shader proof: `qa/course_master_final/final-acceptance/shader/course_shader_boot.png`

### Performance stability audit

The first accepted functional pass improved average orbit/playtest rates and
reduced calls and triangles, but its first playtest sample contained one 308.2
ms stall. A same-source repeat caught a 158.6 ms first-sample stall while the
whole matrix stretched from 167 to 268 seconds. Investigation found orphaned
`node --test` workers from an earlier unbounded suite consuming the host; 16
scoped Golf Flipper test processes were stopped, zero test workers remained,
and the suite was rerun with concurrency capped at four. No performance verdict
uses either contaminated sample. The final post-cleanup comparison is recorded
below after an identical quiet-host browser pass.

Two independent checkout lifecycle master runs then occupied the shared host.
The first declared preflight required five CPU samples averaging at most 25%; it
correctly refused to launch during a bounded 19-minute cooldown. The lowest
observed idle-window average was 26.6%, so, before seeing another course result,
the final preflight was fixed at an average of at most 30%, no individual sample
above 45%, and zero active lifecycle runners. `final-performance-clean` launched
only after that gate passed. A later lifecycle runner began 17 seconds after the
course result finished writing, so it did not overlap the accepted capture.

Result: pass. App console errors: 0. Page errors: 0. Failed requests: 0. Both
asset barriers completed, underlay clearance remained 1.6839 yd with zero
violations, and all nine retained scenario samples stayed below 100 ms.

| Scenario | Baseline FPS | Final FPS | Delta | Baseline 1% low | Final 1% low | Delta | Worst frame | Calls/frame delta | Triangles/frame delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Course overview idle | 37.27 | 55.29 | +48.3% | 22.97 | 33.11 | +44.1% | 33.5 ms | -9.0% | -9.9% |
| H1 editor orbit | 78.67 | 110.72 | +40.7% | 21.39 | 26.96 | +26.0% | 50.0 ms | -1.7% | -7.8% |
| H1 playtest shot | 72.70 | 116.31 | +60.0% | 24.10 | 57.14 | +137.1% | 24.9 ms | -2.7% | -13.3% |

The overview also finishes 16.4% lower in rendered instances, 1.8% lower in
meshes, 1.6% lower in materials, and 3.9% lower in geometries than baseline.
Estimated scene-reachable texture-source memory is unchanged at 698.22 MiB;
forced-GC heap growth improved from 4,926,540 to 4,227,976 bytes (-14.2%). The
full-document listener delta remains +2, sampled-target listener delta 0, and
overview UI mutation records 0. This passes the declared no-regression gate:
there is no average or 1% low decline, no recurring >100 ms stall, and no
render-load growth.

Final performance evidence:

- Result: `qa/course_master_final/final-performance-clean/results.json`
- Screenshots: `qa/course_master_final/final-performance-clean/`
- Recorded run: `qa/course_master_final/final-performance-clean/video/`

### Verification

- The live WebGL shader boot gate passed with 139 linked programs, zero broken
  programs, `glError` 0, no context loss, and no shader or console errors.
- The 43 directly affected camera, bunker, grass, deterministic-layout, and
  marketplace tests pass at single-worker concurrency.
- The bounded full regression run passes all 242 in-scope test files with
  concurrency capped at four. The only excluded file is
  `tests/assets-51-60-reimport-report.test.js`, an unrelated pre-existing Blender
  5.1 clean-reimport evidence gate whose generated Sheet-6 report is absent.
  No Blender or GLB asset changed in this course-only branch, so that external
  artifact was not fabricated or regenerated.
- `git diff --check` is clean. Save-sensitive authored hole hashes, camera
  metadata, bunker outlines, vegetation data, and downstream marketplace output
  are covered by deterministic regression tests.

## Completion audit and integration handoff — 2026-07-19

### Isolation and source record

- Branch: `overnight/course-visuals`
- Isolated worktree: `C:\Users\Kenneth\Documents\GitHub\Golf-Flipper-course-visuals`
- Requested base name: `overnight/base-2026-07-18` (not present in the local
  repository and no remote is configured from which to fetch it)
- Exact local integration base used: `1dfb9de646c6785b027ddb023dda1e3a6af9a5c6`
- Audited implementation head before this documentation update:
  `1fe0af06f3998d70cad5f055068150ce761b9f74`
- The original `Golf-Flipper` worktree was not edited. No merge, rebase,
  cherry-pick, force-push, or base-branch mutation was performed.

Milestone commits above the integration base:

1. `694a490` — `qa(course): capture every hole acceptance view`
2. `1d00dcb` — `feat(course): establish production parkland visual pass`
3. `43c9bd6` — `feat(course): finish authored nine-hole visual polish`
4. `1fe0af0` — `qa(course): guard hazard clearance and record acceptance`

The two approved course references under `Designs/RefrenceImages/Course/` were
reviewed at original resolution. They established the target: warm stylized
parkland, legible mowing and rough hierarchy, shaped hazards, layered forest and
horizon composition, and editor cameras that retain real golf scale. No external
asset was downloaded, no license record was added, and no Blender or GLB asset
was changed because the accepted work is authored terrain, shader, camera, and
course-layout polish rather than new physical geometry.

### Final nine-hole review

Every hole was reviewed individually in Course Overview, Tee, Landing Area,
Approach, Green, Ground Preview, normal Playtest tee, Editor orbit, and Flyover.
The final identities remain deliberately distinct:

- Hole 1, Opening Drive: welcoming straight opener with a clear strategic
  bunker sequence and framed parkland horizon.
- Hole 2, The Overlook: elevated short hole with paired target bunkers; the
  former false turf underlay island is absent.
- Hole 3, Long Meadow: long, layered par 5 with broad landing strategy and a
  clearly staged approach.
- Hole 4, The Elbow: unmistakable dogleg and clubhouse-adjacent arrival.
- Hole 5, Millpond: water-led green complex with restrained blue-green
  reflection and no white diagonal seam.
- Hole 6, Short Iron: compact uphill par 3; the flag remains visible over the
  intentional crest and neighboring corridors do not become the subject.
- Hole 7, Cascades: rolling par 5 with stepped landing choices and water context;
  the small dark oval beside the path is a correctly projected tree shadow, not
  a remaining terrain mask.
- Hole 8, The Glade: wooded par 3 whose water-backed target is revealed on the
  approach rather than flattened into the tee composition.
- Hole 9, Homeward: broad finishing corridor returning to the maintenance and
  clubhouse cluster.

The final review found no floating or clipped props, course-edge break, visible
terrain seam, false underlay island, geometric white-water split, pinched bunker
island, unreadable sign, or camera that clips its authored route and hazards.

### Files changed

Production and simulation:

- `src/main.js`
- `src/render/palette.js`
- `src/render3d/courseEditorPreviewGeometry.js`
- `src/render3d/courseScene.js`
- `src/sim/courseArchitect.js`
- `src/sim/courseCamera.js`
- `src/sim/courseVec.js`
- `src/ui/ui.js`

Regression and QA coverage:

- `tests/courseCamera.test.js`
- `tests/courseVecBunker.test.js`
- `tests/grass-exact-output.test.js`
- `tests/hole1Layout.test.js`
- `tests/marketplace.test.js`
- `tools/qa/course-master-final.js`
- `tools/qa/course-shader-boot.js`
- `docs/course-visuals-overnight-qa.md`

The Course Editor optimization architecture remains intact: GPU instancing,
flora LOD selection, half-resolution GTAO, frozen static scene groups, explicit
resource disposal, dynamic grass buffers, and renderer-state reset paths are
preserved. Grass presentation was made less repetitive while reducing each
bounded instance from seven blade ribbons to five. The accepted quiet-host run
also reduces rendered instances, draw calls, triangles, meshes, materials, and
geometries relative to baseline.

### Fresh completion verification

A new headed Chromium pass was run from the isolated worktree against its own
server port with the normal visible Course Editor and Playtest controls:

`HEADED=1 node tools/qa/run-playwright.cjs tools/qa/course-master-final.js --bootstrap`

Result: pass in 141.3 seconds. It captured 92 PNGs and one 17,001,000-byte WebM,
with 9 hole records, 45 preset-camera records, and 9 flyover records. Both asset
barriers completed. App console errors: 0. Page errors: 0. Failed requests: 0.
The sole browser warning is the already documented benign ANGLE generated-index
advisory. Hazard-underlay sampling covered 24 bunker/water centroids, measured a
minimum 1.6839-yard clearance against the 0.25-yard gate, and found 0 violations.

The independent live shader gate also passed: 139 linked programs, 0 broken
programs, `glError` 0, no context loss, and 0 shader or console errors.

Test results at the same branch state:

- Directly affected suite: 43 passed, 0 failed.
- Bounded full in-scope suite: 1,659 passed, 0 failed, 3 expected skips across
  all 242 included test files, with concurrency capped at four.
- The three skips are git-ignored local Blender clean-reimport evidence checks.
- `tests/assets-51-60-reimport-report.test.js` remains excluded because its
  unrelated pre-existing Sheet-6 Blender report is absent and this branch makes
  no Blender/GLB change that could truthfully regenerate it.
- `git diff --check`: pass.

Fresh evidence:

- Consolidated result: `qa/course_master_final/completion-audit-20260719/results.json`
- Screenshots: `qa/course_master_final/completion-audit-20260719/holes/`,
  `camera_presets/`, `ground_level/`, `editor_orbit/`, and `flyovers/`
- Recorded gameplay: `qa/course_master_final/completion-audit-20260719/video/`
- Shader screenshot:
  `qa/course_master_final/completion-audit-20260719/shader/course_shader_boot.png`
- Full TAP log: `qa/course_master_final/completion-audit-20260719/full-suite.tap`

The fresh gameplay pass overlapped another repository lifecycle runner on the
shared host, so its timing sample is retained only as functional evidence. The
quiet-host `final-performance-clean` pass remains the performance authority. Its
fixed-protocol result versus baseline is:

| Scenario | Baseline FPS | Final FPS | Baseline 1% low | Final 1% low | Final worst | Calls delta | Triangles delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Course overview idle | 37.27 | 55.29 | 22.97 | 33.11 | 33.5 ms | -9.0% | -9.9% |
| H1 editor orbit | 78.67 | 110.72 | 21.39 | 26.96 | 50.0 ms | -1.7% | -7.8% |
| H1 playtest shot | 72.70 | 116.31 | 24.10 | 57.14 | 24.9 ms | -2.7% | -13.3% |

No accepted scenario regresses average FPS or 1% low FPS, no recurring frame
exceeds 100 ms, texture-source memory is unchanged at 698.22 MiB, forced-GC heap
growth improves 14.2%, sampled-target listeners remain flat, and overview UI
mutations remain zero.

### Remaining external limitations and integration

- Push cannot be completed until a Git remote is configured. The repository
  currently has no remotes, so there is no `origin` or equivalent destination.
- The requested symbolic base branch is absent locally. Integration should use
  the exact base commit recorded above unless the maintainer supplies and
  verifies the intended base ref.
- QA media beneath `qa/course_master_final/` is intentionally ignored by git and
  remains available in this worktree; the durable audit narrative is committed.

Recommended integration after review:

1. Verify `git merge-base overnight/course-visuals <integration-branch>` is the
   expected `1dfb9de646c6785b027ddb023dda1e3a6af9a5c6` (or deliberately resolve the
   missing requested base first).
2. Review the four implementation milestones plus this final documentation
   commit and the linked local QA evidence.
3. From the intended integration branch, merge `overnight/course-visuals` with a
   normal non-fast-forward merge, then rerun the shader gate and bounded test
   suite in the integrated tree.
4. Configure the repository remote and push the reviewed branch/integration
   result according to the maintainer's normal release policy.

No integration operation was performed by this task.
