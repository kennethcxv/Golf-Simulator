---
name: performance-regression
description: Measure and prevent Golf Flipper runtime performance regressions. Use before and after changes to visuals, assets, rendering, UI, interactions, event handling, or game systems, and whenever evaluating whether an optimization or visual improvement is safe.
---

# Performance Regression

## Measurement protocol

Measure the same representative gameplay scenario before and after the change. Fix build mode, browser, hardware, viewport, resolution, device scale factor, quality settings, save fixture, camera route, duration, and warm-up period. Run enough samples to reduce noise and retain raw results.

Record for both runs:

- Average FPS
- 1% low FPS
- Worst frame time in milliseconds
- Draw calls
- Rendered triangles
- Material count
- Texture memory
- JavaScript heap usage
- Active event-listener count, including growth after repeated interactions
- UI update frequency for relevant panels or components

Use engine instrumentation, browser performance tooling, and repository diagnostics where available. Document the exact source and units for each metric. If unavailable, add safe instrumentation or explicitly mark it unmeasured; never infer or silently omit it.

## Test scenarios

- Capture an idle fixed-camera scene after warm-up.
- Capture a representative normal-gameplay route that stresses the changed feature.
- Repeat relevant interactions enough to reveal heap, listener, and UI-update leaks.
- For visual asset changes, include the highest expected on-screen instance count.
- Inspect frame-time spikes as well as averages.

## Regression gate

Create a before/after table with absolute and percentage deltas. Investigate any material regression, unstable run, unbounded heap or listener growth, or unnecessary UI updates. Prefer repository budgets; otherwise state a proposed tolerance and rationale before judging results.

Do not claim a change complete with missing measurements or degraded performance. Optimize or narrow the change, rerun the identical protocol, and report remaining tradeoffs.
