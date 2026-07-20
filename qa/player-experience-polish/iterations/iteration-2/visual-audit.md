# Visual QA loop 2 — comparison and hierarchy

Same fixed 1440×900 path and camera poses as loop 1. This pass compared every changed surface against loop 1 and exercised the corrected focus path.

## Findings

1. **P0 — The literal `null` line was gone from New Game.** Verified in `02-new-game-dialog.png`; both difficulty choices retain clear names, consequences, and focus order.
2. **P0 — Main-menu keyboard traversal no longer lands on the document body.** Eight Tab presses cycle New Game → Settings → Credits and wrap.
3. **P0 — The radial menu releases keyboard ownership on close.** Telemetry records active element `BODY`, then normal Tab changes `walk → overview`.
4. **P0 — Pause preserves an already-paused simulation.** The deterministic 2:00 PM clock remains 2:00 PM across pause/settings/controls/tool-wheel/overview.
5. **P1 — “Tool belt” no longer collides with Hands Free.** The label now occupies the clear gap between the top option and center hub.
6. **P1 — Unavailable tool reasons were mouse-biased.** Tab/arrow navigation originally skipped disabled options, preventing keyboard inspection of their contextual reasons. Fixed by navigating all options while continuing to block equip.
7. **P1 — Overview leaked walk guidance and hid its data controls.** Both are fixed: the first-use card is absent and Normal/Health/Moisture controls appear at bottom-right.
8. **P1 — Completion notices obscured shop condition.** The notification stack now begins below the HUD cluster; the condition chip remains readable in `07-checkout-environment.png`.
9. **P1 — Market hierarchy remained too flat.** Revised to separate market summary/advice, title/meta, purchase, signals, and listing prose without touching purchase logic.
10. **P1 — Loading had honest stages but no practical tip.** Added one concise rotating gameplay tip below a divider while keeping real progress stages and reduced-motion-safe presentation.
11. **P2 — The first overview notice repeats the bottom control strip’s Tab instruction.** Kept for first-use reinforcement; stress QA must prove dedupe prevents recurring spam.
12. **P2 — Disabled radial options are intentionally dim.** The next compact-view pass must confirm they remain readable at 1100×680 and 125% UI scale.
13. **P2 — Market scrolling was not yet tested at compact height.** The hierarchy change requires loop 3 at 1100×680.
14. **P2 — Pause settings are spacious at 1440×900.** Loop 3 must verify the footer, tab list, and action controls stay reachable without overlap at compact height.

## Comparison result

- Full path completed again.
- Console errors: 0.
- Page errors: 0.
- Main-menu and radial focus defects from loop 1 are visibly and functionally resolved.
- No active or orphaned audio tool loops after repeated mode transitions.
