# Visual QA loop 1 — full player path

Fixed capture: 1440×900, DPR 1, dark scheme, 2:00 PM, Willow Creek Municipal. The run used the visible main-menu controls, Relaxed difficulty, the property-market Buy action, P/Esc, F hold, keyboard focus traversal, and Tab course switching.

## Findings

1. **P0 — New-game dialog printed `null`.** The optional overwrite warning was passed through native `append`, which stringified the absent node. Fixed by filtering optional children before append.
2. **P0 — Tool-wheel focus escaped into HUD and notification controls.** A hidden radial option could keep keyboard ownership after close. Fixed with explicit wheel Tab/Shift+Tab navigation plus blur-on-close.
3. **P0 — Tab could no longer enter course overview after closing the wheel.** The hidden focused option continued intercepting gameplay input. Fixed by returning active focus to the document body; the capture records `walk → overview → pause → walk` through normal keys.
4. **P0 — Opening and closing pause restarted an intentionally paused simulation.** `0 || 1` discarded the prior speed. Fixed by preserving speed index zero exactly.
5. **P1 — Main-menu Tab order fell through to `BODY` after Credits.** Fixed by wrapping Tab/Shift+Tab across enabled menu actions and adding Arrow/Home/End navigation.
6. **P1 — “Tool belt” collided with the upper radial option.** Fixed by moving the label into the clear space above the center hub.
7. **P1 — First-use tool guidance remained visible in course overview.** It collided with the overview control strip and described a walk-mode action in the wrong context. Fixed by synchronizing presentation mode immediately when Tab changes camera mode.
8. **P1 — Objective-completion notifications covered the persistent shop-condition HUD chip.** Fixed by moving the queued notification stack below the HUD cluster.
9. **P1 — The first market view is information-dense.** Listing prose, status pills, price, and Buy actions compete at once. Carry to loop 2 for hierarchy and responsive inspection without changing market logic.
10. **P1 — The controls page is textually complete but has weak scan hierarchy at a distance.** Carry to loop 2 for spacing and group-label comparison at compact and large viewports.
11. **P2 — The loading screen is clean but visually sparse and its progress state is small.** Carry to loop 2; preserve reduced-motion behavior and honest progress reporting.
12. **P2 — Disabled radial tools are legible but their reason is shown only after focus/hover.** Carry to loop 2 keyboard and mouse comparison; availability must remain contextual rather than permanently noisy.
13. **P2 — Two completion notices can temporarily dominate the upper-right view during the arrival sequence.** The queue is capped and dismissible; loop 2 will verify timing/dedupe rather than suppressing useful feedback.
14. **P2 — The overview notification and bottom help strip repeat “Tab returns” once.** Acceptable as first-use reinforcement, but loop 2 will verify it does not repeat after dismissal.

## Functional evidence

- Full scripted path completed.
- Console errors: 0.
- Page errors: 0.
- Request failures are known optional GLB aborts during loader fallback; no player-visible missing required model was observed.
- Audio debug state after all mode changes: one running context, no active or orphaned tool loops.
- Pause focus stayed within the pause shell; tool-wheel focus stayed within its radial options.
