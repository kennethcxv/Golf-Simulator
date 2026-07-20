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

## Comparison table

| Metric | Baseline median | Final | Absolute delta | Percent delta |
|---|---:|---:|---:|---:|
| Idle average FPS | 60.31 | Pending | Pending | Pending |
| Idle 1% low FPS | 39.37 | Pending | Pending | Pending |
| Idle worst frame | 27.40 ms | Pending | Pending | Pending |
| Idle CPU render | 16.06 ms | Pending | Pending | Pending |
| Idle draw calls | 4,948 | Pending | Pending | Pending |
| Idle triangles | 5,667,031 | Pending | Pending | Pending |
| Register average FPS | 116.88 | Pending | Pending | Pending |
| Register 1% low FPS | 73.53 | Pending | Pending | Pending |
| Register worst frame | 42.60 ms | Pending | Pending | Pending |
| Register CPU render | 7.08 ms | Pending | Pending | Pending |
| Register draw calls | 3,907 | Pending | Pending | Pending |
| Register triangles | 5,838,390 | Pending | Pending | Pending |
| Register scene nodes | 1,539 | Pending | Pending | Pending |
| Register geometries | 1,138 | Pending | Pending | Pending |
| Register materials | 268 | Pending | Pending | Pending |
| Register textures | 182 | Pending | Pending | Pending |
| Estimated unique decoded image data | 5.91 GiB | Pending | Pending | Pending |
| Register used JS heap | 134.3 MiB | Pending | Pending | Pending |
| Listener growth after 25 transitions | 0 | Pending | Pending | Pending |

## Baseline interpretation

Register mode itself benefits from a fixed camera and runs faster than the free-walk cashier approach, but both views submit marketing-unfriendly scene complexity. The dominant actionable risks are thousands of draw calls, millions of submitted triangles, 268 live materials, many 4096² decoded images, and 494 shadow casters. Optimization must retain the checkout’s visible quality; the final gate will rerun the identical route three times and investigate any degraded metric or unstable resource count.
