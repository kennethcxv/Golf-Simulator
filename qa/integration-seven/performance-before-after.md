# Performance before/after

Compared original main `0c5137e5f0efac9627ce2309b9e66936f1eeb769` with validated integration code head `ec88eba401e812cf131a7008f4ec868e575435f6`. Browser benchmarks ran serially on the same Windows host and NVIDIA GeForce RTX 5080. Raw values are mirrored in `performance-before-after.json`.

## Paired measurements

| Scenario | Original main | Integrated | Result |
|---|---:|---:|---|
| Menu ready, 3-run mean | 122 ms | 153 ms | +25.4%; still sub-200 ms |
| Playable world, 3-run mean | 7.07 s | 7.99 s | +13.0% |
| Playable world, median | 6.21 s | 6.55 s | +5.5% |
| Register camera, 0 customers | 116.26 FPS | 119.53 FPS | +2.8% |
| Register camera, 0 customers, 1% low | 53.34 FPS | 98.47 FPS | improved in this sample |
| Register camera, 10 customers | 119.99 FPS | 118.49 FPS | -1.25% |
| Register camera, 10 customers, 1% low | 117.26 FPS | 66.49 FPS | four isolated long frames; disclosed limitation |
| Course idle | 119.87 FPS | 119.91 FPS | equivalent/display-limited |
| Active mowing | 119.90 FPS | 119.88 FPS | equivalent/display-limited |
| Course idle draw calls | 560.8 | 611.8 | +9.1% |
| Active mowing draw calls | 565.3 | 617.5 | +9.2% |
| Course renderer geometries | 1,044 | 1,007 | -3.5% |
| Course renderer textures | 199 | 204 | +2.5% |
| Course material references | 254 | 377 | +48.4% |
| Representative save size | 329,910 B | 628,705 B | +90.6% from unified persisted domains |
| Save serialize/store | 3.7 ms | 5.0 ms | +1.3 ms |
| Parse/deserialize | 1.4 ms | 5.7 ms | +4.3 ms |
| 60 course mount cycles, listener growth | 0 | 0 | pass |
| Packed npm artifact | 252.0 MB | 258.3 MB | +2.5% |
| Unpacked npm artifact | 296.1 MB | 310.2 MB | +4.7% |

The fixed register protocol used three 600-frame runs after a 10-second warm-up at 1440×900. The ten-customer fixture disabled organic arrivals, removed pre-existing actors, froze time, stocked the same inventory state, and placed ten actors at fixed coordinates. The course protocol used three six-second samples at 1600×900 plus 60 normal mount/dismount cycles with forced-GC checkpoints.

## Integrated scenario measurements

- Complete golf operating-day route: 113.79 FPS average, 54.89 FPS 1% low, 25 ms worst frame, 2,923 draw calls, 5.37M triangles, 141.6 MB JS heap, zero listener-registration growth, and zero UI mutations during the five-second sample.
- Economy laptop: 103.02 FPS idle and 106.02 FPS during 24 navigation cycles; the connected-listener upper bound stayed 117 → 117.
- Authored placement batching reduced a comparable integrated view from 2,594 to 1,960 draw calls (-24.4%) and 6.309M to 5.264M triangles (-16.6%), while 15 authored models remained represented by seven batch meshes and selectable proxy objects.
- The final logical soak retained 2,210,576 bytes after GC, added no `CloseReq` or `PipeWrap` resources, bounded customer/layout histories, and held the final 20 serialized saves to a one-byte range.

## Interpretation

Performance is accepted, but no blanket improvement is claimed. The game remains at or near 120 FPS in paired idle/course scenarios and loses only 1.25% mean FPS with ten customers. The ten-customer tail sample and the larger material set are honest costs of the integrated systems and authored assets. Neither produced listener growth, an accumulating heap trend, a save-size trend, a blocking console error, or a sustained frame-rate collapse.

The full build exceeds the course branch's localized 15% material-count proposal because the final scene also contains furniture, delivery, customer, golf-operation, economy, and UX content. That gate is not treated as a same-scope A/B threshold; stable paired FPS and resource-soak results are the final acceptance evidence.

## Unsupported build metric

`package.json` defines no production build or preview script. No compiled bundle size or production-preview timing exists to measure. `npm pack --dry-run --json`, the static repository server, and the Electron launch smoke are used as the supported package/runtime equivalents. The absence of a build target is recorded as a limitation, not a pass.

Optional GLB fetches aborted during deliberate scene replacement or browser teardown appear in browser logs. They were not 404s, did not correspond to required resources, and produced no console or page errors.
