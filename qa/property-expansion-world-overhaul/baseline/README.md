# Baseline Evidence

This directory is the immutable pre-implementation record for `overnight/property-expansion-world-overhaul`, captured from start commit `0c5137e5f0efac9627ce2309b9e66936f1eeb769` on 2026-07-19.

- `01`–`18`: requested fixed-scene player-camera views.
- `19-performance-fixed-camera.png`: the matched visual used for baseline sampling.
- `baseline-result.json`: viewport, camera fixture, screenshot manifest, performance samples and unfiltered diagnostics.
- `blender/asset-audit.json`: Blender 5.1.2 hierarchy, transform, UV, bounds, triangle/material and production-readiness audit.
- `blender/*.png`: neutral isolated previews rendered by the repeatable audit script.

The browser fixture is deterministic at 1600×900, device scale 1, 14:00, world anchor `bx=-8`, `bz=228`. It uses normal controls to enter player-facing modes; setup code only seeds otherwise time-consuming inventory/customer/delivery state.

Rebuild browser evidence with `tools/qa/property-overhaul-baseline.js`. Rebuild the read-only asset audit with:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background --factory-startup --python tools/blender/audit_property_overhaul_assets.py
```

The asset script imports existing GLBs and writes only under this QA folder. It never overwrites source assets.
