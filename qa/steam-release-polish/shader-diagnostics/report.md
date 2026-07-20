# ANGLE Shader Diagnostic Disposition

## Outcome

`H-010` is resolved. Normal boot no longer emits the Chromium/ANGLE X4000
warning, and the existing Canvas2D warning fixes remain intact.

## Root cause and fix

The diagnostic harness captured the compiled WebGL program and traced X4000 to
Three r185's `PoissonDenoiseShader`. `GTAOPass` leaves its `index` uniform at the
default value of zero, but the shader dynamically evaluated
`noiseTexel[index % 4]`. ANGLE generated a helper with an uninitialised fallback
branch even though this pass always reads the red channel.

`src/render3d/shaderPatches.js` now patches only the GTAO denoise material
instance from the dynamic expression to the equivalent `noiseTexel.x`. Vendor
files remain untouched, and focused tests make the version-specific patch
explicit and idempotent.

## Evidence

- `result.json`: instrumented baseline boot, including the program log and the
  exact dynamic-index source line.
- `final/result.json`: the same instrumented boot after the patch; program and
  runner diagnostic arrays are empty.
- `performance-control-adjacent/result.json`: detached `778d7a9` control.
- `performance-final-adjacent/result.json`: patched build run immediately after
  the control.
- `performance-confirmation/result.json`: production-settle confirmation with
  25/25 normal-control re-entries, no listener growth, negative heap growth, a
  stable renderer resource plateau, and no runner diagnostics.

The adjacent active-register comparison held the same 4,554 average draw calls
and 6,099,754 average triangles. Average FPS moved from 95.63 (control) to 96.43
(patched), with CPU render time moving from 9.94 ms to 9.85 ms. This is no
measured rendering regression.

The shortened 300 ms patched probe recorded one delayed normal re-entry and then
recovered through the harness. The production 600 ms confirmation recorded zero
failures across all 25 cycles; the raw shortened probe is retained rather than
discarded.
