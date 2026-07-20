# Visual QA loop 3 — compact 1100×680

Fixed camera/state, DPR 1, 1100×680. The full menu → market → loading → walk → pause → settings → controls → tool wheel → overview route completed and wrote all 15 captures. The shell timeout occurred after evidence writing while Playwright was closing Chrome; the result itself records no script failure.

## Findings

1. **P0 — Core route remains operable at compact height.** New Game, first Buy, pause navigation, settings tabs, controls, F-hold wheel, and Tab overview all remained reachable through visible controls.
2. **P0 — Pause/settings do not clip required actions.** Audio and accessibility controls fit; footer and P/Esc escape remain visible.
3. **P1 — Market summary chips lost their boundaries outside listing/panel selectors.** The summary read as one sentence at 1100 px. Fixed by applying status-chip styling to `.market-stats`.
4. **P1 — Market cards now establish purchase priority clearly.** Property identity/meta sit left and price/Buy sit right; signals and prose form separate rows. The fourth card is intentionally below the scroll fold rather than compressed.
5. **P1 — Loading state was too empty in loop 2.** The compact capture now shows real progress, a named stage, and one short practical tip with ample breathing room.
6. **P1 — Radial helper copy was too small at compact scale.** Increased helper size/contrast while retaining the restrained center hub.
7. **P1 — Unavailable radial cards were too faint at compact scale.** Raised opacity; dashed border, × mark, reason text, and blocked equip continue to communicate unavailability without color alone.
8. **P1 — Pause header text appeared inconsistently in two compact page captures.** Added non-shrinking header ownership so long settings/control content can only scroll inside the content pane.
9. **P1 — Keyboard inspection of unavailable tools works.** Eight Tab presses visit disabled options, expose their reason in the center hub, and Escape still releases focus to BODY.
10. **P1 — Main menu title and action column approach each other but do not overlap.** The action column stays fully visible; title, tagline, and save state remain readable.
11. **P1 — Overview controls remain reachable at compact width.** Normal/Health/Moisture are separated from the left control strip; the first-use walk card is absent.
12. **P2 — Market’s final visible card is cut at the fold.** Verified the intended scroll affordance through keyboard traversal: focus advanced to a lower Buy action and moved the 569 px viewport inside the 1,311 px market document (`scrollTop: 17`) without trapping focus. Captured in `03b-property-market-keyboard-scroll.png`.
13. **P2 — Two objective-completion notices consume substantial upper-right space at 680 px.** They remain below HUD state, capped, dismissible, and transient; notification stress testing must verify dedupe and expiry.
14. **P2 — The first overview notice still repeats one bottom-strip instruction.** It is a one-time transition confirmation and does not collide at compact size.
15. **P2 — Main-menu abstract clubhouse sits closer behind the title at compact width.** Contrast remains sufficient and the geometry does not interfere with action hit targets.

## Result

- 16/16 captures written, including the compact keyboard-scroll state.
- Console errors: 0.
- Page errors: 0.
- Presentation returned to walk.
- Audio ended with no active tool loop.
