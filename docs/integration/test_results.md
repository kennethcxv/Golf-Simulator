# Test results

## Full suite

| Run | Tests | Pass | Fail | Skipped | Duration |
|---|---|---|---|---|---|
| **Baseline** (pre-integration working tree, `25fbdce` + dirty) | 1641 | 1641 | 0 | 0 | 267.6 s |
| **Integration branch** (final, `bcb718b`) | **1658** | **1658** | **0** | **0** | — |

Command: `npm test` → `node --test` over 240 test files.

Net +17 tests, all from the integrated course work:

- `tests/terrainNormals.test.js` — 7 tests, new module
- `tests/courseEditorOpRect.test.js` — new
- `tests/input-drift.test.js` — extended by `3a230a0`

**No test was weakened, skipped, deleted or relaxed to make the branch pass.**
No test file was modified during conflict resolution. The only test files that
changed are the three above, all arriving as part of integrated commits.

## Focused runs during integration

Run after each risky merge, before committing:

| Stage | Scope | Result |
|---|---|---|
| After perf-group conflict resolution | `terrainNormals` + `courseEditorOpRect` + `input-drift` | **25/25 pass** |
| After perf-group conflict resolution | all course/terrain/editor/grass/water tests | **198/198 pass** |
| After pond composite (`813ede4`) | water-reflection-guard, course, courseLandscape | **20/20 pass** |
| After boundary composite (`bcb718b`) | all course/terrain/grass tests | **195/195 pass** |

## Static checks

`node --check` on every file touched by a merge or manual resolution:

```
src/render3d/courseScene.js   OK
src/ui/courseEditor.js        OK
src/sim/courseEditor.js       OK
src/render3d/terrainNormals.js OK
src/main.js                   OK
```

Conflict-marker sweep after resolution: **0 markers** in both conflicted files
(`grep -c '^<<<<<<<\|^=======$\|^>>>>>>>'` → 0).

## Semantic verification of the merge resolution

Parsing clean is not evidence the resolution is correct. Verified explicitly that
the incoming implementation is wired, not merely present:

| Check | Result |
|---|---|
| `growStrokeRect` defined / used | 1 / 3 |
| `takeLiveRect` defined | 1 |
| `terrainNormals.js` imported by courseScene | 1 |
| `computeHeightfieldNormals` exported & imported | yes |
| `markTerrainAttributeRange` used | 3 |
| `opCellRect` in `src/sim/courseEditor.js` | 3 |
| Discarded path `reReliefsculpt ? null` remaining | **0** |
| Orphaned `stroke.rect` references | 3 — all legitimate (see below) |

The three surviving `stroke.rect` references are part of the incoming design's
dual-rect scheme, not leftovers: `takeLiveRect()` falls back from the per-tick
`liveRect` to the cumulative `rect`; stroke-end deliberately uses the cumulative
rect so one commit refresh covers everything the whole stroke touched.

## Numeric verification

The `placeSpot` regression fix was verified by computing both profiles rather
than by inspection:

| outside (yd) | ring surface | tree base (old) | buried | tree base (fixed) | embed |
|---|---|---|---|---|---|
| 0.01 | 14.85 | 14.50 | 0.35 | 14.35 | 0.50 |
| 24 | 14.86 | 13.13 | 1.73 | 14.36 | 0.50 |
| 64 | 14.98 | 10.92 | 4.06 | 14.48 | 0.50 |
| 128 | 15.69 | 7.58 | 8.11 | 15.19 | 0.50 |
| 200 | 17.07 | 4.10 | 12.97 | 16.57 | 0.50 |
| 272 | 18.11 | 1.61 | **16.50** | 17.61 | 0.50 |

Uniform 0.50 yd embed after the fix, at every distance.

## Not run

Declared rather than glossed. The following Phase 10 items were **not** executed:

- **Blender generation tests / clean Blender reimport.** Requires a Blender
  install driven headless; not invoked. The assets arrived pre-built and their
  `clean_reimport.json` evidence (produced 12:18 by the source session) is
  preserved in `refs/integration-audit/qa-evidence`, but was **not regenerated**
  on this branch.
- **GLB parser and ship gates** as a standalone pass. GLB-related assertions
  inside the Node suite ran and passed as part of the 1658; no separate gate was
  invoked.
- **Browser shader boot** beyond what the perf probe exercised. The probe did
  boot the app in Chromium, load a course, and report zero page errors — that is
  real evidence of shader compilation succeeding, but it is a single scene.
- **Checkout smoke test, pressure-washer acceptance, cleaning-tool acceptance**
  as live driver runs. Their unit/contract tests ran within the 1658; the
  Playwright acceptance drivers were not invoked.
- **Save/reload and lifecycle tests** as live driver runs — unit coverage only.

See `runtime_qa.md` for exactly which runtime behaviours were and were not
exercised.
