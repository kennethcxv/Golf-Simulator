# Course Visuals Overnight QA

This log records the fixed-camera, normal-control browser review for branch
`overnight/course-visuals`. Evidence is generated beneath
`qa/course_master_final/<phase>/` and is intentionally not committed.

## Fixed protocol

- Browser viewport: 1600 x 900, headed Chromium.
- Deterministic bootstrap: relaxed game, seed 4242.
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
| H1 playtest shot | 72.70 | 24.10 | 77.7 ms | recorded | recorded |

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
