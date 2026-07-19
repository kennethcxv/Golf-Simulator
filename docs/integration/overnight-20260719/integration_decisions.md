# Integration decisions — 2026-07-19

This is a living decision log. Decisions are recorded before or at the integration unit that implements them.

## Baseline and source-work preservation

1. The recorded `main` (`0c5137e`) is 148 commits behind the active, previously verified integration line (`1dfb9de`). The new integration branch therefore starts from `1dfb9de`; merging it into `main` will preserve the entire verified line rather than silently dropping it.
2. The dirty `integration/all-verified-work-2026-07-18` working copy is user work. It remains untouched and has an external byte-for-byte backup. No uncommitted file is treated as branch content.
3. The uncommitted course-editor overlay is not accepted. Although focused unit tests and the headed production/utility gates pass, the normal browser stroke gate proves undo does not restore the exact terrain hash. The committed `4c17058` implementation is canonical.

## Canonical subsystem choices

- **Checkout:** use `checkout-polish` presentation, asset, stock, queue, receipt, payment, and lifecycle work as the base, then replace its automatic product scan/stage shortcut with one player-driven hold → orient → cross scan zone → place on bagging mat flow. Acceptance is the strict normal-control card and cash driver, not internal state mutation.
- **Save/load:** use `save-stability` as the canonical versioned recovery/migration layer, while preserving the existing scene-start lifecycle wrapper contract that its branch accidentally removes or obscures.
- **Assets 51–100:** use `assets-51-100-runtime` as the canonical manifest, loader/cache, and placement implementation. No new GLBs are introduced by that branch; it integrates already-authored production assets.
- **First-person cleaning:** use the shared framework from `cleaning-gameplay` for equip/unequip, hand sockets, target validation, effects, audio, persistence, and teardown. Do not retain tool-specific parallel managers.
- **Course editor:** use the committed spatial-index/worker implementation from `course-editor-performance`. The later dirty overlay is reference-only until its undo mutation bug is fixed independently.
- **Course visuals:** layer `course-visuals` onto the canonical editor implementation and resolve `courseScene.js` by preserving both editor behavior and renderer/terrain polish.
- **Management:** keep the existing `club`, `turf`, `finance`, and checkout authorities; accept only the branch’s connection/UI layer. It may land only after checkout passes its production gate.
- **QA:** retain worktree-aware and port-configurable drivers. Reports describing an older branch state remain evidence, not runtime truth.

## Overlap classification

| File / area | Branches | Classification | Resolution rule |
|---|---|---|---|
| `src/render3d/courseScene.js` | checkout, course visuals, assets, cleaning, course editor | compatible additive changes plus architectural conflict | integrate in dependency order; read each conflicting hunk and keep one scene lifecycle, canonical editor acceleration, tool hooks, checkout prewarm, asset placements, and visual renderer changes |
| `src/main.js` | save, checkout, course visuals, cleaning | compatible lifecycle additions with behavioral risk | retain one startup/shutdown path and one input ownership flow; add regression tests for wrappers/listeners |
| `src/render3d/clubhouse.js` | save, checkout, assets, cleaning | compatible additions with resource-lifecycle conflict risk | one asset cache and clubhouse teardown path; run repeated-enter/exit resource checks after each unit |
| `simplifiedRegisterMode.js` | save, checkout, assets | same subsystem, complementary fixes | checkout is the presentation base; manually preserve save resume plus asset watchdog/timing fixes |
| `shopLayout.js`, fixtures | checkout, assets | compatible additive | retain distinct placement records, deduplicate IDs and runtime loads |
| `propPlacement.js` | assets, cleaning | compatible additive | assets owns manifest/placement; cleaning adds surface/tool hooks without a second registry |
| `fpHands.js`, `toolViewmodel.js` | checkout/cleaning/assets | visual and behavioral overlap | cleaning owns shared tool/viewmodel lifecycle; checkout handoffs use the shared sockets |
| `src/sim/shop.js` | save, cleaning | save-schema and behavioral overlap | preserve migrations and cleaning state through the existing shop authority |
| `src/styles.css` | management, course editor | compatible additive with selector-collision risk | retain namespaced UI rules; run both laptop and editor routes |
| QA drivers | several branches | same test, different implementation | use newest worktree-aware driver that exercises normal controls; merge unique assertions, never weaken a gate |
| generated screenshots/reports | all | generated-output conflict | keep durable summaries and selected final evidence; do not commit disposable duplicates |

## Asset decisions

- The checkout scanner change is accepted as an asset candidate: both shipped GLB copies are byte-identical (`018205d8…`), 516.0 KiB, 15 nodes, 11 meshes, 1,674 triangles, six materials, three embedded textures, no cameras/lights, identity mesh transforms, a collision node, and `SCAN_RAY_ORIGIN`. Blender 5.1.2 clean reimport passes.
- The scanner preview contains an absolute authoring path in PNG metadata. That metadata must be stripped before integration; the pixels need not change.
- The full checkout-kit reimport currently reports 47/48 because the pre-existing `bag_display` export lacks the validator-required node `Deck`. This is a real production gate to repair or reconcile before final acceptance.
- No third-party asset download is authorized or used.

## Rejected work

- Course-editor dirty overlay: rejected from this pass because exact undo integrity fails (`before=1798128313`, `afterUndo=2296856323`; redo does match the edited hash). Its external backup and source worktree are retained.
- Automatic checkout scan/stage behavior: rejected even though branch unit tests pass, because it bypasses the player gesture required by the production checkout contract.

## Repository hygiene decisions

- Tracked Python bytecode under `tools/blender/__pycache__` is generated cache and will be removed from the integrated branch; standard Python cache ignore rules will be added.
- Hard-coded `C:\Users\Kenneth\...` paths in reusable QA drivers are machine-specific. Drivers selected for integration will resolve from their worktree/repository root and accept explicit output/URL configuration.
- The existing Electron dependency audit reports one high-severity advisory whose available remediation is a major-version change. Dependency versions are unchanged by the overnight branches; the final report will document the result instead of making an unrelated major upgrade without compatibility validation.
