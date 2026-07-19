# Player Experience Polish — Pre-change Baseline Audit

Captured 2026-07-19 from `overnight/player-experience-polish` at `0c5137e`, launched with the repository's normal browser server and Google Chrome through Playwright.

## Fixed conditions

- Viewport: 1440 × 900 CSS pixels
- Device scale factor: 1
- Locale: en-US
- Reduced motion: off
- Game time for fixed-camera captures: 2:00 PM
- New-game seed source: deterministic QA `Math.random` stream
- Normal-control proof: a 500 ms `W` press moved the player 1.785 world units
- Browser errors: 0 console errors and 0 page errors
- Browser warnings: 19 repeated Canvas2D readback warnings and 1 shader warning
- Request failures: 4 GLB requests reported `net::ERR_ABORTED` during world loading; all four files exist locally. The model loader intentionally swallows these failures, so the player currently receives neither fallback feedback nor a useful development diagnostic.

## Ranked visible defects

1. **Critical — pause menu has no keyboard ownership.** With the pause menu visible, ten consecutive `Tab` presses left focus on `BODY`; gameplay's global `Tab` handler consumes the key. Keyboard-only players cannot operate Resume, Save, Settings, Controls, or Office. Evidence: `baseline-run.json`, `06-pause-save.png`.
2. **Critical — modal focus escapes into covered UI.** On the property market, the first keyboard target after the modal cycle is the underlying main-menu “New Empire — Realistic” button. The modal has no initial focus, focus trap, or restoration. Evidence: `baseline-run.json`, `01-new-game-property-market.png`.
3. **High — the main menu is visibly a working build.** The screen exposes “Working build — placeholder art,” has no Settings, Credits, Load, or Quit entry, and presents a generic flat background rather than the golf-restoration identity. Evidence: `00-main-menu-1440x900.png`.
4. **High — new game is immediately destructive.** New Empire starts without a confirmation or warning when a save exists; there is no save summary beside Continue. This is visible in the menu's complete action set and confirmed in `src/screens/menu.js`.
5. **High — settings are split across unrelated surfaces.** Pause owns volume/render/FOV/sensitivity; the physical laptop owns interface scale and simplified checkout; audio persists under a separate storage key. Players cannot form one mental model of “Settings.” Evidence: `07-pause-settings.png`, `10-laptop-settings.png`.
6. **High — accessibility essentials are absent.** There is no reduced motion, camera bob, invert Y, global UI scale, larger text, high-contrast mode, or keyboard navigation option. Mouse sensitivity also lacks a visible numeric value. Evidence: `07-pause-settings.png`.
7. **High — laptop mode does not own its UI layer.** The global money/time HUD and tutorial card remain visible over the physical laptop, while the laptop also repeats the current objective. The player sees two objective presentations and background HUD competing with the task. Evidence: `09-laptop-home.png`, `10-laptop-settings.png`.
8. **High — course modes retain irrelevant clubhouse guidance.** Overview and course editor keep the “Open the shop door” tutorial card visible. Mode-specific information does not replace or suppress an unrelated objective. Evidence: `11-course-overview.png`, `12-course-editor.png`.
9. **High — the HUD performs unnecessary work every frame.** Three stable fixed-camera runs averaged 2.073 UI mutation records per rendered frame, almost entirely from the two-chip HUD and shop overlay even when their displayed values did not change. Evidence: `performance/baseline/idle-exterior.json`.
10. **Medium — transient feedback stacks in the aiming area.** Two tutorial-completion notifications remain stacked around the lower center while the objective card and full control ribbon are also present. This obscures the world and creates three competing instruction levels. Evidence: `03-fixed-camera-exterior-hud.png` through `05-fixed-camera-checkout.png`.
11. **Medium — duplicate overview instructions compete.** Overview shows both a center “Tab returns you to your feet” message and a full-width bottom hint bar that repeats the same exit control among many others. Evidence: `11-course-overview.png`.
12. **Medium — permanent view controls appear in unrelated contexts.** Normal/Health/Moisture controls persist at the bottom-right in the clubhouse, checkout view, overview, and course editor instead of appearing only when relevant. Evidence: `04-fixed-camera-entrance-prompt.png` through `12-course-editor.png`.
13. **Medium — the pause information hierarchy hides important exits.** Return to menu is buried inside “Office,” Quit is absent, and no destructive confirmation is visible. The initial pause page is Save rather than a neutral resume/status page. Evidence: `06-pause-save.png` and pause implementation.
14. **Medium — pause leaves noisy gameplay UI visible beneath blur.** HUD chips, tutorial card, completion messages, long control ribbon, and view controls remain legible behind the veil. The overlay blocks input visually but does not quiet the presentation. Evidence: `06-pause-save.png` through `08-pause-controls.png`.
15. **Medium — course editor styling and exit behavior read as prototype UI.** The saturated green “SURFACES” block, independent bottom action bar, persistent data-view buttons, and generic “Cancel” create three control islands. There is no editor-local, plain-language exit instruction. Evidence: `12-course-editor.png`.
16. **Medium — controls reference contains duplicated and ambiguous actions.** `E` appears twice under Hands, “Space — Pause” actually changes simulation speed rather than opening the pause menu, and register/laptop exit nuances are absent. Evidence: `08-pause-controls.png`.
17. **Low — Continue's disabled presentation looks actionable.** The disabled Continue control retains the strongest green fill on the screen, so visual priority contradicts availability. Evidence: `00-main-menu-1440x900.png`.
18. **Low — loading feedback is not exposed as accessible status.** The visual veil has a progress bar and changing label but no observed live-region/status semantics. Evidence: `02-loading-transition.png` and current loading markup.

## Gameplay-mode findings

The dedicated operations route adds the following concrete defects to the ranked list above:

1. **Critical — UX modes do not have exclusive ownership.** After completing placement, the placement instruction stack remains active while the front desk accepts a check-in. The screenshot simultaneously shows a register interaction, “Drivers & woods — [E] set down,” a placement explanation, and a generic dismissal. Evidence: `baseline/operations/17-front-desk-checkin-before.png` and `18-front-desk-checkin-after.png`.
2. **High — the cash checkout baseline cannot reach receipt or handoff.** The sale requires $14 change, but the deterministic drawer interaction can assemble only $9; the transaction remains in `cash-drawer` with two scanned items and no receipt. This is an existing checkout-system defect outside this branch’s ownership and is preserved in the final blocker report. Evidence: `baseline/checkout/cash/failure-state.png`, `baseline/checkout/cash/result.json`.
3. **High — register guidance is static while the job changes.** “Drag goods over the scanner / T total / D drawer / Esc step back” remains visible through tender, card, cash, receipt, bagging, and handoff. It becomes actively wrong after scanning. Evidence: `baseline/checkout/card/02-register-mode.png` through the card completion sequence and the cash failure sequence.
4. **High — active tool prompts lose to unrelated world focus.** The vacuum can be running while the primary prompt says “Old clutter — [E] haul it out.” The contextual box cutter has the same conflict while opening a delivery. Evidence: `baseline/operations/12-cleaning-vacuum-equipped.png`, `13-cleaning-vacuum-after.png`, and `loop-2-cutter.png`.
5. **High — placement feedback survives completion.** A successful set-down leaves carrying controls and two placement messages stacked beneath the success notification; the placement halo/ghost also dominates the player camera. Evidence: `baseline/operations/14-placement-mode.png` through `16-placement-complete.png`.
6. **Medium — historical notifications obscure current maintenance work.** Course watering displays a correct live moisture readout, but stale check-in, washer, and hose-equip notifications occupy the same aiming area. Evidence: `baseline/operations/19-course-maintenance-hose.png` and `20-course-maintenance-after.png`.
7. **Medium — transaction presentation does not quiet the global HUD.** The tutorial card, tutorial completions, cash/clock chips, and data-view buttons remain visible during both card and cash checkout. Evidence: `baseline/checkout/card/02-register-mode.png` and corresponding cash capture.

The operations route completed delivery pickup, box cutting/opening, unboxing, stocking, clutter removal, vacuuming, fixture placement, front-desk check-in, and course watering with zero console errors or page errors. The result is recorded in `baseline/operations/result.json`; functional success does not erase the presentation defects above.

## Performance baseline

| Metric | Baseline | Source / unit |
| --- | ---: | --- |
| Average FPS | 156.45 mean / 155.60 median | Three runs of 600 consecutive `requestAnimationFrame` intervals |
| 1% low FPS | 99.57 mean / 102.39 median | Reciprocal of mean worst 1% frame interval per run |
| Worst frame time | 11.2 ms | Maximum across all three sampled runs |
| JavaScript heap | 93,983,998 bytes final | `performance.memory.usedJSHeapSize` |
| Active event listeners | 88 → 88 | CDP count across window, document, and connected DOM targets |
| UI mutation rate | 2.073 records/frame mean | MutationObserver over HUD, prompt, objective, notification, and pause roots |
| Draw calls | 3,815/frame median | Three.js `renderer.info` over one complete rendered frame per run |
| Rendered triangles | 5,284,360/frame median | Three.js `renderer.info` over one complete rendered frame per run |
| Visible scene meshes | 1,108 | Visible Three.js meshes |
| Scene triangles | 1,778,747 | Geometry/index count including instances |
| Materials | 229 | Unique visible material UUIDs |
| Texture objects | 163 visible / 208 renderer-resident | Unique visible texture UUIDs / Three.js renderer memory count |
| Texture memory | 6,169,904,488 bytes estimated | RGBA8-equivalent dimensions plus mip factor; exact GPU allocation unavailable in browser |

The fixed browser, viewport, save seed, camera, time, five-second warm-up, three-run sample count, and measurement route will be reused after player-facing changes. Texture memory remains an explicit RGBA8-equivalent estimate; it will only be compared with the identical method.

## Baseline captures

- `00-main-menu-1440x900.png`
- `01-new-game-property-market.png`
- `02-loading-transition.png`
- `03-fixed-camera-exterior-hud.png`
- `04-fixed-camera-entrance-prompt.png`
- `05-fixed-camera-checkout.png`
- `06-pause-save.png`
- `07-pause-settings.png`
- `08-pause-controls.png`
- `09-laptop-home.png`
- `10-laptop-settings.png`
- `11-course-overview.png`
- `12-course-editor.png`
