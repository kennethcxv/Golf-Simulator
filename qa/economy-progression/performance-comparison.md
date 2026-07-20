# Performance comparison

## Acceptance gate

Before the accepted reruns, the gate was set to:

- average FPS and 1% low FPS no more than 10% below base;
- worst-frame time no more than 25% worse;
- no active-listener growth after 24 rapid page switches;
- no material draw-call, triangle, material, or texture regression;
- bounded heap and no unnecessary UI-update growth.

The original sequential final sample was rejected because the shared host was running unrelated Playwright suites at 70-100% CPU. A 15-minute guard never found an eight-second interval below 25% CPU. To control that environment instead of guessing, two accepted pairs ran base and current simultaneously. Each pair used the same physical hardware/GPU instant, Chrome 150.0.7871.127, 1600x900 viewport, DPR 1, deterministic seed, eight-day real fixture, fixed clubhouse camera, video capture, 8-second samples, and 24 projected Home/Finances/Reviews/Pricing clicks. Both pairs launched only after no other `tools/qa` Node process was active.

Simultaneous execution lowers absolute throughput by making the two scenes compete, but it gives a controlled within-pair regression comparison. The table reports the mean of both pairs; both individual pairs independently favor current.

## Accepted result

### Idle fixed clubhouse camera

| Metric | Base `0c5137e` | Current `20a20c8` | Delta | Delta % |
| --- | ---: | ---: | ---: | ---: |
| Average FPS | 112.78 | 133.94 | +21.16 | +18.77% |
| 1% low FPS | 48.42 | 62.16 | +13.74 | +28.37% |
| Worst frame | 38.90 ms | 29.30 ms | -9.60 ms | -24.68% |
| Average draw calls | 1,456.70 | 1,255.44 | -201.26 | -13.82% |
| Rendered triangles | 6,233,684.5 | 6,007,468.0 | -226,216.5 | -3.63% |
| Materials | 316.5 | 266.0 | -50.5 | -15.96% |
| Textures | 171 | 170 | -1 | -0.58% |
| Approx. texture memory | 6,083,003,797 B | 6,081,256,171 B | -1,747,626 B | -0.03% |
| JS heap | 85,934,084.5 B | 82,751,988.5 B | -3,182,096 B | -3.70% |
| UI mutations/s | 0 | 0 | 0 | - |

### Rapid laptop navigation

| Metric | Base `0c5137e` | Current `20a20c8` | Delta | Delta % |
| --- | ---: | ---: | ---: | ---: |
| Average FPS | 105.88 | 155.92 | +50.04 | +47.26% |
| 1% low FPS | 24.70 | 30.58 | +5.88 | +23.78% |
| Worst frame | 131.95 ms | 77.70 ms | -54.25 ms | -41.11% |
| Average draw calls | 1,407.24 | 1,172.97 | -234.27 | -16.65% |
| Rendered triangles | 4,587,175.0 | 4,567,845.5 | -19,329.5 | -0.42% |
| Materials | 324.0 | 266.0 | -58.0 | -17.90% |
| Textures | 171 | 170 | -1 | -0.58% |
| Approx. texture memory | 6,083,003,797 B | 6,081,256,171 B | -1,747,626 B | -0.03% |
| JS heap | 96,488,951.5 B | 87,959,992.5 B | -8,528,959 B | -8.84% |
| UI mutations/s | 9.00 | 9.24 | +0.24 | +2.72% |

Active registrations were 101 before/after on base and 93 before/after on current in each pair. There is no listener-growth signal. The small mutation-rate delta is below the declared materiality threshold and corresponds to additional causal finance/reputation content; it is not a polling loop.

### Individual pair FPS

| Pair | Base idle | Current idle | Base rapid nav | Current rapid nav |
| --- | ---: | ---: | ---: | ---: |
| 1 | 139.09 | 170.18 | 126.19 | 184.85 |
| 2 | 86.47 | 97.71 | 85.56 | 126.98 |

All four reports have 8.00-second idle and navigation windows, zero console errors, zero page errors, stable listeners, screenshots, and videos. Raw reports are retained in `paired-base-1/`, `paired-final-1/`, `paired-base-2/`, and `paired-final-2/`.

## Corroborating and rejected samples

- The pre-polish clean iteration-3 sample recorded 213.94 idle average FPS and 266.22 rapid-navigation average FPS, with 119.70/119.97 1% lows and 8.4 ms worst frames. It corroborates that the laptop path can run well above 60 FPS when the host is free.
- `final-performance/` is retained but rejected for the gate: outside suites saturated the host around that run, producing an 86.62 FPS rapid-navigation average and a 9.66 FPS 1% low.
- `iteration-4/` and `final-browser/` performance fields are also rejected because they ran during measured host saturation. Their functional screenshots and error audits remain valid.
- `final-accepted/` used one-second samples for final visual acceptance, not performance judgment.

## Metric sources

- Frame timing: `requestAnimationFrame` intervals for fixed-duration windows.
- Draw calls/triangles: `THREE.WebGLRenderer.info.render`, sampled each frame.
- Materials/textures: unique live scene identities after traversal.
- Texture memory: width x height x RGBA8 x faces x 4/3 mip estimate; not driver allocation.
- Heap: Chromium `performance.memory.usedJSHeapSize` with precise-memory instrumentation.
- Listeners: instrumented `EventTarget` registrations; exact before/after growth is the leak signal.
- UI updates: `MutationObserver` records under `.laptop-screen`.

**Gate result: PASS.** Current is faster in both accepted scenarios, uses fewer render resources on every tracked scene measure, has lower two-pair mean heap, and shows no listener leak.
