# Pro-shop performance acceptance

Accepted on 2026-07-20 against `overnight/pro-shop-overhaul`.

## Protocol

- Command: `node tools/qa/pro-shop-overhaul.mjs --pass=performance-acceptance --hardware --renovated --customers=10 --perf-only --samples=3 --perf-idle=6 --perf-walk=4 --laptop-cycles=30`
- Browser: Chrome 150.0.7871.127, headless, ANGLE D3D11 hardware acceleration.
- Viewport: 1600 x 900, DPR 1, unchanged quality settings.
- Normal entry: New Empire (Relaxed) -> Property Market -> buy Willow Creek Municipal -> first-person canvas controls.
- Fixed state: 2:00 PM, tier 3, all 42 retail lines stocked (289 units), fixed cameras, three-second initial warm-up.
- Empty scenario: tier-1 empty shop at the entrance camera, three six-second samples.
- Stress scenario: tier-3 full shop; each sample independently clears the floor, spawns exactly ten shoppers, settles navigation and animation for 16 seconds, then records six seconds at the fixed centre camera.
- Gameplay scenario: same full tier-3 scene and customer population, fixed entrance reset before each four-second forward walk, three samples.
- Interaction soak: warm the persistent laptop and thumbnail renderer, then open/close 30 times; visit Inventory every fifth cycle. Compare heap, connected/global/offscreen-canvas listeners, roots, visible overlays, and camera lens before/after.
- UI update frequency is MutationObserver records per second under `.shop-overlay`, not an inferred timer rate.
- Texture memory is an estimate from live texture dimensions as RGBA8 plus a 4/3 mip allowance; compressed allocation and driver overhead are unavailable.

The comparison baseline is `acceptance-visual-1-before/run.json`: the earliest valid same-browser, same-viewport D3D11 capture. It contains one sample per scenario, so percentage deltas are directional rather than a statistical confidence interval. The rejected SwiftShader captures that sampled zero or one frame are excluded.

## Gates declared before sampling

- Exactly ten active shoppers in every stress sample.
- Average/1%-low FPS floors: empty 90/30, stress 12/5, normal walk 45/12.
- Worst frame below 250 ms in stressed and walking scenarios.
- Median render-structure/resource growth no more than 15% from the valid baseline unless explained.
- Thirty of thirty laptop cycles; one laptop root; no visible leftover; exact FOV/near restoration; zero active-listener growth; heap delta no more than 24 MiB.
- UI mutation frequency remains bounded below 300 records/s.

## Raw accepted samples

| Scenario | Sample | Active shoppers | Avg FPS | 1% low FPS | Worst ms | Draw calls/frame | Triangles drawn/frame | Scene triangles | GPU geometries | GPU textures | Heap MiB | Listeners | UI records/s | Travel yd |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Empty basic idle | 1 | 0 | 119.16 | 117.65 | 16.7 | 1,901.02 | 5,013,853.04 | 1,758,407 | 871 | 213 | 60.88 | 81 | 239.00 | - |
| Empty basic idle | 2 | 0 | 119.66 | 117.65 | 16.7 | 1,871.00 | 5,011,738.00 | 1,758,407 | 871 | 213 | 61.91 | 81 | 239.67 | - |
| Empty basic idle | 3 | 0 | 119.83 | 116.28 | 16.7 | 1,871.00 | 5,011,738.00 | 1,758,407 | 871 | 213 | 64.94 | 81 | 240.33 | - |
| Full premium stress | 1 | 10 | 30.54 | 10.92 | 108.4 | 9,479.65 | 15,912,104.38 | 2,085,424 | 1,320 | 242 | 129.35 | 80 | 61.33 | - |
| Full premium stress | 2 | 10 | 32.67 | 20.00 | 50.0 | 9,566.29 | 15,918,253.94 | 2,085,112 | 1,319 | 242 | 112.55 | 80 | 65.67 | - |
| Full premium stress | 3 | 10 | 33.71 | 23.98 | 91.7 | 9,842.32 | 15,939,489.93 | 2,085,136 | 1,317 | 242 | 129.21 | 80 | 67.67 | - |
| Full premium walk | 1 | dynamic | 114.26 | 59.88 | 66.6 | 2,231.36 | 6,130,301.74 | 2,085,136 | 1,319 | 241 | 106.37 | 80 | 234.50 | 10.66 |
| Full premium walk | 2 | dynamic | 112.26 | 59.88 | 66.6 | 2,164.45 | 6,116,941.21 | 2,085,136 | 1,320 | 241 | 164.48 | 80 | 229.00 | 10.66 |
| Full premium walk | 3 | dynamic | 105.00 | 59.52 | 66.7 | 2,257.81 | 6,060,163.46 | 2,085,678 | 1,299 | 241 | 145.16 | 80 | 215.50 | 10.66 |

All stress samples began measurement with exactly ten active shoppers. The following walks allowed that population to progress naturally. Walking travel was identical in all three samples.

## Median comparison

| Scenario | Metric | Baseline | Accepted median | Delta |
|---|---|---:|---:|---:|
| Empty | Avg FPS | 61.74 | 119.66 | +93.8% |
| Empty | 1% low FPS | 17.15 | 117.65 | +586.0% |
| Empty | Draw calls/frame | 1,846.95 | 1,871.00 | +1.3% |
| Empty | Scene triangles | 1,756,145 | 1,758,407 | +0.1% |
| Empty | GPU geometries | 860 | 871 | +1.3% |
| Stress | Avg FPS | 16.39 | 32.67 | +99.3% |
| Stress | 1% low FPS | 8.00 | 20.00 | +150.0% |
| Stress | Draw calls/frame | 9,274.77 | 9,566.29 | +3.1% |
| Stress | Triangles drawn/frame | 15,985,899.69 | 15,918,253.94 | -0.4% |
| Stress | Scene triangles | 2,074,242 | 2,085,136 | +0.5% |
| Stress | Materials / textures | 333 / 194 | 303 / 194 | -9.0% / 0.0% |
| Stress | GPU geometries / textures | 1,287 / 242 | 1,319 / 242 | +2.5% / 0.0% |
| Stress | Estimated texture MiB | 6,091.66 | 6,091.66 | 0.0% |
| Walk | Avg FPS | 93.75 | 112.26 | +19.7% |
| Walk | 1% low FPS | 40.00 | 59.88 | +49.7% |
| Walk | Draw calls/frame | 1,994.07 | 2,231.36 | +11.9% |
| Walk | Triangles drawn/frame | 5,935,906.62 | 6,116,941.21 | +3.0% |
| Walk | Scene triangles | 2,073,730 | 2,085,136 | +0.6% |
| Walk | Materials / textures | 333 / 194 | 303 / 194 | -9.0% / 0.0% |
| Walk | GPU geometries / textures | 1,285 / 242 | 1,319 / 241 | +2.6% / -0.4% |

The walking median worst-frame value rose from the single baseline sample's 25.2 ms to 66.6 ms, but remained far inside the declared 250 ms gate while average and 1%-low FPS both improved. Heap samples fluctuate with browser garbage collection; the same-process 30-cycle delta below is the leak gate. UI records peaked at 240.33/s, below the declared 300/s bound.

## Repeated interaction and leak result

- Laptop cycles: 30 requested, 30 completed.
- Laptop roots: 1 before, 1 after.
- Visible laptop overlays after close: 0.
- Active event listeners: 85 before, 85 after (delta 0).
- JavaScript heap: 83.92 MiB before, 93.34 MiB after (delta +9.42 MiB).
- Lens: FOV 60 / near 0.15 before and after.
- All six soak assertions passed.
- The harness warms legitimate one-time laptop and thumbnail setup before taking the baseline. Listener snapshots count live connected targets, window/document targets, and persistent offscreen canvases; detached replaced DOM eligible for collection is not mislabeled as active.

The first repeated run exposed a real character-resource leak: ten-customer resets grew `renderer.info.memory.geometries` from 1,565 to 1,830 to 2,092. Customer removal detached character roots but did not dispose their owned procedural geometries/materials. The accepted fix gives each character an idempotent disposer and calls it for shop customers and course golfers. The final stress sequence is flat-to-down at 1,320, 1,319, 1,317.

## Diagnostics and result

The accepted run recorded one D3D shader compiler warning about a potentially uninitialized dynamic index. There were no page errors or HTTP 4xx/5xx responses. Five unrelated GLB requests were aborted when the headless browser context closed; the in-game loaded-asset diagnostics and normal route captures remain successful, so these are classified as teardown-only request aborts.

Result: **PASS**. All declared FPS, worst-frame, resource-growth, listener, heap, UI-frequency, customer-count, interaction, and camera-restoration gates passed.
