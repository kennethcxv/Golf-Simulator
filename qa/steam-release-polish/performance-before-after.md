# Checkout Performance Before/After

## Protocol

- Browser: Google Chrome via isolated Playwright context
- Viewport: 1600×900, device scale factor 1
- Quality: runtime default
- Fixture: relaxed seed 424242, Willow Creek, fully stocked sale inventory, two-item card customer
- Time: 14:00 under runtime default weather
- Cameras: fixed cashier approach and authored register focus pose
- Warm-up: loading veil complete, 3.3 seconds route settling, then renderer geometry/texture counts unchanged for four consecutive 500 ms samples
- Sample durations: five seconds idle, eight seconds register-active, five seconds after 25 Escape/`E` transitions
- Frame source: timestamps around the actual `scene3d.render` loop
- Render source: accumulated `WebGLRenderer.info.render` deltas across every renderer pass within each game frame
- Texture memory: estimated decoded RGBA8 bytes plus mipmaps from unique live image dimensions; this is an estimate, not a driver-reported VRAM value
- Heap: Chrome `performance.memory.usedJSHeapSize`
- Listeners: net wrapped `EventTarget.addEventListener/removeEventListener` counts

Raw runs:

- `baseline/performance-game-frame-1.json`
- `baseline/performance-game-frame-2.json`
- `baseline/performance-game-frame-3.json`

## Baseline raw values

| Run | Idle FPS | Idle 1% low | Idle worst | Idle draws | Idle triangles | Active FPS | Active 1% low | Active worst | Active draws | Active triangles |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 60.31 | 39.37 | 27.40 ms | 4,948 | 5,667,031 | 116.88 | 73.53 | 46.80 ms | 3,907 | 5,835,071 |
| 2 | 60.21 | 31.35 | 38.70 ms | 4,957 | 5,667,279 | 117.75 | 78.74 | 16.60 ms | 3,918 | 5,848,833 |
| 3 | 73.78 | 54.35 | 22.50 ms | 4,909 | 5,666,012 | 111.69 | 67.11 | 42.60 ms | 3,907 | 5,838,390 |

## Final raw values

Raw runs:

- `iteration-4-hardening/performance-final/run-1/result.json`
- `iteration-4-hardening/performance-final/run-2/result.json`
- `iteration-4-hardening/performance-final/run-3/result.json`

| Run | Idle FPS | Idle 1% low | Idle worst | Idle CPU | Idle draws | Active FPS | Active 1% low | Active worst | Active CPU | Active draws | Active triangles | 25-cycle geometry delta |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 30.05 | 23.42 | 46.50 ms | 32.30 ms | 4,943 | 81.29 | 49.50 | 151.90 ms | 11.21 ms | 3,909 | 5,843,042 | +9 |
| 2 | 25.90 | 13.39 | 97.00 ms | 37.49 ms | 4,939 | 80.62 | 42.55 | 32.20 ms | 11.64 ms | 3,850 | 5,847,370 | +9 |
| 3 | 26.94 | 6.55 | 227.90 ms | 35.84 ms | 4,969 | 58.35 | 14.58 | 120.40 ms | 16.07 ms | 3,938 | 5,838,839 | +9 |

## Historical comparison

| Metric | Baseline median | Final median | Absolute delta | Percent delta |
|---|---:|---:|---:|---:|
| Idle average FPS | 60.31 | 26.94 | -33.37 | -55.3% |
| Idle 1% low FPS | 39.37 | 13.39 | -25.98 | -66.0% |
| Idle worst frame | 27.40 ms | 97.00 ms | +69.60 ms | +254.0% |
| Idle CPU render | 16.06 ms | 35.84 ms | +19.78 ms | +123.2% |
| Idle draw calls | 4,948 | 4,943 | -5 | -0.1% |
| Idle triangles | 5,667,031 | 5,666,908 | -123 | -0.0% |
| Register average FPS | 116.88 | 80.62 | -36.26 | -31.0% |
| Register 1% low FPS | 73.53 | 42.55 | -30.98 | -42.1% |
| Register worst frame | 42.60 ms | 120.40 ms | +77.80 ms | +182.6% |
| Register CPU render | 7.08 ms | 11.64 ms | +4.56 ms | +64.4% |
| Register draw calls | 3,907 | 3,909 | +2 | +0.1% |
| Register triangles | 5,838,390 | 5,843,042 | +4,652 | +0.1% |
| Register scene nodes | 1,539 | 1,565 | +26 | +1.7% |
| Register geometries | 1,138 | 1,148 | +10 | +0.9% |
| Register materials | 268 | 272 | +4 | +1.5% |
| Register textures | 182 | 182 | 0 | 0.0% |
| Estimated unique decoded image data | 5.91 GiB | 5.91 GiB | 0 | 0.0% |
| Register used JS heap | 134.3 MiB | 123.7 MiB | -10.6 MiB | -7.9% |
| Listener growth after 25 transitions | 0 | 0 | 0 | 0.0% |

The historical FPS samples are not a valid code-regression verdict by themselves. During the final runs the host was at roughly 73–74% CPU from unrelated Golf Flipper worktrees and browser-MCP sessions, including several multi-gigabyte Chrome renderer/GPU processes. Deterministic workload stayed flat (draw calls and triangles within 0.1%), while wall-clock CPU time and FPS varied sharply between adjacent runs.

## Contemporaneous paired control

To isolate the code change from that contention, commit `475b51c` (pre-iteration-4) was served from a temporary detached worktree and measured with the current harness, immediately followed by the final build. Proposed gate: deterministic workload within 2%, adjacent FPS within 5%, no listener/texture growth, and bounded renderer geometry after repeated transitions.

| Metric | Pre-iteration-4 control | Final adjacent | Delta | Result |
|---|---:|---:|---:|---|
| Idle average FPS | 46.49 | 47.94 | +3.1% | Pass |
| Idle 1% low FPS | 36.36 | 37.88 | +4.2% | Pass |
| Idle CPU render | 20.86 ms | 20.22 ms | -3.1% | Pass |
| Idle draw calls | 4,944 | 4,979 | +0.7% | Pass |
| Idle triangles | 5,666,936 | 5,667,849 | +0.0% | Pass |
| Register average FPS | 108.72 | 110.24 | +1.4% | Pass |
| Register 1% low FPS | 82.64 | 85.47 | +3.4% | Pass |
| Register CPU render | 8.68 ms | 8.55 ms | -1.5% | Pass |
| Register draw calls | 3,881 | 3,878 | -0.1% | Pass |
| Register triangles | 5,848,145 | 5,848,097 | -0.0% | Pass |
| Register used JS heap | 120.8 MiB | 108.3 MiB | -10.3% | Pass |
| Renderer geometry growth after 25 transitions | +132 | +9 | -93.2% | Pass |
| Renderer texture growth after 25 transitions | 0 | 0 | 0 | Pass |
| Listener growth after 25 transitions | 0 | 0 | 0 | Pass |

Paired raw results:

- `iteration-4-hardening/performance-control-current-load/run-1/result.json`
- `iteration-4-hardening/performance-final/control-adjacent/result.json`

## Lifecycle and UI-update gate

The final 100-cycle soak completed 100/100 normal Escape/`E` re-entries, with zero listener growth, zero texture growth, a stable post-run renderer sample, and +9 renderer geometries versus +194 before the disposal fix. Used heap fell by 63.17 MiB across the measured stress interval. Register canvas activity is event-driven: the active eight-second samples recorded zero `fillText`, seven `fillRect`, and zero `getImageData` calls; the post-transition five-second sample recorded zero, five, and zero respectively. No register canvas is redrawn per frame.

Result: the checkout changes pass the performance regression gate. The remaining thousands of draw calls, millions of triangles, 5.91 GiB decoded-image estimate, and known Chromium/ANGLE X4000 warning are project-wide follow-up risks, not regressions introduced by this checkout increment.
