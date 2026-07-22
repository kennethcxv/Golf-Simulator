# Visual QA loop 4 — 2560×1440 accessibility profile

Full fixed route at 2560×1440, DPR 1. Reduced motion, high contrast, 125% interface scale, and Press-to-toggle sustained tools were enabled through the visible main-menu Settings controls before starting the game.

## Findings

1. **P0 — Accessibility state persists across the full transition chain.** Final preferences record reduced motion `true`, high contrast `true`, UI scale `1.25`, and tool activation `toggle` after menu → market → world → pause → overview → walk.
2. **P0 — High contrast does not depend on color alone.** Buttons, selects, tabs, modal edges, notification marks, and status chips gain stronger boundaries while retaining text/symbol labels.
3. **P0 — Reduced motion does not remove state feedback.** Loading progress/stage, focus borders, selected tabs, and mode confirmation remain visible with transitions suppressed.
4. **P1 — Main-menu brand and actions were pushed too close to opposite edges at ultrawide size.** Fixed by constraining both columns and centering the composition with a bounded atmospheric gap.
5. **P1 — The 125% interface scale remains readable without clipping.** Main-menu Settings, pause Accessibility, and the radial wheel all fit; footer and escape routes remain visible.
6. **P1 — Market summary chips are now visibly grouped.** Mood, wallet, and listing count have independent high-contrast pill boundaries, while advice stays plain explanatory text.
7. **P1 — Market listing hierarchy survives high contrast and large viewport.** Price/Buy remain the strongest right-hand action; status pills and prose do not compete with the title.
8. **P1 — Pause header remains stable on overview, settings, accessibility, controls, and overview-origin captures.** The compact shrink defect did not recur.
9. **P1 — Tool-wheel keyboard traversal exposes unavailable states.** Telemetry visits Shop Vacuum, Rented Washer, Watering Hose, Divot Kit, and Bunker Rake; Escape returns focus to BODY and Tab returns to overview.
10. **P1 — Overview remains uncluttered at large resolution.** Only the one-time transition notice, compact control strip, data-view controls, and HUD are present; walk tutorials stay suppressed.
11. **P1 — HUD and notification hierarchy stays separated.** Cash/time remain top-right; the notice begins below them and does not cover the aim area.
12. **P2 — The radial wheel remains intentionally bounded rather than expanding with screen size.** At native resolution it preserves a short cursor travel distance and world context; 125% text remains readable.
13. **P2 — Market shows more rows at large height, but still requires scrolling for the final listing/action.** This is preferable to stretching cards or reducing type below the chosen scale.
14. **P2 — Overview transition copy still duplicates the persistent control strip once.** Dedupe/stress QA remains responsible for proving it does not recur.

## Result

- Full route completed.
- Console errors: 0.
- Page errors: 0.
- Settings persisted across all transitions.
- Audio context remained singular and running with zero active/orphaned tool loops at handoff.
