---
name: browser-game-visual-qa
description: Run repeatable functional and visual QA for Golf Flipper in a real browser using Playwright. Use after gameplay, UI, interaction, lighting, material, camera, or 3D asset changes and before claiming a browser-game visual task complete.
---

# Browser Game Visual QA

## Required loop

1. Launch the actual game with Playwright through the repository's normal start path.
2. Define and reuse fixed player-camera positions, viewport, resolution, device scale factor, game state, and lighting or time conditions.
3. Capture a timestamped baseline before changes and preserve it for side-by-side comparison.
4. Exercise normal mouse and keyboard controls to reach and use the feature. Only use a documented fixture to establish repeatable state.
5. Inspect console errors and warnings, page errors, failed requests, and relevant game logs.
6. Capture screenshots from every fixed camera and compare them with the baseline and intended references.
7. List at least ten specific visible defects ranked by player impact, including screen location and observable symptom.
8. Fix the listed defects in a focused pass without masking functional regressions.
9. Repeat steps 1–8 for at least four complete baseline/inspect/fix/compare iterations. Use fresh screenshots and a new defect list each time.
10. Run the normal gameplay path again after the fourth pass and retain final screenshots.

Count an iteration only when it includes a launched game, normal-control test, console check, fixed-camera screenshots, explicit comparison, visible-defect review, and fixes. If blocked, report the block; do not lower the four-pass requirement or claim completion.

## Visual checklist

Check composition, scale, silhouette, clipping, z-fighting, alignment, pivots, materials, textures, lighting, shadows, readability, UI hierarchy, prompts, animation, feedback, and style consistency from the player camera.

## Deliverable

Report the launch command, camera definitions, baseline and final screenshot paths, console findings, all four iteration summaries, ten-or-more defects per iteration, fixes, unresolved defects, and final normal-controls result.
