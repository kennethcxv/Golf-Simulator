# Runtime QA

This document separates **what was actually exercised at runtime on the
integration branch** from what was not. Phase 9 lists an extensive manual QA
matrix; a substantial part of it was not performed, and this file says so
explicitly rather than implying coverage.

## Verified at runtime

Exercised by `tools/qa/course-editor-stroke-perf.js` driving a real Chromium
session against the integrated tree (2026-07-18 22:24, probe `ok: true`):

| Behaviour | Evidence |
|---|---|
| App boots | probe reached the menu and ran to completion |
| Autosave bootstrap → owned property → Continue | `--bootstrap` path succeeded |
| A course loads and renders | drag phase captured 225 frames |
| Course Editor opens | `.ced-top` / `.ced-tool` selectors resolved |
| Terrain sculpt via real pointer events | 225-frame drag through the editor's own handlers |
| Undo after a terrain edit | `undoIntegrity` block populated |
| **Undo leaves no stale sculpt** | **0 differing components of 1,040,403; max delta 0 yd** |
| No hard terrain hitch | **0 frames over 100 ms**; worst 41.6 ms |
| Terrain-edit FPS | **136.3 average** |
| No console errors | `diagnostics.console: []` |
| No page errors | `diagnostics.pageErrors: []` |
| Shaders compile | scene rendered; only a pre-existing ANGLE X4000 warning |

That covers, from the Phase 9 COURSE list: open editor, sculpt continuously,
undo, no hard terrain hitch, measure terrain-edit FPS and worst frame, no stale
sculpt after undo.

## NOT verified at runtime

Everything below was **not** driven on this branch. Unit and contract tests cover
much of it (all 1658 passed), but that is not the same as a runtime smoke test,
and it is not claimed as one.

**Course**
- Load all nine holes (one course was loaded, not nine)
- Paint surfaces; add/edit green, tee, bunker, water
- Redo (undo was exercised; redo was not)
- Flyover
- Enter playtest
- Save and reload from the editor
- **No visible hard property edge** — this is a visual criterion. The colour fix
  is verified *numerically* (ring:terrain luminance ratio 1.00× flat across the
  luma range, computed sRGB→linear) but was **not** confirmed by looking at a
  screenshot on this branch.
- **No circular fallback ponds** — verified *structurally* by reading the merged
  control flow: `CircleGeometry` now sits behind the raster tracer, and a
  single-cell component emits four edges so the `length >= 3` guard always
  passes, making the disc unreachable. **Not** confirmed visually.

**Assets 1–50 / 51–100**
- Canonical vs runtime GLB match, socket/animation presence, clean reimport,
  Sheets 7–10 registry entries, props visible in the clubhouse, collisions and
  mounting, customer carry, delivery and packaging — none re-verified at runtime.
  The source session's own evidence (screenshots at 12:35, `clean_reimport.json`
  at 12:18, derived status `sceneMounted 10 → 40`) is preserved in
  `refs/integration-audit/qa-evidence` but was **not regenerated** here.

**Cleaning**
- Equipping every tool, viewmodel/grip correctness, effects originating from
  sockets, no cleaning through walls, washer jet and mist, vacuum attraction,
  broom piling, dustpan collection, mop wetness, drying, spray gating, cloth and
  sponge contact, trash bag fill/disposal, audio loops stopping on release and
  unequip — **none exercised at runtime.**

**Checkout**
- One card transaction, one cash transaction, scanning, drawer, card reader,
  receipt, bag handoff, customers and queue — **none exercised at runtime.**

## Risk assessment for the unverified areas

The cleaning and checkout systems arrived as a **single coherent working tree that
was already green** (1641/1641 at baseline) and produced by a session that ran its
own acceptance drivers. This integration did not modify a single line of that
code — it was committed verbatim, split by workstream for reviewability. Tree
equality against the safety snapshot proves this: excluding the intentional
`.gitignore` change and one deliberately-excluded stray screenshot, the integration
tip is byte-identical to the captured working tree.

So the runtime risk for cleaning/checkout is **not** "did the merge break it" —
nothing merged into it. The residual risk is that those systems were never
independently verified by this audit, only by their originating session.

The genuine merge risk is concentrated in the course files, which is where runtime
verification *was* performed:

| File | Merged? | Runtime-verified here |
|---|---|---|
| `src/render3d/courseScene.js` | yes — 3 separate merges | yes (drag + undo + boot) |
| `src/ui/courseEditor.js` | yes — 2 conflicts | yes (editor opened, sculpt driven) |
| `src/sim/courseEditor.js` | yes — clean | yes (undo integrity) |
| `src/main.js` | yes — auto-merged | yes (boot, editor entry) |
| `src/render3d/clubhouse.js` | **no** — bridge hunks rejected | not driven |
| `src/data/cleaningTools.js` | **no** — committed verbatim | not driven |

## Recommended before merging to main

1. Boot the app manually; walk the clubhouse and confirm the 30 placed props are
   visible and mounted.
2. Equip each cleaning tool once; confirm the viewmodel, socket-origin effects
   and that audio loops stop on release.
3. Run one card and one cash transaction end to end.
4. Open the Course Editor, paint and stamp a feature, redo, flyover, playtest,
   then save and reload.
5. Look at the property boundary and a pond, on screen, at distance.
